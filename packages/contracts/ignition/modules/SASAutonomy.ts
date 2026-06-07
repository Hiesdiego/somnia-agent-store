import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import SASModule from "./SAS";

/// @notice SAS autonomy stack deployment and wiring.
const SASAutonomyModule = buildModule("SASAutonomyModule", (m) => {
  const deployer = m.getAccount(0);
  const { registry, billing, executor } = m.useModule(SASModule);

  const minVerifierStake = m.getParameter(
    "minVerifierStake",
    1_000_000_000_000_000_000n // 1 STT
  );

  const settlementExecutor = m.getParameter(
    "settlementExecutor",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );

  const defaultRouter = m.getParameter(
    "defaultRouter",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );
  const reputationUpdater = m.getParameter(
    "reputationUpdater",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );

  const verifierRegistry = m.contract("SASVerifierRegistry", [deployer, minVerifierStake]);
  const settlement = m.contract("SASSettlement", [deployer, billing, verifierRegistry]);
  const agentTreasury = m.contract("SASAgentTreasury", [deployer, registry]);
  const quoteBook = m.contract("SASQuoteBook", [deployer, registry]);
  const routing = m.contract("SASRouting", [deployer]);
  const reputationOracle = m.contract("SASReputationOracle", [deployer]);
  const executionGraph = m.contract("SASExecutionGraph", [deployer]);
  const spawner = m.contract("SASSpawner", [deployer, registry]);

  m.call(billing, "setSettlementContract", [settlement], {
    id: "billing_set_settlement",
    after: [settlement],
  });

  m.call(settlement, "setExecutionGraph", [executionGraph], {
    id: "settlement_set_execution_graph",
    after: [executionGraph],
  });

  m.call(settlement, "setExecutor", [settlementExecutor, true], {
    id: "settlement_set_executor",
  });

  m.call(verifierRegistry, "setReportWriter", [settlement, true], {
    id: "verifier_set_report_writer",
    after: [settlement],
  });

  m.call(executionGraph, "setRecorder", [settlement, true], {
    id: "execution_graph_set_recorder",
    after: [settlement],
  });

  m.call(registry, "setAuthorizedRegistrar", [spawner, true], {
    id: "registry_set_spawner_registrar",
    after: [spawner],
  });

  m.call(agentTreasury, "setAuthorizedSpender", [settlement, true], {
    id: "treasury_set_settlement_spender",
    after: [settlement],
  });

  m.call(routing, "setRouter", [defaultRouter, true], {
    id: "routing_set_router",
  });

  m.call(reputationOracle, "setUpdater", [reputationUpdater, true], {
    id: "reputation_set_updater",
  });

  return {
    registry,
    billing,
    executor,
    verifierRegistry,
    settlement,
    agentTreasury,
    quoteBook,
    routing,
    reputationOracle,
    executionGraph,
    spawner,
  };
});

export default SASAutonomyModule;
