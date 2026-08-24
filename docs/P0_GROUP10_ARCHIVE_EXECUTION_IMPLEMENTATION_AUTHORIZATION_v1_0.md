# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — execution contract reconciled; live verification partial  
**Scope:** `internal.archive_season()` + archive worker/campaign execution boundary; `archive_scheduler`/Cron remain downstream

## 1. Reconciled execution contract

The latest project sources and live Supabase state reconcile the Archive execution inputs as follows.

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

The Platform Stack assigns Archive to S3-compatible object storage, Workers to long-running queue/execution/persistence work, and Supabase Postgres to source-of-truth metadata. fileciteturn109file0L14-L33

## 2. Exact live `internal.archive_season()` signature

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

Security boundary verified in live state: `SECURITY INVOKER`; only `postgres` has `EXECUTE` currently.

## 3. Eligibility / retention decision

Archive creation is explicitly separated from later hot-data retention/deletion. The current Project decision is:

```text
ARCHIVE_ONLY
AND required historical scope is complete
AND canonical completeness policy passes
AND dataset is source-defined archivable
AND target is not immutable / never-delete
```

Dataset-specific archive boundaries:

- `odds_snapshots`: archive at `ARCHIVE_ONLY` / season completion after completeness.
- `provider_snapshots`: archive payloads while DB metadata remains authoritative.
- `evaluation_metrics`: archive after final required evaluation completion.
- `prediction_baselines`: never archive/delete by season.
- `prediction_read_models`: separate rebuildable lifecycle.
- `worker_jobs`: separate operational retention lifecycle.

No universal `30/90/365 day` archive-creation cutoff is introduced. Hot-data deletion/partition retirement remains a separate downstream retention policy. fileciteturn111file0L24-L146

## 4. Archive artifact identity

The live schema now implements the exact uniqueness boundary:

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

with the unique constraint/index:

```text
archive_catalog_artifact_identity_key
```

`manifest_id` is the resulting lineage identifier, not part of artifact identity.

Duplicate identity returns the existing `manifest_id`. A changed checksum represents a distinct artifact lineage. This is directly implemented in the live `archive_season()` function.

The latest project archive decision also requires `team_set_hash` as part of manifest identity. fileciteturn118file5L605-L680

## 5. Durable dispatch / campaign contract

```text
archive_scheduler
        ↓
short archive-control dispatch
        ↓
Archive Campaign / Worker
        ↓
S3 artifact
        ↓
internal.archive_season()
        ↓
internal.archive_catalog
```

The Campaign/Worker is the long-running execution owner. PostgreSQL remains the metadata-registration boundary.

No `archive_queue` is created or inferred. No reuse of `backfill_queue` and no direct `worker_jobs` shortcut is authorized by inference. The project explicitly separates Archive creation from later hot-data retention. fileciteturn118file0L104-L152

## 6. Verification status

Verified live on 24 August 2026:

```text
✅ exact deployed function signature
✅ SECURITY INVOKER
✅ anon EXECUTE absent
✅ authenticated EXECUTE absent
✅ archive artifact UNIQUE identity
✅ invalid date range rejects
✅ negative row_count rejects
```

Not yet verified live because the canonical reference tables currently contain no rows suitable for a realistic archive fixture, and we will not fabricate production data just to make the test pass:

```text
⏳ positive manifest registration
⏳ duplicate/idempotency registration
⏳ rollback with a canonical valid fixture
```

These tests must be run once a real canonical country/competition/season dataset is available.

## 7. Non-goals

This authorization does not yet implement:

- `archive_scheduler` function body;
- pg_cron schedule/runtime;
- hot partition deletion/retirement;
- new retention columns/states;
- new queue types;
- provider/Redis access from PostgreSQL;
- immutable prediction truth mutation.

## 8. Downstream gate

The Archive execution contract is now reconciled and implementation-authorized. The remaining work is implementation/verification of the Campaign/Worker and the short scheduler control operation, followed by the documented `03:00` Cron runtime gate.
