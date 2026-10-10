// Relay planner (QAOA) + self-healing relay simulation on the Musheerabad map.
// Inputs come from the operator: candidate relay sites, survivor groups (or imported SOS / heatmap),
// radio range and coverage target. QAOA (XY mixer, Dicke start) is optimised live for K = 1, 2, ...
// and the smallest K that meets the target is reported, each answer checked against brute force.
import * as Q from './qaoa.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LL0 = [17.4158, 78.5071], KX = 111320 * Math.cos(LL0[0] * Math.PI / 180), KY = 110540;
const toM = ([lat, lon]) => [(lon - LL0[1]) * KX, (lat - LL0[0]) * KY];
const dist = (a, b) => Math.hypot((a[1] - b[1]) * KX, (a[0] - b[0]) * KY);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const P = { sites: [], groups: [], cp: [17.4236, 78.4998], mode: 'site', plan: null, map: null, L: {} };
let pmap;

async function init() {
  if (pmap) { pmap.invalidateSize(); return; }
  const { GEO } = await import('./lib/geo.js');
  pmap = L.map('pmap', { zoomSnap: .25, zoomControl: false }); L.control.zoom({ position: 'topright' }).addTo(pmap);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'darktiles', attribution: '© OpenStreetMap contributors' }).addTo(pmap);
  const zl = L.featureGroup(GEO.zone.map(w => L.polygon(w.c.map(c => [c[1], c[0]]), { color: '#43c6ff', weight: 1.5, fillColor: '#43c6ff', fillOpacity: .05, interactive: false }))).addTo(pmap);
  pmap.fitBounds(zl.getBounds(), { padding: [20, 20] });
  for (const k of ['cov', 'links', 'groups', 'sites', 'cp', 'sim']) P.L[k] = L.layerGroup().addTo(pmap);
  pmap.on('click', e => { const ll = [e.latlng.lat, e.latlng.lng];
    if (P.mode === 'site') { if (P.sites.length >= 10) return status('Maximum 10 candidate sites (10 qubits).'); P.sites.push(ll); }
    else if (P.mode === 'group') P.groups.push({ ll, n: Math.max(1, +$('#pPeople').value || 1), src: 'manual' });
    else if (P.mode === 'cp') P.cp = ll;
    P.plan = null; draw(); });
  draw();
}

function status(t) { $('#pStatus').innerHTML = t; }
function draw() { if (!pmap) return; const R = +$('#pRange').value;
  Object.values(P.L).forEach(l => l.clearLayers());
  P.groups.forEach((g, i) => L.circleMarker(g.ll, { radius: 5 + Math.sqrt(g.n) * 3, color: g.src === 'sos' ? '#ff3b5c' : '#ff9f1c', weight: 2, fillOpacity: .55, fillColor: g.src === 'sos' ? '#ff3b5c' : '#ff9f1c' })
    .bindTooltip(`${g.n} people · ${g.src === 'sos' ? 'from SOS' : g.src === 'heat' ? 'from heatmap' : 'added'}`).on('contextmenu', () => { P.groups.splice(i, 1); P.plan = null; draw(); }).addTo(P.L.groups));
  const chosen = new Set(P.plan ? P.plan.chosen : []);
  P.sites.forEach((s, i) => { const on = chosen.has(i);
    if (on) L.circle(s, { radius: R, color: '#a991ff', weight: 2, dashArray: '6 6', fillColor: '#a991ff', fillOpacity: .08, interactive: false }).addTo(P.L.cov);
    L.marker(s, { icon: L.divIcon({ className: '', html: `<div class="ps ${on ? 'on' : ''}" data-site="${i}">${i}</div>`, iconSize: [0, 0] }) })
      .on('click', () => { if (H.on && on) { const id = 'R' + i; H.alive[id] = !H.alive[id]; hlog(`${id} ${H.alive[id] ? 'restored' : 'DESTROYED'}`); } })
      .on('contextmenu', () => { if (H.on) return; P.sites.splice(i, 1); P.plan = null; draw(); }).addTo(P.L.sites); });
  L.marker(P.cp, { icon: L.divIcon({ className: '', html: '<div class="pcp"><b>⌂</b><span>Command post · gateway</span></div>', iconSize: [0, 0] }) }).addTo(P.L.cp);
  if (P.plan) P.plan.links.forEach(([a, b]) => L.polyline([a, b], { color: '#2fe08a', weight: 2, opacity: .8 }).addTo(P.L.links));
  $('#pCounts').textContent = `${P.sites.length} candidate sites · ${P.groups.length} survivor groups · ${P.groups.reduce((a, g) => a + g.n, 0)} people`;
}

