from __future__ import annotations

from dataclasses import dataclass
from math import exp, lgamma, log


@dataclass(frozen=True)
class DixonColesPolicy:
    decay_half_life_days: float = 180.0
    home_advantage: float = 0.15
    rho: float = -0.10
    max_goals: int = 10


def poisson_log_pmf(goals: int, lam: float) -> float:
    if goals < 0 or lam <= 0.0:
        raise ValueError("invalid Poisson inputs")
    return goals * log(lam) - lam - lgamma(goals + 1.0)


def dc_tau(home_goals: int, away_goals: int, rho: float, home_lambda: float, away_lambda: float) -> float:
    if home_goals == 0 and away_goals == 0:
        return 1.0 - home_lambda * away_lambda * rho
    if home_goals == 0 and away_goals == 1:
        return 1.0 + home_lambda * rho
    if home_goals == 1 and away_goals == 0:
        return 1.0 + away_lambda * rho
    if home_goals == 1 and away_goals == 1:
        return 1.0 - rho
    return 1.0


def probability_matrix(home_lambda: float, away_lambda: float, rho: float, max_goals: int = 10) -> list[list[float]]:
    raw = []
    total = 0.0
    for h in range(max_goals + 1):
        row = []
        for a in range(max_goals + 1):
            p = exp(poisson_log_pmf(h, home_lambda) + poisson_log_pmf(a, away_lambda))
            p *= max(0.0, dc_tau(h, a, rho, home_lambda, away_lambda))
            row.append(p)
            total += p
        raw.append(row)
    if total <= 0.0:
        raise ArithmeticError("invalid Dixon-Coles probability mass")
    return [[p / total for p in row] for row in raw]


def result_probabilities(matrix: list[list[float]]) -> tuple[float, float, float]:
    home = draw = away = 0.0
    for h, row in enumerate(matrix):
        for a, p in enumerate(row):
            if h > a:
                home += p
            elif h == a:
                draw += p
            else:
                away += p
    return home, draw, away


def time_decay_weight(observed_at_days_before_cutoff: float, half_life_days: float) -> float:
    if observed_at_days_before_cutoff < 0:
        raise ValueError("future observation is not eligible")
    if half_life_days <= 0:
        raise ValueError("half_life_days must be positive")
    return exp(-log(2.0) * observed_at_days_before_cutoff / half_life_days)
