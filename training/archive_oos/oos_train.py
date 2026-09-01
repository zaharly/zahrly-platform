from __future__ import annotations

import hashlib
import json
import math
import os
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import boto3
import numpy as np
import psycopg
from psycopg.rows import dict_row
from sklearn.linear_model import PoissonRegressor


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    season: int
    played_at: datetime
    home_external_id: str
    away_external_id: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class Artifact:
    manifest_id: str
    season: int
    dataset_type: str
    object_uri: str
    checksum: str
    row_count: int
    completeness_score: float
    schema_version: str


@dataclass
class Rating:
    rating: float = 1500.0
    deviation: float = 350.0
    volatility: float = 0.06


HALF_LIFE_DAYS = 180.0
ELO_K = 20.0
HOME_ADV_RATING = 60.0
INITIAL_RATING = 1500.0
MAX_GOALS = 10


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


def load_catalog() -> list[Artifact]:
    base = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    r = __import__("requests").post(
        f"{base}/rest/v1/rpc/prediction_training_archive_catalog",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={}, timeout=60,
    )
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list):
        raise RuntimeError("unexpected archive catalog payload")
    return [Artifact(str(x["manifest_id"]), int(x["season"]), str(x["dataset_type"]), str(x["object_uri"]), str(x["checksum"]), int(x["row_count"]), float(x["completeness_score"] or 0), str(x["schema_version"])) for x in rows]


def parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def recursive_fixtures(node: Any, season: int, out: list[Fixture]) -> None:
    if isinstance(node, dict):
        fixture = node.get("fixture")
        teams = node.get("teams")
        goals = node.get("goals")
        if isinstance(fixture, dict) and isinstance(teams, dict) and isinstance(goals, dict):
            fixture_id = fixture.get("id")
            dt = parse_dt(fixture.get("date"))
            home = teams.get("home")
            away = teams.get("away")
            hg = goals.get("home")
            ag = goals.get("away")
            if fixture_id is not None and dt and isinstance(home, dict) and isinstance(away, dict):
                home_id = home.get("id")
                away_id = away.get("id")
                if home_id is not None and away_id is not None and hg is not None and ag is not None:
                    try:
                        out.append(Fixture(str(fixture_id), season, dt, str(home_id), str(away_id), int(hg), int(ag)))
                    except (TypeError, ValueError):
                        pass
        for value in node.values():
            recursive_fixtures(value, season, out)
    elif isinstance(node, list):
        for value in node:
            recursive_fixtures(value, season, out)


def load_fixtures(s3, artifacts: list[Artifact]) -> list[Fixture]:
    fixtures: dict[str, Fixture] = {}
    for a in artifacts:
        if a.dataset_type != "fixtures" or a.completeness_score < 1.0:
            continue
        bucket, _, key = a.object_uri[5:].partition("/")
        obj = s3.get_object(Bucket=bucket, Key=key)
        data = obj["Body"].read()
        actual = hashlib.sha256(data).hexdigest()
        if actual != a.checksum:
            raise RuntimeError(f"checksum mismatch for manifest {a.manifest_id}")
        doc = json.loads(data.decode("utf-8"))
        parsed: list[Fixture] = []
        recursive_fixtures(doc.get("response") if isinstance(doc, dict) else doc, a.season, parsed)
        for f in parsed:
            fixtures.setdefault(f.fixture_id, f)
    return sorted(fixtures.values(), key=lambda x: (x.played_at, x.fixture_id))


def poisson_pmf(k: int, lam: float) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def dc_tau(x: int, y: int, lam_h: float, lam_a: float, rho: float) -> float:
    if x == 0 and y == 0:
        return 1.0 - lam_h * lam_a * rho
    if x == 0 and y == 1:
        return 1.0 + lam_a * rho
    if x == 1 and y == 0:
        return 1.0 + lam_h * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def result_from_score(hg: int, ag: int) -> str:
    return "H" if hg > ag else "D" if hg == ag else "A"


def elo_expected(home: float, away: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-(home + HOME_ADV_RATING - away) / 400.0))


