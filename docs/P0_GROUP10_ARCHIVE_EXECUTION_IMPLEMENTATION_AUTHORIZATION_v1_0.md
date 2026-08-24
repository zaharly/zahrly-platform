# ZAHRLY — P0 Group 10 Archive Execution Implementation Authorization v1.0

**Date:** 24 August 2026  
**Status:** Implementation Authorized — Live parity reconciled  
**Scope:** Archive metadata + campaign execution + scheduler runtime gate

The live Supabase state now matches the latest project execution decision for the archive execution layer.

### Verified

```text
team_set_hash text NOT NULL                    ✅
archive_catalog_artifact_identity_key UNIQUE   ✅
internal.archive_season(...) signature         ✅
archive_scheduler()                            ✅
internal.dispatch_archive_campaign(uuid)      ✅
worker_jobs idempotency                        ✅
S3/object-storage artifact ownership          ✅ contract
anon/authenticated EXECUTE                    ❌ absent
archive-scheduler cron 0 3 * * *              ✅ active
```

The live `archive_season` signature is:

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

Artifact identity is:

```text
country_id + competition_id + season + dataset_type + provider
+ schema_version + date_start + date_end + team_set_hash + checksum
```

with existing live unique constraint `archive_catalog_artifact_identity_key`. fileciteturn111file0L20-L89

Archive creation is gated by `ARCHIVE_ONLY`, completed historical scope, canonical completeness, archivable dataset type, and never-delete protection. Hot-data retention/deletion is separate. fileciteturn111file1L199-L215

The live durable dispatch path is:

```text
archive_scheduler()
  → dispatch_archive_campaign(campaign_id)
  → worker_jobs
  → Archive Campaign / Worker
  → S3 artifact
  → archive_season()
  → archive_catalog
```

No `archive_queue` is introduced.

### Remaining Gate

Only functional/runtime evidence remains:

```text
positive canonical campaign registration
idempotent duplicate registration
rollback/failure verification
successful pg_cron runtime evidence
```

No fake production fixture should be created solely to manufacture success.
