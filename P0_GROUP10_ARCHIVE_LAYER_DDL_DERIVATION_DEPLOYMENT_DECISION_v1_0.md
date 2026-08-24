# ZAHRLY — P0 Group 10 Archive Layer DDL Derivation / Deployment Decision v1.0

**Date:** 24 August 2026  
**Status:** DDL Derivation Decision — Deployment Still Gated  
**Scope:** Archive Layer only; `archive_scheduler` remains downstream and blocked.

## 1. Decision

The project uses the same derivation pattern established by the earlier P0 DDL decisions: architectural contracts may be converted into an authoritative migration only after an explicit derivation decision, and the resulting migration becomes authoritative only after its Gate passes.

For the Archive Layer, the available source set supports a **partial DDL derivation** but does not yet support full runtime implementation.

## 2. Source-derivable objects

The older `Zahrly_Supabase_Starter_Migration_v1_1.sql` contains executable DDL for:

```text
internal.archive_catalog
internal.archive_completeness_rules
```

The source material also describes the Archive concept as:

```text
archive_manifests / archive_catalog
```

and provides lineage/completeness fields and constraints.

Therefore these two tables are **DDL-derivable** from the documented source set, subject to the exact v1.1 definitions being copied without undocumented additions.

No second archive-manifest table may be introduced.

## 3. What is NOT derivable yet

The source set does not provide an executable definition for:

```text
internal.archive_season(...)
```

The Architecture defines it only as an admin/worker contract for writing manifests and archive metadata. Its exact argument list and body are not authoritative.

The source set also does not define an authoritative archive execution path:

```text
archive_scheduler → ? → archive worker
```

The canonical queue set does not contain `archive_queue`, so no queue substitution may be inferred.

The following remain blocked:

```text
archive_season() signature/body
archive execution path
retention predicate
archive eligibility predicate
archive-artifact identity/idempotency formula
```

## 4. DDL derivation boundary

The derived migration, once separately authorized, may contain only:

```text
internal.archive_catalog
internal.archive_completeness_rules
```

plus only the exact indexes/constraints that are present in the authoritative source definition.

It must NOT add:

```text
archive_scheduler
archive_queue
archive_season()
retention logic
eligibility logic
new archive states
new worker semantics
```

## 5. Completeness boundary

`internal.archive_completeness_rules` is a policy registry, not an archive trigger.

Completeness must remain a prerequisite separate from retention/eligibility. The DDL derivation must not convert completeness thresholds into an automatic archive-after rule.

## 6. Immutability boundary

The Archive Layer must preserve:

```text
prediction_baselines
canonical prediction truth
historical source required for audit/model replay
```

No archive DDL may weaken the existing immutable-baseline protections.

## 7. Execution and worker boundary

The Architecture requires the scheduler to remain short and control-plane oriented, with long-running archive work executed by a worker. Because the worker contract is not yet authoritative, this decision does not create or alter worker jobs/queues.

## 8. Idempotency boundary

Existing:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

remains available infrastructure. This decision does not invent an archive-artifact uniqueness formula.

## 9. Security boundary

Any future Archive RPC must remain private/internal and follow the existing least-privilege model. This DDL derivation does not add public execution grants or a new security-definer path.

## 10. Dependency order

The derived Archive tables must be deployed only after existing Group 10 state is intact and without changing:

```text
rolling_fixture_dispatch
queue_recovery
provider_health
Historical Backfill
7-Day Rolling
prediction_baselines
```

## 11. Gate conditions before migration application

Before applying any Archive DDL migration, verify:

1. the exact v1.1 table definitions are available and unchanged;
2. the migration is placed in the project-approved deployment path;
3. dependency ordering is explicit;
4. RLS/grants are reviewed;
5. indexes/constraints are preserved exactly;
6. rollback/idempotency are reviewed;
7. the resulting live schema will be checked for parity.

## 12. Final matrix

| Area | Status |
|---|---|
| `internal.archive_catalog` DDL | ✅ Derivable |
| `internal.archive_completeness_rules` DDL | ✅ Derivable |
| `archive_season()` executable implementation | ⛔ Blocked |
| Archive execution path | ⛔ Blocked |
| Retention policy | ⛔ Separate policy decision |
| Eligibility predicate | ⛔ Separate policy decision |
| Archive artifact identity | ⛔ Blocked |
| `archive_queue` | ❌ Not authorized |
| `archive_scheduler` Cron | ❌ Not authorized |
| Live Archive deployment | ❌ Not yet authorized |

## 13. Final decision

This document **authorizes derivation work only** for the two source-defined Archive tables. It does not authorize applying a migration to Supabase yet.

The next artifact, after verification of the exact v1.1 DDL and deployment path, may be the authoritative Archive Layer migration containing only:

```text
internal.archive_catalog
internal.archive_completeness_rules
```

After that migration passes its Gate and live-schema verification, the project must separately resolve `archive_season()` and the archive execution path before `archive_scheduler` can be implemented.

**No Supabase mutation is authorized by this decision alone.**
