import { defineChain } from "viem";

export const SOMNIA_TESTNET = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http:      [process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network"],
      webSocket: [process.env.WS_RPC_URL ?? "wss://api.infra.testnet.somnia.network/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url:  "https://shannon-explorer.somnia.network",
    },
  },
  testnet: true,
});

export const SOMNIA_MAINNET = defineChain({
  id: 5031,
  name: "Somnia Mainnet",
  nativeCurrency: { name: "SOMI", symbol: "SOMI", decimals: 18 },
  rpcUrls: {
    default: {
      http:      ["https://api.infra.mainnet.somnia.network"],
      webSocket: ["wss://api.infra.mainnet.somnia.network/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url:  "https://explorer.somnia.network",
    },
  },
});
