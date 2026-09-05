# ZAHRLY — P0 Group 10 Archive Layer Authoritative Implementation Artifact v1.0

**Date:** 24 August 2026  
**Branch:** `p0/group10-archive-layer-authoritative-artifact`  
**Status:** Proposed authoritative implementation artifact — **deployment gated**  
**Scope:** Archive Layer only; `archive_scheduler` is downstream and remains blocked.

## 1. Purpose

This artifact converts the approved Archive architecture into a deployment-governance contract without inventing missing runtime behavior.

It is intentionally **not** a Supabase migration. It does not create tables, functions, queues, Cron jobs, retention rules, or archive eligibility predicates.

## 2. Current Authoritative Facts

The project architecture establishes:

```text
Archive Layer
    ├── archive manifest/catalog lineage
    ├── completeness policy
    ├── archive metadata / checksum / object URI
    ├── immutable prediction-baseline protection
    └── worker/admin execution boundary
```

The live Supabase project currently contains Group 10 operational infrastructure, including `internal.worker_jobs` with a unique `idempotency_key`, but the Archive Layer itself is not deployed.

The current GitHub repository also does not contain an authoritative Supabase migration deployment path for this Archive Layer.

## 3. Canonical Object Mapping

The architecture concept:

```text
archive_manifests
```

maps to the intended implementation object:

```text
internal.archive_catalog
```

**Important:** this mapping becomes authoritative only when the Archive Layer deployment artifact is approved and deployed. No second `archive_manifests` table may be introduced.

The intended completeness policy object is:

```text
internal.archive_completeness_rules
```

## 4. Archive Function Contract

The architecture names:

```text
internal.archive_season(...)
```

as an admin/worker archive operation for writing manifest/archive metadata.

The exact executable signature is **not yet authoritative** and must not be invented here.

Therefore this artifact records:

```text
function name       = known
execution owner     = admin/worker boundary
exact signature     = BLOCKED
```

## 5. Archive Execution Path

No `archive_queue` is part of the canonical queue set.

Accordingly, this artifact deliberately does **not** select among:

```text
archive_queue
control_queue
worker_jobs direct dispatch
```

The authoritative archive execution path must be supplied by a later approved worker/deployment contract.

```text
archive_scheduler → ? → archive worker
```

remains unresolved and is not implemented here.

## 6. Completeness

Archive completeness must use the project's canonical completeness policy when deployed.

Completeness is a prerequisite only. It is **not** equivalent to retention eligibility.

No new archive-specific threshold is introduced by this artifact.

## 7. Retention and Eligibility

No universal rule such as:

```text
season < current_season - X
```

or:

```text
older than X days
```

is authorized.

Retention remains dataset-specific.

Archive eligibility remains a separate downstream policy decision.

## 8. Immutability / Never-Delete Boundary

The Archive Layer must never delete or corrupt:

```text
prediction_baselines
historical source required for audit
historical source required for model replay
canonical prediction truth
```

Archiving is a cold-storage optimization and must remain non-destructive to canonical truth.

## 9. Idempotency

Existing infrastructure:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

may protect duplicate archive **worker jobs** once an authoritative archive job identity exists.

This artifact does not invent an archive-artifact hash or uniqueness formula.

Therefore:

```text
worker-job idempotency infrastructure   = available
archive-artifact identity                = BLOCKED
```

## 10. Security Boundary

Archive mutation functions must remain private/internal.

Required baseline:

```text
PUBLIC           = no execution
anon             = no execution
authenticated    = no execution
internal/admin/worker role = explicit least-privilege execution
```

Prefer `SECURITY INVOKER` unless an approved archive implementation proves that a `SECURITY DEFINER` boundary is required.

No public API path is introduced.

## 11. Deployment Preconditions

No Archive Layer deployment may occur until all of the following are explicitly identified:

1. authoritative migration/implementation artifact;
2. exact canonical archive tables and constraints;
3. exact `internal.archive_season()` signature;
4. archive execution path / worker contract;
5. dataset-specific retention/eligibility ownership;
6. archive artifact idempotency identity;
7. dependency order relative to existing Group 10 state;
8. live-schema verification plan.

## 12. Non-Regression Rules

The Archive Layer deployment must not modify:

```text
fixtures.status
fixture lifecycle
rolling_fixture_dispatch
queue_recovery
provider_health
Historical Backfill behavior
7-Day Rolling behavior
prediction_baselines semantics
```

It must not add:

```text
archive_queue
second manifest table
new provider path
Redis dependency
new prediction lifecycle
```

unless a later source-authorized decision explicitly requires it.

## 13. Deployment Verification

After an authoritative implementation artifact is approved and deployed, verify:

```text
migration history
    ↓
archive tables
    ↓
archive function signature
    ↓
RLS / grants
    ↓
indexes / uniqueness
    ↓
worker execution path
```

Live state must match the authoritative migration exactly before `archive_scheduler` is considered for implementation.

## 14. Gate Status

```text
Archive architecture                  ✅
Canonical object mapping              ✅ at design level
Completeness concept                  ✅
Immutability boundary                 ✅
Worker-job idempotency infrastructure ✅

Authoritative deployment migration    ⛔
Exact archive_season signature         ⛔
Archive execution path                ⛔
Retention/eligibility policy           ⛔
Archive artifact identity              ⛔

Archive Layer deployment              ⛔ BLOCKED
archive_scheduler                     ⛔ BLOCKED
```

## 15. Next Approval

This artifact is intended to be reviewed/approved before any Archive Layer deployment.

After approval, the next artifact must be an **authoritative deployment migration/implementation** that contains only source-approved objects and behavior. That migration is then applied to Supabase, verified against the live schema, and only then can the Archive Scheduler implementation begin.

**No Supabase mutation is authorized by this file alone.**
