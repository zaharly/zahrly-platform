from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime,timezone
from math import exp
from typing import Iterable,Sequence
from .dixon_coles import DixonColesPolicy,probability_matrix,result_probabilities,time_decay_weight
from .elo import EloPolicy,EloState,update_elo
@dataclass(frozen=True)
class Match:
    match_id:str; played_at:datetime; home_team_id:str; away_team_id:str; home_goals:int; away_goals:int; season:int|None=None
@dataclass(frozen=True)
class Prediction:
    match_id:str; home_team_id:str; away_team_id:str; p_home:float; p_draw:float; p_away:float; lambda_home:float; lambda_away:float
class LeakageError(ValueError):pass
def _utc(v):return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
def _team_rates(train,cutoff,policy):
 cutoff=_utc(cutoff);gf={};ga={};tw=tg=0.
 for m in train:
  played=_utc(m.played_at)
  if played>=cutoff:raise LeakageError(f'training row {m.match_id} is not before cutoff')
  w=time_decay_weight((cutoff-played).total_seconds()/86400.,policy.decay_half_life_days)
  for t,x,y in ((m.home_team_id,m.home_goals,m.away_goals),(m.away_team_id,m.away_goals,m.home_goals)):gf[t]=gf.get(t,0)+w*x;ga[t]=ga.get(t,0)+w*y
  tw+=2*w;tg+=w*(m.home_goals+m.away_goals)
 rate=max(tg/max(tw,1e-12),1e-6);den=max(tw/2,1e-12);return {t:(v/den)/rate for t,v in gf.items()},{t:(v/den)/rate for t,v in ga.items()},rate
def _feature_factor(match,features,side):
 if not features:return 1.
 s=features.get(match.match_id)
 if not s:return 1.
 x=s.get(f'{side}.last5.fixture_statistics.xg.mean');shots=s.get(f'{side}.last5.fixture_statistics.shots_on_target.mean');factor=1.
 if x is not None:factor*=min(1.15,max(.85,1+.12*(x-1)))
 if shots is not None:factor*=min(1.10,max(.90,1+.025*(shots-4)))
 return factor
def predict_with_state(match,ratings,train,cutoff,elo_policy=EloPolicy(),dc_policy=DixonColesPolicy(),features=None,team_rates=None):
 if _utc(match.played_at)<_utc(cutoff):raise LeakageError('test match must be at or after fold cutoff')
 if team_rates is None:team_rates=_team_rates(train,cutoff,dc_policy)
 attack,defense,rate=team_rates;hr=ratings.get(match.home_team_id,EloState(elo_policy.initial_rating));ar=ratings.get(match.away_team_id,EloState(elo_policy.initial_rating));ef=1/(1+exp(-((hr.rating+elo_policy.home_advantage)-ar.rating)/elo_policy.rating_scale*2.302585092994046));ha=attack.get(match.home_team_id,1);aa=attack.get(match.away_team_id,1);hd=defense.get(match.home_team_id,1);ad=defense.get(match.away_team_id,1);hl=max(.05,rate*exp(dc_policy.home_advantage)*ha/max(ad,.05)*(.75+.5*ef)*_feature_factor(match,features,'home'));al=max(.05,rate*aa/max(hd,.05)*(1.25-.5*ef)*_feature_factor(match,features,'away'));ph,pd,pa=result_probabilities(probability_matrix(hl,al,dc_policy.rho,dc_policy.max_goals));return Prediction(match.match_id,match.home_team_id,match.away_team_id,ph,pd,pa,hl,al)
def run_fold(train,test,cutoff,elo_policy=EloPolicy(),dc_policy=DixonColesPolicy(),features=None):
 cutoff=_utc(cutoff);train=sorted(train,key=lambda m:_utc(m.played_at));test=sorted(test,key=lambda m:_utc(m.played_at))
 if any(_utc(m.played_at)>=cutoff for m in train):raise LeakageError('fold training contains future data')
 if any(_utc(m.played_at)<cutoff for m in test):raise LeakageError('fold test contains pre-cutoff data')
 ratings={}
 for m in train:
  h=ratings.get(m.home_team_id,EloState(elo_policy.initial_rating));a=ratings.get(m.away_team_id,EloState(elo_policy.initial_rating));ratings[m.home_team_id],ratings[m.away_team_id],_=update_elo(h,a,m.home_goals,m.away_goals,elo_policy)
 team_rates=_team_rates(train,cutoff,dc_policy);out=[]
 for m in test:
  out.append(predict_with_state(m,ratings,train,cutoff,elo_policy,dc_policy,features,team_rates));h=ratings.get(m.home_team_id,EloState(elo_policy.initial_rating));a=ratings.get(m.away_team_id,EloState(elo_policy.initial_rating));ratings[m.home_team_id],ratings[m.away_team_id],_=update_elo(h,a,m.home_goals,m.away_goals,elo_policy)
 return out
def build_walk_forward_folds(matches:Iterable[Match],cutoffs:Sequence[datetime],test_window_days:int=365):
 if test_window_days<=0:raise ValueError('test_window_days must be positive')
 ordered=sorted(matches,key=lambda m:_utc(m.played_at));seasoned=all(m.season is not None for m in ordered);folds=[]
 if seasoned:
  season_starts={s:min(_utc(m.played_at) for m in ordered if m.season==s) for s in sorted({m.season for m in ordered})}
 for raw in cutoffs:
  cutoff=_utc(raw)
  if seasoned:
   labels=[s for s,start in season_starts.items() if start==cutoff]
   if not labels:continue
   season_label=labels[0];train=[m for m in ordered if m.season<season_label];test=[m for m in ordered if m.season==season_label]
  else:
   end=datetime(cutoff.year+1,1,1,tzinfo=timezone.utc);train=[m for m in ordered if _utc(m.played_at)<cutoff];test=[m for m in ordered if cutoff<=_utc(m.played_at)<end]
  folds.append((train,test,cutoff))
 return folds
