#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <FastLED.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <Preferences.h>

#define LED_PIN 3
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define PHYSICAL_W 10
#define PHYSICAL_H 28
#define VIEW_W 28
#define VIEW_H 10
#define NUM_LEDS (PHYSICAL_W * PHYSICAL_H)
#define SDA_PIN 8
#define SCL_PIN 9
#define MPU_ADDR 0x68
#define MAX_SHOW_FRAMES 24
#define FRAME_BINARY_SIZE (NUM_LEDS * 3)
#define PIXEL_HEX_LENGTH (NUM_LEDS * 6)

const char *AP_SSID = "LED-Diffuser";
const char *AP_PASS = "LEDLEDLED";
const char *BLE_SERVICE = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const char *BLE_RX = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
const char *BLE_TX = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

CRGB leds[NUM_LEDS];
WebServer server(80);
NimBLECharacteristic *txCharacteristic = nullptr;
Preferences preferences;

struct DeviceState {
  String mode = "aura";
  String text = "VIBE";
  String direction = "left";
  String font = "bold";
  uint8_t brightness = 35;
  uint16_t speed = 100;
  uint8_t hue = 180;
  uint8_t saturation = 210;
  bool motion = true;
} deviceState;

bool mpuReady = false;
float tiltX = 0, tiltY = 0;
uint32_t lastFrame = 0;
int16_t textOffset = VIEW_W;
String bleBuffer;
String serialBuffer;
String showFrames[MAX_SHOW_FRAMES];
uint8_t showCount = 0;
uint16_t showFrameMs = 250;

uint8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

uint8_t hexByte(const String &value, uint16_t offset) {
  return (hexNibble(value[offset]) << 4) | hexNibble(value[offset + 1]);
}

void loadState() {
  preferences.begin("leddiff", false);
  deviceState.mode = preferences.getString("mode", deviceState.mode);
  deviceState.text = preferences.getString("text", deviceState.text);
  deviceState.direction = preferences.getString("direction", deviceState.direction);
  deviceState.font = preferences.getString("font", deviceState.font);
  deviceState.brightness = preferences.getUChar("brightness", deviceState.brightness);
  deviceState.speed = preferences.getUShort("speed", deviceState.speed);
  deviceState.hue = preferences.getUChar("hue", deviceState.hue);
  deviceState.saturation = preferences.getUChar("saturation", deviceState.saturation);
  deviceState.motion = preferences.getBool("motion", deviceState.motion);
  showCount = min(preferences.getUChar("showCount", 0), (uint8_t)MAX_SHOW_FRAMES);
  showFrameMs = preferences.getUShort("frameMs", showFrameMs);
  for (uint8_t i = 0; i < showCount; i++) {
    String key = "frame" + String(i);
    uint8_t bin[FRAME_BINARY_SIZE];
    size_t len = preferences.getBytes(key.c_str(), bin, FRAME_BINARY_SIZE);
    if (len == FRAME_BINARY_SIZE) {
      char hex[PIXEL_HEX_LENGTH + 1];
      for (uint16_t j = 0; j < NUM_LEDS; j++) {
        sprintf(&hex[j * 6], "%02x%02x%02x", bin[j * 3], bin[j * 3 + 1], bin[j * 3 + 2]);
      }
      hex[PIXEL_HEX_LENGTH] = '\0';
      showFrames[i] = String(hex);
    } else {
      showCount = i;
      break;
    }
  }
}

void saveState() {
  preferences.putString("mode", deviceState.mode);
  preferences.putString("text", deviceState.text);
  preferences.putString("direction", deviceState.direction);
  preferences.putString("font", deviceState.font);
  preferences.putUChar("brightness", deviceState.brightness);
  preferences.putUShort("speed", deviceState.speed);
  preferences.putUChar("hue", deviceState.hue);
  preferences.putUChar("saturation", deviceState.saturation);
  preferences.putBool("motion", deviceState.motion);
  preferences.putUChar("showCount", showCount);
  preferences.putUShort("frameMs", showFrameMs);
  for (uint8_t i = 0; i < showCount; i++) {
    String key = "frame" + String(i);
    uint8_t bin[FRAME_BINARY_SIZE];
    for (uint16_t j = 0; j < NUM_LEDS; j++) {
      uint16_t offset = j * 6;
      bin[j * 3] = hexByte(showFrames[i], offset);
      bin[j * 3 + 1] = hexByte(showFrames[i], offset + 2);
      bin[j * 3 + 2] = hexByte(showFrames[i], offset + 4);
    }
    preferences.putBytes(key.c_str(), bin, FRAME_BINARY_SIZE);
  }
}

