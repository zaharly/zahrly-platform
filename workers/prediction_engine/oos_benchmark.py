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
            select os.bookmaker_id, os.selection, os.odds, os.captured_at,
                   row_number() over(partition by os.bookmaker_id,os.selection order by os.captured_at desc) rn
              from public.odds_snapshots os join candidate_fixture cf on cf.id=os.fixture_id
             where os.captured_at < %s and os.market_key in ('1X2','match_result','home_draw_away') and os.odds > 1
          )
          select bookmaker_id,selection,odds,captured_at from latest where rn=1
        """, (str(match_id), kickoff))
        latest_rows=cur.fetchall()
        cur.execute("""
          with candidate_fixture as (
            select id from public.fixtures where provider_ids->>'api_football'=%s limit 1
          ), per_price as (
            select os.bookmaker_id, os.selection, os.odds, os.captured_at,
                   row_number() over(partition by os.bookmaker_id,os.selection order by os.captured_at asc) rn
              from public.odds_snapshots os join candidate_fixture cf on cf.id=os.fixture_id
             where os.captured_at < %s and os.market_key in ('1X2','match_result','home_draw_away') and os.odds > 1
          )
          select bookmaker_id,selection,odds,captured_at from per_price where rn=1
        """, (str(match_id), kickoff))
        opening_rows=cur.fetchall()
    mapping={'HOME':'H','H':'H','1':'H','DRAW':'D','D':'D','X':'D','AWAY':'A','A':'A','2':'A'}
    def grouped(rows):
        grouped={}
        for r in rows:
            sel=mapping.get(str(r['selection']).strip().upper())
            if not sel: continue
            try: odds=float(r['odds'])
            except (TypeError,ValueError): continue
            if odds<=1: continue
            grouped.setdefault(r['bookmaker_id'],{})[sel]=(odds,r['captured_at'])
        return grouped
    opens,closes=grouped(opening_rows),grouped(latest_rows)
    normalized=[]; clvs=[]
    for bookmaker_id, close in closes.items():
        if set(close) != {'H','D','A'} or bookmaker_id not in opens or set(opens[bookmaker_id]) != {'H','D','A'}: continue
        open_set=opens[bookmaker_id]
        close_set=close
        open_imp=[1.0/open_set[k][0] for k in ('H','D','A')]; close_imp=[1.0/close_set[k][0] for k in ('H','D','A')]
        so,sc=sum(open_imp),sum(close_imp)
        open_p={k:v/so for k,v in zip(('H','D','A'),open_imp)}; close_p={k:v/sc for k,v in zip(('H','D','A'),close_imp)}
        normalized.append((close_p['H'],close_p['D'],close_p['A'],close['H'][1],bookmaker_id))
        for key in ('H','D','A'):
            clvs.append((key,(open_set[key][0]/close_set[key][0])-1.0))
    if not normalized: return None
    market_prob=tuple(sum(x[i] for x in normalized)/len(normalized) for i in range(3))
    latest=max(x[3] for x in normalized if x[3] is not None)
    return (*market_prob,latest,clvs)


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
            row=conn.execute("select id::text as id,model_version_id::text as model_version_id from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
            if not row: raise SystemExit('no succeeded training run')
            training_run_id=row['id']; model_version_id=row['model_version_id']
        else:
            row=conn.execute("select id::text as id,model_version_id::text as model_version_id from internal.prediction_training_runs where id=%s",(training_run_id,)).fetchone()
            if not row: raise SystemExit('unknown training run')
            model_version_id=row['model_version_id']
        matches=load_settled_matches(conn, as_of=datetime.now(timezone.utc))
        folds=[r for r in conn.execute("select fold_no,train_cutoff,test_start,test_end,status from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no",(training_run_id,)).fetchall()]
        cutoffs=[r['train_cutoff'] for r in folds]
        wf=build_walk_forward_folds(matches,cutoffs)
        conn.execute("delete from internal.prediction_oos_benchmark where training_run_id=%s",(training_run_id,))
        conn.execute("delete from internal.evaluation_metrics where run_id in (select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,))
        conn.execute("delete from internal.evaluation_folds where run_id in (select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,))
        conn.execute("delete from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS'",(model_version_id,))
        model_rows=[]; emp_rows=[]; market_rows=[]; clv_values=[]
        with conn.transaction():
            eval_run=conn.execute("insert into internal.evaluation_runs(model_version_id,benchmark_type,status,started_at,metadata) values (%s,'WALK_FORWARD_OOS','RUNNING',now(),%s) returning id::text as id",(model_version_id,json.dumps({'training_run_id':training_run_id,'source':'s3_fixture_archive'}))).fetchone()['id']
            for fold_db,(train,test,cutoff) in zip(folds,wf):
                if not train or not test: continue
                eval_fold=conn.execute("insert into internal.evaluation_folds(run_id,fold_no,train_cutoff,test_start,test_end,status,metadata) values (%s,%s,%s,%s,%s,'SUCCEEDED',%s) returning id::text as id",(eval_run,fold_db['fold_no'],cutoff,min(m.played_at for m in test),max(m.played_at for m in test),json.dumps({'training_run_id':training_run_id}))).fetchone()['id']
                preds=run_fold(train,test,cutoff); emp=empirical_probs(train); fold_model=[]; fold_emp=[]; fold_market=[]; fold_clv=[]
                for m,pred in zip(test,preds):
                    y=outcome(m); mp=(pred.p_home,pred.p_draw,pred.p_away); ms=score(mp,y); ep=score(emp,y); market=_market_probs(conn,m.match_id,m.played_at); kp=score(market[:3],y) if market else None
                    row={'confidence':ms[3],'correct':ms[4],'score':ms,'p':mp,'m':m,'market':market}; model_rows.append(row); emp_rows.append({'confidence':ep[3],'correct':ep[4],'score':ep}); fold_model.append(ms); fold_emp.append(ep)
                    if kp:
                        market_rows.append({'confidence':kp[3],'correct':kp[4],'score':kp}); fold_market.append(kp)
                    clv=None
                    if market and market[4]:
                        predicted=['H','D','A'][max(range(3),key=lambda i:mp[i])]
                        vals=[v for k,v in market[4] if k==predicted]
                        if vals: clv=sum(vals)/len(vals); clv_values.extend(vals); fold_clv.extend(vals)
                    actual={'H':(1.,0.,0.),'D':(0.,1.,0.),'A':(0.,0.,1.)}[y]
                    conn.execute("insert into internal.prediction_oos_benchmark(training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (training_run_id,model_version_id,m.match_id,fold_db['fold_no'],m.played_at,y,mp[0],mp[1],mp[2],emp[0],emp[1],emp[2],market[0] if market else None,market[1] if market else None,market[2] if market else None,market[3] if market else None,json.dumps({'model':{'brier':ms[0],'log_loss':ms[1],'rps':ms[2]},'empirical':{'brier':ep[0],'log_loss':ep[1],'rps':ep[2]},'market':{'brier':kp[0],'log_loss':kp[1],'rps':kp[2]} if kp else None,'clv':clv,'clv_status':'AVAILABLE' if clv is not None else 'UNAVAILABLE'})))
                n=len(fold_model); mn=len(fold_market)
                fm={'brier':sum(x[0] for x in fold_model)/n,'log_loss':sum(x[1] for x in fold_model)/n,'rps':sum(x[2] for x in fold_model)/n,'n':n,'ece':sum(abs(x[3]) for x in fold_model)/n if n else None}
                fe={'brier':sum(x[0] for x in fold_emp)/n,'log_loss':sum(x[1] for x in fold_emp)/n,'rps':sum(x[2] for x in fold_emp)/n,'n':len(fold_emp),'ece':sum(abs(x[3]) for x in fold_emp)/len(fold_emp) if fold_emp else None}
                conn.execute("insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) values (%s,%s,'ALL','Brier',%s,%s,%s),(%s,%s,'ALL','LogLoss',%s,%s,%s),(%s,%s,'ALL','RPS',%s,%s,%s),(%s,%s,'ALL','ECE',%s,%s,%s)",(eval_run,eval_fold,fm['brier'],n,json.dumps({'model':'prediction_engine'}),eval_run,eval_fold,fm['log_loss'],n,'{}',eval_run,eval_fold,fm['rps'],n,'{}',eval_run,eval_fold,fm['ece'],n,'{}'))
                if mn:
                    conn.execute("insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) values (%s,%s,'MARKET','Brier',%s,%s,'{}'),(%s,%s,'MARKET','LogLoss',%s,%s,'{}'),(%s,%s,'MARKET','RPS',%s,%s,'{}')",(eval_run,eval_fold,sum(x[0] for x in fold_market)/mn,mn,eval_run,eval_fold,sum(x[1] for x in fold_market)/mn,mn,eval_run,eval_fold,sum(x[2] for x in fold_market)/mn,mn))
            n=len(model_rows); mn=len(market_rows); model={'n':n,'brier':sum(r['score'][0] for r in model_rows)/n,'log_loss':sum(r['score'][1] for r in model_rows)/n,'rps':sum(r['score'][2] for r in model_rows)/n,'ece':ece(model_rows)}; empirical={'n':len(emp_rows),'brier':sum(r['score'][0] for r in emp_rows)/len(emp_rows),'log_loss':sum(r['score'][1] for r in emp_rows)/len(emp_rows),'rps':sum(r['score'][2] for r in emp_rows)/len(emp_rows),'ece':ece(emp_rows)}; market={'n':mn,'coverage':mn/n if n else 0.,'brier':sum(r['score'][0] for r in market_rows)/mn if mn else None,'log_loss':sum(r['score'][1] for r in market_rows)/mn if mn else None,'rps':sum(r['score'][2] for r in market_rows)/mn if mn else None,'ece':ece(market_rows)}
            clv={'n':len(clv_values),'mean':sum(clv_values)/len(clv_values) if clv_values else None,'status':'AVAILABLE' if clv_values else 'UNAVAILABLE_NO_OPEN_CLOSE_SNAPSHOTS'}
            summary={'oos_n':n,'model':model,'empirical_baseline':empirical,'market':market,'clv':clv,'history_gate':{'min_oos_predictions':MIN_OOS_PREDICTIONS,'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'oos_predictions_pass':n>=MIN_OOS_PREDICTIONS,'oos_seasons_pass':len(folds)>=MIN_COMPLETE_SEASONS},'evaluation_run_id':eval_run}
            conn.execute("update internal.evaluation_runs set status='SUCCEEDED',finished_at=now(),metadata=metadata||%s::jsonb where id=%s",(json.dumps({'summary':summary}),eval_run))
            conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(json.dumps({'benchmark':summary}),training_run_id))
        print(json.dumps(summary,sort_keys=True)); return summary

if __name__=='__main__': main()
