/* werkfluss – Ansicht „Werkzeuge“ (46_tools.js) + Detail „tool“.
   Ziel: die Werkzeuglogik der Engine (§3.4, eine sichtbare Regel) vollständig nachvollziehbar machen.
   Abschnitte: Kennzahlen · Wechselplan (SVG-Zeitleiste je Maschine: Rückblick mit Ist-Zuständen und Wechseln,
   Plan der Engine, voraussichtliche Folgewechsel, Rüsten laut Prognose, Pausen/Schichtgrenzen) · Erklärkarte
   „So plant werkfluss Werkzeugwechsel“ (Regel in sechs Schritten, live am Beispielwerkzeug) · Werkzeuge in den
   Maschinen (gruppiert oder nach Dringlichkeit) · Werkzeugausgabe (Aufträge, Bestand, Kosten) · Wechselhistorie.
   Nur lesen (WF.sim.*). Aktualisierung: Modell nur bei neuer Sim-Zeit, Abschnitte per Signatur, Listen per Schlüssel
   gepatcht (Fokus/Scroll bleiben erhalten). Eigene Prognosen („voraussichtlich“) nur dort, wo die Engine noch keinen
   Wert liefert – immer als solche gekennzeichnet. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;
  const P = WF.profile;
  const DAY = 86400, WEEK = 7 * DAY;

  // ------------------------------------------------------------------ Konstanten
  const ST_C = { ok: 'var(--st-run)', planned: 'var(--st-tool)', due: 'var(--st-wait)', broken: 'var(--st-fault)', changing: 'var(--st-tool)',
    replace: 'var(--st-setup)', keep: 'var(--st-setup)', setup: 'var(--st-setup)', missing: 'var(--st-idle)', idle: 'var(--st-idle)' };
  const ST_RANK = { broken: 0, due: 1, changing: 2, planned: 3, ok: 4, setup: 5, replace: 5, keep: 5, missing: 6, idle: 7 };
  const CAT = {
    rule:      { label: 'Regelwechsel',        c: 'var(--st-tool)',  hint: 'Reststandzeit an der Wechselgrenze' },
    bundled:   { label: 'Mitgewechselt',       c: 'var(--info)',     hint: 'beim selben Stopp mitgenommen' },
    manual:    { label: 'Vorbeugend',          c: 'var(--st-setup)', hint: 'manuell beauftragt' },
    exhausted: { label: 'Standzeit erschöpft', c: 'var(--st-wait)',  hint: 'Maschine musste warten' },
    break:     { label: 'Werkzeugbruch',       c: 'var(--st-fault)', hint: 'Bruch während der Bearbeitung' },
  };
  // Grundbestand der Werkzeugausgabe je Werkzeugart – Spiegel der Engine-Konstante STOCK_DEFAULT (10_sim.js, nicht exportiert)
  const STOCK_BASE = { insert: 8, drill: 4, mill: 4, hob: 2, wheel: 2, saw: 3 };
  const PIPE = ['Angefordert', 'Werkzeugausgabe', 'Unterwegs', 'An der Maschine', 'Wechsel'];
  // Schneide wenden: kein Gang zur Werkzeugausgabe – nur angekündigt → an der Maschine gewendet
  const PIPE_IDX = ['Angekündigt', 'Wenden an der Maschine'];
  // Mengen-/Kostenbalken neutral (UI_GUIDE Regel 15) – Farbe nur für die Aussage
  const NEUTRAL_BAR = 'color-mix(in srgb,var(--text2) 55%,transparent)';

  // ------------------------------------------------------------------ kleine Helfer
  const S = () => WF.sim && WF.sim.state;
  const CFG = () => (WF.sim && WF.sim.config) || {};
  const policy = () => P.sim.toolPolicy || {};
  const PLAN_AT = () => (policy().planAtParts != null ? policy().planAtParts : 2);
  const tclock = (t, now) => (t == null ? '–' : Math.floor(t / DAY) === Math.floor(now / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const pName = (id) => { const s = S(); const p = s && s.people && s.people[id]; return p ? shortName(p.name) : (id || '–'); };
  const teile = (n) => U.fmtNum(n) + (n === 1 ? ' Teil' : ' Teile');
  const teilen = (n) => U.fmtNum(n) + (n === 1 ? ' Teil' : ' Teilen');   // Dativ: „in ca. 9 Teilen“, „bei ≤ 2 Teilen Rest“
  // Kurzzeichen je Werkzeugtyp für die Marker der Zeitleiste (Fallback: ISO-Kürzel bzw. erstes Wort)
  const CODE = { 'TT-SB': 'Sägeband', 'TT-CNMG': 'CNMG', 'TT-VNMG': 'VNMG', 'TT-DR68': 'Bo Ø6,8', 'TT-STECH': 'Stech', 'TT-MIKRO': 'VCGT',
    'TT-ABST': 'Abstech', 'TT-CNMGL': 'CNMG', 'TT-DNMGL': 'DNMG', 'TT-VHM10': 'VHM Ø10', 'TT-PF63': 'PF Ø63', 'TT-DR85': 'Bo Ø8,5',
    'TT-GBM10': 'GB M10', 'TT-VHM16': 'VHM Ø16', 'TT-PF80': 'PF Ø80', 'TT-DR10': 'Bo Ø10', 'TT-BTA40': 'BTA Ø40', 'TT-ELB20': 'ELB Ø20',
    'TT-WF2': 'WF m2', 'TT-WF15': 'WF m1,5', 'TT-SSR': 'Scheibe', 'TT-SSF': 'Scheibe' };
  const codeOf = (typeId, name) => CODE[typeId] || ((String(name || '').match(/\b([A-Z]{4})\s?\d/) || [])[1]) || String(name || typeId).split(/[\s-]+/)[0].slice(0, 9);
  /** Teilegrenze lesbar: „nach Teil 7“, an der Grenze 0 (vor dem ersten Teil des Arbeitsgangs) „vor Teil 1“ */
  const afterTxt = (n) => (n > 0 ? 'nach Teil ' + n : 'vor Teil 1');
  /** Wendeschneidplatten mit mehreren Schneiden: wird an der Maschine gewendet („Schneide 2/4“), erst die letzte Schneide
      geht in die Werkzeugausgabe. Nur wenn die Engine das liefert (Feldnamen tolerant erkannt), sonst null. */
  function edgeOf(t) {
    if (!t) return null;
    const e = t.edge, of = t.edges != null ? t.edges : t.edgeCount != null ? t.edgeCount : e && typeof e === 'object' ? (e.of != null ? e.of : e.total) : null;
    const no = typeof e === 'number' ? e : e && typeof e === 'object' ? (e.no != null ? e.no : e.n) : t.edgeNo != null ? t.edgeNo : null;
    if (!(of > 1) || !(no >= 1)) return null;
    return { no, of, last: no >= of };
  }
  /** Schneide wenden – in allen Teilen dieser Ansicht eine Formulierung, passend zur Leitstand-Meldung
      („Schneide wenden geplant – M04 …“, „Bediener wendet an der Teilegrenze …“):
      was „Schneide wenden 1 → 2/4“ · wer/wo „L. Wagner an der Maschine“ · Dauer „ca. 1–2 min“ · wann „nach Teil 7 · ca. 08:45“.
      Wer: Person laut Engine-Plan (plannedChange.by) bzw. Wendeauftrag, sonst die Bediener:in der Maschine (machineView.operator) –
      die Engine teilt das Wenden bevorzugt ihr zu. Nie „Werkzeug liegt bereit“ oder „Einrichter:in“ – beim Wenden wird nichts geholt. */
  const idxDur = () => { const im = CFG().indexMin || [1, 2]; return `ca. ${im[0]}–${im[1]} min`; };
  function idxWhat(t) { const eg = edgeOf(t); return eg && !eg.last ? `Schneide wenden ${eg.no} → ${eg.no + 1}/${eg.of}` : 'Schneide wenden'; }
  const mxOf = (id) => (MODEL ? MODEL.machines.find(x => x.id === id) : null);
  function idxName(machineId, pc, mx0) {
    if (pc && pc.by) return pc.by;
    const s = S();
    if (s) for (const id in s.tasks) { const tk = s.tasks[id]; if (tk.type === 'toolChange' && tk.machineId === machineId && tk.data && tk.data.index && tk.assignee) return pName(tk.assignee); }
    const mx = mx0 || mxOf(machineId), op = mx && mx.mv ? mx.mv.operator : null;
    return op && op.name ? shortName(op.name) : null;
  }
  function idxWho(machineId, pc) {
    const n = idxName(machineId, pc);
    if (!n) return 'Bediener:in an der Maschine';
    return pc && pc.by && pc.stage === 'unterwegs zur Maschine' ? `${n} kommt an die Maschine` : `${n} an der Maschine`;
  }
  const ROLE_TXT = { Einrichter: 'die Einrichter:innen', Schichtleitung: 'die Schichtleitung' };
  const roleTxt = (r) => ROLE_TXT[r] || r || 'die Schichtleitung';
  /** offene Werkzeug-Meldung einer Maschine (gleiche Karte wie im Leitstand) */
  function toolNotif(machineId) { const s = S(); return ((s && s.notifications) || []).find(n => n.key === 'tool:' + machineId && n.status !== 'resolved') || null; }
  const pct = (v, d = 0) => (v == null ? '–' : U.fmtNum(v, d) + ' %');
  const minTxt = (m) => (m == null ? '–' : m < 10 ? U.fmtNum(m, 1) + ' min' : U.fmtDur(m * 60));
  const ago = (sec) => (sec < 90 ? 'gerade eben' : 'vor ' + U.fmtDur(Math.round(sec / 60) * 60));
  const toolShort = (n) => String(n || '').replace(/\s*\([^)]*\)/g, '').replace(/^WSP\s+/, '').trim();
  const TT = (id) => P.toolTypeById[id] || null;
  const stShort = (id) => (P.stationById[id] ? P.stationById[id].short : id);
  function setHTML(node, html) { if (node && node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node && node._t !== txt) { node._t = txt; node.textContent = txt; } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  const chip = (label, c, cls) => `<span class="tl-chip${cls ? ' ' + cls : ''}" style="--c:${c}">${esc(label)}</span>`;
  const stLabel = (s) => (WF.sim && WF.sim.label ? WF.sim.label('toolStatus', s) : s);
  const kindLabel = (k) => (WF.sim && WF.sim.label ? WF.sim.label('toolKind', k) : k);

  /** Schlüsselbasiertes Patchen einer Liste: bestehende Knoten bleiben (Fokus, Hover), nur geänderte werden neu befüllt */
  function patchList(box, items) {
    const have = box._map || (box._map = new Map());
    const keep = new Set();
    let prev = null;
    for (const it of items) {
      keep.add(it.key);
      let n = have.get(it.key);
      if (!n) {
        n = document.createElement(it.tag || 'div');
        if (it.attrs) for (const k in it.attrs) n.setAttribute(k, it.attrs[k]);
        have.set(it.key, n);
      }
      if (n.className !== it.cls) n.className = it.cls;
      if (it.style != null && n._st !== it.style) { n._st = it.style; n.setAttribute('style', it.style); }
      if (n._sig !== it.sig) { n._sig = it.sig; n.innerHTML = it.html; }
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== n) box.insertBefore(n, want);
      prev = n;
    }
    for (const [k, n] of have) if (!keep.has(k)) { n.remove(); have.delete(k); }
  }

  // ------------------------------------------------------------------ Arbeitszeitfenster (wie Engine: Mo–Fr, Schichten ohne Pausen)
  let WIN = null;
  function workWins() {
    if (WIN) return WIN;
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of P.shifts) {
      let a = U.hm(sh.start);
      for (const b of sh.breaks) { const b0 = U.hm(b[0]); if (b0 > a) w.push([d * DAY + a, d * DAY + b0]); a = U.hm(b[1]); }
      const e = U.hm(sh.end); if (e > a) w.push([d * DAY + a, d * DAY + e]);
    }
    return (WIN = w.sort((x, y) => x[0] - y[0]));
  }
  /** Arbeitszeit ab t addieren (Einlege-Maschinen laufen nur in der Schicht) */
  function addWork(t, sec) {
    if (!(sec > 0)) return t;
    let base = Math.floor(t / WEEK) * WEEK;
    for (let g = 0; g < 60; g++) {
      for (const w of workWins()) {
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
  /** Pausen und schichtfreie Zeit im Fenster [a, b] – für die Hinterlegung der Zeitleiste */
  function offBlocks(a, b) {
    const out = [];
    const d0 = Math.floor(a / DAY) - 1, d1 = Math.floor(b / DAY) + 1;
    for (let d = d0; d <= d1; d++) {
      const wd = ((d % 7) + 7) % 7;
      const base = d * DAY;
      if (wd >= 5) { out.push({ t0: base, t1: base + DAY, kind: 'off' }); continue; }
      const sh = P.shifts.slice().sort((x, y) => U.hm(x.start) - U.hm(y.start));
      const first = U.hm(sh[0].start), last = U.hm(sh[sh.length - 1].end);
      out.push({ t0: base, t1: base + first, kind: 'off' });
      out.push({ t0: base + last, t1: base + DAY, kind: 'off' });
      for (const s of sh) for (const br of s.breaks) out.push({ t0: base + U.hm(br[0]), t1: base + U.hm(br[1]), kind: 'break' });
    }
    return out.filter(x => x.t1 > a && x.t0 < b).map(x => ({ t0: Math.max(a, x.t0), t1: Math.min(b, x.t1), kind: x.kind }));
  }

  // ------------------------------------------------------------------ Werkzeug-Regeln (aus Engine-Konstanten abgeleitet)
  function changeLimit(life, cut) { const f = CFG().changeFrac != null ? CFG().changeFrac : 0.1; return cut > 0 ? Math.max(0, Math.min(PLAN_AT(), Math.floor(f * life / cut + 1e-9))) : 0; }
  /** Dauer eines Wechsels: Wenden einer Wendeplatte an der Maschine (Engine CFG.indexMin) oder Tausch je Werkzeugart */
  function changeSecOf(kind, index) { if (index) { const im = CFG().indexMin || [1, 2]; return (im[0] + im[1]) / 2 * 60; } return changeSecKind(kind); }
  /** Wird der nächste Wechsel dieses Werkzeugs ein Wenden (Engine: nextAction / plannedChange.action)? */
  const willIndex = (t) => !!t && ((t.plannedChange && t.plannedChange.action) ? t.plannedChange.action === 'index' : t.nextAction ? t.nextAction === 'index' : false);
  function changeSecKind(kind) {
    const tp = policy(), byKind = CFG().changeMinByKind || {};
    const cm = kind === 'insert' && tp.changeMin ? tp.changeMin : (byKind[kind] || [4, 7]);
    return (cm[0] + cm[1]) / 2 * 60;
  }
  function stockReady(typeId) { const s = S(); const st = s && s.toolStock && s.toolStock[typeId]; return st ? st.ready : null; }

  // ------------------------------------------------------------------ Modell (einmal je Sim-Zeit)
  let MODEL = null, MODEL_T = -1, MODEL_V = 0;
  WF.bus.on('sim:reset', () => { MODEL = null; MODEL_T = -1; MODEL_V++; });
  function getModel() {
    const s = S(); if (!s) return null;
    if (MODEL && MODEL_T === s.t) return MODEL;
    try { MODEL = buildModel(); } catch (e) { console.error('[werkzeuge] Modell', e); MODEL = MODEL || null; }
    MODEL_T = s.t;
    return MODEL;
  }

  function buildModel() {
    const sim = WF.sim, s = sim.state, now = s.t;
    const ds = U.dayStart(now);
    let fc = null; try { fc = sim.forecast(); } catch (e) { fc = null; }
    const machines = [], tools = [];
    const evToday = [], ev24 = [];
    for (const e of s.events) if (e.type === 'toolChanged' && e.t >= now - DAY) { ev24.push(e); if (e.t >= ds) evToday.push(e); }

    for (const id of P.machines) {
      const st = P.stationById[id]; if (!st || st.kind !== 'machine') continue;
      const mv = sim.machineView(id); if (!mv) continue;
      if (!mv.tools.length) continue;
      const raw = s.machines[id];
      const o = mv.order ? s.orders[mv.order.id] : null;
      const r = o ? o.routing.find(x => x.seq === mv.order.seq) : null;
      const loadMin = r && r.loadMin != null ? r.loadMin : (st.loadMin || 0);
      const cyc = mv.order ? (mv.order.cycleMin || 1) * 60 + (mv.loading === 'perPart' ? Math.round((loadMin || 1) * 60) : 0) : null;
      const run = mv.partNo != null ? 1 : 0;
      const processed = mv.partsDone + run;
      // Teilegrenze 0: Ende des laufenden Teils bzw. jetzt; unbekannt bei fehlendem Material / vollem Ausgang
      let b0 = null;
      if (mv.partEndT != null) b0 = mv.partEndT;
      else if (mv.state === 'starved' || mv.state === 'blocked') b0 = null;
      else if (mv.state === 'toolchange' && raw && raw.toolchange) b0 = Math.max(now, raw.toolchange.t0 + raw.toolchange.dur);
      else if (mv.state === 'fault' && mv.fault) b0 = now + Math.max(0, mv.fault.repairSec - mv.fault.sinceSec) + 300;
      else b0 = now;
      const bt = (k) => (b0 == null || cyc == null ? null : k <= 0 ? b0 : mv.loading === 'auto' ? b0 + k * cyc : addWork(b0, k * cyc));
      const mx = { id, mv, raw, short: mv.short, name: mv.name, area: mv.area, cyc, run, processed, b0, bt, tools: [], groups: [], proj: [], past: [], fc: fc && fc.machines ? (fc.machines[id] || []) : [] };
      const opTools = mv.tools.filter(t => t.status !== 'idle');
      let slot = 0;
      for (const tv of mv.tools) {
        const tx = Object.assign({}, tv, { machineId: id, machineShort: mv.short, slot: tv.status === 'idle' ? null : ++slot, announcedT: tv.id && s.tools[tv.id] && s.tools[tv.id].plannedT != null ? s.tools[tv.id].plannedT : null });
        tx.need = tv.neededParts != null && tv.remainingPartsAfterPart != null ? (tv.neededParts - run) > tv.remainingPartsAfterPart : false;
        tx.proj = [];
        mx.tools.push(tx); tools.push(tx);
      }
      // Engine-Plan: Werkzeuge mit plannedChange je Teilegrenze zusammenfassen (ein Stopp = ein Marker)
      const gm = {};
      for (const tx of mx.tools) {
        const pc = tx.plannedChange; if (!pc) continue;
        const k = pc.afterPart + '|' + (pc.etaT || 0);
        if (!gm[k]) { gm[k] = { key: id + ':g:' + k, t: pc.etaT, afterPart: pc.afterPart, by: pc.by, byId: pc.byId, stage: pc.stage, waitFromT: pc.waitFromT, note: pc.note, text: pc.text, later: pc.stage === 'später', tools: [] }; mx.groups.push(gm[k]); }
        gm[k].tools.push(tx);
      }
      mx.groups.sort((a, b) => (a.t || 1e12) - (b.t || 1e12));
      { const first = mx.groups.find(g => !g.later && g.t != null); for (const g of mx.groups) if (g.later) for (const tx of g.tools) tx.laterAfterT = first ? first.t : null; }
      mx.changing = mv.state === 'toolchange' && raw && raw.toolchange ? { t0: raw.toolchange.t0, t1: raw.toolchange.t0 + raw.toolchange.dur, by: raw.toolchange.by, list: raw.toolchange.list } : null;
      mx.proj = projectMachine(mx, now);
      for (const tx of mx.tools) {
        const p0 = tx.proj[0];
        if (!p0 && !tx.plannedChange && mx.stopAt && tx.need && tx.status === 'ok') tx.afterStop = mx.stopAt;
        tx.nextT = tx.plannedChange && tx.plannedChange.etaT != null ? tx.plannedChange.etaT : p0 ? p0.t : null;
        tx.urg = [ST_RANK[tx.status] != null ? ST_RANK[tx.status] : 8, tx.nextT != null ? tx.nextT : 1e12, tx.remainingParts != null ? tx.remainingParts : 1e9];
      }
      mx.past = ev24.filter(e => e.entity && e.entity.id === id);
      mx.nextT = Math.min(...mx.groups.map(g => g.t != null ? g.t : 1e12), ...mx.proj.map(p => p.t != null ? p.t : 1e12));
      mx.opTools = opTools.length;
      machines.push(mx);
    }

    // absehbare Stillstände (Standzeit endet, bevor jemand wechseln kann)
    const waitAhead = [];
    for (const mx of machines) {
      let w = null;
      for (const g of mx.groups) if (g.waitFromT != null && g.waitFromT < now + 8 * 3600) w = w == null ? g.waitFromT : Math.min(w, g.waitFromT);
      for (const p of mx.proj) if (p.waitFromT != null && p.waitFromT < now + 8 * 3600) w = w == null ? p.waitFromT : Math.min(w, p.waitFromT);
      if (w != null) waitAhead.push({ id: mx.id, t: Math.max(now, w) });
    }
    waitAhead.sort((a, b) => a.t - b.t);
    // Kennzahlen
    let waitSec = 0, tcSec = 0, waitMachines = 0;
    for (const id of P.machines) {
      const st = P.stationById[id]; if (!st || st.kind !== 'machine') continue;
      const mx = machines.find(m => m.id === id);
      const mv = mx ? mx.mv : sim.machineView(id);
      const w = (mv && mv.stateTimes && mv.stateTimes.waitTool) || 0;
      waitSec += w; if (w > 0) waitMachines++;
      tcSec += (mv && mv.stateTimes && mv.stateTimes.toolchange) || 0;
    }
    const inUse = tools.filter(t => t.id && t.status !== 'idle');
    const stops = evToday.length;
    const durs = evToday.map(e => e.data && e.data.durSec).filter(x => x > 0);
    const h2 = now + 2 * 3600;
    const plan2 = [], proj2 = [];
    for (const mx of machines) {
      for (const g of mx.groups) if (g.t != null && g.t <= h2) plan2.push({ m: mx, g });
      for (const p of mx.proj) if (p.t != null && p.t <= h2 && p.kind === 'proj') proj2.push(p);
    }
    plan2.sort((a, b) => a.g.t - b.g.t);
    const plan2Tools = plan2.reduce((n, x) => n + x.g.tools.length, 0);

    // Kosten heute (ausgebaute Werkzeuge mit Zeitstempel heute)
    const cost = { total: Math.round(s.toolCostToday || 0), scrap: 0, regrind: 0, indexed: 0, setup: 0, change: 0, byType: {}, byCat: {}, byMachine: {} };
    const catMap = {};
    for (const e of evToday) for (const x of (e.data && e.data.tools) || []) if (x.oldToolId) catMap[x.oldToolId] = catOf(x).key;
    for (const id in s.tools) {
      const tl = s.tools[id];
      if (tl.state === 'mounted' || tl.dismountT == null || tl.dismountT < ds) continue;
      const c = tl.cost || 0;
      if (tl.state === 'regrind') cost.regrind += c; else if (tl.state === 'scrap') cost.scrap += c; else if (tl.state === 'indexed') cost.indexed += c;
      if (tl.reason === 'Rüsten') cost.setup += c; else cost.change += c;
      const ck = tl.reason === 'Rüsten' ? 'setup' : catMap[tl.id] || (tl.reason === 'Werkzeugbruch' ? 'break' : 'rule');
      const bc = cost.byCat[ck] || (cost.byCat[ck] = { n: 0, eur: 0 });
      bc.n++; bc.eur += c;
      const b = cost.byType[tl.typeId] || (cost.byType[tl.typeId] = { n: 0, eur: 0 });
      b.n++; b.eur += c;
      if (tl.lastMachine) { const bm = cost.byMachine[tl.lastMachine] || (cost.byMachine[tl.lastMachine] = { n: 0, eur: 0 }); bm.n++; bm.eur += c; }
    }

    // Bedarf je Werkzeugtyp in den nächsten 4 h (geplant + voraussichtlich)
    const h4 = now + 4 * 3600, demand = {};
    for (const mx of machines) {
      // Wenden an der Maschine braucht nichts aus der Werkzeugausgabe – nur Tausch (letzte Schneide, andere Werkzeuge) zählt
      for (const g of mx.groups) if (g.t != null && g.t <= h4) for (const tx of g.tools) if (!willIndex(tx)) demand[tx.typeId] = (demand[tx.typeId] || 0) + 1;
      for (const p of mx.proj) if (p.t != null && p.t <= h4) for (const mb of p.members) if (!mb.index) demand[mb.s.tx.typeId] = (demand[mb.s.tx.typeId] || 0) + 1;
    }

    // Aufträge an die Werkzeugausgabe (Werkzeugwechsel-Aufgaben)
    const queue = [];
    for (const tid in s.tasks) {
      const tk = s.tasks[tid];
      if (tk.type !== 'toolChange') continue;
      queue.push(queueItem(tk, machines, s, now));
    }
    queue.sort((a, b) => b.stage - a.stage || (a.etaT || 1e12) - (b.etaT || 1e12));
    let issuedToday = 0;
    // Ausgabe = neue Werkzeuge/Platten aus der Werkzeugausgabe; gewendete Platten (Schneide > 1) bleiben an der Maschine
    for (const id in s.tools) { const tl = s.tools[id]; if (tl.mountedT >= ds && tl.mountedT > (s.startT || 0) + 1 && !((tl.edge || 1) > 1)) issuedToday++; }
    const presetter = queue.find(q => q.preset) || null;
    let regrindAll = 0, usedAll = 0, readyAll = 0;
    for (const id in s.toolStock) { regrindAll += s.toolStock[id].regrind || 0; usedAll += s.toolStock[id].usedStock || 0; readyAll += s.toolStock[id].ready || 0; }

    return { t: now, ds, machines, tools, inUse, evToday, ev24, waitAhead, crib: { issuedToday, presetter, regrindAll, usedAll, readyAll }, waitSec, waitMachines, tcSec, stops, avgDur: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
      plan2, plan2Tools, proj2, cost, demand, queue, changesToday: s.today ? s.today.toolChanges : 0, goodToday: s.today ? s.today.good : 0,
      idxToday: s.today && s.today.edgeIndexes != null ? s.today.edgeIndexes : evToday.reduce((n, e) => n + ((e.data && e.data.tools) || []).filter(x => x.action === 'index').length, 0) };
  }

  /** Liegt t in der Arbeitszeit (Schicht ohne Pausen)? Nur dann ist eine Einrichter:in für den Wechsel da. */
  function inWork(t) {
    const base = Math.floor(t / WEEK) * WEEK;
    for (const w of workWins()) if (base + w[0] <= t && t < base + w[1]) return true;
    return false;
  }
  function nextWorkStart(t) {
    let base = Math.floor(t / WEEK) * WEEK;
    for (let g = 0; g < 3; g++) { for (const w of workWins()) { const a = base + w[0], b = base + w[1]; if (b > t) return Math.max(a, t); } base += WEEK; }
    return t;
  }
  const leadSec = () => (policy().fetchMin || 3) * 60 + 150;
  /** Wechsel-Teilegrenze unter Berücksichtigung der Arbeitszeit (wie die Engine): angesteuert wird kT; liegt sie außerhalb der
      Schicht/in der Pause, wird erst ab Arbeitsbeginn + Vorlauf gewechselt – reicht die Standzeit nicht so lange (kStop),
      steht die Maschine ab bt(kStop) („Wartet auf Werkzeug“). */
  function staffAdjust(bt, kT, kStop) {
    const t = bt(kT);
    if (t == null) return { k: kT, t: null, waitFrom: null };
    if (inWork(t)) return { k: kT, t, waitFrom: null };
    const ws = nextWorkStart(t) + leadSec();
    const tStop = bt(kStop);
    if (tStop != null && tStop + 1 < ws) return { k: kStop, t: ws, waitFrom: tStop, staffT: nextWorkStart(t) };
    let k = kT, g = 0;
    while (k < kStop && bt(k) < ws && g++ < 5000) k++;
    return { k, t: bt(k), waitFrom: null, staffT: nextWorkStart(t) };
  }
  /** Wechselzeit einer Gruppe wie in der Engine: längste Einzeldauer + 35 % der übrigen */
  function groupChangeSec(kinds) {
    // kinds: Werkzeugart oder { kind, index } (Wenden ist deutlich kürzer)
    const d = kinds.map(k => (typeof k === 'object' ? changeSecOf(k.kind, k.index) : changeSecKind(k))).sort((x, y) => y - x);
    return d.length ? d[0] + 0.35 * d.slice(1).reduce((n, x) => n + x, 0) : 0;
  }
  /** Voraussichtliche Wechsel einer Maschine (wo die Engine noch nichts geplant hat), als Ereignisfolge über die
      Teilegrenzen – gleiche Regeln wie die Engine: angesteuert wird die letzte Teilegrenze vor dem Stopp (1 Teil Reserve
      bei Wechselgrenze ≥ 1), kein Wechsel, wenn die Schneide bis AG-Ende reicht, gewechselt nur in der Arbeitszeit
      (sonst Stillstand), Werkzeuge im Wechselfenster und „fast fällige“ (≤ bundleSec, ≤ bundleFrac Rest, Rest billiger als
      ein zweiter Stopp) kommen mit. Feste Ereignisse: laufender Wechsel und der Plan der Engine (plannedChange). */
  function projectMachine(mx, now) {
    const mv = mx.mv, out = [];
    for (const tx of mx.tools) tx.proj = [];
    const cyc = mx.cyc;
    if (cyc == null || !mv.order) return out;
    const auto = mv.loading === 'auto';
    const horizon = now + 6 * 3600;
    const cf = CFG(), bundleSec = cf.bundleSec != null ? cf.bundleSec : 1800, bundleFrac = cf.bundleFrac != null ? cf.bundleFrac : 0.35;
    const H = (mx.tools.find(t => t.planHorizonParts != null) || {}).planHorizonParts || PLAN_AT();
    const ref = mx.tools.find(t => t.neededParts != null);
    const left = ref ? ref.neededParts - mx.run : 0;          // nach dem laufenden Teil noch zu fertigende Teile
    const st = mx.tools.filter(tx => tx.cutMinPerPart > 0 && tx.life && !['idle', 'missing', 'keep', 'replace', 'setup'].includes(tx.status)).map(tx => ({
      tx, cut: tx.cutMinPerPart, life: tx.life, perLife: Math.floor(tx.life / tx.cutMinPerPart + 1e-9), atNew: changeLimit(tx.life, tx.cutMinPerPart),
      endK: tx.broken || tx.status === 'due' ? 0 : tx.remainingPartsAfterPart, at: tx.changeAtParts != null ? tx.changeAtParts : changeLimit(tx.life, tx.cutMinPerPart),
      gen: 0, skip: !!(tx.broken || tx.status === 'due'), cost: (TT(tx.typeId) || {}).cost || 0, fixedK: null,
      // Wendeplatte: Schneide e von E – solange eine freie Schneide da ist, wird an der Maschine gewendet
      ins: tx.kind === 'insert' && (tx.edges || 1) > 1, edge: tx.edge || 1, edges: tx.edges || 1, broken: !!tx.broken }));
    const canIdx = (o) => o.ins && !o.broken && o.edges > o.edge;
    const stopEurOf = (o) => (mv.rate || 0) * changeSecOf(o.tx.kind, canIdx(o)) / 3600;
    const nextEdge = (o, index) => { if (index) o.edge++; else o.edge = 1; o.broken = false; };
    if (!st.length) return out;
    // feste Ereignisse: laufender Wechsel, Plan der Engine
    const fixed = [];
    if (mx.changing) fixed.push({ k: 0, t: mx.changing.t0, resume: Math.max(now, mx.changing.t1), types: mx.changing.list.map(x => x.type), idx: mx.changing.list.filter(x => x.action === 'index').map(x => x.type) });
    for (const g of mx.groups) if (g.t != null) fixed.push({ k: g.afterPart - mx.processed, t: g.t, resume: g.t + groupChangeSec(g.tools.map(x => ({ kind: x.kind, index: willIndex(x) }))), types: g.tools.map(x => x.typeId), idx: g.tools.filter(willIndex).map(x => x.typeId) });
    fixed.sort((x, y) => x.k - y.k || x.t - y.t);
    const refix = () => { for (const o of st) { const f = fixed.find(ff => ff.types.includes(o.tx.typeId)); o.fixedK = f ? f.k : null; } };
    refix();
    let kB = 0, tB = mx.b0;                                    // Uhr: Teilegrenze kB liegt bei tB
    const clock = (k) => (tB == null ? null : k <= kB ? tB : auto ? tB + (k - kB) * cyc : addWork(tB, (k - kB) * cyc));
    let guard = 0;
    while (guard++ < 60) {
      let cand = null;
      for (const o of st) {
        if (o.fixedK != null || o.skip || o.endK >= left) continue;
        const kT = Math.max(kB, o.endK - Math.min(1, o.at));
        if (!cand || kT < cand.kT) cand = { o, kT };
      }
      const nf = fixed[0];
      if (nf && (!cand || nf.k <= cand.kT)) {
        fixed.shift();
        for (const o of st) if (nf.types.includes(o.tx.typeId)) { o.endK = nf.k + o.perLife; o.at = o.atNew; o.gen++; nextEdge(o, (nf.idx || []).includes(o.tx.typeId)); }
        refix();
        kB = nf.k; tB = nf.resume;
        if (tB > horizon) break;
        continue;
      }
      if (!cand) break;
      const lead = cand.o;
      const r = staffAdjust(clock, cand.kT, Math.max(cand.kT, lead.endK));
      if (r.t == null) {
        out.push({ kind: lead.gen ? 'next' : 'proj', k: cand.kT, afterPart: mx.processed + cand.kT, t: null, waitFromT: null, members: [{ s: lead, bundled: false, gen: lead.gen }], lead: lead.tx, inParts: Math.max(1, lead.tx.remainingPartsAfterPart - H), key: mx.id + ':p:' + lead.tx.typeId + ':' + (mx.processed + cand.kT) });
        break;
      }
      const k = r.k;
      const members = [{ s: lead, bundled: false, gen: lead.gen }];
      for (const o of st) {
        if (o === lead || o.fixedK != null || o.skip || o.endK >= left) continue;
        const remAt = Math.max(0, o.endK - k);
        if (remAt <= o.at) { members.push({ s: o, bundled: false, gen: o.gen }); continue; }   // eigenes Wechselfenster offen
        const waste = o.cost / (o.ins ? o.edges : 1) * Math.min(1, remAt * o.cut / o.life);   // Wendeplatte: nur der Rest dieser Schneide
        if ((remAt - o.at) * cyc <= bundleSec && remAt * o.cut <= bundleFrac * o.life && waste <= stopEurOf(o)) members.push({ s: o, bundled: true, gen: o.gen });
      }
      for (const mb of members) { mb.index = canIdx(mb.s); mb.edge = mb.s.edge; mb.edges = mb.s.edges; }
      const ev = { kind: lead.gen ? 'next' : 'proj', k, afterPart: mx.processed + k, t: r.t, waitFromT: r.waitFrom, staffT: r.staffT || null, members, lead: lead.tx,
        index: members.every(mb => mb.index), inParts: Math.max(1, lead.tx.remainingPartsAfterPart - H), key: mx.id + ':p:' + lead.tx.typeId + ':' + (mx.processed + k) };
      if ((r.waitFrom != null ? r.waitFrom : r.t) > horizon) break;
      out.push(ev);
      for (const mb of members) { mb.s.endK = k + mb.s.perLife; mb.s.at = mb.s.atNew; mb.s.gen++; nextEdge(mb.s, mb.index); }
      kB = k; tB = r.t + groupChangeSec(members.map(mb => ({ kind: mb.s.tx.kind, index: mb.index })));
      if (tB > horizon) break;
    }
    // je Werkzeug: die Ereignisse, an denen es beteiligt ist
    for (const ev of out) for (const mb of ev.members) {
      const leadCode = codeOf(ev.lead.typeId, ev.lead.name);
      mb.s.tx.proj.push({ kind: mb.gen > 0 ? 'next' : 'proj', k: ev.k, afterPart: ev.afterPart, t: ev.t, waitFromT: ev.waitFromT, staffT: ev.staffT,
        inParts: ev.inParts, bundled: mb.bundled, withLead: mb.s.tx === ev.lead ? null : leadCode, key: ev.key, index: !!mb.index, edge: mb.edge, edges: mb.edges });
    }
    // absehbarer Stillstand: frühester Stopp (Engine-Plan oder Projektion)
    let W = null, C = null, wTool = null;
    for (const g of mx.groups) if (g.waitFromT != null && (W == null || g.waitFromT < W)) { W = g.waitFromT; C = g.t; wTool = g.tools[0]; }
    for (const ev of out) if (ev.waitFromT != null && (W == null || ev.waitFromT < W)) { W = ev.waitFromT; C = ev.t; wTool = ev.lead; }
    mx.stopAt = W != null ? { from: W, to: C, tool: wTool } : null;
    return out;
  }

  function queueItem(tk, machines, s, now) {
    const mx = machines.find(m => m.id === tk.machineId);
    const p = tk.assignee ? s.people[tk.assignee] : null;
    const step = tk.steps[tk.si] || {};
    let stage = 0, detail = '';
    const fetched = !!(tk.data && tk.data.fetched);
    const index = !!(tk.data && tk.data.index);   // Schneide wenden: kein Gang zur Werkzeugausgabe (zwei Schritte)
    let predicted = null;
    if (index) {
      const g0 = mx ? (mx.groups.find(x => !x.later) || mx.groups[0]) : null;
      const when = g0 && g0.afterPart != null ? afterTxt(g0.afterPart) : 'an der Teilegrenze';
      if (tk.status === 'assigned' && p) { stage = 1; detail = p.activity || step.label || ''; if (step.k === 'work' && p.workRem > 0) detail += ` · noch ca. ${U.fmtDur(p.workRem)}`; }
      else {
        stage = 0;
        predicted = idxName(tk.machineId, g0 && g0.tools[0] ? g0.tools[0].plannedChange : null, mx);
        detail = tk.held && tk.holdWhy ? tk.holdWhy : tk.lateWhy ? tk.lateWhy : `${predicted ? 'wendet' : 'Bediener:in wendet'} ${when} an der Maschine · ${idxDur()}`;
      }
    } else if (tk.status !== 'assigned' || !p) {
      stage = fetched ? 2 : 0;
      if (tk.held && tk.holdWhy) detail = tk.holdWhy;
      else if (tk.held && typeof tk.holdUntil === 'number') detail = `Wird ca. ${tclock(tk.holdUntil, now)} vergeben – rechtzeitig vor der Wechsel-Teilegrenze`;
      else if (tk.lateWhy) detail = tk.lateWhy;
      else detail = fetched ? 'Vermessenes Werkzeug liegt an der Maschine bereit' : 'Nächste freie Person mit Werkzeugwechsel-Qualifikation übernimmt';
    } else {
      if (step.k === 'walk' && step.to === 'CRIB') stage = 1;
      else if (step.k === 'work' && step.act === 'fetch') stage = 1;
      else if (step.k === 'walk') stage = 2;
      else if (step.k === 'wait') stage = 3;
      else if (step.k === 'work' && step.act === 'tc') stage = 4;
      detail = p.activity || step.label || '';
      if (step.k === 'work' && p.workRem > 0) detail += ` · noch ca. ${U.fmtDur(p.workRem)}`;
    }
    const preset = step.k === 'work' && step.act === 'fetch' && /Voreinstell/.test(step.label || '');
    let toolsTxt = [], etaT = null, afterPart = null;
    if (mx) {
      const g = mx.groups.find(x => !x.later) || mx.groups[0];
      if (mx.changing) toolsTxt = mx.changing.list.map(x => (TT(x.type) || {}).name || x.type);
      else if (g) { toolsTxt = g.tools.map(t => t.name); etaT = g.t; afterPart = g.afterPart; }
      else if (mx.mv.manualToolChange) toolsTxt = mx.mv.manualToolChange.names;
    }
    const nt = (s.notifications || []).find(n => n.key === 'tool:' + tk.machineId && n.status !== 'resolved');
    let edgeTxt = null;
    if (index && mx && !mx.changing) { const g = mx.groups.find(x => !x.later) || mx.groups[0]; const eg = g && g.tools.length === 1 ? edgeOf(g.tools[0]) : null; if (eg && !eg.last) edgeTxt = `Schneide ${eg.no} → ${eg.no + 1}/${eg.of}`; }
    return { id: tk.id, machineId: tk.machineId, short: stShort(tk.machineId), person: p ? shortName(p.name) : null, personId: p ? p.id : null, predicted,
      stage, detail, preset, index, urgent: tk.prio >= 90, tools: toolsTxt, edgeTxt, etaT, afterPart, orderId: tk.orderId,
      notif: nt ? { t: nt.t, sev: nt.sev, role: nt.role, ack: nt.status === 'ack', ackBy: nt.ackBy || null } : null };
  }

  /** dringlichstes Werkzeug (Beispiel der Erklärkarte) */
  function urgentTool(model) {
    const c = model.tools.filter(t => t.id && ['broken', 'due', 'changing', 'planned', 'ok'].includes(t.status) && (t.status !== 'ok' || t.need));
    c.sort((a, b) => cmp(a.urg, b.urg));
    return c[0] || model.tools.find(t => t.status !== 'idle') || null;
  }
  function cmp(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

  // ------------------------------------------------------------------ CSS (Präfix .tl-)
  WF.ui.css(`
  .tl-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .tl-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 18px;flex-wrap:wrap;margin-bottom:0}
  .tl-head-r{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .tl-next{--c:var(--st-tool);display:flex;align-items:center;gap:14px;min-width:0;width:460px;max-width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:10px 14px 10px 14px;color:inherit;cursor:pointer;box-shadow:inset 3px 0 0 var(--c)}
  .tl-next:hover{border-color:var(--line2)}
  .tl-next .tl-nx-t{display:flex;flex-direction:column;align-items:flex-start;gap:3px;font:600 var(--fs-2xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;color:var(--text);flex:none;min-width:58px}
  .tl-next .tl-nx-t small{font:500 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .tl-next.proj{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--c) 45%,transparent);border-style:dashed;border-color:color-mix(in srgb,var(--c) 30%,var(--line))}
  .tl-next .tl-nx-b{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;padding-left:14px;border-left:1px solid var(--line)}
  .tl-next .eyebrow{font-size:var(--fs-2xs);color:color-mix(in srgb,var(--c) 70%,var(--muted));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-next .tl-nx-b > b{font-weight:600;font-size:var(--fs-md);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-next .tl-nx-b > small{font-size:var(--fs-xs);line-height:1.35;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-next .tl-nx-b > small.tl-nx-o{color:var(--faint)}
  .tl-next small.tl-nx-o b{font-size:inherit;font-weight:600;color:var(--text2)}

  .tl-kpis{display:grid;gap:10px;grid-template-columns:repeat(5,minmax(0,1fr))}
  .tl-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .tl-kpis .kpi .viz{height:32px;display:flex;align-items:flex-end}
  .tl-kpis .kpi .viz:empty{display:none}
  .tl-kpis .kpi .viz svg{display:block;max-width:100%;overflow:visible}
  .tl-kstack{display:flex;gap:2px;height:6px;width:100%;border-radius:3px;overflow:hidden;margin-bottom:3px}
  .tl-k3{position:relative;height:22px;flex:1;min-width:0;margin-right:34px}
  .tl-k3 .ln{position:absolute;left:0;right:0;top:12px;height:2px;border-radius:1px;background:var(--line2)}
  .tl-k3 .nw{position:absolute;left:0;top:6px;width:2px;height:14px;border-radius:1px;background:var(--accent)}
  .tl-k3 .mk{position:absolute;top:9px;width:8px;height:8px;margin-left:-4px;border-radius:2px;background:var(--st-tool)}
  .tl-k3 .mk.p{background:var(--card);border:1.3px dashed var(--st-tool)}
  .tl-k3 .mk.w{background:var(--st-wait)}
  .tl-k3 .e{position:absolute;right:-34px;top:5px;font-size:var(--fs-2xs);color:var(--faint)}
  .tl-kstack i{display:block;height:100%;background:var(--c)}
  .tl-kpis .tl-sm{display:none}
  .tl-kpis .kpi.click{cursor:pointer}
  .tl-kpis .kpi.click:hover{border-color:var(--line2)}

  .tl-top{display:grid;grid-template-columns:minmax(0,1fr) 384px;gap:14px;align-items:stretch}
  .tl-card-h{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--line);justify-content:flex-start}
  .tl-card-h h3{display:flex;align-items:center;gap:8px}
  .tl-card-h h3 .ico{color:var(--muted)}
  .tl-card-h .tl-sub{font-size:var(--fs-xs);color:var(--muted)}
  .tl-card-h .spacer{flex:1}
  .tl-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--fs-xs);color:var(--muted)}
  .tl-legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .tl-lg-d{width:16px;height:10px;border-radius:3px;background:var(--st-tool);flex:none}
  .tl-lg-d.o{background:transparent;border:1.3px dashed var(--st-tool)}
  .tl-lg-t{width:3px;height:11px;border-radius:2px;background:var(--st-tool);opacity:.85;flex:none}
  .tl-lg-b{width:14px;height:5px;border-radius:3px;background:var(--c);flex:none}
  .tl-lg-w{width:14px;height:7px;border-radius:2px;flex:none;background:repeating-linear-gradient(135deg,var(--st-wait) 0 2px,transparent 2px 4px);border:1px solid color-mix(in srgb,var(--st-wait) 70%,transparent)}
  .tl-lg-h{width:14px;height:10px;border-radius:2px;flex:none;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--muted) 30%,transparent) 0 2px,transparent 2px 5px);border:1px solid var(--line)}

  .tl-plan-card{display:flex;flex-direction:column}
  .tl-plan{position:relative;padding:6px 4px 6px 12px;flex:1}
  .tl-pp .tl-pp-r{fill:var(--st-tool);stroke:var(--card);stroke-width:1.5}
  .tl-pp .tl-pp-t{font:700 var(--fs-2xs) var(--f-ui);fill:var(--bg);letter-spacing:.01em}
  .tl-pp .tl-pp-s{stroke:var(--st-tool);stroke-width:1.2;opacity:.55}
  .tl-pp.later .tl-pp-r{fill:color-mix(in srgb,var(--st-tool) 42%,var(--card))}
  .tl-pp.later .tl-pp-t{fill:var(--text)}
  .tl-pp.proj .tl-pp-r{fill:var(--card);stroke:color-mix(in srgb,var(--st-tool) 80%,transparent);stroke-width:1.3;stroke-dasharray:3 2}
  .tl-pp.proj .tl-pp-t{fill:color-mix(in srgb,var(--st-tool) 80%,var(--text))}
  .tl-pp.proj .tl-pp-s{stroke-dasharray:2 2;opacity:.45}
  .tl-pp.wait .tl-pp-r{fill:var(--st-wait)}
  .tl-pp.projwait .tl-pp-r{fill:var(--card);stroke:var(--st-wait);stroke-width:1.3;stroke-dasharray:3 2}
  .tl-pp.projwait .tl-pp-t{fill:var(--st-wait)}
  .tl-pp.projwait .tl-pp-s{stroke:var(--st-wait);stroke-dasharray:2 2}
  .tl-pp.wait .tl-pp-s{stroke:var(--st-wait)}
  .tl-mk:hover .tl-pp-r{stroke:var(--text)}
  .tl-plan-fx{flex-basis:100%;color:var(--faint)}
  .tl-plan svg{display:block;width:100%;overflow:visible}
  .tl-plan .tl-rl{cursor:pointer}
  .tl-plan .tl-rl:hover .tl-rn{fill:var(--accent)}
  .tl-plan [data-k]{cursor:pointer}
  .tl-plan .tl-mk:hover{filter:brightness(1.25)}
  .tl-rn{font:600 var(--fs-sm) var(--f-ui);fill:var(--text)}
  .tl-rs{font:500 var(--fs-2xs) var(--f-ui);fill:var(--muted)}
  .tl-ax{font:500 var(--fs-2xs) var(--f-ui);fill:var(--faint);font-variant-numeric:tabular-nums}
  .tl-ax.b{fill:var(--muted);font-weight:600}
  .tl-ml{font:600 var(--fs-2xs) var(--f-ui);fill:var(--text2)}
  .tl-ml.p{fill:var(--muted);font-weight:500}
  .tl-ml.w{fill:var(--st-wait)}
  .tl-now-l{font:700 var(--fs-2xs) var(--f-ui);fill:var(--accent-ink);letter-spacing:.04em}
  .tl-cap{font:600 var(--fs-2xs) var(--f-ui);letter-spacing:.12em;fill:var(--faint);text-transform:uppercase}
  @keyframes tlPulse{0%,100%{opacity:1}50%{opacity:.35}}
  .tl-pulse{animation:tlPulse 1.4s ease-in-out infinite}
  .tl-tip{position:absolute;z-index:5;pointer-events:none;min-width:200px;max-width:300px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;box-shadow:var(--shadow);padding:9px 11px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);opacity:0;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease}
  .tl-tip.on{opacity:1;transform:none}
  .tl-tip .tt-h{display:flex;align-items:center;gap:7px;font-weight:600;color:var(--text);font-size:var(--fs-sm);margin-bottom:3px}
  .tl-tip .tt-h i{width:8px;height:8px;border-radius:2px;background:var(--c,var(--st-tool));flex:none}
  .tl-tip .tt-k{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--c,var(--muted));margin-bottom:5px}
  .tl-tip .tt-r{display:flex;gap:8px;justify-content:space-between}
  .tl-tip .tt-r span:first-child{color:var(--muted)}
  .tl-tip .tt-r b{font-weight:600;color:var(--text2);text-align:right}
  .tl-tip .tt-n{margin-top:5px;padding-top:5px;border-top:1px solid var(--line);color:var(--muted);font-size:var(--fs-xs)}
  .tl-plan-f{display:flex;flex-wrap:wrap;gap:4px 14px;padding:9px 14px 11px;border-top:1px solid var(--line);font-size:var(--fs-xs);color:var(--muted)}
  .tl-plan-f b{color:var(--text2);font-weight:600}

  /* Erklärkarte */
  .tl-ex{display:flex;flex-direction:column;min-width:0;background:linear-gradient(180deg,color-mix(in srgb,var(--st-tool) 7%,var(--card)) 0%,var(--card) 48%);border-color:color-mix(in srgb,var(--st-tool) 26%,var(--line))}
  .tl-ex-h{display:flex;align-items:flex-start;gap:11px;padding:13px 14px 10px}
  .tl-ex-ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;color:var(--st-tool);background:color-mix(in srgb,var(--st-tool) 14%,transparent);border:1px solid color-mix(in srgb,var(--st-tool) 34%,transparent)}
  .tl-ex-h h3{margin:0;font:600 var(--fs-lg)/1.25 var(--f-ui);letter-spacing:.005em}
  .tl-ex-h p{margin:3px 0 0;font-size:var(--fs-sm);color:var(--muted);line-height:1.4}
  .tl-ex-pick{display:flex;align-items:center;gap:8px;padding:0 14px 10px}
  .tl-ex-pick label{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);flex:none}
  .tl-ex-pick select{flex:1;min-width:0;height:30px;padding:0 8px;font-size:var(--fs-sm);border-radius:7px}
  .tl-ex-b{padding:0 14px 14px;display:flex;flex-direction:column;gap:12px;flex:1}
  .tl-ex-f{font-size:var(--fs-xs);color:var(--faint);line-height:1.45;border-top:1px solid var(--line);padding:9px 14px 12px}
  .tl-ex-tool{background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:10px 11px;display:flex;flex-direction:column;gap:8px;cursor:pointer}
  .tl-ex-tool:hover{border-color:var(--line2)}
  .tl-ex-tn{display:flex;align-items:center;gap:8px;min-width:0}
  .tl-ex-tn b{font-weight:600;font-size:var(--fs-md);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .tl-ex-tn .mono{color:var(--muted);font-size:var(--fs-xs);flex:none}
  .tl-ex-tn .spacer{flex:1}
  .tl-ex-tn .tl-idx{margin-right:0}
  .tl-ex-name{font-weight:600;font-size:var(--fs-md);line-height:1.3;color:var(--text);margin-top:-2px}
  .tl-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
  .tl-step{--c:var(--line2);display:grid;grid-template-columns:22px minmax(0,1fr);gap:0 10px;position:relative;padding-bottom:9px}
  .tl-step:last-child{padding-bottom:0}
  .tl-step::before{content:"";position:absolute;left:10px;top:23px;bottom:1px;width:2px;border-radius:1px;background:var(--line)}
  .tl-step:last-child::before{display:none}
  .tl-step.done::before{background:color-mix(in srgb,var(--st-run) 45%,var(--line))}
  .tl-sn{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:700 var(--fs-xs)/1 var(--f-ui);color:var(--muted);background:var(--bg2);border:1.5px solid var(--line2);position:relative;z-index:1}
  .tl-step.done .tl-sn{color:var(--st-run);border-color:color-mix(in srgb,var(--st-run) 60%,transparent);background:color-mix(in srgb,var(--st-run) 12%,var(--bg2))}
  .tl-step.now .tl-sn{color:var(--text);border-color:var(--c);background:color-mix(in srgb,var(--c) 25%,var(--bg2));box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 16%,transparent)}
  .tl-st-t{font-weight:600;font-size:var(--fs-sm);line-height:1.3;color:var(--text);padding-top:3px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .tl-st-t small{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:3px 6px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
  .tl-step:not(.now):not(.done) .tl-st-t{color:var(--text2)}
  .tl-st-d{font-size:var(--fs-xs);line-height:1.42;color:var(--muted);margin-top:1px;overflow-wrap:anywhere}
  .tl-step.skip{opacity:.5}
  .tl-st-d b{color:var(--text2);font-weight:600}
  .tl-step.now .tl-st-d{color:var(--text2)}

  /* Standzeit-Leiter */
  .tl-lad{display:flex;flex-direction:column;gap:5px;min-width:0}
  .tl-lad-bar{position:relative;display:flex;gap:2px;height:16px;align-items:stretch}
  .tl-lad-bar i{flex:1;min-width:2px;border-radius:2px;background:var(--track);border:1px solid var(--line)}
  .tl-lad-bar i.u{background:color-mix(in srgb,var(--c) 78%,var(--track));border-color:transparent}
  .tl-lad-bar i.p{background:color-mix(in srgb,var(--c) 38%,var(--track));border-color:transparent}
  .tl-lad-bar i.r{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 70%,transparent) 0 3px,color-mix(in srgb,var(--c) 25%,transparent) 3px 6px);border-color:color-mix(in srgb,var(--c) 60%,transparent)}
  .tl-lad-bar i.z{border-color:color-mix(in srgb,var(--st-tool) 55%,transparent);border-style:dashed}
  .tl-lad-bar i.l{border-color:var(--st-tool);border-style:solid;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--st-tool) 35%,transparent)}
  .tl-lad-bar i.w{flex:0 0 auto;background:repeating-linear-gradient(90deg,var(--line2) 0 1px,transparent 1px 3px);border:0;opacity:.8}
  .tl-lad-bar.cont{display:block;height:12px;border-radius:4px;background:var(--track);border:1px solid var(--line);overflow:hidden}
  .tl-lad-bar.cont > b{position:absolute;left:0;top:0;bottom:0;background:color-mix(in srgb,var(--c) 78%,var(--track))}
  .tl-lad-bar.cont > s{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 70%,transparent) 0 3px,transparent 3px 6px)}
  .tl-lad-bar.cont > u{position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--st-tool)}
  .tl-lad-ax{position:relative;height:13px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .tl-lad-ax span{position:absolute;top:1px;white-space:nowrap;transform:translateX(-50%)}
  .tl-lad-ax span.s{transform:none}
  .tl-lad-ax span.e{transform:translateX(-100%)}
  .tl-lad-ax span.t{color:var(--st-tool);font-weight:600}
  .tl-lad-ax span.n{color:var(--text2);font-weight:600}
  .tl-lad-k{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:var(--fs-xs);color:var(--muted)}
  .tl-lad-k span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .tl-lad-k i{width:10px;height:8px;border-radius:2px;flex:none;background:var(--track);border:1px solid var(--line)}
  .tl-lad-k i.u{background:color-mix(in srgb,var(--c) 78%,var(--track));border-color:transparent}
  .tl-lad-k i.p{background:color-mix(in srgb,var(--c) 38%,var(--track));border-color:transparent}
  .tl-lad-k i.r{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 70%,transparent) 0 2px,transparent 2px 4px);border-color:color-mix(in srgb,var(--c) 60%,transparent)}
  .tl-lad-k i.z{border:1px dashed color-mix(in srgb,var(--st-tool) 60%,transparent)}
  .tl-lad-k i.l{border:1px solid var(--st-tool)}

  /* Chips, Balken */
  .tl-chip{--c:var(--st-idle);display:inline-flex;align-items:center;gap:5px;font:600 var(--fs-2xs)/1.3 var(--f-ui);padding:2px 7px;border-radius:5px;color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);white-space:nowrap}
  .tl-chip.dot::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c)}
  .tl-chip.pulse::before{animation:tlPulse 1.4s ease-in-out infinite}
  .tl-wb{display:flex;align-items:center;gap:8px;min-width:0}
  .tl-wb-t{position:relative;flex:1;min-width:48px;height:7px;border-radius:4px;background:var(--track);overflow:visible}
  .tl-wb-t > i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--c)}
  .tl-wb-t > s{position:absolute;top:0;bottom:0;border-radius:0 4px 4px 0;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 75%,transparent) 0 2px,transparent 2px 4px)}
  .tl-wb-t > u{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text2);opacity:.55}
  .tl-wb > span{font:500 var(--fs-xs)/1 var(--f-mono);color:var(--text2);min-width:40px;text-align:right}

  /* Tabelle Werkzeuge in den Maschinen */
  .tl-filt{display:flex;flex-wrap:wrap;gap:6px}
  .tl-filt button{--c:var(--st-idle);display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap}
  .tl-filt button i{width:8px;height:8px;border-radius:50%;background:var(--c)}
  .tl-filt button b{font-variant-numeric:tabular-nums;color:var(--text)}
  .tl-filt button.zero{opacity:.45}
  .tl-filt button.on{border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 14%,var(--card))}
  .tl-filt button:hover{border-color:var(--line2)}
  .tl-tbcard{container:tltb / inline-size}
  .tl-stkcard{container:tlstk / inline-size}
  .tl-tb{--cols:36px minmax(0,2.55fr) minmax(0,1.5fr) minmax(0,1.15fr) minmax(118px,1.1fr) minmax(0,2.35fr) minmax(0,.8fr) minmax(0,.7fr);min-width:0}
  .tl-thr,.tl-tr{display:grid;grid-template-columns:var(--cols);gap:0 12px;align-items:center;padding:0 14px}
  .tl-thr{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:9px;padding-bottom:9px;border-bottom:1px solid var(--line)}
  .tl-thr .r,.tl-tr .r{text-align:right;justify-self:end}
  .tl-tr{--c:var(--st-idle);min-height:52px;padding-top:7px;padding-bottom:7px;border-bottom:1px solid var(--line);cursor:pointer;font-size:var(--fs-sm);position:relative}
  .tl-tr > *,.tl-sr > *,.tl-thr > *,.tl-sh > *{min-width:0}
  .tl-tr:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .tl-tr:focus-visible{outline-offset:-2px}
  .tl-tr.idle{opacity:.62;min-height:42px}
  .tl-tr.hot{background:color-mix(in srgb,var(--c) 6%,transparent)}
  .tl-tr.hot::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:0 2px 2px 0;background:var(--c)}
  .tl-slot{font:600 var(--fs-xs)/1 var(--f-mono);color:var(--muted)}
  .tl-tn{min-width:0}
  .tl-tn b{display:block;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-tn small{display:block;font-size:var(--fs-xs);color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-tn .tl-mid{display:none}
  .tl-rest{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
  .tl-rest b{display:block;font-weight:600;color:var(--text)}
  .tl-rest small{display:block;font-size:var(--fs-xs);color:var(--faint);margin-top:2px}
  .tl-pl{min-width:0;font-size:var(--fs-sm);line-height:1.35}
  .tl-pl > b{display:block;font-weight:500;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-pl .tl-pl-t{font-weight:700;color:color-mix(in srgb,var(--c) 72%,var(--text));font-variant-numeric:tabular-nums}
  .tl-pl .tl-ca{font-weight:500;color:var(--muted);margin-right:3px}
  .tl-pl .tl-pl-s{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;color:var(--muted);font-size:var(--fs-xs);margin-top:2px;overflow-wrap:anywhere}
  .tl-pl.proj .tl-pl-t{color:var(--text)}
  .tl-pl.warn .tl-pl-s{color:var(--st-wait)}
  .tl-pl.warn .tl-pl-t{color:var(--st-wait)}
  .tl-pl.none > b{color:var(--muted)}
  .tl-pl.stop > b{color:var(--st-wait);font-weight:600}
  .tl-pl.full{font-size:var(--fs-md)}
  .tl-pl.full > b{white-space:normal}
  .tl-pl.full .tl-pl-s{display:block;font-size:var(--fs-sm);margin-top:3px}
  .tl-mt{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;font-size:var(--fs-sm)}
  .tl-mt small{display:block;font-size:var(--fs-xs);color:var(--faint);margin-top:2px}
  .tl-pt{font:500 var(--fs-sm)/1 var(--f-mono);color:var(--text2);text-align:right}
  .tl-gh{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:10px 14px 8px;background:color-mix(in srgb,var(--bg2) 60%,var(--card));border-bottom:1px solid var(--line);cursor:pointer;min-width:0}
  .tl-gh:hover .tl-gh-n{color:var(--accent)}
  .tl-gh-n{font:600 var(--fs-lg)/1.2 var(--f-cond);letter-spacing:.01em;white-space:nowrap}
  .tl-gh .mono{color:var(--muted);font-size:var(--fs-xs)}
  .tl-gh .pill{font-size:var(--fs-xs);line-height:16px}
  .tl-gh-o{font-size:var(--fs-sm);color:var(--text2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
  .tl-gh-o em{font-style:normal;color:var(--muted)}
  .tl-gh-x{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .tl-gh-x b{color:var(--st-tool);font-weight:600}
  .tl-tbl-f{display:flex;flex-wrap:wrap;gap:4px 14px;padding:10px 14px 12px;font-size:var(--fs-xs);color:var(--faint)}

  /* Werkzeugausgabe */
  .tl-low{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:stretch}
  .tl-q{display:flex;flex-direction:column}
  .tl-crib{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.6fr);border-bottom:1px solid var(--line)}
  .tl-crib > div{padding:9px 14px;min-width:0;border-right:1px solid var(--line)}
  .tl-crib > div:last-child{border-right:0}
  .tl-crib .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-crib .v{font:600 var(--fs-xl)/1.25 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .tl-crib .v small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .tl-crib .ps{display:flex;align-items:center;gap:7px;font-size:var(--fs-sm);color:var(--text2);margin-top:3px;min-width:0}
  .tl-crib .ps i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 20%,transparent)}
  .tl-crib .ps span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tl-qi{--c:var(--st-tool);padding:11px 14px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:7px;cursor:pointer}
  .tl-qi:last-child{border-bottom:0}
  .tl-qi:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .tl-qi.urgent{--c:var(--st-wait);box-shadow:inset 3px 0 0 var(--st-wait)}
  .tl-qi-h{display:flex;align-items:baseline;gap:8px;min-width:0}
  .tl-qi-h b{font:600 var(--fs-lg)/1.2 var(--f-cond);white-space:nowrap}
  .tl-qi-h .mono{font-size:var(--fs-xs);color:var(--muted)}
  .tl-qi-h span.tl-qt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);color:var(--text2);flex:1}
  .tl-idx{display:inline-block;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.04em;padding:3px 6px;margin-right:7px;border-radius:5px;color:color-mix(in srgb,var(--st-setup) 85%,white);background:color-mix(in srgb,var(--st-setup) 14%,transparent);border:1px solid color-mix(in srgb,var(--st-setup) 32%,transparent);vertical-align:1px}
  .tl-qi-h em{font-style:normal;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .tl-pipe{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px}
  .tl-pipe i{height:5px;border-radius:3px;background:var(--track);border:1px solid var(--line)}
  .tl-pipe i.d{background:color-mix(in srgb,var(--c) 55%,var(--track));border-color:transparent}
  .tl-pipe i.n{background:var(--c);border-color:transparent;animation:tlPulse 1.6s ease-in-out infinite}
  .tl-pipe-l{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;font:500 var(--fs-2xs)/1.2 var(--f-ui);color:var(--faint)}
  .tl-pipe-l span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-pipe-l span.n{color:color-mix(in srgb,var(--c) 75%,var(--text));font-weight:600}
  .tl-qi-n{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:color-mix(in srgb,var(--c) 70%,var(--muted))}
  .tl-qi-n .ico{flex:none}
  .tl-qi-d{display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);color:var(--text2);min-width:0}
  .tl-qi-d .avatar{width:22px;height:22px;font-size:var(--fs-2xs)}
  .tl-qi-d .avatar.pred{background:transparent;border-style:dashed;color:var(--muted)}
  .tl-qi-h .tl-qe{color:var(--muted);font-variant-numeric:tabular-nums}
  .tl-qi-d span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tl-qi-d span.m{color:var(--muted)}
  .tl-stk{--cols:minmax(220px,2fr) 132px 84px minmax(200px,1.7fr) 74px 82px 88px 100px;min-width:0}
  .tl-sh,.tl-sr{display:grid;grid-template-columns:var(--cols);gap:0 10px;align-items:center;padding:0 14px}
  .tl-sh{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:9px;padding-bottom:9px;border-bottom:1px solid var(--line)}
  .tl-sh .r,.tl-sr .r{text-align:right}
  .tl-sr{min-height:42px;padding-top:5px;padding-bottom:5px;border-bottom:1px solid var(--line);font-size:var(--fs-sm);cursor:pointer}
  .tl-sr .tl-ass{font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-sr .tl-ass b{font-weight:600}
  .tl-sr:last-child{border-bottom:0}
  .tl-sr:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .tl-sr .tl-tn small{font-size:var(--fs-xs)}
  .tl-sr .num{font-variant-numeric:tabular-nums}
  .tl-sr .z{color:var(--faint)}
  .tl-dots{display:flex;align-items:center;gap:3px;flex-wrap:wrap}
  .tl-dots i{width:7px;height:7px;border-radius:2px;background:var(--track);border:1px solid var(--line2)}
  .tl-dots i.f{background:var(--st-run);border-color:transparent}
  .tl-dots.low i.f{background:var(--st-wait)}
  .tl-dots b{font:600 var(--fs-sm)/1 var(--f-ui);font-variant-numeric:tabular-nums;margin-left:4px;color:var(--text)}
  .tl-dem{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
  .tl-dem.warn{color:var(--st-wait)}
  .tl-dem.z{color:var(--faint);font-weight:400}
  .tl-cost{padding:12px 14px 14px;display:flex;flex-direction:column;gap:11px}
  .tl-cost-v{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .tl-cost-v b{font:600 var(--fs-kpi)/1 var(--f-cond);font-variant-numeric:tabular-nums}
  .tl-cost-v span{font-size:var(--fs-sm);color:var(--muted)}
  .tl-cost-bar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--track);gap:2px}
  .tl-cost-bar i{display:block;height:100%;background:var(--c);opacity:.85}
  .tl-cost-l{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:var(--fs-xs);color:var(--muted)}
  .tl-cost-l span{display:inline-flex;align-items:center;gap:6px}
  .tl-cost-l i{width:8px;height:8px;border-radius:2px;background:var(--c)}
  .tl-cost-l b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}
  .tl-cost-t{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:10px}
  .tl-cost-th{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .tl-cost-s{font-size:var(--fs-xs);color:var(--faint)}
  .tl-cost-s b{color:var(--text2);font-weight:600}
  .tl-cost-r{cursor:pointer;border-radius:5px}
  .tl-cost-r:hover span{color:var(--text)}
  .tl-cost-r{display:grid;grid-template-columns:minmax(0,1fr) 90px 52px;gap:10px;align-items:center;font-size:var(--fs-sm)}
  .tl-cost-r span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)}
  .tl-cost-r span small{font-size:var(--fs-2xs);color:var(--faint);margin-left:4px}
  .tl-cost-r b{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
  .tl-cost-r .bar{min-width:0}

  /* Karte mit Reitern: Wechselhistorie | Bestand */
  .tl-tabh{padding-top:0;padding-bottom:0;min-height:52px}
  .tl-tabsel{display:flex;align-items:stretch;gap:4px;align-self:stretch;min-width:0}
  .tl-tabsel button{display:inline-flex;align-items:center;gap:8px;padding:12px 6px 11px;margin-right:12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font:600 var(--fs-lg)/1.2 var(--f-ui);cursor:pointer;white-space:nowrap}
  .tl-tabsel button .ico{color:var(--faint)}
  .tl-tabsel button:hover{color:var(--text2)}
  .tl-tabsel button.on{color:var(--text);border-bottom-color:var(--accent)}
  .tl-tabsel button.on .ico{color:var(--accent)}
  .tl-tabn{font:600 var(--fs-xs)/1 var(--f-ui);font-variant-numeric:tabular-nums;color:var(--text2);background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:3px 7px}
  .tl-tabn:empty{display:none}
  .tl-tabn.warn{color:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 40%,var(--line))}
  .tl-tabsel .tl-ts{display:none}
  @container tlstk (max-width:620px){ .tl-tabsel .tl-tl{display:none} .tl-tabsel .tl-ts{display:inline} .tl-tabsel button{margin-right:6px} }
  .tl-tabsub{padding:9px 14px;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--line)}
  .tl-tabsub:empty{display:none}
  .tl-tabs .tl-card-h .seg{margin:8px 0;max-width:100%;overflow-x:auto;scrollbar-width:none}
  .tl-tabs .tl-card-h .seg::-webkit-scrollbar{display:none}
  /* Historie */
  .tl-hist{display:flex;flex-direction:column}
  .tl-he{display:grid;grid-template-columns:62px minmax(0,1fr);gap:0 12px;padding:10px 14px;border-bottom:1px solid var(--line)}
  .tl-he:last-child{border-bottom:0}
  .tl-hdiv{padding:7px 14px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);background:color-mix(in srgb,var(--bg2) 60%,var(--card));border-bottom:1px solid var(--line)}
  .tl-he-t{font:600 var(--fs-lg)/1.2 var(--f-cond);font-variant-numeric:tabular-nums;color:var(--text)}
  .tl-he-t small{display:block;font:500 var(--fs-2xs)/1.3 var(--f-ui);color:var(--faint);margin-top:2px}
  .tl-he-h{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;font-size:var(--fs-sm);min-width:0}
  .tl-he-h .link{font-weight:600;text-decoration:none;color:var(--text)}
  .tl-he-h .link:hover{color:var(--accent)}
  .tl-he-h span{color:var(--muted);font-size:var(--fs-sm)}
  .tl-he-h .tl-wait{color:var(--st-wait);font-weight:600}
  .tl-hx{display:grid;grid-template-columns:minmax(200px,1.2fr) 150px 170px minmax(0,1.4fr);gap:4px 12px;align-items:center;margin-top:7px;font-size:var(--fs-sm);cursor:pointer;border-radius:6px;padding:3px 6px;margin-left:-6px;margin-right:-6px}
  .tl-hx .tl-hw .tl-wb{min-width:0}
  .tl-hx:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .tl-hx > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tl-hx .tl-hn{color:var(--text2);font-weight:600}
  .tl-hx .tl-hd{color:var(--muted)}
  .tl-hx .tl-hd b{color:var(--text2);font-weight:600}
  .tl-more{display:flex;justify-content:center;padding:10px 14px 12px}

  .tl-empty{padding:22px 16px;text-align:center;color:var(--muted);font-size:var(--fs-sm);line-height:1.5}
  .tl-empty b{display:block;color:var(--text2);font-weight:600;margin-bottom:3px;font-size:var(--fs-md)}

  /* Detail-Drawer */
  .tl-d-hero{display:flex;flex-direction:column;gap:10px}
  .tl-d-top{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;align-items:start}
  .tl-d-kv{min-width:0}
  .tl-d-kv .v{font:600 var(--fs-kpi)/1.05 var(--f-cond);font-variant-numeric:tabular-nums;color:var(--text);white-space:nowrap}
  .tl-d-kv .v small{font:500 var(--fs-lg)/1 var(--f-cond);color:var(--muted);margin-left:3px}
  .tl-d-kv .l{font-size:var(--fs-xs);line-height:1.35;color:var(--muted);margin-top:3px}
  .tl-d-st{grid-column:1/-1;grid-row:1;justify-self:start}
  .tl-d-stat3{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .tl-d-grid .v.t{font-size:var(--fs-lg);line-height:1.5;white-space:normal;overflow:visible}
  .tl-used{display:flex;flex-direction:column;gap:5px}
  .tl-d-st .pill{font-size:var(--fs-sm);line-height:20px;padding:2px 10px 2px 8px}
  .tl-d-box{--c:var(--info);border-radius:9px;padding:10px 12px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 28%,transparent);font-size:var(--fs-sm);line-height:1.5;color:var(--text2);display:flex;flex-direction:column;gap:4px}
  .tl-d-box-h{display:flex;align-items:center;gap:7px;color:color-mix(in srgb,var(--c) 75%,var(--text));font-weight:600;font-size:var(--fs-sm)}
  .tl-d-box b{color:var(--text);font-weight:600}
  .tl-d-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .tl-d-grid > div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 9px;min-width:0}
  .tl-d-grid .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .tl-d-grid .v{font:600 var(--fs-xl)/1.3 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-d-grid .v small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:2px}
  .tl-d-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 13px;display:flex;flex-direction:column;gap:9px}
  .tl-life{display:flex;flex-direction:column}
  .tl-lf{--c:var(--st-tool);display:grid;grid-template-columns:44px 12px minmax(0,1fr);gap:0 8px;padding:5px 0;font-size:var(--fs-sm);line-height:1.45;position:relative}
  .tl-lf::before{content:"";position:absolute;left:49px;top:17px;bottom:-5px;width:2px;background:var(--line)}
  .tl-lf:last-child::before{display:none}
  .tl-lf .num{color:var(--muted);font-size:var(--fs-xs)}
  .tl-lf i{width:10px;height:10px;border-radius:50%;background:var(--card);border:2px solid var(--c);margin-top:3px;position:relative;z-index:1}
  .tl-lf span{color:var(--text2);overflow-wrap:anywhere}
  .tl-lf span b{color:var(--text);font-weight:600}
  .tl-inst{display:flex;flex-direction:column;gap:4px}
  .tl-inst button{display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:10px;align-items:center;background:transparent;border:0;color:inherit;text-align:left;padding:6px 6px;margin:0 -6px;border-radius:6px;cursor:pointer;font-size:var(--fs-sm)}
  .tl-inst button:hover{background:color-mix(in srgb,var(--raise) 45%,transparent)}
  .tl-inst button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  @container tlex (min-width: 620px){
    .tl-ex-b{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.3fr);gap:14px 18px;align-items:start}
  }
  .tl-ex{container:tlex / inline-size}

  @media (max-width:1320px){
    .tl-top{grid-template-columns:minmax(0,1fr)}
  }
  /* Werkzeugtabelle nach Kartenbreite (nicht Fensterbreite): breit 8 Spalten · mittel 6 · schmal zweizeilig */
  @container tltb (max-width:1150px){
    .tl-tb{--cols:40px minmax(200px,2fr) 150px 110px 146px minmax(180px,1.8fr)}
    .tl-tb .c-mt,.tl-tb .c-pt{display:none}
    .tl-tn .tl-mid{display:inline}
  }
  @container tltb (max-width:930px){
    .tl-thr{display:none}
    .tl-tr{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) auto;grid-template-areas:"n p st" "w p r";gap:6px 16px;padding:10px 14px}
    .tl-tr .c-slot{display:none}
    .tl-tr .c-n{grid-area:n} .tl-tr .c-st{grid-area:st;justify-self:end} .tl-tr .c-w{grid-area:w} .tl-tr .c-r{grid-area:r} .tl-tr .c-p{grid-area:p;align-self:center}
    .tl-rest b,.tl-rest small{display:inline;margin:0}
    .tl-rest small::before{content:" · "}
    .tl-tn .tl-mid{display:none}
  }
  @container tltb (max-width:600px){
    .tl-tr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n st" "w r" "p p";gap:7px 12px}
    .tl-tn small{white-space:normal}
    .tl-pl > b{white-space:normal}
  }
  @container tlstk (max-width:1090px){
    .tl-stk{--cols:minmax(200px,2fr) 132px 84px minmax(170px,1.6fr) 84px}
    .tl-stk .c-mo,.tl-stk .c-g,.tl-stk .c-ns{display:none}
  }
  @container tlstk (max-width:740px){
    .tl-sh{display:none}
    .tl-stk{--cols:minmax(0,1fr) 112px 44px}
    .tl-stk .c-g,.tl-stk .c-ns,.tl-stk .c-s,.tl-stk .c-mo,.tl-stk .c-a{display:none}
  }
  @container tlstk (max-width:760px){
    .tl-hx{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n c" "w w" "d d";gap:7px 10px;margin:8px 0 0;padding:9px 11px 10px;border-radius:8px;background:color-mix(in srgb,var(--bg2) 70%,transparent);border:1px solid var(--line)}
    .tl-hx > span{white-space:normal;overflow:visible}
    .tl-hx .tl-hn{grid-area:n;align-self:center;line-height:1.3} .tl-hx .tl-hc{grid-area:c;justify-self:end;align-self:start}
    .tl-hx .tl-hw{grid-area:w;min-width:140px} .tl-hx .tl-hd{grid-area:d;justify-self:start;line-height:1.4}
  }
  @media (max-width:1100px){
    .tl-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
    .tl-low{grid-template-columns:minmax(0,1fr)}
  }
  @media (max-width:560px){
    .tl-head-r{width:100%}
    .tl-next{width:100%;max-width:none;align-items:flex-start;gap:12px;padding:11px 12px 11px 14px}
    .tl-next .tl-nx-t{min-width:52px;padding-top:2px}
    .tl-next .tl-nx-b{padding-left:12px}
    .tl-next .eyebrow,.tl-next .tl-nx-b > b,.tl-next .tl-nx-b > small{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .tl-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .tl-kpis .kpi:first-child{grid-column:1/-1}
    .tl-kpis .kpi{min-height:0}
    .tl-kpis .kpi:not(:first-child) .viz{display:none}
    .tl-kpis .tl-sm{display:inline}
    .tl-kpis .tl-lg{display:none}
    .tl-legend{display:none}
    .tl-d-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .tl-he{grid-template-columns:minmax(0,1fr)}
    .tl-he-t{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
    .tl-he-t small{display:inline;margin:0}
    .tl-pipe-l{display:none}
    .tl-crib{grid-template-columns:repeat(3,minmax(0,1fr))}
    .tl-crib > div{padding:9px 10px 9px 14px}
    .tl-crib .l{white-space:normal;line-height:1.25}
    .tl-crib > div:last-child{grid-column:1/-1;border-top:1px solid var(--line)}
    .tl-qi-h{flex-wrap:wrap;row-gap:3px}
    .tl-qi-h em{margin-left:auto}
    .tl-qi-h span.tl-qt{order:5;flex:1 1 100%;white-space:normal}
    .tl-qi-d{align-items:flex-start}
    .tl-qi-d span{white-space:normal}
    .tl-qi-d span:not(.m):not(.avatar){flex:none}
    .tl-filt{flex-wrap:nowrap;overflow-x:auto;margin:0 -14px;padding:0 14px 2px;scrollbar-width:none}
    .tl-filt::-webkit-scrollbar{display:none}
    .tl-filt button.zero{display:none}
    .tl-gh-o{order:3;flex-basis:100%}
    .tl-gh-x{order:4;flex-basis:100%}
    .tl-tn b{white-space:normal}
    .tl-tn .tl-mid{display:none}
  }
  /* Touch: Bedienflächen ≥ 40 px, Auswahlfeld 16 px (UI_GUIDE Regel 17) */
  @media (pointer:coarse){
    .tl-filt button{height:auto;min-height:40px;padding:0 14px}
    .tl-ex-pick select{height:40px;font-size:16px}
    .tl-cost-r,.tl-inst button{min-height:40px}
    .tl-tabsel button{min-height:44px}
    .tl-hx{min-height:40px}
    .tl-root .seg button{min-height:40px}
    .tl-he-h .link{padding:8px 0;margin:-8px 0}
  }
  `, 'tl-css');

  // ------------------------------------------------------------------ Bausteine
  /** Verschleißbalken: Ist (Statusfarbe), nach laufendem Teil (schraffiert), Planungsschwelle (Strich) */
  function wearBar(t, color) {
    if (t.wearPct == null) return '<div class="tl-wb"><div class="tl-wb-t"></div><span>–</span></div>';
    const c = color || ST_C[t.status] || 'var(--st-idle)';
    const w = U.clamp(t.wearPct, 0, 100);
    const a = t.wearAfterPartPct != null ? U.clamp(t.wearAfterPartPct, w, 100) : w;
    const thr = t.planWearPct != null ? U.clamp(t.planWearPct, 0, 100) : null;
    return `<div class="tl-wb" style="--c:${c}" title="${esc(`Verschleiß ${pct(w, 1)}${a > w ? ' · nach dem laufenden Teil ' + pct(a, 1) : ''}${thr != null ? ' · Wechselgrenze ab ca. ' + pct(thr, 0) : ''}`)}"><div class="tl-wb-t"><i style="width:${w.toFixed(1)}%"></i>${a > w ? `<s style="left:${w.toFixed(1)}%;width:${(a - w).toFixed(1)}%"></s>` : ''}${thr != null ? `<u style="left:${thr.toFixed(1)}%"></u>` : ''}</div><span>${esc(U.fmtNum(w, 0))} %</span></div>`;
  }
  /** Standzeit-Leiter: ein Feld je Teil, das die Schneide schafft (genutzt · läuft · Planungsvorlauf · Wechselgrenze · Rest) */
  function ladder(t, opts = {}) {
    const c = ST_C[t.status] || 'var(--st-run)';
    const cut = t.cutMinPerPart, life = t.life, used = t.used != null ? t.used : (t.wearPct != null && life ? t.wearPct / 100 * life : 0);
    if (!(cut > 0) || !life) {
      const w = U.clamp(t.wearPct || 0, 0, 100);
      return `<div class="tl-lad" style="--c:${c}"><div class="tl-lad-bar cont"><b style="width:${w}%"></b></div>
        <div class="tl-lad-ax"><span class="s">0 %</span>${w > 8 && w < 80 ? `<span style="left:${w}%" class="n">${esc(U.fmtNum(w, 0))} %</span><span class="e" style="left:100%">100 %</span>` : `<span class="e n" style="left:100%">${esc(U.fmtNum(w, 0))} % von 100 %</span>`}</div></div>`;
    }
    const N = life / cut, n = Math.floor(N + 1e-9);
    const usedParts = Math.min(n, Math.floor(used / cut + 1e-6));
    const running = !!opts.running && usedParts < n && t.status !== 'changing' && (t.remainingParts || 0) > 0;
    const H = t.planHorizonParts != null ? t.planHorizonParts : PLAN_AT();
    const at = t.changeAtParts != null ? t.changeAtParts : changeLimit(life, cut);
    const wearPct = used / life * 100;
    const axis = [];
    if (n > 44) {
      // lange Standzeit (Sägeband, Schleifscheibe): durchgehender Balken mit Schwelle
      const w = U.clamp(wearPct, 0, 100), a = running ? U.clamp((used + cut) / life * 100, 0, 100) : w;
      const thr = t.planWearPct != null ? t.planWearPct : (life - (at + 1) * cut) / life * 100;
      return `<div class="tl-lad" style="--c:${c}"><div class="tl-lad-bar cont"><b style="width:${w.toFixed(2)}%"></b>${a > w ? `<s style="left:${w.toFixed(2)}%;width:${Math.max(0.6, a - w).toFixed(2)}%"></s>` : ''}<u style="left:${U.clamp(thr, 0, 100).toFixed(2)}%"></u></div>
        <div class="tl-lad-ax"><span class="s">0</span><span class="e" style="left:100%">${esc(U.fmtNum(n))} Teile je Schneide</span></div>
        <div class="tl-lad-k"><span><i class="u"></i>genutzt ${esc(U.fmtNum(w, 0))} % · ${esc(teile(usedParts))}</span>${running ? '<span><i class="r"></i>laufendes Teil</span>' : ''}<span><i class="l"></i>Wechselgrenze</span></div></div>`;
    }
    // Vorverschleiß: Standzeit, die schon vor dieser Schneiden-Zählung genutzt war (z. B. bei Schichtbeginn montiert)
    const preParts = t.parts != null ? U.clamp(usedParts - t.parts, 0, usedParts) : 0;
    let cells = '';
    for (let i = 0; i < n; i++) {
      let cl = '';
      if (i < preParts) cl = 'p';
      else if (i < usedParts) cl = 'u';
      else if (running && i === usedParts) cl = 'r';
      else if (i >= n - at) cl = 'l';
      else if (i >= n - Math.max(H, at)) cl = 'z';
      cells += `<i class="${cl}" title="Teil ${i + 1} mit dieser Schneide"></i>`;
    }
    const waste = N - n;
    if (waste > 0.04) cells += `<i class="w" style="width:${Math.max(3, waste / N * 100).toFixed(1)}%" title="Rest unter einem Teil – wird nicht genutzt"></i>`;
    const pos = (k) => (k / N * 100);
    axis.push(`<span class="s">0</span>`);
    const pNow = pos(usedParts + (running ? 0.5 : 0));
    if (usedParts > 0 && usedParts < n && pNow > 7 && pNow < 80) axis.push(`<span class="n" style="left:${pNow.toFixed(1)}%">${running ? 'Teil läuft' : 'jetzt'}</span>`);
    if (n - Math.max(H, at) > usedParts + 1 && pos(n - Math.max(H, at)) < 84) axis.push(`<span class="t" style="left:${pos(n - Math.max(H, at)).toFixed(1)}%">Planung</span>`);
    axis.push(`<span class="e" style="left:100%">${esc(U.fmtNum(n))} Teile</span>`);
    return `<div class="tl-lad" style="--c:${c}"><div class="tl-lad-bar">${cells}</div><div class="tl-lad-ax">${axis.join('')}</div>
      <div class="tl-lad-k">${preParts ? `<span><i class="p"></i>${t.mountedT != null && S() && t.mountedT <= (S().startT || 0) + 1 ? 'vor Schichtbeginn' : 'vorher'} genutzt</span>` : ''}<span><i class="u"></i>${preParts ? 'heute' : 'genutzt'}</span>${running ? '<span><i class="r"></i>laufendes Teil</span>' : ''}<span><i class="z"></i>Vorlauf (${esc(teile(Math.max(H, at)))})</span>${at > 0 ? `<span><i class="l"></i>Wechselgrenze (${esc(teile(at))})</span>` : ''}</div></div>`;
  }
  /** Nächster Wechsel eines Werkzeugs – zweizeilig: Zeile 1 die Uhrzeit zuerst („ca. 08:56 · nach Teil 227“), Zeile 2 was
      passiert und wer es tut. { cls, when (Uhrzeit-Text | null), part (Teilegrenze | null), main (Text ohne Uhrzeit), sub } */
  function planText(t, now) {
    const pc = t.plannedChange;
    const R0 = (cls, main, sub) => ({ cls, when: null, part: null, main, sub: sub || '' });
    const RT = (cls, tt, part, sub, main) => ({ cls, when: tt != null ? tclock(tt, now) : null, part, main: main || part || '–', sub: sub || '' });
    if (t.status === 'changing') {
      // Engine: „Schneide wird gerade gewendet (L. Wagner, noch ca. 7 s) – …“ → Aussage + „L. Wagner · noch ca. 7 s“
      const ex = String(t.explain || ''), m = /\(([^)]*)\)/.exec(ex);
      return R0('', /gewendet/.test(ex) ? 'Schneide wird gerade gewendet' : 'Wird gerade gewechselt', m ? m[1].replace(/,\s*/g, ' · ') : '');
    }
    if (t.status === 'broken') return R0('stop', 'Wechsel vor dem nächsten Teil', 'Werkzeugbruch – nach der Reparatur');
    const idx = !!pc && pc.action === 'index';
    if (t.status === 'due') {
      // Standzeit erschöpft: Uhrzeit des angekündigten Wechsels aus der Engine (plannedChange.etaT), nicht nur „angefordert“
      const act = pc ? (idx ? idxWhat(t) : 'Werkzeug tauschen') : '';
      const who = pc ? (idx ? idxWho(t.machineId, pc) : pc.by ? `${pc.by}${pc.stage && pc.stage !== 'offen' ? ' · ' + pc.stage : ''}` : pc.note || '') : '';
      const stop = pc && pc.waitFromT != null ? `Maschine steht seit ${tclock(pc.waitFromT, now)}` : 'Maschine wartet';
      if (pc && pc.etaT != null) return RT('stop', pc.etaT, 'Standzeit erschöpft', [stop, act, who].filter(Boolean).join(' · '));
      return R0('stop', 'Wechsel angefordert', ['Standzeit reicht nicht für das nächste Teil', act, who].filter(Boolean).join(' · '));
    }
    if (pc) {
      const eg = edgeOf(t);
      const later = pc.stage === 'später';
      const who = later ? (t.laterAfterT ? `eigener Stopp nach dem Wechsel ${tclock(t.laterAfterT, now)}` : 'eigener Stopp, nach dem nächsten Wechsel')
        : idx ? [idxWho(t.machineId, pc), pc.note || idxDur()].join(' · ')
        : pc.by ? `${pc.by}${pc.stage && pc.stage !== 'offen' ? ' · ' + pc.stage : ''}` : pc.note ? pc.note : pc.stage === 'Werkzeug liegt bereit' ? 'Werkzeug liegt bereit' : 'Einrichter:in wird rechtzeitig losgeschickt';
      const extra = pc.bundled ? (idx ? 'wird mitgewendet' : 'wird mitgewechselt') : pc.withTools && pc.withTools.length ? 'mit ' + pc.withTools.map(toolShort).join(', ') : '';
      const act = (pc.manual ? 'Vorbeugend: ' : '') + (idx ? idxWhat(t) : eg && eg.last ? 'Neue Platte (letzte Schneide)' : 'Werkzeug tauschen');
      const stop = pc.waiting && pc.waitFromT != null ? `Maschine steht seit ${tclock(pc.waitFromT, now)}` : pc.waitFromT != null ? `Stopp ab ${tclock(pc.waitFromT, now)}` : '';
      const sub = [stop, act, who, extra].filter(Boolean).join(' · ');
      if (pc.etaT == null) return R0(pc.waitFromT != null ? 'stop' : '', pc.text || afterTxt(pc.afterPart), sub);
      return RT(pc.waitFromT != null ? 'warn' : '', pc.etaT, afterTxt(pc.afterPart), sub);
    }
    if (t.status === 'keep') return R0('none', 'Bleibt beim Rüsten montiert', 'gleicher Typ im neuen Arbeitsgang');
    if (t.status === 'replace') return R0('none', 'Wird beim Rüsten ersetzt', 'neues, vermessenes Werkzeug');
    if (t.status === 'setup') return R0('none', 'Beim Rüsten eingesetzt', '');
    if (t.status === 'idle') return R0('none', 'Nicht im Arbeitsgang', 'bis zum nächsten Rüsten montiert');
    if (t.status === 'missing') return R0('none', 'Wird beim Rüsten bestückt', '');
    if (!t.need) return R0('none', 'Kein Wechsel nötig', `reicht bis AG-Ende (${teile(t.neededParts || 0)} offen)`);
    const p = t.proj && t.proj[0];
    if (t.announcedT) return p && p.t != null ? RT('proj', p.t, afterTxt(p.afterPart), `angekündigt ${tclock(t.announcedT, now)} – Termin wird nach dem laufenden Wechsel neu berechnet`)
      : R0('proj', 'angekündigt', `angekündigt ${tclock(t.announcedT, now)} – Termin wird nach dem laufenden Wechsel neu berechnet`);
    if (!p && t.afterStop) return RT('proj warn', t.afterStop.from, 'Maschine ruht', `wartet auf ${toolShort(t.afterStop.tool ? t.afterStop.tool.name : '')} – Wechsel frühestens ${tclock(t.afterStop.to, now)}`);
    if (p && p.waitFromT != null) return RT('proj warn', p.t, afterTxt(p.afterPart), `voraussichtlich · Stillstand ab ca. ${tclock(p.waitFromT, now)} – vorher niemand im Dienst`, `voraussichtlich ${afterTxt(p.afterPart)}`);
    if (p && p.withLead) return RT('proj', p.t, afterTxt(p.afterPart), 'voraussichtlich · ' + (p.bundled ? `mit ${p.withLead} mitgewechselt – ein Stopp statt zwei` : `zusammen mit ${p.withLead}`), `voraussichtlich ${afterTxt(p.afterPart)}`);
    if (p) return RT('proj', p.t, afterTxt(p.afterPart), ['voraussichtlich', p.index ? `Schneide wenden ${p.edge} → ${p.edge + 1}/${p.edges}` : '', `Planung in ca. ${teilen(p.inParts)}`].filter(Boolean).join(' · '), `voraussichtlich ${afterTxt(p.afterPart)}`);
    return R0('none', '–', '');
  }
  /** Einzeiler des nächsten Wechsels (Tooltips, Texte) */
  const plMain = (pl) => (pl.when ? `ca. ${pl.when}${pl.part ? ' · ' + pl.part : ''}` : pl.main);
  /** Zelle „Nächster Wechsel“: Uhrzeit zuerst und fett, darunter Aktion und Person (höchstens zwei Zeilen, umbrechend) */
  function plHtml(pl) {
    const top = pl.when ? `<span class="tl-ca">ca.</span><span class="tl-pl-t">${esc(pl.when)}</span>${pl.part ? ' · ' + esc(pl.part) : ''}` : esc(pl.main);
    return `<b>${top}</b>${pl.sub ? `<span class="tl-pl-s">${esc(pl.sub)}</span>` : ''}`;
  }

  // ------------------------------------------------------------------ Ansicht
  let root = null, R = {};
  const ui = { sort: 'urgent', showAll: false, filter: 'all', exPick: 'auto', stock: 'need', histCat: 'all', histN: 6, tab: 'hist', planW: 0, tipKey: null, tips: {} };
  const TOP_N = 8;

  function mount(r) {
    root = r;
    r.innerHTML = `<div class="tl-root">
      <div class="tl-head">
        <div><h1 class="view-t">Werkzeuge</h1>
          <p class="view-sub">Standzeiten, Wechselplan und Werkzeugausgabe live aus den Maschinen – jeder Wechsel folgt einer sichtbaren Regel und ist begründet.</p></div>
        <div class="tl-head-r"><button class="tl-next" data-r="next" type="button"></button></div>
      </div>
      <div class="tl-kpis" data-r="kpis">
        <div class="kpi click" data-go="table" title="werkfluss führt je laufendem Arbeitsgang die standzeitkritischen Werkzeuge (Wendeplatten, Bohrer, Fräser, Sägeband, Schleifscheibe) – nicht jedes Werkzeug im Magazin."><div class="l"><span class="tl-lg">Standzeit-überwacht</span><span class="tl-sm">Überwacht</span></div><div class="v" data-r="k1">–</div><div class="s" data-r="k1s">–</div><div class="viz" data-r="k1v"></div></div>
        <div class="kpi click" data-go="hist"><div class="l">Wechsel heute</div><div class="v" data-r="k2">–</div><div class="s" data-r="k2s">–</div><div class="viz" data-r="k2v"></div></div>
        <div class="kpi click" data-go="plan"><div class="l"><span class="tl-lg">Geplant · nächste 2 h</span><span class="tl-sm">Geplant · 2 h</span></div><div class="v" data-r="k3">–</div><div class="s" data-r="k3s">–</div><div class="viz" data-r="k3v"></div></div>
        <div class="kpi" data-r="k4box"><div class="l"><span class="tl-lg">Wartezeit auf Werkzeug</span><span class="tl-sm">Wartezeit</span></div><div class="v" data-r="k4">–</div><div class="s" data-r="k4s">–</div><div class="viz" data-r="k4v"></div></div>
        <div class="kpi click" data-go="crib"><div class="l"><span class="tl-lg">Werkzeugkosten heute</span><span class="tl-sm">Kosten heute</span></div><div class="v" data-r="k5">–</div><div class="s" data-r="k5s">–</div><div class="viz" data-r="k5v"></div></div>
      </div>
      <div class="tl-top">
        <section class="card tl-plan-card" data-r="planCard" aria-label="Wechselplan">
          <div class="card-h tl-card-h"><h3>${icon('clock', 16)}Wechselplan</h3><span class="tl-sub" data-r="planSub">Rückblick und die nächsten 4 Stunden je Maschine</span><span class="spacer"></span>
            <div class="tl-legend"><span><i class="tl-lg-d"></i>geplant</span><span><i class="tl-lg-d o"></i>voraussichtlich</span><span><i class="tl-lg-t"></i>gewechselt</span><span><i class="tl-lg-b" style="--c:var(--st-run)"></i>Fertigung</span><span><i class="tl-lg-b" style="--c:var(--st-setup)"></i>Rüsten</span><span><i class="tl-lg-w"></i>Stillstand</span><span><i class="tl-lg-h"></i>Pause · keine Schicht</span></div></div>
          <div class="tl-plan" data-r="plan"></div>
          <div class="tl-plan-f" data-r="planF"></div>
        </section>
        <section class="card tl-ex" data-r="ex" aria-label="So plant werkfluss Werkzeugwechsel">
          <div class="tl-ex-h"><span class="tl-ex-ic">${icon('info', 17)}</span><div><h3>So plant werkfluss Werkzeugwechsel</h3><p>Eine Regel für jedes Werkzeug – hier live an einem Beispiel.</p></div></div>
          <div class="tl-ex-pick"><label for="tl-expick">Beispiel</label><select class="input" id="tl-expick" data-r="exPick"></select></div>
          <div class="tl-ex-b" data-r="exBody"></div>
          <div class="tl-ex-f">Gilt für jedes Werkzeug. Getauscht wird nur, was vorher als „geplant“ angekündigt war – oder nach einem Werkzeugbruch.</div>
        </section>
      </div>
      <section class="card tl-tbcard" data-r="tableCard" aria-label="Standzeit-überwachte Werkzeuge">
        <div class="card-h tl-card-h"><h3>${icon('wrench', 16)}Standzeit-überwachte Werkzeuge</h3><span class="tl-sub" data-r="tableSub"></span><span class="spacer"></span>
          <div class="seg" role="group" aria-label="Sortierung"><button data-sort="urgent" class="on">Dringlichste zuerst</button><button data-sort="machine">Nach Maschine</button></div></div>
        <div class="tl-card-h" style="border-bottom:1px solid var(--line);padding-top:9px;padding-bottom:9px"><div class="tl-filt" data-r="filt"></div></div>
        <div class="tl-tb">
          <div class="tl-thr"><span class="c-slot">Platz</span><span>Werkzeug</span><span>Verschleiß</span><span class="r">Reststandzeit</span><span>Status</span><span>Nächster Wechsel</span><span class="r c-mt">Eingebaut</span><span class="r c-pt" title="Mit dieser Schneide gefertigte Teile">Gefertigt</span></div>
          <div data-r="rows"></div>
        </div>
        <div class="tl-more" data-r="rowsMore" hidden><button class="btn sm ghost" data-allrows></button></div>
        <div class="tl-tbl-f" data-r="tableF"></div>
      </section>
      <div class="tl-low">
        <section class="card" data-r="cribCard" aria-label="Werkzeugausgabe">
          <div class="card-h tl-card-h"><h3>${icon('box', 16)}Wechselaufträge &amp; Werkzeugausgabe</h3><span class="tl-sub" data-r="qSub"></span></div>
          <div class="tl-crib" data-r="crib"></div>
          <div class="tl-q" data-r="queue"></div>
        </section>
        <section class="card" aria-label="Werkzeugkosten heute">
          <div class="card-h tl-card-h"><h3>${icon('euro', 16)}Werkzeugkosten heute</h3><span class="tl-sub">verschrottete und nachgeschliffene Werkzeuge</span></div>
          <div class="tl-cost" data-r="cost"></div>
        </section>
      </div>
      <section class="card tl-stkcard tl-tabs" data-r="histCard" aria-label="Wechselhistorie und Bestand der Werkzeugausgabe">
        <div class="tl-card-h tl-tabh"><div class="tl-tabsel" role="tablist" data-r="tabSel">
            <button role="tab" data-tab="hist" class="on" aria-selected="true">${icon('list', 15)}<span class="tl-tl">Wechselhistorie</span><span class="tl-ts">Historie</span><span class="tl-tabn" data-r="tabNH"></span></button>
            <button role="tab" data-tab="stock" aria-selected="false">${icon('layers', 15)}<span class="tl-tl">Bestand Werkzeugausgabe</span><span class="tl-ts">Bestand</span><span class="tl-tabn" data-r="tabNS"></span></button></div>
          <span class="spacer"></span>
          <div class="seg" role="group" aria-label="Grund" data-r="histSeg"></div>
          <div class="seg" role="group" aria-label="Werkzeugtypen" data-r="stockSeg" hidden><button data-stock="need" class="on">Bedarf 4 h</button><button data-stock="use">Im Einsatz</button><button data-stock="all">Alle Typen</button></div></div>
        <div class="tl-tabsub" data-r="tabSub"></div>
        <div data-r="paneHist">
          <div class="tl-hist" data-r="hist"></div>
          <div class="tl-more" data-r="histMore" hidden><button class="btn sm ghost" data-more>Ältere Wechsel anzeigen</button></div>
        </div>
        <div data-r="paneStock" hidden>
          <div class="tl-stk"><div class="tl-sh"><span>Werkzeugtyp</span><span>Bereit</span><span class="r">Bedarf 4 h</span><span class="c-a">Einschätzung</span><span class="r c-mo">Montiert</span><span class="r c-g">Gebraucht</span><span class="r c-ns">Nachschliff</span><span class="r c-s">Schrott heute</span></div>
            <div data-r="stock"></div></div>
        </div>
      </section>
    </div>`;
    R = refs(r);
    R.tip = WF.ui.el('div', { class: 'tl-tip', role: 'tooltip' });
    R.plan.append(R.tip);
    R.planSvg = WF.ui.el('div', { class: 'tl-plan-svg' });
    R.plan.prepend(R.planSvg);

    // Interaktion
    r.addEventListener('click', onClick);
    r.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-sel]')) { e.preventDefault(); selectFrom(e.target); }
    });
    r.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { ui.sort = b.dataset.sort; ui.showAll = false; r.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b)); R.rows._map && R.rows._map.clear(); R.rows.innerHTML = ''; renderTable(getModel(), true); });
    r.querySelectorAll('[data-stock]').forEach(b => b.onclick = () => { ui.stock = b.dataset.stock; r.querySelectorAll('[data-stock]').forEach(x => x.classList.toggle('on', x === b)); renderStock(getModel(), true); });
    R.exPick.addEventListener('change', () => { ui.exPick = R.exPick.value || 'auto'; const t = (getModel() || { tools: [] }).tools.find(x => x.id === ui.exPick); ui.exSlot = t ? t.machineId + '|' + t.typeId : null; renderExplainer(getModel(), true); });
    R.plan.addEventListener('mousemove', onPlanMove);
    R.plan.addEventListener('mouseleave', () => hideTip());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((ents) => { const e = ents[0]; const w = Math.round(e && e.contentRect ? e.contentRect.width : R.planSvg.clientWidth); if (w > 0 && Math.abs(w - ui.planW) > 2) { ui.planW = w; renderPlan(getModel(), true); } });
      ro.observe(R.plan);
    }
  }

  function selectFrom(n) {
    const [k, id] = n.dataset.sel.split('|');
    if (k && id) WF.app.select(k, id);
  }
  function onClick(e) {
    const go = e.target.closest('[data-go]');
    if (go) { if (go.dataset.go === 'hist') setTab('hist'); const tgt = { table: R.tableCard, hist: R.histCard, plan: R.planCard, crib: R.cribCard }[go.dataset.go]; if (tgt) tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) { setTab(tb.dataset.tab); return; }
    if (e.target.closest('[data-allrows]')) { ui.showAll = !ui.showAll; renderTable(getModel(), true); if (!ui.showAll) R.tableCard.scrollIntoView({ block: 'nearest' }); return; }
    const f = e.target.closest('[data-f]');
    if (f) { ui.filter = ui.filter === f.dataset.f ? 'all' : f.dataset.f; renderTable(getModel(), true); return; }
    const hc = e.target.closest('[data-hc]');
    if (hc) { ui.histCat = hc.dataset.hc; ui.histN = 6; renderHistory(getModel(), true); return; }
    if (e.target.closest('[data-more]')) { ui.histN += 12; renderHistory(getModel(), true); return; }
    const sel = e.target.closest('[data-sel]');
    if (sel) { selectFrom(sel); return; }
  }

  function setTab(t) {
    ui.tab = t;
    R.tabSel.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    R.paneHist.hidden = t !== 'hist'; R.paneStock.hidden = t !== 'stock';
    R.histSeg.hidden = t !== 'hist'; R.stockSeg.hidden = t !== 'stock';
    setText(R.tabSub, t === 'hist' ? ui.subHist : ui.subStock);
  }

  // ------------------------------------------------------------------ Update
  let lastT = -1, lastV = -1;
  function update() {
    if (!root) return;
    const s = S(); if (!s) return;
    if (s.t === lastT && lastV === MODEL_V) return;
    lastT = s.t; lastV = MODEL_V;
    const m = getModel(); if (!m) return;
    renderNext(m);
    renderKpis(m);
    renderPlan(m);
    renderExplainer(m);
    renderTable(m);
    renderQueue(m);
    renderCost(m);
    renderStock(m);
    renderHistory(m);
  }

  /** Kopfkarte „Nächster Wechsel“: frühester Wechsel überhaupt – angekündigt (Engine-Plan) oder voraussichtlich (hochgerechnet,
      als solcher gekennzeichnet). Liegt ein voraussichtlicher Wechsel vor dem nächsten angekündigten, wird er gezeigt
      und der angekündigte darunter genannt (keine scheinbar widersprüchlichen Uhrzeiten zwischen Kopf und Wechselplan). */
  function renderNext(m) {
    const now = m.t;
    let chg = null, plan = null, proj = null;
    for (const mx of m.machines) {
      if (mx.changing && !chg) chg = { mx, tools: mx.changing.list.map(x => (TT(x.type) || {}).name || x.type), by: pName(mx.changing.by), sel: 'machine|' + mx.id };
      for (const g of mx.groups) if (g.t != null && (!plan || g.t < plan.t)) plan = { mx, t: g.t, g, tools: g.tools.map(x => x.name), by: g.by, stage: g.stage, sel: g.tools[0].id ? 'tool|' + g.tools[0].id : 'machine|' + mx.id };
      for (const x of mx.proj) if (x.t != null && x.t >= now - 60 && (!proj || x.t < proj.t)) proj = { mx, x, t: x.t };
    }
    let html, c = 'var(--st-tool)', cls = '';
    const mName = (mx) => `${esc(mx.short)} (${esc(mx.id)})`;
    if (chg) {
      html = `<span class="tl-nx-t"><small>bis ca.</small>${esc(tclock(Math.max(now, chg.mx.changing.t1), now))}</span><span class="tl-nx-b"><span class="eyebrow">Werkzeugwechsel läuft</span><b>${mName(chg.mx)} · ${esc(chg.tools.map(toolShort).join(', '))}</b><small>${esc(chg.by)} wechselt seit ${esc(tclock(chg.mx.changing.t0, now))}</small></span>`;
      R.next.dataset.sel = chg.sel;
    } else if (plan && (!proj || plan.t <= proj.t + 60)) {
      if (plan.g.waitFromT != null) c = 'var(--st-wait)';
      const pIdx = plan.g.tools.length > 0 && plan.g.tools.every(willIndex);
      // eine Aussage je Teil: was (wenden / tauschen) · wer und wo – „an der Maschine“ nicht doppelt
      const pAny = plan.g.tools.some(willIndex);
      const act = pIdx ? (plan.g.tools.length === 1 ? idxWhat(plan.g.tools[0]) : 'Schneide wenden') : pAny ? 'tauschen und wenden' : 'Werkzeug tauschen';
      const who = pIdx ? idxWho(plan.mx.id, plan.g.tools[0].plannedChange) : plan.by ? `${plan.by} · ${plan.stage}` : plan.stage === 'Werkzeug liegt bereit' ? 'Werkzeug liegt bereit' : plan.g.note ? plan.g.note : 'Einrichter:in wird rechtzeitig losgeschickt';
      const waitTxt = plan.g.waitFromT != null ? (plan.mx.mv.state === 'waitTool' ? 'Maschine wartet' : 'Maschine steht ab ' + tclock(plan.g.waitFromT, now)) : null;
      html = `<span class="tl-nx-t"><small>ca.</small>${esc(tclock(plan.t, now))}</span><span class="tl-nx-b"><span class="eyebrow">Nächster Wechsel · angekündigt</span><b>${mName(plan.mx)} · ${esc(plan.tools.map(toolShort).join(', '))}</b><small>${esc([afterTxt(plan.g.afterPart), waitTxt, act, who].filter(Boolean).join(' · '))}</small></span>`;
      R.next.dataset.sel = plan.sel;
    } else if (proj) {
      const p = proj.x;
      cls = 'proj';
      if (p.waitFromT != null) c = 'var(--st-wait)';
      // Unterzeile sagt nur Eindeutiges: noch nicht angekündigt (bzw. Stillstand) und was zu tun ist.
      // Ein bereits angekündigter Wechsel an einer anderen Maschine steht getrennt darunter – kein „nicht angekündigt … angekündigt“.
      const anyIdx = p.members.some(mb => mb.index);
      const m0 = p.members[0];
      const idxAct = p.members.length === 1 && m0.edges > 1 ? `Schneide wenden ${m0.edge} → ${m0.edge + 1}/${m0.edges}` : 'Schneide wenden';
      const what = [afterTxt(p.afterPart), p.waitFromT != null ? `Stillstand ab ca. ${tclock(p.waitFromT, now)}` : 'noch nicht angekündigt', p.index ? idxAct : anyIdx ? 'tauschen und wenden' : 'Werkzeug tauschen', p.index && p.waitFromT == null ? idxWho(proj.mx.id, null) : ''].filter(Boolean).join(' · ');
      const other = plan ? `<small class="tl-nx-o">Nächster angekündigter Wechsel: <b>${esc(tclock(plan.t, now))}</b> · ${mName(plan.mx)}</small>` : '';
      html = `<span class="tl-nx-t"><small>ca.</small>${esc(tclock(p.t, now))}</span><span class="tl-nx-b"><span class="eyebrow">Nächster Wechsel · voraussichtlich</span><b>${mName(proj.mx)} · ${esc(p.members.map(mb => toolShort(mb.s.tx.name)).join(', '))}</b><small>${esc(what)}</small>${other}</span>`;
      R.next.dataset.sel = p.lead.id ? 'tool|' + p.lead.id : 'machine|' + proj.mx.id;
    } else {
      html = `<span class="tl-nx-b" style="border-left:0;padding-left:0"><span class="eyebrow">Nächster Wechsel</span><b>Kein Wechsel absehbar</b><small>alle Schneiden reichen bis zum Ende ihrer Arbeitsgänge</small></span>`;
      delete R.next.dataset.sel;
    }
    R.next.style.setProperty('--c', c);
    R.next.classList.toggle('proj', cls === 'proj');
    setHTML(R.next, html);
  }
  function renderKpis(m) {
    const now = m.t;
    const inUse = m.inUse.length, nM = new Set(m.inUse.map(t => t.machineId)).size;
    // Ehrlich benennen, was das Modell kennt: die standzeitkritischen Werkzeuge der laufenden Arbeitsgänge
    // (eine DMU 65 trägt 30–60 Werkzeuge im Magazin – die meisten davon ohne Standzeitüberwachung)
    setHTML(R.k1, `${esc(U.fmtNum(inUse))}<small>Werkzeuge</small>`);
    setHTML(R.k1s, `nur standzeitkritische Werkzeuge<br>${nM === 1 ? 'des laufenden Arbeitsgangs' : `der <b>${nM}</b> laufenden Arbeitsgänge`}`);
    setHTML(R.k2, `${esc(U.fmtNum(m.changesToday))}<small>Werkzeuge</small>`);
    setHTML(R.k2s, m.stops ? `in <b>${m.stops}</b> ${m.stops === 1 ? 'Stopp' : 'Stopps'}${m.idxToday ? ` · <b>${m.idxToday}</b>× Schneide gewendet` : ''}${m.avgDur ? ` · Ø ${esc(U.fmtDur(m.avgDur))} je Wechsel` : ''}` : 'heute noch kein Wechsel');
    setHTML(R.k3, `${esc(U.fmtNum(m.plan2Tools))}<small>${m.plan2Tools === 1 ? 'Werkzeug' : 'Werkzeuge'}</small>`);
    const nx = m.plan2[0];
    const pj = m.proj2.length;
    const waitingNow = m.machines.filter(mx => mx.mv.state === 'waitTool').map(mx => mx.id);
    // Nichts in 2 h, aber angekündigte Wechsel (z. B. nachts für Di 06:02) oder wartende Maschinen: das sagen, nicht „kein Wechsel absehbar“
    let nextAny = null;
    for (const mx of m.machines) for (const g of mx.groups) if (g.t != null && (!nextAny || g.t < nextAny.t)) nextAny = { t: g.t, id: mx.id };
    const nWait = waitingNow.length, waitTxt = nWait ? `${nWait} ${nWait === 1 ? 'Maschine wartet' : 'Maschinen warten'}` : '';
    setHTML(R.k3s, nx ? `nächster <b>${esc(tclock(nx.g.t, now))}</b> an ${esc(nx.m.id)}${pj ? ` · ${pj} voraussichtlich` : ''}`
      : nextAny ? `in 2 h keiner · nächster <b>${esc(tclock(nextAny.t, now))}</b> an ${esc(nextAny.id)}${waitTxt ? ` <span style="white-space:nowrap">(${esc(waitTxt)})</span>` : ''}`
      : pj ? `${pj} voraussichtlich, noch nicht geplant` : nWait ? esc(waitTxt) + ' auf Werkzeug' : 'kein Wechsel absehbar');
    setHTML(R.k4, m.waitSec > 0 ? esc(U.fmtDur(m.waitSec)) : '0<small>min</small>');
    const future = m.waitAhead.filter(x => !waitingNow.includes(x.id));
    const ahead = (waitingNow.length ? ` · <b style="color:var(--st-wait)">jetzt</b>: ${esc(waitingNow.join(', '))} ${waitingNow.length === 1 ? 'wartet' : 'warten'}` : '') + (future.length ? ` · <b style="color:var(--st-wait)">absehbar</b>: ${future.slice(0, 2).map(x => `${esc(x.id)} ab ${esc(tclock(x.t, now))}`).join(', ')}${future.length > 2 ? ' …' : ''}` : '');
    // Hinweis nur bei einem Wert > 0 (UI_GUIDE Regel 14) – absehbare Stillstände stehen in der Zusatzzeile
    R.k4box.classList.toggle('warn', m.waitSec >= 60);
    setHTML(R.k4s, (m.waitSec > 0 ? `heute an <b>${m.waitMachines}</b> ${m.waitMachines === 1 ? 'Maschine' : 'Maschinen'}` : 'heute keine Maschine') + (ahead || ` · Wechselzeit ${esc(U.fmtDur(m.tcSec))}`));
    setHTML(R.k5, esc(U.fmtEur(m.cost.total)));
    const perPart = m.goodToday > 0 ? m.cost.total / m.goodToday : null;
    setHTML(R.k5s, `Schrott ${esc(U.fmtEur(m.cost.scrap))} · Nachschliff ${esc(U.fmtEur(m.cost.regrind))}${perPart != null ? ` · ${esc(U.fmtNum(perPart, 2))} € je Gutteil` : ''}`);
    // Mini-Grafiken
    const sc = {};
    for (const t of m.tools) { const k = ['planned', 'changing'].includes(t.status) ? 'planned' : ['due', 'broken'].includes(t.status) ? t.status : t.status === 'ok' ? 'ok' : 'other'; sc[k] = (sc[k] || 0) + 1; }
    const tot = Math.max(1, m.tools.length);
    const SCC = { ok: 'var(--st-run)', planned: 'var(--st-tool)', due: 'var(--st-wait)', broken: 'var(--st-fault)', other: 'var(--st-idle)' };
    setHTML(R.k1v, `<div class="tl-kstack" title="${esc(Object.keys(SCC).filter(k => sc[k]).map(k => (k === 'other' ? 'Rüsten/nicht im Einsatz' : stLabel(k === 'planned' ? 'planned' : k)) + ': ' + sc[k]).join(' · '))}">${Object.keys(SCC).filter(k => sc[k]).map(k => `<i style="--c:${SCC[k]};width:${(sc[k] / tot * 100).toFixed(1)}%"></i>`).join('')}</div>`);
    // Wechsel je Stunde (heute)
    // Wechsel je Stunde, Arbeitstag 06–22 Uhr (Nacht: Geisterschicht-Stunden davor/danach mitgezählt)
    const hNow = Math.floor((now - m.ds) / 3600);
    const hA = Math.min(6, hNow), hZ = Math.max(22, hNow + 1);
    const bins = Array.from({ length: hZ - hA }, () => 0);
    for (const e of m.evToday) { const b = Math.floor((e.t - m.ds) / 3600) - hA; if (b >= 0 && b < bins.length) bins[b] += (e.data && e.data.tools ? e.data.tools.length : 1); }
    const mxb = Math.max(1, ...bins), bw = 5, gap = 2, wv = bins.length * (bw + gap) - gap;
    setHTML(R.k2v, `<svg width="100%" height="28" viewBox="0 0 ${wv} 28" preserveAspectRatio="none" aria-hidden="true">${bins.map((v, i) => { const fut = hA + i > hNow, hh = v ? Math.max(3, v / mxb * 26) : 2; return `<rect x="${i * (bw + gap)}" y="${(28 - hh).toFixed(1)}" width="${bw}" height="${hh.toFixed(1)}" style="fill:${v ? 'var(--st-tool)' : fut ? 'var(--line)' : 'var(--line2)'};opacity:${hA + i === hNow ? 1 : v ? 0.75 : 1}"><title>${String(hA + i).padStart(2, '0')}:00 – ${v} ${v === 1 ? 'Werkzeug' : 'Werkzeuge'}</title></rect>`; }).join('')}</svg>`);
    // nächste 2 h: Marker auf einer Zeitlinie (HTML, volle Kachelbreite, Marker bleiben quadratisch)
    const P3 = (t) => (U.clamp((t - now) / 7200, 0, 1) * 100).toFixed(1);
    let s3 = '<i class="ln"></i><i class="nw"></i>';
    for (const x of m.proj2) s3 += `<i class="mk p" style="left:${P3(x.t)}%"></i>`;
    for (const x of m.plan2) s3 += `<i class="mk${x.g.waitFromT != null ? ' w' : ''}" style="left:${P3(x.g.t)}%"></i>`;
    setHTML(R.k3v, `<div class="tl-k3" title="Wechsel in den nächsten 2 h: gefüllt = geplant, gestrichelt = voraussichtlich">${s3}<span class="e">+2 h</span></div>`);
    setHTML(R.k4v, '');
    // Kosten kumuliert über den Tag
    const ct = [];
    for (const id in S().tools) { const tl = S().tools[id]; if (tl.dismountT != null && tl.dismountT >= m.ds && tl.cost) ct.push([tl.dismountT, tl.cost]); }
    ct.sort((a, b) => a[0] - b[0]);
    let acc = 0; const vals = [0]; for (const c of ct) { acc += c[1]; vals.push(acc); }
    setHTML(R.k5v, vals.length > 2 ? WF.ui.spark(vals, { w: 120, h: 28, color: 'var(--text2)', min: 0 }) : '');
  }

  // ------------------------------------------------------------------ Wechselplan (SVG)
  function planWindow(now, narrow) {
    const snap = Math.floor(now / 900) * 900;
    const back = narrow ? 3600 : 2 * 3600;
    const tA = snap - back;
    return { tA, tB: tA + back + 4 * 3600 + 900 };
  }
  /** Jetzt-abhängige Elemente des Wechselplans nachführen (ohne Neuaufbau) */
  function planLive(now) {
    const lv = R.plan._lv; if (!lv || lv.now === now) return;
    lv.now = now;
    const X = lv.X, xn = X(now);
    const f = (v) => v.toFixed(1);
    if (lv.past) lv.past.setAttribute('width', f(Math.max(0, xn - lv.x0)));
    if (lv.line) { lv.line.setAttribute('x1', f(xn)); lv.line.setAttribute('x2', f(xn)); }
    if (lv.tag) lv.tag.setAttribute('transform', `translate(${f(xn)},0)`);
    const ck = U.fmtClock(now);
    if (lv.tagTxt && ck !== lv.clock) { lv.clock = ck; lv.tagTxt.textContent = 'Jetzt ' + ck; }
    for (const e of lv.L) { const xa = X(Math.max(now, e.a)), xb = X(e.b); e.n.setAttribute('x', f(xa)); e.n.setAttribute('width', f(Math.max(e.m, xb - xa))); }
    for (const e of lv.Rr) { const xa = X(e.a); e.n.setAttribute('width', f(Math.max(e.m, xn - xa))); }
  }
  /** Maschinenname für schmale Beschriftung: ganz, sonst erstes Wort, sonst gekürzt */
  function fitWord(n, px) {
    n = String(n || ''); const max = Math.max(3, Math.floor(px / 5.9));
    if (n.length <= max) return n;
    const w = n.split(/\s+/)[0];
    return w.length <= max ? w : w.slice(0, max - 1) + '…';
  }
  /** Wechselplan: der statische Teil (Zeilen, Plan, Marker) wird nur bei geänderter Struktur und höchstens ~1×/s neu gebaut;
      alles, was an „jetzt“ hängt (Jetzt-Linie, Rückblick-Schatten, offene Ist-Segmente, ab jetzt beginnende Balken), wird bei
      jedem Takt per setAttribute nachgeführt – so bleibt die Ansicht auch bei 600× flüssig. */
  function renderPlan(m, force) {
    if (!m || !R.plan) return;
    // Breite aus dem ResizeObserver (kein erzwungenes Layout je Takt); nur beim allerersten Mal messen
    const W = Math.round(ui.planW || R.planSvg.clientWidth || (R.plan.clientWidth - 16) || 900);
    ui.planW = W;
    const narrow = W < 640;
    const now = m.t;
    const { tA, tB } = planWindow(now, narrow);
    const sig = [W, tA, m.machines.map(mx => [mx.id, mx.mv.state, mx.mv.order ? mx.mv.order.id + mx.mv.order.seq : '', mx.groups.map(g => g.key + g.by + g.stage + Math.round((g.t || 0) / 60) + (g.waitFromT || '')).join(), mx.proj.map(p => p.key + Math.round((p.t || 0) / 60)).join(), mx.past.length, mx.changing ? mx.changing.t1 : '', mx.fc.map(fe => fe.orderId + fe.seq + Math.round(fe.end / 60)).join()].join('~')).join('|')].join('#');
    const lv = R.plan._lv, realNow = performance.now();
    const fresh = lv && lv.tA === tA && lv.W === W && now >= lv.t0 && now - lv.t0 < 900;
    if (!force && fresh && (sig === R.plan._sig || realNow - (R.plan._at || 0) < 1000)) { planLive(now); return; }
    R.plan._sig = sig; R.plan._at = realNow;
    const LW = narrow ? 92 : 168, PR = 12, AX = 34, RH = narrow ? 44 : 48;
    const x0 = LW, x1 = W - PR, span = tB - tA;
    const X = (t) => x0 + (U.clamp(t, tA, tB) - tA) / span * (x1 - x0);
    // Live-Attribute: Rechteck von max(jetzt, a) bis b bzw. von a bis jetzt
    const LA = (a, b, mw) => ` data-la="${a}" data-lb="${b}" data-lm="${mw}"`;
    const RA = (a, mw) => ` data-ra="${a}" data-lm="${mw}"`;
    const rows = m.machines;
    const H = AX + rows.length * RH + 4;
    const tips = {};
    const yTop = AX - 6;
    let g = '';
    // Hinterlegung: Pausen / keine Schicht
    for (const b of offBlocks(tA, tB)) {
      const xa = X(b.t0), w = Math.max(0, X(b.t1) - xa);
      if (b.kind === 'off') g += `<rect x="${xa.toFixed(1)}" y="${yTop}" width="${w.toFixed(1)}" height="${H - yTop}" style="fill:var(--bg);opacity:.45"/>`;
      g += `<rect x="${xa.toFixed(1)}" y="${yTop}" width="${w.toFixed(1)}" height="${H - yTop}" fill="url(#tl-hatch)" style="opacity:${b.kind === 'off' ? 0.8 : 0.55}"/>`;
    }
    // Vergangenheit abdunkeln
    const xn = X(now);
    g += `<rect data-lvp x="${x0}" y="${yTop}" width="${Math.max(0, xn - x0).toFixed(1)}" height="${H - yTop}" style="fill:var(--bg2);opacity:.5"/>`;
    // Stundenraster + Achse (Beschriftung nicht unter der Jetzt-Marke)
    const pxH = (x1 - x0) / (span / 3600);
    const stepH = pxH >= 64 ? 3600 : 7200;
    for (let t = Math.ceil(tA / 1800) * 1800; t <= tB; t += 1800) {
      const major = t % stepH === 0;
      const x = X(t);
      g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${yTop}" y2="${H}" style="stroke:var(--line);opacity:${major ? 0.95 : 0.4}" stroke-width="1"/>`;
      if (major && x > x0 + 16 && x < x1 - 16 && Math.abs(x - xn) > 64) {
        const lbl = t % DAY === 0 ? U.fmtDayClock(t) : U.fmtClock(t);
        g += `<text class="tl-ax${t % DAY === 0 ? ' b' : ''}" x="${x.toFixed(1)}" y="${AX - 15}" text-anchor="middle">${lbl}</text>`;
      }
    }
    // Zeilen
    rows.forEach((mx, ri) => {
      const top = AX + ri * RH, ym = top + 17, yb = top + RH - 13, mv = mx.mv;
      g += `<line x1="0" x2="${W}" y1="${top}" y2="${top}" style="stroke:var(--line)" stroke-width="1"/>`;
      // Label
      const stc = WF.STATE[mv.state] ? WF.STATE[mv.state].color : 'var(--st-idle)';
      const sub = narrow ? fitWord(mv.short, LW - 22) : `${mx.id} · ${mv.stateLabel}`;
      g += `<g class="tl-rl" data-sel="machine|${esc(mx.id)}" data-k="m:${esc(mx.id)}"><rect x="0" y="${top}" width="${LW - 6}" height="${RH}" fill="transparent"/>
        <circle cx="6" cy="${top + 18}" r="3.5" style="fill:${stc}"/>
        <text class="tl-rn" x="16" y="${top + 22}">${esc(narrow ? mx.id : mx.short)}</text>
        <text class="tl-rs" x="16" y="${top + 37}">${esc(sub)}</text></g>`;
      tips['m:' + mx.id] = { c: stc, k: 'Maschine', h: `${mx.id} ${mv.short}`, rows: [['Zustand', mv.stateLabel], ['Auftrag', mv.order ? `${mv.order.id} · AG ${mv.order.seq}` : '–'], ['Teil', mv.partNo != null ? `${mv.partNo} von ${mv.partsTotal}` : mv.order ? `${mv.partsDone} von ${mv.partsTotal} fertig` : '–'], ['Werkzeuge', String(mx.tools.length)]], note: mv.cause };
      // Spur
      g += `<rect x="${x0}" y="${yb}" width="${x1 - x0}" height="6" rx="3" style="fill:var(--track)"/>`;
      // Ist-Zustände (Rückblick)
      for (const sgm of mv.segments || []) {
        const a = Math.max(tA, sgm.t0), b = Math.min(now, sgm.t1 == null ? now : sgm.t1);
        if (b <= a) continue;
        const col = WF.STATE[sgm.state] ? WF.STATE[sgm.state].color : 'var(--st-idle)';
        g += `<rect${sgm.t1 == null ? RA(a, 0.8) : ''} x="${X(a).toFixed(1)}" y="${yb}" width="${Math.max(0.8, X(b) - X(a)).toFixed(1)}" height="6" style="fill:${col};opacity:${sgm.state === 'idle' ? 0.45 : 0.92}"/>`;
        if (sgm.state === 'waitTool' || sgm.state === 'toolchange' || sgm.state === 'fault') {
          const key = 'sg:' + mx.id + ':' + sgm.t0;
          g += `<rect data-k="${key}" x="${(X(a) - 2).toFixed(1)}" y="${yb - 5}" width="${Math.max(6, X(b) - X(a) + 4).toFixed(1)}" height="16" fill="transparent"/>`;
          tips[key] = { c: col, k: 'Ist-Zustand', h: WF.STATE[sgm.state].label, rows: [['Von – bis', `${tclock(sgm.t0, now)} – ${sgm.t1 == null ? 'jetzt' : tclock(sgm.t1, now)}`], ['Dauer', U.fmtDur((sgm.t1 == null ? now : sgm.t1) - sgm.t0)]] };
        }
      }
      // Plan (Zukunft): laufender Arbeitsgang, Rüsten der Folgeaufträge laut Prognose
      const setupLbl = [], occ = [];
      for (const fe of mx.fc) {
        const s0 = Math.max(now, fe.active ? now : fe.start), sE = fe.setupEnd != null ? Math.max(s0, fe.setupEnd) : s0, e0 = fe.end;
        if (e0 <= now || fe.start >= tB) continue;
        if (sE > s0 + 30) {
          const key = 'fs:' + mx.id + ':' + fe.orderId + fe.seq;
          g += `<rect data-k="${key}"${fe.active ? LA(fe.start, sE, 1) : ''} x="${X(s0).toFixed(1)}" y="${yb}" width="${Math.max(1, X(sE) - X(s0)).toFixed(1)}" height="6" style="fill:var(--st-setup);opacity:.55"/>`;
          tips[key] = { c: 'var(--st-setup)', k: 'Plan · Rüsten', h: `${fe.orderId} · AG ${fe.seq}`, rows: [['Rüsten', fe.active ? `läuft · fertig ca. ${tclock(fe.setupEnd, now)}` : `ca. ${tclock(fe.start, now)} – ${tclock(fe.setupEnd, now)}`], ['Arbeitsgang', fe.op || '–']], note: 'Beim Rüsten werden alle Werkzeuge des Arbeitsgangs durch neue, vermessene ersetzt (Sägeband, Schleifscheibe und Wälzfräser gleichen Typs bleiben montiert).' };
          if (X(sE) - X(s0) > 34 && !narrow) setupLbl.push({ x: X(s0) + 3, w: 40, fe });
        }
        const r0 = fe.active ? Math.max(now, sE) : sE;
        if (e0 > r0) {
          const key = 'fr:' + mx.id + ':' + fe.orderId + fe.seq;
          g += `<rect data-k="${key}"${fe.active ? LA(sE, e0, 1) : ''} x="${X(r0).toFixed(1)}" y="${yb}" width="${Math.max(1, X(e0) - X(r0)).toFixed(1)}" height="6" style="fill:var(--st-run);opacity:${fe.active ? 0.34 : 0.24}"/>`;
          tips[key] = { c: 'var(--st-run)', k: 'Plan · Fertigung', h: `${fe.orderId} · AG ${fe.seq}`, rows: [['Arbeitsgang', fe.op || '–'], ['Maschine belegt bis', 'ca. ' + tclock(e0, now)]] };
          if (fe.active && e0 < tB - 600 && X(e0) - xn > 30) g += `<line x1="${X(e0).toFixed(1)}" x2="${X(e0).toFixed(1)}" y1="${yb - 3}" y2="${yb + 9}" style="stroke:var(--st-run)" stroke-width="2"/>`;
        }
      }
      // laufender Wechsel
      const marks = [];
      if (mx.changing) {
        const b = Math.max(now, mx.changing.t1);
        g += `<rect${LA(now, b, 2)} x="${xn.toFixed(1)}" y="${yb}" width="${Math.max(2, X(b) - xn).toFixed(1)}" height="6" class="tl-pulse" style="fill:var(--st-tool)"/>`;
        marks.push({ key: 'cg:' + mx.id, t: now, kind: 'changing', codes: mx.changing.list.map(x => codeOf(x.type, (TT(x.type) || {}).name)), sel: 'machine|' + mx.id });
        tips['cg:' + mx.id] = { c: 'var(--st-tool)', k: 'Jetzt · Werkzeugwechsel', h: mx.changing.list.map(x => (TT(x.type) || {}).name || x.type).join(', '), rows: [['Durch', pName(mx.changing.by)], ['Seit', tclock(mx.changing.t0, now)], ['Fertig ca.', tclock(mx.changing.t1, now)]], note: mx.changing.list.map(x => x.reason).filter(Boolean).join(' · ') };
      }
      // vergangene Wechsel (Striche)
      for (const e of mx.past) {
        if (e.t < tA || e.t > now) continue;
        const d = (e.data && e.data.durSec) || 0;
        const xa = X(e.t - d), xb = X(e.t);
        const brk = e.data && e.data.toolBreak;
        const col = brk ? 'var(--st-fault)' : 'var(--st-tool)';
        const key = 'ev:' + e.id;
        const first = e.data && e.data.tools && e.data.tools[0];
        g += `<g class="tl-mk" data-k="${key}" ${first && first.oldToolId ? `data-sel="tool|${esc(first.oldToolId)}"` : ''}><rect x="${(xb - 1.5).toFixed(1)}" y="${ym - 9}" width="3" height="18" rx="1.5" style="fill:${col}"/><rect x="${(Math.min(xa, xb - 6)).toFixed(1)}" y="${ym - 10}" width="${Math.max(12, xb - xa + 6).toFixed(1)}" height="20" fill="transparent"/></g>`;
        tips[key] = { c: col, k: e.data.index ? 'Schneide gewendet' : 'Gewechselt', h: (e.data.tools || []).map(x => toolShort(x.name)).join(', '),
          rows: [['Uhrzeit', `${tclock(e.t - d, now)} – ${tclock(e.t, now)}`], ['Durch', pName(e.data.by)], ['Dauer', U.fmtDur(d)]].concat((e.data.tools || []).map(x => [toolShort(x.name), `${pct(x.wearPct, 0)} · ${x.action === 'index' ? `gewendet ${x.edgeFrom} → ${x.edgeTo}/${x.edges}` : catOf(x).label}`])),
          note: e.data.cause || '' };
      }
      // Engine-Plan (geplant) und eigene Projektion (voraussichtlich)
      for (const gp of mx.groups) {
        if (gp.t == null) continue;
        if (gp.waitFromT != null && gp.waitFromT < gp.t) {
          const key = 'wt:' + gp.key;
          g += `<rect data-k="${key}" x="${X(gp.waitFromT).toFixed(1)}" y="${yb - 1}" width="${Math.max(2, X(gp.t) - X(gp.waitFromT)).toFixed(1)}" height="8" rx="2" style="fill:var(--st-wait);opacity:.85"/>`;
          tips[key] = { c: 'var(--st-wait)', k: 'Plan · Stillstand', h: 'Wartet auf Werkzeug', rows: [['Von – bis', `ca. ${tclock(gp.waitFromT, now)} – ${tclock(gp.t, now)}`], ['Dauer', U.fmtDur(gp.t - gp.waitFromT)]], note: gp.note || 'Standzeit reicht nicht bis zur Ankunft der Einrichter:in.' };
        }
        const gIdx = gp.tools.length > 0 && gp.tools.every(willIndex);
        const dur = Math.max(...gp.tools.map(t => changeSecOf(t.kind, willIndex(t))));
        if (gp.t + dur > now) g += `<rect${LA(gp.t, gp.t + dur, 2)} x="${X(Math.max(now, gp.t)).toFixed(1)}" y="${yb}" width="${Math.max(2, X(gp.t + dur) - X(Math.max(now, gp.t))).toFixed(1)}" height="6" style="fill:var(--st-tool);opacity:${gp.later ? 0.6 : 0.9}"/>`;
        const wait = gp.waitFromT != null;
        const pc0 = gp.tools[0].plannedChange;
        const stage = gIdx && !gp.later ? `${idxWho(mx.id, pc0)} · ${idxDur()}` : gp.by ? `${gp.by} · ${gp.stage}` : gp.stage === 'später' ? 'eigener Stopp, nach dem nächsten Wechsel' : gp.stage === 'offen' ? 'Einrichter:in wird rechtzeitig losgeschickt' : gp.stage;
        const whoN = gIdx && !gp.later ? idxName(mx.id, pc0) : gp.by;
        const beyond = gp.t > tB && wait && gp.waitFromT < tB;
        if (gp.t <= tB || beyond) marks.push({ key: gp.key, t: beyond ? Math.max(now, gp.waitFromT) : gp.t, kind: wait ? 'wait' : gp.later ? 'later' : 'plan', codes: gp.tools.map(t => codeOf(t.typeId, t.name)), sel: gp.tools[0].id ? 'tool|' + gp.tools[0].id : 'machine|' + mx.id,
          label: beyond ? `Stopp ca. ${U.fmtClock(gp.waitFromT)} · Wechsel ${tclock(gp.t, now)}` : whoN ? [`${afterTxt(gp.afterPart)} · ${U.fmtClock(gp.t)} · ${whoN}`, `${afterTxt(gp.afterPart)} · ${U.fmtClock(gp.t)}`] : `${afterTxt(gp.afterPart)} · ${U.fmtClock(gp.t)}` });
        tips[gp.key] = { c: wait ? 'var(--st-wait)' : 'var(--st-tool)', k: (gp.later ? 'Geplant · eigener Stopp' : wait ? 'Geplant · Maschine wartet vorher' : 'Geplant') + (gIdx ? ' · Schneide wenden' : ''), h: gp.tools.map(t => toolShort(t.name) + (willIndex(t) && edgeOf(t) ? ` (Schneide ${edgeOf(t).no} → ${edgeOf(t).no + 1}/${edgeOf(t).of})` : '') + (t.plannedChange && t.plannedChange.bundled ? ' (mitgewechselt)' : '')).join(', '),
          rows: [['Teilegrenze', `${afterTxt(gp.afterPart)}`], ['Uhrzeit', 'ca. ' + tclock(gp.t, now)], [gIdx ? 'Wer' : 'Einrichter:in', stage || '–']].concat(gp.tools.map(t => [toolShort(t.name), `${pct(t.wearPct, 0)} · noch ${teile(t.remainingParts)}`])).concat(wait ? [['Stopp ab', 'ca. ' + tclock(gp.waitFromT, now)]] : []),
          note: gp.note || (gp.tools[0] && gp.tools[0].explain) || '' };
      }
      for (const p of mx.proj) {
        if (p.t == null) continue;
        const t0 = p.lead, nxt = p.kind === 'next';
        const names = p.members.map(mb => toolShort(mb.s.tx.name) + (mb.bundled ? ' (mitgewechselt)' : ''));
        if (p.waitFromT != null && p.waitFromT < tB && p.t > now) {
          const key = 'pw:' + p.key, xa = X(Math.max(now, p.waitFromT)), xb = X(p.t);
          g += `<rect data-k="${key}"${LA(p.waitFromT, p.t, 2)} x="${xa.toFixed(1)}" y="${yb - 1}" width="${Math.max(2, xb - xa).toFixed(1)}" height="8" rx="2" fill="url(#tl-hatchw)" style="stroke:var(--st-wait);stroke-width:1;stroke-opacity:.7"/>`;
          tips[key] = { c: 'var(--st-wait)', k: 'Voraussichtlich · Stillstand', h: `Wartet auf Werkzeug (${toolShort(t0.name)})`, rows: [['Ab', 'ca. ' + tclock(p.waitFromT, now)], ['Bis', 'ca. ' + tclock(p.t, now)], ['Dauer', U.fmtDur(p.t - p.waitFromT)]],
            note: `Die Standzeit reicht bis ca. ${tclock(p.waitFromT, now)}; vorher ist niemand mit Werkzeugwechsel-Qualifikation im Dienst (nächster Arbeitsbeginn ${tclock(p.staffT || p.t, now)}). Abhilfe: vorbeugender Wechsel vor Schichtende in der Maschinenansicht.` };
        }
        const wait = p.waitFromT != null;
        const beyond = p.t > tB && wait && p.waitFromT < tB;
        if ((p.t < now - 60 || p.t > tB) && !beyond) continue;
        const annc = !nxt && t0.announcedT != null && !wait;
        marks.push({ key: p.key, t: beyond ? Math.max(now, p.waitFromT) : p.t, kind: wait ? 'projwait' : annc ? 'later' : 'proj', codes: p.members.map(mb => codeOf(mb.s.tx.typeId, mb.s.tx.name)), sel: t0.id ? 'tool|' + t0.id : 'machine|' + mx.id,
          label: beyond ? `Stopp ca. ${U.fmtClock(p.waitFromT)} · Wechsel erst ${tclock(p.t, now)}` : wait ? `Wechsel ca. ${tclock(p.t, now)}` : `ca. ${U.fmtClock(p.t)}` });
        tips[p.key] = { c: wait ? 'var(--st-wait)' : 'var(--st-tool)', k: (nxt ? 'Voraussichtlich · neue Schneide' : annc ? `Angekündigt ${tclock(t0.announcedT, now)} · Termin nach dem laufenden Wechsel` : 'Voraussichtlich · noch nicht geplant') + (p.index ? ' · wenden' : ''), h: names.join(', '),
          rows: [['Teilegrenze', `${afterTxt(p.afterPart)}`], ['Uhrzeit', 'ca. ' + tclock(p.t, now)]].concat(wait ? [['Stillstand ab', 'ca. ' + tclock(p.waitFromT, now)]] : []).concat(nxt ? [['Grund', 'die neue Schneide erreicht ihre Wechselgrenze']] : [['Planung', `in ca. ${teilen(p.inParts)}`], ['Reststandzeit', `${teile(t0.remainingPartsAfterPart)} nach dem laufenden Teil`]]),
          note: wait ? `Niemand im Dienst, wenn die Standzeit endet – ${p.index ? 'gewendet' : 'gewechselt'} wird zu Arbeitsbeginn.` : (p.members.some(mb => mb.bundled) ? 'Fast fällige Werkzeuge kommen beim selben Stopp mit (ein Stopp statt zwei). ' : '') + (nxt ? 'Hochgerechnet aus Standzeit und Taktzeit; geplant wird erst, wenn die Reststandzeit den Vorlauf erreicht.' : `Geplant wird, sobald nur noch ${teile(t0.planHorizonParts || PLAN_AT())} Reststandzeit übrig sind – dann ${p.index ? 'wendet die Bediener:in an der Maschine' : 'wird die Einrichter:in benachrichtigt'}.`) };
      }
      marks.sort((a, b) => a.t - b.t);
      // Pillen: Kurzzeichen; überlappende zusammenfassen
      const pw = (codes) => (codes.length > 1 ? (codes[0].length + 3) : codes[0].length) * 6.6 + 12;
      const clusters = [];
      const place = (c) => { c.xc = U.clamp(c.x, x0 + c.w / 2, x1 - c.w / 2); };
      for (const mk of marks) {
        const x = X(mk.t);
        const nc = { x, items: [mk], codes: mk.codes.slice(), w: pw(mk.codes) };
        place(nc);
        const last = clusters[clusters.length - 1];
        if (last && nc.xc - nc.w / 2 < last.xc + last.w / 2 + 3) { last.items.push(mk); last.codes = last.codes.concat(mk.codes); last.w = pw(last.codes); place(last); continue; }
        clusters.push(nc);
      }
      clusters.forEach((cl, i) => {
        const mk = cl.items[0];
        const kinds = cl.items.map(x => x.kind);
        const kind = kinds.includes('changing') ? 'changing' : kinds.includes('wait') ? 'wait' : kinds.includes('plan') ? 'plan' : kinds.includes('later') ? 'later' : kinds.includes('projwait') ? 'projwait' : 'proj';
        const uniq = [...new Set(cl.codes)];
        const txt = uniq.length > 1 ? `${uniq[0]} +${cl.codes.length - 1}` : uniq[0] + (cl.codes.length > 1 ? ` ×${cl.codes.length}` : '');
        const w = Math.max(24, txt.length * 6.6 + 12);
        const x = U.clamp(cl.xc != null ? cl.xc : cl.x, x0 + w / 2, x1 - w / 2);
        const cls = 'tl-pp ' + kind;
        const keyAttr = cl.items.length === 1 ? mk.key : 'cl:' + mk.key;
        if (cl.items.length > 1) {
          tips[keyAttr] = { c: 'var(--st-tool)', k: `${cl.items.length} Ereignisse dicht beieinander`, h: cl.items.map(it => it.codes.join(' + ')).join(' · '),
            rows: cl.items.map(it => [tips[it.key] ? tips[it.key].k : '', 'ca. ' + tclock(it.t, now)]), note: 'Für Einzelheiten hineinzoomen: Tabelle unten oder Klick öffnet das erste Werkzeug.' };
        }
        occ.push([x - w / 2 - 4, x + w / 2 + 4]);
        g += `<g class="tl-mk ${cls}" data-k="${keyAttr}" data-sel="${esc(mk.sel)}"><line x1="${cl.x.toFixed(1)}" x2="${cl.x.toFixed(1)}" y1="${ym + 8}" y2="${yb}" class="tl-pp-s"/><rect x="${(x - w / 2).toFixed(1)}" y="${ym - 8}" width="${w.toFixed(1)}" height="16" rx="5" class="tl-pp-r${kind === 'changing' ? ' tl-pulse' : ''}"/><text x="${x.toFixed(1)}" y="${ym + 3.6}" text-anchor="middle" class="tl-pp-t">${esc(txt)}</text></g>`;
        // Beschriftung rechts daneben, wenn Platz ist
        const nextX = i + 1 < clusters.length ? clusters[i + 1].xc - clusters[i + 1].w / 2 : x1 + 30;
        const cands = cl.items.length === 1 && mk.label ? [].concat(mk.label) : [];
        const lbl = cands.find(l => x + w / 2 + 6 + l.length * 5.6 + 8 < Math.min(nextX - 4, x1 + 6)) || null;
        if (lbl && !narrow) {
          const lw = lbl.length * 5.6 + 8;
          if (x + w / 2 + 6 + lw < nextX - 4 && x + w / 2 + 6 + lw < x1 + 6) occ.push([x + w / 2, x + w / 2 + 6 + lw]);
          if (x + w / 2 + 6 + lw < nextX - 4 && x + w / 2 + 6 + lw < x1 + 6) g += `<text class="tl-ml${kind === 'proj' || kind === 'later' ? ' p' : kind === 'wait' || kind === 'projwait' ? ' w' : ''}" x="${(x + w / 2 + 6).toFixed(1)}" y="${ym + 3.6}" pointer-events="none">${esc(lbl)}</text>`;
        }
      });
      if (!mv.order) {
        // Text passend zur verfügbaren Breite wählen (Telefon: Kurzform) – nie über den Kartenrand hinaus
        const nxt = mx.fc.find(fe => !fe.active && fe.start > now);
        const tx0 = Math.max(xn, x0) + 10, avail = x1 - tx0 - 2;
        const opts = nxt && nxt.start < tB ? [`kein Arbeitsgang · Rüsten für ${nxt.orderId} AG ${nxt.seq} ab ca. ${tclock(nxt.start, now)}`, `Rüsten ${nxt.orderId} ab ca. ${tclock(nxt.start, now)}`, `Rüsten ab ${tclock(nxt.start, now)}`]
          : ['kein Arbeitsgang · Werkzeuge bleiben bis zum nächsten Rüsten montiert', 'kein AG · Werkzeuge bleiben montiert', 'kein Arbeitsgang', 'kein AG'];
        const txt = opts.find(o => o.length * 5.7 <= avail) || '';
        if (txt) { g += `<text class="tl-rs" x="${tx0.toFixed(1)}" y="${ym + 4}">${esc(txt)}</text>`; occ.push([tx0, tx0 + txt.length * 5.7]); }
      }
      // „Rüsten“-Beschriftung nur, wo sie nichts verdeckt
      for (const sl of setupLbl) if (!occ.some(r => sl.x < r[1] && sl.x + sl.w > r[0])) g += `<text class="tl-ml p" x="${sl.x.toFixed(1)}" y="${yb - 4}" pointer-events="none">Rüsten</text>`;
    });
    g += `<line x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}" style="stroke:var(--line)" stroke-width="1"/>`;
    // Jetzt-Linie
    g += `<line data-lvn x1="${xn.toFixed(1)}" x2="${xn.toFixed(1)}" y1="${AX - 10}" y2="${H}" style="stroke:var(--accent)" stroke-width="1.5"/>`;
    const nl = 'Jetzt ' + U.fmtClock(now), nw = nl.length * 6.4 + 14;
    g += `<g data-lvt transform="translate(${xn.toFixed(1)},0)"><rect x="${(-nw / 2).toFixed(1)}" y="${AX - 28}" width="${nw}" height="18" rx="9" style="fill:var(--accent)"/><text class="tl-now-l" x="0" y="${AX - 15.5}" text-anchor="middle">${nl}</text></g>`;
    const defs = `<defs><pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--line2)" stroke-width="2"/></pattern><pattern id="tl-hatchw" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:var(--card)"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--st-wait)" stroke-width="2.2"/></pattern></defs>`;
    R.planSvg.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wechselplan je Maschine">${defs}${g}</svg>`;
    const sv = R.planSvg.firstChild;
    R.plan._lv = { tA, W, t0: now, X, x0, now, past: sv.querySelector('[data-lvp]'), line: sv.querySelector('[data-lvn]'), tag: sv.querySelector('[data-lvt]'), tagTxt: sv.querySelector('[data-lvt] text'), clock: U.fmtClock(now),
      L: [...sv.querySelectorAll('[data-la]')].map(n => ({ n, a: +n.dataset.la, b: +n.dataset.lb, m: +n.dataset.lm })),
      Rr: [...sv.querySelectorAll('[data-ra]')].map(n => ({ n, a: +n.dataset.ra, m: +n.dataset.lm })) };
    ui.tips = tips;
    if (ui.tipKey && tips[ui.tipKey]) showTip(ui.tipKey, ui.tipX, ui.tipY); else if (ui.tipKey) hideTip();
    // Fußzeile
    // gezählt wird, was im Fenster sichtbar ist – auch Stillstände, deren Wechsel erst danach liegt
    const inWin = (t, w) => (t != null && t <= tB) || (w != null && w < tB);
    const nPlan = m.machines.reduce((n, mx) => n + mx.groups.filter(g2 => inWin(g2.t, g2.waitFromT)).length, 0);
    const nProj = m.machines.reduce((n, mx) => n + mx.proj.filter(p => p.t != null && inWin(p.t, p.waitFromT)).length, 0);
    const nPast = m.evToday.length;
    setHTML(R.planF, `<span><b>${nPlan}</b> geplant</span><span><b>${nProj}</b> voraussichtlich</span><span><b>${nPast}</b> heute erledigt</span><span class="tl-plan-fx">Geplant = angekündigt und gemeldet (Wenden: Bediener:in an der Maschine · Tausch: Einrichter:in) · voraussichtlich = aus Reststandzeit und Taktzeit hochgerechnet</span>`);
  }
  function onPlanMove(e) {
    const n = e.target.closest && e.target.closest('[data-k]');
    const box = R.plan.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    if (!n) { hideTip(); return; }
    showTip(n.dataset.k, x, y);
  }
  function showTip(key, x, y) {
    const tp = ui.tips[key]; if (!tp) { hideTip(); return; }
    ui.tipKey = key; ui.tipX = x; ui.tipY = y;
    const html = `<div class="tt-k">${esc(tp.k)}</div><div class="tt-h"><i></i><span>${esc(tp.h)}</span></div>` + (tp.rows || []).map(r => `<div class="tt-r"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('') + (tp.note ? `<div class="tt-n">${esc(tp.note)}</div>` : '');
    if (R.tip._h !== html) { R.tip._h = html; R.tip.innerHTML = html; }
    R.tip.style.setProperty('--c', tp.c || 'var(--st-tool)');
    const W = R.plan.clientWidth, tw = Math.min(300, R.tip.offsetWidth || 260), th = R.tip.offsetHeight || 120;
    let left = x + 14; if (left + tw > W - 4) left = Math.max(4, x - tw - 14);
    let top = y + 14; if (top + th > R.plan.clientHeight + 40) top = Math.max(0, y - th - 10);
    R.tip.style.left = left + 'px'; R.tip.style.top = top + 'px';
    R.tip.classList.add('on');
  }
  function hideTip() { ui.tipKey = null; if (R.tip) R.tip.classList.remove('on'); }

  // ------------------------------------------------------------------ Erklärkarte
  function renderExplainer(m, force) {
    if (!m) return;
    const now = m.t;
    // Auswahlliste nur bei geänderter Werkzeugmenge und nicht während der Bedienung neu aufbauen
    const opts = m.tools.filter(t => t.id && t.status !== 'idle');
    const optSig = opts.map(t => t.id + t.machineId).join();
    if (R.exPick._sig !== optSig && document.activeElement !== R.exPick) {
      R.exPick._sig = optSig;
      R.exPick.innerHTML = `<option value="auto">Automatisch – dringlichstes Werkzeug</option>` + m.machines.map(mx => {
        const ts = opts.filter(t => t.machineId === mx.id); if (!ts.length) return '';
        return `<optgroup label="${esc(mx.id + ' ' + mx.short)}">${ts.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`;
      }).join('');
      if (ui.exPick !== 'auto' && !opts.some(t => t.id === ui.exPick)) {
        // Werkzeug wurde gewechselt: der Nachfolger am selben Platz (Maschine + Typ) wird weiter erklärt
        const nx = ui.exSlot ? opts.find(t => t.machineId + '|' + t.typeId === ui.exSlot) : null;
        ui.exPick = nx ? nx.id : 'auto';
      }
      R.exPick.value = ui.exPick;
    }
    let t = ui.exPick !== 'auto' ? m.tools.find(x => x.id === ui.exPick) : null;
    if (!t && ui.exPick !== 'auto' && ui.exSlot) t = m.tools.find(x => x.id && x.machineId + '|' + x.typeId === ui.exSlot) || null;
    if (!t) t = urgentTool(m);
    if (!t) { setHTML(R.exBody, `<div class="tl-empty"><b>Kein Werkzeug im Einsatz</b>Sobald eine Maschine gerüstet ist, erklärt diese Karte die Wechselregel am dringlichsten Werkzeug.</div>`); return; }
    const mx = m.machines.find(x => x.id === t.machineId);
    const sig = [t.id, t.status, t.wearPct, t.remainingParts, t.plannedChange ? JSON.stringify(t.plannedChange) : '', t.announcedT, mx ? mx.mv.partNo : '', t.proj.map(p => p.afterPart + ':' + Math.round((p.t || 0) / 60)).join(), Math.floor(now / 60), ui.exPick].join('|');
    if (!force && R.exBody._sig === sig) return;
    R.exBody._sig = sig;
    setHTML(R.exBody, explainerHtml(t, mx, m, now));
  }

  function explainerHtml(t, mx, m, now) {
    const mv = mx ? mx.mv : null;
    const cut = t.cutMinPerPart, life = t.life;
    const pc = t.plannedChange;
    const c = ST_C[t.status] || 'var(--st-tool)';
    const running = !!(mv && mv.partNo != null);
    const stepPct = cut && life ? cut / life * 100 : null;
    const H = t.planHorizonParts != null ? t.planHorizonParts : PLAN_AT();
    const at = t.changeAtParts != null ? t.changeAtParts : 0;
    const ready = stockReady(t.typeId);
    const tt = TT(t.typeId) || {};
    const grp = mx && pc ? mx.groups.find(g => g.tools.some(x => x.id === t.id)) : null;
    const bundled = grp ? grp.tools.filter(x => x.id !== t.id && x.plannedChange && x.plannedChange.bundled) : [];
    const selfBundled = !!(pc && pc.bundled);
    const bundledToday = m.evToday.reduce((n, e) => n + ((e.data && e.data.tools) || []).filter(x => x.bundled).length, 0);
    const cf = CFG();
    const q = m.queue.find(x => x.machineId === t.machineId);
    const eg = edgeOf(t);
    const idxNext = !!eg && !eg.last && t.kind === 'insert' && !t.broken && (t.nextAction ? t.nextAction === 'index' : true);
    // Zustand je Schritt: done · now · skip · '' (kommt noch)
    const S6 = ['done', 'done', '', '', '', ''];
    const tag = {};
    if (t.status === 'changing') { S6[2] = S6[3] = 'done'; S6[4] = 'now'; tag[4] = 'läuft'; }
    else if (t.status === 'due') { S6[2] = 'done'; S6[3] = 'now'; tag[3] = 'Maschine wartet'; }
    else if (pc && pc.stage !== 'später') {
      S6[2] = 'done';
      // Wenden: es wird nichts bereitgelegt – erledigt ist Schritt 4 erst, wenn die Person an der Maschine ist
      if (pc.stage === 'an der Maschine' || (!idxNext && pc.stage === 'Werkzeug liegt bereit')) { S6[3] = 'done'; S6[4] = 'now'; tag[4] = 'als Nächstes'; }
      else { S6[3] = 'now'; tag[3] = pc.stage === 'holt Werkzeug' || pc.stage === 'unterwegs mit Werkzeug' ? 'unterwegs' : 'als Nächstes'; }
    } else if (pc || t.announcedT) { S6[2] = 'done'; S6[3] = 'now'; tag[3] = 'als Nächstes'; }
    else if (t.need) { S6[2] = 'now'; tag[2] = 'als Nächstes'; }
    else { S6[2] = S6[3] = S6[4] = S6[5] = 'skip'; tag[2] = 'entfällt'; }
    if (t.status === 'broken') { S6[1] = 'now'; tag[1] = 'Bruch'; }
    if (bundled.length || selfBundled) { S6[5] = S6[5] === 'skip' ? 'skip' : 'now'; tag[5] = 'dabei'; }
    const steps = [];
    // 1 Verschleiß nur am Teilende
    steps.push(['Verschleiß zählt am Teilende', running && t.wearAfterPartPct != null && t.status !== 'changing' && t.wearAfterPartPct > t.wearPct
      ? `Teil ${mv.partNo} läuft – danach <b>${pct(t.wearPct, t.wearAfterPartPct - t.wearPct < 2 ? 1 : 0)} → ${pct(t.wearAfterPartPct, t.wearAfterPartPct - t.wearPct < 2 ? 1 : 0)}</b>${stepPct != null ? ` (+${U.fmtNum(stepPct, 1)} % je Teil)` : ''}.`
      : `Jetzt <b>${pct(t.wearPct, 0)}</b>${stepPct != null ? ` – jedes fertige Teil +${U.fmtNum(stepPct, 1)} % (${U.fmtNum(cut, 1)} von ${U.fmtNum(life)} min)` : ''}.`]);
    // 2 Nie über 100 %, nie mitten im Teil
    steps.push(['Kein Teil ohne volle Standzeit', t.status === 'broken' ? 'Werkzeug gebrochen – das nächste Teil startet erst mit neuem Werkzeug.'
      : t.remainingMin != null && cut ? `Rest <b>${minTxt(t.remainingMin)}</b> = <b>${teile(t.remainingParts)}</b> à ${U.fmtNum(cut, 1)} min. Reicht er nicht, startet kein Teil – nie über 100 %.`
      : 'Ein Teil startet nur, wenn die Reststandzeit für das ganze Teil reicht.']);
    // 3 Angekündigt mit Vorlauf
    let d3;
    // Meldung: dieselbe Karte wie im Leitstand – Rolle und Zeit aus der Engine (Wenden → Schichtleitung, Tausch → Einrichter:innen)
    const nt = toolNotif(t.machineId);
    const meld = nt ? `Meldung an ${roleTxt(nt.role)} ${tclock(nt.t, now)}` : `Meldung an ${idxNext ? 'die Schichtleitung' : 'die Einrichter:innen'}`;
    if (S6[2] === 'skip') d3 = `Kein Wechsel nötig: die Schneide reicht für alle <b>${teile(t.neededParts || 0)}</b> dieses Arbeitsgangs.`;
    else if (t.announcedT) d3 = `Angekündigt <b>${tclock(t.announcedT, now)}</b> bei ≤ ${teilen(H)} Rest – ${esc(meld)}.`;
    else if (pc) d3 = `Angekündigt bei ≤ <b>${teilen(H)}</b> Rest – ${esc(meld)}.`;
    else { const p = t.proj[0]; d3 = `Bei ≤ <b>${teilen(H)}</b> Rest (Vorlauf ${idxNext ? 'bis die Bediener:in an der Maschine ist' : 'für Holen und Weg'})${p ? ` – also in ca. <b>${teilen(p.inParts)}</b>` : ''}.`; }
    steps.push(['Rechtzeitig angekündigt', d3]);
    // 4 Vermessenes Werkzeug aus der Werkzeugausgabe
    const stockTxt = `Ausgabe: <b>${ready != null ? ready : '–'} Stk</b> bereit${ready === 0 ? ` (sonst Voreinstellen +${tt.presetMin || 3} min)` : ''}`;
    let d4;
    if (t.status === 'changing') d4 = 'Vermessenes Werkzeug ist an der Maschine.';
    else if (t.status === 'due' && mv && mv.state === 'waitTool' && mv.cause) d4 = `${esc(mv.cause.replace(/^[^:]+:\s*/, ''))}. ${stockTxt}.`;
    else if (pc && pc.by) d4 = `<b>${esc(pc.by)}</b> · ${esc(pc.stage)}. ${stockTxt}.`;
    else if (pc && pc.stage === 'Werkzeug liegt bereit') d4 = 'Vermessenes Werkzeug liegt schon an der Maschine.';
    else if (q && q.stage === 0 && q.detail) d4 = `${esc(q.detail)}. ${stockTxt}.`;
    else d4 = `Einrichter:in holt ein vermessenes Werkzeug (${policy().fetchMin || 3} min). ${stockTxt}.`;
    if (idxNext && S6[3] !== 'skip' && t.status !== 'broken') {
      // Wenden statt Holen: nächste Schneide derselben Platte, an der Maschine – kein Weg zur Werkzeugausgabe
      const wn = idxName(t.machineId, pc);
      d4 = `${t.status === 'changing' ? 'Wird gerade <b>an der Maschine gewendet</b>' : `${wn ? `<b>${esc(wn)}</b>` : 'Die Bediener:in'} wendet <b>an der Maschine</b>`}: Schneide ${eg.no} → ${eg.no + 1} von ${eg.of}, ${idxDur()}, kein Gang zur Werkzeugausgabe. Erst nach der letzten Schneide kommt eine neue, vermessene Platte (${stockTxt.replace('Ausgabe: ', '')}).`;
      steps.push(['Schneide wenden statt Werkzeug holen', d4]);
    } else steps.push(['Vermessenes Werkzeug kommt', S6[3] === 'skip' ? 'Entfällt.' : d4 + (eg && eg.last && t.kind === 'insert' ? ` Letzte Schneide (${eg.no}/${eg.of}) – danach neue Platte.` : '')]);
    // 5 Wechsel an der Teilegrenze
    let d5;
    if (t.status === 'changing') d5 = esc(planText(t, now).sub || 'Wird gerade gewechselt.');
    else if (t.status === 'due') d5 = 'Standzeit erschöpft – gewechselt wird, sobald das Werkzeug da ist.';
    else if (pc && t.status === 'broken') d5 = `Nach der Reparatur an der nächsten Teilegrenze: <b>${esc(pc.text.replace(/ – Maschine steht.*$/, ''))}</b>${pc.waitFromT != null ? `. <b style="color:var(--st-wait)">Maschine wartet ab ca. ${tclock(pc.waitFromT, now)}</b>` : ''}.`;
    else if (pc) d5 = `<b>${esc(pc.text.replace(/ – Maschine steht.*$/, ''))}</b> · ${at === 0 ? 'Wechselgrenze 0 Teile: lange Schnitte werden erst getauscht, wenn kein ganzes Teil mehr geht' : `Wechselgrenze ≤ ${teilen(at)} Rest`}${pc.waitFromT != null ? `. <b style="color:var(--st-wait)">Stopp ab ca. ${tclock(pc.waitFromT, now)}</b>` : ''}.`;
    else if (t.need) { const p = t.proj[0]; d5 = p && p.t != null ? (p.waitFromT != null ? `Voraussichtlich <b>${afterTxt(p.afterPart)} · ca. ${tclock(p.t, now)}</b> – <b style="color:var(--st-wait)">Stillstand ab ca. ${tclock(p.waitFromT, now)}</b>, weil vorher niemand im Dienst ist.` : `Voraussichtlich <b>${afterTxt(p.afterPart)} · ca. ${tclock(p.t, now)}</b> – letzte Teilegrenze vor dem Stopp.`) : 'An der letzten Teilegrenze vor dem Stopp.'; }
    else d5 = `Entfällt – Arbeitsgang endet ${mv && mv.etaOpEnd ? 'ca. ' + tclock(mv.etaOpEnd, now) : 'vorher'}, danach wird neu gerüstet.`;
    steps.push(['Wechsel nur zwischen zwei Teilen', d5]);
    // 6 Mitwechseln
    const d6 = selfBundled ? `Dieses Werkzeug kommt beim Stopp von <b>${esc((grp ? grp.tools.filter(x => !(x.plannedChange && x.plannedChange.bundled)) : []).map(x => toolShort(x.name)).join(', ') || 'anderem Werkzeug')}</b> mit – ein Stopp statt zwei.`
      : bundled.length ? `<b>${esc(bundled.map(x => toolShort(x.name)).join(', '))}</b> kommt beim selben Stopp mit – ein Stopp statt zwei.`
      : `Eigener Wechsel in ≤ ${Math.round((cf.bundleSec || 1800) / 60)} min und ≤ ${Math.round((cf.bundleFrac || 0.35) * 100)} % Rest → kommt mit, wenn der Rest billiger ist als ein zweiter Stopp. Heute ${bundledToday}×.`;
    steps.push(['Fast fällige kommen mit', d6]);
    const lis = steps.map(([title, d], i) => {
      const cls = S6[i];
      const sc = (t.status === 'due' && i === 3) ? 'var(--st-wait)' : (t.status === 'broken' && i === 1) ? 'var(--st-fault)' : i === 5 ? 'var(--info)' : 'var(--st-tool)';
      const tg = tag[i] ? `<small>${esc(tag[i])}</small>` : '';
      return `<li class="tl-step ${cls}" style="--c:${sc}"><span class="tl-sn">${cls === 'done' ? icon('check', 12) : i + 1}</span><div><div class="tl-st-t">${esc(title)}${tg}</div><div class="tl-st-d">${d}</div></div></li>`;
    }).join('');
    const head = `<div class="tl-ex-tool" data-sel="tool|${esc(t.id)}" tabindex="0" role="button" title="Werkzeugdetails öffnen">
        <div class="tl-ex-tn">${chip(stLabel(t.status), c, 'dot' + (t.status === 'changing' ? ' pulse' : ''))}${eg ? `<span class="tl-idx" title="Wendeplatte: Schneide ${eg.no} von ${eg.of}">Schneide ${eg.no}/${eg.of}</span>` : ''}<span class="spacer"></span><span class="mono">${esc(t.machineId)} ${esc(mx ? mx.short : '')}</span></div>
        <b class="tl-ex-name">${esc(t.name)}</b>
        ${ladder(t, { running })}
      </div>`;
    return `<div class="tl-ex-l">${head}</div><ol class="tl-steps">${lis}</ol>`;
  }

  // ------------------------------------------------------------------ Tabelle
  function renderTable(m, force) {
    if (!m) return;
    const now = m.t;
    // Filter-Chips
    const counts = { all: 0, planned: 0, due: 0, changing: 0, broken: 0, ok: 0, other: 0 };
    for (const t of m.tools) {
      counts.all++;
      if (t.status === 'planned') counts.planned++;
      else if (t.status === 'due') counts.due++;
      else if (t.status === 'changing') counts.changing++;
      else if (t.status === 'broken') counts.broken++;
      else if (t.status === 'ok') counts.ok++;
      else counts.other++;
    }
    const fl = [['all', 'Alle', 'var(--muted)'], ['planned', 'Wechsel geplant', 'var(--st-tool)'], ['changing', 'Wird gewechselt', 'var(--st-tool)'], ['due', 'Standzeit erschöpft', 'var(--st-wait)'], ['broken', 'Gebrochen', 'var(--st-fault)'], ['ok', 'In Ordnung', 'var(--st-run)'], ['other', 'Rüsten / nicht im Einsatz', 'var(--st-idle)']];
    setHTML(R.filt, fl.map(([k, l, c]) => `<button data-f="${k}" class="${ui.filter === k ? 'on' : ''}${counts[k] ? '' : ' zero'}" style="--c:${c}"><i></i>${esc(l)} <b>${counts[k]}</b></button>`).join(''));
    let moreN = 0, moreCut = false;
    const pass = (t) => ui.filter === 'all' || (ui.filter === 'other' ? !['planned', 'due', 'changing', 'broken', 'ok'].includes(t.status) : t.status === ui.filter);
    const items = [];
    const row = (t, showM) => {
      const c = ST_C[t.status] || 'var(--st-idle)';
      const pl = planText(t, now);
      const hot = ['planned', 'due', 'changing', 'broken'].includes(t.status);
      const rest = t.remainingParts != null ? `noch ${teile(t.remainingParts)}` : '–';
      const restSub = t.remainingMin != null ? `${minTxt(t.remainingMin)} Schnittzeit` : t.status === 'idle' ? 'nicht im Arbeitsgang' : '';
      const eg = edgeOf(t);
      // Unterzeile ohne min/Teil (steht im Detail) – damit sie nicht abgeschnitten wird
      const sub = `${kindLabel(t.kind)}${eg ? ` · Schneide ${eg.no}/${eg.of}` : ` · Standzeit ${U.fmtNum(t.life)} min`}${t.dressEvery ? ` · Abrichten alle ${t.dressEvery} Teile` : ''}`;
      const mountedSec = t.mountedT != null ? now - t.mountedT : null;
      const html = `<span class="tl-slot c-slot">${t.slot ? 'T' + t.slot : '–'}</span>
        <div class="tl-tn c-n"><b title="${esc(t.name)}">${showM ? `<span class="mono" style="color:var(--muted);font-weight:500;margin-right:6px">${esc(t.machineId)}</span>` : ''}${esc(t.name)}</b><small>${esc(sub)}<span class="tl-mid">${t.mountedT != null ? ' · eingebaut ' + esc(tclock(t.mountedT, now)) : ''}${t.parts != null ? ' · ' + esc(teile(t.parts)) + ' mit Schneide' : ''}</span></small></div>
        <div class="c-w">${wearBar(t)}</div>
        <div class="tl-rest c-r r"><b>${esc(rest)}</b><small>${esc(restSub)}</small></div>
        <div class="c-st">${chip(stLabel(t.status), c, 'dot' + (t.status === 'changing' ? ' pulse' : ''))}</div>
        <div class="tl-pl c-p ${pl.cls}" title="${esc(plMain(pl) + (pl.sub ? ' – ' + pl.sub : ''))}">${plHtml(pl)}</div>
        <div class="tl-mt c-mt r">${t.mountedT != null ? esc(tclock(t.mountedT, now)) : '–'}<small>${mountedSec != null ? esc(ago(mountedSec)) : ''}</small></div>
        <div class="tl-pt c-pt r">${t.parts != null ? esc(U.fmtNum(t.parts)) : '–'}</div>`;
      const sig = html;
      return { key: 't:' + (t.id || t.machineId + t.typeId), cls: 'tl-tr' + (t.status === 'idle' ? ' idle' : '') + (hot ? ' hot' : ''), style: `--c:${c}`, attrs: { tabindex: '0', role: 'button' }, html, sig, sel: t.id ? 'tool|' + t.id : 'machine|' + t.machineId };
    };
    if (ui.sort === 'machine') {
      for (const mx of m.machines) {
        const ts = mx.tools.filter(pass); if (!ts.length) continue;
        const mv = mx.mv;
        const nx = mx.groups.find(g => g.t != null);
        const np = mx.proj.find(p => p.t != null);
        const nextTxt = nx ? `nächster Wechsel <b>${esc(tclock(nx.t, now))}</b> · ${afterTxt(nx.afterPart)}` : mx.changing ? '<b>Werkzeugwechsel läuft</b>' : np ? `voraussichtlich ca. ${esc(tclock(np.t, now))}` : mv.order ? 'kein Wechsel bis AG-Ende' : '';
        const html = `<span class="tl-gh-n">${esc(mv.short)}</span><span class="mono">${esc(mx.id)}</span>${WF.ui.pill(mv.state)}
          <span class="tl-gh-o">${mv.order ? `${esc(mv.order.id)} · AG ${mv.order.seq} ${esc(mv.order.op)} <em>· ${mv.partNo != null ? 'Teil ' + mv.partNo + ' von ' + mv.partsTotal : mv.partsDone + ' von ' + mv.partsTotal + ' fertig'}</em>` : '<em>kein Arbeitsgang</em>'}</span>
          <span class="tl-gh-x">${nextTxt}</span>`;
        items.push({ key: 'g:' + mx.id, cls: 'tl-gh', attrs: { tabindex: '0', role: 'button' }, html, sig: html, sel: 'machine|' + mx.id });
        for (const t of ts) items.push(row(t, false));
      }
    } else {
      // Dringlichste zuerst: die ersten acht, der Rest auf Wunsch (Präsentation: das Wichtige passt auf einen Blick)
      const ts = m.tools.filter(pass).slice().sort((a, b) => cmp(a.urg, b.urg));
      const cut = !ui.showAll && ts.length > TOP_N + 2;
      for (const t of (cut ? ts.slice(0, TOP_N) : ts)) items.push(row(t, true));
      moreN = ts.length; moreCut = cut;
    }
    if (!items.length) {
      setHTML(R.rows, `<div class="tl-empty"><b>Keine Werkzeuge in dieser Auswahl</b>Filter oben zurücksetzen, um alle montierten Werkzeuge zu sehen.</div>`);
      R.rows._map && R.rows._map.clear();
    } else {
      if (R.rows._h) { R.rows.innerHTML = ''; R.rows._h = null; R.rows._map && R.rows._map.clear(); }
      patchList(R.rows, items.map(it => Object.assign(it, { attrs: Object.assign({}, it.attrs, { 'data-sel': it.sel }) })));
      // data-sel kann sich ändern (Werkzeug-ID nach Wechsel)
      for (const it of items) { const n = R.rows._map.get(it.key); if (n && n.dataset.sel !== it.sel) n.dataset.sel = it.sel; }
    }
    R.rowsMore.hidden = !(ui.sort === 'urgent' && moreN > TOP_N + 2);
    setText(R.rowsMore.firstChild, moreCut ? `Alle ${moreN} Werkzeuge anzeigen` : `Nur die ${TOP_N} dringlichsten zeigen`);
    const nOther = m.tools.length - m.inUse.length;
    setText(R.tableSub, `${m.inUse.length} überwacht im Arbeitsgang${nOther ? ` · ${nOther} weitere montiert` : ''}${ui.sort === 'urgent' && moreCut ? ` · die ${TOP_N} dringlichsten` : ''}`);
    setHTML(R.tableF, `<span>Überwacht werden je Arbeitsgang die standzeitkritischen Werkzeuge (Wendeplatten, Bohrer, Fräser, Sägeband, Schleifscheibe) – die übrigen Werkzeuge im Magazin führt werkfluss nicht einzeln.</span><span>Verschleißbalken: <b style="color:var(--text2)">voll</b> = Ist, schraffiert = nach dem laufenden Teil, Strich = Wechselgrenze.</span><span>Klick auf ein Werkzeug: Begründung, Standzeit-Leiter und Lebenslauf.</span>`);
  }

  // ------------------------------------------------------------------ Werkzeugausgabe
  function renderQueue(m) {
    const now = m.t;
    const cb = m.crib, ps = cb.presetter;
    setHTML(R.crib, `<div><div class="l">Ausgabe heute</div><div class="v">${cb.issuedToday}<small>Stk</small></div></div>
      <div><div class="l">Bereit</div><div class="v">${cb.readyAll}<small>Stk</small></div></div>
      <div><div class="l">Nachschliff</div><div class="v">${cb.regrindAll}<small>Stk</small></div></div>
      <div><div class="l">Voreinstellgerät</div><div class="ps" style="--c:${ps ? 'var(--st-tool)' : 'var(--st-run)'}"><i></i><span>${ps ? `<b style="font-weight:600">${esc(ps.person || '–')}</b> stellt ${esc(ps.tools.map(toolShort).join(', ') || 'Werkzeug')} ein` : 'frei'}</span></div></div>`);
    const q = m.queue;
    const inCrib = q.filter(x => x.stage === 1 && !x.index).length;
    setText(R.qSub, q.length ? `${q.length} ${q.length === 1 ? 'Auftrag' : 'Aufträge'}${inCrib ? ' · ' + inCrib + ' gerade in der Ausgabe' : ''}` : 'keine offenen Aufträge');
    if (!q.length) {
      if (R.queue._map) { R.queue._map.clear(); R.queue.innerHTML = ''; }
      setHTML(R.queue, `<div class="tl-empty"><b>Keine offenen Werkzeugaufträge</b>Sobald ein Werkzeug nur noch für ${teile(PLAN_AT())} reicht (bzw. den Vorlauf zum Holen), erscheint hier der Auftrag an die Werkzeugausgabe.</div>`);
      return;
    }
    if (R.queue._h) { R.queue.innerHTML = ''; R.queue._h = null; }
    patchList(R.queue, q.map(it => {
      const PP = it.index ? PIPE_IDX : PIPE;
      const pipe = PP.map((_, i) => `<i class="${i < it.stage ? 'd' : i === it.stage ? 'n' : ''}"></i>`).join('');
      const lbls = PP.map((l, i) => `<span class="${i === it.stage ? 'n' : ''}">${esc(i === 1 && it.preset && !it.index ? 'Voreinstellen' : l)}</span>`).join('');
      const who = it.person || it.predicted;
      const html = `<div class="tl-qi-h"><b>${esc(it.short)}</b><span class="mono">${esc(it.machineId)}</span><span class="tl-qt" title="${esc(it.tools.join(', '))}">${it.index ? '<span class="tl-idx">Schneide wenden</span>' : ''}${esc(it.tools.map(toolShort).join(', ') || 'Werkzeugwechsel')}${it.edgeTxt ? ` <span class="tl-qe">${esc(it.edgeTxt)}</span>` : ''}</span><em>${it.etaT != null ? (it.afterPart != null ? 'nach Teil ' + it.afterPart + ' · ' : '') + 'ca. ' + esc(tclock(it.etaT, now)) : (it.index ? it.stage === 1 : it.stage === 4) ? 'läuft' : ''}</em></div>
        <div class="tl-pipe" style="grid-template-columns:repeat(${PP.length},minmax(0,1fr))">${pipe}</div><div class="tl-pipe-l" style="grid-template-columns:repeat(${PP.length},minmax(0,1fr))">${lbls}</div>
        ${it.notif ? `<div class="tl-qi-n" style="--c:${it.notif.sev === 'warn' ? 'var(--st-wait)' : 'var(--info)'}">${icon('bell', 12)}<span>Meldung an ${esc(roleTxt(it.notif.role))} ${esc(tclock(it.notif.t, now))}${it.notif.ack ? ' · quittiert' + (it.notif.ackBy ? ' von ' + esc(it.notif.ackBy) : '') : ''}</span></div>` : ''}
        <div class="tl-qi-d">${who ? `<span class="avatar${it.person ? '' : ' pred'}" title="${it.person ? 'zugeteilt' : 'Bediener:in der Maschine – wird gerufen'}">${esc(WF.ui.initials(who.replace('.', '')))}</span><span><b style="font-weight:600">${esc(who)}</b></span><span class="m">${esc(it.detail)}</span>` : `<span class="m">${esc(it.detail)}</span>`}</div>`;
      return { key: it.id, cls: 'tl-qi' + (it.urgent ? ' urgent' : ''), attrs: { tabindex: '0', role: 'button', 'data-sel': 'machine|' + it.machineId }, html, sig: html };
    }));
  }

  function renderCost(m) {
    const c = m.cost;
    const types = Object.entries(c.byType).sort((a, b) => b[1].eur - a[1].eur).slice(0, 4);
    const maxE = Math.max(1, ...types.map(x => x[1].eur));
    const mach = Object.entries(c.byMachine).sort((a, b) => b[1].eur - a[1].eur).slice(0, 4);
    const maxM = Math.max(1, ...mach.map(x => x[1].eur));
    const perPart = m.goodToday > 0 ? c.total / m.goodToday : null;
    const CATS = Object.assign({}, CAT, { setup: { label: 'Beim Rüsten', c: 'var(--muted)' } });
    const order = ['rule', 'bundled', 'manual', 'exhausted', 'break', 'setup'];
    const sumCat = order.reduce((n, k) => n + (c.byCat[k] ? c.byCat[k].eur : 0), 0);
    const other = Math.round(c.total - sumCat);
    const totBar = Math.max(1, sumCat);
    const html = `<div class="tl-cost-v"><b>${esc(U.fmtEur(c.total))}</b><span>${perPart != null ? `≈ ${esc(U.fmtNum(perPart, 2))} € je Gutteil · ${esc(U.fmtNum(m.goodToday))} Gutteile heute` : 'noch keine Gutteile heute'}</span></div>
      ${c.total > 0 ? `<div class="tl-cost-bar">${order.filter(k => c.byCat[k] && c.byCat[k].eur > 0).map(k => `<i style="--c:${CATS[k].c};width:${(c.byCat[k].eur / totBar * 100).toFixed(1)}%" title="${esc(CATS[k].label)}: ${esc(U.fmtEur(c.byCat[k].eur))}"></i>`).join('')}</div>
      <div class="tl-cost-l">${order.filter(k => c.byCat[k] && c.byCat[k].n > 0).map(k => `<span><i style="--c:${CATS[k].c}"></i>${esc(CATS[k].label)} <b>${esc(U.fmtEur(c.byCat[k].eur))}</b></span>`).join('')}${Math.abs(other) > 1 ? `<span>ohne Einzelnachweis <b>${esc(U.fmtEur(other))}</b></span>` : ''}</div>
      <div class="tl-cost-s">davon verschrottet <b>${esc(U.fmtEur(c.scrap))}</b> · Nachschliff <b>${esc(U.fmtEur(c.regrind))}</b> (25 % des Neupreises)${c.indexed > 0 ? ` · Schneiden gewendet <b>${esc(U.fmtEur(c.indexed))}</b>` : ''}</div>
      <div class="tl-cost-t"><div class="tl-cost-th"><span>Teuerste Werkzeugtypen</span></div>${types.map(([id, v]) => `<div class="tl-cost-r" data-sel="tool|${esc(id)}" role="button" tabindex="0"><span>${esc((TT(id) || {}).name || id)}<small>${v.n}×</small></span>${WF.ui.bar(v.eur / maxE, { color: NEUTRAL_BAR })}<b>${esc(U.fmtEur(v.eur))}</b></div>`).join('')}</div>
      <div class="tl-cost-t"><div class="tl-cost-th"><span>Je Maschine</span></div>${mach.map(([id, v]) => `<div class="tl-cost-r" data-sel="machine|${esc(id)}" role="button" tabindex="0"><span>${esc(stShort(id))} <small style="margin-left:2px">${esc(id)} · ${v.n} ${v.n === 1 ? 'Werkzeug' : 'Werkzeuge'}</small></span>${WF.ui.bar(v.eur / maxM, { color: NEUTRAL_BAR })}<b>${esc(U.fmtEur(v.eur))}</b></div>`).join('')}</div>`
      : '<div class="tl-empty" style="padding:6px 0 0;text-align:left">Heute wurde noch kein Werkzeug ausgebaut.</div>'}`;
    setHTML(R.cost, html);
  }

  function renderStock(m, force) {
    const s = S();
    const mounted = {};
    for (const t of m.tools) mounted[t.typeId] = (mounted[t.typeId] || 0) + 1;
    let list = P.toolTypes.map(tt => {
      const st = s.toolStock[tt.id] || { ready: 0, regrind: 0, scrapToday: 0, usedStock: 0 };
      return { tt, st, mounted: mounted[tt.id] || 0, demand: m.demand[tt.id] || 0, base: STOCK_BASE[tt.kind] != null ? STOCK_BASE[tt.kind] : 4 };
    });
    const total = list.length;
    const inUse = list.filter(x => x.mounted || x.demand || x.st.scrapToday || x.st.regrind || x.st.usedStock);
    const withNeed = list.filter(x => x.demand || x.st.ready <= 0);
    if (ui.stock === 'need') list = withNeed; else if (ui.stock === 'use') list = inUse;
    const rank = (x) => (x.st.ready <= 0 && x.demand ? 0 : x.demand > x.st.ready ? 1 : x.demand ? 2 : x.mounted ? 3 : 4);
    list.sort((a, b) => rank(a) - rank(b) || b.demand - a.demand || b.mounted - a.mounted || a.tt.name.localeCompare(b.tt.name, 'de'));
    const short = list.filter(x => x.demand > x.st.ready).length;
    ui.subStock = `Vermessen und einsatzbereit · Grundbestand wird zu Schichtbeginn aufgefüllt · ${withNeed.length} von ${total} Typen in den nächsten 4 h gebraucht${short ? ` · ${short} knapp` : ' · Bestand reicht'}`;
    if (ui.tab === 'stock') setText(R.tabSub, ui.subStock);
    setText(R.tabNS, short ? short + ' knapp' : '');
    R.tabNS.classList.toggle('warn', short > 0);
    if (!list.length) { if (R.stock._map) { R.stock._map.clear(); R.stock.innerHTML = ''; } setHTML(R.stock, '<div class="tl-empty"><b>Kein Bedarf in den nächsten 4 Stunden</b>Keine geplanten oder voraussichtlichen Werkzeugwechsel – „Im Einsatz“ zeigt den Bestand aller montierten Typen.</div>'); return; }
    if (R.stock._h) { R.stock.innerHTML = ''; R.stock._h = null; }
    patchList(R.stock, list.map(x => {
      const low = x.st.ready <= 0 || x.demand > x.st.ready;
      const nDots = Math.max(x.base, x.st.ready);
      const dots = Array.from({ length: Math.min(nDots, 10) }, (_, i) => `<i class="${i < x.st.ready ? 'f' : ''}"></i>`).join('');
      const pre = x.tt.presetMin ? x.tt.presetMin : 0;
      const ass = x.st.ready <= 0 ? (x.demand ? `<b style="color:var(--st-wait)">leer</b> – Voreinstellen +${pre || 3} min je Stk` : '<b>leer</b> – Auffüllen zu Schichtbeginn')
        : x.demand > x.st.ready ? `<b style="color:var(--st-wait)">knapp</b> – ${x.demand - x.st.ready} Stk voreinstellen (je ${pre || 3} min)`
        : x.demand ? (x.st.ready - x.demand > 0 ? `<b style="color:var(--st-run)">reicht</b> – ${x.st.ready - x.demand} Stk Reserve` : '<b style="color:var(--st-run)">reicht</b> – ohne Reserve') : '<b style="color:var(--text2)">kein Bedarf</b> in den nächsten 4 h';
      const html = `<div class="tl-tn"><b title="${esc(x.tt.name)}">${esc(x.tt.name)}</b><small>${esc(kindLabel(x.tt.kind))} · ${esc(U.fmtEur(x.tt.cost))}/Stk · Standzeit ${esc(U.fmtNum(x.tt.lifeMin))} min</small></div>
        <div class="tl-dots${low ? ' low' : ''}" title="${esc(`${x.st.ready} vermessen bereit · Grundbestand ${x.base}`)}">${dots}<b>${x.st.ready}</b></div>
        <div class="tl-dem r ${x.demand ? (x.demand > x.st.ready ? 'warn' : '') : 'z'}" title="Geplante und voraussichtliche Wechsel dieses Typs in den nächsten 4 h">${x.demand || '–'}</div>
        <div class="tl-ass c-a">${ass}</div>
        <div class="num r c-mo ${x.mounted ? '' : 'z'}">${x.mounted || '–'}</div>
        <div class="num r c-g ${x.st.usedStock ? '' : 'z'}" title="Beim Rüsten wenig verschlissen zurückgegeben">${x.st.usedStock || '–'}</div>
        <div class="num r c-ns ${x.st.regrind ? '' : 'z'}">${x.st.regrind || '–'}</div>
        <div class="num r c-s ${x.st.scrapToday ? '' : 'z'}">${x.st.scrapToday || '–'}</div>`;
      return { key: x.tt.id, cls: 'tl-sr', attrs: { tabindex: '0', role: 'button', 'data-sel': 'tool|' + x.tt.id }, html, sig: html };
    }));
  }

  // ------------------------------------------------------------------ Historie
  function catOf(x) {
    if (x.reason === 'Werkzeugbruch') return Object.assign({ key: 'break' }, CAT.break);
    if (x.manual) return Object.assign({ key: 'manual' }, CAT.manual);
    if (x.bundled) return Object.assign({ key: 'bundled' }, CAT.bundled);
    if (/erschöpft/.test(x.reason || '')) return Object.assign({ key: 'exhausted' }, CAT.exhausted);
    return Object.assign({ key: 'rule' }, CAT.rule);
  }
  function renderHistory(m, force) {
    const s = S(), now = m.t;
    const evs = m.ev24.slice().reverse();
    const cnt = { all: 0 }; for (const k in CAT) cnt[k] = 0;
    for (const e of evs) for (const x of (e.data && e.data.tools) || []) { cnt.all++; cnt[catOf(x).key]++; }
    const segHtml = [['all', 'Alle']].concat(Object.keys(CAT).map(k => [k, CAT[k].label])).filter(([k]) => k === 'all' || cnt[k] > 0 || ui.histCat === k)
      .map(([k, l]) => `<button data-hc="${k}" class="${ui.histCat === k ? 'on' : ''}">${esc(l)} ${cnt[k] || 0}</button>`).join('');
    setHTML(R.histSeg, segHtml);
    const nT = m.evToday.reduce((n, e) => n + ((e.data && e.data.tools) || []).length, 0);
    ui.subHist = 'Letzte 24 h · ' + (nT ? `heute ${nT} ${nT === 1 ? 'Werkzeug' : 'Werkzeuge'} in ${m.evToday.length} ${m.evToday.length === 1 ? 'Stopp' : 'Stopps'}` : 'heute noch kein Wechsel') + (evs.length > m.evToday.length ? ` · gestern ${evs.length - m.evToday.length} ${evs.length - m.evToday.length === 1 ? 'Stopp' : 'Stopps'}` : '') + ' · Grund, Verschleiß beim Ausbau, Verbleib und Kosten je Werkzeug';
    if (ui.tab === 'hist') setText(R.tabSub, ui.subHist);
    setText(R.tabNH, cnt.all ? String(cnt.all) : '');
    const filt = evs.filter(e => ui.histCat === 'all' || ((e.data && e.data.tools) || []).some(x => catOf(x).key === ui.histCat));
    if (!filt.length) {
      if (R.hist._map) { R.hist._map.clear(); R.hist.innerHTML = ''; }
      setHTML(R.hist, `<div class="tl-empty"><b>${evs.length ? 'Kein Wechsel mit diesem Grund' : 'Heute noch kein Werkzeugwechsel'}</b>Jeder Wechsel erscheint hier mit Grund, Verschleiß beim Ausbau, Entsorgung und Person.</div>`);
      R.histMore.hidden = true;
      return;
    }
    if (R.hist._h) { R.hist.innerHTML = ''; R.hist._h = null; }
    const shown = filt.slice(0, ui.histN);
    const items = [];
    let lastDay = Math.floor(now / DAY);
    for (const e of shown) {
      const dd = Math.floor(e.t / DAY);
      if (dd !== lastDay) { lastDay = dd; items.push({ key: 'day:' + dd, cls: 'tl-hdiv', html: `<span>${dd === Math.floor(now / DAY) - 1 ? 'Gestern' : esc(U.fmtDay(e.t))}</span>`, sig: 'd' + dd }); }
      items.push(histItem(e));
    }
    patchList(R.hist, items);
    R.histMore.hidden = filt.length <= ui.histN;
  }
  function histItem(e) {
    const s = S(), m = getModel();
    const d = e.data || {};
    const mid = e.entity ? e.entity.id : '';
    const t0 = e.t - (d.durSec || 0);
    // Hat die Maschine vorher auf das Werkzeug gewartet? (Wartesegment endet beim Wechselbeginn)
    let waited = 0;
    const mx = m.machines.find(x => x.id === mid);
    const segs = mx ? mx.mv.segments : (s.machines[mid] ? s.machines[mid].segments : []);
    for (const sg of segs || []) if (sg.state === 'waitTool' && sg.t1 != null && Math.abs(sg.t1 - t0) < 15) waited += sg.t1 - sg.t0;
    const html = `<div class="tl-he-t">${esc(U.fmtClock(t0))}<small>${esc(U.fmtDur(d.durSec || 0))}</small></div>
      <div style="min-width:0"><div class="tl-he-h"><button class="link" data-sel="machine|${esc(mid)}">${esc(stShort(mid))} <span class="mono">${esc(mid)}</span></button><span>${d.index ? 'Schneide gewendet an der Maschine · ' : ''}durch ${esc(pName(d.by))}</span>${waited > 30 ? `<span class="tl-wait">Maschine wartete ${esc(U.fmtDur(waited))}</span>` : ''}${d.firstPieceAfter ? '<span>danach Kontrolle des ersten Teils an der Maschine</span>' : ''}</div>
      ${(d.tools || []).map(x => {
        const ct = catOf(x);
        const old = x.oldToolId ? s.tools[x.oldToolId] : null;
        const cost = old && old.cost != null ? old.cost : null;
        const rest = x.reason === 'Werkzeugbruch' ? 'gebrochen' : x.rem != null ? (x.rem > 0 ? `Rest ${teile(x.rem)}` : 'Rest 0 Teile') : '';
        // Wenden: Platte bleibt in der Maschine, nur die Schneide ist verbraucht (Kosten je Schneide)
        const disp = x.action === 'index' ? `gewendet · Schneide ${x.edgeFrom} → ${x.edgeTo}/${x.edges}` : (x.disposal || '');
        return `<div class="tl-hx" data-sel="tool|${esc(x.oldToolId || x.typeId)}" title="${esc(x.reason + (x.disposal ? ' · ' + x.disposal : ''))}"><span class="tl-hn">${esc(x.name)}</span><span class="tl-hc">${chip(ct.label, ct.c, 'dot')}</span><span class="tl-hw">${wearBar({ wearPct: x.wearPct, status: 'planned' }, ct.c)}</span><span class="tl-hd">${esc(rest)}${rest ? ' · ' : ''}${esc(disp)}${cost != null ? ` · <b>${esc(U.fmtEur(cost, cost < 10 ? 1 : 0))}</b>` : ''}</span></div>`;
      }).join('')}</div>`;
    return { key: e.id, cls: 'tl-he', html, sig: html };
  }

  // ------------------------------------------------------------------ Registrierung Ansicht
  WF.registerView({
    id: 'werkzeuge', title: 'Werkzeuge', icon: 'wrench', group: 'ressourcen', order: 5,
    mount,
    show() { lastT = -1; if (R.plan) { R.plan._sig = null; R.plan._lv = null; } },
    hide() { hideTip(); },
    update,
    badge() {
      const s = S(); if (!s) return '';
      let n = 0;
      for (const id in s.tools) { const tl = s.tools[id]; if (tl.state === 'mounted' && (tl.plannedT != null || tl.broken)) n++; }
      return n ? String(n) : '';
    },
  });

  // ------------------------------------------------------------------ Detail „tool“
  function findToolView(id) {
    const s = S(); if (!s) return null;
    const tl = s.tools[id];
    if (!tl) return null;
    if (tl.state === 'mounted' && tl.machineId) {
      const mv = WF.sim.machineView(tl.machineId);
      const tv = mv && mv.tools.find(t => t.id === id);
      if (tv) {
        const m = getModel();
        const mx = m && m.machines.find(x => x.id === tl.machineId);
        const tx = mx && mx.tools.find(t => t.id === id);
        return { kind: 'mounted', tl, mv, tv: tx || tv, mx };
      }
    }
    return { kind: 'dismounted', tl };
  }
  function lifeEvents(id) {
    const s = S(); const out = [];
    for (const e of s.events) {
      const d = e.data; if (!d) continue;
      if (e.type === 'toolPlanned' && d.toolId === id) out.push({ t: e.t, c: 'var(--st-tool)', txt: e.msg.replace(/^M\d+:\s*/, '') });
      else if (e.type === 'toolChanged' && d.tools) {
        for (const x of d.tools) {
          if (x.newToolId === id) out.push({ t: e.t, c: 'var(--st-run)', txt: x.action === 'index' ? `<b>Gewendet</b> an ${esc(e.entity.id)} durch ${esc(pName(d.by))} – Schneide ${x.edgeFrom} → <b>${x.edgeTo}/${x.edges}</b> (${esc(catOf(x).label)}, vorherige Schneide ${pct(x.wearPct, 0)})` : `<b>Eingebaut</b> an ${esc(e.entity.id)} durch ${esc(pName(d.by))} – ersetzt ${esc(x.name)} (${esc(catOf(x).label)}, ${pct(x.wearPct, 0)} Verschleiß)`, html: true });
          if (x.oldToolId === id) out.push({ t: e.t, c: x.reason === 'Werkzeugbruch' ? 'var(--st-fault)' : 'var(--st-tool)', txt: x.action === 'index' ? `<b>Schneide ${x.edgeFrom}/${x.edges} verbraucht</b> – ${esc(pName(d.by))} wendet auf Schneide ${x.edgeTo}; ${esc(x.reason)}; Verschleiß ${pct(x.wearPct, 0)}` : `<b>Ausgebaut</b> durch ${esc(pName(d.by))} – ${esc(x.reason)}; Verschleiß ${pct(x.wearPct, 0)} → ${esc(x.disposal)}`, html: true });
        }
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  WF.registerDetail('tool', (id) => {
    if (/^TT-/.test(id)) return typeDetail(id);
    const v0 = findToolView(id);
    const tl0 = v0 ? v0.tl : null;
    const title = tl0 ? tl0.name : id;
    const sub = tl0 ? `<span class="mono">${esc(id)}</span> · ${esc(kindLabel(tl0.kind))}${tl0.machineId ? ' · ' + esc(stShort(tl0.machineId)) + ' (' + esc(tl0.machineId) + ')' : tl0.lastMachine ? ' · zuletzt ' + esc(tl0.lastMachine) : ''}` : 'Werkzeug';
    let sig = '';
    const draw = (el) => {
      const v = findToolView(id);
      const now = WF.sim.t;
      if (!v) { el.innerHTML = `<div class="tl-empty"><b>Werkzeug nicht mehr im Speicher</b>Die letzten 150 ausgebauten Werkzeuge werden aufbewahrt.</div>`; return; }
      const nsig = v.kind === 'mounted' ? [v.tv.status, v.tv.wearPct, v.tv.remainingParts, JSON.stringify(v.tv.plannedChange), v.tv.explain, v.mv.partNo, Math.floor(now / 60), (v.tv.proj || []).map(p => p.afterPart).join()].join('|') : [v.tl.state, Math.floor(now / 300)].join('|');
      if (nsig === sig) return;
      sig = nsig;
      el.innerHTML = v.kind === 'mounted' ? mountedHtml(v, now) : dismountedHtml(v, now);
    };
    return {
      title, subtitle: sub,
      askPrompt: `Erkläre mir das Werkzeug ${title} (${id})${tl0 && tl0.machineId ? ' an ' + tl0.machineId : ''}: Wie ist der Verschleiß, wann und warum wird es gewechselt, wer holt es und was kostet es?`,
      render(el) { sig = ''; draw(el); el.addEventListener('click', (e) => { const n = e.target.closest('[data-sel]'); if (n) { const [k, i] = n.dataset.sel.split('|'); WF.app.select(k, i); } }); },
      update(el) { draw(el); },
    };
  });

  function mountedHtml(v, now) {
    const { tv, mv, tl } = v;
    const c = ST_C[tv.status] || 'var(--st-idle)';
    const tt = TT(tl.typeId) || {};
    const running = mv.partNo != null;
    const pl = planText(tv, now);
    const perLife = tv.cutMinPerPart ? Math.floor(tv.life / tv.cutMinPerPart + 1e-9) : null;
    const eg = edgeOf(tv);
    const idxNext = !!eg && !eg.last && tl.kind === 'insert' && !tl.broken;
    const costPart = perLife ? tt.cost / (eg ? eg.of : 1) / perLife : null;
    const st = S().toolStock[tl.typeId] || {};
    const disp = tl.broken ? `verschrottet – Bruch (${U.fmtEur(tt.cost)})` : idxNext ? `wird an der Maschine gewendet → Schneide ${eg.no + 1}/${eg.of} (Schneide ca. ${U.fmtEur(tt.cost / eg.of, 1)})` : tl.kind === 'insert' || tl.kind === 'saw' || tl.kind === 'wheel' ? `verschrottet (${U.fmtEur(tt.cost)})${eg ? ' – letzte Schneide' : ''}` : `zum Nachschliff (ca. ${U.fmtEur(Math.round(tt.cost * 0.25))})`;
    const life = lifeEvents(tl.id);
    const mountedEv = life.some(x => /Eingebaut/.test(x.txt));
    const rows = [
      ['Werkzeugtyp', `<span class="mono">${esc(tl.typeId)}</span> · ${esc(kindLabel(tl.kind))}`],
      ['Maschine', `<button class="link" data-sel="machine|${esc(mv.id)}">${esc(mv.short)} (${esc(mv.id)})</button>${tv.slot ? ' · Platz T' + tv.slot : ''}`],
      ['Arbeitsgang', mv.order ? `<button class="link" data-sel="order|${esc(mv.order.id)}">${esc(mv.order.id)}</button> · AG ${mv.order.seq} ${esc(mv.order.op)}` : '–'],
      ['Eingebaut', `${esc(tclock(tl.mountedT, now))} (${esc(ago(now - tl.mountedT))})`],
      ['Teile mit dieser Schneide', esc(U.fmtNum(tl.parts))],
      ...(eg ? [['Wendeplatte', `Schneide <b>${eg.no}</b> von ${eg.of}${idxNext ? ' – nächster Wechsel: wenden an der Maschine, kein Gang zur Werkzeugausgabe' : ' – letzte Schneide, danach neue Platte'}`]] : []),
      ['Wechselgrenze', tv.changeAtParts != null ? `≤ ${esc(teile(tv.changeAtParts))} Rest${tv.planWearPct != null ? ' (ab ca. ' + pct(tv.planWearPct, 0) + ' Verschleiß)' : ''}` : '–'],
      ['Planungsvorlauf', tv.planHorizonParts != null ? esc(teile(tv.planHorizonParts)) + (idxNext ? ' (bis die Bediener:in an der Maschine ist)' : ' (Holen + Weg)') : '–'],
      ['Bedarf im Arbeitsgang', tv.neededParts != null ? esc(teile(tv.neededParts)) + (tv.need ? ' – Schneide reicht nicht' : ' – Schneide reicht') : '–'],
      ['Nach dem Ausbau', esc(disp)],
      ['Werkzeugausgabe', `${st.ready != null ? st.ready : '–'} vermessen bereit${st.regrind ? ` · ${st.regrind} im Nachschliff` : ''}`],
    ];
    if (tv.dressEvery) rows.splice(5, 0, ['Abrichten', `alle ${tv.dressEvery} Teile · seit letztem Abrichten ${tv.sinceDress != null ? teile(tv.sinceDress) : '–'}`]);
    const rp = tv.remainingParts;
    // Standzeit-Leiter nur, wenn sie etwas zeigt: Schnittzeit je Teil bekannt (sonst steht alles schon im Kopf)
    const showLadder = tv.cutMinPerPart > 0 && tv.life > 0;
    return `<section class="tl-d-hero">
        <div class="tl-d-top">
          <div class="tl-d-kv"><div class="v">${esc(U.fmtNum(tv.wearPct, 0))}<small>%</small></div><div class="l">Verschleiß${tv.wearAfterPartPct != null && tv.wearAfterPartPct > tv.wearPct && running ? ` · nach dem Teil ${esc(pct(tv.wearAfterPartPct, 0))}` : ''}</div></div>
          <div class="tl-d-kv"><div class="v">${rp != null ? esc(U.fmtNum(rp)) + `<small>${rp === 1 ? 'Teil' : 'Teile'}</small>` : '–'}</div><div class="l">${rp != null ? 'Reststandzeit' + (tv.remainingMin != null ? ' · ' + esc(minTxt(tv.remainingMin)) : '') : 'Reststandzeit unbekannt'}</div></div>
          <div class="tl-d-st">${chip(stLabel(tv.status), c, 'dot' + (tv.status === 'changing' ? ' pulse' : ''))}</div></div>
        <div class="tl-d-box" style="--c:${c}"><div class="tl-d-box-h">${icon('info', 14)}<span>Warum?</span></div><div>${esc(tv.explain || '–')}</div></div>
      </section>
      ${showLadder ? `<section><h4>Standzeit je Teil</h4><div class="tl-d-card">${ladder(tv, { running })}</div></section>` : ''}
      <section><h4>Nächster Wechsel</h4><div class="tl-d-card"><div class="tl-pl full ${pl.cls}" style="--c:${c}">${plHtml(pl)}</div>
        ${(tv.proj || []).filter(p => p.kind === 'next').slice(0, 3).map(p => `<div class="tl-lad-k">Folgewechsel voraussichtlich ${afterTxt(p.afterPart)}${p.t != null ? ' · ca. ' + esc(tclock(p.t, now)) : ''}</div>`).join('')}</div></section>
      <section class="tl-d-grid">
        <div><div class="l">Standzeit</div><div class="v">${esc(U.fmtNum(tv.life))}<small>min</small></div></div>
        <div><div class="l">Je Teil</div><div class="v">${tv.cutMinPerPart != null ? esc(U.fmtNum(tv.cutMinPerPart, 1)) : '–'}<small>min</small></div></div>
        <div><div class="l">Teile/Schneide</div><div class="v">${perLife != null ? esc(U.fmtNum(perLife)) : '–'}</div></div>
        <div><div class="l">Kosten/Teil</div><div class="v">${costPart != null ? esc(U.fmtNum(costPart, 2)) : '–'}<small>€</small></div></div>
      </section>
      <section><h4>Stammdaten</h4><dl class="dl">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${r[1]}</dd>`).join('')}</dl></section>
      <section><h4>Lebenslauf</h4><div class="tl-life">${(mountedEv ? '' : `<div class="tl-lf" style="--c:var(--st-setup)"><span class="num">${esc(U.fmtClock(tl.mountedT))}</span><i></i><span><b>Eingebaut</b>${tl.mountedT <= (S().startT || 0) + 1 ? ' – war bei Schichtbeginn bereits montiert' : ' beim Rüsten (neu vermessen)'}</span></div>`) +
        life.map(x => `<div class="tl-lf" style="--c:${x.c}"><span class="num">${esc(U.fmtClock(x.t))}</span><i></i><span>${x.html ? x.txt : esc(x.txt)}</span></div>`).join('') +
        `<div class="tl-lf" style="--c:var(--accent)"><span class="num">${esc(U.fmtClock(now))}</span><i></i><span><b>Jetzt</b> · ${esc(pct(tv.wearPct, 0))} Verschleiß · ${esc(teile(tl.parts))} gefertigt</span></div>`}</div></section>`;
  }
  /** Ausgebautes Werkzeug: ein Feld je Teil, das die Schneide geschafft hätte – gefertigt vs. ungenutzt.
      Nur wenn die Schnittzeit je Teil sicher ableitbar ist (nach Simulationsstart neu eingebaut, kein Bruch). */
  function usedLadder(tl) {
    const S0 = S();
    if (!tl || tl.broken || !(tl.parts >= 5) || !(tl.life > 0) || !(tl.used > 0)) return '';
    if (tl.mountedT == null || tl.mountedT <= ((S0 && S0.startT) || 0) + 1) return '';
    const cut = tl.used / tl.parts, N = tl.life / cut, n = Math.floor(N + 1e-9);
    if (n < tl.parts || n > 44) return '';
    let cells = '';
    for (let i = 0; i < n; i++) cells += `<i class="${i < tl.parts ? 'u' : ''}" title="Teil ${i + 1} mit dieser Schneide"></i>`;
    const waste = N - n;
    if (waste > 0.04) cells += `<i class="w" style="width:${Math.max(3, waste / N * 100).toFixed(1)}%" title="Rest unter einem Teil – nicht nutzbar"></i>`;
    const left = n - tl.parts;
    return `<div class="tl-lad" style="--c:var(--st-tool)"><div class="tl-lad-bar">${cells}</div><div class="tl-lad-ax"><span class="s">0</span><span class="e" style="left:100%">${esc(U.fmtNum(n))} Teile möglich</span></div>
      <div class="tl-lad-k"><span><i class="u"></i>gefertigt (${esc(teile(tl.parts))})</span>${left > 0 ? `<span><i></i>ungenutzt (${esc(teile(left))})</span>` : ''}<span>je Teil ca. ${esc(minTxt(cut))}</span></div></div>`;
  }
  function dismountedHtml(v, now) {
    const tl = v.tl;
    const tt = TT(tl.typeId) || {};
    const wear = tl.used / tl.life * 100;
    const stl = WF.sim.label('toolState', tl.state);
    const c = tl.state === 'scrap' ? 'var(--st-fault)' : tl.state === 'regrind' || tl.state === 'indexed' ? 'var(--st-setup)' : 'var(--st-idle)';
    const life = lifeEvents(tl.id);
    const edges = tl.edges || 1;
    const stay = tl.state === 'indexed' ? `gewendet → ${(tl.edge || 1) + 1}/${edges}` : tl.state === 'scrap' ? 'verschrottet' : tl.state === 'regrind' ? 'Nachschliff' : tl.state === 'stock-used' ? 'zurück ins Lager' : stl;
    const lad = usedLadder(tl);
    return `<section class="tl-d-hero">
        <div class="tl-d-top">
          <div class="tl-d-kv"><div class="v">${esc(U.fmtNum(wear, 0))}<small>%</small></div><div class="l">Verschleiß beim Ausbau</div></div>
          <div class="tl-d-kv"><div class="v">${esc(U.fmtNum(tl.parts))}<small>${tl.parts === 1 ? 'Teil' : 'Teile'}</small></div><div class="l">mit dieser Schneide gefertigt</div></div>
          <div class="tl-d-st">${chip(stl, c, 'dot')}</div></div>
        <div class="tl-d-box" style="--c:${c}"><div class="tl-d-box-h">${icon('info', 14)}<span>Ausgebaut ${esc(tclock(tl.dismountT, now))} an ${esc(tl.lastMachine || '–')}</span></div><div>Grund: <b>${esc(tl.reason || '–')}</b>. Verbleib: ${esc(tl.disposal || stl)}${tl.cost ? ` – Kosten <b>${esc(U.fmtEur(tl.cost))}</b>` : ''}.</div></div>
      </section>
      <section><h4>Standzeit</h4><div class="tl-d-grid tl-d-stat3">
          <div><div class="l">Genutzt</div><div class="v">${esc(U.fmtNum(tl.used, tl.used < 100 ? 1 : 0))}<small>/ ${esc(U.fmtNum(tl.life))} min</small></div></div>
          <div><div class="l">Im Einsatz</div><div class="v">${esc(U.fmtDur(tl.dismountT - tl.mountedT))}</div></div>
          <div><div class="l">Verbleib</div><div class="v t">${esc(stay)}</div></div></div>
        ${lad ? `<div class="tl-d-card" style="margin-top:8px">${lad}</div>` : ''}</section>
      <section><h4>Stammdaten</h4><dl class="dl">
        <dt>Werkzeugtyp</dt><dd><button class="link" data-sel="tool|${esc(tl.typeId)}">${esc(tt.name || tl.typeId)}</button></dd>
        <dt>Maschine</dt><dd>${tl.lastMachine ? `<button class="link" data-sel="machine|${esc(tl.lastMachine)}">${esc(stShort(tl.lastMachine))} (${esc(tl.lastMachine)})</button>` : '–'}</dd>
        <dt>Eingebaut – ausgebaut</dt><dd>${esc(tclock(tl.mountedT, now))} – ${esc(tclock(tl.dismountT, now))}</dd>
        ${edges > 1 ? `<dt>Wendeplatte</dt><dd>Schneide ${esc(String(tl.edge || 1))} von ${esc(String(edges))}</dd>` : ''}
        <dt>Neupreis</dt><dd>${esc(U.fmtEur(tt.cost))}</dd></dl></section>
      ${life.length ? `<section><h4>Lebenslauf</h4><div class="tl-life">${life.map(x => `<div class="tl-lf" style="--c:${x.c}"><span class="num">${esc(U.fmtClock(x.t))}</span><i></i><span>${x.html ? x.txt : esc(x.txt)}</span></div>`).join('')}</div></section>` : ''}`;
  }
  function typeDetail(typeId) {
    const tt = TT(typeId);
    if (!tt) return null;
    let sig = '';
    const draw = (el) => {
      const s = S(), now = s.t, m = getModel();
      const st = s.toolStock[typeId] || {};
      const inst = m ? m.tools.filter(t => t.typeId === typeId) : [];
      const dem = m ? (m.demand[typeId] || 0) : 0;
      const changes = m ? m.evToday.reduce((n, e) => n + ((e.data && e.data.tools) || []).filter(x => x.typeId === typeId).length, 0) : 0;
      const nsig = [st.ready, st.regrind, st.scrapToday, st.usedStock, inst.map(t => t.id + t.status + t.wearPct).join(), dem, changes].join('|');
      if (nsig === sig) return; sig = nsig;
      const base = STOCK_BASE[tt.kind] != null ? STOCK_BASE[tt.kind] : 4;
      const short = dem > (st.ready || 0);
      el.innerHTML = `<section class="tl-d-hero"><div class="tl-d-top">
          <div class="tl-d-kv"><div class="v">${st.ready != null ? st.ready : '–'}<small>Stk</small></div><div class="l">vermessen bereit</div></div>
          <div class="tl-d-kv"><div class="v"${short ? ' style="color:var(--st-wait)"' : ''}>${dem}<small>Stk</small></div><div class="l">Bedarf 4 h · ${short ? 'knapp – Voreinstellen einplanen' : 'Bestand reicht'}</div></div></div>
          <div class="tl-d-box" style="--c:var(--info)"><div class="tl-d-box-h">${icon('info', 14)}<span>Werkzeugausgabe</span></div><div>Grundbestand ${base} Stk wird zu jedem Schichtbeginn vorvermessen aufgefüllt. Ist kein vermessenes Werkzeug vorrätig, stellt die Einrichter:in eines am Voreinstellgerät ein (+${tt.presetMin || 3} min Vorlauf).</div></div></section>
        <section class="tl-d-grid">
          <div><div class="l">Standzeit</div><div class="v">${esc(U.fmtNum(tt.lifeMin))}<small>min</small></div></div>
          <div><div class="l">Neupreis</div><div class="v">${esc(U.fmtNum(tt.cost))}<small>€</small></div></div>
          <div><div class="l">Nachschliff</div><div class="v">${st.regrind || 0}</div></div>
          <div><div class="l">Verschrottet</div><div class="v">${st.scrapToday || 0}<small>heute</small></div></div></section>
        <section><h4>Im Einsatz (${inst.length})</h4>${inst.length ? `<div class="tl-inst">${inst.map(t => `<button data-sel="tool|${esc(t.id)}"><span><b style="font-weight:600">${esc(t.machineId)}</b> ${esc(t.machineShort)}</span>${wearBar(t)}${chip(stLabel(t.status), ST_C[t.status] || 'var(--st-idle)', 'dot')}</button>`).join('')}</div>` : '<div class="muted" style="font-size:var(--fs-sm)">Derzeit in keiner Maschine montiert.</div>'}</section>
        <section><h4>Stammdaten</h4><dl class="dl"><dt>Typ</dt><dd><span class="mono">${esc(typeId)}</span> · ${esc(kindLabel(tt.kind))}</dd><dt>Wechsel heute</dt><dd>${changes}</dd><dt>Gebraucht zurück</dt><dd>${st.usedStock || 0} (beim Rüsten wenig verschlissen zurückgegeben)</dd><dt>Voreinstellzeit</dt><dd>${tt.presetMin ? tt.presetMin + ' min' : 'keine (direkt einsetzbar)'}</dd>${tt.dressEvery ? `<dt>Abrichten</dt><dd>alle ${tt.dressEvery} Teile</dd>` : ''}</dl></section>`;
    };
    return {
      title: tt.name, subtitle: `<span class="mono">${esc(typeId)}</span> · ${esc(kindLabel(tt.kind))} · Werkzeugtyp`,
      askPrompt: `Wie steht es um den Werkzeugtyp ${tt.name}: Bestand in der Werkzeugausgabe, Bedarf in den nächsten Stunden und Kosten heute?`,
      render(el) { sig = ''; draw(el); el.addEventListener('click', (e) => { const n = e.target.closest('[data-sel]'); if (n) { const [k, i] = n.dataset.sel.split('|'); WF.app.select(k, i); } }); },
      update(el) { draw(el); },
    };
  }

  // ------------------------------------------------------------------ Öffentlich
  WF.tools = {
    /** abgeleitetes Werkzeugmodell (Maschinen, Werkzeuge mit Projektion, Kennzahlen, Aufträge an die Werkzeugausgabe) */
    model: () => getModel(),
    /** geplante (Engine) und voraussichtliche Wechsel einer Maschine im Zeitfenster [jetzt, jetzt + sec] */
    planFor(machineId, sec = 4 * 3600) {
      const m = getModel(); if (!m) return [];
      const mx = m.machines.find(x => x.id === machineId); if (!mx) return [];
      const end = m.t + sec, out = [];
      for (const g of mx.groups) if (g.t != null && g.t <= end) out.push({ kind: g.later ? 'geplant (Folgewechsel)' : 'geplant', t: g.t, afterPart: g.afterPart, tools: g.tools.map(t => t.name), by: g.by, stage: g.stage });
      for (const p of mx.proj) if (p.t != null && p.t <= end) out.push({ kind: 'voraussichtlich', t: p.t, afterPart: p.afterPart, tools: p.members.map(mb => mb.s.tx.name), bundled: p.members.filter(mb => mb.bundled).map(mb => mb.s.tx.name), by: null, stage: null, waitFromT: p.waitFromT });
      return out.sort((a, b) => a.t - b.t);
    },
    /** Kennzahlen der Werkzeugansicht (gleiche Zahlen wie im Kopf der Ansicht) */
    summary() {
      const m = getModel(); if (!m) return null;
      return { inUse: m.inUse.length, changesToday: m.changesToday, stopsToday: m.stops, planned2h: m.plan2Tools, projected2h: m.proj2.length, waitToolSec: m.waitSec, toolCostToday: m.cost.total };
    },
    /** dringlichstes Werkzeug (wie in der Erklärkarte) */
    mostUrgent: () => { const m = getModel(); return m ? urgentTool(m) : null; },
  };
})();
