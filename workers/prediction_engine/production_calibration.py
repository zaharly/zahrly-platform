from __future__ import annotations

import os
from typing import Sequence
import psycopg
from psycopg.rows import dict_row
from .calibration import apply_temperature

DEFAULT_POLICY_VERSION = "temperature-1x2-v1"


def load_prediction_calibration() -> tuple[str, float]:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        return DEFAULT_POLICY_VERSION, 1.0
    try:
        with psycopg.connect(url, row_factory=dict_row, connect_timeout=10, sslmode="require") as conn:
            row = conn.execute(
                """
                select version, payload
                from public.policy_versions
                where policy_type='prediction_calibration'
                  and version=%s
                limit 1
                """,
                (DEFAULT_POLICY_VERSION,),
            ).fetchone()
    except Exception:
        return DEFAULT_POLICY_VERSION, 1.0
    payload = row["payload"] if row else {}
    try:
        temperature = float(payload.get("temperature", 1.0))
    except (TypeError, ValueError):
        temperature = 1.0
    status = str(payload.get("status", "IDENTITY")).upper()
    if status not in {"VALIDATED", "ACTIVE"} or not 0.60 <= temperature <= 1.00:
        temperature = 1.0
    return str(row["version"]) if row else DEFAULT_POLICY_VERSION, temperature


def calibrate_1x2(probs: Sequence[float]) -> tuple[float, float, float]:
    _, temperature = load_prediction_calibration()
    return apply_temperature(probs, temperature)
