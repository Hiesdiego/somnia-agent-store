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

function parseAgentId(raw) {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("SAS_AGENT_ID must be a positive integer");
  }
  return BigInt(raw);
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
  const agentId = parseAgentId(required("SAS_AGENT_ID"));
  const abi = readRegistryAbi();
  const transport = http(chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const agent = await publicClient.readContract({
    address: registryAddress,
    abi,
    functionName: "getAgent",
    args: [agentId],
  });
  if (agent.builder.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not builder ${agent.builder} for agent ${agentId.toString()}`);
  }

  console.log(`Deprecating SAS agent #${agentId.toString()} (${agent.name})`);
  console.log(`Registry: ${registryAddress}`);
  console.log(`Builder: ${account.address}`);

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi,
    functionName: "deprecateAgent",
    args: [agentId],
    account,
    chain,
  });
  console.log(`Tx submitted: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Success.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
