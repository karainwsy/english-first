// Local preference only; independent of playback and blocking state.
(() => {
 const key="englishFirstTheme", fallback="ice";
 const allowed=new Set(["ice","ink","violet","paper","mono"]);
 const normalize=v=>allowed.has(v)?v:fallback;
 const root=document.documentElement;
 const menu=document.getElementById("theme-menu");
 const radios=[...menu.querySelectorAll("input")];
 const storage=globalThis.chrome?.storage;
 let interacted=false;
 function apply(value){
   const theme=normalize(value);
   root.dataset.theme=theme;
   for(const r of radios) r.checked=r.value===theme;
 }
 apply(fallback);
 storage?.local.get(key).then(result=>{if(!interacted)apply(result[key]);}).catch(()=>{});
 storage?.onChanged.addListener((changed,area)=>{if(area==="local"&&changed[key])apply(changed[key].newValue);});
 menu.addEventListener("change",e=>{
   if(!radios.includes(e.target)||!e.target.checked)return;
   interacted=true;apply(e.target.value);
   storage?.local.set({[key]:e.target.value}).catch(()=>{});
 });
 menu.addEventListener("keydown",e=>{
   if(e.key==="Escape"&&menu.open){menu.open=false;menu.querySelector("summary").focus();}
 });
 document.addEventListener("click",e=>{if(menu.open&&!menu.contains(e.target))menu.open=false;});
})();
