# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026
**Status:** AUTHORIZED IMPLEMENTATION BASELINE — LIVE RUNTIME RECONCILED; targeted test gates remain
**Scope:** Archive execution path only

## 1. Authority

This decision reconciles the latest Group 10 architecture decisions with the currently deployed Zahrly Supabase state.

The authoritative execution storage decision is:

```text
Archive artifact creation/storage
    = AWS S3

Archive execution owner
    = Archive Campaign / Archive Worker

PostgreSQL
    = control state + manifest/lineage registration
```

S3 is the durable archive-artifact store. Campaign/Archive Worker owns serialization/upload and retrieval/processing of the archive artifact. PostgreSQL must not perform bulk archive transfer.

This is now an implementation authority for Group 10 archive execution and must not be replaced by an `archive_queue`, direct Cron-to-S3 path, or provider/Redis call from PostgreSQL.

## 2. Authoritative execution path

The deployed and runtime-evidenced path is:

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

No `archive_queue` is introduced.

The live `internal.archive_campaigns` table explicitly records that S3 artifact creation is owned by the archive worker/campaign and that PostgreSQL stores control state and manifest lineage.

## 3. Authoritative `archive_season()` signature

The deployed live function is:

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

It is `SECURITY INVOKER` and performs DB-side manifest registration/idempotent replay. It does not create the S3 object.

## 4. Authoritative archive-artifact identity

The live database uniqueness boundary is:

```text
country_id
+ competition_id
+ season
+ dataset_type
+ provider
+ schema_version
+ date_start
+ date_end
+ team_set_hash
+ checksum
```

The live `archive_catalog_artifact_identity_key` constraint is authoritative. No additional archive uniqueness key or custom hash is authorized.

Worker-job duplication remains protected by:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

with the live archive dispatch convention:

```text
archive-campaign:<campaign_id>
```

## 5. Authoritative eligibility / retention boundary

The deployed `internal.archive_scheduler()` currently selects campaigns where:

```text
scope_state = ARCHIVE_ONLY
status IN ('READY','FAILED')
next_retry_at IS NULL OR next_retry_at <= now()
completeness_score IS NOT NULL
completeness_score >= applicable archive_completeness_rules.required_threshold
dataset_type IN ('odds_snapshots','provider_snapshots','evaluation_metrics')
```

No universal season-age or `retention_days` rule is introduced.

Hot-table deletion/partition removal is a separate retention lifecycle and is not part of archive artifact creation.

Protected data remains protected, including:

```text
prediction_baselines
audit source
model-replay source
canonical historical source required for reconstruction
```

## 6. Deployment provenance

The live migration history contains the archive implementation sequence:

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

Therefore the archive execution layer is already deployed; this authorization records the authoritative implementation rather than authorizing a duplicate migration.

## 7. Cron boundary and runtime evidence

The live scheduler is:

```text
jobid   = 19
jobname = archive-scheduler
schedule = 0 19 * * *
command = select internal.archive_scheduler();
active  = true
```

Recent live runs include successful executions at:

```text
2026-08-24 19:00:00 UTC
2026-08-24 18:25:00 UTC
```

The scheduler is control-plane only. It must not upload bulk objects, serialize large archives, delete hot partitions, mutate immutable prediction truth, call Redis, or call providers.

## 8. Positive live E2E evidence

A live archive campaign has completed successfully:

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

The worker job completed with:

```text
queue_name      = archive_campaign
status          = SUCCEEDED
idempotency_key = archive-campaign:c2cff031-17ce-44dd-a9b7-6d1d1709b36b
```

The corresponding `archive_catalog` manifest exists with matching archive lineage and S3 URI/checksum metadata.

This establishes positive end-to-end evidence at the live control/database boundary. A direct external S3 object HEAD is not claimed by this document.

## 9. Remaining targeted test gates

The Archive execution path is **not deployment-blocked**. Remaining work is verification coverage only:

```text
same-artifact replay/idempotency test
changed-checksum new-lineage test
failure/rollback cleanup test
```

These tests must not trigger schema redesign or a new transport mechanism unless they expose a real implementation defect.

## 10. Non-regression rules

This authorization does not change:

```text
Historical Bootstrap
7-Day Rolling
rolling_fixture_dispatch
queue_recovery
provider_health
existing canonical queue set
prediction truth
prediction_baselines
```

It does not authorize creation of:

```text
archive_queue
second archive catalog
universal retention rule
new archive state
new artifact hash
```
