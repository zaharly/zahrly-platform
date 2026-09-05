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
MAX_FUTURE_FIXTURES = 50
MAX_SETTLEMENT_FIXTURES = 50


def db_connect():
    conn = psycopg.connect(
        os.environ["SUPABASE_DB_URL"],
        row_factory=dict_row,
        connect_timeout=20,
        sslmode="require",
    )
    conn.execute("set session statement_timeout=0")
    conn.execute("set session lock_timeout=0")
    return conn


def sha256_json(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def pois(k: int, lam: float) -> float:
    fact = 1.0
    for i in range(2, k + 1):
        fact *= i
    return math.exp(k * math.log(lam) - lam) / fact


def dc_probs(home_lambda: float, away_lambda: float, rho: float, max_goals: int = 10) -> dict[str, float]:
    total = home = draw = away = 0.0
    for x in range(max_goals + 1):
        for y in range(max_goals + 1):
            tau = 1.0
            if x == 0 and y == 0:
                tau = 1 - home_lambda * away_lambda * rho
            elif x == 0 and y == 1:
                tau = 1 + home_lambda * rho
            elif x == 1 and y == 0:
                tau = 1 + away_lambda * rho
            elif x == 1 and y == 1:
                tau = 1 - rho
            p = pois(x, home_lambda) * pois(y, away_lambda) * max(0.0, tau)
            total += p
            if x > y:
                home += p
            elif x == y:
                draw += p
            else:
                away += p
    if total <= 0:
        raise ValueError("invalid_probability_mass")
    return {"home": home / total, "draw": draw / total, "away": away / total}


def temperature_calibrate(p: dict[str, float], temperature: float) -> dict[str, float]:
    z = [math.log(max(1e-15, p[k])) / temperature for k in ("home", "draw", "away")]
    m = max(z)
    weights = [math.exp(v - m) for v in z]
    s = sum(weights)
    return {k: weights[i] / s for i, k in enumerate(("home", "draw", "away"))}


def load_model(conn):
    rel = conn.execute(
        """
        select model_version_id::text, release_version, created_at
        from public.model_releases
        where status = 'SHADOW'
        order by created_at desc
        limit 1
        """
    ).fetchone()
    if not rel:
        raise RuntimeError("no_shadow_release")
    model = conn.execute(
        """
        select id::text as id, version, artifact_uri
        from public.model_versions
        where id = %s::uuid
        """,
        (rel["model_version_id"],),
    ).fetchone()
    if not model or not model["artifact_uri"]:
        raise RuntimeError("shadow_model_artifact_missing")
    return rel, model


def load_artifact(uri: str) -> tuple[dict[str, Any], str]:
    if not uri.startswith("s3://"):
        raise RuntimeError("invalid_model_artifact_uri")
    bucket, key = uri[5:].split("/", 1)
    region = os.getenv("S3_REGION") or os.getenv("AWS_REGION") or "eu-central-1"
    client = boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    )
    obj = client.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    if not raw:
        raise RuntimeError("empty_model_artifact")
    return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()


def calibration(conn) -> tuple[float, str, str]:
    row = conn.execute(
        """
        select version, payload
        from public.policy_versions
        where policy_type = 'prediction_calibration'
          and version = %s
        limit 1
        """,
        (CALIBRATION_VERSION,),
    ).fetchone()
    if not row:
        return 1.0, CALIBRATION_VERSION, "IDENTITY_FALLBACK"
    payload = row["payload"] or {}
    t = float(payload.get("temperature", 1.0))
    status = str(payload.get("status", "UNKNOWN")).upper()
    n = int(payload.get("min_calibration_samples", 300))
    if status not in {"VALIDATED", "ACTIVE"} or not math.isfinite(t) or not (0.60 <= t <= 1.00) or n < 300:
        return 1.0, str(row["version"]), "IDENTITY_FALLBACK"
    return t, str(row["version"]), status


