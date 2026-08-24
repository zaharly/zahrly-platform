# ZAHRLY — P0 Group 10 Archive Authoritative Execution Input v1.0

**Date:** 24 August 2026  
**Status:** INPUT PACKAGE — awaiting authoritative values  
**Scope:** Define exactly what must be supplied before `internal.archive_season(...)` implementation is authorized

## 1. Purpose

The current project sources establish the Archive metadata foundation and the worker/control-plane boundary, but the repository does not contain authoritative executable definitions for four remaining items.

This document is intentionally an input package, not an implementation. It contains no invented business values.

## 2. Required Authoritative Inputs

### A. `internal.archive_season(...)` contract

Provide one authoritative source defining:

```text
exact parameter list
parameter types
return/result semantics
caller identity
transaction boundary
error/result contract
```

Accepted authorities:

```text
approved migration
approved worker contract
approved implementation specification
live deployed `pg_proc` definition
```

### B. Archive execution path

Provide one authoritative source defining:

```text
who discovers archive work
who creates the durable job
who executes the archive operation
how retry/lease/DLQ semantics are applied
```

The source must explicitly identify the existing mechanism used. It must not be inferred as:

```text
archive_queue
control_queue
worker_jobs-direct shortcut
```

### C. Retention / eligibility policy

Provide an authoritative dataset-aware policy defining:

```text
data-type ownership
candidate conditions
completeness prerequisite
retention trigger
never-delete exclusions
hot-data removal boundary
```

A single universal season-age rule is not accepted unless explicitly authorized by project policy.

### D. Archive artifact identity

Provide an authoritative identity contract defining:

```text
logical archive artifact identity
uniqueness boundary
replay/deduplication semantics
relationship to worker_jobs.idempotency_key
```

The existing worker-job idempotency key must not automatically be reused as archive-artifact identity.

## 3. Current Source-Backed State

```text
internal.archive_catalog             ✅ deployed
internal.archive_completeness_rules  ✅ deployed
worker_jobs.idempotency_key UNIQUE   ✅ deployed

archive_season() signature            ⛔ input required
execution path                        ⛔ input required
retention/eligibility                 ⛔ input required
artifact identity                     ⛔ input required
```

## 4. Explicit Non-Goals

This input package does not authorize:

```text
archive_season() SQL function
archive worker code
archive_queue
reuse of an existing queue by assumption
retention_days / season cutoff guessing
new archive hash / uniqueness constraint
archive_scheduler
Cron
archive data movement
partition deletion
```

## 5. Implementation Gate

Once the four authoritative inputs are supplied and approved:

```text
Authoritative inputs
      ↓
Archive Execution Implementation Authorization
      ↓
function/worker implementation
      ↓
live verification
      ↓
transactional + idempotency tests
      ↓
Archive Scheduler Decision
      ↓
Cron runtime gate
```

No implementation is authorized until all four inputs are source-exact.
