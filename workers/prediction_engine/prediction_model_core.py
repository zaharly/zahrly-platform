from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timezone
from typing import Any

import boto3
import psycopg
import requests
from psycopg.rows import dict_row

CALIBRATION_VERSION = "temperature-1x2-v1"
MAX_SETTLEMENT_FIXTURES = 50


def db_connect():
    conn = psycopg.connect(os.environ["SUPABASE_DB_URL"], row_factory=dict_row, connect_timeout=20, sslmode="require")
    conn.execute("set session statement_timeout=0")
    conn.execute("set session lock_timeout=0")
    return conn


def sha256_json(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def pois(k: int, lam: float) -> float:
    if lam <= 0:
        raise ValueError("invalid_poisson_lambda")
    fact = 1.0
    for i in range(2, k + 1):
        fact *= i
    return math.exp(k * math.log(lam) - lam) / fact


def dc_score_matrix(home_lambda: float, away_lambda: float, rho: float, max_goals: int = 10) -> list[list[float]]:
    matrix: list[list[float]] = []
    total = 0.0
    for x in range(max_goals + 1):
        row: list[float] = []
        for y in range(max_goals + 1):
            tau = 1.0
            if x == 0 and y == 0:
                tau = 1.0 - home_lambda * away_lambda * rho
            elif x == 0 and y == 1:
                tau = 1.0 + home_lambda * rho
            elif x == 1 and y == 0:
                tau = 1.0 + away_lambda * rho
            elif x == 1 and y == 1:
                tau = 1.0 - rho
            value = pois(x, home_lambda) * pois(y, away_lambda) * max(0.0, tau)
            row.append(value)
            total += value
        matrix.append(row)
    if total <= 0:
        raise ValueError("invalid_probability_mass")
    return [[v / total for v in row] for row in matrix]


def matrix_to_1x2(matrix: list[list[float]]) -> dict[str, float]:
    home = sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x > y)
    draw = sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x == y)
    away = sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x < y)
    s = home + draw + away
    return {"home": home / s, "draw": draw / s, "away": away / s}


def temperature_calibrate(p: dict[str, float], temperature: float) -> dict[str, float]:
    if not math.isfinite(temperature) or not (0.60 <= temperature <= 1.00):
        raise ValueError("invalid_calibration_temperature")
    z = [math.log(max(1e-15, p[k])) / temperature for k in ("home", "draw", "away")]
    m = max(z)
    weights = [math.exp(v - m) for v in z]
    total = sum(weights)
    return {k: weights[i] / total for i, k in enumerate(("home", "draw", "away"))}


def load_model(conn):
    rel = conn.execute("""
        select model_version_id::text, release_version, status, created_at
        from public.model_releases where status='SHADOW' order by created_at desc limit 1
    """).fetchone()
    if not rel:
        raise RuntimeError("no_shadow_release")
    model = conn.execute("""
        select id::text as id, version, artifact_uri, training_cutoff
        from public.model_versions where id=%s::uuid
    """, (rel["model_version_id"],)).fetchone()
    if not model or not model["artifact_uri"]:
        raise RuntimeError("shadow_model_artifact_missing")
    return rel, model


def load_artifact(uri: str) -> tuple[dict[str, Any], str]:
    if not uri.startswith("s3://"):
        raise RuntimeError("invalid_model_artifact_uri")
    bucket, key = uri[5:].split("/", 1)
    client = boto3.client(
        "s3",
        region_name=os.getenv("S3_REGION") or os.getenv("AWS_REGION") or "eu-central-1",
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    )
    raw = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    if not raw:
        raise RuntimeError("empty_model_artifact")
    return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()


def calibration(conn) -> tuple[float, str, str]:
    row = conn.execute("""
        select version, payload from public.policy_versions
        where policy_type='prediction_calibration' and version=%s limit 1
    """, (CALIBRATION_VERSION,)).fetchone()
    if not row:
        raise RuntimeError("calibration_policy_missing")
    payload = row["payload"] or {}
    t = float(payload.get("temperature", 1.0))
    status = str(payload.get("status", "UNKNOWN")).upper()
    n = int(payload.get("min_calibration_samples", 0))
    if status not in {"VALIDATED", "ACTIVE"} or n < 300 or not math.isfinite(t) or not (0.60 <= t <= 1.00):
        raise RuntimeError("calibration_policy_not_validated")
    return t, str(row["version"]), status


