import { GEO } from './geo.js';
export { GEO };
export const C0 = { lon: GEO.center[0], lat: GEO.center[1] };
export const U = 100; // metres per world unit
const kx = 111320 * Math.cos(C0.lat * Math.PI / 180) / U, kz = 110540 / U;
export const toXZ = (lat, lon) => ({ x: (lon - C0.lon) * kx, z: -(lat - C0.lat) * kz });
export const fromKm = (dxKm, dyKm) => ({ lat: C0.lat + dyKm / 110.54, lon: C0.lon + dxKm / (111.32 * Math.cos(C0.lat * Math.PI / 180)) });
export const distKm = (a, b) => Math.hypot((a.lon - b.lon) * 111.32 * Math.cos(C0.lat * Math.PI / 180), (a.lat - b.lat) * 110.54);
export const wardName = n => n.replace(/^Ward \d+ /, '');

// Contact details from public sources (hospital citizen charter / company filings / hospital listings), checked Oct 2026.
// No bed availability is shown: there is no live public source for it.
export const HOSPITALS = [
  { id: 'H1', name: 'Gandhi Hospital', type: 'Government · teaching hospital · 24×7 casualty', area: 'Padmarao Nagar, Musheerabad, Secunderabad 500003', lat: 17.4245, lon: 78.5005, phone: ['040-2750 2742', '040-2750 8388'] },
  { id: 'H2', name: 'KIMS Hospitals', type: 'Private · multispecialty', area: '1-8-31/1, Minister Road, Krishna Nagar Colony, Secunderabad 500003', lat: 17.4291, lon: 78.4882, phone: ['040-4488 5000', '040-4488 5184'] },
  { id: 'H3', name: 'Yashoda Hospitals', type: 'Private · multispecialty', area: 'Alexander Road, Kummari Guda, Secunderabad 500003', lat: 17.4410, lon: 78.4960, phone: ['040-4567 4567'] },
  { id: 'H4', name: 'Osmania General Hospital', type: 'Government · teaching hospital', area: 'Afzal Gunj, Hyderabad', lat: 17.3725, lon: 78.4747, phone: [] },
  { id: 'H5', name: 'NIMS', type: 'Government · Nizam\'s Institute of Medical Sciences', area: 'Punjagutta Road, Punjagutta, Hyderabad 500082', lat: 17.4239, lon: 78.4519, phone: ['040-2348 9000'] },
];
export const AGENCIES = [
  { name: 'GHMC Disaster Response Force', role: 'Search & rescue teams', icon: '⛑' },
  { name: 'Telangana Fire & Emergency Services', role: 'Collapse & extraction', icon: '🚒' },
  { name: '108 Ambulance Control', role: 'Ambulance dispatch', icon: '🚑' },
  { name: 'Hyderabad City Police', role: 'Cordon, traffic, evacuation', icon: '🚓' },
  { name: 'NDRF (requested via state)', role: 'Heavy rescue', icon: '🛟' },
];
// VOID-NAV network in the zone (positions as km offsets from Musheerabad centre)
const k = (dx, dy) => fromKm(dx, dy);
export const NET = [
  { id: 'GW', kind: 'gw', label: 'Command post', ...k(-0.55, 0.95) },
  { id: 'R1', kind: 'relay', ...k(0.05, 0.45) }, { id: 'R2', kind: 'relay', ...k(0.75, -0.15) },
  { id: 'R3', kind: 'relay', ...k(-0.45, -0.35) }, { id: 'R4', kind: 'relay', ...k(0.35, -0.95) },
  { id: 'N1', kind: 'node', ...k(0.25, 0.05) }, { id: 'N2', kind: 'node', ...k(1.15, -0.55) },
  { id: 'N3', kind: 'node', ...k(-0.85, -0.75) }, { id: 'N4', kind: 'node', ...k(0.85, -1.35) }, { id: 'N5', kind: 'node', ...k(-1.05, 0.15) },
];
export const RANGE_KM = 1.05;
// Scripted SOS stream (one disaster zone, few meaningful messages)
export const SCRIPT = [
  { at: 3, node: 'N1', ward: 'Musheerabad', text: 'building collapsed, 6 of us stuck in ground floor, my son is bleeding', lang: 'en', gloss: null },
  { at: 10, node: 'N3', ward: 'Bholakpur', text: 'మా అమ్మ కింద చిక్కుకుంది, గాయపడింది, సాయం చేయండి', lang: 'te', gloss: 'Our mother is trapped below and injured, please help' },
  { at: 17, node: 'N2', ward: 'Ramnagar', text: 'no water since morning, 9 people incl 3 kids', lang: 'en' },
  { at: 23, node: 'N1', ward: 'Musheerabad', text: 'हम 4 लोग फँसे हैं, दादी को सांस लेने में तकलीफ', lang: 'hi', gloss: '4 of us trapped, grandmother has difficulty breathing' },
  { at: 31, node: 'N5', ward: 'Gandhinagar', text: 'we r safe at school ground, tell family', lang: 'en' },
  { at: 38, node: 'N4', ward: 'Adikmet', text: 'stairs collapsed cant get down 2nd floor, 3 people, gas smell', lang: 'en' },
  { at: 46, node: 'N3', ward: 'Bholakpur', text: 'పిల్లలు 2 మంది చిక్కుకున్నారు, శిథిలాల కింద', lang: 'te', gloss: '2 children trapped under the rubble' },
  { at: 55, node: 'N2', ward: 'Ramnagar', text: 'old man cant walk needs insulin, 2 people', lang: 'en' },
  { at: 63, node: 'N1', ward: 'Musheerabad', text: '', lang: 'en', panic: true },
];
// keyword → field rules (multilingual, runs on the node)
export const RULES = [
  { k: ['stuck', 'trapped', 'collapsed', 'cant get down', 'చిక్కుకు', 'శిథిలాల', 'फँस', 'फंस'], set: { cat: 'TRAPPED' } },
  { k: ['bleeding', 'blood', 'injured', 'hurt', 'గాయ', 'घायल', 'खून'], set: { injured: 'YES' }, flag: 'BLEEDING' },
  { k: ['water', 'food', 'నీరు', 'पानी'], set: { cat: 'FOOD_WATER' } },
  { k: ['safe', 'सुरक्षित', 'సురక్షిత'], set: { cat: 'SAFE' } },
  { k: ['kid', 'kids', 'son', 'child', 'baby', 'పిల్ల', 'बच्चा'], flag: 'CHILD' },
  { k: ['old man', 'grandmother', 'दादी', 'అమ్మమ్మ', 'elderly', 'insulin'], flag: 'ELDERLY' },
  { k: ['breathing', 'सांस', 'insulin'], set: { cat: 'MEDICAL' }, flag: 'MEDICAL' },
  { k: ['gas'], flag: 'GAS' },
];
export const CAT = { TRAPPED: 1, INJURED: 2, MEDICAL: 3, FOOD_WATER: 4, SAFE: 5, RESCUE: 6, OTHER: 7 };
export const CAT_LABEL = { TRAPPED: 'Trapped', INJURED: 'Injured', MEDICAL: 'Medical', FOOD_WATER: 'Food / water', SAFE: 'Safe', RESCUE: 'Needs rescue', OTHER: 'Other' };
export const FLAGS = { CHILD: 1, ELDERLY: 2, BLEEDING: 4, GAS: 8, MEDICAL: 16, PANIC: 32 };
export const PRIO_LABEL = ['CRITICAL', 'URGENT', 'NEEDS', 'INFO'];
