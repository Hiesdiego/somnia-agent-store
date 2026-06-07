"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { useRegisterAgent } from "@/lib/hooks/useRegistry";
import { AgentType, AGENT_TYPE_LABELS } from "@/lib/types";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle, Zap, Loader2, ExternalLink } from "lucide-react";

const CATEGORIES = ["Sports", "Finance", "AI", "Data", "DeFi", "Gaming", "Social", "Research"];
type SupportedAgentType = AgentType.LLM_INFERENCE | AgentType.JSON_API | AgentType.WEBSITE_PARSE;

const TYPE_DESCRIPTIONS: Record<SupportedAgentType, { description: string; example: string }> = {
  [AgentType.LLM_INFERENCE]: {
    description: "AI reasoning and text generation using Somnia's validator-backed LLM infrastructure.",
    example: "Sports prediction, content generation, sentiment analysis",
  },
  [AgentType.JSON_API]: {
    description: "Fetch and extract structured data from public REST APIs on-chain.",
    example: "Price feeds, weather data, sports scores, API oracles",
  },
  [AgentType.WEBSITE_PARSE]: {
    description: "Scrape and extract content from web pages using AI, fully on-chain.",
    example: "News sentiment, social metrics, on-page data extraction",
  },
};

const BUILDER_TYPES: SupportedAgentType[] = [
  AgentType.LLM_INFERENCE,
  AgentType.JSON_API,
  AgentType.WEBSITE_PARSE,
];

interface FormState {
  name: string;
  description: string;
  category: string;
  metadataURI: string;
  gitbookUrl: string;
  documentationUrl: string;
  repositoryUrl: string;
  expectedLatency: string;
  agentType: SupportedAgentType;
  pricePerExecution: string;
  somniaAgentId: string;
}

const INITIAL: FormState = {
  name: "",
  description: "",
  category: "AI",
  metadataURI: "",
  gitbookUrl: "",
  documentationUrl: "",
  repositoryUrl: "",
  expectedLatency: "",
  agentType: AgentType.LLM_INFERENCE,
  pricePerExecution: "0.01",
  somniaAgentId: "0",
};

