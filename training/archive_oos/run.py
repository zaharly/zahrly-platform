from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import boto3
import requests


@dataclass(frozen=True)
class Artifact:
    manifest_id: str
    season: int
    dataset_type: str
    object_uri: str
    checksum: str
    row_count: int
    completeness_score: float
    schema_version: str


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def load_catalog() -> list[dict[str, Any]]:
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    response = requests.get(
        f"{base}/rest/v1/archive_catalog",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params={
            "select": "manifest_id,season,dataset_type,object_uri,checksum,row_count,completeness_score,schema_version",
            "provider": "eq.api-football",
            "order": "season.asc,dataset_type.asc",
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("unexpected archive_catalog response")
    return payload


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"invalid S3 URI: {uri}")
    bucket, _, key = uri[5:].partition("/")
    if not bucket or not key:
        raise ValueError(f"invalid S3 URI: {uri}")
    return bucket, key


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_artifact(s3, artifact: Artifact) -> int:
    bucket, key = parse_s3_uri(artifact.object_uri)
    obj = s3.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()
    actual = sha256_bytes(data)
    if actual != artifact.checksum:
        raise RuntimeError(
            f"checksum mismatch manifest={artifact.manifest_id} expected={artifact.checksum} actual={actual}"
        )
    return len(data)


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


def main() -> int:
    requested = {int(x) for x in os.environ.get("ARCHIVE_SEASONS", "").split(",") if x.strip()}
    min_seasons = int_env("OOS_MIN_SEASONS", 3)
    min_matches = int_env("OOS_MIN_MATCHES", 3000)

    artifacts = []
    for row in load_catalog():
        season = int(row["season"])
        if requested and season not in requested:
            continue
        artifacts.append(
            Artifact(
                manifest_id=str(row["manifest_id"]),
                season=season,
                dataset_type=str(row["dataset_type"]),
                object_uri=str(row["object_uri"]),
                checksum=str(row["checksum"]),
                row_count=int(row["row_count"]),
                completeness_score=float(row["completeness_score"] or 0),
                schema_version=str(row["schema_version"]),
            )
        )
    if not artifacts:
        raise RuntimeError("archive catalog returned no artifacts")

    by_season: dict[int, list[Artifact]] = defaultdict(list)
    for artifact in artifacts:
        by_season[artifact.season].append(artifact)

    s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION"))
    total_bytes = 0
    validated = 0
    for artifact in artifacts:
        total_bytes += load_artifact(s3, artifact)
        validated += 1

    complete_seasons = [
        season for season, items in sorted(by_season.items())
        if items and min(item.completeness_score for item in items) >= 1.0
    ]
    fixture_like_rows = sum(
        item.row_count for item in artifacts if item.dataset_type in {"fixtures", "fixture_results", "matches"}
    )
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "internal.archive_catalog -> AWS S3",
        "validated_artifacts": validated,
        "validated_bytes": total_bytes,
        "complete_seasons": complete_seasons,
        "complete_season_count": len(complete_seasons),
        "fixture_like_rows": fixture_like_rows,
        "oos_min_seasons": min_seasons,
        "oos_min_matches": min_matches,
        "oos_ready": len(complete_seasons) >= min_seasons and fixture_like_rows >= min_matches,
        "write_scope": "NO_PRODUCTION_WRITES",
    }
    Path(os.environ.get("TRAINING_REPORT", "training_archive_oos_report.json")).write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
