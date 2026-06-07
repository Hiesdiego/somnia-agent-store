// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Toaster } from "sonner";

const appName = "Prophecy Companion";
const appUrl = process.env.NEXT_PUBLIC_PROPHECY_COMPANION_URL || "https://prophecy.social";
const appDescription =
  "Autonomous prediction market intelligence for Prophecy. Scout mispriced markets, analyze evidence, monitor positions, and fund Somnia-powered agent missions.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: appName,
  title: {
    default: `${appName} | Autonomous Prediction Market Intelligence`,
    template: `%s | ${appName}`,
  },
  description: appDescription,
  keywords: [
    "Prophecy Companion",
    "Prophecy markets",
    "prediction market intelligence",
    "prediction market analysis",
    "autonomous market analysis",
    "Somnia agents",
    "SAS agents",
    "Somnia Agent Store",
    "market scouting",
    "on-chain AI agents",
    "autonomous trading research",
  ],
  authors: [{ name: appName }],
  creator: appName,
  publisher: appName,
  category: "finance",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon-16x16.png"],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: appName,
    title: `${appName} | Autonomous Prediction Market Intelligence`,
    description: appDescription,
    images: [
      {
        url: "/android-chrome-512x512.png",
        width: 512,
        height: 512,
        alt: "Prophecy Companion logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: `${appName} | Autonomous Prediction Market Intelligence`,
    description: appDescription,
    images: ["/android-chrome-512x512.png"],
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

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preconnect for Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Exo 2 - display / heading font (futuristic geometric)
            DM Sans - body font (clean, readable)
            JetBrains Mono - code / mono font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "rgba(8, 12, 8, 0.96)",
                border: "1px solid rgba(0, 255, 133, 0.20)",
                color: "#ffffff",
                borderRadius: "12px",
                fontFamily: '"DM Sans", sans-serif',
                fontSize: "13px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.70), 0 0 20px rgba(0,255,133,0.06)",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
