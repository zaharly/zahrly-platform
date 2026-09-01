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
import requests
from psycopg.rows import dict_row
from sklearn.linear_model import PoissonRegressor


MODEL_FAMILY = "prediction_engine"
MODEL_VERSION_PREFIX = "v1-dc-elo"
RATING_POLICY_VERSION = "elo-v1"
HALF_LIFE_DAYS = 180.0
ELO_K = 20.0
HOME_ADV_RATING = 60.0
INITIAL_RATING = 1500.0
INITIAL_DEVIATION = 350.0
INITIAL_VOLATILITY = 0.06
MAX_GOALS = 10


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
    rating: float = INITIAL_RATING
    deviation: float = INITIAL_DEVIATION
    volatility: float = INITIAL_VOLATILITY


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
    response = requests.post(
        f"{base}/rest/v1/rpc/prediction_training_archive_catalog",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={}, timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("unexpected prediction_training_archive_catalog response")
    return [Artifact(str(r["manifest_id"]), int(r["season"]), str(r["dataset_type"]), str(r["object_uri"]), str(r["checksum"]), int(r["row_count"]), float(r["completeness_score"] or 0), str(r["schema_version"])) for r in payload]


def parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def walk_fixture_nodes(node: Any, season: int, out: list[Fixture]) -> None:
    if isinstance(node, dict):
        fixture = node.get("fixture")
        teams = node.get("teams")
        goals = node.get("goals")
        if isinstance(fixture, dict) and isinstance(teams, dict) and isinstance(goals, dict):
            fid = fixture.get("id")
            dt = parse_dt(fixture.get("date"))
            home = teams.get("home")
            away = teams.get("away")
            hg = goals.get("home")
            ag = goals.get("away")
            if fid is not None and dt and isinstance(home, dict) and isinstance(away, dict):
                hid, aid = home.get("id"), away.get("id")
                if hid is not None and aid is not None and hg is not None and ag is not None:
                    try:
                        out.append(Fixture(str(fid), season, dt, str(hid), str(aid), int(hg), int(ag)))
                    except (TypeError, ValueError):
                        pass
        for value in node.values():
            walk_fixture_nodes(value, season, out)
    elif isinstance(node, list):
        for value in node:
            walk_fixture_nodes(value, season, out)


def load_fixtures(s3, artifacts: list[Artifact]) -> list[Fixture]:
    dedup: dict[str, Fixture] = {}
    for artifact in artifacts:
        if artifact.dataset_type != "fixtures" or artifact.completeness_score < 1.0:
            continue
        bucket, _, key = artifact.object_uri[5:].partition("/")
        raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        if hashlib.sha256(raw).hexdigest() != artifact.checksum:
            raise RuntimeError(f"checksum mismatch for {artifact.manifest_id}")
        doc = json.loads(raw.decode("utf-8"))
        parsed: list[Fixture] = []
        walk_fixture_nodes(doc.get("response") if isinstance(doc, dict) else doc, artifact.season, parsed)
        for fixture in parsed:
            dedup.setdefault(fixture.fixture_id, fixture)
    return sorted(dedup.values(), key=lambda x: (x.played_at, x.fixture_id))


def fresh_ratings(fixtures: list[Fixture]) -> dict[str, Rating]:
    return {team: Rating() for f in fixtures for team in (f.home_external_id, f.away_external_id)}


def elo_expected(home_rating: float, away_rating: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-((home_rating + HOME_ADV_RATING) - away_rating) / 400.0))


def elo_feature(ratings: dict[str, Rating], fixture: Fixture) -> float:
    home = ratings.setdefault(fixture.home_external_id, Rating())
    away = ratings.setdefault(fixture.away_external_id, Rating())
    return (home.rating + HOME_ADV_RATING - away.rating) / 400.0


def update_elo(ratings: dict[str, Rating], fixture: Fixture) -> None:
    home = ratings.setdefault(fixture.home_external_id, Rating())
    away = ratings.setdefault(fixture.away_external_id, Rating())
    expected = elo_expected(home.rating, away.rating)
    actual = 1.0 if fixture.home_goals > fixture.away_goals else 0.5 if fixture.home_goals == fixture.away_goals else 0.0
    delta = ELO_K * (actual - expected)
    home.rating += delta
    away.rating -= delta
    home.deviation = max(30.0, home.deviation * 0.995)
    away.deviation = max(30.0, away.deviation * 0.995)
    home.volatility = max(0.03, home.volatility * 0.999)
    away.volatility = max(0.03, away.volatility * 0.999)


