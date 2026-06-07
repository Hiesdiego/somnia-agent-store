import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  companionPayloadTemplateHash,
  parseMissionMetadata,
  policyHash,
  validateMissionPolicy,
} from "./autopilot-common.ts";

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

const LLM_ABI = [
  {
    name: "inferString",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const VAULT_ABI = [
  {
    name: "getMission",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "missionId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "bytes32" },
          { name: "owner", type: "address" },
          { name: "agentId", type: "uint256" },
          { name: "balance", type: "uint256" },
          { name: "spent", type: "uint256" },
          { name: "runCount", type: "uint256" },
          { name: "maxRelayerFeePerRun", type: "uint256" },
          { name: "minCadenceSeconds", type: "uint256" },
          { name: "maxRuns", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "maxTotalSpend", type: "uint256" },
          { name: "lastExecutedAt", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "marketHash", type: "bytes32" },
          { name: "questionHash", type: "bytes32" },
          { name: "payloadTemplateHash", type: "bytes32" },
          { name: "active", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    name: "canExecute",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "missionId", type: "bytes32" },
      { name: "relayerFee", type: "uint256" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "agentFee", type: "uint256" },
      { name: "runtimeBudget", type: "uint256" },
      { name: "totalCost", type: "uint256" },
      { name: "balance", type: "uint256" },
    ],
  },
  {
    name: "executeMission",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "missionId", type: "bytes32" },
      { name: "payload", type: "bytes" },
      { name: "idempotencyKey", type: "bytes32" },
      { name: "relayerFee", type: "uint256" },
      { name: "marketHash", type: "bytes32" },
      { name: "questionHash", type: "bytes32" },
      { name: "payloadTemplateHash", type: "bytes32" },
      { name: "payloadHash", type: "bytes32" },
      { name: "contextHash", type: "bytes32" },
      { name: "runMetadataURI", type: "string" },
    ],
    outputs: [{ name: "executionId", type: "uint256" }],
  },
  {
    name: "MissionSpent",
    type: "event",
    inputs: [
      { name: "missionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "executionId", type: "uint256", indexed: false },
      { name: "agentFee", type: "uint256", indexed: false },
      { name: "runtimeBudget", type: "uint256", indexed: false },
      { name: "relayerFee", type: "uint256", indexed: false },
      { name: "remainingBalance", type: "uint256", indexed: false },
      { name: "idempotencyKey", type: "bytes32", indexed: false },
      { name: "payloadTemplateHash", type: "bytes32", indexed: false },
      { name: "payloadHash", type: "bytes32", indexed: false },
      { name: "contextHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

type Args = Record<string, string | boolean>;

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function parseArgs(): Args {
  const args: Args = {};
  const raw = process.argv.slice(2);

  for (let i = 0; i < raw.length; i++) {
    const part = raw[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = raw[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }

  return args;
}

function asString(value: string | boolean | undefined, fallback?: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error("Missing required CLI argument");
}

function normalizePrivateKey(value: string): `0x${string}` {
  return value.startsWith("0x") ? (value as `0x${string}`) : `0x${value}`;
}

function buildPrompt(input: { eventUrl: string; ask: string; extraContext: string }) {
  return [
    "You are Prophecy Companion.",
    `Analyze this Prophecy market URL: ${input.eventUrl}.`,
    `Question: ${input.ask}`,
    "Market snapshot / extra context:",
    input.extraContext || "not provided",
    "Use the Prophecy page data as crowd/context signal, not as truth.",
    "If extra context contains Structured Prophecy market records, External/source-reference evidence, or External web research evidence, use those facts directly.",
    "Do not say there is no external evidence when source-reference summaries, web research, odds pages, official pages, news pages, or market source links are present in the context.",
    "Use external evidence where available: sports form, H2H, injuries, lineups, odds, news, sentiment, macro context, or domain-specific facts.",
    "For multi-option or multi-submarket events, never answer only YES or NO. Select one exact submarket/outcome and return prediction like 'YES on Event Title: Option Name' or 'NO on Event Title: Option Name'.",
    "Treat an outcome labeled 'Other' as a bucket meaning any outcome not separately listed. Do not equate it to one named candidate unless the market explicitly defines it that way.",
    "If no submarket has a clear edge, use side WATCH and explain which exact outcome was closest, or set exactOutcomeLabel to null if none can be selected.",
    "Return selectedMarketId and exactOutcomeLabel when the context contains marketId or Outcome option fields.",
    "For edge: if prediction is YES, edge = modelProbability - marketProbability. If prediction is NO, edge = (1 - modelProbability) - (1 - marketProbability). If marketProbability is unknown, set edge to null.",
    "Return only valid JSON with keys: prediction, side, exactOutcomeLabel, selectedMarketId, probability, modelProbability, marketProbability, edge, confidence, opportunityScore, resolutionClarity, riskLevel, reasoning, marketStructure, resolutionCriteria, marketSummary, keyEvidence, counterEvidence, crowdSignal, externalEvidenceSummary, uncertaintyDrivers, risks, suggestedUserAction, sourcesUsed.",
    "Do not include markdown or code fences.",
  ].join("\n");
}

async function fetchAppContext(eventUrl: string) {
  const endpoint = optional("COMPANION_APP_CONTEXT_ENDPOINT");
  if (!endpoint) return "";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: eventUrl }),
  });
  if (!response.ok) return "";

  const data = (await response.json()) as { context?: unknown };
  return typeof data.context === "string" ? data.context : "";
}

async function main() {
  const args = parseArgs();
  const missionId = asString(args.mission ?? args.missionId) as `0x${string}`;
  const eventUrl = asString(args.url ?? args.eventUrl, optional("COMPANION_EVENT_URL"));
  const ask = asString(
    args.ask,
    optional("COMPANION_DEFAULT_ASK") ??
      "Based on current evidence and the market's own resolution criteria, what is the most likely outcome?"
  );
  const manualContext = asString(args.context, optional("COMPANION_EXTRA_CONTEXT") ?? "");
  const fetchedContext = await fetchAppContext(eventUrl);
  const extraContext = [manualContext, fetchedContext].filter(Boolean).join("\n\n");

  const rpcUrl = optional("SOMNIA_RPC_URL") ?? "https://api.infra.testnet.somnia.network";
  const vaultAddress = required("AUTOPILOT_VAULT_ADDRESS") as `0x${string}`;
  const privateKey = normalizePrivateKey(optional("RELAYER_PRIVATE_KEY") ?? required("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const chain = { ...somniaTestnet, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const idempotencyKey = (typeof args.key === "string"
    ? args.key
    : keccak256(toBytes(`${missionId}:${eventUrl}:${Math.floor(Date.now() / 60_000)}`))) as `0x${string}`;
  const relayerFee = parseEther(asString(args.relayerFee, optional("AUTOPILOT_RELAYER_FEE_STT") ?? "0"));
  const mission = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getMission",
    args: [missionId],
  });
  const policy = validateMissionPolicy({
    metadata: parseMissionMetadata(mission.metadataURI),
    mission,
    relayerFee,
  });
  if (!policy.ok) {
    throw new Error(`Mission policy rejected execution: ${policy.reason ?? "unknown"}`);
  }
  if (policy.url && policy.url !== eventUrl) {
    throw new Error("Mission policy URL does not match requested execution URL.");
  }
  const question = policy.question || ask;
  const marketHash = policyHash(eventUrl);
  const questionHash = policyHash(question);
  const payloadTemplateHash = companionPayloadTemplateHash();
  const payload = encodeFunctionData({
    abi: LLM_ABI,
    functionName: "inferString",
    args: [
      buildPrompt({ eventUrl, ask: question, extraContext }),
      "You are a prediction analysis assistant for Prophecy markets.",
      false,
      [],
    ],
  });
  const payloadHash = keccak256(payload);
  const contextHash = policyHash(extraContext);
  const [canExecute, , , totalCost] = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "canExecute",
    args: [missionId, relayerFee],
  });
  if (!canExecute) {
    throw new Error("Vault reports mission cannot execute with the requested relayer fee.");
  }
  const maxTotalSpend = parseMissionMetadata(mission.metadataURI)?.maxTotalSpendWei;
  if (maxTotalSpend && mission.spent + totalCost > BigInt(maxTotalSpend)) {
    throw new Error("Mission policy max total spend would be exceeded.");
  }
  const runMetadataURI = JSON.stringify({
    app: "Prophecy Companion",
    eventUrl,
    generatedAt: new Date().toISOString(),
    contextBytes: extraContext.length,
    payloadTemplateHash,
    payloadHash,
    contextHash,
  });

  console.log("[AutopilotRelayer] Executing mission", {
    vaultAddress,
    missionId,
    relayer: account.address,
    eventUrl,
    relayerFee: relayerFee.toString(),
    idempotencyKey,
  });

  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "executeMission",
    args: [
      missionId,
      payload,
      idempotencyKey,
      relayerFee,
      marketHash,
      questionHash,
      payloadTemplateHash,
      payloadHash,
      contextHash,
      runMetadataURI,
    ],
  });
  console.log(`[AutopilotRelayer] Tx submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let executionId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "MissionSpent") {
        executionId = decoded.args.executionId;
        console.log("[AutopilotRelayer] Mission spent", {
          executionId: decoded.args.executionId.toString(),
          agentFee: decoded.args.agentFee.toString(),
          runtimeBudget: decoded.args.runtimeBudget.toString(),
          relayerFee: decoded.args.relayerFee.toString(),
          remainingBalance: decoded.args.remainingBalance.toString(),
          payloadHash: decoded.args.payloadHash,
          contextHash: decoded.args.contextHash,
        });
      }
    } catch {
      // ignore unrelated logs
    }
  }

  if (!executionId) {
    console.warn("[AutopilotRelayer] Tx confirmed but MissionSpent was not found in logs.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
