# VOID-NAV — Off-Grid Emergency Communication (TH2-PS-NGC-008)

A delay-tolerant, multi-hop emergency messaging network that works without cellular towers or Internet.
Each device stores, carries and forwards messages. Messages are routed by priority and an estimate of how likely each node is to reach the destination. Delivery receipts are passed back from device to device so the sender knows the message arrived.

- `sim/voidnav.py` — a simulator in pure Python with no dependencies. It compares four protocols (direct carry, epidemic flood, spray & wait, VOID-NAV) with 0–50% of nodes failed and a regional blackout. Each setting runs with 5 seeds.
- `results/results.json` — the simulator's output (delivery ratio, SOS latency, overhead, ACK ratio).
- `deck/VOID-NAV_Off-Grid_Emergency_Comms.pptx` — the 14-slide technical presentation. Its charts are built from the results.

```bash
python3 sim/voidnav.py results/results.json          # ~90 s
SKILL=<pptx-skill-dir> node deck/build_deck.js       # needs pptxgenjs
```

## Hardware prototype (build 1: one ESP32, two RA-02 radios)

- `firmware/voidnav_esp32/voidnav_esp32.ino`: the ESP32 firmware. It serves the phone SOS page over Wi-Fi with a captive portal. Radio A sends each SOS over 433 MHz LoRa and radio B receives it. Messages are retried until acknowledged. Received SOS messages appear as JSON lines on USB serial at 115200 baud. `READ <id>` / `DISPATCH <id>` typed on serial travel back over LoRa to the node's LEDs and the phone page. Set `ROLE` to `ROLE_NODE` / `ROLE_GATEWAY` when a second ESP32 is available.
- `docs/wiring.html`: a beginner wiring guide with a pin map, wire checklist, upload steps and troubleshooting.

| Signal | ESP32 | Radio A | Radio B |
|---|---|---|---|
| 3.3 V / GND | 3V3 / GND | 3.3V / GND | 3.3V / GND |
| SCK / MISO / MOSI | D18 / D19 / D23 | shared | shared |
| NSS | — | D5 | D27 |
| RST | — | D4 | D32 |
| LED 1 (read) / LED 2 (dispatched) | D21 / D22 | | |
| Button (to GND) | D13 | | |
