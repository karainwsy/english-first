import starter from './vocab-starter.mjs';
const wordRE=/^[a-z][a-z'-]{1,39}$/;
const irregular=new Map(Object.entries({phenomena:'phenomenon',hypotheses:'hypothesis',underwent:'undergo',undergone:'undergo',withstood:'withstand',built:'build',sought:'seek',analyses:'analysis'}));
export const normal=w=>String(w).trim().toLowerCase().replace(/[’‘]/g,"'");
export function parseWordList(source){
  const entries=new Map();
  for(const line of String(source).replace(/^\uFEFF/,'').split(/\r?\n/)){
    const [raw,...rest]=line.trim().split(/[\t|]/), key=normal(raw);
    if(wordRE.test(key)&&!(key==='word'&&/^(meaning|translation|释义)$/i.test(rest[0]??'')))entries.set(key,rest.join(' ').trim().slice(0,180));
    if(entries.size>=10000)break;
  }
  return entries;
}
export const builtin=parseWordList(starter);
export function lemma(value,lex=builtin){
  const w=normal(value).replace(/'s$/,'');
  if(lex.has(w))return w;
  const keys=[];
  if(irregular.has(w))keys.push(irregular.get(w));
  if(/(ies|ied)$/.test(w))keys.push(w.slice(0,-3)+'y');
  if(w.endsWith('s'))keys.push(w.slice(0,-1));
  if(w.endsWith('es'))keys.push(w.slice(0,-2));
  for(const suffix of ['ing','ed']){
    if(!w.endsWith(suffix))continue;
    const root=w.slice(0,-suffix.length);
    keys.push(root,root+'e');
    if(/([^aeiou])\1$/.test(root))keys.push(root.slice(0,-1));
    if(suffix==='ing'&&root.endsWith('y'))keys.push(root.slice(0,-1)+'ie');
  }
  return keys.find(x=>lex.has(x))??null;
}
const entities={amp:'&',lt:'<',gt:'>',apos:"'",quot:'"',nbsp:' ',lrm:'',rlm:''};
function plain(s){return String(s??'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|apos|quot|nbsp|lrm|rlm);/gi,(_,x)=>entities[x.toLowerCase()]).replace(/\s+/g,' ').trim();}
export function extractCards(cues,lex=builtin){
  const cards=new Map(),seen=new Set();
  for(const cue of Array.from(cues??[]).slice(0,10000)){
    const original=plain(cue.text);
    if(!original||seen.has(original))continue;
    seen.add(original);
    const line=/[A-Z]/.test(original)&&!/[a-z]/.test(original)?original[0]+original.slice(1).toLowerCase():original;
    const cueWords=new Set();
    for(const m of line.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)){
      const key=lemma(m[0],lex);
      if(!key||cueWords.has(key))continue;
      cueWords.add(key);
      const existing=cards.get(key);
      if(existing){existing.hits++;continue;}
      const start=Math.max(0,Math.min(Math.max(0,line.length-210),m.index-65));
      const end=Math.min(line.length,start+210),pre=start?'…':'';
      cards.set(key,{key,gloss:lex.get(key),example:pre+line.slice(start,end)+(end<line.length?'…':''),surface:m[0],index:pre.length+m.index-start,seconds:Number(cue.startTime)||0,hits:1});
    }
  }
  return [...cards.values()].sort((a,b)=>b.hits-a.hits||a.seconds-b.seconds||a.key.localeCompare(b.key));
}
