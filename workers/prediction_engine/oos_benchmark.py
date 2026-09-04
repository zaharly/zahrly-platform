from __future__ import annotations
import json,math,os
from collections import Counter
from datetime import datetime,timezone
import psycopg
from psycopg.rows import dict_row
from .archive_training_source import load_settled_matches
from .historical_market import load_archive_pre_match_market_probs
from .walk_forward import build_walk_forward_folds,run_fold,fit_temperature
from .feature_layer import build_feature_index
MIN_COMPLETE_SEASONS=3;MIN_OOS_PREDICTIONS=3000
INSERT_SQL="""insert into internal.prediction_oos_benchmark(training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (training_run_id,fold_no,fixture_id) do nothing"""
def db_connect():
 c=psycopg.connect(os.environ['SUPABASE_DB_URL'],row_factory=dict_row,connect_timeout=20,sslmode='require');c.execute('set session statement_timeout=0');c.execute('set session lock_timeout=0');return c
def outcome(m):return 'H' if m.home_goals>m.away_goals else ('D' if m.home_goals==m.away_goals else 'A')
def _market_probs_batch(conn,requested):
 if not requested:return {}
 payload=json.dumps([{'match_id':str(mid),'kickoff':kick.isoformat()} for mid,kick in requested.items()],separators=(',',':'))
 rows=conn.execute("""with requested as(select * from jsonb_to_recordset(%s::jsonb) as x(match_id text,kickoff timestamptz)) select r.match_id,os.bookmaker_id,os.selection,os.odds,os.captured_at from requested r join public.fixtures f on f.provider_ids->>'api_football'=r.match_id join public.odds_snapshots os on os.fixture_id=f.id where os.captured_at<r.kickoff and os.market_key in ('1X2','match_result','home_draw_away') and os.odds>1 order by r.match_id,os.bookmaker_id,os.selection,os.captured_at""",(payload,)).fetchall()
 mapping={'HOME':'H','H':'H','1':'H','DRAW':'D','D':'D','X':'D','AWAY':'A','A':'A','2':'A'};grouped={}
 for r in rows:
  s=mapping.get(str(r['selection']).strip().upper())
  try:o=float(r['odds'])
  except (TypeError,ValueError):continue
  if not s or o<=1:continue
  grouped.setdefault(r['match_id'],{}).setdefault(r['bookmaker_id'],{}).setdefault(s,[]).append((o,r['captured_at']))
 out={}
 for mid,books in grouped.items():
  norm=[];clv=[]
  for bid,selections in books.items():
   if set(selections)!= {'H','D','A'}:continue
   opening={k:sorted(selections[k],key=lambda x:x[1])[0] for k in selections};closing={k:sorted(selections[k],key=lambda x:x[1])[-1] for k in selections}
   inv=[1/closing[k][0] for k in ('H','D','A')];scale=sum(inv);p=[x/scale for x in inv]
   norm.append((p[0],p[1],p[2],max(closing[k][1] for k in closing)))
   clv.extend((k,opening[k][0]/closing[k][0]-1) for k in ('H','D','A'))
  if norm:out[mid]=(sum(x[0] for x in norm)/len(norm),sum(x[1] for x in norm)/len(norm),sum(x[2] for x in norm)/len(norm),max(x[3] for x in norm),clv)
 return out
def empirical_probs(train):
 c=Counter(outcome(m) for m in train);n=sum(c.values())+3;return ((c['H']+1)/n,(c['D']+1)/n,(c['A']+1)/n)
def score(p,y):
 a={'H':(1.,0.,0.),'D':(0.,1.,0.),'A':(0.,0.,1.)}[y];q=[max(1e-15,float(x)) for x in p];s=sum(q);q=[x/s for x in q];i={'H':0,'D':1,'A':2}[y];return(sum((x-z)**2 for x,z in zip(q,a)),-math.log(q[i]),((q[0]-a[0])**2+(q[0]+q[1]-a[0]-a[1])**2)/2,max(q),int(max(range(3),key=lambda j:q[j])==i))
