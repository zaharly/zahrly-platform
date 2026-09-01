from __future__ import annotations
import hashlib,json,os,re
from dataclasses import dataclass
from datetime import datetime,timezone
from typing import Any,Iterable
from urllib.parse import urlparse
import boto3,psycopg
from botocore.config import Config
from psycopg.rows import dict_row
from .walk_forward import Match
@dataclass(frozen=True)
class ArchiveManifest:
 manifest_id:str;object_uri:str;checksum:str;row_count:int;date_start:datetime|None;date_end:datetime|None
def _env(name,default=None):
 v=os.environ.get(name,'').strip()
 if v:return v
 if default is not None:return default
 raise RuntimeError(f'missing required environment variable: {name}')
def db_connect():return psycopg.connect(_env('SUPABASE_DB_URL'),row_factory=dict_row,connect_timeout=15)
def fetch_fixture_manifests(conn,min_completeness=1.0):
 with conn.cursor() as cur:
  cur.execute("select manifest_id::text as manifest_id,object_uri,checksum,row_count,date_start,date_end from internal.archive_catalog where dataset_type='fixtures' and provider='api-football' and completeness_score >= %s and object_uri like 's3://%%' order by coalesce(date_start,created_at),manifest_id",(min_completeness,));return [ArchiveManifest(**row) for row in cur.fetchall()]
def fetch_team_identity_map(conn):
 with conn.cursor() as cur:
  cur.execute("select external_team_id,team_id::text as team_id from public.team_aliases where provider='api-football' and external_team_id is not null and team_id is not null");return {str(row['external_team_id']):str(row['team_id']) for row in cur.fetchall()}
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
 m=re.search(r'(?:^|/)season=(\d{4})(?:/|$)',uri);return int(m.group(1)) if m else None
def _as_datetime(value):
 if isinstance(value,datetime):dt=value
 else:dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
 if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
 return dt.astimezone(timezone.utc)
def _walk(value):
 if isinstance(value,list):
  for item in value:yield from _walk(item)
  return
 if not isinstance(value,dict):return
 if isinstance(value.get('fixture'),dict) and isinstance(value.get('teams'),dict):yield value;return
 for key in ('response','rows','results','data','payload','body'):
  if key in value:yield from _walk(value[key])
def _number(value):
 if value is None or isinstance(value,bool):return None
 if isinstance(value,int):return value
 if isinstance(value,float):return int(value) if value.is_integer() else None
 if isinstance(value,str):
  try:x=float(value.strip());return int(x) if x.is_integer() else None
  except ValueError:return None
 return None
def _score_pair(row):
 goals=row.get('goals') or {};score=row.get('score') or {};full=score.get('fulltime') if isinstance(score,dict) else None;extra=score.get('extratime') if isinstance(score,dict) else None
 hg=_number(goals.get('home')) if isinstance(goals,dict) else None;ag=_number(goals.get('away')) if isinstance(goals,dict) else None
 if hg is None and isinstance(full,dict):hg=_number(full.get('home'))
 if ag is None and isinstance(full,dict):ag=_number(full.get('away'))
 if hg is None and isinstance(extra,dict):hg=_number(extra.get('home'))
 if ag is None and isinstance(extra,dict):ag=_number(extra.get('away'))
 return hg,ag
def load_settled_matches(conn,as_of=None):
 manifests=fetch_fixture_manifests(conn)
 if not manifests:raise RuntimeError('prediction_training_source_unavailable:no_fixture_manifests')
 team_map=fetch_team_identity_map(conn);client=_s3_client();cutoff=_as_datetime(as_of or datetime.now(timezone.utc));by_id={}
 for manifest in manifests:
  bucket,key=_parse_uri(manifest.object_uri);season=_season_from_uri(manifest.object_uri);raw=client.get_object(Bucket=bucket,Key=key)['Body'].read()
  if hashlib.sha256(raw).hexdigest()!=manifest.checksum:raise RuntimeError(f'archive checksum mismatch:{manifest.manifest_id}')
  doc=json.loads(raw.decode('utf-8'))
  for row in _walk(doc):
   fixture=row.get('fixture') or {};teams=row.get('teams') or {};fid=fixture.get('id');date=fixture.get('date') or fixture.get('timestamp');home=(teams.get('home') or {}).get('id');away=(teams.get('away') or {}).get('id');hg,ag=_score_pair(row);status=((fixture.get('status') or {}).get('short') if isinstance(fixture.get('status'),dict) else fixture.get('status'))
   if fid is None or date is None or home is None or away is None or hg is None or ag is None:continue
   if status is not None and str(status).upper() not in {'FT','AET','PEN','FINISHED','AFTER_PENALTIES','AFTER_EXTRA_TIME'}:continue
   try:played=_as_datetime(date)
   except (TypeError,ValueError,OverflowError):continue
   if played>=cutoff:continue
   ht=_historical_team_key(home,team_map.get(str(home)));at=_historical_team_key(away,team_map.get(str(away)))
   if not ht or not at:continue
   candidate=Match(str(fid),played,ht,at,hg,ag,season);existing=by_id.get(str(fid))
   if existing is None:by_id[str(fid)]=candidate
   elif existing!=candidate:
    if (existing.played_at,existing.home_team_id,existing.away_team_id,existing.home_goals,existing.away_goals)!=(candidate.played_at,candidate.home_team_id,candidate.away_team_id,candidate.home_goals,candidate.away_goals):raise RuntimeError(f'conflicting archived fixture payload:{fid}')
    if existing.season is None and season is not None:by_id[str(fid)]=candidate
 matches=sorted(by_id.values(),key=lambda m:(m.played_at,m.match_id))
 if not matches:raise RuntimeError('prediction_training_source_unavailable:no_canonical_settled_matches')
 return matches
