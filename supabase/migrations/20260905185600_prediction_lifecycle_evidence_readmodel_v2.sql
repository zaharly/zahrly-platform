begin;

-- Complete the canonical lifecycle contract used by the GitHub Actions worker.
-- The runtime already treats evidence as an append-only thread, so make the
-- sequence explicit and deterministic without rewriting historical hashes.
alter table public.prediction_evidence_updates
  add column if not exists evidence_seq bigint;

with ranked as (
  select id,
         row_number() over (
           partition by baseline_id
           order by created_at asc nulls first, id asc
         )::bigint as seq
  from public.prediction_evidence_updates
)
update public.prediction_evidence_updates e
set evidence_seq = r.seq
from ranked r
where e.id = r.id
  and e.evidence_seq is null;

create unique index if not exists prediction_evidence_updates_baseline_seq_uidx
  on public.prediction_evidence_updates(baseline_id, evidence_seq);

alter table public.prediction_evidence_updates
  alter column evidence_seq set not null;

-- Public read models are intentionally a published projection, not the
-- mutable baseline/evidence source of truth.
alter table public.prediction_read_models
  enable row level security;

grant select on public.prediction_read_models to anon, authenticated;
grant select, insert, update on public.prediction_read_models to service_role;

drop policy if exists prediction_read_models_public_published_select
  on public.prediction_read_models;
create policy prediction_read_models_public_published_select
  on public.prediction_read_models
  for select
  to anon, authenticated
  using ((payload->>'publication_status') in ('SHADOW_PUBLISHED','PUBLISHED','LOCKED'));

create index if not exists prediction_read_models_fixture_idx
  on public.prediction_read_models(fixture_id, published_at desc);

create index if not exists prediction_read_models_episode_idx
  on public.prediction_read_models(episode_id, published_at desc);

commit;