def ece(rows):
 if not rows:return None
 bins=[{'n':0,'c':0.,'a':0.} for _ in range(10)]
 for r in rows:
  b=bins[min(9,int(r['confidence']*10))];b['n']+=1;b['c']+=r['confidence'];b['a']+=r['correct']
 n=len(rows);return sum((b['n']/n)*abs(b['a']/b['n']-b['c']/b['n']) for b in bins if b['n'])
def calibration_bins(rows):
 bins=[{'n':0,'confidence_sum':0.,'correct_sum':0.} for _ in range(10)]
 for r in rows:
  b=bins[min(9,int(r['confidence']*10))];b['n']+=1;b['confidence_sum']+=r['confidence'];b['correct_sum']+=r['correct']
 return [{'bin':i,'n':b['n'],'mean_confidence':b['confidence_sum']/b['n'] if b['n'] else None,'accuracy':b['correct_sum']/b['n'] if b['n'] else None,'gap':abs(b['correct_sum']/b['n']-b['confidence_sum']/b['n']) if b['n'] else None} for i,b in enumerate(bins)]
def _calibration_split(train):
 ordered=sorted(train,key=lambda m:m.played_at)
 if len(ordered)<12:return [],[]
 n=max(12,int(len(ordered)*0.30));n=min(n,len(ordered)-1)
 return ordered[:-n],ordered[-n:]
