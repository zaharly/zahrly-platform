#!/usr/bin/env python3
"""Historical dataset worker.

Consumes one league/season/dataset job, fetches API-Football data, writes a
verified raw artifact to S3, and records the archive manifest in Supabase.

Important runtime rules:
- Self-limit API-Football traffic to 50 requests/minute.
- Respect provider 429 / Retry-After responses without treating them as daily limits.
- Never send page=1; use the first response, then page=2..N only when paging.total requires it.
- Retrieve fixture enrichment with /fixtures?ids=... in batches of at most 20 IDs.
- Do not run fixture-dependent jobs until the season's fixtures job succeeded.
- S3 is the historical source of truth; Supabase stores catalog/manifest metadata.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
import psycopg
from botocore.config import Config
from psycopg.rows import dict_row

from workers.historical_backfill.archive_metadata import resolve_archive_window

BASE_URL = "https://v3.football.api-sports.io"
QUEUE_NAME = "backfill_queue"
WORKER_ID_PREFIX = "historical-backfill"
MAX_ERROR_LENGTH = 2000
REQUESTS_PER_MINUTE = 50
FIXTURE_BATCH_SIZE = 20
SCHEMA_VERSION = "api-football-raw-v2"


class ProviderRateLimit(Exception):
    def __init__(self, message: str, retry_after: int = 60):
        super().__init__(message)
        self.retry_after = max(1, retry_after)


class RetryableProviderError(Exception):
    pass


class RequestLimiter:
    """Process-local sliding-window limiter; 50/min is independent of daily quota."""
    def __init__(self, limit: int = REQUESTS_PER_MINUTE):
        self.limit = limit
        self.started: list[float] = []

    def before_request(self) -> None:
        now = time.monotonic()
        self.started = [t for t in self.started if now - t < 60.0]
        if len(self.started) >= self.limit:
            wait = max(0.1, 60.0 - (now - self.started[0]) + 0.05)
            time.sleep(wait)
            now = time.monotonic()
            self.started = [t for t in self.started if now - t < 60.0]
        self.started.append(time.monotonic())


LIMITER = RequestLimiter()


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value or default


def connect():
    return psycopg.connect(env("SUPABASE_DB_URL"), row_factory=dict_row, connect_timeout=15)


def api_key() -> str:
    return env("API_FOOTBALL_KEY")


def _retry_after(headers, default: int = 60) -> int:
    raw = headers.get("Retry-After") if headers else None
    try:
        return max(1, int(raw)) if raw else default
    except (TypeError, ValueError):
        return default


def api_json(path: str, params: dict[str, object] | None = None, timeout: int = 90) -> dict[str, object]:
    LIMITER.before_request()
    query = f"?{urlencode(params)}" if params else ""
    request = Request(
        f"{BASE_URL}{path}{query}",
        headers={"x-apisports-key": api_key(), "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.load(response)
            headers = response.headers
    except HTTPError as exc:
        if exc.code == 429:
            raise ProviderRateLimit(
                f"API-Football rate limit (HTTP 429) for {path}",
                _retry_after(exc.headers),
            ) from exc
        if 500 <= exc.code < 600:
            raise RetryableProviderError(f"API-Football HTTP {exc.code} for {path}") from exc
        raise RuntimeError(f"API-Football HTTP {exc.code} for {path}") from exc

    if body.get("errors"):
        errors = body["errors"]
        text = str(errors)
        lowered = text.lower()
        if "rate" in lowered or "limit" in lowered or "too many" in lowered:
            remaining = headers.get("x-ratelimit-requests-remaining")
            retry = 60 if remaining in {"0", 0} else 5
            raise ProviderRateLimit(f"API-Football quota/rate error for {path}: {errors}", retry)
        raise RuntimeError(f"API-Football request failed for {path}: {errors}")
    return body


def api_pages(path: str, params: dict[str, object], max_pages: int = 100) -> tuple[list[dict[str, object]], int]:
    """Fetch the first page without page=1; continue only when paging.total requires it."""
    rows: list[dict[str, object]] = []
    requests_used = 0
    body = api_json(path, params, timeout=90)
    requests_used += 1
    response = list(body.get("response") or [])
    rows.extend(response)
    paging = body.get("paging") or {}
    total = int(paging.get("total") or 1)
    current = int(paging.get("current") or 1)
    if total <= current:
        return rows, requests_used

    for page in range(current + 1, min(total, max_pages) + 1):
        body = api_json(path, {**params, "page": page}, timeout=90)
        requests_used += 1
        response = list(body.get("response") or [])
        rows.extend(response)
        paging = body.get("paging") or {}
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


def fixture_ids_for_season(league_id: int, season: int) -> tuple[list[dict[str, object]], int]:
    rows, used = fixtures(league_id, season)
    rows = [r for r in rows if ((r.get("fixture") or {}).get("id"))]
    return rows, used


def fixture_enrichment(dataset: str, fixture_rows: list[dict[str, object]]) -> tuple[list[dict[str, object]], int]:
    """Use /fixtures?ids= with <=20 IDs; preserve embedded provider sub-documents."""
    fixture_ids = sorted({int((r.get("fixture") or {}).get("id")) for r in fixture_rows if (r.get("fixture") or {}).get("id")})
    out: list[dict[str, object]] = []
    requests_used = 0
    field = {
        "fixture_events": "events",
        "lineups": "lineups",
        "fixture_statistics": "statistics",
        "fixture_players_statistics": "players",
    }[dataset]
    for start in range(0, len(fixture_ids), FIXTURE_BATCH_SIZE):
        chunk = fixture_ids[start:start + FIXTURE_BATCH_SIZE]
        body = api_json("/fixtures", {"ids": "-".join(map(str, chunk))}, timeout=120)
        requests_used += 1
        for fixture in list(body.get("response") or []):
            fixture_id = ((fixture.get("fixture") or {}).get("id"))
            out.append({
                "fixture_id": fixture_id,
                "response": fixture.get(field) if field in fixture else [],
                "fixture": fixture,
            })
    return out, requests_used


def collect_dataset(dataset: str, league_id: int, season: int) -> tuple[dict[str, object], int]:
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

    fixture_rows, fixture_requests = fixture_ids_for_season(league_id, season)
    used += fixture_requests

    if dataset in {"fixture_statistics", "fixture_events", "lineups", "fixture_players_statistics"}:
        rows, extra = fixture_enrichment(dataset, fixture_rows)
        used += extra
        return {"dataset": dataset, "season": season, "league_id": league_id, "response": rows}, used

    if dataset == "predictions":
        out = []
        for row in fixture_rows:
            fixture_id = int((row.get("fixture") or {}).get("id"))
            body = api_json("/predictions", {"fixture": fixture_id}, timeout=90)
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
            body = api_json("/fixtures/headtohead", {"h2h": f"{home_id}-{away_id}", "league": league_id, "season": season}, timeout=90)
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
                       c.canonical_name as competition_name,
                       coalesce(country.code, 'unknown') as country_code,
                       w.job_id as worker_job_id
                  from internal.backfill_jobs b
                  join public.competitions c on c.id=b.league_id
                  left join public.countries country on country.id=b.country_id
                  join internal.worker_jobs w on w.idempotency_key='backfill:' || b.job_id::text
                 where b.status in ('QUEUED','RETRYABLE')
                   and w.queue_name=%s
                   and w.status in ('QUEUED','RETRYABLE')
                   and (b.next_retry_at is null or b.next_retry_at <= now())
                   and (w.next_retry_at is null or w.next_retry_at <= now())
                   and (
                     b.dataset_type not in ('fixture_events','fixture_statistics','fixture_players_statistics','lineups','predictions','head_to_head')
                     or exists (
                       select 1 from internal.backfill_jobs f
                        where f.league_id=b.league_id and f.season=b.season
                          and f.dataset_type='fixtures' and f.status='SUCCEEDED'
                     )
                   )
                   and (
                     b.dataset_type not in ('team_statistics','squads','coaches','transfers','venues','team_seasons')
                     or exists (
                       select 1 from internal.backfill_jobs t
                        where t.league_id=b.league_id and t.season=b.season
                          and t.dataset_type='teams' and t.status='SUCCEEDED'
                     )
                   )
                 order by b.priority desc, b.created_at asc
                 for update of b,w skip locked limit 1
                """, (QUEUE_NAME,))
            job = cur.fetchone()
            if not job:
                return None
            cur.execute("update internal.worker_jobs set status='RUNNING',worker_id=%s,attempts=attempts+1,started_at=coalesce(started_at,now()),lease_expires_at=now()+interval '60 minutes' where job_id=%s and status in ('QUEUED','RETRYABLE')", (worker_id, job['worker_job_id']))
            if cur.rowcount != 1:
                return None
            cur.execute("update internal.backfill_jobs set status='RUNNING',updated_at=now(),next_retry_at=null where job_id=%s", (job['job_id'],))
            return job