uint16_t ledIndex(uint8_t x, uint8_t y) {
  // Browser coordinates are 28 wide x 10 high. Physical wiring is 10
  // serpentine vertical columns of 28 LEDs.
  uint8_t column = y;
  uint8_t row = x;
  return column * PHYSICAL_H + ((column & 1) ? PHYSICAL_H - 1 - row : row);
}

void setPixel(int x, int y, CRGB color) {
  if (x >= 0 && x < VIEW_W && y >= 0 && y < VIEW_H) {
    leds[ledIndex(x, y)] = color;
  }
}

void renderPixelFrame(const String &pixels) {
  if (pixels.length() != PIXEL_HEX_LENGTH) return;
  for (uint8_t y = 0; y < VIEW_H; y++) {
    for (uint8_t x = 0; x < VIEW_W; x++) {
      uint16_t offset = (y * VIEW_W + x) * 6;
      setPixel(x, y, CRGB(hexByte(pixels, offset), hexByte(pixels, offset + 2), hexByte(pixels, offset + 4)));
    }
  }
}

void renderShow(uint32_t now) {
  if (showCount == 0) {
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    return;
  }
  uint8_t index = deviceState.mode == "custom" ? 0 : (now / max((uint16_t)50, showFrameMs)) % showCount;
  renderPixelFrame(showFrames[index]);
}

bool startMpu() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  return Wire.endTransmission() == 0;
}

void readMpu() {
  if (!mpuReady || !deviceState.motion) return;
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom(MPU_ADDR, 6, true) != 6) return;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read();
  tiltX = tiltX * .86f + (ax / 16384.0f) * .14f;
  tiltY = tiltY * .86f + (ay / 16384.0f) * .14f;
}

void renderAura(uint32_t now) {
  float phase = now / max(250.0f, deviceState.speed * 8.0f);
  for (uint8_t y = 0; y < VIEW_H; y++) {
    for (uint8_t x = 0; x < VIEW_W; x++) {
      float wave = sinf(x * .24f + phase) + cosf(y * .55f - phase * .8f);
      uint8_t value = 25 + uint8_t((wave + 2.0f) * 45.0f);
      setPixel(x, y, CHSV(deviceState.hue + x * 2 + y * 3, deviceState.saturation, value));
    }
  }
}

void renderRain(uint32_t now) {
  fadeToBlackBy(leds, NUM_LEDS, 48);
  uint16_t tick = now / max((uint16_t)35, deviceState.speed);
  for (uint8_t x = 0; x < VIEW_W; x++) {
    uint8_t y = (tick + x * 7 + (x * x)) % (VIEW_H + 5);
    if (y < VIEW_H) setPixel(x, y, CHSV(deviceState.hue + x * 3, deviceState.saturation, 220));
    if (y > 0 && y - 1 < VIEW_H) setPixel(x, y - 1, CHSV(deviceState.hue, deviceState.saturation, 75));
  }
}

const uint8_t FONT[][5] = {
  {0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},
  {0x3E,0x41,0x41,0x41,0x22},{0x7F,0x41,0x41,0x22,0x1C},
  {0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x09,0x01},
  {0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},
  {0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},
  {0x7F,0x08,0x14,0x22,0x41},{0x7F,0x40,0x40,0x40,0x40},
  {0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},
  {0x3E,0x41,0x41,0x41,0x3E},{0x7F,0x09,0x09,0x09,0x06},
  {0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},
  {0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},
  {0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},
  {0x3F,0x40,0x38,0x40,0x3F},{0x63,0x14,0x08,0x14,0x63},
  {0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43}
};

