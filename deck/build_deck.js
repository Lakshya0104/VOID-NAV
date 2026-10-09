// Builds VOID-NAV_Off-Grid_Emergency_Comms.pptx from results/results.json
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");
const { applyTheme } = require(process.env.SKILL + "/scripts/apply_theme.js");
const R = JSON.parse(fs.readFileSync(path.join(__dirname, "../results/results.json")));

const THEME = { name: "VOID-NAV Signal", headFontFace: "Cambria", bodyFontFace: "Calibri",
  colors: { dk1: "0B1320", lt1: "FFFFFF", dk2: "1C2A3F", lt2: "EEF2F7", accent1: "FF6B35", accent2: "2EC4B6",
    accent3: "FFC857", accent4: "8D99AE", accent5: "E63946", accent6: "5A7DA8", hlink: "2EC4B6", folHlink: "8D99AE" } };
const H = THEME.colors;
const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "VOID-NAV: Off-Grid Emergency Communication";
const C = pres.SchemeColor;
const footer = { text: { text: "VOID-NAV  ·  TH2-PS-NGC-008", options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: C.accent4 } } };
const num = { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: C.accent4, align: "right" };

pres.defineSlideMaster({ title: "DARK_TITLE", background: { color: H.dk1 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 2.3, w: 8.4, h: 1.6, fontSize: 48, align: "left", bold: true, color: C.background1, fontFace: THEME.headFontFace }, text: "" } },
            { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 4.0, w: 8, h: 1.2, fontSize: 20, color: C.accent2 }, text: "" } }] });
pres.defineSlideMaster({ title: "DARK_CONTENT", background: { color: H.dk1 }, slideNumber: num,
  objects: [footer, { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 36, bold: true, color: C.background1, fontFace: THEME.headFontFace }, text: "" } }] });
pres.defineSlideMaster({ title: "LIGHT_CONTENT", background: { color: H.lt2 }, slideNumber: num,
  objects: [footer, { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 36, bold: true, color: C.text1, fontFace: THEME.headFontFace }, text: "" } }] });

const T = (s, txt, o) => s.addText(txt, Object.assign({ isTextBox: true, fontSize: 14, color: C.text1, valign: "top" }, o));
const card = (s, x, y, w, h, fill, name) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill }, objectName: name,
  shadow: { type: "outer", color: "000000", opacity: 0.15, blur: 6, offset: 2, angle: 90 } });
const dot = (s, x, y, d, fill, label, lc) => { s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill } });
  if (label) T(s, label, { x, y, w: d, h: d, align: "center", valign: "middle", fontSize: d > 0.7 ? 20 : 12, bold: true, color: lc || C.background1, margin: 0 }); };
const sw = (p, f) => R.sweep.find(r => r.proto === p && Math.abs(r.fail - f) < 1e-6);
const FAILS = [0, 0.1, 0.2, 0.3, 0.4, 0.5], LABELS = FAILS.map(f => Math.round(f * 100) + "%");
const PROTOS = [["direct", "Direct carry", H.accent4], ["flood", "Epidemic flood", H.accent6], ["spray", "Spray & Wait", H.accent3], ["voidnav", "VOID-NAV", H.accent1]];
const chartBase = (title, dark) => ({ showTitle: true, title, titleFontSize: 14, titleColor: dark ? H.lt1 : H.dk1, titleFontFace: "+mn-lt",
  catAxisLabelColor: dark ? "C9D2DE" : "4A5568", valAxisLabelColor: dark ? "C9D2DE" : "4A5568", catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
  catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: dark ? "2A3B55" : "D5DCE6", size: 0.5 }, catGridLine: { style: "none" },
  legendFontFace: "+mn-lt", legendFontSize: 11, legendColor: dark ? "C9D2DE" : "4A5568", dataLabelFontFace: "+mn-lt", dataLabelFontSize: 11 });

