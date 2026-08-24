# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — Live parity reconciled  
**Scope:** Archive metadata + campaign execution + scheduler runtime gate

## Authorization Result
The Archive execution inputs are reconciled against the latest project decisions and live Supabase state. No new archive queue or alternate archive transport is introduced.

## Verified execution contract

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

Caller: Archive Campaign/Worker. The live function validates date/order, row count, campaign scope, `ARCHIVE_ONLY`, completeness policy/version and threshold; it registers `archive_catalog` idempotently and finalizes the campaign/worker job.

## Eligibility / retention
Archive creation is gated by:

```text
ARCHIVE_ONLY
AND required historical scope complete
AND canonical completeness policy passes
AND dataset is source-defined archivable
AND target is not immutable / never-delete
```

Current P0 archive scheduler targets `odds_snapshots`, `provider_snapshots`, and `evaluation_metrics`. Hot-data deletion/partition retirement remains separate. `prediction_baselines`, audit lineage, and canonical replay source are protected.

## Artifact identity / DDL reconciliation
Live `internal.archive_catalog` verifies:

```text
team_set_hash text NOT NULL
```

and:

```text
archive_catalog_artifact_identity_key
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

Duplicate identity returns the existing `manifest_id`; a changed checksum represents a distinct lineage.

## Durable dispatch / campaign path

```text
archive_scheduler()
  ↓
internal.dispatch_archive_campaign(campaign_id)
  ↓
internal.worker_jobs
  ↓
Archive Campaign / Worker
  ↓
S3 artifact
  ↓
internal.archive_season(...)
  ↓
internal.archive_catalog
```

`dispatch_archive_campaign(p_campaign_id uuid)` uses worker-job idempotency key `archive-campaign:<campaign_id>`. No `archive_queue` or `backfill_queue` reuse is introduced.

## Security / runtime verification
Live verification:

```text
archive_scheduler()            SECURITY INVOKER
archive_season(...)             SECURITY INVOKER
dispatch_archive_campaign(...)  SECURITY INVOKER
anon EXECUTE                    absent
authenticated EXECUTE           absent
archive-scheduler               0 3 * * * / active
```

## Remaining gate
Only functional/runtime evidence remains:

```text
positive canonical campaign registration
duplicate/idempotency registration
rollback/failure verification
successful pg_cron runtime evidence
```

No fake production/archive fixture should be created solely to manufacture success.

## Non-regression
No change to fixture lifecycle, Historical Bootstrap, 7-Day Rolling, provider/Redis boundaries, immutable prediction truth, or canonical queue set is authorized by this artifact.
