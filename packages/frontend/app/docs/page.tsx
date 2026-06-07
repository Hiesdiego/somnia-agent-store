"use client";

import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { CONTRACT_ADDRESSES } from "@/lib/contracts/addresses";

const companionId = process.env.NEXT_PUBLIC_COMPANION_SAS_AGENT_ID?.trim() || "3";
const testnet = CONTRACT_ADDRESSES.somniaTestnet;

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "connection-map", label: "Connection Map" },
  { id: "listed-agent", label: "Use a Listed Agent" },
  { id: "autonomy-v4", label: "Autonomy V4" },
  { id: "backend-payer", label: "Backend Payer" },
  { id: "builder-docs", label: "Builder Docs" },
  { id: "checklist", label: "Launch Checklist" },
];

const DIRECT_EXECUTION_SNIPPET = `import { encodeFunctionData } from "viem";

const SAS_BILLING = "${testnet.SASBilling}";
const agentId = ${companionId}n;

const payload = encodeFunctionData({
  abi: SOMNIA_AGENT_METHOD_ABI,
  functionName: "inferString",
  args: [
    "Analyze this market and return probability, confidence, evidence, and risks.",
    "You are a concise prediction-market research agent.",
    false,
    []
  ]
});

const [agentFee, runtimeBudget, totalCost] = await publicClient.readContract({
  address: SAS_BILLING,
  abi: BILLING_ABI,
  functionName: "quoteExecution",
  args: [agentId]
});

const hash = await walletClient.writeContract({
  address: SAS_BILLING,
  abi: BILLING_ABI,
  functionName: "executeAgent",
  args: [agentId, payload],
  value: totalCost,
  account
});

// After confirmation, index AgentExecutionRequested or read getExecutionRecord(executionId).`;

const AUTONOMY_V4_SNIPPET = `import { encodeFunctionData, keccak256, parseEther } from "viem";

const SAS_AUTONOMY_V4 = "${testnet.SASAutonomyV4}";
const ZERO_BYTES32 = \`0x\${"0".repeat(64)}\`;

const rootAgentId = ${companionId}n;
const targetAgentId = ${companionId}n;
const payload = encodeFunctionData({
  abi: SOMNIA_AGENT_METHOD_ABI,
  functionName: "inferString",
  args: [prompt, systemPrompt, false, []]
});

const workflowHash = await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "createWorkflow",
  args: [
    rootAgentId,
    3n,
    ZERO_BYTES32,
    "ipfs://workflow-or-https-metadata.json"
  ],
  value: parseEther("3"),
  account
});

const stepHash = await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "planStep",
  args: [
    1n,
    0n,
    rootAgentId,
    targetAgentId,
    keccak256(payload),
    parseEther("1.5"),
    ZERO_BYTES32,
    "ipfs://step-metadata.json"
  ],
  account
});

const preview = await publicClient.readContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "previewStepExecution",
  args: [1n]
});

const executionHash = await walletClient.writeContract({
  address: SAS_AUTONOMY_V4,
  abi: AUTONOMY_V4_ABI,
  functionName: "executeStep",
  args: [1n, payload],
  account
});`;

const AUTONOMY_ABI_SNIPPET = `export const AUTONOMY_V4_ABI = [
  {
    name: "createWorkflow",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "rootAgentId", type: "uint256" },
      { name: "maxDepth", type: "uint256" },
      { name: "parentGraphWorkflowId", type: "bytes32" },
      { name: "metadataURI", type: "string" }
    ],
    outputs: [{ name: "workflowId", type: "uint256" }]
  },
  {
    name: "planStep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "workflowId", type: "uint256" },
      { name: "parentStepId", type: "uint256" },
      { name: "fromAgentId", type: "uint256" },
      { name: "toAgentId", type: "uint256" },
      { name: "payloadHash", type: "bytes32" },
      { name: "maxTotalCost", type: "uint256" },
      { name: "relationType", type: "bytes32" },
      { name: "metadataURI", type: "string" }
    ],
    outputs: [{ name: "stepId", type: "uint256" }]
  },
  {
    name: "executeStep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stepId", type: "uint256" },
      { name: "payload", type: "bytes" }
    ],
    outputs: [{ name: "executionId", type: "uint256" }]
  },
  {
    name: "previewStepExecution",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stepId", type: "uint256" }],
    outputs: [
      { name: "agentFee", type: "uint256" },
      { name: "runtimeBudget", type: "uint256" },
      { name: "totalCost", type: "uint256" },
      { name: "splitTotal", type: "uint256" },
      { name: "budgetRequired", type: "uint256" },
      { name: "remainingBudget", type: "uint256" }
    ]
  }
] as const;`;

