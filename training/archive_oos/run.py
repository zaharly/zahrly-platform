from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


def load_readiness() -> list[dict]:
    """Fetch one compact, indexed readiness summary per archived season."""
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    url = f"{base}/rest/v1/rpc/prediction_training_archive_readiness"
    response = requests.post(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={},
        timeout=30,
    )
    if response.status_code != 200:
        response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list):
        raise RuntimeError("unexpected prediction_training_archive_readiness response")
    if not rows:
        raise RuntimeError("prediction_training_archive_readiness returned no seasons")
    return rows


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
    rows = [r for r in load_readiness() if not requested or int(r["season"]) in requested]
    if not rows:
        raise RuntimeError("archive readiness returned no requested seasons")

    complete_seasons = []
    fixture_like_rows = 0
    total_artifacts = 0
    for row in rows:
        season = int(row["season"])
        artifacts = int(row["artifact_count"])
        fixture_rows = int(row["fixture_rows"] or 0)
        completeness = float(row["min_completeness"] or 0)
        if artifacts <= 0:
            raise RuntimeError(f"archive readiness found no artifacts for season={season}")
        total_artifacts += artifacts
        fixture_like_rows += fixture_rows
        if completeness >= 1.0:
            complete_seasons.append(season)

    complete_seasons = sorted(set(complete_seasons))
    export_complete_seasons(complete_seasons)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "public.prediction_training_archive_readiness; active RUNNING seasons excluded by DB policy",
        "catalog_artifacts": total_artifacts,
        "season_summaries": rows,
        "checksum_validation": "CATALOG_CHECKSUM_LINEAGE; FULL_SHA256_IS_VERIFIED_WHILE_TRAINING_READS_EACH_OBJECT",
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
