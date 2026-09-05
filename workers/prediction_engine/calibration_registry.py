from __future__ import annotations

from dataclasses import asdict
from .calibration import CalibrationFit

CALIBRATION_POLICY_VERSION = "temperature-1x2-v1"


def calibration_payload(fit: CalibrationFit) -> dict:
    payload = asdict(fit)
    payload["policy_version"] = CALIBRATION_POLICY_VERSION
    payload["temperature"] = float(fit.temperature)
    return payload
