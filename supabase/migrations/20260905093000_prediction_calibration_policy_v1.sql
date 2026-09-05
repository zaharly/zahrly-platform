-- Production-safe 1X2 calibration policy.
-- Calibration is versioned separately from the raw model and applied only at the
-- prediction probability boundary. Existing prediction baselines remain immutable.

insert into public.policy_versions(policy_type, version, payload)
values (
  'prediction_calibration',
  'temperature-1x2-v1',
  jsonb_build_object(
    'schema_version','prediction-calibration-v1',
    'market_family','1X2',
    'method','chronological_temperature',
    'temperature',1.0,
    'min_calibration_samples',300,
    't_min',0.60,
    't_max',1.00,
    'selection','NLL_PRIMARY_WITH_ECE_GUARDRAILS',
    'status','IDENTITY_UNTIL_VALIDATED',
    'source','walk_forward_oos',
    'updated_at',now()
  )
)
on conflict (policy_type, version) do nothing;

comment on table public.policy_versions is 'Versioned runtime policies including prediction calibration; raw model versions remain unchanged.';
