from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import exp, log
from typing import Iterable, Sequence

from .dixon_coles import DixonColesPolicy, probability_matrix, result_probabilities, time_decay_weight
from .elo import EloPolicy, EloState, update_elo
from .season_resolver import normalize_season_label, season_start_year

RATE_PRIOR_WEIGHT = 8.0
RATE_FLOOR = 0.25
RATE_CEILING = 4.0


@dataclass(frozen=True)
class Match:
    match_id: str
    played_at: datetime
    home_team_id: str
    away_team_id: str
    home_goals: int
    away_goals: int
    season: str | None = None
    archive_season_key: str | None = None


@dataclass(frozen=True)
class Prediction:
    match_id: str
    home_team_id: str
    away_team_id: str
    p_home: float
    p_draw: float
    p_away: float
    lambda_home: float
    lambda_away: float


class LeakageError(ValueError):
    pass


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def season_start(label):
    return season_start_year(label)


def _season_sort_key(label):
    start = season_start_year(label)
    return (start if start is not None else 10**9, str(label))


def _team_rates(train, cutoff, policy):
    cutoff = _utc(cutoff)
    gf = {}
    ga = {}
    team_w = {}
    tw = tg = 0.0
    for m in train:
        played = _utc(m.played_at)
        if played >= cutoff:
            raise LeakageError(f"training row {m.match_id} is not before cutoff")
        w = time_decay_weight((cutoff - played).total_seconds() / 86400.0, policy.decay_half_life_days)
        for team, x, y in ((m.home_team_id, m.home_goals, m.away_goals), (m.away_team_id, m.away_goals, m.home_goals)):
            gf[team] = gf.get(team, 0.0) + w * x
            ga[team] = ga.get(team, 0.0) + w * y
            team_w[team] = team_w.get(team, 0.0) + w
        tw += 2 * w
        tg += w * (m.home_goals + m.away_goals)
    rate = max(tg / max(tw, 1e-12), 1e-6)
    attack = {}
    defense = {}
    for team, w in team_w.items():
        raw_attack = (gf.get(team, 0.0) / max(w, 1e-12)) / rate
        raw_defense = (ga.get(team, 0.0) / max(w, 1e-12)) / rate
        shrink = w / (w + RATE_PRIOR_WEIGHT)
        attack[team] = min(RATE_CEILING, max(RATE_FLOOR, 1.0 + shrink * (raw_attack - 1.0)))
        defense[team] = min(RATE_CEILING, max(RATE_FLOOR, 1.0 + shrink * (raw_defense - 1.0)))
    return attack, defense, rate


def _feature_factor(match, features, side):
    if not features:
        return 1.0
    snapshot = features.get(match.match_id)
    if not snapshot:
        return 1.0
    goals_for = snapshot.get(f"{side}.last5.avg_goals_for")
    goals_against = snapshot.get(f"{side}.last5.avg_goals_against")
    points_rate = snapshot.get(f"{side}.last5.points_rate")
    rest_days = snapshot.get(f"{side}.rest_days")
    factor = 1.0
    if goals_for is not None:
        factor *= min(1.08, max(0.92, 1.0 + 0.05 * (goals_for - 1.20)))
    if goals_against is not None:
        factor *= min(1.06, max(0.94, 1.0 - 0.04 * (goals_against - 1.20)))
    if points_rate is not None:
        factor *= min(1.06, max(0.94, 1.0 + 0.04 * (points_rate - 0.50)))
    if rest_days is not None:
        factor *= min(1.03, max(0.97, 1.0 + 0.006 * (min(rest_days, 14.0) - 4.0)))
    return min(1.15, max(0.85, factor))


def _temperature_probs(prediction: Prediction, temperature: float) -> Prediction:
    if temperature <= 0:
        raise ValueError("temperature must be positive")
    raw = [max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away)]
    logits = [log(x) / temperature for x in raw]
    pivot = max(logits)
    weights = [exp(x - pivot) for x in logits]
    total = sum(weights)
    p = [x / total for x in weights]
    return Prediction(prediction.match_id, prediction.home_team_id, prediction.away_team_id, p[0], p[1], p[2], prediction.lambda_home, prediction.lambda_away)


def _calibration_ece(predictions: Sequence[Prediction], outcomes: Sequence[str], temperature: float) -> float:
    bins = [{'n': 0, 'confidence': 0.0, 'correct': 0.0} for _ in range(10)]
    for p, y in zip(predictions, outcomes):
        q = _temperature_probs(p, temperature)
        probs = (q.p_home, q.p_draw, q.p_away)
        confidence = max(probs)
        predicted = ('H', 'D', 'A')[max(range(3), key=lambda i: probs[i])]
        b = bins[min(9, int(confidence * 10.0))]
        b['n'] += 1
        b['confidence'] += confidence
        b['correct'] += int(predicted == y)
    n = len(predictions)
    return sum((b['n'] / n) * abs((b['correct'] - b['confidence']) / b['n']) for b in bins if b['n'])


