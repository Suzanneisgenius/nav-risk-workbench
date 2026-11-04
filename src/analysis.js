const FACTORY_SCORE_CONFIG={
  "preset":"Balanced",
  "levels":{"mid":1,"elevated":3,"critical":5},
  "slope":{"enabled":true,"weight":2,"observe":0.20,"strong":0.35,"needNegative":true},
  "riskStall":{"enabled":true,"weight":2,"lookback":3},
  "highRiskDrop":{"enabled":true,"weight":1,"risk":40,"ret":-0.005},
  "newHighFade":{"enabled":true,"weight":3},
  "volSpike":{"enabled":true,"weight":2,"quantile":0.90,"minHistory":20},
  "drawdown":{"enabled":false,"weight":1,"threshold":-0.05},
  "combined":{"enabled":false,"name":"Combined","method":"common_start"},
  "capacity":{"reserveRows":5000,"reserveYears":3,"tradingDaysPerYear":252}
};
function percentile(vals,p){
  const a=vals.filter(v=>v!=null&&Number.isFinite(v)).slice().sort((x,y)=>x-y);
  if(!a.length)return null;
  const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
}
function std(vals){
  const a=vals.filter(v=>v!=null&&Number.isFinite(v));
  if(a.length<2)return null;
  const mean=a.reduce((s,v)=>s+v,0)/a.length;
  return Math.sqrt(a.reduce((s,v)=>s+(v-mean)*(v-mean),0)/(a.length-1));
}
function computeSeries(rows){
  const map=new Map();
  rows.forEach(r=>{if(r&&r.date&&r.nav>0)map.set(r.date,{...r});});
  const arr=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const nav=arr.map(d=>d.nav);
  const raw3=calcSlope(nav,3),raw5=calcSlope(nav,5),raw10=calcSlope(nav,10);
  let peak=-Infinity;
  const rets=[];
  for(let i=0;i<arr.length;i++){
    const d=arr[i],prev=i?arr[i-1]:null;
    d.ret=prev?d.nav/prev.nav-1:null;
    rets[i]=d.ret;
    const wasPeak=d.nav>=peak;
    peak=Math.max(peak,d.nav);
    d.high=wasPeak;
    d.dd=d.nav/peak-1;
    d.s3=raw3[i]==null?null:raw3[i]/d.nav*100;
    d.s5=raw5[i]==null?null:raw5[i]/d.nav*100;
    d.s10=raw10[i]==null?null:raw10[i]/d.nav*100;
    d.sdrop=d.s10==null||d.s3==null?null:d.s10-d.s3;
    const win=rets.slice(Math.max(1,i-9),i+1);
    const sd=win.length>=10?std(win):null;
    d.vol=sd==null?null:sd*Math.sqrt(252);
    if(d.risk==null&&d.eq>0&&d.cap!=null)d.risk=d.cap/d.eq*100;

  }
  for(let i=0;i<arr.length;i++){
    const d=arr[i],signals=[];let score=0,softSlope=false;
    const slope=getRule('slope');
    if(ruleOn('slope')&&d.sdrop!=null&&d.sdrop>Number(slope.observe)){
      softSlope=true;
      if(!slope.needNegative||d.s3<0){
        signals.push('Slope slowdown');
        score+=rweight('slope');
        if(d.sdrop>Number(slope.strong))score+=0.5;
      }
    }
    const rs=getRule('riskStall'),look=Math.max(1,Number(rs.lookback||3));
    const back=i>=look?arr[i-look]:null;
    if(ruleOn('riskStall')&&back&&back.risk!=null&&d.risk!=null&&d.risk>back.risk&&d.nav<back.nav){signals.push('Rising exposure, falling NAV');score+=rweight('riskStall');}
    const hr=getRule('highRiskDrop');
    if(ruleOn('highRiskDrop')&&d.risk!=null&&d.risk>=Number(hr.risk)&&d.ret!=null&&d.ret<Number(hr.ret)){signals.push('High-exposure loss');score+=rweight('highRiskDrop');}
    if(ruleOn('newHighFade')&&d.high&&d.s3!=null&&d.s5!=null&&d.s10!=null&&d.s3<d.s5&&d.s3<d.s10){signals.push('Fading momentum at a high');score+=rweight('newHighFade');}
    const histVol=arr.slice(0,i).map(x=>x.vol).filter(v=>v!=null);
    const vs=getRule('volSpike');
    const vq=histVol.length>=Number(vs.minHistory||20)?percentile(histVol,Number(vs.quantile||0.9)):null;
    if(ruleOn('volSpike')&&vq!=null&&d.vol!=null&&d.vol>=vq&&d.ret!=null&&d.ret<0){signals.push('Volatility spike');score+=rweight('volSpike');}
    const dd=getRule('drawdown');
    if(ruleOn('drawdown')&&d.dd!=null&&d.dd<=Number(dd.threshold)){signals.push('Drawdown breach');score+=rweight('drawdown');}
    d.score=round(score,1);
    d.level=levelFromScore(d.score);
    d.signals=[...new Set(signals)].join('|');
    d.action=d.level==='High'?'Review exposure':d.level==='Elevated'?'Review position risk':softSlope?'Monitor slowing momentum':'';
    ['ret','s3','s5','s10','sdrop','vol','dd','risk','eq','cap'].forEach(k=>{if(d[k]!=null)d[k]=round(d[k],k==='risk'?2:8);});
  }
  return arr;
}
function futureDrop(D,i,days=5){
  if(i+days>=D.length)return null;
  const base=D[i].nav;
  let worst=0;
  for(let j=i+1;j<=Math.min(D.length-1,i+days);j++)worst=Math.min(worst,D[j].nav/base-1);
  return worst*100;
}
function statFor(rows,pred){
  const vals=[];
  rows.forEach(D=>D.forEach((d,i)=>{if(pred(d,i,D)){const v=futureDrop(D,i);if(v!=null)vals.push(v);}}));
  if(!vals.length)return {n:0,avg:null,worst:null};
  return {n:vals.length,avg:+(vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(2),worst:+Math.min(...vals).toFixed(2)};
}
function computeLaws(data=DATA){
  const series=Object.values(data);
  const all=[];
  series.forEach(D=>D.forEach((d,i)=>{const v=futureDrop(D,i);if(v!=null)all.push(v);}));
  const base=all.length?+(all.reduce((s,v)=>s+v,0)/all.length).toFixed(2):null;
  const bucketDefs=[
    ['Short slope faster',d=>d.sdrop!=null&&d.sdrop<0],
    ['0 to 0.10',d=>d.sdrop!=null&&d.sdrop>=0&&d.sdrop<0.10],
    ['0.10 to 0.20',d=>d.sdrop>=0.10&&d.sdrop<0.20],
    ['0.20 to 0.35',d=>d.sdrop>=0.20&&d.sdrop<0.35],
    ['0.35 or above',d=>d.sdrop>=0.35],
  ];
  const slope_buckets=bucketDefs.map(([label,pred])=>{
    const s=statFor(series,pred);
    return {label,n:s.n,avg:s.avg};
  });
  return {
    base,
    'slope':statFor(series,d=>d.signals&&d.signals.includes('Slope slowdown')),
    'stall':statFor(series,d=>d.signals&&d.signals.includes('Rising exposure, falling NAV')),
    'highExposure':statFor(series,d=>d.risk>=40&&d.ret<0),
    'lowExposure':statFor(series,d=>d.risk!=null&&d.risk<40&&d.ret<0),
    'fade':statFor(series,d=>d.signals&&d.signals.includes('Fading momentum at a high')),
    'volatility':statFor(series,d=>d.signals&&d.signals.includes('Volatility spike')),
    slope_buckets
  };
}
function presetConfig(name){
  const base=JSON.parse(JSON.stringify(FACTORY_SCORE_CONFIG));
  base.preset=name;
  if(name==='Sensitive'){
    base.levels={mid:0.8,elevated:2.5,critical:4.5};
    base.slope={...base.slope,observe:0.15,strong:0.28,weight:2.2,needNegative:false};
    base.highRiskDrop={...base.highRiskDrop,risk:35,ret:-0.003,weight:1.2};
  }else if(name==='Conservative'){
    base.levels={mid:1.5,elevated:3.5,critical:6};
    base.slope={...base.slope,observe:0.25,strong:0.45,weight:1.8,needNegative:true};
    base.highRiskDrop={...base.highRiskDrop,risk:45,ret:-0.008,weight:0.8};
    base.volSpike={...base.volSpike,quantile:0.92,minHistory:30};
  }
  return base;
}
function rulePredicate(key,d,i,D){
  if(key==='slope'){
    const r=getRule('slope');
    return d.sdrop!=null&&d.sdrop>Number(r.observe)&&(!r.needNegative||d.s3<0);
  }
  if(key==='riskStall'){
    const r=getRule('riskStall'),look=Math.max(1,Number(r.lookback||3)),b=i>=look?D[i-look]:null;
    return !!(b&&b.risk!=null&&d.risk!=null&&d.risk>b.risk&&d.nav<b.nav);
  }
  if(key==='highRiskDrop'){
    const r=getRule('highRiskDrop');
    return d.risk!=null&&d.risk>=Number(r.risk)&&d.ret!=null&&d.ret<Number(r.ret);
  }
  if(key==='newHighFade')return d.high&&d.s3!=null&&d.s5!=null&&d.s10!=null&&d.s3<d.s5&&d.s3<d.s10;
  if(key==='volSpike'){
    const r=getRule('volSpike'),hist=D.slice(0,i).map(x=>x.vol).filter(v=>v!=null);
    const q=hist.length>=Number(r.minHistory||20)?percentile(hist,Number(r.quantile||0.9)):null;
    return q!=null&&d.vol!=null&&d.vol>=q&&d.ret!=null&&d.ret<0;
  }
  if(key==='drawdown')return d.dd!=null&&d.dd<=Number(getRule('drawdown').threshold);
  return false;
}
function signalStat(key){
  return statFor(Object.values(DATA), (d,i,D)=>rulePredicate(key,d,i,D));
}
function autoTuneConfig(){
  const all=[];
  Object.values(DATA).forEach(D=>D.forEach((d,i)=>{const v=futureDrop(D,i);if(v!=null)all.push(v);}));
  const base=all.length?all.reduce((s,v)=>s+v,0)/all.length:0;
  ['slope','riskStall','highRiskDrop','newHighFade','volSpike'].forEach(k=>{
    const st=signalStat(k),r=getRule(k);
    if(st.n<5)return;
    const edge=base-st.avg;
    r.weight=+(edge>=0.9?3:edge>=0.5?2.4:edge>=0.2?1.5:0.8).toFixed(1);
    r.enabled=edge>-0.1;
  });
  const drops=Object.values(DATA).flat().map(d=>d.sdrop).filter(v=>v!=null&&v>0).sort((a,b)=>a-b);
  if(drops.length>20){
    SCORE_CONFIG.slope.observe=+clamp(percentile(drops,.62),0.12,0.35).toFixed(2);
    SCORE_CONFIG.slope.strong=+clamp(percentile(drops,.84),0.25,0.8).toFixed(2);
  }
  SCORE_CONFIG.preset='Calibrated';
  recalculate();
}
function calcSlope(nav,w){
  const res=new Array(nav.length).fill(null);
  for(let i=w-1;i<nav.length;i++){
    const y=nav.slice(i-w+1,i+1);let sx=0,sy=0,sxy=0,sxx=0;
    for(let k=0;k<w;k++){sx+=k;sy+=y[k];sxy+=k*y[k];sxx+=k*k;}
    res[i]=(w*sxy-sx*sy)/(w*sxx-sx*sx);
  }
  return res;
}
const SB_PERIODS={
  all:['2002-08-01','2024-07-30'],gfc:['2007-01-01','2009-12-31'],
  covid:['2020-01-01','2021-12-31'],recent:['2022-01-01','2024-07-30']
};

let sbCache=null;

function sbPrefix(values){
  const sum=[0],sq=[0];
  for(const v of values){sum.push(sum.at(-1)+v);sq.push(sq.at(-1)+v*v);}
  return {sum,sq};
}
function sbPearson(a,b){
  if(a.length<3)return null;
  const n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;
  let xy=0,xx=0,yy=0;
  for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;xy+=x*y;xx+=x*x;yy+=y*y;}
  return xx>0&&yy>0?xy/Math.sqrt(xx*yy):null;
}
function sbBuildCache(){
  if(sbCache)return sbCache;
  const stock=SB_ROWS.map(r=>r[1]),bond=SB_ROWS.map(r=>r[2]);
  const a=sbPrefix(stock),b=sbPrefix(bond),xy=[0];
  for(let i=0;i<stock.length;i++)xy.push(xy.at(-1)+stock[i]*bond[i]);
  const rolling={};
  for(const w of [30,90,252]){
    rolling[w]=stock.map((_,i)=>{
      if(i+1<w)return null;
      const j=i+1-w,sx=a.sum[i+1]-a.sum[j],sy=b.sum[i+1]-b.sum[j];
      const vx=a.sq[i+1]-a.sq[j]-sx*sx/w,vy=b.sq[i+1]-b.sq[j]-sy*sy/w;
      const cov=xy[i+1]-xy[j]-sx*sy/w;
      return vx>0&&vy>0?Math.max(-1,Math.min(1,cov/Math.sqrt(vx*vy))):null;
    });
  }
  const vol={};
  for(const [key,p] of [['stock',a],['bond',b]]){
    vol[key]=stock.map((_,i)=>{
      const w=30;if(i+1<w)return null;
      const j=i+1-w,s=p.sum[i+1]-p.sum[j];
      return Math.sqrt(Math.max(0,(p.sq[i+1]-p.sq[j]-s*s/w)/(w-1)));
    });
  }
  sbCache={stock,bond,rolling,vol,fullCorr:sbPearson(stock,bond)};
  return sbCache;
}
function sbRebasedReturns(rows,column){
  let value=1;
  return rows.map((r,i)=>{if(i)value*=1+r[column]/100;return(value-1)*100;});
}
