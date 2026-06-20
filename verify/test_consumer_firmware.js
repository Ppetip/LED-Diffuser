"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const firmware = fs.readFileSync(path.join(__dirname, "..", "firmware", "led_diffuser_hybrid", "led_diffuser_hybrid.ino"), "utf8");

for (const marker of [
  "#define CONTROL_PIN 4",
  "handleControlButton()",
  "changeScene(-1)",
  "changeScene(1)",
  "cycleBrightness()",
  "setupMode",
  "renderGravity",
  "renderMotionGradient",
  'status["caps"]["physicalControl"] = true',
  'status["caps"]["motionEffects"] = true'
]) assert(firmware.includes(marker), `Missing consumer firmware marker: ${marker}`);

assert(firmware.includes("DOUBLE_TAP_MS"), "Double-tap timing is missing");
assert(firmware.includes("LONG_PRESS_MS"), "Long-press timing is missing");
assert(firmware.includes("digitalRead(CONTROL_PIN)"), "Boot/control input is not read");
assert(firmware.includes('preferences.putUChar("scene"'), "Scene selection is not persisted");
assert(firmware.includes('preferences.putBool("initialized", true)'), "First-boot demo initialization is missing");
assert(firmware.includes('deviceState.mode == "gravity"'), "Gravity mode is not dispatched");
assert(firmware.includes('deviceState.mode == "motion_gradient"'), "Motion gradient mode is not dispatched");

console.log("PASS: standalone scenes, button gestures, setup boot hold, persistence, and MPU motion modes are wired");
