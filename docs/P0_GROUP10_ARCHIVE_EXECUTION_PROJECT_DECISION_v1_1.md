# ZAHRLY — P0 Group 10 Archive Execution Project Decision v1.1

**Date:** 24 August 2026  
**Status:** Project-Decided / Implementation Preparation  
**Scope:** Archive execution only

## Authority and reconciliation

The latest project Library decision establishes an S3/Campaign archive flow. The Platform Stack architecture confirms S3-compatible object storage as the archive layer, Python async workers as the background execution plane, and Supabase as source of truth for metadata/manifests. The Supabase Blueprint confirms `archive_season(...)` as an admin/worker manifest-registration operation and the documented `ARCHIVE_ONLY` season-completion model.

## 1. Final `archive_season` contract

The function is a worker-side finalization/manifest-registration RPC. It does **not** transfer data to S3.

Because the deployed archive catalog now requires the latest project archive identity, the implementation signature is:

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

Return:

```text
manifest_id uuid
```

Caller:

```text
archive Campaign / archive Worker
```

Semantics:

```text
validate required metadata
→ enforce artifact identity
→ insert archive_catalog manifest
→ commit

same identity → return existing manifest_id
same identity with different checksum → distinct artifact/new lineage
failure → rollback
```

No S3 transfer, bulk serialization, partition deletion, provider call, or Redis call occurs inside PostgreSQL.

## 2. S3 + Campaign execution path

The project-approved path is:

```text
Historical / Archive Campaign
        ↓
produce settled + complete archive dataset
        ↓
write/validate artifact in AWS S3-compatible object storage
        ↓
Archive Worker
        ↓
internal.archive_season(...)
        ↓
internal.archive_catalog
```

And the control-plane path is:

```text
03:00 archive_scheduler
        ↓
find ARCHIVE_ONLY + complete archivable datasets
        ↓
create/dispatch archive-control campaign work
        ↓
Archive Campaign/Worker
```

No `archive_queue` is introduced. No `backfill_queue` reuse is authorized merely by inference. The durable dispatch contract remains the project's existing campaign/worker job mechanism once mapped to the deployed worker identity.

## 3. Archive eligibility vs hot-data retention

These are separate decisions.

### Archive artifact creation

An archive artifact is eligible when:

```text
ARCHIVE_ONLY
AND season/scope completion
AND required dataset completeness passes its canonical policy
AND dataset_type is archivable
AND target is not immutable / never-delete
```

Dataset-specific source-aligned examples:

```text
odds_snapshots         → ARCHIVE_ONLY / season completion
provider_snapshots     → historical scope completion; DB metadata remains authoritative
evaluation_metrics     → final required evaluation completion
prediction_baselines   → never archive/delete by season
prediction_read_models → separate rebuildable/current lifecycle
worker_jobs            → separate operational retention lifecycle
audit_log              → immutable
```

### Hot-data retention/deletion

`retention_days`, hot-partition dropping, and repartitioning remain a separate downstream policy. They do not gate creation of the canonical S3 archive artifact once the archive completion prerequisites above are satisfied.

## 4. Archive artifact identity / DB uniqueness

The latest project decision adds `team_set_hash` to archive identity.

Logical identity:

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

`manifest_id` is generated identity and is not part of the logical artifact identity.

Required database uniqueness:

```sql
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

Repeated registration of the same identity returns the existing `manifest_id` and creates no duplicate manifest.

Changing checksum creates a new artifact/new lineage.

## 5. Compatibility / schema reconciliation

The live archive foundation originally deployed without `team_set_hash`. The latest architecture/identity decision now requires it, so the implementation sequence is:

```text
add team_set_hash
→ verify live parity
→ add archive artifact uniqueness
→ create archive_season() with team_set_hash
```

This is a targeted additive reconciliation only. It does not redesign the archive tables or affect any other Group 10 state.

## 6. Non-regression rules

Must not modify:

- `fixtures.status`
- fixture lifecycle/episodes
- Historical Backfill
- 7-Day Rolling
- `rolling_fixture_dispatch`
- `queue_recovery`
- provider health/quota semantics
- immutable prediction truth
- public Data API exposure

## 7. Next implementation gate

After the `team_set_hash` reconciliation migration is verified, the project may issue `Archive Execution Implementation Authorization` and then implement:

1. `internal.archive_season()` migration.
2. Archive Campaign/Worker S3 adapter integration.
3. Duplicate registration / checksum divergence / rollback / replay tests.
4. Only after worker verification: `archive_scheduler` and its 03:00 Cron runtime gate.
