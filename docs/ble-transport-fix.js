// Phone/Chromium BLE reliability shim for LED Diffuser Studio.
// Loaded after app.js so it can reuse the existing UI, compiler, and project code.
(()=>{
  const BLE_CHUNK_SIZE=20;
  const BLE_CHUNK_DELAY_MS=10;
  const CONNECT_TIMEOUT_MS=12000;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const cleanError=error=>{
    const text=error?.message||String(error);
    if(/User cancelled|No device selected/i.test(text))return "No device selected.";
    if(/GATT Server is disconnected|NetworkError/i.test(text))return "Bluetooth link dropped. Turn the diffuser off/on, wait 5 seconds, then connect again.";
    if(/timeout|timed out/i.test(text))return "Bluetooth timed out. Keep the phone close, power-cycle the diffuser, then reconnect.";
    return text;
  };
  const withTimeout=(promise,ms,label)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`${label} timed out`)),ms);
    promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});
  });
  const log=(message,level="info")=>{
    try{appendTransportLog(message,level)}catch(error){console.log(message)}
  };
  async function requestLedDevice(){
    return navigator.bluetooth.requestDevice({
      filters:[{namePrefix:"LED-Diffuser"},{services:[SERVICE]}],
      optionalServices:[SERVICE]
    });
  }
  async function connectFixed(){
    if(!navigator.bluetooth){
      setStatus("Web Bluetooth is unavailable here. Use Android Chrome/Edge, desktop Chrome/Edge, or the diffuser Wi-Fi page.",false,true);
      return;
    }
    try{
      activeTransport=null;
      receiveBuffer="";
      rejectPendingReplies("Starting new Bluetooth connection");
      if(device?.gatt?.connected)device.gatt.disconnect();
      rx=null;tx=null;
      setConnected(false);
      setStatus("Choose LED-Diffuser in the Bluetooth picker...");
      device=await requestLedDevice();
      device.addEventListener("gattserverdisconnected",()=>{
        activeTransport=null;
        receiveBuffer="";
        rejectPendingReplies("Bluetooth disconnected");
        log("Bluetooth disconnected","error");
        setConnected(false);
      },{once:false});
      setStatus("Connecting to LED-Diffuser...");
      const server=await withTimeout(device.gatt.connect(),CONNECT_TIMEOUT_MS,"Bluetooth connect");
      setStatus("Finding LED control service...");
      const service=await withTimeout(server.getPrimaryService(SERVICE),CONNECT_TIMEOUT_MS,"Service discovery");
      setStatus("Opening LED write/notify channels...");
      rx=await withTimeout(service.getCharacteristic(RX),CONNECT_TIMEOUT_MS,"RX characteristic");
      tx=await withTimeout(service.getCharacteristic(TX),CONNECT_TIMEOUT_MS,"TX characteristic");
      tx.addEventListener("characteristicvaluechanged",event=>{
        handleDeviceChunk(new TextDecoder().decode(event.target.value));
      });
      await withTimeout(tx.startNotifications(),CONNECT_TIMEOUT_MS,"Notifications");
      activeTransport="ble";
      setConnected(true,device?.name||"Bluetooth");
      setStatus("Bluetooth connected. Try Send live vibe first, then Show this frame.",true);
      log("BLE fix loaded: slower chunking, connection reset, name/service picker fallback, and longer ack timeouts.");
    }catch(error){
      activeTransport=null;
      receiveBuffer="";
      rx=null;tx=null;
      setConnected(false);
      const message=cleanError(error);
      setStatus(message,false,true);
      log(message,"error");
      try{if(device?.gatt?.connected)device.gatt.disconnect()}catch(disconnectError){}
    }
  }
  async function writeBleChunk(part){
    if(rx?.properties?.write&&rx.writeValueWithResponse){
      await rx.writeValueWithResponse(part);
    }else if(rx?.properties?.writeWithoutResponse&&rx.writeValueWithoutResponse){
      await rx.writeValueWithoutResponse(part);
      await sleep(BLE_CHUNK_DELAY_MS);
    }else{
      await rx.writeValue(part);
    }
  }
  async function transmitFixed(payload,startPercent=0,endPercent=100){
    const bytes=new TextEncoder().encode(JSON.stringify(payload)+"\n");
    log(`Sending ${payload.op||payload.mode||"command"} (${bytes.length} bytes)`);
    if(activeTransport==="usb"){
      if(!serialWriter)throw Error("USB connection is not open");
      await serialWriter.write(bytes);
      setUploadProgress(endPercent);
      return;
    }
    if(activeTransport!=="ble")throw Error("Connect Bluetooth or USB first");
    if(!rx||!device?.gatt?.connected)throw Error("Bluetooth connection is not open");
    for(let i=0;i<bytes.length;i+=BLE_CHUNK_SIZE){
      const part=bytes.slice(i,i+BLE_CHUNK_SIZE);
      await writeBleChunk(part);
      const fraction=Math.min(bytes.length,i+BLE_CHUNK_SIZE)/bytes.length;
      setUploadProgress(startPercent+(endPercent-startPercent)*fraction);
      await sleep(BLE_CHUNK_DELAY_MS);
    }
  }
  async function sendCommandFixed(payload,startPercent=0,endPercent=100,timeoutMs=12000){
    const bytes=new TextEncoder().encode(JSON.stringify(payload)+"\n").length;
    const effectiveTimeout=activeTransport==="ble"?Math.max(timeoutMs,Math.min(90000,8000+bytes*18)):timeoutMs;
    const replyPromise=waitForReply(effectiveTimeout);
    try{
      await transmitFixed(payload,startPercent,endPercent);
    }catch(error){
      const waiter=replyWaiters.shift();
      if(waiter){clearTimeout(waiter.timer);waiter.reject(error)}
      throw error;
    }
    const reply=await replyPromise;
    if(!(reply.ok===1||reply.ok===true))throw Error(reply.error||"Device rejected command");
    return reply;
  }
  connect=connectFixed;
  transmit=transmitFixed;
  sendCommand=sendCommandFixed;
  const bind=()=>{
    const connectButton=$("connect");
    if(connectButton)connectButton.onclick=connectFixed;
    log("BLE phone timeout patch active.");
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});
  else bind();
})();

