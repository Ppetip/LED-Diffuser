#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <FastLED.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <Preferences.h>
#include <LittleFS.h>

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
#define FIRMWARE_VERSION "2.2.0"
#define PROTOCOL_VERSION 2
#define DEFAULT_POWER_LIMIT_MA 750
#define MIN_POWER_LIMIT_MA 250
#define MAX_POWER_LIMIT_MA 10000
#define BLE_NOTIFY_CHUNK_SIZE 160
#define CONTROL_PIN 4
#define BUTTON_DEBOUNCE_MS 35
#define DOUBLE_TAP_MS 360
#define LONG_PRESS_MS 900
#define FACTORY_HOLD_MS 5000
#define GRAVITY_PARTICLES 18

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
  uint16_t powerLimitMa = DEFAULT_POWER_LIMIT_MA;
  uint8_t sceneIndex = 0;
} deviceState;

bool mpuReady = false;
bool setupMode = false;
float tiltX = 0, tiltY = 0, accelZ = 1.0f, shakeEnergy = 0;
uint8_t motionPulse = 0;
uint32_t lastShakeAt = 0;
bool buttonStable = HIGH, buttonRaw = HIGH, longPressHandled = false;
uint32_t buttonChangedAt = 0, buttonDownAt = 0, pendingTapAt = 0;
bool pendingTap = false;
float particleX[GRAVITY_PARTICLES], particleY[GRAVITY_PARTICLES];
float particleVX[GRAVITY_PARTICLES], particleVY[GRAVITY_PARTICLES];
uint32_t lastFrame = 0;
int16_t textOffset = VIEW_W;
String bleBuffer;
String serialBuffer;
String showFrames[MAX_SHOW_FRAMES];
uint8_t showCount = 0;
uint16_t showFrameMs = 250;
uint32_t lastDataRxTime = 0;
File showUploadFile;
uint8_t uploadExpected = 0;
uint8_t uploadReceived = 0;
uint16_t uploadFrameMs = 250;
bool uploadActive = false;
bool bleDroppingOversize = false;
bool serialDroppingOversize = false;
const char *SHOW_FILE = "/show.bin";
const char *SHOW_TEMP_FILE = "/show.tmp";
const char *SHOW_BACKUP_FILE = "/show.bak";

uint8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

uint8_t hexByte(const String &value, uint16_t offset) {
  return (hexNibble(value[offset]) << 4) | hexNibble(value[offset + 1]);
}

bool frameToBinary(const String &pixels, uint8_t *binary) {
  if (pixels.length() != PIXEL_HEX_LENGTH) return false;
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    uint16_t offset = i * 6;
    for (uint8_t j = 0; j < 6; j++) {
      if (!isHexadecimalDigit(pixels[offset + j])) return false;
    }
    binary[i * 3] = hexByte(pixels, offset);
    binary[i * 3 + 1] = hexByte(pixels, offset + 2);
    binary[i * 3 + 2] = hexByte(pixels, offset + 4);
  }
  return true;
}

String binaryToFrame(const uint8_t *binary) {
  static const char HEX_DIGITS[] = "0123456789abcdef";
  String pixels;
  pixels.reserve(PIXEL_HEX_LENGTH);
  for (uint16_t i = 0; i < FRAME_BINARY_SIZE; i++) {
    pixels += HEX_DIGITS[binary[i] >> 4];
    pixels += HEX_DIGITS[binary[i] & 0x0f];
  }
  return pixels;
}

void writeShowHeader(File &file, uint8_t count, uint16_t frameMs) {
  file.write((const uint8_t *)"LDS1", 4);
  file.write(count);
  file.write((uint8_t)(frameMs & 0xff));
  file.write((uint8_t)(frameMs >> 8));
}

