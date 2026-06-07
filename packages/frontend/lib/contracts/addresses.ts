/// @file addresses.ts
/// @notice Deployed contract addresses per network.
/// @dev Update these after running SAS v0.1 deploys:
///      pnpm deploy:core:v0.1:testnet && pnpm deploy:vault:v0.1:testnet

export const CONTRACT_ADDRESSES = {
  somniaTestnet: {
    chainId: 50312,
    SASRegistry: "0x25029648D4dDaE085c8db865582F43Bce2857766" as `0x${string}`,
    SASBilling: "0xCD5d2bF50Cd496Dad9748B4d2fDcF02C7BC82F03" as `0x${string}`,
    SASExecutor: "0x7E5da137BEa251955C49cC7730e281E2Cd4b14Ec" as `0x${string}`,
    SASSettlement: "0x93723dbc307f5d32a5cf21458c44fde7d7d2c71e" as `0x${string}`,
    SASVerifierRegistry: "0x288C57cC574c2CDB1958ec2843D277EB81a1f543" as `0x${string}`,
    SASRouting: "0xcb22a83dDcf9DAfdcA28a9fe2e25FC9251A6014F" as `0x${string}`,
    SASReputationOracle: "0xA6D47646a1d6f4FDCf34Fe0aad5979fBC2445C48" as `0x${string}`,
    SASExecutionGraph: "0x9Aaf7087044266f545FB1aa81D91DB80c3c55315" as `0x${string}`,
    SASAutonomyV4: "0x475F888B8a522fA81b9B0455d94A0Dc710cBa686" as `0x${string}`,
    SASAgentTreasury: "0xde70575ace592017bed2843bD5be554033F9cD1F" as `0x${string}`,
    SASQuoteBook: "0xA2Ab18B57461D8591c24C1A7Fa04800a60B3EecF" as `0x${string}`,
    SASSpawner: "0xFf0315993644A45bd09E45f2B199c6DC7e46C912" as `0x${string}`,
    AutopilotVault: "0xE7F454628390d1DD95De3D2cEB10fBFc27a9d041" as `0x${string}`,
  },
  somniaMainnet: {
    chainId: 5031,
    SASRegistry: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    SASBilling:  "0x0000000000000000000000000000000000000000" as `0x${string}`,
    SASExecutor: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    SASExecutionGraph: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    SASAutonomyV4: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    AutopilotVault: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  },
} as const;

export type SupportedChainId = 50312 | 5031;

export function getAddresses(chainId: number) {
  if (chainId === 50312) return CONTRACT_ADDRESSES.somniaTestnet;
  if (chainId === 5031)  return CONTRACT_ADDRESSES.somniaMainnet;
  throw new Error(`Unsupported chainId: ${chainId}. Deploy to Somnia first.`);
}
