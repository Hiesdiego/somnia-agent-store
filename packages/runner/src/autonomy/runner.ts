import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  keccak256,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  AUTONOMY_V4_ABI,
  BILLING_ABI,
  DEFAULT_RELATION_TYPE,
  REGISTRY_ABI,
  WorkflowStatus,
  ZERO_BYTES32,
} from "./abis.js";
import { planAutoDelegates } from "./delegationPolicy.js";
import type {
  AgentConfig,
  RunnerConfig,
  StepData,
  WorkflowAutomationMetadata,
  WorkflowData,
} from "./types.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MAX_DELEGATES = 2;
const DEFAULT_STEP_COST_BPS = 10_500; // 5% headroom on quoted cost
const DEFAULT_POLL_MS = 20_000;
const DEFAULT_CATCHUP_BLOCKS = 300n;
const MAX_RECONCILE_WINDOW = 200n;
const DEFAULT_METADATA_KINDS = [
  "analysis-sas-v0.1-runner",
  "analysis-sas-v0.1",
  "analysis-autonomy-v4-runner",
  "analysis-autonomy-v4",
];
const DEFAULT_EXPECTED_CHAIN_ID = 50312;
const DEFAULT_MAX_CATCHUP_WORKFLOWS = 200;
const DEFAULT_MAX_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_WORKFLOW_FAILURE_STREAK = 3;
const DEFAULT_WORKFLOW_FAILURE_COOLDOWN_MS = 120_000;
const DEFAULT_HEALTH_LOG_INTERVAL_MS = 60_000;

type RunnerDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  config: RunnerConfig;
};

type ResolvedAddresses = {
  autonomy: `0x${string}`;
  registry: `0x${string}`;
  billing: `0x${string}`;
};

interface WorkflowPlanStep {
  toAgentId: bigint;
  payload: `0x${string}`;
  role: "root-analysis" | "delegated-analysis";
}

function asTupleValue<T>(input: unknown, index: number, name: string): T {
  if (Array.isArray(input)) return input[index] as T;
  if (input && typeof input === "object" && name in input) {
    return (input as Record<string, unknown>)[name] as T;
  }
  return (input as Record<number, T>)[index];
}

function isHexBytes(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseAddressList(raw: string | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const set = new Set<string>();
  for (const item of raw.split(",")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    set.add(getAddress(trimmed).toLowerCase());
  }
  return set.size > 0 ? set : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  const message = String(err ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("disconnected") ||
    message.includes("etimedout") ||
    message.includes("econnreset")
  );
}

async function withRetry<T>(
  label: string,
  maxAttempts: number,
  baseDelayMs: number,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err);
      if (!retryable || attempt >= maxAttempts) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function normalizeMetadata(raw: unknown): WorkflowAutomationMetadata | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const maxDelegatesRaw = obj.maxDelegates;
  let maxDelegates: number | undefined;
  if (typeof maxDelegatesRaw === "number" && Number.isFinite(maxDelegatesRaw) && maxDelegatesRaw > 0) {
    maxDelegates = Math.floor(maxDelegatesRaw);
  }

  const manualListRaw =
    (Array.isArray(obj.manualDelegateAgentIds) ? obj.manualDelegateAgentIds : undefined) ??
    (Array.isArray(obj.delegatedAgentIds) ? obj.delegatedAgentIds : undefined);
  const manualDelegateAgentIds =
    manualListRaw?.map((value) => String(value)).filter((value) => value.trim().length > 0) ?? undefined;

  let delegatePayloads: Record<string, `0x${string}`> | undefined;
  if (obj.delegatePayloads && typeof obj.delegatePayloads === "object" && !Array.isArray(obj.delegatePayloads)) {
    delegatePayloads = {};
    for (const [key, value] of Object.entries(obj.delegatePayloads as Record<string, unknown>)) {
      if (isHexBytes(value)) delegatePayloads[key] = value;
    }
  }

  const delegationMode =
    obj.delegationMode === "manual" || obj.delegationMode === "automatic"
      ? obj.delegationMode
      : undefined;

  return {
    kind: typeof obj.kind === "string" ? obj.kind : undefined,
    app: typeof obj.app === "string" ? obj.app : undefined,
    delegationMode,
    maxDelegates,
    manualDelegateAgentIds,
    delegatedAgentIds: manualDelegateAgentIds,
    rootPayload: isHexBytes(obj.rootPayload) ? obj.rootPayload : undefined,
    delegatePayloads,
    relationType: isHexBytes(obj.relationType) ? obj.relationType : undefined,
  };
}

