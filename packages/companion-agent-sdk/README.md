# Companion Agent SDK

This package is the **Somnia SDK-native** implementation path for Prophecy Companion.
Use it to build/deploy your Somnia agent, obtain a real `somniaAgentId`, then register that ID in SAS.

## 1) Configure

1. Copy `.env.example` to `.env`.
2. Set `PRIVATE_KEY`.
3. Set `COMPANION_LLM_PROVIDER` to `openai`, `anthropic`, or `groq`.
4. Set the matching model key.

For the platform-safe path, use OpenAI or Anthropic because those are the providers Somnia officially supports.

For Groq, this package uses an OpenAI-compatible path:

```env
COMPANION_LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
COMPANION_OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

If your installed `somnia-agent-kit` does not honor custom OpenAI base URLs, run the local proxy and point the agent at it:

```bash
pnpm --filter companion-agent-sdk proxy:groq
```

```env
COMPANION_LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
COMPANION_OPENAI_BASE_URL=http://localhost:8787/v1
```

If Somnia's hosted agent platform blocks custom provider endpoints, deploy the hosted agent with OpenAI/Anthropic and keep Groq only for local/self-hosted execution.

For production relayer/indexer deployment, start from `.env.production.example`.
Keep `RELAYER_PRIVATE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in your host secrets manager, not in source control.
The relayer wallet should be a dedicated vault-authorized wallet, never a deployer or admin key.

## 2) Run locally

If `COMPANION_EVENT_URL` is set in `.env`:

```bash
pnpm --filter companion-agent-sdk start
```

Or pass a one-off event URL:

```bash
pnpm --filter companion-agent-sdk start -- https://prophecy.social/event/14776
```

You can also pass the full JSON payload:

```bash
pnpm --filter companion-agent-sdk start -- "{\"eventUrl\":\"https://prophecy.social/event/14776\"}"
```

This executes the SDK agent prompt path and prints model output.

Before calling the model, the agent fetches the Prophecy event page and extracts:

- page title and description metadata
- visible page text
- embedded script data that appears related to the event/market/resolution
- structured market facts from embedded JSON payloads
- structured market facts from raw embedded script text when clean JSON is unavailable
- detected market domain, such as sports, crypto, politics, weather, entertainment, finance, or general
- broader web research snippets and source-page summaries

If the site only exposes market details through a private/client API, the output will say extraction was incomplete. In that case, wire the specific Prophecy API endpoint into `fetchMarketPage`.

The companion is designed to help Prophecy users make better predictions, so it does not rely only on Prophecy market odds. With `COMPANION_ENABLE_WEB_RESEARCH=1`, it also searches for outside evidence such as:

- head-to-head history, momentum, injuries, lineups, odds, and form for sports
- recent news, public sentiment, market context, and domain-specific evidence for non-sports markets
- fetched summaries from top search result pages

The model response keeps the original app-friendly fields and adds decision-support fields:

- `crowdSignal`
- `externalEvidenceSummary`
- `risks`
- `suggestedUserAction`
- `sourcesUsed`

Recommendation wording is intentionally conservative. The companion should say things like `lean YES`, `lean NO`, `watch/no clear edge`, or `avoid`; it should not command users to gamble or present the output as financial/betting advice.

## 3) Deploy/Publish on Somnia Agent Platform

Prophecy Companion is wired through SAS as a listed agent. For production, SAS should point at the official Somnia Agent Platform base agent ID used by the companion runtime:

- `SOMNIA_AGENT_PLATFORM_ADDRESS=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- `COMPANION_SOMNIA_AGENT_ID=<official_or_published_agent_id>`

Do not use the legacy SDK registry deployment path for new production listings. The current Somnia Agents flow calls the Agent Platform contract directly and stores the Somnia agent ID on the SAS listing.

## 4) Register in SAS

Set in `packages/contracts/.env`:

- `COMPANION_AGENT_TYPE=LLM_INFERENCE` (or `WEBSITE_PARSE` if your published agent is that type)
- `COMPANION_SOMNIA_AGENT_ID=<published_id>`

Then run:

```bash
pnpm register:companion
```

Copy emitted values into `packages/predire-app/.env`:

- `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=<sas_id>`
- `NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID=<published_id>`

## 5) Autopilot Relayer

The relayer executes user-funded `AutopilotVault` missions. It does not custody user funds; it can only spend a mission balance on the configured SAS agent. Each run is charged the billing quote (`agentFee + runtimeBudget`) plus a relayer reimbursement bounded by the user-defined cap.

Required env:

- `RELAYER_PRIVATE_KEY`: private key for the vault-authorized relayer wallet.
- `AUTOPILOT_VAULT_ADDRESS`: deployed vault address.
- `AUTOPILOT_RELAYER_FEE_STT`: relayer reimbursement requested per run.

Optional env:

- `COMPANION_APP_CONTEXT_ENDPOINT=http://localhost:3010/api/market-context`

