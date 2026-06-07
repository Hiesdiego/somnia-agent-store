import type { AutonomyConfig } from "./config.ts";
import type { ConsensusResult, ThesisRevision, TriggerSource, TriggerType } from "./types.ts";
import { hashId } from "./utils.ts";

function asPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildHypothesis(consensus: ConsensusResult, activeTriggers: TriggerType[]): string {
  const edgeText = consensus.edge === null ? "unknown edge (market probability unavailable)" : `edge ${asPercent(Math.abs(consensus.edge))}`;
  const triggerText =
    activeTriggers.length > 0 ? `Active triggers: ${activeTriggers.join(", ")}.` : "No active anomaly triggers.";
  return [
    `Stance: ${consensus.stance.toUpperCase()}.`,
    `Model probability ${asPercent(consensus.probability)} with confidence ${asPercent(consensus.confidence)}.`,
    `Market probability ${
      consensus.marketProbability === null ? "unknown" : asPercent(consensus.marketProbability)
    }, ${edgeText}.`,
    triggerText,
    `Confidence decomposition: evidence ${asPercent(consensus.confidenceBreakdown.evidenceQuality)}, freshness ${asPercent(consensus.confidenceBreakdown.freshness)}, agreement ${asPercent(consensus.confidenceBreakdown.signalAgreement)}, liquidity ${asPercent(consensus.confidenceBreakdown.liquidity)}.`,
  ].join(" ");
}

export function shouldCreateThesisRevision(input: {
  previous: ThesisRevision | null;
  consensus: ConsensusResult;
  activeTriggers: TriggerType[];
  config: AutonomyConfig;
}): boolean {
  if (!input.previous) return true;
  const delta = Math.abs(input.consensus.probability - input.previous.consensus.probability);
  if (delta >= input.config.thesisRevisionMinDelta) return true;
  if (input.activeTriggers.length > 0) return true;
  if (input.consensus.stance !== input.previous.consensus.stance) return true;
  const confidenceDelta = Math.abs(input.consensus.confidence - input.previous.consensus.confidence);
  if (confidenceDelta >= 0.08) return true;
  return false;
}

export function createThesisRevision(input: {
  missionId: `0x${string}`;
  eventUrl: string;
  snapshotId: string;
  previous: ThesisRevision | null;
  consensus: ConsensusResult;
  activeTriggers: TriggerType[];
  executionSource: TriggerSource;
  executionId?: string | null;
  createdAt?: string;
}): ThesisRevision {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const revision = (input.previous?.revision ?? 0) + 1;
  const id = hashId(input.missionId, input.snapshotId, revision, createdAt);
  return {
    id,
    missionId: input.missionId,
    eventUrl: input.eventUrl,
    snapshotId: input.snapshotId,
    revision,
    createdAt,
    consensus: input.consensus,
    activeTriggers: input.activeTriggers,
    hypothesis: buildHypothesis(input.consensus, input.activeTriggers),
    executionSource: input.executionSource,
    executionId: input.executionId ?? null,
    resolvedOutcome: null,
    scoredAt: null,
    brierScore: null,
  };
}

