#!/usr/bin/env python3
"""Canonical historical backfill worker.

Consumes the internal backfill control plane, calls API-Football for one
league/season, persists normalized fixtures through the private provider
fixture gateway, and advances the canonical backfill/worker job state.
"""
from __future__ import annotations

import json
import os
import socket
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg
from psycopg.rows import dict_row

from workers.provider_gateway.api_football import fetch_fixtures_for_league_season

QUEUE_NAME = "backfill_queue"
WORKER_ID_PREFIX = "historical-backfill"
MAX_ERROR_LENGTH = 2000


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value or default


def connect():
    return psycopg.connect(env("SUPABASE_DB_URL"), row_factory=dict_row, connect_timeout=15)


def persist_fixture(fixture: dict[str, object]) -> dict[str, object]:
    url = env("PROVIDER_FIXTURE_PERSISTENCE_URL")
    secret = env("PROVIDER_GATEWAY_SECRET")
    body = json.dumps({"fixture": fixture}).encode("utf-8")
    request = Request(
        url.rstrip("/"),
        data=body,
        method="POST",
        headers={"content-type": "application/json", "x-provider-gateway-secret": secret},
    )
    with urlopen(request, timeout=60) as response:
        result = json.load(response)
    if result.get("persisted") is not True:
        raise RuntimeError(f"fixture persistence failed: {result}")
    return result


def claim_job(conn):
    worker_id = f"{WORKER_ID_PREFIX}:{socket.gethostname()}"
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                select b.*, c.provider_ids->>'api_football' as provider_league_id,
                       c.canonical_name as competition_name, w.job_id as worker_job_id
                  from internal.backfill_jobs b
                  join public.competitions c on c.id = b.league_id
                  join internal.worker_jobs w
                    on w.idempotency_key = 'backfill:' || b.job_id::text
                 where b.status = 'QUEUED'
                   and w.queue_name = %s
                   and w.status = 'QUEUED'
                   and b.dataset_type = 'fixtures'
                 order by b.priority desc, b.created_at asc
                 for update of b, w skip locked
                 limit 1
                """,
                (QUEUE_NAME,),
            )
            job = cur.fetchone()
            if not job:
                return None

            cur.execute(
                """
                update internal.worker_jobs
                   set status='RUNNING', worker_id=%s, attempts=attempts+1,
                       started_at=coalesce(started_at, now()),
                       lease_expires_at=now() + interval '30 minutes',
                       error_code=null, error_message=null
                 where job_id=%s and status='QUEUED'
                """,
                (worker_id, job["worker_job_id"]),
            )
            if cur.rowcount != 1:
                return None

            cur.execute(
                """
                update internal.backfill_jobs
                   set status='RUNNING', updated_at=now(), next_retry_at=null
                 where job_id=%s
                """,
                (job["job_id"],),
            )
            return job


def update_progress(conn, job: dict[str, object], progress: int, requests_used: int):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                update internal.backfill_jobs
                   set progress=%s, requests_used=%s, updated_at=now()
                 where job_id=%s
                """,
                (progress, requests_used, job["job_id"]),
            )


def mark_succeeded(conn, job: dict[str, object], row_count: int, provider_league_id: int):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.provider_capabilities
                  (provider, competition, season, endpoint, market, status, checked_at, created_at, updated_at)
                values ('api-football', %s, %s, 'fixtures', null, 'SUPPORTED', now(), now(), now())
                on conflict (provider, competition, season, endpoint, market)
                do update set status='SUPPORTED', checked_at=now(), updated_at=now()
                """,
                (job["league_id"], job["season"]),
            )
            cur.execute(
                """
                update internal.backfill_jobs
                   set status='SUCCEEDED', progress=100, requests_used=1, updated_at=now(), next_retry_at=null
                 where job_id=%s
                """,
                (job["job_id"],),
            )
            cur.execute(
                """
                update internal.worker_jobs
                   set status='SUCCEEDED', finished_at=now(), lease_expires_at=null,
                       error_code=null, error_message=null
                 where job_id=%s
                """,
                (job["worker_job_id"],),
            )
    return {
        "job_id": str(job["job_id"]),
        "worker_job_id": str(job["worker_job_id"]),
        "season": int(job["season"]),
        "competition_id": str(job["league_id"]),
        "competition_name": str(job.get("competition_name") or ""),
        "provider_league_id": provider_league_id,
        "row_count": row_count,
        "status": "SUCCEEDED",
    }


def mark_failed(conn, job: dict[str, object], exc: Exception):
    message = str(exc)[:MAX_ERROR_LENGTH]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                update internal.backfill_jobs
                   set status='FAILED', next_retry_at=now() + interval '5 minutes', updated_at=now()
                 where job_id=%s
                """,
                (job["job_id"],),
            )
            cur.execute(
                """
                update internal.worker_jobs
                   set status='FAILED', finished_at=now(), lease_expires_at=null,
                       error_code='HISTORICAL_BACKFILL_FAILED', error_message=%s
                 where job_id=%s
                """,
                (message, job["worker_job_id"]),
            )
    return message


def run_one(conn):
    job = claim_job(conn)
    if not job:
        return {"processed": False, "reason": "no_queued_historical_job"}
    try:
        provider_league_id_raw = job.get("provider_league_id")
        if not provider_league_id_raw:
            raise RuntimeError(f"competition {job['league_id']} has no api_football provider id")
        provider_league_id = int(provider_league_id_raw)
        season = int(job["season"])

        update_progress(conn, job, 5, 0)
        fixtures = fetch_fixtures_for_league_season(provider_league_id, season)
        update_progress(conn, job, 20, 1)

        persisted = 0
        for fixture in fixtures:
            persist_fixture(fixture)
            persisted += 1
            progress = 20 if not fixtures else 20 + int((persisted / len(fixtures)) * 75)
            update_progress(conn, job, min(progress, 95), 1)

        return {"processed": True, **mark_succeeded(conn, job, persisted, provider_league_id)}
    except Exception as exc:
        error = mark_failed(conn, job, exc)
        return {
            "processed": True,
            "job_id": str(job["job_id"]),
            "worker_job_id": str(job["worker_job_id"]),
            "season": int(job["season"]),
            "competition_id": str(job["league_id"]),
            "status": "FAILED",
            "error_code": "HISTORICAL_BACKFILL_FAILED",
            "error_message": error,
        }


def main() -> int:
    conn = None
    try:
        conn = connect()
        batch_size = max(1, min(int(os.environ.get("BATCH_SIZE", "10")), 100))
        results = []
        for _ in range(batch_size):
            result = run_one(conn)
            results.append(result)
            if result.get("processed") is not True:
                break
        print(json.dumps({"processed": [r for r in results if r.get("processed")], "idle": not any(r.get("processed") for r in results)}, separators=(",", ":")), flush=True)
        return 0 if not any(r.get("status") == "FAILED" for r in results) else 1
    except (HTTPError, URLError) as exc:
        print(f"historical backfill provider boundary failed: {exc}", file=sys.stderr, flush=True)
        return 1
    except Exception as exc:
        print(f"historical backfill worker failed: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
