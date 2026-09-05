from __future__ import annotations

from typing import Mapping, Any


def evaluate_market_gate(summary: Mapping[str, Any]) -> dict[str, Any]:
    market = summary.get("market", {})
    n = int(market.get("n") or 0)
    coverage = float(market.get("coverage") or 0.0)
    brier = market.get("brier")
    log_loss = market.get("log_loss")
    if n <= 0 or coverage <= 0:
        return {"status": "FAIL", "reason": "NO_COMMON_LEAKAGE_SAFE_MARKET_OOS", "sample_count": n, "coverage": coverage}
    if brier is None or log_loss is None:
        return {"status": "FAIL", "reason": "INCOMPLETE_MARKET_METRICS", "sample_count": n, "coverage": coverage}
    return {"status": "PASS", "reason": "COMMON_MARKET_OOS_AVAILABLE", "sample_count": n, "coverage": coverage, "brier": float(brier), "log_loss": float(log_loss)}
