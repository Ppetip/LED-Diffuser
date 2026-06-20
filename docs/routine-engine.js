(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const STORAGE = "ledDiffuserRoutinesV1";
  let state = { wakeTime: "", timeTheme: false, sleepAt: 0, focusEndsAt: 0, lastWakeDate: "" };
  try { state = { ...state, ...JSON.parse(localStorage.getItem(STORAGE) || "{}") }; } catch (_) {}

  function save() { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  function status(text) { if ($("routineStatus")) $("routineStatus").textContent = text; }
  async function send(payload) {
    if (typeof activeTransport === "undefined" || !activeTransport) return false;
    try { await sendCommand(payload); return true; }
    catch (error) { status(error.message); return false; }
  }
  function timeThemePayload(hour) {
    if (hour < 6) return { mode: "aura", hue: 225, saturation: 180, brightness: 10, speed: 300 };
    if (hour < 10) return { mode: "aura", hue: 24, saturation: 220, brightness: 38, speed: 220 };
    if (hour < 17) return { mode: "aura", hue: 145, saturation: 190, brightness: 42, speed: 150 };
    if (hour < 21) return { mode: "aura", hue: 8, saturation: 230, brightness: 30, speed: 240 };
    return { mode: "aura", hue: 210, saturation: 210, brightness: 16, speed: 320 };
  }

  function install() {
    const host = $("everydayControls");
    if (!host || $("routinePanel")) return;
    const panel = document.createElement("section");
    panel.id = "routinePanel";
    panel.className = "routine-panel";
    panel.innerHTML = `
      <div><h2>Routines</h2><p class="note">Browser simulation: this page must remain open and connected.</p></div>
      <div class="routine-grid">
        <label>Sleep timer<select id="sleepMinutes"><option value="0">Off</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label>
        <label>Wake alarm<input id="wakeTime" type="time" value="${state.wakeTime}"></label>
        <label>Focus timer<select id="focusMinutes"><option value="0">Off</option><option value="25">25 minutes</option><option value="50">50 minutes</option></select></label>
        <label><input id="timeTheme" type="checkbox" style="width:auto" ${state.timeTheme ? "checked" : ""}> Follow time-of-day colors</label>
      </div>
      <div class="everyday-actions"><button id="startSleep" type="button">Set sleep</button><button id="startFocus" type="button">Start focus</button><button id="applyTimeTheme" type="button">Apply now</button></div>
      <div id="routineStatus" class="routine-status" aria-live="polite"></div>`;
    host.append(panel);
    $("wakeTime").onchange = event => { state.wakeTime = event.target.value; save(); status(state.wakeTime ? `Wake set for ${state.wakeTime}` : "Wake alarm off"); };
    $("timeTheme").onchange = event => { state.timeTheme = event.target.checked; save(); };
    $("startSleep").onclick = () => {
      const minutes = +$("sleepMinutes").value;
      state.sleepAt = minutes ? Date.now() + minutes * 60000 : 0;
      save();
      status(minutes ? `Dimming in ${minutes} minutes` : "Sleep timer off");
    };
    $("startFocus").onclick = async () => {
      const minutes = +$("focusMinutes").value;
      state.focusEndsAt = minutes ? Date.now() + minutes * 60000 : 0;
      save();
      if (minutes) {
        await send({ mode: "aura", hue: 145, saturation: 180, brightness: 38, speed: 180 });
        status(`Focus mode for ${minutes} minutes`);
      } else status("Focus timer off");
    };
    $("applyTimeTheme").onclick = async () => {
      const applied = await send(timeThemePayload(new Date().getHours()));
      status(applied ? "Time theme applied" : "Connect to apply the time theme");
    };
  }

  async function tick() {
    const now = new Date();
    if (state.sleepAt && Date.now() >= state.sleepAt) {
      state.sleepAt = 0; save();
      await send({ mode: "aura", hue: 220, saturation: 160, brightness: 1, speed: 500 });
      status("Sleep dimming active");
    }
    if (state.focusEndsAt && Date.now() >= state.focusEndsAt) {
      state.focusEndsAt = 0; save();
      await send({ mode: "aura", hue: 195, saturation: 190, brightness: 24, speed: 260 });
      status("Focus timer complete");
    }
    const dateKey = now.toISOString().slice(0, 10);
    const currentTime = now.toTimeString().slice(0, 5);
    if (state.wakeTime && currentTime === state.wakeTime && state.lastWakeDate !== dateKey) {
      state.lastWakeDate = dateKey; save();
      await send({ mode: "aura", hue: 24, saturation: 230, brightness: 48, speed: 260 });
      status("Wake sunrise active");
    }
    if (state.timeTheme && now.getMinutes() === 0 && now.getSeconds() < 20) await send(timeThemePayload(now.getHours()));
    if (state.sleepAt) status(`Sleep in ${Math.max(1, Math.ceil((state.sleepAt - Date.now()) / 60000))} minutes`);
  }

  install();
  tick();
  setInterval(tick, 15000);
}());
