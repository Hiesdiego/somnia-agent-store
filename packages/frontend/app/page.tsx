"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Navbar } from "@/components/layout/Navbar";
import { usePlatformStats } from "@/lib/hooks/useBilling";
import { useAgentCount } from "@/lib/hooks/useRegistry";
import { formatSTT } from "@/lib/types";
import {
  ArrowRight,
  BarChart2,
  BookOpen,
  Bot,
  Brain,
  Code2,
  Cpu,
  FileText,
  GitBranch,
  Globe,
  Radio,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: Brain,
    title: "Somnia-native reasoning",
    desc: "List LLM, JSON API, and website parsing agents created on the Somnia Agent Platform.",
    color: "var(--purple-300)",
  },
  {
    icon: Shield,
    title: "Contract-level billing",
    desc: "Users pay execution cost up front while builder revenue and protocol fee split automatically.",
    color: "var(--cyan-300)",
  },
  {
    icon: FileText,
    title: "GitBook-ready docs",
    desc: "Attach integration guides, schemas, examples, limits, and changelogs through off-chain metadata.",
    color: "var(--teal-400)",
  },
  {
    icon: GitBranch,
    title: "Builder update stream",
    desc: "Publish off-chain update manifests so apps can follow version notes without changing contracts.",
    color: "var(--amber-400)",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Create on Somnia", desc: "Build the agent on Somnia Agent Platform and keep the resulting Somnia Agent ID." },
  { step: "02", title: "List on Somnia Agent Store", desc: "Register the agent ID, service fee, metadata URI, category, and integration documentation." },
  { step: "03", title: "Apps integrate", desc: "Consumer apps read the guide, encode the Somnia agent payload, and call SASBilling." },
  { step: "04", title: "Builders update", desc: "Push off-chain changelogs, schemas, GitBook links, and migration notes from the dashboard." },
];

const AUTONOMY_FLOW = [
  { step: "Fund", title: "Create workflow budget", desc: "Apps lock STT into Autonomy V4 before any agent step can spend it." },
  { step: "Plan", title: "Commit payload hash", desc: "Each step stores the target agent, max cost, relation metadata, and keccak256 payload hash." },
  { step: "Run", title: "Execute through SASBilling", desc: "Autonomy V4 calls SASBilling internally, updates the graph, and keeps remaining budget visible." },
];

const EVE_SIGNALS = [
  "createWorkflow budget ready",
  "planStep payload hash locked",
  "previewStepExecution within cap",
  "executeStep routed to SASBilling",
];

