#!/usr/bin/env python3
"""Canonical Historical Bootstrap runner.

The existing dataset implementation remains in worker.py; this module owns the
runtime contract: atomic DB claim/attempt state, a shared quota gate, request
accounting, idempotent checkpoint registration/finalization, and self-healing.
No Edge-function worker/orchestrator is required for historical execution.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from workers.historical_backfill import worker

DB_URL = os.environ["SUPABASE_DB_URL"]
QUEUE_NAME = "backfill_queue"
WORKER_ID = f"historical-canonical:{socket.gethostname()}:{os.getpid()}"
PROVIDER = "api-football"
MAX_RUNTIME_SECONDS = int(os.getenv("MAX_RUNTIME_SECONDS", "540"))
IDLE_SLEEP_SECONDS = float(os.getenv("IDLE_SLEEP_SECONDS", "5"))
MAX_CLAIM_SCAN = int(os.getenv("MAX_CLAIM_SCAN", "25"))

_CONTEXT: dict[str, object] | None = None
_ORIGINAL_API_JSON = worker.api_json
_ORIGINAL_UPLOAD_S3 = worker.upload_s3
_ORIGINAL_MARK_SUCCEEDED = worker.mark_succeeded
_ORIGINAL_MARK_RETRYABLE = worker.mark_retryable
_ORIGINAL_MARK_FAILED = worker.mark_failed

# The DB governor is authoritative; the process-local limiter is disabled so
# independent workers cannot accidentally multiply a local 12/min cap.
worker.LIMITER.limit = 10**9


def connect():
    return psycopg.connect(DB_URL, row_factory=dict_row, connect_timeout=15)


def _candidate(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            select b.job_id
              from internal.backfill_jobs b
             where b.status in ('QUEUED','RETRYABLE','RETRYING')
               and (b.next_retry_at is null or b.next_retry_at <= now())
             order by b.priority desc, b.created_at asc
             for update of b skip locked
             limit 1
            """
        )
        row = cur.fetchone()
        return str(row["job_id"]) if row else None


def claim_job(conn):
    for _ in range(MAX_CLAIM_SCAN):
        job_id = _candidate(conn)
        if not job_id:
            return None
        with conn.cursor() as cur:
            cur.execute(
                "select internal.claim_backfill_job(%s,%s) as result",
                (job_id, WORKER_ID),
            )
            result = cur.fetchone()["result"]
        if not result.get("ok"):
            continue
        # Enforce the architecture's five-attempt cap in the canonical path.
        if int(result.get("attempt_no") or 0) > 5:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "update internal.backfill_job_attempts set status='DEAD_LETTER',finished_at=now(),lease_expires_at=null,error_code='ATTEMPT_LIMIT_EXCEEDED',error_message='Canonical worker attempt cap reached.' where attempt_id=%s",
                        (result["attempt_id"],),
                    )
                    cur.execute(
                        "update internal.backfill_jobs set status='DEAD_LETTER',updated_at=now(),error_code='ATTEMPT_LIMIT_EXCEEDED',error_message='Canonical worker attempt cap reached.' where job_id=%s",
                        (job_id,),
                    )
                    cur.execute(
                        "update internal.worker_jobs set status='DEAD_LETTER',finished_at=now(),lease_expires_at=null,error_code='ATTEMPT_LIMIT_EXCEEDED',error_message='Canonical worker attempt cap reached.' where job_id=%s",
                        (result["worker_job_id"],),
                    )
            continue
        return result
    return None


def _request_url(path: str, params: dict[str, object] | None):
    return f"{worker.BASE_URL}{path}?{urlencode(params)}" if params else f"{worker.BASE_URL}{path}"


def _db_exec(conn, sql: str, args):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return row


