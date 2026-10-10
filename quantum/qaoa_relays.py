"""VOID-NAV quantum relay planner (QAOA, Qiskit).

Problem: N candidate relay sites, M survivor clusters (weight = estimated people).
Choose exactly K sites that cover the most people within radio range.

  x_i = 1  -> put a relay at site i
  minimise  H(x) = - sum_i C_i x_i  +  sum_{i<j} O_ij x_i x_j  +  P (sum_i x_i - K)^2
      C_i  = people within range of site i
      O_ij = people within range of both i and j   (stops double counting)
  x_i = (1 - Z_i)/2  ->  Ising Hamiltonian  ->  QAOA circuit (RZ, RZZ cost layer + RX mixer)

The circuit is built gate by gate from the Hamiltonian so it runs on any Qiskit >= 1.0.
Angles are tuned with COBYLA on the exact statevector, then the circuit is sampled
on AerSimulator like real hardware. Every answer is checked against brute force.

Usage:
  python qaoa_relays.py                 # built-in demo map (8 sites, K=3)
  python qaoa_relays.py --input map.json --k 2 --reps 3
  python qaoa_relays.py --plot          # also saves qaoa_result.png
"""
import argparse, itertools, json, math, time
import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator

DEMO = {
    "radius_m": 320,
    # candidate relay sites: rooftops, poles, water tanks (x, y in metres)
    "sites": [[150, 820], [480, 900], [830, 760], [260, 470], [560, 520], [880, 380], [180, 130], [640, 150]],
    # survivor clusters from SOS density / census (x, y, people)
    "clusters": [[90, 900, 6], [300, 760, 3], [520, 820, 9], [760, 880, 4], [940, 650, 5], [200, 560, 7],
                 [430, 430, 2], [690, 470, 8], [930, 260, 3], [120, 260, 5], [330, 90, 4], [600, 60, 6],
                 [780, 120, 2]],
}


def coverage(data):
    r2 = data["radius_m"] ** 2
    return [{j for j, (cx, cy, w) in enumerate(data["clusters"]) if (sx - cx) ** 2 + (sy - cy) ** 2 <= r2}
            for sx, sy in data["sites"]]


def people(data, cov, chosen):
    covered = set().union(*[cov[i] for i in chosen]) if chosen else set()
    return sum(data["clusters"][j][2] for j in covered)


def build_qubo(data, cov, k):
    n, w = len(cov), [c[2] for c in data["clusters"]]
    lin = np.array([-sum(w[j] for j in cov[i]) for i in range(n)], float)
    quad = np.zeros((n, n))
    for i, j in itertools.combinations(range(n), 2):
        quad[i, j] = sum(w[j2] for j2 in cov[i] & cov[j])
    P = sum(w) + 1.0                                   # bigger than any coverage gain
    lin += P * (1 - 2 * k)
    quad[np.triu_indices(n, 1)] += 2 * P
    return lin, quad, P * k * k


def qubo_to_ising(lin, quad):
    n = len(lin)
    h, J, c = np.zeros(n), {}, 0.0
    for i in range(n):
        h[i] -= lin[i] / 2; c += lin[i] / 2
    for i, j in itertools.combinations(range(n), 2):
        b = quad[i, j]
        if b:
            h[i] -= b / 4; h[j] -= b / 4; J[(i, j)] = b / 4; c += b / 4
    return h, J, c


def qaoa_circuit(h, J, gammas, betas, measure=False):
    n = len(h)
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for g, b in zip(gammas, betas):
        for i in range(n):
            if h[i]: qc.rz(2 * g * h[i], i)
        for (i, j), v in J.items():
            qc.rzz(2 * g * v, i, j)
        qc.rx(2 * b, range(n))
    if measure: qc.measure_all()
    return qc


def dicke_state(n, k):
    """Equal superposition of every placement with exactly k relays."""
    v = np.zeros(2 ** n)
    for s in itertools.combinations(range(n), k):
        v[sum(1 << i for i in s)] = 1
    return v / np.linalg.norm(v)