bool activateTempShow() {
  if (LittleFS.exists(SHOW_BACKUP_FILE)) LittleFS.remove(SHOW_BACKUP_FILE);
  if (LittleFS.exists(SHOW_FILE) && !LittleFS.rename(SHOW_FILE, SHOW_BACKUP_FILE)) {
    Serial.println("[SHOW][ERROR] Could not preserve current show");
    return false;
  }
  if (!LittleFS.rename(SHOW_TEMP_FILE, SHOW_FILE)) {
    Serial.println("[SHOW][ERROR] Could not activate uploaded show");
    if (LittleFS.exists(SHOW_BACKUP_FILE)) LittleFS.rename(SHOW_BACKUP_FILE, SHOW_FILE);
    return false;
  }
  if (LittleFS.exists(SHOW_BACKUP_FILE)) LittleFS.remove(SHOW_BACKUP_FILE);
  return true;
}

bool saveShowFile() {
  LittleFS.remove(SHOW_TEMP_FILE);
  File file = LittleFS.open(SHOW_TEMP_FILE, "w");
  if (!file) return false;
  writeShowHeader(file, showCount, showFrameMs);
  uint8_t binary[FRAME_BINARY_SIZE];
  for (uint8_t i = 0; i < showCount; i++) {
    if (!frameToBinary(showFrames[i], binary) || file.write(binary, FRAME_BINARY_SIZE) != FRAME_BINARY_SIZE) {
      file.close();
      LittleFS.remove(SHOW_TEMP_FILE);
      return false;
    }
  }
  file.flush();
  file.close();
  return activateTempShow();
}

