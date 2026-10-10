"""VOID-NAV self-healing relay simulation (same rules the firmware will run).

Rules per node:
  1. HELLO beacon every 30 s +/- 5 s jitter: "I am N hops from the gateway".
  2. Neighbour table; a neighbour missing 3 beacons (90 s) is dropped.
  3. My hops = 1 + best live neighbour (gradient toward gateway).
  4. Closer-only forwarding: hand an SOS to a neighbour with fewer hops; wait for a hop ACK.
  5. No ACK in 2 s -> retry, then try the next-best neighbour.
  6. No route at all -> store the SOS (priority first) until a route reappears.
Scenario: survivor beacon node S, gateway G, 8 relays. Relays on the active path are destroyed at
t = 600 s and t = 1200 s; one comes back at t = 1700 s. Compared against a fixed route with no healing.
"""
import json, math, random, sys

RANGE = 260.0
NODES = {"S": (60, 300), "G": (940, 300),
         "R1": (250, 380), "R2": (250, 200), "R3": (450, 420), "R4": (450, 180),
         "R5": (650, 400), "R6": (650, 200), "R7": (450, 300), "R8": (800, 300)}
EVENTS = {600: ("kill", None), 1200: ("kill", None), 1700: ("revive", None)}
T_END, SOS_EVERY, BEACON, EXPIRE, HOP_TIME, ACK_TIMEOUT = 2400, 20, 30, 90, 0.3, 2.0


def link(a, b):
    (x1, y1), (x2, y2) = NODES[a], NODES[b]
    return math.hypot(x1 - x2, y1 - y2) <= RANGE


def run(heal=True, seed=3):
    rng = random.Random(seed)
    alive = {n: True for n in NODES}
    hops = {n: (0 if n == "G" else 99) for n in NODES}
    heard = {n: {} for n in NODES}                   # neighbour -> (last_seen, their hops)
    nxt_beacon = {n: rng.uniform(0, BEACON) for n in NODES}
    queue, delivered, log, killed = [], [], [], []
    static_path = None
    msg_id, t, path_now = 0, 0.0, []
    while t < T_END:
        # events: destroy the relay that currently carries traffic
        for et, (kind, _) in EVENTS.items():
            if abs(t - et) < 0.05:
                if kind == "kill":
                    victim = next((n for n in path_now if n not in ("S", "G") and alive[n]), None)
                    if victim: alive[victim] = False; killed.append((t, victim)); log.append((t, f"{victim} destroyed"))
                elif killed:
                    n = killed[0][1]; alive[n] = True; log.append((t, f"{n} back online"))
        # beacons
        for n in NODES:
            if alive[n] and t >= nxt_beacon[n]:
                nxt_beacon[n] = t + BEACON + rng.uniform(-5, 5)
                for m in NODES:
                    if m != n and alive[m] and link(n, m):
                        heard[m][n] = (t, hops[n])
        # recompute gradient
        for n in NODES:
            if n == "G" or not alive[n]: continue
            live = {m: h for m, (ts, h) in heard[n].items() if t - ts <= EXPIRE}
            heard[n] = {m: heard[n][m] for m in live}
            hops[n] = 1 + min(live.values()) if live else 99
        # new SOS from the survivor node
        if t % SOS_EVERY < 0.05 and t > 5:
            queue.append({"id": msg_id, "born": t, "at": "S", "path": ["S"], "wait_until": t}); msg_id += 1
        # forward
        for m in list(queue):
            if t < m["wait_until"]: continue
            here = m["at"]
            if not alive[here]: queue.remove(m); continue          # lost with its carrier
            if heal:
                prev = m["path"][-2] if len(m["path"]) > 1 else None   # never bounce back
                cands = sorted((h, n) for n, (ts, h) in heard[here].items() if h < hops[here] and n != prev)
                cands = [n for h, n in cands]
            else:
                if static_path is None and hops["S"] < 99:
                    static_path = [n for n in route_from(heard, hops, "S")]
                cands = [static_path[static_path.index(here) + 1]] if static_path and here in static_path[:-1] else []
            sent = False
            for n in cands:
                if alive[n] and link(here, n):           # hop ACK received
                    m["at"] = n; m["path"].append(n); m["wait_until"] = t + HOP_TIME; sent = True
                    break
                m["wait_until"] = t + ACK_TIMEOUT        # timed out, try next time / next neighbour
            if m["at"] == "G":
                delivered.append({"id": m["id"], "latency": t - m["born"], "path": m["path"], "t": t})
                path_now = m["path"]; queue.remove(m)
            elif not sent:
                m["wait_until"] = t + ACK_TIMEOUT
        t = round(t + 0.1, 1)
    sent_n = msg_id
    reroute = []
    for kt, v in killed:
        nxt = next((d for d in delivered if d["t"] > kt and v not in d["path"]), None)
        if nxt: reroute.append({"killed": v, "at": kt, "first_new_route_delivery_s": round(nxt["t"] - kt, 1),
                                "new_path": nxt["path"]})
    return {"heal": heal, "sent": sent_n, "delivered": len(delivered), "pdr": len(delivered) / sent_n,
            "lost": sent_n - len(delivered) - len(queue), "still_queued": len(queue),
            "median_latency_s": sorted(d["latency"] for d in delivered)[len(delivered) // 2] if delivered else None,
            "max_latency_s": max((d["latency"] for d in delivered), default=None),
            "reroutes": reroute, "events": log,
            "timeline": [(round(d["t"]), round(d["latency"], 1), len(d["path"]) - 1) for d in delivered]}


def route_from(heard, hops, start):
    path, here = [start], start
    while here != "G" and len(path) < 12:
        nb = min(heard[here].items(), key=lambda kv: kv[1][1])[0]
        path.append(nb); here = nb
    return path


if __name__ == "__main__":
    out = {"healing": run(True), "static": run(False), "nodes": NODES, "range": RANGE}
    for k in ("healing", "static"):
        r = out[k]
        print(k, {x: r[x] for x in ("sent", "delivered", "pdr", "lost", "still_queued", "median_latency_s", "max_latency_s")})
        for rr in r["reroutes"]: print("   ", rr)
        print("   ", r["events"])
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "selfheal_results.json", "w"), indent=1)