def update_progress(conn, job, progress: int, requests_used: int):
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.backfill_jobs set progress=%s,requests_used=%s,updated_at=now() where job_id=%s", (progress, requests_used, job['job_id']))


def upload_s3(payload: bytes, job: dict, checksum: str) -> str:
    client = boto3.client(
        's3',
        region_name=env('S3_REGION'),
        aws_access_key_id=env('S3_ACCESS_KEY_ID'),
        aws_secret_access_key=env('S3_SECRET_ACCESS_KEY'),
        endpoint_url=os.environ.get('S3_ENDPOINT_URL', '').strip() or None,
        config=Config(retries={'max_attempts': 5, 'mode': 'standard'}),
    )
    bucket = env('S3_BUCKET')
    prefix = env('S3_PREFIX', required=False, default='zahrly/archive').strip('/')
    country_code = str(job.get('country_code') or 'unknown').strip().replace('/', '_')
    provider_league_id = str(job['provider_league_id'])
    key = (
        f"{prefix}/historical/raw/provider=api-football/"
        f"season={job['season']}/country={country_code}/league={provider_league_id}/"
        f"dataset={job['dataset_type']}/job={job['job_id']}.json"
    )
    metadata = {
        'provider': 'api-football',
        'season': str(job['season']),
        'country': country_code,
        'league': provider_league_id,
        'dataset': str(job['dataset_type']),
        'schema-version': SCHEMA_VERSION,
    }
    client.put_object(Bucket=bucket, Key=key, Body=payload, ContentType='application/json', Metadata=metadata)
    head = client.head_object(Bucket=bucket, Key=key)
    if int(head.get('ContentLength', -1)) != len(payload):
        raise RuntimeError('S3 object length verification failed')
    body = client.get_object(Bucket=bucket, Key=key)['Body'].read()
    if hashlib.sha256(body).hexdigest() != checksum:
        raise RuntimeError('S3 object checksum verification failed')
    return f"s3://{bucket}/{key}"