def predict_fixture(fx: dict[str, Any], artifact: dict[str, Any], temperature: float) -> dict[str, Any]:
    elo = artifact.get("elo") or {}
    dc = artifact.get("dixon_coles") or {}
    ratings = elo.get("ratings") or {}

    def rating(team_id: str) -> float:
        raw = ratings.get(str(team_id), ratings.get(team_id, elo.get("initial_rating", 1500)))
        if isinstance(raw, dict):
            raw = raw.get("rating", elo.get("initial_rating", 1500))
        return float(raw)

    rh = rating(fx["home_team_id"])
    ra = rating(fx["away_team_id"])
    scale = float(elo.get("rating_scale", 400))
    home_adv = float(elo.get("home_advantage", 60))
    edge = 1 / (1 + math.exp(-((rh + home_adv) - ra) / scale * 2.302585092994046))

    attack = dc.get("attack") or {}
    defense = dc.get("defense") or {}
    rate = max(float(dc.get("league_rate", 1.2)), 0.05)
    rho = float(dc.get("rho", -0.1))
    max_goals = min(max(int(dc.get("max_goals", 10)), 1), 12)

    a_h = float(attack.get(str(fx["home_team_id"]), 1.0))
    a_a = float(attack.get(str(fx["away_team_id"]), 1.0))
    d_h = max(float(defense.get(str(fx["home_team_id"]), 1.0)), 0.05)
    d_a = max(float(defense.get(str(fx["away_team_id"]), 1.0)), 0.05)
    dc_home_adv = float(dc.get("home_advantage", 0.15))

    lam_h = max(0.05, rate * math.exp(dc_home_adv) * a_h / d_a * (0.75 + 0.5 * edge))
    lam_a = max(0.05, rate * a_a / d_h * (1.25 - 0.5 * edge))
    raw = dc_probs(lam_h, lam_a, rho, max_goals)
    calibrated = temperature_calibrate(raw, temperature)
    return {"lambdas": {"home": lam_h, "away": lam_a}, "raw": raw, "probabilities": calibrated}


def persist_prediction(conn, fx: dict[str, Any], episode_id: str, model_id: str, policy_id: str, artifact_sha: str, cal_version: str, pred: dict[str, Any]):
    p = pred["probabilities"]
    rows = [("1x2_home", p["home"], "HOME"), ("1x2_draw", p["draw"], "DRAW"), ("1x2_away", p["away"], "AWAY")]
    top = max(rows, key=lambda x: x[1])
    payload = {"episode_id": episode_id, "model_version_id": model_id, "policy_bundle_id": policy_id, "calibration_policy": cal_version, "artifact_sha256": artifact_sha, "lambdas": pred["lambdas"], "raw_probabilities": pred["raw"], "probabilities": p}
    b_hash = sha256_json(payload)

    baseline = conn.execute(
        "select id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_hash from public.prediction_baselines where episode_id=%s::uuid limit 1",
        (episode_id,),
    ).fetchone()
    if baseline and (baseline["model_version_id"] != model_id or baseline["policy_bundle_id"] != policy_id):
        raise RuntimeError("existing_baseline_belongs_to_different_model_or_policy")
    if not baseline:
        baseline = conn.execute(
            """
            insert into public.prediction_baselines(episode_id,model_version_id,policy_bundle_id,baseline_pick,baseline_probability,baseline_hash)
            values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s)
            returning id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_hash
            """,
            (episode_id, model_id, policy_id, top[2], top[1], b_hash),
        ).fetchone()

    conn.executemany(
        """
        insert into public.prediction_market_states(baseline_id,episode_id,market_key,probability,fair_odds,status,updated_at)
        values(%s::uuid,%s::uuid,%s,%s,%s,'EXPERIMENTAL',now())
        on conflict (episode_id,market_key) do update set probability=excluded.probability,fair_odds=excluded.fair_odds,status=excluded.status,updated_at=now()
        """,
        [(baseline["id"], episode_id, key, prob, 1 / prob) for key, prob, _ in rows],
    )
    evidence_hash = sha256_json({"baseline_hash": baseline["baseline_hash"], "artifact_sha256": artifact_sha, "calibration_policy": cal_version, "type": "BASELINE_CREATED"})
    exists = conn.execute(
        "select 1 from public.prediction_evidence_updates where baseline_id=%s::uuid and evidence_snapshot_hash=%s limit 1",
        (baseline["id"], evidence_hash),
    ).fetchone()
    if not exists:
        conn.execute(
            "insert into public.prediction_evidence_updates(baseline_id,evidence_type,current_probability,model_version_id,evidence_snapshot_hash) values(%s::uuid,'BASELINE_CREATED',%s,%s::uuid,%s)",
            (baseline["id"], top[1], model_id, evidence_hash),
        )
    return baseline["id"]


