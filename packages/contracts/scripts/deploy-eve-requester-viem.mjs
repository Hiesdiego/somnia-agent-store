import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, defineChain, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_RPC_URL = "https://dream-rpc.somnia.network";
const DEFAULT_AGENT_PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const DEFAULT_LLM_AGENT_ID = 12847293847561029384n;
const DEFAULT_SYSTEM_PROMPT =
  "You are Agent E.V.E, a concise SAS governance auditor. Return operational findings, risks, and recommended admin actions as JSON.";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey() {
  const value = required("DEPLOYER_PRIVATE_KEY");
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function main() {
  const rpcUrl = process.env.EVE_TEST_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const agentPlatform = getAddress(process.env.SOMNIA_AGENT_PLATFORM_ADDRESS?.trim() || DEFAULT_AGENT_PLATFORM);
  const eveAgentId = BigInt(process.env.EVE_SOMNIA_AGENT_ID?.trim() || process.env.SOMNIA_LLM_AGENT_ID?.trim() || DEFAULT_LLM_AGENT_ID);
  const systemPrompt = process.env.EVE_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;

  const chain = defineChain({
    id: 50312,
    name: "Somnia Shannon Testnet",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = privateKeyToAccount(privateKey());
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const artifact = JSON.parse(
    await readFile(new URL("../artifacts/contracts/EVEAgentRequester.sol/EVEAgentRequester.json", import.meta.url), "utf8")
  );

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [account.address, agentPlatform, eveAgentId, systemPrompt],
    account,
  });
  console.log(`deployTx=${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`EVEAgentRequester deployment failed: ${receipt.status}`);
  }

  console.log(`EVE_AGENT_REQUESTER_ADDRESS=${receipt.contractAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
