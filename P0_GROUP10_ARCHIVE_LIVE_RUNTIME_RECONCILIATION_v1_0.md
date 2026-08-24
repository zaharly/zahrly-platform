# ZAHRLY — P0 Group 10 Archive Live Runtime Reconciliation v1.0

**Date:** 24 August 2026  
**Status:** LIVE RUNTIME RECONCILED — deployment blockers cleared; targeted verification tests remain

The Archive Layer is deployed and active in the live Supabase project `qosvqlwkexrhswcuakib`.

## Current state

```text
archive_catalog              DEPLOYED
archive_completeness_rules   DEPLOYED
archive_campaigns            DEPLOYED
worker_jobs                  DEPLOYED
archive_season()             DEPLOYED
dispatch_archive_campaign()  DEPLOYED
archive_scheduler()          DEPLOYED
archive-scheduler Cron       ACTIVE
```

## Execution path

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

## Live executable contract

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

`SECURITY INVOKER`; DB-side manifest registration/idempotent replay; S3 object creation remains Campaign/Worker-owned.

## Artifact identity

```text
country_id + competition_id + season + dataset_type + provider
+ schema_version + date_start + date_end + team_set_hash + checksum
```

Constraint: `archive_catalog_artifact_identity_key`.

Worker job idempotency: `archive-campaign:<campaign_id>` through unique `worker_jobs.idempotency_key`.

## Scheduler predicate

```text
ARCHIVE_ONLY
+ READY/FAILED
+ retry due
+ completeness present and >= dataset policy threshold
+ dataset_type in odds_snapshots/provider_snapshots/evaluation_metrics
```

No universal season-age or `retention_days` rule is used.

## Cron evidence

```text
jobid    19
jobname  archive-scheduler
schedule 0 19 * * *
command  select internal.archive_scheduler();
active   true
```

Successful runs observed at `2026-08-24 19:00:00 UTC` and `2026-08-24 18:25:00 UTC`.

## Positive E2E evidence

A live evaluation-metrics campaign succeeded with:

```text
scope_state       ARCHIVE_ONLY
completeness      0.99
worker_queue      archive_campaign
worker_status     SUCCEEDED
object_uri        s3://zahrly-e2e-test/archive/2025/evaluation_metrics.jsonl
checksum          e2e-sha256-archive-test
manifest_id       eb7cf3d7-e411-4aa0-91d6-27bdbed7f1d1
archive_catalog   matching lineage present
```

This is positive live control/database-bound E2E evidence. No external S3 HEAD is claimed.

## Final classification

```text
Archive Layer              DEPLOYED
Execution contract         DEPLOYED
Campaign dispatch          DEPLOYED + E2E exercised
Scheduler                  DEPLOYED
Cron                       ACTIVE + successful runs
Eligibility                DEPLOYED

Replay/idempotency         TEST GATE
Changed-checksum lineage   TEST GATE
Failure/rollback cleanup   TEST GATE
```

Remaining items are verification coverage, not deployment blockers.
