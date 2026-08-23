#!/usr/bin/env python3
"""Fetch API-Football quota headers without exposing the API key.

The script is intentionally side-effect free with respect to Supabase. It emits
one JSON snapshot that the deployment workflow can hand to the privileged
quota-recording boundary.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen

BASE_URL = "https://v3.football.api-sports.io/status"


def main() -> int:
    api_key = os.environ.get("API_FOOTBALL_KEY")
    if not api_key:
        print("API_FOOTBALL_KEY is required", file=sys.stderr)
        return 2

    req = Request(BASE_URL, headers={"x-apisports-key": api_key})
    with urlopen(req, timeout=20) as response:
        body = json.load(response)
        headers = {k.lower(): v for k, v in response.headers.items()}

    quota_limit = headers.get("x-ratelimit-requests-limit")
    quota_remaining = headers.get("x-ratelimit-requests-remaining")

    snapshot = {
        "provider": "api-football",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "daily_budget": float(quota_limit) if quota_limit is not None else None,
        "quota_used": (
            float(quota_limit) - float(quota_remaining)
            if quota_limit is not None and quota_remaining is not None
            else None
        ),
        "quota_remaining": float(quota_remaining) if quota_remaining is not None else None,
        "provider_status_ok": bool(body.get("response")) or body.get("errors") == {},
    }

    print(json.dumps(snapshot, separators=(",", ":")))
    if snapshot["daily_budget"] is None or snapshot["quota_remaining"] is None:
        print("Missing API-Football quota headers", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
