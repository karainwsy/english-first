import {resolveDaily,dailyLesson} from "./daily-media.mjs";
import {goal, speed, rates, dayKey, normalizeHost, patterns, staticDay, storageKey, builtins, removeClip, webOrigins, hasMedia} from "./core.mjs";
const index = chrome.runtime.getURL("index.html");
const startPage = index + "?startup=1";
const startKey = "englishStartupTab";
const sessionDayKey = "englishSessionDay";
const mediaFeedRevision = 2;
let queue = Promise.resolve(), configuredDay;
const enqueue = fn => {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
};
let availableWork;
async function packageHas(file) {
  try{
    const resp=await fetch(chrome.runtime.getURL(file),{headers:{Range:"bytes=0-0"}});
    if(resp.body) await resp.body.cancel();
    return resp.ok;
  }catch{return false;}
}
function availableBuiltins(){
  availableWork ||= Promise.all(builtins.map(async b=>
    !b.optional || ((await packageHas(b.captions)) && (await packageHas(b.file))) ? b : null
  )).then(all=>all.filter(Boolean));
  return availableWork;
}
const isNormalWindow=w=>w?.type==="normal" && !w.incognito;
async function normalWindows(){
  return (await chrome.windows.getAll({windowTypes:["normal"]})).filter(isNormalWindow);
}
// The service worker can sleep without ending a browser session. Background-only
// launches do not start a listening day until a regular window is opened.
async function sessionDay(windowOpened=false){
  const pinned=(await chrome.storage.session.get(sessionDayKey))[sessionDayKey];
  if(pinned) return pinned;
  const today=dayKey();
  if(windowOpened || (await normalWindows()).length)
    await chrome.storage.session.set({[sessionDayKey]:today});
  return today;
}
async function read(resolveNow=false, windowOpened=false) {
  const raw=(await chrome.storage.local.get(storageKey))[storageKey];
  const s=staticDay(raw,await sessionDay(windowOpened),await availableBuiltins());
  s.mediaFeedRevision=raw?.mediaFeedRevision;
  if(resolveNow && (!s.dailyResolved || s.mediaFeedRevision!==mediaFeedRevision)) {
    const daily=await resolveDaily(s.day,path=>chrome.runtime.getURL(path));
    if(daily){s.daily=daily;s.lesson=dailyLesson(daily);s.mediaErrorLesson=null;}
    s.dailyResolved=true;
    s.mediaFeedRevision=mediaFeedRevision;
  }
  if(s.strict && !await chrome.permissions.contains({origins:webOrigins})) s.strict=false;
  if(!Array.isArray(raw?.pool)||raw.day!==s.day||raw.strict!==s.strict||
     raw.dailyResolved!==s.dailyResolved || raw.mediaFeedRevision!==s.mediaFeedRevision ||
     JSON.stringify(raw.builtinAvailable)!==JSON.stringify(s.builtinAvailable)) await save(s);
  return s;
}
const save = s => chrome.storage.local.set({[storageKey]: s});
const canBlock=s=>!s.paused && hasMedia(s) && s.elapsed<goal;

async function configure(s) {
  const hosts = [];
  for (const host of s.hosts) {
    if (await chrome.permissions.contains({origins: patterns(host)})) hosts.push(host);
  }
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const regex = s.strict ? "^https?://[^/]+/.*" :
    "^https?://(" + hosts.map(h=>h.replaceAll(".", "\\.")).join("|") + ")(:[0-9]+)?/.*";
  const addRules=canBlock(s) && (s.strict || hosts.length) ? [{
    id:1, action:{type:"redirect",redirect:{regexSubstitution:index+"#\\0"}},
    condition:{regexFilter:regex,resourceTypes:["main_frame"],requestMethods:["get"]},
  }] : [];
  if (addRules.length) {
    const status = await chrome.declarativeNetRequest.isRegexSupported({regex, requireCapturing: true});
    if (!status.isSupported) throw new Error("网站列表太长或不能作为拦截条件。");
  }
  if (JSON.stringify(old) !== JSON.stringify(addRules)) {
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: old.map(r=>r.id), addRules});
  }
  const oldScripts = await chrome.scripting.getRegisteredContentScripts();
  const matches=s.strict ? webOrigins : hosts.flatMap(patterns);
  if (JSON.stringify(oldScripts[0]?.matches || []) !== JSON.stringify(matches)) {
    if (oldScripts.length) await chrome.scripting.unregisterContentScripts({ids: oldScripts.map(s=>s.id)});
    if (matches.length) {
      await chrome.scripting.registerContentScripts([{
        id:"check-gate", matches, js:["watchdog.js"], runAt:"document_start", persistAcrossSessions:true,
      }]);
    }
  }

  configuredDay = s.day;
}
function refresh() { enqueue(async () => configure(await read())).catch(console.error); }

