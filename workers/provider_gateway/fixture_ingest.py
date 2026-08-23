#!/usr/bin/env python3
"""Provider fixture ingestion worker.

Owns provider calls and hands normalized fixtures to the private canonical
persistence boundary. It does not run prediction logic or cron scheduling.
"""
from __future__ import annotations

import json
import os
import sys

from .api_football import fetch_upcoming_fixtures
from .supabase_fixture_persistence import persist_fixture


def main() -> int:
    try:
        fixtures = fetch_upcoming_fixtures(os.environ.get("FIXTURE_DATE"))
        if not fixtures:
            print(json.dumps({"persisted": False, "reason": "no_upcoming_fixtures"}))
            return 0

        results = [persist_fixture(fixture) for fixture in fixtures]
        print(json.dumps({"persisted": True, "fixtures": results}, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"fixture ingestion failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
