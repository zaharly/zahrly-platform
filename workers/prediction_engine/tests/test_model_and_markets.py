from workers.prediction_engine.market_derivations import derive_goal_markets, derive_count_markets
from workers.prediction_engine.prediction_model_core import predict_fixture


def test_missing_team_state_is_not_silently_defaulted():
    artifact={"elo":{"ratings":{}},"dixon_coles":{"attack":{},"defense":{},"league_rate":1.2,"rho":-0.1}}
    fixture={"home_team_id":"1","away_team_id":"2"}
    try:
        predict_fixture(fixture,artifact,0.73)
    except RuntimeError as exc:
        assert "missing_team_state" in str(exc)
    else:
        raise AssertionError("missing team state must fail closed")


def test_goal_markets_share_one_score_state():
    matrix=[[0.30,0.10],[0.20,0.40]]
    markets=derive_goal_markets(matrix)
    assert abs(markets["1x2_home"]["probability"]+markets["1x2_draw"]["probability"]+markets["1x2_away"]["probability"]-1)<1e-9
    assert abs(markets["btts_yes"]["probability"]+markets["btts_no"]["probability"]-1)<1e-9
    assert abs(markets["goals_over_2_5"]["probability"]+markets["goals_under_2_5"]["probability"]-1)<1e-9
    assert abs(markets["double_chance_1x"]["probability"]-(markets["1x2_home"]["probability"]+markets["1x2_draw"]["probability"]))<1e-9


def test_missing_corners_abstain():
    assert derive_count_markets(None,"CORNERS_OU","corners",(5.5,6.5)) == {}