// Forgiving importer for AI-generated LED program JSON.
(()=>{
  const get=id=>document.getElementById(id);
  function stripComments(text){
    let out="",inString=false,quote="",escaped=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(inString){out+=c;if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c===quote)inString=false;continue}
      if(c==='"'||c==="'"){inString=true;quote=c;out+=c;continue}
      if(c==="/"&&n==="/"){while(i<text.length&&text[i]!=="\n")i++;out+="\n";continue}
      if(c==="/"&&n==="*"){i+=2;while(i<text.length&&!(text[i]==="*"&&text[i+1]==="/"))i++;i++;continue}
      out+=c;
    }
    return out;
  }
  function findJsonSlice(text){
    const firstObject=text.indexOf("{"),firstArray=text.indexOf("[");
    const start=firstObject<0?firstArray:firstArray<0?firstObject:Math.min(firstObject,firstArray);
    if(start<0)return text.trim();
    let inString=false,quote="",escaped=false,depth=0;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(inString){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c===quote)inString=false;continue}
      if(c==='"'||c==="'"){inString=true;quote=c;continue}
      if(c==="{"||c==="[")depth++;
      if(c==="}"||c==="]"){depth--;if(depth===0)return text.slice(start,i+1)}
    }
    return text.slice(start).trim();
  }
  function repairJsonText(input){
    let text=String(input||"")
      .replace(/^\uFEFF/,"")
      .replace(/[“”]/g,'"')
      .replace(/[‘’]/g,"'")
      .replace(/^\s*```[a-zA-Z0-9_-]*\s*/i,"")
      .replace(/```\s*$/i,"")
      .trim();
    text=text.replace(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/i,"");
    text=text.replace(/^\s*(?:export\s+default\s+)/i,"");
    text=stripComments(text);
    text=findJsonSlice(text);
    text=text.replace(/([,{]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,'$1"$2"$3');
    text=text.replace(/,\s*([}\]])/g,"$1");
    return text.trim();
  }
  function looksLikeFirmware(text){
    return /#include\s*<|void\s+setup\s*\(|void\s+loop\s*\(|FastLED\.addLeds|NimBLEDevice::init|Arduino\.h/.test(text);
  }
  function showValidation(result){
    if(typeof renderValidation==="function")renderValidation(result);
    else if(get("validationPanel"))get("validationPanel").textContent=(result.errors||[]).map(e=>`${e.path}: ${e.message}`).join("\n")||"Valid.";
  }
  function installJsonImportFix(){
    const button=get("importProject");
    if(!button||!window.LEDCompiler)return;
    button.onclick=()=>{
      const raw=get("projectJson")?.value||"";
      try{
        if(!raw.trim())throw Error("Paste a JSON program first.");
        if(looksLikeFirmware(raw))throw Error("This box is for LED program JSON, not Arduino/C++ firmware. Upload firmware through Arduino IDE/PlatformIO, or paste a JSON object with schemaVersion 2 here.");
        const repaired=repairJsonText(raw);
        let parsed;
        try{parsed=JSON.parse(repaired)}catch(error){
          const preview=repaired.slice(0,220).replace(/\s+/g," ");
          throw Error(`JSON parse failed: ${error.message}. First repaired text: ${preview}${repaired.length>220?"...":""}`);
        }
        const result=LEDCompiler.importJson(JSON.stringify(parsed),{partial:true});
        showValidation(result);
        if(result.kind==="program"&&result.frames?.length){
          loadProject(result.project);
          get("projectJson").value=JSON.stringify(result.program||parsed,null,2);
          setStatus(result.errors?.length?`Loaded usable layers, but ${result.errors.length} issue(s) were repaired/skipped.`:"JSON imported and loaded.",true);
          return;
        }
        if(["slideshow","single-slide","raw-frame"].includes(result.kind)&&!result.errors.length){
          loadProject(result.value);
          get("projectJson").value=JSON.stringify(result.value,null,2);
          setStatus("Slideshow JSON imported.",true);
          return;
        }
        throw Error((result.errors||[]).map(item=>`${item.path}: ${item.message}`).join("; ")||"Nothing importable found.");
      }catch(error){
        const result={kind:"invalid",value:null,warnings:[],errors:[{path:"$",message:error.message}]};
        showValidation(result);
        setStatus(error.message,false,true);
      }
    };
    try{appendTransportLog("JSON import repair patch active.")}catch(error){}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installJsonImportFix,{once:true});
  else installJsonImportFix();
})();
