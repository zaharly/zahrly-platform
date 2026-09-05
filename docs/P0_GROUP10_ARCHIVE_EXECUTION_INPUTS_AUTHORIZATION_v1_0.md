# ZAHRLY — P0 Group 10 Archive Execution Inputs Authorization v1.0

**Date:** 24 August 2026  
**Status:** Project-Decided / Implementation Gate  
**Scope:** Archive execution layer only

## Authority

This decision reconciles the latest project sources, including the Supabase Blueprint v1.3, Platform Stack v1.3, the latest Group 10 archive decisions, the Historical Campaign/Admin materials, and the latest project archive-execution decision captured in the project Library.

The project has already decided that archive artifacts are created by the historical/archive Campaign/Worker in S3-compatible object storage, while PostgreSQL remains the source of truth for archive metadata/manifests. The scheduler is control-plane only and does not perform bulk transfer or provider/Redis calls.

## 1. `internal.archive_season()`

**Project decision:** worker-side finalization / manifest-registration RPC.

```sql
internal.archive_season(
  p_country_id uuid,
  p_competition_id uuid,
  p_season integer,
  p_dataset_type text,
  p_provider text,
  p_date_start date,
  p_date_end date,
  p_object_uri text,
  p_checksum text,
  p_row_count bigint,
  p_completeness_score numeric,
  p_schema_version text
) RETURNS uuid
```

Return value:

```text
manifest_id uuid
```

Caller:

```text
archive worker / archive Campaign worker
```

Semantics:

```text
validate scope/completion/completeness/artifact identity
→ register manifest metadata
→ commit

failure → rollback
same artifact → return existing manifest_id (idempotent success)
```

The function does not perform S3 transfer. The Campaign/Worker produces and validates the S3 artifact first, then registers the resulting manifest in PostgreSQL.

## 2. Archive eligibility / retention ownership

Archive creation is distinct from hot-data retention/deletion.

### Archive creation trigger

For the initial P0 archive path:

```text
ARCHIVE_ONLY
AND required season/scope completion
AND applicable canonical completeness policy passes
AND dataset is archivable
AND target is not immutable / never-delete
```

Dataset-specific source-aligned examples:

```text
odds_snapshots
  → archive at ARCHIVE_ONLY / completion

provider_snapshots
  → archive at historical scope completion; DB metadata remains authoritative

evaluation_metrics
  → archive after final required evaluation completion

prediction_baselines
  → never archive/delete by season

prediction_read_models
  → separate rebuildable/read-model lifecycle

worker_jobs
  → separate operational retention/archive lifecycle
```

No universal `retention_days`, season-age cutoff, or hot-data deletion window is part of archive creation.

Hot partition deletion/repartitioning remains a separate later retention policy applied only after a valid archive artifact exists.

## 3. Archive artifact logical identity

Canonical logical identity for the archive artifact:

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

`manifest_id` is the generated manifest identity and is not an input to artifact identity.

Idempotent behavior:

```text
same artifact identity
→ existing manifest_id
→ no duplicate artifact registration

different checksum
→ new artifact / new lineage
```

### Schema reconciliation requirement

The latest project decision requires `team_set_hash` for the authoritative archive identity, but the currently deployed `internal.archive_catalog` foundation does not yet contain this column. Therefore the next migration must add:

```sql
team_set_hash text
```

before applying the archive function or uniqueness constraint.

The exact database-level `UNIQUE` constraint must be created only after the `team_set_hash` reconciliation migration is applied and live parity is verified.

## 4. Durable dispatch / transport

The project-authorized execution boundary is:

```text
03:00 archive_scheduler
    ↓
short archive-control / campaign-admission step
    ↓
archive Campaign / Worker
    ↓
S3 artifact creation/validation
    ↓
internal.archive_season()
    ↓
archive_catalog / manifest lineage
```

No new `archive_queue` is introduced.

The scheduler does not directly call providers, Redis, or perform bulk S3 transfer. The Campaign/Worker owns the long-running archive operation.

Where an existing durable job mechanism is used, it must retain the existing worker-job idempotency boundary and must not introduce a second queueing system.

## 5. Non-regression rules

This decision does not modify:

- `fixtures.status`
- fixture lifecycle / episodes
- Historical Backfill behavior
- 7-Day Rolling behavior
- `rolling_fixture_dispatch`
- `queue_recovery`
- provider quota/health semantics
- immutable `prediction_baselines`
- public/API exposure of internal archive operations

It also does not authorize hot-data deletion, partition dropping, or archive Scheduler SQL yet.

## 6. Implementation gate

Before implementation:

1. Reconcile `team_set_hash` into `internal.archive_catalog`.
2. Add the final archive artifact uniqueness constraint derived from the logical identity above.
3. Create `internal.archive_season()` with the exact signature above.
4. Verify internal security/EXECUTE grants.
5. Integrate Campaign/Worker S3 transfer and manifest finalization.
6. Test duplicate artifact registration, checksum divergence, rollback, and replay.
7. Only after those tests pass, implement `archive_scheduler` and its 03:00 runtime gate.

**Status:** Archive execution inputs are now project-decided; implementation remains gated on the schema reconciliation and execution migration.