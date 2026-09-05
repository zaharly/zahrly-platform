from workers.prediction_engine.promotion_evaluator import evaluate_promotion


def test_reference_shadow_never_counts_as_production_incumbent():
    summary = {
        "oos_n": 10000,
        "history_gate": {"oos_seasons_pass": True},
        "model": {"brier": 0.63, "log_loss": 1.00, "rps": 0.21, "ece": 0.01},
        "empirical_baseline": {"brier": 0.65, "log_loss": 1.03, "rps": 0.22},
        "market_fallback": {"n": 10000, "coverage": 1, "brier": 0.65, "log_loss": 1.03, "benchmark_type": "HISTORICAL_CALIBRATED_BASE_RATE"},
    }
    result = evaluate_promotion(
        summary=summary,
        reference_ece=0.005,
        drift_rows=[{"metric_name": "LogLoss", "status": "OK"}],
        shadow={"status": "PASS_REFERENCE_BASELINE", "production_incumbent": False, "comparison_type": "REFERENCE_BASELINE"},
    )
    assert result["gates"]["shadow"]["status"] == "PASS"
    assert result["gates"]["incumbent"]["status"] == "FAIL"
    assert result["promotion_eligible"] is False
