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
#define MAX_SHOW_FRAMES 8
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

struct State {
  String mode = "aura";
  String text = "VIBE";
  String direction = "left";
  uint8_t brightness = 35;
  uint16_t speed = 100;
  uint8_t hue = 180;
  uint8_t saturation = 210;
  bool motion = true;
} state;

bool mpuReady = false;
float tiltX = 0, tiltY = 0;
uint32_t lastFrame = 0;
int16_t textOffset = VIEW_W;
String bleBuffer;
String showFrames[MAX_SHOW_FRAMES];
uint8_t showCount = 0;
uint16_t showFrameMs = 250;

void loadState() {
  preferences.begin("leddiff", false);
  state.mode = preferences.getString("mode", state.mode);
  state.text = preferences.getString("text", state.text);
  state.direction = preferences.getString("direction", state.direction);
  state.brightness = preferences.getUChar("brightness", state.brightness);
  state.speed = preferences.getUShort("speed", state.speed);
  state.hue = preferences.getUChar("hue", state.hue);
  state.saturation = preferences.getUChar("saturation", state.saturation);
  state.motion = preferences.getBool("motion", state.motion);
  showCount = min(preferences.getUChar("showCount", 0), (uint8_t)MAX_SHOW_FRAMES);
  showFrameMs = preferences.getUShort("frameMs", showFrameMs);
  for (uint8_t i = 0; i < showCount; i++) {
    String key = "frame" + String(i);
    showFrames[i] = preferences.getString(key.c_str(), "");
    if (showFrames[i].length() != PIXEL_HEX_LENGTH) {
      showCount = i;
      break;
    }
  }
}

