# LED Diffuser revamp handoff

## What changed

- Firmware `3.0.0` keeps BLE advertising active while running the Wi-Fi access point.
- Joining `LED-Diffuser` now triggers a captive portal on Android, Apple, and Windows network checks.
- Wi-Fi is still available manually at `http://192.168.4.1` and, where supported, `http://led-diffuser.local`.
- BLE, USB, and Wi-Fi commands accept an optional `rid` request ID and echo it in replies.
- The desktop Studio serializes commands, matches replies by `rid`, and negotiates a conservative BLE write size.
- The Studio includes a 19 x 30 inch physical preview, adjustable diffusion/exposure, current estimates, and six 24-frame looping aura effects.
- The stale `COM5` upload pin was removed; PlatformIO now auto-detects a connected serial board.

## Try the Studio on this computer

From the project root:

```powershell
python -m http.server 4173 --directory docs
```

Then open `http://127.0.0.1:4173/` in Chrome or Edge. The preview works in any current browser; Web Bluetooth and Web Serial require browser support and a user-initiated Connect click.

## Flash firmware

Connect the ESP32-C3 with a data-capable USB cable. Confirm that Windows shows a COM port, then run:

```powershell
python -m platformio run --target upload
```

The LED data pin remains GPIO 3, with 280 WS2812B pixels. Keep the LED array on its separate 5 V supply with a shared ground.

## First hardware check

1. Power the ESP32 and LED supply.
2. Confirm `LED-Diffuser` appears in Wi-Fi and Bluetooth scans.
3. Join Wi-Fi with password `LEDLEDLED`; the controller should open automatically.
4. If it does not open, browse to `http://192.168.4.1`.
5. In the desktop Studio, connect Bluetooth and load **Aurora drift**.
6. Upload the show and confirm it continues after disconnecting and after a power cycle.

The firmware and all browser regression checks compiled/passed before packaging. The board was not flashed during this session because Windows did not report a connected serial port.