def api_json(path: str, params: dict[str, object] | None = None, timeout: int = 90):
    ctx = _CONTEXT
    if not ctx:
        return _ORIGINAL_API_JSON(path, params, timeout)
    conn = ctx["conn"]
    job = ctx["job"]
    attempt_id = ctx["attempt_id"]
    attempt_no = ctx["attempt_no"]
    request_url = _request_url(path, params)

    # Wait on the authoritative DB quota reservation, never on a process-local
    # counter.  This coordinates every worker across every GitHub runner.
    while True:
        try:
            row = _db_exec(
                conn,
                "select internal.begin_provider_request(%s,%s,%s,%s,%s,%s) as request_id",
                (PROVIDER, 1, job["job_id"], job["worker_job_id"], attempt_no, path),
            )
            request_id = row["request_id"]
            break
        except Exception as exc:
            text = str(exc)
            if "BACKFILL_OR_RATE_QUOTA_EXHAUSTED" in text or "PROVIDER_REQUEST" in text:
                time.sleep(2)
                continue
            raise

    ctx["request_ids"].append(str(request_id))
    try:
        body = _ORIGINAL_API_JSON(path, params, timeout)
        rows = len(body.get("response") or []) if isinstance(body, dict) else None
        _db_exec(
            conn,
            "select internal.finalize_provider_request(%s,%s,%s,%s,%s,%s)",
            (request_id, "SUCCEEDED", 200, rows, None, None),
        )
        return body
    except worker.ProviderRateLimit as exc:
        _db_exec(
            conn,
            "select internal.finalize_provider_request(%s,%s,%s,%s,%s,%s)",
            (request_id, "RATE_LIMITED", 429, None, "PROVIDER_RATE_LIMIT", str(exc)),
        )
        raise
    except worker.RetryableProviderError as exc:
        _db_exec(
            conn,
            "select internal.finalize_provider_request(%s,%s,%s,%s,%s,%s)",
            (request_id, "RETRYABLE", 503, None, "PROVIDER_TRANSIENT", str(exc)),
        )
        raise
    except Exception as exc:
        _db_exec(
            conn,
            "select internal.finalize_provider_request(%s,%s,%s,%s,%s,%s)",
            (request_id, "FAILED", None, None, "PROVIDER_REQUEST_FAILED", str(exc)),
        )
        raise


def upload_s3(payload: bytes, job: dict, checksum: str) -> str:
    client = boto3.client(
        "s3",
        region_name=os.environ["S3_REGION"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        endpoint_url=os.getenv("S3_ENDPOINT_URL", "").strip() or None,
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )
    bucket = os.environ["S3_BUCKET"]
    campaign_id = str(job["historical_campaign_id"])
    prefix = os.getenv("S3_PREFIX", "zahrly/archive").strip("/")
    key = (
        f"{prefix}/historical-runs/campaign={campaign_id}/"
        f"season={job['season']}/country={str(job.get('country_code') or 'unknown').replace('/', '_')}/"
        f"league={job['provider_league_id']}/dataset={job['dataset_type']}/job={job['job_id']}.json"
    )
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=payload,
        ContentType="application/json",
        Metadata={
            "provider": PROVIDER,
            "campaign-id": campaign_id,
            "season": str(job["season"]),
            "dataset": str(job["dataset_type"]),
            "checksum": checksum,
        },
    )
    head = client.head_object(Bucket=bucket, Key=key)
    if int(head.get("ContentLength", -1)) != len(payload):
        raise RuntimeError("S3 object length verification failed")
    check = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    if hashlib.sha256(check).hexdigest() != checksum:
        raise RuntimeError("S3 object checksum verification failed")
    return f"s3://{bucket}/{key}"


def mark_succeeded(conn, job, document, object_uri, checksum, row_count, requests_used):
    ctx = _CONTEXT
    if ctx and ctx["request_ids"]:
        request_id = ctx["request_ids"][-1]
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "select internal.register_provider_request_checkpoint(%s,%s,%s,%s,%s)",
                    (uuid.UUID(request_id), object_uri, checksum, row_count, "PERSISTED"),
                )
        # The old finalizer chain is deliberately not called.  We have already
        # supplied the non-null checksum and verified the S3 bytes locally.
    return _ORIGINAL_MARK_SUCCEEDED(conn, job, document, object_uri, checksum, row_count, requests_used)


