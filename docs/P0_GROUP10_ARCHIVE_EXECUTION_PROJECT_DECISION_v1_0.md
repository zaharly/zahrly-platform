# ZAHRLY — P0 Group 10 Archive Execution Project Decision v1.1

**Date:** 24 August 2026  
**Status:** Project Decision — **Implementation Remains Gated**  
**Scope:** `internal.archive_season(...)`, archive execution path, retention/eligibility, and archive-artifact identity

## 1. Purpose

This decision records the authoritative project input state after direct repository and live-schema discovery.

The decision is intentionally narrow. It does not redesign the Archive metadata foundation, create a new queue, or authorize Cron.

## 2. Authoritative Input Result

The current project has authoritative support for the Archive metadata foundation only:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
```

The repository and live database do **not** currently provide source-exact definitions for:

```text
internal.archive_season(...) signature
archive worker implementation
scheduler -> worker execution adapter
retention / eligibility policy
archive-artifact identity / uniqueness contract
archive_queue
```

Therefore no missing execution value is silently filled in.

## 3. Decision A — Function Signature

**Input status:** `NOT PROVIDED BY AUTHORITATIVE SOURCE`

The architecture names:

```text
internal.archive_season(...)
```

but no authoritative parameter list, return contract, or deployed implementation exists.

Recorded input:

```text
signature = UNDEFINED
```

Required next input must be one of:

```text
live pg_proc definition
approved migration
approved worker contract
approved implementation specification
```

No SQL function is created from this decision.

## 4. Decision B — Retention / Eligibility

**Input status:** `NOT PROVIDED BY AUTHORITATIVE SOURCE`

The Archive architecture is dataset-aware and does not define a universal temporal rule.

Recorded input:

```text
retention predicate = UNDEFINED
eligibility predicate = UNDEFINED
```

The following are explicitly rejected as unapproved invention:

```text
season < current_season - 1
kickoff older than X days
archive_after = X
retention_days = X
```

Completeness remains a prerequisite where the canonical policy applies, but completeness does not by itself create retention eligibility.

## 5. Decision C — Archive Artifact Identity / Idempotency

**Input status:** `PARTIALLY RESOLVED`

Existing infrastructure provides:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

Recorded input:

```text
worker-job deduplication = AVAILABLE
archive-artifact identity = UNDEFINED
```

No archive-specific hash or uniqueness formula is introduced.

## 6. Decision D — Archive Execution Path

**Input status:** `NOT PROVIDED BY AUTHORITATIVE SOURCE`

The canonical queue set does not include:

```text
archive_queue
```

Recorded input:

```text
scheduler -> worker path = UNDEFINED
```

The project therefore does not authorize by inference:

```text
archive_scheduler -> archive_queue
archive_scheduler -> control_queue
archive_scheduler -> worker_jobs directly
```

The source only establishes that archive work belongs at the admin/worker boundary.

## 7. Security Boundary

The following remains authoritative:

```text
internal schema
    ↓
worker/admin identity
    ↓
archive writes
```

No public browser execution is authorized.

No provider or Redis calls belong in PostgreSQL Cron.

Prefer `SECURITY INVOKER`; `SECURITY DEFINER` requires a later least-privilege decision if actually necessary.

## 8. Non-Regression Rules

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

## 9. Implementation Gate

Function implementation remains blocked until the project has an authoritative input for:

```text
1. exact function signature
2. scheduler/worker execution path
3. dataset-specific retention / eligibility policy
4. archive-artifact identity / uniqueness semantics
5. final security/grant contract
```

Then the only permitted sequence is:

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

## 10. Current Gate

```text
Archive metadata foundation      ✅ DEPLOYED
Completeness policy foundation   ✅ DEPLOYED
Worker-job idempotency           ✅ EXISTS
Worker safety boundary           ✅ RESOLVED

Function signature               ⛔ UNDEFINED
Retention/eligibility            ⛔ UNDEFINED
Archive artifact identity        ⛔ UNDEFINED
Execution path                   ⛔ UNDEFINED
Archive worker                   ⛔ BLOCKED
Archive scheduler                ⛔ BLOCKED
Cron                             ⛔ BLOCKED
```

**No SQL function, queue, worker, scheduler, or Cron is authorized by this decision alone.**

## 11. Required Future Input

The project now has a precise input contract. The next source/decision artifact must define the four unresolved execution values above. Until that happens, the correct state is **implementation-gated** and the current Archive metadata foundation remains unchanged.