def mark_succeeded(conn, job, document: dict, object_uri: str, checksum: str, row_count: int, requests_used: int):
    date_start, date_end = resolve_archive_window(conn, job, document)
    manifest_id = uuid.uuid4()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("""
                insert into internal.archive_catalog
                  (manifest_id,country_id,competition_id,season,dataset_type,provider,
                   date_start,date_end,object_uri,checksum,row_count,completeness_score,
                   schema_version,team_set_hash)
                values (%s,%s,%s,%s,%s,'api-football',%s,%s,%s,%s,%s,1,%s,'')
            """, (
                manifest_id, job['country_id'], job['league_id'], job['season'], job['dataset_type'],
                date_start, date_end, object_uri, checksum, row_count, SCHEMA_VERSION,
            ))
            cur.execute("update internal.backfill_jobs set status='SUCCEEDED',progress=100,requests_used=%s,manifest_id=%s,updated_at=now(),next_retry_at=null,error_code=null,error_message=null where job_id=%s", (requests_used, manifest_id, job['job_id']))
            cur.execute("update internal.worker_jobs set status='SUCCEEDED',finished_at=now(),lease_expires_at=null,error_code=null,error_message=null,next_retry_at=null where job_id=%s", (job['worker_job_id'],))
    return str(manifest_id), date_start, date_end


