from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlparse
import base64, gzip, hashlib, json, os
import boto3
from botocore.config import Config

HISTORICAL_DATASETS={"fixture_statistics","fixture_players_statistics","fixture_events","lineups","standings","team_statistics","team_seasons","squads","players","coaches","transfers","team_countries","top_scorers","player_statistics","top_yellow_cards","top_red_cards","top_assists"}
STAT_ALIASES={"ball possession":"possession_pct","possession":"possession_pct","total shots":"shots","shots on goal":"shots_on_target","shots on target":"shots_on_target","corner kicks":"corners","fouls":"fouls","yellow cards":"yellow_cards","red cards":"red_cards","offsides":"offsides","total passes":"passes","passes accurate":"passes_accurate","expected goals":"xg"}

@dataclass(frozen=True)
class FeatureSnapshot:
    values: dict[str,float]=field(default_factory=dict)
    available: dict[str,bool]=field(default_factory=dict)
    sources: tuple[str,...]=()
    def get(self,key:str,default:float|None=None): return self.values.get(key,default)

def _utc(v):
    if v is None:return None
    d=v if isinstance(v,datetime) else datetime.fromisoformat(str(v).replace("Z","+00:00"))
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)

def _decode_archive(value:Any)->Any:
    current=value
    for _ in range(6):
        if isinstance(current,bytes):
            raw=current
            if raw[:2]==b"\x1f\x8b":
                try:raw=gzip.decompress(raw)
                except (OSError,EOFError):return value
            try:current=raw.decode('utf-8');continue
            except UnicodeDecodeError:return value
        if not isinstance(current,str):return current
        text=current.strip()
        if not text:return current
        try:return json.loads(text)
        except (TypeError,ValueError):
            if len(text)>=32 and len(text)%4==0:
                try:decoded=base64.b64decode(text,validate=True)
                except (ValueError,base64.binascii.Error):decoded=None
                if decoded:
                    current=decoded;continue
            lines=[line.strip() for line in text.splitlines() if line.strip()]
            parsed=[]
            for line in lines:
                try:item=json.loads(line)
                except (TypeError,ValueError):parsed=[];break
                parsed.append(item)
            return parsed if parsed else current
    return current

def _walk(v:Any)->Iterable[dict[str,Any]]:
    if isinstance(v,list):
        for x in v:yield from _walk(x)
    elif isinstance(v,dict):
        yield v
        for x in v.values():yield from _walk(x)

def _fixture_id(o):
    f=o.get("fixture")
    if isinstance(f,dict) and f.get("id") is not None:return str(f["id"])
    for k in ("fixture_id","fixtureId","match_id","matchId"):
        if o.get(k) is not None:return str(o[k])
    return None

def _team_id(o):
    t=o.get("team")
    if isinstance(t,dict) and t.get("id") is not None:return str(t["id"])
    for k in ("team_id","teamId","match_hometeam_id","match_awayteam_id"):
        if o.get(k) is not None:return str(o[k])
    return None

def _number(v):
    if v is None or isinstance(v,bool):return None
    if isinstance(v,(int,float)):return float(v)
    if isinstance(v,str):
        s=v.strip().replace("%","")
        if s in {"","-","null","None"}:return None
        try:return float(s)
        except ValueError:return None
    return None

def _stats(o):
    stats=o.get("statistics")
    if not isinstance(stats,list):return
    for item in stats:
        if not isinstance(item,dict):continue
        key=STAT_ALIASES.get(str(item.get("type","")).strip().lower()); n=_number(item.get("value"))
        if key and n is not None:yield key,n

def _events(o):
    out={}; typ=str(o.get("type","")).lower(); detail=str(o.get("detail","")).lower()
    if "card" in typ or "card" in detail:
        if "red" in detail:out["red_cards"]=1.0
        elif "yellow" in detail:out["yellow_cards"]=1.0
    if "corner" in typ or "corner" in detail:out["corners"]=1.0
    if "goal" in typ:out["goals"]=1.0
    return out

def _s3():
    endpoint=os.environ.get("S3_ENDPOINT_URL") or None
    return boto3.client("s3",region_name=os.environ.get("S3_REGION","eu-north-1"),endpoint_url=endpoint,aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],config=Config(retries={"max_attempts":5,"mode":"standard"}))

def _uri(uri):
    p=urlparse(uri)
    if p.scheme!="s3" or not p.netloc or not p.path.lstrip("/"):raise ValueError(f"invalid S3 object URI: {uri}")
    return p.netloc,p.path.lstrip("/")

