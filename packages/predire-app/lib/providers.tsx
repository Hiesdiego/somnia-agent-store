// lib/providers.tsx
"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { SOMNIA_TESTNET } from "@/lib/somnia";

const wagmiConfig = createConfig({
  chains: [SOMNIA_TESTNET],
  transports: {
    [SOMNIA_TESTNET.id]: http("https://api.infra.testnet.somnia.network"),
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!appId || appId === "your_privy_app_id") {
    return (
      <div
        style={{
          padding: "40px 32px",
          color: "#ffffff",
          fontFamily: '"DM Sans", system-ui, sans-serif',
          background: "#000",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            border: "1px solid rgba(0,255,133,0.20)",
            borderRadius: "16px",
            background: "rgba(8,12,8,0.96)",
            padding: "32px 36px",
            maxWidth: "520px",
            width: "100%",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "10px",
              fontWeight: 500,
              color: "#00ff85",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Setup required
          </p>
          <h2
            style={{
              margin: "0 0 12px",
              fontFamily: '"Exo 2", sans-serif',
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "-0.03em",
            }}
          >
            Prophecy Companion
          </h2>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: "14px", lineHeight: 1.65 }}>
            Set{" "}
            <code
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "12px",
                color: "#00cc69",
                background: "rgba(0,255,133,0.08)",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              NEXT_PUBLIC_PRIVY_APP_ID
            </code>{" "}
            in{" "}
            <code
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: "12px",
                color: "#00cc69",
                background: "rgba(0,255,133,0.08)",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              packages/predire-app/.env
            </code>{" "}
            and restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#00cc69",
          logo: "/pc-logo.png",
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
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
