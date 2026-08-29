from __future__ import annotations

import json
import math
import os
from collections import Counter
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from .archive_training_source import load_settled_matches
from .walk_forward import build_walk_forward_folds, run_fold

CURRENT_MODEL_BRIER = 0.6506253460126591
CURRENT_MODEL_LOGLOSS = 1.1660546532735068
CURRENT_MODEL_RPS = 0.23352256667137694
BRIER_IMPROVEMENT = 0.03
LOGLOSS_IMPROVEMENT = 0.02
RPS_IMPROVEMENT = 0.02
ECE_ABSOLUTE_TOLERANCE = 0.01
MIN_COMPLETE_SEASONS = 3
MIN_OOS_PREDICTIONS = 3000


def db_connect():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=15)


def _outcome(m):
    return 'H' if m.home_goals > m.away_goals else ('D' if m.home_goals == m.away_goals else 'A')


def _market_probs(conn, match_id: str, kickoff: datetime):
    """Return the latest pre-kickoff 1X2 inverse-odds average when historical odds are available.

    The current database may legitimately have no odds history; in that case the benchmark
    records NULL market probabilities rather than inventing a market score.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            with candidate_fixture as (
              select id
                from public.fixtures
               where provider_ids::text like ('%' || %s || '%')
               limit 1
            ),
            latest as (
              select os.market_key, os.selection, os.odds, os.captured_at,
                     row_number() over (partition by os.bookmaker_id, os.selection order by os.captured_at desc) rn
                from public.odds_snapshots os
                join candidate_fixture cf on cf.id = os.fixture_id
               where os.captured_at < %s
                 and os.market_key in ('1X2','match_result','home_draw_away')
                 and os.odds > 1
            )
            select selection, odds, captured_at
              from latest
             where rn = 1
            """,
            (str(match_id), kickoff),
        )
        rows = cur.fetchall()
    by_sel = {}
    if not rows:
        return None
    for row in rows:
        by_sel.setdefault(str(row['selection']).upper(), []).append(float(row['odds']))
    key_map = {
        'HOME': ('H',), 'H': ('H',), '1': ('H',),
        'DRAW': ('D',), 'D': ('D',), 'X': ('D',),
        'AWAY': ('A',), 'A': ('A',), '2': ('A',),
    }
    inv = {}
    latest_time = None
    for key, vals in by_sel.items():
        mapped = key_map.get(key)
        if not mapped:
            continue
        inv[mapped[0]] = sum(1.0 / v for v in vals) / len(vals)
    if set(inv) != {'H', 'D', 'A'}:
        return None
    total = sum(inv.values())
    return (inv['H']/total, inv['D']/total, inv['A']/total, None)


def _empirical_probs(train):
    counts = Counter(_outcome(m) for m in train)
    # Laplace smoothing keeps the baseline defined for newly observed classes.
    total = sum(counts.values()) + 3
    return ((counts['H'] + 1) / total, (counts['D'] + 1) / total, (counts['A'] + 1) / total)


def _score(probs, outcome):
    actual = {'H': (1.0,0.0,0.0), 'D': (0.0,1.0,0.0), 'A': (0.0,0.0,1.0)}[outcome]
    p = [max(1e-15, float(x)) for x in probs]
    brier = sum((x-y)**2 for x,y in zip(p, actual))
    idx = {'H':0,'D':1,'A':2}[outcome]
    logloss = -math.log(p[idx])
    rps = ((p[0]-actual[0])**2 + (p[0]+p[1]-actual[0]-actual[1])**2) / 2.0
    return brier, logloss, rps


def build_benchmark(training_run_id: str):
    with db_connect() as conn:
        matches = load_settled_matches(conn, as_of=datetime.now(timezone.utc))
        with conn.cursor() as cur:
            cur.execute("select train_cutoff,test_start,test_end,fold_no,status from internal.prediction_training_folds where training_run_id=%s order by fold_no", (training_run_id,))
            db_folds = cur.fetchall()
        cutoffs = [r['train_cutoff'] for r in db_folds if r['status'] == 'SUCCEEDED']
        folds = build_walk_forward_folds(matches, cutoffs) if cutoffs else []
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("delete from internal.prediction_oos_benchmark where training_run_id=%s", (training_run_id,))
                total = {'model_brier':0.0,'model_logloss':0.0,'model_rps':0.0,
                         'emp_brier':0.0,'emp_logloss':0.0,'emp_rps':0.0,
                         'market_brier':0.0,'market_logloss':0.0,'market_rps':0.0,'market_n':0,'n':0}
                for fold_no, (train, test, cutoff) in zip(range(1, len(folds)+1), folds):
                    if not train or not test:
                        continue
                    predictions = run_fold(train, test, cutoff)
                    emp = _empirical_probs(train)
                    for m, pred in zip(test, predictions):
                        outcome = _outcome(m)
                        mb, ml, mr = _score((pred.p_home,pred.p_draw,pred.p_away), outcome)
                        eb, el, er = _score(emp, outcome)
                        market = _market_probs(conn, m.match_id, m.played_at)
                        if market:
                            kb, kl, kr = _score(market[:3], outcome)
                            total['market_brier'] += kb; total['market_logloss'] += kl; total['market_rps'] += kr; total['market_n'] += 1
                        else:
                            kb = kl = kr = None
                        total['model_brier'] += mb; total['model_logloss'] += ml; total['model_rps'] += mr
                        total['emp_brier'] += eb; total['emp_logloss'] += el; total['emp_rps'] += er; total['n'] += 1
                        cur.execute(
                            """insert into internal.prediction_oos_benchmark
                               (training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,
                                model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,
                                market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics)
                               select %s, ptr.model_version_id,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}'::jsonb
                                 from internal.prediction_training_runs ptr where ptr.id=%s""",
                            (training_run_id, m.match_id, fold_no, m.played_at, outcome,
                             pred.p_home,pred.p_draw,pred.p_away,emp[0],emp[1],emp[2],
                             market[0] if market else None, market[1] if market else None, market[2] if market else None,
                             market[3] if market else None, training_run_id),
                        )
                n = total['n']
                summary = {
                    'oos_n': n,
                    'model': {'brier': total['model_brier']/n if n else None, 'log_loss': total['model_logloss']/n if n else None, 'rps': total['model_rps']/n if n else None},
                    'empirical_baseline': {'brier': total['emp_brier']/n if n else None, 'log_loss': total['emp_logloss']/n if n else None, 'rps': total['emp_rps']/n if n else None},
                    'market': {'n': total['market_n'], 'brier': total['market_brier']/total['market_n'] if total['market_n'] else None, 'log_loss': total['market_logloss']/total['market_n'] if total['market_n'] else None, 'rps': total['market_rps']/total['market_n'] if total['market_n'] else None},
                    'thresholds': {'brier_relative': BRIER_IMPROVEMENT, 'log_loss_relative': LOGLOSS_IMPROVEMENT, 'rps_relative': RPS_IMPROVEMENT, 'ece_absolute_tolerance': ECE_ABSOLUTE_TOLERANCE, 'min_complete_oos_seasons': MIN_COMPLETE_SEASONS, 'min_oos_predictions': MIN_OOS_PREDICTIONS},
                }
                cur.execute("update internal.prediction_training_runs set metrics=metrics || %s::jsonb where id=%s", (json.dumps({'benchmark': summary}), training_run_id))
        return summary


if __name__ == '__main__':
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id::text from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1")
            row = cur.fetchone()
    if not row:
        raise SystemExit('no succeeded training run')
    print(json.dumps(build_benchmark(row['id']), sort_keys=True))
