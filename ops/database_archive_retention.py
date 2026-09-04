from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import boto3
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

BUCKET = os.environ.get("S3_BUCKET", "zahrly-community-storage")
PREFIX = os.environ.get("S3_PREFIX", "zahrly/archive/database").strip("/")
KEEP_OOS_RUNS = int(os.environ.get("KEEP_OOS_RUNS", "3"))
KEEP_RATING_MODELS = int(os.environ.get("KEEP_RATING_MODELS", "2"))
CRON_RETENTION_DAYS = int(os.environ.get("CRON_RETENTION_DAYS", "2"))
CRON_RETENTION_HOURS = int(os.environ.get("CRON_RETENTION_HOURS", "1"))


def normalized_db_url(raw: str) -> str:
    raw = raw.strip()
    p = urlsplit(raw)
    if p.scheme not in {"postgres", "postgresql"} or not p.hostname or p.password is None:
        raise RuntimeError("SUPABASE_DB_URL must be a valid PostgreSQL URL with a password")
    host = p.hostname.lower().rstrip(".").lstrip("@")
    project_ref = "qosvqlwkexrhswcuakib"
    pooler_host = "aws-0-eu-central-1.pooler.supabase.com"
    pooler_port = 5432
    user = unquote(p.username or "postgres")
    password = quote(unquote(p.password), safe="")
    if host.endswith(".pooler.supabase.com"):
        selected_host, selected_port = host, p.port or pooler_port
        if "." not in user:
            user = f"postgres.{project_ref}"
    elif host == f"db.{project_ref}.supabase.co":
        selected_host, selected_port = pooler_host, pooler_port
        if user == "postgres":
            user = f"postgres.{project_ref}"
    else:
        raise RuntimeError(f"Unsupported Supabase host: {host}")
    query = p.query or ""
    if "sslmode=" not in query:
        query = f"{query}&sslmode=require" if query else "sslmode=require"
    return urlunsplit(("postgresql", f"{quote(user, safe='')}:{password}@{selected_host}:{selected_port}", p.path or "/postgres", query, ""))


def db():
    return psycopg.connect(normalized_db_url(os.environ["SUPABASE_DB_URL"]), row_factory=dict_row, connect_timeout=20)


def s3():
    return boto3.client(
        "s3",
        region_name=os.environ.get("S3_REGION", "eu-north-1"),
        endpoint_url=os.environ.get("S3_ENDPOINT_URL", "https://s3.eu-north-1.amazonaws.com"),
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    )


