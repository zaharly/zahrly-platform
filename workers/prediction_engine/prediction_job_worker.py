from __future__ import annotations

import json
from datetime import datetime, timezone

from workers.prediction_engine.prediction_lifecycle import (
    baseline,
    db_connect,
    load_artifact,
    load_model,
    calibration,
    policy,
    process,
)


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
                # QUEUED jobs have not executed yet. Rebind them atomically to the
                # current shadow candidate so stale model/policy lineage cannot block
                # the unified lifecycle. No completed prediction is rewritten here.
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
                if result.get("read_model_published"):
                    conn.execute(
                        "update internal.prediction_jobs set status='SUCCEEDED',"
                        "finished_at=now(),error_code=null,error_message=null "
                        "where job_id=%s::uuid",
                        (job_id,),
                    )
                elif result.get("status") == "GATE_BLOCKED":
                    conn.execute(
                        "update internal.prediction_jobs set status='QUEUED',"
                        "started_at=null,finished_at=null,error_code='PREDICTION_GATE_BLOCKED',"
                        "error_message=%s where job_id=%s::uuid",
                        (json.dumps(result.get("gate", {}), default=str), job_id),
                    )
                else:
                    conn.execute(
                        "update internal.prediction_jobs set status='QUEUED',"
                        "started_at=null,finished_at=null,error_code='LIFECYCLE_RETRY',"
                        "error_message=%s where job_id=%s::uuid",
                        (result.get("status", "RETRY"), job_id),
                    )
                conn.commit()
                results.append(result)
            except Exception as exc:
                conn.rollback()
                conn.execute(
                    "update internal.prediction_jobs set status='QUEUED',"
                    "started_at=null,finished_at=null,error_code='LIFECYCLE_RETRY',"
                    "error_message=%s where job_id=%s::uuid and status='RUNNING'",
                    (str(exc)[:2000], job_id),
                )
                conn.commit()
                results.append({"job_id": job_id, "status": "RETRY", "error": str(exc)[:2000]})

        print(json.dumps({
            "ok": True,
            "worker": "prediction-job-worker-v1",
            "model_version_id": model["id"],
            "jobs_claimed": len(jobs),
            "jobs_succeeded": sum(1 for r in results if r.get("read_model_published")),
            "jobs_gate_blocked": sum(1 for r in results if r.get("status") == "GATE_BLOCKED"),
            "jobs_retry": sum(1 for r in results if r.get("status") == "RETRY"),
        }, default=str))


if __name__ == "__main__":
    main()
