/* werkfluss – Simulations-Engine (10_sim.js → WF.sim)
   ----------------------------------------------------------------------------------------------
   DOM-frei: läuft im Browser und in Node (Tests). Deterministisch: alle Zufallswerte über den
   geseedeten RNG (WF.util.rng(profile.sim.seed)), keine Uhrzeit, kein Math.random.

   Aufbau eines Sim-Schritts (1 s, siehe step()):
     Schicht/Pausen → Lieferungen & Fremdbearbeitung → Maschinen (Zustandsautomat §3.2/§3.3)
     → Transporte (AGV/Stapler) → Aufgabenvergabe an Personen → Personen bewegen/arbeiten
     → AGVs → Kennzahlen/Energie → Regeln & Benachrichtigungen → Historie

   Grundsatz „kein sinnloser Ablauf“: Jede Zustandsänderung läuft über eine Funktion, die eine
   Ursache (Text) mitschreibt (setState → Event 'state' {from,to,cause}). Werkzeuge folgen genau
   einer sichtbaren Regel (§3.4, toolRule()). Personen tun nur, was eine Aufgabe (Task) verlangt.
*/
(function () {
  'use strict';
  const G = typeof window !== 'undefined' && window ? window : globalThis;
  const WF = G.WF = G.WF || {};
  const U = WF.util;
  const DAY = 86400, WEEK = 7 * DAY;

  // ------------------------------------------------------------------ Konfiguration
  const CFG = {
    precallSec: 150,       // perPart: Bediener wird so viele s vor Zyklusende gerufen (kein Leerlauf)
    agvHandleSec: 30,      // Be-/Entladen (aus profile.sim.agvLoadSec)
    fpiPickSec: 30,        // Erstteil an der Maschine entnehmen
    correctionSec: 600,    // Korrektur nach Erstteil n.i.O. (10 min)
    dressSec: 90,          // Abrichten Schleifscheibe (1,5 min)
    extHandoverSec: 1200,  // Bereitstellung Fremdbearbeitung → Abholung Spedition
    barsPickSec: 90, barsLoadSec: 180, barLenM: 3,
    waitWarnSec: 300, toolWarnSec: 180, fpiWarnSec: 600,
    idleHomeSec: 40,
    pickEverySec: 10, switchCheckSec: 30,
    batteryLow: 25, batteryFull: 90, batteryAssign: 30, agvDrain: 0.05, agvCharge: 0.12,
    basePowerKw: 12,
    eventsMax: 3000, notificationsMax: 400, measMax: 200, transportsKeepSec: DAY, toolsKeep: 150,
  };
  // Vergabe-Priorität (§3.5): repair > toolChange-wartend > fpi > setup > load > forklift/bars > inspect > assembly > toolChange-geplant
  const PRIO = { repair: 100, toolChangeWait: 90, fpi: 80, correction: 72, setup: 70, load: 60, forklift: 50, bars: 50, inspect: 40, assembly: 35, toolChange: 30 };
  const TASK_LABEL = { setup: 'Rüsten', load: 'Einlegen', toolChange: 'Werkzeugwechsel', fpi: 'Erstteilprüfung', inspect: 'Losprüfung',
    repair: 'Reparatur', forklift: 'Staplertransport', bars: 'Stangen nachladen', assembly: 'Montage', correction: 'Korrektur' };
  // Engine-Default-Hauptmerkmal je Maschinentyp (falls im Arbeitsgang kein char definiert ist)
  const DEFAULT_CHAR = {
    saw:        { name: 'Zuschnittlänge (Abw.)', nominal: 0, tolMinus: -0.5, tolPlus: 0.5, unit: 'mm', sigma: 0.1, driftAt100: 0.15 },
    lathe:      { name: 'Durchmesser (Abw.)', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.004, driftAt100: 0.008 },
    swiss:      { name: 'Durchmesser (Abw.)', nominal: 0, tolMinus: -0.01, tolPlus: 0.01, unit: 'mm', sigma: 0.002, driftAt100: 0.004 },
    biglathe:   { name: 'Lagersitz (Abw.)', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.012 },
    mill5:      { name: 'Position Bohrbild', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.004, driftAt100: 0.008 },
    mill3:      { name: 'Ebenheit / Position', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.01 },
    deephole:   { name: 'Bohrungs-Ø (Abw.)', nominal: 0, tolMinus: -0.05, tolPlus: 0.05, unit: 'mm', sigma: 0.01, driftAt100: 0.02 },
    hobber:     { name: 'Zahnweite (Abw.)', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.012 },
    cylgrinder: { name: 'Durchmesser geschliffen (Abw.)', nominal: 0, tolMinus: -0.006, tolPlus: 0.006, unit: 'mm', sigma: 0.0014, driftAt100: 0.003 },
    surfgrinder:{ name: 'Dicke (Abw.)', nominal: 0, tolMinus: -0.01, tolPlus: 0.01, unit: 'mm', sigma: 0.0022, driftAt100: 0.004 },
    washer:     { name: 'Restschmutz', nominal: 1.5, tolMinus: -1.5, tolPlus: 2.5, unit: 'mg', sigma: 0.35, driftAt100: 0 },
    cmm:        { name: 'Prüfmerkmal Lage (Abw.)', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.0035, driftAt100: 0 },
    assembly:   { name: 'Anzugsmoment Verschraubung', nominal: 25, tolMinus: -2.5, tolPlus: 2.5, unit: 'Nm', sigma: 0.5, driftAt100: 0 },
  };
  const STOCK_DEFAULT = { insert: 8, drill: 4, mill: 4, hob: 2, wheel: 2, saw: 3 };
  // typische Spindeldrehzahlen (für Signale bei Anschluss-Level ≥ 2)
  const RPM = { saw: 45, lathe: 2400, swiss: 6500, biglathe: 380, mill5: 12000, mill3: 8000, deephole: 650, hobber: 900,
    cylgrinder: 1800, surfgrinder: 1500, washer: 0, cmm: 0, assembly: 0 };
  const EXTRA_FAULTS = {
    cmm: [{ code: 'KMG 101', text: 'Tastkopf-Kollision', cause: 'Taster neu einmessen', repairMin: [10, 20] }],
    assembly: [{ code: 'MT 12', text: 'Schraubersteuerung meldet Fehler', cause: 'Akku-Schrauber kalibrieren', repairMin: [8, 15] }],
  };

  // ------------------------------------------------------------------ Modulzustand
  let P = null, S = null, R = null, ST = null, TT = null, GRAPH = null;
  let SH = [], WORKWIN = [], NIDX = {}, FC = null, cur = null;
  let WALK = 1.3, FORK = 2.0, PLAN_AT = 2;
  let MA = [], PA = [], AA = [];   // Arrays der Maschinen/Personen/AGVs (schnelle Schleifen)
  let CV = 0, INB = null;          // Behälter-Version (Cache-Invalidierung) und Cache für inboundQty

  // ------------------------------------------------------------------ kleine Helfer
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const nm = (n, d) => U.fmtNum(n, d || 0);
  const sn = (name) => { const p = String(name || '').split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(name || ''); };
  const pname = (id) => (S.people[id] ? sn(S.people[id].name) : '–');
  const tclock = (t) => (Math.floor(t / DAY) === Math.floor(S.t / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const stShort = (id) => (ST[id] ? (ST[id].short || ST[id].name) : id);
  const mLabel = (id) => (ST[id] && ST[id].kind !== 'zone' && ST[id].kind !== 'store' ? id + ' ' + (ST[id].short || '') : stShort(id));
  const isMachineSt = (id) => !!(S && S.machines[id]);
  const teile = (n) => n + (n === 1 ? ' Teil' : ' Teile');
  const opBatch = (r) => Math.max(1, r.transferBatch || 10);
  const sumArr = (a) => { let s = 0; for (const x of a || []) s += x; return s; };
  /** deterministisches Rauschen ohne RNG-Verbrauch (für Signale) */
  const hnoise = (a, b) => { let h = Math.imul((a | 0) ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x632BE5AB, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return ((h >>> 0) / 4294967296) * 2 - 1; };

  // ------------------------------------------------------------------ Zeit & Schichten
  function shiftInfo(t) {
    const day = Math.floor(t / DAY), dow = ((day % 7) + 7) % 7, s = t - day * DAY;
    if (dow >= 5) return null; // Wochenende: keine Schicht
    for (const sh of SH) {
      if (s >= sh.start && s < sh.end) {
        let br = null;
        for (const b of sh.breaks) if (s >= b[0] && s < b[1]) { br = b; break; }
        return { sh, day, inBreak: !!br, breakEnd: br ? day * DAY + br[1] : null, end: day * DAY + sh.end };
      }
    }
    return null;
  }
  function buildWorkWindows() {
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of SH) {
      let a = sh.start;
      for (const b of sh.breaks) { if (b[0] > a) w.push([d * DAY + a, d * DAY + b[0]]); a = b[1]; }
      if (sh.end > a) w.push([d * DAY + a, d * DAY + sh.end]);
    }
    return w.sort((x, y) => x[0] - y[0]);
  }
  /** Arbeitszeit (Schichtzeit ohne Pausen) ab t addieren → Endzeitpunkt. */
  function addWork(t, sec) {
    if (!(sec > 0)) return t;
    let base = Math.floor(t / WEEK) * WEEK;
    for (let guard = 0; guard < 60; guard++) {
      for (const w of WORKWIN) {
        const a = base + w[0], b = base + w[1];
        if (b <= t) continue;
        const s = Math.max(a, t), cap = b - s;
        if (sec <= cap) return s + sec;
        sec -= cap; t = b;
      }
      base += WEEK;
    }
    return t + sec;
  }
  /** nächster Beginn einer Arbeitszeit ≥ t */
  function nextWorkStart(t) {
    let base = Math.floor(t / WEEK) * WEEK;
    for (let guard = 0; guard < 4; guard++) {
      for (const w of WORKWIN) { const a = base + w[0], b = base + w[1]; if (b > t) return Math.max(a, t); }
      base += WEEK;
    }
    return t;
  }
  /** Spedition/Lieferanten: Mo–Fr 06:00–20:00 */
  function inDayWindow(t) { const d = ((Math.floor(t / DAY) % 7) + 7) % 7, s = t % DAY; return d < 5 && s >= 6 * 3600 && s < 20 * 3600; }
  function nextDayWindow(t) {
    if (inDayWindow(t)) return t;
    let d = Math.floor(t / DAY); const s = t - d * DAY;
    if (d % 7 < 5 && s < 6 * 3600) return d * DAY + 23400;
    d++; while (d % 7 >= 5) d++;
    return d * DAY + 23400; // 06:30
  }

  // ------------------------------------------------------------------ Bewegung auf dem Wegenetz
  function stPos(sid, at) {
    const s = ST[sid]; if (!s) return null;
    if (at && typeof at === 'object') return at;
    if (at === 'in') return s.inPos; if (at === 'out') return s.outPos;
    return s.work;
  }
  /** Route von der aktuellen Position über das Wegenetz zu toNode, danach kurzes Stück zu endPos. */
  function routeTo(ent, toNode, endPos) {
    let from = ent.node; const r0 = ent.route;
    if (r0) { // Umplanung unterwegs: ab dem nächsten Knoten in Fahrtrichtung
      let k = r0.i + 1; while (k < r0.nodes.length && !r0.nodes[k]) k++;
      if (k < r0.nodes.length) from = r0.nodes[k];
    }
    const pts = [], nodes = [];
    const push = (x, z, id) => {
      const l = pts[pts.length - 1];
      if (l && Math.abs(l.x - x) < 1e-3 && Math.abs(l.z - z) < 1e-3) { if (id) nodes[nodes.length - 1] = id; return; }
      pts.push({ x, z }); nodes.push(id || null);
    };
    push(ent.pos.x, ent.pos.z, null);
    const gp = U.path(GRAPH, from, toNode);
    for (const id of gp.nodes) { const n = GRAPH.nodes[id]; push(n.x, n.z, id); }
    if (endPos) push(endPos.x, endPos.z, null);
    const seg = []; let len = 0;
    for (let k = 0; k < pts.length - 1; k++) { const d = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z); seg.push(d); len += d; }
    ent.route = { pts, nodes, seg, i: 0, f: 0, len, toNode };
    if (nodes[0]) ent.node = nodes[0];
    return ent.route;
  }
  /** bewegt ent um d Meter entlang der Route; true = angekommen */
  function moveEnt(ent, d) {
    const r = ent.route;
    while (r.i < r.pts.length - 1) {
      const L = r.seg[r.i], a = r.pts[r.i], b = r.pts[r.i + 1];
      if (L > 1e-9) ent.heading = Math.atan2(b.x - a.x, b.z - a.z);
      const left = L - r.f;
      if (d < left) { r.f += d; const k = r.f / L; ent.pos.x = a.x + (b.x - a.x) * k; ent.pos.z = a.z + (b.z - a.z) * k; return false; }
      d -= left; r.i++; r.f = 0; ent.pos.x = b.x; ent.pos.z = b.z;
      if (r.nodes[r.i]) ent.node = r.nodes[r.i];
    }
    return true;
  }
  function routeLeft(ent) {
    const r = ent.route; if (!r) return 0;
    let s = (r.seg[r.i] || 0) - r.f; for (let k = r.i + 1; k < r.seg.length; k++) s += r.seg[k];
    return s;
  }
  function pathLen(fromNode, sid) { const s = ST[sid]; if (!s || !fromNode) return 30; return U.path(GRAPH, fromNode, s.dockNode).length + 2; }

  // ------------------------------------------------------------------ Initialisierung
  function newStats() {
    const stateSec = {}; for (const k in WF.STATE) stateSec[k] = 0;
    return { stateSec, planned: 0, run: 0, ideal: 0, good: 0, scrap: 0, lossSec: 0, lossEur: 0, energyKwh: 0 };
  }
  function newMachine(st, idx, t0) {
    return {
      id: st.id, idx, name: st.name, short: st.short, kind: st.kind, type: st.type, area: st.area,
      loading: st.loading || 'auto', loadMin: st.loadMin || 0, skill: st.skill, rate: st.rate || 60,
      power: st.power || { idle: 1, run: 5 }, inCap: st.inCap != null ? st.inCap : 3, outCap: st.outCap != null ? st.outCap : 3,
      mtbfH: st.mtbfH || 0, mtbfP: st.mtbfH ? 1 / (st.mtbfH * 3600) : 0, fpiMin: st.fpiMin || 0,
      automation: st.automation || 'none', conn: Object.assign({ level: 0, protocol: '–', gateway: '–' }, st.conn || {}),
      barMagazineM: st.barMagazineM || 0, barReorderM: st.barReorderM || 0, barStockM: st.barMagazineM ? 0 : null, barMat: null,
      state: 'idle', since: t0, cause: 'Kein Arbeitsgang eingeplant', waitCode: null,
      op: null, setupDone: false, released: false, needCorr: false, part: null, dressRem: 0, fpi: null,
      setupRun: null, corrRun: null, toolchange: null, fault: null,
      tools: [], tasks: { setup: null, load: null, tc: null, fpi: null, corr: null, repair: null, attend: null, bars: null },
      segments: [{ t0, t1: null, state: 'idle' }], kd: newStats(), ks: newStats(), counter: 0,
      nextPickT: 0, starvedSince: null, lastSwitchCheck: 0, idleCause: null, signals: null, lastPartT: null,
    };
  }

  function init(profile) {
    P = profile || WF.profile;
    if (!P) throw new Error('WF.sim.init: kein Profil');
    R = U.rng((P.sim.seed >>> 0) || 1);
    U.resetUids(); NIDX = {}; FC = null;
    ST = P.stationById || Object.fromEntries(P.stations.map(s => [s.id, s]));
    TT = P.toolTypeById || Object.fromEntries(P.toolTypes.map(t => [t.id, t]));
    GRAPH = P.graph;
    for (const s of P.stations) if (!s.dockNode) s.dockNode = U.nearestNode(GRAPH, s.dock.x, s.dock.z);
    WALK = P.sim.walkSpeed || 1.3; FORK = P.sim.forkliftSpeed || 2.0;
    PLAN_AT = P.sim.toolPolicy && P.sim.toolPolicy.planAtParts != null ? P.sim.toolPolicy.planAtParts : 2;
    CFG.agvHandleSec = P.sim.agvLoadSec || 30;
    SH = P.shifts.map(sh => ({ id: sh.id, name: sh.name, start: U.hm(sh.start), end: U.hm(sh.end), breaks: (sh.breaks || []).map(b => [U.hm(b[0]), U.hm(b[1])]) }));
    WORKWIN = buildWorkWindows();
    const t0 = P.sim.startT != null ? P.sim.startT : 6 * 3600;

    S = {
      t: t0, startT: t0, seed: P.sim.seed,
      machines: {}, people: {}, agvs: {}, forklift: null, orders: {}, containers: {}, transports: {},
      materials: {}, tools: {}, toolStock: {}, tasks: {}, purchases: [], stations: {},
      events: [], notifications: [], measurements: {},
      history: { t: [], good: [], oee: [], powerKw: [], wip: [], perMachine: {} },
      kpi: {}, toolCostToday: 0, energyKwh: 0, powerKw: 0, spcSince: {},
      today: { day: Math.floor(t0 / DAY), good: 0, scrap: 0, scrapBy: { 'Maß': 0, 'Werkzeugbruch': 0, 'Erstteil n.i.O.': 0 }, fpiOk: 0, fpiNok: 0,
        transports: 0, shipped: 0, toolChanges: 0, faults: 0, setups: 0, energyKwh: 0, lossEur: 0 },
      shiftStats: { id: null, startT: t0, good: 0, scrap: 0 },
      shiftId: null, inBreak: false, histAcc: { good: 0, powerSum: 0, n: 0 }, lastShiftReport: null,
    };
    for (const s of P.stations) S.stations[s.id] = { id: s.id, inp: [], out: [] };
    for (const mt of P.materials) S.materials[mt.id] = Object.assign({}, mt, { onHand: mt.onHand, onOrder: 0, usedToday: 0 });
    for (const tt of P.toolTypes) S.toolStock[tt.id] = { ready: STOCK_DEFAULT[tt.kind] != null ? STOCK_DEFAULT[tt.kind] : 4, regrind: 0, scrapToday: 0 };
    P.machines.forEach((id, idx) => { S.machines[id] = newMachine(ST[id], idx, t0); S.history.perMachine[id] = []; });

    P.people.forEach((pp, idx) => {
      const homeNode = U.nearestNode(GRAPH, pp.home.x, pp.home.z);
      S.people[pp.id] = {
        id: pp.id, name: pp.name, role: pp.role, shift: pp.shift, skills: pp.skills.slice(), machines: (pp.machines || []).slice(),
        home: { x: pp.home.x, z: pp.home.z }, homeNode, idx, pos: { x: pp.home.x, z: pp.home.z }, heading: 0, node: homeNode,
        state: 'offShift', task: null, activity: 'Nicht im Dienst', vehicle: null, route: null,
        onDuty: false, endShift: false, breakPending: false, breakUntil: null, goal: null, idleSince: t0, atHome: true,
        workRem: 0, workSec: 0, dutySec: 0, utilToday: 0, tasksToday: 0, at: null,
      };
    });
    const chg = ST.CHG || P.stations[0];
    P.agvs.forEach((ag, k) => {
      const pos = k % 2 ? chg.outPos : chg.inPos;
      S.agvs[ag.id] = { id: ag.id, name: ag.name, maxKg: ag.maxKg, speed: ag.speed || 1.1, battery: ag.battery != null ? ag.battery : 80,
        state: 'idle', pos: { x: pos.x, z: pos.z }, heading: 0, node: chg.dockNode, load: null, task: null, route: null,
        waitRem: 0, mustCharge: false, slot: k, distToday: 0, transportsToday: 0 };
    });
    const raw = ST.RAW;
    S.forklift = { id: 'STP1', name: 'Stapler 1', pos: { x: raw.dock.x + 2.6, z: raw.dock.z + 1.6 }, heading: Math.PI / 2, node: raw.dockNode, driver: null, state: 'parked' };

    MA = Object.values(S.machines); PA = Object.values(S.people); AA = Object.values(S.agvs);
    for (const po of P.orders) buildOrder(po);
    for (const po of P.orders) applyInitial(S.orders[po.id], po.initial || {});
    persistentTools();

    cur = shiftInfo(S.t);
    S.shiftId = cur ? cur.sh.id : null; S.inBreak = cur ? cur.inBreak : false;
    S.shiftStats.id = S.shiftId;
    for (const id in S.people) {
      const p = S.people[id];
      if (p.shift === S.shiftId) { p.onDuty = true; p.state = 'idle'; p.activity = 'Bereit'; if (S.inBreak) { p.breakPending = true; p.breakUntil = cur.breakEnd; } }
    }
    for (const id in S.machines) planTools(S.machines[id]);
    for (const id in S.materials) checkStock(S.materials[id]);
    ev('reset', 'info', { kind: 'plant', id: 'werk' }, 'Simulation gestartet – ' + P.company.name + ', ' + (cur ? cur.sh.name : 'keine Schicht'), null);

    const until = P.sim.warmupUntilT != null ? P.sim.warmupUntilT : t0;
    while (S.t < until) step();
    S.kpi = kpis();
    WF.bus.emit('sim:reset', { t: S.t });
    return S;
  }

  function buildOrder(po) {
    const routing = po.routing.map((r, k) => Object.assign({}, r, {
      seq: r.seq != null ? r.seq : (k + 1) * 10,
      tools: (r.tools || []).map(x => Object.assign({}, x)),
      material: r.material ? Object.assign({}, r.material) : null,
      ext: r.ext ? Object.assign({}, r.ext) : null,
      char: r.char ? Object.assign({}, r.char) : null,
    }));
    const o = {
      id: po.id, customer: po.customer, sector: po.sector || '', part: Object.assign({}, po.part), qty: po.qty, due: po.due,
      priority: po.priority || 'normal', note: po.note || '', routing,
      status: 'freigegeben', releasedT: S.t, startT: null, doneT: null, shippedQty: 0, source: po.source || 'profil',
      ops: routing.map(r => ({ seq: r.seq, station: r.station, received: 0, good: 0, scrap: 0, passed: 0, inProc: 0,
        complete: false, startT: null, endT: null, machine: null, offset: 0, fpiCount: 0 })),
    };
    S.orders[o.id] = o;
    return o;
  }

  /** Anfangszustand aus profile.orders[].initial (Behälter, Stückzahlen, aktiver Arbeitsgang). */
  function applyInitial(o, init) {
    const ops = init.ops || {};
    o.routing.forEach((r, i) => {
      const x = ops[r.seq] || {}, op = o.ops[i];
      const atIn = (x.atInput || []).filter(q => q > 0), inSum = sumArr(atIn);
      if (r.station === 'VERSAND') {
        for (const q of atIn) { const c = newContainer(o, i - 1, i, q, 'shipped'); placeAt(c, 'VERSAND', 'inp'); }
        op.received = op.good = inSum; o.shippedQty = inSum;
        return;
      }
      op.good = x.done || 0; op.scrap = x.scrap || 0;
      for (const q of atIn) { const c = newContainer(o, i - 1, i, q, 'input'); placeAt(c, r.station, 'inp'); }
      op.received = op.good + op.scrap + inSum;
      const atOut = r.station === 'EXT' ? 0 : (x.atOutput || 0);
      if (atOut > 0) { const c = newContainer(o, i, i + 1, atOut, 'filling'); placeAt(c, r.station, 'out'); if (atOut >= opBatch(r)) closeContainer(c); }
      op.passed = Math.max(0, op.good - atOut);
      if (op.received > 0) { op.startT = S.t - 3600; o.status = 'in Arbeit'; }
    });
    for (let i = 0; i < o.ops.length; i++) checkOpComplete(o, i, true);
    if (init.activeSeq != null) {
      const i = o.routing.findIndex(r => r.seq === init.activeSeq);
      const r = o.routing[i], m = r && S.machines[r.station];
      if (m && !o.ops[i].complete && !m.op) {
        m.op = { oid: o.id, idx: i }; o.ops[i].machine = m.id; o.status = 'in Arbeit';
        if (!o.startT) o.startT = S.t - 3600;
        m.setupDone = !!init.setupDone || !(r.setupMin > 0);
        m.released = m.setupDone && (!!init.fpiReleased || !r.firstPiece);
        if (m.setupDone) for (const tl of r.tools) mountTool(m, tl.type, (init.toolsUsed || {})[tl.type] || 0);
        if (isBarFed(m, r)) { m.barStockM = init.barStockM != null ? init.barStockM : 0; m.barMat = r.material.id; }
      }
    }
    if (o.ops[o.ops.length - 1].complete) { o.status = 'fertig'; o.doneT = S.t; }
  }
  /** Maschinen ohne aktiven Arbeitsgang behalten ihr Dauerwerkzeug (Sägeband) – teilverschlissen. */
  function persistentTools() {
    for (const id in S.machines) {
      const m = S.machines[id];
      if (m.tools.length || m.type !== 'saw') continue;
      const tt = P.toolTypes.find(t => t.kind === 'saw');
      if (tt) mountTool(m, tt.id, Math.round(tt.lifeMin * 0.45));
    }
  }

  // ------------------------------------------------------------------ Ereignisse & Benachrichtigungen
  function ev(type, sev, entity, msg, data) {
    const e = { id: U.uid('EV'), t: S.t, type, sev: sev || 'info', entity: entity || null, msg, data: data || null };
    S.events.push(e);
    if (S.events.length > CFG.eventsMax) S.events.splice(0, S.events.length - CFG.eventsMax);
    WF.bus.emit('sim:event', e);
    return e;
  }
  /** Benachrichtigung anlegen oder (gleicher key, noch offen) aktualisieren. */
  function notify(o) {
    let n = NIDX[o.key];
    if (n && n.status !== 'resolved') {
      let changed = false;
      for (const k of ['sev', 'title', 'body', 'suggestion']) if (o[k] != null && n[k] !== o[k]) { n[k] = o[k]; changed = true; }
      if (o.actions) n.actions = o.actions;
      if (changed) { n.updatedT = S.t; WF.bus.emit('sim:notify', n); }
      return n;
    }
    n = { id: U.uid('NT'), t: S.t, sev: o.sev || 'info', title: o.title, body: o.body || '', role: o.role || 'Schichtleitung',
      entity: o.entity || null, status: 'open', ackBy: null, ackT: null, resolvedT: null, suggestion: o.suggestion || '',
      actions: o.actions || [], key: o.key, updatedT: S.t, autoResolveT: o.autoResolveT || null };
    NIDX[o.key] = n;
    S.notifications.unshift(n);
    if (S.notifications.length > CFG.notificationsMax) {
      for (let k = S.notifications.length - 1; k >= 0 && S.notifications.length > CFG.notificationsMax; k--) if (S.notifications[k].status === 'resolved') S.notifications.splice(k, 1);
      if (S.notifications.length > CFG.notificationsMax) S.notifications.length = CFG.notificationsMax;
    }
    WF.bus.emit('sim:notify', n);
    return n;
  }
  function resolveKey(key, note) {
    const n = NIDX[key];
    if (!n) return;
    delete NIDX[key];
    if (n.status === 'resolved') return;
    n.status = 'resolved'; n.resolvedT = S.t; n.resolveNote = note || 'Ursache entfallen';
    WF.bus.emit('sim:notify', n);
  }
  const hasOpen = (key) => !!(NIDX[key] && NIDX[key].status !== 'resolved');

  // ------------------------------------------------------------------ Behälter
  /** Behälter: src = Arbeitsgang-Index, aus dem die Teile stammen (-1 = Rohmaterial), idx = Ziel-Arbeitsgang. */
  function newContainer(o, src, idx, qty, state, kind) {
    const c = {
      id: U.uid('BH'), orderId: o.id, src, idx,
      srcSeq: src >= 0 ? o.routing[src].seq : null, seq: idx < o.routing.length ? o.routing[idx].seq : null,
      qty, weightKg: 0, state, kind: kind || 'parts', location: null, createdT: S.t, transportId: null, partName: o.part.name,
    };
    setWeight(c, o);
    S.containers[c.id] = c; CV++;
    return c;
  }
  function setWeight(c, o) {
    o = o || S.orders[c.orderId];
    const w = c.qty * (o.part.weightKg || 0.1);
    c.weightKg = Math.round((w + (w > 60 ? 30 : 3)) * 10) / 10; // Gitterbox bzw. Kleinladungsträger
  }
  function placeAt(c, sid, slot) {
    unplace(c); CV++;
    c.location = { kind: 'station', id: sid, slot: slot === 'out' ? 'out' : 'in' };
    const st = S.stations[sid]; if (st) (slot === 'out' ? st.out : st.inp).push(c.id);
  }
  function unplace(c) {
    CV++;
    const l = c.location;
    if (l && l.kind === 'station') {
      const st = S.stations[l.id];
      if (st) { const arr = l.slot === 'out' ? st.out : st.inp; const k = arr.indexOf(c.id); if (k >= 0) arr.splice(k, 1); }
    }
    c.location = null;
  }
  function removeContainer(c) { unplace(c); delete S.containers[c.id]; CV++; }
  /** Summe der Teile, die an der Station des Arbeitsgangs i im Eingang warten */
  function waitingQty(oid, i) {
    const o = S.orders[oid], st = S.stations[o.routing[i].station]; let q = 0;
    if (st) for (const cid of st.inp) { const c = S.containers[cid]; if (c.orderId === oid && c.idx === i && c.state === 'input') q += c.qty; }
    return q;
  }
  function firstInput(sid, oid, i) {
    const st = S.stations[sid]; if (!st) return null;
    for (const cid of st.inp) { const c = S.containers[cid]; if (c.orderId === oid && c.idx === i && c.state === 'input' && c.qty > 0) return c; }
    return null;
  }
  /** Teile für Arbeitsgang i, die bereits abgeschlossen in einem Behälter liegen bzw. unterwegs sind */
  function inboundQty(oid, i) {
    if (!INB || INB.v !== CV) {
      INB = { v: CV, m: new Map() };
      for (const id in S.containers) { const c = S.containers[id]; if (c.state === 'transit' || c.state === 'ready') { const k = c.orderId + '|' + c.idx; INB.m.set(k, (INB.m.get(k) || 0) + c.qty); } }
    }
    return INB.m.get(oid + '|' + i) || 0;
  }
  function fillingAt(sid, oid, src) {
    const st = S.stations[sid]; if (!st) return null;
    for (const cid of st.out) { const c = S.containers[cid]; if (c.orderId === oid && c.src === src && c.state === 'filling') return c; }
    return null;
  }
  function countOut(sid) { const st = S.stations[sid]; return st ? st.out.length : 0; }
  function countIn(sid) { const st = S.stations[sid]; return st ? st.inp.length : 0; }
  /** Behälter schließen → bereit zur Abholung, Transportauftrag zur nächsten Station */
  function closeContainer(c) {
    if (c.state !== 'filling') return;
    c.state = 'ready'; c.readyT = S.t; CV++;
    createTransport(c);
  }

  // ------------------------------------------------------------------ Aufträge: Mengen & Abschluss
  /** erwartete Zugangsmenge des Arbeitsgangs i (Ausschuss vorgelagerter Schritte fehlt; Ausschuss im 1. AG wird nachgefertigt) */
  function opTargetIn(o, i) {
    if (i === 0) return o.qty;
    const p = o.ops[i - 1];
    if (p.complete) return p.good;
    let q = o.qty; for (let j = 1; j < i; j++) q -= o.ops[j].scrap;
    return Math.max(0, q);
  }
  /** noch zu startende Teile in Arbeitsgang i */
  function partsLeft(o, i) {
    const op = o.ops[i];
    if (i === 0) return Math.max(0, o.qty - op.good - op.inProc);
    return Math.max(0, opTargetIn(o, i) - op.good - op.scrap - op.inProc);
  }
  function checkOpComplete(o, i, silent) {
    const op = o.ops[i];
    if (op.complete) return true;
    let done;
    if (i === 0) done = op.good >= o.qty && op.inProc === 0;
    else done = o.ops[i - 1].complete && op.inProc === 0 && op.good + op.scrap >= o.ops[i - 1].good;
    if (done && waitingQty(o.id, i) > 0) done = false;
    if (!done) return false;
    op.complete = true; op.endT = S.t;
    const r = o.routing[i];
    // offenen Ausgangsbehälter (Restmenge) schließen und weitergeben
    const f = fillingAt(r.station, o.id, i);
    if (f) { if (f.qty > 0) closeContainer(f); else removeContainer(f); }
    if (!silent) {
      if (r.station !== 'VERSAND') ev('opDone', 'ok', { kind: 'order', id: o.id }, `${o.id} AG ${r.seq} „${r.op}“ abgeschlossen (${op.good} gut${op.scrap ? ', ' + op.scrap + ' Ausschuss' : ''})`, { seq: r.seq, station: r.station });
    }
    if (i + 1 < o.ops.length) checkOpComplete(o, i + 1, silent);
    else orderDone(o, silent);
    return true;
  }
  function orderDone(o, silent) {
    if (o.status === 'fertig') return;
    o.status = 'fertig'; o.doneT = S.t;
    if (silent) return;
    const late = S.t > o.due;
    const d = U.fmtDur(Math.abs(o.due - S.t));
    ev('orderDone', 'ok', { kind: 'order', id: o.id }, `Auftrag ${o.id} fertig – ${o.shippedQty} Stk ${o.part.name} im Versand (${late ? d + ' nach' : d + ' vor'} Termin)`, { late });
    resolveKey('late:' + o.id, 'Auftrag fertig');
    const short = o.qty - o.shippedQty;
    notify({ key: 'done:' + o.id, sev: 'ok', role: 'Schichtleitung', entity: { kind: 'order', id: o.id }, autoResolveT: S.t + 4 * 3600,
      title: `Auftrag ${o.id} fertig`, body: `${o.shippedQty} von ${o.qty} Stk „${o.part.name}“ (${o.customer}) liegen im Versand. ${late ? 'Termin um ' + d + ' überschritten.' : 'Termin eingehalten (' + d + ' Puffer).'}${short > 0 ? ' ' + short + ' Stk fehlen (Ausschuss in Folgearbeitsgängen) – Nachfertigung oder Teillieferung mit Kunden klären.' : ''}`,
      suggestion: late ? 'Kunde über Lieferverzug informieren; Ursache im Auftragsverlauf prüfen.' : 'Lieferschein erstellen und Versand avisieren.', actions: [{ label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id: o.id } }] });
  }

  // ------------------------------------------------------------------ Transportaufträge
  /** Transport für einen abholbereiten Behälter anlegen (Ziel = Station des Ziel-Arbeitsgangs). */
  function createTransport(c) {
    const o = S.orders[c.orderId];
    const from = c.location ? c.location.id : 'RAW';
    const to = c.idx < o.routing.length ? o.routing[c.idx].station : 'VERSAND';
    if (to === from) { dropContainer(c, to); return null; } // gleiche Station: direkt umbuchen
    const kind = c.kind === 'raw' ? 'supply' : to === 'EXT' ? 'ext-out' : from === 'WE' ? 'ext-in' : 'container';
    const mode = c.weightKg > 250 ? 'Stapler' : 'AGV';
    const tr = { id: U.uid('TR'), containerId: c.id, kind, from: { station: from }, to: { station: to }, weightKg: c.weightKg,
      mode, status: 'open', assignee: null, createdT: S.t, pickupT: null, doneT: null, orderId: c.orderId,
      label: `${c.qty} Stk ${o.part.name} · ${stShort(from)} → ${stShort(to)}`, waitReason: null, taskId: null };
    S.transports[tr.id] = tr;
    c.transportId = tr.id;
    return tr;
  }
  function createBarsTransport(m, matId) {
    const tr = { id: U.uid('TR'), containerId: null, kind: 'bars', from: { station: 'RAW' }, to: { station: m.id }, weightKg: 0,
      mode: 'Stapler', status: 'open', assignee: null, createdT: S.t, pickupT: null, doneT: null, orderId: m.op ? m.op.oid : null,
      label: `Stangen ${S.materials[matId].name} · Rohmaterial → ${m.id}`, waitReason: null, taskId: null, materialId: matId, meters: 0 };
    S.transports[tr.id] = tr;
    return tr;
  }
  /** Behälter aufnehmen (AGV/Stapler). Zählt als „weitergegeben“ für den Quell-Arbeitsgang. */
  function pickupContainer(c, loc) {
    unplace(c);
    c.location = loc; c.state = 'transit';
    if (c.src >= 0 && !c.relocate) S.orders[c.orderId].ops[c.src].passed += c.qty;
  }
  /** Behälter an einer Station abstellen → Zugang des Ziel-Arbeitsgangs */
  function dropContainer(c, sid) {
    const o = S.orders[c.orderId];
    if (c.state !== 'transit' && c.src >= 0 && !c.relocate && (c.state === 'ready' || c.state === 'filling')) o.ops[c.src].passed += c.qty; // Direktumbuchung
    c.relocate = false;
    const i = c.idx;
    if (i >= o.ops.length) { removeContainer(c); return; }
    const op = o.ops[i];
    op.received += c.qty;
    if (!op.startT) op.startT = S.t;
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = o.startT || S.t; }
    if (sid === 'VERSAND') {
      c.state = 'shipped'; placeAt(c, sid, 'inp');
      op.good += c.qty; o.shippedQty += c.qty; S.today.shipped += c.qty;
      checkOpComplete(o, i);
      return;
    }
    c.state = 'input';
    placeAt(c, sid, 'inp');
    if (sid === 'EXT') c.leaveT = S.t + CFG.extHandoverSec;
    const m = S.machines[sid];
    if (m && !m.op) m.nextPickT = 0; // Maschine sofort neu disponieren lassen
  }

  // ------------------------------------------------------------------ Fremdbearbeitung (EXT) & Wareneingang
  function extTick() {
    const ext = S.stations.EXT;
    if (ext) for (const cid of ext.inp.slice()) {
      const c = S.containers[cid]; if (!c || c.state !== 'input' || S.t < c.leaveT || !inDayWindow(S.t)) continue;
      const o = S.orders[c.orderId], r = o.routing[c.idx], op = o.ops[c.idx];
      const lead = ((r.ext && r.ext.leadMin) || 480) * 60;
      const returnT = nextDayWindow(S.t + lead);
      unplace(c);
      c.state = 'external'; CV++;
      c.location = { kind: 'external', partner: (r.ext && r.ext.partner) || 'Fremdbearbeiter', process: (r.ext && r.ext.process) || r.op, returnT };
      op.inProc += c.qty;
      ev('extOut', 'info', { kind: 'container', id: c.id }, `${c.qty} Stk ${o.id} (${o.part.name}) an ${c.location.partner} übergeben – ${c.location.process}, Rückkehr ca. ${U.fmtDayClock(returnT)}`, { orderId: o.id, returnT });
    }
    for (const id in S.containers) {
      const c = S.containers[id];
      if (c.state !== 'external' || S.t < c.location.returnT) continue;
      const o = S.orders[c.orderId], i = c.idx, op = o.ops[i];
      const partner = c.location.partner;
      op.inProc -= c.qty; op.good += c.qty;
      c.src = i; c.srcSeq = o.routing[i].seq; c.idx = i + 1; c.seq = i + 1 < o.routing.length ? o.routing[i + 1].seq : null;
      c.state = 'ready'; c.readyT = S.t; c.location = null;
      placeAt(c, 'WE', 'out');
      createTransport(c);
      ev('extIn', 'ok', { kind: 'container', id: c.id }, `${c.qty} Stk ${o.id} von ${partner} zurück im Wareneingang (${o.routing[i].op})`, { orderId: o.id });
      checkOpComplete(o, i);
    }
  }
  function purchasesTick() {
    for (const pu of S.purchases) {
      if (pu.status !== 'bestellt' || S.t < pu.etaT) continue;
      pu.status = 'geliefert'; pu.deliveredT = S.t;
      const mt = S.materials[pu.materialId];
      mt.onHand = r6(mt.onHand + pu.qty); mt.onOrder = r6(Math.max(0, mt.onOrder - pu.qty));
      ev('delivery', 'ok', { kind: 'material', id: mt.id }, `Lieferung eingetroffen: ${nm(pu.qty, mt.unit === 'm' ? 1 : 0)} ${mt.unit} ${mt.name} von ${mt.supplier} – Bestand jetzt ${nm(mt.onHand, 1)} ${mt.unit}`, { qty: pu.qty });
      checkStock(mt);
      for (const mid in S.machines) S.machines[mid].nextPickT = 0;
    }
  }
  /** Mindestbestand prüfen → Warnung mit Bestellvorschlag; löst sich, sobald Bestand + Bestellung ≥ Mindestbestand */
  function checkStock(mt) {
    const key = 'stock:' + mt.id;
    if (mt.onHand + mt.onOrder >= mt.min) { if (hasOpen(key)) resolveKey(key, mt.onOrder > 0 ? 'Bestellung ausgelöst' : 'Bestand wieder über Mindestbestand'); return; }
    const dec = mt.unit === 'm' ? 1 : 0;
    notify({ key, sev: 'warn', role: 'Einkauf', entity: { kind: 'material', id: mt.id },
      title: `Mindestbestand unterschritten: ${mt.name}`,
      body: `Bestand ${nm(mt.onHand, dec)} ${mt.unit} < Mindestbestand ${nm(mt.min, dec)} ${mt.unit}.${mt.onOrder ? ' Bestellt: ' + nm(mt.onOrder, dec) + ' ' + mt.unit + '.' : ''}`,
      suggestion: `Bestellvorschlag: ${nm(mt.reorderQty, dec)} ${mt.unit} bei ${mt.supplier} (Lieferzeit ca. ${U.fmtDur(mt.leadMin * 60)}, ca. ${U.fmtEur(mt.reorderQty * mt.pricePerUnit)}).`,
      actions: [{ label: 'Nachbestellen', action: { type: 'reorder', materialId: mt.id, qty: mt.reorderQty } }] });
  }
  function materialIssue(mt, amount, why) {
    mt.onHand = r6(Math.max(0, mt.onHand - amount));
    mt.usedToday = r6(mt.usedToday + amount);
    checkStock(mt);
  }

  // ------------------------------------------------------------------ Maschinen: Grundlagen
  const OK = { ok: true };
  const WAIT_STATES = { starved: 1, waitOperator: 1, waitTool: 1, blocked: 1 };
  function curOf(m) { if (!m.op) return null; const o = S.orders[m.op.oid]; return { o, i: m.op.idx, r: o.routing[m.op.idx], op: o.ops[m.op.idx] }; }
  function isBarFed(m, r) { return !!(m && m.barMagazineM && r && r.material && S.materials[r.material.id] && S.materials[r.material.id].form === 'Stange'); }
  function isSawRaw(m, r, i) { return i === 0 && m.type === 'saw' && !!r.material; }
  function isSupplyOp(m, r, i) { return i === 0 && !isSawRaw(m, r, i) && !isBarFed(m, r); }
  function loadSecOf(m, r) { return Math.round(((r.loadMin != null ? r.loadMin : m.loadMin) || 1) * 60); }
  /** Plan-Taktzeit inkl. Einlegen (für Prognosen) */
  function cycleSec(m, r) { return (r.cycleMin || 1) * 60 + (m && m.loading === 'perPart' ? loadSecOf(m, r) : 0); }
  function charOf(m, r) { return r.char || DEFAULT_CHAR[m.type] || DEFAULT_CHAR.cmm; }
  function cmpKey(a, b) { for (let k = 0; k < a.length; k++) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; }

  /** teure Ursachentexte (Wartezustände) höchstens alle 5 s neu berechnen; bei Zustandswechsel sofort */
  function cz(m, key, fn) {
    if (m.czKey === key && S.t - m.czT < 5 && m.state === m.czState) return m.czVal;
    m.czKey = key; m.czT = S.t; m.czState = m.state; m.czVal = fn();
    return m.czVal;
  }
  /** Zustandswechsel – immer mit Ursache; erzeugt Event 'state' und pflegt Zustandssegmente. */
  function setState(m, st, cause, code) {
    m.cause = cause;
    if (m.state === st) return;
    const from = m.state;
    const seg = m.segments[m.segments.length - 1];
    if (seg) seg.t1 = S.t;
    m.segments.push({ t0: S.t, t1: null, state: st });
    const lim = S.t - DAY;
    while (m.segments.length > 2 && m.segments[0].t1 != null && m.segments[0].t1 < lim) m.segments.shift();
    m.state = st; m.since = S.t;
    if (WAIT_STATES[from] && hasOpen('wait:' + m.id)) resolveKey('wait:' + m.id, 'jetzt: ' + WF.STATE[st].label);
    if (from === 'starved' && m.missingKey) { resolveKey(m.missingKey, 'Material wieder verfügbar'); m.missingKey = null; }
    ev('state', st === 'fault' ? 'crit' : 'info', { kind: 'machine', id: m.id },
      `${m.id} ${m.short}: ${WF.STATE[from].label} → ${WF.STATE[st].label} – ${cause}`,
      { from, to: st, cause, code: code || null, minor: code === 'walking' || code === 'assigning' });
  }

  // ------------------------------------------------------------------ Maschinen: Schritt
  function machineTick(m) {
    if (m.fault) return setState(m, 'fault', `${m.fault.code} ${m.fault.text}${m.fault.repairBy ? ' – Reparatur durch ' + pname(m.fault.repairBy) : ' – wartet auf Instandhaltung'}`);
    if (m.toolchange) return setState(m, 'toolchange', m.toolchange.cause);
    if (m.setupRun) return setState(m, 'setup', m.setupRun.cause);
    if (m.corrRun) return setState(m, 'setup', m.corrRun.cause);
    const pt = m.part;
    if (pt) {
      if (pt.sub === 'load') return setState(m, 'running', pt.loadLabel);
      if (m.mtbfP && R.next() < m.mtbfP) { startFault(m, null, false); return; }
      pt.rem -= 1;
      if (pt.rem > 0) {
        if (m.loading === 'perPart' && pt.rem <= CFG.precallSec) precallLoad(m);
        return setState(m, 'running', pt.label);
      }
      partEnd(m);
    }
    if (m.dressRem > 0) { m.dressRem--; if (m.dressRem > 0) return setState(m, 'running', 'Abrichten der Schleifscheibe (automatischer Zyklus)'); }
    if (m.fpi) return setState(m, 'firstPiece', cz(m, 'fpi:' + m.fpi.stage, () => fpiCause(m)));
    decide(m, 0);
  }

  /** Entscheidung an einer Teilegrenze (kein Teil in Bearbeitung): Regeln §3.3 in fester Reihenfolge. */
  function decide(m, depth) {
    if (!m.op) {
      if (S.t >= m.nextPickT) { m.nextPickT = S.t + CFG.pickEverySec; pickOp(m); }
      if (!m.op) { releaseAttendant(m); return setState(m, 'idle', m.idleCause || 'Kein Arbeitsgang eingeplant'); }
    }
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i], op = o.ops[i];
    if (op.complete || checkOpComplete(o, i)) {
      finishOp(m, o, i);
      if (depth < 1) return decide(m, depth + 1);
      return setState(m, 'idle', 'Arbeitsgang abgeschlossen');
    }
    // Material vorbereiten – darf schon während des Rüstens laufen
    if (isSupplyOp(m, r, i)) ensureSupply(m, o, i);
    if (isBarFed(m, r)) ensureBars(m, o, i);
    // 1) Rüsten
    if (!m.setupDone) {
      if (!(r.setupMin > 0)) instantSetup(m, o, i);
      else { ensureMTask(m, 'setup'); return waitOp(m, 'setup', `Rüsten für ${o.id} AG ${r.seq}`); }
    }
    if (m.needCorr) { ensureMTask(m, 'corr'); return waitOp(m, 'corr', `Korrektur nach Erstteil n.i.O. (${o.id})`); }
    // 2) Werkzeugwechsel nur an der Teilegrenze und nur wenn Einrichter:in mit Werkzeug bereitsteht
    const tc = toolCheck(m, o, i);
    if (techReady(m)) {
      const tk = S.tasks[m.tasks.tc];
      if (tc.change.length || (tk && tk.data.manual)) { startToolChange(m, o, i, tc); return setState(m, 'toolchange', m.toolchange.cause); }
      if (!tc.planned.length && tk) cancelTask(tk, 'kein Wechsel nötig');
      else if (tk) { const p = S.people[tk.assignee]; const mr = tc.planned.reduce((a, x) => Math.min(a, x.rem), Infinity); p.activity = `Wartet an ${m.id}: Wechsel bei ≤ ${PLAN_AT} Teilen Reststandzeit (noch ${teile(mr)})`; }
    }
    // 3) Ausgangspuffer
    if (!outputRoom(m, o, i)) { dropWaiters(m); return setState(m, 'blocked', cz(m, 'bl', () => `Ausgangspuffer voll (${countOut(m.id)}/${m.outCap} Behälter) – ${blockedWhy(m)}`), 'blocked'); }
    // 4) Eingang / Rohmaterial
    const inp = inputAvail(m, o, i);
    if (!inp.ok) {
      { const lt = S.tasks[m.tasks.load]; if (lt && !lt.workStarted) cancelTask(lt, 'nicht mehr nötig'); }
      if (inp.code === 'parts' && i > 0 && !(r.setupMin > 10) && !r.firstPiece && inboundQty(o.id, i) === 0) {
        const eta = arrivalEta(o, i);
        pauseOp(m, o, i, `${m.id} gibt ${o.id} AG ${r.seq} frei – Behälter abgearbeitet, nächste Teile ${eta ? 'ca. ' + tclock(eta) : 'noch nicht absehbar'}`, true);
        m.nextPickT = 0;
        m.idleCause = `Frei – nächste Teile für ${o.id} AG ${r.seq} ${eta ? 'ca. ' + tclock(eta) : 'noch nicht absehbar'}`;
        if (depth < 1) return decide(m, depth + 1);
        return setState(m, 'idle', m.idleCause);
      }
      if (m.starvedSince == null) m.starvedSince = S.t;
      if (maybeSwitch(m, o, i)) return depth < 1 ? decide(m, depth + 1) : setState(m, 'idle', 'Arbeitsgang gewechselt');
      releaseAttendant(m);
      return setState(m, 'starved', inp.cause, inp.code);
    }
    m.starvedSince = null;
    // 5) Werkzeug-Standzeit für das nächste Teil
    if (tc.short.length) { ensureToolTask(m, true); dropWaiters(m); return setState(m, 'waitTool', cz(m, 'wt:' + (S.tasks[m.tasks.tc] ? S.tasks[m.tasks.tc].assignee + S.tasks[m.tasks.tc].si : ''), () => toolWaitCause(m, tc)), 'tool'); }
    // 6) Beladen bzw. Anwesenheit
    if (m.loading === 'perPart') {
      const p = presentFor(m, 'load');
      if (p) { startLoad(m, o, i, p); return setState(m, 'running', `Teil wird eingelegt (${sn(p.name)})`); }
      ensureMTask(m, 'load');
      return waitOp(m, 'load', `Einlegen ${o.id} AG ${r.seq}`);
    }
    if (m.loading === 'attended') {
      const p = presentFor(m, 'attend');
      if (p && p.task && p.task.orderId !== o.id || (p && p.task && p.task.seq !== r.seq)) { // Anwesende Person übernimmt den neuen Arbeitsgang
        const tk = p.task; tk.orderId = o.id; tk.seq = r.seq;
        tk.label = `${TASK_LABEL[tk.type]} ${mLabel(m.id)} · ${o.id}`;
        tk.steps[tk.si].label = p.activity = m.kind === 'assembly' ? `Montiert ${o.id} (${r.op})` : `Prüft ${o.id} AG ${r.seq} (${r.op})`;
      }
      if (p && !mustLeave(p)) { startPart(m, o, i, p.id); return setState(m, 'running', `${sn(p.name)}: ${r.op} ${o.id}`); }
      if (p) { releaseAttendant(m); assignTasks(); } // dringendere Aufgabe sofort übernehmen
      ensureMTask(m, 'attend');
      return waitOp(m, 'attend', `${m.kind === 'assembly' ? 'Montage' : 'Prüfung'} ${o.id} AG ${r.seq}`);
    }
    startPart(m, o, i, null);
    setState(m, 'running', m.part.label);
  }

  // ------------------------------------------------------------------ Maschinen: Auftragswahl
  /** Kandidat für Maschine m: Eil zuerst, dann Material-Bereitschaft (2 = am Platz/unterwegs, 1 = kommt bald), früheste Fälligkeit, Auftragsnummer */
  function bestCandidate(m, minLevel, exclude) {
    let best = null;
    for (const oid in S.orders) {
      const o = S.orders[oid];
      if (o.status === 'fertig') continue;
      for (let i = 0; i < o.routing.length; i++) {
        const r = o.routing[i];
        if (r.station !== m.id) continue;
        const op = o.ops[i];
        if (op.complete || (op.machine && op.machine !== m.id)) continue;
        if (exclude && exclude.oid === oid && exclude.idx === i) continue;
        const lv = opLevel(m, o, i);
        if (lv.level < minLevel) continue;
        const k = [o.priority === 'eil' ? 0 : 1, 2 - lv.level, o.due, o.id, r.seq];
        if (!best || cmpKey(k, best.k) < 0) best = { o, i, r, lv, k };
      }
    }
    return best;
  }
  function pickOp(m) {
    const b = bestCandidate(m, 1, null);
    if (!b) {
      // Begründung für „Bereit“
      let waiting = 0;
      for (const oid in S.orders) { const o = S.orders[oid]; if (o.status === 'fertig') continue; o.routing.forEach((r, i) => { if (r.station === m.id && !o.ops[i].complete) waiting++; }); }
      m.idleCause = waiting ? `${waiting} Arbeitsgang/-gänge eingeplant, aber kein Material in Sicht (Vorgänger noch nicht fertig)` : 'Kein Arbeitsgang eingeplant';
      return;
    }
    activateOp(m, b.o, b.i, b.lv);
  }
  function activateOp(m, o, i, lv) {
    const r = o.routing[i];
    m.op = { oid: o.id, idx: i };
    o.ops[i].machine = m.id;
    m.setupDone = false; m.released = false; m.needCorr = false; m.starvedSince = null; m.idleCause = null;
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = S.t; }
    ev('opSelect', 'info', { kind: 'machine', id: m.id },
      `${m.id} plant ${o.id} AG ${r.seq} „${r.op}“ ein (${o.priority === 'eil' ? 'Eilauftrag' : 'Termin ' + U.fmtDayClock(o.due)}; ${lv.why || ''})`,
      { orderId: o.id, seq: r.seq, level: lv.level });
  }
  /** Bereitschaft eines Arbeitsgangs für Maschine m */
  function opLevel(m, o, i) {
    const r = o.routing[i];
    // Rüsten vorab nur, wenn das Material spätestens kurz nach Rüstende eintrifft (ohne Rüstaufwand: nur bei Material am Platz)
    const lead = r.setupMin > 0 ? r.setupMin * 60 + Math.min(1200, r.setupMin * 60) : -1;
    if (waitingQty(o.id, i) > 0) return { level: 2, why: 'Teile am Platz' };
    if (inboundQty(o.id, i) > 0) return { level: 2, why: 'Behälter unterwegs' };
    if (i === 0) {
      if (rawAvailable(m, r)) return { level: 2, why: r.material ? 'Rohmaterial verfügbar' : 'Teile bereitgestellt' };
      const eta = rawEta(r);
      if (eta != null && eta - S.t <= lead) return { level: 1, eta, why: 'Rohmaterial-Lieferung ca. ' + tclock(eta) };
      return { level: 0, why: 'Rohmaterial fehlt' };
    }
    const eta = arrivalEta(o, i);
    if (eta != null && eta - S.t <= lead) return { level: 1, eta, why: 'Teile ab ca. ' + tclock(eta) + ' – Rüsten vorab' };
    return { level: 0, eta };
  }
  function rawAvailable(m, r) {
    if (!r.material) return true;
    const mt = S.materials[r.material.id]; if (!mt) return true;
    const bar = isBarFed(m, r) && m.barMat === mt.id ? m.barStockM : 0;
    return mt.onHand + bar + 1e-9 >= r.material.perPart;
  }
  function rawEta(r) {
    if (!r.material) return null;
    let best = null;
    for (const pu of S.purchases) if (pu.status === 'bestellt' && pu.materialId === r.material.id && (best == null || pu.etaT < best)) best = pu.etaT;
    return best;
  }
  /** geschätzter Zeitpunkt, zu dem der nächste Behälter für Arbeitsgang i eintrifft (null = nicht absehbar) */
  function arrivalEta(o, i) {
    if (i === 0) { const r = o.routing[0]; return rawAvailable(S.machines[r.station] || {}, r) ? S.t : rawEta(r); }
    if (inboundQty(o.id, i) > 0) return S.t + 180;
    const pi = i - 1, pr = o.routing[pi], pop = o.ops[pi];
    if (pr.station === 'EXT') {
      let best = null;
      const lead = ((pr.ext && pr.ext.leadMin) || 480) * 60;
      for (const id in S.containers) {
        const c = S.containers[id];
        if (c.orderId !== o.id || c.idx !== pi) continue;
        let t = null;
        if (c.state === 'external') t = c.location.returnT + 900;
        else if (c.state === 'input' && c.location && c.location.id === 'EXT') t = nextDayWindow(Math.max(S.t, c.leaveT || S.t) + lead) + 900;
        if (t != null && (best == null || t < best)) best = t;
      }
      return best;
    }
    const pm = S.machines[pr.station];
    if (!pm || !pm.op || pm.op.oid !== o.id || pm.op.idx !== pi) return null;
    const f = fillingAt(pm.id, o.id, pi);
    const need = Math.max(1, Math.min(opBatch(pr) - (f ? f.qty : 0), partsLeft(o, pi) + pop.inProc));
    let t = S.t;
    if (!pm.setupDone) t += pm.setupRun ? Math.max(0, pm.setupRun.dur - (S.t - pm.setupRun.t0)) : (pr.setupMin || 0) * 60 + 300;
    if (!pm.released && pr.firstPiece) t += cycleSec(pm, pr) + (pm.fpiMin || 15) * 60 + 600;
    if (pm.fault) t += pm.fault.repairSec;
    t += need * cycleSec(pm, pr);
    return t + 300;
  }
  function finishOp(m, o, i) {
    cancelMTask(m, 'load'); cancelMTask(m, 'tc'); // Anwesende Prüfer:in/Monteur:in bleibt für den nächsten Arbeitsgang

    if (hasOpen('tool:' + m.id)) resolveKey('tool:' + m.id, 'Arbeitsgang beendet – Wechsel entfällt');
    returnLeftovers(m, o, i);
    cancelBars(m);
    o.ops[i].machine = null;
    m.op = null; m.setupDone = false; m.released = false; m.needCorr = false; m.nextPickT = 0; m.starvedSince = null;
  }
  /** Arbeitsgang unterbrechen (Material kommt erst viel später, anderer Arbeitsgang hat Material am Platz) */
  function pauseOp(m, o, i, why, minor) {
    const f = fillingAt(m.id, o.id, i);
    if (f && f.qty > 0) closeContainer(f);
    cancelMTask(m, 'load'); cancelMTask(m, 'tc'); cancelBars(m);
    if (hasOpen('tool:' + m.id)) resolveKey('tool:' + m.id, 'Arbeitsgang unterbrochen');
    o.ops[i].machine = null;
    m.op = null; m.setupDone = false; m.released = false; m.needCorr = false; m.starvedSince = null;
    ev('opPause', 'info', { kind: 'machine', id: m.id }, why, { orderId: o.id, seq: o.routing[i].seq, minor: !!minor });
  }
  function maybeSwitch(m, o, i) {
    if (S.t - m.lastSwitchCheck < CFG.switchCheckSec) return false;
    m.lastSwitchCheck = S.t;
    if (m.part || m.fpi || S.t - m.starvedSince < 60) return false;
    if (inboundQty(o.id, i) > 0) return false;
    const r = o.routing[i];
    const eta = arrivalEta(o, i);
    const gap = eta == null ? Infinity : eta - S.t;
    if (gap <= Math.max(1800, 2 * (r.setupMin || 0) * 60)) return false;
    const alt = bestCandidate(m, 2, { oid: o.id, idx: i });
    if (!alt) return false;
    // nur sinnvolle Wechsel: der andere Arbeitsgang passt komplett in die Lücke (inkl. Wieder-Rüsten) oder ist dringender
    const w = workFor(m, alt.o, alt.i, false);
    const resume = (r.setupMin || 0) * 60 + (r.firstPiece ? (m.fpiMin || 15) * 60 + 900 : 0);
    const fits = w.setup + w.fpi + w.run + resume <= gap;
    const urgent = cmpKey([alt.o.priority === 'eil' ? 0 : 1, alt.o.due], [o.priority === 'eil' ? 0 : 1, o.due]) < 0;
    if (!fits && !urgent) return false;
    pauseOp(m, o, i, `${m.id} unterbricht ${o.id} AG ${r.seq} (nächste Teile ${eta ? 'erst ca. ' + tclock(eta) : 'nicht absehbar'}) und zieht ${alt.o.id} AG ${alt.r.seq} vor – Material liegt bereit, ${fits ? 'passt in die Lücke' : 'dringender (' + (alt.o.priority === 'eil' ? 'Eilauftrag' : 'Termin ' + U.fmtDayClock(alt.o.due)) + ')'}`);
    activateOp(m, alt.o, alt.i, alt.lv);
    return true;
  }
  /** nicht verbrauchte Rohteile nach Arbeitsgang-Ende zurück ins Lager buchen */
  function returnLeftovers(m, o, i) {
    const st = S.stations[m.id]; if (!st) return;
    for (const cid of st.inp.slice()) {
      const c = S.containers[cid];
      if (!c || c.orderId !== o.id || c.idx !== i || c.qty <= 0) continue;
      const r = o.routing[i];
      if (c.src === -1 && r.material) { const mt = S.materials[r.material.id]; mt.onHand = r6(mt.onHand + c.qty * r.material.perPart); checkStock(mt); }
      o.ops[i].received -= c.qty;
      ev('return', 'info', { kind: 'container', id: c.id }, `${c.qty} überzählige Rohteile ${o.id} zurück ins Lager gebucht`, null);
      removeContainer(c);
    }
  }

  // ------------------------------------------------------------------ Maschinen: Material
  function inputAvail(m, o, i) {
    const r = o.routing[i];
    if (i === 0 && partsLeft(o, 0) <= 0) return { ok: false, code: 'done', cause: 'Alle Teile gestartet – Abschluss ausstehend' };
    if (m.rework) return OK; // Erstteil wird nachgearbeitet
    if (isSawRaw(m, r, i)) {
      const mt = S.materials[r.material.id];
      if (mt.onHand + 1e-9 >= r.material.perPart) return OK;
      notifyMissing(m, mt, r);
      return { ok: false, code: 'raw', cause: `Rohmaterial ${mt.name} fehlt (Bestand ${nm(mt.onHand, 2)} ${mt.unit}, Bedarf ${nm(r.material.perPart, 2)} ${mt.unit} je Teil)${mt.onOrder ? ' – Lieferung unterwegs' : ' – nicht bestellt'}` };
    }
    if (isBarFed(m, r)) {
      if (m.barMat === r.material.id && m.barStockM + 1e-9 >= r.material.perPart) return OK;
      const tr = barsTransportOf(m);
      const mt = S.materials[r.material.id];
      if (!tr && mt.onHand + 1e-9 < r.material.perPart) { notifyMissing(m, mt, r); return { ok: false, code: 'raw', cause: `Stangenmagazin leer und kein ${mt.name} mehr im Lager` }; }
      return { ok: false, code: 'bars', cause: `Stangenmagazin leer (${nm(m.barStockM || 0, 2)} m) – ${tr ? trWhy(tr) : 'Nachschub wird beauftragt'}` };
    }
    if (firstInput(m.id, o.id, i)) return OK;
    return { ok: false, code: 'parts', cause: cz(m, 'in:' + o.id + i, () => inputWhy(m, o, i)) };
  }
  function inputWhy(m, o, i) {
    for (const id in S.containers) {
      const c = S.containers[id];
      if (c.orderId !== o.id || c.idx !== i) continue;
      if (c.state === 'transit') return `Behälter (${c.qty} Stk) ist unterwegs`;
      if (c.state === 'ready' && c.transportId && S.transports[c.transportId]) return `Behälter (${c.qty} Stk) steht abholbereit an ${stShort(c.location ? c.location.id : '?')} – ${trWhy(S.transports[c.transportId])}`;
    }
    if (i === 0) {
      const r = o.routing[0];
      if (r.material) { const mt = S.materials[r.material.id]; if (mt.onHand + 1e-9 < r.material.perPart) return `Rohteile ${mt.name} fehlen im Lager`; }
      return 'Rohteile werden bereitgestellt';
    }
    const pr = o.routing[i - 1];
    const eta = arrivalEta(o, i);
    if (pr.station === 'EXT') return `Teile in Fremdbearbeitung (${(pr.ext && pr.ext.partner) || 'extern'})${eta ? ', Rückkehr ca. ' + U.fmtDayClock(eta) : ''}`;
    return `Wartet auf Teile von ${mLabel(pr.station)} (${o.id} AG ${pr.seq})${eta ? ' – nächster Behälter ca. ' + tclock(eta) : ''}`;
  }
  function notifyMissing(m, mt, r) {
    const key = 'missing:' + mt.id + ':' + m.id;
    m.missingKey = key;
    if (hasOpen(key)) return;
    notify({ key, sev: 'crit', role: 'Einkauf', entity: { kind: 'machine', id: m.id }, title: `Material fehlt: ${mt.name} für ${m.id}`,
      body: `${m.id} ${m.short} kann nicht weiterfertigen: Bestand ${nm(mt.onHand, 2)} ${mt.unit}, Bedarf ${nm(r.material.perPart, 3)} ${mt.unit} je Teil.${mt.onOrder ? ' Bestellung über ' + nm(mt.onOrder, 1) + ' ' + mt.unit + ' ist unterwegs.' : ''}`,
      suggestion: mt.onOrder ? 'Liefertermin beim Lieferanten bestätigen lassen; ggf. anderen Arbeitsgang auf der Maschine vorziehen.' : `Sofort nachbestellen (${nm(mt.reorderQty, 1)} ${mt.unit} bei ${mt.supplier}, ca. ${U.fmtDur(mt.leadMin * 60)} Lieferzeit).`,
      actions: mt.onOrder ? [] : [{ label: 'Nachbestellen', action: { type: 'reorder', materialId: mt.id, qty: mt.reorderQty } }] });
  }
  /** Rohteile-Behälter für den ersten Arbeitsgang (Form 'Stk' oder ohne Materialangabe) nachliefern */
  function ensureSupply(m, o, i) {
    const r = o.routing[0], op = o.ops[0];
    let pending = waitingQty(o.id, 0);
    for (const id in S.containers) { const c = S.containers[id]; if (c.orderId === o.id && c.idx === 0 && (c.state === 'ready' || c.state === 'transit')) pending += c.qty; }
    const need = o.qty - op.good - op.inProc - pending;
    const batch = opBatch(r);
    if (need <= 0 || pending >= batch) return;
    let qty = Math.min(batch, need);
    if (r.material) {
      const mt = S.materials[r.material.id];
      const can = Math.floor((mt.onHand + 1e-9) / r.material.perPart);
      qty = Math.min(qty, can);
      if (qty <= 0) { if (pending === 0) notifyMissing(m, mt, r); return; }
      materialIssue(mt, qty * r.material.perPart);
    }
    const c = newContainer(o, -1, 0, qty, 'ready', 'raw');
    placeAt(c, 'RAW', 'out');
    createTransport(c);
    ev('issue', 'info', { kind: 'material', id: r.material ? r.material.id : 'RAW' }, `Rohteile bereitgestellt: ${qty} Stk für ${o.id} → ${m.id}${r.material ? ' (Entnahme ' + S.materials[r.material.id].name + ')' : ''}`, { orderId: o.id, qty });
  }
  function barsTransportOf(m) {
    for (const id in S.transports) { const t = S.transports[id]; if (t.kind === 'bars' && t.to.station === m.id && t.status !== 'done') return t; }
    return null;
  }
  /** Stangenlader: Nachschub beauftragen, wenn Magazin < barReorderM und noch Bedarf besteht */
  function ensureBars(m, o, i) {
    if (!m.setupDone && !m.setupRun) return;
    const r = o.routing[i];
    if (m.barMat !== r.material.id) return; // Materialwechsel wird beim Rüsten behandelt
    const need = partsLeft(o, i) * r.material.perPart;
    if (m.barStockM >= m.barReorderM || m.barStockM >= need - 1e-9) return;
    if (barsTransportOf(m)) return;
    const mt = S.materials[r.material.id];
    if (mt.onHand + 1e-9 < r.material.perPart) return;
    const tr = createBarsTransport(m, mt.id);
    ev('barsOrder', 'info', { kind: 'machine', id: m.id }, `${m.id}: Stangenmagazin ${nm(m.barStockM, 1)} m < ${nm(m.barReorderM, 0)} m – Nachschub ${mt.name} per Stapler beauftragt`, { transportId: tr.id });
  }
  function cancelBars(m) {
    const t = barsTransportOf(m);
    if (!t || t.status === 'toDrop' || t.status === 'loaded') return;
    if (t.taskId && S.tasks[t.taskId]) { const tk = S.tasks[t.taskId]; if (tk.workStarted) return; finishTask(tk, 'cancelled'); }
    t.status = 'done'; t.doneT = S.t; t.cancelled = true;
  }
  function outputRoom(m, o, i) {
    const f = fillingAt(m.id, o.id, i);
    if (f && f.qty < opBatch(o.routing[i])) return true;
    return countOut(m.id) < Math.max(1, m.outCap);
  }
  function blockedWhy(m) {
    const st = S.stations[m.id];
    for (const cid of st.out) { const c = S.containers[cid]; if (c.state === 'ready' && c.transportId && S.transports[c.transportId]) return trWhy(S.transports[c.transportId]); }
    return 'Behälter wird geschlossen';
  }
  function trWhy(tr) {
    if (tr.status === 'done') return 'Transport erledigt';
    if (tr.assignee) { const a = S.agvs[tr.assignee]; return (a ? a.name : pname(tr.assignee) + ' (Stapler)') + ' ist unterwegs'; }
    if (tr.waitReason) return tr.waitReason;
    return tr.mode === 'AGV' ? 'wartet auf freies AGV' : 'wartet auf Logistiker:in (Stapler)';
  }

  // ------------------------------------------------------------------ Maschinen: Teile
  /** Eingangsteil entnehmen (reservieren) – bucht Rohmaterial bzw. Stangenmagazin ab */
  function takeInput(m, o, i) {
    const r = o.routing[i], op = o.ops[i];
    if (isSawRaw(m, r, i)) { materialIssue(S.materials[r.material.id], r.material.perPart); op.received++; }
    else if (isBarFed(m, r)) { m.barStockM = r6(Math.max(0, m.barStockM - r.material.perPart)); S.materials[r.material.id].usedToday = r6(S.materials[r.material.id].usedToday + r.material.perPart); op.received++; }
    else {
      const c = firstInput(m.id, o.id, i);
      c.qty--; setWeight(c, o);
      if (c.qty <= 0) removeContainer(c);
    }
    op.inProc++;
    if (!op.startT) op.startT = S.t;
  }
  function newPart(m, o, i, sub, by) {
    const r = o.routing[i], op = o.ops[i];
    const dur = Math.max(5, Math.round((r.cycleMin || 1) * 60 * R.range(0.97, 1.03)));
    m.part = { oid: o.id, idx: i, seq: r.seq, sub, rem: dur, dur, first: !m.released, by: by || null, t0: S.t,
      no: op.good + op.scrap + op.inProc, of: i === 0 ? o.qty : opTargetIn(o, i), rework: !!m.reworking };
    m.reworking = false;
    const pt = m.part;
    pt.label = pt.first ? `${pt.rework ? 'Nacharbeit Erstteil' : 'Erstteil'} ${o.id} AG ${r.seq} wird gefertigt` : `Teil ${pt.no}/${pt.of} ${o.id} AG ${r.seq} in Bearbeitung`;
    pt.loadLabel = `Teil ${pt.no}/${pt.of} wird eingelegt (${by ? pname(by) : '–'})`;
  }
  /** Teil reservieren – bei Nacharbeit des Erstteils wird kein neues Rohteil entnommen */
  function reserve(m, o, i) { if (m.rework) { m.rework = false; m.reworking = true; return; } takeInput(m, o, i); }
  function startPart(m, o, i, by) { reserve(m, o, i); newPart(m, o, i, 'cut', by); }
  function startLoad(m, o, i, p) {
    reserve(m, o, i);
    newPart(m, o, i, 'load', p.id);
    const tk = p.task;
    tk.steps[tk.si + 1].sec = loadSecOf(m, o.routing[i]);
    advanceTask(p);
  }
  /** Bediener vor Zyklusende rufen, damit er an der Teilegrenze bereitsteht */
  function precallLoad(m) {
    if (m.tasks.load || !m.op || m.fault) return;
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i];
    if (!m.released && !m.part.first) return;
    if (m.part.first) return; // nach dem Erstteil folgt die Prüfung
    if (partsLeft(o, i) <= 0) return;
    if (!isSawRaw(m, r, i) && !isBarFed(m, r) && !firstInput(m.id, o.id, i)) return;
    ensureMTask(m, 'load');
  }
  /** Teilende: Standzeit buchen (nur hier!), messen, Gut/Ausschuss, Weitergabe, Werkzeugplanung */
  function partEnd(m) {
    const pt = m.part; m.part = null;
    const o = S.orders[pt.oid], i = pt.idx, r = o.routing[i], op = o.ops[i];
    // 1) Werkzeugverschleiß – steigt ausschließlich am Teilende, nie über 100 %
    let dress = false;
    for (const tid of m.tools) {
      const tl = S.tools[tid], need = cutFor(r, tl.typeId);
      if (!(need > 0)) continue;
      tl.used = Math.min(tl.life, r6(tl.used + need)); tl.parts++;
      if (tl.kind === 'wheel') { tl.sinceDress++; const de = TT[tl.typeId].dressEvery || 0; if (de && tl.sinceDress >= de) { tl.sinceDress = 0; dress = true; } }
    }
    m.counter++; m.lastPartT = S.t;
    const ideal = (r.cycleMin || 1) * 60;
    m.kd.ideal += ideal; m.ks.ideal += ideal;
    // 2) Messwert des Hauptmerkmals
    const meas = measure(m, o, i, pt);
    if (pt.first) {
      m.fpi = { stage: 'wait', t0: S.t, value: meas.v, measOk: meas.ok, no: pt.no, by: null };
      ensureMTask(m, 'fpi');
      ev('fpiReady', 'info', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} fertig – wartet auf Erstteilprüfung (QS)`, { orderId: o.id, seq: r.seq });
    } else {
      op.inProc--;
      if (meas.ok) { op.good++; countGood(m, 1); addToOutput(m, o, i, 1); }
      else { op.scrap++; scrapParts(o, i, 1, 'Maß', m, `${meas.char.name} = ${fmtVal(meas.v, meas.char)} ${meas.char.unit} außerhalb ${fmtVal(meas.lsl, meas.char)} … ${fmtVal(meas.usl, meas.char)}`); }
      spcCheck(m, o, i);
    }
    if (dress) m.dressRem = CFG.dressSec;
    if (!pt.first) checkOpComplete(o, i);
    if (m.op) planTools(m);
  }
  function countGood(m, n) { m.kd.good += n; m.ks.good += n; S.today.good += n; S.shiftStats.good += n; S.histAcc.good += n; }
  function addToOutput(m, o, i, n) {
    let f = fillingAt(m.id, o.id, i);
    if (!f) { f = newContainer(o, i, i + 1, 0, 'filling'); placeAt(f, m.id, 'out'); }
    f.qty += n; setWeight(f, o);
    if (f.qty >= opBatch(o.routing[i])) closeContainer(f);
  }
  /** Ausschuss → Behälter im Sperrlager (je Auftrag), Kennzahlen nach Ursache */
  function scrapParts(o, i, n, reason, m, detail) {
    const st = S.stations.SPERR;
    let c = null;
    if (st) for (const cid of st.inp) { const x = S.containers[cid]; if (x.orderId === o.id && x.state === 'scrap') { c = x; break; } }
    if (!c) { c = newContainer(o, i, i, 0, 'scrap', 'scrap'); placeAt(c, 'SPERR', 'inp'); }
    c.qty += n; setWeight(c, o); c.lastReason = reason;
    if (m) { m.kd.scrap += n; m.ks.scrap += n; }
    S.today.scrap += n; S.shiftStats.scrap += n;
    S.today.scrapBy[reason] = (S.today.scrapBy[reason] || 0) + n;
    ev('scrap', 'warn', { kind: 'machine', id: m ? m.id : o.routing[i].station }, `Ausschuss ${o.id} AG ${o.routing[i].seq} (${reason})${detail ? ': ' + detail : ''} → Sperrlager`, { orderId: o.id, seq: o.routing[i].seq, reason, qty: n });
  }
  function fmtVal(v, ch) { const span = ch.tolPlus - ch.tolMinus; const d = span < 0.05 ? 4 : span < 1 ? 3 : 2; return nm(v, d); }
  /** Messwert = Toleranzmitte + Drift(Verschleiß Hauptwerkzeug) + Korrekturwert + Rauschen */
  function measure(m, o, i, pt) {
    const r = o.routing[i], ch = charOf(m, r), op = o.ops[i];
    const lsl = ch.nominal + ch.tolMinus, usl = ch.nominal + ch.tolPlus, center = (lsl + usl) / 2;
    let main = null, mainCut = -1;
    for (const tid of m.tools) { const tl = S.tools[tid], c = cutFor(r, tl.typeId); if (c > mainCut) { mainCut = c; main = tl; } }
    const wear = main && mainCut > 0 ? main.used / main.life : 0;
    // Einlege-/bemannte Arbeitsplätze: Bediener misst jedes Teil beim Entnehmen und kompensiert den Verschleiß
    // in der Werkzeugkorrektur (Rest-Drift 40 %). Autonome Maschinen driften voll – bis SPC-Korrektur oder Wechsel.
    const comp = m.loading === 'auto' ? 0 : 0.6;
    const v = r6(center + (ch.driftAt100 || 0) * wear * (1 - comp) + (op.offset || 0) + R.normal(0, ch.sigma || (usl - lsl) / 10));
    const ok = v >= lsl - 1e-12 && v <= usl + 1e-12;
    const key = o.id + '/' + r.seq;
    const arr = S.measurements[key] || (S.measurements[key] = []);
    arr.push({ t: S.t, v, ok, partNo: pt.no, fpi: !!pt.first });
    if (arr.length > CFG.measMax) arr.splice(0, arr.length - CFG.measMax);
    return { v, ok, char: ch, lsl, usl, center, wear, mainTool: main };
  }
  /** SPC: Mittelwert der letzten 8 Teile wandert Richtung Toleranzgrenze bzw. gehäufter Ausschuss */
  function spcCheck(m, o, i) {
    const r = o.routing[i], ch = charOf(m, r), key = o.id + '/' + r.seq, nkey = 'spc:' + key;
    const since = S.spcSince[key] || 0;
    const arr = (S.measurements[key] || []).filter(x => !x.fpi && x.t > since);
    if (arr.length < 8) return;
    const last = arr.slice(-8);
    const mean = last.reduce((s, x) => s + x.v, 0) / last.length;
    const lsl = ch.nominal + ch.tolMinus, usl = ch.nominal + ch.tolPlus, center = (lsl + usl) / 2;
    const dev = mean - center, half = dev >= 0 ? usl - center : center - lsl;
    const ratio = half > 0 ? Math.abs(dev) / half : 0;
    const nok = arr.slice(-10).filter(x => !x.ok).length;
    if (ratio > 0.55 || nok >= 2) {
      const corr = -Math.round(dev * 10000) / 10000;
      const tl = mainToolOf(m, r);
      const n = notify({ key: nkey, sev: 'warn', role: 'QS', entity: { kind: 'machine', id: m.id },
        title: `SPC-Trend ${m.id}: ${ch.name} (${o.id})`,
        body: `Mittelwert der letzten 8 Teile ${fmtVal(mean, ch)} ${ch.unit} – ${Math.round(ratio * 100)} % des Wegs zur ${dev > 0 ? 'oberen' : 'unteren'} Toleranzgrenze (${fmtVal(dev > 0 ? usl : lsl, ch)}). ${nok ? nok + ' von 10 Teilen n.i.O. ' : ''}${tl ? 'Verschleiß ' + TT[tl.typeId].name + ': ' + Math.round(tl.used / tl.life * 100) + ' %.' : ''}`,
        suggestion: `Ursache: Werkzeugverschleiß verschiebt das Maß. Empfehlung: Werkzeugkorrektur ${corr > 0 ? '+' : ''}${nm(corr, 4)} ${ch.unit} eingeben (Bediener) oder Werkzeugwechsel vorziehen.`,
        actions: [{ label: 'Korrektur übernehmen', action: { type: 'applyOffset', orderId: o.id, seq: r.seq, value: corr } }] });
      if (!n.spc) n.spc = { machineId: m.id, orderId: o.id, seq: r.seq, since: S.t };
      n.spc.value = corr;
    } else if (ratio < 0.3 && nok === 0 && hasOpen(nkey)) resolveKey(nkey, 'Prozess wieder mittig');
  }
  function mainToolOf(m, r) {
    let main = null, mc = -1;
    for (const tid of m.tools) { const tl = S.tools[tid], c = cutFor(r, tl.typeId); if (c > mc) { mc = c; main = tl; } }
    return mc > 0 ? main : null;
  }
  function applyOffset(orderId, seq, value, by) {
    const o = S.orders[orderId]; if (!o) return { ok: false, msg: 'Auftrag unbekannt' };
    const i = o.routing.findIndex(r => r.seq === seq); if (i < 0) return { ok: false, msg: 'Arbeitsgang unbekannt' };
    const v = Number(value); if (!isFinite(v)) return { ok: false, msg: 'Korrekturwert ungültig' };
    o.ops[i].offset = r6((o.ops[i].offset || 0) + v);
    const ch = charOf(S.machines[o.routing[i].station] || { type: 'cmm' }, o.routing[i]);
    ev('offset', 'info', { kind: 'machine', id: o.routing[i].station }, `${o.routing[i].station}: Werkzeugkorrektur ${v > 0 ? '+' : ''}${nm(v, 4)} ${ch.unit} für ${orderId} AG ${seq} eingegeben${by ? ' (' + by + ')' : ''} – Ursache SPC-Trend`, { orderId, seq, value: v });
    const key = 'spc:' + orderId + '/' + seq;
    S.spcSince[orderId + '/' + seq] = S.t;
    if (hasOpen(key)) resolveKey(key, 'Korrektur eingegeben');
    return { ok: true, msg: 'Korrektur übernommen' };
  }

  // ------------------------------------------------------------------ Maschinen: Rüsten, Erstteil, Korrektur
  function instantSetup(m, o, i) {
    mountForOp(m, o, i);
    m.setupDone = true; m.released = !o.routing[i].firstPiece;
  }
  function onSetupStart(m, p) {
    const c = curOf(m); if (!c) return;
    const { o, i, r } = c;
    m.setupRun = { t0: S.t, by: p.id, dur: (r.setupMin || 0) * 60, cause: `${sn(p.name)} rüstet für ${o.id} AG ${r.seq} „${r.op}“ (${r.setupMin} min)` };
    mountForOp(m, o, i);
    if (isBarFed(m, r) && m.barMat !== r.material.id) {
      if (m.barMat && m.barStockM > 0) {
        const old = S.materials[m.barMat];
        old.onHand = r6(old.onHand + m.barStockM); checkStock(old);
        ev('return', 'info', { kind: 'material', id: old.id }, `${m.id}: Reststangen ${old.name} (${nm(m.barStockM, 2)} m) ins Lager zurückgebucht – Materialwechsel`, null);
      }
      m.barStockM = 0; m.barMat = r.material.id;
      const t = barsTransportOf(m); if (t && t.materialId !== r.material.id) cancelBars(m);
      if (!barsTransportOf(m)) createBarsTransport(m, r.material.id);
    }
    S.today.setups++;
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = S.t; }
    ev('setupStart', 'info', { kind: 'machine', id: m.id }, `${m.id}: Rüsten für ${o.id} AG ${r.seq} gestartet (${sn(p.name)}, geplant ${r.setupMin} min) – neue vermessene Werkzeuge werden eingesetzt`, { orderId: o.id, seq: r.seq, by: p.id });
  }
  function onSetupDone(m) {
    const run = m.setupRun; m.setupRun = null;
    const c = curOf(m); if (!c) return;
    m.setupDone = true; m.released = !c.r.firstPiece;
    ev('setupDone', 'ok', { kind: 'machine', id: m.id }, `${m.id}: Rüsten ${c.o.id} AG ${c.r.seq} abgeschlossen (${U.fmtDur(S.t - run.t0)})${c.r.firstPiece ? ' – nächstes Teil ist Erstteil' : ''}`, { orderId: c.o.id, seq: c.r.seq });
    planTools(m);
  }
  function fpiCause(m) {
    const f = m.fpi, tk = S.tasks[m.tasks.fpi];
    if (f.stage === 'wait') return tk && tk.assignee ? `Erstteil wartet – ${pname(tk.assignee)} holt es ab` : `Erstteil wartet auf QS (${availability(tk).text})`;
    if (f.stage === 'carry') return `${pname(f.by)} bringt das Erstteil in den Messraum`;
    return `Erstteil wird im Messraum gemessen (${pname(f.by)}, ${m.fpiMin || 15} min)`;
  }
  function fpiResult(m, p) {
    const f = m.fpi; m.fpi = null;
    const c = curOf(m); if (!c || !f) return;
    const { o, i, r, op } = c;
    const ch = charOf(m, r);
    const ok = f.measOk && R.chance(P.sim.fpiPassProb != null ? P.sim.fpiPassProb : 0.94);
    op.fpiCount++;
    resolveKey('fpi:' + m.id, 'Erstteil geprüft');
    if (!ok && f.measOk) {
      // Nebenmerkmal n.i.O., Material noch vorhanden → Korrektur, Erstteil wird nachgearbeitet und erneut geprüft
      m.needCorr = true; m.rework = true; S.today.fpiNok++;
      ev('fpiNok', 'warn', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} n.i.O. (Nebenmerkmal Rauheit/Lage) – Korrektur durch Einrichter:in (10 min), Teil wird nachgearbeitet und erneut geprüft`, { orderId: o.id, seq: r.seq, value: f.value, rework: true });
      return;
    }
    op.inProc--;
    if (ok) {
      op.good++; countGood(m, 1); addToOutput(m, o, i, 1);
      m.released = true; S.today.fpiOk++;
      ev('fpiOk', 'ok', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} i.O. (${ch.name} ${fmtVal(f.value, ch)} ${ch.unit}) – Serie freigegeben durch ${sn(p.name)}`, { orderId: o.id, seq: r.seq, value: f.value });
    } else {
      op.scrap++; S.today.fpiNok++;
      scrapParts(o, i, 1, 'Erstteil n.i.O.', m, `${ch.name} ${fmtVal(f.value, ch)} ${ch.unit} außerhalb ${fmtVal(ch.nominal + ch.tolMinus, ch)} … ${fmtVal(ch.nominal + ch.tolPlus, ch)}`);
      m.needCorr = true;
      ev('fpiNok', 'warn', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} n.i.O. (Maß außer Toleranz, Ausschuss) – Korrektur durch Einrichter:in (10 min), danach neues Erstteil`, { orderId: o.id, seq: r.seq, value: f.value });
    }
    checkOpComplete(o, i);
  }

  // ------------------------------------------------------------------ Maschinen: Störungen
  function faultCatalog(m) {
    const f = P.faults || {};
    let list;
    if (m.type === 'washer' || m.type === 'cmm' || m.type === 'assembly') list = (f[m.type] || EXTRA_FAULTS[m.type] || []).slice();
    else {
      const noBreak = m.type === 'cylgrinder' || m.type === 'surfgrinder' || m.type === 'saw';
      list = (f.generic || []).filter(x => !(x.toolBreak && noBreak)).concat(f[m.automation] || [], f[m.type] || []);
    }
    return list.length ? list : EXTRA_FAULTS.cmm;
  }
  function startFault(m, code, manual) {
    const list = faultCatalog(m);
    let f = null;
    if (code) { f = list.find(x => x.code === code); if (!f) for (const k in P.faults) { f = P.faults[k].find(x => x.code === code); if (f) break; } }
    if (!f) f = R.pick(list);
    const rm = f.repairMin || [10, 20];
    m.fault = { code: f.code, text: f.text, cause: f.cause, t0: S.t, repairSec: Math.round(R.range(rm[0], rm[1]) * 60), repairMin: rm, toolBreak: !!f.toolBreak, repairBy: null, manual: !!manual, partScrapped: false, toolId: null };
    S.today.faults++;
    if (f.toolBreak && m.op) {
      const c = curOf(m);
      const cand = m.tools.map(id => S.tools[id]).filter(tl => cutFor(c.r, tl.typeId) > 0);
      if (cand.length) { const tl = R.pick(cand); tl.broken = true; tl.used = tl.life; m.fault.toolId = tl.id; }
      const pt = m.part;
      if (pt && pt.sub === 'cut') { c.op.inProc--; c.op.scrap++; scrapParts(c.o, c.i, 1, 'Werkzeugbruch', m, f.code + ' ' + f.text); m.part = null; m.fault.partScrapped = true; }
    }
    const lt = S.tasks[m.tasks.load]; if (lt && !lt.workStarted) cancelTask(lt, 'Störung');
    ensureMTask(m, 'repair');
    setState(m, 'fault', `${f.code} ${f.text}`, 'fault');
    ev('fault', 'crit', { kind: 'machine', id: m.id }, `${m.id} ${m.short}: Störung ${f.code} „${f.text}“${manual ? ' (Demo ausgelöst)' : ''}${m.fault.partScrapped ? ' – laufendes Teil Ausschuss' : ''}`, { code: f.code, toolBreak: !!f.toolBreak });
    const rep = repairerHint();
    notify({ key: 'fault:' + m.id, sev: 'crit', role: 'Instandhaltung', entity: { kind: 'machine', id: m.id },
      title: `Störung ${m.id} ${m.short}: ${f.text}`,
      body: `Alarm ${f.code} seit ${U.fmtClock(S.t)}. ${f.toolBreak ? 'Werkzeugbruch: laufendes Teil ist Ausschuss, das Werkzeug muss nach der Reparatur gewechselt werden.' : (m.part ? 'Laufendes Teil ist angehalten und wird nach der Reparatur fertig bearbeitet.' : 'Maschine steht.')} Erfahrungswert Reparatur ${rm[0]}–${rm[1]} min.`,
      suggestion: `Wahrscheinliche Ursache: ${f.cause}. ${rep}`,
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
  }
  function repairerHint() {
    const on = Object.values(S.people).filter(p => p.onDuty && !p.endShift && (p.skills.includes('repair') || p.skills.includes('toolchange')));
    if (!on.length) return 'Aktuell ist niemand aus Instandhaltung/Einrichtung im Dienst – Rufbereitschaft verständigen oder bis Schichtbeginn warten.';
    const r = on.find(p => p.skills.includes('repair')) || on[0];
    return `${sn(r.name)} (${r.role}) wird automatisch zugeteilt, sobald verfügbar.`;
  }
  function endFault(m, by) {
    const f = m.fault; if (!f) return;
    m.fault = null;
    const rt = S.tasks[m.tasks.repair]; if (rt && !by) finishTask(rt, 'cancelled');
    ev('repair', 'ok', { kind: 'machine', id: m.id }, `${m.id}: Störung ${f.code} behoben${by ? ' durch ' + pname(by) : ' (Demo-Aktion)'} – Stillstand ${U.fmtDur(S.t - f.t0)}${f.toolBreak ? '; gebrochenes Werkzeug wird jetzt gewechselt' : ''}`, { code: f.code, by: by || null, downSec: S.t - f.t0 });
    resolveKey('fault:' + m.id, 'Störung behoben');
    planTools(m);
  }

  // ------------------------------------------------------------------ Maschinen: Personalbedarf
  function waitOp(m, key, what) {
    const tk = S.tasks[m.tasks[key]];
    let cause, code;
    if (tk && tk.assignee) {
      const p = S.people[tk.assignee];
      const eta = p.route ? Math.round(routeLeft(p) / WALK) : 0;
      cause = `${what}: ${sn(p.name)} ist unterwegs${eta > 5 ? ' (ca. ' + U.fmtDur(eta) + ')' : ''}`; code = 'walking';
    } else { const a = cz(m, 'av:' + key + (tk ? tk.id : ''), () => availability(tk)); cause = `${what} – ${a.text}`; code = a.code; }
    m.waitCode = code;
    return setState(m, 'waitOperator', cause, code);
  }
  /** Warum ist (noch) niemand da? – offShift | break | busy | assigning */
  function availability(tk) {
    if (!tk) return { code: 'none', text: 'keine Aufgabe' };
    let onDuty = 0, inBreak = 0; const busy = [];
    for (let j = 0; j < PA.length; j++) {
      const p = PA[j];
      if (!p.onDuty || p.endShift || eligible(p, tk) < 0) continue;
      onDuty++;
      if (p.state === 'break' || (p.breakPending && !p.task)) { inBreak++; continue; }
      if (p.task) busy.push(sn(p.name) + ': ' + p.task.label);
    }
    if (!onDuty) return { code: 'offShift', text: `keine qualifizierte Person im Dienst (nächste Schicht ${tclock(nextWorkStart(S.t + 1))})` };
    if (inBreak && !busy.length) return { code: 'break', text: `Pause bis ${cur && cur.breakEnd ? U.fmtClock(cur.breakEnd) : '–'}` };
    if (busy.length) return { code: 'busy', text: 'qualifizierte Personen beschäftigt (' + busy.slice(0, 2).join('; ') + ')' };
    return { code: 'assigning', text: 'Person wird zugeteilt' };
  }
  function presentFor(m, key) {
    const tk = S.tasks[m.tasks[key]];
    return tk && tk.assignee && tk.ready ? S.people[tk.assignee] : null;
  }
  function techReady(m) { const tk = S.tasks[m.tasks.tc]; return !!(tk && tk.assignee && tk.ready); }
  /** Anwesende Person muss an der Teilegrenze gehen (Pause, Schichtende, dringendere Aufgabe) */
  function mustLeave(p) {
    if (p.breakPending || p.endShift) return true;
    const myPrio = p.task ? p.task.prio : 0;
    for (const id in S.tasks) { const tk = S.tasks[id]; if (tk.status === 'open' && tk.prio > myPrio && eligible(p, tk) >= 0) return true; }
    return false;
  }
  function releaseAttendant(m) {
    const tk = S.tasks[m.tasks.attend];
    if (tk && !(m.part && m.part.by === tk.assignee)) finishTask(tk, 'done');
  }
  function dropWaiters(m) {
    const tk = S.tasks[m.tasks.load];
    if (tk && !tk.workStarted) cancelTask(tk, 'nicht mehr nötig');
    releaseAttendant(m);
  }

  // ------------------------------------------------------------------ Werkzeuge (§3.4 – die eine, sichtbare Regel)
  //   Verschleiß = used / life, steigt nur am Teilende, nie > 100 %.
  //   remainingParts = floor((life − used) / cutMinPerPart).
  //   remainingParts ≤ planAtParts  UND  offene Teile des Arbeitsgangs > remainingParts  → Wechsel geplant.
  //   (Reicht die Reststandzeit für den Rest des Arbeitsgangs, wird nicht gewechselt – das wäre sinnlos.)
  //   Gewechselt wird nur an einer Teilegrenze mit Einrichter:in vor Ort; remainingParts = 0 → waitTool.
  function cutFor(r, typeId) { for (const t of r.tools || []) if (t.type === typeId) return t.cutMinPerPart; return 0; }
  function remParts(tl, cut) { if (tl.broken) return 0; if (!(cut > 0)) return Infinity; return Math.max(0, Math.floor((tl.life - tl.used) / cut + 1e-9)); }
  function mountedOf(m, typeId) { for (const id of m.tools) { const tl = S.tools[id]; if (tl.typeId === typeId) return tl; } return null; }
  /** Wechselgrenze als Verschleiß-% (ab hier gilt remainingParts ≤ planAtParts) – für die UI */
  function planWearPct(tl, cut) { return cut > 0 ? Math.max(0, Math.min(100, Math.round((tl.life - (PLAN_AT + 1) * cut) / tl.life * 1000) / 10)) : null; }
  function mountTool(m, typeId, used, fromStock) {
    const tt = TT[typeId];
    if (!tt) return null;
    if (fromStock !== false) { const st = S.toolStock[typeId]; if (st && st.ready > 0) st.ready--; }
    const tl = { id: U.uid('WZ'), typeId, name: tt.name, kind: tt.kind, machineId: m.id, used: Math.min(tt.lifeMin, used || 0), life: tt.lifeMin,
      mountedT: S.t, parts: 0, sinceDress: 0, broken: false, state: 'mounted', plannedT: null };
    S.tools[tl.id] = tl; m.tools.push(tl.id);
    return tl;
  }
  /** Werkzeug ausbauen → Werkzeugausgabe / Nachschliff / Schrott (Kosten) */
  function dismountTool(m, tl, reason) {
    const k = m.tools.indexOf(tl.id); if (k >= 0) m.tools.splice(k, 1);
    const tt = TT[tl.typeId], st = S.toolStock[tl.typeId], w = tl.used / tl.life;
    let disp, cost = 0;
    if (tl.broken) { disp = 'verschrottet (Bruch)'; cost = tt.cost; st.scrapToday++; tl.state = 'scrap'; }
    else if (reason === 'Rüsten' && w < 0.5) { disp = 'zurück in die Werkzeugausgabe'; st.ready++; tl.state = 'stock'; }
    else if (tt.kind === 'insert' || tt.kind === 'saw' || tt.kind === 'wheel') { disp = 'verschrottet'; cost = tt.cost; st.scrapToday++; tl.state = 'scrap'; }
    else { disp = 'zum Nachschliff'; cost = Math.round(tt.cost * 0.25); st.regrind++; tl.state = 'regrind'; }
    S.toolCostToday += cost;
    tl.machineId = null; tl.dismountT = S.t; tl.reason = reason; tl.cost = cost; tl.disposal = disp; tl.lastMachine = m.id;
    (S.toolLog || (S.toolLog = [])).push(tl.id);
    while (S.toolLog.length > CFG.toolsKeep) delete S.tools[S.toolLog.shift()];
    return disp;
  }
  /** Rüsten: alle Werkzeuge des Arbeitsgangs neu (vermessen); Sägeband/Schleifscheibe/Wälzfräser gleichen Typs bleiben montiert */
  function mountForOp(m, o, i) {
    const r = o.routing[i];
    const need = new Set((r.tools || []).map(t => t.type));
    for (const tid of m.tools.slice()) {
      const tl = S.tools[tid];
      const keep = need.has(tl.typeId) && (tl.kind === 'saw' || tl.kind === 'wheel' || tl.kind === 'hob') && !tl.broken;
      if (keep) { need.delete(tl.typeId); continue; }
      dismountTool(m, tl, 'Rüsten');
    }
    for (const typeId of need) mountTool(m, typeId, 0, true);
  }
  /** Planungsvorlauf in Teilen: mind. planAtParts, bei kurzen Taktzeiten so viele Teile, wie das Holen des
      Werkzeugs dauert (sonst käme die Einrichter:in nie rechtzeitig). Gewechselt wird trotzdem erst bei ≤ planAtParts. */
  function leadSec() { const tp = P.sim.toolPolicy || {}; return (tp.fetchMin || 3) * 60 + 150; }
  function planHorizon(m, r) { return Math.max(PLAN_AT, Math.ceil(leadSec() / Math.max(1, cycleSec(m, r)))); }
  function toolCheck(m, o, i) {
    const r = o.routing[i], pl = partsLeft(o, i), H = planHorizon(m, r);
    const res = { change: [], short: [], planned: [], pl, horizon: H };
    for (const spec of r.tools || []) {
      const tl = mountedOf(m, spec.type);
      const rem = tl ? remParts(tl, spec.cutMinPerPart) : 0;
      const x = { spec, tl, rem };
      if (pl > 0 && rem < 1) res.short.push(x);
      if (pl > 0 && (rem < 1 || (rem <= PLAN_AT && pl > rem))) res.change.push(x);
      if (pl > 0 && (rem < 1 || (rem <= H && pl > rem))) res.planned.push(x);
    }
    return res;
  }
  /** frühester Zeitpunkt, an dem gewechselt werden darf (erste Teilegrenze mit remainingParts ≤ planAtParts) */
  function earliestChangeT(m) {
    const c = curOf(m); if (!c) return S.t;
    const tc = toolCheck(m, c.o, c.i);
    if (!tc.planned.length) return S.t;
    const minRem = tc.planned.reduce((a, x) => Math.min(a, x.rem), Infinity);
    const cyc = cycleSec(m, c.r);
    if (m.part) return S.t + m.part.rem + m.dressRem + Math.max(0, minRem - 1 - PLAN_AT) * cyc;
    return S.t + m.dressRem + Math.max(0, minRem - PLAN_AT) * cyc;
  }
  /** Werkzeugwechsel planen (an Teilegrenzen aufgerufen) */
  function planTools(m) {
    if (!m.op || !m.setupDone || m.toolchange) return;
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i];
    const tc = toolCheck(m, o, i);
    const tk = S.tasks[m.tasks.tc];
    if (!tc.planned.length) {
      if (tk && !tk.data.manual && !tk.workStarted) cancelTask(tk, 'kein Wechsel nötig');
      if (!S.tasks[m.tasks.tc] && hasOpen('tool:' + m.id)) resolveKey('tool:' + m.id, 'kein Wechsel mehr nötig');
      return;
    }
    ensureToolTask(m, tc.short.length > 0);
    for (const x of tc.planned) {
      if (!x.tl || x.tl.plannedT) continue;
      x.tl.plannedT = S.t;
      ev('toolPlanned', 'info', { kind: 'machine', id: m.id },
        `${m.id}: Werkzeugwechsel geplant – ${TT[x.spec.type].name}: noch ${teile(x.rem)} Reststandzeit (Wechselgrenze ${PLAN_AT} Teile${tc.horizon > PLAN_AT ? ', Vorlauf ' + tc.horizon + ' Teile für das Holen des Werkzeugs' : ''}), ${tc.pl} Teile offen`,
        { typeId: x.spec.type, toolId: x.tl.id, rem: x.rem, wearPct: Math.round(x.tl.used / x.tl.life * 1000) / 10 });
    }
    const pc = plannedChange(m, o, i, tc.planned);
    const stockTxt = tc.planned.map(x => `${x.spec.type}: ${S.toolStock[x.spec.type] ? S.toolStock[x.spec.type].ready : 0} Stk`).join(', ');
    notify({ key: 'tool:' + m.id, sev: 'info', role: 'Einrichter', entity: { kind: 'machine', id: m.id },
      title: `Werkzeugwechsel geplant – ${m.id} ${m.short}`,
      body: tc.planned.map(x => `${TT[x.spec.type].name}: Verschleiß ${x.tl ? nm(x.tl.used / x.tl.life * 100, 0) : 100} %, noch ${teile(x.rem)}`).join(' · ') + `. Wechsel nach Teil ${pc.afterPart} · ca. ${U.fmtClock(pc.etaT)} (${o.id} AG ${r.seq}).`,
      suggestion: `Vermessenes Werkzeug in der Werkzeugausgabe holen (Bestand ${stockTxt}) und an der nächsten Teilegrenze wechseln. Bei 0 Teilen Reststandzeit stoppt die Maschine (Wartet auf Werkzeug).`,
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
  }
  /** Schätzung: nach welchem Teil / wann wird gewechselt? (erste Teilegrenze nach Eintreffen der Einrichter:in) */
  function plannedChange(m, o, i, list) {
    const r = o.routing[i], op = o.ops[i];
    const cyc = cycleSec(m, r);
    const tk = S.tasks[m.tasks.tc];
    const tp = P.sim.toolPolicy || {};
    let lead;
    if (tk && tk.ready) lead = 0;
    else if (tk && tk.assignee) { const p = S.people[tk.assignee]; lead = (p.workRem || 0) + (p.route ? routeLeft(p) / WALK : 0) + (tk.data.fetched ? 0 : 60); }
    else lead = (tp.fetchMin || 3) * 60 + 150;
    let minRem = Infinity; for (const x of list) minRem = Math.min(minRem, x.rem);
    if (!isFinite(minRem)) minRem = 0;
    const processed = op.good + op.scrap + op.inProc;
    let b0 = S.t + m.dressRem, kMax = minRem, kMin = Math.max(0, minRem - PLAN_AT);
    if (m.part) { b0 = S.t + m.part.rem + m.dressRem; kMax = Math.max(0, minRem - 1); kMin = Math.max(0, minRem - 1 - PLAN_AT); }
    let k = Math.min(kMin, kMax);
    while (k < kMax && b0 + k * cyc < S.t + lead) k++;
    return { afterPart: processed + k, etaT: Math.round(b0 + k * cyc), lead: Math.round(lead) };
  }
  function ensureToolTask(m, urgent) {
    let tk = S.tasks[m.tasks.tc];
    if (!tk) {
      const c = curOf(m), tp = P.sim.toolPolicy || {};
      tk = newTask('toolChange', m, c, [W('CRIB'), K((tp.fetchMin || 3) * 60, 'fetch', `Holt vermessenes Werkzeug für ${m.id} in der Werkzeugausgabe`),
        W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Werkzeugwechsel)`), K(240, 'tc', `Wechselt Werkzeug an ${m.id}`)]);
      m.tasks.tc = tk.id; tk.mkey = 'tc';
    }
    if (urgent && tk.prio < PRIO.toolChangeWait) { tk.prio = PRIO.toolChangeWait; tk.label = `Werkzeugwechsel ${mLabel(m.id)} (Maschine wartet)`; }
    return tk;
  }
  function startToolChange(m, o, i, tc) {
    const tk = S.tasks[m.tasks.tc], p = S.people[tk.assignee];
    const list = tc.change.slice();
    if (tk.data.manual) for (const typeId of tk.data.types || []) if (!list.some(x => x.spec.type === typeId)) { const spec = (o.routing[i].tools || []).find(t => t.type === typeId); const tl = mountedOf(m, typeId); if (spec && tl) list.push({ spec, tl, rem: remParts(tl, spec.cutMinPerPart) }); }
    const tp = P.sim.toolPolicy || {}, cm = tp.changeMin || [3, 6];
    const sec = Math.round(R.range(cm[0], cm[1]) * 60 * (1 + 0.35 * Math.max(0, list.length - 1)));
    const minRem = list.reduce((a, x) => Math.min(a, x.rem), Infinity);
    m.toolchange = { taskId: tk.id, by: p.id, t0: S.t, dur: sec, manual: !!tk.data.manual,
      list: list.map(x => ({ type: x.spec.type, toolId: x.tl ? x.tl.id : null, rem: x.rem })),
      cause: `${sn(p.name)} wechselt ${list.map(x => TT[x.spec.type].name).join(', ')} (${tk.data.manual ? 'vorbeugend, manuell beauftragt' : minRem < 1 ? 'Standzeit erschöpft' : 'Reststandzeit ' + teile(minRem) + ' ≤ Wechselgrenze ' + PLAN_AT})` };
    tk.steps[tk.si + 1].sec = sec;
    advanceTask(p);
  }
  function onToolChanged(m) {
    const t = m.toolchange; m.toolchange = null;
    if (!t) return;
    const c = curOf(m);
    const main = c ? mainToolOf(m, c.r) : null;
    const changed = [];
    for (const x of t.list) {
      const old = x.toolId ? S.tools[x.toolId] : null;
      const reason = old && old.broken ? 'Werkzeugbruch' : t.manual ? 'vorbeugender Wechsel (manuell)' : x.rem < 1 ? 'Standzeit erschöpft' : `Reststandzeit ${teile(x.rem)} ≤ Wechselgrenze ${PLAN_AT}`;
      const wearPct = old ? Math.round(old.used / old.life * 1000) / 10 : null;
      const disp = old ? dismountTool(m, old, reason) : 'neu bestückt';
      const nt = mountTool(m, x.type, 0, true);
      if (c && main && old && old.id === main.id) { // neues Hauptwerkzeug → Korrekturwert und SPC-Trend zurücksetzen
        c.op.offset = 0; const key = c.o.id + '/' + c.r.seq; S.spcSince[key] = S.t;
        if (hasOpen('spc:' + key)) resolveKey('spc:' + key, 'neues Werkzeug – Trend zurückgesetzt');
      }
      changed.push({ typeId: x.type, name: TT[x.type].name, oldToolId: old ? old.id : null, newToolId: nt.id, wearPct, rem: x.rem, reason, disposal: disp });
    }
    S.today.toolChanges += changed.length;
    ev('toolChanged', 'info', { kind: 'machine', id: m.id },
      `${m.id}: Werkzeug gewechselt durch ${pname(t.by)} – ` + changed.map(x => `${x.name} (${x.reason}; Verschleiß ${x.wearPct != null ? nm(x.wearPct, 0) + ' %' : '–'} → ${x.disposal})`).join('; '),
      { tools: changed, partProgress: 0, by: t.by, durSec: S.t - t.t0 });
    resolveKey('tool:' + m.id, 'Werkzeug gewechselt');
  }
  function toolWaitCause(m, tc) {
    const x = tc.short[0];
    const tk = S.tasks[m.tasks.tc];
    const name = TT[x.spec.type].name;
    const why = x.tl && x.tl.broken ? 'nach Werkzeugbruch' : `Reststandzeit ${x.tl ? nm(x.tl.life - x.tl.used, 1) : 0} min < ${nm(x.spec.cutMinPerPart, 1)} min je Teil`;
    let who;
    if (tk && tk.assignee) { const p = S.people[tk.assignee]; who = tk.data.fetched || (tk.steps[tk.si] && tk.steps[tk.si].to !== 'CRIB') ? `${sn(p.name)} kommt mit dem Werkzeug` : `${sn(p.name)} holt das Werkzeug`; }
    else who = availability(tk).text;
    return `${name}: ${why} – ${who}`;
  }
  /** Erklärtext der Werkzeugregel für die UI */
  function toolExplain(m, tl, spec, o, i) {
    const cut = spec.cutMinPerPart, rem = remParts(tl, cut);
    const pl = partsLeft(o, i) + (m.part && m.part.idx === i ? 1 : 0);
    const tk = S.tasks[m.tasks.tc];
    if (tl.broken) return 'Werkzeugbruch – Wechsel erforderlich, bevor das nächste Teil startet.';
    if (rem < 1) return `Standzeit erschöpft (${nm(tl.life - tl.used, 1)} min Rest < ${nm(cut, 1)} min je Teil) – es wird nicht weitergeschnitten, Wechsel ${tk && tk.assignee ? 'läuft' : 'angefordert'}.`;
    if (pl <= rem) return `Reststandzeit reicht für die restlichen ${pl} Teile dieses Arbeitsgangs (noch ${rem} Teile möglich) – kein Wechsel nötig.`;
    if (rem <= PLAN_AT) return `Noch ${teile(rem)} ≤ Wechselgrenze ${PLAN_AT} → Wechsel erfolgt an der nächsten Teilegrenze, sobald Einrichter:in mit vermessenem Werkzeug da ist.`;
    const H = planHorizon(m, o.routing[i]);
    if (rem <= H) return `Noch ${teile(rem)}: Wechsel ist geplant (Vorlauf ${H} Teile ≈ Zeit zum Holen des Werkzeugs). Gewechselt wird an der ersten Teilegrenze mit ≤ ${PLAN_AT} Teilen Reststandzeit.`;
    return `Wechsel wird geplant, sobald noch ≤ ${PLAN_AT} Teile Reststandzeit (ab ca. ${nm(planWearPct(tl, cut), 0)} % Verschleiß, in ca. ${rem - PLAN_AT} Teilen).`;
  }

  // ------------------------------------------------------------------ Personen & Aufgaben (§3.5)
  // Aufgabe = Schrittfolge: walk (zu Fuß), drive (Stapler), toForklift, work (Dauer, Aktion), wait (an der
  // Maschine bereitstehen – Maschine setzt fort), attend (anwesend während Bearbeitung, Maschine beendet).
  const W = (to, at) => ({ k: 'walk', to, at: at || 'work' });
  const K = (sec, act, label) => ({ k: 'work', sec, act, label });
  const WAIT = (label) => ({ k: 'wait', label });
  const ATT = (label) => ({ k: 'attend', label });
  const DRV = (to, at) => ({ k: 'drive', to, at: at || 'work' });
  const FORKW = () => ({ k: 'toForklift' });

  function newTask(type, m, c, steps, extra) {
    const mid = typeof m === 'string' ? m : m.id;
    const isM = !!S.machines[mid];
    const tk = { id: U.uid('AU'), type, prio: PRIO[type] || 10, target: { kind: isM ? 'machine' : 'station', id: mid }, machineId: isM ? mid : null,
      orderId: c ? c.o.id : null, seq: c ? c.r.seq : null, label: `${TASK_LABEL[type] || type} ${mLabel(mid)}${c ? ' · ' + c.o.id : ''}`,
      status: 'open', assignee: null, createdT: S.t, steps, si: 0, ready: false, workStarted: false, data: {}, mkey: null, transportId: null };
    if (extra) Object.assign(tk, extra);
    S.tasks[tk.id] = tk;
    return tk;
  }
  /** Maschinenbezogene Aufgabe anlegen, falls noch nicht vorhanden */
  function ensureMTask(m, key) {
    const ex = m.tasks[key] && S.tasks[m.tasks[key]];
    if (ex) return ex;
    const c = curOf(m);
    let tk = null;
    switch (key) {
      case 'setup': tk = newTask('setup', m, c, [W(m.id), K((c.r.setupMin || 0) * 60, 'setup', `Rüstet ${m.id} für ${c.o.id} AG ${c.r.seq}`)]); break;
      case 'corr': tk = newTask('correction', m, c, [W(m.id), K(CFG.correctionSec, 'corr', `Korrigiert ${m.id} nach Erstteil n.i.O.`)]); break;
      case 'load': tk = newTask('load', m, c, [W(m.id), WAIT(`Steht an ${m.id} bereit (Zyklusende)`), K(loadSecOf(m, c.r), 'load', `Legt Teil in ${m.id} ein (${c.o.id})`)]); break;
      case 'attend': tk = newTask(m.kind === 'assembly' ? 'assembly' : 'inspect', m, c, [W(m.id), ATT(m.kind === 'assembly' ? `Montiert ${c.o.id} (${c.r.op})` : `Prüft ${c.o.id} AG ${c.r.seq} (${c.r.op})`)]); break;
      case 'fpi': tk = newTask('fpi', m, c, [W(m.id), K(CFG.fpiPickSec, 'fpiPick', `Entnimmt Erstteil an ${m.id}`), W('QS'), K((m.fpiMin || 15) * 60, 'fpiMeasure', `Erstteilprüfung ${m.id} für ${c.o.id} am KMG`)]); break;
      case 'repair': tk = newTask('repair', m, c, [W(m.id), K(m.fault.repairSec, 'repair', `Repariert ${m.id}: ${m.fault.text}`)]); break;
    }
    if (!tk) return null;
    m.tasks[key] = tk.id; tk.mkey = key;
    return tk;
  }
  function cancelMTask(m, key) { const tk = S.tasks[m.tasks[key]]; if (tk && !tk.workStarted) cancelTask(tk, 'entfällt'); else if (tk && key === 'tc' && tk.steps[tk.si] && tk.steps[tk.si].k === 'wait') cancelTask(tk, 'entfällt'); }
  function cancelTask(tk, why) { tk.cancelReason = why; finishTask(tk, 'cancelled'); }

  /** Qualifikation: −1 = nicht geeignet, sonst Zuschlag (Meter) für die Auswahl */
  function eligible(p, tk) {
    const m = tk.machineId ? S.machines[tk.machineId] : null, sk = p.skills;
    switch (tk.type) {
      case 'setup': case 'correction': return m && sk.includes(m.skill) && (sk.includes('setup') || p.machines.includes(m.id)) ? 0 : -1;
      case 'load': if (!m || !sk.includes(m.skill)) return -1; return p.machines.includes(m.id) ? 0 : sk.includes('setup') ? 80 : 40;
      case 'toolChange': if (sk.includes('toolchange')) return sk.includes('lead') ? 40 : 0; return m && p.machines.includes(m.id) && sk.includes(m.skill) ? 25 : -1;
      case 'fpi': case 'inspect': return sk.includes('qs') ? 0 : -1;
      case 'assembly': return sk.includes('assembly') ? 0 : -1;
      case 'repair': return sk.includes('repair') ? 0 : sk.includes('toolchange') ? 60 : -1;
      case 'forklift': case 'bars': { const f = S.forklift; if (f.reservedBy && f.reservedBy !== p.id) return -1; return sk.includes('forklift') ? 0 : -1; }
    }
    return -1;
  }
  function isFree(p) {
    return p.onDuty && !p.task && !p.endShift && !p.breakPending && p.state !== 'break' && p.state !== 'offShift' && p.goal !== 'break' && p.goal !== 'exit';
  }
  function firstTarget(tk) { for (let k = tk.si; k < tk.steps.length; k++) if (tk.steps[k].to) return tk.steps[k].to; return tk.target.id; }
  function assignTasks() {
    let open = null;
    for (const id in S.tasks) { const tk = S.tasks[id]; if (tk.status === 'open') (open || (open = [])).push(tk); }
    if (!open) return;
    let free = null;
    for (let j = 0; j < PA.length; j++) { const p = PA[j]; if (isFree(p)) (free || (free = [])).push(p); }
    if (!free) return;
    open.sort((a, b) => b.prio - a.prio || a.createdT - b.createdT || (a.id < b.id ? -1 : 1));
    for (const tk of open) {
      if (tk.type === 'toolChange' && tk.prio < PRIO.toolChangeWait && !tk.data.manual && tk.machineId) {
        // geplanter Wechsel: erst losgehen, wenn die Wechsel-Teilegrenze in Reichweite ist (kein Herumstehen bei langen Zyklen)
        const tEarliest = earliestChangeT(S.machines[tk.machineId]);
        tk.holdUntil = tEarliest - leadSec() - 120;
        if (tk.holdUntil > S.t) continue;
      }
      let best = null, bc = Infinity;
      const tgt = firstTarget(tk);
      for (const p of free) {
        if (p.task) continue;
        const pen = eligible(p, tk); if (pen < 0) continue;
        const c = pathLen(p.node, tgt) + pen;
        if (c < bc) { bc = c; best = p; }
      }
      if (best) assign(best, tk);
    }
  }
  function assign(p, tk) {
    tk.status = 'assigned'; tk.assignee = p.id; tk.assignedT = S.t;
    p.task = tk; p.goal = null; p.atHome = false; p.tasksToday++;
    if (tk.transportId && S.transports[tk.transportId]) { const tr = S.transports[tk.transportId]; tr.status = 'assigned'; tr.assignee = p.id; }
    if (tk.type === 'forklift' || tk.type === 'bars') S.forklift.reservedBy = p.id;
    startStep(p);
  }
  function offsetPos(p, pos, at) {
    if (at !== 'work') return pos;
    const d = ((p.idx % 3) - 1) * 0.45;
    return { x: pos.x + d, z: pos.z };
  }
  function startStep(p) {
    const tk = p.task; if (!tk) return;
    const s = tk.steps[tk.si];
    if (!s) { finishTask(tk, 'done'); return; }
    tk.ready = false;
    switch (s.k) {
      case 'walk': case 'drive': {
        const st = ST[s.to];
        const pos = offsetPos(p, stPos(s.to, s.at), s.at);
        if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 0.25) { p.route = null; p.node = st.dockNode; tk.si++; return startStep(p); }
        routeTo(p, st.dockNode, pos);
        p.state = s.k === 'drive' ? 'driving' : 'walking';
        p.activity = s.k === 'drive' ? `Fährt Stapler zu ${stShort(s.to)} (${TASK_LABEL[tk.type]})` : `Geht zu ${mLabel(s.to)} (${TASK_LABEL[tk.type]})`;
        if (s.k === 'drive' && tk.transportId) { const tr = S.transports[tk.transportId]; if (tr) tr.status = tr.status === 'loaded' || tr.status === 'toDrop' ? 'toDrop' : 'toPickup'; }
        return;
      }
      case 'toForklift': {
        const f = S.forklift;
        if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) < 0.3) { mountForklift(p); tk.si++; return startStep(p); }
        routeTo(p, f.node, f.pos);
        p.state = 'walking'; p.activity = 'Geht zum Stapler';
        return;
      }
      case 'work':
        p.route = null; p.state = 'working'; tk.workStarted = true;
        actStart(p, tk, s);
        if (p.task !== tk) return;
        p.workRem = Math.max(1, Math.round(s.sec)); p.activity = s.label;
        return;
      case 'wait': case 'attend':
        p.route = null; p.state = 'working'; p.activity = s.label; tk.ready = true;
        if (s.k === 'attend') tk.workStarted = true;
        return;
    }
  }
  /** von der Maschine aus: wartende Person setzt mit dem nächsten Schritt fort */
  function advanceTask(p) { const tk = p.task; if (!tk) return; tk.si++; startStep(p); }
  function onWorkDone(p) {
    const tk = p.task, s = tk.steps[tk.si];
    actDone(p, tk, s);
    if (p.task !== tk || tk.status !== 'assigned') return;
    tk.si++;
    startStep(p);
  }
  function finishTask(tk, status) {
    if (!S.tasks[tk.id]) return;
    tk.status = status || 'done'; tk.doneT = S.t;
    const p = tk.assignee ? S.people[tk.assignee] : null;
    if (p && p.task === tk) {
      p.task = null; p.state = 'idle'; p.route = null; p.workRem = 0; p.idleSince = S.t; p.activity = 'Bereit';
      if (p.vehicle) parkForklift(p);
    }
    if (S.forklift.reservedBy && S.forklift.reservedBy === tk.assignee && (tk.type === 'forklift' || tk.type === 'bars')) S.forklift.reservedBy = null;
    if (tk.machineId && tk.mkey) { const m = S.machines[tk.machineId]; if (m && m.tasks[tk.mkey] === tk.id) m.tasks[tk.mkey] = null; }
    if (tk.transportId && status === 'cancelled') {
      const tr = S.transports[tk.transportId];
      if (tr && tr.status !== 'done' && tr.status !== 'toDrop' && tr.status !== 'loaded') { tr.status = 'open'; tr.assignee = null; tr.taskId = null; }
    }
    delete S.tasks[tk.id];
    if (tk.type === 'toolChange' && tk.machineId && status === 'done') planTools(S.machines[tk.machineId]);
  }
  /** Pause/Schichtende: noch nicht begonnene Aufgabe zurückgeben (laufende Arbeit wird beendet) */
  function canRelease(tk) {
    const s = tk.steps[tk.si];
    if (!s) return false;
    if (!tk.workStarted) return true;
    return s.k === 'wait' && (tk.type === 'toolChange' || tk.type === 'load');
  }
  function releaseTask(p) {
    const tk = p.task; if (!tk) return;
    if (tk.type === 'toolChange' && tk.data.fetched) {
      const m = S.machines[tk.machineId];
      tk.steps = [W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Werkzeugwechsel)`), K(240, 'tc', `Wechselt Werkzeug an ${m.id}`)];
      tk.data.note = 'Vermessenes Werkzeug liegt an der Maschine bereit';
    }
    tk.si = 0; tk.status = 'open'; tk.assignee = null; tk.ready = false; tk.workStarted = false;
    if (tk.transportId && S.transports[tk.transportId]) { const tr = S.transports[tk.transportId]; tr.status = 'open'; tr.assignee = null; }
    p.task = null; p.state = 'idle'; p.workRem = 0; p.idleSince = S.t; p.activity = 'Bereit';
    if (p.vehicle) parkForklift(p);
    if (S.forklift.reservedBy === p.id) S.forklift.reservedBy = null;
  }
  function mountForklift(p) { const f = S.forklift; p.vehicle = 'Stapler'; f.driver = p.id; f.state = 'driving'; p.pos.x = f.pos.x; p.pos.z = f.pos.z; p.node = f.node; p.heading = f.heading; }
  function parkForklift(p) { const f = S.forklift; f.pos = { x: p.pos.x, z: p.pos.z }; f.node = p.node; f.heading = p.heading; f.driver = null; f.state = 'parked'; p.vehicle = null; }
  function syncForklift(p) { const f = S.forklift; f.pos.x = p.pos.x; f.pos.z = p.pos.z; f.heading = p.heading; f.node = p.node; }

  function actStart(p, tk, s) {
    const m = tk.machineId ? S.machines[tk.machineId] : null;
    switch (s.act) {
      case 'setup': if (m) onSetupStart(m, p); break;
      case 'corr': if (m) m.corrRun = { t0: S.t, by: p.id, cause: `${sn(p.name)} korrigiert Programm/Werkzeugkorrektur nach Erstteil n.i.O. (10 min)` }; break;
      case 'fetch': {
        if (!m || !m.op) break;
        const c = curOf(m), tc = toolCheck(m, c.o, c.i);
        let extra = 0;
        for (const x of tc.change) { const st = S.toolStock[x.spec.type]; if (st && st.ready <= 0) extra = Math.max(extra, (TT[x.spec.type].presetMin || 3) * 60); }
        if (extra) { s.sec += extra; s.label = `Stellt neues Werkzeug für ${m.id} am Voreinstellgerät ein (kein vermessenes vorrätig)`; }
        break;
      }
      case 'repair': if (m && m.fault) m.fault.repairBy = p.id; break;
      case 'fpiMeasure': if (m && m.fpi) { m.fpi.stage = 'measure'; m.fpi.by = p.id; } break;
    }
  }
  function actDone(p, tk, s) {
    const m = tk.machineId ? S.machines[tk.machineId] : null;
    switch (s.act) {
      case 'setup': if (m) onSetupDone(m); break;
      case 'corr': if (m) { m.corrRun = null; m.needCorr = false; ev('correction', 'info', { kind: 'machine', id: m.id }, `${m.id}: Korrektur durch ${sn(p.name)} abgeschlossen – neues Erstteil wird gefertigt`, null); } break;
      case 'fetch': tk.data.fetched = true; break;
      case 'load': if (m && m.part && m.part.sub === 'load') m.part.sub = 'cut'; break;
      case 'tc': if (m) onToolChanged(m); break;
      case 'repair': if (m) endFault(m, p.id); break;
      case 'fpiPick': if (m && m.fpi) { m.fpi.stage = 'carry'; m.fpi.by = p.id; resolveKey('fpi:' + m.id, 'Erstteil abgeholt'); } break;
      case 'fpiMeasure': if (m) fpiResult(m, p); break;
      case 'flPick': forkPickup(p, tk); break;
      case 'flDrop': forkDrop(p, tk); break;
      case 'barsPick': barsPick(p, tk); break;
      case 'barsLoad': barsLoad(p, tk); break;
    }
  }

  function personTick(p) {
    if (p.state === 'offShift') return;
    if (p.onDuty) p.dutySec++;
    const tk = p.task;
    if (tk && (p.breakPending || p.endShift) && canRelease(tk)) { releaseTask(p); idleTick(p); }
    else if (!tk && p.goal === 'home' && (p.breakPending || p.endShift)) { p.goal = null; idleTick(p); }
    if (p.route) {
      const arrived = moveEnt(p, p.vehicle ? FORK : WALK);
      if (p.vehicle) { syncForklift(p); p.workSec++; }
      if (!arrived) return;
      p.route = null;
      if (p.task) { p.task.si++; startStep(p); } else arriveGoal(p);
      return;
    }
    if (p.task) {
      if (p.workRem > 0) { p.workRem--; p.workSec++; if (p.workRem <= 0) onWorkDone(p); return; }
      const s = p.task.steps[p.task.si];
      if (s && s.k === 'attend') { const m = S.machines[p.task.machineId]; if (m && m.part) p.workSec++; }
      return;
    }
    if (p.state === 'break') {
      if (S.t >= (p.breakUntil || 0) || !p.breakPending) { p.state = 'idle'; p.breakPending = false; p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Bereit'; p.goal = null; }
      return;
    }
    idleTick(p);
  }
  function idleTick(p) {
    if (!p.onDuty || p.task || (p.goal && p.route)) return;
    if (p.endShift) return goExit(p);
    if (p.breakPending) return goBreak(p);
    if (!p.atHome && S.t - p.idleSince >= CFG.idleHomeSec) goHome(p);
  }
  function entryStation() { return ST.OFFICE || P.stations[0]; }
  function goExit(p) { const e = entryStation(); p.atHome = false; p.goal = 'exit'; p.state = 'walking'; p.activity = 'Feierabend – verlässt die Halle'; routeTo(p, e.dockNode, e.dock); }
  function goBreak(p) {
    const e = entryStation(); p.atHome = false; p.goal = 'break'; p.state = 'walking'; p.activity = 'Geht in die Pause';
    const k = p.idx % 6;
    routeTo(p, e.dockNode, { x: e.work.x - 1.5 + (k % 3) * 1.2, z: e.work.z - 1 + Math.floor(k / 3) * 1.6 });
  }
  function goHome(p) { p.goal = 'home'; p.state = 'walking'; p.activity = 'Geht zum Arbeitsplatz'; routeTo(p, p.homeNode, p.home); }
  function arriveGoal(p) {
    const g = p.goal; p.goal = null;
    if (g === 'exit') { p.state = 'offShift'; p.onDuty = false; p.endShift = false; p.breakPending = false; p.activity = 'Nicht im Dienst'; return; }
    if (g === 'break') { if (p.breakPending) { p.state = 'break'; p.activity = 'Pause'; return; } }
    p.state = 'idle'; p.activity = 'Bereit'; p.idleSince = S.t;
    if (g === 'home') p.atHome = true;
  }
  // ------------------------------------------------------------------ Schichten & Pausen
  function shiftTick() {
    cur = shiftInfo(S.t);
    const sid = cur ? cur.sh.id : null, inBreak = cur ? cur.inBreak : false;
    if (sid !== S.shiftId) { const old = S.shiftId; S.shiftId = sid; onShiftChange(old, sid); }
    if (inBreak !== S.inBreak) {
      S.inBreak = inBreak;
      for (const id in S.people) {
        const p = S.people[id];
        if (!p.onDuty || p.endShift || p.shift !== sid) continue;
        if (inBreak) { p.breakPending = true; p.breakUntil = cur.breakEnd; }
        else { p.breakPending = false; if (p.state === 'break') { p.state = 'idle'; p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Bereit'; } }
      }
      if (inBreak) ev('break', 'info', { kind: 'plant', id: 'werk' }, `Pause ${cur.sh.name} bis ${U.fmtClock(cur.breakEnd)} – laufende Arbeiten werden noch beendet`, null);
    }
  }
  function onShiftChange(old, nw) {
    const e = entryStation();
    for (const id in S.people) {
      const p = S.people[id];
      if (old && p.shift === old && p.onDuty) { p.endShift = true; p.breakPending = false; }
      if (nw && p.shift === nw && !p.onDuty) {
        p.onDuty = true; p.endShift = false; p.breakPending = false; p.state = 'idle'; p.goal = null; p.route = null; p.task = null;
        p.pos = { x: e.dock.x + ((p.idx % 3) - 1) * 0.6, z: e.dock.z }; p.node = e.dockNode; p.atHome = false;
        p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Schichtbeginn';
      }
    }
    shiftReport(old, nw);
    for (const mid in S.machines) S.machines[mid].ks = newStats();
    S.shiftStats = { id: nw, startT: S.t, good: 0, scrap: 0 };
  }

  // ------------------------------------------------------------------ Logistik: Transporte, AGVs, Stapler (§3.6)
  /** Zielpuffer frei? (für den aktiven Arbeitsgang der Zielmaschine immer – verhindert Verklemmungen) */
  function destHasRoom(tr) {
    const sid = tr.to.station, m = S.machines[sid];
    if (!m || !tr.containerId) return true;
    const c = S.containers[tr.containerId];
    if (!c) return true;
    if (m.op && m.op.oid === c.orderId && m.op.idx === c.idx) return true;
    let n = countIn(sid);
    for (const id in S.transports) { const t = S.transports[id]; if (t !== tr && t.containerId && t.to.station === sid && t.status !== 'open' && t.status !== 'done') n++; }
    return n < Math.max(1, m.inCap);
  }
  function transportsTick() {
    for (const id in S.transports) {
      const tr = S.transports[id];
      if (tr.status !== 'open') continue;
      if (tr.containerId && !S.containers[tr.containerId]) { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; continue; }
      if (!destHasRoom(tr)) { tr.waitReason = `Zielpuffer ${stShort(tr.to.station)} voll`; continue; }
      if (tr.mode === 'AGV') {
        const a = bestAgv(tr);
        if (a) assignAgv(a, tr); else tr.waitReason = 'kein AGV frei (unterwegs/Laden)';
      } else if (!tr.taskId) {
        let tk;
        if (tr.kind === 'bars') {
          const mt = S.materials[tr.materialId];
          tk = newTask('bars', tr.to.station, null, [FORKW(), DRV('RAW', 'out'), K(CFG.barsPickSec, 'barsPick', `Entnimmt Stangen ${mt.name} im Kragarmregal`),
            DRV(tr.to.station, 'in'), K(CFG.barsLoadSec, 'barsLoad', `Lädt Stangen in den Stangenlader ${tr.to.station}`)], { transportId: tr.id });
          tk.label = `Stangen nachladen ${tr.to.station} (${mt.name})`;
        } else {
          tk = newTask('forklift', tr.from.station, null, [FORKW(), DRV(tr.from.station, 'out'), K(CFG.agvHandleSec, 'flPick', `Nimmt Behälter mit dem Stapler auf (${tr.label})`),
            DRV(tr.to.station, 'in'), K(CFG.agvHandleSec, 'flDrop', `Stellt Behälter an ${stShort(tr.to.station)} ab`)], { transportId: tr.id });
          tk.label = `Staplertransport ${tr.label} (${nm(tr.weightKg)} kg)`;
        }
        tr.taskId = tk.id; tr.waitReason = 'wartet auf Logistiker:in (Stapler)';
      }
    }
  }
  function bestAgv(tr) {
    let best = null, bd = Infinity;
    const st = ST[tr.from.station];
    for (const id in S.agvs) {
      const a = S.agvs[id];
      if (a.task || a.mustCharge || a.battery < CFG.batteryAssign || tr.weightKg > a.maxKg) continue;
      if (a.state !== 'idle' && a.state !== 'charging' && a.state !== 'toCharge') continue;
      const d = U.path(GRAPH, a.node, st.dockNode).length + (100 - a.battery) * 0.5 - Math.min(30, (S.t - (a.freeSince || 0)) / 60);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function assignAgv(a, tr) {
    a.task = tr.id; tr.assignee = a.id; tr.status = 'toPickup'; tr.waitReason = null;
    a.state = 'toPickup';
    routeTo(a, ST[tr.from.station].dockNode, stPos(tr.from.station, 'out'));
  }
  function chargerPos(a) { const c = ST.CHG; return a.slot % 2 ? c.outPos : c.inPos; }
  function atCharger(a) { const p = chargerPos(a); return Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 0.3; }
  function goCharge(a) { a.state = 'toCharge'; routeTo(a, ST.CHG.dockNode, chargerPos(a)); }
  function agvTick(a) {
    if (a.route) {
      const arrived = moveEnt(a, a.speed);
      a.battery = Math.max(0, r6(a.battery - CFG.agvDrain)); a.distToday += a.speed;
      if (!arrived) return;
      a.route = null;
      if (a.state === 'toPickup') { a.state = 'loading'; a.waitRem = CFG.agvHandleSec; }
      else if (a.state === 'toDrop') { a.state = 'unloading'; a.waitRem = CFG.agvHandleSec; }
      else if (a.state === 'toCharge') a.state = a.battery < 99.5 ? 'charging' : 'idle';
      return;
    }
    if (a.waitRem > 0) { a.waitRem--; if (a.waitRem <= 0) agvHandleDone(a); return; }
    if (a.state === 'charging') {
      a.battery = Math.min(100, r6(a.battery + CFG.agvCharge));
      if (a.mustCharge && a.battery >= CFG.batteryFull) { a.mustCharge = false; resolveKey('agvbat:' + a.id, `geladen (${Math.round(a.battery)} %)`); }
      if (a.battery >= 100) a.state = 'idle';
      return;
    }
    if (a.state === 'idle' && !a.task) { if (!atCharger(a)) goCharge(a); else if (a.battery < 99.5) a.state = 'charging'; }
  }
  function agvHandleDone(a) {
    const tr = S.transports[a.task];
    if (!tr) { a.task = null; a.state = 'idle'; return; }
    if (a.state === 'loading') {
      const c = S.containers[tr.containerId];
      if (!c || !c.location || c.location.kind !== 'station') { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; a.task = null; a.state = 'idle'; return; }
      pickupContainer(c, { kind: 'agv', id: a.id });
      a.load = c.id; tr.status = 'toDrop'; tr.pickupT = S.t; a.state = 'toDrop';
      routeTo(a, ST[tr.to.station].dockNode, stPos(tr.to.station, 'in'));
      return;
    }
    if (a.state === 'unloading') {
      const c = S.containers[a.load];
      if (c) dropContainer(c, tr.to.station);
      a.load = null; tr.status = 'done'; tr.doneT = S.t; a.task = null; a.freeSince = S.t; a.transportsToday++; S.today.transports++;
      if (a.battery < CFG.batteryLow) {
        a.mustCharge = true;
        notify({ key: 'agvbat:' + a.id, sev: 'info', role: 'Logistik', entity: { kind: 'agv', id: a.id }, title: `${a.name}: Akku niedrig (${Math.round(a.battery)} %)`,
          body: `${a.name} fährt zur Ladestation und steht ca. ${U.fmtDur((CFG.batteryFull - a.battery) / CFG.agvCharge)} nicht für Transporte zur Verfügung.`,
          suggestion: 'Transporte übernimmt in der Zwischenzeit das andere AGV; schwere Behälter weiterhin per Stapler.' });
        goCharge(a);
      } else a.state = 'idle';
    }
  }
  function forkPickup(p, tk) {
    const tr = S.transports[tk.transportId]; const c = tr && S.containers[tr.containerId];
    if (!tr || !c || !c.location || c.location.kind !== 'station') { if (tr) { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; } finishTask(tk, 'done'); return; }
    pickupContainer(c, { kind: 'forklift', id: S.forklift.id, personId: p.id });
    S.forklift.load = c.id; tr.status = 'loaded'; tr.pickupT = S.t;
  }
  function forkDrop(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) return;
    const c = S.containers[tr.containerId];
    if (c) dropContainer(c, tr.to.station);
    S.forklift.load = null; tr.status = 'done'; tr.doneT = S.t; S.today.transports++;
  }
  function barsPick(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) { finishTask(tk, 'done'); return; }
    const m = S.machines[tr.to.station], mt = S.materials[tr.materialId];
    const want = m.barMagazineM - (m.barMat === mt.id ? m.barStockM : 0);
    let meters = Math.floor(want / CFG.barLenM + 1e-9) * CFG.barLenM;
    if (meters < CFG.barLenM) meters = want;
    meters = r6(Math.min(meters, mt.onHand));
    const c = curOf(m), per = c && c.r.material ? c.r.material.perPart : 0.01;
    if (meters + 1e-9 < per) {
      tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true;
      ev('barsFail', 'warn', { kind: 'material', id: mt.id }, `Keine Stangen ${mt.name} mehr im Lager – Stangenlader ${m.id} kann nicht befüllt werden`, null);
      if (c) notifyMissing(m, mt, c.r);
      finishTask(tk, 'done');
      return;
    }
    materialIssue(mt, meters);
    tr.meters = meters; tr.status = 'loaded'; tr.pickupT = S.t; S.forklift.load = 'Stangen';
  }
  function barsLoad(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) return;
    const m = S.machines[tr.to.station], mt = S.materials[tr.materialId];
    if (m.barMat === mt.id) m.barStockM = r6(m.barStockM + tr.meters);
    else { mt.onHand = r6(mt.onHand + tr.meters); checkStock(mt); }
    S.forklift.load = null; tr.status = 'done'; tr.doneT = S.t; S.today.transports++;
    ev('bars', 'ok', { kind: 'machine', id: m.id }, `${sn(p.name)} hat ${nm(tr.meters, 1)} m ${mt.name} in den Stangenlader ${m.id} geladen (Magazin jetzt ${nm(m.barStockM, 1)} m)`, { meters: tr.meters });
  }

  // ------------------------------------------------------------------ Kennzahlen, Energie, Historie
  function machinePower(m) {
    const p = m.power;
    switch (m.state) {
      case 'running': return m.part && m.part.sub === 'cut' ? p.run : p.idle + (p.run - p.idle) * 0.25;
      case 'fault': return p.idle * 0.8;
      case 'setup': case 'toolchange': return p.idle * 1.1;
      default: return p.idle;
    }
  }
  function statsTick() {
    const work = !!(cur && !cur.inBreak); // Schichtzeit ohne Pausen = OEE-Bezugszeit
    let kw = CFG.basePowerKw;
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j], st = m.state, kd = m.kd, ks = m.ks;
      kd.stateSec[st]++; ks.stateSec[st]++;
      if (st === 'running' || (work && st !== 'idle')) { kd.planned++; ks.planned++; }
      if (st === 'running') { kd.run++; ks.run++; }
      else if (work && st !== 'idle') { const e = m.rate / 3600; kd.lossSec++; kd.lossEur += e; ks.lossSec++; ks.lossEur += e; }
      const pw = machinePower(m);
      kd.energyKwh += pw / 3600; kw += pw;
    }
    for (let j = 0; j < AA.length; j++) { const a = AA[j]; kw += a.route ? 0.6 : a.state === 'charging' ? 1.5 : a.waitRem > 0 ? 0.3 : 0.05; }
    S.powerKw = kw; S.energyKwh += kw / 3600; S.today.energyKwh += kw / 3600;
    S.histAcc.powerSum += kw; S.histAcc.n++;
  }
  /* OEE-Definitionen (je Maschine; „heute“ = seit 00:00; Bezugszeit = Schichtzeit ohne Pausen):
       Planbelegungszeit = Sekunden mit eingeplantem Arbeitsgang (Zustand ≠ 'Bereit') in der Schichtzeit
                           + jede Sekunde 'Produktion' (auch Geisterschicht/Pause – zählt in Zähler und Nenner)
       Verfügbarkeit     = Laufzeit ('running') / Planbelegungszeit
       Leistung          = Σ Plan-Taktzeit (cycleMin) der bearbeiteten Teile / Laufzeit
                           (Einlegen, Abrichten und Zyklusstreuung senken die Leistung), max. 1
       Qualität          = Gutteile / (Gutteile + Ausschuss)
       OEE               = Verfügbarkeit × Leistung × Qualität
     Werk-OEE: Summen über alle Bearbeitungsmaschinen (kind 'machine', ohne Messraum und Montage).
     Verlust (lossEur)   = Maschinenstundensatz × Zeit in Schichtzeit, in der ein Auftrag eingeplant ist,
                           die Maschine aber nicht produziert (Rüsten, Warten, Störung …). */
  function oeeOf(st) {
    const a = st.planned > 0 ? Math.min(1, st.run / st.planned) : 0;
    const p = st.run > 0 ? Math.min(1, st.ideal / st.run) : 0;
    const q = st.good + st.scrap > 0 ? st.good / (st.good + st.scrap) : 1;
    return { oee: a * p * q, availability: a, performance: p, quality: q };
  }
  function computeWip() {
    let w = 0;
    for (const id in S.containers) { const c = S.containers[id]; if (c.state !== 'shipped' && c.state !== 'scrap') w += c.qty; }
    for (const id in S.machines) { const m = S.machines[id]; if (m.part) w++; if (m.fpi) w++; }
    return w;
  }
  function kpis() {
    const agg = { planned: 0, run: 0, ideal: 0, good: 0, scrap: 0 };
    let lossEur = 0;
    for (const id in S.machines) {
      const m = S.machines[id]; lossEur += m.kd.lossEur;
      if (m.kind !== 'machine') continue;
      for (const k in agg) agg[k] += m.kd[k];
    }
    const o = oeeOf(agg);
    const good = S.today.good, scrap = S.today.scrap;
    const fc = forecast();
    let n = 0, ok = 0;
    for (const id in S.orders) {
      const od = S.orders[id]; n++;
      const eta = od.status === 'fertig' ? od.doneT : (fc.orders[id] ? fc.orders[id].eta : Infinity);
      if (eta <= od.due) ok++;
    }
    return {
      t: S.t, oee: o.oee, availability: o.availability, performance: o.performance, quality: o.quality,
      good, scrap, fpy: good + scrap > 0 ? good / (good + scrap) : 1, onTimePct: n ? ok / n : 1,
      lossEur: Math.round(lossEur), energyKwh: Math.round(S.today.energyKwh * 10) / 10, powerKw: Math.round(S.powerKw * 10) / 10,
      wip: computeWip(), transportsToday: S.today.transports, toolCostToday: Math.round(S.toolCostToday),
      shippedToday: S.today.shipped, scrapBy: Object.assign({}, S.today.scrapBy), faultsToday: S.today.faults,
      toolChangesToday: S.today.toolChanges, setupsToday: S.today.setups, fpiOk: S.today.fpiOk, fpiNok: S.today.fpiNok,
    };
  }
  function historyTick() {
    const stepSec = P.sim.historyStepSec || 300;
    if (S.t % stepSec !== 0) return;
    const h = S.history, k = kpis();
    S.kpi = k;
    h.t.push(S.t); h.good.push(S.histAcc.good); h.oee.push(Math.round(k.oee * 1000) / 1000);
    h.powerKw.push(Math.round((S.histAcc.n ? S.histAcc.powerSum / S.histAcc.n : S.powerKw) * 10) / 10); h.wip.push(k.wip);
    for (const id in S.machines) h.perMachine[id].push(S.machines[id].state);
    S.histAcc = { good: 0, powerSum: 0, n: 0 };
    const max = Math.ceil(2 * DAY / stepSec);
    if (h.t.length > max) {
      const cut = h.t.length - max;
      for (const key of ['t', 'good', 'oee', 'powerKw', 'wip']) h[key].splice(0, cut);
      for (const id in h.perMachine) h.perMachine[id].splice(0, cut);
    }
  }
  function dayRollover() {
    S.yesterday = Object.assign({ kpi: kpis() }, S.today);
    for (const id in S.machines) S.machines[id].kd = newStats();
    S.today = { day: Math.floor(S.t / DAY), good: 0, scrap: 0, scrapBy: { 'Maß': 0, 'Werkzeugbruch': 0, 'Erstteil n.i.O.': 0 }, fpiOk: 0, fpiNok: 0,
      transports: 0, shipped: 0, toolChanges: 0, faults: 0, setups: 0, energyKwh: 0, lossEur: 0 };
    for (const id in S.toolStock) S.toolStock[id].scrapToday = 0;
    S.toolCostToday = 0;
    for (const id in S.people) { const p = S.people[id]; p.workSec = 0; p.dutySec = 0; p.utilToday = 0; p.tasksToday = 0; }
    for (const id in S.agvs) { S.agvs[id].distToday = 0; S.agvs[id].transportsToday = 0; }
    for (const id in S.materials) S.materials[id].usedToday = 0;
  }
  function progName(o, r) {
    const n = 4000 + (parseInt(U.hash(o.part.no || o.id), 16) % 5000);
    return 'O' + n + '_' + o.id.replace('-', '') + '_OP' + r.seq;
  }
  /** Maschinensignale (nur Anschluss-Level ≥ 2), konsistent zum Zustand: 0 U/min, wenn nicht geschnitten wird */
  function signalsTick() {
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j];
      if ((m.conn.level || 0) < 2) { m.signals = null; continue; }
      const c = curOf(m);
      const cutting = m.state === 'running' && !!m.part && m.part.sub === 'cut';
      const dressing = m.state === 'running' && !m.part && m.dressRem > 0;
      const tl = c ? mainToolOf(m, c.r) : null, wear = tl ? tl.used / tl.life : 0;
      const nz = hnoise(S.t, m.idx + 1), base = RPM[m.type] || 0;
      m.signals = {
        t: S.t, mode: m.state === 'fault' ? 'ALARM' : cutting || dressing ? 'AUTO' : m.state === 'setup' || m.state === 'toolchange' ? 'JOG/MDI' : 'STOP',
        spindleRpm: cutting ? Math.round(base * (1 + 0.015 * nz)) : dressing ? Math.round(base * 0.6) : 0,
        spindleLoadPct: cutting ? Math.max(5, Math.round(36 + 32 * wear + 5 * nz)) : dressing ? 12 : 0,
        feedOverridePct: c ? (wear > 0.9 ? 90 : 100) : 100,
        program: c ? (m.type === 'cmm' ? 'CALYPSO_' + o4(c.o) + '_AG' + c.r.seq : progName(c.o, c.r)) : '–',
        partCounter: c ? c.op.good + c.op.scrap : 0, totalCounter: m.counter,
        toolInSpindle: m.conn.level >= 3 && tl ? tl.typeId : null,
        alarm: m.fault ? m.fault.code + ' ' + m.fault.text : null, coolant: cutting && m.type !== 'cmm' && m.type !== 'assembly',
      };
    }
  }
  const o4 = (o) => (o.part.no || o.id).replace(/[^A-Za-z0-9]/g, '');

  // ------------------------------------------------------------------ Regeln & Benachrichtigungen (§3.9)
  function rulesTick() {
    for (const id in S.machines) {
      const m = S.machines[id], dur = S.t - m.since;
      if (WAIT_STATES[m.state]) {
        const planned = m.state === 'waitOperator' && (m.waitCode === 'break' || m.waitCode === 'offShift' || m.waitCode === 'walking' || m.waitCode === 'assigning');
        const thr = m.state === 'waitTool' ? CFG.toolWarnSec : CFG.waitWarnSec;
        if (!planned && dur >= thr) notifyWait(m);
        else if (planned && hasOpen('wait:' + m.id)) resolveKey('wait:' + m.id, m.waitCode === 'walking' ? 'Person ist unterwegs' : 'geplante Abwesenheit (Pause/Schicht)');
      }
      if (m.fpi && m.fpi.stage === 'wait' && S.t - m.fpi.t0 >= CFG.fpiWarnSec && !hasOpen('fpi:' + m.id)) {
        const tk = S.tasks[m.tasks.fpi];
        notify({ key: 'fpi:' + m.id, sev: 'warn', role: 'QS', entity: { kind: 'machine', id: m.id }, title: `Erstteilprüfung ${m.id} wartet seit ${U.fmtDur(S.t - m.fpi.t0)}`,
          body: `Das Erstteil von ${m.id} ${m.short} liegt seit ${U.fmtClock(m.fpi.t0)} bereit; die Maschine darf bis zur Freigabe nicht weiterfertigen (Stillstand ${U.fmtEur(m.rate)} / h).`,
          suggestion: `${tk && tk.assignee ? pname(tk.assignee) + ' ist unterwegs.' : 'QS-Prüfer:in ist ' + availability(tk).text + '.'} Empfehlung: Erstteilprüfungen vor Losprüfungen ziehen; bei Engpass zweite Person im Messraum einweisen.`,
          actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
      }
    }
    // automatische Werkzeugkorrektur durch Bediener (SPC-Meldung > 15 min offen, Bediener/Einrichter im Dienst)
    for (const n of S.notifications) {
      if (n.status === 'resolved' || !n.spc || S.t - n.spc.since < 600) continue;
      const m = S.machines[n.spc.machineId];
      const p = Object.values(S.people).find(x => x.onDuty && !x.endShift && x.skills.includes(m.skill) && (x.machines.includes(m.id) || x.skills.includes('setup')));
      if (p) applyOffset(n.spc.orderId, n.spc.seq, n.spc.value, sn(p.name));
    }
    for (const n of S.notifications) if (n.status !== 'resolved' && n.autoResolveT && S.t >= n.autoResolveT) resolveKey(n.key, 'zeitlich erledigt');
    if (S.t % 300 === 0) lateCheck();
    if (S.t % 60 === 0) {
      for (const id in S.people) { const p = S.people[id]; p.utilToday = p.dutySec > 0 ? Math.min(1, p.workSec / p.dutySec) : 0; }
      for (const id in S.transports) { const t = S.transports[id]; if (t.status === 'done' && S.t - t.doneT > 6 * 3600) delete S.transports[id]; }
      const s = S.t % DAY;
      if (s === 21 * 3600 && cur) ghostCheck();
    }
  }
  function notifyWait(m) {
    const key = 'wait:' + m.id;
    if (hasOpen(key)) return;
    const label = WF.STATE[m.state].label;
    let role = 'Schichtleitung', sugg = '';
    if (m.state === 'starved') {
      role = m.cause.indexOf('Rohmaterial') >= 0 || m.cause.indexOf('Lager') >= 0 ? 'Einkauf' : 'Logistik';
      sugg = m.cause.indexOf('Fremdbearbeitung') >= 0 ? 'Rückkehr bei der Härterei bestätigen lassen; bis dahin anderen Arbeitsgang auf der Maschine vorziehen.'
        : m.cause.indexOf('Stangen') >= 0 ? 'Logistik: Stangen per Stapler nachladen (Aufgabe liegt vor).'
        : role === 'Einkauf' ? 'Material nachbestellen bzw. Liefertermin klären.'
        : 'Vorgänger-Arbeitsgang prüfen (Störung, Rüsten, Personal) oder anderen Auftrag mit Material vorziehen.';
    } else if (m.state === 'waitOperator') {
      sugg = 'Personal umdisponieren (Bediener einer ruhigen Maschine oder Einrichter:in), Pausen versetzen oder Mehrmaschinenbedienung neu verteilen.';
    } else if (m.state === 'waitTool') {
      role = 'Einrichter';
      sugg = 'Vermessenes Werkzeug aus der Werkzeugausgabe holen und wechseln. Für die Zukunft: Wechsel bereits bei der Planungsmeldung (≤ ' + PLAN_AT + ' Teile) vorbereiten.';
    } else if (m.state === 'blocked') {
      role = 'Logistik';
      sugg = 'Abholung priorisieren (AGV/Stapler) bzw. Zielpuffer des Nachfolgers prüfen.';
    }
    notify({ key, sev: 'warn', role, entity: { kind: 'machine', id: m.id }, title: `${m.id} ${m.short}: ${label} seit ${U.fmtClock(m.since)}`,
      body: `${m.cause}. Stillstandskosten ca. ${U.fmtEur(m.rate)} / h.`, suggestion: `Ursache: ${m.cause}. Empfehlung: ${sugg}`,
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
  }
  function lateCheck() {
    const fc = forecast();
    for (const id in S.orders) {
      const o = S.orders[id], key = 'late:' + id, f = fc.orders[id];
      if (o.status === 'fertig' || !f) { if (hasOpen(key)) resolveKey(key, 'Auftrag fertig'); continue; }
      if (f.eta > o.due + 900 || (hasOpen(key) && f.eta > o.due - 900)) {
        const bn = f.bottleneck ? ` Engpass: ${f.bottleneck}.` : '';
        notify({ key, sev: 'warn', role: 'Schichtleitung', entity: { kind: 'order', id },
          title: `Termin gefährdet: ${id} (${o.customer})`,
          body: `Prognose fertig ${U.fmtDayClock(f.eta)}, Termin ${U.fmtDayClock(o.due)} – ca. ${U.fmtDur(f.eta - o.due)} Verzug.${bn}`,
          suggestion: o.priority === 'eil' ? 'Auftrag ist bereits Eilauftrag: Kunde informieren, Teillieferung oder Zusatzschicht prüfen.' : 'Als Eilauftrag kennzeichnen – die Maschinen ziehen ihn beim nächsten Auftragswechsel vor. Alternativ Arbeitsgang auf eine freie Maschine verlagern.',
          actions: o.priority === 'eil' ? [{ label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id } }] : [{ label: 'Als Eilauftrag', action: { type: 'setPriority', orderId: id, priority: 'eil' } }, { label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id } }] });
      } else if (hasOpen(key)) resolveKey(key, 'Prognose wieder im Termin');
    }
  }
  /** 21:00 – reicht die Werkzeug-Standzeit für die Geisterschicht der autonomen Maschinen? */
  function ghostCheck() {
    const until = nextWorkStart(cur.end + 1);
    for (const id in S.machines) {
      const m = S.machines[id];
      if (m.loading !== 'auto' || !m.op || !m.setupDone || !m.released) continue;
      const c = curOf(m), cyc = cycleSec(m, c.r), pl = partsLeft(c.o, c.i);
      let minRem = Infinity, tool = null;
      for (const spec of c.r.tools || []) { const tl = mountedOf(m, spec.type); const rem = tl ? remParts(tl, spec.cutMinPerPart) : 0; if (rem < minRem) { minRem = rem; tool = spec.type; } }
      if (!isFinite(minRem) || minRem >= pl) continue;
      const stopT = S.t + minRem * cyc;
      if (stopT >= until) continue;
      notify({ key: 'ghost:' + m.id, sev: 'warn', role: 'Einrichter', entity: { kind: 'machine', id: m.id }, autoResolveT: until,
        title: `Geisterschicht: ${m.id} stoppt ca. ${U.fmtClock(stopT)}`,
        body: `Reststandzeit ${TT[tool].name}: ${minRem} Teile (≈ ${U.fmtDur(minRem * cyc)}). Danach steht ${m.id} bis Schichtbeginn ${U.fmtClock(until)} (ca. ${U.fmtDur(until - stopT)}).`,
        suggestion: `Vor Schichtende vorbeugend wechseln (Einrichter:in) – dann läuft ${m.id} ca. ${U.fmtDur(Math.min(pl, Math.floor(TT[tool].lifeMin / Math.max(0.01, cutFor(c.r, tool)))) * cyc)} unbemannt weiter.`,
        actions: [{ label: 'Wechsel jetzt beauftragen', action: { type: 'planToolChange', machineId: m.id } }] });
    }
  }
  function shiftReport(old, nw) {
    const shName = (id) => (SH.find(s => s.id === id) || {}).name || 'keine Schicht';
    const st = S.shiftStats;
    const agg = { planned: 0, run: 0, ideal: 0, good: 0, scrap: 0 };
    for (const id in S.machines) { const m = S.machines[id]; if (m.kind === 'machine') for (const k in agg) agg[k] += m.ks[k]; }
    const o = oeeOf(agg);
    const faults = Object.values(S.machines).filter(m => m.fault).map(m => m.id);
    const waiting = Object.values(S.machines).filter(m => WAIT_STATES[m.state]).map(m => m.id + ' ' + WF.STATE[m.state].label);
    const title = nw ? `Schichtwechsel: ${old ? shName(old) + ' → ' : ''}${shName(nw)}` : `Schichtende ${shName(old)} – Geisterschicht`;
    const ghosts = Object.values(S.machines).filter(m => m.loading === 'auto' && m.op && m.released && !m.fault).map(m => m.id);
    S.lastShiftReport = { t: S.t, from: old, to: nw, good: st.good, scrap: st.scrap, oee: o.oee, faults, waiting };
    ev('shift', 'info', { kind: 'plant', id: 'werk' }, `${title} – ${st.good} Gutteile, ${st.scrap} Ausschuss, OEE ${U.fmtPct(o.oee)}`, S.lastShiftReport);
    if (!old) return;
    notify({ key: 'shift:' + S.t, sev: 'info', role: 'Schichtleitung', entity: { kind: 'plant', id: 'werk' }, autoResolveT: S.t + 1800, title,
      body: `${shName(old)}: ${st.good} Gutteile, ${st.scrap} Ausschuss, OEE ${U.fmtPct(o.oee)}. ${faults.length ? 'Offene Störungen: ' + faults.join(', ') + '. ' : ''}${waiting.length ? 'Wartend: ' + waiting.slice(0, 4).join(', ') + '.' : ''}`,
      suggestion: nw ? 'Übergabe: offene Störungen, geplante Werkzeugwechsel und wartende Erstteile zuerst besprechen.' : `Unbemannt weiter laufen: ${ghosts.join(', ') || 'keine Maschine'}. Werkzeug- und Materialreichweite für die Nacht prüfen.` });
  }

  // ------------------------------------------------------------------ Prognose (Plantafel)
  const TYPE_GROUP = { lathe: 'turn', swiss: 'turn', biglathe: 'turn', mill5: 'mill', mill3: 'mill' };
  function workFor(m, o, i, active) {
    const r = o.routing[i], op = o.ops[i];
    const n = partsLeft(o, i);
    let setup = 0, fpi = 0;
    if (!active || !m.setupDone) setup = active && m.setupRun ? Math.max(0, m.setupRun.dur - (S.t - m.setupRun.t0)) : (r.setupMin || 0) * 60;
    if (r.firstPiece && !(active && m.released)) fpi = (m.fpiMin || 15) * 60 + 900;
    let toolAllow = 0;
    for (const t of r.tools || []) { const tt = TT[t.type]; if (tt) toolAllow += (t.cutMinPerPart / tt.lifeMin) * 300; }
    let run = n * (cycleSec(m, r) + toolAllow);
    if (active && m.part) run += m.part.rem;
    if (active && m.fault) run += Math.max(0, m.fault.repairSec - (S.t - m.fault.t0));
    if (active && m.fpi) fpi = (m.fpiMin || 15) * 60;
    return { setup, fpi, run: run * 1.03, n: n + op.inProc };
  }
  function calEnd(m, start, w) {
    const tSetup = addWork(start, w.setup + w.fpi);
    if (m.loading === 'auto') return Math.max(tSetup + w.run * 1.1, addWork(tSetup, w.run * 0.75));
    return addWork(tSetup, w.run);
  }
  /** Prognose als einfache Listenplanung: aktive Arbeitsgänge belegen ihre Maschine ab jetzt; danach wird immer der
      Arbeitsgang eingeplant, der am frühesten beginnen kann (Maschine frei + erster Behälter des Vorgängers da).
      Bei Gleichstand: Eil → Termin → Auftragsnummer. Personalgebundene Arbeit nur in der Schichtzeit (addWork). */
  function planOp(x, free, activeEnd) {
    const o = x.o, i = x.i, r = o.routing[i];
    if (r.station === 'VERSAND') { const end = Math.max(S.t, x.prevEnd) + 600; return { start: end, end, m: null, batchT: 0 }; }
    if (r.station === 'EXT') {
      const lead = ((r.ext && r.ext.leadMin) || 480) * 60;
      let firstRet = null, lastRet = 0;
      for (const cid in S.containers) {
        const c = S.containers[cid];
        if (c.orderId !== o.id || c.idx !== i || c.state !== 'external') continue;
        lastRet = Math.max(lastRet, c.location.returnT); firstRet = firstRet == null ? c.location.returnT : Math.min(firstRet, c.location.returnT);
      }
      const remaining = partsLeft(o, i) > 0 || waitingQty(o.id, i) > 0;
      const sendFirst = Math.max(S.t, x.prevStart + x.prevBatch) + CFG.extHandoverSec;
      if (firstRet == null) firstRet = nextDayWindow(sendFirst + lead);
      const end = remaining ? Math.max(lastRet, nextDayWindow(Math.max(S.t, x.prevEnd) + CFG.extHandoverSec + 1800 + lead)) : Math.max(lastRet, S.t);
      return { start: Math.min(firstRet, end), end, m: null, batchT: 0 };
    }
    const m = S.machines[r.station];
    if (!m) return { start: x.prevEnd, end: x.prevEnd, m: null, batchT: 0 };
    const active = !!(m.op && m.op.oid === o.id && m.op.idx === i);
    const w = workFor(m, o, i, active);
    const batchT = Math.min(opBatch(r), Math.max(1, w.n)) * cycleSec(m, r);
    if (active) return { start: S.t, end: Math.max(activeEnd[o.id + '/' + i], x.prevEnd + batchT + 600), m, w, batchT, active };
    const avail = i === 0 || waitingQty(o.id, i) > 0 ? S.t : x.prevStart + x.prevBatch + 600;
    const start = Math.max(free[m.id], avail);
    return { start, end: Math.max(calEnd(m, start, w), x.prevEnd + batchT + 600), m, w, batchT, active };
  }
  function forecast() {
    if (FC && S.t - FC.t < 60) return FC.data;
    const res = { machines: {}, orders: {} };
    const free = {}, activeEnd = {};
    for (const id in S.machines) { res.machines[id] = []; free[id] = S.t; }
    for (const id in S.machines) {
      const m = S.machines[id]; if (!m.op) continue;
      const o = S.orders[m.op.oid];
      const end = calEnd(m, S.t, workFor(m, o, m.op.idx, true));
      activeEnd[o.id + '/' + m.op.idx] = end; free[id] = end;
    }
    const st = [];
    for (const id in S.orders) {
      const o = S.orders[id]; if (o.status === 'fertig') continue;
      let i = 0; while (i < o.ops.length && o.ops[i].complete) i++;
      st.push({ o, i, prevStart: S.t, prevEnd: S.t, prevBatch: 0, bottleneck: null, worst: -1, key: [o.priority === 'eil' ? 0 : 1, o.due, o.id] });
    }
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, bp = null;
      for (const x of st) {
        if (x.i >= x.o.ops.length) continue;
        const p = planOp(x, free, activeEnd);
        if (!best || p.start < bp.start - 1 || (Math.abs(p.start - bp.start) <= 1 && cmpKey(x.key, best.key) < 0)) { best = x; bp = p; }
      }
      if (!best) break;
      const r = best.o.routing[best.i];
      if (bp.m) {
        free[bp.m.id] = Math.max(free[bp.m.id], bp.end);
        res.machines[bp.m.id].push({ orderId: best.o.id, seq: r.seq, op: r.op, start: Math.round(bp.start), end: Math.round(bp.end),
          setupEnd: Math.round(addWork(bp.start, bp.w.setup)), active: bp.active, kind: 'run' });
        if (bp.end - bp.start > best.worst) { best.worst = bp.end - bp.start; best.bottleneck = `${bp.m.id} ${bp.m.short} (AG ${r.seq}, ${U.fmtDur(bp.end - bp.start)})`; }
      }
      best.prevStart = bp.start; best.prevEnd = bp.end; best.prevBatch = bp.batchT; best.i++;
      if (best.i >= best.o.ops.length) res.orders[best.o.id] = { eta: Math.round(bp.end), late: bp.end > best.o.due, slackSec: Math.round(best.o.due - bp.end), bottleneck: best.bottleneck };
    }
    for (const id in S.orders) { const o = S.orders[id]; if (o.status === 'fertig') res.orders[id] = { eta: o.doneT, late: o.doneT > o.due, slackSec: o.due - o.doneT, done: true }; }
    for (const id in res.machines) res.machines[id].sort((a, b) => a.start - b.start);
    FC = { t: S.t, data: res };
    return res;
  }

  // ------------------------------------------------------------------ Abgeleitete Sichten
  function clock() { return U.fmtDayClock(S.t); }
  function shift() {
    const i = shiftInfo(S.t);
    if (i) return { id: i.sh.id, name: i.sh.name, inBreak: i.inBreak, endsAt: i.end, breakEndsAt: i.breakEnd };
    return { id: null, name: 'Keine Schicht (Geisterschicht)', inBreak: false, endsAt: nextWorkStart(S.t) };
  }
  function whereText(c) {
    const l = c.location;
    if (c.state === 'shipped') return 'Versand';
    if (c.state === 'scrap') return 'Sperrlager';
    if (!l) return '–';
    if (l.kind === 'station') return `${stShort(l.id)} · ${l.slot === 'out' ? 'Ausgang' : 'Eingang'}`;
    if (l.kind === 'agv') return 'auf ' + (S.agvs[l.id] ? S.agvs[l.id].name : l.id);
    if (l.kind === 'forklift') return 'auf Stapler (' + pname(l.personId) + ')';
    if (l.kind === 'external') return `bei ${l.partner} bis ca. ${U.fmtDayClock(l.returnT)}`;
    return '–';
  }
  function contView(c) {
    return { id: c.id, orderId: c.orderId, seq: c.seq, srcSeq: c.srcSeq, qty: c.qty, weightKg: c.weightKg, state: c.state, kind: c.kind, where: whereText(c), location: c.location, transportId: c.transportId };
  }
  function machineView(id) {
    const m = S.machines[id]; if (!m) return null;
    const st = ST[id], meta = WF.STATE[m.state] || {};
    const c = curOf(m);
    const fc = forecast();
    let order = null, partNo = null, partsDone = 0, partsTotal = 0, partProgress = 0, etaOpEnd = null, phase = 'Bereit';
    const tools = [];
    if (c) {
      const { o, i, r, op } = c;
      partsDone = op.good + op.scrap; partsTotal = i === 0 ? o.qty : opTargetIn(o, i);
      partNo = m.part ? m.part.no : null;
      partProgress = m.part ? (m.part.sub === 'load' ? 0 : Math.max(0, Math.min(1, 1 - m.part.rem / m.part.dur))) : 0;
      phase = !m.setupDone ? (m.setupRun ? 'Rüsten' : 'Rüsten ausstehend') : m.needCorr || m.corrRun ? 'Korrektur' : m.fpi ? 'Erstteilprüfung' : !m.released ? 'Erstteil' : 'Serie';
      order = { id: o.id, customer: o.customer, partName: o.part.name, partNo: o.part.no, qty: o.qty, due: o.due, priority: o.priority, seq: r.seq, op: r.op,
        cycleMin: r.cycleMin, setupMin: r.setupMin, transferBatch: r.transferBatch, firstPiece: !!r.firstPiece, released: m.released };
      const fe = (fc.machines[id] || []).find(x => x.active);
      etaOpEnd = fe ? fe.end : null;
      const tc = toolCheck(m, o, i);
      const tk = S.tasks[m.tasks.tc];
      for (const spec of r.tools || []) {
        const tl = mountedOf(m, spec.type);
        if (!tl) { tools.push({ id: null, typeId: spec.type, name: TT[spec.type] ? TT[spec.type].name : spec.type, kind: TT[spec.type] ? TT[spec.type].kind : '', wearPct: null, remainingParts: 0, cutMinPerPart: spec.cutMinPerPart, plannedChange: null, status: 'missing', explain: 'Wird beim Rüsten bestückt.' }); continue; }
        const rem = remParts(tl, spec.cutMinPerPart);
        const inChange = tc.planned.find(x => x.tl === tl);
        let pcv = null;
        if (inChange && tk) { const pc = plannedChange(m, o, i, [inChange]); pcv = { afterPart: pc.afterPart, etaT: pc.etaT, by: tk.assignee ? pname(tk.assignee) : null, stage: tk.ready ? 'an der Maschine' : tk.assignee ? (tk.data.fetched ? 'unterwegs mit Werkzeug' : 'holt Werkzeug') : 'offen' }; }
        tools.push({ id: tl.id, typeId: tl.typeId, name: tl.name, kind: tl.kind, wearPct: Math.round(tl.used / tl.life * 1000) / 10, used: r6(tl.used), life: tl.life,
          remainingParts: rem, remainingMin: r6(tl.life - tl.used), cutMinPerPart: spec.cutMinPerPart, planAtParts: PLAN_AT, planWearPct: planWearPct(tl, spec.cutMinPerPart),
          plannedChange: pcv, status: tl.broken ? 'broken' : rem < 1 ? 'due' : pcv ? 'planned' : 'ok', explain: toolExplain(m, tl, spec, o, i), mountedT: tl.mountedT, parts: tl.parts,
          dressEvery: TT[tl.typeId].dressEvery || null, sinceDress: tl.kind === 'wheel' ? tl.sinceDress : null });
      }
    }
    const opTypes = c ? new Set((c.r.tools || []).map(t => t.type)) : new Set();
    for (const tid of m.tools) {
      const tl = S.tools[tid]; if (opTypes.has(tl.typeId)) continue;
      tools.push({ id: tl.id, typeId: tl.typeId, name: tl.name, kind: tl.kind, wearPct: Math.round(tl.used / tl.life * 1000) / 10, used: r6(tl.used), life: tl.life, remainingParts: null,
        cutMinPerPart: null, plannedChange: null, status: 'idle', explain: 'Montiert, im aktuellen Arbeitsgang nicht im Einsatz (wird beim nächsten Rüsten getauscht oder behalten).' });
    }
    const people = [];
    for (const pid in S.people) { const p = S.people[pid]; if (p.task && p.task.machineId === id) people.push({ id: p.id, name: p.name, role: p.role, activity: p.activity, state: p.state, task: p.task.type }); }
    let operator = people[0] || null;
    if (!operator) for (const pid in S.people) { const p = S.people[pid]; if (p.onDuty && !p.endShift && p.machines.includes(id)) { operator = { id: p.id, name: p.name, role: p.role, activity: p.activity, state: p.state, task: null, responsible: true }; break; } }
    const stn = S.stations[id];
    const queue = [];
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status === 'fertig') continue;
      o.routing.forEach((r, i) => {
        if (r.station !== id || o.ops[i].complete || (m.op && m.op.oid === oid && m.op.idx === i)) return;
        const lv = opLevel(m, o, i);
        queue.push({ orderId: oid, seq: r.seq, op: r.op, due: o.due, priority: o.priority, level: lv.level, why: lv.why || (lv.eta ? 'Teile ab ca. ' + tclock(lv.eta) : 'Vorgänger noch nicht fertig'), parts: partsLeft(o, i), k: [o.priority === 'eil' ? 0 : 1, lv.level > 0 ? 2 - lv.level : 3, o.due, oid] });
      });
    }
    queue.sort((a, b) => cmpKey(a.k, b.k)); queue.forEach(q => delete q.k);
    return {
      id, name: m.name, short: m.short, type: m.type, kind: m.kind, area: m.area, vendor: st.vendor, model: st.model, control: st.control, year: st.year,
      automation: m.automation, loading: m.loading, rate: m.rate, conn: Object.assign({}, m.conn),
      state: m.state, stateLabel: meta.label, stateColor: meta.color, stateHex: WF.STATE_HEX[m.state], cause: m.cause, since: m.since, sinceSec: S.t - m.since,
      phase, order, partNo, partsDone, partsTotal, partProgress, partRemainSec: m.part ? m.part.rem + (m.part.sub === 'load' ? 0 : 0) : null, partSub: m.part ? m.part.sub : null,
      etaOpEnd, tools, operator, people,
      input: stn.inp.map(cid => contView(S.containers[cid])), output: stn.out.map(cid => contView(S.containers[cid])), inCap: m.inCap, outCap: m.outCap,
      oeeToday: oeeOf(m.kd), oeeShift: oeeOf(m.ks), stateTimes: Object.assign({}, m.kd.stateSec), goodToday: m.kd.good, scrapToday: m.kd.scrap,
      lossEurToday: Math.round(m.kd.lossEur), energyKwhToday: Math.round(m.kd.energyKwh * 10) / 10, powerKw: Math.round(machinePower(m) * 10) / 10,
      signals: (m.conn.level || 0) >= 2 ? m.signals : null,
      barStockM: m.barMagazineM ? m.barStockM : null, barMagazineM: m.barMagazineM || null, barReorderM: m.barReorderM || null, barMaterial: m.barMat ? S.materials[m.barMat].name : null,
      fault: m.fault ? Object.assign({}, m.fault, { sinceSec: S.t - m.fault.t0 }) : null,
      fpi: m.fpi ? Object.assign({}, m.fpi, { waitingSec: S.t - m.fpi.t0 }) : null,
      dressing: m.dressRem > 0, queue, segments: m.segments, counter: m.counter,
    };
  }
  function orderView(id) {
    const o = S.orders[id]; if (!o) return null;
    const fc = forecast(), f = fc.orders[id] || {};
    let wDone = 0, wAll = 0;
    const ops = o.routing.map((r, i) => {
      const op = o.ops[i], m = S.machines[r.station];
      const active = !!(m && m.op && m.op.oid === id && m.op.idx === i);
      const waiting = r.station === 'VERSAND' ? 0 : waitingQty(id, i);
      let inOutput = 0;
      for (const cid in S.containers) { const c = S.containers[cid]; if (c.orderId === id && c.src === i && (c.state === 'filling' || c.state === 'ready')) inOutput += c.qty; }
      const target = i === 0 ? o.qty : opTargetIn(o, i);
      const wt = r.station === 'EXT' ? 60 : r.station === 'VERSAND' ? 1 : (r.cycleMin || 1);
      wAll += o.qty * wt; wDone += Math.min(o.qty, op.good + op.scrap) * wt;
      const state = op.complete ? 'done' : active ? 'active' : r.station === 'EXT' && (op.inProc > 0 || waiting > 0) ? 'external' : (op.received > 0 || waiting > 0) ? 'waiting' : 'open';
      const fe = m ? (fc.machines[r.station] || []).find(x => x.orderId === id && x.seq === r.seq) : null;
      return { seq: r.seq, op: r.op, station: r.station, stationName: stShort(r.station), received: op.received, good: op.good, scrap: op.scrap, inProc: op.inProc,
        waiting, inOutput, passed: op.passed, target, complete: op.complete, state, machineState: active ? m.state : null, cause: active ? m.cause : null,
        setupMin: r.setupMin || 0, cycleMin: r.cycleMin || 0, transferBatch: r.transferBatch || null, firstPiece: !!r.firstPiece, ext: r.ext || null,
        plannedStart: fe ? fe.start : null, plannedEnd: fe ? fe.end : null, startT: op.startT, endT: op.endT, measKey: id + '/' + r.seq };
    });
    const containers = [];
    for (const cid in S.containers) { const c = S.containers[cid]; if (c.orderId === id) containers.push(contView(c)); }
    const eta = o.status === 'fertig' ? o.doneT : f.eta;
    const slack = eta != null ? o.due - eta : null;
    const risk = slack == null ? 'unbekannt' : slack < 0 ? 'spät' : slack < 4 * 3600 && o.status !== 'fertig' ? 'knapp' : 'ok';
    return { id, customer: o.customer, sector: o.sector, part: Object.assign({}, o.part), qty: o.qty, due: o.due, priority: o.priority, status: o.status, note: o.note,
      shippedQty: o.shippedQty, progress: wAll ? Math.min(1, wDone / wAll) : 0, ops, containers, eta, late: eta != null && eta > o.due, slackSec: slack, risk,
      bottleneck: f.bottleneck || null, startT: o.startT, doneT: o.doneT, source: o.source };
  }
  function trimStr(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  /** kompakte Sicht für die KI (< 12 kB) */
  function snapshot() {
    const k = kpis(), fc = forecast();
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const machines = Object.values(S.machines).map(m => {
      const c = curOf(m);
      let tool = null;
      if (c) for (const spec of c.r.tools || []) { const tl = mountedOf(m, spec.type); if (!tl) continue; const rem = remParts(tl, spec.cutMinPerPart); if (!tool || rem < tool.rem) tool = { type: spec.type, rem, wear: Math.round(tl.used / tl.life * 100) }; }
      return { id: m.id, name: m.short, st: m.state, since: U.fmtClock(m.since), ord: c ? c.o.id + '/AG' + c.r.seq : null, part: c ? (c.op.good + c.op.scrap) + '/' + (c.i === 0 ? c.o.qty : opTargetIn(c.o, c.i)) : null,
        why: trimStr(m.cause, 110), tool, oee: r3(oeeOf(m.kd).oee), conn: m.conn.level };
    });
    const orders = Object.values(S.orders).map(o => { const f = fc.orders[o.id] || {}; return { id: o.id, cust: trimStr(o.customer, 28), part: trimStr(o.part.name, 28), qty: o.qty, st: o.status, prio: o.priority,
      shipped: o.shippedQty, due: U.fmtDayClock(o.due), eta: f.eta ? U.fmtDayClock(f.eta) : null, late: !!f.late }; });
    const alerts = S.notifications.filter(n => n.status !== 'resolved').slice(0, 12).map(n => ({ id: n.id, sev: n.sev, role: n.role, title: trimStr(n.title, 90), t: U.fmtClock(n.t) }));
    const low = Object.values(S.materials).filter(mt => mt.onHand < mt.min * 1.2).map(mt => ({ id: mt.id, name: mt.name, onHand: Math.round(mt.onHand * 10) / 10, min: mt.min, unit: mt.unit, onOrder: mt.onOrder }));
    const people = Object.values(S.people).filter(p => p.onDuty).map(p => ({ id: p.id, name: p.name, role: p.role, st: p.state, act: trimStr(p.activity, 60) }));
    const agvs = Object.values(S.agvs).map(a => ({ id: a.id, st: a.state, bat: Math.round(a.battery), load: a.load }));
    const recent = [];
    for (let j = S.events.length - 1; j >= 0 && recent.length < 10; j--) { const e = S.events[j]; if (e.type === 'state' && e.data && e.data.minor) continue; if (e.type === 'state' && e.data && e.data.to === 'running') continue; recent.push({ t: U.fmtClock(e.t), msg: trimStr(e.msg, 120) }); }
    return { t: S.t, clock: clock(), shift: shift().name, company: P.company.name,
      kpi: { oee: r3(k.oee), availability: r3(k.availability), performance: r3(k.performance), quality: r3(k.quality), good: k.good, scrap: k.scrap, fpy: r3(k.fpy), onTimePct: r3(k.onTimePct),
        lossEur: k.lossEur, energyKwh: k.energyKwh, powerKw: k.powerKw, wip: k.wip, transportsToday: k.transportsToday, toolCostToday: k.toolCostToday },
      machines, orders, alerts, materialsLow: low, people, agvs, recent };
  }

  // ------------------------------------------------------------------ Aktionen (§3.10)
  const fail = (msg) => ({ ok: false, msg });
  function triggerFault(machineId, code) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (m.fault) return fail(`${m.id} hat bereits eine Störung (${m.fault.code})`);
    if (m.setupRun || m.toolchange || m.corrRun) return fail(`${m.id} wird gerade gerüstet bzw. Werkzeug gewechselt – Störung danach auslösen`);
    startFault(m, code || null, true);
    return { ok: true, msg: `Störung ${m.fault.code} „${m.fault.text}“ an ${m.id} ausgelöst` };
  }
  function repair(machineId) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (!m.fault) return fail(`${m.id} hat keine Störung`);
    const tk = S.tasks[m.tasks.repair]; if (tk) finishTask(tk, 'cancelled');
    endFault(m, null);
    return { ok: true, msg: `Störung an ${m.id} behoben (Demo)` };
  }
  function findN(id) { return S.notifications.find(n => n.id === id || n.key === id); }
  function ack(nid, by) {
    const n = findN(nid); if (!n) return fail('Benachrichtigung unbekannt');
    if (n.status === 'resolved') return fail('Bereits erledigt');
    n.status = 'ack'; n.ackBy = by || 'Leitstand'; n.ackT = S.t;
    WF.bus.emit('sim:notify', n);
    return { ok: true, msg: 'Quittiert' };
  }
  function resolveN(nid) {
    const n = findN(nid); if (!n) return fail('Benachrichtigung unbekannt');
    if (n.status === 'resolved') return { ok: true, msg: 'Bereits erledigt' };
    if (NIDX[n.key] === n) delete NIDX[n.key];
    n.status = 'resolved'; n.resolvedT = S.t; n.resolveNote = 'manuell erledigt';
    WF.bus.emit('sim:notify', n);
    return { ok: true, msg: 'Erledigt' };
  }
  function reorder(materialId, qty) {
    const mt = S.materials[materialId]; if (!mt) return fail('Material unbekannt: ' + materialId);
    const q = qty != null ? Number(qty) : mt.reorderQty;
    if (!(q > 0) || q > mt.reorderQty * 20) return fail('Menge ungültig');
    const etaT = nextDayWindow(S.t + mt.leadMin * 60);
    const pu = { id: U.uid('BE'), materialId, qty: q, orderedT: S.t, etaT, status: 'bestellt', supplier: mt.supplier, costEur: Math.round(q * mt.pricePerUnit) };
    S.purchases.push(pu);
    mt.onOrder = r6(mt.onOrder + q);
    ev('reorder', 'info', { kind: 'material', id: mt.id }, `Bestellung ${pu.id}: ${nm(q, mt.unit === 'm' ? 1 : 0)} ${mt.unit} ${mt.name} bei ${mt.supplier} – Lieferung ca. ${U.fmtDayClock(etaT)} (${U.fmtEur(pu.costEur)})`, { purchaseId: pu.id, qty: q, etaT });
    checkStock(mt);
    FC = null;
    return { ok: true, id: pu.id, msg: `Bestellt: ${nm(q, 1)} ${mt.unit} ${mt.name}, Lieferung ca. ${U.fmtDayClock(etaT)}` };
  }
  function setPriority(orderId, prio) {
    const o = S.orders[orderId]; if (!o) return fail('Auftrag unbekannt: ' + orderId);
    if (prio !== 'eil' && prio !== 'normal') return fail("Priorität muss 'eil' oder 'normal' sein");
    if (o.status === 'fertig') return fail('Auftrag ist bereits fertig');
    const old = o.priority; o.priority = prio; FC = null;
    for (const id in S.machines) S.machines[id].nextPickT = 0;
    ev('priority', 'info', { kind: 'order', id: o.id }, `${o.id}: Priorität ${old} → ${prio}${prio === 'eil' ? ' – wird bei jedem Auftragswechsel vorgezogen (laufende Teile werden nicht unterbrochen)' : ''}`, { from: old, to: prio });
    return { ok: true, msg: prio === 'eil' ? `${o.id} ist jetzt Eilauftrag` : `${o.id} wieder normale Priorität` };
  }
  function compatible(a, b) { return a === b || (!!TYPE_GROUP[a] && TYPE_GROUP[a] === TYPE_GROUP[b]); }
  function moveOp(orderId, seq, stationId) {
    const o = S.orders[orderId]; if (!o) return fail('Auftrag unbekannt: ' + orderId);
    const i = o.routing.findIndex(r => r.seq === Number(seq)); if (i < 0) return fail('Arbeitsgang unbekannt: ' + seq);
    const r = o.routing[i], op = o.ops[i];
    if (op.complete) return fail('Arbeitsgang ist bereits abgeschlossen');
    const from = S.machines[r.station], to = S.machines[stationId];
    if (!from || !to || to.kind !== 'machine') return fail('Verlagerung nur zwischen Bearbeitungsmaschinen möglich');
    if (stationId === r.station) return fail(`Arbeitsgang liegt bereits auf ${stationId}`);
    if (!compatible(from.type, to.type)) return fail(`${to.id} ${to.short} kann „${r.op}“ nicht bearbeiten (anderer Maschinentyp)`);
    if (from.op && from.op.oid === orderId && from.op.idx === i) {
      if (from.part || from.fpi || from.setupRun || from.toolchange || from.corrRun || from.fault || from.needCorr || from.rework) return fail(`${from.id} bearbeitet den Arbeitsgang gerade – Verlagerung an der nächsten Teilegrenze erneut versuchen`);
      pauseOp(from, o, i, `${orderId} AG ${r.seq} wird von ${from.id} auf ${stationId} verlagert`);
    }
    r.station = stationId; op.station = stationId;
    // wartende Behälter umlagern, laufende Transporte umleiten
    const st = S.stations[from.id];
    for (const cid of st.inp.slice()) {
      const c = S.containers[cid];
      if (c.orderId !== orderId || c.idx !== i || c.state !== 'input') continue;
      op.received -= c.qty; c.state = 'ready'; c.relocate = true; CV++;
      createTransport(c);
    }
    for (const tid in S.transports) {
      const tr = S.transports[tid];
      if (tr.status === 'done' || tr.to.station !== from.id || !tr.containerId) continue;
      const c = S.containers[tr.containerId]; if (!c || c.orderId !== orderId || c.idx !== i) continue;
      tr.to.station = stationId; tr.label = tr.label.replace(stShort(from.id), stShort(stationId));
      const a = S.agvs[tr.assignee];
      if (a && a.state === 'toDrop') routeTo(a, ST[stationId].dockNode, stPos(stationId, 'in'));
      if (tr.taskId && S.tasks[tr.taskId]) {
        const tk = S.tasks[tr.taskId];
        tk.steps.forEach((s, k) => { if (k >= 3 && s.to === from.id) s.to = stationId; });
        const p = tk.assignee && S.people[tk.assignee];
        if (p && p.route && tk.si === 3) routeTo(p, ST[stationId].dockNode, stPos(stationId, 'in'));
      }
    }
    to.nextPickT = 0; FC = null;
    ev('moveOp', 'info', { kind: 'order', id: orderId }, `${orderId} AG ${r.seq} „${r.op}“ von ${from.id} auf ${to.id} ${to.short} verlagert – dort wird neu gerüstet (${r.setupMin || 0} min)`, { seq: r.seq, from: from.id, to: to.id });
    return { ok: true, msg: `${orderId} AG ${r.seq} auf ${to.id} verlagert` };
  }
  function connectMachine(machineId, level, protocol) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    const lv = Math.round(Number(level));
    if (!(lv >= 0 && lv <= 3)) return fail('Anschluss-Level muss 0–3 sein');
    const old = m.conn.level;
    m.conn = { level: lv, protocol: protocol || m.conn.protocol, gateway: lv === 0 ? '–' : (m.conn.gateway && m.conn.gateway !== '–' ? m.conn.gateway : 'werkfluss Edge 03'), connectedT: S.t };
    if (lv < 2) m.signals = null;
    ev('connect', 'ok', { kind: 'machine', id: m.id }, `${m.id} ${m.short}: Anbindung Level ${old} → ${lv} (${m.conn.protocol})`, { from: old, to: lv, protocol: m.conn.protocol });
    return { ok: true, msg: `${m.id} ist jetzt mit Level ${lv} angebunden` };
  }
  /** Vorbeugender Werkzeugwechsel (z. B. vor der Geisterschicht) – bewusste, sichtbare Entscheidung */
  function planToolChange(machineId, types) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (!m.op || !m.setupDone) return fail(`${m.id} hat keinen eingerichteten Arbeitsgang`);
    const c = curOf(m);
    let list = types && types.length ? types : (c.r.tools || []).filter(t => { const tl = mountedOf(m, t.type); return tl && tl.used / tl.life >= 0.3; }).map(t => t.type);
    if (!list.length) return fail('Kein Werkzeug mit nennenswertem Verschleiß (≥ 30 %)');
    const tk = ensureToolTask(m, false);
    tk.data.manual = true; tk.data.types = list; tk.prio = Math.max(tk.prio, PRIO.setup);
    ev('toolPlanned', 'info', { kind: 'machine', id: m.id }, `${m.id}: vorbeugender Werkzeugwechsel beauftragt (${list.map(t => TT[t].name).join(', ')}) – erfolgt an der nächsten Teilegrenze`, { manual: true, types: list });
    return { ok: true, msg: `Vorbeugender Wechsel an ${m.id} beauftragt` };
  }
  function addOrder(spec) {
    if (!spec || typeof spec !== 'object') return fail('Ungültige Auftragsdaten');
    const qty = Math.round(Number(spec.qty));
    if (!(qty > 0) || qty > 100000) return fail('Menge muss zwischen 1 und 100.000 liegen');
    if (!spec.part || !spec.part.name) return fail('Teilbezeichnung fehlt');
    if (!Array.isArray(spec.routing) || !spec.routing.length) return fail('Arbeitsplan fehlt');
    const steps = [], warnings = [];
    for (let k = 0; k < spec.routing.length; k++) {
      const r = spec.routing[k] || {}, sid = r.station;
      if (sid === 'VERSAND') continue;
      if (!ST[sid]) return fail(`Arbeitsgang ${k + 1}: Station „${sid}“ unbekannt`);
      if (sid === 'EXT') {
        const ext = Object.assign({ partner: 'Härterei Wolf GmbH (Beispiel)', process: r.op || 'Härten', leadMin: 480 }, r.ext || {});
        steps.push({ op: r.op || ext.process, station: 'EXT', ext, transferBatch: Math.max(1, Math.round(r.transferBatch || qty)) });
        continue;
      }
      const m = S.machines[sid];
      if (!m) return fail(`Arbeitsgang ${k + 1}: ${sid} ist kein Arbeitsplatz`);
      const cyc = Number(r.cycleMin);
      if (!(cyc > 0)) return fail(`Arbeitsgang ${k + 1} (${sid}): Taktzeit fehlt`);
      const tools = [];
      for (const t of r.tools || []) {
        if (!TT[t.type]) { warnings.push(`Werkzeugtyp ${t.type} unbekannt – ignoriert`); continue; }
        const cut = Number(t.cutMinPerPart);
        if (!(cut > 0)) continue;
        if (cut > TT[t.type].lifeMin) { warnings.push(`${t.type}: Schnittzeit je Teil > Standzeit – begrenzt`); }
        tools.push({ type: t.type, cutMinPerPart: Math.min(cut, TT[t.type].lifeMin) });
      }
      let material = null;
      if (r.material && steps.length === 0) {
        if (S.materials[r.material.id] && Number(r.material.perPart) > 0) material = { id: r.material.id, perPart: Number(r.material.perPart) };
        else warnings.push(`Material ${r.material.id} unbekannt – Rohteile werden beigestellt`);
      }
      steps.push({ op: r.op || TASK_LABEL.setup, station: sid, setupMin: Math.max(0, Number(r.setupMin) || 0), cycleMin: cyc,
        transferBatch: Math.max(1, Math.round(r.transferBatch || Math.min(qty, 20))),
        firstPiece: r.firstPiece != null ? !!r.firstPiece : (m.kind === 'machine' && m.type !== 'saw' && m.type !== 'washer'),
        tools, material, char: r.char || null, loadMin: r.loadMin != null ? Number(r.loadMin) : undefined });
    }
    if (!steps.length) return fail('Arbeitsplan enthält keinen Bearbeitungsschritt');
    steps.push({ op: 'Versand', station: 'VERSAND' });
    steps.forEach((s, k) => { s.seq = (k + 1) * 10; });
    let n = 24130;
    for (const id in S.orders) { const x = parseInt(String(id).replace(/\D/g, ''), 10); if (x >= n) n = x + 1; }
    const id = 'FA-' + n;
    let due = Number(spec.due); if (!isFinite(due) || due <= S.t) due = addWork(S.t, 3 * 16 * 3600);
    buildOrder({ id, customer: spec.customer || 'Neukunde', sector: spec.sector || '', qty, due, priority: spec.priority === 'eil' ? 'eil' : 'normal', note: spec.note || '', source: spec.source || 'KI-Auftrag',
      part: { no: spec.part.no || ('KI-' + (n % 10000)), name: spec.part.name, material: spec.part.material || '–', drawing: spec.part.drawing || '–', weightKg: Number(spec.part.weightKg) > 0 ? Number(spec.part.weightKg) : 1 },
      routing: steps });
    for (const mid in S.machines) S.machines[mid].nextPickT = 0;
    FC = null;
    ev('orderAdded', 'ok', { kind: 'order', id }, `Neuer Auftrag ${id} eingelastet: ${qty} Stk „${spec.part.name}“ für ${spec.customer || 'Neukunde'}, Termin ${U.fmtDayClock(due)} (${steps.length - 1} Arbeitsgänge)${warnings.length ? ' – Hinweise: ' + warnings.join('; ') : ''}`, { warnings });
    return id;
  }
  /** Notification-Aktion ausführen ({type, ...}) */
  function runAction(a) {
    if (!a || !a.type) return fail('Aktion fehlt');
    switch (a.type) {
      case 'reorder': return reorder(a.materialId, a.qty);
      case 'setPriority': return setPriority(a.orderId, a.priority || a.value || 'eil');
      case 'repair': return repair(a.machineId);
      case 'triggerFault': return triggerFault(a.machineId, a.code);
      case 'moveOp': return moveOp(a.orderId, a.seq, a.stationId);
      case 'applyOffset': return applyOffset(a.orderId, a.seq, a.value, 'Leitstand');
      case 'planToolChange': return planToolChange(a.machineId, a.types);
      case 'ack': return ack(a.id, a.by);
      case 'resolve': return resolveN(a.id);
      case 'select': WF.bus.emit('select', { kind: a.kind, id: a.id }); return { ok: true, msg: 'geöffnet' };
    }
    return fail('Unbekannte Aktion ' + a.type);
  }

  // ------------------------------------------------------------------ Hauptschleife
  function step() {
    S.t += 1;
    if (S.t % DAY === 0) dayRollover();
    shiftTick();
    if (S.t % 10 === 0) { purchasesTick(); extTick(); }
    for (let k = 0; k < MA.length; k++) machineTick(MA[k]);
    if ((S.t & 1) === 0) transportsTick();
    assignTasks();
    for (let k = 0; k < PA.length; k++) personTick(PA[k]);
    for (let k = 0; k < AA.length; k++) agvTick(AA[k]);
    statsTick();
    if (S.t % 10 === 0) rulesTick();
    if (S.t % 5 === 0) signalsTick();
    historyTick();
  }
  let acc = 0;
  /** rechnet simSeconds weiter (Unterschritte 1 s, max. 3600 je Aufruf); Bruchteile werden aufsummiert */
  function advance(simSeconds) {
    if (!S) init(WF.profile);
    acc += Math.max(0, Number(simSeconds) || 0);
    let n = Math.floor(acc);
    acc -= n;
    if (n > 3600) n = 3600;
    for (let k = 0; k < n; k++) step();
    return n;
  }

  // ------------------------------------------------------------------ Export
  const actions = {
    triggerFault, repair, ack, resolve: resolveN, reorder, setPriority, addOrder, moveOp, connectMachine,
    applyOffset: (orderId, seq, value) => applyOffset(orderId, Number(seq), value, 'Leitstand'), planToolChange, run: runAction,
    reset: () => { acc = 0; init(P || WF.profile); return { ok: true, msg: 'Simulation neu gestartet' }; },
  };
  WF.sim = {
    init: (profile) => { acc = 0; return init(profile); },
    reset: () => actions.reset(),
    advance, step: () => step(),
    get state() { return S; },
    get history() { return S ? S.history : null; },
    get t() { return S ? S.t : 0; },
    get speedHint() { return (P || WF.profile || { sim: {} }).sim.defaultSpeed || 30; },
    clock, shift, machineView, orderView, forecast, kpis, snapshot, actions, runAction,
    // Hilfen für Ansichten / Tests
    stationName: stShort, partsLeft: (orderId, seq) => { const o = S.orders[orderId]; const i = o ? o.routing.findIndex(r => r.seq === seq) : -1; return i >= 0 ? partsLeft(o, i) : null; },
    charOf: (orderId, seq) => { const o = S.orders[orderId]; const i = o ? o.routing.findIndex(r => r.seq === seq) : -1; if (i < 0) return null; const ch = charOf(S.machines[o.routing[i].station] || { type: 'cmm' }, o.routing[i]); return Object.assign({ lsl: ch.nominal + ch.tolMinus, usl: ch.nominal + ch.tolPlus, center: ch.nominal + (ch.tolMinus + ch.tolPlus) / 2 }, ch); },
    containerWhere: (id) => (S.containers[id] ? whereText(S.containers[id]) : null),
    config: CFG,
  };
})();