function parseWorkflowMetadata(metadataURI: string): WorkflowAutomationMetadata | null {
  if (!metadataURI || typeof metadataURI !== "string") return null;
  try {
    return normalizeMetadata(JSON.parse(metadataURI));
  } catch {
    return null;
  }
}

function toWorkflowData(raw: unknown): WorkflowData {
  return {
    id: asTupleValue<bigint>(raw, 0, "id"),
    requester: asTupleValue<`0x${string}`>(raw, 1, "requester"),
    rootAgentId: asTupleValue<bigint>(raw, 2, "rootAgentId"),
    maxDepth: asTupleValue<bigint>(raw, 3, "maxDepth"),
    stepCount: asTupleValue<bigint>(raw, 8, "stepCount"),
    status: Number(asTupleValue<bigint | number>(raw, 10, "status")),
    metadataURI: asTupleValue<string>(raw, 13, "metadataURI"),
  };
}

function toStepData(raw: unknown): StepData {
  return {
    id: asTupleValue<bigint>(raw, 0, "id"),
    workflowId: asTupleValue<bigint>(raw, 1, "workflowId"),
    parentStepId: asTupleValue<bigint>(raw, 2, "parentStepId"),
    fromAgentId: asTupleValue<bigint>(raw, 3, "fromAgentId"),
    toAgentId: asTupleValue<bigint>(raw, 4, "toAgentId"),
    executed: asTupleValue<boolean>(raw, 8, "executed"),
  };
}

function toAgentConfig(raw: unknown): AgentConfig {
  return {
    id: asTupleValue<bigint>(raw, 0, "id"),
    builder: getAddress(asTupleValue<string>(raw, 1, "builder")) as `0x${string}`,
    name: asTupleValue<string>(raw, 2, "name"),
    description: asTupleValue<string>(raw, 3, "description"),
    category: asTupleValue<string>(raw, 4, "category"),
    metadataURI: asTupleValue<string>(raw, 5, "metadataURI"),
    agentType: Number(asTupleValue<bigint | number>(raw, 6, "agentType")),
    status: Number(asTupleValue<bigint | number>(raw, 7, "status")),
    pricePerExecution: asTupleValue<bigint>(raw, 8, "pricePerExecution"),
    somniaAgentId: asTupleValue<bigint>(raw, 9, "somniaAgentId"),
    totalExecutions: asTupleValue<bigint>(raw, 10, "totalExecutions"),
    totalRevenue: asTupleValue<bigint>(raw, 11, "totalRevenue"),
    createdAt: asTupleValue<bigint>(raw, 12, "createdAt"),
    version: asTupleValue<bigint>(raw, 13, "version"),
    isVerified: asTupleValue<boolean>(raw, 14, "isVerified"),
  };
}

function resolveMaxDelegates(
  metadata: WorkflowAutomationMetadata | null,
  defaultMaxDelegates: number,
  maxDepth: bigint
): number {
  const depthCap = Number(maxDepth > 0n ? maxDepth - 1n : 0n);
  const requested = metadata?.maxDelegates ?? defaultMaxDelegates;
  if (depthCap <= 0) return 0;
  return Math.max(0, Math.min(requested, depthCap));
}

