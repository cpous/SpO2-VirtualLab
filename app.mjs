import {Simulator,defaults,fields,presets,validate} from './model.mjs';
const $=id=>document.getElementById(id),fmt=(n,d=3)=>Number.isFinite(n)?n.toLocaleString('ca',{minimumFractionDigits:d,maximumFractionDigits:d}):'No disponible';
let simulator=new Simulator(),paused=false,changes=[],lastFrame=performance.now(),lastDraw=0,lastMetrics=0,forceScale=true;
const definitions={optical:['1 · Senyal òptic incident','µW',1e6],current:['2 · Fotocorrent','µA',1e6],tia:['3 · Sortida TIA','V',1],digital:['4 · Senyal digitalitzat','V',1],final:['5 · PPG final','mV',1000]};
const ranges=new Map();let plots=[];
for(const [key,label,min,max,step,unit,group] of fields){
 const row=document.createElement('div');row.className='field';
 row.innerHTML=`<label for="${key}">${label}</label><div class="input-unit"><input type="number" id="${key}" min="${min}" max="${max}" step="${step}" value="${defaults[key]}" required><span>${unit}</span></div>`;
 $(`fields-${group}`).append(row);
 $(key).addEventListener('change',()=>applyControls(key));
}
function parameters(){const p={};for(const [key] of fields)p[key]=Number($(key).value);for(const key of ['ambient_compensation','filter_enabled'])p[key]=$(key).checked;return p;}
function syncBand(changed){
 const low=$('filter_low'),high=$('filter_high'),fs=Number($('sample_rate').value);
 if(!Number.isFinite(fs)||fs<20||fs>1000)return;
 const max=Number((fs/2-.01).toFixed(2));
 if(changed==='sample_rate'){
  high.value=Math.min(Number(high.value),max);
  low.value=Math.min(Number(low.value),Number(high.value)-.01).toFixed(2);
 }
 high.max=max;low.max=Number((Number(high.value)-.01).toFixed(2));high.min=Number((Number(low.value)+.01).toFixed(2));
 low.disabled=high.disabled=!$('filter_enabled').checked;
}
function applyControls(changed){
 syncBand(changed);
 try{
  const p=validate(parameters());
  if(simulator.setParameters(p)){changes.push({time:simulator.time});lastMetrics=-1;forceScale=$('scale').value!=='lock';}
  $('preset').value='';updateLabels();render(true);
 }catch(error){$('warning').textContent=error.message;$('warning').className='warning';}
}
for(const key of ['ambient_compensation','filter_enabled'])$(key).addEventListener('change',()=>applyControls(key));
function updateLabels(){const p=simulator.p;$('adc-label').textContent=`${p.adc_bits} bits`;$('filter-label').textContent=p.filter_enabled?`${p.filter_low}–${p.filter_high} Hz`:'Sense filtre';for(const plot of plots)plot.title.textContent=title(plot.key,plot.channel);}
function title(key,channel){return definitions[key][0]+(key==='final'?' · '+(simulator.p.filter_enabled?`${simulator.p.filter_low}–${simulator.p.filter_high} Hz`:'sense filtre'):'')+(channel?' · '+channel:'');}
function createPlots(){
 const key=$('view').value,detail=key!=='all';$('plots').classList.toggle('detail',detail);$('plots').replaceChildren();plots=[];
 for(const [stage,channel] of detail?[[key,'R'],[key,'IR']]:Object.keys(definitions).map(k=>[k,null])){
  const panel=document.createElement('section');panel.className='plot';const heading=document.createElement('h2');heading.textContent=title(stage,channel);const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',heading.textContent+' en funció del temps');panel.append(heading,canvas);$('plots').append(panel);plots.push({key:stage,channel,canvas,title:heading});
 }
 forceScale=true;requestAnimationFrame(()=>render(true));
}
function draw(plot,result){
 const canvas=plot.canvas,rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
 if(w<1||h<1)return;
 const ratio=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const key=plot.key,center=$('centered').checked&&(key!=='final'||!simulator.p.filter_enabled),duration=Number($('window').value),end=Math.max(duration,simulator.time),start=end-duration;
 let [,unit,multiplier]=definitions[key];if(center&&key!=='final'){[unit,multiplier]={optical:['nW',1e9],current:['nA',1e9],tia:['mV',1000],digital:['mV',1000]}[key];}
 const times=['digital','final'].includes(key)?result.time:result.analog_time,names=plot.channel?[plot.channel]:['R','IR'];
 let first=times.findIndex(t=>t>=start);if(first<0)first=times.length;
 const traces=names.map(name=>{
  const values=result.channels[name][key],visible=values.slice(first),mean=center&&visible.length?visible.reduce((a,b)=>a+b,0)/visible.length:0;
  return {name,values:visible.map(v=>(v-mean)*multiplier)};
 });
 let min=Infinity,max=-Infinity;for(const trace of traces)for(const v of trace.values){min=Math.min(min,v);max=Math.max(max,v);}
 const id=key+(plot.channel||''),scaleMode=$('scale').value;
 if(forceScale||scaleMode!=='lock'||!ranges.has(id)){
  if(scaleMode==='rails'&&['tia','digital'].includes(key)&&!center){min=0;max=3.3;}
  else if(!Number.isFinite(min)){min=-1;max=1;}
  else {const span=Math.max(max-min,multiplier===1?.001:.01);min-=span*.12;max+=span*.12;}
  ranges.set(id,[min,max]);
 }[min,max]=ranges.get(id);
 const l=58,r=w-16,top=17,bottom=h-30,gw=r-l,gh=bottom-top;if(gw<10||gh<10)return;
 ctx.font='11px Segoe UI, system-ui';ctx.lineWidth=1;
 for(let j=0;j<=4;j++){
  const y=top+gh*j/4,value=max-(max-min)*j/4;ctx.strokeStyle='#2a3b50';ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(r,y);ctx.stroke();ctx.fillStyle='#c9d6e8';ctx.textAlign='right';ctx.fillText(Math.abs(value)>=100?value.toFixed(0):Math.abs(value)>=10?value.toFixed(1):value.toFixed(2),l-7,y+4);
 }
 for(let j=0;j<=5;j++){
  const x=l+gw*j/5;ctx.strokeStyle='#2a3b50';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.fillStyle='#c9d6e8';ctx.textAlign='center';ctx.fillText((start+duration*j/5).toFixed(1),x,bottom+17);
 }
 ctx.fillStyle='#b8cbe0';ctx.textAlign='left';ctx.fillText((center?'Δ ':'')+unit,8,12);ctx.textAlign='right';ctx.fillText('t [s]',w-8,h-3);
 ctx.save();ctx.beginPath();ctx.rect(l,top,gw,gh);ctx.clip();
 for(const change of changes){if(change.time<start||change.time>end)continue;const x=l+(change.time-start)/duration*gw;ctx.strokeStyle='#efb44c';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}ctx.setLineDash([]);
 for(const {name,values} of traces){
  ctx.strokeStyle=name==='R'?'#ff657a':'#42d6d0';ctx.lineWidth=1.4;ctx.beginPath();let started=false;
  // Per-pixel extrema keep peaks visible without drawing 40,000 vertices.
  const bins=Math.max(1,Math.floor(gw)),step=Math.max(1,Math.ceil(values.length/(bins*2)));
  const point=i=>{const x=l+(times[first+i]-start)/duration*gw,y=bottom-(values[i]-min)/(max-min)*gh;if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);};
  for(let i=0;i<values.length;i+=step){let lo=i,hi=i;for(let j=i+1;j<Math.min(i+step,values.length);j++){if(values[j]<values[lo])lo=j;if(values[j]>values[hi])hi=j;}point(Math.min(lo,hi));if(lo!==hi)point(Math.max(lo,hi));}ctx.stroke();
 }ctx.restore();ctx.font='11px Segoe UI, system-ui';ctx.textAlign='right';ctx.fillStyle='#42d6d0';ctx.fillText(plot.channel||'R / IR',r,12);
}
function render(immediate=false){
 const result=simulator.result();$('clock').textContent=`t = ${fmt(simulator.time,1)} s`;
 for(const plot of plots)draw(plot,result);forceScale=false;
 if(immediate||simulator.time-lastMetrics>=.25){
  lastMetrics=simulator.time;const p=simulator.p,r=result.channels.R,ir=result.channels.IR;
  $('metrics').innerHTML=`<h2>SpO₂ real: ${fmt(p.spo2,1)} %<br>SpO₂ estimada: ${Number.isFinite(result.estimated_spo2)?fmt(result.estimated_spo2,1)+' %':'No disponible'}</h2><dl><dt>ACᵣ/DCᵣ</dt><dd>${fmt(r.normalized,4)}</dd><dt>ACᵢᵣ/DCᵢᵣ</dt><dd>${fmt(ir.normalized,4)}</dd><dt>Ratio R</dt><dd>${fmt(result.ratio,4)}</dd><dt>AC R / IR</dt><dd>${fmt(r.ac*1000,2)} / ${fmt(ir.ac*1000,2)} mV</dd><dt>DC R / IR</dt><dd>${fmt(r.dc)} / ${fmt(ir.dc)} V</dd></dl><p>LED OFF: ${p.ambient_compensation?'activat':'desactivat'}<br>ADC: ${p.adc_bits} bits · pas ${fmt(3300/(2**p.adc_bits-1),4)} mV<br>Tall RC: ${fmt(result.cutoff,1)} Hz<br><span class="tia-stability ${result.tia_stability.state}" title="Indicador docent aproximat de compensació. No calcula el marge de fase ni simula oscil·lacions.">${result.tia_stability.label}</span><br>PPG: ${p.filter_enabled?fmt(p.filter_low,2)+'–'+fmt(p.filter_high,2)+' Hz':'sense filtre'}</p>`;
  $('warning').textContent=result.warnings.length?result.warnings.join('\n'):'TIA sense saturació';$('warning').className=result.warnings.length?'warning':'';
 }
 changes=changes.filter(c=>c.time>=simulator.time-10);
 return result;
}
$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'Reprèn':'Pausa';lastFrame=performance.now();});
$('restart').addEventListener('click',()=>{simulator=new Simulator(simulator.p);changes=[];forceScale=true;lastFrame=performance.now();render(true);});
$('preset').addEventListener('change',()=>{const p={...defaults,...presets[$('preset').value]};for(const [key]of fields)$(key).value=p[key];for(const key of ['ambient_compensation','filter_enabled'])$(key).checked=p[key];syncBand();if(simulator.setParameters(p))changes.push({time:simulator.time});forceScale=$('scale').value!=='lock';updateLabels();render(true);});
$('toggle').addEventListener('click',()=>{const hidden=!$('scheme').hidden;$('scheme').hidden=hidden;$('toggle').textContent=hidden?'Mostra esquema':'Amaga esquema';$('toggle').setAttribute('aria-expanded',String(!hidden));requestAnimationFrame(()=>render(true));});
for(const key of ['window','scale','centered'])$(key).addEventListener('change',()=>{forceScale=$('scale').value!=='lock';$('window-note').textContent=`Adquisició contínua · darrers ${$('window').value} s`;render(true);});
$('fit').addEventListener('click',()=>{forceScale=true;render(true);});$('view').addEventListener('change',createPlots);
new ResizeObserver(()=>render(true)).observe($('plots'));
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();});
function frame(now){const seconds=Math.min((now-lastFrame)/1000,.1);lastFrame=now;if(!paused&&!document.hidden)simulator.advance(seconds);if(now-lastDraw>=50){lastDraw=now;render();}requestAnimationFrame(frame);}
syncBand();createPlots();render(true);requestAnimationFrame(frame);
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false;$('install-help').hidden=true;});
$('install').addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();const choice=await installPrompt.userChoice;installPrompt=null;$('install').hidden=true;if(choice.outcome!=='accepted')$('install-help').hidden=false;});
window.addEventListener('appinstalled',()=>{$('install').hidden=true;$('install-help').hidden=true;});
if('serviceWorker'in navigator && window.isSecureContext){
 const wasControlled=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled)window.location.reload();},{once:true});
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>{$('offline').textContent='Disponible sense connexió després d’aquesta càrrega.';$('install-help').hidden=window.matchMedia('(display-mode: standalone)').matches;}).catch(()=>{$('offline').textContent='No s’ha pogut preparar l’ús sense connexió. Torna a carregar amb connexió.';});
}else $('offline').textContent='L’ús sense connexió i la instal·lació requereixen HTTPS o localhost.';
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const tool={name:'read_ppg_lab',title:'Llegir el laboratori PPG',description:'Llegeix els paràmetres i les mesures actuals de la simulació docent.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||Object.keys(input).length)throw Error('No accepta paràmetres.');const result=render(true);return {time:simulator.time,parameters:simulator.p,ratio:Number.isFinite(result.ratio)?result.ratio:null,estimated_spo2:Number.isFinite(result.estimated_spo2)?result.estimated_spo2:null,warnings:result.warnings};}};
 try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
}
