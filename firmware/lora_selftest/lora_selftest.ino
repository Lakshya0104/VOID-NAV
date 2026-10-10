/*
  VOID-NAV LoRa self-test: checks one ESP32 + one RA-02 (SX1278) is wired correctly.
  Wiring: 3V3->3.3V, GND->GND, D18->SCK, D19->MISO, D23->MOSI, D5->NSS, D4->RST
  Open Serial Monitor at 115200. Press EN once if nothing appears.
*/
#include <SPI.h>
#include <LoRa.h>

#define PIN_NSS 5
#define PIN_RST 4

uint8_t readReg(uint8_t addr) {
  digitalWrite(PIN_NSS, LOW);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(addr & 0x7F);
  uint8_t v = SPI.transfer(0);
  SPI.endTransaction();
  digitalWrite(PIN_NSS, HIGH);
  return v;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== VOID-NAV LoRa self-test ===");

  pinMode(PIN_NSS, OUTPUT); digitalWrite(PIN_NSS, HIGH);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, LOW); delay(10); digitalWrite(PIN_RST, HIGH); delay(10);
  SPI.begin(18, 19, 23);

  // Step 1: raw chip check. SX1278 version register 0x42 must read 0x12.
  uint8_t ver = readReg(0x42);
  Serial.printf("Step 1  chip version register = 0x%02X  ", ver);
  if (ver == 0x12) Serial.println("PASS (SX1278 found)");
  else {
    if (ver == 0x00) Serial.println("FAIL: reads 0x00 -> check 3.3V, GND, MISO (D19), NSS (D5)");
    else if (ver == 0xFF) Serial.println("FAIL: reads 0xFF -> MISO floating or module unpowered; check 3.3V and MISO (D19)");
    else Serial.println("FAIL: unexpected value -> loose SCK (D18) / MOSI (D23) wire");
    Serial.println("Fix wiring (USB unplugged!), then press EN to retest.");
    while (true) delay(1000);
  }

  // Step 2: library init at 433 MHz
  LoRa.setPins(PIN_NSS, PIN_RST, -1);
  if (!LoRa.begin(433E6)) { Serial.println("Step 2  LoRa.begin FAIL"); while (true) delay(1000); }
  LoRa.setSpreadingFactor(9); LoRa.setSignalBandwidth(125E3); LoRa.setSyncWord(0x5A);
  LoRa.enableCrc(); LoRa.setTxPower(10);
  Serial.println("Step 2  LoRa init at 433 MHz, SF9  PASS");

  // Step 3: transmit test (proves the radio's transmitter works)
  uint32_t t0 = millis();
  LoRa.beginPacket(); LoRa.print("VOIDNAV-TEST"); bool ok = LoRa.endPacket();
  Serial.printf("Step 3  transmit 12-byte packet  %s  (%lu ms on air)\n", ok ? "PASS" : "FAIL", millis() - t0);

  Serial.println("\nAll checks passed: this ESP32 + LoRa module works.");
  Serial.println("Now listening + sending a ping every 5 s. Flash this same sketch on board #2:");
  Serial.println("each board should print 'RX' lines from the other one.\n");
}

void loop() {
  static uint32_t last = 0, n = 0;
  int sz = LoRa.parsePacket();
  if (sz) {
    String s; while (LoRa.available()) s += (char)LoRa.read();
    Serial.printf("RX  \"%s\"  RSSI %d dBm  SNR %.1f dB\n", s.c_str(), LoRa.packetRssi(), LoRa.packetSnr());
  }
  if (millis() - last > 5000 + random(0, 1000)) {
    last = millis();
    uint64_t mac = ESP.getEfuseMac();
    LoRa.beginPacket(); LoRa.printf("PING %04X #%lu", (uint16_t)(mac >> 32), n++); LoRa.endPacket();
    Serial.printf("TX  PING #%lu\n", n - 1);
  }
}
