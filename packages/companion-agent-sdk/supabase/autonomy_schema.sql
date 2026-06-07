-- Prophecy Companion autonomy memory schema
-- Run in Supabase SQL editor for the target project/schema.

create table if not exists public.pc_market_snapshots (
  id text primary key,
  mission_id text not null,
  event_url text not null,
  event_id text null,
  captured_at timestamptz not null,
  context_hash text not null,
  context_raw text not null,
  signals jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pc_market_snapshots_mission_time
  on public.pc_market_snapshots (mission_id, captured_at desc);

create table if not exists public.pc_trigger_history (
  id text primary key,
  mission_id text not null,
  event_url text not null,
  trigger_type text not null,
  triggered_at timestamptz not null,
  severity double precision not null,
  details jsonb not null default '{}'::jsonb,
  execution_requested boolean not null default false,
  execution_id text null,
  idempotency_key text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pc_trigger_history_mission_time
  on public.pc_trigger_history (mission_id, triggered_at desc);

create table if not exists public.pc_thesis_revisions (
  id text primary key,
  mission_id text not null,
  event_url text not null,
  snapshot_id text not null,
  revision integer not null,
  created_at timestamptz not null,
  consensus jsonb not null,
  active_triggers jsonb not null default '[]'::jsonb,
  hypothesis text not null,
  execution_source text not null,
  execution_id text null,
  resolved_outcome text null,
  scored_at timestamptz null,
  brier_score double precision null
);

create index if not exists idx_pc_thesis_revisions_mission_revision
  on public.pc_thesis_revisions (mission_id, revision desc);

create index if not exists idx_pc_thesis_revisions_unscored
  on public.pc_thesis_revisions (scored_at)
  where scored_at is null;

create table if not exists public.pc_resolved_outcomes (
  id text primary key,
  mission_id text null,
  event_url text not null,
  resolved_outcome text not null,
  resolved_at timestamptz not null,
  source_url text null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pc_resolved_outcomes_event_time
  on public.pc_resolved_outcomes (event_url, resolved_at desc);

create table if not exists public.pc_signal_weights (
  id text primary key,
  mission_id text not null,
  updated_at timestamptz not null,
  sample_count integer not null default 0,
  weights jsonb not null
);

create index if not exists idx_pc_signal_weights_mission_time
  on public.pc_signal_weights (mission_id, updated_at desc);

create table if not exists public.pc_relayer_heartbeats (
  relayer_id text primary key,
  vault_address text not null,
  relayer_address text not null,
  status text not null,
  last_seen_at timestamptz not null,
  mission_count integer not null default 0,
  last_scanned_block text null,
  wallet_balance_wei text null,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_relayer_heartbeats_seen
  on public.pc_relayer_heartbeats (last_seen_at desc);

create table if not exists public.pc_mission_status (
  mission_id text primary key,
  vault_address text not null,
  event_url text null,
  question text null,
  active boolean not null default true,
  balance_wei text not null default '0',
  spent_wei text not null default '0',
  run_count text not null default '0',
  max_runs text null,
  expires_at timestamptz null,
  next_due_at timestamptz null,
  last_scan_at timestamptz null,
  last_run_at timestamptz null,
  last_skipped_reason text null,
  last_failure_reason text null,
  last_execution_id text null,
  policy_hashes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_mission_status_vault_updated
  on public.pc_mission_status (vault_address, updated_at desc);

create table if not exists public.pc_autopilot_runs (
  id text primary key,
  mission_id text not null,
  vault_address text not null,
  event_url text null,
  execution_id text null,
  transaction_hash text null,
  idempotency_key text not null,
  payload_template_hash text not null,
  payload_hash text not null,
  context_hash text not null,
  execution_source text null,
  execution_rationale text null,
  consensus jsonb null,
  trigger_types jsonb not null default '[]'::jsonb,
  agent_fee_wei text null,
  runtime_budget_wei text null,
  relayer_fee_wei text null,
  remaining_balance_wei text null,
  status text not null default 'submitted',
  error text null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_autopilot_runs_mission_time
  on public.pc_autopilot_runs (mission_id, created_at desc);

create index if not exists idx_pc_autopilot_runs_context_hash
  on public.pc_autopilot_runs (context_hash);

create table if not exists public.pc_context_provenance (
  context_hash text primary key,
  mission_id text not null,
  vault_address text not null,
  event_url text not null,
  payload_hash text null,
  prophecy_snapshot_hash text not null,
  external_source_urls jsonb not null default '[]'::jsonb,
  research_timestamp timestamptz not null,
  model_input_summary text not null,
  context_bytes integer not null default 0,
  snapshot_id text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pc_context_provenance_mission_time
  on public.pc_context_provenance (mission_id, research_timestamp desc);

create table if not exists public.pc_retry_queue (
  id text primary key,
  mission_id text not null,
  vault_address text not null,
  event_url text null,
  reason text not null,
  attempts integer not null default 0,
  next_retry_at timestamptz null,
  last_error text null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_retry_queue_status_due
  on public.pc_retry_queue (status, next_retry_at);

create table if not exists public.pc_trader_strategies (
  mission_id text primary key,
  vault_address text not null,
  owner_address text not null,
  agent_id text not null,
  strategy_hash text not null,
  status text not null default 'active',
  capital_usd double precision not null,
  target_return_pct double precision not null,
  horizon_days integer not null,
  risk_policy jsonb not null default '{}'::jsonb,
  balance_usd double precision not null,
  spent_wei text not null default '0',
  run_count text not null default '0',
  max_runs text not null,
  expires_at timestamptz not null,
  next_due_at timestamptz null,
  last_cycle_at timestamptz null,
  last_skipped_reason text null,
  last_failure_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_trader_strategies_status_due
  on public.pc_trader_strategies (status, next_due_at);

create table if not exists public.pc_trader_cycles (
  id text primary key,
  mission_id text not null,
  vault_address text not null,
  execution_id text null,
  transaction_hash text null,
  idempotency_key text not null,
  status text not null,
  decision text not null,
  reason text not null,
  candidate_count integer not null default 0,
  selected_event_url text null,
  selected_event_id text null,
  selected_market_id text null,
  selected_submarket_title text null,
  payload_hash text null,
  context_hash text null,
  agent_fee_wei text null,
  runtime_budget_wei text null,
  relayer_fee_wei text null,
  remaining_vault_balance_wei text null,
  error text null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_trader_cycles_mission_time
  on public.pc_trader_cycles (mission_id, created_at desc);

create table if not exists public.pc_trader_positions (
  id text primary key,
  mission_id text not null,
  cycle_id text not null,
  event_url text not null,
  event_id text not null,
  market_id text null,
  submarket_title text not null,
  side text not null,
  stake_usd double precision not null,
  balance_before_usd double precision not null,
  balance_after_usd double precision null,
  model_probability double precision null,
  market_probability double precision null,
  edge_pct double precision null,
  confidence_pct double precision null,
  expected_return_pct double precision null,
  rationale text not null,
  status text not null default 'open',
  placed_at timestamptz not null,
  expected_resolution_check_at timestamptz null,
  resolved_at timestamptz null,
  realized_return_pct double precision null,
  outcome_note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pc_trader_positions_mission_time
  on public.pc_trader_positions (mission_id, placed_at desc);

create index if not exists idx_pc_trader_positions_open_due
  on public.pc_trader_positions (status, expected_resolution_check_at)
  where status = 'open';
