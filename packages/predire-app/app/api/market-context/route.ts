import { NextRequest, NextResponse } from "next/server";
import {
  isHttpUrl,
  parseProphecyEventUrl,
  rateLimit,
  readJsonBody,
  safeFetchText,
} from "@/lib/server/security";

export const runtime = "nodejs";

type MarketContextResponse = {
  context: string;
  title?: string;
  description?: string;
  warnings: string[];
};

type MarketRecord = {
  eventId: string;
  marketId?: number;
  title?: string;
  optionLabel?: string;
  category?: string;
  status?: string;
  yesPrice?: number;
  noPrice?: number;
  volume?: string;
  closeTs?: string;
  resolutionCriteria?: string;
  sourceReferences?: string[];
  tags?: string[];
};

type MarketDomain = "sports" | "crypto" | "politics" | "weather" | "entertainment" | "finance" | "general";

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  pageSummary?: string;
};

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
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function eventIdFromUrl(url: string): string | undefined {
  return url.match(/\/event\/([^/?#]+)/)?.[1];
}

function contextLimit(): number {
  const raw = process.env.COMPANION_APP_CONTEXT_LIMIT?.trim();
  const parsed = raw ? Number(raw) : 9000;
  return Number.isFinite(parsed) && parsed > 500 ? parsed : 9000;
}

function sourceLimit(): number {
  const raw = process.env.COMPANION_APP_SOURCE_LIMIT?.trim();
  const parsed = raw ? Number(raw) : 4;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(8, parsed)) : 4;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEnabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function stripTags(value: string): string {
  return compactText(value.replace(/<[^>]+>/g, " "));
}

function classifyDomain(text: string): MarketDomain {
  if (/\b(beat|score|win|game|match|team|season|league|mlb|nba|nfl|football|soccer|tennis|baseball|hockey)\b/i.test(text)) {
    return "sports";
  }
  if (/\b(bitcoin|ethereum|token|crypto|btc|eth|sol|airdrop|chain|defi)\b/i.test(text)) return "crypto";
  if (/\b(election|president|senate|governor|minister|vote|poll|congress|parliament)\b/i.test(text)) return "politics";
  if (/\b(weather|storm|rain|temperature|hurricane|forecast|snow|heatwave)\b/i.test(text)) return "weather";
  if (/\b(movie|album|artist|stream|box office|award|celebrity|netflix|spotify)\b/i.test(text)) return "entertainment";
  if (/\b(stock|equity|earnings|fed|inflation|rate cut|nasdaq|s&p|dow|revenue|profit)\b/i.test(text)) return "finance";
  return "general";
}

function extractEmbeddedData(html: string, eventId?: string): string[] {
  const snippets: string[] = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const relevantPattern = new RegExp(
    [eventId, "market", "event", "resolution", "outcome", "prediction", "question"]
      .filter(Boolean)
      .join("|"),
    "i"
  );

  for (const match of html.matchAll(scriptPattern)) {
    const raw = match[1]?.trim();
    if (!raw || raw.length < 20 || !relevantPattern.test(raw)) continue;

    snippets.push(compactText(raw).slice(0, 900));
    if (snippets.length >= 2) break;
  }

  return snippets;
}

function extractSignalFacts(text: string): string[] {
  const facts = new Set<string>();

  for (const match of text.matchAll(/.{0,90}\b(?:YES|NO)?\s*\d{1,3}(?:\.\d+)?%\s*(?:YES|NO)?.{0,90}/gi)) {
    const value = compactText(match[0]);
    if (value.length > 8) facts.add(value.slice(0, 280));
  }

  for (const match of text.matchAll(/.{0,80}\b(?:resolution|criteria|market|question|outcome|winner|beat|will)\b.{0,160}/gi)) {
    const value = compactText(match[0]);
    if (value.length > 16) facts.add(value.slice(0, 320));
  }

  return Array.from(facts).slice(0, 16);
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

function recordFromObject(source: string): MarketRecord | null {
  const eventId = numberField(source, "eventId");
  if (!eventId) return null;

  const question = stringField(source, "question");
  const eventName = stringField(source, "eventName");
  const title = eventName || question;
  if (!title) return null;

  return {
    eventId: String(eventId),
    marketId: numberField(source, "marketId"),
    title,
    optionLabel: stringField(source, "optionLabel"),
    category: stringField(source, "category"),
    status: stringField(source, "status"),
    yesPrice: numberField(source, "yesPrice"),
    noPrice: numberField(source, "noPrice"),
    volume: stringField(source, "volume"),
    closeTs: stringField(source, "closeTs"),
    resolutionCriteria: stringField(source, "resolutionCriteria"),
    sourceReferences: stringArrayField(source, "sourceReferences"),
    tags: stringArrayField(source, "tags"),
  };
}

function extractMarketRecords(html: string, eventId?: string): MarketRecord[] {
  const text = compactText(html);
  const chunks = text.match(/\{[^{}]{0,8000}"marketId"\s*:\s*\d+[^{}]{0,8000}"eventId"\s*:\s*\d+[^{}]{0,8000}\}/g) ?? [];
  const records = new Map<string, MarketRecord>();

  for (const chunk of chunks) {
    const record = recordFromObject(chunk);
    if (!record) continue;
    if (eventId && record.eventId !== eventId) continue;
    records.set(`${record.eventId}:${record.marketId ?? record.title}`, record);
  }

  return [...records.values()];
}

function formatMarketRecord(record: MarketRecord): string {
  const exactOutcomeLabel =
    record.optionLabel && record.title && record.optionLabel !== record.title
      ? `${record.title}: ${record.optionLabel}`
      : record.optionLabel || record.title;

  return [
    `Event ID: ${record.eventId}`,
    record.marketId ? `Market ID: ${record.marketId}` : null,
    exactOutcomeLabel ? `Exact outcome label: ${exactOutcomeLabel}` : null,
    record.title ? `Question/Event: ${record.title}` : null,
    record.optionLabel ? `Outcome option: ${record.optionLabel}` : null,
    record.category ? `Category: ${record.category}` : null,
    record.status ? `Status: ${record.status}` : null,
    typeof record.yesPrice === "number" ? `YES price: ${(record.yesPrice * 100).toFixed(1)}%` : null,
    typeof record.noPrice === "number" ? `NO price: ${(record.noPrice * 100).toFixed(1)}%` : null,
    record.volume ? `Volume: ${record.volume}` : null,
    record.closeTs ? `Close time: ${record.closeTs}` : null,
    record.resolutionCriteria ? `Resolution criteria: ${record.resolutionCriteria}` : null,
    record.sourceReferences?.length ? `Prophecy source references: ${record.sourceReferences.join(", ")}` : null,
    record.tags?.length ? `Tags: ${record.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await safeFetchText(url, {
    timeoutMs,
    maxBytes: optionalNumber("COMPANION_APP_MAX_FETCH_BYTES", 1_500_000),
    userAgent: "Mozilla/5.0 (compatible; ProphecyCompanion/1.0; +https://prophecy.social)",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text;
}

async function fetchReferenceSummary(url: string): Promise<string | null> {
  try {
    if (!isHttpUrl(url)) return null;
    const html = await fetchText(url, optionalNumber("COMPANION_APP_RESEARCH_TIMEOUT_MS", 9000));
    const title =
      extractMeta(html, "og:title") ||
      extractMeta(html, "twitter:title") ||
      extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      url;
    const description =
      extractMeta(html, "og:description") ||
      extractMeta(html, "twitter:description") ||
      extractMeta(html, "description");
    const visible = extractVisibleText(html).slice(0, 900);

    return [`Source: ${title}`, `URL: ${url}`, description ? `Description: ${description}` : null, `Text sample: ${visible}`]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return `Source fetch failed: ${url} (${message})`;
  }
}

function buildResearchQueries(url: string, title?: string, description?: string, records: MarketRecord[] = [], domain: MarketDomain = "general"): string[] {
  const recordTitle = records.find((record) => record.title)?.title;
  const base = compactText(recordTitle || title || description || url);
  const queries = [base, `${base} latest news analysis`];

  if (domain === "sports") {
    queries.push(
      `${base} odds prediction probable starters injuries lineup`,
      `${base} head to head recent form momentum betting preview`
    );
  } else if (domain === "crypto") {
    queries.push(`${base} on-chain data price trend news sentiment`, `${base} market analysis catalysts risk`);
  } else if (domain === "politics") {
    queries.push(`${base} polls latest news probability analysis`, `${base} public sentiment expert forecast`);
  } else if (domain === "weather") {
    queries.push(`${base} official forecast weather service latest`, `${base} forecast model updates probability`);
  } else if (domain === "entertainment") {
    queries.push(`${base} latest news odds fan sentiment`, `${base} industry forecast analysis`);
  } else if (domain === "finance") {
    queries.push(`${base} market analysis latest news forecast`, `${base} earnings macro sentiment odds`);
  } else {
    queries.push(`${base} latest evidence sentiment forecast probability`);
  }

  return [...new Set(queries.filter(Boolean))].slice(0, optionalNumber("COMPANION_APP_RESEARCH_QUERY_LIMIT", 4));
}

function normalizeSearchUrl(rawUrl: string): string {
  const decoded = decodeHtmlEntities(rawUrl);

  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.href;
  } catch {
    return decoded;
  }
}

function extractDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>/i).slice(1);

  for (const block of blocks) {
    const anchor = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;

    const url = normalizeSearchUrl(anchor[1]);
    const title = stripTags(anchor[2]);
    const snippetMatch = block.match(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1] || snippetMatch[2] || "") : undefined;

    if (title && isHttpUrl(url) && !url.includes("prophecy.social")) {
      results.push({ title, url, snippet });
    }
    if (results.length >= optionalNumber("COMPANION_APP_RESEARCH_RESULT_LIMIT", 6)) break;
  }

  return results;
}

async function fetchSearchEvidence(url: string, title: string | undefined, description: string | undefined, records: MarketRecord[], domain: MarketDomain): Promise<string[]> {
  if (!isEnabled("COMPANION_APP_ENABLE_WEB_RESEARCH", true)) return [];

  const timeoutMs = optionalNumber("COMPANION_APP_RESEARCH_TIMEOUT_MS", 9000);
  const queries = buildResearchQueries(url, title, description, records, domain);
  const byUrl = new Map<string, SearchResult>();

  for (const query of queries) {
    try {
      const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, timeoutMs);
      for (const result of extractDuckDuckGoResults(html)) {
        if (!byUrl.has(result.url)) byUrl.set(result.url, result);
      }
    } catch {
      // Search is best-effort. The model should still use Prophecy context if search is unavailable.
    }
  }

  const pageLimit = optionalNumber("COMPANION_APP_RESEARCH_PAGE_LIMIT", 3);
  const textLimit = optionalNumber("COMPANION_APP_RESEARCH_PAGE_TEXT_LIMIT", 1200);
  const results = [...byUrl.values()].slice(0, optionalNumber("COMPANION_APP_RESEARCH_RESULT_LIMIT", 6));

  for (const result of results.slice(0, pageLimit)) {
    try {
      const html = await fetchText(result.url, timeoutMs);
      const pageTitle =
        extractMeta(html, "og:title") ||
        extractMeta(html, "twitter:title") ||
        extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const pageDescription =
        extractMeta(html, "og:description") ||
        extractMeta(html, "twitter:description") ||
        extractMeta(html, "description");
      result.pageSummary = compactText([pageTitle, pageDescription, extractVisibleText(html).slice(0, textLimit)].filter(Boolean).join(" | "));
    } catch {
      // Keep the search snippet if the page itself blocks scraping.
    }
  }

  return results.map((result, index) =>
    [
      `[${index + 1}] ${result.title}`,
      `URL: ${result.url}`,
      result.snippet ? `Snippet: ${result.snippet}` : null,
      result.pageSummary ? `Fetched page summary: ${result.pageSummary}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function buildContext(url: string, html: string): Promise<MarketContextResponse> {
  const warnings: string[] = [];
  const eventId = eventIdFromUrl(url);
  const title =
    extractMeta(html, "og:title") ||
    extractMeta(html, "twitter:title") ||
    extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description") ||
    extractMeta(html, "description");
  const visibleText = extractVisibleText(html);
  const embeddedData = extractEmbeddedData(html, eventId);
  const marketRecords = extractMarketRecords(html, eventId);
  const combinedForDomain = [title, description, visibleText, embeddedData.join("\n"), marketRecords.map(formatMarketRecord).join("\n")]
    .filter(Boolean)
    .join("\n");
  const domain = classifyDomain(combinedForDomain);
  const sourceReferences = [
    ...new Set(marketRecords.flatMap((record) => record.sourceReferences ?? [])),
  ].filter(isHttpUrl).slice(0, sourceLimit());
  const sourceSummaries = (
    await Promise.all(sourceReferences.map((reference) => fetchReferenceSummary(reference)))
  ).filter((summary): summary is string => Boolean(summary));
  const searchSummaries = await fetchSearchEvidence(url, title, description, marketRecords, domain);
  const signalFacts = extractSignalFacts([title, description, visibleText, embeddedData.join("\n")].filter(Boolean).join("\n"));

  if (visibleText.length < 200) {
    warnings.push("Visible text was sparse; context uses metadata and embedded page data.");
  }
  if (!title && !description && signalFacts.length === 0) {
    warnings.push("Could not extract clear market details from the page.");
  }

  const context = [
    "Auto-extracted Prophecy market context:",
    `URL: ${url}`,
    `Event ID: ${eventId || "unknown"}`,
    `Detected domain: ${domain}`,
    `Title: ${title || "unknown"}`,
    `Description: ${description || "unknown"}`,
    `Warnings: ${warnings.length ? warnings.join("; ") : "none"}`,
    "",
    "Structured Prophecy market records:",
    marketRecords.length ? marketRecords.map(formatMarketRecord).join("\n\n---\n\n") : "none",
    "",
    "External/source-reference evidence fetched from Prophecy-listed sources:",
    sourceSummaries.length ? sourceSummaries.join("\n\n---\n\n") : "none",
    "",
    "External web research evidence:",
    searchSummaries.length ? searchSummaries.join("\n\n---\n\n") : "none",
    "",
    "Extracted facts:",
    signalFacts.length ? signalFacts.map((fact) => `- ${fact}`).join("\n") : "none",
    "",
    "Compact embedded hints:",
    embeddedData.length ? embeddedData.map((snippet, index) => `[${index + 1}] ${snippet}`).join("\n\n") : "none",
    "",
    "Analysis instruction:",
    "Use the structured records, source-reference evidence, and web research evidence. If source summaries or web research exist, do not claim there is no external evidence. If evidence is incomplete, say exactly which evidence is missing and reduce confidence.",
  ].join("\n");

  return {
    context: context.slice(0, contextLimit()),
    title,
    description,
    warnings,
  };
}

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, "market-context", optionalNumber("COMPANION_APP_CONTEXT_RATE_LIMIT", 30), 60_000);
    if (limited) return limited;

    const body = await readJsonBody<{ url?: unknown }>(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const parsed = parseProphecyEventUrl(url);

    if (!parsed.valid) {
      return NextResponse.json({ error: "Use a valid Prophecy event URL." }, { status: 400 });
    }

    const response = await safeFetchText(url, {
      timeoutMs: optionalNumber("COMPANION_APP_RESEARCH_TIMEOUT_MS", 9000),
      maxBytes: optionalNumber("COMPANION_APP_MAX_PROPHECY_BYTES", 2_000_000),
      allowedHosts: ["prophecy.social"],
      userAgent: "Mozilla/5.0 (compatible; ProphecyCompanion/1.0; +https://prophecy.social)",
    });

    const payload = await buildContext(url, response.text);
    if (!response.ok) payload.warnings.push(`Fetch returned HTTP ${response.status}`);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not extract market context.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
