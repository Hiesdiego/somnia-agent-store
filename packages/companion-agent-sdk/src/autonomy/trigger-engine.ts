import type { AutonomyConfig } from "./config.ts";
import type { ConsensusResult, MarketSnapshot, TriggerEvent, TriggerType } from "./types.ts";
import { average, clamp, hashId, stdDev } from "./utils.ts";

type TriggerContext = {
  missionId: `0x${string}`;
  eventUrl: string;
  snapshot: MarketSnapshot;
  history: MarketSnapshot[];
  recentTriggers: TriggerEvent[];
  config: AutonomyConfig;
  now?: number;
};

function lastTriggerAt(type: TriggerType, triggers: TriggerEvent[]): number | null {
  const match = triggers.find((trigger) => trigger.type === type);
  if (!match) return null;
  const timestamp = Date.parse(match.triggeredAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function cooldownActive(type: TriggerType, triggers: TriggerEvent[], cooldownMs: number, now: number): boolean {
  const last = lastTriggerAt(type, triggers);
  if (!last) return false;
  return now - last < cooldownMs;
}

function buildTrigger(
  input: TriggerContext,
  type: TriggerType,
  severity: number,
  details: Record<string, unknown>
): TriggerEvent {
  const triggeredAt = new Date(input.now ?? Date.now()).toISOString();
  const id = hashId(input.missionId, input.eventUrl, type, triggeredAt, JSON.stringify(details));
  return {
    id,
    missionId: input.missionId,
    eventUrl: input.eventUrl,
    type,
    triggeredAt,
    severity: clamp(severity, 0, 1),
    details,
    executionRequested: false,
  };
}

function detectOddsJump(input: TriggerContext): TriggerEvent | null {
  const probability = input.snapshot.signals.marketProbability;
  if (probability === null) return null;
  const now = input.now ?? Date.now();
  if (cooldownActive("odds_jump", input.recentTriggers, input.config.triggerCooldownMs, now)) return null;

  const windowMs = input.config.oddsJumpWindowMinutes * 60_000;
  const candidates = input.history
    .filter((snapshot) => snapshot.id !== input.snapshot.id)
    .filter((snapshot) => now - Date.parse(snapshot.capturedAt) <= windowMs)
    .filter((snapshot) => snapshot.signals.marketProbability !== null);

  if (candidates.length === 0) return null;
  const baseline = candidates[candidates.length - 1];
  const baselineProbability = baseline.signals.marketProbability;
  if (baselineProbability === null) return null;

  const delta = Math.abs(probability - baselineProbability);
  const deltaBps = delta * 10_000;
  if (deltaBps < input.config.oddsJumpBps) return null;

  const severity = Math.min(1, deltaBps / (input.config.oddsJumpBps * 2));
  return buildTrigger(input, "odds_jump", severity, {
    fromProbability: baselineProbability,
    toProbability: probability,
    delta,
    deltaBps,
    windowMinutes: input.config.oddsJumpWindowMinutes,
  });
}

function detectVolumeAnomaly(input: TriggerContext): TriggerEvent | null {
  const volume = input.snapshot.signals.volume;
  if (volume === null) return null;
  const now = input.now ?? Date.now();
  if (cooldownActive("volume_anomaly", input.recentTriggers, input.config.triggerCooldownMs, now)) return null;

  const historyVolumes = input.history
    .filter((snapshot) => snapshot.id !== input.snapshot.id)
    .map((snapshot) => snapshot.signals.volume)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .slice(0, 30);

  if (historyVolumes.length < 5) return null;
  const mean = average(historyVolumes);
  const deviation = stdDev(historyVolumes);
  const multiplier = mean > 0 ? volume / mean : 0;
  const zScore = deviation > 0 ? (volume - mean) / deviation : 0;
  if (multiplier < input.config.volumeSpikeMultiplier && zScore < 2) return null;

  const severity = clamp(Math.max(multiplier / input.config.volumeSpikeMultiplier, zScore / 3) / 2, 0, 1);
  return buildTrigger(input, "volume_anomaly", severity, {
    volume,
    meanVolume: mean,
    volumeMultiplier: multiplier,
    zScore,
  });
}

function detectSentimentPriceDivergence(input: TriggerContext): TriggerEvent | null {
  const sentiment = input.snapshot.signals.sentimentScore;
  const probability = input.snapshot.signals.marketProbability;
  if (probability === null) return null;
  const now = input.now ?? Date.now();
  if (
    cooldownActive(
      "sentiment_price_divergence",
      input.recentTriggers,
      input.config.triggerCooldownMs,
      now
    )
  ) {
    return null;
  }

  const previous = input.history
    .filter((snapshot) => snapshot.id !== input.snapshot.id)
    .find((snapshot) => snapshot.signals.marketProbability !== null);
  if (!previous || previous.signals.marketProbability === null) return null;

  const move = probability - previous.signals.marketProbability;
  const moveThreshold = 0.03;
  const sentimentThreshold = input.config.sentimentDivergenceThreshold;
  const divergence =
    (sentiment >= sentimentThreshold && move <= -moveThreshold) ||
    (sentiment <= -sentimentThreshold && move >= moveThreshold);
  if (!divergence) return null;

  const severity = clamp(
    (Math.abs(sentiment) / sentimentThreshold + Math.abs(move) / moveThreshold) / 3,
    0,
    1
  );
  return buildTrigger(input, "sentiment_price_divergence", severity, {
    sentimentScore: sentiment,
    previousProbability: previous.signals.marketProbability,
    currentProbability: probability,
    marketMove: move,
  });
}

function detectWhaleFlow(input: TriggerContext): TriggerEvent | null {
  const whaleScore = input.snapshot.signals.whaleFlowScore;
  if (Math.abs(whaleScore) < input.config.whaleFlowThreshold) return null;
  const now = input.now ?? Date.now();
  if (cooldownActive("whale_flow", input.recentTriggers, input.config.triggerCooldownMs, now)) return null;

  const severity = clamp(Math.abs(whaleScore) / input.config.whaleFlowThreshold / 2, 0, 1);
  return buildTrigger(input, "whale_flow", severity, {
    whaleFlowScore: whaleScore,
    direction: whaleScore > 0 ? "accumulation" : "distribution",
  });
}

export function evaluateTriggers(input: TriggerContext): TriggerEvent[] {
  const detectors = [
    detectOddsJump(input),
    detectVolumeAnomaly(input),
    detectSentimentPriceDivergence(input),
    detectWhaleFlow(input),
  ];
  return detectors.filter((trigger): trigger is TriggerEvent => Boolean(trigger));
}

export function shouldExecuteFromTriggers(
  consensus: ConsensusResult,
  triggers: TriggerEvent[],
  config: AutonomyConfig
): { shouldExecute: boolean; rationale: string } {
  if (triggers.length === 0) {
    return { shouldExecute: false, rationale: "No trigger fired." };
  }

  const strongest = triggers.slice().sort((a, b) => b.severity - a.severity)[0];
  const edge = Math.abs(consensus.edge ?? 0);
  const confidenceOk = consensus.confidence >= config.minConfidenceToExecute;
  const edgeOk = (consensus.edge ?? 0) === null ? false : edge >= config.minEdgeToExecute;
  const triggerOk = strongest.severity >= 0.35;

  if (!triggerOk) {
    return { shouldExecute: false, rationale: "Trigger severity below execution threshold." };
  }

  if (!confidenceOk) {
    return { shouldExecute: false, rationale: "Consensus confidence below execution threshold." };
  }

  if (!edgeOk) {
    return { shouldExecute: false, rationale: "Consensus edge below execution threshold." };
  }

  return {
    shouldExecute: true,
    rationale: `Triggered by ${strongest.type} (severity ${strongest.severity.toFixed(2)}), confidence ${consensus.confidence.toFixed(2)}, edge ${(consensus.edge ?? 0).toFixed(3)}.`,
  };
}

