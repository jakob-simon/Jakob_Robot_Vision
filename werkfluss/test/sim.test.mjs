#!/usr/bin/env node
/* werkfluss – Invarianten-Tests der Simulations-Engine (SPEC.md §3.10 / §3.11)
 *
 *   node werkfluss/test/sim.test.mjs [--verbose] [--hours=60] [--max-msgs=6]
 *   (env WF_SRC_DIR=<dir> lädt 00_core.js / 05_profile.js / 10_sim.js aus einem anderen Ordner)
 *
 * Unabhängig von den Interna von src/10_sim.js: geprüft wird nur der Vertrag aus SPEC.md
 * (Zustandsnamen §3.10, WF.STATE, Event/Notification §3.9, Aktionen §3.10). Wo die SPEC Feldnamen
 * offen lässt, wird tolerant gelesen (Accessor-Funktionen unten); fehlt ein Feld, gibt es eine
 * WARNUNG „cannot check … because field missing“ statt eines Fehlers. Vollständig spezifizierte
 * Invarianten (§3.11) sind harte Fehler → Exit-Code 1.
 *
 * Ablauf (ein Prozess):
 *   Lauf A  init → 60 Sim-h in 600-s-Schritten; Invarianten nach jedem Schritt und bei jedem sim:event
 *           (Zustands-Projektion nach 24 h für den Determinismus-Vergleich, Realismus-Zähler)
 *   Lauf B  init (gleicher Seed) → 24 Sim-h (identisches Aufrufmuster) → Hash-Vergleich
 *           → API-/Aktionen-Smoke (Störung, Reparatur, Quittieren, Priorität, Nachbestellung,
 *             addOrder, moveOp, connectMachine) → reset() ⇒ wieder Startzustand
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ Konfiguration
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--?([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.env.WF_SRC_DIR || path.join(HERE, '..', 'src'));
const HOURS = Math.max(36, Number(ARGS.hours || process.env.WF_TEST_HOURS || 60));
const CHUNK = 600;
const MAX_MSGS = Math.max(1, Number(ARGS['max-msgs'] || 6));
const VERBOSE = !!(ARGS.verbose || ARGS.v);
const BUDGET_MS = Number(process.env.WF_TEST_BUDGET_S || 300) * 1000;
const DAY = 86400, H = 3600, MIN = 60;

// ------------------------------------------------------------------ Test-Register
const TESTS = [];
const TB = {};
function defTest(key, no, title, opts = {}) {
  const t = { key, no, title, warnOnly: !!opts.warnOnly, checks: 0, fails: new Map(), warns: new Map(), notes: [] };
  TESTS.push(t); TB[key] = t;
}
defTest('load', 0, 'Engine loads & runs (00_core → 05_profile → 10_sim), DOM-free, init state complete');
defTest('tools', 1, 'Tool life: 0 ≤ used ≤ life; toolChanged only at partProgress 0; no unexplained swap (§3.4, §3.11.1)');
defTest('running', 2, "'running' ⇒ active op, every op tool life−used ≥ cutMinPerPart; no unattended work (§3.3, §3.11.2)");
defTest('qty', 3, 'Quantity balance per order and op (§3.11.3)');
defTest('stock', 4, 'Raw material onHand ≥ 0, AGV load ≤ maxKg, battery ∈ [0,100] (§3.6, §3.11.4)');
defTest('people', 5, 'People: ≤ 1 task, nobody works off shift (§3.5, §3.11.5)');
defTest('events', 6, 'State changes: event with from/to/cause, state ∈ WF.STATE; event/notification shape (§3.2, §3.9, §3.11.6)');
defTest('deadlock', 7, `No deadlock over ${HOURS} h: orders fertig or explainably waiting; waitOperator ≤ 4 h staffed (§3.11.7)`);
defTest('determinism', 8, 'Determinism: same seed ⇒ identical state hash after 24 h; reset reproduces start (§3.11.8)');
defTest('kpi', 9, 'KPIs numeric in [0,1], time monotonic, history consistent (§3.10, §3.11.9)');
defTest('api', 10, 'API surface & actions: views, snapshot < 12 kB, triggerFault/repair, ack/resolve, addOrder … (§3.10)');
defTest('realism', 11, 'Realism smoke over 24 h (warnings only)', { warnOnly: true });
defTest('regress', 12, 'Regression: ghost-shift advice, announced/manual tool changes, tool break only while cutting, no task outlives its op, rework on last part, chronological op chain');

function fail(key, msg, dedup) {
  const t = TB[key];
  if (t.warnOnly) return warn(key, msg, dedup);
  const k = dedup || msg, e = t.fails.get(k);
  if (e) e.n++; else t.fails.set(k, { msg, n: 1 });
}
function warn(key, msg, dedup) {
  const t = TB[key], k = dedup || msg, e = t.warns.get(k);
  if (e) e.n++; else t.warns.set(k, { msg, n: 1 });
}
const ok = (key, n = 1) => { TB[key].checks += n; };
const note = (key, msg) => { TB[key].notes.push(msg); };
const missing = (key, what) => warn(key, `cannot check ${what} because field missing`, 'missing:' + what);

// ------------------------------------------------------------------ allgemeine Helfer
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const def = (v) => v !== undefined;
const firstDef = (...vs) => { for (const v of vs) if (v !== undefined) return v; return undefined; };
const idOf = (v) => (v && typeof v === 'object') ? firstDef(v.id, v.station, v.stationId) : v;
const vals = (o) => !o ? [] : Array.isArray(o) ? o.filter(Boolean) : Object.values(o).filter(Boolean);
const keysSorted = (o) => (o && typeof o === 'object') ? Object.keys(o).sort() : [];
const errStr = (e) => (e && e.stack) ? e.stack.split('\n').slice(0, 3).map((s) => s.trim()).join(' | ') : String(e);
const f2 = (v) => num(v) ? String(Math.round(v * 100) / 100) : String(v);
const short = (v) => {
  try { const s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 90 ? s.slice(0, 87) + '...' : s); }
  catch { return String(v); }
};
const safeJSON = (v) => { try { return JSON.stringify(v); } catch { return null; } };
const tod = (t) => ((t % DAY) + DAY) % DAY;
let WF = null, SIM = null, PROFILE = null;
const clk = (t) => (WF && num(t)) ? WF.util.fmtDayClock(t) : String(t);
const at = (t) => `[${clk(t)}]`;
const dur = (s) => (WF ? WF.util.fmtDur(s) : s + ' s');
const S = () => (typeof SIM.state === 'function' ? SIM.state() : SIM.state);

// Profil-abgeleitete Konstanten (nach dem Laden gesetzt)
let MACHINE_IDS_LIST = [], MACHINE_IDS = new Set(), STATION = {}, STATE_KEYS = new Set();
let P_ORDER = {}, P_PERSON = {}, P_AGV = {}, P_MAT = {}, PLAN_AT = 2, SHIFTS = {};
let STAFF_START = 6 * H, STAFF_END = 22 * H;
const SEVS = new Set(['info', 'warn', 'crit', 'ok']);
const NSTATUS = new Set(['open', 'ack', 'resolved']);
const ROLES = new Set(['Schichtleitung', 'Einrichter', 'QS', 'Logistik', 'Instandhaltung', 'Einkauf']);
const PERSON_STATES = new Set(['idle', 'walking', 'working', 'driving', 'break', 'offShift']);
const WAIT_GROUP = new Set(['waitTool', 'waitOperator', 'starved', 'blocked']);
const ACTIVE_WORK = new Set(['running', 'setup', 'firstPiece', 'toolchange']);

// ------------------------------------------------------------------ tolerante Accessoren
// Werkzeug: used/life (SPEC §3.4 nennt used/life), Typ, Einbauort
const toolType = (t) => idOf(firstDef(t.type, t.typeId, t.toolType));
function toolLife(t) {
  let l = firstDef(t.life, t.lifeMin);
  if (l === undefined) { const tt = PROFILE.toolTypeById[toolType(t)]; if (tt) l = tt.lifeMin; }
  return l;
}
function toolUsed(t) {
  let u = firstDef(t.used, t.usedMin);
  if (u === undefined && num(t.wear)) { const l = toolLife(t); if (num(l)) u = (t.wear > 1 ? t.wear / 100 : t.wear) * l; }
  return u;
}
const TOOL_LOC_KEYS = ['machine', 'machineId', 'mountedOn', 'mounted', 'station', 'stationId', 'loc', 'location', 'at', 'where'];
const TOOL_OFF = /regrind|nachschliff|scrap|schrott|crib|ausgabe|retired|removed|stock/i;
function toolMachineOf(t) {
  for (const k of TOOL_LOC_KEYS) { const id = idOf(t[k]); if (MACHINE_IDS.has(id)) return id; }
  return null;
}
/** Montierte Werkzeuge einer Maschine: m.tools (Array von IDs/Objekten oder Map Typ→Werkzeug),
 *  m.op.tools, sonst state.tools mit Einbauort = Maschine. */
