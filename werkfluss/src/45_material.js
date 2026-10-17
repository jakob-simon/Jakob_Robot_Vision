/* werkfluss – Ansicht „Material & Logistik“ (45_material.js) + Details „agv“ (auch Stapler „STP1“), „material“, „container“.
   Abschnitte: Kopf mit Logistik-Lage, Kennzahlen (mit Verlauf), „Materialfluss heute“ (Hallenplan als Fluss-Diagramm: Stationen
   an ihrer Hallenposition, Kanten = heute bewegte Behälter mit Ports und verschachtelten Bögen, laufende Transporte als wandernde
   Punkte, AGVs/Stapler live auf den Fahrwegen, Zuteilungen als Informations-Impuls, Härterei-Schleife, Direktentnahme der Säge),
   Tagesbilanz/Servicegrad, Flotte, Transportaufträge, Rohmaterial (Bestand, Reichweite aus offenem Bedarf und Plantafel,
   Bestellungen, Nachbestellen-Dialog), Behälter im Umlauf (nach Ort in Flussrichtung gruppiert).
   Daten nur lesend aus WF.sim (state, forecast, kpis, containerView …); Aktionen über WF.sim.actions.reorder.
   Ein kleiner Mitschreiber (Ledger) hält Transporte, Fremdbearbeitungs-Lose, Akku-/Zustandsverläufe und Lagerentnahmen
   lokal fest, weil die Engine erledigte Transporte nur 6 h aufbewahrt und keine Akku-Historie führt.
   Öffentlich: WF.material.{flowsToday, transportsToday, agvUtil, forkUtil, shiftWindow, batteryHistory, demand, withdrawnToday, openReorder}. */
