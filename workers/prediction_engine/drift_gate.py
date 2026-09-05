from __future__ import annotations

from typing import Mapping, Any


def evaluate_drift(*, rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Evaluate persisted drift evidence using the database status contract.

    DB statuses are OK/WARN/ALERT/UNKNOWN. Only OK evidence is promotion-safe.
    Legacy PASS/FAIL rows are accepted for compatibility with earlier tests.
    """
    if not rows:
        return {"status": "FAIL", "reason": "NO_DRIFT_EVIDENCE", "checks": []}

    checks = []
    for row in rows:
        raw = str(row.get("status", "UNKNOWN")).upper()
        if raw == "PASS":
            gate_status = "PASS"
        elif raw == "OK":
            gate_status = "PASS"
        elif raw in {"WARN", "ALERT", "FAIL", "UNKNOWN"}:
            gate_status = "FAIL"
        else:
            gate_status = "FAIL"
        checks.append({
            "metric_name": str(row.get("metric_name", "")),
            "source_status": raw,
            "status": gate_status,
            "baseline": row.get("baseline_value"),
            "current": row.get("current_value"),
        })

    passed = all(c["status"] == "PASS" for c in checks)
    return {"status": "PASS" if passed else "FAIL", "checks": checks}
