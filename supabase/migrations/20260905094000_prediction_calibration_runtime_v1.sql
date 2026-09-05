-- This value is backed by chronological validation on the existing OOS window.
-- Production uses only the versioned policy; the raw model artifact is untouched.
insert into public.policy_versions(policy_type, version, payload)
values (
  'prediction_calibration',
  'temperature-1x2-v1',
  '{"schema_version":"prediction-calibration-v1","market_family":"1X2","method":"chronological_temperature","temperature":0.73,"min_calibration_samples":300,"t_min":0.60,"t_max":1.00,"selection":"NLL_PRIMARY_WITH_ECE_GUARDRAILS","status":"VALIDATED","validation_basis":{"calibration_split":"chronological","holdout_fraction":0.70,"oos_ece":0.0232425925727345,"oos_log_loss":1.04464674015154,"oos_brier":0.62859699289202,"oos_rps":0.218640160112588}}'::jsonb
)
on conflict (policy_type, version) do update
set payload=excluded.payload, created_at=now();
