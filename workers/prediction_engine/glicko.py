from __future__ import annotations

from dataclasses import dataclass
from math import exp, log, pi, sqrt


@dataclass(frozen=True)
class GlickoPolicy:
    initial_rating: float = 1500.0
    initial_rd: float = 350.0
    initial_volatility: float = 0.06
    q: float = log(10.0) / 400.0
    rating_scale: float = 173.7178
    home_advantage: float = 0.0


@dataclass(frozen=True)
class GlickoState:
    rating: float
    rating_deviation: float
    volatility: float


def initial_state(policy: GlickoPolicy) -> GlickoState:
    return GlickoState(policy.initial_rating, policy.initial_rd, policy.initial_volatility)


def _g(rd_points: float, policy: GlickoPolicy) -> float:
    return 1.0 / sqrt(1.0 + 3.0 * (policy.q * rd_points) ** 2 / pi**2)


def _expected(mu: float, mu_opponent: float, rd_opponent_points: float, policy: GlickoPolicy) -> float:
    return 1.0 / (1.0 + exp(-_g(rd_opponent_points, policy) * (mu - mu_opponent)))


def update_pair(
    home: GlickoState,
    away: GlickoState,
    home_goals: int,
    away_goals: int,
    policy: GlickoPolicy,
) -> tuple[GlickoState, GlickoState, float]:
    if home_goals < 0 or away_goals < 0:
        raise ValueError("goals must be non-negative")

    home_score = 1.0 if home_goals > away_goals else 0.0 if home_goals < away_goals else 0.5

    def one(player: GlickoState, opponent: GlickoState, score: float, advantage: float) -> tuple[GlickoState, float]:
        mu = (player.rating - policy.initial_rating) / policy.rating_scale
        mu_o = (opponent.rating + advantage - policy.initial_rating) / policy.rating_scale
        rd = player.rating_deviation / policy.rating_scale
        rd_o = opponent.rating_deviation
        g = _g(rd_o, policy)
        e = _expected(mu, mu_o, rd_o, policy)
        v = 1.0 / max(1e-12, g * g * e * (1.0 - e))
        rd2 = 1.0 / sqrt(1.0 / (rd * rd) + 1.0 / v)
        mu2 = mu + rd2 * rd2 * g * (score - e)
        new_rating = policy.initial_rating + policy.rating_scale * mu2
        return GlickoState(new_rating, min(350.0, policy.rating_scale * rd2), player.volatility), e

    new_home, p_home = one(home, away, home_score, policy.home_advantage)
    new_away, _ = one(away, home, 1.0 - home_score, -policy.home_advantage)
    return new_home, new_away, p_home
