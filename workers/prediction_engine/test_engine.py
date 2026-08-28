from datetime import datetime, timedelta, timezone

from workers.prediction_engine.dixon_coles import probability_matrix, result_probabilities
from workers.prediction_engine.elo import EloPolicy, EloState, update_elo
from workers.prediction_engine.walk_forward import LeakageError, Match, run_fold


def test_dc_probabilities_sum_to_one() -> None:
    matrix = probability_matrix(1.35, 0.95, -0.08, 10)
    assert abs(sum(sum(row) for row in matrix) - 1.0) < 1e-12
    probs = result_probabilities(matrix)
    assert abs(sum(probs) - 1.0) < 1e-12


def test_elo_is_zero_sum() -> None:
    policy = EloPolicy(k_factor=20.0, home_advantage=60.0)
    h2, a2, p = update_elo(EloState(1500.0), EloState(1500.0), 2, 0, policy)
    assert h2.rating + a2.rating == 3000.0
    assert 0.0 < p < 1.0


def test_walk_forward_rejects_future_training_row() -> None:
    cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc)
    future = Match("future", cutoff + timedelta(days=1), "h", "a", 1, 0)
    test = Match("test", cutoff + timedelta(days=2), "h", "a", 0, 0)
    try:
        run_fold([future], [test], cutoff)
    except LeakageError:
        return
    raise AssertionError("future training row was accepted")


def test_walk_forward_returns_three_way_probabilities() -> None:
    cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc)
    train = [
        Match("1", cutoff - timedelta(days=60), "h", "a", 2, 0),
        Match("2", cutoff - timedelta(days=30), "a", "h", 1, 1),
    ]
    test = [Match("3", cutoff + timedelta(days=1), "h", "a", 0, 0)]
    pred = run_fold(train, test, cutoff)[0]
    assert abs(pred.p_home + pred.p_draw + pred.p_away - 1.0) < 1e-12
    assert pred.lambda_home > 0 and pred.lambda_away > 0
