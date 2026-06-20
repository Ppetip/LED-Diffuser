(function () {
  "use strict";
  const $ = id => document.getElementById(id);

  function sendIfConnected(payload) {
    if (typeof activeTransport === "undefined" || !activeTransport) {
      setStatus("Connect to the panel first", false, true);
      return Promise.resolve(false);
    }
    return sendCommand(payload).then(() => true).catch(error => {
      setStatus(error.message, false, true);
      return false;
    });
  }

  function install() {
    const editor = $("editor");
    const gallery = $("simpleGallery");
    if (!editor || $("everydayControls")) return;
    const catalog = Array.isArray(window.LED_TEMPLATE_CATALOG) ? window.LED_TEMPLATE_CATALOG : [];
    const panel = document.createElement("section");
    panel.id = "everydayControls";
    panel.className = "everyday-controls section";
    const options = catalog.map(item => `<option value="${item.id}">${item.name}</option>`).join("");
    panel.innerHTML = `
      <div class="everyday-head">
        <div><h2>Panel controls</h2><p class="note">Ambient color, silhouettes, icons, and large pixel art work best.</p></div>
        <span class="ambient-only">Ambient pixel display</span>
      </div>
      <div class="everyday-grid">
        <label>Vibe<select id="everydayVibe">${options}</select></label>
        <label>Brightness <span id="everydayBrightnessValue">35</span><input id="everydayBrightness" type="range" min="1" max="80" value="35"></label>
        <label>Speed <span id="everydaySpeedValue">250</span> ms<input id="everydaySpeed" type="range" min="50" max="2000" step="25" value="250"></label>
        <label class="wide">Message<input id="everydayText" maxlength="32" placeholder="Large short text works best"></label>
      </div>
      <div id="everydayPalettes"></div>
      <div class="everyday-actions">
        <button id="everydayTextSend" type="button">Show message</button>
        <button id="everydayRandom" type="button">Randomize</button>
        <button id="everydaySave" class="primary" type="button">Save to panel</button>
      </div>
      <p class="note">Photos, faces, detailed AI images, and small text do not resolve well at this pixel density.</p>`;
    if (gallery) gallery.after(panel); else editor.prepend(panel);
    const palettes = document.querySelector(".mood-palettes");
    if (palettes) $("everydayPalettes").append(palettes);

    $("everydayVibe").onchange = event => document.querySelector(`[data-show="${event.target.value}"]`)?.click();
    $("everydayBrightness").oninput = event => {
      $("everydayBrightnessValue").textContent = event.target.value;
      $("brightness").value = event.target.value;
      $("brightness").dispatchEvent(new Event("input", { bubbles: true }));
    };
    $("everydayBrightness").onchange = event => sendIfConnected({ brightness: +event.target.value });
    $("everydaySpeed").oninput = event => {
      $("everydaySpeedValue").textContent = event.target.value;
      $("frameMs").value = event.target.value;
      $("frameMs").dispatchEvent(new Event("input", { bubbles: true }));
    };
    $("everydayTextSend").onclick = async () => {
      const text = $("everydayText").value.trim();
      if (!text) return setStatus("Enter a short message first", false, true);
      const sent = await sendIfConnected({
        mode: "text", text, direction: "left",
        speed: +$("everydaySpeed").value,
        brightness: +$("everydayBrightness").value
      });
      if (sent) setStatus("Message saved to panel", true);
    };
    $("everydayRandom").onclick = () => {
      const cards = [...document.querySelectorAll(".show-card")];
      cards[Math.floor(Math.random() * cards.length)]?.click();
    };
    $("everydaySave").onclick = () => {
      if (typeof activeTransport === "undefined" || !activeTransport) return setStatus("Connect to the panel first", false, true);
      $("uploadShow").click();
    };
  }

  install();
}());