function mountedTools(st, m, mid) {
  const out = [], seen = new Set();
  const add = (x, hint) => {
    let tl = x, id = null;
    if (typeof x === 'string' || typeof x === 'number') { id = String(x); tl = st.tools ? st.tools[x] : undefined; }
    if (!tl || typeof tl !== 'object') return;
    if (id == null) id = tl.id != null ? String(tl.id) : `${mid}:${hint}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, type: toolType(tl) ?? (PROFILE.toolTypeById[hint] ? hint : undefined), tool: tl });
  };
  let known = false;
  const scan = (mt) => {
    if (Array.isArray(mt)) { known = true; mt.forEach((x, i) => add(x, String(i))); }
    else if (mt && typeof mt === 'object') { known = true; for (const k of Object.keys(mt)) add(mt[k], k); }
  };
  scan(m.tools);
  if (m.op && typeof m.op === 'object') scan(m.op.tools && m.op.tools !== m.tools && !isRoutingTools(m.op.tools) ? m.op.tools : undefined);
  if (!known && st.tools) {
    for (const id of Object.keys(st.tools)) {
      const tl = st.tools[id];
      if (!tl || typeof tl !== 'object') continue;
      if (toolMachineOf(tl) === mid && !TOOL_OFF.test(String(firstDef(tl.status, tl.state, '')))) { known = true; add(id); }
      else if (toolMachineOf(tl)) known = true; // Feld existiert → Einbauort-Darstellung bekannt
    }
  }
  return { known, list: out };
}
// Routing-Definitionen {type, cutMinPerPart} sind keine Werkzeug-Instanzen
const isRoutingTools = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => x && typeof x === 'object' && 'cutMinPerPart' in x && !('used' in x) && !('life' in x));

/** Teilefortschritt: explizites Feld, sonst aus dem Engine-Teil {rem, dur, sub} abgeleitet.
 *  Ein reserviertes Teil (auch während des Einlegens) zählt als „mitten im Teil“ (> 0); kein Teil = 0. */
function partProgress(m) {
  const v = firstDef(m.partProgress, m.progress, (m.part && typeof m.part === 'object') ? m.part.progress : undefined);
  if (v !== undefined) return v;
  if (m.part === null) return 0;
  if (m.part && typeof m.part === 'object' && num(m.part.rem) && num(m.part.dur) && m.part.dur > 0) {
    return Math.min(0.998, Math.max(0.0005, 1 - m.part.rem / m.part.dur));
  }
  return undefined;
}
/** true = mitten im Teil, false = an einer Teilegrenze, null = unbekannt */
function inPart(m, op) {
  const pp = partProgress(m);
  if (!num(pp)) return null;
  if (pp <= 0) return false;
  if (pp <= 1) return pp < 0.999;               // Anteil 0..1
  const cyc = op && op.step && num(op.step.cycleMin) ? op.step.cycleMin * 60 : null; // vermutlich Sekunden
  if (cyc && pp >= cyc * 0.97) return false;
  return true;
}
const loadingOf = (m, mid) => firstDef(m.loading, STATION[mid] && STATION[mid].loading);

function routingOf(order, oid) {
  if (order && Array.isArray(order.routing)) return order.routing;
  return (P_ORDER[oid] && P_ORDER[oid].routing) || [];
}
/** Aktueller Arbeitsgang einer Maschine (m.op als Objekt {orderId,seq}, String „FA-…/10“ oder m.orderId+m.seq). */
function opInfo(st, m) {
  let known = false, orderId, seq, raw;
  for (const k of ['op', 'job', 'currentOp']) if (m[k] !== undefined) { known = true; raw = m[k]; break; }
  if (raw && typeof raw === 'object') {
    orderId = idOf(firstDef(raw.orderId, raw.order, raw.fa, raw.oid));
    seq = firstDef(raw.seq, raw.opSeq);
    // Engine-Variante: {oid, idx} – idx = Index im Arbeitsplan
    if (seq === undefined && num(raw.idx) && orderId != null) {
      const rt = routingOf(st.orders ? st.orders[orderId] : undefined, orderId);
      if (rt[raw.idx]) seq = rt[raw.idx].seq;
    }
  } else if (typeof raw === 'string' && raw) {
    for (const oid of Object.keys(st.orders || {})) {
      if (raw.startsWith(oid)) { orderId = oid; const mm = /(\d+)\s*$/.exec(raw.slice(oid.length)); if (mm) seq = Number(mm[1]); break; }
    }
  }
  if ((orderId == null || orderId === '') && (m.orderId !== undefined || m.order !== undefined)) {
    known = true; orderId = idOf(firstDef(m.orderId, m.order)); seq = firstDef(seq, m.seq, m.opSeq);
  }
  if (orderId == null || orderId === '') return { known, active: false, key: '-' };
  const order = st.orders ? st.orders[orderId] : undefined;
  let step = routingOf(order, orderId).find((r) => String(r.seq) === String(seq));
  if (!step && raw && typeof raw === 'object' && (raw.cycleMin !== undefined || raw.tools)) step = raw;
  return { known: true, active: true, orderId: String(orderId), seq: seq != null ? Number(seq) : undefined, step, order, key: `${orderId}/${seq}` };
}
/** Arbeitsgang-Zähler eines Auftrags: o.ops{seq:{done,scrap}} (wie profile.initial.ops) / Array / in routing gemischt. */
function opsOf(o, oid) {
  const routing = routingOf(o, oid);
  const src = firstDef(o.ops, o.progress, o.opState);
  return routing.map((r, i) => {
    let rec;
    if (src && typeof src === 'object') {
      rec = Array.isArray(src) ? (src.find((x) => x && String(x.seq) === String(r.seq)) || src[i]) : firstDef(src[r.seq], src[String(r.seq)]);
    }
    if (!rec && (r.done !== undefined || r.good !== undefined)) rec = r;
    const done = rec ? firstDef(rec.done, rec.good, rec.qtyGood) : undefined;
    const scrap = rec ? firstDef(rec.scrap, rec.bad, rec.qtyScrap) : undefined;
    return { seq: r.seq, station: firstDef(rec && rec.station, r.station), step: r, rec, done, scrap };
  });
}
function opCount(st, op) {
  const o = op.order || (st.orders && st.orders[op.orderId]);
  if (!o) return undefined;
  const x = opsOf(o, op.orderId).find((y) => String(y.seq) === String(op.seq));
  if (!x || !num(x.done)) return undefined;
  return x.done + (num(x.scrap) ? x.scrap : 0);
}
const ORDER_DONE_ALT = /^(done|completed|complete|shipped|versandt|abgeschlossen)$/i;
function isDone(o) {
  if (o.status === 'fertig') return true;
  if (ORDER_DONE_ALT.test(String(o.status || ''))) { warn('deadlock', `order status '${o.status}' treated as finished – SPEC/task expects 'fertig'`, 'stname:' + o.status); return true; }
  return false;
}

// Behälter
const cOrder = (c) => idOf(firstDef(c.orderId, c.order, c.fa));
const cQty = (c) => firstDef(c.qty, c.count, c.n, c.parts, c.quantity);
const cLoc = (c) => idOf(firstDef(c.station, c.at, c.loc, c.location, c.where, c.stationId));
const isBarContainer = (c) => /bar|stange/i.test(String(firstDef(c.kind, c.type, ''))) || c.unit === 'm';
const cIsScrap = (c) => c.scrap === true || /scrap|sperr|ausschuss|reject/i.test(String(firstDef(c.kind, c.type, '')) + ' ' + String(firstDef(c.status, c.state, ''))) || cLoc(c) === 'SPERR';
const isExtLoc = (loc) => loc === 'EXT' || /extern|härt|haert|partner|fremd|outside/i.test(String(loc || ''));
const trContainer = (tr) => idOf(firstDef(tr.containerId, tr.container));
const trTo = (tr) => idOf(tr.to);
const trMode = (tr) => { const m = String(tr.mode || ''); return /agv/i.test(m) ? 'AGV' : /stapler|fork/i.test(m) ? 'Stapler' : m; };
function containerKg(st, c) {
  if (!c || c.__missing) return undefined;
  const w = firstDef(c.weightKg, c.kg, c.weight);
  if (num(w)) return w;
  const q = cQty(c), oid = cOrder(c);
  const o = (st.orders && st.orders[oid]) || P_ORDER[oid];
  const pw = o && o.part && o.part.weightKg;
  return num(q) && num(pw) ? q * pw : undefined;
}
function agvLoads(st, a) {
  const v = firstDef(a.load, a.cargo, a.container);
  if (v == null || v === false || v === '') return [];
  return (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === 'object') ? x : ((st.containers && st.containers[x]) || { __missing: x }));
}

// Personen / Aufgaben
const objIds = new WeakMap(); let objSeq = 0;
function taskOf(st, p) {
  const v = firstDef(p.task, p.job);
  if (v == null || v === false || v === '') return null;
  if (typeof v === 'object') return v;
  return (st.tasks && st.tasks[v]) || { id: v };
}
function taskKeyOf(p) {
  const v = firstDef(p.task, p.job);
  if (v == null || v === false || v === '') return null;
  if (typeof v !== 'object') return String(v);
  if (v.id != null) return String(v.id);
  if (!objIds.has(v)) objIds.set(v, 'task#' + (++objSeq));
  return objIds.get(v);
}
const taskTypeOf = (tk) => tk ? String(firstDef(tk.type, tk.kind, '')) : '';
const taskStationOf = (tk) => tk ? idOf(firstDef(tk.machine, tk.machineId, tk.station, tk.stationId, tk.target, tk.at)) : undefined;
const skillsOf = (p, pid) => firstDef(p.skills, P_PERSON[pid] && P_PERSON[pid].skills) || [];
const shiftOf = (p, pid) => firstDef(p.shift, P_PERSON[pid] && P_PERSON[pid].shift);
function qualified(skills, tk, pid) {
  const type = taskTypeOf(tk).toLowerCase(), sk = new Set(skills);
  const sid = taskStationOf(tk), stn = STATION[sid], own = !!(stn && stn.skill && sk.has(stn.skill));
  const assigned = !!(pid && P_PERSON[pid] && (P_PERSON[pid].machines || []).includes(sid));
  switch (type) {
    case 'setup': case 'correction': case 'load': return sk.has('setup') || own;
    // Wendeplatte/Werkzeug an der eigenen Maschine wechseln darf auch der dafür qualifizierte Stammbediener
    case 'toolchange': return sk.has('toolchange') || sk.has('setup') || (own && assigned);
    // Kontrolle des ersten Teils nach Formwerkzeug-Wechsel (fpi local) darf der Bediener/Einrichter an der Maschine machen
    case 'fpi': return sk.has('qs') || (!!(tk && tk.data && tk.data.local) && (own || sk.has('setup')));
    case 'inspect': return sk.has('qs');
    case 'repair': return sk.has('repair');
    case 'forklift': case 'bars': return sk.has('forklift');
    case 'assembly': return sk.has('assembly');
    default: return null;
  }
}

/** Besetzte Zeit (Mo–Fr, frühester Schichtbeginn bis spätestes Schichtende) im Intervall [a,b]. */
function staffedOverlap(a, b) {
  let s = 0;
  if (!(b > a)) return 0;
  for (let d = Math.floor(a / DAY); d * DAY < b; d++) {
    if (d % 7 >= 5) continue;
    const w0 = d * DAY + STAFF_START, w1 = d * DAY + STAFF_END;
    s += Math.max(0, Math.min(b, w1) - Math.max(a, w0));
  }
  return s;
}
/** Zeitfenster, in dem eine Person der Schicht `sid` sicher nicht mehr (noch nicht) in der Halle sein darf. */
function offWindow(sid, t) {
  const sh = SHIFTS[sid];
  if (!sh) return { inOff: false };
  const x = tod(t), ds = t - x;
  const grace = 45 * MIN, early = 60;               // 45 min nach Schichtende … 1 min vor Frühschicht-Beginn
  const firstStart = STAFF_START;
  const inOff = x >= sh.end + grace || x < firstStart - early;
  const shiftEnd = x >= sh.end ? ds + sh.end : ds - DAY + sh.end;
  return { inOff, shiftEnd };
}
const inBreak = (sid, t) => { const sh = SHIFTS[sid]; const x = tod(t); return !!sh && sh.breaks.some(([a, b]) => x >= a && x < b); };
const expectedShift = (t) => { const x = tod(t); for (const id in SHIFTS) if (x >= SHIFTS[id].start && x < SHIFTS[id].end) return id; return null; };
const nearBoundary = (t) => { const x = tod(t); for (const id in SHIFTS) { const sh = SHIFTS[id]; for (const b of [sh.start, sh.end, ...sh.breaks.flat()]) if (Math.abs(x - b) <= 60) return true; } return false; };

// ------------------------------------------------------------------ Laden (Node, ohne DOM)
const nonDet = { random: 0, dateNow: 0, inSim: false };
let simSource = '';
function installNonDetCounters() {
  const realRandom = Math.random;
  Math.random = function () { if (nonDet.inSim) nonDet.random++; return realRandom(); };
  const realNow = Date.now;
  Date.now = function () { if (nonDet.inSim) nonDet.dateNow++; return realNow(); };
}
function loadEngine() {
  globalThis.window = undefined;
  for (const f of ['00_core.js', '05_profile.js', '10_sim.js']) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) { fail('load', `missing source file ${p}`); return false; }
    const code = fs.readFileSync(p, 'utf8');
    if (f === '10_sim.js') simSource = code;
    try { vm.runInThisContext(code, { filename: p }); }
    catch (e) { fail('load', `${f} throws while loading in Node: ${errStr(e)}`); return false; }
  }
  WF = globalThis.WF;
  if (!WF || !WF.util || !WF.bus || !WF.STATE || !WF.profile) { fail('load', 'WF.util / WF.bus / WF.STATE / WF.profile missing after loading'); return false; }
  SIM = WF.sim; PROFILE = WF.profile;
  if (!SIM || typeof SIM.init !== 'function' || typeof SIM.advance !== 'function') {
    fail('load', `WF.sim with init()/advance() missing (WF.sim = ${short(SIM && Object.keys(SIM))})`); return false;
  }
  ok('load');
  // DOM-frei (SPEC §1/§3): statischer Blick auf den Quelltext ohne Kommentare
  const code = simSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const dom = [/\bdocument\s*\./, /\brequestAnimationFrame\s*\(/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bwindow\s*\.\s*(addEventListener|innerWidth|location|setTimeout|setInterval)\b/]
    .filter((r) => r.test(code)).map((r) => r.source);
  if (dom.length) fail('load', `10_sim.js must be DOM-free but uses: ${dom.join(', ')}`);
  else ok('load');
  if (/\bMath\.random\s*\(/.test(code)) warn('determinism', '10_sim.js calls Math.random() – SPEC: all randomness through the seeded WF.util.rng');
  if (/\b(Date\.now|performance\.now)\s*\(/.test(code)) warn('determinism', '10_sim.js reads wall-clock time (Date.now/performance.now) – must not influence state');
  // API-Oberfläche (§3.10)
  for (const fn of ['clock', 'shift', 'machineView', 'orderView', 'forecast', 'kpis', 'snapshot']) {
    if (typeof SIM[fn] !== 'function') fail('api', `WF.sim.${fn}() missing`); else ok('api');
  }
  const A = SIM.actions || {};
  for (const fn of ['triggerFault', 'repair', 'ack', 'resolve', 'reorder', 'setPriority', 'addOrder', 'moveOp', 'connectMachine', 'reset']) {
    if (typeof A[fn] !== 'function') fail('api', `WF.sim.actions.${fn}() missing`); else ok('api');
  }
  // Profil-Konstanten
  MACHINE_IDS_LIST = PROFILE.machines.slice();
  MACHINE_IDS = new Set(MACHINE_IDS_LIST);
  STATION = PROFILE.stationById || Object.fromEntries(PROFILE.stations.map((s) => [s.id, s]));
  STATE_KEYS = new Set(Object.keys(WF.STATE));
  P_ORDER = Object.fromEntries(PROFILE.orders.map((o) => [o.id, o]));
  P_PERSON = Object.fromEntries(PROFILE.people.map((p) => [p.id, p]));
  P_AGV = Object.fromEntries(PROFILE.agvs.map((a) => [a.id, a]));
  P_MAT = Object.fromEntries(PROFILE.materials.map((m) => [m.id, m]));
  PLAN_AT = (PROFILE.sim && PROFILE.sim.toolPolicy && PROFILE.sim.toolPolicy.planAtParts) ?? 2;
  const hm = WF.util.hm;
  SHIFTS = Object.fromEntries(PROFILE.shifts.map((s) => [s.id, { start: hm(s.start), end: hm(s.end), breaks: (s.breaks || []).map(([a, b]) => [hm(a), hm(b)]) }]));
  STAFF_START = Math.min(...Object.values(SHIFTS).map((s) => s.start));
  STAFF_END = Math.max(...Object.values(SHIFTS).map((s) => s.end));
  return true;
}

/** Engine-Aufruf mit Ausnahme-Behandlung; zählt Math.random/Date.now während der Engine läuft. */
function simCall(label, fn) {
  nonDet.inSim = true;
  try { fn(); return true; }
  catch (e) { fail('load', `${at(SIM && SIM.state && S().t)} WF.sim.${label} threw: ${errStr(e)}`, 'throw:' + label + ':' + String(e && e.message)); return false; }
  finally { nonDet.inSim = false; }
}
function guard(label, fn) {
  try { return fn(); }
  catch (e) { warn('load', `test suite could not evaluate ${label} (unexpected state shape?): ${errStr(e)}`, 'guard:' + label + ':' + String(e && e.message)); return undefined; }
}

// ------------------------------------------------------------------ Lauf-Kontext
let CUR = null;
let RESETS = 0;
function newCtx(name) {
  return {
    name, active: true, t0: null, lastT: null, lastEvT: -Infinity, nEvents: 0, nStateEvents: 0, typeCounts: {},
    initState: {}, lastTo: {}, curState: {}, enterT: {}, chunkSeg: {}, flap: {},
    obs: {}, toolLast: {}, markT: {}, lastFaultT: {}, lastSetupT: {}, lastPlannedT: {}, plannedTool: {},
    personTask: {}, lastObsT: {}, lastTaskSeen: {}, qualChecked: new Set(),
    prevOps: {}, doneChecked: {}, orderSig: {}, orderProgT: {}, machProgT: {}, contSig: {},
    night: {}, trSeen: new Map(), trEvents: { AGV: 0, Stapler: 0 }, extSeen: new Set(), extReturned: new Set(),
    count: { toolChanged: 0, toolPlanned: 0, setup: 0, fpi: 0, fault: 0 },
    stateSamples: {}, staffedSamples: {}, ghostRun: 0, notifSeen: new Set(), notifyLog: [], watchDelivery: null,
    seenFertig: new Set(), r24: null,
  };
}

function onSimEvent(e) {
  const ctx = CUR;
  if (!ctx || !ctx.active) return;
  try { handleEvent(ctx, e); }
  catch (err) { warn('load', `test suite error in sim:event handler: ${errStr(err)}`, 'evh:' + String(err && err.message)); }
}
function machineOfEvent(st, e) {
  const en = e.entity || {}, d = e.data || {};
  if (MACHINE_IDS.has(en.id)) return en.id;
  for (const k of ['machine', 'machineId', 'station', 'stationId', 'mid']) { const v = idOf(d[k]); if (MACHINE_IDS.has(v)) return v; }
  for (const k of ['tool', 'toolId', 'newTool', 'oldTool', 'old', 'new']) {
    const v = d[k]; const tl = (v && typeof v === 'object') ? v : (st.tools && st.tools[v]);
    const mm = tl && toolMachineOf(tl); if (mm) return mm;
  }
  if (en.kind === 'tool') {
    if (st.tools && st.tools[en.id]) { const mm = toolMachineOf(st.tools[en.id]); if (mm) return mm; }
    for (const mid of MACHINE_IDS_LIST) { const m = st.machines[mid]; if (m && mountedTools(st, m, mid).list.some((x) => x.id === String(en.id))) return mid; }
  }
  return null;
}
function handleEvent(ctx, e) {
  ctx.nEvents++;
  const st = S();
  if (!e || typeof e !== 'object') { fail('events', `sim:event payload is not an object: ${short(e)}`, 'evobj'); return; }
  const t = num(e.t) ? e.t : (st && num(st.t) ? st.t : NaN);
  if (e.id == null) fail('events', `${at(t)} event '${e.type}' without id (§3.9)`, 'evid');
  if (!num(e.t)) fail('events', `event '${e.type}' without numeric t (§3.9)`, 'evt');
  else {
    if (e.t < ctx.lastEvT - 1e-9) fail('events', `${at(e.t)} event time went backwards (${clk(ctx.lastEvT)} → ${clk(e.t)}, type ${e.type})`, 'evback');
    if (st && num(st.t) && e.t > st.t + 1.0001) fail('events', `${at(e.t)} event '${e.type}' stamped in the future (state.t ${clk(st.t)})`, 'evfut');
    ctx.lastEvT = Math.max(ctx.lastEvT, e.t);
  }
  if (typeof e.type !== 'string' || !e.type) fail('events', `${at(t)} event without type (§3.9)`, 'evtype');
  if (!SEVS.has(e.sev)) fail('events', `${at(t)} event '${e.type}' has sev '${e.sev}' (must be info|warn|crit|ok)`, 'evsev:' + e.type);
  if (typeof e.msg !== 'string' || !e.msg.trim()) warn('events', `event type '${e.type}' has an empty msg`, 'evmsg:' + e.type);
  if (!e.entity || typeof e.entity !== 'object') warn('events', `event type '${e.type}' has no entity {kind,id}`, 'event:' + e.type);
  ok('events');
  const type = String(e.type || '');
  ctx.typeCounts[type] = (ctx.typeCounts[type] || 0) + 1;
  if (!st || !st.machines || !num(st.t)) return;           // init läuft noch
  const mid = machineOfEvent(st, e);
  if (type === 'state') onStateEvent(ctx, e, st, t);
  else if (type === 'toolChanged') { ctx.markT[mid || '*'] = t; onToolChanged(ctx, e, st, t, mid); }
  else if (type === 'toolPlanned') { ctx.count.toolPlanned++; if (mid) ctx.lastPlannedT[mid] = t; if (e.data && e.data.toolId) ctx.plannedTool[e.data.toolId] = t; }
  if (type !== 'state' && /fault|störung|alarm|toolbreak|bruch/i.test(type) && mid) { ctx.lastFaultT[mid] = t; ctx.markT[mid] = t; }
  if (type !== 'state' && /setup|rüst/i.test(type) && mid) { ctx.lastSetupT[mid] = t; ctx.markT[mid] = t; }
  if (/transport|deliver|drop|pickup|abgel/i.test(type) && e.data) { const md = trMode(e.data); if (md === 'AGV' || md === 'Stapler') ctx.trEvents[md]++; }
  if (/^ext|extern|härter|return/i.test(type) && /in|back|return|zurück|rück/i.test(type + ' ' + (e.msg || ''))) ctx.extReturned.add('ev:' + e.id);
  if (ctx.watchDelivery && /deliver|liefer|wareneingang|reorderArrived/i.test(type)) ctx.watchDelivery.eventT = ctx.watchDelivery.eventT ?? t;
  guard('tool range at event', () => checkToolRange(st, t, `at event '${type}'`));
  guard('tool observation', () => updateToolObs(ctx, st, t));
  guard('people task tracking', () => { for (const pid of Object.keys(st.people || {})) trackTask(ctx, st.people[pid], pid, t); });
  guard('transport sampling', () => sampleTransports(ctx, st));
}

function onStateEvent(ctx, e, st, t) {
  const en = e.entity || {};
  const mid = MACHINE_IDS.has(en.id) ? en.id : null;
  if (!mid) return;                                            // z. B. AGV-/Personen-Zustände
  ctx.nStateEvents++;
  const d = e.data || {}, where = `${at(t)} ${mid}`;
  if (d.from === undefined) fail('events', `${where}: state event without data.from`, 'nofrom:' + mid);
  if (!d.to) fail('events', `${where}: state event without data.to`, 'noto:' + mid);
  if (d.to && !STATE_KEYS.has(d.to)) fail('events', `${where}: data.to '${d.to}' is not a WF.STATE key`, 'badto:' + d.to);
  if (d.from != null && !STATE_KEYS.has(d.from)) fail('events', `${where}: data.from '${d.from}' is not a WF.STATE key`, 'badfrom:' + d.from);
  if (typeof d.cause !== 'string' || !d.cause.trim()) fail('events', `${where}: state event ${d.from}→${d.to} has no data.cause (every change needs a visible cause)`, 'nocause:' + mid + ':' + d.to);
  else if (d.cause.trim().length < 4) warn('events', `${where}: state cause '${d.cause}' is not an explanation`, 'shortcause:' + d.cause);
  if (d.from !== undefined && d.from === d.to) warn('events', `${where}: self-transition ${d.from}→${d.to} ("${d.cause}")`, 'self:' + mid + ':' + d.to);
  const prev = ctx.lastTo[mid] !== undefined ? ctx.lastTo[mid] : ctx.initState[mid];
  if (prev !== undefined && d.from !== undefined && d.from !== prev) {
    fail('events', `${where}: state event says from '${d.from}' but the machine was '${prev}' – a state change happened without event`, 'chain:' + mid);
  }
  // Segment schließen (Wartezeiten für Test 7)
  const prevState = ctx.curState[mid], t0 = ctx.enterT[mid];
  if (prevState !== undefined && num(t0)) checkSegment(mid, prevState, t0, t, false);
  ctx.lastTo[mid] = d.to; ctx.curState[mid] = d.to; ctx.enterT[mid] = t;
  if (d.to === 'setup') { ctx.count.setup++; ctx.lastSetupT[mid] = t; }
  if (d.to === 'firstPiece') ctx.count.fpi++;
  if (d.to === 'fault') { ctx.count.fault++; ctx.lastFaultT[mid] = t; }
  if (d.to === 'setup' || d.to === 'toolchange' || d.to === 'fault' || d.from === 'fault') ctx.markT[mid] = t;
  // Flattern: > 30 Zustandswechsel einer Maschine in einer Sim-Stunde
  const hk = mid + ':' + Math.floor(t / H);
  ctx.flap[hk] = (ctx.flap[hk] || 0) + 1;
  if (ctx.flap[hk] === 31) warn('events', `${where}: more than 30 state changes within one sim hour (flapping – senseless sequence?)`, 'flap:' + mid);
  // Beim Teilestart muss die Standzeit reichen
  if (d.to === 'running') guard('running at state event', () => {
    const m = st.machines[mid]; if (!m) return;
    const op = opInfo(st, m); if (!op.active || !op.step) return;
    const ot = opTools(st, m, mid, op); if (!ot) return;
    for (const [ty, best] of bestByType(ot.items)) {
      if (num(best.rest) && best.rest < best.cut - 1e-9) fail('running', `${where}: switches to 'running' (${op.key}) although tool ${best.id} (${ty}) has only ${f2(best.rest)} min life < cutMinPerPart ${best.cut}`, 'startlife:' + mid + ty);
    }
  });
}

function onSimNotify(n) {
  const ctx = CUR;
  if (!ctx) return;
  try {
    ctx.notifyLog.push(n);
    if (ctx.notifyLog.length > 400) ctx.notifyLog.splice(0, 200);
    checkNotificationShape(n);
  } catch (err) { warn('load', `test suite error in sim:notify handler: ${errStr(err)}`, 'nh:' + String(err && err.message)); }
}
function checkNotificationShape(n) {
  if (!n || typeof n !== 'object') { fail('events', `notification is not an object: ${short(n)}`, 'nobj'); return; }
  const id = `${at(n.t)} ${n.key || n.id}`;
  if (!SEVS.has(n.sev)) fail('events', `notification ${id} has sev '${n.sev}' (info|warn|crit|ok)`, 'nsev:' + n.sev);
  if (!NSTATUS.has(n.status)) fail('events', `notification ${id} has status '${n.status}' (open|ack|resolved)`, 'nstat:' + n.status);
  if (n.id == null) fail('events', `notification without id: ${short(n)}`, 'nid');
  if (!n.title) warn('events', 'notification without title', 'ntitle');
  if (n.key == null) warn('events', 'notification without key (SPEC: dedup via key)', 'nkey');
  if (n.role != null && !ROLES.has(n.role)) warn('events', `notification role '${n.role}' not in SPEC list (${[...ROLES].join('|')})`, 'nrole:' + n.role);
  ok('events');
}

// ------------------------------------------------------------------ Test 1/2: Werkzeuge und 'running'
const pctStr = (u, l) => (num(u) && num(l) && l > 0) ? (u / l * 100).toFixed(1) + ' %' : '?';
function checkToolRange(st, t, origin) {
  if (!st.tools) { missing('tools', 'state.tools'); return; }
  for (const id of Object.keys(st.tools)) {
    const tl = st.tools[id];
    if (!tl || typeof tl !== 'object') continue;
    const u = toolUsed(tl), l = toolLife(tl);
    if (!num(u) || !num(l)) { missing('tools', 'tool.used / tool.life'); continue; }
    ok('tools');
    if (u < -1e-9 || u > l + 1e-9) {
      const mm = toolMachineOf(tl);
      fail('tools', `${at(t)} tool ${id} (${toolType(tl)}${mm ? ' in ' + mm : ''}) used=${f2(u)} life=${f2(l)} → wear ${pctStr(u, l)} outside [0,100] % (${origin})`, 'range:' + id);
    }
  }
}
/** Werkzeuge des aktuellen Arbeitsgangs: je Routing-Werkzeug der montierte Kandidat mit Reststandzeit. */
function opTools(st, m, mid, op) {
  const step = op.step;
  if (!step) return null;
  const req = Array.isArray(step.tools) ? step.tools.filter((r) => r && r.type) : [];
  if (!req.length) return { req, items: [], missingTypes: [] };
  const mt = mountedTools(st, m, mid);
  if (!mt.known) return null;
  const items = [], missingTypes = [];
  for (const r of req) {
    const cands = mt.list.filter((x) => x.type === r.type);
    if (!cands.length) { missingTypes.push(r.type); continue; }
    for (const c of cands) {
      const u = toolUsed(c.tool), l = toolLife(c.tool);
      const cut = num(c.tool.cutMinPerPart) ? c.tool.cutMinPerPart : r.cutMinPerPart;
      items.push({ ...c, cut, used: u, life: l, rest: num(u) && num(l) ? l - u : undefined });
    }
  }
  return { req, items, missingTypes };
}
function bestByType(items) {
  const best = new Map();
  for (const it of items) {
    const b = best.get(it.type);
    if (!b || (num(it.rest) && (!num(b.rest) || it.rest > b.rest))) best.set(it.type, it);
  }
  return best;
}
/** Letzter Stand der Werkzeuge je Maschine VOR einem Wechsel (eingefroren in toolchange/setup). */
function updateToolObs(ctx, st, t) {
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines[mid];
    if (!m || m.state === 'toolchange' || m.state === 'setup') continue;
    const op = opInfo(st, m);
    if (!op.active || !op.step) { ctx.obs[mid] = null; continue; }
    const ot = opTools(st, m, mid, op);
    if (!ot) continue;
    ctx.obs[mid] = { t, opKey: op.key, tools: ot.items.map((x) => ({ id: x.id, type: x.type, used: x.used, life: x.life })) };
  }
}
function onToolChanged(ctx, e, st, t, mid) {
  ctx.count.toolChanged++;
  if (!mid) { warn('tools', `cannot check toolChanged/partProgress because the event does not identify the machine (entity ${short(e.entity)}, data ${short(e.data)})`, 'tcmid'); return; }
  const m = st.machines[mid];
  const pp = partProgress(m);
  if (pp === undefined) missing('tools', 'machine.partProgress');
  else {
    ok('tools');
    if (pp !== 0) fail('tools', `${at(t)} toolChanged on ${mid} while partProgress = ${f2(pp)} (state ${m.state}) – tool changed in the middle of a part`, 'tcpp:' + mid);
  }
  const d = e.data || {};
  const cause = firstDef(d.cause, d.reason, d.grund);
  if (!(typeof cause === 'string' && cause.trim())) warn('tools', "toolChanged events carry no data.cause/reason (SPEC §3.4: 'Event toolChanged mit Grund')", 'tccause');
  checkChangeWasDue(ctx, st, m, mid, e, t);
}
/** Der Kern der Nutzer-Forderung: ein Werkzeug wird nur getauscht, wenn remainingParts ≤ planAtParts
 *  (oder Bruch/Rüsten). Konservativ: zwischen letzter Beobachtung und Wechsel gefertigte Teile werden abgezogen. */
function checkChangeWasDue(ctx, st, m, mid, e, t) {
  const pre = ctx.obs[mid];
  if (!pre) return;
  const op = opInfo(st, m);
  if (!op.active || op.key !== pre.opKey || !op.step) return;                    // Auftragswechsel → Rüsten
  if (m.state === 'setup' || (ctx.lastSetupT[mid] ?? -Infinity) >= pre.t) return;
  if ((ctx.lastFaultT[mid] ?? -Infinity) >= pre.t - 3 * H || m.state === 'fault') return;   // Bruch / Störung
  const d = e.data || {};
  // Jedes getauschte Werkzeug muss vorher angekündigt sein (Ereignis toolPlanned für genau dieses Werkzeug) – sonst
  // „zeigt 65 %, dann plötzlich getauscht“ (Regression: Mitwechseln ohne Ankündigung)
  if (Array.isArray(d.tools)) for (const x of d.tools) {
    if (!x || !x.oldToolId || /bruch/i.test(String(x.reason || ''))) continue;
    ok('tools');
    if (!(num(ctx.plannedTool[x.oldToolId]) && ctx.plannedTool[x.oldToolId] <= t)) fail('tools', `${at(t)} ${mid}: tool ${x.oldToolId} (${x.typeId}) swapped (${x.reason}) without a preceding toolPlanned event for this tool – unannounced swap`, 'unannounced:' + mid + ':' + x.typeId);
  }
  if (d.toolBreak || /bruch|break/i.test(String(firstDef(d.cause, d.reason, '')) + ' ' + String(e.msg || ''))) return;
  const cur = opTools(st, m, mid, op);
  if (!cur) return;
  const tEnd = ctx.curState[mid] === 'toolchange' && num(ctx.enterT[mid]) ? ctx.enterT[mid] : t;
  const cyc = Math.max(1, (num(op.step.cycleMin) ? op.step.cycleMin : 1) * 60 * 0.97);
  const maxParts = Math.ceil(Math.max(0, tEnd - pre.t) / cyc) + 1;
  for (const p of pre.tools) {
    const same = cur.items.find((x) => x.type === p.type && x.id === p.id);
    const replaced = !same || (num(same.used) && num(p.used) && same.used < p.used - 1e-9);
    if (!replaced) continue;
    const req = (op.step.tools || []).find((r) => r.type === p.type);
    if (!req || !num(req.cutMinPerPart) || !num(p.used) || !num(p.life)) continue;
    const remPre = Math.floor((p.life - p.used) / req.cutMinPerPart + 1e-9);
    ok('tools');
    // angekündigtes Mitwechseln (≤ 25 % Reststandzeit, zweiter Stopp vermieden) bzw. beauftragter vorbeugender Wechsel ist erklärt
    const rec = Array.isArray(d.tools) ? d.tools.find((x) => x && x.oldToolId === p.id) : null;
    const announced = rec && num(ctx.plannedTool[p.id]);
    if (announced && rec.manual) continue;
    if (announced && rec.bundled) {
      if (num(rec.wearPct) && rec.wearPct < 60) fail('tools', `${at(t)} ${mid}: tool ${p.id} (${p.type}) 'mitgewechselt' at only ${rec.wearPct} % wear (rule: ≤ 35 % remaining life)`, 'bundlewaste:' + mid + ':' + p.type);
      continue;
    }
    if (remPre - maxParts > PLAN_AT) {
      fail('tools', `${at(t)} ${mid}: tool ${p.id} (${p.type}) swapped while it still had ≥ ${remPre - maxParts} parts of life (wear ${pctStr(p.used, p.life)} at ${clk(pre.t)}; rule: change when remainingParts ≤ ${PLAN_AT}) – no fault/setup explains it`, 'early:' + mid + ':' + p.type);
    }
    if ((ctx.lastPlannedT[mid] ?? -Infinity) < t - 12 * H) warn('tools', `${mid}: tool ${p.type} changed without a preceding 'toolPlanned' event for the machine (SPEC §3.4)`, 'noplan:' + mid);
  }
}
/** Verschleiß eines eingebauten Werkzeugs sinkt nur mit erklärendem Ereignis (toolChanged / Rüsten / Störung). */
function checkToolDecrease(ctx, st, t) {
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines[mid];
    if (!m) continue;
    for (const x of mountedTools(st, m, mid).list) {
      const u = toolUsed(x.tool), l = toolLife(x.tool);
      if (!num(u)) continue;
      const last = ctx.toolLast[x.id];
      const mark = Math.max(ctx.markT[mid] ?? -Infinity, ctx.markT['*'] ?? -Infinity);
      if (last && last.mid === mid && u < last.used - 1e-9 && !(mark >= last.t)) {
        fail('tools', `${at(t)} ${mid}: tool ${x.id} (${x.type}) wear dropped ${pctStr(last.used, l)} → ${pctStr(u, l)} without toolChanged/setup/fault event – silent swap`, 'silent:' + mid + ':' + x.type);
      }
      ctx.toolLast[x.id] = { used: u, t, mid };
    }
  }
}

function checkMachines(ctx, st, t) {
  if (!st.machines || Array.isArray(st.machines)) { fail('load', 'state.machines must be an object keyed by machine id (§3.10)', 'machobj'); return; }
  const people = vals(st.people);
  const allOff = people.length > 0 && people.every((p) => p.state === 'offShift');
  const anyTaskStation = people.some((p) => taskStationOf(taskOf(st, p)) !== undefined);
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines[mid];
    if (!m) { fail('events', `${at(t)} machine ${mid} (profile.machines) missing in state.machines`, 'nom:' + mid); continue; }
    ok('events');
    if (!STATE_KEYS.has(m.state)) fail('events', `${at(t)} ${mid}: machine.state '${m.state}' is not a WF.STATE key`, 'badstate:' + mid);
    const exp = ctx.lastTo[mid] !== undefined ? ctx.lastTo[mid] : ctx.initState[mid];
    if (exp !== undefined && m.state !== exp) {
      if (ctx.nStateEvents === 0) fail('events', `${at(t)} machine states change (e.g. ${mid}: ${exp} → ${m.state}) but no 'state' events are emitted at all`, 'nostateevents');
      else fail('events', `${at(t)} ${mid}: machine.state = '${m.state}' but its last state event ended in '${exp}' – state changed without a 'state' event`, 'silent:' + mid);
      ctx.lastTo[mid] = m.state;                                  // nur einmal je Abweichung melden
    }
    if (ctx.nStateEvents === 0) {                                  // Ersatz-Segmente aus Stichproben
      const cs = ctx.chunkSeg[mid];
      if (!cs || cs.state !== m.state) { if (cs) checkSegment(mid, cs.state, cs.t0, t, false); ctx.chunkSeg[mid] = { state: m.state, t0: t }; }
    }
    const op = opInfo(st, m);
    if (m.state === 'running') {
      ok('running');
      if (!op.known) missing('running', 'machine.op (current operation)');
      else if (!op.active) fail('running', `${at(t)} ${mid} is 'running' without an active op (m.op = ${short(m.op)})`, 'noop:' + mid);
      else if (!op.step) warn('running', `cannot resolve the routing step of ${mid} op ${short(m.op)}`, 'nostep:' + mid);
      else {
        const ot = opTools(st, m, mid, op);
        if (!ot) { if ((op.step.tools || []).length) missing('running', 'mounted tools (machine.tools or tool.machine)'); }
        else {
          for (const ty of ot.missingTypes) fail('running', `${at(t)} ${mid} is running ${op.key} without a mounted tool of type ${ty}`, 'nomount:' + mid + ty);
          if (inPart(m, op) !== false) {
            // ein gebrochenes Werkzeug schneidet nie (Werkzeugbruch nur während der Bearbeitung → Teil Ausschuss, Wechsel)
            const cutting = !(m.part && typeof m.part === 'object' && m.part.sub === 'load');
            for (const it of ot.items) if (cutting && it.tool && it.tool.broken) fail('running', `${at(t)} ${mid} running ${op.key} with broken tool ${it.id} (${it.type})`, 'broken:' + mid + it.type);
            for (const [ty, best] of bestByType(ot.items)) {
              if (!num(best.rest) || !num(best.cut)) { missing('running', 'tool used/life or cutMinPerPart'); continue; }
              ok('running');
              if (best.rest < best.cut - 1e-9) fail('running', `${at(t)} ${mid} running ${op.key}: tool ${best.id} (${ty}) has ${f2(best.rest)} min life left < cutMinPerPart ${best.cut} (used ${f2(best.used)}/${f2(best.life)}, partProgress ${f2(partProgress(m))})`, 'life:' + mid + ty);
            }
          }
        }
      }
      if (loadingOf(m, mid) === 'attended') {
        if (allOff) fail('running', `${at(t)} ${mid} (loading 'attended') is running although nobody is in the hall`, 'att:' + mid);
        else if (anyTaskStation && !people.some((p) => p.state === 'working' && taskStationOf(taskOf(st, p)) === mid)) warn('running', `${at(t)} ${mid} (loading 'attended') running without a person working at it`, 'att2:' + mid);
      }
    }
    if (allOff && (m.state === 'setup' || m.state === 'toolchange')) fail('running', `${at(t)} ${mid} is in '${m.state}' although nobody is in the hall (needs a person)`, 'nobody:' + mid + m.state);
    if (m.state === 'waitTool' && op.active && op.step) {
      const ot = opTools(st, m, mid, op);
      const broken = ot && ot.items.some((x) => x.tool.broken || /bruch|broken|defekt|defect/i.test(String(firstDef(x.tool.status, x.tool.state, ''))));
      if (ot && ot.items.length && !ot.missingTypes.length && !broken) {
        const best = [...bestByType(ot.items).values()];
        if (best.every((b) => num(b.rest) && num(b.cut) && b.rest >= b.cut - 1e-9)) {
          fail('running', `${at(t)} ${mid} is 'waitTool' but every tool of ${op.key} has enough life (${best.map((b) => `${b.type} ${f2(b.rest)}≥${b.cut}`).join(', ')}) – state without cause`, 'wtc:' + mid);
        }
      }
    }
    // perPart-Maschinen fertigen ohne Bediener höchstens das laufende Teil fertig
    if (loadingOf(m, mid) === 'perPart' && op.active) {
      if (allOff) {
        const cnt = opCount(st, op), nb = ctx.night[mid];
        if (!nb || nb.key !== op.key || !num(nb.cnt)) ctx.night[mid] = { key: op.key, cnt, t };
        else if (num(cnt) && cnt - nb.cnt > 1) fail('running', `${at(t)} ${mid} (loading 'perPart') finished ${cnt - nb.cnt} parts of ${op.key} since ${clk(nb.t)} while nobody was in the hall – each part needs an operator to load it`, 'night:' + mid);
      } else ctx.night[mid] = null;
    }
    if (allOff && m.state === 'running' && loadingOf(m, mid) === 'auto') ctx.ghostRun++;
    // Realismus-Stichproben (besetzte Zeit)
    const ss = ctx.stateSamples[mid] || (ctx.stateSamples[mid] = {});
    ss[m.state] = (ss[m.state] || 0) + 1;
    if (staffedOverlap(t - 1, t) > 0) { const sf = ctx.staffedSamples[mid] || (ctx.staffedSamples[mid] = {}); sf[m.state] = (sf[m.state] || 0) + 1; }
  }
}

/** Wartezeiten je Segment (aus state-Events): waitOperator > 4 h besetzte Zeit = Deadlock-Verdacht (§3.11.7). */
function checkSegment(mid, state, t0, t1, ongoing) {
  const staffed = staffedOverlap(t0, t1);
  const span = `${clk(t0)} – ${ongoing ? 'still at ' : ''}${clk(t1)}`;
  if (state === 'waitOperator' && staffed > 4 * H) fail('deadlock', `${mid} in 'waitOperator' for ${dur(staffed)} of staffed shift time (${span})`, 'wop:' + mid + ':' + t0);
  else if (state === 'fault' && staffed > 2 * H) warn('deadlock', `${mid} in 'fault' for ${dur(staffed)} of staffed time (${span}) – repair not happening?`, 'flt:' + mid + ':' + t0);
  else if (state === 'waitTool' && staffed > 1 * H) warn('deadlock', `${mid} in 'waitTool' for ${dur(staffed)} of staffed time (${span})`, 'wt:' + mid + ':' + t0);
  else if (WAIT_GROUP.has(state) && staffed > 8 * H) warn('deadlock', `${mid} in '${state}' for ${dur(staffed)} of staffed time (${span})`, 'wait:' + mid + ':' + t0);
}
function checkOngoingSegments(ctx, st, t) {
  for (const mid of MACHINE_IDS_LIST) {
    if (ctx.nStateEvents > 0) { if (ctx.curState[mid] !== undefined && num(ctx.enterT[mid])) checkSegment(mid, ctx.curState[mid], ctx.enterT[mid], t, true); }
    else if (ctx.chunkSeg[mid]) checkSegment(mid, ctx.chunkSeg[mid].state, ctx.chunkSeg[mid].t0, t, true);
  }
}

// ------------------------------------------------------------------ Test 3: Mengenbilanz
function checkQty(ctx, st, t) {
  if (!st.orders) { missing('qty', 'state.orders'); return; }
  if (!st.containers) missing('qty', 'state.containers');
  const scrapDest = new Set();
  for (const tr of vals(st.transports)) if (trTo(tr) === 'SPERR' && trContainer(tr) != null) scrapDest.add(String(trContainer(tr)));
  const byOrder = {};
  for (const cid of Object.keys(st.containers || {})) {
    const c = st.containers[cid];
    if (!c || typeof c !== 'object') continue;
    const oid = cOrder(c);
    if (!oid || isBarContainer(c)) continue;
    const q = cQty(c);
    if (q === undefined) { missing('qty', 'container.qty'); continue; }
    ok('qty');
    if (!num(q) || q < 0) { fail('qty', `${at(t)} container ${cid} (${oid}) has invalid qty ${q}`, 'cq:' + cid); continue; }
    if (!Number.isInteger(q)) fail('qty', `${at(t)} container ${cid} (${oid}) holds a fractional part count ${q}`, 'cqi:' + cid);
    const b = byOrder[oid] || (byOrder[oid] = { wip: 0, versand: 0, scrapCont: 0, list: [] });
    const loc = cLoc(c);
    if (cIsScrap(c) || scrapDest.has(String(c.id ?? cid))) b.scrapCont += q;
    else if (loc === 'VERSAND') b.versand += q;
    else b.wip += q;
    b.list.push(`${cid}@${loc ?? '?'}:${q}`);
    if (isExtLoc(loc)) ctx.extSeen.add(cid);
    else if (ctx.extSeen.has(cid)) ctx.extReturned.add('c:' + cid);
  }
  const inProc = {};
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines && st.machines[mid];
    if (!m) continue;
    const op = opInfo(st, m);
    if (op.active && inPart(m, op) === true) inProc[op.orderId] = (inProc[op.orderId] || 0) + 1;
  }
  for (const oid of Object.keys(st.orders)) {
    const o = st.orders[oid];
    if (!o || typeof o !== 'object') continue;
    const qty = o.qty;
    if (!num(qty)) { missing('qty', 'order.qty'); continue; }
    const ops = opsOf(o, oid);
    if (!ops.some((x) => x.done !== undefined)) { missing('qty', 'order op counters (order.ops[seq].done)'); continue; }
    const prev = ctx.prevOps[oid] || (ctx.prevOps[oid] = {});
    let scrapSum = 0, prevDone = null, prevSeq = null;
    // Ausschuss im ersten Arbeitsgang wird aus Rohmaterial nachgefertigt (Teile kommen aus dem Lager, nicht „aus dem Nichts“)
    const scrapFirst = ops.length && num(ops[0].scrap) ? ops[0].scrap : 0;
    for (const x of ops) {
      const d = x.done, s = num(x.scrap) ? x.scrap : 0;
      if (x.scrap !== undefined && (!num(x.scrap) || x.scrap < 0 || !Number.isInteger(x.scrap))) fail('qty', `${at(t)} ${oid} op ${x.seq}: scrap = ${x.scrap} (must be a non-negative integer)`, 'sneg:' + oid + x.seq);
      if (d !== undefined) {
        ok('qty');
        if (!num(d) || d < 0 || !Number.isInteger(d)) fail('qty', `${at(t)} ${oid} op ${x.seq}: done = ${d} (must be a non-negative integer)`, 'dneg:' + oid + x.seq);
        else {
          if (d > qty) fail('qty', `${at(t)} ${oid} op ${x.seq} (${x.station}): ${d} good parts > order qty ${qty}`, 'dqty:' + oid + x.seq);
          if (prev[x.seq] && d < prev[x.seq].done) fail('qty', `${at(t)} ${oid} op ${x.seq}: good count decreased ${prev[x.seq].done} → ${d}`, 'ddec:' + oid + x.seq);
          if (prev[x.seq] && s < prev[x.seq].scrap) fail('qty', `${at(t)} ${oid} op ${x.seq}: scrap count decreased ${prev[x.seq].scrap} → ${s}`, 'sdec:' + oid + x.seq);
          if (prevDone !== null && d + s > prevDone) fail('qty', `${at(t)} ${oid} op ${x.seq} (${x.station}) processed ${d} good + ${s} scrap = ${d + s} > ${prevDone} good parts of op ${prevSeq} – parts appeared from nowhere`, 'chain:' + oid + x.seq);
          prevDone = d; prevSeq = x.seq;
        }
      }
      scrapSum += s;
      prev[x.seq] = { done: num(d) ? d : 0, scrap: s };
    }
    const b = byOrder[oid] || { wip: 0, versand: 0, scrapCont: 0, list: [] };
    ctx.contSig[oid] = b.list.join(',');
    const versOp = ops.find((x) => x.station === 'VERSAND');
    const shippedCounter = firstDef(o.shipped, o.delivered, versOp && versOp.done);
    const shipped = Math.max(b.versand, num(shippedCounter) ? shippedCounter : 0);
    const ip = inProc[oid] || 0;
    const total = b.wip + shipped + scrapSum, cap = qty + scrapFirst;
    ok('qty');
    if (total > cap) fail('qty', `${at(t)} ${oid}: shipped/at VERSAND ${shipped} + WIP containers ${b.wip} + scrap ${scrapSum} = ${total} > qty ${qty}${scrapFirst ? ' + ' + scrapFirst + ' replacement(s) for op-1 scrap' : ''} [${b.list.slice(0, 6).join(', ')}${b.list.length > 6 ? ', …' : ''}]`, 'tot:' + oid);
    else if (total + ip > cap) warn('qty', `${at(t)} ${oid}: containers + scrap + ${ip} part(s) in machines = ${total + ip} > ${cap} – input part counted twice (reserved in container and in machine)?`, 'totip:' + oid);
    checkOpBalance(ctx, st, t, o, oid);
    if (isDone(o)) {
      if (!ctx.seenFertig.has(oid)) { ctx.seenFertig.add(oid); note('qty', `${oid} fertig at ${clk(t)}: shipped ${shipped || (ops.filter((x) => x.station !== 'VERSAND').pop() || {}).done}, scrap ${scrapSum}${scrapFirst ? ' (' + scrapFirst + ' in op 1, replaced)' : ''}, qty ${qty}`); }
      if (!ctx.doneChecked[oid]) {
        ctx.doneChecked[oid] = t;
        const lastProc = ops.filter((x) => x.station !== 'VERSAND').pop();
        const fin = shipped || (lastProc && num(lastProc.done) ? lastProc.done : 0);
        const scrapDown = scrapSum - scrapFirst;   // Ausschuss in Folgearbeitsgängen fehlt in der Liefermenge
        if (fin + scrapDown === qty) ok('qty');
        else fail('qty', `${at(t)} ${oid} is 'fertig' but shipped ${fin} + downstream scrap ${scrapDown} = ${fin + scrapDown} ≠ qty ${qty} (op-1 scrap ${scrapFirst} is re-made)`, 'fin:' + oid);
        if (b.wip > 0) fail('qty', `${at(t)} ${oid} is 'fertig' but ${b.wip} parts are still in containers outside VERSAND [${b.list.join(', ')}]`, 'finwip:' + oid);
        const busy = MACHINE_IDS_LIST.filter((mid) => { const m = st.machines[mid]; return m && ACTIVE_WORK.has(m.state) && opInfo(st, m).orderId === oid; });
        if (busy.length) fail('qty', `${at(t)} ${oid} is 'fertig' while ${busy.join(', ')} still work on it`, 'finbusy:' + oid);
      }
    }
  }
}

/** SPEC §3.11.3 wörtlich, je Arbeitsgang (Felder der Engine: op.received/good/scrap/inProc/passed,
 *  Behälter {orderId, src (Quell-AG-Index), idx (Ziel-AG-Index), state, relocate}):
 *    erhalten = gut + Ausschuss + in Bearbeitung + wartend
 *    gut = weitergegeben + im Ausgangspuffer
 *    weitergegeben = beim Nachfolger erhalten + unterwegs */
function checkOpBalance(ctx, st, t, o, oid) {
  const ops = Array.isArray(o.ops) ? o.ops : null;
  if (!ops || !ops.length || !['received', 'passed', 'inProc'].every((k) => num(ops[0][k]))) { missing('qty', 'op.received / op.passed / op.inProc (§3.11.3 balance)'); return; }
  const rt = routingOf(o, oid);
  const waiting = {}, out = {}, transit = {};
  for (const cid of Object.keys(st.containers || {})) {
    const c = st.containers[cid];
    if (!c || cOrder(c) !== oid || !num(c.idx)) continue;
    const q = num(cQty(c)) ? cQty(c) : 0;
    if (c.state === 'input') waiting[c.idx] = (waiting[c.idx] || 0) + q;
    if (num(c.src) && c.src >= 0) {
      if ((c.state === 'filling' || c.state === 'ready') && !c.relocate) out[c.src] = (out[c.src] || 0) + q;
      if (c.state === 'transit' || (c.state === 'ready' && c.relocate)) transit[c.src] = (transit[c.src] || 0) + q;
    }
  }
  ops.forEach((op, i) => {
    const r = rt[i] || {};
    if (r.station === 'VERSAND') return;
    ok('qty', 3);
    const w = waiting[i] || 0, where = `${at(t)} ${oid} AG ${r.seq} (${r.station})`;
    if (op.received !== op.good + op.scrap + op.inProc + w) fail('qty', `${where}: received ${op.received} ≠ good ${op.good} + scrap ${op.scrap} + in process ${op.inProc} + waiting ${w}`, 'bal-recv:' + oid + r.seq);
    if (op.good !== op.passed + (out[i] || 0)) fail('qty', `${where}: good ${op.good} ≠ passed on ${op.passed} + in output buffer ${out[i] || 0}`, 'bal-good:' + oid + r.seq);
    if (i + 1 < ops.length && op.passed !== ops[i + 1].received + (transit[i] || 0)) fail('qty', `${where}: passed on ${op.passed} ≠ received by AG ${rt[i + 1] && rt[i + 1].seq} ${ops[i + 1].received} + in transit ${transit[i] || 0}`, 'bal-pass:' + oid + r.seq);
    if (op.inProc < 0 || op.passed < 0 || op.received < 0) fail('qty', `${where}: negative counter (received ${op.received}, inProc ${op.inProc}, passed ${op.passed})`, 'bal-neg:' + oid + r.seq);
  });
}

// ------------------------------------------------------------------ Test 4: Material, AGV, Transporte
function checkStock(ctx, st, t) {
  if (!st.materials) missing('stock', 'state.materials');
  for (const id of Object.keys(st.materials || {})) {
    const m = st.materials[id];
    const oh = m && firstDef(m.onHand, m.stock);
    if (!num(oh)) { missing('stock', 'material.onHand'); continue; }
    ok('stock');
    if (oh < -1e-9) fail('stock', `${at(t)} material ${id} onHand = ${f2(oh)} < 0`, 'oh:' + id);
    const w = ctx.watchDelivery;
    if (w && w.matId === id) { if (num(w.last) && oh > w.last + 1e-9 && w.incT == null) w.incT = t; w.last = oh; }
  }
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines && st.machines[mid];
    // null = Maschine ohne Stangenlader (nicht zutreffend)
    if (m && m.barStockM !== undefined && m.barStockM !== null) { ok('stock'); if (!num(m.barStockM) || m.barStockM < -1e-9) fail('stock', `${at(t)} ${mid} barStockM = ${m.barStockM} < 0`, 'bar:' + mid); }
    if (m && m.barStockM != null && num(m.barMagazineM) && m.barMagazineM > 0 && m.barStockM > m.barMagazineM + 1e-6) fail('stock', `${at(t)} ${mid} barStockM ${f2(m.barStockM)} m > magazine capacity ${m.barMagazineM} m`, 'barcap:' + mid);
  }
  if (st.toolStock) for (const k of Object.keys(st.toolStock)) {
    const s = st.toolStock[k] || {};
    for (const f of ['ready', 'regrind', 'scrapToday']) if (s[f] !== undefined && (!num(s[f]) || s[f] < 0)) fail('tools', `${at(t)} toolStock[${k}].${f} = ${s[f]} (must be ≥ 0)`, 'ts:' + k + f);
  }
  if (!st.agvs) missing('stock', 'state.agvs');
  for (const id of Object.keys(st.agvs || {})) {
    const a = st.agvs[id];
    if (!a) continue;
    const bat = firstDef(a.battery, a.bat, a.soc);
    if (!num(bat)) missing('stock', 'agv.battery');
    else {
      ok('stock');
      if (bat < -1e-9 || bat > 100 + 1e-9) fail('stock', `${at(t)} ${id} battery ${f2(bat)} % outside [0,100]`, 'bat:' + id);
      if (bat < 10) warn('realism', `${id} battery fell to ${f2(bat)} % (SPEC: below 25 % → charging station)`, 'lowbat:' + id);
    }
    const maxKg = firstDef(a.maxKg, P_AGV[id] && P_AGV[id].maxKg);
    const loads = agvLoads(st, a);
    let kg = 0, unknown = false;
    for (const c of loads) {
      if (c.__missing !== undefined) { warn('stock', `${at(t)} ${id}.load references unknown container ${c.__missing}`, 'agvref:' + id); unknown = true; continue; }
      const w = containerKg(st, c);
      if (num(w)) kg += w; else unknown = true;
      if (isBarContainer(c)) fail('stock', `${at(t)} ${id} carries bar stock ${short(c.id)} (SPEC: bars always by forklift)`, 'agvbar:' + id);
    }
    if (loads.length && unknown && kg === 0) missing('stock', 'container weight (weightKg or qty × part.weightKg) for AGV load');
    if (loads.length) ok('stock');
    if (num(maxKg) && kg > maxKg + 1e-6) fail('stock', `${at(t)} ${id} carries ${f2(kg)} kg > maxKg ${maxKg} (${loads.map((c) => c.id).join(', ')})`, 'kg:' + id);
  }
  for (const id of Object.keys(st.transports || {})) {
    const tr = st.transports[id];
    if (!tr || tr.status === 'done') continue;
    const md = trMode(tr), w = tr.weightKg;
    if (md === 'AGV' && num(w) && w > 250 + 1e-6) fail('stock', `${at(t)} transport ${id} (${w} kg) assigned to AGV – > 250 kg must go by forklift`, 'trkg:' + id);
    if (tr.kind === 'bars' && md && md !== 'Stapler') fail('stock', `${at(t)} transport ${id} of bar stock uses mode '${tr.mode}' (must be Stapler)`, 'trbar:' + id);
  }
}

// ------------------------------------------------------------------ Test 5: Personen
function trackTask(ctx, p, pid, t) {
  if (!p) return null;
  const key = taskKeyOf(p);
  const rec = ctx.personTask[pid];
  if (!key) { ctx.personTask[pid] = null; ctx.lastObsT[pid] = t; return null; }
  if (!rec || rec.key !== key) ctx.personTask[pid] = { key, lowT: ctx.lastObsT[pid] ?? -Infinity, firstT: t };
  ctx.lastTaskSeen[pid] = t;
  ctx.lastObsT[pid] = t;
  return key;
}
function checkPeople(ctx, st, t) {
  if (!st.people) { missing('people', 'state.people'); return; }
  const owners = new Map();
  for (const pid of Object.keys(st.people)) {
    const p = st.people[pid];
    if (!p) continue;
    const name = (P_PERSON[pid] && P_PERSON[pid].name) || pid, sid = shiftOf(p, pid);
    ok('people');
    if (p.state === undefined) { missing('people', 'person.state'); continue; }
    if (!PERSON_STATES.has(p.state)) warn('people', `person ${pid} has unknown state '${p.state}' (SPEC §3.5: ${[...PERSON_STATES].join('|')})`, 'pst:' + p.state);
    if (Array.isArray(p.tasks) && p.tasks.length > 1) fail('people', `${at(t)} ${pid} (${name}) holds ${p.tasks.length} tasks at once`, 'multi:' + pid);
    const key = trackTask(ctx, p, pid, t);
    const tk = taskOf(st, p);
    if (key) {
      if (owners.has(key)) fail('people', `${at(t)} task ${key} (${taskTypeOf(tk)}) is held by ${owners.get(key)} and ${pid} at the same time`, 'dup:' + key);
      owners.set(key, pid);
      const qk = pid + '|' + key;
      if (!ctx.qualChecked.has(qk)) {
        ctx.qualChecked.add(qk);
        if (qualified(skillsOf(p, pid), tk, pid) === false) warn('people', `${pid} (${name}, ${P_PERSON[pid] ? P_PERSON[pid].role : '?'}) got task '${taskTypeOf(tk)}' at ${taskStationOf(tk)} without matching skill`, 'qual:' + pid + taskTypeOf(tk));
      }
    }
    if (p.state === 'offShift' && key) fail('people', `${at(t)} ${pid} (${name}) is offShift but still holds task ${key} (${taskTypeOf(tk)}) – it can never finish`, 'offtask:' + pid);
    const win = offWindow(sid, t);
    if (win.inOff && p.state !== 'offShift') {
      const rec = ctx.personTask[pid];
      const legit = key && rec && rec.lowT < win.shiftEnd + 60;
      const walkingHome = !key && num(ctx.lastTaskSeen[pid]) && t - ctx.lastTaskSeen[pid] <= 15 * MIN;
      if (legit) { if (t - win.shiftEnd > 3 * H) warn('people', `${pid} (${name}) still finishing task ${key} (${taskTypeOf(tk)}) ${dur(t - win.shiftEnd)} after shift end`, 'ot:' + pid + key); }
      else if (!walkingHome) {
        fail('people', `${at(t)} ${pid} (${name}, shift ${sid}) is '${p.state}'${key ? ` with task ${key} (${taskTypeOf(tk)}) assigned after shift end` : ' without a task'} – shift ended ${clk(win.shiftEnd)}`, 'offwin:' + pid + ':' + (key ? 'task' : p.state));
      }
    }
    const x = tod(t), sh = SHIFTS[sid];
    if (sh && Math.floor(t / DAY) % 7 < 5) {
      if (x >= sh.start + 30 * MIN && x <= sh.end - 30 * MIN && !sh.breaks.some(([a, b]) => x >= a - 5 * MIN && x <= b + 10 * MIN) && p.state === 'offShift') {
        warn('people', `${at(t)} ${pid} (${name}) is offShift during own shift ${sid}`, 'absent:' + pid);
      }
      if (sid !== expectedShift(t) && x >= STAFF_START && x < sh.start - 30 * MIN && p.state !== 'offShift' && !key) {
        warn('people', `${at(t)} ${pid} (${name}, shift ${sid}) is '${p.state}' in the hall long before shift start`, 'early:' + pid);
      }
    }
    if (p.pos && num(p.pos.x) && p.state !== 'offShift') {
      const hw = (PROFILE.hall && PROFILE.hall.w) || 64, hd = (PROFILE.hall && PROFILE.hall.d) || 40;
      if (p.pos.x < -3 || p.pos.x > hw + 3 || p.pos.z < -3 || p.pos.z > hd + 3) warn('people', `${at(t)} ${pid} at (${f2(p.pos.x)}, ${f2(p.pos.z)}) outside the hall`, 'pos:' + pid);
    }
  }
}

// ------------------------------------------------------------------ Test 9: KPIs / Zeit
function checkKpi(ctx, t) {
  if (typeof SIM.kpis !== 'function') return;
  let k;
  if (!simCall('kpis()', () => { k = SIM.kpis(); })) return;
  if (!k || typeof k !== 'object') { fail('kpi', `kpis() returned ${short(k)}`, 'kobj'); return; }
  for (const f of ['oee', 'availability', 'performance', 'quality', 'fpy']) {
    const v = k[f];
    if (v === undefined) fail('kpi', `kpis().${f} missing (§3.10)`, 'kmiss:' + f);
    else if (v === null) {
      // dokumentiert: OEE/Verfügbarkeit/Leistung sind null, solange heute keine Bezugszeit angefallen ist (z. B. nachts)
      if ((f === 'oee' || f === 'availability' || f === 'performance') && !(num(k.availability) && k.availability > 0 && f === 'oee')) ok('kpi');
      else warn('kpi', `kpis().${f} is null at ${clk(t)} (no data yet?) – UI must cope`, 'knull:' + f);
    }
    else if (!num(v) || v < -1e-9 || v > 1 + 1e-9) fail('kpi', `${at(t)} kpis().${f} = ${v} is not a number in [0,1]`, 'krange:' + f);
    else ok('kpi');
  }
  for (const f of ['good', 'scrap', 'lossEur', 'energyKwh', 'powerKw', 'wip', 'transportsToday', 'toolCostToday']) {
    const v = k[f];
    if (v === undefined) warn('kpi', `kpis().${f} missing (§3.10)`, 'kmiss2:' + f);
    else if (v !== null && (!num(v) || v < -1e-9)) fail('kpi', `${at(t)} kpis().${f} = ${v} is not a non-negative number`, 'kneg:' + f);
    else ok('kpi');
  }
  if (k.onTimePct != null && (!num(k.onTimePct) || k.onTimePct < 0 || k.onTimePct > 100)) fail('kpi', `${at(t)} kpis().onTimePct = ${k.onTimePct}`, 'kot');
  ctx.lastKpi = k;
}
function checkClockShift(t) {
  if (typeof SIM.clock === 'function') {
    let c; simCall('clock()', () => { c = SIM.clock(); });
    ok('api');
    if (c !== WF.util.fmtDayClock(t)) fail('api', `${at(t)} clock() = '${c}' but fmtDayClock(state.t) = '${WF.util.fmtDayClock(t)}'`, 'clock');
  }
  if (typeof SIM.shift === 'function' && !nearBoundary(t)) {
    let s; simCall('shift()', () => { s = SIM.shift(); });
    if (!s || typeof s !== 'object') { fail('api', `shift() returned ${short(s)}`, 'shiftobj'); return; }
    for (const f of ['id', 'name', 'inBreak', 'endsAt']) if (!(f in s)) warn('api', `shift().${f} missing (§3.10)`, 'shf:' + f);
    const exp = expectedShift(t);
    if (exp && Math.floor(t / DAY) % 7 < 5) {
      ok('api');
      if (s.id !== undefined && s.id !== exp) fail('api', `${at(t)} shift().id = '${s.id}' but profile says '${exp}'`, 'shid');
      if (typeof s.inBreak === 'boolean' && s.inBreak !== inBreak(exp, t)) fail('api', `${at(t)} shift().inBreak = ${s.inBreak} but profile breaks say ${inBreak(exp, t)}`, 'shbr');
    }
  }
}

// ------------------------------------------------------------------ Fortschritt, Transporte, Ringpuffer
function trackProgress(ctx, st, t) {
  for (const oid of Object.keys(st.orders || {})) {
    const o = st.orders[oid];
    if (!o) continue;
    const sig = opsOf(o, oid).map((x) => `${x.done}/${x.scrap}`).join(',') + '|' + o.status + '|' + (ctx.contSig[oid] || '');
    if (ctx.orderSig[oid] !== sig) { ctx.orderSig[oid] = sig; ctx.orderProgT[oid] = t; }
  }
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines && st.machines[mid];
    if (!m) continue;
    const op = opInfo(st, m);
    const sig = op.key + ':' + opCount(st, op);
    if (ACTIVE_WORK.has(m.state) || (ctx['ms:' + mid] !== undefined && ctx['ms:' + mid] !== sig)) ctx.machProgT[mid] = t;
    ctx['ms:' + mid] = sig;
  }
}
function sampleTransports(ctx, st) {
  const trs = st.transports;
  if (!trs) return;
  const ids = Object.keys(trs);
  if (ids.length > 600) return;
  for (const id of ids) {
    const tr = trs[id];
    if (!tr) continue;
    let r = ctx.trSeen.get(id);
    if (!r) { r = { mode: trMode(tr), kind: tr.kind, done: false, t: st.t }; ctx.trSeen.set(id, r); }
    if (tr.status === 'done') r.done = true;
    if (tr.mode) r.mode = trMode(tr);
    if (tr.kind) r.kind = tr.kind;
  }
}
function checkBuffers(ctx, st, t) {
  if (!Array.isArray(st.events)) missing('events', 'state.events (array)');
  else { ok('events'); if (st.events.length > 3000) fail('events', `${at(t)} state.events holds ${st.events.length} entries (ring buffer 3000)`, 'ring'); }
  const ns = vals(st.notifications);
  if (!st.notifications) { missing('events', 'state.notifications'); return; }
  if (ns.length > 2000) warn('events', `state.notifications grows to ${ns.length} entries`, 'nlen');
  const openKeys = new Map();
  for (const n of ns) {
    if (!ctx.notifSeen.has(n.id)) { ctx.notifSeen.add(n.id); checkNotificationShape(n); }
    if (n.status === 'open' && n.key != null) {
      if (openKeys.has(n.key)) fail('events', `${at(t)} two open notifications with the same key '${n.key}' (${openKeys.get(n.key)}, ${n.id}) – dedup failed`, 'dupkey:' + n.key);
      openKeys.set(n.key, n.id);
    }
    if (n.sev === 'crit' && n.status !== 'resolved' && n.entity && MACHINE_IDS.has(n.entity.id)) {
      const mid = n.entity.id, m = st.machines[mid];
      if (m && m.state !== 'fault' && ctx.curState[mid] !== 'fault' && num(ctx.enterT[mid]) && t - ctx.enterT[mid] > 15 * MIN && num(n.t) && n.t < ctx.enterT[mid]) {
        warn('events', `${at(t)} crit notification '${n.title}' for ${mid} still '${n.status}' although the machine left 'fault' at ${clk(ctx.enterT[mid])} (SPEC: auto-resolve when cause disappears)`, 'nres:' + n.id);
      }
    }
  }
}

/** Alle Invarianten nach einem advance()-Aufruf. */
function chunkCheck(ctx, dtExpected) {
  const st = S();
  const t = st && st.t;
  if (!num(t)) { fail('kpi', `state.t is not a number: ${t}`, 'tnan'); return; }
  if (ctx.lastT != null) {
    ok('kpi');
    if (t < ctx.lastT) fail('kpi', `time went backwards ${clk(ctx.lastT)} → ${clk(t)}`, 'tback');
    else if (dtExpected != null && Math.abs(t - ctx.lastT - dtExpected) > 1e-6) fail('kpi', `${at(t)} advance(${dtExpected}) moved state.t by ${f2(t - ctx.lastT)} s`, 'tdelta');
  }
  ctx.lastT = t;
  guard('machines', () => checkMachines(ctx, st, t));
  guard('tool range', () => checkToolRange(st, t, 'after advance'));
  guard('tool decrease', () => checkToolDecrease(ctx, st, t));
  guard('tool observation', () => updateToolObs(ctx, st, t));
  guard('quantities', () => checkQty(ctx, st, t));
  guard('stock', () => checkStock(ctx, st, t));
  guard('people', () => checkPeople(ctx, st, t));
  guard('kpis', () => checkKpi(ctx, t));
  guard('clock/shift', () => checkClockShift(t));
  guard('progress', () => trackProgress(ctx, st, t));
  guard('segments', () => checkOngoingSegments(ctx, st, t));
  guard('transports', () => sampleTransports(ctx, st));
  guard('buffers', () => checkBuffers(ctx, st, t));
  guard('stale tasks', () => checkStaleTasks(st, t, 'chunk'));
}

// ------------------------------------------------------------------ Test 8: Projektion / Hash
function prim(o) {
  const r = {};
  if (!o || typeof o !== 'object') return o;
  for (const k of Object.keys(o).sort()) {
    const v = o[k], ty = typeof v;
    if (v === null || ty === 'number' || ty === 'string' || ty === 'boolean') r[k] = v;
  }
  return r;
}
const pos2 = (p) => (p && num(p.x)) ? [p.x, p.z] : null;
const stableTaskKey = (st, p) => { const tk = taskOf(st, p); return tk ? (tk.id != null ? String(tk.id) : taskTypeOf(tk) + '@' + taskStationOf(tk)) : null; };
/** Breite Projektion des Zustands (alle primitiven Felder der Entitäten) für den Determinismus-Vergleich. */
function projection(st) {
  const P = { t: st.t, machines: {}, orders: {}, materials: {}, tools: {}, people: {}, agvs: {}, containers: {}, transports: {} };
  for (const id of keysSorted(st.machines)) { const m = st.machines[id]; P.machines[id] = { ...prim(m), op: opInfo(st, m).key, tools: mountedTools(st, m, id).list.map((x) => [x.id, toolUsed(x.tool)]) }; }
  for (const id of keysSorted(st.orders)) { const o = st.orders[id]; P.orders[id] = { ...prim(o), ops: opsOf(o, id).map((x) => [x.seq, x.done, x.scrap]) }; }
  for (const id of keysSorted(st.materials)) P.materials[id] = prim(st.materials[id]);
  for (const id of keysSorted(st.tools)) P.tools[id] = prim(st.tools[id]);
  for (const id of keysSorted(st.people)) { const p = st.people[id]; P.people[id] = { ...prim(p), task: stableTaskKey(st, p), pos: pos2(p.pos) }; }
  for (const id of keysSorted(st.agvs)) { const a = st.agvs[id]; P.agvs[id] = { ...prim(a), pos: pos2(a.pos), load: agvLoads(st, a).map((c) => c.id ?? c.__missing) }; }
  for (const id of keysSorted(st.containers)) P.containers[id] = prim(st.containers[id]);
  for (const id of keysSorted(st.transports)) P.transports[id] = prim(st.transports[id]);
  const ev = Array.isArray(st.events) ? st.events : [];
  P.nEvents = ev.length;
  P.lastEvents = ev.slice(-25).map((e) => [e.id, e.t, e.type, e.msg]);
  P.notifications = vals(st.notifications).map((n) => [n.id, n.key, n.status, n.sev]);
  return P;
}
/** Kompakte Projektion wie in der Aufgabe beschrieben (t, Maschinenzustände/Zähler, Auftragsfortschritt, Bestände). */
function compactProjection(st) {
  return {
    t: st.t,
    m: keysSorted(st.machines).map((id) => { const m = st.machines[id]; const op = opInfo(st, m); return [id, m.state, op.key, opCount(st, op)]; }),
    o: keysSorted(st.orders).map((id) => [id, st.orders[id].status, opsOf(st.orders[id], id).map((x) => [x.done, x.scrap])]),
    mat: keysSorted(st.materials).map((id) => [id, firstDef(st.materials[id].onHand, st.materials[id].stock)]),
  };
}
const hashOf = (P) => WF.util.hash(JSON.stringify(P));
function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${p || '(root)'}: ${short(a)} vs ${short(b)}`;
  const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of ks) { const d = firstDiff(a[k], b[k], p ? p + '.' + k : k); if (d) return d; }
  return null;
}
function compareProj(label, A, B) {
  ok('determinism');
  const ha = hashOf(A), hb = hashOf(B);
  if (ha === hb) { note('determinism', `${label}: hash ${ha} identical`); return true; }
  fail('determinism', `${label}: state hash differs (${ha} vs ${hb}); first difference at ${firstDiff(A, B)}`, 'det:' + label);
  return false;
}

