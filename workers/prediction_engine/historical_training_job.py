from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from math import exp, log

import boto3
import psycopg
from psycopg.rows import dict_row

from workers.prediction_engine.archive_training_source import load_settled_matches
from workers.prediction_engine.dixon_coles import DixonColesPolicy, time_decay_weight
from workers.prediction_engine.elo import EloPolicy, EloState, update_elo
from workers.prediction_engine.glicko import GlickoPolicy, GlickoState, initial_state, update_pair
from workers.prediction_engine.walk_forward import build_walk_forward_folds, run_fold

MIN_OOS_SAMPLES = 3000
MIN_COMPLETE_SEASONS = 3


def db_connect():
    return psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row, connect_timeout=15)


def _fit_elo_state(matches, cutoff, policy):
    ratings = {}
    for match in matches:
        if match.played_at >= cutoff:
            break
        home = ratings.get(match.home_team_id, EloState(policy.initial_rating))
        away = ratings.get(match.away_team_id, EloState(policy.initial_rating))
        new_home, new_away, _ = update_elo(home, away, match.home_goals, match.away_goals, policy)
        ratings[match.home_team_id] = new_home
        ratings[match.away_team_id] = new_away
    return ratings


def _fit_glicko_state(matches, cutoff, policy):
    ratings = {}
    for match in matches:
        if match.played_at >= cutoff:
            break
        home = ratings.get(match.home_team_id, initial_state(policy))
        away = ratings.get(match.away_team_id, initial_state(policy))
        new_home, new_away, _ = update_pair(home, away, match.home_goals, match.away_goals, policy)
        ratings[match.home_team_id] = new_home
        ratings[match.away_team_id] = new_away
    return ratings


def _fit_dc_state(matches, cutoff, policy):
    goals_for = {}
    goals_against = {}
    total_weight = 0.0
    total_goals = 0.0
    for match in matches:
        if match.played_at >= cutoff:
            break
        days = (cutoff - match.played_at).total_seconds() / 86400.0
        weight = time_decay_weight(days, policy.decay_half_life_days)
        for team, scored, conceded in (
            (match.home_team_id, match.home_goals, match.away_goals),
            (match.away_team_id, match.away_goals, match.home_goals),
        ):
            goals_for[team] = goals_for.get(team, 0.0) + weight * scored
            goals_against[team] = goals_against.get(team, 0.0) + weight * conceded
        total_weight += 2.0 * weight
        total_goals += weight * (match.home_goals + match.away_goals)

    league_rate = max(total_goals / max(total_weight, 1e-12), 1e-6)
    per_team_weight = max(total_weight / 2.0, 1e-12)
    attack = {team: (value / per_team_weight) / league_rate for team, value in goals_for.items()}
    defense = {team: (value / per_team_weight) / league_rate for team, value in goals_against.items()}
    return league_rate, attack, defense


def _upload_artifact(payload, version):
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    s3 = boto3.client(
        's3',
        region_name=os.environ.get('S3_REGION', 'eu-north-1'),
        endpoint_url=os.environ.get('S3_ENDPOINT_URL') or None,
        aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'],
    )
    key = f'zahrly/models/prediction_engine/{version}.json'
    s3.put_object(
        Bucket=os.environ['S3_BUCKET'],
        Key=key,
        Body=raw,
        ContentType='application/json',
        Metadata={'sha256': digest, 'model_version': version},
    )
    return f"s3://{os.environ['S3_BUCKET']}/{key}", digest


