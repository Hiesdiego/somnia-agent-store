# SAS Indexer

Starter scaffold for the future SAS analytics/indexing layer.

The MVP frontend can read on-chain records directly, but production SAS should
index events into an API/database for:

- recent executions
- per-agent analytics
- unique callers
- success rate
- latency
- parsed result summaries
- autonomous mission ids
- sponsored app ids
- trigger/idempotency keys
- watched-market snapshots
- ratings/reviews in v2
- verification status in v2

This package currently logs event subscriptions and defines the event handling
shape. Add database persistence after the product schema is finalized.

## Autonomy Role

The indexer is the memory layer for autonomous SAS integrations. It should
eventually store:

- which app or mission requested an execution
- whether a run was user-paid, builder-sponsored, or relayer-sponsored
- the trigger that caused the run
- the previous and current result summaries
- whether a market or real-world outcome later proved the agent correct

This lets SAS rank agents by actual reliability instead of only execution count.

## Run

Copy `.env.example` to `.env`, then from the repo root:

```bash
pnpm --filter indexer dev
```

No runner/custom off-chain logic belongs here. This package only indexes
Somnia-native SAS marketplace and billing events.