// ---------- inputs ----------
$$('#pModes button').forEach(b => b.onclick = () => { P.mode = b.dataset.m; $$('#pModes button').forEach(x => x.classList.toggle('on', x === b)); });
$('#pRange').oninput = () => { $('#pRangeV').textContent = $('#pRange').value + ' m'; P.plan = null; draw(); };
$('#pTarget').oninput = () => $('#pTargetV').textContent = $('#pTarget').value + '%';
$('#pClear').onclick = () => { P.sites = []; P.groups = []; P.plan = null; stopSim(); draw(); $('#pOut').innerHTML = ''; status('Cleared.'); };
$('#pImport').onclick = async () => { const j = await (await fetch('/api/state')).json(); let n = 0;
  j.msgs.forEach(m => { const ll = m.pos_ll || [m.lat ?? 17.4127, m.lon ?? 78.5083]; P.groups.push({ ll, n: m.people_n || 1, src: 'sos' }); n++; });
  // survivor-density heatmap cells (same field the Map tab shows)
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const EP = [17.4141, 78.5052];
  for (let i = 0; i < 46; i++) { const r = Math.pow(rnd(), .7) * 1300, a = rnd() * 6.283, w = (1 - r / 1500) * (0.5 + rnd());
    if (w > .75) P.groups.push({ ll: [EP[0] + r * Math.cos(a) / 111000, EP[1] + r * Math.sin(a) / (111000 * .954)], n: Math.round(2 + w * 6), src: 'heat' }); }
  P.plan = null; draw(); status(`Imported ${n} SOS location(s) and the high-density heatmap cells as survivor groups.`); };
$('#pSample').onclick = () => { // sample rooftops / water tanks spread over the area (editable)
  P.sites = [[17.4196, 78.5012], [17.4205, 78.5108], [17.4152, 78.4968], [17.4160, 78.5060], [17.4118, 78.5135], [17.4095, 78.5010], [17.4062, 78.5085], [17.4240, 78.5060]];
  P.plan = null; draw(); status('Loaded 8 candidate rooftops. Drag-free: click to add, right-click a site to remove.'); };

