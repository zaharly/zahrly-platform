# ZAHRLY — P0 Group 10 Archive Execution Final Reconciliation v1.3

**Date:** 24 August 2026
**Status:** Execution inputs reconciled except durable scheduler dispatch contract

## Resolved

- Archive storage: AWS S3 / S3-compatible object storage.
- Execution owner: Historical Campaign / Archive Worker path creates and validates the S3 artifact; Postgres registers canonical metadata through `internal.archive_season`.
- `internal.archive_season` is deployed with the live signature including `team_set_hash` and returns `uuid` manifest identity.
- Archive eligibility: `ARCHIVE_ONLY` + season/scope completion + applicable canonical completeness + archivable dataset + never-delete exclusions.
- Archive artifact DB identity: `country_id, competition_id, season, dataset_type, provider, schema_version, date_start, date_end, team_set_hash, checksum` with a unique constraint.
- Existing artifact returns the existing `manifest_id`; changed checksum represents a new artifact lineage.
- S3 object URI/checksum/completeness remain metadata in PostgreSQL; the database function does not perform S3 transfer.

## Live verification

Migration history contains:
- `20260824135715 p0_group10_archive_team_set_hash_reconciliation_v1`
- `20260824135835 p0_group10_archive_season_registration_v1`

Live function:
- `internal.archive_season(uuid,uuid,integer,text,text,timestamptz,timestamptz,text,text,text,bigint,numeric,text) returns uuid`
- `SECURITY INVOKER`
- `EXECUTE` visible to `postgres` only in the live role-grant inspection.

Live archive identity index:
- `archive_catalog_artifact_identity_key`
- unique across the full artifact identity tuple above.

Integration verification used a transaction-local test artifact written twice through `internal.archive_season`; the second call returned the same manifest identity and the test asserted exactly one catalog row. All test rows were then deleted in the same transaction; residual check returned `0`.

## Remaining blocker

The project sources and current repository still do not define the exact durable mechanism by which the `03:00 archive_scheduler` turns an eligible archive candidate into durable Campaign/Worker work. The project explicitly forbids inventing `archive_queue`, reusing `backfill_queue`, or directly shortcutting to an unsupported worker path.

Therefore:

```text
S3 + Campaign execution ownership     ✅
archive_season signature               ✅
retention/eligibility trigger          ✅
artifact DB identity                   ✅
archive worker execution boundary     ✅
exact scheduler → Campaign dispatch    ⛔

archive_scheduler implementation       ⛔
Cron                                    ⛔
```

No new queue or scheduler SQL is authorized by this reconciliation alone.