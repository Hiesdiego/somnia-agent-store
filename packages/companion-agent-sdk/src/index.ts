import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { OpenAIAdapter } from "somnia-agent-kit";

type LlmProvider = "openai" | "anthropic" | "groq";
type MarketPageContext = {
  url: string;
  fetchedAt: string;
  title?: string;
  description?: string;
  domain: MarketDomain;
  visibleText: string;
  embeddedData: string[];
  marketFacts: MarketFact[];
  marketRecords: MarketRecord[];
  extractedSignals: ExtractedSignals;
  research: ResearchEvidence;
  warnings: string[];
};

const InputSchema = z.object({
  eventUrl: z.string().url().refine((u) => u.includes("prophecy.social/event/"), {
    message: "eventUrl must be a prophecy.social event URL",
  }),
  ask: z.string().min(8).max(400).optional(),
  extraContext: z.string().max(2000).optional(),
});

type CompanionInput = z.infer<typeof InputSchema>;
type MarketFact = {
  path: string;
  value: string;
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
type ExtractedSignals = {
  eventId?: string;
  probabilities: string[];
  dates: string[];
  outcomes: string[];
};
type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  pageSummary?: string;
};
type MarketDomain = "sports" | "crypto" | "politics" | "weather" | "entertainment" | "finance" | "general";
type ResearchEvidence = {
  enabled: boolean;
  queries: string[];
  results: SearchResult[];
  warnings: string[];
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function debugLog(message: string, data?: Record<string, unknown>) {
  if (optional("COMPANION_DEBUG") !== "1") return;
  console.error(`[Companion] ${message}`, data ?? "");
}

function isEnabled(name: string, fallback: boolean): boolean {
  const raw = optional(name)?.toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function selectedProvider(): LlmProvider {
  const raw = optional("COMPANION_LLM_PROVIDER")?.toLowerCase() || "openai";
  if (raw === "openai" || raw === "anthropic" || raw === "groq") return raw;
  throw new Error("COMPANION_LLM_PROVIDER must be one of: openai, anthropic, groq");
}

function modelFor(provider: LlmProvider): string {
  if (provider === "groq") return optional("GROQ_MODEL") || "llama-3.3-70b-versatile";
  if (provider === "anthropic") {
    return optional("ANTHROPIC_MODEL") || optional("COMPANION_MODEL") || "claude-3-5-sonnet-latest";
  }
  return optional("COMPANION_MODEL") || "gpt-4o-mini";
}

function applyOpenAiCompatibleEnv(baseUrl: string, apiKey?: string) {
  const normalized = baseUrl.replace(/\/$/, "");

  // Some SDK wrappers read provider settings from env instead of constructor config.
  process.env.OPENAI_BASE_URL = normalized;
  process.env.OPENAI_API_BASE_URL = normalized;
  process.env.OPENAI_BASEURL = normalized;
  if (apiKey) process.env.OPENAI_API_KEY = apiKey;
}

async function buildLlm(): Promise<OpenAIAdapter> {
  const { OpenAIAdapter } = await import("somnia-agent-kit");
  const provider = selectedProvider();
  const model = modelFor(provider);

  if (provider === "groq") {
    const groqKey = required("GROQ_API_KEY");
    const baseUrl = optional("COMPANION_OPENAI_BASE_URL") || "https://api.groq.com/openai/v1";

    applyOpenAiCompatibleEnv(baseUrl, groqKey);

    return new OpenAIAdapter({
      apiKey: groqKey,
      baseURL: baseUrl,
      defaultModel: model,
    });
  }

  if (provider === "anthropic") {
    throw new Error(
      "The installed somnia-agent-kit version does not export an Anthropic adapter. Use COMPANION_LLM_PROVIDER=openai or groq for this package."
    );
  } else {
    const openAiKey = required("OPENAI_API_KEY");
    const baseUrl = optional("COMPANION_OPENAI_BASE_URL");

    if (baseUrl) applyOpenAiCompatibleEnv(baseUrl, openAiKey);

    return new OpenAIAdapter({
      apiKey: openAiKey,
      baseURL: baseUrl,
      defaultModel: model,
    });
  }
}

function parseInput(): CompanionInput {
  const raw = process.argv.slice(2).find((arg) => arg !== "--");
  if (raw) {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return InputSchema.parse({ eventUrl: raw });
    }

    return InputSchema.parse(JSON.parse(raw));
  }

  const eventUrl = optional("COMPANION_EVENT_URL");
  if (eventUrl) {
    return InputSchema.parse({
      eventUrl,
      ask: optional("COMPANION_DEFAULT_ASK"),
      extraContext: optional("COMPANION_EXTRA_CONTEXT"),
    });
  }

  throw new Error(
    'Pass input JSON/URL or set COMPANION_EVENT_URL. Example: pnpm start -- https://prophecy.social/event/14776'
  );
}

export function parseCompanionInput(input: unknown): CompanionInput {
  return InputSchema.parse(input);
}

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
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return compactText(html.replace(/<[^>]+>/g, " "));
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

    snippets.push(compactText(raw).slice(0, 5000));
    if (snippets.length >= 6) break;
  }

  return snippets;
}

