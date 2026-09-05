from __future__ import annotations

import json
from datetime import datetime, timezone

from workers.prediction_engine.prediction_lifecycle import (
    calibration,
    db_connect,
    load_artifact,
    load_model,
    policy,
    process,
)


class GateBlocked(Exception):
    def __init__(self, gate: dict):
        super().__init__(json.dumps(gate, default=str))
        self.gate = gate


def main() -> None:
    now = datetime.now(timezone.utc)
    with db_connect() as conn:
        release, loaded = load_model(conn)
        model = dict(loaded)
        artifact, artifact_sha = load_artifact(model["artifact_uri"])
        temperature, cal_version, cal_status = calibration(conn)
        training = conn.execute(
            "select status from public.prediction_training_runs "
            "where model_version_id=%s::uuid order by started_at desc limit 1",
            (model["id"],),
        ).fetchone() or {}
        pol = policy(conn)

        jobs = conn.execute(
            "select j.job_id::text as job_id,j.fixture_id::text as fixture_id,"
            "j.episode_id::text as episode_id,j.model_version_id::text as old_model_version_id,"
            "j.policy_bundle_id::text as old_policy_bundle_id,"
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
                    # A job that has never executed can safely be rebound to the
                    # current shadow candidate. Completed predictions are untouched.
                    conn.execute(
                        "update internal.prediction_jobs set model_version_id=%s::uuid,"
                        "policy_bundle_id=%s::uuid,worker_job_id=%s::uuid,started_at=now(),"
                        "finished_at=null,error_code=null,error_message=null,status='RUNNING' "
                        "where job_id=%s::uuid and status='QUEUED'",
                        (model["id"], pol["id"], job_id, job_id),
                    )
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
                results.append(result)
            except GateBlocked as exc:
                conn.rollback()
                conn.execute(
                    "update internal.prediction_jobs set status='QUEUED',started_at=null,"
                    "finished_at=null,error_code='PREDICTION_GATE_BLOCKED',error_message=%s "
                    "where job_id=%s::uuid and status='RUNNING'",
                    (str(exc), job_id),
                )
                conn.commit()
                results.append({"job_id": job_id, "status": "GATE_BLOCKED", "gate": exc.gate})
            except Exception as exc:
                conn.rollback()
                conn.execute(
                    "update internal.prediction_jobs set status='QUEUED',started_at=null,"
                    "finished_at=null,error_code='LIFECYCLE_RETRY',error_message=%s "
                    "where job_id=%s::uuid and status='RUNNING'",
                    (str(exc)[:2000], job_id),
                )
                conn.commit()
                results.append({"job_id": job_id, "status": "RETRY", "error": str(exc)[:2000]})

        print(json.dumps({
            "ok": True,
            "worker": "prediction-job-worker-v2",
            "model_version_id": model["id"],
            "jobs_claimed": len(jobs),
            "jobs_succeeded": sum(1 for r in results if r.get("status", "").startswith("PUBLISHED") or r.get("read_model_published")),
            "jobs_gate_blocked": sum(1 for r in results if r.get("status") == "GATE_BLOCKED"),
            "jobs_retry": sum(1 for r in results if r.get("status") == "RETRY"),
        }, default=str))


if __name__ == "__main__":
    main()
