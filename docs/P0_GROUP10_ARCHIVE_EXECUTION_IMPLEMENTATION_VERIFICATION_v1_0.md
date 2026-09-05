# ZAHRLY — P0 Group 10 Archive Execution Implementation Verification v1.0

**Date:** 24 August 2026  
**Status:** Verified — Function + Artifact Identity Foundation Complete; Scheduler/Cron Not Installed  
**Scope:** Archive execution finalization boundary only.

## Authoritative live implementation

The live Supabase project contains the archive finalization function:

```sql
internal.archive_season(
  uuid,
  uuid,
  integer,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  bigint,
  numeric,
  text
) RETURNS uuid
```

The deployed signature includes `team_set_hash`, which is required by the latest archive artifact identity contract and therefore supersedes the earlier 12-argument draft that omitted that field.

The function is `SECURITY INVOKER`, has a fixed search_path of `internal, public`, and is not executable by `anon` or normal `authenticated` access.

## Artifact identity

The live `internal.archive_catalog` has:

```text
archive_catalog_artifact_identity_key UNIQUE (
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

The archive lineage table retains `manifest_id` as the generated row identity.

## Execution model

The project architecture defines:

```text
Historical Campaign / Archive Campaign
    ↓
AWS S3 season archive artifact
    ↓
Archive Worker
    ↓
internal.archive_season()
    ↓
internal.archive_catalog
```

The PostgreSQL function is a metadata finalization/registration boundary. It does not perform the S3 transfer, provider calls, Redis calls, or long-running archive serialization.

## Verification performed

A transactionally isolated E2E test was run against the live function using temporary country/competition rows and a synthetic S3 URI.

Verified:

```text
positive registration           ✅
idempotent same-artifact call    ✅ same manifest_id
different checksum              ✅ new manifest_id / new lineage
invalid date range              ✅ rejected
negative row_count              ✅ rejected
rollback / cleanup              ✅ zero residual test rows
```

After rollback:

```text
__g10_archive_e2e__ rows = 0
```

## Scheduler boundary

No archive Cron was installed and no `archive_queue` exists.

The documented daily `03:00 archive_scheduler` remains a downstream control-plane step. It must not perform S3 transfer inline; campaign/worker execution remains responsible for the actual archive artifact.

## Security/advisors

The security advisor produced no archive-specific function exposure issue. It reports the expected INFO-level `RLS enabled but no policy` notices for private internal archive tables, plus unrelated pre-existing project findings.

## Final gate status

```text
Archive metadata foundation      ✅
archive_season()                 ✅ verified live
artifact DB uniqueness           ✅ verified live
E2E/idempotency/rollback tests   ✅
S3 transfer boundary             ✅ worker/campaign-owned
archive_scheduler                ⛔ downstream
Cron                             ⛔ not installed
```

This verification artifact does not authorize the archive scheduler or Cron. Those remain a separate Group 10 gate.