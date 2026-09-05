from __future__ import annotations
# Training source invariant: archive preflight must provide the complete season set.
import hashlib,json,os
from datetime import datetime,timezone
from math import log
from urllib.parse import quote,urlsplit,urlunsplit
import boto3,psycopg
from psycopg.rows import dict_row
from .archive_training_source import load_settled_matches
from .dixon_coles import DixonColesPolicy,time_decay_weight
from .elo import EloPolicy,EloState,update_elo
from .glicko import GlickoPolicy,initial_state,update_pair
from .season_resolver import normalize_season_label,season_start_year
from .walk_forward import _team_rates
MIN_OOS_SAMPLES=3000;MIN_COMPLETE_SEASONS=3;MODEL_VERSION_ADVISORY_LOCK_KEY=74123819

def _normalized_db_url():
 raw=os.environ.get('SUPABASE_DB_URL_RAW',os.environ.get('SUPABASE_DB_URL','')).strip();parts=urlsplit(raw)
 if parts.scheme not in {'postgres','postgresql'} or not parts.username or parts.password is None:raise RuntimeError('invalid SUPABASE_DB_URL')
 host=urlsplit(os.environ.get('SUPABASE_URL','')).hostname
 if not host:raise RuntimeError('invalid SUPABASE_URL')
 ref=host.split('.',1)[0];region=os.environ.get('SUPABASE_POOLER_REGION','eu-central-1');return urlunsplit((parts.scheme,f'{quote("postgres."+ref,safe="")}:{quote(parts.password,safe="")}@aws-0-{region}.pooler.supabase.com:5432','/postgres','sslmode=require',''))

def db_connect():
 c=psycopg.connect(_normalized_db_url(),row_factory=dict_row,connect_timeout=20,sslmode='require');c.execute('set session statement_timeout=0');c.execute('set session lock_timeout=0');return c

def _lock(c):c.execute('select pg_advisory_lock(%s)',(MODEL_VERSION_ADVISORY_LOCK_KEY,))
def _unlock(c):c.execute('select pg_advisory_unlock(%s)',(MODEL_VERSION_ADVISORY_LOCK_KEY,))

def _fit_elo(ms,cut,p):
 r={}
 for m in ms:
  if m.played_at>=cut:break
  h=r.get(m.home_team_id,EloState(p.initial_rating));a=r.get(m.away_team_id,EloState(p.initial_rating));r[m.home_team_id],r[m.away_team_id],_=update_elo(h,a,m.home_goals,m.away_goals,p)
 return r

def _fit_glicko(ms,cut,p):
 r={}
 for m in ms:
  if m.played_at>=cut:break
  h=r.get(m.home_team_id,initial_state(p));a=r.get(m.away_team_id,initial_state(p));r[m.home_team_id],r[m.away_team_id],_=update_pair(h,a,m.home_goals,m.away_goals,p)
 return r

def _fit_dc(ms,cut,p):
 return _team_rates(ms,cut,p)

def _validate_dc_fit(rate,attack,defense):
 if not isinstance(rate,(int,float)) or not (0.25 <= float(rate) <= 4.0):
  raise RuntimeError(f'prediction_training_gate_failed:invalid_dc_league_rate:{rate!r}')
 if len(attack) < 2 or len(defense) < 2:
  raise RuntimeError(f'prediction_training_gate_failed:insufficient_dc_team_parameters:attack={len(attack)}:defense={len(defense)}')
 vals=list(attack.values())+list(defense.values())
 if not all(isinstance(v,(int,float)) and v==v and abs(float(v))<100 for v in vals):
  raise RuntimeError('prediction_training_gate_failed:nonfinite_dc_team_parameters')
 if all(abs(float(v)) <= 1e-12 for v in vals):
  raise RuntimeError('prediction_training_gate_failed:dc_team_parameters_all_zero')

def _upload(payload,version):
 raw=json.dumps(payload,sort_keys=True,separators=(',',':')).encode();sha=hashlib.sha256(raw).hexdigest();s=boto3.client('s3',region_name=os.environ.get('S3_REGION','eu-north-1'),endpoint_url=os.environ.get('S3_ENDPOINT_URL') or None,aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY']);key=f'zahrly/models/prediction_engine/{version}.json';s.put_object(Bucket=os.environ['S3_BUCKET'],Key=key,Body=raw,ContentType='application/json',Metadata={'sha256':sha,'model_version':version});return f"s3://{os.environ['S3_BUCKET']}/{key}",sha

def _metrics(test,preds):
 n=len(preds);b=l=r=0.
 for m,p in zip(test,preds):
  probs=(max(1e-15,p.p_home),max(1e-15,p.p_draw),max(1e-15,p.p_away));a=0 if m.home_goals>m.away_goals else 1 if m.home_goals==m.away_goals else 2;y=tuple(1. if i==a else 0. for i in range(3));b+=sum((x-z)**2 for x,z in zip(probs,y));l-=log(probs[a]);r+=((probs[0]-y[0])**2+(probs[0]+probs[1]-y[0]-y[1])**2)/2
 return {'brier_1x2':b/n if n else None,'log_loss_1x2':l/n if n else None,'rps_1x2':r/n if n else None}

def build_cutoffs(matches):
 ordered=sorted(matches,key=lambda m:m.played_at);logical_by_match={m.match_id:normalize_season_label(m.season) for m in ordered};seasons=sorted({label for label in logical_by_match.values() if label is not None},key=lambda s:season_start_year(s) if season_start_year(s) is not None else 10**9)
 if len(seasons)>=2:return [min(m.played_at for m in ordered if logical_by_match[m.match_id]==season) for season in seasons[1:]]
 start=ordered[0].played_at;end=ordered[-1].played_at;s=start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc);e=end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc);return [datetime(y,1,1,tzinfo=timezone.utc) for y in range(s.year+1,e.year+1)]

