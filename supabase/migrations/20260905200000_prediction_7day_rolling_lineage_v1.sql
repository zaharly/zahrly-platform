create table if not exists internal.prediction_rolling_windows (
  id uuid primary key default gen_random_uuid(),
  window_start timestamptz not null,
  window_end timestamptz not null,
  evaluated_at timestamptz not null default now(),
  source text not null default 'github-actions:prediction-runtime',
  candidate_count integer not null default 0,
  jobs_created integer not null default 0,
  jobs_already_present integer not null default 0,
  jobs_outside_window integer not null default 0,
  status text not null default 'COMPLETED',
  details jsonb not null default '{}'::jsonb,
  constraint prediction_rolling_windows_range_check check (window_end > window_start),
  constraint prediction_rolling_windows_status_check check (status in ('COMPLETED','FAILED'))
);
create index if not exists prediction_rolling_windows_evaluated_idx on internal.prediction_rolling_windows(evaluated_at desc);
create index if not exists prediction_rolling_windows_window_idx on internal.prediction_rolling_windows(window_start,window_end);

alter table internal.prediction_jobs add column if not exists rolling_window_id uuid references internal.prediction_rolling_windows(id) on delete set null;
alter table internal.prediction_jobs add column if not exists rolling_entered_at timestamptz;
alter table internal.prediction_jobs add column if not exists rolling_source text;
create index if not exists prediction_jobs_rolling_window_idx on internal.prediction_jobs(rolling_window_id);
create index if not exists prediction_jobs_rolling_source_idx on internal.prediction_jobs(rolling_source, created_at desc);

alter table internal.prediction_rolling_windows enable row level security;
revoke all on internal.prediction_rolling_windows from public, anon, authenticated;
grant usage on schema internal to service_role;
grant select, insert, update on internal.prediction_rolling_windows to service_role;
grant update on internal.prediction_jobs to service_role;
