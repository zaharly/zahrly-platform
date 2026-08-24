#!/usr/bin/env python3
"""Historical archive worker.

Claims one queued archive campaign, materializes a deterministic archive artifact
for the E2E provider, uploads it to an S3-compatible bucket, verifies the object,
and atomically records the manifest/checksum in Supabase Postgres.

Production providers must supply a dataset materializer; the E2E provider is
intentionally deterministic so the storage contract can be proven without
fabricating production data.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import sys
import uuid
from datetime import datetime, timezone

import boto3
import psycopg
from psycopg.rows import dict_row


TEST_CAMPAIGN_ID = "74a52118-bffd-4438-9ddd-757928e094d4"


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def connect():
    return psycopg.connect(env("SUPABASE_DB_URL"), row_factory=dict_row)


def claim_campaign(conn):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                select c.*
                from internal.archive_campaigns c
                join internal.worker_jobs w on w.job_id = c.worker_job_id
                where c.campaign_id = %s
                  and c.status = 'QUEUED'
                  and w.status = 'QUEUED'
                for update of c, w
                """,
                (TEST_CAMPAIGN_ID,),
            )
            campaign = cur.fetchone()
            if not campaign:
                return None
            worker_id = f"archive-worker:{socket.gethostname()}"
            cur.execute(
                """
                update internal.worker_jobs
                   set status='RUNNING', worker_id=%s, attempts=attempts+1,
                       started_at=coalesce(started_at, now()),
                       lease_expires_at=now() + interval '15 minutes'
                 where job_id=%s and status='QUEUED'
                """,
                (worker_id, campaign["worker_job_id"]),
            )
            cur.execute(
                """
                update internal.archive_campaigns
                   set status='RUNNING', started_at=coalesce(started_at, now()), updated_at=now()
                 where campaign_id=%s
                """,
                (campaign["campaign_id"],),
            )
            campaign["status"] = "RUNNING"
            return campaign


def build_artifact(campaign: dict) -> tuple[bytes, int]:
    if campaign["provider"] != "e2e-provider":
        raise RuntimeError(f"unsupported archive provider for worker test: {campaign['provider']}")

    rows = [
        {
            "event": "archive_e2e_fixture",
            "season": campaign["season"],
            "dataset_type": campaign["dataset_type"],
            "sequence": i,
            "value": f"zahrly-e2e-{campaign['season']}-{i}",
        }
        for i in range(1, 4)
    ]
    document = {
        "schema_version": campaign["schema_version"],
        "campaign_id": str(campaign["campaign_id"]),
        "country_id": str(campaign["country_id"]),
        "competition_id": str(campaign["competition_id"]),
        "season": campaign["season"],
        "dataset_type": campaign["dataset_type"],
        "provider": campaign["provider"],
        "date_start": campaign["date_start"].isoformat(),
        "date_end": campaign["date_end"].isoformat(),
        "team_set_hash": campaign["team_set_hash"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
    }
    payload = (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return payload, len(rows)


def s3_client():
    endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip() or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=env("S3_SECRET_ACCESS_KEY"),
    )


def upload_and_verify(payload: bytes, campaign: dict) -> tuple[str, str]:
    bucket = env("S3_BUCKET")
    prefix = os.environ.get("S3_PREFIX", "zahrly/archive").strip("/")
    key = f"{prefix}/{campaign['dataset_type']}/season={campaign['season']}/campaign={campaign['campaign_id']}.json"
    digest = hashlib.sha256(payload).hexdigest()
    client = s3_client()
    client.put_object(Bucket=bucket, Key=key, Body=payload, ContentType="application/json")
    head = client.head_object(Bucket=bucket, Key=key)
    if int(head.get("ContentLength", -1)) != len(payload):
        raise RuntimeError("S3 object length verification failed")
    body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    if hashlib.sha256(body).hexdigest() != digest:
        raise RuntimeError("S3 object checksum verification failed")
    return f"s3://{bucket}/{key}", digest


def finalize(conn, campaign: dict, object_uri: str, checksum: str, row_count: int):
    manifest_id = uuid.uuid4()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into internal.archive_catalog
                  (manifest_id,country_id,competition_id,season,dataset_type,provider,
                   date_start,date_end,object_uri,checksum,row_count,completeness_score,
                   schema_version,team_set_hash)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    manifest_id, campaign["country_id"], campaign["competition_id"], campaign["season"],
                    campaign["dataset_type"], campaign["provider"], campaign["date_start"],
                    campaign["date_end"], object_uri, checksum, row_count, campaign["completeness_score"],
                    campaign["schema_version"], campaign["team_set_hash"],
                ),
            )
            cur.execute(
                """
                update internal.archive_campaigns
                   set status='SUCCEEDED', manifest_id=%s, object_uri=%s, checksum=%s,
                       row_count=%s, finished_at=now(), updated_at=now(), error_code=null, error_message=null
                 where campaign_id=%s
                """,
                (manifest_id, object_uri, checksum, row_count, campaign["campaign_id"]),
            )
            cur.execute(
                """
                update internal.worker_jobs
                   set status='SUCCEEDED', finished_at=now(), lease_expires_at=null,
                       error_code=null, error_message=null
                 where job_id=%s
                """,
                (campaign["worker_job_id"],),
            )
    return str(manifest_id)


def fail(conn, campaign: dict, exc: Exception):
    message = str(exc)[:2000]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """update internal.archive_campaigns
                      set status='FAILED', error_code='ARCHIVE_WORKER_FAILED', error_message=%s,
                          finished_at=now(), updated_at=now()
                    where campaign_id=%s""",
                (message, campaign["campaign_id"]),
            )
            cur.execute(
                """update internal.worker_jobs
                      set status='FAILED', finished_at=now(), lease_expires_at=null,
                          error_code='ARCHIVE_WORKER_FAILED', error_message=%s
                    where job_id=%s""",
                (message, campaign["worker_job_id"]),
            )


def main() -> int:
    conn = None
    campaign = None
    try:
        conn = connect()
        campaign = claim_campaign(conn)
        if not campaign:
            print(json.dumps({"processed": False, "reason": "test_campaign_not_queued"}))
            return 0
        payload, row_count = build_artifact(campaign)
        object_uri, checksum = upload_and_verify(payload, campaign)
        manifest_id = finalize(conn, campaign, object_uri, checksum, row_count)
        print(json.dumps({
            "processed": True,
            "campaign_id": str(campaign["campaign_id"]),
            "status": "SUCCEEDED",
            "object_uri": object_uri,
            "checksum": checksum,
            "row_count": row_count,
            "manifest_id": manifest_id,
        }, separators=(",", ":")))
        return 0
    except Exception as exc:
        if conn and campaign:
            try:
                fail(conn, campaign, exc)
            except Exception as finalize_exc:
                print(f"archive worker failure persistence failed: {finalize_exc}", file=sys.stderr)
        print(f"archive worker failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
