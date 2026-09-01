from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

BRIER_IMPROVEMENT = 0.03
LOGLOSS_IMPROVEMENT = 0.02
RPS_IMPROVEMENT = 0.02
ECE_ABSOLUTE_TOLERANCE = 0.01
MIN_COMPLETE_SEASONS = 3
MIN_OOS_PREDICTIONS = 3000


def db():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=15)


def score(p, y):
    b = sum((float(a) - float(b)) ** 2 for a, b in zip(p, y))
    i = max(range(3), key=lambda j: y[j])
    ll = -math.log(max(1e-15, float(p[i])))
    r = ((float(p[0])-y[0])**2 + (float(p[0])+float(p[1])-y[0]-y[1])**2) / 2.0
    conf = max(float(x) for x in p)
    pred = max(range(3), key=lambda j: float(p[j]))
    e = abs((1.0 if pred == i else 0.0) - conf)
    return b, ll, r, e


def aggregate(rows, prefix):
    vals=[]
    for row in rows:
        p=[row[f'{prefix}_p_home'], row[f'{prefix}_p_draw'], row[f'{prefix}_p_away']]
        if any(x is None for x in p):
            continue
        y={'H':(1.0,0.0,0.0),'D':(0.0,1.0,0.0),'A':(0.0,0.0,1.0)}[row['outcome']]
        vals.append(score(p,y))
    n=len(vals)
    if not n:
        return {'n':0,'brier':None,'log_loss':None,'rps':None,'ece':None}
    return {'n':n,'brier':sum(v[0] for v in vals)/n,'log_loss':sum(v[1] for v in vals)/n,'rps':sum(v[2] for v in vals)/n,'ece':sum(v[3] for v in vals)/n}


def gain(base, cand):
    if base is None or cand is None or base <= 0:
        return None
    return (base-cand)/base


def main():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("select id::text as id, model_version_id::text as model_version_id, metrics from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1")
            run=cur.fetchone()
            if not run: raise SystemExit('no succeeded training run')
            cur.execute("select * from internal.prediction_oos_benchmark where training_run_id=%s order by fold_no, played_at", (run['id'],))
            rows=cur.fetchall()
            cur.execute("select count(*) as n from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED'", (run['id'],))
            successful_folds=cur.fetchone()['n']
        model=aggregate(rows,'model')
        empirical=aggregate(rows,'empirical')
        market=aggregate([r for r in rows if r['market_p_home'] is not None],'market')
        rg={'brier':gain(empirical['brier'],model['brier']),'log_loss':gain(empirical['log_loss'],model['log_loss']),'rps':gain(empirical['rps'],model['rps'])}
        empirical_pass=all(v is not None and v >= t for v,t in ((rg['brier'],BRIER_IMPROVEMENT),(rg['log_loss'],LOGLOSS_IMPROVEMENT),(rg['rps'],RPS_IMPROVEMENT))) and model['ece'] <= empirical['ece'] + ECE_ABSOLUTE_TOLERANCE if empirical['ece'] is not None else False
        market_available=market['n'] > 0
        market_gain={'brier':gain(market['brier'],model['brier']),'log_loss':gain(market['log_loss'],model['log_loss']),'rps':gain(market['rps'],model['rps'])}
        market_pass=market_available and market_gain['brier'] is not None and market_gain['log_loss'] is not None and market_gain['brier'] >= 0 and market_gain['log_loss'] >= 0
        complete_seasons=successful_folds
        history_pass=len(rows) >= MIN_OOS_PREDICTIONS and complete_seasons >= MIN_COMPLETE_SEASONS
        promotion_eligible=history_pass and empirical_pass and market_pass
        status='PASS' if promotion_eligible else ('WAITING_MARKET_DATA' if history_pass and empirical_pass and not market_available else ('INSUFFICIENT_HISTORY' if not history_pass else 'FAIL'))
        benchmark={'model':model,'empirical_baseline':empirical,'market':market,'relative_gain_vs_empirical':rg,'market_relative_gain':market_gain,'threshold_gate':{'brier_relative':BRIER_IMPROVEMENT,'log_loss_relative':LOGLOSS_IMPROVEMENT,'rps_relative':RPS_IMPROVEMENT,'ece_absolute_tolerance':ECE_ABSOLUTE_TOLERANCE,'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'min_oos_predictions':MIN_OOS_PREDICTIONS,'history_pass':history_pass,'empirical_pass':empirical_pass,'market_pass':market_pass,'market_available':market_available,'promotion_eligible':promotion_eligible,'status':status},'created_at':datetime.now(timezone.utc).isoformat()}
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("update internal.prediction_training_runs set metrics=metrics || %s::jsonb where id=%s", (json.dumps({'benchmark_gate':benchmark}), run['id']))
                if not promotion_eligible:
                    cur.execute("update public.model_versions set status='SHADOW' where id=%s", (run['model_version_id'],))
        print(json.dumps({'training_run_id':run['id'],'model_version_id':run['model_version_id'],'benchmark_gate':benchmark},sort_keys=True))


if __name__=='__main__':
    main()
