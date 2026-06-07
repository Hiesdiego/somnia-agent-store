import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeEventLog, parseEther } from "viem";
import {
  VAULT_ABI,
  executeMission,
  fetchAppContext,
  getAutopilotClients,
  optional,
  optionalNumber,
  parseMissionMetadata,
  parseArgs,
  validateMissionPolicy,
} from "./autopilot-common.ts";
import {
  applyFeedbackLearning,
  createAutonomyStore,
  evaluateMissionAutonomy,
  loadAutonomyConfig,
  syncOutcomesFromEndpoint,
  type AutonomyStore,
} from "./autonomy/index.ts";
import { hashId } from "./autonomy/utils.ts";

type RelayerState = {
  lastRunAt: Record<string, number>;
  missionIds: `0x${string}`[];
  lastScannedBlock: string;
  lastSeenMissionScanAt: number;
};

type DaemonOptions = {
  once: boolean;
  dryRun: boolean;
  ingestOnly: boolean;
  missionFilter?: `0x${string}`;
  maxExecutions: number;
};

const DEFAULT_FROM_BLOCK = 389298380n;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

type VaultMission = {
  id: `0x${string}`;
  owner: `0x${string}`;
  agentId: bigint;
  balance: bigint;
  spent: bigint;
  runCount: bigint;
  maxRelayerFeePerRun: bigint;
  minCadenceSeconds: bigint;
  maxRuns: bigint;
  expiresAt: bigint;
  maxTotalSpend: bigint;
  lastExecutedAt: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  marketHash: `0x${string}`;
  questionHash: `0x${string}`;
  payloadTemplateHash: `0x${string}`;
  active: boolean;
  metadataURI: string;
};

function statePath() {
  return resolve(optional("AUTOPILOT_STATE_FILE") ?? ".autopilot-relayer-state.json");
}

function loadState(): RelayerState {
  const fallback = { lastRunAt: {}, missionIds: [], lastScannedBlock: "0", lastSeenMissionScanAt: 0 };
  const file = statePath();
  if (!existsSync(file)) return fallback;

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<RelayerState>;
    return {
      lastRunAt: parsed.lastRunAt ?? {},
      missionIds: parsed.missionIds ?? [],
      lastScannedBlock: parsed.lastScannedBlock ?? "0",
      lastSeenMissionScanAt: parsed.lastSeenMissionScanAt ?? 0,
    };
  } catch {
    return fallback;
  }
}