Run one mission execution:

```bash
pnpm --filter companion-agent-sdk autopilot:execute -- --mission 0xMISSION_ID --url https://prophecy.social/event/14776
```

With explicit relayer fee and idempotency key:

```bash
pnpm --filter companion-agent-sdk autopilot:execute -- --mission 0xMISSION_ID --url https://prophecy.social/event/14776 --relayerFee 0.20 --key 0xIDEMPOTENCY_KEY
```

The command submits `AutopilotVault.executeMission`, then prints the linked SAS `executionId` from the `MissionSpent` event. Each execution includes a vault-checked `payloadHash` and emitted `contextHash` for audit.

### Automatic watcher

Run the daemon to continuously ingest mission context, update thesis memory, detect anomalies, and execute when cadence/trigger policy allows:

```bash
pnpm --filter companion-agent-sdk autopilot:watch
```

Run one scan only:

```bash
pnpm --filter companion-agent-sdk autopilot:watch -- --once
```

Inspect due missions without spending vault funds:

```bash
pnpm --filter companion-agent-sdk autopilot:watch -- --once --dry-run
```

Dry-run mode does not submit transactions and does not persist relayer state.

Ingest only (no execution transactions):

```bash
pnpm --filter companion-agent-sdk autopilot:watch -- --ingest-only
```

Inspect or execute one mission only:

```bash
pnpm --filter companion-agent-sdk autopilot:watch -- --once --dry-run --mission 0xMISSION_ID
pnpm --filter companion-agent-sdk autopilot:watch -- --once --mission 0xMISSION_ID --max 1
```

Daemon env:

- `AUTOPILOT_SCAN_FROM_BLOCK`: block to start scanning `MissionCreated` events from.
- `AUTOPILOT_LOG_CHUNK_SIZE`: RPC-safe block window for log scans, default `900`.
- `AUTOPILOT_DAEMON_INTERVAL_MS`: scan interval, default `60000`.
- `AUTOPILOT_STATE_FILE`: local JSON state file for last-run timestamps.
- `AUTOPILOT_MAX_EXECUTIONS_PER_SCAN`: safety cap for live executions per scan, default `5`.

The daemon reads and enforces each mission's `metadataURI`. Prophecy Companion writes metadata with:

- `url`
- `eventId`
- `question`
- `agentId`
- `cadenceMinutes`
- `watchId`
- `maxRuns`
- `expiresAt`
- `maxRelayerFeeWei`
- `maxTotalSpendWei`
- `marketHash`
- `questionHash`
- `payloadTemplateHash`

The daemon rejects missions when metadata is missing, stale, points outside `https://prophecy.social/event/<id>`, targets a different agent, or does not match the vault's immutable market, question, payload-template, run-count, expiry, relayer-fee, and spend-cap policy. The vault also enforces those economic/schedule/hash fields on-chain and verifies `keccak256(payload) == payloadHash` before spending.

The daemon uses deterministic idempotency keys scoped by cadence or trigger type and time bucket, so accidental duplicates in the same bucket are rejected by the vault.

### Vault Run Indexer

Run the Companion vault run indexer:

```bash
pnpm --filter companion-agent-sdk autopilot:index
```

Run one scan only:

```bash
pnpm --filter companion-agent-sdk autopilot:index -- --once
```

Indexer env:

- `AUTOPILOT_INDEXER_STATE_FILE`: block cursor state, default `.autopilot-indexer-state.json`.
- `AUTOPILOT_RUN_LOG_FILE`: normalized `MissionSpent` JSONL output, default `.autopilot-runs.jsonl`.
- `AUTOPILOT_LOG_CHUNK_SIZE`: RPC-safe block window for log scans.

Mount state/output files on durable storage. Browser log scans should be treated as a fallback view only; operations should rely on indexed `MissionSpent` records.
The indexed record includes `payloadTemplateHash`, `payloadHash`, and `contextHash`; join it with `SASBilling.getExecutionRecord(executionId)` to verify that the billed payload matches the vault-emitted hash.

### Autonomy Memory and Learning

The watcher now runs a full autonomy loop:

```text
Ingest context -> build snapshot -> detect triggers -> multi-agent consensus ->
update thesis revisions -> decide execute -> record run -> learn from resolved outcomes
```

Persisted memory entities:

- market snapshots
- trigger history
- thesis revisions
- resolved outcomes
- learned signal weights

Storage modes:

