import "dotenv/config";
import { createPublicClient, createWalletClient, http, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SOMNIA_TESTNET } from "./blockchain/chains.js";
import { loadRunnerConfig, startAutonomyRunner } from "./autonomy/runner.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("SAS v0.1 Autonomy Runner starting...");
  const config = loadRunnerConfig(process.env);
  const account = privateKeyToAccount(config.runnerPrivateKey);

  const publicClient = createPublicClient({
    chain: SOMNIA_TESTNET,
    transport: webSocket(config.wsRpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: SOMNIA_TESTNET,
    transport: http(config.rpcUrl),
  });

  const runnerBalance = await publicClient.getBalance({ address: account.address });
  const chainId = await publicClient.getChainId();
  if (chainId !== config.expectedChainId) {
    throw new Error(
      `Runner connected to unexpected chainId=${chainId}; expected ${config.expectedChainId}`
    );
  }
  if (runnerBalance === 0n) {
    logger.error(`Runner wallet has 0 STT. Fund ${account.address} on testnet before orchestration.`);
  }

  logger.info(`Runner wallet: ${account.address}`);
  logger.info(`Autonomy contract: ${config.autonomyAddress}`);
  logger.info(`Expected chainId: ${config.expectedChainId}`);
  logger.info(`Delegation mode: automatic (max delegates: ${config.defaultMaxDelegates})`);
  logger.info(`Workflow metadata kinds: ${config.metadataKinds.join(", ")}`);

  const stop = await startAutonomyRunner({
    publicClient,
    walletClient,
    account,
    config,
  });

  logger.info("Autonomy runner active - watching SAS v0.1 workflows");

  process.on("SIGINT", () => {
    stop();
    logger.info("Shutting down autonomy runner...");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    logger.info("Shutting down autonomy runner...");
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Runner crashed:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error}`);
});
