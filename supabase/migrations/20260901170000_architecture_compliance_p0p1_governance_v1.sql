-- Additive-only architecture compliance schema.
-- No existing campaign, worker, prediction, or queue rows are modified.

create table if not exists internal.evaluation_runs (
  id uuid primary key default gen_random_uuid(), model_version_id uuid not null references public.model_versions(id),
  benchmark_type text not null, status text not null check (status in ('PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  started_at timestamptz, finished_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists evaluation_runs_model_idx on internal.evaluation_runs(model_version_id, created_at desc);

create table if not exists internal.evaluation_folds (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references internal.evaluation_runs(id) on delete cascade,
  fold_no integer not null check (fold_no > 0), train_cutoff timestamptz not null, test_start timestamptz not null, test_end timestamptz not null,
  status text not null check (status in ('PLANNED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(run_id, fold_no), check (test_end > test_start)
);
create index if not exists evaluation_folds_window_idx on internal.evaluation_folds(train_cutoff, test_start, test_end);

create table if not exists internal.evaluation_metrics (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references internal.evaluation_runs(id) on delete cascade,
  fold_id uuid references internal.evaluation_folds(id) on delete cascade, segment text not null default 'ALL', market_key text,
  metric_name text not null, metric_value double precision not null, sample_count bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists evaluation_metrics_lookup_idx on internal.evaluation_metrics(run_id, fold_id, metric_name, segment);

create table if not exists internal.drift_metrics (
  id uuid primary key default gen_random_uuid(), model_version_id uuid references public.model_versions(id), segment text not null default 'ALL',
  metric_name text not null, baseline_value double precision, current_value double precision,
  status text not null default 'OK' check (status in ('OK','WARN','ALERT','UNKNOWN')),
  observed_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists drift_metrics_model_idx on internal.drift_metrics(model_version_id, observed_at desc);

create table if not exists internal.simulation_runs (
  id uuid primary key default gen_random_uuid(), episode_id uuid references public.fixture_episodes(id), simulation_policy_version text not null,
  samples_used integer not null check (samples_used >= 0), runtime_ms integer, se double precision,
  convergence_state text not null default 'UNKNOWN' check (convergence_state in ('CONVERGED','CAPPED','LOWER_CONFIDENCE','UNKNOWN')),
  started_at timestamptz, finished_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists simulation_runs_episode_idx on internal.simulation_runs(episode_id, created_at desc);

create table if not exists public.provider_schema_versions (
  id uuid primary key default gen_random_uuid(), provider text not null, endpoint text not null, schema_version text not null,
  fingerprint text not null, adapter_version text, status text not null default 'ACTIVE' check (status in ('ACTIVE','QUARANTINED','DEPRECATED')),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique(provider, endpoint, fingerprint)
);
create index if not exists provider_schema_versions_lookup_idx on public.provider_schema_versions(provider, endpoint, last_seen_at desc);

create table if not exists public.provider_plan_policies (
  id uuid primary key default gen_random_uuid(), provider text not null, plan_code text not null, policy_version text not null,
  capabilities jsonb not null default '{}'::jsonb, quota_policy jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(), valid_until timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED','DISABLED')), created_at timestamptz not null default now(),
  unique(provider, plan_code, policy_version)
);
create index if not exists provider_plan_policies_active_idx on public.provider_plan_policies(provider, status, valid_from desc);

create table if not exists public.source_observations (
  id uuid primary key default gen_random_uuid(), fixture_id uuid references public.fixtures(id), provider text not null, endpoint text not null,
  source_snapshot_id uuid, payload_uri text, payload_hash text, observed_at timestamptz not null, effective_at timestamptz,
  schema_version text, missing_flag boolean not null default false, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists source_observations_fixture_idx on public.source_observations(fixture_id, effective_at desc);
create index if not exists source_observations_source_idx on public.source_observations(provider, endpoint, observed_at desc);

create table if not exists public.data_conflicts (
  id uuid primary key default gen_random_uuid(), fixture_id uuid references public.fixtures(id), entity_type text not null, entity_id text not null,
  field_name text not null, provider_a text, value_a jsonb, provider_b text, value_b jsonb,
  severity text not null default 'INFO' check (severity in ('INFO','WARN','MATERIAL','CRITICAL')),
  resolution_status text not null default 'OPEN' check (resolution_status in ('OPEN','RESOLVED','WAIVED')),
  resolver_policy_version text, resolved_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists data_conflicts_fixture_idx on public.data_conflicts(fixture_id, created_at desc);

create table if not exists public.data_incidents (
  id uuid primary key default gen_random_uuid(), provider text, incident_type text not null,
  severity text not null default 'P2' check (severity in ('P0','P1','P2','P3')),
  status text not null default 'OPEN' check (status in ('OPEN','MITIGATING','RESOLVED','CLOSED')),
  scope jsonb not null default '{}'::jsonb, correction_snapshot_id uuid, opened_at timestamptz not null default now(),
  resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists data_incidents_status_idx on public.data_incidents(status, opened_at desc);

create table if not exists public.model_releases (
  id uuid primary key default gen_random_uuid(), model_version_id uuid not null references public.model_versions(id), release_version text not null,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','SHADOW','ACTIVE','ROLLED_BACK','REJECTED')),
  approval_state text not null default 'PENDING' check (approval_state in ('PENDING','APPROVED','REJECTED')),
  reviewer_id uuid, promoted_at timestamptz, rollback_at timestamptz, reason text, created_at timestamptz not null default now(),
  unique(model_version_id, release_version)
);
create index if not exists model_releases_status_idx on public.model_releases(status, created_at desc);

create table if not exists public.shadow_evaluations (
  id uuid primary key default gen_random_uuid(), candidate_model_version_id uuid not null references public.model_versions(id),
  incumbent_model_version_id uuid references public.model_versions(id), evaluation_run_id uuid references internal.evaluation_runs(id),
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCEEDED','FAILED','STOPPED')),
  candidate_metrics jsonb not null default '{}'::jsonb, incumbent_metrics jsonb not null default '{}'::jsonb,
  comparison jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), finished_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists shadow_evaluations_candidate_idx on public.shadow_evaluations(candidate_model_version_id, created_at desc);

create table if not exists internal.audit_log (
  id uuid primary key default gen_random_uuid(), actor_id uuid, role text, action text not null, entity_type text not null,
  entity_id text, before_hash text, after_hash text, reason text, ticket_or_incident text, created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on internal.audit_log(entity_type, entity_id, created_at desc);

create table if not exists internal.secret_rotation_policies (
  secret_scope text primary key, max_age_days integer not null default 90, warn_before_days integer not null default 7,
  last_rotated_at timestamptz, created_at timestamptz not null default now(),
  check (max_age_days > 0 and warn_before_days >= 0 and warn_before_days < max_age_days)
);

create table if not exists internal.rate_limit_policies (
  scope text primary key, requests_per_minute integer not null check (requests_per_minute > 0), burst integer not null default 1 check (burst > 0),
  enabled boolean not null default true, policy_version text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.provider_schema_versions enable row level security;
alter table public.provider_plan_policies enable row level security;
alter table public.source_observations enable row level security;
alter table public.data_conflicts enable row level security;
alter table public.data_incidents enable row level security;
alter table public.model_releases enable row level security;
alter table public.shadow_evaluations enable row level security;

revoke all on public.provider_schema_versions from anon, authenticated;
revoke all on public.provider_plan_policies from anon, authenticated;
revoke all on public.source_observations from anon, authenticated;
revoke all on public.data_conflicts from anon, authenticated;
revoke all on public.data_incidents from anon, authenticated;
revoke all on public.model_releases from anon, authenticated;
revoke all on public.shadow_evaluations from anon, authenticated;

grant select, insert, update on public.provider_schema_versions to service_role;
grant select, insert, update on public.provider_plan_policies to service_role;
grant select, insert, update on public.source_observations to service_role;
grant select, insert, update on public.data_conflicts to service_role;
grant select, insert, update on public.data_incidents to service_role;
grant select, insert, update on public.model_releases to service_role;
grant select, insert, update on public.shadow_evaluations to service_role;
