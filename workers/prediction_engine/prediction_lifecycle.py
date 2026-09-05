from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.rows import dict_row

from workers.prediction_engine.rolling_prediction_cycle import (
    MAX_SETTLEMENT_FIXTURES,
    build_benchmarks,
    calibration,
    db_connect,
    load_artifact,
    load_model,
    predict_fixture,
    provider_key,
    settle,
    sha256_json,
)

T7_DAYS = 7
BASELINE_GATE_VERSION = "baseline-gates-v1"
MIN_FEATURE_COVERAGE = 1.0


def _utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _training_cutoff(value: Any) -> datetime | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return _utc(value)
    except (TypeError, ValueError):
        return None


def _feature_coverage(artifact: dict[str, Any], fixture: dict[str, Any]) -> tuple[float, list[str]]:
    elo = artifact.get("elo") or {}
    dc = artifact.get("dixon_coles") or {}
    ratings = elo.get("ratings") or {}
    attack = dc.get("attack") or {}
    defense = dc.get("defense") or {}
    checks: list[bool] = []
    missing: list[str] = []
    for side, team_id in (("home", str(fixture["home_team_id"])), ("away", str(fixture["away_team_id"]))):
        values = {
            f"{side}.elo_rating": team_id in ratings,
            f"{side}.attack": team_id in attack,
            f"{side}.defense": team_id in defense,
        }
        for name, present in values.items():
            checks.append(present)
            if not present:
                missing.append(name)
    return sum(checks) / len(checks), missing


def _probability_state_valid(probabilities: dict[str, Any]) -> bool:
    try:
        values = [float(probabilities[k]) for k in ("home", "draw", "away")]
    except (KeyError, TypeError, ValueError):
        return False
    return all(0.0 <= v <= 1.0 for v in values) and abs(sum(values) - 1.0) <= 1e-6


def _model_health(
    *,
    release: dict[str, Any],
    model: dict[str, Any],
    artifact: dict[str, Any],
    calibration_status: str,
    training_status: str | None,
    artifact_sha: str,
) -> tuple[str, list[str]]:
    errors: list[str] = []
    if str(release.get("status", "")).upper() != "SHADOW":
        errors.append("release_not_shadow")
    if not model.get("artifact_uri"):
        errors.append("artifact_uri_missing")
    if not artifact_sha:
        errors.append("artifact_hash_missing")
    if training_status != "SUCCEEDED":
        errors.append("training_not_succeeded")
    if calibration_status not in {"VALIDATED", "ACTIVE"}:
        errors.append("calibration_not_validated")
    dc = artifact.get("dixon_coles") or {}
    rate = float(dc.get("league_rate", 0.0) or 0.0)
    attack = dc.get("attack") or {}
    defense = dc.get("defense") or {}
    if not (0.25 <= rate <= 4.0):
        errors.append("league_rate_out_of_bounds")
    if not attack or not defense:
        errors.append("dixon_coles_parameters_missing")
    return ("HEALTHY" if not errors else "UNHEALTHY"), errors


def _training_state(conn, model_id: str) -> dict[str, Any]:
    return conn.execute(
        """
        select id::text as id,status,metrics,started_at
        from public.prediction_training_runs
        where model_version_id=%s::uuid
        order by started_at desc
        limit 1
        """,
        (model_id,),
    ).fetchone() or {}


def _ensure_policy(conn) -> dict[str, Any]:
    row = conn.execute(
        """
        select id::text as id,version,payload
        from public.policy_versions
        where policy_type='prediction' and version='prediction-v1'
        limit 1
        """
    ).fetchone()
    if row:
        return row
    return conn.execute(
        """
        insert into public.policy_versions(policy_type,version,payload)
        values ('prediction','prediction-v1',%s::jsonb)
        returning id::text as id,version,payload
        """,
        (json.dumps({
            "schema_version": "prediction-policy-v1",
            "default_mode": "shadow",
            "activation_requires": ["ACTIVE", "APPROVED", "promotion_eligible=true"],
            "markets": ["1x2_home", "1x2_draw", "1x2_away"],
        }),),
    ).fetchone()


