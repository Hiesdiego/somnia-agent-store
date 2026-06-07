import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const AgentType = { LLM_INFERENCE: 0, CUSTOM_OFFCHAIN: 3 } as const;
const ExecutionStatus = { PENDING: 0, SUCCESS: 1, FAILED: 2, TIMEOUT: 3 } as const;
const SettlementStatus = { OPEN: 0, VERIFYING: 1, RELEASED: 2, REFUNDED: 3, CANCELLED: 4 } as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

describe("SASSettlement", async () => {
  const { viem } = await network.connect();
  const [owner, builder, requester, treasury, verifier1, verifier2] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;
  let billing: Awaited<ReturnType<typeof viem.deployContract>>;
  let mockExecutor: Awaited<ReturnType<typeof viem.deployContract>>;
  let verifierRegistry: Awaited<ReturnType<typeof viem.deployContract>>;
  let settlement: Awaited<ReturnType<typeof viem.deployContract>>;

  before(async () => {
    registry = await viem.deployContract("SASRegistry", [owner.account.address]);
    billing = await viem.deployContract("SASBilling", [
      owner.account.address,
      registry.address,
      treasury.account.address,
    ]);
    mockExecutor = await viem.deployContract("MockExecutor", []);
    verifierRegistry = await viem.deployContract("SASVerifierRegistry", [
      owner.account.address,
      parseEther("0.1"),
    ]);
    settlement = await viem.deployContract("SASSettlement", [
      owner.account.address,
      billing.address,
      verifierRegistry.address,
    ]);

    await registry.write.setBillingContract([billing.address], { account: owner.account });
    await billing.write.setExecutor([mockExecutor.address], { account: owner.account });
    await billing.write.setSettlementContract([settlement.address], { account: owner.account });
    await verifierRegistry.write.setReportWriter([settlement.address, true], { account: owner.account });

    await registry.write.registerAgent(
      [
        "Settlement Test Agent",
        "Custom off-chain agent for settlement flow",
        "test",
        "ipfs://settlement-agent",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("1"),
        0n,
      ],
      { account: builder.account }
    );
    await registry.write.registerAgent(
      [
        "Settlement LLM Agent",
        "Somnia LLM agent for runtime refund accounting",
        "test",
        "ipfs://settlement-llm-agent",
        AgentType.LLM_INFERENCE,
        parseEther("1"),
        44n,
      ],
      { account: builder.account }
    );
    await mockExecutor.write.setRuntimeBudget([parseEther("0.24")], { account: owner.account });

    await verifierRegistry.write.registerVerifier(["ipfs://verifier-1"], {
      account: verifier1.account,
      value: parseEther("0.1"),
    });
    await verifierRegistry.write.registerVerifier(["ipfs://verifier-2"], {
      account: verifier2.account,
      value: parseEther("0.1"),
    });
  });

  it("releases escrow to builder after verifier quorum", async () => {
    const now = (await publicClient.getBlock()).timestamp;
    const expiresAt = now + 3600n;

    const settlementId = await settlement.read.previewNextSettlementId([
      requester.account.address,
      1n,
      requester.account.address,
    ]);

    await settlement.write.createSettlement(
      [1n, requester.account.address, 2n, 1n, expiresAt, ZERO_BYTES32],
      {
        account: requester.account,
        value: parseEther("1"),
      }
    );

    const opened = await settlement.read.settlements([settlementId]);
    assert.equal(opened[14], SettlementStatus.OPEN);
    assert.equal(opened[5], parseEther("1"));

    await settlement.write.executeSettlement([settlementId, "0x1234"], {
      account: requester.account,
    });

    const verifying = await settlement.read.settlements([settlementId]);
    assert.equal(verifying[14], SettlementStatus.VERIFYING);
    assert.equal(verifying[4], 1n);

    await mockExecutor.write.resolveOnBilling(
      [billing.address, 1n, ExecutionStatus.SUCCESS, "0x68656c6c6f", 101n],
      { account: owner.account }
    );

    await settlement.write.submitVerification([settlementId, true, "ipfs://vote-1"], {
      account: verifier1.account,
    });
    const mid = await settlement.read.settlements([settlementId]);
    assert.equal(mid[14], SettlementStatus.VERIFYING);
    assert.equal(mid[10], 1n);

    await settlement.write.submitVerification([settlementId, true, "ipfs://vote-2"], {
      account: verifier2.account,
    });

    const finalized = await settlement.read.settlements([settlementId]);
    assert.equal(finalized[14], SettlementStatus.RELEASED);
    assert.equal(finalized[10], 2n);

    const execution = await billing.read.getExecutionRecord([1n]);
    assert.equal(execution.status, ExecutionStatus.SUCCESS);

    const builderBalance = await billing.read.builderBalances([builder.account.address]);
    const treasuryBalance = await billing.read.treasuryBalance();
    assert.equal(builderBalance, parseEther("0.85"));
    assert.equal(treasuryBalance, parseEther("0.15"));
  });

  it("refunds only the service fee after an executed Somnia-native settlement is rejected", async () => {
    const now = (await publicClient.getBlock()).timestamp;
    const settlementId = await settlement.read.previewNextSettlementId([
      requester.account.address,
      2n,
      requester.account.address,
    ]);

    await settlement.write.createSettlement(
      [2n, requester.account.address, 2n, 1n, now + 3600n, ZERO_BYTES32],
      {
        account: requester.account,
        value: parseEther("1.24"),
      }
    );

    await settlement.write.executeSettlement([settlementId, "0x1234"], {
      account: requester.account,
    });
    await mockExecutor.write.resolveOnBilling(
      [billing.address, 2n, ExecutionStatus.FAILED, "0x", 202n],
      { account: owner.account }
    );
    await settlement.write.submitVerification([settlementId, false, "ipfs://reject"], {
      account: verifier1.account,
    });

    const execution = await billing.read.getExecutionRecord([2n]);
    const charge = await billing.read.getExecutionCharge([2n]);
    assert.equal(execution.status, ExecutionStatus.FAILED);
    assert.equal(charge.agentFee, parseEther("1"));
    assert.equal(charge.runtimeBudget, parseEther("0.24"));
    assert.equal(await mockExecutor.read.lastValue(), parseEther("0.24"));
    assert.equal(await billing.read.builderBalances([builder.account.address]), parseEther("0.85"));
    assert.equal(await billing.read.treasuryBalance(), parseEther("0.15"));
    assert.equal(await billing.read.cumulativeRevenue(), parseEther("1"));
    assert.equal(await billing.read.cumulativeRuntimeBudget(), parseEther("0.24"));
  });
});
