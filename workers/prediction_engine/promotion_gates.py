from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Any

MIN_OOS_PREDICTIONS = 3000
MIN_COMPLETE_OOS_SEASONS = 3
BRIER_MIN_RELATIVE_GAIN = 0.03
LOGLOSS_MIN_RELATIVE_GAIN = 0.02
RPS_MIN_RELATIVE_GAIN = 0.02
ECE_MAX_ABSOLUTE_REGRESSION = 0.01


@dataclass(frozen=True)
class GateResult:
    name: str
    passed: bool
    status: str
    value: float | int | None
    threshold: float | int | None
    reason: str


def _metric_gain(baseline: float | None, candidate: float | None) -> float | None:
    if baseline is None or candidate is None or baseline <= 0:
        return None
    return (baseline - candidate) / baseline


def evaluate_benchmark_gate(summary: Mapping[str, Any]) -> dict[str, Any]:
    model = summary.get("model", {})
    baseline = summary.get("empirical_baseline", {})
    n = int(summary.get("oos_n") or model.get("n") or 0)
    seasons = int(summary.get("complete_oos_seasons") or summary.get("history_gate", {}).get("complete_oos_seasons") or 0)

    bg = _metric_gain(baseline.get("brier"), model.get("brier"))
    lg = _metric_gain(baseline.get("log_loss"), model.get("log_loss"))
    rg = _metric_gain(baseline.get("rps"), model.get("rps"))

    gates = [
        GateResult("oos_sample", n >= MIN_OOS_PREDICTIONS, "PASS" if n >= MIN_OOS_PREDICTIONS else "FAIL", n, MIN_OOS_PREDICTIONS, "OOS sample size"),
        GateResult("season_coverage", seasons >= MIN_COMPLETE_OOS_SEASONS, "PASS" if seasons >= MIN_COMPLETE_OOS_SEASONS else "FAIL", seasons, MIN_COMPLETE_OOS_SEASONS, "complete OOS seasons"),
        GateResult("brier_improvement", bg is not None and bg >= BRIER_MIN_RELATIVE_GAIN, "PASS" if bg is not None and bg >= BRIER_MIN_RELATIVE_GAIN else "FAIL", bg, BRIER_MIN_RELATIVE_GAIN, "relative Brier improvement"),
        GateResult("logloss_improvement", lg is not None and lg >= LOGLOSS_MIN_RELATIVE_GAIN, "PASS" if lg is not None and lg >= LOGLOSS_MIN_RELATIVE_GAIN else "FAIL", lg, LOGLOSS_MIN_RELATIVE_GAIN, "relative LogLoss improvement"),
        GateResult("rps_improvement", rg is not None and rg >= RPS_MIN_RELATIVE_GAIN, "PASS" if rg is not None and rg >= RPS_MIN_RELATIVE_GAIN else "FAIL", rg, RPS_MIN_RELATIVE_GAIN, "relative RPS improvement"),
    ]

    return {
        "status": "PASS" if all(g.passed for g in gates) else "FAIL",
        "gates": [g.__dict__ for g in gates],
        "gains": {"brier": bg, "log_loss": lg, "rps": rg},
        "thresholds": {
            "brier_relative": BRIER_MIN_RELATIVE_GAIN,
            "log_loss_relative": LOGLOSS_MIN_RELATIVE_GAIN,
            "rps_relative": RPS_MIN_RELATIVE_GAIN,
            "min_oos_predictions": MIN_OOS_PREDICTIONS,
            "min_complete_oos_seasons": MIN_COMPLETE_OOS_SEASONS,
        },
    }


def evaluate_calibration_safety(*, candidate_ece: float | None, reference_ece: float | None) -> dict[str, Any]:
    if candidate_ece is None or reference_ece is None:
        return {"status": "UNKNOWN", "candidate_ece": candidate_ece, "reference_ece": reference_ece, "max_absolute_regression": ECE_MAX_ABSOLUTE_REGRESSION}
    delta = candidate_ece - reference_ece
    passed = delta <= ECE_MAX_ABSOLUTE_REGRESSION
    return {"status": "PASS" if passed else "FAIL", "candidate_ece": candidate_ece, "reference_ece": reference_ece, "absolute_delta": delta, "max_absolute_regression": ECE_MAX_ABSOLUTE_REGRESSION}


def final_promotion_gate(*, benchmark: Mapping[str, Any], calibration: Mapping[str, Any], drift: Mapping[str, Any], shadow: Mapping[str, Any], market: Mapping[str, Any]) -> dict[str, Any]:
    parts = {
        "benchmark": benchmark.get("status") == "PASS",
        "calibration": calibration.get("status") == "PASS",
        "drift": drift.get("status") == "PASS",
        "shadow": shadow.get("status") == "PASS",
        "market": market.get("status") in {"PASS", "DEFERRED"},
    }
    return {"status": "PASS" if all(parts.values()) else "FAIL", "gates": parts}
