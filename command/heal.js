// Self-healing relay network on the relays planned by QAOA.
// Same rules as sim/selfheal.py and the firmware: HELLO beacons, neighbour expiry, hop-count gradient,
// closer-only forwarding with hop ACK, retry next-best neighbour, store-and-carry. A fixed route
// (no healing) runs alongside on the same nodes for comparison.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KX = 111320 * Math.cos(17.4158 * Math.PI / 180), KY = 110540;
const dist = (a, b) => Math.hypot((a[1] - b[1]) * KX, (a[0] - b[0]) * KY);
const BEACON = 30, EXPIRE = 90, HOP = .3, ACK = 2, SOS_EVERY = 20, SPEED = 30;
let hmap, layer, H = null, raf = null;

async function init() {
  if (!hmap) {
    const { GEO } = await import('./lib/geo.js');
    hmap = L.map('hmap', { zoomSnap: .25, zoomControl: false }); L.control.zoom({ position: 'topright' }).addTo(hmap);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'darktiles', attribution: '© OpenStreetMap contributors' }).addTo(hmap);
    const zl = L.featureGroup(GEO.zone.map(w => L.polygon(w.c.map(c => [c[1], c[0]]), { color: '#43c6ff', weight: 1.2, fillOpacity: .03, interactive: false }))).addTo(hmap);
    hmap.fitBounds(zl.getBounds(), { padding: [30, 30] }); layer = L.layerGroup().addTo(hmap);
  } else hmap.invalidateSize();
  const plan = window.VOIDNAV_PLAN;
  if (!plan) { $('#hIntro').innerHTML = 'No relay plan yet. Open <b>Relays · QAOA</b>, find the relays, then press <b>Continue → Self-healing</b>.'; return; }
  if (!H || H.plan !== plan) reset(plan);
}

function reset(plan) { 
  stop();
  const far = plan.groups.reduce((a, g) => dist(g.ll, plan.cp) > dist(a.ll, plan.cp) ? g : a, plan.groups[0]);
  const N = [{ id: 'S', ll: far.ll, name: 'Rescuer node at survivors' }, ...plan.relays.map(r => ({ ...r, name: 'Relay ' + r.id })), { id: 'G', ll: plan.cp, name: 'Command post gateway' }];
  const link = (a, b) => dist(a.ll, b.ll) <= plan.LR;
  H = { plan, N, link, t: 0, alive: Object.fromEntries(N.map(n => [n.id, true])), hops: Object.fromEntries(N.map(n => [n.id, n.id === 'G' ? 0 : 99])),
    heard: Object.fromEntries(N.map(n => [n.id, {}])), nb: Object.fromEntries(N.map((n, i) => [n.id, 1 + i * 2.5])), msgs: [], fixed: [], sent: 0, del: 0, fdel: 0,
    fixedPath: null, next: 4, events: [], rule: 0, lat: [], killed: [] };
  $('#hIntro').innerHTML = `${plan.relays.length} relays from the QAOA plan (${plan.relays.map(r => r.id).join(', ')}), link range ${Math.round(plan.LR)} m. SOS from the survivors' rescuer node every ${SOS_EVERY} s (simulated time ${SPEED}× real).`;
  $('#hLog').innerHTML = ''; draw(); }

function log(s, rule) { H.events.unshift(`<div><span>t=${Math.round(H.t)}s</span>${rule ? `<i class="rb">${rule}</i>` : ''} ${esc(s)}</div>`); H.events = H.events.slice(0, 200); $('#hLog').innerHTML = H.events.join(''); if (rule) flashRule(rule); }
function flashRule(r) { const el = $(`#hRules li[data-r="${r}"]`); if (!el) return; el.classList.remove('hot'); void el.offsetWidth; el.classList.add('hot'); }
const best = id => Object.entries(H.heard[id] || {}).filter(([, [ts, h]]) => H.t - ts <= EXPIRE && h < H.hops[id]).sort((a, b) => a[1][1] - b[1][1]);
function route() { const r = ['S']; let c = 'S'; for (let g = 0; g < 15 && c !== 'G'; g++) { const b = best(c)[0]; if (!b) break; c = b[0]; r.push(c); } return r; }

