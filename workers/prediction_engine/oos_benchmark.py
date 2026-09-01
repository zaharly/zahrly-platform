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
BATCH_SIZE = 250

INSERT_SQL = """insert into internal.prediction_oos_benchmark(
training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,
model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,
empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics)
values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
on conflict (training_run_id,fold_no,fixture_id) do nothing"""


def db_connect():
    conn = psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=20, sslmode='require')
    conn.execute('SET SESSION statement_timeout = 0')
    conn.execute('SET SESSION lock_timeout = 0')
    return conn


def outcome(m):
    return 'H' if m.home_goals > m.away_goals else ('D' if m.home_goals == m.away_goals else 'A')


def _market_probs(conn, match_id: str, kickoff: datetime):
    with conn.cursor() as cur:
        cur.execute("""
          with candidate_fixture as (
            select id from public.fixtures where provider_ids->>'api_football'=%s limit 1
          ), latest as (
            select os.bookmaker_id, os.selection, os.odds, os.captured_at,
                   row_number() over(partition by os.bookmaker_id,os.selection order by os.captured_at desc) rn
              from public.odds_snapshots os join candidate_fixture cf on cf.id=os.fixture_id
             where os.captured_at < %s and os.market_key in ('1X2','match_result','home_draw_away') and os.odds > 1
          ) select bookmaker_id,selection,odds,captured_at from latest where rn=1
        """, (str(match_id), kickoff)); latest_rows=cur.fetchall()
        cur.execute("""
          with candidate_fixture as (
            select id from public.fixtures where provider_ids->>'api_football'=%s limit 1
          ), opening as (
            select os.bookmaker_id, os.selection, os.odds, os.captured_at,
                   row_number() over(partition by os.bookmaker_id,os.selection order by os.captured_at asc) rn
              from public.odds_snapshots os join candidate_fixture cf on cf.id=os.fixture_id
             where os.captured_at < %s and os.market_key in ('1X2','match_result','home_draw_away') and os.odds > 1
          ) select bookmaker_id,selection,odds,captured_at from opening where rn=1
        """, (str(match_id), kickoff)); opening_rows=cur.fetchall()
    mapping={'HOME':'H','H':'H','1':'H','DRAW':'D','D':'D','X':'D','AWAY':'A','A':'A','2':'A'}
    def grouped(rows):
        result={}
        for r in rows:
            sel=mapping.get(str(r['selection']).strip().upper())
            if not sel: continue
            try: odds=float(r['odds'])
            except (TypeError,ValueError): continue
            if odds<=1: continue
            result.setdefault(r['bookmaker_id'],{})[sel]=(odds,r['captured_at'])
        return result
    opens,closes=grouped(opening_rows),grouped(latest_rows); normalized=[]; clvs=[]
    for bookmaker_id, close in closes.items():
        if set(close) != {'H','D','A'} or bookmaker_id not in opens or set(opens[bookmaker_id]) != {'H','D','A'}: continue
        op=opens[bookmaker_id]; cp=close
        oi=[1.0/op[k][0] for k in ('H','D','A')]; ci=[1.0/cp[k][0] for k in ('H','D','A')]; sc=sum(ci)
        close_p={k:v/sc for k,v in zip(('H','D','A'),ci)}
        normalized.append((close_p['H'],close_p['D'],close_p['A'],cp['H'][1],bookmaker_id))
        clvs.extend((k,(op[k][0]/cp[k][0])-1.0) for k in ('H','D','A'))
    if not normalized: return None
    return (*tuple(sum(x[i] for x in normalized)/len(normalized) for i in range(3)), max(x[3] for x in normalized if x[3] is not None), clvs)


def empirical_probs(train):
    c=Counter(outcome(m) for m in train); n=sum(c.values())+3
    return ((c['H']+1)/n,(c['D']+1)/n,(c['A']+1)/n)


def score(p,y):
    actual={'H':(1.,0.,0.),'D':(0.,1.,0.),'A':(0.,0.,1.)}[y]
    probs=[max(1e-15,float(x)) for x in p]; s=sum(probs); probs=[x/s for x in probs]; idx={'H':0,'D':1,'A':2}[y]
    return (sum((a-b)**2 for a,b in zip(probs,actual)),-math.log(probs[idx]),((probs[0]-actual[0])**2+(probs[0]+probs[1]-actual[0]-actual[1])**2)/2.0,max(probs),1 if max(range(3),key=lambda i:probs[i])==idx else 0)


