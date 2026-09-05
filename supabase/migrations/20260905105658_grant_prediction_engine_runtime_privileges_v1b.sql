-- Keep the prediction Edge Function's service_role runtime access explicit and reproducible.
-- These grants are intentionally limited to the prediction runtime path; no public/anon access is added.
grant usage on schema public to service_role;
grant usage on schema internal to service_role;

grant select on table public.model_versions to service_role;
grant select on table public.model_releases to service_role;
grant select, insert, update on table public.policy_versions to service_role;
grant select on table internal.prediction_training_runs to service_role;
grant select, insert, update on table public.market_registry to service_role;
grant select on table public.fixtures to service_role;
grant select on table public.fixture_episodes to service_role;
grant select, insert, update on table public.prediction_baselines to service_role;
grant select, insert, update on table public.prediction_market_states to service_role;
grant select, insert, update on table public.prediction_evidence_updates to service_role;
grant select on table public.prediction_read_models to service_role;
