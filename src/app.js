const $ = id => document.getElementById(id);
const originalPage = '<!doctype html>\n' + document.documentElement.outerHTML;
const state = JSON.parse($('state').textContent);
let SCORE_CONFIG = state.config || structuredClone(FACTORY_SCORE_CONFIG);
let DATA, combined, active, view = location.hash === '#stockbond' ? 'market' : 'monitor';
let labResult = null;
const charts = [];
const ink = key => getComputedStyle(document.documentElement).getPropertyValue('--' + key).trim();
const fmt = (v, digits=2, unit='') => v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits) + unit;
const percent = n => fmt(n == null ? null : n * 100, 2, '%');
const round = (n, digits=6) => Number.isFinite(n) ? +n.toFixed(digits) : null;
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const escapeHTML = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getRule = k => SCORE_CONFIG[k];
const ruleOn = k => getRule(k).enabled;
const rweight = k => getRule(k).weight;
const cutoff = key => SCORE_CONFIG.levels[key] + (state.mode === 'normal' ? 1 : 0);
function levelFromScore(score){
  if(score >= cutoff('critical')) return 'High';
  if(score >= cutoff('elevated')) return 'Elevated';
  if(score >= cutoff('mid')) return 'Watch';
  return 'Low';
}
function message(s, error=false){
  $('status').textContent = s;
  $('status').className = error ? 'error' : '';
}
function combine(series){
  if(series.length < 2 || !SCORE_CONFIG.combined.enabled) return [];
  const maps = series.map(s => new Map(s.map(d => [d.date,d])));
  const dates = series[0].map(d=>d.date).filter(date=>maps.every(m=>m.has(date)));
  return computeSeries(dates.map(date=>{
    const points = maps.map(m=>m.get(date));
    const total = key => points.every(d=>d[key]!=null) ? points.reduce((v,d)=>v+d[key],0) : null;
    const nav = points.reduce((v,d,i)=>v+d.nav/maps[i].get(dates[0]).nav,0)/points.length;
    const eq = total('eq'), cap = total('cap'), riskSum = total('risk');
    return {date,nav,eq,cap,risk:eq>0 && cap!=null ? cap/eq*100 : riskSum==null ? null : riskSum/points.length};
  }));
}
function recalculate(){
  DATA = Object.create(null);
  for(const row of state.rows) (DATA[row.account] ||= []).push(row);
  for(const [name,rows] of Object.entries(DATA)){
    rows.sort((a,b)=>a.date.localeCompare(b.date));
    const anchor=rows.find(r=>r.eq>0&&r.nav>0)||rows.find(r=>r.eq>0);
    const normalized=rows.map(r=>({...r,nav:r.nav??(r.eq/anchor.eq*(anchor.nav??1))}));
    DATA[name]=computeSeries(normalized);
  }
  combined = combine(Object.values(DATA));
  const names = Object.keys(DATA).sort();
  const options = names.map(n => ['account:'+n,n]);
  if(combined.length) options.push(['combined','Combined · equal weight']);
  if(!options.some(([id])=>id===active)) active=options[0][0];
  $('account').replaceChildren(...options.map(([id,n])=>new Option(n,id)));
  $('account').value=active;
  $('source').textContent=state.source;
  $('scope').textContent=names.length+' accounts · '+state.rows.length+' observations · '+(state.demo?'Generated NAV data':'Local upload');
  $('mode').value=state.mode;
  $('modeNote').textContent='Cutoffs for watch / elevated / high: '+['mid','elevated','critical'].map(cutoff).join(' / ')+' points. Normal adds one point to each cutoff.';
  render();
}
function metric(label,value,note,spark=''){
  return '<div class="metric">'+label+'<b>'+value+'</b><small>'+note+'</small>'+ (spark?'<div class="spark"><canvas id="'+spark+'" aria-label="'+label+' history"></canvas></div>':'')+'</div>';
}
function table(head,rows, numeric=[]){
  const cell = (tag,x,i)=>'<'+tag+' class="'+(numeric.includes(i)?'num':'')+'">'+x+'</'+tag+'>';
  return '<div class="table"><table><thead><tr>'+head.map((h,i)=>cell('th',h,i)).join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((x,i)=>cell('td',x,i)).join('')+'</tr>').join('')+'</tbody></table></div>';
}
function panel(title,id,note=''){
  return '<div class="panel"><h3>'+title+'</h3><p>'+note+'</p><div class="plot"><canvas id="'+id+'" role="img" aria-label="'+title+'"></canvas></div></div>';
}
function line(label,data,color,options={}){
  return {label,data,borderColor:ink(color),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0,...options};
}
function plot(id,labels,sets,opts={}){
  const scales=opts.spark?{x:{display:false},y:{display:false}}:{
    x:{grid:{display:false},ticks:{color:ink('muted'),maxTicksLimit:6,maxRotation:0}},
    y:{grid:{color:ink('grid')},...opts.y,ticks:{color:ink('muted'),maxTicksLimit:5,...(opts.y&&opts.y.ticks)}}
  };
  if(opts.monitor){
    scales.x.border={display:false};
    scales.x.ticks.padding=opts.signalRows?12:5;
    scales.x.ticks.callback=function(value){
      const date=this.getLabelForValue(value);
      return labels[0].slice(0,4)===labels.at(-1).slice(0,4)
        ? date.slice(5,7)+'/'+date.slice(8,10) : date;
    };
    scales.y.border={display:false};
  }
  charts.push(new Chart($(id),{type:'line',data:{labels,datasets:sets},plugins:opts.signalRows?[signalStrip(opts.signalRows)]:[],options:{
    animation:false,responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales,
    plugins:{legend:{display:!opts.spark&&sets.length>1,labels:{color:ink('muted'),boxWidth:23,boxHeight:1,padding:11}},
      tooltip:{enabled:!opts.spark,callbacks:{afterBody:opts.afterBody||(()=> '')}}}
  }}));
}
// Place flags on their own strip so consecutive signals never obscure the NAV line.
function signalStrip(rows){
  const palette={Low:ink('muted'),Watch:ink('muted'),Elevated:ink('amber'),High:ink('red')};
  return {id:'signalStrip',afterDatasetsDraw(chart){
    const {ctx,chartArea,scales}=chart, y=chartArea.bottom+6;
    ctx.save();
    ctx.lineCap='round';
    rows.forEach((r,i)=>{
      if(!r.signals)return;
      const x=scales.x.getPixelForValue(i);
      ctx.strokeStyle=palette[r.level];
      ctx.lineWidth=r.level==='High'?3:2;
      const height=r.level==='High'?9:r.level==='Elevated'?6:4;
      ctx.beginPath();ctx.moveTo(x,y-height/2);ctx.lineTo(x,y+height/2);ctx.stroke();
    });
    ctx.restore();
  },afterEvent(chart,args){
    const {x,y,type}=args.event,{left,right,bottom}=chart.chartArea;
    if(type==='mouseout'||x<left||x>right||y<=bottom||y>bottom+12)return;
    const index=chart.scales.x.getValueForPixel(x);
    if(!rows[index]?.signals)return;
    const point=chart.getDatasetMeta(0).data[index];
    chart.tooltip.setActiveElements([{datasetIndex:0,index}],{x:point.x,y:point.y});
    args.changed=true;
  }};
}
function monitor(){
  const d=active==='combined'?combined:DATA[active.slice(8)],last=d.at(-1), labels=d.map(r=>r.date);
  const days=Number(SCORE_CONFIG.capacity.tradingDaysPerYear)||252, s=summarize(d,days);
  const latest=last.signals?last.signals.split('|').join(' · '):'No signals triggered';
  const rows=d.filter(r=>r.signals).slice(-40).reverse().map(r=>[r.date,r.score,r.signals.split('|').join(' · '),r.action||'—','<span class="pill level-'+r.level+'">'+r.level+'</span>']);
  const name=active==='combined'?'Combined · equal weight':escapeHTML(active.slice(8));
  const signed=(v,digits=2)=>v==null||!Number.isFinite(v)?'—':(v>0?'+':v<0?'−':'')+Math.abs(v*100).toFixed(digits)+'%';
  const span=s.best!=null&&s.worst!=null&&s.best>s.worst?s.best-s.worst:null;
  const zero=span?clamp(-s.worst/span*100,0,100):50;
  const range=s.best==null?'':'<figure class="range"><figcaption>Daily return range</figcaption><div class="track" aria-hidden="true"><i></i><b style="left:'+zero.toFixed(2)+'%"><em>0</em></b><i></i></div><div class="ends"><div><span>Worst</span>'+signed(s.worst)+'</div><div><span>Best</span>'+signed(s.best)+'</div></div></figure>';
  const card='<div class="panel summary"><h3>Performance summary</h3><small>'+name+' · '+s.n+' observations</small>'+
    '<div class="lead"><span>Cumulative return</span><strong class="'+(s.total<0?'neg':'')+'">'+signed(s.total)+'</strong><small>Annualized return<b>'+signed(s.cagr)+'</b></small></div>'+
    '<dl class="row"><div><dt>Annualized volatility</dt><dd>'+percent(s.vol)+'</dd></div><div><dt>Latest exposure</dt><dd>'+fmt(last.risk,1,'%')+'</dd></div></dl>'+range+'</div>';
  const groups=[['Returns',[['Cumulative return',signed(s.total)],['Annualized return',signed(s.cagr)],['Best day',signed(s.best)],['Worst day',signed(s.worst)],['Positive days',percent(s.winRate)]]],
    ['Risk',[['Annualized volatility',percent(s.vol)],['Sharpe ratio',fmt(s.sharpe)],['Sortino ratio',fmt(s.sortino)],['Daily VaR 95%',signed(s.var95)],['Daily CVaR 95%',signed(s.cvar95)]]],
    ['Drawdown',[['Max drawdown',signed(s.maxDD)],['Longest drawdown',s.longest?s.longest+' obs':'—'],['Calmar ratio',fmt(s.calmar)],['Current drawdown',signed(last.dd)]]],
    ['Exposure',[['Latest exposure',fmt(last.risk,1,'%')],['Average exposure',fmt(s.avgRisk,1,'%')],['Peak exposure',fmt(s.maxRisk,1,'%')]]]];
  const metrics='<div class="panel"><h3>Performance metrics</h3><small>'+name+' · '+s.start+' to '+s.end+' · '+s.n+' observations</small><div class="mgrid">'+groups.map(([g,items])=>'<section><h4>'+g+'</h4><dl>'+items.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('')+'</dl></section>').join('')+'</div>'+
    '<details class="method"><summary>Calculation notes</summary><p>Each observation counts as one trading day; annualized figures use '+days+' per year. Daily VaR is the historical 5th percentile of daily returns and CVaR the mean of that tail. Sharpe and Sortino assume a zero risk-free rate. A drawdown’s length counts observations from the peak.</p></details></div>';
  const periods=drawdownPeriods(d).slice(0,5).map(p=>[p.start,p.end||'<span class="pill level-Watch">Ongoing</span>',signed(p.depth),p.length]);
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], pct1=v=>v==null?'—':'<span class="'+(v<0?'neg':'')+'">'+fmt(v*100,1,'%')+'</span>';
  const monthly='<div class="table"><table class="monthly"><thead><tr><th>Year</th>'+months.map(m=>'<th class="num">'+m+'</th>').join('')+'<th class="num">Year</th></tr></thead><tbody>'+
    monthlyReturns(d).map(y=>'<tr><th>'+y.year+'</th>'+months.map((_,i)=>'<td class="num">'+pct1(y.months[i+1])+'</td>').join('')+'<td class="num"><b>'+pct1(y.total)+'</b></td></tr>').join('')+'</tbody></table></div>';
  $('monitor').innerHTML='<div class="riskline level-'+last.level+'"><b class="level-'+last.level+'">'+last.level+' risk · '+last.score+' points</b>'+last.date+' · '+latest+(last.action?' · '+last.action:'')+'</div>'+
    '<div class="tear"><div class="panel trajectory"><div class="top"><div><h3>Net asset value</h3><small>'+s.start+' to '+s.end+' · '+s.n+' observations · latest '+fmt(last.nav,4)+'</small></div></div>'+
    '<div class="plot"><canvas id="navChart" role="img" aria-label="Net asset value with signal dates marked along the time axis"></canvas></div>'+
    '<div class="signal-key"><b>Signal strip</b><span><i></i>Low / Watch</span><span><i class="elevated"></i>Elevated</span><span><i class="high"></i>High</span></div>'+
    '<div class="top under"><div><h3>Drawdown from peak</h3><small>Worst '+signed(s.maxDD)+' · now '+signed(last.dd)+'</small></div></div><div class="plot dd"><canvas id="ddChart" role="img" aria-label="Drawdown from peak, in percent"></canvas></div></div>'+
    '<div class="side">'+card+'<div class="panel"><h3>Worst drawdowns</h3><p>Peak to recovery, deepest first. Length counts observations from the peak.</p>'+(periods.length?table(['Started','Recovered','Depth','Length'],periods,[2,3]):'<p>No drawdown in this series.</p>')+'</div></div></div>'+
    metrics+'<div class="pair">'+
    panel('Momentum slopes','slopes','NAV change (%) per observation. The 3-obs slope leads; the 10-obs slope is its reference. Click a legend entry to hide a line.')+'<div class="panel"><h3>Exposure and volatility</h3><p>Capital in use, then annualized 10-return volatility, on the same dates.</p><div class="minis"><div><small>Exposure (%)</small><div class="plot"><canvas id="risk" role="img" aria-label="Exposure"></canvas></div></div><div><small>Annualized volatility (%)</small><div class="plot"><canvas id="vol" role="img" aria-label="Annualized volatility"></canvas></div></div></div></div></div>'+
    '<div class="panel"><h3>Monthly returns</h3><p>Chained from the daily returns inside each calendar month.</p>'+monthly+'</div>'+
    '<div class="panel"><h3>Alert history</h3><p>Latest 40 flagged observations, newest first.</p>'+
    (rows.length?table(['Date','Score','Signals','Review note','Level'],rows,[1]):'<p>No signals in this series.</p>')+'</div>';
  plot('navChart',labels,[line('NAV',d.map(r=>r.nav),'forest',{
    borderWidth:2.6,borderJoinStyle:'round',pointRadius:d.length===1?3:0,
    fill:'start',backgroundColor:ink('curve-fill')
  })],{monitor:true,signalRows:d,afterBody:items=>{
    const r=d[items[0].dataIndex];
    return r.signals?r.level+' · '+r.score+' points\n'+r.signals.replace(/\|/g,' · '):'';
  }});
  plot('ddChart',labels,[line('Drawdown (%)',d.map(r=>r.dd*100),'s2',{borderWidth:1.6,fill:'origin',backgroundColor:ink('dd-fill')})],{monitor:true,y:{max:0,ticks:{maxTicksLimit:4}}});
  plot('slopes',labels,slopeSets(d,SCORE_CONFIG.slope.observe),{monitor:true});
  plot('risk',labels,[line('Exposure (%)',d.map(r=>r.risk),'s1',{borderWidth:2})],{monitor:true,y:{ticks:{maxTicksLimit:3}}});
  plot('vol',labels,[line('Annualized volatility (%)',d.map(r=>r.vol==null?null:r.vol*100),'s3',{borderWidth:2})],{monitor:true,y:{ticks:{maxTicksLimit:3}}});
}
function slopeSets(rows,gap){
  return [
    line('3 obs',rows.map(r=>r.s3),'s1',{borderWidth:2.2}),
    line('10 obs',rows.map(r=>r.s10),'s2',{borderWidth:2}),
    line('5 obs',rows.map(r=>r.s5),'s3',{borderWidth:1.4,borderDash:[5,4]}),
    line('Watch threshold',rows.map(r=>r.s10==null?null:r.s10-gap),'reference',{borderWidth:1.2,borderDash:[2,4]})
  ];
}
function renderSignals(){
  const law=computeLaws(), defs=[
    ['Slope slowdown',law.slope],['Rising exposure, falling NAV',law.stall],['Loss at ≥40% exposure',law.highExposure],
    ['Comparison · loss at <40% exposure',law.lowExposure],['Fading momentum at a high',law.fade],['Volatility spike',law.volatility]];
  const max=Math.max(0.0001,...law.slope_buckets.map(b=>Math.abs(b.avg||0)));
  $('signals').innerHTML='<div class="panel"><h3>Five signal families</h3><p>All-observation baseline: <b>'+fmt(law.base,2,'%')+'</b>. Statistics use the loaded individual accounts, with a complete five-observation follow-up. Repeated signals can overlap.</p>'+
    table(['Signal or comparison','Observations','Mean worst return','Worst case'],defs.map(([n,s])=>[n,s.n,fmt(s.avg,2,'%'),fmt(s.worst,2,'%')]),[1,2,3])+'</div><div class="panel"><h3>Short-slope gap</h3><p>Gap in percentage points per observation. Bars show the magnitude of the mean worst forward return. Empty buckets show a dash.</p><div class="barchart">'+
    law.slope_buckets.map(b=>'<div class="bucket"><span>'+b.label+'</span><i style="width:'+Math.abs(b.avg||0)/max*100+'%"></i><span>'+fmt(b.avg,2,'%')+(b.n?'<small>n = '+b.n+'</small>':'')+'</span></div>').join('')+'</div></div>';
}
function marketSlice(){
  const [start,end]=SB_PERIODS[$('period').value];
  const lo=SB_ROWS.findIndex(r=>r[0]>=start),hi=SB_ROWS.findLastIndex(r=>r[0]<=end)+1;
  return {lo,hi,rows:SB_ROWS.slice(lo,hi)};
}
function renderMarket(){
  const {lo,hi,rows}=marketSlice(), cache=sbBuildCache(), labels=rows.map(r=>r[0]);
  const windows=$('window').value==='compare'?[30,90,252]:[+$('window').value];
  const w=windows[0], rolling=cache.rolling[w].slice(lo,hi).filter(n=>n!=null);
  const corr=sbPearson(rows.map(r=>r[1]),rows.map(r=>r[2]));
  $('market').innerHTML='<div class="metrics">'+metric('Trading dates',rows.length.toLocaleString('en-US'),labels[0]+' to '+labels.at(-1))+metric('Period correlation',fmt(corr),'Pearson · daily returns')+metric('Latest correlation',fmt(rolling.at(-1)),w+'-session window')+metric('Positive windows',percent(rolling.filter(v=>v>0).length/rolling.length),w+' sessions')+'</div><p>Full-history daily return correlation: '+fmt(cache.fullCorr)+'. Compare periods and windows to see how sensitive the estimate is to sample choice.</p>'+panel('Rolling return correlation','cor','Correlation ranges from −1 to +1.')+'<div class="pair">'+panel('Cumulative returns','growth','Each ETF is rebased to zero at the first selected close. Values in %.')+panel('Rolling daily volatility','volatility','30-session sample standard deviation, in %.')+'</div>';
  plot('cor',labels,[...windows.map(n=>line(n+' sessions',cache.rolling[n].slice(lo,hi),({30:'s1',90:'s2',252:'s3'})[n],{borderWidth:n===30?2:1.6,borderDash:n===30?[]:n===90?[7,4]:[2,4]})),line('Zero',labels.map(()=>0),'reference',{borderDash:[4,4],borderWidth:1})],{y:{min:-1,max:1}});
  plot('growth',labels,[line('SPY',sbRebasedReturns(rows,1),'s1'),line('IEF',sbRebasedReturns(rows,2),'s2')]);
  plot('volatility',labels,[line('SPY',cache.vol.stock.slice(lo,hi),'s1'),line('IEF',cache.vol.bond.slice(lo,hi),'s2')]);
}
function download(name,body,type){
  const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function exportMarket(){
  const {lo,rows}=marketSlice(),cache=sbBuildCache();
  const header='date,spy_daily_return_pct,ief_daily_return_pct,rolling_corr_30d,rolling_corr_90d,rolling_corr_252d,spy_30d_daily_vol_pct,ief_30d_daily_vol_pct';
  const csv=rows.map(([date,a,b],j)=>{
    const i=lo+j;
    return [date,...[a,b,...[30,90,252].map(w=>cache.rolling[w][i]),cache.vol.stock[i],cache.vol.bond[i]].map(v=>v==null?'':v.toFixed(6))].join(',');
  });
  download('SPY_IEF_'+rows[0][0]+'_'+rows.at(-1)[0]+'.csv',[header,...csv].join('\n'),'text/csv');
}
function runLab(){
  const rows=[];let n=0;
  try {
    for(const raw of $('series').value.trim().split(/\r?\n/)){
      n++;if(!raw.trim())continue;
      const parts=raw.trim().split(/[,\s]+/),v=Number(parts.at(-1));
      if(parts.length>2||!Number.isFinite(v)||v<=0)throw Error('Line '+n+' needs one positive value and an optional date.');
      rows.push({label:parts.length===2?parts[0]:String(rows.length+1),v});
    }
    if(rows.length<11)throw Error('Enter at least 11 observations. Found '+rows.length+'.');
    for(const w of [3,5,10]){
      calcSlope(rows.map(r=>r.v),w).forEach((s,i)=>rows[i]['s'+w]=s==null?null:s/rows[i].v*100);
    }
    for(const r of rows){
      r.gap=r.s10==null?null:r.s10-r.s3;
      r.flag=r.gap==null?'Warming up':r.gap>0.35?'Strong warning':r.gap>0.20&&r.s3<0?'Warning':r.gap>0.20?'Watch':'Normal';
    }
    labResult=rows;$('labError').textContent='';
  }catch(e){labResult=null;$('labError').textContent=e.message;}
  render();
}
function renderLab(){
  const rows=labResult;if(!rows){$('lab').replaceChildren();return;}
  const last=rows.at(-1), flagged=rows.filter(r=>r.flag.toLowerCase().includes('warning')).length;
  $('lab').innerHTML='<div class="panel"><h3>'+last.flag+'</h3><p>Latest gap: '+fmt(last.gap,3,'%')+' per observation · '+flagged+' warnings in '+rows.length+' observations.</p></div>'+panel('Slope history','labChart','Markers indicate warnings. Dashed line shows the watch threshold.')+
    '<div class="panel"><h3>Daily slope readings</h3><p>Most recent 60 observations, newest first.</p>'+table(['Observation','Value','3-period slope','10-period slope','Gap','Status'],rows.slice(-60).reverse().map(r=>[escapeHTML(r.label),fmt(r.v,4),fmt(r.s3,3),fmt(r.s10,3),fmt(r.gap,3),r.flag]),[1,2,3,4])+'</div>';
  const sets=slopeSets(rows,0.20);sets[0].pointRadius=rows.map(r=>r.flag.toLowerCase().includes('warning')?4:0);
  plot('labChart',rows.map(r=>r.label),sets);
}
const rules=[
  ['slope','Slope slowdown','Short slope falls below the medium slope. A strong gap adds 0.5 points.',[['observe','Watch gap'],['strong','Strong gap']]],
  ['riskStall','Rising exposure, falling NAV','Compare NAV and exposure with an earlier observation.',[['lookback','Lookback']]],
  ['highRiskDrop','High-exposure loss','Exposure (%) reaches the floor and the session return is below the specified decimal.',[['risk','Exposure floor (%)'],['ret','Return ceiling']]],
  ['newHighFade','Fading momentum at a high','NAV reaches a high and the 3-period slope trails both longer slopes.',[]],
  ['volSpike','Volatility spike','A negative return coincides with high volatility relative to prior observations.',[['quantile','Quantile'],['minHistory','Prior readings']]],
  ['drawdown','Drawdown breach','Optional extra score at or below the drawdown threshold (decimal).',[['threshold','Drawdown cutoff']]]
];
function field(label,scope,k,v){
  return '<label>'+label+' <input type="number" step="any" data-scope="'+scope+'" data-key="'+k+'" value="'+v+'"></label>';
}
function renderSettings(){
  const c=SCORE_CONFIG,counts=Object.keys(DATA).length,cap=c.capacity;
  const calibration=rules.map(([key,name])=>{const s=signalStat(key);return [name,s.n,fmt(s.avg,2,'%')];});
  $('settings').innerHTML='<div class="pair"><div class="panel"><h3>Score profile · '+c.preset+'</h3><p>Presets set rule weights and baseline cutoffs. Strict uses those cutoffs directly. Normal adds one point to each. In-sample calibration adjusts eligible rules from their historical five-observation outcomes.</p><div class="actions">'+['Sensitive','Balanced','Conservative'].map(p=>'<button data-preset="'+p+'">'+p+'</button>').join('')+'<button id="tune">Calibrate</button><button id="reset">Reset scoring</button></div><div class="settings-controls">'+[['mid','Watch'],['elevated','Elevated'],['critical','High']].map(([k,n])=>field(n,'levels',k,c.levels[k])).join('')+'</div></div><div class="panel"><h3>Multi-account workspace</h3><p>'+counts+' individual accounts · '+state.rows.length+' rows. Planned capacity: '+(state.rows.length+cap.reserveRows)+' rows. This is a planning figure.</p><label><input id="combo" type="checkbox" '+(c.combined.enabled?'checked':'')+'> Enable combined NAV</label><p>Equal-weight rebased NAV on dates shared by every account.'+(c.combined.enabled&&!combined.length?' No shared series available.':'')+'</p><div class="settings-controls">'+field('Reserve rows','capacity','reserveRows',cap.reserveRows)+field('Planning sessions/year','capacity','tradingDaysPerYear',cap.tradingDaysPerYear)+'</div></div></div><div class="panel"><h3>Rule parameters</h3>'+rules.map(([k,n,desc,fields])=>'<details><summary>'+n+' · '+(c[k].enabled?c[k].weight+' points':'Disabled')+'</summary><p>'+desc+'</p><div class="settings-controls"><label><input data-check="'+k+'" type="checkbox" '+(c[k].enabled?'checked':'')+'> Enabled</label>'+field('Weight',k,'weight',c[k].weight)+fields.map(([f,label])=>field(label,k,f,c[k][f])).join('')+(k==='slope'?'<label><input type="checkbox" id="negative" '+(c.slope.needNegative?'checked':'')+'> Require a negative short slope</label>':'')+'</div></details>').join('')+'</div><div class="panel"><h3>Calibration reference</h3><p>Rule matches before enable/disable filters. Only complete five-observation outcomes are included.</p>'+table(['Rule','Eligible observations','Mean worst return'],calibration,[1,2])+'</div>';
  const preset=name=>{
    SCORE_CONFIG={...presetConfig(name),capacity:c.capacity,combined:c.combined};
    recalculate();
  };
  for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>preset(b.dataset.preset);
  $('reset').onclick=()=>preset('Balanced');$('tune').onclick=autoTuneConfig;
  $('combo').onchange=e=>{c.combined.enabled=e.target.checked;recalculate();};
  $('negative').onchange=e=>{c.slope.needNegative=e.target.checked;c.preset='Custom';recalculate();};
  for(const el of document.querySelectorAll('[data-check]'))el.onchange=()=>{c[el.dataset.check].enabled=el.checked;c.preset='Custom';recalculate();};
  for(const el of document.querySelectorAll('input[data-scope]'))el.onchange=()=>{
    const {scope,key}=el.dataset,v=el.valueAsNumber, group={...c[scope],[key]:v};
    const integers=['lookback','minHistory','reserveRows','tradingDaysPerYear'];
    let valid=Number.isFinite(v);
    if(integers.includes(key))valid&&=Number.isSafeInteger(v)&&v>=(key==='reserveRows'?0:1);
    if(['weight','observe','strong','risk'].includes(key))valid&&=v>=0;
    if(key==='quantile')valid&&=v>0&&v<=1;
    if(['ret','threshold'].includes(key))valid&&=v<=0&&v>=-1;
    if(scope==='slope')valid&&=group.strong>=group.observe;
    if(scope==='levels')valid&&=group.mid>0&&group.mid<group.elevated&&group.elevated<group.critical;
    if(!valid){el.value=c[scope][key];message('Invalid setting. Check the range and threshold order.',true);return;}
    c[scope]=group;if(scope!=='capacity')c.preset='Custom';message('Settings updated.');recalculate();
  };
}
// Import aliases retain compatibility with earlier workbooks.
const aliases={
  account:/account|acct|^id$|^code$|账号|账户|组合|产品/i,date:/date|^day$|日期|交易日/i,
  nav:/nav|netvalue|净值/i,eq:/equity|asset|^eq$|权益|净资产/i,
  cap:/capital|exposure|^cap$|保证金|资金占用|仓位|敞口/i,risk:/risk|风险度|风险率/i
};
function readDate(value,is1904){
  let y,m,d;
  if(typeof value==='number'){
    const v=XLSX.SSF.parse_date_code(value,{date1904:is1904});if(!v)return null;
    ({y,m,d}=v);
  }else{
    const s=String(value??'').trim();
    const iso=s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    const us=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
    if(iso)[y,m,d]=iso.slice(1).map(Number);
    else if(us){[m,d,y]=us.slice(1).map(Number);if(us[3].length===2)y+=2000;}
    else return null;
  }
  const t=new Date(Date.UTC(y,m-1,d));
  if(t.getUTCFullYear()!==y||t.getUTCMonth()!==m-1||t.getUTCDate()!==d)return null;
  return t.toISOString().slice(0,10);
}
function numeric(value){
  if(value==null||value==='')return null;
  const s=String(value).trim().replaceAll(',','');
  if(!s || s==='—'||s==='-')return null;
  const n=Number(s.replace(/%$/,''));return Number.isFinite(n)?(s.endsWith('%')?n/100:n):null;
}
function workbookRows(wb,filename){
  const result=[];let skipped=0;
  for(const tab of wb.SheetNames){
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[tab],{header:1,raw:true,defval:null});
    const keys=r=>Array.from(r,v=>Object.keys(aliases).find(key=>aliases[key].test(String(v??'').replace(/\s/g,''))));
    const h=grid.findIndex(r=>{const k=keys(r);return k.includes('date')&&(k.includes('nav')||k.includes('eq'));});
    if(h<0)continue;const cols=keys(grid[h]);
    for(const row of grid.slice(h+1)){
      if(row.every(v=>v==null||v===''))continue;
      const get=k=>row[cols.indexOf(k)], date=readDate(get('date'),!!wb.Workbook?.WBProps?.date1904);
      const account=cols.includes('account')?String(get('account')??'').trim():filename.replace(/\.[^.]+$/,'');
      const eq=numeric(get('eq')),nav=numeric(get('nav')),cap=numeric(get('cap'));
      if(!account||!date||(!(nav>0)&&!(eq>0))){skipped++;continue;}
      const v=numeric(get('risk'));
      // Percent strings and fractions are converted to percentage points.
      const risk=v==null?null:String(get('risk')).trim().endsWith('%')?v*100:v>0&&v<=1?v*100:v;
      result.push({account,date,nav:nav>0?nav:null,eq,cap,risk});
    }
  }
  if(!result.length)throw Error(filename+' has no valid observations. Use date and positive nav or equity. Include account for multiple series.');
  return {result,skipped};
}
function mergeBatch(raw,incoming){
  const maps=new Map();
  for(const row of [...raw,...incoming]){
    if(!maps.has(row.account))maps.set(row.account,new Map());
    maps.get(row.account).set(row.date,row);
  }
  return [...maps.values()].flatMap(m=>[...m.values()].sort((a,b)=>a.date.localeCompare(b.date)));
}
async function upload(files){
  if(!files.length)return;
  $('upload').disabled=true;
  message('Reading local files…');
  try{
    let incoming=[],skipped=0;
    for(const file of files){
      const csv=/\.csv$/i.test(file.name);
      const wb=csv?XLSX.read(await file.text(),{type:'string',raw:true}):XLSX.read(await file.arrayBuffer(),{type:'array'});
      const parsed=workbookRows(wb,file.name);incoming.push(...parsed.result);skipped+=parsed.skipped;
    }
    const rows=mergeBatch(state.demo?[]:state.rows,incoming);
    state.rows=rows;state.demo=false;state.source='Uploaded workspace';active='account:'+incoming[0].account;
    recalculate();message('Read '+incoming.length+' rows from '+files.length+' file(s). '+skipped+' invalid row(s) skipped.');
  }catch(e){message(e.message||'Import failed.',true);}
  finally{$('upload').disabled=false;$('upload').value='';}
}
function saveSnapshot(){
  const payload=JSON.stringify({...state,config:SCORE_CONFIG}).replace(/</g,'\\u003c');
  const html=originalPage.replace(/(<script id="state" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+payload+end);
  download('nav-risk-workbench-snapshot.html',html,'text/html;charset=utf-8');
  message('Snapshot saved with the currently loaded account data and scoring settings.');
}
function template(){
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([
    ['account','date','nav','eq','cap','risk'],['Test North','2025-01-06',1,50000,10000,20],
    ['Test North','2025-01-07',1.003,50150,11033,22],['Test South','2025-01-06',1,75000,9000,12],
    ['Test South','2025-01-07',0.995,74625,8955,12]]);
  XLSX.utils.book_append_sheet(wb,ws,'Daily NAV');XLSX.writeFile(wb,'nav-upload-template.xlsx');
}
function render(){
  while(charts.length)charts.pop().destroy();
  for(const el of document.querySelectorAll('[data-view]'))el.hidden=el.dataset.view!==view;
  for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('active',b.dataset.page===view);b.setAttribute('aria-current',b.dataset.page===view?'page':'false');}
  $('workspace').hidden=view==='market';
  ({monitor,market:renderMarket,signals:renderSignals,lab:renderLab,settings:renderSettings})[view]();
}
for(const b of document.querySelectorAll('[data-page]'))b.onclick=()=>{view=b.dataset.page;render();};
$('account').onchange=e=>{active=e.target.value;render();};
$('mode').onchange=e=>{state.mode=e.target.value;recalculate();};
$('theme').onclick=()=>{const doc=document.documentElement;doc.dataset.theme=doc.dataset.theme==='light'?'dark':'light';$('theme').textContent=doc.dataset.theme==='light'?'Dark theme':'Light theme';render();};
$('upload').onchange=e=>upload(Array.from(e.target.files));
$('template').onclick=template;$('save').onclick=saveSnapshot;
$('period').onchange=render;$('window').onchange=render;$('marketExport').onclick=exportMarket;
$('run').onclick=runLab;
$('example').onclick=()=>{$('series').value=Array.from({length:26},(_,i)=>(1+i*0.003+0.02*Math.sin(i/3)).toFixed(5)).join('\n');runLab();};
$('clear').onclick=()=>{labResult=null;$('series').value='';$('labError').textContent='';render();};
recalculate();
