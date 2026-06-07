import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";

type RateBucket = {
  count: number;
  resetAt: number;
};

type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: string[];
  allowSubdomains?: boolean;
  userAgent: string;
};

const buckets = new Map<string, RateBucket>();
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_500_000;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function rateLimit(request: NextRequest, key: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  const bucketKey = `${key}:${clientIp(request)}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count++;
  if (current.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    }
  );
}

export async function readJsonBody<T>(request: NextRequest, maxBytes = 16_384): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Request body is too large.");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("Request body is too large.");
  }

  return JSON.parse(text) as T;
}

export function parseProphecyEventUrl(value: string): { valid: boolean; eventId: string | null; url?: URL } {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const eventIndex = parts.findIndex((part) => part === "event");
    const eventId = eventIndex >= 0 ? parts[eventIndex + 1] : null;
    const valid =
      url.protocol === "https:" &&
      url.hostname === "prophecy.social" &&
      Boolean(eventId && /^\d+$/.test(eventId));

    return { valid, eventId, url };
  } catch {
    return { valid: false, eventId: null };
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostAllowed(hostname: string, allowedHosts: string[], allowSubdomains: boolean): boolean {
  return allowedHosts.some((allowed) => {
    const normalized = allowed.toLowerCase();
    const host = hostname.toLowerCase();
    return host === normalized || (allowSubdomains && host.endsWith(`.${normalized}`));
  });
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((part) => Number(part));
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}

async function assertPublicUrl(url: URL, allowedHosts: string[] | undefined, allowSubdomains: boolean) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP(S) URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed.");
  }
  if (allowedHosts?.length && !hostAllowed(url.hostname, allowedHosts, allowSubdomains)) {
    throw new Error("URL host is not allowed.");
  }
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Private network URLs are not allowed.");
  }

  const directIp = net.isIP(url.hostname) ? url.hostname : null;
  const resolved = directIp ? [{ address: directIp }] : await lookup(url.hostname, { all: true, verbatim: false });
  if (resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Private network URLs are not allowed.");
  }
}

export async function safeFetchText(rawUrl: string, options: SafeFetchOptions): Promise<{ text: string; status: number; ok: boolean }> {
  const url = new URL(rawUrl);
  const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestedMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1_000, requestedTimeout) : DEFAULT_TIMEOUT_MS;
  const maxBytes = Number.isFinite(requestedMaxBytes) ? Math.max(16_384, requestedMaxBytes) : DEFAULT_MAX_BYTES;

  await assertPublicUrl(url, options.allowedHosts, Boolean(options.allowSubdomains));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": options.userAgent,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Response too large (${declaredLength} bytes).`);
    }

    const reader = response.body?.getReader();
    if (!reader) return { text: await response.text(), status: response.status, ok: response.ok };

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }

    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return { text, status: response.status, ok: response.ok };
  } finally {
    clearTimeout(timeout);
  }
}