function decodeJsEscapes(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ");
}

function eventIdFromUrl(url: string): string | undefined {
  return url.match(/\/event\/([^/?#]+)/)?.[1];
}

function safeJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
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
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
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
    closeTs: stringField(source, "closeTs") || stringField(source, "closingAt"),
    resolutionCriteria: stringField(source, "resolutionCriteria"),
    sourceReferences: stringArrayField(source, "sourceReferences"),
    tags: stringArrayField(source, "tags"),
  };
}

function recordsFromEventGroup(group: ProphecyEventGroup): MarketRecord[] {
  if (group.kind && group.kind !== "event") return [];
  if (!group.eventId) return [];
  const title = group.title || group.eventName;
  if (!title) return [];

  const outcomes = Array.isArray(group.outcomes) && group.outcomes.length > 0 ? group.outcomes : [{} as ProphecyOutcome];
  return outcomes.slice(0, optionalNumber("COMPANION_MAX_OUTCOME_RECORDS", 16)).map((outcome) => ({
    eventId: String(group.eventId),
    marketId: outcome.marketId,
    title,
    optionLabel: outcome.optionLabel || outcome.question,
    category: group.category,
    status: group.status,
    yesPrice: outcome.yesPrice,
    noPrice: outcome.noPrice,
    volume: outcome.volume,
    closeTs: outcome.closingAt || outcome.closeTs || group.closingAt || group.closeTs,
    resolutionCriteria: outcome.resolutionCriteria || group.resolutionCriteria,
    sourceReferences: outcome.sourceReferences || group.sourceReferences,
    tags: group.tags,
  }));
}

function extractMarketRecords(html: string, eventId?: string): MarketRecord[] {
  const text = compactText(`${extractNextFlightText(html)}\n${html}`);
  const records = new Map<string, MarketRecord>();

  for (const arraySource of extractBalancedJsonArrays(text, "\"featuredGroups\"")) {
    const groups = safeJsonParse(arraySource) as ProphecyEventGroup[] | undefined;
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const record of recordsFromEventGroup(group)) {
        if (eventId && record.eventId !== eventId) continue;
        records.set(`${record.eventId}:${record.marketId ?? record.optionLabel ?? record.title}`, record);
      }
    }
  }

  for (const objectSource of extractBalancedJsonObjects(text, "\"kind\":\"event\"")) {
    const group = safeJsonParse(objectSource) as ProphecyEventGroup | undefined;
    if (!group || typeof group !== "object") continue;
    for (const record of recordsFromEventGroup(group)) {
      if (eventId && record.eventId !== eventId) continue;
      records.set(`${record.eventId}:${record.marketId ?? record.optionLabel ?? record.title}`, record);
    }
  }

  for (const objectSource of extractBalancedJsonObjects(text, "\"marketId\"")) {
    const record = recordFromObject(objectSource);
    if (!record) continue;
    if (eventId && record.eventId !== eventId) continue;
    records.set(`${record.eventId}:${record.marketId ?? record.optionLabel ?? record.title}`, record);
  }

  return [...records.values()].slice(0, optionalNumber("COMPANION_MAX_OUTCOME_RECORDS", 16));
}

