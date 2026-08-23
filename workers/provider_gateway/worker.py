#!/usr/bin/env python3
"""Provider gateway worker entrypoint.

The worker owns provider calls/retries and hands normalized observations to the
canonical Supabase persistence boundary. It is not a cron implementation and
does not perform historical allocation itself.
"""
from __future__ import annotations

import json
import sys

from .api_football import fetch_quota
from .supabase_persistence import persist_snapshot


def main() -> int:
    try:
        snapshot = fetch_quota()
        if persist_snapshot_enabled():
            result = persist_snapshot(snapshot)
        else:
            result = {"persisted": False, "reason": "persistence_credentials_not_configured"}
    except Exception as exc:  # provider boundary must fail loudly
        print(f"provider worker failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({"snapshot": snapshot, "persistence": result}, separators=(",", ":")))
    return 0


def persist_snapshot_enabled() -> bool:
    import os
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


if __name__ == "__main__":
    raise SystemExit(main())
