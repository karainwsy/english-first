import {dailyLesson,verifiedDailyAssets} from "./daily-media.mjs";
import {goal, speed, normalizeHost, patterns, activeMs, toVtt, builtins, panelState, webOrigins, hasMedia} from "./core.mjs";
import {beijingDay,loadRecommendation} from "./daily.mjs";
import {localGet,localSet} from "./local.mjs";
const by = id => document.getElementById(id);
const video = by("video");
let state, needsReload=false, version, url, trackUrl, track, target, last, unsent = 0;
let sending = false, session = 0, ended = false;
const startupPage=location.search==="?startup=1" && !location.hash;
let importBusy=false, captionEnabled=true, renderedHosts="", renderedPool, loadGeneration=0;
let canUseVideo=false, loadingPosition=false, recommendationDay, recommendationGeneration=0, mediaTimeout;

async function send(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({action, ...payload});
  if (!result || result.error) throw new Error(result?.error || "浏览器未响应，请重试。");
  adopt(result.state);
  return state;
}

function adopt(raw) {
  const previousDay=state?.day;
  ({state,needsReload}=panelState(raw,raw?.day));
  if(previousDay && previousDay!==state.day){
    resetSample();
    unsent=0;
  }
}
function status(s) { by("status").textContent=s; }
function urlTarget() {
  try {
    const v = new URL(location.hash.slice(1));
    return ["http:","https:"].includes(v.protocol) &&
      !v.username && !v.password && (state.strict || state.hosts.includes(v.hostname)) ? v : null;
  } catch { return null; }
}
function render() {
  target = urlTarget();
  by("reload-extension").hidden=!needsReload;
  by("startup").disabled=needsReload||state.strict;
  by("file").disabled=by("pause").disabled=needsReload;
  by("pause").hidden=state.strict;
  by("strict").hidden=state.strict;
  by("strict").disabled=needsReload || !hasMedia(state) || !canUseVideo;
  by("strict-state").textContent=state.strict
    ? (hasMedia(state) ? "全站权限已授权。当天听满十分钟后，所有普通网页会解锁。"
       : "已授予全站权限。当前没有可播放的视频，暂不拦截。")
    : "未开启。当前只按下面配置的网站拦截。";
  if(needsReload) status("更新文件已到位，但浏览器还在用旧版后台。点「重新加载扩展」后再打开此页，原设置和进度会保留。");
  by("startup").checked=state.startup;
  by("speed").value=String(state.playbackRate);
  const canContinue = target && (state.elapsed >= goal || state.paused || !hasMedia(state));
  by("destination").textContent = target ? "目标网站：" + target.hostname : startupPage ? (state.elapsed >= goal ? "今天已解锁。你可以继续看，想离开时再关这个标签页。" : "今天先听十分钟。听满后网页解锁，播放器会保留。") : "先听一点英语，再去放松。";
  by("continue").hidden = !canContinue;
  const left = Math.ceil(Math.max(0, goal-state.elapsed-unsent)/1000);
  by("counter").textContent = String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
  by("progress").value = Math.min(goal,state.elapsed+unsent);
  by("pause").textContent = state.paused ? "恢复拦截" : "暂停拦截";
  by("add").disabled=needsReload||!hasMedia(state);
  by("restore").hidden=needsReload || state.builtinAvailable.every(id=>state.pool.some(c=>c.id===id));
  if (state.elapsed >= goal) by("mode").textContent = "今日已解锁";
  else if (ended) by("mode").textContent = "已播完，可继续播放以补足剩余时间";
  else if (!video.paused && document.hasFocus() && !document.hidden) by("mode").textContent = "正在播放";
  else by("mode").textContent = state.paused ? "拦截已暂停" : "";
}

function renderHosts() {
  const signature = String(needsReload)+":"+state.hosts.join(",");
  if(renderedHosts === signature) return;
  renderedHosts = signature;
  by("hosts").replaceChildren(...state.hosts.map(host => {
    const li = document.createElement("li"), label = document.createElement("span"), b = document.createElement("button");
    label.textContent = host; b.type="button"; b.className="secondary quiet"; b.textContent="移除"; b.disabled=needsReload;
    b.addEventListener("click", async () => {
      try {
        await send("remove-host",{host});
        await chrome.permissions.remove({origins:patterns(host)});
        render(); renderHosts(); status("已移除：" + host);
      } catch(e) { status(e.message); }
    });
    li.append(label,b); return li;
  }));
}

