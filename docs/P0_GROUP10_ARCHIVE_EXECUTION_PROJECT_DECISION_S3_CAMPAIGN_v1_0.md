# ZAHRLY — P0 Group 10 Archive Execution Project Decision v1.0

**Date:** 24 August 2026  
**Scope:** Archive execution only  
**Status:** Project Decision — design basis established; implementation gate remains until final DDL/live reconciliation

## 1. Purpose

This decision records the previously approved Archive execution model and reconciles it against the latest project architecture.

The Archive execution model is:

```text
Historical/Archive Campaign
        ↓
Archive Worker
        ↓
AWS S3 / S3-compatible object storage
        ↓
Postgres archive metadata / lineage
        ↓
internal.archive_catalog
```

Postgres remains the source of truth for archive lineage and metadata. S3 is the cold archive storage boundary. The scheduler is control-plane only.

## 2. Authoritative execution ownership

The actual archive transfer/build work belongs to the campaign/worker layer. PostgreSQL functions and pg_cron must not perform bulk serialization, S3 transfer, provider calls, Redis calls, or hot-partition deletion inline.

The project architecture explicitly assigns Workers to queue consumption, providers, retries, and persistence, while the Archive component is S3-compatible object storage for raw snapshots, season datasets, and model artifacts. The Scheduler/Worker contract requires the scheduler to discover/enqueue short archive-control work and the worker to perform the actual archive artifact/manifest work.

## 3. `archive_season()` contract status

### Resolved at design level

`internal.archive_season(...)` is an internal/admin-worker operation whose purpose is to register archive metadata/manifest information after the archive artifact has been created and validated.

The function is therefore **not** the S3 transfer engine.

### Still requires explicit signature authorization

The following are the authoritative archive catalog attributes that the function must ultimately account for:

```text
country_id
competition_id
season
dataset_type
provider
date_start
date_end
object_uri
checksum
row_count
completeness_score
schema_version
```

The latest architecture additionally refers to `team_set_hash` as searchable archive metadata. Because that field is not yet established in the currently deployed archive table contract, it is a **schema reconciliation item** and must not be added silently by the function migration.

No exact SQL argument list or return contract is authorized by this decision alone.

## 4. Retention and archive eligibility

Archive creation is distinct from hot-data deletion/partition retention.

The source-supported archive eligibility concept is:

```text
ARCHIVE_ONLY scope
AND season/scope completion
AND applicable canonical completeness policy passes
AND dataset_type is archivable
AND target is not immutable / never-delete
```

This decision intentionally does **not** introduce:

```text
retention_days = X
season - 1
kickoff older than N days
```

Hot-table deletion or partition dropping remains a separate dataset-specific retention policy applied only after a valid archive artifact exists and its metadata/lineage is registered.

Protected data includes prediction baselines and historical/audit/model-replay source required for reconstruction.

## 5. Dataset-aware retention ownership

The project sources establish different lifecycle behavior by dataset family:

```text
odds_snapshots         → archive older partitions
provider_snapshots     → payloads in object storage; metadata remains in DB
evaluation_metrics    → partition by run date/season where needed
prediction_read_models → short/current and rebuildable
worker_jobs            → separate operational hot retention/archive lifecycle
audit_log              → immutable retention
prediction_baselines   → never delete/archive by season
```

These rules define ownership and exclusions; they do not create one universal executable retention predicate.

## 6. Archive artifact identity

The project sources establish the logical archive identity as:

```text
dataset_type + season + scope + manifest lineage
```

The physical artifact also carries integrity metadata including checksum, object URI, completeness, and schema version.

Existing `internal.worker_jobs.idempotency_key` protects worker-job duplication, but it is **not** by itself the archive-artifact identity.

No new hash or uniqueness constraint is authorized until the current archive schema and latest architecture fields are reconciled. In particular, `team_set_hash` must be reconciled before a final database uniqueness key is created.

## 7. Durable dispatch / transport

The durable execution boundary is:

```text
scheduler
   ↓
short archive-control work
   ↓
archive campaign / worker
   ↓
S3 artifact + manifest registration
```

No `archive_queue` exists in the canonical queue list. This decision does **not** authorize inventing `archive_queue`, reusing `control_queue`, or directly enqueueing `worker_jobs` as a shortcut.

The exact durable transport mechanism must come from the approved campaign/worker implementation contract.

## 8. Security boundary

Archive mutations remain private/internal.

The intended boundary is:

```text
internal PostgreSQL control/metadata
        ↓
worker/admin identity
        ↓
S3 archive operations
```

Prefer `SECURITY INVOKER`. If `SECURITY DEFINER` is required, it must remain in the private `internal` schema with least-privilege EXECUTE grants and explicit justification.

No browser/player execution is authorized.

## 9. Implementation gate

Before creating `internal.archive_season()` or an archive scheduler, verify:

1. exact function signature and result semantics;
2. final archive catalog schema, including reconciliation of `team_set_hash`;
3. dataset-specific archive eligibility/retention policy;
4. final artifact uniqueness/idempotency boundary;
5. approved campaign/worker durable dispatch contract;
6. S3 object path and checksum validation contract;
7. rollback/replay behavior;
8. internal security/grants;
9. live schema parity;
10. positive, duplicate, failure, and recovery tests.

## 10. Non-regression

This decision does not modify:

```text
fixtures.status
fixture lifecycle
Historical Bootstrap
7-Day Rolling
queue_recovery
provider_health
prediction_baselines
existing canonical queues
```

It does not create SQL, a queue, a worker, or Cron.

## 11. Current status

```text
S3 archive storage boundary          ✅ established
Campaign/worker ownership            ✅ established
Archive eligibility concept          ✅ established
Dataset-aware retention ownership    ✅ established
Never-delete exclusions              ✅ established
Logical archive identity              ✅ established

Exact `archive_season()` signature   ⛔
Final retention/temporal policy       ⛔
Final DB uniqueness key               ⛔
Exact durable transport contract     ⛔
`team_set_hash` schema reconciliation ⛔
```

The next executable artifact is **Archive Execution Implementation Authorization**, but it must be issued only after the remaining implementation-gated items above are explicitly reconciled.
