import "dotenv/config";
import { loadAutonomyConfig, createAutonomyStore, type ResolvedOutcome } from "./autonomy/index.ts";
import { parseArgs } from "./autopilot-common.ts";
import { hashId, normalizeUrl } from "./autonomy/utils.ts";

function requiredString(value: string | boolean | undefined, name: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Missing required argument: --${name}`);
}

function normalizeOutcome(value: string): "YES" | "NO" {
  const upper = value.trim().toUpperCase();
  if (upper === "YES") return "YES";
  if (upper === "NO") return "NO";
  throw new Error("Outcome must be YES or NO.");
}

async function main() {
  const args = parseArgs();
  const url = normalizeUrl(requiredString(args.url ?? args.eventUrl, "url"));
  const outcome = normalizeOutcome(requiredString(args.outcome, "outcome"));
  const missionRaw = typeof args.mission === "string" ? args.mission : undefined;
  const missionId =
    missionRaw && missionRaw.startsWith("0x") ? (missionRaw as `0x${string}`) : null;
  const resolvedAt =
    (typeof args.resolvedAt === "string" && args.resolvedAt.trim()) ||
    new Date().toISOString();
  const sourceUrl = typeof args.sourceUrl === "string" ? args.sourceUrl.trim() : null;

  const config = loadAutonomyConfig();
  const store = createAutonomyStore(config);

  const record: ResolvedOutcome = {
    id: hashId("manual-outcome", missionId ?? "global", url, outcome, resolvedAt),
    missionId,
    eventUrl: url,
    resolvedOutcome: outcome,
    resolvedAt,
    sourceUrl,
    metadata: {
      source: "manual-cli",
    },
  };

  await store.saveOutcome(record);
  console.log("[AutonomyOutcome] Saved resolved outcome", record);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

