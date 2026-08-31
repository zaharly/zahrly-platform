#!/usr/bin/env python3
"""Safe production entrypoint for the canonical historical worker.

The canonical runner must not spin forever while the shared provider quota is
exhausted. Convert a quota-wait database error into a normal retryable failure
so the current attempt is closed and the job is re-queued by the normal
recovery path.
"""
from __future__ import annotations

from workers.historical_backfill import canonical_runner


class QuotaDeferred(Exception):
    pass


_original_db_exec = canonical_runner._db_exec


def _db_exec(conn, sql: str, args):
    try:
        return _original_db_exec(conn, sql, args)
    except Exception as exc:
        message = str(exc)
        if "BACKFILL_OR_RATE_QUOTA_EXHAUSTED" in message or "PROVIDER_RATE_GATE_UNTIL" in message:
            raise QuotaDeferred("PROVIDER_QUOTA_DEFERRED") from exc
        raise


canonical_runner._db_exec = _db_exec

if __name__ == "__main__":
    raise SystemExit(canonical_runner.main())
