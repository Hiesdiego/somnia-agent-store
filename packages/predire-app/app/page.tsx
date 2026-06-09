//app/page.tsx

"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  parseAbiParameters,
  parseEther,
  toBytes,
} from "viem";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import {
  Archive,
  Bot,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  AgentConfig,
  AgentStatus,
  AgentType,
  AUTONOMY_V4_ABI,
  AUTOPILOT_VAULT_ABI,
  BILLING_ABI,
  EXECUTOR_ABI,
  ExecutionRecord,
  ExecutionStatus,
  REGISTRY_ABI,
  SOMNIA_TESTNET,
  formatAddress,
  formatAgentUid,
  formatRelative,
  formatSTT,
  getSasAddresses,
} from "@/lib/somnia";

const DEFAULT_AUTOPILOT_RELAYER_FEE_STT =
  process.env.NEXT_PUBLIC_AUTOPILOT_RELAYER_FEE_STT ?? "0.20";

type QueryForm = {
  prophecyEventUrl: string;
  analysisAsk: string;
  extraContext: string;
};

type ScoutForm = {
  objective: string;
  minProbability: string;
  minEdge: string;
  minConfidence: string;
  limit: string;
  seedUrls: string;
};

type ScoutCandidate = {
  eventId: string;
  url: string;
  marketId?: number;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  marketProbability?: number;
  volume?: string;
  closeTs?: string;
  resolutionCriteria?: string;
  sourceReferences?: string[];
  tags?: string[];
  scoutReason?: string;
  directionFit?: "agree" | "disagree" | "neutral";
  context: string;
  discoveredAt: number;
};

type WatchedMarket = {
  id: string;
  url: string;
  question: string;
  cadenceMinutes: number;
  maxRuns: number;
  expiresAt: number;
  createdAt: number;
  lastCheckedAt?: number;
  lastContextHash?: string;
  lastContext?: string;
  lastSignal?: string;
  status: "watching" | "checking" | "changed" | "stable" | "needs-context" | "error" | "paused" | "archived";
  error?: string;
  missionId?: `0x${string}`;
  missionBalanceWei?: string;
  missionSpentWei?: string;
  missionRunCount?: string;
  missionActive?: boolean;
  missionPolicyVersion?: number;
};

type StrategyRisk = "conservative" | "balanced" | "high" | "degen";

type StrategyForm = {
  capitalUsd: string;
  targetReturnPct: string;
  horizonDays: string;
};

type TradeIdeaStatus = "open" | "won" | "lost" | "void" | "archived";

type TradeIdea = {
  id: string;
  eventId: string;
  marketId?: number;
  url: string;
  title: string;
  subMarketTitle: string;
  suggestedMove: "YES" | "NO" | "WATCH";
  stakeUsd: number;
  balanceBeforeUsd: number;
  balanceAfterUsd?: number;
  capitalUsd: number;
  targetReturnPct: number;
  horizonDays: number;
  risk: StrategyRisk;
  maxPositions: number;
  minEdgePct: number;
  modelProbability: number | null;
  marketProbability: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  expectedReturnPct: number | null;
  rationale: string;
  status: TradeIdeaStatus;
  createdAt: number;
  closesAt?: number;
  nextResolutionCheckAt?: number;
  cycleTxHash?: `0x${string}`;
  cycleExecutionId?: string;
  resolvedAt?: number;
  realizedReturnPct?: number;
  outcomeNote?: string;
};

type AutopilotRun = {
  missionId: `0x${string}`;
  owner: `0x${string}`;
  agentId: bigint;
  executionId: bigint;
  agentFee: bigint;
  runtimeBudget: bigint;
  relayerFee: bigint;
  remainingBalance: bigint;
  idempotencyKey: `0x${string}`;
  payloadTemplateHash: `0x${string}`;
  payloadHash: `0x${string}`;
  contextHash: `0x${string}`;
  blockNumber?: bigint;
  txHash?: `0x${string}`;
  record?: ExecutionRecord;
  resultRaw: string | null;
};

type OpsHeartbeat = {
  relayer_id: string;
  vault_address: `0x${string}`;
  relayer_address: `0x${string}`;
  status: string;
  last_seen_at: string;
  mission_count: number;
  last_scanned_block: string | null;
  wallet_balance_wei: string | null;
  details?: Record<string, unknown>;
};

type OpsMission = {
  mission_id: `0x${string}`;
  vault_address: `0x${string}`;
  event_url: string | null;
  question: string | null;
  active: boolean;
  balance_wei: string;
  spent_wei: string;
  run_count: string;
  max_runs: string | null;
  expires_at: string | null;
  next_due_at: string | null;
  last_scan_at: string | null;
  last_run_at: string | null;
  last_skipped_reason: string | null;
  last_failure_reason: string | null;
  last_execution_id: string | null;
  policy_hashes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  updated_at: string;
};

type OpsRun = {
  id: string;
  mission_id: `0x${string}`;
  vault_address: `0x${string}`;
  event_url: string | null;
  execution_id: string | null;
  transaction_hash: `0x${string}` | null;
  idempotency_key: `0x${string}`;
  payload_template_hash: `0x${string}`;
  payload_hash: `0x${string}`;
  context_hash: `0x${string}`;
  execution_source: string | null;
  execution_rationale: string | null;
  consensus: {
    probability?: number;
    confidence?: number;
    edge?: number | null;
    marketProbability?: number | null;
    summary?: string;
  } | null;
  trigger_types: string[];
  agent_fee_wei: string | null;
  runtime_budget_wei: string | null;
  relayer_fee_wei: string | null;
  remaining_balance_wei: string | null;
  status: "submitted" | "confirmed" | "failed";
  error: string | null;
  created_at: string;
};

type OpsContext = {
  context_hash: `0x${string}`;
  mission_id: `0x${string}`;
  vault_address: `0x${string}`;
  event_url: string;
  payload_hash: `0x${string}` | null;
  prophecy_snapshot_hash: `0x${string}`;
  external_source_urls: string[];
  research_timestamp: string;
  model_input_summary: string;
  context_bytes: number;
  snapshot_id: string | null;
};

type OpsTraderPosition = {
  id: string;
  mission_id: `0x${string}`;
  cycle_id: string;
  event_url: string;
  event_id: string;
  market_id: string | null;
  submarket_title: string;
  side: "YES" | "NO" | "WATCH" | string;
  stake_usd: number;
  balance_before_usd: number;
  balance_after_usd: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge_pct: number | null;
  confidence_pct: number | null;
  expected_return_pct: number | null;
  rationale: string;
  status: TradeIdeaStatus | string;
  placed_at: string;
  expected_resolution_check_at: string | null;
  resolved_at: string | null;
  realized_return_pct: number | null;
  outcome_note: string | null;
  metadata?: Record<string, unknown>;
};

type OpsData = {
  configured: boolean;
  generatedAt: string;
  heartbeats: OpsHeartbeat[];
  missions: OpsMission[];
  runs: OpsRun[];
  contexts: OpsContext[];
  triggers: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  theses: Array<Record<string, unknown>>;
  retries: Array<Record<string, unknown>>;
  traderStrategies?: Array<Record<string, unknown>>;
  traderCycles?: Array<Record<string, unknown>>;
  traderPositions?: OpsTraderPosition[];
  error?: string;
};

type RuntimeHealth = {
  ok: boolean;
  status: "checking" | "healthy" | "unavailable" | "failed" | "unknown" | "not_checked" | "unconfigured";
  reason: string;
  checkedAt?: string;
  selector?: string | null;
  payloadBytes?: number;
};

type ServiceHealthItem = {
  key: string;
  label: string;
  configured: boolean;
  ok: boolean;
  status: string;
  endpoint: string | null;
  statusCode?: number;
  service?: string;
  details?: Record<string, unknown>;
  lastBeatAt?: string;
  uptimeSeconds?: number;
  error?: string;
};

type ServiceHealthResponse = {
  ok: boolean;
  checkedAt: string;
  services: ServiceHealthItem[];
};

type Workspace = "scout" | "analysis" | "autopilot" | "runs" | "settings";
type ExecutionMode = "billing" | "autonomy-v4";

const SAS = getSasAddresses();
const WATCH_STORAGE_KEY = "prophecy-companion-autonomy-v1";
const STRATEGY_STORAGE_KEY = "prophecy-companion-strategy-autopilot-v1";
const ANALYSIS_PREFILL_KEY = "prophecy-companion-analysis-prefill-v1";
const WATCH_PREFILL_KEY = "prophecy-companion-watch-prefill-v1";
const MISSION_POLICY_VERSION = 1;
const COMPANION_PAYLOAD_TEMPLATE_V1 = "prophecy-companion-payload-template-v1";
const DEFAULT_MISSION_MAX_RUNS = "12";
const DEFAULT_MISSION_DURATION_DAYS = "7";
const MAX_ONE_SHOT_CONTEXT_CHARS = 2200;
const MAX_ONE_SHOT_PAYLOAD_HEX_CHARS = 10_000;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;
const DELEGATES_RELATION_TYPE = `0x${"01".padStart(64, "0")}` as `0x${string}`;
const AUTOPILOT_SCAN_FROM_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_AUTOPILOT_SCAN_FROM_BLOCK?.trim() || "389298380"
);
const AUTOPILOT_LOG_CHUNK_SIZE_RAW = Number.parseInt(
  process.env.NEXT_PUBLIC_AUTOPILOT_LOG_CHUNK_SIZE?.trim() || "900",
  10
);
const AUTOPILOT_LOG_CHUNK_SIZE = Number.isFinite(AUTOPILOT_LOG_CHUNK_SIZE_RAW)
  ? Math.max(1, AUTOPILOT_LOG_CHUNK_SIZE_RAW)
  : 900;
const CONFIGURED_SAS_AGENT_ID_RAW = process.env.NEXT_PUBLIC_COMPANION_SAS_AGENT_ID?.trim() ?? "";
const CONFIGURED_SOMNIA_AGENT_ID_RAW = process.env.NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID?.trim() ?? "";
const CONFIGURED_AUTONOMY_RUNNER_RAW =
  process.env.NEXT_PUBLIC_SAS_AUTONOMY_RUNNER_ADDRESS?.trim() ?? "";
const CONFIGURED_SAS_AGENT_ID =
  CONFIGURED_SAS_AGENT_ID_RAW && /^\d+$/.test(CONFIGURED_SAS_AGENT_ID_RAW)
    ? BigInt(CONFIGURED_SAS_AGENT_ID_RAW)
    : null;
const CONFIGURED_SOMNIA_AGENT_ID =
  CONFIGURED_SOMNIA_AGENT_ID_RAW && /^\d+$/.test(CONFIGURED_SOMNIA_AGENT_ID_RAW)
    ? BigInt(CONFIGURED_SOMNIA_AGENT_ID_RAW)
    : null;
const CONFIGURED_AUTONOMY_RUNNER_ADDRESS =
  /^0x[a-fA-F0-9]{40}$/.test(CONFIGURED_AUTONOMY_RUNNER_RAW)
    ? (CONFIGURED_AUTONOMY_RUNNER_RAW as `0x${string}`)
    : null;

const INITIAL_STRATEGY_FORM: StrategyForm = {
  capitalUsd: "100",
  targetReturnPct: "100",
  horizonDays: "3",
};

const INITIAL_FORM: QueryForm = {
  prophecyEventUrl: "",
  analysisAsk: "Based on current evidence and the market's own resolution criteria, what is the most likely outcome?",
  extraContext: "",
};

const INITIAL_SCOUT_FORM: ScoutForm = {
  objective:
    "Find mispriced Prophecy markets where external evidence strongly disagrees with the current crowd probability.",
  minProbability: "65",
  minEdge: "15",
  minConfidence: "70",
  limit: "12",
  seedUrls: "",
};

const SOMNIA_LLM_ABI = [
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

const SOMNIA_WEBSITE_PARSE_ABI = [
  {
    name: "ExtractString",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "string" },
      { name: "description", type: "string" },
      { name: "options", type: "string[]" },
      { name: "prompt", type: "string" },
      { name: "url", type: "string" },
      { name: "resolveUrl", type: "bool" },
      { name: "numPages", type: "uint8" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function decodeExecutionString(hex: `0x${string}` | undefined): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const [decoded] = decodeAbiParameters(parseAbiParameters("string"), hex);
    return decoded;
  } catch {
    return null;
  }
}

function statusLabel(status: unknown): string {
  const value = Number(status);
  return ExecutionStatus[value] ?? `UNKNOWN(${value})`;
}

function parseResultSummary(raw: string | null): {
  probability?: number;
  prediction?: string;
  side?: string;
  exactOutcomeLabel?: string;
  selectedMarketId?: string | number;
  confidence?: string | number;
  reasoning?: string;
  marketStructure?: string;
  resolutionCriteria?: string;
  marketSummary?: string;
  keyEvidence?: string[];
  counterEvidence?: string[];
  crowdSignal?: string;
  externalEvidenceSummary?: string;
  uncertaintyDrivers?: string[];
  risks?: string[];
  suggestedUserAction?: string;
  sourcesUsed?: string[];
  modelProbability?: number;
  marketProbability?: number;
  edge?: number;
  resolutionClarity?: string | number;
  riskLevel?: string;
  opportunityScore?: number;
  raw: string;
} {
  if (!raw) return { raw: "" };

  try {
    const normalized = normalizeJsonish(raw);
    const parsed = JSON.parse(normalized) as {
      probability?: unknown;
      prediction?: unknown;
      side?: unknown;
      exactOutcomeLabel?: unknown;
      exact_outcome_label?: unknown;
      selectedMarketId?: unknown;
      selected_market_id?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
      reason?: unknown;
      explanation?: unknown;
      marketStructure?: unknown;
      market_structure?: unknown;
      resolutionCriteria?: unknown;
      resolution_criteria?: unknown;
      marketSummary?: unknown;
      market_summary?: unknown;
      keyEvidence?: unknown;
      key_evidence?: unknown;
      counterEvidence?: unknown;
      counter_evidence?: unknown;
      crowdSignal?: unknown;
      crowd_signal?: unknown;
      externalEvidenceSummary?: unknown;
      external_evidence_summary?: unknown;
      uncertaintyDrivers?: unknown;
      uncertainty_drivers?: unknown;
      risks?: unknown;
      suggestedUserAction?: unknown;
      suggested_user_action?: unknown;
      sourcesUsed?: unknown;
      sources?: unknown;
      modelProbability?: unknown;
      model_probability?: unknown;
      marketProbability?: unknown;
      market_probability?: unknown;
      edge?: unknown;
      resolutionClarity?: unknown;
      resolution_clarity?: unknown;
      riskLevel?: unknown;
      risk_level?: unknown;
      opportunityScore?: unknown;
      opportunity_score?: unknown;
    };

    return {
      raw,
      probability: typeof parsed.probability === "number" ? parsed.probability : undefined,
      prediction: typeof parsed.prediction === "string" ? parsed.prediction : undefined,
      side: firstString(parsed.side),
      exactOutcomeLabel: firstString(parsed.exactOutcomeLabel, parsed.exact_outcome_label),
      selectedMarketId:
        typeof parsed.selectedMarketId === "string" || typeof parsed.selectedMarketId === "number"
          ? parsed.selectedMarketId
          : typeof parsed.selected_market_id === "string" || typeof parsed.selected_market_id === "number"
            ? parsed.selected_market_id
            : undefined,
      confidence:
        typeof parsed.confidence === "string" || typeof parsed.confidence === "number"
          ? parsed.confidence
          : undefined,
      reasoning: firstString(parsed.reasoning, parsed.reason, parsed.explanation),
      marketStructure: firstString(parsed.marketStructure, parsed.market_structure),
      resolutionCriteria:
        firstString(parsed.resolutionCriteria, parsed.resolution_criteria),
      marketSummary: firstString(parsed.marketSummary, parsed.market_summary),
      keyEvidence: stringArray(parsed.keyEvidence) ?? stringArray(parsed.key_evidence),
      counterEvidence: stringArray(parsed.counterEvidence) ?? stringArray(parsed.counter_evidence),
      crowdSignal: firstString(parsed.crowdSignal, parsed.crowd_signal),
      externalEvidenceSummary:
        firstString(parsed.externalEvidenceSummary, parsed.external_evidence_summary),
      uncertaintyDrivers:
        stringArray(parsed.uncertaintyDrivers) ?? stringArray(parsed.uncertainty_drivers),
      risks: stringArray(parsed.risks),
      suggestedUserAction:
        firstString(parsed.suggestedUserAction, parsed.suggested_user_action),
      sourcesUsed: stringArray(parsed.sourcesUsed) ?? stringArray(parsed.sources),
      modelProbability: firstNumber(parsed.modelProbability, parsed.model_probability),
      marketProbability: firstNumber(parsed.marketProbability, parsed.market_probability),
      edge: firstNumber(parsed.edge),
      resolutionClarity:
        typeof parsed.resolutionClarity === "string" || typeof parsed.resolutionClarity === "number"
          ? parsed.resolutionClarity
          : typeof parsed.resolution_clarity === "string" || typeof parsed.resolution_clarity === "number"
            ? parsed.resolution_clarity
            : undefined,
      riskLevel: firstString(parsed.riskLevel, parsed.risk_level),
      opportunityScore: firstNumber(parsed.opportunityScore, parsed.opportunity_score),
    };
  } catch {
    return { raw };
  }
}

function displayPrediction(summary: ReturnType<typeof parseResultSummary>): string | undefined {
  const prediction = summary.prediction?.trim();
  const exactOutcomeLabel = summary.exactOutcomeLabel?.trim();
  if (!prediction) return undefined;
  if (!exactOutcomeLabel) return prediction;

  const lowerPrediction = prediction.toLowerCase();
  const lowerExact = exactOutcomeLabel.toLowerCase();
  const optionTail = exactOutcomeLabel.split(":").pop()?.trim().toLowerCase();
  const sidePhrase = prediction.match(/^(?:lean\s+)?(?:yes|no)/i)?.[0];

  if (lowerPrediction.includes(lowerExact)) return prediction;
  if (optionTail && lowerPrediction.includes(optionTail) && sidePhrase) return `${sidePhrase} on ${exactOutcomeLabel}`;
  if (/^(?:lean\s+)?(?:yes|no)$/i.test(prediction)) return `${prediction} on ${exactOutcomeLabel}`;
  if (/^(?:watch|avoid|no clear edge|watch\/no clear edge)$/i.test(prediction) || summary.side === "WATCH") {
    return `watch/no clear edge on ${exactOutcomeLabel}`;
  }
  return prediction;
}

function displayOutcomeLabel(summary: ReturnType<typeof parseResultSummary>): string | undefined {
  const exactOutcomeLabel = summary.exactOutcomeLabel?.trim();
  if (exactOutcomeLabel && !/^other$/i.test(exactOutcomeLabel)) return exactOutcomeLabel;

  const prediction = summary.prediction?.trim();
  const fullOtherMatch = prediction?.match(/\bon\s+(.+?:\s*Other)\b/i);
  if (fullOtherMatch?.[1]) return fullOtherMatch[1].trim();

  return exactOutcomeLabel || undefined;
}

function normalizeJsonish(value: string): string {
  const stripped = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);

  return stripped;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace("%", "").trim());
      if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
    }
  }
  return undefined;
}

function formatProbability(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function formatConfidence(value: string | number | undefined): string {
  if (typeof value === "number") return `${(value * 100).toFixed(0)}%`;
  return value ?? "N/A";
}

function formatIsoRelative(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "-";
  return formatRelative(BigInt(Math.floor(parsed / 1000)));
}

function formatWeiStt(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    return `${formatSTT(BigInt(value))} STT`;
  } catch {
    return "-";
  }
}

function expiryCountdown(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "-";
  return policyExpiryLabel(parsed);
}

function runsRemaining(runCount: string | null | undefined, maxRuns: string | null | undefined): string {
  try {
    if (!maxRuns) return "-";
    const used = BigInt(runCount ?? "0");
    const max = BigInt(maxRuns);
    return max > used ? (max - used).toString() : "0";
  } catch {
    return "-";
  }
}

function isRelayerStale(heartbeat: OpsHeartbeat | undefined): boolean {
  if (!heartbeat) return true;
  const seen = Date.parse(heartbeat.last_seen_at);
  return !Number.isFinite(seen) || Date.now() - seen > 3 * 60_000;
}

function isOpsRun(run: OpsRun | AutopilotRun): run is OpsRun {
  return "context_hash" in run;
}

function sourceHref(source: string): string | null {
  const match = source.match(/https?:\/\/\S+/);
  return match ? match[0].replace(/[),.]+$/g, "") : null;
}

function fingerprint(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function summarizeContext(context: string): string {
  const lines = context
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{") && !line.startsWith("}"));

  return (lines.slice(0, 4).join(" ") || context.trim()).slice(0, 260);
}

function compactOneShotContext(context: string, maxChars = MAX_ONE_SHOT_CONTEXT_CHARS): string {
  const sections = context
    .split(/\n{2,}|---+/)
    .map((section) => section.trim())
    .filter(Boolean);
  const priority = sections.filter((section) =>
    /structured|title|question|outcome|price|probability|close|resolution|source|evidence|risk|summary/i.test(section)
  );
  const ordered = [...priority, ...sections.filter((section) => !priority.includes(section))];
  const compact = ordered
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, maxChars);
  return compact || context.slice(0, maxChars);
}

function compactOneShotForm(form: QueryForm): QueryForm {
  return {
    ...form,
    analysisAsk: form.analysisAsk.slice(0, 800),
    extraContext: compactOneShotContext(form.extraContext),
  };
}