// ------------------------------------------------------------------ Test 10: Sichten
function viewCall(label, fn) {
  let r, threw = false;
  nonDet.inSim = true;
  try { r = fn(); } catch (e) { threw = true; fail('api', `${label} threw: ${errStr(e)}`, 'vthrow:' + label.replace(/\(.*$/, '') + ':' + String(e && e.message)); }
  finally { nonDet.inSim = false; }
  return { r, threw };
}
function checkToolView(st, mid, v, t) {
  const raw = firstDef(v.tools, v.toolList);
  const vts = vals(raw);
  const m = st.machines[mid], op = opInfo(st, m);
  const ot = op.active && op.step ? opTools(st, m, mid, op) : null;
  if (!vts.length) { if (ot && ot.items.length) warn('tools', `machineView(id).tools missing – cannot verify the displayed wear / 'noch N Teile'`, 'mvtools'); return; }
  for (const vt of vts) {
    if (!vt || typeof vt !== 'object') continue;
    const id = vt.id != null ? String(vt.id) : null, ty = idOf(firstDef(vt.type, vt.typeId));
    const it = ot && ot.items.find((x) => (id && x.id === id) || (!id && x.type === ty));
    const stTool = (id && st.tools && st.tools[id]) || (it && it.tool);
    if (!stTool) continue;
    const u = toolUsed(stTool), l = toolLife(stTool);
    if (!num(u) || !num(l) || l <= 0) continue;
    const real = u / l;
    const wear = firstDef(vt.wear, vt.wearPct, vt.pct);
    if (num(wear)) {
      ok('tools');
      if (Math.abs(wear - real) > 0.011 && Math.abs(wear / 100 - real) > 0.011) fail('tools', `${at(t)} machineView('${mid}') shows tool ${id || ty} wear ${f2(wear)} but used/life = ${(real * 100).toFixed(1)} % – displayed wear inconsistent with engine`, 'vw:' + mid + (id || ty));
    }
    const rp = firstDef(vt.remainingParts, vt.restParts, vt.partsLeft);
    const req = op.step && (op.step.tools || []).find((r) => r.type === (toolType(stTool) ?? ty));
    if (num(rp) && req && num(req.cutMinPerPart)) {
      const exp = stTool.broken ? 0 : Math.floor((l - u) / req.cutMinPerPart + 1e-9);   // gebrochenes Werkzeug: 0 Teile
      ok('tools');
      if (rp !== exp) fail('tools', `${at(t)} machineView('${mid}') shows tool ${id || ty} 'noch ${rp} Teile' but floor((life−used)/cutMinPerPart) = ${exp}`, 'vrp:' + mid + (id || ty));
      // ≤ planAtParts: entweder ein geplanter Wechsel („nach Teil N · ca. hh:mm“) oder eine sichtbare Begründung
      // (Reststandzeit reicht für den Rest des Arbeitsgangs / wird gerade gewechselt)
      const plan = firstDef(vt.plannedChange, vt.planned, vt.plan, vt.changeAt, vt.changePlanned, vt.nextChange);
      if (exp <= PLAN_AT && !plan && vt.status !== 'changing' && !(typeof vt.explain === 'string' && vt.explain.trim())) warn('tools', `machineView: tool with remainingParts ≤ ${PLAN_AT} shows neither a planned change nor an explanation (SPEC §3.4 'Wechsel nach Teil … ca. hh:mm')`, 'vplan');
      if (plan && typeof plan === 'object' && num(plan.afterPart)) {
        ok('tools');
        const done = opCount(st, op);
        if (num(done) && plan.afterPart < done) fail('tools', `${at(t)} machineView('${mid}') plans the change of ${id || ty} 'nach Teil ${plan.afterPart}' although ${done} parts are already done`, 'vpast:' + mid + (id || ty));
        if (num(plan.etaT) && plan.etaT < t - 60) warn('tools', `${at(t)} machineView('${mid}') shows planned change of ${id || ty} at ${clk(plan.etaT)} in the past`, 'vpastt:' + mid);
      }
    }
  }
}
function viewChecks(ctx, t, opts = {}) {
  const st = S();
  const before = hashOf(projection(st));
  for (const mid of MACHINE_IDS_LIST) {
    if (typeof SIM.machineView !== 'function') break;
    const { r: v, threw } = viewCall(`machineView('${mid}')`, () => SIM.machineView(mid));
    if (threw) continue;
    if (!v || typeof v !== 'object') { fail('api', `machineView('${mid}') returned ${short(v)}`, 'mv:' + mid); continue; }
    ok('api');
    guard('tool view', () => checkToolView(st, mid, v, t));
    if (opts.oee) {
      let oee = firstDef(v.oee, v.oeeToday, v.kpi && v.kpi.oee);
      if (oee && typeof oee === 'object') oee = oee.oee;          // Engine: oeeToday {oee, availability, performance, quality}
      if (num(oee)) opts.oee[mid] = oee;
    }
  }
  for (const oid of Object.keys(st.orders || {})) {
    if (typeof SIM.orderView !== 'function') break;
    const { r: v, threw } = viewCall(`orderView('${oid}')`, () => SIM.orderView(oid));
    if (threw) continue;
    if (!v || typeof v !== 'object') fail('api', `orderView('${oid}') returned ${short(v)}`, 'ov:' + oid); else ok('api');
  }
  if (typeof SIM.forecast === 'function') {
    const { r: fc, threw } = viewCall('forecast()', () => SIM.forecast());
    if (!threw) {
      if (!fc || typeof fc !== 'object' || !fc.machines || !fc.orders) fail('api', `forecast() must return {machines, orders} – got keys ${short(fc && Object.keys(fc))}`, 'fc');
      else {
        ok('api');
        for (const mid of Object.keys(fc.machines)) for (const e of vals(fc.machines[mid])) {
          if (num(e.start) && num(e.end) && e.start > e.end + 1e-6) fail('api', `${at(t)} forecast.machines.${mid}: entry ${e.orderId}/${e.seq} starts ${clk(e.start)} after it ends ${clk(e.end)}`, 'fcse:' + mid);
        }
        for (const oid of Object.keys(st.orders || {})) {
          const o = st.orders[oid];
          if (!o || isDone(o)) continue;
          const f = fc.orders[oid];
          if (!f) { warn('api', `forecast().orders has no entry for open order ${oid}`, 'fco:' + oid); continue; }
          if (f.eta != null && !num(f.eta)) fail('api', `forecast().orders.${oid}.eta = ${short(f.eta)} is not a sim time`, 'fceta:' + oid);
          else if (num(f.eta) && f.eta < t - 60) warn('api', `${at(t)} forecast().orders.${oid}.eta ${clk(f.eta)} lies in the past for an unfinished order`, 'fcpast:' + oid);
          if (f.late !== undefined && typeof f.late !== 'boolean') warn('api', `forecast().orders.${oid}.late is not boolean`, 'fclate');
        }
      }
    }
  }
  if (typeof SIM.snapshot === 'function') {
    const { r: snap, threw } = viewCall('snapshot()', () => SIM.snapshot());
    if (!threw) {
      const s = typeof snap === 'string' ? snap : safeJSON(snap);
      if (s == null || snap == null) fail('api', 'snapshot() is not JSON-serialisable', 'snapjson');
      else {
        ok('api');
        ctx.maxSnap = Math.max(ctx.maxSnap || 0, s.length);
        if (s.length >= 12000) fail('api', `${at(t)} snapshot() JSON is ${s.length} chars (must be < 12000)`, 'snapsize');
      }
    }
  }
  const after = hashOf(projection(S()));
  ok('api');
  if (after !== before) fail('api', `${at(t)} calling machineView/orderView/forecast/snapshot changed the simulation state – views must be read-only`, 'impure');
}

// ------------------------------------------------------------------ nach init()
function afterInit(ctx) {
  const st = S();
  if (!st || typeof st !== 'object') { fail('load', `WF.sim.state after init is ${short(st)}`); return false; }
  ctx.t0 = st.t;
  if (!num(st.t)) { fail('load', 'state.t after init is not a number'); return false; }
  const ps = PROFILE.sim || {};
  if (st.t !== ps.startT && st.t !== ps.warmupUntilT) warn('load', `state.t after init = ${clk(st.t)} (expected startT ${clk(ps.startT)} or warmupUntilT ${clk(ps.warmupUntilT)})`, 'initt');
  for (const [coll, list] of [['machines', PROFILE.machines], ['orders', PROFILE.orders.map((o) => o.id)], ['people', PROFILE.people.map((p) => p.id)], ['agvs', PROFILE.agvs.map((a) => a.id)], ['materials', PROFILE.materials.map((m) => m.id)]]) {
    const c = st[coll];
    if (!c || typeof c !== 'object' || Array.isArray(c)) { fail('load', `state.${coll} must be an object keyed by id (§3.10)`, 'coll:' + coll); continue; }
    const miss = list.filter((id) => !c[id]);
    if (miss.length) fail('load', `state.${coll} lacks profile entries: ${miss.join(', ')}`, 'collmiss:' + coll); else ok('load');
  }
  for (const k of ['containers', 'transports', 'tools', 'toolStock', 'events', 'notifications']) if (st[k] === undefined) warn('load', `state.${k} missing (§3.10)`, 'stk:' + k);
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines && st.machines[mid];
    if (!m) continue;
    if (ctx.lastTo[mid] === undefined) ctx.initState[mid] = m.state;
    if (ctx.curState[mid] === undefined) { ctx.curState[mid] = m.state; ctx.enterT[mid] = st.t; }
  }
  // Anfangszustand §2.2 (nur wenn init nicht schon vorgerechnet hat)
  if (st.t === ps.startT) guard('initial state', () => {
    for (const po of PROFILE.orders) {
      const o = st.orders[po.id];
      if (!o) continue;
      const ops = opsOf(o, po.id);
      for (const [seq, init] of Object.entries((po.initial && po.initial.ops) || {})) {
        const x = ops.find((y) => String(y.seq) === String(seq));
        if (x && num(init.done) && num(x.done) && x.done !== init.done) warn('load', `${po.id} op ${seq}: initial done ${x.done} ≠ profile initial ${init.done}`, 'initdone:' + po.id + seq);
      }
      const ini = po.initial || {};
      if (ini.activeSeq != null) {
        const step = po.routing.find((r) => r.seq === ini.activeSeq);
        const m = step && st.machines[step.station];
        if (m) {
          const op = opInfo(st, m);
          if (op.known && op.orderId !== po.id) warn('load', `${po.id}: initial activeSeq ${ini.activeSeq} on ${step.station}, but the machine's op is ${op.key}`, 'initop:' + po.id);
          else if (op.orderId === po.id && ini.toolsUsed) {
            const ot = opTools(st, m, step.station, op);
            for (const it of (ot ? ot.items : [])) if (num(ini.toolsUsed[it.type]) && num(it.used) && Math.abs(it.used - ini.toolsUsed[it.type]) > 1e-6) warn('load', `${step.station} tool ${it.type}: initial used ${f2(it.used)} ≠ profile toolsUsed ${ini.toolsUsed[it.type]}`, 'inittool:' + it.type + step.station);
          }
        }
      }
    }
  });
  return true;
}

