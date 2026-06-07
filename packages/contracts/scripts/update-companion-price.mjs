import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function readRegistryAbi() {
  const artifactPath = new URL(
    "../artifacts/contracts/SASRegistry.sol/SASRegistry.json",
    import.meta.url
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

function parseAgentId(raw) {
  if (!/^\d+$/.test(raw)) {
    throw new Error("COMPANION_CANONICAL_SAS_AGENT_ID must be a positive integer");
  }
  const id = BigInt(raw);
  if (id <= 0n) throw new Error("COMPANION_CANONICAL_SAS_AGENT_ID must be > 0");
  return id;
}

function asBool(raw, fallback = false) {
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

async function main() {
  const chain = defineChain({
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
  const abi = readRegistryAbi();

  const registryAddress =
    process.env.SAS_REGISTRY_ADDRESS?.trim() ||
    "0x25029648D4dDaE085c8db865582F43Bce2857766";
  const agentId = parseAgentId(
    process.env.COMPANION_CANONICAL_SAS_AGENT_ID?.trim() || "3"
  );
  const targetPriceSttRaw = process.env.COMPANION_AGENT_PRICE_STT?.trim();
  const targetMetadataURIRaw = process.env.COMPANION_AGENT_METADATA_URI?.trim();
  const targetDescriptionRaw = process.env.COMPANION_AGENT_DESCRIPTION?.trim();
  const dryRun = asBool(process.env.COMPANION_UPDATE_DRY_RUN?.trim(), false);

  const agent = await publicClient.readContract({
    address: registryAddress,
    abi,
    functionName: "getAgent",
    args: [agentId],
  });

  const builder = agent.builder ?? agent[1];
  const name = agent.name ?? agent[2];
  const description = agent.description ?? agent[3];
  const metadataURI = agent.metadataURI ?? agent[5];
  const status = agent.status ?? agent[7];
  const currentPrice = agent.pricePerExecution ?? agent[8];
  const somniaAgentId = agent.somniaAgentId ?? agent[9];

  if (
    !builder ||
    !description ||
    !metadataURI ||
    currentPrice === undefined ||
    somniaAgentId === undefined ||
    status === undefined
  ) {
    throw new Error("Could not decode agent fields from registry response");
  }

  const targetDescription =
    targetDescriptionRaw && targetDescriptionRaw.length > 0
      ? targetDescriptionRaw
      : description;
  const targetMetadataURI =
    targetMetadataURIRaw && targetMetadataURIRaw.length > 0
      ? targetMetadataURIRaw
      : metadataURI;
  const targetPriceWei = targetPriceSttRaw
    ? parseEther(targetPriceSttRaw)
    : currentPrice;

  if (builder.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Signer ${account.address} is not builder ${builder} for agent ${agentId.toString()}`
    );
  }

  console.log("Updating Prophecy Companion listing...");
  console.log(`Registry: ${registryAddress}`);
  console.log(`AgentId: ${agentId.toString()}`);
  console.log(`Name: ${name}`);
  console.log(`Somnia agentId: ${somniaAgentId.toString()}`);
  console.log(`Status: ${status.toString()} (0=ACTIVE, 1=PAUSED, 2=DEPRECATED)`);
  console.log(`Builder: ${builder}`);
  console.log(`Current metadata URI: ${metadataURI}`);
  console.log(`Target metadata URI: ${targetMetadataURI}`);
  console.log(`Current price (wei): ${currentPrice.toString()}`);
  if (targetPriceSttRaw) {
    console.log(`Target price: ${targetPriceSttRaw} STT (${targetPriceWei.toString()} wei)`);
  } else {
    console.log("Target price: unchanged (set COMPANION_AGENT_PRICE_STT to override)");
  }

  const descriptionChanged = targetDescription !== description;
  const metadataChanged = targetMetadataURI !== metadataURI;
  const priceChanged = currentPrice !== targetPriceWei;

  if (!descriptionChanged && !metadataChanged && !priceChanged) {
    console.log("No update needed: on-chain metadata/description/price already match target.");
    return;
  }

  if (dryRun) {
    console.log("Dry run enabled. No transaction submitted.");
    return;
  }

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi,
    functionName: "updateAgent",
    args: [agentId, targetDescription, targetMetadataURI, targetPriceWei],
    account,
    chain,
  });

  console.log(`Tx submitted: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Success.");
  console.log(
    `Updated SAS agentId ${agentId.toString()} (${[
      descriptionChanged ? "description" : null,
      metadataChanged ? "metadataURI" : null,
      priceChanged ? "price" : null,
    ]
      .filter(Boolean)
      .join(", ")}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
