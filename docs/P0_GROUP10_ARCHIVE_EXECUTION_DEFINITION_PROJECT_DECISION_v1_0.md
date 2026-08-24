# ZAHRLY — P0 Group 10 Archive Execution Definition / Project Decision v1.1

**Date:** 24 August 2026  
**Status:** Project Decision — **Implementation Gate Defined / Execution Inputs Still Required**  
**Scope:** Archive execution layer only

## 1. Purpose

This decision defines the final governance gate between the deployed Archive metadata foundation and the executable Archive layer. It defines the authority model for the four remaining execution inputs without inventing missing business behavior.

## 2. Current Authoritative State

Already deployed and verified:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
internal.worker_jobs.idempotency_key UNIQUE
```

Not deployed:

```text
internal.archive_season(...)
archive worker implementation
archive-specific queue
archive scheduler
archive Cron
```

The Architecture names `internal.archive_season(...)` as an admin/worker operation for writing archive manifests/metadata, but does not provide an executable parameter/return signature. The canonical queue set does not define `archive_queue`. fileciteturn271file0L1-L13

## 3. Authority Matrix

| Required input | Authoritative source | Current state |
|---|---|---|
| `archive_season()` signature | live `pg_proc`, approved migration, approved worker contract, or approved implementation spec | ⛔ missing |
| scheduler → worker execution path | approved worker/execution contract | ⛔ missing |
| dataset-specific retention / eligibility | approved policy source | ⛔ missing |
| archive artifact identity / uniqueness | approved lineage/idempotency contract | ⛔ missing |
| metadata foundation | approved DDL derivation + live migration | ✅ resolved |
| security/grants | implementation migration + live verification | ⏸ gated with execution |

## 4. Decision A — `archive_season()` Contract

The implementation must not infer parameters, return types, caller conventions, error semantics, or transaction boundaries from the function name alone.

Accepted authority:

```text
approved migration
OR approved worker/execution contract
OR approved implementation specification
OR live deployed definition
```

**Current decision:** `BLOCKED / AUTHORITY REQUIRED`

## 5. Decision B — Execution Path

The exact durable-work path must be explicit:

```text
scheduler/control plane
        ↓
approved queue/job mechanism
        ↓
archive worker
        ↓
archive artifact + catalog metadata
```

The project does not authorize by inference:

```text
scheduler → archive_queue
scheduler → control_queue
scheduler → worker_jobs directly
scheduler → another existing queue
```

The authoritative source must identify the discovery owner, durable work item owner, worker consumer, and inherited retry/lease/DLQ semantics.

**Current decision:** `BLOCKED / AUTHORITY REQUIRED`

## 6. Decision C — Retention / Eligibility

The rule must be dataset-specific and identify:

```text
candidate scope
completeness prerequisite
policy owner
never-archive / never-delete exclusions
final archival trigger
```

No universal rule is authorized by inference, including:

```text
retention_days = X
season < current_season - N
kickoff older than X
archive_after = X
```

Completeness remains a prerequisite and is not itself a temporal retention decision.

**Current decision:** `BLOCKED / POLICY AUTHORITY REQUIRED`

## 7. Decision D — Archive Artifact Identity

Existing infrastructure:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

This protects worker-job duplication only. It does not automatically define archive-artifact identity.

The authoritative artifact contract must define:

```text
logical identity
uniqueness boundary
deduplication/replay behavior
relation to worker_jobs.idempotency_key
```

The implementation must preserve:

```text
worker-job idempotency
≠ archive-artifact identity
≠ provider-request idempotency
≠ prediction-job idempotency
```

**Current decision:** `BLOCKED / AUTHORITY REQUIRED`

## 8. Explicit Exclusions

This decision does not authorize:

```text
archive_queue
archive_scheduler
pg_cron
new archive lifecycle state
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

## 9. Deployment Order

Once all four authority inputs become source-exact:

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

The deployed metadata foundation is not redesigned in this sequence.

## 10. Final Gate

```text
Archive metadata foundation     ✅ DEPLOYED
Execution-definition gate       ✅ DEFINED

Function signature              ⛔
Execution path                  ⛔
Retention/eligibility            ⛔
Artifact identity               ⛔

Function implementation         ⛔
Worker                           ⛔
Scheduler                        ⛔
Cron                             ⛔
```

This document defines the implementation gate; it does not supply the four missing values. Those values must arrive through one of the accepted authoritative sources above.

## 11. Non-Regression Rule

No second Archive schema, queue, lifecycle state, retention convention, or idempotency formula may be introduced merely to make implementation convenient. The project remains aligned with the existing architecture and deployment path.
