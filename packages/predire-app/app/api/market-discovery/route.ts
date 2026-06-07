import { NextRequest, NextResponse } from "next/server";
import { parseProphecyEventUrl, rateLimit, readJsonBody, safeFetchText } from "@/lib/server/security";

export const runtime = "nodejs";

type DiscoveryCandidate = {
  eventId: string;
  url: string;
  marketId?: number;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  marketProbability?: number;
  volume?: string;
  closeTs?: string;
  resolutionCriteria?: string;
  sourceReferences?: string[];
  tags?: string[];
  scoutReason?: string;
  directionFit?: "agree" | "disagree" | "neutral";
  context: string;
};

type ProphecyOutcome = {
  marketId?: number;
  question?: string;
  yesPrice?: number;
  noPrice?: number;
  volume?: string;
  optionLabel?: string;
  closingAt?: string;
  closeTs?: string;
  resolutionCriteria?: string;
  sourceReferences?: string[];
};

type ProphecyEventGroup = {
  kind?: string;
  eventId?: number;
  title?: string;
  eventName?: string;
  category?: string;
  status?: string;
  closingAt?: string;
  closeTs?: string;
  resolutionCriteria?: string;
  sourceReferences?: string[];
  tags?: string[];
  outcomes?: ProphecyOutcome[];
};

const PROPHECY_ORIGIN = "https://prophecy.social";
const DEFAULT_DISCOVERY_PATHS = [
  "/",
  "/partners",
];
const DEFAULT_FALLBACK_EVENT_IDS = [
  "14776",
  "13745",
  "14775",
  "14774",
  "14773",
  "14772",
  "14771",
  "14770",
  "14769",
  "14768",
  "14767",
  "14766",
  "14765",
  "14764",
  "14763",
  "14762",
  "14761",
  "14760",
  "14759",
  "14758",
  "14757",
  "14756",
  "14755",
  "14754",
  "14753",
  "14752",
  "14751",
  "14750",
];
const STALE_STATUS_PATTERN = /\b(resolved|voided|cancelled|canceled|closed|settled|expired|finalized)\b/i;
const ACTIVE_STATUS_PATTERN = /\b(open|trading open|active|live|buy|sell|ends in|from now)\b/i;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) return String.fromCharCode(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCharCode(Number.parseInt(key.slice(1), 10));
    return named[key] ?? `&${entity};`;
  });
}

function compactText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirst(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1] ? compactText(match[1]) : undefined;
}

function extractMeta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    extractFirst(
      html,
      new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i")
    ) ||
    extractFirst(
      html,
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i")
    )
  );
}

function extractVisibleText(html: string): string {
  return compactText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractEventIds(html: string): string[] {
  const ids = new Set<string>();
  const text = compactText(html);
  for (const match of html.matchAll(/\/event\/(\d+)/g)) ids.add(match[1]);
  for (const match of html.matchAll(/["']eventId["']\s*:\s*["']?(\d+)["']?/gi)) ids.add(match[1]);
  for (const match of text.matchAll(/"eventId"\s*:\s*["']?(\d+)["']?/gi)) ids.add(match[1]);
  for (const match of html.matchAll(/["']id["']\s*:\s*["']?(\d{4,})["']?/gi)) ids.add(match[1]);
  return [...ids];
}

function extractNextFlightText(html: string): string {
  const chunks: string[] = [];
  for (const match of html.matchAll(/<script>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown[];
      if (typeof parsed[1] === "string") chunks.push(parsed[1]);
    } catch {
      // Ignore non-JSON flight fragments.
    }
  }
  return chunks.join("\n");
}

function extractBalancedJsonObjects(text: string, needle: string): string[] {
  const objects: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const needleIndex = text.indexOf(needle, cursor);
    if (needleIndex < 0) break;
    const start = text.lastIndexOf("{", needleIndex);
    if (start < 0) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") inString = true;
      else if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(start, i + 1));
          cursor = i + 1;
          break;
        }
      }
    }

    if (cursor <= needleIndex) cursor = needleIndex + needle.length;
  }

  return objects;
}

function extractBalancedJsonArrays(text: string, needle: string): string[] {
  const arrays: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const needleIndex = text.indexOf(needle, cursor);
    if (needleIndex < 0) break;
    const start = text.indexOf("[", needleIndex);
    if (start < 0) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") inString = true;
      else if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) {
          arrays.push(text.slice(start, i + 1));
          cursor = i + 1;
          break;
        }
      }
    }

    if (cursor <= needleIndex) cursor = needleIndex + needle.length;
  }

  return arrays;
}

function eventIdFromUrl(url: string): string | undefined {
  return url.match(/\/event\/(\d+)/)?.[1];
}

function discoveryPathsForCategory(category: string): string[] {
  void category;
  return DEFAULT_DISCOVERY_PATHS;
}

function isEnabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function extractMarketProbability(text: string): number | undefined {
  const yesMatch = text.match(/(?:yes|YES)[^\d]{0,20}(\d{1,3}(?:\.\d+)?)\s*%/);
  const looseMatch = text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:yes|YES|chance|probability)?/);
  const raw = yesMatch?.[1] ?? looseMatch?.[1];
  if (!raw) return undefined;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
  return percent / 100;
}

