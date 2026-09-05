from __future__ import annotations
from math import log
from typing import Sequence
from .walk_forward import Prediction
LABELS=("H","D","A")
CENTERS=tuple(0.05+0.1*i for i in range(10))
def _top(p):
 q=(p.p_home,p.p_draw,p.p_away); i=max(range(3),key=q.__getitem__); return i,max(1e-12,min(1-1e-12,q[i]))
def _pava(v,w):
 b=[]
 for i,(x,z) in enumerate(zip(v,w)):
  b.append([i,i,float(x),float(z)])
  while len(b)>1 and b[-2][2]>b[-1][2]:
   r=b.pop(); l=b.pop(); z=l[3]+r[3]; b.append([l[0],r[1],(l[2]*l[3]+r[2]*r[3])/z,z])
 out=[0.0]*len(v)
 for l,r,x,_ in b:
  for i in range(l,r+1): out[i]=x
 return out

def _fit_map(ps,ys,prior=24.0):
 n=[0]*10; cs=[0.0]*10; ok=[0.0]*10
 for p,y in zip(ps,ys):
  i,c=_top(p); k=min(9,int(c*10)); n[k]+=1; cs[k]+=c; ok[k]+=float(LABELS[i]==y)
 v=[]; w=[]
 for i in range(10):
  if n[i]:
   c=cs[i]/n[i]; v.append((ok[i]+prior*c)/(n[i]+prior)); w.append(n[i]+prior)
  else: v.append(CENTERS[i]); w.append(prior)
 return tuple(max(1e-6,min(1-1e-6,x)) for x in _pava(v,w)),tuple(n)

def _interp(c,m):
 pos=min(9.0,max(0.0,c*10-.5)); i=int(pos)
 return m[9] if i>=9 else m[i]*(1-(pos-i))+m[i+1]*(pos-i)

def apply(pred,cal):
 if not(isinstance(cal,tuple) and len(cal)==3 and cal[0]=="top_label_binned_v1"): return pred
 raw=[max(1e-15,pred.p_home),max(1e-15,pred.p_draw),max(1e-15,pred.p_away)]; t=max(range(3),key=raw.__getitem__)
 c=min(1-1e-9,max(max(raw[i] for i in range(3) if i!=t)+1e-9,_interp(raw[t],cal[2]))); rem=1-c; s=sum(raw)-raw[t]
 out=[c if i==t else rem*raw[i]/max(s,1e-15) for i in range(3)]
 return Prediction(pred.match_id,pred.home_team_id,pred.away_team_id,*out,pred.lambda_home,pred.lambda_away)

def _scores(ps,ys,fn):
 n=len(ps); b=l=r=e=0.; bins=[[0,0.,0] for _ in range(10)]
 for p,y in zip(ps,ys):
  q=fn(p); z=(q.p_home,q.p_draw,q.p_away); t=LABELS.index(y); b+=sum((z[i]-(i==t))**2 for i in range(3)); l-=log(max(1e-15,z[t])); a=z[0]-(t==0); d=z[0]+z[1]-(t in (0,1)); r+=(a*a+d*d)/2; c=max(z); x=bins[min(9,int(c*10))]; x[0]+=1; x[1]+=c; x[2]+=int(max(range(3),key=z.__getitem__)==t)
 e=sum(x[0]/n*abs(x[2]/x[0]-x[1]/x[0]) for x in bins if x[0]); return b/n,l/n,r/n,e

def fit(predictions:Sequence[Prediction],outcomes:Sequence[str]):
 n=len(predictions)
 if n<240:return 1.0,{"status":"INSUFFICIENT_CALIBRATION_DATA","n":n,"method":"regularized_monotone_top_label"}
 block=max(80,n//3); vals=[]; base=[]
 for start in (block,min(2*block,n-1)):
  end=min(n,start+block)
  if end-start<60 or start<120: continue
  base.append(_scores(predictions[start:end],outcomes[start:end],lambda p:p)); m,_=_fit_map(predictions[:start],outcomes[:start])
  for a in (.25,.4,.55,.7,.85,1.0):
   mm=tuple((1-a)*CENTERS[i]+a*m[i] for i in range(10)); vals.append((*_scores(predictions[start:end],outcomes[start:end],lambda p,mm=mm:apply(p,("top_label_binned_v1",CENTERS,mm))),a))
 if not vals or not base:return 1.0,{"status":"INSUFFICIENT_CALIBRATION_VALIDATION","n":n,"method":"regularized_monotone_top_label"}
 vals.sort(); best=vals[0]; ib=tuple(sum(x[i] for x in base)/len(base) for i in range(4))
 if best[0]>=ib[3] or best[1]>ib[0]+.002 or best[2]>ib[1]+.004 or best[3]>ib[2]+.002:return 1.0,{"status":"IDENTITY_SELECTED","n":n,"method":"regularized_monotone_top_label","validation_identity":ib,"candidate":best}
 m,c=_fit_map(predictions,outcomes); a=best[4]; mm=tuple((1-a)*CENTERS[i]+a*m[i] for i in range(10)); return ("top_label_binned_v1",CENTERS,mm),{"status":"FITTED","n":n,"method":"regularized_monotone_top_label","alpha":a,"mapping":[round(x,8) for x in mm],"bin_counts":list(c),"validation_identity":ib,"validation_candidate":best,"argmax_preserved":True,"synthetic_data":False,"random_sampling":False,"oos_targets_used_for_calibration":False}
