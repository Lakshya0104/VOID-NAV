"""VOID-NAV: off-grid, delay-tolerant multi-hop emergency messaging simulator.

Nodes (phones/LoRa beacons/responder radios) move in a disaster zone with no
cellular/Internet. Messages travel hop-by-hop via store-carry-forward.
Protocols compared:
  direct   - source carries message until it meets destination (baseline)
  flood    - epidemic flooding, no limits
  spray    - binary spray-and-wait (L copies)
  voidnav  - priority-aware PRoPHET-style forwarding + bundle custody,
             TTL by priority, bandwidth budget, and end-to-end ACK flooding
             that purges delivered copies and gives the sender status.
Pure Python, deterministic with a seed.
"""
import json, math, random, statistics, sys

AREA, RANGE, STEPS = 1000.0, 120.0, 600     # metres, metres, 1 step = 10 s
BW = 4                                        # messages per contact per step (limited bandwidth)
BUF = 60                                      # buffer per node
PRIO_TTL = {0: 600, 1: 400, 2: 250}           # 0=SOS, 1=urgent, 2=info

class Node:
    def __init__(s, i, rng, static=False):
        s.i, s.rng, s.static = i, rng, static
        s.x, s.y = rng.uniform(0, AREA), rng.uniform(0, AREA)
        s.tx, s.ty = s.x, s.y; s.speed = 0 if static else rng.uniform(0.8, 2.0) * 10
        s.buf = {}; s.alive = True; s.pred = {}; s.acks = set(); s.copies = {}
    def move(s):
        if s.static or not s.alive: return
        dx, dy = s.tx - s.x, s.ty - s.y; d = math.hypot(dx, dy)
        if d < s.speed:
            s.x, s.y = s.tx, s.ty
            s.tx, s.ty = s.rng.uniform(0, AREA), s.rng.uniform(0, AREA)
        else:
            s.x += dx / d * s.speed; s.y += dy / d * s.speed