def _calibration_scores(predictions: Sequence[Prediction], outcomes: Sequence[str], temperature: float) -> tuple[float, float, float, float]:
    brier = 0.0
    log_loss = 0.0
    rps = 0.0
    for p, y in zip(predictions, outcomes):
        q = _temperature_probs(p, temperature)
        probs = (q.p_home, q.p_draw, q.p_away)
        target = {'H': (1.0, 0.0, 0.0), 'D': (0.0, 1.0, 0.0), 'A': (0.0, 0.0, 1.0)}[y]
        idx = {'H': 0, 'D': 1, 'A': 2}[y]
        brier += sum((a - z) ** 2 for a, z in zip(probs, target))
        log_loss -= log(max(1e-15, probs[idx]))
        rps += ((probs[0] - target[0]) ** 2 + (probs[0] + probs[1] - target[0] - target[1]) ** 2) / 2.0
    n = len(predictions)
    return brier / n, log_loss / n, rps / n, _calibration_ece(predictions, outcomes, temperature)


def fit_temperature(predictions: Sequence[Prediction], outcomes: Sequence[str]) -> tuple[float, dict]:
    """Fit scalar temperature on chronological calibration data, selecting ECE only
    inside a proper-score-preserving envelope around the original NLL solution."""
    if len(predictions) != len(outcomes):
        raise ValueError("predictions/outcomes length mismatch")
    if len(predictions) < 20:
        return 1.0, {"status": "INSUFFICIENT_CALIBRATION_DATA", "n": len(predictions), "method": "temperature_ece_guarded"}

    candidates = [0.20 + i * 0.025 for i in range(161)]
    scored = [(t, *_calibration_scores(predictions, outcomes, t)) for t in candidates]
    baseline = next(row for row in scored if abs(row[0] - 1.0) < 1e-12)
    nll_best = min(scored, key=lambda row: (row[2], row[0]))

    # Preserve the successful baseline's probabilistic behavior: ECE is allowed
    # to improve only inside a tight envelope around the uncalibrated scores.
    allowed_brier = baseline[1] + max(0.005, 0.01 * abs(baseline[1]))
    allowed_nll = baseline[2] + 0.01
    allowed_rps = baseline[3] + 0.005
    eligible = [row for row in scored if row[1] <= allowed_brier and row[2] <= allowed_nll and row[3] <= allowed_rps]
    ece_best = min(eligible, key=lambda row: (row[4], row[2], row[1])) if eligible else nll_best

    # Require a meaningful ECE improvement before moving away from the original
    # NLL-optimal temperature; otherwise keep the proven NLL choice.
    if ece_best[4] < nll_best[4] - 0.002:
        chosen = ece_best
        selection = "ECE_WITH_PROPER_SCORE_GUARDRAILS"
    else:
        chosen = nll_best
        selection = "NLL_BASELINE"

    t, brier, nll, rps, ece_value = chosen
    return t, {
        "status": "FITTED",
        "n": len(predictions),
        "temperature": t,
        "brier": brier,
        "log_loss": nll,
        "rps": rps,
        "ece": ece_value,
        "nll_opt_temperature": nll_best[0],
        "nll_opt_ece": nll_best[4],
        "ece_opt_temperature": ece_best[0],
        "ece_opt_ece": ece_best[4],
        "selection": selection,
        "method": "temperature_ece_guarded",
    }


def predict_with_state(match, ratings, train, cutoff, elo_policy=EloPolicy(), dc_policy=DixonColesPolicy(), features=None, team_rates=None):
    if _utc(match.played_at) < _utc(cutoff):
        raise LeakageError("test match must be at or after fold cutoff")
    if team_rates is None:
        team_rates = _team_rates(train, cutoff, dc_policy)
    attack, defense, rate = team_rates
    hr = ratings.get(match.home_team_id, EloState(elo_policy.initial_rating))
    ar = ratings.get(match.away_team_id, EloState(elo_policy.initial_rating))
    ef = 1 / (1 + exp(-((hr.rating + elo_policy.home_advantage) - ar.rating) / elo_policy.rating_scale * 2.302585092994046))
    ha = attack.get(match.home_team_id, 1)
    aa = attack.get(match.away_team_id, 1)
    hd = defense.get(match.home_team_id, 1)
    ad = defense.get(match.away_team_id, 1)
    hl = max(.05, rate * exp(dc_policy.home_advantage) * ha / max(ad, .25) * (.75 + .5 * ef) * _feature_factor(match, features, "home"))
    al = max(.05, rate * aa / max(hd, .25) * (1.25 - .5 * ef) * _feature_factor(match, features, "away"))
    ph, pd, pa = result_probabilities(probability_matrix(hl, al, dc_policy.rho, dc_policy.max_goals))
    return Prediction(match.match_id, match.home_team_id, match.away_team_id, ph, pd, pa, hl, al)


