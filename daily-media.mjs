// Only trusted, local package files can contribute timed daily media.
export const maxDailyFile=128*1024*1024;
const maxCaptions=256*1024;
export function isoDay(localDay) {
  const f=String(localDay).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return f ? [f[1],f[2].padStart(2,"0"),f[3].padStart(2,"0")].join("-") : "";
}
export function dailyMeta(raw, localDay) {
  const date=isoDay(localDay), m=raw?.media;
  if(!date || raw?.day!==date || typeof raw.title!=="string" || !raw.title.trim() ||
     !m || typeof m.id!=="string" || !m.id.startsWith(date+"-") ||
     !/^[a-z0-9-]{12,90}$/.test(m.id) || !["a","b"].includes(m.slot) ||
     !(m.format===undefined || ["mp4","webm"].includes(m.format)) ||
     !Number.isFinite(m.durationSec) || m.durationSec<510 || m.durationSec>3600 ||
     ![m.videoSha256,m.captionsSha256].every(v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v)))return null;
  return {
    day:date,title:raw.title.trim().slice(0,150),id:m.id,slot:m.slot,format:m.format??"mp4",durationSec:m.durationSec,
    videoSha256:m.videoSha256,captionsSha256:m.captionsSha256,
    aiSelected:raw.aiSelected===true,
    aiWords:Array.isArray(raw.aiWords)?[...new Set(raw.aiWords.slice(0,44)
      .filter(w=>typeof w==="string"&&/^[a-z][a-z'-]{1,39}$/.test(w)))]:[],
    attribution:typeof m.attribution==="string"?m.attribution.trim().slice(0,350):"",
  };
}
export const dailyLesson=m=>"daily:"+m.id;
export function dailyPaths(m) {
  if(!["a","b"].includes(m?.slot))throw new Error("未知每日素材位置");
  const format=m.format===undefined ? "mp4" : m.format;
  if(!["mp4","webm"].includes(format))throw new Error("不支持的每日视频格式");
  return {video:"media/daily-"+m.slot+"."+format,captions:"media/daily-"+m.slot+".vtt"};
}
async function boundedBytes(response, limit) {
  if(!response.ok || !response.body)throw new Error("每日素材不可用");
  const declared=response.headers.get("content-length");
  if(declared && Number(declared)>limit){
    await response.body.cancel();throw new Error("每日素材文件太大");
  }
  const reader=response.body.getReader(), pieces=[];
  let size=0;
  for(;;){
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>limit){await reader.cancel();throw new Error("每日素材文件太大");}
    pieces.push(value);
  }
  const result=new Uint8Array(size);
  let at=0;for(const p of pieces){result.set(p,at);at+=p.byteLength;}
  return result;
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
   b=>b.toString(16).padStart(2,"0")).join("");
}
export async function verifiedDailyAssets(meta,getURL,transport=fetch) {
  const paths=dailyPaths(meta);
  async function asset(path, limit, expected) {
    const r=await transport(getURL(path)+"?asset="+expected,{cache:"no-store"});
    const bytes=await boundedBytes(r,limit);
    if(await sha256(bytes)!==expected) throw new Error("每日素材校验不匹配");
    return bytes;
  }
  const [video,captions]=await Promise.all([
    asset(paths.video,maxDailyFile,meta.videoSha256),
    asset(paths.captions,maxCaptions,meta.captionsSha256),
  ]);
  const text=new TextDecoder("utf-8",{fatal:true}).decode(captions);
  if(!/^WEBVTT(?:[ \t\r\n]|$)/.test(text) || !/-->/.test(text))
    throw new Error("每日英文字幕无效");
  return {media:new Blob([video],{type:meta.format==="webm"?"video/webm":"video/mp4"}),captions:text};
}
export async function resolveDaily(localDay,getURL,transport=fetch) {
  try {
    const response=await transport(getURL("daily-recommendation.json")+"?fresh="+Date.now()+"-"+Math.random(),{cache:"no-store"});
    const bytes=await boundedBytes(response,24*1024);
    const feed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    const meta=[feed,feed?.previous].map(x=>dailyMeta(x,localDay)).find(Boolean);
    if(!meta)return null;
    await verifiedDailyAssets(meta,getURL,transport);
    return meta;
  } catch {return null;}
}
