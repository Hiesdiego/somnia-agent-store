"use client";

import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useWatchContractEvent,
} from "wagmi";
import { BILLING_ABI, EXECUTOR_ABI } from "@/lib/contracts/abis";
import { getAddresses } from "@/lib/contracts/addresses";
import { ExecutionStatus } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";
import { decodeEventLog } from "viem";

function useBillingAddress() {
  const chainId = useChainId();
  try { return getAddresses(chainId).SASBilling; }
  catch { return getAddresses(50312).SASBilling; }
}

function useExecutorAddress() {
  const chainId = useChainId();
  try { return getAddresses(chainId).SASExecutor; }
  catch { return getAddresses(50312).SASExecutor; }
}

// ── Read hooks ───────────────────────────────────────────────────────────────

export function usePlatformStats() {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "getPlatformStats",
    query: { refetchInterval: 10_000 },
  });
}

export function useBuilderBalance(builderAddress: `0x${string}` | undefined) {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "builderBalances",
    args: builderAddress ? [builderAddress] : undefined,
    query: { enabled: Boolean(builderAddress), refetchInterval: 8_000 },
  });
}

export function useTreasuryBalance() {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "treasuryBalance",
    query: { refetchInterval: 10_000 },
  });
}

export function useUserExecutions(userAddress: `0x${string}` | undefined) {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "getUserExecutions",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(userAddress), refetchInterval: 8_000 },
  });
}

export function useAgentExecutions(agentId: bigint | undefined) {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "getAgentExecutions",
    args: agentId ? [agentId] : undefined,
    query: { enabled: Boolean(agentId), refetchInterval: 8_000 },
  });
}

export function useExecutionRecord(executionId: bigint | undefined) {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "getExecutionRecord",
    args: executionId ? [executionId] : undefined,
    query: {
      enabled: Boolean(executionId),
      // Poll faster while pending
      refetchInterval: (query) => {
        const data = query.state.data as { status: number } | undefined;
        return data?.status === ExecutionStatus.PENDING ? 3_000 : 15_000;
      },
    },
  });
}

export function useExecutionQuote(agentId: bigint | undefined) {
  const address = useBillingAddress();
  return useReadContract({
    address,
    abi: BILLING_ABI,
    functionName: "quoteExecution",
    args: agentId ? [agentId] : undefined,
    query: { enabled: Boolean(agentId), refetchInterval: 10_000 },
  });
}

export function useSomniaReserveBalance() {
  const address = useExecutorAddress();
  return useReadContract({
    address,
    abi: EXECUTOR_ABI,
    functionName: "somniaReserveBalance",
    query: { refetchInterval: 15_000 },
  });
}

// ── Write hooks ──────────────────────────────────────────────────────────────

export function useExecuteAgent() {
  const address = useBillingAddress();
  const [lastExecutionId, setLastExecutionId] = useState<bigint | null>(null);
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  // Extract executionId from the AgentExecutionRequested event log
  // The event is at logs[0] for a simple execution
  const executeAgent = useCallback(
    (agentId: bigint, payload: `0x${string}`, value: bigint) => {
      setLastExecutionId(null);
      writeContract({
        address,
        abi: BILLING_ABI,
        functionName: "executeAgent",
        args: [agentId, payload],
        value,
      });
    },
    [address, writeContract]
  );

  useEffect(() => {
    if (!receipt) return;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: BILLING_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "AgentExecutionRequested") {
          const executionId = (decoded.args as { executionId?: bigint }).executionId;
          if (executionId !== undefined) {
            setLastExecutionId(executionId);
            break;
          }
        }
      } catch {
        // Ignore logs from unrelated contracts/events
      }
    }
  }, [receipt]);

  return {
    executeAgent,
    hash,
    receipt,
    isPending,
    isConfirming,
    isSuccess,
    isError,
    error,
    reset,
    lastExecutionId,
  };
}

export function useBuilderWithdraw() {
  const address = useBillingAddress();
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = () =>
    writeContract({ address, abi: BILLING_ABI, functionName: "builderWithdraw", args: [] });

  return { withdraw, hash, isPending, isConfirming, isSuccess, isError, error };
}

// ── Event watchers ────────────────────────────────────────────────────────────

export function useWatchExecutionResult(
  executionId: bigint | undefined,
  onResult: (result: `0x${string}`, status: number) => void
) {
  const address = useExecutorAddress();
  useWatchContractEvent({
    address,
    abi: EXECUTOR_ABI,
    eventName: "AgentResultDelivered",
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { executionId?: bigint; result?: `0x${string}`; status?: number };
        if (args.executionId === executionId && args.result !== undefined && args.status !== undefined) {
          onResult(args.result, args.status);
        }
      }
    },
    enabled: Boolean(executionId),
  });
}