function inferObjectiveDirection(objective: string): "agree" | "disagree" | "any" {
  const value = objective.toLowerCase();
  if (/\b(disagree|against|mispriced|undervalued|overvalued|edge|contrarian|wrong)\b/.test(value)) {
    return "disagree";
  }
  if (/\b(agree|confirm|safe|consensus|obvious|high probability|strong probability)\b/.test(value)) {
    return "agree";
  }
  return "any";
}

function candidateDirectionFit(candidate: DiscoveryCandidate, direction: "agree" | "disagree" | "any") {
  if (direction === "any") {
    return { fit: "neutral" as const, score: 0, reason: "No direction filter requested." };
  }

  if (candidate.marketProbability === undefined) {
    return {
      fit: "neutral" as const,
      score: 1,
      reason: "Market probability unavailable; kept for deep analysis.",
    };
  }

  const distanceFromCenter = Math.abs(candidate.marketProbability - 0.5);
  if (direction === "agree") {
    return {
      fit: "agree" as const,
      score: distanceFromCenter,
      reason: `Crowd already has a strong lean at ${(candidate.marketProbability * 100).toFixed(1)}%.`,
    };
  }

  return {
    fit: "disagree" as const,
    score: 1 - distanceFromCenter,
    reason: `Crowd price is not extreme at ${(candidate.marketProbability * 100).toFixed(1)}%, so it may have more room for edge.`,
  };
}

function fastMarketScore(candidate: DiscoveryCandidate, now = Date.now()): number {
  const closeTime = parseCloseTime(candidate.closeTs);
  if (closeTime === null || closeTime <= now) return 0;
  const minutes = (closeTime - now) / 60_000;
  if (minutes <= 15) return 3;
  if (minutes <= 60) return 2;
  if (minutes <= 240) return 1;
  return 0;
}

function matchesCategory(candidateText: string, category: string): boolean {
  if (!category || category === "any") return true;
  const text = candidateText.toLowerCase();
  const terms: Record<string, string[]> = {
    sports: ["beat", "score", "game", "match", "team", "season", "league", "mlb", "nba", "nfl", "football", "soccer", "tennis", "baseball", "hockey", "sport"],
    crypto: ["bitcoin", "ethereum", "token", "crypto", "btc", "eth", "sol", "price", "market cap"],
    economics: ["economy", "economic", "gdp", "inflation", "unemployment", "cpi", "recession", "central bank"],
    politics: ["election", "presidential", "president", "senate", "governor", "minister", "vote", "poll", "congress", "parliament"],
    entertainment: ["movie", "album", "artist", "stream", "box office", "award", "celebrity"],
    finance: ["stock", "rate", "fed", "inflation", "earnings", "nasdaq", "s&p", "market"],
    "pop culture": ["celebrity", "influencer", "viral", "trend", "music", "artist", "streamer", "tiktok", "youtube"],
    popculture: ["celebrity", "influencer", "viral", "trend", "music", "artist", "streamer", "tiktok", "youtube"],
    technology: ["ai", "technology", "tech", "software", "hardware", "startup", "apple", "google", "openai", "nvidia"],
    tech: ["ai", "technology", "tech", "software", "hardware", "startup", "apple", "google", "openai", "nvidia"],
  };
  return (terms[category] ?? [category]).some((term) => text.includes(term));
}

