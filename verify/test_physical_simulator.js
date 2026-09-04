"use strict";

const assert = require("assert");
const simulator = require("../docs/physical-simulator.js");

assert.strictEqual(simulator.WIDTH, 28);
assert.strictEqual(simulator.HEIGHT, 10);
assert.strictEqual(simulator.BOARD_WIDTH_IN, 19);
assert.strictEqual(simulator.BOARD_HEIGHT_IN, 30);
assert.strictEqual(Object.keys(simulator.EFFECTS).length, 6);

for (const effect of Object.keys(simulator.EFFECTS)) {
  const first = simulator.createShow(effect);
  const second = simulator.createShow(effect);
  assert.strictEqual(first.frames.length, 24, `${effect} must produce 24 frames`);
  assert(first.frameMs >= 50 && first.frameMs <= 5000, `${effect} frame interval is invalid`);
  assert.deepStrictEqual(first, second, `${effect} must be deterministic`);
  for (const frame of first.frames) {
    assert.strictEqual(frame.length, 280, `${effect} frame must contain 280 pixels`);
    assert(frame.every(color => /^#[0-9a-f]{6}$/i.test(color)), `${effect} contains an invalid color`);
  }
  assert(new Set(first.frames.map(frame => frame.join(""))).size > 1, `${effect} must actually animate`);
}

const black = Array(280).fill("#000000");
const white = Array(280).fill("#ffffff");
assert.strictEqual(simulator.estimateCurrentMa(black, 255), 0);
assert.strictEqual(simulator.estimateCurrentMa(white, 255), 16800);
assert(simulator.estimateCurrentMa(white, 35) < 2500);

console.log("PASS: true-scale simulator geometry and 6 deterministic aura shows");