def qaoa_xy_circuit(h, J, gammas, betas, k, measure=False):
    """Constraint-preserving QAOA: starts in the Dicke state and mixes with XY (ring) gates,
    so every measured bitstring places exactly k relays and no penalty term is needed."""
    n = len(h)
    qc = QuantumCircuit(n)
    qc.initialize(dicke_state(n, k), range(n))
    ring = [(i, (i + 1) % n) for i in range(0, n, 2)] + [(i, (i + 1) % n) for i in range(1, n, 2)]
    for g, b in zip(gammas, betas):
        for i in range(n):
            if h[i]: qc.rz(2 * g * h[i], i)
        for (i, j), v in J.items():
            if v: qc.rzz(2 * g * v, i, j)
        for i, j in ring:
            qc.rxx(b, i, j); qc.ryy(b, i, j)
    if measure: qc.measure_all()
    return qc


def energies(lin, quad, n):
    """QUBO energy for every bitstring, indexed like Qiskit (bit i = qubit i)."""
    idx = np.arange(2 ** n)
    X = ((idx[:, None] >> np.arange(n)) & 1).astype(float)
    return X @ lin + np.einsum("bi,ij,bj->b", X, quad, X), X


def run(data, k, reps, restarts, shots, seed, mixer="xy"):
    rng = np.random.default_rng(seed)
    cov = coverage(data); n = len(cov)
    lin, quad, const = build_qubo(data, cov, k)
    if mixer == "xy":                                  # constraint lives in the circuit, drop the penalty
        P = sum(c[2] for c in data["clusters"]) + 1.0
        lin = lin - P * (1 - 2 * k); quad = quad.copy(); quad[np.triu_indices(n, 1)] -= 2 * P
    h, J, _ = qubo_to_ising(lin, quad)
    scale = max(np.abs(h).max(), max(abs(v) for v in J.values()))
    hs, Js = h / scale, {key: v / scale for key, v in J.items()}
    E, X = energies(lin, quad, n)

    # exact answer by brute force over all C(n,k) placements
    t0 = time.perf_counter()
    best = max(itertools.combinations(range(n), k), key=lambda s: people(data, cov, s))
    t_brute = time.perf_counter() - t0
    best_people = people(data, cov, best)
    opt_mask = np.array([X[b].sum() == k and people(data, cov, tuple(np.flatnonzero(X[b]))) == best_people
                         for b in range(2 ** n)])

    circ = (lambda g, b, m=False: qaoa_xy_circuit(hs, Js, g, b, k, m)) if mixer == "xy" else \
           (lambda g, b, m=False: qaoa_circuit(hs, Js, g, b, m))

    def expval_p(theta, p):
        sv = Statevector(circ(theta[:p], theta[p:]))
        return float(np.dot(sv.probabilities(), E))

    # Layer-by-layer warm start: solve p=1, interpolate its angles into p=2, and so on.
    t0 = time.perf_counter(); prev = None
    for p in range(1, reps + 1):
        def f(theta, p=p):
            return expval_p(theta, p)
        starts = [np.concatenate([rng.uniform(0, math.pi, p), rng.uniform(0, math.pi / 2, p)]) for _ in range(restarts)]
        if prev is not None:
            interp = lambda a: np.interp(np.linspace(0, 1, p), np.linspace(0, 1, p - 1), a)
            starts.insert(0, np.concatenate([interp(prev[:p - 1]), interp(prev[p - 1:])]))
        best_r = min((minimize(f, x0, method="COBYLA", options={"maxiter": 500}) for x0 in starts), key=lambda r: r.fun)
        prev = best_r.x
    res = best_r
    t_opt = time.perf_counter() - t0
    g, b = res.x[:reps], res.x[reps:]
    probs = Statevector(circ(g, b)).probabilities()

    # sample like hardware
    sim = AerSimulator(seed_simulator=seed)
    qc = transpile(circ(g, b, True), sim)
    counts = sim.run(qc, shots=shots).result().get_counts()
    valid = {s: c for s, c in counts.items() if s.count("1") == k}
    top = max(valid, key=valid.get)                    # most frequent valid placement
    chosen = tuple(i for i, ch in enumerate(reversed(top)) if ch == "1")
    best_sampled = max(valid, key=lambda s: people(data, cov, tuple(i for i, ch in enumerate(reversed(s)) if ch == "1")))
    chosen_best = tuple(i for i, ch in enumerate(reversed(best_sampled)) if ch == "1")
    n_valid = math.comb(n, k)
    ppl = np.array([people(data, cov, tuple(np.flatnonzero(X[bi]))) if X[bi].sum() == k else 0 for bi in range(2 ** n)])
    exp_ratio = float(np.dot(probs, ppl) / best_people)
    rand_ratio = float(np.mean([people(data, cov, s) for s in itertools.combinations(range(n), k)]) / best_people)
    return {
        "mixer": mixer, "n_sites": n, "k": k, "reps": reps, "qubits": n, "total_people": sum(c[2] for c in data["clusters"]),
        "brute_force": {"sites": list(best), "people": best_people, "seconds": t_brute, "placements": n_valid},
        "qaoa": {"most_frequent": list(chosen), "people_most_frequent": people(data, cov, chosen),
                 "best_sampled": list(chosen_best), "people_best_sampled": people(data, cov, chosen_best),
                 "approx_ratio": people(data, cov, chosen) / best_people,
                 "expected_ratio": exp_ratio, "random_expected_ratio": rand_ratio,
                 "p_optimum": float(probs[opt_mask].sum()),
                 "p_valid": float(sum(p for bidx, p in enumerate(probs) if X[bidx].sum() == k)),
                 "p_optimum_random_guess": float(opt_mask.sum() / 2 ** n),
                 "p_optimum_random_valid": float(opt_mask.sum() / n_valid),
                 "gammas": g.tolist(), "betas": b.tolist(), "optimise_seconds": t_opt,
                 "circuit_depth": qc.depth(), "two_qubit_gates": (len(J) + (n if mixer == "xy" else 0) * 2) * reps, "shots": shots},
        "coverage": [sorted(c) for c in cov],
    }


