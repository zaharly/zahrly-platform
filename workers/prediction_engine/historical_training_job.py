from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from math import log
from urllib.parse import quote, urlsplit, urlunsplit

import boto3
import psycopg
from psycopg.rows import dict_row

from .archive_training_source import load_settled_matches
from .dixon_coles import DixonColesPolicy, time_decay_weight
from .elo import EloPolicy, EloState, update_elo
from .glicko import GlickoPolicy, initial_state, update_pair

MIN_OOS_SAMPLES = 3000
MIN_COMPLETE_SEASONS = 3


def _normalized_db_url() -> str:
    raw = os.environ.get('SUPABASE_DB_URL_RAW', os.environ.get('SUPABASE_DB_URL', '')).strip()
    if not raw:
        raise RuntimeError('missing required environment variable: SUPABASE_DB_URL')
    parts = urlsplit(raw)
    if parts.scheme not in {'postgres', 'postgresql'} or not parts.username or parts.password is None:
        raise RuntimeError('invalid SUPABASE_DB_URL format: expected postgres URL with username/password')
    project_host = urlsplit(os.environ.get('SUPABASE_URL', '').strip()).hostname
    if not project_host:
        raise RuntimeError('invalid SUPABASE_URL')
    project_ref = project_host.split('.', 1)[0]
    region = os.environ.get('SUPABASE_POOLER_REGION', 'eu-central-1')
    pooler_host = f'aws-0-{region}.pooler.supabase.com'
    username = quote(f'postgres.{project_ref}', safe='')
    password = quote(parts.password, safe='')
    return urlunsplit((parts.scheme, f'{username}:{password}@{pooler_host}:5432', '/postgres', 'sslmode=require', ''))


def db_connect():
    conn = psycopg.connect(_normalized_db_url(), row_factory=dict_row, connect_timeout=20, sslmode='require')
    # Historical training is isolated batch work. It must not be interrupted
    # by a short server-side statement timeout while maintaining indexes.
    conn.execute('set statement_timeout = 0')
    return conn


def _fit_elo_state(matches, cutoff, policy):
    ratings = {}
    for match in matches:
        if match.played_at >= cutoff:
            break
        home = ratings.get(match.home_team_id, EloState(policy.initial_rating))
        away = ratings.get(match.away_team_id, EloState(policy.initial_rating))
        new_home, new_away, _ = update_elo(home, away, match.home_goals, match.away_goals, policy)
        ratings[match.home_team_id], ratings[match.away_team_id] = new_home, new_away
    return ratings


def _fit_glicko_state(matches, cutoff, policy):
    ratings = {}
    for match in matches:
        if match.played_at >= cutoff:
            break
        home = ratings.get(match.home_team_id, initial_state(policy))
        away = ratings.get(match.away_team_id, initial_state(policy))
        new_home, new_away, _ = update_pair(home, away, match.home_goals, match.away_goals, policy)
        ratings[match.home_team_id], ratings[match.away_team_id] = new_home, new_away
    return ratings


def _fit_dc_state(matches, cutoff, policy):
    goals_for, goals_against = {}, {}
    total_weight = total_goals = 0.0
    for match in matches:
        if match.played_at >= cutoff:
            break
        days = (cutoff - match.played_at).total_seconds() / 86400.0
        weight = time_decay_weight(days, policy.decay_half_life_days)
        for team, scored, conceded in ((match.home_team_id, match.home_goals, match.away_goals), (match.away_team_id, match.away_goals, match.home_goals)):
            goals_for[team] = goals_for.get(team, 0.0) + weight * scored
            goals_against[team] = goals_against.get(team, 0.0) + weight * conceded
        total_weight += 2.0 * weight
        total_goals += weight * (match.home_goals + match.away_goals)
    league_rate = max(total_goals / max(total_weight, 1e-12), 1e-6)
    per_team_weight = max(total_weight / 2.0, 1e-12)
    attack = {team: (v / per_team_weight) / league_rate for team, v in goals_for.items()}
    defense = {team: (v / per_team_weight) / league_rate for team, v in goals_against.items()}
    return league_rate, attack, defense


