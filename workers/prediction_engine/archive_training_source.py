from __future__ import annotations
import hashlib,json,os
from dataclasses import dataclass
from datetime import datetime,timezone
from urllib.parse import urlparse
import boto3,psycopg
from botocore.config import Config
from psycopg.rows import dict_row
from .walk_forward import Match
from .season_resolver import resolve_season
from .archive_payload_adapters import walk_fixture_rows

@dataclass(frozen=True)
class ArchiveManifest:
    manifest_id:str;object_uri:str;checksum:str;row_count:int;date_start:datetime|None;date_end:datetime|None;season:int

def _env(name,default=None):
    v=os.environ.get(name,'').strip()
    if v:return v
    if default is not None:return default
    raise RuntimeError(f'missing required environment variable: {name}')

def db_connect():return psycopg.connect(_env('SUPABASE_DB_URL'),row_factory=dict_row,connect_timeout=15)

def _configured_complete_seasons():
    raw=os.environ.get('ARCHIVE_COMPLETE_SEASONS','').strip()
    if not raw:return None
    try:return {int(x.strip()) for x in raw.split(',') if x.strip()}
    except ValueError as exc:raise RuntimeError(f'invalid ARCHIVE_COMPLETE_SEASONS: {raw!r}') from exc

def fetch_complete_archive_seasons(conn,min_completeness=1.0):
    configured=_configured_complete_seasons()
    if configured is not None:return configured
    with conn.cursor() as cur:
        cur.execute("select season from internal.archive_catalog where provider='api-football' group by season having min(completeness_score) >= %s order by season",(min_completeness,))
        return {int(row['season']) for row in cur.fetchall()}

def fetch_fixture_manifests(conn,min_completeness=1.0,complete_seasons=None):
    complete_seasons=set(complete_seasons if complete_seasons is not None else fetch_complete_archive_seasons(conn,min_completeness))
    if not complete_seasons:return []
    with conn.cursor() as cur:
        cur.execute("""select manifest_id::text as manifest_id,object_uri,checksum,row_count,date_start,date_end,season from internal.archive_catalog where dataset_type='fixtures' and provider='api-football' and completeness_score >= %s and season = any(%s) and object_uri like 's3://%%' order by coalesce(date_start,created_at),manifest_id""",(min_completeness,sorted(complete_seasons)))
        return [ArchiveManifest(**row) for row in cur.fetchall()]

def fetch_team_identity_map(conn):
    with conn.cursor() as cur:
        cur.execute("select external_team_id,team_id::text as team_id from public.team_aliases where provider='api-football' and external_team_id is not null and team_id is not null")
        return {str(row['external_team_id']):str(row['team_id']) for row in cur.fetchall()}

def _historical_team_key(external_id,canonical_id):
    if canonical_id:return canonical_id
    if external_id is None:return None
    return f'api-football:{str(external_id)}'

def _s3_client():
    kwargs={'service_name':'s3','region_name':_env('S3_REGION'),'aws_access_key_id':_env('S3_ACCESS_KEY_ID'),'aws_secret_access_key':_env('S3_SECRET_ACCESS_KEY'),'config':Config(retries={'max_attempts':5,'mode':'standard'})};endpoint=os.environ.get('S3_ENDPOINT_URL','').strip()
    if endpoint:kwargs['endpoint_url']=endpoint
    return boto3.client(**kwargs)

def _parse_uri(uri):
    p=urlparse(uri)
    if p.scheme!='s3' or not p.netloc or not p.path.lstrip('/'):raise ValueError(f'invalid S3 object URI: {uri}')
    return p.netloc,p.path.lstrip('/')

def _season_from_uri(uri):
    raw=next((segment[len('season='):] for segment in urlparse(uri).path.split('/') if segment.startswith('season=')),None)
    if raw is None:return None,None
    resolved=resolve_season(raw,source='api-football');return resolved.archive_season_key,resolved.logical_season

def _as_datetime(value):
    if isinstance(value,datetime):dt=value
    elif isinstance(value,(int,float)) and not isinstance(value,bool):
        seconds=float(value);seconds/=1000.0 if seconds>1e11 else 1.0;dt=datetime.fromtimestamp(seconds,tz=timezone.utc)
    elif isinstance(value,str):
        text=value.strip()
        try:numeric=float(text);seconds=numeric/1000.0 if numeric>1e11 else numeric;dt=datetime.fromtimestamp(seconds,tz=timezone.utc)
        except (ValueError,OverflowError):dt=datetime.fromisoformat(text.replace('Z','+00:00'))
    else:raise TypeError(f'unsupported datetime value: {type(value).__name__}')
    if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def _fixture_date(row):
    fixture=row.get('fixture') or {}
    if isinstance(fixture,dict):
        value=fixture.get('date') or fixture.get('timestamp')
        if value is not None:return value
    return row.get('date') or row.get('timestamp')

