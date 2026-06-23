(function(){
  "use strict";
  const SAFE_UPLOAD_BRIGHTNESS=24;
  const SAFE_POWER_LIMIT_MA=650;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function log(message,level="info"){
    try{appendTransportLog(message,level)}catch(error){}
  }
  function setUiBrightness(value){
    const brightness=document.getElementById("brightness");
    const label=document.getElementById("brightnessValue");
    if(brightness)brightness.value=String(value);
    if(label)label.textContent=String(value);
  }
  async function safeUploadShow(){
    const button=document.getElementById("uploadShow");
    const requestedBrightness=+(document.getElementById("brightness")?.value||35);
    const safeBrightness=Math.min(requestedBrightness,SAFE_UPLOAD_BRIGHTNESS);
    if(button)button.disabled=true;
    try{
      setUploadProgress(0);
      setUiBrightness(safeBrightness);
      setStatus(`Safe upload: capping brightness at ${safeBrightness} and power at ${SAFE_POWER_LIMIT_MA}mA...`);
      log(`Safe upload guard active: requested brightness ${requestedBrightness}, using ${safeBrightness}, power cap ${SAFE_POWER_LIMIT_MA}mA`);
      await sendCommand({brightness:safeBrightness,powerLimitMa:SAFE_POWER_LIMIT_MA},0,2,10000);
      await sleep(250);

      const totalSteps=project.frames.length+2;
      setStatus(`Starting safe ${project.frames.length}-frame upload...`);
      const begun=await sendCommand({
        op:"show_begin",
        count:project.frames.length,
        frameMs:project.frameMs,
        brightness:safeBrightness
      },2,100/totalSteps,18000);
      if(begun.op!=="begin"||begun.n!==project.frames.length){
        throw Error("Device firmware is outdated; flash protocol v2 before uploading shows");
      }

      for(let index=0;index<project.frames.length;index++){
        const startPercent=(index+1)*100/totalSteps;
        const endPercent=(index+2)*100/totalSteps;
        setStatus(`Safe upload frame ${index+1} of ${project.frames.length}...`);
        let reply,lastError;
        for(let attempt=1;attempt<=3;attempt++){
          try{
            reply=await sendCommand({op:"show_frame",index,pixels:pixelsHex(effectiveFrame(index))},startPercent,endPercent,25000);
            if(reply.i!==index)throw Error(`Wrong acknowledgement for frame ${index+1}`);
            lastError=null;
            break;
          }catch(error){
            lastError=error;
            log(`Frame ${index+1} attempt ${attempt} failed: ${error.message}`,"error");
            if(attempt<3)await sleep(300);
          }
        }
        if(lastError)throw Error(`Frame ${index+1} failed after 3 attempts: ${lastError.message}`);
        setStatus(`Frame ${index+1}/${project.frames.length} confirmed`,true);
        await sleep(90);
      }

      setStatus("Committing show at safe brightness...");
      await sleep(350);
      const committed=await sendCommand({op:"show_commit"},(totalSteps-1)*100/totalSteps,100,25000);
      if(committed.done!==project.frames.length)throw Error("Commit frame count did not match");
      await sleep(750);
      setStatus(`Show saved safely: ${project.frames.length} frames. Raise brightness slowly if power is stable.`,true);
      log(`SAFE COMMIT confirmed for ${project.frames.length} frames at brightness ${safeBrightness}`);
    }catch(error){
      setStatus("Upload failed: "+error.message,false,true);
      log("Upload failed: "+error.message,"error");
      try{await sendCommand({op:"show_cancel"},0,0,5000)}catch(cancelError){}
    }finally{
      if(button)button.disabled=!activeTransport;
      setTimeout(()=>setUploadProgress(0),1600);
    }
  }
  function install(){
    const button=document.getElementById("uploadShow");
    if(!button)return;
    window.safeUploadShow=safeUploadShow;
    window.uploadShow=safeUploadShow;
    button.onclick=safeUploadShow;
    log("Safe upload guard loaded: slideshow commits use capped brightness/power to prevent brownout.");
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
}());
