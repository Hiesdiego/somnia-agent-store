import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AutopilotRunRecord,
  ContextProvenance,
  MarketSnapshot,
  MissionOpsStatus,
  RelayerHeartbeat,
  ResolvedOutcome,
  RetryQueueItem,
  ThesisRevision,
  TriggerEvent,
  WeightProfile,
  SignalWeights,
} from "./types.ts";
import type { AutonomyConfig } from "./config.ts";

type StoreState = {
  snapshots: MarketSnapshot[];
  triggers: TriggerEvent[];
  theses: ThesisRevision[];
  outcomes: ResolvedOutcome[];
  weightProfiles: WeightProfile[];
  heartbeats: RelayerHeartbeat[];
  missionStatuses: MissionOpsStatus[];
  runRecords: AutopilotRunRecord[];
  contextProvenance: ContextProvenance[];
  retryQueue: RetryQueueItem[];
};

export type ThesisScore = {
  thesisId: string;
  resolvedOutcome: "YES" | "NO";
  brierScore: number;
  scoredAt: string;
};

export interface AutonomyStore {
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>;
  listSnapshots(missionId: `0x${string}`, limit: number): Promise<MarketSnapshot[]>;
  saveTrigger(trigger: TriggerEvent): Promise<void>;
  markTriggerExecuted(
    triggerId: string,
    executionId: string | null,
    idempotencyKey: `0x${string}` | null
  ): Promise<void>;
  listRecentTriggers(missionId: `0x${string}`, limit: number): Promise<TriggerEvent[]>;
  saveThesis(revision: ThesisRevision): Promise<void>;
  getLatestThesis(missionId: `0x${string}`): Promise<ThesisRevision | null>;
  listUnscoredTheses(limit: number): Promise<ThesisRevision[]>;
  markThesisScore(score: ThesisScore): Promise<void>;
  saveOutcome(outcome: ResolvedOutcome): Promise<void>;
  listOutcomesForEvent(eventUrl: string): Promise<ResolvedOutcome[]>;
  getWeightProfile(missionId: `0x${string}`): Promise<WeightProfile | null>;
  saveWeightProfile(profile: WeightProfile): Promise<void>;
  saveRelayerHeartbeat(heartbeat: RelayerHeartbeat): Promise<void>;
  upsertMissionStatus(status: MissionOpsStatus): Promise<void>;
  saveAutopilotRun(run: AutopilotRunRecord): Promise<void>;
  saveContextProvenance(record: ContextProvenance): Promise<void>;
  saveRetryQueueItem(item: RetryQueueItem): Promise<void>;
}

function defaultState(): StoreState {
  return {
    snapshots: [],
    triggers: [],
    theses: [],
    outcomes: [],
    weightProfiles: [],
    heartbeats: [],
    missionStatuses: [],
    runRecords: [],
    contextProvenance: [],
    retryQueue: [],
  };
}

export function defaultSignalWeights(): SignalWeights {
  return {
    sentiment: 0.22,
    statistical: 0.24,
    onchain: 0.18,
    contrarian: 0.12,
    news: 0.16,
    risk: 0.08,
  };
}

export function normalizeWeights(weights: SignalWeights): SignalWeights {
  const total =
    weights.sentiment +
    weights.statistical +
    weights.onchain +
    weights.contrarian +
    weights.news +
    weights.risk;
  if (!Number.isFinite(total) || total <= 0) return defaultSignalWeights();
  return {
    sentiment: weights.sentiment / total,
    statistical: weights.statistical / total,
    onchain: weights.onchain / total,
    contrarian: weights.contrarian / total,
    news: weights.news / total,
    risk: weights.risk / total,
  };
}

class LocalFileAutonomyStore implements AutonomyStore {
  private readonly file: string;
  private state: StoreState;

  constructor(filePath: string) {
    this.file = resolve(filePath);
    this.state = this.load();
  }