def archive_query(client, query: str, key: str) -> tuple[int, str, int]:
    rows = 0
    with tempfile.NamedTemporaryFile(prefix="db-archive-", suffix=".jsonl.gz", delete=False) as tmp:
        path = Path(tmp.name)
        with gzip.GzipFile(fileobj=tmp, mode="wb", compresslevel=6) as gz:
            with db() as conn:
                with conn.cursor() as cur:
                    copy_sql = f"COPY ({query}) TO STDOUT"
                    with cur.copy(copy_sql) as copy:
                        for chunk in copy:
                            data = chunk.tobytes() if isinstance(chunk, memoryview) else bytes(chunk)
                            gz.write(data)
                            rows += data.count(b"\n")
        digest_hash = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest_hash.update(chunk)
        digest = digest_hash.hexdigest()
        size = path.stat().st_size

    client.upload_file(
        str(path),
        BUCKET,
        key,
        ExtraArgs={
            "ContentType": "application/x-ndjson",
            "ContentEncoding": "gzip",
            "Metadata": {"sha256": digest, "row_count": str(rows), "archived_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    head = client.head_object(Bucket=BUCKET, Key=key)
    if int(head["ContentLength"]) != size or head.get("Metadata", {}).get("sha256") != digest:
        path.unlink(missing_ok=True)
        raise RuntimeError(f"S3 verification failed for {key}")
    path.unlink(missing_ok=True)
    return rows, digest, size


def fetch_ids(conn, query: str) -> list[str]:
    return [str(r["id"]) for r in conn.execute(query).fetchall()]


def main() -> None:
    client = s3()
    client.head_bucket(Bucket=BUCKET)
    run_tag = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results = []

    with db() as conn:
        oos_candidates = fetch_ids(
            conn,
            """
            SELECT pr.id
            FROM internal.prediction_training_runs pr
            WHERE pr.status='SUCCEEDED'
              AND pr.finished_at < now() - interval '30 minutes'
              AND EXISTS (SELECT 1 FROM internal.prediction_oos_benchmark o WHERE o.training_run_id=pr.id)
              AND pr.id NOT IN (
                SELECT id FROM internal.prediction_training_runs
                WHERE status='SUCCEEDED' ORDER BY finished_at DESC NULLS LAST LIMIT %d
              )
            ORDER BY pr.finished_at
            """ % KEEP_OOS_RUNS,
        )
        if oos_candidates:
            lit = ",".join("'" + x.replace("'", "''") + "'::uuid" for x in oos_candidates)
            key = f"{PREFIX}/prediction_oos_benchmark/archive_run={run_tag}.jsonl.gz"
            q = f"SELECT row_to_json(x)::text FROM (SELECT * FROM internal.prediction_oos_benchmark WHERE training_run_id IN ({lit}) ORDER BY training_run_id, fold_no, played_at, fixture_id) x"
            rows, digest, size = archive_query(client, q, key)
            with conn.transaction():
                cur = conn.execute(f"DELETE FROM internal.prediction_oos_benchmark WHERE training_run_id IN ({lit})", prepare=False)
                deleted = cur.rowcount
            if deleted != rows:
                raise RuntimeError(f"OOS delete mismatch: archived={rows}, deleted={deleted}")
            results.append({"table": "internal.prediction_oos_benchmark", "rows": rows, "s3_key": key, "sha256": digest, "bytes": size})

        rating_candidates = fetch_ids(
            conn,
            """
            SELECT mv.id
            FROM public.model_versions mv
            JOIN internal.prediction_rating_checkpoints rpc ON rpc.model_version_id=mv.id
            JOIN internal.prediction_training_runs pr ON pr.model_version_id=mv.id
            WHERE pr.status='SUCCEEDED'
              AND pr.finished_at < now() - interval '30 minutes'
              AND mv.id NOT IN (
                SELECT mv2.id
                FROM public.model_versions mv2
                JOIN internal.prediction_rating_checkpoints rpc2 ON rpc2.model_version_id=mv2.id
                JOIN internal.prediction_training_runs pr2 ON pr2.model_version_id=mv2.id
                WHERE pr2.status='SUCCEEDED'
                GROUP BY mv2.id, mv2.created_at
                ORDER BY mv2.created_at DESC LIMIT %d
              )
            GROUP BY mv.id, mv.created_at
            ORDER BY mv.created_at
            """ % KEEP_RATING_MODELS,
        )
        if rating_candidates:
            lit = ",".join("'" + x.replace("'", "''") + "'::uuid" for x in rating_candidates)
            key = f"{PREFIX}/prediction_rating_checkpoints/archive_run={run_tag}.jsonl.gz"
            q = f"SELECT row_to_json(x)::text FROM (SELECT * FROM internal.prediction_rating_checkpoints WHERE model_version_id IN ({lit}) ORDER BY model_version_id, checkpoint_scope, as_of_time, team_id) x"
            rows, digest, size = archive_query(client, q, key)
            with conn.transaction():
                cur = conn.execute(f"DELETE FROM internal.prediction_rating_checkpoints WHERE model_version_id IN ({lit})", prepare=False)
                deleted = cur.rowcount
            if deleted != rows:
                raise RuntimeError(f"rating delete mismatch: archived={rows}, deleted={deleted}")
            results.append({"table": "internal.prediction_rating_checkpoints", "rows": rows, "s3_key": key, "sha256": digest, "bytes": size})

        cron_count = conn.execute("SELECT count(*) AS n FROM cron.job_run_details WHERE start_time < now() - make_interval(hours => %s)", (CRON_RETENTION_HOURS,)).fetchone()["n"]
        if cron_count:
            key = f"{PREFIX}/cron/job_run_details/archive_run={run_tag}.jsonl.gz"
            q = "SELECT row_to_json(x)::text FROM (SELECT * FROM cron.job_run_details WHERE start_time < now() - make_interval(hours => %s) ORDER BY start_time, runid) x" % CRON_RETENTION_HOURS
            rows, digest, size = archive_query(client, q, key)
            with conn.transaction():
                cur = conn.execute("DELETE FROM cron.job_run_details WHERE start_time < now() - make_interval(hours => %s)", (CRON_RETENTION_HOURS,), prepare=False)
                deleted = cur.rowcount
            if deleted != rows:
                raise RuntimeError(f"cron delete mismatch: archived={rows}, deleted={deleted}")
            results.append({"table": "cron.job_run_details", "rows": rows, "s3_key": key, "sha256": digest, "bytes": size})

    with db() as conn:
        conn.autocommit = True
        for table in ("internal.prediction_oos_benchmark", "internal.prediction_rating_checkpoints", "cron.job_run_details"):
            conn.execute(sql.SQL("VACUUM (ANALYZE) {}").format(sql.Identifier(*table.split("."))))

    manifest = {"run_tag": run_tag, "bucket": BUCKET, "prefix": PREFIX, "retention": {"keep_oos_runs": KEEP_OOS_RUNS, "keep_rating_models": KEEP_RATING_MODELS, "cron_hours": CRON_RETENTION_HOURS, "legacy_cron_days": CRON_RETENTION_DAYS}, "results": results}
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