function resetSample() { session++; last = undefined; }
function attachCaptions(text) {
  if (track) track.remove();
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  by("caption-toggle").hidden = !text;
  if (!text) return;
  trackUrl = URL.createObjectURL(new Blob([text], {type:"text/vtt"}));
  track = document.createElement("track");
  track.kind="subtitles"; track.label="English"; track.srclang="en"; track.src=trackUrl;
  video.append(track);
  applyCaptionMode();
}
function applyCaptionMode() {
  if (track) track.track.mode = captionEnabled ? "showing" : "hidden";
  by("caption-toggle").textContent = "字幕：" + (captionEnabled ? "开" : "关");
}
function setSource(source, label) {
  clearTimeout(mediaTimeout);
  video.pause();
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  url = source instanceof Blob ? URL.createObjectURL(source) : source;
  resetSample(); ended=false; canUseVideo=false;
  video.hidden = !url;
  by("empty").hidden = Boolean(url);
  by("play").hidden=by("volume").hidden=by("fullscreen").hidden=by("speed-choice").hidden=!url;
  by("lesson-label").textContent = label || "导入一段本地英语视频即可开始。";
  if (url) {
    loadingPosition=true;
    video.defaultPlaybackRate=video.playbackRate=state.playbackRate;
    video.src=url;
    const expected=version;
    mediaTimeout=setTimeout(()=>{
      if(version===expected && !canUseVideo) void markMediaUnavailable();
    },15000);
  } else {
    video.removeAttribute("src");
    video.load();
  }
}
function inspectFile(file) {
  return new Promise((resolve,reject) => {
    const probe = document.createElement("video");
    const local = URL.createObjectURL(file);
    const timer = setTimeout(() => finish("读取视频超时，请试试 H.264 MP4。"),15000);
    const finish = (error = "") => {
      clearTimeout(timer);
      const duration = probe.duration;
      probe.onloadedmetadata = probe.onerror = null;
      probe.removeAttribute("src"); probe.load();
      URL.revokeObjectURL(local);
      error ? reject(new Error(error)) : resolve(duration);
    };
    probe.preload="metadata";
    probe.onloadedmetadata = () => finish(!Number.isFinite(probe.duration) || probe.videoWidth < 1 ?
      "这不是浏览器能播放的视频，请试试 H.264 MP4。" : probe.duration < goal / 1000 * speed ?
      "视频太短：0.85× 播满 10 分钟需要原片至少 8:30。" : "");
    probe.onerror = () => finish("浏览器无法读取该视频，请试试 H.264 MP4。");
    probe.src=local;
  });
}
async function showRecommendation(force=false){
  if(state?.daily){by("recommendation").hidden=true;return;}
  const today=beijingDay();
  if(!force && recommendationDay===today) return;
  recommendationDay=today;
  const serial=++recommendationGeneration;
  if(!force) by("recommendation").hidden=true;
  const item=await loadRecommendation(chrome.runtime.getURL("daily-recommendation.json"),today);
  if(serial!==recommendationGeneration || state?.daily)return;
  by("recommendation").hidden=!item;
  if(!item)return;
  by("recommendation-title").textContent=item.fallback?"最近一次推荐":"今日推荐";
  by("recommendation-link").href=item.url;
  by("recommendation-link").textContent=item.title;
  by("recommendation-note").textContent=item.note;
}
function sample() {
  if (!state || needsReload) return;

  const current = {
    wall:performance.now(),position:video.currentTime,rate:video.playbackRate,session,
    valid:canUseVideo && Boolean(version) && version===state.lesson && !video.paused && !video.ended &&
      !video.seeking && !video.muted && video.volume > 0 && video.readyState>=2 && !document.hidden && document.hasFocus(),
  };
  if(state.elapsed<goal) unsent += activeMs(last,current);
  if(state.elapsed>=goal && current.valid && current.wall-lastPositionSave>=1200) void markPosition();
  if(ended && unsent>0) void flush();
  last=current;
  if (!sending && unsent >= 800) void flush();
}
async function flush() {
  if(sending || unsent<=0 || !state || !version) return;
  sending=true;
  const amount = Math.min(unsent,1500), currentDay=state.day;
  unsent -= amount;
  try {
    lastPositionSave=performance.now();
    await send("progress",{ms:amount,day:currentDay,version,position:video.currentTime});
    render();
  }
  catch(e) { status(e.message); }
  finally { sending=false; }
}
let lastPositionSave=0;
async function markPosition(){
  if(!state || needsReload || !version || !canUseVideo || loadingPosition || document.hidden || !document.hasFocus() || video.seeking)return;
  lastPositionSave=performance.now();
  try { await send("position",{position:video.currentTime,day:state.day,version}); }
  catch(e) { status(e.message); }
}
for (const e of ["pause","waiting","stalled","seeking","seeked","ended","emptied","ratechange","volumechange"]) {
  video.addEventListener(e,()=>{
    resetSample();
    if(e==="ratechange") by("speed").value=String(video.playbackRate);
    if(e==="ended") ended=true;
    if(e==="pause"||e==="ended"){
      if(unsent>0) void flush();
      else void markPosition();
    }
    if(e==="seeked") void markPosition();
    by("play").textContent=video.paused?"播放":"暂停";
    by("volume").textContent=video.muted?"取消静音":"静音";
    if (state) render();
  });
}
video.addEventListener("loadedmetadata",()=>{
  clearTimeout(mediaTimeout);
  if(!url || !state || !version || state.lesson!==version) return;
  canUseVideo=Number.isFinite(video.duration) && video.duration*1000 / speed >= goal && video.videoWidth>0;
  if(!canUseVideo){void markMediaUnavailable();return;}
  video.playbackRate=state.playbackRate;
  const position=state.positions?.[version];
  if(Number.isFinite(position) && position>0) video.currentTime=Math.min(position,Math.max(0,video.duration-0.15));
  loadingPosition=false;
  applyCaptionMode();
  render();
  if(!needsReload && state.mediaErrorLesson===version) void send("media-ready",{version}).then(render).catch(()=>{});
});
video.addEventListener("play",()=>{ended=false;by("play").textContent="暂停";resetSample();if(state)render();});
async function markMediaUnavailable(){
  canUseVideo=false;
  clearTimeout(mediaTimeout);
  if(!state || needsReload || !version || version!==state.lesson)return;
  try{
    const wasDaily=Boolean(state.daily);
    await send("media-unavailable",{version});
    sync();
    if(wasDaily){void showRecommendation(true);status("今日推荐视频未能播放，已换用本地备用；今天的计时保留。");}
    else status("当前视频无法播放，今天暂时不拦网页。更换可播放的视频即可恢复。");
  }catch(e){status(e.message);}
}
video.addEventListener("error",()=>{if(url)void markMediaUnavailable();});
for (const e of ["visibilitychange","focus","blur"]) {
  (e==="visibilitychange"?document:window).addEventListener(e,()=>{resetSample(); if(state)render();});
}
by("play").addEventListener("click",()=>video.paused ? video.play().catch(e=>status(e.message)) : video.pause());
by("caption-toggle").addEventListener("click",()=>{captionEnabled=!captionEnabled;applyCaptionMode();});
by("volume").addEventListener("click",()=>{video.muted=!video.muted;by("volume").textContent=video.muted?"取消静音":"静音";});
by("fullscreen").addEventListener("click",async()=>{
  try{
    if(document.fullscreenElement) await document.exitFullscreen();
    else await video.requestFullscreen();
  }catch(e){status(e.message || "无法进入全屏。");}
});
document.addEventListener("fullscreenchange",()=>by("fullscreen").textContent=document.fullscreenElement?"退出全屏":"全屏");
by("speed").addEventListener("change",async e=>{
  const rate=Number(e.currentTarget.value);
  video.defaultPlaybackRate=video.playbackRate=rate;
  try{await send("set-rate",{rate});render();}
  catch(err){status(err.message);}
});
by("continue").addEventListener("click",()=>{if(target && (state.paused||!hasMedia(state)||state.elapsed>=goal))location.replace(target.href);});

