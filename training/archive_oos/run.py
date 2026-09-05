from __future__ import annotations

import json
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import boto3
import requests
from botocore.config import Config


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
    """Load the complete eligible archive catalog; active RUNNING seasons are excluded by the DB RPC."""
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
                str(r["manifest_id"]), int(r["season"]), str(r["dataset_type"]),
                str(r["object_uri"]), str(r["checksum"]), int(r["row_count"]),
                float(r["completeness_score"] or 0), str(r["schema_version"]),
            )
            for r in rows
        )
        if len(rows) < page_size:
            break
        offset += page_size
    if not artifacts:
        raise RuntimeError("prediction_training_archive_catalog returned no artifacts")
    return artifacts


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError(f"invalid S3 URI: {uri}")
    bucket, _, key = uri[5:].partition("/")
    if not bucket or not key:
        raise ValueError(f"invalid S3 URI: {uri}")
    return bucket, key


def validate_one(s3, artifact: Artifact) -> tuple[int, str]:
    """Verify object existence/size and use persisted archive-write SHA attestation when present.

    Legacy objects are trusted against the immutable catalog checksum lineage because the archive
    worker computed and verified that checksum before inserting the catalog row. Full byte hashing
    belongs to the separate deep-integrity audit and is intentionally not on every training run.
    """
    bucket, key = parse_s3_uri(artifact.object_uri)
    expected = artifact.checksum.lower()
    if len(expected) != 64:
        raise RuntimeError(f"invalid catalog checksum for manifest={artifact.manifest_id}")
    head = s3.head_object(Bucket=bucket, Key=key)
    size = int(head.get("ContentLength", -1))
    if size < 0:
        raise RuntimeError(f"missing ContentLength manifest={artifact.manifest_id}")
    metadata = {str(k).lower(): str(v).lower() for k, v in (head.get("Metadata") or {}).items()}
    sha = metadata.get("sha256", "")
    attestation = metadata.get("archive-attestation", "")
    if sha:
        if sha != expected:
            raise RuntimeError(f"S3 SHA metadata mismatch manifest={artifact.manifest_id} expected={expected} actual={sha}")
        if attestation not in {"archive-worker-sha256", "catalog-checksum-from-verified-archive-write"}:
            raise RuntimeError(f"unsupported S3 checksum attestation manifest={artifact.manifest_id}")
        return size, "S3_METADATA_SHA256_ATTESTED"
    return size, "CATALOG_CHECKSUM_VERIFIED_AT_ARCHIVE_WRITE"


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if not raw.strip():
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
    max_workers = max(4, min(32, int_env("S3_VALIDATE_WORKERS", 24)))
    artifacts = [a for a in load_catalog() if not requested or a.season in requested]
    if not artifacts:
        raise RuntimeError("archive catalog returned no artifacts")
    by_season: dict[int, list[Artifact]] = defaultdict(list)
    for artifact in artifacts:
        by_season[artifact.season].append(artifact)

    s3 = boto3.client(
        "s3",
        region_name=env("AWS_REGION"),
        config=Config(
            max_pool_connections=max_workers,
            retries={"max_attempts": 5, "mode": "adaptive"},
        ),
    )

    total_bytes = validated = metadata_attested = catalog_trusted = 0
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="s3-head") as pool:
        futures = {pool.submit(validate_one, s3, artifact): artifact for artifact in artifacts}
        for future in as_completed(futures):
            artifact = futures[future]
            try:
                size, mode = future.result()
                total_bytes += size
                validated += 1
                if mode == "S3_METADATA_SHA256_ATTESTED":
                    metadata_attested += 1
                else:
                    catalog_trusted += 1
            except Exception as exc:
                errors.append(f"{artifact.manifest_id}: {exc}")
    if errors:
        raise RuntimeError("S3 archive preflight failed: " + " | ".join(errors[:10]))

    complete_seasons = [
        season for season, items in sorted(by_season.items())
        if items and min(item.completeness_score for item in items) >= 1.0
    ]
    fixture_like_rows = sum(
        item.row_count for item in artifacts if item.dataset_type in {"fixtures", "fixture_results", "matches"}
    )
    export_complete_seasons(complete_seasons)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "public.prediction_training_archive_catalog -> AWS S3; RUNNING campaign seasons excluded by DB policy",
        "validated_artifacts": validated,
        "validated_bytes_metadata_only": total_bytes,
        "s3_validation_workers": max_workers,
        "checksum_mode": "METADATA_ATTESTATION_OR_CATALOG_WRITE_VERIFICATION",
        "metadata_attested_artifacts": metadata_attested,
        "catalog_checksum_lineage_artifacts": catalog_trusted,
        "deep_full_sha256": "SEPARATE_AUDIT_ONLY",
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
