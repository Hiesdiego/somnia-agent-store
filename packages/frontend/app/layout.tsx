import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Toaster } from "sonner";

const appName = "Somnia Agent Store";
const appUrl = process.env.NEXT_PUBLIC_SAS_URL || "https://somnia-agent-store.vercel.app";
const appDescription =
  "Discover, publish, document, and integrate Somnia-native AI agents. SAS gives builders marketplace listings, pay-per-run billing, Autonomy V4 workflows, and integration docs for on-chain agent apps.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: appName,
  title: {
    default: `${appName} | Somnia-Native AI Agent Marketplace`,
    template: `%s | ${appName}`,
  },
  description: appDescription,
  keywords: [
    "Somnia Agent Store",
    "SAS",
    "Somnia agents",
    "AI agent marketplace",
    "on-chain AI agents",
    "Somnia Agent Platform",
    "Autonomy V4",
    "SASBilling",
    "agent monetization",
    "Web3 AI agents",
    "STT",
    "Somnia Shannon Testnet",
  ],
  authors: [{ name: appName }],
  creator: appName,
  publisher: appName,
  category: "technology",
  alternates: {
    canonical: "/",
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: appName,
    title: `${appName} | Somnia-Native AI Agent Marketplace`,
    description: appDescription,
    images: [
      {
        url: "/sas-logo.png",
        width: 1024,
        height: 1024,
        alt: "Somnia Agent Store logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: `${appName} | Somnia-Native AI Agent Marketplace`,
    description: appDescription,
    images: ["/sas-logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--bg-surface)",
                border: "1px solid var(--bg-border)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-display)",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
