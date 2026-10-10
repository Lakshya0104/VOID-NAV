"""VOID-NAV SemCode: semantic encoding of an SOS into a 5-byte token, plus LoRa airtime maths.

Semantic communication here means sending the MEANING (structured triage fields) instead of
the words. A shared codebook on both ends turns 40 bits back into a full report. There is no
neural network on the ESP32; the 'intelligence' is the schema plus a keyword triage rule that
reads free text and sets priority. The survivor's own words can still ride along, optionally.
"""
import math, json, sys

CATS = ["TRAPPED", "MEDICAL", "FIRE", "FLOOD", "COLLAPSE", "FOOD_WATER", "SHELTER", "SAFE", "OTHER"]
TRI = ["NO", "YES", "UNSURE"]
PEOPLE = ["1", "2", "3-5", "6-10", "11-20", "20+"]
POS = ["UNKNOWN", "GROUND", "UPPER_FLOOR", "BASEMENT", "ROOF", "OUTSIDE", "VEHICLE"]
VULN = ["CHILD", "ELDERLY", "PREGNANT", "DISABLED"]
NEEDS = ["MEDICAL", "WATER", "FOOD", "EVACUATION", "SHELTER", "RESCUE_TOOLS", "MEDICINE", "LIGHT"]
KEYWORDS = {  # keyword triage: English + Hindi/Telugu transliterations -> (field, value, urgency boost)
    "bleed": ("bleeding", 1, 4), "blood": ("bleeding", 1, 4), "khoon": ("bleeding", 1, 4), "raktham": ("bleeding", 1, 4),
    "trapped": ("needs", "RESCUE_TOOLS", 3), "stuck": ("needs", "RESCUE_TOOLS", 3), "phas": ("needs", "RESCUE_TOOLS", 3),
    "unconscious": ("injured", 1, 5), "behosh": ("injured", 1, 5), "breath": ("injured", 1, 5),
    "child": ("vuln", "CHILD", 2), "baby": ("vuln", "CHILD", 2), "bachcha": ("vuln", "CHILD", 2),
    "pregnant": ("vuln", "PREGNANT", 3), "old": ("vuln", "ELDERLY", 1),
    "water": ("needs", "WATER", 1), "paani": ("needs", "WATER", 1), "neellu": ("needs", "WATER", 1),
    "fire": ("needs", "EVACUATION", 4), "aag": ("needs", "EVACUATION", 4), "smoke": ("needs", "EVACUATION", 3),
}


def triage_text(text, f):
    t = text.lower()
    for kw, (field, val, boost) in KEYWORDS.items():
        if kw in t:
            if field == "needs": f["needs"].add(val)
            elif field == "vuln": f["vuln"].add(val)
            else: f[field] = val
            f["urgency"] = min(15, f["urgency"] + boost)
    return f


def encode(f):
    """40-bit token: cat4 | injured2 | bleeding2 | people3 | pos3 | vuln4 | needs8 | urgency4 | minutes10"""
    v = CATS.index(f["cat"])
    v = v << 2 | f["injured"]; v = v << 2 | f["bleeding"]
    v = v << 3 | PEOPLE.index(f["people"]); v = v << 3 | POS.index(f["pos"])
    v = v << 4 | sum(1 << VULN.index(x) for x in f["vuln"])
    v = v << 8 | sum(1 << NEEDS.index(x) for x in f["needs"])
    v = v << 4 | f["urgency"]; v = v << 10 | min(1023, f["minutes"])
    return v.to_bytes(5, "big")


def decode(b):
    v = int.from_bytes(b, "big")
    minutes = v & 1023; v >>= 10; urg = v & 15; v >>= 4
    needs = [n for i, n in enumerate(NEEDS) if v >> i & 1]; v >>= 8
    vuln = [n for i, n in enumerate(VULN) if v >> i & 1]; v >>= 4
    pos = POS[v & 7]; v >>= 3; ppl = PEOPLE[v & 7]; v >>= 3
    bleed = v & 3; v >>= 2; inj = v & 3; v >>= 2
    return {"cat": CATS[v], "injured": TRI[inj], "bleeding": TRI[bleed], "people": ppl, "pos": pos,
            "vuln": vuln, "needs": needs, "urgency": urg, "minutes_since_event": minutes}


