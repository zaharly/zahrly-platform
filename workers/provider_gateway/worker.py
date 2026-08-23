#!/usr/bin/env python3
"""Provider gateway worker entrypoint.

The worker owns provider calls/retries and hands normalized observations to the
canonical persistence boundary. It is not a cron implementation and does not
perform historical allocation itself.
"""
from __future__ import annotations

import json
import sys

from .api_football import fetch_quota


def main() -> int:
    try:
        snapshot = fetch_quota()
    except Exception as exc:  # provider boundary must fail loudly
        print(f"provider quota fetch failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(snapshot, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