def _required_team_params(artifact: dict[str, Any], team_id: str) -> tuple[float, float, float, str]:
    elo = artifact.get("elo") or {}
    dc = artifact.get("dixon_coles") or {}
    ratings = elo.get("ratings") or {}
    attack = dc.get("attack") or {}
    defense = dc.get("defense") or {}
    tid = str(team_id)
    if tid in ratings and tid in attack and tid in defense:
        raw = ratings[tid]
        rating = float(raw.get("rating") if isinstance(raw, dict) else raw)
        return rating, float(attack[tid]), max(float(defense[tid]), 0.05), "TEAM_HISTORY"

    # Cold start is permitted only when the artifact carries an explicit,
    # versioned prior. Never silently replace missing team state with 1500/1/1.
    cold = artifact.get("cold_start") or {}
    policy_version = cold.get("cold_start_policy_version")
    prior = cold.get("team_prior") or {}
    if policy_version and tid in prior:
        item = prior[tid]
        if not all(k in item for k in ("rating", "attack", "defense")):
            raise RuntimeError(f"cold_start_prior_incomplete:{tid}")
        return float(item["rating"]), float(item["attack"]), max(float(item["defense"]), 0.05), str(policy_version)
    raise RuntimeError(f"missing_team_state:{tid}")


def predict_fixture(fx: dict[str, Any], artifact: dict[str, Any], temperature: float) -> dict[str, Any]:
    elo = artifact.get("elo") or {}
    dc = artifact.get("dixon_coles") or {}
    rh, ah, dh, home_state = _required_team_params(artifact, fx["home_team_id"])
    ra, aa, da_def, away_state = _required_team_params(artifact, fx["away_team_id"])

    scale = float(elo.get("rating_scale", 400))
    home_adv_rating = float(elo.get("home_advantage", 60))
    edge = 1.0 / (1.0 + math.exp(-((rh + home_adv_rating) - ra) / scale * 2.302585092994046))
    rate = float(dc.get("league_rate"))
    rho = float(dc.get("rho", -0.1))
    if not 0.25 <= rate <= 4.0:
        raise RuntimeError("league_rate_out_of_bounds")
    max_goals = min(max(int(dc.get("max_goals", 10)), 6), 12)
    da = float(dc.get("home_advantage", 0.15))
    lh = max(0.05, rate * math.exp(da) * ah / da_def * (0.75 + 0.5 * edge))
    la = max(0.05, rate * aa / dh * (1.25 - 0.5 * edge))
    matrix = dc_score_matrix(lh, la, rho, max_goals)
    raw = matrix_to_1x2(matrix)
    calibrated = temperature_calibrate(raw, temperature)
    return {
        "lambdas": {"home": lh, "away": la},
        "raw": raw,
        "probabilities": calibrated,
        "score_matrix": matrix,
        "state_sources": {"home": home_state, "away": away_state},
    }


def provider_key(conn) -> str:
    row = conn.execute("select decrypted_secret as value from vault.decrypted_secrets where name='api_football_key' limit 1").fetchone()
    key = str(row["value"] if row else "").strip()
    if not key:
        raise RuntimeError("provider_key_missing")
    return key


def settle(conn, model_id: str, key: str) -> int:
    fixtures = conn.execute("""
        select distinct f.id::text as id,f.provider_ids,f.kickoff_at,f.status
        from public.fixtures f
        join internal.prediction_market_evidence e on e.fixture_id=f.id and e.model_version_id=%s::uuid
        where f.kickoff_at<now() and lower(f.status) not in ('ft','aet','pen','finished','completed')
        order by f.kickoff_at limit %s
    """, (model_id, MAX_SETTLEMENT_FIXTURES)).fetchall()
    synced = 0
    for fx in fixtures:
        pid = (fx["provider_ids"] or {}).get("api_football")
        if not pid:
            continue
        response = requests.get(
            "https://v3.football.api-sports.io/fixtures",
            params={"id": pid}, headers={"x-apisports-key": key}, timeout=30,
        )
        response.raise_for_status()
        item = ((response.json() or {}).get("response") or [None])[0]
        status = str(((item or {}).get("fixture") or {}).get("status", {}).get("short", ""))
        goals = (item or {}).get("goals") or {}
        hg, ag = goals.get("home"), goals.get("away")
        if status not in {"FT", "AET", "PEN"} or hg is None or ag is None:
            continue
        evidence_hash = f"api-football:{pid}:{status}:{hg}:{ag}"
        conn.execute("update public.fixtures set status=%s,updated_at=now() where id=%s::uuid", (status, fx["id"]))
        conn.execute("""
            insert into internal.prediction_fixture_results(fixture_id,provider,provider_fixture_id,final_status,home_score,away_score,fetched_at,evidence_hash)
            values(%s::uuid,'api-football',%s,%s,%s,%s,now(),%s)
            on conflict (fixture_id) do update set final_status=excluded.final_status,home_score=excluded.home_score,away_score=excluded.away_score,fetched_at=now(),evidence_hash=excluded.evidence_hash
        """, (fx["id"], str(pid), status, int(hg), int(ag), evidence_hash))
        synced += 1
    return synced


