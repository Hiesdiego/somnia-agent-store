import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Somnia Agent Store — full protocol deployment.
///
/// Deployment order:
///   1. SASRegistry   — agent registry, owned by deployer
///   2. SASExecutor   — execution router; receives runtime budget per run
///   3. SASBilling    — payment processor; wired to registry + executor
///
/// Post-deploy wiring (done in-module):
///   • registry.setBillingContract(billing)
///   • billing.setExecutor(executor)
///   • executor.setBilling(billing)
///   • executor.setRunner(RUNNER_ADDRESS)
///   • executor.fundSomniaReserve() — optional sponsored/refund buffer
///
const SASModule = buildModule("SASModule", (m) => {
  // ── Addresses ──────────────────────────────────────────────────────────────
  const deployer = m.getAccount(0);

  // Somnia Agent Platform addresses
  // Change SOMNIA_NETWORK to "mainnet" to switch targets
  const SOMNIA_NETWORK = "testnet" as const;

  const AGENT_PLATFORM_ADDRESS =
    SOMNIA_NETWORK === "testnet"
      ? "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
      : "0x5E5205CF39E766118C01636bED000A54D93163E6";

  // Treasury wallet — receives the 15% platform fee on withdrawal
  const TREASURY_ADDRESS = m.getParameter(
    "treasury",
    "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF"
  );

  // Off-chain runner wallet — the only address that can post custom agent results
  const RUNNER_ADDRESS = m.getParameter(
    "runner",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );

  // Optional STT sponsorship/refund buffer (in wei). Ordinary Somnia-native
  // executions fund their own runtime request through SASBilling.
  const INITIAL_RESERVE_WEI = m.getParameter(
    "initialReserveWei",
    5_000_000_000_000_000_000n // 5 STT
  );

  // ── Contract Deployments ───────────────────────────────────────────────────

  const registry = m.contract("SASRegistry", [deployer]);

  const executor = m.contract("SASExecutor", [deployer, AGENT_PLATFORM_ADDRESS]);

  const billing = m.contract("SASBilling", [deployer, registry, TREASURY_ADDRESS]);

  // ── Post-Deploy Wiring ─────────────────────────────────────────────────────

  // Wire registry → billing (allows billing to call recordExecution)
  m.call(registry, "setBillingContract", [billing], {
    id: "registry_set_billing",
    after: [billing],
  });

  // Wire billing → executor (allows billing to call execute)
  m.call(billing, "setExecutor", [executor], {
    id: "billing_set_executor",
    after: [executor],
  });

  // Wire executor → billing (allows executor to call resolveExecution)
  m.call(executor, "setBilling", [billing], {
    id: "executor_set_billing",
    after: [billing],
  });

  // Authorize the off-chain runner to submit custom agent results
  m.call(executor, "setRunner", [RUNNER_ADDRESS], {
    id: "executor_set_runner",
  });

  // Seed the optional sponsored/refund buffer.
  m.call(executor, "fundSomniaReserve", [], {
    id: "executor_fund_reserve",
    value: INITIAL_RESERVE_WEI,
    after: [executor],
  });

  return { registry, billing, executor };
});

export default SASModule;
