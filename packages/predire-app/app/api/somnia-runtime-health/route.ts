import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, encodeFunctionData, formatEther, getAddress, http, isAddress } from "viem";
import {
  BILLING_ABI,
  SOMNIA_TESTNET,
  AgentType,
  getSasAddresses,
} from "@/lib/somnia";

const SOMNIA_LLM_ABI = [
  {
    type: "function",
    name: "inferString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [],
  },
] as const;

function extractRevertSelector(error: unknown): string | null {
  const seen: string[] = [];
  let current: unknown = error;

  for (let i = 0; current && i < 5; i++) {
    if (typeof current !== "object") break;
    const value = current as {
      shortMessage?: unknown;
      message?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    for (const item of [value.shortMessage, value.message, value.details]) {
      if (typeof item === "string") seen.push(item);
    }
    current = value.cause;
  }

  const match = seen.join("\n").match(/0x[0-9a-fA-F]{8}/);
  return match?.[0].toLowerCase() ?? null;
}

function extractShortMessage(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const shortMessage = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof shortMessage === "string") return shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(request: NextRequest) {
  const agentIdRaw = request.nextUrl.searchParams.get("agentId");
  const accountRaw = request.nextUrl.searchParams.get("account")?.trim();
  const typeRaw = request.nextUrl.searchParams.get("agentType");

  if (!agentIdRaw || !/^\d+$/.test(agentIdRaw)) {
    return NextResponse.json(
      { ok: false, status: "unconfigured", reason: "Missing numeric agentId." },
      { status: 400 }
    );
  }

  const accountCandidate =
    process.env.COMPANION_RUNTIME_HEALTH_ACCOUNT?.trim() ||
    process.env.NEXT_PUBLIC_AUTONOMY_RUNNER_ADDRESS?.trim() ||
    accountRaw;

  if (!accountCandidate || !isAddress(accountCandidate)) {
    return NextResponse.json({
      ok: false,
      status: "unknown",
      reason: "No funded health-check account is configured. Set COMPANION_RUNTIME_HEALTH_ACCOUNT or connect a wallet.",
    });
  }

  const agentType = typeRaw === undefined ? AgentType.LLM_INFERENCE : Number(typeRaw);
  if (agentType !== AgentType.LLM_INFERENCE) {
    return NextResponse.json({
      ok: true,
      status: "not_checked",
      reason: "Runtime health check currently covers LLM one-shot payloads only.",
    });
  }

  const client = createPublicClient({
    chain: SOMNIA_TESTNET,
    transport: http(process.env.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"),
  });
  const addresses = getSasAddresses();
  const agentId = BigInt(agentIdRaw);
  const account = getAddress(accountCandidate);

  const payload = encodeFunctionData({
    abi: SOMNIA_LLM_ABI,
    functionName: "inferString",
    args: [
      'Return one JSON object: {"prediction":"YES","confidence":50}.',
      "You are Prophecy Companion. Return concise JSON only.",
      false,
      [],
    ],
  });

  try {
    const quote = await client.readContract({
      address: addresses.billing,
      abi: BILLING_ABI,
      functionName: "quoteExecution",
      args: [agentId],
    }) as readonly [bigint, bigint, bigint];

    await client.simulateContract({
      account,
      address: addresses.billing,
      abi: BILLING_ABI,
      functionName: "executeAgent",
      args: [agentId, payload],
      value: quote[2],
    });

    return NextResponse.json({
      ok: true,
      status: "healthy",
      reason: "Minimal one-shot runtime preflight passed.",
      checkedAt: new Date().toISOString(),
      account,
      quote: {
        agentFeeStt: formatEther(quote[0]),
        runtimeBudgetStt: formatEther(quote[1]),
        totalCostStt: formatEther(quote[2]),
      },
      payloadBytes: (payload.length - 2) / 2,
    });
  } catch (error) {
    const selector = extractRevertSelector(error);
    const platformRejected = selector === "0x0ede9759";

    return NextResponse.json({
      ok: false,
      status: platformRejected ? "unavailable" : "failed",
      reason: platformRejected
        ? "Somnia Agent Platform rejected a minimal one-shot runtime request before it could be queued."
        : extractShortMessage(error),
      checkedAt: new Date().toISOString(),
      account,
      selector,
      payloadBytes: (payload.length - 2) / 2,
    });
  }
}
