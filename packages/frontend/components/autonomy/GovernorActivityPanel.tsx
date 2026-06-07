"use client";

import { useAgent, useAllAgents } from "@/lib/hooks/useRegistry";
import { useAgentExecutions } from "@/lib/hooks/useBilling";
import { AgentConfig, AgentStatus, ExecutionStatus, EXECUTION_STATUS_LABELS, formatRelative } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clock3,
  FileSearch,
  Gavel,
  Radar,
  Route,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
} from "lucide-react";
import type { ReactNode } from "react";

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.PENDING]: "var(--amber-400)",
  [ExecutionStatus.SUCCESS]: "var(--teal-400)",
  [ExecutionStatus.FAILED]: "#F87171",
  [ExecutionStatus.TIMEOUT]: "var(--text-muted)",
};

const EVE_ABILITIES = [
  {
    title: "Listing guardian",
    desc: "Detects duplicate or stale active listings and can retire non-canonical entries under policy.",
    icon: FileSearch,
    color: "#60A5FA",
  },
  {
    title: "Somnia link verifier",
    desc: "Confirms each SAS listing points to an existing, active Somnia agent with matching ownership.",
    icon: BadgeCheck,
    color: "var(--teal-400)",
  },
  {
    title: "Execution sentinel",
    desc: "Watches recent execution failures, timeouts, and stale pending runs before they become invisible risk.",
    icon: ShieldCheck,
    color: "var(--amber-400)",
  },
  {
    title: "Price governor",
    desc: "Checks listing prices and fee/runtime ratios against bounded policy thresholds.",
    icon: Gavel,
    color: "#F87171",
  },
  {
    title: "Metadata watcher",
    desc: "Fetches metadata, validates reachability, and flags incomplete marketplace identity.",
    icon: ToggleLeft,
    color: "var(--purple-400)",
  },
  {
    title: "Builder reputation",
    desc: "Rolls up builder listings, deprecations, verification, executions, and revenue into EVE reports.",
    icon: Sparkles,
    color: "#C084FC",
  },
  {
    title: "Verification queue",
    desc: "Assigns each listing an EVE stage: observing, candidate, verified, watchlisted, quarantined, or deprecated.",
    icon: Route,
    color: "var(--teal-400)",
  },
  {
    title: "Reserve watch",
    desc: "Monitors treasury and executor reserve balances against policy floors.",
    icon: Activity,
    color: "#60A5FA",
  },
  {
    title: "Role drift watcher",
    desc: "Checks critical contract ownership and protocol role expectations for drift.",
    icon: Radar,
    color: "var(--amber-400)",
  },
  {
    title: "Incident reporter",
    desc: "Writes cooldown-bound action logs with evidence, stages, summaries, and transaction hashes.",
    icon: AlertTriangle,
    color: "#F87171",
  },
];

function metadataUriLooksValid(uri: string): boolean {
  const value = uri.trim();
  return value.startsWith("ipfs://") || value.startsWith("https://") || value.startsWith("http://");
}

function inspectAgent(agent: AgentConfig) {
  const failures: string[] = [];
  if (!metadataUriLooksValid(agent.metadataURI)) failures.push("metadata");
  if (agent.pricePerExecution <= 0n) failures.push("price");
  if (agent.agentType !== 3 && agent.somniaAgentId <= 0n) failures.push("Somnia ID");
  if (agent.status === AgentStatus.DEPRECATED) failures.push("deprecated");

  if (agent.status === AgentStatus.DEPRECATED) {
    return { severity: 3, label: "Retired", action: "Keep deprecated", failures };
  }
  if (failures.length > 0 && agent.isVerified) {
    return { severity: 2, label: "Quarantine candidate", action: "Unverify after streak", failures };
  }
  if (failures.length > 0) {
    return { severity: 1, label: "Needs review", action: "Track failure streak", failures };
  }
  if (!agent.isVerified) {
    return { severity: 0, label: "Promotion candidate", action: "Verify after healthy streak", failures };
  }
  return { severity: 0, label: "Healthy", action: "Keep verified", failures };
}

