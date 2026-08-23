#!/usr/bin/env python3
"""Canonical quota snapshot persistence boundary.

The provider worker never exposes internal Postgres schemas through the Data
API. It sends the normalized snapshot to the private Supabase Edge Function,
which performs the privileged database write server-side.
"""
from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


def persist_snapshot(snapshot: dict[str, object]) -> dict[str, object]:
    gateway_url = os.environ.get("PROVIDER_QUOTA_GATEWAY_URL")
    provider_key = (os.environ.get("API_FOOTBALL_KEY") or "").strip()
    if not gateway_url or not provider_key:
        raise RuntimeError("PROVIDER_QUOTA_GATEWAY_URL and API_FOOTBALL_KEY are required")

    request = Request(
        gateway_url.rstrip("/"),
        data=json.dumps(snapshot).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-provider-gateway-secret": provider_key,
        },
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        payload = json.loads(raw) if raw else {}
        if not payload.get("persisted"):
            raise RuntimeError(f"provider quota gateway did not confirm persistence: {payload}")
        return payload
