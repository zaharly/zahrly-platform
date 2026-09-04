from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from .archive_training_source import load_settled_matches
from .elo import EloPolicy, EloState, update_elo
from .glicko import GlickoPolicy, initial_state, update_pair

INSERT_SQL = """
insert into internal.prediction_rating_checkpoints(
  model_version_id,rating_policy_version,checkpoint_scope,team_id,
  rating,rating_deviation,volatility,as_of_time
) values (%s,%s,'WEEK',%s,%s,%s,%s,%s)
"""


def main() -> None:
    db_url = os.environ['SUPABASE_DB_URL']
    now = datetime.now(timezone.utc)
    with psycopg.connect(db_url, row_factory=dict_row, connect_timeout=20, sslmode='require') as conn:
        conn.execute('SET SESSION statement_timeout = 0')
        run_id = os.environ.get('PREDICTION_TRAINING_RUN_ID', '').strip()
        if run_id:
            run = conn.execute(
                "select id::text as id,model_version_id::text as model_version_id "
                "from internal.prediction_training_runs where id=%s and status='SUCCEEDED'",
                (run_id,),
            ).fetchone()
        else:
            run = conn.execute(
                "select id::text as id,model_version_id::text as model_version_id "
                "from internal.prediction_training_runs where status='SUCCEEDED' "
                "order by started_at desc limit 1"
            ).fetchone()
        if not run:
            raise SystemExit('no succeeded prediction training run')

        matches = load_settled_matches(conn, as_of=now)
        if not matches:
            raise SystemExit('no settled archive matches')

        elo_policy = EloPolicy()
        glicko_policy = GlickoPolicy()
        elo = {}
        glicko = {}
        checkpoints = []

        for index, match in enumerate(matches, 1):
            eh = elo.get(match.home_team_id, EloState(elo_policy.initial_rating))
            ea = elo.get(match.away_team_id, EloState(elo_policy.initial_rating))
            eh, ea, _ = update_elo(eh, ea, match.home_goals, match.away_goals, elo_policy)
            elo[match.home_team_id] = eh
            elo[match.away_team_id] = ea

            gh = glicko.get(match.home_team_id, initial_state(glicko_policy))
            ga = glicko.get(match.away_team_id, initial_state(glicko_policy))
            gh, ga, _ = update_pair(gh, ga, match.home_goals, match.away_goals, glicko_policy)
            glicko[match.home_team_id] = gh
            glicko[match.away_team_id] = ga

            if index == len(matches) or match.played_at.isocalendar().week != matches[index].played_at.isocalendar().week:
                checkpoints.append((match.played_at, dict(elo), dict(glicko)))

        known_team_ids = {
            str(r['id']) for r in conn.execute("select id from public.teams").fetchall()
        }
        external_to_canonical = {
            str(r['external_team_id']): str(r['team_id'])
            for r in conn.execute(
                "select external_team_id,team_id from public.team_aliases "
                "where provider='api-football' and external_team_id is not null and team_id is not null"
            ).fetchall()
        }

        def canonical_team_id(team: str) -> str | None:
            value = str(team)
            if value in known_team_ids:
                return value
            return external_to_canonical.get(value)

        rows: list[tuple] = []
        unmapped = 0
        for checkpoint_time, elo_state, glicko_state in checkpoints:
            for team, state in elo_state.items():
                team_id = canonical_team_id(team)
                if not team_id:
                    unmapped += 1
                    continue
                rows.append((
                    run['model_version_id'], 'elo-v1', team_id,
                    state.rating, state.rating_deviation, state.volatility,
                    checkpoint_time,
                ))
            for team, state in glicko_state.items():
                team_id = canonical_team_id(team)
                if not team_id:
                    unmapped += 1
                    continue
                rows.append((
                    run['model_version_id'], 'glicko-v1', team_id,
                    state.rating, state.rating_deviation, state.volatility,
                    checkpoint_time,
                ))

        if not rows:
            raise SystemExit('rating_checkpoint_persistence_failed:no_canonical_team_mappings')

        with conn.transaction():
            conn.execute(
                "insert into public.policy_versions(policy_type,version,payload) "
                "values (%s,%s,%s) on conflict(policy_type,version) do nothing",
                ('rating', 'elo-v1', json.dumps({
                    'initial_rating': elo_policy.initial_rating,
                    'k_factor': elo_policy.k_factor,
                    'home_advantage': elo_policy.home_advantage,
                    'rating_scale': elo_policy.rating_scale,
                })),
            )
            conn.execute(
                "insert into public.policy_versions(policy_type,version,payload) "
                "values (%s,%s,%s) on conflict(policy_type,version) do nothing",
                ('rating', 'glicko-v1', json.dumps({
                    'initial_rating': glicko_policy.initial_rating,
                    'initial_rd': glicko_policy.initial_rd,
                    'initial_volatility': glicko_policy.initial_volatility,
                    'home_advantage': glicko_policy.home_advantage,
                })),
            )
            conn.execute(
                "delete from internal.prediction_rating_checkpoints where model_version_id=%s",
                (run['model_version_id'],),
            )
            with conn.cursor() as cur:
                cur.executemany(INSERT_SQL, rows)

        persisted = len(rows)
        print(json.dumps({
            'status': 'SUCCEEDED',
            'training_run_id': run['id'],
            'model_version_id': run['model_version_id'],
            'settled_matches': len(matches),
            'elo_teams': len(elo),
            'glicko_teams': len(glicko),
            'checkpoints': len(checkpoints),
            'persisted_checkpoint_rows': persisted,
            'unmapped_rows': unmapped,
            'cutoff': matches[-1].played_at.isoformat(),
        }, sort_keys=True))


if __name__ == '__main__':
    main()