def run_fold(train, test, cutoff, elo_policy=EloPolicy(), dc_policy=DixonColesPolicy(), features=None, temperature=1.0):
    cutoff = _utc(cutoff)
    train = sorted(train, key=lambda m: _utc(m.played_at))
    test = sorted(test, key=lambda m: _utc(m.played_at))
    if not train or not test:
        raise ValueError("walk-forward fold requires non-empty train and test sets")
    test_start = min(_utc(m.played_at) for m in test)
    if any(_utc(m.played_at) >= test_start for m in train):
        train = [m for m in train if _utc(m.played_at) < test_start]
        cutoff = max(cutoff, test_start)
    if not train:
        raise LeakageError("fold training is empty after removing timestamp-boundary rows")
    if any(_utc(m.played_at) >= cutoff for m in train):
        raise LeakageError("fold training contains future data")
    if any(_utc(m.played_at) < cutoff for m in test):
        raise LeakageError("fold test contains pre-cutoff data")
    if max(_utc(m.played_at) for m in train) >= min(_utc(m.played_at) for m in test):
        raise LeakageError("fold training/test timestamps overlap")
    ratings = {}
    for m in train:
        h = ratings.get(m.home_team_id, EloState(elo_policy.initial_rating))
        a = ratings.get(m.away_team_id, EloState(elo_policy.initial_rating))
        ratings[m.home_team_id], ratings[m.away_team_id], _ = update_elo(h, a, m.home_goals, m.away_goals, elo_policy)
    team_rates = _team_rates(train, cutoff, dc_policy)
    out = []
    for m in test:
        raw = predict_with_state(m, ratings, train, cutoff, elo_policy, dc_policy, features, team_rates)
        out.append(_temperature_probs(raw, temperature) if temperature != 1.0 else raw)
        h = ratings.get(m.home_team_id, EloState(elo_policy.initial_rating))
        a = ratings.get(m.away_team_id, EloState(elo_policy.initial_rating))
        ratings[m.home_team_id], ratings[m.away_team_id], _ = update_elo(h, a, m.home_goals, m.away_goals, elo_policy)
    return out


def build_walk_forward_folds(matches: Iterable[Match], cutoffs: Sequence[datetime], test_window_days: int = 365):
    if test_window_days <= 0:
        raise ValueError("test_window_days must be positive")
    ordered = sorted(matches, key=lambda m: _utc(m.played_at))
    labelled = []
    for m in ordered:
        try:
            label = normalize_season_label(m.season)
        except ValueError:
            label = None
        labelled.append((m, label))
    season_labels = sorted({label for _, label in labelled if label is not None}, key=_season_sort_key)
    if len(season_labels) >= 2:
        folds = []
        season_index = {s: i for i, s in enumerate(season_labels)}
        for target_index in range(1, len(season_labels)):
            target = season_labels[target_index]
            target_matches = [m for m, label in labelled if label == target]
            if not target_matches:
                continue
            cutoff = min(_utc(m.played_at) for m in target_matches)
            train = [m for m, label in labelled if label is not None and season_index[label] < target_index and _utc(m.played_at) < cutoff]
            test = [m for m, label in labelled if label == target and _utc(m.played_at) >= cutoff]
            if not train or not test:
                continue
            train_seasons = {normalize_season_label(m.season) for m in train if normalize_season_label(m.season) is not None}
            test_seasons = {normalize_season_label(m.season) for m in test if normalize_season_label(m.season) is not None}
            overlap = train_seasons & test_seasons
            if overlap:
                raise LeakageError(f"walk-forward season overlap after fold construction: {sorted(overlap, key=_season_sort_key)}")
            if max(_utc(m.played_at) for m in train) >= min(_utc(m.played_at) for m in test):
                raise LeakageError(f"walk-forward timestamp overlap for test season {target}")
            folds.append((train, test, cutoff))
        return folds
    folds = []
    for raw in cutoffs:
        cutoff = _utc(raw)
        end = datetime(cutoff.year + 1, 1, 1, tzinfo=timezone.utc)
        train = [m for m in ordered if _utc(m.played_at) < cutoff]
        test = [m for m in ordered if cutoff <= _utc(m.played_at) < end]
        if train and test:
            folds.append((train, test, cutoff))
    return folds