// ------------------------------------------------------------------ Ende Lauf A
function describeOrder(st, o, oid) {
  const ops = opsOf(o, oid).map((x) => `${x.seq}@${x.station} ${x.done ?? '?'}${num(x.scrap) && x.scrap ? '/x' + x.scrap : ''}`).join(' → ');
  const cs = Object.keys(st.containers || {}).map((k) => st.containers[k]).filter((c) => c && cOrder(c) === oid).map((c) => `${c.id}@${cLoc(c) ?? '?'}:${cQty(c)}`);
  const ms = MACHINE_IDS_LIST.filter((mid) => opInfo(st, st.machines[mid]).orderId === oid).map((mid) => `${mid}=${st.machines[mid].state}`);
  return `status ${o.status} | ops ${ops} | qty ${o.qty}${cs.length ? ' | containers ' + cs.slice(0, 6).join(', ') : ''}${ms.length ? ' | on ' + ms.join(', ') : ''}`;
}
function explainWait(st, o, oid) {
  if (/ext|fremd|härt|material|wartet/i.test(String(o.status || ''))) return `status '${o.status}'`;
  const ops = opsOf(o, oid);
  for (const c of Object.keys(st.containers || {}).map((k) => st.containers[k])) {
    if (c && cOrder(c) === oid && isExtLoc(cLoc(c))) return `container ${c.id} at external partner (${cLoc(c)})`;
  }
  for (const tr of vals(st.transports)) {
    const c = st.containers && st.containers[trContainer(tr)];
    if (tr.status !== 'done' && /^ext/.test(String(tr.kind)) && c && cOrder(c) === oid) return `transport ${tr.id} (${tr.kind}) under way`;
  }
  let scrapUp = 0;
  for (let i = 0; i < ops.length; i++) {
    const x = ops[i];
    // erster Arbeitsgang, der noch nicht alle bei ihm angekommenen Teile bearbeitet hat (= Front des Auftrags)
    const target = i === 0 ? o.qty : (ops[i - 1].done ?? 0);
    const doneHere = (x.done ?? 0) + (x.scrap ?? 0);
    if (x.station === 'VERSAND') break;
    if (doneHere < target) {
      if (x.station === 'EXT' || x.step.ext) return `op ${x.seq} at external partner (${(x.step.ext && x.step.ext.partner) || 'EXT'})`;
      const mat = x.step.material;
      if (i === 0 && mat) {
        const mm = st.materials && st.materials[mat.id];
        const oh = mm && firstDef(mm.onHand, mm.stock);
        const bars = st.machines[x.station] && st.machines[x.station].barStockM;
        if (num(oh) && oh < mat.perPart && !(num(bars) && bars >= mat.perPart)) return `raw material ${mat.id} short (onHand ${f2(oh)} < ${mat.perPart})`;
      }
      return null;
    }
    scrapUp += x.scrap ?? 0;
  }
  return null;
}
function openStations(o, oid) {
  const ops = opsOf(o, oid), res = [];
  let scrapUp = 0;
  for (const x of ops) { if (x.station !== 'VERSAND' && (x.done ?? 0) + (x.scrap ?? 0) < o.qty - scrapUp) res.push(x.station); scrapUp += x.scrap ?? 0; }
  return [...new Set(res)];
}
function finalChecksA(ctx) {
  const st = S(), t = st.t;
  // Test 7: Aufträge
  let fertig = 0;
  for (const po of PROFILE.orders) {
    const o = st.orders && st.orders[po.id];
    if (!o) { fail('deadlock', `profile order ${po.id} missing in state.orders`); continue; }
    ok('deadlock');
    if (isDone(o)) { fertig++; continue; }
    const desc = describeOrder(st, o, po.id);
    const why = explainWait(st, o, po.id);
    if (why) { note('deadlock', `${po.id} not fertig – explainably waiting: ${why} | ${desc}`); continue; }
    const lp = ctx.orderProgT[po.id];
    // Auftragsvorrat + Auftragseingang halten die Fertigung voll: unfertig, aber in Arbeit bzw. hinter anderer Arbeit
    // eingereiht ist Kapazität, kein Deadlock (Termine teils erst nächste Woche)
    if (num(lp) && t - lp <= 6 * H) { note('deadlock', `${po.id} (due ${clk(o.due)}) not fertig after ${HOURS} h but still progressing (last progress ${clk(lp)}) – capacity, not deadlock`); continue; }
    const busy = openStations(o, po.id).filter((sid) => MACHINE_IDS.has(sid) && num(ctx.machProgT[sid]) && t - ctx.machProgT[sid] <= 6 * H);
    if (busy.length) { note('deadlock', `${po.id} (due ${clk(o.due)}) not fertig, queued behind other work at ${busy.join(', ')}`); continue; }
    fail('deadlock', `${at(t)} ${po.id} stuck: no progress since ${clk(lp)} and not waiting for EXT/material | ${desc}`, 'stuck:' + po.id);
  }
  note('deadlock', `${fertig}/${PROFILE.orders.length} profile orders fertig after ${HOURS} h (${clk(t)})`);
  // Maschinen ohne jeden Fortschritt in den letzten 8 h, obwohl ein Arbeitsgang eingeplant ist
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines[mid], op = opInfo(st, m);
    if (op.active && num(ctx.machProgT[mid]) && t - ctx.machProgT[mid] > 8 * H && staffedOverlap(ctx.machProgT[mid], t) > 4 * H) {
      warn('deadlock', `${mid} holds ${op.key} but made no progress since ${clk(ctx.machProgT[mid])} (state ${m.state})`, 'mstall:' + mid);
    }
  }
  // Test 9: History
  guard('history', () => {
    const h = typeof SIM.history === 'function' ? SIM.history() : firstDef(SIM.history, st.history);
    if (!h || typeof h !== 'object') { missing('kpi', 'sim.history / state.history'); return; }
    if (!Array.isArray(h.t)) { missing('kpi', 'history.t[]'); return; }
    ok('kpi');
    for (let i = 1; i < h.t.length; i++) if (!(h.t[i] > h.t[i - 1])) { fail('kpi', `history.t not strictly increasing at index ${i} (${clk(h.t[i - 1])} → ${clk(h.t[i])})`, 'ht'); break; }
    const step = PROFILE.sim && PROFILE.sim.historyStepSec;
    if (step && h.t.length > 2 && Math.abs(h.t[h.t.length - 1] - h.t[h.t.length - 2] - step) > 1) warn('kpi', `history step ${h.t[h.t.length - 1] - h.t[h.t.length - 2]} s ≠ historyStepSec ${step}`, 'hstep');
    if (h.t.length && t - h.t[h.t.length - 1] > 2 * (step || 300)) fail('kpi', `history stopped: last sample ${clk(h.t[h.t.length - 1])}, now ${clk(t)}`, 'hstale');
    for (const k of ['good', 'oee', 'powerKw', 'wip']) {
      if (!Array.isArray(h[k])) { warn('kpi', `history.${k}[] missing`, 'hk:' + k); continue; }
      if (h[k].length !== h.t.length) warn('kpi', `history.${k} has ${h[k].length} samples but history.t ${h.t.length}`, 'hl:' + k);
      if (k === 'oee' && h[k].some((v) => v != null && (!num(v) || v < -1e-9 || v > 1 + 1e-9))) fail('kpi', 'history.oee contains values outside [0,1]', 'hoee');
    }
    if (h.perMachine) for (const mid of Object.keys(h.perMachine)) {
      const bad = vals(h.perMachine[mid]).find((s) => typeof s === 'string' && !STATE_KEYS.has(s));
      if (bad) fail('kpi', `history.perMachine.${mid} contains state '${bad}' (not WF.STATE)`, 'hpm:' + mid);
    } else warn('kpi', 'history.perMachine missing', 'hpm');
  });
  // Zustandsband m.segments (§3.2)
  guard('segments', () => {
    for (const mid of MACHINE_IDS_LIST) {
      const m = st.machines[mid], segs = m && m.segments;
      if (!Array.isArray(segs)) { missing('events', 'machine.segments'); continue; }
      ok('events');
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (!STATE_KEYS.has(s.state)) { warn('events', `${mid}.segments[${i}].state '${s.state}' not in WF.STATE`, 'segst:' + mid); break; }
        if (s.t1 != null && s.t1 < s.t0) { warn('events', `${mid}.segments[${i}] ends before it starts`, 'segneg:' + mid); break; }
        if (i && segs[i - 1].t1 != null && Math.abs(segs[i - 1].t1 - s.t0) > 1.0001) { warn('events', `${mid}.segments not contiguous at ${clk(s.t0)} (gap/overlap ${f2(s.t0 - segs[i - 1].t1)} s)`, 'seggap:' + mid); break; }
      }
      const last = segs[segs.length - 1];
      if (last && last.state !== m.state) warn('events', `${mid}: last segment shows '${last.state}' but machine is '${m.state}' (status band ≠ pill)`, 'seglast:' + mid);
      if (segs.length && segs[0].t1 != null && segs[0].t1 < t - 26 * H) warn('events', `${mid}.segments keeps more than 24 h (first ends ${clk(segs[0].t1)})`, 'seg24:' + mid);
    }
  });
  if (safeJSON(st) == null) warn('api', 'JSON.stringify(WF.sim.state) fails (circular references?) – AI context / debugging harder', 'stjson');
}