const mediaKey=id=>"video:"+id;
const capKey=id=>"captions:"+id;
let oldMedia, oldCap, initialized=false;
async function loadClip(id = state?.lesson, force = false) {
  if(id===version && !force) return;
  const generation=++loadGeneration;
  version=id; unsent=0; resetSample();
  loadingPosition=true;canUseVideo=false;
  video.pause();video.removeAttribute("src");video.load();
  if(!id){attachCaptions();setSource(null);loadingPosition=false;by("credits").hidden=true;return;}
  const builtin=builtins.find(b=>b.id===id);
  const daily=state.daily && id===dailyLesson(state.daily) ? state.daily : null;
  try {
    if(daily){
      const movie=await verifiedDailyAssets(daily,path=>chrome.runtime.getURL(path));
      if(generation!==loadGeneration || state.lesson!==id)return;
      setSource(movie.media,"今日推荐 · "+daily.title);
      attachCaptions(movie.captions);
      by("credits").hidden=!daily.attribution;
      by("credits").textContent=daily.attribution;
      by("recommendation").hidden=true;
      return;
    }
    const media=builtin ? null : await localGet(mediaKey(id)) || (oldMedia?.version===id ? oldMedia.file : null);
    const cap=await localGet(capKey(id)) || (oldCap?.version===id ? oldCap.text : null);
    let text=cap || "";
    if(!text && builtin?.captions) {
      const res=await fetch(chrome.runtime.getURL(builtin.captions));
      if(res.ok) text=await res.text();
    }
    if(generation!==loadGeneration || state.lesson!==id)return;
    const source=builtin ? chrome.runtime.getURL(builtin.file) : media;
    setSource(source, builtin?.name || media?.name);
    attachCaptions(text);
    by("credits").hidden=!builtin?.credit;
    by("credits").textContent=builtin?.credit || "";
    if(!source) void markMediaUnavailable();
  } catch(e) {
    if(generation===loadGeneration){attachCaptions();setSource(null);void markMediaUnavailable();}
  }
}
function renderPool() {
  const signature=JSON.stringify([needsReload,state.lesson,state.pool]);
  if(renderedPool===signature)return;
  renderedPool=signature;
  const choose=by("cap-target"), selected=choose.value, list=by("playlist");
  choose.replaceChildren(...state.pool.map(({id,name})=>{
    const el=document.createElement("option");el.value=id;el.textContent=name;return el;
  }));
  choose.value=state.pool.some(c=>c.id===selected)?selected:(state.lesson||"");
  choose.disabled=by("captions").disabled=needsReload||!state.pool.length;
  list.replaceChildren(...state.pool.map(({id,name})=>{
    const li=document.createElement("li"), label=document.createElement("span"), button=document.createElement("button");
    label.textContent=(id===state.lesson?"今天 · ":"")+name;
    button.type="button";button.className="secondary quiet";button.textContent="移除";button.disabled=needsReload;
    button.addEventListener("click",async()=>{
      try {
        await send("remove-clip",{id});
        await localSet(mediaKey(id),null);await localSet(capKey(id),null);
        if(oldMedia?.version===id){await localSet("lesson",null);oldMedia=null;}
        if(oldCap?.version===id){await localSet("captions",null);oldCap=null;}
        sync();status("已移除视频。");
      }catch(e){status(e.message);}
    });
    li.append(label,button);return li;
  }));
}
function sync(){render();renderHosts();renderPool();void loadClip();if(state.daily)by("recommendation").hidden=true;}

