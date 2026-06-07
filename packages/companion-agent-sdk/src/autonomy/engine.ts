import type { AutonomyConfig } from "./config.ts";
import { buildMarketSnapshot } from "./context-signals.ts";
import { buildConsensus } from "./consensus-engine.ts";
import type { AutonomyStore } from "./store.ts";
import { evaluateTriggers, shouldExecuteFromTriggers } from "./trigger-engine.ts";
import { createThesisRevision, shouldCreateThesisRevision } from "./thesis-engine.ts";
import type { ConsensusResult, MarketSnapshot, ThesisRevision, TriggerEvent, TriggerSource } from "./types.ts";

export type MissionAutonomyEvaluation = {
  snapshot: MarketSnapshot;
  consensus: ConsensusResult;
  createdTriggers: TriggerEvent[];
  thesisRevision: ThesisRevision | null;
  shouldExecute: boolean;
  executionSource: TriggerSource;
  executionRationale: string;
  idempotencyScope: string;
};

function strongestTriggerType(triggers: TriggerEvent[]): string {
  if (triggers.length === 0) return "none";
  return triggers.slice().sort((a, b) => b.severity - a.severity)[0].type;
}

function shouldRunCadenceByQuality(input: {
  cadenceDue: boolean;
  config: AutonomyConfig;
  consensus: ConsensusResult;
  snapshot: MarketSnapshot;
}): { ok: boolean; reason: string } {
  if (!input.cadenceDue) return { ok: false, reason: "Cadence not due." };
  if (!input.config.requireSignalForCadence) return { ok: true, reason: "Cadence due." };

  if (input.consensus.confidence < input.config.minConfidenceForCadence) {
    return {
      ok: false,
      reason: `Cadence due, but confidence ${input.consensus.confidence.toFixed(3)} < ${input.config.minConfidenceForCadence.toFixed(3)}.`,
    };
  }

  const edge = Math.abs(input.consensus.edge ?? 0);
  if ((input.consensus.edge ?? null) === null || edge < input.config.minEdgeForCadence) {
    return {
      ok: false,
      reason: `Cadence due, but edge is insufficient (${input.consensus.edge === null ? "null" : edge.toFixed(3)}).`,
    };
  }

  if (input.snapshot.signals.marketProbability === null) {
    return {
      ok: false,
      reason: "Cadence due, but market probability was not extracted.",
    };
  }

  return { ok: true, reason: "Cadence due and quality thresholds passed." };
}

export async function evaluateMissionAutonomy(input: {
  missionId: `0x${string}`;
  eventUrl: string;
  contextRaw: string;
  store: AutonomyStore;
  config: AutonomyConfig;
  cadenceDue: boolean;
}): Promise<MissionAutonomyEvaluation> {
  const snapshot = buildMarketSnapshot({
    missionId: input.missionId,
    eventUrl: input.eventUrl,
    contextRaw: input.contextRaw,
  });
  await input.store.saveSnapshot(snapshot);

  const history = await input.store.listSnapshots(input.missionId, input.config.historyLimit);
  const recentTriggers = await input.store.listRecentTriggers(input.missionId, 40);
  const createdTriggers = evaluateTriggers({
    missionId: input.missionId,
    eventUrl: snapshot.eventUrl,
    snapshot,
    history,
    recentTriggers,
    config: input.config,
  });
  for (const trigger of createdTriggers) {
    await input.store.saveTrigger(trigger);
  }

  const weightProfile = await input.store.getWeightProfile(input.missionId);
  const consensus = buildConsensus({
    snapshot,
    history,
    triggers: createdTriggers,
    weights: weightProfile?.weights ?? null,
  });

  const cadenceDecision = shouldRunCadenceByQuality({
    cadenceDue: input.cadenceDue,
    config: input.config,
    consensus,
    snapshot,
  });
  const triggerDecision = shouldExecuteFromTriggers(consensus, createdTriggers, input.config);
  const shouldExecute = cadenceDecision.ok || triggerDecision.shouldExecute;
  const executionSource: TriggerSource = cadenceDecision.ok ? "cadence" : "autonomous_trigger";
  const executionRationale = cadenceDecision.ok
    ? cadenceDecision.reason
    : triggerDecision.shouldExecute
      ? triggerDecision.rationale
      : `${cadenceDecision.reason} ${triggerDecision.rationale}`;
  const idempotencyScope = cadenceDecision.ok
    ? "cadence"
    : `trigger:${strongestTriggerType(createdTriggers)}`;

  const previousThesis = await input.store.getLatestThesis(input.missionId);
  const activeTriggers = createdTriggers.map((trigger) => trigger.type);
  const shouldCreate = shouldCreateThesisRevision({
    previous: previousThesis,
    consensus,
    activeTriggers,
    config: input.config,
  });

  let thesisRevision: ThesisRevision | null = null;
  if (shouldCreate) {
    thesisRevision = createThesisRevision({
      missionId: input.missionId,
      eventUrl: snapshot.eventUrl,
      snapshotId: snapshot.id,
      previous: previousThesis,
      consensus,
      activeTriggers,
      executionSource,
    });
    await input.store.saveThesis(thesisRevision);
  }

  return {
    snapshot,
    consensus,
    createdTriggers,
    thesisRevision,
    shouldExecute,
    executionSource,
    executionRationale,
    idempotencyScope,
  };
}
