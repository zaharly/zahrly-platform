from __future__ import annotations

import hashlib
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterator
from urllib.parse import urlparse

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from .archive_payload_adapters import _decode_json_container


MARKET_NAMES = {
    "match winner",
    "match result",
    "1x2",
    "3way",
    "home draw away",
}
SELECTION_MAP = {
    "home": "H",
    "1": "H",
    "h": "H",
    "draw": "D",
    "x": "D",
    "d": "D",
    "away": "A",
    "2": "A",
    "a": "A",
}


def _utc(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            number = float(text)
            if number > 1e11:
                number /= 1000.0
            dt = datetime.fromtimestamp(number, tz=timezone.utc)
        except (ValueError, OverflowError):
            try:
                dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _number(value: Any) -> float | None:
    if isinstance(value, dict):
        for key in ("odd", "odds", "value", "price"):
            if key in value:
                parsed = _number(value[key])
                if parsed is not None:
                    return parsed
        return None
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 1.0 else None


def _fixture_id(node: dict[str, Any]) -> str | None:
    fixture = node.get("fixture")
    if isinstance(fixture, dict) and fixture.get("id") is not None:
        return str(fixture["id"])
    for key in ("fixture_id", "fixtureId", "match_id", "matchId"):
        if node.get(key) is not None:
            return str(node[key])
    return None


def _fixture_date(node: dict[str, Any]) -> datetime | None:
    fixture = node.get("fixture")
    if isinstance(fixture, dict):
        for key in ("date", "timestamp"):
            dt = _utc(fixture.get(key))
            if dt:
                return dt
    for key in ("kickoff", "kickoff_at", "date", "timestamp"):
        dt = _utc(node.get(key))
        if dt:
            return dt
    return None


def _captured_at(node: dict[str, Any], fallback: datetime | None) -> datetime | None:
    for key in ("update", "updated_at", "captured_at", "observed_at", "timestamp"):
        dt = _utc(node.get(key))
        if dt:
            return dt
    return fallback


def _walk_with_context(
    value: Any,
    fixture_id: str | None = None,
    kickoff: datetime | None = None,
    captured_at: datetime | None = None,
) -> Iterator[tuple[dict[str, Any], str | None, datetime | None, datetime | None]]:
    if isinstance(value, list):
        for item in value:
            yield from _walk_with_context(item, fixture_id, kickoff, captured_at)
        return
    if not isinstance(value, dict):
        return
    own_fixture = _fixture_id(value) or fixture_id
    own_kickoff = _fixture_date(value) or kickoff
    own_captured = _captured_at(value, captured_at)
    yield value, own_fixture, own_kickoff, own_captured
    for child in value.values():
        yield from _walk_with_context(child, own_fixture, own_kickoff, own_captured)


def _s3_client():
    return boto3.client(
        "s3",
        region_name=os.environ.get("S3_REGION", "eu-north-1"),
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )


def _uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise ValueError(f"invalid S3 object URI: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def _manifest_rows(conn, latest: datetime) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select manifest_id::text as manifest_id, object_uri, checksum, date_start, date_end
              from internal.archive_catalog
             where provider='api-football'
               and dataset_type='pre_match_odds'
               and completeness_score >= 1.0
               and object_uri like 's3://%%'
               and date_start is not null
               and date_start < %s
             order by date_start, manifest_id
            """,
            (latest,),
        )
        return cur.fetchall()


def _market_entries(node: dict[str, Any]) -> Iterator[tuple[str, str, float]]:
    bookmakers = node.get("bookmakers")
    if not isinstance(bookmakers, list):
        return
    for bookmaker in bookmakers:
        if not isinstance(bookmaker, dict):
            continue
        bookmaker_id = str(bookmaker.get("id") or bookmaker.get("name") or "unknown")
        bets = bookmaker.get("bets")
        if not isinstance(bets, list):
            continue
        for bet in bets:
            if not isinstance(bet, dict):
                continue
            name = str(bet.get("name") or "").strip().lower()
            try:
                bet_id = int(bet.get("id"))
            except (TypeError, ValueError):
                bet_id = -1
            if name not in MARKET_NAMES and bet_id not in {1, 14}:
                continue
            values = bet.get("values")
            if not isinstance(values, list):
                continue
            for selection in values:
                if not isinstance(selection, dict):
                    continue
                key = SELECTION_MAP.get(str(selection.get("value") or selection.get("label") or "").strip().lower())
                odd = _number(selection.get("odd") if selection.get("odd") is not None else selection.get("odds"))
                if key and odd is not None:
                    yield bookmaker_id, key, odd


def load_archive_pre_match_market_probs(conn, requested: dict[str, datetime]) -> dict[str, tuple[float, float, float, datetime, list[tuple[str, float]]]]:
    if not requested:
        return {}
    latest = max(requested.values()).astimezone(timezone.utc)
    wanted = {str(k): v.astimezone(timezone.utc) for k, v in requested.items()}
    snapshots: dict[str, dict[str, dict[str, dict[str, float | datetime]]]] = defaultdict(lambda: defaultdict(dict))
    client = _s3_client()
    manifests = _manifest_rows(conn, latest)
    for manifest in manifests:
        bucket, key = _uri(manifest["object_uri"])
        raw = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        if hashlib.sha256(raw).hexdigest() != manifest["checksum"]:
            raise RuntimeError(f"archive checksum mismatch:{manifest['manifest_id']}")
        decoded = _decode_json_container(raw)
        for node, fid, kickoff, captured in _walk_with_context(decoded):
            if not fid or fid not in wanted or not isinstance(node.get("bookmakers"), list):
                continue
            match_kickoff = wanted[fid]
            if kickoff and kickoff != match_kickoff and abs((kickoff - match_kickoff).total_seconds()) > 86400:
                continue
            observed = captured
            if observed is None or observed >= match_kickoff:
                continue
            for bookmaker_id, selection, odd in _market_entries(node):
                current = snapshots[fid][bookmaker_id].get(observed.isoformat())
                if current is None:
                    snapshots[fid][bookmaker_id][observed.isoformat()] = {"captured": observed, selection: odd}
                else:
                    current[selection] = odd

    output: dict[str, tuple[float, float, float, datetime, list[tuple[str, float]]]] = {}
    for fid, books in snapshots.items():
        normalized: list[tuple[float, float, float, datetime]] = []
        clv: list[tuple[str, float]] = []
        for book_snapshots in books.values():
            complete = []
            for snap in book_snapshots.values():
                if all(k in snap for k in ("H", "D", "A")):
                    captured = snap["captured"]
                    assert isinstance(captured, datetime)
                    complete.append((captured, float(snap["H"]), float(snap["D"]), float(snap["A"])))
            complete.sort(key=lambda x: x[0])
            if not complete:
                continue
            closing = complete[-1]
            inv = [1.0 / closing[i] for i in (1, 2, 3)]
            scale = sum(inv)
            normalized.append((inv[0] / scale, inv[1] / scale, inv[2] / scale, closing[0]))
            if len(complete) > 1:
                opening = complete[0]
                for selection, index in (("H", 1), ("D", 2), ("A", 3)):
                    clv.append((selection, opening[index] / closing[index] - 1.0))
        if normalized:
            output[fid] = (
                sum(x[0] for x in normalized) / len(normalized),
                sum(x[1] for x in normalized) / len(normalized),
                sum(x[2] for x in normalized) / len(normalized),
                max(x[3] for x in normalized),
                clv,
            )
    return output
