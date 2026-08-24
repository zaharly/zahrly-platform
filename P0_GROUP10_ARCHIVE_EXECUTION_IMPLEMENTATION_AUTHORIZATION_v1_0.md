# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026
**Status:** AUTHORIZED IMPLEMENTATION BASELINE — runtime verification remains open
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

The deployed path is:

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

The deployed function is:

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

The existing `archive_catalog_artifact_identity_key` constraint is authoritative. No additional archive uniqueness key or custom hash is authorized.

Worker-job duplication remains protected by:

```text
internal.worker_jobs.idempotency_key UNIQUE
```

with the archive dispatch convention:

```text
archive-campaign:<campaign_id>
```

## 5. Authoritative eligibility / retention boundary

Archive admission is dataset-aware and requires:

```text
scope_state = ARCHIVE_ONLY
+ applicable canonical completeness threshold satisfied
+ dataset_type is archivable
+ never-delete protection is not violated
+ retry is due when retry state exists
```

The currently deployed scheduler admits:

```text
odds_snapshots
provider_snapshots
evaluation_metrics
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

Therefore the archive execution layer is already deployed; this authorization records the current authoritative implementation rather than authorizing a duplicate migration.

## 7. Cron boundary

The deployed scheduler is:

```text
job: archive-scheduler
command: select internal.archive_scheduler();
```

The scheduler is control-plane only. It must not upload bulk objects, serialize large archives, delete hot partitions, mutate immutable prediction truth, call Redis, or call providers.

## 8. Non-regression rules

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

## 9. Runtime gate

Implementation is authorized and deployed. The remaining gate is runtime evidence only:

```text
Campaign → S3 → archive_season → catalog positive E2E
same-artifact idempotency
changed-checksum new-lineage behavior
failure/rollback cleanup
successful scheduled pg_cron evidence
```

Until those checks are evidenced, no redesign or scheduler-path change is authorized.
