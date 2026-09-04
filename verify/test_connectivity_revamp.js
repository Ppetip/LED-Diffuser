"use strict";

const assert = require("assert");
const fs = require("fs");

const firmware = fs.readFileSync("firmware/led_diffuser_hybrid/led_diffuser_hybrid.ino", "utf8");
const html = fs.readFileSync("docs/index.html", "utf8");
const revamp = fs.readFileSync("docs/revamp.js", "utf8");

for (const marker of [
  "#include <DNSServer.h>",
  'dnsServer.start(DNS_PORT, "*", AP_IP)',
  'server.on("/generate_204"',
  'server.on("/hotspot-detect.html"',
  'server.on("/connecttest.txt"',
  "server.onNotFound(redirectToPortal)",
  "dnsServer.processNextRequest()",
  "attachRequestId(serialBuffer, reply)",
  "attachRequestId(bleBuffer, reply)",
  'status["bleWriteMax"] = safeBleWriteMax()'
]) assert(firmware.includes(marker), `Firmware is missing: ${marker}`);

assert(html.includes('id="diffuserCanvas"'), "Physical preview canvas is missing");
assert(html.includes("physical-simulator.js?v=revamp1"), "Simulator script is not loaded");
assert(html.indexOf("physical-simulator.js") < html.indexOf("revamp.js"), "Simulator must load before revamp wiring");
assert(revamp.includes("requestWaiters.get(requestId)"), "Replies are not correlated by request ID");
assert(revamp.includes("const command = { ...payload, rid }"), "Commands do not include request IDs");
assert(revamp.includes("const queued = commandTail.then(run, run)"), "Transport commands are not serialized");

console.log("PASS: captive portal, request-correlated BLE/USB, and physical preview wiring");
