import {parseWordList} from './vocab-core.mjs';
import {SCHEMA,defaultLex,SPACES,dayOf,empty,mergeLegacy,selectModelBatch,enrollment,grade,dueRows,question,matches} from './study-engine.mjs';
const l=globalThis.chrome?.storage?.local;
const oldList='efvocab:v1:custom';
const item=(tag,cl='',s='')=>{const n=document.createElement(tag);n.className=cl;n.textContent=s;return n;};
function mount(){
 const v=document.querySelector('#video')??document.querySelector('main video');
 if(!v||!l||document.querySelector('#efvocab-panel'))return;
 const player=v.closest('section')??v.closest('article')??v.parentElement;
 if(!player?.parentElement||player===document.body)return;
 const grid=item('div','efvocab-layout'), ui=item('aside','efvocab');
 ui.id='efvocab-panel';ui.setAttribute('aria-labelledby','efvocab-heading');
  if(player.parentElement?.classList.contains('session-grid')){
   player.parentElement.classList.add('efvocab-session');
   player.parentElement.append(ui);
 }else{player.before(grid);grid.append(player,ui);}
 player.classList.add('efvocab-player');
 const title=item('h2','','每日词汇');title.id='efvocab-heading';
 const stats=item('div','efvocab-stats'), nav=item('div','efvocab-nav'), root=item('div','efvocab-body');
 const message=item('p','efvocab-message');message.setAttribute('role','status');
 const head=item('div','efvocab-head');head.append(item('p','efvocab-label','LISTEN / RECALL'),title,stats);
 ui.append(head,nav,root,message);
 let state=empty(),ready=false,busy=false, tab='today', quiz=null, trackRef=null, cueCount=-1, currentDay='', cues=[], captionState='none';
 let opened=new Set(), activeWrite=Promise.resolve();
 const modeTabs={today:'今日词单',test:'今日测验',review:'到期复习',settings:'设置'};
 const lex=()=>state.custom.length?new Map(state.custom):defaultLex;
 const say=s=>message.textContent=s;
 const getDay=()=>dayOf();
 const batch=()=>state.batches[getDay()];
 const due=()=>dueRows(state);
 const word=(s,k)=>Object.hasOwn(s.words,k)?s.words[k]:null;
 function btn(name,run,cls=''){
   const b=item('button',cls,name);b.type='button';b.addEventListener('click',run);return b;
 }
 function msg(text){root.append(item('p','efvocab-empty',text));}
 function save(update){
   const run=async()=>{
     const all=await l.get(null);
     const next=all[SCHEMA]?.version===2?all[SCHEMA]:empty();
     if(!all[SCHEMA]&&Array.isArray(all[oldList]))next.custom=all[oldList];
     mergeLegacy(next,all,next.custom.length?new Map(next.custom):defaultLex);
     update(next);
     await l.set({[SCHEMA]:next});
     state=next;
   };
   const request=()=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request(SCHEMA,run):run();
   const task=activeWrite.then(request);activeWrite=task.catch(()=>{});return task;
 }
 async function action(run){
   if(busy)return;busy=true;
   try{await run();}
   catch(e){console.warn('English First vocabulary',e);say('学习记录未能保存，请重试。');}
   finally{busy=false;render();}
 }
 function readTrack(force=false){
   const track=[...v.querySelectorAll('track')].find(t=>/^(captions|subtitles)$/.test(t.kind)&&/^en(?:[-_]|$)/i.test(t.srclang||'en'));
   const list=track?.track?.cues;
   captionState=!track?'none':track.readyState===3?'error':track.readyState===2||list?.length?'ready':'loading';
   if(track!==trackRef||list?.length!==cueCount||force){
     trackRef=track;cueCount=list?.length;
     cues=Array.from(list??[]).map(c=>({text:c.text,startTime:c.startTime}));
     if(track?.readyState===2||cues.length)void generate();
   }
   if(ready&&!quiz)render();
 }
 async function generate(){
   if(!ready||!cues.length)return;
   const day=getDay();
   if(state.batches[day])return;
   const all=[...cues], nominations=[...(v.efAiWords??[])];
   const label=(document.querySelector('#lesson-label')?.textContent||'当前视频').trim().slice(0,120);
   try{
     await save(s=>{
       if(s.batches[day])return;
       const words=selectModelBatch(all,s.custom.length?new Map(s.custom):defaultLex,new Set(Object.keys(s.words)),s.limit,nominations);
       if(words.length)s.batches[day]={label,cards:words,results:{},created:Date.now()};
     });if(!quiz)render();
   }catch{say('今天的词单未能保存。');}
 }
 function setTab(id){
   if(tab===id)return;
   if(quiz&&quiz.cursor<quiz.items.length){say('测验还在进行。可先完成，或用「结束本轮」退出。');return;}
   quiz=null;tab=id;say('');render();
 }
 function cardArticle(card,b,idx){
   const d=item('details','efvocab-entry');d.open=opened.has(card.key);
   d.addEventListener('toggle',()=>{if(d.open)opened.add(card.key);else opened.delete(card.key);});
   const s=item('summary','efvocab-row');
   const label=item('strong','',card.key);label.lang='en';
   const type=card.type==='ielts'?'词表':card.gloss?'主题补充':'片中高频';
   const n=item('span','efvocab-number',String(idx+1).padStart(2,'0'));
   s.append(n,label,item('span','efvocab-chip',word(state,card.key)?.known?'已熟悉':type));
   const inner=item('div','efvocab-inner');
   const g=item('p','efvocab-meaning',card.gloss||'暂无释义。可补充释义，或用字幕做填空。');
   const ex=item('p','efvocab-example');ex.lang='en';
   ex.append(document.createTextNode(card.example.slice(0,card.index)),item('mark','',card.surface),document.createTextNode(card.example.slice(card.index+card.surface.length)));
   const t=Math.max(0,Math.floor(card.seconds));
   inner.append(g,item('p','efvocab-meta','字幕原句 · '+Math.floor(t/60)+':'+String(t%60).padStart(2,'0')+' · '+card.hits+' 处'),ex);
   const buttons=item('div','efvocab-actions');
   const day=getDay();
   for(const [text,known] of [['已学',false],['已熟悉',true]]){
     const b0=btn(text,()=>action(async()=>{
       await save(n=>{
         const old=word(n,card.key);
         n.words[card.key]=old?{...old,known:old.known||known,card:{...old.card,...card}}:enrollment(card,known);
       });
       say('已加入复习计划。');render();
     }));
     b0.disabled=!!word(state,card.key)&&(!known||word(state,card.key).known);
     buttons.append(b0);
   }
   inner.append(buttons);
   if(!card.gloss){
     const f=item('form','efvocab-form');const field=item('input');field.required=true;field.maxLength=180;field.placeholder='写一个中文释义';field.setAttribute('aria-label','中文释义');
     const enter=item('button','','保存');enter.type='submit';f.append(field,enter);
     f.addEventListener('submit',e=>{e.preventDefault();const gloss=field.value.trim();if(!gloss)return;void action(async()=>{
        await save(n=>{
          const c=n.batches[day]?.cards.find(x=>x.key===card.key);
          if(c){c.gloss=gloss;c.unverifiedGloss=false;}
          const r=word(n,card.key);if(r)r.card.gloss=gloss;
        });say('已保存释义。');
     });});
     inner.append(f);
   }
   d.append(s,inner);return d;
 }
 function begin(mode,style){
   const b=batch(), review=mode==='review';
   const cards=review?due().map(x=>x.card):b?.cards??[];
   const rounds=review||style!=='mix'?[style==='mix'?'en':style]:['zh','en'];
   const rows=[];
   for(const [ri,kind] of rounds.entries()){
     let cs=ri?[...cards].reverse():cards;
     for(const card of cs){
       if(!card.gloss&&ri>0)continue;
       const type=review&&style==='mix'&&card.gloss?((word(state,card.key)?.stage??0)%2?'zh':'en'):kind;
       const q=question(card,type);if(q)rows.push({card,q});
     }
   }
   if(!rows.length){say('没有可测的词。有中文释义或字幕例句的词才能出题。');return;}
   quiz={day:getDay(),mode,style,items:rows,cursor:0,checked:null,answers:[],graded:{},remaining:{}};
   for(const {card} of rows)quiz.remaining[card.key]=(quiz.remaining[card.key]??0)+1;
   say('');render();focusInput();
 }
 function focusInput(){root.querySelector('.efvocab-answer')?.focus();}
 function showQuiz(){
   const z=quiz;
   if(z.cursor>=z.items.length){
     const rows=Object.values(z.graded), hits=rows.filter(x=>x).length;
     const panel=item('div','efvocab-hero');
     panel.append(item('p','efvocab-label','本轮完成'),item('h3','',hits+' / '+rows.length+' 个词答对'),item('p','',z.mode==='review'?'答错的词约 10 分钟后再出现。':(z.style==='mix'?'两种方向都答对才算本轮答对。':'已记录本轮测试。')+' 答错的词约 10 分钟后进入到期复习。'));
     root.append(panel,btn('返回今日词单',()=>{quiz=null;setTab('today');render();}));return;
   }
   const {card,q}=z.items[z.cursor], seen=z.checked;
   const kind={en:'看中文 · 拼英文',zh:'看英文 · 写中文',cloze:'字幕填空'};
   const h=item('div','efvocab-hero');h.append(item('p','efvocab-label',kind[q.style]+'  /  '+(z.cursor+1)+' / '+z.items.length),item('h3','',q.prompt));root.append(h);
   if(!seen){
     const f=item('form','efvocab-form'), input=item('input','efvocab-answer');
     input.type='text';input.maxLength=180;input.required=true;input.autocomplete='off';input.spellcheck=false;input.setAttribute('autocapitalize','off');input.setAttribute('aria-label','作答');
     input.placeholder=q.style==='zh'?'输入中文意思':'输入英文拼写';
     const confirm=item('button','efvocab-primary','检查');confirm.type='submit';
     f.append(input,confirm);
     const check=(answer,skip=false)=>{z.checked={answer,pass:!skip&&matches(q,answer),skip};render();};
     f.addEventListener('submit',ev=>{ev.preventDefault();if(input.value.trim())check(input.value);});
     root.append(f,btn('不会，查看答案',()=>check('',true)));
   }else{
     const feedback=item('div','efvocab-feedback');
     feedback.append(item('strong','',seen.pass?'答对了':seen.skip?'参考答案':'与参考答案不一致'),item('p','',q.answer));
     if(seen.answer&&!seen.pass)feedback.append(item('p','efvocab-meta','你的答案：'+seen.answer));
     root.append(feedback);
     const next=passed=>action(async()=>{
       if(z.checked!==seen)return;
       const previous=z.graded[card.key];
       const passedWord=(previous??true)&&passed;
       if(z.remaining[card.key]===1){
          await save(s=>{
            const prev=word(s,card.key);
            if(z.mode==='review'&&prev&&prev.due>Date.now())return;
            s.words[card.key]=grade(prev,card,passedWord,Date.now(),z.mode);
            if(z.mode==='test'&&s.batches[z.day]){
              const main=s.batches[z.day].results;
              main[card.key]={first:main[card.key]?.first??passedWord,latest:passedWord,at:Date.now()};
            }
          });
       }
       z.graded[card.key]=passedWord;z.remaining[card.key]--;z.checked=null;z.cursor++;
     }).then(focusInput);
     root.append(btn(z.cursor+1===z.items.length?'完成本轮':'下一题',()=>next(seen.pass),'efvocab-primary'));
     if(q.style==='zh'&&!seen.pass&&seen.answer)
        root.append(btn('意思一样，算对',()=>next(true)));
   }
   root.append(btn('结束本轮',()=>{quiz=null;say('已完成词条的结果已保留。');render();},'efvocab-quiet'));
 }
 function options(mode){
   const b=batch();
   const list=mode==='test'?b?.cards??[]:due();
   root.append(item('p','efvocab-sub',mode==='test'?'先过词单，再用两种方向测试。':'包含你之前学习或标为熟悉的词。错了约 10 分钟后再试。'));
   if(!list.length){msg(mode==='test'?'今天还没有可以测验的词。':'当前没有到期词。');return;}
   if(mode==='review')for(const {card} of list.filter(x=>!x.card.gloss&&!x.card.example)){
     const f=item('form','efvocab-form');
     const field=item('input');field.required=true;field.maxLength=180;
     field.placeholder=card.key+' 的释义';field.setAttribute('aria-label',card.key+' 的中文释义');
     const enter=item('button','','补充释义');enter.type='submit';f.append(field,enter);root.append(f);
     f.addEventListener('submit',e=>{e.preventDefault();const gloss=field.value.trim();if(gloss)void action(async()=>{
       await save(s=>{if(Object.hasOwn(s.words,card.key))s.words[card.key].card.gloss=gloss;});say('这张旧词卡已可以复习。');
     });});
   }
   const group=item('div','efvocab-buttons');
   for(const [s,style] of [['混合测验','mix'],['看英文写中文','zh'],['看中文拼英文','en'],['原句填空','cloze']])
     group.append(btn(s,()=>begin(mode,style),style==='mix'?'efvocab-primary':''));
   root.append(group);
 }
 function settings(){
    root.append(item('p','efvocab-sub','按记忆逐渐拉长间隔：1、2、4、7、15、30 天。早期密、后期疏；不是固定遗忘公式。'));
    const label=item('label','efvocab-setting','每日新词上限（次日生效）');
    const size=item('select');for(const n of [6,8,10,12,15,20,30]){const o=item('option','',String(n));o.value=String(n);size.append(o);}size.value=String(state.limit);
    size.addEventListener('change',()=>action(async()=>{const n=+size.value;await save(s=>s.limit=n);say('已保存。');}));label.append(size);root.append(label);
    const label2=item('label','efvocab-setting',state.custom.length?'自定义词表 · '+state.custom.length:'Word Atlas 雅思 B1–C2 · '+defaultLex.size);
    const upload=item('input');upload.type='file';upload.accept='.txt,.tsv';label2.append(upload);
    upload.addEventListener('change',()=>action(async()=>{
       const file=upload.files?.[0];if(!file)return;if(file.size>1048576){say('词表需小于 1 MB。');return;}
       const list=[...parseWordList(await file.text())];if(!list.length){say('未识别到英文词条。');return;}
       await save(s=>s.custom=list);say('已换词表。今日已生成的词单和复习记录保留。');void generate();
    }));
    root.append(label2,item('p','efvocab-meta','UTF-8 TXT / TSV，每行英文，或英文 + Tab + 中文。默认词表并非官方雅思词表。'),
      btn('恢复默认词表',()=>action(async()=>{await save(s=>s.custom=[]);say('已恢复默认词表。');void generate();})));
 }
 function render(){
   if(!ready)return;
   const b=batch(), words=b?.cards??[], results=b?.results??{};
   const completed=Object.keys(results).length, pass=Object.values(results).filter(x=>x.first).length;
   stats.replaceChildren(item('span','','新词 '+words.length+' / '+state.limit),item('span','','待复习 '+due().length));
   nav.replaceChildren(...Object.entries(modeTabs).map(([id,name])=>{const b=btn(name,()=>setTab(id));b.setAttribute('aria-pressed',String(tab===id));return b;}));
   root.replaceChildren();
   if(quiz){showQuiz();return;}
   if(tab==='settings'){settings();return;}
   if(tab==='test'||tab==='review'){options(tab);return;}
   if(!b){msg({none:'没检测到英文字幕。请在播放器设置里导入 SRT 或 VTT。',loading:'正在读取完整英文字幕…',ready:'词单还没生成，或本片没有足够的匹配词。',error:'这条英文字幕没能加载。'}[captionState]);return;}
   const summary=item('div','efvocab-overview');
   summary.append(item('p','efvocab-label','全片字幕 · '+b.label),item('p','efvocab-sub','词表 '+words.filter(c=>c.type==='ielts').length+' 词 · 片中补充 '+words.filter(c=>c.type==='topic').length+' 词'),
     item('p','efvocab-meta','已测 '+completed+' / '+words.length+(completed?' · 首次答对 '+pass+' 词':'')));
   const box=item('div','efvocab-list');words.forEach((c,i)=>box.append(cardArticle(c,b,i)));
   root.append(summary,btn(completed?'继续／重做测验':'开始今日测验',()=>setTab('test'),'efvocab-primary'),box);
 }
 new MutationObserver(()=>readTrack()).observe(v,{subtree:true,childList:true,attributes:true,attributeFilter:['src','srclang','kind']});
 for(const kind of ['load','loadedmetadata','error'])v.addEventListener(kind,()=>readTrack(true),true);
 v.textTracks?.addEventListener('change',()=>readTrack(true));
 chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area==='local'&&changes[SCHEMA]?.newValue?.version===2){
      state=changes[SCHEMA].newValue;if(ready&&!quiz&&!busy)render();
    }
 });
 save(()=>{}).then(()=>{ready=true;currentDay=getDay();readTrack(true);render();}).catch(()=>{say('未能读取词汇记录。');});
 setInterval(()=>{if(!ready)return;const day=getDay();if(day!==currentDay){
   currentDay=day;void generate();if(!quiz)render();
 }else if(!quiz&&!busy&&tab==='review')render();},60000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
