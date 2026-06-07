import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Vault deployment for the SAS v0.1 pay-per-execution core.
const AutopilotVaultV0_1Module = buildModule("AutopilotVaultV0_1Module", (m) => {
  const deployer = m.getAccount(0);
  const billing = m.getParameter(
    "billing",
    "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03"
  );
  const registry = m.getParameter(
    "registry",
    "0x25029648D4dDaE085c8db865582F43Bce2857766"
  );
  const relayer = m.getParameter(
    "relayer",
    "0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995"
  );

  const vault = m.contract("AutopilotVault", [deployer, billing, registry]);

  m.call(vault, "setRelayer", [relayer, true], {
    id: "vault_set_relayer",
    after: [vault],
  });

  return { vault };
});

export default AutopilotVaultV0_1Module;

