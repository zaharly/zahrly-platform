# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — metadata-registration execution boundary verified  
**Scope:** `internal.archive_season()` + archive worker/campaign execution boundary; `archive_scheduler`/Cron remain downstream

## Authority

The latest project sources and live Supabase state now reconcile the execution contract.

### Storage / ownership

```text
Historical/Archive Campaign
        ↓
worker-side artifact creation + verification
        ↓
AWS/S3-compatible season archive
        ↓
internal.archive_season()
        ↓
internal.archive_catalog
```

The platform architecture assigns Archive storage to S3-compatible object storage, workers to long-running execution/persistence, and Supabase Postgres to source-of-truth metadata. fileciteturn119file0L17-L27

## 1. Exact `internal.archive_season()` signature

The live deployed function is authoritative:

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

Return: `manifest_id`.

Caller: archive campaign/worker, not Cron directly.

The function is `SECURITY INVOKER`; `anon` and `authenticated` do not have EXECUTE on it.

## 2. Eligibility / retention boundary

The archive-admission rule is:

```text
ARCHIVE_ONLY
AND required historical scope is complete
AND canonical completeness policy passes
AND dataset is source-defined archivable
AND target is not immutable / never-delete
```

The latest project decision explicitly separates archive creation from later hot-data retention/deletion. fileciteturn118file1L120-L151

Dataset-specific examples:

- `odds_snapshots`: archive at ARCHIVE_ONLY/season completion, after completeness.
- `provider_snapshots`: archive payloads; DB metadata remains authoritative.
- `evaluation_metrics`: archive after final required evaluation completion.
- `prediction_baselines`: never archive/delete by season.
- `prediction_read_models`: separate rebuildable lifecycle.
- `worker_jobs`: separate operational retention lifecycle.

No universal `30/90/365 day` cutoff is introduced. Hot-data partition/deletion retention remains a separate policy after an archive artifact exists. fileciteturn119file2L322-L340

## 3. Exact archive artifact DB identity

The latest live schema implements this uniqueness boundary:

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

`manifest_id` is the generated lineage identifier, not part of the identity.

Duplicate identity returns the existing `manifest_id`; a changed checksum represents a different artifact lineage. This matches the project decision and the live UNIQUE constraint. fileciteturn119file3L400-L469

## 4. Durable dispatch / campaign contract

The execution contract is now reconciled as:

```text
archive_scheduler
    ↓
short archive-control dispatch
    ↓
archive campaign / worker
    ↓
S3 artifact
    ↓
internal.archive_season()
    ↓
internal.archive_catalog
```

No `archive_queue` is introduced. No reuse of `backfill_queue` and no direct `worker_jobs` shortcut is inferred by implementation.

The campaign is the long-running execution owner; the Postgres function is only the final metadata-registration boundary. This preserves the project's scheduler→worker separation and S3 cold-storage architecture. fileciteturn119file0L30-L60

## 5. Verification completed

Live verification completed on 24 August 2026:

```text
✅ exact function signature
✅ SECURITY INVOKER
✅ anon EXECUTE = false
✅ authenticated EXECUTE = false
✅ UNIQUE artifact identity
✅ positive transactional registration
✅ duplicate/idempotency registration
✅ invalid date-range rejection
✅ negative row-count rejection
✅ test rollback leaves 0 residual archive rows
```

## 6. Non-goals

This authorization does not implement:

- `archive_scheduler`
- pg_cron schedule
- hot partition deletion/retirement
- new retention columns/states
- new queue types
- provider/Redis access from PostgreSQL
- immutable prediction truth mutation

## 7. Next Gate

The Archive execution boundary is now authorized and verified. The remaining downstream target is:

```text
archive_scheduler
    ↓
03:00 control-plane runtime gate
    ↓
pg_cron execution verification
```

`archive_scheduler` must still be implemented separately and must remain short/control-plane only. It cannot perform S3 transfer or long-running campaign work inline. fileciteturn109file11L1270-L1291
