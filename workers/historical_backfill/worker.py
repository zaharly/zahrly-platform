#!/usr/bin/env python3
"""Historical dataset worker.

Consumes one league/season/dataset job, fetches the provider dataset through
API-Football, writes the raw historical artifact to S3, and records a verified
archive manifest in the control plane.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

BASE_URL = "https://v3.football.api-sports.io"
QUEUE_NAME = "backfill_queue"
WORKER_ID_PREFIX = "historical-backfill"
MAX_ERROR_LENGTH = 2000


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value or default


def connect():
    return psycopg.connect(env("SUPABASE_DB_URL"), row_factory=dict_row, connect_timeout=15)


def api_key() -> str:
    return env("API_FOOTBALL_KEY")


def api_json(path: str, params: dict[str, object] | None = None, timeout: int = 90) -> dict[str, object]:
    query = f"?{urlencode(params)}" if params else ""
    request = Request(
        f"{BASE_URL}{path}{query}",
        headers={"x-apisports-key": api_key(), "Accept": "application/json"},
    )
    with urlopen(request, timeout=timeout) as response:
        body = json.load(response)
    if body.get("errors"):
        raise RuntimeError(f"API-Football request failed for {path}: {body['errors']}")
    return body


def api_pages(path: str, params: dict[str, object], max_pages: int = 50) -> tuple[list[dict[str, object]], int]:
    rows: list[dict[str, object]] = []
    requests_used = 0
    for page in range(1, max_pages + 1):
        body = api_json(path, {**params, "page": page}, timeout=90)
        requests_used += 1
        response = body.get("response") or []
        rows.extend(response)
        paging = body.get("paging") or {}
        total = int(paging.get("total") or page)
        current = int(paging.get("current") or page)
        if current >= total or not response:
            break
    return rows, requests_used


def fixtures(league_id: int, season: int) -> tuple[list[dict[str, object]], int]:
    body = api_json("/fixtures", {"league": league_id, "season": season}, timeout=120)
    return list(body.get("response") or []), 1


def teams(league_id: int, season: int) -> tuple[list[dict[str, object]], int]:
    body = api_json("/teams", {"league": league_id, "season": season}, timeout=90)
    return list(body.get("response") or []), 1


def collect_dataset(dataset: str, league_id: int, season: int) -> tuple[dict[str, object], int]:
    # Season-level datasets.
    direct: dict[str, tuple[str, dict[str, object]]] = {
        "standings": ("/standings", {"league": league_id, "season": season}),
        "rounds": ("/fixtures/rounds", {"league": league_id, "season": season}),
        "fixtures": ("/fixtures", {"league": league_id, "season": season}),
        "teams": ("/teams", {"league": league_id, "season": season}),
        "players": ("/players", {"league": league_id, "season": season}),
        "player_statistics": ("/players", {"league": league_id, "season": season}),
        "injuries": ("/injuries", {"league": league_id, "season": season}),
        "top_scorers": ("/players/topscorers", {"league": league_id, "season": season}),
        "top_assists": ("/players/topassists", {"league": league_id, "season": season}),
        "top_yellow_cards": ("/players/topyellowcards", {"league": league_id, "season": season}),
        "top_red_cards": ("/players/topredcards", {"league": league_id, "season": season}),
        "pre_match_odds": ("/odds", {"league": league_id, "season": season}),
    }
    if dataset in direct:
        path, params = direct[dataset]
        rows, used = api_pages(path, params) if dataset not in {"fixtures", "standings", "rounds", "teams"} else (list((api_json(path, params, timeout=120)).get("response") or []), 1)
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": rows}, used

    if dataset == "team_countries":
        body = api_json("/teams/countries")
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": body.get("response") or []}, 1

    team_rows, used = teams(league_id, season)
    team_ids = sorted({int(((row.get("team") or {}).get("id"))) for row in team_rows if ((row.get("team") or {}).get("id"))})

    if dataset == "team_seasons":
        out = []
        for team_id in team_ids:
            body = api_json("/teams/seasons", {"team": team_id})
            used += 1
            out.append({"team_id": team_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    if dataset in {"team_statistics", "squads", "coaches", "transfers"}:
        path = {"team_statistics": "/teams/statistics", "squads": "/players/squads", "coaches": "/coachs", "transfers": "/transfers"}[dataset]
        out = []
        for team_id in team_ids:
            params = {"team": team_id}
            if dataset == "team_statistics":
                params.update({"league": league_id, "season": season})
            body = api_json(path, params, timeout=90)
            used += 1
            out.append({"team_id": team_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    if dataset == "venues":
        venue_ids = sorted({int(((row.get("venue") or {}).get("id"))) for row in team_rows if ((row.get("venue") or {}).get("id"))})
        out = []
        for venue_id in venue_ids:
            body = api_json("/venues", {"id": venue_id})
            used += 1
            out.append({"venue_id": venue_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    fixture_rows, fixture_requests = fixtures(league_id, season)
    used = max(used, fixture_requests)
    fixture_ids = sorted({int((row.get("fixture") or {}).get("id")) for row in fixture_rows if (row.get("fixture") or {}).get("id")})

    fixture_paths = {
        "fixture_statistics": "/fixtures/statistics",
        "fixture_events": "/fixtures/events",
        "lineups": "/fixtures/lineups",
        "fixture_players_statistics": "/fixtures/players",
        "predictions": "/predictions",
    }
    if dataset in fixture_paths:
        out = []
        path = fixture_paths[dataset]
        for fixture_id in fixture_ids:
            body = api_json(path, {"fixture": fixture_id}, timeout=90)
            used += 1
            out.append({"fixture_id": fixture_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    if dataset == "head_to_head":
        pairs = set()
        for row in fixture_rows:
            teams_obj = row.get("teams") or {}
            home = (teams_obj.get("home") or {}).get("id")
            away = (teams_obj.get("away") or {}).get("id")
            if home and away:
                pairs.add((min(int(home), int(away)), max(int(home), int(away))))
        out = []
        for home_id, away_id in sorted(pairs):
            body = api_json("/fixtures/headtohead", {"h2h": f"{home_id}-{away_id}"}, timeout=90)
            used += 1
            out.append({"home_team_id": home_id, "away_team_id": away_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    if dataset == "trophies":
        players, player_requests = api_pages("/players", {"league": league_id, "season": season})
        used += player_requests
        player_ids = sorted({int((row.get("player") or {}).get("id")) for row in players if (row.get("player") or {}).get("id")})
        out = []
        for player_id in player_ids:
            body = api_json("/trophies", {"player": player_id})
            used += 1
            out.append({"player_id": player_id, "response": body.get("response") or []})
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": out}, used

    raise RuntimeError(f"Unsupported historical dataset: {dataset}")


def claim_job(conn):
    worker_id = f"{WORKER_ID_PREFIX}:{socket.gethostname()}"
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                select b.*, c.provider_ids->>'api_football' as provider_league_id,
                       c.canonical_name as competition_name, w.job_id as worker_job_id
                  from internal.backfill_jobs b
                  join public.competitions c on c.id=b.league_id
                  join internal.worker_jobs w on w.idempotency_key='backfill:' || b.job_id::text
                 where b.status='QUEUED' and w.queue_name=%s and w.status='QUEUED'
                 order by b.priority desc, b.created_at asc
                 for update of b,w skip locked limit 1
                """, (QUEUE_NAME,))
            job = cur.fetchone()
            if not job: return None
            cur.execute("update internal.worker_jobs set status='RUNNING',worker_id=%s,attempts=attempts+1,started_at=coalesce(started_at,now()),lease_expires_at=now()+interval '60 minutes' where job_id=%s and status='QUEUED'", (worker_id, job['worker_job_id']))
            if cur.rowcount != 1: return None
            cur.execute("update internal.backfill_jobs set status='RUNNING',updated_at=now(),next_retry_at=null where job_id=%s", (job['job_id'],))
            return job


