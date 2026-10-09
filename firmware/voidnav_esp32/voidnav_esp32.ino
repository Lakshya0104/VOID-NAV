/*
  VOID-NAV prototype firmware
  Board : ESP32-WROOM DevKit ("ESP32 Dev Module" in Arduino IDE)
  Radios: Ai-Thinker RA-02 (SX1278, 433 MHz) x2 on one SPI bus
  Library: "LoRa" by Sandeep Mistry (Arduino Library Manager)

  What it does (single-board mode, the default):
    Phone --Wi-Fi--> ESP32 web page --> RADIO A (survivor node) ~~433 MHz LoRa~~> RADIO B (command gateway)
          --> USB serial (JSON lines) --> laptop dashboard
    Laptop sends "READ <id>" / "DISPATCH <id>" over serial --> RADIO B ~~LoRa~~> RADIO A
          --> node LEDs + the phone's status page update.

  Every message is retried until the other side acknowledges it, so delivery status is real,
  not assumed. Both radios really talk over the air; they just share one ESP32 until a second
  board arrives (then flash ROLE_NODE on one board and ROLE_GATEWAY on the other).
*/
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include <LoRa.h>
#include "driver/gpio.h"

// ------------------------------------------------------------------ role
#define ROLE_SINGLE_BOARD 0   // one ESP32, two radios (what we have today)
#define ROLE_NODE         1   // second-ESP32 setup: survivor node (web page + button + LEDs)
#define ROLE_GATEWAY      2   // second-ESP32 setup: command gateway (USB to laptop)
#define ROLE ROLE_SINGLE_BOARD

#define HAS_NODE    (ROLE != ROLE_GATEWAY)
#define HAS_GATEWAY (ROLE != ROLE_NODE)

// ------------------------------------------------------------------ pins
// Shared SPI bus (both radios): SCK 18, MISO 19, MOSI 23 (ESP32 default VSPI pins)
#define RADIO_A_NSS 5     // radio A chip-select
#define RADIO_A_RST 4     // radio A reset
#define RADIO_B_NSS 27    // radio B chip-select (single-board mode only)
#define RADIO_B_RST 32    // radio B reset       (single-board mode only)
#define PIN_BUTTON  13    // push button to GND
#define PIN_LED_READ 21   // "orange" LED: blinking = sending/delivered, solid = read by rescuer
#define PIN_LED_DISP 22   // "green"  LED: solid = rescue dispatched

// ------------------------------------------------------------------ radio settings
#define LORA_FREQ     433E6
#define LORA_SF       9
#define LORA_BW       125E3
#define LORA_SYNC     0x5A           // private network id, ignores other LoRa traffic
#if ROLE == ROLE_SINGLE_BOARD
#define TX_POWER_DBM  2              // radios are centimetres apart: whisper, don't shout
#else
#define TX_POWER_DBM  10
#endif

#define AP_SSID       "VOID-NAV SOS"
#define RETRY_MS      4000
#define MAX_TRIES     8
#define STATUS_TRIES  6

LoRaClass radioA, radioB;
bool radioAok = false, radioBok = false;
#if HAS_NODE
LoRaClass &nodeRadio = radioA;
#endif
#if HAS_GATEWAY
#if ROLE == ROLE_SINGLE_BOARD
LoRaClass &gwRadio = radioB;
#else
LoRaClass &gwRadio = radioA;
#endif
#endif
bool nodeRadioOk() { return radioAok; }
bool gwRadioOk() { return ROLE == ROLE_SINGLE_BOARD ? radioBok : radioAok; }

String nodeId;

// ------------------------------------------------------------------ helpers
String clean(String s, int maxLen) {
  s.replace("|", "/"); s.replace("\n", " "); s.replace("\r", " "); s.trim();
  if ((int)s.length() > maxLen) s = s.substring(0, maxLen);
  return s;
}

