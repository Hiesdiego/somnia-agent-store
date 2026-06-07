import "dotenv/config";
import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
    },
  },

  networks: {
    // Local dev
    localhost: {
      type: "http",
      chainType: "generic",
      url: "http://127.0.0.1:8545",
    },
    // Somnia Shannon Testnet
    somniaTestnet: {
      type: "http",
      chainType: "generic",
      url: "https://api.infra.testnet.somnia.network",
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      // Somnia gas model: always set generous limits
      // Storage ops need a 1_000_000 gas reserve for disk reads
    },
    // Somnia Mainnet (ready for when you go live)
    somniaMainnet: {
      type: "http",
      chainType: "generic",
      url: "https://api.infra.mainnet.somnia.network",
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },

  // Contract verification via Blockscout
  verify: {
    etherscan: {
      // Somnia testnet Blockscout API
      apiKey: configVariable("BLOCKSCOUT_API_KEY"),
      customChains: [
        {
          network: "somniaTestnet",
          chainId: 50312,
          urls: {
            apiURL: "https://shannon-explorer.somnia.network/api",
            browserURL: "https://shannon-explorer.somnia.network",
          },
        },
        {
          network: "somniaMainnet",
          chainId: 5031,
          urls: {
            apiURL: "https://mainnet.somnia.w3us.site/api/",
            browserURL: "https://explorer.somnia.network",
          },
        },
      ],
    },
  },
});
