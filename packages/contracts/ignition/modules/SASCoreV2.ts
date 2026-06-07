import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Core deployment for the autonomy-compatible SAS contracts.
/// @dev Uses new future IDs because the existing testnet core was deployed
///      before registrar and settlement support existed.
const SASCoreV2Module = buildModule("SASCoreV2Module", (m) => {
  const deployer = m.getAccount(0);

  const agentPlatform = m.getParameter(
    "agentPlatform",
    "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
  );
  const treasury = m.getParameter(
    "treasury",
    "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF"
  );
  const runner = m.getParameter(
    "runner",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );

  const registry = m.contract("SASRegistry", [deployer]);
  const executor = m.contract("SASExecutor", [deployer, agentPlatform]);
  const billing = m.contract("SASBilling", [deployer, registry, treasury]);

  m.call(registry, "setBillingContract", [billing], {
    id: "registry_set_billing",
    after: [billing],
  });

  m.call(billing, "setExecutor", [executor], {
    id: "billing_set_executor",
    after: [executor],
  });

  m.call(executor, "setBilling", [billing], {
    id: "executor_set_billing",
    after: [billing],
  });

  m.call(executor, "setRunner", [runner], {
    id: "executor_set_runner",
  });

  // Funding is intentionally explicit for the replacement core: this recovery
  // deployment must not transfer an additional reserve without review.
  return { registry, billing, executor };
});

export default SASCoreV2Module;
