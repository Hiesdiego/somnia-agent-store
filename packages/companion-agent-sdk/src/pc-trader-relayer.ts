import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeEventLog, keccak256, parseEther, toBytes } from "viem";
import {
  VAULT_ABI,
  buildCompanionPayload,
  companionPayloadTemplateHash,
  getAutopilotClients,
  optional,
  optionalNumber,
  parseArgs,
  parseMissionMetadata,
  policyHash,
  summarizeModelInput,
} from "./autopilot-common.ts";
import { startServiceHealthServer } from "./service-health.ts";

type TraderState = {
  missionIds: `0x${string}`[];
  lastScannedBlock: string;
  lastRunAt: Record<string, number>;
};

type TraderMetadata = {
  app?: string;
  kind?: string;
  policyVersion?: number;
  strategyId?: string;
  strategyHash?: `0x${string}`;
  capitalUsd?: number;
  targetReturnPct?: number;
  horizonDays?: number;
  cadenceMinutes?: number;
  maxRuns?: number;
  expiresAt?: string;
  maxRelayerFeeWei?: string;
  maxTotalSpendWei?: string;
  initialFundingWei?: string;
  agentId?: string;
  marketHash?: `0x${string}`;
  questionHash?: `0x${string}`;
  payloadTemplateHash?: `0x${string}`;
  riskPolicy?: Record<string, unknown>;
  createdAt?: string;
  createdBy?: string;
};

type TraderCandidate = {
  eventId: string;
  url: string;
  marketId?: number;
  title?: string;
  status?: string;
  marketProbability?: number;
  closeTs?: string;
  scoutReason?: string;
  context?: string;
};

type TraderPositionRow = {
  id: string;
  mission_id: string;
  status: string;
  stake_usd: number | string | null;
  balance_after_usd: number | string | null;
  expected_return_pct: number | string | null;
  realized_return_pct: number | string | null;
};

type TraderDecisionMetrics = {
  modelProbability: number | null;
  marketProbability: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  expectedReturnPct: number | null;
  stakeUsd: number;
  balanceBeforeUsd: number;
};

const DEFAULT_FROM_BLOCK = 389298380n;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

function statePath() {
  return resolve(optional("PC_TRADER_STATE_FILE") ?? ".pc-trader-relayer-state.json");
}

function loadState(): TraderState {
  const fallback: TraderState = { missionIds: [], lastScannedBlock: "0", lastRunAt: {} };
  const file = statePath();
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<TraderState>;
    return {
      missionIds: parsed.missionIds ?? [],
      lastScannedBlock: parsed.lastScannedBlock ?? "0",
      lastRunAt: parsed.lastRunAt ?? {},
    };
  } catch {
    return fallback;
  }
}

