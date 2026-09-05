from __future__ import annotations

import json
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

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
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def load_catalog() -> list[Artifact]:
    """Load the full eligible archive catalog; active RUNNING seasons are excluded by the DB RPC."""
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    url = f"{base}/rest/v1/rpc/prediction_training_archive_catalog"
    page_size = 1000
    offset = 0
    artifacts: list[Artifact] = []
    while True:
        response = requests.post(
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
        if response.status_code not in (200, 206):
            response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            raise RuntimeError("unexpected prediction_training_archive_catalog response")
        if not rows:
            break
        artifacts.extend(
            Artifact(
                str(r["manifest_id"]),
                int(r["season"]),
                str(r["dataset_type"]),
                str(r["object_uri"]),
                str(r["checksum"]),
                int(r["row_count"]),
                float(r["completeness_score"] or 0),
                str(r["schema_version"]),
            )
            for r in rows
        )
        if len(rows) < page_size:
            break
        offset += page_size
    if not artifacts:
        raise RuntimeError("prediction_training_archive_catalog returned no artifacts")
    return artifacts


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


def export_complete_seasons(seasons: list[int]) -> None:
    value = ",".join(str(s) for s in seasons)
    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as fh:
            fh.write(f"ARCHIVE_COMPLETE_SEASONS={value}\n")


def main() -> int:
    requested = {int(x) for x in os.environ.get("ARCHIVE_SEASONS", "").split(",") if x.strip()}
    min_seasons = int_env("OOS_MIN_SEASONS", 3)
    min_matches = int_env("OOS_MIN_MATCHES", 3000)
    artifacts = [a for a in load_catalog() if not requested or a.season in requested]
    if not artifacts:
        raise RuntimeError("archive catalog returned no artifacts")

    by_season: dict[int, list[Artifact]] = defaultdict(list)
    for artifact in artifacts:
        if len(artifact.checksum) != 64:
            raise RuntimeError(f"invalid catalog checksum for manifest={artifact.manifest_id}")
        if not artifact.object_uri.startswith("s3://"):
            raise RuntimeError(f"invalid S3 URI for manifest={artifact.manifest_id}")
        if artifact.completeness_score < 0 or artifact.completeness_score > 1:
            raise RuntimeError(f"invalid completeness score for manifest={artifact.manifest_id}")
        by_season[artifact.season].append(artifact)

    complete_seasons = [
        season
        for season, items in sorted(by_season.items())
        if items and min(item.completeness_score for item in items) >= 1.0
    ]
    fixture_like_rows = sum(
        item.row_count for item in artifacts if item.dataset_type in {"fixtures", "fixture_results", "matches"}
    )
    export_complete_seasons(complete_seasons)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "public.prediction_training_archive_catalog; active RUNNING seasons excluded by DB policy",
        "catalog_artifacts": len(artifacts),
        "checksum_validation": "CATALOG_LINEAGE_ONLY; FULL_SHA256_IS_PERFORMED_WHILE_TRAINING_READS_EACH_OBJECT",
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
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
