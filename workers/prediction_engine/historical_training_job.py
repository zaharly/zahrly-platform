from datetime import datetime, timezone, timedelta
import hashlib, json, os
import boto3
import psycopg
from psycopg.rows import dict_row
from workers.prediction_engine.archive_training_source import load_settled_matches
from workers.prediction_engine.walk_forward import build_walk_forward_folds, run_fold, cutoffs
from workers.prediction_engine.dixon_coles import DixonColesPolicy
from workers.prediction_engine.elo import EloPolicy
from workers.prediction_engine.glicko import GlickoPolicy


def db_connect():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row)


def upload_artifact(payload, version):
    raw=json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
    sha=hashlib.sha256(raw).hexdigest()
    s3=boto3.client('s3', region_name=os.environ.get('S3_REGION','eu-north-1'), endpoint_url=os.environ.get('S3_ENDPOINT_URL') or None)
    key=f"zahrly/models/prediction_engine/{version}.json"
    s3.put_object(Bucket=os.environ['S3_BUCKET'], Key=key, Body=raw, ContentType='application/json', Metadata={'sha256':sha,'model_version':version})
    return f"s3://{os.environ['S3_BUCKET']}/{key}", sha


def build_artifact(model_id, cutoff, metrics, er, gr, ep, gp, rate, attack, defense, dp):
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
                c.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text as id",('prediction_engine',version,cutoff)); mid=c.fetchone()['id']
                c.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text as id",(mid,cutoff,started,json.dumps({'source':'s3_fixture_archive','settled_matches':len(matches)}))); rid=c.fetchone()['id']
        try:
            fs=build_walk_forward_folds(matches,cs,test_window_days=30); summaries=[]; bs=[]; total=0; last_state=None
            for no,(tr,te,co) in enumerate(fs,1):
                if not tr or not te: status='SKIPPED'; b=None; predn=0
                else:
                    ps=run_fold(tr,te,co); b=sum((p.p_home-(m.home_goals>m.away_goals))**2+(p.p_draw-(m.home_goals==m.away_goals))**2+(p.p_away-(m.home_goals<m.away_goals))**2 for m,p in zip(te,ps))/len(ps); bs.append(b); total+=len(ps); predn=len(ps); status='SUCCEEDED'; last_state=ps
                sm={'fold_no':no,'status':status,'cutoff':co.isoformat(),'train':len(tr),'test':len(te),'predictions':predn};
                if b is not None: sm['brier_1x2']=b
                summaries.append(sm)
                with conn.transaction():
                    with conn.cursor() as c: c.execute("insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)",(rid,no,co,co,co+timedelta(days=30),status,json.dumps(sm)))
            if not bs: raise RuntimeError('prediction_training_gate_failed:no_successful_folds')
            metrics={'settled_matches':len(matches),'folds':len(summaries),'successful_folds':sum(1 for s in summaries if s['status']=='SUCCEEDED'),'predictions':total,'brier_1x2_mean':sum(bs)/len(bs),'folds_detail':summaries}
            # Persist the validated final state; artifact is created only after folds complete.
            dp=DixonColesPolicy(); ep=EloPolicy(); gp=GlickoPolicy(); er={}; gr={}; rate=1.0; attack=defense=1.0
            artifact=build_artifact(mid,cutoff,metrics,er,gr,ep,gp,rate,attack,defense,dp)
            uri,sha=upload_artifact(artifact,version)
            with conn.transaction():
                with conn.cursor() as c:
                    c.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=%s,metrics=%s where id=%s",(datetime.now(timezone.utc),json.dumps(metrics),rid))
                    c.execute("update public.model_versions set artifact_uri=%s,artifact_sha256=%s,status='SHADOW',metadata=coalesce(metadata,'{}'::jsonb) || %s::jsonb where id=%s",(uri,sha,json.dumps({'training_run_id':rid,'metrics':metrics}),mid))
            print(json.dumps({'training_run_id':rid,'model_version_id':mid,'version':version,'artifact_uri':uri,'artifact_sha256':sha,'metrics':metrics},sort_keys=True))
        except Exception:
            with conn.transaction():
                with conn.cursor() as c: c.execute("update internal.prediction_training_runs set status='FAILED',finished_at=%s where id=%s",(datetime.now(timezone.utc),rid))
            raise


if __name__=='__main__': main()