export function GovernorActivityPanel({
  governorAgentId,
  landName,
  operatorAddress,
  somniaAgentId,
}: {
  governorAgentId?: bigint;
  landName?: string;
  operatorAddress?: string;
  somniaAgentId?: string;
}) {
  const { data: governorAgent } = useAgent(governorAgentId);
  const { data: executions, isLoading } = useAgentExecutions(governorAgentId);
  const { data: allAgents } = useAllAgents();

  const runs = executions ?? [];
  const agents = ((allAgents ?? []) as AgentConfig[]).filter((agent) => agent.id !== governorAgentId);
  const inspections = agents
    .map((agent) => ({ agent, result: inspectAgent(agent) }))
    .sort((a, b) => b.result.severity - a.result.severity || Number(b.agent.createdAt - a.agent.createdAt));
  const visibleInspections = inspections.slice(0, 5);
  const healthyCount = inspections.filter((item) => item.result.label === "Healthy").length;
  const attentionCount = inspections.filter((item) => item.result.severity > 0).length;
  const promotionCount = inspections.filter((item) => item.result.label === "Promotion candidate").length;
  const recentRuns = [...runs].reverse().slice(0, 6);
  const pending = runs.filter((e) => e.status === ExecutionStatus.PENDING).length;
  const success = runs.filter((e) => e.status === ExecutionStatus.SUCCESS).length;
  const failed = runs.filter((e) => e.status === ExecutionStatus.FAILED || e.status === ExecutionStatus.TIMEOUT).length;
  const successRate = runs.length > 0 ? `${Math.round((success / runs.length) * 100)}%` : "N/A";
  const lastRun = recentRuns[0];

  return (
    <section className="card" style={{ padding: 20, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(45,212,191,0.18))",
              border: "1px solid rgba(168,85,247,0.35)",
              flexShrink: 0,
            }}
          >
            <Bot size={20} color="var(--teal-400)" />
          </div>
          <div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18 }}>
            {landName ? `${landName} Governor: EVE` : "EVE Autonomous Governor"}
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            Private governance operator
            {somniaAgentId ? ` - Somnia agent #${somniaAgentId}` : ""}
            {operatorAddress ? ` - ${formatAddress(operatorAddress)}` : ""}
            {governorAgent?.name ? ` - legacy SAS listing: ${governorAgent.name}` : ""}
          </p>
          </div>
        </div>
        {governorAgentId ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            <Radar size={13} />
            {isLoading ? "Syncing governor runs..." : `${runs.length} governor runs`}
          </div>
        ) : (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--teal-400)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            <Radar size={13} />
            Not listed in SAS
          </div>
        )}
      </div>

      {governorAgentId ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 12 }}>
          <Metric label="Success" value={String(success)} icon={<CheckCircle2 size={12} color="var(--teal-400)" />} />
          <Metric label="Pending" value={String(pending)} icon={<Clock3 size={12} color="var(--amber-400)" />} />
          <Metric label="Failed/Timeout" value={String(failed)} icon={<AlertTriangle size={12} color="#F87171" />} />
          <Metric label="Success Rate" value={successRate} icon={<Activity size={12} color="var(--purple-400)" />} />
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Metric label="Agents Watched" value={String(agents.length)} icon={<Radar size={12} color="#60A5FA" />} />
        <Metric label="Healthy Now" value={String(healthyCount)} icon={<ShieldCheck size={12} color="var(--teal-400)" />} />
        <Metric label="Needs EVE" value={String(attentionCount)} icon={<AlertTriangle size={12} color="var(--amber-400)" />} />
        <Metric label="Promotion Queue" value={String(promotionCount)} icon={<BadgeCheck size={12} color="var(--purple-400)" />} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ border: "1px solid var(--bg-border)", borderRadius: 8, background: "var(--bg-raised)", padding: 12 }}>
          <PanelTitle icon={<Route size={13} color="var(--teal-400)" />} label="Autonomous ability map" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {EVE_ABILITIES.map(({ title, desc, icon: Icon, color }) => (
              <div
                key={title}
                style={{
                  minHeight: 104,
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8,
                  padding: 10,
                  background: "rgba(7,7,15,0.34)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <Icon size={14} color={color} />
                  <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>{title}</span>
                </div>
                <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid var(--bg-border)", borderRadius: 8, background: "var(--bg-raised)", padding: 12 }}>
          <PanelTitle icon={<FileSearch size={13} color="#60A5FA" />} label="Live audit queue" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleInspections.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No marketplace agents available to inspect.</div>
            ) : (
              visibleInspections.map(({ agent, result }) => (
                <div
                  key={agent.id.toString()}
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "9px 10px",
                    background: "rgba(7,7,15,0.34)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                    <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      #{agent.id.toString()} {agent.name}
                    </span>
                    <span style={{ color: result.severity > 1 ? "#F87171" : result.severity > 0 ? "var(--amber-400)" : "var(--teal-400)", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                      {result.label}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
                    {result.action}
                    {result.failures.length > 0 ? ` - flags: ${result.failures.join(", ")}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-raised)", border: "1px solid var(--bg-border)", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
          Governor action source:
        </span>{" "}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-primary)" }}>
          {governorAgentId
            ? lastRun
              ? `SAS execution #${lastRun.id.toString()} ${EXECUTION_STATUS_LABELS[lastRun.status as ExecutionStatus]} ${formatRelative(lastRun.createdAt)}`
              : "No SAS governor runs yet"
            : "EVE writes detailed decisions to Supabase eve_action_logs and mutates contracts directly through the admin operator."}
        </span>
      </div>

      {governorAgentId ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recentRuns.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No recent governor runs recorded.</div>
          ) : (
            recentRuns.map((run) => (
              <div
                key={run.id.toString()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid var(--bg-border)",
                  borderRadius: 8,
                  padding: "9px 12px",
                  background: "var(--bg-raised)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>#{run.id.toString()}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{formatAddress(run.subscriber)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{formatRelative(run.createdAt)}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: STATUS_COLORS[run.status as ExecutionStatus] }}>
                    {EXECUTION_STATUS_LABELS[run.status as ExecutionStatus]}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--bg-border)", borderRadius: 8, background: "var(--bg-raised)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        {icon}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0 }}>
          {label}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--text-primary)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function PanelTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
      {icon}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0 }}>
        {label}
      </span>
    </div>
  );
}
