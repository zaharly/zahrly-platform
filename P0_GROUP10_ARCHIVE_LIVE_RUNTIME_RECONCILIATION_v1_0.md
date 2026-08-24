# ZAHRLY — P0 Group 10 Archive Live Runtime Reconciliation v1.0

**Date:** 24 August 2026  
**Status:** LIVE RUNTIME RECONCILED — deployment blockers cleared; targeted verification tests remain

## 1. Current-state authority

The Archive Layer is deployed and active in the live Supabase project `qosvqlwkexrhswcuakib`.

```text
internal.archive_catalog
internal.archive_completeness_rules
internal.archive_campaigns
internal.worker_jobs
internal.archive_season(...)
internal.dispatch_archive_campaign(...)
internal.archive_scheduler()
pg_cron archive-scheduler
```

## 2. Migration provenance

Live migration history contains the Archive implementation sequence:

```text
p0_group10_archive_layer_ddl_foundation_v1
p0_group10_archive_team_set_hash_reconciliation_v1
p0_group10_archive_season_registration_v1
p0_group10_archive_campaign_dispatch_contract_v1
p0_group10_archive_season_campaign_finalize_v1
p0_group10_archive_scheduler_cron_v1
p0_group10_archive_identity_team_set_hash_v1
p0_group10_archive_season_registration_v1
p0_group10_archive_season_remove_redundant_overload_v1
p0_group10_remove_redundant_archive_identity_index_v1
```

## 3. Live execution contract

```text
archive_scheduler()
  → dispatch_archive_campaign(campaign_id)
  → worker_jobs / archive_campaign
  → Archive Campaign / Worker
  → AWS S3 artifact
  → archive_season(...)
  → archive_catalog
```

No `archive_queue` exists or is required.

## 4. Live `archive_season()` signature

```sql
internal.archive_season(
  p_country_id uuid,
  p_competition_id uuid,
  p_season integer,
  p_dataset_type text,
  p_provider text,
  p_date_start timestamptz,
  p_date_end timestamptz,
  p_team_set_hash text,
  p_object_uri text,
  p_checksum text,
  p_row_count bigint,
  p_completeness_score numeric,
  p_schema_version text
) returns uuid
```

`SECURITY INVOKER`; manifest registration/idempotent replay at the DB boundary; S3 object creation remains Campaign/Worker-owned.

## 5. Live artifact identity

```text
country_id + competition_id + season + dataset_type + provider
+ schema_version + date_start + date_end + team_set_hash + checksum
```

Constraint: `archive_catalog_artifact_identity_key`.

Worker job identity:

```text
archive-campaign:<campaign_id>
```

backed by the unique `worker_jobs.idempotency_key` constraint.

## 6. Live eligibility

The deployed scheduler executes this effective predicate:

```text
scope_state = ARCHIVE_ONLY
status IN ('READY','FAILED')
retry due
completeness_score present
completeness_score >= dataset policy threshold
dataset_type IN ('odds_snapshots','provider_snapshots','evaluation_metrics')
```

No universal season-age or `retention_days` rule exists in the scheduler.

## 7. Live Cron evidence

```text
jobid    = 19
jobname  = archive-scheduler
schedule = 0 19 * * *
command  = select internal.archive_scheduler();
active   = true
```

Successful live executions were observed at:

```text
2026-08-24 19:00:00 UTC
2026-08-24 18:25:00 UTC
```

## 8. Positive E2E evidence

Live campaign:

```text
campaign_id              = c2cff031-17ce-44dd-a9b7-6d1d1709b36b
status                   = SUCCEEDED
scope_state              = ARCHIVE_ONLY
dataset_type             = evaluation_metrics
completeness_score       = 0.99
worker_job_id            = bb9f5f04-7f32-4469-97f7-a847d985a33f
worker_queue             = archive_campaign
worker_status            = SUCCEEDED
manifest_id              = eb7cf3d7-e411-4aa0-91d6-27bdbed7f1d1
object_uri               = s3://zahrly-e2e-test/archive/2025/evaluation_metrics.jsonl
checksum                 = e2e-sha256-archive-test
row_count                = 1
finished_at              = 2026-08-24 18:26:06.722053+00
```

Matching `archive_catalog` lineage exists for the same manifest, URI, checksum, row count, completeness, season, scope dates, team-set hash, and schema version.

This proves a positive live control/database-bound E2E path. It does not claim an external S3 HEAD verification.

## 9. Final classification

```text
Archive Layer              DEPLOYED
Archive execution contract DEPLOYED
Campaign dispatch          DEPLOYED + E2E exercised
archive_scheduler          DEPLOYED
pg_cron                    ACTIVE + successful runs observed
Archive eligibility        DEPLOYED

Same-artifact replay       TEST GATE
Changed-checksum lineage  TEST GATE
Failure/rollback cleanup   TEST GATE
```

The remaining items are verification coverage, not deployment blockers.

## 10. Non-regression

This document changes project-state classification only. It does not authorize schema redesign, a new queue, a universal retention rule, or changes to Historical Bootstrap, 7-Day Rolling, prediction truth, `prediction_baselines`, `rolling_fixture_dispatch`, `queue_recovery`, or `provider_health`.
