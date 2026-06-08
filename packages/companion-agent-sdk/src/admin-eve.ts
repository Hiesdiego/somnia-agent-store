import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Address,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { startServiceHealthServer } from "./service-health.ts";

const AGENT_NAME = process.env.EVE_AGENT_NAME?.trim() || "Agent E.V.E";

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.SOMNIA_RPC_URL?.trim() || "https://api.infra.testnet.somnia.network"] } },
});

const REGISTRY_ABI = [
  {
    name: "getAllAgents",
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
  {
    name: "setAgentVerified",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "verified", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "adminDeprecateAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
] as const;

const BILLING_ABI = [
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
    name: "getPlatformStats",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "totalExecutions", type: "uint256" },
      { name: "totalRevenue", type: "uint256" },
      { name: "treasuryBalance", type: "uint256" },
      { name: "agentCount", type: "uint256" },
    ],
  },
] as const;

const EXECUTOR_ABI = [
  {
    name: "somniaReserveBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const OWNER_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const TIMELOCK_ABI = [
  {
    name: "getMinDelay",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "hashOperation",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "isOperationDone",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isOperationPending",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isOperationReady",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "schedule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "delay", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const AUTONOMY_ABI = [
  {
    name: "executors",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "executor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setExecutor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executor", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const GRAPH_ABI = [
  {
    name: "recorders",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "recorder", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setRecorder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recorder", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
] as const;

type AgentRecord = {
  id: bigint;
  builder: Address;
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
};

type ExecutionRecord = {
  id: bigint;
  agentId: bigint;
  subscriber: Address;
  payload: `0x${string}`;
  status: number;
  result: `0x${string}`;
  createdAt: bigint;
  resolvedAt: bigint;
  amountPaid: bigint;
  somniaRequestId: bigint;
};

type AgentStage =
  | "observing"
  | "candidate"
  | "verified"
  | "watchlisted"
  | "quarantined"
  | "deprecated";

type FailureState = {
  id: string;
  agent_id: string;
  failure_streak: number;
  healthy_streak: number;
  last_status: "healthy" | "unverified" | "deprecated";
  last_reason: string | null;
  updated_at: string;
};

type TogglePolicy = {
  id: string;
  target_type: "executor" | "recorder";
  target_address: string;
  desired_allowed: boolean;
  active: boolean;
  notes: string | null;
};

type ActionLogRow = {
  id: string;
  action_type: string;
  target_agent_id: string | null;
  target_address: string | null;
  created_at: string;
};

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function opt(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = opt(name);
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function num(name: string, fallback: number): number {
  const raw = opt(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePk(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

function parseIdSet(raw: string | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const set = new Set<string>();
  for (const value of raw.split(",")) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!/^\d+$/.test(trimmed)) continue;
    set.add(trimmed);
  }
  return set.size > 0 ? set : null;
}

class SupabasePostgrestClient {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly schema: string
  ) {}

  private endpoint(path: string): string {
    return `${this.url.replace(/\/$/, "")}/rest/v1/${path}`;
  }

  async select<T>(table: string, query: string): Promise<T[]> {
    const response = await fetch(this.endpoint(`${table}?${query}`), {
      method: "GET",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        Accept: "application/json",
        "Accept-Profile": this.schema,
      },
    });
    if (!response.ok) throw new Error(`Supabase SELECT ${table} failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as T[];
  }

  async insert<T>(table: string, rows: T[]): Promise<void> {
    if (!rows.length) return;
    const response = await fetch(this.endpoint(table), {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        "Content-Profile": this.schema,
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`Supabase INSERT ${table} failed: ${response.status} ${await response.text()}`);
  }

  async update(table: string, query: string, payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.endpoint(`${table}?${query}`), {
      method: "PATCH",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        "Content-Profile": this.schema,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Supabase UPDATE ${table} failed: ${response.status} ${await response.text()}`);
  }
}

async function isActionCoolingDown(input: {
  supabase: SupabasePostgrestClient;
  actionType: string;
  targetAgentId?: string;
  targetAddress?: string;
  cooldownMs: number;
}): Promise<boolean> {
  const filters = [
    "select=id,action_type,target_agent_id,target_address,created_at",
    `action_type=eq.${encodeURIComponent(input.actionType)}`,
    "order=created_at.desc",
    "limit=1",
  ];
  if (input.targetAgentId) {
    filters.push(`target_agent_id=eq.${encodeURIComponent(input.targetAgentId)}`);
  }
  if (input.targetAddress) {
    filters.push(`target_address=eq.${encodeURIComponent(input.targetAddress)}`);
  }

  const rows = await input.supabase.select<ActionLogRow>("eve_action_logs", filters.join("&"));
  const latest = rows[0];
  if (!latest?.created_at) return false;
  const elapsed = Date.now() - new Date(latest.created_at).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < input.cooldownMs;
}

async function buildGroqAuditSummary(input: {
  agentName: string;
  agentId: bigint;
  failures: string[];
}): Promise<string> {
  const key = opt("EVE_GROQ_API_KEY") || opt("GROQ_API_KEY");
  if (!key) return `Agent ${input.agentName} (#${input.agentId}) failed checks: ${input.failures.join("; ")}`;
  const model = opt("EVE_GROQ_MODEL") || opt("GROQ_MODEL") || "llama-3.3-70b-versatile";
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("whisper")) {
    return `Agent ${input.agentName} (#${input.agentId}) failed checks: ${input.failures.join("; ")}`;
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 120,
        messages: [
          { role: "system", content: "Summarize governance audit findings in one concise sentence." },
          {
            role: "user",
            content: `Agent ${input.agentName} (#${input.agentId}) failed checks:\n- ${input.failures.join("\n- ")}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || `Failed checks: ${input.failures.join("; ")}`;
  } catch {
    return `Agent ${input.agentName} (#${input.agentId}) failed checks: ${input.failures.join("; ")}`;
  }
}

function metadataUriLooksValid(uri: string): boolean {
  if (!uri || !uri.trim()) return false;
  const v = uri.trim();
  return v.startsWith("ipfs://") || v.startsWith("https://") || v.startsWith("http://");
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function canonicalListingKey(agent: AgentRecord): string {
  const metadata = agent.metadataURI.trim().toLowerCase();
  if (metadata) return `metadata:${metadata}`;
  return `name:${normalizeForMatch(agent.name)}|category:${normalizeForMatch(agent.category)}`;
}

function isActive(agent: AgentRecord): boolean {
  return agent.status === 0;
}

function deriveStage(agent: AgentRecord, failures: string[], healthyStreak: number, failureStreak: number): AgentStage {
  if (agent.status === 2) return "deprecated";
  if (failureStreak >= 2) return agent.isVerified ? "quarantined" : "watchlisted";
  if (failures.length > 0) return "watchlisted";
  if (agent.isVerified) return "verified";
  if (healthyStreak > 0) return "candidate";
  return "observing";
}

function buildDuplicateGroups(agents: AgentRecord[]): AgentRecord[][] {
  const groups = new Map<string, AgentRecord[]>();
  for (const agent of agents.filter(isActive)) {
    const keys = new Set<string>([canonicalListingKey(agent)]);
    if (agent.somniaAgentId > 0n) keys.add(`somnia:${agent.somniaAgentId.toString()}`);
    for (const key of keys) {
      const group = groups.get(key) ?? [];
      group.push(agent);
      groups.set(key, group);
    }
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => {
      const seen = new Set<string>();
      return group
        .filter((agent) => {
          const id = agent.id.toString();
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .sort((a, b) => Number(a.createdAt - b.createdAt));
    })
    .filter((group) => group.length > 1);
}

function chooseCanonicalAgent(group: AgentRecord[]): AgentRecord {
  return [...group].sort((a, b) => {
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    if (a.totalExecutions !== b.totalExecutions) return Number(b.totalExecutions - a.totalExecutions);
    return Number(b.createdAt - a.createdAt);
  })[0];
}

async function logAction(input: {
  supabase: SupabasePostgrestClient;
  actionType: string;
  targetAgentId?: string;
  targetAddress?: string;
  details: Record<string, unknown>;
  txHash?: string | null;
}) {
  await input.supabase.insert("eve_action_logs", [
    {
      id: `${Date.now()}-${input.actionType}-${input.targetAgentId ?? input.targetAddress ?? "platform"}-${Math.random()
        .toString(16)
        .slice(2)}`,
      action_type: input.actionType,
      target_agent_id: input.targetAgentId ?? null,
      target_address: input.targetAddress ?? null,
      details: input.details,
      tx_hash: input.txHash ?? null,
      created_at: new Date().toISOString(),
    },
  ]);
}

async function logIncident(input: {
  supabase: SupabasePostgrestClient;
  actionType: string;
  targetAgentId?: string;
  targetAddress?: string;
  details: Record<string, unknown>;
  cooldownMs: number;
}) {
  const coolingDown = await isActionCoolingDown({
    supabase: input.supabase,
    actionType: input.actionType,
    targetAgentId: input.targetAgentId,
    targetAddress: input.targetAddress,
    cooldownMs: input.cooldownMs,
  });
  if (coolingDown) return;
  await logAction(input);
}

async function writeRegistryAdminAction(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  chain: typeof somniaTestnet | any;
  registry: Address;
  timelock: Address | null;
  functionName: "setAgentVerified" | "adminDeprecateAgent";
  args: readonly unknown[];
  saltLabel: string;
  dryRun: boolean;
}): Promise<{ txHash: string | null; mode: "direct" | "timelock-schedule" | "timelock-execute" | "timelock-pending" | "timelock-done" | "dry-run"; operationId?: string }> {
  if (input.dryRun) return { txHash: null, mode: "dry-run" };

  if (!input.timelock) {
    const hash = await input.walletClient.writeContract({
      account: input.account,
      chain: input.chain,
      address: input.registry,
      abi: REGISTRY_ABI,
      functionName: input.functionName,
      args: input.args as never,
    });
    return { txHash: hash, mode: "direct" };
  }

  const data = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: input.functionName,
    args: input.args as never,
  });
  const predecessor = zeroHash;
  const salt = keccak256(stringToHex(input.saltLabel));
  const operationId = (await input.publicClient.readContract({
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "hashOperation",
    args: [input.registry, 0n, data, predecessor, salt],
  })) as string;
  const isDone = (await input.publicClient.readContract({
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "isOperationDone",
    args: [operationId as `0x${string}`],
  })) as boolean;
  if (isDone) return { txHash: null, mode: "timelock-done", operationId };

  const isReady = (await input.publicClient.readContract({
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "isOperationReady",
    args: [operationId as `0x${string}`],
  })) as boolean;
  if (isReady) {
    const hash = await input.walletClient.writeContract({
      account: input.account,
      chain: input.chain,
      address: input.timelock,
      abi: TIMELOCK_ABI,
      functionName: "execute",
      args: [input.registry, 0n, data, predecessor, salt],
    });
    return { txHash: hash, mode: "timelock-execute", operationId };
  }

  const isPending = (await input.publicClient.readContract({
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "isOperationPending",
    args: [operationId as `0x${string}`],
  })) as boolean;
  if (isPending) return { txHash: null, mode: "timelock-pending", operationId };

  const delay = (await input.publicClient.readContract({
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "getMinDelay",
  })) as bigint;
  const hash = await input.walletClient.writeContract({
    account: input.account,
    chain: input.chain,
    address: input.timelock,
    abi: TIMELOCK_ABI,
    functionName: "schedule",
    args: [input.registry, 0n, data, predecessor, salt, delay],
  });
  return { txHash: hash, mode: "timelock-schedule", operationId };
}

function ipfsToGatewayUrl(uri: string): string {
  const gateway = opt("EVE_IPFS_GATEWAY") || "https://ipfs.io/ipfs";
  return `${gateway.replace(/\/$/, "")}/${uri.replace("ipfs://", "")}`;
}

async function checkMetadataIntegrity(agent: AgentRecord, timeoutMs: number): Promise<string[]> {
  const failures: string[] = [];
  if (!metadataUriLooksValid(agent.metadataURI)) return ["invalid metadataURI"];
  const uri = agent.metadataURI.trim();
  const target = uri.startsWith("ipfs://") ? ipfsToGatewayUrl(uri) : uri;
  if (!target.startsWith("http://") && !target.startsWith("https://")) return failures;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { method: "GET", signal: controller.signal });
    if (!response.ok) failures.push(`metadata fetch HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as Record<string, unknown>;
      if (!body.name && !body.description) failures.push("metadata missing name/description");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "metadata fetch failed";
    failures.push(`metadata unreachable: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
  return failures;
}

async function checkSomniaAgentLink(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  agentPlatform: Address;
  agent: AgentRecord;
}): Promise<{ failures: string[]; platform?: string; expectedAgentId?: string; requestDepositWei?: string }> {
  if (input.agent.agentType === 3) return { failures: [] };
  if (input.agent.somniaAgentId <= 0n) return { failures: ["missing somniaAgentId for non-custom agent"] };

  const expectedByType: Record<number, string | undefined> = {
    0: opt("SOMNIA_LLM_AGENT_ID") || "12847293847561029384",
    1: opt("SOMNIA_JSON_API_AGENT_ID"),
    2: opt("SOMNIA_WEBSITE_PARSE_AGENT_ID"),
  };
  const expectedAgentId = expectedByType[input.agent.agentType];
  const failures: string[] = [];

  if (expectedAgentId && input.agent.somniaAgentId !== BigInt(expectedAgentId)) {
    failures.push(`Somnia agent ID does not match configured official base agent for type ${input.agent.agentType}`);
  }

  try {
    const requestDeposit = (await input.publicClient.readContract({
      address: input.agentPlatform,
      abi: [
        {
          name: "getRequestDeposit",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "getRequestDeposit",
    })) as bigint;
    if (requestDeposit <= 0n) failures.push("Somnia Agent Platform request deposit is zero");
    return {
      failures,
      platform: input.agentPlatform,
      expectedAgentId,
      requestDepositWei: requestDeposit.toString(),
    };
  } catch {
    return {
      failures: ["Somnia Agent Platform unreachable"],
      platform: input.agentPlatform,
      expectedAgentId,
    };
  }
}

async function getExecutionHealth(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  billing: Address;
  agent: AgentRecord;
  recentLimit: number;
  maxPendingAgeMs: number;
  maxFailureRateBps: number;
}): Promise<{ failures: string[]; stats: Record<string, number> }> {
  const records = (await input.publicClient.readContract({
    address: input.billing,
    abi: BILLING_ABI,
    functionName: "getAgentExecutions",
    args: [input.agent.id],
  })) as ExecutionRecord[];
  const recent = records.slice(Math.max(0, records.length - input.recentLimit));
  const failures: string[] = [];
  const failed = recent.filter((record) => record.status === 2 || record.status === 3).length;
  const pending = recent.filter((record) => record.status === 0).length;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const stalePending = recent.filter((record) => {
    if (record.status !== 0) return false;
    return (nowSeconds - Number(record.createdAt)) * 1000 > input.maxPendingAgeMs;
  }).length;
  const failureRateBps = recent.length > 0 ? Math.round((failed / recent.length) * 10_000) : 0;
  if (recent.length >= 3 && failureRateBps >= input.maxFailureRateBps) {
    failures.push(`high execution failure rate ${failureRateBps}bps`);
  }
  if (stalePending > 0) failures.push(`${stalePending} stale pending execution(s)`);
  return { failures, stats: { recent: recent.length, failed, pending, stalePending, failureRateBps } };
}

function checkPriceSanity(input: {
  agent: AgentRecord;
  quote: readonly [bigint, bigint, bigint] | null;
  minPriceWei: bigint;
  maxPriceWei: bigint;
  maxAgentFeeToRuntimeBps: number;
}): string[] {
  const failures: string[] = [];
  if (input.agent.pricePerExecution < input.minPriceWei) failures.push("price below policy minimum");
  if (input.agent.pricePerExecution > input.maxPriceWei) failures.push("price above policy maximum");
  if (input.quote && input.quote[1] > 0n) {
    const feeToRuntimeBps = Number((input.quote[0] * 10_000n) / input.quote[1]);
    if (feeToRuntimeBps > input.maxAgentFeeToRuntimeBps) {
      failures.push(`agent fee/runtime ratio high ${feeToRuntimeBps}bps`);
    }
  }
  return failures;
}

function buildBuilderReputation(agents: AgentRecord[]) {
  const byBuilder = new Map<string, { builder: string; listings: number; active: number; verified: number; deprecated: number; executions: bigint; revenue: bigint }>();
  for (const agent of agents) {
    const key = agent.builder.toLowerCase();
    const row = byBuilder.get(key) ?? {
      builder: agent.builder,
      listings: 0,
      active: 0,
      verified: 0,
      deprecated: 0,
      executions: 0n,
      revenue: 0n,
    };
    row.listings += 1;
    if (agent.status === 0) row.active += 1;
    if (agent.status === 2) row.deprecated += 1;
    if (agent.isVerified) row.verified += 1;
    row.executions += agent.totalExecutions;
    row.revenue += agent.totalRevenue;
    byBuilder.set(key, row);
  }
  return Array.from(byBuilder.values());
}

async function main() {
  const rpcUrl = opt("SOMNIA_RPC_URL") || "https://api.infra.testnet.somnia.network";
  const privateKey = normalizePk(opt("EVE_PRIVATE_KEY") || req("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const chain = { ...somniaTestnet, rpcUrls: { default: { http: [rpcUrl] } } };

  const registry = getAddress(opt("SAS_REGISTRY_ADDRESS") || req("NEXT_PUBLIC_SAS_REGISTRY_ADDRESS"));
  const billing = getAddress(opt("SAS_BILLING_ADDRESS") || req("NEXT_PUBLIC_SAS_BILLING_ADDRESS"));
  const executorAddressRaw = opt("SAS_EXECUTOR_ADDRESS") || opt("NEXT_PUBLIC_SAS_EXECUTOR_ADDRESS");
  const executor = executorAddressRaw ? getAddress(executorAddressRaw) : null;
  const autonomy = getAddress(
    opt("SAS_AUTONOMY_V0_1_ADDRESS") ||
      opt("SAS_AUTONOMY_V4_ADDRESS") ||
      opt("NEXT_PUBLIC_SAS_AUTONOMY_V0_1_ADDRESS") ||
      req("NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS")
  );
  const executionGraph = getAddress(opt("SAS_EXECUTION_GRAPH_ADDRESS") || req("SAS_EXECUTION_GRAPH_ADDRESS"));
  const adminTimelockAddressRaw = opt("EVE_ADMIN_TIMELOCK_ADDRESS") || opt("SAS_ADMIN_TIMELOCK_ADDRESS");
  const adminTimelock = adminTimelockAddressRaw ? getAddress(adminTimelockAddressRaw) : null;
  const somniaAgentPlatform = getAddress(
    opt("SOMNIA_AGENT_PLATFORM_ADDRESS") || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
  );

  const loopMs = Math.max(30_000, num("EVE_LOOP_INTERVAL_MS", 120_000));
  const dryRun = bool("EVE_DRY_RUN", false);
  const metadataFetchEnabled = bool("EVE_ENABLE_METADATA_FETCH", true);
  const somniaLinkVerifierEnabled = bool("EVE_ENABLE_SOMNIA_LINK_VERIFIER", true);
  const canonicalGuardianEnabled = bool("EVE_ENABLE_CANONICAL_LISTING_GUARDIAN", true);
  const executionHealthEnabled = bool("EVE_ENABLE_EXECUTION_HEALTH_SENTINEL", true);
  const priceSanityEnabled = bool("EVE_ENABLE_PRICE_SANITY", true);
  const builderReputationEnabled = bool("EVE_ENABLE_BUILDER_REPUTATION", true);
  const treasuryWatchEnabled = bool("EVE_ENABLE_TREASURY_RESERVE_WATCH", true);
  const roleDriftEnabled = bool("EVE_ENABLE_ROLE_DRIFT_WATCHER", true);
  const unverifyThreshold = Math.max(1, num("EVE_UNVERIFY_FAILURE_STREAK", 2));
  const verifyHealthyThreshold = Math.max(1, num("EVE_VERIFY_HEALTHY_STREAK", 2));
  const deprecateThreshold = Math.max(unverifyThreshold + 1, num("EVE_DEPRECATE_FAILURE_STREAK", 5));
  const allowDeprecate = bool("EVE_ALLOW_DEPRECATE", true);
  const allowDuplicateDeprecate = bool("EVE_ALLOW_DUPLICATE_DEPRECATE", allowDeprecate);
  const runAllowlistToggles = bool("EVE_ENABLE_ALLOWLIST_TOGGLES", true);
  const deprecateRequiresUnverified = bool("EVE_DEPRECATE_REQUIRE_UNVERIFIED", true);
  const maxMutationsPerCycle = Math.max(1, num("EVE_MAX_MUTATIONS_PER_CYCLE", 6));
  const actionCooldownMs = Math.max(60_000, num("EVE_ACTION_COOLDOWN_MS", 900_000));
  const reportCooldownMs = Math.max(60_000, num("EVE_REPORT_COOLDOWN_MS", 3_600_000));
  const metadataFetchTimeoutMs = Math.max(1_000, num("EVE_METADATA_FETCH_TIMEOUT_MS", 8_000));
  const executionRecentLimit = Math.max(3, num("EVE_EXECUTION_RECENT_LIMIT", 12));
  const maxPendingAgeMs = Math.max(60_000, num("EVE_MAX_PENDING_EXECUTION_AGE_MS", 900_000));
  const maxExecutionFailureRateBps = Math.min(10_000, Math.max(1, num("EVE_MAX_EXECUTION_FAILURE_RATE_BPS", 5_000)));
  const minPriceWei = BigInt(Math.max(0, num("EVE_MIN_AGENT_PRICE_WEI", 1)));
  const maxPriceWei = BigInt(Math.max(1, num("EVE_MAX_AGENT_PRICE_WEI", 10_000_000_000_000_000_000)));
  const maxAgentFeeToRuntimeBps = Math.max(1, num("EVE_MAX_AGENT_FEE_TO_RUNTIME_BPS", 20_000));
  const minTreasuryWei = BigInt(Math.max(0, num("EVE_MIN_TREASURY_WEI", 0)));
  const minExecutorReserveWei = BigInt(Math.max(0, num("EVE_MIN_EXECUTOR_RESERVE_WEI", 0)));
  const protectedAgentIds = parseIdSet(opt("EVE_PROTECTED_AGENT_IDS"));
  const allowlistAgentIds = parseIdSet(opt("EVE_ALLOWLIST_AGENT_IDS"));

  const supabase = new SupabasePostgrestClient(
    req("SUPABASE_URL"),
    req("SUPABASE_SERVICE_ROLE_KEY"),
    opt("SUPABASE_SCHEMA") || "public"
  );

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const health = startServiceHealthServer({
    serviceName: opt("SERVICE_NAME") || AGENT_NAME,
    getDetails: () => ({
      address: account.address,
      registry,
      billing,
      executor,
      autonomy,
      executionGraph,
      dryRun,
      loopMs,
      maxMutationsPerCycle,
    }),
  });

  console.log(`[${AGENT_NAME}] starting`, {
    address: account.address,
    registry,
    billing,
    executor,
    autonomy,
    executionGraph,
    adminTimelock,
    somniaAgentPlatform,
    loopMs,
    dryRun,
    maxMutationsPerCycle,
    actionCooldownMs,
  });
  health.ready();

  while (true) {
    try {
      const failureRows = await supabase.select<FailureState>("eve_agent_health", "select=*");
      const failureByAgent = new Map(failureRows.map((r) => [r.agent_id, r]));
      let mutationsThisCycle = 0;

      const canMutate = (): boolean => mutationsThisCycle < maxMutationsPerCycle;
      const reserveMutation = (): boolean => {
        if (!canMutate()) return false;
        mutationsThisCycle += 1;
        return true;
      };

      const policies = runAllowlistToggles
        ? await supabase.select<TogglePolicy>("eve_toggle_policies", "active=eq.true&select=*")
        : [];

      for (const policy of policies) {
        if (!canMutate()) break;
        const target = getAddress(policy.target_address);
        let current = false;

        if (policy.target_type === "executor") {
          current = await publicClient.readContract({
            address: autonomy,
            abi: AUTONOMY_ABI,
            functionName: "executors",
            args: [target],
          });
          if (current !== policy.desired_allowed) {
            const coolingDown = await isActionCoolingDown({
              supabase,
              actionType: "toggle_executor",
              targetAddress: target,
              cooldownMs: actionCooldownMs,
            });
            if (coolingDown || !reserveMutation()) continue;
            const hash = dryRun
              ? null
              : await walletClient.writeContract({
                  account,
                  chain,
                  address: autonomy,
                  abi: AUTONOMY_ABI,
                  functionName: "setExecutor",
                  args: [target, policy.desired_allowed],
                });
            await supabase.insert("eve_action_logs", [
              {
                id: `${Date.now()}-${policy.id}-executor`,
                action_type: "toggle_executor",
                target_address: target,
                details: { desired: policy.desired_allowed, txHash: hash, policyId: policy.id, dryRun },
                tx_hash: hash,
                created_at: new Date().toISOString(),
              },
            ]);
          }
        } else {
          current = await publicClient.readContract({
            address: executionGraph,
            abi: GRAPH_ABI,
            functionName: "recorders",
            args: [target],
          });
          if (current !== policy.desired_allowed) {
            const coolingDown = await isActionCoolingDown({
              supabase,
              actionType: "toggle_recorder",
              targetAddress: target,
              cooldownMs: actionCooldownMs,
            });
            if (coolingDown || !reserveMutation()) continue;
            const hash = dryRun
              ? null
              : await walletClient.writeContract({
                  account,
                  chain,
                  address: executionGraph,
                  abi: GRAPH_ABI,
                  functionName: "setRecorder",
                  args: [target, policy.desired_allowed],
                });
            await supabase.insert("eve_action_logs", [
              {
                id: `${Date.now()}-${policy.id}-recorder`,
                action_type: "toggle_recorder",
                target_address: target,
                details: { desired: policy.desired_allowed, txHash: hash, policyId: policy.id, dryRun },
                tx_hash: hash,
                created_at: new Date().toISOString(),
              },
            ]);
          }
        }
      }

      const allAgents = (await publicClient.readContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "getAllAgents",
      })) as AgentRecord[];

      if (canonicalGuardianEnabled) {
        for (const group of buildDuplicateGroups(allAgents)) {
          const canonical = chooseCanonicalAgent(group);
          const duplicates = group.filter((agent) => agent.id !== canonical.id);
          await logIncident({
            supabase,
            actionType: "canonical_listing_guardian",
            targetAgentId: canonical.id.toString(),
            cooldownMs: reportCooldownMs,
            details: {
              canonicalAgentId: canonical.id.toString(),
              duplicateAgentIds: duplicates.map((agent) => agent.id.toString()),
              key: canonicalListingKey(canonical),
              reason: "Duplicate active SAS listings detected for the same canonical listing key.",
            },
          });

          for (const duplicate of duplicates) {
            const duplicateKey = duplicate.id.toString();
            if (protectedAgentIds?.has(duplicateKey)) continue;
            if (!allowDuplicateDeprecate) continue;
            const coolingDown = await isActionCoolingDown({
              supabase,
              actionType: "deprecate_duplicate_listing",
              targetAgentId: duplicateKey,
              cooldownMs: actionCooldownMs,
            });
            if (coolingDown || !reserveMutation()) continue;
            const action = await writeRegistryAdminAction({
              publicClient,
              walletClient,
              account,
              chain,
              registry,
              timelock: adminTimelock,
              functionName: "adminDeprecateAgent",
              args: [duplicate.id],
              saltLabel: `eve:adminDeprecateDuplicate:${duplicateKey}`,
              dryRun,
            });
            await logAction({
              supabase,
              actionType: "deprecate_duplicate_listing",
              targetAgentId: duplicateKey,
              txHash: action.txHash,
              details: {
                canonicalAgentId: canonical.id.toString(),
                duplicateAgentId: duplicateKey,
                mode: action.mode,
                operationId: action.operationId,
                dryRun,
              },
            });
          }
        }
      }

      if (builderReputationEnabled) {
        for (const reputation of buildBuilderReputation(allAgents)) {
          await logIncident({
            supabase,
            actionType: "builder_reputation_snapshot",
            targetAddress: reputation.builder,
            cooldownMs: reportCooldownMs,
            details: {
              listings: reputation.listings,
              active: reputation.active,
              verified: reputation.verified,
              deprecated: reputation.deprecated,
              executions: reputation.executions.toString(),
              revenueWei: reputation.revenue.toString(),
            },
          });
        }
      }

      if (treasuryWatchEnabled) {
        try {
          const stats = (await publicClient.readContract({
            address: billing,
            abi: BILLING_ABI,
            functionName: "getPlatformStats",
          })) as readonly [bigint, bigint, bigint, bigint];
          const treasuryBalance = stats[2];
          const reserveBalance =
            executor === null
              ? null
              : ((await publicClient.readContract({
                  address: executor,
                  abi: EXECUTOR_ABI,
                  functionName: "somniaReserveBalance",
                })) as bigint);
          const failures: string[] = [];
          if (treasuryBalance < minTreasuryWei) failures.push("treasury below policy minimum");
          if (reserveBalance !== null && reserveBalance < minExecutorReserveWei) {
            failures.push("executor reserve below policy minimum");
          }
          if (failures.length > 0) {
            await logIncident({
              supabase,
              actionType: "treasury_reserve_watch",
              cooldownMs: reportCooldownMs,
              details: {
                failures,
                treasuryBalanceWei: treasuryBalance.toString(),
                executorReserveWei: reserveBalance?.toString() ?? null,
                minTreasuryWei: minTreasuryWei.toString(),
                minExecutorReserveWei: minExecutorReserveWei.toString(),
              },
            });
          }
        } catch (error) {
          await logIncident({
            supabase,
            actionType: "treasury_reserve_watch_error",
            cooldownMs: reportCooldownMs,
            details: { message: error instanceof Error ? error.message : "unknown treasury watcher error" },
          });
        }
      }

      if (roleDriftEnabled) {
        const expectedOwner = opt("EVE_EXPECTED_PROTOCOL_OWNER")?.toLowerCase();
        if (expectedOwner) {
          for (const [label, address] of [
            ["registry", registry],
            ["billing", billing],
            ["autonomy", autonomy],
            ["executionGraph", executionGraph],
          ] as const) {
            try {
              const owner = (await publicClient.readContract({
                address,
                abi: OWNER_ABI,
                functionName: "owner",
              })) as Address;
              if (owner.toLowerCase() !== expectedOwner) {
                await logIncident({
                  supabase,
                  actionType: "role_drift_detected",
                  targetAddress: address,
                  cooldownMs: reportCooldownMs,
                  details: { contract: label, owner, expectedOwner },
                });
              }
            } catch {
              await logIncident({
                supabase,
                actionType: "role_drift_unreadable",
                targetAddress: address,
                cooldownMs: reportCooldownMs,
                details: { contract: label },
              });
            }
          }
        }
      }

      for (const agent of allAgents) {
        const key = agent.id.toString();
        if (allowlistAgentIds && !allowlistAgentIds.has(key)) continue;
        if (agent.status === 2) continue; // deprecated
        const isProtected = protectedAgentIds?.has(key) ?? false;

        const failures: string[] = [];
        const evidence: Record<string, unknown> = {};
        if (!metadataUriLooksValid(agent.metadataURI)) failures.push("invalid metadataURI");
        if (agent.pricePerExecution <= 0n) failures.push("non-positive pricePerExecution");
        if (agent.agentType !== 3 && agent.somniaAgentId <= 0n) failures.push("missing somniaAgentId for non-custom agent");

        if (metadataFetchEnabled && metadataUriLooksValid(agent.metadataURI)) {
          const metadataFailures = await checkMetadataIntegrity(agent, metadataFetchTimeoutMs);
          failures.push(...metadataFailures);
          evidence.metadataIntegrity = {
            checked: true,
            failures: metadataFailures,
          };
        }

        if (somniaLinkVerifierEnabled) {
          const somniaLink = await checkSomniaAgentLink({
            publicClient,
            agentPlatform: somniaAgentPlatform,
            agent,
          });
          failures.push(...somniaLink.failures);
          evidence.somniaAgentLink = {
            platform: somniaLink.platform ?? null,
            expectedAgentId: somniaLink.expectedAgentId ?? null,
            requestDepositWei: somniaLink.requestDepositWei ?? null,
            failures: somniaLink.failures,
          };
        }

        let quote: readonly [bigint, bigint, bigint] | null = null;
        try {
          quote = (await publicClient.readContract({
            address: billing,
            abi: BILLING_ABI,
            functionName: "quoteExecution",
            args: [agent.id],
          })) as readonly [bigint, bigint, bigint];
          if (quote[2] <= 0n) failures.push("zero totalCost quote");
        } catch {
          failures.push("quoteExecution failed");
        }
        evidence.quote = quote
          ? {
              agentFeeWei: quote[0].toString(),
              runtimeBudgetWei: quote[1].toString(),
              totalCostWei: quote[2].toString(),
            }
          : null;

        if (priceSanityEnabled) {
          failures.push(
            ...checkPriceSanity({
              agent,
              quote,
              minPriceWei,
              maxPriceWei,
              maxAgentFeeToRuntimeBps,
            })
          );
        }

        if (executionHealthEnabled) {
          try {
            const executionHealth = await getExecutionHealth({
              publicClient,
              billing,
              agent,
              recentLimit: executionRecentLimit,
              maxPendingAgeMs,
              maxFailureRateBps: maxExecutionFailureRateBps,
            });
            failures.push(...executionHealth.failures);
            evidence.executionHealth = executionHealth.stats;
          } catch (error) {
            failures.push("execution health check failed");
            evidence.executionHealthError = error instanceof Error ? error.message : "unknown execution health error";
          }
        }

        const prev = failureByAgent.get(key);
        const streak = failures.length > 0 ? (prev?.failure_streak ?? 0) + 1 : 0;
        const healthyStreak = failures.length === 0 ? (prev?.healthy_streak ?? 0) + 1 : 0;
        const nowIso = new Date().toISOString();
        const derivedStatus: FailureState["last_status"] =
          failures.length > 0 ? "unverified" : "healthy";
        const stage = deriveStage(agent, failures, healthyStreak, streak);

        await logIncident({
          supabase,
          actionType: "verification_stage_snapshot",
          targetAgentId: key,
          cooldownMs: reportCooldownMs,
          details: {
            stage,
            failures,
            healthyStreak,
            failureStreak: streak,
            isVerified: agent.isVerified,
            status: agent.status,
            evidence,
          },
        });

        if (!prev) {
          await supabase.insert("eve_agent_health", [
            {
              id: `agent-${key}`,
              agent_id: key,
              failure_streak: streak,
              healthy_streak: healthyStreak,
              last_status: derivedStatus,
              last_reason: failures.length > 0 ? failures.join("; ") : null,
              updated_at: nowIso,
            },
          ]);
        } else {
          await supabase.update("eve_agent_health", `id=eq.${encodeURIComponent(prev.id)}`, {
            failure_streak: streak,
            healthy_streak: healthyStreak,
            last_status: derivedStatus,
            last_reason: failures.length > 0 ? failures.join("; ") : null,
            updated_at: nowIso,
          });
        }

        if (failures.length === 0) {
          if (!agent.isVerified && healthyStreak >= verifyHealthyThreshold && !isProtected) {
            const coolingDown = await isActionCoolingDown({
              supabase,
              actionType: "verify_agent",
              targetAgentId: key,
              cooldownMs: actionCooldownMs,
            });
            if (coolingDown || !reserveMutation()) continue;
            const action = await writeRegistryAdminAction({
              publicClient,
              walletClient,
              account,
              chain,
              registry,
              timelock: adminTimelock,
              functionName: "setAgentVerified",
              args: [agent.id, true],
              saltLabel: `sas-agent-verified:${key}:true`,
              dryRun,
            });
            await supabase.insert("eve_action_logs", [
              {
                id: `${Date.now()}-verify-${key}`,
                action_type: "verify_agent",
                target_agent_id: key,
                details: { txHash: action.txHash, mode: action.mode, operationId: action.operationId, reason: "all checks passed", stage, healthyStreak, evidence, dryRun },
                tx_hash: action.txHash,
                created_at: nowIso,
              },
            ]);
          }
          continue;
        }

        const summary = await buildGroqAuditSummary({
          agentName: agent.name,
          agentId: agent.id,
          failures,
        });

        if (agent.isVerified && streak >= unverifyThreshold && !isProtected) {
          const coolingDown = await isActionCoolingDown({
            supabase,
            actionType: "unverify_agent",
            targetAgentId: key,
            cooldownMs: actionCooldownMs,
          });
          if (!coolingDown && reserveMutation()) {
            const action = await writeRegistryAdminAction({
              publicClient,
              walletClient,
              account,
              chain,
              registry,
              timelock: adminTimelock,
              functionName: "setAgentVerified",
              args: [agent.id, false],
              saltLabel: `sas-agent-verified:${key}:false`,
              dryRun,
            });
            await supabase.insert("eve_action_logs", [
              {
                id: `${Date.now()}-unverify-${key}`,
                action_type: "unverify_agent",
                target_agent_id: key,
                details: { txHash: action.txHash, mode: action.mode, operationId: action.operationId, failures, summary, stage, streak, evidence, dryRun },
                tx_hash: action.txHash,
                created_at: nowIso,
              },
            ]);
          }
        }

        if (allowDeprecate && streak >= deprecateThreshold && !isProtected) {
          if (deprecateRequiresUnverified && agent.isVerified) continue;
          const coolingDown = await isActionCoolingDown({
            supabase,
            actionType: "deprecate_agent",
            targetAgentId: key,
            cooldownMs: actionCooldownMs,
          });
          if (coolingDown || !reserveMutation()) continue;
          const action = await writeRegistryAdminAction({
            publicClient,
            walletClient,
            account,
            chain,
            registry,
            timelock: adminTimelock,
            functionName: "adminDeprecateAgent",
            args: [agent.id],
            saltLabel: `eve:adminDeprecateAgent:${key}`,
            dryRun,
          });
          await supabase.insert("eve_action_logs", [
            {
              id: `${Date.now()}-deprecate-${key}`,
              action_type: "deprecate_agent",
              target_agent_id: key,
              details: { txHash: action.txHash, mode: action.mode, operationId: action.operationId, failures, summary, stage, streak, evidence, dryRun },
              tx_hash: action.txHash,
              created_at: nowIso,
            },
          ]);
        }
      }

      console.log(`[${AGENT_NAME}] cycle complete`, {
        at: new Date().toISOString(),
        agentCount: allAgents.length,
        mutationsThisCycle,
      });
      health.beat();
    } catch (error) {
      health.error(error);
      console.error(`[${AGENT_NAME}] cycle failed`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, loopMs));
  }
}

main().catch((error) => {
  console.error(`[${AGENT_NAME}] fatal`, error);
  process.exit(1);
});