void saveState() {
  preferences.putString("mode", state.mode);
  preferences.putString("text", state.text);
  preferences.putString("direction", state.direction);
  preferences.putUChar("brightness", state.brightness);
  preferences.putUShort("speed", state.speed);
  preferences.putUChar("hue", state.hue);
  preferences.putUChar("saturation", state.saturation);
  preferences.putBool("motion", state.motion);
  preferences.putUChar("showCount", showCount);
  preferences.putUShort("frameMs", showFrameMs);
  for (uint8_t i = 0; i < showCount; i++) {
    String key = "frame" + String(i);
    preferences.putString(key.c_str(), showFrames[i]);
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

uint8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

uint8_t hexByte(const String &value, uint16_t offset) {
  return (hexNibble(value[offset]) << 4) | hexNibble(value[offset + 1]);
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
  uint8_t index = state.mode == "custom" ? 0 : (now / max((uint16_t)50, showFrameMs)) % showCount;
  renderPixelFrame(showFrames[index]);
}

bool startMpu() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  return Wire.endTransmission() == 0;
}

void readMpu() {
  if (!mpuReady || !state.motion) return;
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
  float phase = now / max(250.0f, state.speed * 8.0f);
  for (uint8_t y = 0; y < VIEW_H; y++) {
    for (uint8_t x = 0; x < VIEW_W; x++) {
      float wave = sinf(x * .24f + phase) + cosf(y * .55f - phase * .8f);
      uint8_t value = 25 + uint8_t((wave + 2.0f) * 45.0f);
      setPixel(x, y, CHSV(state.hue + x * 2 + y * 3, state.saturation, value));
    }
  }
}

void renderRain(uint32_t now) {
  fadeToBlackBy(leds, NUM_LEDS, 48);
  uint16_t tick = now / max((uint16_t)35, state.speed);
  for (uint8_t x = 0; x < VIEW_W; x++) {
    uint8_t y = (tick + x * 7 + (x * x)) % (VIEW_H + 5);
    if (y < VIEW_H) setPixel(x, y, CHSV(state.hue + x * 3, state.saturation, 220));
    if (y > 0 && y - 1 < VIEW_H) setPixel(x, y - 1, CHSV(state.hue, state.saturation, 75));
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

void drawChar(char c, int x0, int y0, CRGB color) {
  if (c < 'A' || c > 'Z') return;
  const uint8_t *glyph = FONT[c - 'A'];
  for (uint8_t x = 0; x < 5; x++) {
    for (uint8_t y = 0; y < 7; y++) {
      if (glyph[x] & (1 << y)) setPixel(x0 + x, y0 + y, color);
    }
  }
}

void renderText(uint32_t now) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  int width = state.text.length() * 6;
  bool vertical = state.direction == "up" || state.direction == "down";
  int cycle = (vertical ? VIEW_H + 8 : VIEW_W + width);
  int step = (now / max((uint16_t)40, state.speed)) % max(1, cycle);
  int baseX = state.direction == "right" ? -width + step : VIEW_W - step;
  int baseY = state.direction == "down" ? -8 + step : VIEW_H - step;
  for (uint16_t i = 0; i < state.text.length(); i++) {
    char c = toupper(state.text[i]);
    int x = vertical ? 1 + (i % 4) * 7 : baseX + i * 6;
    int y = vertical ? baseY - (i / 4) * 8 : 1;
    drawChar(c, x, y, CHSV(state.hue + i * 8, state.saturation, 255));
  }
}

void renderTilt(uint32_t now) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  int cx = constrain(int((tiltX + 1.0f) * .5f * (VIEW_W - 1)), 0, VIEW_W - 1);
  int cy = constrain(int((tiltY + 1.0f) * .5f * (VIEW_H - 1)), 0, VIEW_H - 1);
  for (int y = 0; y < VIEW_H; y++) {
    for (int x = 0; x < VIEW_W; x++) {
      float d = sqrtf((x-cx)*(x-cx) + (y-cy)*(y-cy));
      if (d < 6) setPixel(x, y, CHSV(state.hue + d * 8 + now / 35, state.saturation, 255 - d * 38));
    }
  }
}

String stateJson() {
  JsonDocument doc;
  doc["mode"] = state.mode; doc["text"] = state.text;
  doc["direction"] = state.direction; doc["brightness"] = state.brightness;
  doc["speed"] = state.speed; doc["hue"] = state.hue;
  doc["saturation"] = state.saturation; doc["motion"] = state.motion;
  doc["mpu"] = mpuReady; doc["ip"] = WiFi.softAPIP().toString();
  doc["showCount"] = showCount; doc["frameMs"] = showFrameMs;
  String out; serializeJson(doc, out); return out;
}

bool applyCommand(const String &json, String &reply) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, json);
  if (error) { reply = "{\"ok\":false,\"error\":\"invalid json\"}"; return false; }
  if (doc["mode"].is<const char*>()) state.mode = String(doc["mode"].as<const char*>());
  if (doc["text"].is<const char*>()) state.text = String(doc["text"].as<const char*>()).substring(0, 32);
  if (doc["direction"].is<const char*>()) state.direction = String(doc["direction"].as<const char*>());
  if (doc["brightness"].is<int>()) state.brightness = constrain(doc["brightness"].as<int>(), 1, 160);
  if (doc["speed"].is<int>()) state.speed = constrain(doc["speed"].as<int>(), 35, 2000);
  if (doc["hue"].is<int>()) state.hue = doc["hue"].as<int>();
  if (doc["saturation"].is<int>()) state.saturation = constrain(doc["saturation"].as<int>(), 0, 255);
  if (doc["motion"].is<bool>()) state.motion = doc["motion"].as<bool>();
  if (doc["frameMs"].is<int>()) showFrameMs = constrain(doc["frameMs"].as<int>(), 50, 5000);

  if (doc["pixels"].is<const char*>()) {
    String pixels = String(doc["pixels"].as<const char*>());
    if (pixels.length() != PIXEL_HEX_LENGTH) {
      reply = "{\"ok\":false,\"error\":\"pixels must contain 1680 hex characters\"}";
      return false;
    }
    showFrames[0] = pixels;
    showCount = 1;
    state.mode = "custom";
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
    state.mode = "show";
  }

  FastLED.setBrightness(state.brightness);
  saveState();
  reply = "{\"ok\":true,\"state\":" + stateJson() + "}";
  if (txCharacteristic) { txCharacteristic->setValue(reply.c_str()); txCharacteristic->notify(); }
  return true;
}

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic, NimBLEConnInfo &connInfo) override {
    String part = String(characteristic->getValue().c_str());
    bleBuffer += part;
    if (bleBuffer.endsWith("\n") || (bleBuffer.startsWith("{") && bleBuffer.endsWith("}"))) {
      bleBuffer.trim();
      String reply; applyCommand(bleBuffer, reply); bleBuffer = "";
    }
    if (bleBuffer.length() > 18000) bleBuffer = "";
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
<label>Text<input id=text value=VIBE maxlength=32></label>
<div class=row><label>Brightness<input id=brightness type=range min=1 max=160 value=35></label>
<label>Speed ms<input id=speed type=number min=35 max=2000 value=100></label></div>
<div class=row><label>Hue<input id=hue type=range min=0 max=255 value=180></label>
<label>Saturation<input id=saturation type=range min=0 max=255 value=210></label></div>
<label><input id=motion type=checkbox checked style="width:auto"> MPU motion reaction</label>
<button onclick=send()>Apply vibe</button><label>AI animation prompt<textarea id=prompt>Make a calm ambient LED vibe using only mode, hue, saturation, speed, direction, motion, and short readable text. The display is 28x10 pixels. Prefer gradients and motion over literal pictures. Return one compact JSON object only.</textarea></label>
<button onclick="navigator.clipboard.writeText(prompt.value)">Copy AI prompt</button><pre id=status></pre></main>
<script>
const ids=["mode","direction","text","brightness","speed","hue","saturation","motion"];
async function send(){let o={};ids.forEach(k=>o[k]=k==="motion"?window[k].checked:(["brightness","speed","hue","saturation"].includes(k)?+window[k].value:window[k].value));let r=await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)});status.textContent=await r.text()}
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
  advertising->addServiceUUID(BLE_SERVICE);
  advertising->enableScanResponse(true);
  advertising->start();
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
  FastLED.setBrightness(state.brightness);
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
  readMpu();
  uint32_t now = millis();
  if (now - lastFrame < 33) return;
  lastFrame = now;
  if (state.mode == "custom" || state.mode == "show") renderShow(now);
  else if (state.mode == "rain") renderRain(now);
  else if (state.mode == "text") renderText(now);
  else if (state.mode == "tilt") renderTilt(now);
  else renderAura(now);
  FastLED.show();
}
