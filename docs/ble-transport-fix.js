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