def update_progress(conn, job, progress: int, requests_used: int):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.backfill_jobs set progress=%s,requests_used=%s,updated_at=now() where job_id=%s", (progress, requests_used, job['job_id']))


def upload_s3(payload: bytes, job: dict, checksum: str) -> str:
    client_kwargs = {
        'service_name': 's3',
        'region_name': env('S3_REGION'),
        'aws_access_key_id': env('S3_ACCESS_KEY_ID'),
        'aws_secret_access_key': env('S3_SECRET_ACCESS_KEY'),
        'config': Config(retries={'max_attempts': 5, 'mode': 'standard'}),
    }
    endpoint = os.environ.get('S3_ENDPOINT_URL', '').strip()
    if endpoint: client_kwargs['endpoint_url'] = endpoint
    client = boto3.client(**client_kwargs)
    bucket = env('S3_BUCKET')
    prefix = env('S3_PREFIX', required=False, default='zahrly/archive').strip('/')
    key = f"{prefix}/historical/{job['dataset_type']}/season={job['season']}/league={job['league_id']}/job={job['job_id']}.json"
    client.put_object(Bucket=bucket, Key=key, Body=payload, ContentType='application/json')
    head = client.head_object(Bucket=bucket, Key=key)
    if int(head.get('ContentLength', -1)) != len(payload): raise RuntimeError('S3 object length verification failed')
    body = client.get_object(Bucket=bucket, Key=key)['Body'].read()
    if hashlib.sha256(body).hexdigest() != checksum: raise RuntimeError('S3 object checksum verification failed')
    return f"s3://{bucket}/{key}"


