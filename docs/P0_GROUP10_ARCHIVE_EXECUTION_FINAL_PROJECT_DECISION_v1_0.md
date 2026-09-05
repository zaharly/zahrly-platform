# ZAHRLY — P0 Group 10 Archive Execution Final Project Decision v1.0

**Date:** 24 August 2026  
**Status:** Final Project Decision — **Implementation Remains Gated**  
**Scope:** Archive execution only; metadata foundation and scheduler/worker boundary are already resolved at contract level.

## 1. Purpose

This decision narrows the remaining Archive execution gate to exactly four implementation inputs. It does not redefine Archive architecture, create SQL, add queues, or create Cron.

The current canonical foundation remains:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
```

The current source-backed contract already resolves:

```text
completeness prerequisite
eligibility prerequisites
never-delete protections
scheduler → worker boundary
logical archive identity
```

## 2. Final Four-Point Gate

### 2.1 `internal.archive_season(...)` exact signature

**Authority required:** SOURCE-EXACT or CONTRACT-DERIVED under the project's Group 8 signature standard.

The Architecture establishes `internal.archive_season(...)` as an admin/worker operation that writes archive manifests and metadata, but it does not define an unambiguous argument list or return contract.

Therefore the following remain unselected until an authoritative source exists:

```text
parameters
return/result shape
caller identity
error semantics
transaction boundary
```

No parameter names or SQL types are inferred from table columns alone.

**Status: BLOCKED — signature authority required.**

### 2.2 Temporal retention / archival trigger

**Authority required:** dataset-specific approved policy.

The source resolves the prerequisites:

```text
scope not blocked
AND canonical completeness sufficient
AND source-defined archivable dataset
AND not immutable / never-delete
```

The source also defines dataset-specific retention behavior, including older odds partitions, object-storage provider payloads, rebuildable read models, hot worker retention, immutable audit history, and never-delete prediction baselines.

However, no executable temporal trigger is authoritative. The following remain explicitly unselected:

```text
retention_days = X
archive_after = Y
season_cutoff = Z
kickoff-age cutoff
current-season minus N
```

**Status: BLOCKED — dataset-specific retention policy required.**

### 2.3 Archive artifact database identity / uniqueness

**Authority required:** approved lineage/idempotency contract.

The logical archive identity is source-backed as:

```text
dataset_type + season + scope + manifest lineage
```

Worker-job duplication is already protected by:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

But the source does not define the database-level uniqueness key, query, or constraint for an archive artifact.

Therefore no archive hash, unique constraint, or shortcut derived from `manifest_id` is invented here.

**Status: BLOCKED — artifact DB identity contract required.**

### 2.4 Durable dispatch / transport contract

**Authority required:** approved archive worker/execution contract.

The source resolves the boundary:

```text
archive_scheduler
    ↓
short archive-control discovery/enqueue
    ↓
archive worker
    ↓
archive artifact + manifest/checksum/object_uri/completeness
```

But the transport implementation remains open. No `archive_queue` exists in the canonical queue set, and no inference is authorized to:

```text
scheduler → archive_queue
scheduler → control_queue
scheduler → worker_jobs directly
scheduler → another existing queue
```

The authoritative contract must state:

```text
who creates the durable work item
where it is persisted
which worker consumes it
which retry/lease/DLQ mechanism applies
```

**Status: BLOCKED — durable dispatch contract required.**

## 3. Resolved Contract Baseline

The following are not reopened by this decision:

```text
archive_manifests ↔ internal.archive_catalog       ✅
completeness policy                               ✅
archive eligibility prerequisites                 ✅
scheduler → worker boundary                      ✅
never-delete protections                          ✅
logical archive identity                          ✅
worker_jobs idempotency infrastructure            ✅
private/internal security boundary                 ✅
```

In particular, completeness is a prerequisite and is not itself a retention trigger.

The archive system is a cold-storage optimization and must preserve immutable prediction truth, audit lineage, and canonical historical source needed for reconstruction.

## 4. Explicit Non-Decisions

This decision does not authorize:

```text
CREATE FUNCTION internal.archive_season(...)
archive_queue
archive_scheduler
pg_cron
retention_days / archive_after / season cutoff
new archive lifecycle state
new archive hash formula
new archive uniqueness constraint
partition deletion
source deletion
provider calls from PostgreSQL
Redis calls from PostgreSQL
changes to Historical Bootstrap
changes to 7-Day Rolling
```

## 5. Implementation Authorization Gate

Archive execution implementation may start only when all four inputs are authoritative:

```text
✅ exact function signature
✅ temporal retention / archival trigger
✅ archive artifact DB identity / uniqueness
✅ durable dispatch / transport contract
```

Then the authorized sequence is:

```text
1. Archive Execution Implementation Authorization
2. function/worker implementation artifact
3. migration review
4. migration apply
5. live function/grant/schema parity
6. worker integration
7. transactional + idempotency + retry tests
8. archive_scheduler decision
9. scheduler implementation
10. Cron runtime verification
```

## 6. Non-Regression Rule

This decision must not cause:

```text
second archive catalog
new queue
new lifecycle state
prediction truth mutation
Historical Backfill changes
7-Day Rolling changes
provider/Redis access from PostgreSQL
```

The project remains on the existing Group 10 architecture and deployment path.
