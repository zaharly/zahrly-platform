from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
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


def supabase_sql(sql: str) -> list[dict[str, Any]]:
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    # The endpoint below is used only for read-only archive metadata queries.
    response = requests.post(
        f"{base}/rest/v1/rpc/prediction_training_archive_manifest",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"p_sql": sql},
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("unexpected Supabase RPC response")
    return payload


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"invalid S3 URI: {uri}")
    raw = uri[5:]
    bucket, _, key = raw.partition("/")
    if not bucket or not key:
        raise ValueError(f"invalid S3 URI: {uri}")
    return bucket, key


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_artifact(s3, artifact: Artifact) -> dict[str, Any]:
    bucket, key = parse_s3_uri(artifact.object_uri)
    obj = s3.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()
    actual = sha256_bytes(data)
    if actual != artifact.checksum:
        raise RuntimeError(
            f"checksum mismatch manifest={artifact.manifest_id} expected={artifact.checksum} actual={actual}"
        )
    payload = json.loads(data.decode("utf-8"))
    return {"artifact": artifact, "payload": payload, "sha256": actual}


def main() -> int:
    seasons_filter = {
        int(x.strip()) for x in os.environ.get("ARCHIVE_SEASONS", "").split(",") if x.strip()
    }
    min_seasons = int(os.environ.get("OOS_MIN_SEASONS", "3"))
    min_matches = int(os.environ.get("OOS_MIN_MATCHES", "3000"))

    # A dedicated read-only RPC must exist in the database. It exposes archive_catalog
    # rows without touching production campaign/worker tables.
    rows = supabase_sql(
        "select manifest_id, season, dataset_type, object_uri, checksum, row_count, completeness_score, schema_version "
        "from internal.archive_catalog where provider='api-football' order by season, dataset_type"
    )
    artifacts: list[Artifact] = []
    for row in rows:
        season = int(row["season"])
        if seasons_filter and season not in seasons_filter:
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

    session = boto3.Session(region_name=os.environ.get("AWS_REGION"))
    s3 = session.client("s3")

    validated = []
    for artifact in artifacts:
        validated.append(load_artifact(s3, artifact))

    complete_seasons = []
    for season, items in sorted(by_season.items()):
        if items and min(a.completeness_score for a in items) >= 1.0:
            complete_seasons.append(season)

    fixture_like_rows = sum(
        a.row_count
        for a in artifacts
        if a.dataset_type in {"fixtures", "fixture_results", "matches"}
    )
    report = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "source": "internal.archive_catalog -> AWS S3",
        "validated_artifacts": len(validated),
        "complete_seasons": complete_seasons,
        "complete_season_count": len(complete_seasons),
        "fixture_like_rows": fixture_like_rows,
        "oos_min_seasons": min_seasons,
        "oos_min_matches": min_matches,
        "oos_ready": len(complete_seasons) >= min_seasons and fixture_like_rows >= min_matches,
        "write_scope": "NO_PRODUCTION_WRITES",
    }

    out = Path(os.environ.get("TRAINING_REPORT", "training_archive_oos_report.json"))
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