// ------------------------------------------------------------------ Test 11: Realismus (nur Warnungen)
function realismSnapshot(ctx) {
  let agvTr = 0, agvDone = 0, stapTr = 0, stapDone = 0, extIn = 0, extOut = 0;
  for (const r of ctx.trSeen.values()) {
    if (r.mode === 'AGV') { agvTr++; if (r.done) agvDone++; }
    else if (r.mode === 'Stapler') { stapTr++; if (r.done) stapDone++; }
    if (r.kind === 'ext-in') extIn++;
    if (r.kind === 'ext-out') extOut++;
  }
  return {
    toolChanged: ctx.count.toolChanged, toolPlanned: ctx.count.toolPlanned, setup: ctx.count.setup, fpi: ctx.count.fpi, faults: ctx.count.fault,
    agv: Math.max(agvTr, ctx.trEvents.AGV), agvDone, stapler: Math.max(stapTr, ctx.trEvents.Stapler), stapDone,
    extOut, extIn: Math.max(extIn, ctx.extReturned.size), ghostRun: ctx.ghostRun, types: { ...ctx.typeCounts },
  };
}
function evaluateRealism(r, oee, ctx) {
  if (!r) { warn('realism', 'no 24 h realism snapshot (run aborted early)'); return; }
  note('realism', `first 24 h: toolChanged ${r.toolChanged} (planned ${r.toolPlanned}), setups ${r.setup}, first-piece ${r.fpi}, faults ${r.faults}, AGV transports ${r.agv} (done ${r.agvDone}), forklift ${r.stapler} (done ${r.stapDone}), ext out ${r.extOut} / returns ${r.extIn}, ghost-shift samples ${r.ghostRun}`);
  const need = [['toolChanged', 3, 'tool changes'], ['setup', 3, 'setups'], ['fpi', 2, 'first-piece inspections'], ['agv', 5, 'AGV transports'], ['stapler', 2, 'forklift transports'], ['extIn', 1, 'returns from external hardening']];
  for (const [k, n, label] of need) { if (!(r[k] >= n)) warn('realism', `only ${r[k]} ${label} in the first 24 h (expected ≥ ${n})`, 'rz:' + k); else ok('realism'); }
  if (!(r.faults >= 1)) warn('realism', 'no machine fault in 24 h (13 machines, MTBF 35–60 h → several expected)', 'rz:fault'); else ok('realism');
  if (!(r.ghostRun > 0)) warn('realism', "no 'auto' machine ran while nobody was in the hall (Geisterschicht §3.1)", 'rz:ghost'); else ok('realism');
  const out = [];
  for (const mid of MACHINE_IDS_LIST) {
    if (STATION[mid].kind !== 'machine') continue;
    let v = oee[mid], src = 'machineView.oee';
    if (!num(v)) { const s = ctx.staffedSamples[mid] || {}; const tot = Object.values(s).reduce((a, b) => a + b, 0); v = tot ? (s.running || 0) / tot : NaN; src = 'running share'; }
    if (num(v) && (v < 0.25 || v > 0.95)) out.push(`${mid} ${(v * 100).toFixed(0)} %`); else if (num(v)) ok('realism');
    if (num(v) && (v < -1e-9 || v > 1 + 1e-9)) warn('kpi', `machineView('${mid}').oee = ${v} outside [0,1] (fmtPct expects 0..1)`, 'moee:' + mid);
    if (src === 'running share') warn('realism', 'machineView(id).oee missing – realism uses the sampled running share instead', 'oeesrc');
  }
  if (out.length) warn('realism', `machine OEE${ctx.oeeDay ? ' (Mo 00:00–23:50)' : ''} outside 25–95 %: ${out.join(', ')}`, 'oee');
  const ov = MACHINE_IDS_LIST.filter((mid) => num(oee[mid])).map((mid) => `${mid} ${(oee[mid] * 100).toFixed(0)}`).join(' · ');
  if (ov) note('realism', `machine OEE %${ctx.oeeDay ? ' Mo (first production day)' : ''}: ${ov}`);
  const st = ctx.stateSamples, never = MACHINE_IDS_LIST.filter((mid) => STATION[mid].kind === 'machine' && !(st[mid] && st[mid].running));
  if (never.length) warn('realism', `machines never seen 'running' in the whole run: ${never.join(', ')}`, 'neverrun');
}

