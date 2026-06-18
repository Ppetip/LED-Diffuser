# LED Diffuser

ESP32-C3 firmware for a 280-pixel diffuser matrix with both:

- Bluetooth Low Energy control (Nordic UART-style JSON commands)
- A Wi-Fi access point and browser dashboard
- Aura, rain, scrolling text, and MPU6050 tilt-reactive modes
- A shared JSON command format so BLE, the website, and future AI tools use the same controls

## Hardware defaults

- ESP32-C3 Mini
- 10 physical columns x 28 LEDs, serpentine column wiring
- 280 WS2812B LEDs
- LED data: GPIO 3
- MPU6050 SDA: GPIO 8
- MPU6050 SCL: GPIO 9
- MPU6050 I2C address: 0x68

The editor/view is treated as 28 pixels wide x 10 pixels high. Change the pin constants at the top of the sketch if your board differs.

Use a separate 5 V LED supply with shared ground. Keep the initial brightness low.

## Build

Open `firmware/led_diffuser_hybrid/led_diffuser_hybrid.ino` and install:

- ESP32 Arduino core
- FastLED
- ArduinoJson
- NimBLE-Arduino

Select the exact ESP32-C3 board and COM port before uploading.

## Connect

Wi-Fi:

- SSID: `LED-Diffuser`
- Password: `LEDLEDLED`
- Dashboard: `http://192.168.4.1`

Bluetooth:

- Device: `LED-Diffuser`
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX/write: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX/notify: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

Send one compact JSON object per BLE write. Example:

```json
{"mode":"aura","brightness":45,"speed":100,"hue":180,"saturation":210}
```

Other examples:

```json
{"mode":"text","text":"HELLO","direction":"left","speed":100,"hue":25}
{"mode":"rain","speed":80,"hue":150}
{"mode":"tilt","motion":true,"hue":200}
```

The firmware intentionally constrains output to low-resolution, abstract animation. AI-generated ideas should become parameters or 28x10 frames, not large images.
