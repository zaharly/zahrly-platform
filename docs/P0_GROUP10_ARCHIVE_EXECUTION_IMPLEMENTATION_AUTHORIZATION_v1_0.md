# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — Live parity reconciled  
**Scope:** Archive metadata + campaign execution + scheduler runtime gate

## 1. Authorization Result

The Archive execution inputs are now reconciled against the latest project decisions and the live Supabase implementation. No new archive queue or alternate archive transport is introduced.

## 2. Storage / Ownership

```text
Historical / Archive Campaign
        ↓
Worker-side artifact creation + verification
        ↓
AWS/S3-compatible archive storage
        ↓
internal.archive_season(...)
        ↓
internal.archive_catalog
```

The Platform Stack assigns Workers to long-running execution/persistence, S3-compatible object storage to archive artifacts, and Supabase Postgres to authoritative metadata/manifest state. fileciteturn109file0L14-L33

## 3. Exact Live `internal.archive_season()` Contract

Verified live signature:

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

Return value: `manifest_id`.

Caller boundary: Archive Campaign/Worker, not browser/player access.

Live function behavior validates:

```text
end >= start
row_count >= 0
campaign exists for the exact scope
campaign scope_state = ARCHIVE_ONLY
completeness score exists
completeness policy version exists
applicable canonical completeness threshold exists
completeness >= threshold
```

It then registers the manifest idempotently in `internal.archive_catalog`, finalizes the archive campaign, and completes the linked worker job when present.

## 4. Eligibility / Retention Contract

Source-backed archive creation rule:

```text
ARCHIVE_ONLY
AND required historical scope complete
AND canonical completeness policy passes
AND dataset is source-defined archivable
AND target is not immutable / never-delete
```

Current P0 archive scheduler selects:

```text
odds_snapshots
provider_snapshots
evaluation_metrics
```

The hot-data retention/deletion lifecycle remains separate from archive creation.

Protected exclusions:

```text
prediction_baselines
canonical historical source required for audit/model replay
audit lineage
```

The project does not introduce a universal `30/90/365 day` archive-creation cutoff. fileciteturn111file0L127-L158

## 5. Archive Artifact Identity / DDL Reconciliation

The latest project decision requires `team_set_hash` in archive identity. Live parity is verified:

```text
internal.archive_catalog.team_set_hash
    text NOT NULL
```

Live unique constraint:

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

The logical artifact identity is therefore:

```text
country_id
+ competition_id
+ season
+ dataset_type
+ provider
+ schema_version
+ date range
+ team_set_hash
+ checksum
```

`manifest_id` is the resulting lineage identifier and is not part of the identity. A duplicate identity returns the existing manifest id; a different checksum represents a distinct artifact lineage. The latest project reconciliation explicitly requires this `team_set_hash` and uniqueness boundary. fileciteturn111file0L20-L89

## 6. Durable Dispatch / Campaign Contract

The live execution path is now verified:

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

`dispatch_archive_campaign(p_campaign_id uuid)` creates/reuses a `worker_jobs` record with idempotency key:

```text
archive-campaign:<campaign_id>
```

No `archive_queue` is created. No `backfill_queue` reuse is required.

## 7. Security Boundary

Verified live:

```text
archive_scheduler()            SECURITY INVOKER
archive_season(...)             SECURITY INVOKER
dispatch_archive_campaign(...)  SECURITY INVOKER
```

`anon` and `authenticated` do not have `EXECUTE` on these internal functions. Archive mutation remains inside the private/internal execution boundary.

## 8. Scheduler / Cron

Verified live:

```text
cron job: archive-scheduler
schedule: 0 3 * * *
command: select internal.archive_scheduler();
active: true
```

This matches the documented daily 03:00 archive scheduler target. fileciteturn109file2L247-L261

## 9. Remaining Gate

The implementation authorization is satisfied. Remaining work is runtime/functional verification only:

```text
✅ team_set_hash DDL reconciliation
✅ archive artifact UNIQUE identity
✅ archive_season() live signature/body
✅ campaign → worker_jobs dispatch
✅ scheduler → dispatch boundary
✅ 03:00 Cron installed

⏳ positive end-to-end archive registration with a real canonical campaign
⏳ duplicate/idempotency archive registration
⏳ rollback/failure verification
⏳ successful pg_cron runtime evidence
```

No production fixture or fake season should be fabricated solely to manufacture a successful archive run.

## 10. Non-Regression Rules

This authorization does not change:

- `fixtures.status` or fixture lifecycle;
- Historical Bootstrap semantics;
- 7-Day Rolling production;
- immutable prediction baselines;
- provider/Redis boundaries;
- the canonical queue set;
- archive artifact identity/uniqueness without a new explicit decision.

## 11. Final State

```text
Archive Metadata Foundation       ✅
Archive Execution Authorization  ✅
Archive Function                 ✅ live
Archive Campaign Dispatch         ✅ live
Archive Scheduler                 ✅ live
Cron                             ✅ installed

Runtime / E2E verification        ⏳
Group 10 final archive gate       ⏳
```
