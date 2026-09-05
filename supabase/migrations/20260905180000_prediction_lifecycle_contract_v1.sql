do $$
begin
  create table if not exists internal.prediction_baseline_gate_evaluations (
    id uuid primary key default gen_random_uuid(),
    episode_id uuid not null references public.fixture_episodes(id) on delete cascade,
    fixture_id uuid not null references public.fixtures(id) on delete cascade,
    model_version_id uuid not null references public.model_versions(id) on delete restrict,
    gate_version text not null,
    evaluated_at timestamptz not null default now(),
    eligible boolean not null,
    canonical_fixture_valid boolean not null,
    identity_quality numeric(6,5) not null,
    minimum_feature_coverage numeric(6,5) not null,
    model_health text not null,
    no_future_leakage boolean not null,
    probability_state_valid boolean not null,
    t_minus_hours numeric,
    details jsonb not null default '{}'::jsonb
  );
  execute 'create index if not exists prediction_baseline_gate_evals_episode_idx on internal.prediction_baseline_gate_evaluations(episode_id, evaluated_at desc)';
  execute 'create index if not exists prediction_baseline_gate_evals_eligible_idx on internal.prediction_baseline_gate_evaluations(model_version_id, eligible, evaluated_at desc)';
end
$$;

alter table internal.prediction_baseline_gate_evaluations enable row level security;
revoke all on internal.prediction_baseline_gate_evaluations from public, anon, authenticated;
