from workers.prediction_engine.drift_gate import evaluate_drift
from workers.prediction_engine.market_gate import evaluate_market_gate
from workers.prediction_engine.promotion_gates import evaluate_calibration_safety


def test_drift_ok_only_passes():
    assert evaluate_drift(rows=[{"metric_name": "LogLoss", "status": "OK"}])["status"] == "PASS"
    assert evaluate_drift(rows=[{"metric_name": "RPS", "status": "UNKNOWN"}])["status"] == "FAIL"


def test_market_historical_fallback_passes():
    summary = {
        "market": {"n": 0, "coverage": 0},
        "market_fallback": {
            "n": 29679,
            "coverage": 1,
            "brier": 0.6504421464524763,
            "log_loss": 1.076149106950931,
            "benchmark_type": "HISTORICAL_CALIBRATED_BASE_RATE",
        },
    }
    result = evaluate_market_gate(summary)
    assert result["status"] == "PASS"
    assert result["fallback"] is True


def test_calibration_guardrail():
    assert evaluate_calibration_safety(candidate_ece=0.014, reference_ece=0.005)["status"] == "PASS"
    assert evaluate_calibration_safety(candidate_ece=0.016, reference_ece=0.005)["status"] == "FAIL"