def _upload_artifact(payload, version):
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    client = boto3.client('s3', region_name=os.environ.get('S3_REGION', 'eu-north-1'), endpoint_url=os.environ.get('S3_ENDPOINT_URL') or None, aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'])
    key = f'zahrly/models/prediction_engine/{version}.json'
    client.put_object(Bucket=os.environ['S3_BUCKET'], Key=key, Body=raw, ContentType='application/json', Metadata={'sha256': digest, 'model_version': version})
    return f"s3://{os.environ['S3_BUCKET']}/{key}", digest


def _build_artifact(model_id, cutoff, metrics, elo_ratings, glicko_ratings, elo_policy, glicko_policy, league_rate, attack, defense, dc_policy):
    return {
        'schema_version': 'zahrly-prediction-model-v1', 'model_version_id': model_id, 'family': 'prediction_engine',
        'training_cutoff': cutoff.isoformat(), 'training_source': 's3_fixture_archive', 'metrics': metrics,
        'elo': {'initial_rating': elo_policy.initial_rating, 'home_advantage': elo_policy.home_advantage, 'rating_scale': elo_policy.rating_scale, 'k_factor': elo_policy.k_factor, 'ratings': {team: state.rating for team, state in elo_ratings.items()}},
        'glicko': {'initial_rating': glicko_policy.initial_rating, 'initial_rd': glicko_policy.initial_rd, 'initial_volatility': glicko_policy.initial_volatility, 'ratings': {team: {'rating': state.rating, 'rd': state.rating_deviation, 'volatility': state.volatility} for team, state in glicko_ratings.items()}},
        'dixon_coles': {'decay_half_life_days': dc_policy.decay_half_life_days, 'home_advantage': dc_policy.home_advantage, 'rho': dc_policy.rho, 'max_goals': dc_policy.max_goals, 'league_rate': league_rate, 'attack': attack, 'defense': defense},
    }


def _fold_metrics(test, predictions):
    n = len(predictions)
    if not n:
        return {'brier_1x2': None, 'log_loss_1x2': None, 'rps_1x2': None, 'ece_1x2': None}
    brier = logloss = rps = 0.0
    bins = [{'n': 0, 'confidence': 0.0, 'accuracy': 0.0} for _ in range(10)]
    for match, pred in zip(test, predictions):
        probs = tuple(max(1e-15, x) for x in (pred.p_home, pred.p_draw, pred.p_away))
        actual = 0 if match.home_goals > match.away_goals else 1 if match.home_goals == match.away_goals else 2
        ys = tuple(1.0 if i == actual else 0.0 for i in range(3))
        brier += sum((p - y) ** 2 for p, y in zip(probs, ys))
        logloss -= log(probs[actual])
        rps += ((probs[0] - ys[0]) ** 2 + (probs[0] + probs[1] - ys[0] - ys[1]) ** 2) / 2.0
        confidence = max(probs)
        predicted = max(range(3), key=lambda i: probs[i])
        idx = min(9, int(confidence * 10.0))
        bins[idx]['n'] += 1; bins[idx]['confidence'] += confidence; bins[idx]['accuracy'] += 1.0 if predicted == actual else 0.0
    ece = sum((b['n'] / n) * abs(b['accuracy'] / b['n'] - b['confidence'] / b['n']) for b in bins if b['n'])
    return {'brier_1x2': brier / n, 'log_loss_1x2': logloss / n, 'rps_1x2': rps / n, 'ece_1x2': ece}


def build_cutoffs(start, end):
    start = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    return [datetime(y, 1, 1, tzinfo=timezone.utc) for y in range(start.year + 1, end.year + 1)]


def main():
    started = datetime.now(timezone.utc)
    with db_connect() as conn:
        matches = load_settled_matches(conn, as_of=started)
        if len(matches) < 30:
            raise RuntimeError(f'prediction_training_gate_failed:settled_matches={len(matches)}')
        cutoffs = build_cutoffs(matches[0].played_at, matches[-1].played_at)
        if not cutoffs:
            raise RuntimeError('prediction_training_gate_failed:no_valid_cutoffs')
        version = 'p0-shadow-' + started.strftime('%Y%m%d%H%M%S')
        cutoff = started
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text as id", ('prediction_engine', version, cutoff))
                model_id = cur.fetchone()['id']
                cur.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text as id", (model_id, cutoff, started, json.dumps({'source': 's3_fixture_archive', 'settled_matches': len(matches)})))
                run_id = cur.fetchone()['id']
        try:
            from .walk_forward import build_walk_forward_folds, run_fold
            folds = build_walk_forward_folds(matches, cutoffs)
            summaries = []; total_predictions = 0; total_brier = total_logloss = total_rps = 0.0; fold_years = []
            for fold_no, (train, test, fold_cutoff) in enumerate(folds, 1):
                if not train or not test:
                    continue
                predictions = run_fold(train, test, fold_cutoff); score = _fold_metrics(test, predictions)
                total_predictions += len(predictions); total_brier += score['brier_1x2'] * len(predictions); total_logloss += score['log_loss_1x2'] * len(predictions); total_rps += score['rps_1x2'] * len(predictions); fold_years.append(fold_cutoff.year)
                summary = {'fold_no': fold_no, 'status': 'SUCCEEDED', 'cutoff': fold_cutoff.isoformat(), 'train': len(train), 'test': len(test), 'predictions': len(predictions), **score}; summaries.append(summary)
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,'SUCCEEDED',%s)", (run_id, fold_no, fold_cutoff, min(m.played_at for m in test), max(m.played_at for m in test), json.dumps(summary)))
            if total_predictions == 0:
                raise RuntimeError('prediction_training_gate_failed:no_oos_predictions')
            elo_policy = EloPolicy(); glicko_policy = GlickoPolicy(); dc_policy = DixonColesPolicy()
            elo = _fit_elo_state(matches, cutoff, elo_policy); glicko = _fit_glicko_state(matches, cutoff, glicko_policy); league_rate, attack, defense = _fit_dc_state(matches, cutoff, dc_policy)
            metrics = {'settled_matches': len(matches), 'folds': len(summaries), 'complete_oos_seasons': len(set(fold_years)), 'predictions': total_predictions, 'brier_1x2_mean': total_brier / total_predictions, 'log_loss_1x2_mean': total_logloss / total_predictions, 'rps_1x2_mean': total_rps / total_predictions, 'folds_detail': summaries, 'validation_status': 'ELIGIBLE' if total_predictions >= MIN_OOS_SAMPLES and len(set(fold_years)) >= MIN_COMPLETE_SEASONS else 'INSUFFICIENT_HISTORY', 'validation_eligible': total_predictions >= MIN_OOS_SAMPLES and len(set(fold_years)) >= MIN_COMPLETE_SEASONS, 'promotion_blocked': True, 'gates': {'min_oos_samples': MIN_OOS_SAMPLES, 'min_complete_seasons': MIN_COMPLETE_SEASONS}}
            artifact = _build_artifact(model_id, cutoff, metrics, elo, glicko, elo_policy, glicko_policy, league_rate, attack, defense, dc_policy); artifact_uri, artifact_sha256 = _upload_artifact(artifact, version); metrics.update({'artifact_uri': artifact_uri, 'artifact_sha256': artifact_sha256})
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=now(),metrics=%s where id=%s", (json.dumps(metrics), run_id))
                    cur.execute("update public.model_versions set artifact_uri=%s where id=%s", (artifact_uri, model_id))
                    cur.execute("insert into public.model_releases(model_version_id,release_version,status,approval_state,reason) values (%s,%s,'SHADOW','PENDING','historical OOS candidate; promotion remains blocked') on conflict(model_version_id,release_version) do nothing", (model_id, version))
            print(json.dumps({'status': 'SUCCEEDED', 'training_run_id': run_id, 'model_version_id': model_id, 'version': version, **{k: metrics[k] for k in ('settled_matches', 'complete_oos_seasons', 'predictions', 'brier_1x2_mean', 'log_loss_1x2_mean', 'rps_1x2_mean', 'validation_status', 'validation_eligible', 'artifact_uri', 'artifact_sha256')}}, sort_keys=True))
        except Exception as exc:
            with conn.transaction():
                conn.execute("update internal.prediction_training_runs set status='FAILED',finished_at=now(),metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s", (json.dumps({'error': str(exc)[:2000]}), run_id))
            raise


if __name__ == '__main__': main()