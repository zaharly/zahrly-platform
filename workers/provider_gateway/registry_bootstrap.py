#!/usr/bin/env python3
"""Register real API-Football league/season availability for Zahrly competitions."""
from __future__ import annotations

import json
import os
import sys
from urllib.request import Request, urlopen

from .api_football import fetch_available_seasons, fetch_leagues_for_season


def _post_registrations(registrations: list[dict[str, object]]) -> dict[str, object]:
    url = (os.environ.get("PROVIDER_REGISTRY_GATEWAY_URL") or "").strip()
    secret = (os.environ.get("PROVIDER_GATEWAY_SECRET") or "").strip()
    if not url or not secret:
        raise RuntimeError("PROVIDER_REGISTRY_GATEWAY_URL and PROVIDER_GATEWAY_SECRET are required")
    payload = json.dumps({"registrations": registrations}).encode("utf-8")
    req = Request(
        url.rstrip("/"),
        data=payload,
        method="POST",
        headers={"content-type": "application/json", "x-provider-gateway-secret": secret},
    )
    with urlopen(req, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not body.get("persisted"):
        raise RuntimeError(f"provider registry did not confirm persistence: {body}")
    return body


def _get_registered_competitions() -> list[dict[str, object]]:
    url = (os.environ.get("PROVIDER_REGISTRY_GATEWAY_URL") or "").strip()
    secret = (os.environ.get("PROVIDER_GATEWAY_SECRET") or "").strip()
    if not url or not secret:
        raise RuntimeError("PROVIDER_REGISTRY_GATEWAY_URL and PROVIDER_GATEWAY_SECRET are required")
    req = Request(url.rstrip("/"), method="GET", headers={"x-provider-gateway-secret": secret})
    with urlopen(req, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body.get("competitions") or []


def main() -> int:
    try:
        start = int(os.environ.get("SEASON_START", "2000"))
        end = int(os.environ.get("SEASON_END", "2026"))
        if start > end:
            raise ValueError("SEASON_START must be <= SEASON_END")

        available = [year for year in fetch_available_seasons() if start <= year <= end]
        competitions = _get_registered_competitions()
        if not competitions:
            raise RuntimeError("no ENABLED Zahrly competitions with api_football provider_ids are registered")

        provider_leagues = {int(c["provider_league_id"]): c for c in competitions}
        registrations: list[dict[str, object]] = []
        matched = 0

        for season in available:
            for league in fetch_leagues_for_season(season):
                target = provider_leagues.get(int(league["provider_league_id"]))
                if not target:
                    continue
                matched += 1
                registrations.append({
                    "competition_id": target["competition_id"],
                    "season": season,
                    "endpoint": "leagues",
                    "status": "SUPPORTED",
                })

        # The registry is intentionally limited to verified API responses. If a
        # competition has no league result for a season, we do not manufacture a
        # capability row for it.
        written = 0
        for offset in range(0, len(registrations), 500):
            result = _post_registrations(registrations[offset : offset + 500])
            written += int(result.get("written") or 0)

        print(json.dumps({
            "provider": "api-football",
            "season_range": [start, end],
            "available_seasons": len(available),
            "registered_zahrly_competitions": len(competitions),
            "matched_league_season_pairs": matched,
            "persisted_registrations": written,
        }, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"provider registry bootstrap failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
