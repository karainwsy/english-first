(() => {
  if(globalThis.__englishFirstWatch) return;
  globalThis.__englishFirstWatch=true;
  let pending=false, checkedAt=0, overlay, button, previousFocus, activeCover=false;
  let requestedDuringCheck=false;
  let pageObserver;
  const themeKey="englishFirstTheme";
  const themeColors={"ice":["#f3f6fb","#ffffff","#16263b","#4b5e77","#cfd9e7","#244e79","#346393","#dce9fa","#0b1524","light","#ffffff"],"ink":["#111318","#1a1e26","#edf1f7","#b1bacb","#343c4b","#d0dcf0","#ebf1ff","#222938","#0a0c10","dark","#141b28"],"violet":["#171424","#231e34","#f4ecfc","#c3b6d9","#443857","#e4c2ff","#f0daff","#33234d","#100d1a","dark","#21152d"],"paper":["#faf3e9","#fffaf2","#32261f","#675247","#e4d3c4","#874731","#a4563c","#f2dfce","#211713","light","#ffffff"],"mono":["#f3f3f3","#ffffff","#191919","#545454","#d6d6d6","#242424","#454545","#e5e5e5","#101010","light","#ffffff"]};
  const themeProps=["paper","surface","ink","muted","line","button","hover","glow","accent","scheme","button-text"];
  let activeTheme="ice", themeSurface, changedTheme=false;
  function useTheme(value) {
    activeTheme=typeof value==="string" && Object.prototype.hasOwnProperty.call(themeColors,value) ? value : "ice";
    if(!themeSurface)return;
    themeColors[activeTheme].forEach((color,i)=>themeSurface.style.setProperty("--ef-"+themeProps[i],color));
  }
  chrome.storage.local.get(themeKey).then(v=>{if(!changedTheme)useTheme(v[themeKey]);}).catch(()=>{});
  function protectedEvent(event) {
    if(!activeCover || event.composedPath().includes(overlay)) return;
    event.stopImmediatePropagation();
    if(event.cancelable)event.preventDefault();
    if(event.type==="focusin"&&document.hasFocus())button?.focus({preventScroll:true});
  }
  const restrictedEvents=["focusin","keydown","keyup","pointerdown","pointerup","click","touchmove","wheel","scroll"];
  function mount() {
    if(!activeCover || !document.documentElement || overlay?.isConnected) return;
    const div=document.createElement("div");
    div.setAttribute("data-english-first-screen","");
    const styles={
      all:"initial",display:"block",position:"fixed",inset:"0",zIndex:"2147483647",
      pointerEvents:"auto",width:"100vw",height:"100vh",visibility:"visible",opacity:"1",transform:"none",
    };
    for(const [key,val] of Object.entries(styles)){
      div.style.setProperty(key.replace(/[A-Z]/g,c=>"-"+c.toLowerCase()),val,"important");
    }
    const tree=div.attachShadow({mode:"closed"});
    const css=document.createElement("style");
    css.textContent=`
      .surface{color-scheme:var(--ef-scheme,light);position:fixed;inset:0;display:grid;place-items:center;
        background:radial-gradient(ellipse at 78% 4%,var(--ef-glow),transparent 58%),var(--ef-paper);
        color:var(--ef-ink);padding:24px;box-sizing:border-box;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif;text-align:center}
      .card{width:min(510px,100%);background:var(--ef-surface);border:1px solid var(--ef-line);border-radius:24px;
        padding:clamp(20px,6vw,42px);box-sizing:border-box;box-shadow:0 14px 54px #0002}
      .tag{font:750 .8rem/1.3 ui-monospace,monospace;letter-spacing:.16em;color:var(--ef-muted)}
      h2{font:700 clamp(1.5rem,6vw,2.35rem)/1.23 "Songti SC",SimSun,Georgia,serif;margin:13px 0}
      p{color:var(--ef-muted);margin:10px 0 20px}
      button{padding:10px 18px;border:1px solid transparent;border-radius:9px;color:var(--ef-button-text);
        background:var(--ef-button);cursor:pointer;font:700 1rem system-ui}
      button:hover{background:var(--ef-hover)}
      button:focus-visible{outline:3px solid var(--ef-accent);outline-offset:4px}
    `;
    const card=document.createElement("div");card.className="card";
    const surface=document.createElement("div");surface.className="surface";
    surface.setAttribute("role","alertdialog");surface.setAttribute("aria-modal","true");
    surface.setAttribute("aria-label","先听十分钟");
    const tag=document.createElement("span");tag.className="tag";tag.textContent="ENGLISH FIRST";
    const title=document.createElement("h2");title.textContent="先听十分钟";
    const body=document.createElement("p");body.textContent="完成今天的英语听力后，这个网页会自动恢复。页面和填写的内容会保留。";
    button=document.createElement("button");button.type="button";button.textContent="打开听力页";
    button.addEventListener("click",()=>void chrome.runtime.sendMessage({action:"open-listening"}).catch(()=>show(false)));
    card.append(tag,title,body,button);surface.append(card);
    try{
      const sheet=new CSSStyleSheet();sheet.replaceSync(css.textContent);
      tree.adoptedStyleSheets=[sheet];
    }catch{tree.append(css);}
    tree.append(surface);
    themeSurface=surface;useTheme(activeTheme);
    overlay=div;
    try {
      const full=document.fullscreenElement;
      (full && full instanceof HTMLElement && !["VIDEO","IFRAME"].includes(full.tagName) ? full :
        document.documentElement).append(overlay);
      pageObserver?.observe(overlay.parentNode,{childList:true});
    }catch{return;}
    if(document.hasFocus())button.focus({preventScroll:true});
  }
  function show(on) {
    if(activeCover===on){if(on)mount();return;}
    activeCover=on;
    if(on){
      previousFocus=document.activeElement;
      // Do not mutate the page or its inputs. A covering dialog gets browser focus;
      // ordinary page interactions underneath it are prevented while it is visible.
      for(const e of restrictedEvents)window.addEventListener(e,protectedEvent,{capture:true,passive:false});
      pageObserver=new MutationObserver(()=>mount());
      pageObserver.observe(document,{childList:true});
      mount();
    }else{
      pageObserver?.disconnect();
      overlay?.remove();overlay=null;button=null;themeSurface=null;
      for(const e of restrictedEvents)window.removeEventListener(e,protectedEvent,true);
      if(previousFocus?.isConnected && document.hasFocus())previousFocus.focus?.({preventScroll:true});
      previousFocus=null;
    }
  }
  async function check(force=false) {
    if(document.visibilityState==="hidden" || (!force && Date.now()-checkedAt<1000)) return;
    if(pending){if(force)requestedDuringCheck=true;return;}
    pending=true;checkedAt=Date.now();
    try{
      const info=await chrome.runtime.sendMessage({action:"site-status"});
      if(!info?.blocked)show(false);
      else if(info.strict)show(true);
      else{
        show(false);
        location.replace(info.gate+"#"+location.href);
      }
    }catch{show(false);}
    finally{
      pending=false;
      if(requestedDuringCheck){requestedDuringCheck=false;void check(true);}
    }
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes[themeKey]){changedTheme=true;useTheme(changes[themeKey].newValue);}
    if(!changes.englishFirst)return;
    const {oldValue:o,newValue:n}=changes.englishFirst;
    if(o?.day!==n?.day || o?.strict!==n?.strict || o?.paused!==n?.paused ||
      o?.lesson!==n?.lesson || o?.mediaErrorLesson!==n?.mediaErrorLesson ||
      (o?.elapsed>=600000)!==(n?.elapsed>=600000)) void check(true);
  });
  void check(true);
  document.addEventListener("visibilitychange",()=>void check(true));
  document.addEventListener("fullscreenchange",()=>{if(activeCover){overlay?.remove();mount();}});
  window.addEventListener("focus",()=>void check(true));
  window.addEventListener("pageshow",()=>void check(true));
  setInterval(check,3000);
})();
