#!/usr/bin/env python3
"""Continuous runner for the canonical historical backfill worker.

A provider-rate-limit on one job must not terminate the whole worker slot.
Each slot keeps claiming independent jobs until the queue is idle or the
configured runtime budget is reached. The underlying worker remains the owner
of claiming, S3 writes and finalization; this runner only controls lifetime
and backoff.
"""
from __future__ import annotations

import json
import os
import time

from workers.historical_backfill import worker


def main() -> int:
    worker.LIMITER.limit = max(1, int(os.getenv("WORKER_RATE_LIMIT_PER_MINUTE", "12")))
    idle_sleep = max(1, int(os.getenv("IDLE_SLEEP_SECONDS", "10")))
    retry_sleep = max(1, int(os.getenv("RETRY_SLEEP_SECONDS", "30")))
    max_runtime = max(60, int(os.getenv("MAX_RUNTIME_SECONDS", "2700")))
    started = time.monotonic()
    results = []

    conn = worker.connect()
    try:
        while time.monotonic() - started < max_runtime:
            result = worker.run_one(conn)
            if result.get("processed") is not True:
                # Nothing is ready now. Do not spin, but keep the slot alive
                # briefly so another transaction can make work claimable.
                time.sleep(idle_sleep)
                result = worker.run_one(conn)
                if result.get("processed") is not True:
                    break

            results.append(result)
            if result.get("status") == "RETRYABLE":
                # The DB retry timestamp is authoritative. A provider 429 or
                # transient failure must not terminate the entire worker slot.
                time.sleep(max(retry_sleep, int(result.get("retry_after", 0) or 0)))

        processed = [r for r in results if r.get("processed")]
        print(json.dumps({
            "processed": processed,
            "count": len(processed),
            "runtime_seconds": round(time.monotonic() - started, 1),
            "idle": not processed,
        }, separators=(",", ":")), flush=True)
        return 0 if not any(r.get("status") == "FAILED" for r in results) else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
