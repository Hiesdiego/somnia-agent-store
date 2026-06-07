import "dotenv/config";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

function canonicalId() {
  const raw = required("COMPANION_CANONICAL_SAS_AGENT_ID");
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("COMPANION_CANONICAL_SAS_AGENT_ID must be a positive integer");
  }
  return BigInt(raw);
}

function shouldTreatAsCompanion(agent) {
  const text = `${agent.name} ${agent.description} ${agent.category} ${agent.metadataURI}`.toLowerCase();
  return text.includes("prophecy companion") || text.includes("predire") || text.includes("prediction");
}

async function main() {
  const chain = defineChain({
    id: 50312,
    name: "Somnia Shannon Testnet",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  });

  const rawPrivateKey = required("DEPLOYER_PRIVATE_KEY");
  const account = privateKeyToAccount(rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`);
  const registryAddress = process.env.SAS_REGISTRY_ADDRESS?.trim() || "0x25029648D4dDaE085c8db865582F43Bce2857766";
  const keepId = canonicalId();
  const dryRun = process.env.CLEANUP_DRY_RUN !== "false";
  const abi = readRegistryAbi();
  const transport = http(chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const agents = await publicClient.readContract({
    address: registryAddress,
    abi,
    functionName: "getAllActiveAgents",
  });

  const stale = agents.filter((agent) => agent.id !== keepId && shouldTreatAsCompanion(agent));

  console.log(`Registry: ${registryAddress}`);
  console.log(`Canonical SAS agentId: ${keepId.toString()}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Found ${stale.length} stale Companion-like active listing(s).`);

  for (const agent of stale) {
    console.log(`- #${agent.id.toString()} ${agent.name} | Somnia #${agent.somniaAgentId.toString()}`);
    if (dryRun) continue;

    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi,
      functionName: "adminDeprecateAgent",
      args: [agent.id],
      account,
      chain,
    });
    console.log(`  deprecated tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  if (dryRun) {
    console.log("");
    console.log("Dry run only. To deprecate stale listings, set CLEANUP_DRY_RUN=false and rerun.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
