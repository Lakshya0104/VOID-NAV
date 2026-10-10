/*
  VOID-NAV · rescue kit firmware (2 x ESP32 + 2 x RA-02 LoRa)

  RESCUER NODE (carried by the search team)          COMMAND GATEWAY (at the command post)
    Wi-Fi "SOS Node1" + SOS page for survivors          LoRa receive  -> USB JSON lines -> server.py
    counts nearby phones (Wi-Fi probe requests)         USB commands  -> LoRa (ACK / READ / DISPATCH / REPLY)
    SOS + phone counts  --LoRa 433 MHz-->
                       <--ACK / READ / DISPATCH / REPLY--

  Set ROLE below before flashing each board. USE_LORA 0 = no radio fitted: the rescuer node talks to
  the laptop over its own USB cable instead (same messages), so the demo works either way.

  Wiring RA-02 (both boards): 3V3, GND, SCK->18, MISO->19, MOSI->23, NSS->5, RST->4. Antenna on before power.
  Library: "LoRa" by Sandeep Mistry (Arduino Library Manager / arduino-cli lib install LoRa).
  Optional on rescuer node: orange LED 21, green LED 22, push button 13 to GND.

  Privacy: phone MAC addresses are only hashed in RAM to count distinct phones for 20 s. They are never
  stored, printed or transmitted. Only "N phones, strongest -xx dBm" leaves the node.
*/
#define ROLE_RESCUER 1
#define ROLE_GATEWAY 2
#define ROLE      ROLE_GATEWAY     // preset for this folder
#define USE_LORA  1

#include <SPI.h>
#if USE_LORA
#include <LoRa.h>
#endif
#if ROLE == ROLE_RESCUER
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "esp_wifi.h"
#include "page_lite.h"
#endif

#define LORA_NSS 5
#define LORA_RST 4
#define LORA_FREQ 433E6
#define LORA_SF 9
#define LORA_BW 125E3
#define LORA_SYNC 0x5A
#define LORA_POWER 10

const char* NODE_ID = "N1";
const uint32_t RETRY_MS = 3000;
const uint8_t MAX_TRIES = 8;
bool radioOk = false;
String rx;

String jsonEsc(const String& s) {
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((uint8_t)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}
// split "a|b|c" field n (the last field keeps any further '|')
String field(const String& s, int n, bool rest = false) {
  int st = 0;
  for (int i = 0; i < n; i++) { st = s.indexOf('|', st); if (st < 0) return ""; st++; }
  if (rest) return s.substring(st);
  int e = s.indexOf('|', st);
  return e < 0 ? s.substring(st) : s.substring(st, e);
}

#if USE_LORA
bool radioBegin() {
  SPI.begin(18, 19, 23);
  LoRa.setPins(LORA_NSS, LORA_RST, -1);          // no DIO0: the radio is polled
  if (!LoRa.begin(LORA_FREQ)) return false;
  LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(5);
  LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_POWER);
  return true;
}
void radioSend(const String& p) {
  if (!radioOk) return;
  LoRa.beginPacket(); LoRa.print(p); LoRa.endPacket();   // blocking, ~100-400 ms at SF9
}
String radioRecv(int* rssi, float* snr) {
  if (!radioOk) return "";
  int n = LoRa.parsePacket();
  if (!n) return "";
  String s; while (LoRa.available()) s += (char)LoRa.read();
  *rssi = LoRa.packetRssi(); *snr = LoRa.packetSnr();
  return s;
}
#endif

// =====================================================================================
#if ROLE == ROLE_RESCUER
const char* AP_SSID = "SOS Node1";
const uint8_t AP_CH = 6;
const int PIN_ORANGE = 21, PIN_GREEN = 22, PIN_BUTTON = 13;

