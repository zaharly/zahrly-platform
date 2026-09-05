from __future__ import annotations

import json
from datetime import datetime,timedelta,timezone
from typing import Any

from workers.prediction_engine.market_derivations import derive_count_markets,derive_goal_markets
from workers.prediction_engine.prediction_inference import _team_params,predict_fixture
from workers.prediction_engine.prediction_model_core import build_benchmarks,calibration,db_connect,load_artifact,load_model,provider_key,settle,sha256_json

T7_DAYS=7
BASELINE_GATE_VERSION="baseline-gates-v1"
CORE_MARKET_POLICY="prediction-v1"
GOAL_LINES=(0.5,1.5,2.5,3.5,4.5)
TEAM_GOAL_LINES=(0.5,1.5,2.5,3.5)
CORNERS_LINES=(4.5,5.5,6.5,7.5,8.5,9.5,10.5)
CARDS_LINES=(1.5,2.5,3.5,4.5,5.5,6.5)


def utc(v:Any)->datetime:
    if isinstance(v,datetime):return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    d=datetime.fromisoformat(str(v).replace("Z","+00:00"));return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse_cutoff(v:Any)->datetime|None:
    if v in (None,""):return None
    try:return utc(v)
    except (TypeError,ValueError):return None


def valid_probabilities(p:dict[str,Any])->bool:
    try:values=[float(p[k]) for k in ("home","draw","away")]
    except (KeyError,TypeError,ValueError):return False
    return all(0<=x<=1 for x in values) and abs(sum(values)-1)<=1e-6


def state_coverage(artifact:dict[str,Any],fixture:dict[str,Any]):
    checks=[];missing=[];sources={}
    for side,tid in (("home",str(fixture["home_team_id"])),("away",str(fixture["away_team_id"]))):
        try:
            *_unused,source=_team_params(artifact,tid);checks.append(True);sources[side]=source
        except Exception:checks.append(False);missing.append(f"{side}.team_state")
    return sum(checks)/2.0,missing,sources


def model_health(release,model,artifact,calibration_status,training_status,artifact_sha):
    errors=[]
    if str(release.get("status","")).upper()!="SHADOW":errors.append("release_not_shadow")
    if not model.get("artifact_uri"):errors.append("artifact_uri_missing")
    if not artifact_sha:errors.append("artifact_hash_missing")
    if training_status!="SUCCEEDED":errors.append("training_not_succeeded")
    if calibration_status not in {"VALIDATED","ACTIVE"}:errors.append("calibration_not_validated")
    dc=artifact.get("dixon_coles") or {}
    try:rate=float(dc.get("league_rate",0) or 0)
    except (TypeError,ValueError):rate=0
    if not 0.25<=rate<=4.0:errors.append("league_rate_out_of_bounds")
    if not dc.get("attack") or not dc.get("defense"):errors.append("dixon_coles_parameters_missing")
    return ("HEALTHY" if not errors else "UNHEALTHY"),errors


def training_state(conn,model_id):
    return conn.execute("select id::text as id,status,metrics,started_at from public.prediction_training_runs where model_version_id=%s::uuid order by started_at desc limit 1",(model_id,)).fetchone() or {}


def policy(conn):
    row=conn.execute("select id::text as id,version,payload from public.policy_versions where policy_type='prediction' and version=%s limit 1",(CORE_MARKET_POLICY,)).fetchone()
    if row:return row
    return conn.execute("insert into public.policy_versions(policy_type,version,payload) values('prediction',%s,%s::jsonb) returning id::text as id,version,payload",(CORE_MARKET_POLICY,json.dumps({"schema_version":"prediction-policy-v1","default_mode":"shadow"}))).fetchone()