def mark_retryable(conn, job, exc: Exception, retry_after: int = 60):
    message = str(exc)[:MAX_ERROR_LENGTH]
    retry_at = datetime.now(timezone.utc).timestamp() + max(1, retry_after)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.backfill_jobs set status='RETRYABLE',next_retry_at=to_timestamp(%s),updated_at=now(),error_code='PROVIDER_RATE_LIMIT',error_message=%s where job_id=%s", (retry_at, message, job['job_id']))
            cur.execute("update internal.worker_jobs set status='RETRYABLE',finished_at=null,lease_expires_at=null,error_code='PROVIDER_RATE_LIMIT',error_message=%s,next_retry_at=to_timestamp(%s) where job_id=%s", (message, retry_at, job['worker_job_id']))


def mark_failed(conn, job, exc: Exception):
    message = str(exc)[:MAX_ERROR_LENGTH]
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("update internal.backfill_jobs set status='FAILED',updated_at=now(),error_code='HISTORICAL_DATASET_FAILED',error_message=%s where job_id=%s", (message, job['job_id']))
            cur.execute("update internal.worker_jobs set status='FAILED',finished_at=now(),lease_expires_at=null,error_code='HISTORICAL_DATASET_FAILED',error_message=%s where job_id=%s", (message, job['worker_job_id']))


def run_one(conn):
    job = claim_job(conn)
    if not job:
        return {'processed': False, 'reason': 'no_ready_historical_job'}
    try:
        provider_league_id_raw = job.get('provider_league_id')
        if not provider_league_id_raw:
            raise RuntimeError(f"competition {job['league_id']} has no api_football provider id")
        provider_league_id = int(provider_league_id_raw)
        season = int(job['season'])
        update_progress(conn, job, 5, 0)
        document, requests_used = collect_dataset(job['dataset_type'], provider_league_id, season)
        update_progress(conn, job, 60, requests_used)
        artifact = {
            'archive_layer': 'raw',
            'schema_version': SCHEMA_VERSION,
            'provider': 'api-football',
            'job_id': str(job['job_id']),
            'season': season,
            'country': {'id': str(job['country_id']) if job.get('country_id') else None, 'code': job.get('country_code')},
            'competition': {'id': str(job['league_id']) if job.get('league_id') else None, 'provider_id': provider_league_id, 'name': job.get('competition_name')},
            'dataset_type': job['dataset_type'],
            'retrieved_at': datetime.now(timezone.utc).isoformat(),
            'requests_used': requests_used,
            'request': {'endpoint': None, 'season': season, 'league': provider_league_id},
            'payload': document,
        }
        payload = (json.dumps(artifact, sort_keys=True, separators=(',', ':'), default=str) + '\n').encode()
        checksum = hashlib.sha256(payload).hexdigest()
        object_uri = upload_s3(payload, job, checksum)
        manifest_id, date_start, date_end = mark_succeeded(conn, job, document, object_uri, checksum, len(document.get('response') or []), requests_used)
        return {
            'processed': True,
            'job_id': str(job['job_id']),
            'dataset_type': job['dataset_type'],
            'season': season,
            'status': 'SUCCEEDED',
            'object_uri': object_uri,
            'checksum': checksum,
            'manifest_id': manifest_id,
            'date_start': date_start.isoformat() if date_start else None,
            'date_end': date_end.isoformat() if date_end else None,
            'requests_used': requests_used,
        }
    except ProviderRateLimit as exc:
        mark_retryable(conn, job, exc, exc.retry_after)
        return {'processed': True, 'job_id': str(job['job_id']), 'dataset_type': job['dataset_type'], 'season': int(job['season']), 'status': 'RETRYABLE', 'reason': 'provider_rate_limit', 'retry_after': exc.retry_after}
    except RetryableProviderError as exc:
        mark_retryable(conn, job, exc, 30)
        return {'processed': True, 'job_id': str(job['job_id']), 'dataset_type': job['dataset_type'], 'season': int(job['season']), 'status': 'RETRYABLE', 'reason': 'provider_transient_error'}
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
            if result.get('processed') is not True or result.get('status') == 'RETRYABLE':
                break
        print(json.dumps({'processed': [r for r in results if r.get('processed')], 'idle': not any(r.get('processed') for r in results)}, separators=(',', ':')), flush=True)
        return 0 if not any(r.get('status') == 'FAILED' for r in results) else 1
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    raise SystemExit(main())
