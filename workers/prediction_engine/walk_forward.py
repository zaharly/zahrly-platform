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


def _apply_class_conditional_calibration(prediction: Prediction, params: tuple[float, float, float, float, float, float]) -> Prediction:
    """Calibrate the reported top-label probability conditioned on its class.

    This directly matches the gate's top-label ECE definition: calibration is
    conditioned on whether HOME, DRAW or AWAY is the predicted class. The argmax
    class is never changed and the non-top probabilities retain their original
    relative proportions. Parameters are learned only from historical OOF pairs.
    """
    raw = [max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away)]
    top = max(range(3), key=lambda i: raw[i])
    c = min(1.0 - 1e-12, max(1e-12, raw[top]))
    a = params[2 * top]
    b = params[2 * top + 1]
    z = a + b * log(c / (1.0 - c))
    calibrated = 1.0 / (1.0 + exp(-z))
    # Keep the predicted class unchanged and keep all probabilities on the simplex.
    other_max = max(raw[i] for i in range(3) if i != top)
    calibrated = min(1.0 - 1e-12, max(other_max + 1e-9, calibrated))
    remainder = 1.0 - calibrated
    other_sum = sum(raw[i] for i in range(3) if i != top)
    out = [0.0, 0.0, 0.0]
    out[top] = calibrated
    for i in range(3):
        if i != top:
            out[i] = remainder * raw[i] / max(other_sum, 1e-15)
    return Prediction(prediction.match_id, prediction.home_team_id, prediction.away_team_id, out[0], out[1], out[2], prediction.lambda_home, prediction.lambda_away)


def _apply_calibration(prediction: Prediction, calibration) -> Prediction:
    if calibration is None or calibration == 1.0:
        return prediction
    if isinstance(calibration, tuple):
        if len(calibration) == 6:
            return _apply_class_conditional_calibration(prediction, calibration)
        if len(calibration) == 2:
            # Backward compatibility for archived runs; new fitting never emits this form.
            a, b = calibration
            raw = [max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away)]
            top = max(range(3), key=lambda i: raw[i])
            c = min(1.0 - 1e-12, max(1e-12, raw[top]))
            z = a + b * log(c / (1.0 - c))
            calibrated = min(1.0 - 1e-12, max(1e-12, 1.0 / (1.0 + exp(-z))))
            calibrated = max(calibrated, max(raw[i] for i in range(3) if i != top) + 1e-9)
            remainder = 1.0 - calibrated
            other_sum = sum(raw[i] for i in range(3) if i != top)
            out = [0.0, 0.0, 0.0]
            out[top] = calibrated
            for i in range(3):
                if i != top:
                    out[i] = remainder * raw[i] / max(other_sum, 1e-15)
            return Prediction(prediction.match_id, prediction.home_team_id, prediction.away_team_id, out[0], out[1], out[2], prediction.lambda_home, prediction.lambda_away)
    if calibration <= 0:
        raise ValueError("temperature must be positive")
    raw = [max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away)]
    logits = [log(x) / calibration for x in raw]
    pivot = max(logits)
    weights = [exp(x - pivot) for x in logits]
    total = sum(weights)
    p = [x / total for x in weights]
    return Prediction(prediction.match_id, prediction.home_team_id, prediction.away_team_id, p[0], p[1], p[2], prediction.lambda_home, prediction.lambda_away)


def _calibration_probs(prediction: Prediction, calibration) -> tuple[float, float, float]:
    q = _apply_calibration(prediction, calibration)
    return q.p_home, q.p_draw, q.p_away


def _calibration_ece(predictions: Sequence[Prediction], outcomes: Sequence[str], calibration) -> float:
    bins = [{'n': 0, 'confidence': 0.0, 'correct': 0.0} for _ in range(10)]
    for p, y in zip(predictions, outcomes):
        probs = _calibration_probs(p, calibration)
        confidence = max(probs)
        predicted = ('H', 'D', 'A')[max(range(3), key=lambda i: probs[i])]
        b = bins[min(9, int(confidence * 10.0))]
        b['n'] += 1
        b['confidence'] += confidence
        b['correct'] += int(predicted == y)
    n = len(predictions)
    return sum((b['n'] / n) * abs((b['correct'] - b['confidence']) / b['n']) for b in bins if b['n'])


def _calibration_scores(predictions: Sequence[Prediction], outcomes: Sequence[str], calibration) -> tuple[float, float, float, float]:
    brier = 0.0
    log_loss = 0.0
    rps = 0.0
    for p, y in zip(predictions, outcomes):
        probs = _calibration_probs(p, calibration)
        target = {'H': (1.0, 0.0, 0.0), 'D': (0.0, 1.0, 0.0), 'A': (0.0, 0.0, 1.0)}[y]
        idx = {'H': 0, 'D': 1, 'A': 2}[y]
        brier += sum((a - z) ** 2 for a, z in zip(probs, target))
        log_loss -= log(max(1e-15, probs[idx]))
        rps += ((probs[0] - target[0]) ** 2 + (probs[0] + probs[1] - target[0] - target[1]) ** 2) / 2.0
    n = len(predictions)
    return brier / n, log_loss / n, rps / n, _calibration_ece(predictions, outcomes, calibration)