enum St : uint8_t { SENDING, DELIVERED, READ_, DISPATCHED, FAILED };
const char* ST_NAME[] = {"SENDING", "DELIVERED", "READ", "DISPATCHED", "FAILED"};
struct Msg { String id, body, team; String replies[4]; uint8_t nrep = 0, tries = 0; St st = SENDING; uint32_t next = 0; int rssi = 0; };
const int BOX = 12;
Msg box[BOX];
int nbox = 0, seq = 0, latest = -1;
WebServer web(80);
DNSServer dns;
uint32_t lastHello = 0, lastBtn = 0, lastPresence = 0;

// ---- phone presence (probe requests seen on our channel) ----
const int SEEN = 64;
volatile uint32_t seenHash[SEEN];
volatile int seenN = 0, bestRssi = -127;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
void IRAM_ATTR sniff(void* buf, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT) return;
  const wifi_promiscuous_pkt_t* p = (const wifi_promiscuous_pkt_t*)buf;
  const uint8_t* f = p->payload;
  if (p->rx_ctrl.sig_len < 24 || f[0] != 0x40) return;        // probe request only
  uint32_t h = 2166136261u;                                   // FNV-1a hash of the sender address
  for (int i = 10; i < 16; i++) h = (h ^ f[i]) * 16777619u;
  int r = p->rx_ctrl.rssi;
  portENTER_CRITICAL_ISR(&mux);
  bool dup = false;
  for (int i = 0; i < seenN; i++) if (seenHash[i] == h) { dup = true; break; }
  if (!dup && seenN < SEEN) seenHash[seenN++] = h;
  if (r > bestRssi) bestRssi = r;
  portEXIT_CRITICAL_ISR(&mux);
}

int clientRssi(int* clients) {
  wifi_sta_list_t list; *clients = 0;
  if (esp_wifi_ap_get_sta_list(&list) != ESP_OK || list.num == 0) return 0;
  *clients = list.num; int best = -127;
  for (int i = 0; i < list.num; i++) if (list.sta[i].rssi > best) best = list.sta[i].rssi;
  return best;
}
Msg* findMsg(const String& id) { for (int i = 0; i < nbox; i++) if (box[i].id == id) return &box[i]; return nullptr; }

// read "key":"value" or "key":number from the page's JSON
String jget(const String& b, const char* key) {
  String k = String("\"") + key + "\":";
  int s = b.indexOf(k); if (s < 0) return "";
  s += k.length();
  if (b[s] == '"') {
    String o; int e = s + 1;
    while (e < (int)b.length() && b[e] != '"') { if (b[e] == '\\' && e + 1 < (int)b.length()) { e++; o += b[e] == 'n' ? ' ' : b[e]; } else o += b[e]; e++; }
    return o;
  }
  int e = s; while (e < (int)b.length() && b[e] != ',' && b[e] != '}') e++;
  return b.substring(s, e);
}

void transmit(Msg& m) {
  m.tries++; int c = 0; int r = clientRssi(&c); if (r) m.rssi = r;
#if USE_LORA
  // compact over-the-air SOS: S|id|try|cat|people|injured|bleeding|phoneRssi|note  (note cut to fit one packet)
  String note = jget(m.body, "note"); if (note.length() > 120) note = note.substring(0, 120);
  String p = "S|" + m.id + "|" + m.tries + "|" + jget(m.body, "cat") + "|" + jget(m.body, "people") + "|" +
             jget(m.body, "injured") + "|" + jget(m.body, "bleeding") + "|" + m.rssi + "|" + (jget(m.body, "button") == "true" ? "B" : "") + "|" + note;
  radioSend(p);
  Serial.printf("# TX LoRa %s try %d (%d bytes)\n", m.id.c_str(), m.tries, p.length());
#else
  Serial.printf("{\"ev\":\"sos\",\"id\":\"%s\",\"node\":\"%s\",\"try\":%d,\"rssi\":%d,\"clients\":%d,\"link\":\"usb\",\"data\":%s}\n",
                m.id.c_str(), NODE_ID, m.tries, m.rssi, c, m.body.c_str());
#endif
  m.next = millis() + RETRY_MS + (esp_random() % 700);
}
Msg& newMsg(const String& body) {
  int slot;
  if (nbox < BOX) slot = nbox++;
  else { slot = 0; for (int i = 0; i < BOX; i++) if (box[i].st != SENDING) { slot = i; break; } }
  Msg& m = box[slot]; m = Msg();
  char id[20]; snprintf(id, sizeof id, "%s-%04X-%02d", NODE_ID, (unsigned)(esp_random() & 0xFFFF), (++seq) % 100);
  m.id = id; m.body = body; latest = slot; transmit(m); return m;
}

