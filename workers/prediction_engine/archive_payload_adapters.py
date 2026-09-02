from __future__ import annotations

from collections.abc import Iterator
from typing import Any


def walk_fixture_rows(value: Any) -> Iterator[dict[str, Any]]:
    """Yield canonical fixture-shaped rows plus common legacy archive shapes."""
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

    fixture_id = value.get("fixture_id") or value.get("match_id") or value.get("game_id") or value.get("id")
    home = value.get("home_team_id") or value.get("home_id")
    away = value.get("away_team_id") or value.get("away_id")
    if home is None:
        h = teams.get("home") if isinstance(teams, dict) else None
        home = h.get("id") if isinstance(h, dict) else h
    if away is None:
        a = teams.get("away") if isinstance(teams, dict) else None
        away = a.get("id") if isinstance(a, dict) else a
    if home is None and isinstance(value.get("home"), dict):
        home = value["home"].get("id")
    if away is None and isinstance(value.get("away"), dict):
        away = value["away"].get("id")

    date = value.get("date") or value.get("timestamp")
    if date is None and isinstance(fixture, dict):
        date = fixture.get("date") or fixture.get("timestamp")

    goals = value.get("goals") if isinstance(value.get("goals"), dict) else {}
    score = value.get("score") if isinstance(value.get("score"), dict) else {}
    hg = goals.get("home")
    ag = goals.get("away")
    for key in ("fulltime", "regular", "current", "extratime"):
        pair = score.get(key)
        if isinstance(pair, dict):
            if hg is None:
                hg = pair.get("home")
            if ag is None:
                ag = pair.get("away")
    hg = value.get("home_goals") if hg is None else hg
    ag = value.get("away_goals") if ag is None else ag

    if fixture_id is not None and home is not None and away is not None and date is not None and hg is not None and ag is not None:
        yield {
            "fixture": {"id": fixture_id, "date": date},
            "teams": {"home": {"id": home}, "away": {"id": away}},
            "goals": {"home": hg, "away": ag},
        }
        return

    for child in value.values():
        yield from walk_fixture_rows(child)