// ------------------------------------------------------------------ Test 10: Aktionen (Lauf B)
class Abort extends Error {}
function apiPhase(ctx) {
  const A = SIM.actions || {};
  const step = (sec) => { if (!simCall(`advance(${sec})`, () => SIM.advance(sec))) throw new Abort(); chunkCheck(ctx, sec); };
  const st0 = S();
  let guardN = 0;
  while (!(tod(S().t) >= 10 * H && tod(S().t) < 12 * H && Math.floor(S().t / DAY) % 7 < 5) && guardN++ < 400) step(CHUNK);
  viewChecks(ctx, S().t);
  // advance() > 3600 s → höchstens 3600 Unterschritte (§3.1) – nur Hinweis
  const machinesOf = (pred) => MACHINE_IDS_LIST.filter((id) => STATION[id].kind === 'machine' && pred(S().machines[id]));
  // --- triggerFault → crit-Benachrichtigung → Reparatur ≤ 90 min
  if (typeof A.triggerFault === 'function') {
    const mid = machinesOf((m) => m && m.state === 'running')[0] || machinesOf((m) => m && m.state !== 'fault')[0];
    const t0 = S().t;
    ctx.notifyLog = [];
    simCall(`actions.triggerFault('${mid}')`, () => A.triggerFault(mid));
    let m = S().machines[mid];
    if (m.state !== 'fault') { step(1); m = S().machines[mid]; if (m.state === 'fault') warn('api', 'actions.triggerFault takes effect only on the next advance (expected immediately)', 'tfdelay'); }
    if (m.state !== 'fault') fail('api', `${at(t0)} actions.triggerFault('${mid}') did not put the machine into 'fault' (state '${m.state}')`);
    else {
      ok('api');
      const hasCrit = () => vals(S().notifications).some((n) => n.sev === 'crit' && n.entity && n.entity.id === mid && n.status !== 'resolved') || ctx.notifyLog.some((n) => n && n.sev === 'crit' && n.entity && n.entity.id === mid);
      if (!hasCrit()) step(1);
      if (!hasCrit()) fail('api', `${at(t0)} no 'crit' notification for ${mid} after triggerFault (§3.9: Störung → crit)`); else ok('api');
      if (!firstDef(m.alarm, m.fault, m.alm)) warn('api', `machine in fault exposes no alarm {code,text,cause} (looked at m.alarm / m.fault)`, 'alarmfield');
      const reps = Object.keys(S().people).filter((pid) => { const p = S().people[pid]; return skillsOf(p, pid).includes('repair') && shiftOf(p, pid) === expectedShift(S().t); });
      let repairedT = null, repairer = null;
      for (let s = 0; s < 90 * 60 && repairedT == null; s += 60) {
        step(60);
        const st = S();
        for (const pid of Object.keys(st.people)) { const tk = taskOf(st, st.people[pid]); if (tk && taskStationOf(tk) === mid && /repair/i.test(taskTypeOf(tk))) repairer = pid; }
        if (st.machines[mid].state !== 'fault') repairedT = st.t;
      }
      if (repairedT == null) {
        if (reps.length) fail('api', `${at(S().t)} ${mid} still in 'fault' 90 sim-min after triggerFault at ${clk(t0)} although ${reps.join(', ')} (skill 'repair') are on shift`);
        else warn('api', `no repair-skilled person on shift at ${clk(t0)} – repair window not checked`);
      } else {
        ok('api');
        note('api', `triggerFault ${mid} at ${clk(t0)} → state '${S().machines[mid].state}' after ${dur(repairedT - t0)}${repairer ? ' (repair by ' + repairer + ')' : ''}`);
        if (repairer && !skillsOf(S().people[repairer], repairer).includes('repair')) warn('api', `${repairer} repaired ${mid} without skill 'repair'`, 'repskill');
        if (!repairer) warn('api', `could not observe a person with a 'repair' task at ${mid} (task.type/task.machine)`, 'norepairer');
        step(CHUNK);
        const still = vals(S().notifications).filter((n) => n.sev === 'crit' && n.entity && n.entity.id === mid && n.status === 'open' && S().machines[mid].state !== 'fault');
        if (still.length) warn('api', `crit notification for ${mid} still 'open' 10 min after the repair (SPEC: auto-resolve)`, 'critopen');
      }
    }
    // --- actions.repair (sofort, Demo)
    const mid2 = machinesOf((m) => m && m.state === 'running' && m.id !== mid)[0] || machinesOf((m) => m && m.state !== 'fault')[0];
    if (mid2 && typeof A.repair === 'function') {
      simCall(`actions.triggerFault('${mid2}')`, () => A.triggerFault(mid2));
      if (S().machines[mid2].state === 'fault') {
        simCall(`actions.repair('${mid2}')`, () => A.repair(mid2));
        let s2 = S().machines[mid2].state;
        if (s2 === 'fault') { step(1); s2 = S().machines[mid2].state; if (s2 !== 'fault') warn('api', 'actions.repair takes effect only on the next advance (SPEC: sofort)', 'repdelay'); }
        if (s2 === 'fault') { step(5); s2 = S().machines[mid2].state; }
        if (s2 === 'fault') fail('api', `${at(S().t)} actions.repair('${mid2}') did not end the fault`); else ok('api');
      }
    }
  }
  // --- ack / resolve
  if (typeof A.ack === 'function' && typeof A.resolve === 'function') {
    const n = vals(S().notifications).find((x) => x.status === 'open');
    if (!n) warn('api', 'no open notification available to test ack/resolve');
    else {
      simCall('actions.ack', () => A.ack(n.id, 'sim.test'));
      const n1 = vals(S().notifications).find((x) => x.id === n.id);
      if (!n1 || n1.status !== 'ack') fail('api', `actions.ack('${n.id}') → status '${n1 && n1.status}' (expected 'ack')`);
      else { ok('api'); if (n1.ackBy !== 'sim.test') warn('api', `ack did not store ackBy (got ${short(n1.ackBy)})`, 'ackby'); if (!num(n1.ackT)) warn('api', 'ack did not store ackT', 'ackt'); }
      simCall('actions.resolve', () => A.resolve(n.id));
      const n2 = vals(S().notifications).find((x) => x.id === n.id);
      if (!n2 || n2.status !== 'resolved') fail('api', `actions.resolve('${n.id}') → status '${n2 && n2.status}' (expected 'resolved')`);
      else { ok('api'); if (!num(n2.resolvedT)) warn('api', 'resolve did not store resolvedT', 'rest'); }
    }
  }
  // --- setPriority
  if (typeof A.setPriority === 'function') {
    const oid = Object.keys(S().orders).find((id) => !isDone(S().orders[id]));
    if (oid) {
      const orig = S().orders[oid].priority;
      simCall('actions.setPriority', () => A.setPriority(oid, 'eil'));
      if (S().orders[oid].priority !== 'eil') fail('api', `actions.setPriority('${oid}','eil') → priority '${S().orders[oid].priority}'`); else ok('api');
      simCall('actions.setPriority', () => A.setPriority(oid, orig || 'normal'));
    }
  }
  // --- connectMachine
  if (typeof A.connectMachine === 'function') {
    simCall('actions.connectMachine', () => A.connectMachine('M10', 2, 'OPC UA (Nachrüstung)'));
    const m = S().machines.M10;
    const lvl = firstDef(m.conn && m.conn.level, m.connLevel, m.level);
    if (lvl === undefined) warn('api', 'cannot verify connectMachine because machine.conn.level missing', 'conn');
    else if (lvl !== 2) fail('api', `actions.connectMachine('M10', 2, …) → conn level ${lvl}`); else ok('api');
  }
  // --- reorder + addOrder
  const mat = PROFILE.materials.slice().sort((a, b) => a.leadMin - b.leadMin)[0];
  const tR = S().t;
  if (typeof A.reorder === 'function' && mat) {
    const oh = firstDef(S().materials[mat.id].onHand, S().materials[mat.id].stock);
    ctx.watchDelivery = { matId: mat.id, tR, last: oh, incT: null, eventT: null, lead: mat.leadMin * 60, puId: null };
    simCall('actions.reorder', () => { const r = A.reorder(mat.id); if (r && r.id) ctx.watchDelivery.puId = r.id; });
  }
  let addId = null, tAdd = S().t, startedT = null, how = '';
  if (typeof A.addOrder === 'function') {
    const spec = {
      customer: 'Testkunde (sim.test)', sector: 'Test',
      part: { no: 'TP-0001', name: 'Testdeckel', material: 'AlMgSi1', drawing: 'TP-0001 Rev. A', weightKg: 2.4 },
      qty: 6, due: S().t + 2 * DAY, priority: 'eil',
      routing: [
        { seq: 10, op: '5-Achs-Fräsen', station: 'M05', setupMin: 30, cycleMin: 12, transferBatch: 6, firstPiece: true,
          material: { id: 'MAT-ALBL', perPart: 1 }, tools: [{ type: 'TT-VHM10', cutMinPerPart: 4 }, { type: 'TT-DR85', cutMinPerPart: 1 }] },
        { seq: 20, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 2, transferBatch: 6 },
        { seq: 30, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { ops: {} },
    };
    simCall('actions.addOrder', () => { addId = A.addOrder(spec); });
    const o0 = addId != null && S().orders[addId];
    if (!o0) fail('api', `actions.addOrder(spec) returned ${short(addId)} – no such order in state.orders`);
    else {
      ok('api');
      const status0 = o0.status;
      viewCall(`orderView('${addId}')`, () => SIM.orderView && SIM.orderView(addId));
      for (let k = 0; k < 16 * 6 && startedT == null; k++) {
        step(CHUNK);
        const st = S(), o = st.orders[addId];
        const on = MACHINE_IDS_LIST.find((id) => opInfo(st, st.machines[id]).orderId === addId && !['idle', 'waitOperator'].includes(st.machines[id].state));
        if (on) { startedT = st.t; how = `${on} in '${st.machines[on].state}'`; }
        else if (opsOf(o, addId).some((x) => (x.done || 0) + (x.scrap || 0) > 0)) { startedT = st.t; how = 'op counters > 0'; }
      }
      if (startedT == null) fail('api', `${at(S().t)} order ${addId} (added ${clk(tAdd)}, priority eil, M05) has not started after 16 sim-h | ${describeOrder(S(), S().orders[addId], addId)}`);
      else { ok('api'); note('api', `addOrder → ${addId} started ${dur(startedT - tAdd)} after creation (${how}); initial status '${status0}'`); }
    }
  }
  const w = ctx.watchDelivery;
  if (w) {
    // eigene Bestellung beobachten (Kanban-Abrufe anderer Bestellungen erhöhen den Bestand ebenfalls)
    const puOf = () => w.puId && vals(S().purchases).find((x) => x.id === w.puId);
    const deliveredT = () => { const pu = puOf(); return pu && pu.status === 'geliefert' && num(pu.deliveredT) ? pu.deliveredT : null; };
    if (w.puId) { w.incT = null; w.eventT = null; while (deliveredT() == null && S().t - w.tR < w.lead + 90 * MIN) step(CHUNK); w.eventT = deliveredT(); }
    while (w.incT == null && w.eventT == null && S().t - w.tR < w.lead + 90 * MIN) step(CHUNK);
    if (w.incT == null && w.eventT == null) warn('api', `actions.reorder('${w.matId}'): no delivery (event or onHand increase) within leadMin ${w.lead / 60} min + 90 min`, 'nodeliv');
    else {
      const tD = w.eventT ?? w.incT;
      note('api', `reorder ${w.matId} at ${clk(w.tR)} → delivery at ${clk(tD)} (leadMin ${w.lead / 60})`);
      if (tD < w.tR + w.lead - CHUNK) warn('api', `reorder ${w.matId}: delivery after ${dur(tD - w.tR)} – earlier than leadMin ${w.lead / 60} min`, 'early');
    }
    ctx.watchDelivery = null;
  }
  // --- moveOp (Alternativmaschine) – danach 1 h weiterrechnen, Invarianten müssen halten
  if (typeof A.moveOp === 'function') {
    const st = S();
    const cands = [];
    for (const oid of Object.keys(st.orders)) {
      const o = st.orders[oid];
      if (isDone(o)) continue;
      for (const x of opsOf(o, oid)) {
        if ((x.station === 'M05' || x.station === 'M06') && !(x.done || x.scrap) && !MACHINE_IDS_LIST.some((id) => opInfo(st, st.machines[id]).key === `${oid}/${x.seq}`)) cands.push({ oid, seq: x.seq, to: x.station === 'M05' ? 'M06' : 'M05' });
      }
    }
    let cand = null; const refused = [];
    for (const c of cands) {
      let r = null;
      simCall('actions.moveOp', () => { r = A.moveOp(c.oid, c.seq, c.to); });
      if (r && r.ok) { cand = c; break; }
      if (!r || typeof r.msg !== 'string' || r.msg.length < 10) fail('api', `actions.moveOp('${c.oid}', ${c.seq}, '${c.to}') refused without explanation (${short(r)})`, 'moveopwhy');
      else refused.push(`${c.oid}/${c.seq}→${c.to}: ${r.msg}`);
    }
    if (refused.length) note('api', `moveOp refused (explained): ${refused.slice(0, 2).join(' | ')}`);
    if (!cand) note('api', 'moveOp: no movable unstarted M05/M06 op available – skipped');
    else {
      const x = opsOf(S().orders[cand.oid], cand.oid).find((y) => y.seq === cand.seq);
      if (!x || x.station !== cand.to) warn('api', `actions.moveOp('${cand.oid}', ${cand.seq}, '${cand.to}') not visible in routing/op station (got ${x && x.station})`, 'moveop');
      else ok('api');
      for (let k = 0; k < 6; k++) step(CHUNK);
    }
  }
  // --- advance(> 3600) → max. 3600 Unterschritte (§3.1)
  const tb = S().t;
  simCall('advance(7200)', () => SIM.advance(7200));
  const dt = S().t - tb;
  if (dt !== 3600 && dt !== 7200) fail('kpi', `advance(7200) moved time by ${dt} s (SPEC: 1-s substeps, max 3600 per call)`);
  else if (dt === 7200) note('kpi', 'advance(7200) advanced 7200 s (SPEC caps one call at 3600 substeps)');
  ctx.lastT = S().t;
  void st0;
}

// ------------------------------------------------------------------ Test 12: Regressionen aus dem Review (Engine-Interna)
// Diese Szenarien nutzen bewusst Engine-Interna (state.tasks, machine.tasks, machine.toolchange …), um die behobenen
// Fehlerklassen festzunageln: Geisterschicht-Empfehlung, angekündigte Werkzeugwechsel, Werkzeugbruch nur beim Schneiden,
// keine Aufgabe überlebt ihren Arbeitsgang, Erstteil-Nacharbeit am letzten Teil, chronologische Auftragskette.
const OPKEYS = ['setup', 'corr', 'load', 'fpi', 'tc', 'offset'];
/** Maschinenaufgaben, die zu einem anderen (beendeten/verlagerten) Arbeitsgang gehören bzw. ohne Arbeitsgang existieren */
function staleTasks(st) {
  const out = [];
  for (const mid of MACHINE_IDS_LIST) {
    const m = st.machines[mid]; if (!m || !m.tasks) continue;
    for (const key of OPKEYS) {
      const tid = m.tasks[key]; if (!tid) continue;
      const tk = st.tasks && st.tasks[tid]; if (!tk || tk.orderId == null) continue;
      if (key === 'tc' && m.toolchange) continue;
      const op = m.op ? st.orders[m.op.oid] : null, seq = op ? op.routing[m.op.idx].seq : null;
      if (!op || tk.orderId !== op.id || tk.seq !== seq) out.push(`${mid}.${key} ${tk.id} (${tk.orderId}/${tk.seq}, ${tk.status}${tk.assignee ? ' ' + tk.assignee : ''}) vs op ${op ? op.id + '/' + seq : '–'}`);
    }
  }
  return out;
}
function checkStaleTasks(st, t, where) {
  const s = staleTasks(st);
  ok('regress');
  if (s.length) fail('regress', `${at(t)} ${where}: machine task survives its operation – ${s[0]}${s.length > 1 ? ' (+' + (s.length - 1) + ')' : ''}`, 'stale:' + s[0].split(' ')[0]);
  const errs = st.engineErrors || [];
  if (errs.length) fail('regress', `${at(t)} engine error caught in a work step: ${errs[0].where} – ${errs[0].msg}`, 'engerr:' + errs[0].msg);
}
function checkOrderChain(t) {
  for (const oid of Object.keys(S().orders)) {
    const ov = SIM.orderView(oid); if (!ov || !Array.isArray(ov.ops)) continue;
    let ps = -Infinity, pe = -Infinity;
    for (const op of ov.ops) {
      ok('regress');
      if (num(op.plannedEnd) && op.plannedEnd < pe - 1) { fail('regress', `${at(t)} orderView('${oid}') AG ${op.seq} plannedEnd ${clk(op.plannedEnd)} lies before the predecessor's end ${clk(pe)} – op chain not chronological`, 'chain:' + oid); break; }
      if (num(op.plannedStart) && !op.complete && op.received === 0 && op.plannedStart < ps - 1) { fail('regress', `${at(t)} orderView('${oid}') AG ${op.seq} plannedStart before predecessor start`, 'chainS:' + oid); break; }
      if (num(op.plannedEnd)) pe = Math.max(pe, op.plannedEnd);
      if (num(op.plannedStart)) ps = Math.max(ps, op.plannedStart);
    }
  }
}
function regressionPhase() {
  const A = SIM.actions;
  const st = () => S();
  const evs = []; const offEv = WF.bus.on('sim:event', (e) => evs.push(e));
  const fresh = () => { evs.length = 0; SIM.init(PROFILE); };
  const step1 = () => SIM.step();
  const stepUntil = (pred, maxSec) => { for (let k = 0; k < maxSec; k++) { if (pred()) return true; step1(); } return pred(); };
  const mv = (id) => SIM.machineView(id);
  const scen = (name, fn) => { try { fn(); } catch (e) { warn('load', `test suite error in regression scenario ${name}: ${errStr(e)}`); } };
  try {
    scen('ghost', () => {
    // ---- H1 Geisterschicht: Prognose stimmt, Aktion wechselt die begrenzenden Werkzeuge und verlängert die Laufzeit
    fresh();
    stepUntil(() => tod(st().t) === 21 * H + 5 && Math.floor(st().t / DAY) === 0, 20 * H);
    const ghosts = vals(st().notifications).filter((n) => n.status !== 'resolved' && String(n.key).startsWith('ghost:'));
    if (!ghosts.length) note('regress', 'no ghost-shift notice on Monday 21:00 – scenario not checked');
    const g0 = ghosts.map((n) => ({ mid: n.key.split(':')[1], stopT: n.ghost && n.ghost.stopT, act: (n.actions || []).map((a) => a.action).find((a) => a.type === 'planToolChange'), sugg: n.suggestion }));
    const stopOf = (mids, until) => { const r = {}; while (st().t < until) { step1(); for (const mid of mids) { const m = st().machines[mid]; if (r[mid] == null && (m.state === 'waitTool' || (m.state !== 'running' && m.state !== 'toolchange' && m.state !== 'firstPiece' && tod(st().t) >= 22 * H))) r[mid] = st().t; } } return r; };
    const untilT = Math.floor(st().t / DAY) * DAY + DAY + 6 * H;
    const stopsA = stopOf(g0.map((g) => g.mid), untilT);
    for (const g of g0) {
      ok('regress');
      if (num(g.stopT) && num(stopsA[g.mid]) && Math.abs(stopsA[g.mid] - g.stopT) > 20 * MIN) fail('regress', `ghost notice ${g.mid} predicted stop ${clk(g.stopT)} but the machine stopped at ${clk(stopsA[g.mid])}`, 'ghostpred:' + g.mid);
      if (!g.act && !/Schwesterwerkzeug|Nachtbemannung|Rufbereitschaft/.test(String(g.sugg))) fail('regress', `ghost notice ${g.mid} offers no action but does not explain why (suggestion: ${short(g.sugg)})`, 'ghostwhy:' + g.mid);
    }
    if (g0.some((g) => g.act)) {
      fresh();
      stepUntil(() => tod(st().t) === 21 * H + 5 && Math.floor(st().t / DAY) === 0, 20 * H);
      for (const g of g0.filter((x) => x.act)) {
        const r = SIM.runAction(g.act);
        ok('regress');
        if (!r || !r.ok) { fail('regress', `ghost action for ${g.mid} (${short(g.act)}) failed: ${r && r.msg}`, 'ghostact:' + g.mid); continue; }
        const v = mv(g.mid);
        for (const ty of g.act.types || []) {
          const tl = v.tools.find((x) => x.typeId === ty);
          ok('regress');
          if (!tl || tl.status !== 'planned' || !tl.plannedChange || !tl.manualOrder) fail('regress', `${g.mid}: after ordering the preventive change, machineView shows ${ty} as '${tl && tl.status}' / manualOrder ${short(tl && tl.manualOrder)} (expected 'planned' + manualOrder)`, 'manualview:' + ty);
        }
      }
      const n0 = evs.length;
      const stopsB = stopOf(g0.map((g) => g.mid), untilT);
      for (const g of g0.filter((x) => x.act)) {
        const changed = new Set();
        for (const e of evs.slice(n0)) if (e.type === 'toolChanged' && e.entity && e.entity.id === g.mid && e.t < Math.floor(e.t / DAY) * DAY + 22 * H + 15 * MIN) for (const x of (e.data && e.data.tools) || []) changed.add(x.typeId);
        ok('regress');
        for (const ty of g.act.types) if (!changed.has(ty)) fail('regress', `ghost action for ${g.mid}: ${ty} was not changed before the ghost shift`, 'ghostnot:' + ty);
        const a = stopsA[g.mid] ?? untilT, b = stopsB[g.mid] ?? untilT;
        if (b < a + 20 * MIN) fail('regress', `ghost action for ${g.mid} did not extend the unattended run (stop ${clk(a)} → ${clk(b)})`, 'ghostgain:' + g.mid);
        else note('regress', `ghost shift ${g.mid}: stop ${clk(a)} without, ${num(stopsB[g.mid]) ? clk(b) : 'none until 06:00'} with the recommended change (${g.act.types.join(', ')})`);
      }
    }

    });
    scen('announced', () => {
    // ---- H2/H7 Jeder Werkzeugwechsel ist eine Sekunde vorher in machineView als 'planned'/'due'/'broken' sichtbar
    fresh();
    const m3 = st().machines.M03;
    if (m3 && m3.op && m3.setupDone) {
      const r = A.planToolChange('M03');
      ok('regress');
      if (!r || !r.ok) note('regress', `planToolChange('M03') at start: ${r && r.msg}`);
      else for (const ty of r.types || []) { const tl = mv('M03').tools.find((x) => x.typeId === ty); if (!tl || tl.status !== 'planned' || !(tl.plannedChange && tl.plannedChange.manual) || !/Vorbeugender Wechsel beauftragt/.test(tl.explain)) fail('regress', `planToolChange('M03'): machineView shows ${ty} as '${tl && tl.status}' (${short(tl && tl.explain)}) – manual change not visible`, 'manual03'); }
    }
    let changes = 0, unannounced = 0;
    const prevView = {};
    for (let k = 0; k < 20 * H; k++) {
      for (const mid of MACHINE_IDS_LIST) {
        const m = st().machines[mid];
        if (!m.toolchange && m.op && (st().tasks[m.tasks.tc] || m.manualTC) && (!m.part || m.part.rem <= 1)) prevView[mid] = { t: st().t, tools: mv(mid).tools };
      }
      const had = {}; for (const mid of MACHINE_IDS_LIST) had[mid] = !!st().machines[mid].toolchange;
      step1();
      for (const mid of MACHINE_IDS_LIST) {
        const m = st().machines[mid];
        if (!m.toolchange || had[mid]) continue;
        changes++;
        const pv = prevView[mid];
        for (const x of m.toolchange.list) {
          const v = pv && pv.t >= st().t - 2 ? pv.tools.find((y) => y.id === x.toolId) : null;
          ok('regress');
          if (!v || !['planned', 'due', 'broken'].includes(v.status)) { unannounced++; fail('regress', `${at(st().t)} ${mid}: ${x.type} swapped although machineView one second earlier showed '${v ? v.status : 'nothing'}'${v ? ' (' + v.wearPct + ' %, „' + String(v.explain).slice(0, 90) + '“)' : ''}`, 'unann:' + mid + x.type); }
        }
      }
    }
    note('regress', `announced tool changes: ${changes - unannounced}/${changes} tool-change starts in 20 h showed every swapped tool as planned beforehand`);

    });
    scen('toolbreak', () => {
    // ---- H3 Werkzeugbruch nur beim Schneiden; danach wird nie mit dem gebrochenen Werkzeug geschnitten
    fresh();
    const brkCode = (PROFILE.faults.generic || []).find((f) => f.toolBreak);
    if (brkCode) {
      let lm = null;
      stepUntil(() => (lm = MACHINE_IDS_LIST.map((id) => st().machines[id]).find((m) => m.loading === 'perPart' && m.part && m.part.sub === 'load' && !m.fault && ['lathe', 'biglathe', 'mill3', 'mill5', 'hobber', 'deephole'].includes(m.type))), 6 * H);
      if (lm) {
        const r = A.triggerFault(lm.id, brkCode.code);
        ok('regress');
        if (r && r.ok) fail('regress', `${at(st().t)} triggerFault('${lm.id}', '${brkCode.code}') accepted while the part is being loaded (nothing is cut)`, 'brkload');
        else note('regress', `tool break during loading on ${lm.id} rejected: ${r && r.msg}`);
      } else note('regress', 'no machine in load phase found – tool-break-on-load scenario not checked');
      let cm = null;
      stepUntil(() => (cm = MACHINE_IDS_LIST.map((id) => st().machines[id]).find((m) => m.part && m.part.sub === 'cut' && !m.fault && !m.setupRun && !m.toolchange && ['lathe', 'mill3', 'mill5', 'hobber', 'deephole', 'swiss', 'biglathe'].includes(m.type) && m.part.rem > 60)), 6 * H);
      if (cm) {
        const usedBefore = {}; for (const tid of cm.tools) usedBefore[tid] = st().tools[tid].used;
        const r = A.triggerFault(cm.id, brkCode.code);
        ok('regress');
        if (!r || !r.ok) fail('regress', `triggerFault('${cm.id}', '${brkCode.code}') rejected while cutting: ${r && r.msg}`, 'brkcut');
        else {
          const broken = cm.tools.map((id) => st().tools[id]).filter((tl) => tl.broken);
          if (cm.part) fail('regress', `${cm.id}: part still in the machine after a tool break (should be scrap)`, 'brkpart');
          if (broken.length !== 1) fail('regress', `${cm.id}: tool break marked ${broken.length} tools as broken`, 'brkn');
          for (const tl of broken) if (Math.abs(tl.used - usedBefore[tl.id]) > 1e-9) fail('regress', `${cm.id}: broken tool ${tl.id} wear jumped ${usedBefore[tl.id]} → ${tl.used} (should keep its real wear)`, 'brkused');
          A.repair(cm.id);
          let changed = false;
          for (let k = 0; k < 3 * H && !changed; k++) {
            step1();
            const m = st().machines[cm.id];
            if (m.part && m.part.sub === 'cut' && m.tools.some((id) => st().tools[id] && st().tools[id].broken)) { fail('regress', `${at(st().t)} ${cm.id} cuts with a broken tool after the repair`, 'brkcutafter'); break; }
            if (evs.some((e) => e.type === 'toolChanged' && e.entity.id === cm.id && /bruch/i.test(String(e.data && e.data.cause)))) changed = true;
          }
          ok('regress');
          if (!changed) warn('regress', `${cm.id}: broken tool not changed within 3 h after the repair (staffing?)`, 'brknochg');
          else note('regress', `tool break while cutting on ${cm.id}: part scrapped, ${broken.map((x) => x.typeId).join(', ')} broken at real wear, changed after the repair before the next cut`);
        }
      }
    }

    });
    scen('stale', () => {
    // ---- H4/H5 Keine Aufgabe überlebt ihren Arbeitsgang (Verlagern während Rüst-/Werkzeugauftrag), kein Absturz
    fresh();
    let moves = 0, lastPlanRefused = false;
    const tryMove = (m) => {
      const o = st().orders[m.op.oid], r = o.routing[m.op.idx];
      for (const to of MACHINE_IDS_LIST) { if (to === m.id) continue; const res = A.moveOp(o.id, r.seq, to); if (res && res.ok) { moves++; return true; } }
      return false;
    };
    for (let k = 0; k < 30 * H; k++) {
      step1();
      if (k % 10) continue;
      checkStaleTasks(st(), st().t, 'per 10 s');
      if (moves < 6) for (const mid of MACHINE_IDS_LIST) {
        const m = st().machines[mid]; if (!m.op || m.part || m.fpi || m.setupRun || m.toolchange || m.fault || m.needCorr) continue;
        const su = st().tasks[m.tasks.setup], tc = st().tasks[m.tasks.tc];
        const fetching = tc && tc.assignee && tc.workStarted && tc.steps[tc.si] && tc.steps[tc.si].act === 'fetch';
        if ((su && su.assignee && !su.workStarted) || fetching) { if (tryMove(m)) { step1(); checkStaleTasks(st(), st().t, 'right after moveOp'); } }
      }
      if (!lastPlanRefused && k % 60 === 0) for (const mid of MACHINE_IDS_LIST) {
        const m = st().machines[mid];
        if (m.op && m.setupDone && m.part && SIM.partsLeft(m.op.oid, st().orders[m.op.oid].routing[m.op.idx].seq) === 0 && !m.rework) {
          const r = A.planToolChange(mid);
          ok('regress');
          if (r && r.ok) fail('regress', `${at(st().t)} planToolChange('${mid}') accepted while the last part of the operation runs`, 'planlast');
          lastPlanRefused = true; break;
        }
      }
      if (k % H === 0) checkOrderChain(st().t);
    }
    note('regress', `stale-task scenario: ${moves} moveOp calls during pending setups/tool fetches, invariants checked every 10 s over 30 h`);

    });
    scen('rework', () => {
    // ---- H6 Erstteil-Nacharbeit am einzigen Teil: Auftrag wird fertig, keine negativen Zähler
    fresh();
    const pp = PROFILE.sim.fpiPassProb;
    const id = A.addOrder({ customer: 'Regression', part: { name: 'Einzelteil Ø40', weightKg: 1 }, qty: 1, priority: 'eil',
      routing: [{ op: 'Fräsen', station: 'M06', setupMin: 10, cycleMin: 6, firstPiece: true, tools: [{ type: 'TT-VHM16', cutMinPerPart: 2 }], material: { id: 'MAT-ALBL', perPart: 1 } }, { op: 'Prüfung', station: 'QS', cycleMin: 1 }] });
    if (typeof id === 'string') {
      PROFILE.sim.fpiPassProb = 0;
      let reworked = false, negIP = false;
      for (let k = 0; k < 40 * H; k++) {
        step1();
        if (!reworked && evs.some((e) => e.type === 'fpiNok' && e.data && e.data.rework && e.data.orderId === id)) { reworked = true; PROFILE.sim.fpiPassProb = pp; }
        if (st().orders[id].ops.some((x) => x.inProc < 0)) negIP = true;
        if (st().orders[id].status === 'fertig') break;
      }
      PROFILE.sim.fpiPassProb = pp;
      const o = st().orders[id];
      ok('regress');
      if (!reworked) note('regress', 'qty-1 rework scenario: no rework FPI occurred (measurement out of tolerance → scrap path)');
      if (negIP) fail('regress', `${id}: op.inProc became negative (rework part leaked)`, 'negip');
      if (o.status !== 'fertig') fail('regress', `${id} (qty 1, first piece reworked) not finished after 40 h – status ${o.status}, ops ${short(o.ops.map((x) => [x.station, x.good, x.inProc]))}`, 'rework1');
      else note('regress', `qty-1 order with first-piece rework finished ${clk(o.doneT)} (${o.shippedQty}/${o.qty})`);
    }
    });
  } catch (e) { warn('load', `test suite error in regression phase: ${errStr(e)}`); }
  finally { offEv(); PROFILE.sim.fpiPassProb = PROFILE.sim.fpiPassProb ?? 0.94; }
}

// ------------------------------------------------------------------ Bericht
function report(wallMs, simInfo) {
  const lines = [];
  lines.push(`werkfluss sim.test – ${path.relative(process.cwd(), path.join(SRC, '10_sim.js')) || '10_sim.js'} – ${simInfo}, wall ${(wallMs / 1000).toFixed(1)} s`);
  let nP = 0, nW = 0, nF = 0, nS = 0;
  for (const t of TESTS) {
    const status = t.fails.size ? 'FAIL' : t.warns.size ? 'WARN' : t.checks ? 'PASS' : 'SKIP';
    if (status === 'FAIL') nF++; else if (status === 'WARN') nW++; else if (status === 'PASS') nP++; else nS++;
    const fc = [...t.fails.values()].reduce((a, e) => a + e.n, 0);
    lines.push(`${status.padEnd(4)} ${String(t.no).padStart(2)}  ${t.title}  (${t.checks} checks${fc ? `, ${fc} violations` : ''}${t.warns.size ? `, ${t.warns.size} warnings` : ''})`);
    const fl = [...t.fails.values()];
    for (const e of fl.slice(0, MAX_MSGS)) lines.push(`        FAIL ${e.msg}${e.n > 1 ? `  (×${e.n})` : ''}`);
    if (fl.length > MAX_MSGS) lines.push(`        … ${fl.length - MAX_MSGS} more distinct failures (--max-msgs=N)`);
    const wl = [...t.warns.values()];
    for (const e of wl.slice(0, MAX_MSGS)) lines.push(`        warn ${e.msg}${e.n > 1 ? `  (×${e.n})` : ''}`);
    if (wl.length > MAX_MSGS) lines.push(`        … ${wl.length - MAX_MSGS} more warnings`);
    const showNotes = VERBOSE || t.key === 'deadlock' || t.key === 'realism' || t.key === 'api' || t.key === 'regress';
    if (showNotes) for (const n of t.notes.slice(0, VERBOSE ? 200 : 14)) lines.push(`        info ${n}`);
  }
  lines.push(`Totals: ${nP} PASS · ${nW} WARN · ${nF} FAIL${nS ? ` · ${nS} SKIP (not reached)` : ''}${wallMs > 20000 ? `  (suite took ${(wallMs / 1000).toFixed(1)} s > 20 s target)` : ''}`);
  console.log(lines.join('\n'));
  return nF;
}

// ------------------------------------------------------------------ Hauptprogramm
function main() {
  const wall0 = performance.now();
  let simInfo = 'not run';
  const finish = () => { const nF = report(performance.now() - wall0, simInfo); process.exitCode = nF ? 1 : 0; };
  installNonDetCounters();
  if (!loadEngine()) return finish();
  WF.bus.on('sim:reset', () => { RESETS++; });
  WF.bus.on('sim:event', onSimEvent);
  WF.bus.on('sim:notify', onSimNotify);
  const profHash0 = WF.util.hash(safeJSON(PROFILE) || '');
  const nChunks = Math.round(HOURS * H / CHUNK), n24 = Math.round(24 * H / CHUNK);

  // ---------------- Lauf A
  const A = newCtx('A');
  CUR = A;
  let r0 = RESETS;
  if (!simCall('init(profile)', () => SIM.init(PROFILE))) return finish();
  if (RESETS === r0) fail('api', "init(profile) did not emit 'sim:reset' (§3.10)"); else ok('api');
  if (!afterInit(A)) return finish();
  const P0 = projection(S()), C0 = compactProjection(S());
  let P24 = null, C24 = null, simSecA = 0;
  const tA = performance.now();
  for (let i = 1; i <= nChunks; i++) {
    if (!simCall(`advance(${CHUNK})`, () => SIM.advance(CHUNK))) break;
    simSecA += CHUNK;
    chunkCheck(A, CHUNK);
    if (i === n24) { P24 = projection(S()); C24 = compactProjection(S()); A.r24 = realismSnapshot(A); }
    if (i > n24 && i % 6 === 0) viewChecks(A, S().t);
    // Maschinen-OEE des ersten vollen Produktionstags (Mo bis 23:50) für den Realismus-Check
    if (!A.oeeDay && tod(S().t) === 23 * H + 50 * MIN) { A.oeeDay = {}; viewChecks(A, S().t, { oee: A.oeeDay }); }
    if (performance.now() - wall0 > BUDGET_MS) { warn('deadlock', `stopped after ${simSecA / H} sim-h: wall-clock budget ${BUDGET_MS / 1000} s exceeded`); break; }
  }
  const wallA = performance.now() - tA;
  const oee = {};
  viewChecks(A, S().t, { oee });
  finalChecksA(A);
  evaluateRealism(A.r24, A.oeeDay && Object.keys(A.oeeDay).length ? A.oeeDay : oee, A);
  if (A.maxSnap) note('api', `largest snapshot(): ${A.maxSnap} chars`);
  if (WF.util.hash(safeJSON(PROFILE) || '') !== profHash0) warn('determinism', 'engine mutated WF.profile during the run – re-init/reset may not reproduce the start state');
  simInfo = `run A ${simSecA / H} sim-h in ${(wallA / 1000).toFixed(1)} s (${Math.round(simSecA / Math.max(0.001, wallA / 1000))} sim-s/s)`;
  A.active = false;

  // ---------------- Lauf B (gleicher Seed, identisches Aufrufmuster)
  const B = newCtx('B');
  CUR = B;
  r0 = RESETS;
  if (simCall('init(profile) #2', () => SIM.init(PROFILE)) && afterInit(B)) {
    compareProj('state right after init (run 1 vs run 2)', P0, projection(S()));
    let okB = true;
    for (let i = 1; i <= n24 && okB; i++) { okB = simCall(`advance(${CHUNK})`, () => SIM.advance(CHUNK)); if (okB) chunkCheck(B, CHUNK); }
    if (okB && P24) {
      const same = compareProj('state after 24 sim-h (run 1 vs run 2)', P24, projection(S()));
      if (!same && hashOf(C24) === hashOf(compactProjection(S()))) note('determinism', 'compact projection (t, machine states/counters, order progress, onHand) is identical – the difference is in detail fields');
      else if (!same) fail('determinism', `compact projection after 24 h differs too: ${firstDiff(C24, compactProjection(S()))}`, 'detc');
    }
    if (okB) {
      try { apiPhase(B); } catch (e) { if (!(e instanceof Abort)) warn('load', `test suite error in API phase: ${errStr(e)}`); }
    }
    // reset() → wieder Startzustand
    if (SIM.actions && typeof SIM.actions.reset === 'function') {
      CUR = null;
      const rb = RESETS;
      if (simCall('actions.reset()', () => SIM.actions.reset())) {
        if (RESETS === rb) fail('api', "actions.reset() did not emit 'sim:reset'"); else ok('api');
        compareProj('state after actions.reset() vs. first init', P0, projection(S()));
      }
    }
  }
  CUR = null;
  regressionPhase();
  if (nonDet.random) warn('determinism', `engine called Math.random() ${nonDet.random}× during simulation/views (SPEC: seeded RNG only)`);
  if (nonDet.dateNow) note('determinism', `engine called Date.now() ${nonDet.dateNow}×`);
  CUR = null;
  finish();
}
main();
