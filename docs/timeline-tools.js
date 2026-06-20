(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let previewTimer = null;
  let previewDirection = 1;

  function update() {
    const scrubber = $("timelineScrubber");
    if (!scrubber) return;
    scrubber.max = Math.max(0, project.frames.length - 1);
    scrubber.value = active;
    $("timelinePosition").textContent = `${active + 1} / ${project.frames.length}`;
    renderOnionSkin();
  }
  function select(index) {
    active = Math.max(0, Math.min(project.frames.length - 1, index));
    draw();
    update();
  }
  function shiftFrame(frame, dx, dy) {
    const output = Array(N).fill("#000000");
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const nx = (x + dx + W) % W;
      const ny = (y + dy + H) % H;
      output[ny * W + nx] = frame[y * W + x];
    }
    return output;
  }
  function shift(dx, dy, all) {
    if (all) project.frames = project.frames.map(frame => shiftFrame(frame, dx, dy));
    else project.frames[active] = shiftFrame(project.frames[active], dx, dy);
    draw(); update();
  }
  function rgb(color) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  }
  function hex(values) { return "#" + values.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join(""); }
  function insertFade() {
    if (active >= project.frames.length - 1) return setStatus("Choose a frame that has a next frame", false, true);
    const count = +$("fadeCount").value;
    const available = MAX_FRAMES - project.frames.length;
    if (!available) return setStatus("The 24-frame limit is reached", false, true);
    const total = Math.min(count, available);
    const from = project.frames[active], to = project.frames[active + 1];
    const frames = [];
    for (let step = 1; step <= total; step++) {
      const amount = step / (total + 1);
      frames.push(from.map((color, index) => {
        const a = rgb(color), b = rgb(to[index]);
        return hex(a.map((channel, c) => channel + (b[c] - channel) * amount));
      }));
    }
    project.frames.splice(active + 1, 0, ...frames);
    draw(); update();
  }
  function duplicateRange() {
    const start = Math.max(1, +$("rangeStart").value) - 1;
    const end = Math.min(project.frames.length, +$("rangeEnd").value) - 1;
    if (end < start) return setStatus("Range end must be after range start", false, true);
    const copies = project.frames.slice(start, end + 1).map(frame => [...frame]);
    project.frames.push(...copies.slice(0, MAX_FRAMES - project.frames.length));
    draw(); update();
  }
  function makePingPong() {
    const reverse = project.frames.slice(1, -1).reverse().map(frame => [...frame]);
    project.frames.push(...reverse.slice(0, MAX_FRAMES - project.frames.length));
    draw(); update();
  }
  function renderOnionSkin() {
    const previous = $("onionPrevious")?.checked ? project.frames[active - 1] : null;
    const next = $("onionNext")?.checked ? project.frames[active + 1] : null;
    [...$("matrix").children].forEach((pixel, index) => {
      const marks = [];
      if (previous && previous[index] !== "#000000") marks.push("inset 0 0 0 1px rgba(56,217,214,.75)");
      if (next && next[index] !== "#000000") marks.push("inset 0 0 0 2px rgba(255,71,126,.55)");
      pixel.style.boxShadow = marks.join(",");
    });
  }
  function togglePreview() {
    if (previewTimer) {
      clearInterval(previewTimer); previewTimer = null;
      $("playTimeline").textContent = "Play preview";
      return;
    }
    $("playTimeline").textContent = "Pause preview";
    previewDirection = 1;
    previewTimer = setInterval(() => {
      let next = active + previewDirection;
      if ($("previewPingPong").checked && (next >= project.frames.length || next < 0)) {
        previewDirection *= -1;
        next = active + previewDirection;
      }
      select((next + project.frames.length) % project.frames.length);
    }, project.frameMs);
  }
  function openUploadPreview() {
    const dialog = $("uploadPreviewDialog");
    const canvas = $("uploadPreviewCanvas");
    const context = canvas.getContext("2d");
    let frame = 0;
    clearInterval(dialog._timer);
    const render = () => {
      const pixels = effectiveFrame(frame % project.frames.length);
      const cellW = canvas.width / W, cellH = canvas.height / H;
      pixels.forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect((index % W) * cellW, Math.floor(index / W) * cellH, Math.ceil(cellW), Math.ceil(cellH));
      });
      $("uploadPreviewLabel").textContent = `Frame ${frame % project.frames.length + 1} of ${project.frames.length}`;
      frame++;
    };
    render();
    dialog._timer = setInterval(render, project.frameMs);
    dialog.showModal();
  }

  function install() {
    const editor = $("editor");
    if (!editor || $("timelineTools")) return;
    const section = document.createElement("section");
    section.id = "timelineTools";
    section.className = "timeline-tools section";
    section.innerHTML = `
      <div class="timeline-head"><h2>Timeline</h2><span id="timelinePosition"></span></div>
      <input id="timelineScrubber" type="range" min="0" value="0">
      <div class="timeline-actions">
        <button id="previousTimeline" type="button">Previous</button><button id="nextTimeline" type="button">Next</button>
        <button id="playTimeline" type="button">Play preview</button><label><input id="previewPingPong" type="checkbox" style="width:auto"> Preview ping-pong</label>
        <button id="reverseTimeline" type="button">Reverse animation</button><button id="makePingPong" type="button">Make ping-pong</button>
      </div>
      <div class="timeline-actions">
        <button data-shift="-1,0">Shift left</button><button data-shift="1,0">Shift right</button>
        <button data-shift="0,-1">Shift up</button><button data-shift="0,1">Shift down</button>
        <label><input id="shiftAllFrames" type="checkbox" style="width:auto"> Shift all frames</label>
      </div>
      <div class="timeline-actions">
        <label>Range start<input id="rangeStart" type="number" min="1" value="1"></label>
        <label>Range end<input id="rangeEnd" type="number" min="1" value="1"></label>
        <button id="duplicateRange" type="button">Duplicate range</button>
        <label>Fade frames<input id="fadeCount" type="number" min="1" max="12" value="3"></label>
        <button id="insertFade" type="button">Insert fade</button>
      </div>
      <div class="timeline-actions">
        <label><input id="onionPrevious" type="checkbox" style="width:auto"> Previous onion skin</label>
        <label><input id="onionNext" type="checkbox" style="width:auto"> Next onion skin</label>
        <button id="previewUpload" type="button">Preview upload</button>
      </div>`;
    editor.append(section);
    document.body.insertAdjacentHTML("beforeend", '<dialog id="uploadPreviewDialog"><div class="dialog-head"><h2>Upload preview</h2><button id="closeUploadPreview" type="button">Close</button></div><canvas id="uploadPreviewCanvas" width="560" height="200"></canvas><p id="uploadPreviewLabel"></p><button id="confirmUpload" type="button" class="primary">Send this show</button></dialog>');
    $("previousTimeline").onclick = () => select(active - 1);
    $("nextTimeline").onclick = () => select(active + 1);
    $("playTimeline").onclick = togglePreview;
    $("reverseTimeline").onclick = () => { project.frames.reverse(); active = project.frames.length - 1 - active; draw(); update(); };
    $("makePingPong").onclick = makePingPong;
    section.querySelectorAll("[data-shift]").forEach(button => button.onclick = () => {
      const [dx, dy] = button.dataset.shift.split(",").map(Number);
      shift(dx, dy, $("shiftAllFrames").checked);
    });
    $("duplicateRange").onclick = duplicateRange;
    $("insertFade").onclick = insertFade;
    $("onionPrevious").onchange = renderOnionSkin;
    $("onionNext").onchange = renderOnionSkin;
    $("timelineScrubber").oninput = event => select(+event.target.value);
    $("previewUpload").onclick = openUploadPreview;
    $("closeUploadPreview").onclick = () => { clearInterval($("uploadPreviewDialog")._timer); $("uploadPreviewDialog").close(); };
    const originalUpload = $("uploadShow").onclick;
    $("uploadShow").onclick = openUploadPreview;
    $("confirmUpload").onclick = () => {
      clearInterval($("uploadPreviewDialog")._timer);
      $("uploadPreviewDialog").close();
      originalUpload();
    };
    new MutationObserver(update).observe($("frames"), { childList: true, subtree: true });
    update();
  }

  install();
}());
