from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

from .archive_training_source import load_settled_matches


@dataclass(frozen=True)
class FeatureSnapshot:
    values: dict[str, float] = field(default_factory=dict)
    available: dict[str, bool] = field(default_factory=dict)
    sources: tuple[str, ...] = ()

    def get(self, key: str, default: float | None = None):
        return self.values.get(key, default)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _point_for_team(match, team_id: str) -> tuple[float, float, float, float, float, float, float, float, float, str]:
    home = match.home_team_id == team_id
    gf = float(match.home_goals if home else match.away_goals)
    ga = float(match.away_goals if home else match.home_goals)
    if gf > ga:
        points = 3.0
        win, draw, loss = 1.0, 0.0, 0.0
    elif gf == ga:
        points = 1.0
        win, draw, loss = 0.0, 1.0, 0.0
    else:
        points = 0.0
        win, draw, loss = 0.0, 0.0, 1.0
    clean = 1.0 if ga == 0.0 else 0.0
    failed = 1.0 if gf == 0.0 else 0.0
    venue = "home" if home else "away"
    return gf, ga, points, win, draw, loss, clean, failed, gf - ga, venue


def _history_index(matches: Iterable) -> dict[str, tuple[list[datetime], list[tuple]]]:
    ordered = sorted(matches, key=lambda m: (_utc(m.played_at), str(m.match_id)))
    by_team: dict[str, list[tuple]] = {}
    for match in ordered:
        played = _utc(match.played_at)
        for team_id in (match.home_team_id, match.away_team_id):
            gf, ga, points, win, draw, loss, clean, failed, goal_diff, venue = _point_for_team(match, team_id)
            by_team.setdefault(team_id, []).append((played, gf, ga, points, win, draw, loss, clean, failed, goal_diff, venue))
    return {
        team_id: ([row[0] for row in rows], rows)
        for team_id, rows in by_team.items()
    }


def _aggregate(prefix: str, rows: list[tuple]) -> dict[str, float]:
    if not rows:
        return {}
    n = float(len(rows))
    gf = sum(r[1] for r in rows) / n
    ga = sum(r[2] for r in rows) / n
    points = sum(r[3] for r in rows) / (3.0 * n)
    win = sum(r[4] for r in rows) / n
    draw = sum(r[5] for r in rows) / n
    loss = sum(r[6] for r in rows) / n
    clean = sum(r[7] for r in rows) / n
    failed = sum(r[8] for r in rows) / n
    diff = sum(r[9] for r in rows) / n
    out = {
        f"{prefix}.avg_goals_for": gf,
        f"{prefix}.avg_goals_against": ga,
        f"{prefix}.avg_goal_diff": diff,
        f"{prefix}.points_rate": points,
        f"{prefix}.win_rate": win,
        f"{prefix}.draw_rate": draw,
        f"{prefix}.loss_rate": loss,
        f"{prefix}.clean_sheet_rate": clean,
        f"{prefix}.failed_to_score_rate": failed,
        f"{prefix}.matches": n,
    }
    return out


def build_feature_index(conn, target_matches, latest_target=None):
    targets = list(target_matches)
    if not targets:
        return {}

    all_matches = load_settled_matches(conn, as_of=max(_utc(m.played_at) for m in targets))
    index = _history_index(all_matches)
    output: dict[str, FeatureSnapshot] = {}

    for match in targets:
        kickoff = _utc(match.played_at)
        values: dict[str, float] = {}
        sources: set[str] = set()
        for side, team_id in (("home", match.home_team_id), ("away", match.away_team_id)):
            entry = index.get(team_id)
            if not entry:
                continue
            timestamps, rows = entry
            end = bisect_left(timestamps, kickoff)
            prior = rows[max(0, end - 5):end]
            if not prior:
                continue
            values.update(_aggregate(f"{side}.last5", prior))
            venue = "home" if side == "home" else "away"
            venue_rows = [row for row in prior if row[10] == venue]
            values.update(_aggregate(f"{side}.{venue}.last5", venue_rows))
            rest_days = (kickoff - prior[-1][0]).total_seconds() / 86400.0
            values[f"{side}.rest_days"] = max(0.0, rest_days)
            sources.add("canonical_fixtures")

        output[match.match_id] = FeatureSnapshot(
            values=values,
            available={key: True for key in values},
            sources=tuple(sorted(sources)),
        )

    return output


def build_feature_index_for_matches(conn, matches, cutoff):
    selected = [m for m in matches if _utc(m.played_at) >= _utc(cutoff)]
    return build_feature_index(conn, selected, cutoff)
