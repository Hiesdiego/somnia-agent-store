import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const AGENT_TYPE = {
  LLM_INFERENCE: 0,
  JSON_API: 1,
  WEBSITE_PARSE: 2,
  CUSTOM_OFFCHAIN: 3,
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function readRegistryAbi() {
  const artifactPath = new URL("../artifacts/contracts/SASRegistry.sol/SASRegistry.json", import.meta.url);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

function parseSomniaAgentId(raw) {
  if (!/^\d+$/.test(raw)) {
    throw new Error("COMPANION_SOMNIA_AGENT_ID must be a positive integer string");
  }
  const id = BigInt(raw);
  if (id <= 0n) throw new Error("COMPANION_SOMNIA_AGENT_ID must be > 0");
  return id;
}

async function main() {
  const target = (process.env.COMPANION_TARGET_NETWORK ?? "testnet").toLowerCase();
  const chain =
    target === "mainnet"
      ? defineChain({
          id: 5031,
          name: "Somnia Mainnet",
          nativeCurrency: { name: "SOMNIA", symbol: "SOMNIA", decimals: 18 },
          rpcUrls: { default: { http: ["https://api.infra.mainnet.somnia.network"] } },
        })
      : defineChain({
          id: 50312,
          name: "Somnia Shannon Testnet",
          nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
          rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
        });

  const rawPrivateKey = required("DEPLOYER_PRIVATE_KEY");
  const privateKey = rawPrivateKey.startsWith("0x")
    ? rawPrivateKey
    : `0x${rawPrivateKey}`;

  const account = privateKeyToAccount(privateKey);
  const transport = http(chain.rpcUrls.default.http[0]);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const registryAddress =
    (process.env.SAS_REGISTRY_ADDRESS?.trim() ||
      "0x25029648D4dDaE085c8db865582F43Bce2857766");

  const agentName = process.env.COMPANION_AGENT_NAME?.trim() || "Prophecy Companion Agent";
  const agentDescription =
    process.env.COMPANION_AGENT_DESCRIPTION?.trim() ||
    "Analyzes Somnia Prophecy markets with probability, confidence and reasoning.";
  const agentCategory = process.env.COMPANION_AGENT_CATEGORY?.trim() || "Prediction";
  const metadataURI =
    process.env.COMPANION_AGENT_METADATA_URI?.trim() ||
    "ipfs://prophecy-companion-agent-v1";
  const priceStt = process.env.COMPANION_AGENT_PRICE_STT?.trim() || "0.02";
  const agentTypeName = (process.env.COMPANION_AGENT_TYPE?.trim() || "LLM_INFERENCE").toUpperCase();
  const agentType = AGENT_TYPE[agentTypeName];
  if (agentType === undefined) {
    throw new Error("COMPANION_AGENT_TYPE must be one of: LLM_INFERENCE, JSON_API, WEBSITE_PARSE");
  }
  if (agentType === AGENT_TYPE.CUSTOM_OFFCHAIN) {
    throw new Error("Prophecy Companion requires direct Somnia flow. CUSTOM_OFFCHAIN is not allowed.");
  }

  const somniaAgentId = parseSomniaAgentId(required("COMPANION_SOMNIA_AGENT_ID"));
  const pricePerExecution = parseEther(priceStt);
  const abi = readRegistryAbi();

  console.log("Registering Prophecy Companion listing...");
  console.log(`Network: ${chain.name} (${chain.id})`);
  console.log(`Registry: ${registryAddress}`);
  console.log(`Builder: ${account.address}`);
  console.log(`Somnia agent id: ${somniaAgentId.toString()}`);
  console.log(`Type: ${agentTypeName} (${agentType})`);
  console.log(`Price: ${priceStt} STT`);

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi,
    functionName: "registerAgent",
    args: [
      agentName,
      agentDescription,
      agentCategory,
      metadataURI,
      agentType,
      pricePerExecution,
      somniaAgentId,
    ],
    account,
    chain,
  });

  console.log(`Tx submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let sasAgentId = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "AgentRegistered") {
        sasAgentId = decoded.args.agentId;
        break;
      }
    } catch {
      // ignore non-registry logs
    }
  }

  if (sasAgentId === null) {
    console.log("Registered but could not decode agentId from logs.");
    console.log("Check registry events on explorer.");
    return;
  }

  console.log("Success.");
  console.log(`SAS agentId: ${sasAgentId.toString()}`);
  console.log("");
  console.log("Set these in packages/predire-app/.env:");
  console.log(`NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=${sasAgentId.toString()}`);
  console.log(`NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID=${somniaAgentId.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
