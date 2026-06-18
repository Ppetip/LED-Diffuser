const W=28,H=10,N=W*H,MAX_FRAMES=8;
const SERVICE="6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX="6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX="6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const $=id=>document.getElementById(id);
let device,rx,tx,serialPort,serialWriter,activeTransport=null,tool="brush",drawing=false,lastPainted=null,refreshTimer=null,active=0;
let project={name:"My wall show",frameMs:250,frames:[blank()]};

function blank(){return Array(N).fill("#000000")}
function setStatus(text,on=false,error=false){
  $("status").textContent=text;
  $("status").className="status"+(on?" on":"");
  $("message").textContent=text;
  $("message").className=error?"error":"note";
}
function setConnected(value,label=""){
  $("connect").disabled=value;
  $("connectUsb").disabled=value;
  $("disconnect").disabled=!value;
  ["sendFrame","uploadShow","sendVibe"].forEach(id=>$(id).disabled=!value);
  setStatus(value?"Connected via "+label:"Not connected",value);
}
async function connect(){
  if(!navigator.bluetooth){setStatus("Web Bluetooth is unavailable here.",false,true);return}
  try{
    setStatus("Choose LED-Diffuser in the pairing window...");
    device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}],optionalServices:[SERVICE]});
    device.addEventListener("gattserverdisconnected",()=>{activeTransport=null;setConnected(false)});
    const server=await device.gatt.connect();
    const service=await server.getPrimaryService(SERVICE);
    rx=await service.getCharacteristic(RX);
    tx=await service.getCharacteristic(TX);
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged",event=>{
      setStatus(new TextDecoder().decode(event.target.value),true);
    });
    activeTransport="ble";
    setConnected(true,device?.name||"Bluetooth");
  }catch(error){setStatus(error.message||String(error),false,true)}
}
async function connectUsb(){
  if(!navigator.serial){setStatus("Web Serial requires Chrome or Edge on a computer.",false,true);return}
  try{
    serialPort=await navigator.serial.requestPort();
    await serialPort.open({baudRate:115200});
    await serialPort.setSignals({dataTerminalReady:true,requestToSend:false});
    serialWriter=serialPort.writable.getWriter();
    activeTransport="usb";
    setConnected(true,"USB");
    await new Promise(resolve=>setTimeout(resolve,2000));
  }catch(error){setStatus(error.message||String(error),false,true)}
}
async function disconnectTransport(){
  try{
    if(device?.gatt?.connected)device.gatt.disconnect();
    if(serialWriter){serialWriter.releaseLock();serialWriter=null}
    if(serialPort){await serialPort.setSignals({dataTerminalReady:false,requestToSend:false});await serialPort.close();serialPort=null}
  }finally{activeTransport=null;setConnected(false)}
}
async function transmit(payload){
  const bytes=new TextEncoder().encode(JSON.stringify(payload)+"\n");
  if(activeTransport==="usb"){
    if(!serialWriter)throw Error("USB connection is not open");
    await serialWriter.write(bytes);
    $("progress").style.width="100%";
  }else if(activeTransport==="ble"){
    if(!rx)throw Error("Bluetooth connection is not open");
    for(let i=0;i<bytes.length;i+=18){
      const part=bytes.slice(i,i+18);
      if(rx.writeValueWithoutResponse)await rx.writeValueWithoutResponse(part);
      else await rx.writeValue(part);
      $("progress").style.width=Math.round(100*Math.min(bytes.length,i+18)/bytes.length)+"%";
    }
  }else throw Error("Connect Bluetooth or USB first");
  setTimeout(()=>$("progress").style.width="0",800);
}
function pixelsHex(frame){return frame.map(color=>color.slice(1)).join("")}
async function sendCurrent(){
  try{
    setStatus("Sending frame...");
    await transmit({brightness:+$("brightness").value,pixels:pixelsHex(project.frames[active])});
    setStatus("Frame saved on diffuser",true);
  }catch(error){setStatus(error.message,false,true)}
}
async function uploadShow(){
  try{
    setStatus("Uploading "+project.frames.length+" frames...");
    await transmit({brightness:+$("brightness").value,frameMs:project.frameMs,frames:project.frames.map(pixelsHex)});
    setStatus("Show saved and playing",true);
  }catch(error){setStatus(error.message,false,true)}
}

