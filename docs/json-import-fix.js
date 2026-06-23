// Forgiving importer for AI-generated LED program JSON.
// Loaded after app.js/user-mode.js so it replaces the brittle Compile & Import click handler.
(()=>{
  const $=id=>document.getElementById(id);

  function stripComments(text){
    let out="",inString=false,quote="",escaped=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(inString){
        out+=c;
        if(escaped)escaped=false;
        else if(c==="\\")escaped=true;
        else if(c===quote)inString=false;
        continue;
      }
      if(c==='"'||c==="'"){inString=true;quote=c;out+=c;continue}
      if(c==="/"&&n==="/"){while(i<text.length&&text[i]!=="\n")i++;out+="\n";continue}
      if(c==="/"&&n==="*"){i+=2;while(i<text.length&&!(text[i]==="*"&&text[i+1]==="/"))i++;i++;continue}
      out+=c;
    }
    return out;
  }

  function findJsonSlice(text){
    const firstObject=text.indexOf("{");
    const firstArray=text.indexOf("[");
    const start=firstObject<0?firstArray:firstArray<0?firstObject:Math.min(firstObject,firstArray);
    if(start<0)return text.trim();
    let inString=false,quote="",escaped=false,depth=0;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(inString){
        if(escaped)escaped=false;
        else if(c==="\\")escaped=true;
        else if(c===quote)inString=false;
        continue;
      }
      if(c==='"'||c==="'"){inString=true;quote=c;continue}
      if(c==="{"||c==="[")depth++;
      if(c==="}"||c==="]"){
        depth--;
        if(depth===0)return text.slice(start,i+1);
      }
    }
    return text.slice(start).trim();
  }

  function quoteBareKeys(text){
    return text.replace(/([,{]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,'$1"$2"$3');
  }

  function repairJsonText(input){
    let text=String(input||"")
      .replace(/^\uFEFF/,"")
      .replace(/[“”]/g,'"')
      .replace(/[‘’]/g,"'")
      .replace(/^\s*```[a-zA-Z0-9_-]*\s*/i,"")
      .replace(/```\s*$/i,"")
      .trim();

    // Gemini/AI sometimes wraps JSON in JS assignment text.
    text=text.replace(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/i,"");
    text=text.replace(/^\s*(?:export\s+default\s+)/i,"");
    text=stripComments(text);
    text=findJsonSlice(text);
    text=quoteBareKeys(text);
    text=text.replace(/,\s*([}\]])/g,"$1");
    return text.trim();
  }

  function looksLikeFirmware(text){
    return /#include\s*<|void\s+setup\s*\(|void\s+loop\s*\(|FastLED\.addLeds|NimBLEDevice::init|Arduino\.h/.test(text);
  }

  function normalizeProject(value){
    const result=LEDCompiler.importJson(JSON.stringify(value),{partial:true});
    if(result.kind==="program"&&result.frames?.length)return {result,project:result.project};
    if(["slideshow","single-slide","raw-frame"].includes(result.kind)&&!result.errors.length)return {result,project:result.value};
    return {result,project:null};
  }

  function showValidation(result){
    if(typeof renderValidation==="function")renderValidation(result);
    else{
      const panel=$("validationPanel");
      if(panel)panel.textContent=(result.errors||[]).map(e=>`${e.path}: ${e.message}`).join("\n")||"Valid.";
    }
  }

  function friendlyParseError(error,repaired){
    const preview=repaired.slice(0,220).replace(/\s+/g," ");
    return `JSON parse failed: ${error.message}. First repaired text: ${preview}${repaired.length>220?"...":""}`;
  }

  function install(){
    const button=$("importProject");
    if(!button||!window.LEDCompiler)return;
    button.onclick=()=>{
      const raw=$("projectJson")?.value||"";
      try{
        if(!raw.trim())throw Error("Paste a JSON program first.");
        if(looksLikeFirmware(raw)){
          throw Error("This box is for LED program JSON, not Arduino/C++ firmware. Upload firmware through Arduino IDE/PlatformIO, or paste a JSON object with schemaVersion 2 here.");
        }
        const repaired=repairJsonText(raw);
        let parsed;
        try{parsed=JSON.parse(repaired)}
        catch(error){throw Error(friendlyParseError(error,repaired))}
        const {result,project}=normalizeProject(parsed);
        showValidation(result);
        if(project){
          loadProject(project);
          window.lastImportResult=result;
          $("projectJson").value=JSON.stringify(result.program||result.value||parsed,null,2);
          const warningCount=result.warnings?.length||0,errorCount=result.errors?.length||0;
          setStatus(errorCount?`Loaded usable layers, but ${errorCount} issue(s) were repaired/skipped.`:warningCount?`Imported with ${warningCount} warning(s).`:"JSON imported and loaded.",true);
          return;
        }
        throw Error((result.errors||[]).map(item=>`${item.path}: ${item.message}`).join("; ")||"Nothing importable found.");
      }catch(error){
        const result={kind:"invalid",value:null,warnings:[],errors:[{path:"$",message:error.message}]};
        window.lastImportResult=result;
        showValidation(result);
        setStatus(error.message,false,true);
      }
    };
    try{appendTransportLog("JSON import repair patch active.")}catch(error){}
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