function formatMarketRecord(record: MarketRecord, index: number): string {
  const exactOutcome = record.optionLabel && record.title && record.optionLabel !== record.title
    ? `${record.title}: ${record.optionLabel}`
    : record.optionLabel || record.title || `Outcome ${index + 1}`;
  return [
    `[${index + 1}] exactOutcomeLabel: ${exactOutcome}`,
    record.marketId ? `marketId: ${record.marketId}` : null,
    record.title ? `eventQuestion: ${record.title}` : null,
    record.optionLabel ? `submarketOption: ${record.optionLabel}` : null,
    record.category ? `category: ${record.category}` : null,
    record.status ? `status: ${record.status}` : null,
    typeof record.yesPrice === "number" ? `yesMarketProbability: ${(record.yesPrice * 100).toFixed(1)}%` : null,
    typeof record.noPrice === "number" ? `noMarketProbability: ${(record.noPrice * 100).toFixed(1)}%` : null,
    record.volume ? `volume: ${record.volume}` : null,
    record.closeTs ? `closeTime: ${record.closeTs}` : null,
    record.resolutionCriteria ? `resolutionCriteria: ${record.resolutionCriteria}` : null,
    record.sourceReferences?.length ? `sourceReferences: ${record.sourceReferences.join(", ")}` : null,
    record.tags?.length ? `tags: ${record.tags.join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

function extractJsonPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];

  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = safeJsonParse(decodeHtmlEntities(match[1]?.trim() || ""));
    if (parsed !== undefined) payloads.push(parsed);
  }

  const nextData = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData?.[1]) {
    const parsed = safeJsonParse(decodeHtmlEntities(nextData[1].trim()));
    if (parsed !== undefined) payloads.push(parsed);
  }

  return payloads;
}

function collectMarketFacts(value: unknown, path = "$", facts: MarketFact[] = []): MarketFact[] {
  if (facts.length >= optionalNumber("COMPANION_MARKET_FACT_LIMIT", 120)) return facts;

  if (value === null || value === undefined) return facts;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const key = path.toLowerCase();
    const text = String(value);
    const interesting =
      /(market|event|question|title|description|resolution|rule|criteria|outcome|probability|price|odds|volume|liquidity|close|end|date|sport|team|league|status|result|winner|yes|no)/i.test(
        key
      ) || /(yes|no|\d+(?:\.\d+)?%|resolution|market|winner|beat|vs\.?|versus)/i.test(text);

    if (interesting && text.trim()) {
      facts.push({ path, value: compactText(text).slice(0, 500) });
    }
    return facts;
  }

  if (Array.isArray(value)) {
    value.slice(0, 60).forEach((item, index) => collectMarketFacts(item, `${path}[${index}]`, facts));
    return facts;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 120)) {
      collectMarketFacts(child, `${path}.${key}`, facts);
      if (facts.length >= optionalNumber("COMPANION_MARKET_FACT_LIMIT", 120)) break;
    }
  }

  return facts;
}

function collectTextMarketFacts(args: {
  title?: string;
  description?: string;
  visibleText: string;
  embeddedData: string[];
}): MarketFact[] {
  const facts: MarketFact[] = [];
  if (args.title) facts.push({ path: "$.meta.title", value: args.title });
  if (args.description) facts.push({ path: "$.meta.description", value: args.description });

  const sources = [
    { path: "$.visibleText", text: args.visibleText },
    ...args.embeddedData.map((text, index) => ({ path: `$.embeddedData[${index}]`, text })),
  ];

  const keyValuePattern =
    /(?:^|[,{\\\s])["']?(title|question|description|resolutionCriteria|resolution|rules|criteria|outcome|outcomes|yes|no|probability|price|odds|volume|liquidity|event|market)["']?\s*[:=]\s*["']([^"'{}[\]]{2,500})["']/gi;

  for (const source of sources) {
    const text = decodeJsEscapes(source.text);
    for (const match of text.matchAll(keyValuePattern)) {
      facts.push({
        path: `${source.path}.${match[1]}`,
        value: compactText(match[2]).slice(0, 500),
      });
    }

    for (const match of text.matchAll(/.{0,90}\b(?:YES|NO)?\s*\d{1,3}(?:\.\d+)?%\s*(?:YES|NO)?.{0,90}/gi)) {
      const value = compactText(match[0]);
      if (value.length > 8) facts.push({ path: `${source.path}.probabilityContext`, value: value.slice(0, 500) });
    }
  }

  return dedupeFacts(facts);
}

function classifyDomain(text: string): MarketDomain {
  if (/\b(mlb|nba|nfl|nhl|epl|football|soccer|baseball|basketball|tennis|ufc|fight|game|match|team|league|beat|vs\.?|versus|score|injur|lineup|starter)\b/i.test(text)) {
    return "sports";
  }
  if (/\b(bitcoin|btc|ethereum|eth|crypto|token|coin|defi|price|market cap|chain|airdrop)\b/i.test(text)) return "crypto";
  if (/\b(election|president|senate|congress|minister|vote|poll|politic|government|court|law)\b/i.test(text)) return "politics";
  if (/\b(weather|rain|storm|temperature|hurricane|snow|forecast|climate)\b/i.test(text)) return "weather";
  if (/\b(movie|music|album|artist|celebrity|award|box office|streaming|tv show)\b/i.test(text)) return "entertainment";
  if (/\b(stock|equity|earnings|fed|inflation|rate cut|nasdaq|s&p|dow|revenue|profit)\b/i.test(text)) return "finance";
  return "general";
}

function extractSignals(text: string, eventId?: string): ExtractedSignals {
  const probabilities = Array.from(
    new Set(Array.from(text.matchAll(/\b(?:YES|NO)?\s*\d{1,3}(?:\.\d+)?%|\b\d{1,3}(?:\.\d+)?%\s*(?:YES|NO)?/gi)).map((m) => compactText(m[0])))
  ).slice(0, 20);

  const dates = Array.from(
    new Set(
      Array.from(
        text.matchAll(
          /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi
        )
      ).map((m) => compactText(m[0]))
    )
  ).slice(0, 12);

  const outcomes = Array.from(new Set(Array.from(text.matchAll(/\b(?:YES|NO|UP|DOWN|OVER|UNDER)\b/gi)).map((m) => m[0].toUpperCase()))).slice(0, 12);

  return { eventId, probabilities, dates, outcomes };
}

function dedupeFacts(facts: MarketFact[]): MarketFact[] {
  const seen = new Set<string>();
  const deduped: MarketFact[] = [];

  for (const fact of facts) {
    const key = `${fact.path}:${fact.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }

  return deduped;
}

function buildResearchQueries(
  input: CompanionInput,
  title?: string,
  description?: string,
  domain?: MarketDomain,
  marketRecords: MarketRecord[] = []
): string[] {
  const base = title || description || input.eventUrl;
  const queries = [
    base,
    `${base} latest news analysis`,
  ];
  const outcomeLabels = marketRecords
    .map((record) => record.optionLabel)
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);
  if (outcomeLabels.length > 1) {
    queries.push(`${base} ${outcomeLabels.join(" ")} comparison latest data`);
  }

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

  return Array.from(new Set(queries.map((query) => compactText(query)).filter(Boolean))).slice(
    0,
    optionalNumber("COMPANION_RESEARCH_QUERY_LIMIT", 4)
  );
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

    if (title && url.startsWith("http")) results.push({ title, url, snippet });
    if (results.length >= optionalNumber("COMPANION_RESEARCH_RESULT_LIMIT", 8)) break;
  }

  return results;
}