def update_elo(ratings: dict[str, Rating], f: Fixture) -> None:
    rh = ratings.setdefault(f.home_external_id, Rating())
    ra = ratings.setdefault(f.away_external_id, Rating())
    expected = elo_expected(rh.rating, ra.rating)
    actual = 1.0 if f.home_goals > f.away_goals else 0.5 if f.home_goals == f.away_goals else 0.0
    delta = ELO_K * (actual - expected)
    rh.rating += delta
    ra.rating -= delta
    rh.deviation = max(30.0, rh.deviation * 0.995)
    ra.deviation = max(30.0, ra.deviation * 0.995)
    rh.volatility = max(0.03, rh.volatility * 0.999)
    ra.volatility = max(0.03, ra.volatility * 0.999)


def build_matrix(rows: list[Fixture], team_index: dict[str, int], cutoff: datetime) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n = len(rows)
    p = max(1, 2 * len(team_index) + 1)
    X = np.zeros((n, p), dtype=float)
    yh = np.zeros(n, dtype=float)
    ya = np.zeros(n, dtype=float)
    w = np.zeros(n, dtype=float)
    for i, f in enumerate(rows):
        hi = team_index.get(f.home_external_id)
        ai = team_index.get(f.away_external_id)
        if hi is not None:
            X[i, hi] = 1.0
        if ai is not None:
            X[i, len(team_index) + ai] = 1.0
        X[i, -1] = 0.0
        yh[i], ya[i] = f.home_goals, f.away_goals
        age = max(0.0, (cutoff - f.played_at).total_seconds() / 86400.0)
        w[i] = 0.5 ** (age / HALF_LIFE_DAYS)
    return X, yh, ya, w


def fit_model(train: list[Fixture]) -> dict[str, Any]:
    teams = sorted({x for f in train for x in (f.home_external_id, f.away_external_id)})
    idx = {team: i for i, team in enumerate(teams)}
    cutoff = max(f.played_at for f in train)
    X, yh, ya, w = build_matrix(train, idx, cutoff)
    home_model = PoissonRegressor(alpha=0.1, max_iter=2000)
    away_model = PoissonRegressor(alpha=0.1, max_iter=2000)
    home_model.fit(X, yh, sample_weight=w)
    away_model.fit(X, ya, sample_weight=w)
    lam_h = home_model.predict(X)
    lam_a = away_model.predict(X)
    best_rho = 0.0
    best_ll = -float("inf")
    for rho in np.arange(-0.20, 0.2001, 0.01):
        ll = 0.0
        for f, lh, la, ww in zip(train, lam_h, lam_a, w):
            tau = dc_tau(f.home_goals, f.away_goals, float(lh), float(la), float(rho))
            if tau <= 0:
                continue
            ll += ww * math.log(max(1e-12, poisson_pmf(f.home_goals, float(lh)) * poisson_pmf(f.away_goals, float(la)) * tau))
        if ll > best_ll:
            best_ll, best_rho = ll, float(rho)
    return {
        "teams": teams,
        "team_index": idx,
        "home_coef": home_model.coef_.tolist(),
        "home_intercept": float(home_model.intercept_),
        "away_coef": away_model.coef_.tolist(),
        "away_intercept": float(away_model.intercept_),
        "rho": best_rho,
        "alpha": 0.1,
        "half_life_days": HALF_LIFE_DAYS,
        "max_goals": MAX_GOALS,
    }


def lambdas(model: dict[str, Any], f: Fixture) -> tuple[float, float]:
    idx = model["team_index"]
    p = 2 * len(model["teams"]) + 1
    x = np.zeros(p, dtype=float)
    hi = idx.get(f.home_external_id)
    ai = idx.get(f.away_external_id)
    if hi is not None:
        x[hi] = 1.0
    if ai is not None:
        x[len(model["teams"]) + ai] = 1.0
    x[-1] = 0.0
    lh = math.exp(float(model["home_intercept"]) + float(np.dot(model["home_coef"], x)))
    la = math.exp(float(model["away_intercept"]) + float(np.dot(model["away_coef"], x)))
    return min(lh, 8.0), min(la, 8.0)


