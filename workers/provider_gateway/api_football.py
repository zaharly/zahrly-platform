#!/usr/bin/env python3
"""API-Football provider adapters.

Provider I/O and normalization only. Persistence belongs to the provider worker
boundary / canonical Supabase persistence path.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL = "https://v3.football.api-sports.io"
STATUS_URL = f"{BASE_URL}/status"
FIXTURES_URL = f"{BASE_URL}/fixtures"


def _api_key() -> str:
    api_key = (os.environ.get("API_FOOTBALL_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("API_FOOTBALL_KEY is required")
    return api_key


def _get_json(path: str, params: dict[str, object] | None = None, timeout: int = 30) -> dict[str, object]:
    query = f"?{urlencode(params)}" if params else ""
    request = Request(
        f"{BASE_URL}{path}{query}",
        headers={"x-apisports-key": _api_key(), "Accept": "application/json"},
    )
    with urlopen(request, timeout=timeout) as response:
        body = json.load(response)
    if body.get("errors"):
        raise RuntimeError(f"API-Football request failed for {path}: {body['errors']}")
    return body


def fetch_quota() -> dict[str, object]:
    request = Request(STATUS_URL, headers={"x-apisports-key": _api_key()})
    with urlopen(request, timeout=20) as response:
        body = json.load(response)
        headers = {k.lower(): v for k, v in response.headers.items()}

    limit_raw = headers.get("x-ratelimit-requests-limit")
    remaining_raw = headers.get("x-ratelimit-requests-remaining")
    if limit_raw is None or remaining_raw is None:
        raise RuntimeError("API-Football quota headers are missing")

    limit = float(limit_raw)
    remaining = float(remaining_raw)
    if limit < 0 or remaining < 0 or remaining > limit:
        raise RuntimeError("API-Football quota invariant failed")

    return {
        "provider": "api-football",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "daily_budget": limit,
        "quota_used": limit - remaining,
        "quota_remaining": remaining,
        "provider_status_ok": bool(body.get("response")) or body.get("errors") == {},
    }


def fetch_available_seasons() -> list[int]:
    """Return the season years actually exposed by API-Football."""
    body = _get_json("/leagues/seasons", timeout=30)
    result: list[int] = []
    for value in body.get("response") or []:
        try:
            year = int(value)
        except (TypeError, ValueError):
            continue
        if 1900 <= year <= 2100:
            result.append(year)
    return sorted(set(result))


def fetch_leagues_for_season(season: int) -> list[dict[str, object]]:
    """Return the real competitions/leagues advertised by API-Football for one season."""
    if not isinstance(season, int) or season < 1900 or season > 2100:
        raise ValueError("season must be between 1900 and 2100")
    body = _get_json("/leagues", {"season": season}, timeout=60)
    rows: list[dict[str, object]] = []
    for item in body.get("response") or []:
        league = item.get("league") or {}
        country = item.get("country") or {}
        seasons = item.get("seasons") or []
        if not league.get("id") or not league.get("name"):
            continue
        season_meta = next((s for s in seasons if int(s.get("year", -1)) == season), None)
        rows.append({
            "provider": "api-football",
            "provider_league_id": int(league["id"]),
            "league_name": league["name"],
            "league_type": league.get("type"),
            "country_name": country.get("name"),
            "country_code": country.get("code"),
            "season": season,
            "season_start": (season_meta or {}).get("start"),
            "season_end": (season_meta or {}).get("end"),
            "season_current": (season_meta or {}).get("current"),
            "coverage": (season_meta or {}).get("coverage") or {},
        })
    return rows


def canonical_fixture_status(provider_status: str | None) -> str:
    """Map official API-Football status codes to the canonical fixture states."""
    code = (provider_status or "").upper()
    if code == "NS":
        return "scheduled"
    if code in {"1H", "HT", "2H", "ET", "P", "BT", "SUSP"}:
        return "live"
    if code in {"FT", "AET", "PEN"}:
        return "finished"
    if code == "PST":
        return "postponed"
    if code == "CANC":
        return "cancelled"
    raise RuntimeError(f"Unsupported API-Football fixture status: {code or '<empty>'}")


def fetch_upcoming_fixtures(date: str | None = None) -> list[dict[str, object]]:
    """Fetch and normalize fixture observations for the canonical ingest worker."""
    if date is None:
        date = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()

    body = _get_json("/fixtures", {"date": date}, timeout=30)
    normalized: list[dict[str, object]] = []
    for item in body.get("response", []):
        fixture = item.get("fixture") or {}
        league = item.get("league") or {}
        teams = item.get("teams") or {}
        home = teams.get("home") or {}
        away = teams.get("away") or {}
        if not fixture.get("id") or not league.get("id") or not home.get("id") or not away.get("id"):
            continue

        provider_status = (fixture.get("status") or {}).get("short")
        normalized.append({
            "provider": "api-football",
            "provider_fixture_id": fixture["id"],
            "country": {"code": None, "name": league.get("country") or "Unknown"},
            "competition": {"id": league["id"], "name": league.get("name") or "Unknown"},
            "home_team": {"id": home["id"], "name": home.get("name") or str(home["id"])},
            "away_team": {"id": away["id"], "name": away.get("name") or str(away["id"])},
            "kickoff_at": fixture.get("date"),
            "status": canonical_fixture_status(provider_status),
        })
    return normalized
