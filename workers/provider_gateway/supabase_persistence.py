#!/usr/bin/env python3
"""Canonical quota snapshot persistence boundary.

Production workers use a server-side Supabase credential. No browser or CI
credential is accepted here, and the provider API key is never reused as a
Supabase credential.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen


def persist_snapshot(snapshot: dict[str, object]) -> dict[str, object]:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for worker persistence")

    observed = datetime.fromisoformat(str(snapshot["observed_at"]).replace("Z", "+00:00")).astimezone(timezone.utc)
    window_start = datetime(observed.year, observed.month, observed.day, tzinfo=timezone.utc)
    window_end = window_start + timedelta(days=1)
    payload = {
        "p_provider": snapshot["provider"],
        "p_window_start": window_start.isoformat(),
        "p_window_end": window_end.isoformat(),
        "p_daily_budget": snapshot["daily_budget"],
        "p_quota_used": snapshot["quota_used"],
        "p_protected_production_budget": snapshot["quota_remaining"],
        "p_backfill_budget": snapshot["quota_remaining"],
        "p_reserve_policy_version": "provider_observed_v1",
        "p_observed_at": observed.isoformat(),
    }
    request = Request(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/record_provider_quota_snapshot",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "apikey": service_role_key,
            "authorization": f"Bearer {service_role_key}",
        },
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {"persisted": True}