def probabilities(model: dict[str, Any], f: Fixture) -> tuple[float, float, float]:
    lh, la = lambdas(model, f)
    rho = float(model["rho"])
    ph = [poisson_pmf(k, lh) for k in range(MAX_GOALS + 1)]
    pa = [poisson_pmf(k, la) for k in range(MAX_GOALS + 1)]
    mat = np.outer(ph, pa)
    for x in range(MAX_GOALS + 1):
        for y in range(MAX_GOALS + 1):
            mat[x, y] *= max(1e-12, dc_tau(x, y, lh, la, rho))
    mat /= mat.sum()
    p_home = float(np.tril(mat, -1).sum())
    p_draw = float(np.trace(mat))
    p_away = float(np.triu(mat, 1).sum())
    total = p_home + p_draw + p_away
    return p_home / total, p_draw / total, p_away / total


def brier(p: tuple[float, float, float], outcome: str) -> float:
    y = np.array([1.0 if outcome == x else 0.0 for x in ("H", "D", "A")])
    return float(np.sum((np.array(p) - y) ** 2))


def rps(p: tuple[float, float, float], outcome: str) -> float:
    y = [1.0 if outcome == x else 0.0 for x in ("H", "D", "A")]
    cdf_p = np.cumsum(p)[:2]
    cdf_y = np.cumsum(y)[:2]
    return float(0.5 * np.sum((cdf_p - cdf_y) ** 2))


def ece(rows: list[dict[str, Any]], bins: int = 10) -> float:
    if not rows:
        return float("nan")
    total = len(rows)
    value = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        group = [r for r in rows if lo <= r["confidence"] < hi or (b == bins - 1 and r["confidence"] <= hi)]
        if group:
            acc = sum(r["correct"] for r in group) / len(group)
            conf = sum(r["confidence"] for r in group) / len(group)
            value += len(group) / total * abs(acc - conf)
    return value


