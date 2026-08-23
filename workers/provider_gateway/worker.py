#!/usr/bin/env python3
"""Provider gateway worker entrypoint.

The worker owns provider calls/retries and hands normalized observations to the
canonical persistence boundary. It is not a cron implementation and does not
perform historical allocation itself.
"""
from __future__ import annotations

import argparse
import json
import sys

from .api_football import fetch_quota


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--persist", action="store_true", help="persist the normalized snapshot through Supabase")
    args = parser.parse_args()

    try:
        snapshot = fetch_quota()
        if args.persist:
            from .supabase_persistence import persist_snapshot
            persistence_result = persist_snapshot(snapshot)
            snapshot["persisted"] = True
            snapshot["persistence_result"] = persistence_result
    except Exception as exc:  # provider/persistence boundary must fail loudly
        print(f"provider quota worker failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(snapshot, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
