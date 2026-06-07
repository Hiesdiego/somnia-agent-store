"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Navbar } from "@/components/layout/Navbar";
import { useAgent } from "@/lib/hooks/useRegistry";
import { useAgentExecutions, useExecutionQuote } from "@/lib/hooks/useBilling";
import {
  AgentType, AgentStatus,
  AGENT_TYPE_LABELS, AGENT_TYPE_BADGE, AGENT_STATUS_BADGE, AGENT_STATUS_LABELS,
  EXECUTION_STATUS_LABELS,
  ExecutionStatus,
  formatSTT, formatAddress, formatAgentUid, formatDate, formatRelative,
} from "@/lib/types";
import { CONTRACT_ADDRESSES } from "@/lib/contracts/addresses";
import { buildViemIntegrationSnippet, docsUrlForMetadata, parseInlineMetadata } from "@/lib/agentMetadata";
import { useAgentMetadata } from "@/lib/hooks/useAgentMetadata";
import { getAgentUpdates, type AgentUpdateManifest } from "@/lib/offchainUpdates";
import {
  Zap, CheckCircle, ArrowLeft, BarChart2, TrendingUp,
  Clock, ExternalLink, Loader2, BookOpen, Code2,
} from "lucide-react";

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.PENDING]: "var(--purple-400)",
  [ExecutionStatus.SUCCESS]: "var(--teal-400)",
  [ExecutionStatus.FAILED]:  "var(--text-muted)",
  [ExecutionStatus.TIMEOUT]: "var(--amber-400)",
};

