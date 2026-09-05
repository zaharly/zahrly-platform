#!/usr/bin/env python3
"""Historical archive worker with S3 object verification and persisted SHA-256 attestation."""
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
from botocore.config import Config
from psycopg.rows import dict_row


STAGE = "INIT"


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value or default


def set_stage(name: str) -> None:
    global STAGE
    STAGE = name
    print(f"ARCHIVE_STAGE={name}", flush=True)


def connect():
    set_stage("DB_CONNECT")
    url = env("SUPABASE_DB_URL")
    return psycopg.connect(url, row_factory=dict_row, connect_timeout=15)


def claim_campaign(conn):
    set_stage("CAMPAIGN_CLAIM")
    campaign_id = env("ARCHIVE_CAMPAIGN_ID")
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("""
                select c.*
                from internal.archive_campaigns c
                join internal.worker_jobs w on w.job_id = c.worker_job_id
                where c.campaign_id = %s and c.status = 'QUEUED' and w.status = 'QUEUED'
                for update of c, w
            """, (campaign_id,))
            campaign = cur.fetchone()
            if not campaign:
                return None
            worker_id = f"archive-worker:{socket.gethostname()}"
            cur.execute("""
                update internal.worker_jobs
                   set status='RUNNING', worker_id=%s, attempts=attempts+1,
                       started_at=coalesce(started_at, now()),
                       lease_expires_at=now() + interval '15 minutes'
                 where job_id=%s and status='QUEUED'
            """, (worker_id, campaign["worker_job_id"]))
            cur.execute("""
                update internal.archive_campaigns
                   set status='RUNNING', started_at=coalesce(started_at, now()), updated_at=now()
                 where campaign_id=%s
            """, (campaign["campaign_id"],))
            return campaign


def build_artifact(campaign: dict) -> tuple[bytes, int]:
    set_stage("BUILD_ARTIFACT")
    if campaign["provider"] != "e2e-provider":
        raise RuntimeError(f"unsupported archive provider for E2E materializer: {campaign['provider']}")
    rows = [
        {"event": "archive_e2e_fixture", "season": campaign["season"],
         "dataset_type": campaign["dataset_type"], "sequence": i,
         "value": f"zahrly-e2e-{campaign['season']}-{i}"}
        for i in range(1, 4)
    ]
    document = {
        "schema_version": campaign["schema_version"],
        "campaign_id": str(campaign["campaign_id"]),
        "country_id": str(campaign["country_id"]),
        "competition_id": str(campaign["competition_id"]),
        "season": campaign["season"], "dataset_type": campaign["dataset_type"],
        "provider": campaign["provider"], "date_start": campaign["date_start"].isoformat(),
        "date_end": campaign["date_end"].isoformat(), "team_set_hash": campaign["team_set_hash"],
        "generated_at": datetime.now(timezone.utc).isoformat(), "rows": rows,
    }
    payload = (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return payload, len(rows)


def upload_and_verify(payload: bytes, campaign: dict) -> tuple[str, str]:
    set_stage("S3_CLIENT")
    bucket = env("S3_BUCKET")
    region = env("S3_REGION")
    endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip() or None
    client_kwargs = {
        "service_name": "s3",
        "region_name": region,
        "aws_access_key_id": env("S3_ACCESS_KEY_ID"),
        "aws_secret_access_key": env("S3_SECRET_ACCESS_KEY"),
        "config": Config(retries={"max_attempts": 5, "mode": "standard"}),
    }
    if endpoint:
        client_kwargs["endpoint_url"] = endpoint
    client = boto3.client(**client_kwargs)
    prefix = env("S3_PREFIX", required=False, default="zahrly/archive").strip("/")
    key = f"{prefix}/{campaign['dataset_type']}/season={campaign['season']}/campaign={campaign['campaign_id']}.json"
    digest = hashlib.sha256(payload).hexdigest()

    set_stage("S3_PUT")
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=payload,
        ContentType="application/json",
        Metadata={"sha256": digest, "archive-attestation": "archive-worker-sha256"},
    )

    set_stage("S3_HEAD")
    head = client.head_object(Bucket=bucket, Key=key)
    if int(head.get("ContentLength", -1)) != len(payload):
        raise RuntimeError("S3 object length verification failed")
    metadata = {str(k).lower(): str(v) for k, v in (head.get("Metadata") or {}).items()}
    if metadata.get("sha256") != digest or metadata.get("archive-attestation") != "archive-worker-sha256":
        raise RuntimeError("S3 checksum metadata attestation failed")

    set_stage("S3_GET")
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    remote_digest = hashlib.sha256()
    try:
        while True:
            chunk = body.read(1024 * 1024)
            if not chunk:
                break
            remote_digest.update(chunk)
    finally:
        body.close()
    if remote_digest.hexdigest() != digest:
        raise RuntimeError("S3 object checksum verification failed")
    return f"s3://{bucket}/{key}", digest