def plot(data, out, path="qaoa_result.png"):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 6))
    chosen = set(out["qaoa"]["most_frequent"])
    for i, (x, y) in enumerate(data["sites"]):
        if i in chosen:
            ax.add_patch(plt.Circle((x, y), data["radius_m"], color="#2ec4b6", alpha=0.15))
        ax.scatter(x, y, marker="s", s=120, c="#2ec4b6" if i in chosen else "white", edgecolors="#0b1320", zorder=3)
        ax.annotate(str(i), (x + 18, y + 18), fontsize=10)
    for x, y, w in data["clusters"]:
        ax.scatter(x, y, s=w * 25, c="#ff6b35", alpha=0.85, zorder=2)
    ax.set_xlim(0, 1000); ax.set_ylim(0, 1000); ax.set_aspect("equal")
    ax.set_title(f"QAOA relay plan: sites {sorted(chosen)} cover {out['qaoa']['people_most_frequent']}"
                 f"/{out['total_people']} people")
    fig.tight_layout(); fig.savefig(path, dpi=160)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input"); ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--reps", type=int, default=2); ap.add_argument("--restarts", type=int, default=8)
    ap.add_argument("--shots", type=int, default=8192); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--plot", action="store_true")
    ap.add_argument("--mixer", choices=["xy", "penalty"], default="xy"); ap.add_argument("--out", default="qaoa_result.json")
    a = ap.parse_args()
    data = json.load(open(a.input)) if a.input else DEMO
    out = run(data, a.k, a.reps, a.restarts, a.shots, a.seed, a.mixer)
    json.dump(out, open(a.out, "w"), indent=1)
    q, bf = out["qaoa"], out["brute_force"]
    print(f"[{out['mixer']} mixer] {out['n_sites']} sites, place K={out['k']}  ->  {bf['placements']} valid placements, {out['qubits']} qubits, p={out['reps']}")
    print(f"Brute force : sites {bf['sites']} cover {bf['people']}/{out['total_people']} people ({bf['seconds']*1000:.2f} ms)")
    print(f"QAOA        : sites {q['most_frequent']} cover {q['people_most_frequent']} people  (approx ratio {q['approx_ratio']:.2f})")
    print(f"Expected coverage: QAOA {q['expected_ratio']*100:.1f}% of optimum  vs random placement {q['random_expected_ratio']*100:.1f}%")
    print(f"P(optimum)  : QAOA {q['p_optimum']*100:.1f}%  vs random bitstring {q['p_optimum_random_guess']*100:.2f}%"
          f"  vs random valid placement {q['p_optimum_random_valid']*100:.1f}%")
    print(f"P(valid K)  : {q['p_valid']*100:.1f}%   circuit depth {q['circuit_depth']}, {q['two_qubit_gates']} two-qubit gates")
    if a.plot: plot(data, out); print("saved qaoa_result.png")