bool loadShowFile() {
  if (!LittleFS.exists(SHOW_FILE) && LittleFS.exists(SHOW_BACKUP_FILE)) {
    LittleFS.rename(SHOW_BACKUP_FILE, SHOW_FILE);
  }
  File file = LittleFS.open(SHOW_FILE, "r");
  if (!file) return false;
  char magic[4];
  if (file.readBytes(magic, 4) != 4 || memcmp(magic, "LDS1", 4) != 0) {
    file.close();
    return false;
  }
  int countValue = file.read();
  int frameLo = file.read();
  int frameHi = file.read();
  if (countValue < 1 || countValue > MAX_SHOW_FRAMES || frameLo < 0 || frameHi < 0) {
    file.close();
    return false;
  }
  uint8_t count = (uint8_t)countValue;
  uint8_t binary[FRAME_BINARY_SIZE];
  for (uint8_t i = 0; i < count; i++) {
    if (file.read(binary, FRAME_BINARY_SIZE) != FRAME_BINARY_SIZE) {
      file.close();
      showCount = 0;
      return false;
    }
    showFrames[i] = binaryToFrame(binary);
  }
  file.close();
  showCount = count;
  showFrameMs = constrain((uint16_t)(frameLo | (frameHi << 8)), (uint16_t)50, (uint16_t)5000);
  Serial.printf("[SHOW] Loaded %u frames from LittleFS, %lu bytes free heap\n", showCount, ESP.getFreeHeap());
  return true;
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
  deviceState.powerLimitMa = constrain(preferences.getUShort("powerMa", deviceState.powerLimitMa), (uint16_t)MIN_POWER_LIMIT_MA, (uint16_t)MAX_POWER_LIMIT_MA);
  deviceState.sceneIndex = preferences.getUChar("scene", deviceState.sceneIndex);
  showFrameMs = preferences.getUShort("frameMs", showFrameMs);
  if (!loadShowFile()) {
    showCount = 0;
    Serial.println("[SHOW] No valid saved LittleFS show; starting without a playlist");
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
  preferences.putUShort("powerMa", deviceState.powerLimitMa);
  preferences.putUChar("scene", deviceState.sceneIndex);
  preferences.putUChar("showCount", showCount);
  preferences.putUShort("frameMs", showFrameMs);
}


struct BuiltInVibe {
  const char *mode;
  uint8_t hue;
  uint8_t saturation;
  uint16_t speed;
  bool motion;
};

const BuiltInVibe BUILT_IN_VIBES[] = {
  {"aura", 145, 220, 160, true},
  {"motion_gradient", 195, 235, 120, true},
  {"rain", 155, 230, 85, true},
  {"gravity", 35, 245, 70, true},
  {"aura", 225, 210, 240, true},
  {"rain", 5, 240, 130, true}
};
const uint8_t BUILT_IN_VIBE_COUNT = sizeof(BUILT_IN_VIBES) / sizeof(BUILT_IN_VIBES[0]);

void applyBuiltInVibe(uint8_t index) {
  deviceState.sceneIndex = index % (BUILT_IN_VIBE_COUNT + (showCount ? 1 : 0));
  if (showCount && deviceState.sceneIndex == BUILT_IN_VIBE_COUNT) {
    deviceState.mode = "show";
  } else {
    const BuiltInVibe &vibe = BUILT_IN_VIBES[deviceState.sceneIndex % BUILT_IN_VIBE_COUNT];
    deviceState.mode = vibe.mode;
    deviceState.hue = vibe.hue;
    deviceState.saturation = vibe.saturation;
    deviceState.speed = vibe.speed;
    deviceState.motion = vibe.motion;
  }
  saveState();
  Serial.printf("[CONTROL] Scene %u: %s\n", deviceState.sceneIndex, deviceState.mode.c_str());
}

void changeScene(int8_t direction) {
  int count = BUILT_IN_VIBE_COUNT + (showCount ? 1 : 0);
  int next = (int)deviceState.sceneIndex + direction;
  while (next < 0) next += count;
  applyBuiltInVibe(next % count);
}

void cycleBrightness() {
  static const uint8_t LEVELS[] = {18, 32, 50, 72};
  uint8_t next = LEVELS[0];
  for (uint8_t level : LEVELS) {
    if (level > deviceState.brightness) { next = level; break; }
  }
  deviceState.brightness = next;
  FastLED.setBrightness(deviceState.brightness);
  saveState();
  Serial.printf("[CONTROL] Brightness %u\n", deviceState.brightness);
}

void handleControlButton() {
  uint32_t now = millis();
  bool raw = digitalRead(CONTROL_PIN);
  if (raw != buttonRaw) {
    buttonRaw = raw;
    buttonChangedAt = now;
  }
  if (now - buttonChangedAt >= BUTTON_DEBOUNCE_MS && raw != buttonStable) {
    buttonStable = raw;
    if (buttonStable == LOW) {
      buttonDownAt = now;
      longPressHandled = false;
    } else {
      uint32_t held = now - buttonDownAt;
      if (!longPressHandled && held < LONG_PRESS_MS) {
        if (pendingTap && now - pendingTapAt <= DOUBLE_TAP_MS) {
          pendingTap = false;
          changeScene(-1);
        } else {
          pendingTap = true;
          pendingTapAt = now;
        }
      }
    }
  }
  if (buttonStable == LOW && !longPressHandled && now - buttonDownAt >= LONG_PRESS_MS) {
    longPressHandled = true;
    pendingTap = false;
    cycleBrightness();
  }
  if (pendingTap && now - pendingTapAt > DOUBLE_TAP_MS) {
    pendingTap = false;
    changeScene(1);
  }
}

void initializeGravityParticles() {
  for (uint8_t i = 0; i < GRAVITY_PARTICLES; i++) {
    particleX[i] = (i * 11 + 3) % VIEW_W;
    particleY[i] = (i * 7 + 2) % VIEW_H;
    particleVX[i] = particleVY[i] = 0;
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
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (size_t)6, true) != 6) return;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;
  tiltX = tiltX * .86f + x * .14f;
  tiltY = tiltY * .86f + y * .14f;
  accelZ = accelZ * .86f + z * .14f;
  float magnitude = sqrtf(x * x + y * y + z * z);
  shakeEnergy = shakeEnergy * .82f + fabsf(magnitude - 1.0f) * .18f;
  if (shakeEnergy > .32f && millis() - lastShakeAt > 650) {
    lastShakeAt = millis();
    motionPulse = 255;
    Serial.println("[MOTION] Shake");
  }
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


void renderMotionGradient(uint32_t now) {
  float cx = (tiltX + 1.0f) * .5f * (VIEW_W - 1);
  float cy = (tiltY + 1.0f) * .5f * (VIEW_H - 1);
  for (uint8_t y = 0; y < VIEW_H; y++) for (uint8_t x = 0; x < VIEW_W; x++) {
    float distance = sqrtf((x - cx) * (x - cx) + (y - cy) * (y - cy));
    uint8_t value = qadd8(18, qsub8(210, min(210, (int)(distance * 18))));
    value = qadd8(value, motionPulse / 3);
    setPixel(x, y, CHSV(deviceState.hue + distance * 7 + now / 45, deviceState.saturation, value));
  }
  motionPulse = scale8(motionPulse, 225);
}

void renderGravity(uint32_t now) {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  float impulse = 0.025f + min(.18f, shakeEnergy * .3f);
  for (uint8_t i = 0; i < GRAVITY_PARTICLES; i++) {
    particleVX[i] += tiltX * impulse;
    particleVY[i] += tiltY * impulse + .008f;
    particleVX[i] *= .985f;
    particleVY[i] *= .985f;
    particleX[i] += particleVX[i];
    particleY[i] += particleVY[i];
    if (particleX[i] < 0) { particleX[i] = 0; particleVX[i] *= -.7f; }
    if (particleX[i] > VIEW_W - 1) { particleX[i] = VIEW_W - 1; particleVX[i] *= -.7f; }
    if (particleY[i] < 0) { particleY[i] = 0; particleVY[i] *= -.7f; }
    if (particleY[i] > VIEW_H - 1) { particleY[i] = VIEW_H - 1; particleVY[i] *= -.72f; }
    setPixel(roundf(particleX[i]), roundf(particleY[i]), CHSV(deviceState.hue + i * 9 + motionPulse / 4, deviceState.saturation, 180 + (i % 3) * 25));
  }
  motionPulse = scale8(motionPulse, 220);
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
  doc["firmware"] = FIRMWARE_VERSION; doc["protocol"] = PROTOCOL_VERSION;
  doc["powerLimitMa"] = deviceState.powerLimitMa;
  doc["sceneIndex"] = deviceState.sceneIndex; doc["setupMode"] = setupMode;
  String out; serializeJson(doc, out); return out;
}

bool applyCommand(const String &json, String &reply) {
  Serial.printf("[CMD] %u bytes, free heap before parse: %lu\n", json.length(), ESP.getFreeHeap());
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, json);
  if (error) {
    reply = "{\"ok\":0,\"error\":\"invalid json\"}";
    Serial.printf("[CMD][ERROR] JSON parse failed: %s, heap: %lu\n", error.c_str(), ESP.getFreeHeap());
    return false;
  }

  const char *operation = doc["op"] | "";
  if (!strcmp(operation, "get_status")) {
    JsonDocument status;
    status["ok"] = 1; status["op"] = "status";
    status["firmware"] = FIRMWARE_VERSION; status["protocol"] = PROTOCOL_VERSION;
    status["width"] = VIEW_W; status["height"] = VIEW_H; status["maxFrames"] = MAX_SHOW_FRAMES;
    status["brightness"] = deviceState.brightness; status["powerLimitMa"] = deviceState.powerLimitMa;
    status["sceneIndex"] = deviceState.sceneIndex; status["sceneCount"] = BUILT_IN_VIBE_COUNT + (showCount ? 1 : 0);
    status["setupMode"] = setupMode; status["controlPin"] = CONTROL_PIN;
    status["freeHeap"] = ESP.getFreeHeap(); status["showCount"] = showCount; status["frameMs"] = showFrameMs;
    status["upload"]["active"] = uploadActive; status["upload"]["have"] = uploadReceived; status["upload"]["want"] = uploadExpected;
    status["caps"]["ble"] = true; status["caps"]["usb"] = true; status["caps"]["wifi"] = true;
    status["caps"]["showUpload"] = true; status["caps"]["physicalControl"] = true;
    status["caps"]["motionEffects"] = true; status["caps"]["supportsOTA"] = false;
    serializeJson(status, reply);
    return true;
  }
  if (!strcmp(operation, "next_scene")) {
    changeScene(1);
    reply = "{\"ok\":1,\"state\":" + stateJson() + "}";
    return true;
  }
  if (!strcmp(operation, "previous_scene")) {
    changeScene(-1);
    reply = "{\"ok\":1,\"state\":" + stateJson() + "}";
    return true;
  }
  if (!strcmp(operation, "show_begin")) {
    uint8_t expected = constrain(doc["count"].as<int>(), 1, MAX_SHOW_FRAMES);
    uint16_t frameMs = constrain(doc["frameMs"].as<int>(), 50, 5000);
    if (showUploadFile) showUploadFile.close();
    LittleFS.remove(SHOW_TEMP_FILE);
    showUploadFile = LittleFS.open(SHOW_TEMP_FILE, "w");
    if (!showUploadFile) {
      reply = "{\"ok\":0,\"error\":\"cannot open show storage\"}";
      Serial.println("[SHOW][ERROR] Failed to open temporary show file");
      return false;
    }
    writeShowHeader(showUploadFile, expected, frameMs);
    uploadExpected = expected;
    uploadReceived = 0;
    uploadFrameMs = frameMs;
    uploadActive = true;
    if (doc["brightness"].is<int>()) deviceState.brightness = constrain(doc["brightness"].as<int>(), 1, 160);
    reply = "{\"ok\":1,\"op\":\"begin\",\"n\":" + String(expected) + "}";
    Serial.printf("[SHOW] BEGIN %u frames at %u ms, heap: %lu\n", expected, frameMs, ESP.getFreeHeap());
    return true;
  }

  if (!strcmp(operation, "show_frame")) {
    int index = doc["index"] | -1;
    const char *pixelValue = doc["pixels"] | "";
    if (!uploadActive) {
      reply = "{\"ok\":0,\"error\":\"no active upload\"}";
      return false;
    }
    if (index != uploadReceived || index >= uploadExpected) {
      reply = "{\"ok\":0,\"error\":\"frame out of order\",\"want\":" + String(uploadReceived) + "}";
      Serial.printf("[SHOW][ERROR] Out-of-order frame %d, expected %u\n", index, uploadReceived);
      return false;
    }
    String pixels(pixelValue);
    uint8_t binary[FRAME_BINARY_SIZE];
    if (!frameToBinary(pixels, binary)) {
      reply = "{\"ok\":0,\"error\":\"invalid frame pixels\"}";
      Serial.printf("[SHOW][ERROR] Invalid frame %d length=%u\n", index, pixels.length());
      return false;
    }
    size_t written = showUploadFile.write(binary, FRAME_BINARY_SIZE);
    if (written != FRAME_BINARY_SIZE) {
      reply = "{\"ok\":0,\"error\":\"show storage write failed\"}";
      Serial.printf("[SHOW][ERROR] Frame %d wrote %u/%u bytes\n", index, written, FRAME_BINARY_SIZE);
      uploadActive = false;
      showUploadFile.close();
      return false;
    }
    uploadReceived++;
    reply = "{\"ok\":1,\"i\":" + String(index) + "}";
    Serial.println("[SHOW] Frame saved");
    return true;
  }

  if (!strcmp(operation, "show_commit")) {
    if (!uploadActive || uploadReceived != uploadExpected) {
      reply = "{\"ok\":0,\"error\":\"upload incomplete\",\"have\":" + String(uploadReceived) + ",\"want\":" + String(uploadExpected) + "}";
      Serial.printf("[SHOW][ERROR] COMMIT incomplete: %u/%u\n", uploadReceived, uploadExpected);
      return false;
    }
    showUploadFile.flush();
    showUploadFile.close();
    if (!activateTempShow()) {
      reply = "{\"ok\":0,\"error\":\"could not activate show\"}";
      uploadActive = false;
      return false;
    }
    if (!loadShowFile() || showCount != uploadExpected || showFrameMs != uploadFrameMs) {
      reply = "{\"ok\":0,\"error\":\"show read-back verification failed\"}";
      uploadActive = false;
      Serial.println("[SHOW][ERROR] Activated show failed read-back verification");
      return false;
    }
    deviceState.mode = "show";
    FastLED.setBrightness(deviceState.brightness);
    saveState();
    uploadActive = false;
    reply = "{\"ok\":1,\"done\":" + String(showCount) + "}";
    Serial.printf("[SHOW] COMMIT %u frames complete, heap: %lu\n", showCount, ESP.getFreeHeap());
    return true;
  }

  if (!strcmp(operation, "show_cancel")) {
    if (showUploadFile) showUploadFile.close();
    LittleFS.remove(SHOW_TEMP_FILE);
    uploadActive = false;
    uploadExpected = uploadReceived = 0;
    reply = "{\"ok\":1,\"op\":\"cancel\"}";
    Serial.println("[SHOW] Upload cancelled");
    return true;
  }
  if (doc["mode"].is<const char*>()) deviceState.mode = String(doc["mode"].as<const char*>());
  if (doc["text"].is<const char*>()) deviceState.text = String(doc["text"].as<const char*>()).substring(0, 32);
  if (doc["direction"].is<const char*>()) deviceState.direction = String(doc["direction"].as<const char*>());
  if (doc["font"].is<const char*>()) deviceState.font = String(doc["font"].as<const char*>());
  if (doc["brightness"].is<int>()) deviceState.brightness = constrain(doc["brightness"].as<int>(), 1, 160);
  if (doc["speed"].is<int>()) deviceState.speed = constrain(doc["speed"].as<int>(), 35, 2000);
  if (doc["hue"].is<int>()) deviceState.hue = doc["hue"].as<int>();
  if (doc["saturation"].is<int>()) deviceState.saturation = constrain(doc["saturation"].as<int>(), 0, 255);
  if (doc["motion"].is<bool>()) deviceState.motion = doc["motion"].as<bool>();
  if (doc["powerLimitMa"].is<int>()) {
    deviceState.powerLimitMa = constrain(doc["powerLimitMa"].as<int>(), MIN_POWER_LIMIT_MA, MAX_POWER_LIMIT_MA);
    FastLED.setMaxPowerInVoltsAndMilliamps(5, deviceState.powerLimitMa);
    Serial.printf("[POWER] LED current limit set to %u mA\n", deviceState.powerLimitMa);
  }
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
    if (!saveShowFile()) {
      reply = "{\"ok\":0,\"error\":\"could not save frame\"}";
      Serial.println("[SHOW][ERROR] Single-frame LittleFS save failed");
      return false;
    }
  }

  if (!doc["frames"].isNull()) {
    reply = "{\"ok\":0,\"error\":\"bulk shows disabled; update the web app\"}";
    Serial.println("[SHOW][ERROR] Rejected unsafe monolithic frames command");
    return false;
  }

  FastLED.setBrightness(deviceState.brightness);
  saveState();
  reply = "{\"ok\":true,\"state\":" + stateJson() + "}";
  Serial.printf("[CMD] Applied, free heap: %lu\n", ESP.getFreeHeap());
  return true;
}

