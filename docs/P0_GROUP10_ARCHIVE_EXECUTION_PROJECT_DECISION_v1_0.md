# ZAHRLY — P0 Group 10 Archive Execution Project Decision v1.0

**Date:** 24 August 2026  
**Status:** Project Decision — **Implementation Remains Gated**  
**Scope:** `internal.archive_season(...)`, archive execution path, retention/eligibility, and archive-artifact identity

## 1. Purpose

This decision resolves the provenance question for the four remaining Archive execution gaps without inventing hidden business behavior.

The decision is intentionally narrow. It does not redesign the Archive metadata foundation, create a new queue, or authorize Cron.

## 2. Authoritative Source Result

The reviewed project repository currently provides no authoritative implementation for:

```text
internal.archive_season(...)
archive worker
archive execution adapter
retention policy
archive eligibility predicate
archive-artifact identity
archive_queue
```

The live database also has no deployed `internal.archive_season(...)` function and no archive-specific queue or Cron.

The existing execution-contract artifact therefore remains the governing boundary document rather than an implementation authorization.

## 3. Decision A — Function Signature

**Decision:** `BLOCKED / SOURCE REQUIRED`

The architecture names:

```text
internal.archive_season(...)
```

but does not provide an authoritative parameter list, return contract, or deployed implementation.

Therefore:

```text
No parameters are inferred.
No default signature is selected.
No SQL function is created.
```

An implementation may proceed only when one of the following becomes authoritative:

```text
live pg_proc definition
approved migration
approved worker contract
approved implementation specification
```

## 4. Decision B — Retention / Eligibility

**Decision:** `BLOCKED / POLICY REQUIRED`

The Archive architecture is dataset-aware and explicitly avoids a universal season-age rule.

The project therefore does not authorize any inferred rule such as:

```text
season < current_season - 1
kickoff older than X days
archive_after = X
retention_days = X
```

The only source-backed prerequisites remain:

```text
canonical archive/season scope is not blocked
AND
canonical completeness requirement is satisfied
AND
the dataset type is archivable under project policy
AND
the dataset is not protected by an immutable/never-delete rule
```

These prerequisites are necessary but are **not sufficient** to create an executable temporal eligibility predicate.

A dataset-specific retention/eligibility policy must be authoritative before scheduler SQL exists.

## 5. Decision C — Archive Artifact Identity / Idempotency

**Decision:** `PARTIALLY RESOLVED / IMPLEMENTATION BLOCKED`

Existing infrastructure provides:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

This may protect duplicate worker-job creation.

It does not define archive-artifact identity.

The architecture associates archive identity with lineage such as:

```text
dataset_type
season
scope
manifest lineage
```

but does not define a canonical unique database key or hash formula.

Therefore:

```text
worker-job deduplication      = available
archive-artifact identity     = unresolved
```

No new archive uniqueness constraint or hash is authorized by this decision.

## 6. Decision D — Archive Execution Path

**Decision:** `BLOCKED / EXECUTION CONTRACT REQUIRED`

The canonical project queue set does not include:

```text
archive_queue
```

The project therefore does not authorize by inference any of:

```text
archive_scheduler -> archive_queue
archive_scheduler -> control_queue
archive_scheduler -> worker_jobs directly
```

The Architecture places archive work at the worker boundary, but the concrete scheduler-to-worker dispatch mechanism is not source-exact.

Implementation remains blocked until the project supplies one authoritative execution path.

## 7. What Is Already Authoritative

The following remains valid and deployed:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
```

The archive metadata foundation is already verified in live Supabase.

No second `archive_manifests` table is authorized.

## 8. Security Boundary

Archive mutations remain internal/private:

```text
internal schema
    ↓
worker/admin identity
    ↓
archive writes
```

No public browser execution is authorized.

No provider or Redis calls belong in PostgreSQL Cron.

The function should prefer `SECURITY INVOKER`; `SECURITY DEFINER` requires an explicit least-privilege decision if later proven necessary.

## 9. Implementation Authorization Gate

The Archive execution implementation is **not authorized** until all of the following are source-exact:

```text
1. function signature
2. scheduler/worker execution path
3. dataset-specific retention / eligibility policy
4. archive-artifact identity / uniqueness semantics
5. final grants/security contract
```

Only then may the project proceed:

```text
execution decision
      ↓
function migration
      ↓
live signature verification
      ↓
worker integration
      ↓
transactional + idempotency tests
      ↓
Archive Scheduler decision
      ↓
Cron runtime verification
```

## 10. Non-Regression Rules

This decision does not authorize:

```text
- a new archive state
- a new queue
- a universal retention rule
- a new archive hash
- changes to prediction truth
- changes to Historical Bootstrap
- changes to 7-Day Rolling
- direct provider calls from SQL
- direct Redis calls from SQL
- deletion of immutable baseline/audit/replay source
```

## 11. Final Gate

```text
Archive metadata foundation      ✅ DEPLOYED
Completeness policy foundation   ✅ DEPLOYED
Worker-job idempotency           ✅ EXISTS
Worker safety boundary           ✅ RESOLVED

Function signature               ⛔ BLOCKED
Retention/eligibility            ⛔ BLOCKED
Archive artifact identity        ⛔ BLOCKED
Execution path                   ⛔ BLOCKED
Archive worker                   ⛔ BLOCKED
Archive scheduler                ⛔ BLOCKED
Cron                              ⛔ BLOCKED
```

**No SQL function, queue, worker, scheduler, or Cron is authorized by this decision alone.**

## 12. Required Future Input

To continue without architectural drift, provide or approve exactly one authoritative implementation source defining the missing execution contract. Until then, the correct state is **design-complete enough to prevent invention, but implementation-gated**.