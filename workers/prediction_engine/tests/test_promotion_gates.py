from workers.prediction_engine.promotion_gates import (
    evaluate_benchmark_gate,
    evaluate_calibration_safety,
    final_promotion_gate,
)


def test_benchmark_gate_uses_documented_relative_thresholds():
    summary = {
        "oos_n": 10000,
        "complete_oos_seasons": 3,
        "model": {"brier": 0.63, "log_loss": 1.00, "rps": 0.21},
        "empirical_baseline": {"brier": 0.65, "log_loss": 1.03, "rps": 0.22},
    }
    result = evaluate_benchmark_gate(summary)
    assert result["status"] == "PASS"


def test_calibration_safety_passes_with_small_regression_below_limit():
    assert evaluate_calibration_safety(candidate_ece=0.010, reference_ece=0.005)["status"] == "PASS"


def test_calibration_safety_fails_above_limit():
    assert evaluate_calibration_safety(candidate_ece=0.020, reference_ece=0.005)["status"] == "FAIL"


def test_final_gate_requires_all_hard_gates():
    args = {
        "benchmark": {"status": "PASS"},
        "calibration": {"status": "PASS"},
        "drift": {"status": "PASS"},
        "shadow": {"status": "PASS"},
        "market": {"status": "DEFERRED"},
    }
    assert final_promotion_gate(**args)["status"] == "PASS"

    args["drift"] = {"status": "FAIL"}
    assert final_promotion_gate(**args)["status"] == "FAIL"