chrome.runtime.onInstalled.addListener(refresh);
async function showStartup(w, s) {
  if (!s.startup || !canBlock(s) || w?.type !== "normal" || w.incognito || w.id == null) return;
  const openId=(await chrome.storage.session.get(startKey))[startKey];
  if (openId != null) {
    const open=await chrome.tabs.get(openId).catch(()=>null);
    const ping=() => Promise.race([
      chrome.runtime.sendMessage({action:"ping-startup",tabId:openId}).catch(()=>false),
      new Promise(resolve=>setTimeout(()=>resolve(false),300)),
    ]);
    if (open && (open.url===startPage || open.pendingUrl===startPage || (!open.url && await ping()))) {
      if (open.windowId===w.id) await chrome.tabs.update(openId,{active:true});
      return; // One prompt per browser profile; do not pull focus away to another window.
    }
  }
  const restored=(await chrome.tabs.query({windowId:w.id})).find(t=>t.url===startPage||t.pendingUrl===startPage);
  const tab=restored ? await chrome.tabs.update(restored.id,{active:true}) :
    await chrome.tabs.create({url:startPage,windowId:w.id,active:true});
  if(tab.id != null) await chrome.storage.session.set({[startKey]:tab.id});
}
chrome.runtime.onStartup.addListener(() => enqueue(async()=>{
  const windows=await normalWindows();
  const w=windows.find(x=>x.focused) || windows[0];
  if(!w) return;
  const s=await read(true,true);
  await configure(s);
  await showStartup(w,s);
}).catch(console.error));
chrome.windows.onCreated.addListener(w=>{
  if(!isNormalWindow(w))return;
  enqueue(async()=>{
    const s=await read(true,true);
    await configure(s);
    await showStartup(w,s);
  }).catch(console.error);
});
chrome.windows.onRemoved.addListener(()=>{
  // Capture the visible windows as soon as the event arrives; Edge can keep
  // running after the last regular window closes (for example, Startup Boost).
  const remaining=normalWindows().catch(()=>null);
  enqueue(async()=>{
    const windows=await remaining;
    if(windows && !windows.length){
      await chrome.storage.session.remove([sessionDayKey,startKey]);
      configuredDay=undefined;
    }
  }).catch(console.error);
});
chrome.permissions.onRemoved.addListener(refresh);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
function siteAddress(url) {
  try { return new URL(url); } catch { return null; }
}
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (!m || typeof m.action !== "string") return false;
  const gateSender = sender.id === chrome.runtime.id && [index,startPage].includes(sender.url?.split("#")[0]);
  const page = siteAddress(sender.url);
  if(!["site-status","open-listening"].includes(m.action) && (!gateSender || sender.frameId>0)) return false;
  enqueue(async () => {
    const s=await read(["state","startup-hello"].includes(m.action));
    if(["site-status","open-listening"].includes(m.action)) {
      if(sender.frameId!==0 || !page || !["http:","https:"].includes(page.protocol))
        return {blocked:false};
      if(!s.strict && (!s.hosts.includes(page.hostname) ||
          !await chrome.permissions.contains({origins:patterns(page.hostname)}))) return {blocked:false};
      if(s.day!==configuredDay) await configure(s);
      if(m.action==="open-listening"){
        if(s.strict && canBlock(s) && sender.tab?.windowId!=null) {
          await chrome.tabs.create({url:index,windowId:sender.tab.windowId,active:true});
        }
        return {blocked:s.strict && canBlock(s)};
      }
      return canBlock(s) ? {blocked:true,gate:index,strict:s.strict} : {blocked:false};
    }
    const previous = structuredClone(s);
    let reconfigure = true;
    switch (m.action) {
      case "state":
        break;
      case "add-host": {
        const host = normalizeHost(m.host);
        if (!s.lesson) throw new Error("请先导入一段可播放的英语视频。");
        if (!s.hosts.includes(host) && s.hosts.length >= 16) throw new Error("最多设置 16 个域名。");
        if (!await chrome.permissions.contains({origins: patterns(host)})) throw new Error("没有这个网站的授权。");
        if (!s.hosts.includes(host)) s.hosts.push(host);
        break;
      }
      case "remove-host":
        s.hosts = s.hosts.filter(h=>h !== m.host);
        break;
      case "pause":
        if(s.strict) throw new Error("全站强制模式只能从 Edge 的扩展管理页停用整个扩展。");
        s.paused=Boolean(m.paused);
        break;
      case "enable-strict":
        if(!hasMedia(s)) throw new Error("先准备一个可播放的本地视频。");
        if(!await chrome.permissions.contains({origins:webOrigins}))
          throw new Error("没有授予浏览器全站权限；保留原有拦截设置。");
        s.strict=true;
        s.startup=true;
        s.paused=false;
        break;
      case "media-unavailable":
      case "media-ready":
        if(m.version!==s.lesson || !s.lesson)return {state:s};
        if(m.action==="media-unavailable" && s.daily) {
          s.daily=null;s.lesson=s.poolLesson;s.mediaErrorLesson=null;
        } else if(m.action==="media-unavailable" && s.mediaErrorLesson!==s.lesson)
          s.mediaErrorLesson=s.lesson;
        else if(m.action==="media-ready" && s.mediaErrorLesson===s.lesson)
          s.mediaErrorLesson=null;
        else return {state:s};
        break;
      case "startup-setting":
        if(s.strict && !m.enabled) throw new Error("全站强制模式下，启动听力页保持开启。");
        s.startup=Boolean(m.enabled);
        break;
      case "add-clip": {
        if (typeof m.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(m.id))
          throw new Error("视频标识无效。");
        if (!s.pool.some(clip=>clip.id===m.id)) {
          const builtin=builtins.find(clip=>clip.id===m.id);
          if(builtin && !s.builtinAvailable.includes(m.id)) throw new Error("此示例视频未安装。");
          if(!builtin && (!Number.isFinite(m.duration) || m.duration < goal * speed/1000))
            throw new Error("视频太短或无法播放。");
          if(s.pool.length>=32) throw new Error("播放列表最多放 32 个视频。");
          const name=builtin?.name || String(m.name || "本地英语视频").slice(0,200);
          s.pool.push({id:m.id,name});
          s.poolLesson ||= m.id;
          s.lesson ||= m.id;
        }
        break;
      }
      case "remove-clip":
        removeClip(s,m.id);
        break;
      case "startup-hello": {
        const t=sender.tab;
        if(sender.url===startPage && t?.id != null){
          const openId=(await chrome.storage.session.get(startKey))[startKey];
          if(openId==null || !(await chrome.tabs.get(openId).catch(()=>null)))
            await chrome.storage.session.set({[startKey]:t.id});
        }
        if(s.day!==configuredDay || s.daily) await configure(s);
        return {state:s};
      }
      case "set-rate":
        if(!rates.includes(m.rate)) throw new Error("此播放速度不受支持。");
        s.playbackRate=m.rate;
        reconfigure=false;
        break;
      case "position":
      case "progress": {
        const t = sender.tab;
        if (!t?.active || m.day !== s.day || !s.lesson || m.version !== s.lesson)
          return {state:s};
        const wnd = await chrome.windows.get(t.windowId);
        if (!wnd.focused) return {state:s};
        if(Number.isFinite(m.position) && m.position>=0 && m.position<=1e6)
          s.positions[s.lesson]=m.position;
        const before=s.elapsed;
        if(m.action==="progress" && Number.isFinite(m.ms) && m.ms>0 && m.ms<=1500)
          s.elapsed=Math.min(goal,s.elapsed+m.ms);
        reconfigure=before<goal && s.elapsed===goal;
        break;
      }
      default:
        throw new Error("此操作不受支持。");
    }
    try {
      if (reconfigure) await configure(s);
      if (m.action !== "state") await save(s);
      if(m.action==="enable-strict"){
        // Existing tabs retain their document, form fields and navigation history.
        const tabs=await chrome.tabs.query({}).catch(()=>[]);
        for(const t of tabs){
          if(t.id!=null && !t.incognito && /^https?:\/\//.test(t.url || ""))
            void chrome.scripting.executeScript({target:{tabId:t.id},files:["watchdog.js"]}).catch(()=>{});
        }
      }
    } catch (error) {
      if (reconfigure) await configure(previous).catch(console.error);
      throw error;
    }
    return {state:s};
  }).then(sendResponse, err => sendResponse({error:err.message || "保存失败。"}));
  return true;
});
