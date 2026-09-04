from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone

from workers.prediction_engine import archive_training_source as source
from workers.prediction_engine.archive_payload_adapters import walk_fixture_rows
from workers.prediction_engine.season_resolver import resolve_season
from workers.prediction_engine.walk_forward import Match


def _as_datetime(value):
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value)
        seconds /= 1000.0 if seconds > 1e11 else 1.0
        dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
    elif isinstance(value, str):
        text = value.strip()
        try:
            numeric = float(text)
            seconds = numeric / 1000.0 if numeric > 1e11 else numeric
            dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (ValueError, OverflowError):
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    else:
        raise TypeError(f"unsupported datetime value: {type(value).__name__}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fixture_date(row):
    fixture = row.get("fixture") or {}
    if isinstance(fixture, dict):
        value = fixture.get("date") or fixture.get("timestamp")
        if value is not None:
            return value
    return row.get("date") or row.get("timestamp")


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, dict):
        for key in ("total", "goals", "score", "value", "fulltime", "regular", "current"):
            if key in value:
                parsed = _number(value.get(key))
                if parsed is not None:
                    return parsed
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        try:
            number = float(value.strip())
            return int(number) if number.is_integer() else None
        except ValueError:
            return None
    return None


def _score_pair(row):
    goals = row.get("goals") or {}
    score = row.get("score") or {}
    hg = _number(goals.get("home")) if isinstance(goals, dict) else None
    ag = _number(goals.get("away")) if isinstance(goals, dict) else None
    if isinstance(score, dict):
        for key in ("fulltime", "regular", "current", "extratime", "halftime"):
            pair = score.get(key)
            if not isinstance(pair, dict):
                continue
            if hg is None:
                hg = _number(pair.get("home"))
            if ag is None:
                ag = _number(pair.get("away"))
            if hg is not None and ag is not None:
                break
    if hg is None:
        hg = _number(row.get("home_goals"))
    if ag is None:
        ag = _number(row.get("away_goals"))
    return hg, ag


def _load_payload_candidates(client, bucket, key, expected_checksum):
    current = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    current_checksum = hashlib.sha256(current).hexdigest()
    current_rows = list(walk_fixture_rows(current))
    if current_checksum == expected_checksum and current_rows:
        return current, current_rows, "CURRENT"

    try:
        versions = client.list_object_versions(Bucket=bucket, Key=key).get("Versions", [])
    except Exception as exc:
        raise RuntimeError(f"historical archive object is metadata-only and S3 version recovery is unavailable:{key}:{type(exc).__name__}") from exc

    for version in sorted(versions, key=lambda item: (item.get("LastModified") or datetime.min), reverse=True):
        version_id = version.get("VersionId")
        if not version_id or version.get("IsLatest"):
            continue
        try:
            candidate = client.get_object(Bucket=bucket, Key=key, VersionId=version_id)["Body"].read()
            rows = list(walk_fixture_rows(candidate))
        except Exception:
            continue
        if rows:
            digest = hashlib.sha256(candidate).hexdigest()
            print(json.dumps({
                "archive_payload_recovery": {
                    "key": key,
                    "status": "RECOVERED_S3_VERSION",
                    "version_id": version_id,
                    "current_checksum": current_checksum,
                    "catalog_checksum": expected_checksum,
                    "version_checksum": digest,
                    "parsed_rows": len(rows),
                }
            }, sort_keys=True), flush=True)
            return candidate, rows, version_id

    raise RuntimeError(f"historical archive payload unavailable:metadata-only-current-object-and-no-usable-s3-version:{key}")