String jsonEsc(const String &s) {
  String o; o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((uint8_t)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}

int splitFields(const String &s, String *out, int maxF) {
  int n = 0, start = 0;
  while (n < maxF - 1) {
    int p = s.indexOf('|', start);
    if (p < 0) break;
    out[n++] = s.substring(start, p); start = p + 1;
  }
  out[n++] = s.substring(start);
  return n;
}

bool radioBegin(LoRaClass &r, int nss, int rst, const char *label) {
  r.setPins(nss, rst, -1);            // DIO0 not needed: we poll the radio
  if (!r.begin(LORA_FREQ)) {
    Serial.printf("# ERROR: %s not found (NSS=%d RST=%d). Check its wires.\n", label, nss, rst);
    return false;
  }
  r.setSpreadingFactor(LORA_SF);
  r.setSignalBandwidth(LORA_BW);
  r.setCodingRate4(5);
  r.setSyncWord(LORA_SYNC);
  r.enableCrc();
  r.setTxPower(TX_POWER_DBM);
  Serial.printf("# %s OK\n", label);
  return true;
}

// Put a radio into a fresh receive window.
void armRx(LoRaClass &r) { r.idle(); r.parsePacket(); }

bool radioSend(LoRaClass &tx, const String &payload) {
  // On one board, re-arm the other radio right before we transmit so it is listening.
  if (radioAok && &tx != &radioA) armRx(radioA);
  if (radioBok && &tx != &radioB) armRx(radioB);
  tx.beginPacket();
  tx.print(payload);
  bool ok = tx.endPacket();   // blocks until sent (~0.3 s at SF9)
  Serial.printf("# TX %s : %s\n", &tx == &radioA ? "A" : "B", payload.c_str());
  return ok;
}

String radioReceive(LoRaClass &r, int &rssi, float &snr) {
  int n = r.parsePacket();
  if (n <= 0) return "";
  String s;
  while (r.available()) s += (char)r.read();
  rssi = r.packetRssi(); snr = r.packetSnr();
  return s;
}

// =================================================================== NODE (survivor side)
#if HAS_NODE
enum MsgState { ST_SENDING, ST_DELIVERED, ST_READ, ST_DISPATCHED, ST_FAILED };
const char *stName[] = {"sending", "delivered", "read", "dispatched", "failed"};

struct OutMsg {
  bool used = false;
  String id, payload;
  MsgState st = ST_SENDING;
  uint8_t tries = 0;
  uint32_t nextTx = 0;
};
#define MAX_OUT 10
OutMsg outbox[MAX_OUT];
int lastMsg = -1;              // index of newest message (drives the LEDs)
uint32_t seqNo;

WebServer web(80);
DNSServer dns;

OutMsg *findOut(const String &id) {
  for (auto &m : outbox) if (m.used && m.id == id) return &m;
  return nullptr;
}

String createSos(int prio, int people, String cat, String name, String ip, String msg) {
  int slot = (lastMsg + 1) % MAX_OUT;
  OutMsg &m = outbox[slot];
  m.used = true;
  m.id = nodeId + "-" + String(seqNo++);
  m.payload = "S|" + m.id + "|" + String(prio) + "|" + String(people) + "|" + clean(cat, 12) + "|" +
              clean(name, 24) + "|" + clean(ip, 15) + "|" + clean(msg, 120);
  m.st = ST_SENDING; m.tries = 0; m.nextTx = millis();
  lastMsg = slot;
  Serial.printf("# NODE new SOS %s\n", m.id.c_str());
  return m.id;
}

void nodeRetryLoop() {
  if (!nodeRadioOk()) return;
  uint32_t now = millis();
  for (auto &m : outbox) {
    if (!m.used || m.st != ST_SENDING || (int32_t)(now - m.nextTx) < 0) continue;
    if (m.tries >= MAX_TRIES) { m.st = ST_FAILED; Serial.printf("# NODE %s FAILED after %d tries\n", m.id.c_str(), m.tries); continue; }
    m.tries++;
    radioSend(nodeRadio, m.payload);
    m.nextTx = millis() + RETRY_MS + random(0, 1000);
    return;                       // one transmission per loop pass
  }
}

void nodeHandlePacket(const String &p) {
  String f[4]; int n = splitFields(p, f, 4);
  if (n < 2) return;
  OutMsg *m = findOut(f[1]);
  if (!m) return;                                 // not ours
  if (f[0] == "A") {                              // gateway has it
    if (m->st == ST_SENDING || m->st == ST_FAILED) m->st = ST_DELIVERED;
  } else if (f[0] == "U" && n >= 3) {             // rescuer status update
    MsgState ns = f[2] == "D" ? ST_DISPATCHED : ST_READ;
    if (m->st == ST_SENDING || m->st == ST_FAILED || m->st == ST_DELIVERED || ns > m->st) m->st = ns;  // never goes backwards
    radioSend(nodeRadio, "K|" + m->id + "|" + f[2]);
  }
  Serial.printf("# NODE %s -> %s\n", m->id.c_str(), stName[m->st]);
}

// ---- LEDs
void nodeLeds() {
  uint32_t t = millis();
  bool r = false, d = false;
  if (!nodeRadioOk()) { r = d = (t / 100) % 2; }               // radio missing: both flash fast
  else if (lastMsg >= 0) {
    switch (outbox[lastMsg].st) {
      case ST_SENDING:    r = (t / 150) % 2; break;               // fast blink
      case ST_DELIVERED:  r = (t / 700) % 2; break;               // slow blink
      case ST_READ:       r = true; break;                        // solid orange
      case ST_DISPATCHED: d = true; break;                        // solid green
      case ST_FAILED:     r = (t / 300) % 2; d = !r; break;       // alternate
    }
  }
  digitalWrite(PIN_LED_READ, r);
  digitalWrite(PIN_LED_DISP, d);
}

// ---- button
void nodeButton() {
  static bool last = HIGH; static uint32_t changed = 0, lastSend = 0;
  bool b = digitalRead(PIN_BUTTON);
  if (b != last && millis() - changed > 40) {
    changed = millis(); last = b;
    if (b == LOW && millis() - lastSend > 3000) {
      lastSend = millis();
      createSos(0, 1, "BUTTON", "", "button", "SOS button pressed on node " + nodeId);
    }
  }
}

// ---- web page
const char PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VOID-NAV SOS</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#0b1320;color:#fff;padding:16px}
h1{margin:4px 0 2px;font-size:26px}.sub{color:#8d99ae;font-size:14px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cat{background:#1c2a3f;border:2px solid #1c2a3f;color:#fff;border-radius:14px;padding:14px 8px;font-size:17px}
.cat.on{border-color:#ff6b35;background:#3a2418}
label{display:block;margin:16px 0 6px;color:#c9d2de;font-size:14px}
input,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #2a3b55;background:#111c2e;color:#fff;font-size:16px}
.cnt{display:flex;align-items:center;gap:12px}.cnt button{width:48px;height:48px;border-radius:50%;border:0;background:#2ec4b6;font-size:24px}
.cnt span{font-size:28px;min-width:40px;text-align:center}
#send{width:100%;margin-top:20px;padding:18px;border:0;border-radius:14px;background:#e63946;color:#fff;font-size:22px;font-weight:700}
#send:disabled{opacity:.5}.note{color:#8d99ae;font-size:12px;margin-top:6px}
.steps{margin-top:22px;background:#1c2a3f;border-radius:14px;padding:14px;display:none}
.st{display:flex;align-items:center;gap:12px;padding:8px 0;color:#5a6b85}.st b{width:28px;height:28px;border-radius:50%;background:#2a3b55;display:flex;align-items:center;justify-content:center}
.st.ok{color:#fff}.st.ok b{background:#2ec4b6}.st.read b{background:#ff6b35}.st.disp b{background:#2ec4b6}
#fail{display:none;color:#ffc857;margin-top:8px}
</style></head><body>
<h1>🆘 VOID-NAV SOS</h1><div class="sub">No internet needed. Your message travels by LoRa radio to the rescue team.</div>
<div class="grid" id="cats"></div>
<label>How many people need help?</label>
<div class="cnt"><button onclick="ch(-1)">−</button><span id="n">1</span><button onclick="ch(1)">+</button></div>
<label>Your name / phone (optional, self-reported)</label><input id="name" maxlength="24">
<label>Message</label><textarea id="msg" rows="3" maxlength="120" placeholder="e.g. 2nd floor, leg injured, need water"></textarea>
<div class="note">Max 120 characters. Short messages travel faster.</div>
<button id="send" onclick="send()">SEND SOS</button>
<div class="steps" id="steps">
<div class="st" id="s0"><b>1</b>Sent over LoRa radio <span id="tries"></span></div>
<div class="st" id="s1"><b>2</b>Reached rescue command</div>
<div class="st" id="s2"><b>3</b>Read by a rescuer</div>
<div class="st" id="s3"><b>4</b>Rescue dispatched</div>
<div id="fail">⚠ Not delivered yet. Stay near this node and press SEND again.</div>
<div class="note" id="mid"></div></div>
<script>
const C=[["TRAPPED","🧱 Trapped"],["MEDICAL","🩸 Medical"],["FIRE","🔥 Fire"],["FLOOD","🌊 Flood"],["FOOD_WATER","💧 Food / water"],["OTHER","✍️ Other"]];
let cat="TRAPPED",n=1,id=localStorage.getItem("vn_id"),timer;
const cats=document.getElementById("cats");
C.forEach(([k,t])=>{const b=document.createElement("button");b.className="cat"+(k==cat?" on":"");b.textContent=t;
b.onclick=()=>{cat=k;[...cats.children].forEach(x=>x.classList.remove("on"));b.classList.add("on")};cats.appendChild(b)});
function ch(d){n=Math.max(1,Math.min(99,n+d));document.getElementById("n").textContent=n}
async function send(){const s=document.getElementById("send");s.disabled=true;
const b=new URLSearchParams({cat,people:n,name:document.getElementById("name").value,msg:document.getElementById("msg").value});
try{const r=await fetch("/send",{method:"POST",body:b});const j=await r.json();id=j.id;localStorage.setItem("vn_id",id);poll()}catch(e){alert("Could not reach the node")}
setTimeout(()=>s.disabled=false,3000)}
async function poll(){clearTimeout(timer);if(!id)return;document.getElementById("steps").style.display="block";
try{const j=await(await fetch("/status?id="+encodeURIComponent(id))).json();
const lv={sending:0,failed:0,delivered:1,read:2,dispatched:3}[j.state];
for(let i=0;i<4;i++){const e=document.getElementById("s"+i);e.className="st"+(i<=lv&&(j.state!="sending"&&j.state!="failed"||i==0)?" ok":"")+(i==2&&lv>=2?" read":"")}
document.getElementById("tries").textContent=j.state=="sending"?"(try "+j.tries+")":"";
document.getElementById("fail").style.display=j.state=="failed"?"block":"none";
document.getElementById("mid").textContent="Message ID "+id;}catch(e){}
timer=setTimeout(poll,1500)}
poll();
</script></body></html>)HTML";

void webRedirect() {
  web.sendHeader("Location", "http://192.168.4.1/", true);
  web.send(302, "text/plain", "");
}

void setupWeb() {
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  WiFi.softAP(AP_SSID);
  dns.start(53, "*", IPAddress(192, 168, 4, 1));       // every web address leads to our page (captive portal)
  web.on("/", []() { web.send_P(200, "text/html; charset=utf-8", PAGE); });
  web.on("/send", HTTP_POST, []() {
    int people = constrain(web.arg("people").toInt(), 1, 99);
    String cat = web.arg("cat"); if (cat == "") cat = "OTHER";
    String msg = web.arg("msg"); if (msg.length() == 0) msg = "(no text) " + cat;
    String id = createSos(cat == "TRAPPED" || cat == "MEDICAL" || cat == "FIRE" ? 0 : 1, people, cat,
                          web.arg("name"), web.client().remoteIP().toString(), msg);
    web.send(200, "application/json", "{\"id\":\"" + id + "\"}");
  });
  web.on("/status", []() {
    OutMsg *m = findOut(web.arg("id"));
    if (!m) { web.send(404, "application/json", "{\"state\":\"unknown\"}"); return; }
    web.send(200, "application/json", String("{\"state\":\"") + stName[m->st] + "\",\"tries\":" + m->tries + "}");
  });
  web.onNotFound(webRedirect);                         // Android/iOS "sign in to network" checks land here
  web.begin();
  Serial.printf("# Wi-Fi \"%s\" up, page at http://192.168.4.1\n", AP_SSID);
}
#endif

// =================================================================== GATEWAY (command side)
#if HAS_GATEWAY
struct Seen {
  bool used = false;
  String id;
  uint8_t state = 0;         // 0 new, 1 read, 2 dispatched
  bool pending = false;      // status update still waiting for node's confirmation
  uint8_t tries = 0;
  uint32_t nextTx = 0;
};
#define MAX_SEEN 32
Seen seen[MAX_SEEN];
int seenNext = 0;

Seen *findSeen(const String &id) {
  for (auto &s : seen) if (s.used && s.id == id) return &s;
  return nullptr;
}

void gwHandlePacket(const String &p, int rssi, float snr) {
  String f[8]; int n = splitFields(p, f, 8);
  if (f[0] == "S" && n == 8) {
    bool isNew = findSeen(f[1]) == nullptr;
    if (isNew) {
      Seen &s = seen[seenNext]; seenNext = (seenNext + 1) % MAX_SEEN;
      s = Seen(); s.used = true; s.id = f[1];
      Serial.printf("{\"ev\":\"sos\",\"id\":\"%s\",\"prio\":%d,\"people\":%d,\"cat\":\"%s\",\"name\":\"%s\",\"ip\":\"%s\",\"msg\":\"%s\",\"rssi\":%d,\"snr\":%.1f,\"hops\":1}\n",
                    jsonEsc(f[1]).c_str(), (int)f[2].toInt(), (int)f[3].toInt(), jsonEsc(f[4]).c_str(), jsonEsc(f[5]).c_str(),
                    jsonEsc(f[6]).c_str(), jsonEsc(f[7]).c_str(), rssi, snr);
    } else {
      Serial.printf("# GW duplicate %s (node retried, re-sending ACK)\n", f[1].c_str());
    }
    if (ROLE != ROLE_SINGLE_BOARD) delay(60);          // let the node switch back to listening
    radioSend(gwRadio, "A|" + f[1]);
  } else if (f[0] == "K" && n >= 3) {
    Seen *s = findSeen(f[1]);
    if (s && s->pending && ((f[2] == "D") == (s->state == 2))) {
      s->pending = false;
      Serial.printf("{\"ev\":\"status_ack\",\"id\":\"%s\",\"state\":\"%s\"}\n", s->id.c_str(), s->state == 2 ? "dispatched" : "read");
    }
  }
}

void gwSerialCommands() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (line.length() < 80) line += c; continue; }
    line.trim();
    if (line.length() == 0) continue;
    int sp = line.indexOf(' ');
    String cmd = sp < 0 ? line : line.substring(0, sp), id = sp < 0 ? "" : line.substring(sp + 1);
    cmd.toUpperCase(); id.trim();
    if (cmd == "PING") Serial.println("{\"ev\":\"pong\"}");
    else if (cmd == "READ" || cmd == "DISPATCH") {
      Seen *s = findSeen(id);
      uint8_t want = cmd == "DISPATCH" ? 2 : 1;
      if (!s) Serial.printf("{\"ev\":\"error\",\"msg\":\"unknown id %s\"}\n", jsonEsc(id).c_str());
      else if (want > s->state) { s->state = want; s->pending = true; s->tries = 0; s->nextTx = millis(); }
    } else Serial.println("{\"ev\":\"error\",\"msg\":\"commands: READ <id>, DISPATCH <id>, PING\"}");
    line = "";
  }
}

void gwStatusLoop() {
  if (!gwRadioOk()) return;
  uint32_t now = millis();
  for (auto &s : seen) {
    if (!s.used || !s.pending || (int32_t)(now - s.nextTx) < 0) continue;
    const char *st = s.state == 2 ? "dispatched" : "read";
    if (s.tries >= STATUS_TRIES) {
      s.pending = false;
      Serial.printf("{\"ev\":\"status_fail\",\"id\":\"%s\",\"state\":\"%s\"}\n", s.id.c_str(), st);
      continue;
    }
    s.tries++;
    radioSend(gwRadio, "U|" + s.id + "|" + (s.state == 2 ? "D" : "R"));
    Serial.printf("{\"ev\":\"status_sent\",\"id\":\"%s\",\"state\":\"%s\",\"try\":%d}\n", s.id.c_str(), st, s.tries);
    s.nextTx = millis() + 3000 + random(0, 800);
    return;
  }
}
#endif

// =================================================================== setup / loop
void setup() {
  Serial.begin(115200);
  delay(300);
  uint8_t mac[6]; WiFi.macAddress(mac);
  char buf[5]; snprintf(buf, sizeof buf, "%02X%02X", mac[4], mac[5]); nodeId = buf;
  randomSeed(esp_random());

  // Hold BOTH chip-selects high before talking to either radio, or they answer at the same time.
  pinMode(RADIO_A_NSS, OUTPUT); digitalWrite(RADIO_A_NSS, HIGH);
#if ROLE == ROLE_SINGLE_BOARD
  pinMode(RADIO_B_NSS, OUTPUT); digitalWrite(RADIO_B_NSS, HIGH);
#endif
  SPI.begin(18, 19, 23);

  radioAok = radioBegin(radioA, RADIO_A_NSS, RADIO_A_RST, ROLE == ROLE_GATEWAY ? "Gateway radio" : "Radio A (node)");
#if ROLE == ROLE_SINGLE_BOARD
  radioBok = radioBegin(radioB, RADIO_B_NSS, RADIO_B_RST, "Radio B (gateway)");
#endif

#if HAS_NODE
  seqNo = 100 + esp_random() % 900;
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED_READ, OUTPUT); pinMode(PIN_LED_DISP, OUTPUT);
  // No resistors in the kit: use the ESP32's weakest pin drive (~5 mA) to protect the LEDs.
  gpio_set_drive_capability((gpio_num_t)PIN_LED_READ, GPIO_DRIVE_CAP_0);
  gpio_set_drive_capability((gpio_num_t)PIN_LED_DISP, GPIO_DRIVE_CAP_0);
  for (int i = 0; i < 3; i++) {                     // LED self-test
    digitalWrite(PIN_LED_READ, 1); digitalWrite(PIN_LED_DISP, 1); delay(150);
    digitalWrite(PIN_LED_READ, 0); digitalWrite(PIN_LED_DISP, 0); delay(150);
  }
  setupWeb();
#endif
  Serial.printf("{\"ev\":\"boot\",\"role\":\"%s\",\"node\":\"%s\",\"radioA\":%s,\"radioB\":%s}\n",
                ROLE == ROLE_SINGLE_BOARD ? "single" : ROLE == ROLE_NODE ? "node" : "gateway",
                nodeId.c_str(), radioAok ? "true" : "false", radioBok ? "true" : "false");
}

void loop() {
  int rssi; float snr; String p;
#if HAS_NODE
  dns.processNextRequest();
  web.handleClient();
  nodeButton();
  if (nodeRadioOk() && (p = radioReceive(nodeRadio, rssi, snr)).length()) {
    Serial.printf("# RX node (%d dBm): %s\n", rssi, p.c_str());
    nodeHandlePacket(p);
  }
  nodeRetryLoop();
  nodeLeds();
#endif
#if HAS_GATEWAY
  gwSerialCommands();
  if (gwRadioOk() && (p = radioReceive(gwRadio, rssi, snr)).length()) {
    Serial.printf("# RX gateway (%d dBm, SNR %.1f): %s\n", rssi, snr, p.c_str());
    gwHandlePacket(p, rssi, snr);
  }
  gwStatusLoop();
#endif
}
