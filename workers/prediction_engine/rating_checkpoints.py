from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from .archive_training_source import load_settled_matches
from .elo import EloPolicy, EloState, update_elo
from .glicko import GlickoPolicy, initial_state, update_pair


def main() -> None:
    db_url=os.environ['SUPABASE_DB_URL']
    now=datetime.now(timezone.utc)
    with psycopg.connect(db_url,row_factory=dict_row) as conn:
        run=conn.execute("select id::text as id,model_version_id::text as model_version_id from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
        if not run: raise SystemExit('no succeeded prediction training run')
        matches=load_settled_matches(conn,as_of=now)
        elo_policy=EloPolicy(); glicko_policy=GlickoPolicy()
        elo={}; glicko={}
        for match in matches:
            eh=elo.get(match.home_team_id,EloState(elo_policy.initial_rating)); ea=elo.get(match.away_team_id,EloState(elo_policy.initial_rating))
            eh,ea,_=update_elo(eh,ea,match.home_goals,match.away_goals,elo_policy); elo[match.home_team_id]=eh; elo[match.away_team_id]=ea
            gh=glicko.get(match.home_team_id,initial_state(glicko_policy)); ga=glicko.get(match.away_team_id,initial_state(glicko_policy))
            gh,ga,_=update_pair(gh,ga,match.home_goals,match.away_goals,glicko_policy); glicko[match.home_team_id]=gh; glicko[match.away_team_id]=ga
        mapped={r['external_team_id']:r['team_id'] for r in conn.execute("select external_team_id,team_id from public.team_aliases where provider='api-football' and external_team_id is not null and team_id is not null").fetchall()}
        cutoff=max(m.played_at for m in matches)
        with conn.transaction():
            conn.execute("insert into public.policy_versions(policy_type,version,payload) values (%s,%s,%s) on conflict(policy_type,version) do nothing",('rating','elo-v1',json.dumps({'initial_rating':elo_policy.initial_rating,'k_factor':elo_policy.k_factor,'home_advantage':elo_policy.home_advantage,'rating_scale':elo_policy.rating_scale})))
            conn.execute("insert into public.policy_versions(policy_type,version,payload) values (%s,%s,%s) on conflict(policy_type,version) do nothing",('rating','glicko-v1',json.dumps({'initial_rating':glicko_policy.initial_rating,'initial_rd':glicko_policy.initial_rd,'initial_volatility':glicko_policy.initial_volatility,'home_advantage':glicko_policy.home_advantage})))
            for external,state in elo.items():
                team_id=mapped.get(external)
                if team_id:
                    conn.execute("insert into internal.prediction_rating_checkpoints(model_version_id,rating_policy_version,checkpoint_scope,team_id,rating,rating_deviation,volatility,as_of_time) values (%s,'elo-v1','FOLD',%s,%s,%s,%s,%s) on conflict do nothing",(run['model_version_id'],team_id,state.rating,state.rating_deviation,state.volatility,cutoff))
            for external,state in glicko.items():
                team_id=mapped.get(external)
                if team_id:
                    conn.execute("insert into internal.prediction_rating_checkpoints(model_version_id,rating_policy_version,checkpoint_scope,team_id,rating,rating_deviation,volatility,as_of_time) values (%s,'glicko-v1','FOLD',%s,%s,%s,%s,%s) on conflict do nothing",(run['model_version_id'],team_id,state.rating,state.rating_deviation,state.volatility,cutoff))
            conn.commit()
        print(json.dumps({'status':'SUCCEEDED','training_run_id':run['id'],'model_version_id':run['model_version_id'],'settled_matches':len(matches),'elo_checkpoints':len(elo),'glicko_checkpoints':len(glicko),'cutoff':cutoff.isoformat()},sort_keys=True))

if __name__=='__main__': main()
