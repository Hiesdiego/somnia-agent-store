"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { SOMNIA_TESTNET } from "@/lib/types";

const wagmiConfig = createConfig({
  chains: [SOMNIA_TESTNET],
  transports: {
    [SOMNIA_TESTNET.id]: http("https://api.infra.testnet.somnia.network"),
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#7C3AED",
          logo: "/logo.svg",
        },
        loginMethods: ["wallet", "passkey", "google", "twitter", "email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: SOMNIA_TESTNET,
        supportedChains: [SOMNIA_TESTNET],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
