import "dotenv/config";
import { createPublicClient, defineChain, getAddress, http, parseAbiItem } from "viem";

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.SOMNIA_RPC_URL || "https://api.infra.testnet.somnia.network"],
    },
  },
});

const registryAddress = getAddress(
  process.env.SAS_REGISTRY_ADDRESS || "0x25029648D4dDaE085c8db865582F43Bce2857766"
);
const billingAddress = getAddress(
  process.env.SAS_BILLING_ADDRESS || "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03"
);

const client = createPublicClient({
  chain: somniaTestnet,
  transport: http(somniaTestnet.rpcUrls.default.http[0]),
});

const agentRegisteredEvent = parseAbiItem(
  "event AgentRegistered(uint256 indexed agentId, address indexed builder, string name, uint8 agentType, uint256 pricePerExecution)"
);

const executionRequestedEvent = parseAbiItem(
  "event AgentExecutionRequested(uint256 indexed executionId, uint256 indexed agentId, address indexed subscriber, uint256 amountPaid, uint256 builderRevenue, uint256 platformFee)"
);

const executionStatusUpdatedEvent = parseAbiItem(
  "event ExecutionStatusUpdated(uint256 indexed executionId, uint8 status, bytes result)"
);

function logEvent(type: string, payload: Record<string, unknown>) {
  const entry = {
    type,
    chainId: somniaTestnet.id,
    observedAt: new Date().toISOString(),
    ...payload,
  };
  console.log(JSON.stringify(entry));
}

async function main() {
  console.log("[SAS Indexer] starting");
  console.log(`[SAS Indexer] registry=${registryAddress}`);
  console.log(`[SAS Indexer] billing=${billingAddress}`);

  const unwatchRegistry = client.watchEvent({
    address: registryAddress,
    event: agentRegisteredEvent,
    onLogs: (logs) => {
      for (const log of logs) {
        logEvent("agent.registered", {
          blockNumber: log.blockNumber?.toString(),
          txHash: log.transactionHash,
          agentId: log.args.agentId?.toString(),
          builder: log.args.builder,
          name: log.args.name,
          agentType: log.args.agentType,
          pricePerExecution: log.args.pricePerExecution?.toString(),
        });
      }
    },
  });

  const unwatchExecutions = client.watchEvent({
    address: billingAddress,
    events: [executionRequestedEvent, executionStatusUpdatedEvent],
    onLogs: (logs) => {
      for (const log of logs) {
        if (log.eventName === "AgentExecutionRequested") {
          logEvent("execution.requested", {
            blockNumber: log.blockNumber?.toString(),
            txHash: log.transactionHash,
            executionId: log.args.executionId?.toString(),
            agentId: log.args.agentId?.toString(),
            subscriber: log.args.subscriber,
            amountPaid: log.args.amountPaid?.toString(),
            builderRevenue: log.args.builderRevenue?.toString(),
            platformFee: log.args.platformFee?.toString(),
          });
          continue;
        }

        logEvent("execution.status", {
          blockNumber: log.blockNumber?.toString(),
          txHash: log.transactionHash,
          executionId: log.args.executionId?.toString(),
          status: log.args.status,
          resultBytes: log.args.result?.length ?? 0,
        });
      }
    },
  });

  process.once("SIGINT", () => {
    unwatchRegistry();
    unwatchExecutions();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
