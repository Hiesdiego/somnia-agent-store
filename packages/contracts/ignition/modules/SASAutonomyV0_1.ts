import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Deploys SAS autonomy (contract: SASAutonomyV4) for SAS v0.1 and
///         wires graph recorder permission.
const SASAutonomyV0_1Module = buildModule("SASAutonomyV0_1Module", (m) => {
  const deployer = m.getAccount(0);

  const billing = m.getParameter(
    "billing",
    "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03"
  );
  const registry = m.getParameter(
    "registry",
    "0x25029648D4dDaE085c8db865582F43Bce2857766"
  );
  const executionGraphAddress = m.getParameter(
    "executionGraph",
    "0x9Aaf7087044266f545FB1aa81D91DB80c3c55315"
  );

  const autonomy = m.contract("SASAutonomyV4", [
    deployer,
    billing,
    registry,
    executionGraphAddress,
  ]);
  const executionGraph = m.contractAt("SASExecutionGraph", executionGraphAddress);

  m.call(executionGraph, "setRecorder", [autonomy, true], {
    id: "execution_graph_set_autonomy_recorder",
    after: [autonomy],
  });

  return { autonomy, executionGraph };
});

export default SASAutonomyV0_1Module;

