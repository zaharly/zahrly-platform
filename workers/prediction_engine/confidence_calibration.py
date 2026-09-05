from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from .archive_training_source import load_settled_matches
from .feature_layer import build_feature_index
from .oos_benchmark import _historical_calibration_pairs, db_connect, outcome
from .walk_forward import Prediction, build_walk_forward_folds, run_fold

MIN_CALIBRATION_N = 200
MIN_BLOCK_N = 20
N_QUANTILE_BLOCKS = 12


@dataclass(frozen=True)
class IsoBlock:
    x: float
    y: float
    n: int


def _top_confidence(p: Prediction) -> tuple[float, int]:
    probs = (float(p.p_home), float(p.p_draw), float(p.p_away))
    top = max(range(3), key=lambda i: probs[i])
    return probs[top], top


def _ece(confidence: Sequence[float], correct: Sequence[int]) -> float:
    if not confidence:
        return 0.0
    bins = [{"n": 0, "c": 0.0, "a": 0.0} for _ in range(10)]
    for c, ok in zip(confidence, correct):
        b = bins[min(9, max(0, int(c * 10.0)))]
        b["n"] += 1
        b["c"] += c
        b["a"] += ok
    n = len(confidence)
    return sum((b["n"] / n) * abs((b["a"] - b["c"]) / b["n"]) for b in bins if b["n"])


def _metrics(predictions: Sequence[Prediction], outcomes: Sequence[str], mapping) -> dict[str, float]:
    brier = log_loss = rps = 0.0
    conf = []
    corr = []
    for p, y in zip(predictions, outcomes):
        q = _apply_mapping(p, mapping)
        probs = (q.p_home, q.p_draw, q.p_away)
        target = {"H": (1.0, 0.0, 0.0), "D": (0.0, 1.0, 0.0), "A": (0.0, 0.0, 1.0)}[y]
        idx = {"H": 0, "D": 1, "A": 2}[y]
        brier += sum((a - z) ** 2 for a, z in zip(probs, target))
        log_loss -= math.log(max(1e-15, probs[idx]))
        rps += ((probs[0] - target[0]) ** 2 + (probs[0] + probs[1] - target[0] - target[1]) ** 2) / 2.0
        conf.append(max(probs))
        corr.append(int(max(range(3), key=lambda i: probs[i]) == idx))
    n = max(1, len(predictions))
    return {"brier": brier / n, "log_loss": log_loss / n, "rps": rps / n, "ece": _ece(conf, corr)}


