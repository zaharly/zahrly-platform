from __future__ import annotations

from dataclasses import dataclass
from math import exp, log
from typing import Iterable, Sequence

MIN_CALIBRATION_SAMPLES = 300
T_MIN = 0.60
T_MAX = 1.00
T_STEP = 0.025

@dataclass(frozen=True)
class CalibrationFit:
    temperature: float
    sample_count: int
    log_loss: float
    brier: float
    rps: float
    ece: float
    status: str
    method: str = "chronological_temperature"


def _scaled(probs: Sequence[float], temperature: float) -> tuple[float, float, float]:
    if temperature <= 0:
        raise ValueError("temperature must be positive")
    raw = [max(1e-15, float(x)) for x in probs]
    logits = [log(x) / temperature for x in raw]
    pivot = max(logits)
    weights = [exp(x - pivot) for x in logits]
    total = sum(weights)
    return tuple(x / total for x in weights)  # type: ignore[return-value]


def _metrics(predictions: Sequence[Sequence[float]], outcomes: Sequence[str], temperature: float) -> tuple[float, float, float, float]:
    if len(predictions) != len(outcomes) or not predictions:
        raise ValueError("calibration input mismatch or empty")
    index = {"H": 0, "D": 1, "A": 2}
    brier = 0.0
    nll = 0.0
    rps = 0.0
    bins = [{"n": 0, "conf": 0.0, "correct": 0.0} for _ in range(10)]
    for p, y in zip(predictions, outcomes):
        q = _scaled(p, temperature)
        i = index[y]
        target = [0.0, 0.0, 0.0]
        target[i] = 1.0
        brier += sum((a - b) ** 2 for a, b in zip(q, target))
        nll -= log(max(1e-15, q[i]))
        rps += ((q[0] - target[0]) ** 2 + (q[0] + q[1] - target[0] - target[1]) ** 2) / 2.0
        confidence = max(q)
        predicted = max(range(3), key=lambda j: q[j])
        b = bins[min(9, int(confidence * 10.0))]
        b["n"] += 1
        b["conf"] += confidence
        b["correct"] += int(predicted == i)
    n = len(predictions)
    ece = sum((b["n"] / n) * abs((b["correct"] - b["conf"]) / b["n"]) for b in bins if b["n"])
    return brier / n, nll / n, rps / n, ece


def fit_temperature(predictions: Sequence[Sequence[float]], outcomes: Sequence[str], *, minimum_samples: int = MIN_CALIBRATION_SAMPLES) -> CalibrationFit:
    if len(predictions) != len(outcomes):
        raise ValueError("predictions/outcomes length mismatch")
    n = len(predictions)
    if n < minimum_samples:
        brier, nll, rps, ece = _metrics(predictions, outcomes, 1.0) if n else (0.0, 0.0, 0.0, 0.0)
        return CalibrationFit(1.0, n, nll, brier, rps, ece, "INSUFFICIENT_DATA")

    candidates = [round(T_MIN + i * T_STEP, 6) for i in range(int(round((T_MAX - T_MIN) / T_STEP)) + 1)]
    scored = []
    for t in candidates:
        brier, nll, rps, ece = _metrics(predictions, outcomes, t)
        scored.append((t, brier, nll, rps, ece))

    baseline = next(row for row in scored if abs(row[0] - 1.0) < 1e-9)
    # Conservative guardrails: primary objective is NLL; ECE may only choose a
    # candidate that does not materially worsen proper scores versus raw output.
    eligible = [
        row for row in scored
        if row[1] <= baseline[1] + 0.005
        and row[2] <= baseline[2] + 0.01
        and row[3] <= baseline[3] + 0.005
    ]
    nll_best = min(scored, key=lambda row: (row[2], row[0]))
    ece_best = min(eligible, key=lambda row: (row[4], row[2], row[1])) if eligible else nll_best
    chosen = ece_best if ece_best[4] < nll_best[4] * 0.98 else nll_best
    t, brier, nll, rps, ece = chosen
    return CalibrationFit(t, n, nll, brier, rps, ece, "FITTED")


def apply_temperature(probs: Sequence[float], temperature: float) -> tuple[float, float, float]:
    return _scaled(probs, temperature)