void sendPage() { web.send_P(200, "text/html; charset=utf-8", PAGE); }
void redirect() { web.sendHeader("Location", "http://192.168.4.1/", true); web.send(302, "text/plain", ""); }
void apiSos() {
  String b = web.arg("plain"); b.trim();
  if (b.length() < 2 || b.length() > 900 || b[0] != '{') { web.send(400, "application/json", "{\"error\":\"bad request\"}"); return; }
  b.replace("\n", " "); b.replace("\r", " "); b.replace("|", "/");
  Msg& m = newMsg(b);
  web.send(200, "application/json", String("{\"ok\":true,\"id\":\"") + m.id + "\"}");
}
void apiPhone() {
  Msg* m = findMsg(web.arg("id"));
  if (!m) { web.send(404, "application/json", "{\"error\":\"unknown\"}"); return; }
  String o = String("{\"id\":\"") + m->id + "\",\"state\":\"" + ST_NAME[m->st] + "\",\"tries\":" + m->tries + ",\"max\":" + MAX_TRIES + ",\"team\":";
  o += (m->st == DISPATCHED) ? String("\"") + jsonEsc(m->team) + String("\"") : String("null");
  o += ",\"replies\":[";
  for (int i = 0; i < m->nrep; i++) { if (i) o += ","; o += String("{\"text\":\"") + jsonEsc(m->replies[i]) + "\"}"; }
  o += "]}";
  web.send(200, "application/json", o);
}
void apiRetry() {
  String b = web.arg("plain"); int s = b.indexOf("\"id\":\"");
  if (s >= 0) { int e = b.indexOf('"', s + 6); Msg* m = findMsg(b.substring(s + 6, e)); if (m && m->st == FAILED) { m->st = SENDING; m->tries = 0; transmit(*m); } }
  web.send(200, "application/json", "{\"ok\":true}");
}

// command from command post: ACK / READ / DISPATCH / REPLY  <id> [text]
void apply(const String& cmd, const String& id, const String& arg) {
  Msg* m = findMsg(id); if (!m) return;
  String state;
  if (cmd == "ACK") { if (m->st == SENDING || m->st == FAILED) m->st = DELIVERED; state = "DELIVERED"; }
  else if (cmd == "READ") { if (m->st == DELIVERED || m->st == SENDING) m->st = READ_; state = "READ"; }
  else if (cmd == "DISPATCH") { m->st = DISPATCHED; m->team = arg.length() ? arg : "Rescue team"; state = "DISPATCHED"; }
  else if (cmd == "REPLY") {
    bool dup = false; for (int i = 0; i < m->nrep; i++) if (m->replies[i] == arg) dup = true;
    if (!dup && arg.length()) { if (m->nrep == 4) { for (int i = 0; i < 3; i++) m->replies[i] = m->replies[i + 1]; m->nrep = 3; } m->replies[m->nrep++] = arg; }
    state = "REPLY";
  } else return;
#if USE_LORA
  if (cmd != "ACK") radioSend("K|" + m->id + "|" + state);           // confirm back to command
#else
  Serial.printf("{\"ev\":\"status_ack\",\"id\":\"%s\",\"state\":\"%s\"}\n", m->id.c_str(), state.c_str());
#endif
}

