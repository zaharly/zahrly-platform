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
    value: float | int | bool | None
    threshold: float | int | bool | None
    reason: str


def _metric_gain(baseline: float | None, candidate: float | None) -> float | None:
    if baseline is None or candidate is None or baseline <= 0:
        return None
    return (baseline - candidate) / baseline


def evaluate_benchmark_gate(summary: Mapping[str, Any]) -> dict[str, Any]:
    model = summary.get("model", {})
    baseline = summary.get("empirical_baseline", {})
    history = summary.get("history_gate", {})
    n = int(summary.get("oos_n") or model.get("n") or 0)

    # Do not infer observed season coverage from the configured minimum.
    # The upstream history gate must explicitly attest to complete OOS seasons.
    seasons_value = summary.get("complete_oos_seasons", history.get("complete_oos_seasons"))
    seasons = int(seasons_value) if seasons_value is not None else None
    seasons_pass = bool(history.get("oos_seasons_pass")) if "oos_seasons_pass" in history else seasons is not None and seasons >= MIN_COMPLETE_OOS_SEASONS
    if seasons is None and seasons_pass:
        seasons = MIN_COMPLETE_OOS_SEASONS

    bg = _metric_gain(baseline.get("brier"), model.get("brier"))
    lg = _metric_gain(baseline.get("log_loss"), model.get("log_loss"))
    rg = _metric_gain(baseline.get("rps"), model.get("rps"))

    gates = [
        GateResult("oos_sample", n >= MIN_OOS_PREDICTIONS, "PASS" if n >= MIN_OOS_PREDICTIONS else "FAIL", n, MIN_OOS_PREDICTIONS, "OOS sample size"),
        GateResult("season_coverage", seasons_pass, "PASS" if seasons_pass else "FAIL", seasons, MIN_COMPLETE_OOS_SEASONS, "complete OOS seasons attestation"),
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
        # Missing/deferred market evidence is a blocker, never a pass.
        "market": market.get("status") == "PASS",
    }
    return {"status": "PASS" if all(parts.values()) else "FAIL", "gates": parts}
