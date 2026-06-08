import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const serviceName = process.env.COMPANION_SERVICE_NAME || "prophecy-companion-agent";
const startedAt = new Date().toISOString();
let inFlight = 0;
let lastError: string | undefined;
let lastRequestAt: string | undefined;

function port() {
  const parsed = Number(process.env.PORT || process.env.SERVICE_PORT || 8080);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8080;
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "access-control-allow-origin": process.env.COMPANION_SERVICE_CORS_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const limit = Number(process.env.COMPANION_SERVICE_MAX_BODY_BYTES || 16_384);
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error(`Request body exceeds ${limit} bytes`);
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function parseAnalyzeQuery(req: IncomingMessage) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  return {
    eventUrl: url.searchParams.get("eventUrl"),
    ask: url.searchParams.get("ask") || undefined,
    extraContext: url.searchParams.get("extraContext") || undefined,
  };
}

function health() {
  return {
    ok: !lastError,
    service: serviceName,
    status: lastError ? "error" : "ready",
    startedAt,
    lastRequestAt,
    inFlight,
    uptimeSeconds: Math.floor(process.uptime()),
    ...(lastError ? { lastError } : {}),
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      writeJson(res, 204, {});
      return;
    }

    if ((req.method === "GET" && req.url === "/") || (req.method === "GET" && req.url === "/health")) {
      writeJson(res, lastError ? 503 : 200, health());
      return;
    }

    if (req.method !== "POST" && req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/analyze") {
      writeJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    inFlight += 1;
    lastRequestAt = new Date().toISOString();
    const { analyzeMarket, parseCompanionInput } = await import("./index.ts");
    const input = parseCompanionInput(req.method === "GET" ? parseAnalyzeQuery(req) : await readJson(req));
    const output = await analyzeMarket(input);
    lastError = undefined;

    try {
      writeJson(res, 200, { ok: true, result: JSON.parse(output) });
    } catch {
      writeJson(res, 200, { ok: true, result: output });
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    writeJson(res, 400, { ok: false, error: lastError });
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
});

server.listen(port(), "0.0.0.0", () => {
  console.log(`[${serviceName}] listening`, { port: port() });
});

server.on("error", (error) => {
  console.error(`[${serviceName}] server failed`, error);
  process.exit(1);
});