function declaredCategoryMatches(candidate: DiscoveryCandidate, category: string): boolean {
  if (!category || category === "any" || !candidate.category) return true;
  const requested = category.toLowerCase();
  const declared = candidate.category.toLowerCase();
  if (requested === declared) return true;
  if (requested === "sports" && declared === "sport") return true;
  return false;
}

function categorySignalMatches(candidate: DiscoveryCandidate, searchable: string, category: string, sparse: boolean): boolean {
  if (!category || category === "any" || sparse) return true;
  const declared = candidate.category?.toLowerCase();
  if (category === "sports" && (declared === "sport" || declared === "sports")) return true;
  return matchesCategory(searchable, category);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await safeFetchText(url, {
    timeoutMs: Number(process.env.COMPANION_APP_RESEARCH_TIMEOUT_MS ?? 9000),
    maxBytes: Number(process.env.COMPANION_APP_MAX_DISCOVERY_BYTES ?? process.env.COMPANION_APP_MAX_PROPHECY_BYTES ?? 6_000_000),
    allowedHosts: ["prophecy.social"],
    userAgent: "Mozilla/5.0 (compatible; ProphecyCompanionScout/1.0; +https://prophecy.social)",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text;
}

async function fetchHtmlSafe(url: string): Promise<string> {
  try {
    return await fetchHtml(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 404 from https:\/\/prophecy\.social\//.test(message)) {
      console.warn("[MarketDiscovery] Fetch skipped", { url, error: message });
    }
    return "";
  }
}

function configuredFallbackEventIds(): string[] {
  if (!isEnabled("COMPANION_DISCOVERY_ENABLE_FALLBACK_EVENTS", true)) return [];
  const configured = process.env.COMPANION_DISCOVERY_FALLBACK_EVENTS?.trim();
  if (!configured) return DEFAULT_FALLBACK_EVENT_IDS;
  return configured
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function parseCloseTime(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function containsResolvedTimeline(text: string): boolean {
  const compact = text.toLowerCase();
  if (/\b(resolved|voided)\b.{0,40}\b\d+\s*(m|h|d|day|days|hour|hours|minute|minutes)\s+ago\b/i.test(compact)) {
    return true;
  }
  if (/\btrading closed\b.{0,40}\b\d+\s*(m|h|d|day|days|hour|hours|minute|minutes)\s+ago\b/i.test(compact)) {
    return true;
  }
  return false;
}

function candidateFreshness(candidate: DiscoveryCandidate, now = Date.now()): {
  tradable: boolean;
  staleReason?: string;
} {
  const searchable = [candidate.status, candidate.title, candidate.description, candidate.context]
    .filter(Boolean)
    .join(" ");
  const closeTime = parseCloseTime(candidate.closeTs);

  if (candidate.status && STALE_STATUS_PATTERN.test(candidate.status)) {
    return { tradable: false, staleReason: `status is ${candidate.status}` };
  }
  if (closeTime !== null && closeTime <= now) {
    return { tradable: false, staleReason: "close time is in the past" };
  }
  if (containsResolvedTimeline(searchable)) {
    return { tradable: false, staleReason: "market timeline is already resolved or closed" };
  }
  if (/\b(yes|no)\s*###\s*resolved\b/i.test(searchable) || /\b###\s*voided\b/i.test(searchable)) {
    return { tradable: false, staleReason: "market has resolved/voided markers" };
  }
  if (ACTIVE_STATUS_PATTERN.test(searchable)) {
    return { tradable: true };
  }
  if (closeTime !== null && closeTime > now) {
    return { tradable: true };
  }

  return { tradable: false, staleReason: "no active trading signal found" };
}

function stringField(source: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]*)"`, "i"));
  return match?.[1] ? compactText(match[1]) : undefined;
}

function numberField(source: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`"${escaped}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
  const value = match?.[1] ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

function stringArrayField(source: string, key: string): string[] | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`"${escaped}"\\s*:\\s*\\[([^\\]]*)\\]`, "i"));
  if (!match?.[1]) return undefined;
  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => compactText(item[1]));
  return values.length > 0 ? values : undefined;
}

function candidateFromObject(source: string): DiscoveryCandidate | null {
  const eventId = numberField(source, "eventId");
  if (!eventId) return null;

  const question = stringField(source, "question");
  const eventName = stringField(source, "eventName");
  const optionLabel = stringField(source, "optionLabel");
  const resolutionCriteria = stringField(source, "resolutionCriteria");
  const category = stringField(source, "category");
  const yesPrice = numberField(source, "yesPrice");
  const noPrice = numberField(source, "noPrice");
  const marketId = numberField(source, "marketId");
  const volume = stringField(source, "volume");
  const closeTs = stringField(source, "closeTs") ?? stringField(source, "closingAt");
  const status = stringField(source, "status");
  const sourceReferences = stringArrayField(source, "sourceReferences");
  const tags = stringArrayField(source, "tags");
  const title = eventName || question;
  if (!title) return null;
  const displayTitle = optionLabel && optionLabel !== title && !/^(yes|no)$/i.test(optionLabel)
    ? `${title}: ${optionLabel}`
    : title;

  const context = [
    `URL: ${PROPHECY_ORIGIN}/event/${eventId}`,
    `Event ID: ${eventId}`,
    marketId ? `Market ID: ${marketId}` : null,
    `Title: ${title}`,
    optionLabel ? `Outcome option: ${optionLabel}` : null,
    category ? `Category: ${category}` : null,
    status ? `Status: ${status}` : null,
    typeof yesPrice === "number" ? `YES price: ${(yesPrice * 100).toFixed(1)}%` : null,
    typeof noPrice === "number" ? `NO price: ${(noPrice * 100).toFixed(1)}%` : null,
    volume ? `Volume: ${volume}` : null,
    closeTs ? `Close time: ${closeTs}` : null,
    resolutionCriteria ? `Resolution criteria: ${resolutionCriteria}` : null,
    sourceReferences?.length ? `Sources: ${sourceReferences.join(", ")}` : null,
    tags?.length ? `Tags: ${tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    eventId: String(eventId),
    url: `${PROPHECY_ORIGIN}/event/${eventId}`,
    marketId,
    title: displayTitle,
    description: optionLabel && optionLabel !== "Yes" ? `Outcome: ${optionLabel}` : resolutionCriteria,
    category,
    status,
    marketProbability: yesPrice,
    volume,
    closeTs,
    resolutionCriteria,
    sourceReferences,
    tags,
    context,
  };
}

function candidateFromEventGroup(group: ProphecyEventGroup): DiscoveryCandidate[] {
  if (group.kind && group.kind !== "event") return [];
  if (!group.eventId) return [];
  const title = group.title ?? group.eventName;
  if (!title) return [];

  const outcomes = Array.isArray(group.outcomes) && group.outcomes.length > 0
    ? group.outcomes
    : [{} as ProphecyOutcome];

  return outcomes.slice(0, 8).map((outcome) => {
    const closeTs = outcome.closingAt ?? outcome.closeTs ?? group.closingAt ?? group.closeTs;
    const closeTime = parseCloseTime(closeTs);
    const status = group.status ?? (closeTime && closeTime > Date.now() ? "Trading Open" : undefined);
    const sourceReferences = outcome.sourceReferences ?? group.sourceReferences;
    const resolutionCriteria = outcome.resolutionCriteria ?? group.resolutionCriteria;
    const optionLabel = outcome.optionLabel ?? outcome.question;
    const displayTitle = optionLabel && optionLabel !== title ? `${title}: ${optionLabel}` : title;
    const context = [
      `URL: ${PROPHECY_ORIGIN}/event/${group.eventId}`,
      `Event ID: ${group.eventId}`,
      outcome.marketId ? `Market ID: ${outcome.marketId}` : null,
      `Exact outcome label: ${displayTitle}`,
      `Title: ${title}`,
      optionLabel ? `Outcome option: ${optionLabel}` : null,
      group.category ? `Category: ${group.category}` : null,
      status ? `Status: ${status}` : null,
      typeof outcome.yesPrice === "number" ? `YES price: ${(outcome.yesPrice * 100).toFixed(1)}%` : null,
      typeof outcome.noPrice === "number" ? `NO price: ${(outcome.noPrice * 100).toFixed(1)}%` : null,
      outcome.volume ? `Volume: ${outcome.volume}` : null,
      closeTs ? `Close time: ${closeTs}` : null,
      resolutionCriteria ? `Resolution criteria: ${resolutionCriteria}` : null,
      sourceReferences?.length ? `Sources: ${sourceReferences.join(", ")}` : null,
      group.tags?.length ? `Tags: ${group.tags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      eventId: String(group.eventId),
      url: `${PROPHECY_ORIGIN}/event/${group.eventId}`,
      marketId: outcome.marketId,
      title: displayTitle,
      description: optionLabel && optionLabel !== title ? title : resolutionCriteria,
      category: group.category,
      status,
      marketProbability: outcome.yesPrice,
      volume: outcome.volume,
      closeTs,
      resolutionCriteria,
      sourceReferences,
      tags: group.tags,
      context,
    };
  });
}

function extractEmbeddedCandidates(html: string): DiscoveryCandidate[] {
  const text = compactText(`${extractNextFlightText(html)}\n${html}`);
  const candidates = new Map<string, DiscoveryCandidate>();
  for (const arraySource of extractBalancedJsonArrays(text, "\"featuredGroups\"")) {
    try {
      const groups = JSON.parse(arraySource) as ProphecyEventGroup[];
      for (const group of groups) {
        for (const candidate of candidateFromEventGroup(group)) {
          const key = `${candidate.eventId}:${candidate.marketId ?? candidate.title}`;
          candidates.set(key, candidate);
        }
      }
    } catch {
      // Ignore malformed flight arrays.
    }
  }

  for (const objectSource of extractBalancedJsonObjects(text, "\"kind\":\"event\"")) {
    try {
      const group = JSON.parse(objectSource) as ProphecyEventGroup;
      for (const candidate of candidateFromEventGroup(group)) {
        const key = `${candidate.eventId}:${candidate.marketId ?? candidate.title}`;
        candidates.set(key, candidate);
      }
    } catch {
      // Ignore malformed or non-market flight objects.
    }
  }

  const chunks = text.match(/\{[^{}]{0,8000}"marketId"\s*:\s*\d+[^{}]{0,8000}"eventId"\s*:\s*\d+[^{}]{0,8000}\}/g) ?? [];

  for (const chunk of chunks) {
    const candidate = candidateFromObject(chunk);
    if (!candidate) continue;
    const key = `${candidate.eventId}:${candidate.marketId ?? candidate.title}`;
    candidates.set(key, candidate);
  }

  return [...candidates.values()];
}

async function buildCandidate(eventId: string): Promise<DiscoveryCandidate | null> {
  const url = `${PROPHECY_ORIGIN}/event/${eventId}`;
  const html = await fetchHtml(url);
  const title =
    extractMeta(html, "og:title") ||
    extractMeta(html, "twitter:title") ||
    extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description") ||
    extractMeta(html, "description");
  const visibleText = extractVisibleText(html);
  const joined = [title, description, visibleText].filter(Boolean).join("\n");
  const marketProbability = extractMarketProbability(joined);
  const context = [
    `URL: ${url}`,
    `Event ID: ${eventId}`,
    `Title: ${title ?? "unknown"}`,
    `Description: ${description ?? "unknown"}`,
    `Observed market probability: ${
      typeof marketProbability === "number" ? `${(marketProbability * 100).toFixed(1)}%` : "unknown"
    }`,
    `Visible text sample: ${visibleText.slice(0, 900) || "none"}`,
  ].join("\n");

  if (!title && !description && visibleText.length < 40) return null;
  return { eventId, url, title, description, marketProbability, context };
}

async function buildCandidateSafe(eventId: string): Promise<DiscoveryCandidate | null> {
  try {
    return await buildCandidate(eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 404 from https:\/\/prophecy\.social\/event\//.test(message)) {
      console.warn("[MarketDiscovery] Event fetch skipped", { eventId, error: message });
    }
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(
      request,
      "market-discovery",
      Number(process.env.COMPANION_APP_DISCOVERY_RATE_LIMIT ?? 12),
      60_000
    );
    if (limited) return limited;

    const body = await readJsonBody<{
      category?: unknown;
      limit?: unknown;
      seedUrls?: unknown;
      objective?: unknown;
    }>(request, 24_576);
    const category = typeof body.category === "string" ? body.category.toLowerCase() : "any";
    const objective = typeof body.objective === "string" ? body.objective : "";
    const direction = inferObjectiveDirection(objective);
    const limitRaw = typeof body.limit === "number" ? body.limit : Number(body.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 12;
    const seedUrls = Array.isArray(body.seedUrls)
      ? body.seedUrls.filter((url): url is string => {
          if (typeof url !== "string") return false;
          return parseProphecyEventUrl(url).valid;
        })
      : [];

    const directSeedEventIds = seedUrls
      .map(eventIdFromUrl)
      .filter((eventId): eventId is string => Boolean(eventId));
    const fallbackEventIds = configuredFallbackEventIds();
    const discoveryUrls = [
      ...discoveryPathsForCategory(category).map((path) => `${PROPHECY_ORIGIN}${path}`),
      ...seedUrls.slice(0, 3),
    ];
    const discoveryHtml = (await Promise.all(discoveryUrls.map(fetchHtmlSafe))).join("\n");
    const embeddedCandidates = extractEmbeddedCandidates(discoveryHtml);
    const eventIds = [
      ...new Set([
        ...directSeedEventIds,
        ...embeddedCandidates.map((candidate) => candidate.eventId),
        ...extractEventIds(discoveryHtml),
        ...fallbackEventIds,
      ]),
    ].slice(0, Math.max(limit * 10, 120));
    const candidates: Array<DiscoveryCandidate & { score: number }> = [];
    const filtered: Array<{ eventId: string; reason: string }> = [];
    const maxCandidatePool = Math.max(limit, limit * 5);
    const maxPerEvent = Math.max(
      1,
      Math.floor(Number(process.env.COMPANION_DISCOVERY_MAX_MARKETS_PER_EVENT ?? 8))
    );
    const perEventCounts = new Map<string, number>();

    const embeddedByEventId = new Map<string, DiscoveryCandidate[]>();
    for (const candidate of embeddedCandidates) {
      const list = embeddedByEventId.get(candidate.eventId) ?? [];
      list.push(candidate);
      embeddedByEventId.set(candidate.eventId, list);
    }

    for (const eventId of eventIds) {
      const candidatePool = embeddedByEventId.get(eventId) ?? [await buildCandidateSafe(eventId)];
      for (const candidate of candidatePool) {
      if (!candidate) continue;
      const searchable = [candidate.title, candidate.description, candidate.context].filter(Boolean).join(" ");
      const isDirectSeed = directSeedEventIds.includes(eventId);
      const isFallback = fallbackEventIds.includes(eventId);
      const sparse = searchable.length < 260;
      const freshness = candidateFreshness(candidate);
      if (!freshness.tradable && !isDirectSeed && !isFallback) {
        filtered.push({ eventId, reason: freshness.staleReason ?? "not tradable" });
        continue;
      }
      if (!isDirectSeed && !declaredCategoryMatches(candidate, category)) continue;
      if (!isDirectSeed && !categorySignalMatches(candidate, searchable, category, sparse)) continue;
      const eventCount = perEventCounts.get(candidate.eventId) ?? 0;
      if (!isDirectSeed && eventCount >= maxPerEvent) continue;
      const directional = candidateDirectionFit(candidate, direction);
      candidates.push({
        ...candidate,
        directionFit: directional.fit,
        scoutReason: directional.reason,
        score: directional.score + fastMarketScore(candidate),
      });
      perEventCounts.set(candidate.eventId, eventCount + 1);
      if (candidates.length >= maxCandidatePool) break;
      }
      if (candidates.length >= maxCandidatePool) break;
    }

    const sorted = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...candidate }) => candidate);

    return NextResponse.json({
      candidates: sorted,
      direction,
      filteredStaleCount: filtered.length,
      message: sorted.length
        ? undefined
        : "No active/tradable Prophecy markets were found from the current discovery pages. Add live Prophecy search/event URLs as seed pages to widen Scout.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not discover Prophecy markets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
