(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PhysicalSimulator = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WIDTH = 28;
  const HEIGHT = 10;
  const PIXELS = WIDTH * HEIGHT;
  const BOARD_WIDTH_IN = 19;
  const BOARD_HEIGHT_IN = 30;
  const DEFAULT_FRAME_COUNT = 24;

  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const fract = value => value - Math.floor(value);
  const hash = (x, y, seed = 0) => fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453);
  const hex = value => Math.round(clamp(value) * 255).toString(16).padStart(2, "0");

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s);
    l = clamp(l);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const section = h / 60;
    const x = c * (1 - Math.abs(section % 2 - 1));
    let rgb = section < 1 ? [c, x, 0] : section < 2 ? [x, c, 0] : section < 3 ? [0, c, x] : section < 4 ? [0, x, c] : section < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return `#${hex(rgb[0] + m)}${hex(rgb[1] + m)}${hex(rgb[2] + m)}`;
  }

  function parseHex(color) {
    const value = String(color || "#000000").replace("#", "").padEnd(6, "0").slice(0, 6);
    return [parseInt(value.slice(0, 2), 16) || 0, parseInt(value.slice(2, 4), 16) || 0, parseInt(value.slice(4, 6), 16) || 0];
  }

  function mix(a, b, amount) {
    const left = parseHex(a), right = parseHex(b), t = clamp(amount);
    return `#${[0, 1, 2].map(index => Math.round(left[index] + (right[index] - left[index]) * t).toString(16).padStart(2, "0")).join("")}`;
  }

  function palette(colors, amount) {
    const scaled = clamp(amount) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(scaled));
    return mix(colors[index], colors[index + 1], scaled - index);
  }

  const EFFECTS = {
    aurora: {
      name: "Aurora drift",
      description: "Slow vertical veils that use the tall LED spacing as atmosphere.",
      frameMs: 110,
      colors: ["#02040c", "#10215e", "#1bb6a2", "#9bffb0"]
    },
    tide: {
      name: "Tidal bands",
      description: "Wide horizontal color bands moving like reflected water.",
      frameMs: 125,
      colors: ["#030617", "#0a3d62", "#13b8a6", "#d1fff5"]
    },
    ember: {
      name: "Ember veil",
      description: "Low, rising warmth with soft sparks instead of hard pixels.",
      frameMs: 95,
      colors: ["#070101", "#501008", "#e34b18", "#ffd166"]
    },
    rain: {
      name: "Soft rain",
      description: "Sparse falling traces tuned for the ten-row vertical rhythm.",
      frameMs: 100,
      colors: ["#01030b", "#07325e", "#1b88d1", "#c6f5ff"]
    },
    constellation: {
      name: "Constellation",
      description: "A quiet star field with slow, independent breathing points.",
      frameMs: 145,
      colors: ["#01020a", "#1a2457", "#7f8cff", "#fff1cf"]
    },
    breathe: {
      name: "Color breathing",
      description: "A room-filling color wash with no picture to decode.",
      frameMs: 130,
      colors: ["#06101f", "#4935a8", "#d34e9b", "#ffb56b"]
    }
  };

  function effectPixel(kind, x, y, t, frame) {
    const definition = EFFECTS[kind] || EFFECTS.aurora;
    const nx = x / (WIDTH - 1), ny = y / (HEIGHT - 1);
    if (kind === "tide") {
      const wave = 0.5 + 0.5 * Math.sin(ny * 10.5 - t * Math.PI * 2 + Math.sin(nx * 7 + t * 4) * 0.7);
      return palette(definition.colors, clamp(wave * 0.78 + (1 - ny) * 0.18));
    }
    if (kind === "ember") {
      const lift = fract(ny + t + hash(x, frame % 7) * 0.35);
      const spark = hash(x, y, Math.floor(frame / 3)) > 0.925 ? 0.9 : 0;
      return palette(definition.colors, clamp((1 - ny) * 0.12 + (1 - lift) * 0.55 + spark));
    }
    if (kind === "rain") {
      const lane = hash(x, 0, 4);
      const head = fract(lane + t * (0.6 + hash(x, 1, 4)));
      const distance = Math.min(Math.abs(ny - head), Math.abs(ny - head + 1), Math.abs(ny - head - 1));
      const drop = clamp(1 - distance * 9) * (hash(x, frame % 5, 8) > 0.26 ? 1 : 0.42);
      return palette(definition.colors, drop * 0.95);
    }
    if (kind === "constellation") {
      const star = hash(x, y, 13) > 0.89;
      const pulse = star ? 0.48 + 0.52 * Math.sin(t * Math.PI * 2 + hash(x, y, 22) * Math.PI * 2) : 0;
      return palette(definition.colors, star ? clamp(0.35 + pulse * 0.65) : 0.025 + 0.06 * Math.sin(nx * 4 + t * 5) ** 2);
    }
    if (kind === "breathe") {
      const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
      return palette(definition.colors, clamp(nx * 0.46 + (1 - ny) * 0.22 + pulse * 0.32));
    }
    const curtain = 0.5 + 0.5 * Math.sin(nx * 9 + Math.sin(ny * 3.2 - t * 5) * 2.3 + t * Math.PI * 2);
    const veil = Math.pow(curtain, 2.1) * (0.62 + 0.38 * Math.sin(ny * Math.PI));
    return palette(definition.colors, clamp(veil * 0.88 + (1 - ny) * 0.08));
  }

  function createShow(kind, frameCount = DEFAULT_FRAME_COUNT) {
    const effect = EFFECTS[kind] || EFFECTS.aurora;
    const count = Math.max(2, Math.min(24, Math.round(frameCount)));
    const frames = [];
    for (let frame = 0; frame < count; frame++) {
      const t = frame / count;
      const pixels = [];
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) pixels.push(effectPixel(kind, x, y, t, frame));
      frames.push(pixels);
    }
    return { name: effect.name, frameMs: effect.frameMs, frames };
  }

  function estimateCurrentMa(frame, brightness = 35) {
    const channelLoad = frame.reduce((sum, color) => sum + parseHex(color).reduce((total, value) => total + value / 255, 0), 0);
    return Math.round(channelLoad * 20 * clamp(brightness / 255));
  }

  class Preview {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.options = { glow: 1.15, exposure: 1, grid: false, ...options };
      this.frame = Array(PIXELS).fill("#000000");
      this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.draw()) : null;
      this.resizeObserver?.observe(canvas);
      this.draw();
    }

    setFrame(frame) {
      if (Array.isArray(frame) && frame.length === PIXELS) this.frame = frame;
      this.draw();
    }

    setOptions(options) {
      Object.assign(this.options, options);
      this.draw();
    }

    draw() {
      const ratio = Math.max(1, Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
      const cssWidth = Math.max(240, this.canvas.clientWidth || 380);
      const cssHeight = cssWidth * BOARD_HEIGHT_IN / BOARD_WIDTH_IN;
      const width = Math.round(cssWidth * ratio), height = Math.round(cssHeight * ratio);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const ctx = this.context;
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#080a0d");
      background.addColorStop(0.5, "#030405");
      background.addColorStop(1, "#0a0b0d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const cellW = width / WIDTH, cellH = height / HEIGHT;
      const glow = clamp(this.options.glow, 0.2, 2.5);
      const exposure = clamp(this.options.exposure, 0.25, 2);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.frame.forEach((color, index) => {
        const [r, g, b] = parseHex(color).map(value => Math.min(255, Math.round(value * exposure)));
        if (!(r || g || b)) return;
        const x = (index % WIDTH + 0.5) * cellW;
        const y = (Math.floor(index / WIDTH) + 0.5) * cellH;
        const radius = cellW * (0.78 + glow * 1.5);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, Math.max(1.15, cellH / cellW * 0.72));
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, `rgba(${r},${g},${b},.96)`);
        gradient.addColorStop(0.24, `rgba(${r},${g},${b},.55)`);
        gradient.addColorStop(0.66, `rgba(${r},${g},${b},.14)`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        ctx.restore();
      });
      ctx.restore();

      if (this.options.grid) {
        ctx.strokeStyle = "rgba(255,255,255,.075)";
        ctx.lineWidth = ratio;
        for (let x = 1; x < WIDTH; x++) { ctx.beginPath(); ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, height); ctx.stroke(); }
        for (let y = 1; y < HEIGHT; y++) { ctx.beginPath(); ctx.moveTo(0, y * cellH); ctx.lineTo(width, y * cellH); ctx.stroke(); }
      }
    }
  }

  return { WIDTH, HEIGHT, PIXELS, BOARD_WIDTH_IN, BOARD_HEIGHT_IN, EFFECTS, createShow, estimateCurrentMa, Preview };
}));