def build_training_matrix(rows: list[Fixture], team_index: dict[str, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n = len(rows)
    t = len(team_index)
    X = np.zeros((n, 2 * t + 1), dtype=float)
    yh = np.zeros(n, dtype=float)
    ya = np.zeros(n, dtype=float)
    weights = np.zeros(n, dtype=float)
    ratings = fresh_ratings(rows)
    cutoff = max(f.played_at for f in rows)
    for i, fixture in enumerate(rows):
        hi = team_index.get(fixture.home_external_id)
        ai = team_index.get(fixture.away_external_id)
        if hi is not None:
            X[i, hi] = 1.0
        if ai is not None:
            X[i, t + ai] = 1.0
        X[i, -1] = elo_feature(ratings, fixture)
        yh[i], ya[i] = fixture.home_goals, fixture.away_goals
        age = max(0.0, (cutoff - fixture.played_at).total_seconds() / 86400.0)
        weights[i] = 0.5 ** (age / HALF_LIFE_DAYS)
        update_elo(ratings, fixture)
    return X, yh, ya, weights


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


def poisson_pmf(k: int, lam: float) -> float:
    lam = max(1e-12, lam)
    return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))


def fit_model(train: list[Fixture]) -> dict[str, Any]:
    teams = sorted({tid for f in train for tid in (f.home_external_id, f.away_external_id)})
    index = {tid: i for i, tid in enumerate(teams)}
    X, yh, ya, weights = build_training_matrix(train, index)
    home = PoissonRegressor(alpha=0.10, max_iter=2500).fit(X, yh, sample_weight=weights)
    away = PoissonRegressor(alpha=0.10, max_iter=2500).fit(X, ya, sample_weight=weights)
    lh = home.predict(X)
    la = away.predict(X)
    best_rho, best_ll = 0.0, -float("inf")
    for rho in np.arange(-0.20, 0.2001, 0.01):
        ll = 0.0
        for fixture, h, a, w in zip(train, lh, la, weights):
            tau = dc_tau(fixture.home_goals, fixture.away_goals, float(h), float(a), float(rho))
            if tau > 0:
                ll += w * math.log(max(1e-12, poisson_pmf(fixture.home_goals, float(h)) * poisson_pmf(fixture.away_goals, float(a)) * tau))
        if ll > best_ll:
            best_ll, best_rho = ll, float(rho)
    return {
        "model_family": "DIXON_COLES_WITH_ELO_V1",
        "teams": teams,
        "team_index": index,
        "home_coef": home.coef_.tolist(),
        "home_intercept": float(home.intercept_),
        "away_coef": away.coef_.tolist(),
        "away_intercept": float(away.intercept_),
        "rho": best_rho,
        "alpha": 0.10,
        "half_life_days": HALF_LIFE_DAYS,
        "elo_k": ELO_K,
        "home_adv_rating": HOME_ADV_RATING,
        "max_goals": MAX_GOALS,
    }


def model_lambdas(model: dict[str, Any], fixture: Fixture, ratings: dict[str, Rating]) -> tuple[float, float]:
    t = len(model["teams"])
    x = np.zeros(2 * t + 1, dtype=float)
    hi = model["team_index"].get(fixture.home_external_id)
    ai = model["team_index"].get(fixture.away_external_id)
    if hi is not None:
        x[hi] = 1.0
    if ai is not None:
        x[t + ai] = 1.0
    x[-1] = elo_feature(ratings, fixture)
    lh = math.exp(float(model["home_intercept"]) + float(np.dot(np.asarray(model["home_coef"], dtype=float), x)))
    la = math.exp(float(model["away_intercept"]) + float(np.dot(np.asarray(model["away_coef"], dtype=float), x)))
    return min(lh, 8.0), min(la, 8.0)


def predict_1x2(model: dict[str, Any], fixture: Fixture, ratings: dict[str, Rating]) -> tuple[float, float, float]:
    lh, la = model_lambdas(model, fixture, ratings)
    rho = float(model["rho"])
    ph = [poisson_pmf(k, lh) for k in range(MAX_GOALS + 1)]
    pa = [poisson_pmf(k, la) for k in range(MAX_GOALS + 1)]
    matrix = np.outer(ph, pa)
    for x in range(MAX_GOALS + 1):
        for y in range(MAX_GOALS + 1):
            matrix[x, y] *= max(1e-12, dc_tau(x, y, lh, la, rho))
    matrix /= matrix.sum()
    p_h = float(np.tril(matrix, -1).sum())
    p_d = float(np.trace(matrix))
    p_a = float(np.triu(matrix, 1).sum())
    total = p_h + p_d + p_a
    return p_h / total, p_d / total, p_a / total


def outcome(fixture: Fixture) -> str:
    return "H" if fixture.home_goals > fixture.away_goals else "D" if fixture.home_goals == fixture.away_goals else "A"


def brier(p: tuple[float, float, float], y: str) -> float:
    return float(sum((p[i] - (1.0 if y == k else 0.0)) ** 2 for i, k in enumerate(("H", "D", "A"))))


