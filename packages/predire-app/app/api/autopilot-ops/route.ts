import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rateLimit } from "@/lib/server/security";

export const runtime = "nodejs";

function readEnvFileValue(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    if (trimmed.slice(0, index).trim() !== key) continue;
    return trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function serverEnv(name: string): string | undefined {
  return (
    process.env[name]?.trim() ||
    readEnvFileValue(resolve(process.cwd(), "../companion-agent-sdk/.env"), name)
  );
}

const SUPABASE_URL = serverEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_SCHEMA = serverEnv("SUPABASE_SCHEMA") || "public";

type QueryOptions = {
  missionId?: string | null;
  vaultAddress?: string | null;
  limit?: number;
};

function endpoint(table: string, query: string): string {
  return `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
}

async function selectTable<T>(table: string, query: string): Promise<T[]> {
  const response = await fetch(endpoint(table, query), {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": SUPABASE_SCHEMA,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} query failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T[];
}

function appendMissionFilter(params: string[], column: string, missionId?: string | null) {
  if (missionId && /^0x[a-fA-F0-9]{64}$/.test(missionId)) params.push(`${column}=eq.${missionId}`);
}

function appendVaultFilter(params: string[], column: string, vaultAddress?: string | null) {
  if (vaultAddress && /^0x[a-fA-F0-9]{40}$/.test(vaultAddress)) params.push(`${column}=eq.${vaultAddress}`);
}

async function loadOpsData(options: QueryOptions) {
  const limit = Math.max(1, Math.min(100, options.limit ?? 40));
  const missionParams = ["select=*", "order=updated_at.desc", `limit=${limit}`];
  const runParams = ["select=*", "order=created_at.desc", `limit=${limit}`];
  const contextParams = ["select=*", "order=research_timestamp.desc", `limit=${limit}`];
  const triggerParams = ["select=*", "order=triggered_at.desc", `limit=${limit}`];
  const snapshotParams = ["select=*", "order=captured_at.desc", `limit=${limit}`];
  const thesisParams = ["select=*", "order=created_at.desc", `limit=${limit}`];
  const retryParams = ["select=*", "order=updated_at.desc", `limit=${limit}`];
  const heartbeatParams = ["select=*", "order=last_seen_at.desc", "limit=10"];
  const traderStrategyParams = ["select=*", "order=updated_at.desc", `limit=${limit}`];
  const traderCycleParams = ["select=*", "order=created_at.desc", `limit=${limit}`];
  const traderPositionParams = ["select=*", "order=placed_at.desc", `limit=${limit}`];

  appendMissionFilter(missionParams, "mission_id", options.missionId);
  appendMissionFilter(runParams, "mission_id", options.missionId);
  appendMissionFilter(contextParams, "mission_id", options.missionId);
  appendMissionFilter(triggerParams, "mission_id", options.missionId);
  appendMissionFilter(snapshotParams, "mission_id", options.missionId);
  appendMissionFilter(thesisParams, "mission_id", options.missionId);
  appendMissionFilter(retryParams, "mission_id", options.missionId);
  appendMissionFilter(traderStrategyParams, "mission_id", options.missionId);
  appendMissionFilter(traderCycleParams, "mission_id", options.missionId);
  appendMissionFilter(traderPositionParams, "mission_id", options.missionId);

  appendVaultFilter(missionParams, "vault_address", options.vaultAddress);
  appendVaultFilter(runParams, "vault_address", options.vaultAddress);
  appendVaultFilter(contextParams, "vault_address", options.vaultAddress);
  appendVaultFilter(retryParams, "vault_address", options.vaultAddress);
  appendVaultFilter(heartbeatParams, "vault_address", options.vaultAddress);
  appendVaultFilter(traderStrategyParams, "vault_address", options.vaultAddress);
  appendVaultFilter(traderCycleParams, "vault_address", options.vaultAddress);

  const [heartbeats, missions, runs, contexts, triggers, snapshots, theses, retries, traderStrategies, traderCycles, traderPositions] =
    await Promise.all([
      selectTable("pc_relayer_heartbeats", heartbeatParams.join("&")),
      selectTable("pc_mission_status", missionParams.join("&")),
      selectTable("pc_autopilot_runs", runParams.join("&")),
      selectTable("pc_context_provenance", contextParams.join("&")),
      selectTable("pc_trigger_history", triggerParams.join("&")),
      selectTable("pc_market_snapshots", snapshotParams.join("&")),
      selectTable("pc_thesis_revisions", thesisParams.join("&")),
      selectTable("pc_retry_queue", retryParams.join("&")),
      selectTable("pc_trader_strategies", traderStrategyParams.join("&")),
      selectTable("pc_trader_cycles", traderCycleParams.join("&")),
      selectTable("pc_trader_positions", traderPositionParams.join("&")),
    ]);

  return {
    configured: true,
    generatedAt: new Date().toISOString(),
    heartbeats,
    missions,
    runs,
    contexts,
    triggers,
    snapshots,
    theses,
    retries,
    traderStrategies,
    traderCycles,
    traderPositions,
  };
}

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "autopilot-ops", 60, 60_000);
  if (limited) return limited;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({
      configured: false,
      generatedAt: new Date().toISOString(),
      heartbeats: [],
      missions: [],
      runs: [],
      contexts: [],
      triggers: [],
      snapshots: [],
      theses: [],
      retries: [],
      traderStrategies: [],
      traderCycles: [],
      traderPositions: [],
    });
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "40");
    return NextResponse.json(
      await loadOpsData({
        missionId: url.searchParams.get("missionId"),
        vaultAddress: url.searchParams.get("vaultAddress"),
        limit: Number.isFinite(limit) ? limit : 40,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
