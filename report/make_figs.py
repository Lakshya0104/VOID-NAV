import json, glob, os
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
R = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(R); F = os.path.join(R, "fig")
INK, MUTED, GRID = "#0f1a2a", "#56637a", "#e3e8ef"
C = {"direct": "#2B7BB9", "flood": "#B8860B", "spray": "#8E44AD", "voidnav": "#E8590C"}
NAME = {"direct": "Direct carry", "flood": "Epidemic flood", "spray": "Spray & Wait", "voidnav": "VOID-NAV"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.axisbelow": True,
                     "axes.titleweight": "bold", "axes.titlesize": 11, "axes.titlecolor": INK, "axes.titlelocation": "left"})

def save(fig, name): fig.tight_layout(); fig.savefig(os.path.join(F, name), format="svg"); plt.close(fig)

res = json.load(open(f"{ROOT}/results/results.json"))
sw = lambda p, f: next(r for r in res["sweep"] if r["proto"] == p and abs(r["fail"] - f) < 1e-6)
fails = [0, .1, .2, .3, .4, .5]
fig, ax = plt.subplots(figsize=(6.4, 2.7))
for p in C:
    ys = [sw(p, f)["pdr"] * 100 for f in fails]
    ax.plot([f * 100 for f in fails], ys, color=C[p], lw=2, marker="o", ms=4)
    off = {"flood": 4, "spray": 2, "voidnav": -9, "direct": -3}[p]
    ax.annotate(NAME[p], (50, ys[-1]), xytext=(6, off), textcoords="offset points", color=INK, fontsize=9)
ax.set_xlim(0, 64); ax.set_ylim(40, 101); ax.set_xlabel("Nodes destroyed (%)"); ax.set_ylabel("Messages delivered (%)")
ax.set_title("Delivery under simulated outages (66 nodes, 5 seeds)"); save(fig, "delivery.svg")

fig, axs = plt.subplots(1, 2, figsize=(6.6, 2.6))
ps = list(C)
axs[0].barh([NAME[p] for p in ps], [sw(p, .2)["sos_lat"] / 60 for p in ps], color=[C[p] for p in ps], height=0.6)
for i, p in enumerate(ps): axs[0].text(sw(p, .2)["sos_lat"] / 60 + .2, i, f"{sw(p,.2)['sos_lat']/60:.1f}", va="center", fontsize=9, color=INK)
axs[0].set_title("Median SOS latency, min"); axs[0].grid(axis="y", visible=False); axs[0].invert_yaxis()
ps2 = ["flood", "spray", "voidnav"]
axs[1].barh([NAME[p] for p in ps2], [sw(p, .2)["overhead"] for p in ps2], color=[C[p] for p in ps2], height=0.6)
for i, p in enumerate(ps2): axs[1].text(sw(p, .2)["overhead"] + 8, i, f"{sw(p,.2)['overhead']:.0f}", va="center", fontsize=9, color=INK)
axs[1].set_title("Transmissions per delivery"); axs[1].set_xlim(0, 820); axs[1].grid(axis="y", visible=False); axs[1].invert_yaxis()
save(fig, "latency_overhead.svg")

sem = json.load(open(f"{ROOT}/semantic/semcode_results.json"))["rows"]
lab = ["Free text", "JSON form", "Current text packet", "SemCode token"]
fig, axs = plt.subplots(1, 2, figsize=(6.6, 2.4))
cols = ["#2B7BB9", "#2B7BB9", "#2B7BB9", "#E8590C"]
for ax, key, t, fmt in [(axs[0], "bytes", "Bytes on air", "{:.0f}"), (axs[1], "airtime_sf9_ms", "Airtime per SOS at SF9, ms", "{:.0f}")]:
    v = [r[key] for r in sem]; ax.barh(lab, v, color=cols, height=0.6); ax.invert_yaxis(); ax.grid(axis="y", visible=False)
    for i, x in enumerate(v): ax.text(x + max(v) * .02, i, fmt.format(x), va="center", fontsize=9, color=INK)
    ax.set_title(t); ax.set_xlim(0, max(v) * 1.18)