def rps(p: tuple[float, float, float], y: str) -> float:
    yp = (1.0 if y == "H" else 0.0, 1.0 if y == "H" or y == "D" else 0.0)
    pp = (p[0], p[0] + p[1])
    return float(0.5 * ((pp[0] - yp[0]) ** 2 + (pp[1] - yp[1]) ** 2))


def logloss(p: tuple[float, float, float], y: str) -> float:
    return float(-math.log(max(1e-12, p[("H", "D", "A").index(y)])))


def ece(rows: list[dict[str, Any]], bins: int = 10) -> float:
    if not rows:
        return float("nan")
    total = len(rows)
    result = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        group = [r for r in rows if lo <= r["confidence"] < hi or (b == bins - 1 and r["confidence"] <= hi)]
        if group:
            acc = sum(r["correct"] for r in group) / len(group)
            conf = sum(r["confidence"] for r in group) / len(group)
            result += len(group) / total * abs(acc - conf)
    return result


def mean(values: list[float]) -> float:
    return float(sum(values) / len(values)) if values else float("nan")


def main() -> int:
    s3 = boto3.client("s3", region_name=env("AWS_REGION"), aws_access_key_id=env("AWS_ACCESS_KEY_ID"), aws_secret_access_key=env("AWS_SECRET_ACCESS_KEY"))
    catalog = load_catalog()
    complete_seasons = sorted({a.season for a in catalog if a.dataset_type == "fixtures" and a.completeness_score >= 1.0})
    if len(complete_seasons) < int_env("OOS_MIN_SEASONS", 3):
        raise RuntimeError(f"OOS requires at least {int_env('OOS_MIN_SEASONS', 3)} complete seasons; got {complete_seasons}")
    seasons = complete_seasons[-int_env("OOS_MAX_SEASONS", len(complete_seasons)):]
    fixtures = load_fixtures(s3, [a for a in catalog if a.season in seasons])
    if len(fixtures) < int_env("OOS_MIN_MATCHES", 3000):
        raise RuntimeError(f"OOS requires at least {int_env('OOS_MIN_MATCHES', 3000)} settled fixtures; got {len(fixtures)}")
    by_season: dict[int, list[Fixture]] = defaultdict(list)
    for f in fixtures:
        by_season[f.season].append(f)
    ordered = sorted(by_season)
    if len(ordered) < 2:
        raise RuntimeError("need at least one training season and one OOS season")

    model_version_id = uuid.uuid4()
    training_run_id = uuid.uuid4()
    version = f"{MODEL_VERSION_PREFIX}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    artifact_key = f"zahrly/models/prediction_engine/{version}.json"
    db_url = env("SUPABASE_DB_URL")

    overall_rows: list[dict[str, Any]] = []
    fold_count = 0
    try:
        with psycopg.connect(db_url, row_factory=dict_row) as conn:
            conn.execute("insert into public.model_versions (id,family,version,status,artifact_uri,training_cutoff) values (%s,%s,%s,%s,%s,%s)", (model_version_id, MODEL_FAMILY, version, "CANDIDATE", f"s3://zahrly-community-storage/{artifact_key}", max(f.played_at for f in fixtures)))
            conn.execute("insert into internal.prediction_training_runs (id,model_version_id,status,requested_cutoff,started_at,metrics) values (%s,%s,%s,%s,now(),%s)", (training_run_id, model_version_id, "RUNNING", max(f.played_at for f in fixtures), json.dumps({"engine":"DIXON_COLES_WITH_ELO_V1","isolation":"candidate_only"})))
            conn.commit()

            for fold_index in range(1, len(ordered)):
                train_seasons = ordered[:fold_index]
                test_season = ordered[fold_index]
                train = [f for s in train_seasons for f in by_season[s]]
                test = by_season[test_season]
                if not train or not test:
                    continue
                fold_count += 1
                model = fit_model(train)
                train_cutoff = max(f.played_at for f in train)
                test_start, test_end = min(f.played_at for f in test), max(f.played_at for f in test)
                conn.execute("insert into internal.prediction_training_folds (training_run_id,fold_no,train_cutoff,test_start,test_end,status,metrics) values (%s,%s,%s,%s,%s,%s,%s)", (training_run_id, fold_count, train_cutoff, test_start, test_end, "RUNNING", json.dumps({"train_seasons":train_seasons,"test_season":test_season,"train_matches":len(train),"test_matches":len(test)})))
                conn.commit()

                ratings = fresh_ratings(train)
                for f in train:
                    update_elo(ratings, f)
                fold_rows: list[dict[str, Any]] = []
                for f in test:
                    p = predict_1x2(model, f, ratings)
                    y = outcome(f)
                    predicted = ("H","D","A")[int(np.argmax(np.asarray(p)))]
                    row = {"fixture_id":f.fixture_id,"fold_no":fold_count,"played_at":f.played_at,"outcome":y,"p":p,"confidence":max(p),"correct":1 if predicted == y else 0,"brier":brier(p,y),"rps":rps(p,y),"logloss":logloss(p,y)}
                    fold_rows.append(row)
                    overall_rows.append(row)
                    update_elo(ratings, f)

                metrics = {"test_matches":len(fold_rows),"brier":mean([r["brier"] for r in fold_rows]),"rps":mean([r["rps"] for r in fold_rows]),"log_loss":mean([r["logloss"] for r in fold_rows]),"ece":ece(fold_rows),"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT"}
                conn.execute("update internal.prediction_training_folds set status='SUCCEEDED',metrics=%s where training_run_id=%s and fold_no=%s", (json.dumps(metrics),training_run_id,fold_count))
                team_ids = {}
                for external_id, rating in ratings.items():
                    mapped = conn.execute("select team_id from public.team_aliases where provider='api-football' and external_team_id=%s limit 1", (external_id,)).fetchone()
                    if mapped:
                        team_ids[external_id] = (mapped["team_id"], rating)
                for external_id,(team_id,rating) in team_ids.items():
                    conn.execute("insert into internal.prediction_rating_checkpoints (model_version_id,rating_policy_version,checkpoint_scope,team_id,rating,rating_deviation,volatility,as_of_time) values (%s,%s,%s,%s,%s,%s,%s,%s) on conflict do nothing", (model_version_id,RATING_POLICY_VERSION,"FOLD",team_id,rating.rating,rating.deviation,rating.volatility,test_end))
                conn.commit()

            if not overall_rows:
                raise RuntimeError("no OOS predictions were produced")
            insert_sql = """insert into internal.prediction_oos_benchmark (training_run_id,model_version_id,fixture_id,fold_no,played_at,outcome,model_p_home,model_p_draw,model_p_away,empirical_p_home,empirical_p_draw,empirical_p_away,market_p_home,market_p_draw,market_p_away,market_snapshot_at,metrics) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,null,null,null,null,%s) on conflict (training_run_id,fold_no,fixture_id) do update set model_p_home=excluded.model_p_home,model_p_draw=excluded.model_p_draw,model_p_away=excluded.model_p_away,metrics=excluded.metrics"""
            for r in overall_rows:
                emp = [1.0 if r["outcome"] == k else 0.0 for k in ("H","D","A")]
                conn.execute(insert_sql, (training_run_id,model_version_id,r["fixture_id"],r["fold_no"],r["played_at"],r["outcome"],r["p"][0],r["p"][1],r["p"][2],emp[0],emp[1],emp[2],json.dumps({"brier":r["brier"],"rps":r["rps"],"log_loss":r["logloss"],"ece_component":None,"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT"})))
            overall = {"oos_matches":len(overall_rows),"folds":fold_count,"brier":mean([r["brier"] for r in overall_rows]),"rps":mean([r["rps"] for r in overall_rows]),"log_loss":mean([r["logloss"] for r in overall_rows]),"ece":ece(overall_rows),"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT","seasons":ordered}
            conn.execute("update internal.prediction_training_runs set status='SUCCEEDED',finished_at=now(),metrics=%s where id=%s", (json.dumps(overall),training_run_id))
            conn.commit()
    except Exception as exc:
        with psycopg.connect(db_url) as fail_conn:
            fail_conn.execute("update internal.prediction_training_runs set status='FAILED',finished_at=now(),metrics=metrics || %s::jsonb where id=%s", (json.dumps({"error":str(exc)[:2000]}),training_run_id))
            fail_conn.commit()
        raise

    final_model = fit_model(fixtures)
    payload = json.dumps(final_model, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    s3.put_object(Bucket="zahrly-community-storage", Key=artifact_key, Body=payload, ContentType="application/json")
    digest = hashlib.sha256(payload).hexdigest()
    print(json.dumps({"status":"SUCCEEDED","model_version":version,"model_version_id":str(model_version_id),"training_run_id":str(training_run_id),"model_family":"DIXON_COLES_WITH_ELO_V1","folds":fold_count,"oos_matches":len(overall_rows),"brier":mean([r["brier"] for r in overall_rows]),"rps":mean([r["rps"] for r in overall_rows]),"log_loss":mean([r["logloss"] for r in overall_rows]),"ece":ece(overall_rows),"clv":None,"clv_status":"UNAVAILABLE_NO_HISTORICAL_MARKET_SNAPSHOT","artifact_uri":f"s3://zahrly-community-storage/{artifact_key}","artifact_sha256":digest,"production_writes":False}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
