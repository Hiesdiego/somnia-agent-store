import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Deploy timelock governance and transfer ownership of SAS v0.1
///         admin surfaces from EOA to timelock.
const SASAdminHardeningV0_1Module = buildModule("SASAdminHardeningV0_1Module", (m) => {
  const defaultAdmin = "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF";
  const proposers = m.getParameter("proposers", [defaultAdmin]);
  const executors = m.getParameter("executors", [defaultAdmin]);
  const timelockAdmin = m.getParameter("timelockAdmin", defaultAdmin);
  const minDelaySeconds = m.getParameter("minDelaySeconds", 86_400);

  const registryAddress = m.getParameter(
    "registry",
    "0x25029648D4dDaE085c8db865582F43Bce2857766"
  );
  const billingAddress = m.getParameter(
    "billing",
    "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03"
  );
  const executorAddress = m.getParameter(
    "sasExecutor",
    "0x7E5da137BEa251955C49cC7730e281E2Cd4b14Ec"
  );
  const autonomyAddress = m.getParameter(
    "autonomy",
    "0x475F888B8a522fA81b9B0455d94A0Dc710cBa686"
  );
  const executionGraphAddress = m.getParameter(
    "executionGraph",
    "0x9Aaf7087044266f545FB1aa81D91DB80c3c55315"
  );
  const vaultAddress = m.getParameter(
    "vault",
    "0xE7F454628390d1DD95De3D2cEB10fBFc27a9d041"
  );

  const timelock = m.contract("SASAdminTimelock", [
    minDelaySeconds,
    proposers,
    executors,
    timelockAdmin,
  ]);

  const registry = m.contractAt("SASRegistry", registryAddress);
  const billing = m.contractAt("SASBilling", billingAddress);
  const sasExecutor = m.contractAt("SASExecutor", executorAddress);
  const autonomy = m.contractAt("SASAutonomyV4", autonomyAddress);
  const executionGraph = m.contractAt("SASExecutionGraph", executionGraphAddress);
  const vault = m.contractAt("AutopilotVault", vaultAddress);

  m.call(registry, "transferOwnership", [timelock], {
    id: "registry_transfer_ownership_to_timelock",
    after: [timelock],
  });
  m.call(billing, "transferOwnership", [timelock], {
    id: "billing_transfer_ownership_to_timelock",
    after: [timelock],
  });
  m.call(sasExecutor, "transferOwnership", [timelock], {
    id: "executor_transfer_ownership_to_timelock",
    after: [timelock],
  });
  m.call(autonomy, "transferOwnership", [timelock], {
    id: "autonomy_transfer_ownership_to_timelock",
    after: [timelock],
  });
  m.call(executionGraph, "transferOwnership", [timelock], {
    id: "execution_graph_transfer_ownership_to_timelock",
    after: [timelock],
  });
  m.call(vault, "transferOwnership", [timelock], {
    id: "vault_transfer_ownership_to_timelock",
    after: [timelock],
  });

  return {
    timelock,
    registry,
    billing,
    sasExecutor,
    autonomy,
    executionGraph,
    vault,
  };
});

export default SASAdminHardeningV0_1Module;
