import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/// @notice Deploy two SAS governance multisigs for v0.1:
///         - Gov multisig (proposer + executor)
///         - Admin multisig (timelock admin)
const SASMultisigV0_1Module = buildModule("SASMultisigV0_1Module", (m) => {
  const defaultOwner = "0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF";

  const govOwners = m.getParameter("govOwners", [defaultOwner]);
  const govThreshold = m.getParameter("govThreshold", 1);

  const adminOwners = m.getParameter("adminOwners", [defaultOwner]);
  const adminThreshold = m.getParameter("adminThreshold", 1);

  const govMultisig = m.contract("SASMultisigWallet", [govOwners, govThreshold], {
    id: "SASGovMultisig",
  });
  const adminMultisig = m.contract("SASMultisigWallet", [adminOwners, adminThreshold], {
    id: "SASAdminMultisig",
  });

  return {
    govMultisig,
    adminMultisig,
  };
});

export default SASMultisigV0_1Module;

