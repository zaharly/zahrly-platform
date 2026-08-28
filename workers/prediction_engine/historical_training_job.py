from datetime import datetime, timezone, timedelta
import hashlib, json, os
from workers.prediction_engine.archive_training_source import load_settled_matches
from workers.prediction_engine.walk_forward import build_walk_forward_folds, run_fold


def db_connect():
    import psycopg
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=psycopg.rows.dict_row)


def main():
    started=datetime.now(timezone.utc)
    with db_connect() as conn:
        matches=load_settled_matches(conn)
        if len(matches)<30: raise RuntimeError(f'prediction_training_gate_failed:settled_matches={len(matches)}')
        cs=build_cutoffs(matches[0].played_at,matches[-1].played_at)
        if not cs: raise RuntimeError('prediction_training_gate_failed:no_cutoffs')
        version='p0-shadow-'+started.strftime('%Y%m%d%H%M%S')
        cutoff=cs[-1]
        with conn.transaction():
            with conn.cursor() as c:
                c.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text",('prediction_engine',version,cutoff))
                mid=c.fetchone()['id']
                c.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text",(mid,cutoff,started,json.dumps({'source':'s3_fixture_archive','settled_matches':len(matches)})))
                rid=c.fetchone()['id']
        try:
            fs=build_walk_forward_folds(matches,cs,test_window_days=30)
            summaries=[]; bs=[]; total=0
            for no,(tr,te,co) in enumerate(fs,1):
                if not tr or not te:
                    status='SKIPPED'; b=None; predn=0
                else:
                    ps=run_fold(tr,te,co)
                    b=sum((p.p_home-(m.home_goals>m.away_goals))**2+(p.p_draw-(m.home_goals==m.away_goals))**2+(p.p_away-(m.home_goals<m.away_goals))**2 for m,p in zip(te,ps))/len(ps)
                    bs.append(b); total+=len(ps); predn=len(ps); status='SUCCEEDED'
                sm={'fold_no':no,'status':status,'cutoff':co.isoformat(),'train':len(tr),'test':len(te),'predictions':predn}
                if b is not None: sm['brier_1x2']=b
                summaries.append(sm)
                with conn.transaction():
                    with conn.cursor() as c:
                        c.execute("insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)",(rid,no,co,co,co+timedelta(days=30),status,json.dumps(sm)))

            metrics={'settled_matches':len(matches),'folds':summaries,'predictions':total,'mean_brier_1x2':sum(bs)/len(bs) if bs else None}
            artifact=json.dumps({'schema_version':'zahrly-prediction-model-v1','model_version_id':mid,'family':'prediction_engine','training_cutoff':cutoff.isoformat(),'training_source':'s3_fixture_archive','metrics':metrics},sort_keys=True)
            digest=hashlib.sha256(artifact.encode()).hexdigest()
            key=f"zahrly/prediction/models/{version}.json"
            import boto3
            s3=boto3.client('s3',region_name=os.environ.get('S3_REGION','eu-north-1'),endpoint_url=os.environ.get('S3_ENDPOINT_URL'))
            s3.put_object(Bucket=os.environ['S3_BUCKET'],Key=key,Body=artifact.encode(),ContentType='application/json')
            with conn.transaction():
                with conn.cursor() as c:
                    c.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=%s,metrics=%s where id=%s",(datetime.now(timezone.utc),json.dumps(metrics),rid))
                    c.execute("update public.model_versions set artifact_uri=%s,artifact_sha256=%s where id=%s",(key,digest,mid))
            print(json.dumps({'training_run_id':rid,'model_version_id':mid,'settled_matches':len(matches),'folds':summaries,'artifact_uri':key,'artifact_sha256':digest},sort_keys=True))
        except Exception as exc:
            with conn.transaction():
                with conn.cursor() as c:
                    c.execute("update internal.prediction_training_runs set status='FAILED',finished_at=%s,metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",(datetime.now(timezone.utc),json.dumps({'error':str(exc)}),rid))
            raise


def build_cutoffs(start, end):
    out=[]
    cur=start.replace(hour=0,minute=0,second=0,microsecond=0)
    while cur < end:
        nxt=cur.replace(year=cur.year+1)
        out.append(nxt if nxt < end else end)
        cur=nxt
    return [c for c in out if c>start]


if __name__=='__main__': main()