function step(dt) { const t = (H.t += dt), N = H.N;
  // rule 1: HELLO beacons ("I am N hops from the gateway")
  for (const n of N) if (H.alive[n.id] && t >= H.nb[n.id]) { H.nb[n.id] = t + BEACON + (Math.random() * 10 - 5); for (const m of N) if (m !== n && H.alive[m.id] && H.link(n, m)) H.heard[m.id][n.id] = [t, H.hops[n.id]]; }
  // rule 2 + 3: expire silent neighbours, recompute hop gradient
  for (const n of N) { if (n.id === 'G' || !H.alive[n.id]) continue;
    for (const [m, [ts]] of Object.entries(H.heard[n.id])) if (t - ts > EXPIRE) { delete H.heard[n.id][m]; log(`${n.id} dropped ${m} after 3 missed beacons`, 2); }
    const live = Object.values(H.heard[n.id]); let h = live.length ? 1 + Math.min(...live.map(([, x]) => x)) : 99;
    if (h > N.length) h = 99;            // route longer than the network = no route (stops count-to-infinity)
    if (h !== H.hops[n.id]) { if (H.t > 1) log(`${n.id} is now ${h < 99 ? h + ' hops' : 'cut off'} from the gateway`, 3); H.hops[n.id] = h; } }
  if (!H.fixedPath && H.hops.S < 99) { H.fixedPath = route(); log(`Fixed-route baseline locked to ${H.fixedPath.join(' → ')}`); }
  // new SOS
  if (t >= H.next) { H.next += SOS_EVERY; H.sent++; H.msgs.push({ at: 'S', to: null, busy: 0, born: t }); if (H.fixedPath) H.fixed.push({ i: 0, busy: 0 }); }
  // rule 4 + 5 + 6: closer-only forwarding with ACK, retry next-best, store and carry
  for (const m of H.msgs) { if (m.busy > t) continue;
    if (m.to) { if (H.alive[m.to]) m.at = m.to; else { delete H.heard[m.at][m.to]; log(`${m.at}: no ACK from ${m.to} in 2 s → retry next-best neighbour`, 5); } m.to = null; }
    if (m.at === 'G') { m.done = true; H.del++; H.lat.push(t - m.born); continue; }
    const c = best(m.at);
    if (!c.length || !H.alive[m.at]) { if (!m.stored) { m.stored = true; log(`${m.at}: no route → SOS stored, will carry until a route returns`, 6); } continue; }
    if (m.stored) { m.stored = false; log(`${m.at}: route back → stored SOS forwarded`, 6); }
    m.to = c[0][0]; m.busy = t + (H.alive[m.to] ? HOP : ACK); }
  H.msgs = H.msgs.filter(m => !m.done);
  for (const f of H.fixed) { if (f.busy > t) continue; const nx = H.fixedPath[f.i + 1]; if (!nx) continue; if (H.alive[nx]) { f.i++; f.busy = t + HOP; if (nx === 'G') { f.done = true; H.fdel++; } } }
  H.fixed = H.fixed.filter(f => !f.done);
  // scripted scenario
  if (H.auto) for (const e of H.auto) if (!e.done && t >= e.t) { e.done = true; e.fn(); }
}

function kill(id, why) { if (!H.alive[id]) return; H.alive[id] = false; H.killed.push(id); log(`${id} DESTROYED${why ? ' (' + why + ')' : ''}`, 0); }
function revive(id) { if (H.alive[id]) return; H.alive[id] = true; H.killed = H.killed.filter(x => x !== id); H.nb[id] = H.t + .5; log(`${id} back online`, 0); }
const onRoute = () => route().find(x => x[0] === 'R' && H.alive[x]);