void presence() {
  int n, best;
  portENTER_CRITICAL(&mux); n = seenN; best = bestRssi; seenN = 0; bestRssi = -127; portEXIT_CRITICAL(&mux);
  int c = 0; clientRssi(&c);
#if USE_LORA
  radioSend("P|" + String(n) + "|" + String(n ? best : 0) + "|" + String(c));
#else
  Serial.printf("{\"ev\":\"presence\",\"node\":\"%s\",\"phones\":%d,\"best_rssi\":%d,\"clients\":%d,\"window_s\":20}\n", NODE_ID, n, n ? best : 0, c);
#endif
}

void leds() {
  bool o = false, g = false; uint32_t t = millis();
  if (latest >= 0) { St s = box[latest].st;
    if (s == SENDING) o = (t / 150) % 2; else if (s == DELIVERED) o = (t / 600) % 2; else if (s == READ_) o = true; else if (s == DISPATCHED) { o = true; g = true; } }
  digitalWrite(PIN_ORANGE, o); digitalWrite(PIN_GREEN, g);
}

void setup() {
  Serial.begin(115200); delay(300);
  pinMode(PIN_ORANGE, OUTPUT); pinMode(PIN_GREEN, OUTPUT); pinMode(PIN_BUTTON, INPUT_PULLUP);
#if USE_LORA
  radioOk = radioBegin();
  Serial.printf("# LoRa radio %s\n", radioOk ? "OK" : "NOT FOUND - check wiring (NSS 5, RST 4, 3V3)");
#endif
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  bool ok = WiFi.softAP(AP_SSID, nullptr, AP_CH);
  dns.start(53, "*", IPAddress(192, 168, 4, 1));
  web.on("/", sendPage); web.on("/sos", sendPage);
  web.on("/generate_204", redirect); web.on("/hotspot-detect.html", redirect); web.on("/connecttest.txt", redirect);
  web.on("/api/sos", HTTP_POST, apiSos); web.on("/api/phone", HTTP_GET, apiPhone); web.on("/api/retry", HTTP_POST, apiRetry);
  web.onNotFound(redirect);
  web.begin();
  wifi_promiscuous_filter_t flt = {.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT};
  esp_wifi_set_promiscuous_filter(&flt);
  esp_wifi_set_promiscuous_rx_cb(&sniff);
  esp_wifi_set_promiscuous(true);
  Serial.printf("# RESCUER NODE %s: Wi-Fi \"%s\" at http://192.168.4.1 · link %s\n", ok ? "UP" : "FAILED", AP_SSID, USE_LORA ? "LoRa" : "USB");
}

void loop() {
  dns.processNextRequest();
  web.handleClient();
  uint32_t now = millis();
#if USE_LORA
  int r; float s; String p = radioRecv(&r, &s);
  if (p.length() > 2 && p[1] == '|') {                         // A|id   C|cmd|id|text
    if (p[0] == 'A') apply("ACK", field(p, 1), "");
    else if (p[0] == 'C') apply(field(p, 1), field(p, 2), field(p, 3, true));
  }
#else
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { rx.trim(); int a = rx.indexOf(' '), b = rx.indexOf(' ', a + 1);
      if (a > 0) apply(rx.substring(0, a), b < 0 ? rx.substring(a + 1) : rx.substring(a + 1, b), b < 0 ? "" : rx.substring(b + 1));
      rx = ""; }
    else if (rx.length() < 200) rx += c;
  }
#endif
  for (int i = 0; i < nbox; i++) { Msg& m = box[i];
    if (m.st == SENDING && (int32_t)(now - m.next) >= 0) {
      if (m.tries >= MAX_TRIES) { m.st = FAILED; Serial.printf("# %s not delivered after %d tries\n", m.id.c_str(), MAX_TRIES); }
      else transmit(m); } }
  if (digitalRead(PIN_BUTTON) == LOW && now - lastBtn > 1500) { lastBtn = now;
    newMsg("{\"cat\":\"TRAPPED\",\"people\":1,\"button\":true,\"injured\":\"unsure\",\"bleeding\":\"no\",\"note\":\"push button on rescuer node\"}"); }
  if (now - lastPresence > 20000) { lastPresence = now; presence(); }
