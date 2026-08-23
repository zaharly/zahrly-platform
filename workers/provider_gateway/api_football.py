#!/usr/bin/env python3
"""API-Football provider adapter for quota observations.

This module is intentionally limited to provider I/O and normalization.
Persistence belongs to the worker boundary / canonical Supabase RPC path.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from urllib.request import Request, urlopen

BASE_URL = "https://v3.football.api-sports.io/status"


def fetch_quota() -> dict[str, object]:
    api_key = os.environ.get("API_FOOTBALL_KEY")
    if not api_key:
        raise RuntimeError("API_FOOTBALL_KEY is required")

    request = Request(BASE_URL, headers={"x-apisports-key": api_key})
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
