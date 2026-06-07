import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_TESTNET_TIMELOCK = "0x8915F4919F6a2031A6aba16D9AAe639BE209b23b";
const DEFAULT_TESTNET_REGISTRY = "0x25029648D4dDaE085c8db865582F43Bce2857766";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || undefined;
}

function readArtifactAbi(relativePath) {
  const artifactPath = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(artifactPath, "utf8")).abi;
}

function parseAgentId(raw) {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("SAS_AGENT_ID must be a positive integer");
  }
  return BigInt(raw);
}

function parseBool(raw) {
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

async function main() {
  const chain = defineChain({
    id: 50312,
    name: "Somnia Shannon Testnet",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  });
  const account = privateKeyToAccount(
    required("DEPLOYER_PRIVATE_KEY").startsWith("0x")
      ? required("DEPLOYER_PRIVATE_KEY")
      : `0x${required("DEPLOYER_PRIVATE_KEY")}`
  );
  const registryAddress = getAddress(optional("SAS_REGISTRY_ADDRESS") || DEFAULT_TESTNET_REGISTRY);
  const timelockAddress = getAddress(optional("SAS_ADMIN_TIMELOCK_ADDRESS") || DEFAULT_TESTNET_TIMELOCK);
  const agentId = parseAgentId(required("SAS_AGENT_ID"));
  const verified = parseBool(optional("SAS_AGENT_VERIFIED"));
  const registryAbi = readArtifactAbi("../artifacts/contracts/SASRegistry.sol/SASRegistry.json");
  const timelockAbi = readArtifactAbi("../artifacts/contracts/SASAdminTimelock.sol/SASAdminTimelock.json");
  const transport = http(chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "setAgentVerified",
    args: [agentId, verified],
  });
  const predecessor = zeroHash;
  const salt = keccak256(stringToHex(`sas-agent-verified:${agentId.toString()}:${verified}`));
  const minDelay = await publicClient.readContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "getMinDelay",
  });
  const operationId = await publicClient.readContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "hashOperation",
    args: [registryAddress, 0n, data, predecessor, salt],
  });
  const isDone = await publicClient.readContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "isOperationDone",
    args: [operationId],
  });
  const isPending = await publicClient.readContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "isOperationPending",
    args: [operationId],
  });
  const isReady = await publicClient.readContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "isOperationReady",
    args: [operationId],
  });

  console.log("SAS trust badge timelock operation");
  console.log(`Agent: ${agentId.toString()}`);
  console.log(`Verified: ${verified}`);
  console.log(`Timelock: ${timelockAddress}`);
  console.log(`Registry: ${registryAddress}`);
  console.log(`Operation: ${operationId}`);
  console.log(`Min delay: ${minDelay.toString()}s`);

  if (isDone) {
    console.log("Operation already executed.");
    return;
  }

  if (!isPending && !isReady) {
    const hash = await walletClient.writeContract({
      address: timelockAddress,
      abi: timelockAbi,
      functionName: "schedule",
      args: [registryAddress, 0n, data, predecessor, salt, minDelay],
      account,
      chain,
    });
    console.log(`Scheduled tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Scheduled. Execute after the timelock delay.");
    return;
  }

  if (!isReady) {
    console.log("Operation is pending but not ready yet.");
    return;
  }

  const hash = await walletClient.writeContract({
    address: timelockAddress,
    abi: timelockAbi,
    functionName: "execute",
    args: [registryAddress, 0n, data, predecessor, salt],
    account,
    chain,
  });
  console.log(`Executed tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Success.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