by("file").addEventListener("change",async e=>{
  const file=e.currentTarget.files[0];
  e.currentTarget.value="";
  if(!file||importBusy)return;
  importBusy=true;
  const id=crypto.randomUUID();
  try{
    status("正在检查视频…");
    const duration=await inspectFile(file);
    await localSet(mediaKey(id),file);
    try{await send("add-clip",{id,name:file.name,duration});}
    catch(e){await localSet(mediaKey(id),null);throw e;}
    sync();by("cap-target").value=id;
    status(id===state.lesson?"视频已添加，并设为今天的素材。":"视频已加入轮换列表，今天仍使用当前视频。");
  }catch(e){status(e.message);}
  finally{importBusy=false;}
});
by("captions").addEventListener("change",async e=>{
  const f=e.currentTarget.files[0], id=by("cap-target").value;e.currentTarget.value="";
  if(!f||!id)return;
  try{
    const text=toVtt(await f.text());
    if(!state.pool.some(c=>c.id===id))return;
    await localSet(capKey(id),text);
    if(state.lesson===id && version===id) attachCaptions(text);
    status("英文字幕已保存。");
  }catch(e){status(e.message);}
});
by("restore").addEventListener("click",async()=>{
  try{
    for(const clip of builtins.filter(c=>state.builtinAvailable.includes(c.id)))
      if(!state.pool.some(c=>c.id===clip.id)) await send("add-clip",{id:clip.id});
    sync();status("已补回示例视频。");
  }catch(e){status(e.message);}
});
by("reload-extension").addEventListener("click",()=>chrome.runtime.reload());
by("startup").addEventListener("change",async e=>{
  try{await send("startup-setting",{enabled:e.currentTarget.checked});render();status(state.startup?"已开启启动听力页。":"启动听力页已关闭。");}
  catch(e){render();status(e.message);}
});
by("host-form").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    const host=normalizeHost(by("host").value);
    if(!state?.lesson)throw new Error("请先导入一段可播放的视频。");
    if(!await chrome.permissions.request({origins:patterns(host)})) throw new Error("未授权，没有添加。");
    await send("add-host",{host}); by("host").value=""; render(); renderHosts(); status("已添加："+host+"。重新打开该网站即可试用。");
  }catch(e){status(e.message);}
});
by("strict").addEventListener("click",async()=>{
  if(needsReload || !hasMedia(state) || !canUseVideo)return;
  try{
    // This must originate from this voluntary click for Edge's all-sites prompt.
    if(!await chrome.permissions.request({origins:webOrigins})) {
      status("未授予全站权限；没有更改现有拦截设置。");return;
    }
    await send("enable-strict");sync();
    if(state.elapsed>=goal) status("全站强制模式已开启。今天已经完成，明天才会开始拦截。");
    else status("全站强制模式已开启。当天听力进度保留。");
  }catch(e){status(e.message);}
});
by("pause").addEventListener("click",async()=>{
  try{await send("pause",{paused:!state.paused});render();status(state.paused?"拦截已暂停，今日进度保留。":"已恢复拦截。");}
  catch(e){status(e.message);}
});

chrome.storage.onChanged.addListener((changes, area)=>{
  if(!initialized||area!=="local"||!changes.englishFirst?.newValue)return;
  adopt(changes.englishFirst.newValue);
  sync();
});

async function startup() {
  oldMedia=await localGet("lesson");
  oldCap=await localGet("captions");
  if(startupPage){
    try{await send("startup-hello");}
    catch{await send("state");}
  }else await send("state");
  initialized=true;
  sync();
  void showRecommendation();
  window.addEventListener("focus",()=>void showRecommendation(true));
  setInterval(()=>void showRecommendation(),30000);
  setInterval(sample,100);
}
if (window === window.top && startupPage) {
  chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
    if(m?.action!=="ping-startup")return false;
    chrome.tabs.getCurrent().then(t=>{if(t?.id===m.tabId) reply(true);},()=>{});
    return true;
  });
}
if (window === window.top) startup().catch(e=>status(e.message || "无法启动，请在浏览器扩展页面重新加载。"));

// Scroll without changing the URL hash: it may contain a blocked page.
by("go-settings").addEventListener("click", () => {
  by("settings").scrollIntoView({block:"start"});
  by("settings-title").focus({preventScroll:true});
});
