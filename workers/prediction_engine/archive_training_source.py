from __future__ import annotations

"""Read settled fixture results from the existing S3 historical archive."""

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlparse

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from .walk_forward import Match


@dataclass(frozen=True)
class ArchiveManifest:
    manifest_id: str
    object_uri: str
    checksum: str
    row_count: int
    date_start: datetime | None
    date_end: datetime | None


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    if default is not None:
        return default
    raise RuntimeError(f"missing required environment variable: {name}")


def db_connect():
    return psycopg.connect(_env("SUPABASE_DB_URL"), row_factory=dict_row, connect_timeout=15)


def fetch_fixture_manifests(conn, min_completeness: float = 1.0) -> list[ArchiveManifest]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select manifest_id::text as manifest_id,
                   object_uri,
                   checksum,
                   row_count,
                   date_start,
                   date_end
              from internal.archive_catalog
             where dataset_type = 'fixtures'
               and provider = 'api-football'
               and completeness_score >= %s
               and object_uri like 's3://%%'
             order by coalesce(date_start, created_at), manifest_id
            """,
            (min_completeness,),
        )
        return [ArchiveManifest(**row) for row in cur.fetchall()]


def _s3_client():
    endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip() or None
    kwargs: dict[str, Any] = {
        "service_name": "s3",
        "region_name": _env("S3_REGION"),
        "aws_access_key_id": _env("S3_ACCESS_KEY_ID"),
        "aws_secret_access_key": _env("S3_SECRET_ACCESS_KEY"),
        "config": Config(retries={"max_attempts": 5, "mode": "standard"}),
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client(**kwargs)


def _parse_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise ValueError(f"invalid S3 object URI: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def load_manifest_json(client, manifest: ArchiveManifest) -> Any:
    bucket, key = _parse_uri(manifest.object_uri)
    body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body)


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _extract_rows(document: Any) -> Iterable[dict[str, Any]]:
    if isinstance(document, dict):
        if isinstance(document.get("response"), list):
            yield from (x for x in document["response"] if isinstance(x, dict))
            return
        if isinstance(document.get("rows"), list):
            yield from (x for x in document["rows"] if isinstance(x, dict))
            return
        yield document
        return
    if isinstance(document, list):
        yield from (x for x in document if isinstance(x, dict))


def _to_match(row: dict[str, Any]) -> Match | None:
    fixture = row.get("fixture") if isinstance(row.get("fixture"), dict) else row
    teams = row.get("teams") if isinstance(row.get("teams"), dict) else {}
    goals = row.get("goals") if isinstance(row.get("goals"), dict) else {}

    match_id = row.get("provider_fixture_id") or fixture.get("id") or row.get("match_id")
    played_at = row.get("played_at") or row.get("kickoff_at") or fixture.get("date")
    home_team_id = row.get("home_team_id") or (teams.get("home") or {}).get("id")
    away_team_id = row.get("away_team_id") or (teams.get("away") or {}).get("id")
    home_goals = row.get("home_goals", goals.get("home"))
    away_goals = row.get("away_goals", goals.get("away"))

    if match_id is None or played_at is None or home_team_id is None or away_team_id is None:
        return None
    if home_goals is None or away_goals is None:
        return None
    if not isinstance(home_goals, int) or not isinstance(away_goals, int):
        return None
    if home_goals < 0 or away_goals < 0:
        return None

    return Match(
        str(match_id),
        _as_datetime(played_at),
        str(home_team_id),
        str(away_team_id),
        home_goals,
        away_goals,
    )


def load_settled_matches(conn, as_of: datetime | None = None) -> list[Match]:
    """Load completed matches strictly from archived fixture manifests."""
    manifests = fetch_fixture_manifests(conn)
    if not manifests:
        raise RuntimeError("prediction_training_source_unavailable: no fixture manifests")

    client = _s3_client()
    cutoff = _as_datetime(as_of or datetime.now(timezone.utc))
    by_id: dict[str, Match] = {}
    for manifest in manifests:
        document = load_manifest_json(client, manifest)
        for row in _extract_rows(document):
            match = _to_match(row)
            if match is None or match.played_at >= cutoff:
                continue
            by_id[match.match_id] = match

    matches = sorted(by_id.values(), key=lambda m: (m.played_at, m.match_id))
    if not matches:
        raise RuntimeError("prediction_training_source_unavailable: no settled fixture results")
    return matches
