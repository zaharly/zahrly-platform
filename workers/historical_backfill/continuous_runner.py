#!/usr/bin/env python3
"""Continuous runner for the canonical historical backfill worker.

The runner owns only worker lifetime. Claiming, idempotency, quota safety,
S3 writes and finalization remain in worker.py. A retryable job must never
stall an entire worker slot: the queue may contain other ready jobs.
"""
from __future__ import annotations

import json
import os
import time

from workers.historical_backfill import worker


def main() -> int:
    # Four independent GitHub matrix slots use 12/min each = 48/min total.
    worker.LIMITER.limit = max(1, int(os.getenv("WORKER_RATE_LIMIT_PER_MINUTE", "12")))
    idle_sleep = max(1, int(os.getenv("IDLE_SLEEP_SECONDS", "10")))
    max_runtime = max(60, int(os.getenv("MAX_RUNTIME_SECONDS", "2700")))
    started = time.monotonic()
    results = []

    conn = worker.connect()
    try:
        while time.monotonic() - started < max_runtime:
            result = worker.run_one(conn)
            results.append(result)

            if result.get("processed") is not True:
                # Queue may be temporarily empty because another transaction
                # is committing or because every retryable job is in backoff.
                # Keep the slot alive instead of exiting the workflow.
                time.sleep(idle_sleep)
                continue

            # A RETRYABLE result belongs to this job only. Do NOT sleep for its
            # backoff here: there may be thousands of independent QUEUED jobs.
            # worker.claim_job() will naturally skip this job until next_retry_at.
            continue

        processed = [r for r in results if r.get("processed")]
        failed = [r for r in processed if r.get("status") == "FAILED"]
        print(json.dumps({
            "processed": processed,
            "count": len(processed),
            "runtime_seconds": round(time.monotonic() - started, 1),
            "idle": not processed,
            "failed": len(failed),
        }, separators=(",", ":")), flush=True)
        return 0 if not failed else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
