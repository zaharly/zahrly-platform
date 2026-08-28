from __future__ import annotations

import hashlib, json, os
from datetime import datetime, timedelta, timezone
import boto3
from botocore.config import Config

from .archive_training_source import db_connect, load_settled_matches
from .walk_forward import build_walk_forward_folds, run_fold
from .elo import EloPolicy, EloState, update_elo
from .glicko import GlickoPolicy, GlickoState, initial_state, update_pair
from .dixon_coles import DixonColesPolicy, time_decay_weight


def s3():
    kw=dict(service_name='s3', region_name=os.environ['S3_REGION'], aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'], config=Config(retries={'max_attempts':5,'mode':'standard'}))
    if os.environ.get('S3_ENDPOINT_URL'): kw['endpoint_url']=os.environ['S3_ENDPOINT_URL']
    return boto3.client(**kw)


def utc(v): return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def cutoffs(first,last,step=30,window=30):
    out=[]; c=utc(first)+timedelta(days=180); last=utc(last)
    while c+timedelta(days=window)<=last: out.append(c); c+=timedelta(days=step)
    return out


def final_elo_glicko(matches):
    ep=EloPolicy(); gp=GlickoPolicy(); er={}; gr={}
    for m in sorted(matches,key=lambda x:x.played_at):
        h=er.get(m.home_team_id,EloState(ep.initial_rating)); a=er.get(m.away_team_id,EloState(ep.initial_rating)); h,a,_=update_elo(h,a,m.home_goals,m.away_goals,ep); er[m.home_team_id]=h; er[m.away_team_id]=a
        h=gr.get(m.home_team_id,initial_state(gp)); a=gr.get(m.away_team_id,initial_state(gp)); h,a,_=update_pair(h,a,m.home_goals,m.away_goals,gp); gr[m.home_team_id]=h; gr[m.away_team_id]=a
    return er,gr


def artifact(matches, cutoff, model_id, metrics):
    ep=EloPolicy(); gp=GlickoPolicy(); dp=DixonColesPolicy(); er,gr=final_elo_glicko([m for m in matches if utc(m.played_at)<cutoff])
    gf={}; ga={}; tw=tg=0.0
    for m in matches:
        p=utc(m.played_at)
        if p>=cutoff: continue
        w=time_decay_weight((cutoff-p).total_seconds()/86400.0,dp.decay_half_life_days)
        for t,x,y in ((m.home_team_id,m.home_goals,m.away_goals),(m.away_team_id,m.away_goals,m.home_goals)):
            gf[t]=gf.get(t,0.0)+w*x; ga[t]=ga.get(t,0.0)+w*y
        tw+=2*w; tg+=w*(m.home_goals+m.away_goals)
    rate=max(tg/max(tw,1e-12),1e-6); denom=max(tw/2,1e-12)
    attack={t:(v/denom)/rate for t,v in gf.items()}; defense={t:(v/denom)/rate for t,v in ga.items()}
    return {'schema_version':'zahrly-prediction-model-v1','model_version_id':model_id,'family':'prediction_engine','training_cutoff':cutoff.isoformat(),'training_source':'s3_fixture_archive','metrics':metrics,'elo':{'initial_rating':ep.initial_rating,'home_advantage':ep.home_advantage,'rating_scale':ep.rating_scale,'k_factor':ep.k_factor,'ratings':{k:v.rating for k,v in er.items()}},'glicko':{'initial_rating':gp.initial_rating,'initial_rd':gp.initial_rd,'initial_volatility':gp.initial_volatility,'ratings':{k:{'rating':v.rating,'rd':v.rating_deviation,'volatility':v.volatility} for k,v in gr.items()}},'dixon_coles':{'decay_half_life_days':dp.decay_half_life_days,'home_advantage':dp.home_advantage,'rho':dp.rho,'max_goals':dp.max_goals,'league_rate':rate,'home_attack':attack,'away_attack':attack,'home_defense':defense,'away_defense':defense}}


def main():
    started=datetime.now(timezone.utc)
    with db_connect() as conn:
        matches=load_settled_matches(conn)
        if len(matches)<30: raise RuntimeError(f'prediction_training_gate_failed:settled_matches={len(matches)}')
        cs=cutoffs(matches[0].played_at,matches[-1].played_at)
        if not cs: raise RuntimeError('prediction_training_gate_failed:no_cutoffs')
        version='p0-shadow-'+started.strftime('%Y%m%d%H%M%S'); cutoff=cs[-1]
        with conn.transaction():
            with conn.cursor() as c:
                c.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text",('prediction_engine',version,cutoff)); mid=c.fetchone()[0]
                c.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text",(mid,cutoff,started,json.dumps({'source':'s3_fixture_archive','settled_matches':len(matches)}))); rid=c.fetchone()[0]
        try:
            fs=build_walk_forward_folds(matches,cs,test_window_days=30); summaries=[]; bs=[]; total=0
            for no,(tr,te,co) in enumerate(fs,1):
                if not tr or not te: status='SKIPPED'; b=None; predn=0
                else:
                    ps=run_fold(tr,te,co); b=sum((p.p_home-(m.home_goals>m.away_goals))**2+(p.p_draw-(m.home_goals==m.away_goals))**2+(p.p_away-(m.home_goals<m.away_goals))**2 for m,p in zip(te,ps))/len(ps); bs.append(b); total+=len(ps); predn=len(ps); status='SUCCEEDED'
                sm={'fold_no':no,'status':status,'cutoff':co.isoformat(),'train':len(tr),'test':len(te),'predictions':predn};
                if b is not None: sm['brier_1x2']=b
                summaries.append(sm)
                with conn.transaction():
                    with conn.cursor() as c: c.execute("insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)",(rid,no,co,co,co+timedelta(days=30),status,json.dumps(sm)))
            good=[x for x in summaries if x['status']=='SUCCEEDED']
            if not good: raise RuntimeError('prediction_training_gate_failed:no_successful_folds')
            metrics={'source':'s3_fixture_archive','settled_matches':len(matches),'folds':len(good),'total_predictions':total,'mean_brier_1x2':sum(bs)/len(bs),'min_brier_1x2':min(bs),'max_brier_1x2':max(bs),'training_cutoff':cutoff.isoformat()}
            doc=artifact(matches,cutoff,mid,metrics); raw=json.dumps(doc,sort_keys=True,separators=(',',':')).encode(); digest=hashlib.sha256(raw).hexdigest(); bucket=os.environ['S3_BUCKET']; key=f'zahrly/models/{version}/{digest}.json'; s3().put_object(Bucket=bucket,Key=key,Body=raw,ContentType='application/json',Metadata={'sha256':digest,'model_version_id':mid})
            uri=f's3://{bucket}/{key}'
            with conn.transaction():
                with conn.cursor() as c: c.execute('update public.model_versions set artifact_uri=%s where id=%s',(uri,mid)); c.execute('update internal.prediction_training_runs set status=%s,finished_at=now(),metrics=%s where id=%s',('SUCCEEDED',json.dumps({**metrics,'artifact_uri':uri,'artifact_sha256':digest,'model_version_id':mid}),rid))
            print(json.dumps({'status':'VALIDATED_SHADOW','model_version_id':mid,'version':version,'training_run_id':rid,'metrics':metrics,'artifact_uri':uri,'artifact_sha256':digest},separators=(',',':')))
        except Exception as e:
            with conn.transaction():
                with conn.cursor() as c: c.execute('update internal.prediction_training_runs set status=%s,finished_at=now(),metrics=%s where id=%s',('FAILED',json.dumps({'error':str(e),'model_version_id':mid}),rid))
            raise

if __name__=='__main__': main()
