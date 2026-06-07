"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useChainId } from "wagmi";
import { parseEther } from "viem";
import { REGISTRY_ABI } from "@/lib/contracts/abis";
import { getAddresses } from "@/lib/contracts/addresses";
import { AgentConfig, AgentType } from "@/lib/types";

function useRegistryAddress() {
  const chainId = useChainId();
  try {
    return getAddresses(chainId).SASRegistry;
  } catch {
    return getAddresses(50312).SASRegistry; // default testnet
  }
}

// ── Read hooks ───────────────────────────────────────────────────────────────

export function useAllActiveAgents() {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "getAllActiveAgents",
    query: { refetchInterval: 15_000 },
  });
}

export function useAllAgents() {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "getAllAgents",
    query: { refetchInterval: 15_000 },
  });
}

export function useAgent(agentId: bigint | undefined) {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "getAgent",
    args: agentId ? [agentId] : undefined,
    query: { enabled: Boolean(agentId), refetchInterval: 15_000 },
  });
}

export function useBuilderAgents(builderAddress: `0x${string}` | undefined) {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "getBuilderAgents",
    args: builderAddress ? [builderAddress] : undefined,
    query: { enabled: Boolean(builderAddress), refetchInterval: 15_000 },
  });
}

export function useAgentCount() {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "agentCount",
    query: { refetchInterval: 10_000 },
  });
}

export function useAgentsByCategory(category: string) {
  const address = useRegistryAddress();
  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "getAgentsByCategory",
    args: [category],
    query: { enabled: category.length > 0, refetchInterval: 15_000 },
  });
}

// ── Write hooks ──────────────────────────────────────────────────────────────

export interface RegisterAgentParams {
  name: string;
  description: string;
  category: string;
  metadataURI: string;
  agentType: AgentType;
  pricePerExecutionSTT: string; // Human-readable STT amount
  somniaAgentId: bigint;
}

export function useRegisterAgent() {
  const address = useRegistryAddress();
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function register(params: RegisterAgentParams) {
    writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "registerAgent",
      args: [
        params.name,
        params.description,
        params.category,
        params.metadataURI,
        params.agentType,
        parseEther(params.pricePerExecutionSTT),
        params.somniaAgentId,
      ],
    });
  }

  return { register, hash, isPending, isConfirming, isSuccess, isError, error };
}

export function useUpdateAgent() {
  const address = useRegistryAddress();
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function update(agentId: bigint, description: string, metadataURI: string, pricePerExecutionSTT: string) {
    writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "updateAgent",
      args: [agentId, description, metadataURI, parseEther(pricePerExecutionSTT)],
    });
  }

  return { update, hash, isPending, isConfirming, isSuccess, isError, error };
}

export function usePauseAgent() {
  const address = useRegistryAddress();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const pause = (agentId: bigint) =>
    writeContract({ address, abi: REGISTRY_ABI, functionName: "pauseAgent", args: [agentId] });

  return { pause, hash, isPending, isConfirming, isSuccess };
}

export function useResumeAgent() {
  const address = useRegistryAddress();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const resume = (agentId: bigint) =>
    writeContract({ address, abi: REGISTRY_ABI, functionName: "resumeAgent", args: [agentId] });

  return { resume, hash, isPending, isConfirming, isSuccess };
}

export function useDeprecateAgent() {
  const address = useRegistryAddress();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deprecate = (agentId: bigint) =>
    writeContract({ address, abi: REGISTRY_ABI, functionName: "deprecateAgent", args: [agentId] });

  return { deprecate, hash, isPending, isConfirming, isSuccess };
}
