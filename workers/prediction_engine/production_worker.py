from __future__ import annotations

"""Production prediction worker.

Hard boundaries:
- Reads only scheduled canonical fixtures inside the current 7-day horizon.
- Never reads rolling fixtures as training data.
- Requires an ACTIVE/PRODUCTION model version with a verified S3 artifact.
- Writes immutable prediction baseline state only after all checks pass.
"""

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from .dixon_coles import probability_matrix, result_probabilities


class PredictionGateError(RuntimeError):
    pass


@dataclass(frozen=True)
class ModelState:
    model_version_id: str
    training_cutoff: datetime
    elo_home_advantage: float
    elo_rating_scale: float
    ratings: dict[str, float]
    league_rate: float
    home_attack: dict[str, float]
    away_attack: dict[str, float]
    home_defense: dict[str, float]
    away_defense: dict[str, float]
    dc_home_advantage: float
    rho: float
    max_goals: int


def db_connect():
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        raise PredictionGateError("missing SUPABASE_DB_URL")
    return psycopg.connect(url, row_factory=dict_row, connect_timeout=15)


def s3_client():
    endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip() or None
    required = ["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise PredictionGateError(f"missing S3 configuration: {','.join(missing)}")
    kwargs: dict[str, Any] = {
        "service_name": "s3",
        "region_name": os.environ["S3_REGION"].strip(),
        "aws_access_key_id": os.environ["S3_ACCESS_KEY_ID"].strip(),
        "aws_secret_access_key": os.environ["S3_SECRET_ACCESS_KEY"].strip(),
        "config": Config(retries={"max_attempts": 5, "mode": "standard"}),
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client(**kwargs)


def _read_json_s3(client, uri: str) -> Any:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise PredictionGateError("invalid model artifact URI")
    return json.loads(client.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))["Body"].read())


def load_active_model(conn) -> tuple[dict[str, Any], str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id::text, family, version, status, artifact_uri, training_cutoff
              from public.model_versions
             where upper(status) in ('ACTIVE','PRODUCTION','PRODUCTION_ENABLED')
               and artifact_uri is not null
               and training_cutoff is not null
             order by created_at desc
             limit 1
            """
        )
        row = cur.fetchone()
    if not row:
        raise PredictionGateError("no_validated_production_model")
    return dict(row), str(row["id"])


def parse_model_state(document: Any, model_version_id: str, training_cutoff: datetime) -> ModelState:
    if not isinstance(document, dict) or document.get("schema_version") != "zahrly-prediction-model-v1":
        raise PredictionGateError("unsupported_model_artifact_schema")
    if str(document.get("model_version_id")) != model_version_id:
        raise PredictionGateError("model_artifact_identity_mismatch")

    try:
        elo = document["elo"]
        dc = document["dixon_coles"]
        return ModelState(
            model_version_id=model_version_id,
            training_cutoff=training_cutoff,
            elo_home_advantage=float(elo["home_advantage"]),
            elo_rating_scale=float(elo["rating_scale"]),
            ratings={str(k): float(v) for k, v in dict(elo["ratings"]).items()},
            league_rate=float(dc["league_rate"]),
            home_attack={str(k): float(v) for k, v in dict(dc.get("home_attack", {})).items()},
            away_attack={str(k): float(v) for k, v in dict(dc.get("away_attack", {})).items()},
            home_defense={str(k): float(v) for k, v in dict(dc.get("home_defense", {})).items()},
            away_defense={str(k): float(v) for k, v in dict(dc.get("away_defense", {})).items()},
            dc_home_advantage=float(dc["home_advantage"]),
            rho=float(dc["rho"]),
            max_goals=int(dc.get("max_goals", 10)),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise PredictionGateError("invalid_model_state") from exc


def _predict(fixture: dict[str, Any], model: ModelState) -> tuple[float, float, float, float, float]:
    home_id = str(fixture["home_team_id"])
    away_id = str(fixture["away_team_id"])
    hr = model.ratings.get(home_id, 1500.0)
    ar = model.ratings.get(away_id, 1500.0)
    elo_diff = (hr + model.elo_home_advantage) - ar
    elo_factor = 1.0 / (1.0 + 10.0 ** (-elo_diff / model.elo_rating_scale))
    ha = model.home_attack.get(home_id, 1.0)
    aa = model.away_attack.get(away_id, 1.0)
    hd = model.home_defense.get(home_id, 1.0)
    ad = model.away_defense.get(away_id, 1.0)
    home_lambda = max(0.05, model.league_rate * pow(max(ha, 0.05) / max(ad, 0.05), 0.5) * (0.75 + 0.5 * elo_factor))
    away_lambda = max(0.05, model.league_rate * pow(max(aa, 0.05) / max(hd, 0.05), 0.5) * (1.25 - 0.5 * elo_factor))
    matrix = probability_matrix(home_lambda, away_lambda, model.rho, model.max_goals)
    return (*result_probabilities(matrix), home_lambda, away_lambda)


def baseline_pick(probs: tuple[float, float, float]) -> tuple[str, float]:
    labels = ("HOME", "DRAW", "AWAY")
    idx = max(range(3), key=lambda i: probs[i])
    return labels[idx], probs[idx]


def baseline_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def claim_prediction_jobs(conn, limit: int = 25) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                select pj.job_id, pj.fixture_id, pj.episode_id, pj.model_version_id, pj.policy_bundle_id,
                       f.kickoff_at, f.home_team_id, f.away_team_id
                  from internal.prediction_jobs pj
                  join public.fixtures f on f.id=pj.fixture_id
                 where pj.status='QUEUED'
                   and lower(f.status)='scheduled'
                   and f.kickoff_at >= %s
                   and f.kickoff_at < %s
                 order by f.kickoff_at, pj.created_at
                 limit %s
                 for update of pj skip locked
                """,
                (now, now.replace() if False else now, limit),
            )
            # The same query is intentionally replaced below because the upper bound
            # must be +7 days; keeping the transaction boundary explicit avoids races.
            cur.execute("""
                select pj.job_id, pj.fixture_id, pj.episode_id, pj.model_version_id, pj.policy_bundle_id,
                       f.kickoff_at, f.home_team_id, f.away_team_id
                  from internal.prediction_jobs pj
                  join public.fixtures f on f.id=pj.fixture_id
                 where pj.status='QUEUED'
                   and lower(f.status)='scheduled'
                   and f.kickoff_at >= now()
                   and f.kickoff_at < now() + interval '7 days'
                 order by f.kickoff_at, pj.created_at
                 limit %s for update of pj skip locked
            """, (limit,))
            rows = cur.fetchall()
            ids = [row["job_id"] for row in rows]
            if ids:
                cur.execute("update internal.prediction_jobs set status='RUNNING', started_at=now() where job_id = any(%s)", (ids,))
            return [dict(r) for r in rows]


