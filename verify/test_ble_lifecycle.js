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
const startAdvertising = position("bool advertisingStarted = advertising->start()");
position("bleServer->advertiseOnDisconnect(true)");
position("void onDisconnect(NimBLEServer* pServer");
position("bleBuffer = \"\"");
position("bleDroppingOversize = false");
position("[BLE] Advertising restarted after disconnect");
position("#define BLE_NOTIFY_CHUNK_SIZE 20");
position("[BLE][ERROR] Notification delivery failed");

if (!(createServer < createService && createService < startServer && startServer < startAdvertising)) {
  throw new Error("BLE GATT server must start after service creation and before advertising");
}

console.log("BLE lifecycle and automatic re-advertising regression test passed");