def _fit_isotonic(predictions: Sequence[Prediction], outcomes: Sequence[str]) -> tuple[IsoBlock, ...]:
    rows = sorted((_top_confidence(p)[0], int(_top_confidence(p)[1] == {"H": 0, "D": 1, "A": 2}[y])) for p, y in zip(predictions, outcomes))
    if not rows:
        return ()
    block_size = max(MIN_BLOCK_N, len(rows) // N_QUANTILE_BLOCKS)
    raw: list[IsoBlock] = []
    for i in range(0, len(rows), block_size):
        chunk = rows[i : i + block_size]
        raw.append(IsoBlock(sum(x for x, _ in chunk) / len(chunk), sum(y for _, y in chunk) / len(chunk), len(chunk)))
    blocks = [{"x": b.x, "y": b.y, "n": b.n} for b in raw]
    merged: list[dict] = []
    for b in blocks:
        merged.append(b)
        while len(merged) >= 2 and merged[-2]["y"] > merged[-1]["y"]:
            a = merged.pop()
            z = merged.pop()
            n = z["n"] + a["n"]
            merged.append({"x": (z["x"] * z["n"] + a["x"] * a["n"]) / n, "y": (z["y"] * z["n"] + a["y"] * a["n"]) / n, "n": n})
    return tuple(IsoBlock(float(b["x"]), float(b["y"]), int(b["n"])) for b in merged)


def _map_confidence(c: float, blocks: Sequence[IsoBlock], alpha: float) -> float:
    if not blocks:
        return c
    c = min(1.0 - 1e-12, max(1e-12, c))
    if len(blocks) == 1:
        mapped = blocks[0].y
    elif c <= blocks[0].x:
        mapped = blocks[0].y
    elif c >= blocks[-1].x:
        mapped = blocks[-1].y
    else:
        mapped = blocks[-1].y
        for left, right in zip(blocks, blocks[1:]):
            if left.x <= c <= right.x:
                span = max(1e-12, right.x - left.x)
                t = (c - left.x) / span
                mapped = left.y + t * (right.y - left.y)
                break
    return min(1.0 - 1e-12, max(1e-12, (1.0 - alpha) * c + alpha * mapped))


def _apply_mapping(prediction: Prediction, mapping: dict | None) -> Prediction:
    if not mapping or mapping.get("kind") != "top_confidence_isotonic":
        return prediction
    raw = [max(1e-15, prediction.p_home), max(1e-15, prediction.p_draw), max(1e-15, prediction.p_away)]
    top = max(range(3), key=lambda i: raw[i])
    c = raw[top]
    blocks = tuple(IsoBlock(float(x[0]), float(x[1]), int(x[2])) for x in mapping.get("blocks", []))
    calibrated = _map_confidence(c, blocks, float(mapping.get("alpha", 0.0)))
    other_max = max(raw[i] for i in range(3) if i != top)
    calibrated = max(other_max + 1e-9, calibrated)
    calibrated = min(1.0 - 1e-12, calibrated)
    remainder = 1.0 - calibrated
    other_sum = sum(raw[i] for i in range(3) if i != top)
    out = [0.0, 0.0, 0.0]
    out[top] = calibrated
    for i in range(3):
        if i != top:
            out[i] = remainder * raw[i] / max(other_sum, 1e-15)
    return Prediction(prediction.match_id, prediction.home_team_id, prediction.away_team_id, out[0], out[1], out[2], prediction.lambda_home, prediction.lambda_away)


def _mapping_metadata(mapping: dict | None) -> dict:
    if not mapping:
        return {"kind": "identity", "alpha": 0.0, "blocks": []}
    return {
        "kind": mapping["kind"],
        "alpha": round(float(mapping["alpha"]), 6),
        "blocks": [[round(float(b.x), 8), round(float(b.y), 8), int(b.n)] for b in mapping.get("blocks", ())],
    }


def _select(predictions: Sequence[Prediction], outcomes: Sequence[str]) -> tuple[dict | None, dict]:
    n = len(predictions)
    identity = {"kind": "identity", "alpha": 0.0, "blocks": ()}
    if n < MIN_CALIBRATION_N:
        return None, {"status": "INSUFFICIENT_CALIBRATION_DATA", "n": n, "method": "prediction_preserving_top_confidence_isotonic"}
    split = min(n - 50, max(120, int(n * 0.75)))
    fit_p, fit_y = predictions[:split], outcomes[:split]
    val_p, val_y = predictions[split:], outcomes[split:]
    blocks = _fit_isotonic(fit_p, fit_y)
    candidates = [identity]
    for alpha in (0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.55, 0.70, 0.85, 1.0):
        candidates.append({"kind": "top_confidence_isotonic", "alpha": alpha, "blocks": blocks})
    base = _metrics(val_p, val_y, identity)

    def eligible(mapping: dict) -> bool:
        s = _metrics(val_p, val_y, mapping)
        return (
            s["brier"] <= base["brier"] + 0.0015
            and s["log_loss"] <= base["log_loss"] + 0.003
            and s["rps"] <= base["rps"] + 0.0015
        )

    allowed = [c for c in candidates if eligible(c)]
    chosen = min(allowed, key=lambda m: (_metrics(val_p, val_y, m)["ece"], _metrics(val_p, val_y, m)["log_loss"])) if allowed else identity
    chosen_scores = _metrics(val_p, val_y, chosen)
    meta = {
        "status": "FITTED",
        "method": "prediction_preserving_top_confidence_isotonic",
        "selection": "chronological_validation_guarded",
        "n": n,
        "fit_n": split,
        "validation_n": n - split,
        "base_ece": base["ece"],
        "ece": chosen_scores["ece"],
        "brier": chosen_scores["brier"],
        "log_loss": chosen_scores["log_loss"],
        "rps": chosen_scores["rps"],
        "parameters": {"alpha": chosen.get("alpha", 0.0), "blocks": _mapping_metadata(chosen)["blocks"]},
        "argmax_preserved": True,
        "synthetic_data": False,
        "random_sampling": False,
        "oos_targets_used_for_calibration": False,
    }
    if chosen.get("kind") == "identity" or chosen_scores["ece"] >= base["ece"] - 1e-6:
        return None, meta | {"selected": "identity"}
    return chosen, meta | {"selected": "prediction_preserving_top_confidence_isotonic"}


def _build_historical_pool(conn, training_run_id: str):
    folds = conn.execute(
        "select fold_no,train_cutoff from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no",
        (training_run_id,),
    ).fetchall()
    matches = load_settled_matches(conn, as_of=datetime.now(timezone.utc))
    wf = build_walk_forward_folds(matches, [r["train_cutoff"] for r in folds])
    usable = [(fd, w) for fd, w in zip(folds, wf) if w[0] and w[1]]
    train_rows = [m for _, (train, _, _) in usable for m in train]
    if not train_rows:
        return [], {}, usable
    features = build_feature_index(conn, train_rows, min(m.played_at for m in train_rows))
    pairs = []
    for _, (train, _, _) in usable:
        pairs.extend(_historical_calibration_pairs(train, features))
    return pairs, features, usable


def _load_oos(conn, training_run_id: str):
    rows = conn.execute(
        "select fixture_id::text as fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away from internal.prediction_oos_benchmark where training_run_id=%s order by fold_no,played_at,fixture_id",
        (training_run_id,),
    ).fetchall()
    preds = [Prediction(str(r["fixture_id"]), "", "", float(r["model_p_home"]), float(r["model_p_draw"]), float(r["model_p_away"]), 0.0, 0.0) for r in rows]
    outcomes = [str(r["outcome"]) for r in rows]
    return rows, preds, outcomes


def _update_run(conn, training_run_id: str, model_version_id: str, mapping: dict | None, calibration_meta: dict, rows, preds, outcomes):
    chosen_preds = [_apply_mapping(p, mapping) for p in preds]
    overall = _metrics(chosen_preds, outcomes, {"kind": "top_confidence_isotonic", "alpha": 0.0, "blocks": ()} if mapping is None else mapping)
    # Recompute per-fold metrics from the transformed OOS probabilities.
    fold_metrics = {}
    for row, p, y in zip(rows, chosen_preds, outcomes):
        fold_metrics.setdefault(int(row["fold_no"]), ([], []))
        fold_metrics[int(row["fold_no"])][0].append(p)
        fold_metrics[int(row["fold_no"])][1].append(y)
    for fold_no, (fp, fy) in fold_metrics.items():
        fm = _metrics(fp, fy, None)
        eval_folds = conn.execute(
            "select id::text as id from internal.evaluation_folds ef join internal.evaluation_runs er on er.id=ef.run_id where er.model_version_id=%s and er.benchmark_type='WALK_FORWARD_OOS' and ef.fold_no=%s order by ef.created_at desc limit 1",
            (model_version_id, fold_no),
        ).fetchone()
        if eval_folds:
            fid = eval_folds["id"]
            conn.execute("delete from internal.evaluation_metrics where fold_id=%s", (fid,))
            conn.execute(
                "insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) select run_id,id,'ALL','Brier',%s,%s,'{}'::jsonb from internal.evaluation_folds where id=%s",
                (fm["brier"], len(fp), fid),
            )
            conn.execute(
                "insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) select run_id,id,'ALL','LogLoss',%s,%s,'{}'::jsonb from internal.evaluation_folds where id=%s",
                (fm["log_loss"], len(fp), fid),
            )
            conn.execute(
                "insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) select run_id,id,'ALL','RPS',%s,%s,'{}'::jsonb from internal.evaluation_folds where id=%s",
                (fm["rps"], len(fp), fid),
            )
            conn.execute(
                "insert into internal.evaluation_metrics(run_id,fold_id,segment,metric_name,metric_value,sample_count,metadata) select run_id,id,'ALL','ECE',%s,%s,%s::jsonb from internal.evaluation_folds where id=%s",
                (fm["ece"], len(fp), json.dumps({"calibration": calibration_meta}), fid),
            )

    benchmark = {
        "oos_n": len(chosen_preds),
        "model": {**overall, "n": len(chosen_preds)},
        "calibration": {
            **calibration_meta,
            "applied_to_oos": bool(mapping),
            "oos_targets_used_for_calibration": False,
            "mapping": _mapping_metadata(mapping),
        },
    }
    # Preserve the empirical baseline and non-ECE benchmark metadata from the canonical run.
    existing = conn.execute("select metrics from internal.prediction_training_runs where id=%s", (training_run_id,)).fetchone()["metrics"] or {}
    old_benchmark = (existing.get("benchmark") or {}) if isinstance(existing, dict) else {}
    merged = dict(old_benchmark)
    merged["model"] = benchmark["model"]
    merged["oos_n"] = benchmark["oos_n"]
    merged["calibration"] = benchmark["calibration"]
    conn.execute(
        "update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s",
        (json.dumps({"benchmark": merged}), training_run_id),
    )
    # Only write transformed probabilities when a historical-only candidate was selected.
    if mapping:
        for row, p in zip(rows, chosen_preds):
            conn.execute(
                "update internal.prediction_oos_benchmark set model_p_home=%s,model_p_draw=%s,model_p_away=%s,metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where training_run_id=%s and fold_no=%s and fixture_id=%s",
                (
                    p.p_home, p.p_draw, p.p_away,
                    json.dumps({"calibration": calibration_meta}),
                    training_run_id, int(row["fold_no"]), row["fixture_id"],
                ),
            )
    return benchmark


def main(training_run_id: str | None = None):
    with db_connect() as conn:
        requested = training_run_id or __import__("os").environ.get("PREDICTION_TRAINING_RUN_ID", "").strip()
        if requested:
            row = conn.execute("select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where id=%s", (requested,)).fetchone()
        else:
            row = conn.execute("select id::text as id,model_version_id::text as model_version_id,status from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
        if not row or row["status"] != "SUCCEEDED":
            raise SystemExit("succeeded prediction training run not found")
        training_run_id = row["id"]
        model_version_id = row["model_version_id"]
        pairs, _, _ = _build_historical_pool(conn, training_run_id)
        hist_preds = [p for p, _ in pairs]
        hist_y = [y for _, y in pairs]
        mapping, cal_meta = _select(hist_preds, hist_y)
        rows, oos_preds, oos_y = _load_oos(conn, training_run_id)
        benchmark = _update_run(conn, training_run_id, model_version_id, mapping, cal_meta, rows, oos_preds, oos_y)
        conn.commit()
        print(json.dumps({"training_run_id": training_run_id, "historical": cal_meta, "mapping_applied": bool(mapping), "oos_after": benchmark["model"]}, sort_keys=True))


if __name__ == "__main__":
    main()