function saveState(state: RelayerState) {
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function wait(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function iso(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function toExpiryIso(expiresAt: bigint): string | null {
  if (expiresAt <= 0n) return null;
  return new Date(Number(expiresAt) * 1000).toISOString();
}

function missionStatus(input: {
  clients: ReturnType<typeof getAutopilotClients>;
  missionId: `0x${string}`;
  mission: VaultMission;
  metadata: ReturnType<typeof parseMissionMetadata>;
  eventUrl?: string | null;
  question?: string | null;
  cadenceMinutes: number;
  now: number;
  effectiveLastRunAt?: number;
  lastRunAt?: number | null;
  skippedReason?: string | null;
  failureReason?: string | null;
  lastExecutionId?: string | null;
}) {
  const dueBase =
    input.effectiveLastRunAt ??
    input.lastRunAt ??
    (typeof input.mission.updatedAt === "bigint" ? Number(input.mission.updatedAt) * 1000 : 0);
  const nextDueAt = dueBase > 0 ? dueBase + input.cadenceMinutes * 60_000 : input.now;
  return {
    missionId: input.missionId,
    vaultAddress: input.clients.vaultAddress,
    eventUrl: input.eventUrl ?? input.metadata?.url ?? null,
    question: input.question ?? input.metadata?.question ?? null,
    active: Boolean(input.mission.active),
    balanceWei: input.mission.balance.toString(),
    spentWei: input.mission.spent.toString(),
    runCount: input.mission.runCount.toString(),
    maxRuns: input.mission.maxRuns.toString(),
    expiresAt: toExpiryIso(input.mission.expiresAt),
    nextDueAt: iso(nextDueAt),
    lastScanAt: iso(input.now),
    lastRunAt: iso(input.lastRunAt ?? (input.mission.lastExecutedAt > 0n ? Number(input.mission.lastExecutedAt) * 1000 : null)),
    lastSkippedReason: input.skippedReason ?? null,
    lastFailureReason: input.failureReason ?? null,
    lastExecutionId: input.lastExecutionId ?? null,
    policyHashes: {
      marketHash: input.mission.marketHash,
      questionHash: input.mission.questionHash,
      payloadTemplateHash: input.mission.payloadTemplateHash,
      metadataMarketHash: input.metadata?.marketHash ?? null,
      metadataQuestionHash: input.metadata?.questionHash ?? null,
      metadataPayloadTemplateHash: input.metadata?.payloadTemplateHash ?? null,
      policyVersion: input.metadata?.policyVersion ?? null,
    },
    metadata: input.metadata ? { ...input.metadata } : {},
  };
}

async function saveHeartbeat(input: {
  store: AutonomyStore;
  clients: ReturnType<typeof getAutopilotClients>;
  status: "starting" | "scanning" | "idle" | "executing" | "error";
  missionCount: number;
  lastScannedBlock: string;
  details?: Record<string, unknown>;
}) {
  let walletBalanceWei: string | null = null;
  try {
    walletBalanceWei = await Promise.race([
      input.clients.publicClient
        .getBalance({ address: input.clients.account.address })
        .then((balance) => balance.toString()),
      wait(3_000).then(() => null),
    ]);
  } catch {
    walletBalanceWei = null;
  }

  await input.store.saveRelayerHeartbeat({
    relayerId: `${input.clients.vaultAddress}:${input.clients.account.address}`.toLowerCase(),
    vaultAddress: input.clients.vaultAddress,
    relayerAddress: input.clients.account.address,
    status: input.status,
    lastSeenAt: new Date().toISOString(),
    missionCount: input.missionCount,
    lastScannedBlock: input.lastScannedBlock,
    walletBalanceWei,
    details: input.details ?? {},
  });
}

async function fetchMissionContext(url: string): Promise<string> {
  const fromApp = await fetchAppContext(url);
  if (fromApp.trim()) return fromApp;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; ProphecyCompanionAutonomy/1.0; +https://prophecy.social)",
      },
      cache: "no-store",
    });
    const html = await response.text();
    if (!html.trim()) return "";
    return [
      "Fallback context from market page HTML extraction (app context endpoint unavailable):",
      `URL: ${url}`,
      html.slice(0, 18_000),
    ].join("\n");
  } catch {
    return "";
  }
}

async function discoverMissionIds(
  clients: ReturnType<typeof getAutopilotClients>,
  state: RelayerState,
  persist: boolean
) {
  const configuredStart = BigInt(optional("AUTOPILOT_SCAN_FROM_BLOCK") ?? DEFAULT_FROM_BLOCK.toString());
  const previousCursor = BigInt(state.lastScannedBlock || "0");
  let fromBlock = previousCursor > 0n ? previousCursor + 1n : configuredStart;
  const latest = await clients.publicClient.getBlockNumber();
  const chunkSize = BigInt(Math.max(1, optionalNumber("AUTOPILOT_LOG_CHUNK_SIZE", 900)));
  const ids = new Set<`0x${string}`>(state.missionIds);

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize - 1n > latest ? latest : fromBlock + chunkSize - 1n;
    const logs = await clients.publicClient.getLogs({
      address: clients.vaultAddress,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "MissionCreated") {
          ids.add(decoded.args.missionId);
        }
      } catch {
        // ignore non-vault or unrelated logs
      }
    }

    state.lastScannedBlock = toBlock.toString();
    state.missionIds = [...ids];
    if (persist) saveState(state);
    fromBlock = toBlock + 1n;
  }

  return [...ids];
}

