"use client";

import { Navbar } from "@/components/layout/Navbar";
import { useUserExecutions } from "@/lib/hooks/useBilling";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import {
  ExecutionRecord, ExecutionStatus,
  EXECUTION_STATUS_LABELS,
  formatSTT, formatRelative, formatDate,
} from "@/lib/types";
import { BarChart2, Zap, TrendingDown, Clock, Loader2, ExternalLink } from "lucide-react";

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.PENDING]: "var(--purple-400)",
  [ExecutionStatus.SUCCESS]: "var(--teal-400)",
  [ExecutionStatus.FAILED]:  "#F87171",
  [ExecutionStatus.TIMEOUT]: "var(--amber-400)",
};

function decodeResult(result: `0x${string}`): string {
  if (!result || result === "0x") return "—";
  try {
    // Try to decode as abi.encode(string)
    const hex = result.slice(2);
    // Skip ABI encoding header (64 bytes offset + 32 bytes length)
    const dataHex = hex.slice(128);
    const bytes = new Uint8Array(dataHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
    const text = new TextDecoder().decode(bytes).replace(/\0/g, "");
    // Try to pretty-print JSON
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  } catch {
    return result.slice(0, 80) + "…";
  }
}

export default function UserDashboard() {
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const { data: executions, isLoading } = useUserExecutions(address);

  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <div style={{ textAlign: "center", padding: "80px 24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔐</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px" }}>
            Connect your wallet to see your execution history
          </p>
        </div>
      </div>
    );
  }

  const sorted = executions ? [...executions].reverse() : [];
  const totalSpend  = sorted.reduce((s, e) => s + e.amountPaid, 0n);
  const successCount = sorted.filter(e => e.status === ExecutionStatus.SUCCESS).length;
  const pendingCount = sorted.filter(e => e.status === ExecutionStatus.PENDING).length;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, margin: "0 0 4px", letterSpacing: "-0.03em" }}>
            My <span className="gradient-text">Executions</span>
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
            Every agent run you've triggered on Somnia.
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
          {[
            { label: "Total Runs",    value: String(sorted.length),              icon: BarChart2,    color: "var(--purple-400)" },
            { label: "Successful",    value: String(successCount),               icon: Zap,          color: "var(--teal-400)" },
            { label: "Pending",       value: String(pendingCount),               icon: Clock,        color: "var(--amber-400)" },
            { label: "Total Spent",   value: `${formatSTT(totalSpend, 4)} STT`, icon: TrendingDown, color: "#F87171" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card" style={{ padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                <Icon size={13} color={color} />
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "20px", fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Execution history */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--bg-border)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, margin: 0 }}>
              Execution History
            </h2>
          </div>

          {isLoading ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Loader2 size={20} color="var(--purple-400)" style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "36px", marginBottom: "12px" }}>🤖</div>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 16px" }}>
                You haven't run any agents yet.
              </p>
              <a href="/marketplace" style={{ color: "var(--purple-400)", textDecoration: "none", fontSize: "14px", fontWeight: 600 }}>
                → Browse the marketplace
              </a>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {sorted.map((exec: ExecutionRecord, i) => {
                const decoded = decodeResult(exec.result);
                return (
                  <div
                    key={exec.id.toString()}
                    style={{
                      borderTop: i > 0 ? "1px solid var(--bg-border)" : "none",
                      padding: "16px 20px",
                      transition: "background 150ms ease",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-raised)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Row header */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
                          Exec #{exec.id.toString()}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
                          Agent #{exec.agentId.toString()}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--purple-400)" }}>
                          {formatSTT(exec.amountPaid, 4)} STT
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: STATUS_COLORS[exec.status as ExecutionStatus],
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {EXECUTION_STATUS_LABELS[exec.status as ExecutionStatus]}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                          {formatRelative(exec.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Result */}
                    {exec.result && exec.result !== "0x" && (
                      <div
                        style={{
                          background: "var(--bg-raised)",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "12px",
                          color: "var(--teal-400)",
                          maxHeight: "120px",
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          border: "1px solid var(--bg-border)",
                        }}
                      >
                        {decoded}
                      </div>
                    )}

                    {/* Pending spinner */}
                    {exec.status === ExecutionStatus.PENDING && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                        <Loader2 size={12} color="var(--purple-400)" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--purple-400)" }}>
                          Waiting for agent result…
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
