from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from workers.prediction_engine.rolling_prediction_cycle import (
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


def utc(v: Any) -> datetime:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse_cutoff(v: Any) -> datetime | None:
    if v in (None, ""):
        return None
    try:
        return utc(v)
    except (TypeError, ValueError):
        return None


def feature_coverage(artifact: dict[str, Any], fixture: dict[str, Any]) -> tuple[float, list[str]]:
    elo = artifact.get("elo") or {}
    dc = artifact.get("dixon_coles") or {}
    ratings, attack, defense = elo.get("ratings") or {}, dc.get("attack") or {}, dc.get("defense") or {}
    checks: list[bool] = []
    missing: list[str] = []
    for side, team in (("home", str(fixture["home_team_id"])), ("away", str(fixture["away_team_id"]))):
        for label, values in (("elo_rating", ratings), ("attack", attack), ("defense", defense)):
            ok = team in values
            checks.append(ok)
            if not ok:
                missing.append(f"{side}.{label}")
    return sum(checks) / 6.0, missing


def valid_probabilities(p: dict[str, Any]) -> bool:
    try:
        values = [float(p[k]) for k in ("home", "draw", "away")]
    except (KeyError, TypeError, ValueError):
        return False
    return all(0 <= x <= 1 for x in values) and abs(sum(values) - 1.0) <= 1e-6


def model_health(release: dict[str, Any], model: dict[str, Any], artifact: dict[str, Any], calibration_status: str, training_status: str | None, artifact_sha: str) -> tuple[str, list[str]]:
    errors: list[str] = []
    if str(release.get("status", "")).upper() != "SHADOW": errors.append("release_not_shadow")
    if not model.get("artifact_uri"): errors.append("artifact_uri_missing")
    if not artifact_sha: errors.append("artifact_hash_missing")
    if training_status != "SUCCEEDED": errors.append("training_not_succeeded")
    if calibration_status not in {"VALIDATED", "ACTIVE"}: errors.append("calibration_not_validated")
    dc = artifact.get("dixon_coles") or {}
    try: rate = float(dc.get("league_rate", 0.0) or 0.0)
    except (TypeError, ValueError): rate = 0.0
    if not 0.25 <= rate <= 4.0: errors.append("league_rate_out_of_bounds")
    if not dc.get("attack") or not dc.get("defense"): errors.append("dixon_coles_parameters_missing")
    return ("HEALTHY" if not errors else "UNHEALTHY"), errors


def training_state(conn, model_id: str) -> dict[str, Any]:
    return conn.execute("""
        select id::text as id,status,metrics,started_at
        from public.prediction_training_runs
        where model_version_id=%s::uuid order by started_at desc limit 1
    """, (model_id,)).fetchone() or {}


def policy(conn) -> dict[str, Any]:
    row = conn.execute("""
        select id::text as id,version,payload from public.policy_versions
        where policy_type='prediction' and version='prediction-v1' limit 1
    """).fetchone()
    if row: return row
    return conn.execute("""
        insert into public.policy_versions(policy_type,version,payload)
        values('prediction','prediction-v1',%s::jsonb)
        returning id::text as id,version,payload
    """, (json.dumps({"schema_version":"prediction-policy-v1","default_mode":"shadow","markets":["1x2_home","1x2_draw","1x2_away"]}),)).fetchone()


def markets(conn) -> None:
    rows=[("1x2_home","1X2","HOME_WIN"),("1x2_draw","1X2","DRAW"),("1x2_away","1X2","AWAY_WIN")]
    with conn.cursor() as cur:
        cur.executemany("""
            insert into public.market_registry(market_key,family,settlement_type,status,production_policy_version)
            values(%s,%s,%s,'EXPERIMENTAL','prediction-v1')
            on conflict (market_key) do update set family=excluded.family,settlement_type=excluded.settlement_type,production_policy_version=excluded.production_policy_version
        """, rows)


def market_snapshot(conn, fixture_id: str, kickoff: datetime, as_of: datetime) -> dict[str, Any] | None:
    rows=conn.execute("""
        select bookmaker_id,selection,odds,captured_at from public.odds_snapshots
        where fixture_id=%s::uuid and captured_at<=%s and captured_at<%s
          and market_key in ('1X2','match_result','home_draw_away') and odds>1
        order by bookmaker_id,selection,captured_at
    """, (fixture_id,as_of,kickoff)).fetchall()
    mapping={"HOME":"H","H":"H","1":"H","DRAW":"D","D":"D","X":"D","AWAY":"A","A":"A","2":"A"}
    books: dict[str,dict[str,list[tuple[float,datetime]]]]={}
    for r in rows:
        s=mapping.get(str(r["selection"]).strip().upper())
        if s: books.setdefault(str(r["bookmaker_id"]),{}).setdefault(s,[]).append((float(r["odds"]),utc(r["captured_at"])))
    normalized=[]; latest=None
    for book in books.values():
        if set(book)!={"H","D","A"}: continue
        closing={k:max(book[k],key=lambda x:x[1]) for k in ("H","D","A")}
        inv=[1.0/closing[k][0] for k in ("H","D","A")]; total=sum(inv)
        if total<=0: continue
        normalized.append([x/total for x in inv]); at=max(x[1] for x in closing.values()); latest=at if latest is None or at>latest else latest
    if not normalized: return None
    return {"probabilities":[sum(v[i] for v in normalized)/len(normalized) for i in range(3)],"bookmaker_count":len(normalized),"snapshot_at":latest}


def persist_market_evidence(conn, fixture_id: str, episode_id: str, model_id: str, snapshot: dict[str, Any]) -> str:
    payload={"home":snapshot["probabilities"][0],"draw":snapshot["probabilities"][1],"away":snapshot["probabilities"][2]}
    source_hash=sha256_json({"fixture_id":fixture_id,"model_version_id":model_id,"market":payload,"snapshot_at":snapshot["snapshot_at"]})
    exists=conn.execute("select 1 from internal.prediction_market_evidence where fixture_id=%s::uuid and model_version_id=%s::uuid and market_key='1x2' limit 1",(fixture_id,model_id)).fetchone()
    if exists:
        conn.execute("""
            update internal.prediction_market_evidence set probabilities=%s::jsonb,bookmaker_count=%s,snapshot_at=%s,source='github-actions:pre-match-odds',source_snapshot_hash=%s
            where fixture_id=%s::uuid and model_version_id=%s::uuid and market_key='1x2'
        """,(json.dumps(payload),snapshot["bookmaker_count"],snapshot["snapshot_at"],source_hash,fixture_id,model_id))
    else:
        conn.execute("""
            insert into internal.prediction_market_evidence(fixture_id,episode_id,model_version_id,market_key,probabilities,bookmaker_count,snapshot_at,source,source_snapshot_hash)
            values(%s::uuid,%s::uuid,%s::uuid,'1x2',%s::jsonb,%s,%s,'github-actions:pre-match-odds',%s)
        """,(fixture_id,episode_id,model_id,json.dumps(payload),snapshot["bookmaker_count"],snapshot["snapshot_at"],source_hash))
    return source_hash


def record_gate(conn, fixture: dict[str,Any], episode: dict[str,Any], model: dict[str,Any], release: dict[str,Any], artifact: dict[str,Any], artifact_sha: str, cal_status: str, training_status: str | None, probabilities: dict[str,Any], now: datetime, snapshot: dict[str,Any] | None) -> dict[str,Any]:
    kickoff=utc(fixture["kickoff_at"]); hours=(kickoff-now).total_seconds()/3600.0
    identity=1.0 if fixture.get("home_team_id") and fixture.get("away_team_id") and episode.get("id") else 0.0
    coverage,missing=feature_coverage(artifact,fixture)
    health,health_errors=model_health(release,model,artifact,cal_status,training_status,artifact_sha)
    cutoff=parse_cutoff(model.get("training_cutoff") or artifact.get("training_cutoff") or (artifact.get("metadata") or {}).get("training_cutoff"))
    no_leak=bool(cutoff and cutoff<kickoff and cutoff<=now)
    if snapshot and snapshot.get("snapshot_at"):
        s=utc(snapshot["snapshot_at"]); no_leak=no_leak and s<=now and s<kickoff
    canonical=str(fixture.get("status","")).lower()=="scheduled" and str(episode.get("episode_status","")).upper()=="ACTIVE" and kickoff>now
    prob_ok=valid_probabilities(probabilities)
    eligible=(0<=hours<=T7_DAYS*24 and canonical and identity>=1.0 and coverage>=MIN_FEATURE_COVERAGE and health=="HEALTHY" and no_leak and prob_ok)
    details={"t_minus_hours":hours,"training_cutoff":model.get("training_cutoff") or artifact.get("training_cutoff"),"missing_features":missing,"model_health_errors":health_errors,"artifact_sha256":artifact_sha,"calibration_status":cal_status,"market_snapshot_at":snapshot.get("snapshot_at") if snapshot else None}
    conn.execute("""
        insert into internal.prediction_baseline_gate_evaluations(episode_id,fixture_id,model_version_id,gate_version,evaluated_at,eligible,canonical_fixture_valid,identity_quality,minimum_feature_coverage,model_health,no_future_leakage,probability_state_valid,t_minus_hours,details)
        values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
    """,(episode["id"],fixture["id"],model["id"],BASELINE_GATE_VERSION,now,eligible,canonical,identity,coverage,health,no_leak,prob_ok,hours,json.dumps(details,default=str)))
    return {"eligible":eligible,"canonical_fixture_valid":canonical,"identity_quality":identity,"minimum_feature_coverage":coverage,"model_health":health,"no_future_leakage":no_leak,"probability_state_valid":prob_ok,"t_minus_hours":hours}


def baseline(conn, episode_id: str):
    return conn.execute("""
        select id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash
        from public.prediction_baselines where episode_id=%s::uuid limit 1
    """,(episode_id,)).fetchone()


def append_evidence(conn, base: dict[str,Any], model_id: str, evidence_type: str, probability: float, snapshot: dict[str,Any] | None, artifact_sha: str) -> tuple[int,str,bool]:
    h=sha256_json({"baseline_hash":base["baseline_hash"],"model_version_id":model_id,"artifact_sha256":artifact_sha,"evidence_type":evidence_type,"market_snapshot":snapshot,"probability":probability})
    existing=conn.execute("select evidence_seq from public.prediction_evidence_updates where baseline_id=%s::uuid and evidence_snapshot_hash=%s limit 1",(base["id"],h)).fetchone()
    if existing: return int(existing["evidence_seq"] or 1),h,False
    seq=int(conn.execute("select coalesce(max(evidence_seq),0)+1 as next_seq from public.prediction_evidence_updates where baseline_id=%s::uuid",(base["id"],)).fetchone()["next_seq"])
    conn.execute("""
        insert into public.prediction_evidence_updates(baseline_id,evidence_seq,evidence_type,current_probability,model_version_id,evidence_snapshot_hash)
        values(%s::uuid,%s,%s,%s,%s::uuid,%s)
    """,(base["id"],seq,evidence_type,probability,model_id,h))
    return seq,h,True


def publish_read_model(conn, fixture: dict[str,Any], episode: dict[str,Any], base: dict[str,Any], prediction: dict[str,Any], gate: dict[str,Any], seq: int, evidence_hash: str, market: dict[str,Any] | None, now: datetime) -> int:
    row=conn.execute("select version from public.prediction_read_models where fixture_id=%s::uuid and episode_id=%s::uuid limit 1",(fixture["id"],episode["id"])).fetchone()
    version=int(row["version"] or 0)+1 if row else 1
    p=prediction["probabilities"]; top=max((("HOME",p["home"]),("DRAW",p["draw"]),("AWAY",p["away"])),key=lambda x:x[1])
    kickoff=utc(fixture["kickoff_at"]); locked=kickoff<=now
    payload={"schema_version":"prediction-read-model-v1","publication_status":"SHADOW_PUBLISHED","fixture_id":fixture["id"],"episode_id":episode["id"],"kickoff_at":kickoff.isoformat(),"locked":locked,"locked_at":kickoff.isoformat() if locked else None,"baseline":{"id":base["id"],"pick":base["baseline_pick"],"probability":float(base["baseline_probability"]),"hash":base["baseline_hash"]},"assessment":{"pick":top[0],"probability":float(top[1]),"probabilities":p,"fair_odds":{k:1.0/max(1e-12,float(v)) for k,v in p.items()}},"evidence":{"sequence":seq,"snapshot_hash":evidence_hash},"gate":gate,"market_snapshot":market,"model_version_id":prediction["model_version_id"],"artifact_sha256":prediction["artifact_sha256"],"calibration_version":prediction["calibration_version"],"published_at":now.isoformat()}
    conn.execute("""
        insert into public.prediction_read_models(fixture_id,episode_id,version,payload,published_at)
        values(%s::uuid,%s::uuid,%s,%s::jsonb,%s)
        on conflict (fixture_id,episode_id) do update set version=excluded.version,payload=excluded.payload,published_at=excluded.published_at
    """,(fixture["id"],episode["id"],version,json.dumps(payload,default=str),now))
    return version


def process(conn, fixture: dict[str,Any], episode: dict[str,Any], release: dict[str,Any], model: dict[str,Any], pol: dict[str,Any], artifact: dict[str,Any], artifact_sha: str, cal_version: str, cal_status: str, training_status: str | None, temperature: float, now: datetime) -> dict[str,Any]:
    prediction=predict_fixture(fixture,artifact,temperature); snapshot=market_snapshot(conn,fixture["id"],utc(fixture["kickoff_at"]),now)
    gate=record_gate(conn,fixture=fixture,episode=episode,model=model,release=release,artifact=artifact,artifact_sha=artifact_sha,cal_status=cal_status,training_status=training_status,probabilities=prediction["probabilities"],now=now,snapshot=snapshot)
    base=baseline(conn,episode["id"]); created=False
    if gate["eligible"] and not base:
        p=prediction["probabilities"]; top=max((("HOME",p["home"]),("DRAW",p["draw"]),("AWAY",p["away"])),key=lambda x:x[1])
        bh=sha256_json({"episode_id":episode["id"],"fixture_id":fixture["id"],"model_version_id":model["id"],"policy_bundle_id":pol["id"],"calibration_policy":cal_version,"artifact_sha256":artifact_sha,"lambdas":prediction["lambdas"],"raw_probabilities":prediction.get("raw",{}),"probabilities":p})
        base=conn.execute("""
            insert into public.prediction_baselines(episode_id,model_version_id,policy_bundle_id,baseline_pick,baseline_probability,baseline_hash)
            values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s)
            returning id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash
        """,(episode["id"],model["id"],pol["id"],top[0],top[1],bh)).fetchone(); created=True
        with conn.cursor() as cur:
            cur.executemany("""
                insert into public.prediction_market_states(baseline_id,episode_id,market_key,probability,fair_odds,status,updated_at)
                values(%s::uuid,%s::uuid,%s,%s,%s,'SHADOW',%s)
                on conflict (episode_id,market_key) do update set baseline_id=excluded.baseline_id,probability=excluded.probability,fair_odds=excluded.fair_odds,updated_at=excluded.updated_at
            """,[(base["id"],episode["id"],k,v,1.0/max(1e-12,float(v)),now) for k,v in (("1x2_home",p["home"]),("1x2_draw",p["draw"]),("1x2_away",p["away"]))])
    if not base:
        return {"fixture_id":fixture["id"],"status":"GATE_BLOCKED","gate":gate,"baseline_created":False,"read_model_published":False}
    if base["model_version_id"]!=model["id"] or base["policy_bundle_id"]!=pol["id"]:
        return {"fixture_id":fixture["id"],"status":"BASELINE_CONFLICT","gate":gate,"baseline_created":False,"read_model_published":False}
    if snapshot: persist_market_evidence(conn,fixture["id"],episode["id"],model["id"],snapshot)
    etype="BASELINE_CREATED" if created else ("MARKET_EVIDENCE_UPDATE" if snapshot else "RUNTIME_REASSESSMENT")
    seq,eh,new_evidence=append_evidence(conn,base,model["id"],etype,max(prediction["probabilities"].values()),snapshot,artifact_sha)
    pred={**prediction,"model_version_id":model["id"],"artifact_sha256":artifact_sha,"calibration_version":cal_version}
    market={"probabilities":snapshot["probabilities"],"bookmaker_count":snapshot["bookmaker_count"],"snapshot_at":snapshot["snapshot_at"]} if snapshot else None
    rm=publish_read_model(conn,fixture,episode,base,pred,gate,seq,eh,market,now)
    return {"fixture_id":fixture["id"],"status":"PUBLISHED_SHADOW" if gate["eligible"] else "BASELINE_EXISTS","gate":gate,"baseline_id":base["id"],"baseline_created":created,"evidence_created":new_evidence,"evidence_seq":seq,"read_model_published":True,"read_model_version":rm}


def main() -> None:
    now=datetime.now(timezone.utc)
    with db_connect() as conn:
        release, loaded_model = load_model(conn); model=dict(loaded_model)
        cutoff_row=conn.execute("select training_cutoff from public.model_versions where id=%s::uuid",(model["id"],)).fetchone()
        model["training_cutoff"]=cutoff_row["training_cutoff"] if cutoff_row else None
        artifact,artifact_sha=load_artifact(model["artifact_uri"]); temperature,cal_version,cal_status=calibration(conn); training=training_state(conn,model["id"]); pol=policy(conn); markets(conn)
        fixtures=conn.execute("""
            select f.id::text as id,f.home_team_id::text,f.away_team_id::text,f.kickoff_at,f.status,e.id::text as episode_id,e.episode_status,e.episode_no
            from public.fixtures f join public.fixture_episodes e on e.fixture_id=f.id and e.episode_status='ACTIVE'
            where f.status='scheduled' and f.kickoff_at>=%s and f.kickoff_at<%s
            order by f.kickoff_at asc limit 100
        """,(now,now+timedelta(days=T7_DAYS))).fetchall()
        results=[]
        for row in fixtures:
            fixture=dict(row); episode={"id":row["episode_id"],"fixture_id":row["id"],"episode_status":row["episode_status"],"episode_no":row["episode_no"]}
            try:
                with conn.transaction(): results.append(process(conn,fixture,episode,release,model,pol,artifact,artifact_sha,cal_version,cal_status,training.get("status"),temperature,now))
            except Exception as exc:
                results.append({"fixture_id":row["id"],"status":"ERROR","error":str(exc)})
        key=provider_key(conn); settled=settle(conn,model["id"],key); benchmarks=build_benchmarks(conn,model["id"]); conn.commit()
        errors=[r for r in results if r.get("status")=="ERROR"]
        print(json.dumps({"ok":not errors,"mode":"github-actions","lifecycle":"prediction-lifecycle-v1","baseline_window":{"from":now.isoformat(),"to":(now+timedelta(days=T7_DAYS)).isoformat()},"model_version_id":model["id"],"release_version":release["release_version"],"artifact_sha256":artifact_sha,"calibration":{"version":cal_version,"temperature":temperature,"status":cal_status},"training_status":training.get("status"),"fixtures_considered":len(fixtures),"baseline_created":sum(1 for r in results if r.get("baseline_created")),"gate_blocked":sum(1 for r in results if r.get("status")=="GATE_BLOCKED"),"evidence_updates_created":sum(1 for r in results if r.get("evidence_created")),"read_models_published":sum(1 for r in results if r.get("read_model_published")),"settled_results_written":settled,"market_benchmarks_written":benchmarks,"errors":errors},indent=2,default=str))
        if errors: raise RuntimeError(f"prediction_lifecycle_errors:{len(errors)}")


if __name__ == "__main__": main()
