"""VOID-NAV relay planner on Qiskit: how many relays are needed, and where.

Same model as quantum/qaoa_relays.py (team repo):
  one qubit per candidate site, x_i = 1 -> relay at site i
  cost  H = -sum_i C_i x_i + sum_{i<j} O_ij x_i x_j      (C_i people site i covers, O_ij overlap)
  exactly K relays enforced by the circuit: Dicke |K> start state + XY ring mixer (RXX+RYY)
For K = 1, 2, ... the angles (gamma, beta) are optimised with COBYLA on the exact Statevector,
the optimised circuit is transpiled and sampled on Qiskit Aer (8192 shots), and the best sampled
plan is compared with brute force. Stops at the smallest K meeting the coverage target.

  python quantum/qiskit_planner.py                       # demo map from the playbook (8 sites)
  python quantum/qiskit_planner.py plan.json             # your own input (exported by the dashboard)
  python quantum/qiskit_planner.py plan.json --draw      # also print the circuit

Input JSON: {"radius_m": 350, "target": 0.9, "layers": 2,
             "sites": [[x, y], ...], "clusters": [[x, y, people], ...]}   (metres)
Requires: pip install qiskit qiskit-aer scipy numpy
"""
import itertools, json, math, sys, time
import numpy as np
from scipy.optimize import minimize
import qiskit
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator

DEMO = {"radius_m": 320, "target": 0.9, "layers": 2,
        "sites": [[150, 820], [480, 900], [830, 760], [260, 470], [560, 520], [880, 380], [180, 130], [640, 150]],
        "clusters": [[90, 900, 6], [300, 760, 3], [520, 820, 9], [760, 880, 4], [940, 650, 5], [200, 560, 7],
                     [430, 430, 2], [690, 470, 8], [930, 260, 3], [120, 260, 5], [330, 90, 4], [600, 60, 6], [780, 120, 2]]}


def coverage(d):
    r2 = d["radius_m"] ** 2
    return [{j for j, (cx, cy, w) in enumerate(d["clusters"]) if (sx - cx) ** 2 + (sy - cy) ** 2 <= r2} for sx, sy in d["sites"]]


def people(d, cov, chosen):
    s = set().union(*[cov[i] for i in chosen]) if chosen else set()
    return sum(d["clusters"][j][2] for j in s)


def ising(d, cov):
    """Coverage QUBO -> Ising (h, J), scaled to max |coef| = 1. No penalty: the XY circuit keeps K fixed."""
    n, w = len(cov), [c[2] for c in d["clusters"]]
    lin = [-sum(w[j] for j in cov[i]) for i in range(n)]
    h, J = np.zeros(n), {}
    for i in range(n): h[i] -= lin[i] / 2
    for i, j in itertools.combinations(range(n), 2):
        b = sum(w[x] for x in cov[i] & cov[j])
        if b: h[i] -= b / 4; h[j] -= b / 4; J[(i, j)] = b / 4
    s = max([abs(x) for x in h] + [abs(v) for v in J.values()] + [1e-9])
    return h / s, {k: v / s for k, v in J.items()}


def dicke(n, k):
    v = np.zeros(2 ** n)
    for c in itertools.combinations(range(n), k): v[sum(1 << i for i in c)] = 1
    return v / np.linalg.norm(v)


def circuit(h, J, gammas, betas, k, measure=False):
    n = len(h); qc = QuantumCircuit(n)
    qc.initialize(dicke(n, k), range(n))
    ring = [(i, (i + 1) % n) for i in range(0, n, 2)] + [(i, (i + 1) % n) for i in range(1, n, 2)]
    for g, b in zip(gammas, betas):
        for i in range(n):
            if h[i]: qc.rz(2 * g * h[i], i)
        for (i, j), v in J.items(): qc.rzz(2 * g * v, i, j)
        for i, j in ring: qc.rxx(b, i, j); qc.ryy(b, i, j)
    if measure: qc.measure_all()
    return qc