def mark_succeeded(conn, job, object_uri: str, checksum: str, row_count: int, requests_used: int):
    manifest_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("""
                insert into internal.archive_catalog
                  (manifest_id,country_id,competition_id,season,dataset_type,provider,date_start,date_end,object_uri,checksum,row_count,completeness_score,schema_version,team_set_hash)
                values (%s,%s,%s,%s,%s,'api-football',%s,%s,%s,%s,%s,1,'api-football-raw-v1','')
            """, (manifest_id,job['country_id'],job['league_id'],job['season'],job['dataset_type'],now,now,object_uri,checksum,row_count))
            cur.execute("update internal.backfill_jobs set status='SUCCEEDED',progress=100,requests_used=%s,manifest_id=%s,updated_at=now(),next_retry_at=null where job_id=%s", (requests_used,manifest_id,job['job_id']))
            cur.execute("update internal.worker_jobs set status='SUCCEEDED',finished_at=now(),lease_expires_at=null,error_code=null,error_message=null where job_id=%s", (job['worker_job_id'],))


def mark_failed(conn, job, exc: Exception):
    message = str(exc)[:MAX_ERROR_LENGTH]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.backfill_jobs set status='FAILED',next_retry_at=now()+interval '5 minutes',updated_at=now() where job_id=%s", (job['job_id'],))
            cur.execute("update internal.worker_jobs set status='FAILED',finished_at=now(),lease_expires_at=null,error_code='HISTORICAL_DATASET_FAILED',error_message=%s where job_id=%s", (message,job['worker_job_id']))


def run_one(conn):
    job = claim_job(conn)
    if not job: return {'processed': False, 'reason': 'no_queued_historical_job'}
    try:
        provider_league_id_raw = job.get('provider_league_id')
        if not provider_league_id_raw: raise RuntimeError(f"competition {job['league_id']} has no api_football provider id")
        provider_league_id = int(provider_league_id_raw)
        season = int(job['season'])
        update_progress(conn, job, 5, 0)
        document, requests_used = collect_dataset(job['dataset_type'], provider_league_id, season)
        update_progress(conn, job, 60, requests_used)
        artifact = {
            'schema_version': 'api-football-raw-v1',
            'provider': 'api-football',
            'job_id': str(job['job_id']),
            'season': season,
            'league_id': provider_league_id,
            'dataset_type': job['dataset_type'],
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'requests_used': requests_used,
            'payload': document,
        }
        payload = (json.dumps(artifact, sort_keys=True, separators=(',', ':'), default=str) + '\n').encode()
        checksum = hashlib.sha256(payload).hexdigest()
        object_uri = upload_s3(payload, job, checksum)
        mark_succeeded(conn, job, object_uri, checksum, len(document.get('response') or []), requests_used)
        return {'processed': True, 'job_id': str(job['job_id']), 'dataset_type': job['dataset_type'], 'season': season, 'status': 'SUCCEEDED', 'object_uri': object_uri, 'requests_used': requests_used}
    except Exception as exc:
        mark_failed(conn, job, exc)
        return {'processed': True, 'job_id': str(job['job_id']), 'dataset_type': job['dataset_type'], 'season': int(job['season']), 'status': 'FAILED', 'error': str(exc)[:MAX_ERROR_LENGTH]}


def main() -> int:
    conn = None
    try:
        conn = connect()
        batch_size = max(1, min(int(os.environ.get('BATCH_SIZE', '10')), 100))
        results = []
        for _ in range(batch_size):
            result = run_one(conn)
            results.append(result)
            if result.get('processed') is not True: break
        print(json.dumps({'processed': [r for r in results if r.get('processed')], 'idle': not any(r.get('processed') for r in results)}, separators=(',', ':')), flush=True)
        return 0 if not any(r.get('status') == 'FAILED' for r in results) else 1
    finally:
        if conn: conn.close()


if __name__ == '__main__':
    raise SystemExit(main())
