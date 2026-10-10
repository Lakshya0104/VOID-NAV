# VOID-NAV

**An instant private network that rescuers carry in.** The phone a survivor already has becomes a beacon, and it gets an answer back: *Delivered → Read by rescuer → Help dispatched*.

Built by Team VOID for Tech Horizon 2.0 · Next-Generation Communication. It needs no towers, no internet, no app and no SIM.

```
 Survivor's phone ──Wi-Fi "SOS Node1"──► RESCUER NODE  (ESP32 + RA-02 LoRa, carried by the search team)
                                          · serves the SOS page at 192.168.4.1 (captive portal)
                                          · counts nearby phones from Wi-Fi probe requests → survivor heatmap
                                          · on-device AI reads the survivor's words → 5-byte SemCode
                                                │  LoRa 433 MHz, SF9   (SOS · phone counts · confirmations)
                                                ▼
                                         COMMAND GATEWAY (ESP32 + RA-02) ─USB─► laptop: command server ─► Rescue dashboard
            ◄─────────────── ACK · READ · DISPATCH · REPLY travel back the same way to the survivor's phone ───────────────
```

## What's in this repository

| Folder | What it is |
|---|---|
| `command/` | **Rescue command dashboard + survivor SOS page + command server** (Python 3 standard library only). |
| `command/ai/` | **The AI model for semantic compression**: training data generator, trainer, trained model (`sos_model.json`). |
| `firmware/voidnav_rescuer/` | Rescuer node firmware: Wi-Fi SOS page, phone-presence scan, LoRa uplink with retries. |
| `firmware/voidnav_gateway/` | Command gateway firmware: LoRa ⇄ USB JSON lines. |
| `firmware/voidnav_rescuer_usb_only/` | Rescuer node without a LoRa link: the node talks to the laptop over USB (same messages). |
| `firmware/flash.bat` | One-command compile and flash with `arduino-cli`. |
| `semantic/semcode.py` | SemCode: the 40-bit codebook, encoder/decoder and LoRa airtime maths. |
| `quantum/qaoa_relays.py` | QAOA relay planner (penalty and XY-mixer) with a brute-force check. |
| `sim/` | Self-healing relay simulator and the 66-node outage evaluation. |
| `firmware/voidnav_esp32/`, `docs/wiring.html` | Earlier single-board build and the wiring guide. |

## The survivor ↔ rescuer loop

1. **The survivor joins the open Wi-Fi "SOS Node1".** The SOS page opens by itself and asks:
   - what happened (trapped, collapse, medical, fire, flood, food/water, shelter, safe, other);
   - how many people, whether anyone is injured or bleeding;
   - a free-text note in any language.
2. **The rescuer node reads the meaning and packs it into 5 bytes** (see the AI model below). It sends them over LoRa and retries until command acknowledges. The survivor sees *Sending → Delivered*.
3. **The dashboard raises an alert** with a siren, a voice alert for critical SOS, and a *Semantic compression demo* button. Cards are sorted critical-first.
4. **Opening the card marks it READ** (one-way, cannot be undone). The phone shows *Read by rescuer* with a tone and vibration.
5. **The rescuer dispatches.** It can be a rescue team, or for medical emergencies **108 ambulance + hospital pre-alert**. The phone shows *Help is on the way* and the team name. Short replies ("Team arriving in 10 min") pop up on the phone.
6. **Map:** the heatmap of where survivors are, SOS rings, and nearby hospitals. Tap a hospital to see its type, address and published phone numbers.
7. **Field viewer** (`/command?viewer=1`): an ambulance crew or field hospital opens the dashboard read-only on any phone on the laptop's network.
8. **CAP export · PROPOSED:** each SOS can be exported as a Common Alerting Protocol 1.2 record for SACHET, state control rooms and 108 once any backhaul exists (satellite terminal, surviving fibre, restored cellular).

## AI semantic compression

A survivor's message such as

> *"wall fell on us in the cellar, my old mother is bleeding from her head, we are 4 people, need water and a cutter"*

is **132 bytes** of text. The on-device model reads it as: category, injured, bleeding, people, position (basement), vulnerable (elderly), needs (medical, water, rescue tools) and urgency. SemCode packs that into a **5-byte token**, sent with a 10-byte header (15 bytes on air).