def serialize_model(model: dict[str, Any]) -> str:
    return json.dumps(model, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main() -> int:
    s3 = boto3.client("s3", region_name=env("AWS_REGION"), aws_access_key_id=env("AWS_ACCESS_KEY_ID"), aws_secret_access_key=env("AWS_SECRET_ACCESS_KEY"))
    artifacts = load_catalog()
    complete = sorted({a.season for a in artifacts if a.dataset_type == "fixtures" and a.completeness_score >= 1.0})
    min_seasons = int_env("OOS_MIN_SEASONS", 3)
    if len(complete) < min_seasons:
        raise RuntimeError(f"need at least {min_seasons} complete seasons, got {complete}")
    seasons = complete[-int_env("OOS_MAX_SEASONS", len(complete)):]
    fixtures = load_fixtures(s3, [a for a in artifacts if a.season in seasons])
    if len(fixtures) < int_env("OOS_MIN_MATCHES", 3000):
        raise RuntimeError(f"insufficient settled fixtures: {len(fixtures)}")

    # Candidate model only. Never ACTIVE in this runner.
    version = f"v1-dc-elo-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    model_version_id = uuid.uuid4()
    training_run_id = uuid.uuid4()
    db_url = env("SUPABASE_DB_URL")
    artifact_key = f"zahrly/models/prediction_engine/{version}.json"

    oos_seasons = seasons[1:]
    fold_reports: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []

    ratings = {tid: Rating() for f in fixtures for tid in (f.home_external_id, f.away_external_id)}
    fixtures_by_season = defaultdict(list)
    for f in fixtures:
        fixtures_by_season[f.season].append(f)
    ordered_seasons = sorted(fixtures_by_season)

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            conn.execute("insert into public.model_versions (id,family,version,status,artifact_uri,training_cutoff) values (%s,%s,%s,%s,%s,%s)", (model_version_id, "prediction_engine", version, "CANDIDATE", f"s3://zahrly-community-storage/{artifact_key}", max(f.played_at for f in fixtures)))
            conn.execute("insert into internal.prediction_training_runs (id,model_version_id,status,requested_cutoff,started_at,metrics) values (%s,%s,%s,%s,now(),%s)", (training_run_id, model_version_id, "RUNNING", max(f.played_at for f in fixtures), json.dumps({"engine_version":"v1","family":"DIXON_COLES_ELO"})))

        seen_history: list[Fixture] = []
        fold_no = 0
        for season in ordered_seasons[1:]:
            test = fixtures_by_season[season]
            train = [f for f in fixtures if f.season < season]
            if not train or not test:
                continue
            fold_no += 1
            model = fit_model(train)
            test_start, test_end = min(f.played_at for f in test), max(f.played_at for f in test)
            conn.execute("insert into internal.prediction_training_folds (training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)", (training_run_id,fold_no,max(f.played_at for f in train),test_start,test_end,"RUNNING",json.dumps({"train_matches":len(train),"test_matches":len(test)})))
            fold_metrics: list[dict[str, Any]] = []
            for f in test:
                p = probabilities(model, f)
                outcome = result_from_score(f.home_goals, f.away_goals)
                conf = max(p)
                correct = 1 if (p[0] >= p[1] and p[0] >= p[2] and outcome == "H") or (p[1] > p[0] and p[1] >= p[2] and outcome == "D") or (p[2] > p[0] and p[2] > p[1] and outcome == "A") else 0
                row = {"fixture_id":f.fixture_id,"fold_no":fold_no,"played_at":f.played_at,"outcome":outcome,"p":p,"confidence":conf,"correct":correct,"brier":brier(p,outcome),"rps":rps(p,outcome)}
                fold_metrics.append(row)
                all_rows.append(row)
                update_elo(ratings, f)
            avg_brier = sum(r["brier"] for r in fold_metrics)/len(fold_metrics)
            avg_rps = sum(r["rps"] for r in fold_metrics)/len(fold_metrics)
            fold_ece = ece(fold_metrics)
            conn.execute("update internal.prediction_training_folds set status='SUCCEEDED',metrics=%s where training_run_id=%s and fold_no=%s", (json.dumps({"test_matches":len(fold_metrics),"brier":avg_brier,"rps":avg_rps,"ece":fold_ece}),training_run_id,fold_no))

            team_map = {}
            for external_id, rating in ratings.items():
                row = conn.execute("select id from public.team_aliases where provider='api-football' and external_team_id=%s order by valid_from nulls first limit 1", (external_id,)).fetchone()
                if row:
                    team_map[external_id] = (row["id"], rating)
            for external_id, (team_id, rating) in team_map.items():
                conn.execute("insert into internal.prediction_rating_checkpoints (model_version_id,rating_policy_version,checkpoint_scope,team_id,rating,rating_deviation,volatility,as_of_match_id,as_of_time) values (%s,%s,%s,%s,%s,%s,%s,null,%s) on conflict do nothing", (model_version_id,"elo-v1", "FOLD",team_id,rating.rating,rating.deviation,rating.volatility,test_end))

        # Aggregate OOS rows are persisted per fixture. Market metrics remain explicitly unavailable without historical market snapshots.
        insert_sql = """insert into internal.prediction_oos_benchmark (training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,null,null,null,null,%s) on conflict (training_run_id,fold_no,fixture_id) do update set model_p_home=excluded.model_p_home,model_p_draw=excluded.model_p_draw,model_p_away=excluded.model_p_away,metrics=excluded.metrics"""
        for r in all_rows:
            emp = tuple(1.0 if r["outcome"] == x else 0.0 for x in ("H","D","A"))
            conn.execute(insert_sql,(training_run_id,model_version_id,r["fixture_id"],r["fold_no"],r["played_at"],r["outcome"],r["p"][0],r["p"][1],r["p"][2],*emp,json.dumps({"brier":r["brier"],"rps":r["rps"],"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT"})))

        overall_brier = sum(r["brier"] for r in all_rows)/len(all_rows)
        overall_rps = sum(r["rps"] for r in all_rows)/len(all_rows)
        overall_ece = ece(all_rows)
        conn.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=now(),metrics=%s where id=%s", (json.dumps({"oos_matches":len(all_rows),"brier":overall_brier,"rps":overall_rps,"ece":overall_ece,"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT","folds":fold_no}),training_run_id))
        conn.commit()

    # Final full-history model artifact, uploaded only to the candidate model path.
    final_model = fit_model(fixtures)
    payload = serialize_model(final_model).encode("utf-8")
    s3.put_object(Bucket="zahrly-community-storage", Key=artifact_key, Body=payload, ContentType="application/json")
    digest = hashlib.sha256(payload).hexdigest()
    print(json.dumps({"status":"SUCCEEDED","model_version":version,"model_version_id":str(model_version_id),"training_run_id":str(training_run_id),"folds":fold_no,"oos_matches":len(all_rows),"brier":overall_brier,"rps":overall_rps,"ece":overall_ece,"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT","artifact_uri":f"s3://zahrly-community-storage/{artifact_key}","artifact_sha256":digest,"production_writes":False},indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