void notifyBleReply(const String &reply) {
  if (!txCharacteristic) return;
  String line = reply + "\n";
  for (size_t offset = 0; offset < line.length(); offset += BLE_NOTIFY_CHUNK_SIZE) {
    String chunk = line.substring(offset, min(offset + BLE_NOTIFY_CHUNK_SIZE, line.length()));
    txCharacteristic->setValue(chunk.c_str());
    txCharacteristic->notify();
    delay(4);
  }
}

void handleUsbSerial() {
  if (Serial.available()) {
    lastDataRxTime = millis();
  }
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (serialDroppingOversize) {
      if (c == '\n') serialDroppingOversize = false;
      continue;
    }
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
      if (serialBuffer.length() > 4096) {
        serialBuffer = "";
        serialDroppingOversize = true;
        Serial.println("{\"ok\":0,\"error\":\"command too large; update web app\"}");
        Serial.println("[TRANSPORT][ERROR] Rejected USB command over 4096 bytes");
      }
    }
  }
}

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic, NimBLEConnInfo &connInfo) override {
    lastDataRxTime = millis();
    String part = String(characteristic->getValue().c_str());
    if (bleDroppingOversize) {
      if (part.indexOf('\n') >= 0) bleDroppingOversize = false;
      return;
    }
    bleBuffer += part;
    if (bleBuffer.endsWith("\n") || (bleBuffer.startsWith("{") && bleBuffer.endsWith("}"))) {
      bleBuffer.trim();
      String reply;
      applyCommand(bleBuffer, reply);
      notifyBleReply(reply);
      bleBuffer = "";
    }
    if (bleBuffer.length() > 4096) {
      bleBuffer = "";
      bleDroppingOversize = true;
      notifyBleReply("{\"ok\":0,\"error\":\"command too large; update web app\"}");
      Serial.println("[TRANSPORT][ERROR] Rejected BLE command over 4096 bytes");
    }
  }
};

