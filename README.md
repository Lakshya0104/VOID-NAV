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