function normalizeSearchUrl(rawUrl: string): string {
  const decoded = decodeHtmlEntities(rawUrl);

  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
    return url.href;
  } catch {
    return decoded;
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          optional("COMPANION_USER_AGENT") ||
          "Mozilla/5.0 (compatible; ProphecyCompanion/1.0; +https://prophecy.social)",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchResearchEvidence(
  input: CompanionInput,
  title?: string,
  description?: string,
  domain?: MarketDomain,
  marketRecords: MarketRecord[] = []
): Promise<ResearchEvidence> {
  const enabled = isEnabled("COMPANION_ENABLE_WEB_RESEARCH", true);
  const warnings: string[] = [];
  if (!enabled) return { enabled, queries: [], results: [], warnings };

  const timeoutMs = optionalNumber("COMPANION_RESEARCH_TIMEOUT_MS", 10_000);
  const queries = buildResearchQueries(input, title, description, domain, marketRecords);
  const byUrl = new Map<string, SearchResult>();

  for (const url of marketRecords.flatMap((record) => record.sourceReferences ?? [])) {
    if (!/^https?:\/\//i.test(url)) continue;
    if (!byUrl.has(url)) byUrl.set(url, { title: `Prophecy source reference: ${url}`, url });
  }

  for (const query of queries) {
    try {
      const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, timeoutMs);
      for (const result of extractDuckDuckGoResults(html)) {
        if (!byUrl.has(result.url)) byUrl.set(result.url, result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown search error";
      warnings.push(`Search failed for "${query}": ${message}`);
    }
  }

  const results = Array.from(byUrl.values()).slice(0, optionalNumber("COMPANION_RESEARCH_RESULT_LIMIT", 8));

  if (isEnabled("COMPANION_FETCH_RESEARCH_PAGES", true)) {
    const pageLimit = optionalNumber("COMPANION_RESEARCH_PAGE_LIMIT", 3);
    for (const result of results.slice(0, pageLimit)) {
      try {
        const html = await fetchText(result.url, timeoutMs);
        const title = extractMeta(html, "og:title") || extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
        const description = extractMeta(html, "og:description") || extractMeta(html, "description");
        const body = extractVisibleText(html).slice(0, optionalNumber("COMPANION_RESEARCH_PAGE_TEXT_LIMIT", 1500));
        result.pageSummary = compactText([title, description, body].filter(Boolean).join(" | "));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown page fetch error";
        warnings.push(`Could not fetch research page "${result.title}": ${message}`);
      }
    }
  }

  return { enabled, queries, results, warnings };
}

async function fetchMarketPage(input: CompanionInput): Promise<MarketPageContext> {
  const timeoutMs = optionalNumber("COMPANION_FETCH_TIMEOUT_MS", 12_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.eventUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          optional("COMPANION_USER_AGENT") ||
          "Mozilla/5.0 (compatible; ProphecyCompanion/1.0; +https://prophecy.social)",
      },
    });

    const html = await response.text();
    const warnings: string[] = [];
    if (!response.ok) warnings.push(`Fetch returned HTTP ${response.status}`);
    if (!html.trim()) warnings.push("Fetched page was empty");

    const eventId = eventIdFromUrl(input.eventUrl);
    const visibleText = extractVisibleText(html);
    const embeddedData = extractEmbeddedData(html, eventId);
    if (visibleText.length < 200) {
      warnings.push("Visible page text was sparse; relying on embedded page data where available");
    }

    const title = extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      extractMeta(html, "og:description") ||
      extractMeta(html, "twitter:description") ||
      extractMeta(html, "description");
    const marketRecords = extractMarketRecords(html, eventId);
    const jsonPayloads = extractJsonPayloads(html);
    const jsonFacts = jsonPayloads.flatMap((payload) => collectMarketFacts(payload));
    const textFacts = collectTextMarketFacts({ title, description, visibleText, embeddedData });
    const recordFacts = marketRecords.flatMap((record, index) =>
      formatMarketRecord(record, index).split("\n").map((value) => ({ path: `$.marketRecords[${index}]`, value }))
    );
    const marketFacts = dedupeFacts([...recordFacts, ...jsonFacts, ...textFacts]);
    const combinedForSignals = [
      title,
      description,
      visibleText,
      embeddedData.join("\n"),
      marketRecords.map((record, index) => formatMarketRecord(record, index)).join("\n"),
      marketFacts.map((fact) => fact.value).join("\n"),
    ].join("\n");
    const extractedSignals = extractSignals(combinedForSignals, eventId);
    const domain = classifyDomain(combinedForSignals);
    const research = await fetchResearchEvidence(input, title, description, domain, marketRecords);
    warnings.push(...research.warnings);

    debugLog("Fetched market page", {
      status: response.status,
      htmlLength: html.length,
      visibleTextLength: visibleText.length,
      embeddedSnippetCount: embeddedData.length,
      marketRecordCount: marketRecords.length,
      marketFactCount: marketFacts.length,
      domain,
      researchResultCount: research.results.length,
    });

    return {
      url: input.eventUrl,
      fetchedAt: new Date().toISOString(),
      title,
      description,
      domain,
      visibleText: visibleText.slice(0, optionalNumber("COMPANION_VISIBLE_TEXT_LIMIT", 8000)),
      embeddedData,
      marketFacts,
      marketRecords,
      extractedSignals,
      research,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    debugLog("Failed to fetch market page", { message });
    return {
      url: input.eventUrl,
      fetchedAt: new Date().toISOString(),
      visibleText: "",
      embeddedData: [],
      marketRecords: [],
      marketFacts: [],
      extractedSignals: { eventId: eventIdFromUrl(input.eventUrl), probabilities: [], dates: [], outcomes: [] },
      domain: "general",
      research: await fetchResearchEvidence(input, undefined, undefined, "general"),
      warnings: [`Failed to fetch market page: ${message}`],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatPageContext(context: MarketPageContext): string {
  const maxChars = optionalNumber("COMPANION_PAGE_CONTEXT_LIMIT", 24_000);
  const sections = [
    `URL: ${context.url}`,
    `Fetched at: ${context.fetchedAt}`,
    `Detected domain: ${context.domain}`,
    `Title: ${context.title || "unknown"}`,
    `Description: ${context.description || "unknown"}`,
    `Warnings: ${context.warnings.length ? context.warnings.join("; ") : "none"}`,
    `Source list:\n${formatSourceList(context)}`,
    `Extracted signals:\n${JSON.stringify(context.extractedSignals, null, 2)}`,
    `Outcome candidate book:\n${
      context.marketRecords.length
        ? context.marketRecords.map((record, index) => formatMarketRecord(record, index)).join("\n\n")
        : "none detected"
    }`,
    `Structured market facts:\n${
      context.marketFacts.length
        ? context.marketFacts.map((fact) => `- ${fact.path}: ${fact.value}`).join("\n")
        : "none"
    }`,
    `External research:\n${formatResearch(context.research)}`,
    `Visible text:\n${context.visibleText || "none"}`,
    `Embedded data snippets:\n${
      context.embeddedData.length
        ? context.embeddedData.map((snippet, index) => `[${index + 1}] ${snippet}`).join("\n\n")
        : "none"
    }`,
  ];

  return sections.join("\n\n").slice(0, maxChars);
}

function formatSourceList(context: MarketPageContext): string {
  const sources = [
    `- Prophecy market page: ${context.url}`,
    ...context.research.results.map((result, index) => `- Research ${index + 1}: ${result.title} (${result.url})`),
  ];

  return sources.slice(0, optionalNumber("COMPANION_SOURCE_LIMIT", 10)).join("\n");
}

function formatResearch(research: ResearchEvidence): string {
  if (!research.enabled) return "disabled";
  const lines = [
    `Queries: ${research.queries.join(" | ") || "none"}`,
    `Warnings: ${research.warnings.length ? research.warnings.join("; ") : "none"}`,
    ...research.results.map((result, index) =>
      [
        `[${index + 1}] ${result.title}`,
        `URL: ${result.url}`,
        result.snippet ? `Snippet: ${result.snippet}` : undefined,
        result.pageSummary ? `Fetched page summary: ${result.pageSummary}` : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ];

  return lines.join("\n\n");
}

function buildPrompt(input: CompanionInput, pageContext: MarketPageContext): string {
  const hasOutcomeCandidates = pageContext.marketRecords.length > 1;

  return [
    "You are Prophecy Companion, an analysis assistant for Prophecy prediction markets.",
    `Analyze this Prophecy market: ${input.eventUrl}`,
    `Question: ${
      input.ask ||
      "Given available evidence and official resolution criteria, what is the likely winning outcome now?"
    }`,
    `Extra context: ${input.extraContext || "none"}`,
    "Extracted market page context:",
    formatPageContext(pageContext),
    "Instructions:",
    "- Base the analysis on the extracted market page context and user-provided extra context.",
    "- Use external research for real-world evidence: team/news momentum, head-to-head history, injuries, public sentiment, macro context, or any domain-specific facts relevant to the market.",
    "- Do not rely only on Prophecy market probabilities; treat them as crowd signal, not truth.",
    "- For non-sports markets, adapt evidence to the domain: politics, crypto, weather, entertainment, social events, public records, or recent news.",
    "- Identify the market question, available outcomes, resolution criteria, and useful evidence if present.",
    "- If the Outcome candidate book has multiple records, this is a multi-option/multi-submarket event. Select one exact candidate or say there is no clear edge.",
    "- For multi-option events, never return a bare YES or NO. prediction must include the exact outcome label, for example 'YES on Team A: Player Name' or 'NO on Event Title: Option Name'.",
    "- exactOutcomeLabel must copy the selected candidate's exactOutcomeLabel from the Outcome candidate book. selectedMarketId must match that candidate's marketId when present. side must be YES, NO, or WATCH.",
    "- Treat an outcome labeled 'Other' as a bucket meaning 'any outcome not separately listed', never as one named player/team/asset/person. Do not say 'Other means not Candidate X' unless Candidate X is the only separately listed alternative.",
    "- If choosing YES on an Other bucket, explain the bucket thesis by naming the listed candidates being excluded and examples of plausible unlisted winners. Do not imply one unlisted candidate alone resolves the whole bucket.",
    "- Use side=WATCH when evidence is too thin, the market is ambiguous, or no candidate has a useful edge. In that case, still set exactOutcomeLabel to the most relevant candidate or null if none is clearly selected.",
    "- If side is WATCH because the edge is below the user's/action threshold, say the numeric edge is insufficient. Do not describe it as a trade/actionable pick.",
    "- Compare the model probability against the candidate's YES/NO market probability when available. Explain whether the crowd signal agrees or conflicts with your evidence-weighted probability.",
    "- Produce deeper analysis than a one-line pick: summarize the market structure, candidate-specific evidence, counter-evidence, uncertainty drivers, and what new information would change the view.",
    hasOutcomeCandidates
      ? "- This event has multiple outcome candidates in context. A response with prediction equal only to YES or NO is invalid."
      : "- If only one binary market is detected, a YES/NO side is acceptable, but still include exactOutcomeLabel when a label is available.",
    "- If page extraction is incomplete, say that clearly and reduce confidence instead of pretending.",
    "- Use probability as a number from 0 to 1.",
    "- Give practical guidance for a user deciding whether to take the prediction.",
    "- Use safer wording like 'lean YES', 'lean NO', 'watch/no clear edge', or 'avoid' instead of telling users to gamble or bet.",
    "- Mention uncertainty and key risks plainly. Do not present this as financial, betting, or gambling advice.",
    "- Include sourcesUsed as a short array of source titles/URLs from the Source list that materially influenced the conclusion.",
    "Return strict JSON with keys:",
    "prediction, side, exactOutcomeLabel, selectedMarketId, probability (0..1), modelProbability (0..1), marketProbability (0..1|null), edge (number|null), confidence (0..1), opportunityScore (0..100), resolutionClarity (0..1), riskLevel, reasoning, marketStructure, resolutionCriteria, marketSummary, keyEvidence[], counterEvidence[], crowdSignal, externalEvidenceSummary, uncertaintyDrivers[], risks[], suggestedUserAction, sourcesUsed[]",
    "Do not include markdown.",
  ].join("\n");
}

function extractJsonObject(value: string): string {
  const stripped = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

function normalizeCompanionOutput(raw: string): string {
  const parsed = safeJsonParse(extractJsonObject(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;

  const result = parsed as Record<string, unknown>;
  const prediction = typeof result.prediction === "string" ? result.prediction.trim() : "";
  const side = typeof result.side === "string" ? result.side.trim().toUpperCase() : "";
  let exactOutcomeLabel =
    typeof result.exactOutcomeLabel === "string"
      ? result.exactOutcomeLabel.trim()
      : typeof result.exact_outcome_label === "string"
        ? result.exact_outcome_label.trim()
        : "";

  if (/^other$/i.test(exactOutcomeLabel) && prediction) {
    const fullOtherMatch = prediction.match(/\bon\s+(.+?:\s*Other)\b/i);
    if (fullOtherMatch?.[1]) {
      exactOutcomeLabel = fullOtherMatch[1].trim();
      result.exactOutcomeLabel = exactOutcomeLabel;
    }
  }

  if (exactOutcomeLabel && prediction) {
    const exactLower = exactOutcomeLabel.toLowerCase();
    const optionTail = exactOutcomeLabel.split(":").pop()?.trim();
    const optionLower = optionTail?.toLowerCase();
    const predictionLower = prediction.toLowerCase();
    const plainSidePattern = /^(?:lean\s+)?(?:yes|no)$/i;
    const watchPattern = /^(?:watch|avoid|no clear edge|watch\/no clear edge)$/i;
    const sidePhrase = prediction.match(/^(?:lean\s+)?(?:yes|no)/i)?.[0];

    if (predictionLower.includes(exactLower)) {
      result.prediction = prediction;
    } else if (optionLower && predictionLower.includes(optionLower) && sidePhrase) {
      result.prediction = `${sidePhrase} on ${exactOutcomeLabel}`;
    } else if (plainSidePattern.test(prediction)) {
      result.prediction = `${prediction} on ${exactOutcomeLabel}`;
    } else if (watchPattern.test(prediction) || side === "WATCH") {
      result.prediction = `watch/no clear edge on ${exactOutcomeLabel}`;
      if (!result.side) result.side = "WATCH";
    } else if (/^(yes|no)$/i.test(side)) {
      result.prediction = `${prediction} on ${exactOutcomeLabel}`;
    }
  }

  const modelProbability = typeof result.modelProbability === "number" ? result.modelProbability : undefined;
  const marketProbability = typeof result.marketProbability === "number" ? result.marketProbability : undefined;
  const normalizedSide = typeof result.side === "string" ? result.side.toUpperCase() : side;
  if (modelProbability !== undefined && marketProbability !== undefined) {
    if (normalizedSide === "YES") result.edge = Number((modelProbability - marketProbability).toFixed(4));
    if (normalizedSide === "NO") result.edge = Number((marketProbability - modelProbability).toFixed(4));
  }

  return JSON.stringify(result, null, 2);
}

export async function analyzeMarket(parsedInput: CompanionInput): Promise<string> {
  const pageContext = await fetchMarketPage(parsedInput);
  debugLog("Prepared market context", {
    title: pageContext.title || "unknown",
    descriptionLength: pageContext.description?.length ?? 0,
    visibleTextLength: pageContext.visibleText.length,
    embeddedSnippetCount: pageContext.embeddedData.length,
    marketRecordCount: pageContext.marketRecords.length,
    marketFactCount: pageContext.marketFacts.length,
    domain: pageContext.domain,
    researchResultCount: pageContext.research.results.length,
    warnings: pageContext.warnings,
  });
  const llm = await buildLlm();

  const response = await llm.generate(buildPrompt(parsedInput, pageContext), {
    model: modelFor(selectedProvider()),
    temperature: Number(optional("COMPANION_TEMPERATURE") || 0.2),
  });
  const content = typeof response.content === "string" ? response.content : String(response);
  return normalizeCompanionOutput(content);
}

async function main() {
  console.log(await analyzeMarket(parseInput()));
}

function isCliEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isCliEntryPoint()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
