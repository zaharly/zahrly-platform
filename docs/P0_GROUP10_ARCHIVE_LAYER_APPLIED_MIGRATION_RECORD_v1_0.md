# ZAHRLY — P0 Group 10 Archive Layer Applied Migration Record v1.0

**Date:** 24 August 2026  
**Migration:** `p0_group10_archive_layer_ddl_foundation_v1`  
**Status:** Applied to live Supabase; Archive Scheduler remains blocked

## Applied scope

The migration established only the metadata foundation explicitly authorized by the Group 10 DDL-derivation decision:

```text
internal.archive_catalog
internal.archive_completeness_rules
idx_archive_catalog_lookup
```

The migration also:

```text
RLS enabled on both internal tables
anon/authenticated table access revoked
```

## Explicitly not included

```text
internal.archive_season(...)
archive_queue
retention policy
archive eligibility predicate
archive-artifact idempotency formula
archive_scheduler
pg_cron
archive data movement
partition deletion
```

## Provenance

This is a controlled DDL derivation based on the approved Group 10 archive contracts and the project precedent for contract-to-DDL derivation. The raw Starter Migration v1.1 text was not retrievable from the current Library index during the implementation review, so this record does **not** claim byte-for-byte reproduction of v1.1.

## Live verification

Verified in the live Supabase project:

```text
migration present:
  20260824114646 / p0_group10_archive_layer_ddl_foundation_v1

archive_catalog:
  present
  RLS enabled
  PK = manifest_id
  FK country_id -> public.countries(id)
  FK competition_id -> public.competitions(id)

archive_completeness_rules:
  present
  RLS enabled
  PK = (dataset_type, policy_version)

archive_catalog index:
  idx_archive_catalog_lookup
  (competition_id, season, dataset_type, date_start, date_end)

archive_season():
  0 deployed functions

archive_scheduler Cron:
  0 jobs

archive_queue:
  0 queues

canonical PGMQ queues remain unchanged.
```

## Security note

Post-migration security advisors report the two new internal tables under the existing `rls_enabled_no_policy` INFO pattern. This is consistent with the private/internal boundary used by existing internal control tables; no new public access was granted.

The advisor run also reports pre-existing unrelated security findings elsewhere in the project. Those are not caused by this Archive metadata migration and are not treated as an Archive-target blocker here.

## Gate result

```text
Archive metadata foundation       ✅ DEPLOYED
Live schema parity                ✅ VERIFIED
Archive scheduler                 ⛔ BLOCKED
archive_season()                  ⛔ BLOCKED
Retention/eligibility             ⛔ BLOCKED
Archive artifact identity         ⛔ BLOCKED
Archive Cron                      ⛔ BLOCKED
```

The next authorized action is a separate Archive execution-contract decision. No scheduler or Cron is authorized by this migration.
