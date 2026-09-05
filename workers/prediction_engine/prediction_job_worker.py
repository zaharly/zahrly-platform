from __future__ import annotations

import json
from datetime import datetime, timezone

from workers.prediction_engine.prediction_lifecycle import (
    calibration,
    db_connect,
    load_artifact,
    policy,
    process,
    state_coverage,
)


class GateBlocked(Exception):
    def __init__(self, gate: dict):
        super().__init__(json.dumps(gate, default=str))
        self.gate = gate


def load_job_model(conn, model_id: str):
    release = conn.execute(
        "select model_version_id::text as model_version_id,release_version,status,created_at "
        "from public.model_releases where model_version_id=%s::uuid "
        "order by created_at desc limit 1",
        (model_id,),
    ).fetchone()
    if not release:
        raise RuntimeError(f"model_release_missing:{model_id}")
    model = conn.execute(
        "select id::text as id,version,artifact_uri,training_cutoff "
        "from public.model_versions where id=%s::uuid",
        (model_id,),
    ).fetchone()
    if not model or not model.get("artifact_uri"):
        raise RuntimeError(f"model_artifact_missing:{model_id}")
    return release, model


def load_job_policy(conn, policy_id: str):
    row = conn.execute(
        "select id::text as id,version,payload from public.policy_versions where id=%s::uuid",
        (policy_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"policy_missing:{policy_id}")
    return row


def ensure_rolling_lineage(conn, now: datetime) -> tuple[str, int, int, int]:
    """Materialize the current seven-day window and guarantee every eligible
    active fixture/episode has an auditable prediction job linked to that window."""
    window_end = now + __import__('datetime').timedelta(days=7)
    release = conn.execute(
        "select model_version_id::text as model_version_id from public.model_releases "
        "where status in ('SHADOW','ACTIVE') order by created_at desc limit 1"
    ).fetchone()
    if not release:
        raise RuntimeError("prediction_model_release_missing_for_rolling_window")
    pol = conn.execute(
        "select id::text as id from public.policy_versions "
        "where policy_type='prediction' and version='prediction-v1' limit 1"
    ).fetchone()
    if not pol:
        raise RuntimeError("prediction_policy_missing_for_rolling_window")

    window = conn.execute(
        "insert into internal.prediction_rolling_windows(window_start,window_end,source,status) "
        "values(%s,%s,'github-actions:prediction-runtime','COMPLETED') returning id::text as id",
        (now, window_end),
    ).fetchone()

    candidates = conn.execute(
        "select f.id::text as fixture_id,e.id::text as episode_id "
        "from public.fixtures f join public.fixture_episodes e on e.fixture_id=f.id "
        "where f.status='scheduled' and e.episode_status='ACTIVE' "
        "and f.kickoff_at>=%s and f.kickoff_at<%s",
        (now, window_end),
    ).fetchall()
    created = 0
    already = 0
    for c in candidates:
        existing = conn.execute(
            "select job_id::text as job_id from internal.prediction_jobs "
            "where fixture_id=%s::uuid and episode_id=%s::uuid "
            "and model_version_id=%s::uuid and policy_bundle_id=%s::uuid limit 1",
            (c['fixture_id'], c['episode_id'], release['model_version_id'], pol['id']),
        ).fetchone()
        if existing:
            already += 1
            conn.execute(
                "update internal.prediction_jobs set rolling_window_id=%s::uuid, "
                "rolling_entered_at=coalesce(rolling_entered_at,%s),rolling_source='7-day-rolling' "
                "where job_id=%s::uuid and (rolling_window_id is null or rolling_source is null)",
                (window['id'], now, existing['job_id']),
            )
            continue
        conn.execute(
            "insert into internal.prediction_jobs "
            "(fixture_id,episode_id,model_version_id,policy_bundle_id,status,created_at,rolling_window_id,rolling_entered_at,rolling_source) "
            "values(%s::uuid,%s::uuid,%s::uuid,%s::uuid,'QUEUED',now(),%s::uuid,%s,'7-day-rolling')",
            (c['fixture_id'], c['episode_id'], release['model_version_id'], pol['id'], window['id'], now),
        )
        created += 1

    conn.execute(
        "update internal.prediction_rolling_windows set candidate_count=%s,jobs_created=%s,jobs_already_present=%s,status='COMPLETED' "
        "where id=%s::uuid",
        (len(candidates), created, already, window['id']),
    )
    return window['id'], len(candidates), created, already


def main() -> None:
    now = datetime.now(timezone.utc)
    with db_connect() as conn:
        rolling_window_id, rolling_candidates, rolling_created, rolling_existing = ensure_rolling_lineage(conn, now)
        temperature, cal_version, cal_status = calibration(conn)
        jobs = conn.execute(
            "select j.job_id::text as job_id,j.fixture_id::text as fixture_id,"
            "j.episode_id::text as episode_id,j.model_version_id::text as model_version_id,"
            "j.policy_bundle_id::text as policy_bundle_id,"
            "f.home_team_id::text as home_team_id,f.away_team_id::text as away_team_id,"
            "f.kickoff_at,f.status,e.episode_status,e.episode_no "
            "from internal.prediction_jobs j "
            "join public.fixtures f on f.id=j.fixture_id "
            "join public.fixture_episodes e on e.id=j.episode_id "
            "where j.status='QUEUED' and f.status='scheduled' and e.episode_status='ACTIVE' "
            "and f.kickoff_at>=now() and f.kickoff_at<now()+interval '7 days' "
            "order by f.kickoff_at asc limit 100",
        ).fetchall()

        results = []
        for row in jobs:
            job_id = row["job_id"]
            try:
                with conn.transaction():
                    conn.execute(
                        "insert into internal.worker_jobs "
                        "(job_id,queue_name,idempotency_key,status,attempts,worker_id,started_at,finished_at,error_code,error_message) "
                        "values (%s::uuid,'prediction_queue',%s,'RUNNING',1,'prediction-job-worker-v3',now(),null,null,null) "
                        "on conflict (job_id) do update set "
                        "status='RUNNING',attempts=internal.worker_jobs.attempts+1,"
                        "worker_id='prediction-job-worker-v3',started_at=now(),finished_at=null,"
                        "error_code=null,error_message=null",
                        (job_id, f"prediction:{job_id}"),
                    )
                    claimed = conn.execute(
                        "update internal.prediction_jobs set worker_job_id=%s::uuid,started_at=now(),"
                        "finished_at=null,error_code=null,error_message=null,status='RUNNING' "
                        "where job_id=%s::uuid and status='QUEUED' returning job_id::text as job_id",
                        (job_id, job_id),
                    ).fetchone()
                    if not claimed:
                        continue

                    release, model = load_job_model(conn, row["model_version_id"])
                    pol = load_job_policy(conn, row["policy_bundle_id"])
                    artifact, artifact_sha = load_artifact(model["artifact_uri"])
                    training = conn.execute(
                        "select status from internal.prediction_training_runs "
                        "where model_version_id=%s::uuid order by started_at desc limit 1",
                        (model["id"],),
                    ).fetchone() or {}
                    fixture = {
                        "id": row["fixture_id"],
                        "home_team_id": row["home_team_id"],
                        "away_team_id": row["away_team_id"],
                        "kickoff_at": row["kickoff_at"],
                        "status": row["status"],
                    }
                    episode = {
                        "id": row["episode_id"],
                        "fixture_id": row["fixture_id"],
                        "episode_status": row["episode_status"],
                        "episode_no": row["episode_no"],
                    }

                    coverage, missing, sources = state_coverage(artifact, fixture)
                    if coverage < 1.0:
                        raise GateBlocked({
                            "eligible": False,
                            "canonical_fixture_valid": True,
                            "identity_quality": 1.0,
                            "minimum_feature_coverage": coverage,
                            "model_health": "HEALTHY",
                            "no_future_leakage": True,
                            "probability_state_valid": False,
                            "t_minus_hours": (row["kickoff_at"] - now).total_seconds() / 3600,
                            "team_state_sources": sources,
                            "missing_features": missing,
                            "reason": "missing_team_state",
                        })

                    result = process(
                        conn, fixture, episode, release, model, pol, artifact,
                        artifact_sha, cal_version, cal_status, training.get("status"),
                        temperature, now,
                    )
                    gate = result.get("gate") or {}
                    if not gate.get("eligible"):
                        raise GateBlocked(gate)
                    if not result.get("read_model_published"):
                        raise RuntimeError("prediction_lifecycle_did_not_publish_read_model")
                    conn.execute(
                        "update internal.prediction_jobs set status='SUCCEEDED',"
                        "finished_at=now(),error_code=null,error_message=null "
                        "where job_id=%s::uuid",
                        (job_id,),
                    )
                    conn.execute(
                        "update internal.worker_jobs set status='SUCCEEDED',finished_at=now(),"
                        "error_code=null,error_message=null where job_id=%s::uuid",
                        (job_id,),
                    )
                results.append(result)
            except GateBlocked as exc:
                conn.rollback()
                conn.execute(
                    "update internal.prediction_jobs set status='QUEUED',worker_job_id=null,started_at=null,"
                    "finished_at=null,error_code='PREDICTION_GATE_BLOCKED',error_message=%s "
                    "where job_id=%s::uuid",
                    (str(exc), job_id),
                )
                conn.execute(
                    "update internal.worker_jobs set status='RETRYABLE',finished_at=now(),"
                    "error_code='PREDICTION_GATE_BLOCKED',error_message=%s where job_id=%s::uuid",
                    (str(exc), job_id),
                )
                conn.commit()
                results.append({"job_id": job_id, "status": "GATE_BLOCKED", "gate": exc.gate})
            except Exception as exc:
                conn.rollback()
                conn.execute(
                    "update internal.prediction_jobs set status='QUEUED',worker_job_id=null,started_at=null,"
                    "finished_at=null,error_code='LIFECYCLE_RETRY',error_message=%s "
                    "where job_id=%s::uuid",
                    (str(exc)[:2000], job_id),
                )
                conn.execute(
                    "update internal.worker_jobs set status='RETRYABLE',finished_at=now(),"
                    "error_code='LIFECYCLE_RETRY',error_message=%s where job_id=%s::uuid",
                    (str(exc)[:2000], job_id),
                )
                conn.commit()
                results.append({"job_id": job_id, "status": "RETRY", "error": str(exc)[:2000]})

        print(json.dumps({
            "ok": True,
            "worker": "prediction-job-worker-v4",
            "rolling_window_id": rolling_window_id,
            "rolling_window_days": 7,
            "rolling_candidates": rolling_candidates,
            "rolling_jobs_created": rolling_created,
            "rolling_jobs_already_present": rolling_existing,
            "jobs_claimed": len(jobs),
            "jobs_succeeded": sum(1 for r in results if r.get("status", "").startswith("PUBLISHED") or r.get("read_model_published")),
            "jobs_gate_blocked": sum(1 for r in results if r.get("status") == "GATE_BLOCKED"),
            "jobs_retry": sum(1 for r in results if r.get("status") == "RETRY"),
        }, default=str))


if __name__ == "__main__":
    main()
