import { AgentType } from "./abis.js";
import type { AgentConfig } from "./types.js";

function compareBigIntDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

export function planAutoDelegates(
  rootAgent: AgentConfig | null,
  candidates: AgentConfig[],
  maxDelegates: number
): AgentConfig[] {
  if (!rootAgent || maxDelegates <= 0) return [];

  const rootCategory = rootAgent.category.trim().toLowerCase();
  const rootBuilder = rootAgent.builder.toLowerCase();

  const eligible = candidates.filter((agent) => {
    if (agent.id === rootAgent.id) return false;
    return (
      agent.agentType === AgentType.LLM_INFERENCE ||
      agent.agentType === AgentType.WEBSITE_PARSE
    );
  });

  return eligible
    .slice()
    .sort((a, b) => {
      const aSameCategory =
        rootCategory.length > 0 && a.category.trim().toLowerCase() === rootCategory ? 1 : 0;
      const bSameCategory =
        rootCategory.length > 0 && b.category.trim().toLowerCase() === rootCategory ? 1 : 0;
      if (aSameCategory !== bSameCategory) return bSameCategory - aSameCategory;

      const aDifferentBuilder = a.builder.toLowerCase() !== rootBuilder ? 1 : 0;
      const bDifferentBuilder = b.builder.toLowerCase() !== rootBuilder ? 1 : 0;
      if (aDifferentBuilder !== bDifferentBuilder) return bDifferentBuilder - aDifferentBuilder;

      const aVerified = a.isVerified ? 1 : 0;
      const bVerified = b.isVerified ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;

      const execCmp = compareBigIntDesc(a.totalExecutions, b.totalExecutions);
      if (execCmp !== 0) return execCmp;

      const revCmp = compareBigIntDesc(a.totalRevenue, b.totalRevenue);
      if (revCmp !== 0) return revCmp;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, maxDelegates);
}
