"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "studio.html"), "utf8");
const source = fs.readFileSync(path.join(root, "docs", "timeline-tools.js"), "utf8");
for (const asset of ["timeline.css", "timeline-tools.js"]) assert(html.includes(asset), `Studio does not load ${asset}`);
for (const feature of [
  "previousTimeline", "nextTimeline", "playTimeline", "reverseTimeline", "makePingPong",
  "shiftAllFrames", "duplicateRange", "insertFade", "onionPrevious", "onionNext",
  "timelineScrubber", "previewUpload", "uploadPreviewDialog"
]) assert(source.includes(feature), `Missing timeline feature: ${feature}`);
assert(source.includes("MAX_FRAMES - project.frames.length"), "Frame-expanding tools do not respect the frame limit");
assert(source.includes("originalUpload"), "Upload preview does not gate the real upload");
console.log("PASS: Studio timeline navigation, preview, reverse, ping-pong, shifts, ranges, fades, onion skin, scrubber, and upload preview are wired");
