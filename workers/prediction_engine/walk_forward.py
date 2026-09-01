from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import exp
from typing import Iterable, Sequence

from .dixon_coles import DixonColesPolicy, probability_matrix, result_probabilities, time_decay_weight
from .elo import EloPolicy, EloState, update_elo


@dataclass(frozen=True)
class Match:
    match_id: str
    played_at: datetime
    home_team_id: str
    away_team_id: str
    home_goals: int
    away_goals: int
    season: int | None = None


@dataclass(frozen=True)
class Prediction:
    match_id: str
    home_team_id: str
    away_team_id: str
    p_home: float
    p_draw: float
    p_away: float
    lambda_home: float
    lambda_away: float


class LeakageError(ValueError): pass


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _team_rates(train: Sequence[Match], cutoff: datetime, policy: DixonColesPolicy):
    cutoff=_utc(cutoff); goals_for={}; goals_against={}; total_weight=total_goals=0.0
    for m in train:
        played=_utc(m.played_at)
        if played>=cutoff: raise LeakageError(f'training row {m.match_id} is not before cutoff')
        w=time_decay_weight((cutoff-played).total_seconds()/86400.0,policy.decay_half_life_days)
        for team,gf,ga in ((m.home_team_id,m.home_goals,m.away_goals),(m.away_team_id,m.away_goals,m.home_goals)):
            goals_for[team]=goals_for.get(team,0.0)+w*gf; goals_against[team]=goals_against.get(team,0.0)+w*ga
        total_weight+=2*w; total_goals+=w*(m.home_goals+m.away_goals)
    league_rate=max(total_goals/max(total_weight,1e-12),1e-6); per_team_weight=max(total_weight/2,1e-12)
    attack={t:(gf/per_team_weight)/league_rate for t,gf in goals_for.items()}; defense={t:(ga/per_team_weight)/league_rate for t,ga in goals_against.items()}
    return attack,defense,league_rate


def predict_with_state(match: Match, ratings: dict[str,EloState], train: Sequence[Match], cutoff: datetime, elo_policy: EloPolicy=EloPolicy(), dc_policy: DixonColesPolicy=DixonColesPolicy()) -> Prediction:
    if _utc(match.played_at)<_utc(cutoff): raise LeakageError('test match must be at or after fold cutoff')
    attack,defense,league_rate=_team_rates(train,cutoff,dc_policy); hr=ratings.get(match.home_team_id,EloState(elo_policy.initial_rating)); ar=ratings.get(match.away_team_id,EloState(elo_policy.initial_rating))
    elo_delta=(hr.rating+elo_policy.home_advantage)-ar.rating; elo_factor=1/(1+exp(-elo_delta/elo_policy.rating_scale*2.302585092994046))
    home_attack=attack.get(match.home_team_id,1); away_attack=attack.get(match.away_team_id,1); home_defense=defense.get(match.home_team_id,1); away_defense=defense.get(match.away_team_id,1)
    home_lambda=max(.05,league_rate*exp(dc_policy.home_advantage)*home_attack/max(away_defense,.05)*(.75+.5*elo_factor)); away_lambda=max(.05,league_rate*away_attack/max(home_defense,.05)*(1.25-.5*elo_factor))
    matrix=probability_matrix(home_lambda,away_lambda,dc_policy.rho,dc_policy.max_goals); p_home,p_draw,p_away=result_probabilities(matrix)
    return Prediction(match.match_id,match.home_team_id,match.away_team_id,p_home,p_draw,p_away,home_lambda,away_lambda)


def run_fold(train: Sequence[Match], test: Sequence[Match], cutoff: datetime, elo_policy: EloPolicy=EloPolicy(), dc_policy: DixonColesPolicy=DixonColesPolicy()) -> list[Prediction]:
    cutoff=_utc(cutoff); train=sorted(train,key=lambda m:_utc(m.played_at)); test=sorted(test,key=lambda m:_utc(m.played_at))
    if any(_utc(m.played_at)>=cutoff for m in train): raise LeakageError('fold training contains future data')
    if any(_utc(m.played_at)<cutoff for m in test): raise LeakageError('fold test contains pre-cutoff data')
    ratings={}
    for m in train:
        h=ratings.get(m.home_team_id,EloState(elo_policy.initial_rating)); a=ratings.get(m.away_team_id,EloState(elo_policy.initial_rating)); h2,a2,_=update_elo(h,a,m.home_goals,m.away_goals,elo_policy); ratings[m.home_team_id],ratings[m.away_team_id]=h2,a2
    predictions=[]
    for m in test:
        predictions.append(predict_with_state(m,ratings,train,cutoff,elo_policy,dc_policy)); h=ratings.get(m.home_team_id,EloState(elo_policy.initial_rating)); a=ratings.get(m.away_team_id,EloState(elo_policy.initial_rating)); h2,a2,_=update_elo(h,a,m.home_goals,m.away_goals,elo_policy); ratings[m.home_team_id],ratings[m.away_team_id]=h2,a2
    return predictions


def build_walk_forward_folds(matches: Iterable[Match], cutoffs: Sequence[datetime], test_window_days: int=365):
    if test_window_days<=0: raise ValueError('test_window_days must be positive')
    ordered=sorted(matches,key=lambda m:_utc(m.played_at)); folds=[]
    has_seasons=all(m.season is not None for m in ordered)
    for cutoff_raw in cutoffs:
        cutoff=_utc(cutoff_raw)
        if has_seasons:
            season=cutoff.year
            train=[m for m in ordered if m.season is not None and m.season<season]
            test=[m for m in ordered if m.season==season]
        else:
            next_year=datetime(cutoff.year+1,1,1,tzinfo=timezone.utc)
            train=[m for m in ordered if _utc(m.played_at)<cutoff]
            test=[m for m in ordered if cutoff<=_utc(m.played_at)<next_year]
        folds.append((train,test,cutoff))
    return folds
