#!/usr/bin/env python3
"""Canonical quota snapshot persistence boundary.

The provider worker never exposes internal Postgres schemas through the Data
API. It sends the normalized snapshot to the private Supabase Edge Function,
which performs the privileged database write server-side.

Production persistence uses a dedicated inter-service credential. The
provider API key is never reused as gateway authentication.
"""
from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


def persist_snapshot(snapshot: dict[str, object]) -> dict[str, object]:
    gateway_url = os.environ.get("PROVIDER_QUOTA_GATEWAY_URL")
    gateway_secret = (os.environ.get("PROVIDER_GATEWAY_SECRET") or "").strip()
    if not gateway_url or not gateway_secret:
        raise RuntimeError("PROVIDER_QUOTA_GATEWAY_URL and PROVIDER_GATEWAY_SECRET are required")

    request = Request(
        gateway_url.rstrip("/"),
        data=json.dumps(snapshot).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-provider-gateway-secret": gateway_secret,
        },
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        payload = json.loads(raw) if raw else {}
        if not payload.get("persisted"):
            raise RuntimeError(f"provider quota gateway did not confirm persistence: {payload}")
        return payload