async function runDueMissions(
  state: RelayerState,
  options: DaemonOptions,
  autonomy: { store: AutonomyStore; config: ReturnType<typeof loadAutonomyConfig> }
) {
  const clients = getAutopilotClients();
  await saveHeartbeat({
    store: autonomy.store,
    clients,
    status: "scanning",
    missionCount: state.missionIds.length,
    lastScannedBlock: state.lastScannedBlock,
    details: {
      phase: "starting scan",
      once: options.once,
      dryRun: options.dryRun,
      ingestOnly: options.ingestOnly,
      missionFilter: options.missionFilter ?? null,
    },
  });
  const discoveredMissionIds = await discoverMissionIds(clients, state, !options.dryRun);
  const missionIds = options.missionFilter
    ? discoveredMissionIds.filter((missionId) => missionId === options.missionFilter)
    : discoveredMissionIds;
  const relayerFeeStt = optional("AUTOPILOT_RELAYER_FEE_STT") ?? "0";
  const relayerFee = parseEther(relayerFeeStt);
  const defaultAsk =
    optional("COMPANION_DEFAULT_ASK") ??
    "Based on current evidence and the market's own resolution criteria, what is the most likely outcome?";
  let executionCount = 0;
  const now = Date.now();

  console.log("[AutopilotDaemon] Scan", {
    vault: clients.vaultAddress,
    relayer: clients.account.address,
    missionCount: missionIds.length,
    once: options.once,
    dryRun: options.dryRun,
    ingestOnly: options.ingestOnly,
    missionFilter: options.missionFilter ?? null,
    maxExecutions: options.maxExecutions,
  });
  await saveHeartbeat({
    store: autonomy.store,
    clients,
    status: "scanning",
    missionCount: missionIds.length,
    lastScannedBlock: state.lastScannedBlock,
    details: {
      once: options.once,
      dryRun: options.dryRun,
      ingestOnly: options.ingestOnly,
      missionFilter: options.missionFilter ?? null,
    },
  });

  const syncedOutcomes = await syncOutcomesFromEndpoint(autonomy.store, autonomy.config);
  if (syncedOutcomes > 0) {
    console.log("[AutopilotDaemon] Synced resolved outcomes", { count: syncedOutcomes });
  }
  const learningResult = await applyFeedbackLearning(autonomy.store, autonomy.config);
  if (learningResult.scoredCount > 0) {
    console.log("[AutopilotDaemon] Applied feedback learning", learningResult);
  }

  for (const missionId of missionIds) {
    const mission = await clients.publicClient.readContract({
      address: clients.vaultAddress,
      abi: VAULT_ABI,
      functionName: "getMission",
      args: [missionId],
    }) as VaultMission;
    const metadata = parseMissionMetadata(mission.metadataURI);
    const policy = validateMissionPolicy({
      metadata,
      mission,
      relayerFee,
      now,
    });
    if (!policy.ok || !policy.url) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: metadata?.url ?? null,
          question: metadata?.question ?? null,
          cadenceMinutes: policy.cadenceMinutes,
          now,
          skippedReason: policy.reason ?? "mission policy rejected",
        })
      );
      if (options.dryRun) {
        console.log("[AutopilotDaemon] Mission skipped by policy", {
          missionId,
          active: mission.active,
          reason: policy.reason ?? "unknown",
        });
      }
      continue;
    }
    if (!mission.active) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes: policy.cadenceMinutes,
          now,
          skippedReason: "mission inactive",
        })
      );
      if (options.dryRun) {
        console.log("[AutopilotDaemon] Mission skipped: inactive", { missionId });
      }
      continue;
    }

    const cadenceMinutes = policy.cadenceMinutes;
    const lastRunAt = state.lastRunAt[missionId];
    const missionUpdatedAt = Number(mission.updatedAt) * 1000;
    const effectiveLastRunAt =
      lastRunAt ?? (mission.runCount > 0n ? missionUpdatedAt : 0);
    const cadenceDue = now - effectiveLastRunAt >= cadenceMinutes * 60_000;
    await autonomy.store.upsertMissionStatus(
      missionStatus({
        clients,
        missionId,
        mission,
        metadata,
        eventUrl: policy.url,
        question: policy.question,
        cadenceMinutes,
        now,
        effectiveLastRunAt,
        lastRunAt,
      })
    );
    const context = await fetchMissionContext(policy.url);
    if (!context) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now,
          effectiveLastRunAt,
          lastRunAt,
          skippedReason: "no context extracted",
        })
      );
      console.log("[AutopilotDaemon] Mission skipped: no context extracted", {
        missionId,
        eventUrl: policy.url,
      });
      continue;
    }

    const evaluation = await evaluateMissionAutonomy({
      missionId,
      eventUrl: policy.url,
      contextRaw: context,
      store: autonomy.store,
      config: autonomy.config,
      cadenceDue,
    });

    if (options.dryRun) {
      console.log("[AutopilotDaemon] Mission autonomy evaluation", {
        missionId,
        eventUrl: policy.url,
        cadenceDue,
        shouldExecute: evaluation.shouldExecute && !options.ingestOnly,
        executionSource: evaluation.executionSource,
        executionRationale: evaluation.executionRationale,
        triggerTypes: evaluation.createdTriggers.map((trigger) => trigger.type),
        consensusProbability: evaluation.consensus.probability,
        consensusConfidence: evaluation.consensus.confidence,
        consensusEdge: evaluation.consensus.edge,
      });
    }

    if (options.ingestOnly || !evaluation.shouldExecute) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now,
          effectiveLastRunAt,
          lastRunAt,
          skippedReason: options.ingestOnly ? "ingest-only mode" : evaluation.executionRationale,
        })
      );
      if (options.dryRun && !cadenceDue) {
        const dueAt = effectiveLastRunAt + cadenceMinutes * 60_000;
        console.log("[AutopilotDaemon] Mission not executing this scan", {
          missionId,
          eventUrl: policy.url,
          dueInMs: Math.max(0, dueAt - now),
          balance: mission.balance.toString(),
          runCount: mission.runCount.toString(),
        });
      }
      continue;
    }

    if (!options.dryRun && executionCount >= options.maxExecutions) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now,
          effectiveLastRunAt,
          lastRunAt,
          skippedReason: `max executions reached for scan (${options.maxExecutions})`,
        })
      );
      console.log("[AutopilotDaemon] Max executions reached for this scan", {
        maxExecutions: options.maxExecutions,
      });
      break;
    }

    const canExecute = await clients.publicClient.readContract({
      address: clients.vaultAddress,
      abi: VAULT_ABI,
      functionName: "canExecute",
      args: [missionId, relayerFee],
    });
    const [ok, agentFee, runtimeBudget, totalCost, balance] = canExecute;
    if (metadata?.maxTotalSpendWei) {
      const maxTotalSpend = BigInt(metadata.maxTotalSpendWei);
      if (mission.spent + totalCost > maxTotalSpend) {
        await autonomy.store.upsertMissionStatus(
          missionStatus({
            clients,
            missionId,
            mission,
            metadata,
            eventUrl: policy.url,
            question: policy.question,
            cadenceMinutes,
            now,
            effectiveLastRunAt,
            lastRunAt,
            skippedReason: "spend policy cap would be exceeded",
          })
        );
        console.log("[AutopilotDaemon] Mission not executable: spend policy cap would be exceeded", {
          missionId,
          spent: mission.spent.toString(),
          nextCost: totalCost.toString(),
          maxTotalSpend: maxTotalSpend.toString(),
        });
        continue;
      }
    }
    if (!ok) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now,
          effectiveLastRunAt,
          lastRunAt,
          skippedReason: "vault canExecute returned false",
        })
      );
      console.log("[AutopilotDaemon] Mission not executable", {
        missionId,
        agentFee: agentFee.toString(),
        runtimeBudget: runtimeBudget.toString(),
        totalCost: totalCost.toString(),
        balance: balance.toString(),
      });
      continue;
    }

    if (options.dryRun) {
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now,
          effectiveLastRunAt,
          lastRunAt,
          skippedReason: "dry-run executable only",
        })
      );
      console.log("[AutopilotDaemon] Mission executable", {
        missionId,
        eventUrl: policy.url,
        cadenceMinutes,
        executionSource: evaluation.executionSource,
        executionRationale: evaluation.executionRationale,
        agentFee: agentFee.toString(),
        runtimeBudget: runtimeBudget.toString(),
        relayerFee: relayerFee.toString(),
        totalCost: totalCost.toString(),
        balance: balance.toString(),
      });
      continue;
    }

    try {
      await saveHeartbeat({
        store: autonomy.store,
        clients,
        status: "executing",
        missionCount: missionIds.length,
        lastScannedBlock: state.lastScannedBlock,
        details: { missionId, eventUrl: policy.url, executionSource: evaluation.executionSource },
      });
      const missionQuestion = policy.question ?? defaultAsk;
      const result = await executeMission({
        clients,
        missionId,
        eventUrl: policy.url,
        ask: [
          missionQuestion,
          "",
          `Autonomy execution reason: ${evaluation.executionRationale}`,
          `Consensus summary: ${evaluation.consensus.summary}`,
        ].join("\n"),
        question: missionQuestion,
        relayerFeeStt,
        idempotencyScope: evaluation.idempotencyScope,
        cadenceMinutes,
        extraContext: context,
        skipAppContextFetch: true,
      });

      state.lastRunAt[missionId] = Date.now();
      executionCount++;
      saveState(state);

      for (const trigger of evaluation.createdTriggers) {
        await autonomy.store.markTriggerExecuted(
          trigger.id,
          result.executionId?.toString() ?? null,
          result.idempotencyKey
        );
      }
      await autonomy.store.saveContextProvenance({
        contextHash: result.contextHash,
        missionId,
        vaultAddress: clients.vaultAddress,
        eventUrl: policy.url,
        payloadHash: result.payloadHash,
        prophecySnapshotHash: result.prophecySnapshotHash,
        externalSourceUrls: result.sourceUrls,
        researchTimestamp: new Date().toISOString(),
        modelInputSummary: result.modelInputSummary,
        contextBytes: result.contextBytes,
        snapshotId: evaluation.snapshot.id,
      });
      await autonomy.store.saveAutopilotRun({
        id: result.idempotencyKey,
        missionId,
        vaultAddress: clients.vaultAddress,
        eventUrl: policy.url,
        executionId: result.executionId?.toString() ?? null,
        transactionHash: result.hash,
        idempotencyKey: result.idempotencyKey,
        payloadTemplateHash: result.payloadTemplateHash,
        payloadHash: result.payloadHash,
        contextHash: result.contextHash,
        executionSource: evaluation.executionSource,
        executionRationale: evaluation.executionRationale,
        consensus: evaluation.consensus,
        triggerTypes: evaluation.createdTriggers.map((trigger) => trigger.type),
        agentFeeWei: agentFee.toString(),
        runtimeBudgetWei: runtimeBudget.toString(),
        relayerFeeWei: relayerFee.toString(),
        remainingBalanceWei: result.remainingBalance?.toString() ?? null,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      });
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission: {
            ...mission,
            balance: result.remainingBalance ?? balance,
            spent: mission.spent + totalCost,
            runCount: mission.runCount + 1n,
            lastExecutedAt: BigInt(Math.floor(state.lastRunAt[missionId] / 1000)),
            updatedAt: BigInt(Math.floor(state.lastRunAt[missionId] / 1000)),
          },
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now: state.lastRunAt[missionId],
          effectiveLastRunAt: state.lastRunAt[missionId],
          lastRunAt: state.lastRunAt[missionId],
          lastExecutionId: result.executionId?.toString() ?? null,
        })
      );

      console.log("[AutopilotDaemon] Mission executed", {
        missionId,
        executionSource: evaluation.executionSource,
        executionId: result.executionId?.toString() ?? null,
        tx: result.hash,
        idempotencyKey: result.idempotencyKey,
        remainingBalance: result.remainingBalance?.toString() ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const failedRunId = hashId("failed-run", missionId, evaluation.idempotencyScope, Date.now());
      const retryId = hashId("retry", missionId, evaluation.idempotencyScope);
      await autonomy.store.saveAutopilotRun({
        id: failedRunId,
        missionId,
        vaultAddress: clients.vaultAddress,
        eventUrl: policy.url,
        executionId: null,
        transactionHash: null,
        idempotencyKey: ZERO_BYTES32,
        payloadTemplateHash: ZERO_BYTES32,
        payloadHash: ZERO_BYTES32,
        contextHash: evaluation.snapshot.contextHash as `0x${string}`,
        executionSource: evaluation.executionSource,
        executionRationale: evaluation.executionRationale,
        consensus: evaluation.consensus,
        triggerTypes: evaluation.createdTriggers.map((trigger) => trigger.type),
        agentFeeWei: agentFee.toString(),
        runtimeBudgetWei: runtimeBudget.toString(),
        relayerFeeWei: relayerFee.toString(),
        remainingBalanceWei: balance.toString(),
        status: "failed",
        error: msg,
        createdAt: new Date().toISOString(),
      });
      await autonomy.store.saveRetryQueueItem({
        id: retryId,
        missionId,
        vaultAddress: clients.vaultAddress,
        eventUrl: policy.url,
        reason: "execution failed",
        attempts: 1,
        nextRetryAt: new Date(Date.now() + cadenceMinutes * 60_000).toISOString(),
        lastError: msg,
        status: "pending",
        metadata: {
          executionSource: evaluation.executionSource,
          executionRationale: evaluation.executionRationale,
          triggerTypes: evaluation.createdTriggers.map((trigger) => trigger.type),
        },
      });
      await autonomy.store.upsertMissionStatus(
        missionStatus({
          clients,
          missionId,
          mission,
          metadata,
          eventUrl: policy.url,
          question: policy.question,
          cadenceMinutes,
          now: Date.now(),
          effectiveLastRunAt,
          lastRunAt,
          failureReason: msg,
        })
      );
      console.error("[AutopilotDaemon] Mission execution failed", { missionId, error: msg });
    }
  }

  if (!options.dryRun) {
    state.lastSeenMissionScanAt = Date.now();
    saveState(state);
  }
  await saveHeartbeat({
    store: autonomy.store,
    clients,
    status: "idle",
    missionCount: missionIds.length,
    lastScannedBlock: state.lastScannedBlock,
    details: { executionCount },
  });
}