| | Bytes on air | Airtime SF9 | Airtime SF12 |
|---|---|---|---|
| Free text + taps | 142 | 738 ms | 5,415 ms |
| SemCode token | 15 | 165 ms | 1,155 ms |

That is **−89% bytes, −78% airtime and about 4.5× more SOS per channel-hour** for this message. Every SOS shows its own numbers in the dashboard's *Semantic compression demo*. Airtime uses the Semtech SX127x time-on-air formula (AN1200.13: 125 kHz, CR 4/5, CRC on).

### The model (`command/ai/`)

- **Type:** a Naive Bayes ensemble written in plain Python, with no dependencies, small enough to run on the command laptop or a gateway-class device. It has one multiclass head for category, one for position, and 15 binary heads for injured, bleeding, unconscious, 8 needs and 4 vulnerable groups. A separate extractor reads the people count from numbers and number words.
- **Features:** word unigrams and bigrams, plus a multilingual root-word lexicon. For example, `phas`, `chikk` and `stuck` all point to trapped; `khoon`, `rakt` and `bleed` point to bleeding. The model learns how much to trust each root from data. Character n-grams were tried and dropped, because they memorised phrasings and hurt accuracy on new wording.
- **Languages:** English, Hinglish, Telugu-English, Hindi (Devanagari) and Telugu script.
- **Training data:** 4,200 SOS messages generated from phrase banks (`sos_data.py`). This is synthetic data; real SOS logs aren't publicly available.
- **Evaluation:**
  - The **held-out** set (900 messages) uses phrasings the model never saw in training.
  - A separate **hand-written** set has 30 natural messages, written and labelled by hand.

| Field | Held-out (unseen wording) | Hand-written |
|---|---|---|
| Category | 83.3% | 90.0% |
| Bleeding | 96.6% | 96.7% |
| Injured | 93.4% | 86.7% |
| Vulnerable (all 4 flags exact) | 88.4% | 80.0% |
| Needs (all 8 flags exact) | 53.9% | 63.3% |
| People count | 99.8% | 100% |

- **Safety rule:** the survivor's taps always win. The AI fills in what was not tapped and can only **add information or raise severity, never lower it**. The survivor's own words are kept on the node and shown to the rescuer.

```bash
cd command
python ai/sos_ai.py train                                  # retrain (~3 s) and print accuracy
python ai/sos_ai.py "memu 5 mandi illu lo chikkukunnam"    # inspect one prediction
```

## Relay planning with QAOA (dashboard tab *Relays · QAOA*)

**Question:** how many relays does the rescue team need, and where should they go?

**Inputs (your own, on the map):**
- candidate relay sites, such as rooftops or water tanks (up to 10, one qubit each);
- survivor groups: click to add, or *Import SOS + heatmap*;
- the command post position;
- relay reach and a coverage target (e.g. 90% of people).

**How it answers:**
1. For K = 1, 2, 3 … it builds an XY-mixer QAOA circuit. The circuit uses a Dicke start state, an RZ/RZZ cost layer from the coverage QUBO, and an RXX+RYY ring mixer, so every measured plan has exactly K relays.
2. It **optimises the angles live** (Nelder-Mead, layer-by-layer warm start) on an exact statevector.
3. It samples 1,024 shots and keeps the best plan.
4. It stops at the **smallest K that meets the coverage target** and reports *"K relays needed"*.
5. Every K is checked against brute force, and it reports whether each relay links back to the command post.

The browser statevector reproduces the Qiskit Aer reference run of `quantum/qaoa_relays.py` exactly: P(optimum) is 21.08% for the 8-site, K = 3 demo map. No quantum speed-up is claimed at 8–10 sites; the formulation is what carries over to quantum hardware as maps grow.

**Self-healing (dashboard tab *Self-healing*, continues from the QAOA plan):** SOS messages flow from the farthest survivor group through the chosen relays to the command post, using the firmware's rules:
- HELLO beacons every 30 s; a neighbour is dropped after 3 missed beacons;
- each node keeps a hop-count gradient toward the gateway;
- messages only move closer to the gateway;
- with no ACK in 2 s, it retries the next-best neighbour;
- with no route, it stores the message and carries it until one appears.

Click a relay to destroy it and watch the route re-form; click it again to restore it. **Run disaster scenario** destroys the relay on the original route at 150 s and a second relay at 330 s, then repairs the second one at 520 s.

