(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let previewTimer=null,xySending=false,lastX=.5,lastY=.35;
  const modes=[
    {mode:"aura",title:"Aura",sub:"soft color field",payload:{mode:"aura",speed:120,motion:true}},
    {mode:"rain",title:"Rain",sub:"falling pixel trails",payload:{mode:"rain",speed:85,motion:false}},
    {mode:"tilt",title:"Motion Orb",sub:"MPU reactive glow",payload:{mode:"tilt",speed:90,motion:true}},
    {mode:"text",title:"Text",sub:"scroll message",payload:{mode:"text",text:"VIBE",font:"bold",direction:"left",speed:120}}
  ];
  const palettes=["#38d9d6","#8cff98","#ff477e","#ff9f1c","#9d8cff","#ffe66d","#ffffff","#0f172a"];
  function log(msg,level="info"){try{appendTransportLog(msg,level)}catch(e){}}
  function currentFrame(){try{return effectiveFrame(active)}catch(e){return project.frames[active]||Array(280).fill("#000000")}}
  function drawPreview(){
    const canvas=$("premiumPreview"); if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const frame=currentFrame();
    ctx.clearRect(0,0,280,100);
    frame.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect((i%28)*10,Math.floor(i/28)*10,9,9)});
  }
  function patchRefreshHooks(){
    const oldDraw=window.draw;
    if(typeof oldDraw==="function"){
      window.draw=function(){const out=oldDraw.apply(this,arguments);drawPreview();return out};
    }
    const oldLoad=window.loadProject;
    if(typeof oldLoad==="function"){
      window.loadProject=function(){const out=oldLoad.apply(this,arguments);setTimeout(drawPreview,0);return out};
    }
  }
  function debouncedSend(payload,delay=110){
    clearTimeout(previewTimer);
    previewTimer=setTimeout(async()=>{
      if(!activeTransport)return;
      try{await sendCommand(payload,0,0,9000);log("Live control sent")}
      catch(error){log("Live control failed: "+error.message,"error")}
    },delay);
  }
  function setHueFromColor(hex){
    const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    let h=0;
    if(d!==0){
      if(max===r)h=((g-b)/d)%6; else if(max===g)h=(b-r)/d+2; else h=(r-g)/d+4;
      h=Math.round(h*42.5); if(h<0)h+=255;
    }
    $("hue").value=h; $("saturation").value=Math.round(max===0?0:d/max*255);
    sync?.();
  }
  function applyMode(item){
    Object.entries(item.payload).forEach(([key,value])=>{
      const el=$(key);
      if(!el)return;
      if(el.type==="checkbox")el.checked=!!value; else el.value=value;
    });
    sync?.();
    debouncedSend(item.payload,0);
    document.querySelectorAll(".premium-mode").forEach(btn=>btn.classList.toggle("active",btn.dataset.mode===item.mode));
  }
  function handleXY(event){
    const pad=$("xyPad"),dot=$("xyDot"); if(!pad||!dot)return;
    const rect=pad.getBoundingClientRect();
    const point=event.touches?event.touches[0]:event;
    const x=Math.max(0,Math.min(1,(point.clientX-rect.left)/rect.width));
    const y=Math.max(0,Math.min(1,(point.clientY-rect.top)/rect.height));
    lastX=x;lastY=y;dot.style.left=(x*100)+"%";dot.style.top=(y*100)+"%";
    const hue=Math.round(x*255),brightness=Math.round(10+(1-y)*150),speed=Math.round(40+y*420);
    $("hue").value=hue;$("brightness").value=brightness;$("speed").value=speed;sync?.();
    debouncedSend({hue,brightness,speed});
  }
  function installReconnectTools(host){
    const row=document.createElement("div");
    row.className="premium-toolbar";
    row.innerHTML='<button id="premiumReconnect" type="button">Reconnect last</button><button id="premiumCleanDisconnect" type="button">Clean disconnect</button>';
    host.append(row);
    $("premiumReconnect").onclick=async()=>{
      try{
        if(device&&device.gatt&&!device.gatt.connected){
          const server=await device.gatt.connect();
          const service=await server.getPrimaryService(SERVICE);
          rx=await service.getCharacteristic(RX);tx=await service.getCharacteristic(TX);
          await tx.startNotifications();
          tx.addEventListener("characteristicvaluechanged",event=>handleDeviceChunk(new TextDecoder().decode(event.target.value)));
          activeTransport="ble";setConnected(true,device.name||"Bluetooth");log("Reconnected to last Bluetooth device");
        }else if(device&&device.gatt&&device.gatt.connected){log("Already connected");}
        else connect();
      }catch(error){setStatus(error.message,false,true);log(error.message,"error")}
    };
    $("premiumCleanDisconnect").onclick=()=>{try{if(device?.gatt?.connected)device.gatt.disconnect();}catch(e){} activeTransport=null;setConnected(false);log("Disconnected cleanly. The frame should keep advertising.")};
  }
  function buildUI(){
    document.body.classList.add("premium-ui");
    const editor=$("editor"); if(!editor)return;
    const hero=document.createElement("section");
    hero.className="premium-hero";
    hero.innerHTML=`
      <div class="premium-panel">
        <h2>Live diffuser preview</h2>
        <p class="premium-note">Pixel-accurate 28x10 preview. The frame still uses the proven JSON/BLE path underneath.</p>
        <div class="premium-preview-wrap"><canvas id="premiumPreview" width="280" height="100"></canvas></div>
        <div class="premium-toolbar"><button id="premiumShowFrame" class="premium-send" type="button">Send current frame</button><button id="premiumUploadShow" type="button">Upload slideshow</button></div>
      </div>
      <div class="premium-panel">
        <h2>Touch controls</h2>
        <p class="premium-note">Drag the pad: left/right changes hue, up/down changes brightness and speed.</p>
        <div id="xyPad"><div id="xyDot"></div></div>
        <div class="premium-swatch-line">${palettes.map(c=>`<button class="premium-swatch" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join("")}</div>
      </div>`;
    editor.prepend(hero);
    const gallery=document.createElement("section");
    gallery.className="premium-panel";
    gallery.innerHTML=`<h2>Quick modes</h2><p class="premium-note">Big tactile presets for normal remote-control use.</p><div class="premium-quick-grid">${modes.map(m=>`<button class="premium-mode" data-mode="${m.mode}" type="button"><strong>${m.title}</strong><span>${m.sub}</span></button>`).join("")}</div>`;
    hero.after(gallery);
    document.querySelectorAll(".premium-mode").forEach(btn=>btn.onclick=()=>applyMode(modes.find(m=>m.mode===btn.dataset.mode)));
    document.querySelectorAll(".premium-swatch").forEach(btn=>btn.onclick=()=>{const color=btn.dataset.color;$("color").value=color;setHueFromColor(color);debouncedSend({hue:+$("hue").value,saturation:+$("saturation").value})});
    const pad=$("xyPad"); pad.onpointerdown=e=>{xySending=true;pad.setPointerCapture?.(e.pointerId);handleXY(e)};pad.onpointermove=e=>{if(xySending)handleXY(e)};pad.onpointerup=pad.onpointercancel=()=>{xySending=false};
    $("premiumShowFrame").onclick=()=>$("sendFrame").click();$("premiumUploadShow").onclick=()=>$("uploadShow").click();
    installReconnectTools(document.querySelector(".sidebar .section")||document.querySelector(".sidebar"));
    const nav=document.createElement("nav");nav.className="premium-bottom-nav";nav.innerHTML='<button data-jump="connect">Connect</button><button data-jump="premiumPreview">Preview</button><button data-jump="xyPad">Control</button><button data-jump="uploadShow">Upload</button>';document.body.append(nav);
    nav.querySelectorAll("button").forEach(btn=>btn.onclick=()=>$(btn.dataset.jump)?.scrollIntoView({behavior:"smooth",block:"center"}));
    patchRefreshHooks();drawPreview();log("Premium UI active.");
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(buildUI,0),{once:true});
  else setTimeout(buildUI,0);
}());
