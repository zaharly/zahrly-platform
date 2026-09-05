from workers.prediction_engine.drift_gate import evaluate_drift


def test_drift_gate_requires_evidence():
    assert evaluate_drift(rows=[])["status"] == "FAIL"


def test_drift_gate_accepts_ok_database_status():
    result = evaluate_drift(rows=[{"metric_name": "LogLoss", "status": "OK", "baseline_value": 1.0, "current_value": 1.005}])
    assert result["status"] == "PASS"


def test_drift_gate_blocks_warn_and_alert():
    assert evaluate_drift(rows=[{"metric_name": "RPS", "status": "WARN", "baseline_value": 1.0, "current_value": 1.0}])["status"] == "FAIL"
    assert evaluate_drift(rows=[{"metric_name": "RPS", "status": "ALERT", "baseline_value": 1.0, "current_value": 1.02}])["status"] == "FAIL"