// ---------- QAOA: how many relays? ----------
$('#pRun').onclick = async () => {
  if (P.sites.length < 2 || !P.groups.length) return status('Add at least 2 candidate sites and 1 survivor group (or press Import).');
  stopSim(); const R = +$('#pRange').value, target = +$('#pTarget').value / 100, layers = +$('#pLayers').value;
  const data = { radius_m: R, sites: P.sites.map(toM), clusters: P.groups.map(g => [...toM(g.ll), g.n]) };
  const total = P.groups.reduce((a, g) => a + g.n, 0);
  // the most anyone can cover with ALL sites (some groups may be out of reach of every site)
  const all = Q.setup(data, P.sites.length).people([...P.sites.keys()]);
  $('#pRun').disabled = true; const rows = []; $('#pOut').innerHTML = '';
  let answer = null;
  for (let k = 1; k <= P.sites.length; k++) {
    status(`K = ${k}: building ${P.sites.length}-qubit circuit (Dicke |K=${k}⟩, ${layers} layer${layers > 1 ? 's' : ''}) and optimising angles…`);
    await sleep(30);
    const S = Q.setup(data, k); const t0 = performance.now(); const curve = [];
    const o = Q.optimise(S, layers, (ev, r, best) => { if (ev % 8 === 0) curve.push(best); });
    const prob = Q.run(S, o.gammas, o.betas), st = Q.stats(S, prob, 1024, 7 + k);
    const bestSample = st.top.map(([b]) => b).reduce((a, b) => S.pplOf[b] > S.pplOf[a] ? b : a, st.top[0][0]);
    const plan = S.chosenOf(bestSample), got = S.pplOf[bestSample];
    const row = { k, plan, got, opt: S.bestP, pOpt: st.pOpt, pRand: st.pRandValid, exp: st.expRatio, evals: o.evals, ms: performance.now() - t0, combos: S.combos, curve, gammas: o.gammas, betas: o.betas };
    rows.push(row); renderRows(rows, total, all, target, layers);
    P.plan = { chosen: plan, links: [] }; draw(); await sleep(250);
    if (got >= target * total || got >= all) { answer = row; break; }
  }
  if (!answer) answer = rows[rows.length - 1];
  // relay-to-command-post connectivity (relays forward to each other; link range = 3x survivor reach)
  const LR = R * 3, nodes = [P.cp, ...answer.plan.map(i => P.sites[i])]; const reach = new Set([0]); let grew = true; const links = [];
  while (grew) { grew = false; for (let i = 1; i < nodes.length; i++) if (!reach.has(i)) for (const j of reach) if (dist(nodes[i], nodes[j]) <= LR) { reach.add(i); links.push([nodes[j], nodes[i]]); grew = true; break; } }
  P.plan = { chosen: answer.plan, links, k: answer.k, R, LR }; draw();
  const ok = reach.size === nodes.length;
  $('#pAnswer').innerHTML = `<div class="ans"><b>${answer.k}</b><div><div class="big">relay${answer.k > 1 ? 's' : ''} needed</div>
    Sites ${answer.plan.join(', ')} cover <b>${answer.got} of ${total}</b> people (${Math.round(answer.got / total * 100)}%)${all < total ? ` · ${total - all} people are out of reach of every candidate site` : ''}.<br>
    ${answer.got === answer.opt ? '<span class="ok">✓ equals the brute-force optimum</span>' : `<span style="color:var(--org)">brute-force optimum for K=${answer.k}: ${answer.opt}</span>`} ·
    ${ok ? '<span class="ok">✓ every relay links back to the command post</span>' : `<span style="color:var(--red)">${nodes.length - reach.size} relay(s) out of link range of the command post: add a site in between</span>`}</div></div>`;
  status(`Done. QAOA ran ${rows.length} circuit${rows.length > 1 ? 's' : ''}; ${rows.reduce((a, r) => a + r.evals, 0)} circuit evaluations in ${Math.round(rows.reduce((a, r) => a + r.ms, 0))} ms.`);
  $('#pRun').disabled = false; $('#hsRun').disabled = !ok;
};

function renderRows(rows, total, all, target, layers) { const n = P.sites.length;
  const last = rows[rows.length - 1];
  $('#pOut').innerHTML = `<table class="qt"><tr><th>K</th><th>QAOA plan (best of 1,024 shots)</th><th>People</th><th>Brute force</th><th>P(optimum) QAOA</th><th>Random</th><th>Evals</th></tr>
    ${rows.map(r => `<tr class="${r.got >= target * total || r.got >= all ? 'hit' : ''}"><td>${r.k}</td><td>sites ${r.plan.join(', ')}</td><td>${r.got} (${Math.round(r.got / total * 100)}%)</td><td>${r.opt} ${r.got === r.opt ? '✓' : ''}</td><td>${(r.pOpt * 100).toFixed(1)}%</td><td>${(r.pRand * 100).toFixed(1)}%</td><td>${r.evals}</td></tr>`).join('')}</table>
    <div class="qmeta">${n} qubits (one per site) · Dicke start state · ${layers} QAOA layer${layers > 1 ? 's' : ''} (RZ + RZZ cost, RXX+RYY ring mixer) · exact statevector, ${1 << n} amplitudes · angles optimised live by Nelder-Mead · last K: γ=[${last.gammas.map(x => x.toFixed(2))}] β=[${last.betas.map(x => x.toFixed(2))}]</div>
    <svg viewBox="0 0 300 70" class="conv">${last.curve.length > 1 ? `<polyline fill="none" stroke="#a991ff" stroke-width="2" points="${last.curve.map((v, i) => `${i / (last.curve.length - 1) * 296 + 2},${68 - v * 64}`).join(' ')}"/>` : ''}<text x="4" y="12" fill="#8b9ab2" font-size="9">expected coverage while optimising (K=${last.k})</text></svg>`; }

