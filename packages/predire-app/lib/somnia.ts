import { defineChain } from "viem";

export const SOMNIA_TESTNET = defineChain({
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
});

export enum AgentType {
  LLM_INFERENCE = 0,
  JSON_API = 1,
  WEBSITE_PARSE = 2,
  CUSTOM_OFFCHAIN = 3,
}

export enum AgentStatus {
  ACTIVE = 0,
  PAUSED = 1,
  DEPRECATED = 2,
}

export enum ExecutionStatus {
  PENDING = 0,
  SUCCESS = 1,
  FAILED = 2,
  TIMEOUT = 3,
}

export interface AgentConfig {
  id: bigint;
  builder: `0x${string}`;
  name: string;
  description: string;
  category: string;
  metadataURI: string;
  agentType: AgentType;
  status: AgentStatus;
  pricePerExecution: bigint;
  somniaAgentId: bigint;
  totalExecutions: bigint;
  totalRevenue: bigint;
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
  amountPaid: bigint;
  somniaRequestId: bigint;
}

export const REGISTRY_ABI = [
  {
    name: "getAllActiveAgents",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "agents",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "builder", type: "address" },
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "category", type: "string" },
          { name: "metadataURI", type: "string" },
          { name: "agentType", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "pricePerExecution", type: "uint256" },
          { name: "somniaAgentId", type: "uint256" },
          { name: "totalExecutions", type: "uint256" },
          { name: "totalRevenue", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "version", type: "uint256" },
          { name: "isVerified", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const BILLING_ABI = [
  {
    name: "registry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "executor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "executeAgent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "executionId", type: "uint256" }],
  },
  {
    name: "quoteExecution",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "agentFee", type: "uint256" },
      { name: "runtimeBudget", type: "uint256" },
      { name: "totalCost", type: "uint256" },
    ],
  },
  {
    name: "getExecutionRecord",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "executionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "agentId", type: "uint256" },
          { name: "subscriber", type: "address" },
          { name: "payload", type: "bytes" },
          { name: "status", type: "uint8" },
          { name: "result", type: "bytes" },
          { name: "createdAt", type: "uint256" },
          { name: "resolvedAt", type: "uint256" },
          { name: "amountPaid", type: "uint256" },
          { name: "somniaRequestId", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getAgentExecutions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "records",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "agentId", type: "uint256" },
          { name: "subscriber", type: "address" },
          { name: "payload", type: "bytes" },
          { name: "status", type: "uint8" },
          { name: "result", type: "bytes" },
          { name: "createdAt", type: "uint256" },
          { name: "resolvedAt", type: "uint256" },
          { name: "amountPaid", type: "uint256" },
          { name: "somniaRequestId", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "AgentExecutionRequested",
    type: "event",
    inputs: [
      { name: "executionId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
      { name: "amountPaid", type: "uint256", indexed: false },
      { name: "builderRevenue", type: "uint256", indexed: false },
      { name: "platformFee", type: "uint256", indexed: false },
    ],
  },
] as const;

export const EXECUTOR_ABI = [
  {
    name: "billing",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "agentPlatform",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "somniaReserveBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const AUTOPILOT_VAULT_ABI = [
  {
    name: "createMission",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "maxRelayerFeePerRun", type: "uint256" },
      { name: "minCadenceSeconds", type: "uint256" },
      { name: "maxRuns", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "maxTotalSpend", type: "uint256" },
      { name: "marketHash", type: "bytes32" },
      { name: "questionHash", type: "bytes32" },
      { name: "payloadTemplateHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "missionId", type: "bytes32" }],
  },
  {
    name: "fundMission",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "missionId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "cancelMission",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "missionId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getMission",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "missionId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "bytes32" },
          { name: "owner", type: "address" },
          { name: "agentId", type: "uint256" },
          { name: "balance", type: "uint256" },
          { name: "spent", type: "uint256" },
          { name: "runCount", type: "uint256" },
          { name: "maxRelayerFeePerRun", type: "uint256" },
          { name: "minCadenceSeconds", type: "uint256" },
          { name: "maxRuns", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "maxTotalSpend", type: "uint256" },
          { name: "lastExecutedAt", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "marketHash", type: "bytes32" },
          { name: "questionHash", type: "bytes32" },
          { name: "payloadTemplateHash", type: "bytes32" },
          { name: "active", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    name: "getOwnerMissionIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    name: "MissionCreated",
    type: "event",
    inputs: [
      { name: "missionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "maxRelayerFeePerRun", type: "uint256", indexed: false },
      { name: "minCadenceSeconds", type: "uint256", indexed: false },
      { name: "maxRuns", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "maxTotalSpend", type: "uint256", indexed: false },
      { name: "marketHash", type: "bytes32", indexed: false },
      { name: "questionHash", type: "bytes32", indexed: false },
      { name: "payloadTemplateHash", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    name: "MissionSpent",
    type: "event",
    inputs: [
      { name: "missionId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "executionId", type: "uint256", indexed: false },
      { name: "agentFee", type: "uint256", indexed: false },
      { name: "runtimeBudget", type: "uint256", indexed: false },
      { name: "relayerFee", type: "uint256", indexed: false },
      { name: "remainingBalance", type: "uint256", indexed: false },
      { name: "idempotencyKey", type: "bytes32", indexed: false },
      { name: "payloadTemplateHash", type: "bytes32", indexed: false },
      { name: "payloadHash", type: "bytes32", indexed: false },
      { name: "contextHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const AUTONOMY_V4_ABI = [
  {
    name: "createWorkflow",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "rootAgentId", type: "uint256" },
      { name: "maxDepth", type: "uint256" },
      { name: "parentGraphWorkflowId", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "workflowId", type: "uint256" }],
  },
  {
    name: "fundWorkflow",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "cancelWorkflow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "workflowId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "planStep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "parentStepId", type: "uint256" },
      { name: "fromAgentId", type: "uint256" },
      { name: "toAgentId", type: "uint256" },
      { name: "payloadHash", type: "bytes32" },
      { name: "maxTotalCost", type: "uint256" },
      { name: "relationType", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "stepId", type: "uint256" }],
  },
  {
    name: "executeStep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stepId", type: "uint256" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "executionId", type: "uint256" }],
  },
  {
    name: "finalizeWorkflow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "success", type: "bool" },
      { name: "resultHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "setWorkflowExecutor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "executor", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "WorkflowCreated",
    type: "event",
    inputs: [
      { name: "workflowId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "rootAgentId", type: "uint256", indexed: true },
      { name: "budget", type: "uint256", indexed: false },
      { name: "maxDepth", type: "uint256", indexed: false },
      { name: "parentGraphWorkflowId", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    name: "StepPlanned",
    type: "event",
    inputs: [
      { name: "workflowId", type: "uint256", indexed: true },
      { name: "stepId", type: "uint256", indexed: true },
      { name: "toAgentId", type: "uint256", indexed: true },
      { name: "parentStepId", type: "uint256", indexed: false },
      { name: "fromAgentId", type: "uint256", indexed: false },
      { name: "depth", type: "uint256", indexed: false },
      { name: "maxTotalCost", type: "uint256", indexed: false },
      { name: "payloadHash", type: "bytes32", indexed: false },
      { name: "relationType", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    name: "StepExecuted",
    type: "event",
    inputs: [
      { name: "workflowId", type: "uint256", indexed: true },
      { name: "stepId", type: "uint256", indexed: true },
      { name: "executionId", type: "uint256", indexed: true },
      { name: "agentFee", type: "uint256", indexed: false },
      { name: "runtimeBudget", type: "uint256", indexed: false },
      { name: "totalCost", type: "uint256", indexed: false },
      { name: "splitTotal", type: "uint256", indexed: false },
      { name: "remainingBudget", type: "uint256", indexed: false },
    ],
  },
] as const;

export function getSasAddresses() {
  const registry =
    process.env.NEXT_PUBLIC_SAS_REGISTRY_ADDRESS ??
    "0x25029648D4dDaE085c8db865582F43Bce2857766";
  const billing =
    process.env.NEXT_PUBLIC_SAS_BILLING_ADDRESS ??
    "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03";
  const executor =
    process.env.NEXT_PUBLIC_SAS_EXECUTOR_ADDRESS ??
    "0x7E5da137BEa251955C49cC7730e281E2Cd4b14Ec";
  const autopilotVault =
    process.env.NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS ??
    "0x553CEE1B1aA3cD44E25Ff64Bf4dAf2b8E4C6eDC2";
  const autonomyV4 =
    process.env.NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS ??
    "0x475F888B8a522fA81b9B0455d94A0Dc710cBa686";

  return {
    registry: registry as `0x${string}`,
    billing: billing as `0x${string}`,
    executor: executor as `0x${string}`,
    autopilotVault: autopilotVault as `0x${string}`,
    autonomyV4: autonomyV4 as `0x${string}`,
  };
}

export function formatSTT(wei: bigint, decimals = 4): string {
  const value = Number(wei) / 1e18;
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
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

export function formatRelative(timestamp: bigint): string {
  const seconds = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