def ece(rows):
    if not rows: return None
    bins=[{'n':0,'conf':0.,'correct':0.} for _ in range(10)]
    for r in rows:
        i=min(9,int(r['confidence']*10)); b=bins[i]; b['n']+=1; b['conf']+=r['confidence']; b['correct']+=r['correct']
    n=len(rows)
    return sum((b['n']/n)*abs(b['correct']/b['n']-b['conf']/b['n']) for b in bins if b['n'])


def _flush(conn, buffer):
    if not buffer: return 0
    with conn.cursor() as cur:
        cur.executemany(INSERT_SQL, buffer)
    conn.commit()
    return len(buffer)


def main(training_run_id: str|None=None):
    with db_connect() as conn:
        requested_run=training_run_id or os.environ.get('PREDICTION_TRAINING_RUN_ID','').strip()
        if requested_run:
            row=conn.execute("select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where id=%s",(requested_run,)).fetchone()
        else:
            row=conn.execute("select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
        if not row: raise SystemExit('unknown prediction training run')
        if row['status'] != 'SUCCEEDED': raise SystemExit(f'training run is not succeeded:{row["id"]}')
        training_run_id=row['id']; model_version_id=row['model_version_id']
        matches=load_settled_matches(conn, as_of=datetime.now(timezone.utc))
        folds=[r for r in conn.execute("select fold_no,train_cutoff,test_start,test_end,status from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no",(training_run_id,)).fetchall()]
        if not folds: raise SystemExit('no succeeded training folds')
        wf=build_walk_forward_folds(matches,[r['train_cutoff'] for r in folds])
        conn.execute("delete from internal.prediction_oos_benchmark where training_run_id=%s",(training_run_id,))
        conn.execute("delete from internal.evaluation_metrics where run_id in (select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,))
        conn.execute("delete from internal.evaluation_folds where run_id in (select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,))
        conn.execute("delete from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS'",(model_version_id,)); conn.commit()
        model_rows=[]; emp_rows=[]; market_rows=[]; clv_values=[]
        eval_run=conn.execute("insert into internal.evaluation_runs(model_version_id,benchmark_type,status,started_at,metadata) values (%s,'WALK_FORWARD_OOS','RUNNING',now(),%s) returning id::text as id",(model_version_id,json.dumps({'training_run_id':training_run_id,'source':'s3_fixture_archive'}))).fetchone()['id']; conn.commit()
        persisted_keys=set()
        for fold_db,(train,test,cutoff) in zip(folds,wf):
            if not train or not test: continue
            eval_fold=conn.execute("insert into internal.evaluation_folds(run_id,fold_no,train_cutoff,test_start,test_end,status,metadata) values (%s,%s,%s,%s,%s,'RUNNING',%s) returning id::text as id",(eval_run,fold_db['fold_no'],cutoff,min(m.played_at for m in test),max(m.played_at for m in test),json.dumps({'training_run_id':training_run_id}))).fetchone()['id']; conn.commit()
            preds=run_fold(train,test,cutoff); emp=empirical_probs(train); fold_model=[]; buffer=[]
            for m,pred in zip(test,preds):
                key=(training_run_id,int(fold_db['fold_no']),str(m.match_id))
                if key in persisted_keys: continue
                persisted_keys.add(key)
                y=outcome(m); mp=(pred.p_home,pred.p_draw,pred.p_away); ms=score(mp,y); ep=score(emp,y); market=_market_probs(conn,m.match_id,m.played_at); kp=score(market[:3],y) if market else None
                model_rows.append({'confidence':ms[3],'correct':ms[4],'score':ms}); emp_rows.append({'confidence':ep[3],'correct':ep[4],'score':ep}); fold_model.append(ms)
                if kp: market_rows.append({'confidence':kp[3],'correct':kp[4],'score':kp})
                clv=None
                if market and market[4]:
                    predicted=['H','D','A'][max(range(3),key=lambda i:mp[i])]; vals=[v for k,v in market[4] if k==predicted]
                    if vals: clv=sum(vals)/len(vals); clv_values.extend(vals)
                buffer.append((training_run_id,model_version_id,m.match_id,fold_db['fold_no'],m.played_at,y,mp[0],mp[1],mp[2],emp[0],emp[1],emp[2],market[0] if market else None,market[1] if market else None,market[2] if market else None,market[3] if market else None,json.dumps({'model':{'brier':ms[0],'log_loss':ms[1],'rps':ms[2]},'empirical':{'brier':ep[0],'log_loss':ep[1],'rps':ep[2]},'market':{'brier':kp[0],'log_loss':kp[1],'rps':kp[2]} if kp else None,'clv':clv,'clv_status':'AVAILABLE' if clv is not None else 'UNAVAILABLE'})))
                if len(buffer)>=BATCH_SIZE: _flush(conn,buffer); buffer=[]
            _flush(conn,buffer)
            n=len(fold_model)
            if not n: continue
            fm={'brier':sum(x[0] for x in fold_model)/n,'log_loss':sum(x[1] for x in fold_model)/n,'rps':sum(x[2] for x in fold_model)/n,'n':n,'ece':ece([{'confidence':x[3],'correct':x[4]} for x in fold_model])}
            with conn.cursor() as cur:
                cur.executemany("insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) values (%s,%s,%s,%s,%s,%s,%s)",[(eval_run,eval_fold,'ALL','Brier',fm['brier'],n,json.dumps({'model':'prediction_engine'})),(eval_run,eval_fold,'ALL','LogLoss',fm['log_loss'],n,'{}'),(eval_run,eval_fold,'ALL','RPS',fm['rps'],n,'{}'),(eval_run,eval_fold,'ALL','ECE',fm['ece'],n,'{}')])
            conn.execute("update internal.evaluation_folds set status='SUCCEEDED' where id=%s",(eval_fold,)); conn.commit()
        n=len(model_rows); mn=len(market_rows)
        model={'n':n,'brier':sum(r['score'][0] for r in model_rows)/n if n else None,'log_loss':sum(r['score'][1] for r in model_rows)/n if n else None,'rps':sum(r['score'][2] for r in model_rows)/n if n else None,'ece':ece(model_rows)}
        empirical={'n':len(emp_rows),'brier':sum(r['score'][0] for r in emp_rows)/len(emp_rows) if emp_rows else None,'log_loss':sum(r['score'][1] for r in emp_rows)/len(emp_rows) if emp_rows else None,'rps':sum(r['score'][2] for r in emp_rows)/len(emp_rows) if emp_rows else None,'ece':ece(emp_rows)}
        market={'n':mn,'coverage':mn/n if n else 0.,'brier':sum(r['score'][0] for r in market_rows)/mn if mn else None,'log_loss':sum(r['score'][1] for r in market_rows)/mn if mn else None,'rps':sum(r['score'][2] for r in market_rows)/mn if mn else None,'ece':ece(market_rows) if market_rows else None}
        clv={'n':len(clv_values),'mean':sum(clv_values)/len(clv_values) if clv_values else None,'status':'AVAILABLE' if clv_values else 'UNAVAILABLE_NO_OPEN_CLOSE_SNAPSHOTS'}
        completed_folds=conn.execute("select count(*) as n from internal.evaluation_folds where run_id=%s and status='SUCCEEDED'",(eval_run,)).fetchone()['n']
        summary={'oos_n':n,'model':model,'empirical_baseline':empirical,'market':market,'clv':clv,'history_gate':{'min_oos_predictions':MIN_OOS_PREDICTIONS,'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'oos_predictions_pass':n>=MIN_OOS_PREDICTIONS,'oos_seasons_pass':completed_folds>=MIN_COMPLETE_SEASONS},'evaluation_run_id':eval_run,'training_run_id':training_run_id,'model_version_id':model_version_id}
        conn.execute("update internal.evaluation_runs set status='SUCCEEDED',finished_at=now(),metadata=metadata||%s::jsonb where id=%s",(json.dumps({'summary':summary}),eval_run)); conn.commit()
        conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(json.dumps({'benchmark':summary}),training_run_id)); conn.commit()
        print(json.dumps(summary,sort_keys=True)); return summary

if __name__=='__main__': main()
