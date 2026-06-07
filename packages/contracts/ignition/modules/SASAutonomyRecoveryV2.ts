import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import SASCoreV2Module from "./SASCoreV2";

/// @notice Recovery deployment for the partially deployed autonomy testnet stack.
/// @dev Reuses compatible contracts already mined by SASAutonomyModule, while
///      deploying a new core and contracts whose immutable registry dependency
///      points at the legacy SASRegistry.
const SASAutonomyRecoveryV2Module = buildModule("SASAutonomyRecoveryV2Module", (m) => {
  const deployer = m.getAccount(0);
  const { registry, billing, executor } = m.useModule(SASCoreV2Module);

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

  const verifierRegistry = m.contractAt(
    "SASVerifierRegistry",
    m.getParameter("existingVerifierRegistry", "0x288C57cC574c2CDB1958ec2843D277EB81a1f543")
  );
  const settlement = m.contractAt(
    "SASSettlement",
    m.getParameter("existingSettlement", "0x93723dbc307f5d32a5cf21458c44fde7d7d2c71e")
  );
  const routing = m.contractAt(
    "SASRouting",
    m.getParameter("existingRouting", "0xcb22a83dDcf9DAfdcA28a9fe2e25FC9251A6014F")
  );
  const reputationOracle = m.contractAt(
    "SASReputationOracle",
    m.getParameter("existingReputationOracle", "0xA6D47646a1d6f4FDCf34Fe0aad5979fBC2445C48")
  );
  const executionGraph = m.contractAt(
    "SASExecutionGraph",
    m.getParameter("existingExecutionGraph", "0x9Aaf7087044266f545FB1aa81D91DB80c3c55315")
  );

  const agentTreasury = m.contract("SASAgentTreasury", [deployer, registry]);
  const quoteBook = m.contract("SASQuoteBook", [deployer, registry]);
  const spawner = m.contract("SASSpawner", [deployer, registry]);

  m.call(settlement, "setBilling", [billing], {
    id: "settlement_set_v2_billing",
  });

  m.call(billing, "setSettlementContract", [settlement], {
    id: "billing_set_settlement",
  });

  m.call(settlement, "setExecutionGraph", [executionGraph], {
    id: "settlement_set_execution_graph",
  });

  m.call(settlement, "setExecutor", [settlementExecutor, true], {
    id: "settlement_set_executor",
  });

  m.call(verifierRegistry, "setReportWriter", [settlement, true], {
    id: "verifier_set_report_writer",
  });

  m.call(executionGraph, "setRecorder", [settlement, true], {
    id: "execution_graph_set_recorder",
  });

  m.call(registry, "setAuthorizedRegistrar", [spawner, true], {
    id: "registry_set_spawner_registrar",
    after: [spawner],
  });

  m.call(agentTreasury, "setAuthorizedSpender", [settlement, true], {
    id: "treasury_set_settlement_spender",
    after: [agentTreasury],
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

export default SASAutonomyRecoveryV2Module;
