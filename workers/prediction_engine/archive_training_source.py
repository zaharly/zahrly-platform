from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlparse

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from .walk_forward import Match


@dataclass(frozen=True)
class ArchiveManifest:
    manifest_id: str
    object_uri: str
    checksum: str
    row_count: int
    date_start: datetime | None
    date_end: datetime | None


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    if default is not None:
        return default
    raise RuntimeError(f"missing required environment variable: {name}")


def db_connect():
    return psycopg.connect(_env("SUPABASE_DB_URL"), row_factory=dict_row, connect_timeout=15)


def fetch_fixture_manifests(conn, min_completeness: float = 1.0) -> list[ArchiveManifest]:
    with conn.cursor() as cur:
        cur.execute("""
            select manifest_id::text as manifest_id, object_uri, checksum, row_count, date_start, date_end
              from internal.archive_catalog
             where dataset_type='fixtures' and provider='api-football'
               and completeness_score >= %s and object_uri like 's3://%%'
             order by coalesce(date_start, created_at), manifest_id
        """, (min_completeness,))
        return [ArchiveManifest(**row) for row in cur.fetchall()]


def fetch_team_identity_map(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("""
            select external_team_id, team_id::text as team_id
              from public.team_aliases
             where provider='api-football' and external_team_id is not null and team_id is not null
        """)
        return {str(row['external_team_id']): str(row['team_id']) for row in cur.fetchall()}


def _historical_team_key(external_id: Any, canonical_id: str | None) -> str | None:
    if canonical_id:
        return canonical_id
    if external_id is None:
        return None
    # Historical training must not discard archived fixtures merely because a
    # provider team has not yet been canonicalized in production. This key is
    # local to the training namespace and never creates/updates a production team.
    return f"api-football:{str(external_id)}"


def _s3_client():
    kwargs: dict[str, Any] = {
        'service_name':'s3',
        'region_name':_env('S3_REGION'),
        'aws_access_key_id':_env('S3_ACCESS_KEY_ID'),
        'aws_secret_access_key':_env('S3_SECRET_ACCESS_KEY'),
        'config':Config(retries={'max_attempts':5,'mode':'standard'}),
    }
    endpoint = os.environ.get('S3_ENDPOINT_URL','').strip()
    if endpoint:
        kwargs['endpoint_url']=endpoint
    return boto3.client(**kwargs)


def _parse_uri(uri: str) -> tuple[str,str]:
    p=urlparse(uri)
    if p.scheme!='s3' or not p.netloc or not p.path.lstrip('/'):
        raise ValueError(f'invalid S3 object URI: {uri}')
    return p.netloc,p.path.lstrip('/')


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt=value
    else:
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if dt.tzinfo is None:
        dt=dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _walk(value: Any) -> Iterable[dict[str,Any]]:
    if isinstance(value,list):
        for item in value:
            yield from _walk(item)
        return
    if not isinstance(value,dict):
        return
    if isinstance(value.get('fixture'),dict) and isinstance(value.get('teams'),dict):
        yield value
        return
    for key in ('response','rows','results','data','payload','body'):
        if key in value:
            yield from _walk(value[key])


def _number(value: Any) -> int | None:
    if value is None or isinstance(value,bool): return None
    if isinstance(value,int): return value
    if isinstance(value,float): return int(value) if value.is_integer() else None
    if isinstance(value,str):
        try:
            x=float(value.strip())
            return int(x) if x.is_integer() else None
        except ValueError:
            return None
    return None


def load_settled_matches(conn, as_of: datetime | None=None) -> list[Match]:
    manifests=fetch_fixture_manifests(conn)
    if not manifests: raise RuntimeError('prediction_training_source_unavailable:no_fixture_manifests')
    team_map=fetch_team_identity_map(conn)
    client=_s3_client()
    cutoff=_as_datetime(as_of or datetime.now(timezone.utc))
    by_id: dict[str,Match]={}
    for manifest in manifests:
        bucket,key=_parse_uri(manifest.object_uri)
        raw=client.get_object(Bucket=bucket,Key=key)['Body'].read()
        if hashlib.sha256(raw).hexdigest()!=manifest.checksum:
            raise RuntimeError(f'archive checksum mismatch:{manifest.manifest_id}')
        doc=json.loads(raw.decode('utf-8'))
        for row in _walk(doc):
            fixture=row.get('fixture') or {}
            teams=row.get('teams') or {}
            goals=row.get('goals') or {}
            fid=fixture.get('id'); date=fixture.get('date')
            home=(teams.get('home') or {}).get('id'); away=(teams.get('away') or {}).get('id')
            hg=_number(goals.get('home')); ag=_number(goals.get('away'))
            status=((fixture.get('status') or {}).get('short') if isinstance(fixture.get('status'),dict) else fixture.get('status'))
            if fid is None or date is None or home is None or away is None or hg is None or ag is None: continue
            if status is not None and str(status).upper() not in {'FT','AET','PEN'}: continue
            try: played=_as_datetime(date)
            except (TypeError,ValueError,OverflowError): continue
            if played>=cutoff: continue
            home_team=_historical_team_key(home, team_map.get(str(home)))
            away_team=_historical_team_key(away, team_map.get(str(away)))
            if not home_team or not away_team: continue
            by_id[str(fid)]=Match(str(fid),played,home_team,away_team,hg,ag)
    matches=sorted(by_id.values(),key=lambda m:(m.played_at,m.match_id))
    if not matches: raise RuntimeError('prediction_training_source_unavailable:no_canonical_settled_matches')
    return matches