function buildPlanChain(
  workflow: WorkflowData,
  metadata: WorkflowAutomationMetadata | null,
  activeAgents: AgentConfig[],
  defaultMaxDelegates: number
): WorkflowPlanStep[] {
  const rootAgent = activeAgents.find((agent) => agent.id === workflow.rootAgentId) ?? null;
  if (!rootAgent) {
    throw new Error(`Root agent #${workflow.rootAgentId.toString()} is not active`);
  }
  if (!metadata?.rootPayload) {
    throw new Error("Workflow metadata is missing `rootPayload` (hex bytes)");
  }

  const maxDelegates = resolveMaxDelegates(metadata, defaultMaxDelegates, workflow.maxDepth);
  let delegates: AgentConfig[] = [];

  if (metadata?.delegationMode === "manual" && metadata.manualDelegateAgentIds?.length) {
    const manualIds = metadata.manualDelegateAgentIds
      .map((id) => {
        try {
          return BigInt(id);
        } catch {
          return null;
        }
      })
      .filter((id): id is bigint => id !== null);

    const byId = new Map(activeAgents.map((agent) => [agent.id.toString(), agent] as const));
    delegates = manualIds
      .map((id) => byId.get(id.toString()))
      .filter((agent): agent is AgentConfig => Boolean(agent))
      .filter((agent) => agent.id !== workflow.rootAgentId)
      .slice(0, maxDelegates);
  } else {
    delegates = planAutoDelegates(rootAgent, activeAgents, maxDelegates);
  }

  const chain: WorkflowPlanStep[] = [
    { toAgentId: rootAgent.id, payload: metadata.rootPayload, role: "root-analysis" },
  ];

  for (const delegate of delegates) {
    const payload =
      metadata.delegatePayloads?.[delegate.id.toString()] ??
      metadata.delegatePayloads?.[workflow.rootAgentId.toString()] ??
      metadata.rootPayload;
    chain.push({
      toAgentId: delegate.id,
      payload,
      role: "delegated-analysis",
    });
  }

  return chain.slice(0, Number(workflow.maxDepth));
}

async function resolveAddresses(deps: RunnerDeps): Promise<ResolvedAddresses> {
  const autonomy = deps.config.autonomyAddress;
  const registry =
    deps.config.registryAddress ??
    (await withRetry(
      "resolve registry address",
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.publicClient.readContract({
          address: autonomy,
          abi: AUTONOMY_V4_ABI,
          functionName: "registry",
        })
    ));

  const billing =
    deps.config.billingAddress ??
    (await withRetry(
      "resolve billing address",
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.publicClient.readContract({
          address: autonomy,
          abi: AUTONOMY_V4_ABI,
          functionName: "billing",
        })
    ));

  return {
    autonomy,
    registry: getAddress(registry),
    billing: getAddress(billing),
  };
}

async function parseStepIdFromPlanReceipt(
  deps: RunnerDeps,
  txHash: `0x${string}`,
  workflowId: bigint
): Promise<bigint> {
  const receipt = await withRetry(
    "wait planStep receipt",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () => deps.publicClient.waitForTransactionReceipt({ hash: txHash })
  );
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: AUTONOMY_V4_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "StepPlanned") continue;
      const decodedWorkflow = (decoded.args as { workflowId?: bigint }).workflowId;
      const stepId = (decoded.args as { stepId?: bigint }).stepId;
      if (decodedWorkflow === workflowId && stepId) return stepId;
    } catch {
      // ignore unrelated logs
    }
  }
  throw new Error("Could not recover stepId from StepPlanned event");
}

async function parseExecutionIdFromExecuteReceipt(
  deps: RunnerDeps,
  txHash: `0x${string}`
): Promise<bigint | null> {
  const receipt = await withRetry(
    "wait executeStep receipt",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () => deps.publicClient.waitForTransactionReceipt({ hash: txHash })
  );
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: BILLING_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "AgentExecutionRequested") continue;
      const executionId = (decoded.args as { executionId?: bigint }).executionId;
      if (executionId) return executionId;
    } catch {
      // ignore non-billing logs
    }
  }
  return null;
}

async function isRunnerAuthorized(
  deps: RunnerDeps,
  addresses: ResolvedAddresses,
  workflow: WorkflowData
): Promise<boolean> {
  if (isAddressEqual(workflow.requester, deps.account.address)) return true;

  const globalAuth = await withRetry(
    "check global executor auth",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "executors",
        args: [deps.account.address],
      })
  );
  if (globalAuth) return true;

  return withRetry(
    "check workflow executor auth",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "workflowExecutors",
        args: [workflow.id, deps.account.address],
      })
  );
}