export default function LandingPage() {
  const { authenticated, login } = usePrivy();
  const { data: stats } = usePlatformStats();
  const { data: agentCount } = useAgentCount();

  return (
    <div style={{ minHeight: "100vh", overflow: "hidden" }}>
      <Navbar />

      <section style={{ maxWidth: "1220px", margin: "0 auto", padding: "76px 24px 56px" }}>
        <div className="landing-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.05fr) minmax(320px, 0.95fr)", gap: "34px", alignItems: "center" }}>
          <div>
            <div className="glass" style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "7px 14px", marginBottom: 24 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--teal-400)", display: "inline-block" }} className="animate-pulse-glow" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan-300)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Live on Somnia Shannon Testnet
              </span>
            </div>

            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(42px, 6vw, 78px)", fontWeight: 800, lineHeight: 0.98, letterSpacing: "-0.035em", margin: "0 0 22px" }}>
              The agent marketplace governed by <span className="gradient-text">EVE</span>
            </h1>

            <p style={{ fontSize: "clamp(16px, 2vw, 19px)", color: "var(--text-secondary)", maxWidth: 650, lineHeight: 1.65, margin: "0 0 30px" }}>
              Somnia Agent Store gives builders a production frontend for Somnia agents: discovery, pay-per-run billing, integration docs, off-chain update notes, and a clear path for apps that want to use agent intelligence.
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 34 }}>
              <Link href="/marketplace">
                <button className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 22px" }}>
                  <Zap size={16} /> Browse Agents
                </button>
              </Link>
              {!authenticated ? (
                <button className="btn-secondary" onClick={() => login()} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 22px" }}>
                  Start Building <ArrowRight size={15} />
                </button>
              ) : (
                <Link href="/builder/publish">
                  <button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 22px" }}>
                    Publish Agent <ArrowRight size={15} />
                  </button>
                </Link>
              )}
              <Link href="/docs">
                <button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 22px" }}>
                  <BookOpen size={16} /> Read Docs
                </button>
              </Link>
            </div>

            <div className="landing-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 12, maxWidth: 690 }}>
              {[
                { label: "Agents Listed", value: agentCount?.toString() ?? "0", icon: Bot },
                { label: "Total Runs", value: Number(stats?.[0] ?? 0).toLocaleString(), icon: BarChart2 },
                { label: "Service Revenue", value: stats ? `${formatSTT(stats[1], 2)} STT` : "0 STT", icon: TrendingUp },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="glass" style={{ padding: 16, borderRadius: 10 }}>
                  <Icon size={15} color="var(--cyan-300)" />
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(18px, 3vw, 26px)", color: "var(--text-primary)", fontWeight: 800, marginTop: 8 }}>{value}</div>
                  <div style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass eve-orb" style={{ padding: 24, borderRadius: 18, position: "relative", minHeight: 500 }}>
            <div style={{ position: "absolute", inset: 18, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan-300)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Governor EVE Agent</div>
                  <h2 style={{ margin: "6px 0 0", fontSize: 24, letterSpacing: "-0.03em" }}>Autonomy V4 Sentinel</h2>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(185,185,185,0.72))", boxShadow: "var(--glow-purple)", color: "#050505" }}>
                  <Sparkles size={22} />
                </div>
              </div>

              <div style={{ borderRadius: 14, padding: 18, background: "rgba(8,0,16,0.56)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 18 }}>
                <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.65, fontSize: 15 }}>
                  "I watch the path from listed agent to funded workflow: quote the run, lock the payload hash, execute through SASBilling, and leave the app with a traceable execution record."
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, height: 110, alignItems: "end", marginBottom: 18 }}>
                {[42, 76, 58, 92, 64, 84, 50, 70].map((height, i) => (
                  <div
                    key={i}
                    className="signal-line"
                    style={{
                      height: `${height}%`,
                      borderRadius: 999,
                      background: i % 2 === 0 ? "linear-gradient(180deg, #ffffff, rgba(255,255,255,0.1))" : "linear-gradient(180deg, #bdbdbd, rgba(255,255,255,0.08))",
                      animationDelay: `${i * 120}ms`,
                    }}
                  />
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {EVE_SIGNALS.map((signal, i) => (
                  <div key={signal} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "11px 13px", borderRadius: 10, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-secondary)", fontSize: 13 }}>
                      {i === 0 ? <Radio size={14} color="var(--teal-400)" /> : i === 1 ? <FileText size={14} color="var(--cyan-300)" /> : i === 2 ? <Cpu size={14} color="var(--purple-300)" /> : <Globe size={14} color="var(--amber-400)" />}
                      {signal}
                    </span>
                    <span className="badge badge-active">Online</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: "1160px", margin: "0 auto", padding: "28px 24px 72px" }}>
        <div style={{ textAlign: "center", maxWidth: 660, margin: "0 auto 34px" }}>
          <h2 style={{ fontSize: "clamp(27px, 4vw, 44px)", lineHeight: 1.08, margin: "0 0 12px", letterSpacing: "-0.035em" }}>
            Built for builders who need more than a listing page
          </h2>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.65, margin: 0 }}>
            Each agent can ship with docs, schemas, release notes, runtime expectations, and a direct integration snippet.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
          {FEATURES.map(({ icon: Icon, title, desc, color }, i) => (
            <div key={title} className="card animate-fade-in" style={{ padding: 22, animationDelay: `${i * 80}ms` }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 15 }}>
                <Icon size={19} color={color} />
              </div>
              <h3 style={{ fontSize: 16, margin: "0 0 8px", letterSpacing: "-0.015em" }}>{title}</h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.58 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--bg-border)", borderBottom: "1px solid var(--bg-border)", background: "rgba(8,0,16,0.34)", padding: "72px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: "clamp(26px, 4vw, 40px)", margin: "0 0 36px", letterSpacing: "-0.03em" }}>Production flow</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
            {HOW_IT_WORKS.map(({ step, title, desc }) => (
              <div key={step} className="glass" style={{ padding: 18, borderRadius: 12 }}>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--cyan-300)", fontSize: 11, letterSpacing: "0.1em", marginBottom: 10 }}>STEP {step}</div>
                <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.58, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: "1160px", margin: "0 auto", padding: "74px 24px 34px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(320px, 1.1fr)", gap: 18, alignItems: "stretch" }} className="landing-hero-grid">
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontFamily: "var(--font-mono)", color: "var(--teal-400)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
              Autonomy V4 Workflow
            </div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", lineHeight: 1.08, margin: "0 0 14px", letterSpacing: "-0.035em" }}>
              Budgeted agent workflows for apps that need more than one click
            </h2>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, margin: "0 0 18px" }}>
              Autonomy V4 lets an app create a funded workflow, plan agent steps with cost caps, execute SAS-listed agents, and preserve parent-child execution context for scheduled, conditional, or multi-agent experiences.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/docs#autonomy-v4"><button className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><GitBranch size={15} /> View V4 Guide</button></Link>
              <Link href="/docs#backend-payer"><button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Shield size={15} /> Backend Payer</button></Link>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {AUTONOMY_FLOW.map(({ step, title, desc }) => (
              <div key={step} className="glass" style={{ padding: 18, borderRadius: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", marginBottom: 14 }}>
                  {step === "Fund" ? <Zap size={18} color="var(--amber-400)" /> : step === "Plan" ? <Code2 size={18} color="var(--cyan-300)" /> : <Cpu size={18} color="var(--teal-400)" />}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", color: "var(--cyan-300)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 8 }}>{step}</div>
                <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.58, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 960, margin: "0 auto", padding: "76px 24px" }}>
        <div className="card landing-eve-cta" style={{ padding: "32px", display: "grid", gridTemplateColumns: "72px 1fr", gap: 22, alignItems: "start" }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, display: "grid", placeItems: "center", background: "linear-gradient(135deg, var(--purple-600), var(--teal-400))", boxShadow: "var(--glow-teal)", fontWeight: 800 }}>
            EVE
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.025em" }}>Governor EVE recommends clean docs</h3>
              <span className="badge badge-verified">GitBook-ready</span>
            </div>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.65, margin: "0 0 18px" }}>
              Use GitBook or your own documentation site as the public home for each agent guide. Link it through metadataURI, then keep quick update notes off-chain from the builder dashboard so integrators know when schemas, examples, limits, or behavior change.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/docs#builder-guide"><button className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><BookOpen size={15} /> Builder Docs</button></Link>
              <Link href="/builder/dashboard"><button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><GitBranch size={15} /> Push Updates</button></Link>
              <Link href="/docs#integration-guide"><button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Code2 size={15} /> Integration Guide</button></Link>
            </div>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--bg-border)", padding: 24, textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          Somnia Agent Store | Governor EVE interface | Testnet STT
        </p>
      </footer>
    </div>
  );
}
