"use client";

import { useEffect, useState } from "react";
import { parseInlineMetadata, type AgentIntegrationMetadata } from "@/lib/agentMetadata";

type AgentMetadataState = {
  metadata: AgentIntegrationMetadata | null;
  imageUrl: string | null;
  loading: boolean;
};

const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function toHttpUrl(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("ipfs://")) {
    const cidPath = value.slice("ipfs://".length).replace(/^ipfs\//, "");
    const customGateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY?.trim();
    const gateway = customGateway && customGateway.length > 0 ? customGateway : DEFAULT_IPFS_GATEWAY;
    return `${gateway.replace(/\/+$/, "")}/${cidPath.replace(/^\/+/, "")}`;
  }
  return null;
}

function extractImageField(metadata: AgentIntegrationMetadata | null): string | null {
  if (!metadata) return null;
  const valueMap = metadata as unknown as Record<string, unknown>;
  const candidates: Array<unknown> = [
    valueMap.image,
    valueMap.image_url,
    valueMap.imageUrl,
    valueMap.logo,
    valueMap.icon,
    valueMap.thumbnail,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = toHttpUrl(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(pathname);
  } catch {
    return /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url);
  }
}

export function useAgentMetadata(metadataURI: string): AgentMetadataState {
  const [state, setState] = useState<AgentMetadataState>({
    metadata: null,
    imageUrl: null,
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const inline = parseInlineMetadata(metadataURI);
      if (inline) {
        if (cancelled) return;
        setState({ metadata: inline, imageUrl: extractImageField(inline), loading: false });
        return;
      }

      const metadataUrl = toHttpUrl(metadataURI);
      if (!metadataUrl) {
        if (cancelled) return;
        setState({ metadata: null, imageUrl: null, loading: false });
        return;
      }

      if (looksLikeImageUrl(metadataUrl)) {
        if (cancelled) return;
        setState({ metadata: null, imageUrl: metadataUrl, loading: false });
        return;
      }

      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: true }));
      }

      try {
        const response = await fetch(metadataUrl, { cache: "no-store" });
        if (!response.ok) {
          if (cancelled) return;
          setState({ metadata: null, imageUrl: null, loading: false });
          return;
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.toLowerCase().startsWith("image/")) {
          if (cancelled) return;
          setState({ metadata: null, imageUrl: metadataUrl, loading: false });
          return;
        }

        const text = await response.text();
        let parsed: AgentIntegrationMetadata | null = null;
        try {
          parsed = JSON.parse(text) as AgentIntegrationMetadata;
        } catch {
          parsed = null;
        }

        if (cancelled) return;
        setState({
          metadata: parsed,
          imageUrl: extractImageField(parsed),
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setState({ metadata: null, imageUrl: null, loading: false });
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [metadataURI]);

  return state;
}
