# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026
**Status:** Implementation Authorized — constrained to archive metadata registration
**Scope:** `internal.archive_season()` registration boundary only; scheduler/Cron remain downstream

## Authority

Latest project source defines the archive flow as Historical Campaign → S3 season archive → `archive_season()` → `archive_catalog`, with the archive worker responsible for execution and PostgreSQL remaining control/metadata plane. `archive_scheduler` remains a short 03:00 control-plane operation that discovers `ARCHIVE_ONLY` + complete eligible work and dispatches it to the archive worker.

## Authorized execution contract

`internal.archive_season()` is authorized as a **metadata-registration RPC** invoked by the archive worker after the campaign has produced the S3 artifact.

Required inputs are the existing archive-catalog attributes plus `team_set_hash`, because the latest archive identity explicitly requires that stored field:

```text
country_id
competition_id
season
dataset_type
provider
date_start
date_end
team_set_hash
object_uri
checksum
row_count
completeness_score
schema_version
```

Return:

```text
manifest_id uuid
```

Semantics:

```text
validate/insert → register manifest → commit
same artifact identity → return existing manifest_id
new checksum → new artifact lineage
failure → rollback
```

The campaign/worker computes the team-set hash. PostgreSQL does not invent or recompute that hash.

## Retention / eligibility boundary

Archive artifact creation is admitted when:

```text
ARCHIVE_ONLY
AND required historical scope is complete
AND canonical completeness policy passes
AND dataset_type is source-defined archivable
AND target is not immutable / never-delete
```

The archive artifact is created before any later hot-data deletion/partition retirement. Hot retention/deletion remains a separate policy and is not implemented by `archive_season()`.

P0 first-wave exclusions:

```text
prediction_baselines  → never archive/delete by season
audit_log             → immutable
canonical replay/audit source → preserved
prediction_read_models → separate rebuildable lifecycle
worker_jobs           → separate operational retention lifecycle
```

## Artifact identity

Canonical artifact identity is:

```text
country_id
+ competition_id
+ season
+ dataset_type
+ provider
+ schema_version
+ date_start
+ date_end
+ team_set_hash
+ checksum
```

The database uniqueness boundary is the existing `archive_catalog_artifact_identity_key` using exactly those columns. `manifest_id` is the generated artifact/lineage identifier, not part of identity.

## Durable dispatch boundary

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
    ↓
internal.archive_catalog
```

No `archive_queue` is created by this authorization. No reuse of `backfill_queue` or direct `worker_jobs` shortcut is authorized by inference.

## Implementation constraints

- Private `internal` schema only.
- Prefer `SECURITY INVOKER`.
- No provider or Redis calls from PostgreSQL.
- No bulk S3 transfer from PostgreSQL; S3 transfer remains campaign/worker responsibility.
- No immutable prediction-truth mutation.
- No new archive lifecycle state.
- No scheduler/Cron creation in this migration.
- No deletion/partition retirement in this function.

## Gate

This authorization permits the function migration for the **metadata-registration boundary** only. It does not authorize `archive_scheduler` or Cron until the function is deployed, verified, and integrated with the campaign/worker runtime.