export default function PublishAgentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const { register, isPending, isConfirming, isSuccess, hash } = useRegisterAgent();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!form.name.trim()) { toast.error("Agent name is required"); return; }
    if (!form.description.trim()) { toast.error("Description is required"); return; }
    if (parseFloat(form.pricePerExecution) <= 0) { toast.error("Price must be > 0 STT"); return; }
    if (!form.somniaAgentId || form.somniaAgentId === "0") {
      toast.error("Somnia Agent Platform ID is required for on-chain agents");
      return;
    }

    const inlineMetadata = {
      name: form.name,
      description: form.description,
      category: form.category,
      tags: [form.category, AGENT_TYPE_LABELS[form.agentType]],
      gitbookUrl: form.gitbookUrl || undefined,
      docsUrl: form.gitbookUrl || form.documentationUrl || undefined,
      documentationUrl: form.documentationUrl || undefined,
      repositoryUrl: form.repositoryUrl || undefined,
      expectedLatency: form.expectedLatency || undefined,
      inputSchema: {
        type: "object",
        description: "Define the exact request shape in your GitBook or external docs.",
        example: "{\"prompt\":\"Analyze this market\"}",
      },
      outputSchema: {
        type: "object",
        description: "Define the exact result shape in your GitBook or external docs.",
        example: "{\"result\":\"...\",\"confidence\":0.72}",
      },
      examples: [],
      limitations: [],
      version: "1.0.0",
    };

    const metadataURI = form.metadataURI || `data:application/json,${encodeURIComponent(JSON.stringify(inlineMetadata))}`;

    register({
      name: form.name,
      description: form.description,
      category: form.category,
      metadataURI,
      agentType: form.agentType,
      pricePerExecutionSTT: form.pricePerExecution,
      somniaAgentId: BigInt(form.somniaAgentId || "0"),
    });
  }

  const steps = ["Type", "Details", "Pricing", "Review"];

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <button
            onClick={() => router.back()}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "13px", fontFamily: "var(--font-display)", padding: 0, marginBottom: "14px" }}
          >
            <ArrowLeft size={13} /> Back
          </button>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, margin: "0 0 4px", letterSpacing: "-0.03em" }}>
            Publish an <span className="gradient-text">Agent</span>
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
            Create your agent on Somnia first, then list its Somnia Agent ID on Somnia Agent Store. Self-serve publishing supports only Somnia-native agent types.
          </p>
          <a href="/docs#builder-guide" style={{ display: "inline-flex", marginTop: "8px", color: "var(--teal-400)", fontSize: "12px", textDecoration: "none" }}>
            Read builder guide
          </a>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", gap: "0", marginBottom: "28px" }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
              <div
                onClick={() => i < step && setStep(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: i < step ? "pointer" : "default",
                }}
              >
                <div
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background: i <= step ? "linear-gradient(135deg, var(--purple-600), var(--purple-500))" : "var(--bg-raised)",
                    border: i <= step ? "none" : "1px solid var(--bg-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: i <= step ? "white" : "var(--text-muted)",
                    flexShrink: 0,
                    transition: "all 300ms ease",
                  }}
                >
                  {i < step ? <CheckCircle size={12} /> : i + 1}
                </div>
                <span style={{ fontSize: "12px", color: i === step ? "var(--text-primary)" : "var(--text-muted)", fontWeight: i === step ? 600 : 400, whiteSpace: "nowrap" }}>
                  {s}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: "1px", background: i < step ? "var(--purple-600)" : "var(--bg-border)", margin: "0 10px", transition: "background 300ms ease" }} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="card" style={{ padding: "24px", marginBottom: "16px" }}>

          {/* Step 0: Type */}
          {step === 0 && (
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 700, margin: "0 0 16px" }}>
                Select Agent Type
              </h2>
              <div
                style={{
                  marginBottom: "12px",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  background: "rgba(20, 184, 166, 0.08)",
                  border: "1px solid rgba(20, 184, 166, 0.22)",
                  fontSize: "12px",
                  color: "var(--teal-400)",
                }}
              >
                Builder self-serve mode: deploy/create on Somnia first, then register the Somnia Agent ID here.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {BUILDER_TYPES.map((type) => {
                  const info = TYPE_DESCRIPTIONS[type];
                  const selected = form.agentType === type;
                  return (
                    <div
                      key={String(type)}
                      onClick={() => update("agentType", type)}
                      style={{
                        padding: "16px",
                        borderRadius: "10px",
                        border: selected ? "1px solid var(--purple-500)" : "1px solid var(--bg-border)",
                        background: selected ? "rgba(124, 58, 237, 0.08)" : "var(--bg-raised)",
                        cursor: "pointer",
                        transition: "all 150ms ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, fontSize: "14px", color: selected ? "var(--purple-400)" : "var(--text-primary)" }}>
                          {AGENT_TYPE_LABELS[type]}
                        </span>
                        {selected && <CheckCircle size={14} color="var(--purple-400)" />}
                      </div>
                      <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 4px", lineHeight: 1.5 }}>{info.description}</p>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
                        e.g. {info.example}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 1: Details */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 700, margin: 0 }}>
                Agent Details
              </h2>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Agent Name *
                </label>
                <input className="input" value={form.name} onChange={e => update("name", e.target.value)} placeholder="Flash Predire" maxLength={64} />
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Description *
                </label>
                <textarea className="input" value={form.description} onChange={e => update("description", e.target.value)} placeholder="Prophecy Companion or another Somnia-native agent listed through SAS" rows={3} style={{ resize: "vertical" }} />
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Category
                </label>
                <select className="input" value={form.category} onChange={e => update("category", e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Metadata URI (IPFS / Arweave)
                </label>
                <input className="input" value={form.metadataURI} onChange={e => update("metadataURI", e.target.value)} placeholder="ipfs://QmYourMetadataHash or https://docs.example.com/agent.json" />
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Recommended - point to metadata with docs/GitBook URL, input schema, output schema, and examples.
                </p>
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  GitBook URL
                </label>
                <input className="input" value={form.gitbookUrl} onChange={e => update("gitbookUrl", e.target.value)} placeholder="https://your-space.gitbook.io/your-agent" />
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Optional but recommended. This is shown to app builders as the primary integration guide.
                </p>
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Separate Docs URL
                </label>
                <input className="input" value={form.documentationUrl} onChange={e => update("documentationUrl", e.target.value)} placeholder="https://docs.yourdomain.com/agent" />
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Repository URL
                </label>
                <input className="input" value={form.repositoryUrl} onChange={e => update("repositoryUrl", e.target.value)} placeholder="https://github.com/your-org/agent-examples" />
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Expected Latency
                </label>
                <input className="input" value={form.expectedLatency} onChange={e => update("expectedLatency", e.target.value)} placeholder="20-60 seconds" />
              </div>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Somnia Agent Platform ID *
                </label>
                <input className="input" type="number" value={form.somniaAgentId} onChange={e => update("somniaAgentId", e.target.value)} placeholder="e.g. 42" min="1" />
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Required. Create/deploy your agent on Somnia Agent Platform first, then paste the resulting ID here.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Pricing */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 700, margin: 0 }}>
                Pricing
              </h2>
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  Price per Execution (STT) *
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={form.pricePerExecution}
                  onChange={e => update("pricePerExecution", e.target.value)}
                  placeholder="0.01"
                />
              </div>
              <div style={{ background: "var(--bg-raised)", borderRadius: "10px", padding: "16px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
                  Revenue Breakdown
                </div>
                {[
                  { label: "Your service fee/run", value: `${form.pricePerExecution || "0"} STT`, color: "var(--text-primary)" },
                  { label: "You earn (85%)", value: `${((parseFloat(form.pricePerExecution || "0")) * 0.85).toFixed(6)} STT`, color: "var(--teal-400)" },
                  { label: "Protocol fee (15%)", value: `${((parseFloat(form.pricePerExecution || "0")) * 0.15).toFixed(6)} STT`, color: "var(--text-muted)" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Review + Submit */}
          {step === 3 && (
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 700, margin: "0 0 16px" }}>
                Review & Publish
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                {[
                  { label: "Name", value: form.name },
                  { label: "Type", value: AGENT_TYPE_LABELS[form.agentType] },
                  { label: "Category", value: form.category },
                  { label: "GitBook", value: form.gitbookUrl || "Not provided" },
                  { label: "Docs URL", value: form.documentationUrl || "Not provided" },
                  { label: "Service Fee/Run", value: `${form.pricePerExecution} STT` },
                  { label: "Somnia Agent ID", value: form.somniaAgentId },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg-raised)", borderRadius: "8px" }}>
                    <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{value}</span>
                  </div>
                ))}
              </div>

              {isSuccess ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <CheckCircle size={32} color="var(--teal-400)" style={{ marginBottom: "10px" }} />
                  <p style={{ fontSize: "15px", fontWeight: 700, color: "var(--teal-400)", margin: "0 0 8px" }}>Agent published successfully!</p>
                  <a href={`https://shannon-explorer.somnia.network/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: "12px", color: "var(--purple-400)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "16px" }}>
                    <ExternalLink size={11} /> View transaction
                  </a>
                  <br />
                  <button className="btn-primary" onClick={() => router.push("/builder/dashboard")}>
                    Go to Dashboard
                  </button>
                </div>
              ) : (
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={isPending || isConfirming}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: isPending || isConfirming ? 0.6 : 1 }}
                >
                  {isPending || isConfirming ? (
                    <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />{isPending ? "Confirm in wallet..." : "Publishing..."}</>
                  ) : (
                    <><Zap size={14} /> Publish to Blockchain</>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        {step < 3 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button
              onClick={() => setStep(s => Math.max(0, s - 1))}
              className="btn-secondary"
              disabled={step === 0}
              style={{ opacity: step === 0 ? 0 : 1, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={() => setStep(s => Math.min(3, s + 1))}
              className="btn-primary"
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              Next <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

