from __future__ import annotations

import base64
import bz2
import gzip
import json
import lzma
import zipfile
import zlib
from collections.abc import Iterator
from io import BytesIO
from typing import Any

try:
    import lz4.frame as lz4_frame
except ImportError:
    lz4_frame = None

try:
    import zstandard as zstd
except ImportError:
    zstd = None

_ID_KEYS = ("fixture_id", "match_id", "game_id", "fixtureId", "matchId", "gameId", "fixtureid", "matchid", "gameid", "event_id", "eventId", "id")
_HOME_KEYS = ("home_team_id", "home_id", "homeTeamId", "homeId", "match_hometeam_id", "matchHomeTeamId", "localteam_id", "home_team", "team_home_id")
_AWAY_KEYS = ("away_team_id", "away_id", "awayTeamId", "awayId", "match_awayteam_id", "matchAwayTeamId", "visitorteam_id", "away_team", "team_away_id")
_DATE_KEYS = ("date", "timestamp", "fixture_date", "match_date", "kickoff", "kickoff_at", "event_date", "eventDate", "event_timestamp", "matchDate", "match_datetime")
_HOME_GOAL_KEYS = ("home_goals", "home_score", "homeGoals", "homeScore", "goalsHomeTeam", "home_team_goals", "match_hometeam_score", "score_home", "goals_home")
_AWAY_GOAL_KEYS = ("away_goals", "away_score", "awayGoals", "awayScore", "goalsAwayTeam", "away_team_goals", "match_awayteam_score", "score_away", "goals_away")
_HOME_OBJECT_KEYS = ("home", "homeTeam", "home_team", "localTeam", "localteam")
_AWAY_OBJECT_KEYS = ("away", "awayTeam", "away_team", "visitorTeam", "visitorteam")


def _decompress_candidates(raw: bytes) -> list[bytes]:
    """Return raw bytes plus any successfully decoded compression candidates.

    Compression detection is intentionally best-effort: ordinary JSON/NDJSON is
    common in the archive, so every optional decoder may legitimately reject it.
    A decoder-specific exception must never abort payload inspection.
    """
    out = [raw]
    stripped = raw.lstrip()
    if stripped.startswith((b"{", b"[")):
        return out

    attempts = [
        ("gzip", lambda: gzip.decompress(raw)),
        ("zlib", lambda: zlib.decompress(raw)),
        ("deflate", lambda: zlib.decompress(raw, -15)),
        ("gzip-zlib", lambda: zlib.decompress(raw, 31)),
        ("bz2", lambda: bz2.decompress(raw)),
        ("lzma", lambda: lzma.decompress(raw)),
    ]
    if zstd is not None:
        attempts.append(("zstd", lambda: zstd.ZstdDecompressor().decompress(raw)))
    if lz4_frame is not None:
        attempts.append(("lz4", lambda: lz4_frame.decompress(raw)))
    for _, fn in attempts:
        try:
            decoded = fn()
        except Exception:
            # These are speculative decoders, not the canonical parser. Reject
            # only this candidate and continue trying the remaining formats.
            continue
        if decoded and decoded not in out:
            out.insert(0, decoded)
    try:
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            names = [name for name in zf.namelist() if not name.endswith("/")]
            for name in names:
                decoded = zf.read(name)
                if decoded and decoded not in out:
                    out.insert(0, decoded)
    except Exception:
        pass
    return out


def _decode_bytes(raw: bytes) -> bytes | None:
    for candidate in _decompress_candidates(raw):
        if candidate:
            return candidate
    return None


def _decode_text_payload(raw: bytes) -> Any:
    for enc in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        stripped = text.lstrip("\ufeff").strip()
        if not stripped:
            continue
        try:
            return json.loads(stripped)
        except (TypeError, ValueError):
            pass
        lines = [x.strip() for x in stripped.splitlines() if x.strip()]
        if len(lines) > 1:
            try:
                return [json.loads(line.lstrip("\ufeff")) for line in lines]
            except (TypeError, ValueError):
                pass
        return text
    return None


def _decode_json_container(value: Any) -> Any:
    cur = value
    seen: set[bytes] = set()
    for _ in range(12):
        if isinstance(cur, bytes):
            if cur in seen:
                return cur
            seen.add(cur)
            candidates = _decompress_candidates(cur)
            for raw in candidates:
                parsed = _decode_text_payload(raw)
                if parsed is not None and parsed is not raw:
                    cur = parsed
                    break
            else:
                # Handle base64 stored directly as bytes, including base64-wrapped compressed payloads.
                try:
                    text = cur.decode("ascii").strip()
                    decoded = base64.b64decode(text, validate=True)
                except (UnicodeDecodeError, ValueError, base64.binascii.Error):
                    return cur
                if not decoded or decoded == cur:
                    return cur
                cur = decoded
            continue
        if not isinstance(cur, str):
            return cur
        text = cur.lstrip("\ufeff").strip()
        if not text:
            return cur
        try:
            return json.loads(text)
        except (TypeError, ValueError):
            pass
        lines = [x.strip() for x in text.splitlines() if x.strip()]
        if len(lines) > 1:
            try:
                return [json.loads(line.lstrip("\ufeff")) for line in lines]
            except (TypeError, ValueError):
                pass
        try:
            decoded = base64.b64decode(text, validate=True)
        except (ValueError, base64.binascii.Error):
            return cur
        if not decoded or decoded == text.encode():
            return cur
        cur = decoded
    return cur