def select_market_snapshot(conn, fixture_id: str, kickoff_at: datetime):
    rows = conn.execute(
        """
        select bookmaker_id,selection,odds,captured_at
        from public.odds_snapshots
        where fixture_id=%s::uuid
          and captured_at < %s
          and market_key in ('1X2','match_result','home_draw_away')
          and odds > 1
        order by bookmaker_id,selection,captured_at
        """,
        (fixture_id, kickoff_at),
    ).fetchall()
    mapping = {"HOME": "H", "H": "H", "1": "H", "DRAW": "D", "D": "D", "X": "D", "AWAY": "A", "A": "A", "2": "A"}
    books: dict[str, dict[str, list[tuple[float, datetime]]]] = {}
    for r in rows:
        sel = mapping.get(str(r["selection"]).strip().upper())
        if not sel:
            continue
        books.setdefault(str(r["bookmaker_id"]), {}).setdefault(sel, []).append((float(r["odds"]), r["captured_at"]))
    normalized = []
    latest_at = None
    for by_book in books.values():
        if set(by_book) != {"H", "D", "A"}:
            continue
        closing = {k: max(by_book[k], key=lambda x: x[1]) for k in ("H", "D", "A")}
        inv = [1 / closing[k][0] for k in ("H", "D", "A")]
        total = sum(inv)
        normalized.append([v / total for v in inv])
        latest = max(v[1] for v in closing.values())
        latest_at = latest if latest_at is None or latest > latest_at else latest_at
    if not normalized:
        return None
    market = [sum(v[i] for v in normalized) / len(normalized) for i in range(3)]
    return {"probabilities": market, "bookmaker_count": len(normalized), "snapshot_at": latest_at}


def persist_market_evidence(conn, fx_id: str, episode_id: str, model_id: str, snapshot: dict[str, Any]):
    existing = conn.execute(
        "select id from internal.prediction_market_evidence where fixture_id=%s::uuid and model_version_id=%s::uuid and market_key='1x2' limit 1",
        (fx_id, model_id),
    ).fetchone()
    payload = {"home": snapshot["probabilities"][0], "draw": snapshot["probabilities"][1], "away": snapshot["probabilities"][2]}
    if not existing:
        source_hash = sha256_json({"fixture_id": fx_id, "model_version_id": model_id, "market": payload, "snapshot_at": snapshot["snapshot_at"]})
        conn.execute(
            """
            insert into internal.prediction_market_evidence(fixture_id,episode_id,model_version_id,market_key,probabilities,bookmaker_count,snapshot_at,source,source_snapshot_hash)
            values(%s::uuid,%s::uuid,%s::uuid,'1x2',%s::jsonb,%s,%s,'github-actions:pre-match-odds',%s)
            """,
            (fx_id, episode_id, model_id, json.dumps(payload), snapshot["bookmaker_count"], snapshot["snapshot_at"], source_hash),
        )


def provider_key(conn) -> str:
    row = conn.execute("select decrypted_secret as value from vault.decrypted_secrets where name='api_football_key' limit 1").fetchone()
    key = str(row["value"] if row else "").strip()
    if not key:
        raise RuntimeError("provider_key_missing")
    return key


