"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "everyday.html"), "utf8");
const controls = fs.readFileSync(path.join(root, "docs", "everyday-controls.js"), "utf8");
const routines = fs.readFileSync(path.join(root, "docs", "routine-engine.js"), "utf8");
const css = fs.readFileSync(path.join(root, "docs", "consumer.css"), "utf8");

for (const asset of ["consumer.css", "everyday-controls.js", "routine-engine.js"]) assert(html.includes(asset), `Everyday page does not load ${asset}`);
for (const id of ["everydayVibe", "everydayBrightness", "everydaySpeed", "everydayText", "everydayRandom", "everydaySave"]) assert(controls.includes(id), `Missing Everyday control ${id}`);
for (const routine of ["sleepMinutes", "wakeTime", "focusMinutes", "timeTheme", "setInterval"]) assert(routines.includes(routine), `Missing routine feature ${routine}`);
assert(css.includes("body[data-ui-mode=everyday] .sidebar>.section"), "Developer paint sections are not hidden in Everyday Mode");
assert(html.indexOf("user-mode.js") < html.indexOf("everyday-controls.js"), "Everyday controls must load after the base mode");
assert(html.indexOf("everyday-controls.js") < html.indexOf("routine-engine.js"), "Routine engine must load after Everyday controls");
console.log("PASS: dedicated Everyday page, buyer controls, Studio hiding, and browser routines are wired");
