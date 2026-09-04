from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path

import boto3
import psycopg
from psycopg.rows import dict_row

ARTIFACTS = (
    ("OOS_BENCHMARK", "prediction_oos_benchmark", "zahrly/prediction/oos"),
    ("RATING_CHECKPOINTS", "prediction_rating_checkpoints", "zahrly/prediction/rating-checkpoints"),
)


def db_connect():
    return psycopg.connect(os.environ["SUPABASE_DB_URL"], row_factory=dict_row, connect_timeout=20, sslmode="require")


def s3_client():
    return boto3.client(
        "s3",
        region_name=os.environ.get("S3_REGION", "eu-central-1"),
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    )


def export_rows(conn, table: str, where_sql: str, params: tuple, path: Path) -> int:
    count = 0
    with gzip.open(path, "wb", compresslevel=6) as out:
        with conn.cursor() as cur:
            cur.execute(f"select * from internal.{table} where {where_sql} order by id", params)
            while True:
                rows = cur.fetchmany(1000)
                if not rows:
                    break
                for row in rows:
                    payload = json.dumps(dict(row), ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
                    out.write(payload + b"\n")
                    count += 1
    return count


def artifact_upload(s3, bucket: str, key: str, path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while chunk := fh.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    sha = digest.hexdigest()
    s3.upload_file(
        str(path),
        bucket,
        key,
        ExtraArgs={
            "ContentType": "application/x-ndjson",
            "ContentEncoding": "gzip",
            "Metadata": {"sha256": sha},
        },
    )
    s3.head_object(Bucket=bucket, Key=key)
    return sha, size


def register(conn, artifact_type: str, training_run_id: str, model_version_id: str, uri: str, sha: str, size: int, rows: int):
    conn.execute(
        """
        insert into internal.prediction_artifacts
          (artifact_type, training_run_id, model_version_id, object_uri, sha256,
           byte_size, row_count, content_type, compression, metadata)
        values (%s,%s,%s,%s,%s,%s,%s,'application/x-ndjson','gzip',%s)
        on conflict (artifact_type, training_run_id, model_version_id, sha256)
        do update set object_uri=excluded.object_uri, byte_size=excluded.byte_size,
                      row_count=excluded.row_count, metadata=excluded.metadata
        """,
        (artifact_type, training_run_id, model_version_id, uri, sha, size, rows,
         json.dumps({"storage": "s3", "verified": True, "format": "ndjson-gzip"})),
    )


def main() -> None:
    bucket = os.environ["S3_BUCKET"]
    s3 = s3_client()
    requested_run = os.environ.get("PREDICTION_TRAINING_RUN_ID", "").strip()
    with db_connect() as conn:
        sql = """
            select tr.id::text as training_run_id,
                   tr.model_version_id::text as model_version_id,
                   mv.version
            from internal.prediction_training_runs tr
            join public.model_versions mv on mv.id = tr.model_version_id
            where tr.status='SUCCEEDED' and tr.id=%s
        """ if requested_run else """
            select tr.id::text as training_run_id,
                   tr.model_version_id::text as model_version_id,
                   mv.version
            from internal.prediction_training_runs tr
            join public.model_versions mv on mv.id = tr.model_version_id
            where tr.status='SUCCEEDED'
            order by tr.started_at desc
            limit 1
        """
        run = conn.execute(sql, (requested_run,) if requested_run else ()).fetchone()
        if not run:
            raise SystemExit("no succeeded prediction training run")

        results = []
        with tempfile.TemporaryDirectory(prefix="zahrly-prediction-archive-") as tmp:
            for artifact_type, table, prefix in ARTIFACTS:
                where_sql = "training_run_id=%s" if artifact_type == "OOS_BENCHMARK" else "model_version_id=%s"
                params = (run["training_run_id"],) if artifact_type == "OOS_BENCHMARK" else (run["model_version_id"],)
                path = Path(tmp) / f"{artifact_type.lower()}.jsonl.gz"
                row_count = export_rows(conn, table, where_sql, params, path)
                if row_count == 0:
                    results.append({"artifact_type": artifact_type, "row_count": 0, "status": "EMPTY"})
                    continue

                key = f"{prefix}/{run['version']}/{run['training_run_id']}.jsonl.gz"
                sha, size = artifact_upload(s3, bucket, key, path)
                uri = f"s3://{bucket}/{key}"
                register(conn, artifact_type, run["training_run_id"], run["model_version_id"], uri, sha, size, row_count)
                conn.commit()

                if artifact_type == "OOS_BENCHMARK":
                    deleted = conn.execute("delete from internal.prediction_oos_benchmark where training_run_id=%s", (run["training_run_id"],)).rowcount
                else:
                    deleted = conn.execute("delete from internal.prediction_rating_checkpoints where model_version_id=%s", (run["model_version_id"],)).rowcount
                conn.commit()

                results.append({"artifact_type": artifact_type, "row_count": row_count, "deleted_rows": deleted,
                                "uri": uri, "sha256": sha, "byte_size": size, "status": "ARCHIVED"})

        conn.execute(
            "update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",
            (json.dumps({"artifact_archive": {"storage": "S3", "verified": True, "artifacts": results}}), run["training_run_id"]),
        )
        conn.commit()
        print(json.dumps({"status": "SUCCEEDED", "training_run_id": run["training_run_id"],
                          "model_version_id": run["model_version_id"], "artifacts": results}, sort_keys=True))


if __name__ == "__main__":
    main()