// 1. Title
let s = pres.addSection({ title: "Intro" });
s = pres.addSlide({ masterName: "DARK_TITLE", sectionTitle: "Intro" });
// mesh motif on the right
const mesh = [[10.2, 1.2], [11.8, 1.9], [9.6, 3.1], [11.2, 3.6], [12.4, 4.6], [10.1, 5.0], [11.4, 6.0], [9.0, 6.2]];
[[0,1],[0,2],[1,3],[2,3],[3,4],[3,5],[5,6],[4,6],[5,7],[2,5]].forEach(([a,b]) =>
  s.addShape(pres.shapes.LINE, { x: Math.min(mesh[a][0], mesh[b][0]) + 0.2, y: Math.min(mesh[a][1], mesh[b][1]) + 0.2, w: Math.abs(mesh[a][0]-mesh[b][0]) || 0.01, h: Math.abs(mesh[a][1]-mesh[b][1]) || 0.01,
    flipH: (mesh[a][0] < mesh[b][0]) !== (mesh[a][1] < mesh[b][1]), line: { color: H.accent2, width: 1.5, transparency: 40 } }));
mesh.forEach(([x, y], i) => dot(s, x, y, 0.4, i === 0 ? H.accent1 : i === 6 ? H.accent3 : H.accent2));
T(s, "PROBLEM STATEMENT 8  ·  NEXT GEN COMMUNICATION", { x: 0.6, y: 1.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: C.accent1, charSpacing: 3, margin: 0 });
s.addText("VOID-NAV", { placeholder: "title" });
s.addText("Off-grid, multi-hop emergency messaging that keeps working when towers, power and Internet don't", { placeholder: "body" });
T(s, "SOS in  →  hop · hop · hop  →  delivered ✓  →  confirmation back to sender", { x: 0.6, y: 5.6, w: 8, h: 0.4, fontSize: 14, color: C.accent4, margin: 0 });
s.addNotes("VOID-NAV: an infrastructure-independent emergency messaging network built on store-carry-forward multi-hop relaying with end-to-end delivery confirmation.");

// 2. Problem
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "Intro" });
s.addText("When the grid goes dark, so does the call for help", { placeholder: "title" });
[["0", "cell towers reachable", "Backhaul and power loss take base stations down within hours of a major disaster"],
 ["0", "bars of Internet", "No cloud, no messaging apps, no location sharing for affected communities"],
 ["?", "did it arrive?", "Even when a message escapes, senders and responders can't tell if it reached anyone"]].forEach(([big, lab, d], i) => {
  const x = 0.6 + i * 4.1; card(s, x, 1.7, 3.8, 3.4, "FFFFFF", "problem" + i);
  T(s, big, { x: x + 0.3, y: 1.9, w: 3.2, h: 1.3, fontSize: 72, bold: true, color: C.accent5, fontFace: THEME.headFontFace, margin: 0 });
  T(s, lab, { x: x + 0.3, y: 3.2, w: 3.2, h: 0.45, fontSize: 20, bold: true, margin: 0 });
  T(s, d, { x: x + 0.3, y: 3.75, w: 3.2, h: 1.2, fontSize: 14, color: C.text2, margin: 0 }); });
card(s, 0.6, 5.5, 12.1, 1.1, H.dk1, "challenge");
T(s, [{ text: "Challenge:  ", options: { bold: true, color: C.accent1 } }, { text: "maintain communication, relay across changing connectivity and thin bandwidth, and give users and responders dependable delivery status.", options: { color: C.background1 } }],
  { x: 0.9, y: 5.6, w: 11.5, h: 0.9, fontSize: 16, valign: "middle", margin: 0 });

// 3. Solution overview
s = pres.addSlide({ masterName: "DARK_CONTENT", sectionTitle: "Intro" });
s.addText("VOID-NAV turns every device into a relay", { placeholder: "title" });
[["📱", "Any device is a node", "Phones (BLE / Wi-Fi Direct), LoRa beacons and responder radios form an ad-hoc mesh — no towers, no SIM."],
 ["📦", "Store · carry · forward", "Messages wait in a node's buffer and ride people and vehicles across gaps in the network."],
 ["🚨", "SOS first", "Priority classes set copy budget, TTL and queue order; SOS pre-empts info traffic on thin links."],
 ["✅", "Delivered receipts", "Destination emits a tiny ACK that floods back, confirms to the sender, and purges stale copies."]].forEach(([ic, h, d], i) => {
  const x = 0.6 + (i % 2) * 6.15, y = 1.6 + Math.floor(i / 2) * 2.6;
  card(s, x, y, 5.95, 2.3, H.dk2, "pillar" + i); dot(s, x + 0.35, y + 0.4, 0.9, H.accent1, ic);
  T(s, h, { x: x + 1.5, y: y + 0.35, w: 4.2, h: 0.5, fontSize: 20, bold: true, color: C.background1, margin: 0 });
  T(s, d, { x: x + 1.5, y: y + 0.9, w: 4.2, h: 1.2, fontSize: 14, color: "C9D2DE", margin: 0 }); });

