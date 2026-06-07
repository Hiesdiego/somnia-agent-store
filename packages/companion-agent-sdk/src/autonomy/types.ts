export type TriggerType =
  | "odds_jump"
  | "volume_anomaly"
  | "sentiment_price_divergence"
  | "whale_flow";

export type TriggerSource = "cadence" | "autonomous_trigger";

export type MissionMetadata = {
  app?: string;
  kind?: string;
  watchId?: string;
  url: string;
  question?: string;
  cadenceMinutes?: number;
  createdAt?: string;
};

export type ParsedSignals = {
  marketProbability: number | null;
  volume: number | null;
  sentimentScore: number;
  whaleFlowScore: number;
  evidenceQualityScore: number;
  freshnessScore: number;
  sourceCount: number;
  marketTitle: string | null;
  extractedFacts: string[];
  warningCount: number;
};

export type MarketSnapshot = {
  id: string;
  missionId: `0x${string}`;
  eventUrl: string;
  eventId: string | null;
  capturedAt: string;
  contextHash: string;
  contextRaw: string;
  signals: ParsedSignals;
};

export type TriggerEvent = {
  id: string;
  missionId: `0x${string}`;
  eventUrl: string;
  type: TriggerType;
  triggeredAt: string;
  severity: number;
  details: Record<string, unknown>;
  executionRequested: boolean;
  executionId?: string | null;
  idempotencyKey?: `0x${string}` | null;
};

export type AgentId =
  | "news"
  | "sentiment"
  | "onchain"
  | "statistical"
  | "contrarian"
  | "risk"
  | "summary";

export type AgentVote = {
  agent: AgentId;
  probability: number;
  confidence: number;
  stance: "yes" | "no" | "watch";
  rationale: string;
};

export type ConfidenceBreakdown = {
  evidenceQuality: number;
  freshness: number;
  signalAgreement: number;
  liquidity: number;
  triggerSupport: number;
};

export type ConsensusResult = {
  probability: number;
  stance: "yes" | "no" | "watch";
  marketProbability: number | null;
  edge: number | null;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  disagreement: number;
  votes: AgentVote[];
  summary: string;
};

export type ThesisRevision = {
  id: string;
  missionId: `0x${string}`;
  eventUrl: string;
  snapshotId: string;
  revision: number;
  createdAt: string;
  consensus: ConsensusResult;
  activeTriggers: TriggerType[];
  hypothesis: string;
  executionSource: TriggerSource;
  executionId?: string | null;
  resolvedOutcome?: "YES" | "NO" | null;
  scoredAt?: string | null;
  brierScore?: number | null;
};

export type ResolvedOutcome = {
  id: string;
  missionId: `0x${string}` | null;
  eventUrl: string;
  resolvedOutcome: "YES" | "NO";
  resolvedAt: string;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SignalWeights = {
  sentiment: number;
  statistical: number;
  onchain: number;
  contrarian: number;
  news: number;
  risk: number;
};

export type WeightProfile = {
  missionId: `0x${string}` | "global";
  updatedAt: string;
  sampleCount: number;
  weights: SignalWeights;
};

export type LearningSample = {
  thesisId: string;
  missionId: `0x${string}`;
  eventUrl: string;
  predictedProbability: number;
  actualOutcome: "YES" | "NO";
  agentProbabilities: Record<AgentId, number>;
};

export type RelayerHeartbeat = {
  relayerId: string;
  vaultAddress: `0x${string}`;
  relayerAddress: `0x${string}`;
  status: "starting" | "scanning" | "idle" | "executing" | "error";
  lastSeenAt: string;
  missionCount: number;
  lastScannedBlock?: string | null;
  walletBalanceWei?: string | null;
  details: Record<string, unknown>;
};

export type MissionOpsStatus = {
  missionId: `0x${string}`;
  vaultAddress: `0x${string}`;
  eventUrl?: string | null;
  question?: string | null;
  active: boolean;
  balanceWei: string;
  spentWei: string;
  runCount: string;
  maxRuns?: string | null;
  expiresAt?: string | null;
  nextDueAt?: string | null;
  lastScanAt?: string | null;
  lastRunAt?: string | null;
  lastSkippedReason?: string | null;
  lastFailureReason?: string | null;
  lastExecutionId?: string | null;
  policyHashes: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type AutopilotRunRecord = {
  id: string;
  missionId: `0x${string}`;
  vaultAddress: `0x${string}`;
  eventUrl?: string | null;
  executionId?: string | null;
  transactionHash?: `0x${string}` | null;
  idempotencyKey: `0x${string}`;
  payloadTemplateHash: `0x${string}`;
  payloadHash: `0x${string}`;
  contextHash: `0x${string}`;
  executionSource?: TriggerSource | null;
  executionRationale?: string | null;
  consensus?: ConsensusResult | null;
  triggerTypes: TriggerType[];
  agentFeeWei?: string | null;
  runtimeBudgetWei?: string | null;
  relayerFeeWei?: string | null;
  remainingBalanceWei?: string | null;
  status: "submitted" | "confirmed" | "failed";
  error?: string | null;
  createdAt: string;
};

export type ContextProvenance = {
  contextHash: `0x${string}`;
  missionId: `0x${string}`;
  vaultAddress: `0x${string}`;
  eventUrl: string;
  payloadHash?: `0x${string}` | null;
  prophecySnapshotHash: `0x${string}`;
  externalSourceUrls: string[];
  researchTimestamp: string;
  modelInputSummary: string;
  contextBytes: number;
  snapshotId?: string | null;
};

export type RetryQueueItem = {
  id: string;
  missionId: `0x${string}`;
  vaultAddress: `0x${string}`;
  eventUrl?: string | null;
  reason: string;
  attempts: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  status: "pending" | "running" | "resolved" | "failed";
  metadata: Record<string, unknown>;
};
