(function () {
  "use strict";

  if (!window.PhysicalSimulator) throw Error("Physical simulator failed to load");

  const simulator = new PhysicalSimulator.Preview($("diffuserCanvas"));
  let previewPlaying = true;
  let previewFrame = 0;
  let previewChangedAt = performance.now();
  let bleChunkSize = 20;

  function previewPixels() {
    const index = previewPlaying ? previewFrame : active;
    return effectiveFrame(Math.min(project.frames.length - 1, Math.max(0, index)));
  }

  function refreshPhysicalPreview() {
    const frame = previewPixels();
    simulator.setFrame(frame);
    const estimated = PhysicalSimulator.estimateCurrentMa(frame, +$("brightness").value);
    $("previewReadout").textContent = `Frame ${Math.min(project.frames.length, previewFrame + 1)} / ${project.frames.length}  |  ${project.frameMs} ms  |  est. ${estimated} mA`;
  }

  function animatePreview(now) {
    if (previewPlaying && project.frames.length > 1 && now - previewChangedAt >= project.frameMs) {
      const steps = Math.max(1, Math.floor((now - previewChangedAt) / project.frameMs));
      previewFrame = (previewFrame + steps) % project.frames.length;
      previewChangedAt += steps * project.frameMs;
      refreshPhysicalPreview();
    }
    requestAnimationFrame(animatePreview);
  }

  const originalDraw = draw;
  draw = function () {
    originalDraw();
    previewFrame = Math.min(previewFrame, project.frames.length - 1);
    refreshPhysicalPreview();
  };

  function loadEffect(kind) {
    const effect = PhysicalSimulator.EFFECTS[kind] || PhysicalSimulator.EFFECTS.aurora;
    loadProject(PhysicalSimulator.createShow(kind));
    previewFrame = 0;
    previewChangedAt = performance.now();
    previewPlaying = true;
    $("previewPlay").textContent = "Pause preview";
    $("effectDescription").textContent = effect.description;
    document.querySelectorAll("[data-effect]").forEach(button => button.classList.toggle("active", button.dataset.effect === kind));
    setStatus(`${effect.name} loaded. Preview it, then connect and upload.`, false);
    refreshPhysicalPreview();
  }

  document.querySelectorAll("[data-effect]").forEach(button => button.onclick = () => loadEffect(button.dataset.effect));
  $("previewPlay").onclick = () => {
    previewPlaying = !previewPlaying;
    previewChangedAt = performance.now();
    $("previewPlay").textContent = previewPlaying ? "Pause preview" : "Play preview";
    refreshPhysicalPreview();
  };
  $("previewStep").onclick = () => {
    previewPlaying = false;
    previewFrame = (previewFrame + 1) % project.frames.length;
    $("previewPlay").textContent = "Play preview";
    refreshPhysicalPreview();
  };
  $("previewGlow").oninput = () => {
    $("previewGlowValue").textContent = `${(+$("previewGlow").value).toFixed(2)}x`;
    simulator.setOptions({ glow: +$("previewGlow").value });
  };
  $("previewExposure").oninput = () => {
    $("previewExposureValue").textContent = `${(+$("previewExposure").value).toFixed(2)}x`;
    simulator.setOptions({ exposure: +$("previewExposure").value });
  };
  $("previewGrid").onchange = () => simulator.setOptions({ grid: $("previewGrid").checked });

  if (Array.isArray(window.LED_TEMPLATE_CATALOG)) {
    for (const item of window.LED_TEMPLATE_CATALOG) {
      JSON_TEMPLATES[item.id] = item.program;
      if (!$("jsonTemplate").querySelector(`option[value="${item.id}"]`)) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.category}: ${item.name}`;
        $("jsonTemplate").append(option);
      }
    }
  }

  /* Request IDs prevent a delayed BLE acknowledgement from satisfying the next command. */
  let nextRequestId = 1;
  let commandTail = Promise.resolve();
  const requestWaiters = new Map();

  rejectPendingReplies = function (reason) {
    for (const waiter of requestWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Error(reason));
    }
    requestWaiters.clear();
  };

  waitForReply = function (requestId, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        requestWaiters.delete(requestId);
        reject(Error("Device acknowledgement timed out"));
      }, timeoutMs);
      requestWaiters.set(requestId, waiter);
    });
  };

  handleDeviceLine = function (line) {
    line = line.trim();
    if (!line) return;
    appendTransportLog(line, line.includes("[ERROR]") ? "error" : "device");
    if (!line.startsWith("{")) return;
    try {
      const reply = JSON.parse(line);
      const fallbackId = requestWaiters.size === 1 ? requestWaiters.keys().next().value : null;
      const requestId = Number.isInteger(reply.rid) ? reply.rid : fallbackId;
      const waiter = requestWaiters.get(requestId);
      if (waiter) {
        requestWaiters.delete(requestId);
        clearTimeout(waiter.timer);
        waiter.resolve(reply);
      } else appendTransportLog(`Ignored stale acknowledgement${reply.rid ? ` #${reply.rid}` : ""}`, "info");
    } catch (error) {
      appendTransportLog("Malformed JSON reply: " + error.message, "error");
    }
  };

  transmit = async function (payload, startPercent = 0, endPercent = 100) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload) + "\n");
    appendTransportLog(`Sending ${payload.op || payload.mode || "command"} #${payload.rid} (${bytes.length} bytes)`);
    if (activeTransport === "usb") {
      if (!serialWriter) throw Error("USB connection is not open");
      await serialWriter.write(bytes);
      setUploadProgress(endPercent);
    } else if (activeTransport === "ble") {
      if (!rx) throw Error("Bluetooth connection is not open");
      for (let index = 0; index < bytes.length; index += bleChunkSize) {
        await rx.writeValue(bytes.slice(index, index + bleChunkSize));
        const fraction = Math.min(bytes.length, index + bleChunkSize) / bytes.length;
        setUploadProgress(startPercent + (endPercent - startPercent) * fraction);
      }
    } else throw Error("Connect Bluetooth or USB first");
  };

  sendCommand = function (payload, startPercent = 0, endPercent = 100, timeoutMs = 12000) {
    const run = async () => {
      const rid = nextRequestId++;
      const command = { ...payload, rid };
      const replyPromise = waitForReply(rid, timeoutMs);
      try {
        await transmit(command, startPercent, endPercent);
      } catch (error) {
        const waiter = requestWaiters.get(rid);
        if (waiter) {
          requestWaiters.delete(rid);
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        throw error;
      }
      const reply = await replyPromise;
      if (!(reply.ok === 1 || reply.ok === true)) throw Error(reply.error || "Device rejected command");
      return reply;
    };
    const queued = commandTail.then(run, run);
    commandTail = queued.catch(() => {});
    return queued;
  };

  async function probeConnection() {
    const reply = await sendCommand({ op: "get_status" }, 0, 0, 7000);
    bleChunkSize = Math.max(20, Math.min(160, reply.bleWriteMax || 20));
    appendTransportLog(`Firmware ${reply.firmware || "unknown"}; protocol ${reply.protocol || "?"}; BLE chunks ${bleChunkSize} bytes`);
    return reply;
  }

  const originalConnect = connect;
  $("connect").onclick = async () => {
    await originalConnect();
    if (activeTransport === "ble") {
      try { await probeConnection(); setStatus(`Connected via ${device?.name || "Bluetooth"}`, true); }
      catch (error) { appendTransportLog("Status probe failed: " + error.message, "error"); }
    }
  };
  const originalConnectUsb = connectUsb;
  $("connectUsb").onclick = async () => {
    await originalConnectUsb();
    if (activeTransport === "usb") {
      try { await probeConnection(); setStatus("Connected via USB", true); }
      catch (error) { appendTransportLog("Status probe failed: " + error.message, "error"); }
    }
  };

  if (!localStorage.getItem("ledDiffuserRevampSeen") && project.frames.every(frame => frame.every(color => color === "#000000"))) {
    localStorage.setItem("ledDiffuserRevampSeen", "1");
    loadEffect("aurora");
  } else refreshPhysicalPreview();
  requestAnimationFrame(animatePreview);
}());
