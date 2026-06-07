import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, parseEther } from "viem";

const AgentType = { CUSTOM_OFFCHAIN: 3 } as const;
const WorkflowStatus = { ACTIVE: 0, PAUSED: 1, FINALIZED: 2, CANCELLED: 3 } as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

describe("SASAutonomyV4", async () => {
  const { viem } = await network.connect();
  const [owner, rootBuilder, beneficiaryBuilder, requester, treasury, workflowExecutor, outsider] =
    await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;
  let billing: Awaited<ReturnType<typeof viem.deployContract>>;
  let mockExecutor: Awaited<ReturnType<typeof viem.deployContract>>;
  let executionGraph: Awaited<ReturnType<typeof viem.deployContract>>;
  let autonomy: Awaited<ReturnType<typeof viem.deployContract>>;

  before(async () => {
    registry = await viem.deployContract("SASRegistry", [owner.account.address]);
    billing = await viem.deployContract("SASBilling", [
      owner.account.address,
      registry.address,
      treasury.account.address,
    ]);
    mockExecutor = await viem.deployContract("MockExecutor", []);
    executionGraph = await viem.deployContract("SASExecutionGraph", [owner.account.address]);
    autonomy = await viem.deployContract("SASAutonomyV4", [
      owner.account.address,
      billing.address,
      registry.address,
      executionGraph.address,
    ]);

    await registry.write.setBillingContract([billing.address], { account: owner.account });
    await billing.write.setExecutor([mockExecutor.address], { account: owner.account });
    await executionGraph.write.setRecorder([autonomy.address, true], { account: owner.account });

    // Root workflow source agent.
    await registry.write.registerAgent(
      [
        "Root Agent",
        "Root agent for autonomy workflows",
        "autonomy",
        "ipfs://root-agent",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("1"),
        0n,
      ],
      { account: rootBuilder.account }
    );

    // Step execution target agent.
    await registry.write.registerAgent(
      [
        "Target Agent",
        "Step target agent for autonomy workflows",
        "autonomy",
        "ipfs://target-agent",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("1"),
        0n,
      ],
      { account: rootBuilder.account }
    );

    // Beneficiary agent used to resolve split builder payouts.
    await registry.write.registerAgent(
      [
        "Beneficiary Agent",
        "Split payout beneficiary agent",
        "autonomy",
        "ipfs://beneficiary-agent",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("0.5"),
        0n,
      ],
      { account: beneficiaryBuilder.account }
    );
  });

  it("executes planned steps, accounts workflow budget, and accrues split revenue", async () => {
    await autonomy.write.createWorkflow([1n, 3n, ZERO_BYTES32, "ipfs://wf-1"], {
      account: requester.account,
      value: parseEther("3"),
    });

    const payload = "0x1234" as `0x${string}`;
    const payloadHash = keccak256(payload);
    const relationType = `0x${"11".padStart(64, "0")}` as `0x${string}`;

    await autonomy.write.planStep(
      [1n, 0n, 1n, 2n, payloadHash, parseEther("1.5"), relationType, "ipfs://step-1"],
      { account: requester.account }
    );

    await autonomy.write.addStepSplit([1n, 3n, 2_000n], { account: requester.account });

    const preview = await autonomy.read.previewStepExecution([1n]);
    assert.equal(preview[0], parseEther("1"));
    assert.equal(preview[2], parseEther("1"));
    assert.equal(preview[3], parseEther("0.2"));
    assert.equal(preview[4], parseEther("1.2"));
    assert.equal(preview[5], parseEther("3"));

    await autonomy.write.executeStep([1n, payload], { account: requester.account });

    const workflow = await autonomy.read.workflows([1n]);
    const step = await autonomy.read.steps([1n]);
    const charge = await billing.read.getExecutionCharge([1n]);

    assert.equal(workflow[5], parseEther("1.8"));
    assert.equal(workflow[6], parseEther("1"));
    assert.equal(workflow[7], parseEther("0.2"));
    assert.equal(workflow[10], WorkflowStatus.ACTIVE);

    assert.equal(step[8], true);
    assert.equal(step[9], 1n);
    assert.equal(step[10], parseEther("1"));
    assert.equal(step[12], parseEther("1"));
    assert.equal(step[13], parseEther("0.2"));
    assert.equal(charge.agentFee, parseEther("1"));

    assert.equal(
      await autonomy.read.splitBalances([beneficiaryBuilder.account.address]),
      parseEther("0.2")
    );
    assert.equal(await autonomy.read.agentSplitRevenue([3n]), parseEther("0.2"));
    assert.equal(await billing.read.builderBalances([rootBuilder.account.address]), parseEther("0.85"));

    const graphWorkflowId = workflow[11] as `0x${string}`;
    assert.notEqual(graphWorkflowId, ZERO_BYTES32);
    const edges = await executionGraph.read.getWorkflowEdges([graphWorkflowId]);
    assert.equal(edges.length, 0);
  });

  it("records parent-child graph edges and supports beneficiary withdrawals", async () => {
    const rootPayload = "0xabcd" as `0x${string}`;
    await autonomy.write.planStep(
      [
        1n,
        1n,
        2n,
        2n,
        keccak256(rootPayload),
        parseEther("1.5"),
        `0x${"22".padStart(64, "0")}`,
        "ipfs://step-2",
      ],
      { account: requester.account }
    );

    await autonomy.write.executeStep([2n, rootPayload], { account: requester.account });

    const workflow = await autonomy.read.workflows([1n]);
    const edges = await executionGraph.read.getWorkflowEdges([workflow[11] as `0x${string}`]);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].fromExecutionId, 1n);
    assert.equal(edges[0].toExecutionId, 2n);
    assert.equal(edges[0].fromAgentId, 2n);
    assert.equal(edges[0].toAgentId, 2n);

    await autonomy.write.withdrawSplitRevenue([beneficiaryBuilder.account.address, parseEther("0.2")], {
      account: beneficiaryBuilder.account,
    });

    assert.equal(await autonomy.read.splitBalances([beneficiaryBuilder.account.address]), 0n);
  });

  it("enforces parent execution and workflow depth constraints", async () => {
    await autonomy.write.createWorkflow([1n, 1n, ZERO_BYTES32, "ipfs://wf-2"], {
      account: requester.account,
      value: parseEther("2"),
    });

    const rootPayload = "0x01" as `0x${string}`;
    await autonomy.write.planStep(
      [2n, 0n, 1n, 2n, keccak256(rootPayload), parseEther("1.5"), ZERO_BYTES32, "ipfs://wf2-step-1"],
      { account: requester.account }
    );

    await assert.rejects(
      autonomy.write.planStep(
        [2n, 3n, 2n, 2n, keccak256("0x02"), parseEther("1.5"), ZERO_BYTES32, "ipfs://wf2-step-2"],
        { account: requester.account }
      )
    );

    await autonomy.write.createWorkflow([1n, 3n, ZERO_BYTES32, "ipfs://wf-3"], {
      account: requester.account,
      value: parseEther("2"),
    });
    await autonomy.write.setWorkflowExecutor([3n, workflowExecutor.account.address, true], {
      account: requester.account,
    });

    await autonomy.write.planStep(
      [3n, 0n, 1n, 2n, keccak256("0x03"), parseEther("1.5"), ZERO_BYTES32, "ipfs://wf3-step-1"],
      { account: requester.account }
    );
    await autonomy.write.planStep(
      [3n, 4n, 2n, 2n, keccak256("0x04"), parseEther("1.5"), ZERO_BYTES32, "ipfs://wf3-step-2"],
      { account: requester.account }
    );

    await assert.rejects(
      autonomy.write.executeStep([5n, "0x04"], { account: workflowExecutor.account })
    );
    await assert.rejects(
      autonomy.write.executeStep([4n, "0x03"], { account: outsider.account })
    );
  });

  it("refunds remaining budget on workflow cancellation", async () => {
    await autonomy.write.createWorkflow([1n, 2n, ZERO_BYTES32, "ipfs://wf-4"], {
      account: requester.account,
      value: parseEther("1"),
    });

    const beforeBalance = await publicClient.getBalance({ address: autonomy.address });

    await autonomy.write.cancelWorkflow([4n], { account: requester.account });

    const afterBalance = await publicClient.getBalance({ address: autonomy.address });
    const workflow = await autonomy.read.workflows([4n]);
    assert.equal(afterBalance, beforeBalance - parseEther("1"));
    assert.equal(workflow[10], WorkflowStatus.CANCELLED);
    assert.equal(workflow[5], 0n);
  });
});