const uint8_t FONT_BOLD[][6] = {
  {0x7E,0x33,0x33,0x33,0x33,0x7E},{0xFF,0xFF,0xDB,0xDB,0xDB,0x66}, // A, B
  {0x7E,0xFF,0xC3,0xC3,0xC3,0x42},{0xFF,0xFF,0xC3,0xC3,0xC3,0x7E}, // C, D
  {0xFF,0xFF,0xDB,0xDB,0xDB,0xC3},{0xFF,0xFF,0x1B,0x1B,0x1B,0x03}, // E, F
  {0x7E,0xFF,0xC3,0xDB,0xDB,0x7A},{0xFF,0xFF,0x18,0x18,0xFF,0xFF}, // G, H
  {0xC3,0xC3,0xFF,0xFF,0xC3,0xC3},{0x70,0xF0,0xC0,0xC3,0xFF,0x7F}, // I, J
  {0xFF,0xFF,0x3C,0x3C,0xC3,0xC3},{0xFF,0xFF,0xC0,0xC0,0xC0,0xC0}, // K, L
  {0xFF,0xFF,0x06,0x0E,0xFF,0xFF},{0xFF,0xFF,0x1E,0x78,0xFF,0xFF}, // M, N
  {0x7E,0xFF,0xC3,0xC3,0xFF,0x7E},{0xFF,0xFF,0x1B,0x1B,0x1B,0x06}, // O, P
  {0x3E,0x7F,0x63,0xE3,0xFF,0xFE},{0xFF,0xFF,0x3B,0x7B,0xD3,0xA6}, // Q, R
  {0x46,0xCF,0xDB,0xDB,0xF3,0x72},{0x03,0x03,0xFF,0xFF,0x03,0x03}, // S, T
  {0x7F,0xFF,0xC0,0xC0,0xFF,0x7F},{0x0F,0x3F,0xF0,0xF0,0x3F,0x0F}, // U, V
  {0xFF,0xFF,0x70,0x70,0xFF,0xFF},{0xC3,0xE7,0x3C,0x3C,0xE7,0xC3}, // W, X
  {0x03,0x07,0xFC,0xFC,0x07,0x03},{0xC3,0xE3,0xD3,0xCB,0xC7,0xC3}, // Y, Z
  {0x7E,0xFF,0xC3,0xC3,0xFF,0x7E},{0xC2,0xC2,0xFF,0xFF,0xC0,0xC0}, // 0, 1
  {0xE2,0xDB,0xDB,0xDB,0xDB,0xC6},{0xC3,0xC3,0xDB,0xDB,0xFF,0xFF}, // 2, 3
  {0x1F,0x1F,0x18,0x18,0xFF,0xFF},{0x4F,0xDF,0xDB,0xDB,0xF3,0x73}, // 4, 5
  {0x7E,0xFF,0xDB,0xDB,0xF3,0x72},{0x03,0x03,0xF3,0xFB,0xFF,0xFF}, // 6, 7
  {0x66,0xFF,0xDB,0xDB,0xFF,0x66},{0x46,0xCF,0xDB,0xDB,0xFF,0x7E}, // 8, 9
  {0x00,0x00,0x00,0x00,0x00,0x00}                                  // Space
};

void drawChar(char c, int x0, int y0, CRGB color) {
  if (deviceState.font == "bold") {
    int idx = -1;
    if (c >= 'A' && c <= 'Z') idx = c - 'A';
    else if (c >= '0' && c <= '9') idx = 26 + (c - '0');
    else if (c == ' ') idx = 36;
    if (idx != -1) {
      const uint8_t *glyph = FONT_BOLD[idx];
      for (uint8_t x = 0; x < 6; x++) {
        for (uint8_t y = 0; y < 8; y++) {
          if (glyph[x] & (1 << y)) setPixel(x0 + x, y0 + y, color);
        }
      }
    }
  } else {
    if (c < 'A' || c > 'Z') return;
    const uint8_t *glyph = FONT[c - 'A'];
    for (uint8_t x = 0; x < 5; x++) {
      for (uint8_t y = 0; y < 7; y++) {
        if (glyph[x] & (1 << y)) setPixel(x0 + x, y0 + y, color);
      }
    }
  }
}