def markets(conn):
    rows=[("1x2_home","1X2","HOME_WIN"),("1x2_draw","1X2","DRAW"),("1x2_away","1X2","AWAY_WIN"),("double_chance_1x","DOUBLE_CHANCE","1X"),("double_chance_x2","DOUBLE_CHANCE","X2"),("double_chance_12","DOUBLE_CHANCE","12"),("btts_yes","BTTS","YES"),("btts_no","BTTS","NO")]
    for line in GOAL_LINES:
        k=str(line).replace(".","_");rows += [(f"goals_over_{k}","GOALS_OU",f"OVER_{line}"),(f"goals_under_{k}","GOALS_OU",f"UNDER_{line}")]
    for side in ("home","away"):
        for line in TEAM_GOAL_LINES:
            k=str(line).replace(".","_");rows += [(f"{side}_goals_over_{k}","TEAM_GOALS_OU",f"OVER_{side}_{line}"),(f"{side}_goals_under_{k}","TEAM_GOALS_OU",f"UNDER_{side}_{line}")]
    for line in CORNERS_LINES:
        k=str(line).replace(".","_");rows += [(f"corners_over_{k}","CORNERS_OU",f"OVER_{line}"),(f"corners_under_{k}","CORNERS_OU",f"UNDER_{line}")]
    for line in CARDS_LINES:
        k=str(line).replace(".","_");rows += [(f"cards_over_{k}","CARDS_OU",f"OVER_{line}"),(f"cards_under_{k}","CARDS_OU",f"UNDER_{line}")]
    with conn.cursor() as cur:
        cur.executemany("insert into public.market_registry(market_key,family,settlement_type,status,production_policy_version) values(%s,%s,%s,'EXPERIMENTAL',%s) on conflict (market_key) do update set family=excluded.family,settlement_type=excluded.settlement_type,production_policy_version=excluded.production_policy_version",[(k,f,s,CORE_MARKET_POLICY) for k,f,s in rows])


def market_snapshot(conn,fixture_id,kickoff,as_of):
    rows=conn.execute("select bookmaker_id,selection,odds,captured_at from public.odds_snapshots where fixture_id=%s::uuid and captured_at<=%s and captured_at<%s and market_key in ('1X2','match_result','home_draw_away') and odds>1 order by bookmaker_id,selection,captured_at",(fixture_id,as_of,kickoff)).fetchall()
    mapping={"HOME":"H","H":"H","1":"H","DRAW":"D","D":"D","X":"D","AWAY":"A","A":"A","2":"A"};books={}
    for r in rows:
        s=mapping.get(str(r["selection"]).strip().upper())
        if s:books.setdefault(str(r["bookmaker_id"]),{}).setdefault(s,[]).append((float(r["odds"]),utc(r["captured_at"])))
    normalized=[];latest=None
    for book in books.values():
        if set(book)!={"H","D","A"}:continue
        closing={k:max(book[k],key=lambda x:x[1]) for k in ("H","D","A")};inv=[1/closing[k][0] for k in ("H","D","A")];total=sum(inv)
        if total<=0:continue
        normalized.append([x/total for x in inv]);at=max(x[1] for x in closing.values());latest=at if latest is None or at>latest else latest
    if not normalized:return None
    return {"probabilities":[sum(v[i] for v in normalized)/len(normalized) for i in range(3)],"bookmaker_count":len(normalized),"snapshot_at":latest}


def persist_market_evidence(conn,fixture_id,episode_id,model_id,snapshot):
    payload={"home":snapshot["probabilities"][0],"draw":snapshot["probabilities"][1],"away":snapshot["probabilities"][2]};h=sha256_json({"fixture_id":fixture_id,"model_version_id":model_id,"market":payload,"snapshot_at":snapshot["snapshot_at"]})
    conn.execute("insert into internal.prediction_market_evidence(fixture_id,episode_id,model_version_id,market_key,probabilities,bookmaker_count,snapshot_at,source,source_snapshot_hash) values(%s::uuid,%s::uuid,%s::uuid,'1x2',%s::jsonb,%s,%s,'github-actions:pre-match-odds',%s) on conflict (fixture_id,model_version_id,market_key) do update set probabilities=excluded.probabilities,bookmaker_count=excluded.bookmaker_count,snapshot_at=excluded.snapshot_at,source_snapshot_hash=excluded.source_snapshot_hash",(fixture_id,episode_id,model_id,json.dumps(payload),snapshot["bookmaker_count"],snapshot["snapshot_at"],h));return h


