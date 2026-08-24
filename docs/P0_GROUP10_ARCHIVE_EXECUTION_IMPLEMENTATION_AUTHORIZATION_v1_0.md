# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — Live parity reconciled  
**Scope:** Archive metadata + campaign execution + scheduler runtime gate

## Authorization Result

The Archive execution inputs are reconciled against the latest project decisions and live Supabase state. No new archive queue or alternate archive transport is introduced.

### Function

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

The live function is `SECURITY INVOKER`, returns the canonical `manifest_id`, validates campaign scope/completeness, registers the archive manifest idempotently, and finalizes the campaign/worker job.

### Eligibility / retention

Archive creation is gated by the source-aligned campaign state:

```text
ARCHIVE_ONLY
AND required historical scope complete
AND canonical completeness policy passes
AND dataset is source-defined archivable
AND target is not immutable / never-delete
```

The first P0 archive path covers `odds_snapshots`, `provider_snapshots`, and `evaluation_metrics`. Hot-data deletion/partition retirement remains a separate retention policy. `prediction_baselines` and canonical audit/replay source remain protected.

### Artifact identity / DDL reconciliation

Live verification confirms:

```text
internal.archive_catalog.team_set_hash = text NOT NULL
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

A duplicate identity returns the existing `manifest_id`; a changed checksum represents distinct artifact lineage. fileciteturn111file0L20-L89

### Durable dispatch / campaign path

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

The dispatch function uses worker-job idempotency key `archive-campaign:<campaign_id>`. No `archive_queue` is introduced.

### Runtime / security

Live verification confirms:

```text
archive_scheduler()            SECURITY INVOKER
archive_season(...)             SECURITY INVOKER
dispatch_archive_campaign(...)  SECURITY INVOKER
anon EXECUTE                    absent
authenticated EXECUTE           absent
archive-scheduler               0 3 * * * / active
```

### Remaining gate

Only functional/runtime evidence remains:

```text
positive canonical archive registration
idempotent duplicate registration
rollback/failure verification
successful pg_cron runtime evidence
```

No artificial production fixture should be created merely to manufacture success.

### Non-regression

No change to fixture lifecycle, Historical Bootstrap, 7-Day Rolling, provider/Redis boundaries, immutable prediction truth, or the canonical queue set is authorized by this artifact.
