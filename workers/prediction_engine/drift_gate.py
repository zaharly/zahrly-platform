from __future__ import annotations

from typing import Mapping, Any


def evaluate_drift(*, rows: list[Mapping[str, Any]], max_relative_regression: float = 0.01) -> dict[str, Any]:
    """Evaluate candidate drift against reference metrics.

    Rows must contain metric_name, baseline_value, current_value. A metric passes
    when the current value does not regress by more than max_relative_regression
    for lower-is-better metrics (Brier/LogLoss/RPS/ECE).
    """
    if not rows:
        return {"status": "FAIL", "reason": "NO_DRIFT_EVIDENCE", "checks": []}

    lower_is_better = {"brier", "logloss", "rps", "ece", "log_loss"}
    checks = []
    for row in rows:
        name = str(row.get("metric_name", "")).lower()
        base = row.get("baseline_value")
        current = row.get("current_value")
        if name not in lower_is_better or base is None or current is None or float(base) <= 0:
            checks.append({"metric_name": name, "status": "UNKNOWN"})
            continue
        relative_regression = (float(current) - float(base)) / float(base)
        passed = relative_regression <= max_relative_regression
        checks.append({
            "metric_name": name,
            "status": "PASS" if passed else "FAIL",
            "baseline": float(base),
            "current": float(current),
            "relative_regression": relative_regression,
            "max_relative_regression": max_relative_regression,
        })
    status = "PASS" if checks and all(c["status"] == "PASS" for c in checks) else "FAIL"
    return {"status": status, "checks": checks, "max_relative_regression": max_relative_regression}
