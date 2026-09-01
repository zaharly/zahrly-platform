create or replace function internal.enqueue_due_predictions()
returns void
language plpgsql
set search_path = pg_catalog, public, internal
as $$
declare
  r record;
  model_id uuid;
  policy_id uuid;
  v_job_id uuid;
  v_prediction_job_id uuid;
  v_idempotency_key text;
begin
  select mv.id into model_id
    from public.model_versions mv
   where upper(mv.status) in ('ACTIVE','PRODUCTION','PRODUCTION_ENABLED')
     and mv.family in ('elo','glicko','poisson','dixon_coles','prediction_engine','match_prediction')
     and mv.artifact_uri is not null
     and mv.training_cutoff is not null
   order by mv.created_at desc
   limit 1;
  if model_id is null then return; end if;

  select pv.id into policy_id
    from public.policy_versions pv
   where pv.policy_type ilike '%prediction%'
      or pv.policy_type ilike '%model%'
   order by pv.created_at desc
   limit 1;
  if policy_id is null then
    select pv.id into policy_id from public.policy_versions pv order by pv.created_at desc limit 1;
  end if;
  if policy_id is null then return; end if;

  for r in
    select fe.id as episode_id, f.id as fixture_id
      from public.fixtures f
      join public.fixture_episodes fe on fe.fixture_id=f.id and fe.episode_status='ACTIVE'
      join public.competitions c on c.id=f.competition_id
      join public.countries co on co.id=c.country_id
     where lower(f.status)='scheduled'
       and f.kickoff_at >= now()
       and f.kickoff_at < now() + interval '7 days'
       and co.status='ENABLED'
       and c.status='ENABLED'
       and not exists (select 1 from public.processing_controls pc where pc.scope_type='country' and pc.scope_id=co.id and pc.state<>'ENABLED')
       and not exists (select 1 from public.processing_controls pc where pc.scope_type='competition' and pc.scope_id=c.id and pc.state<>'ENABLED')
       and not exists (select 1 from public.processing_controls pc where pc.scope_type='fixture' and pc.scope_id=f.id and pc.state<>'ENABLED')
       and not exists (select 1 from public.prediction_baselines pb where pb.episode_id=fe.id)
  loop
    v_idempotency_key := format('prediction:%s:%s:%s',r.episode_id,model_id,policy_id);
    v_prediction_job_id := null;
    v_job_id := null;

    select pj.job_id, pj.worker_job_id
      into v_prediction_job_id, v_job_id
      from internal.prediction_jobs pj
     where pj.episode_id=r.episode_id
       and pj.model_version_id=model_id
       and pj.policy_bundle_id=policy_id
     limit 1;

    if v_prediction_job_id is null then
      v_job_id := gen_random_uuid();
      insert into internal.worker_jobs(job_id,queue_name,idempotency_key,status,attempts)
      values(v_job_id,'prediction_queue',v_idempotency_key,'QUEUED',0)
      on conflict (idempotency_key) do nothing;
      select w.job_id into v_job_id from internal.worker_jobs w where w.idempotency_key=v_idempotency_key limit 1;

      insert into internal.prediction_jobs(job_id,fixture_id,episode_id,model_version_id,policy_bundle_id,status,worker_job_id)
      values(gen_random_uuid(),r.fixture_id,r.episode_id,model_id,policy_id,'QUEUED',v_job_id)
      on conflict (episode_id,model_version_id,policy_bundle_id) do nothing;
      select pj.job_id, pj.worker_job_id
        into v_prediction_job_id, v_job_id
        from internal.prediction_jobs pj
       where pj.episode_id=r.episode_id
         and pj.model_version_id=model_id
         and pj.policy_bundle_id=policy_id
       limit 1;
    end if;

    if v_job_id is not null and not exists (
      select 1 from pgmq.q_prediction_queue q
       where q.message->>'job_id' = v_job_id::text
    ) then
      perform pgmq.send('prediction_queue',jsonb_build_object(
        'job_id',v_job_id,
        'job_type','PREDICTION',
        'fixture_id',r.fixture_id,
        'episode_id',r.episode_id,
        'model_version_id',model_id,
        'policy_bundle_id',policy_id,
        'idempotency_key',v_idempotency_key
      ));
    end if;
  end loop;
end;
$$;

create or replace function internal.enqueue_7d_prediction_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,internal
as $$
begin
  perform internal.enqueue_due_predictions();
  return jsonb_build_object('status','OK','window_start',p_now,'window_end',p_now+interval '7 days');
end;
$$;