async function getActiveAgents(deps: RunnerDeps, addresses: ResolvedAddresses): Promise<AgentConfig[]> {
  const raw = (await withRetry(
    "get active agents",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: "getAllActiveAgents",
      })
  )) as unknown[];

  return raw.map(toAgentConfig);
}

async function getWorkflow(deps: RunnerDeps, addresses: ResolvedAddresses, workflowId: bigint): Promise<WorkflowData> {
  const raw = await withRetry(
    `read workflow ${workflowId.toString()}`,
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "workflows",
        args: [workflowId],
      })
  );
  return toWorkflowData(raw);
}

async function getExistingSteps(
  deps: RunnerDeps,
  addresses: ResolvedAddresses,
  workflowId: bigint
): Promise<StepData[]> {
  const stepIds = (await withRetry(
    `read step ids for workflow ${workflowId.toString()}`,
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "getWorkflowStepIds",
        args: [workflowId],
      })
  )) as bigint[];

  if (stepIds.length === 0) return [];

  const steps: StepData[] = [];
  for (const stepId of stepIds) {
    const raw = await withRetry(
      `read step ${stepId.toString()}`,
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.publicClient.readContract({
          address: addresses.autonomy,
          abi: AUTONOMY_V4_ABI,
          functionName: "steps",
          args: [stepId],
        })
    );
    steps.push(toStepData(raw));
  }
  return steps;
}

function computeStepCostCap(totalCost: bigint, stepCostBps: number): bigint {
  const numerator = BigInt(stepCostBps);
  return (totalCost * numerator + 9_999n) / 10_000n;
}

async function processWorkflow(deps: RunnerDeps, addresses: ResolvedAddresses, workflowId: bigint): Promise<void> {
  const workflow = await getWorkflow(deps, addresses, workflowId);
  if (workflow.id === 0n || workflow.status !== WorkflowStatus.ACTIVE) return;

  if (deps.config.allowedRequesters && !deps.config.allowedRequesters.has(workflow.requester.toLowerCase())) {
    return;
  }

  const metadata = parseWorkflowMetadata(workflow.metadataURI);
  if (!metadata?.kind || !deps.config.metadataKinds.includes(metadata.kind)) return;

  const authorized = await isRunnerAuthorized(deps, addresses, workflow);
  if (!authorized) {
    logger.warn(
      `[wf:${workflow.id.toString()}] Runner is not an authorized workflow operator. ` +
        "Grant autonomy executor role or set workflow executor to this runner address."
    );
    return;
  }

  const activeAgents = await getActiveAgents(deps, addresses);
  const chain = buildPlanChain(workflow, metadata, activeAgents, deps.config.defaultMaxDelegates);
  if (chain.length === 0) {
    logger.warn(`[wf:${workflow.id.toString()}] No executable chain generated.`);
    return;
  }

  const existingSteps = await getExistingSteps(deps, addresses, workflow.id);
  if (existingSteps.length > 0) {
    logger.info(
      `[wf:${workflow.id.toString()}] Already has ${existingSteps.length} planned step(s); skipping auto-plan.`
    );
    return;
  }

  logger.info(
    `[wf:${workflow.id.toString()}] Executing chain: ${chain.map((step) => `#${step.toAgentId.toString()}`).join(" -> ")}`
  );

  let parentStepId = 0n;
  let fromAgentId = workflow.rootAgentId;
  let latestExecution: bigint | null = null;
  const relationType = metadata.relationType ?? deps.config.relationType;

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const quote = (await withRetry(
      `quote step cost for agent ${step.toAgentId.toString()}`,
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.publicClient.readContract({
          address: addresses.billing,
          abi: BILLING_ABI,
          functionName: "quoteExecution",
          args: [step.toAgentId],
        })
    )) as readonly [bigint, bigint, bigint];
    const maxTotalCost = computeStepCostCap(quote[2], deps.config.stepCostBps);

    const planHash = await withRetry(
      `plan step ${i + 1} for workflow ${workflow.id.toString()}`,
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.walletClient.writeContract({
          account: deps.account,
          chain: undefined,
          address: addresses.autonomy,
          abi: AUTONOMY_V4_ABI,
          functionName: "planStep",
          args: [
            workflow.id,
            parentStepId,
            fromAgentId,
            step.toAgentId,
            keccak256(step.payload),
            maxTotalCost,
            relationType,
            JSON.stringify({
              role: step.role,
              step: i + 1,
              totalSteps: chain.length,
              planner: "sas-autonomy-runner",
            }),
          ],
        })
    );
    const plannedStepId = await parseStepIdFromPlanReceipt(deps, planHash, workflow.id);

    const executeHash = await withRetry(
      `execute step ${plannedStepId.toString()} for workflow ${workflow.id.toString()}`,
      deps.config.maxRetryAttempts,
      deps.config.retryBaseDelayMs,
      () =>
        deps.walletClient.writeContract({
          account: deps.account,
          chain: undefined,
          address: addresses.autonomy,
          abi: AUTONOMY_V4_ABI,
          functionName: "executeStep",
          args: [plannedStepId, step.payload],
        })
    );
    latestExecution = (await parseExecutionIdFromExecuteReceipt(deps, executeHash)) ?? latestExecution;

    parentStepId = plannedStepId;
    fromAgentId = step.toAgentId;
  }

  await withRetry(
    `finalize workflow ${workflow.id.toString()}`,
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.walletClient.writeContract({
        account: deps.account,
        chain: undefined,
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "finalizeWorkflow",
        args: [workflow.id, true, ZERO_BYTES32, "finalized-by-sas-autonomy-runner"],
      })
  );

  logger.info(
    `[wf:${workflow.id.toString()}] Finalized (${chain.length} step${chain.length === 1 ? "" : "s"}). ` +
      `Latest execution: ${latestExecution ? `#${latestExecution.toString()}` : "unknown"}`
  );
}