def _build_artifact(model_id, cutoff, metrics, elo_ratings, glicko_ratings, elo_policy, glicko_policy, league_rate, attack, defense, dc_policy):
    return {
        'schema_version': 'zahrly-prediction-model-v1',
        'model_version_id': model_id,
        'family': 'prediction_engine',
        'training_cutoff': cutoff.isoformat(),
        'training_source': 's3_fixture_archive',
        'metrics': metrics,
        'elo': {
            'initial_rating': elo_policy.initial_rating,
            'home_advantage': elo_policy.home_advantage,
            'rating_scale': elo_policy.rating_scale,
            'k_factor': elo_policy.k_factor,
            'ratings': {team: state.rating for team, state in elo_ratings.items()},
        },
        'glicko': {
            'initial_rating': glicko_policy.initial_rating,
            'initial_rd': glicko_policy.initial_rd,
            'initial_volatility': glicko_policy.initial_volatility,
            'ratings': {team: {'rating': state.rating, 'rd': state.rating_deviation, 'volatility': state.volatility} for team, state in glicko_ratings.items()},
        },
        'dixon_coles': {
            'decay_half_life_days': dc_policy.decay_half_life_days,
            'home_advantage': dc_policy.home_advantage,
            'rho': dc_policy.rho,
            'max_goals': dc_policy.max_goals,
            'league_rate': league_rate,
            'home_attack': attack,
            'away_attack': attack,
            'home_defense': defense,
            'away_defense': defense,
        },
    }


def _fold_metrics(test, predictions):
    n = len(predictions)
    if n == 0:
        return {'brier_1x2': None, 'log_loss_1x2': None, 'rps_1x2': None, 'ece_1x2': None}
    brier = logloss = rps = 0.0
    bins = [{'n': 0, 'confidence': 0.0, 'accuracy': 0.0} for _ in range(10)]
    for match, prediction in zip(test, predictions):
        probs = (max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away))
        if match.home_goals > match.away_goals:
            actual = 0
        elif match.home_goals == match.away_goals:
            actual = 1
        else:
            actual = 2
        ys = (1.0 if actual == 0 else 0.0, 1.0 if actual == 1 else 0.0, 1.0 if actual == 2 else 0.0)
        brier += sum((p - y) ** 2 for p, y in zip(probs, ys))
        logloss -= log(probs[actual])
        rps += ((probs[0] - ys[0]) ** 2 + (probs[0] + probs[1] - ys[0] - ys[1]) ** 2) / 2.0
        confidence = max(probs)
        predicted = max(range(3), key=lambda i: probs[i])
        idx = min(9, int(confidence * 10.0))
        bins[idx]['n'] += 1
        bins[idx]['confidence'] += confidence
        bins[idx]['accuracy'] += 1.0 if predicted == actual else 0.0
    ece = sum((b['n'] / n) * abs(b['accuracy'] / b['n'] - b['confidence'] / b['n']) for b in bins if b['n'])
    return {'brier_1x2': brier / n, 'log_loss_1x2': logloss / n, 'rps_1x2': rps / n, 'ece_1x2': ece}


