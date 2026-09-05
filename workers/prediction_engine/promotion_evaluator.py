from __future__ import annotations

from typing import Mapping, Any
from .promotion_gates import evaluate_benchmark_gate, evaluate_calibration_safety
from .drift_gate import evaluate_drift
from .market_gate import evaluate_market_gate


def evaluate_promotion(*, summary: Mapping[str, Any], reference_ece: float | None, drift_rows: list[Mapping[str, Any]], shadow: Mapping[str, Any]) -> dict[str, Any]:
    benchmark = evaluate_benchmark_gate(summary)
    candidate_ece = summary.get("model", {}).get("ece")
    calibration = evaluate_calibration_safety(candidate_ece=candidate_ece, reference_ece=reference_ece)
    drift = evaluate_drift(rows=drift_rows)
    market = evaluate_market_gate(summary)
    shadow_status = str(shadow.get("status", "FAIL")).upper()
    shadow_gate = {"status": "PASS" if shadow_status == "PASS" else "FAIL", "source": "shadow_evaluations"}
    gates = {"benchmark": benchmark, "calibration": calibration, "drift": drift, "market": market, "shadow": shadow_gate}
    hard_pass = all(x["status"] == "PASS" for x in (benchmark, calibration, drift, market, shadow_gate))
    return {
        "status": "PASS" if hard_pass else "FAIL",
        "promotion_eligible": hard_pass,
        "gates": gates,
        "blocking_reasons": [name for name, result in gates.items() if result.get("status") != "PASS"],
    }
