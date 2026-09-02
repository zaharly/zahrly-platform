from __future__ import annotations

import re
from dataclasses import dataclass


# In the current historical archive, API-Football uses calendar-year season keys
# for annual international tournaments (Euro 2008, Confederations Cup 2009),
# while the league-style seasons use the season start year (for example 2011 ->
# 2011/2012). This mapping is applied only in memory and never mutates S3.
_ANNUAL_API_FOOTBALL_SEASONS = {2008, 2009}


@dataclass(frozen=True)
class ResolvedSeason:
    """Code-side season identity; never mutates the immutable archive."""

    archive_season_key: str | None
    logical_season: str | None
    start_year: int | None


def resolve_season(value: object, *, source: str = "api-football") -> ResolvedSeason:
    if value is None:
        return ResolvedSeason(None, None, None)

    text = str(value).strip()
    if not text:
        return ResolvedSeason(None, None, None)

    # Already logical: YYYY/YYYY+1.
    match = re.fullmatch(r"(\d{4})\s*/\s*(\d{4})", text)
    if match:
        start, end = int(match.group(1)), int(match.group(2))
        if end != start + 1:
            raise ValueError(f"invalid football season label: {value!r}")
        logical = f"{start}/{end}"
        return ResolvedSeason(text, logical, start)

    # API-Football archive objects use the competition season key. Some annual
    # tournaments in the archived historical corpus are calendar-year seasons.
    if source == "api-football":
        match = re.fullmatch(r"\d{4}", text)
        if match:
            start = int(text)
            if start in _ANNUAL_API_FOOTBALL_SEASONS:
                return ResolvedSeason(text, text, start)
            return ResolvedSeason(text, f"{start}/{start + 1}", start)

    raise ValueError(f"unsupported season value for source={source}: {value!r}")


def normalize_season_label(value: object, *, source: str = "api-football") -> str | None:
    return resolve_season(value, source=source).logical_season


def season_start_year(value: object, *, source: str = "api-football") -> int | None:
    return resolve_season(value, source=source).start_year