def append_evidence(conn,base,model_id,evidence_type,probability,snapshot,artifact_sha):
    h=sha256_json({"baseline_hash":base["baseline_hash"],"model_version_id":model_id,"artifact_sha256":artifact_sha,"evidence_type":evidence_type,"market_snapshot":snapshot,"probability":probability});existing=conn.execute("select evidence_seq from public.prediction_evidence_updates where baseline_id=%s::uuid and evidence_snapshot_hash=%s limit 1",(base["id"],h)).fetchone()
    if existing:return int(existing["evidence_seq"] or 1),h,False
    seq=int(conn.execute("select coalesce(max(evidence_seq),0)+1 as next_seq from public.prediction_evidence_updates where baseline_id=%s::uuid",(base["id"],)).fetchone()["next_seq"]);conn.execute("insert into public.prediction_evidence_updates(baseline_id,evidence_seq,evidence_type,current_probability,model_version_id,evidence_snapshot_hash) values(%s::uuid,%s,%s,%s,%s::uuid,%s)",(base["id"],seq,evidence_type,probability,model_id,h));return seq,h,True


def persist_market_states(conn,baseline_id,episode_id,market_map,status):
    rows=[]
    for key,item in market_map.items():
        p=float(item.get("probability"))
        if 0<=p<=1:rows.append((baseline_id,episode_id,key,p,1/max(1e-12,p),status))
    if rows:
        with conn.cursor() as cur:cur.executemany("insert into public.prediction_market_states(baseline_id,episode_id,market_key,probability,fair_odds,status,updated_at) values(%s::uuid,%s::uuid,%s,%s,%s,%s,now()) on conflict (episode_id,market_key) do update set baseline_id=excluded.baseline_id,probability=excluded.probability,fair_odds=excluded.fair_odds,status=excluded.status,updated_at=now()",rows)
    return len(rows)


def derived_markets(prediction,artifact):
    result=derive_goal_markets(prediction["score_matrix"])
    result.update(derive_count_markets(artifact.get("corners"),"CORNERS_OU","corners",CORNERS_LINES))
    result.update(derive_count_markets(artifact.get("cards"),"CARDS_OU","cards",CARDS_LINES))
    return result


def record_gate(conn,fixture,episode,model,release,artifact,artifact_sha,cal_status,training_status,probabilities,now,snapshot):
    kickoff=utc(fixture["kickoff_at"]);hours=(kickoff-now).total_seconds()/3600;identity=1.0 if fixture.get("home_team_id") and fixture.get("away_team_id") and episode.get("id") else 0.0;coverage,missing,sources=state_coverage(artifact,fixture);health,health_errors=model_health(release,model,artifact,cal_status,training_status,artifact_sha);cutoff=parse_cutoff(model.get("training_cutoff") or artifact.get("training_cutoff") or (artifact.get("metadata") or {}).get("training_cutoff"));no_leak=bool(cutoff and cutoff<kickoff and cutoff<=now)
    if snapshot and snapshot.get("snapshot_at"):
        s=utc(snapshot["snapshot_at"]);no_leak=no_leak and s<=now and s<kickoff
    canonical=str(fixture.get("status","")).lower()=="scheduled" and str(episode.get("episode_status","")).upper()=="ACTIVE" and kickoff>now;prob_ok=valid_probabilities(probabilities);eligible=(0<=hours<=168 and canonical and identity>=1 and coverage>=1 and health=="HEALTHY" and no_leak and prob_ok)
    details={"t_minus_hours":hours,"training_cutoff":model.get("training_cutoff") or artifact.get("training_cutoff"),"missing_features":missing,"team_state_sources":sources,"model_health_errors":health_errors,"artifact_sha256":artifact_sha,"calibration_status":cal_status,"market_snapshot_at":snapshot.get("snapshot_at") if snapshot else None}
    conn.execute("insert into internal.prediction_baseline_gate_evaluations(episode_id,fixture_id,model_version_id,gate_version,evaluated_at,eligible,canonical_fixture_valid,identity_quality,minimum_feature_coverage,model_health,no_future_leakage,probability_state_valid,t_minus_hours,details) values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)",(episode["id"],fixture["id"],model["id"],BASELINE_GATE_VERSION,now,eligible,canonical,identity,coverage,health,no_leak,prob_ok,hours,json.dumps(details,default=str)))
    return {"eligible":eligible,"canonical_fixture_valid":canonical,"identity_quality":identity,"minimum_feature_coverage":coverage,"model_health":health,"no_future_leakage":no_leak,"probability_state_valid":prob_ok,"t_minus_hours":hours,"team_state_sources":sources}