async function catchupRecentWorkflows(deps: RunnerDeps, addresses: ResolvedAddresses): Promise<bigint[]> {
  const latestBlock = await withRetry(
    "read latest block for catchup",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () => deps.publicClient.getBlockNumber()
  );
  const fromBlock = latestBlock > deps.config.catchupBlocks ? latestBlock - deps.config.catchupBlocks : 0n;
  const logs = await withRetry(
    "read catchup workflow events",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.getContractEvents({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        eventName: "WorkflowCreated",
        fromBlock,
        toBlock: "latest",
      })
  );
  const ids = logs
    .map((log) => (log.args as { workflowId?: bigint }).workflowId)
    .filter((id): id is bigint => typeof id === "bigint");
  if (ids.length <= deps.config.maxCatchupWorkflows) return ids;
  return ids.slice(ids.length - deps.config.maxCatchupWorkflows);
}

async function reconcileLatestWorkflows(deps: RunnerDeps, addresses: ResolvedAddresses): Promise<bigint[]> {
  const total = (await withRetry(
    "read workflow count",
    deps.config.maxRetryAttempts,
    deps.config.retryBaseDelayMs,
    () =>
      deps.publicClient.readContract({
        address: addresses.autonomy,
        abi: AUTONOMY_V4_ABI,
        functionName: "workflowCount",
      })
  )) as bigint;

  if (total <= 0n) return [];
  const start = total > MAX_RECONCILE_WINDOW ? total - MAX_RECONCILE_WINDOW + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = start; id <= total; id++) ids.push(id);
  return ids;
}

