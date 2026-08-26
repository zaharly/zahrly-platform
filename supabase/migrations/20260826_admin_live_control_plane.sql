-- Live Admin control-plane read contracts for non-Data/Coverage pages.
-- These functions expose only persisted operational state and are guarded by require_admin().

create or replace function public.admin_provider_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, internal
as $$
with _auth as (select public.require_admin()),
latest_quota as (
  select distinct on (provider)
    provider, daily_budget, quota_used, protected_production_budget, backfill_budget,
    rate_limit_per_minute, rate_used, last_provider_status, last_rate_remaining, observed_at
  from internal.provider_quota_snapshots
  order by provider, observed_at desc
), request_rollup as (
  select provider,
         count(*) filter (where created_at >= now() - interval '24 hours') as requests_24h,
         count(*) filter (where status = 'COMPLETED' and created_at >= now() - interval '24 hours') as completed_24h,
         count(*) filter (where status = 'FAILED' and created_at >= now() - interval '24 hours') as failed_24h,
         max(completed_at) as last_completed_at
  from public.provider_requests
  group by provider
), capability_rollup as (
  select provider,
         count(*) as capability_rows,
         count(*) filter (where status = 'SUPPORTED') as supported_rows,
         max(checked_at) as last_checked_at
  from public.provider_capabilities
  group by provider
), merged as (
  select q.provider, q.daily_budget, q.quota_used, q.protected_production_budget, q.backfill_budget,
         q.rate_limit_per_minute, q.rate_used, q.last_provider_status, q.last_rate_remaining, q.observed_at,
         coalesce(r.requests_24h, 0) as requests_24h,
         coalesce(r.completed_24h, 0) as completed_24h,
         coalesce(r.failed_24h, 0) as failed_24h,
         r.last_completed_at,
         coalesce(c.capability_rows, 0) as capability_rows,
         coalesce(c.supported_rows, 0) as supported_rows,
         c.last_checked_at
  from latest_quota q
  left join request_rollup r using (provider)
  left join capability_rollup c using (provider)
)
select jsonb_build_object(
  'providers', coalesce((select jsonb_agg(jsonb_build_object(
    'provider', m.provider,
    'status', case
      when m.last_provider_status between 200 and 299 then 'healthy'
      when m.failed_24h > 0 then 'degraded'
      when m.last_provider_status is null then 'unknown'
      else 'degraded'
    end,
    'daily_budget', m.daily_budget,
    'quota_used', m.quota_used,
    'protected_production_budget', m.protected_production_budget,
    'backfill_budget', m.backfill_budget,
    'quota_pct', case when m.daily_budget > 0 then round((m.quota_used / m.daily_budget) * 100, 2) else null end,
    'rate_limit_per_minute', m.rate_limit_per_minute,
    'rate_used', m.rate_used,
    'last_provider_status', m.last_provider_status,
    'last_rate_remaining', m.last_rate_remaining,
    'requests_24h', m.requests_24h,
    'completed_24h', m.completed_24h,
    'failed_24h', m.failed_24h,
    'last_completed_at', m.last_completed_at,
    'capability_rows', m.capability_rows,
    'supported_rows', m.supported_rows,
    'last_checked_at', m.last_checked_at,
    'observed_at', m.observed_at
  ) order by m.provider) from merged m), '[]'::jsonb)
) from _auth;
$$;

create or replace function public.admin_provider_catalog_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, internal
as $$
with _auth as (select public.require_admin()),
season_counts as (
  select count(*)::bigint as total_seasons,
         count(*) filter (where current) as current_seasons,
         count(*) filter (where available) as available_seasons
  from public.provider_catalog_seasons
  where provider='api-football'
), country_count as (
  select count(*)::bigint as total from public.provider_catalog_countries where provider='api-football'
), competition_count as (
  select count(*)::bigint as total from public.provider_catalog_competitions where provider='api-football'
), sync as (
  select to_jsonb(s) as payload
  from internal.provider_catalog_sync_state s
  where provider='api-football'
  limit 1
)
select jsonb_build_object(
  'countries', coalesce((select total from country_count),0),
  'competitions', coalesce((select total from competition_count),0),
  'seasons', coalesce((select total_seasons from season_counts),0),
  'current_seasons', coalesce((select current_seasons from season_counts),0),
  'available_seasons', coalesce((select available_seasons from season_counts),0),
  'sync_state', coalesce((select payload from sync),'{}'::jsonb)
) from _auth;
$$;