function initGrid(){
  const matrix=$("matrix");
  matrix.innerHTML="";
  for(let i=0;i<N;i++){
    const pixel=document.createElement("div");
    pixel.className="pixel";
    pixel.dataset.i=i;
    matrix.appendChild(pixel);
  }
  matrix.onpointerdown=event=>{
    event.preventDefault();
    drawing=true;lastPainted=null;
    matrix.setPointerCapture?.(event.pointerId);
    paintFromEvent(event);
  };
  matrix.onpointermove=event=>{
    if(!drawing)return;
    event.preventDefault();
    paintFromEvent(event);
  };
  const finish=event=>{
    if(!drawing)return;
    drawing=false;lastPainted=null;
    if(matrix.hasPointerCapture?.(event.pointerId))matrix.releasePointerCapture(event.pointerId);
    flushProjectRefresh();
  };
  matrix.onpointerup=finish;
  matrix.onpointercancel=finish;
  matrix.onlostpointercapture=()=>{drawing=false;lastPainted=null;flushProjectRefresh()};
}
function paintFromEvent(event){
  const element=document.elementFromPoint(event.clientX,event.clientY);
  const pixel=element?.closest?.(".pixel");
  if(!pixel||!$("matrix").contains(pixel))return;
  const index=+pixel.dataset.i;
  if(tool==="fill"){
    if(lastPainted===null)paint(index);
    lastPainted=index;
    return;
  }
  if(index===lastPainted)return;
  if(lastPainted===null)paint(index);
  else paintLine(lastPainted,index);
  lastPainted=index;
}
function paintLine(from,to){
  let x0=from%W,y0=Math.floor(from/W),x1=to%W,y1=Math.floor(to/W);
  const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;
  let error=dx+dy;
  while(true){
    paint(y0*W+x0);
    if(x0===x1&&y0===y1)break;
    const twice=2*error;
    if(twice>=dy){error+=dy;x0+=sx}
    if(twice<=dx){error+=dx;y0+=sy}
  }
}
function scheduleProjectRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(flushProjectRefresh,90);
}
function flushProjectRefresh(){
  clearTimeout(refreshTimer);refreshTimer=null;
  drawFrames();saveDraft();
}
function draw(){
  [...$("matrix").children].forEach((pixel,i)=>pixel.style.background=project.frames[active][i]);
  drawFrames();
  saveDraft();
}
function paint(index){
  const frame=project.frames[active];
  const next=tool==="erase"?"#000000":$("color").value;
  if(tool==="fill"){
    const from=frame[index];
    if(from===next)return;
    const queue=[index],seen=new Set();
    while(queue.length){
      const point=queue.pop();
      if(seen.has(point)||frame[point]!==from)continue;
      seen.add(point);frame[point]=next;
      const x=point%W,y=Math.floor(point/W);
      if(x)queue.push(point-1);
      if(x<W-1)queue.push(point+1);
      if(y)queue.push(point-W);
      if(y<H-1)queue.push(point+W);
    }
  }else{
    if(frame[index]===next)return;
    frame[index]=next;
    const cell=$("matrix").children[index];
    if(cell)cell.style.background=next;
    scheduleProjectRefresh();
    return;
  }
  draw();
}
function drawFrames(){
  $("frames").innerHTML="";
  project.frames.forEach((frame,index)=>{
    const button=document.createElement("button");
    button.className="frame"+(index===active?" active":"");
    const canvas=document.createElement("canvas");
    canvas.width=W;canvas.height=H;
    const context=canvas.getContext("2d");
    frame.forEach((color,n)=>{
      context.fillStyle=color;
      context.fillRect(n%W,Math.floor(n/W),1,1);
    });
    button.append(canvas);
    const title=document.createElement("small");
    title.textContent="Frame "+(index+1);
    button.append(title);
    button.onclick=()=>{active=index;draw()};
    $("frames").append(button);
  });
}
function shift(dx,dy){
  const old=[...project.frames[active]],frame=project.frames[active];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    frame[y*W+x]=old[((y-dy+H)%H)*W+(x-dx+W)%W];
  }
  draw();
}
function mirror(vertical){
  const old=[...project.frames[active]],frame=project.frames[active];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    frame[y*W+x]=old[(vertical?H-1-y:y)*W+(vertical?x:W-1-x)];
  }
  draw();
}
function rgb(h,s,v){
  const f=(n,k=(n+h/60)%6)=>v-v*s*Math.max(Math.min(k,4-k,1),0);
  return"#"+[f(5),f(3),f(1)].map(value=>Math.round(value*255).toString(16).padStart(2,"0")).join("");
}
function preset(kind){
  const frame=project.frames[active];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let color="#000000",distance=Math.hypot(x-13.5,y-4.5);
    if(kind==="gradient")color=rgb(170+x*4+y*6,.75,.18+.8*(1-y/H));
    if(kind==="rainbow")color=rgb(x*12+y*7,.9,1);
    if(kind==="heart"){
      const nx=(x-13.5)/13,ny=(y-5)/5;
      color=Math.pow(nx*nx+ny*ny-.45,3)-nx*nx*ny*ny*ny<0?"#ff477e":"#090012";
    }
    if(kind==="stars")color=Math.random()>.86?["#ffffff","#ffe29a","#9fe8ff"][Math.floor(Math.random()*3)]:"#02040b";
    if(kind==="waves")color=Math.abs(y-(5+Math.sin(x*.55)*2))<1.2?rgb(x*9,1,1):rgb(210,.7,.06);
    if(kind==="plasma")color=rgb((Math.sin(x*.35)+Math.cos(y*.8))*60+220,.85,.25+.7*(Math.sin(distance*.9)+1)/2);
    frame[y*W+x]=color;
  }
  draw();
}
function saveDraft(){
  project.name=$("projectName").value;
  project.frameMs=+$("frameMs").value;
  localStorage.setItem("ledDiffuserDraft",JSON.stringify(project));
}
function loadProject(next){
  if(!next||!Array.isArray(next.frames)||!next.frames.length)throw Error("Invalid project");
  next.frames=next.frames.slice(0,MAX_FRAMES).map(frame=>frame.slice(0,N));
  if(next.frames.some(frame=>frame.length!==N))throw Error("Every frame needs 280 colors");
  project=next;active=0;
  $("projectName").value=next.name||"Wall show";
  $("frameMs").value=next.frameMs||250;
  sync();draw();
}