export async function startAutonomyRunner(deps: RunnerDeps): Promise<() => void> {
  const addresses = await resolveAddresses(deps);
  const inFlight = new Set<string>();
  const failureState = new Map<
    string,
    { streak: number; cooldownUntil: number; lastError: string; lastFailureAt: number }
  >();
  const stats = {
    processed: 0,
    failed: 0,
  };
  let stopped = false;

  const runWorkflow = async (workflowId: bigint, source: string) => {
    if (stopped) return;
    const key = workflowId.toString();
    const now = Date.now();
    const state = failureState.get(key);
    if (state && state.cooldownUntil > now) {
      return;
    }
    if (inFlight.has(key)) return;
    inFlight.add(key);

    try {
      await processWorkflow(deps, addresses, workflowId);
      stats.processed += 1;
      if (state) {
        failureState.delete(key);
      }
    } catch (err) {
      stats.failed += 1;
      const nextStreak = (state?.streak ?? 0) + 1;
      const hitThreshold = nextStreak >= deps.config.maxWorkflowFailureStreak;
      const cooldownUntil = hitThreshold ? now + deps.config.workflowFailureCooldownMs : 0;
      failureState.set(key, {
        streak: nextStreak,
        cooldownUntil,
        lastError: String(err),
        lastFailureAt: now,
      });
      logger.error(
        `[wf:${key}] ${source} failed: ${err}` +
          (hitThreshold
            ? ` (cooldown ${Math.ceil(deps.config.workflowFailureCooldownMs / 1000)}s after ${nextStreak} failures)`
            : ` (${nextStreak}/${deps.config.maxWorkflowFailureStreak} consecutive failures)`)
      );
    } finally {
      inFlight.delete(key);
    }
  };

  const recent = await catchupRecentWorkflows(deps, addresses);
  for (const workflowId of recent) {
    await runWorkflow(workflowId, "catchup");
  }

  const unwatch = deps.publicClient.watchContractEvent({
    address: addresses.autonomy,
    abi: AUTONOMY_V4_ABI,
    eventName: "WorkflowCreated",
    onLogs: (logs) => {
      for (const log of logs) {
        const workflowId = (log.args as { workflowId?: bigint }).workflowId;
        if (!workflowId) continue;
        void runWorkflow(workflowId, "event");
      }
    },
    onError: (error) => {
      logger.error(`Workflow event watcher error: ${error}`);
    },
  });

  const interval = setInterval(() => {
    void reconcileLatestWorkflows(deps, addresses)
      .then((ids) => Promise.all(ids.map((id) => runWorkflow(id, "reconcile"))))
      .catch((err) => logger.error(`Reconcile failed: ${err}`));
  }, deps.config.pollIntervalMs);

  const healthInterval = setInterval(() => {
    logger.info(
      `[health] inFlight=${inFlight.size} processed=${stats.processed} failed=${stats.failed} cooling=${failureState.size}`
    );
  }, deps.config.healthLogIntervalMs);

  return () => {
    stopped = true;
    clearInterval(interval);
    clearInterval(healthInterval);
    unwatch();
  };
}