def mark_retryable(conn, job, exc, retry_after=60):
    message = str(exc)[:worker.MAX_ERROR_LENGTH]
    seconds = max(5, int(retry_after or 60))
    retry_at = datetime.now(timezone.utc).timestamp() + seconds
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "update internal.backfill_job_attempts set status='RETRYABLE',finished_at=now(),lease_expires_at=null,last_heartbeat_at=now(),error_code='PROVIDER_RATE_LIMIT',error_message=%s where attempt_id=%s and status='RUNNING'",
                (message, (_CONTEXT or {}).get("attempt_id")),
            )
            cur.execute(
                "update internal.backfill_jobs set status='RETRYABLE',next_retry_at=to_timestamp(%s),updated_at=now(),error_code='PROVIDER_RATE_LIMIT',error_message=%s where job_id=%s",
                (retry_at, message, job["job_id"]),
            )
            cur.execute(
                "update internal.worker_jobs set status='RETRYABLE',finished_at=null,lease_expires_at=null,error_code='PROVIDER_RATE_LIMIT',error_message=%s,next_retry_at=to_timestamp(%s) where job_id=%s",
                (message, retry_at, job["worker_job_id"]),
            )


def mark_failed(conn, job, exc):
    message = str(exc)[:worker.MAX_ERROR_LENGTH]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("select attempts from internal.worker_jobs where job_id=%s", (job["worker_job_id"],))
            attempts = int((cur.fetchone() or {}).get("attempts") or 0)
            terminal = attempts >= 5
            state = "DEAD_LETTER" if terminal else "FAILED"
            code = "ATTEMPT_LIMIT_EXCEEDED" if terminal else "HISTORICAL_DATASET_FAILED"
            cur.execute(
                "update internal.backfill_job_attempts set status=%s,finished_at=now(),lease_expires_at=null,error_code=%s,error_message=%s where attempt_id=%s and status='RUNNING'",
                (state, code, message, (_CONTEXT or {}).get("attempt_id")),
            )
            cur.execute(
                "update internal.backfill_jobs set status=%s,updated_at=now(),error_code=%s,error_message=%s where job_id=%s",
                (state, code, message, job["job_id"]),
            )
            cur.execute(
                "update internal.worker_jobs set status=%s,finished_at=now(),lease_expires_at=null,error_code=%s,error_message=%s where job_id=%s",
                (state, code, message, job["worker_job_id"]),
            )


def run_one(conn):
    global _CONTEXT
    job = claim_job(conn)
    if not job:
        return {"processed": False, "reason": "no_ready_historical_job"}
    _CONTEXT = {
        "conn": conn,
        "job": job,
        "attempt_id": job["attempt_id"],
        "attempt_no": int(job["attempt_no"]),
        "request_ids": [],
    }
    try:
        return worker.run_one(conn)
    finally:
        _CONTEXT = None


def main() -> int:
    worker.claim_job = claim_job
    worker.api_json = api_json
    worker.upload_s3 = upload_s3
    worker.mark_succeeded = mark_succeeded
    worker.mark_retryable = mark_retryable
    worker.mark_failed = mark_failed

    deadline = time.monotonic() + MAX_RUNTIME_SECONDS
    processed = 0
    conn = connect()
    try:
        while time.monotonic() < deadline:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("select internal.queue_recovery()")
                    cur.execute("select internal.recover_stale_backfill_attempts()")
                    cur.execute("select internal.recover_backfill_no_progress_attempts()")
            result = run_one(conn)
            if result.get("processed"):
                processed += 1
                continue
            time.sleep(IDLE_SLEEP_SECONDS)
        print(json.dumps({"worker": WORKER_ID, "processed": processed}, separators=(",", ":")), flush=True)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
