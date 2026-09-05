# ZAHRLY — P0 Group 10 Archive Season Execution Contract v1.0

**Date:** 24 August 2026  
**Status:** Contract Reconciliation — **Implementation Still Gated**  
**Scope:** `internal.archive_season(...)` execution contract only

## 1. Purpose

This document freezes the execution boundary for the Archive worker operation without inventing an executable function signature, retention rule, eligibility predicate, queue, or archive-artifact identity that is not source-exact.

The canonical archive metadata foundation is already deployed as:

```text
internal.archive_catalog
internal.archive_completeness_rules
```

The live database currently has **no** `internal.archive_season(...)` implementation, no archive-specific queue, and no archive Cron.

## 2. Source-Supported Responsibility

The Architecture defines `internal.archive_season(...)` as an **admin/worker operation** responsible for writing archive manifests and archive metadata.

The operation therefore belongs to the worker/archive boundary, not to PostgreSQL Cron itself.

The intended runtime boundary is:

```text
Cron / scheduler
      ↓
short archive-control admission
      ↓
worker
      ↓
archive artifact / manifest work
      ↓
internal.archive_catalog
```

Cron must not perform bulk serialization, large object upload, hot-partition deletion, provider calls, or Redis calls.

## 3. Canonical Metadata Target

Archive manifest lineage is represented by:

```text
internal.archive_catalog
```

The architecture concept `archive_manifests` must not produce a second table.

The catalog fields currently established in the deployed foundation are:

```text
manifest_id
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
created_at
```

## 4. Completeness Contract

The operation may use the canonical completeness policy represented by:

```text
internal.archive_completeness_rules
```

with identity:

```text
(dataset_type, policy_version)
```

Completeness is a prerequisite for archival eligibility. It is **not** a substitute for retention/eligibility policy.

The implementation must not introduce a second archive-specific threshold.

## 5. Never-Delete Boundary

The archive path must preserve:

```text
prediction_baselines
canonical historical source required for reconstruction
 audit/model-replay source
 audit lineage
```

The archive system is a cold-storage optimization and audit/replay mechanism, not a data-loss path.

## 6. Worker State / Idempotency Boundary

Existing infrastructure provides:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

This can protect duplicate worker-job creation.

However, it does **not** define the archive-artifact identity. The artifact identity remains open until an authoritative archive contract specifies the exact key/query.

Therefore this contract does **not** add:

```text
new archive uniqueness constraint
new archive hash
new queue
```

## 7. Function Signature

The Architecture names:

```text
internal.archive_season(...)
```

but no authoritative argument list has been established in the live database or an approved migration/contract.

Therefore:

```text
FUNCTION SIGNATURE = BLOCKED / DISCOVERY REQUIRED
```

No parameters are invented in this document.

## 8. Retention / Eligibility

The archive architecture is dataset-aware. Examples include different treatment for odds snapshots, provider snapshots, evaluation metrics, rebuildable read models, worker jobs, immutable audit data, and immutable prediction baselines.

There is no source-exact universal:

```text
retention_days = X
season_cutoff = Y
archive_after = Z
```

Therefore the exact temporal eligibility predicate remains:

```text
BLOCKED / POLICY REQUIRED
```

A dataset cannot become archivable solely because it is old.

## 9. Execution Path

No canonical `archive_queue` exists in the project queue set.

This contract therefore does not authorize any of the following by inference:

```text
archive_scheduler → archive_queue
archive_scheduler → control_queue
archive_scheduler → worker_jobs directly
```

The exact scheduler-to-worker dispatch mechanism remains blocked until an authoritative execution contract identifies it.

## 10. Transactional / Safety Requirements

When implementation is later authorized, the archive operation must:

```text
- be retry-safe;
- avoid partial archive metadata publication;
- preserve manifest checksum/object_uri/completeness lineage;
- avoid mutating immutable prediction truth;
- avoid provider and Redis calls from SQL Cron;
- respect existing internal/private security boundaries;
- remain compatible with worker retry/lease/DLQ semantics.
```

These are execution-boundary requirements, not new business eligibility rules.

## 11. Security Boundary

Archive mutation remains private/internal:

```text
internal schema
    ↓
worker/admin identity
    ↓
archive writes
```

No public browser execution is authorized.

Prefer `SECURITY INVOKER`. If `SECURITY DEFINER` is later proven necessary, it must remain private with explicit least-privilege grants and a documented reason.

## 12. Implementation Gate

Before a function migration can be authorized, the following must be source-exact:

```text
1. exact function signature
2. exact invocation/execution path
3. exact retention/eligibility policy
4. exact archive-artifact identity
5. final security/grant contract
```

Only after those are resolved may the implementation proceed:

```text
contract approval
      ↓
function migration
      ↓
live function signature verification
      ↓
worker integration
      ↓
transactional/idempotency tests
      ↓
Archive Scheduler Decision
      ↓
Cron runtime gate
```

## 13. Current Gate

```text
Archive metadata foundation     ✅ deployed
Canonical completeness policy    ✅ deployed foundation
Worker boundary                 ✅ resolved
Never-delete boundary            ✅ resolved
Worker-job idempotency          ✅ existing

archive_season() signature      ⛔
retention predicate             ⛔
eligibility predicate            ⛔
archive artifact identity        ⛔
execution path                  ⛔
archive_scheduler                ⛔
Cron                             ⛔
```

**No SQL function, queue, or Cron is authorized by this contract alone.**
