from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import requests
from botocore.config import Config


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def load_catalog() -> list[dict]:
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    url = f"{base}/rest/v1/rpc/prediction_training_archive_catalog"
    out: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        r = requests.post(
            url,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
            },
            json={},
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        if not isinstance(rows, list) or not rows:
            break
        out.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    if not out:
        raise RuntimeError("archive catalog returned no artifacts")
    return out


def parse(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"invalid S3 URI: {uri}")
    bucket, _, key = uri[5:].partition("/")
    if not bucket or not key:
        raise ValueError(f"invalid S3 URI: {uri}")
    return bucket, key


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return default if not raw else int(raw)


def main() -> int:
    artifacts = load_catalog()
    workers = max(4, min(32, int_env("S3_METADATA_WORKERS", 24)))
    client = boto3.client(
        "s3",
        region_name=env("AWS_REGION"),
        config=Config(
            max_pool_connections=workers,
            retries={"max_attempts": 5, "mode": "adaptive"},
        ),
    )

    def one(row: dict) -> str:
        bucket, key = parse(str(row["object_uri"]))
        expected = str(row["checksum"]).lower()
        head = client.head_object(Bucket=bucket, Key=key)
        metadata = {str(k).lower(): str(v) for k, v in (head.get("Metadata") or {}).items()}
        if metadata.get("sha256") == expected:
            return "already_tagged"
        if not expected or len(expected) != 64:
            raise RuntimeError(f"invalid catalog checksum for manifest {row['manifest_id']}")
        # Server-side copy preserves the object bytes and replaces only metadata.
        client.copy_object(
            Bucket=bucket,
            Key=key,
            CopySource={"Bucket": bucket, "Key": key},
            MetadataDirective="REPLACE",
            Metadata={
                **metadata,
                "sha256": expected,
                "archive-attestation": "catalog-checksum-from-verified-archive-write",
            },
            ContentType=head.get("ContentType", "application/octet-stream"),
        )
        check = client.head_object(Bucket=bucket, Key=key)
        after = {str(k).lower(): str(v) for k, v in (check.get("Metadata") or {}).items()}
        if after.get("sha256") != expected:
            raise RuntimeError(f"metadata attestation failed for manifest {row['manifest_id']}")
        return "tagged"

    counts = {"already_tagged": 0, "tagged": 0}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="s3-metadata") as pool:
        futures = {pool.submit(one, row): row for row in artifacts}
        for future in as_completed(futures):
            row = futures[future]
            try:
                counts[future.result()] += 1
            except Exception as exc:
                errors.append(f"{row['manifest_id']}: {exc}")
    if errors:
        raise RuntimeError("archive checksum metadata backfill failed: " + " | ".join(errors[:10]))
    print({"artifacts": len(artifacts), **counts}, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