void renderText(uint32_t now) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  bool vertical = deviceState.direction == "up" || deviceState.direction == "down";
  bool isBold = deviceState.font == "bold";
  int charW = isBold ? 6 : 5;
  int charH = isBold ? 8 : 7;
  int charSpacing = isBold ? 7 : 6;
  int lineHeight = isBold ? 9 : 8;

  if (vertical) {
    int charsPerLine = 4;
    int lines = (deviceState.text.length() + charsPerLine - 1) / charsPerLine;
    int totalHeight = lines * lineHeight;
    int cycle = VIEW_H + totalHeight;
    int step = (now / max((uint16_t)40, deviceState.speed)) % max(1, cycle);
    int baseY = deviceState.direction == "down" ? -totalHeight + step : VIEW_H - step;

    for (uint16_t i = 0; i < deviceState.text.length(); i++) {
      char c = toupper(deviceState.text[i]);
      int x = 1 + (i % charsPerLine) * charSpacing;
      int y = baseY + (i / charsPerLine) * lineHeight;
      drawChar(c, x, y, CHSV(deviceState.hue + i * 8, deviceState.saturation, 255));
    }
  } else {
    int width = deviceState.text.length() * charSpacing;
    int cycle = VIEW_W + width;
    int step = (now / max((uint16_t)40, deviceState.speed)) % max(1, cycle);
    int baseX = deviceState.direction == "right" ? -width + step : VIEW_W - step;
    int baseY = (VIEW_H - charH) / 2;

    for (uint16_t i = 0; i < deviceState.text.length(); i++) {
      char c = toupper(deviceState.text[i]);
      int x = baseX + i * charSpacing;
      drawChar(c, x, baseY, CHSV(deviceState.hue + i * 8, deviceState.saturation, 255));
    }
  }
}

void renderTilt(uint32_t now) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  int cx = constrain(int((tiltX + 1.0f) * .5f * (VIEW_W - 1)), 0, VIEW_W - 1);
  int cy = constrain(int((tiltY + 1.0f) * .5f * (VIEW_H - 1)), 0, VIEW_H - 1);
  for (int y = 0; y < VIEW_H; y++) {
    for (int x = 0; x < VIEW_W; x++) {
      float d = sqrtf((x-cx)*(x-cx) + (y-cy)*(y-cy));
      if (d < 6) setPixel(x, y, CHSV(deviceState.hue + d * 8 + now / 35, deviceState.saturation, 255 - d * 38));
    }
  }
}

String stateJson() {
  JsonDocument doc;
  doc["mode"] = deviceState.mode; doc["text"] = deviceState.text;
  doc["direction"] = deviceState.direction; doc["font"] = deviceState.font;
  doc["brightness"] = deviceState.brightness;
  doc["speed"] = deviceState.speed; doc["hue"] = deviceState.hue;
  doc["saturation"] = deviceState.saturation; doc["motion"] = deviceState.motion;
  doc["mpu"] = mpuReady; doc["ip"] = WiFi.softAPIP().toString();
  doc["showCount"] = showCount; doc["frameMs"] = showFrameMs;
  String out; serializeJson(doc, out); return out;
}

