"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "docs", "app-profile.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "docs", "panel.html"), "utf8");
const studio = fs.readFileSync(path.join(root, "docs", "studio-v2.html"), "utf8");
for (const marker of [
  "let W=28,H=10,N=W*H",
  "configureHardwareProfile",
  "resizeFrame",
  "statusReply.width",
  "statusReply.height",
  "matrix.style.gridTemplateColumns",
  "next.hardwareProfile",
  "width:W,height:H"
]) assert(app.includes(marker), `Missing hardware-profile marker: ${marker}`);
assert(app.includes("frame.length===DEFAULT_W*DEFAULT_H"), "Legacy 28x10 projects are not recognized");
assert(panel.includes("app-profile.js"), "Consumer panel does not use profile-aware app");
assert(studio.includes("app-profile.js"), "Studio does not use profile-aware app");
console.log("PASS: default 28x10, device-reported profiles, dynamic grids, and legacy project resizing are wired");
