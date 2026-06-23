# Bluetooth reconnect behavior

The current firmware already enables NimBLE advertising after disconnect inside `setupBle()`:

```cpp
bleServer->advertiseOnDisconnect(true);
```

The premium web controller adds a cleaner reconnect workflow on top of that:

- **Clean disconnect** closes the browser-side GATT connection without requiring a frame power-cycle.
- **Reconnect last** tries to reconnect to the same selected device object in the same browser session before opening the picker again.
- The hosted premium controller keeps using 20-byte BLE writes through `docs/transport-hotfix.js` so reconnects do not fall back into the old invalid-JSON transport bug.

If the frame still disappears from the Bluetooth picker after disconnect, flash this firmware version or add an explicit advertising restart in `MyServerCallbacks::onDisconnect()`:

```cpp
void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
  Serial.printf("[BLE] Client disconnected. Handle: %d, Reason: 0x%02X\n",
                connInfo.getConnHandle(), reason);
  negotiatedMtu = 23;
  bleBuffer = "";
  bleDroppingOversize = false;
  NimBLEDevice::getAdvertising()->start();
  Serial.println("[BLE] Advertising restarted after disconnect");
}
```