def build_benchmarks(conn, model_id: str) -> int:
    rows = conn.execute("""
        select f.id::text as fixture_id,f.kickoff_at,e.episode_id::text as episode_id,e.probabilities as market_probabilities,
               e.bookmaker_count,e.snapshot_at,r.home_score,r.away_score,r.evidence_hash,
               max(case when ms.market_key='1x2_home' then ms.probability end) as model_home,
               max(case when ms.market_key='1x2_draw' then ms.probability end) as model_draw,
               max(case when ms.market_key='1x2_away' then ms.probability end) as model_away
        from internal.prediction_market_evidence e
        join public.fixtures f on f.id=e.fixture_id
        join internal.prediction_fixture_results r on r.fixture_id=f.id
        join public.fixture_episodes ep on ep.fixture_id=f.id and ep.episode_status='ACTIVE'
        join public.prediction_baselines b on b.episode_id=ep.id and b.model_version_id=e.model_version_id
        join public.prediction_market_states ms on ms.episode_id=ep.id
        where e.model_version_id=%s::uuid and e.market_key='1x2'
        group by f.id,f.kickoff_at,e.episode_id,e.probabilities,e.bookmaker_count,e.snapshot_at,r.home_score,r.away_score,r.evidence_hash
        order by f.kickoff_at limit %s
    """, (model_id, MAX_SETTLEMENT_FIXTURES)).fetchall()
    inserted = 0
    for row in rows:
        if conn.execute("select 1 from internal.prediction_market_benchmarks where fixture_id=%s::uuid and model_version_id=%s::uuid limit 1", (row["fixture_id"], model_id)).fetchone():
            continue
        oi = 0 if int(row["home_score"]) > int(row["away_score"]) else (1 if int(row["home_score"]) == int(row["away_score"]) else 2)
        outcome = ("HOME", "DRAW", "AWAY")[oi]
        model_p = [float(row["model_home"] or 0), float(row["model_draw"] or 0), float(row["model_away"] or 0)]
        market = row["market_probabilities"] or {}
        market_p = [float(market.get("home", 0)), float(market.get("draw", 0)), float(market.get("away", 0))]
        if sum(model_p) <= 0 or sum(market_p) <= 0:
            continue
        def metric(p: list[float]) -> tuple[float, float, float]:
            total = sum(max(1e-12, x) for x in p); q = [max(1e-12, x) / total for x in p]
            target = [1.0 if i == oi else 0.0 for i in range(3)]
            brier = sum((q[i] - target[i]) ** 2 for i in range(3))
            log_loss = -math.log(q[oi])
            rps = ((q[0] - target[0]) ** 2 + (q[0] + q[1] - target[0] - target[1]) ** 2) / 2
            return brier, log_loss, rps
        mb, ml, mr = metric(model_p); kb, kl, kr = metric(market_p)
        minutes = max(0.0, (row["kickoff_at"] - row["snapshot_at"]).total_seconds() / 60) if row["snapshot_at"] else 999999.0
        btype = "CLOSING_LINE" if minutes <= 5 else ("MULTI_BOOK_CONSENSUS" if int(row["bookmaker_count"] or 0) >= 2 else "LOCK_TIME_CONSENSUS")
        coverage = min(1.0, int(row["bookmaker_count"] or 0) / 3.0)
        evidence_hash = sha256_json({"fixture_id": row["fixture_id"], "model_version_id": model_id, "market_snapshot_at": row["snapshot_at"], "result_evidence": row["evidence_hash"], "benchmark_type": btype})
        conn.execute("""
            insert into internal.prediction_market_benchmarks(fixture_id,episode_id,model_version_id,kickoff_at,captured_at,market_snapshot_at,outcome,model_probabilities,market_probabilities,market_bookmakers,coverage,benchmark_type,result_source,model_brier,market_brier,model_log_loss,market_log_loss,model_rps,market_rps,evidence_hash)
            values(%s::uuid,%s::uuid,%s::uuid,%s,now(),%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,'prediction_fixture_results',%s,%s,%s,%s,%s,%s,%s)
        """, (row["fixture_id"], row["episode_id"], model_id, row["kickoff_at"], row["snapshot_at"], outcome,
              json.dumps({"home": model_p[0], "draw": model_p[1], "away": model_p[2]}), json.dumps(market),
              int(row["bookmaker_count"] or 0), coverage, btype, mb, kb, ml, kl, mr, kr, evidence_hash))
        inserted += 1
    return inserted