document.querySelectorAll("[data-tool]").forEach(button=>{
  button.onclick=()=>{
    tool=button.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach(item=>item.classList.toggle("active",item===button));
  };
});
document.querySelectorAll("[data-preset]").forEach(button=>button.onclick=()=>preset(button.dataset.preset));
document.querySelectorAll(".tab").forEach(button=>{
  button.onclick=()=>{
    document.querySelectorAll(".tab").forEach(item=>item.classList.toggle("active",item===button));
    document.querySelectorAll(".pane").forEach(pane=>pane.hidden=pane.id!==button.dataset.pane);
  };
});
$("connect").onclick=connect;
$("connectUsb").onclick=connectUsb;
$("disconnect").onclick=disconnectTransport;
$("sendFrame").onclick=sendCurrent;
$("uploadShow").onclick=uploadShow;
$("clear").onclick=()=>{project.frames[active]=blank();draw()};
$("mirrorX").onclick=()=>mirror(false);
$("mirrorY").onclick=()=>mirror(true);
$("shiftL").onclick=()=>shift(-1,0);
$("shiftR").onclick=()=>shift(1,0);
$("addFrame").onclick=()=>{
  if(project.frames.length<MAX_FRAMES){
    project.frames.push(blank());active=project.frames.length-1;draw();
  }
};
$("cloneFrame").onclick=()=>{
  if(project.frames.length<MAX_FRAMES){
    project.frames.splice(active+1,0,[...project.frames[active]]);active++;draw();
  }
};
$("deleteFrame").onclick=()=>{
  if(project.frames.length>1){
    project.frames.splice(active,1);active=Math.min(active,project.frames.length-1);draw();
  }
};
$("moveFrame").onclick=()=>{
  if(active<project.frames.length-1){
    [project.frames[active],project.frames[active+1]]=[project.frames[active+1],project.frames[active]];
    active++;draw();
  }
};
$("frameMs").oninput=sync;
$("brightness").oninput=sync;
$("speed").oninput=sync;
$("newProject").onclick=()=>loadProject({name:"My wall show",frameMs:250,frames:[blank()]});
$("saveLocal").onclick=()=>{saveDraft();setStatus("Project saved in this browser",!!rx)};
$("exportProject").onclick=()=>$("projectJson").value=JSON.stringify(project);
$("importProject").onclick=()=>{
  try{loadProject(JSON.parse($("projectJson").value))}
  catch(error){setStatus(error.message,false,true)}
};
$("copyPrompt").onclick=async()=>navigator.clipboard.writeText($("aiPrompt").value);
$("sendVibe").onclick=async()=>{
  try{
    await transmit({
      mode:$("mode").value,direction:$("direction").value,text:$("text").value,
      brightness:+$("brightness").value,speed:+$("speed").value,
      hue:+$("hue").value,saturation:+$("saturation").value,motion:$("motion").checked
    });
    setStatus("Live vibe saved",true);
  }catch(error){setStatus(error.message,false,true)}
};
function sync(){
  $("frameMsValue").textContent=$("frameMs").value;
  $("brightnessValue").textContent=$("brightness").value;
  $("speedValue").textContent=$("speed").value;
  project.frameMs=+$("frameMs").value;
  saveDraft();
}
const colors=["#000000","#ffffff","#ff477e","#ff9f1c","#ffe66d","#8cff98","#38d9d6","#4d96ff","#9d8cff","#f06595","#7f5539","#90a4ae","#051937","#143642","#541388","#ff6b35"];
$("palette").innerHTML=colors.map(color=>'<span class="swatch" data-c="'+color+'" style="background:'+color+'"></span>').join("");
document.querySelectorAll(".swatch").forEach(swatch=>swatch.onclick=()=>$("color").value=swatch.dataset.c);
initGrid();
try{
  const saved=JSON.parse(localStorage.getItem("ledDiffuserDraft"));
  if(saved)loadProject(saved);else draw();
}catch(error){draw()}
sync();