def _season_set(rows):return {label for label in (normalize_season_label(m.season) for m in rows) if label is not None}

def _fold_gate(train,test,fc):
 if not train or not test:raise RuntimeError(f'prediction_training_gate_failed:empty_fold:cutoff={fc.isoformat()}')
 train_end=max(m.played_at for m in train);test_start=min(m.played_at for m in test)
 if train_end>=test_start:raise RuntimeError(f'prediction_training_gate_failed:walk_forward_time_overlap:cutoff={fc.isoformat()}:train_end={train_end.isoformat()}:test_start={test_start.isoformat()}')
 if any(m.played_at>=fc for m in train):raise RuntimeError(f'prediction_training_gate_failed:training_on_or_after_cutoff:cutoff={fc.isoformat()}')
 if any(m.played_at<fc for m in test):raise RuntimeError(f'prediction_training_gate_failed:test_before_cutoff:cutoff={fc.isoformat()}')
 train_seasons=sorted(_season_set(train),key=lambda s:season_start_year(s));test_seasons=sorted(_season_set(test),key=lambda s:season_start_year(s));overlap=sorted(set(train_seasons)&set(test_seasons),key=lambda s:season_start_year(s));return train_seasons,test_seasons,overlap,train_end,test_start

def _export_run_id(run_id):
 path=os.environ.get('GITHUB_ENV')
 if path:
  with open(path,'a',encoding='utf-8') as fh:fh.write(f'PREDICTION_TRAINING_RUN_ID={run_id}\n')