const DETAIL_STATUS_LABELS: Record<ExecutionStatus, string> = {
  ...EXECUTION_STATUS_LABELS,
  [ExecutionStatus.FAILED]: "Unresolved",
  [ExecutionStatus.TIMEOUT]: "Timed out",
};

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();

  const { data: agent, isLoading } = useAgent(BigInt(agentId));
  const { data: executions } = useAgentExecutions(BigInt(agentId));
  const { data: executionQuote } = useExecutionQuote(BigInt(agentId));

  const [tab, setTab] = useState<"overview" | "runs" | "integrate" | "schema" | "reviews">("overview");
  const [offchainUpdates, setOffchainUpdates] = useState<AgentUpdateManifest[]>([]);
  const metadataURI = agent?.metadataURI ?? "";
  const inlineMetadata = parseInlineMetadata(metadataURI);
  const { metadata: remoteMetadata, imageUrl } = useAgentMetadata(metadataURI);

  useEffect(() => {
    setOffchainUpdates(getAgentUpdates(agentId));
  }, [agentId]);

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
          <Loader2 size={24} color="var(--purple-400)" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--text-muted)" }}>
          <p>Agent not found.</p>
        </div>
      </div>
    );
  }

  const metadata = inlineMetadata ?? remoteMetadata;
  const docsUrl = docsUrlForMetadata(metadataURI, metadata);
  const isSomniaNative = agent.agentType !== AgentType.CUSTOM_OFFCHAIN && agent.somniaAgentId > 0n;
  const agentFee = executionQuote?.[0] ?? agent.pricePerExecution;
  const runtimeBudget = executionQuote?.[1];
  const totalCost = executionQuote?.[2];
  const integrationSnippet = buildViemIntegrationSnippet(agent);
  const successfulRuns = executions?.filter((exec) => exec.status === ExecutionStatus.SUCCESS).length ?? 0;
  const totalRuns = executions?.length ?? 0;
  const successRate = totalRuns > 0 ? `${Math.round((successfulRuns / totalRuns) * 100)}%` : "N/A";
  const uniqueCallers = new Set((executions ?? []).map((exec) => exec.subscriber.toLowerCase())).size;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Back */}
        <button
          onClick={() => router.back()}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", fontSize: "13px",
            fontFamily: "var(--font-display)", marginBottom: "20px",
            padding: 0,
          }}
        >
          <ArrowLeft size={13} /> Back to marketplace
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px", alignItems: "start" }}>
          {/* Left column */}
          <div>
            {/* Header */}
            <div className="card" style={{ padding: "24px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "16px" }}>
                <div
                  style={{
                    width: "56px", height: "56px", borderRadius: "14px",
                    background: "var(--bg-raised)", border: "1px solid var(--bg-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "28px", flexShrink: 0, position: "relative", overflow: "hidden",
                  }}
                >
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt={`${agent.name} image`}
                      fill
                      sizes="56px"
                      unoptimized
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    agent.agentType === AgentType.LLM_INFERENCE ? "AI" :
                    agent.agentType === AgentType.JSON_API ? "API" :
                    agent.agentType === AgentType.WEBSITE_PARSE ? "WEB" : "RUN"
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <h1 style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                      {agent.name}
                    </h1>
                    {agent.isVerified && (
                      <span className="badge badge-verified" style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                        <CheckCircle size={9} />Verified
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <span className={`badge ${AGENT_TYPE_BADGE[agent.agentType as AgentType]}`}>
                      {AGENT_TYPE_LABELS[agent.agentType as AgentType]}
                    </span>
                    {agent.agentType === AgentType.CUSTOM_OFFCHAIN && (
                      <span className="badge" style={{ background: "rgba(251, 191, 36, 0.12)", color: "var(--amber-400)", border: "1px solid rgba(251, 191, 36, 0.35)" }}>
                        Not supported
                      </span>
                    )}
                    <span className={`badge ${AGENT_STATUS_BADGE[agent.status as AgentStatus]}`}>
                      {AGENT_STATUS_LABELS[agent.status as AgentStatus]}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", padding: "3px 0" }}>
                      {formatAgentUid(agent.id, CONTRACT_ADDRESSES.somniaTestnet.SASRegistry)} | on-chain #{agentId} | v{agent.version.toString()} | by {formatAddress(agent.builder)}
                    </span>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                {agent.description}
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
              {[
                { label: "Total Runs", value: agent.totalExecutions.toLocaleString(), icon: BarChart2, color: "var(--purple-400)" },
                { label: "Service Revenue", value: `${formatSTT(agent.totalRevenue, 2)} STT`, icon: TrendingUp, color: "var(--teal-400)" },
                { label: "Deployed", value: formatDate(agent.createdAt), icon: Clock, color: "var(--text-muted)" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="card" style={{ padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <Icon size={12} color={color} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "16px", fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", borderBottom: "1px solid var(--bg-border)" }}>
                {(["overview", "runs", "integrate", "schema", "reviews"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: "12px 20px",
                      background: "none",
                      border: "none",
                      borderBottom: tab === t ? "2px solid var(--purple-500)" : "2px solid transparent",
                      color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                      fontFamily: "var(--font-display)",
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor: "pointer",
                      textTransform: "capitalize",
                      transition: "color 150ms ease",
                    }}
                  >
                    {t === "runs" ? `Runs (${executions?.length ?? 0})` : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div style={{ padding: "20px" }}>
                {tab === "overview" && (
                  <div>
                    {!isSomniaNative && (
                      <div style={{ marginBottom: "12px", padding: "12px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#F87171", fontSize: "13px" }}>
                        This is a legacy custom off-chain listing. Public SAS v1 now supports Somnia-native agents only.
                      </div>
                    )}
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                        Execution Mode
                      </div>
                      <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                        {agent.agentType === AgentType.CUSTOM_OFFCHAIN
                          ? "This deprecated execution type is not part of the public SAS product path."
                          : "Builder self-serve execution via a Somnia Agent Platform ID listed in SAS."}
                      </span>
                    </div>
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                        Builder Address
                      </div>
                      <a
                        href={`https://shannon-explorer.somnia.network/address/${agent.builder}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--purple-400)", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}
                      >
                        {agent.builder}
                        <ExternalLink size={11} />
                      </a>
                    </div>
                    {agent.somniaAgentId > 0n && (
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                          Somnia Agent Platform ID
                        </div>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--teal-400)" }}>
                          #{agent.somniaAgentId.toString()}
                        </span>
                      </div>
                    )}
                    {docsUrl && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                          Builder Docs
                        </div>
                        <a href={docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-400)", textDecoration: "none", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          Open integration guide <ExternalLink size={11} />
                        </a>
                      </div>
                    )}
                    {(metadata?.gitbookUrl || metadata?.documentationUrl || metadata?.repositoryUrl) && (
                      <div style={{ marginTop: "12px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        {metadata.gitbookUrl && (
                          <a href={metadata.gitbookUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ textDecoration: "none", fontSize: "12px", padding: "7px 10px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                            GitBook <ExternalLink size={10} />
                          </a>
                        )}
                        {metadata.documentationUrl && (
                          <a href={metadata.documentationUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ textDecoration: "none", fontSize: "12px", padding: "7px 10px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                            Separate docs <ExternalLink size={10} />
                          </a>
                        )}
                        {metadata.repositoryUrl && (
                          <a href={metadata.repositoryUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ textDecoration: "none", fontSize: "12px", padding: "7px 10px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                            Repository <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {tab === "runs" && (
                  <div>
                    {!executions || executions.length === 0 ? (
                      <p style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "20px" }}>
                        No executions yet - be the first to run this agent.
                      </p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {[...executions].reverse().slice(0, 20).map((exec) => (
                          <div
                            key={exec.id.toString()}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "10px 14px",
                              background: "var(--bg-raised)",
                              borderRadius: "8px",
                              border: "1px solid var(--bg-border)",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                                #{exec.id.toString()}
                              </span>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                                {formatAddress(exec.subscriber)}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                                {formatRelative(exec.createdAt)}
                              </span>
                              <span
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: STATUS_COLORS[exec.status as ExecutionStatus],
                                }}
                              >
                                {DETAIL_STATUS_LABELS[exec.status as ExecutionStatus]}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === "schema" && (
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Apps encode the target Somnia agent method call, then pass those bytes into <code style={{ fontFamily: "var(--font-mono)", color: "var(--purple-400)", fontSize: "12px" }}>SASBilling.executeAgent</code>.
                    </p>
                    {metadata?.inputSchema && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                          Input Schema
                        </div>
                        <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-raised)", border: "1px solid var(--bg-border)", borderRadius: "8px", padding: "14px", fontSize: "12px", color: "var(--text-secondary)" }}>
                          {JSON.stringify(metadata.inputSchema, null, 2)}
                        </pre>
                      </div>
                    )}
                    {metadata?.outputSchema && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                          Output Schema
                        </div>
                        <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-raised)", border: "1px solid var(--bg-border)", borderRadius: "8px", padding: "14px", fontSize: "12px", color: "var(--text-secondary)" }}>
                          {JSON.stringify(metadata.outputSchema, null, 2)}
                        </pre>
                      </div>
                    )}
                    <div
                      style={{
                        background: "var(--bg-raised)",
                        border: "1px solid var(--bg-border)",
                        borderRadius: "8px",
                        padding: "14px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        color: "var(--teal-400)",
                      }}
                    >
                      {`// Input: ABI-encoded Somnia agent method payload.
// LLM: inferString(prompt, system, chainOfThought, allowedValues)
// Website: ExtractString(key, description, options, prompt, url, resolveUrl, numPages)
// Expected output: UTF-8 JSON result bytes.
// metadataURI: ${agent.metadataURI}`}
                    </div>
                  </div>
                )}

                {tab === "integrate" && (
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Use this snippet from any consumer app. The app pays this listing through SASBilling and then reads the execution record.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", marginBottom: "12px" }}>
                      <div className="card" style={{ padding: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>Public UID</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--teal-400)" }}>{formatAgentUid(agent.id, CONTRACT_ADDRESSES.somniaTestnet.SASRegistry)}</div>
                      </div>
                      <div className="card" style={{ padding: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>Success Rate</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--teal-400)" }}>{successRate}</div>
                      </div>
                      <div className="card" style={{ padding: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>Unique Callers</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--teal-400)" }}>{uniqueCallers}</div>
                      </div>
                      <div className="card" style={{ padding: "12px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>Version</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--teal-400)" }}>v{agent.version.toString()}</div>
                      </div>
                    </div>
                    <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-raised)", border: "1px solid var(--bg-border)", borderRadius: "8px", padding: "14px", fontSize: "12px", color: "var(--text-secondary)", overflowX: "auto" }}>
                      {integrationSnippet}
                    </pre>
                    <div style={{ marginTop: "14px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                        Builder Off-chain Updates
                      </div>
                      {offchainUpdates.length === 0 ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
                          No local off-chain update manifests have been published for this agent yet.
                        </p>
                      ) : (
                        <div style={{ display: "grid", gap: "10px" }}>
                          {offchainUpdates.map((update) => (
                            <div key={update.id} className="card" style={{ padding: "12px", background: "rgba(8,0,16,0.38)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", marginBottom: "5px" }}>
                                <strong style={{ fontSize: "13px" }}>{update.title}</strong>
                                <span style={{ fontFamily: "var(--font-mono)", color: "var(--teal-400)", fontSize: "11px" }}>{update.version}</span>
                              </div>
                              <p style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: 1.55, margin: "0 0 6px" }}>{update.summary}</p>
                              {update.docsUrl && (
                                <a href={update.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-400)", textDecoration: "none", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  Open docs <ExternalLink size={10} />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === "reviews" && (
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Reviews and ratings are planned for SAS v2. The current MVP tracks objective signals first: executions, success rate, revenue, and unique callers.
                    </p>
                    <div className="card" style={{ padding: "14px", background: "var(--bg-raised)" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
                        Planned v2 fields: rating average, review count, verified integration badge, abuse reports, and builder response notes.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Integration panel */}
          <div style={{ position: "sticky", top: "80px" }}>
            <div className="card" style={{ padding: "20px" }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                  Integration cost
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Zap size={16} color="var(--purple-400)" />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "22px", fontWeight: 700, color: "var(--purple-400)" }}>
                    {totalCost !== undefined ? `${formatSTT(totalCost, 4)} STT` : "Quote unavailable"}
                  </span>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Service fee {formatSTT(agentFee, 4)} STT (85% builder | 15% protocol)
                  {runtimeBudget !== undefined ? ` | Runtime ${formatSTT(runtimeBudget, 4)} STT` : ""}
                </div>
              </div>

              <div style={{ padding: "13px", borderRadius: "8px", background: "var(--bg-raised)", border: "1px solid var(--bg-border)", marginBottom: "14px" }}>
                <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.55, margin: 0 }}>
                  Run this agent from your app with the builder's documented payload. The marketplace detail page no longer submits demo executions, because raw test payloads can create misleading unresolved runs.
                </p>
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                <button
                  className="btn-primary"
                  onClick={() => setTab("integrate")}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                >
                  <Code2 size={14} />
                  View Integration Snippet
                </button>
                {docsUrl ? (
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{ width: "100%", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                  >
                    <BookOpen size={14} />
                    Open Builder Docs
                  </a>
                ) : (
                  <button
                    className="btn-secondary"
                    onClick={() => setTab("schema")}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                  >
                    <BookOpen size={14} />
                    View Payload Schema
                  </button>
                )}
              </div>

              {!isSomniaNative && (
                <div style={{ marginTop: "14px", color: "var(--text-muted)", fontSize: "12px", lineHeight: 1.5 }}>
                  This listing is legacy off-chain and is shown for discovery/docs only.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
