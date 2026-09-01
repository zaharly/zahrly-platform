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

MIN_COMPLETE_SEASONS = 3
MIN_OOS_PREDICTIONS = 3000


def db_connect():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=15)


def outcome(m):
    return 'H' if m.home_goals > m.away_goals else ('D' if m.home_goals == m.away_goals else 'A')


def _market_probs(conn, match_id: str, kickoff: datetime):
    with conn.cursor() as cur:
        cur.execute("""
          with candidate_fixture as (
            select id from public.fixtures where provider_ids->>'api_football'=%s limit 1
          ), latest as (
            select os.selection,os.odds,os.captured_at,
                   row_number() over(partition by os.bookmaker_id,os.selection order by os.captured_at desc) rn
              from public.odds_snapshots os join candidate_fixture cf on cf.id=os.fixture_id
             where os.captured_at < %s and os.market_key in ('1X2','match_result','home_draw_away') and os.odds > 1
          )
          select selection,odds,captured_at from latest where rn=1
        """, (str(match_id), kickoff))
        rows=cur.fetchall()
    if not rows: return None
    mapping={'HOME':'H','H':'H','1':'H','DRAW':'D','D':'D','X':'D','AWAY':'A','A':'A','2':'A'}
    inv={}; latest=None
    for r in rows:
        sel=mapping.get(str(r['selection']).strip().upper())
        if not sel: continue
        try: odds=float(r['odds'])
        except (TypeError,ValueError): continue
        if odds<=1: continue
        inv.setdefault(sel,[]).append(1.0/odds)
        if r['captured_at'] is not None and (latest is None or r['captured_at']>latest): latest=r['captured_at']
    if set(inv)!= {'H','D','A'}: return None
    probs=[sum(inv[k])/len(inv[k]) for k in ('H','D','A')]; total=sum(probs)
    return (probs[0]/total,probs[1]/total,probs[2]/total,latest)


def empirical_probs(train):
    c=Counter(outcome(m) for m in train); n=sum(c.values())+3
    return ((c['H']+1)/n,(c['D']+1)/n,(c['A']+1)/n)


def score(p,y):
    actual={'H':(1.,0.,0.),'D':(0.,1.,0.),'A':(0.,0.,1.)}[y]
    probs=[max(1e-15,float(x)) for x in p]; s=sum(probs); probs=[x/s for x in probs]
    idx={'H':0,'D':1,'A':2}[y]
    return (sum((a-b)**2 for a,b in zip(probs,actual)), -math.log(probs[idx]), ((probs[0]-actual[0])**2+(probs[0]+probs[1]-actual[0]-actual[1])**2)/2.0, max(probs), 1 if max(range(3),key=lambda i:probs[i])==idx else 0)


def ece(rows):
    if not rows: return None
    bins=[{'n':0,'conf':0.,'correct':0.} for _ in range(10)]
    for r in rows:
        i=min(9,int(r['confidence']*10)); b=bins[i]; b['n']+=1; b['conf']+=r['confidence']; b['correct']+=r['correct']
    n=len(rows)
    return sum((b['n']/n)*abs(b['correct']/b['n']-b['conf']/b['n']) for b in bins if b['n'])


def main(training_run_id: str|None=None):
    with db_connect() as conn:
        if training_run_id is None:
            row=conn.execute("select id::text from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
            if not row: raise SystemExit('no succeeded training run')
            training_run_id=row['id']
        matches=load_settled_matches(conn, as_of=datetime.now(timezone.utc))
        folds=[r for r in conn.execute("select fold_no,train_cutoff,test_start,test_end,status from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no",(training_run_id,)).fetchall()]
        cutoffs=[r['train_cutoff'] for r in folds]
        wf=build_walk_forward_folds(matches,cutoffs)
        conn.execute("delete from internal.prediction_oos_benchmark where training_run_id=%s",(training_run_id,))
        model_rows=[]; emp_rows=[]; market_rows=[]
        with conn.transaction():
            for fold_db,(train,test,cutoff) in zip(folds,wf):
                if not train or not test: continue
                preds=run_fold(train,test,cutoff); emp=empirical_probs(train)
                for m,pred in zip(test,preds):
                    y=outcome(m); mp=(pred.p_home,pred.p_draw,pred.p_away); ms=score(mp,y); ep=score(emp,y); market=_market_probs(conn,m.match_id,m.played_at); kp=score(market[:3],y) if market else None
                    model_rows.append({'confidence':ms[3],'correct':ms[4],'score':ms,'p':mp,'m':m,'market':market})
                    emp_rows.append({'confidence':ep[3],'correct':ep[4],'score':ep})
                    if kp: market_rows.append({'confidence':kp[3],'correct':kp[4],'score':kp})
                    actual={'H':(1.,0.,0.),'D':(0.,1.,0.),'A':(0.,0.,1.)}[y]
                    conn.execute("insert into internal.prediction_oos_benchmark(training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics) select %s,ptr.model_version_id,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s from internal.prediction_training_runs ptr where ptr.id=%s",(training_run_id,m.match_id,fold_db['fold_no'],m.played_at,y,mp[0],mp[1],mp[2],emp[0],emp[1],emp[2],market[0] if market else None,market[1] if market else None,market[2] if market else None,market[3] if market else None,json.dumps({'model':{'brier':ms[0],'log_loss':ms[1],'rps':ms[2]},'empirical':{'brier':ep[0],'log_loss':ep[1],'rps':ep[2]},'market':{'brier':kp[0],'log_loss':kp[1],'rps':kp[2]} if kp else None} ),training_run_id))
            n=len(model_rows); mn=len(market_rows)
            model={'n':n,'brier':sum(r['score'][0] for r in model_rows)/n,'log_loss':sum(r['score'][1] for r in model_rows)/n,'rps':sum(r['score'][2] for r in model_rows)/n,'ece':ece(model_rows)}
            empirical={'n':len(emp_rows),'brier':sum(r['score'][0] for r in emp_rows)/len(emp_rows),'log_loss':sum(r['score'][1] for r in emp_rows)/len(emp_rows),'rps':sum(r['score'][2] for r in emp_rows)/len(emp_rows),'ece':ece(emp_rows)}
            market={'n':mn,'coverage':mn/n if n else 0.,'brier':sum(r['score'][0] for r in market_rows)/mn if mn else None,'log_loss':sum(r['score'][1] for r in market_rows)/mn if mn else None,'rps':sum(r['score'][2] for r in market_rows)/mn if mn else None,'ece':ece(market_rows)}
            summary={'oos_n':n,'model':model,'empirical_baseline':empirical,'market':market,'clv':None,'clv_status':'UNAVAILABLE_NO_HISTORICAL_CLOSING_LINE' if mn==0 else 'NOT_YET_IMPLEMENTED','history_gate':{'min_oos_predictions':MIN_OOS_PREDICTIONS,'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'oos_predictions_pass':n>=MIN_OOS_PREDICTIONS,'oos_seasons_pass':len(folds)>=MIN_COMPLETE_SEASONS}}
            conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(json.dumps({'benchmark':summary}),training_run_id))
            conn.commit()
        print(json.dumps(summary,sort_keys=True))
        return summary

if __name__=='__main__': main()
