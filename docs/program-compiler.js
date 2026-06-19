(function (global) {
  "use strict";

  const WIDTH = 28;
  const HEIGHT = 10;
  const PIXELS = WIDTH * HEIGHT;
  const MAX_FRAMES = 24;
  const MAX_LAYERS = 40;
  const BLEND_MODES = ["normal", "add", "screen", "multiply", "overlay", "mask"];
  const TRANSPARENT = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const indexOf = (x, y) => y * WIDTH + x;
  const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  const colorParam = (defaultValue = "#ffffff") => ({ type: "color", default: defaultValue });
  const numberParam = (defaultValue, min, max, coordinate = null) => ({ type: "number", default: defaultValue, min, max, coordinate });
  const integerParam = (defaultValue, min, max, coordinate = null) => ({ type: "integer", default: defaultValue, min, max, coordinate });
  const booleanParam = defaultValue => ({ type: "boolean", default: defaultValue });
  const enumParam = (defaultValue, values) => ({ type: "enum", default: defaultValue, values });
  const stringParam = (defaultValue = "", maxLength = 64) => ({ type: "string", default: defaultValue, maxLength });

  function hexToRgb(color) {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    const value = parseInt(color.slice(1), 16);
    return { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
  }

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(value => clamp(Math.round(Number.isFinite(value) ? value : 0), 0, 255).toString(16).padStart(2, "0")).join("");
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s / 100, 0, 1);
    l = clamp(l / 100, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
  }

  function seededRandom(seed) {
    let state = (seed >>> 0) || 0x9e3779b9;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeLayer() {
    return Array(PIXELS).fill(TRANSPARENT);
  }

  function setPixel(grid, x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (inBounds(x, y)) grid[indexOf(x, y)] = color;
  }

  function drawLine(grid, x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      setPixel(grid, x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  function animatedPoint(params, context, x, y) {
    const motion = params.motion || "none";
    const speed = params.motionSpeed == null ? 1 : params.motionSpeed;
    const amplitude = params.amplitude == null ? 2 : params.amplitude;
    const phase = (params.phase || 0) * Math.PI * 2;
    const wave = context.progress * Math.PI * 2 * speed + phase;
    if (motion === "scroll_left") x -= context.progress * WIDTH * speed;
    if (motion === "scroll_right") x += context.progress * WIDTH * speed;
    if (motion === "scroll_up") y -= context.progress * HEIGHT * speed;
    if (motion === "scroll_down") y += context.progress * HEIGHT * speed;
    if (motion === "wrap_left") x = ((x - context.progress * WIDTH * speed) % WIDTH + WIDTH) % WIDTH;
    if (motion === "wrap_right") x = ((x + context.progress * WIDTH * speed) % WIDTH + WIDTH) % WIDTH;
    if (motion === "wrap_up") y = ((y - context.progress * HEIGHT * speed) % HEIGHT + HEIGHT) % HEIGHT;
    if (motion === "wrap_down") y = ((y + context.progress * HEIGHT * speed) % HEIGHT + HEIGHT) % HEIGHT;
    if (motion === "bounce_x") x += Math.sin(wave) * amplitude;
    if (motion === "bounce_y") y += Math.sin(wave) * amplitude;
    if (motion === "orbit") { x += Math.cos(wave) * amplitude; y += Math.sin(wave) * amplitude; }
    return { x, y };
  }

  function animatedAlpha(params, context) {
    const motion = params.motion || "none";
    const speed = params.motionSpeed == null ? 1 : params.motionSpeed;
    const phase = (params.phase || 0) * Math.PI * 2;
    const wave = context.progress * Math.PI * 2 * speed + phase;
    if (motion === "pulse") return 0.25 + (Math.sin(wave) + 1) * 0.375;
    if (motion === "flicker") return 0.35 + context.random() * 0.65;
    return 1;
  }

  const MOTION_PARAMS = {
    motion: enumParam("none", ["none", "scroll_left", "scroll_right", "scroll_up", "scroll_down", "wrap_left", "wrap_right", "wrap_up", "wrap_down", "bounce_x", "bounce_y", "orbit", "pulse", "flicker"]),
    motionSpeed: numberParam(1, 0, 8),
    amplitude: numberParam(2, 0, 28, "pixels"),
    phase: numberParam(0, 0, 1, "normalized")
  };

  function withMotion(params) {
    return Object.assign({}, params, MOTION_PARAMS);
  }

  function renderSolid(context, params) {
    return Array(PIXELS).fill(params.color);
  }

  function renderGradient(context, params) {
    const grid = makeLayer();
    const first = hexToRgb(params.color1), second = hexToRgb(params.color2);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const t = params.direction === "vertical" ? y / (HEIGHT - 1) : params.direction === "diagonal" ? (x / (WIDTH - 1) + y / (HEIGHT - 1)) / 2 : x / (WIDTH - 1);
      grid[indexOf(x, y)] = rgbToHex(first.r + (second.r - first.r) * t, first.g + (second.g - first.g) * t, first.b + (second.b - first.b) * t);
    }
    return grid;
  }

  function renderRadialGradient(context, params) {
    const grid = makeLayer(), inner = hexToRgb(params.innerColor), outer = hexToRgb(params.outerColor);
    const center = animatedPoint(params, context, params.cx, params.cy);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const t = clamp(Math.hypot(x - center.x, y - center.y) / params.radius, 0, 1);
      grid[indexOf(x, y)] = rgbToHex(inner.r + (outer.r - inner.r) * t, inner.g + (outer.g - inner.g) * t, inner.b + (outer.b - inner.b) * t);
    }
    return grid;
  }

  function renderRainbow(context, params) {
    const grid = makeLayer();
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const axis = params.direction === "vertical" ? y / HEIGHT : x / WIDTH;
      grid[indexOf(x, y)] = hslToHex(params.hueOffset + axis * 360 + context.progress * params.speed * 360, params.saturation, params.lightness);
    }
    return grid;
  }

  function renderPixel(context, params) {
    const grid = makeLayer(), point = animatedPoint(params, context, params.x, params.y);
    setPixel(grid, point.x, point.y, params.color);
    return grid;
  }

  function renderLine(context, params) {
    const grid = makeLayer();
    const a = animatedPoint(params, context, params.x1, params.y1), b = animatedPoint(params, context, params.x2, params.y2);
    drawLine(grid, a.x, a.y, b.x, b.y, params.color);
    return grid;
  }

  function renderRectangle(context, params) {
    const grid = makeLayer(), point = animatedPoint(params, context, params.x, params.y);
    const x0 = Math.round(point.x), y0 = Math.round(point.y), width = Math.round(params.width), height = Math.round(params.height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (params.filled || x === 0 || y === 0 || x === width - 1 || y === height - 1) setPixel(grid, x0 + x, y0 + y, params.color);
    }
    return grid;
  }

  function renderCircle(context, params) {
    const grid = makeLayer(), center = animatedPoint(params, context, params.cx, params.cy), radius = params.radius;
    for (let y = Math.floor(center.y - radius); y <= Math.ceil(center.y + radius); y++) for (let x = Math.floor(center.x - radius); x <= Math.ceil(center.x + radius); x++) {
      const distance = Math.hypot(x - center.x, y - center.y);
      if ((params.filled && distance <= radius) || (!params.filled && Math.abs(distance - radius) < 0.65)) setPixel(grid, x, y, params.color);
    }
    return grid;
  }

  function fillPolygon(grid, points, color) {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        const crosses = (a.y > y + 0.5) !== (b.y > y + 0.5);
        if (crosses && x + 0.5 < (b.x - a.x) * (y + 0.5 - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) setPixel(grid, x, y, color);
    }
  }

  function renderTriangle(context, params) {
    const grid = makeLayer();
    const points = [[params.x1, params.y1], [params.x2, params.y2], [params.x3, params.y3]].map(point => animatedPoint(params, context, point[0], point[1]));
    if (params.filled) fillPolygon(grid, points, params.color);
    drawLine(grid, points[0].x, points[0].y, points[1].x, points[1].y, params.color);
    drawLine(grid, points[1].x, points[1].y, points[2].x, points[2].y, params.color);
    drawLine(grid, points[2].x, points[2].y, points[0].x, points[0].y, params.color);
    return grid;
  }

  function renderPolygon(context, params) {
    const grid = makeLayer();
    const points = params.points.map(point => animatedPoint(params, context, point[0], point[1]));
    if (params.filled) fillPolygon(grid, points, params.color);
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      drawLine(grid, points[i].x, points[i].y, next.x, next.y, params.color);
    }
    return grid;
  }

  function renderStars(context, params) {
    const grid = makeLayer();
    const positions = seededRandom(hashText(params.seed));
    const twinkle = seededRandom(hashText(params.seed) + context.frame * 101);
    for (let i = 0; i < params.count; i++) {
      const x = Math.floor(positions() * WIDTH), y = Math.floor(positions() * HEIGHT);
      if (!params.twinkle || twinkle() > 0.35) setPixel(grid, x, y, params.color);
    }
    return grid;
  }

  function renderBuilding(context, params) {
    return renderRectangle(context, Object.assign({}, params, { filled: true }));
  }

  function renderWindows(context, params) {
    const grid = makeLayer(), origin = animatedPoint(params, context, params.x, params.y);
    const random = seededRandom(hashText(params.seed));
    for (let row = 0; row < params.rows; row++) for (let column = 0; column < params.columns; column++) {
      if (random() <= params.litChance) setPixel(grid, origin.x + column * params.spacingX, origin.y + row * params.spacingY, params.color);
    }
    return grid;
  }

  function renderMoon(context, params) {
    const grid = renderCircle(context, Object.assign({}, params, { color: params.color, filled: true }));
    const cutout = renderCircle(context, { cx: params.cx + params.cutout, cy: params.cy - 1, radius: params.radius, color: "#000000", filled: true, motion: params.motion, motionSpeed: params.motionSpeed, amplitude: params.amplitude, phase: params.phase });
    for (let i = 0; i < PIXELS; i++) if (cutout[i]) grid[i] = TRANSPARENT;
    return grid;
  }

  function renderCloud(context, params) {
    const grid = makeLayer(), origin = animatedPoint(params, context, params.x, params.y);
    for (const offset of [[0, 1, 2], [2, 0, 2], [4, 1, 2]]) {
      const circle = renderCircle(context, { cx: origin.x + offset[0], cy: origin.y + offset[1], radius: offset[2], color: params.color, filled: true, motion: "none" });
      for (let i = 0; i < PIXELS; i++) if (circle[i]) grid[i] = circle[i];
    }
    return grid;
  }

  function renderRoad(context, params) {
    const grid = makeLayer();
    for (let y = params.y; y < params.y + params.height; y++) for (let x = 0; x < WIDTH; x++) setPixel(grid, x, y, params.color);
    if (params.markings) for (let x = (context.frame * params.speed) % 6 - 3; x < WIDTH; x += 6) setPixel(grid, x, params.y, params.markingColor);
    return grid;
  }

  function renderParticles(context, params, kind) {
    const grid = makeLayer(), random = seededRandom(hashText(params.seed));
    for (let i = 0; i < params.count; i++) {
      const baseX = random() * WIDTH, baseY = random() * HEIGHT;
      const speed = params.speed * (0.5 + random());
      let x = baseX, y = baseY;
      if (kind === "rain" || kind === "snow") y = (baseY + context.progress * HEIGHT * speed) % HEIGHT;
      if (kind === "snow") x += Math.sin(context.progress * Math.PI * 2 + i) * params.drift;
      if (kind === "sparks") { x += Math.cos(i * 2.4) * context.progress * speed * 8; y -= Math.sin(i * 1.7) * context.progress * speed * 5; }
      setPixel(grid, x, y, params.color);
    }
    return grid;
  }

  function renderNoise(context, params) {
    const grid = makeLayer(), random = seededRandom(hashText(params.seed) + context.frame * 997);
    const base = hexToRgb(params.color);
    for (let i = 0; i < PIXELS; i++) {
      const value = params.amount * random();
      grid[i] = rgbToHex(base.r * value, base.g * value, base.b * value);
    }
    return grid;
  }

  function renderPlasma(context, params) {
    const grid = makeLayer();
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const value = Math.sin(x * params.scale + context.progress * params.speed * 6.28) + Math.cos(y * params.scale * 1.7 - context.progress * params.speed * 4.2);
      grid[indexOf(x, y)] = hslToHex(params.hue + value * 50, params.saturation, 35 + (value + 2) * 12);
    }
    return grid;
  }

  function renderWaves(context, params) {
    const grid = makeLayer();
    for (let x = 0; x < WIDTH; x++) {
      const y = params.cy + Math.sin(x * params.frequency + context.progress * params.speed * Math.PI * 2) * params.amplitude;
      setPixel(grid, x, y, params.color);
    }
    return grid;
  }

  function renderText(context, params) {
    const grid = Array(PIXELS).fill("#000000");
    const bold = params.font === "bold";
    const spacing = bold ? 7 : 6;
    const origin = animatedPoint(params, context, params.x, params.y);
    if (typeof global.drawCharOnGrid !== "function") throw Error("Text renderer is not loaded");
    for (let i = 0; i < params.text.length; i++) global.drawCharOnGrid(grid, params.text[i], origin.x + i * spacing, origin.y, params.color, bold);
    return grid.map(color => color === "#000000" ? TRANSPARENT : color);
  }

  function adjustColors(grid, params, type) {
    return grid.map(color => {
      if (!color) return color;
      const rgb = hexToRgb(color);
      let r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
      if (type === "brightness") r *= params.amount, g *= params.amount, b *= params.amount;
      if (type === "contrast") r = (r - 0.5) * params.amount + 0.5, g = (g - 0.5) * params.amount + 0.5, b = (b - 0.5) * params.amount + 0.5;
      if (type === "saturation") {
        const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
        r = gray + (r - gray) * params.amount; g = gray + (g - gray) * params.amount; b = gray + (b - gray) * params.amount;
      }
      if (type === "gamma") r = Math.pow(clamp(r, 0, 1), 1 / params.amount), g = Math.pow(clamp(g, 0, 1), 1 / params.amount), b = Math.pow(clamp(b, 0, 1), 1 / params.amount);
      if (type === "tint") {
        const tint = hexToRgb(params.color);
        r = r * (1 - params.amount) + tint.r / 255 * params.amount;
        g = g * (1 - params.amount) + tint.g / 255 * params.amount;
        b = b * (1 - params.amount) + tint.b / 255 * params.amount;
      }
      return rgbToHex(r * 255, g * 255, b * 255);
    });
  }

  function blendPixel(baseColor, layerColor, mode, opacity) {
    if (!layerColor) return baseColor;
    if (mode === "mask") return layerColor === "#000000" ? "#000000" : baseColor;
    const base = hexToRgb(baseColor || "#000000"), layer = hexToRgb(layerColor);
    const blendChannel = (b, l) => {
      if (mode === "add") return Math.min(255, b + l);
      if (mode === "screen") return 255 - (255 - b) * (255 - l) / 255;
      if (mode === "multiply") return b * l / 255;
      if (mode === "overlay") return b < 128 ? 2 * b * l / 255 : 255 - 2 * (255 - b) * (255 - l) / 255;
      return l;
    };
    return rgbToHex(
      base.r + (blendChannel(base.r, layer.r) - base.r) * opacity,
      base.g + (blendChannel(base.g, layer.g) - base.g) * opacity,
      base.b + (blendChannel(base.b, layer.b) - base.b) * opacity
    );
  }

  function definition(category, description, params, example, render, kind = "visual") {
    return { category, description, params, example, render, kind };
  }

  const REGISTRY = {
    solid: definition("Fill", "Fill the complete matrix with one color.", { color: colorParam("#101828") }, { color: "#101828" }, renderSolid),
    gradient: definition("Fill", "Horizontal, vertical, or diagonal two-color gradient.", { color1: colorParam("#07152e"), color2: colorParam("#ff477e"), direction: enumParam("vertical", ["horizontal", "vertical", "diagonal"]) }, { color1: "#07152e", color2: "#ff477e", direction: "vertical" }, renderGradient),
    radial_gradient: definition("Fill", "Radial color blend centered on pixel coordinates.", withMotion({ innerColor: colorParam("#ffe66d"), outerColor: colorParam("#07152e"), cx: numberParam(13.5, -28, 56, "pixels"), cy: numberParam(4.5, -10, 20, "pixels"), radius: numberParam(10, 0.5, 60, "pixels") }), { innerColor: "#ffe66d", outerColor: "#07152e", cx: 14, cy: 5, radius: 10 }, renderRadialGradient),
    rainbow: definition("Fill", "Animated hue field.", { direction: enumParam("horizontal", ["horizontal", "vertical"]), hueOffset: numberParam(0, 0, 360), saturation: numberParam(100, 0, 100), lightness: numberParam(50, 0, 100), speed: numberParam(1, -8, 8) }, { direction: "horizontal", speed: 1 }, renderRainbow),
    pixel: definition("Drawing", "One addressable logical pixel.", withMotion({ x: numberParam(0, -28, 56, "pixels"), y: numberParam(0, -10, 20, "pixels"), color: colorParam() }), { x: 4, y: 3, color: "#ffffff" }, renderPixel),
    line: definition("Drawing", "Bresenham line between two pixel coordinates.", withMotion({ x1: numberParam(0, -28, 56, "pixels"), y1: numberParam(0, -10, 20, "pixels"), x2: numberParam(27, -28, 56, "pixels"), y2: numberParam(9, -10, 20, "pixels"), color: colorParam() }), { x1: 0, y1: 9, x2: 27, y2: 2, color: "#38d9d6" }, renderLine),
    rectangle: definition("Drawing", "Filled or outlined rectangle primitive.", withMotion({ x: numberParam(0, -28, 56, "pixels"), y: numberParam(0, -10, 20, "pixels"), width: integerParam(6, 1, 56, "pixels"), height: integerParam(4, 1, 20, "pixels"), color: colorParam(), filled: booleanParam(true) }), { x: 4, y: 3, width: 8, height: 5, color: "#4d96ff", filled: true }, renderRectangle),
    circle: definition("Drawing", "Filled or outlined circle primitive.", withMotion({ cx: numberParam(14, -28, 56, "pixels"), cy: numberParam(5, -10, 20, "pixels"), radius: numberParam(3, 0.5, 30, "pixels"), color: colorParam(), filled: booleanParam(true) }), { cx: 14, cy: 5, radius: 3, color: "#ffe66d", filled: true }, renderCircle),
    triangle: definition("Drawing", "Triangle outline built from three points.", withMotion({ x1: numberParam(14, -28, 56, "pixels"), y1: numberParam(1, -10, 20, "pixels"), x2: numberParam(8, -28, 56, "pixels"), y2: numberParam(8, -10, 20, "pixels"), x3: numberParam(20, -28, 56, "pixels"), y3: numberParam(8, -10, 20, "pixels"), color: colorParam(), filled: booleanParam(false) }), { x1: 14, y1: 1, x2: 8, y2: 8, x3: 20, y3: 8, color: "#ff477e", filled: true }, renderTriangle),
    polygon: definition("Drawing", "Closed polygon outline from an array of [x,y] points.", withMotion({ points: { type: "points", required: true, minItems: 3, maxItems: 16 }, color: colorParam(), filled: booleanParam(false) }), { points: [[3, 8], [8, 2], [14, 8]], color: "#8cff98", filled: true }, renderPolygon),
    stars: definition("Objects", "Deterministic star field with optional twinkle.", { count: integerParam(18, 1, 100), color: colorParam("#ffffff"), seed: stringParam("stars"), twinkle: booleanParam(true) }, { count: 18, color: "#ffffff", seed: "sky-1", twinkle: true }, renderStars),
    building: definition("Objects", "Filled building block; combine with windows.", withMotion({ x: numberParam(2, -28, 56, "pixels"), y: numberParam(4, -10, 20, "pixels"), width: integerParam(6, 1, 56), height: integerParam(6, 1, 20), color: colorParam("#111827") }), { x: 2, y: 4, width: 7, height: 6, color: "#111827" }, renderBuilding),
    windows: definition("Objects", "Deterministic grid of lit window pixels.", withMotion({ x: numberParam(3, -28, 56, "pixels"), y: numberParam(5, -10, 20, "pixels"), columns: integerParam(3, 1, 20), rows: integerParam(2, 1, 10), spacingX: integerParam(2, 1, 8), spacingY: integerParam(2, 1, 8), color: colorParam("#ffe66d"), litChance: numberParam(0.7, 0, 1), seed: stringParam("windows") }), { x: 3, y: 5, columns: 3, rows: 2, spacingX: 2, spacingY: 2, color: "#ffe66d", litChance: 0.7 }, renderWindows),
    sun: definition("Objects", "Sun disk built from a filled circle.", withMotion({ cx: numberParam(22, -28, 56, "pixels"), cy: numberParam(2, -10, 20, "pixels"), radius: numberParam(2.5, 0.5, 20), color: colorParam("#ffe66d"), filled: booleanParam(true) }), { cx: 22, cy: 2, radius: 2.5, color: "#ffe66d" }, renderCircle),
    moon: definition("Objects", "Crescent moon with configurable cutout.", withMotion({ cx: numberParam(22, -28, 56, "pixels"), cy: numberParam(2, -10, 20, "pixels"), radius: numberParam(2.5, 0.5, 20), cutout: numberParam(1.5, -10, 10), color: colorParam("#dce7f5") }), { cx: 22, cy: 2, radius: 2.5, cutout: 1.5, color: "#dce7f5" }, renderMoon),
    cloud: definition("Objects", "Three-disk cloud primitive.", withMotion({ x: numberParam(4, -28, 56, "pixels"), y: numberParam(2, -10, 20, "pixels"), color: colorParam("#cbd5e1") }), { x: 4, y: 2, color: "#cbd5e1", motion: "scroll_right", motionSpeed: 0.5 }, renderCloud),
    road: definition("Objects", "Road strip with animated markings.", { y: integerParam(8, 0, 9, "pixels"), height: integerParam(2, 1, 10), color: colorParam("#252a34"), markings: booleanParam(true), markingColor: colorParam("#ffe66d"), speed: numberParam(1, -8, 8) }, { y: 8, height: 2, color: "#252a34", markings: true, markingColor: "#ffe66d" }, renderRoad),
    rain: definition("Particles", "Deterministic falling rain particles.", { count: integerParam(22, 1, 100), color: colorParam("#38d9d6"), speed: numberParam(1, 0, 10), seed: stringParam("rain"), drift: numberParam(0, 0, 10) }, { count: 22, color: "#38d9d6", speed: 1.4, seed: "storm" }, (context, params) => renderParticles(context, params, "rain")),
    snow: definition("Particles", "Falling particles with horizontal drift.", { count: integerParam(20, 1, 100), color: colorParam("#ffffff"), speed: numberParam(0.5, 0, 10), seed: stringParam("snow"), drift: numberParam(1.5, 0, 10) }, { count: 20, color: "#ffffff", speed: 0.5, drift: 1.5 }, (context, params) => renderParticles(context, params, "snow")),
    sparks: definition("Particles", "Radial spark burst.", { count: integerParam(16, 1, 100), color: colorParam("#ff9f1c"), speed: numberParam(1, 0, 10), seed: stringParam("sparks"), drift: numberParam(0, 0, 10) }, { count: 16, color: "#ff9f1c", speed: 1 }, (context, params) => renderParticles(context, params, "sparks")),
    noise: definition("Procedural", "Seeded monochrome noise texture.", { color: colorParam("#9d8cff"), amount: numberParam(1, 0, 2), seed: stringParam("noise") }, { color: "#9d8cff", amount: 1, seed: "grain" }, renderNoise),
    plasma: definition("Procedural", "Animated sine/cosine plasma field.", { hue: numberParam(220, 0, 360), saturation: numberParam(85, 0, 100), scale: numberParam(0.35, 0.01, 4), speed: numberParam(1, -8, 8) }, { hue: 220, saturation: 85, scale: 0.35, speed: 1 }, renderPlasma),
    waves: definition("Procedural", "Animated sine wave line.", { cy: numberParam(5, -10, 20, "pixels"), amplitude: numberParam(2, 0, 20, "pixels"), frequency: numberParam(0.5, 0.01, 8), speed: numberParam(1, -8, 8), color: colorParam("#4d96ff") }, { cy: 5, amplitude: 2, frequency: 0.5, speed: 1, color: "#4d96ff" }, renderWaves),
    text: definition("Text", "Static or motion-enabled 5x7/6x8 text.", withMotion({ text: stringParam("HELLO", 32), x: numberParam(0, -200, 200, "pixels"), y: numberParam(1, -10, 20, "pixels"), color: colorParam(), font: enumParam("bold", ["bold", "standard"]) }), { text: "CITY", x: 1, y: 1, color: "#ff477e", font: "bold" }, renderText),
    brightness: definition("Adjustments", "Multiply accumulated RGB brightness.", { amount: numberParam(1.25, 0, 4) }, { amount: 1.25 }, (context, params, grid) => adjustColors(grid, params, "brightness"), "adjustment"),
    contrast: definition("Adjustments", "Adjust accumulated contrast around 50% gray.", { amount: numberParam(1.1, 0, 4) }, { amount: 1.1 }, (context, params, grid) => adjustColors(grid, params, "contrast"), "adjustment"),
    saturation: definition("Adjustments", "Adjust accumulated color saturation.", { amount: numberParam(1.2, 0, 4) }, { amount: 1.2 }, (context, params, grid) => adjustColors(grid, params, "saturation"), "adjustment"),
    gamma: definition("Adjustments", "Apply gamma correction to accumulated colors.", { amount: numberParam(1.4, 0.1, 4) }, { amount: 1.4 }, (context, params, grid) => adjustColors(grid, params, "gamma"), "adjustment"),
    tint: definition("Adjustments", "Blend accumulated colors toward a tint.", { color: colorParam("#ff477e"), amount: numberParam(0.2, 0, 1) }, { color: "#ff477e", amount: 0.2 }, (context, params, grid) => adjustColors(grid, params, "tint"), "adjustment")
  };

  function levenshtein(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return rows[a.length][b.length];
  }

  function closest(value, choices) {
    return choices.map(choice => ({ choice, score: levenshtein(value, choice) })).sort((a, b) => a.score - b.score)[0]?.choice;
  }

  function sanitizeJsonText(text) {
    let repaired = String(text || "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^\s*```(?:json)?/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const objectStart = repaired.indexOf("{");
    const arrayStart = repaired.indexOf("[");
    const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
    const end = Math.max(repaired.lastIndexOf("}"), repaired.lastIndexOf("]"));
    if (start >= 0 && end >= start) repaired = repaired.slice(start, end + 1);
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    return repaired;
  }

  function normalizeParam(value, schema, path, warnings, errors) {
    if (value == null) {
      if (schema.required) errors.push({ path, message: "is required" });
      return structuredClone(schema.default);
    }
    if (schema.type === "number" || schema.type === "integer") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) { errors.push({ path, message: "must be a finite number" }); return schema.default; }
      let normalized = schema.type === "integer" ? Math.round(parsed) : parsed;
      const clamped = clamp(normalized, schema.min, schema.max);
      if (clamped !== normalized) warnings.push({ path, message: `clamped from ${normalized} to ${clamped}` });
      return clamped;
    }
    if (schema.type === "boolean") {
      if (typeof value !== "boolean") { errors.push({ path, message: "must be true or false" }); return schema.default; }
      return value;
    }
    if (schema.type === "string") {
      if (typeof value !== "string") { errors.push({ path, message: "must be a string" }); return schema.default; }
      if (value.length > schema.maxLength) warnings.push({ path, message: `truncated to ${schema.maxLength} characters` });
      return value.slice(0, schema.maxLength);
    }
    if (schema.type === "color") {
      if (!hexToRgb(value)) { errors.push({ path, message: "must be a CSS #RRGGBB color" }); return schema.default; }
      return value.toLowerCase();
    }
    if (schema.type === "enum") {
      if (!schema.values.includes(value)) {
        const suggestion = closest(String(value), schema.values);
        errors.push({ path, message: `must be one of ${schema.values.join(", ")}${suggestion ? `; did you mean ${suggestion}?` : ""}` });
        return schema.default;
      }
      return value;
    }
    if (schema.type === "points") {
      if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems || value.some(point => !Array.isArray(point) || point.length !== 2 || point.some(number => !Number.isFinite(Number(number))))) {
        errors.push({ path, message: `must contain ${schema.minItems}-${schema.maxItems} [x,y] pairs` });
        return [];
      }
      return value.map(point => [clamp(Number(point[0]), -WIDTH, WIDTH * 2), clamp(Number(point[1]), -HEIGHT, HEIGHT * 2)]);
    }
    return value;
  }

  function normalizeProgram(input, options = {}) {
    const warnings = [], errors = [], skippedLayers = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) return { program: null, warnings, errors: [{ path: "$", message: "must be a JSON object" }], skippedLayers };
    const program = {
      schemaVersion: 2,
      name: typeof input.name === "string" ? input.name.slice(0, 80) : "Custom LED Program",
      width: WIDTH,
      height: HEIGHT,
      frameMs: clamp(Math.round(Number(input.frameMs) || 100), 50, 5000),
      frameCount: clamp(Math.round(Number(input.frameCount) || 12), 1, MAX_FRAMES),
      brightness: clamp(Number(input.brightness) || 1, 0.05, 3),
      layers: []
    };
    if (input.schemaVersion !== 2) warnings.push({ path: "schemaVersion", message: "set to current version 2" });
    if (input.width != null && Number(input.width) !== WIDTH) warnings.push({ path: "width", message: `logical width forced to ${WIDTH}` });
    if (input.height != null && Number(input.height) !== HEIGHT) warnings.push({ path: "height", message: `logical height forced to ${HEIGHT}` });
    const layers = Array.isArray(input.layers) ? input.layers : [];
    if (!Array.isArray(input.layers)) errors.push({ path: "layers", message: "must be an array" });
    if (layers.length > MAX_LAYERS) errors.push({ path: "layers", message: `exceeds maximum ${MAX_LAYERS} layers` });
    layers.slice(0, MAX_LAYERS).forEach((layer, index) => {
      const path = `layers[${index}]`;
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) { errors.push({ path, message: "must be an object" }); skippedLayers.push(index); return; }
      const type = String(layer.type || "");
      const definition = REGISTRY[type];
      if (!definition) {
        const suggestion = closest(type, Object.keys(REGISTRY));
        errors.push({ path: `${path}.type`, message: `unknown block '${type}'${suggestion ? `; did you mean '${suggestion}'?` : ""}` });
        skippedLayers.push(index);
        return;
      }
      const layerErrorsBefore = errors.length;
      const rawParams = layer.params && typeof layer.params === "object" && !Array.isArray(layer.params) ? layer.params : {};
      if (layer.params != null && rawParams !== layer.params) errors.push({ path: `${path}.params`, message: "must be an object" });
      for (const parameter of Object.keys(rawParams)) {
        if (!(parameter in definition.params)) {
          const suggestion = closest(parameter, Object.keys(definition.params));
          warnings.push({ path: `${path}.params.${parameter}`, message: `unsupported parameter removed${suggestion ? `; did you mean '${suggestion}'?` : ""}` });
        }
      }
      const params = {};
      for (const [parameter, schema] of Object.entries(definition.params)) params[parameter] = normalizeParam(rawParams[parameter], schema, `${path}.params.${parameter}`, warnings, errors);
      const blend = BLEND_MODES.includes(layer.blend) ? layer.blend : "normal";
      if (layer.blend != null && blend !== layer.blend) warnings.push({ path: `${path}.blend`, message: `unsupported blend '${layer.blend}' replaced with normal` });
      if (errors.length > layerErrorsBefore && options.partial !== false) { skippedLayers.push(index); return; }
      program.layers.push({
        id: typeof layer.id === "string" && layer.id ? layer.id : `${type}-${index + 1}`,
        type,
        enabled: layer.enabled !== false,
        opacity: layer.opacity == null ? 1 : clamp(Number(layer.opacity), 0, 1),
        blend,
        params
      });
    });
    if (!program.layers.length) errors.push({ path: "layers", message: "contains no valid renderable blocks" });
    return { program, warnings, errors, skippedLayers };
  }

  function compileProgram(input, options = {}) {
    const validation = normalizeProgram(input, { partial: options.partial !== false });
    if (!validation.program || (!options.partial && validation.errors.length) || !validation.program.layers.length) return Object.assign(validation, { frames: [] });
    const program = validation.program;
    const operationCost = program.frameCount * PIXELS * program.layers.length;
    if (operationCost > 300000) {
      validation.errors.push({ path: "$", message: `program complexity ${operationCost} exceeds safe limit 300000` });
      return Object.assign(validation, { frames: [] });
    }
    const frames = [];
    for (let frame = 0; frame < program.frameCount; frame++) {
      let grid = Array(PIXELS).fill("#000000");
      const progress = frame / program.frameCount;
      for (let layerIndex = 0; layerIndex < program.layers.length; layerIndex++) {
        const layer = program.layers[layerIndex];
        if (!layer.enabled) continue;
        const definition = REGISTRY[layer.type];
        const random = seededRandom(hashText(layer.id) + frame * 65537);
        const context = { frame, frameCount: program.frameCount, progress, timeMs: frame * program.frameMs, random };
        try {
          if (definition.kind === "adjustment") grid = definition.render(context, layer.params, grid);
          else {
            const rendered = definition.render(context, layer.params);
            if (!Array.isArray(rendered) || rendered.length !== PIXELS) throw Error(`renderer returned ${rendered?.length ?? "no"} pixels instead of ${PIXELS}`);
            const alpha = layer.opacity * animatedAlpha(layer.params, context);
            grid = grid.map((base, index) => blendPixel(base, rendered[index], layer.blend, alpha));
          }
        } catch (error) {
          validation.errors.push({ path: `frames[${frame}].layers[${layerIndex}]`, message: error.message });
          if (options.partial === false) return Object.assign(validation, { frames: [] });
        }
      }
      if (grid.some(color => !hexToRgb(color))) {
        validation.errors.push({ path: `frames[${frame}]`, message: "renderer produced an invalid or transparent final pixel" });
        return Object.assign(validation, { frames: [] });
      }
      if (program.brightness !== 1) grid = adjustColors(grid, { amount: program.brightness }, "brightness");
      frames.push(grid);
    }
    return Object.assign(validation, { frames, project: { name: program.name, frameMs: program.frameMs, frames, sourceProgram: program } });
  }

  function detectJsonKind(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && (value.schemaVersion != null || Array.isArray(value.layers))) return "program";
    if (value && typeof value === "object" && Array.isArray(value.frames)) return "slideshow";
    if (value && typeof value === "object" && Array.isArray(value.pixels)) return "single-slide";
    if (Array.isArray(value) && value.length === PIXELS) return "raw-frame";
    return "unknown";
  }

  function importJson(text, options = {}) {
    const repairedText = sanitizeJsonText(text);
    let value;
    try { value = JSON.parse(repairedText); }
    catch (error) { return { kind: "invalid", value: null, repairedText, warnings: [], errors: [{ path: "$", message: `JSON parse failed: ${error.message}` }] }; }
    const kind = detectJsonKind(value);
    if (kind === "program") return Object.assign({ kind, value, repairedText }, compileProgram(value, { partial: options.partial !== false }));
    if (kind === "slideshow") return { kind, value, repairedText, warnings: [], errors: [] };
    if (kind === "single-slide") return { kind, value: { name: value.name || "Imported slide", frameMs: value.frameMs || 250, frames: [value.pixels] }, repairedText, warnings: [], errors: [] };
    if (kind === "raw-frame") return { kind, value: { name: "Imported frame", frameMs: 250, frames: [value] }, repairedText, warnings: [], errors: [] };
    return { kind, value, repairedText, warnings: [], errors: [{ path: "$", message: "input is not a v2 program, slideshow, single slide, or 280-color raw frame" }] };
  }

  function serializableRegistry() {
    const output = {};
    for (const [type, definition] of Object.entries(REGISTRY)) {
      output[type] = { category: definition.category, description: definition.description, kind: definition.kind, params: definition.params, example: definition.example };
    }
    return output;
  }

  function buildAiPrompt(mode = "custom program") {
    const schema = JSON.stringify({ schemaVersion: 2, width: WIDTH, height: HEIGHT, frameMs: "50-5000", frameCount: `1-${MAX_FRAMES}`, brightness: "0.05-3", blends: BLEND_MODES, blocks: serializableRegistry() }, null, 2);
    return `Create a ${mode} for a 28x10 addressable LED diffuser.\nReturn JSON only, with straight double quotes and schemaVersion 2.\nNever invent layer types, parameter names, blend modes, or nested parameter objects.\nUse only values allowed by the live schema below. Coordinates are logical pixels unless marked normalized.\nPrefer reusable primitive blocks. Keep at most ${MAX_LAYERS} layers and ${MAX_FRAMES} frames.\nEvery layer must include id, type, enabled, opacity, blend, and params.\n\nLIVE SCHEMA:\n${schema}`;
  }

  global.LEDCompiler = {
    WIDTH, HEIGHT, PIXELS, MAX_FRAMES, MAX_LAYERS, BLEND_MODES,
    registry: REGISTRY,
    sanitizeJsonText,
    importJson,
    normalizeProgram,
    compileProgram,
    schema: serializableRegistry,
    buildAiPrompt,
    adjustFrame: (frame, adjustments) => {
      let output = frame.slice();
      for (const type of ["brightness", "contrast", "saturation", "gamma"]) {
        const amount = adjustments?.[type] ?? 1;
        output = adjustColors(output, { amount }, type);
      }
      if (adjustments?.tint && adjustments.tintAmount > 0) output = adjustColors(output, { color: adjustments.tint, amount: adjustments.tintAmount }, "tint");
      return output;
    }
  };
})(window);
