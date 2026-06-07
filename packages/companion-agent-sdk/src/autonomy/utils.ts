import { createHash } from "node:crypto";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function hashId(...parts: Array<string | number | null | undefined>): string {
  const text = parts.filter((part) => part !== undefined && part !== null).join("|");
  return createHash("sha256").update(text).digest("hex");
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value.trim();
  }
}

export function parseEventId(url: string): string | null {
  const match = url.match(/\/event\/(\d+)/);
  return match?.[1] ?? null;
}

export function parseMaybePercent(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) return parsed / 100;
  return null;
}

export function parseLargeNumber(raw: string): number | null {
  const value = raw.trim().replace(/,/g, "");
  const suffix = value.slice(-1).toUpperCase();
  const multiplier =
    suffix === "K"
      ? 1e3
      : suffix === "M"
        ? 1e6
        : suffix === "B"
          ? 1e9
          : suffix === "T"
            ? 1e12
            : 1;
  const numeric = multiplier === 1 ? value : value.slice(0, -1);
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;
  return parsed * multiplier;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

