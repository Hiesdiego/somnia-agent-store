import { AgentConfig, AgentMetadata, AgentType, formatAgentUid } from "./types";
import { CONTRACT_ADDRESSES } from "./contracts/addresses";

export type AgentIntegrationMetadata = AgentMetadata & {
  docsUrl?: string;
  gitbookUrl?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  examples?: Array<{
    title: string;
    payload: string;
    description?: string;
    response?: string;
  }>;
  limitations?: string[];
  expectedLatency?: string;
  rateLimits?: string;
  changelogUrl?: string;
  supportUrl?: string;
};

export function parseInlineMetadata(metadataURI: string): AgentIntegrationMetadata | null {
  const value = metadataURI.trim();
  if (!value) return null;

  try {
    if (value.startsWith("{")) {
      return JSON.parse(value) as AgentIntegrationMetadata;
    }

    if (value.startsWith("data:application/json,")) {
      const raw = decodeURIComponent(value.replace("data:application/json,", ""));
      return JSON.parse(raw) as AgentIntegrationMetadata;
    }

    if (value.startsWith("data:application/json;base64,")) {
      const raw = atob(value.replace("data:application/json;base64,", ""));
      return JSON.parse(raw) as AgentIntegrationMetadata;
    }
  } catch {
    return null;
  }

  return null;
}

export function docsUrlForMetadata(metadataURI: string, metadata: AgentIntegrationMetadata | null): string | null {
  if (metadata?.gitbookUrl) return metadata.gitbookUrl;
  if (metadata?.docsUrl) return metadata.docsUrl;
  if (metadata?.documentationUrl) return metadata.documentationUrl;
  if (metadata?.externalUrl) return metadata.externalUrl;
  if (metadataURI.startsWith("http://") || metadataURI.startsWith("https://")) return metadataURI;
  return null;
}

export function agentMethodExample(agentType: AgentType): string {
  switch (agentType) {
    case AgentType.LLM_INFERENCE:
      return `const encodedPayload = encodeFunctionData({
  abi: SOMNIA_LLM_ABI,
  functionName: "inferString",
  args: [prompt, systemPrompt, false, []]
});`;
    case AgentType.JSON_API:
      return `const encodedPayload = encodeFunctionData({
  abi: SOMNIA_JSON_API_ABI,
  functionName: "requestString",
  args: [url, jsonPath, prompt]
});`;
    case AgentType.WEBSITE_PARSE:
      return `const encodedPayload = encodeFunctionData({
  abi: SOMNIA_WEBSITE_PARSE_ABI,
  functionName: "ExtractString",
  args: [key, description, options, prompt, url, false, 2]
});`;
    default:
      return "// This legacy execution type is not supported in the public SAS integration path.";
  }
}

export function buildViemIntegrationSnippet(agent: AgentConfig): string {
  const publicUid = formatAgentUid(agent.id, CONTRACT_ADDRESSES.somniaTestnet.SASRegistry);

  return `// ${agent.name} (${publicUid})
${agentMethodExample(agent.agentType)}

const txHash = await walletClient.writeContract({
  address: "${CONTRACT_ADDRESSES.somniaTestnet.SASBilling}",
  abi: BILLING_ABI,
  functionName: "executeAgent",
  args: [${agent.id.toString()}n, encodedPayload],
  value: (await publicClient.readContract({
    address: "${CONTRACT_ADDRESSES.somniaTestnet.SASBilling}",
    abi: BILLING_ABI,
    functionName: "quoteExecution",
    args: [${agent.id.toString()}n]
  }))[2]
});`;
}