// 4. Architecture
pres.addSection({ title: "System" });
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "System" });
s.addText("Layered architecture, infrastructure-free end to end", { placeholder: "title" });
[["Emergency App", "SOS button · templates · GPS tag · status ticks", H.accent1],
 ["Bundle Layer", "Signed message bundles · priority · TTL · custody", H.accent3],
 ["Routing Engine", "Spray quota + delivery-predictability (PRoPHET) handoff", H.accent2],
 ["ACK / Status Plane", "Delivery receipts gossiped back · copy purge", H.accent6],
 ["Radio Abstraction", "BLE · Wi-Fi Direct · LoRa 868/915 MHz · solar relays", H.dk2]].forEach(([n, d, col], i) => {
  const y = 1.55 + i * 1.02; card(s, 0.6, y, 7.4, 0.85, col, "layer" + i);
  T(s, n, { x: 0.85, y, w: 2.6, h: 0.85, fontSize: 16, bold: true, valign: "middle", color: (i === 1) ? C.text1 : C.background1, margin: 0 });
  T(s, d, { x: 3.5, y, w: 4.4, h: 0.85, fontSize: 14, valign: "middle", color: (i === 1) ? C.text1 : C.background1, margin: 0 }); });
card(s, 8.5, 1.55, 4.2, 4.93, "FFFFFF", "nodes");
T(s, "Node types", { x: 8.8, y: 1.75, w: 3.6, h: 0.45, fontSize: 20, bold: true, margin: 0 });
[["Civilian phones", "mobile, intermittent", H.accent2], ["Responder radios", "mobile, long range", H.accent1], ["Solar relay beacons", "static, always-on", H.accent3], ["Command post gateway", "satellite uplink when available", H.dk2]].forEach(([n, d, col], i) => {
  dot(s, 8.8, 2.45 + i * 0.95, 0.45, col);
  T(s, n, { x: 9.45, y: 2.38 + i * 0.95, w: 3.1, h: 0.35, fontSize: 15, bold: true, margin: 0 });
  T(s, d, { x: 9.45, y: 2.72 + i * 0.95, w: 3.1, h: 0.3, fontSize: 12, color: C.text2, margin: 0 }); });

// 5. Message journey
s = pres.addSlide({ masterName: "DARK_CONTENT", sectionTitle: "System" });
s.addText("Life of an SOS: multi-hop out, receipt back", { placeholder: "title" });
const steps = [["1", "Create", "Victim taps SOS; bundle gets ID, GPS, priority 0, 16-copy quota"], ["2", "Spray", "Copies halve at each encounter, fanning out across the crowd"],
  ["3", "Carry", "In blackout zones, carriers hold custody until they walk out of the gap"], ["4", "Hand-off", "Last copy moves only to nodes likelier to meet the destination"],
  ["5", "Deliver", "Rescue post receives; duplicate copies are suppressed"], ["6", "Confirm", "ACK floods back; sender sees ✓✓ delivered and buffers purge"]];
steps.forEach(([n, h, d], i) => { const x = 0.6 + i * 2.05;
  if (i < 5) s.addShape(pres.shapes.LINE, { x: x + 1.0, y: 2.25, w: 2.05, h: 0, line: { color: H.accent2, width: 2, dashType: "dash" } });
  dot(s, x + 0.45, 1.8, 0.9, i === 5 ? H.accent2 : H.accent1, n);
  T(s, h, { x, y: 2.95, w: 1.85, h: 0.45, fontSize: 18, bold: true, color: C.background1, align: "center", margin: 0 });
  T(s, d, { x, y: 3.45, w: 1.85, h: 1.6, fontSize: 13, color: "C9D2DE", align: "center", margin: 0 }); });
