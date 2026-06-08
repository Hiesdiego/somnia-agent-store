# Deployment Guide

This repo should deploy as multiple services. Keep browser apps on Vercel and long-running workers on Railway.

## Pre-Deployment Checklist

- Confirm contracts are already deployed on the target Somnia network.
- Confirm the public contract addresses in each app match the deployed contracts.
- Confirm the Prophecy Companion listing IDs are current:
  - `NEXT_PUBLIC_COMPANION_SAS_AGENT_ID`
  - `NEXT_PUBLIC_COMPANION_SOMNIA_AGENT_ID`
- Run local verification:

```bash
pnpm install
pnpm build:frontend
pnpm build:predire
pnpm --filter companion-agent-sdk type-check
pnpm test:contracts
```

- Rotate any private key that was ever committed, pasted into logs, or shared outside the deployment host.
- Remove generated files and local state before making the GitHub repository public.

## Vercel

Deploy these as separate Vercel projects from the same GitHub repo.

### SAS Marketplace

- Vercel root directory: `packages/frontend`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build`
- Output: Next.js default

Required env:

```env
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_SAS_ADMIN_ADDRESS=
NEXT_PUBLIC_SAS_ADMIN_PANEL_ENABLED=0
NEXT_PUBLIC_COMPANION_SAS_AGENT_ID=
NEXT_PUBLIC_AUTOPILOT_VAULT_ADDRESS=
NEXT_PUBLIC_IPFS_GATEWAY=
```

Only enable `NEXT_PUBLIC_SAS_ADMIN_PANEL_ENABLED=1` for a restricted admin deployment.

### Prophecy Companion

- Vercel root directory: `packages/predire-app`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build:ci`
- Output: Next.js default

