# Firmware Update Plan

## Current production behavior

- Firmware changes are compiled and flashed over USB.
- BLE, USB serial, and Wi-Fi accept animation/control JSON, not C++ source code.
- `get_status` reports firmware/protocol versions and `caps.supportsOTA: false` so clients never show an update button that cannot be completed safely.
- The default LED current budget is 750 mA. Use an external 5 V LED supply with a shared ground before selecting a higher limit.

An ESP32 cannot compile pasted Arduino C++ by itself. Accepting arbitrary executable bytes over an unauthenticated BLE characteristic would also turn the display controller into an unsafe remote-code path.

## Safe OTA milestone

OTA can be enabled after all of these pieces exist and are tested together:

1. Replace `huge_app.csv` with a verified 4 MB partition table containing OTA metadata, two application slots with adequate size margin, and LittleFS.
2. Produce a signed manifest containing board ID, firmware version, image size, SHA-256, and signature.
3. Require bonded BLE Secure Connections plus a physical authorization action on the device.
4. Prefer BLE authorization followed by an HTTPS Wi-Fi download. A resumable BLE binary transfer is a slower fallback.
5. Verify board, size, hash, and signature before selecting the new boot partition.
6. Run a post-boot health check and mark the image valid only after BLE, storage, and LED output initialize; otherwise roll back automatically.

Until those conditions are implemented, keeping `supportsOTA` false is intentional.
