"use client";

export type AgentUpdateManifest = {
  id: string;
  agentId: string;
  title: string;
  version: string;
  docsUrl: string;
  summary: string;
  integrationNotes: string;
  createdAt: string;
};

const STORAGE_KEY = "sas.agentUpdateManifests.v1";

function readAll(): AgentUpdateManifest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AgentUpdateManifest[] : [];
  } catch {
    return [];
  }
}

function writeAll(updates: AgentUpdateManifest[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
}

export function getAgentUpdates(agentId?: string): AgentUpdateManifest[] {
  const updates = readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!agentId) return updates;
  return updates.filter((update) => update.agentId === agentId);
}

export function saveAgentUpdate(input: Omit<AgentUpdateManifest, "id" | "createdAt">): AgentUpdateManifest {
  const update: AgentUpdateManifest = {
    ...input,
    id: `${input.agentId}-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  writeAll([update, ...readAll()]);
  return update;
}

export function exportAgentUpdates(agentId: string): string {
  return JSON.stringify(getAgentUpdates(agentId), null, 2);
}