def run(proto, n=60, fail=0.0, msgs=120, seed=1, blackout=True, relays=6):
    rng = random.Random(seed)
    nodes = [Node(i, rng) for i in range(n)] + [Node(n + k, rng, static=True) for k in range(relays)]
    N = len(nodes)
    # message schedule: (t, src, dst, prio)
    sched = sorted((rng.randint(0, STEPS // 2), rng.randrange(n), rng.randrange(n), rng.choices([0, 1, 2], [2, 3, 5])[0]) for _ in range(msgs))
    sched = [m for m in sched if m[1] != m[2]]
    created, delivered, acked, tx, ack_tx = {}, {}, {}, 0, 0
    fail_at = STEPS // 5
    for t in range(STEPS):
        if t == fail_at and fail > 0:     # simulated outage: random node / infra failure
            for nd in rng.sample(nodes, int(N * fail)): nd.alive = False; nd.buf.clear()
        blk = blackout and STEPS // 3 <= t < STEPS // 2   # regional blackout zone (left 40%)
        for mid, (ts, s, d, p) in enumerate(sched):
            if ts == t and nodes[s].alive:
                created[mid] = (t, s, d, p); nodes[s].buf[mid] = t
                nodes[s].copies[mid] = {0: 16, 1: 8, 2: 4}[p] if proto == "voidnav" else 8
        for nd in nodes: nd.move()
        live = [nd for nd in nodes if nd.alive and not (blk and nd.x < 400)]
        # aging of predictabilities
        if proto == "voidnav":
            for nd in live:
                for k in nd.pred: nd.pred[k] *= 0.995
        for a_i in range(len(live)):
            a = live[a_i]
            for b in live[a_i + 1:]:
                if (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > RANGE ** 2: continue
                if proto == "voidnav":
                    for u, v in ((a, b), (b, a)):
                        u.pred[v.i] = u.pred.get(v.i, 0) + (1 - u.pred.get(v.i, 0)) * 0.75
                        for k, pv in v.pred.items():   # transitivity
                            if k != u.i: u.pred[k] = max(u.pred.get(k, 0), u.pred.get(v.i, 0) * pv * 0.25)
                    if a.acks != b.acks:      # tiny ACK digests, counted as one transmission
                        ack = a.acks | b.acks; a.acks = set(ack); b.acks = set(ack); ack_tx += 1
                    for u in (a, b):
                        for m in list(u.buf):
                            if m in u.acks: del u.buf[m]
                for u, v in ((a, b), (b, a)):
                    budget = BW
                    items = sorted(u.buf, key=lambda m: (created[m][3], created[m][0]))
                    for m in items:
                        if budget == 0: break
                        if m in v.buf: continue
                        ts, s, d, p = created[m]
                        if t - ts > PRIO_TTL[p] and proto == "voidnav": continue
                        if v.i == d:
                            budget -= 1; tx += 1
                            if m not in delivered: delivered[m] = t
                            if proto == "voidnav": v.acks.add(m); u.acks.add(m)
                            del u.buf[m]; continue
                        if proto == "direct": continue
                        if len(v.buf) >= BUF:
                            if proto != "voidnav": continue
                            worst = max(v.buf, key=lambda k: (created[k][3], -created[k][0]))
                            if created[worst][3] <= p: continue
                            del v.buf[worst]
                        if proto == "spray":
                            c = u.copies.get(m, 1)
                            if c <= 1: continue
                            u.copies[m] = c // 2; v.copies[m] = c - c // 2
                        if proto == "voidnav":
                            # spray phase: priority-sized copy quota; wait phase: hand custody
                            # of the last copy only to a node with better delivery predictability
                            c = u.copies.get(m, 1)
                            if c > 1:
                                u.copies[m] = c // 2; v.copies[m] = c - c // 2
                            elif v.pred.get(d, 0) > u.pred.get(d, 0) + 0.05:
                                v.copies[m] = 1; del u.buf[m]
                            else:
                                continue
                        v.buf[m] = t; budget -= 1; tx += 1
        # ACK reaching source = sender sees "delivered" status
        if proto == "voidnav":
            for mid, (ts, s, d, p) in created.items():
                if mid in delivered and mid not in acked and mid in nodes[s].acks: acked[mid] = t
    lat = [(delivered[m] - created[m][0]) * 10 for m in delivered]
    sos = [m for m in created if created[m][3] == 0]
    return dict(proto=proto, fail=fail, created=len(created), delivered=len(delivered),
                pdr=len(delivered) / max(1, len(created)),
                sos_pdr=sum(m in delivered for m in sos) / max(1, len(sos)),
                lat_med=float(statistics.median(lat)) if lat else None,
                lat_p90=sorted(lat)[int(len(lat) * .9)] if lat else None,
                overhead=tx / max(1, len(delivered)),
                ack_overhead=ack_tx / max(1, len(delivered)),
                sos_lat=float(statistics.median([(delivered[m] - created[m][0]) * 10 for m in sos if m in delivered] or [0])),
                ack_lat=float(statistics.median([(acked[m] - created[m][0]) * 10 for m in acked] or [0])),
                ack_ratio=len(acked) / max(1, len(delivered)) if proto == "voidnav" else 0,
                hops_lat=lat)

def main():
    protos = ["direct", "flood", "spray", "voidnav"]
    out = {"sweep": [], "cdf": {}}
    for f in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]:
        for p in protos:
            rs = [run(p, fail=f, seed=s) for s in range(5)]
            agg = {k: statistics.mean(r[k] for r in rs if r[k] is not None) for k in ["pdr", "sos_pdr", "lat_med", "lat_p90", "overhead", "ack_overhead", "sos_lat", "ack_lat", "ack_ratio"]}
            agg.update(proto=p, fail=f); out["sweep"].append(agg)
            if f == 0.2: out["cdf"][p] = sorted(sum((r["hops_lat"] for r in rs), []))
            print(p, f, {k: round(v, 3) for k, v in agg.items() if isinstance(v, float)}, file=sys.stderr)
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "results/results.json", "w"), indent=1)

if __name__ == "__main__":
    main()