create or replace function public.admin_ingestion_control_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, internal
as $$
with _auth as (select public.require_admin()),
countries as (
  select c.id, pcc.id as catalog_country_id, c.code, c.name, c.status,
         coalesce(ic.enabled,false) as enabled,
         coalesce(ic.priority,100) as priority,
         ic.notes
  from public.countries c
  left join public.provider_catalog_countries pcc
    on pcc.provider='api-football'
   and lower(coalesce(pcc.name,''))=lower(coalesce(c.name,''))
   and (c.code is null or lower(coalesce(pcc.code,''))=lower(coalesce(c.code,'')))
  left join public.ingestion_country_controls ic
    on ic.provider='api-football' and ic.catalog_country_id=pcc.id
),
competitions as (
  select c.id, pcc.id as catalog_competition_id, c.country_id, c.canonical_name as name, c.status,
         coalesce(ic.enabled,false) as enabled,
         coalesce(ic.priority,100) as priority,
         ic.notes
  from public.competitions c
  left join public.provider_catalog_competitions pcc
    on pcc.provider='api-football'
   and pcc.provider_competition_id=(c.provider_ids->>'api_football')::bigint
  left join public.ingestion_competition_controls ic
    on ic.provider='api-football' and ic.catalog_competition_id=pcc.id
)
select jsonb_build_object(
  'countries', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from countries c),'[]'::jsonb),
  'competitions', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from competitions c),'[]'::jsonb)
) from _auth;
$$;

create or replace function public.admin_command_center_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, internal, pg_catalog
as $$
with _auth as (select public.require_admin()),
production as (
  select count(*)::bigint as due_fixtures,
         count(*) filter (where pb.id is not null)::bigint as with_baseline
  from public.fixtures f
  left join public.fixture_episodes fe on fe.fixture_id=f.id and fe.episode_status='ACTIVE'
  left join public.prediction_baselines pb on pb.episode_id=fe.id
  where f.status='scheduled' and f.kickoff_at >= now() and f.kickoff_at < now() + interval '7 days'
),
queues as (
  select coalesce(jsonb_agg(to_jsonb(q) order by q.queue_name),'[]'::jsonb) payload
  from (
    select queue_name,
           count(*) filter (where status='QUEUED') as queued,
           count(*) filter (where status='RUNNING') as running,
           count(*) filter (where status in ('RETRYING','RETRYABLE')) as retrying,
           count(*) filter (where status='DEAD_LETTER') as dead_letter,
           count(*) as total
    from internal.worker_jobs
    group by queue_name
  ) q
),
incidents as (
  select (select count(*) from internal.worker_jobs where status='DEAD_LETTER')::bigint as dead_letter_jobs,
         (select count(*) from public.provider_requests where status='FAILED' and created_at >= now()-interval '24 hours')::bigint as provider_failures_24h
),
model_state as (
  select coalesce((select jsonb_build_object('version', version, 'status', status, 'family', family)
                   from public.model_versions where status='ACTIVE' order by created_at desc limit 1),'{}'::jsonb) active_model
),
bootstrap as (select public.admin_historical_bootstrap_snapshot() snapshot)
select jsonb_build_object(
  'production', (select jsonb_build_object(
    'due_fixtures', due_fixtures,
    'with_baseline', with_baseline,
    'coverage_pct', case when due_fixtures=0 then 0 else round((with_baseline::numeric/due_fixtures::numeric)*100,2) end
  ) from production),
  'queues', (select payload from queues),
  'incidents', (select to_jsonb(i) from incidents i),
  'providers', (select public.admin_provider_snapshot()->'providers'),
  'bootstrap', (select snapshot from bootstrap),
  'active_model', (select active_model from model_state),
  'captured_at', now()
) from _auth;
$$;

revoke execute on function public.admin_provider_snapshot() from public;
revoke execute on function public.admin_provider_catalog_snapshot() from public;
revoke execute on function public.admin_ingestion_control_snapshot() from public;
revoke execute on function public.admin_command_center_snapshot() from public;
grant execute on function public.admin_provider_snapshot() to authenticated;
grant execute on function public.admin_provider_catalog_snapshot() to authenticated;
grant execute on function public.admin_ingestion_control_snapshot() to authenticated;
grant execute on function public.admin_command_center_snapshot() to authenticated;
