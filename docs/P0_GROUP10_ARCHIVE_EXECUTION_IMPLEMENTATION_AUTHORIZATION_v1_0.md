# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — constrained to archive metadata registration  
**Scope:** `internal.archive_season()` registration boundary only; scheduler/Cron remain downstream

## Authority

Latest project source and the live Supabase deployment now provide the executable archive-registration contract. The project architecture places Archive storage in S3-compatible object storage, with workers/campaign execution responsible for artifact creation and PostgreSQL responsible for source-of-truth metadata/manifest registration.

The live migration history contains `p0_group10_archive_team_set_hash_reconciliation_v1` and `p0_group10_archive_season_registration_v1`, and the live database exposes the corresponding `internal.archive_season()` function.

## Authorized executable signature

The live deployed signature is authoritative:

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

Return value:

```text
manifest_id uuid
```

Caller:

```text
archive campaign/worker
```

The function is metadata-registration only. S3 artifact creation and verification remain outside PostgreSQL.

## Transaction / idempotency semantics

The deployed function enforces:

```text
p_date_end >= p_date_start
p_row_count >= 0
```

then registers the manifest in `internal.archive_catalog`.

The existing database uniqueness boundary is:

```text
(country_id,
 competition_id,
 season,
 dataset_type,
 provider,
 schema_version,
 date_start,
 date_end,
 team_set_hash,
 checksum)
```

On the same identity the function returns the existing `manifest_id`; a changed checksum represents a distinct artifact lineage.

## Retention / eligibility boundary

Archive artifact creation is source/project-aligned to the following prerequisites:

```text
ARCHIVE_ONLY
AND required historical scope is complete
AND canonical completeness policy passes
AND dataset_type is source-defined archivable
AND target is not immutable / never-delete
```

This is an **archive-admission prerequisite**, not a hot-data deletion rule.

P0 first-wave exclusions:

```text
prediction_baselines      → never archive/delete by season
audit_log                 → immutable
canonical replay/audit source → preserve
prediction_read_models    → separate rebuildable lifecycle
worker_jobs               → separate operational retention lifecycle
```

Later hot partition deletion/retirement remains a separate retention policy and is not implemented by `archive_season()`.

## Artifact identity

Canonical artifact identity is the exact database uniqueness tuple above. `manifest_id` is the generated lineage identifier and is not part of identity.

The architecture additionally requires `team_set_hash`; the live deployment now contains and enforces it.

## S3 + campaign execution boundary

```text
Historical Campaign / Archive Worker
        ↓
produce + verify S3 season artifact
        ↓
internal.archive_season(...)
        ↓
internal.archive_catalog
        ├─ object_uri
        ├─ checksum
        ├─ completeness_score
        └─ lineage fields
```

PostgreSQL does not upload the archive object and does not call providers or Redis.

## Scheduler boundary

The project contract remains:

```text
03:00 archive_scheduler
    ↓
short archive-control dispatch
    ↓
archive campaign/worker
    ↓
S3 artifact
    ↓
internal.archive_season()
```

No `archive_queue` is introduced. No `backfill_queue` reuse or direct `worker_jobs` shortcut is inferred by this authorization.

## Security boundary

The live function is:

```text
SECURITY INVOKER
anon EXECUTE          = false
authenticated EXECUTE = false
```

It remains private in the `internal` schema and is not a browser/public mutation surface.

## Non-goals

This authorization does not implement:

- `archive_scheduler`
- pg_cron schedule
- hot partition deletion
- new retention columns/states
- new queue types
- immutable prediction truth mutation
- provider or Redis access from PostgreSQL

## Verification gate

Before declaring the Archive execution boundary complete:

1. Verify the exact live function signature.
2. Verify private schema/security/grants.
3. Verify the artifact identity UNIQUE constraint.
4. Run a positive transactional registration test.
5. Run a duplicate registration/idempotency test.
6. Run invalid date-range and negative row-count rollback tests.
7. Confirm campaign/worker owns S3 object creation.
8. Only after this passes, implement and verify `archive_scheduler`, then its 03:00 Cron runtime gate.

## Status

```text
Archive metadata foundation        ✅
archive_season signature           ✅ LIVE
artifact DB identity               ✅ LIVE
S3 + campaign execution boundary  ✅ PROJECT-ALIGNED
archive admission prerequisites   ✅ PROJECT-ALIGNED

archive_scheduler                  ⛔ downstream gate
Cron                               ⛔ downstream runtime gate
```