function saveState(state: TraderState) {
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function wait(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function logStep(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "pc-trader-relayer",
    event,
    ...data,
  }));
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function iso(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function hashId(...parts: unknown[]) {
  return keccak256(toBytes(parts.map((part) => String(part)).join(":")));
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function strategyQuestion(metadata: TraderMetadata) {
  return [
    "PC autonomous trader strategy",
    `capitalUsd=${metadata.capitalUsd}`,
    `targetReturnPct=${metadata.targetReturnPct}`,
    `horizonDays=${metadata.horizonDays}`,
    `strategyHash=${metadata.strategyHash}`,
  ].join("|");
}

function expectedStrategyHash(metadata: TraderMetadata) {
  return policyHash(
    JSON.stringify({
      capitalUsd: metadata.capitalUsd,
      targetReturnPct: metadata.targetReturnPct,
      horizonDays: metadata.horizonDays,
      riskPolicy: metadata.riskPolicy ?? {},
    })
  );
}

function validateTraderMetadata(input: {
  metadata: TraderMetadata | null;
  mission: {
    owner: `0x${string}`;
    agentId: bigint;
    active: boolean;
    spent: bigint;
    runCount: bigint;
    maxRelayerFeePerRun: bigint;
    maxRuns: bigint;
    expiresAt: bigint;
    maxTotalSpend: bigint;
    marketHash: `0x${string}`;
    questionHash: `0x${string}`;
    payloadTemplateHash: `0x${string}`;
  };
  relayerFee: bigint;
  now?: number;
}): { ok: boolean; reason?: string; metadata?: TraderMetadata; cadenceMinutes: number } {
  const metadata = input.metadata;
  if (!metadata) return { ok: false, reason: "missing metadata", cadenceMinutes: 15 };
  if (metadata.app !== "Prophecy Companion" || metadata.kind !== "pc-trader-strategy-v1") {
    return { ok: false, reason: "not a PC trader strategy", cadenceMinutes: 15 };
  }
  if (!input.mission.active) return { ok: false, reason: "mission inactive", cadenceMinutes: 15 };
  if (!Number.isFinite(metadata.capitalUsd) || Number(metadata.capitalUsd) <= 0) {
    return { ok: false, reason: "invalid strategy capital", cadenceMinutes: 15 };
  }
  if (!Number.isFinite(metadata.targetReturnPct) || Number(metadata.targetReturnPct) <= 0) {
    return { ok: false, reason: "invalid target return", cadenceMinutes: 15 };
  }
  if (!Number.isFinite(metadata.horizonDays) || Number(metadata.horizonDays) <= 0) {
    return { ok: false, reason: "invalid horizon", cadenceMinutes: 15 };
  }

  const expectedHash = expectedStrategyHash(metadata);
  const expectedQuestionHash = policyHash(strategyQuestion(metadata));
  const expectedTemplateHash = companionPayloadTemplateHash();
  if (metadata.strategyHash !== expectedHash || metadata.marketHash !== expectedHash || input.mission.marketHash !== expectedHash) {
    return { ok: false, reason: "strategy hash mismatch", cadenceMinutes: 15 };
  }
  if (metadata.questionHash !== expectedQuestionHash || input.mission.questionHash !== expectedQuestionHash) {
    return { ok: false, reason: "strategy question hash mismatch", cadenceMinutes: 15 };
  }
  if (metadata.payloadTemplateHash !== expectedTemplateHash || input.mission.payloadTemplateHash !== expectedTemplateHash) {
    return { ok: false, reason: "payload template hash mismatch", cadenceMinutes: 15 };
  }

  try {
    if (metadata.agentId && BigInt(metadata.agentId) !== input.mission.agentId) {
      return { ok: false, reason: "agent mismatch", cadenceMinutes: 15 };
    }
    if (metadata.maxRelayerFeeWei && input.relayerFee > BigInt(metadata.maxRelayerFeeWei)) {
      return { ok: false, reason: "relayer fee exceeds metadata cap", cadenceMinutes: 15 };
    }
    if (metadata.maxRuns === undefined || BigInt(Math.max(1, Number(metadata.maxRuns))) !== input.mission.maxRuns) {
      return { ok: false, reason: "max run policy mismatch", cadenceMinutes: 15 };
    }
    if (!metadata.maxTotalSpendWei || BigInt(metadata.maxTotalSpendWei) !== input.mission.maxTotalSpend) {
      return { ok: false, reason: "spend cap mismatch", cadenceMinutes: 15 };
    }
  } catch {
    return { ok: false, reason: "numeric policy invalid", cadenceMinutes: 15 };
  }

  if (input.relayerFee > input.mission.maxRelayerFeePerRun) {
    return { ok: false, reason: "relayer fee exceeds vault cap", cadenceMinutes: 15 };
  }
  if (input.mission.runCount >= input.mission.maxRuns) {
    return { ok: false, reason: "max run count reached", cadenceMinutes: 15 };
  }
  if (input.mission.spent >= input.mission.maxTotalSpend) {
    return { ok: false, reason: "max total spend reached", cadenceMinutes: 15 };
  }

  const expiresAt = metadata.expiresAt ? Date.parse(metadata.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || BigInt(Math.floor(expiresAt / 1000)) !== input.mission.expiresAt) {
    return { ok: false, reason: "expiry mismatch", cadenceMinutes: 15 };
  }
  if (BigInt(Math.floor((input.now ?? Date.now()) / 1000)) > input.mission.expiresAt) {
    return { ok: false, reason: "strategy period ended", cadenceMinutes: 15 };
  }

  return {
    ok: true,
    metadata,
    cadenceMinutes: Number.isFinite(metadata.cadenceMinutes) ? Math.max(5, Number(metadata.cadenceMinutes)) : 15,
  };
}

class SupabaseClient {
  private readonly base: string;
  private readonly key: string;
  private readonly schema: string;

  constructor() {
    this.base = required("SUPABASE_URL").replace(/\/+$/, "");
    this.key = required("SUPABASE_SERVICE_ROLE_KEY");
    this.schema = optional("SUPABASE_SCHEMA") ?? "public";
  }

  private headers(prefer?: string) {
    return {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      "content-type": "application/json",
      "accept-profile": this.schema,
      "content-profile": this.schema,
      ...(prefer ? { prefer } : {}),
    };
  }

  async select<T>(table: string, query: string): Promise<T[]> {
    const response = await fetch(`${this.base}/rest/v1/${table}?${query}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error(`Supabase SELECT ${table} failed (${response.status}): ${await response.text()}`);
    return (await response.json()) as T[];
  }

  async upsert(table: string, rows: Record<string, unknown>[], conflict: string) {
    const response = await fetch(`${this.base}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: this.headers("resolution=merge-duplicates"),
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`Supabase UPSERT ${table} failed (${response.status}): ${await response.text()}`);
  }
}

async function discoverMissionIds(
  clients: ReturnType<typeof getAutopilotClients>,
  state: TraderState,
  persist: boolean
) {
  const configuredStart = BigInt(optional("AUTOPILOT_SCAN_FROM_BLOCK") ?? DEFAULT_FROM_BLOCK.toString());
  const previousCursor = BigInt(state.lastScannedBlock || "0");
  let fromBlock = previousCursor > 0n ? previousCursor + 1n : configuredStart;
  const latest = await clients.publicClient.getBlockNumber();
  const chunkSize = BigInt(Math.max(1, optionalNumber("AUTOPILOT_LOG_CHUNK_SIZE", 900)));
  const ids = new Set<`0x${string}`>(state.missionIds);

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize - 1n > latest ? latest : fromBlock + chunkSize - 1n;
    const logs = await clients.publicClient.getLogs({ address: clients.vaultAddress, fromBlock, toBlock });
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "MissionCreated") ids.add(decoded.args.missionId);
      } catch {
        // ignore unrelated logs
      }
    }
    state.lastScannedBlock = toBlock.toString();
    state.missionIds = [...ids];
    if (persist) saveState(state);
    fromBlock = toBlock + 1n;
  }
  return [...ids];
}

