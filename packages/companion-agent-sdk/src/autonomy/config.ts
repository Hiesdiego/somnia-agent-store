export type AutonomyConfig = {
  storeMode: "supabase" | "local";
  localStateFile: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema: string;
  historyLimit: number;
  triggerCooldownMs: number;
  oddsJumpBps: number;
  oddsJumpWindowMinutes: number;
  volumeSpikeMultiplier: number;
  sentimentDivergenceThreshold: number;
  whaleFlowThreshold: number;
  minConfidenceToExecute: number;
  minEdgeToExecute: number;
  requireSignalForCadence: boolean;
  minConfidenceForCadence: number;
  minEdgeForCadence: number;
  thesisRevisionMinDelta: number;
  learningRate: number;
  maxSnapshotsPerMission: number;
  outcomeSyncUrl?: string;
  outcomeSyncApiKey?: string;
};

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = optional(name);
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

export function loadAutonomyConfig(): AutonomyConfig {
  const supabaseUrl = optional("SUPABASE_URL");
  const supabaseServiceRoleKey = optional("SUPABASE_SERVICE_ROLE_KEY");
  const explicitMode = optional("AUTONOMY_STORE_MODE");
  const inferredMode =
    explicitMode === "supabase" || explicitMode === "local"
      ? explicitMode
      : supabaseUrl && supabaseServiceRoleKey
        ? "supabase"
        : "local";

  return {
    storeMode: inferredMode,
    localStateFile: optional("AUTONOMY_LOCAL_STATE_FILE") ?? ".autonomy-state.json",
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseSchema: optional("SUPABASE_SCHEMA") ?? "public",
    historyLimit: Math.max(20, Math.floor(optionalNumber("AUTONOMY_HISTORY_LIMIT", 200))),
    triggerCooldownMs: Math.max(60_000, Math.floor(optionalNumber("AUTONOMY_TRIGGER_COOLDOWN_MS", 15 * 60_000))),
    oddsJumpBps: Math.max(100, Math.floor(optionalNumber("AUTONOMY_ODDS_JUMP_BPS", 1200))),
    oddsJumpWindowMinutes: Math.max(5, Math.floor(optionalNumber("AUTONOMY_ODDS_JUMP_WINDOW_MINUTES", 30))),
    volumeSpikeMultiplier: Math.max(1.1, optionalNumber("AUTONOMY_VOLUME_SPIKE_MULTIPLIER", 2.0)),
    sentimentDivergenceThreshold: clamp(optionalNumber("AUTONOMY_SENTIMENT_DIVERGENCE_THRESHOLD", 0.35), 0.1, 1),
    whaleFlowThreshold: clamp(optionalNumber("AUTONOMY_WHALE_FLOW_THRESHOLD", 0.6), 0.1, 1),
    minConfidenceToExecute: clamp(optionalNumber("AUTONOMY_MIN_CONFIDENCE_TO_EXECUTE", 0.58), 0, 1),
    minEdgeToExecute: clamp(optionalNumber("AUTONOMY_MIN_EDGE_TO_EXECUTE", 0.06), 0, 1),
    requireSignalForCadence: optionalBool("AUTONOMY_REQUIRE_SIGNAL_FOR_CADENCE", true),
    minConfidenceForCadence: clamp(optionalNumber("AUTONOMY_MIN_CONFIDENCE_FOR_CADENCE", 0.5), 0, 1),
    minEdgeForCadence: clamp(optionalNumber("AUTONOMY_MIN_EDGE_FOR_CADENCE", 0.025), 0, 1),
    thesisRevisionMinDelta: clamp(optionalNumber("AUTONOMY_THESIS_REVISION_MIN_DELTA", 0.025), 0.005, 0.25),
    learningRate: clamp(optionalNumber("AUTONOMY_LEARNING_RATE", 0.15), 0.01, 1),
    maxSnapshotsPerMission: Math.max(50, Math.floor(optionalNumber("AUTONOMY_MAX_SNAPSHOTS_PER_MISSION", 1000))),
    outcomeSyncUrl: optional("AUTONOMY_OUTCOME_SYNC_URL"),
    outcomeSyncApiKey: optional("AUTONOMY_OUTCOME_SYNC_API_KEY"),
  };
}
