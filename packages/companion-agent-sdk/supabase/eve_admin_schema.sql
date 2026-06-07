-- Agent E.V.E admin state (Supabase)

create table if not exists public.eve_agent_health (
  id text primary key,
  agent_id text not null unique,
  failure_streak integer not null default 0,
  healthy_streak integer not null default 0,
  last_status text not null check (last_status in ('healthy', 'unverified', 'deprecated')),
  last_reason text,
  updated_at timestamptz not null default now()
);

alter table public.eve_agent_health
  add column if not exists healthy_streak integer not null default 0;

create table if not exists public.eve_toggle_policies (
  id text primary key,
  target_type text not null check (target_type in ('executor', 'recorder')),
  target_address text not null,
  desired_allowed boolean not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eve_action_logs (
  id text primary key,
  action_type text not null,
  target_agent_id text,
  target_address text,
  details jsonb not null default '{}'::jsonb,
  tx_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_eve_action_logs_created_at
  on public.eve_action_logs (created_at desc);