#if !USE_LORA
  if (now - lastHello > 3000) { lastHello = now; int c = 0; clientRssi(&c);
    Serial.printf("{\"ev\":\"hello\",\"node\":\"%s\",\"ssid\":\"%s\",\"clients\":%d,\"link\":\"usb\"}\n", NODE_ID, AP_SSID, c); }
#endif
  leds();
}
#endif  // ROLE_RESCUER

// =====================================================================================
#if ROLE == ROLE_GATEWAY
uint32_t lastHello = 0, lastHeard = 0;
String seenIds[16]; int seenPos = 0;

void setup() {
  Serial.begin(115200); delay(300);
  radioOk = radioBegin();
  Serial.printf("# GATEWAY: LoRa radio %s\n", radioOk ? "OK" : "NOT FOUND - check wiring (NSS 5, RST 4, 3V3)");
}

void loop() {
  int r; float s; String p = radioRecv(&r, &s);
  if (p.length() > 2 && p[1] == '|') {
    lastHeard = millis();
    if (p[0] == 'S') {          // S|id|try|cat|people|injured|bleeding|phoneRssi|B|note
      String note = field(p, 9, true), btn = field(p, 8);
      Serial.printf("{\"ev\":\"sos\",\"id\":\"%s\",\"node\":\"N1\",\"try\":%s,\"rssi\":%s,\"lora_rssi\":%d,\"lora_snr\":%.1f,\"link\":\"lora\",\"bytes\":%d,"
                    "\"data\":{\"cat\":\"%s\",\"people\":%s,\"injured\":\"%s\",\"bleeding\":\"%s\",\"note\":\"%s\"%s}}\n",
                    jsonEsc(field(p, 1)).c_str(), field(p, 2).c_str(), field(p, 7).c_str(), r, s, p.length(),
                    jsonEsc(field(p, 3)).c_str(), field(p, 4).length() ? field(p, 4).c_str() : "1", jsonEsc(field(p, 5)).c_str(), jsonEsc(field(p, 6)).c_str(),
                    jsonEsc(note).c_str(), btn == "B" ? ",\"button\":true" : "");
    } else if (p[0] == 'K') {   // K|id|STATE
      Serial.printf("{\"ev\":\"status_ack\",\"id\":\"%s\",\"state\":\"%s\",\"lora_rssi\":%d}\n", jsonEsc(field(p, 1)).c_str(), jsonEsc(field(p, 2)).c_str(), r);
    } else if (p[0] == 'P') {   // P|phones|best|clients
      Serial.printf("{\"ev\":\"presence\",\"node\":\"N1\",\"phones\":%s,\"best_rssi\":%s,\"clients\":%s,\"lora_rssi\":%d,\"lora_snr\":%.1f,\"window_s\":20}\n",
                    field(p, 1).c_str(), field(p, 2).c_str(), field(p, 3).c_str(), r, s);
    }
  }
  while (Serial.available()) {   // laptop: ACK|READ|DISPATCH|REPLY <id> [text]
    char c = Serial.read();
    if (c == '\n') {
      rx.trim(); int a = rx.indexOf(' ');
      if (a > 0) {
        String cmd = rx.substring(0, a), rest = rx.substring(a + 1);
        int b = rest.indexOf(' ');
        String id = b < 0 ? rest : rest.substring(0, b), arg = b < 0 ? "" : rest.substring(b + 1);
        arg.replace("|", "/");
        if (cmd == "ACK") radioSend("A|" + id);
        else radioSend("C|" + cmd + "|" + id + "|" + arg);
      }
      rx = "";
    } else if (rx.length() < 200) rx += c;
  }
  if (millis() - lastHello > 3000) {
    lastHello = millis();
    Serial.printf("{\"ev\":\"hello\",\"node\":\"GW\",\"radio\":%s,\"link\":\"lora\",\"node_heard_s\":%ld}\n",
                  radioOk ? "true" : "false", lastHeard ? (long)((millis() - lastHeard) / 1000) : -1L);
  }
}
#endif  // ROLE_GATEWAY