async function fetchCandidates(metadata: TraderMetadata): Promise<TraderCandidate[]> {
  const endpoint = discoveryEndpoint();
  if (!endpoint) return [];
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objective: `Autonomous trader seeks ${metadata.targetReturnPct}% return from $${metadata.capitalUsd} over ${metadata.horizonDays} days. Find only active, tradable markets with clear resolution.`,
      limit: optionalNumber("PC_TRADER_DISCOVERY_LIMIT", 8),
      seedUrls: [],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const preview = body.replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Discovery endpoint failed (${response.status}) at ${endpoint}: ${preview}`);
  }
  const data = (await response.json()) as { candidates?: TraderCandidate[] };
  return (data.candidates ?? []).filter((candidate) => candidate.url && candidate.eventId);
}

function discoveryEndpoint(): string | null {
  const configured = optional("COMPANION_APP_DISCOVERY_ENDPOINT") ?? optional("COMPANION_APP_BASE_URL");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/api/market-discovery";
    }
    return url.toString();
  } catch {
    return configured;
  }
}

function chooseCandidate(candidates: TraderCandidate[]) {
  return candidates.find((candidate) => candidate.status?.toLowerCase() !== "settled" && hasExactOutcomeLabel(candidate)) ?? null;
}

function contextValue(candidate: TraderCandidate, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = candidate.context?.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function isGenericMultiOutcomeTitle(value: string | undefined): boolean {
  if (!value) return false;
  return /^(who|which|what)\b/i.test(value.trim()) || /\bwho will win\b/i.test(value);
}

function exactOutcomeTitle(candidate: TraderCandidate): string | null {
  const title = candidate.title?.trim();
  const option = contextValue(candidate, "Outcome option");
  if (title && title.includes(":")) return title;
  if (title && option && option !== title && !/^(yes|no)$/i.test(option)) return `${title}: ${option}`;
  if (title && !isGenericMultiOutcomeTitle(title)) return title;
  return null;
}

function hasExactOutcomeLabel(candidate: TraderCandidate): boolean {
  return exactOutcomeTitle(candidate) !== null;
}

async function loadStrategyPositions(supabase: SupabaseClient, missionId: `0x${string}`): Promise<TraderPositionRow[]> {
  return supabase.select<TraderPositionRow>(
    "pc_trader_positions",
    `select=id,mission_id,status,stake_usd,balance_after_usd,expected_return_pct,realized_return_pct&mission_id=eq.${missionId}&order=placed_at.asc&limit=1000`
  );
}

function currentStrategyBalance(capitalUsd: number, positions: TraderPositionRow[]): number {
  return positions.reduce((balance, position) => {
    const stake = numberValue(position.stake_usd);
    if (position.status === "open") return balance - stake;
    if (position.status === "lost") return balance - stake;
    if (position.status === "won") {
      const realized = numberValue(position.realized_return_pct, numberValue(position.expected_return_pct));
      return balance + stake * (realized / 100);
    }
    if (position.status === "void") return balance;
    if (position.balance_after_usd !== null && position.balance_after_usd !== undefined) {
      return numberValue(position.balance_after_usd, balance);
    }
    return balance;
  }, capitalUsd);
}

function deriveDecisionMetrics(
  metadata: TraderMetadata,
  candidate: TraderCandidate,
  balanceBeforeUsd: number
): TraderDecisionMetrics {
  const riskPolicy = metadata.riskPolicy ?? {};
  const minEdgePct = numberValue(riskPolicy.minEdgePct, 10);
  const minConfidencePct = numberValue(riskPolicy.minConfidencePct, 50);
  const stakeFloorPct = numberValue(riskPolicy.stakeFloorPct, 0.05);
  const stakeCeilingPct = numberValue(riskPolicy.stakeCeilingPct, 0.12);
  const marketProbability = typeof candidate.marketProbability === "number" ? candidate.marketProbability : null;
  const modelProbability = marketProbability === null
    ? null
    : clamp(marketProbability + minEdgePct / 100, 0.01, 0.99);
  const edgePct = modelProbability === null || marketProbability === null
    ? null
    : Number(((modelProbability - marketProbability) * 100).toFixed(1));
  const confidencePct = Number(clamp(minConfidencePct + Math.max(0, edgePct ?? 0) * 0.35, 1, 99).toFixed(1));
  const expectedReturnPct = modelProbability !== null && marketProbability !== null && marketProbability > 0
    ? Number((((modelProbability / marketProbability) - 1) * 100).toFixed(1))
    : null;
  const edgeBoost = clamp(Math.max(0, edgePct ?? minEdgePct) / 100, 0, stakeCeilingPct);
  const stakePct = clamp(stakeFloorPct + edgeBoost, stakeFloorPct, stakeCeilingPct);
  const stakeUsd = Number(clamp(balanceBeforeUsd * stakePct, 1, Math.max(1, balanceBeforeUsd)).toFixed(2));
  return {
    modelProbability: modelProbability === null ? null : Number(modelProbability.toFixed(4)),
    marketProbability,
    edgePct,
    confidencePct,
    expectedReturnPct,
    stakeUsd,
    balanceBeforeUsd: Number(balanceBeforeUsd.toFixed(2)),
  };
}

function nextResolutionCheck(closeTs: string | undefined) {
  if (!closeTs) return null;
  const parsed = Date.parse(closeTs);
  if (!Number.isFinite(parsed)) return null;
  return parsed + 15 * 60_000;
}

function buildTraderAsk(metadata: TraderMetadata, selected: TraderCandidate, candidates: TraderCandidate[]) {
  return [
    "Run a Prophecy Companion autonomous trader cycle.",
    "You are deciding whether this funded strategy should open one paper position now.",
    `Strategy: capital=$${metadata.capitalUsd}, target=${metadata.targetReturnPct}%, horizon=${metadata.horizonDays} days.`,
    `Policy: ${JSON.stringify(metadata.riskPolicy ?? {})}.`,
    "Do not claim real Prophecy execution occurred.",
    "Do not claim a market settled, won, lost, or voided. Settlement requires the Prophecy settlement adapter after resolution-check time.",
    "Pick at most one exact submarket/outcome. For multi-outcome events, never answer only YES or NO; answer YES on the named outcome, for example 'YES on Candidate Name'.",
    "Include event id, market id when available, exactOutcomeLabel, side, stakeUsd, modelProbability, marketProbability, edgePct, confidencePct, expectedReturnPct, and rationale.",
    `Selected candidate for execution URL: ${selected.url}`,
    "Candidate book:",
    JSON.stringify(candidates.slice(0, 8)),
  ].join("\n");
}

async function executeTraderMission(input: {
  clients: ReturnType<typeof getAutopilotClients>;
  missionId: `0x${string}`;
  metadata: TraderMetadata;
  candidate: TraderCandidate;
  candidates: TraderCandidate[];
  relayerFeeStt: string;
  cadenceMinutes: number;
}) {
  const ask = buildTraderAsk(input.metadata, input.candidate, input.candidates);
  const extraContext = [
    input.candidate.context ?? "",
    `Exact candidate: ${JSON.stringify(input.candidate)}`,
    `All ranked candidates: ${JSON.stringify(input.candidates.slice(0, 8))}`,
  ].filter(Boolean).join("\n\n");
  const payload = buildCompanionPayload({
    eventUrl: input.candidate.url,
    ask,
    extraContext,
  });
  const idempotencyKey = hashId(
    "pc-trader",
    input.missionId,
    input.candidate.eventId,
    input.candidate.marketId ?? input.candidate.title ?? input.candidate.url,
    Math.floor(Date.now() / (input.cadenceMinutes * 60_000))
  ) as `0x${string}`;
  const relayerFee = parseEther(input.relayerFeeStt);
  const payloadHash = keccak256(payload);
  const contextHash = policyHash(extraContext);
  const payloadTemplateHash = companionPayloadTemplateHash();
  const runMetadataURI = JSON.stringify({
    app: "Prophecy Companion",
    kind: "pc-trader-cycle-v1",
    strategyHash: input.metadata.strategyHash,
    selectedUrl: input.candidate.url,
    selectedEventId: input.candidate.eventId,
    selectedMarketId: input.candidate.marketId ?? null,
    generatedAt: new Date().toISOString(),
    payloadHash,
    contextHash,
  });

  const txHash = await input.clients.walletClient.writeContract({
    address: input.clients.vaultAddress,
    abi: VAULT_ABI,
    functionName: "executeMission",
    args: [
      input.missionId,
      payload,
      idempotencyKey,
      relayerFee,
      input.metadata.strategyHash!,
      policyHash(strategyQuestion(input.metadata)),
      payloadTemplateHash,
      payloadHash,
      contextHash,
      runMetadataURI,
    ],
  });

  const receipt = await input.clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  let executionId: bigint | null = null;
  let remainingBalance: bigint | null = null;
  let agentFee: bigint | null = null;
  let runtimeBudget: bigint | null = null;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "MissionSpent") {
        executionId = decoded.args.executionId;
        remainingBalance = decoded.args.remainingBalance;
        agentFee = decoded.args.agentFee;
        runtimeBudget = decoded.args.runtimeBudget;
      }
    } catch {
      // ignore unrelated logs
    }
  }

  return {
    txHash,
    executionId,
    remainingBalance,
    agentFee,
    runtimeBudget,
    relayerFee,
    idempotencyKey,
    payloadHash,
    contextHash,
    modelInputSummary: summarizeModelInput(extraContext),
  };
}

async function runOnce(state: TraderState, options: { dryRun: boolean; maxExecutions: number; missionFilter?: `0x${string}` }) {
  const clients = getAutopilotClients();
  const supabase = new SupabaseClient();
  const relayerFeeStt = optional("PC_TRADER_RELAYER_FEE_STT") ?? optional("AUTOPILOT_RELAYER_FEE_STT") ?? "0";
  const relayerFee = parseEther(relayerFeeStt);
  const missionIds = options.missionFilter ? [options.missionFilter] : await discoverMissionIds(clients, state, !options.dryRun);
  let executions = 0;
  let skipped = 0;
  let failed = 0;
  let lastSkippedReason: string | null = null;
  let lastFailureReason: string | null = null;
  let walletBalanceWei: string | null = null;
  try {
    walletBalanceWei = (await clients.publicClient.getBalance({ address: clients.account.address })).toString();
  } catch {
    walletBalanceWei = null;
  }
  logStep("scan_start", {
    missionCount: missionIds.length,
    dryRun: options.dryRun,
    maxExecutions: options.maxExecutions,
    relayerFeeStt,
    lastScannedBlock: state.lastScannedBlock,
    walletBalanceWei,
  });
  await supabase.upsert("pc_relayer_heartbeats", [{
    relayer_id: `pc-trader:${clients.vaultAddress}:${clients.account.address}`.toLowerCase(),
    vault_address: clients.vaultAddress,
    relayer_address: clients.account.address,
    status: "scanning",
    last_seen_at: new Date().toISOString(),
    mission_count: missionIds.length,
    last_scanned_block: state.lastScannedBlock,
    wallet_balance_wei: walletBalanceWei,
    details: { kind: "pc-trader-relayer", dryRun: options.dryRun, phase: "scan_start" },
    updated_at: new Date().toISOString(),
  }], "relayer_id");

  for (const missionId of missionIds) {
    if (executions >= options.maxExecutions) break;
    const now = Date.now();
    const mission = await clients.publicClient.readContract({
      address: clients.vaultAddress,
      abi: VAULT_ABI,
      functionName: "getMission",
      args: [missionId],
    });
    const metadata = parseMissionMetadata(mission.metadataURI) as TraderMetadata | null;
    const policy = validateTraderMetadata({ metadata, mission, relayerFee, now });
    if (!policy.ok || !policy.metadata) {
      skipped++;
      lastSkippedReason = policy.reason ?? "policy invalid";
      logStep("mission_skipped", { missionId, reason: lastSkippedReason });
      continue;
    }

    const existingPositions = await loadStrategyPositions(supabase, missionId);
    const strategyBalanceUsd = currentStrategyBalance(Number(policy.metadata.capitalUsd), existingPositions);
    logStep("mission_loaded", {
      missionId,
      runCount: mission.runCount.toString(),
      maxRuns: mission.maxRuns.toString(),
      spentWei: mission.spent.toString(),
      vaultBalanceWei: mission.balance.toString(),
      existingPositionCount: existingPositions.length,
      strategyBalanceUsd: Number(strategyBalanceUsd.toFixed(2)),
    });

    const cadenceMs = policy.cadenceMinutes * 60_000;
    const lastRunAt = state.lastRunAt[missionId] ?? (mission.lastExecutedAt > 0n ? Number(mission.lastExecutedAt) * 1000 : 0);
    if (lastRunAt > 0 && now - lastRunAt < cadenceMs) {
      skipped++;
      lastSkippedReason = "cadence not due";
      logStep("mission_skipped", {
        missionId,
        reason: lastSkippedReason,
        nextDueAt: iso(lastRunAt + cadenceMs),
      });
      await supabase.upsert("pc_trader_strategies", [{
        mission_id: missionId,
        vault_address: clients.vaultAddress,
        owner_address: mission.owner,
        agent_id: mission.agentId.toString(),
        strategy_hash: policy.metadata.strategyHash,
        status: "active",
        capital_usd: policy.metadata.capitalUsd,
        target_return_pct: policy.metadata.targetReturnPct,
        horizon_days: policy.metadata.horizonDays,
        risk_policy: policy.metadata.riskPolicy ?? {},
        balance_usd: Number(strategyBalanceUsd.toFixed(2)),
        spent_wei: mission.spent.toString(),
        run_count: mission.runCount.toString(),
        max_runs: mission.maxRuns.toString(),
        expires_at: new Date(Number(mission.expiresAt) * 1000).toISOString(),
        next_due_at: iso(lastRunAt + cadenceMs),
        last_skipped_reason: "cadence not due",
        metadata: policy.metadata,
        updated_at: new Date().toISOString(),
      }], "mission_id");
      continue;
    }

    try {
      if (strategyBalanceUsd < 1) {
        skipped++;
        lastSkippedReason = "strategy capital exhausted";
        logStep("mission_skipped", { missionId, reason: lastSkippedReason, strategyBalanceUsd });
        continue;
      }

      logStep("discovery_start", { missionId });
      const candidates = await fetchCandidates(policy.metadata);
      logStep("discovery_complete", { missionId, candidateCount: candidates.length });
      const selected = chooseCandidate(candidates);
      if (!selected) {
        skipped++;
        lastSkippedReason = candidates.length > 0 ? "no exact outcome-labelled candidate" : "no active candidates";
        logStep("mission_skipped", { missionId, reason: lastSkippedReason, candidateCount: candidates.length });
        await supabase.upsert("pc_trader_strategies", [{
          mission_id: missionId,
          vault_address: clients.vaultAddress,
          owner_address: mission.owner,
          agent_id: mission.agentId.toString(),
          strategy_hash: policy.metadata.strategyHash,
          status: "active",
          capital_usd: policy.metadata.capitalUsd,
          target_return_pct: policy.metadata.targetReturnPct,
          horizon_days: policy.metadata.horizonDays,
          risk_policy: policy.metadata.riskPolicy ?? {},
          balance_usd: Number(strategyBalanceUsd.toFixed(2)),
          spent_wei: mission.spent.toString(),
          run_count: mission.runCount.toString(),
          max_runs: mission.maxRuns.toString(),
          expires_at: new Date(Number(mission.expiresAt) * 1000).toISOString(),
          next_due_at: iso(now + cadenceMs),
          last_skipped_reason: "no active candidates",
          metadata: policy.metadata,
          updated_at: new Date().toISOString(),
        }], "mission_id");
        continue;
      }
      const selectedOutcomeTitle = exactOutcomeTitle(selected);
      if (!selectedOutcomeTitle) {
        skipped++;
        lastSkippedReason = "selected candidate missing exact outcome label";
        logStep("mission_skipped", {
          missionId,
          reason: lastSkippedReason,
          eventId: selected.eventId,
          marketId: selected.marketId ?? null,
          title: selected.title ?? null,
        });
        continue;
      }
      const metrics = deriveDecisionMetrics(policy.metadata, selected, strategyBalanceUsd);
      logStep("candidate_selected", {
        missionId,
        eventId: selected.eventId,
        marketId: selected.marketId ?? null,
        title: selectedOutcomeTitle,
        marketProbability: metrics.marketProbability,
        modelProbability: metrics.modelProbability,
        edgePct: metrics.edgePct,
        expectedReturnPct: metrics.expectedReturnPct,
        stakeUsd: metrics.stakeUsd,
        balanceBeforeUsd: metrics.balanceBeforeUsd,
      });

      const quote = await clients.publicClient.readContract({
        address: clients.vaultAddress,
        abi: VAULT_ABI,
        functionName: "canExecute",
        args: [missionId, relayerFee],
      });
      logStep("vault_quote", {
        missionId,
        ok: quote[0],
        agentFeeWei: quote[1].toString(),
        runtimeBudgetWei: quote[2].toString(),
        totalCostWei: quote[3].toString(),
        vaultBalanceWei: quote[4].toString(),
      });
      if (!quote[0]) {
        skipped++;
        const reason = quote[4] < quote[3] ? "insufficient_vault_budget" : "vault_can_execute_false";
        lastSkippedReason = reason;
        const skippedAt = new Date().toISOString();
        await supabase.upsert("pc_trader_cycles", [{
          id: hashId("skipped-cycle", missionId, selected.eventId, selected.marketId ?? selected.title ?? selected.url, now),
          mission_id: missionId,
          vault_address: clients.vaultAddress,
          execution_id: null,
          transaction_hash: null,
          idempotency_key: ZERO_BYTES32,
          status: "skipped",
          decision: reason,
          reason,
          candidate_count: candidates.length,
          selected_event_url: selected.url,
          selected_event_id: selected.eventId,
          selected_market_id: selected.marketId?.toString() ?? null,
          selected_submarket_title: selectedOutcomeTitle,
          agent_fee_wei: quote[1].toString(),
          runtime_budget_wei: quote[2].toString(),
          relayer_fee_wei: relayerFee.toString(),
          remaining_vault_balance_wei: quote[4].toString(),
          error: reason,
          created_at: skippedAt,
          updated_at: skippedAt,
        }], "id");
        await supabase.upsert("pc_trader_strategies", [{
          mission_id: missionId,
          vault_address: clients.vaultAddress,
          owner_address: mission.owner,
          agent_id: mission.agentId.toString(),
          strategy_hash: policy.metadata.strategyHash,
          status: reason === "insufficient_vault_budget" ? "needs_funding" : "active",
          capital_usd: policy.metadata.capitalUsd,
          target_return_pct: policy.metadata.targetReturnPct,
          horizon_days: policy.metadata.horizonDays,
          risk_policy: policy.metadata.riskPolicy ?? {},
          balance_usd: Number(strategyBalanceUsd.toFixed(2)),
          spent_wei: mission.spent.toString(),
          run_count: mission.runCount.toString(),
          max_runs: mission.maxRuns.toString(),
          expires_at: new Date(Number(mission.expiresAt) * 1000).toISOString(),
          next_due_at: iso(now + cadenceMs),
          last_skipped_reason: reason,
          metadata: { ...policy.metadata, quote: {
            agentFeeWei: quote[1].toString(),
            runtimeBudgetWei: quote[2].toString(),
            totalCostWei: quote[3].toString(),
            vaultBalanceWei: quote[4].toString(),
          }},
          updated_at: new Date().toISOString(),
        }], "mission_id");
        logStep("mission_skipped", {
          missionId,
          reason,
          totalCostWei: quote[3].toString(),
          vaultBalanceWei: quote[4].toString(),
        });
        continue;
      }

      const cycleId = hashId("cycle", missionId, selected.eventId, selected.marketId ?? selected.title ?? selected.url, now);
      if (options.dryRun) {
        logStep("dry_run_execute", { missionId, selected: selected.url });
        continue;
      }

      logStep("execute_start", { missionId, cycleId, selectedUrl: selected.url });
      const result = await executeTraderMission({
        clients,
        missionId,
        metadata: policy.metadata,
        candidate: selected,
        candidates,
        relayerFeeStt,
        cadenceMinutes: policy.cadenceMinutes,
      });
      const placedAt = new Date().toISOString();
      const resolutionAt = nextResolutionCheck(selected.closeTs);

      await supabase.upsert("pc_trader_cycles", [{
        id: cycleId,
        mission_id: missionId,
        vault_address: clients.vaultAddress,
        execution_id: result.executionId?.toString() ?? null,
        transaction_hash: result.txHash,
        idempotency_key: result.idempotencyKey,
        status: "submitted",
        decision: "opened_position",
        reason: selected.scoutReason ?? "Trader relayer selected the highest-ranked active candidate for this paid cycle.",
        candidate_count: candidates.length,
        selected_event_url: selected.url,
        selected_event_id: selected.eventId,
        selected_market_id: selected.marketId?.toString() ?? null,
        selected_submarket_title: selectedOutcomeTitle,
        payload_hash: result.payloadHash,
        context_hash: result.contextHash,
        agent_fee_wei: result.agentFee?.toString() ?? quote[1].toString(),
        runtime_budget_wei: result.runtimeBudget?.toString() ?? quote[2].toString(),
        relayer_fee_wei: result.relayerFee.toString(),
        remaining_vault_balance_wei: result.remainingBalance?.toString() ?? null,
        created_at: placedAt,
        updated_at: placedAt,
      }], "id");

      await supabase.upsert("pc_trader_positions", [{
        id: hashId("position", missionId, cycleId, selected.eventId, selected.marketId ?? selected.title ?? selected.url),
        mission_id: missionId,
        cycle_id: cycleId,
        event_url: selected.url,
        event_id: selected.eventId,
        market_id: selected.marketId?.toString() ?? null,
        submarket_title: selectedOutcomeTitle,
        side: "YES",
        stake_usd: metrics.stakeUsd,
        balance_before_usd: metrics.balanceBeforeUsd,
        balance_after_usd: null,
        model_probability: metrics.modelProbability,
        market_probability: metrics.marketProbability,
        edge_pct: metrics.edgePct,
        confidence_pct: metrics.confidencePct,
        expected_return_pct: metrics.expectedReturnPct,
        rationale: selected.scoutReason ?? `Opened YES on exact outcome: ${selectedOutcomeTitle}.`,
        status: "open",
        placed_at: placedAt,
        expected_resolution_check_at: iso(resolutionAt),
        metadata: { selected, modelInputSummary: result.modelInputSummary },
        updated_at: placedAt,
      }], "id");

      await supabase.upsert("pc_trader_strategies", [{
        mission_id: missionId,
        vault_address: clients.vaultAddress,
        owner_address: mission.owner,
        agent_id: mission.agentId.toString(),
        strategy_hash: policy.metadata.strategyHash,
        status: "active",
        capital_usd: policy.metadata.capitalUsd,
        target_return_pct: policy.metadata.targetReturnPct,
        horizon_days: policy.metadata.horizonDays,
        risk_policy: policy.metadata.riskPolicy ?? {},
        balance_usd: Number((metrics.balanceBeforeUsd - metrics.stakeUsd).toFixed(2)),
        spent_wei: mission.spent.toString(),
        run_count: (mission.runCount + 1n).toString(),
        max_runs: mission.maxRuns.toString(),
        expires_at: new Date(Number(mission.expiresAt) * 1000).toISOString(),
        next_due_at: iso(now + cadenceMs),
        last_cycle_at: placedAt,
        last_skipped_reason: null,
        last_failure_reason: null,
        metadata: policy.metadata,
        updated_at: placedAt,
      }], "mission_id");

      state.lastRunAt[missionId] = now;
      saveState(state);
      executions++;
      logStep("execute_complete", {
        missionId,
        executionId: result.executionId?.toString(),
        tx: result.txHash,
        stakeUsd: metrics.stakeUsd,
        balanceBeforeUsd: metrics.balanceBeforeUsd,
        remainingVaultBalanceWei: result.remainingBalance?.toString() ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed++;
      lastFailureReason = message;
      await supabase.upsert("pc_trader_cycles", [{
        id: hashId("failed-cycle", missionId, now),
        mission_id: missionId,
        vault_address: clients.vaultAddress,
        execution_id: null,
        transaction_hash: null,
        idempotency_key: ZERO_BYTES32,
        status: "failed",
        decision: "failed",
        reason: "Trader cycle failed before or during vault execution.",
        candidate_count: 0,
        error: message,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }], "id");
      logStep("cycle_failed", { missionId, error: message });
    }
  }

  await supabase.upsert("pc_relayer_heartbeats", [{
    relayer_id: `pc-trader:${clients.vaultAddress}:${clients.account.address}`.toLowerCase(),
    vault_address: clients.vaultAddress,
    relayer_address: clients.account.address,
    status: "idle",
    last_seen_at: new Date().toISOString(),
    mission_count: missionIds.length,
    last_scanned_block: state.lastScannedBlock,
    wallet_balance_wei: walletBalanceWei,
    details: { kind: "pc-trader-relayer", executions, skipped, failed, lastSkippedReason, lastFailureReason },
    updated_at: new Date().toISOString(),
  }], "relayer_id");
  logStep("scan_complete", { missionCount: missionIds.length, executions, skipped, failed, lastSkippedReason, lastFailureReason });
}

async function main() {
  const args = parseArgs();
  const once = Boolean(args.once);
  const dryRun = Boolean(args["dry-run"] ?? args.dryRun);
  const missionFilter = typeof args.mission === "string" && args.mission.startsWith("0x") ? (args.mission as `0x${string}`) : undefined;
  const maxRaw = typeof args.max === "string" ? Number(args.max) : optionalNumber("PC_TRADER_MAX_EXECUTIONS_PER_SCAN", 1);
  const maxExecutions = Number.isFinite(maxRaw) ? Math.max(1, Math.floor(maxRaw)) : 1;
  const intervalMs = optionalNumber("PC_TRADER_DAEMON_INTERVAL_MS", 60_000);
  const state = loadState();
  const health = startServiceHealthServer({
    serviceName: optional("SERVICE_NAME") || "pc-trader-relayer",
    getDetails: () => ({
      once,
      dryRun,
      missionFilter: missionFilter ?? null,
      maxExecutions,
      lastScannedBlock: state.lastScannedBlock,
      missionCount: state.missionIds.length,
    }),
  });

  logStep("service_start", { once, dryRun, maxExecutions, stateFile: statePath() });
  health.ready();
  do {
    try {
      await runOnce(state, { dryRun, maxExecutions, missionFilter });
      health.beat();
    } catch (error) {
      health.error(error);
      throw error;
    }
    if (!once) await wait(intervalMs);
  } while (!once);
}

main().catch((error) => {
  logStep("service_crashed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