def solve_k(d, cov, k, layers, shots=8192, seed=7):
    n = len(cov); h, J = ising(d, cov)
    idx = np.arange(2 ** n); X = (idx[:, None] >> np.arange(n)) & 1
    ppl = np.array([people(d, cov, tuple(np.flatnonzero(x))) if x.sum() == k else 0 for x in X])
    best = max(itertools.combinations(range(n), k), key=lambda s: people(d, cov, s)); bestp = people(d, cov, best)
    exp = lambda th, p: -float(np.dot(Statevector(circuit(h, J, th[:p], th[p:], k)).probabilities(), ppl)) / max(1, bestp)
    rng = np.random.default_rng(seed); prev = None; t0 = time.perf_counter(); nfev = 0
    for p in range(1, layers + 1):                         # layer-by-layer warm start
        starts = [np.concatenate([rng.uniform(0, math.pi, p), rng.uniform(0, math.pi / 2, p)]) for _ in range(3)]
        if prev is not None:
            ip = lambda a: np.interp(np.linspace(0, 1, p), np.linspace(0, 1, p - 1), a)
            starts.insert(0, np.concatenate([ip(prev[:p - 1]), ip(prev[p - 1:])]))
        res = min((minimize(exp, x0, args=(p,), method="COBYLA", options={"maxiter": 250}) for x0 in starts), key=lambda r: r.fun)
        prev = res.x; nfev += sum(1 for _ in range(1))
    g, b = prev[:layers], prev[layers:]
    probs = Statevector(circuit(h, J, g, b, k)).probabilities()
    sim = AerSimulator(seed_simulator=seed)
    qc = transpile(circuit(h, J, g, b, k, True), sim)
    counts = sim.run(qc, shots=shots).result().get_counts()
    plans = {s: c for s, c in counts.items() if s.count("1") == k}
    sel = lambda s: tuple(i for i, ch in enumerate(reversed(s)) if ch == "1")
    top = max(plans, key=plans.get); bs = max(plans, key=lambda s: people(d, cov, sel(s)))
    opt_mask = ppl == bestp
    return {"k": k, "best_sampled": list(sel(bs)), "people": people(d, cov, sel(bs)), "most_frequent": list(sel(top)),
            "brute_force": list(best), "optimum": bestp, "p_optimum": float(probs[opt_mask].sum()),
            "p_optimum_random": float(opt_mask.sum() / math.comb(n, k)), "p_valid": float(sum(plans.values()) / shots),
            "expected_ratio": float(np.dot(probs, ppl) / max(1, bestp)), "gammas": [float(x) for x in g], "betas": [float(x) for x in b],
            "depth": qc.depth(), "ops": {k2: int(v) for k2, v in qc.count_ops().items()}, "shots": shots, "seconds": round(time.perf_counter() - t0, 2),
            "top_counts": sorted(([list(sel(s)), c] for s, c in plans.items()), key=lambda x: -x[1])[:8]}


def plan(d, log=print):
    cov = coverage(d); n = len(cov); total = sum(c[2] for c in d["clusters"])
    reach = people(d, cov, tuple(range(n))); target = d.get("target", 0.9); layers = int(d.get("layers", 2))
    log(f"Qiskit {qiskit.__version__} · {n} qubits · {len(d['clusters'])} survivor groups ({total} people) · radius {d['radius_m']} m · target {target:.0%} · p={layers}")
    rows = []
    for k in range(1, n + 1):
        r = solve_k(d, cov, k, layers); rows.append(r)
        log(f"K={k}: best sampled sites {r['best_sampled']} -> {r['people']} people | brute force {r['optimum']} | "
            f"P(opt) {r['p_optimum']:.1%} vs random {r['p_optimum_random']:.1%} | P(valid) {r['p_valid']:.0%} | depth {r['depth']} | {r['seconds']} s")
        if r["people"] >= target * total or r["people"] >= reach: break
    a = rows[-1]
    log(f"==> {a['k']} relay(s) needed: sites {a['best_sampled']} cover {a['people']}/{total} people "
        f"({a['people'] / total:.0%}){'  = brute-force optimum' if a['people'] == a['optimum'] else ''}")
    return {"qiskit": qiskit.__version__, "backend": "AerSimulator (qasm, 8192 shots) + Statevector for optimisation",
            "qubits": n, "total": total, "reachable": reach, "target": target, "layers": layers, "rows": rows, "answer": a}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = json.load(open(args[0])) if args else DEMO
    out = plan(d)
    if "--draw" in sys.argv:
        cov = coverage(d); h, J = ising(d, cov); a = out["answer"]
        print(circuit(h, J, a["gammas"], a["betas"], a["k"], True).draw("text", fold=160))
    json.dump(out, open("qiskit_plan_result.json", "w"), indent=1)
    print("saved qiskit_plan_result.json")