// ---------- self-healing relay simulation on the planned relays ----------
const H = { on: false };
function stopSim() { H.on = false; $('#hsRun') && ($('#hsRun').textContent = '▶ Run self-healing on this plan'); if (P.L.sim) P.L.sim.clearLayers(); }
$('#hsRun').onclick = () => { if (H.on) return stopSim(); if (!P.plan?.chosen?.length) return; startSim(); };
function startSim() {
  const LR = P.plan.LR, relays = P.plan.chosen.map(i => ({ id: 'R' + i, ll: P.sites[i] }));
  // survivor node: the survivor group farthest from the command post (hardest to reach)
  const far = P.groups.reduce((a, g) => dist(g.ll, P.cp) > dist(a.ll, P.cp) ? g : a, P.groups[0]);
  const N = [{ id: 'S', ll: far.ll }, ...relays, { id: 'G', ll: P.cp }];
  const link = (a, b) => dist(a.ll, b.ll) <= LR;   // rescuer node, relays and gateway all use the same LoRa radio
  Object.assign(H, { on: true, t: 0, N, link, alive: Object.fromEntries(N.map(n => [n.id, true])), hops: Object.fromEntries(N.map(n => [n.id, n.id === 'G' ? 0 : 99])),
    heard: Object.fromEntries(N.map(n => [n.id, {}])), nb: Object.fromEntries(N.map(n => [n.id, Math.random() * 30])), msgs: [], sent: 0, del: 0, next: 5, log: [] });
  $('#hsRun').textContent = '⏸ Stop'; $('#hsLog').innerHTML = ''; let last = performance.now();
  const tick = now => { if (!H.on) return; const dt = Math.min(.1, (now - last) / 1000) * 30; last = now; for (let i = 0; i < 6; i++) step(dt / 6); drawSim(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function step(dt) { H.t += dt; const t = H.t, N = H.N, byId = Object.fromEntries(N.map(n => [n.id, n]));
  for (const n of N) if (H.alive[n.id] && t >= H.nb[n.id]) { H.nb[n.id] = t + 30 + (Math.random() * 10 - 5); for (const m of N) if (m !== n && H.alive[m.id] && H.link(n, m)) H.heard[m.id][n.id] = [t, H.hops[n.id]]; }
  for (const n of N) { if (n.id === 'G' || !H.alive[n.id]) continue; const live = Object.entries(H.heard[n.id]).filter(([, [ts]]) => t - ts <= 90); H.heard[n.id] = Object.fromEntries(live); H.hops[n.id] = live.length ? 1 + Math.min(...live.map(([, [, h]]) => h)) : 99; }
  if (t >= H.next) { H.next += 20; H.sent++; H.msgs.push({ at: 'S', to: null, busy: 0, born: t }); }
  for (const m of H.msgs) { if (m.busy > t) continue;
    if (m.to) { if (H.alive[m.to]) m.at = m.to; else { delete H.heard[m.at][m.to]; hlog(`no ACK from ${m.to} → trying next-best neighbour`); } m.to = null; }
    if (m.at === 'G') { m.done = true; H.del++; continue; }
    const c = Object.entries(H.heard[m.at] || {}).filter(([, [ts, h]]) => t - ts <= 90 && h < H.hops[m.at]).sort((a, b) => a[1][1] - b[1][1]);
    if (!c.length || !H.alive[m.at]) continue;                       // store and carry
    m.to = c[0][0]; m.busy = t + (H.alive[m.to] ? .3 : 2); }
  H.msgs = H.msgs.filter(m => !m.done); }
function hlog(s) { const last = H.log[H.log.length - 1]; if (last === s) return; H.log.push(s); $('#hsLog').insertAdjacentHTML('afterbegin', `<div><span>t=${Math.round(H.t)}s</span> ${esc(s)}</div>`); }
function drawSim() { const g = P.L.sim; g.clearLayers(); const N = H.N, byId = Object.fromEntries(N.map(n => [n.id, n]));
  // current best route
  const route = ['S']; let c = 'S', guard = 0; while (c !== 'G' && guard++ < 12) { const nx = Object.entries(H.heard[c] || {}).filter(([, [ts, h]]) => H.t - ts <= 90 && h < H.hops[c]).sort((a, b) => a[1][1] - b[1][1])[0]; if (!nx) break; c = nx[0]; route.push(c); }
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) if (H.link(N[i], N[j])) { const dead = !H.alive[N[i].id] || !H.alive[N[j].id]; L.polyline([N[i].ll, N[j].ll], { color: dead ? '#5a2030' : '#2b4a6a', weight: 1.5, dashArray: '4 6', interactive: false }).addTo(g); }
  for (let i = 0; i < route.length - 1; i++) L.polyline([byId[route[i]].ll, byId[route[i + 1]].ll], { color: '#43c6ff', weight: 5, opacity: .9, interactive: false }).addTo(g);
  for (const n of N) L.circleMarker(n.ll, { radius: n.id.length === 1 ? 11 : 9, color: !H.alive[n.id] ? '#ff3b5c' : n.id === 'S' ? '#ff9f1c' : n.id === 'G' ? '#2fe08a' : '#43c6ff', weight: 3, fillColor: '#0d1420', fillOpacity: 1 })
    .bindTooltip(n.id === 'S' ? 'Rescuer node at survivors' : n.id === 'G' ? 'Command post' : `${n.id} · ${H.alive[n.id] ? H.hops[n.id] < 99 ? H.hops[n.id] + ' hops · click to destroy' : 'no route' : 'DESTROYED · click to restore'}`)
    .on('click', () => { if (n.id[0] !== 'R') return; H.alive[n.id] = !H.alive[n.id]; hlog(`${n.id} ${H.alive[n.id] ? 'restored' : 'destroyed'}`); }).addTo(g);
  for (const m of H.msgs) { const a = byId[m.at].ll, b = m.to ? byId[m.to].ll : a, k = m.to ? Math.max(0, Math.min(1, 1 - (m.busy - H.t) / .3)) : 0;
    L.circleMarker([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], { radius: 5, color: '#fff', weight: 1, fillColor: '#ff3b5c', fillOpacity: 1, interactive: false }).addTo(g); }
  $$('#pmap .ps.on').forEach(e => e.classList.toggle('dead', H.alive['R' + e.dataset.site] === false));
  const stored = H.msgs.filter(m => !m.to).length;
  $('#hsStats').innerHTML = `<div><b>${H.del} / ${H.sent}</b>SOS delivered</div><div><b>${stored}</b>stored at a node (no route yet)</div><div><b>${route.join(' → ')}</b>current route</div><div><b>${Math.round(H.t)} s</b>simulated time (30×)</div>`; }

// open the tab
document.querySelector('#nav').addEventListener('click', e => { if (e.target.closest('[data-t="relays"]')) setTimeout(init, 40); });

// ---------- the same plan in Qiskit (runs quantum/qiskit_planner.py on this laptop) ----------
$('#pQiskit').onclick = async () => {
  if (P.sites.length < 2 || !P.groups.length) return status('Add at least 2 candidate sites and 1 survivor group (or press Import).');
  const body = { radius_m: +$('#pRange').value, target: +$('#pTarget').value / 100, layers: +$('#pLayers').value, sites: P.sites, groups: P.groups };
  await fetch('/api/qiskit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#pQiskit').disabled = true; const t0 = Date.now();
  const poll = async () => { const j = await (await fetch('/api/qiskit')).json();
    $('#qkOut').innerHTML = `<div class="qkh"><b>Qiskit Aer run</b><span class="mono" style="color:var(--mut)">${Math.round((Date.now() - t0) / 1000)} s</span></div><div class="qklog">${esc(j.log.join('\n')) || 'Building circuits…'}${j.error ? '\n\n' + esc(j.error) : ''}</div>`;
    if (j.running) return setTimeout(poll, 1000);
    $('#pQiskit').disabled = false;
    if (j.result) { const a = j.result.answer, total = j.result.total;
      P.plan = { ...(P.plan || {}), chosen: a.best_sampled, links: P.plan?.links || [], k: a.k, R: +$('#pRange').value, LR: +$('#pRange').value * 3 }; draw();
      $('#qkOut').insertAdjacentHTML('beforeend', `<div class="ans"><b>${a.k}</b><div><div class="big">relay${a.k > 1 ? 's' : ''} needed · Qiskit ${esc(j.result.qiskit)}</div>
        Sites ${a.best_sampled.join(', ')} cover <b>${a.people} of ${total}</b> people. ${a.people === a.optimum ? '<span class="ok">✓ brute-force optimum</span>' : ''}<br>
        Circuit: ${j.result.qubits} qubits · depth ${a.depth} after transpile · ${Object.entries(a.ops).map(([k, v]) => `${k} ${v}`).join(' · ')} · ${a.shots} shots on AerSimulator ·
        P(optimum) ${(a.p_optimum * 100).toFixed(1)}% vs ${(a.p_optimum_random * 100).toFixed(1)}% random · ${(a.p_valid * 100).toFixed(0)}% of shots place exactly ${a.k} relays</div></div>`);
      $('#hsRun').disabled = false; } };
  poll(); };
