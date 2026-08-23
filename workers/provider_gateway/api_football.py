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

STATUS_URL = "https://v3.football.api-sports.io/status"
FIXTURES_URL = "https://v3.football.api-sports.io/fixtures"


def _api_key() -> str:
    api_key = os.environ.get("API_FOOTBALL_KEY")
    if not api_key:
        raise RuntimeError("API_FOOTBALL_KEY is required")
    return api_key


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


def fetch_upcoming_fixtures(date: str | None = None) -> list[dict[str, object]]:
    """Fetch and normalize fixture observations for the canonical ingest worker."""
    if date is None:
        date = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()

    url = f"{FIXTURES_URL}?{urlencode({'date': date})}"
    request = Request(
        url,
        headers={"x-apisports-key": _api_key(), "Accept": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        body = json.load(response)

    if body.get("errors"):
        raise RuntimeError(f"API-Football fixture request failed: {body['errors']}")

    normalized: list[dict[str, object]] = []
    for item in body.get("response", []):
        fixture = item.get("fixture") or {}
        league = item.get("league") or {}
        teams = item.get("teams") or {}
        home = teams.get("home") or {}
        away = teams.get("away") or {}
        if not fixture.get("id") or not league.get("id") or not home.get("id") or not away.get("id"):
            continue

        normalized.append(
            {
                "provider": "api-football",
                "provider_fixture_id": fixture["id"],
                "country": {
                    "code": None,
                    "name": league.get("country") or "Unknown",
                },
                "competition": {
                    "id": league["id"],
                    "name": league.get("name") or "Unknown",
                },
                "home_team": {"id": home["id"], "name": home.get("name") or str(home["id"])},
                "away_team": {"id": away["id"], "name": away.get("name") or str(away["id"])},
                "kickoff_at": fixture.get("date"),
                "status": (fixture.get("status") or {}).get("short") or "NS",
            }
        )

    return normalized
