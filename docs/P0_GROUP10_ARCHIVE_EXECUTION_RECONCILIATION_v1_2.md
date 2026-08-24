# ZAHRLY — P0 Group 10 Archive Execution Reconciliation v1.2

**Date:** 24 August 2026  
**Status:** Reconciled — implementation remains gated  
**Scope:** Archive execution only

## 1. Result

The latest project sources narrow the remaining execution gate to three items:

```text
1. exact internal.archive_season() signature
2. dataset-specific retention / temporal eligibility policy
3. exact database-level archive artifact identity / uniqueness
```

The scheduler/worker boundary is now resolved at contract level.

## 2. Source-Resolved Execution Boundary

The canonical archive path is:

```text
archive_scheduler
    ↓
short archive-control discovery / enqueue
    ↓
archive worker
    ↓
write archive artifact
write manifest/checksum/object_uri/completeness
preserve audit/replay source
```

The scheduler must not perform bulk serialization, large uploads, hot-partition deletion, provider calls, or Redis calls.

No `archive_queue` is inferred or created by this decision.

## 3. Source-Resolved Completeness Gate

`internal.archive_completeness_rules` is canonical and dataset-specific. A dataset below its applicable completeness requirement is not eligible for archival.

No second archive threshold may be introduced.

## 4. Source-Resolved Eligibility Prerequisites

An archive candidate must satisfy the source-backed prerequisites already defined by the project:

```text
canonical archive/season scope is not blocked
AND dataset completeness is sufficient
AND dataset type is source-defined as archivable
AND target is not an immutable / never-delete dataset
```

The exact temporal retention trigger remains undefined.

## 5. Source-Resolved Retention Model

Retention remains dataset-specific. Current source behavior includes different handling for:

```text
odds_snapshots
provider_snapshots
evaluation_metrics
prediction_read_models
worker_jobs
audit_log
prediction_baselines
```

No universal `retention_days`, season-age cutoff, or `archive_after` value is authorized.

## 6. Source-Resolved Archive Logical Identity

The project defines the logical archive identity as associated with:

```text
dataset_type + season + scope + manifest lineage
```

Already complete/already manifested work must not create duplicate archive work.

This is distinct from:

```text
worker_jobs.idempotency_key
provider_requests.idempotency_key
prediction-job idempotency
```

The exact database uniqueness key/query is still open and must not be invented.

## 7. `internal.archive_season()`

The architecture defines `internal.archive_season(...)` as an admin/worker operation responsible for writing archive manifests and metadata.

No authoritative argument list, return contract, caller signature, or error/transaction contract has been found.

Therefore:

```text
signature = NOT AUTHORIZED
```

No parameters or return type are inferred from the archive tables alone.

## 8. Implementation Gate

The following are now resolved enough to carry directly into implementation once the remaining authoritative details arrive:

```text
scheduler → worker boundary       ✅
completeness gate                 ✅
eligibility prerequisites         ✅
never-delete protections          ✅
logical archive identity          ✅
worker-job idempotency            ✅ existing
```

The following remain blockers:

```text
exact archive_season() signature  ⛔
retention / temporal trigger      ⛔
archive artifact DB uniqueness   ⛔
```

## 9. Explicit Non-Regression Rules

This reconciliation does not authorize:

```text
archive_queue
new archive lifecycle states
universal retention rule
new archive hash
partition deletion
source deletion
changes to prediction truth
changes to Historical Backfill
changes to 7-Day Rolling
provider calls from PostgreSQL
Redis calls from PostgreSQL
```

## 10. Next Gate

Once the three remaining authoritative inputs are supplied, issue:

```text
P0 Group 10 Archive Execution Implementation Authorization
```

Then proceed:

```text
Implementation Authorization
    ↓
authoritative function/worker artifact
    ↓
migration review
    ↓
apply + live parity
    ↓
transactional/idempotency/retry tests
    ↓
archive_scheduler
    ↓
Cron runtime verification
```
