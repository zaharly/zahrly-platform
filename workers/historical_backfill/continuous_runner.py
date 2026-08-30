#!/usr/bin/env python3
"""Continuous runner for the canonical historical backfill worker.

A provider-rate-limit on one job must not terminate the whole worker slot.
The underlying worker remains the owner of claiming, S3 writes and finalization;
this runner only keeps the slot alive and backs off between retryable outcomes.
"""
from __future__ import annotations

import json
import os
import time

from workers.historical_backfill import worker


def main() -> int:
    worker.LIMITER.limit = int(os.getenv("WORKER_RATE_LIMIT_PER_MINUTE", "12"))
    batch_size = max(1, min(int(os.getenv("BATCH_SIZE", "25")), 100))
    idle_sleep = max(1, int(os.getenv("IDLE_SLEEP_SECONDS", "10")))
    retry_sleep = max(1, int(os.getenv("RETRY_SLEEP_SECONDS", "30")))
    results = []

    conn = worker.connect()
    try:
        for _ in range(batch_size):
            result = worker.run_one(conn)
            results.append(result)
            if result.get("processed") is not True:
                time.sleep(idle_sleep)
                break
            if result.get("status") == "RETRYABLE":
                # Do not spin on a rate-limit/transient failure. The DB retry
                # timestamp remains authoritative for the next claim.
                time.sleep(max(retry_sleep, int(result.get("retry_after", 0) or 0)))
                continue
        print(json.dumps({"processed": [r for r in results if r.get("processed")], "count": len(results)}, separators=(",", ":")), flush=True)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