def main():
 started=datetime.now(timezone.utc)
 with db_connect() as conn:
  matches=load_settled_matches(conn,as_of=started)
  if len(matches)<30:raise RuntimeError(f'prediction_training_gate_failed:settled_matches={len(matches)}')
  from .walk_forward import build_walk_forward_folds,run_fold
  cutoffs=build_cutoffs(matches);folds=build_walk_forward_folds(matches,cutoffs)
  season_inventory={}
  for m in matches:
   label=normalize_season_label(m.season)
   if label is not None:season_inventory[label]=season_inventory.get(label,0)+1
  preview=[]
  for train,test,fc in folds:
   train_seasons,test_seasons,overlap,train_end,test_start=_fold_gate(train,test,fc);preview.append({'cutoff':fc.isoformat(),'train':len(train),'test':len(test),'train_seasons':train_seasons,'test_seasons':test_seasons,'season_overlap_diagnostic':overlap,'train_end':train_end.isoformat(),'test_start':test_start.isoformat()})
  version='p0-shadow-'+started.strftime('%Y%m%d%H%M%S');cutoff=started;_lock(conn)
  try:
   with conn.transaction():
    model_id=conn.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text as id",('prediction_engine',version,cutoff)).fetchone()['id'];run_id=conn.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text as id",(model_id,cutoff,started,json.dumps({'source':'s3_fixture_archive','settled_matches':len(matches),'feature_layer':'enabled','fold_strategy':'season_aware','archive_season_normalization':'code_only','season_inventory':season_inventory}))).fetchone()['id']
  finally:_unlock(conn)
  _export_run_id(run_id)
  print(json.dumps({'status':'STARTED','training_run_id':run_id,'model_version_id':model_id,'version':version,'settled_matches':len(matches),'candidate_oos_folds':len(folds),'season_inventory':season_inventory,'fold_preview':preview},sort_keys=True),flush=True)
  try:
   from .feature_layer import build_feature_index_for_matches
   summaries=[];total=tb=tl=tr=0.;oos_seasons=set();usable=[(train,test,fc) for train,test,fc in folds if train and test];all_oos=[m for _,test,_ in usable for m in test];all_features=build_feature_index_for_matches(conn,all_oos,min(fc for _,_,fc in usable)) if usable else {}
   for no,(train,test,fc) in enumerate(usable,1):
    train_seasons,test_seasons,overlap,train_end,test_start=_fold_gate(train,test,fc);features={m.match_id:all_features[m.match_id] for m in test if m.match_id in all_features};preds=run_fold(train,test,fc,features=features);score=_metrics(test,preds);total+=len(preds);tb+=score['brier_1x2']*len(preds);tl+=score['log_loss_1x2']*len(preds);tr+=score['rps_1x2']*len(preds);oos_seasons.update(normalize_season_label(m.season) for m in test if normalize_season_label(m.season) is not None);coverage=sum(bool(features.get(m.match_id) and features[m.match_id].values) for m in test);summaries.append({'fold_no':no,'status':'SUCCEEDED','cutoff':fc.isoformat(),'train':len(train),'test':len(test),'predictions':len(preds),'test_seasons':test_seasons,'train_seasons':train_seasons,'season_overlap_diagnostic':overlap,'train_end':train_end.isoformat(),'test_start':test_start.isoformat(),'feature_snapshots':len(features),'feature_covered_fixtures':coverage,'feature_coverage':coverage/len(test) if test else 0.,**score})
   with conn.transaction():
    for s,(train,test,fc) in zip(summaries,usable):conn.execute("insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,'SUCCEEDED',%s)",(run_id,s['fold_no'],fc,min(m.played_at for m in test),max(m.played_at for m in test),json.dumps(s)))
   if not total:raise RuntimeError(f'prediction_training_gate_failed:no_oos_predictions:fold_preview={preview}')
   ep=EloPolicy();gp=GlickoPolicy();dp=DixonColesPolicy();elo=_fit_elo(matches,cutoff,ep);g=_fit_glicko(matches,cutoff,gp);attack,defense,rate=_fit_dc(matches,cutoff,dp);_validate_dc_fit(rate,attack,defense);metrics={'settled_matches':len(matches),'folds':len(summaries),'complete_oos_seasons':len(oos_seasons),'oos_seasons':sorted(oos_seasons,key=lambda s:season_start_year(s)),'predictions':int(total),'brier_1x2_mean':tb/total,'log_loss_1x2_mean':tl/total,'rps_1x2_mean':tr/total,'dc_fit':{'league_rate':rate,'attack_teams':len(attack),'defense_teams':len(defense),'attack_min':min(attack.values()),'attack_max':max(attack.values()),'defense_min':min(defense.values()),'defense_max':max(defense.values())},'folds_detail':summaries,'feature_layer':{'enabled':True,'datasets':'historical_archive','no_same_fixture_post_match_leakage':True},'season_resolver':{'source':'api-football','archive_key_preserved':True,'logical_labels':sorted(season_inventory,key=lambda s:season_start_year(s))},'validation_status':'ELIGIBLE' if total>=MIN_OOS_SAMPLES and len(oos_seasons)>=MIN_COMPLETE_SEASONS else 'INSUFFICIENT_HISTORY','validation_eligible':total>=MIN_OOS_SAMPLES and len(oos_seasons)>=MIN_COMPLETE_SEASONS,'promotion_blocked':True}
   artifact={'schema_version':'zahrly-prediction-model-v1','model_version_id':model_id,'family':'prediction_engine','training_cutoff':cutoff.isoformat(),'training_source':'s3_fixture_archive','metrics':metrics,'elo':{'initial_rating':ep.initial_rating,'home_advantage':ep.home_advantage,'rating_scale':ep.rating_scale,'k_factor':ep.k_factor,'ratings':{t:x.rating for t,x in elo.items()}},'glicko':{'initial_rating':gp.initial_rating,'initial_rd':gp.initial_rd,'initial_volatility':gp.initial_volatility,'ratings':{t:{'rating':x.rating,'rd':x.rating_deviation,'volatility':x.volatility} for t,x in g.items()}},'dixon_coles':{'decay_half_life_days':dp.decay_half_life_days,'home_advantage':dp.home_advantage,'rho':dp.rho,'max_goals':dp.max_goals,'league_rate':rate,'attack':attack,'defense':defense}}
   uri,sha=_upload(artifact,version);metrics.update({'artifact_uri':uri,'artifact_sha256':sha})
   with conn.transaction():conn.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=now(),metrics=%s where id=%s",(json.dumps(metrics),run_id));conn.execute("update public.model_versions set artifact_uri=%s where id=%s",(uri,model_id));conn.execute("insert into public.model_releases(model_version_id,release_version,status,approval_state,reason) values (%s,%s,'SHADOW','PENDING','historical OOS candidate; promotion remains blocked') on conflict(model_version_id,release_version) do nothing",(model_id,version))
   print(json.dumps({'status':'SUCCEEDED','training_run_id':run_id,'model_version_id':model_id,'version':version,**{k:metrics[k] for k in ('settled_matches','complete_oos_seasons','predictions','validation_status','validation_eligible','artifact_uri','artifact_sha256','dc_fit')}},sort_keys=True),flush=True)
  except Exception as exc:
   with conn.transaction():conn.execute("update internal.prediction_training_runs set status='FAILED',finished_at=now(),metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(json.dumps({'error':str(exc)[:2000]}),run_id))
   raise
if __name__=='__main__':main()
