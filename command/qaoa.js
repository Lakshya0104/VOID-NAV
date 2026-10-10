// XY-mixer QAOA relay planner: exact statevector port of quantum/qaoa_relays.py (qaoa_xy_circuit).
// Same QUBO, same Ising scaling, same gate order (Dicke start, RZ, RZZ, ring RXX+RYY),
// so the team's Qiskit-optimised angles reproduce Qiskit's probabilities in the browser.
export const DEMO = {
  radius_m: 320,
  sites: [[150, 820], [480, 900], [830, 760], [260, 470], [560, 520], [880, 380], [180, 130], [640, 150]],
  clusters: [[90, 900, 6], [300, 760, 3], [520, 820, 9], [760, 880, 4], [940, 650, 5], [200, 560, 7],
    [430, 430, 2], [690, 470, 8], [930, 260, 3], [120, 260, 5], [330, 90, 4], [600, 60, 6], [780, 120, 2]],
};

export function setup(data = DEMO, k = 3) {
  const r2 = data.radius_m ** 2, n = data.sites.length, w = data.clusters.map(c => c[2]);
  const cov = data.sites.map(([sx, sy]) => new Set(data.clusters.map((c, j) => ((sx - c[0]) ** 2 + (sy - c[1]) ** 2 <= r2 ? j : -1)).filter(j => j >= 0)));
  const people = chosen => { const s = new Set(); chosen.forEach(i => cov[i].forEach(j => s.add(j))); let t = 0; s.forEach(j => t += w[j]); return t; };
  // QUBO without penalty (constraint lives in the XY circuit)
  const lin = cov.map(c => -[...c].reduce((a, j) => a + w[j], 0));
  const quad = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) quad[i][j] = [...cov[i]].filter(x => cov[j].has(x)).reduce((a, x) => a + w[x], 0);
  // qubo -> ising
  const h = Array(n).fill(0), J = [];
  for (let i = 0; i < n; i++) h[i] -= lin[i] / 2;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const b = quad[i][j]; if (b) { h[i] -= b / 4; h[j] -= b / 4; J.push([i, j, b / 4]); } }
  const scale = Math.max(...h.map(Math.abs), ...J.map(x => Math.abs(x[2])));
  const hs = h.map(x => x / scale), Js = J.map(([i, j, v]) => [i, j, v / scale]);
  const N = 1 << n, bitsOf = b => [...Array(n)].map((_, i) => (b >> i) & 1);
  const pop = b => bitsOf(b).reduce((a, x) => a + x, 0);
  const chosenOf = b => bitsOf(b).map((x, i) => (x ? i : -1)).filter(i => i >= 0);
  // brute force
  const t0 = performance.now(); let best = null, bestP = -1, combos = 0;
  for (let b = 0; b < N; b++) if (pop(b) === k) { combos++; const p = people(chosenOf(b)); if (p > bestP) { bestP = p; best = chosenOf(b); } }
  const tBrute = performance.now() - t0;
  const pplOf = new Float64Array(N); for (let b = 0; b < N; b++) pplOf[b] = pop(b) === k ? people(chosenOf(b)) : 0;
  return { data, n, k, N, cov, people, hs, Js, best, bestP, combos, tBrute, pplOf, chosenOf, pop, total: w.reduce((a, b) => a + b, 0) };
}

export function run(P, gammas, betas, onLayer) {
  const { n, k, N, hs, Js, pop } = P;
  const re = new Float64Array(N), im = new Float64Array(N);
  let cnt = 0; for (let b = 0; b < N; b++) if (pop(b) === k) cnt++;
  for (let b = 0; b < N; b++) if (pop(b) === k) re[b] = 1 / Math.sqrt(cnt);
  const phase = (b, th) => { const c = Math.cos(th), s = Math.sin(th), r = re[b], m = im[b]; re[b] = r * c - m * s; im[b] = r * s + m * c; };
  const ring = []; for (let i = 0; i < n; i += 2) ring.push([i, (i + 1) % n]); for (let i = 1; i < n; i += 2) ring.push([i, (i + 1) % n]);
  for (let l = 0; l < gammas.length; l++) { const g = gammas[l], be = betas[l];
    for (let i = 0; i < n; i++) if (hs[i]) { const th = 2 * g * hs[i]; for (let b = 0; b < N; b++) phase(b, ((b >> i) & 1) ? th / 2 : -th / 2); }
    for (const [i, j, v] of Js) if (v) { const th = 2 * g * v; for (let b = 0; b < N; b++) phase(b, (((b >> i) & 1) === ((b >> j) & 1)) ? -th / 2 : th / 2); }
    for (const [i, j] of ring) { const m = (1 << i) | (1 << j), c = Math.cos(be / 2), s = Math.sin(be / 2);
      for (const kind of ['xx', 'yy']) { const r0 = re.slice(), i0 = im.slice();
        for (let b = 0; b < N; b++) { const f = b ^ m; let sg = 1; if (kind === 'yy') sg = (((b >> i) & 1) !== ((b >> j) & 1)) ? 1 : -1;
          // new = cos*a - i*sin*sg*a_flip
          re[b] = c * r0[b] + s * sg * i0[f]; im[b] = c * i0[b] - s * sg * r0[f]; } } }
    if (onLayer) onLayer(l); }
  const prob = new Float64Array(N); for (let b = 0; b < N; b++) prob[b] = re[b] * re[b] + im[b] * im[b];
  return prob;
}

