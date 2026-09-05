# ZAHRLY — P0 Group 10 Archive `team_set_hash` DDL Reconciliation v1.0

**Date:** 24 August 2026  
**Status:** Reconciliation Complete — Live Parity Verified  
**Scope:** `internal.archive_catalog` artifact identity only

## Decision

The latest project decision requires `team_set_hash` as part of archive artifact identity and requires uniqueness over:

```text
country_id
competition_id
season
dataset_type
provider
schema_version
date_start
date_end
team_set_hash
checksum
```

The live Supabase database already matches this requirement:

- `internal.archive_catalog.team_set_hash` exists as `text NOT NULL`.
- Constraint `archive_catalog_artifact_identity_key` is:
  `UNIQUE (country_id, competition_id, season, dataset_type, provider, schema_version, date_start, date_end, team_set_hash, checksum)`.
- `archive_catalog` currently contains zero rows, so no backfill or data rewrite is required.

## Source Alignment

The latest project execution decision explicitly requires `team_set_hash text` and the exact uniqueness identity above. It also states that `manifest_id` is the generated manifest identity, not part of the artifact identity, and that a different checksum represents a new artifact lineage.

The project architecture identifies S3/object storage as the archive artifact store and PostgreSQL `archive_catalog` as the authoritative manifest/lineage store.

## Non-Regression

This reconciliation does not:

- add a second archive catalog;
- create `archive_queue`;
- change retention policy;
- change fixture lifecycle/status;
- change historical backfill or rolling production;
- add a new archive state;
- create a new hash formula;
- modify immutable prediction truth.

## Verification

Verified live:

```text
archive_catalog row_count = 0
team_set_hash             = text NOT NULL
artifact identity UNIQUE  = verified
archive_season()          = already deployed separately
```

Therefore **no new DDL mutation is required for this reconciliation**. The live schema is already at the required baseline.
