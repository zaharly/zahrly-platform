begin;
-- Compensating migration for 20260905103727. Keep migration history immutable,
-- but remove the duplicated bootstrap/governance objects that were added there.
delete from public.shadow_evaluations
where id='f45396f6-2dd4-4e53-8ac0-e4b6eeddaeb8';
delete from internal.audit_log
where action='MODEL_BASELINE_CERTIFIED'
  and entity_id='85a9fcdc-e92a-4d0a-9665-a6d88252c763';
delete from internal.model_baseline_certifications
where model_version_id='85a9fcdc-e92a-4d0a-9665-a6d88252c763';
delete from public.model_releases
where release_version='production-baseline-1x2-v1';
delete from public.model_versions
where id='85a9fcdc-e92a-4d0a-9665-a6d88252c763';
delete from public.policy_versions
where id='09206db8-925f-4bf9-ac9a-26c389cf7e0c';
update internal.drift_metrics
set status='UNKNOWN',
    metadata=(metadata
      - 'promotion_policy_version'
      - 'max_relative_regression'
      - 'observed_relative_regression'
      - 'classification'
      - 'canonical_note')
      || jsonb_build_object(
        'threshold_version','rps-1x2-unknown-blocking-v1',
        'classification_note','1X2 canonical architecture defines rolling drift monitoring but no universal numeric promotion threshold; prior 1% threshold removed from gate')
where metric_name='RPS';
update internal.prediction_promotion_gate_results
set blocking_reasons=jsonb_build_array('drift','incumbent'),
    promotion_status='FAIL',
    promotion_eligible=false,
    evaluated_at=now()
where model_version_id='30cd782a-7dbe-4dfa-a537-12658aa86a1b';
drop table if exists internal.model_baseline_certifications;
commit;