card(s, 0.6, 5.35, 12.1, 1.3, H.dk2, "statusbar");
[["⏳ Queued", H.accent4], ["↗ Relayed (n hops)", H.accent3], ["✓ Delivered", H.accent2], ["✓✓ Confirmed to sender", H.accent1]].forEach(([t, col], i) =>
  T(s, t, { x: 0.9 + i * 2.95, y: 5.5, w: 2.8, h: 1.0, fontSize: 16, bold: true, color: col, valign: "middle", margin: 0 }));

// 6. Routing details
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "System" });
s.addText("Routing tuned for scarce, broken links", { placeholder: "title" });
s.addTable([
  [{ text: "Priority", options: { bold: true, color: H.lt1, fill: { color: H.dk1 } } }, { text: "Copy quota", options: { bold: true, color: H.lt1, fill: { color: H.dk1 } } },
   { text: "TTL", options: { bold: true, color: H.lt1, fill: { color: H.dk1 } } }, { text: "Buffer policy", options: { bold: true, color: H.lt1, fill: { color: H.dk1 } } }],
  [{ text: "P0 · SOS", options: { bold: true, color: H.accent5 } }, "16", "100 min", "Never evicted; may evict P1/P2"],
  [{ text: "P1 · Urgent", options: { bold: true, color: H.accent1 } }, "8", "67 min", "Evicts P2 when full"],
  [{ text: "P2 · Info", options: { bold: true, color: H.accent6 } }, "4", "42 min", "First to drop"]],
  { x: 0.6, y: 1.6, w: 7.2, colW: [1.6, 1.4, 1.2, 3.0], fontSize: 14, color: H.dk1, fill: { color: "FFFFFF" }, border: { type: "solid", color: "D5DCE6", pt: 1 }, rowH: 0.55 });
card(s, 8.2, 1.6, 4.5, 4.9, "FFFFFF", "formula");
T(s, "Delivery predictability", { x: 8.5, y: 1.8, w: 4, h: 0.45, fontSize: 20, bold: true, margin: 0 });
T(s, [{ text: "On meeting b:", options: { bold: true, breakLine: true } }, { text: "P(a,b) ← P + (1−P)·0.75", options: { fontFace: "Courier New", breakLine: true } },
  { text: "Transitive:", options: { bold: true, breakLine: true } }, { text: "P(a,c) ← max(P, P(a,b)·P(b,c)·0.25)", options: { fontFace: "Courier New", breakLine: true } },
  { text: "Aging per 10 s:", options: { bold: true, breakLine: true } }, { text: "P ← P·0.995", options: { fontFace: "Courier New", breakLine: true } },
  { text: "Hand off last copy only if P(b,dst) > P(a,dst) + 0.05", options: { color: C.accent1, bold: true } }],
  { x: 8.5, y: 2.4, w: 4, h: 3.9, fontSize: 14, paraSpaceAfter: 6, margin: 0 });
T(s, "Bandwidth cap of 4 bundles per contact per 10 s is spent in priority order — an SOS never waits behind a status update.", { x: 0.6, y: 4.2, w: 7.2, h: 1.0, fontSize: 15, color: C.text2, margin: 0 });
T(s, "ACK digests are a few bytes of message IDs, merged on every contact where the two sets differ.", { x: 0.6, y: 5.3, w: 7.2, h: 1.0, fontSize: 15, color: C.text2, margin: 0 });

// 7. Evaluation setup
pres.addSection({ title: "Evaluation" });
s = pres.addSlide({ masterName: "DARK_CONTENT", sectionTitle: "Evaluation" });
s.addText("Evaluation under simulated network outages", { placeholder: "title" });
[["66", "nodes (60 mobile, 6 static relays)"], ["1 km²", "disaster zone, 120 m radio range"], ["100 min", "simulated, 10 s steps"], ["120", "messages / run, 20% SOS"], ["0–50%", "nodes killed at t = 20 min"], ["5", "seeds per point, 4 protocols"]].forEach(([b, l], i) => {
  const x = 0.6 + (i % 3) * 4.1, y = 1.6 + Math.floor(i / 3) * 2.0; card(s, x, y, 3.8, 1.75, H.dk2, "setup" + i);
  T(s, b, { x: x + 0.3, y: y + 0.2, w: 3.3, h: 0.85, fontSize: 40, bold: true, color: C.accent1, fontFace: THEME.headFontFace, margin: 0 });
  T(s, l, { x: x + 0.3, y: y + 1.05, w: 3.3, h: 0.55, fontSize: 14, color: "C9D2DE", margin: 0 }); });
