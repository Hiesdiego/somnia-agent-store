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

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

export const LLM_ABI = [
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

export const VAULT_ABI = [
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
    name: "MissionCreated",
    type: "event",
    inputs: [
      { name: "missionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "maxRelayerFeePerRun", type: "uint256", indexed: false },
      { name: "minCadenceSeconds", type: "uint256", indexed: false },
      { name: "maxRuns", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "maxTotalSpend", type: "uint256", indexed: false },
      { name: "marketHash", type: "bytes32", indexed: false },
      { name: "questionHash", type: "bytes32", indexed: false },
      { name: "payloadTemplateHash", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
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

export type CliArgs = Record<string, string | boolean>;

export type AutopilotClients = ReturnType<typeof getAutopilotClients>;

export type ProphecyMissionMetadata = {
  app?: string;
  kind?: string;
  policyVersion?: number;
  watchId?: string;
  url?: string;
  eventId?: string;
  question?: string;
  agentId?: string;
  cadenceMinutes?: number;
  maxRuns?: number;
  expiresAt?: string;
  maxRelayerFeeWei?: string;
  maxTotalSpendWei?: string;
  initialFundingWei?: string;
  marketHash?: `0x${string}`;
  questionHash?: `0x${string}`;
  payloadTemplateHash?: `0x${string}`;
  createdAt?: string;
  createdBy?: string;
};

export const COMPANION_PAYLOAD_TEMPLATE_V1 = "prophecy-companion-payload-template-v1";

export function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function optionalNumber(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const raw = process.argv.slice(2).filter((part) => part !== "--");

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

export function asString(value: string | boolean | undefined, fallback?: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error("Missing required CLI argument");
}

export function normalizePrivateKey(value: string): `0x${string}` {
  return value.startsWith("0x") ? (value as `0x${string}`) : `0x${value}`;
}

export function getAutopilotClients() {
  const rpcUrl = optional("SOMNIA_RPC_URL") ?? "https://api.infra.testnet.somnia.network";
  const vaultAddress = required("AUTOPILOT_VAULT_ADDRESS") as `0x${string}`;
  const privateKey = normalizePrivateKey(optional("RELAYER_PRIVATE_KEY") ?? required("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const chain = { ...somniaTestnet, rpcUrls: { default: { http: [rpcUrl] } } };

  return {
    account,
    chain,
    publicClient: createPublicClient({ chain, transport: http(rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(rpcUrl) }),
    rpcUrl,
    vaultAddress,
  };
}

export function buildPrompt(input: { eventUrl: string; ask: string; extraContext: string }) {
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
    "For edge: if prediction is YES, edge = modelProbability - marketProbability. If prediction is NO, edge = (1 - modelProbability) - (1 - marketProbability). If marketProbability is unknown, set edge to null.",
    "Return only valid JSON with keys: prediction, probability, modelProbability, marketProbability, edge, confidence, opportunityScore, resolutionClarity, riskLevel, reasoning, resolutionCriteria, marketSummary, keyEvidence, crowdSignal, externalEvidenceSummary, risks, suggestedUserAction, sourcesUsed.",
    "Do not include markdown or code fences.",
  ].join("\n");
}

export async function fetchAppContext(eventUrl: string) {
  const endpoint = optional("COMPANION_APP_CONTEXT_ENDPOINT");
  if (!endpoint) return "";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: eventUrl }),
    });
    if (!response.ok) {
      console.warn("[AutopilotRelayer] Context endpoint returned non-OK status", {
        endpoint,
        status: response.status,
      });
      return "";
    }

    const data = (await response.json()) as { context?: unknown };
    return typeof data.context === "string" ? data.context : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[AutopilotRelayer] Context endpoint unavailable; continuing without app context", {
      endpoint,
      error: msg,
    });
    return "";
  }
}

export function buildCompanionPayload(input: { eventUrl: string; ask: string; extraContext: string }) {
  return encodeFunctionData({
    abi: LLM_ABI,
    functionName: "inferString",
    args: [
      buildPrompt(input),
      "You are a prediction analysis assistant for Prophecy markets.",
      false,
      [],
    ],
  });
}

export function extractSourceUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s)"'<>{}]+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/g, "")))].slice(0, 24);
}

