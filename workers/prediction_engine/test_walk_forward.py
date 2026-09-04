from datetime import datetime, timezone, timedelta

from workers.prediction_engine.walk_forward import Match, _team_rates
from workers.prediction_engine.dixon_coles import DixonColesPolicy


def test_team_rates_are_normalized_per_team_not_by_league_total():
    cutoff = datetime(2020, 1, 1, tzinfo=timezone.utc)
    matches = [
        Match("1", cutoff - timedelta(days=30), "A", "B", 2, 0),
        Match("2", cutoff - timedelta(days=20), "B", "C", 1, 1),
        Match("3", cutoff - timedelta(days=10), "C", "A", 0, 1),
    ]
    attack, defense, league_rate = _team_rates(matches, cutoff, DixonColesPolicy())
    assert 0.5 < league_rate < 1.5
    assert set(attack) == {"A", "B", "C"}
    assert set(defense) == {"A", "B", "C"}
    for rates in (attack, defense):
        for value in rates.values():
            assert 0.25 <= value <= 4.0
            assert value != 0.0
    assert attack["A"] != attack["B"]
