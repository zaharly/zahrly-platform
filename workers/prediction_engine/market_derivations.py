from __future__ import annotations

from typing import Any


def normalize_distribution(values:list[float])->list[float]:
    clean=[max(0.0,float(v)) for v in values]; total=sum(clean)
    if total<=0: raise ValueError("invalid_distribution_mass")
    return [v/total for v in clean]


def derive_goal_markets(score_matrix:list[list[float]],max_goal_line:int=5)->dict[str,dict[str,Any]]:
    if not score_matrix or any(not row for row in score_matrix): raise ValueError("score_matrix_missing")
    mass=sum(sum(float(v) for v in row) for row in score_matrix)
    if mass<=0: raise ValueError("score_matrix_invalid")
    m=[[max(0.0,float(v))/mass for v in row] for row in score_matrix]; rows={}
    home=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x>y); draw=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x==y); away=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x<y)
    rows.update({"1x2_home":{"family":"1X2","outcome":"HOME_WIN","probability":home,"prediction_state":"PREDICTED_ONLY"},"1x2_draw":{"family":"1X2","outcome":"DRAW","probability":draw,"prediction_state":"PREDICTED_ONLY"},"1x2_away":{"family":"1X2","outcome":"AWAY_WIN","probability":away,"prediction_state":"PREDICTED_ONLY"},"double_chance_1x":{"family":"DOUBLE_CHANCE","outcome":"1X","probability":home+draw,"prediction_state":"PREDICTED_ONLY"},"double_chance_x2":{"family":"DOUBLE_CHANCE","outcome":"X2","probability":draw+away,"prediction_state":"PREDICTED_ONLY"},"double_chance_12":{"family":"DOUBLE_CHANCE","outcome":"12","probability":home+away,"prediction_state":"PREDICTED_ONLY"}})
    btts=sum(m[x][y] for x in range(1,len(m)) for y in range(1,len(m[x])))
    rows["btts_yes"]={"family":"BTTS","outcome":"YES","probability":btts,"prediction_state":"PREDICTED_ONLY"}; rows["btts_no"]={"family":"BTTS","outcome":"NO","probability":1-btts,"prediction_state":"PREDICTED_ONLY"}
    for line in (0.5,1.5,2.5,3.5,4.5):
        k=str(line).replace(".","_"); over=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x+y>line)
        rows[f"goals_over_{k}"]={"family":"GOALS_OU","line":line,"outcome":"OVER","probability":over,"prediction_state":"PREDICTED_ONLY"}; rows[f"goals_under_{k}"]={"family":"GOALS_OU","line":line,"outcome":"UNDER","probability":1-over,"prediction_state":"PREDICTED_ONLY"}
    for side,axis in (("home",0),("away",1)):
        for line in (0.5,1.5,2.5,3.5):
            k=str(line).replace(".","_"); over=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if (x if axis==0 else y)>line)
            rows[f"{side}_goals_over_{k}"]={"family":"TEAM_GOALS_OU","line":line,"outcome":"OVER","probability":over,"prediction_state":"PREDICTED_ONLY"}; rows[f"{side}_goals_under_{k}"]={"family":"TEAM_GOALS_OU","line":line,"outcome":"UNDER","probability":1-over,"prediction_state":"PREDICTED_ONLY"}
    for x in range(min(max_goal_line,len(m)-1)+1):
        for y in range(min(max_goal_line,len(m[x])-1)+1): rows[f"correct_score_{x}_{y}"]={"family":"CORRECT_SCORE","score":f"{x}-{y}","probability":m[x][y],"prediction_state":"PREDICTED_ONLY"}
    return rows


def derive_count_markets(atom:dict[str,Any]|None,family:str,prefix:str,lines:tuple[float,...])->dict[str,dict[str,Any]]:
    if not atom:return {}
    matrix=atom.get("joint_distribution") or atom.get("matrix") or atom.get("distribution")
    out={}
    if isinstance(matrix,list) and matrix and isinstance(matrix[0],list):
        total=sum(sum(max(0.0,float(v)) for v in row) for row in matrix)
        if total<=0:return {}
        m=[[max(0.0,float(v))/total for v in row] for row in matrix]
        for line in lines:
            k=str(line).replace(".","_"); over=sum(m[x][y] for x in range(len(m)) for y in range(len(m[x])) if x+y>line)
            out[f"{prefix}_over_{k}"]={"family":family,"line":line,"outcome":"OVER","probability":over,"prediction_state":"PREDICTED_ONLY"}; out[f"{prefix}_under_{k}"]={"family":family,"line":line,"outcome":"UNDER","probability":1-over,"prediction_state":"PREDICTED_ONLY"}
        return out
    if not isinstance(matrix,list) or not matrix:return {}
    dist=normalize_distribution([float(v) for v in matrix])
    for line in lines:
        k=str(line).replace(".","_"); over=sum(dist[i] for i in range(len(dist)) if i>line)
        out[f"{prefix}_over_{k}"]={"family":family,"line":line,"outcome":"OVER","probability":over,"prediction_state":"PREDICTED_ONLY"}; out[f"{prefix}_under_{k}"]={"family":family,"line":line,"outcome":"UNDER","probability":1-over,"prediction_state":"PREDICTED_ONLY"}
    return out
