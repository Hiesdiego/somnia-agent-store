export interface AgentConfig {
  id: bigint;
  builder: `0x${string}`;
  name: string;
  description: string;
  category: string;
  metadataURI: string;
  agentType: number;
  status: number;
  pricePerExecution: bigint;
  somniaAgentId: bigint;
  totalExecutions: bigint;
  totalRevenue: bigint;
  createdAt: bigint;
  version: bigint;
  isVerified: boolean;
}

export interface WorkflowData {
  id: bigint;
  requester: `0x${string}`;
  rootAgentId: bigint;
  maxDepth: bigint;
  status: number;
  stepCount: bigint;
  metadataURI: string;
}

export interface StepData {
  id: bigint;
  workflowId: bigint;
  parentStepId: bigint;
  fromAgentId: bigint;
  toAgentId: bigint;
  executed: boolean;
}

export interface WorkflowAutomationMetadata {
  kind?: string;
  app?: string;
  delegationMode?: "automatic" | "manual";
  maxDelegates?: number;
  delegatedAgentIds?: string[];
  manualDelegateAgentIds?: string[];
  rootPayload?: `0x${string}`;
  delegatePayloads?: Record<string, `0x${string}`>;
  relationType?: `0x${string}`;
}

export interface RunnerConfig {
  runnerPrivateKey: `0x${string}`;
  rpcUrl: string;
  wsRpcUrl: string;
  autonomyAddress: `0x${string}`;
  expectedChainId: number;
  registryAddress?: `0x${string}`;
  billingAddress?: `0x${string}`;
  defaultMaxDelegates: number;
  stepCostBps: number;
  relationType: `0x${string}`;
  metadataKinds: string[];
  pollIntervalMs: number;
  catchupBlocks: bigint;
  maxCatchupWorkflows: number;
  maxRetryAttempts: number;
  retryBaseDelayMs: number;
  maxWorkflowFailureStreak: number;
  workflowFailureCooldownMs: number;
  healthLogIntervalMs: number;
  allowedRequesters: Set<string> | null;
}
