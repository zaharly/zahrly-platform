from __future__ import annotations

from dataclasses import dataclass
from math import pow


@dataclass(frozen=True)
class EloPolicy:
    initial_rating: float = 1500.0
    k_factor: float = 20.0
    home_advantage: float = 60.0
    rating_scale: float = 400.0


@dataclass
class EloState:
    rating: float = 1500.0
    rating_deviation: float = 350.0
    volatility: float = 0.06


def expected_score(home_rating: float, away_rating: float, policy: EloPolicy) -> float:
    diff = (home_rating + policy.home_advantage) - away_rating
    return 1.0 / (1.0 + pow(10.0, -diff / policy.rating_scale))


def update_elo(home: EloState, away: EloState, home_goals: int, away_goals: int, policy: EloPolicy) -> tuple[EloState, EloState, float]:
    if home_goals < 0 or away_goals < 0:
        raise ValueError("goals must be non-negative")
    actual_home = 1.0 if home_goals > away_goals else 0.0 if home_goals < away_goals else 0.5
    exp_home = expected_score(home.rating, away.rating, policy)
    delta = policy.k_factor * (actual_home - exp_home)
    return EloState(home.rating + delta, home.rating_deviation, home.volatility), EloState(away.rating - delta, away.rating_deviation, away.volatility), exp_home
