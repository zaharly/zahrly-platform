# ZAHRLY — P0 Group 10 Archive Execution Inputs Final Decision v1.0

**Date:** 24 August 2026
**Status:** Project-Approved Execution Inputs — Implementation Authorization Prerequisite
**Scope:** Archive execution only; scheduler remains downstream.

## 1. Authority and non-regression

This decision is derived from the latest Archive execution material in the project Library, the live `internal.archive_catalog` schema, the platform stack, and the existing Group 10 governance decisions.

The project has already established:

- archive artifacts are stored in S3-compatible object storage;
- the Historical Campaign/Campaign worker owns the actual archive transfer/finalization;
- PostgreSQL remains the source of truth for archive metadata/lineage;
- `internal.archive_catalog` is the implementation mapping of the `archive_manifests` architecture concept;
- no `archive_queue` is introduced;
- `prediction_baselines` and audit/replay source are never deleted.

This decision does not modify fixture lifecycle, Historical Bootstrap semantics, 7-Day Rolling, provider boundaries, or existing queue topology.

## 2. `internal.archive_season()` signature

### Decision

`internal.archive_season()` is the **worker-side finalization/manifest-registration RPC**. The Campaign/Archive Worker creates and verifies the S3 artifact first, then calls PostgreSQL to validate the archive scope and register the immutable archive manifest metadata.

### Canonical signature

```sql
internal.archive_season(
  p_country_id uuid,
  p_competition_id uuid,
  p_season integer,
  p_dataset_type text,
  p_provider text,
  p_date_start timestamptz,
  p_date_end timestamptz,
  p_object_uri text,
  p_checksum text,
  p_row_count bigint,
  p_completeness_score numeric,
  p_schema_version text,
  p_team_set_hash text
) RETURNS uuid
```

### Return

Returns the canonical `internal.archive_catalog.manifest_id` for the registered artifact.

### Semantics

```text
validate scope/completion/completeness/artifact identity
→ register manifest metadata
→ COMMIT
```

Any validation or database failure is a visible failure and rolls back the registration transaction.

If the exact same archive artifact already exists, return its existing `manifest_id` as an idempotent success. A changed checksum represents a distinct artifact lineage and must not overwrite the prior manifest.

### Caller

Only the private Archive Worker/Campaign execution path is authorized to call the function. PostgreSQL Cron must not perform S3 transfer or long-running archive generation.

### Type alignment note

`date_start` and `date_end` are `timestamptz` in the deployed `internal.archive_catalog` schema; the signature therefore uses `timestamptz`, not `date`.

`team_set_hash` is already present in the deployed archive catalog and participates in artifact identity; it is therefore included explicitly rather than introducing a new column later.

## 3. Archive creation trigger vs hot-data retention

### Archive creation trigger — Decision

Archive creation is admitted when all of the following are true for the dataset/scope:

```text
ARCHIVE_ONLY season/scope
AND
season/scope completion
AND
canonical completeness policy satisfied
AND
source-defined archivable dataset type
AND
not a never-delete / immutable target
```

This is the **archive artifact creation trigger**.

### Explicit separation

This decision does **not** define a universal `retention_days`, season-age cutoff, or `archive_after` value for hot-table deletion.

Hot-table partition dropping/deletion remains a separate dataset-specific retention policy after a valid archive artifact and manifest exist.

Protected datasets remain protected:

```text
prediction_baselines
canonical historical source required for audit/model replay
relevant audit lineage
```

## 4. Archive artifact database identity

### Logical identity

The canonical archive-artifact identity is:

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

### Database uniqueness decision

The implementation must enforce uniqueness over the complete identity above so the same artifact cannot create duplicate manifests.

The implementation must not use `worker_jobs.idempotency_key` as a substitute for archive-artifact identity. Worker-job idempotency and archive-artifact identity remain separate layers.

### Existing artifact behavior

```text
same identity
→ return existing manifest_id
→ no duplicate archive artifact registration

same scope but different checksum
→ distinct artifact lineage
→ never overwrite prior manifest
```

## 5. Execution path

The already-approved transport boundary is:

```text
03:00 archive_scheduler
    ↓
short archive-control / campaign admission
    ↓
Archive Campaign / Worker
    ↓
S3 artifact creation/verification
    ↓
internal.archive_season(...)
    ↓
internal.archive_catalog
```

No `archive_queue` is introduced by this decision.

No `control_queue` reuse is inferred.

## 6. Implementation gate

This decision is sufficient to prepare an `Archive Execution Implementation Authorization`, subject to one implementation migration review:

1. create the exact function signature above;
2. add the archive-artifact uniqueness constraint/index using existing `archive_catalog` columns only;
3. enforce the archive creation trigger through existing season/scope and completeness state;
4. keep S3 transfer in the Campaign/Worker layer;
5. verify private execution grants and RLS boundaries;
6. test idempotent replay, duplicate registration, checksum divergence, rollback, and S3/DB failure separation.

No Cron is authorized by this document alone.