def main(training_run_id=None):
 with db_connect() as conn:
  requested=training_run_id or os.environ.get('PREDICTION_TRAINING_RUN_ID','').strip();sql="select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where id=%s" if requested else "select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1";row=conn.execute(sql,(requested,) if requested else ()).fetchone()
  if not row:raise SystemExit('unknown prediction training run')
  if row['status']!='SUCCEEDED':raise SystemExit(f"training run is not succeeded:{row['id']}")
  training_run_id=row['id'];model_version_id=row['model_version_id'];matches=load_settled_matches(conn,as_of=datetime.now(timezone.utc));folds=conn.execute("select fold_no,train_cutoff,test_start,test_end,status from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no",(training_run_id,)).fetchall()
  if not folds:raise SystemExit('no succeeded training folds')
  wf=build_walk_forward_folds(matches,[r['train_cutoff'] for r in folds]);usable=[(fd,w) for fd,w in zip(folds,wf) if w[0] and w[1]];all_oos=[m for _,(_,test,_) in usable for m in test]
  calibration_sets=[_calibration_split(train)[1] for _,(train,_,_) in usable]
  feature_targets=all_oos+[m for subset in calibration_sets for m in subset]
  all_features=build_feature_index(conn,feature_targets,min(m.played_at for m in feature_targets)) if feature_targets else {}
  market_requests={m.match_id:m.played_at for m in all_oos};market_by_match=_market_probs_batch(conn,market_requests);archive_market=load_archive_pre_match_market_probs(conn,market_requests);market_by_match.update(archive_market)
  conn.execute('delete from internal.prediction_oos_benchmark where training_run_id=%s',(training_run_id,));conn.execute("delete from internal.evaluation_metrics where run_id in(select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,));conn.execute("delete from internal.evaluation_folds where run_id in(select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS')",(model_version_id,));conn.execute("delete from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS'",(model_version_id,));conn.commit();model_rows=[];emp_rows=[];market_rows=[];clv_values=[];feature_cov=[];calibration_meta=[];calibration_pool=[]
  eval_run=conn.execute("insert into internal.evaluation_runs(model_version_id,benchmark_type,status,started_at,metadata) values(%s,'WALK_FORWARD_OOS','RUNNING',now(),%s) returning id::text as id",(model_version_id,json.dumps({'training_run_id':training_run_id,'source':'s3_fixture_archive','feature_layer':'enabled','market_lookup':'db_plus_s3_archive','calibration':'chronological cross-fold temperature-plus-class-bias scaling'}))).fetchone()['id'];conn.commit()
  try:
   for fd,(train,test,cutoff) in usable:
    features={m.match_id:all_features[m.match_id] for m in test if m.match_id in all_features};cal_train,cal_test=_calibration_split(train);temperature=1.0;calibration_bias=(0.0,0.0,0.0);cal_meta={'status':'INSUFFICIENT_CALIBRATION_DATA','n':len(calibration_pool),'temperature':1.0,'bias':[0.0,0.0,0.0],'own_calibration_n':len(cal_test),'pooled_prior_n':len(calibration_pool),'method':'temperature_plus_bias'}
    if cal_train and cal_test:
     cal_features={m.match_id:all_features[m.match_id] for m in cal_test if m.match_id in all_features}
     raw_cal=run_fold(cal_train,cal_test,min(m.played_at for m in cal_test),features=cal_features,temperature=1.0,calibration_bias=(0.0,0.0,0.0))
     current_pairs=list(zip(raw_cal,[outcome(m) for m in cal_test]));calibration_pool.extend(current_pairs)
     if len(calibration_pool)>=12:
      temperature,cal_meta=fit_temperature([p for p,_ in calibration_pool],[y for _,y in calibration_pool]);calibration_bias=tuple(cal_meta.get('bias',[0.0,0.0,0.0]));cal_meta.update({'own_calibration_n':len(cal_test),'pooled_prior_n':len(calibration_pool)-len(current_pairs),'feature_covered':sum(1 for m in cal_test if all_features.get(m.match_id) and all_features[m.match_id].values),'method':'temperature_plus_bias'})
    calibration_meta.append({'fold_no':fd['fold_no'],**cal_meta})
    preds=run_fold(train,test,cutoff,features=features,temperature=temperature,calibration_bias=calibration_bias);emp=empirical_probs(train);covered=sum(bool(features.get(m.match_id) and features[m.match_id].values) for m in test);feature_cov.append(covered);fold_scores=[]
    eval_fold=conn.execute("insert into internal.evaluation_folds(run_id,fold_no,train_cutoff,test_start,test_end,status,metadata) values(%s,%s,%s,%s,%s,'RUNNING',%s) returning id::text as id",(eval_run,fd['fold_no'],cutoff,min(m.played_at for m in test),max(m.played_at for m in test),json.dumps({'training_run_id':training_run_id,'feature_covered_fixtures':covered,'calibration':cal_meta}))).fetchone()['id'];conn.commit()
    buf=[]
    for m,p in zip(test,preds):
     y=outcome(m);ms=score((p.p_home,p.p_draw,p.p_away),y);es=score(emp,y);market=market_by_match.get(m.match_id);ks=score(market[:3],y) if market else None;model_rows.append({'confidence':ms[3],'correct':ms[4],'score':ms});emp_rows.append({'confidence':es[3],'correct':es[4],'score':es});fold_scores.append(ms)
     if ks:market_rows.append({'confidence':ks[3],'correct':ks[4],'score':ks})
     clv=None
     if market and market[4]:
      predicted=('H','D','A')[max(range(3),key=lambda i:(p.p_home,p.p_draw,p.p_away)[i])];vals=[v for k,v in market[4] if k==predicted]
      if vals:clv=sum(vals)/len(vals);clv_values.extend(vals)
     fs=features.get(m.match_id);buf.append((training_run_id,model_version_id,m.match_id,fd['fold_no'],m.played_at,y,p.p_home,p.p_draw,p.p_away,emp[0],emp[1],emp[2],market[0] if market else None,market[1] if market else None,market[2] if market else None,market[3] if market else None,json.dumps({'model':{'brier':ms[0],'log_loss':ms[1],'rps':ms[2]},'feature_sources':list(fs.sources) if fs else [],'feature_count':len(fs.values) if fs else 0,'calibration':cal_meta,'clv_status':'AVAILABLE' if clv is not None else 'UNAVAILABLE'})))
    with conn.cursor() as cur:cur.executemany(INSERT_SQL,buf)
    n=len(fold_scores);fm={'brier':sum(x[0] for x in fold_scores)/n,'log_loss':sum(x[1] for x in fold_scores)/n,'rps':sum(x[2] for x in fold_scores)/n,'n':n,'ece':ece([{'confidence':x[3],'correct':x[4]} for x in fold_scores]),'reliability_bins':calibration_bins([{'confidence':x[3],'correct':x[4]} for x in fold_scores])};conn.execute("insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) values(%s,%s,'ALL','Brier',%s,%s,%s),(%s,%s,'ALL','LogLoss',%s,%s,'{}'),(%s,%s,'ALL','RPS',%s,%s,'{}'),(%s,%s,'ALL','ECE',%s,%s,%s)",(eval_run,eval_fold,fm['brier'],n,json.dumps({'model':'prediction_engine','calibration':cal_meta}),eval_run,eval_fold,fm['log_loss'],n,eval_run,eval_fold,fm['rps'],n,eval_run,eval_fold,fm['ece'],n,json.dumps({'calibration':cal_meta,'reliability_bins':fm['reliability_bins']})));conn.execute("update internal.evaluation_folds set status='SUCCEEDED' where id=%s",(eval_fold,));conn.commit()
   n=len(model_rows);mn=len(market_rows);summary={'oos_n':n,'model':{'n':n,'brier':sum(r['score'][0] for r in model_rows)/n if n else None,'log_loss':sum(r['score'][1] for r in model_rows)/n if n else None,'rps':sum(r['score'][2] for r in model_rows)/n if n else None,'ece':ece(model_rows),'reliability_bins':calibration_bins(model_rows)},'empirical_baseline':{'n':len(emp_rows),'brier':sum(r['score'][0] for r in emp_rows)/len(emp_rows) if emp_rows else None,'log_loss':sum(r['score'][1] for r in emp_rows)/len(emp_rows) if emp_rows else None,'rps':sum(r['score'][2] for r in emp_rows)/len(emp_rows) if emp_rows else None,'ece':ece(emp_rows)},'market':{'n':mn,'coverage':mn/n if n else 0.,'brier':sum(r['score'][0] for r in market_rows)/mn if mn else None,'log_loss':sum(r['score'][1] for r in market_rows)/mn if mn else None,'rps':sum(r['score'][2] for r in market_rows)/mn if mn else None},'clv':{'n':len(clv_values),'mean':sum(clv_values)/len(clv_values) if clv_values else None,'status':'AVAILABLE' if clv_values else 'UNAVAILABLE_NO_OPEN_CLOSE_SNAPSHOTS'},'feature_layer':{'enabled':True,'covered_fixtures':sum(feature_cov),'feature_coverage':sum(feature_cov)/n if n else 0.,'datasets':'historical_archive'},'calibration':{'method':'chronological_cross_fold_temperature_plus_class_bias','folds':calibration_meta,'calibration_pool_n':len(calibration_pool)},'history_gate':{'min_oos_predictions':MIN_OOS_PREDICTIONS,'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'oos_predictions_pass':n>=MIN_OOS_PREDICTIONS,'oos_seasons_pass':len(usable)>=MIN_COMPLETE_SEASONS},'evaluation_run_id':eval_run,'training_run_id':training_run_id,'model_version_id':model_version_id};conn.execute("update internal.evaluation_runs set status='SUCCEEDED',finished_at=now(),metadata=metadata||%s::jsonb where id=%s",(json.dumps({'summary':summary}),eval_run));conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(json.dumps({'benchmark':summary}),training_run_id));conn.commit();print(json.dumps(summary,sort_keys=True));return summary
  except Exception as exc:
   conn.execute("update internal.evaluation_runs set status='FAILED',finished_at=now(),metadata=metadata||%s::jsonb where id=%s",(json.dumps({'error':str(exc)[:2000]}),eval_run));conn.commit();raise
if __name__=='__main__':main()