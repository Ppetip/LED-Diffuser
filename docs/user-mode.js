(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const PALETTES = {
    aura: ["#070b18", "#143642", "#38d9d6", "#8cff98", "#d9fff8"],
    sunset: ["#120b2d", "#541388", "#ff477e", "#ff9f1c", "#ffe66d"],
    ocean: ["#020617", "#051937", "#0b4f6c", "#38d9d6", "#b8fff9"],
    ember: ["#100402", "#7f1d1d", "#ff6b35", "#ff9f1c", "#fff1c1"],
    candy: ["#1d1038", "#9d8cff", "#f06595", "#38d9d6", "#fff5fb"],
    mono: ["#000000", "#1f2937", "#64748b", "#cbd5e1", "#ffffff"]
  };

  function setMode(mode) {
    mode = mode === "studio" ? "studio" : "everyday";
    document.body.dataset.uiMode = mode;
    document.querySelectorAll("[data-ui-choice]").forEach(button => {
      const active = button.dataset.uiChoice === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    localStorage.setItem("ledDiffuserUiMode", mode);
  }

  function addModeSwitch() {
    const head = document.querySelector(".head");
    if (!head) return;
    const element = document.createElement("div");
    element.className = "ui-mode-switch";
    element.setAttribute("aria-label", "Interface mode");
    element.innerHTML = '<button type="button" data-ui-choice="everyday">Everyday</button><button type="button" data-ui-choice="studio">Studio</button>';
    head.append(element);
    element.querySelectorAll("button").forEach(button => {
      button.onclick = () => setMode(button.dataset.uiChoice);
    });
  }

  function usePalette(name) {
    const colors = PALETTES[name];
    const host = $("palette");
    if (!colors || !host) return;
    host.innerHTML = colors.map(color => `<button class="swatch" type="button" data-c="${color}" aria-label="Use ${color}" style="background:${color}"></button>`).join("");
    host.querySelectorAll(".swatch").forEach(swatch => {
      swatch.onclick = () => {
        $("color").value = swatch.dataset.c;
        host.querySelectorAll(".swatch").forEach(item => item.classList.remove("selected"));
        swatch.classList.add("selected");
      };
    });
    localStorage.setItem("ledDiffuserPalette", name);
  }

  function addPalettePicker() {
    const host = $("palette");
    if (!host) return;
    const element = document.createElement("div");
    element.className = "mood-palettes";
    const buttons = Object.entries(PALETTES).map(([name, colors]) => {
      const chips = colors.map(color => `<i style="background:${color}"></i>`).join("");
      return `<button type="button" data-palette="${name}"><span>${chips}</span><b>${name}</b></button>`;
    }).join("");
    element.innerHTML = `<span class="field-title">Mood palettes</span><div class="palette-packs">${buttons}</div>`;
    host.before(element);
    element.querySelectorAll("[data-palette]").forEach(button => {
      button.onclick = () => usePalette(button.dataset.palette);
    });
    usePalette(localStorage.getItem("ledDiffuserPalette") || "aura");
  }

  function catalogItems() {
    if (Array.isArray(window.LED_TEMPLATE_CATALOG) && window.LED_TEMPLATE_CATALOG.length) return window.LED_TEMPLATE_CATALOG;
    return [...$("jsonTemplate").options].filter(option => option.value).map((option, index) => ({
      id: option.value,
      name: option.textContent,
      category: "Show",
      description: "Ready-made LED show",
      preview: { background: index % 2 ? "linear-gradient(145deg,#541388,#ff477e,#ff9f1c)" : "linear-gradient(145deg,#020617,#312e81,#38d9d6)" }
    }));
  }

  function addGallery() {
    const editor = $("editor");
    const items = catalogItems();
    if (!editor || !items.length) return;
    const categories = ["All", ...new Set(items.map(item => item.category))];
    const element = document.createElement("section");
    element.id = "simpleGallery";
    element.className = "simple-gallery section";
    const chips = categories.map((category, index) => `<button type="button" data-category="${category}" class="${index ? "" : "active"}">${category}</button>`).join("");
    element.innerHTML = `<div class="gallery-head"><div><h2>Ready-made shows</h2><p class="note">Pick one, preview it, then send it to your display.</p></div><button id="surpriseShow" type="button">Surprise me</button></div><div class="category-chips">${chips}</div><div class="show-cards"></div>`;
    editor.prepend(element);
    const cards = element.querySelector(".show-cards");

    function load(item) {
      if (!item) return;
      if (item.accessibility?.flash && !confirm("This show contains flashing light. Load it?")) return;
      if (item.program) {
        $("projectJson").value = JSON.stringify(item.program, null, 2);
        $("importProject").click();
      } else {
        $("jsonTemplate").value = item.id;
        $("jsonTemplate").dispatchEvent(new Event("change", { bubbles: true }));
        $("importProject").click();
      }
      $("matrix")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function draw(category = "All") {
      cards.innerHTML = items.filter(item => category === "All" || item.category === category).map(item => {
        const art = item.preview?.background || "linear-gradient(145deg,#020617,#312e81)";
        const warning = item.accessibility?.flash ? " / Flashing" : "";
        return `<button type="button" class="show-card" data-show="${item.id}"><span class="show-art" style="background:${art}"></span><strong>${item.name}</strong><small>${item.category}${warning}</small><span>${item.description || ""}</span></button>`;
      }).join("");
      cards.querySelectorAll("[data-show]").forEach(button => {
        button.onclick = () => load(items.find(item => item.id === button.dataset.show));
      });
    }

    element.querySelectorAll("[data-category]").forEach(button => {
      button.onclick = () => {
        element.querySelectorAll("[data-category]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        draw(button.dataset.category);
      };
    });
    $("surpriseShow").onclick = () => load(items[Math.floor(Math.random() * items.length)]);
    draw();
  }

  function addPowerCard() {
    const connection = $("connect")?.parentElement;
    if (!connection) return;
    const element = document.createElement("div");
    element.className = "power-card";
    element.innerHTML = '<strong>Power setup</strong><label><select id="powerProfile"><option value="safe">Safe USB / 750 mA</option><option value="external">External LED supply / 3000 mA</option></select></label><p class="note">Recommended while connected to a computer or phone. Brightness is capped at 80.</p>';
    connection.append(element);
    const select = element.querySelector("select");
    const help = element.querySelector("p");
    const brightness = $("brightness");
    select.onchange = async () => {
      if (select.value === "external" && !confirm("Only use External after the LEDs have their own correctly wired supply with a shared ground.")) select.value = "safe";
      const safe = select.value === "safe";
      help.textContent = safe ? "Recommended for a computer or phone. Brightness is capped at 80." : "External supply confirmed. Increase brightness gradually.";
      if (brightness) {
        brightness.max = safe ? 80 : 160;
        if (safe && +brightness.value > 80) {
          brightness.value = 80;
          brightness.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (typeof activeTransport !== "undefined" && activeTransport) {
        try {
          await sendCommand({ powerLimitMa: safe ? 750 : 3000 });
          appendTransportLog(`Power limit set to ${safe ? 750 : 3000} mA`);
        } catch (error) {
          appendTransportLog("Could not update power limit: " + error.message, "error");
        }
      }
    };
    select.onchange();
  }

  function addMobileNav() {
    const nav = document.createElement("nav");
    nav.className = "simple-nav";
    nav.setAttribute("aria-label", "Everyday controls");
    nav.innerHTML = '<button data-jump="matrix">Draw</button><button data-jump="simpleGallery">Shows</button><button data-jump="connect">Connect</button><button data-jump="uploadShow">Send</button>';
    document.body.append(nav);
    nav.querySelectorAll("button").forEach(button => {
      button.onclick = () => $(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  addModeSwitch();
  addPalettePicker();
  addGallery();
  addPowerCard();
  addMobileNav();
  setMode(localStorage.getItem("ledDiffuserUiMode") || "everyday");
}());
