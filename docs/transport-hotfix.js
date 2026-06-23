(function(){
  "use strict";
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  transmit=async function(payload,startPercent=0,endPercent=100){
    const bytes=new TextEncoder().encode(JSON.stringify(payload)+"\n");
    appendTransportLog(`Sending ${payload.op||payload.mode||"command"} (${bytes.length} bytes, 20-byte BLE chunks)`);
    if(activeTransport==="usb"){
      if(!serialWriter)throw Error("USB connection is not open");
      await serialWriter.write(bytes);
      setUploadProgress(endPercent);
      return;
    }
    if(activeTransport==="ble"){
      if(!rx)throw Error("Bluetooth connection is not open");
      const chunkSize=20;
      for(let i=0;i<bytes.length;i+=chunkSize){
        const part=bytes.slice(i,i+chunkSize);
        if(rx.writeValueWithResponse)await rx.writeValueWithResponse(part);
        else await rx.writeValue(part);
        const fraction=Math.min(bytes.length,i+chunkSize)/bytes.length;
        setUploadProgress(startPercent+(endPercent-startPercent)*fraction);
        await sleep(25);
      }
      return;
    }
    throw Error("Connect Bluetooth or USB first");
  };
  async function sendFrameAsOneFrameShow(){
    const button=document.getElementById("sendFrame");
    if(button)button.disabled=true;
    try{
      setUploadProgress(0);
      setStatus("Sending current frame...");
      const frameMs=Math.max(50,Math.min(5000,+(document.getElementById("frameMs")?.value||250)));
      const brightness=+(document.getElementById("brightness")?.value||35);
      const pixels=pixelsHex(effectiveFrame(active));
      const begin=await sendCommand({op:"show_begin",count:1,frameMs,brightness},0,25,15000);
      if(begin.op!=="begin"||begin.n!==1)throw Error("frame begin was not accepted");
      const frame=await sendCommand({op:"show_frame",index:0,pixels},25,75,25000);
      if(frame.i!==0)throw Error("frame was not acknowledged");
      const done=await sendCommand({op:"show_commit"},75,100,25000);
      if(done.done!==1)throw Error("frame was not committed");
      setStatus("Frame uploaded and playing",true);
      appendTransportLog("Single frame sent through upload flow.");
    }catch(error){
      setStatus("Show frame failed: "+error.message,false,true);
      appendTransportLog("Show frame failed: "+error.message,"error");
      try{await sendCommand({op:"show_cancel"},0,0,5000)}catch(e){}
    }finally{
      if(button)button.disabled=!activeTransport;
      setTimeout(()=>setUploadProgress(0),1200);
    }
  }
  function installFrameButtonFix(){
    const button=document.getElementById("sendFrame");
    if(button){
      button.onclick=sendFrameAsOneFrameShow;
      appendTransportLog("Show this frame now uses the show upload flow, not the old pixels command.");
    }
  }
  try{appendTransportLog("Transport hotfix active: BLE writes are 20-byte chunks.");}catch(error){}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installFrameButtonFix,{once:true});
  else installFrameButtonFix();
}());
