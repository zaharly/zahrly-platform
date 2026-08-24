# ZAHRLY — P0 Group 10 Archive Live Runtime Reconciliation v1.0

**Date:** 24 August 2026  
**Status:** LIVE RUNTIME RECONCILED — Archive execution is deployed and operational evidence is present; remaining items are test-coverage gates, not deployment blockers.  
**Scope:** Group 10 Archive Layer / execution / scheduler

## 1. Purpose

This document supersedes any earlier classification that treated the Archive Layer or `archive_scheduler` as absent/deployment-blocked when the live Supabase state already contained and executed them.

The authoritative evidence source for deployed state is the live Supabase project `qosvqlwkexrhswcuakib`, together with its remote migration history and runtime evidence.

## 2. Live migration provenance

The live migration history contains the complete Archive implementation sequence, including:

```text
p0_group10_archive_layer_ddl_foundation_v1
p0_group10_archive_team_set_hash_reconciliation_v1
p0_group10_archive_season_registration_v1
p0_group10_archive_campaign_dispatch_contract_v1
p0_group10_archive_season_campaign_finalize_v1
p0_group10_archive_scheduler_cron_v1
p0_group10_archive_identity_team_set_hash_v1
p0_group10_archive_season_registration_v1
p0_group10_archive_season_remove_redundant_overload_v1
p0_group10_remove_redundant_archive_identity_index_v1
```

Therefore these are **deployed authoritative state**, not pending design objects.

## 3. Live Archive schema

The live `internal` schema contains:

```text
internal.archive_catalog                 ✅
internal.archive_completeness_rules      ✅
internal.archive_campaigns               ✅
internal.worker_jobs                     ✅
```

`archive_campaigns` explicitly documents that S3 artifact creation is owned by the Archive Campaign/Worker while PostgreSQL stores control state and manifest lineage.

The live `archive_catalog_artifact_identity_key` is:

```text
UNIQUE (
  country_id,
  competition_id,
  season,
  dataset_type,
  provider,
  schema_version,
  date_start,
  date_end,
  team_set_hash,
  checksum
)
```

`worker_jobs.idempotency_key` is also unique.

## 4. Live executable contracts

### `internal.archive_season()`

The live deployed signature is:

```sql
internal.archive_season(
  p_country_id uuid,
  p_competition_id uuid,
  p_season integer,
  p_dataset_type text,
  p_provider text,
  p_date_start timestamptz,
  p_date_end timestamptz,
  p_team_set_hash text,
  p_object_uri text,
  p_checksum text,
  p_row_count bigint,
  p_completeness_score numeric,
  p_schema_version text
) returns uuid
```

The live function is `SECURITY INVOKER`. It validates campaign scope/completeness, registers the archive manifest in `archive_catalog`, uses the existing artifact identity constraint for idempotent registration, and finalizes the related campaign/worker job state. It does **not** create the S3 object.

### `internal.dispatch_archive_campaign(uuid)`

The live dispatch contract is:

```text
campaign_id
    → worker_jobs
    → queue_name = archive_campaign
    → idempotency_key = archive-campaign:<campaign_id>
```

No `archive_queue` was introduced.

## 5. Live eligibility predicate

The deployed `internal.archive_scheduler()` currently selects campaigns where:

```text
scope_state = 'ARCHIVE_ONLY'
status IN ('READY', 'FAILED')
next_retry_at IS NULL OR next_retry_at <= now()
completeness_score IS NOT NULL
completeness_score >= applicable archive_completeness_rules.required_threshold
```

and where `dataset_type` is one of:

```text
odds_snapshots
provider_snapshots
evaluation_metrics
```

This is now a **live executable predicate**, not a missing design rule.

There is no universal season-age or `retention_days` rule in the deployed scheduler.

## 6. Live scheduler / Cron

The live `pg_cron` job is:

```text
jobid   = 19
jobname = archive-scheduler
schedule = 0 19 * * *
command = select internal.archive_scheduler();
active = true
```

This means the earlier documentation value of `0 3 * * *` is stale and must not be used as the current runtime truth. The authoritative current value is `0 19 * * *` in the database timezone context.

Runtime evidence shows successful executions:

```text
2026-08-24 19:00:00 UTC  → succeeded
2026-08-24 18:25:00 UTC  → succeeded
```

## 7. Positive live E2E evidence

A real live campaign exists with:

```text
status                    = SUCCEEDED
scope_state               = ARCHIVE_ONLY
dataset_type              = evaluation_metrics
completeness_score        = 0.99
completeness_policy       = e2e-20260824
worker_job_id             = bb9f5f04-7f32-4469-97f7-a847d985a33f
manifest_id               = eb7cf3d7-e411-4aa0-91d6-27bdbed7f1d1
object_uri                = s3://zahrly-e2e-test/archive/2025/evaluation_metrics.jsonl
checksum                  = e2e-sha256-archive-test
row_count                 = 1
team_set_hash             = e2e-teamset-v1
schema_version            = e2e-schema-v1
finished_at               = 2026-08-24 18:26:06.722053+00
```

The corresponding worker job is:

```text
queue_name      = archive_campaign
status          = SUCCEEDED
idempotency_key = archive-campaign:c2cff031-17ce-44dd-a9b7-6d1d1709b36b
finished_at     = 2026-08-24 18:26:06.722053+00
```

The corresponding `archive_catalog` manifest exists with the same S3 URI, checksum, row count, completeness score, season, dataset type, scope dates, team-set hash, and schema version.

This is sufficient to classify the deployed path as **operationally exercised end-to-end at the control/database boundary**.

## 8. Evidence classification

| Component | Current state |
|---|---|
| Archive metadata foundation | **DEPLOYED** |
| Archive campaign control state | **DEPLOYED** |
| `archive_season()` | **DEPLOYED** |
| Archive dispatch | **DEPLOYED + E2E exercised** |
| `worker_jobs` idempotency | **DEPLOYED + exercised** |
| AWS S3 object URI registration | **E2E evidenced via successful campaign/catalog lineage** |
| `archive_scheduler()` | **DEPLOYED** |
| pg_cron schedule | **DEPLOYED + successful runtime evidence** |
| Archive eligibility predicate | **DEPLOYED** |
| Universal retention policy | **NOT INTRODUCED / intentionally separate** |
| Same-artifact replay test | **TEST GATE REMAINS** |
| Changed-checksum lineage test | **TEST GATE REMAINS** |
| Failure/rollback cleanup test | **TEST GATE REMAINS** |

## 9. Governance correction

The following statements are now obsolete and must not be used as current-state classifications:

```text
Archive Layer = not deployed
archive_season() = signature unresolved
archive_scheduler = blocked
archive_queue = required
Cron = blocked
```

The correct classification is:

```text
Archive Layer           = DEPLOYED
Execution contract      = DEPLOYED
Campaign dispatch       = DEPLOYED
Scheduler               = DEPLOYED
Cron                    = ACTIVE
Runtime positive path   = EVIDENCED
Remaining work          = targeted idempotency/replay/failure tests
```

## 10. Non-regression

This reconciliation does not authorize any new schema redesign, queue, retention shortcut, or change to Historical Bootstrap, 7-Day Rolling, prediction truth, `prediction_baselines`, `rolling_fixture_dispatch`, `queue_recovery`, or `provider_health`.

It only updates project-state classification to match the live deployed state.
