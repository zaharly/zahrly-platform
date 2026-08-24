# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026
**Status:** AUTHORIZED IMPLEMENTATION BASELINE — LIVE RUNTIME RECONCILED; targeted test gates remain
**Scope:** Archive execution path only

The Archive Layer is already deployed in the live Supabase project. This document records the authoritative implementation and its current runtime classification.

## Authoritative storage/execution model

```text
Archive artifact storage = AWS S3
Archive execution owner  = Archive Campaign / Archive Worker
PostgreSQL               = control state + manifest/lineage registration
```

## Deployed execution path

```text
internal.archive_scheduler()
        ↓
internal.dispatch_archive_campaign(campaign_id)
        ↓
internal.worker_jobs
        ↓
Archive Campaign / Worker
        ↓
AWS S3 archive artifact
        ↓
internal.archive_season(...)
        ↓
internal.archive_catalog
```

No `archive_queue` exists in this path.

## Deployed function

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

The function is `SECURITY INVOKER`; it performs manifest registration/idempotent DB replay and does not create the S3 object.

## Deployed artifact identity

```text
UNIQUE (
  country_id,
  competition_id,
  season,
  dataset_type,
  provider,
  schema_version,
  date_start,
  date_end,
  team_set_hash,
  checksum
)
```

Constraint: `archive_catalog_artifact_identity_key`.

Worker-job idempotency is protected by `worker_jobs.idempotency_key UNIQUE` using `archive-campaign:<campaign_id>`.

## Deployed scheduler predicate

```text
scope_state = ARCHIVE_ONLY
status IN ('READY','FAILED')
retry due
completeness present and >= dataset policy threshold
dataset_type IN ('odds_snapshots','provider_snapshots','evaluation_metrics')
```

No universal season-age or `retention_days` rule is used.

## Live Cron evidence

```text
jobid    = 19
jobname  = archive-scheduler
schedule = 0 19 * * *
command  = select internal.archive_scheduler();
active   = true
```

Recent successful runs include `2026-08-24 19:00:00 UTC` and `2026-08-24 18:25:00 UTC`.

## Positive live E2E evidence

A live `evaluation_metrics` archive campaign completed successfully with:

```text
scope_state              = ARCHIVE_ONLY
completeness_score       = 0.99
worker_job status        = SUCCEEDED
worker queue             = archive_campaign
object_uri               = s3://zahrly-e2e-test/archive/2025/evaluation_metrics.jsonl
checksum                 = e2e-sha256-archive-test
manifest_id              = eb7cf3d7-e411-4aa0-91d6-27bdbed7f1d1
archive_catalog row      = PRESENT
```

The evidence confirms the live control/database-bound path. A direct external S3 HEAD is not claimed here.

## Current classification

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

These are **verification gates, not deployment blockers**.
