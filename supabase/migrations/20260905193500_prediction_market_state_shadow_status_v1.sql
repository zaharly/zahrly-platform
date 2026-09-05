begin;

-- The GitHub prediction lifecycle writes SHADOW market states for the
-- non-production prediction projection. The previous constraint only allowed
-- production lifecycle states, causing every otherwise-valid prediction to
-- roll back after market derivation.
alter table public.prediction_market_states
  drop constraint if exists prediction_market_states_status_check;

alter table public.prediction_market_states
  add constraint prediction_market_states_status_check
  check (status = any (array[
    'EXPERIMENTAL'::text,
    'PREDICTED_ONLY'::text,
    'PRODUCTION_ENABLED'::text,
    'ABSTAIN'::text,
    'SHADOW'::text
  ]));

commit;
