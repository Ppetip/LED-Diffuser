const W=28,H=10,N=W*H,MAX_FRAMES=24;
const SERVICE="6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX="6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX="6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const $=id=>document.getElementById(id);
let device,rx,tx,serialPort,serialWriter,serialReader,serialReadTask,activeTransport=null,receiveBuffer="",replyWaiters=[],tool="brush",drawing=false,lastPainted=null,refreshTimer=null,active=0;
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
async function probeDeviceStatus(){
  let statusReply;
  for(let attempt=0;attempt<2&&!statusReply;attempt++){
    try{statusReply=await sendCommand({op:"get_status"},0,0,5000)}
    catch(error){if(!attempt)await new Promise(resolve=>setTimeout(resolve,500));else throw error}
  }
  if(statusReply?.firmware)appendTransportLog(`Firmware ${statusReply.firmware}, power cap ${statusReply.powerLimitMa||"?"} mA`);
  if($("powerProfile")?.value==="safe")await sendCommand({powerLimitMa:750},0,0,5000);
  return statusReply;
}

async function connect(){
  if(!navigator.bluetooth){setStatus("Web Bluetooth is unavailable here.",false,true);return}
  try{
    setStatus("Choose LED-Diffuser in the pairing window...");
    device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}],optionalServices:[SERVICE]});
    device.addEventListener("gattserverdisconnected",()=>{activeTransport=null;rejectPendingReplies("Bluetooth disconnected");appendTransportLog("Bluetooth disconnected","error");setConnected(false)});
    
    setStatus("Connecting to GATT server on LED-Diffuser...");
    const server=await device.gatt.connect();
    
    setStatus("Discovering Nordic UART Service...");
    const service=await server.getPrimaryService(SERVICE);
    
    setStatus("Locating RX and TX characteristics...");
    rx=await service.getCharacteristic(RX);
    tx=await service.getCharacteristic(TX);
    
    setStatus("Enabling status notifications...");
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged",event=>{
      handleDeviceChunk(new TextDecoder().decode(event.target.value));
    });
    
    activeTransport="ble";
    setConnected(true,device?.name||"Bluetooth");
    
    setStatus("Probing device configurations...");
    await probeDeviceStatus();
  }catch(error){setStatus(error.message||String(error),false,true)}
}
async function connectUsb(){
  if(!navigator.serial){setStatus("Web Serial requires Chrome or Edge on a computer.",false,true);return}
  try{
    serialPort=await navigator.serial.requestPort();
    await serialPort.open({baudRate:115200});
    await new Promise(resolve=>setTimeout(resolve,1800));
    serialWriter=serialPort.writable.getWriter();
    serialReadTask=readUsbLoop(serialPort);
    activeTransport="usb";
    setConnected(true,"USB");
    await probeDeviceStatus();
  }catch(error){setStatus(error.message||String(error),false,true)}
}
async function disconnectTransport(){
  try{
    if(device?.gatt?.connected)device.gatt.disconnect();
    if(serialWriter){serialWriter.releaseLock();serialWriter=null}
    if(serialReader){await serialReader.cancel()}
    if(serialReadTask){await serialReadTask;serialReadTask=null}
    if(serialPort){await serialPort.setSignals({dataTerminalReady:false,requestToSend:false});await serialPort.close();serialPort=null}
  }finally{activeTransport=null;rejectPendingReplies("Disconnected");setConnected(false)}
}
function appendTransportLog(message,level="info"){
  const log=$("transportLog");
  if(!log)return;
  const stamp=new Date().toLocaleTimeString();
  log.textContent+=`[${stamp}] ${level.toUpperCase()}: ${message}\n`;
  const lines=log.textContent.split("\n");
  if(lines.length>120)log.textContent=lines.slice(-120).join("\n");
  log.scrollTop=log.scrollHeight;
}
function rejectPendingReplies(reason){
  while(replyWaiters.length){
    const waiter=replyWaiters.shift();
    clearTimeout(waiter.timer);
    waiter.reject(Error(reason));
  }
}
function handleDeviceLine(line){
  line=line.trim();
  if(!line)return;
  appendTransportLog(line,line.includes("[ERROR]")?"error":"device");
  if(!line.startsWith("{"))return;
  try{
    const reply=JSON.parse(line);
    const waiter=replyWaiters.shift();
    if(waiter){
      clearTimeout(waiter.timer);
      waiter.resolve(reply);
    }
  }catch(error){
    appendTransportLog("Malformed JSON reply: "+error.message,"error");
  }
}
function handleDeviceChunk(text){
  receiveBuffer+=text;
  let newline;
  while((newline=receiveBuffer.indexOf("\n"))>=0){
    const line=receiveBuffer.slice(0,newline);
    receiveBuffer=receiveBuffer.slice(newline+1);
    handleDeviceLine(line);
  }
}
async function readUsbLoop(port){
  const reader=port.readable.getReader();
  serialReader=reader;
  const decoder=new TextDecoder();
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(value)handleDeviceChunk(decoder.decode(value,{stream:true}));
    }
  }catch(error){
    if(activeTransport==="usb"){
      appendTransportLog("USB read failed: "+error.message,"error");
      rejectPendingReplies("USB connection lost");
      setConnected(false);
    }
  }finally{
    try{reader.releaseLock()}catch(error){}
    if(serialReader===reader)serialReader=null;
  }
}
function waitForReply(timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    const waiter={resolve,reject,timer:null};
    waiter.timer=setTimeout(()=>{
      const index=replyWaiters.indexOf(waiter);
      if(index>=0)replyWaiters.splice(index,1);
      reject(Error("Device acknowledgement timed out"));
    },timeoutMs);
    replyWaiters.push(waiter);
  });
}
function setUploadProgress(value){
  $("progress").style.width=Math.max(0,Math.min(100,value))+"%";
}
async function transmit(payload,startPercent=0,endPercent=100){
  const bytes=new TextEncoder().encode(JSON.stringify(payload)+"\n");
  appendTransportLog(`Sending ${payload.op||payload.mode||"command"} (${bytes.length} bytes)`);
  if(activeTransport==="usb"){
    if(!serialWriter)throw Error("USB connection is not open");
    await serialWriter.write(bytes);
    setUploadProgress(endPercent);
  }else if(activeTransport==="ble"){
    if(!rx)throw Error("Bluetooth connection is not open");
    const chunkSize=20;
    for(let i=0;i<bytes.length;i+=chunkSize){
      const part=bytes.slice(i,i+chunkSize);
      await rx.writeValue(part);
      const fraction=Math.min(bytes.length,i+chunkSize)/bytes.length;
      setUploadProgress(startPercent+(endPercent-startPercent)*fraction);
    }
  }else throw Error("Connect Bluetooth or USB first");
}
async function sendCommand(payload,startPercent=0,endPercent=100,timeoutMs=12000){
  const replyPromise=waitForReply(timeoutMs);
  try{
    await transmit(payload,startPercent,endPercent);
  }catch(error){
    const waiter=replyWaiters.shift();
    if(waiter){clearTimeout(waiter.timer);waiter.reject(error)}
    throw error;
  }
  const reply=await replyPromise;
  if(!(reply.ok===1||reply.ok===true))throw Error(reply.error||"Device rejected command");
  return reply;
}
const NEUTRAL_ADJUSTMENTS={brightness:1,contrast:1,saturation:1,gamma:1,tint:"#ffffff",tintAmount:0};
let lastImportResult=null;
function ensureAdjustments(){
  if(!project.adjustments||typeof project.adjustments!=="object")project.adjustments={global:{...NEUTRAL_ADJUSTMENTS},perFrame:{}};
  if(!project.adjustments.global)project.adjustments.global={...NEUTRAL_ADJUSTMENTS};
  if(!project.adjustments.perFrame)project.adjustments.perFrame={};
}
function adjustmentForFrame(index){
  ensureAdjustments();
  return {...NEUTRAL_ADJUSTMENTS,...project.adjustments.global,...(project.adjustments.perFrame[index]||{})};
}
function effectiveFrame(index){
  return LEDCompiler.adjustFrame(project.frames[index],adjustmentForFrame(index));
}
function pixelsHex(frame){return frame.map(color=>color.slice(1)).join("")}
async function sendCurrent(){
  try{
    $("sendFrame").disabled=true;
    setStatus("Sending frame...");
    await sendCommand({brightness:+$("brightness").value,pixels:pixelsHex(effectiveFrame(active))},0,100,15000);
    setStatus("Frame confirmed by diffuser",true);
    appendTransportLog("Single frame accepted and saved");
  }catch(error){
    setStatus(error.message,false,true);
    appendTransportLog(error.message,"error");
  }finally{
    $("sendFrame").disabled=!activeTransport;
    setTimeout(()=>setUploadProgress(0),800);
  }
}
async function uploadShow(){
  const button=$("uploadShow");
  button.disabled=true;
  const totalSteps=project.frames.length+2;
  try{
    setUploadProgress(0);
    setStatus(`Starting ${project.frames.length}-frame upload...`);
    const begun=await sendCommand({
      op:"show_begin",
      count:project.frames.length,
      frameMs:project.frameMs,
      brightness:+$("brightness").value
    },0,100/totalSteps,15000);
    if(begun.op!=="begin"||begun.n!==project.frames.length){
      throw Error("Device firmware is outdated; flash protocol v2 before uploading shows");
    }
    for(let index=0;index<project.frames.length;index++){
      const startPercent=(index+1)*100/totalSteps;
      const endPercent=(index+2)*100/totalSteps;
      setStatus(`Uploading frame ${index+1} of ${project.frames.length}...`);
      let reply,lastError;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          reply=await sendCommand({
            op:"show_frame",
            index,
            pixels:pixelsHex(effectiveFrame(index))
          },startPercent,endPercent,20000);
          if(reply.i!==index)throw Error(`Wrong acknowledgement for frame ${index+1}`);
          lastError=null;
          break;
        }catch(error){
          lastError=error;
          appendTransportLog(`Frame ${index+1} attempt ${attempt} failed: ${error.message}`,"error");
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,150));
        }
      }
      if(lastError)throw Error(`Frame ${index+1} failed after 3 attempts: ${lastError.message}`);
      setStatus(`Frame ${index+1}/${project.frames.length} confirmed`,true);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    setStatus("Committing show...");
    const committed=await sendCommand({op:"show_commit"},(totalSteps-1)*100/totalSteps,100,20000);
    if(committed.done!==project.frames.length)throw Error("Commit frame count did not match");
    setStatus(`Show saved: ${project.frames.length} frames playing`,true);
    appendTransportLog(`COMMIT confirmed for ${project.frames.length} frames`);
  }catch(error){
    setStatus("Upload failed: "+error.message,false,true);
    appendTransportLog("Upload failed: "+error.message,"error");
    try{await sendCommand({op:"show_cancel"},0,0,5000)}catch(cancelError){}
  }finally{
    button.disabled=!activeTransport;
    setTimeout(()=>setUploadProgress(0),1200);
  }
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
  const visible=effectiveFrame(active);
  [...$("matrix").children].forEach((pixel,i)=>pixel.style.background=visible[i]);
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
    if(cell)cell.style.background=LEDCompiler.adjustFrame([next],adjustmentForFrame(active))[0];
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
    effectiveFrame(index).forEach((color,n)=>{
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
  ensureAdjustments();
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
$("clearTransportLog").onclick=()=>{$("transportLog").textContent=""};
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
function perFrameAdjustmentArray(){
  ensureAdjustments();
  return project.frames.map((_,index)=>project.adjustments.perFrame[index]?{...project.adjustments.perFrame[index]}:null);
}
function restorePerFrameAdjustments(values){
  project.adjustments.perFrame={};
  values.forEach((value,index)=>{if(value)project.adjustments.perFrame[index]=value});
}
$("cloneFrame").onclick=()=>{
  if(project.frames.length<MAX_FRAMES){
    const adjustments=perFrameAdjustmentArray(),copy=adjustments[active]?{...adjustments[active]}:null;
    project.frames.splice(active+1,0,[...project.frames[active]]);
    adjustments.splice(active+1,0,copy);
    restorePerFrameAdjustments(adjustments);
    active++;draw();
  }
};
$("deleteFrame").onclick=()=>{
  if(project.frames.length>1){
    const adjustments=perFrameAdjustmentArray();
    project.frames.splice(active,1);adjustments.splice(active,1);
    restorePerFrameAdjustments(adjustments);
    active=Math.min(active,project.frames.length-1);draw();
  }
};
$("moveFrame").onclick=()=>{
  if(active<project.frames.length-1){
    const adjustments=perFrameAdjustmentArray();
    [project.frames[active],project.frames[active+1]]=[project.frames[active+1],project.frames[active]];
    [adjustments[active],adjustments[active+1]]=[adjustments[active+1],adjustments[active]];
    restorePerFrameAdjustments(adjustments);
    active++;draw();
  }
};
$("frameMs").oninput=sync;
$("brightness").oninput=sync;
$("speed").oninput=sync;
$("newProject").onclick=()=>loadProject({name:"My wall show",frameMs:250,frames:[blank()]});
$("saveLocal").onclick=()=>{saveDraft();setStatus("Project saved in this browser",!!rx)};
function renderValidation(result){
  const panel=$("validationPanel");
  const errors=result?.errors||[],warnings=result?.warnings||[];
  const skipped=result?.skippedLayers||[];
  const section=(title,items,kind)=>items.length?`<div class="${kind}"><strong>${title} (${items.length})</strong><ul>${items.map(item=>`<li><code>${escapeHtml(item.path||"$")}</code>: ${escapeHtml(item.message)}</li>`).join("")}</ul></div>`:"";
  panel.innerHTML=`<strong>Validation</strong>${section("Errors",errors,"validation-errors")}${section("Warnings",warnings,"validation-warnings")}${skipped.length?`<p>Skipped layers: ${skipped.map(index=>index+1).join(", ")}</p>`:""}${!errors.length&&!warnings.length?"<p class='validation-ok'>Valid with no repairs.</p>":""}`;
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function downloadJson(name,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
$("exportProject").onclick=()=>$("projectJson").value=JSON.stringify(project,null,2);
$("importProject").onclick=()=>{
  try{
    const repaired=LEDCompiler.sanitizeJsonText($("projectJson").value);
    const parsed=JSON.parse(repaired);
    if(parsed&&Array.isArray(parsed.layers)&&parsed.schemaVersion!==2){
      const compiled=compileShow(parsed);
      loadProject(compiled);
      lastImportResult={repairedText:JSON.stringify(parsed,null,2),errors:[],warnings:[{path:"schemaVersion",message:"Legacy compiler used; add schemaVersion 2 for registry validation."}]};
      renderValidation(lastImportResult);
      setStatus("Legacy show compiled and loaded",true);
      return;
    }
    const result=LEDCompiler.importJson($("projectJson").value,{partial:true});
    lastImportResult=result;
    renderValidation(result);
    if(result.kind==="program"&&result.frames?.length){
      loadProject(result.project);
      setStatus(result.errors.length?`Compiled with ${result.errors.length} reported issue(s); valid layers loaded`:"Program validated, compiled, and loaded",true);
    }else if(["slideshow","single-slide","raw-frame"].includes(result.kind)&&!result.errors.length){
      loadProject(result.value);
      setStatus("Slideshow JSON imported",true);
    }else{
      throw Error(result.errors.map(item=>`${item.path}: ${item.message}`).join("; ")||"Nothing importable found");
    }
  }catch(error){
    let msg = error.message;
    if (msg.includes("JSON.parse") || msg.includes("Unexpected token") || msg.includes("is not valid JSON")) {
      const inputVal = $("projectJson").value || "";
      if (inputVal.includes("#include") || inputVal.includes("void setup") || inputVal.includes("void loop")) {
        msg = "C++ Firmware Detected: You pasted Arduino/C++ firmware code instead of animation JSON! Firmware must be flashed using VS Code or Arduino IDE.";
      } else {
        try {
          const repaired = LEDCompiler.sanitizeJsonText(inputVal);
          const snippet = repaired ? (repaired.substring(0, 180) + (repaired.length > 180 ? "..." : "")) : "(empty)";
          msg = `JSON parse failed: ${error.message}. Repaired preview: ${snippet}`;
        } catch (repairError) {
          msg = `JSON parse failed: ${error.message}. Repair failed: ${repairError.message}`;
        }
      }
    }
    setStatus(msg,false,true);
    renderValidation({errors:[{path:"$",message:msg}],warnings:[]});
  }
};
$("copyRepairedJson").onclick=async()=>{
  if(!lastImportResult)throw Error("Compile or import JSON first");
  const repaired=lastImportResult.program||lastImportResult.value||JSON.parse(lastImportResult.repairedText);
  await navigator.clipboard.writeText(JSON.stringify(repaired,null,2));
  setStatus("Repaired JSON copied",true);
};
$("exportSchema").onclick=()=>downloadJson("led-diffuser-schema-v2.json",{schemaVersion:2,width:28,height:10,blendModes:LEDCompiler.BLEND_MODES,blocks:LEDCompiler.schema()});
function refreshAiPrompt(){
  $("aiPrompt").value=LEDCompiler.buildAiPrompt($("aiPromptMode").value);
}
$("refreshPrompt").onclick=refreshAiPrompt;
$("aiPromptMode").onchange=refreshAiPrompt;
$("copyPrompt").onclick=async()=>navigator.clipboard.writeText($("aiPrompt").value);
$("sendVibe").onclick=async()=>{
  try{
    await sendCommand({
      mode:$("mode").value,direction:$("direction").value,font:$("font").value,text:$("text").value,
      brightness:+$("brightness").value,speed:+$("speed").value,
      hue:+$("hue").value,saturation:+$("saturation").value,motion:$("motion").checked
    });
    setStatus("Live vibe confirmed",true);
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

// === SHOW COMPILER ENGINE & FONTS ===
const FONT = [
  [0x7E,0x11,0x11,0x11,0x7E],[0x7F,0x49,0x49,0x49,0x36],
  [0x3E,0x41,0x41,0x41,0x22],[0x7F,0x41,0x41,0x22,0x1C],
  [0x7F,0x49,0x49,0x49,0x41],[0x7F,0x09,0x09,0x09,0x01],
  [0x3E,0x41,0x49,0x49,0x7A],[0x7F,0x08,0x08,0x08,0x7F],
  [0x00,0x41,0x7F,0x41,0x00],[0x20,0x40,0x41,0x3F,0x01],
  [0x7F,0x08,0x14,0x22,0x41],[0x7F,0x40,0x40,0x40,0x40],
  [0x7F,0x02,0x0C,0x02,0x7F],[0x7F,0x04,0x08,0x10,0x7F],
  [0x3E,0x41,0x41,0x41,0x3E],[0x7F,0x09,0x09,0x09,0x06],
  [0x3E,0x41,0x51,0x21,0x5E],[0x7F,0x09,0x19,0x29,0x46],
  [0x46,0x49,0x49,0x49,0x31],[0x01,0x01,0x7F,0x01,0x01],
  [0x3F,0x40,0x40,0x40,0x3F],[0x1F,0x20,0x40,0x20,0x1F],
  [0x3F,0x40,0x38,0x40,0x3F],[0x63,0x14,0x08,0x14,0x63],
  [0x07,0x08,0x70,0x08,0x07],[0x61,0x51,0x49,0x45,0x43]
];

const FONT_BOLD = [
  [0x7E,0x33,0x33,0x33,0x33,0x7E],[0xFF,0xFF,0xDB,0xDB,0xDB,0x66],
  [0x7E,0xFF,0xC3,0xC3,0xC3,0x42],[0xFF,0xFF,0xC3,0xC3,0xC3,0x7E],
  [0xFF,0xFF,0xDB,0xDB,0xDB,0xC3],[0xFF,0xFF,0x1B,0x1B,0x1B,0x03],
  [0x7E,0xFF,0xC3,0xDB,0xDB,0x7A],[0xFF,0xFF,0x18,0x18,0xFF,0xFF],
  [0xC3,0xC3,0xFF,0xFF,0xC3,0xC3],[0x70,0xF0,0xC0,0xC3,0xFF,0x7F],
  [0xFF,0xFF,0x3C,0x3C,0xC3,0xC3],[0xFF,0xFF,0xC0,0xC0,0xC0,0xC0],
  [0xFF,0xFF,0x06,0x0E,0xFF,0xFF],[0xFF,0xFF,0x1E,0x78,0xFF,0xFF],
  [0x7E,0xFF,0xC3,0xC3,0xFF,0x7E],[0xFF,0xFF,0x1B,0x1B,0x1B,0x06],
  [0x3E,0x7F,0x63,0xE3,0xFF,0xFE],[0xFF,0xFF,0x3B,0x7B,0xD3,0xA6],
  [0x46,0xCF,0xDB,0xDB,0xF3,0x72],[0x03,0x03,0xFF,0xFF,0x03,0x03],
  [0x7F,0xFF,0xC0,0xC0,0xFF,0x7F],[0x0F,0x3F,0xF0,0xF0,0x3F,0x0F],
  [0xFF,0xFF,0x70,0x70,0xFF,0xFF],[0xC3,0xE7,0x3C,0x3C,0xE7,0xC3],
  [0x03,0x07,0xFC,0xFC,0x07,0x03],[0xC3,0xE3,0xD3,0xCB,0xC7,0xC3],
  [0x7E,0xFF,0xC3,0xC3,0xFF,0x7E],[0xC2,0xC2,0xFF,0xFF,0xC0,0xC0],
  [0xE2,0xDB,0xDB,0xDB,0xDB,0xC6],[0xC3,0xC3,0xDB,0xDB,0xFF,0xFF],
  [0x1F,0x1F,0x18,0x18,0xFF,0xFF],[0x4F,0xDF,0xDB,0xDB,0xF3,0x73],
  [0x7E,0xFF,0xDB,0xDB,0xF3,0x72],[0x03,0x03,0xF3,0xFB,0xFF,0xFF],
  [0x66,0xFF,0xDB,0xDB,0xFF,0x66],[0x46,0xCF,0xDB,0xDB,0xFF,0x7E],
  [0x00,0x00,0x00,0x00,0x00,0x00]
];

function drawCharOnGrid(grid, c, x0, y0, color, isBold) {
  c = c.toUpperCase();
  if (isBold) {
    let idx = -1;
    if (c >= 'A' && c <= 'Z') idx = c.charCodeAt(0) - 65;
    else if (c >= '0' && c <= '9') idx = 26 + (c.charCodeAt(0) - 48);
    else if (c === ' ') idx = 36;
    if (idx !== -1 && idx < FONT_BOLD.length) {
      const glyph = FONT_BOLD[idx];
      for (let x = 0; x < 6; x++) {
        for (let y = 0; y < 8; y++) {
          if (glyph[x] & (1 << y)) {
            const px = x0 + x, py = y0 + y;
            if (px >= 0 && px < W && py >= 0 && py < H) {
              grid[py * W + px] = color;
            }
          }
        }
      }
    }
  } else {
    if (c < 'A' || c > 'Z') return;
    const idx = c.charCodeAt(0) - 65;
    const glyph = FONT[idx];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 7; y++) {
        if (glyph[x] & (1 << y)) {
          const px = x0 + x, py = y0 + y;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            grid[py * W + px] = color;
          }
        }
      }
    }
  }
}

function hslToHex(h, s, l) {
  h = (h % 360 + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  let c = (1 - Math.abs(2 * l - 1)) * s;
  let x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r, g, b) {
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  return "#" + [r, g, b].map(val => val.toString(16).padStart(2, "0")).join("");
}

function blendGrids(base, layer, blendMode, opacity) {
  const next = [];
  for (let i = 0; i < N; i++) {
    const b = hexToRgb(base[i]);
    const l = hexToRgb(layer[i]);
    let r = 0, g = 0, bl = 0;

    switch (blendMode) {
      case "add":
        r = b.r + l.r; g = b.g + l.g; bl = b.b + l.b;
        break;
      case "screen":
        r = 255 - ((255 - b.r) * (255 - l.r)) / 255;
        g = 255 - ((255 - b.g) * (255 - l.g)) / 255;
        bl = 255 - ((255 - b.b) * (255 - l.b)) / 255;
        break;
      case "multiply":
        r = (b.r * l.r) / 255;
        g = (b.g * l.g) / 255;
        bl = (b.b * l.b) / 255;
        break;
      case "overlay":
        r = b.r < 128 ? (2 * b.r * l.r) / 255 : 255 - (2 * (255 - b.r) * (255 - l.r)) / 255;
        g = b.g < 128 ? (2 * b.g * l.g) / 255 : 255 - (2 * (255 - b.g) * (255 - l.g)) / 255;
        bl = b.b < 128 ? (2 * b.b * l.b) / 255 : 255 - (2 * (255 - b.b) * (255 - l.b)) / 255;
        break;
      case "mask":
        if (l.r + l.g + l.b > 0) { r = b.r; g = b.g; bl = b.b; }
        else { r = 0; g = 0; bl = 0; }
        break;
      case "letter_fill":
        if (l.r + l.g + l.b > 0) { r = l.r; g = l.g; bl = l.b; }
        else { r = b.r; g = b.g; bl = b.b; }
        break;
      case "normal":
      default:
        r = l.r; g = l.g; bl = l.b;
        break;
    }

    r = b.r * (1 - opacity) + r * opacity;
    g = b.g * (1 - opacity) + g * opacity;
    bl = b.b * (1 - opacity) + bl * opacity;
    next.push(rgbToHex(r, g, bl));
  }
  return next;
}

function generateLayer(type, params, f, frameCount, t, timeMs) {
  const grid = Array(N).fill("#000000");

  switch (type) {
    case "solid": {
      const col = params.color || "#000000";
      grid.fill(col);
      break;
    }
    case "gradient": {
      const colors = params.colors || ["#ff0000", "#0000ff"];
      const angle = typeof params.angle === "number" ? params.angle : 0;
      const speed = typeof params.speed === "number" ? params.speed : 0;
      const rad = angle * Math.PI / 180;
      const dx = Math.cos(rad), dy = Math.sin(rad);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let dist = (x * dx + y * dy) / 20;
          let offset = dist + t * speed;
          offset = (offset % 1 + 1) % 1;
          const idx = Math.floor(offset * (colors.length - 1));
          const nextIdx = (idx + 1) % colors.length;
          const blendVal = (offset * (colors.length - 1)) % 1;
          const c1 = hexToRgb(colors[idx]);
          const c2 = hexToRgb(colors[nextIdx]);
          grid[y * W + x] = rgbToHex(
            c1.r * (1 - blendVal) + c2.r * blendVal,
            c1.g * (1 - blendVal) + c2.g * blendVal,
            c1.b * (1 - blendVal) + c2.b * blendVal
          );
        }
      }
      break;
    }
    case "radial_gradient": {
      const colors = params.colors || ["#ff0000", "#0000ff"];
      const cx = typeof params.cx === "number" ? params.cx : 13.5;
      const cy = typeof params.cy === "number" ? params.cy : 4.5;
      const radius = typeof params.radius === "number" ? params.radius : 10;
      const pulseSpeed = typeof params.pulseSpeed === "number" ? params.pulseSpeed : 0;
      const r = radius + Math.sin(timeMs * pulseSpeed * 0.005) * (radius * 0.3);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dist = Math.hypot(x - cx, y - cy);
          let offset = dist / Math.max(1, r);
          offset = Math.min(1, Math.max(0, offset));
          const idx = Math.floor(offset * (colors.length - 1));
          const nextIdx = (idx + 1) % colors.length;
          const blendVal = (offset * (colors.length - 1)) % 1;
          const c1 = hexToRgb(colors[idx]);
          const c2 = hexToRgb(colors[nextIdx]);
          grid[y * W + x] = rgbToHex(
            c1.r * (1 - blendVal) + c2.r * blendVal,
            c1.g * (1 - blendVal) + c2.g * blendVal,
            c1.b * (1 - blendVal) + c2.b * blendVal
          );
        }
      }
      break;
    }
    case "rainbow": {
      const angle = typeof params.angle === "number" ? params.angle : 0;
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const width = typeof params.width === "number" ? params.width : 14;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const rad = angle * Math.PI / 180;
          const d = (x * Math.cos(rad) + y * Math.sin(rad)) / width;
          const hue = ((d + t * speed) * 360) % 360;
          grid[y * W + x] = hslToHex(hue, 100, 50);
        }
      }
      break;
    }
    case "plasma": {
      const scale = typeof params.scale === "number" ? params.scale : 0.2;
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const baseHue = typeof params.hue === "number" ? params.hue : 200;
      const phase = timeMs * speed * 0.003;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const cx = x - 13.5, cy = y - 4.5;
          const v1 = Math.sin(x * scale + phase);
          const v2 = Math.sin(scale * (y * Math.sin(phase / 2) + x * Math.cos(phase / 3)) + phase);
          const v3 = Math.sin(Math.sqrt(cx*cx + cy*cy) * scale - phase);
          const v = (v1 + v2 + v3) / 3;
          const hue = (baseHue + (v + 1) * 180) % 360;
          grid[y * W + x] = hslToHex(hue, 90, 50);
        }
      }
      break;
    }
    case "rain": {
      const color = params.color || "#38d9d6";
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const tick = Math.floor(timeMs * speed * 0.008);
      const c = hexToRgb(color);
      for (let x = 0; x < W; x++) {
        const y = (tick + x * 7 + x * x) % (H + 4);
        if (y < H) grid[y * W + x] = color;
        if (y > 0 && y - 1 < H) grid[(y - 1) * W + x] = rgbToHex(c.r * 0.4, c.g * 0.4, c.b * 0.4);
      }
      break;
    }
    case "snow": {
      const color = params.color || "#ffffff";
      const speed = typeof params.speed === "number" ? params.speed : 0.5;
      const drift = Math.sin(t * Math.PI * 2) * 1.5;
      const tick = Math.floor(timeMs * speed * 0.005);
      for (let x = 0; x < W; x++) {
        const sx = (x + Math.floor(drift)) % W;
        const y = (tick + x * 5) % (H + 5);
        if (y < H) grid[y * W + (sx < 0 ? sx + W : sx)] = color;
      }
      break;
    }
    case "starfield": {
      const speed = typeof params.speed === "number" ? params.speed : 0.2;
      const count = typeof params.stars === "number" ? params.stars : 15;
      for (let i = 0; i < count; i++) {
        const sx = Math.floor(i * 7.7 + timeMs * speed * (1 + (i % 3) * 0.5)) % W;
        const sy = (i * 3) % H;
        const val = 120 + (i % 3) * 60;
        grid[sy * W + sx] = rgbToHex(val, val, val + 15);
      }
      break;
    }
    case "waves": {
      const color = params.color || "#4d96ff";
      const bg = params.bg || "#000000";
      const amp = typeof params.amplitude === "number" ? params.amplitude : 2;
      const freq = typeof params.frequency === "number" ? params.frequency : 0.3;
      const speed = typeof params.speed === "number" ? params.speed : 2.0;
      for (let x = 0; x < W; x++) {
        const waveY = 5 + Math.sin(x * freq + timeMs * speed * 0.005) * amp;
        for (let y = 0; y < H; y++) {
          grid[y * W + x] = y >= waveY ? color : bg;
        }
      }
      break;
    }
    case "fire": {
      const c1 = params.color1 || "#ff477e";
      const c2 = params.color2 || "#ffe66d";
      for (let x = 0; x < W; x++) {
        const heatBase = (Math.sin(x * 0.5 + timeMs * 0.01) + 1) * 0.5;
        for (let y = 0; y < H; y++) {
          let heat = heatBase * 0.5 + (1 - y / H) * 0.8;
          heat = Math.max(0, Math.min(1, heat));
          if (heat > 0.7) grid[y * W + x] = c2;
          else if (heat > 0.3) grid[y * W + x] = c1;
        }
      }
      break;
    }
    case "shapes": {
      const drawList = Array.isArray(params.draw) ? params.draw : [];
      for (const d of drawList) {
        const color = d.color || "#ffffff";
        if (d.type === "rect") {
          const rx = d.x || 0, ry = d.y || 0, rw = d.w || 1, rh = d.h || 1;
          for (let y = ry; y < ry + rh; y++) {
            for (let x = rx; x < rx + rw; x++) {
              if (x >= 0 && x < W && y >= 0 && y < H) {
                if (d.fill || x === rx || x === rx + rw - 1 || y === ry || y === ry + rh - 1) {
                  grid[y * W + x] = color;
                }
              }
            }
          }
        } else if (d.type === "circle") {
          const cx = d.cx || 0, cy = d.cy || 0, cr = d.r || 1;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const dist = Math.hypot(x - cx, y - cy);
              if (d.fill ? dist <= cr : Math.abs(dist - cr) < 0.5) {
                grid[y * W + x] = color;
              }
            }
          }
        } else if (d.type === "line") {
          let x0 = d.x0 || 0, y0 = d.y0 || 0, x1 = d.x1 || 0, y1 = d.y1 || 0;
          const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
          let err = dx + dy;
          while (true) {
            if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) grid[y0 * W + x0] = color;
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
          }
        }
      }
      break;
    }
    case "text": {
      const text = params.text || "OK";
      const isBold = params.font === "bold" || params.font === undefined;
      const color = params.color || "#ffffff";
      const scroll = params.scroll !== false;
      const direction = params.direction || "left";
      const speed = typeof params.speed === "number" ? params.speed : 100;
      const charSpacing = isBold ? 7 : 6;
      const charH = isBold ? 8 : 7;
      const lineHeight = isBold ? 9 : 8;
      const vertical = direction === "up" || direction === "down";

      if (scroll) {
        if (vertical) {
          const charsPerLine = 4;
          const lines = Math.ceil(text.length / charsPerLine);
          const totalHeight = lines * lineHeight;
          const cycle = H + totalHeight;
          const step = Math.floor(timeMs / speed) % cycle;
          const baseY = direction === "down" ? -totalHeight + step : H - step;

          for (let i = 0; i < text.length; i++) {
            const tx = 1 + (i % charsPerLine) * charSpacing;
            const ty = baseY + Math.floor(i / charsPerLine) * lineHeight;
            drawCharOnGrid(grid, text[i], tx, ty, color, isBold);
          }
        } else {
          const width = text.length * charSpacing;
          const cycle = W + width;
          const step = Math.floor(timeMs / speed) % cycle;
          const baseX = direction === "right" ? -width + step : W - step;
          const baseY = Math.floor((H - charH) / 2);

          for (let i = 0; i < text.length; i++) {
            drawCharOnGrid(grid, text[i], baseX + i * charSpacing, baseY, color, isBold);
          }
        }
      } else {
        const sx = typeof params.x === "number" ? params.x : 0;
        const sy = typeof params.y === "number" ? params.y : 0;
        for (let i = 0; i < text.length; i++) {
          drawCharOnGrid(grid, text[i], sx + i * charSpacing, sy, color, isBold);
        }
      }
      break;
    }
    case "cellular_automata": {
      let gof = Array(N).fill(0);
      const seedStr = params.seed || "random";
      for (let i = 0; i < N; i++) {
        let val = 0;
        if (seedStr === "glider") {
          val = [30, 59, 87, 88, 89].includes(i) ? 1 : 0;
        } else {
          let h = i * 163841 + f * 5342;
          val = (Math.abs(Math.sin(h)) * 100) % 2 > 1.2 ? 1 : 0;
        }
        gof[i] = val;
      }
      const steps = f % 6;
      const liveColor = params.color || "#8cff98";
      const deadColor = params.deadColor || "#000000";

      for (let s = 0; s < steps; s++) {
        const nextGof = [...gof];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            let neighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = (x + dx + W) % W;
                const ny = (y + dy + H) % H;
                if (gof[ny * W + nx]) neighbors++;
              }
            }
            const idx = y * W + x;
            if (gof[idx] === 1) {
              nextGof[idx] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
            } else {
              nextGof[idx] = (neighbors === 3) ? 1 : 0;
            }
          }
        }
        gof = nextGof;
      }

      for (let i = 0; i < N; i++) grid[i] = gof[i] ? liveColor : deadColor;
      break;
    }
    case "particles": {
      const count = typeof params.count === "number" ? params.count : 5;
      const color = params.color || "#ff9f1c";
      const grav = typeof params.gravity === "number" ? params.gravity : 0.1;
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      for (let i = 0; i < count; i++) {
        let px = 14, py = 5, vx = Math.cos(i * 1.3) * speed, vy = Math.sin(i * 1.3) * speed;
        const steps = f + 2;
        for (let s = 0; s < steps; s++) {
          px += vx;
          py += vy;
          vy += grav;
          if (px <= 0 || px >= W - 1) { vx = -vx; px = Math.max(0, Math.min(W - 1, px)); }
          if (py <= 0 || py >= H - 1) { vy = -vy * 0.8; py = Math.max(0, Math.min(H - 1, py)); }
        }
        grid[Math.floor(py) * W + Math.floor(px)] = color;
      }
      break;
    }
    case "street_scene": {
      const sky = params.skyColor || "#050512";
      const build = params.buildingColor || "#111422";
      const win = params.windowColor || "#ffe66d";
      const car = params.carColor || "#ff477e";
      grid.fill(sky);
      const heights = [5, 5, 6, 6, 7, 7, 5, 5, 8, 8, 8, 8, 6, 6, 7, 7, 4, 4, 6, 6, 5, 5, 7, 7, 7, 7, 5, 5];
      for (let x = 0; x < W; x++) {
        const h = heights[x];
        for (let y = H - h; y < H; y++) {
          grid[y * W + x] = build;
          if (y < H - 1 && y % 2 === 0 && x % 3 === 1) {
            let winSeed = x * 13 + y * 7;
            if ((Math.abs(Math.sin(winSeed)) * 10) % 2 > 0.8) grid[y * W + x] = win;
          }
        }
      }
      const carX = Math.floor(t * 36) % 36 - 4;
      if (carX >= 0 && carX < W) grid[9 * W + carX] = car;
      if (carX + 1 >= 0 && carX + 1 < W) grid[9 * W + carX + 1] = "#ffffff";
      break;
    }
    case "dial": {
      const val = typeof params.value === "number" ? params.value : 0.5;
      const angle = (1 - val) * Math.PI;
      const color = params.color || "#7ce7dd";
      const bg = params.bg || "#1e293b";
      const cx = 13.5, cy = 9.5;
      grid.fill(bg);
      const lx = cx + Math.cos(angle) * 8;
      const ly = cy - Math.sin(angle) * 8;
      let x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.floor(lx), y1 = Math.floor(ly);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      while (true) {
        if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) grid[y0 * W + x0] = color;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      break;
    }
    case "letter_fill": {
      const text = params.text || "OK";
      const isBold = params.font === "bold" || params.font === undefined;
      const fillType = params.fillType || "rainbow";
      const sx = typeof params.x === "number" ? params.x : 0;
      const sy = typeof params.y === "number" ? params.y : 0;
      const charSpacing = isBold ? 7 : 6;
      const textMask = Array(N).fill("#000000");
      for (let i = 0; i < text.length; i++) {
        drawCharOnGrid(textMask, text[i], sx + i * charSpacing, sy, "#ffffff", isBold);
      }
      const fillBg = generateLayer(fillType, params, f, frameCount, t, timeMs);
      for (let i = 0; i < N; i++) {
        grid[i] = textMask[i] !== "#000000" ? fillBg[i] : "#000000";
      }
      break;
    }
    case "clock": {
      const color = params.color || "#ff477e";
      const tick = f % 2 === 0 ? ":" : " ";
      const hour = "12", minute = "30";
      const timeStr = hour + tick + minute;
      const isBold = true;
      const charSpacing = 7;
      const baseX = Math.floor((W - timeStr.length * charSpacing) / 2) + 1;
      for (let i = 0; i < timeStr.length; i++) {
        drawCharOnGrid(grid, timeStr[i], baseX + i * charSpacing, 1, color, isBold);
      }
      break;
    }
    case "pacman": {
      const px = Math.floor(t * 36) % 36 - 8;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - px, dy = y - 4.5;
          if (dx * dx + dy * dy <= 12) {
            const isMouth = (f % 2 === 0) && (x >= px && Math.abs(dy) < (x - px + 0.5));
            grid[y * W + x] = isMouth ? "#000000" : "#ffe66d";
          }
        }
      }
      for (let dot = 4; dot < W; dot += 6) {
        if (dot > px) grid[5 * W + dot] = "#ffffff";
      }
      const gx = px - 8;
      if (gx >= -4 && gx < W) {
        for (let y = 3; y < 8; y++) {
          for (let x = gx - 1; x <= gx + 1; x++) {
            if (x >= 0 && x < W) grid[y * W + x] = "#ff477e";
          }
        }
      }
      break;
    }
    case "glitch": {
      const amount = typeof params.amount === "number" ? params.amount : 0.1;
      const scale = typeof params.shift === "number" ? params.shift : 3;
      const bg = generateLayer("rainbow", params, f, frameCount, t, timeMs);
      for (let y = 0; y < H; y++) {
        let shift = 0;
        let seed = y * 42 + f * 17;
        if ((Math.abs(Math.sin(seed)) * 10) % 2 < amount * 2) {
          shift = Math.floor(Math.sin(seed * 7) * scale);
        }
        for (let x = 0; x < W; x++) {
          const sx = (x - shift + W) % W;
          grid[y * W + x] = bg[y * W + sx];
        }
      }
      break;
    }
    case "fireworks": {
      const fx = 14, fy = H - 1 - (f * 1.5) % 6;
      if (f < 5) {
        grid[Math.floor(fy) * W + fx] = "#ffffff";
        if (fy + 1 < H) grid[Math.floor(fy + 1) * W + fx] = "#ffe66d";
      } else {
        const radius = (f - 4) * 1.2;
        const color = hslToHex(f * 48, 100, 50);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const d = Math.hypot(x - fx, y - (H - 7));
            if (Math.abs(d - radius) < 0.8) grid[y * W + x] = color;
          }
        }
      }
      break;
    }
    case "sand": {
      const color = params.color || "#ffe66d";
      let sandMap = Array(N).fill(0);
      for (let frameIndex = 0; frameIndex <= f; frameIndex++) {
        sandMap[0 * W + 13] = 1;
        sandMap[0 * W + 14] = 1;
        const nextMap = [...sandMap];
        for (let y = H - 2; y >= 0; y--) {
          for (let x = 0; x < W; x++) {
            if (sandMap[y * W + x] === 1) {
              if (sandMap[(y + 1) * W + x] === 0) {
                nextMap[y * W + x] = 0;
                nextMap[(y + 1) * W + x] = 1;
              } else {
                const leftEmpty = x > 0 && sandMap[(y + 1) * W + x - 1] === 0;
                const rightEmpty = x < W - 1 && sandMap[(y + 1) * W + x + 1] === 0;
                if (leftEmpty && rightEmpty) {
                  const dir = frameIndex % 2 === 0 ? -1 : 1;
                  nextMap[y * W + x] = 0;
                  nextMap[(y + 1) * W + x + dir] = 1;
                } else if (leftEmpty) {
                  nextMap[y * W + x] = 0;
                  nextMap[(y + 1) * W + x - 1] = 1;
                } else if (rightEmpty) {
                  nextMap[y * W + x] = 0;
                  nextMap[(y + 1) * W + x + 1] = 1;
                }
              }
            }
          }
        }
        sandMap = nextMap;
      }
      for (let i = 0; i < N; i++) grid[i] = sandMap[i] ? color : "#000000";
      break;
    }
    case "dna": {
      const c1 = params.color1 || "#ff477e";
      const c2 = params.color2 || "#7ce7dd";
      const rungs = params.rungsColor || "#30394a";
      for (let x = 0; x < W; x++) {
        const angle = x * 0.4 + t * Math.PI * 2;
        const y1 = Math.floor(5 + Math.sin(angle) * 3);
        const y2 = Math.floor(5 - Math.sin(angle) * 3);
        if (Math.abs(y1 - y2) > 1 && x % 2 === 0) {
          const start = Math.min(y1, y2), end = Math.max(y1, y2);
          for (let y = start; y <= end; y++) grid[y * W + x] = rungs;
        }
        grid[y1 * W + x] = c1;
        grid[y2 * W + x] = c2;
      }
      break;
    }
    case "kaleidoscope": {
      const base = generateLayer("plasma", params, f, frameCount, t, timeMs);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const mx = x < 14 ? x : 27 - x;
          const my = y < 5 ? y : 9 - y;
          grid[y * W + x] = base[my * W + mx];
        }
      }
      break;
    }
    case "radar": {
      const color = params.color || "#8cff98";
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const angle = t * speed * Math.PI * 2;
      const cx = 13.5, cy = 4.5;
      const rgb = hexToRgb(color);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ptAngle = Math.atan2(y - cy, x - cx) + Math.PI;
          let diff = (ptAngle - angle) % (Math.PI * 2);
          if (diff < 0) diff += Math.PI * 2;
          const intensity = Math.max(0, 1 - diff / 1.5);
          grid[y * W + x] = rgbToHex(rgb.r * intensity, rgb.g * intensity, rgb.b * intensity);
        }
      }
      break;
    }
    case "tunnel": {
      const color = params.color || "#9d8cff";
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const step = (t * speed * 4) % 4;
      const c = hexToRgb(color);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const distx = Math.abs(x - 13.5), disty = Math.abs(y - 4.5);
          const edge = Math.max(distx * 0.35, disty);
          const band = (edge - step + 12) % 4;
          if (band < 0.8) {
            const shadow = 1 - band / 0.8;
            grid[y * W + x] = rgbToHex(c.r * shadow, c.g * shadow, c.b * shadow);
          }
        }
      }
      break;
    }
    case "ripple": {
      const cx = 13.5, cy = 4.5;
      const speed = typeof params.speed === "number" ? params.speed : 1.5;
      const radius = t * speed * 12;
      const color = params.color || "#38d9d6";
      const rgb = hexToRgb(color);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - cx, y - cy);
          const diff = Math.abs(d - radius);
          if (diff < 1.5) {
            const intensity = Math.max(0, 1 - diff / 1.5) * (1 - radius / 12);
            grid[y * W + x] = rgbToHex(rgb.r * intensity, rgb.g * intensity, rgb.b * intensity);
          }
        }
      }
      break;
    }
    case "equalizer": {
      const color = params.color || "#ffe66d";
      const heights = [2, 5, 8, 4, 7, 3, 6];
      for (let bar = 0; bar < 7; bar++) {
        const pulse = Math.abs(Math.sin(f * 0.8 + bar * 0.4));
        const height = Math.floor(heights[bar] * pulse + 1);
        for (let x = bar * 4; x < bar * 4 + 4; x++) {
          for (let y = H - height; y < H; y++) {
            grid[y * W + x] = color;
          }
        }
      }
      break;
    }
    case "heartbeat": {
      const color = params.color || "#ff477e";
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 4)), 4) * 0.35;
      const scale = 1.0 + beat;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = (x - 13.5) / (12 * scale);
          const ny = (y - 4.5) / (5 * scale);
          const isHeart = Math.pow(nx*nx + ny*ny - 0.45, 3) - nx*nx*ny*ny*ny < 0;
          if (isHeart) grid[y * W + x] = color;
        }
      }
      break;
    }
    case "lighthouse": {
      const color = params.color || "#ffffff";
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const angle = t * speed * Math.PI * 2;
      const cx = 13.5, cy = 1.5;
      const c = hexToRgb(color);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ptAngle = Math.atan2(y - cy, x - cx);
          let diff = Math.abs(ptAngle - angle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < 0.25) {
            const intensity = 1 - diff / 0.25;
            grid[y * W + x] = rgbToHex(c.r * intensity, c.g * intensity, c.b * intensity);
          }
        }
      }
      grid[1 * W + 13] = "#ff9f1c";
      grid[1 * W + 14] = "#ff9f1c";
      break;
    }
    case "sunset": {
      const speed = typeof params.speed === "number" ? params.speed : 1.0;
      const sunY = 1.5 + t * speed * 7.5;
      for (let y = 0; y < H; y++) {
        const bgHue = (20 + (y / H) * 35) % 360;
        const skyCol = hslToHex(bgHue, 100, 20 + (1 - y/H)*35);
        for (let x = 0; x < W; x++) {
          const dist = Math.hypot(x - 13.5, y - sunY);
          if (dist < 3.2) {
            grid[y * W + x] = "#ffe66d";
          } else {
            grid[y * W + x] = skyCol;
          }
        }
      }
      break;
    }
    case "strobe": {
      const freq = typeof params.frequency === "number" ? params.frequency : 2.0;
      const color = params.color || "#ffffff";
      const on = Math.floor(t * freq * 2) % 2 === 0;
      if (on) grid.fill(color);
      break;
    }
  }

  return grid;
}

