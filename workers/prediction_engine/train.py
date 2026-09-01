from __future__ import annotations

"""P0 historical walk-forward training entrypoint.

Production rolling fixtures are intentionally excluded from training. The source
of historical learning is the existing S3 fixture archive only.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json

from .archive_training_source import db_connect, load_settled_matches
from .walk_forward import build_walk_forward_folds, run_fold


def _parse_cutoff(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _default_cutoffs(first: datetime, last: datetime, step_days: int, test_window_days: int) -> list[datetime]:
    first = first.astimezone(timezone.utc)
    last = last.astimezone(timezone.utc)
    start = first + timedelta(days=180)
    cutoffs: list[datetime] = []
    current = start
    while current + timedelta(days=test_window_days) <= last:
        cutoffs.append(current)
        current += timedelta(days=step_days)
    return cutoffs


def run_training(cutoffs: list[datetime] | None = None, test_window_days: int = 30, step_days: int = 30) -> dict[str, object]:
    with db_connect() as conn:
        matches = load_settled_matches(conn)

    if len(matches) < 30:
        raise RuntimeError(f"prediction_training_gate_failed: only {len(matches)} settled archived matches")

    if cutoffs is None:
        cutoffs = _default_cutoffs(matches[0].played_at, matches[-1].played_at, step_days, test_window_days)
    if not cutoffs:
        raise RuntimeError("prediction_training_gate_failed: no valid walk-forward cutoffs")

    folds = build_walk_forward_folds(matches, cutoffs, test_window_days=test_window_days)
    fold_summaries: list[dict[str, object]] = []
    total_predictions = 0
    for fold_no, (train, test, cutoff) in enumerate(folds, start=1):
        if not train or not test:
            fold_summaries.append({"fold_no": fold_no, "status": "SKIPPED", "train": len(train), "test": len(test)})
            continue
        predictions = run_fold(train, test, cutoff)
        # P0 validation metric: multiclass Brier score for 1X2 outcome.
        brier = 0.0
        for match, pred in zip(test, predictions, strict=False):
            actual = (1.0, 0.0, 0.0) if match.home_goals > match.away_goals else (0.0, 1.0, 0.0) if match.home_goals == match.away_goals else (0.0, 0.0, 1.0)
            brier += (pred.p_home - actual[0]) ** 2 + (pred.p_draw - actual[1]) ** 2 + (pred.p_away - actual[2]) ** 2
        brier /= len(predictions)
        total_predictions += len(predictions)
        fold_summaries.append({"fold_no": fold_no, "status": "SUCCEEDED", "cutoff": cutoff.isoformat(), "train": len(train), "test": len(test), "predictions": len(predictions), "brier_1x2": brier})

    succeeded = [f for f in fold_summaries if f["status"] == "SUCCEEDED"]
    if not succeeded:
        raise RuntimeError("prediction_training_gate_failed: no fold produced predictions")
    return {"status": "VALIDATED", "source": "s3://archive_catalog dataset_type=fixtures", "settled_matches": len(matches), "folds": succeeded, "total_predictions": total_predictions}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff", action="append", default=[], help="UTC ISO timestamp; may be repeated")
    parser.add_argument("--test-window-days", type=int, default=30)
    parser.add_argument("--step-days", type=int, default=30)
    args = parser.parse_args()
    cutoffs = [_parse_cutoff(value) for value in args.cutoff] or None
    result = run_training(cutoffs=cutoffs, test_window_days=args.test_window_days, step_days=args.step_days)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
