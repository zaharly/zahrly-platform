from __future__ import annotations

from typing import Mapping, Any


def evaluate_drift(*, rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Evaluate persisted drift evidence using the database status contract.

    The 1X2 architecture does not define a universal numeric promotion threshold
    for fold-to-fold drift. Therefore this gate does not invent one: upstream drift
    computation owns OK/WARN/ALERT/UNKNOWN classification, and promotion accepts
    only fully OK evidence.
    """
    if not rows:
        return {"status": "FAIL", "reason": "NO_DRIFT_EVIDENCE", "checks": []}

    checks = []
    for row in rows:
        raw = str(row.get("status", "UNKNOWN")).upper()
        gate_status = "PASS" if raw == "OK" else "FAIL"
        checks.append({
            "metric_name": str(row.get("metric_name", "")),
            "source_status": raw,
            "status": gate_status,
            "baseline": row.get("baseline_value"),
            "current": row.get("current_value"),
            "metadata": row.get("metadata", {}),
        })

    passed = all(c["status"] == "PASS" for c in checks)
    return {
        "status": "PASS" if passed else "FAIL",
        "checks": checks,
        "reason": "ALL_DRIFT_METRICS_OK" if passed else "DRIFT_EVIDENCE_NOT_CLEAR",
    }