const char PAGE[] PROGMEM = R"HTML(
<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>LED Diffuser</title><style>
:root{color-scheme:dark}body{font:16px system-ui;background:#090b12;color:#f8fafc;max-width:680px;margin:auto;padding:18px}main{display:grid;gap:16px;background:#151925;padding:18px;border:1px solid #2a3142;border-radius:18px}h1,h2,p{margin:0}label{display:grid;gap:5px}.grid,.actions,.palette{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}input,select,button{box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid #394258;border-radius:10px;background:#202638;color:#fff}button{font-weight:700}.primary{background:#67e8d3;color:#06221d}.palette{grid-template-columns:repeat(6,1fr)}.palette button{min-width:0;padding:0}.note,#status{color:#aeb8ce;font-size:13px}@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style></head><body><main><div><h1>LED Diffuser</h1><p class=note>Ambient scenes, simple controls, no account required.</p></div>
<div class=actions><button onclick=scene('previous_scene')>Previous vibe</button><button onclick=scene('next_scene')>Next vibe</button></div>
<div class=grid><label>Vibe<select id=mode><option value=aura>Aura</option><option value=motion_gradient>Motion gradient</option><option value=rain>Rain</option><option value=gravity>Gravity particles</option><option value=tilt>Tilt orb</option><option value=text>Scrolling text</option><option value=show>Saved show</option></select></label>
<label>Brightness <span id=bv>35</span><input id=brightness type=range min=1 max=80 value=35 oninput="bv.textContent=value"></label>
<label>Speed <span id=sv>150</span> ms<input id=speed type=range min=50 max=1000 step=10 value=150 oninput="sv.textContent=value"></label>
<label>Message<input id=text maxlength=32 placeholder="Short large text"></label></div>
<div><h2>Palette</h2><div class=palette><button style="background:#38d9d6" onclick="hue=145">A</button><button style="background:#4d96ff" onclick="hue=195">O</button><button style="background:#9d8cff" onclick="hue=225">L</button><button style="background:#ff477e" onclick="hue=245">P</button><button style="background:#ff9f1c" onclick="hue=24">S</button><button style="background:#8cff98" onclick="hue=105">F</button></div></div>
<button class=primary onclick=save()>Save to panel</button><p id=status>Connecting...</p>
<p class=note>Frame control: tap next, double tap previous, long press brightness. Hold while powering on for setup mode. Detailed photos and small text are not suited to this display.</p>
</main><script>
let hue=145;const q=id=>document.getElementById(id);async function post(data){const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const out=await r.json();if(!r.ok||!out.ok)throw Error(out.error||'Command failed');return out}
async function scene(op){try{const out=await post({op});status.textContent='Scene changed';if(out.state)mode.value=out.state.mode}catch(e){status.textContent=e.message}}
async function save(){try{await post({mode:mode.value,text:text.value||'VIBE',brightness:+brightness.value,speed:+speed.value,hue,saturation:220,motion:true});status.textContent='Saved. The panel will keep playing without this page.'}catch(e){status.textContent=e.message}}
fetch('/api/state').then(r=>r.json()).then(s=>{mode.value=s.mode;brightness.value=s.brightness;bv.textContent=s.brightness;speed.value=s.speed;sv.textContent=s.speed;text.value=s.text||'';status.textContent=(s.setupMode?'Setup mode / ':'')+'Firmware '+s.firmware+' / '+s.showCount+' saved frames'}).catch(e=>status.textContent=e.message)
</script></body></html>)HTML";

