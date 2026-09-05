from __future__ import annotations

import math
from typing import Any


def _team_params(artifact: dict[str, Any], team_id: str) -> tuple[float, float, float, str]:
    elo=artifact.get("elo") or {}; dc=artifact.get("dixon_coles") or {}
    ratings=elo.get("ratings") or {}; attack=dc.get("attack") or {}; defense=dc.get("defense") or {}; tid=str(team_id)
    if tid in ratings and tid in attack and tid in defense:
        raw=ratings[tid]; rating=float(raw.get("rating") if isinstance(raw,dict) else raw)
        return rating,float(attack[tid]),max(float(defense[tid]),0.05),"TEAM_HISTORY"
    cold=artifact.get("cold_start") or {}; version=cold.get("cold_start_policy_version"); prior=cold.get("team_prior") or {}
    if version and tid in prior:
        item=prior[tid]
        if not all(k in item for k in ("rating","attack","defense")): raise RuntimeError(f"cold_start_prior_incomplete:{tid}")
        return float(item["rating"]),float(item["attack"]),max(float(item["defense"]),0.05),str(version)
    raise RuntimeError(f"missing_team_state:{tid}")


def _poisson(k:int,lam:float)->float:
    fact=1.0
    for i in range(2,k+1): fact*=i
    return math.exp(k*math.log(lam)-lam)/fact


def score_matrix(home_lambda:float,away_lambda:float,rho:float,max_goals:int)->list[list[float]]:
    if home_lambda<=0 or away_lambda<=0: raise RuntimeError("invalid_lambda")
    matrix=[]; total=0.0
    for x in range(max_goals+1):
        row=[]
        for y in range(max_goals+1):
            tau=1.0
            if x==0 and y==0: tau=1.0-home_lambda*away_lambda*rho
            elif x==0 and y==1: tau=1.0+home_lambda*rho
            elif x==1 and y==0: tau=1.0+away_lambda*rho
            elif x==1 and y==1: tau=1.0-rho
            p=_poisson(x,home_lambda)*_poisson(y,away_lambda)*max(0.0,tau)
            row.append(p); total+=p
        matrix.append(row)
    if total<=0: raise RuntimeError("invalid_score_state")
    return [[v/total for v in row] for row in matrix]


def calibrate_1x2(matrix:list[list[float]],temperature:float)->dict[str,float]:
    home=sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x>y)
    draw=sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x==y)
    away=sum(matrix[x][y] for x in range(len(matrix)) for y in range(len(matrix[x])) if x<y)
    values=[home,draw,away]
    if not math.isfinite(temperature) or not 0.60<=temperature<=1.00: raise RuntimeError("invalid_calibration_temperature")
    z=[math.log(max(1e-15,v))/temperature for v in values]; m=max(z); w=[math.exp(v-m) for v in z]; s=sum(w)
    return {k:w[i]/s for i,k in enumerate(("home","draw","away"))}


def predict_fixture(fixture:dict[str,Any],artifact:dict[str,Any],temperature:float)->dict[str,Any]:
    elo=artifact.get("elo") or {}; dc=artifact.get("dixon_coles") or {}
    rh,ah,dh,home_source=_team_params(artifact,fixture["home_team_id"])
    ra,aa,da,away_source=_team_params(artifact,fixture["away_team_id"])
    rate=float(dc["league_rate"]); rho=float(dc.get("rho",0.0)); home_adv=float(dc.get("home_advantage",0.0)); max_goals=min(max(int(dc.get("max_goals",10)),6),12)
    if not 0.25<=rate<=4.0: raise RuntimeError("league_rate_out_of_bounds")
    # Any Elo/Glicko influence must be an explicitly trained coefficient in the artifact.
    elo_weight=float(dc.get("elo_context_weight",0.0)); scale=max(float(elo.get("rating_scale",400.0)),1.0); rating_adv=float(elo.get("home_advantage",0.0))
    elo_term=elo_weight*((rh+rating_adv-ra)/scale)
    lh=math.exp(math.log(rate)+home_adv+math.log(max(ah,1e-9))-math.log(max(da,1e-9))+elo_term)
    la=math.exp(math.log(rate)+math.log(max(aa,1e-9))-math.log(max(dh,1e-9))-elo_term)
    matrix=score_matrix(lh,la,rho,max_goals); probabilities=calibrate_1x2(matrix,temperature)
    return {"lambdas":{"home":lh,"away":la},"raw":calibrate_1x2(matrix,1.0),"probabilities":probabilities,"score_matrix":matrix,"state_sources":{"home":home_source,"away":away_source}}