T(s, [{ text: "Plus a regional blackout: ", options: { bold: true, color: C.accent3 } }, { text: "every node in the western 40% of the zone goes silent from minute 33 to 50 — modelling a power-cut sector.", options: { color: C.background1 } }],
  { x: 0.6, y: 5.75, w: 12.1, h: 0.7, fontSize: 16, margin: 0 });

// 8. Delivery ratio chart
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "Evaluation" });
s.addText("Delivery holds up as the network falls apart", { placeholder: "title" });
s.addChart(pres.charts.LINE, PROTOS.map(([p, n]) => ({ name: n, labels: LABELS, values: FAILS.map(f => +(sw(p, f).pdr * 100).toFixed(1)) })),
  Object.assign(chartBase("Delivery ratio (%) vs. nodes failed"), { x: 0.6, y: 1.5, w: 8.2, h: 5.2, chartColors: PROTOS.map(p => p[2]), lineSize: 3, lineDataSymbolSize: 8,
    valAxisMinVal: 40, valAxisMaxVal: 100, showLegend: true, legendPos: "b", catAxisTitle: "Nodes failed", showCatAxisTitle: true, catAxisTitleColor: "4A5568", catAxisTitleFontSize: 11 }));
card(s, 9.2, 1.6, 3.5, 2.3, "FFFFFF", "k1");
T(s, (sw("voidnav", 0.5).pdr * 100).toFixed(0) + "%", { x: 9.5, y: 1.75, w: 3, h: 1.0, fontSize: 54, bold: true, color: C.accent1, fontFace: THEME.headFontFace, margin: 0 });
T(s, "of messages still delivered with half the network destroyed", { x: 9.5, y: 2.8, w: 3, h: 0.9, fontSize: 14, color: C.text2, margin: 0 });
card(s, 9.2, 4.2, 3.5, 2.3, "FFFFFF", "k2");
T(s, "+" + ((sw("voidnav", 0.5).pdr - sw("direct", 0.5).pdr) * 100).toFixed(0) + " pts", { x: 9.5, y: 4.35, w: 3, h: 1.0, fontSize: 54, bold: true, color: C.accent2, fontFace: THEME.headFontFace, margin: 0 });
T(s, "over direct carrying at 50% failure; within " + ((sw("flood", 0.5).pdr - sw("voidnav", 0.5).pdr) * 100).toFixed(0) + " pts of flooding", { x: 9.5, y: 5.4, w: 3, h: 0.9, fontSize: 14, color: C.text2, margin: 0 });

// 9. Latency
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "Evaluation" });
s.addText("SOS messages arrive twice as fast as spray-and-wait", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "Median SOS latency (min)", labels: PROTOS.map(p => p[1]), values: PROTOS.map(([p]) => +(sw(p, 0.2).sos_lat / 60).toFixed(1)) }],
  Object.assign(chartBase("Median SOS latency at 20% failure (minutes)"), { x: 0.6, y: 1.5, w: 6.0, h: 5.2, barDir: "bar", chartColors: PROTOS.map(p => p[2]), invertedColors: PROTOS.map(p => p[2]),
    showValue: true, dataLabelFormatCode: "0.0", dataLabelPosition: "outEnd", dataLabelColor: "4A5568", showLegend: false, valAxisHidden: true, valGridLine: { style: "none" } }));