void setupBle() {
  NimBLEDevice::init("LED-Diffuser");
  NimBLEDevice::setMTU(185);
  NimBLEServer *bleServer = NimBLEDevice::createServer();
  bleServer->advertiseOnDisconnect(true);
  NimBLEService *service = bleServer->createService(BLE_SERVICE);
  txCharacteristic = service->createCharacteristic(BLE_TX, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *rx = service->createCharacteristic(BLE_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
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
  pinMode(CONTROL_PIN, INPUT_PULLUP);
  delay(10);
  uint32_t bootHoldStarted = millis();
  while (digitalRead(CONTROL_PIN) == LOW && millis() - bootHoldStarted < FACTORY_HOLD_MS) delay(10);
  setupMode = digitalRead(CONTROL_PIN) == LOW || millis() - bootHoldStarted >= 1200;
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  delay(25);
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  serialBuffer.reserve(2048);
  bleBuffer.reserve(2048);
  if (!LittleFS.begin(true)) {
    Serial.println("[FS][ERROR] LittleFS mount failed");
  } else {
    Serial.printf("[FS] LittleFS mounted: %u/%u bytes used\n", LittleFS.usedBytes(), LittleFS.totalBytes());
  }
  loadState();
  if (!preferences.getBool("initialized", false)) {
    deviceState.sceneIndex = 0;
    deviceState.mode = BUILT_IN_VIBES[0].mode;
    deviceState.hue = BUILT_IN_VIBES[0].hue;
    deviceState.saturation = BUILT_IN_VIBES[0].saturation;
    deviceState.speed = BUILT_IN_VIBES[0].speed;
    preferences.putBool("initialized", true);
    saveState();
  }
  if (setupMode) {
    deviceState.mode = "motion_gradient";
    deviceState.brightness = 32;
    Serial.println("[CONTROL] Boot hold entered setup mode");
  }
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(deviceState.brightness);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, deviceState.powerLimitMa);
  FastLED.clear(true);
  Wire.begin(SDA_PIN, SCL_PIN);
  mpuReady = startMpu();
  initializeGravityParticles();
  setupBle();
  setupWeb();
  Serial.printf("[BOOT] LED Diffuser firmware %s, protocol %u, power cap %u mA, reset=%s\n", FIRMWARE_VERSION, PROTOCOL_VERSION, deviceState.powerLimitMa, esp_reset_reason() == ESP_RST_BROWNOUT ? "brownout" : "other");
  Serial.println("LED Diffuser ready");
  Serial.println(WiFi.softAPIP());
  Serial.println(mpuReady ? "MPU6050 ready" : "MPU6050 not found; tilt mode remains centered");
}

void loop() {
  server.handleClient();
  handleUsbSerial();
  handleControlButton();
  readMpu();
  uint32_t now = millis();
  if (now - lastDataRxTime < 1500) {
    return; // Pause LED renders during active transfers so interrupts stay enabled
  }
  if (now - lastFrame < 33) return;
  lastFrame = now;
  if (deviceState.mode == "custom" || deviceState.mode == "show") renderShow(now);
  else if (deviceState.mode == "rain") renderRain(now);
  else if (deviceState.mode == "text") renderText(now);
  else if (deviceState.mode == "tilt") renderTilt(now);
  else if (deviceState.mode == "gravity") renderGravity(now);
  else if (deviceState.mode == "motion_gradient") renderMotionGradient(now);
  else renderAura(now);
  FastLED.show();
}