def run_once(limit: int = 25) -> dict[str, Any]:
    conn = db_connect()
    try:
        model_row, model_id = load_active_model(conn)
        artifact = _read_json_s3(s3_client(), str(model_row["artifact_uri"]))
        model = parse_model_state(artifact, model_id, model_row["training_cutoff"])
        jobs = claim_prediction_jobs(conn, limit=limit)
        succeeded = failed = abstained = 0
        for job in jobs:
            try:
                kickoff = job["kickoff_at"].astimezone(timezone.utc)
                now = datetime.now(timezone.utc)
                if kickoff < now or kickoff >= now + __import__("datetime").timedelta(days=7):
                    raise PredictionGateError("fixture_outside_7d_horizon")
                probs = _predict(job, model)
                pick, pick_probability = baseline_pick(probs[:3])
                payload = {
                    "schema_version": "zahrly-production-prediction-v1",
                    "fixture_id": str(job["fixture_id"]),
                    "episode_id": str(job["episode_id"]),
                    "model_version_id": model.model_version_id,
                    "model_training_cutoff": model.training_cutoff.isoformat(),
                    "p_home": probs[0], "p_draw": probs[1], "p_away": probs[2],
                    "lambda_home": probs[3], "lambda_away": probs[4],
                    "baseline_pick": pick,
                    "baseline_probability": pick_probability,
                }
                digest = baseline_hash(payload)
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            insert into public.prediction_baselines
                              (episode_id, model_version_id, policy_bundle_id, baseline_pick, baseline_probability, baseline_hash)
                            values (%s,%s,%s,%s,%s,%s)
                            on conflict (episode_id) do nothing
                            """,
                            (job["episode_id"], model.model_version_id, job["policy_bundle_id"], pick, pick_probability, digest),
                        )
                        cur.execute("update internal.prediction_jobs set status='SUCCEEDED', finished_at=now(), error_code=null, error_message=null where job_id=%s", (job["job_id"],))
                        if job.get("worker_job_id"):
                            cur.execute("update internal.worker_jobs set status='SUCCEEDED', finished_at=now(), lease_expires_at=null where job_id=%s", (job["worker_job_id"],))
                succeeded += 1
            except PredictionGateError as exc:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("update internal.prediction_jobs set status='ABSTAINED', finished_at=now(), error_code='PREDICTION_GATE', error_message=%s where job_id=%s", (str(exc)[:2000], job["job_id"]))
                abstained += 1
            except Exception as exc:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("update internal.prediction_jobs set status='FAILED', finished_at=now(), error_code='PREDICTION_WORKER_FAILED', error_message=%s where job_id=%s", (str(exc)[:2000], job["job_id"]))
                failed += 1
        return {"status": "OK", "model_version_id": model_id, "jobs_claimed": len(jobs), "succeeded": succeeded, "failed": failed, "abstained": abstained}
    finally:
        conn.close()


if __name__ == "__main__":
    print(json.dumps(run_once(), separators=(",", ":")))
