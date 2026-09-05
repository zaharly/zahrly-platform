# ZAHRLY — P0 Group 10 Archive Live Execution Reconciliation v1.3

**Date:** 24 August 2026  
**Status:** Live execution reconciled  
**Scope:** Archive Layer + archive scheduler

## Authoritative live finding

The live Supabase migration history already contains the canonical Archive execution path before the latest cleanup migrations:

```text
p0_group10_archive_layer_ddl_foundation_v1
p0_group10_archive_team_set_hash_reconciliation_v1
p0_group10_archive_season_registration_v1
p0_group10_archive_campaign_dispatch_contract_v1
p0_group10_archive_season_campaign_finalize_v1
p0_group10_archive_scheduler_cron_v1
```

Therefore the correct classification is **not** "Archive Layer not deployed". The Archive execution layer is already deployed in the live state.

## Canonical execution path

```text
03:00 archive-scheduler
    ↓
internal.archive_scheduler()
    ↓
ARCHIVE_ONLY + READY/FAILED + retry due + completeness threshold
    ↓
internal.dispatch_archive_campaign(campaign_id)
    ↓
internal.worker_jobs
    queue_name = archive_campaign
    idempotency_key = archive-campaign:<campaign_id>
    ↓
Archive Campaign / Worker
    ↓
AWS S3-compatible archive artifact
    ↓
internal.archive_season(...)
    ↓
internal.archive_catalog
```

No `archive_queue` exists or is required.

## `archive_scheduler()`

The deployed function is zero-argument and returns void. It selects campaigns where:

```text
scope_state = ARCHIVE_ONLY
status in (READY, FAILED)
next_retry_at is null OR next_retry_at <= now()
completeness_score is present
completeness_score >= archive_completeness_rules.required_threshold
 dataset_type in:
   odds_snapshots
   provider_snapshots
   evaluation_metrics
```

It dispatches the selected campaigns through `internal.dispatch_archive_campaign`.

## `dispatch_archive_campaign()`

The deployed function locks the campaign row, validates its dispatchability, creates/reuses a worker job with:

```text
queue_name = archive_campaign
idempotency_key = archive-campaign:<campaign_id>
status = QUEUED
```

and stores the worker job id on the campaign. Duplicate dispatch returns the existing worker job id.

## `archive_season()`

The authoritative live function is the Campaign/Worker finalization RPC:

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
) RETURNS uuid
```

It validates the matching `archive_campaigns` row, requires `ARCHIVE_ONLY`, requires completeness policy/version and threshold, registers the S3 artifact manifest in `archive_catalog`, updates campaign/worker status to `SUCCEEDED`, and returns `manifest_id`.

The live function is private: `EXECUTE` is present only for `postgres` in the current grants inspection.

## S3/Campaign alignment

The latest Platform Stack architecture identifies archive storage as S3-compatible object storage and Python async workers as the backend execution plane; Supabase remains source of truth for archive metadata/manifests. This matches the deployed Campaign/Worker flow and does not require a new queue.

## Live runtime verification

Current live state observed:

```text
archive_campaigns rows        = 0
archive_campaign worker jobs  = 0
archive_scheduler() manual call = SUCCESS / no work dispatched
```

The installed Cron is:

```text
jobname = archive-scheduler
schedule = 0 3 * * *
active = true
command = select internal.archive_scheduler();
```

No `cron.job_run_details` rows exist yet for this job, so the first scheduled runtime execution has not yet been observed.

## Cleanup / non-regression

The latest verification also found a redundant `archive_catalog_artifact_identity_uq` index created by a later reconciliation attempt. It has been removed. The canonical unique constraint remains:

```text
archive_catalog_artifact_identity_key
```

with the project-approved identity including:

```text
country_id
competition_id
season
dataset_type
provider
schema_version
date_start
date_end
team_set_hash
checksum
```

No second archive queue, no alternate `archive_season` overload, no change to fixture status, historical backfill, rolling production, or provider boundaries remains.

## Gate status

```text
Archive metadata foundation        ✅
Archive campaign execution         ✅ deployed
Archive worker dispatch contract   ✅ deployed
archive_season()                   ✅ deployed
Archive scheduler                  ✅ deployed
Cron                                ✅ installed
First pg_cron execution evidence    ⏳ pending
```

Only the runtime evidence gate remains for declaring the Archive target fully runtime-verified.