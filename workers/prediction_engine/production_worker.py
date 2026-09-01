from __future__ import annotations

"""Production prediction worker.

Hard boundaries:
- Reads only scheduled canonical fixtures inside the current 7-day horizon.
- Never reads rolling fixtures as training data.
- Requires the exact model version pinned on the queued job and a valid S3 artifact.
- Writes the immutable prediction baseline only after all gates pass.
- Consumes the existing PGMQ prediction_queue; enqueue_due_predictions is the
  canonical control-plane producer.
"""

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
        raise PredictionGateError("invalid_model_artifact_uri")
    return json.loads(client.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))["Body"].read())


def load_model_for_job(conn, model_version_id: str) -> ModelState:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id::text, status, artifact_uri, training_cutoff
              from public.model_versions
             where id=%s
               and upper(status) in ('ACTIVE','PRODUCTION','PRODUCTION_ENABLED')
               and artifact_uri is not null
               and training_cutoff is not null
             limit 1
            """,
            (model_version_id,),
        )
        row = cur.fetchone()
    if not row:
        raise PredictionGateError("queued_model_not_production_enabled")
    document = _read_json_s3(s3_client(), str(row["artifact_uri"]))
    return parse_model_state(document, model_version_id, row["training_cutoff"])


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
    home_lambda = max(0.05, model.league_rate * (max(ha, 0.05) / max(ad, 0.05)) ** 0.5 * (0.75 + 0.5 * elo_factor))
    away_lambda = max(0.05, model.league_rate * (max(aa, 0.05) / max(hd, 0.05)) ** 0.5 * (1.25 - 0.5 * elo_factor))
    matrix = probability_matrix(home_lambda, away_lambda, model.rho, model.max_goals)
    return (*result_probabilities(matrix), home_lambda, away_lambda)


def baseline_pick(probs: tuple[float, float, float]) -> tuple[str, float]:
    labels = ("HOME", "DRAW", "AWAY")
    idx = max(range(3), key=lambda i: probs[i])
    return labels[idx], probs[idx]


def baseline_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def claim_pgmq_messages(conn, limit: int = 25) -> list[dict[str, Any]]:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("select msg_id, message from pgmq.read(%s,%s,%s,%s)", ("prediction_queue", 300, limit, "{}"))
            rows = cur.fetchall()
    return [{"msg_id": int(r["msg_id"]), **dict(r["message"])} for r in rows]


def load_job_by_worker_id(conn, worker_job_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select pj.job_id, pj.fixture_id, pj.episode_id, pj.model_version_id, pj.policy_bundle_id,
                   pj.worker_job_id, pj.status as prediction_status,
                   f.kickoff_at, f.home_team_id, f.away_team_id, f.status as fixture_status,
                   fe.episode_status
              from internal.prediction_jobs pj
              join public.fixtures f on f.id=pj.fixture_id
              join public.fixture_episodes fe on fe.id=pj.episode_id
             where pj.worker_job_id=%s
             limit 1
            """,
            (worker_job_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def mark_job_running(conn, worker_job_id: str, prediction_job_id: str) -> None:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.worker_jobs set status='RUNNING', started_at=coalesce(started_at,now()), worker_id=coalesce(worker_id,'prediction_worker') where job_id=%s", (worker_job_id,))
            cur.execute("update internal.prediction_jobs set status='RUNNING', started_at=coalesce(started_at,now()) where job_id=%s and status in ('QUEUED','FAILED')", (prediction_job_id,))


def delete_message(conn, msg_id: int) -> None:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("select pgmq.delete(%s,%s)", ("prediction_queue", msg_id))


def run_once(limit: int = 25) -> dict[str, Any]:
    conn = db_connect()
    try:
        messages = claim_pgmq_messages(conn, limit)
        succeeded = failed = abstained = 0
        for msg in messages:
            worker_job_id = str(msg.get("job_id"))
            prediction_job_id = None
            try:
                if not worker_job_id:
                    raise PredictionGateError("queue_message_missing_job_id")
                job = load_job_by_worker_id(conn, worker_job_id)
                if not job:
                    raise PredictionGateError("prediction_job_not_found")
                prediction_job_id = str(job["job_id"])
                mark_job_running(conn, worker_job_id, prediction_job_id)
                if str(job["fixture_status"]).lower() != "scheduled" or str(job["episode_status"]).upper() != "ACTIVE":
                    raise PredictionGateError("fixture_not_prediction_eligible")
                now = datetime.now(timezone.utc)
                kickoff = job["kickoff_at"].astimezone(timezone.utc)
                if kickoff < now or kickoff >= now + timedelta(days=7):
                    raise PredictionGateError("fixture_outside_7d_horizon")
                for field, error_code in (("fixture_id", "queue_fixture_identity_mismatch"), ("episode_id", "queue_episode_identity_mismatch"), ("model_version_id", "queue_model_identity_mismatch"), ("policy_bundle_id", "queue_policy_identity_mismatch")):
                    if msg.get(field) and str(msg[field]) != str(job[field]):
                        raise PredictionGateError(error_code)
                model = load_model_for_job(conn, str(job["model_version_id"]))
                if model.training_cutoff >= kickoff:
                    raise PredictionGateError("model_training_cutoff_not_before_fixture")
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
                        cur.execute("update internal.prediction_jobs set status='SUCCEEDED', finished_at=now(), error_code=null, error_message=null where job_id=%s", (prediction_job_id,))
                        cur.execute("update internal.worker_jobs set status='SUCCEEDED', finished_at=now(), lease_expires_at=null, error_code=null, error_message=null where job_id=%s", (worker_job_id,))
                delete_message(conn, int(msg["msg_id"]))
                succeeded += 1
            except PredictionGateError as exc:
                with conn.transaction():
                    with conn.cursor() as cur:
                        if prediction_job_id:
                            cur.execute("update internal.prediction_jobs set status='ABSTAINED', finished_at=now(), error_code='PREDICTION_GATE', error_message=%s where job_id=%s", (str(exc)[:2000], prediction_job_id))
                        cur.execute("update internal.worker_jobs set status='FAILED', finished_at=now(), error_code='PREDICTION_GATE', error_message=%s where job_id=%s", (str(exc)[:2000], worker_job_id))
                delete_message(conn, int(msg["msg_id"]))
                abstained += 1
            except Exception as exc:
                with conn.transaction():
                    with conn.cursor() as cur:
                        if prediction_job_id:
                            cur.execute("update internal.prediction_jobs set status='FAILED', finished_at=now(), error_code='PREDICTION_WORKER_FAILED', error_message=%s where job_id=%s", (str(exc)[:2000], prediction_job_id))
                        cur.execute("update internal.worker_jobs set status='FAILED', finished_at=now(), error_code='PREDICTION_WORKER_FAILED', error_message=%s where job_id=%s", (str(exc)[:2000], worker_job_id))
                failed += 1
        return {"status": "OK", "jobs_claimed": len(messages), "succeeded": succeeded, "failed": failed, "abstained": abstained}
    finally:
        conn.close()


if __name__ == "__main__":
    print(json.dumps(run_once(), separators=(",", ":")))
