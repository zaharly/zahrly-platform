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
               and object_uri like %s
             order by coalesce(date_start, created_at), manifest_id
            """,
            (min_completeness, "s3://%"),
        )
        return [ArchiveManifest(**row) for row in cur.fetchall()]


def fetch_team_identity_map(conn) -> dict[str, str]:
    """Map API-Football external team IDs to canonical Zahrly team UUIDs."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select external_team_id, team_id::text as team_id
              from public.team_aliases
             where provider = 'api-football'
               and external_team_id is not null
               and team_id is not null
            """
        )
        return {str(row["external_team_id"]): str(row["team_id"]) for row in cur.fetchall()}


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
    """Yield API-Football fixture records through common archive/provider wrappers."""
    seen: set[int] = set()

    def walk(value: Any) -> Iterable[dict[str, Any]]:
        if isinstance(value, list):
            for item in value:
                yield from walk(item)
            return
        if not isinstance(value, dict):
            return

        marker = id(value)
        if marker in seen:
            return
        seen.add(marker)

        fixture = value.get("fixture")
        teams = value.get("teams")
        if isinstance(fixture, dict) and isinstance(teams, dict):
            yield value
            return

        if "provider_fixture_id" in value or "match_id" in value:
            yield value
            return

        for key in ("response", "rows", "results", "data", "payload", "body"):
            child = value.get(key)
            if child is not None:
                yield from walk(child)

    yield from walk(document)


def _number(value: Any) -> int | None:
    """Accept integral JSON numbers/numeric strings; reject null, bool, or fractional values."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = float(raw)
        except ValueError:
            return None
        return int(parsed) if parsed.is_integer() else None
    return None


def _value_from_paths(row: dict[str, Any], paths: tuple[tuple[str, ...], ...]) -> Any:
    for path in paths:
        current: Any = row
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]
        if current is not None:
            return current
    return None


def _canonical_team_id(raw: Any, team_identity_map: dict[str, str]) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    return team_identity_map.get(value, value)


def _to_match(row: dict[str, Any], team_identity_map: dict[str, str]) -> Match | None:
    """Normalize raw API-Football or canonical fixture rows into a training Match."""
    status = _value_from_paths(
        row,
        (("status", "short"), ("fixture", "status", "short"), ("status",)),
    )
    if isinstance(status, dict):
        status = status.get("short")
    if status is not None and str(status).upper() not in {"FT", "AET", "PEN"}:
        return None

    match_id = _value_from_paths(
        row,
        (("provider_fixture_id",), ("match_id",), ("fixture", "id"), ("id",)),
    )
    played_at = _value_from_paths(
        row,
        (("played_at",), ("kickoff_at",), ("fixture", "date"), ("date",)),
    )
    home_raw = _value_from_paths(
        row,
        (("home_team_id",), ("teams", "home", "id"), ("home", "id")),
    )
    away_raw = _value_from_paths(
        row,
        (("away_team_id",), ("teams", "away", "id"), ("away", "id")),
    )
    home_team_id = _canonical_team_id(home_raw, team_identity_map)
    away_team_id = _canonical_team_id(away_raw, team_identity_map)
    home_goals_raw = _value_from_paths(
        row,
        (("home_goals",), ("goals", "home"), ("score", "fulltime", "home")),
    )
    away_goals_raw = _value_from_paths(
        row,
        (("away_goals",), ("goals", "away"), ("score", "fulltime", "away")),
    )

    home_goals = _number(home_goals_raw)
    away_goals = _number(away_goals_raw)
    if match_id is None or played_at is None or home_team_id is None or away_team_id is None:
        return None
    if home_goals is None or away_goals is None or home_goals < 0 or away_goals < 0:
        return None

    try:
        played = _as_datetime(played_at)
    except (TypeError, ValueError, OverflowError):
        return None

    return Match(
        str(match_id),
        played,
        home_team_id,
        away_team_id,
        home_goals,
        away_goals,
    )


def load_settled_matches(conn, as_of: datetime | None = None) -> list[Match]:
    """Load settled results strictly from the existing S3 fixture archive with canonical team IDs."""
    manifests = fetch_fixture_manifests(conn)
    if not manifests:
        raise RuntimeError("prediction_training_source_unavailable: no fixture manifests")

    team_identity_map = fetch_team_identity_map(conn)
    client = _s3_client()
    cutoff = _as_datetime(as_of or datetime.now(timezone.utc))
    by_id: dict[str, Match] = {}
    discovered = accepted_before_cutoff = canonicalized_teams = 0
    for manifest in manifests:
        document = load_manifest_json(client, manifest)
        for row in _extract_rows(document):
            discovered += 1
            raw_home = _value_from_paths(row, (("home_team_id",), ("teams", "home", "id"), ("home", "id")))
            raw_away = _value_from_paths(row, (("away_team_id",), ("teams", "away", "id"), ("away", "id")))
            if str(raw_home) in team_identity_map and str(raw_away) in team_identity_map:
                canonicalized_teams += 1
            match = _to_match(row, team_identity_map)
            if match is None or match.played_at >= cutoff:
                continue
            accepted_before_cutoff += 1
            by_id[match.match_id] = match

    matches = sorted(by_id.values(), key=lambda m: (m.played_at, m.match_id))
    if not matches:
        raise RuntimeError(
            "prediction_training_source_unavailable: no settled fixture results "
            f"(archive_rows_discovered={discovered}, accepted_before_cutoff={accepted_before_cutoff}, "
            f"team_rows_canonicalized={canonicalized_teams}, team_aliases={len(team_identity_map)}, "
            f"manifests={len(manifests)})"
        )
    return matches