// latency CDF
const bins = [0, 2, 4, 6, 8, 10, 15, 20, 30, 45, 60];
s.addChart(pres.charts.LINE, PROTOS.map(([p, n]) => { const L = R.cdf[p]; const tot = sw(p, 0.2) ? L.length / sw(p, 0.2).pdr : L.length;
  return { name: n, labels: bins.map(b => b + "m"), values: bins.map(b => +(100 * L.filter(v => v <= b * 60).length / tot).toFixed(1)) }; }),
  Object.assign(chartBase("Cumulative % of all messages delivered by time"), { x: 6.9, y: 1.5, w: 5.8, h: 5.2, chartColors: PROTOS.map(p => p[2]), lineSize: 2.5, lineDataSymbol: "none",
    valAxisMinVal: 0, valAxisMaxVal: 100, showLegend: true, legendPos: "b" }));

// 10. Overhead
s = pres.addSlide({ masterName: "DARK_CONTENT", sectionTitle: "Evaluation" });
s.addText("Flooding works, but burns scarce bandwidth", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "Transmissions per delivered message", labels: PROTOS.slice(1).map(p => p[1]), values: PROTOS.slice(1).map(([p]) => +sw(p, 0.2).overhead.toFixed(1)) }],
  Object.assign(chartBase("Data transmissions per delivered message (20% failure)", true), { x: 0.6, y: 1.5, w: 7.0, h: 5.2, chartColors: PROTOS.slice(1).map(p => p[2]), invertedColors: PROTOS.slice(1).map(p => p[2]),
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: "C9D2DE", showLegend: false, valAxisHidden: true, valGridLine: { style: "none" } }));
card(s, 8.0, 1.6, 4.7, 4.9, H.dk2, "ovh");
T(s, Math.round(sw("flood", 0.2).overhead / sw("voidnav", 0.2).overhead) + "×", { x: 8.3, y: 1.8, w: 4.1, h: 1.3, fontSize: 72, bold: true, color: C.accent1, fontFace: THEME.headFontFace, margin: 0 });
T(s, "less data traffic than epidemic flooding at near-identical delivery", { x: 8.3, y: 3.15, w: 4.1, h: 0.9, fontSize: 16, color: C.background1, margin: 0 });
T(s, "Fewer transmissions mean longer phone batteries, less radio contention, and room for SOS traffic on LoRa duty-cycle limits. Receipts add ~" + Math.round(sw("voidnav", 0.2).ack_overhead) + " tiny digest exchanges per delivery.",
  { x: 8.3, y: 4.2, w: 4.1, h: 2.1, fontSize: 14, color: "C9D2DE", margin: 0 });

// 11. Reliability / ACK
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "Evaluation" });
s.addText("Senders know their message got through", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "Delivered messages confirmed to sender (%)", labels: LABELS, values: FAILS.map(f => +(sw("voidnav", f).ack_ratio * 100).toFixed(1)) }],
  Object.assign(chartBase("Delivered messages confirmed back to sender (%), by nodes failed"), { x: 0.6, y: 1.5, w: 7.6, h: 5.2, chartColors: [H.accent2], showValue: true, dataLabelPosition: "outEnd",
    dataLabelColor: "4A5568", showLegend: false, valAxisMinVal: 80, valAxisMaxVal: 100, catAxisTitle: "Nodes failed", showCatAxisTitle: true, catAxisTitleColor: "4A5568", catAxisTitleFontSize: 11 }));
[[ (sw("voidnav", 0.2).ack_ratio * 100).toFixed(0) + "%", "receipts returned at 20% failure", C.accent2],
 [ (sw("voidnav", 0.2).ack_lat / 60).toFixed(1) + " min", "median send → ✓✓ confirmation", C.accent1],
 ["0", "baselines that give any delivery status", C.accent5]].forEach(([b, l, col], i) => {
  card(s, 8.6, 1.6 + i * 1.7, 4.1, 1.5, "FFFFFF", "ack" + i);
  T(s, b, { x: 8.9, y: 1.7 + i * 1.7, w: 3.6, h: 0.8, fontSize: 40, bold: true, color: col, fontFace: THEME.headFontFace, margin: 0 });
  T(s, l, { x: 8.9, y: 2.5 + i * 1.7, w: 3.6, h: 0.5, fontSize: 14, color: C.text2, margin: 0 }); });

