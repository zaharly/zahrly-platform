from __future__ import annotations

from datetime import date, datetime
from typing import Any


def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _walk_dates(node: Any, out: list[datetime]) -> None:
    if isinstance(node, dict):
        fixture = node.get("fixture")
        if isinstance(fixture, dict):
            dt = _parse_dt(fixture.get("date"))
            if dt:
                out.append(dt)
        for value in node.values():
            if isinstance(value, (dict, list)):
                _walk_dates(value, out)
    elif isinstance(node, list):
        for value in node:
            _walk_dates(value, out)


def resolve_archive_window(conn, job: dict[str, Any], document: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    """Resolve a defensible data window; never invent a timestamp.

    Fixture-derived datasets use the actual fixture timestamps contained in the
    provider response. Season-scoped datasets fall back to the provider catalog
    season window when available. Otherwise the archive metadata remains NULL.
    """
    dates: list[datetime] = []
    if job.get("dataset_type") in {
        "fixtures", "fixture_events", "fixture_statistics", "fixture_players_statistics", "lineups"
    }:
        _walk_dates(document.get("response") or [], dates)
    if dates:
        return min(dates), max(dates)

    with conn.cursor() as cur:
        cur.execute(
            """
            select pcs.start_date, pcs.end_date
              from public.provider_catalog_seasons pcs
             where pcs.provider='api-football'
               and pcs.competition_id=%s
               and pcs.season=%s
             order by pcs.updated_at desc
             limit 1
            """,
            (job["league_id"], job["season"]),
        )
        row = cur.fetchone()
    if not row:
        return None, None
    start_date: date | None = row["start_date"]
    end_date: date | None = row["end_date"]
    start = datetime.combine(start_date, datetime.min.time()) if start_date else None
    end = datetime.combine(end_date, datetime.max.time()) if end_date else None
    return start, end
