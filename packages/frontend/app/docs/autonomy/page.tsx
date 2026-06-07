"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { CONTRACT_ADDRESSES } from "@/lib/contracts/addresses";
import { Bot, BookOpen, GitBranch, Radio, Shield, Sparkles, Zap } from "lucide-react";

const autonomyAddress = CONTRACT_ADDRESSES.somniaTestnet.SASAutonomyV4;

const WORKFLOW_SNIPPET = `const SAS_AUTONOMY_V4 = "${autonomyAddress}";

// 1. Fund a workflow.
await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "createWorkflow",
  args: [rootAgentId, 3n, ZERO_BYTES32, metadataURI],
  value: workflowBudget,
  account
});

// 2. Commit the step and payload hash.
await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "planStep",
  args: [workflowId, parentStepId, fromAgentId, toAgentId, keccak256(payload), maxTotalCost, relationType, stepMetadataURI],
  account
});

// 3. Execute with the exact payload that matches the planned hash.
await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "executeStep",
  args: [stepId, payload],
  account
});`;

const CAPABILITIES = [
  {
    icon: Radio,
    title: "Autonomous marketplace monitoring",
    text: "EVE watches listing status, execution activity, builder updates, and stale integration signals so users can understand which agents are ready to use.",
  },
  {
    icon: BookOpen,
    title: "Documentation intelligence",
    text: "EVE highlights GitBook links, schemas, examples, latency notes, limitations, changelogs, and support URLs from builder metadata.",
  },
  {
    icon: GitBranch,
    title: "Off-chain release awareness",
    text: "EVE treats builder update manifests as the release stream for docs, schema migrations, examples, and integration warnings.",
  },
  {
    icon: Shield,
    title: "Autonomy V4 execution path",
    text: "EVE explains createWorkflow, planStep, previewStepExecution, executeStep, sponsored runs, idempotency keys, and relayer spend caps.",
  },
];

export default function EveDocsPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "36px 24px 72px" }}>
        <div className="glass" style={{ padding: "30px", marginBottom: "18px" }}>
          <p style={{ color: "var(--teal-400)", fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 10px" }}>
            Governor EVE Agent
          </p>
          <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", lineHeight: 1.04, letterSpacing: "-0.04em", margin: "0 0 12px" }}>
            Autonomy V4 workflows for Somnia Agent Store
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.75, maxWidth: 790, margin: 0 }}>
            Governor EVE is the frontend-facing guide for SAS autonomy. This page shows how apps move from a listed agent to a funded workflow, planned step, billing-backed execution, and traceable execution graph.
          </p>
        </div>

        <section className="card" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 18, alignItems: "center" }}>
            <div className="eve-orb" style={{ width: 72, height: 72, borderRadius: 18, display: "grid", placeItems: "center", background: "linear-gradient(135deg, var(--purple-600), var(--teal-400))", boxShadow: "var(--glow-teal)" }}>
              <Sparkles size={28} />
            </div>
            <div>
              <h2 style={{ margin: "0 0 8px" }}>EVE's greeting</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
                "Bring me a listed agent, a payload, and a workflow budget. I will show the exact V4 path: createWorkflow, planStep, previewStepExecution, then executeStep through SASBilling."
              </p>
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginBottom: 16 }}>
          {CAPABILITIES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card" style={{ padding: 20 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 12 }}>
                <Icon size={19} color="var(--cyan-300)" />
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 13, margin: 0 }}>{text}</p>
            </div>
          ))}
        </section>

        <section className="card" style={{ padding: 24, marginBottom: 16 }}>
          <h2>Autonomy V4 Execution Order</h2>
          <ul>
            <li><strong>Create:</strong> call <code>createWorkflow(rootAgentId, maxDepth, parentGraphWorkflowId, metadataURI)</code> with STT value to fund the workflow.</li>
            <li><strong>Plan:</strong> call <code>planStep</code> with target agent, parent step, payload hash, max total cost, relation type, and metadata URI.</li>
            <li><strong>Preview:</strong> call <code>previewStepExecution(stepId)</code> to inspect total cost, split total, budget required, and remaining budget.</li>
            <li><strong>Execute:</strong> call <code>executeStep(stepId, payload)</code>. V4 verifies the payload hash, pays <code>SASBilling</code>, and records the graph edge.</li>
            <li><strong>Close:</strong> finalize or cancel the workflow when the app's autonomous run is complete.</li>
          </ul>
          <pre>{WORKFLOW_SNIPPET}</pre>
        </section>

        <section className="card" style={{ padding: 24, marginBottom: 16 }}>
          <h2>Operational Boundaries</h2>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
            EVE is a guide and coordination layer. Contract-critical state remains on-chain in the registry and billing contracts. Builder docs, GitBook links, schemas, and release notes remain off-chain metadata so they can evolve quickly without requiring a contract write for every documentation change.
          </p>
        </section>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/docs#eve-agent" className="btn-primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Bot size={15} /> EVE in Full Docs
          </Link>
          <Link href="/marketplace" className="btn-secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Zap size={15} /> Explore Agents
          </Link>
        </div>
      </main>
    </div>
  );
}
