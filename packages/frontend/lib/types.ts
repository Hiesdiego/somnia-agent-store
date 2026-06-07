// Agent Types
export enum AgentType {
  LLM_INFERENCE  = 0,
  JSON_API       = 1,
  WEBSITE_PARSE  = 2,
  CUSTOM_OFFCHAIN = 3,
}

export enum AgentStatus {
  ACTIVE     = 0,
  PAUSED     = 1,
  DEPRECATED = 2,
}

export enum ExecutionStatus {
  PENDING = 0,
  SUCCESS = 1,
  FAILED  = 2,
  TIMEOUT = 3,
}

// On-chain data shapes
export interface AgentConfig {
  id: bigint;
  builder: `0x${string}`;
  name: string;
  description: string;
  category: string;
  metadataURI: string;
  agentType: AgentType;
  status: AgentStatus;
  pricePerExecution: bigint; // service fee wei; runtime budget is quoted by billing
  somniaAgentId: bigint;
  totalExecutions: bigint;
  totalRevenue: bigint; // service fee revenue wei
  createdAt: bigint;
  version: bigint;
  isVerified: boolean;
}

export interface ExecutionRecord {
  id: bigint;
  agentId: bigint;
  subscriber: `0x${string}`;
  payload: `0x${string}`;
  status: ExecutionStatus;
  result: `0x${string}`;
  createdAt: bigint;
  resolvedAt: bigint;
  amountPaid: bigint; // total user payment wei, including runtime budget
  somniaRequestId: bigint;
}

// Metadata from IPFS/Arweave
export interface AgentMetadata {
  name: string;
  description: string;
  longDescription?: string;
  iconUrl?: string;
  bannerUrl?: string;
  category: string;
  tags: string[];
  externalUrl?: string;
  docsUrl?: string;
  gitbookUrl?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  inputSchema?: {
    type: string;
    description: string;
    required?: string[];
    properties?: Record<string, unknown>;
    example?: string;
  };
  outputSchema?: {
    type: string;
    description: string;
    properties?: Record<string, unknown>;
    example?: string;
  };
  examples?: Array<{
    title: string;
    payload: string;
    description?: string;
    response?: string;
  }>;
  limitations?: string[];
  expectedLatency?: string;
  rateLimits?: string;
  changelogUrl?: string;
  supportUrl?: string;
  version?: string;
}

// UI helpers
export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  [AgentType.LLM_INFERENCE]: "LLM Inference",
  [AgentType.JSON_API]: "JSON API",
  [AgentType.WEBSITE_PARSE]: "Web Scrape",
  [AgentType.CUSTOM_OFFCHAIN]: "Unsupported",
};

export const AGENT_TYPE_BADGE: Record<AgentType, string> = {
  [AgentType.LLM_INFERENCE]: "badge-llm",
  [AgentType.JSON_API]: "badge-json",
  [AgentType.WEBSITE_PARSE]: "badge-website",
  [AgentType.CUSTOM_OFFCHAIN]: "badge-custom",
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  [AgentStatus.ACTIVE]: "Active",
  [AgentStatus.PAUSED]: "Paused",
  [AgentStatus.DEPRECATED]: "Deprecated",
};

export const AGENT_STATUS_BADGE: Record<AgentStatus, string> = {
  [AgentStatus.ACTIVE]: "badge-active",
  [AgentStatus.PAUSED]: "badge-paused",
  [AgentStatus.DEPRECATED]: "badge-deprecated",
};

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.PENDING]: "Pending",
  [ExecutionStatus.SUCCESS]: "Success",
  [ExecutionStatus.FAILED]: "Failed",
  [ExecutionStatus.TIMEOUT]: "Timeout",
};

export const SOMNIA_TESTNET = {
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://api.infra.testnet.somnia.network"],
      webSocket: ["wss://api.infra.testnet.somnia.network/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url: "https://shannon-explorer.somnia.network",
    },
  },
  testnet: true,
} as const;

export function formatSTT(wei: bigint, decimals = 4): string {
  const stt = Number(wei) / 1e18;
  return stt.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatAgentUid(agentId: bigint, registryAddress?: string): string {
  const source = `${SOMNIA_TESTNET.id}:${registryAddress ?? ""}:${agentId.toString()}`.toLowerCase();
  let hash = 2166136261;

  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `SAS-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
}

export function formatDate(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatRelative(timestamp: bigint): string {
  const ms = Date.now() - Number(timestamp) * 1000;
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
