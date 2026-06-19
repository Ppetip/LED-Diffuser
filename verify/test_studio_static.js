"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");

const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
const refs = new Set([...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map(match => match[1]));
const dynamicIds = new Set(["powerProfile"]);
const missing = [...refs].filter(id => !ids.has(id) && !dynamicIds.has(id));

assert.deepStrictEqual(missing, [], `Missing HTML elements: ${missing.join(", ")}`);
assert(html.indexOf("program-compiler.js") < html.indexOf("app.js"), "Compiler must load before app.js");
assert(html.includes("styles.css?v=production2"), "Stylesheet cache key is stale");
assert(html.includes('id="adjustmentDialog"'), "Slideshow adjustment dialog is missing");
assert(html.includes('id="validationPanel"'), "Importer validation panel is missing");
assert(html.includes('id="blockBrowser"'), "Block browser is missing");
assert(app.includes("effectiveFrame(active)"), "Device preview must include slideshow adjustments");
assert(app.includes("effectiveFrame(index)"), "Streaming upload must include slideshow adjustments");
assert(app.includes("async function uploadShow()"), "Streaming upload entry point was removed");
assert(app.includes('op:"show_begin"'), "Streaming begin command was removed");
assert(app.includes('op:"show_frame"'), "Per-frame streaming command was removed");
assert(app.includes('op:"show_commit"'), "Streaming commit command was removed");
assert(app.includes("LEDCompiler.importJson"), "Registry importer is not wired into the editor");
assert(app.includes("LEDCompiler.buildAiPrompt"), "Registry-backed AI prompt is not wired into the editor");

console.log(`PASS: ${ids.size} UI elements, importer/compiler wiring, adjustments, and streaming upload`);