def _number(value):
    if value is None or isinstance(value,bool):return None
    if isinstance(value,int):return value
    if isinstance(value,float):return int(value) if value.is_integer() else None
    if isinstance(value,str):
        try:x=float(value.strip());return int(x) if x.is_integer() else None
        except ValueError:return None
    return None

def _score_pair(row):
    goals=row.get('goals') or {};score=row.get('score') or {}
    hg=_number(goals.get('home')) if isinstance(goals,dict) else None;ag=_number(goals.get('away')) if isinstance(goals,dict) else None
    if isinstance(score,dict):
        for key in ('fulltime','regular','current','extratime','halftime'):
            pair=score.get(key)
            if not isinstance(pair,dict):continue
            if hg is None:hg=_number(pair.get('home'))
            if ag is None:ag=_number(pair.get('away'))
            if hg is not None and ag is not None:break
    if hg is None:hg=_number(row.get('home_goals'))
    if ag is None:ag=_number(row.get('away_goals'))
    return hg,ag

def load_settled_matches(conn,as_of=None):
    complete_seasons=fetch_complete_archive_seasons(conn)
    manifests=fetch_fixture_manifests(conn,complete_seasons=complete_seasons)
    if not manifests:raise RuntimeError('prediction_training_source_unavailable:no_complete_fixture_manifests')
    team_map=fetch_team_identity_map(conn);client=_s3_client();cutoff=_as_datetime(as_of or datetime.now(timezone.utc));by_id={};diagnostics={}
    for manifest in manifests:
        bucket,key=_parse_uri(manifest.object_uri);archive_season,logical_season=_season_from_uri(manifest.object_uri);raw=client.get_object(Bucket=bucket,Key=key)['Body'].read()
        if hashlib.sha256(raw).hexdigest()!=manifest.checksum:raise RuntimeError(f'archive checksum mismatch:{manifest.manifest_id}')
        stats=diagnostics.setdefault(str(archive_season or 'unknown'),{'logical_season':logical_season,'manifest_count':0,'walked':0,'accepted':0,'missing_fields':0,'bad_date':0,'pre_cutoff':0,'missing_team_identity':0})
        stats['manifest_count']+=1
        for row in walk_fixture_rows(raw):
            stats['walked']+=1
            fixture=row.get('fixture') or {};teams=row.get('teams') or {};fid=fixture.get('id') if isinstance(fixture,dict) else None;date=_fixture_date(row)
            home=(teams.get('home') or {}).get('id') if isinstance(teams,dict) and isinstance(teams.get('home'),dict) else (teams.get('home') if isinstance(teams,dict) else None)
            away=(teams.get('away') or {}).get('id') if isinstance(teams,dict) and isinstance(teams.get('away'),dict) else (teams.get('away') if isinstance(teams,dict) else None);hg,ag=_score_pair(row)
            if fid is None or date is None or home is None or away is None or hg is None or ag is None:stats['missing_fields']+=1;continue
            try:played=_as_datetime(date)
            except (TypeError,ValueError,OverflowError):stats['bad_date']+=1;continue
            if played>=cutoff:stats['pre_cutoff']+=1;continue
            ht=_historical_team_key(home,team_map.get(str(home)));at=_historical_team_key(away,team_map.get(str(away)))
            if not ht or not at:stats['missing_team_identity']+=1;continue
            candidate=Match(str(fid),played,ht,at,hg,ag,logical_season,archive_season);existing=by_id.get(str(fid));stats['accepted']+=1
            if existing is None:by_id[str(fid)]=candidate
            elif existing!=candidate:
                if (existing.played_at,existing.home_team_id,existing.away_team_id,existing.home_goals,existing.away_goals)!=(candidate.played_at,candidate.home_team_id,candidate.away_team_id,candidate.home_goals,candidate.away_goals):raise RuntimeError(f'conflicting archived fixture payload:{fid}')
                if existing.season is None and logical_season is not None:by_id[str(fid)]=candidate
    print(json.dumps({'complete_archive_seasons':sorted(complete_seasons),'archive_fixture_parse_diagnostics':diagnostics},sort_keys=True),flush=True)
    matches=sorted(by_id.values(),key=lambda m:(m.played_at,m.match_id))
    if not matches:raise RuntimeError('prediction_training_source_unavailable:no_canonical_settled_matches')
    return matches

# Historical training preserves the archive season key while using the authoritative preflight completeness decision.