function draw() { if (!H) return; layer.clearLayers(); const N = H.N, by = Object.fromEntries(N.map(n => [n.id, n])), r = route(), fp = H.fixedPath || [];
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) if (H.link(N[i], N[j])) { const dead = !H.alive[N[i].id] || !H.alive[N[j].id];
    L.polyline([N[i].ll, N[j].ll], { color: dead ? '#5a2030' : '#2b4a6a', weight: 1.5, dashArray: '4 6', interactive: false }).addTo(layer); }
  for (let i = 0; i < fp.length - 1; i++) L.polyline([by[fp[i]].ll, by[fp[i + 1]].ll], { color: '#ff9f1c', weight: 2, dashArray: '2 8', opacity: .8, interactive: false }).addTo(layer);
  if (r[r.length - 1] === 'G') for (let i = 0; i < r.length - 1; i++) L.polyline([by[r[i]].ll, by[r[i + 1]].ll], { color: '#43c6ff', weight: 6, opacity: .9, interactive: false }).addTo(layer);
  for (const n of N) { const al = H.alive[n.id], col = !al ? '#ff3b5c' : n.id === 'S' ? '#ff9f1c' : n.id === 'G' ? '#2fe08a' : '#43c6ff';
    L.marker(n.ll, { icon: L.divIcon({ className: '', html: `<div class="hn ${al ? '' : 'dead'}" style="--c:${col}"><b>${al ? n.id : '✕'}</b><span>${!al ? 'destroyed' : n.id === 'G' ? 'gateway' : n.id === 'S' ? 'survivors' : H.hops[n.id] < 99 ? H.hops[n.id] + ' hops' : 'no route'}</span></div>`, iconSize: [0, 0] }) })
      .on('click', () => { if (n.id[0] !== 'R') return; al ? kill(n.id, 'clicked') : revive(n.id); }).addTo(layer); }
  for (const m of H.msgs) { const a = by[m.at].ll, b = m.to ? by[m.to].ll : a, k = m.to ? Math.max(0, Math.min(1, 1 - (m.busy - H.t) / HOP)) : 0;
    L.circleMarker([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], { radius: 6, color: '#fff', weight: 1.5, fillColor: m.stored ? '#f6d04d' : '#ff3b5c', fillOpacity: 1, interactive: false }).addTo(layer); }
  const stored = H.msgs.filter(m => !m.to).length, med = H.lat.length ? [...H.lat].sort((a, b) => a - b)[H.lat.length >> 1] : null;
  $('#hStats').innerHTML = `<div><b class="ok">${H.del}/${H.sent}</b>delivered with self-healing</div><div><b style="color:var(--org)">${H.fdel}/${H.sent}</b>delivered on a fixed route</div>
    <div><b>${stored}</b>stored, waiting for a route</div><div><b>${med != null ? med.toFixed(1) + ' s' : '—'}</b>median SOS latency</div>
    <div class="wide2"><b>${r[r.length - 1] === 'G' ? r.join(' → ') : 'S cut off: storing'}</b>current route · t = ${Math.round(H.t)} s</div>`;
  $('#hTable').innerHTML = `<tr><th>Node</th><th>State</th><th>Hops to gateway</th><th>Live neighbours</th></tr>` + N.map(n => `<tr class="${H.alive[n.id] ? '' : 'dd'}"><td>${n.id}</td><td>${H.alive[n.id] ? 'up' : 'destroyed'}</td><td>${n.id === 'G' ? 0 : H.hops[n.id] < 99 ? H.hops[n.id] : '—'}</td><td>${Object.keys(H.heard[n.id] || {}).join(', ') || '—'}</td></tr>`).join(''); }

function loop(now) { if (!H?.running) return; const dt = Math.min(.1, (now - (H.last || now)) / 1000) * SPEED; H.last = now; for (let i = 0; i < 6; i++) step(dt / 6); draw(); raf = requestAnimationFrame(loop); }
function start() { if (!H) return; H.running = true; H.last = 0; $('#hPlay').textContent = '⏸ Pause'; raf = requestAnimationFrame(loop); }
function stop() { if (H) H.running = false; cancelAnimationFrame(raf); $('#hPlay') && ($('#hPlay').textContent = '▶ Start'); }

$('#hPlay').onclick = () => H?.running ? stop() : start();
$('#hReset').onclick = () => { if (H) reset(H.plan); };
$('#hKill').onclick = () => { const id = onRoute(); if (id) kill(id, 'busiest relay on the live route'); else log('No relay on the live route to destroy'); };
$('#hRevive').onclick = () => { const id = H?.killed[0]; if (id) revive(id); };
$('#hAuto').onclick = () => { if (!H?.plan) return; reset(H.plan); const k = []; H.auto = [
  { t: 150, fn: () => { const id = (H.fixedPath || []).find(x => x[0] === 'R' && H.alive[x]) || onRoute(); if (id) { k.push(id); kill(id, 'scenario: aftershock hits the original route'); } } },
  { t: 330, fn: () => { const id = onRoute(); if (id) { k.push(id); kill(id, 'scenario: second relay lost'); } } },
  { t: 520, fn: () => { if (k[1]) revive(k[1]); } }]; log('Scenario: aftershock destroys the relay on the live route at 150 s, a second at 330 s; the second is repaired at 520 s'); start(); };

document.querySelector('#nav').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; if (b.dataset.t === 'healing') setTimeout(init, 40); else stop(); });