def settle(conn, model_id: str, key: str) -> int:
    fixtures = conn.execute(
        """
        select distinct f.id::text as id,f.provider_ids,f.kickoff_at,f.status
        from public.fixtures f
        join internal.prediction_market_evidence e on e.fixture_id=f.id and e.model_version_id=%s::uuid
        where f.kickoff_at < now()
          and lower(f.status) not in ('ft','aet','pen','finished','completed')
        order by f.kickoff_at
        limit %s
        """,
        (model_id, MAX_SETTLEMENT_FIXTURES),
    ).fetchall()
    synced = 0
    for fx in fixtures:
        pid = (fx["provider_ids"] or {}).get("api_football")
        if not pid:
            continue
        r = requests.get("https://v3.football.api-sports.io/fixtures", params={"id": pid}, headers={"x-apisports-key": key}, timeout=30)
        r.raise_for_status()
        item = ((r.json() or {}).get("response") or [None])[0]
        st = str(((item or {}).get("fixture") or {}).get("status", {}).get("short", ""))
        if st not in {"FT", "AET", "PEN"}:
            continue
        goals = item.get("goals") or {}
        hg, ag = goals.get("home"), goals.get("away")
        if hg is None or ag is None:
            continue
        evidence_hash = f"api-football:{pid}:{st}:{hg}:{ag}"
        conn.execute("update public.fixtures set status=%s,updated_at=now() where id=%s::uuid", (st, fx["id"]))
        conn.execute(
            """
            insert into internal.prediction_fixture_results(fixture_id,provider,provider_fixture_id,final_status,home_score,away_score,fetched_at,evidence_hash)
            values(%s::uuid,'api-football',%s,%s,%s,%s,now(),%s)
            on conflict (fixture_id) do update set final_status=excluded.final_status,home_score=excluded.home_score,away_score=excluded.away_score,fetched_at=now(),evidence_hash=excluded.evidence_hash
            """,
            (fx["id"], str(pid), st, int(hg), int(ag), evidence_hash),
        )
        synced += 1
    return synced


def metric(probabilities: list[float], outcome_index: int) -> dict[str, float]:
    target = [1.0 if i == outcome_index else 0.0 for i in range(3)]
    p = [max(1e-12, float(x)) for x in probabilities]
    total = sum(p)
    p = [x / total for x in p]
    brier = sum((p[i] - target[i]) ** 2 for i in range(3))
    logloss = -math.log(p[outcome_index])
    rps = ((p[0] - target[0]) ** 2 + (p[0] + p[1] - target[0] - target[1]) ** 2) / 2
    return {"brier": brier, "log_loss": logloss, "rps": rps}


def build_benchmarks(conn, model_id: str) -> int:
    rows = conn.execute(
        """
        select f.id::text as fixture_id,f.kickoff_at,e.episode_id::text as episode_id,e.probabilities as market_probabilities,e.bookmaker_count,e.snapshot_at,
               r.home_score,r.away_score,r.evidence_hash,
               b.id::text as baseline_id,
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
        group by f.id,f.kickoff_at,e.episode_id,e.probabilities,e.bookmaker_count,e.snapshot_at,r.home_score,r.away_score,r.evidence_hash,b.id
        order by f.kickoff_at
        limit %s
        """,
        (model_id, MAX_SETTLEMENT_FIXTURES),
    ).fetchall()
    inserted = 0
    for r in rows:
        existing = conn.execute("select id from internal.prediction_market_benchmarks where fixture_id=%s::uuid and model_version_id=%s::uuid limit 1", (r["fixture_id"], model_id)).fetchone()
        if existing:
            continue
        outcome_index = 0 if int(r["home_score"]) > int(r["away_score"]) else (1 if int(r["home_score"]) == int(r["away_score"]) else 2)
        outcome = ("HOME", "DRAW", "AWAY")[outcome_index]
        model_p = [float(r["model_home"] or 0), float(r["model_draw"] or 0), float(r["model_away"] or 0)]
        mkt = r["market_probabilities"] or {}
        market_p = [float(mkt.get("home", 0)), float(mkt.get("draw", 0)), float(mkt.get("away", 0))]
        if sum(model_p) <= 0 or sum(market_p) <= 0:
            continue
        mm = metric(model_p, outcome_index)
        mk = metric(market_p, outcome_index)
        mins = max(0.0, (r["kickoff_at"] - r["snapshot_at"]).total_seconds() / 60) if r["snapshot_at"] else 999999.0
        benchmark_type = "CLOSING_LINE" if mins <= 5 else ("MULTI_BOOK_CONSENSUS" if int(r["bookmaker_count"] or 0) >= 2 else "LOCK_TIME_CONSENSUS")
        coverage = min(1.0, int(r["bookmaker_count"] or 0) / 3.0)
        evidence_hash = sha256_json({"fixture_id": r["fixture_id"], "model_version_id": model_id, "market_snapshot_at": r["snapshot_at"], "result_evidence": r["evidence_hash"], "benchmark_type": benchmark_type})
        conn.execute(
            """
            insert into internal.prediction_market_benchmarks(
                fixture_id,episode_id,model_version_id,kickoff_at,captured_at,market_snapshot_at,outcome,
                model_probabilities,market_probabilities,market_bookmakers,coverage,benchmark_type,result_source,
                model_brier,market_brier,model_log_loss,market_log_loss,model_rps,market_rps,evidence_hash
            ) values(%s::uuid,%s::uuid,%s::uuid,%s,now(),%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,'prediction_fixture_results',%s,%s,%s,%s,%s,%s,%s)
            """,
            (r["fixture_id"], r["episode_id"], model_id, r["kickoff_at"], r["snapshot_at"], outcome, json.dumps({"home": model_p[0], "draw": model_p[1], "away": model_p[2]}), json.dumps(mkt), int(r["bookmaker_count"] or 0), coverage, benchmark_type, mm["brier"], mk["brier"], mm["log_loss"], mk["log_loss"], mm["rps"], mk["rps"], evidence_hash),
        )
        inserted += 1
    return inserted


