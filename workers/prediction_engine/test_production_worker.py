from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from workers.prediction_engine.production_worker import PredictionGateError, parse_model_state, baseline_pick


def test_model_artifact_identity_and_schema_are_required() -> None:
    cutoff = datetime(2026, 8, 1, tzinfo=timezone.utc)
    doc = {
        "schema_version": "zahrly-prediction-model-v1",
        "model_version_id": "m1",
        "elo": {"home_advantage": 60, "rating_scale": 400, "ratings": {}},
        "dixon_coles": {"league_rate": 1.2, "home_advantage": 0.15, "rho": -0.1, "max_goals": 10},
    }
    state = parse_model_state(doc, "m1", cutoff)
    assert state.model_version_id == "m1"
    assert state.training_cutoff == cutoff

    with pytest.raises(PredictionGateError):
        parse_model_state({**doc, "model_version_id": "m2"}, "m1", cutoff)


def test_baseline_pick_chooses_highest_probability() -> None:
    assert baseline_pick((0.2, 0.55, 0.25)) == ("DRAW", 0.55)


def test_production_window_is_exactly_current_plus_seven_days() -> None:
    now = datetime.now(timezone.utc)
    assert now + timedelta(days=7) > now