  private load(): StoreState {
    if (!existsSync(this.file)) return defaultState();
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreState>;
      return {
        snapshots: parsed.snapshots ?? [],
        triggers: parsed.triggers ?? [],
        theses: parsed.theses ?? [],
        outcomes: parsed.outcomes ?? [],
        weightProfiles: parsed.weightProfiles ?? [],
        heartbeats: parsed.heartbeats ?? [],
        missionStatuses: parsed.missionStatuses ?? [],
        runRecords: parsed.runRecords ?? [],
        contextProvenance: parsed.contextProvenance ?? [],
        retryQueue: parsed.retryQueue ?? [],
      };
    } catch {
      return defaultState();
    }
  }

  private persist() {
    writeFileSync(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    if (this.state.snapshots.some((item) => item.id === snapshot.id)) return;
    this.state.snapshots.push(snapshot);
    this.persist();
  }

  async listSnapshots(missionId: `0x${string}`, limit: number): Promise<MarketSnapshot[]> {
    return this.state.snapshots
      .filter((snapshot) => snapshot.missionId === missionId)
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
      .slice(0, limit);
  }

  async saveTrigger(trigger: TriggerEvent): Promise<void> {
    if (this.state.triggers.some((item) => item.id === trigger.id)) return;
    this.state.triggers.push(trigger);
    this.persist();
  }

  async markTriggerExecuted(
    triggerId: string,
    executionId: string | null,
    idempotencyKey: `0x${string}` | null
  ): Promise<void> {
    const index = this.state.triggers.findIndex((trigger) => trigger.id === triggerId);
    if (index < 0) return;
    this.state.triggers[index] = {
      ...this.state.triggers[index],
      executionRequested: true,
      executionId,
      idempotencyKey,
    };
    this.persist();
  }

  async listRecentTriggers(missionId: `0x${string}`, limit: number): Promise<TriggerEvent[]> {
    return this.state.triggers
      .filter((trigger) => trigger.missionId === missionId)
      .sort((a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt))
      .slice(0, limit);
  }

  async saveThesis(revision: ThesisRevision): Promise<void> {
    if (this.state.theses.some((item) => item.id === revision.id)) return;
    this.state.theses.push(revision);
    this.persist();
  }

  async getLatestThesis(missionId: `0x${string}`): Promise<ThesisRevision | null> {
    const match = this.state.theses
      .filter((thesis) => thesis.missionId === missionId)
      .sort((a, b) => b.revision - a.revision)[0];
    return match ?? null;
  }

  async listUnscoredTheses(limit: number): Promise<ThesisRevision[]> {
    return this.state.theses
      .filter((thesis) => !thesis.scoredAt)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit);
  }

  async markThesisScore(score: ThesisScore): Promise<void> {
    const index = this.state.theses.findIndex((thesis) => thesis.id === score.thesisId);
    if (index < 0) return;
    this.state.theses[index] = {
      ...this.state.theses[index],
      resolvedOutcome: score.resolvedOutcome,
      brierScore: score.brierScore,
      scoredAt: score.scoredAt,
    };
    this.persist();
  }

  async saveOutcome(outcome: ResolvedOutcome): Promise<void> {
    if (this.state.outcomes.some((item) => item.id === outcome.id)) return;
    this.state.outcomes.push(outcome);
    this.persist();
  }

  async listOutcomesForEvent(eventUrl: string): Promise<ResolvedOutcome[]> {
    return this.state.outcomes
      .filter((outcome) => outcome.eventUrl === eventUrl)
      .sort((a, b) => Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt));
  }

  async getWeightProfile(missionId: `0x${string}`): Promise<WeightProfile | null> {
    const byMission = this.state.weightProfiles
      .filter((profile) => profile.missionId === missionId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    if (byMission) return byMission;

    const global = this.state.weightProfiles
      .filter((profile) => profile.missionId === "global")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    return global ?? null;
  }

  async saveWeightProfile(profile: WeightProfile): Promise<void> {
    this.state.weightProfiles.push({
      ...profile,
      weights: normalizeWeights(profile.weights),
    });
    this.persist();
  }

  async saveRelayerHeartbeat(heartbeat: RelayerHeartbeat): Promise<void> {
    const index = this.state.heartbeats.findIndex((item) => item.relayerId === heartbeat.relayerId);
    if (index >= 0) this.state.heartbeats[index] = heartbeat;
    else this.state.heartbeats.push(heartbeat);
    this.persist();
  }

  async upsertMissionStatus(status: MissionOpsStatus): Promise<void> {
    const index = this.state.missionStatuses.findIndex((item) => item.missionId === status.missionId);
    if (index >= 0) this.state.missionStatuses[index] = status;
    else this.state.missionStatuses.push(status);
    this.persist();
  }

  async saveAutopilotRun(run: AutopilotRunRecord): Promise<void> {
    const index = this.state.runRecords.findIndex((item) => item.id === run.id);
    if (index >= 0) this.state.runRecords[index] = run;
    else this.state.runRecords.push(run);
    this.persist();
  }

  async saveContextProvenance(record: ContextProvenance): Promise<void> {
    const index = this.state.contextProvenance.findIndex((item) => item.contextHash === record.contextHash);
    if (index >= 0) this.state.contextProvenance[index] = record;
    else this.state.contextProvenance.push(record);
    this.persist();
  }

  async saveRetryQueueItem(item: RetryQueueItem): Promise<void> {
    const index = this.state.retryQueue.findIndex((entry) => entry.id === item.id);
    if (index >= 0) this.state.retryQueue[index] = item;
    else this.state.retryQueue.push(item);
    this.persist();
  }
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase SELECT ${table} failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T[];
  }

  async insert<T>(table: string, rows: T[]): Promise<void> {
    if (rows.length === 0) return;
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase INSERT ${table} failed (${response.status}): ${body}`);
    }
  }

  async upsert<T>(table: string, rows: T[], conflictTarget: string): Promise<void> {
    if (rows.length === 0) return;
    const response = await fetch(this.endpoint(`${table}?on_conflict=${conflictTarget}`), {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
        "Content-Profile": this.schema,
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase UPSERT ${table} failed (${response.status}): ${body}`);
    }
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase UPDATE ${table} failed (${response.status}): ${body}`);
    }
  }
}

class SupabaseAutonomyStore implements AutonomyStore {
  private readonly client: SupabasePostgrestClient;

  constructor(config: AutonomyConfig) {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error("Supabase mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    this.client = new SupabasePostgrestClient(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      config.supabaseSchema
    );
  }

  async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    await this.client.insert("pc_market_snapshots", [
      {
        id: snapshot.id,
        mission_id: snapshot.missionId,
        event_url: snapshot.eventUrl,
        event_id: snapshot.eventId,
        captured_at: snapshot.capturedAt,
        context_hash: snapshot.contextHash,
        context_raw: snapshot.contextRaw,
        signals: snapshot.signals,
      },
    ]);
  }

  async listSnapshots(missionId: `0x${string}`, limit: number): Promise<MarketSnapshot[]> {
    const rows = await this.client.select<{
      id: string;
      mission_id: `0x${string}`;
      event_url: string;
      event_id: string | null;
      captured_at: string;
      context_hash: string;
      context_raw: string;
      signals: MarketSnapshot["signals"];
    }>("pc_market_snapshots", `mission_id=eq.${missionId}&order=captured_at.desc&limit=${limit}`);

    return rows.map((row) => ({
      id: row.id,
      missionId: row.mission_id,
      eventUrl: row.event_url,
      eventId: row.event_id,
      capturedAt: row.captured_at,
      contextHash: row.context_hash,
      contextRaw: row.context_raw,
      signals: row.signals,
    }));
  }

  async saveTrigger(trigger: TriggerEvent): Promise<void> {
    await this.client.insert("pc_trigger_history", [
      {
        id: trigger.id,
        mission_id: trigger.missionId,
        event_url: trigger.eventUrl,
        trigger_type: trigger.type,
        triggered_at: trigger.triggeredAt,
        severity: trigger.severity,
        details: trigger.details,
        execution_requested: trigger.executionRequested,
        execution_id: trigger.executionId ?? null,
        idempotency_key: trigger.idempotencyKey ?? null,
      },
    ]);
  }

  async markTriggerExecuted(
    triggerId: string,
    executionId: string | null,
    idempotencyKey: `0x${string}` | null
  ): Promise<void> {
    await this.client.update(`pc_trigger_history`, `id=eq.${triggerId}`, {
      execution_requested: true,
      execution_id: executionId,
      idempotency_key: idempotencyKey,
    });
  }

  async listRecentTriggers(missionId: `0x${string}`, limit: number): Promise<TriggerEvent[]> {
    const rows = await this.client.select<{
      id: string;
      mission_id: `0x${string}`;
      event_url: string;
      trigger_type: TriggerEvent["type"];
      triggered_at: string;
      severity: number;
      details: Record<string, unknown>;
      execution_requested: boolean;
      execution_id: string | null;
      idempotency_key: `0x${string}` | null;
    }>("pc_trigger_history", `mission_id=eq.${missionId}&order=triggered_at.desc&limit=${limit}`);

    return rows.map((row) => ({
      id: row.id,
      missionId: row.mission_id,
      eventUrl: row.event_url,
      type: row.trigger_type,
      triggeredAt: row.triggered_at,
      severity: row.severity,
      details: row.details,
      executionRequested: row.execution_requested,
      executionId: row.execution_id,
      idempotencyKey: row.idempotency_key,
    }));
  }

  async saveThesis(revision: ThesisRevision): Promise<void> {
    await this.client.insert("pc_thesis_revisions", [
      {
        id: revision.id,
        mission_id: revision.missionId,
        event_url: revision.eventUrl,
        snapshot_id: revision.snapshotId,
        revision: revision.revision,
        created_at: revision.createdAt,
        consensus: revision.consensus,
        active_triggers: revision.activeTriggers,
        hypothesis: revision.hypothesis,
        execution_source: revision.executionSource,
        execution_id: revision.executionId ?? null,
        resolved_outcome: revision.resolvedOutcome ?? null,
        scored_at: revision.scoredAt ?? null,
        brier_score: revision.brierScore ?? null,
      },
    ]);
  }

  async getLatestThesis(missionId: `0x${string}`): Promise<ThesisRevision | null> {
    const rows = await this.client.select<{
      id: string;
      mission_id: `0x${string}`;
      event_url: string;
      snapshot_id: string;
      revision: number;
      created_at: string;
      consensus: ThesisRevision["consensus"];
      active_triggers: TriggerEvent["type"][];
      hypothesis: string;
      execution_source: ThesisRevision["executionSource"];
      execution_id: string | null;
      resolved_outcome: "YES" | "NO" | null;
      scored_at: string | null;
      brier_score: number | null;
    }>("pc_thesis_revisions", `mission_id=eq.${missionId}&order=revision.desc&limit=1`);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      missionId: row.mission_id,
      eventUrl: row.event_url,
      snapshotId: row.snapshot_id,
      revision: row.revision,
      createdAt: row.created_at,
      consensus: row.consensus,
      activeTriggers: row.active_triggers ?? [],
      hypothesis: row.hypothesis,
      executionSource: row.execution_source,
      executionId: row.execution_id,
      resolvedOutcome: row.resolved_outcome,
      scoredAt: row.scored_at,
      brierScore: row.brier_score,
    };
  }

  async listUnscoredTheses(limit: number): Promise<ThesisRevision[]> {
    const rows = await this.client.select<{
      id: string;
      mission_id: `0x${string}`;
      event_url: string;
      snapshot_id: string;
      revision: number;
      created_at: string;
      consensus: ThesisRevision["consensus"];
      active_triggers: TriggerEvent["type"][];
      hypothesis: string;
      execution_source: ThesisRevision["executionSource"];
      execution_id: string | null;
      resolved_outcome: "YES" | "NO" | null;
      scored_at: string | null;
      brier_score: number | null;
    }>("pc_thesis_revisions", `scored_at=is.null&order=created_at.asc&limit=${limit}`);

    return rows.map((row) => ({
      id: row.id,
      missionId: row.mission_id,
      eventUrl: row.event_url,
      snapshotId: row.snapshot_id,
      revision: row.revision,
      createdAt: row.created_at,
      consensus: row.consensus,
      activeTriggers: row.active_triggers ?? [],
      hypothesis: row.hypothesis,
      executionSource: row.execution_source,
      executionId: row.execution_id,
      resolvedOutcome: row.resolved_outcome,
      scoredAt: row.scored_at,
      brierScore: row.brier_score,
    }));
  }

  async markThesisScore(score: ThesisScore): Promise<void> {
    await this.client.update(`pc_thesis_revisions`, `id=eq.${score.thesisId}`, {
      resolved_outcome: score.resolvedOutcome,
      brier_score: score.brierScore,
      scored_at: score.scoredAt,
    });
  }

  async saveOutcome(outcome: ResolvedOutcome): Promise<void> {
    await this.client.insert("pc_resolved_outcomes", [
      {
        id: outcome.id,
        mission_id: outcome.missionId,
        event_url: outcome.eventUrl,
        resolved_outcome: outcome.resolvedOutcome,
        resolved_at: outcome.resolvedAt,
        source_url: outcome.sourceUrl ?? null,
        metadata: outcome.metadata ?? null,
      },
    ]);
  }

  async listOutcomesForEvent(eventUrl: string): Promise<ResolvedOutcome[]> {
    const rows = await this.client.select<{
      id: string;
      mission_id: `0x${string}` | null;
      event_url: string;
      resolved_outcome: "YES" | "NO";
      resolved_at: string;
      source_url: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      "pc_resolved_outcomes",
      `event_url=eq.${encodeURIComponent(eventUrl)}&order=resolved_at.desc&limit=20`
    );

    return rows.map((row) => ({
      id: row.id,
      missionId: row.mission_id,
      eventUrl: row.event_url,
      resolvedOutcome: row.resolved_outcome,
      resolvedAt: row.resolved_at,
      sourceUrl: row.source_url,
      metadata: row.metadata,
    }));
  }

  async getWeightProfile(missionId: `0x${string}`): Promise<WeightProfile | null> {
    const missionRows = await this.client.select<{
      id: string;
      mission_id: `0x${string}` | "global";
      updated_at: string;
      sample_count: number;
      weights: SignalWeights;
    }>("pc_signal_weights", `mission_id=eq.${missionId}&order=updated_at.desc&limit=1`);
    const row = missionRows[0];
    if (row) {
      return {
        missionId: row.mission_id,
        updatedAt: row.updated_at,
        sampleCount: row.sample_count,
        weights: normalizeWeights(row.weights),
      };
    }

    const globalRows = await this.client.select<{
      mission_id: `0x${string}` | "global";
      updated_at: string;
      sample_count: number;
      weights: SignalWeights;
    }>("pc_signal_weights", `mission_id=eq.global&order=updated_at.desc&limit=1`);
    const global = globalRows[0];
    if (!global) return null;
    return {
      missionId: global.mission_id,
      updatedAt: global.updated_at,
      sampleCount: global.sample_count,
      weights: normalizeWeights(global.weights),
    };
  }

  async saveWeightProfile(profile: WeightProfile): Promise<void> {
    await this.client.insert("pc_signal_weights", [
      {
        id: `${profile.missionId}:${profile.updatedAt}`,
        mission_id: profile.missionId,
        updated_at: profile.updatedAt,
        sample_count: profile.sampleCount,
        weights: normalizeWeights(profile.weights),
      },
    ]);
  }

  async saveRelayerHeartbeat(heartbeat: RelayerHeartbeat): Promise<void> {
    await this.client.upsert("pc_relayer_heartbeats", [
      {
        relayer_id: heartbeat.relayerId,
        vault_address: heartbeat.vaultAddress,
        relayer_address: heartbeat.relayerAddress,
        status: heartbeat.status,
        last_seen_at: heartbeat.lastSeenAt,
        mission_count: heartbeat.missionCount,
        last_scanned_block: heartbeat.lastScannedBlock ?? null,
        wallet_balance_wei: heartbeat.walletBalanceWei ?? null,
        details: heartbeat.details,
        updated_at: new Date().toISOString(),
      },
    ], "relayer_id");
  }

  async upsertMissionStatus(status: MissionOpsStatus): Promise<void> {
    await this.client.upsert("pc_mission_status", [
      {
        mission_id: status.missionId,
        vault_address: status.vaultAddress,
        event_url: status.eventUrl ?? null,
        question: status.question ?? null,
        active: status.active,
        balance_wei: status.balanceWei,
        spent_wei: status.spentWei,
        run_count: status.runCount,
        max_runs: status.maxRuns ?? null,
        expires_at: status.expiresAt ?? null,
        next_due_at: status.nextDueAt ?? null,
        last_scan_at: status.lastScanAt ?? null,
        last_run_at: status.lastRunAt ?? null,
        last_skipped_reason: status.lastSkippedReason ?? null,
        last_failure_reason: status.lastFailureReason ?? null,
        last_execution_id: status.lastExecutionId ?? null,
        policy_hashes: status.policyHashes,
        metadata: status.metadata,
        updated_at: new Date().toISOString(),
      },
    ], "mission_id");
  }

  async saveAutopilotRun(run: AutopilotRunRecord): Promise<void> {
    await this.client.upsert("pc_autopilot_runs", [
      {
        id: run.id,
        mission_id: run.missionId,
        vault_address: run.vaultAddress,
        event_url: run.eventUrl ?? null,
        execution_id: run.executionId ?? null,
        transaction_hash: run.transactionHash ?? null,
        idempotency_key: run.idempotencyKey,
        payload_template_hash: run.payloadTemplateHash,
        payload_hash: run.payloadHash,
        context_hash: run.contextHash,
        execution_source: run.executionSource ?? null,
        execution_rationale: run.executionRationale ?? null,
        consensus: run.consensus ?? null,
        trigger_types: run.triggerTypes,
        agent_fee_wei: run.agentFeeWei ?? null,
        runtime_budget_wei: run.runtimeBudgetWei ?? null,
        relayer_fee_wei: run.relayerFeeWei ?? null,
        remaining_balance_wei: run.remainingBalanceWei ?? null,
        status: run.status,
        error: run.error ?? null,
        created_at: run.createdAt,
        updated_at: new Date().toISOString(),
      },
    ], "id");
  }

  async saveContextProvenance(record: ContextProvenance): Promise<void> {
    await this.client.upsert("pc_context_provenance", [
      {
        context_hash: record.contextHash,
        mission_id: record.missionId,
        vault_address: record.vaultAddress,
        event_url: record.eventUrl,
        payload_hash: record.payloadHash ?? null,
        prophecy_snapshot_hash: record.prophecySnapshotHash,
        external_source_urls: record.externalSourceUrls,
        research_timestamp: record.researchTimestamp,
        model_input_summary: record.modelInputSummary,
        context_bytes: record.contextBytes,
        snapshot_id: record.snapshotId ?? null,
      },
    ], "context_hash");
  }

  async saveRetryQueueItem(item: RetryQueueItem): Promise<void> {
    await this.client.upsert("pc_retry_queue", [
      {
        id: item.id,
        mission_id: item.missionId,
        vault_address: item.vaultAddress,
        event_url: item.eventUrl ?? null,
        reason: item.reason,
        attempts: item.attempts,
        next_retry_at: item.nextRetryAt ?? null,
        last_error: item.lastError ?? null,
        status: item.status,
        metadata: item.metadata,
        updated_at: new Date().toISOString(),
      },
    ], "id");
  }
}

class ResilientAutonomyStore implements AutonomyStore {
  constructor(
    private readonly primary: AutonomyStore,
    private readonly fallback: AutonomyStore
  ) {}

  private async withReadFallback<T>(operation: string, fn: (store: AutonomyStore) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AutonomyStore] Primary read failed (${operation}). Falling back.`, message);
      return fn(this.fallback);
    }
  }

  private async withWriteFallback(operation: string, fn: (store: AutonomyStore) => Promise<void>): Promise<void> {
    try {
      await fn(this.primary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AutonomyStore] Primary write failed (${operation}). Writing fallback only.`, message);
    }
    await fn(this.fallback);
  }

  saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    return this.withWriteFallback("saveSnapshot", (store) => store.saveSnapshot(snapshot));
  }

  listSnapshots(missionId: `0x${string}`, limit: number): Promise<MarketSnapshot[]> {
    return this.withReadFallback("listSnapshots", (store) => store.listSnapshots(missionId, limit));
  }

  saveTrigger(trigger: TriggerEvent): Promise<void> {
    return this.withWriteFallback("saveTrigger", (store) => store.saveTrigger(trigger));
  }

  markTriggerExecuted(
    triggerId: string,
    executionId: string | null,
    idempotencyKey: `0x${string}` | null
  ): Promise<void> {
    return this.withWriteFallback("markTriggerExecuted", (store) =>
      store.markTriggerExecuted(triggerId, executionId, idempotencyKey)
    );
  }

  listRecentTriggers(missionId: `0x${string}`, limit: number): Promise<TriggerEvent[]> {
    return this.withReadFallback("listRecentTriggers", (store) => store.listRecentTriggers(missionId, limit));
  }

  saveThesis(revision: ThesisRevision): Promise<void> {
    return this.withWriteFallback("saveThesis", (store) => store.saveThesis(revision));
  }

  getLatestThesis(missionId: `0x${string}`): Promise<ThesisRevision | null> {
    return this.withReadFallback("getLatestThesis", (store) => store.getLatestThesis(missionId));
  }

  listUnscoredTheses(limit: number): Promise<ThesisRevision[]> {
    return this.withReadFallback("listUnscoredTheses", (store) => store.listUnscoredTheses(limit));
  }

  markThesisScore(score: ThesisScore): Promise<void> {
    return this.withWriteFallback("markThesisScore", (store) => store.markThesisScore(score));
  }

  saveOutcome(outcome: ResolvedOutcome): Promise<void> {
    return this.withWriteFallback("saveOutcome", (store) => store.saveOutcome(outcome));
  }

  listOutcomesForEvent(eventUrl: string): Promise<ResolvedOutcome[]> {
    return this.withReadFallback("listOutcomesForEvent", (store) => store.listOutcomesForEvent(eventUrl));
  }

  getWeightProfile(missionId: `0x${string}`): Promise<WeightProfile | null> {
    return this.withReadFallback("getWeightProfile", (store) => store.getWeightProfile(missionId));
  }

  saveWeightProfile(profile: WeightProfile): Promise<void> {
    return this.withWriteFallback("saveWeightProfile", (store) => store.saveWeightProfile(profile));
  }

  saveRelayerHeartbeat(heartbeat: RelayerHeartbeat): Promise<void> {
    return this.withWriteFallback("saveRelayerHeartbeat", (store) => store.saveRelayerHeartbeat(heartbeat));
  }

  upsertMissionStatus(status: MissionOpsStatus): Promise<void> {
    return this.withWriteFallback("upsertMissionStatus", (store) => store.upsertMissionStatus(status));
  }

  saveAutopilotRun(run: AutopilotRunRecord): Promise<void> {
    return this.withWriteFallback("saveAutopilotRun", (store) => store.saveAutopilotRun(run));
  }

  saveContextProvenance(record: ContextProvenance): Promise<void> {
    return this.withWriteFallback("saveContextProvenance", (store) => store.saveContextProvenance(record));
  }

  saveRetryQueueItem(item: RetryQueueItem): Promise<void> {
    return this.withWriteFallback("saveRetryQueueItem", (store) => store.saveRetryQueueItem(item));
  }
}

export function createAutonomyStore(config: AutonomyConfig): AutonomyStore {
  const local = new LocalFileAutonomyStore(config.localStateFile);
  if (config.storeMode !== "supabase") return local;
  const supabase = new SupabaseAutonomyStore(config);
  return new ResilientAutonomyStore(supabase, local);
}
