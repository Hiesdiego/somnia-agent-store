export { loadAutonomyConfig, type AutonomyConfig } from "./config.ts";
export { parseSignalsFromContext, buildMarketSnapshot } from "./context-signals.ts";
export { buildConsensus } from "./consensus-engine.ts";
export { evaluateTriggers, shouldExecuteFromTriggers } from "./trigger-engine.ts";
export { createThesisRevision, shouldCreateThesisRevision } from "./thesis-engine.ts";
export { createAutonomyStore, defaultSignalWeights, normalizeWeights, type AutonomyStore } from "./store.ts";
export { evaluateMissionAutonomy, type MissionAutonomyEvaluation } from "./engine.ts";
export { applyFeedbackLearning, syncOutcomesFromEndpoint } from "./learning.ts";
export type {
  TriggerType,
  TriggerSource,
  MissionMetadata,
  MarketSnapshot,
  TriggerEvent,
  AgentVote,
  ConsensusResult,
  ThesisRevision,
  ResolvedOutcome,
  SignalWeights,
  WeightProfile,
} from "./types.ts";

