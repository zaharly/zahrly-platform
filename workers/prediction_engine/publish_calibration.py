from __future__ import annotations

import json
import os
import psycopg
from psycopg.rows import dict_row

POLICY_TYPE = "prediction_calibration"
POLICY_VERSION = "temperature-1x2-v1"


def publish_validated_calibration(*, temperature: float, sample_count: int, validation: dict) -> bool:
    """Publish a calibrated production policy only after external walk-forward validation.

    The caller must provide validation metrics from a chronological holdout. The
    publish rule is deliberately conservative: at least 300 calibration samples,
    temperature within the production envelope, and validation must explicitly say
    that all protected proper-score gates passed.
    """
    if sample_count < 300 or not 0.60 <= float(temperature) <= 1.00:
        return False
    if validation.get("status") not in {"PASSED", "PROMOTION_ELIGIBLE"}:
        return False
    if validation.get("calibration_gate") is not True:
        return False
    if validation.get("proper_scores_gate") is not True:
        return False
    url = os.environ["SUPABASE_DB_URL"]
    payload = {
        "schema_version": "prediction-calibration-v1",
        "market_family": "1X2",
        "method": "chronological_temperature",
        "temperature": float(temperature),
        "min_calibration_samples": 300,
        "t_min": 0.60,
        "t_max": 1.00,
        "selection": "NLL_PRIMARY_WITH_ECE_GUARDRAILS",
        "status": "VALIDATED",
        "sample_count": int(sample_count),
        "validation": validation,
        "updated_at": "now",
    }
    with psycopg.connect(url, row_factory=dict_row, connect_timeout=20, sslmode="require") as conn:
        conn.execute(
            """
            insert into public.policy_versions(policy_type, version, payload)
            values (%s, %s, %s::jsonb)
            on conflict (policy_type, version) do update
            set payload = excluded.payload, created_at = now()
            """,
            (POLICY_TYPE, POLICY_VERSION, json.dumps(payload)),
        )
        conn.commit()
    return True
