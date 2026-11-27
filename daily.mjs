export function beijingDay(d=new Date()) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(d);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return v.year+"-"+v.month+"-"+v.day;
}
export function pickedRecommendation(raw, now=beijingDay()) {
  const entries=[raw,raw?.previous].filter(Boolean);
  return entries.map(e=>recommendationEntry(e,now)).filter(Boolean)
    .sort((a,b)=>Number(a.fallback)-Number(b.fallback))[0] || null;
}
function recommendationEntry(raw, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(now)) return null;
  const yesterday=new Date(Date.parse(now+"T00:00:00Z")-86400000).toISOString().slice(0,10);
  if(!raw || ![now,yesterday].includes(raw.day) || typeof raw.title!=="string" || !raw.title.trim()) return null;
  let u;
  try { u=new URL(raw.url); }
  catch { return null; }
  if(u.protocol!=="https:" || u.port || u.username || u.password) return null;
  let video;
  if(["www.youtube.com","youtube.com"].includes(u.hostname) && u.pathname==="/watch")
    video=u.searchParams.get("v");
  else if(u.hostname==="youtu.be")
    video=u.pathname.slice(1);
  let safe;
  if(/^[A-Za-z0-9_-]{11}$/.test(video || "")){
    safe=new URL("https://www.youtube.com/watch");safe.searchParams.set("v",video);
    const t=u.searchParams.get("t");
    if(t && /^\d{1,5}s?$/.test(t))safe.searchParams.set("t",t);
  }else{
    const allowed={
      "svs.gsfc.nasa.gov": /^\/\d+\/?$/,
      "www.nasa.gov": /^\/(?:feature|missions|news-release|image-article|videos|video)\/[a-zA-Z0-9_/%-]+$/,
      "learningenglish.voanews.com": /^\/a\/[a-zA-Z0-9_/%-]+\/\d+\.html$/,
      "commons.wikimedia.org": /^\/wiki\/File:[^/]+$/,
    };
    if(!Object.hasOwn(allowed,u.hostname)||!allowed[u.hostname].test(u.pathname))return null;
    safe=new URL(u.origin+u.pathname);
  }
  return {fallback:raw.day!==now,title:raw.title.trim().slice(0,150),url:safe.href,note:typeof raw.note==="string"?raw.note.trim().slice(0,260):""};
}
export async function loadRecommendation(base, now=beijingDay(), transport=fetch) {
  try {
    const path=base+"?fresh="+encodeURIComponent(Date.now()+"-"+Math.random());
    const response=await transport(path,{cache:"no-store"});
    return response.ok ? pickedRecommendation(await response.json(),now) : null;
  } catch { return null; }
}