def finalize(conn, campaign: dict, object_uri: str, checksum: str, row_count: int):
    set_stage("FINALIZE_DB")
    manifest_id = uuid.uuid4()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("""
                insert into internal.archive_catalog
                  (manifest_id,country_id,competition_id,season,dataset_type,provider,
                   date_start,date_end,object_uri,checksum,row_count,completeness_score,
                   schema_version,team_set_hash)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (manifest_id,campaign["country_id"],campaign["competition_id"],campaign["season"],
                  campaign["dataset_type"],campaign["provider"],campaign["date_start"],campaign["date_end"],
                  object_uri,checksum,row_count,campaign["completeness_score"],campaign["schema_version"],campaign["team_set_hash"]))
            cur.execute("""
                update internal.archive_campaigns
                   set status='SUCCEEDED', manifest_id=%s, object_uri=%s, checksum=%s,
                       row_count=%s, finished_at=now(), updated_at=now(), error_code=null, error_message=null
                 where campaign_id=%s
            """, (manifest_id,object_uri,checksum,row_count,campaign["campaign_id"]))
            cur.execute("""
                update internal.worker_jobs
                   set status='SUCCEEDED', finished_at=now(), lease_expires_at=null,
                       error_code=null, error_message=null
                 where job_id=%s
            """, (campaign["worker_job_id"],))
    return str(manifest_id)


def fail(conn, campaign: dict, exc: Exception):
    message = str(exc)[:2000]
    if conn and campaign:
        try:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("""update internal.archive_campaigns set status='FAILED', error_code='ARCHIVE_WORKER_FAILED', error_message=%s, finished_at=now(), updated_at=now() where campaign_id=%s""", (message,campaign["campaign_id"]))
                    cur.execute("""update internal.worker_jobs set status='FAILED', finished_at=now(), lease_expires_at=null, error_code='ARCHIVE_WORKER_FAILED', error_message=%s where job_id=%s""", (message,campaign["worker_job_id"]))
        except Exception as persist_exc:
            print(f"ARCHIVE_FAILURE_PERSISTENCE_ERROR={persist_exc}", file=sys.stderr, flush=True)


def main() -> int:
    conn = None
    campaign = None
    try:
        conn = connect()
        campaign = claim_campaign(conn)
        if not campaign:
            print(json.dumps({"processed": False, "reason": "campaign_not_queued"}), flush=True)
            return 0
        payload, row_count = build_artifact(campaign)
        object_uri, checksum = upload_and_verify(payload, campaign)
        manifest_id = finalize(conn, campaign, object_uri, checksum, row_count)
        set_stage("SUCCEEDED")
        print(json.dumps({"processed": True, "campaign_id": str(campaign["campaign_id"]), "status": "SUCCEEDED", "object_uri": object_uri, "checksum": checksum, "row_count": row_count, "manifest_id": manifest_id}, separators=(",", ":")), flush=True)
        return 0
    except Exception as exc:
        fail(conn, campaign, exc)
        print(f"archive worker failed at stage {STAGE}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        if conn:
            conn.close()


if __name__=='__main__':
    raise SystemExit(main())
