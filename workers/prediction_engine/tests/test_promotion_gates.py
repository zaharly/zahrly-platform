from workers.prediction_engine.promotion_gates import evaluate_benchmark_gate, evaluate_calibration_safety, final_promotion_gate


def test_benchmark_gate_does_not_infer_season_count_from_minimum():
    summary = {
        "oos_n": 10000,
        "history_gate": {"min_complete_oos_seasons": 3, "oos_seasons_pass": False},
        "model": {"brier": 0.63, "log_loss": 1.00, "rps": 0.21},
        "empirical_baseline": {"brier": 0.65, "log_loss": 1.03, "rps": 0.22},
    }
    assert evaluate_benchmark_gate(summary)["status"] == "FAIL"


def test_benchmark_gate_accepts_explicit_season_attestation():
    summary = {
        "oos_n": 10000,
        "history_gate": {"min_complete_oos_seasons": 3, "oos_seasons_pass": True},
        "model": {"brier": 0.63, "log_loss": 1.00, "rps": 0.21},
        "empirical_baseline": {"brier": 0.65, "log_loss": 1.03, "rps": 0.22},
    }
    assert evaluate_benchmark_gate(summary)["status"] == "PASS"


def test_calibration_safety_passes_with_small_regression_below_limit():
    assert evaluate_calibration_safety(candidate_ece=0.010, reference_ece=0.005)["status"] == "PASS"


def test_calibration_safety_fails_above_limit():
    assert evaluate_calibration_safety(candidate_ece=0.020, reference_ece=0.005)["status"] == "FAIL"


def test_final_gate_does_not_treat_deferred_market_as_pass():
    args = {
        "benchmark": {"status": "PASS"},
        "calibration": {"status": "PASS"},
        "drift": {"status": "PASS"},
        "shadow": {"status": "PASS"},
        "market": {"status": "DEFERRED"},
    }
    assert final_promotion_gate(**args)["status"] == "FAIL"

    args["market"] = {"status": "PASS"}
    assert final_promotion_gate(**args)["status"] == "PASS"
