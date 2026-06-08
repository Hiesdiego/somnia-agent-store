import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/security";

export const runtime = "nodejs";

type ServiceConfig = {
  key: string;
  label: string;
  env: string;
  fallback?: string;
};

const SERVICES: ServiceConfig[] = [
  {
    key: "companion",
    label: "Companion Agent",
    env: "COMPANION_AGENT_ENDPOINT",
    fallback: "https://prophecy-companion-agent.onrender.com",
  },
  {
    key: "autopilot",
    label: "Autopilot Relayer",
    env: "AUTOPILOT_RELAYER_ENDPOINT",
    fallback: "https://sas-autopilot-relayer-6rm4.onrender.com",
  },
  {
    key: "eve",
    label: "EVE Admin",
    env: "EVE_ADMIN_ENDPOINT",
    fallback: "https://eve-admin-service.onrender.com",
  },
  {
    key: "trader",
    label: "PC Trader Relayer",
    env: "PC_TRADER_RELAYER_ENDPOINT",
    fallback: "https://pc-trader-relayer.onrender.com",
  },
];

function endpoint(service: ServiceConfig): string | null {
  const value = process.env[service.env]?.trim() || service.fallback || "";
  return value ? value.replace(/\/$/, "") : null;
}

async function checkService(service: ServiceConfig) {
  const baseUrl = endpoint(service);
  if (!baseUrl) {
    return {
      key: service.key,
      label: service.label,
      configured: false,
      ok: false,
      status: "unconfigured",
      endpoint: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? ((await response.json()) as Record<string, unknown>)
      : { body: await response.text() };

    return {
      key: service.key,
      label: service.label,
      configured: true,
      ok: response.ok && body.ok !== false,
      status: typeof body.status === "string" ? body.status : response.ok ? "ready" : "failed",
      endpoint: baseUrl,
      statusCode: response.status,
      service: body.service,
      details: body.details,
      lastBeatAt: body.lastBeatAt,
      uptimeSeconds: body.uptimeSeconds,
    };
  } catch (error) {
    return {
      key: service.key,
      label: service.label,
      configured: true,
      ok: false,
      status: "unavailable",
      endpoint: baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "service-health", 30, 60_000);
  if (limited) return limited;

  const services = await Promise.all(SERVICES.map(checkService));
  return NextResponse.json({
    ok: services.every((service) => service.ok),
    checkedAt: new Date().toISOString(),
    services,
  });
}