bool applyCommand(const String &json, String &reply) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, json);
  if (error) { reply = "{\"ok\":false,\"error\":\"invalid json\"}"; return false; }
  if (doc["mode"].is<const char*>()) deviceState.mode = String(doc["mode"].as<const char*>());
  if (doc["text"].is<const char*>()) deviceState.text = String(doc["text"].as<const char*>()).substring(0, 32);
  if (doc["direction"].is<const char*>()) deviceState.direction = String(doc["direction"].as<const char*>());
  if (doc["font"].is<const char*>()) deviceState.font = String(doc["font"].as<const char*>());
  if (doc["brightness"].is<int>()) deviceState.brightness = constrain(doc["brightness"].as<int>(), 1, 160);
  if (doc["speed"].is<int>()) deviceState.speed = constrain(doc["speed"].as<int>(), 35, 2000);
  if (doc["hue"].is<int>()) deviceState.hue = doc["hue"].as<int>();
  if (doc["saturation"].is<int>()) deviceState.saturation = constrain(doc["saturation"].as<int>(), 0, 255);
  if (doc["motion"].is<bool>()) deviceState.motion = doc["motion"].as<bool>();
  if (doc["frameMs"].is<int>()) showFrameMs = constrain(doc["frameMs"].as<int>(), 50, 5000);

  if (doc["pixels"].is<const char*>()) {
    String pixels = String(doc["pixels"].as<const char*>());
    if (pixels.length() != PIXEL_HEX_LENGTH) {
      reply = "{\"ok\":false,\"error\":\"pixels must contain 1680 hex characters\"}";
      return false;
    }
    showFrames[0] = pixels;
    showCount = 1;
    deviceState.mode = "custom";
  }

  JsonArray frames = doc["frames"].as<JsonArray>();
  if (!frames.isNull()) {
    uint8_t nextCount = min((uint8_t)frames.size(), (uint8_t)MAX_SHOW_FRAMES);
    if (nextCount == 0) {
      reply = "{\"ok\":false,\"error\":\"show needs at least one frame\"}";
      return false;
    }
    for (uint8_t i = 0; i < nextCount; i++) {
      showFrames[i] = String(frames[i].as<const char*>());
      if (showFrames[i].length() != PIXEL_HEX_LENGTH) {
        reply = "{\"ok\":false,\"error\":\"every frame must contain 1680 hex characters\"}";
        return false;
      }
    }
    showCount = nextCount;
    deviceState.mode = "show";
  }

  FastLED.setBrightness(deviceState.brightness);
  saveState();
  reply = "{\"ok\":true,\"state\":" + stateJson() + "}";
  if (txCharacteristic) { txCharacteristic->setValue(reply.c_str()); txCharacteristic->notify(); }
  return true;
}

void handleUsbSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length()) {
        String reply;
        applyCommand(serialBuffer, reply);
        Serial.println(reply);
      }
      serialBuffer = "";
    } else if (c != '\r') {
      serialBuffer += c;
      if (serialBuffer.length() > 48000) {
        serialBuffer = "";
        Serial.println("{\"ok\":false,\"error\":\"USB command too large\"}");
      }
    }
  }
}

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic, NimBLEConnInfo &connInfo) override {
    String part = String(characteristic->getValue().c_str());
    bleBuffer += part;
    if (bleBuffer.endsWith("\n") || (bleBuffer.startsWith("{") && bleBuffer.endsWith("}"))) {
      bleBuffer.trim();
      String reply; applyCommand(bleBuffer, reply); bleBuffer = "";
    }
    if (bleBuffer.length() > 48000) bleBuffer = "";
  }
};

