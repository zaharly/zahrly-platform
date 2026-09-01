create table if not exists internal.prediction_training_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id),
  status text not null check (status in ('PLANNED','RUNNING','SUCCEEDED','FAILED')),
  requested_cutoff timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists prediction_training_runs_model_idx on internal.prediction_training_runs(model_version_id, created_at desc);

create table if not exists internal.prediction_training_folds (
  id uuid primary key default gen_random_uuid(),
  training_run_id uuid not null references internal.prediction_training_runs(id) on delete cascade,
  fold_no integer not null check (fold_no > 0),
  train_cutoff timestamptz not null,
  test_start timestamptz not null,
  test_end timestamptz not null,
  status text not null check (status in ('PLANNED','RUNNING','SUCCEEDED','FAILED')),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(training_run_id, fold_no),
  check (test_end > test_start)
);

create index if not exists prediction_training_folds_cutoff_idx on internal.prediction_training_folds(train_cutoff, test_start, test_end);

create table if not exists internal.prediction_rating_checkpoints (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id),
  rating_policy_version text not null,
  checkpoint_scope text not null check (checkpoint_scope in ('ROUND','WEEK','FOLD')),
  team_id uuid not null references public.teams(id),
  rating numeric not null,
  rating_deviation numeric not null check (rating_deviation >= 0),
  volatility numeric not null check (volatility > 0),
  as_of_match_id uuid,
  as_of_time timestamptz not null,
  created_at timestamptz not null default now(),
  unique(model_version_id, rating_policy_version, checkpoint_scope, team_id, as_of_match_id, as_of_time)
);

create index if not exists prediction_rating_checkpoints_lookup_idx on internal.prediction_rating_checkpoints(model_version_id, rating_policy_version, as_of_time desc);
create index if not exists prediction_rating_checkpoints_team_idx on internal.prediction_rating_checkpoints(team_id, rating_policy_version, as_of_time desc);

comment on table internal.prediction_rating_checkpoints is 'Checkpoint cache only; chronological match/result ledger remains the source of truth.';
comment on table internal.prediction_training_runs is 'P0 walk-forward training execution ledger.';
comment on table internal.prediction_training_folds is 'P0 chronological train/test fold ledger; no future leakage across fold cutoffs.';
