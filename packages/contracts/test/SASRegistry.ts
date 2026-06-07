import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

// AgentType enum values matching Solidity
const AgentType = { LLM_INFERENCE: 0, JSON_API: 1, WEBSITE_PARSE: 2, CUSTOM_OFFCHAIN: 3 } as const;
const AgentStatus = { ACTIVE: 0, PAUSED: 1, DEPRECATED: 2 } as const;

describe("SASRegistry", async () => {
  const { viem } = await network.connect();
  const [owner, builder1, builder2, billing] = await viem.getWalletClients();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;

  before(async () => {
    registry = await viem.deployContract("SASRegistry", [owner.account.address]);
  });

  // ── registerAgent ──────────────────────────────────────────────────────────

  it("registers a new agent and emits AgentRegistered", async () => {
    const publicClient = await viem.getPublicClient();
    const hash = await registry.write.registerAgent(
      [
        "Flash Predire",
        "Real-time sports prediction agent",
        "sports",
        "ipfs://QmTest",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("0.01"), // 0.01 STT per execution
        0n,                 // 0 = no Somnia platform agent ID (custom)
      ],
      { account: builder1.account }
    );

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");

    const count = await registry.read.agentCount();
    assert.equal(count, 1n);
  });

  it("stores correct agent data", async () => {
    const agent = await registry.read.getAgent([1n]);
    assert.equal(agent.name, "Flash Predire");
    assert.equal(agent.builder.toLowerCase(), builder1.account.address.toLowerCase());
    assert.equal(agent.agentType, AgentType.CUSTOM_OFFCHAIN);
    assert.equal(agent.status, AgentStatus.ACTIVE);
    assert.equal(agent.pricePerExecution, parseEther("0.01"));
    assert.equal(agent.isVerified, false);
  });

  it("rejects registration with empty name", async () => {
    await assert.rejects(
      registry.write.registerAgent(
        ["", "desc", "cat", "ipfs://x", AgentType.CUSTOM_OFFCHAIN, parseEther("0.01"), 0n],
        { account: builder1.account }
      ),
      /name required/
    );
  });

  it("rejects on-chain agent without somniaAgentId", async () => {
    await assert.rejects(
      registry.write.registerAgent(
        ["LLM Bot", "desc", "ai", "ipfs://x", AgentType.LLM_INFERENCE, parseEther("0.5"), 0n],
        { account: builder1.account }
      ),
      /somniaAgentId required/
    );
  });

  it("registers an LLM agent with valid somniaAgentId", async () => {
    await registry.write.registerAgent(
      ["CryptoSense", "DeFi LLM oracle", "finance", "ipfs://QmLLM", AgentType.LLM_INFERENCE, parseEther("0.5"), 42n],
      { account: builder2.account }
    );
    const count = await registry.read.agentCount();
    assert.equal(count, 2n);
  });

  it("authorized registrar can register on behalf of a builder", async () => {
    await registry.write.setAuthorizedRegistrar([billing.account.address, true], {
      account: owner.account,
    });

    await registry.write.registerAgentForBuilder(
      [
        builder1.account.address,
        "Spawned Agent",
        "Spawned by registrar",
        "autonomy",
        "ipfs://spawned",
        AgentType.CUSTOM_OFFCHAIN,
        parseEther("0.015"),
        0n,
      ],
      { account: billing.account }
    );

    const count = await registry.read.agentCount();
    assert.equal(count, 3n);

    const agents = await registry.read.getBuilderAgents([builder1.account.address]);
    assert.equal(agents.length, 2);
    assert.equal(agents[1].name, "Spawned Agent");
  });

  // ── updateAgent ────────────────────────────────────────────────────────────

  it("builder can update their agent", async () => {
    await registry.write.updateAgent(
      [1n, "Updated description", "ipfs://QmUpdated", parseEther("0.02")],
      { account: builder1.account }
    );
    const agent = await registry.read.getAgent([1n]);
    assert.equal(agent.description, "Updated description");
    assert.equal(agent.version, 2n);
  });

  it("non-builder cannot update agent", async () => {
    await assert.rejects(
      registry.write.updateAgent(
        [1n, "Hack", "ipfs://x", parseEther("0.01")],
        { account: builder2.account }
      ),
      /not the agent builder/
    );
  });

  // ── pause / resume ─────────────────────────────────────────────────────────

  it("builder can pause and resume their agent", async () => {
    await registry.write.pauseAgent([1n], { account: builder1.account });
    let agent = await registry.read.getAgent([1n]);
    assert.equal(agent.status, AgentStatus.PAUSED);

    await registry.write.resumeAgent([1n], { account: builder1.account });
    agent = await registry.read.getAgent([1n]);
    assert.equal(agent.status, AgentStatus.ACTIVE);
  });

  // ── admin verify ───────────────────────────────────────────────────────────

  it("admin can verify an agent", async () => {
    await registry.write.setAgentVerified([1n, true], { account: owner.account });
    const agent = await registry.read.getAgent([1n]);
    assert.equal(agent.isVerified, true);
  });

  it("non-admin cannot verify an agent", async () => {
    await assert.rejects(
      registry.write.setAgentVerified([1n, false], { account: builder1.account }),
      /OwnableUnauthorizedAccount/
    );
  });

  // ── billing hook ───────────────────────────────────────────────────────────

  it("setBillingContract restricts recordExecution", async () => {
    await registry.write.setBillingContract([billing.account.address], { account: owner.account });

    // Non-billing address should fail
    await assert.rejects(
      registry.write.recordExecution([1n, parseEther("0.01")], { account: builder1.account }),
      /not billing contract/
    );
  });

  // ── views ──────────────────────────────────────────────────────────────────

  it("getBuilderAgents returns correct agents", async () => {
    const agents = await registry.read.getBuilderAgents([builder1.account.address]);
    const names = agents.map((agent) => agent.name);
    assert.equal(agents.length, 2);
    assert.deepEqual(names.sort(), ["Flash Predire", "Spawned Agent"].sort());
  });

  it("getAllActiveAgents excludes deprecated agents", async () => {
    await registry.write.deprecateAgent([2n], { account: builder2.account });
    const active = await registry.read.getAllActiveAgents();
    const names = active.map((agent) => agent.name);
    assert.equal(active.length, 2);
    assert.deepEqual(names.sort(), ["Flash Predire", "Spawned Agent"].sort());
  });

  it("isAgentActive returns false for deprecated", async () => {
    const active = await registry.read.isAgentActive([2n]);
    assert.equal(active, false);
  });
});
