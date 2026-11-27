import {builtin,parseWordList,extractCards,normal,lemma} from './vocab-core.mjs';
export const SCHEMA='efvocab:v2:study';
export const LEGACY='efvocab:v1:word:';
export const SPACES=[1,2,4,7,15,30];
export const DEFAULT_COUNT=12;
const TOPICAL=parseWordList([
 'astronaut|宇航员','telescope|望远镜','orbital|轨道的','spacecraft|航天器','microgravity|微重力',
 'cosmology|宇宙学','supernova|超新星','exoplanet|系外行星','spectrometer|光谱仪','spectroscopy|光谱分析',
 'biodiversity|生物多样性','photosynthesis|光合作用','wetland|湿地','watershed|流域','permafrost|永久冻土',
 'seafloor|海底','oceanographer|海洋学家','plankton|浮游生物','microplastic|微塑料','salinity|盐度',
 'greenhouse|温室','drought|干旱','wildfire|野火','hurricane|飓风','barometer|气压计','meteorologist|气象学家',
 'seismometer|地震仪','earthquake|地震','evaporation|蒸发','sediment|沉积物','aquifer|含水层','pollinator|传粉动物',
 'thermometer|温度计','turbine|涡轮机','hydropower|水力发电','photosensor|光学传感器',
 'machine-learning|机器学习','cybersecurity|网络安全','encryption|加密','decryption|解密',
 'adversarial|对抗性的','overfitting|过拟合','backpropagation|反向传播','multimodal|多模态的','microprocessor|微处理器',
 'fermentation|发酵','caramelization|焦糖化','emulsification|乳化','pasteurization|巴氏杀菌','seasoning|调味料；调味',
 'arpeggio|琶音','semitone|半音','polyphony|复调','timbre|音色','counterpoint|对位','crescendo|渐强',
 'immunology|免疫学','neuroscience|神经科学','biomarker|生物标志物','epidemiology|流行病学','CRISPR|CRISPR 基因编辑系统',
 'semiconductor|半导体','geothermal|地热的','desalination|海水淡化','electrolysis|电解','telemetry|遥测',
].join('\n'));
const STOP=new Set('something anything everything nothing everybody somebody anybody everyone someone another sometimes however although because already always usually really actually probably literally basically obviously together anyway whatever whenever wherever between different important interesting understanding including looking watching following starting talking coming getting going believe speaking English ourselves themselves yourself yourselves should would could couldnot without throughout meanwhile welcome subtitle subtitles translated translation copyright timestamps transcription professor university internet television australia california america american european japanese chinese today tonight tomorrow president united kingdom'.toLowerCase().split(' '));
function fullCandidates(cues,lex,exclude){
  const extras=new Map([...TOPICAL].filter(([k])=>!lex.has(k)));
  const titles=new Map(), named=new Set(), glossary=new Map([...extras,...lex]);
  for(const cue of Array.from(cues??[]).slice(0,10000)){
    const lines=String(cue.text??'').replace(/<[^>]*>/g,' ').trim();
    const caps=!/[a-z]/.test(lines);
    for(const m of lines.matchAll(/[A-Za-z][A-Za-z-]{6,30}/g)){
      const t=normal(m[0]);if(lemma(t,glossary)||STOP.has(t)||t.endsWith('-'))continue;
      if(!caps&&/^[A-Z]/.test(m[0])&&m.index>0&&!/[.!?]\s*$/.test(lines.slice(0,m.index))){
        named.add(t);continue;
      }
      titles.set(t,titles.get(t)??'');
    }
  }
  for(const k of named)titles.delete(k);
  const all=new Map([...titles,...glossary]);
  const last=Math.max(1,...Array.from(cues??[]).slice(0,10000).map(c=>+c.startTime||0));
  const rows=extractCards(cues,all).filter(c=>!exclude.has(c.key));
  return rows.map(c=>({...c,type:lex.has(c.key)?'ielts':'topic',unverifiedGloss:!c.gloss}))
    .filter(c=>c.type==='ielts'||extras.has(c.key)||c.hits>=3)
    .map(c=>({...c,score:Math.log2(1+c.hits)*4+Math.min(c.key.length,12)*.14+(c.gloss?1.7:0)+Math.min(1,c.seconds/last)*.2}))
    .sort((a,b)=>b.score-a.score||a.seconds-b.seconds||a.key.localeCompare(b.key));
}
export function selectBatch(cues,lex,excluded=new Set(),count=DEFAULT_COUNT){
  const n=Math.max(4,Math.min(30,Math.trunc(+count)||DEFAULT_COUNT));
  const all=fullCandidates(cues,lex,excluded);
  const extras=all.filter(c=>c.type==='topic'), ielts=all.filter(c=>c.type==='ielts');
  const special=extras.slice(0,Math.min(3,Math.max(1,Math.floor(n/4))));
  return [...ielts.slice(0,n-special.length),...special].sort((a,b)=>a.seconds-b.seconds||a.key.localeCompare(b.key));
}
export function dayOf(ts=Date.now()){
  const d=new Date(ts);return [d.getFullYear(),d.getMonth()+1,d.getDate()].map(x=>String(x).padStart(2,'0')).join('-');
}
export function calendarDue(ts,days){
  const d=new Date(ts);d.setDate(d.getDate()+days);d.setHours(0,0,0,0);return d.getTime();
}
export const empty=()=>({version:2,words:{},batches:{},custom:[],limit:DEFAULT_COUNT});
export function mergeLegacy(state,all,lex,now=Date.now()){
  let count=0;
  for(const [id,prev] of Object.entries(all)){
    if(!id.startsWith(LEGACY)||!prev)continue;
    const key=id.slice(LEGACY.length);
    if(!/^[a-z][a-z'-]{1,39}$/.test(key)||Object.hasOwn(state.words,key))continue;
    const card=prev.card?.key===key?prev.card:{key,gloss:lex.get(key)||TOPICAL.get(key)||'',example:'',surface:key,index:0,seconds:0,hits:0,type:'ielts'};
    state.words[key]={card,stage:0,known:prev.state==='known',due:Number.isFinite(prev.due)?prev.due:calendarDue(now,1),last:0,lapses:0};
    count++;
  }
  return count;
}
export function enrollment(card,known,now=Date.now()){
  return {card,stage:0,known,due:calendarDue(now,1),last:0,lapses:0};
}
export function grade(old,card,passed,now=Date.now(),mode='review'){
  if(old&&mode!=='review')return {...old,card:{...old.card,...card},last:now,
    due:passed?old.due:now+600000,stage:passed?old.stage:0,relearning:passed?!!old.relearning:true,lapses:(old.lapses||0)+(passed?0:1)};
  const stage=passed?(old&&!old.relearning?Math.min(SPACES.length-1,old.stage+1):0):0;
  return {card,stage,known:!!old?.known,relearning:!passed,last:now,lapses:(old?.lapses||0)+(passed?0:1),
    due:passed?calendarDue(now,SPACES[stage]):now+600000};
}
export function dueRows(state,now=Date.now()){
  return Object.values(state.words).filter(x=>x.due<=now).sort((a,b)=>a.due-b.due||a.card.key.localeCompare(b.card.key));
}
export function blank(card){
  const rx=/[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  const forms=new Set([normal(card.key),normal(card.surface)]);
  return (card.example||'').replace(rx,s=>forms.has(normal(s))?'＿＿＿':s);
}
function meanings(gloss){return String(gloss??'').split(/[；;、，,\/]/).map(x=>x.trim()).filter(Boolean);}
const normalized=s=>String(s??'').normalize('NFKC').toLowerCase().trim().replace(/[\s、，。；：！？「」『』《》,.!?;:]+/g,'');
export function matches(q,submission){
  const entered=normalized(submission);
  return !!entered&&q.accepted.some(s=>normalized(s)===entered);
}
export function question(card,style){
  if(!card.gloss){
    if(!card.example)return null;
    return {style:'cloze',prompt:blank(card),accepted:[card.surface],answer:card.surface};
  }
  if(style==='zh')return {style:'zh',prompt:card.key,accepted:[card.gloss,...meanings(card.gloss)],answer:card.gloss};
  if(style==='cloze'&&card.example)return {style:'cloze',prompt:blank(card),accepted:[card.surface],answer:card.surface};
  return {style:'en',prompt:card.gloss,accepted:[card.key],answer:card.key};
}
export const defaultLex=builtin;
