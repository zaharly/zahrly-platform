# ZAHRLY — P0 Group 10 Archive Execution Definition Project Decision v1.0

**Date:** 24 August 2026  
**Status:** Project Decision — **Implementation Remains Gated**  
**Scope:** `internal.archive_season(...)` contract, execution path, retention/eligibility ownership, archive-artifact identity, and deployment order

## 1. Purpose

This decision defines the authority model for the four remaining Archive execution gaps. It does not invent values that are absent from the authoritative project sources.

The deployed metadata foundation remains authoritative:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
```

The execution layer remains separate from metadata/lineage.

## 2. Authority Matrix

| Area | Authoritative source required | Current state |
|---|---|---|
| `archive_season()` signature | live `pg_proc`, approved migration, or approved worker contract | ⛔ missing |
| Execution path | approved worker/execution contract | ⛔ missing |
| Retention / eligibility | dataset-specific approved policy source | ⛔ missing |
| Archive artifact identity | approved lineage/idempotency contract | ⛔ missing |
| Metadata foundation | approved Group 10 DDL derivation + live migration | ✅ resolved |
| Security/grants | approved implementation migration + live verification | ⏸ gated with execution layer |

## 3. `archive_season()` Contract Authority

The architecture currently names:

```text
internal.archive_season(...)
```

as an admin/worker operation for writing archive manifests and metadata, but does not provide an executable parameter/return signature.

Therefore no default parameters, return type, or invocation convention is selected by inference.

The function may be implemented only after one authoritative source defines:

```text
signature
return/result semantics
caller identity
error semantics
transaction boundary
```

## 4. Execution Path Authority

The canonical queue set does not contain `archive_queue`.

Therefore no path is selected by inference among:

```text
scheduler → archive_queue
scheduler → control_queue
scheduler → worker_jobs directly
scheduler → another existing queue
```

The authoritative execution source must explicitly identify:

```text
who discovers archive work
who creates the durable work item
which worker consumes it
how retry/lease/DLQ semantics are inherited
```

Until that exists, scheduler-to-worker execution remains blocked.

## 5. Retention / Eligibility Authority

Retention and eligibility are dataset-aware. Completeness is a prerequisite but is not itself a retention decision.

No universal rule is authorized by inference, including:

```text
season age cutoff
kickoff age cutoff
retention_days
archive_after
current_season - N
```

The authoritative policy must identify for each archivable dataset type:

```text
candidate scope
completeness prerequisite
retention/eligibility owner
never-delete exclusions
final archival trigger
```

Until then, no scheduler SQL may contain a temporal archive predicate.

## 6. Archive Artifact Identity / Idempotency Authority

Existing infrastructure provides:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

This is a worker-job deduplication mechanism only.

It does not define archive-artifact identity.

The authoritative artifact contract must define the logical identity and deduplication boundary, for example by explicitly specifying which lineage dimensions participate in uniqueness. No hash or uniqueness constraint is inferred here.

The implementation must preserve the distinction:

```text
worker-job idempotency
≠
archive-artifact identity
≠
provider-request idempotency
≠
prediction-job idempotency
```

## 7. Explicit Exclusions

This decision does not authorize:

```text
archive_queue
archive_scheduler
pg_cron
new archive state
universal retention rule
new archive hash
partition deletion
source deletion
changes to prediction truth
changes to Historical Bootstrap
changes to 7-Day Rolling
provider calls from PostgreSQL
Redis calls from PostgreSQL
```

## 8. Deployment Order

Once the four authority inputs become source-exact, deployment must proceed in this order:

```text
1. Execution Definition approval
        ↓
2. Authoritative function/worker implementation artifact
        ↓
3. Migration review
        ↓
4. Apply migration
        ↓
5. Live schema/function/grant parity
        ↓
6. Worker integration
        ↓
7. Transactional + idempotency + retry tests
        ↓
8. Archive Scheduler decision
        ↓
9. Scheduler implementation
        ↓
10. Cron runtime verification
```

The existing metadata foundation is not repeated or redesigned in this sequence.

## 9. Implementation Gate

Implementation is authorized only when all of the following are authoritative:

```text
✅ exact function signature
✅ execution path
✅ dataset-specific retention/eligibility policy
✅ archive-artifact identity
✅ final security/grant contract
```

Current status:

```text
Metadata foundation          ✅
Execution definition         ⛔ pending authoritative inputs
Function migration           ⛔
Worker integration           ⛔
Scheduler                    ⛔
Cron                         ⛔
```

## 10. Non-Regression Rule

This decision must not cause a second Archive schema, queue, or lifecycle state to appear merely to support implementation convenience.

The project remains on the existing architecture and deployment path.
