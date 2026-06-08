import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeEventLog } from "viem";
import { VAULT_ABI, getAutopilotClients, optional, optionalNumber, parseArgs } from "./autopilot-common.ts";
import { createAutonomyStore, loadAutonomyConfig } from "./autonomy/index.ts";
import { startServiceHealthServer } from "./service-health.ts";

type IndexerState = {
  lastScannedBlock: string;
};

const DEFAULT_FROM_BLOCK = 389298380n;

function statePath() {
  return resolve(optional("AUTOPILOT_INDEXER_STATE_FILE") ?? ".autopilot-indexer-state.json");
}

function outputPath() {
  return resolve(optional("AUTOPILOT_RUN_LOG_FILE") ?? ".autopilot-runs.jsonl");
}

function loadState(): IndexerState {
  const fallback = { lastScannedBlock: "0" };
  const file = statePath();
  if (!existsSync(file)) return fallback;

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<IndexerState>;
    return { lastScannedBlock: parsed.lastScannedBlock ?? "0" };
  } catch {
    return fallback;
  }
}

function saveState(state: IndexerState) {
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function wait(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

async function scanOnce(state: IndexerState, persist: boolean) {
  const clients = getAutopilotClients();
  const autonomyConfig = loadAutonomyConfig();
  const autonomyStore = createAutonomyStore(autonomyConfig);
  const configuredStart = BigInt(optional("AUTOPILOT_SCAN_FROM_BLOCK") ?? DEFAULT_FROM_BLOCK.toString());
  const previousCursor = BigInt(state.lastScannedBlock || "0");
  let fromBlock = previousCursor > 0n ? previousCursor + 1n : configuredStart;
  const latest = await clients.publicClient.getBlockNumber();
  const chunkSize = BigInt(Math.max(1, optionalNumber("AUTOPILOT_LOG_CHUNK_SIZE", 900)));
  let indexed = 0;

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
        if (decoded.eventName !== "MissionSpent") continue;

        const record = {
          type: "MissionSpent",
          indexedAt: new Date().toISOString(),
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          missionId: decoded.args.missionId,
          owner: decoded.args.owner,
          agentId: decoded.args.agentId,
          executionId: decoded.args.executionId,
          agentFee: decoded.args.agentFee,
          runtimeBudget: decoded.args.runtimeBudget,
          relayerFee: decoded.args.relayerFee,
          remainingBalance: decoded.args.remainingBalance,
          idempotencyKey: decoded.args.idempotencyKey,
          payloadTemplateHash: decoded.args.payloadTemplateHash,
          payloadHash: decoded.args.payloadHash,
          contextHash: decoded.args.contextHash,
        };

        if (persist) appendFileSync(outputPath(), `${serialize(record)}\n`);
        if (persist) {
          await autonomyStore.saveAutopilotRun({
            id: decoded.args.idempotencyKey,
            missionId: decoded.args.missionId,
            vaultAddress: clients.vaultAddress,
            eventUrl: null,
            executionId: decoded.args.executionId.toString(),
            transactionHash: log.transactionHash ?? null,
            idempotencyKey: decoded.args.idempotencyKey,
            payloadTemplateHash: decoded.args.payloadTemplateHash,
            payloadHash: decoded.args.payloadHash,
            contextHash: decoded.args.contextHash,
            executionSource: null,
            executionRationale: "Indexed from on-chain MissionSpent event.",
            consensus: null,
            triggerTypes: [],
            agentFeeWei: decoded.args.agentFee.toString(),
            runtimeBudgetWei: decoded.args.runtimeBudget.toString(),
            relayerFeeWei: decoded.args.relayerFee.toString(),
            remainingBalanceWei: decoded.args.remainingBalance.toString(),
            status: "confirmed",
            createdAt: new Date().toISOString(),
          });
        }
        indexed++;
      } catch {
        // ignore unrelated logs
      }
    }

    state.lastScannedBlock = toBlock.toString();
    if (persist) saveState(state);
    fromBlock = toBlock + 1n;
  }

  console.log("[AutopilotIndexer] Scan complete", {
    vault: clients.vaultAddress,
    latestBlock: latest.toString(),
    lastScannedBlock: state.lastScannedBlock,
    indexed,
    output: outputPath(),
  });
}

async function main() {
  const args = parseArgs();
  const once = Boolean(args.once);
  const dryRun = Boolean(args["dry-run"] ?? args.dryRun);
  const intervalMs = optionalNumber("AUTOPILOT_INDEXER_INTERVAL_MS", 60_000);
  const state = loadState();
  const health = startServiceHealthServer({
    serviceName: optional("SERVICE_NAME") || "sas-autopilot-indexer",
    getDetails: () => ({
      once,
      dryRun,
      lastScannedBlock: state.lastScannedBlock,
      output: outputPath(),
    }),
  });

  health.ready();
  do {
    try {
      await scanOnce(state, !dryRun);
      health.beat();
    } catch (error) {
      health.error(error);
      throw error;
    }
    if (!once) await wait(intervalMs);
  } while (!once);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
