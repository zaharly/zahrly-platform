# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026
**Status:** AUTHORIZED IMPLEMENTATION BASELINE — LIVE RUNTIME RECONCILED; targeted test gates remain
**Scope:** Archive execution path only

## 1. Authority

This decision reconciles the latest Group 10 architecture decisions with the currently deployed Zahrly Supabase state.

The authoritative execution storage decision is:

```text
Archive artifact creation/storage = AWS S3
Archive execution owner          = Archive Campaign / Archive Worker
PostgreSQL                       = control state + manifest/lineage registration
```

No `archive_queue`, direct Cron-to-S3 path, provider call, or Redis call from PostgreSQL is authorized.

## 2. Authoritative execution path

```text
internal.archive_scheduler()
        ↓
internal.dispatch_archive_campaign(campaign_id)
        ↓
internal.worker_jobs
        ↓
Archive Campaign / Worker
        ↓
AWS S3 archive artifact
        ↓
internal.archive_season(...)
        ↓
internal.archive_catalog
```

The live `internal.archive_campaigns` table explicitly records Campaign/Worker ownership of S3 artifact creation and PostgreSQL ownership of control/lineage state.

## 3. Authoritative `archive_season()` signature

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

Live state: `SECURITY INVOKER`. The function registers the manifest/idempotent DB lineage and does not create the S3 object.

## 4. Authoritative archive-artifact identity

The live database constraint is:

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

Constraint name:

```text
archive_catalog_artifact_identity_key
```

Worker-job duplication is protected by `internal.worker_jobs.idempotency_key UNIQUE`, with:

```text
archive-campaign:<campaign_id>
```

## 5. Authoritative live eligibility

`internal.archive_scheduler()` currently selects:

```text
scope_state = ARCHIVE_ONLY
status IN ('READY','FAILED')
next_retry_at IS NULL OR next_retry_at <= now()
completeness_score IS NOT NULL
completeness_score >= archive_completeness_rules.required_threshold
dataset_type IN ('odds_snapshots','provider_snapshots','evaluation_metrics')
```

There is no universal season-age or `retention_days` rule. Hot-table deletion/partition removal remains a separate retention lifecycle.

## 6. Deployment provenance

The live migration history contains the Archive implementation sequence:

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

The Archive execution layer is therefore deployed and authoritative. No duplicate migration is required.

## 7. Live Cron evidence

```text
jobid    = 19
jobname  = archive-scheduler
schedule = 0 19 * * *
command  = select internal.archive_scheduler();
active   = true
```

Recent successful runs were observed at:

```text
2026-08-24 19:00:00 UTC
2026-08-24 18:25:00 UTC
```

## 8. Positive live E2E evidence

A live campaign completed successfully:

```text
campaign_id              = c2cff031-17ce-44dd-a9b7-6d1d1709b36b
status                   = SUCCEEDED
scope_state              = ARCHIVE_ONLY
dataset_type             = evaluation_metrics
completeness_score       = 0.99
completeness_policy      = e2e-20260824
worker_job_id            = bb9f5f04-7f32-4469-97f7-a847d985a33f
manifest_id              = eb7cf3d7-e411-4aa0-91d6-27bdbed7f1d1
object_uri               = s3://zahrly-e2e-test/archive/2025/evaluation_metrics.jsonl
checksum                 = e2e-sha256-archive-test
row_count                = 1
finished_at              = 2026-08-24 18:26:06.722053+00
```

The corresponding worker job completed successfully with:

```text
queue_name      = archive_campaign
status          = SUCCEEDED
idempotency_key = archive-campaign:c2cff031-17ce-44dd-a9b7-6d1d1709b36b
```

The corresponding `archive_catalog` manifest exists with matching lineage and S3 URI/checksum metadata.

This is positive control/database-boundary E2E evidence. It does not claim a direct external S3 HEAD check.

## 9. Remaining verification gates

The Archive execution path is **not deployment-blocked**. Remaining work is verification coverage only:

```text
same-artifact replay/idempotency test
changed-checksum new-lineage test
failure/rollback cleanup test
```

These tests must not trigger schema redesign or a new transport mechanism unless a real defect is found.

## 10. Non-regression

This authorization does not change:

```text
Historical Bootstrap
7-Day Rolling
rolling_fixture_dispatch
queue_recovery
provider_health
prediction truth
prediction_baselines
existing canonical queue set
```

It does not authorize:

```text
archive_queue
second archive catalog
universal retention rule
new archive state
new artifact hash
```
