-- Canonical settlement -> market benchmark integration.
-- Idempotent schema backfill; edge-function deployment is managed separately.

alter table internal.prediction_market_benchmarks
  add column if not exists benchmark_type text not null default 'MULTI_BOOK_CONSENSUS';
alter table internal.prediction_market_benchmarks
  add column if not exists coverage numeric;
alter table internal.prediction_market_benchmarks
  add column if not exists market_snapshot_at timestamptz;
alter table internal.prediction_market_benchmarks
  add column if not exists result_source text not null default 'API_FOOTBALL';

create index if not exists prediction_market_benchmarks_model_kickoff_idx
  on internal.prediction_market_benchmarks(model_version_id, kickoff_at desc);

create table if not exists internal.prediction_fixture_results (
  fixture_id uuid primary key references public.fixtures(id) on delete cascade,
  provider text not null,
  provider_fixture_id text not null,
  final_status text not null,
  home_score integer not null,
  away_score integer not null,
  fetched_at timestamptz not null default now(),
  evidence_hash text not null
);

create unique index if not exists prediction_fixture_results_provider_idx
  on internal.prediction_fixture_results(provider, provider_fixture_id);

create or replace function internal.run_prediction_market_settlement_once()
returns bigint language plpgsql security definer
set search_path to 'pg_catalog','internal','net'
as $$
declare rid bigint;
begin
 select net.http_post(
  url := 'https://qosvqlwkexrhswcuakib.supabase.co/functions/v1/prediction-market-settlement-sync-v1',
  body := jsonb_build_object('source','pg-cron-market-settlement','requested_at',now()),
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-rolling-ingest-secret',(select secret from internal.worker_secrets where name='rolling-ingest' limit 1)
  ), timeout_milliseconds := 120000
 ) into rid;
 return coalesce(rid,0);
end $$;

-- The live scheduler is intentionally sequenced by cron cadence:
-- settlement every 10m; benchmark at :05/:35; gate at :10/:40.
