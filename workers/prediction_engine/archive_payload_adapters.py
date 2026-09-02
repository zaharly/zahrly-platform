from __future__ import annotations

import base64
import gzip
import json
from collections.abc import Iterator
from typing import Any


_JSON_WRAPPER_KEYS = (
    "response", "data", "rows", "results", "items", "fixtures", "matches", "payload", "body", "content"
)
_ID_KEYS = ("fixture_id", "match_id", "game_id", "fixtureId", "matchId", "gameId", "id")
_HOME_KEYS = ("home_team_id", "home_id", "homeTeamId", "homeId")
_AWAY_KEYS = ("away_team_id", "away_id", "awayTeamId", "awayId")
_DATE_KEYS = ("date", "timestamp", "fixture_date", "match_date", "kickoff", "kickoff_at")
_HOME_GOAL_KEYS = ("home_goals", "home_score", "homeGoals", "homeScore")
_AWAY_GOAL_KEYS = ("away_goals", "away_score", "awayGoals", "awayScore")


def _decode_json_container(value: Any) -> Any:
    """Decode JSON, gzip-compressed JSON, and base64-wrapped JSON used by legacy archives."""
    current = value
    for _ in range(5):
        if isinstance(current, bytes):
            raw = current
            if raw[:2] == b"\x1f\x8b":
                try:
                    raw = gzip.decompress(raw)
                except (OSError, EOFError):
                    return value
            try:
                current = raw.decode("utf-8")
            except UnicodeDecodeError:
                return value
            continue
        if not isinstance(current, str):
            return current
        text = current.strip()
        if not text:
            return current
        if text[0] in "[{":
            try:
                current = json.loads(text)
            except (TypeError, ValueError):
                return current
            continue
        if len(text) >= 32 and len(text) % 4 == 0:
            try:
                decoded = base64.b64decode(text, validate=True)
            except (ValueError, base64.binascii.Error):
                decoded = None
            if decoded:
                current = decoded
                continue
        return current
    return current


def _iter_children(value: Any) -> Iterator[Any]:
    if isinstance(value, list):
        yield from value
        return
    if not isinstance(value, dict):
        return
    preferred = [value[key] for key in _JSON_WRAPPER_KEYS if key in value]
    if preferred:
        for child in preferred:
            yield child
        return
    yield from value.values()


def _first(value: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        item = value.get(key)
        if item is not None:
            return item
    return None


def _nested_id(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("id") or value.get("team_id") or value.get("teamId")
    return value


def _nested_score(value: Any) -> tuple[Any, Any]:
    if not isinstance(value, dict):
        return None, None
    home = value.get("home")
    away = value.get("away")
    if isinstance(home, dict):
        home = home.get("total") or home.get("goals") or home.get("score") or home.get("value")
    if isinstance(away, dict):
        away = away.get("total") or away.get("goals") or away.get("score") or away.get("value")
    return home, away


def _columnar_rows(value: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Handle legacy archives serialized as parallel column arrays instead of row objects."""
    id_value = _first(value, _ID_KEYS)
    home_value = _first(value, _HOME_KEYS)
    away_value = _first(value, _AWAY_KEYS)
    date_value = _first(value, _DATE_KEYS)
    home_goal_value = _first(value, _HOME_GOAL_KEYS)
    away_goal_value = _first(value, _AWAY_GOAL_KEYS)
    candidates = (id_value, home_value, away_value, date_value, home_goal_value, away_goal_value)
    if not any(isinstance(item, list) for item in candidates):
        return None
    lengths = [len(item) for item in candidates if isinstance(item, list)]
    count = max(lengths) if lengths else 0

    def at(item: Any, index: int) -> Any:
        if isinstance(item, list):
            return item[index] if index < len(item) else None
        return item

    rows: list[dict[str, Any]] = []
    for index in range(count):
        fixture_id = at(id_value, index)
        home = at(home_value, index)
        away = at(away_value, index)
        date = at(date_value, index)
        hg = at(home_goal_value, index)
        ag = at(away_goal_value, index)
        if fixture_id is None or home is None or away is None or date is None or hg is None or ag is None:
            continue
        home_id = _nested_id(home)
        away_id = _nested_id(away)
        if home_id is None or away_id is None:
            continue
        rows.append({
            "fixture": {"id": fixture_id, "date": date},
            "teams": {"home": {"id": home_id}, "away": {"id": away_id}},
            "goals": {"home": hg, "away": ag},
        })
    return rows or None


def _canonical_from_legacy(value: dict[str, Any]) -> dict[str, Any] | None:
    fixture = value.get("fixture") if isinstance(value.get("fixture"), dict) else None
    teams = value.get("teams") if isinstance(value.get("teams"), dict) else None

    fixture_id = _first(value, _ID_KEYS)
    if fixture_id is None and fixture:
        fixture_id = _first(fixture, _ID_KEYS)

    home = _first(value, _HOME_KEYS)
    away = _first(value, _AWAY_KEYS)
    if teams:
        home = _nested_id(teams.get("home")) if home is None else home
        away = _nested_id(teams.get("away")) if away is None else away
    if home is None:
        home = _nested_id(value.get("home"))
    if away is None:
        away = _nested_id(value.get("away"))

    date = _first(value, _DATE_KEYS)
    if date is None and fixture:
        date = _first(fixture, _DATE_KEYS)

    goals = value.get("goals") if isinstance(value.get("goals"), dict) else {}
    score = value.get("score") if isinstance(value.get("score"), dict) else {}
    hg = goals.get("home")
    ag = goals.get("away")
    if hg is None or ag is None:
        for key in ("fulltime", "regular", "current", "extratime", "halftime"):
            pair = score.get(key)
            if isinstance(pair, dict):
                ph, pa = _nested_score(pair)
                if hg is None: hg = ph
                if ag is None: ag = pa
                if hg is not None and ag is not None: break
    if hg is None: hg = _first(value, _HOME_GOAL_KEYS)
    if ag is None: ag = _first(value, _AWAY_GOAL_KEYS)

    home_id = _nested_id(home)
    away_id = _nested_id(away)
    if fixture_id is None or home_id is None or away_id is None or date is None or hg is None or ag is None:
        return None
    return {
        "fixture": {"id": fixture_id, "date": date},
        "teams": {"home": {"id": home_id}, "away": {"id": away_id}},
        "goals": {"home": hg, "away": ag},
    }


def walk_fixture_rows(value: Any) -> Iterator[dict[str, Any]]:
    """Yield canonical fixture-shaped rows from current and legacy archive payloads."""
    value = _decode_json_container(value)
    if isinstance(value, list):
        for item in value:
            yield from walk_fixture_rows(item)
        return
    if not isinstance(value, dict):
        return

    fixture = value.get("fixture")
    teams = value.get("teams")
    if isinstance(fixture, dict) and isinstance(teams, dict):
        yield value
        return

    rows = _columnar_rows(value)
    if rows:
        yield from rows
        return

    canonical = _canonical_from_legacy(value)
    if canonical is not None:
        yield canonical
        return

    for child in _iter_children(value):
        yield from walk_fixture_rows(child)
