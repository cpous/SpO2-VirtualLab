export const defaults = Object.freeze({spo2:97,heart_rate:72,perfusion:2,ambient:0,motion:0,dark_current:0,rf:100,cf:10,sample_rate:100,flicker:0,flicker_frequency:100,ambient_compensation:false,adc_bits:12,filter_enabled:true,filter_low:.5,filter_high:5});
// Mateixos valors i criteris docents que ppg_model.py. Unitats SI internes.
export const TIA_CPD=50e-12;
export const TIA_CIN=10e-12;
export const TIA_GBW=10e6;
export const TIA_CF_SAFETY_FACTOR=2;
export const TIA_CF_HIGH_FACTOR=3;
export function tiaStability(rf,cf){
 if(!Number.isFinite(rf)||!Number.isFinite(cf)||rf<=0||cf<=0)throw Error('RF i CF han de ser positius i finits.');
 const minimum=TIA_CF_SAFETY_FACTOR*Math.sqrt((TIA_CPD+TIA_CIN)/(2*Math.PI*rf*1000*TIA_GBW));
 const relative=cf*1e-9/minimum;
 const [state,label]=relative<1?['insufficient','CF insuficient — risc d’inestabilitat']:relative<=TIA_CF_HIGH_FACTOR?['adequate','CF adequat — TIA estable']:['high','CF elevat — estable però BW reduïda'];
 return {state,label,cf_min:minimum,relative_cf:relative};
}
export const presets = {'Normal':{},'RF massa gran':{rf:1500},'CF massa petit':{cf:.01},'Llum ambient alta':{ambient:40}};
export const fields = [
 ['spo2','SpO₂ real',50,100,1,'%',0],['heart_rate','Freqüència cardíaca',30,180,1,'bpm',0],['perfusion','Perfusió IR',0,10,.1,'%',0],['motion','Moviment',0,20,.5,'%',0],
 ['ambient','Llum ambient DC',0,100,1,'µW',1],['flicker','Flicker ambient',0,100,1,'%',1],['flicker_frequency','Freq. flicker',1,1000,1,'Hz',1],['dark_current','Dark current',0,2000,10,'nA',1],
 ['rf','RF (realimentació)',10,3000,10,'kΩ',2],['cf','CF (realimentació)',.01,1000,1,'nF',2],
 ['sample_rate','Mostreig',20,1000,10,'Hz',3],['adc_bits','Resolució ADC',1,24,1,'bits',3],['filter_low','Tall inferior',.01,499.98,.1,'Hz',3],['filter_high','Tall superior',.02,499.99,.1,'Hz',3]
];
export function validate(p){
 for(const [key,,min,max] of fields) if(!Number.isFinite(p[key]) || p[key]<min || p[key]>max) throw Error('Valor fora de rang: '+key);
 if(!Number.isInteger(p.adc_bits)) throw Error('La resolució ADC ha de ser un enter.');
 for(const key of ['filter_enabled','ambient_compensation']) if(typeof p[key]!=='boolean') throw Error('Opció invàlida: '+key);
 if(!(p.filter_low < p.filter_high && p.filter_high < p.sample_rate/2)) throw Error('La banda ha de complir: tall inferior < tall superior < mostreig/2.');
 return p;
}
const clip=v=>Math.max(0,Math.min(3.3,v));
const quantize=(v,bits)=>Math.round(clip(v)/3.3*(2**bits-1))/(2**bits-1)*3.3;
const keys=['optical','current','tia','clipped','digital','final','corrected'];
class Ring {
 constructor(capacity,columns){this.capacity=capacity;this.columns=columns;this.data=new Float64Array(capacity*columns);this.cursor=0;this.size=0;}
 append(row){this.data.set(row,this.cursor*this.columns);this.cursor=(this.cursor+1)%this.capacity;this.size=Math.min(this.size+1,this.capacity);}
 read(since){const rows=[];for(let i=0;i<this.size;i++){const j=((this.cursor-this.size+i+this.capacity)%this.capacity)*this.columns;if(this.data[j]>=since)rows.push(this.data.subarray(j,j+this.columns));}return rows;}
}
export class Simulator {
 constructor(p=defaults){this.p={...validate(p)};this.time=0;this.nextSample=0;this.phase=0;this.since=0;this.seed=42;this.states=[null,null];this.analog=new Ring(40004,9);this.digital=new Ring(10004,7);}
 random(){let x=this.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.seed=x>>>0;return (this.seed+.5)/4294967296;}
 noise(){return Math.sqrt(-2*Math.log(this.random()))*Math.cos(2*Math.PI*this.random());}
 setParameters(p){validate(p);if(JSON.stringify(p)===JSON.stringify(this.p))return false;if(p.sample_rate!==this.p.sample_rate)this.nextSample=this.time;this.p={...p};this.since=this.time;return true;}
 advance(seconds){
  if(seconds<=0)return;
  const p=this.p,fs=4000,n=Math.max(1,Math.round(seconds*fs)),end=this.time+n/fs;
  const a=-Math.expm1(-1/(fs*p.rf*1000*p.cf*1e-9)),hp=Math.exp(-2*Math.PI*p.filter_low/p.sample_rate),lp=-Math.expm1(-2*Math.PI*p.filter_high/p.sample_rate);
  const block=[[],[]],offBlock=[[],[]];
  for(let i=0;i<n;i++){
   const t=this.time+i/fs,phase=this.phase+2*Math.PI*p.heart_rate/60*i/fs;
   const pulse=Math.sin(phase)+.25*Math.sin(2*phase-.6),amb=p.ambient*1e-6*(1+p.flicker/100*Math.sin(2*Math.PI*p.flicker_frequency*t));
   const movement=p.motion/100*(Math.sin(2*Math.PI*1.3*t)+.4*Math.sin(2*Math.PI*.3*t));
   const row=[t];
   for(let c=0;c<2;c++){
    const sensitivity=c?.55:.45,optical=Math.max(0,(c?16e-6:12e-6)*(1+p.perfusion/100*(c?1:(110-p.spo2)/25)*pulse+(c?.7:1)*movement)+amb);
    const current=sensitivity*optical+p.dark_current*1e-9+12e-9*Math.sin(2*Math.PI*137*t)+2e-9*this.noise(),target=1.65+p.rf*1000*current;
    const offTarget=1.65+p.rf*1000*(sensitivity*amb+p.dark_current*1e-9);
    const s=this.states[c]??= {tia:target,off:offTarget,previous:clip(target),hp:0,lp:0};
    s.tia+=a*(target-s.tia);s.off+=a*(offTarget-s.off);
    const tia=clip(s.tia);block[c].push(tia);offBlock[c].push(clip(s.off));
    row.push(optical,current,tia,s.tia<0||s.tia>3.3?1:0);
   }
   this.analog.append(row);
  }
  const interpolate=(values,t)=>{const x=Math.max(0,Math.min(n-1,(t-this.time)*fs)),i=Math.floor(x);return values[i]+(values[Math.min(i+1,n-1)]-values[i])*(x-i);};
  while(this.nextSample < end-1e-10){
   const t=this.nextSample,row=[t];
   for(let c=0;c<2;c++){
    const s=this.states[c],digital=quantize(interpolate(block[c],t),p.adc_bits),off=quantize(interpolate(offBlock[c],t),p.adc_bits),corrected=p.ambient_compensation?digital-off+1.65:digital;
    s.hp=hp*(s.hp+corrected-s.previous);s.previous=corrected;s.lp+=lp*(s.hp-s.lp);
    row.push(digital,p.filter_enabled?s.lp:corrected,corrected);
   }
   this.digital.append(row);this.nextSample+=1/p.sample_rate;
  }
  this.phase=(this.phase+2*Math.PI*p.heart_rate/60*n/fs)%(2*Math.PI);this.time=end;
 }
 result(){
  const analog=this.analog.read(this.time-10),digital=this.digital.read(this.time-10),time=digital.map(r=>r[0]),analog_time=analog.map(r=>r[0]),channels={},warnings=[];
  for(let c=0;c<2;c++){
   const ch={};for(let k=0;k<4;k++)ch[keys[k]]=analog.map(r=>r[1+4*c+k]);for(let k=4;k<7;k++)ch[keys[k]]=digital.map(r=>r[1+3*c+k-4]);
   const recent=digital.filter(r=>r[0]>=this.since),a=analog.filter(r=>r[0]>=this.since),mean=recent.length?recent.reduce((s,r)=>s+r[3+3*c],0)/recent.length:1.65;
   const avg=recent.length?recent.reduce((s,r)=>s+r[2+3*c],0)/recent.length:0;
   ch.dc=mean-1.65;ch.ac=recent.length?Math.sqrt(recent.reduce((s,r)=>s+(r[2+3*c]-avg)**2,0)/recent.length):0;
   ch.normalized=ch.dc>1e-9?ch.ac/ch.dc:NaN;ch.saturation=a.length?a.reduce((s,r)=>s+r[4+4*c],0)/a.length:0;
   channels[c?'IR':'R']=ch;if(ch.saturation)warnings.push(`TIA ${c?'IR':'R'} saturat: ${(ch.saturation*100).toFixed(1)} %`);
  }
  const valid=this.time-this.since>=3 && channels.IR.normalized>1e-6 && Number.isFinite(channels.R.normalized),ratio=valid?channels.R.normalized/channels.IR.normalized:NaN;
  if(this.time-this.since<3)warnings.push('Estabilitzant estimació: 3 s des de l’inici o l’últim canvi.');else if(!valid)warnings.push('Senyal pulsàtil insuficient.');
  if(this.p.perfusion<.5)warnings.push('Perfusió baixa: estimació sensible al soroll.');
  if(Number.isFinite(ratio)&&!(110-25*ratio>=0&&110-25*ratio<=100))warnings.push('Estimació fora del rang físic.');
  return {time,analog_time,channels,warnings,ratio,estimated_spo2:110-25*ratio,cutoff:1/(2*Math.PI*this.p.rf*1000*this.p.cf*1e-9),tia_stability:tiaStability(this.p.rf,this.p.cf)};
 }
}
