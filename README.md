# Somnia Agent Store

Somnia Agent Store, or SAS, is an on-chain marketplace and execution layer for Somnia-native agents. It lets builders publish agents with pricing and metadata, lets apps discover those agents, and routes paid execution through smart contracts so usage, fees, and execution history are verifiable.

The repository also includes Prophecy Companion, a focused consumer app that uses SAS to run a prediction-market research agent for Prophecy markets.

## Problems SAS Solves

Agent builders and consumer apps have several practical problems:

- Agent discovery is fragmented. Users need one place to find active Somnia agents, pricing, metadata, docs, and verification status.
- Agent execution needs a payment rail. Apps need a consistent way to quote, pay, execute, and track agent runs.
- Agents need a trust layer. Buyers need listing metadata, verification controls, billing records, and execution history.
- Multi-agent workflows are hard to coordinate. Apps need funded workflows, delegated steps, budget limits, and execution graphs.
- Sponsored or autonomous usage needs guardrails. Relayers and backend payers need spend caps, idempotency, and audit trails.

SAS solves these with smart contracts, frontend apps, and optional backend workers:

- `SASRegistry` stores listed agents, metadata, pricing, categories, and status.
- `SASBilling` quotes and executes paid agent calls.
- `SASAutonomyV4` coordinates budgeted multi-step workflows.
- `AutopilotVault` supports user-funded recurring missions with capped relayer execution.
- The marketplace frontend exposes discovery, builder publishing, docs, and admin controls.
- Worker services handle relaying, indexing, and governance automation where browser apps should not hold secrets.

## High-Level Workflow

1. A builder deploys or publishes a Somnia agent.
2. The builder registers the agent in SAS with name, category, metadata URI, price, and Somnia agent ID.
3. A user or app discovers the agent through the SAS marketplace or direct contract reads.
4. The app encodes the target agent payload.
5. The app calls `SASBilling.quoteExecution(agentId)` to get total cost.
6. The user pays with their wallet, or a backend/relayer sponsors the run under strict limits.
7. SAS emits execution records and events for UI tracking and indexing.
8. For autonomous workflows, `SASAutonomyV4` or `AutopilotVault` controls budget, step execution, and audit data.

## Prophecy Companion

Prophecy Companion is a specialized prediction-market research app built on top of SAS. It focuses on Prophecy event markets and helps users analyze whether a market may be mispriced.

### Problem It Solves

Prediction-market users often need more than the current market price:

- market pages can be noisy or incomplete
- evidence is scattered across source links, news, sports data, social context, and market metadata
- users need a clear probability estimate, confidence level, risk summary, and reasoning trail
- recurring market monitoring should not silently spend user funds

### Solution It Offers

Prophecy Companion lets a user submit a Prophecy event URL and analysis prompt, then routes the request through a configured SAS-listed agent.

It returns structured decision support such as:

- model probability
- market probability
- edge estimate
- confidence
- reasoning
- key evidence
- crowd signal
- external evidence summary
- risks
- suggested user action
- sources used

It can run in direct user-paid mode, delegated autonomy mode, or user-funded vault mission mode.

### How It Connects To SAS

Prophecy Companion does not bypass SAS billing. It connects through:

- `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID`: the SAS listing ID to execute.
- `NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID`: the underlying Somnia Agent Platform ID.
- `SASBilling.quoteExecution`: shows the execution cost before payment.
- `SASBilling.executeAgent`: executes direct paid runs.
- `SASAutonomyV4`: executes delegated workflow steps.
- `AutopilotVault`: executes recurring, user-funded missions through an authorized relayer.

The app builds market context server-side, encodes the agent payload, quotes SAS cost, prompts the wallet or relayer flow, then reads execution records back from SAS.

## Packages

- `packages/frontend`: main SAS marketplace, builder pages, docs, and admin UI.
- `packages/predire-app`: Prophecy Companion app.
- `packages/contracts`: Hardhat contracts, tests, and Somnia deployment scripts.
- `packages/companion-agent-sdk`: Prophecy Companion agent implementation, relayer, indexer, and E.V.E admin worker.
- `packages/indexer`: starter event indexer for SAS analytics.
- `packages/runner`: legacy autonomy runner. It is currently excluded from `pnpm-workspace.yaml`.

## Tech Stack

- Monorepo: pnpm workspaces
- Frontend: Next.js, React, TypeScript
- Wallet and chain IO: Privy, wagmi, viem
- Contracts: Solidity, Hardhat 3, Hardhat Ignition
- Chain: Somnia testnet/mainnet compatible EVM flow
- Workers: TypeScript, tsx
- Optional persistence: Supabase for autonomy memory and admin logs
- Model/provider path: Somnia Agent Platform, with OpenAI/Anthropic/Groq-compatible local worker paths where supported

## Local Setup

Install dependencies:

```bash
pnpm install
```

Copy only the env file you need:

```bash
cp packages/frontend/.env.example packages/frontend/.env
cp packages/predire-app/.env.example packages/predire-app/.env
cp packages/contracts/.env.example packages/contracts/.env
cp packages/companion-agent-sdk/.env.example packages/companion-agent-sdk/.env
cp packages/indexer/.env.example packages/indexer/.env
```

Never commit real `.env` files, private keys, service-role keys, API keys, generated state, build output, or dependency folders.

## SAS Marketplace App

Run locally:

```bash
pnpm dev:frontend
```

Build:

```bash
pnpm build:frontend
```

Important public env:

```env
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_SAS_ADMIN_ADDRESS=
NEXT_PUBLIC_SAS_ADMIN_PANEL_ENABLED=0
NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=
NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS=
NEXT_PUBLIC_IPFS_GATEWAY=
```

Use this app for:

- browsing listed agents
- viewing agent metadata
- builder publishing flows
- SAS integration docs
- optional restricted admin controls

## Prophecy Companion App

Run locally:

```bash
pnpm dev:predire
```

Build with env validation:

```bash
pnpm --filter ./packages/predire-app build:ci
```

Important env:

```env
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_SAS_REGISTRY_ADDRESS=
NEXT_PUBLIC_SAS_BILLING_ADDRESS=
NEXT_PUBLIC_SAS_EXECUTOR_ADDRESS=
NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS=
NEXT_PUBLIC_SAS_AUTONOMY_RUNNER_ADDRESS=0xddd660f9c166FB6fcAfb53e4f757fF9986Ef0995
NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=
NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID=
NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS=
NEXT_PUBLIC_AUTOPILOT_RELAYER_FEE_STT=0.20
NEXT_PUBLIC_AUTOPILOT_SCAN_FROM_BLOCK=
NEXT_PUBLIC_AUTOPILOT_LOG_CHUNK_SIZE=900
COMPANION_APP_CONTEXT_LIMIT=9000
COMPANION_APP_SOURCE_LIMIT=4
COMPANION_APP_ENABLE_WEB_RESEARCH=true
COMPANION_APP_RESEARCH_QUERY_LIMIT=4
COMPANION_APP_RESEARCH_RESULT_LIMIT=6
COMPANION_APP_RESEARCH_PAGE_LIMIT=3
COMPANION_APP_RESEARCH_PAGE_TEXT_LIMIT=1200
COMPANION_APP_RESEARCH_TIMEOUT_MS=9000
```

No `NEXT_PUBLIC_*` value should contain secrets. Anything prefixed with `NEXT_PUBLIC_` is exposed to the browser.

## Contracts

Run tests:

```bash
pnpm test:contracts
```

Build:

```bash
pnpm build:contracts
```

Register the Companion listing after the Somnia agent is published:

```bash
pnpm register:companion
```

Contract scripts require private keys and should run only from a controlled operator machine or CI with protected secrets. Do not deploy `packages/contracts` as a public web service.

## Companion Agent SDK and Workers

The SDK package contains:

- the Prophecy Companion agent implementation
- Somnia agent deployment helpers
- Autopilot relayer
- Autopilot indexer
- E.V.E admin worker
- optional Groq OpenAI-compatible proxy

Run a local one-off companion analysis:

```bash
pnpm --filter companion-agent-sdk start -- https://prophecy.social/event/14776
```

Run the relayer daemon:

```bash
pnpm --filter companion-agent-sdk autopilot:watch
```

Run the vault run indexer:

```bash
pnpm --filter companion-agent-sdk autopilot:index
```

Run E.V.E only when admin automation is intentionally enabled:

```bash
pnpm --filter companion-agent-sdk admin:eve
```

## Deployment

Use Vercel for browser apps:

- `packages/frontend`: SAS Marketplace
- `packages/predire-app`: Prophecy Companion

Use Railway for secret-bearing and long-running services:

- `packages/companion-agent-sdk` with `pnpm autopilot:watch`
- `packages/companion-agent-sdk` with `pnpm start`, if running a worker/API path
- `packages/companion-agent-sdk` with `pnpm admin:eve`, only if enabled
- `packages/indexer` with `pnpm start`, after persistence is added

Do not deploy as public web services:

- `packages/contracts`
- `packages/runner`, unless revived intentionally
- generated artifacts, cache, local logs, skill archives, or extracted reference bundles

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed Vercel/Railway settings and env lists.

## GitHub Hygiene

Before publishing the repository, remove:

- real `.env` files
- private keys or API keys in any file
- `node_modules/` and package `node_modules/`
- `.pnpm-store/`
- `.next/`
- Hardhat `artifacts/` and `cache/`
- logs
- `*.tsbuildinfo`
- local worker state files
- local skill archives and extracted reference material
- accidental scratch files

Keep:

- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.node-version`
- `.nvmrc`
- source code
- tests
- public assets
- env examples
- deployment docs

Recommended GitHub metadata:

- Description: `Somnia-native agent marketplace, billing contracts, Prophecy Companion app, and autonomous relayer services`
- Topics: `somnia`, `web3`, `agents`, `nextjs`, `hardhat`, `viem`, `prediction-markets`, `autonomy`