async function main() {
  const args = parseArgs();
  const once = Boolean(args.once);
  const dryRun = Boolean(args["dry-run"] ?? args.dryRun);
  const ingestOnly = Boolean(args["ingest-only"] ?? args.ingestOnly);
  const missionFilter =
    typeof args.mission === "string" && args.mission.startsWith("0x")
      ? (args.mission as `0x${string}`)
      : undefined;
  const maxRaw = typeof args.max === "string" ? Number(args.max) : optionalNumber("AUTOPILOT_MAX_EXECUTIONS_PER_SCAN", 5);
  const maxExecutions = Number.isFinite(maxRaw) ? Math.max(1, Math.floor(maxRaw)) : 5;
  const intervalMs = optionalNumber("AUTOPILOT_DAEMON_INTERVAL_MS", 60_000);
  const state = loadState();
  const options = { once, dryRun, ingestOnly, missionFilter, maxExecutions };
  const autonomyConfig = loadAutonomyConfig();
  const autonomyStore = createAutonomyStore(autonomyConfig);

  console.log("[AutopilotDaemon] Autonomy config", {
    storeMode: autonomyConfig.storeMode,
    localStateFile: autonomyConfig.localStateFile,
    triggerCooldownMs: autonomyConfig.triggerCooldownMs,
    oddsJumpBps: autonomyConfig.oddsJumpBps,
    volumeSpikeMultiplier: autonomyConfig.volumeSpikeMultiplier,
    sentimentDivergenceThreshold: autonomyConfig.sentimentDivergenceThreshold,
    whaleFlowThreshold: autonomyConfig.whaleFlowThreshold,
    minConfidenceToExecute: autonomyConfig.minConfidenceToExecute,
    minEdgeToExecute: autonomyConfig.minEdgeToExecute,
  });

  do {
    await runDueMissions(state, options, {
      store: autonomyStore,
      config: autonomyConfig,
    });
    if (!once) await wait(intervalMs);
  } while (!once);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
