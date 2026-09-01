create table if not exists internal.prediction_jobs (
  job_id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id),
  episode_id uuid not null references public.fixture_episodes(id),
  model_version_id uuid not null references public.model_versions(id),
  policy_bundle_id uuid not null references public.policy_versions(id),
  status text not null check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','ABSTAINED')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  unique (episode_id, model_version_id, policy_bundle_id)
);

create index if not exists prediction_jobs_queue_idx on internal.prediction_jobs(status, created_at);
create index if not exists prediction_jobs_fixture_idx on internal.prediction_jobs(fixture_id, episode_id);

create or replace function internal.enqueue_7d_prediction_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  model_id uuid;
  policy_id uuid;
  enqueued_count integer := 0;
  fixture_row record;
  worker_id uuid;
begin
  select mv.id into model_id
    from public.model_versions mv
   where upper(mv.status) in ('ACTIVE','PRODUCTION','PRODUCTION_ENABLED')
     and mv.family in ('elo','glicko','poisson','dixon_coles','prediction_engine','match_prediction')
     and mv.artifact_uri is not null
     and mv.training_cutoff is not null
   order by mv.created_at desc
   limit 1;

  if model_id is null then
    return jsonb_build_object('status','BLOCKED','reason','no_validated_production_model');
  end if;

  select pv.id into policy_id
    from public.policy_versions pv
   order by pv.created_at desc
   limit 1;

  if policy_id is null then
    return jsonb_build_object('status','BLOCKED','reason','no_prediction_policy');
  end if;

  for fixture_row in
    select f.id as fixture_id, e.id as episode_id
      from public.fixtures f
      join public.fixture_episodes e on e.fixture_id=f.id and e.episode_status='ACTIVE'
     where lower(f.status)='scheduled'
       and f.kickoff_at >= p_now
       and f.kickoff_at < p_now + interval '7 days'
     order by f.kickoff_at, f.id
  loop
    worker_id := gen_random_uuid();
    insert into internal.worker_jobs(job_id,queue_name,idempotency_key,status,attempts)
    values(worker_id,'prediction_queue',format('prediction:%s:%s:%s',fixture_row.episode_id,model_id,policy_id),'QUEUED',0)
    on conflict (idempotency_key) do nothing;

    select w.job_id into worker_id
      from internal.worker_jobs w
     where w.idempotency_key=format('prediction:%s:%s:%s',fixture_row.episode_id,model_id,policy_id)
     limit 1;

    insert into internal.prediction_jobs(fixture_id,episode_id,model_version_id,policy_bundle_id,status,worker_job_id)
    values(fixture_row.fixture_id,fixture_row.episode_id,model_id,policy_id,'QUEUED',worker_id)
    on conflict (episode_id,model_version_id,policy_bundle_id) do nothing;

    if found then enqueued_count := enqueued_count + 1; end if;
  end loop;

  return jsonb_build_object('status','ENQUEUED','model_version_id',model_id,'policy_bundle_id',policy_id,'enqueued',enqueued_count,'window_start',p_now,'window_end',p_now + interval '7 days');
end;
$$;