(function () {
  const WF = window.WF;
  if (!WF || !WF.registerView) return;
  const { esc } = WF.ui;
  const U = WF.util;
  const DAY = 86400;

  const S = () => WF.sim && WF.sim.state;
  const PRO = () => WF.profile;
  const STN = (id) => WF.profile.stationById[id];
  const stName = (id) => (id === 'HAERT' ? haertName() : (WF.sim && WF.sim.stationName ? WF.sim.stationName(id) : id));
  const lbl = (g, k) => (WF.sim && WF.sim.label ? WF.sim.label(g, k) : k);
  const tclock = (t, now) => (t == null ? '–' : Math.floor(t / DAY) === Math.floor(now / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const personName = (id) => { const s = S(); const p = s && s.people[id]; return p ? p.name : (id || '–'); };
  const amt = (v, unit) => (v == null ? '–' : U.fmtNum(v, unit === 'm' ? 1 : 0) + ' ' + unit);
  const stk = (n) => U.fmtNum(n) + ' Stk';
  const kg = (n) => (n == null ? '–' : n >= 1000 ? U.fmtNum(n / 1000, 1) + ' t' : U.fmtNum(n, 0) + ' kg');
  const dur = (sec) => (sec == null ? '–' : sec < 60 ? Math.max(0, Math.round(sec)) + ' s' : U.fmtDur(Math.floor(sec / 60) * 60));
  const splitBsp = (s) => { const m = String(s || '').match(/^(.*?)\s*(\(Beispiel\))$/); return m ? [m[1], m[2]] : [String(s || ''), '']; };
  const pill = (c, label, cls) => `<span class="pill${cls ? ' ' + cls : ''}" style="--c:${c}"><i></i>${esc(label)}</span>`;
  const cfg = () => (WF.sim && WF.sim.config) || {};
  function haertName() {
    const P = PRO();
    for (const o of P.orders) for (const r of o.routing) if (r.ext && r.ext.partner) return splitBsp(r.ext.partner)[0].replace(/\s+GmbH$/, '');
    return 'Fremdbearbeiter';
  }

  // Farben (nur Tokens)
  const AGV_C = { idle: 'var(--st-idle)', toPickup: 'var(--info)', loading: 'var(--mat)', toDrop: 'var(--mat)', unloading: 'var(--mat)', toCharge: 'var(--st-setup)', charging: 'var(--st-setup)', blocked: 'var(--st-fault)' };
  // Transporte: offen neutral (lange Wartezeit → Warnfarbe in trColor), zugeteilt = Informationsfluss, beladen = Material
  const TR_C = { open: 'var(--muted)', assigned: 'var(--info)', toPickup: 'var(--info)', loaded: 'var(--mat)', toDrop: 'var(--mat)', done: 'var(--faint)' };
  // Behälter: Lebenszyklus in der Material-Familie (UI_GUIDE Regel 15) – nie Maschinenzustandsfarben; Fremdbearbeitung = --ext
  const CT_C = { filling: 'var(--mat)', ready: 'var(--mat)', transit: 'var(--mat)', input: 'var(--muted)', external: 'var(--ext)', shipped: 'var(--faint)', scrap: 'var(--st-fault)' };
  const ctMark = (state) => `<i class="mt-mk k-${esc(state)}" aria-hidden="true"></i>`;
  // Mengenbalken neutral, Warnfarbe nur für die Aussage (unter Mindestbestand ohne Bestellung)
  const STOCK_C = 'color-mix(in srgb,var(--text2) 60%,transparent)';
  const FORM = { Stange: 'Stange', Platte: 'Platte', Stk: 'Rohteile' };
  const WAIT_WARN = 15 * 60, WAIT_CRIT = 45 * 60;

  // eigene Linien-Icons (24er Raster) ergänzend zu WF.ICONS
  const MI = {
    agv: '<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M7 17v2M17 17v2M8 11h8"/>',
    forklift: '<path d="M16 3v15h6"/><path d="M3 16v-6h6l3 3.5h4"/><path d="M5.5 10V6h4v4"/><circle cx="6" cy="17.5" r="2"/><circle cx="12.5" cy="17.5" r="2"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    rack: '<path d="M3 3v18M21 3v18M3 8h18M3 14h18M3 20h18"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>',
    ship: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    plug: '<path d="M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M10 3v4M14 3v4M12 16v5"/>',
  };
  const ICO = (name, size = 16) => {
    const p = MI[name] || (WF.ICONS && WF.ICONS[name]) || '<circle cx="12" cy="12" r="3"/>';
    return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  };
  const svgIco = (name, x, y, size, cls) => {
    const p = MI[name] || (WF.ICONS && WF.ICONS[name]) || '';
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" class="${cls || ''}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  };

  // kleine DOM-Patch-Helfer
  function setText(n, t) { t = t == null ? '' : String(t); if (n && n._t !== t) { n._t = t; n.textContent = t; } }
  function setHTML(n, h) { if (n && n._h !== h) { n._h = h; n.innerHTML = h; } }
  function setVar(n, k, v) { const key = '_v' + k; if (n && n[key] !== v) { n[key] = v; n.style.setProperty(k, v); } }
  function setAttr(n, k, v) { const key = '_a' + k; if (n && n[key] !== v) { n[key] = v; if (v == null || v === false) n.removeAttribute(k); else n.setAttribute(k, v); } }
  function setCls(n, c, on) { if (n) n.classList.toggle(c, !!on); }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };

  // ================================================================== Mitschreiber (Ledger)
  const L = { tr: new Map(), ext: [], samp: {}, since: {}, stlog: {}, wd: {}, wdDay: null, onHand: {}, lastScanT: -1, lastSampT: -1, maxT: -1, ver: 0 };
  function ledgerReset() {
    L.tr.clear(); L.ext.length = 0; L.samp = {}; L.since = {}; L.stlog = {}; L.wd = {}; L.wdDay = null; L.onHand = {};
    L.lastScanT = -1; L.lastSampT = -1; L.maxT = -1; L.ver++;
  }
  function scanTransports() {
    const s = S(); if (!s || !s.transports) return;
    for (const id in s.transports) {
      const t = s.transports[id];
      let r = L.tr.get(id);
      if (r && r.final) continue;
      if (!r) { r = { id, firstT: s.t }; L.tr.set(id, r); L.ver++; }
      const st0 = r.status, to0 = r.to;
      r.kind = t.kind; r.from = t.from.station; r.to = t.to.station; r.mode = t.mode; r.status = t.status;
      r.createdT = t.createdT; r.pickupT = t.pickupT; r.doneT = t.doneT; r.orderId = t.orderId || null; r.label = t.label;
      r.cancelled = !!t.cancelled; r.containerId = t.containerId || null; r.materialId = t.materialId || null;
      if (t.meters) r.meters = t.meters;
      if (t.empties) r.empties = t.empties;
      if (r.weightKg == null || t.status !== 'done') r.weightKg = t.weightKg;
      // Phase (Engine §7.5): „geplant“ = Ziel voll, Behälter bereitgestellt/vorgemerkt – das ist keine Wartezeit der Logistik.
      // Die Wartezeit beginnt erst, wenn der Transport fällig wird (Ziel frei): dueT (Engine-Feld, sonst vom Mitschreiber erkannt).
      const ph = phaseOf(t), ph0 = r.phase;
      r.phase = ph;
      if (ph === 'geplant') { r.everPlanned = true; r.lastPlanT = s.t; r.dueT = null; if (t.waitReason) r.planWhy = t.waitReason; }
      else if (r.dueT == null) {
        const eDue = engineDueT(t);
        r.dueT = eDue != null ? eDue : r.lastPlanT != null ? Math.max(t.createdT, r.lastPlanT) : t.createdT;
      }
      if (t.status === 'open') { r.waitReason = t.waitReason || null; if (t.waitReason && ph !== 'geplant') r.why = t.waitReason; }
      else r.waitReason = null;
      if (ph0 !== ph) L.ver++;
      if (t.assignee) {
        r.assignee = t.assignee;
        r.carrier = s.agvs[t.assignee] ? s.agvs[t.assignee].name : shortName(personName(t.assignee));
      }
      if (t.status !== 'open' && r.assignedT == null) r.assignedT = Math.max(t.createdT, Math.min(s.t, t.pickupT || s.t));
      const c = t.containerId ? s.containers[t.containerId] : null;
      if (c && t.status !== 'done') { r.qty = c.qty; r.partName = c.partName; r.cKind = c.kind; r.seq = c.seq; r.srcSeq = c.srcSeq; r.weightKg = c.weightKg; }
      if (!r.partName && r.orderId && s.orders[r.orderId]) r.partName = s.orders[r.orderId].part.name;
      // erst nach dem Abstellen gesehen (Behälter evtl. schon aufgebraucht): Menge aus der Transportbezeichnung, Ziel-AG aus dem Arbeitsplan
      if (r.qty == null && t.kind !== 'bars') { const m = /^(\d+) Stk/.exec(t.label || ''); if (m) r.qty = Number(m[1]); else if (c) r.qty = c.qty; }
      if (r.seq == null && r.orderId && s.orders[r.orderId]) { const ops = s.orders[r.orderId].routing.filter(x => x.station === r.to); if (ops.length === 1) r.seq = ops[0].seq; }
      if (st0 !== r.status || to0 !== r.to) L.ver++;
      if (t.status === 'done') r.final = true;
    }
    if (L.tr.size > 2500 || (s.t % 3600) < 20) {
      for (const [id, r] of L.tr) if (r.final && r.doneT != null && s.t - r.doneT > 36 * 3600) L.tr.delete(id);
    }
  }
  function recordExt(e) {
    const s = S(); if (!s) return;
    const d = e.data || {};
    const ids = (e.type === 'extOut' ? (d.containers || [e.entity && e.entity.id]) : [e.entity && e.entity.id]).filter(Boolean);
    let qty = d.qty, w = 0, partName = null;
    if (qty == null) { qty = 0; for (const id of ids) { const c = s.containers[id]; if (c) qty += c.qty; } }
    for (const id of ids) { const c = s.containers[id]; if (c) { w += c.weightKg || 0; partName = partName || c.partName; } }
    const o = d.orderId && s.orders[d.orderId];
    let process = null;
    if (o && d.seq != null) { const r = o.routing.find(x => x.seq === d.seq); process = r && r.ext ? r.ext.process : r ? r.op : null; }
    L.ext.push({ t: e.t, type: e.type === 'extOut' ? 'out' : 'in', orderId: d.orderId || null, qty, n: Math.max(1, ids.length), kg: w,
      containers: ids, returnT: d.returnT || null, partName: partName || (o ? o.part.name : null), process, msg: e.msg });
    if (L.ext.length > 400) L.ext.splice(0, L.ext.length - 400);
    L.ver++;
  }
  function sample() {
    const s = S(); if (!s || !s.agvs) return;
    const cut = s.t - DAY;
    const push = (id, rec) => { const a = L.samp[id] || (L.samp[id] = []); a.push(rec); while (a.length && a[0].t < cut) a.shift(); };
    for (const id in s.agvs) { const a = s.agvs[id]; push(id, { t: s.t, b: a.battery, st: a.state }); }
    if (s.forklift) push(s.forklift.id, { t: s.t, st: s.forklift.state, load: !!s.forklift.load });
    // Verlauf „offene Transporte“ = fällige (vorgemerkte mit vollem Ziel zählen nicht – wie die Kennzahl)
    let dueOpen = 0; for (const id in s.transports) { const t = s.transports[id]; if (t.status !== 'done' && !t.cancelled && phaseOf(t) !== 'geplant') dueOpen++; }
    push('_q', { t: s.t, v: dueOpen });
    let cn = 0; for (const id in s.containers) { const c = s.containers[id]; if (c.state !== 'shipped' && c.state !== 'scrap') cn++; }
    push('_c', { t: s.t, v: cn });
  }
  /** Lagerentnahmen je Material und Tag (Bestandsabnahmen; Lieferungen/Rückbuchungen zählen nicht als Entnahme) */
  function trackStock() {
    const s = S(); if (!s || !s.materials) return;
    const day = Math.floor(s.t / DAY);
    if (L.wdDay !== day) { L.wdDay = day; L.wd = {}; }
    for (const id in s.materials) {
      const v = s.materials[id].onHand, prev = L.onHand[id];
      if (prev != null && v < prev - 1e-9) L.wd[id] = (L.wd[id] || 0) + (prev - v);
      L.onHand[id] = v;
    }
  }
  function tick(force) {
    const s = S(); if (!s || !s.agvs || s.t == null) return;
    if (s.t < L.maxT) ledgerReset();
    L.maxT = s.t;
    for (const id in s.agvs) {
      const a = s.agvs[id], k = L.since[id];
      if (!k || k.st !== a.state) {
        L.since[id] = { st: a.state, t: s.t };
        const lg = L.stlog[id] || (L.stlog[id] = []); lg.push({ t: s.t, st: a.state });
        while (lg.length > 2 && lg[1].t < s.t - DAY) lg.shift();
      }
    }
    if (s.forklift) { const f = s.forklift, st = f.state + (f.load ? '+' : ''), k = L.since[f.id]; if (!k || k.st !== st) L.since[f.id] = { st, t: s.t }; }
    trackStock();
    if (force || s.t - L.lastScanT >= 12) { L.lastScanT = s.t; scanTransports(); }
    if (force || s.t - L.lastSampT >= 60) { L.lastSampT = s.t; sample(); }
  }
  WF.bus.on('sim:event', (e) => {
    if (!e) return;
    if (e.type === 'reset') { ledgerReset(); return; }
    try {
      if (e.type === 'extOut' || e.type === 'extIn') recordExt(e);
      tick(false);
    } catch (err) { /* Mitschreiber darf die Simulation nie stören */ }
  });
  WF.bus.on('sim:reset', () => { try { tick(true); } catch (e) { /* ignorieren */ } invalidate(); });
  setInterval(() => { try { tick(false); } catch (e) { /* ignorieren */ } }, 1000);

  // ================================================================== Ableitungen
  const dayStart = (t) => Math.floor(t / DAY) * DAY;
  /** Transporte heute (erledigt seit 00:00 + alle offenen/laufenden), neueste zuerst */
  function transportsToday() {
    const s = S(); if (!s) return [];
    const d0 = dayStart(s.t), out = [];
    for (const r of L.tr.values()) if (r.status !== 'done' || r.doneT >= d0) out.push(r);
    return out.sort((a, b) => (b.doneT || b.createdT) - (a.doneT || a.createdT));
  }
  /** Bezugsfenster für Auslastungen: Beginn der laufenden Schicht (nachts: Ende der Spätschicht = Geisterschicht) */
  function shiftWindow() {
    const s = S(); const now = s.t, d0 = dayStart(now);
    let sh = null; try { sh = WF.sim.shift(); } catch (e) { sh = null; }
    const shifts = PRO().shifts || [];
    let start, label;
    const def = sh && sh.id ? shifts.find(x => x.id === sh.id) : null;
    if (def) { start = d0 + U.hm(def.start); if (start > now) start -= DAY; label = def.name; }
    else {
      const lastEnd = Math.max(...shifts.map(x => U.hm(x.end)), 0);
      start = d0 + lastEnd; if (start > now) start -= DAY; label = 'Geisterschicht';
    }
    start = Math.max(start, s.startT || 0);
    return { start, label };
  }
  /** Auslastung eines Fahrzeugs = Zeit mit Transportauftrag (Zuteilung bis Abstellen) / Zeit seit Schichtbeginn */
  function vehicleUtil(match, win) {
    const s = S(); const now = s.t; win = win || shiftWindow();
    const span = now - win.start; if (span < 600) return null;
    let busy = 0;
    for (const r of L.tr.values()) {
      if (r.cancelled || !match(r) || r.assignedT == null) continue;
      const a = Math.max(win.start, r.assignedT), b = Math.min(now, r.doneT != null ? r.doneT : now);
      if (b > a) busy += b - a;
    }
    return U.clamp(busy / span, 0, 1);
  }
  function agvUtil(id) { return vehicleUtil(r => r.mode === 'AGV' && r.assignee === id); }
  function forkUtil() { return vehicleUtil(r => r.mode === 'Stapler'); }
  function batteryHistory(id) { return (L.samp[id] || []).filter(x => x.b != null).map(x => ({ t: x.t, v: x.b })); }
  function withdrawnToday(matId) { const s = S(); if (!s || L.wdDay !== Math.floor(s.t / DAY)) return 0; return L.wd[matId] || 0; }

  /** Flüsse heute: Kanten Station → Station (erledigt + laufend), offene Transporte separat, Fremdbearbeitung über Ereignisse */
  function flowsToday() {
    const s = S(); if (!s) return [];
    const d0 = dayStart(s.t);
    const E = new Map();
    const get = (from, to) => {
      const k = from + '>' + to; let e = E.get(k);
      if (!e) E.set(k, e = { key: k, from, to, n: 0, qty: 0, kg: 0, m: 0, bars: 0, live: [], open: [], orders: new Map(), modes: { AGV: 0, Stapler: 0 }, waitSum: 0, waitN: 0, lastT: null, ext: false });
      return e;
    };
    for (const r of L.tr.values()) {
      if (r.cancelled) continue;
      const done = r.status === 'done';
      if (done && !(r.doneT >= d0)) continue;
      const e = get(r.from, r.to);
      if (r.status === 'open') { e.open.push(r); continue; }
      e.n++;
      if (!done) e.live.push(r);
      e.modes[r.mode] = (e.modes[r.mode] || 0) + 1;
      if (r.kind === 'bars') { e.m += r.meters || 0; e.bars++; } else e.qty += r.qty || 0;
      e.kg += r.weightKg || 0;
      if (r.pickupT != null) { e.waitSum += waitOf(r, r.pickupT); e.waitN++; }
      const tt = done ? r.doneT : (r.pickupT || r.createdT);
      if (e.lastT == null || tt > e.lastT) e.lastT = tt;
      const ok = r.kind === 'bars' ? 'bars:' + (r.materialId || '') : (r.orderId || '–');
      const o = e.orders.get(ok) || { key: ok, orderId: r.kind === 'bars' ? null : r.orderId, materialId: r.materialId, partName: r.kind === 'bars' ? matName(r.materialId) : r.partName, n: 0, qty: 0, m: 0, bars: r.kind === 'bars' };
      o.n++; if (r.kind === 'bars') o.m += r.meters || 0; else o.qty += r.qty || 0;
      e.orders.set(ok, o);
    }
    for (const x of L.ext) {
      if (x.t < d0) continue;
      const e = x.type === 'out' ? get('EXT', 'HAERT') : get('HAERT', 'WE');
      e.ext = true; e.n += x.n; e.qty += x.qty; e.kg += x.kg;
      if (e.lastT == null || x.t > e.lastT) e.lastT = x.t;
      const o = e.orders.get(x.orderId || '–') || { key: x.orderId, orderId: x.orderId, partName: x.partName, n: 0, qty: 0, m: 0 };
      o.n += x.n; o.qty += x.qty; e.orders.set(x.orderId || '–', o);
    }
    // Säge: zieht Stangenmaterial direkt aus dem Kragarmregal (keine Transporte) → Entnahmen dieser Materialien heute
    const saw = sawMaterials();
    for (const sid in saw) {
      const mats = [...saw[sid]].map(id => ({ id, name: matName(id), m: withdrawnToday(id) })).filter(x => x.m > 1e-6);
      if (!mats.length) continue;
      const e = get('RAW', sid);
      e.direct = true; e.mats = mats; e.dm = mats.reduce((a, x) => a + x.m, 0);
    }
    return [...E.values()];
  }
  /** Materialien, die eine Säge (erster Arbeitsgang) direkt aus dem Lager zieht: { stationId: Set(materialId) } */
  function sawMaterials() {
    const s = S(), out = {};
    for (const oid in s.orders) {
      const r0 = s.orders[oid].routing[0], st = r0 && STN(r0.station);
      if (st && st.type === 'saw' && r0.material) (out[st.id] || (out[st.id] = new Set())).add(r0.material.id);
    }
    return out;
  }
  const matName = (id) => { const s = S(); const m = s && s.materials[id]; return m ? m.name : (id || 'Stangen'); };

  /** offener Materialbedarf je Material aus den ersten Arbeitsgängen offener Aufträge (noch nicht entnommene Teile × Bedarf je Teil) */
  let DEM = { t: -1e9, real: 0, ver: -1, data: null };
  function invalidate() { DEM.t = -1e9; }
  function demandAll() {
    const s = S(); if (!s) return {};
    const nowR = performance.now();
    if (DEM.data && nowR - DEM.real < 20000 && s.t >= DEM.t && s.t - DEM.t < 300) return DEM.data;
    let fc = null; try { fc = WF.sim.forecast(); } catch (e) { fc = null; }
    const res = {};
    for (const id in s.materials) res[id] = { id, orders: [], need: 0, runoutT: null, coveredT: null };
    // Stangenmagazine / laufende Stangen-Nachschübe decken Bedarf an „ihrer“ Maschine
    const magazine = {};
    for (const mid in s.machines) {
      const m = s.machines[mid];
      if (m.barMat && m.barStockM > 0) magazine[mid + '|' + m.barMat] = (magazine[mid + '|' + m.barMat] || 0) + m.barStockM;
    }
    for (const tid in s.transports) {
      const t = s.transports[tid];
      if (t.kind === 'bars' && t.status !== 'done' && t.meters) magazine[t.to.station + '|' + t.materialId] = (magazine[t.to.station + '|' + t.materialId] || 0) + t.meters;
    }
    const issued = {}; // Rohteile-Behälter (bereits entnommen, noch nicht bearbeitet)
    for (const cid in s.containers) {
      const c = s.containers[cid];
      if (c.kind === 'raw' && c.idx === 0 && (c.state === 'ready' || c.state === 'transit' || c.state === 'input')) issued[c.orderId] = (issued[c.orderId] || 0) + c.qty;
    }
    for (const oid in s.orders) {
      const o = s.orders[oid];
      if (o.status === 'fertig') continue;
      const r0 = o.routing[0];
      if (!r0 || !r0.material || !res[r0.material.id]) continue;
      if (o.ops[0] && o.ops[0].complete) continue;
      const mt = s.materials[r0.material.id], per = r0.material.perPart;
      const left = WF.sim.partsLeft(oid, r0.seq) || 0;
      if (left <= 0) continue;
      let parts = left - (issued[oid] || 0), need;
      const mk = r0.station + '|' + mt.id;
      if (magazine[mk] > 0) {
        need = Math.max(0, parts * per - magazine[mk]);
        const used = Math.min(magazine[mk], parts * per); magazine[mk] -= used;
      } else need = Math.max(0, parts * per);
      if (need <= 1e-9) continue;
      const fo = fc && fc.orders && fc.orders[oid] && fc.orders[oid].ops ? fc.orders[oid].ops[0] : null;
      res[mt.id].orders.push({ orderId: oid, partName: o.part.name, station: r0.station, partsLeft: left, parts: Math.max(0, Math.ceil(need / per - 1e-9)), per, need,
        start: fo ? fo.start : null, end: fo ? fo.end : null, due: o.due, priority: o.priority });
      res[mt.id].need += need;
    }
    // Reichweite: lineare Entnahme über das Prognosefenster des ersten Arbeitsgangs; Lieferungen erhöhen den Bestand zum ETA
    for (const id in res) {
      const R = res[id], mt = s.materials[id];
      R.orders.sort((a, b) => (a.start == null ? 1e15 : a.start) - (b.start == null ? 1e15 : b.start));
      const open = (s.purchases || []).filter(p => p.materialId === id && p.status === 'bestellt');
      R.onOrder = mt.onOrder; R.nextEta = open.length ? Math.min(...open.map(p => p.etaT)) : null;
      R.shortNow = Math.max(0, R.need - mt.onHand);
      R.short = Math.max(0, R.need - mt.onHand - mt.onOrder);
      if (R.need <= mt.onHand + 1e-9) continue;
      // Zeitpunkt, an dem der Bestand (ohne Lieferungen) nicht mehr reicht
      const pts = [];
      for (const x of R.orders) {
        const a = Math.max(s.t, x.start != null ? x.start : s.t), b = Math.max(a + 60, x.end != null ? x.end : a + 3600);
        pts.push({ a, b, need: x.need });
      }
      const stockAt = (T, withDeliveries) => {
        let use = 0;
        for (const p of pts) { if (T <= p.a) continue; use += p.need * Math.min(1, (T - p.a) / (p.b - p.a)); }
        let inc = 0; if (withDeliveries) for (const pu of open) if (pu.etaT <= T) inc += pu.qty;
        return mt.onHand + inc - use;
      };
      const tEnd = Math.max(...pts.map(p => p.b));
      const find = (withD) => {
        if (stockAt(tEnd, withD) >= -1e-9) return null;
        let lo = s.t, hi = tEnd;
        for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (stockAt(mid, withD) >= 0) lo = mid; else hi = mid; }
        return hi;
      };
      R.runoutT = find(false);
      R.gapT = open.length ? find(true) : R.runoutT; // auch mit Lieferungen nicht gedeckt ab …
    }
    DEM = { t: s.t, real: nowR, data: res };
    return res;
  }
  function demand(matId) { const d = demandAll(); return d[matId] || null; }

  function nextPurchase(matId) {
    const s = S(); let best = null;
    for (const p of s.purchases || []) if (p.materialId === matId && p.status === 'bestellt' && (!best || p.etaT < best.etaT)) best = p;
    return best;
  }
  /** Ort eines Fahrzeugs als Text („an der Ladestation“, „Hauptgang bei INDEX G220“) */
  function placeText(pos) {
    if (!pos) return '–';
    const P = PRO();
    let best = null, bd = 1e9;
    for (const st of P.stations) {
      for (const p of [st.dock, st.work, st.inPos, st.outPos]) { if (!p) continue; const d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; best = st; } }
    }
    if (best && bd < 2.6) return best.id === 'CHG' ? 'an der Ladestation' : 'an ' + (best.short || best.name);
    let lineName = null, ld = 1e9;
    const NAMES = { back: 'hinterer Quergang', main: 'Hauptgang', front: 'vorderer Quergang', vl: 'Längsgang links', vr: 'Längsgang rechts', vm: 'Längsgang Mitte' };
    for (const Ln of (P.graph.lines || [])) {
      const d = Ln.axis === 'x' ? (pos.x >= Ln.a - 1 && pos.x <= Ln.b + 1 ? Math.abs(pos.z - Ln.c) : 1e9) : (pos.z >= Ln.a - 1 && pos.z <= Ln.b + 1 ? Math.abs(pos.x - Ln.c) : 1e9);
      if (d < ld) { ld = d; lineName = NAMES[Ln.id] || 'Gang'; }
    }
    return (lineName || 'Halle') + (best ? ' bei ' + (best.short || best.name) : '');
  }
  /** Fortschritt (0..1) eines Fahrzeugs auf dem Weg von Station A nach B (Projektion auf das Wegenetz) */
  const ROUTE = new Map();
  function routeOf(from, to) {
    const k = from + '>' + to; let r = ROUTE.get(k);
    if (r) return r;
    const P = PRO(), a = STN(from), b = STN(to);
    if (!a || !b) return null;
    const path = U.path(P.graph, a.dockNode, b.dockNode);
    const pts = [a.outPos || a.dock].concat(path.points || []).concat([b.inPos || b.dock]);
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    r = { pts, cum, len: cum[cum.length - 1] || 1 };
    ROUTE.set(k, r);
    return r;
  }
  function routeProgress(from, to, pos) {
    const r = routeOf(from, to); if (!r || !pos) return 0;
    let best = 0, bd = 1e9;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      let k = L2 > 1e-9 ? ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / L2 : 0; k = U.clamp(k, 0, 1);
      const px = a.x + dx * k, pz = a.z + dz * k, d = Math.hypot(pos.x - px, pos.z - pz);
      if (d < bd - 1e-6) { bd = d; best = (r.cum[i - 1] + Math.sqrt(L2) * k) / r.len; }
    }
    return U.clamp(best, 0, 1);
  }
  function carrierPos(r) {
    const s = S();
    if (r.mode === 'AGV') { const a = s.agvs[r.assignee]; return a ? a.pos : null; }
    return s.forklift ? s.forklift.pos : null;
  }
  /** feinerer Status eines laufenden Transports (AGV be-/entlädt) */
  function trStatusLabel(r) {
    const s = S();
    if (r.cancelled) return 'Entfallen';
    if (r.mode === 'AGV' && r.assignee && r.status !== 'done') {
      const a = s.agvs[r.assignee];
      if (a && a.task === r.id) { if (a.state === 'loading') return 'Wird beladen'; if (a.state === 'unloading') return 'Wird entladen'; }
    }
    if (r.status === 'assigned' && r.mode === 'Stapler') return 'Fahrer:in geht zum Stapler';
    if (r.status === 'open') return isPlanned(r) ? 'Vorgemerkt' : r.kind === 'empty' ? 'Wartet (Leergut)' : 'Wartet auf Abholung';
    return lbl('transport', r.status);
  }
  /** Phase eines Transports (Engine §7.5, feature-detected): 'geplant' (Ziel voll – Behälter bereitgestellt und vorgemerkt,
      keine Wartezeit), 'wartend' (fällig, Fahrzeug/Fahrer:in fehlt), 'unterwegs', 'erledigt'. Ohne phase-Feld aus waitCode/Text. */
  function phaseOf(t) {
    if (!t) return null;
    if (t.status === 'done') return 'erledigt';
    if (t.status && t.status !== 'open') return 'unterwegs';
    const ph = t.phase;
    if (ph === 'geplant' || ph === 'bereitgestellt' || ph === 'vorgemerkt') return 'geplant';
    if (ph === 'wartend') return 'wartend';
    if (t.waitCode === 'destFull') return 'geplant';
    if (t.waitCode == null && /Zielpuffer|Ziel voll/.test(t.waitReason || '')) return 'geplant';
    return 'wartend';
  }
  /** Zeitpunkt, ab dem ein Transport fällig ist – falls die Engine ihn liefert (Feldnamen tolerant), sonst null */
  function engineDueT(t) {
    for (const k of ['dueT', 'dueSince', 'waitFromT', 'waitSince']) if (typeof t[k] === 'number') return t[k];
    return null;
  }
  const isPlanned = (r) => !!r && r.status === 'open' && phaseOf(r) === 'geplant';
  /** Beginn der Logistik-Wartezeit (fällig seit) – vorgemerkte Zeit mit vollem Ziel zählt nicht */
  const waitStart = (r) => (r.dueT != null ? r.dueT : r.createdT);
  /** Logistik-Wartezeit: fällig → Abholung (bzw. → jetzt); vorgemerkte Transporte haben keine Wartezeit */
  function waitOf(r, now) { if (r.pickupT == null && isPlanned(r)) return 0; return Math.max(0, (r.pickupT != null ? r.pickupT : now) - waitStart(r)); }
  /** Zeit, die ein Transport vorgemerkt war (Ziel voll), bevor er fällig wurde */
  const plannedSec = (r, now) => (r.everPlanned ? Math.max(0, (r.dueT != null ? r.dueT : r.pickupT != null ? r.pickupT : now) - r.createdT) : 0);
  /** Grund eines vorgemerkten Transports, ohne Doppelung mit „bereitgestellt“ (Engine: 'bereitgestellt – Abruf, sobald INDEX G220
      Platz hat (ca. 09:01)'; ältere Fassung: 'Ziel voll (Zielpuffer INDEX G220 3/3)') */
  function planReason(w) {
    w = String(w || '').replace(/^bereitgestellt(\s+im Pufferlager)?\s*[–-]\s*/, (m, p) => (p ? 'im Pufferlager – ' : ''));
    if (!w) return 'Ziel voll – Abruf, sobald dort Platz ist';
    w = w.charAt(0).toUpperCase() + w.slice(1);
    return /sobald/.test(w) ? w : w + ' – Abruf, sobald dort Platz ist';
  }
  /** Ledger-Satz zu einem Engine-Transport (für fällig-seit) */
  const recOf = (t) => L.tr.get(t.id) || { id: t.id, createdT: t.createdT, status: t.status, phase: phaseOf(t), pickupT: t.pickupT, dueT: engineDueT(t) };
  const whyShort = (w) => String(w || '');
  const whyTiny = (w) => { w = String(w || ''); return w.indexOf('Zielpuffer') >= 0 ? 'Ziel voll' : w.indexOf('kein AGV') >= 0 ? 'kein AGV frei' : w.indexOf('Stapler') >= 0 ? 'Stapler' : w; };

  // ================================================================== CSS (Präfix .mt-)
  WF.ui.css(`
  .mt-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .mt-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 18px;flex-wrap:wrap}
  .mt-head .view-h{margin:0;flex:1 1 340px;min-width:0}
  .mt-head .view-sub{max-width:56ch}
  .mt-lage{display:flex;align-items:stretch;background:var(--card);border:1px solid var(--line);border-radius:var(--r);min-width:0;flex-wrap:wrap}
  .mt-lg{display:flex;align-items:center;gap:10px;padding:8px 14px;min-width:0;cursor:default}
  .mt-lg > div{min-width:0}
  .mt-lg b{overflow:hidden;text-overflow:ellipsis}
  .mt-lg + .mt-lg{border-left:1px solid var(--line)}
  .mt-lg .eyebrow{display:block;font-size:var(--fs-2xs);margin-bottom:3px}
  .mt-lg b{display:block;font-weight:600;font-size:var(--fs-md);white-space:nowrap}
  .mt-lg small{display:block;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
  .mt-lg .ico{color:var(--c,var(--muted));flex:none}
  .mt-lg.click{cursor:pointer}
  .mt-lg.click:hover b{text-decoration:underline;text-underline-offset:2px}

  .mt-kpis{display:grid;gap:10px;grid-template-columns:repeat(6,minmax(0,1fr))}
  .mt-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .mt-kpis .kpi .s .mt-plan{color:var(--text2);white-space:nowrap}
  .mt-kpis .kpi .s .mt-plan::before{content:"";display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:2px;border:1.4px solid var(--muted);vertical-align:0}
  .mt-kpis .kpi.click{cursor:pointer}
  .mt-kpis .kpi.click:hover{border-color:var(--line2)}
  .mt-kpis .kpi .viz{height:30px;display:flex;align-items:flex-end}
  .mt-kpis .kpi .viz:empty{display:none}
  .mt-kpis .kpi .viz svg{display:block;width:100%;height:28px;overflow:visible}
  .mt-kbar{display:flex;gap:4px;width:100%;align-items:flex-end;padding-bottom:3px}
  .mt-kbar span{flex:1;height:5px;border-radius:3px;background:var(--track);overflow:hidden;position:relative}
  .mt-kbar span i{position:absolute;inset:0 auto 0 0;background:var(--c,var(--text2));border-radius:3px;transition:width .4s ease}

  .mt-card-h{display:flex;align-items:center;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--line)}
  .mt-card-h h3{margin:0;font:600 var(--fs-lg)/1.2 var(--f-ui);letter-spacing:.005em}
  .mt-card-h .mt-hs{font-size:var(--fs-sm);color:var(--muted);margin-top:3px}
  .mt-card-h .mt-hs b{color:var(--text2);font-weight:600}
  .mt-card-h .row{gap:8px}
  .mt-live{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--mat) 35%,var(--line));background:color-mix(in srgb,var(--mat) 8%,transparent);font-size:var(--fs-sm);font-weight:600;color:var(--text2);white-space:nowrap}
  .mt-live i{width:7px;height:7px;border-radius:50%;background:var(--mat);box-shadow:0 0 0 0 color-mix(in srgb,var(--mat) 60%,transparent);animation:mtPing 1.6s ease-out infinite}
  .mt-live.idle{border-color:var(--line);background:transparent;color:var(--muted)}
  .mt-live.idle i{background:var(--st-idle);animation:none}
  @keyframes mtPing{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--mat) 55%,transparent)}100%{box-shadow:0 0 0 7px color-mix(in srgb,var(--mat) 0%,transparent)}}

  /* ---------- Fluss-Diagramm */
  .mt-flow{overflow:hidden;container:mtflow / inline-size}
  .mt-fwrap{position:relative}
  .mt-fscroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
  .mt-fscroll.fr{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 56px),transparent)}
  .mt-fscroll.fl{-webkit-mask-image:linear-gradient(90deg,transparent,#000 56px);mask-image:linear-gradient(90deg,transparent,#000 56px)}
  .mt-fscroll.fl.fr{-webkit-mask-image:linear-gradient(90deg,transparent,#000 56px,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(90deg,transparent,#000 56px,#000 calc(100% - 56px),transparent)}
  .mt-fin{position:relative;padding:6px 8px 4px}
  .mt-swipe{position:absolute;right:12px;top:12px;z-index:3;display:none;align-items:center;gap:7px;height:30px;padding:0 12px 0 10px;border-radius:999px;border:1px solid var(--line2);background:color-mix(in srgb,var(--panel) 90%,transparent);box-shadow:0 6px 18px rgba(0,0,0,.35);font-size:var(--fs-sm);font-weight:600;color:var(--text2);pointer-events:none;transition:opacity .25s ease}
  .mt-swipe .ico{color:var(--mat)}
  .mt-flow.scrolls .mt-swipe{display:inline-flex}
  .mt-flow.swiped .mt-swipe{opacity:0}
  .mt-svg{display:block;width:100%;height:auto;user-select:none;-webkit-user-select:none}
  .mt-svg text{font-family:var(--f-ui)}
  .mt-floor{fill:var(--bg2);stroke:var(--line2);stroke-width:1.2}
  .mt-wall{fill:none;stroke:var(--muted);stroke-width:2.2;stroke-linecap:round;opacity:.55}
  .mt-door{font:600 var(--fs-xs) var(--f-ui);letter-spacing:.08em;fill:var(--faint);text-transform:uppercase}
  .mt-doorm{stroke:var(--faint);stroke-width:1;stroke-dasharray:2 3}
  .mt-aisle{fill:none;stroke:color-mix(in srgb,var(--line) 70%,var(--bg2));stroke-width:10;stroke-linecap:round;stroke-linejoin:round}
  .mt-aisle-c{fill:none;stroke:color-mix(in srgb,var(--line2) 65%,transparent);stroke-width:.8;stroke-dasharray:5 7}
  .mt-room{fill:color-mix(in srgb,var(--card) 50%,transparent);stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}
  .mt-room-t{font:600 var(--fs-xs) var(--f-ui);letter-spacing:.08em;fill:var(--faint);text-transform:uppercase}
  .mt-fp{fill:color-mix(in srgb,var(--line) 32%,transparent);stroke:color-mix(in srgb,var(--line) 80%,transparent);stroke-width:.8}
  .mt-area{font:600 var(--fs-xs) var(--f-ui);letter-spacing:.12em;fill:color-mix(in srgb,var(--faint) 85%,transparent);text-transform:uppercase}
  .mt-ext-band{fill:none;stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}
  .mt-ext-t{font:600 var(--fs-xs) var(--f-ui);letter-spacing:.12em;fill:var(--faint);text-transform:uppercase}

  .mt-e{cursor:pointer;transition:opacity .2s ease}
  .mt-e .g{fill:none;stroke:var(--mat);opacity:0;stroke-linecap:round}
  .mt-e .b{fill:none;stroke:var(--mat);opacity:.46;stroke-linecap:round;transition:opacity .2s ease}
  .mt-e .f{fill:none;stroke:color-mix(in srgb,var(--mat) 40%,white);opacity:.28;stroke-linecap:round;stroke-dasharray:1.2 13;animation:mtFlow 2.8s linear infinite}
  .mt-e .a{fill:var(--mat);opacity:.75}
  .mt-e.recent .b{opacity:.62}
  .mt-e.recent .f{opacity:.6}
  .mt-e .h{fill:none;stroke:transparent;pointer-events:stroke}
  .mt-e.ext .b{stroke:var(--ext);stroke-dasharray:7 5;opacity:.6}
  .mt-e.ext .a{fill:var(--ext)}
  .mt-e.ext .g{stroke:var(--ext)}
  .mt-e.ext .f{display:none}
  .mt-e.pend .b{stroke:var(--mat);stroke-dasharray:3 5;opacity:.55}
  .mt-e.pend .a{fill:var(--mat);opacity:.6}
  .mt-e.pend .g,.mt-e.pend .f{display:none}
  .mt-e.pend.plan .b{stroke:color-mix(in srgb,var(--text2) 55%,transparent);opacity:.5}
  .mt-e.pend.plan .a{fill:color-mix(in srgb,var(--text2) 60%,transparent)}
  .mt-e.direct .b{stroke-dasharray:1.5 5;opacity:.75}
  .mt-e.direct .g,.mt-e.direct .f{display:none}
  .mt-el.direct rect{stroke-dasharray:2 2}
  .mt-e.live .b{opacity:.85}
  .mt-e.live .g{opacity:.14}
  .mt-e.live .a{opacity:1}
  .mt-e.live .f{opacity:1;animation-duration:.9s;stroke-dasharray:2 10}
  @keyframes mtFlow{to{stroke-dashoffset:-14.2}}
  .mt-el{pointer-events:none}
  .mt-el rect{fill:var(--card);stroke:color-mix(in srgb,var(--mat) 45%,var(--line2));stroke-width:1}
  .mt-el text{font:700 var(--fs-sm) var(--f-cond);fill:var(--text);letter-spacing:.02em}
  .mt-el.pend rect{stroke:color-mix(in srgb,var(--mat) 45%,var(--line2));stroke-dasharray:3 2}
  .mt-el.pend text{fill:color-mix(in srgb,var(--mat) 75%,var(--text))}
  .mt-el.ext rect{stroke:color-mix(in srgb,var(--ext) 50%,var(--line2));stroke-dasharray:3 2}
  .mt-el.pend.plan rect{stroke:var(--line2)}
  .mt-el.pend.plan text{fill:var(--text2)}

  .mt-node{cursor:pointer;transition:opacity .2s ease}
  .mt-node .bg{fill:var(--card2);stroke:var(--line2);stroke-width:1.1;transition:stroke .15s ease}
  .mt-node:hover .bg,.mt-node.on .bg{stroke:color-mix(in srgb,var(--accent) 65%,var(--line2))}
  .mt-node.wait .bg{stroke:color-mix(in srgb,var(--st-wait) 55%,var(--line2))}
  .mt-node.fault .bg{fill:color-mix(in srgb,var(--st-fault) 14%,var(--card2));stroke:color-mix(in srgb,var(--st-fault) 70%,var(--line2))}
  .mt-node.store .bg{fill:color-mix(in srgb,var(--card) 92%,var(--mat))}
  .mt-node.partner .bg{fill:color-mix(in srgb,var(--ext) 7%,var(--card));stroke:color-mix(in srgb,var(--ext) 45%,var(--line2));stroke-dasharray:4 3}
  .mt-node.charge .bg{fill:transparent;stroke:color-mix(in srgb,var(--st-setup) 40%,var(--line2));stroke-dasharray:3 3}
  .mt-node.sel .bg{stroke:var(--accent);stroke-width:1.8}
  .mt-node .t{font:600 var(--fs-md) var(--f-cond);fill:var(--text);letter-spacing:.01em}
  .mt-node .id{font:500 var(--fs-xs) var(--f-mono);fill:var(--muted)}
  .mt-node .sub{font:500 var(--fs-xs) var(--f-ui);fill:var(--muted)}
  .mt-node .sub.warn{fill:color-mix(in srgb,var(--st-wait) 85%,var(--text))}
  .mt-node .sub.crit{fill:color-mix(in srgb,var(--st-fault) 85%,var(--text))}
  .mt-node .sub.ok{fill:color-mix(in srgb,var(--st-run) 70%,var(--text2))}
  .mt-node .ic{color:var(--mat)}
  .mt-node.partner .ic{color:var(--ext)}
  .mt-node.charge .ic{color:var(--st-setup)}
  .mt-node .sd{fill:var(--c,var(--st-idle))}
  .mt-node .sdh{fill:var(--c,var(--st-idle));opacity:0}
  .mt-node.run .sdh{animation:mtSd 1.8s ease-out infinite}
  @keyframes mtSd{0%{opacity:.5;r:3.5}100%{opacity:0;r:8}}
  .mt-node .pip{fill:var(--track);stroke:color-mix(in srgb,var(--line2) 90%,transparent);stroke-width:.8}
  .mt-node .pip.on{fill:color-mix(in srgb,var(--text2) 70%,transparent);stroke:none}
  .mt-node .pip.rd{fill:var(--mat);stroke:none}
  .mt-node .pip.fl{fill:transparent;stroke:var(--mat);stroke-width:1}
  .mt-node .pip.full{fill:var(--st-wait);stroke:none}
  .mt-node .pipt{font:600 var(--fs-xs) var(--f-ui);fill:var(--faint);letter-spacing:.06em}
  .mt-node .pipn{font:600 var(--fs-xs) var(--f-ui);fill:var(--text2)}
  .mt-node .bdg{display:none}
  .mt-node .bdg circle{fill:var(--mat);stroke:var(--card);stroke-width:2}
  .mt-node .bdg text{font:700 var(--fs-xs) var(--f-ui);fill:color-mix(in srgb,var(--mat) 14%,black)}
  .mt-node.haswait .bdg{display:block}
  .mt-node.hasplan .bdg{display:block}
  .mt-node.hasplan .bdg circle{fill:var(--raise);stroke:var(--card)}
  .mt-node.hasplan .bdg text{fill:var(--text2)}
  .mt-node .pk{fill:none;stroke:var(--info);stroke-width:1.5;opacity:0}
  .mt-node.pick .pk{animation:mtPick 1.4s ease-out infinite}
  @keyframes mtPick{0%{opacity:.85;stroke-width:3}100%{opacity:0;stroke-width:9}}
  .mt-e.pinned .b{opacity:.95;stroke:color-mix(in srgb,var(--mat) 80%,white)}
  .mt-e.pinned .g{opacity:.22}
  .mt-el.pinned rect{stroke:var(--accent);stroke-width:1.5}
  .mt-node.pinned .bg{stroke:var(--accent);stroke-width:1.6}
  .mt-svg.hl .mt-e:not(.on){opacity:.12}
  .mt-svg.hl .mt-el:not(.on){opacity:.15}
  .mt-svg.hl .mt-node:not(.on){opacity:.42}
  .mt-svg.hl .mt-e.on .b{opacity:.95}

  .mt-veh .vb{fill:color-mix(in srgb,var(--c) 26%,var(--card2));stroke:var(--c);stroke-width:1.4}
  .mt-veh .vf{fill:var(--c)}
  .mt-veh .vk{stroke:var(--c);stroke-width:1.6;stroke-linecap:round}
  .mt-veh .vl{fill:var(--mat);stroke:color-mix(in srgb,var(--mat) 50%,black);stroke-width:.6}
  .mt-veh .vt{font:700 var(--fs-xs) var(--f-ui);fill:var(--text2);letter-spacing:.04em;paint-order:stroke;stroke:var(--bg2);stroke-width:3px;stroke-linejoin:round}
  .mt-veh .vh{fill:transparent}
  .mt-veh{cursor:pointer}
  .mt-veh .vg{fill:var(--c);opacity:0}
  .mt-veh.moving .vg{opacity:.18}
  .mt-dot .h{fill:var(--mat);opacity:.22}
  .mt-dot .c{fill:color-mix(in srgb,var(--mat) 55%,white);stroke:var(--mat);stroke-width:2}
  .mt-dot{pointer-events:none}
  .mt-pulse{pointer-events:none}
  .mt-pulse .pl{fill:none;stroke:var(--info);stroke-width:1.4;stroke-dasharray:3 4;opacity:.85}
  .mt-pulse .pc{fill:var(--info);filter:drop-shadow(0 0 4px var(--info))}
  .mt-pulse .pt rect{fill:color-mix(in srgb,var(--info) 16%,var(--panel));stroke:color-mix(in srgb,var(--info) 55%,transparent)}
  .mt-pulse .pt text{font:600 var(--fs-xs) var(--f-ui);fill:color-mix(in srgb,var(--info) 70%,white)}

  .mt-tip{position:absolute;z-index:5;pointer-events:none;min-width:220px;max-width:320px;background:var(--panel);border:1px solid var(--line2);border-radius:10px;box-shadow:var(--shadow);padding:10px 12px;font-size:var(--fs-sm);color:var(--text2);line-height:1.45}
  .mt-tip .tt{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text);font-size:var(--fs-md);margin-bottom:4px}
  .mt-tip .tt .ico{color:var(--mat);flex:none}
  .mt-tip .tk{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:6px 0 2px}
  .mt-tip .tk dt{color:var(--muted)}
  .mt-tip .tk dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums}
  .mt-tip .tl{margin-top:6px;border-top:1px solid var(--line);padding-top:6px;display:flex;flex-direction:column;gap:3px}
  .mt-tip .tl div{display:flex;gap:8px;justify-content:space-between}
  .mt-tip .tl span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .mt-tip .tl b{font-weight:600;color:var(--text);white-space:nowrap;font-variant-numeric:tabular-nums}
  .mt-tip .hint{margin-top:6px;font-size:var(--fs-xs);color:var(--faint)}
  .mt-tip .mono{font-size:var(--fs-xs)}
  .mt-empty{position:absolute;left:50%;top:48.5%;transform:translate(-50%,-50%);background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line2);border-radius:10px;padding:12px 16px;text-align:center;font-size:var(--fs-sm);color:var(--text2);max-width:360px;pointer-events:none}
  .mt-empty b{display:block;color:var(--text);font-size:var(--fs-md);margin-bottom:2px}
  .mt-empty{padding:9px 16px;line-height:1.4}

  .mt-ffoot{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:0;border-top:1px solid var(--line)}
  .mt-ffoot > div{padding:11px 14px;min-width:0}
  .mt-ffoot > div + div{border-left:1px solid var(--line)}
  .mt-ffoot .eyebrow{margin-bottom:8px;display:flex;align-items:center;gap:8px}
  .mt-ffoot .eyebrow .spacer{flex:1}
  .mt-ffoot .eyebrow .hint{letter-spacing:0;text-transform:none;font-weight:500;color:var(--faint);font-size:var(--fs-xs)}
  .mt-toptg{display:none;align-items:center;gap:4px;height:40px;margin:-14px -4px -14px 0;padding:0 4px;border:0;background:transparent;color:var(--accent);font:600 var(--fs-xs)/1 var(--f-ui);letter-spacing:0;text-transform:none;cursor:pointer}
  .mt-toptg .ico{transition:transform .18s ease}
  .mt-topwrap.open .mt-toptg .ico{transform:rotate(90deg)}
  .mt-bil{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .mt-bil div{min-width:0}
  .mt-bil b{display:block;font:600 var(--fs-xl)/1.1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-bil b small{font-size:var(--fs-sm);color:var(--muted);font-weight:500;margin-left:2px}
  .mt-bil span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-modes{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--track);margin:10px 0 5px}
  .mt-modes i{display:block;height:100%}
  .mt-modes-l{display:flex;gap:12px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted)}
  .mt-modes-l span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .mt-modes-l i{width:8px;height:8px;border-radius:2px;background:var(--c)}
  .mt-modes-l b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}
  .mt-svc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line)}
  .mt-svc div{min-width:0}
  .mt-svc b{display:block;font:600 var(--fs-lg)/1.15 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-svc b small{font:500 var(--fs-xs) var(--f-ui);color:var(--muted);margin-left:2px}
  .mt-svc b.warn{color:color-mix(in srgb,var(--st-wait) 90%,var(--text))}
  .mt-svc b.ok{color:color-mix(in srgb,var(--st-run) 85%,var(--text))}
  .mt-svc span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-top{display:flex;flex-direction:column;gap:3px}
  .mt-topr{display:grid;grid-template-columns:minmax(0,1fr) 110px 54px;align-items:center;gap:10px;padding:4px 6px;margin:0 -6px;border-radius:6px;cursor:pointer;font-size:var(--fs-sm);border:0;background:transparent;color:inherit;text-align:left;width:calc(100% + 12px)}
  .mt-topr:hover,.mt-topr.on{background:color-mix(in srgb,var(--raise) 55%,transparent)}
  .mt-topr .rel{display:flex;align-items:center;gap:5px;min-width:0;white-space:nowrap;overflow:hidden}
  .mt-topr .rel span{overflow:hidden;text-overflow:ellipsis}
  .mt-topr .rel .ico{color:var(--faint);flex:none}
  .mt-topr .bar{height:5px;--c:var(--mat)}
  .mt-topr b{font-weight:600;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-legbar{display:none;align-items:center;gap:8px;padding:2px 14px 10px}
  .mt-legbar button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--line2);background:transparent;color:var(--text2);font-size:var(--fs-sm);font-weight:600;cursor:pointer}
  .mt-legbar button .ico{color:var(--muted);transition:transform .2s ease}
  .mt-flow.legopen .mt-legbar button .ico{transform:rotate(90deg)}
  .mt-legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:4px 14px 11px;font-size:var(--fs-xs);color:var(--muted)}
  .mt-legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .mt-legend svg{flex:none;overflow:visible}
  /* Hallenplan skaliert mit der Kartenbreite (viewBox 1200) – unter 1100 px wischbar statt kleiner, damit SVG-Beschriftungen ≥ 10,5 px bleiben */
  @container mtflow (max-width:1100px){ .mt-fin{min-width:1216px} }
  @container mtflow (max-width:640px){
    .mt-legend{display:none;flex-direction:column;gap:7px;padding:2px 14px 12px}
    .mt-flow.legopen .mt-legend{display:flex}
    .mt-legbar{display:flex}
  }

  /* ---------- Flotte */
  .mt-fleetsec{container:mtfleet / inline-size}
  .mt-fleet{display:grid;gap:10px;grid-template-columns:repeat(3,minmax(0,1fr))}
  @container mtfleet (max-width:820px){ .mt-fleet{grid-template-columns:repeat(2,minmax(0,1fr))} .mt-fleet > .mt-vc:nth-child(3):last-child{grid-column:1/-1} }
  .mt-vc{--c:var(--st-idle);position:relative;display:flex;flex-direction:column;gap:10px;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;min-width:0;box-shadow:inset 3px 0 0 var(--c);transition:border-color .15s ease,background-color .15s ease;text-align:left;color:inherit;font:inherit}
  .mt-vc:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 50%,var(--card))}
  .mt-vc.sel{border-color:color-mix(in srgb,var(--accent) 70%,transparent)}
  .mt-vc-h{display:flex;align-items:center;gap:10px;min-width:0}
  .mt-vc-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--c) 14%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 35%,transparent);color:color-mix(in srgb,var(--c) 80%,var(--text));flex:none}
  .mt-vc-n{min-width:0;flex:1}
  .mt-vc-n b{display:block;font:600 var(--fs-xl)/1.1 var(--f-cond);letter-spacing:.01em}
  .mt-vc-n span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-vc .pill{flex:none}
  .mt-vc-b{display:grid;grid-template-columns:62px minmax(0,1fr);gap:12px;align-items:center;min-height:66px}
  .mt-gauge{position:relative;width:62px;height:62px}
  .mt-gauge svg{display:block}
  .mt-gauge .gt{fill:none;stroke:var(--track);stroke-width:6}
  .mt-gauge .gv{fill:none;stroke:var(--gc);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .5s ease,stroke .3s ease}
  .mt-gauge .gl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
  .mt-gauge .gl b{font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums}
  .mt-gauge .gl span{font-size:var(--fs-2xs);color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-top:2px;display:flex;align-items:center;gap:2px}
  .mt-gauge.chg .gv{animation:mtChg 1.6s ease-in-out infinite}
  @keyframes mtChg{50%{opacity:.55}}
  .mt-gauge .gl .ico{color:var(--st-setup)}
  .mt-vc-task{min-width:0;display:flex;flex-direction:column;gap:3px}
  .mt-vc-task .eyebrow{font-size:var(--fs-2xs)}
  .mt-vc-rel{display:flex;align-items:center;gap:6px;font-weight:600;font-size:var(--fs-md);min-width:0;white-space:nowrap}
  .mt-vc-rel span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .mt-vc-rel .ico{color:var(--faint);flex:none}
  .mt-vc-cargo{font-size:var(--fs-sm);line-height:1.38;color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.76em}
  .mt-vc-cargo.muted{color:var(--muted)}
  .mt-route{position:relative;height:14px;margin-top:3px}
  .mt-route .ln{position:absolute;left:5px;right:5px;top:6px;height:2px;border-radius:1px;background:var(--track)}
  .mt-route .pr{position:absolute;left:5px;top:6px;height:2px;border-radius:1px;background:var(--mat);transition:width .3s linear}
  .mt-route .e{position:absolute;top:2px;width:10px;height:10px;border-radius:50%;border:2px solid var(--line2);background:var(--card)}
  .mt-route .e.a{left:0;border-color:var(--mat)}
  .mt-route .e.b{right:0}
  .mt-route .vm{position:absolute;top:1px;width:12px;height:12px;margin-left:-1px;border-radius:3px;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 25%,transparent);transition:left .3s linear}
  .mt-vc-f{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--line);padding-top:9px}
  .mt-vc-f div{min-width:0}
  .mt-vc-f b{display:block;font:600 var(--fs-lg)/1.1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-vc-f span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-fk-ava{--c:var(--st-idle);width:54px;height:54px;margin:0 auto;border-radius:50%;display:grid;place-items:center;font:600 var(--fs-xl)/1 var(--f-cond);letter-spacing:.03em;color:var(--text);background:color-mix(in srgb,var(--c) 13%,var(--bg2));border:2px solid color-mix(in srgb,var(--c) 60%,transparent)}
  .mt-fk-ava.none{color:var(--faint);border-style:dashed}
  .mt-drv{display:flex;align-items:center;gap:8px;min-width:0}
  .mt-drv .avatar{width:28px;height:28px}
  .mt-drv b{font-weight:600;font-size:var(--fs-md)}
  .mt-drv span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* ---------- Tabellen */
  .mt-tbl td{vertical-align:middle}
  .mt-tbl .mt-s{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;margin-top:1px}
  .mt-tbl .mt-s.warn{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))}
  .mt-tbl .mt-s.crit{color:color-mix(in srgb,var(--st-fault) 85%,var(--text))}
  .mt-tbl .mt-s.ok{color:color-mix(in srgb,var(--st-run) 75%,var(--text2))}
  .mt-tbl b{font-weight:600}
  .mt-tbl .nw{white-space:nowrap}
  .mt-tbl tr.sel td{background:color-mix(in srgb,var(--accent) 9%,transparent)}
  .mt-tbl tr.done td{color:var(--text2)}
  .mt-tbl tr.done td .mono{color:var(--muted)}
  .mt-tbl tr.sep td{padding:7px 10px 5px;background:color-mix(in srgb,var(--bg2) 60%,transparent);font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)}
  .mt-tbl td.st{width:4px;padding:0;box-shadow:inset 3px 0 0 var(--c)}
  .mt-rel{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .mt-trid{font-size:var(--fs-xs);color:var(--text2)}
  .mt-trt .mt-why{max-width:230px}
  .mt-rel .ico{color:var(--faint)}
  .mt-mode{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);font-weight:600;padding:2px 7px;border-radius:6px;border:1px solid var(--line);background:var(--card2);color:var(--text2);white-space:nowrap}
  .mt-mode .ico{color:var(--muted)}
  .mt-mode.stp{border-color:color-mix(in srgb,var(--mat) 35%,var(--line))}
  .mt-mode.stp .ico{color:var(--mat)}
  .mt-w{font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-w.warn{color:color-mix(in srgb,var(--st-wait) 90%,var(--text))}
  .mt-w.crit{color:color-mix(in srgb,var(--st-fault) 90%,var(--text))}
  .mt-w.mt-wplan{color:var(--text2)}
  .mt-planpill{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 7px;border-radius:999px;font-size:var(--fs-xs);font-weight:600;line-height:18px;white-space:nowrap;color:var(--text2);border:1px dashed var(--line2);background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .mt-planpill::before{content:"";width:7px;height:7px;border-radius:2px;border:1.4px solid var(--muted);flex:none;box-sizing:border-box}
  .mt-tbl tr.plan td{color:var(--text2)}
  .mt-why{font-size:var(--fs-sm);color:var(--text2);max-width:260px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .mt-why.muted{color:var(--faint)}
  .mt-filt{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 10%,transparent);font-size:var(--fs-sm);font-weight:600;white-space:nowrap}
  .mt-filt button{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:0;background:transparent;color:var(--text2);cursor:pointer}
  .mt-filt button:hover{background:var(--raise)}
  .mt-more{display:flex;justify-content:center;padding:8px;border-top:1px solid var(--line)}
  .mt-tbl .lnk{background:none;border:0;padding:0;color:var(--text);cursor:pointer;font:inherit;text-align:left}
  .mt-tbl .lnk:hover{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
  .mt-tbl .lnk.mono{font-family:var(--f-mono)}

  .mt-stock{display:flex;flex-direction:column;gap:5px;min-width:170px}
  .mt-stock-n{display:flex;align-items:baseline;gap:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .mt-stock-n b{font:600 var(--fs-lg)/1 var(--f-cond)}
  .mt-stock-n span{font-size:var(--fs-xs);color:var(--muted)}
  .mt-sbar{position:relative;height:8px;border-radius:4px;background:var(--track);overflow:visible}
  .mt-sbar .hv{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--c)}
  .mt-sbar .inc{position:absolute;top:0;bottom:0;border-radius:0 4px 4px 0;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--info) 55%,transparent) 0 3px,transparent 3px 6px);border:1px solid color-mix(in srgb,var(--info) 55%,transparent);border-left:0}
  .mt-sbar .mn{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text)}
  .mt-sbar .mn::after{content:"";position:absolute;top:-3px;left:-2px;border:3px solid transparent;border-top-color:var(--text)}
  .mt-form{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);color:var(--text2);white-space:nowrap}
  .mt-form .ico{color:var(--muted)}
  .mt-rw{display:flex;flex-direction:column;gap:1px;min-width:140px}
  .mt-rw b{white-space:nowrap}
  .mt-rw b.ok{color:color-mix(in srgb,var(--st-run) 80%,var(--text))}
  .mt-rw b.warn{color:color-mix(in srgb,var(--st-wait) 90%,var(--text))}
  .mt-rw b.crit{color:color-mix(in srgb,var(--st-fault) 90%,var(--text))}
  .mt-rw b.muted{color:var(--muted);font-weight:500}
  .mt-tbl .bsp{color:var(--faint);font-size:var(--fs-xs);white-space:nowrap}
  .mt-tbl .mt-s.mt-wrap{white-space:normal;max-width:230px;line-height:1.35;text-wrap:pretty}
  .mt-mcell{min-width:200px}
  .mt-mcell .mt-form{font-size:var(--fs-xs);color:var(--muted)}
  .mt-mcell .mt-s{display:flex;align-items:center;gap:4px;white-space:nowrap}
  .mt-sup{min-width:150px}
  .mt-reo-h{opacity:0;visibility:hidden;transition:opacity .15s ease,visibility .15s}
  .mt-tbl tr:hover .mt-reo-h,.mt-tbl tr:focus-within .mt-reo-h{opacity:1;visibility:visible}
  @media (hover:none){ .mt-reo-h{display:none} }
  .mt-loccol{display:none}
  @media (min-width:1560px){ .mt-loccol{display:table-cell} .mt-locinl{display:none} }

  /* ---------- Behälter */
  .mt-cgrid{columns:290px auto;column-gap:10px;padding:12px 14px 4px}
  .mt-cg{--c:var(--line2);background:var(--bg2);border:1px solid var(--line);border-radius:9px;min-width:0;display:flex;flex-direction:column;break-inside:avoid;margin-bottom:10px}
  .mt-cg-h{display:flex;align-items:center;gap:8px;padding:8px 11px;border-bottom:1px solid var(--line);min-width:0}
  .mt-cg-h .ico{color:var(--c);flex:none}
  .mt-cg-h b{font:600 var(--fs-lg)/1.15 var(--f-cond);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .mt-cg-h .mono{font-size:var(--fs-2xs);color:var(--muted);flex:none}
  .mt-cg-h .spacer{flex:1}
  .mt-cg-h .cnt{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .mt-cg-h .cnt b{font:600 var(--fs-sm) var(--f-ui);color:var(--text2)}
  .mt-cg-h .sdot{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
  .mt-cg-h.lnkh{cursor:pointer}
  @media (hover:hover){ .mt-cg-h.lnkh:hover b{color:var(--accent)} }
  .mt-cg.ext{border-color:color-mix(in srgb,var(--ext) 35%,var(--line))}
  .mt-cg.transit{border-color:color-mix(in srgb,var(--mat) 35%,var(--line))}
  .mt-cg.scrap{opacity:.85}
  .mt-cg-b{display:flex;flex-direction:column;padding:4px 5px 6px}
  .mt-cg-sl{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);padding:7px 6px 4px}
  .mt-ct{--c:var(--muted);display:grid;grid-template-columns:18px minmax(0,1fr) auto;column-gap:8px;row-gap:1px;align-items:center;padding:5px 6px;border-radius:6px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}
  .mt-ct:hover{background:color-mix(in srgb,var(--raise) 50%,transparent)}
  .mt-ct.sel{background:color-mix(in srgb,var(--accent) 12%,transparent)}
  .mt-ct > .mt-mk{grid-row:1/3;align-self:start;justify-self:center;margin-top:4px}
  .mt-ct .l1{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:var(--fs-sm)}
  .mt-ct .l1 .mono{font-size:var(--fs-xs);color:var(--text2);flex:none}
  .mt-ct .l1 span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--text)}
  .mt-ct .q{font:600 var(--fs-md)/1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
  .mt-ct .l2{grid-column:2/4;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;min-width:0}
  .mt-ct .l2 span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .mt-ct .l2 .fb{flex:none;width:44px;height:4px;border-radius:2px;background:var(--track);overflow:hidden}
  .mt-ct .l2 .fb i{display:block;height:100%;background:var(--mat)}
  .mt-ct .l2 .warn{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))}

  /* ---------- Details (Drawer) */
  .mt-d-hero{display:flex;flex-direction:column;gap:10px}
  .mt-d-st{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .mt-d-st .pill{font-size:var(--fs-md);line-height:22px;padding:3px 12px 3px 10px}
  .mt-d-st .pill i{width:9px;height:9px}
  .mt-d-since{font-size:var(--fs-sm);color:var(--muted);font-variant-numeric:tabular-nums}
  .mt-d-cause{font-size:var(--fs-md);line-height:1.45;color:var(--text);overflow-wrap:anywhere}
  .mt-d-box{--c:var(--mat);border-radius:9px;padding:10px 12px;background:color-mix(in srgb,var(--c) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 28%,transparent);display:flex;flex-direction:column;gap:6px;font-size:var(--fs-sm);color:var(--text2)}
  .mt-d-box-h{display:flex;align-items:center;gap:7px;font-weight:600;font-size:var(--fs-md);color:color-mix(in srgb,var(--c) 70%,var(--text))}
  .mt-d-box-h .spacer{flex:1}
  .mt-d-box-h small{font-weight:500;color:var(--muted);font-size:var(--fs-xs)}
  .mt-d-box b{color:var(--text);font-weight:600}
  .mt-d-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .mt-d-stats div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}
  .mt-d-stats b{display:block;font:600 var(--fs-xl)/1.1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-d-stats b small{font-size:var(--fs-sm);color:var(--muted);font-weight:500;margin-left:2px}
  .mt-d-stats span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-d-bat{display:grid;grid-template-columns:62px minmax(0,1fr);gap:14px;align-items:center}
  .mt-d-chart svg{display:block;width:100%;height:auto;overflow:visible}
  .mt-d-chart .ax{font:500 var(--fs-2xs) var(--f-ui);fill:var(--faint)}
  .mt-d-chart .thr{stroke:var(--st-fault);stroke-width:1;stroke-dasharray:3 3;opacity:.7}
  .mt-d-chart .thrt{font:600 var(--fs-2xs) var(--f-ui);fill:color-mix(in srgb,var(--st-fault) 80%,var(--text))}
  .mt-d-chart .grid{stroke:var(--line);stroke-width:1}
  .mt-d-list{display:flex;flex-direction:column}
  .mt-d-li{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line);font-size:var(--fs-sm)}
  .mt-d-li:last-child{border-bottom:0}
  .mt-d-li .tm{font:500 var(--fs-xs) var(--f-mono);color:var(--muted)}
  .mt-d-li .mn{min-width:0}
  .mt-d-li .mn b{font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-d-li .mn span{display:block;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt-d-li .rt{font-size:var(--fs-xs);color:var(--text2);white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
  .mt-d-li.click{cursor:pointer}
  .mt-d-li.click:hover .mn b{color:var(--accent)}
  .mt-d-li .ev{display:block;font-size:var(--fs-sm);color:var(--text2);white-space:normal;overflow-wrap:anywhere}
  .mt-d-reo{display:flex;flex-direction:column;gap:10px}
  .mt-d-reo .row{gap:8px;flex-wrap:nowrap}
  .mt-qty{display:flex;align-items:stretch;border:1px solid var(--line2);border-radius:8px;overflow:hidden;background:var(--bg2);flex:1;min-width:0}
  .mt-qty input{flex:1;min-width:0;border:0;background:transparent;padding:7px 10px;font-variant-numeric:tabular-nums;font-weight:600;color:var(--text)}
  .mt-qty input:focus{outline:none}
  .mt-qty:focus-within{border-color:var(--accent)}
  .mt-qty span{display:grid;place-items:center;padding:0 10px;color:var(--muted);font-size:var(--fs-sm);border-left:1px solid var(--line)}
  .mt-d-reo .quick{display:flex;gap:6px;flex-wrap:wrap}
  .mt-d-reo .sum{font-size:var(--fs-sm);color:var(--text2)}
  .mt-d-reo .sum b{color:var(--text)}
  .mt-d-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .mt-d-tbl th{text-align:left;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
  .mt-d-tbl td{padding:6px 6px;border-bottom:1px solid var(--line);vertical-align:top}
  .mt-d-tbl tr:last-child td{border-bottom:0}
  .mt-d-tbl .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .mt-d-tbl .s{display:block;font-size:var(--fs-xs);color:var(--muted)}
  .mt-d-tbl tfoot td{font-weight:600;border-top:1px solid var(--line2);border-bottom:0}
  .mt-chain{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;row-gap:6px}
  .mt-chain .op{--c:var(--line2);display:flex;flex-direction:column;gap:1px;padding:5px 9px;border-radius:7px;border:1px solid color-mix(in srgb,var(--c) 55%,var(--line));background:color-mix(in srgb,var(--c) 8%,var(--bg2));font-size:var(--fs-xs);min-width:0}
  .mt-chain .op b{font:600 var(--fs-sm)/1.15 var(--f-ui);white-space:nowrap}
  .mt-chain .op span{color:var(--muted);white-space:nowrap}
  .mt-chain .ar{display:grid;place-items:center;color:var(--faint);padding:0 3px}
  .mt-chain .op.cur{box-shadow:0 0 0 1px var(--c)}

  @media (max-width:1180px){
    .mt-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media (max-width:1100px){
    .mt-ffoot{grid-template-columns:minmax(0,1fr)}
    .mt-ffoot > div + div{border-left:0;border-top:1px solid var(--line)}
  }
  @media (max-width:900px){
    .mt-lage{width:100%}
  }
  @media (max-width:700px){
    .mt-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .mt-bil{grid-template-columns:repeat(2,minmax(0,1fr))}
    /* Lage-Leiste: waagrecht wischbar, jede Karte vollständig lesbar (2 Zeilen statt Abschneiden) */
    .mt-lage{flex:1 1 100%;width:auto;margin:0 calc(-1 * max(18px, env(safe-area-inset-left, 0px))) 0;padding:0 max(18px, env(safe-area-inset-left, 0px)) 2px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scroll-padding:0 18px;gap:8px;background:transparent;border:0;border-radius:0;scrollbar-width:none}
    .mt-lage::-webkit-scrollbar{display:none}
    .mt-lage.fr{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent)}
    .mt-kpis .kpi .viz{display:none}
    .mt-kpis .kpi{min-height:0}
    .mt-topwrap:not(.open) .mt-top{display:none}
    .mt-toptg{display:inline-flex}
    .mt-lg{flex:0 0 auto;width:min(264px,74vw);scroll-snap-align:start;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px}
    .mt-lg + .mt-lg{border-left:1px solid var(--line)}
    .mt-lg .ico{margin-top:2px}
    .mt-lg b,.mt-lg small{white-space:normal;max-width:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35}
    .mt-topr{grid-template-columns:minmax(0,1fr) 70px 48px}
    .mt-svc{grid-template-columns:repeat(2,minmax(0,1fr))}
    .mt-svc div:last-child{grid-column:1/-1}
    .mt-ffoot .mt-topwrap .eyebrow .hint{display:none}
  }
  /* Tabellen → Karten, abhängig von der Kartenbreite (nicht vom Fenster): Tablet zweizeilig, Telefon gestapelt */
  .mt-trcard{container:mttr / inline-size}
  .mt-matcard{container:mtmat / inline-size}
  @container mttr (max-width:1160px){
    .mt-trt thead{display:none}
    .mt-trt,.mt-trt tbody{display:block;width:100%}
    .mt-trt tr{position:relative;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,.95fr) auto;grid-template-areas:"c r t s" "o m y w";column-gap:18px;row-gap:9px;align-items:start;padding:11px 16px 12px 18px;border-bottom:1px solid var(--line)}
    .mt-trt tr:last-child{border-bottom:0}
    .mt-trt td{display:block;padding:0;border:0;min-width:0}
    .mt-trt td.st{position:absolute;left:0;top:0;bottom:0;width:3px;box-shadow:none;background:var(--c)}
    .mt-trt tr.sep,.mt-trt tr.sep td{display:block}
    .mt-trt tr:has(> td[colspan]){display:block}
    .mt-trt td:nth-child(2){grid-area:o}.mt-trt td:nth-child(3){grid-area:c}.mt-trt td:nth-child(4){grid-area:r}.mt-trt td:nth-child(5){grid-area:w;text-align:right;align-self:center}
    .mt-trt td:nth-child(6){grid-area:m}.mt-trt td:nth-child(7){grid-area:s;justify-self:end}.mt-trt td:nth-child(8){grid-area:t}.mt-trt td:nth-child(9){grid-area:y}
    .mt-trt td:nth-child(2) .mt-s,.mt-trt td:nth-child(6) .mt-s{display:inline;margin-left:6px}
    .mt-trt td:nth-child(2){align-self:center}
    .mt-trt td:nth-child(6){display:flex;align-items:center;gap:0;min-width:0;white-space:nowrap}
    .mt-trt td:nth-child(6) .mt-s{overflow:hidden;text-overflow:ellipsis}
    .mt-trt .mt-why{max-width:none;-webkit-line-clamp:1}
    .mt-trt .mt-rel{max-width:100%;overflow:hidden;text-overflow:ellipsis}
  }
  @container mttr (max-width:640px){
    /* Telefon: kompakte Karte – Inhalt · Status / Strecke · Wartezeit / Grund · Fahrzeug */
    .mt-trt tr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"c s" "r t" "y m";column-gap:12px;row-gap:5px;padding:10px 14px 11px 16px}
    .mt-trt td:nth-child(2),.mt-trt td:nth-child(5),.mt-trt td:nth-child(4) .mt-s,.mt-trt td:nth-child(6) .mt-s{display:none}
    .mt-trt td:nth-child(6){justify-self:end;align-self:center}
    .mt-trt td:nth-child(8){text-align:right}
    .mt-trt td:nth-child(8) .mt-s{display:none}
    .mt-trt td:nth-child(4),.mt-trt td:nth-child(8){align-self:center}
    .mt-trt .mt-why{-webkit-line-clamp:2;font-size:var(--fs-xs);color:var(--muted)}
  }
  @container mtmat (max-width:1160px){
    .mt-mtt thead{display:none}
    .mt-mtt,.mt-mtt tbody{display:block;width:100%}
    .mt-mtt tr{position:relative;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.15fr) 118px;grid-template-areas:"m b r a" "l w o a";column-gap:20px;row-gap:8px;align-items:start;padding:11px 16px 12px 18px;border-bottom:1px solid var(--line)}
    .mt-mtt tr:last-child{border-bottom:0}
    .mt-mtt td{display:block;padding:0;border:0;min-width:0}
    .mt-mtt td.st{position:absolute;left:0;top:0;bottom:0;width:3px;box-shadow:none;background:var(--c)}
    .mt-mtt td:nth-child(2){grid-area:m}.mt-mtt td:nth-child(3){grid-area:b}.mt-mtt td:nth-child(4){grid-area:r}.mt-mtt td:nth-child(5){grid-area:w;text-align:left}
    .mt-mtt td:nth-child(6){grid-area:o}.mt-mtt td:nth-child(7){grid-area:l}.mt-mtt td:nth-child(8){display:none}.mt-mtt td:nth-child(9){grid-area:a;align-self:center;justify-self:end}
    .mt-mtt .mt-mcell,.mt-mtt .mt-sup{min-width:0}
    .mt-mtt td[data-l]::before{content:attr(data-l);display:block;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:3px}
    .mt-mtt td:nth-child(5) .mt-s,.mt-mtt td:nth-child(6) .mt-s{display:inline;margin-left:6px}
    .mt-mtt td:nth-child(5),.mt-mtt td:nth-child(6){white-space:normal}
    .mt-mtt .mt-mcell b{white-space:normal}
    .mt-mtt .mt-stock{min-width:0}
    .mt-mtt .mt-s{max-width:none}
    .mt-mtt .mt-s.mt-wrap{max-width:none}
    .mt-mtt .mt-reo-h{display:none}
  }
  @container mtmat (max-width:640px){
    /* Telefon: kompakte Zeile (Name, Bestandsbalken, Reichweite) – Lieferant, Verbrauch und Bestellungen per Tipp im Detail */
    .mt-mtt tr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"m a" "b b" "r r";column-gap:12px;row-gap:6px;padding:10px 14px 11px 16px}
    .mt-mtt td:nth-child(5),.mt-mtt td:nth-child(6),.mt-mtt td:nth-child(7){display:none}
    .mt-mtt td:nth-child(9){align-self:start}
    .mt-mtt .mt-mcell .mt-locinl{display:none}
    .mt-matcard:not(.all) .mt-mtt tr.calm{display:none}
    .mt-matcard .mt-matmore{display:flex}
    .mt-matcard .mt-legend-mini{display:none}
    .mt-matcard .mt-hs .x{display:none}
  }
  .mt-matmore{display:none}
  /* ---------- Behälter: Markierung je Lebenszyklus (Material-Familie – Kontur, Fläche, Bewegung; extern = --ext) */
  .mt-mk{display:inline-block;position:relative;width:10px;height:10px;border-radius:3px;flex:none;box-sizing:border-box;vertical-align:-1px}
  .mt-mk.k-filling{border:1.6px solid var(--mat);background:transparent}
  .mt-mk.k-ready{background:var(--mat)}
  .mt-mk.k-transit{width:18px;border-radius:5px;background:color-mix(in srgb,var(--mat) 22%,transparent);overflow:hidden}
  .mt-mk.k-transit::after{content:"";position:absolute;top:2px;left:2px;width:6px;height:6px;border-radius:50%;background:var(--mat);animation:mtMk 1.3s ease-in-out infinite alternate}
  @keyframes mtMk{to{transform:translateX(8px)}}
  .mt-mk.k-input{background:color-mix(in srgb,var(--text2) 55%,transparent)}
  .mt-mk.k-external{background:var(--ext)}
  .mt-mk.k-scrap{background:var(--st-fault)}
  .mt-mk.k-shipped{background:var(--faint)}
  .mt-ctleg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--fs-xs);color:var(--muted)}
  .mt-ctleg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .mt-cg-h .cnt.sm,.mt-cg-h .chev{display:none}
  .mt-cg-h .chev{color:var(--muted);transition:transform .18s ease;flex:none}
  .mt-ctcard{container:mtct / inline-size}
  @container mtct (max-width:640px){
    /* Telefon: je Ort eine Zusammenfassung; aufgeklappt nur, was Aufmerksamkeit braucht (Tippen klappt auf/zu) */
    .mt-cgrid{columns:auto;display:flex;flex-direction:column;gap:6px;padding:10px 12px 12px}
    .mt-cg{margin:0}
    .mt-cg-h{min-height:44px;cursor:pointer;gap:8px;padding:8px 10px}
    .mt-cg:not(.open) .mt-cg-h{border-bottom:0}
    .mt-cg:not(.open) .mt-cg-b{display:none}
    .mt-cg-h .cnt.lg{display:none}
    .mt-cg-h{flex-wrap:wrap;row-gap:2px}
    .mt-cg-h .cnt.sm{display:block;order:5;flex-basis:100%;padding-left:15px;white-space:normal}
    .mt-cg-h .cnt.sm b.warn{font:inherit;font-weight:600;color:var(--st-wait)}
    .mt-cg-h .chev{display:inline-grid}
    .mt-cg.open .mt-cg-h .chev{transform:rotate(90deg)}
    .mt-cg-h .mono{display:none}
    .mt-ctcard:not(.all) .mt-cg.calm{display:none}
    .mt-ctcard .mt-ctmore{display:flex}
    .mt-ctcard .mt-hs .x{display:none}
  }
  .mt-ctmore{display:none}
  /* Fahrzeuge: auf dem Telefon waagrecht wischen statt drei Karten untereinander */
  @container mtfleet (max-width:540px){
    .mt-fleet{display:flex;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;gap:10px;margin:0 calc(-1 * max(18px, env(safe-area-inset-left, 0px)));padding:0 max(18px, env(safe-area-inset-left, 0px)) 4px;scroll-padding:0 18px;scrollbar-width:none}
    .mt-fleet::-webkit-scrollbar{display:none}
    .mt-fleet > .mt-vc{flex:0 0 86%;scroll-snap-align:start}
  }
  /* Touch: Bedienflächen ≥ 40 px (UI_GUIDE Regel 17) */
  @media (pointer:coarse){
    .mt-legbar button{height:40px}
    .mt-filt{height:40px}
    .mt-filt button{width:32px;height:32px}
    .mt-topr{min-height:40px}
    .mt-ct{min-height:44px}
    .mt-d-li.click{min-height:40px}
    .mt-qty input{font-size:16px}
    .mt-root .seg button{min-height:40px}
    .mt-tbl .lnk{padding:6px 0;margin:-6px 0}
  }
  `, 'mt-css');

  // ================================================================== Hallenplan-Geometrie (SVG-Einheiten)
  const VW = 1200, PADX = 24, PADT = 20, KX = (VW - 2 * PADX) / 64, ZS = 0.62, KZ = KX * ZS;
  const PX = (x) => PADX + x * KX, PY = (z) => PADT + z * KZ;
  const NH = 38;                           // Knotenhöhe
  const VH = Math.round(PY(45) + 32);
  // Knoten: Position im Hallenkoordinatensystem (m), leicht auf Reihen ausgerichtet; Breite in SVG-Einheiten
  const NODE_DEF = [
    { id: 'RAW', x: 5.0, z: 4.4, kind: 'store', icon: 'rack', w: 160 },
    { id: 'CHG', x: 45, z: 3.6, kind: 'charge', icon: 'plug', w: 104 },
    { id: 'M01', x: 5.25, z: 16.2 }, { id: 'M02', x: 15.25, z: 16.2 }, { id: 'M03', x: 24.3, z: 16.2 }, { id: 'M04', x: 33.5, z: 16.2 },
    { id: 'M07', x: 44.2, z: 16.2 }, { id: 'M08', x: 52.1, z: 16.2 }, { id: 'M13', x: 60.2, z: 16.2 },
    { id: 'M05', x: 14, z: 28.2 }, { id: 'M06', x: 20.6, z: 28.2 }, { id: 'M09', x: 27.2, z: 28.2 }, { id: 'M10', x: 33.8, z: 28.2 },
    { id: 'M11', x: 40.4, z: 28.2 }, { id: 'QS', x: 48.8, z: 28.2 },
    { id: 'VERSAND', x: 60.2, z: 31.6, kind: 'store', icon: 'ship', w: 112 },
    { id: 'WE', x: 5.2, z: 37.2, kind: 'store', icon: 'inbox', w: 150 },
    { id: 'SPERR', x: 39.2, z: 37.2, kind: 'store', icon: 'lock', w: 124 },
    { id: 'EXT', x: 49.6, z: 37.2, kind: 'store', icon: 'truck', w: 164 },
    { id: 'HAERT', x: 27, z: 45, kind: 'partner', icon: 'flame', w: 236 },
  ];
  const MAIN_Y = PY(22);

  function quad(p0, p1, p2, t) { const u = 1 - t; return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }; }
  function inRect(p, n, pad) { return Math.abs(p.x - n.cx) <= n.w / 2 + pad && Math.abs(p.y - n.cy) <= n.h / 2 + pad; }
  function sameRow(a, b) { return Math.abs(a.cy - b.cy) < 30; }
  /** Nachbarn in derselben Reihe ohne Station dazwischen → gerade Verbindung */
  function adjacent(a, b, nodes) {
    if (!sameRow(a, b)) return false;
    const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
    return !nodes.some(n => n !== a && n !== b && Math.abs(n.cy - a.cy) < 30 && n.cx > x0 && n.cx < x1);
  }
  /** Krümmung wählen (Mittelpunkt-zu-Mittelpunkt-Kurve): keine fremden Knoten überdecken, Gegenrichtung auf die andere Seite,
      in einer Reihe vom Hauptgang weg und proportional zur Länge (dadurch verschachteln sich Bögen statt sich zu kreuzen). */
  function chooseCurve(a, b, nodes, reverseSide) {
    const p0 = { x: a.cx, y: a.cy }, p2 = { x: b.cx, y: b.cy };
    const dx = p2.x - p0.x, dy = p2.y - p0.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const adj = adjacent(a, b, nodes);
    let pref = 1;
    if (sameRow(a, b)) { const away = a.cy < MAIN_Y ? -1 : 1; pref = Math.sign(ny * away) || 1; }
    if (reverseSide) pref = -reverseSide;
    const ks = adj ? (reverseSide ? [0.12, 0.2] : [0, 0.12]) : sameRow(a, b) ? [0.22, 0.3, 0.4, 0.14] : [0.16, 0.26, 0.38, 0.08, 0.5];
    let best = null;
    for (const k of ks) for (const sgn of [pref, -pref]) {
      if (reverseSide && sgn === reverseSide && k > 0) continue;
      const off = k * len * sgn;
      const p1 = { x: (p0.x + p2.x) / 2 + nx * off, y: (p0.y + p2.y) / 2 + ny * off };
      let hits = 0;
      for (let i = 2; i <= 30; i++) {
        const p = quad(p0, p1, p2, i / 32);
        for (const n of nodes) { if (n === a || n === b) continue; if (inRect(p, n, 6)) { hits++; break; } }
      }
      const peakY = (p0.y + 2 * p1.y + p2.y) / 4;
      if (peakY < PADT + 6 || peakY > VH - 8) hits += 4;
      const score = hits * 100 + ks.indexOf(k) * 4 + (sgn !== pref ? 3 : 0);
      if (!best || score < best.score) best = { score, p1, sgn: k === 0 ? 0 : sgn, k };
      if (k === 0) break;
    }
    return { p1: best.p1, sgn: best.sgn, straight: best.k === 0, len };
  }
  /** Endpunkte der Kanten auf die Knotenränder verteilen (Ports), sortiert nach Abgangswinkel – Kurven kreuzen sich am Knoten nicht */
  function assignPorts(list) {
    const ends = new Map();
    for (const it of list) {
      for (const which of ['s', 't']) {
        const n = which === 's' ? it.a : it.b, o = which === 's' ? it.b : it.a;
        const v = it.c.straight ? { x: o.cx - n.cx, y: o.cy - n.cy } : { x: it.c.p1.x - n.cx, y: it.c.p1.y - n.cy };
        const sx = Math.abs(v.x) / (n.w / 2), sy = Math.abs(v.y) / (n.h / 2);
        const side = sx > sy ? (v.x > 0 ? 'R' : 'L') : (v.y > 0 ? 'B' : 'T');
        let ang = Math.atan2(v.y, v.x) * 180 / Math.PI;
        if (side === 'L' && ang < 0) ang += 360;
        const key = side === 'B' ? -ang : side === 'L' ? -ang : ang;
        const tie = side === 'T' || side === 'B' ? (v.x < 0 ? it.c.len : -it.c.len) : (v.y < 0 ? it.c.len : -it.c.len);
        const arr = ends.get(n.id + side) || []; arr.push({ it, which, n, side, key: Math.round(key / 4), tie });
        ends.set(n.id + side, arr);
      }
    }
    for (const arr of ends.values()) {
      arr.sort((p, q) => p.key - q.key || p.tie - q.tie);
      const n = arr[0].n, side = arr[0].side, k = arr.length;
      const horiz = side === 'T' || side === 'B';
      const span = horiz ? n.w - 24 : n.h - 12;
      const sp = k > 1 ? Math.min(horiz ? 13 : 9, span / (k - 1)) : 0;
      arr.forEach((p, i) => {
        const off = (i - (k - 1) / 2) * sp;
        const pt = side === 'B' ? { x: n.cx + off, y: n.cy + n.h / 2 + 1 } : side === 'T' ? { x: n.cx + off, y: n.cy - n.h / 2 - 1 }
          : side === 'R' ? { x: n.cx + n.w / 2 + 1, y: n.cy + off } : { x: n.cx - n.w / 2 - 1, y: n.cy + off };
        p.it[p.which === 's' ? 'P0' : 'P2'] = pt;
        p.it[p.which === 's' ? 'side0' : 'side2'] = side;
      });
    }
    for (const it of list) {
      const P0 = it.P0, P2 = it.P2;
      let P1;
      if (it.c.straight) P1 = { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 };
      else {
        // Kontrollpunkt mitverschieben (mittlere Port-Verschiebung), Form bleibt erhalten
        const d0x = P0.x - it.a.cx, d0y = P0.y - it.a.cy, d2x = P2.x - it.b.cx, d2y = P2.y - it.b.cy;
        P1 = { x: it.c.p1.x + (d0x + d2x) / 2, y: it.c.p1.y + (d0y + d2y) / 2 };
      }
      const tx = P2.x - P1.x, ty = P2.y - P1.y, tl = Math.hypot(tx, ty) || 1;
      it.g = { q0: P0, q1: P1, q2: P2, dir: { x: tx / tl, y: ty / tl }, tip: P2, sgn: it.c.sgn };
    }
  }
  /** Längentabelle einer gezeichneten Kurve (für Punkte entlang der Kante, ohne DOM-Messung) */
  function lutOf(g) {
    if (!g || !g.r0) return null;
    const pts = [], cum = [0];
    for (let i = 0; i <= 40; i++) { const p = quad(g.r0, g.r1, g.r2, i / 40); pts.push(p); if (i) cum.push(cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)); }
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function lutPoint(L2, f) {
    const d = U.clamp(f, 0, 1) * L2.len; let i = 1;
    while (i < L2.cum.length - 1 && L2.cum[i] < d) i++;
    const a = L2.pts[i - 1], b = L2.pts[i], seg = L2.cum[i] - L2.cum[i - 1] || 1, k = (d - L2.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  /** Kurve so kürzen, dass sie am Pfeilfuß endet */
  function trimEnd(g, back) {
    const L = Math.hypot(g.q2.x - g.q1.x, g.q2.y - g.q1.y) + Math.hypot(g.q1.x - g.q0.x, g.q1.y - g.q0.y);
    const t = U.clamp(1 - back / Math.max(10, L * 0.8), 0.5, 1);
    const ta = 0, tb = t, p0 = g.q0, p1 = g.q1, p2 = g.q2;
    const r2 = quad(p0, p1, p2, tb);
    const r1 = { x: (1 - ta) * (1 - tb) * p0.x + ((1 - ta) * tb + ta * (1 - tb)) * p1.x + ta * tb * p2.x, y: (1 - ta) * (1 - tb) * p0.y + ((1 - ta) * tb + ta * (1 - tb)) * p1.y + ta * tb * p2.y };
    g.r0 = p0; g.r1 = r1; g.r2 = r2;
  }
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  const dPath = (g) => `M${f1(g.r0.x)},${f1(g.r0.y)} Q${f1(g.r1.x)},${f1(g.r1.y)} ${f1(g.r2.x)},${f1(g.r2.y)}`;
  const dFull = (g) => `M${f1(g.q0.x)},${f1(g.q0.y)} Q${f1(g.q1.x)},${f1(g.q1.y)} ${f1(g.q2.x)},${f1(g.q2.y)}`;

  // ================================================================== Ansicht
  const V = { root: null, r: null, mounted: false, visible: false, metric: 'n', trFilter: 'active', relFilter: null, showAllDone: false, sel: null,
    nodes: [], nodeById: {}, edgeSig: '', edges: new Map(), veh: {}, dots: new Map(), dotSig: '', hl: null, pinned: null, sig: {} };

  function mount(root) {
    V.root = root;
    root.innerHTML = `
    <div class="mt-root">
      <div class="mt-head">
        <div class="view-h"><div>
          <h1 class="view-t">Material &amp; Logistik</h1>
          <p class="view-sub">Rohmaterial, Behälter und Transporte – vom Lager über Maschinen und Härterei bis in den Versand.</p>
        </div></div>
        <div class="mt-lage" data-r="lage">
          <div class="mt-lg click" data-r="lgLog" title="Logistiker:in im Dienst (Stapler)">${ICO('forklift', 18)}<div><span class="eyebrow">Logistik</span><b data-r="lgLogB">–</b><small data-r="lgLogS">–</small></div></div>
          <div class="mt-lg" data-r="lgExt" style="--c:var(--ext)">${ICO('flame', 18)}<div><span class="eyebrow">Fremdbearbeitung</span><b data-r="lgExtB">–</b><small data-r="lgExtS">–</small></div></div>
          <div class="mt-lg" data-r="lgDel" style="--c:var(--mat)">${ICO('inbox', 18)}<div><span class="eyebrow">Wareneingang</span><b data-r="lgDelB">–</b><small data-r="lgDelS">–</small></div></div>
        </div>
      </div>

      <div class="mt-kpis" data-r="kpis">
        ${['kOpen', 'kWait', 'kAgv', 'kWip', 'kMin', 'kPur'].map(k => `<div class="kpi" data-r="${k}"><div class="l" data-r="${k}L"></div><div class="v" data-r="${k}V">–</div><div class="s" data-r="${k}S"></div><div class="viz" data-r="${k}Sp"></div></div>`).join('')}
      </div>

      <section class="card mt-flow" data-r="flowCard">
        <div class="card-h mt-card-h">
          <div><h3>Materialfluss heute</h3>
            <div class="mt-hs">Stationen an ihrer Position in der Halle · Linienstärke = <b data-r="metricName">Fahrten</b> seit 00:00 · Punkte = Behälter, die gerade transportiert werden</div></div>
          <div class="row">
            <span class="mt-live" data-r="live"><i></i><span data-r="liveT">–</span></span>
            <div class="seg" role="group" aria-label="Linienstärke" data-r="metricSeg">
              <button data-m="n" class="on" title="Anzahl Fahrten (Behälter, Stangen-Nachschub, Lose zur Härterei)">Fahrten</button>
              <button data-m="qty" title="bewegte Teile">Stück</button>
              <button data-m="kg" title="bewegtes Gewicht inkl. Behälter">Gewicht</button>
            </div>
          </div>
        </div>
        <div class="mt-fwrap"><div class="mt-fscroll" data-r="fscroll"><div class="mt-fin" data-r="fin">
          <svg class="mt-svg" data-r="svg" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Materialfluss-Diagramm der Halle">
            <g data-r="gBase"></g><g data-r="gEdges"></g><g data-r="gLabels"></g><g data-r="gNodes"></g><g data-r="gVeh"></g><g data-r="gDots"></g>
          </svg>
          <div class="mt-tip" data-r="tip" hidden></div>
          <div class="mt-empty" data-r="empty" hidden><b>Heute noch keine Transporte</b>Sobald die ersten Behälter bewegt werden, baut sich hier der Materialfluss des Tages auf.</div>
        </div></div><span class="mt-swipe" aria-hidden="true">${ICO('arrowRight', 14)}Halle seitlich wischen</span></div>
        <div class="mt-legbar"><button type="button" data-r="legBtn" aria-expanded="false">${ICO('chevron', 13)}Legende</button></div>
        <div class="mt-legend" data-r="legend"></div>
        <div class="mt-ffoot">
          <div><div class="eyebrow"><span>Tagesbilanz Logistik</span><span class="spacer"></span><span class="hint" data-r="bilSince">seit 00:00</span></div>
            <div class="mt-bil" data-r="bil"></div>
            <div class="mt-modes" data-r="modesBar"></div><div class="mt-modes-l" data-r="modesL"></div>
            <div class="mt-svc" data-r="svc"></div></div>
          <div class="mt-topwrap" data-r="topWrap"><div class="eyebrow"><span>Stärkste Verbindungen</span><span class="spacer"></span><span class="hint">Auswahl filtert die Transportaufträge</span><button class="mt-toptg" type="button" data-r="topTg" aria-expanded="false">Anzeigen${ICO('chevron', 12)}</button></div>
            <div class="mt-top" data-r="top"></div></div>
        </div>
      </section>

      <section class="mt-fleetsec" data-r="fleetSec">
        <div class="mt-card-h" style="padding:0 2px 10px;border:0"><div><h3>Flotte</h3><div class="mt-hs" data-r="fleetSub">–</div></div></div>
        <div class="mt-fleet" data-r="fleet"></div>
      </section>

      <section class="card mt-trcard" data-r="trCard">
        <div class="card-h mt-card-h">
          <div><h3>Transportaufträge</h3><div class="mt-hs" data-r="trSub">–</div></div>
          <div class="row">
            <span data-r="relChip"></span>
            <div class="seg" role="group" aria-label="Filter Transporte" data-r="trSeg">
              <button data-f="active" class="on">Offen &amp; laufend</button><button data-f="done">Heute erledigt</button><button data-f="all">Alle</button>
            </div>
          </div>
        </div>
        <div class="tbl-wrap"><table class="tbl mt-tbl mt-trt"><thead><tr>
          <th style="width:4px;padding:0"></th><th>Nr.</th><th>Behälter · Auftrag</th><th>Von → Nach</th><th class="r">Gewicht</th><th>Mittel · Träger</th><th>Status</th><th>Wartet / Dauer</th><th>Grund / Hinweis</th>
        </tr></thead><tbody data-r="trBody"></tbody></table></div>
        <div class="mt-more" data-r="trMore" hidden><button class="btn sm ghost" data-r="trMoreBtn">Alle erledigten anzeigen</button></div>
      </section>

      <section class="card mt-matcard" data-r="matCard">
        <div class="card-h mt-card-h">
          <div><h3>Rohmaterial</h3><div class="mt-hs" data-r="matSub">–</div></div>
          <div class="row mt-legend-mini" style="font-size:var(--fs-xs);color:var(--muted);gap:12px">
            <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:14px;height:6px;border-radius:3px;background:${STOCK_C};display:inline-block"></i>Bestand</span>
            <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:14px;height:6px;border-radius:2px;display:inline-block;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--info) 60%,transparent) 0 3px,transparent 3px 6px);border:1px solid color-mix(in srgb,var(--info) 55%,transparent)"></i>bestellt</span>
            <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:2px;height:11px;background:var(--text);display:inline-block"></i>Mindestbestand</span>
          </div>
        </div>
        <div class="tbl-wrap"><table class="tbl mt-tbl mt-mtt"><thead><tr>
          <th style="width:4px;padding:0"></th><th>Material · Form</th><th>Bestand / Mindestbestand</th><th>Reichweite (offener Bedarf)</th><th class="r" title="Verbrauch an den Maschinen seit 00:00 (Säge, Stangenlader, Rohteile) · darunter: aus dem Lager entnommen">Verbrauch heute</th><th>Bestellt</th><th>Lieferant</th><th class="mt-loccol">Lagerort</th><th></th>
        </tr></thead><tbody data-r="matBody"></tbody></table></div>
        <div class="mt-more mt-matmore"><button class="btn sm ghost" type="button" data-r="matMoreBtn">Alle Materialien anzeigen</button></div>
      </section>

      <section class="card mt-ctcard" data-r="ctCard">
        <div class="card-h mt-card-h"><div><h3>Behälter im Umlauf</h3><div class="mt-hs" data-r="ctSub">–</div></div>
          <div class="mt-ctleg" data-r="ctLegend"></div></div>
        <div class="mt-cgrid" data-r="ctGrid"></div>
        <div class="mt-more mt-ctmore"><button class="btn sm ghost" type="button" data-r="ctMoreBtn">Alle Orte anzeigen</button></div>
      </section>
    </div>`;
    V.r = refs(root);
    buildPlan();
    bindFlow();
    // Schmale Container: Diagramm 1:1 im Wisch-Bereich – Ränder ausblenden, solange dort noch Halle liegt
    const sc = V.r.fscroll;
    V.scrollCue = () => {
      const max = sc.scrollWidth - sc.clientWidth;
      setCls(sc, 'fl', max > 4 && sc.scrollLeft > 4);
      setCls(sc, 'fr', max > 4 && sc.scrollLeft < max - 4);
      setCls(V.r.flowCard, 'scrolls', max > 4);
    };
    sc.addEventListener('scroll', () => { V.scrollCue(); if (sc.scrollLeft > 24) setCls(V.r.flowCard, 'swiped', true); }, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => V.scrollCue()).observe(sc);
    V.r.legBtn.onclick = () => { const on = !V.r.flowCard.classList.contains('legopen'); setCls(V.r.flowCard, 'legopen', on); V.r.legBtn.setAttribute('aria-expanded', String(on)); };
    // Kennzahl-Beschriftungen (statisch)
    const KL = { kOpen: 'Offene Transporte', kWait: 'Ø Wartezeit Transport', kAgv: 'AGV-Auslastung', kWip: 'Behälter im Umlauf', kMin: 'Unter Mindestbestand', kPur: 'Offene Bestellungen' };
    for (const k in KL) setText(V.r[k + 'L'], KL[k]);
    V.r.kMin.classList.add('click'); V.r.kMin.title = 'Zur Rohmaterial-Tabelle';
    V.r.kMin.onclick = () => V.r.matCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    V.r.kPur.classList.add('click'); V.r.kPur.title = 'Zur Rohmaterial-Tabelle';
    V.r.kPur.onclick = () => V.r.matCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    V.r.kOpen.classList.add('click'); V.r.kOpen.title = 'Zu den Transportaufträgen';
    V.r.kOpen.onclick = () => { setTrFilter('active'); V.r.trCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    V.r.kWip.classList.add('click'); V.r.kWip.title = 'Zu den Behältern im Umlauf';
    V.r.kWip.onclick = () => V.r.ctCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    V.r.metricSeg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      V.metric = b.dataset.m;
      V.r.metricSeg.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
      setText(V.r.metricName, b.textContent);
      V.edgeSig = ''; update();
    });
    V.r.trSeg.querySelectorAll('[data-f]').forEach(b => b.onclick = () => setTrFilter(b.dataset.f));
    V.r.trMoreBtn.onclick = () => { V.showAllDone = !V.showAllDone; V.sig.tr = ''; update(); };
    V.r.ctMoreBtn.onclick = () => { V.ctAll = !V.ctAll; setCls(V.r.ctCard, 'all', V.ctAll); V.sig.ct = ''; update(); if (!V.ctAll) V.r.ctCard.scrollIntoView({ block: 'nearest' }); };
    V.r.topTg.onclick = () => { const on = !V.r.topWrap.classList.contains('open'); setCls(V.r.topWrap, 'open', on); V.r.topTg.setAttribute('aria-expanded', String(on)); setHTML(V.r.topTg, (on ? 'Ausblenden' : 'Anzeigen') + ICO('chevron', 12)); };
    // Lage-Leiste (Telefon, wischbar): rechten Rand ausblenden, solange dort noch eine Karte liegt
    const lgCue = () => { const lg = V.r.lage, max = lg.scrollWidth - lg.clientWidth; setCls(lg, 'fr', max > 4 && lg.scrollLeft < max - 4); };
    V.r.lage.addEventListener('scroll', lgCue, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(lgCue).observe(V.r.lage);
    V.r.matMoreBtn.onclick = () => { V.matAll = !V.matAll; setCls(V.r.matCard, 'all', V.matAll); V.sig.mat = ''; update(); if (!V.matAll) V.r.matCard.scrollIntoView({ block: 'nearest' }); };
    V.r.lgLog.onclick = () => { const p = logistician(); if (p) WF.app.select('person', p.id); };
    buildFleet();
    // Delegation: Tabellen & Behälter
    V.r.trBody.addEventListener('click', onTableClick);
    V.r.matBody.addEventListener('click', onTableClick);
    V.r.ctGrid.addEventListener('click', onTableClick);
    V.r.ctGrid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const h = e.target.closest && e.target.closest('.mt-cg-h'); if (!h) return;
      e.preventDefault();
      if (V.r.ctCard.clientWidth <= 640) toggleCg(h.closest('.mt-cg'));
      else if (h.dataset.sel) { const [k, id] = h.dataset.sel.split('|'); WF.app.select(k, id); }
    });
    WF.bus.on('select', (sel) => { V.sel = sel && sel.kind ? sel : null; markSel(); });
    WF.bus.on('sim:reset', () => {
      V.sig = {}; V.edgeSig = ''; V.dotSig = ''; V.relFilter = null; V.trSeen = null; V._pulseT = null;
      for (const [, d] of V.dots) d.el.remove(); V.dots.clear();
      if (V.pulses) { V.pulses.forEach(p => p.g.remove()); V.pulses = []; }
      for (const k in V.veh) V.veh[k].x = null;
      if (V.r && V.r.relChip) V.r.relChip._k = null;
    });
    V.mounted = true;
  }
  function setTrFilter(f) {
    V.trFilter = f;
    V.r.trSeg.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === f));
    V.sig.tr = ''; update();
  }
  function onTableClick(e) {
    // Behälter-Orte auf dem Telefon: Kopf klappt auf/zu (auf breiten Karten öffnet er die Maschine)
    const cgh = e.target.closest('.mt-cg-h');
    if (cgh && V.r.ctCard.clientWidth <= 640) { e.stopPropagation(); toggleCg(cgh.closest('.mt-cg')); return; }
    const t = e.target.closest('[data-sel]');
    if (t) { e.stopPropagation(); const [k, id] = t.dataset.sel.split('|'); WF.app.select(k, id); return; }
    const ro = e.target.closest('[data-reorder]');
    if (ro) { e.stopPropagation(); openReorder(ro.dataset.reorder); return; }
    const row = e.target.closest('[data-row]');
    if (row) { const [k, id] = row.dataset.row.split('|'); WF.app.select(k, id); }
  }
  function toggleCg(g) {
    if (!g) return;
    const on = !g.classList.contains('open');
    g.classList.toggle('open', on);
    (V.ctOpen || (V.ctOpen = new Map())).set(g.dataset.k, on);
  }
  function markSel() {
    if (!V.mounted) return;
    const sel = V.sel;
    V.root.querySelectorAll('[data-row]').forEach(n => n.classList.toggle('sel', !!sel && n.dataset.row === sel.kind + '|' + sel.id));
    V.root.querySelectorAll('.mt-vc').forEach(n => n.classList.toggle('sel', !!sel && sel.kind === 'agv' && n.dataset.id === sel.id));
    for (const n of V.nodes) if (n.el) n.el.classList.toggle('sel', !!sel && sel.kind === 'machine' && sel.id === n.id);
  }
  function logistician() {
    const s = S(); let best = null;
    for (const id in s.people) {
      const p = s.people[id];
      if (p.state === 'offShift' || !p.onDuty || p.skills.indexOf('forklift') < 0) continue;
      if (!best || (p.state === 'driving' && best.state !== 'driving')) best = p;
    }
    return best;
  }

  // ------------------------------------------------------------------ Hallenplan (statisch)
  function buildPlan() {
    const P = PRO();
    const nodes = NODE_DEF.map(d => {
      const st = STN(d.id);
      const kind = d.kind || 'machine';
      const name = d.id === 'HAERT' ? haertName() : (st ? (st.short || st.name) : d.id);
      const w = d.w || Math.max(96, Math.round(name.length * 6.4 + 36));
      return { id: d.id, kind, icon: d.icon, name, cx: PX(d.x), cy: PY(d.z), w, h: d.kind === 'charge' ? 30 : NH, st };
    });
    V.nodes = nodes; V.nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
    let h = '';
    // Hallenboden + Wände mit Toren
    h += `<rect class="mt-floor" x="${f1(PX(0))}" y="${f1(PY(0))}" width="${f1(64 * KX)}" height="${f1(40 * KZ)}" rx="6"/>`;
    // Fahrwege
    for (const Ln of P.graph.lines || []) {
      const d = Ln.axis === 'x' ? `M${f1(PX(Ln.a))},${f1(PY(Ln.c))} H${f1(PX(Ln.b))}` : `M${f1(PX(Ln.c))},${f1(PY(Ln.a))} V${f1(PY(Ln.b))}`;
      h += `<path class="mt-aisle" d="${d}"/><path class="mt-aisle-c" d="${d}"/>`;
    }
    // Maschinen-Grundrisse (dezent) und Räume
    for (const st of P.stations) {
      const fp = st.footprint; if (!fp) continue;
      const isNode = !!V.nodeById[st.id];
      if (st.kind === 'machine' || st.kind === 'qs' || st.kind === 'assembly') {
        h += `<rect class="mt-fp" x="${f1(PX(fp.x))}" y="${f1(PY(fp.z))}" width="${f1(fp.w * KX)}" height="${f1(fp.d * KZ)}" rx="2"/>`;
      } else if (!isNode || st.id === 'RAW' || st.id === 'VERSAND') {
        h += `<rect class="mt-room" x="${f1(PX(fp.x))}" y="${f1(PY(fp.z))}" width="${f1(fp.w * KX)}" height="${f1(fp.d * KZ)}" rx="3"/>`;
        if (!isNode) h += `<text class="mt-room-t" x="${f1(PX(fp.x + fp.w / 2))}" y="${f1(PY(fp.z + fp.d / 2) + 3)}" text-anchor="middle">${esc(st.short || st.name)}</text>`;
      }
    }
    // Bereichsbeschriftungen
    const AREA_POS = { Zuschnitt: [5.25, 11.4], Dreherei: [24.3, 11.4], Sonderbearbeitung: [44.2, 11.4], Verzahnung: [52.1, 11.4], Montage: [60.2, 11.4],
      'Fräserei': [17.3, 32.6], Schleiferei: [30.5, 32.6], Reinigung: [40.4, 32.6] };
    V.areas = [];
    for (const a in AREA_POS) {
      const ax = PX(AREA_POS[a][0]), ay = PY(AREA_POS[a][1]);
      V.areas.push({ name: a, x: ax, y: ay - 3, w: a.length * 8.6 + 6, h: 14 });
      h += `<text class="mt-area" data-area="${esc(a)}" x="${f1(ax)}" y="${f1(ay)}" text-anchor="middle">${esc(a)}</text>`;
    }
    // Wände (vorne mit Toren)
    const x0 = PX(0), x1 = PX(64), y0 = PY(0), y1 = PY(40);
    const doors = (P.hall.doors || []).filter(d => d.wall === 'front').sort((a, b) => a.x - b.x);
    let wx = 0, wall = `M${f1(x0)},${f1(y1 - 6)} V${f1(y0 + 6)} Q${f1(x0)},${f1(y0)} ${f1(x0 + 6)},${f1(y0)} H${f1(x1 - 6)} Q${f1(x1)},${f1(y0)} ${f1(x1)},${f1(y0 + 6)} V${f1(y1 - 6)}`;
    h += `<path class="mt-wall" d="${wall}"/>`;
    let front = '';
    for (const d of doors) {
      front += `M${f1(PX(Math.max(0.3, wx)))},${f1(y1)} H${f1(PX(d.x))} `;
      h += `<path class="mt-doorm" d="M${f1(PX(d.x))},${f1(y1)} H${f1(PX(d.x + d.w))}"/>`;
      h += `<text class="mt-door" x="${f1(PX(d.x + d.w / 2))}" y="${f1(y1 + 11)}" text-anchor="middle">${esc(d.name)}</text>`;
      wx = d.x + d.w;
    }
    front += `M${f1(PX(wx))},${f1(y1)} H${f1(PX(63.7))}`;
    h += `<path class="mt-wall" d="${front}"/>`;
    h += `<text class="mt-ext-t" x="${f1(PX(0.4))}" y="${f1(PY(43.3))}">Außerhalb des Werks</text>`;
    V.r.gBase.innerHTML = h;

    // Knoten
    let nh = '';
    for (const n of nodes) {
      const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
      let inner = '';
      if (n.kind === 'machine') {
        const st = n.st;
        const capIn = st ? st.inCap || 0 : 0, capOut = st ? st.outCap || 0 : 0;
        inner += `<circle class="sdh" cx="${-n.w / 2 + 13}" cy="-6.5" r="3.5"/><circle class="sd" cx="${-n.w / 2 + 13}" cy="-6.5" r="3.5"/>`;
        inner += `<text class="t" x="${-n.w / 2 + 22}" y="-2.5">${esc(n.name)}</text>`;
        inner += `<text class="id" x="${-n.w / 2 + 9}" y="12.5">${esc(n.id)}</text>`;
        // Puffer-Pips: Eingang | Ausgang
        let px = n.w / 2 - 8;
        const pipsHtml = (cap, key) => {
          if (cap <= 0) return '';
          if (cap > 4) { px -= 18; return `<text class="pipn" data-k="${key}n" x="${px + 18}" y="13" text-anchor="end">0/${cap}</text>`; }
          let s2 = '';
          for (let i = cap - 1; i >= 0; i--) { px -= 6; s2 = `<rect class="pip" data-k="${key}${i}" x="${px}" y="6" width="5" height="5" rx="1"/>` + s2; }
          px -= 1;
          return s2;
        };
        const outH = pipsHtml(capOut, 'o');
        px -= 6;
        const sepX = px + 3;
        const inH = pipsHtml(capIn, 'i');
        inner += inH + (capIn > 0 ? `<path style="stroke:var(--line2)" d="M${sepX},5.5 v6" stroke-width="1"/>` : '') + outH;
      } else {
        inner += svgIco(n.icon, -n.w / 2 + 8, -n.h / 2 + (n.kind === 'charge' ? 8 : 7), 14, 'ic');
        inner += `<text class="t" x="${-n.w / 2 + 27}" y="${n.kind === 'charge' ? 4.5 : -2.5}">${esc(n.name)}</text>`;
        if (n.kind !== 'charge') inner += `<text class="sub" data-k="sub" x="${-n.w / 2 + 27}" y="12.5"></text>`;
      }
      nh += `<g class="mt-node ${n.kind}" data-node="${n.id}" transform="translate(${f1(n.cx)},${f1(n.cy)})">
        <rect class="pk" x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}" rx="9"/>
        <rect class="bg" x="${-n.w / 2}" y="${-n.h / 2}" width="${n.w}" height="${n.h}" rx="8"/>${inner}
        <g class="bdg" transform="translate(${n.w / 2 - 3},${-n.h / 2 + 2})"><circle r="8.5"/><text data-k="bdg" y="3.4" text-anchor="middle">0</text></g>
      </g>`;
    }
    V.r.gNodes.innerHTML = nh;
    for (const n of nodes) {
      n.el = V.r.gNodes.querySelector(`[data-node="${n.id}"]`);
      n.k = {}; n.el.querySelectorAll('[data-k]').forEach(x => { n.k[x.dataset.k] = x; });
    }
    // Fahrzeuge
    const s = S();
    let vh = '';
    const vids = Object.keys((s && s.agvs) || {});
    for (const id of vids) {
      vh += `<g class="mt-veh agv" data-veh="${id}" style="--c:var(--st-idle)"><circle class="vg" r="13"/><g class="body"><rect class="vb" x="-9.5" y="-6" width="19" height="12" rx="3"/><rect class="vf" x="6" y="-4" width="2" height="8" rx="1"/></g><rect class="vl" x="-4" y="-4" width="8" height="8" rx="1.5" hidden/><text class="vt" text-anchor="middle" y="-10">${esc((s.agvs[id].name || id).replace('AGV ', 'AGV '))}</text><circle class="vh" r="14"/></g>`;
    }
    if (s && s.forklift) {
      vh += `<g class="mt-veh stp" data-veh="${s.forklift.id}" style="--c:var(--st-idle)"><circle class="vg" r="13"/><g class="body"><rect class="vb" x="-8.5" y="-5.5" width="13" height="11" rx="2.5"/><path class="vk" d="M5.5,-3.5 h6 M5.5,3.5 h6"/></g><rect class="vl" x="-4" y="-4" width="8" height="8" rx="1.5" hidden/><text class="vt" text-anchor="middle" y="-10">Stapler</text><circle class="vh" r="14"/></g>`;
    }
    V.r.gVeh.innerHTML = vh;
    V.veh = {};
    V.r.gVeh.querySelectorAll('[data-veh]').forEach(g => {
      V.veh[g.dataset.veh] = { el: g, body: g.querySelector('.body'), load: g.querySelector('.vl'), txt: g.querySelector('.vt'), x: null, y: null, ang: 0 };
    });
    buildLegend();
  }
  function buildLegend() {
    const sw = (inner, w = 26) => `<svg width="${w}" height="14" viewBox="0 0 ${w} 14" aria-hidden="true">${inner}</svg>`;
    const items = [
      [sw('<path style="stroke:var(--mat)" d="M2,7 H24" stroke-width="2" stroke-linecap="round" opacity=".55"/><path style="stroke:var(--mat)" d="M2,7 H24" stroke-width="7" stroke-linecap="round" opacity=".18"/>'), 'Fluss heute (Stärke = Menge)'],
      [sw('<circle style="fill:var(--mat)" cx="13" cy="7" r="6.5" opacity=".22"/><circle style="fill:color-mix(in srgb,var(--mat) 55%,white);stroke:var(--mat)" cx="13" cy="7" r="3.6" stroke-width="1.6"/>'), 'Behälter wird transportiert'],
      [sw('<circle style="fill:var(--mat)" cx="13" cy="7" r="6.5"/><text x="13" y="10.6" text-anchor="middle" style="font:700 var(--fs-2xs) var(--f-ui);fill:color-mix(in srgb,var(--mat) 14%,black)">2</text>'), 'Behälter abholbereit'],
      [sw('<circle style="fill:var(--raise);stroke:var(--line2)" cx="13" cy="7" r="6.5"/><text x="13" y="10.6" text-anchor="middle" style="font:700 var(--fs-2xs) var(--f-ui);fill:var(--text2)">3</text>'), 'vorgemerkt (Ziel voll, keine Wartezeit)'],
      [sw('<path style="stroke:var(--mat)" d="M2,7 H24" stroke-width="2" stroke-dasharray="3 4" opacity=".7"/>'), 'offen, heute noch keine Fahrt'],
      [sw('<path style="stroke:var(--ext)" d="M2,7 H24" stroke-width="2.2" stroke-dasharray="6 4" opacity=".8"/>'), 'Fremdbearbeitung (Spedition)'],
      [sw('<path style="stroke:var(--mat)" d="M2,7 H24" stroke-width="2.4" stroke-dasharray="1.5 4" stroke-linecap="round" opacity=".8"/>'), 'Direktentnahme Säge (ohne Transport)'],
      [sw('<g transform="translate(13,7)" class="mt-veh" style="--c:var(--mat)"><rect class="vb" x="-9" y="-5" width="18" height="10" rx="3"/><rect class="vl" x="-3" y="-3" width="6" height="6" rx="1.2"/></g>'), 'AGV (mit Ladung)'],
      [sw('<g transform="translate(11,7)" class="mt-veh" style="--c:var(--info)"><rect class="vb" x="-7.5" y="-5" width="12" height="10" rx="2.5"/><path class="vk" d="M4.5,-3 h5 M4.5,3 h5"/></g>'), 'Stapler'],
      [sw('<rect style="fill:color-mix(in srgb,var(--text2) 70%,transparent)" x="1" y="4" width="5" height="5" rx="1"/><rect style="fill:var(--track);stroke:var(--line2)" x="8" y="4" width="5" height="5" rx="1" stroke-width=".8"/><path style="stroke:var(--line2)" d="M15.5,3.5 v6"/><rect style="fill:none;stroke:var(--mat)" x="18.5" y="4.5" width="4" height="4" rx="1" stroke-width="1"/><rect style="fill:var(--mat)" x="25" y="4" width="5" height="5" rx="1"/>', 32), 'Puffer Eingang | Ausgang (Kontur = wird befüllt, voll = abholbereit)'],
    ];
    V.r.legend.innerHTML = items.map(([g, t]) => `<span>${g}${esc(t)}</span>`).join('');
  }
  // ------------------------------------------------------------------ Interaktion Diagramm
  function bindFlow() {
    const svg = V.r.svg;
    svg.addEventListener('mousemove', onFlowMove);
    svg.addEventListener('mouseleave', () => { if (!V.pinned) clearHl(); hideTip(); });
    svg.addEventListener('click', (e) => {
      const n = e.target.closest('[data-node]'), ed = e.target.closest('[data-edge]'), vh = e.target.closest('[data-veh]');
      if (vh) { WF.app.select('agv', vh.dataset.veh); return; }
      if (ed) {
        const k = ed.dataset.edge;
        if (k.indexOf('HAERT') >= 0) { V.r.ctCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        const E = V.edges.get(k);
        if (E && E.data.direct && E.data.n === 0) { V.r.matCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        setRelFilter(V.relFilter && V.relFilter.key === k ? null : { key: k, from: k.split('>')[0], to: k.split('>')[1] });
        return;
      }
      if (n) {
        const id = n.dataset.node, node = V.nodeById[id];
        if (node.kind === 'machine') WF.app.select('machine', id);
        else if (id === 'RAW') V.r.matCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (id === 'HAERT' || id === 'EXT' || id === 'SPERR' || id === 'WE') V.r.ctCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (id === 'CHG') { const s = S(); const a = Object.keys(s.agvs)[0]; if (a) WF.app.select('agv', a); }
        else setRelFilter({ key: 'st:' + id, station: id });
      }
    });
  }
  function setRelFilter(f) {
    V.relFilter = f;
    V.sig.tr = ''; V.sig.top = '';
    if (f && V.trFilter === 'active') {
      // Relation hat evtl. keine offenen Transporte – dann „Alle“ zeigen, damit der Filter sichtbar Wirkung hat
      const any = transportsToday().some(r => r.status !== 'done' && relMatch(r, f));
      if (!any) { V.trFilter = 'all'; V.r.trSeg.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === 'all')); }
    }
    update();
    markPinned();
  }
  function markPinned() {
    const f = V.relFilter;
    for (const [k, E] of V.edges) { if (E.g) E.g.classList.toggle('pinned', !!f && !f.station && f.key === k); if (E.lab) E.lab.classList.toggle('pinned', !!f && !f.station && f.key === k); }
    for (const n of V.nodes) if (n.el) n.el.classList.toggle('pinned', !!f && (f.station === n.id || (!f.station && (f.from === n.id || f.to === n.id))));
  }
  const relMatch = (r, f) => !f || (f.station ? (r.from === f.station || r.to === f.station) : (r.from === f.from && r.to === f.to));
  function onFlowMove(e) {
    const ed = e.target.closest('[data-edge]'), n = e.target.closest('[data-node]'), vh = e.target.closest('[data-veh]');
    let html = null, hlKey = null;
    if (vh) { html = vehTip(vh.dataset.veh); hlKey = 'veh:' + vh.dataset.veh; }
    else if (ed) { html = edgeTip(ed.dataset.edge); hlKey = 'edge:' + ed.dataset.edge; }
    else if (n) { html = nodeTip(n.dataset.node); hlKey = 'node:' + n.dataset.node; }
    if (hlKey !== V.hl) applyHl(hlKey);
    if (!html) { hideTip(); return; }
    showTip(html, e);
  }
  function applyHl(key) {
    V.hl = key;
    const svg = V.r.svg;
    if (!key) { svg.classList.remove('hl'); return; }
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const on = new Set(), nodesOn = new Set();
    if (kind === 'edge') { on.add(id); const [a, b] = id.split('>'); nodesOn.add(a); nodesOn.add(b); }
    else if (kind === 'node') { nodesOn.add(id); for (const k of V.edges.keys()) { const [a, b] = k.split('>'); if (a === id || b === id) { on.add(k); nodesOn.add(a); nodesOn.add(b); } } }
    else if (kind === 'veh') {
      const s = S(); const a = s.agvs[id]; const trId = a ? a.task : null;
      let r = trId ? L.tr.get(trId) : null;
      if (!a) for (const x of L.tr.values()) if (x.mode === 'Stapler' && x.status !== 'done' && x.status !== 'open') r = x;
      if (r) { on.add(r.from + '>' + r.to); nodesOn.add(r.from); nodesOn.add(r.to); }
      else { svg.classList.remove('hl'); return; }
    }
    svg.classList.add('hl');
    for (const [k, E] of V.edges) { E.g.classList.toggle('on', on.has(k)); if (E.lab) E.lab.classList.toggle('on', on.has(k)); }
    for (const nd of V.nodes) nd.el.classList.toggle('on', nodesOn.has(nd.id));
  }
  function clearHl() { V.hl = null; V.r.svg.classList.remove('hl'); for (const nd of V.nodes) nd.el.classList.remove('on'); }
  function showTip(html, e) {
    const tip = V.r.tip, host = V.r.fin;
    if (tip._h !== html) { tip._h = html; tip.innerHTML = html; }
    tip.hidden = false;
    const hb = host.getBoundingClientRect();
    let x = e.clientX - hb.left + 16, y = e.clientY - hb.top + 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > hb.width - 6) x = Math.max(6, e.clientX - hb.left - tw - 14);
    if (y + th > hb.height - 6) y = Math.max(6, e.clientY - hb.top - th - 12);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { V.r.tip.hidden = true; }
  function edgeTip(key) {
    const E = V.edges.get(key); if (!E) return null;
    const e = E.data, s = S(), now = s.t;
    const isExt = e.ext;
    const title = `${esc(stName(e.from))} ${ICO('arrowRight', 13)} ${esc(stName(e.to))}`;
    let h = `<div class="tt">${ICO(isExt ? 'flame' : 'truck', 15)}<span>${title}</span></div>`;
    if (e.direct && e.n === 0 && !e.open.length) {
      h += `<div>Die Säge zieht Stangenmaterial direkt aus dem Kragarmregal – ohne Transportauftrag. Entnommen heute:</div><div class="tl">${e.mats.map(x => `<div><span>${esc(x.name)}</span><b>${U.fmtNum(x.m, 1)} m</b></div>`).join('')}</div><div class="hint">Klick: zur Rohmaterial-Tabelle</div>`;
      return h;
    }
    const openDue = e.open.filter(r => !isPlanned(r)), openPlan = e.open.filter(isPlanned);
    if (e.n === 0 && e.open.length) {
      h += `<div>${openDue.length ? `${openDue.length} ${openDue.length === 1 ? 'Behälter wartet' : 'Behälter warten'} auf Abholung` : `${openPlan.length} ${openPlan.length === 1 ? 'Behälter ist' : 'Behälter sind'} vorgemerkt – Ziel voll`} · heute noch keine Fahrt auf dieser Verbindung.</div>`;
    } else if (isExt) {
      h += `<div>${e.from === 'EXT' ? 'Übergabe an die Spedition zur ' + esc(haertName()) : 'Rückkehr von der ' + esc(haertName()) + ' in den Wareneingang'}</div>`;
    }
    h += `<dl class="tk">`;
    if (e.n) {
      h += `<dt>${isExt ? 'Behälter' : 'Fahrten'}</dt><dd>${U.fmtNum(e.n)}${e.live.length ? ` · davon ${e.live.length} unterwegs` : ''}</dd>`;
      if (e.qty) h += `<dt>Teile</dt><dd>${stk(e.qty)}</dd>`;
      if (e.m) h += `<dt>Stangen</dt><dd>${U.fmtNum(e.m, 1)} m</dd>`;
      if (e.kg) h += `<dt>Gewicht</dt><dd>${kg(e.kg)}</dd>`;
      if (!isExt) h += `<dt>Mittel</dt><dd>${[e.modes.AGV ? e.modes.AGV + '× AGV' : '', e.modes.Stapler ? e.modes.Stapler + '× Stapler' : ''].filter(Boolean).join(' · ') || '–'}</dd>`;
      if (e.waitN) h += `<dt>Ø Wartezeit</dt><dd>${dur(e.waitSum / e.waitN)}</dd>`;
      if (e.lastT != null) h += `<dt>Letzte</dt><dd>${tclock(e.lastT, now)}</dd>`;
    }
    if (openDue.length && e.n) h += `<dt>Wartend</dt><dd>${openDue.length} Behälter</dd>`;
    if (openPlan.length && e.n) h += `<dt>Vorgemerkt</dt><dd>${openPlan.length} Behälter · Ziel voll</dd>`;
    h += `</dl>`;
    const ords = [...e.orders.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    if (ords.length) {
      h += `<div class="tl">`;
      for (const o of ords) h += `<div><span>${o.bars ? 'Stangen ' + esc(o.partName || '') : `<span class="mono">${esc(o.orderId || '–')}</span> ${esc(o.partName || '')}`}</span><b>${o.bars ? U.fmtNum(o.m, 1) + ' m' : stk(o.qty)}${o.n > 1 ? ' · ' + o.n + '×' : ''}</b></div>`;
      if (e.orders.size > ords.length) h += `<div><span class="muted">+ ${e.orders.size - ords.length} weitere</span><b></b></div>`;
      h += `</div>`;
    }
    if (openDue.length) {
      const w = openDue.map(r => ({ r, w: waitOf(r, now) })).sort((a, b) => b.w - a.w)[0];
      h += `<div class="tl"><div><span>wartet am längsten: ${esc(w.r.partName || (w.r.kind === 'empty' ? 'Leergut' : ''))}</span><b>${dur(w.w)}</b></div><div><span class="muted">${esc(whyShort(w.r.waitReason || w.r.why || 'wartet auf Zuteilung'))}</span><b></b></div></div>`;
    }
    if (openPlan.length) {
      const p0 = openPlan.slice().sort((a, b) => a.createdT - b.createdT)[0];
      h += `<div class="tl"><div><span>bereitgestellt seit ${tclock(p0.createdT, now)}: ${esc(p0.partName || '')}</span><b></b></div><div><span class="muted">${esc(planReason(p0.waitReason || p0.planWhy))}</span><b></b></div></div>`;
    }
    h += `<div class="hint">${isExt ? 'Klick: Behälter in Fremdbearbeitung anzeigen' : 'Klick: Transportaufträge dieser Verbindung filtern'}</div>`;
    return h;
  }
  function nodeTip(id) {
    const s = S(), now = s.t, n = V.nodeById[id]; if (!n) return null;
    let h = `<div class="tt">${n.kind === 'machine' ? '' : ICO(n.icon, 15)}<span>${esc(n.kind === 'machine' ? n.st.name : (n.st ? n.st.name : n.name))}</span></div>`;
    if (n.kind === 'machine') {
      const m = s.machines[id];
      if (m) h += `<div style="margin:2px 0 4px">${WF.ui.pill(m.state)}</div><div>${esc(m.cause || '')}</div>`;
    }
    const st = s.stations[id];
    const flows = [...V.edges.values()].map(E => E.data);
    const inn = flows.filter(e => e.to === id && e.n > 0), out = flows.filter(e => e.from === id && e.n > 0);
    const sumN = (arr) => arr.reduce((a, e) => a + e.n, 0);
    h += `<dl class="tk">`;
    if (st && n.st && (n.kind === 'machine')) {
      h += `<dt>Eingang</dt><dd>${st.inp.length}${n.st.inCap ? ' / ' + n.st.inCap : ''} Behälter${inQty(st.inp) ? ' · ' + stk(inQty(st.inp)) : ''}</dd>`;
      h += `<dt>Ausgang</dt><dd>${st.out.length}${n.st.outCap ? ' / ' + n.st.outCap : ''} Behälter${readyCount(st.out) ? ' · ' + readyCount(st.out) + ' abholbereit' : ''}</dd>`;
    }
    if (id === 'HAERT') {
      const ext = extContainers();
      h += `<dt>Extern</dt><dd>${ext.length} Behälter · ${stk(ext.reduce((a, c) => a + c.qty, 0))}</dd>`;
      const next = ext.map(c => c.location.returnT).sort((a, b) => a - b)[0];
      if (next != null) h += `<dt>Nächste Rückkehr</dt><dd>ca. ${tclock(next, now)}</dd>`;
    }
    if (id === 'RAW') {
      const low = Object.values(s.materials).filter(m => m.onHand < m.min);
      h += `<dt>Materialien</dt><dd>${Object.keys(s.materials).length}</dd><dt>Unter Mindestbestand</dt><dd>${low.length ? low.map(m => esc(m.name)).join(', ') : 'keine'}</dd>`;
    }
    if (inn.length) h += `<dt>Zugang heute</dt><dd>${sumN(inn)} Fahrten von ${inn.map(e => esc(stName(e.from))).join(', ')}</dd>`;
    if (out.length) h += `<dt>Abgang heute</dt><dd>${sumN(out)} Fahrten nach ${out.map(e => esc(stName(e.to))).join(', ')}</dd>`;
    const wAll = waitingAt(id), wait = wAll.filter(x => !x.planned), plan = wAll.filter(x => x.planned);
    if (wait.length) h += `<dt>Abholbereit</dt><dd>${wait.length} Behälter · ${esc(whyShort(wait[0].waitReason || (wait[0].carrier ? wait[0].carrier + ' ist unterwegs' : 'wartet auf Zuteilung')))}</dd>`;
    if (plan.length) h += `<dt>Vorgemerkt</dt><dd>${plan.length} Behälter · ${esc(planReason(plan[0].waitReason))}</dd>`;
    h += `</dl>`;
    h += `<div class="hint">${n.kind === 'machine' ? 'Klick: Maschinendetails öffnen' : id === 'RAW' ? 'Klick: zur Rohmaterial-Tabelle' : id === 'CHG' ? 'Klick: AGV-Details' : 'Klick: Behälter anzeigen'}</div>`;
    return h;
  }
  function vehTip(id) {
    const s = S(), now = s.t;
    const a = s.agvs[id];
    if (a) {
      const tr = a.task ? L.tr.get(a.task) : null;
      let h = `<div class="tt">${ICO('agv', 15)}<span>${esc(a.name)}</span></div><div style="margin:2px 0 4px">${pill(AGV_C[a.state] || 'var(--st-idle)', lbl('agv', a.state))}</div>`;
      h += `<dl class="tk"><dt>Akku</dt><dd>${U.fmtNum(a.battery, 0)} %${a.mustCharge ? ' · muss laden' : ''}</dd><dt>Ort</dt><dd>${esc(placeText(a.pos))}</dd>`;
      if (tr) h += `<dt>Auftrag</dt><dd>${esc(stName(tr.from))} → ${esc(stName(tr.to))}</dd><dt>Ladung</dt><dd>${a.load ? esc((tr.qty != null ? stk(tr.qty) + ' ' : '') + (tr.partName || '')) : 'leer (Anfahrt)'}</dd>`;
      h += `<dt>Heute</dt><dd>${a.transportsToday} Fahrten · ${U.fmtNum(a.distToday / 1000, 1)} km</dd></dl><div class="hint">Klick: AGV-Details</div>`;
      return h;
    }
    const f = s.forklift; if (!f || f.id !== id) return null;
    const drv = f.driver ? s.people[f.driver] : null;
    const fs = forkState(s);
    let h = `<div class="tt">${ICO('forklift', 15)}<span>${esc(f.name)}</span></div><div style="margin:2px 0 4px">${pill(fs.color, fs.label)}</div>`;
    h += `<dl class="tk"><dt>Fahrer:in</dt><dd>${drv ? esc(drv.name) : '–'}</dd><dt>Ort</dt><dd>${esc(placeText(f.pos))}</dd><dt>Ladung</dt><dd>${f.load ? (f.load === 'Stangen' ? 'Stangenmaterial' : esc(containerText(f.load))) : 'leer'}</dd></dl><div class="hint">Klick: Stapler-Details</div>`;
    return h;
  }
  const inQty = (ids) => { const s = S(); return ids.reduce((a, id) => a + (s.containers[id] ? s.containers[id].qty : 0), 0); };
  const readyCount = (ids) => { const s = S(); return ids.filter(id => s.containers[id] && s.containers[id].state === 'ready').length; };
  function containerText(cid) { const c = S().containers[cid]; return c ? `${stk(c.qty)} ${c.partName}` : cid; }
  function extContainers() { const s = S(); return Object.values(s.containers).filter(c => c.state === 'external' && c.location && c.location.kind === 'external'); }
  /** Transporte, deren Behälter an Station `id` auf Abholung wartet (offen / Fahrzeug unterwegs zur Abholung) */
  function waitingAt(id) {
    const s = S(), out = [];
    for (const tid in s.transports) {
      const t = s.transports[tid];
      if (t.from.station !== id || t.status === 'done' || t.pickupT != null || t.cancelled) continue;
      const r = L.tr.get(tid) || { waitReason: t.waitReason, createdT: t.createdT };
      out.push(Object.assign({}, r, { status: t.status, waitReason: t.waitReason, planned: t.status === 'open' && phaseOf(t) === 'geplant', carrier: t.assignee ? (s.agvs[t.assignee] ? s.agvs[t.assignee].name : shortName(personName(t.assignee))) : null }));
    }
    return out.sort((a, b) => a.createdT - b.createdT);
  }

  // ------------------------------------------------------------------ Aktualisierung
  function show() { V.visible = true; V.sig = {}; V.edgeSig = ''; V.dotSig = ''; for (const k in V.veh) { V.veh[k].x = null; } if (V.scrollCue) requestAnimationFrame(() => V.scrollCue()); }
  function hide() { V.visible = false; hideTip(); V._pulseT = null; if (V.pulses) { V.pulses.forEach(p => p.g.remove()); V.pulses = []; } }
  function update() {
    if (!V.mounted) return;
    const s = S(); if (!s || !s.agvs) return;
    const P = V.prof, T = P ? performance.now : null;
    let t = P ? T.call(performance) : 0;
    const lap = (k) => { if (!P) return; const n = T.call(performance); P[k] = Math.max(P[k] || 0, n - t); P[k + '_sum'] = (P[k + '_sum'] || 0) + (n - t); t = n; };
    if (P) P._n = (P._n || 0) + 1;
    tick(false); scanTransports(); L.lastScanT = s.t; lap('tick');
    const flows = flowsToday(); lap('flows');
    updateHead(s); lap('head');
    updateKpis(s, flows); lap('kpis');
    updateFlow(s, flows); lap('flow');
    updateFleet(s); lap('fleet');
    updateTransports(s); lap('tr');
    updateMaterials(s); lap('mat');
    updateContainers(s); lap('ct');
  }

  function updateHead(s) {
    const r = V.r, now = s.t;
    const p = logistician();
    if (p) {
      setText(r.lgLogB, shortName(p.name));
      setText(r.lgLogS, p.state === 'driving' ? 'fährt Stapler' : p.state === 'break' ? 'in der Pause' : (p.activity || lbl('person', p.state)));
      setVar(r.lgLog, '--c', p.state === 'driving' ? 'var(--mat)' : p.state === 'break' ? 'var(--st-wait)' : 'var(--st-run)');
    } else {
      const sh = WF.sim.shift();
      setText(r.lgLogB, 'nicht besetzt'); setText(r.lgLogS, sh && sh.id ? 'niemand mit Stapler-Schein im Dienst' : 'außerhalb der Schicht – Staplertransporte warten');
      setVar(r.lgLog, '--c', 'var(--st-idle)');
    }
    const ext = extContainers();
    const extQty = ext.reduce((a, c) => a + c.qty, 0);
    const lots = new Set(ext.map(c => c.orderId + '|' + c.location.sentT)).size;
    setText(r.lgExtB, ext.length ? `${lots} ${lots === 1 ? 'Los' : 'Lose'} · ${stk(extQty)}` : 'nichts extern');
    const nextRet = ext.map(c => c.location.returnT).sort((a, b) => a - b)[0];
    setText(r.lgExtS, nextRet != null ? `${haertName()} · zurück ab ca. ${tclock(nextRet, now)}` : haertName());
    const open = (s.purchases || []).filter(x => x.status === 'bestellt').sort((a, b) => a.etaT - b.etaT);
    const deliveredToday = (s.purchases || []).filter(x => x.status === 'geliefert' && x.deliveredT >= dayStart(now)).length;
    if (open.length) {
      const m = s.materials[open[0].materialId];
      setText(r.lgDelB, `nächste Lieferung ${tclock(open[0].etaT, now)}`);
      setText(r.lgDelS, `${amt(open[0].qty, m.unit)} ${m.name}${open.length > 1 ? ` · +${open.length - 1} weitere` : ''}`);
    } else {
      setText(r.lgDelB, 'keine Lieferung erwartet');
      setText(r.lgDelS, deliveredToday ? `${deliveredToday} Lieferung${deliveredToday > 1 ? 'en' : ''} heute eingegangen` : 'keine offenen Bestellungen');
    }
  }

  /** Sparkline (SVG, skaliert per viewBox) – Endpunkt betont, Grundlinie bei 0 */
  function sparkSvg(vals, color, max) {
    vals = vals.filter(x => x != null && isFinite(x));
    if (vals.length < 3) return '';
    const W = 120, H = 30, mx = Math.max(max || 0, ...vals, 1);
    const X = (i) => (i / (vals.length - 1) * W).toFixed(1), Y = (v) => (H - 2 - v / mx * (H - 5)).toFixed(1);
    const pts = vals.map((v, i) => X(i) + ',' + Y(v)).join(' L');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M0,${H - 1} L${pts} L${W},${H - 1} Z" style="fill:${color}" opacity=".13"/><path d="M${pts}" style="fill:none;stroke:${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  /** Kennzahl-Kachel nach styles.css (.kpi .l/.v/.s/.viz): Hinweis nur über .kpi.warn/.crit und nie bei Wert 0 (UI_GUIDE Regel 14) */
  function kpiSet(k, { v, unit, sub, sev, bars }) {
    const r = V.r;
    setHTML(r[k + 'V'], `${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ''}`);
    setHTML(r[k + 'S'], sub || '');
    const zero = v == null || v === '–' || /^0([,.]0+)?$/.test(String(v).trim());
    setCls(r[k], 'warn', !zero && sev === 'warn'); setCls(r[k], 'crit', !zero && sev === 'crit');
    if (bars) setHTML(r[k + 'Sp'], `<div class="mt-kbar">${bars.map(b => `<span title="${esc(b.t || '')}" style="--c:${b.c}"><i style="width:${(U.clamp(b.f, 0, 1) * 100).toFixed(1)}%"></i></span>`).join('')}</div>`);
  }
  function updateKpis(s, flows) {
    const now = s.t, d0 = dayStart(now);
    // 1 offene Transporte = fällige (wartend + unterwegs). Vorgemerkte (Ziel voll, Behälter bereitgestellt) sind eine
    //   neutrale Zusatzzeile – keine Wartezeit, kein Alarm (ENGINE_API §7.5). Längste Wartezeit nur über fällige Material-
    //   transporte (Leergut fährt bewusst nachrangig), gezählt ab „fällig“.
    const act = Object.values(s.transports).filter(t => t.status !== 'done' && !t.cancelled);
    const planned = act.filter(t => phaseOf(t) === 'geplant'), due = act.filter(t => phaseOf(t) !== 'geplant');
    const waiting = due.filter(t => t.status === 'open'), moving = due.filter(t => t.status !== 'open');
    let lw = 0, longest = null;
    for (const t of waiting) { if (t.kind === 'empty') continue; const w = waitOf(recOf(t), now); if (!longest || w > lw) { lw = w; longest = t; } }
    if (!V._spT || performance.now() - V._spT > 3000) {
      V._spT = performance.now();
      const q = (L.samp._q || []).filter(x => x.t >= now - 4 * 3600).map(x => x.v);
      setHTML(V.r.kOpenSp, sparkSvg(q.concat([due.length]), 'var(--text2)', 4));
      const cv = (L.samp._c || []).filter(x => x.t >= now - 8 * 3600).map(x => x.v);
      setHTML(V.r.kWipSp, sparkSvg(cv, 'var(--mat)'));
      V.r.kWipSp.title = 'Behälter im Umlauf – letzte 8 h'; V.r.kOpenSp.title = 'Offene (fällige) Transporte – letzte 4 h';
    }
    const planTxt = planned.length ? `<span class="mt-plan">${planned.length} vorgemerkt</span>` : '';
    kpiSet('kOpen', { v: U.fmtNum(due.length),
      sub: due.length ? `<b>${waiting.length}</b> wartend · <b>${moving.length}</b> in Fahrt<br>${longest && lw >= 60 ? `längste Wartezeit ${dur(lw)}${planTxt ? ' · ' : ''}` : ''}${planTxt}`
        : planned.length ? `keiner fällig<br>${planTxt} – Ziel voll, Behälter bereitgestellt` : 'Alle Behälter sind zugestellt',
      sev: lw > WAIT_CRIT ? 'crit' : lw > WAIT_WARN ? 'warn' : null });
    V.r.kWait.title = 'Ø Wartezeit von „fällig“ (Ziel hat Platz) bis zur Abholung – Zeit, in der ein Behälter wegen vollem Ziel vorgemerkt war, zählt nicht. Leergut fährt nachrangig und ist nicht enthalten.';
    V.r.kOpen.title = 'Offene Transporte = fällig (Ziel hat Platz) oder unterwegs. Vorgemerkte Behälter warten auf Platz am Ziel – das ist keine Wartezeit der Logistik.';
    // 2 Ø Wartezeit (fällig → Abholung) heute – Zeit mit vollem Ziel (vorgemerkt) zählt nicht
    let sum = 0, n = 0, max = 0, maxR = null;
    for (const r of L.tr.values()) {
      if (r.cancelled || r.pickupT == null || r.pickupT < d0 || r.kind === 'empty') continue;   // Leergut fährt bewusst nachrangig
      const w = waitOf(r, now); sum += w; n++;
      if (w > max) { max = w; maxR = r; }
    }
    const avg = n ? sum / n : null;
    kpiSet('kWait', { v: avg == null ? '–' : avg < 60 ? '< 1' : U.fmtNum(Math.round(avg / 60)), unit: avg == null ? '' : 'min',
      sub: n ? `aus <b>${n}</b> Abholungen heute<br>max. ${dur(max)}${max >= 300 && maxR && maxR.why ? ' (' + esc(whyTiny(maxR.why)) + ')' : ''}` : 'heute noch keine Abholung',
      sev: avg != null && avg > WAIT_CRIT ? 'crit' : avg != null && avg > WAIT_WARN ? 'warn' : null });
    // 3 AGV-Auslastung
    const ids = Object.keys(s.agvs);
    const us = ids.map(id => ({ id, u: agvUtil(id), name: s.agvs[id].name }));
    const valid = us.filter(x => x.u != null);
    const avgU = valid.length ? valid.reduce((a, x) => a + x.u, 0) / valid.length : null;
    const win = shiftWindow();
    kpiSet('kAgv', { v: avgU == null ? '–' : U.fmtNum(avgU * 100, 0), unit: avgU == null ? '' : '%', sub: us.map(x => `${esc(x.name)} <b>${x.u == null ? '–' : U.fmtPct(x.u)}</b>`).join(' · ') + `<br>mit Auftrag seit ${U.fmtClock(win.start)}`,
      bars: us.map(x => ({ f: x.u || 0, c: 'color-mix(in srgb,var(--text2) 70%,transparent)', t: x.name + ' ' + (x.u == null ? '–' : U.fmtPct(x.u)) })) });
    // 4 Behälter im Umlauf (WIP)
    let cn = 0, cq = 0, ext = 0, tr = 0;
    for (const id in s.containers) { const c = s.containers[id]; if (c.state === 'shipped' || c.state === 'scrap') continue; cn++; cq += c.qty; if (c.state === 'external') ext++; if (c.state === 'transit') tr++; }
    let wip = null; try { wip = (V._kpiT && performance.now() - V._kpiT < 1000) ? V._wip : WF.sim.kpis().wip; V._wip = wip; V._kpiT = V._kpiT && performance.now() - V._kpiT < 1000 ? V._kpiT : performance.now(); } catch (e) { wip = null; }
    kpiSet('kWip', { v: U.fmtNum(cn), unit: 'Behälter', sub: `<b>${U.fmtNum(cq)}</b> Teile · ${ext} extern<br>WIP gesamt ${wip == null ? '–' : U.fmtNum(wip)} Teile` });
    // 5 unter Mindestbestand
    const mats = Object.values(s.materials);
    const low = mats.filter(m => m.onHand < m.min);
    const lowOpen = low.filter(m => m.onHand + m.onOrder < m.min);
    const missing = (s.notifications || []).filter(x => x.status === 'open' && String(x.key || '').indexOf('missing:') === 0);
    kpiSet('kMin', { v: U.fmtNum(low.length), unit: 'von ' + mats.length,
      sub: missing.length ? `<b style="color:var(--st-fault)">${missing.length} × Material fehlt an Maschine</b><br>${lowOpen.length} ohne Bestellung` : low.length ? `${lowOpen.length ? `<b>${lowOpen.length}</b> ohne Bestellung` : 'alle bestellt'} · ${esc(low.slice(0, 2).map(m => m.name).join(', '))}${low.length > 2 ? ' …' : ''}` : 'alle Materialien über Mindestbestand',
      sev: missing.length ? 'crit' : lowOpen.length ? 'warn' : null });
    // 6 offene Bestellungen
    const open = (s.purchases || []).filter(x => x.status === 'bestellt').sort((a, b) => a.etaT - b.etaT);
    const val = open.reduce((a, x) => a + (x.costEur || 0), 0);
    kpiSet('kPur', { v: U.fmtNum(open.length), sub: open.length ? `nächste Lieferung <b>${tclock(open[0].etaT, now)}</b><br>Bestellwert ${U.fmtEur(val)}` : 'keine Bestellung unterwegs' });
  }

  // ------------------------------------------------------------------ Fluss-Diagramm (dynamisch)
  function metricVal(e) { return V.metric === 'qty' ? e.qty + (e.m || 0) : V.metric === 'kg' ? e.kg : e.n; }
  function metricLabel(e) {
    if (V.metric === 'qty') return e.qty ? U.fmtNum(e.qty) : e.m ? U.fmtNum(e.m, 1) + ' m' : '0';
    if (V.metric === 'kg') return e.kg ? kg(e.kg) : e.m ? U.fmtNum(e.m, 1) + ' m' : '–';
    return U.fmtNum(e.n);
  }
  function updateFlow(s, flows) {
    const r = V.r, now = s.t;
    const edges = flows.filter(e => V.nodeById[e.from] && V.nodeById[e.to] && (e.n > 0 || e.open.length || e.direct));
    // Kanten: Geometrie und DOM nur neu, wenn sich die Kantenmenge (oder die Kennzahl) ändert; sonst Breiten, Klassen und
    // Beschriftungen gezielt nachführen. Bei hohem Tempo (≥ 120×) höchstens 1×/s – die Punkte laufen in frame() weiter.
    const structSig = V.metric + '|' + edges.map(e => e.key).sort().join(',');
    const realNow = performance.now(), fast = !!(WF.app && WF.app.speed >= 120);
    const throttled = fast && V.edgeSig && realNow - (V._edgeT || 0) < 1000;
    if (!throttled) {
      V._edgeT = realNow;
      if (structSig !== V.edgeSig) { V.edgeSig = structSig; buildEdges(edges); }
      else patchEdges(edges, now);
    } else for (const e of edges) { const E = V.edges.get(e.key); if (E) E.data = e; }
    r.empty.hidden = edges.length > 0;
    // Live-Zähler
    const live = []; for (const e of edges) for (const x of e.live) live.push(x);
    const loaded = live.filter(x => x.status === 'loaded' || x.status === 'toDrop');
    setText(r.liveT, live.length ? `${live.length} ${live.length > 1 ? 'Transporte laufen' : 'Transport läuft'}` : 'kein Transport unterwegs');
    setCls(r.live, 'idle', !live.length);
    // Punkte für beladene Transporte
    const dsig = loaded.map(x => x.id).sort().join(',');
    if (dsig !== V.dotSig) {
      V.dotSig = dsig;
      const keep = new Set(loaded.map(x => x.id));
      for (const [id, d] of V.dots) if (!keep.has(id)) { d.el.remove(); V.dots.delete(id); }
      for (const x of loaded) {
        if (V.dots.has(x.id)) continue;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'mt-dot');
        g.innerHTML = '<circle class="h" r="9.5"/><circle class="c" r="4.6"/>';
        r.gDots.append(g);
        V.dots.set(x.id, { el: g, rec: x, f: null });
      }
    }
    for (const [id, d] of V.dots) { const rec = L.tr.get(id); if (rec) d.rec = rec; }
    // Knoten: Zustand, Puffer, Abholbereit-Badge, Zusammenfassungen
    // Abholbereit (fällig, orange) vs. vorgemerkt (Ziel voll, neutral) – vorgemerkte Behälter sind kein Logistik-Rückstand
    const waitCount = {}, planCount = {}, pickCount = {};
    for (const tid in s.transports) {
      const t = s.transports[tid];
      if (t.status === 'done' || t.pickupT != null || t.cancelled) continue;
      const cnt = t.status === 'open' && phaseOf(t) === 'geplant' ? planCount : waitCount;
      cnt[t.from.station] = (cnt[t.from.station] || 0) + 1;
      if (t.status === 'toPickup') pickCount[t.from.station] = 1;
    }
    for (const n of V.nodes) {
      const el = n.el;
      if (n.kind === 'machine') {
        const m = s.machines[n.id];
        if (m) {
          const st = WF.STATE[m.state] || WF.STATE.idle;
          setVar(el, '--c', st.color);
          setCls(el, 'run', m.state === 'running');
          setCls(el, 'fault', m.state === 'fault');
          setCls(el, 'wait', st.group === 'wait');
        }
        const sto = s.stations[n.id];
        if (sto) {
          const ci = n.st.inCap || 0, co = n.st.outCap || 0;
          if (n.k.in) setText(n.k.in, sto.inp.length + '/' + ci);
          if (n.k.on) setText(n.k.on, sto.out.length + '/' + co);
          for (let i = 0; i < 4; i++) {
            const pi = n.k['i' + i]; if (pi) { const on = i < sto.inp.length; setAttr(pi, 'class', 'pip' + (on ? ' on' : '')); }
            const po = n.k['o' + i];
            if (po) {
              const c = s.containers[sto.out[i]];
              const full = sto.out.length >= co && co > 0 && m && m.state === 'blocked';
              setAttr(po, 'class', 'pip' + (c ? (full ? ' full' : c.state === 'ready' ? ' rd' : c.state === 'filling' ? ' fl' : ' on') : ''));
            }
          }
        }
      } else if (n.k.sub) fitSub(n, nodeSub(n.id, s, now));
      const wc = waitCount[n.id] || 0, pcn = planCount[n.id] || 0;
      setCls(el, 'haswait', wc > 0);
      setCls(el, 'hasplan', wc === 0 && pcn > 0);
      if (n.k.bdg) setText(n.k.bdg, wc || pcn);
      setCls(el, 'pick', !!pickCount[n.id]);
    }
    // Informationsfluss: neue Zuteilung (Transport → Fahrzeug) als kurzer Impuls von der Quelle zum Fahrzeug
    const seen = V.trSeen || (V.trSeen = new Map());
    const pulseOk = V.visible && V._pulseT != null && now - V._pulseT < 120;
    for (const tid in s.transports) {
      const t = s.transports[tid];
      const prev = seen.get(tid);
      if (pulseOk && t.assignee && (t.status === 'toPickup' || t.status === 'assigned') && (!prev || !prev.assignee) && V.nodeById[t.from.station]) {
        const vid = s.agvs[t.assignee] ? t.assignee : (s.forklift ? s.forklift.id : null);
        if (vid && V.veh[vid]) addPulse(t.from.station, vid, s.agvs[t.assignee] ? s.agvs[t.assignee].name : shortName(personName(t.assignee)));
      }
      seen.set(tid, { assignee: t.assignee, status: t.status });
    }
    if (seen.size > 400) for (const k of seen.keys()) if (!s.transports[k]) seen.delete(k);
    V._pulseT = now;
    // Fahrzeuge: Farben/Ladung (Positionen in frame())
    for (const id in V.veh) {
      const v = V.veh[id];
      const a = s.agvs[id];
      let c, load, moving;
      if (a) { c = AGV_C[a.state] || 'var(--st-idle)'; load = !!a.load; moving = !!a.route || a.state === 'toPickup' || a.state === 'toDrop' || a.state === 'toCharge'; }
      else { const f = s.forklift, fs = forkState(s); c = fs.color; load = !!f.load; moving = f.state === 'driving' && !!fs.drv && fs.drv.state === 'driving'; }
      setVar(v.el, '--c', c);
      if (v.load.hidden === load) v.load.hidden = !load;
      setCls(v.el, 'moving', moving);
    }
    if (!V.visible) return;
    // Bilanz + stärkste Verbindungen
    updateFlowFoot(s, flows);
  }
  /** Unterzeile eines Lager-/Partner-Knotens setzen; zu lang → Kurzform bzw. gekürzt (nur bei Textänderung gemessen) */
  // Textbreite ohne Layout messen (Canvas) – kein erzwungenes Reflow im 4×/s-Takt
  let MCTX = null;
  function textW(txt) {
    try {
      if (!MCTX) { MCTX = document.createElement('canvas').getContext('2d'); MCTX.font = `500 11.5px ${getComputedStyle(document.body).getPropertyValue('--f-ui') || 'sans-serif'}`; }
      return MCTX.measureText(txt).width;
    } catch (e) { return txt.length * 5.6; }
  }
  function fitSub(n, t) {
    const el = n.k.sub, key = t.text + '|' + (t.cls || '');
    if (el._fit === key) return;
    el._fit = key;
    setAttr(el, 'class', 'sub' + (t.cls ? ' ' + t.cls : ''));
    const max = n.w - 36;
    let txt = t.text;
    if (t.short && textW(txt) > max) txt = t.short;
    let g = 0;
    while (txt.length > 6 && textW(txt) > max && g++ < 40) txt = txt.slice(0, -2).replace(/[\s·,…]+$/, '') + '…';
    el.textContent = txt;
  }
  function nodeSub(id, s, now) {
    switch (id) {
      case 'RAW': {
        const low = Object.values(s.materials).filter(m => m.onHand < m.min);
        const miss = (s.notifications || []).some(x => x.status === 'open' && String(x.key || '').indexOf('missing:') === 0);
        return miss ? { text: 'Material fehlt an Maschine', short: 'Material fehlt', cls: 'crit' } : low.length ? { text: low.length + ' unter Mindestbestand', short: low.length + ' unter Minimum', cls: 'warn' } : { text: Object.keys(s.materials).length + ' Materialien ok', cls: 'ok' };
      }
      case 'WE': { const st = s.stations.WE; const n = st ? st.out.length + st.inp.length : 0; return { text: n ? n + ' Behälter abholbereit' : 'frei', short: n + ' abholbereit' }; }
      case 'EXT': {
        const st = s.stations.EXT; const n = st ? st.inp.length : 0;
        return { text: n ? `${n} Behälter · ${stk(inQty(st.inp))} bereit` : 'leer', short: n ? `${n} Beh. · ${stk(inQty(st.inp))}` : 'leer' };
      }
      case 'SPERR': { const st = s.stations.SPERR; const q = st ? inQty(st.inp) : 0; return q ? { text: stk(q) + ' Ausschuss', cls: 'crit' } : { text: 'leer' }; }
      case 'VERSAND': return { text: `${stk(s.today.shipped || 0)} heute`, cls: (s.today.shipped || 0) > 0 ? 'ok' : '' };
      case 'HAERT': {
        const ext = extContainers(); const q = ext.reduce((a, c) => a + c.qty, 0);
        if (!ext.length) return { text: 'derzeit nichts extern' };
        const next = ext.map(c => c.location.returnT).sort((a, b) => a - b)[0];
        return { text: `${ext.length} Behälter · ${stk(q)} · zurück ab ${tclock(next, now)}`, short: `${stk(q)} · zurück ab ${tclock(next, now)}` };
      }
    }
    return { text: '' };
  }
  /** Linienstärke je Kante (auf 0,2 gerastert, damit kleine Mengenänderungen keine Attribut-Schreibvorgänge auslösen) */
  function widthFn(edges) {
    const vals = edges.filter(e => e.n > 0).map(metricVal);
    const vmax = Math.max(1, ...vals, V.metric === 'n' ? 6 : 1);
    return (e) => Math.round((e.n > 0 ? 1.8 + 7.2 * Math.sqrt(Math.max(0, metricVal(e)) / vmax) : e.direct ? 2.6 : 1.8) * 5) / 5;
  }
  /** Darstellungsart einer Kante: ext · pend (offen, heute noch keine Fahrt) · plan (nur vorgemerkt) · direct · live · recent */
  function edgeKinds(e, now) {
    const k = [];
    if (e.ext) k.push('ext');
    if (e.n === 0) {
      if (e.direct && !e.open.length) k.push('direct');
      else { k.push('pend'); if (e.open.length && e.open.every(isPlanned)) k.push('plan'); }
    }
    if (e.live.length) k.push('live');
    else if (e.lastT != null && now - e.lastT < 20 * 60) k.push('recent');
    return k;
  }
  const EDGE_KINDS = ['ext', 'pend', 'plan', 'direct', 'live', 'recent'];
  function setKinds(el, kinds, labelOnly) {
    for (const k of EDGE_KINDS) { if (labelOnly && (k === 'live' || k === 'recent')) continue; el.classList.toggle(k, kinds.indexOf(k) >= 0); }
  }
  function edgeLabel(e) {
    if (e.n === 0) {
      if (!e.open.length) return U.fmtNum(e.dm, 1) + ' m';
      const nd = e.open.filter(x => !isPlanned(x)).length;
      return nd ? `${nd} ${nd === 1 ? 'wartet' : 'warten'}` : `${e.open.length} vorgemerkt`;
    }
    return metricLabel(e);
  }
  const labelW = (txt) => Math.max(20, txt.length * 6.7 + 12);
  /** Pfeil + gekürzte Kurve für eine Linienstärke (verändert g.r0..r2) */
  function edgeShape(g, w) {
    const ah = Math.max(4.2, w * 0.55 + 2.6), al = ah * 1.7;
    trimEnd(g, al - 1);
    const tip = g.tip, dir = g.dir, bx = tip.x - dir.x * al, by = tip.y - dir.y * al;
    return { d: dPath(g), arrow: `M${f1(tip.x)},${f1(tip.y)} L${f1(bx - dir.y * ah)},${f1(by + dir.x * ah)} L${f1(bx + dir.y * ah)},${f1(by - dir.x * ah)} Z` };
  }
  /** Werte nachführen ohne Neuaufbau: Klassen, Linienstärken (inkl. Pfeil/Kürzung), Beschriftungen */
  function patchEdges(edges, now) {
    const wf = widthFn(edges);
    for (const e of edges) {
      const E = V.edges.get(e.key); if (!E || !E.g) continue;
      E.data = e;
      const kinds = edgeKinds(e, now), ks = kinds.join(' ');
      if (ks !== E.ks) { E.ks = ks; setKinds(E.g, kinds); if (E.lab) setKinds(E.lab, kinds, true); }
      const w = wf(e);
      if (w !== E.w && E.geo) {
        E.w = w;
        const sh = edgeShape(E.geo, w);
        for (const p of [E.pg, E.pb, E.pf]) p.setAttribute('d', sh.d);
        E.pa.setAttribute('d', sh.arrow);
        E.pg.style.strokeWidth = f1(w + 8); E.pb.style.strokeWidth = f1(w); E.pf.style.strokeWidth = f1(Math.max(1.3, w * 0.36)); E.ph.style.strokeWidth = f1(Math.max(16, w + 10));
        E.lut = lutOf(E.geo);
      }
      const txt = edgeLabel(e);
      if (txt !== E.txt && E.lt) {
        E.txt = txt; E.lt.textContent = txt;
        const tw = labelW(txt); E.lr.setAttribute('width', f1(tw)); E.lr.setAttribute('x', f1(-tw / 2));
      }
    }
  }
  function buildEdges(edges) {
    const r = V.r, now = S().t;
    const width = widthFn(edges);
    // breite Kanten zuerst platzieren (bekommen die „gute“ Seite), Gegenrichtung jeweils auf die andere Seite
    const sorted = edges.slice().sort((a, b) => metricVal(b) - metricVal(a) || b.open.length - a.open.length);
    const nodes = V.nodes.filter(n => n.kind !== 'charge');
    const placed = new Map(), list = [];
    for (const e of sorted) {
      const a = V.nodeById[e.from], b = V.nodeById[e.to];
      const rev = placed.get(e.to + '>' + e.from);
      const c = chooseCurve(a, b, nodes, rev ? (rev.sgn || 1) : 0);
      placed.set(e.key, c);
      list.push({ e, a, b, c });
    }
    const pf = V.prof; let pt = pf ? performance.now() : 0; const plap = (k) => { if (!pf) return; const n = performance.now(); pf[k] = Math.max(pf[k] || 0, n - pt); pt = n; };
    plap('be_curve');
    assignPorts(list);
    plap('be_ports');
    let eh = '', lh = '';
    const labels = [];
    const labelFree = (x, y, w, hh) => {
      for (const l of labels) if (Math.abs(l.x - x) < (l.w + w) / 2 + 3 && Math.abs(l.y - y) < (l.h + hh) / 2 + 2) return false;
      for (const n of V.nodes) if (Math.abs(n.cx - x) < (n.w + w) / 2 + 3 && Math.abs(n.cy - y) < (n.h + hh) / 2 + 3) return false;
      return true;
    };
    // DOM: schmale Kanten zuletzt (oben), damit sie anklickbar bleiben
    for (const it of list.slice().reverse()) {
      const e = it.e, g = it.g;
      const w = width(e);
      it.w = w; it.ks = edgeKinds(e, now).join(' ');
      const cls = 'mt-e' + (it.ks ? ' ' + it.ks : '');
      const sh = edgeShape(g, w);
      eh += `<g class="${cls}" data-edge="${esc(e.key)}">
        <path class="g" d="${sh.d}" style="stroke-width:${f1(w + 8)}"/>
        <path class="b" d="${sh.d}" style="stroke-width:${f1(w)}" data-p="1"/>
        <path class="f" d="${sh.d}" style="stroke-width:${f1(Math.max(1.3, w * 0.36))}"/>
        <path class="a" d="${sh.arrow}"/>
        <path class="h" d="${dFull(g)}" style="stroke-width:${f1(Math.max(16, w + 10))}"/>
      </g>`;
    }
    for (const it of list) {
      const e = it.e, g = it.g;
      const txt = edgeLabel(e);
      it.txt = txt;
      const tw = labelW(txt), th = 18;
      let pos = null;
      for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73]) {
        const p = quad(g.r0, g.r1, g.r2, t);
        if (labelFree(p.x, p.y, tw, th)) { pos = p; break; }
      }
      if (!pos) pos = quad(g.r0, g.r1, g.r2, 0.5);
      labels.push({ x: pos.x, y: pos.y, w: tw, h: th });
      const lk = it.ks.split(' ').filter(k => k && k !== 'live' && k !== 'recent').join(' ');
      lh += `<g class="mt-el${lk ? ' ' + lk : ''}" data-lab="${esc(e.key)}" transform="translate(${f1(pos.x)},${f1(pos.y)})"><rect x="${f1(-tw / 2)}" y="${-th / 2}" width="${f1(tw)}" height="${th}" rx="${th / 2}"/><text y="4.2" text-anchor="middle">${esc(txt)}</text></g>`;
    }
    plap('be_html');
    r.gEdges.innerHTML = eh;
    r.gLabels.innerHTML = lh;
    // Bereichsbeschriftungen ausblenden, wenn eine Kantenbeschriftung darüber liegt
    for (const a of V.areas || []) {
      const hit = labels.some(l => Math.abs(l.x - a.x) < (l.w + a.w) / 2 && Math.abs(l.y - a.y) < (l.h + a.h) / 2);
      const el = r.gBase.querySelector(`[data-area="${a.name}"]`);
      if (el) el.style.visibility = hit ? 'hidden' : '';
    }
    plap('be_dom');
    V.edges = new Map();
    const gEls = {}, lEls = {};
    for (const n of r.gEdges.children) gEls[n.dataset.edge] = n;
    for (const n of r.gLabels.children) lEls[n.dataset.lab] = n;
    for (const it of list) {
      const gE = gEls[it.e.key], lE = lEls[it.e.key], P = gE ? gE.children : [];
      V.edges.set(it.e.key, { g: gE, lab: lE, pg: P[0], pb: P[1], pf: P[2], pa: P[3], ph: P[4], lr: lE ? lE.firstElementChild : null, lt: lE ? lE.lastElementChild : null,
        geo: it.g, w: it.w, ks: it.ks, txt: it.txt, lut: lutOf(it.g), data: it.e });
    }
    plap('be_len');
    if (V.hl) { const k = V.hl; V.hl = null; applyHl(k); }
    markPinned();
    for (const [, d] of V.dots) d.f = null;
  }
  function updateFlowFoot(s, flows) {
    const r = V.r, now = s.t;
    if (WF.app && WF.app.speed >= 120 && V.sig.top && performance.now() - (V._footT || 0) < 1000) return;
    V._footT = performance.now();
    const inHouse = flows.filter(e => !e.ext);
    const n = inHouse.reduce((a, e) => a + e.n, 0), q = inHouse.reduce((a, e) => a + e.qty, 0), w = inHouse.reduce((a, e) => a + e.kg, 0);
    const extOut = L.ext.filter(x => x.t >= dayStart(now) && x.type === 'out'), extIn = L.ext.filter(x => x.t >= dayStart(now) && x.type === 'in');
    const agv = inHouse.reduce((a, e) => a + (e.modes.AGV || 0), 0), stp = inHouse.reduce((a, e) => a + (e.modes.Stapler || 0), 0);
    const nDone = s.today && s.today.transports != null ? s.today.transports : n, nLive = inHouse.reduce((a, e) => a + e.live.length, 0);
    const bil = `<div><b>${U.fmtNum(nDone)}${nLive ? `<small>+${nLive} laufend</small>` : ''}</b><span>Fahrten erledigt</span></div><div><b>${U.fmtNum(q)}<small>Stk</small></b><span>Teile bewegt</span></div><div><b>${w >= 1000 ? U.fmtNum(w / 1000, 1) + '<small>t</small>' : U.fmtNum(w) + '<small>kg</small>'}</b><span>Gewicht inkl. Behälter</span></div><div><b>${extOut.length}<small>raus</small> ${extIn.length}<small>zurück</small></b><span>Lose ${esc(haertName())}</span></div>`;
    setHTML(r.bil, bil);
    setText(r.bilSince, 'seit ' + U.fmtClock(Math.max(dayStart(now), s.startT || 0)) + ' · Stand ' + U.fmtClock(now));
    const tot = Math.max(1, agv + stp);
    setHTML(r.modesBar, `<i style="width:${(agv / tot * 100).toFixed(1)}%;background:var(--accent)"></i><i style="width:${(stp / tot * 100).toFixed(1)}%;background:var(--mat)"></i>`);
    setHTML(r.modesL, `<span style="--c:var(--accent)"><i></i>AGV <b>${agv}</b> Fahrten</span><span style="--c:var(--mat)"><i></i>Stapler <b>${stp}</b> Fahrten (über 250 kg, Stangen)</span>`);
    // Servicegrad der Logistik: ab „fällig“ (Ziel hat Platz) innerhalb 5 min abgeholt, Ø Fahrzeit; vorgemerkte Behälter
    // (Ziel voll) sind kein Logistikverzug und stehen getrennt
    let n5 = 0, nP = 0, drive = 0, nD = 0, nPlan = 0;
    const d0 = dayStart(now);
    for (const x of L.tr.values()) {
      if (x.cancelled || x.pickupT == null || x.pickupT < d0 || x.kind === 'empty') continue;
      nP++; if (waitOf(x, now) <= 300) n5++;
      if (plannedSec(x, now) > 60) nPlan++;
      if (x.doneT != null) { drive += x.doneT - x.pickupT; nD++; }
    }
    const sl = nP ? n5 / nP : null;
    setHTML(r.svc, `<div><b class="${sl == null ? '' : sl >= 0.85 ? 'ok' : 'warn'}">${sl == null ? '–' : U.fmtPct(sl)}</b><span>fällig → abgeholt in ≤ 5 min</span></div><div><b>${nD ? dur(drive / nD) : '–'}</b><span>Ø Fahrt bis Ziel</span></div><div><b>${nPlan}<small> × vorgemerkt</small></b><span>Ziel war voll – keine Wartezeit</span></div>`);
    // stärkste Verbindungen
    const top = flows.filter(e => e.n > 0).sort((a, b) => metricVal(b) - metricVal(a)).slice(0, 5);
    const vmax = Math.max(1, ...top.map(metricVal));
    const sig = V.metric + '|' + (V.relFilter ? V.relFilter.key : '') + '|' + top.map(e => e.key + ':' + metricVal(e)).join(',');
    if (sig !== V.sig.top) {
      V.sig.top = sig;
      setHTML(r.top, top.length ? top.map(e => `<button class="mt-topr${V.relFilter && V.relFilter.key === e.key ? ' on' : ''}" data-rel="${esc(e.key)}"><span class="rel"><span>${esc(stName(e.from))}</span>${ICO('arrowRight', 12)}<span>${esc(stName(e.to))}</span></span>${WF.ui.bar(metricVal(e) / vmax, { color: e.ext ? 'var(--ext)' : 'var(--mat)' })}<b>${esc(metricLabel(e))}</b></button>`).join('')
        : '<div class="muted" style="font-size:var(--fs-sm);padding:6px 0">Heute noch keine Fahrten.</div>');
      r.top.querySelectorAll('[data-rel]').forEach(b => {
        b.onclick = () => { const k = b.dataset.rel; if (k.indexOf('HAERT') >= 0) { V.r.ctCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } setRelFilter(V.relFilter && V.relFilter.key === k ? null : { key: k, from: k.split('>')[0], to: k.split('>')[1] }); };
        b.onmouseenter = () => applyHl('edge:' + b.dataset.rel);
        b.onmouseleave = () => clearHl();
      });
    }
  }
  /** Impuls „Auftrag an Fahrzeug“ (Informationsfluss, cyan) */
  function addPulse(fromId, vehId, name) {
    if (!V.pulses) V.pulses = [];
    if (V.pulses.length > 6) return;
    const n = V.nodeById[fromId];
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mt-pulse');
    g.innerHTML = `<path class="pl" d=""/><circle class="pc" r="3.2"/><g class="pt"><rect rx="8" height="16" y="-8"/><text y="3.6" text-anchor="middle"></text></g>`;
    const label = 'Auftrag an ' + name;
    g.querySelector('text').textContent = label;
    const tw = label.length * 6.4 + 14;
    const rc = g.querySelector('rect'); rc.setAttribute('width', tw.toFixed(0)); rc.setAttribute('x', (-tw / 2).toFixed(0));
    V.r.gDots.append(g);
    V.pulses.push({ g, path: g.querySelector('.pl'), dot: g.querySelector('.pc'), tag: g.querySelector('.pt'), n, vehId, age: 0 });
  }
  // Animation: Fahrzeuge auf den Gängen, Behälterpunkte entlang ihrer Kante
  function frame(dt) {
    if (!V.mounted || !V.visible) return;
    const s = S(); if (!s || !s.agvs) return;
    const k = Math.min(1, (dt || 0.016) * 14);
    for (const id in V.veh) {
      const v = V.veh[id];
      const ent = s.agvs[id] || (s.forklift && s.forklift.id === id ? s.forklift : null);
      if (!ent || !ent.pos) continue;
      let tx = PX(ent.pos.x), ty = PY(ent.pos.z);
      // nicht über Stationskarten zeichnen: an den nächsten Kartenrand (Gangseite) schieben
      for (const n of V.nodes) {
        if (Math.abs(tx - n.cx) < n.w / 2 + 8 && Math.abs(ty - n.cy) < n.h / 2 + 8) { ty = n.cy < MAIN_Y ? n.cy + n.h / 2 + 10 : n.cy - n.h / 2 - 10; break; }
      }
      if (v.x == null || Math.hypot(tx - v.x, ty - v.y) > 140) { v.x = tx; v.y = ty; }
      else { v.x += (tx - v.x) * k; v.y += (ty - v.y) * k; }
      const h = ent.heading || 0;
      const ang = Math.atan2(Math.cos(h) * KZ, Math.sin(h) * KX) * 180 / Math.PI;
      let da = ((ang - v.ang + 540) % 360) - 180; v.ang += da * Math.min(1, k * 1.4);
      v.el.setAttribute('transform', `translate(${v.x.toFixed(1)},${v.y.toFixed(1)})`);
      v.body.setAttribute('transform', `rotate(${v.ang.toFixed(1)})`);
      const below = v.y < PY(8);
      if (v._below !== below) { v._below = below; v.txt.setAttribute('y', below ? '20' : '-10'); }
    }
    if (V.pulses && V.pulses.length) {
      const LIFE = 1.8;
      V.pulses = V.pulses.filter(p => {
        p.age += dt || 0.016;
        if (p.age > LIFE) { p.g.remove(); return false; }
        const v = V.veh[p.vehId]; if (!v || v.x == null) return true;
        const ax = p.n.cx, ay = p.n.cy - p.n.h / 2, bx = v.x, by = v.y;
        const mx = (ax + bx) / 2, my = Math.max(PADT + 4, Math.min(ay, by) - 30);   // Beschriftung bleibt im Bild
        p.path.setAttribute('d', `M${ax.toFixed(1)},${ay.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`);
        const k2 = Math.min(1, p.age / 0.9), u = 1 - k2;
        const px = u * u * ax + 2 * u * k2 * mx + k2 * k2 * bx, py = u * u * ay + 2 * u * k2 * my + k2 * k2 * by;
        p.dot.setAttribute('cx', px.toFixed(1)); p.dot.setAttribute('cy', py.toFixed(1));
        p.tag.setAttribute('transform', `translate(${mx.toFixed(1)},${(my + 8).toFixed(1)})`);
        p.g.style.opacity = String(p.age < LIFE - 0.5 ? 1 : Math.max(0, (LIFE - p.age) / 0.5));
        return true;
      });
    }
    for (const [, d] of V.dots) {
      const rec = d.rec; const E = rec && V.edges.get(rec.from + '>' + rec.to);
      if (!E || !E.lut) { d.el.setAttribute('visibility', 'hidden'); continue; }
      const f = routeProgress(rec.from, rec.to, carrierPos(rec));
      d.f = d.f == null ? f : d.f + (f - d.f) * k;
      const p = lutPoint(E.lut, d.f);
      d.el.setAttribute('visibility', 'visible');
      d.el.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    }
  }

  // ------------------------------------------------------------------ Flotte
  function buildFleet() {
    const s = S(); if (!s) return;
    const ids = Object.keys(s.agvs);
    let h = '';
    for (const id of ids) {
      const a = s.agvs[id];
      h += `<button class="mt-vc" data-id="${esc(id)}" data-kind="agv">
        <div class="mt-vc-h"><span class="mt-vc-ic">${ICO('agv', 19)}</span><div class="mt-vc-n"><b>${esc(a.name)}</b><span data-v="sub">Fahrerloses Transportfahrzeug · max. ${U.fmtNum(a.maxKg)} kg</span></div><span data-v="pill"></span></div>
        <div class="mt-vc-b">
          <div class="mt-gauge" data-v="gauge"><svg width="62" height="62" viewBox="0 0 62 62"><circle class="gt" cx="31" cy="31" r="26"/><circle class="gv" data-v="arc" cx="31" cy="31" r="26" transform="rotate(-90 31 31)" stroke-dasharray="163.4" stroke-dashoffset="163.4"/></svg><div class="gl"><b data-v="bat">–</b><span data-v="batl">Akku</span></div></div>
          <div class="mt-vc-task"><span class="eyebrow" data-v="eye">Aktueller Auftrag</span><div class="mt-vc-rel" data-v="rel">–</div><div class="mt-vc-cargo" data-v="cargo">–</div>
            <div class="mt-route" data-v="route"><span class="ln"></span><span class="pr" data-v="pr"></span><span class="e a"></span><span class="e b"></span><span class="vm" data-v="vm"></span></div></div>
        </div>
        <div class="mt-vc-f"><div><b data-v="f1">–</b><span>Fahrten heute</span></div><div><b data-v="f2">–</b><span>Strecke heute</span></div><div><b data-v="f3">–</b><span>Auslastung Schicht</span></div></div>
      </button>`;
    }
    if (s.forklift) {
      const f = s.forklift;
      h += `<button class="mt-vc" data-id="${esc(f.id)}" data-kind="stp">
        <div class="mt-vc-h"><span class="mt-vc-ic">${ICO('forklift', 19)}</span><div class="mt-vc-n"><b>${esc(f.name)}</b><span>Gabelstapler · Behälter über 250 kg und Stangenmaterial</span></div><span data-v="pill"></span></div>
        <div class="mt-vc-b">
          <div class="mt-fk-ava" data-v="ava">–</div>
          <div class="mt-vc-task"><span class="eyebrow" data-v="eye">Fahrer:in</span><div class="mt-vc-rel" data-v="rel">–</div><div class="mt-vc-cargo" data-v="cargo">–</div>
            <div class="mt-route" data-v="route"><span class="ln"></span><span class="pr" data-v="pr"></span><span class="e a"></span><span class="e b"></span><span class="vm" data-v="vm"></span></div></div>
        </div>
        <div class="mt-vc-f"><div><b data-v="f1">–</b><span>Fahrten heute</span></div><div><b data-v="f2">–</b><span>davon Stangen</span></div><div><b data-v="f3">–</b><span>Auslastung Schicht</span></div></div>
      </button>`;
    }
    V.r.fleet.innerHTML = h;
    V.fleet = {};
    V.r.fleet.querySelectorAll('.mt-vc').forEach(el => {
      const k = {}; el.querySelectorAll('[data-v]').forEach(x => { k[x.dataset.v] = x; });
      V.fleet[el.dataset.id] = { el, k, kind: el.dataset.kind };
      el.onclick = () => WF.app.select('agv', el.dataset.id);
    });
  }
  function routeVis(k, rec, stage, frac, color) {
    // stage: 'none' | 'approach' | 'load' | 'drive' | 'unload'
    k.route.hidden = stage === 'none';
    if (stage === 'none') return;
    const f = stage === 'approach' || stage === 'load' ? 0 : stage === 'unload' ? 1 : U.clamp(frac, 0, 1);
    k.pr.style.width = `calc((100% - 10px) * ${f.toFixed(3)})`;
    k.vm.style.left = `calc((100% - 12px) * ${f.toFixed(3)})`;
    setVar(k.route, '--c', color);
    setVar(k.vm, '--c', color);
    k.vm.style.opacity = stage === 'approach' ? '.55' : '1';
  }
  function updateFleet(s) {
    if (!V.fleet) return;
    const now = s.t, d0 = dayStart(now);
    const ids = Object.keys(s.agvs);
    setText(V.r.fleetSub, `${ids.length} AGVs (bis 250 kg) und 1 Stapler · Zuteilung automatisch nach Weg, Akku und Gewicht`);
    for (const id of ids) {
      const F = V.fleet[id]; if (!F) continue;
      const a = s.agvs[id], k = F.k, c = AGV_C[a.state] || 'var(--st-idle)';
      setVar(F.el, '--c', c);
      const since = L.since[id];
      setHTML(k.pill, pill(c, lbl('agv', a.state)));
      // Akku
      const b = U.clamp(a.battery, 0, 100);
      const gc = b < (cfg().batteryLow || 25) ? 'var(--st-fault)' : b < 50 ? 'var(--st-wait)' : 'var(--st-run)';
      setVar(k.gauge, '--gc', gc);
      setAttr(k.arc, 'stroke-dashoffset', (163.4 * (1 - b / 100)).toFixed(1));
      setText(k.bat, U.fmtNum(b, 0) + ' %');
      const charging = a.state === 'charging';
      setCls(k.gauge, 'chg', charging);
      setHTML(k.batl, charging ? `${ICO('bolt', 9)}lädt` : a.mustCharge ? 'muss laden' : 'Akku');
      // Auftrag
      const tr = a.task ? (L.tr.get(a.task) || null) : null;
      const st = a.task ? s.transports[a.task] : null;
      if (st) {
        setText(k.eye, `Auftrag ${st.id}`);
        setHTML(k.rel, `<span>${esc(stName(st.from.station))}</span>${ICO('arrowRight', 13)}<span>${esc(stName(st.to.station))}</span>`);
        const qty = tr && tr.qty != null ? stk(tr.qty) + ' ' : '';
        const what = (tr && tr.partName) || '';
        const phase = a.state === 'toPickup' ? 'Anfahrt zur Abholung' : a.state === 'loading' ? 'wird beladen' : a.state === 'unloading' ? 'wird entladen' : 'unterwegs zum Ziel';
        setText(k.cargo, `${phase} · ${qty}${what}${st.weightKg ? ' · ' + kg(st.weightKg) : ''}`);
        setCls(k.cargo, 'muted', false);
        const stage = a.state === 'toPickup' ? 'approach' : a.state === 'loading' ? 'load' : a.state === 'unloading' ? 'unload' : 'drive';
        routeVis(k, st, stage, routeProgress(st.from.station, st.to.station, a.pos), c);
      } else {
        setText(k.eye, a.state === 'charging' || a.state === 'toCharge' ? 'Laden' : 'Kein Auftrag');
        const full = a.state === 'charging' ? Math.max(0, ((a.mustCharge ? (cfg().batteryFull || 90) : 100) - a.battery) / (cfg().agvCharge || 0.12)) : null;
        setHTML(k.rel, `<span>${esc(placeText(a.pos))}</span>`);
        setText(k.cargo, a.state === 'charging' ? (a.mustCharge ? `Akku unter ${cfg().batteryLow || 25} % – gesperrt bis ${cfg().batteryFull || 90} %, ca. ${U.fmtClock(now + full)}` : `lädt nach, voll ca. ${U.fmtClock(now + full)} · übernimmt sofort Aufträge`)
          : a.state === 'toCharge' ? 'fährt zur Ladestation' : `bereit${a.freeSince != null ? ' seit ' + dur(now - a.freeSince) : ''} · übernimmt den nächsten Behälter`);
        setCls(k.cargo, 'muted', true);
        routeVis(k, null, 'none');
      }
      setText(k.f1, U.fmtNum(a.transportsToday));
      setText(k.f2, a.distToday >= 1000 ? U.fmtNum(a.distToday / 1000, 1) + ' km' : U.fmtNum(a.distToday) + ' m');
      const u = agvUtil(id);
      setText(k.f3, u == null ? '–' : U.fmtPct(u));
      if (since) F.el.title = `${a.name}: ${lbl('agv', a.state)} seit ${U.fmtClock(since.t)}`;
    }
    const f = s.forklift; const F = f && V.fleet[f.id];
    if (F) {
      const k = F.k;
      const fs = forkState(s);
      const drv = fs.drv, tr = fs.tr, c = fs.color;
      setVar(F.el, '--c', c);
      setHTML(k.pill, pill(c, fs.label));
      const lg = logistician();
      const who = drv || lg;
      setText(k.ava, who ? WF.ui.initials(who.name) : '–');
      setVar(k.ava, '--c', drv ? c : who ? (who.state === 'break' ? 'var(--st-wait)' : 'var(--st-run)') : 'var(--st-idle)');
      setCls(k.ava, 'none', !who);
      k.ava.title = who ? who.name + ' · ' + (who.activity || lbl('person', who.state)) : 'niemand mit Staplerschein im Dienst';
      if (tr) {
        setText(k.eye, `Auftrag ${tr.id} · ${shortName(personName(tr.assignee))}`);
        setHTML(k.rel, `<span>${esc(stName(tr.from))}</span>${ICO('arrowRight', 13)}<span>${esc(stName(tr.to))}</span>`);
        const what = tr.kind === 'bars' ? `Stangen ${matName(tr.materialId)}${tr.meters ? ' · ' + U.fmtNum(tr.meters, 1) + ' m' : ''}` : `${tr.qty != null ? stk(tr.qty) + ' ' : ''}${tr.partName || ''} · ${kg(tr.weightKg)}`;
        setText(k.cargo, `${fs.phase || trStatusLabel(tr)} · ${what}`);
        setCls(k.cargo, 'muted', false);
        const stage = tr.status === 'assigned' || tr.status === 'toPickup' ? (drv && drv.state === 'working' ? 'load' : 'approach') : (drv && drv.state === 'working' ? 'unload' : 'drive');
        routeVis(k, tr, stage, routeProgress(tr.from, tr.to, f.pos), c);
      } else {
        setText(k.eye, 'Fahrer:in');
        setHTML(k.rel, `<span>${who ? esc(who.name) : 'niemand im Dienst'}</span>`);
        setText(k.cargo, who ? `${who.state === 'break' ? 'in der Pause' : (who.activity || lbl('person', who.state))} · Stapler ${placeText(f.pos)}` : `Stapler abgestellt ${placeText(f.pos)} · Staplertransporte warten auf die nächste Schicht`);
        setCls(k.cargo, 'muted', true);
        routeVis(k, null, 'none');
      }
      const todays = transportsToday().filter(r => r.mode === 'Stapler' && !r.cancelled && r.status === 'done');
      setText(k.f1, U.fmtNum(todays.length));
      setText(k.f2, U.fmtNum(todays.filter(r => r.kind === 'bars').length));
      const fu = forkUtil();
      setText(k.f3, fu == null ? '–' : U.fmtPct(fu));
    }
    markSel();
  }
  /** Stapler-Zustand aus Fahrer:in und Transport (Engine kennt nur parked/driving) */
  function forkState(s) {
    const f = s.forklift; if (!f) return null;
    const drv = f.driver ? s.people[f.driver] : null;
    const tr = activeForkliftTransport(s);
    if (f.state !== 'driving' || !drv) return { label: lbl('forklift', 'parked'), color: 'var(--st-idle)', drv, tr, phase: null };
    if (drv.state === 'working') {
      const picking = tr && (tr.status === 'toPickup' || tr.status === 'assigned');
      return { label: picking ? 'Nimmt auf' : tr && tr.kind === 'bars' ? 'Lädt Stangen ein' : 'Stellt ab', color: 'var(--mat)', drv, tr, phase: drv.activity };
    }
    if (drv.state === 'walking') return { label: 'Fahrer:in kommt', color: 'var(--info)', drv, tr, phase: drv.activity };
    return { label: f.load ? 'Fährt beladen' : 'Fährt leer', color: f.load ? 'var(--mat)' : 'var(--info)', drv, tr, phase: drv.activity };
  }
  function activeForkliftTransport(s) {
    for (const tid in s.transports) {
      const t = s.transports[tid];
      if (t.mode !== 'Stapler' || t.status === 'done' || t.status === 'open' || !t.assignee) continue;
      return L.tr.get(tid) || Object.assign({ id: tid, from: t.from.station, to: t.to.station }, t, { from: t.from.station, to: t.to.station });
    }
    return null;
  }

  // ------------------------------------------------------------------ Transportaufträge
  function trRow(r, now) {
    const s = S();
    const done = r.status === 'done';
    const plan = isPlanned(r);
    const wOpen = r.status === 'open' && !plan && r.kind !== 'empty' ? waitOf(r, now) : 0;
    // Farbe = Aussage: vorgemerkt (Ziel voll) ruhig, fällig neutral, erst lange Wartezeit warnt; zugeteilt = Information, beladen = Material
    const c = r.cancelled ? 'var(--faint)' : plan ? 'var(--line2)' : wOpen > WAIT_CRIT ? 'var(--st-fault)' : wOpen > WAIT_WARN ? 'var(--st-wait)' : TR_C[r.status] || 'var(--muted)';
    const o = r.orderId ? s.orders[r.orderId] : null;
    let content;
    if (r.kind === 'bars') {
      content = `<button class="lnk" data-sel="material|${esc(r.materialId)}"><b>${r.meters ? U.fmtNum(r.meters, 1) + ' m ' : ''}Stangen</b> ${esc(matName(r.materialId))}</button><span class="mt-s">${r.orderId ? `<button class="lnk mono" data-sel="order|${esc(r.orderId)}">${esc(r.orderId)}</button> · ` : ''}Nachschub Stangenlader ${esc(r.to)}</span>`;
    } else if (r.kind === 'empty') {
      const nE = r.empties || 1;
      content = `<b>${nE} Leerbehälter</b>${nE > 1 ? ' gestapelt' : ''}<span class="mt-s">Leergut zurück an ${esc(stName(r.to))}</span>`;
    } else {
      const toOp = o && r.seq != null ? o.routing.find(x => x.seq === r.seq) : null;
      const kindTxt = r.kind === 'supply' ? 'Rohteile' : r.kind === 'ext-out' ? 'zur Härterei' : r.kind === 'ext-in' ? 'aus der Härterei' : null;
      content = `<b>${r.qty != null ? stk(r.qty) : '–'}</b> ${esc(r.partName || '')}<span class="mt-s">${r.orderId ? `<button class="lnk mono" data-sel="order|${esc(r.orderId)}" title="${esc(o ? o.customer : '')}">${esc(r.orderId)}</button> · ` : ''}${r.containerId ? `<button class="lnk mono" data-sel="container|${esc(r.containerId)}">${esc(r.containerId)}</button> · ` : ''}${toOp ? (toOp.station === 'VERSAND' ? 'in den Versand' : 'für AG ' + toOp.seq + ' ' + esc(toOp.op)) : r.to === 'VERSAND' ? 'in den Versand' : ''}</span>`;
    }
    const KT = { container: 'Behälter', supply: 'Rohteile', 'ext-out': 'zur Härterei', 'ext-in': 'aus Härterei', bars: 'Stangen', empty: 'Leergut' };
    const ord = `<span class="mono mt-trid">${esc(r.id)}</span><span class="mt-s">${esc(KT[r.kind] || r.kind)}</span>`;
    const rel = `<span class="mt-rel">${esc(stName(r.from))} ${ICO('arrowRight', 12)} ${esc(stName(r.to))}</span><span class="mt-s">${esc(r.from)} → ${esc(r.to)}</span>`;
    const mode = `<span class="mt-mode${r.mode === 'Stapler' ? ' stp' : ''}">${ICO(r.mode === 'AGV' ? 'agv' : 'forklift', 13)}${esc(r.mode)}</span>${r.carrier ? `<span class="mt-s">${esc(r.carrier)}</span>` : `<span class="mt-s">noch nicht zugeteilt</span>`}`;
    const status = plan ? `<span class="mt-planpill">${esc(trStatusLabel(r))}</span>` : pill(c, trStatusLabel(r));
    let time, why;
    const w = waitOf(r, now);
    const wcls = r.kind === 'empty' ? '' : w > WAIT_CRIT ? ' crit' : w > WAIT_WARN ? ' warn' : '';
    const ps = plannedSec(r, now);
    if (done) {
      time = `<span class="mt-w">fertig ${tclock(r.doneT, now)}</span><span class="mt-s">${r.pickupT != null ? `Wartezeit ${dur(w)} · Fahrt ${dur(r.doneT - r.pickupT)}` : 'Dauer ' + dur(r.doneT - r.createdT)}</span>`;
      why = r.cancelled ? '<span class="mt-why muted">Transport entfallen (Behälter umgebucht)</span>'
        : (r.pickupT != null && w > 300 && r.why) ? `<span class="mt-why">wartete: ${esc(whyShort(r.why))}</span>`
        : ps > 300 ? `<span class="mt-why muted">vorgemerkt ${dur(ps)} – Ziel war voll</span>` : '<span class="mt-why muted">–</span>';
    } else if (r.pickupT != null) {
      time = `<span class="mt-w">unterwegs ${dur(now - r.pickupT)}</span><span class="mt-s">Wartezeit ${dur(w)}${ps > 300 ? ' · vorher vorgemerkt' : ''}</span>`;
      why = `<span class="mt-why">${esc((r.carrier || '') + (r.kind === 'bars' ? ' bringt die Stangen zu ' : r.kind === 'empty' ? ' bringt das Leergut zu ' : ' bringt den Behälter nach ') + stName(r.to))}</span>`;
    } else if (plan) {
      // vorgemerkt: Behälter steht bereit, das Ziel ist voll – keine Wartezeit-Uhr, keine Warnfarbe
      time = `<span class="mt-w mt-wplan">bereitgestellt</span><span class="mt-s">seit ${tclock(r.createdT, now)}</span>`;
      const s2 = s.transports[r.id];
      why = `<span class="mt-why">${esc(planReason((s2 && s2.waitReason) || r.planWhy))}</span>`;
    } else {
      time = `<span class="mt-w${wcls}">wartet ${dur(w)}</span><span class="mt-s">${r.everPlanned ? 'fällig seit ' + tclock(waitStart(r), now) : 'bereit seit ' + tclock(r.createdT, now)}</span>`;
      const s2 = s.transports[r.id];
      const reason = r.status === 'open' ? (s2 && s2.waitReason) || r.waitReason || 'wartet auf Zuteilung' : r.status === 'assigned' ? `${r.carrier || 'Logistik'} geht zum Stapler` : `${r.carrier || 'Fahrzeug'} fährt zur Abholung`;
      why = `<span class="mt-why">${esc(reason)}</span>`;
    }
    const sel = r.kind === 'bars' ? 'material|' + r.materialId : r.containerId ? 'container|' + r.containerId : '';
    return `<tr class="click${done ? ' done' : ''}${plan ? ' plan' : ''}" data-row="${esc(sel)}"><td class="st" style="--c:${c}"></td>
      <td class="nw">${ord}</td><td>${content}</td><td class="nw">${rel}</td><td class="r nw">${r.weightKg ? kg(r.weightKg) : '–'}</td>
      <td class="nw">${mode}</td><td class="nw">${status}</td><td class="nw">${time}</td><td>${why}</td></tr>`;
  }
  function updateTransports(s) {
    const r = V.r, now = s.t;
    const all = transportsToday();
    const f = V.relFilter;
    // hohes Tempo: Tabelle höchstens 1×/s neu (Uhrzeiten ändern sich sonst jeden Takt)
    if (WF.app && WF.app.speed >= 120 && V.sig.tr && performance.now() - (V._trT || 0) < 1000) return;
    V._trT = performance.now();
    const list = all.filter(x => relMatch(x, f));
    const openAll = list.filter(x => x.status !== 'done');
    // in Fahrt zuerst, dann fällig/wartend (am längsten wartend zuerst); vorgemerkte (Ziel voll) als eigener, ruhiger Block
    const active = openAll.filter(x => !isPlanned(x)).sort((a, b) => {
      const pa = a.pickupT != null ? 0 : 1, pb = b.pickupT != null ? 0 : 1;
      return pa - pb || waitStart(a) - waitStart(b);
    });
    const planned = openAll.filter(isPlanned).sort((a, b) => a.createdT - b.createdT);
    const done = list.filter(x => x.status === 'done' && !x.cancelled).sort((a, b) => b.doneT - a.doneT);
    const doneShown = V.showAllDone ? done : done.slice(0, V.trFilter === 'done' ? 25 : 10);
    // Signatur: Minutenraster
    const sig = V.trFilter + '|' + (f ? f.key : '') + '|' + V.showAllDone + '|' + Math.floor(now / 60) + '|' + active.map(x => x.id + x.status + (x.carrier || '')).join(',') + '|' + planned.map(x => x.id).join(',') + '|' + done.length;
    if (sig !== V.sig.tr) {
      V.sig.tr = sig;
      let h = '';
      const showActive = V.trFilter !== 'done', showDone = V.trFilter !== 'active';
      if (showActive) {
        if (active.length) {
          if (showDone || planned.length) h += `<tr class="sep"><td colspan="9">Offen &amp; laufend · ${active.length}</td></tr>`;
          h += active.map(x => trRow(x, now)).join('');
        } else h += `<tr><td colspan="9"><div class="empty" style="padding:16px">${f ? 'Auf dieser Verbindung ist gerade kein Transport fällig.' : planned.length ? 'Kein Transport fällig – vorgemerkte Behälter fahren, sobald am Ziel Platz ist.' : 'Kein Transport offen – alle abholbereiten Behälter sind zugestellt.'}</div></td></tr>`;
        if (planned.length) {
          h += `<tr class="sep"><td colspan="9">Vorgemerkt · Ziel voll · ${planned.length}</td></tr>`;
          h += planned.map(x => trRow(x, now)).join('');
        }
      }
      if (showDone) {
        if (doneShown.length) {
          if (showActive) h += `<tr class="sep"><td colspan="9">Heute erledigt · ${done.length}</td></tr>`;
          h += doneShown.map(x => trRow(x, now)).join('');
        } else if (V.trFilter === 'done') h += `<tr><td colspan="9"><div class="empty" style="padding:16px">Heute noch kein Transport abgeschlossen.</div></td></tr>`;
      }
      setHTML(r.trBody, h);
      r.trMore.hidden = !(showDone && done.length > (V.trFilter === 'done' ? 25 : 10));
      setText(r.trMoreBtn, V.showAllDone ? 'Weniger anzeigen' : `Alle ${done.length} erledigten anzeigen`);
      markSel();
    }
    const wait = active.filter(x => x.pickupT == null).length;
    setHTML(r.trSub, `<b>${active.length}</b> offen/laufend (${wait} ${wait === 1 ? 'wartet' : 'warten'} auf Abholung)${planned.length ? ` · ${planned.length} vorgemerkt` : ''} · <b>${done.length}</b> heute erledigt${f ? ' · gefiltert' : ''}`);
    const chipKey = f ? f.key : '';
    if (r.relChip._k !== chipKey) {
      r.relChip._k = chipKey;
      r.relChip.innerHTML = f ? `<span class="mt-filt">${f.station ? esc(stName(f.station)) : esc(stName(f.from)) + ' → ' + esc(stName(f.to))}<button aria-label="Filter entfernen" title="Filter entfernen">${ICO('x', 12)}</button></span>` : '';
      const b = r.relChip.querySelector('button'); if (b) b.onclick = () => setRelFilter(null);
    }
  }

  // ------------------------------------------------------------------ Rohmaterial
  function reachInfo(mt, D, now) {
    if (!D || D.need <= 1e-9) return { main: 'kein offener Bedarf', cls: 'muted', sub: 'kein offener Auftrag braucht dieses Material' };
    const nOrd = D.orders.length;
    const needTxt = `Bedarf ${amt(D.need, mt.unit)} · ${nOrd} ${nOrd === 1 ? 'Auftrag' : 'Aufträge'}`;
    if (mt.onHand + 1e-9 >= D.need) return { main: 'Bedarf gedeckt', cls: 'ok', sub: `${needTxt} · Rest ${amt(mt.onHand - D.need, mt.unit)}` };
    if (D.short <= 1e-9) {
      // Bestellung deckt den Rest – reicht der Bestand bis zur Lieferung?
      if (D.gapT == null) return { main: `deckt mit Lieferung ${tclock(D.nextEta, now)}`, cls: 'ok', sub: `${needTxt} · Lager allein reicht bis ca. ${tclock(D.runoutT, now)}` };
      return { main: `reicht bis ca. ${tclock(D.runoutT, now)}`, cls: 'warn', sub: `${needTxt} · Lieferung erst ${tclock(D.nextEta, now)}` };
    }
    return { main: `fehlen ${amt(D.short, mt.unit)}`, cls: 'crit', sub: `${needTxt}${D.runoutT != null ? ' · reicht bis ca. ' + tclock(D.runoutT, now) : ''}` };
  }
  function stockBar(mt) {
    const scale = Math.max(mt.min * 2, mt.onHand + mt.onOrder, 1) * 1.04;
    const have = mt.onHand / scale, inc = mt.onOrder / scale, mn = mt.min / scale;
    const c = mt.onHand < mt.min && mt.onHand + mt.onOrder < mt.min ? 'var(--st-wait)' : STOCK_C;
    return `<div class="mt-sbar" style="--c:${c}" title="Bestand ${amt(mt.onHand, mt.unit)} · bestellt ${amt(mt.onOrder, mt.unit)} · Mindestbestand ${amt(mt.min, mt.unit)}"><i class="hv" style="width:${(have * 100).toFixed(1)}%"></i>${inc > 0 ? `<i class="inc" style="left:${(have * 100).toFixed(1)}%;width:${(inc * 100).toFixed(1)}%"></i>` : ''}<span class="mn" style="left:${(mn * 100).toFixed(1)}%"></span></div>`;
  }
  function matSev(mt, s) {
    const missing = (s.notifications || []).some(x => x.status === 'open' && String(x.key || '').indexOf('missing:' + mt.id + ':') === 0);
    if (missing) return { c: 'var(--st-fault)', k: 'crit' };
    if (mt.onHand < mt.min && mt.onHand + mt.onOrder < mt.min) return { c: 'var(--st-wait)', k: 'warn' };
    if (mt.onHand < mt.min) return { c: 'var(--info)', k: 'info' };
    return { c: 'transparent', k: '' };
  }
  /** Verbrauch heute = Engine-Wert (Säge, Stangenlader, Rohteile; eine Wahrheit mit Copilot/Snapshot);
      Lagerentnahme (Mitschreiber) nur zusätzlich, wenn sie abweicht – Stangen gehen z. B. erst ins Magazin des Stangenladers */
  function usedToday(mt) { return mt && mt.usedToday != null ? mt.usedToday : withdrawnToday(mt.id); }
  function useCell(mt, used, wd) {
    if (!(used > 1e-6) && !(wd > 1e-6)) return '<span class="muted">–</span>';
    const differs = Math.abs(used - wd) > (mt.unit === 'm' ? 0.05 : 0.5);
    const sub = differs ? (wd > 1e-6 ? `aus Lager ${amt(wd, mt.unit)}` : 'aus Magazin') : U.fmtEur(used * mt.pricePerUnit);
    return `<b>${esc(used > 1e-6 ? amt(used, mt.unit) : '–')}</b><span class="mt-s" title="${esc(differs ? `Verbrauch an den Maschinen ${amt(used, mt.unit)} · aus dem Lager entnommen ${amt(wd, mt.unit)} (Stangen werden zuerst ins Magazin des Stangenladers gebracht)` : 'Materialwert des Verbrauchs')}">${esc(sub)}</span>`;
  }
  function updateMaterials(s) {
    const r = V.r, now = s.t;
    if (WF.app && WF.app.speed >= 120 && V.sig.mat && performance.now() - (V._matT || 0) < 1000) return;
    V._matT = performance.now();
    const D = demandAll();
    const mats = Object.values(s.materials);
    const rows = mats.map(mt => {
      const d = D[mt.id];
      const ri = reachInfo(mt, d, now);
      const sev = matSev(mt, s);
      const np = nextPurchase(mt.id);
      return { mt, ri, sev, np, wd: withdrawnToday(mt.id), used: usedToday(mt) };
    });
    const sig = Math.floor(now / 60) + '|' + rows.map(x => [x.mt.id, x.mt.onHand.toFixed(2), x.mt.onOrder, x.ri.main, x.ri.sub, x.sev.k, x.wd.toFixed(2), x.used.toFixed(2), x.np ? x.np.etaT : ''].join(':')).join(',');
    if (sig !== V.sig.mat) {
      V.sig.mat = sig;
      const h = rows.map(({ mt, ri, sev, np, wd, used }) => {
        const [sup, bsp] = splitBsp(mt.supplier);
        const loc = STN(mt.location);
        const locName = loc ? String(loc.name).replace(/\s*\(.*\)$/, '') : mt.location;
        const locSub = loc && /\((.*)\)/.test(loc.name) ? loc.name.match(/\((.*)\)/)[1] : '';
        const below = mt.onHand < mt.min, uncovered = mt.onHand + mt.onOrder < mt.min;
        const urgent = sev.k === 'crit' || (ri.cls === 'crit' && !mt.onOrder);
        // Nachbestellen nur dort als Knopf, wo es etwas zu tun gibt (unter Minimum, Bedarf nicht gedeckt) – sonst dezent beim Überfahren
        const actionable = urgent || below || ri.cls === 'crit' || ri.cls === 'warn';
        const reoBtn = `<button class="btn sm${urgent || (below && uncovered) ? ' primary' : actionable ? '' : ' ghost mt-reo-h'}" data-reorder="${esc(mt.id)}" title="Bestellung vorbereiten (Bestellmenge ${esc(amt(mt.reorderQty, mt.unit))})">Nachbestellen</button>`;
        // Telefon: ruhige Zeilen (kein Handlungsbedarf) sind eingeklappt – „Alle Materialien anzeigen“
        const calm = !sev.k && ri.cls !== 'crit' && ri.cls !== 'warn';
        return `<tr class="click${calm ? ' calm' : ''}" data-row="material|${esc(mt.id)}"><td class="st" style="--c:${sev.c}"></td>
          <td class="mt-mcell"><b class="nw">${esc(mt.name)}</b><span class="mt-s"><span class="mt-form">${ICO(mt.form === 'Stange' ? 'layers' : 'box', 12)}${esc(FORM[mt.form] || mt.form)}</span> · <span class="mono">${esc(mt.id)}</span><span class="mt-locinl"> · ${esc(locSub || locName)}</span></span></td>
          <td><div class="mt-stock"><div class="mt-stock-n"><b>${esc(U.fmtNum(mt.onHand, mt.unit === 'm' ? 1 : 0))}</b><span>${esc(mt.unit)} · Min ${esc(U.fmtNum(mt.min, mt.unit === 'm' ? 1 : 0))}${below ? (uncovered ? ' · <span style="color:var(--st-wait)">unter Minimum</span>' : ' · unter Min., bestellt') : ''}</span></div>${stockBar(mt)}</div></td>
          <td><div class="mt-rw"><b class="${ri.cls}">${esc(ri.main)}</b><span class="mt-s mt-wrap">${esc(ri.sub)}</span></div></td>
          <td class="r nw" data-l="Verbrauch heute">${useCell(mt, used, wd)}</td>
          <td class="nw" data-l="Bestellt">${mt.onOrder > 0 ? `<b>${esc(amt(mt.onOrder, mt.unit))}</b><span class="mt-s">Lieferung ca. ${esc(tclock(np ? np.etaT : null, now))}</span>` : '<span class="muted">–</span>'}</td>
          <td class="mt-sup" data-l="Lieferant"><span class="nw" title="${esc(mt.supplier)}">${esc(sup)}</span><span class="mt-s">Lieferzeit ca. ${esc(U.fmtDur(mt.leadMin * 60))} · ${esc(U.fmtEur(mt.pricePerUnit, mt.pricePerUnit < 20 ? 2 : 0))}/${esc(mt.unit)}</span></td>
          <td class="nw mt-loccol">${esc(locSub || locName)}${locSub ? `<span class="mt-s">${esc(locName)}</span>` : ''}</td>
          <td class="r nw">${reoBtn}</td></tr>`;
      }).join('');
      setHTML(r.matBody, h);
      markSel();
    }
    const low = mats.filter(m => m.onHand < m.min).length;
    const nAtt = rows.filter(x => x.sev.k || x.ri.cls === 'crit' || x.ri.cls === 'warn').length;
    setText(r.matMoreBtn, V.matAll ? 'Nur Materialien mit Handlungsbedarf' : nAtt ? `Alle ${mats.length} Materialien anzeigen` : `Alle ${mats.length} Materialien anzeigen – Bedarf überall gedeckt`);
    const val = mats.reduce((a, m) => a + m.onHand * m.pricePerUnit, 0);
    setHTML(r.matSub, `${mats.length} Materialien · Lagerwert ca. <b>${U.fmtEur(val)}</b> · ${low ? `<b style="color:var(--st-wait)">${low} unter Mindestbestand</b>` : 'alle über Mindestbestand'}<span class="x"> · Reichweite aus den offenen Aufträgen (noch nicht entnommene Teile × Bedarf je Teil, zeitlich nach Plantafel)</span>`);
  }

  // ------------------------------------------------------------------ Nachbestellen (Dialog)
  function openReorder(matId) {
    const s = S(); const mt = s && s.materials[matId]; if (!mt) return;
    const D = demand(matId);
    const dec = mt.unit === 'm' ? 1 : 0;
    const gap = Math.max(0, (D ? D.need : 0) - mt.onHand - mt.onOrder);
    const toMin = Math.max(0, mt.min - mt.onHand - mt.onOrder);
    const body = WF.ui.el('div', { class: 'stack' });
    const [sup, bsp] = splitBsp(mt.supplier);
    const quick = [{ l: `Bestellmenge ${amt(mt.reorderQty, mt.unit)}`, q: mt.reorderQty }];
    if (gap > 0) quick.push({ l: `Fehlmenge ${amt(Math.ceil(gap * 10) / 10, mt.unit)}`, q: dec ? Math.ceil(gap * 10) / 10 : Math.ceil(gap) });
    if (toMin > 0) quick.push({ l: `bis Mindestbestand ${amt(dec ? Math.ceil(toMin * 10) / 10 : Math.ceil(toMin), mt.unit)}`, q: dec ? Math.ceil(toMin * 10) / 10 : Math.ceil(toMin) });
    body.innerHTML = `
      <dl class="dl">
        <dt>Material</dt><dd><b>${esc(mt.name)}</b> <span class="muted mono">${esc(mt.id)}</span></dd>
        <dt>Bestand</dt><dd>${esc(amt(mt.onHand, mt.unit))} · Mindestbestand ${esc(amt(mt.min, mt.unit))}${mt.onOrder ? ' · bereits bestellt ' + esc(amt(mt.onOrder, mt.unit)) : ''}</dd>
        <dt>Offener Bedarf</dt><dd>${D && D.need > 0 ? esc(amt(D.need, mt.unit)) + ' aus ' + D.orders.length + (D.orders.length === 1 ? ' Auftrag' : ' Aufträgen') : 'kein offener Bedarf'}</dd>
        <dt>Lieferant</dt><dd>${esc(sup)} ${bsp ? `<span class="muted">${esc(bsp)}</span>` : ''}</dd>
        <dt>Lieferzeit</dt><dd>ca. ${esc(U.fmtDur(mt.leadMin * 60))} (Anlieferung im nächsten Lieferfenster)</dd>
        <dt>Preis</dt><dd>${esc(U.fmtEur(mt.pricePerUnit, 2))} je ${esc(mt.unit)}</dd>
      </dl>
      <label class="field" for="mt-reo-q">Menge
        <div class="mt-qty"><input id="mt-reo-q" type="number" inputmode="decimal" min="${dec ? 0.1 : 1}" step="${dec ? 0.1 : 1}" value="${mt.reorderQty}"><span>${esc(mt.unit)}</span></div></label>
      <div class="row" data-q>${quick.map((x, i) => `<button class="btn sm ghost" type="button" data-qi="${i}">${esc(x.l)}</button>`).join('')}</div>
      <div class="muted" style="font-size:var(--fs-sm)" data-sum></div>`;
    const inp = body.querySelector('#mt-reo-q'), sum = body.querySelector('[data-sum]');
    const upd = () => { const q = Number(String(inp.value).replace(',', '.')); sum.innerHTML = q > 0 ? `Bestellwert ca. <b style="color:var(--text)">${esc(U.fmtEur(q * mt.pricePerUnit))}</b> · Bestand nach Lieferung ${esc(amt(mt.onHand + mt.onOrder + q, mt.unit))}` : 'Bitte eine Menge größer 0 eingeben.'; };
    inp.addEventListener('input', upd);
    body.querySelectorAll('[data-qi]').forEach(b => b.onclick = () => { inp.value = quick[Number(b.dataset.qi)].q; upd(); inp.focus(); });
    upd();
    const doOrder = () => {
      const q = Number(String(inp.value).replace(',', '.'));
      const res = WF.sim.actions.reorder(matId, q);
      const ok = !(res && res.ok === false);
      WF.app.toast((res && res.msg) || (ok ? 'Bestellt' : 'Bestellung nicht möglich'), ok ? 'ok' : 'warn', ok ? { title: 'Bestellung ausgelöst' + (res && res.id ? ' · ' + res.id : '') } : {});
      invalidate(); V.sig.mat = '';
      if (WF.app.selected && WF.app.selected.kind === 'material' && WF.app.selected.id === matId) WF.app.refreshDrawer && WF.app.refreshDrawer();
      return ok;
    };
    const m = WF.app.modal({ title: 'Nachbestellen', body, width: 480, actions: [
      { label: 'Abbrechen' },
      { label: 'Bestellung auslösen', primary: true, onClick: () => doOrder() !== false ? undefined : false },
    ] });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (doOrder()) m.close(); } });
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* ignorieren */ } }, 30);
    return m;
  }

  // ------------------------------------------------------------------ Behälter im Umlauf
  const FLOW_ORDER = ['transit', 'RAW', 'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'EXT', 'ext', 'WE', 'M09', 'M10', 'M11', 'QS', 'M13', 'SPERR'];
  function ctLine(c, s, now) {
    const o = s.orders[c.orderId];
    const toR = o && c.idx < o.routing.length ? o.routing[c.idx] : null;
    const next = toR ? `AG ${toR.seq} ${toR.op}${toR.station !== 'EXT' && toR.station !== 'VERSAND' ? ' (' + stName(toR.station) + ')' : ''}` : 'Versand';
    const l = c.location || {};
    switch (c.state) {
      case 'filling': {
        const batch = o && c.src >= 0 ? o.routing[c.src].transferBatch || 0 : 0;
        const f = batch ? Math.min(1, c.qty / batch) : 0;
        return { html: `<span class="fb"><i style="width:${(f * 100).toFixed(0)}%"></i></span><span>wird befüllt ${c.qty}${batch ? '/' + batch : ''} · dann → ${esc(toR ? stName(toR.station) : 'Versand')}</span>`, sort: 2 };
      }
      case 'ready': {
        const tr = c.transportId && s.transports[c.transportId];
        const dest = esc(tr ? stName(tr.finalTo || tr.to.station) : toR ? stName(toR.station) : 'Versand');
        if (tr && tr.status === 'open' && phaseOf(tr) === 'geplant') {
          // Ziel voll: bereitgestellt und vorgemerkt – keine Wartezeit-Uhr, keine Warnfarbe
          return { html: `<span>bereitgestellt seit ${tclock(c.readyT != null ? c.readyT : tr.createdT, now)} → ${dest} · vorgemerkt, Ziel voll${tr.roomEtaT != null ? ' · Abruf ca. ' + tclock(tr.roomEtaT, now) : ''}</span>`, sort: 1.5, planned: true };
        }
        const w = tr ? (tr.pickupT != null ? null : waitOf(recOf(tr), now)) : c.readyT != null ? now - c.readyT : null;
        const why = tr ? (tr.assignee ? (s.agvs[tr.assignee] ? s.agvs[tr.assignee].name : shortName(personName(tr.assignee))) + ' unterwegs' : tr.waitReason || 'wartet auf Zuteilung') : 'wartet';
        return { html: `<span class="${w != null && w > WAIT_WARN ? 'warn' : ''}">abholbereit${w != null ? ' seit ' + dur(w) : ''} → ${dest} · ${esc(why)}</span>`, sort: 1, waitSec: w };
      }
      case 'transit': {
        const who = l.kind === 'agv' ? (s.agvs[l.id] ? s.agvs[l.id].name : l.id) : 'Stapler (' + shortName(personName(l.personId)) + ')';
        const tr = c.transportId && s.transports[c.transportId];
        return { html: `<span>auf ${esc(who)} → ${esc(tr ? stName(tr.to.station) : toR ? stName(toR.station) : '–')} · für ${esc(next)}</span>`, sort: 0 };
      }
      case 'input': {
        if (l.id === 'EXT') return { html: `<span>${esc((WF.sim.containerWhere(c.id) || '').replace(/^Fremdbearbeitung · /, ''))}</span>`, sort: 3 };
        const m = s.machines[l.id];
        const active = m && m.op && m.op.oid === c.orderId && m.op.idx === c.idx;
        return { html: `<span>für ${esc(next.replace(/ \(.*\)$/, ''))} · ${active ? 'aktiver Arbeitsgang' : 'wartet auf Bearbeitung'}</span>`, sort: 3 };
      }
      case 'external': return { html: `<span>${esc(l.process || '')} · zurück ca. ${esc(tclock(l.returnT, now))}</span>`, sort: 4 };
      case 'scrap': return { html: `<span>Ausschuss${c.lastReason ? ' (' + esc(c.lastReason) + ')' : ''} · aus AG ${esc(String(c.srcSeq || c.seq || '–'))} · gesperrt</span>`, sort: 5 };
    }
    return { html: `<span>${esc(lbl('container', c.state))}</span>`, sort: 9 };
  }
  function updateContainers(s) {
    const r = V.r, now = s.t;
    if (WF.app && WF.app.speed >= 120 && V.sig.ct && performance.now() - (V._ctT || 0) < 1000) return;
    V._ctT = performance.now();
    const groups = new Map();
    const add = (key, c) => { let g = groups.get(key); if (!g) groups.set(key, g = { key, items: [] }); g.items.push(c); };
    let total = 0, qty = 0;
    for (const id in s.containers) {
      const c = s.containers[id];
      if (c.state === 'shipped') continue;
      if (c.state !== 'scrap') { total++; qty += c.qty; }
      const l = c.location;
      if (c.state === 'external') add('ext', c);
      else if (l && (l.kind === 'agv' || l.kind === 'forklift')) add('transit', c);
      else if (l && l.kind === 'station') add(l.id, c);
      else add('other', c);
    }
    const keys = [...groups.keys()].sort((a, b) => { const ia = FLOW_ORDER.indexOf(a), ib = FLOW_ORDER.indexOf(b); return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib); });
    const sig = Math.floor(now / 30) + '|' + keys.map(k => k + ':' + groups.get(k).items.map(c => c.id + c.state + c.qty + (c.transportId && s.transports[c.transportId] ? s.transports[c.transportId].status : '')).join('.')).join(',');
    if (sig !== V.sig.ct) {
      V.sig.ct = sig;
      let h = '';
      const openMap = V.ctOpen || (V.ctOpen = new Map());
      for (const k of keys) {
        const g = groups.get(k);
        let title, idTxt = '', icon = 'box', cls = '', c0 = 'var(--line2)', stateTxt = '';
        if (k === 'ext') { title = 'Extern bei ' + haertName(); icon = 'flame'; cls = 'ext'; c0 = 'var(--ext)'; }
        else if (k === 'transit') { title = 'Unterwegs'; icon = 'truck'; cls = 'transit'; c0 = 'var(--mat)'; }
        else if (k === 'other') { title = 'Sonstige'; }
        else {
          const st = STN(k); title = st ? (st.short || st.name) : k; idTxt = k;
          const m = s.machines[k];
          if (m) { c0 = (WF.STATE[m.state] || WF.STATE.idle).color; stateTxt = `<span class="sdot" title="${esc(WF.STATE[m.state] ? WF.STATE[m.state].label : '')}"></span>`; icon = null; }
          else icon = { RAW: 'rack', WE: 'inbox', EXT: 'truck', SPERR: 'lock', QS: 'target' }[k] || 'box';
          if (k === 'SPERR') { cls = 'scrap'; c0 = 'var(--st-fault)'; title = 'Sperrlager (nicht im Umlauf)'; }
        }
        const items = g.items.map(c => ({ c, ln: ctLine(c, s, now), slot: c.location && c.location.kind === 'station' ? c.location.slot : null }));
        const q = g.items.reduce((a, c) => a + c.qty, 0);
        const rowHtml = (x) => {
          const c = x.c;
          return `<button class="mt-ct" style="--c:${CT_C[c.state] || 'var(--muted)'}" data-row="container|${esc(c.id)}" title="${esc(lbl('container', c.state))} · ${esc(c.id)}">${ctMark(c.state)}
            <span class="l1"><span class="mono">${esc(c.orderId)}</span><span>${esc(c.partName)}</span></span><span class="q">${esc(stk(c.qty))}</span>
            <span class="l2">${x.ln.html}</span></button>`;
        };
        let body = '', sm = '';
        const st = STN(k);
        const inn = items.filter(x => x.slot !== 'out').sort((a, b) => a.ln.sort - b.ln.sort), out = items.filter(x => x.slot === 'out').sort((a, b) => a.ln.sort - b.ln.sort);
        const isMach = !!(st && (st.kind === 'machine' || st.kind === 'qs' || st.kind === 'assembly'));
        if (isMach) {
          if (inn.length) body += `<div class="mt-cg-sl">Eingang · ${inn.length}${st.inCap ? ' / ' + st.inCap : ''}</div>` + inn.map(rowHtml).join('');
          if (out.length) body += `<div class="mt-cg-sl">Ausgang · ${out.length}${st.outCap ? ' / ' + st.outCap : ''}</div>` + out.map(rowHtml).join('');
        } else body += items.sort((a, b) => a.ln.sort - b.ln.sort || a.c.createdT - b.c.createdT).map(rowHtml).join('');
        // Telefon: Zusammenfassung je Ort; aufgeklappt nur, was Aufmerksamkeit braucht (unterwegs, Ausgang voll, lange abholbereit)
        const m = s.machines[k];
        const outFull = isMach && st.outCap > 0 && out.length >= st.outCap;
        const waitLong = items.some(x => x.c.state === 'ready' && !x.ln.planned && x.ln.waitSec != null && x.ln.waitSec > WAIT_WARN);
        const att = k === 'transit' || (m && m.state === 'blocked') || outFull || waitLong;
        const isOpen = openMap.has(k) ? openMap.get(k) : att;
        const attTxt = (m && m.state === 'blocked') || outFull ? 'Ausgang voll' : waitLong ? 'wartet auf Abholung' : '';
        sm = (isMach ? `Eingang ${inn.length}${st.inCap ? '/' + st.inCap : ''} · Ausgang ${out.length}${st.outCap ? '/' + st.outCap : ''}` : `${g.items.length} Behälter`) + ` · ${stk(q)}`;
        const hdSel = s.machines[k] ? ` data-sel="machine|${esc(k)}" title="Maschinendetails öffnen"` : '';
        h += `<div class="mt-cg ${cls}${isOpen ? ' open' : ''}${att ? '' : ' calm'}" data-k="${esc(k)}" style="--c:${c0}"><div class="mt-cg-h${hdSel ? ' lnkh' : ''}"${hdSel} role="button" tabindex="0">${icon ? ICO(icon, 15) : stateTxt}<b>${esc(title)}</b>${idTxt && idTxt !== title ? `<span class="mono">${esc(idTxt)}</span>` : ''}<span class="spacer"></span><span class="cnt lg"><b>${g.items.length}</b> Behälter · ${esc(stk(q))}</span><span class="chev">${ICO('chevron', 14)}</span><span class="cnt sm">${esc(sm)}${attTxt ? ` · <b class="warn">${esc(attTxt)}</b>` : ''}</span></div><div class="mt-cg-b">${body}</div></div>`;
      }
      setHTML(r.ctGrid, h || '<div class="empty">Keine Behälter im Umlauf.</div>');
      markSel();
    }
    const ext = groups.get('ext'), trn = groups.get('transit');
    setText(r.ctMoreBtn, V.ctAll ? 'Nur Orte mit Handlungsbedarf' : `Alle ${keys.length} Orte anzeigen`);
    setHTML(r.ctSub, `<b>${total}</b> Behälter · <b>${U.fmtNum(qty)}</b> Teile · ${trn ? trn.items.length : 0} unterwegs · ${ext ? ext.items.length : 0} extern<span class="x"> · gruppiert nach Ort in Flussrichtung</span>`);
    if (!r.ctLegend._done) {
      r.ctLegend._done = true;
      r.ctLegend.innerHTML = ['filling', 'ready', 'transit', 'input', 'external'].map(k => `<span>${ctMark(k)}${esc(lbl('container', k))}</span>`).join('');
    }
  }

  // ================================================================== View registrieren
  WF.registerView({
    id: 'material', title: 'Material & Logistik', icon: 'truck', group: 'ressourcen', order: 4,
    mount, show, hide, update, frame,
    badge() {
      const s = S(); if (!s || !s.materials) return '';
      const n = Object.values(s.materials).filter(m => m.onHand + m.onOrder < m.min).length;
      return n ? String(n) : '';
    },
  });

  // ================================================================== Details
  function sectionsRender(el, list) {
    el.innerHTML = list.map(k => `<section data-sec="${k}"></section>`).join('');
    const out = {}; el.querySelectorAll('[data-sec]').forEach(n => { out[n.dataset.sec] = n; });
    return out;
  }
  /** kleines Liniendiagramm 0..100 mit Schwelle (Akku) */
  function batteryChart(samples, now, low, w) {
    // in echter Breite gezeichnet (keine verzerrte Skalierung), Achsen damit immer ≥ 10,5 px
    const W = Math.max(260, Math.round(w || 420)), H = 92, padL = 28, padR = 6, padT = 8, padB = 18;
    const t1 = now, t0 = now - 4 * 3600;
    const pts = samples.filter(x => x.t >= t0);
    const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
    const Y = (v) => padT + (1 - v / 100) * (H - padT - padB);
    let g = '';
    for (const v of [0, 50, 100]) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${padL - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
    g += `<line class="thr" x1="${padL}" x2="${W - padR}" y1="${Y(low).toFixed(1)}" y2="${Y(low).toFixed(1)}"/><text class="thrt" x="${W - padR}" y="${(Y(low) - 4).toFixed(1)}" text-anchor="end">Ladeschwelle ${low} %</text>`;
    for (let h = Math.ceil(t0 / 3600) * 3600; h <= t1; h += 3600) g += `<text class="ax" x="${X(h).toFixed(1)}" y="${H - 4}" text-anchor="middle">${U.fmtClock(h)}</text>`;
    if (pts.length >= 2) {
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
      const area = d + ` L${X(pts[pts.length - 1].t).toFixed(1)},${Y(0).toFixed(1)} L${X(pts[0].t).toFixed(1)},${Y(0).toFixed(1)} Z`;
      const last = pts[pts.length - 1];
      g += `<path d="${area}" style="fill:var(--accent)" opacity=".1"/><path d="${d}" style="fill:none;stroke:var(--accent)" stroke-width="1.8" stroke-linejoin="round"/><circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3" style="fill:var(--accent)"/>`;
    } else g += `<text class="ax" x="${W / 2}" y="${H / 2}" text-anchor="middle">Verlauf wird aufgezeichnet …</text>`;
    return `<div class="mt-d-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" style="height:${H}px">${g}</svg></div>`;
  }
  function stateBandAgv(samples, now) {
    const t0 = now - 4 * 3600;
    let k0 = 0; for (let i = 0; i < samples.length; i++) if (samples[i].t <= t0) k0 = i;
    const pts = samples.slice(k0);
    const W = 420, H = 10;
    let rects = '';
    for (let i = 0; i < pts.length; i++) {
      const a = Math.max(t0, pts[i].t), b = i + 1 < pts.length ? pts[i + 1].t : now;
      if (b <= a) continue;
      const x = (a - t0) / (now - t0) * W, w = Math.max(0.6, (b - a) / (now - t0) * W);
      rects += `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" style="fill:${AGV_C[pts[i].st] || 'var(--st-idle)'}"/>`;
    }
    return `<svg class="band" width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" style="fill:var(--track)"/>${rects}</svg>`;
  }
  function trListItem(r, now, opts = {}) {
    const what = r.kind === 'bars' ? `Stangen ${matName(r.materialId)}${r.meters ? ' · ' + U.fmtNum(r.meters, 1) + ' m' : ''}` : `${r.qty != null ? stk(r.qty) + ' ' : ''}${r.partName || ''}`;
    const tm = r.status === 'done' ? r.doneT : r.pickupT || r.createdT;
    const right = r.status === 'done' ? (r.pickupT != null ? 'Fahrt ' + dur(r.doneT - r.pickupT) : '') : trStatusLabel(r);
    const sub = `${r.id}${r.orderId ? ' · ' + r.orderId : ''}${opts.carrier && r.carrier ? ' · ' + r.carrier : ''}${r.pickupT != null && waitOf(r, now) > 60 ? ' · wartete ' + dur(waitOf(r, now)) : ''}`;
    const sel = r.kind === 'bars' ? 'material|' + r.materialId : r.containerId ? 'container|' + r.containerId : '';
    return `<div class="mt-d-li${sel ? ' click' : ''}" ${sel ? `data-sel="${esc(sel)}"` : ''}><span class="tm">${tclock(tm, now)}</span><span class="mn"><b>${esc(stName(r.from))} → ${esc(stName(r.to))}</b><span>${esc(what)} · ${esc(sub)}</span></span><span class="rt">${esc(right)}</span></div>`;
  }
  function bindSel(el) {
    if (el._mtBound) return; el._mtBound = true;
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-sel]'); if (!t) return;
      const [k, id] = t.dataset.sel.split('|'); if (k && id) WF.app.select(k, id);
    });
  }

  // ------------------------------------------------------------------ Detail „agv“ (inkl. Stapler)
  WF.registerDetail('agv', (id) => {
    const s = S(); if (!s) return null;
    const a = s.agvs[id];
    const isFork = !a && s.forklift && s.forklift.id === id;
    if (!a && !isFork) return null;
    const name = a ? a.name : s.forklift.name;
    return {
      title: name,
      subtitle: a ? `Fahrerloses Transportfahrzeug · max. ${U.fmtNum(a.maxKg)} kg · ${U.fmtNum(a.speed, 1)} m/s` : 'Gabelstapler · Behälter über 250 kg und Stangenmaterial',
      askPrompt: a ? `Wie ausgelastet ist ${name} heute, wie steht es um den Akku und gibt es Transporte, die zu lange auf Abholung warten?` : `Wie ist die Lage beim Stapler: wer fährt, welche Staplertransporte warten und wie lange?`,
      render(el) { bindSel(el); this._s = sectionsRender(el, a ? ['hero', 'bat', 'mission', 'today', 'list', 'master'] : ['hero', 'mission', 'today', 'staff', 'list']); this.update(el); },
      update(el) {
        const s2 = S(); const now = s2.t; const X = this._s; if (!X) return;
        try { scanTransports(); } catch (e) { /* ignorieren */ }
        if (a) {
          const ag = s2.agvs[id]; if (!ag) return;
          const c = AGV_C[ag.state] || 'var(--st-idle)';
          const since = L.since[id];
          setHTML(X.hero, `<div class="mt-d-hero"><div class="mt-d-st">${pill(c, lbl('agv', ag.state))}<span class="mt-d-since">${since ? 'seit ' + (now - since.t < 60 ? 'gerade eben' : dur(now - since.t)) : ''}</span></div>
            <div class="mt-d-cause">${esc(agvCause(ag, s2, now))}</div></div>`);
          const b = U.clamp(ag.battery, 0, 100), low = cfg().batteryLow || 25;
          const gc = b < low ? 'var(--st-fault)' : b < 50 ? 'var(--st-wait)' : 'var(--st-run)';
          const trs = transportsToday().filter(r => r.assignee === id && r.status === 'done' && r.pickupT != null);
          const drivePer = trs.length ? trs.reduce((x, r) => x + (r.doneT - r.pickupT), 0) / trs.length : 120;
          const drain = cfg().agvDrain || 0.05;
          const perTrip = Math.max(1, drivePer * 1.8 * drain);
          const trips = Math.max(0, Math.floor((b - low) / perTrip));
          setHTML(X.bat, `<h4>Akku</h4><div class="mt-d-bat"><div class="mt-gauge${ag.state === 'charging' ? ' chg' : ''}" style="--gc:${gc}"><svg width="62" height="62" viewBox="0 0 62 62"><circle class="gt" cx="31" cy="31" r="26"/><circle class="gv" cx="31" cy="31" r="26" transform="rotate(-90 31 31)" stroke-dasharray="163.4" stroke-dashoffset="${(163.4 * (1 - b / 100)).toFixed(1)}"/></svg><div class="gl"><b>${U.fmtNum(b, 0)} %</b><span>${ag.state === 'charging' ? ICO('bolt', 9) + 'lädt' : 'Akku'}</span></div></div>
            <div style="font-size:var(--fs-sm);color:var(--text2);line-height:1.5">${ag.state === 'charging' ? `Lädt mit ${U.fmtNum((cfg().agvCharge || 0.12) * 60, 1)} %/min – ${ag.mustCharge ? `für Aufträge gesperrt bis ${cfg().batteryFull || 90} % (ca. ${U.fmtClock(now + Math.max(0, ((cfg().batteryFull || 90) - b) / (cfg().agvCharge || 0.12)))})` : `voll ca. ${U.fmtClock(now + Math.max(0, (100 - b) / (cfg().agvCharge || 0.12)))}, nimmt währenddessen Aufträge an`}.`
              : `Reicht für ca. <b>${trips}</b> weitere Fahrten bis zur Ladeschwelle von ${low} % (Ø Fahrt heute ${dur(drivePer)}).`} Unter ${low} % fährt ${esc(ag.name)} nach dem laufenden Auftrag selbstständig zur Ladestation.</div></div>
            ${batteryChart(batteryHistory(id), now, low, X.bat.clientWidth)}
            <div style="margin-top:8px"><div class="eyebrow" style="margin-bottom:5px">Zustand · letzte 4 h</div>${stateBandAgv(L.stlog[id] || [], now)}
            <div class="md-legend" style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--fs-xs);color:var(--muted);margin-top:6px">${[['idle', 'Bereit'], ['toPickup', 'Anfahrt'], ['toDrop', 'beladen'], ['charging', 'Laden']].map(([k, l]) => `<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:8px;height:8px;border-radius:2px;background:${AGV_C[k]}"></i>${l}</span>`).join('')}</div></div>`);
          setHTML(X.mission, `<h4>Aktueller Auftrag</h4>${missionBox(ag.task ? L.tr.get(ag.task) || null : null, ag.task ? s2.transports[ag.task] : null, now, ag.pos)}`);
          const u = agvUtil(id);
          setHTML(X.today, `<h4>Heute</h4><div class="mt-d-stats"><div><b>${ag.transportsToday}</b><span>Fahrten</span></div><div><b>${ag.distToday >= 1000 ? U.fmtNum(ag.distToday / 1000, 1) + '<small>km</small>' : U.fmtNum(ag.distToday) + '<small>m</small>'}</b><span>Strecke</span></div><div><b>${u == null ? '–' : U.fmtNum(u * 100, 0) + '<small>%</small>'}</b><span>Auslastung seit ${U.fmtClock(shiftWindow().start)}</span></div></div>`);
          const list = transportsToday().filter(r => r.assignee === id && !r.cancelled);
          setHTML(X.list, `<h4>Transporte heute · ${list.length}</h4>${list.length ? `<div class="mt-d-list">${list.slice(0, 30).map(r => trListItem(r, now)).join('')}</div>${list.length > 30 ? `<div class="muted" style="font-size:var(--fs-sm);margin-top:6px">… und ${list.length - 30} weitere</div>` : ''}` : '<div class="empty" style="padding:14px">Heute noch keine Fahrt.</div>'}`);
          setHTML(X.master, `<h4>Stammdaten</h4><dl class="dl"><dt>Kennung</dt><dd class="mono">${esc(id)}</dd><dt>Nutzlast</dt><dd>${U.fmtNum(ag.maxKg)} kg (schwerere Behälter fährt der Stapler)</dd><dt>Geschwindigkeit</dt><dd>${U.fmtNum(ag.speed, 1)} m/s auf dem Wegenetz</dd><dt>Be-/Entladen</dt><dd>je ${cfg().agvHandleSec || 30} s</dd><dt>Ladestation</dt><dd>${esc(stName('CHG'))} · Platz ${ag.slot + 1}</dd><dt>Position</dt><dd>${esc(placeText(ag.pos))}</dd></dl>`);
        } else {
          const f = s2.forklift; if (!f) return;
          const drv = f.driver ? s2.people[f.driver] : null;
          const tr = activeForkliftTransport(s2);
          const fs = forkState(s2), c = fs.color;
          const since = L.since[f.id];
          setHTML(X.hero, `<div class="mt-d-hero"><div class="mt-d-st">${pill(c, fs.label)}<span class="mt-d-since">${since ? 'seit ' + (now - since.t < 60 ? 'gerade eben' : dur(now - since.t)) : ''}</span></div>
            <div class="mt-d-cause">${drv ? `${esc(drv.name)}: ${esc(drv.activity || lbl('person', drv.state))}` : `Abgestellt ${esc(placeText(f.pos))}.${logistician() ? ' Nächster Staplertransport wird automatisch an ' + esc(logistician().name) + ' vergeben.' : ' Niemand mit Staplerschein im Dienst – Staplertransporte warten.'}`}</div></div>`);
          setHTML(X.mission, `<h4>Aktueller Auftrag</h4>${missionBox(tr, tr ? s2.transports[tr.id] : null, now, f.pos)}`);
          const list = transportsToday().filter(r => r.mode === 'Stapler' && !r.cancelled);
          const done = list.filter(r => r.status === 'done');
          const ws = done.filter(r => r.pickupT != null).map(r => r.pickupT - r.createdT);
          setHTML(X.today, `<h4>Heute</h4><div class="mt-d-stats"><div><b>${done.length}</b><span>Fahrten</span></div><div><b>${done.filter(r => r.kind === 'bars').length}</b><span>Stangen-Nachschub</span></div><div><b>${ws.length ? dur(ws.reduce((x, y) => x + y, 0) / ws.length) : '–'}</b><span>Ø Wartezeit bis Abholung</span></div></div>`);
          const staff = Object.values(s2.people).filter(p => p.skills.indexOf('forklift') >= 0);
          setHTML(X.staff, `<h4>Logistik-Personal</h4><div class="mt-d-list">${staff.map(p => `<div class="mt-d-li click" data-sel="person|${esc(p.id)}"><span class="tm">${esc(p.shift === 'F' ? 'Früh' : 'Spät')}</span><span class="mn"><b>${esc(p.name)}</b><span>${esc(p.state === 'offShift' ? 'nicht im Dienst' : (p.activity || lbl('person', p.state)))}</span></span><span class="rt">${esc(lbl('person', p.state))}</span></div>`).join('')}</div>`);
          setHTML(X.list, `<h4>Staplertransporte heute · ${list.length}</h4>${list.length ? `<div class="mt-d-list">${list.slice(0, 30).map(r => trListItem(r, now, { carrier: true })).join('')}</div>` : '<div class="empty" style="padding:14px">Heute noch keine Staplerfahrt.</div>'}`);
        }
      },
    };
  });
  function agvCause(ag, s, now) {
    const tr = ag.task ? s.transports[ag.task] : null;
    switch (ag.state) {
      case 'toPickup': return tr ? `Fährt leer zur Abholung an ${stName(tr.from.station)} (${placeText(ag.pos)}).` : 'Fährt zur Abholung.';
      case 'loading': return tr ? `Nimmt den Behälter an ${stName(tr.from.station)} auf (${cfg().agvHandleSec || 30} s).` : 'Wird beladen.';
      case 'toDrop': return tr ? `Bringt ${tr.label ? tr.label.split(' · ')[0] : 'den Behälter'} nach ${stName(tr.to.station)} (${kg(tr.weightKg)}).` : 'Fährt zum Ziel.';
      case 'unloading': return tr ? `Stellt den Behälter an ${stName(tr.to.station)} ab.` : 'Wird entladen.';
      case 'toCharge': return ag.mustCharge ? `Akku unter ${cfg().batteryLow || 25} % – fährt zur Ladestation und nimmt bis ${cfg().batteryFull || 90} % keine Aufträge an.` : 'Kein Auftrag offen – fährt zur Ladestation.';
      case 'charging': return ag.mustCharge ? `Lädt – für Aufträge gesperrt, bis ${cfg().batteryFull || 90} % erreicht sind.` : 'Lädt an der Ladestation und übernimmt jederzeit den nächsten Behälter.';
      case 'idle': {
        const open = Object.values(s.transports).filter(t => t.status === 'open' && t.mode === 'AGV');
        const due = open.filter(t => phaseOf(t) !== 'geplant' && t.kind !== 'empty'), plan = open.filter(t => phaseOf(t) === 'geplant');
        if (due.length) return `Bereit – ${due.length} AGV-Transport${due.length > 1 ? 'e warten' : ' wartet'}: ${due[0].waitReason || 'wird gleich zugeteilt'}.`;
        if (plan.length) return `Bereit – ${plan.length} ${plan.length === 1 ? 'Behälter ist' : 'Behälter sind'} vorgemerkt, das Ziel ist voll; ${ag.name} fährt, sobald dort Platz ist.`;
        return 'Bereit an der Ladestation – kein Behälter wartet auf Abholung.';
      }
    }
    return lbl('agv', ag.state);
  }
  function missionBox(r, t, now, pos) {
    if (!r || !t) return `<div class="mt-d-box" style="--c:var(--st-idle)"><div class="mt-d-box-h">${ICO('check', 15)}Kein Auftrag</div><div>Das Fahrzeug übernimmt automatisch den nächsten abholbereiten Behälter (Zuteilung nach Weg, Akku und Wartezeit).</div></div>`;
    const loaded = t.pickupT != null;
    const f = loaded ? routeProgress(r.from, r.to, pos) : 0;
    const what = r.kind === 'bars' ? `Stangen ${matName(r.materialId)}${r.meters ? ' · ' + U.fmtNum(r.meters, 1) + ' m' : ''}` : `${r.qty != null ? stk(r.qty) + ' ' : ''}${r.partName || ''}`;
    const c = TR_C[t.status] || 'var(--info)';
    return `<div class="mt-d-box" style="--c:${c}"><div class="mt-d-box-h">${ICO('route', 15)}<span>${esc(stName(r.from))} → ${esc(stName(r.to))}</span><span class="spacer"></span><small class="mono">${esc(r.id)}</small></div>
      <div><b>${esc(what)}</b>${t.weightKg ? ' · ' + esc(kg(t.weightKg)) : ''}${r.orderId ? ` · <button class="link" data-sel="order|${esc(r.orderId)}">${esc(r.orderId)}</button>` : ''}${r.containerId ? ` · <button class="link" data-sel="container|${esc(r.containerId)}">${esc(r.containerId)}</button>` : ''}</div>
      <div class="mt-route" style="--c:${c}"><span class="ln"></span><span class="pr" style="width:calc((100% - 10px) * ${f.toFixed(3)})"></span><span class="e a"></span><span class="e b"></span><span class="vm" style="left:calc((100% - 12px) * ${f.toFixed(3)});--c:${c};opacity:${loaded ? 1 : .55}"></span></div>
      <div class="row" style="justify-content:space-between;font-size:var(--fs-xs);color:var(--muted)"><span>${esc(trStatusLabel(r))}</span><span>bereit seit ${tclock(r.createdT, now)} · ${loaded ? 'abgeholt ' + tclock(t.pickupT, now) + ' (Wartezeit ' + dur(waitOf(Object.assign({}, r, { pickupT: t.pickupT }), now)) + ')' : 'wartet ' + dur(waitOf(r, now))}</span></div></div>`;
  }

  // ------------------------------------------------------------------ Detail „material“
  WF.registerDetail('material', (id) => {
    const s = S(); const mt0 = s && s.materials[id]; if (!mt0) return null;
    const [sup] = splitBsp(mt0.supplier);
    return {
      title: mt0.name,
      subtitle: `${esc(FORM[mt0.form] || mt0.form)} · ${esc(mt0.id)} · ${esc(sup)}`,
      askPrompt: `Reicht das Material ${mt0.name} für die offenen Aufträge? Wann wird es knapp und sollte ich jetzt nachbestellen?`,
      render(el) {
        bindSel(el);
        this._s = sectionsRender(el, ['hero', 'reo', 'demand', 'pur', 'use', 'master']);
        const mt = S().materials[id];
        const dec = mt.unit === 'm' ? 1 : 0;
        this._s.reo.innerHTML = `<h4>Nachbestellen</h4><div class="mt-d-reo"><div class="row"><div class="mt-qty"><input type="number" inputmode="decimal" min="${dec ? 0.1 : 1}" step="${dec ? 0.1 : 1}" value="${mt.reorderQty}" aria-label="Bestellmenge"><span>${esc(mt.unit)}</span></div><button class="btn primary" data-go>Bestellen</button></div>
          <div class="quick" data-quick></div><div class="sum" data-sum></div></div>`;
        const inp = this._s.reo.querySelector('input'), sum = this._s.reo.querySelector('[data-sum]');
        const upd = () => { const m2 = S().materials[id]; const q = Number(String(inp.value).replace(',', '.')); sum.innerHTML = q > 0 ? `Bestellwert ca. <b>${esc(U.fmtEur(q * m2.pricePerUnit))}</b> · Lieferzeit ca. ${esc(U.fmtDur(m2.leadMin * 60))} · Bestand danach ${esc(amt(m2.onHand + m2.onOrder + q, m2.unit))}` : 'Bitte eine Menge größer 0 eingeben.'; };
        inp.addEventListener('input', upd);
        const go = () => {
          const q = Number(String(inp.value).replace(',', '.'));
          const res = WF.sim.actions.reorder(id, q);
          const ok = !(res && res.ok === false);
          WF.app.toast((res && res.msg) || (ok ? 'Bestellt' : 'Nicht möglich'), ok ? 'ok' : 'warn', ok ? { title: 'Bestellung ausgelöst' + (res && res.id ? ' · ' + res.id : '') } : {});
          invalidate(); V.sig.mat = ''; this._qsig = ''; this.update(el); upd();
        };
        this._s.reo.querySelector('[data-go]').onclick = go;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        this._inp = inp; this._upd = upd;
        upd();
        this.update(el);
      },
      update(el) {
        const s2 = S(); const now = s2.t; const X = this._s; if (!X) return;
        try { scanTransports(); } catch (e) { /* ignorieren */ }
        const mt = s2.materials[id]; if (!mt) return;
        const D = demand(id);
        const ri = reachInfo(mt, D, now);
        const sev = matSev(mt, s2);
        const stTxt = sev.k === 'crit' ? 'Material fehlt an einer Maschine' : mt.onHand < mt.min ? (mt.onHand + mt.onOrder < mt.min ? 'Unter Mindestbestand – nicht bestellt' : 'Unter Mindestbestand – Bestellung unterwegs') : 'Über Mindestbestand';
        const stC = sev.k === 'crit' ? 'var(--st-fault)' : mt.onHand < mt.min ? (mt.onHand + mt.onOrder < mt.min ? 'var(--st-wait)' : 'var(--info)') : 'var(--st-run)';
        const missing = (s2.notifications || []).filter(x => x.status === 'open' && String(x.key || '').indexOf('missing:' + id + ':') === 0);
        setHTML(X.hero, `<div class="mt-d-hero"><div class="mt-d-st">${pill(stC, stTxt)}</div>
          <div class="mt-d-stats"><div><b>${U.fmtNum(mt.onHand, mt.unit === 'm' ? 1 : 0)}<small>${esc(mt.unit)}</small></b><span>Bestand</span></div><div><b>${U.fmtNum(mt.min, mt.unit === 'm' ? 1 : 0)}<small>${esc(mt.unit)}</small></b><span>Mindestbestand</span></div><div><b>${mt.onOrder ? U.fmtNum(mt.onOrder, mt.unit === 'm' ? 1 : 0) + '<small>' + esc(mt.unit) + '</small>' : '–'}</b><span>bestellt</span></div></div>
          <div class="mt-stock" style="min-width:0">${stockBar(mt)}</div>
          <div class="mt-d-box" style="--c:${ri.cls === 'crit' ? 'var(--st-fault)' : ri.cls === 'warn' ? 'var(--st-wait)' : ri.cls === 'ok' ? 'var(--st-run)' : 'var(--st-idle)'}"><div class="mt-d-box-h">${ICO('gauge', 15)}Reichweite: ${esc(ri.main)}</div><div>${esc(ri.sub)}.</div>
          ${missing.map(n => `<div><b>${esc(n.title)}</b> – ${esc(n.body || '')}</div>`).join('')}</div></div>`);
        // Bedarf
        const qsig = D ? D.orders.map(o => o.orderId + o.need.toFixed(2) + (o.start || '')).join(',') : '';
        if (qsig !== this._qsig || !X.demand._h) {
          this._qsig = qsig;
          const quickEl = X.reo.querySelector('[data-quick]');
          const dec = mt.unit === 'm' ? 1 : 0;
          const gap = Math.max(0, (D ? D.need : 0) - mt.onHand - mt.onOrder), toMin = Math.max(0, mt.min - mt.onHand - mt.onOrder);
          const quick = [{ l: `Bestellmenge ${amt(mt.reorderQty, mt.unit)}`, q: mt.reorderQty }];
          if (gap > 0) quick.push({ l: `Fehlmenge ${amt(gap, mt.unit)}`, q: dec ? Math.ceil(gap * 10) / 10 : Math.ceil(gap) });
          if (toMin > 0) quick.push({ l: `bis Minimum ${amt(toMin, mt.unit)}`, q: dec ? Math.ceil(toMin * 10) / 10 : Math.ceil(toMin) });
          quickEl.innerHTML = quick.map((x, i) => `<button class="btn sm ghost" data-qi="${i}">${esc(x.l)}</button>`).join('');
          quickEl.querySelectorAll('[data-qi]').forEach(b => b.onclick = () => { this._inp.value = quick[Number(b.dataset.qi)].q; this._upd(); });
        }
        setHTML(X.demand, `<h4>Offener Bedarf aus Aufträgen</h4>${D && D.orders.length ? `<table class="mt-d-tbl"><thead><tr><th>Auftrag</th><th>Arbeitsplatz</th><th class="r">Teile</th><th class="r">Bedarf</th><th class="r">geplant</th></tr></thead><tbody>${D.orders.map(o => `<tr><td><button class="link" data-sel="order|${esc(o.orderId)}">${esc(o.orderId)}</button><span class="s">${esc(o.partName)}</span></td><td>${esc(stName(o.station))}<span class="s">${esc(U.fmtNum(o.per, o.per < 1 ? 3 : 0))} ${esc(mt.unit)} je Teil</span></td><td class="r">${U.fmtNum(o.parts)}</td><td class="r">${esc(amt(o.need, mt.unit))}</td><td class="r">${o.start != null ? esc(tclock(Math.max(now, o.start), now)) + '<span class="s">bis ' + esc(tclock(o.end, now)) + '</span>' : '–'}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Summe</td><td class="r">${esc(amt(D.need, mt.unit))}</td><td></td></tr></tfoot></table>
          <div class="muted" style="font-size:var(--fs-xs);margin-top:6px">Nur Teile, deren Material noch nicht entnommen ist (bereitgestellte Rohteile und Stangen im Magazin sind abgezogen). Zeitfenster aus der Plantafel.</div>` : '<div class="empty" style="padding:14px">Kein offener Auftrag benötigt dieses Material.</div>'}`);
        // Bestellungen
        const pur = (s2.purchases || []).filter(p => p.materialId === id).sort((a, b) => (a.status === 'bestellt' ? 0 : 1) - (b.status === 'bestellt' ? 0 : 1) || b.orderedT - a.orderedT);
        setHTML(X.pur, `<h4>Bestellungen</h4>${pur.length ? `<div class="mt-d-list">${pur.slice(0, 12).map(p => `<div class="mt-d-li"><span class="tm">${tclock(p.orderedT, now)}</span><span class="mn"><b>${esc(amt(p.qty, mt.unit))} · ${esc(U.fmtEur(p.costEur))}</b><span>${esc(p.id)} · ${esc(splitBsp(p.supplier)[0])}</span></span><span class="rt">${p.status === 'bestellt' ? pill('var(--info)', 'Lieferung ca. ' + tclock(p.etaT, now)) : pill('var(--st-run)', 'geliefert ' + tclock(p.deliveredT, now))}</span></div>`).join('')}</div>` : '<div class="empty" style="padding:14px">Keine Bestellungen in dieser Sitzung.</div>'}`);
        // Entnahmen / Ereignisse heute
        const d0 = dayStart(now);
        const evs = (s2.events || []).filter(e => e.t >= d0 && ((e.entity && e.entity.kind === 'material' && e.entity.id === id) || (e.type === 'bars' && e.msg && e.msg.indexOf(mt.name) >= 0) || (e.type === 'barsOrder' && e.msg && e.msg.indexOf(mt.name) >= 0))).slice(-14).reverse();
        const wd = withdrawnToday(id), used = usedToday(mt), dq = mt.unit === 'm' ? 1 : 0;
        const qv = (v) => (v > 1e-6 ? esc(U.fmtNum(v, dq)) + '<small>' + esc(mt.unit) + '</small>' : '–');
        const diff = Math.abs(used - wd) > (mt.unit === 'm' ? 0.05 : 0.5);
        setHTML(X.use, `<h4>Verbrauch &amp; Lagerbewegungen heute</h4><div class="mt-d-stats" style="margin-bottom:8px"><div title="An den Maschinen verbraucht (Säge, Stangenlader, Rohteile) – derselbe Wert wie im Copilot"><b>${qv(used)}</b><span>Verbrauch Maschinen</span></div><div><b>${qv(wd)}</b><span>aus Lager entnommen</span></div><div><b>${esc(U.fmtEur(used * mt.pricePerUnit))}</b><span>Wert verbraucht</span></div></div>
          ${diff ? `<div class="muted" style="font-size:var(--fs-sm);margin:-2px 0 8px">${wd > used ? 'Mehr entnommen als verbraucht: der Rest liegt im Magazin des Stangenladers bzw. als Rohteile bereit.' : 'Mehr verbraucht als heute entnommen: der Rest kam aus dem Stangenmagazin (vor 00:00 bzw. vor Schichtbeginn befüllt).'}</div>` : ''}
          ${evs.length ? `<div class="mt-d-list">${evs.map(e => `<div class="mt-d-li"><span class="tm">${U.fmtClock(e.t)}</span><span class="mn"><span class="ev">${esc(e.msg)}</span></span><span></span></div>`).join('')}</div>` : '<div class="muted" style="font-size:var(--fs-sm)">Heute keine Ereignisse zu diesem Material.</div>'}`);
        const loc = STN(mt.location);
        setHTML(X.master, `<h4>Stammdaten</h4><dl class="dl"><dt>Lieferant</dt><dd>${esc(mt.supplier)}</dd><dt>Lieferzeit</dt><dd>ca. ${esc(U.fmtDur(mt.leadMin * 60))}</dd><dt>Preis</dt><dd>${esc(U.fmtEur(mt.pricePerUnit, 2))} je ${esc(mt.unit)}</dd><dt>Bestellmenge</dt><dd>${esc(amt(mt.reorderQty, mt.unit))}</dd><dt>Mindestbestand</dt><dd>${esc(amt(mt.min, mt.unit))}</dd><dt>Lagerort</dt><dd>${esc(loc ? loc.name : mt.location)}</dd><dt>Lagerwert</dt><dd>${esc(U.fmtEur(mt.onHand * mt.pricePerUnit))}</dd></dl>`);
      },
    };
  });

  // ------------------------------------------------------------------ Detail „container“
  WF.registerDetail('container', (id) => {
    const s = S(); if (!s) return null;
    const c0 = s.containers[id];
    const hist = [...L.tr.values()].filter(r => r.containerId === id);
    if (!c0 && !hist.length) return null;
    const part = c0 ? c0.partName : hist[0].partName;
    return {
      title: `Behälter ${id}`,
      subtitle: `${esc(part || '')}${c0 ? ' · ' + esc(c0.orderId) : hist[0].orderId ? ' · ' + esc(hist[0].orderId) : ''}`,
      askPrompt: `Wo ist der Behälter ${id} gerade, was ist drin und wann ist er beim nächsten Arbeitsgang?`,
      render(el) { bindSel(el); this._s = sectionsRender(el, ['hero', 'content', 'route', 'hist']); this.update(el); },
      update(el) {
        const s2 = S(); const now = s2.t; const X = this._s; if (!X) return;
        try { scanTransports(); } catch (e) { /* ignorieren */ }
        const c = s2.containers[id];
        const trs = [...L.tr.values()].filter(r => r.containerId === id).sort((a, b) => a.createdT - b.createdT);
        if (!c) {
          const last = trs[trs.length - 1];
          setHTML(X.hero, `<div class="mt-d-hero"><div class="mt-d-st">${pill('var(--st-idle)', 'Nicht mehr im Umlauf')}</div><div class="mt-d-cause">Der Behälter wurde aufgebraucht (alle Teile entnommen) oder ist abgeschlossen.${last ? ' Letzte Fahrt: ' + esc(stName(last.from)) + ' → ' + esc(stName(last.to)) + ' um ' + tclock(last.doneT || last.createdT, now) + '.' : ''}</div></div>`);
          setHTML(X.content, ''); setHTML(X.route, '');
        } else {
          const cv = WF.sim.containerView(id) || {};
          const col = CT_C[c.state] || 'var(--muted)';
          const o = s2.orders[c.orderId];
          // Kopf: Zustand + genau eine Ortszeile; Detailzeile nur, wenn sie etwas Neues sagt (kein „Im Versand / Versand / Im Versand“)
          const whereTxt = c.state === 'shipped' ? (STN('VERSAND') ? STN('VERSAND').name : 'Versand') : c.state === 'scrap' ? (STN('SPERR') ? STN('SPERR').name : 'Sperrlager') : (cv.where || '');
          const detail = c.state === 'shipped' ? '' : c.state === 'external' ? esc((c.location && c.location.process) || '') : ctLine(c, s2, now).html.replace(/<span class="fb">.*?<\/span><\/span>/, '');
          setHTML(X.hero, `<div class="mt-d-hero"><div class="mt-d-st">${pill(col, lbl('container', c.state))}<span class="mt-d-since">${esc(whereTxt)}</span></div>${detail ? `<div class="mt-d-cause" style="font-size:var(--fs-md);color:var(--text2)">${detail}</div>` : ''}</div>`);
          const tr = c.transportId ? s2.transports[c.transportId] : null;
          setHTML(X.content, `<h4>Inhalt</h4><dl class="dl"><dt>Teile</dt><dd><b>${esc(stk(c.qty))}</b> ${esc(c.partName)}${o ? ' <span class="muted">(' + esc(o.part.no) + ')</span>' : ''}</dd>
            <dt>Auftrag</dt><dd>${o ? `<button class="link" data-sel="order|${esc(o.id)}">${esc(o.id)}</button> · ${esc(o.customer)}` : esc(c.orderId)}</dd>
            <dt>Art</dt><dd>${esc(lbl('containerKind', c.kind))}${c.supplied ? ' (Beistellteile des Kunden)' : ''}</dd>
            <dt>Gewicht</dt><dd>${esc(kg(c.weightKg))} inkl. ${c.weightKg > 60 ? 'Gitterbox' : 'Kleinladungsträger'}${c.weightKg > 250 ? ' – nur per Stapler' : ' – AGV-fähig'}</dd>
            <dt>Erstellt</dt><dd>${esc(tclock(c.createdT, now))}${c.readyT ? ' · abholbereit ' + esc(tclock(c.readyT, now)) : ''}</dd>
            ${tr && tr.status !== 'done' ? `<dt>Transport</dt><dd><span class="mono">${esc(tr.id)}</span> · ${esc(trStatusLabel(L.tr.get(tr.id) || { status: tr.status, mode: tr.mode }))}${tr.waitReason && tr.status === 'open' ? ' – ' + esc(tr.waitReason) : ''}</dd>` : ''}
            ${c.location && c.location.kind === 'external' ? `<dt>Übergeben</dt><dd>${esc(tclock(c.location.sentT, now))} an ${esc(splitBsp(c.location.partner)[0])}${c.location.lotQty ? ' · Los ' + esc(stk(c.location.lotQty)) : ''}</dd>` : ''}</dl>`);
          // Arbeitsplan-Kette mit Position des Behälters
          if (o) {
            const chain = o.routing.map((r, i) => {
              const isSrc = i === c.src, isDst = i === c.idx;
              const cc = isDst ? col : isSrc ? 'var(--text2)' : 'var(--line2)';
              return `<div class="op${isDst ? ' cur' : ''}" style="--c:${cc}"><b>AG ${r.seq}</b><span>${esc(r.station === 'EXT' ? 'Härterei' : stName(r.station))}</span></div>`;
            }).join(`<span class="ar">${ICO('chevron', 12)}</span>`);
            setHTML(X.route, `<h4>Weg durch den Arbeitsplan</h4><div class="mt-chain">${chain}</div><div class="muted" style="font-size:var(--fs-xs);margin-top:6px">${c.src >= 0 ? 'Aus AG ' + esc(String(o.routing[c.src].seq)) + ' ' + esc(o.routing[c.src].op) : 'Aus dem Rohmaterial-Lager'} → ${c.idx < o.routing.length ? 'für AG ' + esc(String(o.routing[c.idx].seq)) + ' ' + esc(o.routing[c.idx].op) : 'Versand'}</div>`);
          } else setHTML(X.route, '');
        }
        // Verlauf: Erstellung, Transporte, Fremdbearbeitung
        const items = [];
        if (c) {
          const o = s2.orders[c.orderId], rt = o ? o.routing : [];
          const srcSt = c.src >= 0 && rt[c.src] ? rt[c.src].station : null;
          const preStart = c.createdT <= (s2.startT || 0) + 1;
          if (preStart) {
            // Vor dem Simulationsstart angelegt: bisherigen Weg aus dem Arbeitsplan nachtragen, Stand bei Start aus erster Fahrt bzw. Ort
            const steps = rt.slice(0, Math.max(0, c.src + 1)).map(r => `AG ${r.seq} ${r.station === 'EXT' ? haertName() : stName(r.station)}`);
            if (steps.length) items.push({ t: c.createdT - 1, tl: 'vorher', h: `<b>Vor Simulationsstart bearbeitet</b><span>${esc(steps.join(' → '))}</span>` });
            const first = trs[0];
            const startAt = first ? stName(first.from) : c.state === 'shipped' ? stName('VERSAND') : c.state === 'external' ? haertName() : c.location && c.location.kind === 'station' ? stName(c.location.id) : (WF.sim.containerWhere ? WF.sim.containerWhere(id) : '') || '–';
            items.push({ t: c.createdT, h: `<b>Stand bei Simulationsstart</b><span>${esc(startAt)}${c.state === 'shipped' && !first ? ' · Fertigteile bereit zur Auslieferung' : ''}</span>` });
          } else items.push({ t: c.createdT, h: `<b>Behälter angelegt</b><span>${srcSt ? 'an ' + esc(stName(srcSt)) : 'im Lager'}</span>` });
        }
        for (const r of trs) {
          if (r.pickupT != null) items.push({ t: r.pickupT, h: `<b>Abgeholt an ${esc(stName(r.from))}</b><span>${esc(r.carrier || r.mode)} · ${esc(r.id)} · Wartezeit ${dur(waitOf(r, now))}${plannedSec(r, now) > 300 ? ' · vorher vorgemerkt ' + dur(plannedSec(r, now)) + ' (Ziel voll)' : ''}</span>` });
          else if (r.status !== 'done') items.push({ t: r.createdT, h: `<b>Transport nach ${esc(stName(r.to))} ${isPlanned(r) ? 'vorgemerkt' : 'angefordert'}</b><span>${esc(r.id)} · ${esc(trStatusLabel(r))}${isPlanned(r) ? ' – Ziel voll' : ''}</span>` });
          if (r.status === 'done') items.push({ t: r.doneT, h: `<b>${r.cancelled ? 'Transport entfallen' : 'Abgestellt an ' + esc(stName(r.to))}</b><span>${esc(r.id)}${r.pickupT != null ? ' · Fahrt ' + dur(r.doneT - r.pickupT) : ''}</span>` });
        }
        for (const x of L.ext) if (x.containers.indexOf(id) >= 0) items.push({ t: x.t, h: x.type === 'out' ? `<b>An ${esc(haertName())} übergeben</b><span>${esc(x.process || '')}${x.returnT ? ' · Rückkehr ca. ' + esc(tclock(x.returnT, now)) : ''}</span>` : `<b>Zurück im Wareneingang</b><span>von ${esc(haertName())}</span>` });
        items.sort((a, b) => b.t - a.t);
        setHTML(X.hist, `<h4>Verlauf</h4>${items.length ? `<div class="mt-d-list">${items.map(x => `<div class="mt-d-li"><span class="tm">${x.tl ? esc(x.tl) : tclock(x.t, now)}</span><span class="mn">${x.h}</span><span></span></div>`).join('')}</div>` : '<div class="muted" style="font-size:var(--fs-sm)">Noch keine Bewegung aufgezeichnet.</div>'}`);
      },
    };
  });

  // ================================================================== öffentliche Hilfen
  WF.material = { flowsToday, transportsToday, agvUtil, forkUtil, shiftWindow, batteryHistory, demand, withdrawnToday, openReorder, ledger: () => L, profile: (on) => { V.prof = on ? {} : null; return V.prof; }, profileData: () => V.prof };
})();
