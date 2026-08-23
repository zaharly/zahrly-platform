#!/usr/bin/env python3
"""Compatibility wrapper for the canonical provider worker adapter.

Provider runtime ownership lives under workers/provider_gateway. This module is
kept only for compatibility with earlier CI tooling and must not be scheduled
as a production runtime.
"""
from __future__ import annotations

import json
import sys

from workers.provider_gateway.api_football import fetch_quota


def main() -> int:
    try:
        print(json.dumps(fetch_quota(), separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"provider quota fetch failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
