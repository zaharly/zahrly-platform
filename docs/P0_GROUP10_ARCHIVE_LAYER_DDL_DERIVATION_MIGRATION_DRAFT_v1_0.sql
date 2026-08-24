-- ZAHRLY — P0 Group 10 Archive Layer DDL Derivation Migration Draft v1.0
-- STATUS: DRAFT / NOT AUTHORIZED FOR SUPABASE APPLY
--
-- Provenance:
--   Derived only from the approved P0 Group 10 DDL-derivation decision and
--   the documented Archive catalog/completeness contracts.
--
-- IMPORTANT:
--   The exact Starter Migration v1.1 raw SQL could not be retrieved from the
--   current Library index during this review. Therefore this file is a review
--   artifact, NOT an authoritative migration. Exact types/constraints MUST be
--   matched against the canonical v1.1 source before deployment.
--
-- Explicitly excluded:
--   - internal.archive_season(...)
--   - archive_queue / any new queue
--   - retention or archive-eligibility predicates
--   - archive artifact idempotency rules
--   - cron
--   - data movement / partition deletion
--
-- Target schema only:
--   internal.archive_catalog
--   internal.archive_completeness_rules

begin;

create schema if not exists internal;

-- Archive lineage / manifest catalog.
create table if not exists internal.archive_catalog (
  manifest_id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.countries(id),
  competition_id uuid not null references public.competitions(id),
  season integer not null,
  dataset_type text not null,
  provider text not null,
  date_start timestamptz not null,
  date_end timestamptz not null,
  object_uri text not null,
  checksum text not null,
  row_count bigint not null,
  completeness_score numeric(6,5),
  schema_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_archive_catalog_lookup
  on internal.archive_catalog(
    competition_id,
    season,
    dataset_type,
    date_start,
    date_end
  );

-- Canonical archive completeness policy.
create table if not exists internal.archive_completeness_rules (
  dataset_type text not null,
  required_threshold numeric(6,5) not null,
  mandatory_for_market_family boolean not null default false,
  policy_version text not null,
  primary key (dataset_type, policy_version)
);

commit;

-- DO NOT APPLY from this file until:
-- 1. exact v1.1 column types/defaults are re-confirmed;
-- 2. exact v1.1 FK/constraint definitions are re-confirmed;
-- 3. Group 10 migration Gate passes;
-- 4. authoritative deployment path is approved.