Required env:

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
COMPANION_APP_CONTEXT_RATE_LIMIT=30
COMPANION_APP_DISCOVERY_RATE_LIMIT=12
COMPANION_APP_MAX_FETCH_BYTES=1500000
COMPANION_APP_MAX_PROPHECY_BYTES=2000000
COMPANION_DISCOVERY_FALLBACK_EVENTS=
```

Do not put private keys, Supabase service-role keys, or model provider API keys in `NEXT_PUBLIC_*` variables.

## Railway

Deploy long-running or secret-bearing services to Railway. Create separate Railway services from the same GitHub repo and set each service root directory.

## Fly.io

Use Fly.io for Companion Agent services when the host expects an HTTP service instead of a background worker. The repo includes a root `Dockerfile` and service-specific Fly configs. Every daemon service exposes `GET /health` on `PORT` so Fly can keep the machine healthy.

### Companion Agent HTTP API

- App name: `prophecy-companion-agent`
- Organization: your Fly organization
- Branch: `main`
- Working directory: `/`
- Config path: `fly.toml`
- Internal port: `8080`
- Start command: Docker default, `pnpm --filter companion-agent-sdk serve`

Endpoints:

```txt
GET /health
POST /analyze
GET /analyze?eventUrl=https://prophecy.social/event/12333
```

Deploy:

```bash
fly deploy -c fly.toml
```

### Autopilot Relayer

- App name: `sas-autopilot-relayer`
- Config path: `fly.autopilot.toml`
- Internal port: `8080`
- Start command: `pnpm --filter companion-agent-sdk autopilot:watch`

Deploy:

```bash
fly deploy -c fly.autopilot.toml
```

### E.V.E Admin Service

- App name: `eve-admin-service`
- Config path: `fly.eve.toml`
- Internal port: `8080`
- Start command: `pnpm --filter companion-agent-sdk admin:eve`

Deploy this only when admin automation is intentionally active.

```bash
fly deploy -c fly.eve.toml
```

### PC Trader Relayer

- App name: `pc-trader-relayer`
- Config path: `fly.trader.toml`
- Internal port: `8080`
- Start command: `pnpm --filter companion-agent-sdk trader:watch`

Deploy:

```bash
fly deploy -c fly.trader.toml
```

### Autopilot Indexer

- App name: `sas-autopilot-indexer`
- Config path: `fly.indexer.toml`
- Internal port: `8080`
- Start command: `pnpm --filter companion-agent-sdk autopilot:index`

Deploy:

```bash
fly deploy -c fly.indexer.toml
```

## Render Web Services

Render free tier supports web services, not background workers. This repo now includes `render.yaml` at the repo root, with each Companion Agent daemon configured as a Docker web service that exposes `GET /health`.

Render free web services spin down after 15 minutes without inbound HTTP or WebSocket traffic. This is fine for testing the Companion HTTP API, but it is not reliable for always-on relayers unless you move them to a paid instance or keep them actively receiving traffic.

Current deployed endpoints:

```txt
Companion Agent API: https://prophecy-companion-agent.onrender.com
PC Trader Relayer: https://pc-trader-relayer.onrender.com
EVE Admin Service: https://eve-admin-service.onrender.com
SAS Autopilot Relayer: https://sas-autopilot-relayer-6rm4.onrender.com
Prophecy Companion frontend: https://somnia-agent-store-predire-app.vercel.app
SAS Marketplace frontend: https://somnia-agent-store-frontend.vercel.app
```

### Dashboard Form: Companion Agent API

- Service type: Web Service
- Repository: `Hiesdiego/somnia-agent-store`
- Branch: `main`
- Runtime: Docker
- Root directory: leave blank / repo root
- Dockerfile path: `./Dockerfile`
- Docker context: `.`
- Docker command: `pnpm --filter companion-agent-sdk serve`
- Health check path: `/health`
- Region: Oregon, or the closest available region
- Instance type: Free

Required env:

```env
PORT=10000
COMPANION_SERVICE_NAME=prophecy-companion-agent
COMPANION_SERVICE_CORS_ORIGIN=*
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network
PRIVATE_KEY=
COMPANION_LLM_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
COMPANION_OPENAI_BASE_URL=https://api.groq.com/openai/v1
AGENT_REGISTRY_ADDRESS=
AGENT_EXECUTOR_ADDRESS=
```

### Blueprint Option

Instead of filling each service manually, use Render Blueprint from the root `render.yaml`. Render will prompt for every `sync: false` secret value during creation.

For first deployment, create only `prophecy-companion-agent` manually or remove the other services from the Blueprint before applying it. Deploying all five free web services can exhaust free monthly hours quickly and relayers can sleep when idle.

### Autopilot Relayer

- Railway root directory: `packages/companion-agent-sdk`
- Build command: `pnpm install --frozen-lockfile`
- Start command: `pnpm autopilot:watch`

Required env:

```env
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network
PRIVATE_KEY=
RELAYER_PRIVATE_KEY=
AUTOPILOT_VAULT_ADDRESS=
AUTOPILOT_RELAYER_FEE_STT=0.20
AUTOPILOT_SCAN_FROM_BLOCK=
AUTOPILOT_LOG_CHUNK_SIZE=900
AUTOPILOT_DAEMON_INTERVAL_MS=60000
AUTOPILOT_MAX_EXECUTIONS_PER_SCAN=5
COMPANION_APP_CONTEXT_ENDPOINT=https://your-prophecy-companion-domain.example/api/market-context
AUTONOMY_STORE_MODE=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SCHEMA=public
```

Use a dedicated vault-authorized relayer wallet. Do not reuse the deployer or admin wallet.

### Companion Agent API/Worker

- Railway root directory: `packages/companion-agent-sdk`
- Build command: `pnpm install --frozen-lockfile`
- Start command: `pnpm start`

Required env depends on provider:

```env
PRIVATE_KEY=
COMPANION_LLM_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
COMPANION_OPENAI_BASE_URL=https://api.groq.com/openai/v1
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network
```

Use OpenAI or Anthropic for hosted Somnia platform compatibility if custom OpenAI-compatible endpoints are blocked.

### E.V.E Admin Worker

- Railway root directory: `packages/companion-agent-sdk`
- Build command: `pnpm install --frozen-lockfile`
- Start command: `pnpm admin:eve`

Required env:

```env
PRIVATE_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SCHEMA=public
NEXT_PUBLIC_SAS_REGISTRY_ADDRESS=
NEXT_PUBLIC_SAS_BILLING_ADDRESS=
NEXT_PUBLIC_SAS_AUTONOMY_V4_ADDRESS=
SAS_EXECUTION_GRAPH_ADDRESS=
GROQ_API_KEY=
EVE_ALLOW_DEPRECATE=false
```

Deploy this only if the admin automation is intentionally active.

### SAS Indexer

- Railway root directory: `packages/indexer`
- Build command: `pnpm install --frozen-lockfile`
- Start command: `pnpm start`

Required env:

```env
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network
SAS_REGISTRY_ADDRESS=
SAS_BILLING_ADDRESS=
```

This package is currently a scaffold. Add database persistence before relying on it for production analytics.

## Do Not Deploy

- `packages/contracts` as a web service. Use it from CI or a controlled operator machine for contract deployment, verification, and admin scripts.
- `packages/runner` unless you decide to revive it. It is excluded from the pnpm workspace and appears to be a legacy autonomy runner.
- local skill archives or extracted reference material.

## What To Delete Before GitHub Listing

Delete from the repository working tree:

- root `node_modules/`
- package `node_modules/` directories
- `.pnpm-store/`
- root `logs/`
- `packages/runner/logs/`
- `packages/frontend/.next/`
- `packages/predire-app/.next/`
- `packages/contracts/artifacts/`
- `packages/contracts/cache/`
- `packages/frontend/tsconfig.tsbuildinfo`
- `packages/predire-app/tsconfig.tsbuildinfo`
- all real `.env` files in root or packages
- `packages/companion-agent-sdk/.autonomy-state.json`
- `packages/companion-agent-sdk/.autopilot-relayer-state.json`
- `packages/companion-agent-sdk/.pc-trader-relayer-state.json`
- `packages/runner/.env`
- `somnia-skill.zip`
- `somnia-skill_extracted/`
- `packages/companion-agent-sdk/console.log('engine-ok'))`
- `packages/companion-agent-sdk/console.log('autonomy-module-ok'))`

Keep:

- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.node-version`
- `.nvmrc`
- every `*.env.example` and `.env.production.example`
- source code under `app/`, `components/`, `lib/`, `src/`, `contracts/`, `scripts/`, and `test/`
- public assets under each app's `public/`
- Hardhat Ignition modules and parameter examples
- deployment address records only if you intentionally want public testnet provenance

## GitHub Listing Checklist

- Add a concise repository description: `Somnia-native agent marketplace, billing contracts, Prophecy Companion app, and autonomous relayer services`.
- Add topics: `somnia`, `web3`, `agents`, `nextjs`, `hardhat`, `viem`, `prediction-markets`, `autonomy`.
- Set the default branch protection before accepting outside contributions.
- Ensure GitHub secret scanning is enabled.
- Keep the repository private until `.env` files, generated artifacts, and accidental local files are removed.
