#!/usr/bin/env python3
"""Production entrypoint for the canonical historical worker.

Quota gating, retry/yield behavior, lease cleanup, and finalization are owned
by canonical_runner. This thin entrypoint intentionally adds no second quota
or exception layer so the worker has exactly one execution contract.
"""
from __future__ import annotations

from workers.historical_backfill import canonical_runner


if __name__ == "__main__":
    raise SystemExit(canonical_runner.main())