def baseline(conn,episode_id):return conn.execute("select id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash from public.prediction_baselines where episode_id=%s::uuid limit 1",(episode_id,)).fetchone()


def publish_read_model(conn,fixture,episode,base,prediction,market_map,gate,seq,evidence_hash,market,now):
    row=conn.execute("select version from public.prediction_read_models where fixture_id=%s::uuid and episode_id=%s::uuid limit 1",(fixture["id"],episode["id"])).fetchone();version=int(row["version"] or 0)+1 if row else 1;p=prediction["probabilities"];top=max((("HOME",p["home"]),("DRAW",p["draw"]),("AWAY",p["away"])),key=lambda x:x[1]);kickoff=utc(fixture["kickoff_at"])
    payload={"schema_version":"prediction-read-model-v2","publication_status":"SHADOW_PUBLISHED","fixture_id":fixture["id"],"episode_id":episode["id"],"kickoff_at":kickoff.isoformat(),"locked":kickoff<=now,"locked_at":kickoff.isoformat() if kickoff<=now else None,"baseline":{"id":base["id"],"pick":base["baseline_pick"],"probability":float(base["baseline_probability"]),"hash":base["baseline_hash"]},"assessment":{"pick":top[0],"probability":float(top[1]),"probabilities":p,"fair_odds":{k:1/max(1e-12,float(v)) for k,v in p.items()}},"markets":market_map,"evidence":{"sequence":seq,"snapshot_hash":evidence_hash},"gate":gate,"market_snapshot":market,"model_version_id":prediction["model_version_id"],"artifact_sha256":prediction["artifact_sha256"],"calibration_version":prediction["calibration_version"],"published_at":now.isoformat()}
    conn.execute("insert into public.prediction_read_models(fixture_id,episode_id,version,payload,published_at) values(%s::uuid,%s::uuid,%s,%s::jsonb,%s) on conflict (fixture_id,episode_id) do update set version=excluded.version,payload=excluded.payload,published_at=excluded.published_at",(fixture["id"],episode["id"],version,json.dumps(payload,default=str),now));return version


def process(conn,fixture,episode,release,model,pol,artifact,artifact_sha,cal_version,cal_status,training_status,temperature,now):
    prediction=predict_fixture(fixture,artifact,temperature);snapshot=market_snapshot(conn,fixture["id"],utc(fixture["kickoff_at"]),now);gate=record_gate(conn,fixture,episode,model,release,artifact,artifact_sha,cal_status,training_status,prediction["probabilities"],now,snapshot);base=baseline(conn,episode["id"]);created=False
    if gate["eligible"] and not base:
        p=prediction["probabilities"];top=max((("HOME",p["home"]),("DRAW",p["draw"]),("AWAY",p["away"])),key=lambda x:x[1]);bh=sha256_json({"episode_id":episode["id"],"fixture_id":fixture["id"],"model_version_id":model["id"],"policy_bundle_id":pol["id"],"calibration_policy":cal_version,"artifact_sha256":artifact_sha,"state_sources":prediction.get("state_sources"),"lambdas":prediction["lambdas"],"raw_probabilities":prediction.get("raw",{}),"probabilities":p});base=conn.execute("insert into public.prediction_baselines(episode_id,model_version_id,policy_bundle_id,baseline_pick,baseline_probability,baseline_hash) values(%s::uuid,%s::uuid,%s::uuid,%s,%s,%s) returning id::text as id,model_version_id::text as model_version_id,policy_bundle_id::text as policy_bundle_id,baseline_pick,baseline_probability,baseline_hash",(episode["id"],model["id"],pol["id"],top[0],top[1],bh)).fetchone();created=True
    if not base:return {"fixture_id":fixture["id"],"status":"GATE_BLOCKED","gate":gate,"baseline_created":False,"read_model_published":False}
    if base["model_version_id"]!=model["id"] or base["policy_bundle_id"]!=pol["id"]:return {"fixture_id":fixture["id"],"status":"BASELINE_CONFLICT","gate":gate,"baseline_created":False,"read_model_published":False}
    market_map=derived_markets(prediction,artifact);market_hash=persist_market_evidence(conn,fixture["id"],episode["id"],model["id"],snapshot) if snapshot else None;market_count=persist_market_states(conn,base["id"],episode["id"],market_map,"SHADOW");same_key={"HOME":"home","DRAW":"draw","AWAY":"away"}[base["baseline_pick"]];same_pick=float(prediction["probabilities"].get(same_key,base["baseline_probability"]));etype="BASELINE_CREATED" if created else ("MARKET_EVIDENCE_UPDATE" if snapshot else "RUNTIME_REASSESSMENT");seq,eh,new=append_evidence(conn,base,model["id"],etype,same_pick,snapshot,artifact_sha);pred={**prediction,"model_version_id":model["id"],"artifact_sha256":artifact_sha,"calibration_version":cal_version};market={"probabilities":snapshot["probabilities"],"bookmaker_count":snapshot["bookmaker_count"],"snapshot_at":snapshot["snapshot_at"]} if snapshot else None;rm=publish_read_model(conn,fixture,episode,base,pred,market_map,gate,seq,eh,market,now)
    return {"fixture_id":fixture["id"],"status":"PUBLISHED_SHADOW" if gate["eligible"] else "BASELINE_EXISTS","gate":gate,"baseline_id":base["id"],"baseline_created":created,"evidence_created":new,"evidence_seq":seq,"read_model_published":True,"read_model_version":rm,"market_count":market_count,"corners_supported":any(k.startswith("corners_") for k in market_map),"cards_supported":any(k.startswith("cards_") for k in market_map),"market_snapshot_hash":market_hash}


