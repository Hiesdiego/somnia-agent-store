# Prophecy Companion

Prophecy Companion is a standalone consumer app for Somnia Prophecy analysis.
It executes SAS-listed on-chain agents through either:

- direct single-step billing (`SASBilling.executeAgent`), or
- delegated workflows on `SASAutonomyV4`.

## Behavior

- Pull active agents from `SASRegistry`.
- Lock to one configured listing: `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID`.
- Submit a `https://prophecy.social/event/<id>` URL + analysis ask as structured payload.
- Read `SASBilling.quoteExecution(agentId)` and pay the displayed agent fee plus Somnia runtime budget.
- Optional autonomy mode: create workflow budget and execute a multi-step chain via `SASAutonomyV4`.
- In autonomy mode, delegation is automatic by default: the planner picks delegates from active SAS listings each run (manual override is available in UI).
- Encode payload as Somnia agent method calldata:
  - `WEBSITE_PARSE` -> `ExtractString(...)`
  - `LLM_INFERENCE` -> `inferString(...)`
- Decode `AgentExecutionRequested` to get execution id.
- Poll `getExecutionRecord` and display prediction, probability, confidence, reasoning, crowd signal, external evidence, risks, suggested action, and sources used.
- Auto-build LLM context from Prophecy embedded market data, Prophecy source links, and optional web research before sending an LLM-inference payload.
- Show recent execution history for the selected agent.
- Provide an Opportunity Scout that discovers Prophecy candidate markets and turns them into edge-analysis prompts.
- Provide an Autonomy Console for standing market watches.
- Refresh watched-market evidence snapshots in the browser and detect changes.
- Load changed watches into the on-chain SAS analysis flow when the user wants a fresh confirmed run.
- Marketplace pages, builder documentation, and integration guides belong in the main SAS app.
- This app stays focused on one job: consume the configured SAS-listed Companion agent.

## V2 Direction: Opportunity Scout

Prophecy Companion is becoming an autonomous prediction-market research agent.
The core product is not "predict one market repeatedly"; it is:

> find potentially mispriced Prophecy markets and explain the evidence-based edge.

The Scout flow is:

1. User describes an opportunity mission.
2. App discovers candidate Prophecy event pages.
3. User selects a candidate for deep SAS/Somnia analysis.
4. Companion estimates `modelProbability`, reads or infers `marketProbability`, computes `edge`, and explains confidence/risk.
5. User can add promising candidates to the watchlist or fund a vault mission for recurring autonomous runs.

The expected rich output fields now include:

- `modelProbability`
- `marketProbability`
- `edge`
- `opportunityScore`
- `resolutionClarity`
- `riskLevel`

## Autonomy boundary

The current browser Autopilot monitors evidence only. It does not silently spend
STT or sign recurring transactions. Fully sponsored autonomous execution should
be implemented through a builder backend, SAS relayer, prepaid balance, or
session-key flow with explicit user limits.

The app now supports user-funded vault missions:

- user adds a watched market
- user creates a vault mission with STT funding
- `AutopilotVault` keeps the balance and spend accounting on-chain
- authorized relayer executes watched-market runs until the mission balance is exhausted
- each vault run pays agent service fee, Somnia runtime budget, and the capped relayer fee
- user can cancel the mission and withdraw unused funds
- the app can read `MissionSpent` events and link each autonomous spend to the SAS execution/result

Set `NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS` in `.env` to the deployed vault address.
Set `NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS` in `.env` to enable delegated autonomy mode in the analysis workspace.
Set `NEXT_PUBLIC_AUTOPILOT_RELAYER_FEE_STT` to the default per-run cap shown when users create a mission; it must be at least the fee requested by the active relayer.
Set `NEXT_PUBLIC_AUTOPILOT_SCAN_FROM_BLOCK` and `NEXT_PUBLIC_AUTOPILOT_LOG_CHUNK_SIZE`
to keep browser log scans inside Somnia RPC limits.

## Analysis quality controls

For `LLM_INFERENCE` runs, the app fetches the Prophecy event page server-side and
injects structured context into the prompt. These environment variables tune the
context budget and research depth:

- `COMPANION_APP_CONTEXT_LIMIT`
- `COMPANION_APP_SOURCE_LIMIT`
- `COMPANION_APP_ENABLE_WEB_RESEARCH`
- `COMPANION_APP_RESEARCH_QUERY_LIMIT`
- `COMPANION_APP_RESEARCH_RESULT_LIMIT`
- `COMPANION_APP_RESEARCH_PAGE_LIMIT`
- `COMPANION_APP_RESEARCH_PAGE_TEXT_LIMIT`
- `COMPANION_APP_RESEARCH_TIMEOUT_MS`

Higher limits can improve reasoning quality, but they also increase payload size
and may raise wallet gas estimates.

## Companion deployment flow

1. Build and deploy your analysis agent on Somnia platform (SDK path) and get its `somniaAgentId`.
   - SDK workspace: `packages/companion-agent-sdk`
2. Register that agent in SAS using:
   - `pnpm --filter contracts register:companion`
3. Copy the emitted `SAS agentId` into `packages/predire-app/.env` as:
   - `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=...`
   - `NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID=...`

Groq note: Groq usage depends on your Somnia-side agent implementation. The Companion app itself executes via Somnia agent ID through SAS.

For the full Companion UI, the SAS-listed agent should return valid JSON with:

- `prediction`
- `probability`
- `confidence`
- `reasoning`
- `resolutionCriteria`
- `marketSummary`
- `keyEvidence`
- `crowdSignal`
- `externalEvidenceSummary`
- `risks`
- `suggestedUserAction`
- `sourcesUsed`

The SDK implementation in `packages/companion-agent-sdk` already targets this shape. If the deployed Somnia agent returns only the older fields, the app still works but the richer sections remain hidden.

## Run

1. Copy `.env.example` to `.env`
2. Set `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID`
3. From repo root run `pnpm dev:predire`

App URL: `http://localhost:3010`

## Indexing note

The MVP reads execution records directly from `SASBilling`. For production, add an indexer that listens to:

- `AgentExecutionRequested`
- `ExecutionStatusUpdated`

Then cache recent runs, per-agent analytics, user history, and parsed result summaries in an API/database while keeping the chain as source of truth.