def recovered_load_settled_matches(conn, as_of=None):
    complete_seasons = source.fetch_complete_archive_seasons(conn)
    manifests = source.fetch_fixture_manifests(conn, complete_seasons=complete_seasons)
    if not manifests:
        raise RuntimeError("prediction_training_source_unavailable:no_complete_fixture_manifests")
    team_map = source.fetch_team_identity_map(conn)
    client = source._s3_client()
    cutoff = _as_datetime(as_of or datetime.now(timezone.utc))
    by_id = {}
    diagnostics = {}

    for manifest in manifests:
        bucket, key = source._parse_uri(manifest.object_uri)
        archive_season, logical_season = source._season_from_manifest(manifest)
        raw, rows, source_version = _load_payload_candidates(client, bucket, key, manifest.checksum)
        stats = diagnostics.setdefault(str(archive_season or "unknown"), {
            "logical_season": logical_season,
            "manifest_count": 0,
            "expected_rows": 0,
            "walked": 0,
            "accepted": 0,
            "missing_fields": 0,
            "bad_date": 0,
            "pre_cutoff": 0,
            "missing_team_identity": 0,
            "recovered_versions": 0,
        })
        stats["manifest_count"] += 1
        stats["expected_rows"] += manifest.row_count
        if source_version != "CURRENT":
            stats["recovered_versions"] += 1

        for row in rows:
            stats["walked"] += 1
            fixture = row.get("fixture") or {}
            teams = row.get("teams") or {}
            fid = fixture.get("id") if isinstance(fixture, dict) else None
            date = _fixture_date(row)
            home = ((teams.get("home") or {}).get("id") if isinstance(teams, dict) and isinstance(teams.get("home"), dict) else (teams.get("home") if isinstance(teams, dict) else None))
            away = ((teams.get("away") or {}).get("id") if isinstance(teams, dict) and isinstance(teams.get("away"), dict) else (teams.get("away") if isinstance(teams, dict) else None))
            hg, ag = _score_pair(row)
            if fid is None or date is None or home is None or away is None or hg is None or ag is None:
                stats["missing_fields"] += 1
                continue
            try:
                played = _as_datetime(date)
            except (TypeError, ValueError, OverflowError):
                stats["bad_date"] += 1
                continue
            if played >= cutoff:
                stats["pre_cutoff"] += 1
                continue
            ht = source._historical_team_key(home, team_map.get(str(home)))
            at = source._historical_team_key(away, team_map.get(str(away)))
            if not ht or not at:
                stats["missing_team_identity"] += 1
                continue
            candidate = Match(str(fid), played, ht, at, hg, ag, logical_season, archive_season)
            existing = by_id.get(str(fid))
            stats["accepted"] += 1
            if existing is None:
                by_id[str(fid)] = candidate
            elif existing != candidate:
                old = (existing.played_at, existing.home_team_id, existing.away_team_id, existing.home_goals, existing.away_goals)
                new = (candidate.played_at, candidate.home_team_id, candidate.away_team_id, candidate.home_goals, candidate.away_goals)
                if old != new:
                    raise RuntimeError(f"conflicting archived fixture payload:{fid}")
                if existing.season is None and logical_season is not None:
                    by_id[str(fid)] = candidate

    missing = [
        season for season in sorted(complete_seasons)
        if diagnostics.get(str(season), {}).get("expected_rows", 0) > 0
        and diagnostics.get(str(season), {}).get("accepted", 0) == 0
    ]
    print(json.dumps({
        "complete_archive_seasons": sorted(complete_seasons),
        "archive_fixture_parse_diagnostics": diagnostics,
        "unparsed_complete_seasons": missing,
    }, sort_keys=True), flush=True)
    if missing:
        raise RuntimeError(f"prediction_training_source_unavailable:complete_seasons_with_zero_parsed_fixtures:{missing}")
    matches = sorted(by_id.values(), key=lambda match: (match.played_at, match.match_id))
    if not matches:
        raise RuntimeError("prediction_training_source_unavailable:no_canonical_settled_matches")
    return matches


source.load_settled_matches = recovered_load_settled_matches

from workers.prediction_engine import historical_training_job  # noqa: E402

if __name__ == "__main__":
    historical_training_job.main()
