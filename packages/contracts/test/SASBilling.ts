import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const AgentType = { LLM_INFERENCE: 0, CUSTOM_OFFCHAIN: 3 } as const;
const ExecutionStatus = { PENDING: 0, SUCCESS: 1 } as const;

describe("SASBilling", async () => {
  const { viem } = await network.connect();
  const [owner, builder, user, treasury] = await viem.getWalletClients();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;
  let billing: Awaited<ReturnType<typeof viem.deployContract>>;
  let mockExecutor: Awaited<ReturnType<typeof viem.deployContract>>;

  before(async () => {
    registry = await viem.deployContract("SASRegistry", [owner.account.address]);
    billing = await viem.deployContract("SASBilling", [
      owner.account.address,
      registry.address,
      treasury.account.address,
    ]);
    mockExecutor = await viem.deployContract("MockExecutor", []);

    await registry.write.setBillingContract([billing.address], { account: owner.account });
    await billing.write.setExecutor([mockExecutor.address], { account: owner.account });

    await registry.write.registerAgent(
      [
        "Billing Test Agent",
        "Custom off-chain test agent",
        "test",
        "ipfs://test-agent",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("1"),
        0n,
      ],
      { account: builder.account }
    );

    await registry.write.registerAgent(
      [
        "Billing LLM Agent",
        "Somnia LLM test agent",
        "test",
        "ipfs://llm-test-agent",
        AgentType.LLM_INFERENCE,
        parseEther("1"),
        22n,
      ],
      { account: builder.account }
    );

    await mockExecutor.write.setRuntimeBudget([parseEther("0.24")], { account: owner.account });
  });

  it("splits payment and creates a pending execution record", async () => {
    const payload = "0x1234" as `0x${string}`;
    await billing.write.executeAgent([1n, payload], {
      account: user.account,
      value: parseEther("1"),
    });

    const builderBalance = await billing.read.builderBalances([builder.account.address]);
    const treasuryBalance = await billing.read.treasuryBalance();
    const executionCount = await billing.read.executionCount();
    const record = await billing.read.getExecutionRecord([1n]);
    const lastCall = await mockExecutor.read.lastCall();

    assert.equal(builderBalance, parseEther("0.85"));
    assert.equal(treasuryBalance, parseEther("0.15"));
    assert.equal(executionCount, 1n);
    assert.equal(record.status, ExecutionStatus.PENDING);
    assert.equal(record.amountPaid, parseEther("1"));
    assert.equal(lastCall[0], 1n);
    assert.equal(lastCall[1], 1n);
    assert.equal((lastCall[2] as string).toLowerCase(), user.account.address.toLowerCase());
  });

  it("allows executor to resolve execution state", async () => {
    await mockExecutor.write.resolveOnBilling(
      [billing.address, 1n, ExecutionStatus.SUCCESS, "0x6869", 77n],
      { account: owner.account }
    );

    const record = await billing.read.getExecutionRecord([1n]);
    assert.equal(record.status, ExecutionStatus.SUCCESS);
    assert.equal(record.result, "0x6869");
    assert.equal(record.somniaRequestId, 77n);
    assert.ok(record.resolvedAt > 0n);
  });

  it("lets builders withdraw and zeroes pending balance", async () => {
    await billing.write.builderWithdraw([], { account: builder.account });
    const builderBalance = await billing.read.builderBalances([builder.account.address]);
    assert.equal(builderBalance, 0n);
  });

  it("lets admin withdraw treasury amount and updates treasury balance", async () => {
    await billing.write.adminWithdraw([parseEther("0.05")], { account: owner.account });
    const treasuryBalance = await billing.read.treasuryBalance();
    assert.equal(treasuryBalance, parseEther("0.10"));
  });

  it("charges and forwards runtime budget separately for a Somnia-native agent", async () => {
    const quote = await billing.read.quoteExecution([2n]);
    assert.equal(quote[0], parseEther("1"));
    assert.equal(quote[1], parseEther("0.24"));
    assert.equal(quote[2], parseEther("1.24"));

    await assert.rejects(
      billing.write.executeAgent([2n, "0x1234"], {
        account: user.account,
        value: parseEther("1"),
      })
    );

    await billing.write.executeAgent([2n, "0x1234"], {
      account: user.account,
      value: parseEther("1.24"),
    });

    const record = await billing.read.getExecutionRecord([2n]);
    const charge = await billing.read.getExecutionCharge([2n]);
    const agent = await registry.read.getAgent([2n]);
    assert.equal(record.amountPaid, parseEther("1.24"));
    assert.equal(charge.agentFee, parseEther("1"));
    assert.equal(charge.runtimeBudget, parseEther("0.24"));
    assert.equal(charge.totalPaid, parseEther("1.24"));
    assert.equal(agent.totalRevenue, parseEther("1"));
    assert.equal(await mockExecutor.read.lastValue(), parseEther("0.24"));
    assert.equal(await billing.read.cumulativeRevenue(), parseEther("2"));
    assert.equal(await billing.read.cumulativeRuntimeBudget(), parseEther("0.24"));
  });
});
