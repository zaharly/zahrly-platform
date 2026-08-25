#!/usr/bin/env python3
"""Discover one real API-Football season and persist its canonical Zahrly catalog state."""
from __future__ import annotations

import json
import os
import sys
from urllib.request import Request, urlopen

from .api_football import fetch_available_seasons, fetch_leagues_for_season


def _post_season_discovery(season: int, leagues: list[dict[str, object]]) -> dict[str, object]:
    url = (os.environ.get("PROVIDER_REGISTRY_GATEWAY_URL") or "").strip()
    secret = (os.environ.get("PROVIDER_GATEWAY_SECRET") or "").strip()
    if not url or not secret:
        raise RuntimeError("PROVIDER_REGISTRY_GATEWAY_URL and PROVIDER_GATEWAY_SECRET are required")

    payload = json.dumps({"mode": "season_discovery", "season": season, "leagues": leagues}).encode("utf-8")
    req = Request(
        url.rstrip("/"),
        data=payload,
        method="POST",
        headers={"content-type": "application/json", "x-provider-gateway-secret": secret},
    )
    with urlopen(req, timeout=90) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("persisted") is not True:
        raise RuntimeError(f"provider registry did not confirm season discovery persistence: {body}")
    return body


def main() -> int:
    try:
        season = int(os.environ.get("SEASON", "2008"))
        if season < 1900 or season > 2100:
            raise ValueError("SEASON must be between 1900 and 2100")

        available = set(fetch_available_seasons())
        if season not in available:
            raise RuntimeError(f"API-Football does not expose season {season}")

        discovered: list[dict[str, object]] = []
        for league in fetch_leagues_for_season(season):
            provider_league_id = int(league["provider_league_id"])
            league_name = str(league.get("league_name") or "").strip()
            country_code = str(league.get("country_code") or "").strip().upper()
            country_name = str(league.get("country_name") or country_code or "Unknown").strip()
            if provider_league_id <= 0 or not league_name:
                continue
            discovered.append({
                "provider_league_id": provider_league_id,
                "league_name": league_name,
                "country_code": country_code,
                "country_name": country_name,
            })

        if not discovered:
            raise RuntimeError(f"API-Football returned no valid leagues for season {season}")

        result = _post_season_discovery(season, discovered)

        print(json.dumps({
            "provider": "api-football",
            "season": season,
            "season_available": True,
            "discovered_leagues": len(discovered),
            "countries_written": int(result.get("countriesWritten") or 0),
            "competitions_created": int(result.get("competitionsCreated") or 0),
            "competitions_updated": int(result.get("competitionsUpdated") or 0),
            "processing_controls_initialized": int(result.get("controlRowsCreated") or 0),
            "persisted_registrations": int(result.get("registrationsWritten") or 0),
        }, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"provider registry bootstrap failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