export function summarizeModelInput(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{") && !line.startsWith("["))
    .slice(0, 8)
    .join(" ")
    .slice(0, 900);
}

export function buildIdempotencyKey(input: {
  missionId: `0x${string}`;
  eventUrl: string;
  scope?: string;
  cadenceMinutes?: number;
  now?: number;
}) {
  const cadenceMs = Math.max(1, input.cadenceMinutes ?? 1) * 60_000;
  const bucket = Math.floor((input.now ?? Date.now()) / cadenceMs);
  const scope = input.scope?.trim() || input.eventUrl;
  return keccak256(toBytes(`${input.missionId}:${scope}:${bucket}`));
}

export function policyHash(value: string): `0x${string}` {
  return keccak256(toBytes(value.trim()));
}

export function companionPayloadTemplateHash(): `0x${string}` {
  return policyHash(COMPANION_PAYLOAD_TEMPLATE_V1);
}

export function parseProphecyEventUrl(value: string): { valid: boolean; eventId: string | null } {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const eventIndex = parts.findIndex((part) => part === "event");
    const eventId = eventIndex >= 0 ? parts[eventIndex + 1] : null;
    const isProphecy = url.protocol === "https:" && url.hostname === "prophecy.social";
    return { valid: isProphecy && Boolean(eventId && /^\d+$/.test(eventId)), eventId };
  } catch {
    return { valid: false, eventId: null };
  }
}

export function parseMissionMetadata(value: string): ProphecyMissionMetadata | null {
  try {
    const parsed = JSON.parse(value) as ProphecyMissionMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function validateMissionPolicy(input: {
  metadata: ProphecyMissionMetadata | null;
  mission: {
    agentId: bigint;
    spent: bigint;
    runCount: bigint;
    maxRelayerFeePerRun: bigint;
    maxRuns: bigint;
    expiresAt: bigint;
    maxTotalSpend: bigint;
    marketHash: `0x${string}`;
    questionHash: `0x${string}`;
    payloadTemplateHash: `0x${string}`;
    active: boolean;
  };
  relayerFee: bigint;
  now?: number;
}): { ok: boolean; reason?: string; url?: string; question?: string; cadenceMinutes: number } {
  const metadata = input.metadata;
  if (!metadata) return { ok: false, reason: "missing or invalid mission metadata", cadenceMinutes: 15 };
  if (metadata.app !== "Prophecy Companion" || metadata.kind !== "prophecy-watch") {
    return { ok: false, reason: "not a Prophecy Companion watch mission", cadenceMinutes: 15 };
  }
  if (!input.mission.active) return { ok: false, reason: "mission inactive", cadenceMinutes: 15 };
  if (!metadata.url || typeof metadata.url !== "string") {
    return { ok: false, reason: "mission URL missing", cadenceMinutes: 15 };
  }

  const parsedUrl = parseProphecyEventUrl(metadata.url);
  if (!parsedUrl.valid || !parsedUrl.eventId) {
    return { ok: false, reason: "mission URL is not a valid Prophecy event", cadenceMinutes: 15 };
  }
  if (metadata.eventId && metadata.eventId !== parsedUrl.eventId) {
    return { ok: false, reason: "mission event id does not match URL", cadenceMinutes: 15 };
  }
  const expectedMarketHash = policyHash(metadata.url);
  const question = metadata.question?.trim() || "";
  const expectedQuestionHash = policyHash(question);
  if (input.mission.marketHash !== expectedMarketHash || (metadata.marketHash && metadata.marketHash !== expectedMarketHash)) {
    return { ok: false, reason: "mission market hash mismatch", cadenceMinutes: 15 };
  }
  if (
    input.mission.questionHash !== expectedQuestionHash ||
    (metadata.questionHash && metadata.questionHash !== expectedQuestionHash)
  ) {
    return { ok: false, reason: "mission question hash mismatch", cadenceMinutes: 15 };
  }
  const expectedTemplateHash = companionPayloadTemplateHash();
  if (
    input.mission.payloadTemplateHash !== expectedTemplateHash ||
    !metadata.payloadTemplateHash ||
    metadata.payloadTemplateHash !== expectedTemplateHash
  ) {
    return { ok: false, reason: "mission payload template hash mismatch", cadenceMinutes: 15 };
  }
  try {
    if (metadata.agentId && BigInt(metadata.agentId) !== input.mission.agentId) {
      return { ok: false, reason: "mission agent policy does not match vault agent", cadenceMinutes: 15 };
    }
    if (metadata.maxRelayerFeeWei && input.relayerFee > BigInt(metadata.maxRelayerFeeWei)) {
      return { ok: false, reason: "requested relayer fee exceeds mission policy", cadenceMinutes: 15 };
    }
    if (metadata.maxRuns === undefined || BigInt(Math.max(1, Number(metadata.maxRuns))) !== input.mission.maxRuns) {
      return { ok: false, reason: "mission max runs policy does not match vault", cadenceMinutes: 15 };
    }
    if (!metadata.maxTotalSpendWei || BigInt(metadata.maxTotalSpendWei) !== input.mission.maxTotalSpend) {
      return { ok: false, reason: "mission spend cap policy does not match vault", cadenceMinutes: 15 };
    }
  } catch {
    return { ok: false, reason: "mission numeric policy is invalid", cadenceMinutes: 15 };
  }
  if (input.relayerFee > input.mission.maxRelayerFeePerRun) {
    return { ok: false, reason: "requested relayer fee exceeds vault cap", cadenceMinutes: 15 };
  }

  if (input.mission.runCount >= input.mission.maxRuns) {
    return { ok: false, reason: "mission max run count reached", cadenceMinutes: 15 };
  }

  const expiresAt = metadata.expiresAt ? Date.parse(metadata.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || BigInt(Math.floor(expiresAt / 1000)) !== input.mission.expiresAt) {
    return { ok: false, reason: "mission expiry policy does not match vault", cadenceMinutes: 15 };
  }
  if (BigInt(Math.floor((input.now ?? Date.now()) / 1000)) > input.mission.expiresAt) {
    return { ok: false, reason: "mission policy expired", cadenceMinutes: 15 };
  }

  if (input.mission.spent >= input.mission.maxTotalSpend) {
    return { ok: false, reason: "mission max total spend reached", cadenceMinutes: 15 };
  }

  const cadenceMinutes = Number.isFinite(metadata.cadenceMinutes)
    ? Math.max(5, Number(metadata.cadenceMinutes))
    : 15;

  return {
    ok: true,
    url: metadata.url,
    question,
    cadenceMinutes,
  };
}

export async function executeMission(input: {
  clients: AutopilotClients;
  missionId: `0x${string}`;
  eventUrl: string;
  ask: string;
  question?: string;
  extraContext?: string;
  skipAppContextFetch?: boolean;
  relayerFeeStt?: string;
  idempotencyKey?: `0x${string}`;
  idempotencyScope?: string;
  cadenceMinutes?: number;
}) {
  const fetchedContext = input.skipAppContextFetch ? "" : await fetchAppContext(input.eventUrl);
  const extraContext = [input.extraContext ?? "", fetchedContext].filter(Boolean).join("\n\n");
  const payload = buildCompanionPayload({
    eventUrl: input.eventUrl,
    ask: input.ask,
    extraContext,
  });
  const idempotencyKey =
    input.idempotencyKey ??
    buildIdempotencyKey({
      missionId: input.missionId,
      eventUrl: input.eventUrl,
      scope: input.idempotencyScope,
      cadenceMinutes: input.cadenceMinutes,
    });
  const relayerFee = parseEther(input.relayerFeeStt ?? optional("AUTOPILOT_RELAYER_FEE_STT") ?? "0");
  const marketHash = policyHash(input.eventUrl);
  const questionHash = policyHash(input.question ?? input.ask);
  const payloadTemplateHash = companionPayloadTemplateHash();
  const payloadHash = keccak256(payload);
  const contextHash = policyHash(extraContext);
  const prophecySnapshotHash = policyHash(`${input.eventUrl}\n${extraContext}`);
  const sourceUrls = extractSourceUrls(extraContext);
  const modelInputSummary = summarizeModelInput(extraContext);
  const runMetadataURI = JSON.stringify({
    app: "Prophecy Companion",
    eventUrl: input.eventUrl,
    generatedAt: new Date().toISOString(),
    contextBytes: extraContext.length,
    payloadTemplateHash,
    payloadHash,
    contextHash,
  });

  const hash = await input.clients.walletClient.writeContract({
    address: input.clients.vaultAddress,
    abi: VAULT_ABI,
    functionName: "executeMission",
    args: [
      input.missionId,
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

  const receipt = await input.clients.publicClient.waitForTransactionReceipt({ hash });
  let executionId: bigint | null = null;
  let remainingBalance: bigint | null = null;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "MissionSpent") {
        executionId = decoded.args.executionId;
        remainingBalance = decoded.args.remainingBalance;
      }
    } catch {
      // ignore unrelated logs
    }
  }

  return {
    hash,
    executionId,
    remainingBalance,
    idempotencyKey,
    relayerFee,
    payloadHash,
    contextHash,
    payloadTemplateHash,
    prophecySnapshotHash,
    sourceUrls,
    modelInputSummary,
    contextBytes: extraContext.length,
    contextRaw: extraContext,
  };
}
