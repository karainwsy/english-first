import {dailyLesson,isoDay} from "./daily-media.mjs";
export const goal = 600000;
export const speed = 0.85;
export const rates = [0.5, 0.75, 0.85, 1, 1.25, 1.5, 2];
export const storageKey = "englishFirst";
export const webOrigins = ["http://*/*", "https://*/*"];
export function hasMedia(s) {return Boolean(s.lesson) && s.mediaErrorLesson!==s.lesson;}
export function dayKey(d = new Date()) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
}
export function normalizeHost(value) {
  const input = String(value).trim();
  if (!input || /[\s\\*]/.test(input)) throw new Error("请输入一个网站网址或域名，不能用通配符。");
  let url;
  try { url = new URL(input.includes("://") ? input : "https://" + input); }
  catch { throw new Error("这个网址无法识别。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.port || url.hostname.length > 253 || !url.hostname.includes(".") || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(url.hostname)) {
    throw new Error("请输入 HTTP(S) 网站域名，不带账号或端口。");
  }
  return url.hostname;
}
export function patterns(host) { return [`http://${host}/*`, `https://${host}/*`]; }
export const builtins = [];
export function ordinal(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(key)) return NaN;
  const [y,m,d] = key.split("-").map(Number);
  return Date.UTC(y,m-1,d) / 86400000;
}
function rotate(pool, index) {
  return pool.length ? pool[((index % pool.length) + pool.length) % pool.length].id : null;
}
export function staticDay(data, now = dayKey(), available = builtins.filter(b=>!b.optional)) {
  const alreadyMigrated = Array.isArray(data?.pool);
  const firstBuiltin = builtins[0]?.id;
  let pool;
  if (alreadyMigrated) {
    pool=data.pool;
  } else if (data?.lesson === null) {
    pool=[];
  } else if (data?.lesson && data.lesson !== firstBuiltin) {
    pool=[{id:data.lesson,name:"之前导入的视频"},...available.map(({id,name})=>({id,name}))];
  } else {
    pool=available.map(({id,name})=>({id,name}));
  }
  const availableIds=available.map(({id})=>id);
  const known=Array.isArray(data?.builtinKnown) ? data.builtinKnown :
    pool.filter(c=>builtins.some(b=>b.id===c.id)).map(({id})=>id);
  pool=pool.filter(c=>!builtins.some(b=>b.id===c.id)||availableIds.includes(c.id));
  if (pool.length) {
    for (const {id,name} of available) {
      if(!known.includes(id) && !pool.some(c=>c.id===id)) pool.push({id,name});
    }
  }
  const baseDay=ordinal(data?.day);
  const elapsedDays=Number.isFinite(baseDay) ? Math.max(0,ordinal(now)-baseDay) : 0;
  const lastIndex=pool.findIndex(({id})=>id===(data?.poolLesson ?? data?.lesson));
  const poolLesson=rotate(pool,Math.max(0,lastIndex)+elapsedDays);
  const daily= data?.day===now && data?.daily?.day===isoDay(now) ? data.daily : null;
  const lesson=daily ? dailyLesson(daily) : poolLesson;
  return {
    hosts: Array.isArray(data?.hosts) ? data.hosts : [],
    paused: Boolean(data?.paused),
    strict: data?.strict === true,
    mediaErrorLesson: data?.day===now && typeof data?.mediaErrorLesson==="string" ? data.mediaErrorLesson : null,
    startup: data?.startup !== false,
    pool,
    builtinAvailable:availableIds,
    builtinKnown:[...new Set([...known,...availableIds])],
    lesson,
    poolLesson,
    daily,
    dailyResolved:data?.day===now && data?.dailyResolved===true,
    playbackRate:rates.includes(data?.playbackRate) ? data.playbackRate : speed,
    positions: data?.day===now && data?.positions && typeof data.positions==="object" ? data.positions : {},
    day: now,
    elapsed: data?.day === now && Number.isFinite(data.elapsed) ? Math.min(goal, Math.max(0, data.elapsed)) : 0,
  };
}
// Supports an old worker that is still in memory after these files are replaced.
export function panelState(raw, now = dayKey()) {
  if (!raw || typeof raw !== "object") throw new Error("浏览器后台未返回状态。");
  const needsReload=!Array.isArray(raw.pool) || !Array.isArray(raw.builtinAvailable) || typeof raw.strict!=="boolean" || typeof raw.dailyResolved!=="boolean";
  const available=needsReload ? builtins.filter(b=>!b.optional) :
    builtins.filter(b=>raw.builtinAvailable.includes(b.id));
  return {state:staticDay(raw,now,available),needsReload};
}
export function removeClip(s,id) {
  const index=s.pool.findIndex(clip=>clip.id===id);
  if(index<0) return;
  s.pool.splice(index,1);
  delete s.positions[id];
  if(s.poolLesson===id || (!s.daily && s.lesson===id)) s.poolLesson=rotate(s.pool,index);
  if(!s.daily) s.lesson=s.poolLesson;
}
export function activeMs(last, current) {
  if (!last || !current.valid || !last.valid || current.session !== last.session) return 0;
  const rate=current.rate ?? speed;
  if (!Number.isFinite(rate)||rate<=0||rate!==(last.rate ?? speed)) return 0;
  const wall = current.wall - last.wall;
  const media = (current.position - last.position) * 1000;
  if (wall <= 0 || wall > 500 || media <= 0 || media > (wall * rate) + 65) return 0;
  return Math.min(wall, media / rate);
}
export function toVtt(text) {
  let clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!/^WEBVTT(?:[ \t]|\n|$)/.test(clean)) {
    clean = "WEBVTT\n\n" + clean.replace(/^(\d\d:\d\d:\d\d),(\d\d\d)(\s+-->\s+\d\d:\d\d:\d\d),(\d\d\d)/gm, "$1.$2$3.$4");
  }
  if (!/^\d{2}:\d\d(?::\d\d)?\.\d{3} --> \d{2}:\d\d(?::\d\d)?\.\d{3}/m.test(clean)) {
    throw new Error("没读到有效字幕时间码，请选择 UTF-8 编码的 SRT 或 VTT。");
  }
  return clean + "\n";
}
