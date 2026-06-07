import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { SomniaAgentKit, SOMNIA_NETWORKS, formatEther } from "somnia-agent-kit";

loadDotenv({ path: "../contracts/.env", override: false });

const AGENT_REGISTRY = "0xC9f3452090EEB519467DEa4a390976D38C008347";
const AGENT_MANAGER = "0x77F6dC5924652e32DBa0B4329De0a44a2C95691E";
const AGENT_EXECUTOR = "0x157C56dEdbAB6caD541109daabA4663Fc016026e";
const AGENT_VAULT = "0x7cEe3142A9c6d15529C322035041af697B2B5129";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function main() {
  const privateKey =
    process.env.COMPANION_PRIVATE_KEY?.trim() ||
    process.env.DEPLOYER_PRIVATE_KEY?.trim() ||
    required("PRIVATE_KEY");
  const name = optional("COMPANION_SOMNIA_AGENT_NAME", "Prophecy Companion Agent");
  const description = optional(
    "COMPANION_SOMNIA_AGENT_DESCRIPTION",
    process.env.COMPANION_AGENT_DESCRIPTION?.trim() ||
      "Analyzes Somnia Prophecy markets with structured probability, confidence, evidence, and reasoning."
  );
  const metadata = optional(
    "COMPANION_SOMNIA_AGENT_METADATA_URI",
    process.env.COMPANION_AGENT_METADATA_URI?.trim() || "ipfs://prophecy-companion-agent-v1"
  );
  const capabilities = optional(
    "COMPANION_SOMNIA_AGENT_CAPABILITIES",
    "prediction-market-analysis,web-research,probability-estimation,structured-json,prophecy-social"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const kit = new SomniaAgentKit({
    network: {
      ...SOMNIA_NETWORKS.testnet,
      rpcUrl: optional("SOMNIA_RPC_URL", SOMNIA_NETWORKS.testnet.rpcUrl),
    },
    contracts: {
      agentRegistry: optional("SOMNIA_AGENT_REGISTRY_ADDRESS", AGENT_REGISTRY),
      agentManager: optional("SOMNIA_AGENT_MANAGER_ADDRESS", AGENT_MANAGER),
      agentExecutor: optional("SOMNIA_AGENT_EXECUTOR_ADDRESS", AGENT_EXECUTOR),
      agentVault: optional("SOMNIA_AGENT_VAULT_ADDRESS", AGENT_VAULT),
    },
    privateKey,
    logLevel: "warn",
    telemetryEnabled: false,
    metricsEnabled: false,
  });

  await kit.initialize();

  const signer = kit.getSigner();
  if (!signer) throw new Error("Somnia Agent Kit did not initialize a signer.");

  const owner = await signer.getAddress();
  const balance = await kit.getProvider().getBalance(owner);
  console.log("Prophecy Companion Somnia Agent deployment");
  console.log(`Owner: ${owner}`);
  console.log(`Balance: ${formatEther(balance)} STT`);
  console.log(`Registry: ${kit.getConfig().contracts.agentRegistry}`);
  console.log(`Name: ${name}`);

  const ownerAgentIds = await kit.contracts.registry.getOwnerAgents(owner);
  for (const agentId of ownerAgentIds) {
    const agent = await kit.contracts.registry.getAgent(agentId);
    if (agent.name === name) {
      console.log("Existing Prophecy Companion Somnia agent found.");
      console.log(`COMPANION_SOMNIA_AGENT_ID=${agentId.toString()}`);
      console.log(`COMPANION_SOMNIA_AGENT_OWNER=${owner}`);
      return;
    }
  }

  console.log("Registering Prophecy Companion on the Somnia Agent Platform...");
  const tx = await kit.contracts.registry.registerAgent(
    name,
    description,
    metadata,
    capabilities
  );
  console.log(`Transaction: ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) throw new Error("Registration transaction did not return a receipt.");

  const registeredEvent = receipt.logs.find(
    (log) => log.topics[0] === kit.contracts.registry.interface.getEvent("AgentRegistered").topicHash
  );
  if (!registeredEvent) {
    throw new Error(`Registration confirmed but AgentRegistered event was not found. Tx: ${tx.hash}`);
  }

  const parsed = kit.contracts.registry.interface.parseLog({
    topics: registeredEvent.topics,
    data: registeredEvent.data,
  });
  const agentId = parsed?.args.agentId;
  if (agentId === undefined) throw new Error(`Could not decode Companion agent ID from tx ${tx.hash}.`);

  console.log("Prophecy Companion Somnia agent registered.");
  console.log(`COMPANION_SOMNIA_AGENT_ID=${agentId.toString()}`);
  console.log(`COMPANION_SOMNIA_AGENT_OWNER=${owner}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
