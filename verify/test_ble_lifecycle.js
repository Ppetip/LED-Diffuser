const fs = require("fs");
const path = "firmware/led_diffuser_hybrid/led_diffuser_hybrid.ino";
const source = fs.readFileSync(path, "utf8");

function position(fragment) {
  const index = source.indexOf(fragment);
  if (index < 0) throw new Error(`Missing BLE lifecycle step: ${fragment}`);
  return index;
}

const createServer = position("NimBLEDevice::createServer()");
const createService = position("bleServer->createService(BLE_SERVICE)");
const startServer = position("bleServer->start()");
const startAdvertising = position("advertising->start()");
position("bleServer->advertiseOnDisconnect(true)");

if (!(createServer < createService && createService < startServer && startServer < startAdvertising)) {
  throw new Error("BLE GATT server must start after service creation and before advertising");
}

console.log("BLE lifecycle regression test passed");
