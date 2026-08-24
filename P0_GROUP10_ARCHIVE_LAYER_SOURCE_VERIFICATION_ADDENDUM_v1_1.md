# ZAHRLY — P0 Group 10 Archive Layer Source Verification Addendum v1.1

**Date:** 24 August 2026  
**Branch:** `p0/group10-archive-layer-authoritative-artifact`  
**Status:** Source Verification — Deployment Remains Blocked

## 1. Correction to Earlier Assumption

A literal search of the Library copy of `Zahrly_Supabase_Starter_Migration_v1_3.sql` for:

```text
archive_catalog
archive_completeness_rules
archive_season
```

returned no matches.

Therefore the Starter Migration v1.3 must **not** be described as containing executable definitions for these Archive objects.

## 2. What the Source Actually Establishes

The Architecture/Blueprint defines the Archive concept and the RPC contract:

```text
archive_manifests / archive_catalog concept
internal.archive_season(...)  → admin/worker archive operation
```

The Group 10 decisions also preserve the dataset-aware, non-destructive boundary and explicitly keep retention, eligibility, execution path, and archive-artifact identity unresolved when source-exact evidence is absent.

The queue design lists:

```text
control_queue
backfill_queue
fixture_queue
odds_queue
enrichment_queue
prediction_queue
repair_queue
evaluation_queue
model_training_queue
```

and does not define an `archive_queue`.

## 3. Live Deployment Evidence

The live Supabase migration history and schema currently contain no deployed:

```text
internal.archive_catalog
internal.archive_completeness_rules
internal.archive_season(...)
archive_scheduler Cron
```

`internal.worker_jobs.idempotency_key` remains deployed and unique, but this is only worker-job infrastructure and does not define Archive artifact identity.

## 4. Result

There is currently **no source-exact authoritative Archive deployment migration** in the reviewed project materials.

Therefore this repository branch intentionally does NOT add:

```text
supabase/migrations/*archive*
CREATE TABLE internal.archive_catalog
CREATE TABLE internal.archive_completeness_rules
CREATE FUNCTION internal.archive_season
archive_queue
archive_scheduler
retention predicates
archive eligibility SQL
archive artifact hash/uniqueness
```

## 5. Required Next Artifact

Before Archive Layer deployment, the project must supply an explicit authoritative implementation source that defines, at minimum:

```text
canonical archive tables/constraints
exact archive_season() signature
archive worker/execution path
retention/eligibility ownership
archive artifact identity
security grants
migration/deployment order
```

Only then may an actual Supabase migration be authored and applied.

## 6. Non-Regression

This addendum does not change:

```text
fixtures.status
rolling_fixture_dispatch
queue_recovery
provider_health
Historical Backfill
7-Day Rolling
prediction_baselines
existing queue set
```

No Supabase mutation is performed by this file.
