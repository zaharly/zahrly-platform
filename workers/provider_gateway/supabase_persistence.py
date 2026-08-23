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
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not gateway_url or not service_role_key:
        raise RuntimeError("PROVIDER_QUOTA_GATEWAY_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    request = Request(
        gateway_url.rstrip("/"),
        data=json.dumps(snapshot).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {service_role_key}",
        },
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        payload = json.loads(raw) if raw else {}
        if not payload.get("persisted"):
            raise RuntimeError(f"provider quota gateway did not confirm persistence: {payload}")
        return payload
