import "dotenv/config";
import { createPublicClient, defineChain, formatEther, getAddress, http, parseEther } from "viem";

const OFFICIAL_AGENT_PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const OFFICIAL_LLM_AGENT_ID = "12847293847561029384";
const LLM_PRICE_PER_AGENT = parseEther("0.07");
const STANDARD_SUBCOMMITTEE_SIZE = 3n;

const PLATFORM_ABI = [
  {
    name: "getRequestDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function requirePositiveInteger(name: string, value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer Somnia Agents base-agent ID.`);
  }
  return value;
}

async function main() {
  const rpcUrl = optional("SOMNIA_RPC_URL", "https://api.infra.testnet.somnia.network");
  const agentPlatform = getAddress(optional("SOMNIA_AGENT_PLATFORM_ADDRESS", OFFICIAL_AGENT_PLATFORM));
  const eveAgentId = requirePositiveInteger(
    "EVE_SOMNIA_AGENT_ID",
    optional("EVE_SOMNIA_AGENT_ID", optional("SOMNIA_LLM_AGENT_ID", OFFICIAL_LLM_AGENT_ID))
  );
  const requesterAddress = process.env.EVE_AGENT_REQUESTER_ADDRESS?.trim();

  const chain = defineChain({
    id: 50312,
    name: "Somnia Shannon Testnet",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const platformDeposit = await publicClient.readContract({
    address: agentPlatform,
    abi: PLATFORM_ABI,
    functionName: "getRequestDeposit",
  });
  const fundedRequestDeposit = platformDeposit + LLM_PRICE_PER_AGENT * STANDARD_SUBCOMMITTEE_SIZE;

  console.log("E.V.E official Somnia Agents wiring");
  console.log(`Agent platform: ${agentPlatform}`);
  console.log(`E.V.E base agent ID: ${eveAgentId}`);
  console.log(`Platform reserve floor (wei): ${platformDeposit.toString()}`);
  console.log(`LLM funded request value (wei): ${fundedRequestDeposit.toString()}`);
  console.log(`LLM funded request value (STT): ${formatEther(fundedRequestDeposit)}`);
  console.log("");
  console.log("This command does not register into the obsolete somnia-agent-kit registry.");
  console.log("Deploy the requester contract with:");
  console.log("  pnpm deploy:eve:requester:testnet");
  console.log("");
  console.log("Then set:");
  console.log(`  EVE_SOMNIA_AGENT_ID=${eveAgentId}`);
  console.log(`  NEXT_PUBLIC_EVE_SOMNIA_AGENT_ID=${eveAgentId}`);
  console.log(`  SOMNIA_AGENT_PLATFORM_ADDRESS=${agentPlatform}`);
  console.log(
    `  EVE_AGENT_REQUESTER_ADDRESS=${requesterAddress && requesterAddress.startsWith("0x") ? requesterAddress : "<deployed EVEAgentRequester address>"}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
