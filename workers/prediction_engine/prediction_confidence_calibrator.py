from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from .archive_training_source import load_settled_matches
from .feature_layer import build_feature_index
from .oos_benchmark import _historical_calibration_pairs, db_connect
from .walk_forward import Prediction, build_walk_forward_folds

MIN_CALIBRATION_N = 200
MIN_BLOCK_N = 20
N_QUANTILE_BLOCKS = 12


@dataclass(frozen=True)
class Block:
    x: float
    y: float
    n: int


def top_confidence(p: Prediction):
    probs = (p.p_home, p.p_draw, p.p_away)
    top = max(range(3), key=lambda i: probs[i])
    return float(probs[top]), top


def ece(predictions: Sequence[Prediction], ys: Sequence[str]) -> float:
    bins = [{"n": 0, "c": 0.0, "ok": 0.0} for _ in range(10)]
    labels = {"H": 0, "D": 1, "A": 2}
    for p, y in zip(predictions, ys):
        probs = (p.p_home, p.p_draw, p.p_away)
        top = max(range(3), key=lambda i: probs[i])
        c = max(probs)
        b = bins[min(9, int(c * 10.0))]
        b["n"] += 1
        b["c"] += c
        b["ok"] += int(top == labels[y])
    n = len(predictions)
    return sum((b["n"] / n) * abs(b["ok"] / b["n"] - b["c"] / b["n"]) for b in bins if b["n"]) if n else 0.0


def scores(predictions: Sequence[Prediction], ys: Sequence[str]):
    target = {"H": (1.0, 0.0, 0.0), "D": (0.0, 1.0, 0.0), "A": (0.0, 0.0, 1.0)}
    idx = {"H": 0, "D": 1, "A": 2}
    brier = ll = rps = 0.0
    for p, y in zip(predictions, ys):
        q = (p.p_home, p.p_draw, p.p_away)
        t = target[y]
        brier += sum((a - z) ** 2 for a, z in zip(q, t))
        ll -= math.log(max(1e-15, q[idx[y]]))
        rps += ((q[0] - t[0]) ** 2 + (q[0] + q[1] - t[0] - t[1]) ** 2) / 2.0
    n = max(1, len(predictions))
    return {"brier": brier / n, "log_loss": ll / n, "rps": rps / n, "ece": ece(predictions, ys)}


