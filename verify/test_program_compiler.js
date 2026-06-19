const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "docs", "program-compiler.js"), "utf8");
const context = {
  console,
  structuredClone,
  window: null,
  drawCharOnGrid(grid, character, x, y, color) {
    if (x >= 0 && x < 28 && y >= 0 && y < 10 && character !== " ") grid[y * 28 + x] = color;
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context);
const compiler = context.LEDCompiler;

assert(compiler, "compiler did not register itself");
assert.strictEqual(compiler.PIXELS, 280);

for (const [type, definition] of Object.entries(compiler.registry)) {
  const result = compiler.compileProgram({
    schemaVersion: 2,
    name: `Test ${type}`,
    width: 28,
    height: 10,
    frameMs: 100,
    frameCount: 2,
    layers: [{ id: type, type, enabled: true, opacity: 1, blend: "normal", params: definition.example }]
  });
  assert.strictEqual(result.frames.length, 2, `${type}: ${JSON.stringify(result.errors)}`);
  assert(result.frames.every(frame => frame.length === 280), `${type} returned wrong frame size`);
  assert(result.frames.flat().every(color => /^#[0-9a-f]{6}$/i.test(color)), `${type} returned invalid colors`);
}

for (const blend of compiler.BLEND_MODES) {
  const result = compiler.compileProgram({
    schemaVersion: 2,
    frameCount: 1,
    layers: [
      { id: "base", type: "solid", blend: "normal", params: { color: "#204060" } },
      { id: "top", type: "rectangle", blend, opacity: 0.7, params: { x: 2, y: 2, width: 10, height: 5, color: "#ff8040", filled: true } }
    ]
  });
  assert.strictEqual(result.frames.length, 1, `${blend}: ${JSON.stringify(result.errors)}`);
}

const deterministic = {
  schemaVersion: 2,
  name: "Deterministic stars",
  frameCount: 4,
  layers: [{ id: "stars", type: "stars", params: { count: 20, seed: "same-seed", twinkle: true } }]
};
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(compiler.compileProgram(deterministic).frames)),
  JSON.parse(JSON.stringify(compiler.compileProgram(deterministic).frames)),
  "deterministic compile changed between runs"
);

const skyline = `
Here is your program:
\`\`\`json
{
  “schemaVersion”: 2,
  “name”: “Midnight Skyline Glow”,
  “frameMs”: 90,
  “frameCount”: 12,
  “layers”: [
    {“id”:“sky”,“type”:“gradient”,“params”:{“color1”:“#020617”,“color2”:“#312e81”,“direction”:“vertical”,}},
    {“id”:“stars”,“type”:“stars”,“params”:{“count”:16,“seed”:“midnight”}},
    {“id”:“tower”,“type”:“rectangle”,“params”:{“x”:8,“y”:4,“width”:8,“height”:6,“color”:“#111827”,“filled”:true}},
    {“id”:“lights”,“type”:“windows”,“params”:{“x”:9,“y”:5,“columns”:3,“rows”:2,“spacingX”:2,“spacingY”:2,“color”:“#ffe66d”,“litChance”:0.8,“nestedPulse”:{“speed”:2}}}
  ],
}
\`\`\`
Thanks!
`;
const imported = compiler.importJson(skyline);
assert.strictEqual(imported.kind, "program");
assert.strictEqual(imported.frames.length, 12, JSON.stringify(imported.errors));
assert(imported.warnings.some(warning => warning.path === "layers[3].params.nestedPulse"), "unsupported skyline parameter was not reported");
assert(!imported.program.layers[3].params.nestedPulse, "unsupported parameter survived repair");

const typo = compiler.importJson(JSON.stringify({
  schemaVersion: 2,
  layers: [{ id: "typo", type: "rectangl", params: {} }]
}));
assert(typo.errors.some(error => error.path === "layers[0].type" && error.message.includes("rectangle")), "type typo did not receive a suggestion");

const invalid = compiler.importJson('{“schemaVersion”:2,“layers”:[{“type”:“circle”,“params”:{“radius”:“large”}}]}');
assert(invalid.errors.some(error => error.path === "layers[0].params.radius"), "invalid parameter path was not precise");

const partial = compiler.importJson(JSON.stringify({
  schemaVersion: 2,
  frameCount: 2,
  layers: [
    { id: "valid", type: "solid", params: { color: "#102030" } },
    { id: "broken", type: "invented_shape", params: { radius: 9 } }
  ]
}));
assert.strictEqual(partial.frames.length, 2, "valid layers were not compiled when one layer was broken");
assert.deepStrictEqual(JSON.parse(JSON.stringify(partial.skippedLayers)), [1]);

const invisible = compiler.compileProgram({
  schemaVersion: 2,
  frameCount: 1,
  layers: [
    { id: "base", type: "solid", params: { color: "#123456" } },
    { id: "hidden-by-opacity", type: "solid", opacity: 0, params: { color: "#ffffff" } }
  ]
});
assert.strictEqual(invisible.frames[0][0], "#123456", "zero opacity was incorrectly treated as full opacity");

const adjusted = compiler.adjustFrame(["#204060"], { brightness: 2, contrast: 1, saturation: 1, gamma: 1 });
assert.strictEqual(adjusted[0], "#4080c0", "brightness adjustment produced the wrong RGB value");

console.log(`PASS: ${Object.keys(compiler.registry).length} blocks, ${compiler.BLEND_MODES.length} blends, importer repair, deterministic output, and skyline regression`);
