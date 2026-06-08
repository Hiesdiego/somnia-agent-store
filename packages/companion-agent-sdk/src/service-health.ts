import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type HealthState = {
  startedAt: string;
  lastBeatAt: string;
  status: "starting" | "ready" | "error";
  lastError?: string;
};

type HealthServerOptions = {
  serviceName: string;
  port?: number;
  getDetails?: () => Record<string, unknown>;
};

function json(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parsePort(port?: number): number {
  const raw = process.env.PORT || process.env.SERVICE_PORT;
  const parsed = raw ? Number(raw) : port ?? 8080;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8080;
}

export function startServiceHealthServer(options: HealthServerOptions) {
  if (process.env.SERVICE_HEALTH_SERVER === "0") {
    return {
      ready() {},
      beat() {},
      error() {},
    };
  }

  const state: HealthState = {
    startedAt: new Date().toISOString(),
    lastBeatAt: new Date().toISOString(),
    status: "starting",
  };
  const port = parsePort(options.port);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" || (req.url !== "/" && req.url !== "/health" && req.url !== "/ready")) {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const ok = state.status !== "error";
    json(res, ok ? 200 : 503, {
      ok,
      service: options.serviceName,
      status: state.status,
      startedAt: state.startedAt,
      lastBeatAt: state.lastBeatAt,
      uptimeSeconds: Math.floor(process.uptime()),
      ...(state.lastError ? { lastError: state.lastError } : {}),
      ...(options.getDetails ? { details: options.getDetails() } : {}),
    });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[${options.serviceName}] health server listening`, { port });
  });

  server.on("error", (error) => {
    console.error(`[${options.serviceName}] health server failed`, error);
  });

  return {
    ready() {
      state.status = "ready";
      state.lastBeatAt = new Date().toISOString();
      state.lastError = undefined;
    },
    beat(details?: { error?: unknown }) {
      state.lastBeatAt = new Date().toISOString();
      if (details?.error) {
        state.status = "error";
        state.lastError = details.error instanceof Error ? details.error.message : String(details.error);
      } else if (state.status !== "error") {
        state.status = "ready";
      }
    },
    error(error: unknown) {
      state.status = "error";
      state.lastBeatAt = new Date().toISOString();
      state.lastError = error instanceof Error ? error.message : String(error);
    },
  };
}