export function stats(P, prob, shots = 8192, seed = 7) {
  const { N, k, pop, pplOf, bestP, combos } = P;
  let pOpt = 0, pValid = 0, exp = 0, nOpt = 0;
  for (let b = 0; b < N; b++) { if (pop(b) === k) pValid += prob[b]; if (pop(b) === k && pplOf[b] === bestP) { pOpt += prob[b]; nOpt++; } exp += prob[b] * pplOf[b]; }
  // sample shots like hardware (seeded)
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cdf = new Float64Array(N); let acc = 0; for (let b = 0; b < N; b++) { acc += prob[b]; cdf[b] = acc; }
  const counts = new Map(); for (let s = 0; s < shots; s++) { const r = rnd() * acc; let lo = 0, hi = N - 1; while (lo < hi) { const mid = (lo + hi) >> 1; cdf[mid] < r ? lo = mid + 1 : hi = mid; } counts.set(lo, (counts.get(lo) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  let randExp = 0; for (let b = 0; b < N; b++) if (pop(b) === k) randExp += pplOf[b]; randExp /= combos;
  return { pOpt, pValid, expRatio: exp / bestP, randRatio: randExp / bestP, pRandValid: nOpt / combos, pRandGuess: nOpt / N, top, mostFrequent: P.chosenOf(top[0][0]), shots };
}

// ---------------------------------------------------------------- live optimisation (no stored angles)
// Classical outer loop of QAOA: Nelder-Mead over (gammas, betas) minimising the negative expected
// coverage of the measured state. p=1 grid warm start, then p=2 initialised by interpolation.
function nelderMead(f, x0, step = 0.3, iters = 160) {
  const n = x0.length; let S = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; S.push(x); }
  let F = S.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = idx.map(i => S[i]); F = idx.map(i => F[i]);
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const pt = (a) => c.map((v, j) => v + a * (S[n][j] - v));
    const r = pt(-1), fr = f(r);
    if (fr < F[0]) { const e = pt(-2), fe = f(e); if (fe < fr) { S[n] = e; F[n] = fe; } else { S[n] = r; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = r; F[n] = fr; }
    else { const k = pt(.5), fk = f(k); if (fk < F[n]) { S[n] = k; F[n] = fk; } else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + .5 * (v - S[0][j])); F[i] = f(S[i]); } } }
    if (Math.abs(F[n] - F[0]) < 1e-7) break;
  }
  const b = F.indexOf(Math.min(...F)); return { x: S[b], f: F[b] };
}
export function optimise(P, p = 3, onIter, restarts = 4) {
  const { N, pplOf, bestP } = P; let evals = 0, bestSeen = 0;
  const expc = (g, b) => { const pr = run(P, g, b); let e = 0; for (let i = 0; i < N; i++) e += pr[i] * pplOf[i]; evals++; const r = e / Math.max(1, bestP); if (r > bestSeen) bestSeen = r; if (onIter) onIter(evals, r, bestSeen); return r; };
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let prev = null, res = null;
  for (let layer = 1; layer <= p; layer++) {
    const starts = [];
    if (prev) { const ip = a => Array.from({ length: layer }, (_, i) => { const x = i * (a.length - 1) / Math.max(1, layer - 1), lo = Math.floor(x), hi = Math.min(a.length - 1, lo + 1); return a[lo] + (a[hi] - a[lo]) * (x - lo); }); starts.push([...ip(prev.slice(0, layer - 1)), ...ip(prev.slice(layer - 1))]); }
    for (let r = 0; r < (layer === 1 ? restarts * 2 : restarts); r++) starts.push([...Array(layer)].map(() => rnd() * Math.PI).concat([...Array(layer)].map(() => rnd() * Math.PI / 2)));
    let best = null;
    for (const s of starts) { const o = nelderMead(th => -expc(th.slice(0, layer), th.slice(layer)), s, .25, 90 + 50 * layer); if (!best || o.f < best.f) best = o; }
    prev = best.x; res = best;
  }
  return { gammas: prev.slice(0, p), betas: prev.slice(p), evals, expRatio: -res.f };
}
