import type { AutonomyConfig } from "./config.ts";
import type { AgentId, ResolvedOutcome, SignalWeights, ThesisRevision, WeightProfile } from "./types.ts";
import type { AutonomyStore } from "./store.ts";
import { defaultSignalWeights, normalizeWeights } from "./store.ts";
import { hashId } from "./utils.ts";

type OutcomePayload = {
  outcomes?: Array<{
    missionId?: string | null;
    eventUrl?: string;
    outcome?: string;
    resolvedAt?: string;
    sourceUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

function outcomeToBinary(outcome: "YES" | "NO"): number {
  return outcome === "YES" ? 1 : 0;
}

function resolveOutcomeForThesis(thesis: ThesisRevision, outcomes: ResolvedOutcome[]): ResolvedOutcome | null {
  const thesisTime = Date.parse(thesis.createdAt);
  const ordered = outcomes
    .filter((outcome) => Date.parse(outcome.resolvedAt) >= thesisTime)
    .sort((a, b) => Date.parse(a.resolvedAt) - Date.parse(b.resolvedAt));
  return ordered[0] ?? outcomes[0] ?? null;
}

function mapVoteToWeightKey(agent: AgentId): keyof SignalWeights | null {
  if (agent === "summary") return null;
  if (agent === "sentiment") return "sentiment";
  if (agent === "statistical") return "statistical";
  if (agent === "onchain") return "onchain";
  if (agent === "contrarian") return "contrarian";
  if (agent === "news") return "news";
  if (agent === "risk") return "risk";
  return null;
}

function updatedWeightsFromThesis(input: {
  current: SignalWeights;
  thesis: ThesisRevision;
  actual: number;
  learningRate: number;
}): SignalWeights {
  const next: SignalWeights = { ...input.current };
  for (const vote of input.thesis.consensus.votes) {
    const key = mapVoteToWeightKey(vote.agent);
    if (!key) continue;
    const error = (vote.probability - input.actual) ** 2;
    const scaled = Math.exp(-input.learningRate * error);
    next[key] = Math.max(0.01, next[key] * scaled);
  }
  return normalizeWeights(next);
}

async function profileForMission(store: AutonomyStore, missionId: `0x${string}`): Promise<WeightProfile> {
  const existing = await store.getWeightProfile(missionId);
  if (existing) return existing;
  return {
    missionId,
    sampleCount: 0,
    updatedAt: new Date(0).toISOString(),
    weights: defaultSignalWeights(),
  };
}

export async function applyFeedbackLearning(
  store: AutonomyStore,
  config: AutonomyConfig
): Promise<{
  scoredCount: number;
  updatedMissions: number;
}> {
  const unscored = await store.listUnscoredTheses(250);
  if (unscored.length === 0) return { scoredCount: 0, updatedMissions: 0 };

  const profiles = new Map<string, WeightProfile>();
  let scoredCount = 0;

  for (const thesis of unscored) {
    const outcomes = await store.listOutcomesForEvent(thesis.eventUrl);
    const resolved = resolveOutcomeForThesis(thesis, outcomes);
    if (!resolved) continue;

    const actual = outcomeToBinary(resolved.resolvedOutcome);
    const brierScore = (thesis.consensus.probability - actual) ** 2;
    await store.markThesisScore({
      thesisId: thesis.id,
      resolvedOutcome: resolved.resolvedOutcome,
      brierScore,
      scoredAt: new Date().toISOString(),
    });
    scoredCount++;

    const profileKey = thesis.missionId;
    const profile = profiles.get(profileKey) ?? (await profileForMission(store, thesis.missionId));
    profile.weights = updatedWeightsFromThesis({
      current: profile.weights,
      thesis,
      actual,
      learningRate: config.learningRate,
    });
    profile.sampleCount += 1;
    profile.updatedAt = new Date().toISOString();
    profiles.set(profileKey, profile);
  }

  for (const profile of profiles.values()) {
    await store.saveWeightProfile(profile);
  }

  return { scoredCount, updatedMissions: profiles.size };
}

function normalizeOutcome(value: string): "YES" | "NO" | null {
  const upper = value.trim().toUpperCase();
  if (upper === "YES") return "YES";
  if (upper === "NO") return "NO";
  return null;
}

export async function syncOutcomesFromEndpoint(
  store: AutonomyStore,
  config: AutonomyConfig
): Promise<number> {
  if (!config.outcomeSyncUrl) return 0;

  try {
    const response = await fetch(config.outcomeSyncUrl, {
      method: "GET",
      headers: config.outcomeSyncApiKey
        ? { Authorization: `Bearer ${config.outcomeSyncApiKey}` }
        : undefined,
    });
    if (!response.ok) return 0;
    const payload = (await response.json()) as OutcomePayload;
    const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
    let saved = 0;

    for (const row of outcomes) {
      if (!row.eventUrl || typeof row.eventUrl !== "string") continue;
      if (!row.outcome || typeof row.outcome !== "string") continue;
      const normalized = normalizeOutcome(row.outcome);
      if (!normalized) continue;
      const outcome: ResolvedOutcome = {
        id: hashId("outcome", row.missionId ?? "global", row.eventUrl, normalized, row.resolvedAt ?? ""),
        missionId:
          typeof row.missionId === "string" && row.missionId.startsWith("0x")
            ? (row.missionId as `0x${string}`)
            : null,
        eventUrl: row.eventUrl,
        resolvedOutcome: normalized,
        resolvedAt: row.resolvedAt ?? new Date().toISOString(),
        sourceUrl: row.sourceUrl ?? null,
        metadata: row.metadata ?? null,
      };
      await store.saveOutcome(outcome);
      saved++;
    }

    return saved;
  } catch {
    return 0;
  }
}