def _matches(conn):
    from .archive_training_source import load_settled_matches
    return {m.match_id:(_utc(m.played_at),m.home_team_id,m.away_team_id) for m in load_settled_matches(conn,as_of=datetime.now(timezone.utc))}

def _aliases(conn):
    with conn.cursor() as cur:
        cur.execute("select external_team_id::text as external_team_id, team_id::text as team_id from public.team_aliases where provider='api-football'")
        return {r["external_team_id"]:r["team_id"] for r in cur.fetchall() if r["external_team_id"] and r["team_id"]}

def _manifests(conn,latest):
    with conn.cursor() as cur:
        cur.execute("select manifest_id::text as id,dataset_type,object_uri,checksum,date_end from internal.archive_catalog where provider='api-football' and object_uri like 's3://%%' and completeness_score>=0.0 and dataset_type=any(%s) and date_end is not null and date_end<%s order by date_end,manifest_id",(list(HISTORICAL_DATASETS),latest))
        return cur.fetchall()

def _observation_available_at(dataset:str,played:datetime,date_end:datetime|None)->datetime|None:
    if dataset in {"fixture_statistics","fixture_players_statistics","fixture_events","lineups"}: return played
    return _utc(date_end) if date_end is not None else None

def build_feature_index(conn,target_matches,latest_target=None):
    targets=list(target_matches)
    if not targets:return {}
    latest=_utc(latest_target) if latest_target else max(_utc(m.played_at) for m in targets)
    matches=_matches(conn); aliases=_aliases(conn); history={}; s3=_s3()
    for row in _manifests(conn,latest):
        bucket,key=_uri(row["object_uri"]); raw=s3.get_object(Bucket=bucket,Key=key)["Body"].read()
        if hashlib.sha256(raw).hexdigest()!=row["checksum"]:raise RuntimeError(f"archive checksum mismatch:{row['id']}")
        manifest_end=_utc(row["date_end"]) if row["date_end"] is not None else None; dataset=row["dataset_type"]
        decoded=_decode_archive(raw)
        for o in _walk(decoded):
            fid=_fixture_id(o)
            if not fid or fid not in matches:continue
            played,_,_=matches[fid]; external_tid=_team_id(o); tid=aliases.get(str(external_tid)) if external_tid is not None else None
            if tid is None and external_tid is not None:tid=f"api-football:{str(external_tid)}"
            if not tid:continue
            vals={}
            if dataset in {"fixture_statistics","fixture_players_statistics"}:
                for k,v in _stats(o):vals[f"{dataset}.{k}"]=v
            elif dataset=="fixture_events": vals.update({f"{dataset}.{k}":v for k,v in _events(o).items()})
            elif dataset=="lineups":
                if isinstance(o.get("startXI"),list):vals["lineups.starting_xi"]=float(len(o["startXI"]))
                if isinstance(o.get("substitutes"),list):vals["lineups.substitutes"]=float(len(o["substitutes"]))
            else:
                for k,v in o.items():
                    if k in {"id","team_id","teamId","fixture_id","fixtureId","season","league_id"}:continue
                    n=_number(v)
                    if n is not None:vals[f"{dataset}.{str(k).lower().replace(' ','_')}"]=n
            if vals:
                available_at=_observation_available_at(dataset,played,manifest_end)
                history.setdefault(tid,[]).append((played,available_at,vals,dataset))
    for rows in history.values():rows.sort(key=lambda x:(x[0],x[1] or x[0]))
    out={}
    for m in targets:
        kickoff=_utc(m.played_at); values={}; sources=set()
        for side,tid in (("home",m.home_team_id),("away",m.away_team_id)):
            rows=[r for r in history.get(tid,[]) if r[0]<kickoff and r[1] is not None and r[1]<kickoff][-5:]
            grouped={}
            for _,_,vals,dataset in rows:
                sources.add(dataset)
                for k,v in vals.items():grouped.setdefault(k,[]).append(v)
            for k,vs in grouped.items():
                values[f"{side}.last5.{k}.mean"]=sum(vs)/len(vs); values[f"{side}.last5.{k}.count"]=float(len(vs))
        out[m.match_id]=FeatureSnapshot(values,{k:True for k in values},tuple(sorted(sources)))
    return out

def build_feature_index_for_matches(conn,matches,cutoff):
    selected=[m for m in matches if _utc(m.played_at)>=_utc(cutoff)]
    return build_feature_index(conn,selected)