axs[1].set_yticklabels([])
save(fig, "semantic.svg")

Q = os.path.join(ROOT, "quantum")
pts = {}
for m in ("penalty", "xy"):
    pts[m] = [json.load(open(f"{Q}/res_{m}_p{p}.json"))["qaoa"]["p_optimum"] * 100 for p in (1, 2, 3, 4)]
rand = json.load(open(f"{Q}/res_xy_p1.json"))["qaoa"]["p_optimum_random_valid"] * 100
fig, ax = plt.subplots(figsize=(4.4, 3.0))
ax.plot([1, 2, 3, 4], pts["xy"], color="#E8590C", lw=2, marker="o", ms=5); ax.annotate("XY-mixer QAOA", (4, pts["xy"][-1]), xytext=(-70, 8), textcoords="offset points", fontsize=9, color=INK)
ax.plot([1, 2, 3, 4], pts["penalty"], color="#2B7BB9", lw=2, marker="o", ms=5); ax.annotate("Penalty QAOA", (4, pts["penalty"][-1]), xytext=(-62, -14), textcoords="offset points", fontsize=9, color=INK)
ax.axhline(rand, color=MUTED, lw=1, ls="--"); ax.text(1.02, rand + 0.6, "random valid guess", fontsize=8, color=MUTED)
ax.set_xticks([1, 2, 3, 4]); ax.set_xlabel("QAOA layers (p)"); ax.set_ylabel("P(optimal placement) %"); ax.set_ylim(0, 26)
ax.set_title("How often QAOA samples the optimum"); save(fig, "qaoa_popt.svg")

import sys; sys.path.insert(0, Q); import qaoa_relays as qr
out = json.load(open(f"{Q}/qaoa_result.json")); d = qr.DEMO; ch = set(out["qaoa"]["most_frequent"])
fig, ax = plt.subplots(figsize=(3.6, 3.6))
for i, (x, y) in enumerate(d["sites"]):
    if i in ch: ax.add_patch(plt.Circle((x, y), d["radius_m"], color="#2B7BB9", alpha=0.12, lw=0))
    ax.scatter(x, y, marker="s", s=70, c="#2B7BB9" if i in ch else "white", edgecolors=INK, zorder=3, linewidths=1)
    ax.annotate(str(i), (x + 22, y + 18), fontsize=9, color=INK)
for x, y, w in d["clusters"]: ax.scatter(x, y, s=w * 18, c="#E8590C", alpha=0.85, zorder=2, edgecolors="white", linewidths=0.8)
ax.set_xlim(0, 1000); ax.set_ylim(0, 1000); ax.set_aspect("equal"); ax.grid(False); ax.set_xticks([]); ax.set_yticks([])
for s in ax.spines.values(): s.set_visible(True)
ax.set_title(f"Chosen relays {sorted(ch)}: {out['qaoa']['people_most_frequent']}/{out['total_people']} people", fontsize=10)
save(fig, "qaoa_map.svg")

sh = json.load(open(f"{ROOT}/results/selfheal_results.json"))
fig, ax = plt.subplots(figsize=(6.6, 2.5))
for key, col, nm in (("healing", "#E8590C", "Self-healing (VOID-NAV)"), ("static", "#2B7BB9", "Fixed route")):
    tl = sh[key]["timeline"]; xs = [t for t, _, _ in tl]; ax.step(xs, range(1, len(xs) + 1), where="post", color=col, lw=2)
    ax.annotate(nm, (xs[-1], len(xs)), xytext=(-150 if key == "healing" else 6, -14 if key == "healing" else 4), textcoords="offset points", fontsize=9, color=INK)
for t, txt in sh["healing"]["events"]:
    ax.axvline(t, color=MUTED, lw=1, ls=":"); ax.text(t + 15, 5, txt, rotation=90, fontsize=8, color=MUTED, va="bottom")
ax.set_xlabel("Time (s)"); ax.set_ylabel("SOS delivered (cumulative)"); ax.set_xlim(0, 2450)
ax.set_title("Kill a relay, cut the network, bring a relay back: 119 sent"); save(fig, "selfheal.svg")
print("figs:", os.listdir(F))