- `AUTONOMY_STORE_MODE=local` writes to `AUTONOMY_LOCAL_STATE_FILE`
- `AUTONOMY_STORE_MODE=supabase` writes to Supabase PostgREST tables

Supabase schema file:

```text
packages/companion-agent-sdk/supabase/autonomy_schema.sql
```

Key autonomy env:

- `AUTONOMY_ODDS_JUMP_BPS`
- `AUTONOMY_VOLUME_SPIKE_MULTIPLIER`
- `AUTONOMY_SENTIMENT_DIVERGENCE_THRESHOLD`
- `AUTONOMY_WHALE_FLOW_THRESHOLD`
- `AUTONOMY_MIN_CONFIDENCE_TO_EXECUTE`
- `AUTONOMY_MIN_EDGE_TO_EXECUTE`
- `AUTONOMY_LEARNING_RATE`

Optional resolved-outcome sync API:

- `AUTONOMY_OUTCOME_SYNC_URL`
- `AUTONOMY_OUTCOME_SYNC_API_KEY`

Manual outcome recording (for feedback learning):

```bash
pnpm --filter companion-agent-sdk autonomy:outcome -- --url https://prophecy.social/event/14776 --outcome YES
```

## 6) Agent E.V.E (Admin Agent MVP)

`Agent E.V.E` is a governance-ops agent for SAS with intentionally limited scope:

- allowlist and ops toggles only (`SASAutonomyV4.setExecutor`, `SASExecutionGraph.setRecorder`)
- continuous agent verification checks (`SASRegistry.setAgentVerified`)
- optional force deprecation after repeated failures (`SASRegistry.adminDeprecateAgent`)

Creator chat/notification is intentionally excluded in this version.

E.V.E has two pieces:

- the off-chain admin worker in this package (`pnpm --filter companion-agent-sdk admin:eve`)
- the on-chain `EVEAgentRequester` contract in `packages/contracts`, which creates requests against the official Somnia Agent Platform LLM agent

Deploy the requester contract:

```bash
pnpm deploy:eve:requester:testnet
```

Then wire the deployed requester address into env:

```env
SOMNIA_AGENT_PLATFORM_ADDRESS=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
SOMNIA_LLM_AGENT_ID=12847293847561029384
EVE_SOMNIA_AGENT_ID=12847293847561029384
EVE_AGENT_REQUESTER_ADDRESS=<deployed_EVEAgentRequester_address>
NEXT_PUBLIC_EVE_SOMNIA_AGENT_ID=12847293847561029384
NEXT_PUBLIC_EVE_AGENT_REQUESTER_ADDRESS=<deployed_EVEAgentRequester_address>
```

`deploy:eve:somnia-agent` is now a confirmation helper only; it checks the configured official platform deposit and prints the values that should be used for wiring. It does not register E.V.E into the deprecated SDK registry.

For LLM requests, fund the call with the full standard request value, not only the platform reserve floor. On Shannon testnet the current E.V.E requester requires `0.24 STT` per `requestGovernanceReport` call: `0.03 STT` platform reserve plus `0.07 STT * 3` LLM subcommittee budget.

Test the funded on-chain E.V.E request path:

```bash
pnpm -C packages/contracts test:eve:request -- "Audit the SAS EVE deployment and return compact JSON."
```

Run DB schema first:

```bash
psql "$SUPABASE_DB_URL" -f packages/companion-agent-sdk/supabase/eve_admin_schema.sql
```

Required env for E.V.E:

- `PRIVATE_KEY` (or `EVE_PRIVATE_KEY`) for the SAS admin wallet
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SAS_REGISTRY_ADDRESS` (or `SAS_REGISTRY_ADDRESS`)
- `NEXT_PUBLIC_SAS_BILLING_ADDRESS` (or `SAS_BILLING_ADDRESS`)
- `NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS` (or `SAS_AUTONOMY_V4_ADDRESS`)
- `SAS_EXECUTION_GRAPH_ADDRESS`
- `GROQ_API_KEY` (used for audit summaries)
  - optional override: `EVE_GROQ_API_KEY`
  - optional model override: `EVE_GROQ_MODEL` (must be a text/chat model, not Whisper)

Run E.V.E:

```bash
pnpm --filter companion-agent-sdk admin:eve
```

Optional controls:

- `EVE_LOOP_INTERVAL_MS` (default `120000`)
- `EVE_UNVERIFY_FAILURE_STREAK` (default `2`)
- `EVE_DEPRECATE_FAILURE_STREAK` (default `5`)
- `EVE_ALLOW_DEPRECATE` (default `false`)
- `EVE_ENABLE_ALLOWLIST_TOGGLES` (default `true`)