def disable_legacy_crons(conn):
    names = [
        "prediction-shadow-scheduler-v1",
        "prediction-controlled-canary-scheduler-v1",
        "prediction-market-evidence-v1",
        "prediction-market-benchmark-v1",
        "prediction-market-settlement-sync-v1",
        "prediction-promotion-gate-runner-v1",
    ]
    for name in names:
        conn.execute("update cron.job set active=false where jobname=%s", (name,))


def main():
    now = datetime.now(timezone.utc)
    with db_connect() as conn:
        disable_legacy_crons(conn)
        rel, model = load_model(conn)
        artifact, artifact_sha = load_artifact(model["artifact_uri"])
        temperature, cal_version, cal_status = calibration(conn)
        policy = conn.execute("select id::text as id from public.policy_versions where policy_type='prediction' and version='prediction-v1' limit 1").fetchone()
        if not policy:
            policy = conn.execute("insert into public.policy_versions(policy_type,version,payload) values('prediction','prediction-v1',%s::jsonb) returning id::text as id", (json.dumps({"schema_version": "prediction-policy-v1", "default_mode": "shadow", "markets": ["1x2_home", "1x2_draw", "1x2_away"]}),)).fetchone()
        fixtures = conn.execute(
            """
            select id::text as id,home_team_id::text,away_team_id::text,kickoff_at,status
            from public.fixtures
            where status='scheduled' and kickoff_at>=now()
            order by kickoff_at
            limit %s
            """,
            (MAX_FUTURE_FIXTURES,),
        ).fetchall()
        predictions = 0
        market_evidence = 0
        errors = []
        for fx in fixtures:
            ep = conn.execute("select id::text as id from public.fixture_episodes where fixture_id=%s::uuid and episode_status='ACTIVE' order by episode_no desc limit 1", (fx["id"],)).fetchone()
            if not ep:
                continue
            try:
                pred = predict_fixture(fx, artifact, temperature)
                persist_prediction(conn, fx, ep["id"], model["id"], policy["id"], artifact_sha, cal_version, pred)
                predictions += 1
                snapshot = select_market_snapshot(conn, fx["id"], fx["kickoff_at"])
                if snapshot:
                    persist_market_evidence(conn, fx["id"], ep["id"], model["id"], snapshot)
                    market_evidence += 1
            except Exception as exc:
                errors.append({"fixture_id": fx["id"], "error": str(exc)})
        key = provider_key(conn)
        settled = settle(conn, model["id"], key)
        benchmarks = build_benchmarks(conn, model["id"])
        conn.commit()
        print(json.dumps({
            "ok": True,
            "mode": "github-actions",
            "now": now.isoformat(),
            "model_version_id": model["id"],
            "release_version": rel["release_version"],
            "artifact_sha256": artifact_sha,
            "calibration": {"version": cal_version, "temperature": temperature, "status": cal_status},
            "future_fixtures_considered": len(fixtures),
            "predictions_written": predictions,
            "market_evidence_written": market_evidence,
            "settled_results_written": settled,
            "market_benchmarks_written": benchmarks,
            "legacy_supabase_prediction_crons_disabled": True,
            "errors": errors,
        }, indent=2, default=str))


if __name__ == "__main__":
    main()