def _ensure_markets(conn) -> None:
    rows = [
        ("1x2_home", "1X2", "HOME_WIN"),
        ("1x2_draw", "1X2", "DRAW"),
        ("1x2_away", "1X2", "AWAY_WIN"),
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into public.market_registry(market_key,family,settlement_type,status,production_policy_version)
            values(%s,%s,%s,'EXPERIMENTAL','prediction-v1')
            on conflict (market_key) do update
              set family=excluded.family,
                  settlement_type=excluded.settlement_type,
                  production_policy_version=excluded.production_policy_version
            """,
            rows,
        )


def _market_snapshot_as_of(conn, fixture_id: str, kickoff_at: datetime, as_of: datetime) -> dict[str, Any] | None:
    rows = conn.execute(
        """
        select bookmaker_id,selection,odds,captured_at
        from public.odds_snapshots
        where fixture_id=%s::uuid
          and captured_at<=%s
          and captured_at<%s
          and market_key in ('1X2','match_result','home_draw_away')
          and odds>1
        order by bookmaker_id,selection,captured_at
        """,
        (fixture_id, as_of, kickoff_at),
    ).fetchall()
    mapping = {"HOME": "H", "H": "H", "1": "H", "DRAW": "D", "D": "D", "X": "D", "AWAY": "A", "A": "A", "2": "A"}
    books: dict[str, dict[str, list[tuple[float, datetime]]]] = {}
    for row in rows:
        selection = mapping.get(str(row["selection"]).strip().upper())
        if selection:
            books.setdefault(str(row["bookmaker_id"]), {}).setdefault(selection, []).append((float(row["odds"]), _utc(row["captured_at"])))
    normalized: list[list[float]] = []
    latest_at: datetime | None = None
    for by_book in books.values():
        if set(by_book) != {"H", "D", "A"}:
            continue
        closing = {key: max(by_book[key], key=lambda item: item[1]) for key in ("H", "D", "A")}
        inv = [1.0 / closing[key][0] for key in ("H", "D", "A")]
        total = sum(inv)
        if total <= 0:
            continue
        normalized.append([value / total for value in inv])
        candidate_at = max(item[1] for item in closing.values())
        latest_at = candidate_at if latest_at is None or candidate_at > latest_at else latest_at
    if not normalized:
        return None
    return {
        "probabilities": [sum(values[i] for values in normalized) / len(normalized) for i in range(3)],
        "bookmaker_count": len(normalized),
        "snapshot_at": latest_at,
    }


def _persist_market_evidence_latest(conn, fixture_id: str, episode_id: str, model_id: str, snapshot: dict[str, Any]) -> str:
    payload = {"home": snapshot["probabilities"][0], "draw": snapshot["probabilities"][1], "away": snapshot["probabilities"][2]}
    source_hash = sha256_json({
        "fixture_id": fixture_id,
        "model_version_id": model_id,
        "market": payload,
        "snapshot_at": snapshot["snapshot_at"],
    })
    existing = conn.execute(
        """
        select fixture_id::text
        from internal.prediction_market_evidence
        where fixture_id=%s::uuid and model_version_id=%s::uuid and market_key='1x2'
        limit 1
        """,
        (fixture_id, model_id),
    ).fetchone()
    if existing:
        conn.execute(
            """
            update internal.prediction_market_evidence
            set probabilities=%s::jsonb, bookmaker_count=%s, snapshot_at=%s,
                source='github-actions:pre-match-odds', source_snapshot_hash=%s
            where fixture_id=%s::uuid and model_version_id=%s::uuid and market_key='1x2'
            """,
            (json.dumps(payload), snapshot["bookmaker_count"], snapshot["snapshot_at"], source_hash, fixture_id, model_id),
        )
    else:
        conn.execute(
            """
            insert into internal.prediction_market_evidence(
                fixture_id,episode_id,model_version_id,market_key,probabilities,
                bookmaker_count,snapshot_at,source,source_snapshot_hash
            ) values (%s::uuid,%s::uuid,%s::uuid,'1x2',%s::jsonb,%s,%s,'github-actions:pre-match-odds',%s)
            """,
            (fixture_id, episode_id, model_id, json.dumps(payload), snapshot["bookmaker_count"], snapshot["snapshot_at"], source_hash),
        )
    return source_hash


def _gate_and_record(
    conn,
    *,
    fixture: dict[str, Any],
    episode: dict[str, Any],
    model: dict[str, Any],
    release: dict[str, Any],
    artifact: dict[str, Any],
    artifact_sha: str,
    calibration_status: str,
    training_status: str | None,
    probabilities: dict[str, Any],
    now: datetime,
    market_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    kickoff = _utc(fixture["kickoff_at"])
    hours = (kickoff - now).total_seconds() / 3600.0
    identity_quality = 1.0 if fixture.get("home_team_id") and fixture.get("away_team_id") and episode.get("id") else 0.0
    feature_coverage, missing_features = _feature_coverage(artifact, fixture)
    model_health, model_health_errors = _model_health(
        release=release,
        model=model,
        artifact=artifact,
        calibration_status=calibration_status,
        training_status=training_status,
        artifact_sha=artifact_sha,
    )
    cutoff = _training_cutoff(model.get("training_cutoff"))
    no_future_leakage = bool(cutoff and cutoff < kickoff and cutoff <= now)
    if market_snapshot and market_snapshot.get("snapshot_at"):
        no_future_leakage = no_future_leakage and _utc(market_snapshot["snapshot_at"]) <= now and _utc(market_snapshot["snapshot_at"]) < kickoff
    probability_valid = _probability_state_valid(probabilities)
    canonical_valid = (
        str(fixture.get("status", "")).lower() == "scheduled"
        and str(episode.get("episode_status", "")).upper() == "ACTIVE"
        and kickoff > now
    )
    eligible = (
        0.0 <= hours <= T7_DAYS * 24
        and canonical_valid
        and identity_quality >= 1.0
        and feature_coverage >= MIN_FEATURE_COVERAGE
        and model_health == "HEALTHY"
        and no_future_leakage
        and probability_valid
    )
    details = {
        "t_minus_hours": hours,
        "training_status": training_status,
        "training_cutoff": model.get("training_cutoff"),
        "model_health_errors": model_health_errors,
        "missing_features": missing_features,
        "artifact_sha256": artifact_sha,
        "calibration_status": calibration_status,
        "market_snapshot_at": market_snapshot.get("snapshot_at") if market_snapshot else None,
    }
    conn.execute(
        """
        insert into internal.prediction_baseline_gate_evaluations(
            episode_id,fixture_id,model_version_id,gate_version,evaluated_at,eligible,
            canonical_fixture_valid,identity_quality,minimum_feature_coverage,model_health,
            no_future_leakage,probability_state_valid,t_minus_hours,details
        ) values (%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
        """,
        (
            episode["id"], fixture["id"], model["id"], BASELINE_GATE_VERSION, now, eligible,
            canonical_valid, identity_quality, feature_coverage, model_health,
            no_future_leakage, probability_valid, hours, json.dumps(details, default=str),
        ),
    )
    return {
        "eligible": eligible,
        "canonical_fixture_valid": canonical_valid,
        "identity_quality": identity_quality,
        "minimum_feature_coverage": feature_coverage,
        "model_health": model_health,
        "no_future_leakage": no_future_leakage,
        "probability_state_valid": probability_valid,
        "t_minus_hours": hours,
    }


def _baseline(conn, episode_id: str):
    return conn.execute(
        """
        select id::text as id,model_version_id::text as model_version_id,
               policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash
        from public.prediction_baselines
        where episode_id=%s::uuid
        limit 1
        """,
        (episode_id,),
    ).fetchone()


def _append_evidence(conn, baseline: dict[str, Any], *, model_id: str, evidence_type: str, probability: float, snapshot: dict[str, Any] | None, artifact_sha: str) -> tuple[int, str, bool]:
    payload = {
        "baseline_hash": baseline["baseline_hash"],
        "model_version_id": model_id,
        "artifact_sha256": artifact_sha,
        "evidence_type": evidence_type,
        "market_snapshot": snapshot,
        "probability": probability,
    }
    evidence_hash = sha256_json(payload)
    existing = conn.execute(
        "select evidence_seq from public.prediction_evidence_updates where baseline_id=%s::uuid and evidence_snapshot_hash=%s limit 1",
        (baseline["id"], evidence_hash),
    ).fetchone()
    if existing:
        return int(existing["evidence_seq"] or 1), evidence_hash, False
    next_seq = int(conn.execute(
        "select coalesce(max(evidence_seq),0)+1 as next_seq from public.prediction_evidence_updates where baseline_id=%s::uuid",
        (baseline["id"],),
    ).fetchone()["next_seq"])
    conn.execute(
        """
        insert into public.prediction_evidence_updates(
            baseline_id,evidence_seq,evidence_type,current_probability,model_version_id,evidence_snapshot_hash
        ) values (%s::uuid,%s,%s,%s,%s::uuid,%s)
        """,
        (baseline["id"], next_seq, evidence_type, probability, model_id, evidence_hash),
    )
    return next_seq, evidence_hash, True


def _publish_read_model(
    conn,
    *,
    fixture: dict[str, Any],
    episode: dict[str, Any],
    baseline: dict[str, Any],
    prediction: dict[str, Any],
    evidence_seq: int,
    evidence_hash: str,
    gate: dict[str, Any],
    market_snapshot: dict[str, Any] | None,
    now: datetime,
) -> int:
    current = conn.execute(
        "select version from public.prediction_read_models where fixture_id=%s::uuid and episode_id=%s::uuid limit 1",
        (fixture["id"], episode["id"]),
    ).fetchone()
    version = int(current["version"] or 0) + 1 if current else 1
    probabilities = prediction["probabilities"]
    top = max((("HOME", probabilities["home"]), ("DRAW", probabilities["draw"]), ("AWAY", probabilities["away"])), key=lambda item: item[1])
    kickoff = _utc(fixture["kickoff_at"])
    locked = kickoff <= now
    payload = {
        "schema_version": "prediction-read-model-v1",
        "publication_status": "SHADOW_PUBLISHED",
        "fixture_id": fixture["id"],
        "episode_id": episode["id"],
        "kickoff_at": kickoff.isoformat(),
        "locked": locked,
        "locked_at": kickoff.isoformat() if locked else None,
        "baseline": {
            "id": baseline["id"],
            "pick": baseline["baseline_pick"],
            "probability": float(baseline["baseline_probability"]),
            "hash": baseline["baseline_hash"],
        },
        "assessment": {
            "pick": top[0],
            "probability": float(top[1]),
            "probabilities": probabilities,
            "fair_odds": {k: (1.0 / max(1e-12, float(v))) for k, v in probabilities.items()},
        },
        "evidence": {"sequence": evidence_seq, "snapshot_hash": evidence_hash},
        "gate": gate,
        "market_snapshot": market_snapshot,
        "model_version_id": prediction["model_version_id"],
        "artifact_sha256": prediction["artifact_sha256"],
        "calibration_version": prediction["calibration_version"],
        "published_at": now.isoformat(),
    }
    conn.execute(
        """
        insert into public.prediction_read_models(fixture_id,episode_id,version,payload,published_at)
        values (%s::uuid,%s::uuid,%s,%s::jsonb,%s)
        on conflict (fixture_id,episode_id) do update
        set version=excluded.version,payload=excluded.payload,published_at=excluded.published_at
        """,
        (fixture["id"], episode["id"], version, json.dumps(payload, default=str), now),
    )
    return version


def _process_fixture(conn, fixture: dict[str, Any], episode: dict[str, Any], release: dict[str, Any], model: dict[str, Any], policy: dict[str, Any], artifact: dict[str, Any], artifact_sha: str, cal_version: str, cal_status: str, training_status: str | None, now: datetime) -> dict[str, Any]:
    prediction = predict_fixture(fixture, artifact, float((calibration(conn))[0]))
    probabilities = prediction["probabilities"]
    snapshot = _market_snapshot_as_of(conn, fixture["id"], _utc(fixture["kickoff_at"]), now)
    gate = _gate_and_record(
        conn,
        fixture=fixture,
        episode=episode,
        model=model,
        release=release,
        artifact=artifact,
        artifact_sha=artifact_sha,
        calibration_status=cal_status,
        training_status=training_status,
        probabilities=probabilities,
        now=now,
        market_snapshot=snapshot,
    )
    baseline = _baseline(conn, episode["id"])
    created = False
    evidence_created = False
    read_model_version = None
    if gate["eligible"] and not baseline:
        picks = [("HOME", probabilities["home"]), ("DRAW", probabilities["draw"]), ("AWAY", probabilities["away"])]
        top = max(picks, key=lambda item: item[1])
        baseline_payload = {
            "episode_id": episode["id"],
            "fixture_id": fixture["id"],
            "model_version_id": model["id"],
            "policy_bundle_id": policy["id"],
            "calibration_policy": cal_version,
            "artifact_sha256": artifact_sha,
            "lambdas": prediction["lambdas"],
            "raw_probabilities": prediction.get("raw") or {},
            "probabilities": probabilities,
        }
        baseline_hash = sha256_json(baseline_payload)
        baseline = conn.execute(
            """
            insert into public.prediction_baselines(episode_id,model_version_id,policy_bundle_id,baseline_pick,baseline_probability,baseline_hash)
            values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s)
            returning id::text as id,model_version_id::text as model_version_id,
                      policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash
            """,
            (episode["id"], model["id"], policy["id"], top[0], top[1], baseline_hash),
        ).fetchone()
        created = True
        states = [
            ("1x2_home", probabilities["home"]),
            ("1x2_draw", probabilities["draw"]),
            ("1x2_away", probabilities["away"]),
        ]
        with conn.cursor() as cur:
            cur.executemany(
                """
                insert into public.prediction_market_states(baseline_id,episode_id,market_key,probability,fair_odds,status,updated_at)
                values(%s::uuid,%s::uuid,%s,%s,%s,'SHADOW',%s)
                on conflict (episode_id,market_key) do update
                  set baseline_id=excluded.baseline_id,probability=excluded.probability,
                      fair_odds=excluded.fair_odds,updated_at=excluded.updated_at
                """,
                [(baseline["id"], episode["id"], key, value, 1.0 / max(1e-12, float(value)), now) for key, value in states],
            )
    if not baseline:
        return {"fixture_id": fixture["id"], "status": "GATE_BLOCKED", "gate": gate, "baseline_created": False, "read_model_published": False}
    if baseline["model_version_id"] != model["id"] or baseline["policy_bundle_id"] != policy["id"]:
        return {"fixture_id": fixture["id"], "status": "BASELINE_CONFLICT", "gate": gate, "baseline_created": False, "read_model_published": False}

    if snapshot:
        _persist_market_evidence_latest(conn, fixture["id"], episode["id"], model["id"], snapshot)
    evidence_type = "BASELINE_CREATED" if created else ("MARKET_EVIDENCE_UPDATE" if snapshot else "RUNTIME_REASSESSMENT")
    seq, evidence_hash, evidence_created = _append_evidence(
        conn,
        baseline,
        model_id=model["id"],
        evidence_type=evidence_type,
        probability=float(max(probabilities.values())),
        snapshot=snapshot,
        artifact_sha=artifact_sha,
    )
    market_payload = {
        "probabilities": snapshot["probabilities"],
        "bookmaker_count": snapshot["bookmaker_count"],
        "snapshot_at": snapshot["snapshot_at"],
    } if snapshot else None
    prediction_payload = {
        **prediction,
        "model_version_id": model["id"],
        "artifact_sha256": artifact_sha,
        "calibration_version": cal_version,
    }
    read_model_version = _publish_read_model(
        conn,
        fixture=fixture,
        episode=episode,
        baseline=baseline,
        prediction=prediction_payload,
        evidence_seq=seq,
        evidence_hash=evidence_hash,
        gate=gate,
        market_snapshot=market_payload,
        now=now,
    )
    return {
        "fixture_id": fixture["id"],
        "status": "PUBLISHED_SHADOW" if gate["eligible"] else "BASELINE_EXISTS",
        "gate": gate,
        "baseline_id": baseline["id"],
        "baseline_created": created,
        "evidence_created": evidence_created,
        "evidence_seq": seq,
        "read_model_published": True,
        "read_model_version": read_model_version,
    }


def main() -> None:
    now = datetime.now(timezone.utc)
    with db_connect() as conn:
        conn.row_factory = dict_row
        release, model = load_model(conn)
        artifact, artifact_sha = load_artifact(model["artifact_uri"])
        temperature, cal_version, cal_status = calibration(conn)
        training = _training_state(conn, model["id"])
        policy = _ensure_policy(conn)
        _ensure_markets(conn)

        fixtures = conn.execute(
            """
            select f.id::text as id,f.home_team_id::text,f.away_team_id::text,f.kickoff_at,f.status,
                   e.id::text as episode_id,e.id::text as fixture_episode_id,e.episode_status,e.episode_no
            from public.fixtures f
            join public.fixture_episodes e on e.fixture_id=f.id and e.episode_status='ACTIVE'
            where f.status='scheduled'
              and f.kickoff_at>=%s
              and f.kickoff_at<%s
            order by f.kickoff_at asc
            limit 100
            """,
            (now, now + timedelta(days=T7_DAYS)),
        ).fetchall()
        results: list[dict[str, Any]] = []
        for row in fixtures:
            fixture = dict(row)
            episode = {"id": row["episode_id"], "fixture_id": row["id"], "episode_status": row["episode_status"], "episode_no": row["episode_no"]}
            try:
                with conn.transaction():
                    result = _process_fixture(
                        conn,
                        fixture,
                        episode,
                        release,
                        model,
                        policy,
                        artifact,
                        artifact_sha,
                        cal_version,
                        cal_status,
                        training.get("status"),
                        now,
                    )
                    results.append(result)
            except Exception as exc:
                results.append({"fixture_id": row["id"], "status": "ERROR", "error": str(exc)})

        key = provider_key(conn)
        settled = settle(conn, model["id"], key)
        benchmarks = build_benchmarks(conn, model["id"])
        conn.commit()
        blocked = sum(1 for item in results if item.get("status") == "GATE_BLOCKED")
        published = sum(1 for item in results if item.get("read_model_published"))
        errors = [item for item in results if item.get("status") == "ERROR"]
        print(json.dumps({
            "ok": not errors,
            "mode": "github-actions",
            "lifecycle": "prediction-lifecycle-v1",
            "now": now.isoformat(),
            "baseline_window": {"from": now.isoformat(), "to": (now + timedelta(days=T7_DAYS)).isoformat()},
            "model_version_id": model["id"],
            "release_version": release["release_version"],
            "artifact_sha256": artifact_sha,
            "calibration": {"version": cal_version, "temperature": temperature, "status": cal_status},
            "training_status": training.get("status"),
            "fixtures_considered": len(fixtures),
            "baseline_created": sum(1 for item in results if item.get("baseline_created")),
            "baseline_gate_blocked": blocked,
            "evidence_updates_created": sum(1 for item in results if item.get("evidence_created")),
            "read_models_published": published,
            "settled_results_written": settled,
            "market_benchmarks_written": benchmarks,
            "errors": errors,
        }, indent=2, default=str))
        if errors:
            raise RuntimeError(f"prediction_lifecycle_errors:{len(errors)}")


if __name__ == "__main__":
    main()