def report(d):
    """Receiver-side reconstruction: the codebook expands 5 bytes into a readable triage card."""
    pr = "CRITICAL" if d["urgency"] >= 10 else "URGENT" if d["urgency"] >= 5 else "STABLE"
    s = f"[{pr} {d['urgency']}/15] {d['cat'].replace('_', ' ').title()}: {d['people']} people, location {d['pos'].replace('_', ' ').lower()}."
    if d["injured"] == "YES": s += " Injured person present."
    if d["bleeding"] == "YES": s += " Active bleeding."
    if d["vuln"]: s += " Vulnerable: " + ", ".join(x.lower() for x in d["vuln"]) + "."
    if d["needs"]: s += " Needs: " + ", ".join(x.replace("_", " ").lower() for x in d["needs"]) + "."
    return s + f" Reported {d['minutes_since_event']} min after event."


def airtime_ms(pl, sf=9, bw=125e3, cr=1, preamble=8, crc=1, ih=0):
    """Semtech SX127x time-on-air (AN1200.13)."""
    tsym = (2 ** sf) / bw * 1000
    de = 1 if tsym > 16 else 0
    n = 8 + max(math.ceil((8 * pl - 4 * sf + 28 + 16 * crc - 20 * ih) / (4 * (sf - 2 * de))) * (cr + 4), 0)
    return (preamble + 4.25) * tsym + n * tsym


if __name__ == "__main__":
    f = {"cat": "TRAPPED", "injured": 1, "bleeding": 0, "people": "3-5", "pos": "BASEMENT",
         "vuln": {"ELDERLY"}, "needs": {"MEDICAL"}, "urgency": 6, "minutes": 42}
    text = "Trapped in basement with my mother and 2 kids, she is bleeding from leg, need water urgently"
    f = triage_text(text, f)
    tok = encode(f)
    d = decode(tok)
    HEADER = 4 + 2 + 1 + 3   # msg id, node id, type/priority/hops, auth tag
    forms = {
        "Free-text SMS-style message": len(text.encode()) + HEADER,
        "JSON form (typical app)": len(json.dumps({"category": "TRAPPED", "injured": "yes", "bleeding": "yes",
              "people": "3-5", "position": "basement", "vulnerable": ["elderly", "child"],
              "needs": ["medical", "water", "rescue_tools"], "urgency": 15, "minutes": 42}).encode()) + HEADER,
        "VOID-NAV v1 text packet (current firmware)": len("S|3F2A-517|0|4|TRAPPED||192.168.4.2|" + text[:60]),
        "SemCode token + header": 5 + HEADER,
    }
    print("token:", tok.hex(), "->", d)
    print("report:", report(d))
    rows = []
    for name, pl in forms.items():
        a9, a12 = airtime_ms(pl, 9), airtime_ms(pl, 12)
        # pure ALOHA peak channel use 18.4%; messages per hour one channel can carry
        cap = 0.184 * 3600e3 / a9
        rows.append({"format": name, "bytes": pl, "airtime_sf9_ms": round(a9, 1), "airtime_sf12_ms": round(a12, 1),
                     "channel_msgs_per_hour_sf9": int(cap), "duty1pct_msgs_per_hour_per_node_sf12": int(36000 / a12)})
    base = rows[0]
    for r in rows:
        r["airtime_saving_vs_text"] = round(1 - r["airtime_sf9_ms"] / base["airtime_sf9_ms"], 3)
        print(r)
    json.dump({"token_hex": tok.hex(), "decoded": d, "report": report(d), "rows": rows},
              open(sys.argv[1] if len(sys.argv) > 1 else "semcode_results.json", "w"), indent=1)