function parseHexKey(raw: string | undefined, envName: string): `0x${string}` {
  if (!raw || !raw.trim()) {
    throw new Error(`Missing required env var: ${envName}`);
  }
  const value = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid ${envName}: expected 0x-prefixed 32-byte private key`);
  }
  return value as `0x${string}`;
}

function parseAddress(raw: string | undefined, envName: string, required = false): `0x${string}` | undefined {
  if (!raw || !raw.trim()) {
    if (required) throw new Error(`Missing required env var: ${envName}`);
    return undefined;
  }
  return getAddress(raw.trim());
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function loadRunnerConfig(env: NodeJS.ProcessEnv): RunnerConfig {
  const metadataKinds = (env.AUTONOMY_METADATA_KINDS ?? DEFAULT_METADATA_KINDS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const relationTypeRaw = env.AUTONOMY_RELATION_TYPE?.trim();
  const relationType =
    relationTypeRaw && /^0x[0-9a-fA-F]{64}$/.test(relationTypeRaw)
      ? (relationTypeRaw as `0x${string}`)
      : DEFAULT_RELATION_TYPE;

  const catchupBlocks = (() => {
    const raw = env.AUTONOMY_CATCHUP_BLOCKS?.trim();
    if (!raw) return DEFAULT_CATCHUP_BLOCKS;
    try {
      const parsed = BigInt(raw);
      return parsed > 0n ? parsed : DEFAULT_CATCHUP_BLOCKS;
    } catch {
      return DEFAULT_CATCHUP_BLOCKS;
    }
  })();

  const autonomyAddressRaw = pickFirstNonEmpty(
    env.SAS_AUTONOMY_V0_1_ADDRESS,
    env.AUTONOMY_V0_1_ADDRESS,
    env.NEXT_PUBLIC_SAS_AUTONOMY_V0_1_ADDRESS,
    env.SAS_AUTONOMY_V4_ADDRESS,
    env.AUTONOMY_V4_ADDRESS,
    env.NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS
  );
  const registryAddressRaw = pickFirstNonEmpty(
    env.SAS_REGISTRY_ADDRESS,
    env.NEXT_PUBLIC_SAS_REGISTRY_ADDRESS
  );
  const billingAddressRaw = pickFirstNonEmpty(
    env.SAS_BILLING_ADDRESS,
    env.NEXT_PUBLIC_SAS_BILLING_ADDRESS
  );

  return {
    runnerPrivateKey: parseHexKey(env.RUNNER_PRIVATE_KEY, "RUNNER_PRIVATE_KEY"),
    rpcUrl: env.RPC_URL?.trim() || "https://api.infra.testnet.somnia.network",
    wsRpcUrl: env.WS_RPC_URL?.trim() || "wss://api.infra.testnet.somnia.network/ws",
    expectedChainId: parsePositiveInt(env.SAS_EXPECTED_CHAIN_ID, DEFAULT_EXPECTED_CHAIN_ID),
    autonomyAddress: parseAddress(
      autonomyAddressRaw,
      "SAS_AUTONOMY_V0_1_ADDRESS (or AUTONOMY_V0_1_ADDRESS / NEXT_PUBLIC_SAS_AUTONOMY_V0_1_ADDRESS / legacy V4 vars)",
      true
    )!,
    registryAddress: parseAddress(
      registryAddressRaw,
      "SAS_REGISTRY_ADDRESS (or NEXT_PUBLIC_SAS_REGISTRY_ADDRESS)",
      false
    ),
    billingAddress: parseAddress(
      billingAddressRaw,
      "SAS_BILLING_ADDRESS (or NEXT_PUBLIC_SAS_BILLING_ADDRESS)",
      false
    ),
    defaultMaxDelegates: parsePositiveInt(env.AUTONOMY_MAX_DELEGATES, DEFAULT_MAX_DELEGATES),
    stepCostBps: parsePositiveInt(env.AUTONOMY_STEP_COST_BPS, DEFAULT_STEP_COST_BPS),
    relationType,
    metadataKinds,
    pollIntervalMs: parsePositiveInt(env.AUTONOMY_POLL_INTERVAL_MS, DEFAULT_POLL_MS),
    catchupBlocks,
    maxCatchupWorkflows: parsePositiveInt(env.AUTONOMY_MAX_CATCHUP_WORKFLOWS, DEFAULT_MAX_CATCHUP_WORKFLOWS),
    maxRetryAttempts: parsePositiveInt(env.AUTONOMY_MAX_RETRY_ATTEMPTS, DEFAULT_MAX_RETRY_ATTEMPTS),
    retryBaseDelayMs: parsePositiveInt(env.AUTONOMY_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS),
    maxWorkflowFailureStreak: parsePositiveInt(
      env.AUTONOMY_MAX_WORKFLOW_FAILURE_STREAK,
      DEFAULT_MAX_WORKFLOW_FAILURE_STREAK
    ),
    workflowFailureCooldownMs: parsePositiveInt(
      env.AUTONOMY_WORKFLOW_FAILURE_COOLDOWN_MS,
      DEFAULT_WORKFLOW_FAILURE_COOLDOWN_MS
    ),
    healthLogIntervalMs: parsePositiveInt(env.AUTONOMY_HEALTH_LOG_INTERVAL_MS, DEFAULT_HEALTH_LOG_INTERVAL_MS),
    allowedRequesters: parseAddressList(env.AUTONOMY_ALLOWED_REQUESTERS),
  };
}
