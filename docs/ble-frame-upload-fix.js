// Fix single-frame BLE uploads by slowing writes and avoiding brittle one-shot frame sends.
// This file is loaded after app.js and user-mode.js.
(function () {
  "use strict";

  const BLE_CHUNK_SIZE = 20;
  const BLE_CHUNK_DELAY_MS = 20;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function safeLog(message, level = "info") {
    try { appendTransportLog(message, level); }
    catch (error) { console.log(message); }
  }

  async function writeBleChunk(part) {
    if (rx && rx.properties && rx.properties.write && typeof rx.writeValueWithResponse === "function") {
      await rx.writeValueWithResponse(part);
    } else if (rx && rx.properties && rx.properties.writeWithoutResponse && typeof rx.writeValueWithoutResponse === "function") {
      await rx.writeValueWithoutResponse(part);
    } else {
      await rx.writeValue(part);
    }
    await sleep(BLE_CHUNK_DELAY_MS);
  }

  async function fixedTransmit(payload, startPercent = 0, endPercent = 100) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload) + "\n");
    safeLog(`Sending ${payload.op || payload.mode || (payload.pixels ? "pixels" : "command")} (${bytes.length} bytes)`);

    if (activeTransport === "usb") {
      if (!serialWriter) throw Error("USB connection is not open");
      await serialWriter.write(bytes);
      setUploadProgress(endPercent);
      return;
    }

    if (activeTransport !== "ble") throw Error("Connect Bluetooth or USB first");
    if (!rx || !device || !device.gatt || !device.gatt.connected) throw Error("Bluetooth connection is not open");

    for (let i = 0; i < bytes.length; i += BLE_CHUNK_SIZE) {
      const part = bytes.slice(i, i + BLE_CHUNK_SIZE);
      await writeBleChunk(part);
      const fraction = Math.min(bytes.length, i + BLE_CHUNK_SIZE) / bytes.length;
      setUploadProgress(startPercent + (endPercent - startPercent) * fraction);
    }
  }

  async function fixedSendCommand(payload, startPercent = 0, endPercent = 100, timeoutMs = 12000) {
    const length = new TextEncoder().encode(JSON.stringify(payload) + "\n").length;
    const effectiveTimeout = activeTransport === "ble" ? Math.max(timeoutMs, Math.min(90000, 10000 + length * 25)) : timeoutMs;
    const replyPromise = waitForReply(effectiveTimeout);
    try {
      await fixedTransmit(payload, startPercent, endPercent);
    } catch (error) {
      const waiter = replyWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      throw error;
    }
    const reply = await replyPromise;
    if (!(reply.ok === 1 || reply.ok === true)) throw Error(reply.error || "Device rejected command");
    return reply;
  }

  async function fixedSendCurrent() {
    const button = document.getElementById("sendFrame");
    try {
      if (button) button.disabled = true;
      setUploadProgress(0);
      setStatus("Sending one frame safely...");

      const frame = effectiveFrame(active);
      const pixels = pixelsHex(frame);
      if (pixels.length !== 1680) throw Error(`Internal frame error: expected 1680 hex chars, got ${pixels.length}`);

      // Use the same begin/frame/commit path as Upload Show. It gives the ESP32 clear ordering
      // and avoids the older one-shot {pixels:...} command path that was causing invalid JSON.
      const begun = await fixedSendCommand({
        op: "show_begin",
        count: 1,
        frameMs: +document.getElementById("frameMs").value || 250,
        brightness: +document.getElementById("brightness").value || 35
      }, 0, 15, 15000);
      if (begun.op !== "begin" || begun.n !== 1) throw Error("Device did not start one-frame upload");

      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const reply = await fixedSendCommand({ op: "show_frame", index: 0, pixels }, 15, 85, 45000);
          if (reply.i !== 0) throw Error("Wrong acknowledgement for frame 1");
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          safeLog(`One-frame upload attempt ${attempt} failed: ${error.message}`, "error");
          if (attempt < 3) await sleep(350);
        }
      }
      if (lastError) throw lastError;

      const committed = await fixedSendCommand({ op: "show_commit" }, 85, 100, 20000);
      if (committed.done !== 1) throw Error("Commit did not confirm one frame");
      setStatus("Frame confirmed by diffuser", true);
      safeLog("Single frame accepted through staged upload");
    } catch (error) {
      setStatus(error.message, false, true);
      safeLog(error.message, "error");
      try { await fixedSendCommand({ op: "show_cancel" }, 0, 0, 5000); } catch (cancelError) {}
    } finally {
      if (button) button.disabled = !activeTransport;
      setTimeout(() => setUploadProgress(0), 1000);
    }
  }

  transmit = fixedTransmit;
  sendCommand = fixedSendCommand;
  sendCurrent = fixedSendCurrent;

  const bind = () => {
    const sendFrame = document.getElementById("sendFrame");
    if (sendFrame) sendFrame.onclick = fixedSendCurrent;
    safeLog("BLE frame upload fix active.");
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
}());