// 12. Resilience scorecard
s = pres.addSlide({ masterName: "DARK_CONTENT", sectionTitle: "Evaluation" });
s.addText("Resilience scorecard at 30% node failure", { placeholder: "title" });
const hdr = t => ({ text: t, options: { bold: true, color: H.dk1, fill: { color: H.accent2 } } });
s.addTable([[hdr("Protocol"), hdr("Delivery"), hdr("SOS delivery"), hdr("SOS latency"), hdr("Tx / delivery"), hdr("Delivery receipts")],
  ...PROTOS.map(([p, n, col]) => { const r = sw(p, 0.3); const hl = p === "voidnav"; const o = { color: hl ? H.accent1 : H.lt1, bold: hl, fill: { color: hl ? "24344D" : H.dk2 } };
    return [{ text: n, options: Object.assign({}, o) }, { text: (r.pdr * 100).toFixed(1) + "%", options: Object.assign({}, o) }, { text: (r.sos_pdr * 100).toFixed(1) + "%", options: Object.assign({}, o) },
      { text: (r.sos_lat / 60).toFixed(1) + " min", options: Object.assign({}, o) }, { text: r.overhead.toFixed(1), options: Object.assign({}, o) }, { text: hl ? (r.ack_ratio * 100).toFixed(0) + "%" : "—", options: Object.assign({}, o) }]; })],
  { x: 0.6, y: 1.7, w: 12.1, colW: [2.5, 1.8, 2.0, 1.9, 1.9, 2.0], fontSize: 16, rowH: 0.7, border: { type: "solid", color: H.dk1, pt: 2 }, valign: "middle" });
T(s, "Only VOID-NAV combines flood-class delivery, fast SOS, low overhead and end-to-end confirmation.", { x: 0.6, y: 5.6, w: 12.1, h: 0.6, fontSize: 18, color: C.accent3, bold: true, margin: 0 });

// 13. Demo + next steps
pres.addSection({ title: "Close" });
s = pres.addSlide({ masterName: "LIGHT_CONTENT", sectionTitle: "Close" });
s.addText("Demonstration and roadmap", { placeholder: "title" });
card(s, 0.6, 1.6, 5.9, 4.9, "FFFFFF", "demo");
T(s, "Run it yourself", { x: 0.9, y: 1.8, w: 5.3, h: 0.5, fontSize: 20, bold: true, margin: 0 });
s.addText("python3 sim/voidnav.py results/results.json", { x: 0.9, y: 2.4, w: 5.3, h: 0.5, fontSize: 13, fontFace: "Courier New", color: H.lt1, fill: { color: H.dk1 }, isTextBox: true });
T(s, [{ text: "Pure Python, no dependencies, seeded and reproducible", options: { bullet: true, breakLine: true } },
  { text: "Sweeps 4 protocols × 6 outage levels × 5 seeds", options: { bullet: true, breakLine: true } },
  { text: "Emits JSON that rebuilds every chart in this deck", options: { bullet: true } }], { x: 0.9, y: 3.1, w: 5.3, h: 2.5, fontSize: 15, paraSpaceAfter: 8, margin: 0 });
[["Now", "Simulator, routing engine, ACK plane, evaluation", H.accent2], ["Next", "Android app over BLE + Wi-Fi Direct; LoRa relay firmware", H.accent1],
 ["Then", "Field trial with responders; end-to-end encryption and signed bundles", H.accent3]].forEach(([w, d, col], i) => {
  dot(s, 7.0, 1.75 + i * 1.6, 0.95, col, w, i === 2 ? C.text1 : C.background1);
  T(s, d, { x: 8.2, y: 1.75 + i * 1.6, w: 4.5, h: 0.95, fontSize: 16, valign: "middle", margin: 0 }); });

// 14. Close
s = pres.addSlide({ masterName: "DARK_TITLE", sectionTitle: "Close" });
s.addText("No towers. No Internet. Still heard.", { placeholder: "title" });
s.addText("VOID-NAV · multi-hop · priority-aware · delivery-confirmed", { placeholder: "body" });
mesh.forEach(([x, y], i) => dot(s, x, y, 0.4, i === 0 ? H.accent1 : H.accent2));

(async () => { const f = path.join(__dirname, "VOID-NAV_Off-Grid_Emergency_Comms.pptx");
  await pres.writeFile({ fileName: f }); await applyTheme(f, THEME); console.log(f); })();