def fit_blocks(predictions: Sequence[Prediction], ys: Sequence[str]):
    labels = {"H": 0, "D": 1, "A": 2}
    rows = sorted((top_confidence(p)[0], int(top_confidence(p)[1] == labels[y])) for p, y in zip(predictions, ys))
    if not rows:
        return ()
    block_size = max(MIN_BLOCK_N, len(rows) // N_QUANTILE_BLOCKS)
    blocks = [Block(sum(x for x, _ in c) / len(c), sum(v for _, v in c) / len(c), len(c)) for c in (rows[i:i + block_size] for i in range(0, len(rows), block_size))]
    merged: list[dict] = []
    for b in blocks:
        merged.append({"x": b.x, "y": b.y, "n": b.n})
        while len(merged) >= 2 and merged[-2]["y"] > merged[-1]["y"]:
            r = merged.pop(); l = merged.pop(); n = l["n"] + r["n"]
            merged.append({"x": (l["x"] * l["n"] + r["x"] * r["n"]) / n, "y": (l["y"] * l["n"] + r["y"] * r["n"]) / n, "n": n})
    return tuple(Block(float(b["x"]), float(b["y"]), int(b["n"])) for b in merged)


def map_conf(c: float, blocks: Sequence[Block], alpha: float):
    if not blocks:
        return c
    if len(blocks) == 1:
        v = blocks[0].y
    elif c <= blocks[0].x:
        v = blocks[0].y
    elif c >= blocks[-1].x:
        v = blocks[-1].y
    else:
        v = blocks[-1].y
        for a, b in zip(blocks, blocks[1:]):
            if a.x <= c <= b.x:
                t = (c - a.x) / max(1e-12, b.x - a.x)
                v = a.y + t * (b.y - a.y)
                break
    return min(1.0 - 1e-12, max(1e-12, (1.0 - alpha) * c + alpha * v))


def apply(p: Prediction, mapping):
    if not mapping:
        return p
    raw = [max(1e-15, p.p_home), max(1e-15, p.p_draw), max(1e-15, p.p_away)]
    top = max(range(3), key=lambda i: raw[i])
    blocks = tuple(Block(*b) for b in mapping["blocks"])
    c = map_conf(raw[top], blocks, mapping["alpha"])
    c = max(c, max(raw[i] for i in range(3) if i != top) + 1e-9)
    c = min(1.0 - 1e-12, c)
    rem = 1.0 - c
    other = sum(raw[i] for i in range(3) if i != top)
    out = [0.0, 0.0, 0.0]
    out[top] = c
    for i in range(3):
        if i != top:
            out[i] = rem * raw[i] / max(other, 1e-15)
    return Prediction(p.match_id, p.home_team_id, p.away_team_id, out[0], out[1], out[2], p.lambda_home, p.lambda_away)


def historical_pool(conn, run_id):
    fold_rows = conn.execute("select fold_no,train_cutoff from internal.prediction_training_folds where training_run_id=%s and status='SUCCEEDED' order by fold_no", (run_id,)).fetchall()
    matches = load_settled_matches(conn, as_of=datetime.now(timezone.utc))
    wf = build_walk_forward_folds(matches, [r["train_cutoff"] for r in fold_rows])
    usable = [(fd, w) for fd, w in zip(fold_rows, wf) if w[0] and w[1]]
    train_rows = [m for _, (train, _, _) in usable for m in train]
    features = build_feature_index(conn, train_rows, min(m.played_at for m in train_rows)) if train_rows else {}
    pairs = []
    for _, (train, _, _) in usable:
        pairs.extend(_historical_calibration_pairs(train, features))
    return pairs


def choose(preds, ys):
    identity = {"kind": "identity", "alpha": 0.0, "blocks": []}
    n = len(preds)
    if n < MIN_CALIBRATION_N:
        return None, {"status": "INSUFFICIENT_CALIBRATION_DATA", "n": n, "method": "prediction_preserving_top_confidence_isotonic"}
    split = min(n - 50, max(120, int(n * 0.75)))
    fp, fy = preds[:split], ys[:split]
    vp, vy = preds[split:], ys[split:]
    blocks = fit_blocks(fp, fy)
    candidates = [identity] + [{"kind": "top_confidence_isotonic", "alpha": a, "blocks": [[b.x, b.y, b.n] for b in blocks]} for a in (0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.55, 0.70, 0.85, 1.0)]
    base = scores(vp, vy)
    eligible = [m for m in candidates if (lambda s: s["brier"] <= base["brier"] + 0.0015 and s["log_loss"] <= base["log_loss"] + 0.003 and s["rps"] <= base["rps"] + 0.0015)(scores([apply(p, m) for p in vp], vy))]
    selected = min(eligible, key=lambda m: (scores([apply(p, m) for p in vp], vy)["ece"], scores([apply(p, m) for p in vp], vy)["log_loss"])) if eligible else identity
    ss = scores([apply(p, selected) for p in vp], vy)
    meta = {"status": "FITTED", "method": "prediction_preserving_top_confidence_isotonic", "selection": "chronological_validation_guarded", "n": n, "fit_n": split, "validation_n": n - split, "base_ece": base["ece"], "ece": ss["ece"], "brier": ss["brier"], "log_loss": ss["log_loss"], "rps": ss["rps"], "selected": selected["kind"], "parameters": {"alpha": selected.get("alpha", 0.0), "blocks": selected.get("blocks", [])}, "argmax_preserved": True, "synthetic_data": False, "random_sampling": False, "oos_targets_used_for_calibration": False}
    return (None if selected["kind"] == "identity" else selected), meta


def main():
    with db_connect() as conn:
        requested = os.environ.get("PREDICTION_TRAINING_RUN_ID", "").strip()
        row = conn.execute("select id::text as id,model_version_id::text as model_version_id,status,metrics from internal.prediction_training_runs where id=%s", (requested,)).fetchone() if requested else conn.execute("select id::text as id,model_version_id::text as model_version_id,status,metrics from internal.prediction_training_runs where status='SUCCEEDED' order by started_at desc limit 1").fetchone()
        if not row or row["status"] != "SUCCEEDED":
            raise SystemExit("succeeded prediction training run not found")
        run_id = row["id"]; model_version_id = row["model_version_id"]
        pairs = historical_pool(conn, run_id)
        hp = [p for p, _ in pairs]; hy = [y for _, y in pairs]
        mapping, meta = choose(hp, hy)
        oos_rows = conn.execute("select fixture_id::text as fixture_id,fold_no,model_p_home,model_p_draw,model_p_away,outcome from internal.prediction_oos_benchmark where training_run_id=%s order by fold_no,played_at,fixture_id", (run_id,)).fetchall()
        raw = [Prediction(r["fixture_id"], "", "", float(r["model_p_home"]), float(r["model_p_draw"]), float(r["model_p_away"]), 0.0, 0.0) for r in oos_rows]
        ys = [str(r["outcome"]) for r in oos_rows]
        cal = [apply(p, mapping) for p in raw]
        before = scores(raw, ys); after = scores(cal, ys)
        bm = (row["metrics"] or {}).get("benchmark", {})
        merged = dict(bm)
        merged["model"] = {**after, "n": len(cal)}
        merged["calibration"] = {**(bm.get("calibration") or {}), "prediction_preserving_candidate": meta, "applied_to_oos": bool(mapping), "oos_targets_used_for_calibration": False}
        with conn.transaction():
            if mapping:
                for r, p in zip(oos_rows, cal):
                    conn.execute("update internal.prediction_oos_benchmark set model_p_home=%s,model_p_draw=%s,model_p_away=%s,metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where training_run_id=%s and fold_no=%s and fixture_id=%s", (p.p_home, p.p_draw, p.p_away, json.dumps({"calibration": meta}), run_id, int(r["fold_no"]), r["fixture_id"]))
            conn.execute("update internal.prediction_training_runs set metrics=coalesce(metrics,'{}'::jsonb)||%s::jsonb where id=%s", (json.dumps({"benchmark": merged, "calibration_diagnostic": {"historical": meta, "oos_before": before, "oos_after": after, "training_only_selection": True}}), run_id))
        print(json.dumps({"training_run_id": run_id, "mapping_applied": bool(mapping), "historical": meta, "oos_before": before, "oos_after": after}, sort_keys=True))


if __name__ == "__main__":
    main()
