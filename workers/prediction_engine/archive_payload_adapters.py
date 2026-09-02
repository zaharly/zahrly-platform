from __future__ import annotations
import base64,gzip,json
from collections.abc import Iterator
from typing import Any

_ID_KEYS=("fixture_id","match_id","game_id","fixtureId","matchId","gameId","fixtureid","matchid","gameid","event_id","eventId","id")
_HOME_KEYS=("home_team_id","home_id","homeTeamId","homeId","match_hometeam_id","matchHomeTeamId","localteam_id","team_home_id")
_AWAY_KEYS=("away_team_id","away_id","awayTeamId","awayId","match_awayteam_id","matchAwayTeamId","visitorteam_id","team_away_id")
_DATE_KEYS=("date","timestamp","fixture_date","match_date","kickoff","kickoff_at","event_date","eventDate","event_timestamp","matchDate","match_datetime")
_HOME_GOAL_KEYS=("home_goals","home_score","homeGoals","homeScore","goalsHomeTeam","home_team_goals","match_hometeam_score","score_home")
_AWAY_GOAL_KEYS=("away_goals","away_score","awayGoals","awayScore","goalsAwayTeam","away_team_goals","match_awayteam_score","score_away")
_HOME_OBJECT_KEYS=("home","homeTeam","home_team","localTeam","localteam")
_AWAY_OBJECT_KEYS=("away","awayTeam","away_team","visitorTeam","visitorteam")

def _decode_json_container(value:Any)->Any:
    cur=value
    for _ in range(8):
        if isinstance(cur,bytes):
            raw=cur
            if raw[:2]==b"\x1f\x8b":
                try: raw=gzip.decompress(raw)
                except (OSError,EOFError): return cur
            for enc in ("utf-8-sig","utf-16"):
                try: cur=raw.decode(enc); break
                except UnicodeDecodeError: continue
            else: return cur
            continue
        if not isinstance(cur,str): return cur
        text=cur.lstrip("\ufeff").strip()
        if not text:return cur
        try: return json.loads(text)
        except (TypeError,ValueError): pass
        lines=[x.strip() for x in text.splitlines() if x.strip()]
        if len(lines)>1:
            parsed=[]
            try:
                for line in lines: parsed.append(json.loads(line.lstrip("\ufeff")))
                return parsed
            except (TypeError,ValueError): pass
        if len(text)>=8:
            try:
                decoded=base64.b64decode(text,validate=False)
                if decoded and decoded!=text.encode(): cur=decoded; continue
            except (ValueError,base64.binascii.Error): pass
        return cur
    return cur

def _iter_children(value:Any)->Iterator[Any]:
    if isinstance(value,list): yield from value; return
    if isinstance(value,dict):
        for child in value.values(): yield child

def _first(value:dict[str,Any],keys:tuple[str,...])->Any:
    for k in keys:
        if value.get(k) is not None:return value[k]
    return None

def _nested_id(value:Any)->Any:
    if isinstance(value,dict): return _first(value,("id","team_id","teamId","teamid"))
    return value

def _nested_score(value:Any)->tuple[Any,Any]:
    if not isinstance(value,dict):return None,None
    h,a=value.get("home"),value.get("away")
    if isinstance(h,dict):h=_first(h,("total","goals","score","value"))
    if isinstance(a,dict):a=_first(a,("total","goals","score","value"))
    return h,a

def _columnar_rows(value:dict[str,Any])->list[dict[str,Any]]|None:
    vals=(_first(value,_ID_KEYS),_first(value,_HOME_KEYS),_first(value,_AWAY_KEYS),_first(value,_DATE_KEYS),_first(value,_HOME_GOAL_KEYS),_first(value,_AWAY_GOAL_KEYS))
    if not any(isinstance(v,list) for v in vals):return None
    n=max(len(v) for v in vals if isinstance(v,list));out=[]
    for i in range(n):
        x=[v[i] if isinstance(v,list) and i<len(v) else v if not isinstance(v,list) else None for v in vals]
        fid,h,a,d,hg,ag=x;h=_nested_id(h);a=_nested_id(a)
        if all(v is not None for v in (fid,h,a,d,hg,ag)):out.append({"fixture":{"id":fid,"date":d},"teams":{"home":{"id":h},"away":{"id":a}},"goals":{"home":hg,"away":ag}})
    return out or None

def _canonical_from_legacy(v:dict[str,Any])->dict[str,Any]|None:
    fixture=v.get("fixture") if isinstance(v.get("fixture"),dict) else None;teams=v.get("teams") if isinstance(v.get("teams"),dict) else None
    fid=_first(v,_ID_KEYS) or (_first(fixture,_ID_KEYS) if fixture else None)
    h=_first(v,_HOME_KEYS);a=_first(v,_AWAY_KEYS)
    if h is None:h=_nested_id(_first(v,_HOME_OBJECT_KEYS))
    if a is None:a=_nested_id(_first(v,_AWAY_OBJECT_KEYS))
    if teams:
        if h is None:h=_nested_id(teams.get("home"))
        if a is None:a=_nested_id(teams.get("away"))
    if h is None and fixture:h=_nested_id(fixture.get("homeTeam"))
    if a is None and fixture:a=_nested_id(fixture.get("awayTeam"))
    d=_first(v,_DATE_KEYS) or (_first(fixture,_DATE_KEYS) if fixture else None)
    goals=v.get("goals") if isinstance(v.get("goals"),dict) else {};score=v.get("score") if isinstance(v.get("score"),dict) else {}
    hg,ag=goals.get("home"),goals.get("away")
    for key in ("fulltime","regular","current","extratime","halftime"):
        p=score.get(key)
        if isinstance(p,dict):
            ph,pa=_nested_score(p)
            if hg is None:hg=ph
            if ag is None:ag=pa
    if hg is None:hg=_first(v,_HOME_GOAL_KEYS)
    if ag is None:ag=_first(v,_AWAY_GOAL_KEYS)
    if any(x is None for x in (fid,h,a,d,hg,ag)):return None
    return {"fixture":{"id":fid,"date":d},"teams":{"home":{"id":h},"away":{"id":a}},"goals":{"home":hg,"away":ag}}

def walk_fixture_rows(value:Any)->Iterator[dict[str,Any]]:
    value=_decode_json_container(value)
    if isinstance(value,list):
        for item in value:yield from walk_fixture_rows(item)
        return
    if not isinstance(value,dict):return
    fixture=value.get("fixture");teams=value.get("teams")
    if isinstance(fixture,dict) and isinstance(teams,dict):yield value;return
    rows=_columnar_rows(value)
    if rows:
        yield from rows
    else:
        canonical=_canonical_from_legacy(value)
        if canonical is not None:yield canonical
    for child in _iter_children(value):yield from walk_fixture_rows(child)