const BACKEND_PAYER_SNIPPET = `// app/api/sas/execute/route.ts
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const payer = privateKeyToAccount(process.env.SAS_PAYER_PRIVATE_KEY as \`0x\${string}\`);
const maxSponsoredCost = 1_500_000_000_000_000_000n; // app policy, not user input

export async function POST(request: Request) {
  const { userId, agentId, prompt, idempotencyKey } = await request.json();

  await assertUserCanSpend({ userId, agentId, idempotencyKey });

  const payload = encodeFunctionData({
    abi: SOMNIA_AGENT_METHOD_ABI,
    functionName: "inferString",
    args: [prompt, "Return JSON only.", false, []]
  });

  const [, , totalCost] = await publicClient.readContract({
    address: "${testnet.SASBilling}",
    abi: BILLING_ABI,
    functionName: "quoteExecution",
    args: [BigInt(agentId)]
  });

  if (totalCost > maxSponsoredCost) {
    return NextResponse.json({ error: "Execution exceeds sponsor cap." }, { status: 402 });
  }

  const txHash = await walletClient.writeContract({
    address: "${testnet.SASBilling}",
    abi: BILLING_ABI,
    functionName: "executeAgent",
    args: [BigInt(agentId), payload],
    value: totalCost,
    account: payer
  });

  await saveSponsoredRun({ userId, agentId, idempotencyKey, payloadHash: keccak256(payload), txHash });
  return NextResponse.json({ txHash });
}`;

const METADATA_SNIPPET = `{
  "name": "Prophecy Companion",
  "description": "Prediction-market analysis agent",
  "docsUrl": "https://your-space.gitbook.io/prophecy-companion",
  "repositoryUrl": "https://github.com/your-org/agent-examples",
  "inputSchema": {
    "type": "object",
    "required": ["marketUrl", "question"],
    "properties": {
      "marketUrl": { "type": "string" },
      "question": { "type": "string" }
    }
  },
  "examples": [
    {
      "title": "Analyze a market",
      "payload": {
        "marketUrl": "https://...",
        "question": "Is YES underpriced?"
      },
      "response": {
        "prediction": "lean YES",
        "probability": 0.62,
        "confidence": 0.74
      }
    }
  ],
  "expectedLatency": "20-60 seconds",
  "rateLimits": "Cache public integrations for 5 minutes.",
  "limitations": ["Not financial advice", "Requires fresh market context"],
  "version": "1.0.0"
}`;

function CodeBlock({ children }: { children: string }) {
  return <pre>{children}</pre>;
}

function StepCard({ step, title, text }: { step: string; title: string; text: string }) {
  return (
    <div className="glass" style={{ padding: 16, borderRadius: 10 }}>
      <div style={{ color: "var(--cyan-300)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 8 }}>
        {step}
      </div>
      <h3 style={{ margin: "0 0 7px", fontSize: 15 }}>{title}</h3>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.58, margin: 0 }}>{text}</p>
    </div>
  );
}