def _iter_children(value: Any) -> Iterator[Any]:
    if isinstance(value, list):
        yield from value
    elif isinstance(value, dict):
        for child in value.values():
            yield child


def _first(value: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    if not isinstance(value, dict):
        return None
    for key in keys:
        if value.get(key) is not None:
            return value[key]
    return None


def _nested_id(value: Any) -> Any:
    if isinstance(value, dict):
        return _first(value, ("id", "team_id", "teamId", "teamid", "localteam_id", "visitorteam_id", "home_team_id", "away_team_id", "external_id", "externalId"))
    return value


def _nested_score(value: Any) -> tuple[Any, Any]:
    if not isinstance(value, dict):
        return None, None
    h = _first(value, ("home", "home_goals", "home_score", "goals_home", "match_hometeam_score"))
    a = _first(value, ("away", "away_goals", "away_score", "goals_away", "match_awayteam_score"))
    if isinstance(h, dict):
        h = _first(h, ("total", "goals", "score", "value"))
    if isinstance(a, dict):
        a = _first(a, ("total", "goals", "score", "value"))
    return h, a


def _columnar_rows(value: dict[str, Any]) -> list[dict[str, Any]] | None:
    vals = (_first(value, _ID_KEYS), _first(value, _HOME_KEYS), _first(value, _AWAY_KEYS), _first(value, _DATE_KEYS), _first(value, _HOME_GOAL_KEYS), _first(value, _AWAY_GOAL_KEYS))
    if not any(isinstance(v, list) for v in vals):
        return None
    n = max(len(v) for v in vals if isinstance(v, list))
    out: list[dict[str, Any]] = []
    for i in range(n):
        x = [v[i] if isinstance(v, list) and i < len(v) else v if not isinstance(v, list) else None for v in vals]
        fid, h, a, d, hg, ag = x
        h, a = _nested_id(h), _nested_id(a)
        if all(v is not None for v in (fid, h, a, d, hg, ag)):
            out.append({"fixture": {"id": fid, "date": d}, "teams": {"home": {"id": h}, "away": {"id": a}}, "goals": {"home": hg, "away": ag}})
    return out or None


def _canonical_from_legacy(v: dict[str, Any]) -> dict[str, Any] | None:
    fixture = v.get("fixture") if isinstance(v.get("fixture"), dict) else None
    teams = v.get("teams") if isinstance(v.get("teams"), dict) else None
    fid = _first(v, _ID_KEYS)
    if fid is None and fixture:
        fid = _first(fixture, _ID_KEYS)
    h, a = _first(v, _HOME_KEYS), _first(v, _AWAY_KEYS)
    if h is None:
        h = _nested_id(_first(v, _HOME_OBJECT_KEYS))
    if a is None:
        a = _nested_id(_first(v, _AWAY_OBJECT_KEYS))
    if teams:
        if h is None:
            h = _nested_id(teams.get("home"))
        if a is None:
            a = _nested_id(teams.get("away"))
    if h is None and fixture:
        h = _nested_id(fixture.get("homeTeam"))
    if a is None and fixture:
        a = _nested_id(fixture.get("awayTeam"))
    d = _first(v, _DATE_KEYS)
    if d is None and fixture:
        d = _first(fixture, _DATE_KEYS)
    goals = v.get("goals") if isinstance(v.get("goals"), dict) else {}
    score = v.get("score") if isinstance(v.get("score"), dict) else {}
    hg, ag = goals.get("home"), goals.get("away")
    if hg is None or ag is None:
        ph, pa = _nested_score(goals)
        if hg is None:
            hg = ph
        if ag is None:
            ag = pa
    for key in ("fulltime", "regular", "current", "extratime", "halftime"):
        p = score.get(key)
        if isinstance(p, dict):
            ph, pa = _nested_score(p)
            if hg is None:
                hg = ph
            if ag is None:
                ag = pa
    if hg is None:
        hg = _first(v, _HOME_GOAL_KEYS)
    if ag is None:
        ag = _first(v, _AWAY_GOAL_KEYS)
    if any(x is None for x in (fid, h, a, d, hg, ag)):
        return None
    return {"fixture": {"id": fid, "date": d}, "teams": {"home": {"id": h}, "away": {"id": a}}, "goals": {"home": hg, "away": ag}}


def walk_fixture_rows(value: Any) -> Iterator[dict[str, Any]]:
    value = _decode_json_container(value)
    if isinstance(value, list):
        for item in value:
            yield from walk_fixture_rows(item)
        return
    if not isinstance(value, dict):
        return
    fixture, teams = value.get("fixture"), value.get("teams")
    if isinstance(fixture, dict) and isinstance(teams, dict):
        yield value
    else:
        rows = _columnar_rows(value)
        if rows:
            yield from rows
        else:
            canonical = _canonical_from_legacy(value)
            if canonical is not None:
                yield canonical
    for child in _iter_children(value):
        yield from walk_fixture_rows(child)
