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
  try{appendTransportLog("Transport hotfix active: BLE writes are 20-byte chunks.");}catch(error){}
}());
