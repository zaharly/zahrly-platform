#!/usr/bin/env python3
"""API-Football fixture adapter.

Provider I/O and normalization only. Canonical persistence remains owned by the
provider ingest worker boundary.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json

BASE_URL = "https://v3.football.api-sports.io/fixtures"


def fetch_upcoming_fixtures(date: str | None = None) -> list[dict[str, object]]:
    api_key = os.environ.get("API_FOOTBALL_KEY")
    if not api_key:
        raise RuntimeError("API_FOOTBALL_KEY is required")

    if date is None:
        date = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()

    url = f"{BASE_URL}?{urlencode({'date': date})}"
    request = Request(url, headers={"x-apisports-key": api_key, "Accept": "application/json"})
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
        country = item.get("league", {}).get("country")
        if not fixture.get("id") or not league.get("id") or not home.get("id") or not away.get("id"):
            continue
        normalized.append({
            "provider": "api-football",
            "provider_fixture_id": fixture["id"],
            "country": {
                "code": None,
                "name": country or "Unknown",
            },
            "competition": {
                "id": league["id"],
                "name": league.get("name") or "Unknown",
            },
            "home_team": {"id": home["id"], "name": home.get("name") or str(home["id"])},
            "away_team": {"id": away["id"], "name": away.get("name") or str(away["id"])},
            "kickoff_at": fixture.get("date"),
            "status": (fixture.get("status") or {}).get("short") or "NS",
        })

    return normalized
