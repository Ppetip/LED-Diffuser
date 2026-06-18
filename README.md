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


## Use it as a wall display

The intended installed workflow is:

1. Flash the hybrid firmware to the ESP32-C3 once over USB.
2. Mount the diffuser and leave it connected to a correctly sized 5 V power supply.
3. Open the hosted controller in a compatible browser.
4. Press **Connect Bluetooth**, select **LED-Diffuser**, edit the look, and press **Send to diffuser**.
5. Disconnect or close the browser. Animation continues on the ESP32.
6. After power loss, the ESP32 restores the last mode and settings from nonvolatile storage.

### Host the controller with GitHub Pages

The hostable controller is [`docs/index.html`](docs/index.html). To publish it:

1. Open the repository's **Settings** tab.
2. Select **Pages** under **Code and automation**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose branch **main**, folder **/docs**, then press **Save**.
5. Wait for GitHub's deployment to finish.

The expected public address is:

```text
https://ppetip.github.io/LED-Diffuser/
```

GitHub Pages hosts only the controller. It does not relay commands through the internet: the browser uses local Bluetooth to speak directly to the nearby ESP32.

### Browser requirements

Web Bluetooth requires a compatible browser and a secure HTTPS page. Chrome or Edge on a computer, and compatible Chromium browsers on Android, are the intended targets. The user must press the connection button and choose the device; websites cannot silently pair with Bluetooth devices.

iPhone and iPad Safari do not currently provide the Web Bluetooth API used by this controller. Supporting iOS will require either the ESP32's Wi-Fi interface, an installed BLE app, or a different wrapper application.