const char PAGE[] PROGMEM = R"HTML(
<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>LED Diffuser</title><style>
body{font:16px system-ui;background:#111827;color:#f8fafc;max-width:720px;margin:auto;padding:22px}
main{background:#1f2937;padding:20px;border-radius:18px}h1{margin-top:0}label{display:block;margin:14px 0}
input,select,button,textarea{width:100%;box-sizing:border-box;padding:12px;border:0;border-radius:10px;margin-top:5px}
button{background:#67e8f9;color:#082f49;font-weight:700;cursor:pointer}textarea{min-height:120px;background:#0f172a;color:#e2e8f0}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.muted{color:#94a3b8;font-size:13px}
</style><main><h1>LED Diffuser</h1><p class=muted>Wi-Fi + Bluetooth share the same animation state.</p>
<div class=row><label>Mode<select id=mode><option>aura</option><option>rain</option><option>text</option><option>tilt</option></select></label>
<label>Direction<select id=direction><option>left</option><option>right</option><option>up</option><option>down</option></select></label></div>
<div class=row><label>Font<select id=font><option>bold</option><option>standard</option></select></label>
<label>Text<input id=text value=VIBE maxlength=32></label></div>
<div class=row><label>Brightness<input id=brightness type=range min=1 max=160 value=35></label>
<label>Speed ms<input id=speed type=number min=35 max=2000 value=100></label></div>
<div class=row><label>Hue<input id=hue type=range min=0 max=255 value=180></label>
<label>Saturation<input id=saturation type=range min=0 max=255 value=210></label></div>
<label><input id=motion type=checkbox checked style="width:auto"> MPU motion reaction</label>
<button onclick=send()>Apply vibe</button>
<label>JSON Console Command<textarea id=jsonConsole>{"mode":"text","text":"HELLO","font":"bold","direction":"down","speed":150}</textarea></label>
<button onclick=sendJson()>Send JSON</button>
<label>AI animation prompt<textarea id=prompt>Make a calm ambient LED vibe using only mode, hue, saturation, speed, direction, motion, and short readable text. The display is 28x10 pixels. Prefer gradients and motion over literal pictures. Return one compact JSON object only.</textarea></label>
<button onclick="navigator.clipboard.writeText(prompt.value)">Copy AI prompt</button><pre id=status></pre></main>
<script>
const ids=["mode","direction","font","text","brightness","speed","hue","saturation","motion"];
const send=()=>{let o={};ids.forEach(k=>o[k]=k==="motion"?window[k].checked:(["brightness","speed","hue","saturation"].includes(k)?+window[k].value:window[k].value));fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)}).then(r=>r.text()).then(t=>status.textContent=t)};
const sendJson=()=>{fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:jsonConsole.value}).then(r=>r.text()).then(t=>status.textContent=t)};
fetch("/api/state").then(r=>r.json()).then(s=>{ids.forEach(k=>{if(s[k]!==undefined)(k==="motion"?window[k].checked=s[k]:window[k].value=s[k])});status.textContent=JSON.stringify(s,null,2)})
</script>)HTML";

void setupBle() {
  NimBLEDevice::init("LED-Diffuser");
  NimBLEServer *bleServer = NimBLEDevice::createServer();
  NimBLEService *service = bleServer->createService(BLE_SERVICE);
  txCharacteristic = service->createCharacteristic(BLE_TX, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *rx = service->createCharacteristic(BLE_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  service->start();
  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName("LED-Diffuser");
  advertising->addServiceUUID(BLE_SERVICE);
  advertising->enableScanResponse(true);
  bool advertisingStarted = advertising->start();
  Serial.print("BLE advertising start: ");
  Serial.println(advertisingStarted ? "yes" : "no");
  Serial.print("BLE advertising active: ");
  Serial.println(advertising->isAdvertising() ? "yes" : "no");
}

void setupWeb() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  server.on("/", HTTP_GET, [](){ server.send_P(200, "text/html", PAGE); });
  server.on("/api/state", HTTP_GET, [](){ server.send(200, "application/json", stateJson()); });
  server.on("/api/command", HTTP_POST, [](){
    String reply; bool ok = applyCommand(server.arg("plain"), reply);
    server.send(ok ? 200 : 400, "application/json", reply);
  });
  server.begin();
}

void setup() {
  Serial.begin(115200);
  loadState();
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(deviceState.brightness);
  FastLED.clear(true);
  Wire.begin(SDA_PIN, SCL_PIN);
  mpuReady = startMpu();
  setupBle();
  setupWeb();
  Serial.println("LED Diffuser ready");
  Serial.println(WiFi.softAPIP());
  Serial.println(mpuReady ? "MPU6050 ready" : "MPU6050 not found; tilt mode remains centered");
}

void loop() {
  server.handleClient();
  handleUsbSerial();
  readMpu();
  uint32_t now = millis();
  if (now - lastFrame < 33) return;
  lastFrame = now;
  if (deviceState.mode == "custom" || deviceState.mode == "show") renderShow(now);
  else if (deviceState.mode == "rain") renderRain(now);
  else if (deviceState.mode == "text") renderText(now);
  else if (deviceState.mode == "tilt") renderTilt(now);
  else renderAura(now);
  FastLED.show();
}