function compileShow(spec) {
  if (!spec || typeof spec !== "object") throw Error("Invalid specification JSON");
  const frameCount = Math.min(Math.max(parseInt(spec.frameCount) || 16, 1), 24);
  const frameMs = Math.min(Math.max(parseInt(spec.frameMs) || 250, 50), 5000);
  const layers = Array.isArray(spec.layers) ? spec.layers : [];

  const compiledFrames = [];
  for (let f = 0; f < frameCount; f++) {
    let grid = Array(N).fill("#000000");
    const t = f / frameCount;
    const timeMs = f * frameMs;

    for (const layer of layers) {
      if (!layer || typeof layer !== "object") continue;
      const type = layer.type || "solid";
      const opacity = typeof layer.opacity === "number" ? Math.max(0, Math.min(1, layer.opacity)) : 1.0;
      const blend = layer.blend || "normal";
      const params = layer.params || {};

      const layerGrid = generateLayer(type, params, f, frameCount, t, timeMs);
      grid = blendGrids(grid, layerGrid, blend, opacity);
    }
    compiledFrames.push(grid);
  }

  return {
    name: spec.name || "Compiled Show",
    frameMs: frameMs,
    frames: compiledFrames
  };
}

function renderBlockBrowser(query=""){
  const browser=$("blockBrowser");
  const normalized=query.trim().toLowerCase();
  const entries=Object.entries(LEDCompiler.registry).filter(([type,definition])=>{
    const haystack=[type,definition.category,definition.description,...Object.keys(definition.params)].join(" ").toLowerCase();
    return !normalized||haystack.includes(normalized);
  });
  browser.innerHTML=entries.map(([type,definition])=>{
    const parameters=Object.entries(definition.params).map(([name,schema])=>{
      const limits=schema.values?` [${schema.values.join("|")}]`:schema.min!=null?` [${schema.min}..${schema.max}]`:"";
      const coordinates=schema.coordinate?` (${schema.coordinate})`:"";
      return `<li title="${escapeHtml(JSON.stringify(schema))}"><code>${escapeHtml(name)}</code>: ${schema.type}${limits}${coordinates}</li>`;
    }).join("");
    return `<article class="block-card"><header><strong>${escapeHtml(type)}</strong><span>${escapeHtml(definition.category)}</span></header><p>${escapeHtml(definition.description)}</p><ul>${parameters}</ul><button type="button" data-insert-block="${escapeHtml(type)}">Insert example</button></article>`;
  }).join("")||"<p class='note'>No matching blocks.</p>";
  browser.querySelectorAll("[data-insert-block]").forEach(button=>button.onclick=()=>insertBlockExample(button.dataset.insertBlock));
}
function insertBlockExample(type){
  const definition=LEDCompiler.registry[type];
  let program;
  try{
    const parsed=JSON.parse(LEDCompiler.sanitizeJsonText($("projectJson").value));
    program=parsed?.schemaVersion===2&&Array.isArray(parsed.layers)?parsed:null;
  }catch(error){}
  if(!program)program={schemaVersion:2,name:"Custom LED Program",width:28,height:10,frameMs:100,frameCount:12,brightness:1,layers:[]};
  program.layers.push({id:`${type}-${program.layers.length+1}`,type,enabled:true,opacity:1,blend:"normal",params:structuredClone(definition.example)});
  $("projectJson").value=JSON.stringify(program,null,2);
  setStatus(`Inserted ${type} example`,true);
}
$("blockSearch").oninput=event=>renderBlockBrowser(event.target.value);
function adjustmentValues(){
  return {
    brightness:+$("adjustBrightness").value,
    contrast:+$("adjustContrast").value,
    saturation:+$("adjustSaturation").value,
    gamma:+$("adjustGamma").value,
    tint:"#ffffff",
    tintAmount:0
  };
}
function drawAdjustmentCanvas(canvas,frame){
  const context=canvas.getContext("2d");
  frame.forEach((color,index)=>{
    context.fillStyle=color;
    context.fillRect((index%W)*10,Math.floor(index/W)*10,10,10);
  });
}
function refreshAdjustmentPreview(){
  const values=adjustmentValues();
  $("adjustBrightnessValue").textContent=values.brightness.toFixed(2)+"×";
  $("adjustContrastValue").textContent=values.contrast.toFixed(2)+"×";
  $("adjustSaturationValue").textContent=values.saturation.toFixed(2)+"×";
  $("adjustGammaValue").textContent=values.gamma.toFixed(2);
  drawAdjustmentCanvas($("adjustBefore"),project.frames[active]);
  drawAdjustmentCanvas($("adjustAfter"),LEDCompiler.adjustFrame(project.frames[active],values));
}
function selectedAdjustmentFrames(){
  const scope=$("adjustScope").value;
  if(scope==="all")return project.frames.map((_,index)=>index);
  if(scope==="current")return[active];
  const indexes=new Set();
  for(const part of $("selectedSlides").value.split(",")){
    const match=part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if(!match)continue;
    let start=+match[1],end=+(match[2]||match[1]);
    if(start>end)[start,end]=[end,start];
    for(let value=start;value<=end;value++)if(value>=1&&value<=project.frames.length)indexes.add(value-1);
  }
  if(!indexes.size)throw Error("Enter at least one valid selected slide number");
  return[...indexes];
}
$("openAdjustments").onclick=()=>{
  ensureAdjustments();
  for(const [id,value] of [["adjustBrightness",1],["adjustContrast",1],["adjustSaturation",1],["adjustGamma",1]])$(id).value=value;
  $("adjustScope").value="all";
  $("selectedSlidesLabel").hidden=true;
  $("adjustBake").checked=false;
  refreshAdjustmentPreview();
  $("adjustmentDialog").showModal();
};
["adjustBrightness","adjustContrast","adjustSaturation","adjustGamma"].forEach(id=>$(id).oninput=refreshAdjustmentPreview);
$("adjustScope").onchange=()=>$("selectedSlidesLabel").hidden=$("adjustScope").value!=="selected";
$("applyAdjustments").onclick=()=>{
  try{
    const values=adjustmentValues(),indexes=selectedAdjustmentFrames();
    ensureAdjustments();
    if($("adjustBake").checked){
      if(!project.adjustmentBackup)project.adjustmentBackup=project.frames.map(frame=>[...frame]);
      indexes.forEach(index=>{
        project.frames[index]=LEDCompiler.adjustFrame(project.frames[index],values);
        delete project.adjustments.perFrame[index];
      });
    }else if($("adjustScope").value==="all"){
      project.adjustments.global={...values};
    }else{
      indexes.forEach(index=>project.adjustments.perFrame[index]={...values});
    }
    draw();
    $("adjustmentDialog").close();
    setStatus(`Adjustments applied to ${indexes.length} slide(s)`,true);
  }catch(error){setStatus(error.message,false,true)}
};
$("resetAdjustments").onclick=()=>{
  if(project.adjustmentBackup){
    project.frames=project.adjustmentBackup.map(frame=>[...frame]);
    delete project.adjustmentBackup;
  }
  project.adjustments={global:{...NEUTRAL_ADJUSTMENTS},perFrame:{}};
  draw();
  refreshAdjustmentPreview();
  setStatus("Slideshow adjustments reset",true);
};
const JSON_TEMPLATES = {
  midnight_skyline: {
    schemaVersion: 2,
    name: "Midnight Skyline Glow",
    width: 28,
    height: 10,
    frameMs: 120,
    frameCount: 16,
    brightness: 1,
    layers: [
      {id:"sky",type:"gradient",enabled:true,opacity:1,blend:"normal",params:{color1:"#020617",color2:"#312e81",direction:"vertical"}},
      {id:"stars",type:"stars",enabled:true,opacity:0.85,blend:"screen",params:{count:18,color:"#ffffff",seed:"midnight",twinkle:true}},
      {id:"tower-left",type:"rectangle",enabled:true,opacity:1,blend:"normal",params:{x:1,y:5,width:7,height:5,color:"#111827",filled:true}},
      {id:"tower-center",type:"rectangle",enabled:true,opacity:1,blend:"normal",params:{x:10,y:3,width:8,height:7,color:"#0f172a",filled:true}},
      {id:"tower-right",type:"rectangle",enabled:true,opacity:1,blend:"normal",params:{x:20,y:6,width:7,height:4,color:"#111827",filled:true}},
      {id:"windows-left",type:"windows",enabled:true,opacity:1,blend:"add",params:{x:2,y:6,columns:3,rows:2,spacingX:2,spacingY:2,color:"#ffe66d",litChance:0.75,seed:"left"}},
      {id:"windows-center",type:"windows",enabled:true,opacity:1,blend:"add",params:{x:11,y:4,columns:3,rows:3,spacingX:2,spacingY:2,color:"#ff9f1c",litChance:0.7,seed:"center"}},
      {id:"moon",type:"moon",enabled:true,opacity:1,blend:"screen",params:{cx:23,cy:2,radius:2.5,cutout:1.5,color:"#dce7f5"}},
      {id:"glow",type:"gamma",enabled:true,opacity:1,blend:"normal",params:{amount:1.2}}
    ]
  },
  cyberpunk_rain: {
    name: "Cyberpunk Rain",
    frameMs: 100,
    frameCount: 24,
    layers: [
      {
        type: "rain",
        blend: "normal",
        opacity: 0.9,
        params: {
          color: "#38d9d6",
          speed: 1.2
        }
      },
      {
        type: "text",
        blend: "add",
        opacity: 0.85,
        params: {
          text: "NEON",
          font: "bold",
          color: "#ff477e",
          scroll: true,
          direction: "down",
          speed: 120
        }
      }
    ]
  },
  city_sunset: {
    name: "Warm City Sunset",
    frameMs: 200,
    frameCount: 16,
    layers: [
      {
        type: "sunset",
        blend: "normal",
        opacity: 1.0,
        params: {
          speed: 0.8
        }
      },
      {
        type: "street_scene",
        blend: "overlay",
        opacity: 0.9,
        params: {
          skyColor: "#050512",
          buildingColor: "#111422",
          windowColor: "#ffe66d",
          carColor: "#ff477e"
        }
      }
    ]
  },
  neon_waves: {
    name: "Pulsing Neon Waves",
    frameMs: 150,
    frameCount: 20,
    layers: [
      {
        type: "waves",
        blend: "normal",
        opacity: 1.0,
        params: {
          color: "#4d96ff",
          bg: "#0f172a",
          amplitude: 3,
          frequency: 0.25,
          speed: 2.5
        }
      },
      {
        type: "radial_gradient",
        blend: "screen",
        opacity: 0.7,
        params: {
          colors: ["#ff477e", "#000000"],
          cx: 13.5,
          cy: 4.5,
          radius: 8,
          pulseSpeed: 1.5
        }
      }
    ]
  },
  twinkle_dna: {
    name: "Double Helix Starfield",
    frameMs: 120,
    frameCount: 16,
    layers: [
      {
        type: "starfield",
        blend: "normal",
        opacity: 0.4,
        params: {
          stars: 12,
          speed: 0.15
        }
      },
      {
        type: "dna",
        blend: "add",
        opacity: 1.0,
        params: {
          color1: "#ff477e",
          color2: "#7ce7dd",
          rungsColor: "#1e293b"
        }
      }
    ]
  },
  pacman_retro: {
    name: "Pacman Retro Loop",
    frameMs: 150,
    frameCount: 24,
    layers: [
      {
        type: "pacman",
        blend: "normal",
        opacity: 1.0,
        params: {}
      }
    ]
  },
  glitch_strobe: {
    name: "Hypnotic Glitch Strobe",
    frameMs: 100,
    frameCount: 12,
    layers: [
      {
        type: "strobe",
        blend: "normal",
        opacity: 0.3,
        params: {
          frequency: 3.0,
          color: "#9d8cff"
        }
      },
      {
        type: "glitch",
        blend: "screen",
        opacity: 0.9,
        params: {
          amount: 0.15,
          shift: 4
        }
      }
    ]
  }
};

if(Array.isArray(window.LED_TEMPLATE_CATALOG)){
  for(const item of window.LED_TEMPLATE_CATALOG){
    JSON_TEMPLATES[item.id]=item.program;
    if(!$("jsonTemplate").querySelector(`option[value="${item.id}"]`)){
      const option=document.createElement("option");
      option.value=item.id;option.textContent=`${item.category}: ${item.name}`;
      $("jsonTemplate").append(option);
    }
  }
}

$("jsonTemplate").onchange = (e) => {
  const key = e.target.value;
  if (key && JSON_TEMPLATES[key]) {
    $("projectJson").value = JSON.stringify(JSON_TEMPLATES[key], null, 2);
  }
};

renderBlockBrowser();
refreshAiPrompt();
try{
  const saved=JSON.parse(localStorage.getItem("ledDiffuserDraft"));
  if(saved)loadProject(saved);else draw();
}catch(error){draw()}
sync();
