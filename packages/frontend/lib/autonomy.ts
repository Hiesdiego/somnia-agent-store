export type AutonomyTriggerKind = "manual" | "schedule" | "market_change" | "webhook";

export type AutonomyTrigger = {
  kind: AutonomyTriggerKind;
  cadenceMinutes?: number;
  watchedUrl?: string;
  minChangeBps?: number;
};

export type AgentMission = {
  missionId: string;
  appId: string;
  agentId: bigint;
  owner: `0x${string}` | string;
  title: string;
  objective: string;
  trigger: AutonomyTrigger;
  maxSpendPerRunWei: bigint;
  maxRunsPerDay: number;
  enabled: boolean;
  createdAt: number;
};

export type SponsoredExecutionRequest = {
  missionId: string;
  agentId: bigint;
  payload: `0x${string}`;
  idempotencyKey: string;
  maxFeeWei: bigint;
  userReference?: string;
};

export function buildAutonomyIdempotencyKey(params: {
  missionId: string;
  agentId: bigint;
  triggerKind: AutonomyTriggerKind;
  timeBucket: string;
}) {
  return [
    "sas",
    "mission",
    params.missionId,
    params.agentId.toString(),
    params.triggerKind,
    params.timeBucket,
  ].join(":");
}

export function shouldRunScheduledMission(mission: AgentMission, lastRunAt: number | null, now = Date.now()) {
  if (!mission.enabled || mission.trigger.kind !== "schedule") return false;
  const cadence = Math.max(1, mission.trigger.cadenceMinutes ?? 60) * 60_000;
  return !lastRunAt || now - lastRunAt >= cadence;
}

export function assertSponsoredExecutionWithinMission(
  mission: AgentMission,
  request: SponsoredExecutionRequest
) {
  if (!mission.enabled) throw new Error("Mission is disabled.");
  if (mission.agentId !== request.agentId) throw new Error("Sponsored request agent mismatch.");
  if (request.maxFeeWei > mission.maxSpendPerRunWei) {
    throw new Error("Sponsored request exceeds mission spend cap.");
  }
  if (!request.idempotencyKey.startsWith(`sas:mission:${mission.missionId}:`)) {
    throw new Error("Invalid mission idempotency key.");
  }
}
