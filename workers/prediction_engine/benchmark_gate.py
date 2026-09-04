from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

BRIER_IMPROVEMENT=0.03
LOGLOSS_IMPROVEMENT=0.02
RPS_IMPROVEMENT=0.02
ECE_ABSOLUTE_TOLERANCE=0.01
MIN_COMPLETE_SEASONS=3
MIN_OOS_PREDICTIONS=3000


def db():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=15)


def gain(base,cand):
    return None if base is None or cand is None or base<=0 else (base-cand)/base


def main():
    with db() as conn:
        requested=os.environ.get('PREDICTION_TRAINING_RUN_ID','').strip()
        if requested:
            run=conn.execute("select id::text as id,model_version_id::text as model_version_id,metrics from internal.prediction_training_runs where id=%s and status='SUCCEEDED'",(requested,)).fetchone()
        else:
            run=conn.execute("select id::text as id,model_version_id::text as model_version_id,metrics from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
        if not run: raise SystemExit('no succeeded training run')

        # OOS is now archived to S3 before this gate runs. The benchmark script
        # persists the complete row-level artifact to S3 and stores only its
        # aggregate summary in training_runs.metrics for gate evaluation.
        benchmark=(run.get('metrics') or {}).get('benchmark') or {}
        model=benchmark.get('model') or {}
        empirical=benchmark.get('empirical_baseline') or {}
        market=benchmark.get('market') or {}
        history=benchmark.get('history_gate') or {}
        oos_n=int(benchmark.get('oos_n') or model.get('n') or 0)
        folds_pass=bool(history.get('oos_seasons_pass'))
        artifact_row=conn.execute("select artifact_uri from public.model_versions where id=%s",(run['model_version_id'],)).fetchone()
        artifact_available=bool(artifact_row and artifact_row['artifact_uri'])
        if not benchmark:
            raise SystemExit('missing benchmark summary in training run metrics')

        rg={k:gain(empirical.get(k),model.get(k)) for k in ('brier','log_loss','rps')}
        empirical_pass=(all(rg[k] is not None and rg[k]>=t for k,t in (
            ('brier',BRIER_IMPROVEMENT),('log_loss',LOGLOSS_IMPROVEMENT),('rps',RPS_IMPROVEMENT)
        )) and (
            model.get('ece') is None or empirical.get('ece') is None or
            model['ece']<=empirical['ece']+ECE_ABSOLUTE_TOLERANCE
        ))
        market_available=int(market.get('n') or 0)>0
        market_gain={k:gain(market.get(k),model.get(k)) for k in ('brier','log_loss','rps')}
        market_pass=(market_available and market_gain['brier'] is not None and market_gain['log_loss'] is not None
                     and market_gain['brier']>=0 and market_gain['log_loss']>=0)
        history_pass=oos_n>=MIN_OOS_PREDICTIONS and folds_pass
        eligible=artifact_available and history_pass and empirical_pass and market_pass
        status='PASS' if eligible else ('FAIL_NO_ARTIFACT' if not artifact_available else ('WAITING_MARKET_DATA' if history_pass and empirical_pass and not market_available else ('INSUFFICIENT_HISTORY' if not history_pass else 'FAIL')))
        gate={
            'status':status,'artifact_available':artifact_available,'history_pass':history_pass,
            'empirical_pass':empirical_pass,'market_pass':market_pass,'market_available':market_available,
            'promotion_eligible':eligible,'model':model,'empirical_baseline':empirical,'market':market,
            'relative_gain_vs_empirical':rg,'market_relative_gain':market_gain,
            'thresholds':{'brier_relative':BRIER_IMPROVEMENT,'log_loss_relative':LOGLOSS_IMPROVEMENT,
                          'rps_relative':RPS_IMPROVEMENT,'ece_absolute_tolerance':ECE_ABSOLUTE_TOLERANCE,
                          'min_complete_oos_seasons':MIN_COMPLETE_SEASONS,'min_oos_predictions':MIN_OOS_PREDICTIONS},
            'ece_definition':'10-bin confidence calibration error; same definition as oos_benchmark',
            'created_at':datetime.now(timezone.utc).isoformat()
        }
        with conn.transaction():
            conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb) || CAST(%s AS jsonb) where id=%s",(json.dumps({'benchmark_gate':gate}),run['id']))
            conn.execute("update public.model_versions set status='SHADOW' where id=%s",(run['model_version_id'],))
            conn.execute("insert into public.model_releases(model_version_id,release_version,status,approval_state,reason) values (%s,%s,'SHADOW','PENDING',%s) on conflict(model_version_id,release_version) do update set status='SHADOW',approval_state='PENDING',reason=excluded.reason",(run['model_version_id'],f"shadow-{run['id']}",f"OOS gate status={status}; production activation is not performed"))
            comparison={'relative_gain_vs_empirical':rg,'gate_status':status}
            conn.execute("insert into public.shadow_evaluations(candidate_model_version_id,incumbent_model_version_id,evaluation_run_id,status,candidate_metrics,incumbent_metrics,comparison,finished_at) select %s, null, (select id from internal.evaluation_runs where model_version_id=%s and benchmark_type='WALK_FORWARD_OOS' order by created_at desc limit 1), 'SUCCEEDED', CAST(%s AS jsonb), CAST(%s AS jsonb), CAST(%s AS jsonb), now()",(run['model_version_id'],run['model_version_id'],json.dumps(model),json.dumps(empirical),json.dumps(comparison)))
        print(json.dumps({'training_run_id':run['id'],'model_version_id':run['model_version_id'],'benchmark_gate':gate},sort_keys=True))

if __name__=='__main__': main()