function buildOneShotPayloadWithinLimit(agent: AgentConfig, form: QueryForm): { payload: `0x${string}`; form: QueryForm } {
  const contextBudgets = [MAX_ONE_SHOT_CONTEXT_CHARS, 1600, 1100, 700, 360, 0];
  const askBudgets = [800, 600, 420, 260, 180, 140];
  let lastPayload: `0x${string}` | null = null;
  let lastForm = compactOneShotForm(form);

  for (const contextBudget of contextBudgets) {
    for (const askBudget of askBudgets) {
      const candidate: QueryForm = {
        ...form,
        analysisAsk: form.analysisAsk.slice(0, askBudget),
        extraContext: contextBudget > 0 ? compactOneShotContext(form.extraContext, contextBudget) : "",
      };
      const payload = buildExecutionPayload(agent, candidate);
      lastPayload = payload;
      lastForm = candidate;
      if (payload.length <= MAX_ONE_SHOT_PAYLOAD_HEX_CHARS) return { payload, form: candidate };
    }
  }

  if (!lastPayload) {
    lastPayload = buildExecutionPayload(agent, lastForm);
  }
  return { payload: lastPayload, form: lastForm };
}

function parseSttAmount(value: string): bigint {
  const normalized = value.trim();
  if (!normalized || Number(normalized) < 0) throw new Error("Enter a valid STT amount.");
  return parseEther(normalized);
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveFloat(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function riskLabel(risk: StrategyRisk): string {
  if (risk === "conservative") return "Conservative";
  if (risk === "balanced") return "Balanced";
  if (risk === "high") return "High risk";
  return "Very high risk";
}

function strategyRiskWarning(form: StrategyForm): string {
  const target = parsePositiveFloat(form.targetReturnPct, 100);
  const horizon = parsePositiveInt(form.horizonDays, 3);
  const dailyTarget = target / Math.max(1, horizon);
  if (target >= 100 || dailyTarget >= 25) {
    return "This target forces a very high-risk autonomous policy. PC will size aggressively, but capital exhaustion is a realistic outcome.";
  }
  if (target >= 50) {
    return "This is an aggressive autonomous policy. PC will widen market selection and vary stake sizes based on edge and remaining balance.";
  }
  return "PC will prefer clearer markets, smaller stakes, and fewer concurrent positions.";
}

function strategyPolicySummary(form: StrategyForm): string {
  const capital = parsePositiveFloat(form.capitalUsd, 100);
  const target = parsePositiveFloat(form.targetReturnPct, 100);
  const horizon = parsePositiveInt(form.horizonDays, 3);
  const goal = capital * (1 + target / 100);
  return `$${capital.toFixed(0)} strategy capital -> $${goal.toFixed(0)} target over ${horizon}d`;
}

function tradeMarketKey(value: Pick<TradeIdea, "eventId" | "marketId" | "subMarketTitle" | "title">): string {
  const market = value.marketId ?? value.subMarketTitle ?? value.title;
  return `${value.eventId}:${market}`.toLowerCase();
}

function candidateMarketKey(candidate: ScoutCandidate): string {
  return `${candidate.eventId}:${candidate.marketId ?? candidate.title ?? candidate.url}`.toLowerCase();
}

function nextResolutionCheckTime(closeTs: string | undefined): number | undefined {
  if (!closeTs) return undefined;
  const closeTime = Date.parse(closeTs);
  if (!Number.isFinite(closeTime)) return undefined;
  return closeTime + 15 * 60_000;
}

function resolutionCheckLabel(value: number | undefined): string {
  if (!value) return "Unknown";
  if (Date.now() >= value) return "Due now";
  return policyExpiryLabel(value);
}

function tradeSideLabel(idea: Pick<TradeIdea, "suggestedMove" | "subMarketTitle">): string {
  if (idea.suggestedMove === "YES") return `YES on ${idea.subMarketTitle}`;
  if (idea.suggestedMove === "NO") return `NO on ${idea.subMarketTitle}`;
  return "WATCH";
}

function deriveTraderPolicy(form: StrategyForm): {
  risk: StrategyRisk;
  maxPositions: number;
  minEdgePct: number;
  minConfidencePct: number;
  stakeFloorPct: number;
  stakeCeilingPct: number;
} {
  const target = parsePositiveFloat(form.targetReturnPct, 100);
  const horizon = parsePositiveInt(form.horizonDays, 3);
  const dailyTarget = target / Math.max(1, horizon);

  if (target >= 150 || dailyTarget >= 40) {
    return { risk: "degen", maxPositions: 8, minEdgePct: 10, minConfidencePct: 48, stakeFloorPct: 0.08, stakeCeilingPct: 0.35 };
  }
  if (target >= 80 || dailyTarget >= 20) {
    return { risk: "high", maxPositions: 6, minEdgePct: 14, minConfidencePct: 55, stakeFloorPct: 0.07, stakeCeilingPct: 0.25 };
  }
  if (target >= 35 || dailyTarget >= 10) {
    return { risk: "balanced", maxPositions: 4, minEdgePct: 18, minConfidencePct: 62, stakeFloorPct: 0.05, stakeCeilingPct: 0.16 };
  }
  return { risk: "conservative", maxPositions: 3, minEdgePct: 22, minConfidencePct: 68, stakeFloorPct: 0.03, stakeCeilingPct: 0.1 };
}

function currentTraderBalance(form: StrategyForm, ideas: TradeIdea[]): number {
  const capital = parsePositiveFloat(form.capitalUsd, 100);
  return ideas.reduce((balance, idea) => {
    if (idea.status === "open") return balance - idea.stakeUsd;
    if (idea.status === "won") return balance + idea.stakeUsd * ((idea.realizedReturnPct ?? idea.expectedReturnPct ?? 0) / 100);
    if (idea.status === "lost") return balance - idea.stakeUsd;
    if (idea.status === "void") return balance;
    return balance;
  }, capital);
}

function candidateToTradeIdea(
  candidate: ScoutCandidate,
  form: StrategyForm,
  balanceBeforeUsd: number,
  policy: ReturnType<typeof deriveTraderPolicy>,
  index: number
): TradeIdea {
  const capital = parsePositiveFloat(form.capitalUsd, 100);
  const target = parsePositiveFloat(form.targetReturnPct, 100);
  const horizon = parsePositiveInt(form.horizonDays, 3);
  const marketProbability = typeof candidate.marketProbability === "number" ? candidate.marketProbability : null;
  const impliedModelProbability = clampNumber(
    Math.max(
      (marketProbability ?? 0.5) + policy.minEdgePct / 100,
      policy.minConfidencePct / 100
    ),
    0.01,
    0.99
  );
  const edgePct =
    marketProbability === null ? policy.minEdgePct : clampNumber((impliedModelProbability - marketProbability) * 100, -100, 100);
  const confidencePct = clampNumber(policy.minConfidencePct + Math.max(0, edgePct ?? 0) * 0.35, 1, 99);
  const expectedReturnPct =
    marketProbability && marketProbability > 0
      ? clampNumber(((impliedModelProbability / marketProbability) - 1) * 100, -100, 500)
      : clampNumber(target / policy.maxPositions, 5, 250);
  const edgeBoost = clampNumber(Math.max(0, edgePct ?? 0) / 100, 0, policy.stakeCeilingPct);
  const stakePct = clampNumber(policy.stakeFloorPct + edgeBoost, policy.stakeFloorPct, policy.stakeCeilingPct);
  const stake = clampNumber(balanceBeforeUsd * stakePct, 1, balanceBeforeUsd);
  const suggestedMove = edgePct === null || edgePct < policy.minEdgePct ? "WATCH" : "YES";

  return {
    id: `${candidate.eventId}-${candidate.marketId ?? fingerprint(candidate.title ?? candidate.url)}-${Date.now()}-${index}`,
    eventId: candidate.eventId,
    marketId: candidate.marketId,
    url: candidate.url,
    title: candidate.title || `Prophecy market #${candidate.eventId}`,
    subMarketTitle: candidate.title || (candidate.marketId ? `Market ${candidate.marketId}` : `Event ${candidate.eventId}`),
    suggestedMove,
    stakeUsd: Number(stake.toFixed(2)),
    balanceBeforeUsd: Number(balanceBeforeUsd.toFixed(2)),
    capitalUsd: capital,
    targetReturnPct: target,
    horizonDays: horizon,
    risk: policy.risk,
    maxPositions: policy.maxPositions,
    minEdgePct: policy.minEdgePct,
    modelProbability: Number(impliedModelProbability.toFixed(4)),
    marketProbability,
    edgePct: edgePct === null ? null : Number(edgePct.toFixed(1)),
    confidencePct: Number(confidencePct.toFixed(1)),
    expectedReturnPct: Number(expectedReturnPct.toFixed(1)),
    rationale:
      candidate.scoutReason ||
      "Trader policy selected this market based on edge, expected return, and remaining strategy balance.",
    status: "open",
    createdAt: Date.now(),
    closesAt: candidate.closeTs ? Date.parse(candidate.closeTs) : undefined,
    nextResolutionCheckAt: nextResolutionCheckTime(candidate.closeTs),
  };
}

function opsTraderPositionToTradeIdea(position: OpsTraderPosition): TradeIdea {
  const placedAt = Date.parse(position.placed_at);
  const resolutionAt = position.expected_resolution_check_at ? Date.parse(position.expected_resolution_check_at) : NaN;
  const marketId = position.market_id ? Number(position.market_id) : NaN;
  const status =
    position.status === "won" || position.status === "lost" || position.status === "void" || position.status === "archived"
      ? position.status
      : "open";
  return {
    id: `ops-${position.id}`,
    eventId: position.event_id,
    marketId: Number.isFinite(marketId) ? marketId : undefined,
    url: position.event_url,
    title: position.submarket_title,
    subMarketTitle: position.submarket_title,
    suggestedMove: position.side === "NO" || position.side === "WATCH" ? position.side : "YES",
    stakeUsd: Number(position.stake_usd) || 0,
    balanceBeforeUsd: Number(position.balance_before_usd) || 0,
    balanceAfterUsd: position.balance_after_usd === null ? undefined : Number(position.balance_after_usd),
    capitalUsd: Number(position.balance_before_usd) || 0,
    targetReturnPct: 0,
    horizonDays: 0,
    risk: "balanced",
    maxPositions: 0,
    minEdgePct: 0,
    modelProbability: position.model_probability,
    marketProbability: position.market_probability,
    edgePct: position.edge_pct,
    confidencePct: position.confidence_pct,
    expectedReturnPct: position.expected_return_pct,
    rationale: position.rationale,
    status,
    createdAt: Number.isFinite(placedAt) ? placedAt : Date.now(),
    nextResolutionCheckAt: Number.isFinite(resolutionAt) ? resolutionAt : undefined,
    cycleExecutionId: position.cycle_id,
    resolvedAt: position.resolved_at ? Date.parse(position.resolved_at) : undefined,
    realizedReturnPct: position.realized_return_pct ?? undefined,
    outcomeNote: position.outcome_note ?? undefined,
  };
}

function tradeIdeaPaperPnl(idea: TradeIdea): number {
  if (idea.status === "void" || idea.status === "archived") return 0;
  if (idea.status === "won") return idea.stakeUsd * ((idea.realizedReturnPct ?? idea.expectedReturnPct ?? 0) / 100);
  if (idea.status === "lost") return -idea.stakeUsd;
  return 0;
}

function compareBigIntDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function planAutoDelegates(
  rootAgent: AgentConfig | null,
  candidates: AgentConfig[],
  maxDelegates: number
): AgentConfig[] {
  if (!rootAgent || maxDelegates <= 0) return [];

  const rootCategory = rootAgent.category.trim().toLowerCase();
  const rootBuilder = rootAgent.builder.toLowerCase();

  return candidates
    .slice()
    .sort((a, b) => {
      const aSameCategory =
        rootCategory.length > 0 && a.category.trim().toLowerCase() === rootCategory ? 1 : 0;
      const bSameCategory =
        rootCategory.length > 0 && b.category.trim().toLowerCase() === rootCategory ? 1 : 0;
      if (aSameCategory !== bSameCategory) return bSameCategory - aSameCategory;

      const aDifferentBuilder = a.builder.toLowerCase() !== rootBuilder ? 1 : 0;
      const bDifferentBuilder = b.builder.toLowerCase() !== rootBuilder ? 1 : 0;
      if (aDifferentBuilder !== bDifferentBuilder) return bDifferentBuilder - aDifferentBuilder;

      const aVerified = a.isVerified ? 1 : 0;
      const bVerified = b.isVerified ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;

      const execCmp = compareBigIntDesc(a.totalExecutions, b.totalExecutions);
      if (execCmp !== 0) return execCmp;

      const revCmp = compareBigIntDesc(a.totalRevenue, b.totalRevenue);
      if (revCmp !== 0) return revCmp;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, maxDelegates);
}

function shortBytes32(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function safeBigInt(value: string | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function estimateRunsLeft(watch: WatchedMarket, executionCost: bigint | undefined, relayerFeeInput: string): string {
  const balance = safeBigInt(watch.missionBalanceWei);
  if (!balance || executionCost === undefined) return "-";

  let relayerFee = 0n;
  try {
    relayerFee = parseSttAmount(relayerFeeInput);
  } catch {
    relayerFee = 0n;
  }

  const perRun = executionCost + relayerFee;
  if (perRun <= 0n) return "-";
  return (balance / perRun).toString();
}

function estimatePolicyCost(input: {
  maxRuns: string;
  funding: string;
  relayerFee: string;
  executionCost: bigint | undefined;
}): { perRun: string; maxSpend: string; runsLeft: string } {
  let relayerFee = 0n;
  let funding = 0n;
  try {
    relayerFee = parseSttAmount(input.relayerFee);
  } catch {
    relayerFee = 0n;
  }
  try {
    funding = parseSttAmount(input.funding);
  } catch {
    funding = 0n;
  }
  const perRunWei = (input.executionCost ?? 0n) + relayerFee;
  return {
    perRun: perRunWei > 0n ? `${formatSTT(perRunWei)} STT` : "-",
    maxSpend: funding > 0n ? `${formatSTT(funding)} STT` : "-",
    runsLeft: perRunWei > 0n && funding > 0n
      ? (funding / perRunWei > BigInt(parsePositiveInt(input.maxRuns, 12))
          ? parsePositiveInt(input.maxRuns, 12).toString()
          : (funding / perRunWei).toString())
      : "-",
  };
}

function policyExpiryLabel(expiresAt: number): string {
  const deltaMs = expiresAt - Date.now();
  if (deltaMs <= 0) return "Expired";
  const days = Math.ceil(deltaMs / 86_400_000);
  if (days <= 1) return "Within 24h";
  return `${days}d`;
}

function policyHash(value: string): `0x${string}` {
  return keccak256(toBytes(value.trim()));
}

function companionPayloadTemplateHash(): `0x${string}` {
  return policyHash(COMPANION_PAYLOAD_TEMPLATE_V1);
}

function nextBrowserCheckLabel(watch: WatchedMarket): string {
  if (!watch.lastCheckedAt) return "After first evidence refresh";
  const dueAt = watch.lastCheckedAt + watch.cadenceMinutes * 60_000;
  const deltaMs = dueAt - Date.now();
  if (deltaMs <= 0) return "Due now";
  const minutes = Math.max(1, Math.ceil(deltaMs / 60_000));
  return `~${minutes}m`;
}

async function fetchMarketContext(url: string): Promise<string | null> {
  const response = await fetch("/api/market-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { context?: unknown };
  return typeof data.context === "string" && data.context.trim() ? data.context : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseProphecyEventUrl(value: string): { valid: boolean; eventId: string | null } {
  if (!value) return { valid: false, eventId: null };
  try {
    const u = new URL(value);
    const parts = u.pathname.split("/").filter(Boolean);
    const eventIndex = parts.findIndex((p) => p === "event");
    const eventId = eventIndex >= 0 ? parts[eventIndex + 1] : null;
    const isProphecy = u.hostname === "prophecy.social" || u.hostname.endsWith(".prophecy.social");
    const valid = isProphecy && eventId !== null && /^\d+$/.test(eventId);
    return { valid, eventId: valid ? eventId : null };
  } catch {
    return { valid: false, eventId: null };
  }
}

function parseSeedUrls(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(isValidHttpUrl)
    .slice(0, 3);
}

function buildScoutAnalysisAsk(scout: ScoutForm, candidate?: ScoutCandidate): string {
  const minProbability = Number(scout.minProbability || 0);
  const minEdge = Number(scout.minEdge || 0);
  const minConfidence = Number(scout.minConfidence || 0);
  return [
    "Act as an autonomous prediction-market research agent.",
    `User mission: ${scout.objective.trim() || INITIAL_SCOUT_FORM.objective}`,
    `User alert thresholds: model probability >= ${minProbability || 0}%, edge >= ${minEdge || 0} percentage points, confidence >= ${minConfidence || 0}%.`,
    candidate?.marketProbability !== undefined
      ? `Observed Prophecy market probability: ${(candidate.marketProbability * 100).toFixed(1)}%.`
      : "Observed Prophecy market probability: unknown; infer if available from page context.",
    "Your job is not just to predict the outcome. Find whether this market is mispriced.",
    "Compare your evidence-based modelProbability against the marketProbability/crowd signal.",
    "For multi-option or multi-submarket events, never answer only YES or NO. Pick one exact submarket/outcome and include exactOutcomeLabel, selectedMarketId when present, and side.",
    "Treat an outcome labeled 'Other' as a bucket for any winner/outcome not separately listed. Do not treat Other as one specific player/team/asset/person unless the market explicitly defines it that way.",
    "Use side WATCH when no candidate has a clear edge. The prediction should then say watch/no clear edge for the named outcome, not plain YES or NO.",
    "Only mark a strong opportunity when the evidence is clear, resolution criteria are clear, and the edge is meaningful.",
    "If the market is efficient, unclear, low quality, or lacks enough evidence, say watch/no clear edge or avoid.",
    "Return the full JSON schema requested by the app, especially exactOutcomeLabel, selectedMarketId, side, modelProbability, marketProbability, edge, opportunityScore, resolutionClarity, riskLevel, suggestedUserAction, and sourcesUsed.",
  ].join("\n");
}

function buildCompanionPrompt(form: QueryForm, eventId: string): string {
  const analysisAsk = form.analysisAsk.trim();
  const extraContext = form.extraContext.trim();
  const ask =
    analysisAsk ||
    "Given the market details and official resolution criteria, estimate outcome probability with reasoning.";

  return [
    "You are Prophecy Companion.",
    `Analyze this Prophecy market URL: ${form.prophecyEventUrl.trim()}.`,
    `Prophecy event id: ${eventId}.`,
    `Question: ${ask}`,
    "Optional user-provided market snapshot (title, options, current state, resolution rule):",
    extraContext || "not provided",
    "If the snapshot is not provided, use the event URL and any available agent/web extraction capability to infer the market details.",
    "Use the Prophecy page data as crowd/context signal, not as truth.",
    "If the app-provided context contains Structured Prophecy market records, External/source-reference evidence, or External web research evidence, use those facts directly.",
    "Do not say there is no external evidence when source-reference summaries, web research, odds pages, official sports pages, news pages, or market source links are present in the context.",
    "Use external evidence where available: sports form, H2H, injuries, lineups, odds, news, sentiment, macro context, or domain-specific facts.",
    "For non-sports markets, adapt the evidence to politics, crypto, weather, entertainment, finance, or recent public information.",
    "For multi-option or multi-submarket events, never return a bare YES or NO. Select one exact candidate/outcome and make prediction read like 'YES on Event Title: Option Name', 'NO on Event Title: Option Name', or 'watch/no clear edge on Event Title: Option Name'.",
    "If app context includes marketId or Outcome option fields, copy the selected candidate into exactOutcomeLabel and selectedMarketId. Set side to YES, NO, or WATCH.",
    "If the selected Outcome option is Other, describe it as a bucket for anyone/anything not separately listed. Do not equate it to one named candidate; named candidates can only be examples inside the bucket.",
    "If side is WATCH because edge is positive but below the user's/action threshold, say that directly and do not frame it as an actionable pick.",
    "Explain the market structure, candidate-specific evidence, counter-evidence, uncertainty drivers, and what would change the view.",
    "Use safer wording like 'lean YES', 'lean NO', 'watch/no clear edge', or 'avoid'. Do not tell users to gamble or present this as betting/financial advice.",
    "If snapshot or external evidence is missing, reduce confidence and explain what is missing.",
    "For edge: if prediction is YES, edge = modelProbability - marketProbability. If prediction is NO, edge = (1 - modelProbability) - (1 - marketProbability). If marketProbability is unknown, set edge to null.",
    "A high market probability alone is not an opportunity. A strong opportunity needs positive edge, useful evidence, clear resolution, and manageable risk.",
    "Return only valid JSON with keys:",
    "prediction (string), side (YES|NO|WATCH), exactOutcomeLabel (string|null), selectedMarketId (string|number|null), probability (number 0..1), modelProbability (number 0..1), marketProbability (number 0..1 or null), edge (number -1..1 or null), confidence (number 0..1 or string), opportunityScore (number 0..1), resolutionClarity (number 0..1 or string), riskLevel (string), reasoning (string), marketStructure (string), resolutionCriteria (string), marketSummary (string), keyEvidence (string[]), counterEvidence (string[]), crowdSignal (string), externalEvidenceSummary (string), uncertaintyDrivers (string[]), risks (string[]), suggestedUserAction (string), sourcesUsed (string[]).",
    "Do not include markdown or code fences.",
  ].join("\n");
}

function buildExecutionPayload(agent: AgentConfig, form: QueryForm): `0x${string}` {
  const prophecyEventUrl = form.prophecyEventUrl.trim();
  if (!isValidHttpUrl(prophecyEventUrl)) {
    throw new Error("Event URL must be a valid http(s) URL.");
  }

  const parsed = parseProphecyEventUrl(prophecyEventUrl);
  if (!parsed.valid || !parsed.eventId) {
    throw new Error("Use a valid Prophecy event URL, e.g. https://prophecy.social/event/14776");
  }

  const prompt = buildCompanionPrompt(form, parsed.eventId);

  if (agent.agentType === AgentType.WEBSITE_PARSE) {
    return encodeFunctionData({
      abi: SOMNIA_WEBSITE_PARSE_ABI,
      functionName: "ExtractString",
      args: [
        "analysis",
        "Structured market analysis with outcome probability and resolution criteria.",
        [],
        prompt,
        prophecyEventUrl,
        false,
        2,
      ],
    });
  }

  if (agent.agentType === AgentType.LLM_INFERENCE) {
    return encodeFunctionData({
      abi: SOMNIA_LLM_ABI,
      functionName: "inferString",
      args: [
        `${prompt}\nMarket URL: ${prophecyEventUrl}`,
        "You are a prediction analysis assistant for Prophecy markets.",
        false,
        [],
      ],
    });
  }

  throw new Error(
    `Unsupported agent type for Companion: ${AgentType[agent.agentType]}. Use WEBSITE_PARSE or LLM_INFERENCE.`
  );
}

function analysisSubmissionError(error: unknown): string {
  const details: string[] = [];
  let current: unknown = error;

  for (let i = 0; current && i < 4; i++) {
    if (typeof current === "object") {
      const value = current as {
        shortMessage?: unknown;
        details?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      for (const item of [value.shortMessage, value.details, value.message]) {
        if (typeof item === "string") details.push(item);
      }
      current = value.cause;
    } else {
      details.push(String(current));
      break;
    }
  }

  const message = details.join("\n");
  if (/fetch failed|failed to fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return "Network connection issue. Please try again in a moment.";
  }
  if (message.includes("0x0ede9759")) {
    return "Signal execution is temporarily unavailable. No fee was submitted.";
  }
  if (message.includes("SASExecutor: insufficient Somnia reserve")) {
    return "This legacy executor still requires an operator reserve. Switch the app to the user-funded billing deployment.";
  }
  if (message.includes("SASBilling: incorrect payment amount")) {
    return "Analysis fee is out of sync with the billing deployment. Reload the latest app version and try again.";
  }
  if (message.includes("User rejected") || message.includes("user rejected")) {
    return "Transaction cancelled in wallet.";
  }

  return details[0] || "Analysis transaction failed before submission.";
}

function friendlyStatusMessage(value: string | null | undefined): string {
  if (!value) return "Status is pending.";
  if (/fetch failed|failed to fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(value)) {
    return "Connection issue. Please try again.";
  }
  if (/No funded health-check account|COMPANION_RUNTIME_HEALTH_ACCOUNT/i.test(value)) {
    return "Connect a wallet to check live signal execution.";
  }
  if (/Supabase|Postgres|heartbeat|relayer\/indexer|indexer/i.test(value)) {
    return "Live automation data is syncing.";
  }
  if (/one-shot runtime|runtime preflight|Somnia runtime/i.test(value)) {
    return "Signal execution is warming up. Try again shortly.";
  }
  return value;
}

function PCLoadingOverlay({
  active,
  title,
  subtitle,
}: {
  active: boolean;
  title: string;
  subtitle: string;
}) {
  if (!active) return null;
  return (
    <div className="pc-loading-overlay" role="status" aria-live="polite">
      <div className="pc-loader-card">
        <div className="pc-loader-mark">
          <Image src="/pc-logo.png" alt="Prophecy Companion" width={82} height={82} priority />
        </div>
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
        <div className="pc-loader-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

async function assertOneShotBillingReady(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  account: `0x${string}`;
  selectedAgent: AgentConfig;
  encodedPayload: `0x${string}`;
  quotedTotalCost: bigint;
}) {
  const [billingRegistry, billingExecutor, billingPaused] = await Promise.all([
    input.publicClient.readContract({
      address: SAS.billing,
      abi: BILLING_ABI,
      functionName: "registry",
    }),
    input.publicClient.readContract({
      address: SAS.billing,
      abi: BILLING_ABI,
      functionName: "executor",
    }),
    input.publicClient.readContract({
      address: SAS.billing,
      abi: BILLING_ABI,
      functionName: "paused",
    }),
  ]);

  if (billingRegistry.toLowerCase() !== SAS.registry.toLowerCase()) {
    throw new Error(
      "Configured billing and registry contracts come from different deployments. Reload the latest app configuration."
    );
  }
  if (billingPaused) {
    throw new Error("One-shot paid analysis is paused on the billing contract.");
  }
  if (billingExecutor.toLowerCase() !== SAS.executor.toLowerCase()) {
    throw new Error("Configured billing and executor contracts do not match the deployed billing configuration.");
  }

  const executorBilling = await input.publicClient.readContract({
    address: SAS.executor,
    abi: EXECUTOR_ABI,
    functionName: "billing",
  });
  if (executorBilling.toLowerCase() !== SAS.billing.toLowerCase()) {
    throw new Error("Configured executor is not wired back to the billing contract.");
  }
  if (input.selectedAgent.somniaAgentId <= 0n) {
    throw new Error("This SAS agent is not linked to a Somnia Agent runtime.");
  }

  try {
    await input.publicClient.simulateContract({
      account: input.account,
      address: SAS.billing,
      abi: BILLING_ABI,
      functionName: "executeAgent",
      args: [input.selectedAgent.id, input.encodedPayload],
      value: input.quotedTotalCost,
    });
  } catch (error) {
    throw new Error(analysisSubmissionError(error));
  }
}

export default function ProphecyCompanionPage() {
  const { authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const { writeContractAsync, isPending: isSubmitting } = useWriteContract();
  const pathname = usePathname();
  const router = useRouter();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: SOMNIA_TESTNET,
        transport: http("https://api.infra.testnet.somnia.network"),
      }),
    []
  );

  const [form, setForm] = useState<QueryForm>(INITIAL_FORM);
  const [scoutForm, setScoutForm] = useState<ScoutForm>(INITIAL_SCOUT_FORM);
  const [scoutCandidates, setScoutCandidates] = useState<ScoutCandidate[]>([]);
  const [scoutMessage, setScoutMessage] = useState<string | null>(null);
  const [isScouting, setIsScouting] = useState(false);
  const [lastExecutionId, setLastExecutionId] = useState<bigint | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | null>(null);
  const [watchedMarkets, setWatchedMarkets] = useState<WatchedMarket[]>([]);
  const [watchStorageReady, setWatchStorageReady] = useState(false);
  const [watchUrl, setWatchUrl] = useState("");
  const [watchQuestion, setWatchQuestion] = useState(INITIAL_FORM.analysisAsk);
  const [watchCadence, setWatchCadence] = useState("15");
  const [missionMaxRuns, setMissionMaxRuns] = useState(DEFAULT_MISSION_MAX_RUNS);
  const [missionDurationDays, setMissionDurationDays] = useState(DEFAULT_MISSION_DURATION_DAYS);
  const [missionFundAmount, setMissionFundAmount] = useState("1");
  const [maxRelayerFee, setMaxRelayerFee] = useState(DEFAULT_AUTOPILOT_RELAYER_FEE_STT);
  const [strategyForm, setStrategyForm] = useState<StrategyForm>(INITIAL_STRATEGY_FORM);
  const [tradeIdeas, setTradeIdeas] = useState<TradeIdea[]>([]);
  const [traderMissionId, setTraderMissionId] = useState<`0x${string}` | null>(null);
  const [strategyStorageReady, setStrategyStorageReady] = useState(false);
  const [autoMonitor, setAutoMonitor] = useState(false);
  const [autopilotRuns, setAutopilotRuns] = useState<AutopilotRun[]>([]);
  const [autopilotRunsLoading, setAutopilotRunsLoading] = useState(false);
  const [opsData, setOpsData] = useState<OpsData | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [selectedEvidenceRun, setSelectedEvidenceRun] = useState<OpsRun | AutopilotRun | null>(null);
  const [selectedTradeIdea, setSelectedTradeIdea] = useState<TradeIdea | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("billing");
  const [autonomyBudgetStt, setAutonomyBudgetStt] = useState("1");
  const [autonomyMaxDepth, setAutonomyMaxDepth] = useState("4");
  const [autonomyAutoDelegate, setAutonomyAutoDelegate] = useState(true);
  const [autonomyMaxDelegates, setAutonomyMaxDelegates] = useState("2");
  const [lastWorkflowId, setLastWorkflowId] = useState<bigint | null>(null);
  const [workflowRecoveryId, setWorkflowRecoveryId] = useState("1");
  const [delegatedAgentIds, setDelegatedAgentIds] = useState<bigint[]>([]);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [runtimeHealthLoading, setRuntimeHealthLoading] = useState(false);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealthResponse | null>(null);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const activeWorkspace = useMemo<Workspace>(() => {
    const segment = pathname.split("/").filter(Boolean)[0];
    if (segment === "scout" || segment === "autopilot" || segment === "runs" || segment === "settings") {
      return segment;
    }
    return "analysis";
  }, [pathname]);

  const { data: allActiveAgents } = useReadContract({
    address: SAS.registry,
    abi: REGISTRY_ABI,
    functionName: "getAllActiveAgents",
    query: { refetchInterval: 20_000 },
  });

  const allAgents = (allActiveAgents as AgentConfig[] | undefined) ?? [];

  const companionCandidates = useMemo(
    () =>
      allAgents.filter(
        (a) =>
          a.somniaAgentId > 0n &&
          Number(a.status) === AgentStatus.ACTIVE
      ),
    [allAgents]
  );

  const selectedAgent = useMemo(() => {
    if (!CONFIGURED_SAS_AGENT_ID) return null;
    return companionCandidates.find((a) => a.id === CONFIGURED_SAS_AGENT_ID) ?? null;
  }, [companionCandidates]);
  const { data: nativeBalance, isLoading: nativeBalanceLoading } = useBalance({
    address,
    chainId: SOMNIA_TESTNET.id,
    query: { enabled: Boolean(address) },
  });
  const walletBalanceLabel = address
    ? nativeBalanceLoading
      ? "Loading STT"
      : nativeBalance
        ? `${Number(formatEther(nativeBalance.value)).toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })} ${nativeBalance.symbol || "STT"}`
        : "0 STT"
    : "0 STT";
  const autonomyModeAvailable = SAS.autonomyV4.toLowerCase() !== "0x0000000000000000000000000000000000000000";
  const delegationCandidates = useMemo(
    () =>
      companionCandidates.filter(
        (agent) =>
          (selectedAgent ? agent.id !== selectedAgent.id : true) &&
          (agent.agentType === AgentType.WEBSITE_PARSE ||
            agent.agentType === AgentType.LLM_INFERENCE)
      ),
    [companionCandidates, selectedAgent]
  );
  const manualDelegatedAgents = useMemo(() => {
    const byId = new Map(delegationCandidates.map((agent) => [agent.id.toString(), agent] as const));
    return delegatedAgentIds
      .map((id) => byId.get(id.toString()))
      .filter((agent): agent is AgentConfig => Boolean(agent));
  }, [delegatedAgentIds, delegationCandidates]);
  const maxDelegates = useMemo(
    () => parsePositiveInt(autonomyMaxDelegates, 2),
    [autonomyMaxDelegates]
  );
  const autoDelegatedAgents = useMemo(
    () => planAutoDelegates(selectedAgent, delegationCandidates, maxDelegates),
    [selectedAgent, delegationCandidates, maxDelegates]
  );
  const delegatedAgents = autonomyAutoDelegate ? autoDelegatedAgents : manualDelegatedAgents;
  const plannedWorkflowAgents = useMemo(
    () => (selectedAgent ? [selectedAgent, ...delegatedAgents] : []),
    [selectedAgent, delegatedAgents]
  );

  const configuredSomniaIdMatches =
    !selectedAgent ||
    !CONFIGURED_SOMNIA_AGENT_ID ||
    selectedAgent.somniaAgentId === CONFIGURED_SOMNIA_AGENT_ID;
  const agentTypeSupported =
    !selectedAgent ||
    selectedAgent.agentType === AgentType.WEBSITE_PARSE ||
    selectedAgent.agentType === AgentType.LLM_INFERENCE;

  const { data: executionRecord } = useReadContract({
    address: SAS.billing,
    abi: BILLING_ABI,
    functionName: "getExecutionRecord",
    args: lastExecutionId ? [lastExecutionId] : undefined,
    query: {
      enabled: Boolean(lastExecutionId),
      refetchInterval: (q: { state: { data?: unknown } }) => {
        const r = q.state.data as ExecutionRecord | undefined;
        if (!r) return 3000;
        return Number(r.status) === ExecutionStatus.PENDING ? 3000 : 15000;
      },
    },
  });

  const { data: recentRecordsData } = useReadContract({
    address: SAS.billing,
    abi: BILLING_ABI,
    functionName: "getAgentExecutions",
    args: selectedAgent ? [selectedAgent.id] : undefined,
    query: {
      enabled: Boolean(selectedAgent),
      refetchInterval: 12000,
    },
  });

  const { data: executionQuoteData } = useReadContract({
    address: SAS.billing,
    abi: BILLING_ABI,
    functionName: "quoteExecution",
    args: selectedAgent ? [selectedAgent.id] : undefined,
    query: {
      enabled: Boolean(selectedAgent),
      refetchInterval: 12000,
    },
  });

  const recentRecords = ((recentRecordsData as ExecutionRecord[] | undefined) ?? [])
    .slice()
    .reverse()
    .slice(0, 8);

  const latest = executionRecord as ExecutionRecord | undefined;
  const executionQuote = executionQuoteData as readonly [bigint, bigint, bigint] | undefined;
  const quotedAgentFee = executionQuote?.[0] ?? selectedAgent?.pricePerExecution;
  const quotedRuntimeBudget = executionQuote?.[1];
  const quotedTotalCost = executionQuote?.[2];
  const userFundedBillingReady = quotedTotalCost !== undefined;
  const oneShotRuntimeCheckRequired = selectedAgent?.agentType === AgentType.LLM_INFERENCE;
  const oneShotRuntimeHealthy =
    !oneShotRuntimeCheckRequired ||
    runtimeHealth?.ok === true ||
    runtimeHealth?.status === "not_checked";
  const analysisExecutionReady =
    executionMode === "billing"
      ? userFundedBillingReady && oneShotRuntimeHealthy
      : autonomyModeAvailable;
  const availableDelegationAgents = delegationCandidates.filter(
    (agent) => !delegatedAgentIds.some((id) => id === agent.id)
  );
  const latestResultRaw = decodeExecutionString(latest?.result);
  const latestSummary = parseResultSummary(latestResultRaw);
  const latestPredictionLabel = displayPrediction(latestSummary);
  const latestOutcomeLabel = displayOutcomeLabel(latestSummary);
  const parsedEvent = parseProphecyEventUrl(form.prophecyEventUrl.trim());
  const latestHeartbeat = opsData?.heartbeats?.[0];
  const relayerStale = isRelayerStale(latestHeartbeat);
  const renderServices = serviceHealth?.services ?? [];
  const healthyRenderServices = renderServices.filter((service) => service.ok).length;
  const renderServicesReady = renderServices.length > 0 && healthyRenderServices === renderServices.length;
  const policyCostPreview = estimatePolicyCost({
    maxRuns: missionMaxRuns,
    funding: missionFundAmount,
    relayerFee: maxRelayerFee,
    executionCost: quotedTotalCost,
  });
  const opsMissionById = useMemo(() => {
    const map = new Map<string, OpsMission>();
    for (const mission of opsData?.missions ?? []) map.set(mission.mission_id.toLowerCase(), mission);
    return map;
  }, [opsData]);
  const contextByHash = useMemo(() => {
    const map = new Map<string, OpsContext>();
    for (const context of opsData?.contexts ?? []) map.set(context.context_hash.toLowerCase(), context);
    return map;
  }, [opsData]);
  const visibleWatchedMarkets = useMemo(
    () => watchedMarkets.filter((watch) => watch.status !== "archived"),
    [watchedMarkets]
  );
  const opsTradeIdeas = useMemo(
    () => (opsData?.traderPositions ?? []).map(opsTraderPositionToTradeIdea),
    [opsData]
  );
  const activeTradeIdeas = useMemo(() => {
    const seen = new Set<string>();
    const combined = [...opsTradeIdeas, ...tradeIdeas.filter((idea) => idea.status !== "archived")];
    return combined.filter((idea) => {
      const key = `${idea.eventId}:${idea.marketId ?? idea.subMarketTitle}:${idea.createdAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [opsTradeIdeas, tradeIdeas]);
  const strategyPaperPnl = useMemo(
    () => activeTradeIdeas.reduce((sum, idea) => sum + tradeIdeaPaperPnl(idea), 0),
    [activeTradeIdeas]
  );
  const strategyCapital = parsePositiveFloat(strategyForm.capitalUsd, 100);
  const traderPolicy = deriveTraderPolicy(strategyForm);
  const traderBalance = currentTraderBalance(strategyForm, activeTradeIdeas);
  const displayTradeIdeas = useMemo(() => {
    const normalized = new Map<string, TradeIdea>();
    let balanceCursor = strategyCapital;
    for (const idea of activeTradeIdeas.slice().sort((a, b) => a.createdAt - b.createdAt)) {
      const before = Number(balanceCursor.toFixed(2));
      let after = balanceCursor;
      if (idea.status === "open") after -= idea.stakeUsd;
      else if (idea.status === "lost") after -= idea.stakeUsd;
      else if (idea.status === "won") after += idea.stakeUsd * ((idea.realizedReturnPct ?? idea.expectedReturnPct ?? 0) / 100);
      balanceCursor = after;
      const fallbackModelProbability =
        idea.modelProbability ??
        (typeof idea.marketProbability === "number"
          ? clampNumber(idea.marketProbability + traderPolicy.minEdgePct / 100, 0.01, 0.99)
          : null);
      const fallbackEdgePct =
        idea.edgePct ??
        (fallbackModelProbability === null || typeof idea.marketProbability !== "number"
          ? null
          : Number(((fallbackModelProbability - idea.marketProbability) * 100).toFixed(1)));
      const fallbackExpectedReturnPct =
        idea.expectedReturnPct ??
        (fallbackModelProbability === null || typeof idea.marketProbability !== "number" || idea.marketProbability <= 0
          ? null
          : Number((((fallbackModelProbability / idea.marketProbability) - 1) * 100).toFixed(1)));
      normalized.set(idea.id, {
        ...idea,
        modelProbability: fallbackModelProbability,
        edgePct: fallbackEdgePct,
        expectedReturnPct: fallbackExpectedReturnPct,
        balanceBeforeUsd: before,
        balanceAfterUsd: idea.status === "open" ? undefined : Number(after.toFixed(2)),
      });
    }
    return activeTradeIdeas.map((idea) => normalized.get(idea.id) ?? idea);
  }, [activeTradeIdeas, strategyCapital, traderPolicy.minEdgePct]);
  const traderPeriodEndsAt = Date.now() + parsePositiveInt(strategyForm.horizonDays, 3) * 86_400_000;
  const strategyTargetPnl = strategyCapital * (parsePositiveFloat(strategyForm.targetReturnPct, 100) / 100);
  const strategyProgressPct = strategyTargetPnl > 0 ? clampNumber((strategyPaperPnl / strategyTargetPnl) * 100, -100, 100) : 0;

  useEffect(() => {
    setDelegatedAgentIds((prev) => {
      const valid = new Set(delegationCandidates.map((agent) => agent.id.toString()));
      return prev.filter((id) => valid.has(id.toString()));
    });
  }, [delegationCandidates]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedAgent) {
      setRuntimeHealth(null);
      setRuntimeHealthLoading(false);
      return;
    }

    if (selectedAgent.agentType !== AgentType.LLM_INFERENCE) {
      setRuntimeHealth({
        ok: true,
        status: "not_checked",
        reason: "Signal execution is ready for this agent.",
      });
      setRuntimeHealthLoading(false);
      return;
    }

    const params = new URLSearchParams({
      agentId: selectedAgent.id.toString(),
      agentType: String(selectedAgent.agentType),
    });
    if (address) params.set("account", address);

    setRuntimeHealthLoading(true);
    setRuntimeHealth({
      ok: false,
      status: "checking",
      reason: "Checking signal execution...",
    });

    fetch(`/api/somnia-runtime-health?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as RuntimeHealth;
        if (!response.ok && !data.reason) {
          throw new Error("Signal execution check failed.");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) setRuntimeHealth(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeHealth({
            ok: false,
            status: "unknown",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setRuntimeHealthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, selectedAgent]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WATCH_STORAGE_KEY);
      if (!raw) {
        setWatchStorageReady(true);
        return;
      }
      const parsed = JSON.parse(raw) as WatchedMarket[];
      if (Array.isArray(parsed)) {
        setWatchedMarkets(
          parsed
            .filter((watch) => watch && typeof watch.url === "string")
            .map((watch) => ({
              ...watch,
              status: watch.status === "archived" ? "archived" : watch.status ?? "watching",
              maxRuns: Number.isFinite(watch.maxRuns) ? watch.maxRuns : 12,
              expiresAt: Number.isFinite(watch.expiresAt)
                ? watch.expiresAt
                : Date.now() + 7 * 86_400_000,
            }))
        );
      }
    } catch {
      setWatchedMarkets([]);
    } finally {
      setWatchStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!watchStorageReady) return;
    window.localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watchedMarkets));
  }, [watchStorageReady, watchedMarkets]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STRATEGY_STORAGE_KEY);
      if (!raw) {
        setStrategyStorageReady(true);
        return;
      }
      const parsed = JSON.parse(raw) as { form?: StrategyForm; ideas?: TradeIdea[]; missionId?: `0x${string}` | null };
      if (parsed.form) setStrategyForm({ ...INITIAL_STRATEGY_FORM, ...parsed.form });
      if (parsed.missionId && /^0x[a-fA-F0-9]{64}$/.test(parsed.missionId)) {
        setTraderMissionId(parsed.missionId);
      }
      if (Array.isArray(parsed.ideas)) {
        setTradeIdeas(
          parsed.ideas
            .filter((idea) => idea && typeof idea.url === "string")
            .map((idea) => {
              const legacy = idea as TradeIdea & { pseudoAllocationUsd?: number };
              const stakeUsd = Number.isFinite(legacy.stakeUsd)
                ? legacy.stakeUsd
                : Number.isFinite(legacy.pseudoAllocationUsd)
                  ? legacy.pseudoAllocationUsd!
                  : 0;
              const status: TradeIdeaStatus =
                legacy.status === "archived"
                  ? "archived"
                  : legacy.outcomeNote?.toLowerCase().includes("adapter-confirmed")
                    ? legacy.status
                    : "open";
              return {
                ...legacy,
                marketId: legacy.marketId,
                subMarketTitle: legacy.subMarketTitle || legacy.title,
                stakeUsd,
                balanceBeforeUsd: Number.isFinite(legacy.balanceBeforeUsd) ? legacy.balanceBeforeUsd : legacy.capitalUsd,
                status,
                outcomeNote:
                  status === "open" && legacy.status !== "open"
                    ? "Reset to open because settlement has not been adapter-confirmed."
                    : legacy.outcomeNote,
              };
            })
        );
      }
    } catch {
      setTradeIdeas([]);
    } finally {
      setStrategyStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!strategyStorageReady) return;
    window.localStorage.setItem(
      STRATEGY_STORAGE_KEY,
      JSON.stringify({ form: strategyForm, ideas: tradeIdeas, missionId: traderMissionId })
    );
  }, [strategyStorageReady, strategyForm, tradeIdeas, traderMissionId]);

  useEffect(() => {
    if (!autoMonitor || watchedMarkets.length === 0) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      for (const watch of watchedMarkets) {
        if (watch.status === "paused" || watch.status === "archived") continue;
        const dueAt = (watch.lastCheckedAt ?? 0) + watch.cadenceMinutes * 60_000;
        if (now >= dueAt && watch.status !== "checking") {
          void monitorWatch(watch.id);
        }
      }
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [autoMonitor, watchedMarkets]);

  useEffect(() => {
    if (activeWorkspace !== "autopilot" && activeWorkspace !== "runs" && activeWorkspace !== "settings") return;
    void refreshOpsData();
  }, [activeWorkspace, address]);

  useEffect(() => {
    let cancelled = false;

    async function refreshServiceHealth() {
      try {
        const response = await fetch("/api/service-health", { cache: "no-store" });
        const data = (await response.json()) as ServiceHealthResponse;
        if (!cancelled) setServiceHealth(data);
      } catch {
        if (!cancelled) setServiceHealth(null);
      }
    }

    void refreshServiceHealth();
    const interval = window.setInterval(refreshServiceHealth, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (activeWorkspace === "analysis") {
      const raw = window.localStorage.getItem(ANALYSIS_PREFILL_KEY);
      if (!raw) return;
      try {
        const next = JSON.parse(raw) as QueryForm;
        setForm(next);
        window.localStorage.removeItem(ANALYSIS_PREFILL_KEY);
      } catch {
        window.localStorage.removeItem(ANALYSIS_PREFILL_KEY);
      }
    }

    if (activeWorkspace === "autopilot") {
      const raw = window.localStorage.getItem(WATCH_PREFILL_KEY);
      if (!raw) return;
      try {
        const next = JSON.parse(raw) as Pick<WatchedMarket, "url" | "question" | "lastContext">;
        setWatchUrl(next.url);
        setWatchQuestion(next.question);
        window.localStorage.removeItem(WATCH_PREFILL_KEY);
      } catch {
        window.localStorage.removeItem(WATCH_PREFILL_KEY);
      }
    }
  }, [activeWorkspace]);

  function update<K extends keyof QueryForm>(key: K, value: QueryForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateScout<K extends keyof ScoutForm>(key: K, value: ScoutForm[K]) {
    setScoutForm((prev) => ({ ...prev, [key]: value }));
  }

  async function discoverOpportunities() {
    setIsScouting(true);
    try {
      const response = await fetch("/api/market-discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: scoutForm.objective,
          limit: Math.max(1, Math.min(50, Number(scoutForm.limit) || 12)),
          seedUrls: parseSeedUrls(scoutForm.seedUrls),
        }),
      });

      const data = (await response.json()) as {
        candidates?: Omit<ScoutCandidate, "discoveredAt">[];
        message?: string;
        filteredStaleCount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not discover markets.");

      const candidates = (data.candidates ?? []).map((candidate) => ({
        ...candidate,
        discoveredAt: Date.now(),
      }));
      setScoutCandidates(candidates);
      setScoutMessage(data.message ?? null);
      if (candidates.length > 0) {
        toast.success(`Scout found ${candidates.length} active candidate market${candidates.length === 1 ? "" : "s"}.`);
      } else {
        toast.warning(data.message ?? "Scout did not find active tradable markets.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setIsScouting(false);
    }
  }

  function loadCandidateForAnalysis(candidate: ScoutCandidate) {
    const next = {
      prophecyEventUrl: candidate.url,
      analysisAsk: buildScoutAnalysisAsk(scoutForm, candidate),
      extraContext: candidate.context,
    };
    setForm(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ANALYSIS_PREFILL_KEY, JSON.stringify(next));
    }
    toast.message(`Candidate #${candidate.eventId} loaded for edge analysis.`);
    router.push("/analysis?prefilled=scout");
  }

  function createWatchFromCandidate(candidate: ScoutCandidate) {
    const id = `${candidate.eventId}-${Date.now()}`;
    const next: WatchedMarket = {
      id,
      url: candidate.url,
      question: buildScoutAnalysisAsk(scoutForm, candidate),
      cadenceMinutes: 15,
      maxRuns: Math.max(1, Math.min(100, parsePositiveInt(missionMaxRuns, 12))),
      expiresAt: Date.now() + Math.max(1, Math.min(90, parsePositiveInt(missionDurationDays, 7))) * 86_400_000,
      createdAt: Date.now(),
      lastContext: candidate.context,
      lastContextHash: fingerprint(candidate.context),
      lastSignal: candidate.title ?? candidate.description ?? "Scout candidate loaded.",
      status: "watching",
    };

    setWatchedMarkets((prev) => [next, ...prev]);
    setWatchUrl(candidate.url);
    setWatchQuestion(buildScoutAnalysisAsk(scoutForm, candidate));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        WATCH_PREFILL_KEY,
        JSON.stringify({
          url: candidate.url,
          question: buildScoutAnalysisAsk(scoutForm, candidate),
          lastContext: candidate.context,
        })
      );
    }
    toast.success(`Candidate #${candidate.eventId} loaded into PC Autopilot.`);
    router.push("/autopilot?prefilled=scout");
  }

  function updateStrategy<K extends keyof StrategyForm>(key: K, value: StrategyForm[K]) {
    setStrategyForm((prev) => ({ ...prev, [key]: value }));
  }

  async function runTraderCycle() {
    if (!authenticated || !address) {
      toast.error("Sign in first.");
      return;
    }
    if (!selectedAgent) {
      toast.error("No configured PC agent available for paid trader cycle.");
      return;
    }
    if (quotedTotalCost === undefined) {
      toast.error("Trader cycle cost is unavailable from SASBilling.");
      return;
    }
    if (!oneShotRuntimeHealthy) {
      toast.error(friendlyStatusMessage(runtimeHealth?.reason) || "Signal execution is paused.");
      return;
    }
    if (scoutCandidates.length === 0) {
      toast.error("Run Scout first so the trader has live markets to choose from.");
      router.push("/scout");
      return;
    }

    const policy = deriveTraderPolicy(strategyForm);
    const openPositions = activeTradeIdeas.filter((idea) => idea.status === "open").length;
    if (openPositions >= policy.maxPositions) {
      toast.message(`Trader already has ${openPositions}/${policy.maxPositions} open paper stakes.`);
      return;
    }

    const remainingBalance = currentTraderBalance(strategyForm, activeTradeIdeas);
    if (remainingBalance < 1) {
      toast.error("Trader stopped: strategy capital is exhausted.");
      return;
    }

    const oldestTrade = activeTradeIdeas[activeTradeIdeas.length - 1];
    const startedAt = oldestTrade?.createdAt ?? Date.now();
    const periodEndsAt = startedAt + parsePositiveInt(strategyForm.horizonDays, 3) * 86_400_000;
    if (Date.now() > periodEndsAt) {
      toast.error("Trader stopped: strategy period has ended.");
      return;
    }

    const alreadyPicked = new Set(activeTradeIdeas.map(tradeMarketKey));
    let balanceCursor = remainingBalance;
    const slots = Math.min(1, policy.maxPositions - openPositions);
    const ideas: TradeIdea[] = [];
    const candidateByKey = new Map(scoutCandidates.map((candidate) => [candidateMarketKey(candidate), candidate] as const));

    const ranked = scoutCandidates
      .filter((candidate) => {
        if (alreadyPicked.has(candidateMarketKey(candidate))) return false;
        return true;
      })
      .map((candidate, index) => candidateToTradeIdea(candidate, strategyForm, balanceCursor, policy, index))
      .filter((idea) => idea.suggestedMove !== "WATCH" && (idea.edgePct ?? 0) >= policy.minEdgePct)
      .sort((a, b) => ((b.edgePct ?? 0) + (b.expectedReturnPct ?? 0) * 0.2) - ((a.edgePct ?? 0) + (a.expectedReturnPct ?? 0) * 0.2));

    for (const idea of ranked) {
      if (ideas.length >= slots || balanceCursor < 1) break;
      const next = { ...idea, balanceBeforeUsd: Number(balanceCursor.toFixed(2)) };
      const sourceCandidate = candidateByKey.get(tradeMarketKey(idea));
      if (!sourceCandidate) continue;
      const resized = candidateToTradeIdea(
        sourceCandidate,
        strategyForm,
        balanceCursor,
        policy,
        ideas.length
      );
      ideas.push({ ...resized, balanceBeforeUsd: next.balanceBeforeUsd });
      balanceCursor -= resized.stakeUsd;
    }

    if (ideas.length === 0) {
      toast.warning("Trader found no markets that satisfy its autonomous policy yet.");
      return;
    }

    const cycleForm: QueryForm = {
      prophecyEventUrl: ideas[0].url,
      analysisAsk: [
        "Run a paid Prophecy Companion autonomous trader cycle.",
        `Strategy capital: $${parsePositiveFloat(strategyForm.capitalUsd, 100).toFixed(2)}.`,
        `Remaining balance before cycle: $${remainingBalance.toFixed(2)}.`,
        `Target return: ${parsePositiveFloat(strategyForm.targetReturnPct, 100).toFixed(1)}% over ${parsePositiveInt(strategyForm.horizonDays, 3)} days.`,
        `Agent-derived policy: ${riskLabel(policy.risk)}, max ${policy.maxPositions} positions, min edge ${policy.minEdgePct}%, min confidence ${policy.minConfidencePct}%.`,
        "Return JSON evaluating whether the selected paper stakes are coherent.",
        "Do not claim real Prophecy execution occurred.",
        "Do not claim any selected market settled, won, lost, or voided. Settlement can only be confirmed by the Prophecy resolution adapter after the resolution-check time.",
      ].join(" "),
      extraContext: [
        "Autonomous trader selected these paper stakes after ranking live Scout candidates:",
        ...ideas.map((idea, index) =>
          `${index + 1}. Event #${idea.eventId}, market ${idea.marketId ?? "unknown"} (${idea.subMarketTitle}): side=${idea.suggestedMove}; stake=$${idea.stakeUsd}; edge=${idea.edgePct ?? "n/a"}%; expected=${idea.expectedReturnPct ?? "n/a"}%; resolutionCheck=${idea.nextResolutionCheckAt ? new Date(idea.nextResolutionCheckAt).toISOString() : "unknown"}; url=${idea.url}`
        ),
      ].join("\n"),
    };

    try {
      const encodedPayload = buildExecutionPayload(selectedAgent, compactOneShotForm(cycleForm));
      if (encodedPayload.length > MAX_ONE_SHOT_PAYLOAD_HEX_CHARS) {
        throw new Error("Trader cycle payload is too large. Reduce Scout limit or seed pages and retry.");
      }
      await assertOneShotBillingReady({
        publicClient,
        account: address,
        selectedAgent,
        encodedPayload,
        quotedTotalCost,
      });

      toast.info(`Submitting paid trader cycle (${formatSTT(quotedTotalCost)} STT).`);
      const txHash = await writeContractAsync({
        address: SAS.billing,
        abi: BILLING_ABI,
        functionName: "executeAgent",
        args: [selectedAgent.id, encodedPayload],
        value: quotedTotalCost,
      });

      setLastTxHash(txHash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      let executionId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: BILLING_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "AgentExecutionRequested") {
            executionId = (decoded.args as { executionId?: bigint }).executionId ?? null;
            if (executionId) break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      setTradeIdeas((prev) => [
        ...ideas.map((idea) => ({
          ...idea,
          cycleTxHash: txHash,
          cycleExecutionId: executionId?.toString(),
        })),
        ...prev,
      ]);
      if (executionId) setLastExecutionId(executionId);
      toast.success(`Paid trader cycle opened ${ideas.length} paper stake${ideas.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(analysisSubmissionError(error));
    }
  }

  function archiveTradeIdea(id: string) {
    setTradeIdeas((prev) =>
      prev.map((idea) =>
        idea.id === id ? { ...idea, status: "archived" } : idea
      )
    );
  }

  function clearTraderBook() {
    setTradeIdeas([]);
    setSelectedTradeIdea(null);
    toast.success("Autonomous trader book cleared.");
  }

  async function createTraderVaultMission() {
    if (!authenticated || !address) {
      toast.error("Sign in first.");
      return;
    }
    if (!selectedAgent) {
      toast.error("No configured SAS Companion agent found.");
      return;
    }
    if (traderMissionId) {
      toast.error("This trader strategy already has a funded vault mission.");
      return;
    }

    try {
      const funding = parseSttAmount(missionFundAmount);
      const relayerCap = parseSttAmount(maxRelayerFee);
      if (funding <= 0n) throw new Error("Trader mission funding must be greater than zero.");
      const capitalUsd = parsePositiveFloat(strategyForm.capitalUsd, 100);
      const targetReturnPct = parsePositiveFloat(strategyForm.targetReturnPct, 100);
      const horizonDays = parsePositiveInt(strategyForm.horizonDays, 3);
      const policy = deriveTraderPolicy(strategyForm);
      const expiresAtMs = Date.now() + horizonDays * 86_400_000;
      const riskPolicy = {
        risk: policy.risk,
        maxPositions: policy.maxPositions,
        minEdgePct: policy.minEdgePct,
        minConfidencePct: policy.minConfidencePct,
        stakeFloorPct: policy.stakeFloorPct,
        stakeCeilingPct: policy.stakeCeilingPct,
      };
      const strategyHash = policyHash(JSON.stringify({ capitalUsd, targetReturnPct, horizonDays, riskPolicy }));
      const strategyQuestion = [
        "PC autonomous trader strategy",
        `capitalUsd=${capitalUsd}`,
        `targetReturnPct=${targetReturnPct}`,
        `horizonDays=${horizonDays}`,
        `strategyHash=${strategyHash}`,
      ].join("|");
      const questionHash = policyHash(strategyQuestion);
      const payloadTemplateHash = companionPayloadTemplateHash();
      const cadenceMinutes = 5;
      const cadenceSeconds = BigInt(cadenceMinutes * 60);
      const maxRuns = BigInt(Math.max(1, parsePositiveInt(missionMaxRuns, 12)));
      const expiresAtSeconds = BigInt(Math.floor(expiresAtMs / 1000));

      const metadata = JSON.stringify({
        app: "Prophecy Companion",
        kind: "pc-trader-strategy-v1",
        policyVersion: MISSION_POLICY_VERSION,
        strategyId: `${address}-${Date.now()}`,
        strategyHash,
        capitalUsd,
        targetReturnPct,
        horizonDays,
        cadenceMinutes,
        maxRuns: Number(maxRuns),
        expiresAt: new Date(expiresAtMs).toISOString(),
        maxRelayerFeeWei: relayerCap.toString(),
        maxTotalSpendWei: funding.toString(),
        initialFundingWei: funding.toString(),
        agentId: selectedAgent.id.toString(),
        marketHash: strategyHash,
        questionHash,
        payloadTemplateHash,
        riskPolicy,
        createdAt: new Date().toISOString(),
        createdBy: address,
      });

      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "createMission",
        args: [
          selectedAgent.id,
          relayerCap,
          cadenceSeconds,
          maxRuns,
          expiresAtSeconds,
          funding,
          strategyHash,
          questionHash,
          payloadTemplateHash,
          metadata,
        ],
        value: funding,
      });

      toast.info("Creating funded trader strategy...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      let missionId: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: AUTOPILOT_VAULT_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "MissionCreated") {
            missionId = (decoded.args as { missionId?: `0x${string}` }).missionId ?? null;
            break;
          }
        } catch {
          // ignore unrelated logs
        }
      }
      if (!missionId) throw new Error("Trader mission transaction succeeded, but mission id was not found in logs.");
      setTraderMissionId(missionId);
      setLastTxHash(txHash);
      toast.success(`Funded trader mission created: ${shortBytes32(missionId)}`);
    } catch (error) {
      toast.error(analysisSubmissionError(error));
    }
  }

  async function cancelTraderVaultMission() {
    if (!traderMissionId) {
      toast.error("No funded trader mission to cancel.");
      return;
    }
    try {
      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "cancelMission",
        args: [traderMissionId],
      });
      toast.info("Cancelling funded trader strategy...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setTraderMissionId(null);
      setLastTxHash(txHash);
      toast.success("Funded trader strategy cancelled. Remaining vault balance is refunded by the vault.");
    } catch (error) {
      toast.error(analysisSubmissionError(error));
    }
  }

  async function topUpTraderVaultMission() {
    if (!traderMissionId) {
      toast.error("Create a funded trader strategy first.");
      return;
    }
    try {
      const amount = parseSttAmount(missionFundAmount);
      if (amount <= 0n) throw new Error("Top-up amount must be greater than zero.");
      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "fundMission",
        args: [traderMissionId],
        value: amount,
      });
      toast.info("Topping up funded trader strategy...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setLastTxHash(txHash);
      toast.success("Funded trader strategy topped up.");
    } catch (error) {
      toast.error(analysisSubmissionError(error));
    }
  }

  function addWatch() {
    const parsed = parseProphecyEventUrl(watchUrl.trim());
    if (!parsed.valid || !parsed.eventId) {
      toast.error("Use a valid Prophecy event URL, e.g. https://prophecy.social/event/14776");
      return;
    }

    const cadence = Number.parseInt(watchCadence, 10);
    const safeCadence = Number.isFinite(cadence) ? Math.max(5, cadence) : 15;
    const maxRuns = Math.max(1, Math.min(100, parsePositiveInt(missionMaxRuns, 12)));
    const durationDays = Math.max(1, Math.min(90, parsePositiveInt(missionDurationDays, 7)));
    const id = `${parsed.eventId}-${Date.now()}`;
    const next: WatchedMarket = {
      id,
      url: watchUrl.trim(),
      question: watchQuestion.trim() || INITIAL_FORM.analysisAsk,
      cadenceMinutes: safeCadence,
      maxRuns,
      expiresAt: Date.now() + durationDays * 86_400_000,
      createdAt: Date.now(),
      status: "watching",
    };

    setWatchedMarkets((prev) => [next, ...prev]);
    setWatchUrl("");
    toast.success("Market added to autonomous watchlist.");
    void monitorWatch(id, next);
  }

  function removeWatch(id: string) {
    setWatchedMarkets((prev) => prev.filter((watch) => watch.id !== id));
  }

  function pauseWatch(id: string) {
    updateWatchMission(id, { status: "paused" });
  }

  function resumeWatch(id: string) {
    updateWatchMission(id, { status: "watching" });
  }

  function archiveWatch(id: string) {
    updateWatchMission(id, { status: "archived" });
  }

  function duplicateWatch(watch: WatchedMarket) {
    const next: WatchedMarket = {
      ...watch,
      id: `${watch.id}-copy-${Date.now()}`,
      createdAt: Date.now(),
      missionId: undefined,
      missionBalanceWei: undefined,
      missionSpentWei: undefined,
      missionRunCount: undefined,
      missionActive: undefined,
      lastCheckedAt: undefined,
      status: "watching",
    };
    setWatchedMarkets((prev) => [next, ...prev]);
    toast.success("Watch duplicated locally.");
  }

  function loadWatchIntoAnalysis(watch: WatchedMarket) {
    setForm({
      prophecyEventUrl: watch.url,
      analysisAsk: watch.question,
      extraContext: watch.lastContext ?? "",
    });
    toast.message("Watch loaded into the analysis form.");
    router.push("/analysis");
  }

  async function refreshOpsData() {
    setOpsLoading(true);
    setOpsError(null);
    try {
      const params = new URLSearchParams({
        vaultAddress: SAS.autopilotVault,
        limit: "80",
      });
      if (address) params.set("account", address);
      const response = await fetch(`/api/autopilot-ops?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as OpsData;
      if (!response.ok) throw new Error(data.error ?? "Could not load relayer operations.");
      setOpsData(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOpsError(friendlyStatusMessage(msg));
    } finally {
      setOpsLoading(false);
    }
  }

  function hireDelegate(agentId: bigint) {
    setDelegatedAgentIds((prev) => {
      if (prev.some((id) => id === agentId)) return prev;
      return [...prev, agentId];
    });
  }

  function sackDelegate(agentId: bigint) {
    setDelegatedAgentIds((prev) => prev.filter((id) => id !== agentId));
  }

  async function monitorWatch(id: string, seed?: WatchedMarket) {
    const current = seed ?? watchedMarkets.find((watch) => watch.id === id);
    if (!current) return;

    setWatchedMarkets((prev) =>
      prev.map((watch) =>
        watch.id === id ? { ...watch, status: "checking", error: undefined } : watch
      )
    );

    try {
      const context = await fetchMarketContext(current.url);
      if (!context) {
        setWatchedMarkets((prev) =>
          prev.map((watch) =>
            watch.id === id
              ? {
                  ...watch,
                  status: "needs-context",
                  lastCheckedAt: Date.now(),
                  error: "Could not extract market context yet.",
                }
              : watch
          )
        );
        return;
      }

      const nextHash = fingerprint(context);
      const changed = Boolean(current.lastContextHash && current.lastContextHash !== nextHash);
      setWatchedMarkets((prev) =>
        prev.map((watch) =>
          watch.id === id
            ? {
                ...watch,
                status: changed ? "changed" : "stable",
                lastCheckedAt: Date.now(),
                lastContextHash: nextHash,
                lastContext: context,
                lastSignal: changed
                  ? "Evidence snapshot changed. Consider a fresh on-chain analysis."
                  : summarizeContext(context),
                error: undefined,
              }
            : watch
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWatchedMarkets((prev) =>
        prev.map((watch) =>
          watch.id === id
            ? { ...watch, status: "error", lastCheckedAt: Date.now(), error: msg }
            : watch
        )
      );
    }
  }

  function monitorAllWatches() {
    for (const watch of watchedMarkets) {
      if (watch.status === "paused" || watch.status === "archived") continue;
      void monitorWatch(watch.id, watch);
    }
  }

  function updateWatchMission(watchId: string, patch: Partial<WatchedMarket>) {
    setWatchedMarkets((prev) =>
      prev.map((watch) => (watch.id === watchId ? { ...watch, ...patch } : watch))
    );
  }

  async function copyMissionId(missionId: `0x${string}`) {
    try {
      await navigator.clipboard.writeText(missionId);
      toast.success("Mission ID copied.");
    } catch {
      toast.error("Could not copy mission ID.");
    }
  }

  async function copyWalletAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Wallet address copied.");
    } catch {
      toast.error("Could not copy wallet address.");
    }
  }

  async function recoverLatestMissionId(ownerAddress: `0x${string}`): Promise<`0x${string}` | null> {
    const ids = await publicClient.readContract({
      address: SAS.autopilotVault,
      abi: AUTOPILOT_VAULT_ABI,
      functionName: "getOwnerMissionIds",
      args: [ownerAddress],
    });

    return ids.length > 0 ? ids[ids.length - 1] : null;
  }

  async function attachLatestVaultMission(watch: WatchedMarket) {
    if (!address) {
      toast.error("Connect the wallet that created the mission.");
      return;
    }

    try {
      const missionId = await recoverLatestMissionId(address);
      if (!missionId) {
        toast.error("No vault mission found for this wallet.");
        return;
      }

      updateWatchMission(watch.id, { missionId });
      await refreshVaultMission(watch.id, missionId);
      toast.success(`Attached latest mission: ${shortBytes32(missionId)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  }

  async function createVaultMission(watch: WatchedMarket) {
    if (!authenticated || !address) {
      toast.error("Sign in first.");
      return;
    }
    if (!selectedAgent) {
      toast.error("No configured SAS Companion agent found.");
      return;
    }
    if (watch.missionId && watch.missionActive !== false) {
      toast.error("This watch already has an active vault mission.");
      return;
    }

    try {
      const funding = parseSttAmount(missionFundAmount);
      const relayerCap = parseSttAmount(maxRelayerFee);
      if (funding <= 0n) throw new Error("Mission funding must be greater than zero.");
      const parsed = parseProphecyEventUrl(watch.url);
      if (!parsed.valid || !parsed.eventId) {
        throw new Error("Watch must use a valid Prophecy event URL.");
      }
      const marketHash = policyHash(watch.url);
      const questionHash = policyHash(watch.question);
      const payloadTemplateHash = companionPayloadTemplateHash();
      const cadenceSeconds = BigInt(Math.max(5, watch.cadenceMinutes) * 60);
      const maxRuns = BigInt(Math.max(1, watch.maxRuns));
      const expiresAtSeconds = BigInt(Math.floor(watch.expiresAt / 1000));

      const metadata = JSON.stringify({
        app: "Prophecy Companion",
        kind: "prophecy-watch",
        policyVersion: MISSION_POLICY_VERSION,
        watchId: watch.id,
        url: watch.url,
        eventId: parsed.eventId,
        question: watch.question,
        agentId: selectedAgent.id.toString(),
        cadenceMinutes: watch.cadenceMinutes,
        maxRuns: watch.maxRuns,
        expiresAt: new Date(watch.expiresAt).toISOString(),
        maxRelayerFeeWei: relayerCap.toString(),
        maxTotalSpendWei: funding.toString(),
        initialFundingWei: funding.toString(),
        marketHash,
        questionHash,
        payloadTemplateHash,
        createdAt: new Date().toISOString(),
        createdBy: address,
      });

      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "createMission",
        args: [
          selectedAgent.id,
          relayerCap,
          cadenceSeconds,
          maxRuns,
          expiresAtSeconds,
          funding,
          marketHash,
          questionHash,
          payloadTemplateHash,
          metadata,
        ],
        value: funding,
      });

      toast.info("Creating vault mission...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      let missionId: `0x${string}` | null = null;

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: AUTOPILOT_VAULT_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "MissionCreated") {
            missionId = (decoded.args as { missionId?: `0x${string}` }).missionId ?? null;
            break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (!missionId) {
        missionId = await recoverLatestMissionId(address);
      }
      if (!missionId) throw new Error("Could not recover mission id after transaction confirmation.");

      updateWatchMission(watch.id, {
        missionId,
        missionBalanceWei: funding.toString(),
        missionSpentWei: "0",
        missionRunCount: "0",
        missionActive: true,
        missionPolicyVersion: MISSION_POLICY_VERSION,
      });
      toast.success(`Vault mission created: ${shortBytes32(missionId)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  }

  async function fundVaultMission(watch: WatchedMarket) {
    if (!watch.missionId) {
      toast.error("Create a vault mission first.");
      return;
    }

    try {
      const amount = parseSttAmount(missionFundAmount);
      if (amount <= 0n) throw new Error("Funding amount must be greater than zero.");

      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "fundMission",
        args: [watch.missionId],
        value: amount,
      });

      toast.info("Funding vault mission...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await refreshVaultMission(watch.id, watch.missionId);
      toast.success("Mission funded.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  }

  async function cancelVaultMission(watch: WatchedMarket) {
    if (!watch.missionId) return;

    try {
      const txHash = await writeContractAsync({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "cancelMission",
        args: [watch.missionId],
      });

      toast.info("Cancelling vault mission...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await refreshVaultMission(watch.id, watch.missionId);
      toast.success("Mission cancelled. Unused balance was refunded on-chain.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  }

  async function cancelDelegatedWorkflow() {
    if (!authenticated || !address) {
      toast.error("Connect the wallet that created the workflow.");
      return;
    }
    if (!autonomyModeAvailable) {
      toast.error("Delegated workflow contract is not configured.");
      return;
    }

    const workflowId = BigInt(parsePositiveInt(workflowRecoveryId, 0));
    if (workflowId <= 0n) {
      toast.error("Enter a valid workflow id.");
      return;
    }

    try {
      const txHash = await writeContractAsync({
        address: SAS.autonomyV4,
        abi: AUTONOMY_V4_ABI,
        functionName: "cancelWorkflow",
        args: [workflowId],
      });
      setLastTxHash(txHash);
      toast.info(`Cancelling delegated workflow #${workflowId.toString()}...`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      toast.success("Workflow cancelled. Remaining workflow budget was refunded by the contract.");
    } catch (e) {
      toast.error(analysisSubmissionError(e));
    }
  }

  async function refreshVaultMission(watchId: string, missionId?: `0x${string}`) {
    if (!missionId) return;

    try {
      const mission = await publicClient.readContract({
        address: SAS.autopilotVault,
        abi: AUTOPILOT_VAULT_ABI,
        functionName: "getMission",
        args: [missionId],
      });

      updateWatchMission(watchId, {
        missionBalanceWei: mission.balance.toString(),
        missionSpentWei: mission.spent.toString(),
        missionRunCount: mission.runCount.toString(),
        missionActive: mission.active,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  }

  async function refreshAutopilotRuns(targetMissionId?: `0x${string}`) {
    const missionIds = targetMissionId
      ? new Set<string>([targetMissionId.toLowerCase()])
      : new Set(
          watchedMarkets
            .map((watch) => watch.missionId?.toLowerCase())
            .filter((missionId): missionId is string => Boolean(missionId))
        );

    if (missionIds.size === 0) {
      setAutopilotRuns([]);
      toast.message("No vault missions are attached yet.");
      return;
    }

    setAutopilotRunsLoading(true);
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const chunkSize = BigInt(AUTOPILOT_LOG_CHUNK_SIZE);
      const collected: AutopilotRun[] = [];

      for (let fromBlock = AUTOPILOT_SCAN_FROM_BLOCK; fromBlock <= latestBlock; fromBlock += chunkSize) {
        const toBlock =
          fromBlock + chunkSize - 1n > latestBlock ? latestBlock : fromBlock + chunkSize - 1n;
        const logs = await publicClient.getLogs({
          address: SAS.autopilotVault,
          fromBlock,
          toBlock,
        });

        for (const log of logs) {
          try {
            const decoded = decodeEventLog({
              abi: AUTOPILOT_VAULT_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName !== "MissionSpent") continue;

            const args = decoded.args as {
              missionId: `0x${string}`;
              owner: `0x${string}`;
              agentId: bigint;
              executionId: bigint;
              agentFee: bigint;
              runtimeBudget: bigint;
              relayerFee: bigint;
              remainingBalance: bigint;
              idempotencyKey: `0x${string}`;
              payloadTemplateHash: `0x${string}`;
              payloadHash: `0x${string}`;
              contextHash: `0x${string}`;
            };
            if (!missionIds.has(args.missionId.toLowerCase())) continue;

            let record: ExecutionRecord | undefined;
            let resultRaw: string | null = null;
            try {
              record = (await publicClient.readContract({
                address: SAS.billing,
                abi: BILLING_ABI,
                functionName: "getExecutionRecord",
                args: [args.executionId],
              })) as ExecutionRecord;
              resultRaw = decodeExecutionString(record.result);
            } catch {
              record = undefined;
            }

            collected.push({
              ...args,
              blockNumber: log.blockNumber ?? undefined,
              txHash: log.transactionHash ?? undefined,
              record,
              resultRaw,
            });
          } catch {
            // Ignore non-vault or non-decodable logs in the scanned range.
          }
        }
      }

      const sorted = collected
        .sort((a, b) => Number(b.executionId - a.executionId))
        .slice(0, 20);
      setAutopilotRuns(sorted);
      toast.success(`Loaded ${sorted.length} autopilot run${sorted.length === 1 ? "" : "s"}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setAutopilotRunsLoading(false);
    }
  }

  async function runAnalysis() {
    if (!authenticated || !address) {
      toast.error("Sign in first.");
      return;
    }

    if (!selectedAgent) {
      toast.error("No Somnia-linked analysis agent available.");
      return;
    }

    const parsed = parseProphecyEventUrl(form.prophecyEventUrl.trim());
    if (!parsed.valid) {
      toast.error("Use a valid Prophecy event URL, e.g. https://prophecy.social/event/14776");
      return;
    }

    try {
      setLastExecutionId(null);
      setLastTxHash(null);

      let executionForm = form;
      if (
        selectedAgent.agentType === AgentType.LLM_INFERENCE &&
        form.extraContext.trim().length < 40
      ) {
        toast.message("Fetching Prophecy market context for the LLM agent...");
        const context = await fetchMarketContext(form.prophecyEventUrl.trim());
        if (context) {
          executionForm = {
            ...form,
            extraContext: [form.extraContext.trim(), context].filter(Boolean).join("\n\n"),
          };
        } else {
          toast.warning("Could not auto-extract market context. Continuing with URL-only prompt.");
        }
      }

      if (executionMode === "billing") {
        if (quotedTotalCost === undefined) {
          throw new Error(
            "Configured billing does not expose a user-funded execution quote. Configure the pay-per-execution deployment before analyzing."
          );
        }
        if (!oneShotRuntimeHealthy) {
          throw new Error(
            friendlyStatusMessage(runtimeHealth?.reason) ||
              "Signal execution is paused. Try PC Autopilot or delegated mode."
          );
        }
        const { payload: encodedPayload } = buildOneShotPayloadWithinLimit(selectedAgent, executionForm);
        if (encodedPayload.length > MAX_ONE_SHOT_PAYLOAD_HEX_CHARS) {
          throw new Error(
            `Signal payload is too large (${encodedPayload.length} hex chars). Shorten the market context or use PC Autopilot.`
          );
        }

        await assertOneShotBillingReady({
          publicClient,
          account: address,
          selectedAgent,
          encodedPayload,
          quotedTotalCost,
        });

        const txHash = await writeContractAsync({
          address: SAS.billing,
          abi: BILLING_ABI,
          functionName: "executeAgent",
          args: [selectedAgent.id, encodedPayload],
          value: quotedTotalCost,
        });

        setLastTxHash(txHash);
        toast.info("Execution transaction submitted.");

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        let foundExecutionId: bigint | null = null;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: BILLING_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "AgentExecutionRequested") {
              foundExecutionId = (decoded.args as { executionId?: bigint }).executionId ?? null;
              if (foundExecutionId) break;
            }
          } catch {
            // ignore unrelated logs
          }
        }

        if (!foundExecutionId) {
          throw new Error("Could not find execution id in transaction receipt.");
        }

        setLastExecutionId(foundExecutionId);
        toast.success(`Analysis queued (execution #${foundExecutionId.toString()}).`);
        return;
      }

      const encodedPayload = buildExecutionPayload(selectedAgent, executionForm);
      if (encodedPayload.length > 12000) {
        toast.warning("Large workflow payload detected. Wallet gas estimate may be high.");
      }

      if (!autonomyModeAvailable) {
        throw new Error(
          "SASAutonomyV4 is not configured. Set NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS."
        );
      }

      const workflowAgents = plannedWorkflowAgents;
      const workflowDepth = parsePositiveInt(autonomyMaxDepth, workflowAgents.length);
      if (workflowDepth < workflowAgents.length) {
        throw new Error(
          `Autonomy max depth (${workflowDepth}) must be at least the number of planned agents (${workflowAgents.length}).`
        );
      }

      const workflowBudget = parseSttAmount(autonomyBudgetStt);
      if (workflowBudget <= 0n) {
        throw new Error("Autonomy budget must be greater than zero.");
      }

      const payloadByAgent = new Map<string, `0x${string}`>();
      payloadByAgent.set(selectedAgent.id.toString(), encodedPayload);
      for (const agent of delegationCandidates) {
        payloadByAgent.set(agent.id.toString(), buildExecutionPayload(agent, executionForm));
      }

      let requiredBudget = 0n;
      for (const agent of workflowAgents) {
        const quote = (await publicClient.readContract({
          address: SAS.billing,
          abi: BILLING_ABI,
          functionName: "quoteExecution",
          args: [agent.id],
        })) as readonly [bigint, bigint, bigint];
        requiredBudget += quote[2];
      }

      if (workflowBudget < requiredBudget) {
        throw new Error(
          `Autonomy workflow budget too low. Minimum required now is ${formatSTT(requiredBudget)} STT.`
        );
      }

      toast.message(
        `Creating autonomy workflow (${workflowAgents.length} step${workflowAgents.length === 1 ? "" : "s"}).`
      );

      const workflowMetadata = JSON.stringify({
        app: "Prophecy Companion",
        kind: "analysis-autonomy-v4-runner",
        url: executionForm.prophecyEventUrl.trim(),
        delegationMode: autonomyAutoDelegate ? "automatic" : "manual",
        maxDelegates: autonomyAutoDelegate ? maxDelegates : delegatedAgents.length,
        rootAgentId: selectedAgent.id.toString(),
        delegatedAgentIds: delegatedAgents.map((agent) => agent.id.toString()),
        manualDelegateAgentIds: autonomyAutoDelegate
          ? []
          : delegatedAgents.map((agent) => agent.id.toString()),
        rootPayload: encodedPayload,
        delegatePayloads: Object.fromEntries(payloadByAgent.entries()),
        relationType: DELEGATES_RELATION_TYPE,
        createdAt: new Date().toISOString(),
      });

      const createHash = await writeContractAsync({
        address: SAS.autonomyV4,
        abi: AUTONOMY_V4_ABI,
        functionName: "createWorkflow",
        args: [selectedAgent.id, BigInt(workflowDepth), ZERO_BYTES32, workflowMetadata],
        value: workflowBudget,
      });

      setLastTxHash(createHash);
      toast.info("Autonomy workflow creation submitted.");
      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

      let workflowId: bigint | null = null;
      for (const log of createReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: AUTONOMY_V4_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "WorkflowCreated") {
            workflowId = (decoded.args as { workflowId?: bigint }).workflowId ?? null;
            if (workflowId) break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (!workflowId) {
        throw new Error("Could not recover workflowId from autonomy workflow creation.");
      }
      setLastWorkflowId(workflowId);
      setWorkflowRecoveryId(workflowId.toString());

      if (CONFIGURED_AUTONOMY_RUNNER_ADDRESS) {
        const authorizeRunnerHash = await writeContractAsync({
          address: SAS.autonomyV4,
          abi: AUTONOMY_V4_ABI,
          functionName: "setWorkflowExecutor",
          args: [workflowId, CONFIGURED_AUTONOMY_RUNNER_ADDRESS, true],
        });
        setLastTxHash(authorizeRunnerHash);
        await publicClient.waitForTransactionReceipt({ hash: authorizeRunnerHash });
      }

      setLastExecutionId(null);
      toast.success(
        CONFIGURED_AUTONOMY_RUNNER_ADDRESS
          ? `Autonomy workflow #${workflowId.toString()} queued. Runner ${formatAddress(CONFIGURED_AUTONOMY_RUNNER_ADDRESS)} is authorized to plan and execute delegation.`
          : `Autonomy workflow #${workflowId.toString()} queued. Runner will plan delegation and execute steps once it is authorized on SASAutonomyV4.`
      );
      return;
    } catch (e) {
      toast.error(analysisSubmissionError(e));
    }
  }

  const selectedEvidenceContext = selectedEvidenceRun
    ? contextByHash.get(
        (isOpsRun(selectedEvidenceRun)
          ? selectedEvidenceRun.context_hash
          : selectedEvidenceRun.contextHash
        ).toLowerCase()
      )
    : undefined;
  const selectedEvidenceMissionId = selectedEvidenceRun
    ? isOpsRun(selectedEvidenceRun)
      ? selectedEvidenceRun.mission_id
      : selectedEvidenceRun.missionId
    : null;
  const selectedEvidenceOpsMission = selectedEvidenceMissionId
    ? opsMissionById.get(selectedEvidenceMissionId.toLowerCase())
    : undefined;
  const workspaceShellItems: Array<{
    id: Workspace;
    label: string;
    shortLabel: string;
    href: string;
    description: string;
    eyebrow: string;
    headline: string;
  }> = [
    {
      id: "analysis",
      label: "Signal Terminal",
      shortLabel: "Analyze",
      href: "/analysis",
      description: "Price one Prophecy market with paid, evidence-backed SAS execution.",
      eyebrow: "Decision intelligence",
      headline: "Institutional-grade signal before you commit capital.",
    },
    {
      id: "scout",
      label: "Market Discovery",
      shortLabel: "Scout",
      href: "/scout",
      description: "Discover Prophecy markets where evidence and crowd pricing diverge.",
      eyebrow: "Market discovery",
      headline: "Find asymmetric opportunities before they become obvious.",
    },
    {
      id: "autopilot",
      label: "PC Autopilot",
      shortLabel: "Autopilot",
      href: "/autopilot",
      description: "Trader and market watch automation.",
      eyebrow: "PC autopilot",
      headline: "Automated trading research and market watches.",
    },
    {
      id: "runs",
      label: "Execution Audit",
      shortLabel: "Runs",
      href: "/runs",
      description: "Review every autonomous and manual run with hashes, evidence, and cost.",
      eyebrow: "Proof layer",
      headline: "Every signal, spend, and decision path is inspectable.",
    },
    {
      id: "settings",
      label: "Control Plane",
      shortLabel: "Settings",
      href: "/settings",
      description: "Monitor agent, vault, relayer, billing, and runtime configuration.",
      eyebrow: "System control",
      headline: "Operate the Companion stack with production-grade visibility.",
    },
  ];
  const currentWorkspace =
    workspaceShellItems.find((item) => item.id === activeWorkspace) ?? workspaceShellItems[0];
  const profileName = address ? formatAddress(address) : authenticated ? "Connected wallet" : "Guest operator";
  const profileStatus = authenticated ? "Authenticated" : "Connect wallet";
  const renderWorkspaceIcon = (id: Workspace) => {
    switch (id) {
      case "analysis":
        return <Search size={17} />;
      case "scout":
        return <Radar size={17} />;
      case "autopilot":
        return <Target size={17} />;
      case "runs":
        return <Database size={17} />;
      case "settings":
        return <Settings size={17} />;
      default:
        return <Sparkles size={17} />;
    }
  };

  return (
    <main className="pc-app-shell">
      <aside className="pc-sidebar" aria-label="Prophecy Companion navigation">
        <Link className="pc-sidebar-brand" href="/analysis">
          <Image
            src="/pc-logo.png"
            alt="Prophecy Companion"
            width={52}
            height={52}
            priority
          />
          <div>
            <strong>Prophecy Companion</strong>
            <span>Market intelligence</span>
          </div>
        </Link>

        <nav className="pc-sidebar-nav">
          {workspaceShellItems.map((item) => (
            <Link
              key={item.id}
              className={`pc-nav-item ${activeWorkspace === item.id ? "active" : ""}`}
              href={item.href}
            >
              {renderWorkspaceIcon(item.id)}
              <span>
                <strong>{item.label}</strong>
          <small>{item.shortLabel}</small>
              </span>
            </Link>
          ))}
        </nav>

        <div className="pc-sidebar-system">
          <p className="k">System health</p>
          <div>
            <span className={`pc-led ${userFundedBillingReady ? "ready" : "blocked"}`} />
            <strong>{userFundedBillingReady ? "Billing ready" : "Billing unavailable"}</strong>
          </div>
          <div>
            <span className={`pc-led ${relayerStale ? "blocked" : "ready"}`} />
            <strong>{relayerStale ? "Relayer offline" : "Relayer online"}</strong>
          </div>
          <div>
            <span className={`pc-led ${renderServicesReady ? "ready" : "blocked"}`} />
            <strong>
              {renderServices.length > 0
                ? `${healthyRenderServices}/${renderServices.length} services`
                : "Services unknown"}
            </strong>
          </div>
        </div>

        <div className="pc-profile-card">
          <div className="pc-avatar">
            {address ? address.slice(2, 4).toUpperCase() : "PC"}
          </div>
          <div>
            <strong>{profileName}</strong>
            <span>{authenticated ? walletBalanceLabel : profileStatus}</span>
          </div>
        </div>
      </aside>

      <section className="pc-main">
        <header className="pc-topbar">
          <div>
            <p className="eyebrow">{currentWorkspace.eyebrow}</p>
            <h2>{currentWorkspace.shortLabel}</h2>
          </div>
          <div className="pc-topbar-actions">
            <span className={`status-badge ${userFundedBillingReady ? "ready" : "blocked"}`}>
              {userFundedBillingReady ? "Execution ready" : "Action required"}
            </span>
            {!authenticated ? (
              <button className="btn primary wallet-icon-btn" onClick={() => login()} aria-label="Connect wallet">
                <Wallet size={18} />
              </button>
            ) : (
              <div className="wallet-menu">
                <button
                  className="chip"
                  onClick={() => setWalletMenuOpen((open) => !open)}
                  title="Wallet menu"
                  aria-label="Wallet menu"
                >
                  <Wallet size={14} />
                  {walletBalanceLabel}
                </button>
                {walletMenuOpen && (
                  <div className="wallet-popover">
                    <div className="pc-profile-card compact">
                      <div className="pc-avatar">{address ? address.slice(2, 4).toUpperCase() : "PC"}</div>
                      <div>
                        <strong>{profileName}</strong>
                        <span>{walletBalanceLabel}</span>
                      </div>
                    </div>
                    <button className="btn ghost" onClick={() => void copyWalletAddress()}>
                      <Copy size={14} /> Copy address
                    </button>
                    <button className="btn ghost" onClick={() => logout()}>
                      <Wallet size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

      {activeWorkspace === "settings" && (
      <>
      <section className="stats">
        <div className="stat-card">
          <p>Configured SAS UID</p>
          <h3>{CONFIGURED_SAS_AGENT_ID ? formatAgentUid(CONFIGURED_SAS_AGENT_ID, SAS.registry) : "Missing"}</h3>
        </div>
        <div className="stat-card">
          <p>Configured Somnia Agent ID</p>
          <h3>{CONFIGURED_SOMNIA_AGENT_ID ? `#${CONFIGURED_SOMNIA_AGENT_ID.toString()}` : "(optional)"}</h3>
        </div>
        <div className="stat-card">
          <p>Active SAS-compatible agents</p>
          <h3>{companionCandidates.length}</h3>
        </div>
        <div className="stat-card">
          <p>Live linked Somnia Agent ID</p>
          <h3>{selectedAgent ? `#${selectedAgent.somniaAgentId.toString()}` : "-"}</h3>
        </div>
        <div className="stat-card">
          <p>Agent service fee</p>
          <h3>{quotedAgentFee !== undefined ? `${formatSTT(quotedAgentFee)} STT` : "-"}</h3>
        </div>
        <div className={`stat-card ${userFundedBillingReady ? "ready" : "blocked"}`}>
          <p>Total manual analysis cost</p>
          <h3>
            {quotedTotalCost !== undefined
              ? `${formatSTT(quotedTotalCost)} STT`
              : "Billing migration required"}
          </h3>
        </div>
      </section>

      <section className="panel operations-panel">
        <div className="panel-head">
          <div>
            <h2>Operations Overview</h2>
            <p className="panel-copy">
              The application separates manual intelligence, browser monitoring, and funded
              autonomous execution so every workflow has a clear proof boundary.
            </p>
          </div>
          <span className={`status-badge ${userFundedBillingReady ? "ready" : "blocked"}`}>
            {userFundedBillingReady ? "User-funded analysis ready" : "Billing migration required"}
          </span>
        </div>
        <div className="operations-grid">
          <div>
              <p className="k">Signal terminal</p>
            <strong>
              {executionMode === "billing"
                ? "One-shot paid analysis"
                : "Delegated SAS workflow"}
            </strong>
              <span>
                {executionMode === "billing"
                  ? "Your wallet pays SASBilling once and queues one Somnia Agent request. It is immediate analysis, not an autonomous watch."
                  : autonomyAutoDelegate
                    ? "This creates an advanced multi-agent SASAutonomyV4 workflow. It needs the SAS runner, and it is separate from Prophecy Autopilot."
                    : "This creates an advanced multi-agent SASAutonomyV4 workflow with your delegates. It is separate from funded vault missions."}
              </span>
          </div>
          <div>
              <p className="k">Browser monitor</p>
            <strong>Session-based market surveillance</strong>
            <span>
              It refreshes evidence and marks a market changed or stable. It does not run the paid agent.
            </span>
          </div>
          <div>
              <p className="k">PC autopilot</p>
            <strong>Funded automated runs</strong>
            <span>
              A funded mission authorizes spending, but only a backend relayer can trigger autonomous paid runs.
            </span>
          </div>
        </div>
        <p className="operations-proof">
          Proof of autonomous execution appears under <strong>Vault Run History</strong> as a spend event linked to an analysis result.
          A funded mission by itself is not proof that the relayer is running.
        </p>
        <div className="reserve-info">
          <div>
            <p className="k">Agent service fee</p>
            <strong>{quotedAgentFee !== undefined ? `${formatSTT(quotedAgentFee)} STT` : "-"}</strong>
          </div>
          <div>
            <p className="k">Somnia runtime budget</p>
            <strong>{quotedRuntimeBudget !== undefined ? `${formatSTT(quotedRuntimeBudget)} STT` : "-"}</strong>
          </div>
          <span>
            Manual total: {quotedTotalCost !== undefined ? `${formatSTT(quotedTotalCost)} STT` : "unavailable"} before wallet gas.
            Vault missions pay this total plus the selected relayer fee per autonomous run.
          </span>
        </div>
      </section>
      </>
      )}

      <nav className="workspace-tabs pc-workspace-tabs" aria-label="Prophecy Companion workspaces">
        {workspaceShellItems.map(({ id, shortLabel, description, href }) => {
          return (
          <Link
            key={id}
            className={`workspace-tab ${activeWorkspace === id ? "active" : ""}`}
            href={href}
          >
            <strong>{shortLabel}</strong>
            <span>{description}</span>
          </Link>
        );
        })}
      </nav>

      {activeWorkspace === "scout" && (
      <section className="panel scout-panel">
        <PCLoadingOverlay
          active={isScouting}
          title="PC is discovering candidates"
          subtitle="Scanning Prophecy markets and ranking active opportunities."
        />
        <div className="panel-head">
          <div>
          <h2>Market Discovery</h2>
            <p className="panel-copy">
              Define an investment mandate. Prophecy Companion discovers relevant Prophecy markets and scores
              mispricing, evidence quality, edge, confidence, and operational risk.
            </p>
          </div>
          <span className="pill">Discovery pipeline</span>
        </div>

        <div className="scout-form">
          <label className="wide">
            Discovery mandate
            <textarea
              rows={3}
              value={scoutForm.objective}
              onChange={(e) => updateScout("objective", e.target.value)}
              placeholder="Find mispriced sports markets with strong evidence against crowd probability."
            />
          </label>
          <label>
            Min model probability
            <input
              value={scoutForm.minProbability}
              onChange={(e) => updateScout("minProbability", e.target.value)}
              placeholder="65"
            />
          </label>
          <label>
            Min edge
            <input
              value={scoutForm.minEdge}
              onChange={(e) => updateScout("minEdge", e.target.value)}
              placeholder="15"
            />
          </label>
          <label>
            Min confidence
            <input
              value={scoutForm.minConfidence}
              onChange={(e) => updateScout("minConfidence", e.target.value)}
              placeholder="70"
            />
          </label>
          <label>
            Result limit
            <select value={scoutForm.limit} onChange={(e) => updateScout("limit", e.target.value)}>
              <option value="4">4</option>
              <option value="8">8</option>
              <option value="12">12</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <label className="wide">
            Optional seed pages
            <input
              value={scoutForm.seedUrls}
              onChange={(e) => updateScout("seedUrls", e.target.value)}
              placeholder="Optional Prophecy search or event URLs, separated by spaces"
            />
          </label>
          <button className="btn primary scout-discover-btn" onClick={() => void discoverOpportunities()} disabled={isScouting}>
            {isScouting ? (
              <>
                <Loader2 size={14} className="spin" /> Scouting
              </>
            ) : (
              <>
                <Search size={14} /> Discover Candidates
              </>
            )}
          </button>
        </div>

        <div className="scout-explainer">
          <div>
            <Target size={16} />
            <span>Scout does not only look for high probability. It looks for evidence-based edge versus the market crowd price.</span>
          </div>
          <div>
            <Radar size={16} />
            <span>Discovery ranks available candidates by your objective. Paste search or event URLs as seed pages to widen the candidate pool.</span>
          </div>
          <div>
            <Bot size={16} />
            <span>Discovery is a fast pre-screen. The PC agent runs when you click Analyze Edge on a candidate.</span>
          </div>
        </div>

        {scoutCandidates.length === 0 ? (
          <div className="empty">
            {scoutMessage ??
              "No active scout candidates loaded yet. Run discovery, or paste live Prophecy search/event URLs into seed pages if active markets are hidden behind client-side loading."}
          </div>
        ) : (
          <div className="candidate-grid">
            {scoutCandidates.map((candidate) => (
              <article key={`${candidate.eventId}-${candidate.marketId ?? candidate.title ?? candidate.url}`} className="candidate-card">
                <div className="watch-head">
                  <div>
                    <p className="k">Prophecy event</p>
                    <h3>#{candidate.eventId}{candidate.marketId ? ` / M${candidate.marketId}` : ""}</h3>
                  </div>
                  <span className="pill">
                    {candidate.marketProbability !== undefined
                      ? `${(candidate.marketProbability * 100).toFixed(1)}% market`
                      : "market unknown"}
                  </span>
                </div>
                <h3 className="candidate-title">{candidate.title ?? "Untitled Prophecy market"}</h3>
                <div className="candidate-tags">
                  {candidate.status && <span>{candidate.status}</span>}
                  {candidate.volume && <span>Vol {candidate.volume}</span>}
                  {candidate.tags?.slice(0, 3).map((tag) => <span key={`${candidate.eventId}-${tag}`}>{tag}</span>)}
                </div>
                {candidate.description && <p className="candidate-desc">{candidate.description}</p>}
                <a className="link" href={candidate.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> Open market
                </a>
                {candidate.scoutReason && (
                  <div className="candidate-reason">
                    <p className="k">Scout fit</p>
                    <span>{candidate.scoutReason}</span>
                  </div>
                )}
                <div className="watch-actions">
                  <button className="btn primary" onClick={() => loadCandidateForAnalysis(candidate)}>
                    Analyze Edge
                  </button>
                  <button className="btn ghost" onClick={() => createWatchFromCandidate(candidate)}>
                    Add Watch
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      )}

      {activeWorkspace === "autopilot" && (
      <>
      <div className="page-heading autopilot-heading">
          <div>
            <h2>PC Autopilot</h2>
            <p className="panel-copy">
              Two focused tools: PC Trader for strategy cycles, and PC Autopilot for market watches.
            </p>
          </div>
          <span className={`status-badge ${relayerStale ? "blocked" : "ready"}`}>
            {relayerStale ? "Waiting for activity" : `Live ${latestHeartbeat?.status ?? "online"}`}
          </span>
        </div>

        <section className="panel trader-section">
          <div className="panel-head compact-panel-head">
            <div>
              <p className="k">PC Trader</p>
              <h2>Strategy cycles</h2>
            </div>
            <span className="pill">Trader</span>
          </div>

          <div className="strategy-head">
            <div>
              <p className="k">Strategy mandate</p>
              <h3>{strategyPolicySummary(strategyForm)}</h3>
              <span>{strategyRiskWarning(strategyForm)}</span>
            </div>
            <span className={`status-badge ${traderPolicy.risk === "degen" || parsePositiveFloat(strategyForm.targetReturnPct, 100) >= 100 ? "blocked" : "ready"}`}>
              {riskLabel(traderPolicy.risk)}
            </span>
          </div>

          <div className="strategy-form">
            <label>
              Strategy capital
              <input
                value={strategyForm.capitalUsd}
                onChange={(e) => updateStrategy("capitalUsd", e.target.value)}
                placeholder="100"
              />
            </label>
            <label>
              Target return
              <input
                value={strategyForm.targetReturnPct}
                onChange={(e) => updateStrategy("targetReturnPct", e.target.value)}
                placeholder="100"
              />
            </label>
            <label>
              Horizon
              <select
                value={strategyForm.horizonDays}
                onChange={(e) => updateStrategy("horizonDays", e.target.value)}
              >
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <button
              className="btn primary"
              onClick={() => void createTraderVaultMission()}
              disabled={isSubmitting || !selectedAgent || Boolean(traderMissionId)}
            >
              {isSubmitting ? <Loader2 size={14} className="spin" /> : <Target size={14} />}
              Fund PC Trader
            </button>
            <button className="btn ghost" onClick={clearTraderBook} disabled={activeTradeIdeas.length === 0}>
              Reset Book
            </button>
            <button className="btn ghost" onClick={() => void topUpTraderVaultMission()} disabled={!traderMissionId}>
              Add Capital
            </button>
            <button className="btn ghost danger" onClick={() => void cancelTraderVaultMission()} disabled={!traderMissionId}>
              Stop Mandate
            </button>
          </div>

          <div className="strategy-stats">
            <div>
              <p className="k">Available balance</p>
              <strong>${traderBalance.toFixed(2)}</strong>
              <span>{strategyPaperPnl >= 0 ? "+" : ""}${strategyPaperPnl.toFixed(2)} paper PnL</span>
            </div>
            <div>
              <p className="k">Autonomous policy</p>
              <strong>{traderPolicy.maxPositions} max positions</strong>
              <span>{traderPolicy.minEdgePct}% min edge / {traderPolicy.minConfidencePct}% min confidence</span>
            </div>
            <div>
              <p className="k">Cycle cost</p>
              <strong>{quotedTotalCost !== undefined ? `${formatSTT(quotedTotalCost)} STT` : "Unavailable"}</strong>
              <span>Per paid agent cycle. Funded strategy runs spend from the vault mission.</span>
            </div>
            <div>
              <p className="k">Funded trader mission</p>
              <strong>{traderMissionId ? shortBytes32(traderMissionId) : "Not funded"}</strong>
              <span>{traderMissionId ? "pc-trader-relayer can run this strategy." : "Create a vault mission to enforce autonomy."}</span>
            </div>
          </div>

          {displayTradeIdeas.length === 0 ? (
            <div className="empty compact-empty">
              Run Market Discovery, then execute a paid strategy cycle. Prophecy Companion will size positions from
              the mandate, track the book, and preserve evidence until settlement.
            </div>
          ) : (
            <div className="submarket-grid">
              {displayTradeIdeas.map((idea) => (
                <details key={idea.id} className="submarket-card">
                  <summary>
                    <span>
                      <strong>{idea.subMarketTitle}</strong>
                      <small>#{idea.eventId}{idea.marketId ? ` / M${idea.marketId}` : ""}</small>
                    </span>
                    <span className={`watch-status ${idea.suggestedMove === "WATCH" ? "needs-context" : "changed"}`}>
                      {idea.suggestedMove}
                    </span>
                  </summary>
                  <div className="submarket-detail-grid">
                    <div>
                      <p className="k">Stake</p>
                      <strong>${idea.stakeUsd.toFixed(2)}</strong>
                      <span>Balance before ${idea.balanceBeforeUsd.toFixed(2)}</span>
                    </div>
                    <div>
                      <p className="k">Edge</p>
                      <strong>{idea.edgePct === null ? "N/A" : `${idea.edgePct.toFixed(1)}%`}</strong>
                      <span>Expected {idea.expectedReturnPct === null ? "N/A" : `+${idea.expectedReturnPct.toFixed(1)}%`}</span>
                    </div>
                    <div>
                      <p className="k">Probabilities</p>
                      <strong>{idea.modelProbability === null ? "N/A" : `${(idea.modelProbability * 100).toFixed(1)}%`}</strong>
                      <span>Market {idea.marketProbability === null ? "N/A" : `${(idea.marketProbability * 100).toFixed(1)}%`}</span>
                    </div>
                    <div>
                      <p className="k">Status</p>
                      <strong>{idea.status === "open" ? "Open" : idea.status}</strong>
                      <span>{resolutionCheckLabel(idea.nextResolutionCheckAt)}</span>
                    </div>
                  </div>
                  <p className="submarket-rationale">{idea.rationale}</p>
                  <div className="run-links">
                    <a className="btn ghost" href={idea.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Open market
                    </a>
                    <button className="btn ghost" onClick={() => setSelectedTradeIdea(idea)}>
                      <Search size={13} /> Details
                    </button>
                    {idea.cycleTxHash && (
                      <a
                        className="btn ghost"
                        href={`https://shannon-explorer.somnia.network/tx/${idea.cycleTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Database size={13} /> Cycle tx
                      </a>
                    )}
                    {!idea.id.startsWith("ops-") && (
                      <button className="btn ghost danger" onClick={() => archiveTradeIdea(idea.id)}>
                        <Archive size={13} /> Archive
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}

          </section>

          <section className="panel watch-section">
            <div className="panel-head compact-panel-head">
            <div>
              <p className="k">PC Autopilot</p>
              <h2>Market watches</h2>
            </div>
            <span className="pill">Watch</span>
          </div>

        <div className="ops-strip">
          <div>
            <p className="k">Last scan</p>
            <strong>{formatIsoRelative(latestHeartbeat?.last_seen_at)}</strong>
            <span>{latestHeartbeat?.last_scanned_block ? `Block ${latestHeartbeat.last_scanned_block}` : "No heartbeat yet"}</span>
          </div>
          <div>
            <p className="k">Relayer wallet</p>
            <strong>{formatWeiStt(latestHeartbeat?.wallet_balance_wei)}</strong>
            <span>{latestHeartbeat?.relayer_address ? formatAddress(latestHeartbeat.relayer_address) : "Not reported"}</span>
          </div>
          <div>
            <p className="k">Active missions</p>
            <strong>{(opsData?.missions ?? []).filter((mission) => mission.active).length}</strong>
            <span>{opsData?.configured === false ? "Not connected" : `${opsData?.runs?.length ?? 0} saved runs`}</span>
          </div>
          <div>
            <p className="k">Failures / retries</p>
            <strong>{(opsData?.runs ?? []).filter((run) => run.status === "failed").length}</strong>
            <span>{opsData?.retries?.filter((retry) => retry.status !== "resolved").length ?? 0} open retry items</span>
          </div>
          <button className="btn ghost" onClick={() => void refreshOpsData()} disabled={opsLoading}>
            {opsLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            Refresh Ops
          </button>
        </div>

        {opsError && <div className="empty danger-empty">{friendlyStatusMessage(opsError)}</div>}
        {relayerStale && (
          <div className="empty warning-empty">
            {opsData?.configured === false
              ? "Automation status is not connected yet."
              : "PC Autopilot is waiting for the next automation update."}
          </div>
        )}

        {(opsData?.missions?.length ?? 0) > 0 && (
          <div className="mission-table">
            <div className="mission-row mission-head-row">
              <span>Market</span>
              <span>Status</span>
              <span>Balance</span>
              <span>Runs</span>
              <span>Next run</span>
              <span>Last result</span>
              <span>Actions</span>
            </div>
            {opsData!.missions.map((mission) => {
              const linkedWatch = watchedMarkets.find(
                (watch) => watch.missionId?.toLowerCase() === mission.mission_id.toLowerCase()
              );
              const latestRun = opsData?.runs.find(
                (run) => run.mission_id.toLowerCase() === mission.mission_id.toLowerCase()
              );
              const eventId = mission.event_url ? parseProphecyEventUrl(mission.event_url).eventId : null;
              const policyMismatch =
                mission.metadata?.policyVersion !== undefined &&
                Number(mission.metadata.policyVersion) !== MISSION_POLICY_VERSION;
              return (
                <div key={mission.mission_id} className="mission-row">
                  <div>
                    <strong>{eventId ? `#${eventId}` : shortBytes32(mission.mission_id)}</strong>
                    <span>{(mission.question ?? mission.event_url ?? "No market URL").slice(0, 70)}</span>
                    {policyMismatch && <em>Policy version mismatch</em>}
                  </div>
                  <span className={`watch-status ${mission.active ? "changed" : "needs-context"}`}>
                    {mission.active ? "active" : "inactive"}
                  </span>
                  <span>{formatWeiStt(mission.balance_wei)}</span>
                  <span>
                    {mission.run_count}/{mission.max_runs ?? "-"} ({runsRemaining(mission.run_count, mission.max_runs)} left)
                  </span>
                  <span>{formatIsoRelative(mission.next_due_at)}</span>
                  <span>{mission.last_failure_reason ?? latestRun?.execution_rationale ?? mission.last_skipped_reason ?? "-"}</span>
                  <div className="row-actions">
                    {linkedWatch && (
                      <>
                        <button className="icon-btn" title="Top up mission" onClick={() => void fundVaultMission(linkedWatch)}>
                          <Wallet size={12} />
                        </button>
                        <button className="icon-btn" title="Cancel mission" onClick={() => void cancelVaultMission(linkedWatch)}>
                          <Archive size={12} />
                        </button>
                      </>
                    )}
                    {latestRun && (
                      <button className="icon-btn" title="View evidence" onClick={() => setSelectedEvidenceRun(latestRun)}>
                        <Database size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="watch-form">
          <label>
            Market to watch
            <input
              value={watchUrl}
              onChange={(e) => setWatchUrl(e.target.value)}
              placeholder="https://prophecy.social/event/14776"
            />
          </label>
          <label>
            Mission question
            <input
              value={watchQuestion}
              onChange={(e) => setWatchQuestion(e.target.value)}
              placeholder="What should Companion monitor?"
            />
          </label>
          <label>
            Cadence
            <select value={watchCadence} onChange={(e) => setWatchCadence(e.target.value)}>
              <option value="5">Every 5 min</option>
              <option value="15">Every 15 min</option>
              <option value="30">Every 30 min</option>
              <option value="60">Hourly</option>
            </select>
          </label>
          <label>
            Max runs
            <input
              value={missionMaxRuns}
              onChange={(e) => setMissionMaxRuns(e.target.value)}
              placeholder={DEFAULT_MISSION_MAX_RUNS}
            />
          </label>
          <label>
            Expires
            <select value={missionDurationDays} onChange={(e) => setMissionDurationDays(e.target.value)}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
          <button className="btn primary" onClick={addWatch}>
            Add Watch
          </button>
        </div>

        <div className="policy-preview">
          <div>
            <p className="k">Estimated max cost/run</p>
            <strong>{policyCostPreview.perRun}</strong>
            <span>Agent fee + runtime + capped relayer fee.</span>
          </div>
          <div>
            <p className="k">Runs left from funding</p>
            <strong>{policyCostPreview.runsLeft}</strong>
            <span>Limited again by max runs ({parsePositiveInt(missionMaxRuns, 12)}).</span>
          </div>
          <div>
            <p className="k">Mission expiry</p>
            <strong>{parsePositiveInt(missionDurationDays, 7)}d</strong>
            <span>Relayer cannot execute after the vault expiry.</span>
          </div>
          <div>
            <p className="k">Relayer fee</p>
            <strong>{maxRelayerFee || DEFAULT_AUTOPILOT_RELAYER_FEE_STT} STT cap</strong>
            <span>Paid only when the relayer submits a successful autonomous run.</span>
          </div>
        </div>

        <div className="autonomy-actions">
          <label className="mini-field">
            Mission funding
            <input
              value={missionFundAmount}
              onChange={(e) => setMissionFundAmount(e.target.value)}
              placeholder="1"
            />
          </label>
          <label className="mini-field">
            Max relayer fee/run
            <input
              value={maxRelayerFee}
              onChange={(e) => setMaxRelayerFee(e.target.value)}
              placeholder={DEFAULT_AUTOPILOT_RELAYER_FEE_STT}
            />
          </label>
          <button
            className="btn ghost"
            onClick={() => setAutoMonitor((value) => !value)}
            disabled={watchedMarkets.length === 0}
          >
            {autoMonitor ? "Stop Browser Monitoring" : "Start Browser Monitoring"}
          </button>
          <button className="btn ghost" onClick={monitorAllWatches} disabled={watchedMarkets.length === 0}>
            Refresh All Now
          </button>
          <button
            className="btn ghost"
            onClick={() => void refreshAutopilotRuns()}
            disabled={watchedMarkets.length === 0 || autopilotRunsLoading}
          >
            {autopilotRunsLoading ? (
              <>
                <Loader2 size={13} className="spin" /> Loading Vault Runs
              </>
            ) : (
              "Refresh Vault Runs"
            )}
          </button>
          <span className="autonomy-note">
            Browser monitoring never submits transactions. Autonomous paid runs happen only while
            the authorized backend relayer is running and a mission is funded.
          </span>
        </div>

        <div className="safety-grid">
          <div>
            <p className="k">Vault safety</p>
            <strong>User-funded, user-cancellable</strong>
            <span>Unused balance returns to the mission owner when cancelled.</span>
          </div>
          <div>
            <p className="k">Spend policy</p>
            <strong>Agent fee + runtime + capped relayer fee</strong>
            <span>The runtime budget funds Somnia execution; the relayer cannot exceed your fee cap.</span>
          </div>
          <div>
            <p className="k">Autonomy boundary</p>
            <strong>Relayer required</strong>
            <span>A vault balance enables runs; a live relayer must decide and submit them.</span>
          </div>
        </div>

        {visibleWatchedMarkets.length === 0 ? (
          <div className="empty">
            No watched markets yet. Add a Prophecy event URL to start browser monitoring, then
            create a vault mission only when you want backend-driven paid runs.
          </div>
        ) : (
          <div className="watch-grid">
            {visibleWatchedMarkets.map((watch) => {
              const parsedWatch = parseProphecyEventUrl(watch.url);
              const opsMission = watch.missionId ? opsMissionById.get(watch.missionId.toLowerCase()) : undefined;
              const latestOpsRun = watch.missionId
                ? opsData?.runs.find((run) => run.mission_id.toLowerCase() === watch.missionId!.toLowerCase())
                : undefined;
              const policyMismatch =
                opsMission?.metadata?.policyVersion !== undefined &&
                Number(opsMission.metadata.policyVersion) !== MISSION_POLICY_VERSION;
              return (
                <article key={watch.id} className="watch-card">
                  <div className="watch-head">
                    <div>
                      <p className="k">Market</p>
                      <h3>{parsedWatch.eventId ? `#${parsedWatch.eventId}` : "Unknown event"}</h3>
                    </div>
                    <span className={`watch-status ${watch.status}`}>{watch.status}</span>
                  </div>
                  <p className="watch-question">{watch.question}</p>
                  <a className="link" href={watch.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} /> Open market
                  </a>
                  <div className="watch-signal">
                    {watch.status === "checking" ? (
                      <span className="status-row">
                        <Loader2 size={13} className="spin" /> Refreshing evidence...
                      </span>
                    ) : policyMismatch ? (
                      <span>Mission policy was created by an older app version. Duplicate the watch and create a new mission before production use.</span>
                    ) : opsMission?.last_failure_reason ? (
                      <span>Relayer failure: {opsMission.last_failure_reason}</span>
                    ) : opsMission?.last_skipped_reason ? (
                      <span>Skipped: {opsMission.last_skipped_reason}</span>
                    ) : (
                      <span>{watch.error ?? watch.lastSignal ?? "Waiting for first evidence snapshot."}</span>
                    )}
                  </div>
                  <div className="watch-meta">
                    <span>Every {watch.cadenceMinutes} min</span>
                    <span>Max {watch.maxRuns} runs</span>
                    <span>Expires {policyExpiryLabel(watch.expiresAt)}</span>
                    {opsMission && <span>Next run {formatIsoRelative(opsMission.next_due_at)}</span>}
                    {latestOpsRun && <span>Last run {formatIsoRelative(latestOpsRun.created_at)}</span>}
                    <span>
                      {watch.lastCheckedAt
                        ? `Checked ${formatRelative(BigInt(Math.floor(watch.lastCheckedAt / 1000)))}`
                        : "Not checked yet"}
                    </span>
                  </div>
                  <div className="vault-box">
                    <div className="meta-row">
                      <span>Vault mission</span>
                      <strong className="mission-id-row">
                        {watch.missionId ? (
                          <>
                            <code>{shortBytes32(watch.missionId)}</code>
                            <button
                              className="icon-btn"
                              onClick={() => void copyMissionId(watch.missionId!)}
                              title="Copy mission ID"
                            >
                              <Copy size={12} />
                            </button>
                          </>
                        ) : (
                          "Not funded"
                        )}
                      </strong>
                    </div>
                    <div className="meta-row">
                      <span>Balance</span>
                      <strong>
                        {watch.missionBalanceWei ? `${formatSTT(BigInt(watch.missionBalanceWei))} STT` : "-"}
                      </strong>
                    </div>
                    <div className="meta-row">
                      <span>Spent / runs</span>
                      <strong>
                        {watch.missionSpentWei
                          ? `${formatSTT(BigInt(watch.missionSpentWei))} STT / ${watch.missionRunCount ?? "0"}`
                          : "-"}
                      </strong>
                    </div>
                    <div className="meta-row">
                      <span>Status</span>
                      <strong>{watch.missionId ? ((opsMission?.active ?? watch.missionActive) ? "Active" : "Inactive") : "-"}</strong>
                    </div>
                    <div className="meta-row">
                      <span>Est. funded runs</span>
                      <strong>{estimateRunsLeft(watch, quotedTotalCost, maxRelayerFee)}</strong>
                    </div>
                    <div className="meta-row">
                      <span>Next browser check</span>
                      <strong>{nextBrowserCheckLabel(watch)}</strong>
                    </div>
                    <div className="meta-row">
                      <span>Payload / context</span>
                      <strong>
                        {latestOpsRun ? `${shortBytes32(latestOpsRun.payload_hash)} / ${shortBytes32(latestOpsRun.context_hash)}` : "-"}
                      </strong>
                    </div>
                  </div>
                  <div className="watch-actions">
                    <button className="btn ghost" onClick={() => void monitorWatch(watch.id, watch)}>
                      Refresh
                    </button>
                    {watch.status === "paused" ? (
                      <button className="btn ghost" onClick={() => resumeWatch(watch.id)}>
                        <Play size={13} /> Resume
                      </button>
                    ) : (
                      <button className="btn ghost" onClick={() => pauseWatch(watch.id)}>
                        <Pause size={13} /> Pause
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => duplicateWatch(watch)}>
                      <Repeat size={13} /> Duplicate
                    </button>
                    <button className="btn primary" onClick={() => loadWatchIntoAnalysis(watch)}>
                      Load for Analysis
                    </button>
                    {!watch.missionId || watch.missionActive === false ? (
                      <>
                        <button
                          className="btn primary"
                          onClick={() => void createVaultMission(watch)}
                          disabled={isSubmitting || !selectedAgent}
                        >
                          Create Vault Mission
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => void attachLatestVaultMission(watch)}
                          disabled={!address}
                        >
                          Attach Latest Mission
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn ghost"
                          onClick={() => void fundVaultMission(watch)}
                          disabled={isSubmitting}
                        >
                          Fund
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            void refreshVaultMission(watch.id, watch.missionId);
                            void refreshAutopilotRuns(watch.missionId);
                          }}
                        >
                          Refresh Vault
                        </button>
                        <button
                          className="btn ghost danger"
                          onClick={() => void cancelVaultMission(watch)}
                          disabled={isSubmitting}
                        >
                          Cancel Vault
                        </button>
                      </>
                    )}
                    {latestOpsRun && (
                      <button className="btn ghost" onClick={() => setSelectedEvidenceRun(latestOpsRun)}>
                        View Evidence
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => archiveWatch(watch.id)}>
                      <Archive size={13} /> Archive
                    </button>
                    <button className="btn ghost danger" onClick={() => removeWatch(watch.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
          </section>

      <div className="empty compact-empty">
        Execution audit moved to the Runs workspace. Autopilot stays focused on funded missions,
        relayer visibility, and mission lifecycle controls.
      </div>
      </>
      )}

      {activeWorkspace === "analysis" && (
      <section className="layout analysis-layout">
        <PCLoadingOverlay
          active={isSubmitting}
          title="PC is preparing your signal"
          subtitle="Submitting the analysis request and waiting for on-chain confirmation."
        />
        {!lastExecutionId ? (
        <article className="panel analysis-panel">
          <div className="panel-head">
            <h2>Signal Terminal</h2>
            <span className="pill">Paid on-chain intelligence</span>
          </div>

          {!CONFIGURED_SAS_AGENT_ID ? (
            <div className="empty">
              Missing <code>NEXT_PUBLIC_COMPANION_SAS_AGENT_ID</code> in <code>packages/predire-app/.env</code>.
            </div>
          ) : companionCandidates.length === 0 ? (
            <div className="empty">
              No active on-chain agents with `somniaAgentId` found in SAS registry.
            </div>
          ) : !selectedAgent ? (
            <div className="empty">
              Configured agent #{CONFIGURED_SAS_AGENT_ID.toString()} is not active, not on-chain, or not found in registry.
            </div>
          ) : !configuredSomniaIdMatches ? (
            <div className="empty">
              Configured somniaAgentId mismatch. Expected #{CONFIGURED_SOMNIA_AGENT_ID?.toString()}, got #{selectedAgent.somniaAgentId.toString()}.
            </div>
          ) : !agentTypeSupported ? (
            <div className="empty">
              Companion currently supports WEBSITE_PARSE and LLM_INFERENCE agents only. Current type is {AgentType[selectedAgent.agentType]}.
            </div>
          ) : (
            <>
              {selectedAgent && (
                <details className="agent-meta compact-agent-meta">
                  <summary>Execution agent</summary>
                  <div className="meta-row">
                    <span>SAS UID</span>
                    <strong>{formatAgentUid(selectedAgent.id, SAS.registry)}</strong>
                  </div>
                  <div className="meta-row">
                    <span>On-chain Agent ID</span>
                    <strong>#{selectedAgent.id.toString()}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Somnia Agent</span>
                    <strong>#{selectedAgent.somniaAgentId.toString()}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Type</span>
                    <strong>{AgentType[selectedAgent.agentType]}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Builder</span>
                    <code>{formatAddress(selectedAgent.builder)}</code>
                  </div>
                  <div className="meta-row">
                    <span>Description</span>
                    <span>{selectedAgent.description}</span>
                  </div>
                </details>
              )}

              <label>
                Execution mode
                <select
                  value={executionMode}
                  onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
                >
                  <option value="billing">Direct paid signal</option>
                  <option value="autonomy-v4" disabled={!autonomyModeAvailable}>
                    Delegated SAS workflow (advanced)
                  </option>
                </select>
              </label>
              <div className="mode-help">
                {executionMode === "billing"
                  ? "Use this for a single high-conviction market read. It pays SASBilling directly and does not create an autonomous mission."
                  : "Use this for advanced multi-agent workflows. It can involve delegate agents and a runner, separate from the Prophecy Autopilot relayer."}
              </div>
              {executionMode === "billing" && oneShotRuntimeCheckRequired && runtimeHealth && (
                <div
                  className={`runtime-health ${
                    runtimeHealth.ok ? "healthy" : runtimeHealth.status === "checking" ? "checking" : "blocked"
                  }`}
                >
                  <div>
                    <strong>
                      {runtimeHealth.ok
                        ? "Signal execution ready"
                        : runtimeHealthLoading || runtimeHealth.status === "checking"
                          ? "Checking signal execution"
                          : "Signal execution paused"}
                    </strong>
                    <span>{friendlyStatusMessage(runtimeHealth.reason)}</span>
                  </div>
                  {runtimeHealth.selector && <code>{runtimeHealth.selector}</code>}
                </div>
              )}
              {executionMode === "autonomy-v4" && (
                <div className="muted-note">
                  {autonomyAutoDelegate
                    ? "Automatic delegation is enabled. The SAS runner hires/sacks delegates per workflow from active SAS agents."
                    : "Manual delegation is enabled. You provide the delegate list; the SAS runner executes it."}
                </div>
              )}

              {executionMode === "autonomy-v4" && (
                <>
                  {!autonomyModeAvailable ? (
                    <div className="empty">
                      Missing <code>NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS</code> for autonomy mode.
                    </div>
                  ) : (
                    <>
                      <div className="agent-meta">
                        <div className="meta-row">
                          <span>Autonomy contract</span>
                          <code>{formatAddress(SAS.autonomyV4)}</code>
                        </div>
                        <div className="meta-row">
                          <span>Runner executor</span>
                          <code>
                            {CONFIGURED_AUTONOMY_RUNNER_ADDRESS
                              ? formatAddress(CONFIGURED_AUTONOMY_RUNNER_ADDRESS)
                              : "Not configured"}
                          </code>
                        </div>
                        <div className="meta-row">
                          <span>Delegation engine</span>
                          <strong>{autonomyAutoDelegate ? "Automatic" : "Manual"}</strong>
                        </div>
                        <div className="meta-row">
                          <span>Delegation chain</span>
                          <strong>
                            {selectedAgent ? `#${selectedAgent.id.toString()}` : "-"}
                            {delegatedAgents.length > 0
                              ? ` -> ${delegatedAgents.map((agent) => `#${agent.id.toString()}`).join(" -> ")}`
                              : " (root only)"}
                          </strong>
                        </div>
                      </div>

                      <div className="watch-form">
                        <label>
                          Workflow budget (STT)
                          <input
                            value={autonomyBudgetStt}
                            onChange={(e) => setAutonomyBudgetStt(e.target.value)}
                            placeholder="1.0"
                          />
                        </label>
                        <label>
                          Max depth
                          <input
                            value={autonomyMaxDepth}
                            onChange={(e) => setAutonomyMaxDepth(e.target.value)}
                            placeholder="4"
                          />
                        </label>
                        {autonomyAutoDelegate && (
                          <label>
                            Max delegated agents
                            <input
                              value={autonomyMaxDelegates}
                              onChange={(e) => setAutonomyMaxDelegates(e.target.value)}
                              placeholder="2"
                            />
                          </label>
                        )}
                      </div>

                      <div className="agent-meta">
                        <div className="meta-row">
                          <span>Delegated agents (planned)</span>
                          <strong>{delegatedAgents.length}</strong>
                        </div>
                        {autonomyAutoDelegate ? (
                          <>
                            {delegatedAgents.length === 0 ? (
                              <div className="meta-row">
                                <span>No delegate selected by planner yet.</span>
                                <span>With one listed agent, root-only autonomy is expected.</span>
                              </div>
                            ) : (
                              delegatedAgents.map((agent, index) => (
                                <div className="meta-row" key={`auto-delegate-${agent.id.toString()}`}>
                                  <span>{`#${index + 1} -> #${agent.id.toString()} ${agent.name}`}</span>
                                  <span>{agent.isVerified ? "Verified" : "Unverified"}</span>
                                </div>
                              ))
                            )}
                            <div className="meta-row">
                              <span>Planner policy</span>
                              <span>Category match, builder diversity, verification, usage history.</span>
                            </div>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => setAutonomyAutoDelegate(false)}
                            >
                              Switch to Manual Delegation
                            </button>
                          </>
                        ) : (
                          <>
                            {delegatedAgents.length === 0 ? (
                              <div className="meta-row">
                                <span>No delegates hired yet.</span>
                                <span>Root agent still runs through V4.</span>
                              </div>
                            ) : (
                              delegatedAgents.map((agent) => (
                                <div className="meta-row" key={`delegate-${agent.id.toString()}`}>
                                  <span>
                                    #{agent.id.toString()} {agent.name}
                                  </span>
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => sackDelegate(agent.id)}
                                  >
                                    Sack
                                  </button>
                                </div>
                              ))
                            )}
                            {availableDelegationAgents.length > 0 ? (
                              availableDelegationAgents.map((agent) => (
                                <div className="meta-row" key={`available-${agent.id.toString()}`}>
                                  <span>
                                    #{agent.id.toString()} {agent.name}
                                  </span>
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => hireDelegate(agent.id)}
                                  >
                                    Hire
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="meta-row">
                                <span>No additional active agents available for delegation.</span>
                                <span>Register more SAS agents to expand delegation.</span>
                              </div>
                            )}
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => setAutonomyAutoDelegate(true)}
                            >
                              Switch to Automatic Delegation
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              <label>
                Prophecy event URL
                <input
                  value={form.prophecyEventUrl}
                  onChange={(e) => update("prophecyEventUrl", e.target.value)}
                  placeholder="https://prophecy.social/event/14776"
                />
              </label>

              {parsedEvent.valid && parsedEvent.eventId && (
                <div className="agent-meta">
                  <div className="meta-row">
                    <span>Event ID</span>
                    <strong>#{parsedEvent.eventId}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Source</span>
                    <code>prophecy.social</code>
                  </div>
                </div>
              )}

              <label>
                What should Companion answer?
                <textarea
                  rows={3}
                  value={form.analysisAsk}
                  onChange={(e) => update("analysisAsk", e.target.value)}
                  placeholder="Given this market and its criteria, what is the likely winning outcome now?"
                />
              </label>

              <label>
                Extra context (optional)
                <input
                  value={form.extraContext}
                  onChange={(e) => update("extraContext", e.target.value)}
                  placeholder="Optional: add market title, odds, injury news, sentiment, or resolution details"
                />
              </label>
              {selectedAgent?.agentType === AgentType.LLM_INFERENCE && (
                <div className="muted-note">
                  URL-only analysis is supported. The app auto-extracts Prophecy page context before calling the LLM agent; add extra context only for details the page may not expose.
                </div>
              )}

              <div className="agent-meta">
                <div className="meta-row">
                  <span>Agent service fee</span>
                  <strong>{quotedAgentFee !== undefined ? `${formatSTT(quotedAgentFee)} STT` : "-"}</strong>
                </div>
                <div className="meta-row">
                  <span>Somnia runtime budget</span>
                  <strong>{quotedRuntimeBudget !== undefined ? `${formatSTT(quotedRuntimeBudget)} STT` : "-"}</strong>
                </div>
                <div className="meta-row">
                  <span>Total analysis payment</span>
                  <strong>
                    {quotedTotalCost !== undefined
                      ? `${formatSTT(quotedTotalCost)} STT`
                      : executionMode === "billing"
                        ? "Billing migration required"
                        : "Quoted at workflow runtime"}
                  </strong>
                </div>
              </div>

              <button
                className="btn primary"
                onClick={() => void runAnalysis()}
                disabled={
                  isSubmitting ||
                  !selectedAgent ||
                  !configuredSomniaIdMatches ||
                  !agentTypeSupported ||
                  !analysisExecutionReady
                }
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="spin" /> Submitting
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />{" "}
                    {executionMode === "billing"
                      ? "Run One-Shot Analysis"
                      : "Create Delegated Workflow"}
                  </>
                )}
              </button>
            </>
          )}
        </article>
        ) : (
        <article className="panel result-panel">
          <div className="panel-head">
            <div>
              <h2>Latest Result</h2>
              <p className="panel-copy">Result appears here after PC completes the analysis request.</p>
            </div>
            <div className="run-links">
              <span className="pill">{lastExecutionId ? `#${lastExecutionId.toString()}` : "No execution yet"}</span>
              {lastExecutionId && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    setLastExecutionId(null);
                    setLastTxHash(null);
                  }}
                >
                  Run another analysis
                </button>
              )}
            </div>
          </div>

          {lastTxHash && (
            <a
              href={`https://shannon-explorer.somnia.network/tx/${lastTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              <ExternalLink size={12} /> View latest transaction
            </a>
          )}

          {!lastExecutionId ? (
            <div className="empty">Run analysis to see results.</div>
          ) : !latest ? (
            <div className="status-row">
              <Loader2 size={14} className="spin" />
              Waiting for execution record...
            </div>
          ) : (
            <>
              <div className="status-badge">{statusLabel(latest.status)}</div>

              {latestPredictionLabel && (
                <div className="result-grid">
                  <div>
                    <p className="k">Prediction</p>
                    <h3>{latestPredictionLabel}</h3>
                  </div>
                  {(latestOutcomeLabel || latestSummary.selectedMarketId || latestSummary.side) && (
                    <div>
                      <p className="k">Selected outcome</p>
                      <h3>{latestOutcomeLabel ?? "N/A"}</h3>
                      <small>
                        {[
                          latestSummary.side ? `Side ${latestSummary.side}` : null,
                          latestSummary.selectedMarketId ? `Market ${latestSummary.selectedMarketId}` : null,
                        ]
                          .filter(Boolean)
                          .join(" | ")}
                      </small>
                    </div>
                  )}
                  <div>
                    <p className="k">Probability</p>
                    <h3>
                      {typeof latestSummary.probability === "number"
                        ? `${(latestSummary.probability * 100).toFixed(1)}%`
                        : "N/A"}
                    </h3>
                  </div>
                  <div>
                    <p className="k">Confidence</p>
                    <h3>{formatConfidence(latestSummary.confidence)}</h3>
                  </div>
                </div>
              )}

              {(latestSummary.modelProbability !== undefined ||
                latestSummary.marketProbability !== undefined ||
                latestSummary.edge !== undefined ||
                latestSummary.opportunityScore !== undefined) && (
                <div className="opportunity-grid">
                  <div>
                    <p className="k">Model probability</p>
                    <h3>{formatProbability(latestSummary.modelProbability ?? latestSummary.probability)}</h3>
                  </div>
                  <div>
                    <p className="k">Market probability</p>
                    <h3>{formatProbability(latestSummary.marketProbability)}</h3>
                  </div>
                  <div>
                    <p className="k">Edge</p>
                    <h3>{formatProbability(latestSummary.edge)}</h3>
                  </div>
                  <div>
                    <p className="k">Opportunity score</p>
                    <h3>{formatProbability(latestSummary.opportunityScore)}</h3>
                  </div>
                  <div>
                    <p className="k">Resolution clarity</p>
                    <h3>{formatConfidence(latestSummary.resolutionClarity)}</h3>
                  </div>
                  <div>
                    <p className="k">Risk level</p>
                    <h3>{latestSummary.riskLevel ?? "N/A"}</h3>
                  </div>
                </div>
              )}

              {latestSummary.suggestedUserAction && (
                <div className="decision-card">
                  <p className="k">Suggested action</p>
                  <h3>{latestSummary.suggestedUserAction}</h3>
                  <p>
                    Companion output is analysis support, not betting or financial advice. Use it with your own judgment.
                  </p>
                </div>
              )}

              <div className="reason-box">
                <p className="k">Reasoning</p>
                <p>{latestSummary.reasoning ?? "No structured reasoning field. Raw output shown below."}</p>
              </div>

              {(latestSummary.crowdSignal || latestSummary.externalEvidenceSummary) && (
                <div className="insight-grid">
                  {latestSummary.crowdSignal && (
                    <div className="reason-box">
                      <p className="k">Crowd signal</p>
                      <p>{latestSummary.crowdSignal}</p>
                    </div>
                  )}
                  {latestSummary.externalEvidenceSummary && (
                    <div className="reason-box">
                      <p className="k">External evidence</p>
                      <p>{latestSummary.externalEvidenceSummary}</p>
                    </div>
                  )}
                </div>
              )}

              {(latestSummary.marketSummary || latestSummary.marketStructure || latestSummary.resolutionCriteria) && (
                <div className="reason-box">
                  {latestSummary.marketSummary && (
                    <>
                      <p className="k">Market summary</p>
                      <p>{latestSummary.marketSummary}</p>
                    </>
                  )}
                  {latestSummary.marketStructure && (
                    <>
                      <p className="k stacked-k">Market structure</p>
                      <p>{latestSummary.marketStructure}</p>
                    </>
                  )}
                  {latestSummary.resolutionCriteria && (
                    <>
                      <p className="k stacked-k">Resolution criteria</p>
                      <p>{latestSummary.resolutionCriteria}</p>
                    </>
                  )}
                </div>
              )}

              {((latestSummary.keyEvidence && latestSummary.keyEvidence.length > 0) ||
                (latestSummary.counterEvidence && latestSummary.counterEvidence.length > 0) ||
                (latestSummary.uncertaintyDrivers && latestSummary.uncertaintyDrivers.length > 0) ||
                (latestSummary.risks && latestSummary.risks.length > 0)) && (
                <div className="insight-grid">
                  {latestSummary.keyEvidence && latestSummary.keyEvidence.length > 0 && (
                    <div className="reason-box">
                      <p className="k">Key evidence</p>
                      <ul className="clean-list">
                        {latestSummary.keyEvidence.map((e, i) => (
                          <li key={`${e}-${i}`}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {latestSummary.counterEvidence && latestSummary.counterEvidence.length > 0 && (
                    <div className="reason-box">
                      <p className="k">Counter-evidence</p>
                      <ul className="clean-list">
                        {latestSummary.counterEvidence.map((e, i) => (
                          <li key={`${e}-${i}`}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {latestSummary.uncertaintyDrivers && latestSummary.uncertaintyDrivers.length > 0 && (
                    <div className="reason-box">
                      <p className="k">Uncertainty drivers</p>
                      <ul className="clean-list">
                        {latestSummary.uncertaintyDrivers.map((driver, i) => (
                          <li key={`${driver}-${i}`}>{driver}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {latestSummary.risks && latestSummary.risks.length > 0 && (
                    <div className="reason-box">
                      <p className="k">Risks</p>
                      <ul className="clean-list">
                        {latestSummary.risks.map((risk, i) => (
                          <li key={`${risk}-${i}`}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {latestSummary.sourcesUsed && latestSummary.sourcesUsed.length > 0 && (
                <div className="reason-box">
                  <p className="k">Sources used</p>
                  <ul className="source-list">
                    {latestSummary.sourcesUsed.map((source, i) => {
                      const href = sourceHref(source);
                      return (
                        <li key={`${source}-${i}`}>
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="link">
                              <ExternalLink size={12} /> {source}
                            </a>
                          ) : (
                            source
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <details>
                <summary>Raw output</summary>
                <pre>{latestSummary.raw || "(empty)"}</pre>
              </details>
            </>
          )}
        </article>
        )}
      </section>
      )}

      {activeWorkspace === "runs" && (
      <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Execution Audit</h2>
            <p className="panel-copy">
              Review autonomous runs with trigger rationale, payload hashes, context hashes,
              transaction links, cost, and evidence provenance.
            </p>
          </div>
          <button className="btn ghost" onClick={() => void refreshOpsData()} disabled={opsLoading}>
            {opsLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
        </div>

        {(opsData?.runs?.length ?? 0) === 0 ? (
          <div className="empty">
            No PC Autopilot runs yet. Fund a mission or refresh the vault history.
          </div>
        ) : (
          <div className="run-list dense">
            {opsData!.runs.map((run) => {
              const context = contextByHash.get(run.context_hash.toLowerCase());
              return (
                <article key={run.id} className="run-card">
                  <div className="run-card-head">
                    <div>
                      <p className="k">Mission {shortBytes32(run.mission_id)}</p>
                      <h3>{run.execution_id ? `Execution #${run.execution_id}` : run.status}</h3>
                    </div>
                    <span className={`status-badge ${run.status === "failed" ? "blocked" : "ready"}`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="opportunity-grid compact">
                    <div>
                      <p className="k">Prediction</p>
                      <h3>{run.consensus?.probability !== undefined ? formatProbability(run.consensus.probability) : "-"}</h3>
                    </div>
                    <div>
                      <p className="k">Confidence</p>
                      <h3>{run.consensus?.confidence !== undefined ? formatProbability(run.consensus.confidence) : "-"}</h3>
                    </div>
                    <div>
                      <p className="k">Edge</p>
                      <h3>{run.consensus?.edge !== undefined && run.consensus.edge !== null ? formatProbability(run.consensus.edge) : "-"}</h3>
                    </div>
                    <div>
                      <p className="k">Reason</p>
                      <h3>{run.execution_source ?? "-"}</h3>
                    </div>
                  </div>
                  <div className="run-meta">
                    <span>Payload {shortBytes32(run.payload_hash)}</span>
                    <span>Context {shortBytes32(run.context_hash)}</span>
                    <span>Relayer {formatWeiStt(run.relayer_fee_wei)}</span>
                    <span>{formatIsoRelative(run.created_at)}</span>
                    {context && <span>{context.external_source_urls.length} evidence URLs</span>}
                  </div>
                  <div className="history-body">
                    <Bot size={13} />
                    <span>{run.error ?? run.execution_rationale ?? run.consensus?.summary ?? "No rationale recorded."}</span>
                  </div>
                  <div className="run-links">
                    {run.transaction_hash && (
                      <a
                        href={`https://shannon-explorer.somnia.network/tx/${run.transaction_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        <ExternalLink size={12} /> Tx
                      </a>
                    )}
                    <button className="btn ghost" onClick={() => setSelectedEvidenceRun(run)}>
                      View evidence
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Manual Signal History</h2>
          <span className="pill">{selectedAgent ? selectedAgent.name : "-"}</span>
        </div>

        {recentRecords.length === 0 ? (
          <div className="empty">No recent runs found.</div>
        ) : (
          <div className="history">
            {recentRecords.map((r) => {
              const decoded = decodeExecutionString(r.result);
              const summary = parseResultSummary(decoded);
              const predictionLabel = displayPrediction(summary);
              return (
                <article key={r.id.toString()} className="history-item">
                  <div className="history-head">
                    <code>#{r.id.toString()}</code>
                    <span>{statusLabel(r.status)}</span>
                    <span>{formatRelative(r.createdAt)}</span>
                    <span>{formatAddress(r.subscriber)}</span>
                    <span>{formatEther(r.amountPaid)} STT</span>
                  </div>
                  <div className="history-body">
                    <Bot size={13} />
                    {predictionLabel ? (
                      <span>
                        {predictionLabel} {typeof summary.probability === "number" ? `(${(summary.probability * 100).toFixed(1)}%)` : ""}
                        {summary.suggestedUserAction ? ` - ${summary.suggestedUserAction}` : ""}
                      </span>
                    ) : (
                      <span>{(decoded ?? "No output").slice(0, 180)}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      </>
      )}

      {activeWorkspace === "settings" && (
      <section className="panel settings-panel">
        <div className="panel-head">
          <div>
            <h2>Control Plane</h2>
            <p className="panel-copy">
              Production visibility for the agent, vault, relayer, billing, autonomy runtime, and
              indexer state used by this application.
            </p>
          </div>
          <Settings size={18} />
        </div>
        <div className="settings-grid">
          <div>
            <p className="k">Vault</p>
            <code>{SAS.autopilotVault}</code>
          </div>
          <div>
            <p className="k">Relayer</p>
            <code>{latestHeartbeat?.relayer_address ?? "No heartbeat"}</code>
          </div>
          <div>
            <p className="k">Indexer store</p>
            <strong>{opsData?.configured === false ? "Not connected" : "Connected"}</strong>
          </div>
          <div>
            <p className="k">App policy version</p>
            <strong>v{MISSION_POLICY_VERSION}</strong>
          </div>
          <div>
            <p className="k">Companion SAS agent</p>
            <strong>{selectedAgent ? formatAgentUid(selectedAgent.id, SAS.registry) : "-"}</strong>
          </div>
          <div>
            <p className="k">Scan from block</p>
            <strong>{AUTOPILOT_SCAN_FROM_BLOCK.toString()}</strong>
          </div>
          {renderServices.map((service) => (
            <div key={service.key}>
              <p className="k">{service.label}</p>
              <strong>{service.ok ? "Ready" : service.status}</strong>
              <code>{service.endpoint ?? "Not configured"}</code>
            </div>
          ))}
        </div>
        <div className="workflow-recovery">
          <div>
            <p className="k">Delegated workflow recovery</p>
            <strong>{lastWorkflowId ? `Last created #${lastWorkflowId.toString()}` : "Cancel by workflow id"}</strong>
            <span>
              Cancelling an active/paused `SASAutonomyV4` workflow refunds its remaining budget to
              the wallet that created it.
            </span>
          </div>
          <label>
            Workflow ID
            <input
              value={workflowRecoveryId}
              onChange={(e) => setWorkflowRecoveryId(e.target.value)}
              placeholder="1"
            />
          </label>
          <button
            className="btn ghost danger"
            onClick={() => void cancelDelegatedWorkflow()}
            disabled={isSubmitting || !authenticated || !autonomyModeAvailable}
          >
            Cancel Workflow
          </button>
        </div>
      </section>
      )}

      {selectedTradeIdea && (
        <section className="evidence-drawer" aria-label="Trader position details drawer">
          <div className="drawer-panel">
            <div className="panel-head">
              <div>
                <p className="k">Autonomous trader position</p>
                <h2>{selectedTradeIdea.subMarketTitle}</h2>
              </div>
              <button className="btn ghost" onClick={() => setSelectedTradeIdea(null)}>
                Close
              </button>
            </div>

            <div className="opportunity-grid compact">
              <div>
                <p className="k">Market</p>
                <h3>
                  #{selectedTradeIdea.eventId}
                  {selectedTradeIdea.marketId ? ` / M${selectedTradeIdea.marketId}` : ""}
                </h3>
                <span>{selectedTradeIdea.title}</span>
              </div>
              <div>
                <p className="k">Bet</p>
                <h3>{tradeSideLabel(selectedTradeIdea)}</h3>
                <span>${selectedTradeIdea.stakeUsd.toFixed(2)} stake</span>
              </div>
              <div>
                <p className="k">Risk policy</p>
                <h3>{riskLabel(selectedTradeIdea.risk)}</h3>
                <span>
                  {selectedTradeIdea.maxPositions} max / {selectedTradeIdea.minEdgePct}% min edge
                </span>
              </div>
              <div>
                <p className="k">Status</p>
                <h3>{selectedTradeIdea.status === "open" ? "Open / watching" : selectedTradeIdea.status}</h3>
                <span>{selectedTradeIdea.outcomeNote ?? "Awaiting Prophecy resolution confirmation"}</span>
              </div>
            </div>

            <div className="evidence-grid">
              <div className="reason-box">
                <p className="k">Reason PC picked it</p>
                <p>{selectedTradeIdea.rationale}</p>
              </div>
              <div className="reason-box">
                <p className="k">Probabilities</p>
                <p>
                  Model {formatProbability(selectedTradeIdea.modelProbability ?? undefined)} | Market{" "}
                  {formatProbability(selectedTradeIdea.marketProbability ?? undefined)}
                </p>
                <p>
                  Edge {selectedTradeIdea.edgePct === null ? "N/A" : `${selectedTradeIdea.edgePct.toFixed(1)}%`} |
                  Confidence{" "}
                  {selectedTradeIdea.confidencePct === null ? "N/A" : `${selectedTradeIdea.confidencePct.toFixed(1)}%`}
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Timing</p>
                <p>Placed {new Date(selectedTradeIdea.createdAt).toLocaleString()}</p>
                <p>
                  Resolution check{" "}
                  {selectedTradeIdea.nextResolutionCheckAt
                    ? new Date(selectedTradeIdea.nextResolutionCheckAt).toLocaleString()
                    : "unknown"}
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Book accounting</p>
                <p>
                  Before ${selectedTradeIdea.balanceBeforeUsd.toFixed(2)} | Stake $
                  {selectedTradeIdea.stakeUsd.toFixed(2)}
                </p>
                <p>
                  After{" "}
                  {selectedTradeIdea.balanceAfterUsd !== undefined
                    ? `$${selectedTradeIdea.balanceAfterUsd.toFixed(2)}`
                    : "locked until settlement"}
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Paid SAS run</p>
                <p>{selectedTradeIdea.cycleExecutionId ? `Execution #${selectedTradeIdea.cycleExecutionId}` : "Execution id unavailable"}</p>
                <p>{selectedTradeIdea.cycleTxHash ? shortBytes32(selectedTradeIdea.cycleTxHash) : "Transaction unavailable"}</p>
              </div>
              <div className="reason-box">
                <p className="k">Settlement rule</p>
                <p>
                  PC keeps this open until the expected resolution check time, then the Prophecy settlement adapter must
                  confirm won, lost, or void before the book updates.
                </p>
              </div>
            </div>

            <div className="run-links">
              <a className="link" href={selectedTradeIdea.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Open Prophecy market
              </a>
              {selectedTradeIdea.cycleTxHash && (
                <a
                  className="link"
                  href={`https://shannon-explorer.somnia.network/tx/${selectedTradeIdea.cycleTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={12} /> Paid cycle transaction
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {selectedEvidenceRun && (
        <section className="evidence-drawer" aria-label="Run evidence drawer">
          <div className="drawer-panel">
            <div className="panel-head">
              <div>
                <p className="k">Evidence</p>
                <h2>
                  {isOpsRun(selectedEvidenceRun)
                    ? selectedEvidenceRun.execution_id
                      ? `Execution #${selectedEvidenceRun.execution_id}`
                      : "Failed autonomous run"
                    : `Execution #${selectedEvidenceRun.executionId.toString()}`}
                </h2>
              </div>
              <button className="btn ghost" onClick={() => setSelectedEvidenceRun(null)}>
                Close
              </button>
            </div>
            <div className="evidence-grid">
              <div className="reason-box">
                <p className="k">Why this mission executed</p>
                <p>
                  {isOpsRun(selectedEvidenceRun)
                    ? selectedEvidenceRun.execution_rationale ?? selectedEvidenceRun.error ?? "No rationale recorded."
                    : "Indexed from vault event; full rationale appears when automation records are available."}
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Prophecy market snapshot</p>
                <p>{selectedEvidenceOpsMission?.question ?? selectedEvidenceContext?.event_url ?? "Snapshot metadata unavailable."}</p>
                {selectedEvidenceContext && <code>{shortBytes32(selectedEvidenceContext.prophecy_snapshot_hash)}</code>}
              </div>
              <div className="reason-box">
                <p className="k">Model / crowd probabilities</p>
                <p>
                  Model{" "}
                  {isOpsRun(selectedEvidenceRun)
                    ? formatProbability(selectedEvidenceRun.consensus?.probability)
                    : "N/A"}{" "}
                  | Crowd{" "}
                  {isOpsRun(selectedEvidenceRun)
                    ? formatProbability(selectedEvidenceRun.consensus?.marketProbability ?? undefined)
                    : "N/A"}
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Hashes</p>
                <p>
                  Payload{" "}
                  <code>
                    {shortBytes32(isOpsRun(selectedEvidenceRun) ? selectedEvidenceRun.payload_hash : selectedEvidenceRun.payloadHash)}
                  </code>
                </p>
                <p>
                  Context{" "}
                  <code>
                    {shortBytes32(isOpsRun(selectedEvidenceRun) ? selectedEvidenceRun.context_hash : selectedEvidenceRun.contextHash)}
                  </code>
                </p>
              </div>
              <div className="reason-box">
                <p className="k">Key evidence</p>
                <p>{selectedEvidenceContext?.model_input_summary || "No context provenance was recorded for this hash."}</p>
              </div>
              <div className="reason-box">
                <p className="k">Risks</p>
                <p>
                  {isOpsRun(selectedEvidenceRun)
                    ? selectedEvidenceRun.error ?? selectedEvidenceRun.consensus?.summary ?? "No specific risk memo recorded."
                    : "Chain-only event; inspect the linked SAS result for model risks."}
                </p>
              </div>
            </div>
            {selectedEvidenceContext?.external_source_urls?.length ? (
              <div className="reason-box">
                <p className="k">External sources</p>
                <ul className="source-list">
                  {selectedEvidenceContext.external_source_urls.map((source) => (
                    <li key={source}>
                      <a className="link" href={source} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} /> {source}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="run-links">
              {isOpsRun(selectedEvidenceRun) && selectedEvidenceRun.transaction_hash && (
                <a
                  className="link"
                  href={`https://shannon-explorer.somnia.network/tx/${selectedEvidenceRun.transaction_hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={12} /> Vault transaction
                </a>
              )}
              {!isOpsRun(selectedEvidenceRun) && selectedEvidenceRun.txHash && (
                <a
                  className="link"
                  href={`https://shannon-explorer.somnia.network/tx/${selectedEvidenceRun.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={12} /> Vault transaction
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      <footer className="footnote">
        <code>Registry: {SAS.registry}</code>
        <code>Billing: {SAS.billing}</code>
        <code>AutonomyV4: {SAS.autonomyV4}</code>
        <code>AutopilotVault: {SAS.autopilotVault}</code>
      </footer>
      </section>
    </main>
  );
}