A fixed route on the same relays runs alongside for comparison. In our runs, self-healing delivered **40/40 SOS** and the fixed route **6/40**. While the survivors' node was cut off, its SOS were stored, then all delivered when a relay came back. Hop counts longer than the network are treated as "no route", which prevents count-to-infinity loops.

### Running the planner in Qiskit

`command/quantum/qiskit_planner.py` builds the same circuit in **Qiskit 2.x**:
- `initialize` (Dicke |K⟩) → `rz`/`rzz` cost layer → `rxx`+`ryy` ring mixer, repeated p times;
- the angles are optimised with **COBYLA** on `Statevector`, warm-started layer by layer;
- the circuit is transpiled and sampled **8,192 shots on `AerSimulator`**;
- every K is compared with brute force.

```bash
pip install qiskit qiskit-aer scipy numpy          # or command\install_qiskit.bat
python command/quantum/qiskit_planner.py --draw    # playbook demo map: prints per-K results + the circuit
```

In the dashboard, **Run in Qiskit Aer** sends the operator's own map inputs to this script and shows its log and answer.

Measured on the playbook map (8 sites, 13 groups, 64 people, 320 m, p = 2):

| K | Best sampled plan | People | Brute force | P(optimum) QAOA | Random valid plan |
|---|---|---|---|---|---|
| 1 | [4] | 19 | 19 ✓ | 48.5% | 12.5% |
| 2 | [3, 5] | 35 | 35 ✓ | 36.2% | 10.7% |
| 3 | [2, 3, 7] | 50 | 50 ✓ | 15.7% | 3.6% |
| 4 | [0, 2, 4, 7] | 59 | 59 ✓ | 12.4% | 1.4% |

**4 relays are needed for ≥90% coverage** (59/64 people). 100% of shots placed exactly K relays.

## Run the dashboard

**Requirements:** Python 3.8+ (Windows, macOS or Linux). `pyserial` is needed only when an ESP32 is connected; `start.bat` installs it.

| Setup | Do this | Survivor phone opens |
|---|---|---|
| Rescuer node + gateway (LoRa) | `firmware\flash.bat rescuer` on board 1 (power bank), `firmware\flash.bat gateway` on board 2 (laptop USB), then `command\start.bat` | Join Wi-Fi **SOS Node1** → `192.168.4.1` |
| Rescuer node only (USB link) | `firmware\flash.bat rescuer_usb_only`, keep it on laptop USB, then `command\start.bat` | Join Wi-Fi **SOS Node1** → `192.168.4.1` |
| No hardware | `command\start_without_esp32.bat` | `http://<laptop-IP>:8800/` on the same network |

The dashboard runs at `http://localhost:8800/command`. Click **Start console** to enable the alarm and voice alerts.

## RA-02 wiring (both boards)

**3V3 only, never 5 V.** Connect SCK→18, MISO→19, MOSI→23, NSS→5, RST→4, plus GND. **Fit the antenna before powering on.**

Rescuer node, optional: orange LED on GPIO21, green LED on GPIO22, push button on GPIO13 to GND.

## Privacy

- **No identity collected:** no names, phone numbers or app.
- **Phone counting:** the rescuer node hashes Wi-Fi addresses in memory for 20 s, only to count distinct phones. They are never stored or transmitted. Phones randomise these addresses, so counts are approximate.
- **Data stays local:** everything is on the command laptop (`voidnav.db`).

## Also in this repository

- **Self-healing relays** (`sim/selfheal.py`): HELLO beacons, a gradient toward the gateway, closer-only forwarding, retry to the next-best neighbour, and store-and-carry. **119/119 SOS delivered** with relays destroyed, against 29/119 on a fixed route.
- **Outage evaluation** (`sim/voidnav.py`): 66 nodes with 0–50% destroyed plus a regional blackout, run with 5 seeds.
- **Quantum relay planning** (`quantum/qaoa_relays.py`): XY-mixer QAOA places K relays to cover the most survivors, checked against brute force. It samples the optimum 21% of the time, about 6× a random valid plan. **No speed-up is claimed** at this size.
- **Earlier single-board build** (`firmware/voidnav_esp32/`, `docs/wiring.html`): one ESP32 with two radios.
