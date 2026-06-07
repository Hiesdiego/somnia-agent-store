import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_RPC_URL = "https://dream-rpc.somnia.network";
const DEFAULT_REQUESTER = "0x0d33089cae750fbff1ae75ce97e49b005303eebd";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey() {
  const value = required("DEPLOYER_PRIVATE_KEY");
  return value.startsWith("0x") ? value : `0x${value}`;
}

function statusName(status) {
  return ["None", "Pending", "Success", "Failed", "TimedOut"][Number(status)] ?? String(status);
}

async function main() {
  const rpcUrl = process.env.EVE_TEST_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const requester = getAddress(process.env.EVE_AGENT_REQUESTER_ADDRESS?.trim() || DEFAULT_REQUESTER);
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Audit the current SAS EVE deployment wiring. Return JSON with status, risks, and next_admin_actions.";

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

  const [owner, requiredValue, balance] = await Promise.all([
    publicClient.readContract({ address: requester, abi: artifact.abi, functionName: "owner" }),
    publicClient.readContract({ address: requester, abi: artifact.abi, functionName: "getRequiredDeposit" }),
    publicClient.getBalance({ address: account.address }),
  ]);

  console.log(`requester=${requester}`);
  console.log(`signer=${account.address}`);
  console.log(`owner=${owner}`);
  console.log(`requiredValue=${formatEther(requiredValue)} STT`);
  console.log(`signerBalance=${formatEther(balance)} STT`);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Signer is not the EVEAgentRequester owner");
  }
  if (balance <= requiredValue) {
    throw new Error("Signer balance is too low for the funded EVE request plus gas");
  }

  const hash = await walletClient.writeContract({
    address: requester,
    abi: artifact.abi,
    functionName: "requestGovernanceReport",
    args: [prompt],
    value: requiredValue,
    account,
  });
  console.log(`requestTx=${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`requestTxStatus=${receipt.status}`);
  if (receipt.status !== "success") {
    throw new Error("Funded EVE request transaction failed");
  }

  let requestId;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "EVEReportRequested") {
        requestId = decoded.args.requestId;
        break;
      }
    } catch {
      // Ignore logs from the Somnia platform.
    }
  }
  if (requestId === undefined) {
    throw new Error("EVEReportRequested event not found");
  }
  console.log(`requestId=${requestId.toString()}`);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const report = await publicClient.readContract({
      address: requester,
      abi: artifact.abi,
      functionName: "reports",
      args: [requestId],
    });
    const status = report[3];
    const result = report[2];
    console.log(`poll=${attempt + 1} status=${statusName(status)} resultLength=${result.length}`);
    if (status !== 1) {
      console.log(`result=${result}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }

  console.log("result=pending_after_poll_window");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