export default function DocumentationPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "36px 24px 72px" }}>
        <div className="glass" style={{ padding: "30px", marginBottom: "18px" }}>
          <p style={{ color: "var(--teal-400)", fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 10px" }}>
            Builder integration documentation
          </p>
          <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", lineHeight: 1.04, letterSpacing: "-0.04em", margin: "0 0 12px" }}>
            Integrate SAS agents from discovery to paid execution
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.75, maxWidth: 860, margin: 0 }}>
            These docs show how an app discovers listed agents, encodes the target Somnia agent call, pays through SASBilling, triggers Autonomy V4 workflows, and sponsors runs with a backend payer.
          </p>
        </div>

        <div className="docs-layout" style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gap: "18px", alignItems: "start" }}>
          <aside className="card" style={{ padding: 16, position: "sticky", top: 82 }}>
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`} style={{ display: "block", color: "var(--text-secondary)", fontSize: 13, textDecoration: "none", padding: "8px 6px", borderRadius: 8 }}>
                {section.label}
              </a>
            ))}
          </aside>

          <div>
            <section id="overview" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>Overview</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Somnia Agent Store is the marketplace and payment layer for Somnia-native agents. A builder lists an agent with a SAS agent ID, metadata, docs, and price. A consumer app then chooses between two execution modes.
              </p>
              <ul>
                <li><strong>User-paid run:</strong> the user's wallet calls <code>SASBilling.executeAgent(agentId, payload)</code> with the quoted STT cost.</li>
                <li><strong>Autonomy V4 run:</strong> the app creates a funded workflow, plans one or more agent steps, and calls <code>SASAutonomyV4.executeStep(stepId, payload)</code>.</li>
                <li><strong>Sponsored run:</strong> your backend payer quotes the cost, enforces app policy, and pays <code>SASBilling</code> for the user.</li>
              </ul>
            </section>

            <section id="connection-map" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>How the Connection Works</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <StepCard step="01" title="Discover" text="Read SASRegistry listings and off-chain metadata to choose the agent and learn the input contract." />
                <StepCard step="02" title="Encode" text="Use the listed agent docs to encode the exact Somnia Agent Platform method payload." />
                <StepCard step="03" title="Quote" text="Ask SASBilling for agent fee, runtime budget, and total cost before any wallet prompt or sponsor payment." />
                <StepCard step="04" title="Execute" text="Call SASBilling directly, or call SASAutonomyV4 when the run belongs to a funded workflow." />
                <StepCard step="05" title="Track" text="Index events and read execution records so the app can show status, result, and audit trail." />
              </div>
            </section>

            <section id="listed-agent" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>Use a Listed Agent in Your App</h2>
              <ol>
                <li>Read the listing from <code>SASRegistry.getAgent(agentId)</code> or the SAS marketplace UI.</li>
                <li>Open the listing's <code>docsUrl</code> or GitBook URL and copy the supported method, payload shape, and examples.</li>
                <li>Validate user input against the listing's input schema before encoding the payload.</li>
                <li>Call <code>SASBilling.quoteExecution(agentId)</code> and show the total cost before prompting the wallet.</li>
                <li>Call <code>SASBilling.executeAgent(agentId, payload)</code> with <code>value: totalCost</code>.</li>
              </ol>
              <CodeBlock>{DIRECT_EXECUTION_SNIPPET}</CodeBlock>
            </section>

            <section id="autonomy-v4" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>Trigger or Use Autonomy V4</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Use Autonomy V4 when a run is part of a budgeted workflow: scheduled analysis, multi-agent research, conditional execution, parent-child steps, or split payouts to supporting agents. The workflow holds STT budget. Each step stores the expected payload hash, maximum total cost, relation metadata, and optional split rules.
              </p>
              <ol>
                <li>Create and fund a workflow with <code>createWorkflow(rootAgentId, maxDepth, parentGraphWorkflowId, metadataURI)</code>.</li>
                <li>Plan the target agent step with <code>planStep</code>. The <code>payloadHash</code> must equal <code>keccak256(payload)</code>.</li>
                <li>Optionally call <code>addStepSplit(stepId, beneficiaryAgentId, bps)</code> before execution.</li>
                <li>Call <code>previewStepExecution(stepId)</code> and compare <code>budgetRequired</code> with your workflow budget.</li>
                <li>Call <code>executeStep(stepId, payload)</code>. Autonomy V4 pays <code>SASBilling</code> internally and records the execution graph.</li>
              </ol>
              <CodeBlock>{AUTONOMY_V4_SNIPPET}</CodeBlock>
              <h3>Minimal ABI</h3>
              <CodeBlock>{AUTONOMY_ABI_SNIPPET}</CodeBlock>
            </section>

            <section id="backend-payer" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>Build a Backend Payer for Sponsored Runs</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                A backend payer is a server wallet that sponsors SASBilling on behalf of users. Keep the private key server-side, enforce your own quotas before signing, and persist idempotency keys so repeated requests do not double-spend.
              </p>
              <ol>
                <li>Create a funded payer wallet and store its private key as a server-only secret.</li>
                <li>Require app authentication, user quotas, agent allowlists, spend caps, and idempotency keys.</li>
                <li>Quote <code>SASBilling.quoteExecution(agentId)</code> on every request and reject costs above policy.</li>
                <li>Encode the payload server-side or verify a user-submitted payload hash against the original request.</li>
                <li>Call <code>SASBilling.executeAgent</code> from the payer wallet and store the transaction hash plus payload hash.</li>
              </ol>
              <CodeBlock>{BACKEND_PAYER_SNIPPET}</CodeBlock>
            </section>

            <section id="builder-docs" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>What Builders Should Publish</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Every listed agent should include enough metadata for another app to use it without asking the builder for private instructions. The docs should include method names, payload examples, response shape, latency, limits, failure modes, and version notes.
              </p>
              <CodeBlock>{METADATA_SNIPPET}</CodeBlock>
            </section>

            <section id="checklist" className="card" style={{ padding: 22, marginBottom: 16 }}>
              <h2>Launch Checklist</h2>
              <ul>
                <li>Listing is active and verified where applicable.</li>
                <li>Docs URL includes one working payload and one decoded response example.</li>
                <li>App validates payloads before quoting or executing.</li>
                <li>Wallet flow stores transaction hash and execution ID.</li>
                <li>Backend payer has allowlists, spend caps, idempotency, and alerting.</li>
                <li>Autonomy V4 workflows set max depth, max total cost, metadata URI, and payload hash before execution.</li>
              </ul>
            </section>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/marketplace" className="btn-primary" style={{ textDecoration: "none" }}>Browse Agents</Link>
              <Link href="/builder/publish" className="btn-secondary" style={{ textDecoration: "none" }}>Publish Agent</Link>
              <Link href="/docs/autonomy" className="btn-secondary" style={{ textDecoration: "none" }}>Autonomy Page</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
