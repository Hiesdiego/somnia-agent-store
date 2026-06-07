"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { useBuilderAgents, usePauseAgent, useResumeAgent } from "@/lib/hooks/useRegistry";
import { useBuilderBalance, useBuilderWithdraw } from "@/lib/hooks/useBilling";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import {
  AgentConfig, AgentStatus, AgentType,
  AGENT_TYPE_LABELS, AGENT_TYPE_BADGE, AGENT_STATUS_BADGE, AGENT_STATUS_LABELS,
  formatSTT, formatDate,
} from "@/lib/types";
import { Plus, Zap, TrendingUp, Pause, Play, Settings, BarChart2, Wallet, Loader2, GitBranch, Send } from "lucide-react";
import { toast } from "sonner";
import { getAgentUpdates, saveAgentUpdate, type AgentUpdateManifest } from "@/lib/offchainUpdates";

type UpdateForm = {
  title: string;
  version: string;
  docsUrl: string;
  summary: string;
  integrationNotes: string;
};

const EMPTY_UPDATE_FORM: UpdateForm = {
  title: "",
  version: "",
  docsUrl: "",
  summary: "",
  integrationNotes: "",
};

export default function BuilderDashboard() {
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const { data: agents, isLoading, refetch } = useBuilderAgents(address);
  const { data: balance } = useBuilderBalance(address);
  const { withdraw, isPending: withdrawPending, isConfirming: withdrawConfirming, isSuccess: withdrawSuccess } = useBuilderWithdraw();
  const { pause } = usePauseAgent();
  const { resume } = useResumeAgent();
  const [updateAgent, setUpdateAgent] = useState<AgentConfig | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm>(EMPTY_UPDATE_FORM);
  const [offchainUpdates, setOffchainUpdates] = useState<AgentUpdateManifest[]>([]);

  useEffect(() => {
    setOffchainUpdates(getAgentUpdates());
  }, []);

  function handleWithdraw() {
    if (!balance || balance === 0n) { toast.error("No balance to withdraw"); return; }
    withdraw();
    toast.info("Withdrawal submitted…");
  }

  function openUpdateModal(agent: AgentConfig) {
    setUpdateAgent(agent);
    setUpdateForm({
      title: `${agent.name} integration update`,
      version: `v${agent.version.toString()}`,
      docsUrl: "",
      summary: "",
      integrationNotes: "",
    });
  }

  function pushOffchainUpdate() {
    if (!updateAgent) return;
    if (!updateForm.title.trim()) { toast.error("Update title is required"); return; }
    if (!updateForm.summary.trim()) { toast.error("Update summary is required"); return; }

    const saved = saveAgentUpdate({
      agentId: updateAgent.id.toString(),
      title: updateForm.title.trim(),
      version: updateForm.version.trim() || `v${updateAgent.version.toString()}`,
      docsUrl: updateForm.docsUrl.trim(),
      summary: updateForm.summary.trim(),
      integrationNotes: updateForm.integrationNotes.trim(),
    });
    setOffchainUpdates((updates) => [saved, ...updates]);
    setUpdateAgent(null);
    setUpdateForm(EMPTY_UPDATE_FORM);
    toast.success("Off-chain agent update saved");
  }

  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <div style={{ textAlign: "center", padding: "80px 24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔐</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px" }}>
            Connect your wallet to access the Builder Dashboard
          </p>
        </div>
      </div>
    );
  }

  const totalRevenue  = (agents ?? []).reduce((s, a) => s + a.totalRevenue, 0n);
  const totalRuns     = (agents ?? []).reduce((s, a) => s + a.totalExecutions, 0n);
  const activeCount   = (agents ?? []).filter(a => a.status === AgentStatus.ACTIVE).length;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "26px", fontWeight: 800, margin: "0 0 4px", letterSpacing: "-0.03em" }}>
              Builder <span className="gradient-text">Dashboard</span>
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
              Deploy agents. Earn STT. Grow your audience.
            </p>
          </div>
          <Link href="/builder/publish">
            <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Plus size={14} /> Publish Agent
            </button>
          </Link>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "28px" }}>
          {[
            { label: "Pending Withdrawal", value: balance ? `${formatSTT(balance, 4)} STT` : "0 STT", icon: Wallet, color: "var(--purple-400)", cta: true },
            { label: "Total Revenue", value: `${formatSTT(totalRevenue, 2)} STT`, icon: TrendingUp, color: "var(--teal-400)", cta: false },
            { label: "Total Runs", value: totalRuns.toLocaleString(), icon: BarChart2, color: "var(--amber-400)", cta: false },
            { label: "Active Agents", value: `${activeCount} / ${agents?.length ?? 0}`, icon: Zap, color: "var(--text-primary)", cta: false },
          ].map(({ label, value, icon: Icon, color, cta }) => (
            <div key={label} className="card" style={{ padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {label}
                </span>
                <Icon size={13} color={color} />
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "20px", fontWeight: 700, color }}>{value}</div>
              {cta && (
                <button
                  onClick={handleWithdraw}
                  disabled={!balance || balance === 0n || withdrawPending || withdrawConfirming}
                  style={{
                    marginTop: "10px",
                    background: "rgba(124, 58, 237, 0.12)",
                    border: "1px solid rgba(124, 58, 237, 0.3)",
                    borderRadius: "6px",
                    color: "var(--purple-400)",
                    padding: "5px 10px",
                    fontSize: "11px",
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    cursor: (!balance || balance === 0n) ? "not-allowed" : "pointer",
                    opacity: (!balance || balance === 0n) ? 0.5 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {withdrawPending || withdrawConfirming ? <Loader2 size={10} /> : null}
                  Withdraw STT
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Agents table */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, margin: 0 }}>
              Your Agents
            </h2>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
              {agents?.length ?? 0} total
            </span>
          </div>

          {isLoading ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Loader2 size={20} color="var(--purple-400)" style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : !agents || agents.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "36px", marginBottom: "12px" }}>🚀</div>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 16px" }}>
                You haven't published any agents yet.
              </p>
              <Link href="/builder/publish">
                <button className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <Plus size={13} /> Publish your first agent
                </button>
              </Link>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-raised)" }}>
                    {["Agent", "Type", "Status", "Price/Run", "Total Runs", "Revenue", "Actions"].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 16px",
                          textAlign: "left",
                          fontFamily: "var(--font-mono)",
                          fontSize: "10px",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent: AgentConfig) => (
                    <tr
                      key={agent.id.toString()}
                      style={{ borderTop: "1px solid var(--bg-border)", transition: "background 150ms ease" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)", marginBottom: "2px" }}>{agent.name}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>#{agent.id.toString()} · v{agent.version.toString()}</div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span className={`badge ${AGENT_TYPE_BADGE[agent.agentType as AgentType]}`}>
                          {AGENT_TYPE_LABELS[agent.agentType as AgentType]}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span className={`badge ${AGENT_STATUS_BADGE[agent.status as AgentStatus]}`}>
                          {AGENT_STATUS_LABELS[agent.status as AgentStatus]}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--purple-400)" }}>
                        {formatSTT(agent.pricePerExecution, 4)} STT service fee
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-primary)" }}>
                        {agent.totalExecutions.toLocaleString()}
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--teal-400)" }}>
                        {formatSTT(agent.totalRevenue, 2)} STT
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {agent.status === AgentStatus.ACTIVE ? (
                            <button
                              onClick={() => { pause(agent.id); toast.info(`Pausing ${agent.name}…`); }}
                              title="Pause"
                              style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", color: "var(--amber-400)" }}
                            >
                              <Pause size={12} />
                            </button>
                          ) : agent.status === AgentStatus.PAUSED ? (
                            <button
                              onClick={() => { resume(agent.id); toast.info(`Resuming ${agent.name}…`); }}
                              title="Resume"
                              style={{ background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.3)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", color: "var(--teal-400)" }}
                            >
                              <Play size={12} />
                            </button>
                          ) : null}
                          <Link href={`/marketplace/${agent.id.toString()}`}>
                            <button title="View" style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", color: "var(--purple-400)" }}>
                              <Settings size={12} />
                            </button>
                          </Link>
                          <button
                            onClick={() => openUpdateModal(agent)}
                            title="Push off-chain update"
                            style={{ background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.3)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", color: "var(--teal-400)" }}
                          >
                            <GitBranch size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: "16px", padding: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, margin: "0 0 4px" }}>
                Off-chain Integration Updates
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0 }}>
                Save GitBook links, changelogs, schema notes, and integration warnings without changing the on-chain listing.
              </p>
            </div>
            <span className="badge badge-verified">{offchainUpdates.length} saved</span>
          </div>
          {offchainUpdates.length > 0 && (
            <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
              {offchainUpdates.slice(0, 3).map((update) => (
                <div key={update.id} style={{ border: "1px solid var(--bg-border)", borderRadius: "10px", padding: "12px", background: "rgba(8,0,16,0.38)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "5px" }}>
                    <strong style={{ fontSize: "13px" }}>{update.title}</strong>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--teal-400)", fontSize: "11px" }}>{update.version} | agent #{update.agentId}</span>
                  </div>
                  <p style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: 1.55, margin: 0 }}>{update.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {updateAgent && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(3,0,8,0.72)", display: "grid", placeItems: "center", padding: "20px" }}>
          <div className="card" style={{ maxWidth: "620px", width: "100%", padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
              <div>
                <p style={{ color: "var(--teal-400)", fontFamily: "var(--font-mono)", fontSize: "11px", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Off-chain update</p>
                <h2 style={{ margin: 0, fontSize: "20px" }}>Push update for {updateAgent.name}</h2>
              </div>
              <button className="btn-secondary" onClick={() => setUpdateAgent(null)} style={{ padding: "7px 11px" }}>Close</button>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              <input className="input" value={updateForm.title} onChange={e => setUpdateForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Update title" />
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px" }}>
                <input className="input" value={updateForm.version} onChange={e => setUpdateForm(prev => ({ ...prev, version: e.target.value }))} placeholder="v1.1.0" />
                <input className="input" value={updateForm.docsUrl} onChange={e => setUpdateForm(prev => ({ ...prev, docsUrl: e.target.value }))} placeholder="GitBook or docs URL" />
              </div>
              <textarea className="input" rows={3} value={updateForm.summary} onChange={e => setUpdateForm(prev => ({ ...prev, summary: e.target.value }))} placeholder="What changed for users or integrators?" style={{ resize: "vertical" }} />
              <textarea className="input" rows={4} value={updateForm.integrationNotes} onChange={e => setUpdateForm(prev => ({ ...prev, integrationNotes: e.target.value }))} placeholder="Schema changes, payload examples, deprecations, limits, migration notes..." style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
              <button className="btn-primary" onClick={pushOffchainUpdate} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <Send size={14} /> Save Off-chain Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