def main():
    started = datetime.now(timezone.utc)
    with db_connect() as conn:
        matches = load_settled_matches(conn, as_of=started)
        if len(matches) < MIN_OOS_SAMPLES:
            raise RuntimeError(f'prediction_training_gate_failed:settled_matches={len(matches)}')

        cutoffs = build_cutoffs(matches[0].played_at, matches[-1].played_at)
        version = 'p0-shadow-' + started.strftime('%Y%m%d%H%M%S')
        cutoff = started
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("insert into public.model_versions(family,version,status,training_cutoff) values (%s,%s,'SHADOW',%s) returning id::text as id", ('prediction_engine', version, cutoff))
                model_id = cur.fetchone()['id']
                cur.execute("insert into internal.prediction_training_runs(model_version_id,status,requested_cutoff,started_at,metrics) values (%s,'RUNNING',%s,%s,%s) returning id::text as id", (model_id, cutoff, started, json.dumps({'source': 's3_fixture_archive', 'settled_matches': len(matches)})))
                run_id = cur.fetchone()['id']

        try:
            folds = build_walk_forward_folds(matches, cutoffs) if cutoffs else []
            summaries = []
            total_predictions = 0
            total_brier = total_logloss = total_rps = 0.0
            fold_years = []

            for fold_no, (train, test, fold_cutoff) in enumerate(folds, 1):
                if not train or not test:
                    summary = {'fold_no': fold_no, 'status': 'SKIPPED', 'cutoff': fold_cutoff.isoformat(), 'train': len(train), 'test': len(test), 'predictions': 0}
                else:
                    predictions = run_fold(train, test, fold_cutoff)
                    score = _fold_metrics(test, predictions)
                    total_predictions += len(predictions)
                    total_brier += score['brier_1x2'] * len(predictions)
                    total_logloss += score['log_loss_1x2'] * len(predictions)
                    total_rps += score['rps_1x2'] * len(predictions)
                    fold_years.append(fold_cutoff.year)
                    summary = {
                        'fold_no': fold_no,
                        'status': 'SUCCEEDED',
                        'cutoff': fold_cutoff.isoformat(),
                        'train': len(train),
                        'test': len(test),
                        'predictions': len(predictions),
                        **score,
                    }

                summaries.append(summary)
                with conn.transaction():
                    with conn.cursor() as cur:
                        next_year = datetime(fold_cutoff.year + 1, 1, 1, tzinfo=timezone.utc)
                        cur.execute(
                            "insert into internal.prediction_training_folds(training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)",
                            (run_id, fold_no, fold_cutoff, fold_cutoff, next_year, summary['status'], json.dumps(summary)),
                        )

            successful_folds = [s for s in summaries if s['status'] == 'SUCCEEDED']
            complete_seasons = len(set(fold_years))
            validation_eligible = total_predictions >= MIN_OOS_SAMPLES and complete_seasons >= MIN_COMPLETE_SEASONS
            validation_status = 'ELIGIBLE' if validation_eligible else 'INSUFFICIENT_HISTORY'

            elo_policy = EloPolicy()
            glicko_policy = GlickoPolicy()
            dc_policy = DixonColesPolicy()
            final_elo = _fit_elo_state(matches, cutoff, elo_policy)
            final_glicko = _fit_glicko_state(matches, cutoff, glicko_policy)
            league_rate, attack, defense = _fit_dc_state(matches, cutoff, dc_policy)

            metrics = {
                'settled_matches': len(matches),
                'folds': len(summaries),
                'successful_folds': len(successful_folds),
                'complete_oos_seasons': complete_seasons,
                'predictions': total_predictions,
                'brier_1x2_mean': total_brier / total_predictions if total_predictions else None,
                'log_loss_1x2_mean': total_logloss / total_predictions if total_predictions else None,
                'rps_1x2_mean': total_rps / total_predictions if total_predictions else None,
                'folds_detail': summaries,
                'validation_status': validation_status,
                'validation_eligible': validation_eligible,
                'promotion_blocked': not validation_eligible,
                'gates': {'min_oos_samples': MIN_OOS_SAMPLES, 'min_complete_seasons': MIN_COMPLETE_SEASONS},
            }
            artifact = _build_artifact(model_id, cutoff, metrics, final_elo, final_glicko, elo_policy, glicko_policy, league_rate, attack, defense, dc_policy)
            artifact_uri, artifact_sha256 = _upload_artifact(artifact, version)
            metrics['artifact_sha256'] = artifact_sha256
            metrics['artifact_uri'] = artifact_uri

            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=%s,metrics=%s where id=%s", (datetime.now(timezone.utc), json.dumps(metrics), run_id))
                    cur.execute("update public.model_versions set artifact_uri=%s where id=%s", (artifact_uri, model_id))

            print(json.dumps({'training_run_id': run_id, 'model_version_id': model_id, 'version': version, **{k: metrics[k] for k in ('settled_matches','successful_folds','complete_oos_seasons','predictions','brier_1x2_mean','log_loss_1x2_mean','rps_1x2_mean','validation_status','validation_eligible','artifact_uri','artifact_sha256')}}, sort_keys=True))
        except Exception as exc:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("update internal.prediction_training_runs set status='FAILED',finished_at=%s,metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s", (datetime.now(timezone.utc), json.dumps({'error': str(exc)}), run_id))
            raise


def build_cutoffs(start, end):
    """Return UTC Jan-1 cutoffs for complete historical calendar-year OOS folds.

    The first eligible fold is the calendar year after the first archive year.
    The current/partial calendar year is intentionally excluded from validation;
    it remains eligible for final model-state fitting through the run cutoff.
    """
    start = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    first_year = start.year + 1
    last_complete_year = end.year - 1
    return [datetime(year, 1, 1, tzinfo=timezone.utc) for year in range(first_year, last_complete_year + 1)]


if __name__ == '__main__':
    main()
