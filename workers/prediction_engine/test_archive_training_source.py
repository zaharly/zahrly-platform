from __future__ import annotations

from workers.prediction_engine.archive_training_source import _extract_rows, _to_match


def test_extracts_api_football_fixture_rows() -> None:
    rows = list(_extract_rows({"response": [{"fixture": {"id": 42, "date": "2026-01-01T12:00:00+00:00"}, "teams": {"home": {"id": 1}, "away": {"id": 2}}, "goals": {"home": 2, "away": 1}, "status": {"short": "FT"}}]}))
    assert len(rows) == 1
    match = _to_match(rows[0])
    assert match is not None
    assert match.match_id == "42"
    assert match.home_goals == 2
    assert match.away_goals == 1


def test_extracts_nested_archive_wrapper() -> None:
    rows = list(_extract_rows({"payload": {"data": {"response": [{"fixture": {"id": 43, "date": "2026-01-02T12:00:00Z", "status": {"short": "FT"}}, "teams": {"home": {"id": 10}, "away": {"id": 20}}, "score": {"fulltime": {"home": "0", "away": "3"}}}]}}}))
    assert len(rows) == 1
    match = _to_match(rows[0])
    assert match is not None
    assert match.match_id == "43"
    assert match.home_goals == 0
    assert match.away_goals == 3


def test_unsettled_archive_row_is_not_training_data() -> None:
    match = _to_match({"fixture": {"id": 44, "date": "2026-01-01T12:00:00+00:00"}, "teams": {"home": {"id": 1}, "away": {"id": 2}}, "goals": {"home": None, "away": None}, "status": {"short": "NS"}})
    assert match is None


def test_canonical_row_shape_is_supported() -> None:
    match = _to_match({"provider_fixture_id": 45, "played_at": "2026-01-01T12:00:00+00:00", "home_team_id": "home", "away_team_id": "away", "home_goals": 0, "away_goals": 0})
    assert match is not None
    assert match.match_id == "45"
