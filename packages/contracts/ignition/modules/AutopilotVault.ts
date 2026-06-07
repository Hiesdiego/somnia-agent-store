import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Vault deployment for the replacement SAS V2 core.
/// @dev Uses a new future ID because the legacy vault has immutable
///      dependencies on the original SASBilling and SASRegistry contracts.
const AutopilotVaultV2Module = buildModule("AutopilotVaultV2Module", (m) => {
  const deployer = m.getAccount(0);

  const billing = m.getParameter(
    "billing",
    "0x14aBd9Ffba983b0DA85961631572Ea29f61199f7"
  );
  const registry = m.getParameter(
    "registry",
    "0x1c55A9b56F66e038EfD21946161D963672CEe8cA"
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

export default AutopilotVaultV2Module;
