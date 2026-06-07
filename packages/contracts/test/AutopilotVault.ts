import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, parseEther, toBytes } from "viem";

const AgentType = { LLM_INFERENCE: 0 } as const;

describe("AutopilotVault", async () => {
  const { viem } = await network.connect();
  const [owner, builder, user, treasury, relayer] = await viem.getWalletClients();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;
  let billing: Awaited<ReturnType<typeof viem.deployContract>>;
  let mockExecutor: Awaited<ReturnType<typeof viem.deployContract>>;
  let vault: Awaited<ReturnType<typeof viem.deployContract>>;
  let missionId: `0x${string}`;
  const marketHash = keccak256(toBytes("https://prophecy.social/event/14776"));
  const questionHash = keccak256(toBytes("Will the event resolve YES?"));
  const payloadTemplateHash = keccak256(toBytes("prophecy-companion-payload-template-v1"));
  const contextHash = keccak256(toBytes("market context"));

  async function createMission(input: {
    maxRuns?: bigint;
    maxTotalSpend?: bigint;
    minCadenceSeconds?: bigint;
    market?: `0x${string}`;
    question?: `0x${string}`;
    template?: `0x${string}`;
  } = {}) {
    const publicClient = await viem.getPublicClient();
    const now = (await publicClient.getBlock()).timestamp;
    await vault.write.createMission(
      [
        1n,
        parseEther("0.02"),
        input.minCadenceSeconds ?? 0n,
        input.maxRuns ?? 10n,
        now + 3600n,
        input.maxTotalSpend ?? parseEther("1"),
        input.market ?? marketHash,
        input.question ?? questionHash,
        input.template ?? payloadTemplateHash,
        "ipfs://mission",
      ],
      {
        account: user.account,
        value: parseEther("1"),
      }
    );
    const missionIds = await vault.read.getOwnerMissionIds([user.account.address]);
    return missionIds[missionIds.length - 1];
  }

  before(async () => {
    registry = await viem.deployContract("SASRegistry", [owner.account.address]);
    billing = await viem.deployContract("SASBilling", [
      owner.account.address,
      registry.address,
      treasury.account.address,
    ]);
    mockExecutor = await viem.deployContract("MockExecutor", []);
    vault = await viem.deployContract("AutopilotVault", [
      owner.account.address,
      billing.address,
      registry.address,
    ]);

    await registry.write.setBillingContract([billing.address], { account: owner.account });
    await billing.write.setExecutor([mockExecutor.address], { account: owner.account });
    await mockExecutor.write.setRuntimeBudget([parseEther("0.24")], { account: owner.account });
    await vault.write.setRelayer([relayer.account.address, true], { account: owner.account });

    await registry.write.registerAgent(
      [
        "Autopilot LLM Agent",
        "Autopilot runtime funding test",
        "test",
        "ipfs://autopilot-llm",
        AgentType.LLM_INFERENCE,
        parseEther("0.02"),
        42n,
      ],
      { account: builder.account }
    );

    missionId = await createMission();
  });

  it("quotes and debits the agent fee, runtime budget, and relayer fee", async () => {
    const quote = await vault.read.canExecute([missionId, parseEther("0.02")]);
    assert.equal(quote[0], true);
    assert.equal(quote[1], parseEther("0.02"));
    assert.equal(quote[2], parseEther("0.24"));
    assert.equal(quote[3], parseEther("0.28"));
    assert.equal(quote[4], parseEther("1"));

    const key = `0x${"1".padStart(64, "0")}` as `0x${string}`;
    await vault.write.executeMission(
      [
        missionId,
        "0x1234",
        key,
        parseEther("0.02"),
        marketHash,
        questionHash,
        payloadTemplateHash,
        keccak256("0x1234"),
        contextHash,
        "",
      ],
      { account: relayer.account }
    );

    const mission = await vault.read.getMission([missionId]);
    const charge = await billing.read.getExecutionCharge([1n]);
    assert.equal(mission.balance, parseEther("0.72"));
    assert.equal(mission.spent, parseEther("0.28"));
    assert.equal(mission.runCount, 1n);
    assert.equal(charge.agentFee, parseEther("0.02"));
    assert.equal(charge.runtimeBudget, parseEther("0.24"));
    assert.equal(await mockExecutor.read.lastValue(), parseEther("0.24"));
  });

  it("rejects executions once max runs are reached", async () => {
    const oneRunMission = await createMission({ maxRuns: 1n });
    await vault.write.executeMission(
      [
        oneRunMission,
        "0x1234",
        `0x${"2".padStart(64, "0")}` as `0x${string}`,
        parseEther("0.02"),
        marketHash,
        questionHash,
        payloadTemplateHash,
        keccak256("0x1234"),
        contextHash,
        "",
      ],
      { account: relayer.account }
    );

    await assert.rejects(
      vault.write.executeMission(
        [
          oneRunMission,
          "0x1234",
          `0x${"3".padStart(64, "0")}` as `0x${string}`,
          parseEther("0.02"),
          marketHash,
          questionHash,
          payloadTemplateHash,
          keccak256("0x1234"),
          contextHash,
          "",
        ],
        { account: relayer.account }
      ),
      /max runs reached/
    );
  });

  it("rejects executions with a different market hash", async () => {
    const guardedMission = await createMission();
    const wrongMarket = keccak256(toBytes("https://prophecy.social/event/99999"));

    await assert.rejects(
      vault.write.executeMission(
        [
          guardedMission,
          "0x1234",
          `0x${"4".padStart(64, "0")}` as `0x${string}`,
          parseEther("0.02"),
          wrongMarket,
          questionHash,
          payloadTemplateHash,
          keccak256("0x1234"),
          contextHash,
          "",
        ],
        { account: relayer.account }
      ),
      /market mismatch/
    );
  });

  it("rejects executions that would exceed the spend cap", async () => {
    const cappedMission = await createMission({ maxTotalSpend: parseEther("0.27") });

    await assert.rejects(
      vault.write.executeMission(
        [
          cappedMission,
          "0x1234",
          `0x${"5".padStart(64, "0")}` as `0x${string}`,
          parseEther("0.02"),
          marketHash,
          questionHash,
          payloadTemplateHash,
          keccak256("0x1234"),
          contextHash,
          "",
        ],
        { account: relayer.account }
      ),
      /spend cap exceeded/
    );
  });

  it("rejects executions with a different payload template hash", async () => {
    const guardedMission = await createMission();
    const wrongTemplate = keccak256(toBytes("prophecy-companion-payload-template-v2"));

    await assert.rejects(
      vault.write.executeMission(
        [
          guardedMission,
          "0x1234",
          `0x${"6".padStart(64, "0")}` as `0x${string}`,
          parseEther("0.02"),
          marketHash,
          questionHash,
          wrongTemplate,
          keccak256("0x1234"),
          contextHash,
          "",
        ],
        { account: relayer.account }
      ),
      /template mismatch/
    );
  });

  it("rejects executions when the declared payload hash does not match the payload", async () => {
    const guardedMission = await createMission();

    await assert.rejects(
      vault.write.executeMission(
        [
          guardedMission,
          "0x1234",
          `0x${"7".padStart(64, "0")}` as `0x${string}`,
          parseEther("0.02"),
          marketHash,
          questionHash,
          payloadTemplateHash,
          keccak256("0x5678"),
          contextHash,
          "",
        ],
        { account: relayer.account }
      ),
      /payload hash mismatch/
    );
  });
});
