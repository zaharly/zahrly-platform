from __future__ import annotations

from typing import Any


def normalize_distribution(values: list[float]) -> list[float]:
    clean = [max(0.0, float(v)) for v in values]
    total = sum(clean)
    if total <= 0:
        raise ValueError("invalid_distribution_mass")
    return [v / total for v in clean]


def derive_goal_markets(score_matrix: list[list[float]], max_goal_line: int = 5) -> dict[str, dict[str, Any]]:
    """Derive goal markets from the canonical joint home/away score state.

    These are deterministic projections of the score state; they are not
    independently invented probabilities and therefore preserve consistency.
    """
    if not score_matrix or any(not row for row in score_matrix):
        raise ValueError("score_matrix_missing")
    mass = sum(sum(float(v) for v in row) for row in score_matrix)
    if mass <= 0:
        raise ValueError("score_matrix_invalid")
    m = [[max(0.0, float(v)) / mass for v in row] for row in score_matrix]
    rows: dict[str, dict[str, Any]] = {}

    home = sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x > y)
    draw = sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x == y)
    away = sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x < y)
    rows.update({
        "1x2_home": {"family": "1X2", "outcome": "HOME_WIN", "probability": home, "state": "PREDICTED_ONLY"},
        "1x2_draw": {"family": "1X2", "outcome": "DRAW", "probability": draw, "state": "PREDICTED_ONLY"},
        "1x2_away": {"family": "1X2", "outcome": "AWAY_WIN", "probability": away, "state": "PREDICTED_ONLY"},
        "double_chance_1x": {"family": "DOUBLE_CHANCE", "outcome": "1X", "probability": home + draw, "state": "PREDICTED_ONLY"},
        "double_chance_x2": {"family": "DOUBLE_CHANCE", "outcome": "X2", "probability": draw + away, "state": "PREDICTED_ONLY"},
        "double_chance_12": {"family": "DOUBLE_CHANCE", "outcome": "12", "probability": home + away, "state": "PREDICTED_ONLY"},
        "btts_yes": {"family": "BTTS", "outcome": "YES", "probability": sum(m[x][y] for x in range(1, len(m)) for y in range(1, len(m[x]))), "state": "PREDICTED_ONLY"},
    })
    rows["btts_no"] = {"family": "BTTS", "outcome": "NO", "probability": 1.0 - rows["btts_yes"]["probability"], "state": "PREDICTED_ONLY"}

    for line in (0.5, 1.5, 2.5, 3.5, 4.5):
        over = sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x + y > line)
        key = str(line).replace(".", "_")
        rows[f"goals_over_{key}"] = {"family": "GOALS_OU", "line": line, "outcome": "OVER", "probability": over, "state": "PREDICTED_ONLY"}
        rows[f"goals_under_{key}"] = {"family": "GOALS_OU", "line": line, "outcome": "UNDER", "probability": 1.0 - over, "state": "PREDICTED_ONLY"}

    for side, axis in (("home", 0), ("away", 1)):
        for line in (0.5, 1.5, 2.5, 3.5):
            threshold = line
            over = 0.0
            for x in range(len(m)):
                for y in range(len(m[x])):
                    score = x if axis == 0 else y
                    if score > threshold:
                        over += m[x][y]
            key = str(line).replace(".", "_")
            rows[f"{side}_goals_over_{key}"] = {"family": "TEAM_GOALS_OU", "line": line, "outcome": "OVER", "probability": over, "state": "PREDICTED_ONLY"}
            rows[f"{side}_goals_under_{key}"] = {"family": "TEAM_GOALS_OU", "line": line, "outcome": "UNDER", "probability": 1.0 - over, "state": "PREDICTED_ONLY"}

    # Correct-score probabilities are useful for analysis and preserve the same state.
    for x in range(min(max_goal_line, len(m) - 1) + 1):
        for y in range(min(max_goal_line, len(m[x]) - 1) + 1):
            rows[f"correct_score_{x}_{y}"] = {"family": "CORRECT_SCORE", "score": f"{x}-{y}", "probability": m[x][y], "state": "PREDICTED_ONLY"}
    return rows


def derive_count_markets(atom: dict[str, Any] | None, family: str, prefix: str, lines: tuple[float, ...]) -> dict[str, dict[str, Any]]:
    """Project a validated independent count state (corners/cards).

    The state must be explicitly supplied by a trained artifact. Missing state
    is abstention, never a league-mean or zero-valued silent fallback.
    """
    if not atom:
        return {}
    distribution = atom.get("distribution")
    if not isinstance(distribution, list) or not distribution:
        return {}
    dist = normalize_distribution([float(v) for v in distribution])
    out: dict[str, dict[str, Any]] = {}
    for line in lines:
        over = sum(dist[k] for k in range(len(dist)) if k > line)
        key = str(line).replace(".", "_")
        out[f"{prefix}_over_{key}"] = {"family": family, "line": line, "outcome": "OVER", "probability": over, "state": "PREDICTED_ONLY"}
        out[f"{prefix}_under_{key}"] = {"family": family, "line": line, "outcome": "UNDER", "probability": 1.0 - over, "state": "PREDICTED_ONLY"}
    return out
