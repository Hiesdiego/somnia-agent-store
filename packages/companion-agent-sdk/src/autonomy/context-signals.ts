import type { MarketSnapshot, ParsedSignals } from "./types.ts";
import { clamp, hashId, normalizeUrl, parseEventId, parseLargeNumber, parseMaybePercent } from "./utils.ts";

const POSITIVE_SENTIMENT_TERMS = [
  "momentum",
  "bullish",
  "strong",
  "advantage",
  "uptrend",
  "favorable",
  "improving",
  "supportive",
  "positive",
  "outperform",
  "surge",
  "gaining",
];

const NEGATIVE_SENTIMENT_TERMS = [
  "bearish",
  "weak",
  "risk",
  "uncertain",
  "injury",
  "drop",
  "decline",
  "negative",
  "downgrade",
  "selling",
  "outflow",
  "deteriorating",
];

function lowercase(value: string): string {
  return value.toLowerCase();
}

function countTermHits(text: string, terms: string[]): number {
  let hits = 0;
  for (const term of terms) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = text.match(pattern);
    hits += matches?.length ?? 0;
  }
  return hits;
}

function extractPrimaryMarketProbability(context: string): number | null {
  const explicitPatterns = [
    /YES price:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /Observed market probability:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /market probability[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)%/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = context.match(pattern);
    if (!match?.[1]) continue;
    const parsed = parseMaybePercent(match[1]);
    if (parsed !== null) return parsed;
  }

  const generic = context.match(/\b([0-9]{1,2}(?:\.[0-9]+)?)%\s*(?:YES|yes|chance|probability)?/);
  if (!generic?.[1]) return null;
  return parseMaybePercent(generic[1]);
}

function extractVolume(context: string): number | null {
  const patterns = [
    /Volume:\s*([$]?[0-9][0-9,]*(?:\.[0-9]+)?[KMBT]?)/i,
    /liquidity:\s*([$]?[0-9][0-9,]*(?:\.[0-9]+)?[KMBT]?)/i,
    /trading volume[^0-9]{0,20}([$]?[0-9][0-9,]*(?:\.[0-9]+)?[KMBT]?)/i,
  ];

  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (!match?.[1]) continue;
    const parsed = parseLargeNumber(match[1].replace("$", ""));
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractSection(context: string, heading: string): string {
  const marker = `${heading}:`;
  const start = context.indexOf(marker);
  if (start < 0) return "";
  const remainder = context.slice(start + marker.length);
  const nextHeading = remainder.search(/\n[A-Z][A-Za-z /_-]+:\n?/);
  return (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
}

function extractTitle(context: string): string | null {
  const match = context.match(/Title:\s*(.+)/i);
  if (!match?.[1]) return null;
  const value = match[1].trim();
  return value && value.toLowerCase() !== "unknown" ? value : null;
}

function extractWarningCount(context: string): number {
  const warningsMatch = context.match(/Warnings:\s*(.+)/i);
  if (!warningsMatch?.[1]) return 0;
  const value = warningsMatch[1].trim();
  if (!value || value.toLowerCase() === "none") return 0;
  return value
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function extractFactLines(context: string): string[] {
  const section = extractSection(context, "Extracted facts");
  if (!section || lowercase(section) === "none") return [];
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 40);
}

function extractSourceCount(context: string): number {
  return (context.match(/https?:\/\/[^\s)]+/g) ?? []).length;
}

function sentimentFromContext(context: string): number {
  const evidence = [
    extractSection(context, "External/source-reference evidence fetched from Prophecy-listed sources"),
    extractSection(context, "External web research evidence"),
    extractSection(context, "Extracted facts"),
  ]
    .filter(Boolean)
    .join("\n");
  const text = lowercase(evidence || context);
  const positive = countTermHits(text, POSITIVE_SENTIMENT_TERMS);
  const negative = countTermHits(text, NEGATIVE_SENTIMENT_TERMS);
  const raw = (positive - negative) / Math.max(4, positive + negative);
  return clamp(raw, -1, 1);
}

function whaleScoreFromContext(context: string): number {
  const text = lowercase(context);
  const whaleMentions = (text.match(/\bwhale|large wallet|large transfer|smart money|top holder\b/g) ?? []).length;
  if (whaleMentions === 0) return 0;

  const bullish = (text.match(/\b(inflow|accumulat|buy|long|opened position|added)\b/g) ?? []).length;
  const bearish = (text.match(/\b(outflow|sell|short|closed position|reduced)\b/g) ?? []).length;
  const direction = bullish === bearish ? 0 : bullish > bearish ? 1 : -1;
  const intensity = clamp(whaleMentions / 4, 0, 1);
  return direction * intensity;
}

function freshnessScore(context: string, now = Date.now()): number {
  const dates = [
    ...context.matchAll(
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi
    ),
  ].map((match) => Date.parse(match[0]));

  const valid = dates.filter((value) => Number.isFinite(value)).sort((a, b) => b - a);
  if (valid.length === 0) return 0.45;
  const daysOld = Math.max(0, (now - valid[0]) / 86_400_000);
  const score = Math.exp(-daysOld / 14);
  return clamp(score, 0, 1);
}

function evidenceQualityScore(context: string, warningCount: number, sourceCount: number, factCount: number): number {
  const structuredSection = extractSection(context, "Structured Prophecy market records");
  const sourceSection = extractSection(context, "External/source-reference evidence fetched from Prophecy-listed sources");
  const webSection = extractSection(context, "External web research evidence");

  let score = 0.1;
  if (structuredSection && lowercase(structuredSection) !== "none") score += 0.25;
  if (sourceSection && lowercase(sourceSection) !== "none") score += 0.2;
  if (webSection && lowercase(webSection) !== "none") score += 0.2;
  score += Math.min(0.15, sourceCount * 0.015);
  score += Math.min(0.2, factCount * 0.015);
  score -= Math.min(0.25, warningCount * 0.06);
  return clamp(score, 0, 1);
}

export function parseSignalsFromContext(context: string): ParsedSignals {
  const warningCount = extractWarningCount(context);
  const extractedFacts = extractFactLines(context);
  const sourceCount = extractSourceCount(context);
  const evidenceQuality = evidenceQualityScore(context, warningCount, sourceCount, extractedFacts.length);

  return {
    marketProbability: extractPrimaryMarketProbability(context),
    volume: extractVolume(context),
    sentimentScore: sentimentFromContext(context),
    whaleFlowScore: whaleScoreFromContext(context),
    evidenceQualityScore: evidenceQuality,
    freshnessScore: freshnessScore(context),
    sourceCount,
    marketTitle: extractTitle(context),
    extractedFacts,
    warningCount,
  };
}

export function buildMarketSnapshot(input: {
  missionId: `0x${string}`;
  eventUrl: string;
  contextRaw: string;
  capturedAt?: string;
}): MarketSnapshot {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const normalizedUrl = normalizeUrl(input.eventUrl);
  const contextHash = hashId("context", normalizedUrl, input.contextRaw);
  const id = hashId(input.missionId, normalizedUrl, contextHash, capturedAt);

  return {
    id,
    missionId: input.missionId,
    eventUrl: normalizedUrl,
    eventId: parseEventId(normalizedUrl),
    capturedAt,
    contextHash,
    contextRaw: input.contextRaw,
    signals: parseSignalsFromContext(input.contextRaw),
  };
}

