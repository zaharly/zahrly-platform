create table if not exists internal.prediction_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  artifact_type text not null check (artifact_type in ('OOS_BENCHMARK','RATING_CHECKPOINTS','MODEL','FEATURE_SNAPSHOT','OTHER')),
  training_run_id uuid references internal.prediction_training_runs(id) on delete set null,
  model_version_id uuid references public.model_versions(id) on delete set null,
  object_uri text not null,
  sha256 text not null,
  byte_size bigint not null check (byte_size >= 0),
  row_count bigint,
  content_type text not null,
  compression text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artifact_type, training_run_id, model_version_id, sha256)
);

create index if not exists prediction_artifacts_training_run_idx
  on internal.prediction_artifacts(training_run_id, artifact_type, created_at desc);

create index if not exists prediction_artifacts_model_version_idx
  on internal.prediction_artifacts(model_version_id, artifact_type, created_at desc);

comment on table internal.prediction_artifacts is
  'Small manifest for large prediction artifacts stored in external S3; PostgreSQL stores metadata/checksums only.';