def main():
    now=datetime.now(timezone.utc)
    with db_connect() as conn:
        release,loaded=load_model(conn);model=dict(loaded);artifact,artifact_sha=load_artifact(model["artifact_uri"]);temperature,cal_version,cal_status=calibration(conn);training=training_state(conn,model["id"]);pol=policy(conn);markets(conn)
        fixtures=conn.execute("select f.id::text as id,f.home_team_id::text,f.away_team_id::text,f.kickoff_at,f.status,e.id::text as episode_id,e.episode_status,e.episode_no from public.fixtures f join public.fixture_episodes e on e.fixture_id=f.id and e.episode_status='ACTIVE' where f.status='scheduled' and f.kickoff_at>=%s and f.kickoff_at<%s order by f.kickoff_at asc limit 100",(now,now+timedelta(days=T7_DAYS))).fetchall();results=[]
        for row in fixtures:
            fixture=dict(row);episode={"id":row["episode_id"],"fixture_id":row["id"],"episode_status":row["episode_status"],"episode_no":row["episode_no"]}
            try:
                with conn.transaction():results.append(process(conn,fixture,episode,release,model,pol,artifact,artifact_sha,cal_version,cal_status,training.get("status"),temperature,now))
            except Exception as exc:results.append({"fixture_id":row["id"],"status":"ERROR","error":str(exc)})
        key=provider_key(conn);settled=settle(conn,model["id"],key);benchmarks=build_benchmarks(conn,model["id"]);conn.commit();errors=[r for r in results if r.get("status")=="ERROR"]
        print(json.dumps({"ok":not errors,"mode":"github-actions","lifecycle":"prediction-lifecycle-v3","baseline_window":{"from":now.isoformat(),"to":(now+timedelta(days=T7_DAYS)).isoformat()},"model_version_id":model["id"],"release_version":release["release_version"],"artifact_sha256":artifact_sha,"calibration":{"version":cal_version,"temperature":temperature,"status":cal_status},"training_status":training.get("status"),"fixtures_considered":len(fixtures),"baseline_created":sum(1 for r in results if r.get("baseline_created")),"gate_blocked":sum(1 for r in results if r.get("status")=="GATE_BLOCKED"),"evidence_updates_created":sum(1 for r in results if r.get("evidence_created")),"read_models_published":sum(1 for r in results if r.get("read_model_published")),"market_counts":{"avg":sum(int(r.get("market_count",0)) for r in results)/len(results) if results else 0,"corners_supported":sum(1 for r in results if r.get("corners_supported")),"cards_supported":sum(1 for r in results if r.get("cards_supported"))},"settled_results_written":settled,"market_benchmarks_written":benchmarks,"errors":errors},indent=2,default=str))
        if errors:raise RuntimeError(f"prediction_lifecycle_errors:{len(errors)}")


if __name__=="__main__":main()
