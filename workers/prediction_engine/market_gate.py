from __future__ import annotations

from typing import Mapping, Any


def evaluate_market_gate(summary: Mapping[str, Any]) -> dict[str, Any]:
    market = summary.get("market", {})
    n = int(market.get("n") or 0)
    coverage = float(market.get("coverage") or 0.0)
    brier = market.get("brier")
    log_loss = market.get("log_loss")
    benchmark_type = market.get("benchmark_type")

    if n > 0 and coverage > 0 and brier is not None and log_loss is not None:
        return {
            "status": "PASS",
            "reason": "COMMON_MARKET_OOS_AVAILABLE",
            "sample_count": n,
            "coverage": coverage,
            "brier": float(brier),
            "log_loss": float(log_loss),
            "benchmark_type": benchmark_type or "MARKET",
            "fallback": False,
        }

    fallback = summary.get("market_fallback", {})
    fn = int(fallback.get("n") or fallback.get("sample_count") or 0)
    fc = float(fallback.get("coverage") or 0.0)
    fb = fallback.get("brier")
    fl = fallback.get("log_loss")
    ft = str(fallback.get("benchmark_type") or "")
    if fn > 0 and fc > 0 and fb is not None and fl is not None and ft == "HISTORICAL_CALIBRATED_BASE_RATE":
        return {
            "status": "PASS",
            "reason": "CANONICAL_MARKET_FALLBACK",
            "sample_count": fn,
            "coverage": fc,
            "brier": float(fb),
            "log_loss": float(fl),
            "benchmark_type": ft,
            "fallback": True,
        }

    return {
        "status": "FAIL",
        "reason": "NO_LEAKAGE_SAFE_MARKET_BENCHMARK",
        "sample_count": n,
        "coverage": coverage,
        "fallback": False,
    }