def _fit_platt_for_top_class(predictions: Sequence[Prediction], outcomes: Sequence[str], top_class: int, min_n: int = 50):
    rows = []
    labels = []
    for p, y in zip(predictions, outcomes):
        raw = (p.p_home, p.p_draw, p.p_away)
        top = max(range(3), key=lambda i: raw[i])
        if top != top_class:
            continue
        c = min(1.0 - 1e-12, max(1e-12, raw[top]))
        rows.append(log(c / (1.0 - c)))
        labels.append(1.0 if y == ('H', 'D', 'A')[top] else 0.0)
    if len(rows) < min_n:
        return 0.0, 1.0, len(rows)

    # Deterministic regularized Newton fit. The target is top-label correctness,
    # exactly the quantity used by the ECE gate.
    a = 0.0
    b = 1.0
    for _ in range(20):
        g_a = g_b = 0.0
        h_aa = h_ab = h_bb = 0.0
        for x, y in zip(rows, labels):
            z = max(-30.0, min(30.0, a + b * x))
            q = 1.0 / (1.0 + exp(-z))
            w = max(1e-8, q * (1.0 - q))
            err = q - y
            g_a += err
            g_b += err * x
            h_aa += w
            h_ab += w * x
            h_bb += w * x * x
        # Ridge toward identity; intercept is shrunk to 0 and slope to 1.
        lam = 0.10
        g_a += lam * a
        g_b += lam * (b - 1.0)
        h_aa += lam
        h_bb += lam
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-10:
            break
        da = (g_a * h_bb - g_b * h_ab) / det
        db = (h_aa * g_b - h_ab * g_a) / det
        new_a = max(-1.5, min(1.5, a - da))
        new_b = max(0.25, min(2.0, b - db))
        if abs(new_a - a) + abs(new_b - b) < 1e-7:
            a, b = new_a, new_b
            break
        a, b = new_a, new_b
    return a, b, len(rows)


def fit_temperature(predictions: Sequence[Prediction], outcomes: Sequence[str]):
    """Fit class-conditional top-label calibration on historical OOF data.

    The gate measures top-label ECE. Therefore calibration is conditioned on the
    predicted class (HOME/DRAW/AWAY) instead of mixing all three classes in one
    confidence curve. A chronological holdout is used only for model selection.
    The final calibrator is selected only if it does not worsen Brier, LogLoss or
    RPS on that holdout beyond small numerical guardrails. No OOS target is used.
    """
    if len(predictions) != len(outcomes):
        raise ValueError("predictions/outcomes length mismatch")
    n = len(predictions)
    if n < 120:
        return 1.0, {"status": "INSUFFICIENT_CALIBRATION_DATA", "n": n, "method": "class_conditional_top_label"}

    split = max(80, int(n * 0.75))
    split = min(split, n - 40)
    fit_predictions = predictions[:split]
    fit_outcomes = outcomes[:split]
    valid_predictions = predictions[split:]
    valid_outcomes = outcomes[split:]
    identity = (0.0, 1.0, 0.0, 1.0, 0.0, 1.0)
    fitted = []
    counts = []
    for cls in range(3):
        a, b, count = _fit_platt_for_top_class(fit_predictions, fit_outcomes, cls, min_n=35)
        fitted.extend((a, b))
        counts.append(count)
    fitted = tuple(fitted)
    base = _calibration_scores(valid_predictions, valid_outcomes, identity)

    # Shrink each class-specific fit toward identity. Selection is entirely on the
    # later chronological validation slice. This avoids the previous failure mode
    # where a single global curve averaged incompatible HOME/DRAW/AWAY calibration.
    candidates = [identity]
    for alpha in (0.15, 0.25, 0.40, 0.55, 0.70, 0.85, 1.0):
        candidates.append(tuple(
            fitted[j] * alpha if j % 2 == 0 else 1.0 + (fitted[j] - 1.0) * alpha
            for j in range(6)
        ))

    def acceptable(c):
        s = _calibration_scores(valid_predictions, valid_outcomes, c)
        return s[0] <= base[0] + 0.003 and s[1] <= base[1] + 0.006 and s[2] <= base[2] + 0.003

    eligible = [c for c in candidates if acceptable(c)]
    chosen = min(
        eligible,
        key=lambda c: (_calibration_scores(valid_predictions, valid_outcomes, c)[3], _calibration_scores(valid_predictions, valid_outcomes, c)[1]),
    ) if eligible else identity
    valid_scores = _calibration_scores(valid_predictions, valid_outcomes, chosen)
    fit_scores = _calibration_scores(fit_predictions, fit_outcomes, chosen)
    return chosen, {
        "status": "FITTED",
        "n": n,
        "fit_n": len(fit_predictions),
        "validation_n": len(valid_predictions),
        "parameters": [round(float(x), 8) for x in chosen],
        "top_class_counts": {"H": counts[0], "D": counts[1], "A": counts[2]},
        "brier": valid_scores[0],
        "log_loss": valid_scores[1],
        "rps": valid_scores[2],
        "ece": valid_scores[3],
        "base_ece": base[3],
        "fit_brier": fit_scores[0],
        "fit_log_loss": fit_scores[1],
        "fit_rps": fit_scores[2],
        "method": "class_conditional_top_label",
        "selection": "chronological_validation_guarded",
        "target": "top_label_correctness",
        "argmax_preserved": True,
        "synthetic_data": False,
        "random_sampling": False,
        "oos_targets_used_for_calibration": False,
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
        out.append(_apply_calibration(raw, temperature))
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
