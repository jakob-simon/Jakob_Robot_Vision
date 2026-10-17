/* werkfluss – KI-Schicht (60_ai.js): WF.ai, Copilot-Panel, Schichtbriefing, „Ursache analysieren“.
   ----------------------------------------------------------------------------------------------------
   Zwei Betriebsarten, gleiche Oberfläche:
     „Claude · live“  – veröffentlicht auf claude.ai über die Artifact-Capability `sample`
                        (window.claude.use('sample')). Leitender user-Turn mit Produkt, Fabrik, Regeln und
                        kompakter Lageübersicht (WF.sim.snapshot); Details liest Claude über Werkzeuge
                        (get_machine, get_order …), Aktionen (trigger_fault, set_priority …) laufen nur nach
                        Bestätigung im Panel. Aufruf nur auf ausdrückliche Nutzeraktion (Senden, Vorschlag).
     „Offline-Modus“  – lokal geöffnet, ohne Freigabe oder bei Fehlern: regelbasierter Agent, der die häufigen
                        Fragen aus denselben Live-Daten beantwortet (Lage, Termine, Engpass, Maschine, Auftrag,
                        Werkzeuge, Material, Personal, Qualität, Kosten/Energie, Was-wäre-wenn, Schichtübergabe,
                        Aktionen) – immer mit Datenbasis und, wo sinnvoll, Aktionsvorschlag zum Bestätigen.
   Nur lesen (WF.sim.*), handeln über WF.sim.actions / WF.app.runAction.
   Der Agent-Kern ist DOM-frei (Node-testbar): WF.ai.offlineAnswer(text, context), WF.ai.briefing(). */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' && window ? window : globalThis;
  const WF = G.WF;
  if (!WF || !WF.util) return;
  const U = WF.util;
  const HAS_DOM = typeof document !== 'undefined';
  const esc = (s) => WF.ui.esc(s);
  const icon = (n, s) => WF.ui.icon(n, s);
  const DAY = 86400, WEEK = 7 * DAY;
  const S = () => (WF.sim ? WF.sim.state : null);
  const NOW = () => (WF.sim ? WF.sim.t : 0);
  const PROF = () => WF.profile;

  const TARGET_OEE = 0.75;
  const WAIT = { waitTool: 1, waitOperator: 1, starved: 1, blocked: 1 };
  const SETUPISH = { setup: 1, firstPiece: 1, toolchange: 1 };
  const LOSS_STATES = ['setup', 'firstPiece', 'toolchange', 'waitTool', 'waitOperator', 'starved', 'blocked', 'fault'];
  const TYPE_GROUP = { lathe: 'turn', swiss: 'turn', biglathe: 'turn', mill5: 'mill', mill3: 'mill' };

  // ================================================================== Formatierung
  const nm = (n, d) => U.fmtNum(n, d || 0);
  const eur = (n) => U.fmtEur(n);
  const pct = (x, d) => U.fmtPct(x, d == null ? 0 : d);
  const durR = (sec) => (sec == null ? '–' : U.fmtDur(sec < 60 ? sec : Math.round(sec / 60) * 60));
  const clk = (t) => U.fmtClock(t);
  /** gleicher Tag → „08:45“, sonst „Di 08:45“ */
  const tc = (t) => (t == null ? '–' : Math.floor(t / DAY) === Math.floor(NOW() / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  /** „heute 13:30“ / „morgen 10:00“ / „Mi 14:00“ */
  const dueTxt = (t) => (t == null ? '–' : U.fmtDue(t, NOW()));
  const pl = (n, one, many) => nm(n) + ' ' + (n === 1 ? one : many);
  const teile = (n) => pl(n, 'Teil', 'Teile');
  const stk = (n) => nm(n) + ' Stk';
  const sn = (name) => { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(name || ''); };
  const custShort = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+(GmbH|AG|KG|OG|GesmbH)\b\.?/g, '').trim();
  const toolShort = (n) => String(n || '').replace(/\s*\([^)]*\)/g, '').trim();
  const stLabel = (k) => (WF.STATE[k] || {}).label || k;
  const station = (id) => PROF().stationById[id];
  const mName = (id) => { const s = station(id); return s ? id + ' ' + s.short : String(id); };
  const lc1 = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);
  const uc1 = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const trimTxt = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const matDec = (mt) => (mt && mt.unit === 'm' ? 1 : 0);
  const matQty = (mt, q) => nm(q, matDec(mt)) + ' ' + (mt ? mt.unit : '');
  const label = (g, k) => (WF.sim && WF.sim.label ? WF.sim.label(g, k) : k);
  const listJoin = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' und ' + arr[arr.length - 1]);

  // ================================================================== Arbeitszeit-Kalender (Schichten ohne Pausen)
  let WW = null;
  function workWindows() {
    if (WW) return WW;
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of PROF().shifts) {
      let a = U.hm(sh.start);
      for (const b of sh.breaks) { const b0 = U.hm(b[0]), b1 = U.hm(b[1]); if (b0 > a) w.push([d * DAY + a, d * DAY + b0]); a = b1; }
      const e = U.hm(sh.end); if (e > a) w.push([d * DAY + a, d * DAY + e]);
    }
    return (WW = w.sort((x, y) => x[0] - y[0]));
  }
  /** Arbeitszeit ab t addieren (wie die Engine-Prognose) */
  function addWork(t, sec) {
    if (!(sec > 0)) return t;
    const W = workWindows();
    let base = Math.floor(t / WEEK) * WEEK;
    for (let g = 0; g < 60; g++) {
      for (const w of W) {
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
  /** Arbeitszeit (s) im Intervall [a, b] */
  function workBetween(a, b) {
    if (!(b > a)) return 0;
    const W = workWindows();
    let sum = 0, base = Math.floor(a / WEEK) * WEEK;
    for (let g = 0; g < 20; g++) {
      for (const w of W) {
        const x = base + w[0], y = base + w[1];
        if (y <= a) continue;
        if (x >= b) return sum;
        sum += Math.min(y, b) - Math.max(x, a);
      }
      base += WEEK;
    }
    return sum;
  }

  // ================================================================== Daten je Anfrage (gecacht)
  function data() {
    const c = { t: NOW() };
    const mvs = {}, ovs = {};
    let fc = null, k = null;
    c.mv = (id) => { if (!(id in mvs)) { try { mvs[id] = WF.sim.machineView(id); } catch (e) { mvs[id] = null; } } return mvs[id]; };
    c.mvs = () => PROF().machines.map(c.mv).filter(Boolean);
    c.ov = (id) => { if (!(id in ovs)) { try { ovs[id] = WF.sim.orderView(id); } catch (e) { ovs[id] = null; } } return ovs[id]; };
    c.ovs = () => Object.keys(S().orders).sort().map(c.ov).filter(Boolean);
    c.open = () => c.ovs().filter(o => o.status !== 'fertig');
    c.fc = () => fc || (fc = WF.sim.forecast());
    c.k = () => k || (k = WF.sim.kpis());
    c.notifs = () => (S().notifications || []).filter(n => n.status !== 'resolved');
    return c;
  }
  const curOp = (o) => (o ? o.ops.find(op => !op.complete && op.station !== 'VERSAND') || null : null);
  /** Person, die die Störung repariert, und Restdauer (wie die Engine-Prognose: laufende Reparatur oder Erfahrungswert + Anfahrt) */
  function faultInfo(mv) {
    const f = mv && mv.fault; if (!f) return null;
    let tk = null;
    for (const id in S().tasks) { const x = S().tasks[id]; if (x.type === 'repair' && x.machineId === mv.id) { tk = x; break; } }
    const p = tk && tk.assignee ? S().people[tk.assignee] : null;
    const working = !!(p && tk.workStarted && p.workRem > 0);
    const rem = working ? p.workRem : f.repairSec + 300;
    let who;
    if (working) who = `${sn(p.name)} repariert (noch ca. ${durR(p.workRem)})`;
    else if (p) who = `${sn(p.name)} (${p.role}) ist unterwegs`;
    else who = 'wartet auf Instandhaltung (wird zugeteilt, sobald jemand frei ist)';
    return { f, person: p, working, rem, who, endT: NOW() + rem };
  }
  /** Ort einer Person (wie die Engine: Pause, unterwegs, an Maschine, Werkzeugausgabe, Messraum) */
  function personWhere(p) {
    if (!p) return '';
    if (p.state === 'offShift') return 'nicht im Dienst';
    if (p.state === 'break') return 'in der Pause';
    const tk = p.task;
    if (tk && tk.steps) {
      const s = tk.steps[tk.si];
      if (s && (s.k === 'walk' || s.k === 'drive') && p.state !== 'working') return 'unterwegs zu ' + (WF.sim.stationName ? WF.sim.stationName(s.to) : s.to);
      let at = null;
      for (let k = tk.si; k >= 0; k--) if (tk.steps[k] && tk.steps[k].to) { at = tk.steps[k].to; break; }
      if (at === 'CRIB') return 'in der Werkzeugausgabe';
      if (at === 'QS') return 'im Messraum';
      if (at && S().machines[at]) return 'an ' + at;
      if (at) return 'bei ' + (WF.sim.stationName ? WF.sim.stationName(at) : at);
    }
    return p.state === 'walking' ? 'unterwegs' : 'am Arbeitsplatz';
  }
  /** Was belegt die Maschine vor diesem Arbeitsgang? (Plantafel) – laufende Arbeitsgänge (active) kann ein Eilauftrag
      nicht überholen, eingeplante (queued) schon */
  function blockerOn(c, stationId, orderId, seq) {
    const list = (c.fc().machines[stationId] || []).slice().sort((a, b) => a.start - b.start);
    const idx = list.findIndex(e => e.orderId === orderId && e.seq === seq);
    if (idx <= 0) return null;
    const before = list.slice(0, idx).filter(e => e.orderId !== orderId);
    if (!before.length) return null;
    const until = Math.max(...before.map(e => e.end));
    const running = before.filter(e => e.active), queued = before.filter(e => !e.active);
    const desc = (e) => e.orderId + ' AG ' + e.seq + (e.active ? ' (läuft)' : '');
    return { before, running, queued, until, text: `${stationId} ist vorher mit ${listJoin(before.slice(0, 3).map(desc))}${before.length > 3 ? ' u. a.' : ''} belegt (bis ca. ${tc(until)})` };
  }
  const bnMachine = (o) => (o && o.bottleneck ? o.bottleneck.split(' ')[0] : null);
  /** kurze Begründung, warum ein Auftrag knapp/spät ist – aus Arbeitsgang-Kette, Plantafel und Engpass */
  function orderWhy(c, o) {
    const parts = [];
    const cur = curOp(o);
    if (cur) {
      const mv = S().machines[cur.station] ? c.mv(cur.station) : null;
      if (cur.state === 'active' && mv) {
        if (mv.state === 'fault' || WAIT[mv.state]) parts.push(`AG ${cur.seq} an ${mName(cur.station)} steht: ${stLabel(mv.state)} – ${mv.cause}`);
        else parts.push(`AG ${cur.seq} „${cur.op}“ ${mv.state === 'running' ? 'läuft an ' + mName(cur.station) : 'an ' + mName(cur.station) + ': ' + stLabel(mv.state)} (${cur.good + cur.scrap}/${cur.target}${mv.etaOpEnd ? ', fertig ca. ' + tc(mv.etaOpEnd) : ''})`);
      } else if (cur.state === 'external' && cur.ext) parts.push(`AG ${cur.seq} ${cur.op}: ${cur.ext.returnText}`);
      else if (cur.state === 'waiting') {
        const b = S().machines[cur.station] ? blockerOn(c, cur.station, o.id, cur.seq) : null;
        parts.push(`AG ${cur.seq} „${cur.op}“ wartet an ${mName(cur.station)}${cur.waiting ? ' (' + stk(cur.waiting) + ' im Eingang)' : ''}${b ? ' – ' + b.text : ''}`);
      } else parts.push(`nächster Schritt AG ${cur.seq} „${cur.op}“ an ${cur.station === 'EXT' ? 'Fremdbearbeitung' : mName(cur.station)}${cur.plannedStart ? ' ab ca. ' + tc(cur.plannedStart) : ''}`);
    }
    const bm = bnMachine(o);
    if (o.bottleneck) {
      const bop = bm ? o.ops.find(op => op.station === bm && !op.complete) : null;
      const b = bop && bop.state !== 'active' && S().machines[bm] ? blockerOn(c, bm, o.id, bop.seq) : null;
      parts.push(`längster Arbeitsgang im Plan: ${o.bottleneck}${b ? ' – ' + b.text : ''}`);
    }
    return uc1(parts.join('; ')) + '.';
  }
  /** Empfehlung für einen knappen/späten Auftrag – nur, was nach Datenlage wirklich hilft:
      Eilauftrag nur, wenn eingeplante (nicht laufende) Arbeitsgänge anderer Aufträge davor liegen; Hinweis, wenn dabei
      selbst knappe Aufträge überholt würden. */
  function orderAdvice(c, o) {
    const remain = o.ops.filter(op => !op.complete && op.station !== 'VERSAND');
    const nowT = NOW();
    // ab wann die Teile für einen Arbeitsgang am Platz sind (wie die Engine: Eingang → jetzt, Ausgang Vorgänger → ~10 min, sonst erster Behälter)
    const availOf = (op) => {
      const i = o.ops.indexOf(op), prev = i > 0 ? o.ops[i - 1] : null;
      if (i <= 0 || op.waiting > 0 || !prev) return nowT;
      if (prev.complete || prev.inOutput > 0) return nowT + 600;
      return prev.firstOutT || nowT;
    };
    // Überholbar sind nur eingeplante (nicht laufende) Aufträge, die erst starten, wenn die eigenen Teile schon da sind
    const cand = []; let gated = null;
    for (const op of remain) {
      if (!S().machines[op.station] || op.state === 'active') continue;
      const b = blockerOn(c, op.station, o.id, op.seq); if (!b || !b.queued.length) continue;
      const av = availOf(op), ov = b.queued.filter(e => e.start >= av - 300);
      if (ov.length) cand.push({ op, b, ov, av }); else if (!gated) gated = { op, av };
    }
    const ext = remain.find(op => op.station === 'EXT' && op.state !== 'done');
    const eil = { label: `${o.id} als Eilauftrag`, desc: `Maschinen ziehen ${o.id} beim nächsten Auftragswechsel vor; laufende Teile werden nicht unterbrochen.`, action: { type: 'setPriority', orderId: o.id, priority: 'eil' }, icon: 'bolt' };
    const late = o.risk === 'spät';
    const bm = bnMachine(o);
    const protect = bm && S().machines[bm] ? (station(bm).loading === 'auto' ? `${bm} läuft unbemannt weiter – Material und Standzeit für die Nacht sichern` : `${bm} ohne Unterbrechung laufen lassen (Pausenablösung, Störungen dort zuerst beheben)`) : null;
    const pufT = (x) => (x.slackSec < 0 ? dur0(-x.slackSec) + ' Verzug' : x.slackSec < 60 ? 'kein Puffer' : 'Puffer ' + dur0(x.slackSec));
    if (o.priority !== 'eil' && cand.length) {
      const q = cand[0];
      const over = [...new Set(cand.flatMap(x => x.ov.map(e => e.orderId)))];
      const tightOver = over.map(id => c.ov(id)).filter(x => x && x.status !== 'fertig' && x.slackSec != null && x.slackSec < 2 * 3600);
      // Abwägung: Belegung des eigenen Arbeitsgangs (= Verschiebung der Überholten) gegen den möglichen Gewinn
      const mine = (c.fc().machines[q.op.station] || []).find(e => e.orderId === o.id && e.seq === q.op.seq);
      const pushSec = mine ? Math.max(0, mine.end - mine.start) : 0;
      const gainSec = Math.max(...cand.map(x => x.ov.reduce((s, e) => s + Math.max(0, e.end - e.start), 0)));
      const hurt = tightOver.filter(x => x.slackSec < pushSec).map(x => ({ x, by: pushSec - Math.max(0, x.slackSec) }));
      const okOver = tightOver.filter(x => x.slackSec >= pushSec);
      const costSec = hurt.reduce((s, h) => s + h.by, 0), helpSec = late ? Math.min(gainSec, -o.slackSec) : 0;
      const hurtTxt = (h) => (h.x.slackSec < 0 ? `${h.x.id} (schon ${dur0(-h.x.slackSec)} Verzug) bekäme ~${dur0(h.by)} mehr` : `${h.x.id} (${pufT(h.x)}) würde ~${dur0(h.by)} spät`);
      if (late && hurt.length && costSec >= helpSec * 0.8) {
        const alts = capableAlts(o.id, q.op.seq, q.op.station).filter(x => { const v = c.mv(x); return v && v.state !== 'fault' && v.state !== 'off'; });
        const altTxt = alts.length ? `AG ${q.op.seq} auf ${listJoin(alts.slice(0, 2))} verlagern (dort neu rüsten), ` : '';
        const act = alts.length ? { label: `${o.id} AG ${q.op.seq} auf ${alts[0]} verlagern`, desc: `${q.op.op} · ${q.op.station} bleibt für ${listJoin(hurt.map(h => h.x.id))} frei · dort neu rüsten`, action: { type: 'moveOp', orderId: o.id, seq: q.op.seq, stationId: alts[0] }, icon: 'route' } : null;
        const bnT = bm && S().machines[bm] ? (station(bm).loading === 'auto' ? `${bm} unbemannt durchlaufen lassen` : `Überstunden am Engpass ${bm}`) : `Überstunden an ${q.op.station}`;
        return { text: `Ein Eilauftrag würde den Verzug nur verschieben: ${o.id} würde an ${q.op.station} vor ${listJoin(q.ov.slice(0, 2).map(e => e.orderId + ' AG ' + e.seq))} gezogen und belegt die Maschine ~${dur0(pushSec)} – ${listJoin(hurt.map(hurtTxt))}. Besser: ${altTxt}${bnT} oder Teillieferung mit ${custShort(o.customer)} abstimmen.`, action: act };
      }
      const caution = (hurt.length ? ` Achtung: ${listJoin(hurt.map(hurtTxt))} – netto gewinnt ${o.id} trotzdem bis ~${dur0(helpSec)}.` : '')
        + (okOver.length ? ` ${listJoin(okOver.map(x => `${x.id} (${pufT(x)})`))} ${okOver.length === 1 ? 'wird' : 'werden'} überholt, der Puffer reicht aber (${q.op.station}-Belegung ~${dur0(pushSec)}).` : '');
      return { text: `${late ? '' : 'Termin hält knapp. Falls es enger wird: '}${o.id} als **Eilauftrag** kennzeichnen – ${q.op.station} zieht ihn dann vor ${listJoin(q.ov.slice(0, 2).map(e => e.orderId + ' AG ' + e.seq))}; laufende Teile werden nicht unterbrochen.${caution}`, action: late || o.slackSec < 3600 ? eil : null };
    }
    if (ext) {
      const partner = (ext.ext && ext.ext.partner) || 'der Härterei';
      return { text: late ? `Termin hängt am Rücklauf aus der Fremdbearbeitung (${ext.op}) – Expressdurchlauf bei ${partner} anfragen oder Teillieferung mit ${custShort(o.customer)} abstimmen.` : `Termin hält knapp; kritisch ist der Rücklauf aus der Fremdbearbeitung (${ext.op}, ${partner}) – Lose pünktlich bereitstellen${protect ? '; ' + protect : ''}.`, action: null };
    }
    const gatedTxt = gated ? `die Teile für AG ${gated.op.seq} sind erst ca. ${tc(gated.av)} an ${gated.op.station}, die Aufträge davor laufen bis dahin ohnehin` : null;
    if (!late) return { text: `Termin hält knapp – ${protect || 'Engpass ohne Unterbrechung laufen lassen'}. Ein Eilauftrag bringt hier nichts: ${gatedTxt || 'vor ' + o.id + ' liegt nur bereits laufende Arbeit'}.`, action: null };
    let runTxt = null;
    for (const op of remain) {
      if (!S().machines[op.station] || op.state === 'active') continue;
      const b = blockerOn(c, op.station, o.id, op.seq);
      if (b && b.running.length) { runTxt = `an ${op.station} läuft zuerst ${b.running[0].orderId} AG ${b.running[0].seq} (bis ca. ${tc(b.running[0].end)})`; break; }
    }
    runTxt = [runTxt, gatedTxt].filter(Boolean).join('; ') || 'vor ' + o.id + ' liegt nur bereits laufende Arbeit';
    const bnTxt = bm && S().machines[bm] ? (station(bm).loading === 'auto' ? `${bm} unbemannt durchlaufen lassen` : `Zusatzschicht/Überstunden an ${bm}`) : 'Zusatzschicht/Überstunden am Engpass';
    return { text: `Ein Eilauftrag hilft hier nicht – ${runTxt}. Der Verzug entsteht in der Bearbeitungszeit${o.bottleneck ? ' am Engpass ' + o.bottleneck : ''}: ${bnTxt} oder Teillieferung mit ${custShort(o.customer)} abstimmen.`, action: null };
  }
  /** Rohmaterialbedarf der offenen Aufträge (noch nicht ausgebucht) je Material */
  function materialNeeds() {
    const need = {}, users = {};
    for (const id in S().orders) {
      const o = S().orders[id]; if (o.status === 'fertig') continue;
      const r = o.routing[0]; if (!r || !r.material) continue;
      const left = WF.sim.partsLeft(id, r.seq); if (!(left > 0)) continue;
      let parts = left;
      const mt = S().materials[r.material.id]; if (!mt) continue;
      if (mt.form === 'Stk') { // Rohteile-Behälter, die schon im Eingang/unterwegs sind, sind bereits ausgebucht
        for (const cid in S().containers) { const ct = S().containers[cid]; if (ct.orderId === id && ct.kind === 'raw' && ct.idx === 0 && ct.state !== 'scrap') parts -= ct.qty; }
      }
      parts = Math.max(0, parts);
      need[mt.id] = (need[mt.id] || 0) + parts * r.material.perPart;
      (users[mt.id] = users[mt.id] || []).push({ orderId: id, parts, perPart: r.material.perPart, station: r.station });
    }
    // Stangen im Magazin des Langdrehautomaten sind bereits ausgebucht
    for (const id in S().machines) {
      const m = S().machines[id];
      if (m.barMat && m.barStockM > 0 && need[m.barMat] != null) need[m.barMat] = Math.max(0, need[m.barMat] - m.barStockM);
    }
    return { need, users };
  }
  /** Lieferfenster wie die Engine (Spedition/Lieferanten Mo–Fr 06:00–20:00, sonst nächster Morgen 06:30) */
  function nextDayWindow(t) {
    const d0 = Math.floor(t / DAY), s0 = t - d0 * DAY, dow = ((d0 % 7) + 7) % 7;
    if (dow < 5 && s0 >= 6 * 3600 && s0 < 20 * 3600) return t;
    let d = d0; if (dow < 5 && s0 < 6 * 3600) return d * DAY + 23400;
    d++; while (d % 7 >= 5) d++;
    return d * DAY + 23400;
  }
  const deliveryT = (mt) => nextDayWindow(NOW() + mt.leadMin * 60);
  function openPurchases(matId) { return (S().purchases || []).filter(p => p.status === 'bestellt' && (!matId || p.materialId === matId)).sort((a, b) => a.etaT - b.etaT); }
  /** geplante Werkzeugwechsel aller Maschinen (eine Zeile je Maschine und Teilegrenze) */
  function plannedChanges(c, untilT) {
    const out = [];
    for (const mv of c.mvs()) {
      const groups = {};
      for (const t of mv.tools || []) {
        const pc = t.plannedChange; if (!pc || pc.etaT == null) continue;
        if (untilT != null && pc.etaT > untilT) continue;
        const key = pc.afterPart + '|' + pc.etaT;
        const g = groups[key] || (groups[key] = { machine: mv.id, mv, t: pc.etaT, afterPart: pc.afterPart, tools: [], by: pc.by, stage: pc.stage, waitFromT: pc.waitFromT, manual: pc.manual, note: pc.note, text: pc.text });
        g.tools.push(t);
        if (pc.manual) g.manual = true;
      }
      for (const k in groups) out.push(groups[k]);
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /** Verlust je Ursache (€): Stillstandskosten je Maschine anteilig auf die Zustände in der Schichtzeit verteilt (Zustandsband) */
  function lossByCause(c) {
    const t = c.t, d0 = Math.floor(t / DAY) * DAY;
    const byCause = {}, byMachine = [];
    for (const mv of c.mvs()) {
      const sec = {};
      let tot = 0;
      for (const sg of mv.segments || []) {
        if (LOSS_STATES.indexOf(sg.state) < 0) continue;
        const a = Math.max(d0, sg.t0), b = Math.min(t, sg.t1 == null ? t : sg.t1);
        if (b <= a) continue;
        const w = workBetween(a, b); if (w <= 0) continue;
        sec[sg.state] = (sec[sg.state] || 0) + w; tot += w;
      }
      const loss = mv.lossEurToday || 0;
      const causes = Object.keys(sec).map(k => ({ state: k, sec: sec[k], eur: tot > 0 ? loss * sec[k] / tot : 0 })).sort((a, b) => b.eur - a.eur);
      for (const x of causes) byCause[x.state] = (byCause[x.state] || 0) + x.eur;
      byMachine.push({ mv, loss, causes, lossSec: tot });
    }
    byMachine.sort((a, b) => b.loss - a.loss);
    const causes = Object.keys(byCause).map(k => ({ state: k, eur: byCause[k] })).sort((a, b) => b.eur - a.eur);
    return { byMachine, causes };
  }
  const CAUSE_LABEL = { setup: 'Rüsten', firstPiece: 'Erstteilprüfung', toolchange: 'Werkzeugwechsel', waitTool: 'Warten auf Werkzeug', waitOperator: 'Warten auf Bediener', starved: 'Warten auf Material', blocked: 'Ausgang voll', fault: 'Störungen' };
  const CAUSE_ADVICE = {
    setup: 'Rüsten vorbereiten: Werkzeuge und Spannmittel vorab bereitstellen, Aufträge mit gleichem Werkzeugsatz hintereinander legen.',
    firstPiece: 'Erstteilprüfungen im Messraum vor Losprüfungen ziehen – die Maschine steht, bis das Erstteil freigegeben ist.',
    toolchange: 'Werkzeugwechsel bündeln (Mitwechseln) und vermessene Werkzeuge vorab bereitlegen.',
    waitTool: 'Einrichter:in bei der Wechselankündigung losschicken – Werkzeug liegt dann bereit, bevor die Standzeit endet.',
    waitOperator: 'Bedienung neu verteilen: Pausen versetzen, Mehrmaschinenbedienung oder Einrichter:in als Springer einplanen.',
    starved: 'Materialfluss absichern: Vorgänger-Arbeitsgänge und Transporte priorisieren, Rohmaterial rechtzeitig bestellen.',
    blocked: 'Abholung priorisieren (AGV/Stapler) und Zielpuffer der Nachfolger prüfen.',
    fault: 'Störungsursachen beheben (Wiederholer?) und Instandhaltung auf die Engpassmaschinen konzentrieren.',
  };
  /** Arbeitszeit je Werktag (zwei Schichten ohne Pausen) */
  function staffedPerDay() { let x = 0; for (const w of workWindows()) if (w[1] <= DAY) x += w[1] - w[0]; return x || 14.5 * 3600; }
  /** Belastung je Arbeitsplatz: Arbeitsinhalt der offenen Arbeitsgänge (Rest-Teile × (Taktzeit + Einlegen) + Rüsten,
      laufendes Teil) – in Arbeitstagen: bemannte Plätze 2 Schichten, autonome 24 h. Dazu „belegt bis“ laut Plantafel. */
  function machineLoad(c) {
    const fc = c.fc(), perDay = staffedPerDay();
    return PROF().machines.map(id => {
      const st = station(id), auto = st.loading === 'auto', mv = c.mv(id);
      const list = (fc.machines[id] || []).slice().sort((a, b) => a.start - b.start);
      let until = null; for (const e of list) until = until == null ? e.end : Math.max(until, e.end);
      let work = 0; const ops = [];
      for (const oid in S().orders) {
        const o = S().orders[oid]; if (o.status === 'fertig') continue;
        o.routing.forEach((r, i) => {
          if (r.station !== id || o.ops[i].complete) return;
          const left = WF.sim.partsLeft(oid, r.seq) || 0;
          const active = !!(mv && mv.order && mv.order.id === oid && mv.order.seq === r.seq);
          const load = st.loading === 'perPart' ? ((r.loadMin != null ? r.loadMin : st.loadMin) || 1) : 0;
          let sec = left * ((r.cycleMin || 0) + load) * 60;
          if (active && mv.partRemainSec) sec += mv.partRemainSec;
          if (!(active && mv.phase !== 'Rüsten ausstehend' && mv.phase !== 'Rüsten')) sec += (r.setupMin || 0) * 60;
          if (sec > 0) { work += sec; ops.push({ orderId: oid, seq: r.seq, sec, active }); }
        });
      }
      return { id, st, auto, list, work, days: work / (auto ? DAY : perDay), until, ops, backlog: work };
    }).sort((a, b) => b.days - a.days);
  }
  const daysTxt = (d) => nm(d, d < 10 ? 1 : 0) + (Math.abs(d - 1) < 0.05 ? ' Tag' : ' Tage');
  /** Alternativmaschinen gleicher Gruppe (Drehen / Fräsen) – Verlagerung prüft die Engine (Gewicht, Ø, Stange, 5-Achs) */
  function altMachines(id) {
    const st = station(id), g = st && TYPE_GROUP[st.type];
    if (!g) return [];
    return PROF().machines.filter(x => x !== id && TYPE_GROUP[station(x).type] === g);
  }
  /** Leistungsgrenzen wie in ENGINE_API §8 moveOp beschrieben (Gewicht, Ø/Länge, Stange beim Langdreher, 5-Achs) –
      nur zur Vorprüfung, damit keine unmöglichen Verlagerungen vorgeschlagen werden; verbindlich entscheidet moveOp */
  const CAPS = {
    swiss: { barOnly: true, maxBarDia: 20, maxKg: 0.5, what: 'nur Stangenmaterial bis Ø 20 mm' },
    lathe: { maxKg: 30, maxDia: 220, maxLen: 600, what: 'Teile bis ca. Ø 220 × 600 mm und 30 kg' },
    biglathe: { minKg: 10, what: 'Wellen ab ca. 10 kg' },
    mill5: { maxKg: 300, what: 'Werkstücke bis ca. 300 kg' },
    mill3: { maxKg: 1000, no5axis: true, what: '3-Achs, keine 5-Achs-Bearbeitung' },
  };
  const numDe = (x) => Number(String(x).replace(',', '.'));
  function partDims(o) {
    const n = String(o.part.name || '') + ' ' + String(o.part.no || '');
    let m = /Ø\s*(\d+(?:[.,]\d+)?)(?:\s*[×x]\s*(\d+(?:[.,]\d+)?))?/.exec(n);
    if (m) return { dia: numDe(m[1]), len: m[2] ? numDe(m[2]) : null };
    m = /\bm\s*(\d+(?:[.,]\d+)?)\s*z\s*(\d+)/i.exec(n);
    if (m) return { dia: Math.round(numDe(m[1]) * (Number(m[2]) + 2)), len: null };
    m = /(\d+)\s*[×x]\s*(\d+)(?:\s*[×x]\s*(\d+))?/.exec(n);
    if (m) return { dia: null, len: Math.max(numDe(m[1]), numDe(m[2]), m[3] ? numDe(m[3]) : 0) };
    return { dia: null, len: null };
  }
  /** null = kann bearbeiten, sonst kurze Begründung */
  function capReason(orderId, seq, toId) {
    const o = S().orders[orderId], to = station(toId);
    if (!o || !to) return 'unbekannt';
    const i = o.routing.findIndex(r => r.seq === seq), r = o.routing[i];
    const cap = Object.assign({}, CAPS[to.type] || {}, to.caps || {});
    const kg = o.part.weightKg || 0, d = partDims(o);
    const f1 = (v) => nm(v, v < 1 ? 2 : v < 10 ? 1 : 0);
    if (cap.barOnly) {
      const mt = i === 0 && r.material ? S().materials[r.material.id] : null;
      const bm = mt && mt.form === 'Stange' ? /Ø\s*(\d+(?:[.,]\d+)?)/.exec(mt.name) : null;
      if (!bm) return `${cap.what} – „${r.op}“ geht nicht von Stangenmaterial aus`;
      if (numDe(bm[1]) > cap.maxBarDia) return `Stange Ø ${f1(numDe(bm[1]))} mm > Ø ${cap.maxBarDia} mm`;
    }
    if (cap.maxKg && kg > cap.maxKg) return `Teilegewicht ${f1(kg)} kg > ${f1(cap.maxKg)} kg`;
    if (cap.minKg && kg < cap.minKg) return `${cap.what} – ${o.part.name} wiegt ${f1(kg)} kg`;
    if (cap.maxDia && d.dia && d.dia > cap.maxDia) return `Ø ${f1(d.dia)} mm > Ø ${cap.maxDia} mm`;
    if (cap.maxLen && d.len && d.len > cap.maxLen) return `Länge ${f1(d.len)} mm > ${cap.maxLen} mm`;
    if (cap.no5axis && /5-?Achs/i.test(r.op)) return `„${r.op}“ braucht eine 5-Achs-Maschine`;
    return null;
  }
  /** gleichartige Maschinen, die den Arbeitsgang nach Leistungsgrenzen übernehmen könnten */
  const capableAlts = (orderId, seq, fromId) => altMachines(fromId).filter(x => !capReason(orderId, seq, x));

  // ================================================================== Erkennung: Entitäten in der Frage
  const norm = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[„“”"']/g, ' ').replace(/\s+/g, ' ').trim();
  // Aliase je Arbeitsplatz (normalisiert; '*' = Wortanfang genügt)
  const MACHINE_ALIAS = {
    M01: ['saege', 'bandsaege*', 'saegeautomat*', 'behringer', 'zuschnitt*'],
    M02: ['index', 'g220', 'g 220', 'drehfraeszentrum*', 'portallader'],
    M03: ['citizen', 'l20', 'l 20', 'langdreh*', 'swiss'],
    M04: ['wfl', 'm80', 'm 80', 'millturn', 'grossdreh*', 'wellendreh*'],
    M07: ['tiefbohr*', 'tiefloch*', 'bta'],
    M08: ['liebherr', 'lc 180', 'lc180', 'waelzfraesmaschine*', 'verzahnung*'],
    M05: ['dmu', 'dmg', 'dmu 65', '5-achs*', '5 achs*', 'fuenfachs*', 'monoblock'],
    M06: ['haas', 'vf-4', 'vf4', 'vf 4', 'vertikal*'],
    M09: ['studer', 's33', 's 33', 'rundschleif*'],
    M10: ['okamoto', 'flachschleif*'],
    M11: ['waschanlage*', 'wasch*', 'reinigungsanlage*'],
    QS: ['messraum', 'kmg', 'koordinatenmess*', 'zeiss', 'contura', 'qs'],
    M13: ['montage'],
  };
  const MATERIAL_ALIAS = {
    'MAT-TI10': ['titan*', 'ti6al4v', 'ti 6al4v'],
    'MAT-14404': ['1.4404', '14404', 'edelstahl*'],
    'MAT-42CR110': ['42crmo4 o110', '42crmo4 110', 'o110', 'oe110'],
    'MAT-42CR65': ['42crmo4 o65', '42crmo4 65', 'o65'],
    'MAT-16MNCR90': ['16mncr5', 'einsatzstahl*'],
    'MAT-2842': ['1.2842', '2842', 'werkzeugstahl*', 'flachstahl*'],
    'MAT-ALBL': ['alu*', 'almgsi*', 'aluminium*'],
    'MAT-GUSSLD': ['guss*', 'rohguss*', 'gjl*', 'grauguss*'],
  };
  const VIEW_ALIAS = {
    leitstand: ['leitstand', 'dashboard', 'uebersicht'],
    halle: ['halle', '3d', 'hallenmodell'],
    auftraege: ['auftraege', 'auftragsliste', 'plantafel', 'gantt'],
    material: ['material und logistik', 'material-ansicht', 'logistik', 'lageransicht'],
    werkzeuge: ['werkzeuge', 'werkzeug-ansicht', 'werkzeugansicht'],
    personal: ['personal', 'personalansicht'],
    qualitaet: ['qualitaet', 'qualitaetsansicht', 'spc'],
    anbindung: ['anbindung', 'maschinenanbindung'],
    analyse: ['analyse', 'verlustanalyse'],
    'ki-auftrag': ['ki-auftrag', 'ki auftrag', 'zeichnung'],
  };
  const NUMW = { ein: 1, eine: 1, einer: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwoelf: 12 };
  const hasWord = (q, alias) => {
    const stem = alias.endsWith('*'), a = stem ? alias.slice(0, -1) : alias;
    const re = new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (stem ? '' : '(?![a-z0-9])'));
    return re.test(q);
  };
  function entities(text) {
    const raw = String(text || ''), q = norm(raw);
    const E = { machines: [], orders: [], people: [], materials: [], agvs: [], customers: [], roles: [], hours: null, views: [] };
    const add = (arr, v) => { if (v && arr.indexOf(v) < 0) arr.push(v); };
    const st = S();
    // Maschinen: M05 / m 05 / M5 (einstellig nur mit großem M, sonst „m2 z38“ = Modul)
    let m;
    const reM = /(^|[^A-Za-z0-9])([Mm])\s?-?(\d{1,2})(?![0-9])/g;
    while ((m = reM.exec(raw))) { if (m[3].length === 1 && m[2] !== 'M') continue; const id = 'M' + m[3].padStart(2, '0'); if (st.machines[id]) add(E.machines, id); }
    for (const id in MACHINE_ALIAS) for (const a of MACHINE_ALIAS[id]) if (hasWord(q, a)) { if (a === 'qs' && /qs-|qs pruef/.test(q)) continue; add(E.machines, id); break; }
    // Aufträge: FA-24118, „24118“, Teilebezeichnung, Kunde
    const reO = /\bfa\s?-?\s?(\d{5})\b|\b(2\d{4})\b/g;
    while ((m = reO.exec(q))) { const id = 'FA-' + (m[1] || m[2]); if (st.orders[id]) add(E.orders, id); }
    for (const id in st.orders) {
      const o = st.orders[id];
      const w = norm(String(o.part.name || '').split(/[\s(]/)[0]);
      if (w.length >= 5 && hasWord(q, w.replace(/e$/, '') + '*')) add(E.orders, id);
      const cw = norm(String(o.customer || '').split(/\s+/)[0]);
      if (cw.length >= 5 && hasWord(q, cw + '*')) add(E.customers, o.customer);
    }
    // Personen: P06, Vor-/Nachname
    const reP = /\bp\s?-?(\d{2})\b/g;
    while ((m = reP.exec(q))) { const id = 'P' + m[1]; if (st.people[id]) add(E.people, id); }
    for (const id in st.people) {
      const parts = norm(st.people[id].name).split(' ');
      for (const w of parts) if (w.length >= 3 && hasWord(q, w)) { add(E.people, id); break; }
    }
    const ROLE_W = { einrichter: 'Einrichter', instandhalt: 'Instandhalter', schichtleit: 'Schichtleiter', pruefer: 'Qualitätsprüfer', logistiker: 'Logistiker', monteur: 'Monteur', schleifer: 'Schleifer', zerspanung: 'Zerspanungstechniker' };
    for (const k in ROLE_W) if (q.indexOf(k) >= 0) add(E.roles, ROLE_W[k]);
    // Material
    const reMat = /\bmat-[a-z0-9]+\b/g;
    while ((m = reMat.exec(q))) { const id = m[0].toUpperCase(); if (st.materials[id]) add(E.materials, id); }
    for (const id in MATERIAL_ALIAS) for (const a of MATERIAL_ALIAS[id]) if (hasWord(q, a)) { add(E.materials, id); break; }
    if (/42crmo4/.test(q) && !E.materials.some(x => x.indexOf('42CR') >= 0)) { add(E.materials, 'MAT-42CR110'); add(E.materials, 'MAT-42CR65'); }
    // AGV
    const reA = /\bagv\s?-?(\d)\b/g;
    while ((m = reA.exec(q))) { const id = 'AGV' + m[1]; if (st.agvs[id]) add(E.agvs, id); }
    // Dauer („2 h“, „90 min“, „zwei Stunden“, „halbe Stunde“)
    const reH = /(\d+(?:[.,]\d+)?)\s*(h|std|stunden?|min|minuten?)(?![a-z])/;
    if ((m = reH.exec(q))) { const v = Number(m[1].replace(',', '.')); E.hours = /^m/.test(m[2]) ? v / 60 : v; }
    else if (/halbe(n)? stunde/.test(q)) E.hours = 0.5;
    else if ((m = /\b(ein|eine|einer|einen|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|zehn|zwoelf)\s+(stunden?|std)\b/.exec(q))) E.hours = NUMW[m[1]];
    // Ansichten
    for (const v in VIEW_ALIAS) for (const a of VIEW_ALIAS[v]) if (hasWord(q, a)) { add(E.views, v); break; }
    return E;
  }

  // ================================================================== Antwort-Baukasten
  function A(kind) { return { kind, md: [], stats: null, sources: [], actions: [], followups: [], impact: null, entity: null, slots: null }; }
  /** Platzhalter „\u0005name“ im Markdown = grafischer Block (z. B. Arbeitsgang-Kette); a.text enthält stattdessen den Klartext */
  const SLOT = (a, name, text, data) => { (a.slots = a.slots || {})[name] = { text, data }; a.md.push('\u0005' + name); };
  const done = (a) => {
    const j = a.md.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (a.slots && /\u0005/.test(j)) { a.display = j; a.text = j.replace(/\u0005(\w+)/g, (_, k) => (a.slots[k] ? a.slots[k].text : '')).replace(/\n{3,}/g, '\n\n').trim(); }
    else { a.display = null; a.text = j.replace(/\u0005\w+/g, '').trim(); }
    return a;
  };
  function addAction(a, x) { if (x && !a.actions.some(y => JSON.stringify(y.action) === JSON.stringify(x.action))) a.actions.push(x); }
  const srcStand = () => 'Stand ' + U.fmtDayClock(NOW());

  // ------------------------------------------------------------------ Lage / Schicht
  function ansOverview(c) {
    const a = A('overview'), k = c.k(), sh = WF.sim.shift();
    const mvs = c.mvs();
    const prod = mvs.filter(m => m.state === 'running'), faults = mvs.filter(m => m.state === 'fault');
    const waits = mvs.filter(m => WAIT[m.state]).sort((x, y) => y.sinceSec - x.sinceSec);
    const setups = mvs.filter(m => SETUPISH[m.state]), idle = mvs.filter(m => m.state === 'idle');
    const open = c.open(), late = open.filter(o => o.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec), tight = open.filter(o => o.risk === 'knapp').sort((x, y) => x.slackSec - y.slackSec);
    const people = Object.values(S().people).filter(p => p.state !== 'offShift');
    const shName = sh.id ? sh.name : 'Geisterschicht (unbemannt)';
    const oeeTxt = k.oee != null ? `, OEE heute **${pct(k.oee, 1)}** (${k.oee >= TARGET_OEE ? 'über' : 'unter'} dem Ziel von ${pct(TARGET_OEE)})` : '';
    if (sh.id) a.md.push(`**${shName}, ${WF.sim.clock()}:** ${prod.length} von ${mvs.length} Arbeitsplätzen produzieren${oeeTxt}.`);
    else a.md.push(`**${shName}, ${WF.sim.clock()}:** ${prod.length ? prod.length + ' von ' + mvs.length + ' Arbeitsplätzen produzieren unbemannt' : 'kein Arbeitsplatz produziert'}; Frühschicht ab ${dueTxt(sh.endsAt)}${oeeTxt}.`);
    a.stats = [
      { l: 'OEE heute', v: pct(k.oee, 1), s: sh.id && k.oeeShift != null ? 'Schicht ' + pct(k.oeeShift, 1) : 'Ziel ' + pct(TARGET_OEE), c: k.oee == null ? '' : k.oee >= TARGET_OEE ? 'ok' : 'warn' },
      { l: 'Fertige Teile', v: nm(k.goodFinished), s: nm(k.good) + ' je AG' },
      { l: 'Termintreue', v: pct(k.onTimePct), s: late.length + ' spät · ' + tight.length + ' knapp', c: late.length ? 'warn' : 'ok' },
      { l: 'Stillstand', v: eur(k.lossEur), s: 'heute', c: 'info' },
    ];
    a.md.push('');
    for (const m of faults) { const fi = faultInfo(m); a.md.push(`- **Störung ${mName(m.id)}** seit ${clk(m.since)}: ${m.fault.code} ${m.fault.text} – ${fi.who}.`); }
    const waitsS = waits.filter(m => !noStaff(m)), waitsNS = waits.filter(noStaff);
    for (const m of waitsS.slice(0, 3)) a.md.push(`- **${mName(m.id)}** ${lc1(stLabel(m.state))} seit ${durR(m.sinceSec)}: ${m.cause}.`);
    if (waitsS.length > 3) a.md.push(`- Weitere wartende Arbeitsplätze: ${waitsS.slice(3).map(m => m.id).join(', ')}.`);
    a.md.push(...groupNoStaff(waitsNS));
    if (setups.length) a.md.push(`- ${setups.length === 1 ? 'Rüsten/Prüfen' : setups.length + ' Arbeitsplätze rüsten/prüfen'}: ${setups.map(m => `${mName(m.id)} (${stLabel(m.state)}${m.order ? ', ' + m.order.id : ''})`).join('; ')}.`);
    if (idle.length) {
      const idleTxt = (m) => `${mName(m.id)} – ${lc1(String(m.cause).replace(/^Frei\s*[–-]\s*/i, ''))}`;
      a.md.push(idle.length <= 2 ? `- Ohne laufenden Auftrag: ${idle.map(idleTxt).join('; ')}.` : `- Ohne laufenden Auftrag: ${idle.map(m => m.id).join(', ')} – als Nächstes ${idle.filter(m => /ca\. \d/.test(m.cause)).slice(0, 2).map(idleTxt).join('; ') || 'Vorgänger noch in Arbeit bzw. nichts eingeplant'}.`);
    }
    if (late.length || tight.length) {
      const lt = late.map(o => `**${o.id}** ${dur0(-o.slackSec)} zu spät`).concat(tight.slice(0, 3).map(o => `${o.id} nur ${dur0(o.slackSec)} Puffer`));
      a.md.push(`- Termine: ${lt.join(', ')}.`);
    } else a.md.push(`- Termine: alle ${open.length} offenen Aufträge im Plan.`);
    const ch = plannedChanges(c, c.t + 2 * 3600);
    if (ch.length) a.md.push(`- Werkzeugwechsel bis ${clk(c.t + 7200)}: ${ch.length} – als Nächstes ${clk(ch[0].t)} an ${mName(ch[0].machine)} (${toolShort(ch[0].tools[0].name)}${ch[0].tools.length > 1 ? ' +' + (ch[0].tools.length - 1) : ''}).`);
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min);
    if (low.length) a.md.push(`- Material unter Mindestbestand: ${low.map(mt => `${mt.name} (${matQty(mt, mt.onHand)}${mt.onOrder ? ', bestellt' : ', nicht bestellt'})`).join('; ')}.`);
    if (people.length) {
      const brk = people.filter(p => p.state === 'break').length, free = people.filter(p => p.state === 'idle').length;
      a.md.push(`- Personal: ${people.length} im Dienst${brk ? ', ' + brk + ' in Pause' : ''}${free ? ', ' + free + ' verfügbar' : ''}.`);
    } else a.md.push(`- Personal: niemand im Dienst – autonome Maschinen laufen weiter, solange Material und Standzeit reichen.`);
    a.md.push(`- Qualität: ${nm(k.scrap)} Ausschuss, FPY ${pct(k.fpy, 1)}.`);
    // Empfehlung: das Wichtigste zuerst
    let rec = null;
    if (faults.length) { const m = faults[0], fi = faultInfo(m); rec = `Störung an ${mName(m.id)} hat Vorrang – ${fi.working ? 'Reparatur läuft' : fi.person ? sn(fi.person.name) + ' ist unterwegs' : 'Instandhaltung hinschicken'}; Prognose rechnet mit Ende ca. ${clk(fi.endT)}.`; }
    else if (!sh.id && morningPlan(c)) rec = morningPlan(c);
    else if (waitsS.length && waitsS[0].sinceSec >= 300) rec = `${mName(waitsS[0].id)}: ${waitAdvice(c, waitsS[0])}`;
    else if (late.length) { const adv = orderAdvice(c, late[0]); rec = adv.text; addAction(a, adv.action); }
    else if (low.some(mt => !mt.onOrder)) { const mt = low.find(x => !x.onOrder); rec = `${mt.name} nachbestellen (${matQty(mt, mt.reorderQty)} bei ${mt.supplier}, Lieferzeit ca. ${durR(mt.leadMin * 60)}).`; addAction(a, reorderAction(mt)); }
    else if (ch.length) rec = `Keine akuten Eingriffe nötig. Nächster Fokus: Werkzeugwechsel ${clk(ch[0].t)} an ${mName(ch[0].machine)} vorbereiten.`;
    else rec = 'Keine akuten Eingriffe nötig – alle Arbeitsplätze laufen planmäßig.';
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = ['Maschinenstatus (' + mvs.length + ' Arbeitsplätze)', 'Prognose / Plantafel', 'Kennzahlen heute', 'Personal', srcStand()];
    a.followups = ['Welche Aufträge sind gefährdet und warum?', 'Was ist der Engpass?', 'Schreib mir die Schichtübergabe'];
    return done(a);
  }
  const dur0 = (sec) => durR(Math.abs(sec));
  const NOSTAFF_RE = /\s*[–-]\s*keine qualifizierte Person im Dienst(\s*\([^)]*\))?/;
  /** Ursache ohne den Zusatz „keine qualifizierte Person im Dienst (…)“ (wird gesammelt genannt) */
  const causeCore = (m) => String(m.cause || '').replace(NOSTAFF_RE, '');
  const noStaff = (m) => (m.state === 'waitOperator' || m.state === 'waitTool') && (NOSTAFF_RE.test(String(m.cause || '')) || !WF.sim.shift().id);
  function settersNext() {
    const sh = WF.sim.shift(), nxt = sh.id === 'F' ? 'S' : 'F';
    const all = Object.values(S().people).filter(p => p.shift === nxt && p.skills.indexOf('toolchange') >= 0 && p.skills.indexOf('setup') >= 0);
    const set = all.filter(p => /^Einrichter/.test(p.role));
    return (set.length ? set : all).map(p => sn(p.name));
  }
  function waitAdvice(c, mv) {
    const sh = WF.sim.shift(), ns = noStaff(mv);
    const startTxt = sh.id ? 'Schichtbeginn' : 'Schichtbeginn ' + clk(sh.endsAt);
    if (mv.state === 'waitTool') {
      if (ns) return `${mName(mv.id)} steht bis zum ${startTxt} – den Werkzeugwechsel dort als Erstes einplanen${settersNext().length ? ' (' + settersNext().join(', ') + ')' : ''}; künftig vor Schichtende vorbeugend wechseln, damit die Maschine in der Geisterschicht weiterläuft.`;
      return `Einrichter:in mit vermessenem Werkzeug zu ${mName(mv.id)} schicken – die Maschine steht, bis gewechselt ist.`;
    }
    if (mv.state === 'waitOperator') {
      if (ns) return `${mName(mv.id)} wartet auf Bedienung bis zum ${startTxt} – dort zuerst einlegen lassen${mv.order ? ' (' + mv.order.id + ')' : ''}.`;
      const free = freePeopleFor(mv.id);
      return free.length ? `${sn(free[0].name)} (${free[0].role}) ist frei und für ${mv.id} qualifiziert – dorthin schicken.` : `Niemand mit passender Qualifikation ist frei – Pausen versetzen, Mehrmaschinenbedienung neu verteilen oder Einrichter:in als Springer einsetzen.`;
    }
    if (mv.state === 'starved') {
      const alt = (mv.queue || []).find(x => x.level > 0);
      if (/Fremdbearbeitung|Härterei/.test(mv.cause)) return `Teile kommen aus der Fremdbearbeitung zurück (${(/Rückkehr ca\. ([^)]+)/.exec(mv.cause) || [])[1] || 'Termin laut Härterei'})${alt ? ' – bis dahin ' + alt.orderId + ' AG ' + alt.seq + ' vorziehen (Material da)' : ' – bis dahin ist an ' + mv.id + ' nichts mit Material eingeplant'}.`;
      if (/Rohmaterial|Rohteile|Lager/.test(mv.cause)) return `Rohmaterial fehlt – nachbestellen bzw. Liefertermin klären${alt ? '; bis dahin ' + alt.orderId + ' AG ' + alt.seq + ' vorziehen' : ''}.`;
      if (/Stangen/.test(mv.cause)) return `Stangen nachladen (Logistik/Stapler)${sh.id ? '' : ' – ab Schichtbeginn'}.`;
      return `Vorgänger-Arbeitsgang bzw. Transport priorisieren${alt ? ' oder ' + alt.orderId + ' AG ' + alt.seq + ' vorziehen (Material da)' : ''}.`;
    }
    if (mv.state === 'blocked') return `Ausgang von ${mv.id} voll – Abholung priorisieren (AGV/Stapler) bzw. Zielpuffer des Nachfolgers prüfen.`;
    return mv.cause;
  }
  /** Geisterschicht: Reihenfolge für den Schichtbeginn (Werkzeug-Stopps, dann Einlegen an Aufträgen mit Terminrisiko) */
  /** wartende Arbeitsplätze ohne Personal im Dienst gesammelt (statt je Zeile „keine qualifizierte Person im Dienst …“) */
  function groupNoStaff(list) {
    if (!list.length) return [];
    const sh = WF.sim.shift(), until = sh.id ? 'bis die passende Qualifikation im Dienst ist' : 'bis Schichtbeginn ' + clk(sh.endsAt);
    const out = [];
    const tl = list.filter(m => m.state === 'waitTool'), op = list.filter(m => m.state !== 'waitTool');
    if (tl.length) out.push(`- **Standzeit-Stopp** ${until}: ${tl.map(m => `${m.id} seit ${clk(m.since)} (${toolShort(causeCore(m).split(':')[0])})`).join(', ')} – gewechselt wird erst mit Einrichter:in.`);
    if (op.length) out.push(`- **Warten auf Personal** ${until}: ${op.map(m => `${m.id} (${causeCore(m)})`).join(', ')}.`);
    return out;
  }
  function morningPlan(c) {
    const mvs = c.mvs(), sh = WF.sim.shift();
    const risk = (m) => { if (!m.order) return 9; const o = c.ov(m.order.id); return o ? (o.risk === 'spät' ? 0 : o.risk === 'knapp' ? 1 : 2) : 9; };
    const tools = mvs.filter(m => m.state === 'waitTool').sort((x, y) => risk(x) - risk(y));
    const ops = mvs.filter(m => m.state === 'waitOperator').sort((x, y) => risk(x) - risk(y));
    const steps = [];
    if (tools.length) steps.push(`Werkzeugwechsel an ${listJoin(tools.map(m => m.id + ' (steht seit ' + clk(m.since) + ')'))}${settersNext().length ? ' – ' + settersNext().join(', ') : ''}`);
    if (ops.length) steps.push(`Einlegen/Prüfen an ${listJoin(ops.slice(0, 4).map(m => m.id + (m.order ? ' (' + m.order.id + (risk(m) === 0 ? ', verspätet' : risk(m) === 1 ? ', knapp' : '') + ')' : '')))}`);
    return steps.length ? `Zum Schichtbeginn ${clk(sh.endsAt)}: ${steps.map((x, i) => (i + 1) + ') ' + x).join('; ')}.` : null;
  }
  function freePeopleFor(mid) {
    const st = station(mid), skill = st && st.skill;
    return Object.values(S().people).filter(p => p.onDuty && !p.endShift && p.state === 'idle' && !p.task && (p.machines.indexOf(mid) >= 0 || (skill && p.skills.indexOf(skill) >= 0)));
  }
  const reorderAction = (mt, qty) => ({ label: `${mt.name} nachbestellen`, desc: `${matQty(mt, qty || mt.reorderQty)} bei ${mt.supplier} · Lieferung ca. ${dueTxt(deliveryT(mt))} · ca. ${eur((qty || mt.reorderQty) * mt.pricePerUnit)}`, action: { type: 'reorder', materialId: mt.id, qty: qty || mt.reorderQty }, icon: 'box' });

  // ------------------------------------------------------------------ Gefährdete Aufträge
  function ansRisk(c, customer) {
    const a = A('risk');
    let open = c.open().filter(o => o.eta != null);
    if (customer) open = open.filter(o => o.customer === customer);
    const late = open.filter(o => o.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec);
    const tight = open.filter(o => o.risk === 'knapp').sort((x, y) => x.slackSec - y.slackSec);
    const scope = customer ? `für ${custShort(customer)}` : '';
    if (!late.length && !tight.length) {
      const min = open.slice().sort((x, y) => x.slackSec - y.slackSec)[0];
      a.md.push(`**Alle ${open.length} offenen Aufträge ${scope} liegen im Plan** (Puffer überall mehr als 4 h).`.replace('  ', ' '));
      if (min) a.md.push('', `Geringster Puffer: **${min.id}** ${min.part.name} (${custShort(min.customer)}) – Prognose ${dueTxt(min.eta)}, Termin ${dueTxt(min.due)}, Puffer ${dur0(min.slackSec)}.`);
      a.md.push('', '> **Empfehlung:** Keine Termin-Maßnahme nötig. Engpass im Blick behalten – „Was ist der Engpass?“ zeigt, wo die nächste Verzögerung entstehen würde.');
    } else {
      a.md.push(`**${late.length ? pl(late.length, 'Auftrag', 'Aufträge') + ' verspätet' : 'Kein Auftrag verspätet'}${tight.length ? ', ' + nm(tight.length) + ' knapp' : ''}** (Puffer unter 4 h) – von ${open.length} offenen Aufträgen${scope ? ' ' + scope : ''}.`, '');
      for (const o of late) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} → **${dur0(o.slackSec)} Verzug**${o.priority === 'eil' ? ' (bereits Eilauftrag)' : ''}. ${orderWhy(c, o)}`);
      for (const o of tight) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – nur **${dur0(o.slackSec)} Puffer**. ${orderWhy(c, o)}`);
      const recs = [];
      if (late.length) { const adv = orderAdvice(c, late[0]); recs.push(adv.text); if (adv.action) addAction(a, adv.action); }
      if (tight.length) {
        const bms = [...new Set(tight.map(bnMachine).filter(Boolean))];
        recs.push(`${listJoin(tight.map(o => o.id))}: ${tight.length === 1 ? 'Termin hält' : 'Termine halten'} knapp – ${bms.length ? (bms.length === 1 ? 'Engpass ' : 'Engpässe ') + listJoin(bms) + ' ohne Unterbrechung laufen lassen und Störungen dort zuerst beheben' : 'Engpass ohne Unterbrechung laufen lassen'}.`);
      }
      a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
      a.impact = { title: 'Prognose gegen Termin', rows: late.concat(tight).slice(0, 6).map(o => ({ id: o.id, label: custShort(o.customer), before: o.eta, after: null, due: o.due })) };
      a.entity = { kind: 'order', id: (late[0] || tight[0]).id };
    }
    a.sources = ['Prognose / Plantafel (veröffentlichte Liefertermine)', 'Arbeitsgang-Kette je Auftrag', srcStand()];
    const first = late[0] || tight[0];
    a.followups = first ? [`Wo steht ${first.id} gerade?`, 'Was ist der Engpass?', first.bottleneck ? `Was passiert, wenn ${first.bottleneck.split(' ')[0]} 2 h ausfällt?` : 'Wie läuft die Schicht?'] : ['Was ist der Engpass?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Engpass
  function ansBottleneck(c) {
    const a = A('bottleneck');
    const loads = machineLoad(c);
    const open = c.open();
    const bnOf = (id) => open.filter(o => o.bottleneck && o.bottleneck.indexOf(id + ' ') === 0);
    const score = (x) => x.days + bnOf(x.id).reduce((s2, o) => s2 + (o.risk === 'spät' ? 1 : o.risk === 'knapp' ? 0.4 : 0), 0);
    const ranked = loads.filter(x => x.work > 0).sort((x, y) => score(y) - score(x));
    const top = ranked[0];
    if (!top) { a.md.push('**Kein Engpass:** Kein Arbeitsplatz hat offene Arbeitsgänge.'); a.sources = ['Plantafel', srcStand()]; return done(a); }
    const mv = c.mv(top.id), bn = bnOf(top.id);
    const capTxt = top.auto ? 'läuft auch unbemannt, 24 h/Tag' : 'bei zwei Schichten';
    a.md.push(`**Engpass: ${mName(top.id)}** – Arbeitsinhalt ca. **${durR(top.work)}** (≈ ${daysTxt(top.days)} ${capTxt}), laut Plantafel belegt bis ${dueTxt(top.until)}.`);
    if (bn.length) a.md.push(`Dort liegt der längste Arbeitsgang von ${listJoin(bn.map(o => o.id + (o.risk !== 'ok' ? ' (' + o.riskLabel.toLowerCase() + ')' : '')))}.`);
    a.md.push('');
    a.md.push(`- Arbeitsvorrat: ${top.ops.slice().sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0)).slice(0, 4).map(x => `${x.orderId} AG ${x.seq} ${durR(x.sec)}${x.active ? ' (läuft)' : ''}`).join(', ')}.`);
    if (mv) {
      if (mv.order) a.md.push(`- Jetzt: ${stLabel(mv.state)} – ${mv.order.id} AG ${mv.order.seq}, Teil ${mv.partsDone}/${mv.partsTotal}, ${nm(mv.order.cycleMin, mv.order.cycleMin < 10 ? 1 : 0)} min je Teil; Arbeitsgang fertig ca. ${tc(mv.etaOpEnd)}.`);
      else a.md.push(`- Jetzt: ${stLabel(mv.state)} – ${mv.cause}.`);
    }
    const others = ranked.slice(1, 4);
    if (others.length) a.md.push(`- Danach am stärksten belastet: ${others.map(x => `${mName(x.id)} ${durR(x.work)} (≈ ${daysTxt(x.days)})`).join('; ')}.`);
    const waits = c.mvs().filter(m => WAIT[m.state] || m.state === 'fault');
    if (waits.length) a.md.push(`- Akut gebremst: ${waits.map(m => `${mName(m.id)} (${stLabel(m.state)})`).join(', ')}.`);
    const alt = altMachines(top.id);
    const recs = [];
    recs.push(top.auto
      ? `${top.id} läuft auch unbemannt – Werkzeug- und Materialreichweite für die Geisterschicht sichern, Rüsten dort möglichst vermeiden.`
      : `${top.id} läuft nur bemannt – Bedienung in Pausen und zum Schichtwechsel sicherstellen; jede Stunde Stillstand dort verschiebt ${bn.length ? listJoin(bn.map(o => o.id)) : 'die nachfolgenden Aufträge'}.`);
    const movable = top.ops.filter(x => !x.active).map(x => ({ x, ok: capableAlts(x.orderId, x.seq, top.id) })).filter(y => y.ok.length);
    recs.push(!alt.length ? `Keine Alternativmaschine im Werk (einzige ${station(top.id).name}).` : movable.length ? `Entlastung möglich: ${movable.slice(0, 2).map(y => `${y.x.orderId} AG ${y.x.seq} auf ${listJoin(y.ok)}`).join('; ')} verlagern (dort neu rüsten).` : `Gleichartige Maschinen (${listJoin(alt)}) können die eingeplanten Arbeitsgänge nicht übernehmen (Gewicht, Durchmesser bzw. Stangenmaterial).`);
    for (const y of movable.slice(0, 1)) addAction(a, { label: `${y.x.orderId} AG ${y.x.seq} auf ${y.ok[0]} verlagern`, desc: `Entlastet ${top.id} um ca. ${durShortTxt(y.x.sec)} – auf ${station(y.ok[0]).short} wird neu gerüstet`, action: { type: 'moveOp', orderId: y.x.orderId, seq: y.x.seq, stationId: y.ok[0] }, icon: 'route' });
    a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
    a.stats = [{ l: top.id + ' ' + top.st.short, v: durShortTxt(top.work), s: 'Engpass · ≈ ' + daysTxt(top.days), c: 'warn' }].concat(others.slice(0, 2).map(x => ({ l: x.id + ' ' + x.st.short, v: durShortTxt(x.work), s: '≈ ' + daysTxt(x.days) })));
    a.sources = ['Arbeitsinhalt offener Arbeitsgänge (Taktzeit, Rüsten)', 'Plantafel', 'Engpass je Auftrag (Prognose)', 'Schichtkalender', srcStand()];
    a.entity = { kind: 'machine', id: top.id };
    a.followups = [`Was passiert, wenn ${top.id} 2 h ausfällt?`, 'Welche Aufträge sind gefährdet und warum?', `Was macht ${top.id} gerade?`];
    return done(a);
  }
  const durShortTxt = (sec) => { const h = sec / 3600; return h >= 10 ? nm(h, 0) + ' h' : h >= 1 ? nm(h, 1) + ' h' : nm(sec / 60) + ' min'; };

  // ------------------------------------------------------------------ Maschine
  /** Personenzeile ohne Doppelungen („Legt Teil in M06 ein · an M06“ → nur Tätigkeit) */
  function actWhere(act, w) {
    act = act || ''; w = w || '';
    const actTxt = /^bereit$/i.test(act) ? 'verfügbar' : act;
    const red = !w || w === 'am Arbeitsplatz' || (w.indexOf('an ') === 0 && act.indexOf(w.slice(3)) >= 0) || (w.indexOf('unterwegs') === 0 && /^(geht|unterwegs|f(ä|ae)hrt|bringt|holt|kommt)/i.test(act)) || (w === 'in der Pause' && /pause/i.test(act)) || (w === 'im Messraum' && /messraum/i.test(act)) || (w === 'in der Werkzeugausgabe' && /werkzeugausgabe/i.test(act));
    return actTxt + (red ? '' : ' · ' + w);
  }
  function personLine(p) { return `${sn(p.name)} (${p.role}) – ${actWhere(p.activity, p.where)}`; }
  function ansMachine(c, id, focus) {
    const a = A('machine'), mv = c.mv(id);
    if (!mv) { a.md.push(`Arbeitsplatz ${id} ist nicht bekannt.`); return done(a); }
    a.entity = { kind: 'machine', id };
    const st = station(id), o = mv.order, fi = faultInfo(mv);
    const waiting = !!WAIT[mv.state];
    const opTools = (mv.tools || []).filter(t => t.status !== 'idle');
    const changes = opTools.filter(t => t.plannedChange && t.plannedChange.etaT != null).sort((x, y) => x.plannedChange.etaT - y.plannedChange.etaT);
    const grp = changes.length ? changes.filter(t => t.plannedChange.afterPart === changes[0].plannedChange.afterPart && t.plannedChange.etaT === changes[0].plannedChange.etaT) : [];
    const pc0 = changes.length ? changes[0].plannedChange : null;
    const chgTxt = pc0 ? `${grp.map(t => toolShort(t.name)).join(' + ')} ${pc0.text}${pc0.by ? ' – ' + pc0.by + (pc0.stage && pc0.stage !== 'offen' ? ', ' + pc0.stage : '') : pc0.stage === 'später' ? ' (wird rechtzeitig angekündigt)' : WF.sim.shift().id ? ' – Einrichter:in noch nicht zugeteilt' : ''}${pc0.waitFromT && !/steht ab|wartet/.test(pc0.text) ? '; Maschine wartet ab ca. ' + clk(pc0.waitFromT) + ' auf den Wechsel' : ''}` : null;
    const since = `seit ${durR(mv.sinceSec)} (${clk(mv.since)})`;
    // Kernaussage – passend zur Frage
    if (focus === 'why' && !waiting && !fi && mv.state === 'running') a.md.push(`**${mName(id)} wartet nicht – sie produziert** ${since}.`, `${uc1(mv.cause)}.`);
    else if (focus === 'tools') {
      if (chgTxt) a.md.push(`**Nächster Werkzeugwechsel an ${mName(id)}: ${grp.map(t => toolShort(t.name)).join(' + ')} ${pc0.text}**${pc0.by ? ' – ' + pc0.by + (pc0.stage && pc0.stage !== 'offen' ? ' (' + pc0.stage + ')' : '') : ''}.`);
      else if (opTools.some(t => t.status === 'changing')) a.md.push(`**An ${mName(id)} wird gerade gewechselt:** ${opTools.filter(t => t.status === 'changing').map(t => toolShort(t.name)).join(', ')}.`);
      else if (opTools.length) a.md.push(`**An ${mName(id)} ist im laufenden Arbeitsgang kein Werkzeugwechsel angekündigt.**`);
      else a.md.push(`**${mName(id)}: ${st.kind === 'machine' ? 'kein eingerichteter Arbeitsgang – Werkzeuge werden beim nächsten Rüsten bestückt' : 'Arbeitsplatz ohne Schneidwerkzeug'}.**`);
      a.md.push(`${mv.stateLabel} ${since}: ${mv.cause}.`);
    } else if (focus === 'impact' && !fi) {
      const aff = affectedOrders(c, id), crit = aff.filter(x => x.o.risk !== 'ok');
      const one = aff.length === 1 ? aff[0].o : null;
      a.md.push(!aff.length ? `**An ${mName(id)} ist nichts eingeplant – kein Einfluss auf Termine.**`
        : one ? `**An ${mName(id)} hängt ${one.id} – ${one.slackSec >= 0 ? (one.risk === 'ok' ? 'Termin hält mit ' + dur0(one.slackSec) + ' Puffer' : 'knapp, nur ' + dur0(one.slackSec) + ' Puffer') : dur0(one.slackSec) + ' Verzug'}.**`
        : `**An ${mName(id)} hängen ${aff.length} Aufträge${crit.length ? `, davon ${crit.length} mit Terminrisiko (${crit.map(x => x.o.id).join(', ')})` : ' – alle mit ausreichend Puffer'}.**`, `${mv.stateLabel} ${since}: ${mv.cause}.`);
    } else if (focus === 'people') {
      const op = mv.operator;
      a.md.push(op ? `**${op.responsible ? 'Zuständig für' : 'An'} ${mName(id)}: ${op.name}** (${op.role}) – ${actWhere(op.activity, op.where)}.` : `**${mName(id)}: ${st.loading === 'auto' ? 'läuft autonom' : 'niemand Zuständiges im Dienst'}.**`, `${mv.stateLabel} ${since}: ${mv.cause}.`);
    } else if (focus === 'eta' && o && mv.etaOpEnd) a.md.push(`**${mName(id)}: ${o.id} AG ${o.seq} fertig ca. ${tc(mv.etaOpEnd)}** – ${mv.partsDone}/${mv.partsTotal} Teile, ${lc1(mv.stateLabel)} ${since}.`, `${uc1(mv.cause)}.`);
    else a.md.push(`**${mName(id)}** (${mv.name}) – **${mv.stateLabel}** ${since}.`, `${waiting || fi ? 'Ursache: ' : ''}${uc1(mv.cause)}.`);
    if (focus === 'full') {
      const crit = affectedOrders(c, id).filter(x => x.o.risk !== 'ok');
      const v = fi ? `Störung – Reparatur bis ca. ${clk(fi.endT)}` : waiting ? `steht (${stLabel(mv.state)})` : mv.state === 'idle' ? 'ohne Auftrag' : SETUPISH[mv.state] ? lc1(mv.stateLabel) + ' – Serie folgt' : 'läuft planmäßig';
      a.md.push(`**Einschätzung:** ${v}${crit.length ? '; Terminrisiko bei ' + listJoin(crit.map(x => `${x.o.id} (${x.o.slackSec >= 0 ? 'Puffer ' + dur0(x.o.slackSec) : dur0(x.o.slackSec) + ' Verzug'})`)) : '; keine gefährdeten Termine an ' + id}.`);
    }
    if (waiting && noStaff(mv) && !WF.sim.shift().id) a.md.push(`Niemand im Dienst – nächste Schicht ab ${dueTxt(WF.sim.shift().endsAt)}.`);
    a.md.push('');
    if (fi) {
      const f = fi.f;
      a.md.push(`- Alarm **${f.code} ${f.text}** – wahrscheinliche Ursache: ${f.cause}.`);
      a.md.push(`- Reparatur: ${fi.who}; Erfahrungswert ${f.repairMin[0]}–${f.repairMin[1]} min, Prognose rechnet mit Ende ca. **${clk(fi.endT)}**.`);
      if (f.partScrapped || f.toolName) a.md.push(`- ${f.partScrapped ? 'Laufendes Teil ist Ausschuss. ' : ''}${f.toolName ? 'Werkzeug ' + toolShort(f.toolName) + ' gebrochen – wird nach der Reparatur gewechselt.' : ''}`);
    }
    if (o && focus !== 'tools') {
      const partTxt = mv.partNo != null ? (mv.partSub === 'load' ? ` – Teil ${mv.partNo} wird eingelegt` : mv.partPaused ? ` – Teil ${mv.partNo} angehalten` : ` – Teil ${mv.partNo} in Bearbeitung, noch ca. ${durR(mv.partRemainSec)}`) : '';
      a.md.push(`- Auftrag **${o.id}** ${o.partName} (${custShort(o.customer)}), AG ${o.seq} „${o.op}“: ${mv.partsDone}/${mv.partsTotal} fertig${partTxt}.`);
      if (focus !== 'eta') a.md.push(`- Arbeitsgang fertig ca. **${tc(mv.etaOpEnd)}**${mv.phase !== 'Serie' ? ' (Phase: ' + mv.phase + ')' : ''}; Auftragstermin ${dueTxt(o.due)}${o.priority === 'eil' ? ', Eilauftrag' : ''}.`);
      else a.md.push(`- Auftragstermin ${dueTxt(o.due)}${o.priority === 'eil' ? ' (Eilauftrag)' : ''}${mv.phase !== 'Serie' ? '; Phase: ' + mv.phase : ''}.`);
    }
    // Werkzeuge
    if (focus === 'tools' && opTools.length) {
      a.md.push('', '### Werkzeuge im Arbeitsgang' + (o ? ` (${o.id} AG ${o.seq}, noch ${teile(Math.max(0, mv.partsTotal - mv.partsDone))})` : ''));
      SLOT(a, 'tools', opTools.map(t => `- ${toolLine(t)}`).join('\n'), opTools.map(t => ({
        name: toolShort(t.name), wear: t.wearPct, after: t.wearAfterPartPct, lim: t.planWearPct, rem: t.remainingParts, status: t.status,
        tag: t.status === 'ok' ? '' : t.plannedChange ? 'Wechsel ' + t.plannedChange.text + (t.plannedChange.by ? ' · ' + sn(t.plannedChange.by) : '') : label('toolStatus', t.status) })));
      const crit = opTools.slice().sort((x, y) => (x.remainingParts == null ? 1e9 : x.remainingParts) - (y.remainingParts == null ? 1e9 : y.remainingParts))[0];
      if (crit && crit.explain) a.md.push('', `~ Regel: ${explainTxt(crit.explain)}`);
      if (pc0 && pc0.note) a.md.push(`Hinweis: ${pc0.note}.`);
    } else if (opTools.length) {
      if (chgTxt) a.md.push(`- **Nächster Werkzeugwechsel:** ${chgTxt}.`);
      else {
        const crit = opTools.slice().sort((x, y) => (x.remainingParts == null ? 1e9 : x.remainingParts) - (y.remainingParts == null ? 1e9 : y.remainingParts))[0];
        if (crit && crit.status !== 'changing' && crit.explain) a.md.push(`- **Werkzeug:** ${explainTxt(crit.explain)}`);
      }
      const chg = opTools.filter(t => t.status === 'changing');
      if (chg.length) a.md.push(`- Gerade im Wechsel: ${chg.map(t => toolShort(t.name)).join(', ')} – ${explainTxt(chg[0].explain)}`);
    }
    if (mv.manualToolChange) a.md.push(`- Vorbeugender Wechsel beauftragt: ${mv.manualToolChange.names.map(toolShort).join(', ')}${mv.manualToolChange.notBefore ? ' (nicht vor ' + clk(mv.manualToolChange.notBefore) + ')' : ''}${mv.manualToolChange.reason ? ' – ' + mv.manualToolChange.reason : ''}.`);
    if (mv.fpi) a.md.push(`- ${mv.fpi.local ? 'Kontrolle des ersten Teils an der Maschine' : 'Erstteil: ' + label('fpiStage', mv.fpi.stage)} – wartet seit ${durR(mv.fpi.waitingSec)}${mv.fpi.reason ? ' (' + mv.fpi.reason + ')' : ''}.`);
    // Personen, Puffer, Warteschlange, Tageswerte
    if (focus !== 'tools') {
      const op = mv.operator;
      if (op && focus !== 'people') a.md.push(`- ${op.responsible ? 'Zuständig' : 'An der Maschine'}: ${personLine(op)}.`);
      if (focus === 'people') { const q2 = PROF().people.filter(p => p.machines.indexOf(id) >= 0); if (q2.length) a.md.push(`- Bediener laut Qualifikation: ${q2.map(p => `${sn(p.name)} (${p.shift === 'F' ? 'Früh' : 'Spät'})`).join(', ')}; Einrichter für alle CNC.`); }
      const others = (mv.people || []).filter(p => !op || p.id !== op.id);
      if (others.length) a.md.push(`- Mit Aufgabe hier: ${others.map(personLine).join('; ')}.`);
      if (!op && !others.length && st.loading !== 'auto') a.md.push(`- Bedienung: niemand Zuständiges im Dienst.`);
      const qty = (arr) => arr.reduce((s2, x) => s2 + (x.qty || 0), 0);
      if (mv.inCap > 0 || mv.outCap > 0) a.md.push(`- Puffer: ${mv.inCap > 0 ? `Eingang ${mv.input.length}/${mv.inCap} Behälter (${stk(qty(mv.input))}), ` : ''}Ausgang ${mv.output.length}/${mv.outCap}${mv.inCap > 0 ? '' : ' Behälter'} (${stk(qty(mv.output))}).`);
      if (mv.barStockM != null) a.md.push(`- Stangenmagazin: ${nm(mv.barStockM, 1)} m ${mv.barMaterial || ''} (nachgeladen wird ab ${nm(mv.barReorderM, 1)} m).`);
      if (mv.queue && mv.queue.length) a.md.push(`- Als Nächstes: ${mv.queue.slice(0, 2).map(q => `${q.orderId} AG ${q.seq} „${q.op}“ (${q.why})`).join('; ')}.`);
      const todayTxt = `- Heute: OEE ${pct(mv.oeeToday && mv.oeeToday.oee, 0)}, ${pl(mv.goodToday, 'Gutteil', 'Gutteile')}, ${nm(mv.scrapToday)} Ausschuss, Stillstandskosten ${eur(mv.lossEurToday)} (Satz ${eur(mv.rate)}/h).`;
      if (!focus || focus === 'full') {
        // Kennzahlen-Leiste statt Textzeile (im kopierten Text bleibt die Zeile erhalten)
        const oee = mv.oeeToday && mv.oeeToday.oee;
        a.stats = [
          { l: 'Status', v: stLabel(mv.state), s: 'seit ' + durR(mv.sinceSec), c: mv.state === 'fault' ? 'crit' : WAIT[mv.state] ? 'warn' : mv.state === 'running' ? 'ok' : 'info' },
          o ? { l: 'AG ' + o.seq + ' · Teile', v: nm(mv.partsDone) + '/' + nm(mv.partsTotal), s: mv.etaOpEnd ? 'fertig ca. ' + tc(mv.etaOpEnd) : o.id } : { l: 'Auftrag', v: '–', s: mv.queue && mv.queue.length ? 'als Nächstes ' + mv.queue[0].orderId : 'nichts eingeplant' },
          { l: 'OEE heute', v: oee != null ? pct(oee, 0) : '–', s: pl(mv.goodToday, 'Gutteil', 'Gutteile') + (mv.scrapToday ? ' · ' + nm(mv.scrapToday) + ' Ausschuss' : ''), c: oee == null ? '' : oee >= TARGET_OEE ? 'ok' : 'warn' },
          { l: 'Stillstand', v: eur(mv.lossEurToday), s: 'heute · ' + eur(mv.rate) + '/h', c: 'info' },
        ];
        SLOT(a, 'today', todayTxt, null);
      } else if (focus !== 'eta') a.md.push(todayTxt);
    }
    // Auswirkung (Störung/Wartezeit oder ausdrücklich gefragt)
    if (focus === 'impact' || focus === 'full' || fi || (waiting && mv.sinceSec >= 300)) {
      const aff = affectedOrders(c, id);
      if (aff.length) {
        a.md.push('', '### Auswirkung auf Termine');
        for (const x of aff.slice(0, 5)) a.md.push(`- **${x.o.id}** (${custShort(x.o.customer)}, AG ${x.seq}${x.active ? ', läuft hier' : ', ab ca. ' + tc(x.start)}): Prognose ${dueTxt(x.o.eta)}, Termin ${dueTxt(x.o.due)} – ${x.o.slackSec >= 0 ? 'Puffer ' + dur0(x.o.slackSec) : dur0(x.o.slackSec) + ' Verzug'}.`);
        if (fi || waiting) a.md.push(`Die Prognose enthält ${fi ? 'die Reparatur bis ca. ' + clk(fi.endT) : 'die bisherige Wartezeit'} bereits.`);
        a.impact = { title: 'Termine an ' + id, rows: aff.slice(0, 6).map(x => ({ id: x.o.id, label: 'AG ' + x.seq, before: x.o.eta, after: null, due: x.o.due })) };
      } else a.md.push('', `Keine offenen Arbeitsgänge an ${id} eingeplant – kein Einfluss auf Termine.`);
    }
    // Empfehlung
    let rec = null;
    if (fi) {
      const aff = affectedOrders(c, id);
      const hit = aff.filter(x => x.active || x.start <= fi.endT), later = aff.filter(x => !x.active && x.start > fi.endT);
      const parts = [`${fi.working ? 'Reparatur läuft' : fi.person ? sn(fi.person.name) + ' ist unterwegs' : 'Instandhaltung zu ' + id + ' schicken'} – Ende ca. ${clk(fi.endT)}, in der Prognose bereits enthalten.`];
      if (hit.length) {
        const tight = hit.filter(x => x.o.risk !== 'ok');
        parts.push(`Direkt betroffen: ${listJoin(hit.map(x => x.o.id + (x.o.slackSec < 0 ? ' (bereits ' + dur0(x.o.slackSec) + ' Verzug)' : ' (Puffer ' + dur0(x.o.slackSec) + ')')))}.`);
        if (tight.length && tight[0].o.slackSec >= 0) parts.push(`Dauert die Reparatur mehr als ca. ${dur0(tight[0].o.slackSec)} länger, kippt ${tight[0].o.id}.`);
        else if (!tight.length) parts.push('Termine halten – keine weitere Maßnahme nötig.');
      } else parts.push('Kein laufender Auftrag betroffen.');
      const d0 = Math.floor(c.t / DAY) * DAY;
      const nF = (S().events || []).filter(e => e.type === 'fault' && e.t >= d0 && e.entity && e.entity.id === id).length;
      if (nF > 1) parts.push(`Schon die ${nF}. Störung heute an ${id} – Ursache (${fi.f.cause}) dauerhaft abstellen.`);
      if (later.length) parts.push(`${later[0].o.id} beginnt hier erst ca. ${tc(later[0].start)} – bis dahin ${durR(later[0].start - fi.endT)} Reserve.`);
      rec = parts.join(' ');
      if (mv.fault.manual) addAction(a, { label: `Störung an ${id} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort – die Maschine nimmt die Arbeit wieder auf.', action: { type: 'repair', machineId: id }, icon: 'wrench' });
    } else if (waiting) rec = waitAdvice(c, mv);
    else if (mv.state === 'firstPiece') rec = `Erstteil zügig prüfen – ${id} darf bis zur Freigabe nicht weiterfertigen (Stillstand ${eur(mv.rate)}/h).`;
    else if (mv.state === 'idle') rec = mv.queue && mv.queue.length ? `Freie Kapazität bis zum nächsten Arbeitsgang ${mv.queue[0].orderId} AG ${mv.queue[0].seq} (${mv.queue[0].why}).` : `${id} hat keinen eingeplanten Arbeitsgang – freie Kapazität für Verlagerungen oder neue Aufträge.`;
    else if (pc0 && pc0.etaT - c.t < 3600) rec = `Werkzeug für den Wechsel ca. ${clk(pc0.etaT)} vermessen bereitlegen – dann dauert der Stopp nur die reine Wechselzeit.`;
    else if (focus === 'full' || focus === 'impact') {
      const crit = affectedOrders(c, id).filter(x => x.o.risk !== 'ok');
      rec = crit.length ? orderAdvice(c, crit[0].o).text : `${id} läuft planmäßig – keine Maßnahme nötig.`;
    }
    if (rec) a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = [`Maschinenstatus ${id} (${label('conn', mv.conn.level)})`, 'Werkzeugstandzeiten', 'Prognose / Plantafel', srcStand()];
    const fu = [];
    if (focus !== 'tools' && opTools.length) fu.push(`Wann ist der nächste Werkzeugwechsel an ${id}?`);
    if (focus !== 'impact' && affectedOrders(c, id).length) fu.push(fi ? `Was bedeutet die Störung an ${id} für die Termine?` : `Welche Termine hängen an ${id}?`);
    fu.push(`Was passiert, wenn ${id} 2 h ausfällt?`);
    if (o) fu.push(`Wo steht ${o.id} gerade?`);
    a.followups = fu.slice(0, 3);
    return done(a);
  }
  /** Regeltext der Engine lesbarer machen („≤ 0 Teile Reststandzeit“ = Wechsel, sobald kein weiteres Teil mehr reicht) */
  const explainTxt = (x) => String(x || '').replace(/Wechselgrenze\s*≤\s*0\s*Teile\s*Reststandzeit/g, 'Wechselgrenze: Reststandzeit reicht für kein weiteres Teil');
  function toolLine(t) {
    const s = t.status;
    const wear = t.wearPct != null ? nm(t.wearPct, 0) + ' % Verschleiß' : '';
    const rem = t.remainingParts != null && isFinite(t.remainingParts) ? ', noch ' + teile(t.remainingParts) : '';
    const pc = t.plannedChange;
    const stTxt = s === 'ok' || (s === 'planned' && pc) ? '' : ' – ' + label('toolStatus', s);
    return `**${toolShort(t.name)}**: ${wear}${rem}${stTxt}${pc ? ' · Wechsel ' + pc.text + (pc.by ? ' (' + pc.by + ')' : '') : ''}`;
  }
  /** Aufträge mit Arbeitsgängen auf dieser Maschine (laut Plantafel, laufender zuerst) */
  function affectedOrders(c, id) {
    const list = (c.fc().machines[id] || []).slice().sort((a, b) => a.start - b.start);
    const out = [];
    for (const e of list) { const o = c.ov(e.orderId); if (o && o.status !== 'fertig' && !out.some(x => x.o.id === o.id)) out.push({ o, seq: e.seq, active: e.active, start: e.start, end: e.end, opEnd: e.opEnd }); }
    return out;
  }

  // ------------------------------------------------------------------ Auftrag
  function ansOrder(c, id, focus) {
    const a = A('order'), o = c.ov(id);
    if (!o) { a.md.push(`Auftrag ${id} ist nicht bekannt.`); return done(a); }
    a.entity = { kind: 'order', id };
    a.md.push(`**${o.id}** ${o.part.name} (${o.part.no}) für ${o.customer} – ${stk(o.qty)}, Termin **${dueTxt(o.due)}**${o.priority === 'eil' ? ', **Eilauftrag**' : ''}.`);
    if (o.status === 'fertig') {
      a.md.push(`Fertig ${dueTxt(o.doneT)} – ${o.onTime ? 'termingerecht und vollständig' : o.shortQty > 0 ? 'Teillieferung, Fehlmenge ' + stk(o.shortQty) : 'nach dem Termin'} (${stk(o.shippedQty)} versandt).`);
      a.sources = ['Auftrag ' + id, srcStand()];
      return done(a);
    }
    const slackTxt = o.slackSec >= 0 ? `Puffer ${dur0(o.slackSec)}` : `**${dur0(o.slackSec)} Verzug**`;
    a.md.push(`Prognose fertig **${dueTxt(o.eta)}** – ${slackTxt} (${o.riskLabel}); Fortschritt ${pct(o.progress)}${o.shippedQty ? ', ' + stk(o.shippedQty) + ' versandt' : ''}.${o.etaPending ? ` Eine Neuberechnung (${dueTxt(o.etaPending)}) wird gerade bestätigt.` : ''}`);
    a.md.push('', '### Arbeitsgänge');
    const routeTxt = [], route = [];
    for (const op of o.ops) {
      const isM = !!S().machines[op.station];
      const r = { seq: op.seq, op: op.op, station: op.station, st: 'plan', pill: 'geplant', sub: '', pct: null, c: 'var(--faint)' };
      if (op.station === 'VERSAND' && !op.complete && op.state === 'open') {
        routeTxt.push(`- AG ${op.seq} ${op.op}: nach Abschluss ca. ${tc(o.eta)}`);
        Object.assign(r, { st: 'ship', pill: 'Versand', sub: `nach Abschluss ca. ${tc(o.eta)}`, c: 'var(--muted)' }); route.push(r); continue;
      }
      const where = op.station === 'EXT' ? 'extern' : op.station === 'VERSAND' ? 'Versand' : mName(op.station);
      let s;
      if (op.complete) {
        s = `fertig (${nm(op.good)}/${nm(op.targetIn)}${op.scrap ? ', ' + nm(op.scrap) + ' Ausschuss' : ''})`;
        Object.assign(r, { st: 'done', pill: 'fertig', sub: `${nm(op.good)}/${nm(op.targetIn)} gut${op.scrap ? ' · ' + nm(op.scrap) + ' Ausschuss' : ''}${op.endT ? ' · ' + tc(op.endT) : ''}`, c: 'var(--st-run)', pct: 1 });
      } else if (op.state === 'active') {
        const mv = isM ? c.mv(op.station) : null;
        const stopTxt = mv && (WAIT[mv.state] || mv.state === 'fault') ? mv.cause : '';
        s = `**${mv ? stLabel(mv.state) : 'in Bearbeitung'}** – ${nm(op.good + op.scrap)}/${nm(op.target)}${stopTxt ? ': ' + stopTxt : ''}${mv && mv.etaOpEnd ? ', fertig ca. ' + tc(mv.etaOpEnd) : ''}`;
        const col = mv ? ((WF.STATE[mv.state] || {}).color || 'var(--st-run)') : 'var(--st-run)';
        Object.assign(r, { st: 'act', pill: mv ? stLabel(mv.state) : 'in Bearbeitung', c: col, pct: op.target ? Math.min(1, (op.good + op.scrap) / op.target) : null,
          sub: `${nm(op.good + op.scrap)}/${nm(op.target)}${stopTxt ? ' · ' + stopTxt : ''}${mv && mv.etaOpEnd ? ' · fertig ca. ' + tc(mv.etaOpEnd) : ''}` });
      } else if (op.state === 'external') {
        s = `**in Fremdbearbeitung** – ${op.ext ? op.ext.returnText : ''}`;
        Object.assign(r, { st: 'ext', pill: 'extern', c: 'var(--info)', sub: `${op.ext ? (op.ext.partner ? op.ext.partner + ' · ' : '') + op.ext.returnText : 'in Fremdbearbeitung'}` });
      } else if (op.state === 'waiting') {
        const b = isM ? blockerOn(c, op.station, o.id, op.seq) : null;
        s = `wartet${op.waiting ? ' (' + stk(op.waiting) + ' im Eingang)' : ''}${op.good ? ', ' + nm(op.good) + ' fertig' : ''}${b ? ' – ' + b.text : ''}${op.plannedStart ? '; geplant ' + tc(op.plannedStart) + '–' + tc(op.plannedEnd) : ''}`;
        const bl = b ? (b.running.length ? `nach ${b.running[0].orderId} AG ${b.running[0].seq} (läuft bis ${tc(b.running[0].end)})` : `nach ${listJoin(b.before.slice(0, 2).map(e => e.orderId + ' AG ' + e.seq))}`) : '';
        Object.assign(r, { st: 'wait', pill: 'wartet', c: 'var(--st-wait)', pct: op.target && op.good ? Math.min(1, op.good / op.target) : null,
          sub: [op.waiting ? stk(op.waiting) + ' im Eingang' : '', op.good ? nm(op.good) + ' fertig' : '', bl, op.plannedStart ? 'geplant ' + tc(op.plannedStart) + ' – ' + tc(op.plannedEnd) : ''].filter(Boolean).join(' · ') });
      } else {
        s = op.plannedStart ? `geplant ${tc(op.plannedStart)} – ${tc(op.plannedEnd)}` : 'offen';
        Object.assign(r, { sub: op.plannedStart ? `${tc(op.plannedStart)} – ${tc(op.plannedEnd)}` : 'noch nicht eingeplant', pill: op.station === 'EXT' ? 'extern' : 'geplant' });
        if (op.station === 'EXT' && op.ext && op.ext.partner) r.sub = op.ext.partner + ' · ' + r.sub;
      }
      r.where = where;
      routeTxt.push(`- AG ${op.seq} ${op.op} · ${where}: ${s}`);
      route.push(r);
    }
    SLOT(a, 'route', routeTxt.join('\n'), route);
    const cont = o.containers.filter(x => x.state !== 'shipped' && x.state !== 'scrap');
    if (cont.length && focus !== 'eta') a.md.push('', `Behälter: ${cont.slice(0, 4).map(x => `${stk(x.qty)} ${x.where}`).join('; ')}${cont.length > 4 ? ' (+' + (cont.length - 4) + ')' : ''}.`);
    if (o.bottleneck) a.md.push('', `Engpass laut Prognose: ${o.bottleneck}.`);
    let advTxt = '';
    if (o.risk !== 'ok') {
      const adv = orderAdvice(c, o); advTxt = adv.text;
      a.md.push('', '> **Empfehlung:** ' + adv.text);
      addAction(a, adv.action);
    } else a.md.push('', `> **Einschätzung:** Termin hält nach aktueller Prognose – keine Maßnahme nötig.`);
    a.impact = { title: 'Prognose gegen Termin', rows: [{ id: o.id, label: custShort(o.customer), before: o.eta, after: null, due: o.due }] };
    a.sources = ['Auftrag ' + id + ' (Arbeitsgang-Kette)', 'Prognose / Plantafel', 'Behälterorte', srcStand()];
    const cur = curOp(o);
    a.followups = [cur && S().machines[cur.station] ? `Was macht ${cur.station} gerade?` : 'Welche Aufträge sind gefährdet und warum?', o.bottleneck ? `Was passiert, wenn ${o.bottleneck.split(' ')[0]} 2 h ausfällt?` : 'Was ist der Engpass?'];
    if (o.priority !== 'eil' && o.risk !== 'ok' && !/nur verschieben|hilft hier nicht|bringt hier nichts/.test(advTxt)) a.followups.unshift(`${o.id} als Eilauftrag kennzeichnen`);
    return done(a);
  }
  function ansCustomer(c, customer) {
    const a = A('customer');
    const list = c.ovs().filter(o => o.customer === customer);
    a.md.push(`**${customer}:** ${pl(list.filter(o => o.status !== 'fertig').length, 'offener Auftrag', 'offene Aufträge')}${list.some(o => o.status === 'fertig') ? ', ' + list.filter(o => o.status === 'fertig').length + ' fertig' : ''}.`, '');
    for (const o of list) a.md.push(`- **${o.id}** ${o.part.name}, ${stk(o.qty)}: ${o.status === 'fertig' ? 'fertig ' + dueTxt(o.doneT) + (o.onTime ? ' (termingerecht)' : '') : 'Prognose ' + dueTxt(o.eta) + ', Termin ' + dueTxt(o.due) + ' – ' + o.riskLabel + (o.slackSec != null ? ' (' + (o.slackSec >= 0 ? 'Puffer ' : 'Verzug ') + dur0(o.slackSec) + ')' : '')}`);
    a.sources = ['Aufträge ' + custShort(customer), 'Prognose', srcStand()];
    a.followups = list.filter(o => o.status !== 'fertig').slice(0, 2).map(o => `Wo steht ${o.id} gerade?`);
    return done(a);
  }

  // ------------------------------------------------------------------ Werkzeuge
  function ansTools(c, q) {
    const a = A('tools'), t = c.t, sh = WF.sim.shift();
    let until = t + 2 * 3600, horizon = 'in den nächsten 2 Stunden';
    if (/heute|bis abend|tagsueber/.test(q)) { until = Math.floor(t / DAY) * DAY + 22 * 3600; horizon = 'bis 22:00'; }
    else if (/schicht/.test(q) && sh.id) { until = sh.endsAt; horizon = 'bis Schichtende ' + clk(sh.endsAt); }
    else if (/nacht|geisterschicht|morgen frueh/.test(q)) { until = t + 12 * 3600; horizon = 'in den nächsten 12 Stunden'; }
    else { const m = /(\d+)\s*(h|std|stunden?)/.exec(q); if (m) { until = t + Number(m[1]) * 3600; horizon = `in den nächsten ${m[1]} Stunden`; } }
    if (until <= t) until = t + 2 * 3600;
    const ch = plannedChanges(c, until);
    const mvs = c.mvs();
    const nowTools = [];
    for (const mv of mvs) for (const tl of mv.tools || []) if (tl.status === 'due' || tl.status === 'broken' || tl.status === 'changing') nowTools.push({ mv, tl });
    a.md.push(ch.length ? `**${pl(ch.length, 'Werkzeugwechsel', 'Werkzeugwechsel')} ${horizon}** (bis ${tc(until)}):` : `**Kein Werkzeugwechsel ${horizon}** (bis ${tc(until)}).`, '');
    for (const g of ch.slice(0, 8)) {
      const late = sh.id && g.t > sh.endsAt && !nextShiftStaffed(g.t);
      const waitNow = g.waitFromT != null && g.waitFromT <= t + 60;
      a.md.push(`- **${tc(g.t)}** ${mName(g.machine)} – ${g.tools.map(x => toolShort(x.name)).join(' + ')} nach Teil ${g.afterPart}${g.tools.length === 1 && g.tools[0].wearAfterPartPct != null && !waitNow ? ' (dann ' + nm(g.tools[0].wearAfterPartPct, 0) + ' % Verschleiß)' : ''} · ${g.by ? g.by + (g.stage && g.stage !== 'offen' ? ', ' + g.stage : '') : g.stage === 'später' ? 'wird später angekündigt' : sh.id ? 'noch nicht zugeteilt' : 'mit der Frühschicht'}${g.manual ? ' · vorbeugend beauftragt' : ''}${g.waitFromT ? (waitNow ? ' · Maschine steht bereits' : ' · Maschine wartet ab ' + clk(g.waitFromT)) : ''}${late ? ' · außerhalb der Schicht' : ''}`);
    }
    if (ch.length > 8) a.md.push(`- … und ${ch.length - 8} weitere.`);
    const waitT = mvs.filter(m => m.state === 'waitTool');
    const nowOther = nowTools.filter(x => !waitT.some(m => m.id === x.mv.id));
    if (nowOther.length) a.md.push('', `Jetzt: ${nowOther.map(x => `${mName(x.mv.id)} ${toolShort(x.tl.name)} – ${label('toolStatus', x.tl.status)}`).join('; ')}.`);
    if (waitT.length) a.md.push('', `Wartet auf Werkzeug: ${waitT.map(m => `${mName(m.id)} seit ${clk(m.since)} (${causeCore(m)})`).join('; ')}${waitT.some(noStaff) && !sh.id ? ` – niemand im Dienst bis ${clk(sh.endsAt)}` : ''}.`);
    // Werkzeugausgabe: kein vermessenes Werkzeug für anstehende Wechsel
    const stock = S().toolStock || {};
    const empty = [];
    for (const g of ch) for (const tl of g.tools) if (stock[tl.typeId] && stock[tl.typeId].ready <= 0 && empty.indexOf(tl.typeId) < 0) empty.push(tl.typeId);
    if (empty.length) a.md.push(`Werkzeugausgabe: kein vermessenes ${empty.map(x => toolShort((PROF().toolTypeById[x] || {}).name || x)).join(', ')} vorrätig – Voreinstellen verlängert den Wechsel um einige Minuten.`);
    const k = c.k();
    a.md.push('', `Heute bisher ${pl(k.toolChangesToday || 0, 'Werkzeugwechsel', 'Werkzeugwechsel')}, Werkzeugkosten ${eur(k.toolCostToday)}.`);
    const ghost = c.notifs().filter(n => String(n.key).indexOf('ghost:') === 0);
    if (ghost.length) a.md.push(`Geisterschicht: ${ghost.map(n => n.title.replace('Geisterschicht: ', '')).join('; ')}.`);
    let rec;
    if (waitT.length && waitT.every(noStaff)) rec = `${listJoin(waitT.map(m => m.id))} ${waitT.length === 1 ? 'steht' : 'stehen'} bis zum Schichtbeginn – Wechsel dort als Erstes${settersNext().length ? ' (' + settersNext().join(', ') + ')' : ''}; künftig vor Schichtende vorbeugend wechseln.`;
    else if (waitT.length) rec = `Einrichter:in sofort zu ${listJoin(waitT.filter(m => !noStaff(m)).map(m => m.id))} – die Maschine steht, bis das Werkzeug gewechselt ist.`;
    else if (ch.some(g => g.waitFromT)) { const g = ch.find(x => x.waitFromT); rec = `${g.machine}: Einrichter:in kommt voraussichtlich erst nach der Teilegrenze – früher losschicken, sonst steht die Maschine ab ca. ${clk(g.waitFromT)}.`; }
    else if (ch.length) rec = `Werkzeuge für die Wechsel bis ${clk(ch[Math.min(2, ch.length - 1)].t)} vermessen bereitlegen; Wechsel an derselben Maschine werden automatisch gebündelt.`;
    else rec = 'Keine Werkzeugaktion nötig – die Standzeiten reichen über den Zeitraum.';
    if (ghost.length && ghost[0].actions && ghost[0].actions.find(x => x.action.type === 'planToolChange')) { const ga = ghost[0].actions.find(x => x.action.type === 'planToolChange'); addAction(a, { label: ga.label + ' (' + ghost[0].entity.id + ')', desc: ghost[0].suggestion, action: ga.action, icon: 'wrench' }); }
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = ['Werkzeugstandzeiten je Maschine', 'Wechselplanung (Teilegrenze, Einrichter)', 'Werkzeugausgabe', srcStand()];
    a.followups = ch.length ? [`Wann ist der nächste Werkzeugwechsel an ${ch[0].machine}?`, 'Wo verlieren wir heute Geld?'] : ['Wie läuft die Schicht?'];
    return done(a);
  }
  function nextShiftStaffed(t) { const s = t % DAY, d = Math.floor(t / DAY) % 7; return d < 5 && s >= 6 * 3600 && s < 22 * 3600; }

  // ------------------------------------------------------------------ Material
  function ansMaterial(c, ids) {
    const a = A('material');
    const { need, users } = materialNeeds();
    const mats = Object.values(S().materials).filter(mt => !ids || !ids.length || ids.indexOf(mt.id) >= 0);
    const rows = mats.map(mt => {
      const nd = need[mt.id] || 0;
      const status = mt.onHand < mt.min ? 'unter' : mt.onHand + mt.onOrder < nd ? 'fehlt' : mt.onHand < mt.min * 1.2 ? 'knapp' : 'ok';
      return { mt, nd, status };
    });
    const rank = { unter: 0, fehlt: 1, knapp: 2, ok: 3 };
    rows.sort((x, y) => rank[x.status] - rank[y.status] || x.mt.onHand / x.mt.min - y.mt.onHand / y.mt.min);
    const crit = rows.filter(r => r.status !== 'ok');
    const single = ids && ids.length === 1;
    if (single) {
      const r = rows[0], mt = r.mt;
      a.entity = { kind: 'material', id: mt.id };
      a.md.push(`**${mt.name}** (${mt.id}): Bestand **${matQty(mt, mt.onHand)}**, Mindestbestand ${matQty(mt, mt.min)}${mt.onOrder ? ', bestellt ' + matQty(mt, mt.onOrder) : ''} – Lagerort ${WF.sim.stationName(mt.location)}.`, '');
      a.md.push(`- Bedarf offener Aufträge (noch nicht ausgebucht): ca. ${matQty(mt, r.nd)}${(users[mt.id] || []).length ? ' – ' + users[mt.id].map(u => `${u.orderId}: ${nm(u.parts)} × ${nm(u.perPart, u.perPart < 1 ? 3 : 0)} ${mt.unit}`).join(', ') : ''}.`);
      a.md.push(`- ${mt.onHand >= r.nd ? 'Bestand reicht für alle offenen Aufträge' + (mt.onHand - r.nd < mt.min ? ', danach unter Mindestbestand' : '') : 'Bestand reicht nicht: es fehlen ca. ' + matQty(mt, r.nd - mt.onHand) + (mt.onOrder ? ' (Bestellung deckt ' + (mt.onHand + mt.onOrder >= r.nd ? 'den Rest' : 'nur einen Teil') + ')' : '')}.`);
      if (mt.usedToday) a.md.push(`- Verbrauch heute: ${matQty(mt, mt.usedToday)}.`);
      for (const p of openPurchases(mt.id)) a.md.push(`- Bestellung ${p.id}: ${matQty(mt, p.qty)} bei ${p.supplier}, Lieferung ca. ${dueTxt(p.etaT)}.`);
      a.md.push(`- Lieferant: ${mt.supplier}, Lieferzeit ca. ${durR(mt.leadMin * 60)}, ${eur(mt.pricePerUnit)} je ${mt.unit}.`);
      if (r.status !== 'ok' && !mt.onOrder) { addAction(a, reorderAction(mt)); a.md.push('', `> **Empfehlung:** Nachbestellen (${matQty(mt, mt.reorderQty)}, ca. ${eur(mt.reorderQty * mt.pricePerUnit)}).`); }
    } else {
      a.md.push(crit.length ? `**${pl(crit.length, 'Material braucht', 'Materialien brauchen')} Aufmerksamkeit**, ${rows.length - crit.length} im grünen Bereich:` : `**Alle ${rows.length} Rohmaterialien im grünen Bereich** – Bestand über Mindestbestand und ausreichend für die offenen Aufträge.`, '');
      for (const r of (crit.length ? crit : rows.slice(0, 4))) {
        const mt = r.mt;
        const covers = mt.onHand >= r.nd;
        const st = r.status === 'unter' ? (covers ? 'unter Mindestbestand, reicht aber für die offenen Aufträge' : 'unter Mindestbestand und zu wenig für die offenen Aufträge') : r.status === 'fehlt' ? 'reicht nicht für die offenen Aufträge' : r.status === 'knapp' ? 'knapp über Mindestbestand' : 'ausreichend';
        a.md.push(`- **${mt.name}**: ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}) – ${st}; Bedarf offener Aufträge ca. ${matQty(mt, r.nd)}${mt.onOrder ? '; bestellt ' + matQty(mt, mt.onOrder) + (openPurchases(mt.id)[0] ? ', Lieferung ca. ' + dueTxt(openPurchases(mt.id)[0].etaT) : '') : ''}.`);
      }
      const starved = c.mvs().filter(m => m.state === 'starved');
      if (starved.length) a.md.push(`- Wartet auf Material: ${starved.map(m => `${mName(m.id)} – ${m.cause}`).join('; ')}.`);
      const bars = c.mvs().filter(m => m.barStockM != null);
      for (const m of bars) a.md.push(`- ${mName(m.id)}: Stangenmagazin ${nm(m.barStockM, 1)} m ${m.barMaterial || ''}${m.barStockM < (m.barReorderM || 0) ? ' – wird nachgeladen' : ''}.`);
      const pur = openPurchases();
      if (pur.length) a.md.push(`- Offene Bestellungen: ${pur.map(p => `${p.id} ${matQty(S().materials[p.materialId], p.qty)} ${S().materials[p.materialId].name}, Lieferung ca. ${dueTxt(p.etaT)}`).join('; ')}.`);
      const toOrder = crit.filter(r => !r.mt.onOrder && r.status !== 'knapp');
      for (const r of toOrder) addAction(a, reorderAction(r.mt));
      a.md.push('', '> **Empfehlung:** ' + (toOrder.length ? `${toOrder.map(r => r.mt.name).join(', ')} nachbestellen – ${toOrder.length === 1 ? 'Bestellvorschlag' : 'Bestellvorschläge'} unten.` : crit.length ? 'Bestellungen laufen; Liefertermine im Blick behalten.' : 'Keine Bestellung nötig.'));
    }
    a.sources = ['Rohmaterialbestände', 'Bedarf aus offenen Arbeitsgängen', 'Bestellungen', srcStand()];
    a.followups = single ? ['Welches Material wird knapp?', 'Wie läuft die Schicht?'] : ['Was machen die AGVs gerade?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Personal
  function ansPeople(c, ids, roles) {
    const a = A('people');
    const all = Object.values(S().people);
    let list = all;
    if (ids && ids.length) list = all.filter(p => ids.indexOf(p.id) >= 0);
    else if (roles && roles.length) list = all.filter(p => roles.some(r => p.role.indexOf(r) === 0));
    const whereMap = {};
    for (const mv of c.mvs()) for (const p of [mv.operator].concat(mv.people || [])) if (p && !p.responsible) whereMap[p.id] = p.where;
    const whereOf = (p) => whereMap[p.id] || personWhere(p);
    if ((!ids || !ids.length) && roles && roles.length) { const onR = list.filter(p => p.state !== 'offShift'); if (onR.length === 1) { ids = [onR[0].id]; list = onR; } }
    if (ids && ids.length === 1) {
      const p = list[0];
      a.entity = { kind: 'person', id: p.id };
      a.md.push(`**${p.name}** (${p.id}, ${p.role}, ${p.shift === 'F' ? 'Frühschicht' : 'Spätschicht'}) – **${p.state === 'idle' ? 'verfügbar' : label('person', p.state)}**${p.state !== 'offShift' && p.state !== 'break' ? ', ' + whereOf(p) : ''}.`);
      if (p.state !== 'offShift') {
        if (!/^bereit$/i.test(p.activity || '')) a.md.push(`Tätigkeit: ${p.activity}.`);
        a.md.push('');
        if (p.task) { const tl = p.task.label || label('task', p.task.type); a.md.push(`- Aufgabe: ${tl}${p.task.machineId && tl.indexOf(p.task.machineId) < 0 ? ' an ' + mName(p.task.machineId) : ''}.`); }
        a.md.push(`- Auslastung heute ${pct(p.utilToday)}, ${pl(p.tasksToday || 0, 'Aufgabe', 'Aufgaben')} erledigt.`);
      } else a.md.push('', `- ${p.shift === 'F' ? 'Frühschicht 06:00–14:00' : 'Spätschicht 14:00–22:00'}.`);
      if (p.machines && p.machines.length) a.md.push(`- Zuständig für: ${p.machines.map(mName).join(', ')}.`);
      a.md.push(`- Qualifikationen: ${p.skills.map(skillLabel).join(', ')}.`);
      a.sources = ['Personaleinsatz live', srcStand()];
      a.followups = p.machines && p.machines.length ? [`Was macht ${p.machines[0]} gerade?`, 'Wer ist gerade wo?'] : ['Wer ist gerade wo?'];
      return done(a);
    }
    const on = list.filter(p => p.state !== 'offShift');
    const sh = WF.sim.shift();
    if (!on.length) {
      a.md.push(`**Niemand ${roles && roles.length ? 'aus dieser Rolle ' : ''}im Dienst** (${sh.id ? sh.name : 'keine Schicht'}).`);
      if (!sh.id) a.md.push(`Nächster Schichtbeginn ${dueTxt(sh.endsAt)} – bis dahin laufen nur autonome Maschinen (Geisterschicht).`);
    } else {
      const by = (s) => on.filter(p => p.state === s);
      const nw = by('working').length + by('driving').length, nwk = by('walking').length, ni = by('idle').length, nb = by('break').length;
      const parts = [nw ? nw + ' ' + (nw === 1 ? 'arbeitet' : 'arbeiten') : '', nwk ? nwk + ' unterwegs' : '', ni ? ni + ' verfügbar' : '', nb ? nb + ' in Pause' : ''].filter(Boolean);
      a.md.push(`**${on.length} ${on.length === 1 ? 'Person' : 'Personen'} ${roles && roles.length ? '(' + roles.join(', ') + ') ' : ''}im Dienst** (${sh.id ? sh.name : 'Übergabe'}): ${parts.join(', ')}.`, '');
      const order = { working: 0, driving: 0, walking: 1, idle: 2, break: 3 };
      for (const p of on.slice().sort((x, y) => (order[x.state] - order[y.state]) || x.id.localeCompare(y.id))) a.md.push(`- **${sn(p.name)}** (${p.role}) – ${p.state === 'idle' ? 'verfügbar' + (/^bereit$/i.test(p.activity || '') ? '' : ': ' + p.activity) : label('person', p.state) + ': ' + actWhere(p.activity, p.state === 'break' ? '' : whereOf(p))}`);
    }
    const wo = c.mvs().filter(m => m.state === 'waitOperator' && m.sinceSec >= 120);
    if (wo.length && wo.every(noStaff)) a.md.push('', ...groupNoStaff(wo));
    else if (wo.length) a.md.push('', `Warten auf Bedienung: ${wo.map(m => `${mName(m.id)} – ${m.cause}`).join('; ')}.`);
    if (sh.id) {
      const next = all.filter(p => p.shift !== sh.id);
      a.md.push('', `Nächste Schicht (${sh.id === 'F' ? 'Spätschicht ab 14:00' : 'Frühschicht ab 06:00'}): ${next.length} Personen – ${roleSummary(next)}.`);
    }
    a.sources = ['Personaleinsatz live (Aufgaben, Orte)', 'Schichtplan', srcStand()];
    a.followups = ['Wie läuft die Schicht?', wo.length ? `Warum wartet ${wo[0].id}?` : 'Wo verlieren wir heute Geld?'];
    return done(a);
  }
  const SKILL = { lead: 'Schichtleitung', setup: 'Einrichten', toolchange: 'Werkzeugwechsel', qs: 'Qualitätsprüfung', forklift: 'Stapler', assembly: 'Montage', repair: 'Instandhaltung' };
  const skillLabel = (s) => SKILL[s] || (Object.values(PROF().stationById).find(x => x.skill === s) || {}).short || s;
  const ROLE_GROUP = [[/^Schichtleit/, 'Schichtleitung'], [/^Zerspanung/, 'Zerspanung'], [/^Schleifer/, 'Schleifen'], [/^Einrichter/, 'Einrichten'], [/^Qualit/, 'QS'], [/^Logistik/, 'Logistik'], [/^Monteur/, 'Montage'], [/^Instandhalt/, 'Instandhaltung']];
  function roleSummary(list) {
    const m = {};
    for (const p of list) { const g = (ROLE_GROUP.find(x => x[0].test(p.role)) || [null, p.role])[1]; m[g] = (m[g] || 0) + 1; }
    return Object.keys(m).map(r => m[r] + '× ' + r).join(', ');
  }

  // ------------------------------------------------------------------ Qualität
  function ansQuality(c) {
    const a = A('quality'), k = c.k(), t = c.t, d0 = Math.floor(t / DAY) * DAY;
    const by = k.scrapBy || {};
    a.md.push(`**Qualität heute:** FPY **${pct(k.fpy, 1)}** – ${nm(k.good)} Gutteile, ${nm(k.scrap)} Ausschuss${k.scrap ? ' (' + Object.keys(by).filter(x => by[x]).map(x => x + ' ' + by[x]).join(', ') + ')' : ''}.`);
    a.stats = [
      { l: 'FPY heute', v: pct(k.fpy, 1), s: 'gut / alle je AG', c: k.fpy >= 0.98 ? 'ok' : 'warn' },
      { l: 'Ausschuss', v: nm(k.scrap) + ' Stk', s: Object.keys(by).filter(x => by[x]).map(x => x + ' ' + by[x]).join(' · ') || 'heute', c: k.scrap ? 'warn' : 'ok' },
      { l: 'Erstteile i.O.', v: nm(k.fpiOk || 0) + ' / ' + nm((k.fpiOk || 0) + (k.fpiNok || 0)), s: 'geprüft heute', c: k.fpiNok ? 'warn' : 'ok' },
    ];
    a.md.push('');
    const spcOpen = c.notifs().filter(n => String(n.key).indexOf('spc:') === 0);
    for (const n of spcOpen) {
      a.md.push(`- **${n.title}** – ${n.body}`);
      const ax = (n.actions || []).find(x => x.action.type === 'applyOffset');
      if (ax) addAction(a, { label: `${ax.label} (${n.spc ? n.spc.machineId : ''})`, desc: n.suggestion, action: ax.action, icon: 'gauge' });
    }
    // SPC-Historie heute: wiederkehrende Trends = Verschleiß treibt das Maß schneller als korrigiert wird
    const spcAll = (S().notifications || []).filter(n => String(n.key).indexOf('spc:') === 0 && n.t >= d0);
    const byKey = {};
    for (const n of spcAll) (byKey[n.key] = byKey[n.key] || []).push(n);
    const offs = (S().events || []).filter(e => e.type === 'offset' && e.t >= d0);
    let repeat = null;
    for (const key in byKey) {
      const list = byKey[key], n0 = list[0], mid = n0.spc ? n0.spc.machineId : (n0.entity && n0.entity.id);
      const lastOff = offs.filter(e => e.entity && e.entity.id === mid).slice(-1)[0];
      const om = lastOff ? /Werkzeugkorrektur\s+(\S+\s+\S+).*?\(([^)]+)\)/.exec(lastOff.msg) : null;
      if (list.length >= 2 || !spcOpen.length) a.md.push(`- SPC ${n0.title.replace('SPC-Trend ', '')}: heute ${list.length}× ausgelöst${lastOff ? ', zuletzt korrigiert ' + clk(lastOff.t) + (om ? ' um ' + om[1] + ' (' + om[2] + ')' : '') : ''}${list.some(x => x.status !== 'resolved') ? '' : ' – derzeit unauffällig'}.`);
      if (list.length >= 2 && (!repeat || list.length > repeat.n)) repeat = { n: list.length, mid, title: n0.title };
    }
    const fpiWait = c.mvs().filter(m => m.fpi);
    for (const m of fpiWait) a.md.push(`- Erstteil ${mName(m.id)}: ${label('fpiStage', m.fpi.stage)} seit ${durR(m.fpi.waitingSec)} – Maschine wartet auf Freigabe.`);
    const scrapM = c.mvs().filter(m => m.scrapToday > 0).sort((x, y) => y.scrapToday - x.scrapToday);
    if (scrapM.length) a.md.push(`- Ausschuss je Arbeitsplatz: ${scrapM.map(m => `${m.id} ${nm(m.scrapToday)}`).join(', ')}.`);
    const ev = (S().events || []).filter(e => e.type === 'scrap' && e.t >= d0).slice(-3).reverse();
    for (const e of ev) a.md.push(`- ${clk(e.t)} ${e.msg}`);
    if (!spcOpen.length && !spcAll.length && !fpiWait.length && !k.scrap) a.md.push('- Keine SPC-Auffälligkeit, keine wartenden Erstteile, kein Ausschuss.');
    let rec;
    if (spcOpen.length) rec = 'SPC-Korrektur übernehmen (verschiebt das Maß zurück zur Toleranzmitte) oder Werkzeugwechsel vorziehen – bevor Teile außerhalb der Toleranz entstehen.';
    else if (repeat) {
      const mv = c.mv(repeat.mid);
      const main = mv && (mv.tools || []).filter(x => x.status !== 'idle').sort((x, y) => (y.wearPct || 0) - (x.wearPct || 0))[0];
      rec = `An ${mName(repeat.mid)} kehrt der Trend nach jeder Korrektur zurück (${repeat.n}× heute)${main ? ' – ' + toolShort(main.name) + ' steht bei ' + nm(main.wearPct, 0) + ' % Verschleiß' : ''}. Korrekturintervall verkürzen oder das Werkzeug vorbeugend früher wechseln.`;
      if (mv && mv.order && main) addAction(a, { label: `Werkzeugwechsel an ${repeat.mid} planen`, desc: 'Vorbeugend an der nächsten Teilegrenze – Auswahl nach Reststandzeit', action: { type: 'planToolChange', machineId: repeat.mid }, icon: 'wrench' });
    } else if (fpiWait.length) rec = `Erstteilprüfung an ${fpiWait.map(m => m.id).join(', ')} vor Losprüfungen ziehen – die Maschine steht bis zur Freigabe.`;
    else if (by['Werkzeugbruch']) rec = 'Werkzeugbruch-Ausschuss prüfen: Schnittwerte und Standzeit-Vorgaben der betroffenen Werkzeuge kontrollieren.';
    else rec = 'Prozess stabil – keine Maßnahme nötig.';
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = ['Messwerte / SPC je Merkmal', 'Ausschussbuchungen heute', 'Erstteilprüfungen', srcStand()];
    a.followups = repeat ? [`Was macht ${repeat.mid} gerade?`, `Wann ist der nächste Werkzeugwechsel an ${repeat.mid}?`] : ['Wo verlieren wir heute Geld?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Kosten / Verluste
  function ansLoss(c) {
    const a = A('loss'), k = c.k();
    const L = lossByCause(c);
    const top = L.byMachine.filter(x => x.loss > 0).slice(0, 4);
    a.md.push(`**Heute bisher ${eur(k.lossEur)} Stillstandskosten** – Maschinenstundensatz × Zeit, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Schichtzeit ohne Pausen).`);
    a.stats = [
      { l: 'Stillstand', v: eur(k.lossEur), s: 'heute', c: 'warn' },
      { l: 'Werkzeuge', v: eur(k.toolCostToday), s: pl(k.toolChangesToday || 0, 'Wechsel', 'Wechsel') },
      { l: 'Ausschuss', v: nm(k.scrap) + ' Stk', s: 'FPY ' + pct(k.fpy, 1), c: k.scrap ? 'warn' : 'ok' },
      { l: 'Energie', v: nm(k.energyKwh, 0) + ' kWh', s: 'jetzt ' + nm(k.powerKw, 0) + ' kW' },
    ];
    if (L.causes.length) {
      a.md.push('', '### Nach Ursache');
      for (const x of L.causes.slice(0, 5)) if (x.eur >= 1) a.md.push(`- **${CAUSE_LABEL[x.state]}**: ca. ${eur(x.eur)}`);
    }
    if (top.length) {
      a.md.push('', '### Nach Arbeitsplatz');
      for (const x of top) a.md.push(`- **${mName(x.mv.id)}**: ${eur(x.loss)} (${eur(x.mv.rate)}/h) – ${x.causes.length ? x.causes.slice(0, 2).map(y => `${CAUSE_LABEL[y.state]} ${durR(y.sec)}`).join(', ') : 'Zustand vor Tagesbeginn'}${x.mv.state !== 'running' ? '; jetzt: ' + stLabel(x.mv.state) : ''}`);
    }
    const nowLoss = c.mvs().filter(m => m.state !== 'running' && m.state !== 'idle' && WF.sim.shift().id && !WF.sim.shift().inBreak);
    if (nowLoss.length) a.md.push('', `Gerade kostet Stillstand ca. ${eur(nowLoss.reduce((s, m) => s + m.rate, 0))}/h: ${nowLoss.map(m => `${m.id} ${stLabel(m.state)}`).join(', ')}.`);
    const main = L.causes[0];
    a.md.push('', '> **Empfehlung:** ' + (main ? `Größter Hebel ist **${CAUSE_LABEL[main.state]}** (ca. ${eur(main.eur)}): ${CAUSE_ADVICE[main.state]}` : 'Bisher kaum Stillstand – weiter so.'));
    a.sources = ['Stillstandskosten je Maschine (Stundensatz)', 'Zustandsband heute (Schichtzeit)', 'Kennzahlen heute', srcStand()];
    a.followups = top.length ? [`Was macht ${top[0].mv.id} gerade?`, 'Wie hoch ist der Energieverbrauch?', 'Was ist der Engpass?'] : ['Wie läuft die Schicht?'];
    return done(a);
  }
  /** Zustandsursachen einer Maschine heute (Schichtzeit): Segmente des Zustands mit der Ursache aus dem Zustandsereignis */
  function causeBreakdown(c, id, state) {
    const t = c.t, d0 = Math.floor(t / DAY) * DAY, mv = c.mv(id);
    const evs = (S().events || []).filter(e => e.type === 'state' && e.entity && e.entity.id === id && e.data && e.data.to === state && e.t >= d0 - DAY);
    const groups = {};
    for (const sg of mv.segments || []) {
      if (sg.state !== state) continue;
      const a = Math.max(d0, sg.t0), b = Math.min(t, sg.t1 == null ? t : sg.t1);
      const w = workBetween(a, b); if (w <= 0) continue;
      let ev = null; for (const e of evs) if (Math.abs(e.t - sg.t0) <= 2) ev = e;
      const cause = ev && ev.data.cause ? String(ev.data.cause) : stLabel(state);
      const key = cause.replace(/\d+([.,:]\d+)?/g, '#').replace(/\(.*?\)/g, '').slice(0, 60);
      const g = groups[key] || (groups[key] = { cause, sec: 0, n: 0 });
      g.sec += w; g.n++;
    }
    return Object.values(groups).sort((x, y) => y.sec - x.sec);
  }
  function ansLossMachine(c, id, q) {
    const a = A('loss'), mv = c.mv(id);
    a.entity = { kind: 'machine', id };
    const row = lossByCause(c).byMachine.find(x => x.mv.id === id);
    const want = Object.keys(CAUSE_LABEL).find(k => q.indexOf(norm(CAUSE_LABEL[k]).split(' ').pop()) >= 0) || (/material/.test(q) ? 'starved' : /bediener/.test(q) ? 'waitOperator' : /werkzeug/.test(q) && /wartet/.test(q) ? 'waitTool' : /stoerung/.test(q) ? 'fault' : /erstteil/.test(q) ? 'firstPiece' : null);
    if (!row || !(row.loss > 0)) { a.md.push(`**${mName(id)}: heute keine Stillstandskosten** – die Maschine hat in der Schichtzeit produziert oder hatte keinen Auftrag.`); a.sources = ['Stillstandskosten je Maschine', srcStand()]; return done(a); }
    a.md.push(`**${mName(id)}: heute ${eur(row.loss)} Stillstandskosten** – ${durR(row.lossSec)} mit Auftrag ohne Produktion in der Schichtzeit (Satz ${eur(mv.rate)}/h).`, '');
    for (const x of row.causes) a.md.push(`- **${CAUSE_LABEL[x.state]}**: ca. ${eur(x.eur)} (${durR(x.sec)})`);
    if (want && !row.causes.some(x => x.state === want)) {
      const allDay = (mv.stateTimes && mv.stateTimes[want]) || 0;
      a.md.push('', `**${CAUSE_LABEL[want]} an ${id}:** heute ${allDay > 0 ? 'nur außerhalb der Schichtzeit bzw. in Pausen (' + durR(allDay) + ') – das zählt nicht als Stillstandskosten' : 'nicht aufgetreten'}.`);
    }
    const focus = want && row.causes.some(x => x.state === want) ? want : row.causes[0] && row.causes[0].state;
    if (focus) {
      a.md.push('', `### Ursachen ${CAUSE_LABEL[focus]}`);
      const br = causeBreakdown(c, id, focus);
      for (const g of br.slice(0, 4)) a.md.push(`- ${durR(g.sec)}${g.n > 1 ? ' (' + g.n + '×)' : ''}: ${g.cause}`);
      if (!br.length) a.md.push('- Keine Einzelereignisse in der Schichtzeit zuordenbar.');
      const d0 = Math.floor(c.t / DAY) * DAY;
      if (focus === 'fault') { const fs2 = (S().events || []).filter(e => e.type === 'fault' && e.t >= d0 && e.entity && e.entity.id === id); if (fs2.length) a.md.push(`- Alarme heute: ${fs2.map(e => clk(e.t) + ' ' + (e.data && e.data.code ? e.data.code : '')).join(', ')}.`); }
      if (focus === 'toolchange') { const tcs = (S().events || []).filter(e => e.type === 'toolChanged' && e.t >= d0 && e.entity && e.entity.id === id); if (tcs.length) a.md.push(`- ${pl(tcs.length, 'Werkzeugwechsel', 'Werkzeugwechsel')} heute, zusammen ${durR(tcs.reduce((s2, e) => s2 + ((e.data && e.data.durSec) || 0), 0))}${tcs.some(e => e.data && e.data.tools && e.data.tools.some(x => x.bundled)) ? ', teils gebündelt' : ''}.`); }
      a.md.push('', '> **Empfehlung:** ' + CAUSE_ADVICE[focus]);
    }
    a.sources = [`Stillstandskosten ${id} (Stundensatz)`, 'Zustandsband und Zustandsursachen heute', srcStand()];
    a.followups = [`Was macht ${id} gerade?`, 'Wo verlieren wir heute Geld?'];
    return done(a);
  }
  const LEVEL_INFO = {
    0: { gets: 'Zustand und Stückzahl nur über die Tablet-Rückmeldung am Arbeitsplatz', manual: 'Start/Stopp, Stückzahl und Stillstandsgrund' },
    1: { gets: 'Lauf/Stillstand automatisch aus Stromaufnahme und Signalsäule, Laufzeit sekundengenau, Energie je Auftrag', manual: 'Stillstandsgrund (ein Klick am Tablet) und – ohne Zähler – die Stückzahl' },
    2: { gets: 'zusätzlich Programm, Spindeldrehzahl und -last, Override, Alarme mit Code und Text, Stückzähler der Steuerung', manual: 'Ausschussgrund und Quittierung von Rüsten/Erstteil' },
    3: { gets: 'zusätzlich Werkzeugdaten (Werkzeug in der Spindel, Standzeitzähler) und Programmverwaltung', manual: 'nur noch Ausschussgründe' },
  };
  function ansConnectMachine(c, id, q) {
    const a = A('connect'), mv = c.mv(id), st = station(id), lv = mv.conn.level || 0;
    a.entity = { kind: 'machine', id };
    const m = /level\s*(\d)/.exec(q), ask = m ? Math.max(0, Math.min(3, Number(m[1]))) : null;
    a.md.push(lv === 0 ? `**${mName(id)}** (${st.vendor} ${st.model}, Baujahr ${st.year}, ${st.control.replace(/\s*\(Bj\.[^)]*\)/, '')}) ist **nicht angebunden** (Level 0) – Zustand und Stückzahl kommen per Tablet-Rückmeldung.` : `**${mName(id)}** (${st.vendor} ${st.model}, Baujahr ${st.year}, ${st.control}) ist auf **Level ${lv}** angebunden: ${label('conn', lv)} über ${mv.conn.protocol}.`, '');
    const target = ask != null ? ask : Math.min(3, lv + 1);
    const old = st.year < 2000 || /Bj\.|nicht angebunden|Tablet/.test(mv.conn.protocol);
    if (target !== lv) {
      a.md.push(`- **Level ${target} bringt:** ${LEVEL_INFO[target].gets}.`);
      a.md.push(`- **Manuell bleibt:** ${LEVEL_INFO[target].manual}.`);
      a.md.push(`- **Weg dorthin:** ${target === 1 ? 'Stromsensor und Signalsäulen-Abgriff nachrüsten – kein Eingriff in die Steuerung, keine Freischaltung durch den Hersteller nötig, Montage in ca. 1 Stunde.' : target === 2 ? (/fanuc/i.test(st.control) ? 'Fanuc FOCAS über Ethernet an der Steuerung freischalten.' : /siemens|heidenhain/i.test(st.control) ? 'OPC UA-Server der Steuerung aktivieren (bei neueren Steuerungen umati-Profil).' : 'MTConnect-Adapter bzw. OPC UA über das werkfluss Edge-Gateway.') : 'Werkzeug- und Programmdaten der Steuerung freigeben (OPC UA/umati mit Werkzeugverwaltung).'}`);
    } else a.md.push(`- **Liefert heute:** ${LEVEL_INFO[lv].gets}.`, `- **Manuell bleibt:** ${LEVEL_INFO[lv].manual}.`);
    if (old && target <= 1) a.md.push(`- ${st.year < 2000 ? 'Bei Baujahr ' + st.year + ' ' : ''}ist die Nachrüst-Sensorik der wirtschaftliche Weg: Die Steuerung hat keine nutzbare Netzwerkschnittstelle.`);
    a.md.push(`- Heute an ${id}: ${pl(mv.goodToday, 'Gutteil', 'Gutteile')}, Stillstandskosten ${eur(mv.lossEurToday)}, Energie ${nm(mv.energyKwhToday, 0)} kWh${mv.powerKw == null ? ' (Modellwert – ohne Messung)' : ''}.`);
    a.md.push('', '> **Empfehlung:** ' + (target > lv ? `Level ${target} für ${id} umsetzen – der Assistent in „Anbindung“ führt durch Protokoll, Signal-Mapping und Live-Test.` : `${id} ist passend angebunden.`));
    if ((WF.views || []).some(v => v.id === 'anbindung')) addAction(a, { label: `Anbindung für ${id} öffnen`, desc: 'Protokoll, Signal-Mapping, Live-Test', action: { type: 'navigate', view: 'anbindung', params: { machineId: id } }, icon: 'plug', quiet: true });
    a.sources = [`Anbindung ${id}`, 'Stammdaten Maschine', srcStand()];
    a.followups = ['Welche Maschinen sind nicht angebunden?', `Was macht ${id} gerade?`];
    return done(a);
  }
  function ansEnergy(c) {
    const a = A('energy'), k = c.k();
    const mvs = c.mvs().slice().sort((x, y) => (y.energyKwhToday || 0) - (x.energyKwhToday || 0));
    const h = WF.sim.history, d0 = Math.floor(c.t / DAY) * DAY;
    let peak = null;
    if (h && h.t) for (let i = 0; i < h.t.length; i++) if (h.t[i] >= d0 && h.powerKw[i] != null && (!peak || h.powerKw[i] > peak.v)) peak = { v: h.powerKw[i], t: h.t[i] };
    a.md.push(`**Energie heute: ${nm(k.energyKwh, 0)} kWh**, aktuelle Leistung **${nm(k.powerKw, 0)} kW**${peak ? ` (Spitze heute ${nm(peak.v, 0)} kW um ${clk(peak.t)}, 5-min-Mittel)` : ''}.`, '');
    for (const m of mvs.slice(0, 5)) a.md.push(`- **${mName(m.id)}**: ${nm(m.energyKwhToday, 0)} kWh heute, jetzt ${m.powerKw != null ? nm(m.powerKw, 1) + ' kW gemessen' : nm(m.powerKwEst, 1) + ' kW (Modellwert, nicht angebunden)'} – ${stLabel(m.state)}`);
    const idleDraw = c.mvs().filter(m => m.state !== 'running' && (m.powerKw != null ? m.powerKw : m.powerKwEst) >= 3);
    if (idleDraw.length) a.md.push('', `Grundlast ohne Produktion: ${idleDraw.map(m => `${m.id} ${nm(m.powerKw != null ? m.powerKw : m.powerKwEst, 1)} kW (${stLabel(m.state)})`).join(', ')} – zusammen ${nm(idleDraw.reduce((s, m) => s + (m.powerKw != null ? m.powerKw : m.powerKwEst), 0), 0)} kW.`);
    const unm = c.mvs().filter(m => m.powerKw == null);
    if (unm.length) a.md.push(`Ohne Strommessung (Level 0): ${unm.map(m => m.id).join(', ')} – Werte dort sind Modellwerte.`);
    a.md.push('', '> **Empfehlung:** ' + (idleDraw.length ? 'Längere Stillstände (Warten, Bereit) mit Energiesparmodus bzw. Abschalten der Nebenaggregate (Kühlmittel, Späneförderer) überbrücken.' : 'Kein auffälliger Leerlaufverbrauch.'));
    a.sources = ['Leistungsmessung (Anbindung Level ≥ 1)', 'Energiezähler heute', 'Leistungsverlauf (5 min)', srcStand()];
    a.followups = ['Wo verlieren wir heute Geld?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Anbindung
  function ansConnect(c) {
    const a = A('connect'), mvs = c.mvs();
    const by = [0, 1, 2, 3].map(l => mvs.filter(m => (m.conn.level || 0) === l));
    a.md.push(`**Anbindung: ${mvs.length - by[0].length} von ${mvs.length} Arbeitsplätzen liefern Daten automatisch**${by[0].length ? `, ${listJoin(by[0].map(m => m.id))} ${by[0].length === 1 ? 'meldet' : 'melden'} per Tablet` : ''}.`);
    a.stats = [3, 2, 1, 0].map(l => ({ l: 'Level ' + l, v: String(by[l].length), s: ['Tablet', 'Sensorik', 'Steuerung', '+ Werkzeugdaten'][l], c: l === 0 ? (by[0].length ? 'warn' : '') : l === 3 ? 'ok' : 'info' }));
    a.md.push('');
    const LV = ['Level 0 – Rückmeldung per Tablet', 'Level 1 – Nachrüst-Sensorik (Strom, Signalsäule)', 'Level 2 – Steuerung gelesen', 'Level 3 – Steuerung + Werkzeug-/Programmdaten'];
    for (let l = 0; l <= 3; l++) if (by[l].length) a.md.push(`- **${LV[l]}:** ${by[l].map(m => `${m.id} ${m.short} (${m.conn.protocol}${m.year ? ', Bj. ' + m.year : ''})`).join('; ')}.`);
    const old = by[0].filter(m => m.kind === 'machine');
    a.md.push('', '> **Empfehlung:** ' + (old.length ? `${listJoin(old.map(m => mName(m.id)))} mit Nachrüst-Sensorik anbinden (Stromsensor + Signalsäulen-Abgriff, ohne Eingriff in die Steuerung) – dann laufen Zustand, Laufzeit und Energie automatisch ein. Der Assistent in der Ansicht „Anbindung“ führt in fünf Schritten durch.` : 'Alle Bearbeitungsmaschinen liefern Daten automatisch; als Nächstes Level-1-Maschinen auf Steuerungsdaten (OPC UA/MTConnect) heben, wo die Steuerung es erlaubt.'));
    if ((WF.views || []).some(v => v.id === 'anbindung')) addAction(a, { label: 'Ansicht „Anbindung“ öffnen', desc: 'Maschine anschließen: Protokoll, Signal-Mapping, Live-Test', action: { type: 'navigate', view: 'anbindung', params: old[0] ? { machineId: old[0].id } : {} }, icon: 'plug', quiet: true });
    a.sources = ['Anschluss-Level je Arbeitsplatz', srcStand()];
    a.followups = ['Wie hoch ist der Energieverbrauch?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Logistik / AGV
  function ansLogistics(c, ids) {
    const a = A('logistics');
    const agvs = Object.values(S().agvs).filter(x => !ids || !ids.length || ids.indexOf(x.id) >= 0);
    const trs = Object.values(S().transports || {}).filter(x => x.status !== 'done');
    a.md.push(`**Logistik:** ${agvs.length === 1 ? agvs[0].name : agvs.length + ' AGVs'}, ${pl(trs.length, 'offener Transport', 'offene Transporte')}, heute ${nm(c.k().transportsToday)} erledigt.`, '');
    for (const v of agvs) {
      const ct = v.load ? S().containers[v.load] : null;
      a.md.push(`- **${v.name}** – ${label('agv', v.state)}, Akku ${nm(v.battery, 0)} %${ct ? `, geladen: ${stk(ct.qty)} ${ct.orderId}` : ''}${v.taskLabel ? ' · ' + v.taskLabel : ''}`);
    }
    const f = S().forklift;
    if (f) a.md.push(`- **Stapler** – ${label('forklift', f.state)}${f.driver ? ' (' + sn(S().people[f.driver].name) + ')' : ''}${f.load ? ', Last: ' + (f.load === 'Stangen' ? 'Stangenmaterial' : f.load) : ''}`);
    const waiting = trs.filter(x => x.waitReason || x.status === 'open');
    if (waiting.length) a.md.push('', `Wartende Transporte: ${waiting.slice(0, 4).map(x => `${x.label}${x.waitReason ? ' – ' + x.waitReason : ''}`).join('; ')}.`);
    const blocked = c.mvs().filter(m => m.state === 'blocked');
    if (blocked.length) a.md.push(`Ausgang voll: ${blocked.map(m => `${mName(m.id)} – ${m.cause}`).join('; ')}.`);
    a.sources = ['AGV-Flotte live', 'Transportaufträge', srcStand()];
    a.followups = ['Welches Material wird knapp?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Was-wäre-wenn: Ausfall
  function ansWhatIf(c, id, hours) {
    const a = A('whatif'), mv = c.mv(id), st = station(id);
    if (!mv) { a.md.push(`Arbeitsplatz ${id} ist nicht bekannt.`); return done(a); }
    a.entity = { kind: 'machine', id };
    const N = Math.max(0.25, Math.min(48, hours || 2)) * 3600, t = c.t, T1 = t + N;
    const auto = st.loading === 'auto';
    const list = (c.fc().machines[id] || []).slice().sort((x, y) => x.start - y.start);
    let free = T1;
    const pushes = [];
    for (const e of list) {
      const s = Math.max(e.start, t);
      const lostCal = Math.max(0, free - s);
      if (lostCal <= 0) break;
      const lost = auto ? lostCal : workBetween(s, s + lostCal);
      const newEnd = auto ? e.end + lostCal : addWork(e.end, lost);
      const opEnd = e.opEnd != null ? e.opEnd : e.end;
      const newOpEnd = auto ? opEnd + lostCal : addWork(opEnd, lost);
      free = Math.max(newEnd, e.end);
      pushes.push({ e, lost, lostCal, newEnd, opEnd, newOpEnd });
    }
    const lostWork = workBetween(t, T1);
    const cost = mv.rate * (auto ? N : lostWork) / 3600;
    const rows = [];
    const byOrder = {};
    for (const p of pushes) {
      const o = c.ov(p.e.orderId); if (!o || o.status === 'fertig' || o.eta == null) continue;
      const dWork = workBetween(p.opEnd, p.newOpEnd);
      const isLast = o.ops.filter(op => op.station !== 'VERSAND' && !op.complete).slice(-1)[0];
      const last = isLast && isLast.seq === p.e.seq;
      let after = dWork > 0 ? addWork(o.eta, dWork) : o.eta;
      if (last) after = Math.max(after, p.newOpEnd + 600);
      const prev = byOrder[o.id];
      if (!prev || after > prev.after) byOrder[o.id] = { o, e: p.e, p, after, before: o.eta };
    }
    for (const k in byOrder) rows.push(byOrder[k]);
    rows.sort((x, y) => (y.after - y.o.due) - (x.after - x.o.due));
    const flips = rows.filter(r => r.before <= r.o.due && r.after > r.o.due), stillLate = rows.filter(r => r.before > r.o.due);
    // Kernaussage: Annahme + Ergebnis
    let result;
    if (!list.length) result = `**Kein Einfluss auf Termine** – an ${id} ist in der Plantafel nichts eingeplant${mv.state === 'idle' ? ' (' + lc1(String(mv.cause).replace(/^Frei\s*[–-]\s*/i, '')) + ')' : ''}.`;
    else if (!rows.length) result = `**Kein Einfluss auf Termine** – der nächste Arbeitsgang an ${id} beginnt erst ${tc(list[0].start)}, nach dem Ausfall.`;
    else if (flips.length) result = `**${pl(flips.length, 'Termin kippt', 'Termine kippen')}:** ${listJoin(flips.map(r => `${r.o.id} (${dur0(r.o.due - r.after)} Verzug)`))}${stillLate.length ? `; ${listJoin(stillLate.map(r => r.o.id))} ${stillLate.length === 1 ? 'ist' : 'sind'} schon verspätet` : ''}.`;
    else if (stillLate.length) result = `**Kein weiterer Termin kippt**; ${listJoin(stillLate.map(r => r.o.id))} ${stillLate.length === 1 ? 'ist' : 'sind'} schon verspätet und ${stillLate.length === 1 ? 'verschiebt sich' : 'verschieben sich'} weiter.`;
    else result = `**Kein Termin kippt** – ${rows.length === 1 ? rows[0].o.id + ' behält' : 'alle ' + rows.length + ' betroffenen Aufträge behalten'} Puffer${rows.length === 1 ? ' (' + dur0(rows[0].o.due - rows[0].after) + ')' : ''}.`;
    a.md.push(`**Annahme:** ${mName(id)} fällt ab jetzt (${clk(t)}) für ${durR(N)} aus – bis ca. ${tc(T1)}.${mv.state === 'fault' ? ` ${id} ist bereits gestört (${mv.fault.code}); betrachtet wird ein zusätzlicher Ausfall.` : ''}`, result, '');
    for (const r of rows) {
      const o = r.o, dl = r.after - r.before, newSlack = o.due - r.after;
      let verdict;
      if (r.before > o.due) verdict = `bleibt verspätet (${dur0(newSlack)} Verzug statt ${dur0(o.due - r.before)})`;
      else if (newSlack < 0) verdict = `**kippt: ${dur0(newSlack)} Verzug** (bisher ${dur0(o.due - r.before)} Puffer)`;
      else verdict = `hält (Puffer ${dur0(newSlack)} statt ${dur0(o.due - r.before)})`;
      const shiftTxt = dl >= 60 ? `Prognose ${dueTxt(r.before)} → **${dueTxt(r.after)}**` : `Prognose bleibt ${dueTxt(r.before)} (Verschiebung wird von Folgeschritten aufgefangen)`;
      a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}), AG ${r.e.seq}${r.e.active ? ' läuft hier' : ' ab ' + tc(r.e.start)}: ${shiftTxt}; Termin ${dueTxt(o.due)} ${verdict}.`);
    }
    if (rows.length) {
      const nParts = mv.order && mv.order.cycleMin && mv.state === 'running' ? Math.min(Math.max(0, mv.partsTotal - mv.partsDone), Math.floor((auto ? N : lostWork) / (mv.order.cycleMin * 60 + (st.loading === 'perPart' ? (st.loadMin || 1) * 60 : 0)))) : 0;
      a.md.push(`- Kosten: ca. **${eur(cost)}** Stillstand (${eur(mv.rate)}/h × ${durR(auto ? N : lostWork)} ${auto ? 'Maschinenzeit' : 'Arbeitszeit'})${nParts > 0 && mv.order ? `, ca. ${teile(nParts)} ${mv.order.id} weniger bis ${clk(T1)}` : ''}.`);
    }
    // Empfehlung
    const recs = [];
    if (flips.length || stillLate.length) {
      const crit = flips.concat(stillLate);
      const alt = altMachines(id);
      const ne = crit.filter(r => r.o.priority !== 'eil');
      const altOk = [...new Set(crit.flatMap(r => capableAlts(r.o.id, r.e.seq, id)))];
      recs.push(`Bei echtem Ausfall: ${ne.length ? listJoin(ne.map(r => r.o.id)) + ' als Eilauftrag kennzeichnen (holt an den Folgearbeitsplätzen Zeit auf)' : 'Kunden früh informieren'}${altOk.length ? `, Verlagerung auf ${listJoin(altOk)} prüfen` : alt.length ? '' : ''}${st.loading !== 'auto' ? ', Ausfallzeit mit Überstunden an ' + id + ' aufholen' : ''}.`);
      for (const r of ne) addAction(a, { label: `${r.o.id} als Eilauftrag`, desc: `Vorbeugend: ${r.o.id} wird an allen Arbeitsplätzen beim nächsten Auftragswechsel vorgezogen.`, action: { type: 'setPriority', orderId: r.o.id, priority: 'eil' }, icon: 'bolt' });
    } else if (rows.length) recs.push(`Die Puffer reichen – ein Ausfall von ${durR(N)} kostet vor allem Maschinenzeit (ca. ${eur(cost)}).${st.loading !== 'auto' && mv.operator ? ' Bediener:in während des Ausfalls an einer anderen Maschine einsetzen.' : ''}`);
    else recs.push('Keine Maßnahme nötig.');
    a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
    a.md.push('', `~ Schätzung aus der Plantafel: Arbeitsgänge an ${id} verschieben sich um die Ausfallzeit (${auto ? 'Kalenderzeit – läuft auch unbemannt' : 'Arbeitszeit – läuft nur bemannt'}), Folgeschritte um die verlorene Arbeitszeit. Wartezeiten (z. B. Härterei-Lieferfenster) können einen Teil auffangen.`);
    if (!mv.fault && mv.state !== 'setup' && mv.state !== 'toolchange') addAction(a, { label: `Störung an ${id} jetzt auslösen (Demo)`, desc: `Simuliert einen Alarm aus dem Störungskatalog (Reparatur laut Katalog, nicht ${durR(N)}) – Meldung, Instandhaltung und Prognose reagieren live.`, action: { type: 'triggerFault', machineId: id }, icon: 'alert', danger: true });
    a.impact = rows.length ? { title: `Ausfall ${id} · ${durR(N)}`, rows: rows.slice(0, 6).map(r => ({ id: r.o.id, label: 'AG ' + r.e.seq, before: r.before, after: r.after, due: r.o.due })) } : null;
    a.sources = [`Plantafel ${id} (${list.length} Arbeitsgänge)`, 'Prognose je Auftrag', 'Schichtkalender', `Stundensatz ${eur(mv.rate)}/h`, srcStand()];
    a.followups = [`Was macht ${id} gerade?`, 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Schichtübergabe
  /** Schätzung der Werkzeugwechsel im Zeitraum aus Reststandzeit, Standzeit je Teil, Wechselgrenze und Taktzeit
      (nur laufende Arbeitsgänge, nur in Arbeitszeit – nachts übernimmt die Geisterschicht-Meldung) */
  function estimateChanges(c, from, to) {
    const out = [], t = c.t;
    for (const mv of c.mvs()) {
      if (!mv.order || mv.state === 'idle') continue;
      const st = station(mv.id), auto = st.loading === 'auto';
      const cycS = ((mv.order.cycleMin || 0) + (st.loading === 'perPart' ? (st.loadMin || 1) : 0)) * 60;
      if (!(cycS > 0)) continue;
      const base = t + (mv.partRemainSec || 0);
      const at = (k) => (auto ? base + k * cycS : addWork(base, k * cycS));
      let n = 0; const names = [];
      for (const tl of mv.tools || []) {
        if (tl.status === 'idle' || !(tl.cutMinPerPart > 0) || tl.remainingParts == null || !isFinite(tl.remainingParts)) continue;
        const full = Math.max(1, Math.floor(tl.life / tl.cutMinPerPart + 1e-9)), lim = tl.changeAtParts || 0, need = tl.neededParts || 0;
        let rem = tl.remainingPartsAfterPart != null ? tl.remainingPartsAfterPart : tl.remainingParts;
        if (need - 1 <= rem) continue; // reicht für den Rest des Arbeitsgangs
        let idx = Math.max(0, rem - lim), cnt = 0, first = true;
        for (let g = 0; g < 60; g++) {
          if (!first && need - 1 - idx <= lim) break;
          const tAt = first && tl.plannedChange && tl.plannedChange.etaT != null ? tl.plannedChange.etaT : at(idx);
          first = false;
          if (tAt > to) break;
          if (tAt >= from && workBetween(tAt - 1, tAt + 1) > 0) cnt++;
          idx += Math.max(1, full - lim);
        }
        if (cnt) { n += cnt; names.push(toolShort(tl.name) + (cnt > 1 ? ' ×' + cnt : '')); }
      }
      if (n) out.push({ id: mv.id, n, names });
    }
    return out.sort((x, y) => y.n - x.n);
  }
  function nextShiftWindow() {
    const t = NOW(), sh = WF.sim.shift();
    if (sh.id === 'F') return { cur: sh.name, next: 'Spätschicht', from: sh.endsAt, to: Math.floor(t / DAY) * DAY + 22 * 3600, nextShift: 'S' };
    if (sh.id === 'S') { const ns = addWork(sh.endsAt, 1) - 1; return { cur: sh.name, next: 'Frühschicht', from: ns, to: ns + 8 * 3600, nextShift: 'F', ghostFrom: sh.endsAt }; }
    const ns = sh.endsAt; return { cur: 'Geisterschicht', next: 'Frühschicht', from: ns, to: ns + 8 * 3600, nextShift: 'F', ghostFrom: t };
  }
  function ansHandover(c) {
    const a = A('handover'), t = c.t, k = c.k(), sh = WF.sim.shift(), W = nextShiftWindow();
    const mvs = c.mvs();
    a.md.push(`### Schichtübergabe ${W.cur} → ${W.next}`);
    a.md.push(`~ Stand ${WF.sim.clock()}${sh.id ? ' · Schichtende ' + clk(sh.endsAt) : ''} · ${W.next} ${tc(W.from)}–${clk(W.to)} · aus Live-Daten erstellt`, '');
    // Lage
    const prod = mvs.filter(m => m.state === 'running').length;
    const ss = S().shiftStats || {};
    a.md.push('### Lage');
    a.md.push(`- ${prod} von ${mvs.length} Arbeitsplätzen produzieren; OEE ${sh.id ? 'Schicht ' + pct(k.oeeShift, 1) + ', ' : ''}heute ${pct(k.oee, 1)}.`);
    if (sh.id) a.md.push(`- In dieser Schicht ${nm(ss.good || 0)} Gutteile (je Arbeitsgang gezählt) und ${nm(ss.scrap || 0)} Ausschuss; heute ${nm(k.goodFinished)} fertige Teile, ${nm(k.shippedToday || 0)} versandt.`);
    // Offene Punkte
    const pts = [];
    for (const m of mvs.filter(x => x.state === 'fault')) { const fi = faultInfo(m); pts.push(`**Störung ${mName(m.id)}**: ${m.fault.code} ${m.fault.text} – ${fi.who}, Ende ca. ${clk(fi.endT)}.`); }
    const hw = mvs.filter(x => WAIT[x.state] && x.sinceSec >= 300);
    for (const m of hw.filter(x => !noStaff(x))) pts.push(`**${mName(m.id)}** ${lc1(stLabel(m.state))} seit ${durR(m.sinceSec)}: ${m.cause}.`);
    for (const l of groupNoStaff(hw.filter(noStaff))) pts.push(l.replace(/^- /, ''));
    for (const m of mvs.filter(x => x.fpi)) pts.push(`Erstteil ${mName(m.id)}: ${label('fpiStage', m.fpi.stage)} seit ${durR(m.fpi.waitingSec)}.`);
    for (const m of mvs.filter(x => x.state === 'setup')) pts.push(`${mName(m.id)} rüstet ${m.order ? m.order.id + ' AG ' + m.order.seq : ''} – ${m.cause}.`);
    const open = c.notifs().filter(n => n.status === 'open' && (n.sev === 'crit' || n.sev === 'warn') && !/^(fault|wait|fpi|late|stock|missing|spc|ghost|tool):/.test(n.key));
    for (const n of open.slice(0, 4)) pts.push(`${n.title}${n.suggestion ? ' – ' + trimTxt(n.suggestion, 120) : ''}`);
    a.md.push('', '### Offene Punkte');
    if (pts.length) for (const p of pts) a.md.push('- ' + p); else a.md.push('- Keine Störung, kein Arbeitsplatz wartet länger als 5 min.');
    // Termine
    const ord = c.open().filter(o => o.risk !== 'ok' && o.eta != null).sort((x, y) => x.slackSec - y.slackSec);
    a.md.push('', '### Termine');
    if (ord.length) for (const o of ord.slice(0, 5)) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – ${o.slackSec >= 0 ? 'Puffer ' + dur0(o.slackSec) : dur0(o.slackSec) + ' Verzug'}${o.bottleneck ? '; Engpass ' + o.bottleneck.split(' (')[0] : ''}.`);
    else a.md.push('- Alle offenen Aufträge im Plan.');
    const fin = c.open().filter(o => o.eta != null).sort((x, y) => x.eta - y.eta);
    const nowFin = sh.id ? fin.filter(o => o.eta < sh.endsAt) : [], nextFin = fin.filter(o => o.eta >= (sh.id ? sh.endsAt : t) && o.eta <= W.to);
    if (nowFin.length) a.md.push(`- Noch in dieser Schicht fertig: ${nowFin.slice(0, 5).map(o => `${o.id} ca. ${tc(o.eta)}`).join(', ')}.`);
    if (nextFin.length) a.md.push(`- Bis Ende ${W.next} fertig: ${nextFin.slice(0, 5).map(o => `${o.id} ca. ${tc(o.eta)}`).join(', ')}.`);
    // Werkzeugwechsel nächste Schicht
    const ch = plannedChanges(c, W.to).filter(g => g.t >= W.from - 600 && g.stage !== 'später');
    const est = estimateChanges(c, W.from, W.to);
    a.md.push('', `### Werkzeugwechsel ${W.next} (${tc(W.from)}–${clk(W.to)})`);
    for (const g of ch.slice(0, 6)) a.md.push(`- ${tc(g.t)} ${mName(g.machine)}: ${g.tools.map(x => toolShort(x.name)).join(' + ')} nach Teil ${g.afterPart}${g.manual ? ' (vorbeugend beauftragt)' : ''}`);
    const nEst = est.reduce((s2, x) => s2 + x.n, 0);
    if (nEst) a.md.push(`- Voraussichtlich ${pl(nEst, 'Wechsel', 'Wechsel')} insgesamt (Schätzung aus Reststandzeit und Taktzeit): ${est.slice(0, 5).map(x => `${x.id} ${x.names.join(', ')}`).join('; ')}.`);
    if (!ch.length && !nEst) a.md.push('- Kein Wechsel absehbar – die Standzeiten reichen für die laufenden Arbeitsgänge.');
    const ghost = c.notifs().filter(n => String(n.key).indexOf('ghost:') === 0 && !(n.ghost && n.ghost.stopT < t));
    for (const n of ghost) a.md.push(`- ${n.title}: ${trimTxt(n.suggestion, 150)}`);
    // Material
    a.md.push('', '### Material');
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min);
    const pur = openPurchases().filter(p => p.etaT <= W.to + 4 * 3600);
    for (const mt of low) a.md.push(`- ${mt.name}: ${matQty(mt, mt.onHand)} < Mindestbestand ${matQty(mt, mt.min)}${mt.onOrder ? ' – ' + matQty(mt, mt.onOrder) + ' bestellt' : ' – **nicht bestellt**'}.`);
    for (const p of pur) a.md.push(`- Lieferung erwartet: ${matQty(S().materials[p.materialId], p.qty)} ${S().materials[p.materialId].name} ca. ${dueTxt(p.etaT)} (${p.id}).`);
    const bars = mvs.filter(m => m.barStockM != null && m.order && m.barStockM < (m.barReorderM || 0) * 1.5);
    for (const m of bars) a.md.push(`- ${mName(m.id)}: Stangenmagazin ${nm(m.barStockM, 1)} m – Nachladen durch Logistik steht an.`);
    if (!low.length && !pur.length && !bars.length) a.md.push('- Bestände über Mindestbestand, keine Lieferung offen.');
    // Qualität
    a.md.push('', '### Qualität');
    const d0 = Math.floor(t / DAY) * DAY;
    const spcOpen = c.notifs().filter(n => String(n.key).indexOf('spc:') === 0);
    const spcToday = (S().notifications || []).filter(n => String(n.key).indexOf('spc:') === 0 && n.t >= d0);
    a.md.push(`- FPY heute ${pct(k.fpy, 1)}, ${nm(k.scrap)} Ausschuss; Erstteile ${nm(k.fpiOk || 0)} i.O. / ${nm(k.fpiNok || 0)} n.i.O.`);
    if (spcOpen.length) a.md.push(`- Offene SPC-Warnung: ${spcOpen.map(n => n.title.replace('SPC-Trend ', '')).join(', ')}.`);
    else if (spcToday.length) a.md.push(`- SPC heute ${spcToday.length}× ausgelöst (${[...new Set(spcToday.map(n => n.title.replace('SPC-Trend ', '').split(':')[0]))].join(', ')}) – jeweils korrigiert, aktuell keine offene Warnung.`);
    else a.md.push('- Keine SPC-Warnung heute.');
    // Personal
    const nxt = Object.values(S().people).filter(p => p.shift === W.nextShift);
    a.md.push('', '### Personal');
    a.md.push(`- ${W.next}: ${nxt.length} Personen (${roleSummary(nxt)}).`);
    if (W.nextShift === 'S' && !nxt.some(p => /^Instandhalt/.test(p.role))) a.md.push('- In der Spätschicht keine Instandhaltung – Reparaturen übernimmt der Einrichter (' + (nxt.filter(p => p.skills.indexOf('repair') >= 0).map(p => sn(p.name)).join(', ') || '–') + ').');
    if (W.ghostFrom != null) { const au = mvs.filter(m => m.loading === 'auto' && m.order && m.state === 'running'); a.md.push(`- Unbemannt weiter (Geisterschicht): ${au.length ? au.map(m => mName(m.id)).join(', ') : 'keine Maschine'}.`); }
    a.sources = ['Maschinenstatus', 'Meldungen', 'Prognose', 'Werkzeugplanung', 'Material & Bestellungen', 'Schichtplan', srcStand()];
    a.followups = ['Welche Aufträge sind gefährdet und warum?', 'Welche Werkzeugwechsel stehen in der Schicht an?', 'Was ist der Engpass?'];
    a.copyable = true;
    return done(a);
  }

  // ------------------------------------------------------------------ Schichtbriefing (formuliert)
  function ansBriefing(c) {
    const a = A('briefing'), b = briefing(), t = c.t, sh = WF.sim.shift(), k = c.k();
    const until = t + 2 * 3600;
    a.md.push(`### Schichtbriefing ${U.fmtDayClock(t)} · ${sh.id ? sh.name + ' bis ' + clk(sh.endsAt) : 'Geisterschicht'}`, `**${b.headline}**`, '');
    const ov = ansOverview(c);
    a.stats = ov.stats;
    // Termine
    const open = c.open().filter(o => o.eta != null);
    const late = open.filter(o => o.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec), tight = open.filter(o => o.risk === 'knapp').sort((x, y) => x.slackSec - y.slackSec);
    a.md.push('### Termine');
    if (!late.length && !tight.length) a.md.push(`- Alle ${open.length} offenen Aufträge im Plan.`);
    for (const o of late.concat(tight).slice(0, 4)) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): ${o.slackSec < 0 ? '**' + dur0(o.slackSec) + ' Verzug**' : 'nur ' + dur0(o.slackSec) + ' Puffer'} – Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)}${o.bottleneck ? '; Engpass ' + o.bottleneck.split(' (')[0] : ''}.`);
    const fin = open.filter(o => o.eta <= until).sort((x, y) => x.eta - y.eta);
    if (fin.length) a.md.push(`- Fertig in den nächsten 2 h: ${fin.map(o => `${o.id} ca. ${clk(o.eta)}`).join(', ')}.`);
    // Nächste 2 Stunden
    a.md.push('', `### Nächste 2 Stunden (bis ${clk(until)})`);
    const ch = plannedChanges(c, until);
    if (ch.length) for (const g of ch.slice(0, 4)) a.md.push(`- Werkzeugwechsel ${clk(g.t)} an ${mName(g.machine)}: ${g.tools.map(x => toolShort(x.name)).join(' + ')}${g.by ? ' – ' + g.by : sh.id ? ' – Einrichter:in noch nicht zugeteilt' : ''}.`);
    else a.md.push('- Kein Werkzeugwechsel fällig.');
    if (sh.id) {
      const shDef = PROF().shifts.find(x => x.id === sh.id);
      const d0 = Math.floor(t / DAY) * DAY;
      const brk = (shDef ? shDef.breaks : []).map(x => ({ a: d0 + U.hm(x[0]), b: d0 + U.hm(x[1]) })).find(x => x.a >= t && x.a <= until);
      if (sh.inBreak) a.md.push(`- Pause läuft bis ${clk(sh.breakEndsAt)} – bemannte Arbeitsplätze stehen, laufende Teile werden fertig.`);
      else if (brk) a.md.push(`- Pause ${clk(brk.a)}–${clk(brk.b)}: die ${PROF().machines.filter(id => station(id).loading !== 'auto').length} bemannten Arbeitsplätze pausieren nach dem laufenden Teil, autonome laufen weiter.`);
      if (sh.endsAt <= until) a.md.push(`- Schichtende ${clk(sh.endsAt)}: Übergabe vorbereiten („Schreib mir die Schichtübergabe“).`);
      const free = Object.values(S().people).filter(p => p.onDuty && !p.endShift && p.state === 'idle' && !p.task);
      if (free.length) a.md.push(`- Gerade verfügbar: ${free.map(p => `${sn(p.name)} (${p.role})`).join(', ')}.`);
    } else a.md.push(`- Unbemannt bis ${clk(sh.endsAt)} – ${b.bullets.length ? 'Stopps werden zum Schichtbeginn abgearbeitet' : 'keine Besonderheiten'}.`);
    // Material & Qualität
    a.md.push('', '### Material & Qualität');
    for (const x of b.bullets.filter(x => x.category === 'material' || x.category === 'qualitaet' || x.category === 'stoerung')) a.md.push(`- ${x.text}`);
    // Empfehlungen
    const recs = [];
    const fl = c.mvs().filter(m => m.state === 'fault');
    if (fl.length) { const fi = faultInfo(fl[0]); recs.push(`Störung ${mName(fl[0].id)}: ${fi.working ? 'Reparatur läuft' : 'Instandhaltung hinschicken'} (Ende ca. ${clk(fi.endT)}).`); }
    if (!sh.id && morningPlan(c)) recs.push(morningPlan(c));
    if (late.length) { const adv = orderAdvice(c, late[0]); recs.push(adv.text); addAction(a, adv.action); }
    const bms = [...new Set(tight.map(bnMachine).filter(Boolean))];
    if (tight.length && bms.length) recs.push(`Knappe Termine (${listJoin(tight.slice(0, 3).map(o => o.id))}) absichern: ${listJoin(bms)} ohne Unterbrechung laufen lassen.`);
    if (ch.some(g => !g.by) && sh.id) { const g = ch.find(x => !x.by); recs.push(`Werkzeug für ${g.machine} (${clk(g.t)}) vermessen bereitlegen.`); }
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min && !mt.onOrder);
    if (low.length) { recs.push(`${listJoin(low.map(mt => mt.name))} nachbestellen.`); for (const mt of low) addAction(a, reorderAction(mt)); }
    const qb = b.bullets.find(x => x.category === 'qualitaet' && x.sev === 'warn');
    if (qb && /SPC-Trend an/.test(qb.text)) { const mid = (qb.entity || '').split('|')[1]; recs.push(`${mid}: Korrekturintervall verkürzen oder Werkzeug vorbeugend früher wechseln.`); }
    if (!recs.length) recs.push('Keine akuten Eingriffe nötig – Fokus auf die anstehenden Werkzeugwechsel und den Engpass.');
    a.md.push('', '### Empfehlungen');
    recs.slice(0, 4).forEach((r, i) => a.md.push(`${i + 1}. ${r}`));
    a.sources = ['Briefing-Regeln aus Live-Daten', 'Prognose / Plantafel', 'Werkzeugplanung', 'Schichtplan', 'Material', srcStand()];
    a.followups = ['Schreib mir die Schichtübergabe', 'Was ist der Engpass?', 'Wo verlieren wir heute Geld?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Benachrichtigung erklären
  function ansNotification(c, n) {
    const a = A('notification');
    if (!n) { a.md.push('Diese Benachrichtigung ist nicht mehr vorhanden.'); return done(a); }
    const sev = (WF.SEV[n.sev] || WF.SEV.info).label;
    const st = n.status === 'resolved' ? 'erledigt' + (n.resolveNote ? ' – ' + n.resolveNote : '') : n.status === 'ack' ? 'quittiert' + (n.ackBy ? ' von ' + n.ackBy : '') : 'offen';
    a.md.push(`**${n.title}**`, `~ ${sev} · ${n.role} · ${tc(n.t)} · ${st}`, '', n.body || '');
    const key = String(n.key || ''), kind = key.split(':')[0];
    const ent = n.entity;
    let sub = null;
    if (ent && ent.kind === 'machine' && S().machines[ent.id]) sub = ansMachine(c, ent.id, kind === 'tool' || kind === 'ghost' ? 'tools' : 'impact');
    else if (ent && ent.kind === 'order' && S().orders[ent.id]) sub = ansOrder(c, ent.id);
    else if (ent && ent.kind === 'material' && S().materials[ent.id]) sub = ansMaterial(c, [ent.id]);
    else if (ent && ent.kind === 'agv') sub = ansLogistics(c, [ent.id]);
    a.md.push('', '### Ursache und Einordnung');
    if (kind === 'ghost' && n.ghost) a.md.push(`- Standzeit von ${toolShort((PROF().toolTypeById[n.ghost.tool] || {}).name || n.ghost.tool)} reicht unbemannt bis ca. ${clk(n.ghost.stopT)}; danach Stillstand bis ${dueTxt(n.ghost.until)}.${n.ghost.gainSec ? ' Ein vorbeugender Wechsel bringt +' + durR(n.ghost.gainSec) + ' unbemannte Laufzeit.' : ''}`);
    if (kind === 'spc' && n.spc) a.md.push(`- Werkzeugverschleiß verschiebt das Maß; Mittelwert der letzten 8 Teile wandert zur Toleranzgrenze. Vorgeschlagene Korrektur ${nm(n.spc.value, 4)} mm.`);
    const own = /^(fault|late|wait)$/.test(kind);
    let ownRec = null;
    if (sub) {
      const lines = sub.md.slice(1).filter(l => { const r = l.indexOf('> **Empfehlung') === 0 || l.indexOf('> **Einschätzung') === 0; if (r && l.indexOf('> **Empfehlung') === 0) ownRec = l; return !r; });
      a.md.push(...lines); if (sub.slots) a.slots = Object.assign(a.slots || {}, sub.slots); a.impact = sub.impact; a.entity = sub.entity; for (const x of sub.actions) addAction(a, x);
    }
    if (own && ownRec && n.status !== 'resolved') a.md.push('', ownRec);
    else if (n.suggestion) a.md.push('', '> **Empfehlung:** ' + n.suggestion);
    for (const x of n.actions || []) {
      if (!x.action || x.action.type === 'select') continue;
      addAction(a, { label: x.label, desc: 'Vorschlag aus der Meldung', action: x.action, icon: x.action.type === 'reorder' ? 'box' : x.action.type === 'setPriority' ? 'bolt' : x.action.type === 'applyOffset' ? 'gauge' : 'wrench' });
    }
    if (n.status === 'open') addAction(a, { label: 'Meldung quittieren', desc: 'Als gesehen markieren (bleibt bis zur Klärung sichtbar).', action: { type: 'ack', id: n.id, by: 'Schichtleitung' }, icon: 'check', quiet: true });
    a.sources = ['Benachrichtigung ' + n.id, ent ? WF.app && WF.app.entityLabel ? WF.app.entityLabel(ent) : ent.id : 'Werk', srcStand()];
    a.followups = sub && sub.followups ? sub.followups.slice(0, 2) : ['Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Hilfe / Rückfall
  function ansHelp() {
    const a = A('help');
    a.md.push('**Der Copilot beantwortet Fragen aus den Live-Daten der Halle**, zum Beispiel:', '');
    a.md.push('- **Lage:** „Wie läuft die Schicht?“, „Schreib mir die Schichtübergabe“');
    a.md.push('- **Termine:** „Welche Aufträge sind gefährdet und warum?“, „Wo steht FA-24118?“');
    a.md.push('- **Engpass & Was-wäre-wenn:** „Was ist der Engpass?“, „Was passiert, wenn die Studer S33 2 h ausfällt?“');
    a.md.push('- **Maschinen & Werkzeuge:** „Warum wartet M07?“, „Wann ist der nächste Werkzeugwechsel an M05?“');
    a.md.push('- **Ressourcen:** „Welches Material wird knapp?“, „Wer ist gerade wo?“, „Wie steht es um die Qualität?“');
    a.md.push('- **Kosten:** „Wo verlieren wir heute Geld?“, „Wie hoch ist der Energieverbrauch?“');
    a.md.push('- **Aktionen:** „FA-24122 als Eilauftrag“, „Titan nachbestellen“, „Störung an M05 auslösen“, „Öffne die Plantafel“ – jede Aktion erst nach Bestätigung.');
    a.sources = ['Live-Simulation ' + (WF.app && WF.app.company ? WF.app.company().name : PROF().company.name)];
    a.followups = ['Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  function ansFallback(c, text) {
    const a = A('fallback'), k = c.k();
    const mvs = c.mvs();
    a.md.push('Dazu habe ich im Offline-Modus keine passende Auswertung. Ich kann Lage, Termine, Engpass, Maschinen, Aufträge, Werkzeuge, Material, Personal, Qualität, Kosten, Was-wäre-wenn und die Schichtübergabe aus den Live-Daten beantworten.', '');
    const nl = c.open().filter(o => o.risk === 'spät').length;
    a.md.push(`Kurz zur Lage: ${mvs.filter(m => m.state === 'running').length} von ${mvs.length} Arbeitsplätzen produzieren, OEE heute ${pct(k.oee, 1)}, ${nl ? pl(nl, 'Auftrag', 'Aufträge') + ' verspätet' : 'kein Auftrag verspätet'}.`);
    a.sources = ['Live-Daten', srcStand()];
    a.followups = ['Was kannst du?', 'Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?'];
    void text;
    return done(a);
  }

  // ------------------------------------------------------------------ Aktionen (aus der Frage)
  const VIEW_TITLE = (id) => { const v = (WF.views || []).find(x => x.id === id); return v ? v.title : id; };
  function ansAction(c, kind, E, q) {
    const a = A('action');
    const m0 = E.machines[0], o0 = E.orders[0];
    if (kind === 'fault') {
      if (!m0) { a.md.push('An welcher Maschine soll die Störung ausgelöst werden? Zum Beispiel: „Störung an M05 auslösen“.'); a.followups = ['Störung an M05 auslösen', 'Störung an M09 auslösen']; return done(a); }
      const mv = c.mv(m0);
      if (mv.fault) { a.md.push(`${mName(m0)} hat bereits eine Störung (${mv.fault.code} ${mv.fault.text}).`); addAction(a, { label: `Störung an ${m0} beheben (Demo)`, desc: 'Beendet die Störung sofort.', action: { type: 'repair', machineId: m0 }, icon: 'wrench' }); return done(a); }
      a.md.push(`**Demo-Störung an ${mName(m0)}** (${stLabel(mv.state)}${mv.order ? ', ' + mv.order.id + ' AG ' + mv.order.seq : ''}): Ein Alarm aus dem Störungskatalog der ${station(m0).control || 'Steuerung'} wird ausgelöst; Benachrichtigung an die Instandhaltung, Prognose und Termine reagieren live.`);
      const aff = affectedOrders(c, m0).slice(0, 3);
      if (aff.length) a.md.push('', `Betroffen wären: ${aff.map(x => `${x.o.id} (Puffer ${x.o.slackSec >= 0 ? dur0(x.o.slackSec) : '–' + dur0(x.o.slackSec)})`).join(', ')}.`);
      addAction(a, { label: `Störung an ${m0} auslösen`, desc: 'Demo-Aktion · Reparaturdauer laut Störungskatalog', action: { type: 'triggerFault', machineId: m0 }, icon: 'alert', danger: true });
      a.followups = [`Was bedeutet eine Störung an ${m0} für die Termine?`, `Was passiert, wenn ${m0} 2 h ausfällt?`];
    } else if (kind === 'repair') {
      const ids = m0 ? [m0] : c.mvs().filter(m => m.fault).map(m => m.id);
      if (!ids.length) { a.md.push('Aktuell hat keine Maschine eine Störung.'); return done(a); }
      for (const id of ids) { const mv = c.mv(id); if (!mv.fault) { a.md.push(`${mName(id)} hat keine Störung.`); continue; } a.md.push(`- ${mName(id)}: ${mv.fault.code} ${mv.fault.text} seit ${clk(mv.fault.t0)}.`); addAction(a, { label: `Störung an ${id} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort.', action: { type: 'repair', machineId: id }, icon: 'wrench' }); }
    } else if (kind === 'priority') {
      const normal = /normal|zurueck|entfern|aufheb|kein eil/.test(q);
      if (!o0) { return ansRisk(c); }
      const o = c.ov(o0);
      if (o.status === 'fertig') { a.md.push(`${o0} ist bereits fertig.`); return done(a); }
      if (!normal && o.priority === 'eil') { a.md.push(`${o0} ist bereits Eilauftrag.`); return done(a); }
      a.md.push(normal ? `**${o0} wieder auf normale Priorität setzen** – die Maschinen planen ihn wieder nach Termin ein.` : `**${o0} als Eilauftrag kennzeichnen:** ${o.part.name} (${custShort(o.customer)}), Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – ${o.slackSec >= 0 ? 'Puffer ' + dur0(o.slackSec) : dur0(o.slackSec) + ' Verzug'}. Jede Maschine zieht ihn beim nächsten Auftragswechsel vor; laufende Teile werden nicht unterbrochen.`);
      if (!normal) { const adv = orderAdvice(c, o); if (/hilft hier nicht|bringt hier nichts|nur verschieben/.test(adv.text)) a.md.push('', '> **Hinweis:** ' + adv.text); else if (/Achtung/.test(adv.text)) a.md.push('', '> **Hinweis:** ' + adv.text.slice(adv.text.indexOf('Achtung'))); }
      addAction(a, { label: normal ? `${o0} normal priorisieren` : `${o0} als Eilauftrag`, desc: normal ? 'Priorität normal – Einplanung wieder nach Termin' : 'Priorität Eil – Vorrang beim nächsten Auftragswechsel', action: { type: 'setPriority', orderId: o0, priority: normal ? 'normal' : 'eil' }, icon: 'bolt' });
      a.entity = { kind: 'order', id: o0 };
      a.followups = [`Wo steht ${o0} gerade?`, 'Welche Aufträge sind gefährdet und warum?'];
    } else if (kind === 'reorder') {
      let ids = E.materials.slice();
      if (!ids.length && /alle|alles|mindestbestand|knapp/.test(q)) ids = Object.values(S().materials).filter(mt => mt.onHand + mt.onOrder < mt.min || mt.onHand < mt.min).map(mt => mt.id);
      if (!ids.length) return ansMaterial(c);
      const qty = (() => { const m = /(\d+(?:[.,]\d+)?)\s*(m|stk|stueck|meter)\b/.exec(q); return m ? Number(m[1].replace(',', '.')) : null; })();
      a.md.push(ids.length === 1 ? '**Bestellvorschlag:**' : `**${ids.length} Bestellvorschläge:**`, '');
      for (const id of ids) {
        const mt = S().materials[id];
        const nd = materialNeeds().need[id] || 0;
        a.md.push(`- **${mt.name}**: Bestand ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}, Bedarf offener Aufträge ca. ${matQty(mt, nd)})${mt.onOrder ? ', bereits bestellt ' + matQty(mt, mt.onOrder) : ''} → **${matQty(mt, qty || mt.reorderQty)}** bei ${mt.supplier}, Lieferung ca. **${dueTxt(deliveryT(mt))}** (Lieferzeit ${durR(mt.leadMin * 60)}), ca. ${eur((qty || mt.reorderQty) * mt.pricePerUnit)}.`);
        addAction(a, reorderAction(mt, qty));
      }
      if (ids.length === 1) a.entity = { kind: 'material', id: ids[0] };
      a.followups = ['Welches Material wird knapp?'];
    } else if (kind === 'move') {
      if (!o0) { a.md.push('Welcher Auftrag soll verlagert werden? Zum Beispiel: „FA-24122 AG 20 auf M04 verlagern“.'); return done(a); }
      const o = c.ov(o0);
      const seqM = /\bag\s?(\d{2})\b/.exec(q);
      const want = E.machines.find(x => S().machines[x]);
      const grpOf = (sid) => (station(sid) ? TYPE_GROUP[station(sid).type] || station(sid).type : null);
      const movable = o.ops.filter(op => !op.complete && S().machines[op.station] && station(op.station).kind === 'machine');
      const cur = seqM ? o.ops.find(op => op.seq === Number(seqM[1])) : (want ? movable.find(op => op.station !== want && grpOf(op.station) === grpOf(want)) : null) || movable[0];
      if (!cur) { a.md.push(`${o0}: kein offener Arbeitsgang an einer Bearbeitungsmaschine – nichts zu verlagern.`); return done(a); }
      const target = want && want !== cur.station ? want : altMachines(cur.station)[0];
      if (!target) { a.md.push(`Für ${o0} AG ${cur.seq} „${cur.op}“ (${mName(cur.station)}) gibt es keine gleichartige Maschine im Werk.`); return done(a); }
      const why = grpOf(target) !== grpOf(cur.station) ? `anderer Maschinentyp als ${mName(cur.station)} (${station(target).name})` : capReason(o0, cur.seq, target);
      if (why) {
        const alt = altMachines(cur.station).filter(x => x !== target), ok = capableAlts(o0, cur.seq, cur.station).filter(x => x !== target);
        a.md.push(`**Nicht möglich:** ${mName(target)} kann AG ${cur.seq} „${cur.op}“ von ${o0} nicht übernehmen – ${why}.`, '');
        if (ok.length) a.md.push(`Möglich wäre ${listJoin(ok.map(mName))} (gleicher Maschinentyp, Leistungsgrenzen passen).`);
        else if (alt.length) a.md.push(`Auch ${alt.length === 1 ? 'die andere gleichartige Maschine passt' : 'die anderen gleichartigen Maschinen passen'} nicht: ${alt.map(x => `${mName(x)} – ${capReason(o0, cur.seq, x)}`).join('; ')}. ${o0} AG ${cur.seq} bleibt an ${mName(cur.station)}.`);
        else a.md.push(`Im Werk gibt es keine gleichartige Maschine – ${o0} AG ${cur.seq} bleibt an ${mName(cur.station)}.`);
        for (const x of ok.slice(0, 2)) addAction(a, { label: `AG ${cur.seq} auf ${x} verlagern`, desc: `${o0} · ${cur.op} · dort neu rüsten (${nm(cur.setupMin)} min)`, action: { type: 'moveOp', orderId: o0, seq: cur.seq, stationId: x }, icon: 'route' });
        a.entity = { kind: 'order', id: o0 };
        a.sources = ['Arbeitsplan ' + o0, 'Maschinentypen und Leistungsgrenzen', srcStand()];
        a.followups = [`Wo steht ${o0} gerade?`, 'Was ist der Engpass?'];
        return done(a);
      }
      a.md.push(`**${o0} AG ${cur.seq} „${cur.op}“ von ${mName(cur.station)} auf ${mName(target)} verlagern?** Dort wird neu gerüstet (${nm(cur.setupMin)} min); die Verlagerung prüft Leistungsgrenzen (Gewicht, Durchmesser, Stange, 5-Achs) und lehnt mit Begründung ab, wenn es nicht geht.`);
      a.md.push('');
      if (cur.state === 'active') { const mvF = c.mv(cur.station); if (mvF && mvF.partEndT) a.md.push(`- ${cur.station} bearbeitet den Arbeitsgang gerade – verlagert werden kann erst an der nächsten Teilegrenze (ca. ${clk(mvF.partEndT)}); dann wandern die restlichen ${teile(Math.max(0, mvF.partsTotal - mvF.partsDone - 1))}.`); }
      const lt = machineLoad(c).find(x => x.id === target), lf = machineLoad(c).find(x => x.id === cur.station);
      if (lt && lf) a.md.push(`- Belastung: ${mName(cur.station)} ${durShortTxt(lf.work)} · ${mName(target)} ${durShortTxt(lt.work)} Arbeitsinhalt.`);
      addAction(a, { label: `AG ${cur.seq} auf ${target} verlagern`, desc: `${o0} · ${cur.op}`, action: { type: 'moveOp', orderId: o0, seq: cur.seq, stationId: target }, icon: 'route' });
      a.entity = { kind: 'order', id: o0 };
      a.followups = [`Wo steht ${o0} gerade?`, `Was macht ${target} gerade?`];
    } else if (kind === 'toolchange') {
      if (!m0) return ansTools(c, q);
      const mv = c.mv(m0);
      if (!mv.order) { a.md.push(`${mName(m0)} hat keinen eingerichteten Arbeitsgang – kein Werkzeugwechsel möglich.`); return done(a); }
      a.md.push(`**Vorbeugenden Werkzeugwechsel an ${mName(m0)} beauftragen?** Gewechselt werden die Werkzeuge, deren Reststandzeit nicht für den Rest von ${mv.order.id} AG ${mv.order.seq} reicht – an der nächsten Teilegrenze, durch den Einrichter.`);
      const opTools = mv.tools.filter(t => t.status !== 'idle');
      for (const t of opTools) a.md.push(`- ${toolLine(t)}`);
      addAction(a, { label: `Werkzeugwechsel an ${m0} planen`, desc: 'Vorbeugend, an der nächsten Teilegrenze', action: { type: 'planToolChange', machineId: m0 }, icon: 'wrench' });
      a.entity = { kind: 'machine', id: m0 };
      a.followups = [`Wann ist der nächste Werkzeugwechsel an ${m0}?`];
    } else if (kind === 'ack') {
      const open = c.notifs().filter(n => n.status === 'open');
      const list = /alle/.test(q) ? open : open.filter(n => n.entity && (E.machines.indexOf(n.entity.id) >= 0 || E.orders.indexOf(n.entity.id) >= 0 || E.materials.indexOf(n.entity.id) >= 0));
      if (!list.length) { a.md.push(open.length ? `Welche Meldung? Offen sind: ${open.slice(0, 5).map(n => n.title).join('; ')}.` : 'Keine offenen Meldungen.'); return done(a); }
      a.md.push(`**${pl(list.length, 'offene Meldung', 'offene Meldungen')} quittieren** (als gesehen markieren – sie bleiben bis zur Klärung sichtbar):`, '');
      for (const n of list.slice(0, 8)) a.md.push(`- ${n.title} (${n.role})`);
      if (list.length > 8) a.md.push(`- … und ${list.length - 8} weitere.`);
      addAction(a, list.length === 1 ? { label: 'Meldung quittieren', desc: list[0].title, action: { type: 'ack', id: list[0].id, by: 'Schichtleitung' }, icon: 'check', quiet: true } : { label: `${list.length} Meldungen quittieren`, desc: 'Quittiert durch Schichtleitung', action: { type: 'ackMany', ids: list.map(n => n.id) }, icon: 'check', quiet: true });
    } else if (kind === 'view') {
      const v = E.views.find(x => (WF.views || []).some(y => y.id === x)) || E.views[0];
      if (E.machines.length && !v) { a.md.push(`Öffne ${mName(E.machines[0])}.`); a.autoRun = { type: 'select', kind: 'machine', id: E.machines[0] }; return done(a); }
      if (E.orders.length && !v) { a.md.push(`Öffne ${E.orders[0]}.`); a.autoRun = { type: 'select', kind: 'order', id: E.orders[0] }; return done(a); }
      if (!v || !(WF.views || []).some(y => y.id === v)) { a.md.push(`Diese Ansicht gibt es nicht. Verfügbar: ${(WF.views || []).map(x => x.title).join(', ')}.`); return done(a); }
      a.md.push(`Ansicht **${VIEW_TITLE(v)}** ist geöffnet.`);
      a.autoRun = { type: 'navigate', view: v };
    }
    a.sources = ['Live-Daten', srcStand()];
    return done(a);
  }

  // ================================================================== Absicht erkennen
  function classify(text, context) {
    const q = norm(text), E = entities(text);
    // Bezug: ausdrücklicher Kontext (Detail offen, „Copilot fragen“) gilt, solange die Frage nicht ausdrücklich das ganze Werk meint;
    // die zuletzt besprochene Entität nur bei Rückbezug („er“, „dort“, „bedeutet das“ …)
    const deictic = /\b(dies(e[rsnm]?|es)?|hier|dort|da(fuer|von|mit|bei|rauf)|er|ihn|ihm|dessen|derselbe)\b|\bdas\s+(fuer|bedeutet|heisst)\b|(bedeutet|heisst|kostet|bringt) das\b/.test(q);
    const globalQ = /\b(welche[rsnm]?|alle[rsnm]?|insgesamt|gesamt|ueberhaupt|ueberall|im werk|in der halle|schicht)\b/.test(q);
    const ctxOk = context && context.kind && context.id && context.kind !== 'view' && context.kind !== 'notification' && (context.fromLast ? deictic && !globalQ : !globalQ || deictic);
    const ctxEnt = ctxOk ? { kind: context.kind, id: context.id } : null;
    // Bezug ergänzen, wenn die Frage keine eigene Entität nennt
    const noEnt = !E.machines.length && !E.orders.length && !E.people.length && !E.materials.length && !E.agvs.length;
    if (noEnt && ctxEnt) {
      if (ctxEnt.kind === 'machine' && S().machines[ctxEnt.id]) E.machines.push(ctxEnt.id);
      else if (ctxEnt.kind === 'order' && S().orders[ctxEnt.id]) E.orders.push(ctxEnt.id);
      else if (ctxEnt.kind === 'person' && S().people[ctxEnt.id]) E.people.push(ctxEnt.id);
      else if (ctxEnt.kind === 'material' && S().materials[ctxEnt.id]) E.materials.push(ctxEnt.id);
      else if (ctxEnt.kind === 'agv' && S().agvs[ctxEnt.id]) E.agvs.push(ctxEnt.id);
      E.fromContext = true;
    }
    const has = (re) => re.test(q);
    // Benachrichtigung
    if (context && context.kind === 'notification') return { intent: 'notification', E, q, id: context.id };
    if (has(/^(hilfe|help)\b|was kannst du|wie funktionier|was weisst du|was kann der copilot|wobei hilfst/)) return { intent: 'help', E, q };
    // Was-wäre-wenn (vor Aktionen: „simuliere einen Ausfall für 2 h“ ist eine Analyse)
    const whatIf = has(/was (passiert|waere|ist|bedeutet)[a-z ,]*\b(wenn|falls)\b|\bwenn\b.*\b(ausfaell|ausfaellt|ausfallen|steht|stehen|stillsteht|kaputt)|\bfalls\b.*\b(ausfaell|ausfaellt|steht)|angenommen|szenario|was waere wenn|\bausfall\b.*\d|\d.*\bausfall\b/);
    if (whatIf && (E.machines.length || has(/ausfaell|ausfall|steht/))) return { intent: 'whatif', E, q };
    // Aktionen (Imperative)
    const imp = has(/^(bitte |kannst du |koenntest du |jetzt )?(loese|loes|simulier|erzeug|bestell|setz|setze|mach|markier|kennzeichne|priorisier|verlager|plan|beauftrag|quittier|oeffne|zeig|geh|wechsle zu|navigier|repariere|behebe)|bitte\b|\b(ausloesen|simulieren|nachbestellen|bestellen|quittieren|verlagern|priorisieren|oeffnen|beheben|reparieren|beauftragen)\b/);
    if (has(/(stoerung|alarm|fehler|ausfall)\w*.*\b(ausloes|simulier|erzeug|provozier|starte)|\b(ausloes|simulier|erzeug|provozier|starte)\w*.*\b(stoerung|alarm|ausfall)|\bloes\w*\b.*\b(stoerung|alarm)\w*\b.*\baus\b/)) return { intent: 'action', act: 'fault', E, q };
    if (has(/\b(repar|beheb|stoerung (beenden|aufheben|weg))/) && imp) return { intent: 'action', act: 'repair', E, q };
    if (has(/quittier/)) return { intent: 'action', act: 'ack', E, q };
    if (has(/\beil(auftrag|ig|-)?\b|als eil|prioris|vorzieh|hoeher prior|dringend machen|normale? prior/) && (E.orders.length || imp) && !has(/welche|sollte|sollten|wer |was ist/)) return { intent: 'action', act: 'priority', E, q };
    if (has(/(nach)?bestell/) && imp && !has(/welche|was muss|muessen wir|sollte/)) return { intent: 'action', act: 'reorder', E, q };
    if (has(/verlager|umplan|auf (eine )?andere maschine/) && imp) return { intent: 'action', act: 'move', E, q };
    if ((has(/(werkzeugwechsel|wechsel)\w*.*\b(planen|beauftrag|vorzieh|vorbeug)|vorbeugend\w* (werkzeug)?wechsel/) && imp) || has(/^(bitte )?(plane|plan|beauftrage)\b.*wechsel/)) return { intent: 'action', act: 'toolchange', E, q };
    if (has(/^(bitte )?(oeffne|zeig mir die|zeige die|geh (zu|zur|in)|wechsle (zu|zur|in)|navigier)/) && (E.views.length || E.machines.length || E.orders.length)) return { intent: 'action', act: 'view', E, q };
    // Lageeinschätzung zu einer Entität (z. B. „Copilot fragen“ im Detail)
    if (has(/lageeinschaetzung|einschaetzung|lagebild|gesamtbild|was ist kritisch/)) {
      if (E.machines.length) return { intent: 'machine', E, q, focus: 'full' };
      if (E.orders.length) return { intent: 'order', E, q };
      if (E.people.length) return { intent: 'people', E, q };
      if (E.materials.length) return { intent: 'material', E, q };
      if (E.agvs.length) return { intent: 'logistics', E, q };
    }
    // Übergabe / Briefing
    if (has(/uebergabe|schichtbericht|schichtprotokoll|handover/)) return { intent: 'handover', E, q };
    if (has(/briefing/)) return { intent: 'briefing', E, q };
    // Themen
    if (has(/engpass|flaschenhals|bottleneck|limitier|kapazitaet|auslastung|ausgelastet|arbeitsvorrat/) && !E.orders.length && !(E.machines.length && !E.fromContext)) return { intent: 'bottleneck', E, q };
    if (has(/angebunden|anbindung|vernetzt|\bopc\b|mtconnect|focas|schnittstelle|nachruest|sensorik|datenquelle|digitalisier|\blevel \d/)) return E.machines.length ? { intent: 'connectM', E, q } : { intent: 'connect', E, q };
    if (has(/\bgeld|kosten|verlust|verlier|stillstandskost|\beuro\b|€|\bteuer|verschwend|\bsparen|rentab|wirtschaftlich/) && !has(/werkzeugkosten/)) return E.machines.length ? { intent: 'lossM', E, q } : { intent: 'loss', E, q };
    if (has(/energie|strom|kwh|kilowatt|verbrauch|leistungsaufnahme|\bkw\b/) && !E.materials.length) return { intent: 'energy', E, q };
    if (has(/qualitaet|ausschuss|\bspc\b|fpy|messwert|erstteil|toleranz|n\.?i\.?o|nacharbeit|regelkarte|reklamation/)) return { intent: 'quality', E, q, focusM: E.machines[0] };
    const toolQ = has(/werkzeug|\bwsp\b|wendeplatte|wendeschneid|standzeit|verschleiss|schleifscheibe|waelzfraeser|bohrer|saegeband|bohrkopf|schneide/);
    if (toolQ && E.machines.length && !E.fromContext) return { intent: 'machine', focus: 'tools', E, q };
    if (toolQ && E.machines.length && E.fromContext && !has(/alle|welche werkzeugwechsel|naechsten \d|heute|schicht/)) return { intent: 'machine', focus: 'tools', E, q };
    if (toolQ) return { intent: 'tools', E, q };
    if (has(/agv|transport|stapler|behaelter|fahrzeug|akku|logistik|fahrerlos/) && !E.orders.length) return { intent: 'logistics', E, q };
    if (has(/angebunden|anbindung|vernetzt|\bopc\b|mtconnect|focas|schnittstelle|nachruest|sensorik|datenquelle|digitalisier|\blevel \d/)) return E.machines.length ? { intent: 'connectM', E, q } : { intent: 'connect', E, q };
    if ((has(/material|\bbestand|bestaende|\blager(bestand|ort|bestaende)?\b|rohmaterial|\bstangen?\b|nachschub|einkauf|bestellung|lieferant|reichweite|vorrat|nachbestell/) && !has(/liefertermin/)) || (E.materials.length && !E.fromContext)) return { intent: 'material', E, q };
    if (E.machines.length && has(/\bwer\b.*(bedien|maschine|dran|zustaendig)|bedient|zustaendig/)) return { intent: 'machine', E, q, focus: 'people' };
    if (E.people.length && !E.fromContext) return { intent: 'people', E, q };
    if (E.roles.length && !E.machines.length && has(/\bwo\b|was macht|wer ist/)) return { intent: 'people', E, q };
    if (has(/personal|mitarbeiter|leute|\bwer\b|wo ist|wo sind|bediener|einrichter|instandhalt|besetz|pause|anwesen|schichtleit|pruefer|monteur|logistiker|kollegen/)) return { intent: 'people', E, q };
    // Auftrag / Maschine konkret
    if (E.orders.length && !E.fromContext) return { intent: 'order', E, q, focus: has(/wann|fertig|eta|liefer/) ? 'eta' : null };
    if (E.customers.length && !E.machines.length) return has(/gefaehrdet|verspaet|termin|knapp/) ? { intent: 'risk', E, q, customer: E.customers[0] } : { intent: 'customer', E, q };
    if (E.machines.length && !E.fromContext) return { intent: 'machine', E, q, focus: machineFocus(q) };
    if (has(/gefaehrdet|verspaet|termin|liefertermin|verzug|knapp|puenktlich|rechtzeitig|schaffen wir|risiko|deadline|lieferung|zu spaet|priorisier/)) {
      if (E.fromContext && E.machines.length) return { intent: 'machine', E, q, focus: 'impact' };
      if (E.fromContext && E.orders.length) return { intent: 'order', E, q };
      return { intent: 'risk', E, q };
    }
    if (E.fromContext && E.orders.length) return { intent: 'order', E, q, focus: has(/wann|fertig/) ? 'eta' : null };
    if (E.fromContext && E.machines.length && (has(/warum|wieso|weshalb|was macht|was ist|status|wann|steht|wartet|laeuft|gerade|lage|einschaetzung|kritisch|bedeutet|auswirkung/) || q.length < 140)) return { intent: 'machine', E, q, focus: machineFocus(q) };
    if (E.fromContext && E.people.length) return { intent: 'people', E, q };
    if (E.fromContext && E.materials.length) return { intent: 'material', E, q };
    if (has(/wie laeuft|lage|ueberblick|uebersicht|status|zusammenfass|was ist los|was passiert gerade|situation|schicht|oee|kennzahl|kpi|heute|aktuell|gerade|wie steht/)) return { intent: 'overview', E, q };
    return { intent: 'fallback', E, q };
  }
  function machineFocus(q) {
    if (/werkzeug|wechsel|standzeit|verschleiss/.test(q)) return 'tools';
    if (/termin|auftraeg|bedeutet|auswirkung|folgen|kunde/.test(q)) return 'impact';
    if (/warum|wieso|weshalb|wartet|steht/.test(q)) return 'why';
    if (/wann|fertig/.test(q)) return 'eta';
    return null;
  }
  /** Offline-Antwort: {kind, text (Markdown), stats, impact, sources, actions, followups, entity} */
  function offlineAnswer(text, context) {
    const c = data();
    const cl = classify(text, context);
    const E = cl.E;
    let a;
    try {
      switch (cl.intent) {
        case 'notification': a = ansNotification(c, (S().notifications || []).find(n => n.id === cl.id || n.key === cl.id)); break;
        case 'help': a = ansHelp(); break;
        case 'whatif': {
          const id = E.machines[0];
          if (!id) { a = A('whatif'); a.md.push('Welche Maschine soll ausfallen? Zum Beispiel: „Was passiert, wenn die Studer S33 2 h ausfällt?“'); a.followups = ['Was passiert, wenn M09 2 h ausfällt?', 'Was passiert, wenn M07 4 h ausfällt?']; a = done(a); }
          else a = ansWhatIf(c, id, E.hours || 2);
          break;
        }
        case 'action': a = ansAction(c, cl.act, E, cl.q); break;
        case 'handover': a = ansHandover(c); break;
        case 'briefing': a = ansBriefing(c); break;
        case 'bottleneck': a = ansBottleneck(c); break;
        case 'loss': a = ansLoss(c); break;
        case 'energy': a = ansEnergy(c); break;
        case 'quality': a = ansQuality(c); break;
        case 'tools': a = ansTools(c, cl.q); break;
        case 'logistics': a = ansLogistics(c, E.agvs); break;
        case 'connect': a = ansConnect(c); break;
        case 'connectM': a = ansConnectMachine(c, E.machines[0], cl.q); break;
        case 'lossM': a = ansLossMachine(c, E.machines[0], cl.q); break;
        case 'material': a = ansMaterial(c, E.materials); break;
        case 'people': a = ansPeople(c, E.people, E.roles); break;
        case 'order': a = ansOrder(c, E.orders[0], cl.focus); break;
        case 'customer': a = ansCustomer(c, E.customers[0]); break;
        case 'risk': a = ansRisk(c, cl.customer); break;
        case 'machine': a = ansMachine(c, E.machines[0], cl.focus); break;
        case 'overview': a = ansOverview(c); break;
        default: a = ansFallback(c, text);
      }
    } catch (e) {
      if (G.console) console.error('[ai] offline', e);
      a = done(Object.assign(A('error'), { md: ['Bei der Auswertung ist ein Fehler aufgetreten: ' + (e && e.message ? e.message : e)] }));
    }
    a.intent = cl.intent;
    return a;
  }

  // ================================================================== Schichtbriefing (regelbasiert, für den Leitstand)
  function briefing() {
    const c = data(), t = c.t, k = c.k(), sh = WF.sim.shift();
    const mvs = c.mvs();
    const prod = mvs.filter(m => m.state === 'running').length;
    const faults = mvs.filter(m => m.state === 'fault');
    const waits = mvs.filter(m => WAIT[m.state] && m.sinceSec >= 300).sort((x, y) => y.sinceSec - x.sinceSec);
    const open = c.open().filter(o => o.eta != null);
    const late = open.filter(o => o.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec);
    const tight = open.filter(o => o.risk === 'knapp').sort((x, y) => x.slackSec - y.slackSec);
    const B = [];
    const ent = (kind, id) => kind + '|' + id;
    // Termine
    if (late.length) {
      const o = late[0];
      B.push({ cat: 'termine', sev: 'warn', entity: ent('order', o.id), text: `Termin: ${o.id} (${custShort(o.customer)}) ${dur0(o.slackSec)} zu spät – Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)}${o.bottleneck ? ', Engpass ' + o.bottleneck.split(' (')[0] : ''}${late.length > 1 ? `; außerdem verspätet: ${late.slice(1, 3).map(x => x.id).join(', ')}` : ''}${tight.length ? `; knapp: ${tight.slice(0, 2).map(x => x.id + ' (' + dur0(x.slackSec) + ')').join(', ')}` : ''}.` });
    } else if (tight.length) {
      const o = tight[0];
      B.push({ cat: 'termine', sev: 'info', entity: ent('order', o.id), text: `Termine halten; am knappsten ${o.id} (${custShort(o.customer)}) mit ${dur0(o.slackSec)} Puffer bis ${dueTxt(o.due)}${tight.length > 1 ? `, außerdem knapp: ${tight.slice(1, 3).map(x => x.id).join(', ')}` : ''}.` });
    } else {
      const nx = open.slice().sort((x, y) => x.eta - y.eta)[0];
      B.push({ cat: 'termine', sev: 'ok', entity: nx ? ent('order', nx.id) : null, text: `Alle ${open.length} offenen Aufträge im Plan${nx ? `; als Nächstes fertig: ${nx.id} ${nx.part.name} ca. ${tc(nx.eta)}` : ''}.` });
    }
    // Engpass / Wartezustände
    if (waits.length) {
      const m = waits[0];
      B.push({ cat: 'engpass', sev: 'warn', entity: ent('machine', m.id), text: `${mName(m.id)} ${lc1(stLabel(m.state))} seit ${durR(m.sinceSec)}: ${m.cause}${waits.length > 1 ? ` (auch ${waits.slice(1, 3).map(x => x.id).join(', ')})` : ''}.` });
    } else {
      const loads = machineLoad(c);
      const bnOf = (id) => open.filter(o => o.bottleneck && o.bottleneck.indexOf(id + ' ') === 0);
      const sc = (x) => x.days + bnOf(x.id).reduce((s2, o) => s2 + (o.risk === 'spät' ? 1 : o.risk === 'knapp' ? 0.4 : 0), 0);
      const top = loads.filter(x => x.work > 0).sort((x, y) => sc(y) - sc(x))[0];
      if (top) {
        const bn = bnOf(top.id);
        B.push({ cat: 'engpass', sev: bn.some(o => o.risk === 'spät') ? 'warn' : 'info', entity: ent('machine', top.id), text: `Engpass ${mName(top.id)}: Arbeitsinhalt ca. ${durShortTxt(top.work)} (≈ ${daysTxt(top.days)}), belegt bis ${tc(top.until)}${bn.length ? ` – längster Arbeitsgang von ${bn.slice(0, 3).map(o => o.id).join(', ')}` : ''}.` });
      }
    }
    // Werkzeugwechsel nächste 2 h
    const ch = plannedChanges(c, t + 2 * 3600);
    if (ch.length) {
      const txt = ch.slice(0, 3).map(g => `${clk(g.t)} ${g.machine} ${toolShort(g.tools[0].name)}${g.tools.length > 1 ? ' +' + (g.tools.length - 1) : ''}${g.by ? ' (' + g.by + ')' : ''}`).join('; ');
      const waitAt = ch.find(g => g.waitFromT);
      B.push({ cat: 'werkzeug', sev: waitAt ? 'warn' : 'tool', entity: ent('machine', ch[0].machine), text: `Werkzeugwechsel bis ${clk(t + 7200)}: ${txt}${ch.length > 3 ? ` (+${ch.length - 3})` : ''}${waitAt ? ` – ${waitAt.machine} wartet ab ${clk(waitAt.waitFromT)} auf den Einrichter` : ''}.` });
    } else {
      const due = mvs.filter(m => m.state === 'waitTool');
      B.push({ cat: 'werkzeug', sev: due.length ? 'warn' : 'ok', entity: due.length ? ent('machine', due[0].id) : null, text: due.length ? `${mName(due[0].id)} wartet auf Werkzeug: ${due[0].cause}.` : `Kein Werkzeugwechsel in den nächsten 2 Stunden – Standzeiten reichen.` });
    }
    // Material
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min).sort((x, y) => x.onHand / x.min - y.onHand / y.min);
    const starved = mvs.filter(m => m.state === 'starved' && /material|rohteil|stange/i.test(m.cause));
    if (low.length) {
      const mt = low[0];
      B.push({ cat: 'material', sev: mt.onOrder ? 'info' : 'warn', entity: ent('material', mt.id), text: `Material: ${mt.name} ${matQty(mt, mt.onHand)} unter Mindestbestand ${matQty(mt, mt.min)} – ${mt.onOrder ? matQty(mt, mt.onOrder) + ' bestellt' + (openPurchases(mt.id)[0] ? ', Lieferung ca. ' + dueTxt(openPurchases(mt.id)[0].etaT) : '') : 'Bestellvorschlag ' + matQty(mt, mt.reorderQty) + ' bei ' + mt.supplier.replace(' (Beispiel)', '')}${low.length > 1 ? ` (auch ${low.slice(1).map(x => x.name).join(', ')})` : ''}.` });
    } else if (starved.length) {
      B.push({ cat: 'material', sev: 'warn', entity: ent('machine', starved[0].id), text: `Material: ${mName(starved[0].id)} – ${starved[0].cause}.` });
    } else {
      const pur = openPurchases()[0];
      B.push({ cat: 'material', sev: 'ok', entity: null, text: `Material: alle Bestände über Mindestbestand${pur ? `; Lieferung ${S().materials[pur.materialId].name} ca. ${dueTxt(pur.etaT)}` : ''}.` });
    }
    // Qualität / Störungen
    if (faults.length) {
      const m = faults[0], fi = faultInfo(m);
      B.push({ cat: 'stoerung', sev: 'crit', entity: ent('machine', m.id), text: `Störung ${mName(m.id)} seit ${clk(m.since)}: ${m.fault.code} ${m.fault.text} – ${fi.who}, Ende ca. ${clk(fi.endT)}${faults.length > 1 ? ` (weitere: ${faults.slice(1).map(x => x.id).join(', ')})` : ''}.` });
    } else {
      const spc = c.notifs().filter(n => String(n.key).indexOf('spc:') === 0);
      const fpiW = mvs.filter(m => m.fpi && m.fpi.waitingSec >= 600);
      const d0b = Math.floor(t / DAY) * DAY, rep = {};
      for (const n of S().notifications || []) if (String(n.key).indexOf('spc:') === 0 && n.t >= d0b) { const mid = n.spc ? n.spc.machineId : n.entity && n.entity.id; (rep[mid] = rep[mid] || []).push(n); }
      const repM = Object.keys(rep).filter(x => rep[x].length >= 2).sort((x, y) => rep[y].length - rep[x].length)[0];
      if (spc.length) B.push({ cat: 'qualitaet', sev: 'warn', entity: spc[0].entity ? ent(spc[0].entity.kind, spc[0].entity.id) : null, text: `Qualität: ${spc[0].title} – Korrektur empfohlen; FPY heute ${pct(k.fpy, 1)}.` });
      else if (repM) B.push({ cat: 'qualitaet', sev: 'warn', entity: ent('machine', repM), text: `Qualität: SPC-Trend an ${mName(repM)} heute ${rep[repM].length}× – Drift kommt nach jeder Korrektur zurück (Werkzeugverschleiß); FPY ${pct(k.fpy, 1)}, ${nm(k.scrap)} Ausschuss.` });
      else if (fpiW.length) B.push({ cat: 'qualitaet', sev: 'warn', entity: ent('machine', fpiW[0].id), text: `Qualität: Erstteil ${mName(fpiW[0].id)} wartet seit ${durR(fpiW[0].fpi.waitingSec)} auf die Prüfung – Maschine steht bis zur Freigabe.` });
      else B.push({ cat: 'qualitaet', sev: k.scrap > 0 && k.fpy < 0.97 ? 'warn' : 'ok', entity: null, text: `Qualität: keine Störung, FPY ${pct(k.fpy, 1)} bei ${nm(k.scrap)} Ausschuss${k.scrap ? ' (' + Object.keys(k.scrapBy || {}).filter(x => k.scrapBy[x]).map(x => x + ' ' + k.scrapBy[x]).join(', ') + ')' : ''}, keine SPC-Warnung.` });
    }
    const RANK = { crit: 0, warn: 1, tool: 2, info: 3, ok: 4 };
    const CAT = ['stoerung', 'termine', 'engpass', 'werkzeug', 'material', 'qualitaet'];
    B.sort((x, y) => RANK[x.sev] - RANK[y.sev] || CAT.indexOf(x.cat) - CAT.indexOf(y.cat));
    const oeeTxt = k.oee != null ? `OEE ${pct(k.oee, 1)} ${k.oee >= TARGET_OEE ? 'über' : 'unter'} Ziel ${pct(TARGET_OEE)}` : 'noch keine OEE-Bezugszeit';
    const head = `${sh.id ? sh.name : 'Geisterschicht'}: ${prod} von ${mvs.length} Arbeitsplätzen produzieren, ${oeeTxt}` +
      (faults.length ? `, ${pl(faults.length, 'Störung', 'Störungen')}` : '') + (late.length ? `, ${pl(late.length, 'Termin', 'Termine')} verspätet` : tight.length ? `, ${nm(tight.length)} knapp` : ', Termine im Plan') + '.';
    return { headline: head, bullets: B.slice(0, 5).map(b => ({ sev: b.sev, text: b.text, entity: b.entity || undefined, category: b.cat })), generatedT: t, mode: 'regelbasiert' };
  }

  // ================================================================== Live-Modus (Claude über `sample`)
  const live = { status: 'verbinde', reason: 'Verbindung zu Claude wird geprüft …', sample: null, tools: false, promise: null, maxTools: 0 };
  function getSample() {
    if (live.promise) return live.promise;
    const cl = G.claude;
    if (!cl || typeof cl.use !== 'function') {
      live.status = 'offline'; live.reason = 'Lokal geöffnet – keine Verbindung zu Claude. Die Antworten kommen vom regelbasierten Offline-Copilot aus denselben Live-Daten.';
      live.promise = Promise.resolve(null);
      emitStatus();
      return live.promise;
    }
    live.promise = Promise.resolve().then(() => cl.use('sample')).then(async (fn) => {
      if (!fn) { live.status = 'offline'; live.reason = 'Claude ist in dieser Ansicht nicht verfügbar. Antworten kommen vom Offline-Copilot.'; emitStatus(); return null; }
      live.sample = fn;
      try { const lim = await fn.limits(); live.tools = !!(lim && lim.tools); live.maxTools = lim && lim.tools ? lim.tools.maxCount : 0; } catch (e) { live.tools = false; }
      live.status = 'live';
      live.reason = live.tools ? 'Claude antwortet aus den Live-Daten, liest Details über Werkzeuge und führt Aktionen nur nach Bestätigung aus.' : 'Claude antwortet aus der Lageübersicht (ohne Werkzeuge in dieser Ansicht).';
      emitStatus();
      return fn;
    }, () => { live.status = 'offline'; live.reason = 'Verbindung zu Claude fehlgeschlagen – Offline-Copilot aktiv.'; emitStatus(); return null; });
    return live.promise;
  }
  function goOffline(reason) { live.status = 'offline'; live.reason = reason; live.sample = null; live.promise = Promise.resolve(null); emitStatus(); }
  function emitStatus() { try { WF.bus.emit('ai:status', { status: live.status, reason: live.reason }); } catch (e) { /* ignorieren */ } if (UI.refreshMode) UI.refreshMode(); }

  /** JSON auf Budget kürzen (Tool-Ergebnisse < 6 kB) */
  function fit(obj, max) {
    max = max || 5800;
    let s = JSON.stringify(obj);
    if (s.length <= max) return obj;
    const o = JSON.parse(s);
    for (let g = 0; g < 40 && s.length > max; g++) {
      let longest = null, len = 0;
      (function walk(x) { if (Array.isArray(x)) { if (x.length > 1 && JSON.stringify(x).length > len) { longest = x; len = JSON.stringify(x).length; } x.forEach(walk); } else if (x && typeof x === 'object') for (const kk in x) walk(x[kk]); })(o);
      if (longest) longest.splice(Math.max(1, Math.floor(longest.length * 0.7)));
      else break;
      s = JSON.stringify(o);
    }
    return o;
  }
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const minOf = (sec) => (sec == null ? null : Math.round(sec / 60));
  function trimMachine(mv) {
    if (!mv) return null;
    return {
      id: mv.id, name: mv.short, typ: mv.name, bereich: mv.area, beladung: label('loading', mv.loading), satzEurH: mv.rate, anbindung: mv.conn.level,
      zustand: mv.stateLabel, seit: tc(mv.since), ursache: mv.cause, phase: mv.phase,
      auftrag: mv.order ? { id: mv.order.id, kunde: custShort(mv.order.customer), teil: mv.order.partName, ag: mv.order.seq, op: mv.order.op, taktMin: mv.order.cycleMin, termin: U.fmtDayClock(mv.order.due), prio: mv.order.priority } : null,
      teile: mv.order ? mv.partsDone + '/' + mv.partsTotal : null, laufendesTeil: mv.partNo, restTeilMin: minOf(mv.partRemainSec), agFertig: mv.etaOpEnd ? U.fmtDayClock(mv.etaOpEnd) : null,
      werkzeuge: (mv.tools || []).filter(t => t.status !== 'idle').map(t => ({ name: t.name, status: label('toolStatus', t.status), verschleissPct: t.wearPct, restTeile: t.remainingParts, wechsel: t.plannedChange ? t.plannedChange.text + (t.plannedChange.by ? ' (' + t.plannedChange.by + ', ' + t.plannedChange.stage + ')' : '') : null, regel: trimTxt(t.explain, 160) })),
      stoerung: mv.fault ? { code: mv.fault.code, text: mv.fault.text, ursache: mv.fault.cause, seitMin: minOf(mv.fault.sinceSec), reparaturMin: mv.fault.repairMin, reparatur: (faultInfo(mv) || {}).who } : null,
      erstteil: mv.fpi ? { stufe: label('fpiStage', mv.fpi.stage), wartetMin: minOf(mv.fpi.waitingSec) } : null,
      bediener: mv.operator ? { name: mv.operator.name, rolle: mv.operator.role, taetigkeit: mv.operator.activity, ort: mv.operator.where } : null,
      personen: (mv.people || []).map(p => ({ name: p.name, taetigkeit: trimTxt(p.activity, 70), ort: p.where })),
      puffer: { eingang: mv.input.length + '/' + mv.inCap, ausgang: mv.output.length + '/' + mv.outCap },
      warteschlange: (mv.queue || []).slice(0, 4).map(q => ({ auftrag: q.orderId, ag: q.seq, op: q.op, grund: trimTxt(q.why, 80) })),
      heute: { oee: r1(mv.oeeToday && mv.oeeToday.oee != null ? mv.oeeToday.oee * 100 : null), gut: mv.goodToday, ausschuss: mv.scrapToday, stillstandEur: mv.lossEurToday, energieKwh: mv.energyKwhToday },
      leistungKw: mv.powerKw, stangeM: mv.barStockM,
    };
  }
  function trimOrder(o) {
    if (!o) return null;
    return {
      id: o.id, kunde: o.customer, teil: o.part.name, teilNr: o.part.no, werkstoff: o.part.material, menge: o.qty, termin: U.fmtDayClock(o.due), prio: o.priority, status: o.status,
      versandt: o.shippedQty, fortschrittPct: Math.round(o.progress * 100), prognose: o.eta ? U.fmtDayClock(o.eta) : null, pufferMin: minOf(o.slackSec), risiko: o.riskLabel, engpass: o.bottleneck,
      arbeitsgaenge: o.ops.map(op => ({ ag: op.seq, op: op.op, platz: op.station, status: op.stateLabel, gut: op.good, ausschuss: op.scrap, soll: op.target, wartend: op.waiting, ursache: op.cause ? trimTxt(op.cause, 90) : undefined, plan: op.plannedStart ? tc(op.plannedStart) + '–' + tc(op.plannedEnd) : null, extern: op.ext ? op.ext.returnText : undefined })),
      behaelter: o.containers.filter(x => x.state !== 'shipped').slice(0, 6).map(x => x.qty + ' Stk ' + x.where),
    };
  }
  const TOOLS = [
    { name: 'get_overview', label: () => 'Liest Lageübersicht', description: 'Aktuelle Lageübersicht der Halle: Kennzahlen, alle Arbeitsplätze (Zustand, Ursache, Auftrag, Werkzeug), offene Aufträge mit Prognose und Risiko, Meldungen, knappes Material, Personal. Nach Aktionen erneut lesen.',
      run: () => { const s = WF.sim.snapshot(); return fit({ zeit: s.clock, schicht: s.shift, kpi: s.kpi, maschinen: s.machines, auftraege: s.orders, meldungen: s.alerts, materialKnapp: s.materialsLow, personal: s.people.map(p => p.name + ' (' + p.role + '): ' + p.act).slice(0, 14) }); } },
    { name: 'get_machine', label: (i) => 'Liest Maschinenstatus ' + (i.id || ''), description: 'Details eines Arbeitsplatzes (id z. B. "M05", "QS", "M13"): Zustand mit Ursache, Auftrag, Teilefortschritt, Werkzeuge mit Verschleiß und geplantem Wechsel, Personen, Puffer, Warteschlange, Tageswerte.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Maschinen-ID, z. B. M05' } }, required: ['id'] },
      run: (i) => { const id = normMachineId(i.id); const mv = id && WF.sim.machineView(id); if (!mv) throw new Error('Unbekannte Maschine: ' + i.id + ' (gültig: ' + PROF().machines.join(', ') + ')'); return fit(trimMachine(mv)); } },
    { name: 'get_order', label: (i) => 'Liest Auftrag ' + (i.id || ''), description: 'Details eines Fertigungsauftrags (id z. B. "FA-24118"): Prognose, Puffer, Risiko, Engpass, Arbeitsgang-Kette mit Status und Plan, Behälterorte.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Auftrags-ID, z. B. FA-24118' } }, required: ['id'] },
      run: (i) => { const id = String(i.id || '').toUpperCase().replace(/^FA(\d)/, 'FA-$1').replace(/^(\d{5})$/, 'FA-$1'); const o = WF.sim.orderView(id); if (!o) throw new Error('Unbekannter Auftrag: ' + i.id); return fit(trimOrder(o)); } },
    { name: 'get_forecast', label: () => 'Liest Prognose und Plantafel', description: 'Prognose: je offenem Auftrag Liefertermin-Prognose, Puffer (min) und Engpass; je Maschine die nächsten eingeplanten Arbeitsgänge (Start–Ende).',
      run: () => { const f = WF.sim.forecast(), o = {}, m = {}; for (const id in f.orders) { const x = f.orders[id]; if (x.done) continue; o[id] = { prognose: U.fmtDayClock(x.eta), pufferMin: minOf(x.slackSec), spaet: x.late, engpass: x.bottleneck }; } for (const id in f.machines) m[id] = f.machines[id].slice(0, 4).map(e => e.orderId + ' AG' + e.seq + ' ' + tc(e.start) + '–' + tc(e.end)); return fit({ auftraege: o, plantafel: m }); } },
    { name: 'get_notifications', label: () => 'Liest Meldungen', description: 'Offene und quittierte Benachrichtigungen (neueste zuerst) mit Titel, Text, Empfehlung, Rolle und möglichen Aktionen.',
      run: () => fit((S().notifications || []).filter(n => n.status !== 'resolved').slice(0, 14).map(n => ({ id: n.id, schwere: n.sev, status: n.status, rolle: n.role, zeit: tc(n.t), titel: n.title, text: trimTxt(n.body, 200), empfehlung: trimTxt(n.suggestion, 200), aktionen: (n.actions || []).filter(x => x.action.type !== 'select').map(x => x.label) }))) },
    { name: 'get_materials', label: () => 'Liest Materialbestände', description: 'Rohmaterial: Bestand, Mindestbestand, bestellt, Bedarf der offenen Aufträge, Lieferant und Lieferzeit; offene Bestellungen.',
      run: () => { const { need } = materialNeeds(); return fit({ material: Object.values(S().materials).map(mt => ({ id: mt.id, name: mt.name, bestand: r1(mt.onHand), min: mt.min, einheit: mt.unit, bestellt: r1(mt.onOrder), bedarfOffen: r1(need[mt.id] || 0), lieferant: mt.supplier, lieferzeitH: r1(mt.leadMin / 60), bestellmenge: mt.reorderQty })), bestellungen: openPurchases().map(p => ({ id: p.id, material: p.materialId, menge: p.qty, lieferung: U.fmtDayClock(p.etaT) })) }); } },
    { name: 'get_people', label: () => 'Liest Personaleinsatz', description: 'Personal im Dienst: Name, Rolle, Zustand, Tätigkeit, Ort, Auslastung heute; dazu die nächste Schicht.',
      run: () => fit({ imDienst: Object.values(S().people).filter(p => p.state !== 'offShift').map(p => ({ id: p.id, name: p.name, rolle: p.role, zustand: label('person', p.state), taetigkeit: trimTxt(p.activity, 80), ort: personWhere(p), auslastungPct: Math.round((p.utilToday || 0) * 100) })), schicht: WF.sim.shift().name }) },
    { name: 'get_tools', label: (i) => 'Liest Werkzeugdaten' + (i.machineId ? ' ' + i.machineId : ''), description: 'Werkzeuge im Einsatz mit Verschleiß %, Rest-Teilen, Status und geplantem Wechsel (Uhrzeit, Einrichter). Optional machineId für eine Maschine; ohne: alle geplanten Wechsel.',
      inputSchema: { type: 'object', properties: { machineId: { type: 'string', description: 'optional, z. B. M05' } } },
      run: (i) => {
        const c = data(), id = normMachineId(i.machineId);
        if (id) { const mv = c.mv(id); if (!mv) throw new Error('Unbekannte Maschine'); return fit({ maschine: id, werkzeuge: mv.tools.map(t => ({ name: t.name, status: label('toolStatus', t.status), verschleissPct: t.wearPct, restTeile: t.remainingParts, wechsel: t.plannedChange ? t.plannedChange.text : null, durch: t.plannedChange ? t.plannedChange.by : null, regel: trimTxt(t.explain, 180) })) }); }
        return fit({ geplanteWechsel: plannedChanges(c, c.t + 12 * 3600).map(g => ({ zeit: tc(g.t), maschine: g.machine, werkzeuge: g.tools.map(x => x.name), nachTeil: g.afterPart, durch: g.by, stufe: g.stage })), werkzeugkostenHeute: c.k().toolCostToday, wechselHeute: c.k().toolChangesToday });
      } },
    { name: 'trigger_fault', act: true, label: (i) => 'Löst Störung aus an ' + (i.machineId || ''), description: 'DEMO-Aktion: löst an einer Maschine eine Störung aus dem Störungskatalog aus. Nur auf ausdrücklichen Wunsch; der Nutzer bestätigt in der Oberfläche.',
      inputSchema: { type: 'object', properties: { machineId: { type: 'string' } }, required: ['machineId'] },
      confirm: (i) => ({ title: `Störung an ${mName(normMachineId(i.machineId) || i.machineId)} auslösen`, desc: 'Demo-Aktion · Reparaturdauer laut Störungskatalog', icon: 'alert', danger: true, action: { type: 'triggerFault', machineId: normMachineId(i.machineId) } }) },
    { name: 'ack_notification', act: true, quiet: true, label: (i) => 'Quittiert Meldung ' + (i.id || ''), description: 'Quittiert eine Benachrichtigung (id z. B. "NT-0012").',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      confirm: (i) => ({ title: 'Meldung ' + i.id + ' quittieren', desc: ((S().notifications || []).find(n => n.id === i.id) || {}).title || '', icon: 'check', action: { type: 'ack', id: String(i.id), by: 'Copilot (bestätigt)' } }) },
    { name: 'set_priority', act: true, label: (i) => 'Setzt Priorität ' + (i.orderId || ''), description: 'Setzt die Priorität eines Auftrags: "eil" (wird an jeder Maschine beim nächsten Auftragswechsel vorgezogen) oder "normal".',
      inputSchema: { type: 'object', properties: { orderId: { type: 'string' }, priority: { type: 'string', enum: ['eil', 'normal'] } }, required: ['orderId', 'priority'] },
      confirm: (i) => ({ title: `${i.orderId}: Priorität ${i.priority === 'normal' ? 'normal' : 'Eilauftrag'}`, desc: 'Maschinen planen beim nächsten Auftragswechsel neu; laufende Teile werden nicht unterbrochen.', icon: 'bolt', action: { type: 'setPriority', orderId: String(i.orderId), priority: i.priority === 'normal' ? 'normal' : 'eil' } }) },
    { name: 'reorder_material', act: true, label: (i) => 'Löst Nachbestellung aus ' + (i.materialId || ''), description: 'Bestellt Rohmaterial nach (materialId z. B. "MAT-TI10", qty optional, sonst Standard-Bestellmenge).',
      inputSchema: { type: 'object', properties: { materialId: { type: 'string' }, qty: { type: 'number' } }, required: ['materialId'] },
      confirm: (i) => { const mt = S().materials[String(i.materialId)]; return { title: mt ? `${mt.name} nachbestellen` : 'Nachbestellung ' + i.materialId, desc: mt ? `${matQty(mt, i.qty || mt.reorderQty)} bei ${mt.supplier} · ca. ${eur((i.qty || mt.reorderQty) * mt.pricePerUnit)}` : '', icon: 'box', action: { type: 'reorder', materialId: String(i.materialId), qty: i.qty != null ? Number(i.qty) : undefined } }; } },
    { name: 'move_operation', act: true, label: (i) => `Verlagert ${i.orderId || ''} AG ${i.seq || ''}`, description: 'Verlagert einen Arbeitsgang auf eine gleichartige Maschine (orderId, seq z. B. 20, stationId z. B. "M02"). Die Engine prüft Typ und Leistungsgrenzen und lehnt mit Begründung ab.',
      inputSchema: { type: 'object', properties: { orderId: { type: 'string' }, seq: { type: 'number' }, stationId: { type: 'string' } }, required: ['orderId', 'seq', 'stationId'] },
      confirm: (i) => ({ title: `${i.orderId} AG ${i.seq} auf ${normMachineId(i.stationId) || i.stationId} verlagern`, desc: 'Dort wird neu gerüstet.', icon: 'route', action: { type: 'moveOp', orderId: String(i.orderId), seq: Number(i.seq), stationId: normMachineId(i.stationId) || String(i.stationId) } }) },
    { name: 'plan_tool_change', act: true, label: (i) => 'Plant Werkzeugwechsel ' + (i.machineId || ''), description: 'Beauftragt einen vorbeugenden Werkzeugwechsel an einer Maschine (an der nächsten Teilegrenze; Auswahl nach Reststandzeit).',
      inputSchema: { type: 'object', properties: { machineId: { type: 'string' } }, required: ['machineId'] },
      confirm: (i) => ({ title: `Vorbeugender Werkzeugwechsel an ${normMachineId(i.machineId) || i.machineId}`, desc: 'An der nächsten Teilegrenze, durch den Einrichter', icon: 'wrench', action: { type: 'planToolChange', machineId: normMachineId(i.machineId) } }) },
    { name: 'open_view', label: (i) => 'Öffnet Ansicht ' + VIEW_TITLE(i.view || ''), description: 'Öffnet eine Ansicht der App: ' + 'leitstand, halle, auftraege, material, werkzeuge, personal, qualitaet, anbindung, analyse, ki-auftrag (nur vorhandene).',
      inputSchema: { type: 'object', properties: { view: { type: 'string' } }, required: ['view'] },
      run: (i) => { const v = String(i.view || '').toLowerCase(); if (!(WF.views || []).some(x => x.id === v)) throw new Error('Ansicht nicht vorhanden. Verfügbar: ' + (WF.views || []).map(x => x.id).join(', ')); if (WF.app) WF.app.navigate(v); return { ok: true, geoeffnet: VIEW_TITLE(v) }; } },
    { name: 'select_entity', label: (i) => 'Öffnet ' + (i.id || ''), description: 'Öffnet das Detail einer Entität rechts (kind: machine|order|person|agv|tool|material|container, id).',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind', 'id'] },
      run: (i) => { if (WF.app) UI.openEntity(String(i.kind), String(i.id)); return { ok: true }; } },
  ];
  function normMachineId(x) {
    if (!x) return null;
    const s = String(x).trim().toUpperCase();
    if (S().machines[s]) return s;
    const m = /^M\s?-?(\d{1,2})$/.exec(s); if (m && S().machines['M' + m[1].padStart(2, '0')]) return 'M' + m[1].padStart(2, '0');
    const E = entities(String(x)); return E.machines[0] || null;
  }
  function instructions(ctx) {
    const P = PROF(), co = WF.app && WF.app.company ? WF.app.company() : { name: P.company.name, site: P.company.site };
    const view = WF.app && WF.app.current ? WF.app.current.title : 'Leitstand';
    const ent = ctx && ctx.kind && ctx.id && ctx.kind !== 'view' ? (WF.app ? WF.app.entityLabel({ kind: ctx.kind === 'notification' && ctx.entity ? ctx.entity.kind : ctx.kind, id: ctx.kind === 'notification' && ctx.entity ? ctx.entity.id : ctx.id }) : ctx.id) : null;
    const machines = P.machines.map(id => { const s = station(id); return `${id} ${s.short} (${s.name}, ${label('loading', s.loading)}, ${s.rate} €/h)`; }).join('; ');
    const snap = WF.sim.snapshot();
    return [
      `Du bist der werkfluss Copilot – der KI-Assistent im MES „werkfluss“ bei ${co.name} (${co.site}). ${P.company.description} ${P.company.employees} Mitarbeitende, 2 AGVs, Frühschicht 06:00–14:00, Spätschicht 14:00–22:00 (Pausen 09:00, 12:00, 17:00, 19:30); danach laufen autonome Maschinen unbemannt weiter (Geisterschicht). Alle Daten stammen aus einer Live-Simulation der Fertigung; behandle sie wie echte Betriebsdaten.`,
      `Arbeitsplätze: ${machines}. Externe Härterei: ${'Härterei Wolf GmbH (Beispiel)'}.`,
      `Nutzer: Produktions- bzw. Schichtleitung. Geöffnete Ansicht: ${view}${ent ? '; Bezug der Frage: ' + ent : ''}. Jetzt: ${WF.sim.clock()}, ${WF.sim.shift().name}.`,
      'Regeln:',
      '- Antworte auf Deutsch, sachlich und knapp (meist 4–10 Zeilen), neutrale Formulierungen ohne Du/Sie, keine Emojis.',
      '- Nenne konkrete IDs und Zahlen (FA-24118, M05, P06, Uhrzeiten, Teile, €) ausschließlich aus der Lageübersicht unten oder aus Werkzeug-Ergebnissen. Erfinde nichts; fehlt etwas, sag es und lies es über ein Werkzeug nach.',
      '- Erkläre Ursachen (Zustand → Ursache → Auswirkung auf Termin/Kosten) und schließe mit einer konkreten Empfehlung als eigener Zeile „> **Empfehlung:** …“.',
      '- Formatierung: **fett** für Kernaussagen, Listen mit „- “, höchstens Überschriften „### “. Keine Tabellen.',
      '- Aktionen (Störung auslösen, Priorität, Nachbestellung, Verlagerung, Werkzeugwechsel, Quittieren) nur auf ausdrücklichen Wunsch; der Nutzer bestätigt jede Aktion im Panel. Abgelehnt = nicht erneut versuchen. Nach einer Aktion das Ergebnis kurz berichten.',
      '- Fachbegriffe: Zustände Produktion, Rüsten, Erstteilprüfung, Werkzeugwechsel, Wartet auf Werkzeug/Bediener/Material, Ausgang voll, Störung, Bereit. Werkzeuge werden nur zwischen zwei Teilen gewechselt, angekündigt mit Uhrzeit und Einrichter. Prognose = Plantafel; Engpass = längster Arbeitsgang im Plan; Stillstandskosten = Maschinenstundensatz × Zeit mit eingeplantem Auftrag ohne Produktion (Schichtzeit).',
      live.tools ? '- Für Details die Werkzeuge nutzen (get_machine, get_order, get_forecast, get_tools, get_materials, get_people, get_notifications).' : '- In dieser Ansicht gibt es keine Werkzeuge: antworte nur aus der Lageübersicht und sag, wenn Details fehlen.',
      '',
      `Lageübersicht (JSON, Stand ${snap.clock}):`,
      JSON.stringify(snap),
    ].join('\n');
  }
  function pickTier(text) {
    const q = norm(text);
    if (/warum|wieso|weshalb|was passiert|was waere|wenn|falls|uebergabe|briefing|gefaehrdet|engpass|geld|verlust|kosten|empfiehl|analys|ursache|bedeutet|auswirkung|optimier|vergleich|plan|bringt|hilft|soll ich|sollte|lohnt|risiko|einschaetz/.test(q) || q.length > 90) return 'default';
    return 'quick';
  }
  const ERR = {
    rate_limited: 'Claude ist gerade ausgelastet bzw. das Nutzungslimit ist erreicht. Bitte in einigen Minuten erneut versuchen.',
    session_expired: 'Die Anmeldung bei Claude ist abgelaufen – bitte auf claude.ai neu anmelden und erneut senden.',
    refused: 'Claude hat diese Anfrage abgelehnt. Bitte anders formulieren.',
    empty_completion: 'Claude hat keine Antwort geliefert. Bitte die Frage vereinfachen.',
    prompt_too_large: 'Die Unterhaltung ist zu lang geworden. Bitte „Neu beginnen“ und erneut fragen.',
    upstream_error: 'Die Verbindung zu Claude wurde unterbrochen.',
  };
  const PERMANENT = { not_granted: 'Claude wurde für diese Seite nicht freigegeben', sampling_disabled: 'Claude ist für dieses Konto nicht verfügbar', not_declared: 'Die Seite hat keinen Claude-Zugang', capability_disabled: 'Claude ist in dieser Ansicht deaktiviert', capability_removed: 'Diese Claude-Funktion ist hier nicht verfügbar', invalid_request: 'Anfrage an Claude war ungültig', transform_error: 'Anfrage an Claude konnte nicht vorbereitet werden', queue_overflow: 'Zu viele Anfragen an Claude' };

  // ================================================================== Oberfläche
  const UI = {};
  const conv = { msgs: [], busy: false, ctl: null, context: null, lastEntity: null, seq: 0, history: [] };

  WF.ai = {
    get status() { return live.status; },
    get statusReason() { return live.reason; },
    getSample,
    open: (opts) => UI.open && UI.open(opts),
    close: () => UI.close && UI.close(),
    toggle: () => UI.toggle && UI.toggle(),
    get isOpen() { return !!(UI.isOpen && UI.isOpen()); },
    ask: (text, context) => (UI.ask ? UI.ask(text, context) : Promise.resolve(offlineAnswer(text, context))),
    briefing,
    /** „Mit KI formulieren“: öffnet den Copilot und lässt das Briefing ausformulieren (live: Claude, offline: Regeln) */
    formulateBriefing: () => WF.ai.ask('Formuliere das Schichtbriefing für die nächsten 2 Stunden: Lage, Termine, Engpass, Werkzeugwechsel, Material, Qualität – mit konkreten Empfehlungen.', { kind: 'view', id: 'leitstand', briefing: true }),
    explainNotification: (id) => {
      const n = (S().notifications || []).find(x => x.id === id || x.key === id);
      if (!n) return Promise.resolve(null);
      return WF.ai.ask(`Analysiere die Meldung „${n.title}“: Ursache, Auswirkung (Termin, Kosten) und was jetzt zu tun ist.`, { kind: 'notification', id: n.id, entity: n.entity });
    },
    offlineAnswer,
    entities,
    /** Stillstandskosten je Ursache (Schichtzeit, Zustandsband) – gleiche Rechnung für alle Ansichten nutzbar */
    lossByCause: () => { const L = lossByCause(data()); return { causes: L.causes.map(x => ({ state: x.state, label: CAUSE_LABEL[x.state], eur: Math.round(x.eur) })), machines: L.byMachine.map(x => ({ id: x.mv.id, eur: x.loss, lossSec: x.lossSec, causes: x.causes.map(y => ({ state: y.state, sec: y.sec, eur: Math.round(y.eur) })) })) }; },
    suggestions: (ctx) => suggestionsFor(ctx || currentContext()),
    clear: () => UI.clear && UI.clear(),
    /** intern für Tests: Werkzeugliste (Name, Beschreibung) */
    toolSpecs: () => TOOLS.map(t => ({ name: t.name, description: t.description, act: !!t.act })),
    /** nur für Tests: Lese-Werkzeug ausführen (Aktions-Werkzeuge laufen ausschließlich über die Bestätigung im Panel) */
    _readTool: (name, input) => { const t = TOOLS.find(x => x.name === name && !x.act && x.run && name.indexOf('get_') === 0); return t ? t.run(input || {}) : null; },
  };

  function currentContext() {
    if (conv.context) return conv.context;
    const sel = WF.app && WF.app.selected;
    if (sel && sel.kind && sel.id) return { kind: sel.kind, id: sel.id };
    return WF.app && WF.app.current ? { kind: 'view', id: WF.app.current.id } : null;
  }
  /** kontextbezogene Vorschläge (Maschine/Auftrag/Person/Material oder Ansicht) */
  function suggestionsFor(ctx) {
    const out = [];
    const push = (x) => { if (x && out.indexOf(x) < 0) out.push(x); };
    try {
      if (ctx && ctx.kind === 'machine' && S().machines[ctx.id]) {
        const mv = WF.sim.machineView(ctx.id), id = ctx.id;
        if (mv.state === 'fault') push(`Was bedeutet die Störung an ${id} für die Termine?`);
        else if (WAIT[mv.state]) push(`Warum ${mv.state === 'blocked' ? 'ist der Ausgang an ' + id + ' voll' : 'wartet ' + id}?`);
        else if (mv.state === 'idle') push(`Warum hat ${id} keinen Auftrag?`);
        else if (mv.order) push(`Wann ist ${id} mit ${mv.order.id} fertig?`);
        push(`Wann ist der nächste Werkzeugwechsel an ${id}?`);
        push(`Was passiert, wenn ${id} 2 h ausfällt?`);
        if (mv.order) push(`Wo steht ${mv.order.id} gerade?`);
      } else if (ctx && ctx.kind === 'order' && S().orders[ctx.id]) {
        const o = WF.sim.orderView(ctx.id);
        push(`Wo steht ${ctx.id} und wann ist er fertig?`);
        if (o.risk !== 'ok') push(`Warum ist ${ctx.id} ${o.risk === 'spät' ? 'verspätet' : 'knapp'} und was hilft?`);
        if (o.bottleneck) push(`Was passiert, wenn ${o.bottleneck.split(' ')[0]} 2 h ausfällt?`);
        if (o.priority !== 'eil' && o.status !== 'fertig') push(`${ctx.id} als Eilauftrag kennzeichnen`);
      } else if (ctx && ctx.kind === 'person' && S().people[ctx.id]) {
        push(`Was macht ${sn(S().people[ctx.id].name)} gerade?`);
        push('Wer ist gerade wo?');
      } else if (ctx && ctx.kind === 'material' && S().materials[ctx.id]) {
        push(`Reicht der Bestand von ${S().materials[ctx.id].name}?`);
        push('Welches Material wird knapp?');
      } else if (ctx && ctx.kind === 'agv') {
        push('Was machen die AGVs gerade?');
      }
      const view = (ctx && ctx.kind === 'view' ? ctx.id : null) || (WF.app && WF.app.current ? WF.app.current.id : 'leitstand');
      const VIEW_S = {
        werkzeuge: ['Welche Werkzeugwechsel stehen in den nächsten 2 h an?'], material: ['Welches Material wird knapp?', 'Was machen die AGVs gerade?'],
        personal: ['Wer ist gerade wo?'], qualitaet: ['Wie steht es um die Qualität heute?'], auftraege: ['Welche Aufträge sind gefährdet und warum?', 'Was ist der Engpass?'],
        analyse: ['Wo verlieren wir heute Geld?', 'Wie hoch ist der Energieverbrauch?'], halle: ['Wie läuft die Schicht?', 'Was machen die AGVs gerade?'], anbindung: ['Welche Maschinen sind nicht angebunden?'],
      };
      for (const x of VIEW_S[view] || []) push(x);
      for (const x of ['Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?', 'Was passiert, wenn die Studer S33 2 h ausfällt?', 'Schreib mir die Schichtübergabe', 'Wo verlieren wir heute Geld?']) push(x);
    } catch (e) { /* Vorschläge sind optional */ }
    return out.slice(0, 7);
  }

  if (!HAS_DOM) return;

  // ------------------------------------------------------------------ CSS (Präfix .ai-)
  WF.ui.css(`
  .ai-panel{position:fixed;top:var(--top-h);right:0;bottom:0;width:min(440px,100%);z-index:45;display:flex;flex-direction:column;
    background:var(--panel);border-left:1px solid var(--line2);box-shadow:-26px 0 60px rgba(0,0,0,.42);transform:translateX(104%);
    visibility:hidden;transition:transform .28s cubic-bezier(.2,.8,.2,1),right .28s cubic-bezier(.2,.8,.2,1),visibility 0s linear .28s;overflow:hidden}
  .ai-panel.open{transform:none;visibility:visible;transition:transform .28s cubic-bezier(.2,.8,.2,1),right .28s cubic-bezier(.2,.8,.2,1),visibility 0s}
  .ai-panel.beside{right:min(480px,100%);border-right:1px solid var(--line2)}
  .ai-panel::before{content:"";position:absolute;inset:0 0 auto;height:180px;pointer-events:none;
    background:radial-gradient(420px 160px at 85% -40px,color-mix(in srgb,var(--accent) 15%,transparent),transparent 72%),radial-gradient(300px 140px at 0% -60px,color-mix(in srgb,var(--st-tool) 10%,transparent),transparent 70%)}
  .ai-h{position:relative;display:flex;align-items:center;gap:11px;padding:13px 12px 12px 16px;border-bottom:1px solid var(--line)}
  .ai-orb{--s:34px;width:var(--s);height:var(--s);border-radius:calc(var(--s) * .32);display:grid;place-items:center;flex:none;color:#04202b;
    background:linear-gradient(140deg,var(--accent) 0%,color-mix(in srgb,var(--accent) 45%,var(--st-tool)) 100%);box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 26%,transparent),inset 0 1px 0 rgba(255,255,255,.35)}
  .ai-orb .ico{width:calc(var(--s) * .52);height:calc(var(--s) * .52)}
  .ai-orb.sm{--s:24px;box-shadow:0 3px 10px color-mix(in srgb,var(--accent) 20%,transparent)}
  .ai-panel.busy .ai-h .ai-orb{animation:aiGlow 1.6s ease-in-out infinite}
  @keyframes aiGlow{0%,100%{box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 26%,transparent),inset 0 1px 0 rgba(255,255,255,.35)}50%{box-shadow:0 6px 26px color-mix(in srgb,var(--accent) 55%,transparent),0 0 0 4px color-mix(in srgb,var(--accent) 14%,transparent),inset 0 1px 0 rgba(255,255,255,.35)}}
  .ai-ht{flex:1;min-width:0}
  .ai-ttl{font:600 19px/1.1 var(--f-cond);letter-spacing:.01em;white-space:nowrap}
  .ai-ttl b{color:var(--accent);font-weight:600}
  .ai-modew{position:relative;display:inline-flex;margin-top:4px}
  .ai-mode{--c:var(--st-idle);display:inline-flex;align-items:center;gap:6px;font:600 11px/1 var(--f-ui);letter-spacing:.02em;padding:4px 8px 4px 7px;border-radius:999px;cursor:help;
    color:color-mix(in srgb,var(--c) 80%,white);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 34%,transparent)}
  .ai-mode i{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
  .ai-mode.live{--c:var(--st-run)} .ai-mode.live i{animation:aiPulse 2s ease-in-out infinite}
  .ai-mode.offline{--c:var(--st-wait)} .ai-mode.verbinde{--c:var(--info)} .ai-mode.verbinde i{animation:aiBlinkDot 1s ease-in-out infinite}
  .ai-tip{position:absolute;left:0;top:calc(100% + 8px);width:300px;max-width:calc(100vw - 40px);z-index:5;padding:11px 12px;border-radius:10px;background:var(--card2);border:1px solid var(--line2);
    box-shadow:var(--shadow);font:400 12.5px/1.45 var(--f-ui);color:var(--text2);opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity .15s ease,transform .15s ease}
  .ai-tip b{color:var(--text);font-weight:600;display:block;margin-bottom:3px}
  .ai-modew:hover .ai-tip,.ai-modew:focus-within .ai-tip{opacity:1;transform:none}
  .ai-hb{display:flex;align-items:center;gap:4px}
  .ai-ib{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}
  .ai-ib:hover{color:var(--text);background:var(--card);border-color:var(--line)}
  .ai-ib:disabled{opacity:.35;cursor:default;background:transparent;border-color:transparent}
  .ai-ctx{position:relative;display:flex;align-items:center;gap:8px;padding:7px 14px 7px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);min-height:38px;background:color-mix(in srgb,var(--bg2) 55%,transparent)}
  .ai-ctx .eyebrow{font-size:9.5px;flex:none}
  .ai-ctx .ai-ent{max-width:100%}
  .ai-ctx .ai-ctxs{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ai-ctx button.ai-x{flex:none;border:0;background:transparent;color:var(--faint);cursor:pointer;padding:2px;border-radius:5px;display:grid;place-items:center}
  .ai-ctx button.ai-x:hover{color:var(--text)}
  .ai-log{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 16px 14px;display:flex;flex-direction:column;gap:18px;overscroll-behavior:contain}
  .ai-m{display:flex;flex-direction:column;min-width:0;animation:aiIn .22s ease}
  .ai-m.u{align-self:flex-end;align-items:flex-end;max-width:88%}
  .ai-bub{background:color-mix(in srgb,var(--accent) 14%,var(--card));border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:14px 14px 4px 14px;
    padding:8px 12px;font-size:13.5px;line-height:1.45;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
  .ai-meta{font:500 10.5px/1 var(--f-ui);color:var(--faint);margin-top:5px;font-variant-numeric:tabular-nums;display:flex;gap:6px;align-items:center}
  .ai-m.a{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:10px}
  .ai-m.a > .ai-orb{margin-top:1px}
  .ai-ah{display:flex;align-items:center;gap:7px;min-height:24px;font-size:12px;color:var(--text);font-weight:600}
  .ai-ah .ai-tag{font:600 9.5px/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;padding:3px 5px;border-radius:4px;color:var(--muted);border:1px solid var(--line2)}
  .ai-ah .ai-tag.ki{color:var(--st-run);border-color:color-mix(in srgb,var(--st-run) 35%,transparent)}
  .ai-ah time{margin-left:auto;font:500 10.5px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .ai-copy{display:inline-grid;place-items:center;width:24px;height:22px;margin:-3px -4px -3px 2px;border-radius:6px;border:0;background:transparent;color:var(--faint);cursor:pointer;opacity:0;transition:opacity .15s ease,color .15s ease}
  .ai-m.a:hover .ai-copy,.ai-copy:focus-visible{opacity:1}
  .ai-copy:hover{color:var(--text);background:var(--card)}
  .ai-copy.ok{opacity:1;color:var(--st-run)}
  @media (hover:none){.ai-copy{opacity:.8}}
  .ai-ab{min-width:0;margin-top:3px}
  .ai-md{font-size:13.5px;line-height:1.56;color:var(--text2);overflow-wrap:anywhere}
  .ai-md > :first-child{margin-top:0}
  .ai-md p{margin:0 0 8px}
  .ai-md b,.ai-md strong{color:var(--text);font-weight:600}
  .ai-md ul,.ai-md ol{margin:2px 0 9px;padding:0;list-style:none}
  .ai-md ol{counter-reset:ai}
  .ai-md li{position:relative;padding-left:16px;margin:4px 0}
  .ai-md ul > li::before{content:"";position:absolute;left:3px;top:.66em;width:5px;height:5px;border-radius:50%;background:color-mix(in srgb,var(--accent) 75%,var(--muted))}
  .ai-md ol > li{counter-increment:ai;padding-left:20px}
  .ai-md ol > li::before{content:counter(ai) ".";position:absolute;left:0;top:0;color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px}
  .ai-md h4{margin:14px 0 6px;font:600 10.5px/1.2 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .ai-md h4:first-child{margin-top:2px}
  .ai-md blockquote{margin:10px 0 4px;padding:9px 11px 9px 12px;border-radius:9px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));
    border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--accent) 70%,transparent);color:var(--text2)}
  .ai-md blockquote + blockquote{margin-top:6px}
  .ai-md code{font:500 12px/1 var(--f-mono);background:var(--bg2);border:1px solid var(--line);border-radius:4px;padding:1px 4px}
  .ai-md hr{border:0;border-top:1px solid var(--line);margin:10px 0}
  .ai-tblw{overflow-x:auto;margin:6px 0 10px;border:1px solid var(--line);border-radius:8px}
  .ai-tbl{width:100%;border-collapse:collapse;font-size:12px}
  .ai-tbl th{text-align:left;font:600 10px/1.2 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line);background:var(--bg2);white-space:nowrap}
  .ai-tbl td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  .ai-tbl tr:last-child td{border-bottom:0}
  .ai-pre{margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:var(--bg2);border:1px solid var(--line);font:500 11.5px/1.5 var(--f-mono);color:var(--text2);white-space:pre-wrap;overflow-wrap:anywhere}
  .ai-md p.ai-note{font-size:11.5px;line-height:1.5;color:var(--faint);margin:10px 0 0}
  .ai-md p + p.ai-note, .ai-md h4 + p.ai-note{margin-top:-4px;margin-bottom:8px}
  .ai-md .ai-cursor{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:var(--accent);animation:aiCaret 1s steps(2,start) infinite}
  .ai-ent{--c:var(--info);display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 5px 0 4px;margin:0 1px;border-radius:5px;vertical-align:1px;
    border:1px solid color-mix(in srgb,var(--c) 22%,transparent);background:color-mix(in srgb,var(--c) 9%,transparent);color:var(--text);font:500 11.3px/1 var(--f-mono);letter-spacing:-.01em;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease}
  .ai-ent:hover{background:color-mix(in srgb,var(--c) 20%,transparent);border-color:color-mix(in srgb,var(--c) 55%,transparent)}
  .ai-ent i{width:5px;height:5px;border-radius:50%;background:var(--c);flex:none}
  .ai-stats{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));margin:9px 0 11px;border-radius:9px;background:var(--bg2);border:1px solid var(--line);overflow:hidden}
  .ai-stat{--c:var(--line2);position:relative;padding:8px 10px 8px 11px;min-width:0}
  .ai-stat + .ai-stat{border-left:1px solid var(--line)}
  .ai-stat::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:2px;background:var(--c);opacity:.9}
  .ai-stat.ok{--c:var(--st-run)} .ai-stat.warn{--c:var(--st-wait)} .ai-stat.crit{--c:var(--st-fault)} .ai-stat.info{--c:var(--info)}
  .ai-stat .l{font:500 10.5px/1.2 var(--f-ui);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-stat .v{font:600 19px/1.15 var(--f-cond);color:var(--text);margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-stat .s{font-size:10.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .ai-imp{margin:9px 0 11px;padding:10px 12px 8px;border-radius:9px;background:var(--bg2);border:1px solid var(--line)}
  .ai-imp-h{display:flex;align-items:center;gap:10px;margin-bottom:6px;min-width:0}
  .ai-imp-h .tt{font:600 10px/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ai-imp-h .lg{margin-left:auto;display:flex;gap:10px;font-size:10.5px;color:var(--faint);white-space:nowrap}
  .ai-imp-h .lg span{display:inline-flex;align-items:center;gap:4px}
  .lg-due{display:inline-block;width:2px;height:10px;border-radius:1px;background:var(--text2)}
  .lg-was{display:inline-block;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--muted)}
  .lg-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--st-run)}
  .ai-imp-b{position:relative;margin-left:76px;margin-right:70px}
  .ai-imp-g{position:absolute;inset:0;pointer-events:none}
  .ai-imp-g i{position:absolute;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--line) 70%,transparent)}
  .ai-imp-r{position:relative;display:block;height:34px}
  .ai-imp-r .id{position:absolute;left:-76px;top:0;width:70px;height:34px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
  .ai-imp-r .id button{border:0;background:transparent;padding:0;text-align:left;font:500 11.3px/1 var(--f-mono);color:var(--text);cursor:pointer;white-space:nowrap}
  .ai-imp-r .id button:hover{color:var(--accent)}
  .ai-imp-r .id small{font-size:10px;line-height:1;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-imp-r .tr{position:absolute;left:0;right:0;top:0;height:34px}
  .ai-imp-r .tr::before{content:"";position:absolute;left:0;right:0;top:16px;height:2px;border-radius:1px;background:var(--track)}
  .ai-imp-r .sl{position:absolute;top:14px;height:6px;border-radius:3px}
  .ai-imp-r .mv{position:absolute;top:16.5px;height:0;border-top:1.5px dashed color-mix(in srgb,var(--muted) 80%,transparent)}
  .ai-imp-r .due{position:absolute;top:8px;width:2px;height:18px;margin-left:-1px;border-radius:1px;background:var(--text2)}
  .ai-imp-r .dot{position:absolute;top:12px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px var(--bg2),0 0 0 4px color-mix(in srgb,var(--c) 25%,transparent)}
  .ai-imp-r .dot.was{top:13px;width:8px;height:8px;margin-left:-4px;background:var(--bg2);border:1.5px solid var(--muted);box-shadow:none}
  .ai-imp-r .v{position:absolute;right:-70px;top:0;width:64px;height:34px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:2px;font:600 12px/1 var(--f-ui);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ai-imp-r .v small{font:500 10px/1 var(--f-ui);color:var(--faint)}
  .ai-imp-ax{position:relative;height:14px;margin:2px 70px 0 76px;font:500 10px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .ai-imp-ax span{position:absolute;top:3px;transform:translateX(-50%);white-space:nowrap}
  .ai-imp-ax span.now{left:0;transform:none}
  .ai-tools{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 9px}
  .ai-tc{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border-radius:999px;font-size:11.5px;color:var(--text2);background:var(--card);border:1px solid var(--line);animation:aiIn .2s ease}
  .ai-tc .ico{color:var(--st-run)} .ai-tc.err .ico{color:var(--st-fault)} .ai-tc.err{color:var(--muted)}
  .ai-spin{width:11px;height:11px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:aiSpin .8s linear infinite;flex:none}
  .ai-typing{display:flex;align-items:center;gap:9px;height:24px;color:var(--muted);font-size:12.5px}
  .ai-dots{display:inline-flex;gap:4px}
  .ai-dots i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--accent) 70%,var(--muted));animation:aiDot 1.2s ease-in-out infinite}
  .ai-dots i:nth-child(2){animation-delay:.15s} .ai-dots i:nth-child(3){animation-delay:.3s}
  .ai-src{display:flex;align-items:flex-start;gap:7px;margin-top:11px;padding-top:9px;border-top:1px dashed var(--line);font-size:11px;line-height:1.45;color:var(--faint)}
  .ai-src .ico{flex:none;margin-top:1px;color:var(--faint)}
  .ai-src b{font-weight:600;color:var(--muted)}
  .ai-acts{display:flex;flex-direction:column;gap:7px;margin-top:11px}
  .ai-asks:empty{display:none} .ai-asks .ai-acts{margin:0 0 10px}
  .ai-act{--c:var(--accent);display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;column-gap:10px;row-gap:9px;padding:10px 11px;border-radius:10px;
    border:1px solid color-mix(in srgb,var(--c) 30%,var(--line));background:color-mix(in srgb,var(--c) 6%,var(--card));animation:aiIn .22s ease}
  .ai-act > div:nth-child(2){padding-top:1px}
  .ai-act.danger{--c:var(--st-fault)} .ai-act.quiet{--c:var(--line2)}
  .ai-act .ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
  .ai-act .t{font-size:12.8px;font-weight:600;color:var(--text);line-height:1.3}
  .ai-act .d{font-size:11.5px;color:var(--muted);line-height:1.35;margin-top:2px;overflow-wrap:anywhere}
  .ai-act .b{grid-column:2;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .ai-act .btn.sm{height:28px}
  .ai-act.ok{--c:var(--st-run)} .ai-act.fail{--c:var(--st-wait)} .ai-act.no{--c:var(--line2);opacity:.75}
  .ai-act .res{font-size:11.5px;font-weight:600;color:var(--c);white-space:nowrap;display:flex;align-items:center;gap:5px}
  .ai-notice{display:flex;gap:8px;align-items:flex-start;margin:2px 0 9px;padding:7px 10px;border-radius:8px;font-size:12px;line-height:1.45;color:var(--text2);
    background:color-mix(in srgb,var(--st-wait) 7%,transparent);border:1px solid color-mix(in srgb,var(--st-wait) 26%,transparent)}
  .ai-notice .ico{flex:none;color:var(--st-wait);margin-top:1px}
  body.ai-open #toasts{transition:right .28s ease}
  @media (min-width:900px){ body.ai-open #toasts{right:calc(min(440px,100%) + 16px)} body.ai-open.ai-beside #toasts{right:calc(920px + 16px)} }
  .ai-err{display:flex;gap:9px;align-items:flex-start;margin-top:8px;padding:9px 11px;border-radius:9px;font-size:12.5px;line-height:1.45;color:var(--text2);
    background:color-mix(in srgb,var(--st-wait) 8%,var(--card));border:1px solid color-mix(in srgb,var(--st-wait) 32%,transparent)}
  .ai-err .ico{color:var(--st-wait);flex:none;margin-top:1px}
  .ai-err .b{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .ai-fu{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .ai-chip{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 11px;border-radius:999px;border:1px solid var(--line2);background:var(--card);color:var(--text2);
    font:500 12px/1.25 var(--f-ui);cursor:pointer;text-align:left;transition:border-color .15s ease,color .15s ease,background-color .15s ease}
  .ai-chip:hover{border-color:color-mix(in srgb,var(--accent) 55%,transparent);color:var(--text);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
  .ai-chip .ico{color:var(--accent);flex:none}
  .ai-chip:disabled{opacity:.45;cursor:default}
  .ai-empty{display:flex;flex-direction:column;gap:16px;padding:6px 0 4px;margin:auto 0}
  .ai-hero{display:flex;flex-direction:column;align-items:flex-start;gap:7px}
  .ai-hero h3{margin:0;font:600 23px/1.15 var(--f-cond);letter-spacing:.01em;color:var(--text)}
  .ai-hero p{margin:0;color:var(--muted);font-size:13px;line-height:1.5;max-width:50ch}
  .ai-live{display:flex;flex-wrap:wrap;gap:6px}
  .ai-live > span{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;color:var(--text2);background:var(--card);border:1px solid var(--line);white-space:nowrap}
  .ai-live > span > i{width:6px;height:6px;border-radius:50%;background:var(--c,var(--st-run))}
  .ai-live b{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;margin-right:2px}
  .ai-exg{display:flex;flex-direction:column;gap:6px}
  .ai-exg .eyebrow{font-size:9.5px;margin:2px 0 1px}
  .ai-ex{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px 9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--text2);font:500 13px/1.3 var(--f-ui);text-align:left;cursor:pointer;transition:border-color .15s ease,color .15s ease,background-color .15s ease}
  .ai-ex .ico{color:var(--muted);flex:none;transition:color .15s ease}
  .ai-ex .tx{flex:1;min-width:0}
  .ai-ex .ar{flex:none;display:grid;color:var(--faint);opacity:0;transform:translateX(-4px);transition:opacity .15s ease,transform .15s ease}
  .ai-ex:hover{border-color:var(--line2);color:var(--text);background:var(--card2)}
  .ai-ex:hover .ico{color:var(--accent)} .ai-ex:hover .ar{opacity:1;transform:none}
  .ai-tipline{display:flex;gap:7px;align-items:flex-start;margin:2px 0 0;font-size:11.5px;line-height:1.45;color:var(--faint)}
  .ai-tipline .ico{flex:none;margin-top:1px;color:var(--accent);opacity:.8}
  .ai-foot{position:relative;border-top:1px solid var(--line);padding:9px 12px max(10px,env(safe-area-inset-bottom,0px));background:var(--panel)}
  .ai-sugg{display:flex;gap:6px;overflow-x:auto;padding:1px 0 9px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .ai-sugg::-webkit-scrollbar{display:none}
  .ai-sugg .ai-chip{white-space:nowrap}
  .ai-comp{display:flex;align-items:flex-end;gap:8px;padding:5px 5px 5px 12px;border-radius:12px;background:var(--bg2);border:1px solid var(--line2);transition:border-color .15s ease,box-shadow .15s ease}
  .ai-comp:focus-within{border-color:color-mix(in srgb,var(--accent) 70%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
  .ai-comp textarea{flex:1;min-width:0;border:0;outline:none;background:transparent;resize:none;color:var(--text);font:400 13.5px/1.45 var(--f-ui);padding:6px 0;max-height:132px;min-height:32px}
  .ai-comp textarea::placeholder{color:var(--faint)}
  .ai-send{flex:none;width:34px;height:34px;border-radius:9px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;cursor:pointer;transition:filter .15s ease,opacity .15s ease}
  .ai-send:hover{filter:brightness(1.08)}
  .ai-send:disabled{opacity:.35;cursor:default;filter:none}
  .ai-send.stop{background:var(--card2);border-color:var(--line2);color:var(--text)}
  .ai-send.stop i{width:10px;height:10px;border-radius:2px;background:currentColor}
  .ai-hint{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:10.5px;color:var(--faint);white-space:nowrap;min-width:0}
  .ai-hint > span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ai-hint kbd{font:500 10px/1 var(--f-mono);padding:2px 4px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);background:var(--card)}
  .ai-sys{align-self:center;max-width:92%;display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--muted);padding:5px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);animation:aiIn .2s ease}
  .ai-sys .ico{flex:none}
  .ai-sys.ok .ico{color:var(--st-run)} .ai-sys.warn .ico{color:var(--st-wait)}
  .btn-ai.ai-on{background:color-mix(in srgb,var(--accent) 26%,var(--card));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent) inset}
  .ai-slot:empty{display:none}
  /* Werkzeug-Standzeiten */
  .ai-tools{display:grid;gap:8px;margin:4px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-tl .h{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:12.5px;line-height:18px}
  .ai-tl .n{flex:1;min-width:0;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ai-tl .r{flex:none;font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;color:var(--c)}
  .ai-tl .wb{position:relative;height:6px;margin:4px 0 4px;border-radius:3px;background:var(--track);overflow:visible}
  .ai-tl .wb i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--c)}
  .ai-tl .wb i.nx{border-radius:0 3px 3px 0;background:color-mix(in srgb,var(--c) 40%,transparent)}
  .ai-tl .wb b{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text2);opacity:.75}
  .ai-tl .s{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11.5px;color:var(--muted)}
  .ai-tl .tg{display:inline-flex;align-items:center;gap:4px;padding:0 7px;border-radius:999px;font-weight:600;font-size:10.5px;line-height:17px;color:var(--st-tool);background:color-mix(in srgb,var(--st-tool) 13%,transparent);border:1px solid color-mix(in srgb,var(--st-tool) 30%,transparent)}
  .ai-tl .tg svg{width:11px;height:11px}
  /* Arbeitsgang-Kette */
  .ai-route{list-style:none;margin:4px 0 12px;padding:0}
  .ai-md .ai-route li.ai-rt{padding-left:0;margin:0}
  .ai-md .ai-route li.ai-rt::before{content:none}
  .ai-rt{position:relative;display:grid;grid-template-columns:20px minmax(0,1fr);column-gap:10px;padding-bottom:10px}
  .ai-rt:last-child{padding-bottom:0}
  .ai-rt::after{content:"";position:absolute;left:9px;top:21px;bottom:1px;width:2px;border-radius:1px;background:var(--line)}
  .ai-rt:last-child::after{content:none}
  .ai-rt.s-done::after{background:color-mix(in srgb,var(--st-run) 38%,var(--line))}
  .ai-rt .nd{position:relative;z-index:1;width:20px;height:20px;border-radius:50%;box-sizing:border-box;border:2px solid var(--c);background:var(--card);display:grid;place-items:center;color:var(--c);margin-top:0}
  .ai-rt .nd svg{width:11px;height:11px;stroke-width:2.6}
  .ai-rt.s-done .nd{background:color-mix(in srgb,var(--c) 20%,var(--card));border-color:color-mix(in srgb,var(--c) 70%,transparent)}
  .ai-rt.s-act .nd{background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 20%,transparent)}
  .ai-rt.s-act .nd::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--card)}
  .ai-rt.s-wait .nd{border-style:solid;background:color-mix(in srgb,var(--c) 12%,var(--card))}
  .ai-rt.s-plan .nd{border:2px dashed var(--line2);background:var(--card)}
  .ai-rt .bd{min-width:0}
  .ai-rt .h{display:flex;align-items:baseline;gap:7px;min-width:0;line-height:20px}
  .ai-rt .sq{flex:none;font:600 10.5px/20px var(--f-mono);color:var(--faint);letter-spacing:.02em}
  .ai-rt .op{flex:1 1 auto;min-width:0;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ai-rt.s-done .op,.ai-rt.s-plan .op,.ai-rt.s-ship .op{color:var(--text2);font-weight:500}
  .ai-rt .tg{flex:none;align-self:center;font:600 10px/16px var(--f-ui);padding:0 7px;border-radius:999px;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);white-space:nowrap}
  .ai-rt.s-plan .tg,.ai-rt.s-ship .tg{color:var(--muted);background:transparent;border-color:var(--line2)}
  .ai-rt .w{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;margin-top:1px;font-size:12px;line-height:1.5;color:var(--muted)}
  .ai-rt .w .ai-ent{margin:0}
  .ai-rt .wh{color:var(--text2)}
  .ai-rt .sub{min-width:0}
  .ai-rt .wh:not(:last-child)::after{content:"·";margin-left:6px;color:var(--faint)}
  .ai-rt .pg{display:block;height:4px;margin-top:6px;border-radius:2px;background:var(--track);overflow:hidden}
  .ai-rt .pg i{display:block;height:100%;border-radius:2px;background:var(--c);transition:width .4s}
  .ai-rt.s-wait .pg i{background:color-mix(in srgb,var(--c) 70%,transparent)}
  @keyframes aiIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @keyframes aiSpin{to{transform:rotate(360deg)}}
  @keyframes aiDot{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-4px);opacity:1}}
  @keyframes aiCaret{to{visibility:hidden}}
  @keyframes aiPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--st-run) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--st-run) 0%,transparent)}}
  @keyframes aiBlinkDot{50%{opacity:.3}}
  @media (max-width:560px){
    .ai-h{padding:10px 8px 10px 12px;gap:9px} .ai-orb{--s:30px} .ai-ttl{font-size:17px}
    .ai-log{padding:12px 12px 8px;gap:16px} .ai-ctx{padding:6px 10px 6px 12px}
    .ai-foot{padding:8px 10px max(9px,env(safe-area-inset-bottom,0px))} .ai-hint .ai-kb{display:none}
    .ai-m.u{max-width:92%}
    .ai-tip{width:260px}
  }
  `, 'ai-copilot');

  // ------------------------------------------------------------------ Markdown (fett, kursiv, Listen, Zitat, Überschriften, Code) + Entitäts-Chips
  const ENT_RE = /\b(FA-\d{5})\b|\b(M(?:0[1-9]|1[0-3]))\b|\b(P(?:0[1-9]|1[0-9]))\b|\b(AGV ?[12])\b|\b(MAT-[A-Z0-9]+)\b|\b(WZ-\d{4})\b|\b(BH-\d{4})\b/g;
  function entColor(kind, id) {
    const st = S(); if (!st) return 'var(--info)';
    if (kind === 'machine') { const m = st.machines[id]; return m ? (WF.STATE[m.state] || {}).color || 'var(--info)' : 'var(--info)'; }
    if (kind === 'order') { const o = st.orders[id]; if (!o) return 'var(--info)'; if (o.status === 'fertig') return 'var(--st-run)'; const f = WF.sim.forecast().orders[id]; if (!f || f.eta == null) return 'var(--info)'; const sl = o.due - f.eta; return sl < 0 ? 'var(--st-fault)' : sl < 4 * 3600 ? 'var(--st-wait)' : 'var(--st-run)'; }
    if (kind === 'person') { const p = st.people[id]; return !p ? 'var(--info)' : p.state === 'working' || p.state === 'driving' ? 'var(--st-run)' : p.state === 'break' ? 'var(--st-wait)' : p.state === 'offShift' ? 'var(--faint)' : 'var(--info)'; }
    if (kind === 'material') { const m = st.materials[id]; return m && m.onHand < m.min ? 'var(--st-wait)' : 'var(--mat)'; }
    if (kind === 'agv') return 'var(--mat)';
    if (kind === 'tool') return 'var(--st-tool)';
    return 'var(--info)';
  }
  function entChip(kind, id, text) {
    return `<button type="button" class="ai-ent" data-k="${kind}" data-id="${esc(id)}" style="--c:${entColor(kind, id)}" title="${esc(WF.app && WF.app.entityLabel ? WF.app.entityLabel({ kind, id }) : id)} öffnen"><i></i>${esc(text || id)}</button>`;
  }
  function linkEntities(t, keep) {
    const st = S();
    return t.replace(ENT_RE, (all, o, m, p, agv, mat, wz, bh) => {
      if (o && st.orders[o]) return keep(entChip('order', o));
      if (m && st.machines[m]) return keep(entChip('machine', m));
      if (p && st.people[p]) return keep(entChip('person', p));
      if (agv) { const id = agv.replace(' ', ''); if (st.agvs[id]) return keep(entChip('agv', id, agv)); }
      if (mat && st.materials[mat]) return keep(entChip('material', mat));
      if (wz && st.tools[wz]) return keep(entChip('tool', wz));
      if (bh && st.containers[bh]) return keep(entChip('container', bh));
      return all;
    });
  }
  function inline(s, noLinks) {
    const ph = [];
    const keep = (h) => '\u0001' + (ph.push(h) - 1) + '\u0002';
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, (_, c2) => keep('<code>' + c2 + '</code>'));
    if (!noLinks) t = linkEntities(t, keep);
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>');
    t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
    t = t.replace(/\u0003/g, '<span class="ai-cursor"></span>');
    return t.replace(/\u0001(\d+)\u0002/g, (_, i) => ph[Number(i)]);
  }
  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    let html = '', list = null, para = [], quote = [], table = [], code = null;
    const flushT = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(x => x.trim()));
      const head = rows.shift() || [];
      html += `<div class="ai-tblw"><table class="ai-tbl"><thead><tr>${head.map(h => '<th>' + inline(h) + '</th>').join('')}</tr></thead><tbody>${rows.map(r => '<tr>' + r.map(x => '<td>' + inline(x) + '</td>').join('') + '</tr>').join('')}</tbody></table></div>`;
      table = [];
    };
    const flushP = () => { if (para.length) { html += '<p>' + para.map(x => inline(x)).join('<br>') + '</p>'; para = []; } };
    const flushQ = () => { if (quote.length) { html += '<blockquote>' + quote.map(x => inline(x)).join('<br>') + '</blockquote>'; quote = []; } };
    const closeL = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (code != null) { if (/^\s*```/.test(line)) { html += '<pre class="ai-pre">' + esc(code.join('\n')) + '</pre>'; code = null; } else code.push(raw); continue; }
      if (/^\s*```/.test(line)) { flushP(); flushQ(); closeL(); flushT(); code = []; continue; }
      if ((m = /^\u0005(\w+)$/.exec(line.trim()))) { flushP(); flushQ(); closeL(); flushT(); html += `<div class="ai-slot" data-slot="${m[1]}"></div>`; continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) { flushP(); flushQ(); closeL(); table.push(line); continue; }
      flushT();
      if (!line.trim()) { flushP(); flushQ(); closeL(); continue; }
      if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) { flushP(); flushQ(); closeL(); html += '<h4>' + inline(m[1].replace(/\*\*/g, ''), true) + '</h4>'; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushP(); flushQ(); closeL(); html += '<hr>'; continue; }
      if ((m = /^~\s+(.*)$/.exec(line))) { flushP(); flushQ(); closeL(); html += '<p class="ai-note">' + inline(m[1]) + '</p>'; continue; }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushP(); closeL(); quote.push(m[1]); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flushP(); flushQ(); if (list !== 'ul') { closeL(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { flushP(); flushQ(); if (list !== 'ol') { closeL(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[2]) + '</li>'; continue; }
      if (list && /^\s{2,}\S/.test(raw)) { html = html.replace(/<\/li>$/, '<br>' + inline(line.trim()) + '</li>'); continue; }
      if (quote.length) { quote.push(line.trim()); continue; }
      closeL(); para.push(line.trim());
    }
    if (code != null) html += '<pre class="ai-pre">' + esc(code.join('\n')) + '</pre>';
    flushP(); flushQ(); closeL(); flushT();
    return html;
  }

  // ------------------------------------------------------------------ Panel aufbauen
  let panel = null, R = {};
  const EXAMPLES = [
    { g: 'Lage', items: [['gauge', 'Wie läuft die Schicht?'], ['file', 'Schreib mir die Schichtübergabe']] },
    { g: 'Termine & Engpass', items: [['clock', 'Welche Aufträge sind gefährdet und warum?'], ['target', 'Was ist der Engpass?']] },
    { g: 'Was-wäre-wenn & Kosten', items: [['alert', 'Was passiert, wenn die Studer S33 2 h ausfällt?'], ['euro', 'Wo verlieren wir heute Geld?']] },
    { g: 'Ressourcen', items: [['wrench', 'Welche Werkzeugwechsel stehen in den nächsten 2 h an?'], ['box', 'Welches Material wird knapp?'], ['users', 'Wer ist gerade wo?']] },
  ];
  const qIcon = (t) => { const q = norm(t); return /werkzeug|wechsel/.test(q) ? 'wrench' : /material|bestand|bestell/.test(q) ? 'box' : (/\bwer\b|personal/.test(q)) ? 'users' : /geld|kosten|verlier/.test(q) ? 'euro' : /ausfaell|stoerung/.test(q) ? 'alert' : /engpass/.test(q) ? 'target' : /gefaehrdet|termin|wo steht|fertig|eil/.test(q) ? 'clock' : /uebergabe/.test(q) ? 'file' : /qualitaet/.test(q) ? 'shield' : /energie/.test(q) ? 'bolt' : /agv/.test(q) ? 'truck' : /schicht/.test(q) ? 'gauge' : 'sparkles'; };
  const VIEW_EX = {
    werkzeuge: ['Welche Werkzeugwechsel stehen in den nächsten 2 h an?', 'Welche Werkzeugwechsel stehen in der Schicht an?'],
    material: ['Welches Material wird knapp?', 'Was machen die AGVs gerade?'],
    personal: ['Wer ist gerade wo?'], qualitaet: ['Wie steht es um die Qualität heute?'],
    auftraege: ['Welche Aufträge sind gefährdet und warum?', 'Was ist der Engpass?'],
    analyse: ['Wo verlieren wir heute Geld?', 'Wie hoch ist der Energieverbrauch?'],
    halle: ['Was machen die AGVs gerade?', 'Was ist der Engpass?'],
  };
  /** Beispiele im leeren Zustand: zuerst zum Bezug (Maschine/Auftrag …), dann zur Ansicht, dann allgemein */
  function exampleGroups() {
    const groups = [], seen = new Set();
    const take = (arr) => arr.filter(t => !seen.has(t) && seen.add(t));
    const ctx = conv.context && conv.context.kind !== 'view' && conv.context.kind !== 'notification' ? conv.context : null;
    if (ctx) { const it = take(suggestionsFor(ctx).slice(0, 3)); if (it.length) groups.push({ g: 'Zu ' + (WF.app && WF.app.entityLabel ? WF.app.entityLabel(ctx) : ctx.id), items: it.map(t => [qIcon(t), t]) }); }
    const view = WF.app && WF.app.current ? WF.app.current.id : null;
    if (view && VIEW_EX[view]) { const it = take(VIEW_EX[view]); if (it.length) groups.push({ g: 'Passend zur Ansicht ' + VIEW_TITLE(view), items: it.map(t => [qIcon(t), t]) }); }
    for (const g of EXAMPLES) { const it = g.items.filter(x => !seen.has(x[1]) && seen.add(x[1])); if (it.length) groups.push({ g: g.g, items: it }); }
    let n = 0;
    return groups.map(g => ({ g: g.g, items: g.items.filter(() => n++ < 9) })).filter(g => g.items.length);
  }
  function build() {
    if (panel) return;
    panel = WF.ui.el('aside', { class: 'ai-panel', id: 'ai-panel', role: 'dialog', 'aria-label': 'werkfluss Copilot', 'aria-hidden': 'true' });
    panel.innerHTML = `
      <div class="ai-h">
        <div class="ai-orb" aria-hidden="true">${icon('sparkles', 18)}</div>
        <div class="ai-ht">
          <div class="ai-ttl">werkfluss <b>Copilot</b></div>
          <div class="ai-modew"><span class="ai-mode verbinde" tabindex="0" data-r="mode" aria-describedby="ai-tip"><i></i><span data-r="modeT">Verbinde …</span></span>
            <div class="ai-tip" id="ai-tip" role="tooltip" data-r="tip"></div></div>
        </div>
        <div class="ai-hb">
          <button class="ai-ib" data-r="clear" title="Neu beginnen (Unterhaltung leeren)" aria-label="Unterhaltung leeren">${icon('refresh', 17)}</button>
          <button class="ai-ib" data-r="close" title="Schließen (Esc)" aria-label="Copilot schließen">${icon('x', 18)}</button>
        </div>
      </div>
      <div class="ai-ctx" data-r="ctx" hidden></div>
      <div class="ai-log" data-r="log" aria-live="polite"></div>
      <div class="ai-foot">
        <div class="ai-sugg" data-r="sugg" aria-label="Vorschläge"></div>
        <div class="ai-comp">
          <textarea data-r="input" rows="1" placeholder="Frage zur Fertigung stellen …" aria-label="Frage an den Copilot" maxlength="1200"></textarea>
          <button class="ai-send" data-r="send" title="Senden (Enter)" aria-label="Senden" disabled>${icon('send', 16)}</button>
        </div>
        <div class="ai-hint"><span class="ai-kb"><kbd>Enter</kbd> senden · <kbd>Shift</kbd> + <kbd>Enter</kbd> Zeile</span><span data-r="hintR">Aktionen nur nach Bestätigung</span></div>
      </div>`;
    document.body.append(panel);
    panel.querySelectorAll('[data-r]').forEach(n => { R[n.dataset.r] = n; });
    R.close.onclick = () => UI.close();
    R.clear.onclick = () => UI.clear();
    R.send.onclick = () => { if (conv.busy) stop(); else submit(); };
    R.input.addEventListener('input', () => { autoGrow(); R.send.disabled = !conv.busy && !R.input.value.trim(); });
    R.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!conv.busy) submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); UI.close(); }
    });
    panel.addEventListener('click', onPanelClick);
    renderEmpty();
    UI.refreshMode();
    renderSugg(true);
  }
  function autoGrow() { const ta = R.input; ta.style.height = 'auto'; ta.style.height = Math.min(132, ta.scrollHeight) + 'px'; }
  UI.refreshMode = () => {
    if (!panel) return;
    const st = live.status;
    R.mode.className = 'ai-mode ' + st;
    R.modeT.textContent = st === 'live' ? 'Claude · live' : st === 'offline' ? 'Offline-Modus' : 'Verbinde …';
    R.tip.innerHTML = st === 'live'
      ? `<b>Claude · live</b>${esc(live.reason)} Jede Anfrage zählt zum Claude-Kontingent des angemeldeten Kontos.`
      : st === 'offline'
        ? `<b>Offline-Modus</b>${esc(live.reason)} Regelbasiert beantwortet werden Lage, Termine, Engpass, Maschinen, Aufträge, Werkzeuge, Material, Personal, Qualität, Kosten, Was-wäre-wenn und Schichtübergabe. Auf claude.ai veröffentlicht antwortet Claude frei formuliert.`
        : `<b>Verbindung wird geprüft</b>${esc(live.reason)}`;
    R.hintR.textContent = st === 'live' ? 'Claude · Aktionen nur nach Bestätigung' : 'Live-Daten · Aktionen nur nach Bestätigung';
  };

  // ------------------------------------------------------------------ Öffnen / Schließen / Kontext
  let openState = false, beside = false;
  const wide = () => G.matchMedia && G.matchMedia('(min-width: 1100px)').matches;
  const drawerOpen = () => { const d = document.getElementById('drawer'); return !!(d && d.classList.contains('open')); };
  function layout() {
    if (!panel) return;
    beside = openState && wide() && drawerOpen();
    panel.classList.toggle('beside', beside);
    document.body.classList.toggle('ai-beside', beside);
  }
  UI.isOpen = () => openState;
  UI.open = (opts) => {
    build();
    if (!openState) {
      openState = true;
      panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); document.body.classList.add('ai-open');
      const b = document.getElementById('t-ai'); if (b) { b.classList.add('ai-on'); b.setAttribute('aria-expanded', 'true'); }
      if (!conv.context) { const sel = WF.app && WF.app.selected; if (sel && sel.kind && sel.id) conv.context = { kind: sel.kind, id: sel.id, auto: true }; }
      getSample();
    }
    layout();
    renderCtx(); renderSugg(true);
    if (!(opts && opts.noFocus) && wide()) setTimeout(() => { try { R.input.focus({ preventScroll: true }); } catch (e) { /* */ } }, 60);
  };
  UI.close = () => {
    if (!panel || !openState) return;
    openState = false;
    panel.classList.remove('open', 'beside'); panel.setAttribute('aria-hidden', 'true'); document.body.classList.remove('ai-open', 'ai-beside');
    const b = document.getElementById('t-ai'); if (b) { b.classList.remove('ai-on'); b.setAttribute('aria-expanded', 'false'); }
    if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
  };
  UI.toggle = () => (openState ? UI.close() : UI.open());
  UI.openEntity = (kind, id) => {
    if (!WF.app) return;
    if (!wide()) UI.close();
    WF.app.select(kind, id);
    layout();
  };
  function ctxLabel(ctx) {
    if (!ctx) return '';
    if (ctx.kind === 'notification') { const n = (S().notifications || []).find(x => x.id === ctx.id); return n ? n.title : 'Meldung'; }
    if (ctx.kind === 'view') return '';
    if (ctx.kind === 'machine') { const mv = S().machines[ctx.id]; return mv ? `${mv.short} · ${stLabel(mv.state)}` : ''; }
    if (ctx.kind === 'order') { const o = S().orders[ctx.id]; return o ? `${o.part.name} · ${custShort(o.customer)}` : ''; }
    if (ctx.kind === 'person') { const p = S().people[ctx.id]; return p ? `${p.name} · ${p.role}` : ''; }
    if (ctx.kind === 'material') { const m = S().materials[ctx.id]; return m ? m.name : ''; }
    return WF.app && WF.app.entityLabel ? WF.app.entityLabel(ctx) : ctx.id;
  }
  let ctxSig = '';
  function renderCtx() {
    if (!panel) return;
    const ctx = conv.context && conv.context.kind !== 'view' ? conv.context : null;
    const sig = ctx ? ctx.kind + '|' + ctx.id + '|' + ctxLabel(ctx) : '';
    if (sig === ctxSig) return;
    ctxSig = sig;
    R.ctx.hidden = !ctx;
    if (!ctx) { R.ctx.innerHTML = ''; if (!conv.msgs.length && R.log.querySelector('.ai-empty')) renderEmpty(); return; }
    const isN = ctx.kind === 'notification';
    const chip = isN ? `<span class="ai-ent" style="--c:var(--st-wait)"><i></i>Meldung</span>` : entChip(ctx.kind, ctx.id);
    R.ctx.innerHTML = `<span class="eyebrow">Bezug</span>${chip}<span class="ai-ctxs">${esc(ctxLabel(ctx))}</span><button class="ai-x" data-ctxx title="Bezug entfernen" aria-label="Bezug entfernen">${icon('x', 14)}</button>`;
    if (!conv.msgs.length && R.log.querySelector('.ai-empty')) renderEmpty();
  }
  let suggSig = '';
  function renderSugg(force) {
    if (!panel) return;
    let list = [];
    if (conv.msgs.length) {
      const asked = new Set(conv.msgs.filter(m => m.role === 'user').map(m => m.text));
      const lastA = conv.msgs.slice().reverse().find(m => m.role === 'assistant');
      const fu = new Set((lastA && lastA.followups) || []);
      list = suggestionsFor(currentContext()).filter(x => !asked.has(x) && !fu.has(x)).slice(0, 6);
    }
    const sig = list.join('|') + (conv.busy ? '#' : '');
    if (!force && sig === suggSig) return;
    suggSig = sig;
    R.sugg.hidden = !list.length;
    R.sugg.innerHTML = list.map(x => `<button type="button" class="ai-chip" data-ask="${esc(x)}"${conv.busy ? ' disabled' : ''}>${icon(qIcon(x), 13)}${esc(x)}</button>`).join('');
  }
  function renderEmpty() {
    const st = S();
    const mvs = PROF().machines.length, ord = st ? Object.values(st.orders).filter(o => o.status !== 'fertig').length : 0;
    const ppl = st ? Object.values(st.people).filter(p => p.state !== 'offShift').length : 0;
    const prod = st ? Object.values(st.machines).filter(m => m.state === 'running').length : 0;
    R.log.innerHTML = `<div class="ai-empty">
      <div class="ai-hero">
        <h3>Fragen an die Fertigung</h3>
        <p>Der Copilot kennt jede Maschine, jeden Auftrag, jedes Werkzeug und jeden Behälter – live. Er erklärt Ursachen, rechnet Szenarien durch und schlägt Maßnahmen vor; Aktionen laufen erst nach Bestätigung.</p></div>
      <div class="ai-live"><span><i></i><span><b>${prod}</b>/${mvs} produzieren</span></span><span style="--c:var(--info)"><i></i><span><b>${ord}</b> Aufträge offen</span></span><span style="--c:var(--st-setup)"><i></i><span><b>${ppl}</b> im Dienst</span></span></div>
      ${exampleGroups().map(g => `<div class="ai-exg"><span class="eyebrow">${esc(g.g)}</span>${g.items.map(([ic, t]) => `<button type="button" class="ai-ex" data-ask="${esc(t)}">${icon(ic, 16)}<span class="tx">${esc(t)}</span><span class="ar">${icon('arrowRight', 14)}</span></button>`).join('')}</div>`).join('')}
      <p class="ai-tipline">${icon('sparkles', 13)}<span>Tipp: In jeder Detailansicht (Maschine, Auftrag, Meldung) öffnet das Funkel-Symbol den Copilot direkt mit diesem Bezug.</span></p>
    </div>`;
  }
  UI.clear = () => {
    if (conv.busy) stop();
    conv.msgs = []; conv.history = []; conv.lastEntity = null;
    if (conv.context && conv.context.auto) conv.context = null;
    build(); renderEmpty(); renderSugg(true); renderCtx();
    R.clear.disabled = true;
  };

  // ------------------------------------------------------------------ Nachrichten
  function nowLabel() { return WF.sim ? U.fmtClock(WF.sim.t) : ''; }
  function addUser(text) {
    if (R.log.querySelector('.ai-empty')) R.log.innerHTML = '';
    const m = { id: ++conv.seq, role: 'user', text, t: NOW() };
    conv.msgs.push(m);
    const n = WF.ui.el('div', { class: 'ai-m u' });
    n.innerHTML = `<div class="ai-bub">${esc(text)}</div><div class="ai-meta" title="${esc(U.fmtDayClock(m.t))} (Simulationszeit)">${nowLabel()}</div>`;
    R.log.append(n);
    R.clear.disabled = false;
    anchor = n;
    scrollEnd(true);
    return m;
  }
  function addAssistant(mode) {
    const m = { id: ++conv.seq, role: 'assistant', text: '', t: NOW(), mode, tools: [], actions: [], status: 'pending' };
    conv.msgs.push(m);
    const n = WF.ui.el('div', { class: 'ai-m a', 'data-mid': String(m.id) });
    n.innerHTML = `<div class="ai-orb sm" aria-hidden="true">${icon('sparkles', 13)}</div>
      <div class="ai-ab"><div class="ai-ah">Copilot <span class="ai-tag ${mode === 'KI' ? 'ki' : ''}">${mode === 'KI' ? 'Claude' : 'Offline'}</span><time title="${esc(U.fmtDayClock(m.t))} (Simulationszeit)">${nowLabel()}</time><button type="button" class="ai-copy" data-copy="${m.id}" title="Antwort als Text kopieren" aria-label="Antwort kopieren" hidden>${icon('file', 13)}</button></div>
        <div class="ai-tools" hidden></div>
        <div class="ai-asks"></div>
        <div class="ai-body"><div class="ai-typing"><span class="ai-dots"><i></i><i></i><i></i></span><span class="ai-tyt">${mode === 'KI' ? 'Claude denkt nach …' : 'Liest Live-Daten …'}</span></div></div>
        <div class="ai-extra"></div></div>`;
    R.log.append(n);
    m.el = n; m.body = n.querySelector('.ai-body'); m.toolsEl = n.querySelector('.ai-tools'); m.extra = n.querySelector('.ai-extra'); m.asks = n.querySelector('.ai-asks'); m.tagEl = n.querySelector('.ai-tag');
    scrollEnd(true);
    return m;
  }
  function addSys(text, sev) {
    const n = WF.ui.el('div', { class: 'ai-sys ' + (sev || '') });
    n.innerHTML = `${icon(sev === 'ok' ? 'check' : sev === 'warn' ? 'alert' : 'info', 13)}<span>${esc(text)}</span>`;
    R.log.append(n); scrollEnd(false);
  }
  function setTyping(m, text) { const t = m.body.querySelector('.ai-tyt'); if (t) t.textContent = text; }
  /** Mitlaufen: bis die eigene Frage oben im Verlauf steht – lange Antworten beginnen sichtbar; wer selbst scrollt, wird nicht gezogen */
  let autoScroll = true, anchor = null, scrollRaf = 0;
  function scrollEnd(force) {
    const l = R.log; if (!l) return;
    if (force) autoScroll = true;
    if (!autoScroll || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const max = l.scrollHeight - l.clientHeight;
      const target = anchor && anchor.isConnected ? Math.min(max, anchor.offsetTop - 10) : max;
      if (target > l.scrollTop) l.scrollTop = target;
    });
  }
  function renderBody(m, streaming) {
    const html = md(m.text + (streaming ? '\u0003' : ''));
    if (m._h === html) return;
    m._h = html;
    m.body.innerHTML = `<div class="ai-md">${html}</div>`;
    if (m.slots) for (const el of m.body.querySelectorAll('.ai-slot')) { const x = m.slots[el.dataset.slot]; if (x) el.innerHTML = x; }
    scrollEnd(false);
  }
  function toolChip(m, labelTxt) {
    m.toolsEl.hidden = false;
    const n = WF.ui.el('span', { class: 'ai-tc' });
    n.innerHTML = `<span class="ai-spin"></span><span>${esc(labelTxt)} …</span>`;
    m.toolsEl.append(n);
    scrollEnd(false);
    return {
      done: (ok, txt) => { n.classList.toggle('err', !ok); n.innerHTML = `${icon(ok ? 'check' : 'x', 12)}<span>${esc(txt || labelTxt)}</span>`; },
    };
  }

  // ------------------------------------------------------------------ Zusatzblöcke: Kennzahlen, Termin-Diagramm, Datenbasis, Aktionen, Folgefragen
  function statsHTML(stats) {
    if (!stats || !stats.length) return '';
    return `<div class="ai-stats" style="--n:${stats.length}">${stats.map(x => `<div class="ai-stat ${x.c || ''}" title="${esc(x.l + ': ' + x.v + (x.s ? ' · ' + x.s : ''))}"><div class="l">${esc(x.l)}</div><div class="v">${esc(x.v)}</div>${x.s ? `<div class="s">${esc(x.s)}</div>` : ''}</div>`).join('')}</div>`;
  }
  /** Prognose gegen Termin: eine gemeinsame Zeitachse (jetzt … spätester Wert), Termin als Strich, Prognose als Punkt,
      Puffer bzw. Verzug als Balken zwischen Prognose und Termin; bei Szenarien „vorher“ als Ring mit Verschiebung */
  function impactHTML(imp) {
    if (!imp || !imp.rows || !imp.rows.length) return '';
    const t0 = NOW();
    const vals = [];
    for (const r of imp.rows) { vals.push(r.due); if (r.before != null) vals.push(r.before); if (r.after != null) vals.push(r.after); }
    let t1 = Math.max(...vals); if (t1 - t0 < 3600) t1 = t0 + 3600;
    t1 = t0 + (t1 - t0) * 1.04;
    const span = t1 - t0, X = (t) => Math.max(0, Math.min(100, (t - t0) / span * 100));
    const col = (sl) => (sl < 0 ? 'var(--st-fault)' : sl < 4 * 3600 ? 'var(--st-wait)' : 'var(--st-run)');
    const shifted = imp.rows.some(r => r.after != null && Math.abs(r.after - r.before) >= 60);
    const rows = imp.rows.map(r => {
      const fin = r.after != null ? r.after : r.before, sl = r.due - fin, c = col(sl);
      const moved = r.after != null && Math.abs(r.after - r.before) >= 60;
      const a1 = X(Math.min(fin, r.due)), b1 = X(Math.max(fin, r.due));
      const tip = `${r.id}: Prognose ${U.fmtDayClock(fin)}${moved ? ' (vorher ' + U.fmtDayClock(r.before) + ')' : ''} · Termin ${U.fmtDayClock(r.due)} · ${sl >= 0 ? 'Puffer' : 'Verzug'} ${durShort(Math.abs(sl))}`;
      return `<div class="ai-imp-r" title="${esc(tip)}">
        <span class="id"><button type="button" data-ent-k="order" data-ent-id="${esc(r.id)}">${esc(r.id)}</button><small>${esc(r.label || '')}</small></span>
        <span class="tr"><span class="sl" style="left:${a1.toFixed(2)}%;width:${Math.max(0.6, b1 - a1).toFixed(2)}%;background:color-mix(in srgb,${c} 42%,transparent)"></span>
          ${moved ? `<span class="mv" style="left:${X(Math.min(r.before, fin)).toFixed(2)}%;width:${Math.abs(X(fin) - X(r.before)).toFixed(2)}%"></span><span class="dot was" style="left:${X(r.before).toFixed(2)}%"></span>` : ''}
          <span class="due" style="left:${X(r.due).toFixed(2)}%"></span><span class="dot" style="left:${X(fin).toFixed(2)}%;--c:${c}"></span></span>
        <span class="v" style="color:${c}">${sl >= 0 ? '+' : '−'}${esc(durShort(Math.abs(sl)))}${moved ? `<small>vorher ${r.due - r.before >= 0 ? '+' : '−'}${esc(durShort(Math.abs(r.due - r.before)))}</small>` : `<small>${sl >= 0 ? 'Puffer' : 'Verzug'}</small>`}</span></div>`;
    }).join('');
    // Achse: volle Stunden bzw. Tage (nur innerhalb des gezeigten Bereichs)
    const ticks = [];
    const hourStep = span <= 4 * 3600 ? 3600 : span <= 8 * 3600 ? 2 * 3600 : span <= 20 * 3600 ? 4 * 3600 : 0;
    if (hourStep) { for (let t = Math.ceil(t0 / hourStep) * hourStep; t <= t1; t += hourStep) ticks.push({ t, l: U.fmtClock(t) }); }
    else { for (let t = Math.floor(t0 / DAY) * DAY + DAY; t <= t1; t += DAY) ticks.push({ t, l: U.fmtDay(t) }); }
    const ax = ticks.filter(x => X(x.t) > 16 && X(x.t) < 92).map(x => `<span style="left:${X(x.t).toFixed(2)}%">${esc(x.l)}</span>`).join('');
    const grid = ticks.filter(x => X(x.t) > 0 && X(x.t) < 100).map(x => `<i style="left:${X(x.t).toFixed(2)}%"></i>`).join('');
    return `<div class="ai-imp"><div class="ai-imp-h"><span class="tt">${esc(imp.title || 'Prognose gegen Termin')}</span><span class="lg"><span><i class="lg-due"></i>Termin</span>${shifted ? '<span><i class="lg-was"></i>vorher</span>' : ''}<span><i class="lg-dot"></i>Prognose</span></span></div>
      <div class="ai-imp-b"><div class="ai-imp-g">${grid}</div>${rows}</div><div class="ai-imp-ax"><span class="now" title="${esc(U.fmtDayClock(t0))}">jetzt</span>${ax}</div></div>`;
  }
  /** Arbeitsgang-Kette als Stepper: fertig (Haken), aktiv (Status-Farbe, Fortschritt), wartend, geplant, extern, Versand */
  function routeHTML(list) {
    if (!list || !list.length) return '';
    const node = (r) => (r.st === 'done' ? icon('check', 11) : r.st === 'ship' ? icon('truck', 11) : r.st === 'ext' ? icon('route', 11) : '');
    const where = (r) => (S().machines[r.station] ? entChip('machine', r.station, r.station) + `<span class="wh">${esc(station(r.station).short)}</span>` : `<span class="wh">${esc(r.where || r.station)}</span>`);
    return `<ol class="ai-route">${list.map(r => `<li class="ai-rt s-${r.st}" style="--c:${r.c}">
      <span class="nd">${node(r)}</span>
      <div class="bd"><div class="h"><span class="sq">AG ${esc(r.seq)}</span><span class="op">${esc(r.op)}</span><span class="tg">${esc(r.pill)}</span></div>
        <div class="w">${where(r)}${r.sub ? `<span class="sub">${inline(r.sub)}</span>` : ''}</div>
        ${r.pct != null && r.st !== 'done' ? `<span class="pg"><i style="width:${Math.round(r.pct * 100)}%"></i></span>` : ''}</div></li>`).join('')}</ol>`;
  }
  /** Werkzeug-Standzeit: Verschleißbalken (heller Anteil = nach dem laufenden Teil), Strich = Wechselgrenze */
  function toolsHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-tools">${list.map(t => {
      const w = Math.max(0, Math.min(100, t.wear || 0)), af = t.after != null ? Math.max(w, Math.min(100, t.after)) : w, lim = t.lim != null ? Math.max(0, Math.min(100, t.lim)) : null;
      const c = t.status === 'broken' || t.status === 'missing' ? 'var(--st-fault)' : t.status === 'changing' || t.status === 'setup' ? 'var(--st-tool)'
        : t.status === 'due' || (lim != null && w >= lim) ? 'var(--st-fault)' : t.status === 'planned' || (lim != null && af >= lim - 5) || w >= (lim != null ? lim - 15 : 65) ? 'var(--st-wait)' : 'var(--st-run)';
      const remT = t.rem != null && isFinite(t.rem) ? 'noch ' + teile(t.rem) : '';
      return `<div class="ai-tl${t.tag ? ' has-tag' : ''}" style="--c:${c}">
        <div class="h"><span class="n">${esc(t.name)}</span><span class="r">${esc(remT)}</span></div>
        <div class="wb" title="${esc(nm(w, 0) + ' % Verschleiß' + (af > w ? ' · nach dem laufenden Teil ' + nm(af, 0) + ' %' : '') + (lim != null ? ' · Wechselgrenze ab ca. ' + nm(lim, 0) + ' %' : ''))}"><i style="width:${w.toFixed(1)}%"></i>${af > w ? `<i class="nx" style="left:${w.toFixed(1)}%;width:${(af - w).toFixed(1)}%"></i>` : ''}${lim != null ? `<b style="left:${lim.toFixed(1)}%"></b>` : ''}</div>
        <div class="s"><span>${esc(nm(w, 0))} % Verschleiß</span>${t.tag ? `<span class="tg">${icon('wrench', 11)}${esc(t.tag)}</span>` : ''}</div></div>`;
    }).join('')}</div>`;
  }
  const SLOT_HTML = { route: routeHTML, tools: toolsHTML, today: () => '' };
  const durShort = (sec) => { const m = Math.round(sec / 60); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h >= 24 ? (Math.round(h / 24 * 10) / 10).toString().replace('.', ',') + ' d' : h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); };
  function sourcesHTML(src) {
    if (!src || !src.length) return '';
    return `<div class="ai-src">${icon('layers', 13)}<span><b>Datenbasis:</b> ${src.map(x => esc(x)).join(' · ')}</span></div>`;
  }
  function followHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-fu">${list.slice(0, 3).map(s => `<button type="button" class="ai-chip" data-ask="${esc(s)}">${icon('arrowRight', 12)}${esc(s)}</button>`).join('')}</div>`;
  }
  /** Aktionskarte: Vorschlag → „Ausführen“ (Bestätigung) → Ergebnis */
  function actionCard(m, act, opts) {
    const host = opts && opts.ask ? m.asks : m.extra;
    const box = host.querySelector('.ai-acts') || host.appendChild(WF.ui.el('div', { class: 'ai-acts' }));
    const n = WF.ui.el('div', { class: 'ai-act' + (act.danger ? ' danger' : '') + (act.quiet ? ' quiet' : '') });
    n.innerHTML = `<span class="ic">${icon(act.icon || 'bolt', 15)}</span><div style="min-width:0"><div class="t">${esc(act.title || act.label)}</div>${act.desc ? `<div class="d">${esc(act.desc)}</div>` : ''}</div>
      <div class="b"><button type="button" class="btn sm ghost" data-no>${opts && opts.ask ? 'Ablehnen' : 'Verwerfen'}</button><button type="button" class="btn sm ${act.danger ? 'danger' : 'primary'}" data-go>${icon('check', 13)}${opts && opts.ask ? 'Bestätigen' : 'Ausführen'}</button></div>`;
    box.append(n);
    scrollEnd(false);
    return new Promise((resolve) => {
      const fin = (cls, html, res) => { n.className = 'ai-act ' + cls; n.querySelector('.b').innerHTML = `<span class="res">${html}</span>`; resolve(res); };
      n.querySelector('[data-go]').onclick = () => {
        const r = runAct(act.action);
        const ok = !(r && r.ok === false);
        fin(ok ? 'ok' : 'fail', `${icon(ok ? 'check' : 'alert', 13)}${esc(ok ? 'Ausgeführt ' + nowLabel() : 'Nicht möglich')}`, { ok, msg: (r && r.msg) || (ok ? 'Ausgeführt' : 'Nicht möglich'), result: r });
        if (!(opts && opts.ask)) addSys((r && r.msg) || (ok ? 'Ausgeführt' : 'Nicht möglich'), ok ? 'ok' : 'warn');
        renderSugg(true);
      };
      n.querySelector('[data-no]').onclick = () => fin('no', `${icon('x', 13)}Verworfen`, { ok: false, rejected: true, msg: 'Vom Nutzer abgelehnt' });
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => { if (n.querySelector('[data-go]')) fin('no', `${icon('x', 13)}Abgebrochen`, { ok: false, rejected: true, msg: 'Abgebrochen' }); });
    });
  }
  function runAct(action) {
    if (!action) return { ok: false, msg: 'Keine Aktion' };
    if (action.type === 'select' || action.type === 'open') { UI.openEntity(action.kind, action.id); return { ok: true, msg: 'Geöffnet' }; }
    if (action.type === 'navigate') { if (WF.app) WF.app.navigate(action.view, action.params); return { ok: true, msg: 'Ansicht ' + VIEW_TITLE(action.view) + ' geöffnet' }; }
    if (action.type === 'ackMany') { let n = 0; for (const id of action.ids || []) { const r = WF.sim.actions.ack(id, 'Schichtleitung'); if (r && r.ok) n++; } return { ok: n > 0, msg: n ? pl(n, 'Meldung', 'Meldungen') + ' quittiert' : 'Keine Meldung mehr offen' }; }
    let r;
    try { r = WF.sim.runAction(action); } catch (e) { r = { ok: false, msg: e.message }; }
    if (!openState && r && r.ok !== false && WF.app && WF.app.toast) WF.app.toast(r.msg || 'Ausgeführt', 'ok');
    return r;
  }
  function finishExtras(m, a) {
    let html = '';
    if (a.stats) html += statsHTML(a.stats);
    if (a.impact) html += impactHTML(a.impact);
    if (html) m.body.insertAdjacentHTML('afterbegin', html.replace(/^/, ''));
    if (a.stats || a.impact) { // Kennzahlen nach dem ersten Absatz einfügen (Kernaussage zuerst)
      const mdEl = m.body.querySelector('.ai-md'), first = mdEl && mdEl.firstElementChild;
      const blocks = Array.from(m.body.querySelectorAll(':scope > .ai-stats, :scope > .ai-imp'));
      if (first) { let ref = first; for (const b of blocks) { if (b.classList.contains('ai-imp') && a.kind !== 'whatif' && a.kind !== 'order') { const q = mdEl.querySelector('blockquote'); if (q) { mdEl.insertBefore(b, q); continue; } } ref.after(b); ref = b; } }
    }
    m.extra.insertAdjacentHTML('beforeend', sourcesHTML(a.sources));
    for (const act of a.actions || []) actionCard(m, act);
    m.extra.insertAdjacentHTML('beforeend', followHTML(a.followups));
    m.followups = a.followups || [];
    scrollEnd(false);
  }

  // ------------------------------------------------------------------ Senden
  function submit() {
    const text = R.input.value.trim();
    if (!text || conv.busy) return;
    R.input.value = ''; autoGrow();
    send(text, conv.context);
  }
  UI.ask = (text, context) => {
    UI.open({ noFocus: true });
    if (context && context.kind) conv.context = Object.assign({}, context);
    renderCtx();
    if (conv.busy) stop();
    return send(String(text || '').trim(), conv.context);
  };
  function stop() { if (conv.ctl) { try { conv.ctl.abort(); } catch (e) { /* */ } } }
  function setBusy(b) {
    conv.busy = b;
    panel.classList.toggle('busy', b);
    R.send.classList.toggle('stop', b);
    R.send.innerHTML = b ? '<i></i>' : icon('send', 16);
    R.send.title = b ? 'Antwort stoppen' : 'Senden (Enter)';
    R.send.setAttribute('aria-label', b ? 'Antwort stoppen' : 'Senden');
    R.send.disabled = !b && !R.input.value.trim();
    renderSugg(true);
  }
  async function send(text, context) {
    if (!text) return null;
    build();
    // Meldungs-Bezug gilt nur für die eine Analyse; danach zählt die betroffene Maschine/der Auftrag als Bezug
    if (context && context.kind === 'notification' && conv.context === context) {
      const n = (S().notifications || []).find(x => x.id === context.id);
      conv.context = n && n.entity && n.entity.id && S()[n.entity.kind === 'machine' ? 'machines' : n.entity.kind === 'order' ? 'orders' : n.entity.kind === 'material' ? 'materials' : 'x'] ? { kind: n.entity.kind, id: n.entity.id } : null;
      setTimeout(() => { renderCtx(); renderSugg(true); }, 0);
    }
    addUser(text);
    setBusy(true);
    const ctl = new AbortController(); conv.ctl = ctl;
    let res = null;
    try {
      const sample = live.status === 'offline' ? null : await waitSample(ctl);
      if (ctl.signal.aborted) throw { code: 'cancelled' };
      if (sample) res = await askLive(sample, text, context, ctl);
      else { const note = conv.pendingNote; conv.pendingNote = null; res = await askOffline(text, context, ctl, note); }
    } catch (e) {
      if (!(e && e.code === 'cancelled')) console.error('[ai]', e);
    } finally {
      setBusy(false); conv.ctl = null;
      renderSugg(true);
    }
    return res;
  }
  /** Claude-Verbindung abwarten – höchstens ca. 3,5 s; dauert es länger, antwortet der Offline-Copilot (Verbindung läuft weiter) */
  async function waitSample(ctl) {
    if (live.status === 'live' && live.sample) return live.sample;
    const p = getSample();
    if (live.status !== 'verbinde') return p;
    const pending = addAssistant('KI'); setTyping(pending, 'Verbinde mit Claude …');
    const s = await Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 3500)), new Promise(r => ctl.signal.addEventListener('abort', () => r(null)))]);
    pending.el.remove(); conv.msgs.splice(conv.msgs.indexOf(pending), 1);
    if (s === 'timeout') { conv.pendingNote = 'Die Verbindung zu Claude wird noch aufgebaut – diese Antwort kommt aus dem Offline-Copilot.'; return null; }
    return s;
  }
  /** Offline: Antwort sofort berechnen, dann zügig „schreiben“ (wie Streaming, max. ca. 0,9 s) */
  function askOffline(text, context, ctl, note) {
    const m = addAssistant('offline');
    const ctx = context && context.kind && context.kind !== 'view' ? context : (conv.lastEntity ? Object.assign({ fromLast: true }, conv.lastEntity) : context);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (ctl.signal.aborted) { m.body.innerHTML = '<div class="ai-md"><p class="muted">Abgebrochen.</p></div>'; return resolve(null); }
        const a = offlineAnswer(text, ctx);
        if (a.entity) conv.lastEntity = a.entity;
        if (note) m.el.querySelector('.ai-asks').insertAdjacentHTML('beforebegin', `<div class="ai-notice">${icon('info', 14)}<span>${esc(note)}</span></div>`);
        const full = a.display || a.text;
        m.plain = a.text;
        if (a.slots) { m.slots = {}; for (const k in a.slots) m.slots[k] = SLOT_HTML[k] ? SLOT_HTML[k](a.slots[k].data) : ''; }
        const words = full.split(/(\s+)/);
        const steps = Math.min(28, Math.max(6, Math.ceil(words.length / 14)));
        const per = Math.ceil(words.length / steps);
        let i = 0;
        const tick = () => {
          if (ctl.signal.aborted) { m.text = words.slice(0, i).join(''); renderBody(m, false); m.body.insertAdjacentHTML('beforeend', '<div class="ai-meta">Abgebrochen</div>'); return resolve(a); }
          i = Math.min(words.length, i + per);
          m.text = words.slice(0, i).join('');
          renderBody(m, i < words.length);
          if (i < words.length) setTimeout(tick, 26);
          else {
            m.status = 'done';
            finishExtras(m, a);
            showCopy(m);
            if (a.autoRun) { const r = runAct(a.autoRun); if (r && r.ok === false) addSys(r.msg || 'Nicht möglich', 'warn'); }
            conv.history.push({ role: 'user', content: text }, { role: 'assistant', content: a.text });
            resolve(a);
          }
        };
        tick();
      }, 280 + Math.random() * 220);
    });
  }
  /** Live: Claude mit leitender Anweisung, Verlauf und Werkzeugen */
  async function askLive(sample, text, context, ctl) {
    const m = addAssistant('KI');
    const turns = [{ role: 'user', content: instructions(context) }];
    const hist = conv.history.slice(-10).map(x => ({ role: x.role, content: trimTxt(x.content, 3000) }));
    for (const x of hist) turns.push(x);
    turns.push({ role: 'user', content: text });
    const opts = {
      signal: ctl.signal,
      modelTier: pickTier(text),
      onText: ({ text: tx }) => { m.text = tx; renderBody(m, true); },
    };
    if (live.tools) {
      opts.tools = TOOLS.slice(0, live.maxTools || TOOLS.length).map(tl => ({
        name: tl.name, description: tl.description, inputSchema: tl.inputSchema || { type: 'object', properties: {} },
        execute: async (input, tctx) => {
          input = input || {};
          const lb = tl.label(input);
          if (tl.act) {
            const spec = tl.confirm(input);
            const chip = toolChip(m, lb);
            if (!spec.action || (spec.action.machineId === null)) { chip.done(false, lb + ' – ungültig'); throw new Error('Ungültige Angabe'); }
            setTyping(m, 'Wartet auf Bestätigung …');
            const r = await actionCard(m, spec, { ask: true, signal: tctx && tctx.signal });
            setTyping(m, 'Claude denkt nach …');
            chip.done(r.ok, r.rejected ? lb.replace(/…$/, '') + ' – abgelehnt' : r.ok ? lb + ' – erledigt' : lb + ' – nicht möglich');
            if (r.rejected) return { ok: false, abgelehnt: true, hinweis: 'Der Nutzer hat die Aktion abgelehnt. Nicht erneut versuchen.' };
            return { ok: r.ok, meldung: r.msg };
          }
          const chip = toolChip(m, lb);
          try { const out = tl.run(input); chip.done(true, lb.replace(/^Liest /, 'Gelesen: ').replace(/^Öffnet /, 'Geöffnet: ')); return out; }
          catch (e) { chip.done(false, lb + ' – Fehler'); throw e; }
        },
      }));
    } else opts.cache = false;
    try {
      const r = await sample(turns, opts);
      m.text = r.text; renderBody(m, false); m.status = 'done'; showCopy(m);
      if (r.truncated) m.extra.insertAdjacentHTML('beforeend', `<div class="ai-err">${icon('info', 14)}<div>Antwort wurde gekürzt (Längenlimit). Für Details gezielter nachfragen.</div></div>`);
      m.extra.insertAdjacentHTML('beforeend', sourcesHTML(['Claude' + (r.modelTierApplied ? ' (' + (r.modelTierApplied === 'quick' ? 'schnell' : r.modelTierApplied === 'complex' ? 'ausführlich' : 'Standard') + ')' : ''), 'Lageübersicht ' + U.fmtClock(NOW()), live.tools ? 'Werkzeug-Abfragen' : 'ohne Werkzeuge']));
      const E = entities(text + ' ' + r.text);
      if (E.orders[0]) conv.lastEntity = { kind: 'order', id: E.orders[0] }; else if (E.machines[0]) conv.lastEntity = { kind: 'machine', id: E.machines[0] };
      conv.history.push({ role: 'user', content: text }, { role: 'assistant', content: r.text });
      scrollEnd(false);
      return r;
    } catch (e) {
      const code = (e && e.code) || 'upstream_error';
      if (e && e.text) { m.text = e.text; renderBody(m, false); } else if (code !== 'cancelled' || !m.text) m.body.innerHTML = '';
      if (code === 'cancelled') { m.body.insertAdjacentHTML('beforeend', '<div class="ai-meta">Abgebrochen</div>'); if (!m.text) m.body.innerHTML = '<div class="ai-md"><p class="muted">Abgebrochen.</p></div>'; return null; }
      if (code === 'refused') m.body.innerHTML = '';
      if (PERMANENT[code] || code === 'tools_unavailable') {
        if (code === 'tools_unavailable') { live.tools = false; }
        else goOffline(PERMANENT[code] + ' – Offline-Copilot aktiv.');
        m.el.remove(); conv.msgs.splice(conv.msgs.indexOf(m), 1);
        return askOffline(text, context, ctl, `${code === 'tools_unavailable' ? 'Werkzeuge sind in dieser Ansicht nicht verfügbar' : PERMANENT[code]} – Antwort vom Offline-Copilot aus den Live-Daten.`);
      }
      const msg = ERR[code] || ERR.upstream_error;
      m.extra.insertAdjacentHTML('beforeend', `<div class="ai-err">${icon('alert', 15)}<div>${esc(msg)}<div class="b"><button type="button" class="btn sm" data-retry="${esc(text)}">${icon('refresh', 13)}Erneut senden</button><button type="button" class="btn sm ghost" data-offline="${esc(text)}">Offline-Antwort anzeigen</button></div></div></div>`);
      if (!m.text && !m.body.innerHTML) m.body.innerHTML = '';
      scrollEnd(false);
      return null;
    }
  }

  function showCopy(m) { const b = m.el && m.el.querySelector('.ai-copy'); if (b && m.text) b.hidden = false; }
  /** Antwort als Klartext (Markdown ohne Sternchen) – z. B. Schichtübergabe in E-Mail/Schichtbuch übernehmen */
  function copyMsg(id, btn) {
    const m = conv.msgs.find(x => String(x.id) === String(id)); if (!m) return;
    const plain = (m.plain || m.text).replace(/\*\*/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^~\s+/gm, '').replace(/^>\s?/gm, '');
    const ok = () => { btn.classList.add('ok'); btn.innerHTML = icon('check', 13); btn.title = 'Kopiert'; setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = icon('file', 13); btn.title = 'Antwort als Text kopieren'; }, 1600); };
    const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = plain; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select(); const r = document.execCommand('copy'); ta.remove(); if (r) ok(); else addSys('Kopieren ist in dieser Ansicht nicht erlaubt.', 'warn'); } catch (e) { addSys('Kopieren ist in dieser Ansicht nicht erlaubt.', 'warn'); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(plain).then(ok, fallback); else fallback(); } catch (e) { fallback(); }
  }

  // ------------------------------------------------------------------ Klicks im Panel
  function onPanelClick(e) {
    const t = e.target.closest('button, [data-ent-k]');
    if (!t || !panel.contains(t)) return;
    if (t.dataset.ask) { if (!conv.busy) send(t.dataset.ask, conv.context); return; }
    if (t.dataset.copy) { copyMsg(t.dataset.copy, t); return; }
    if (t.classList.contains('ai-ent') && t.dataset.k) { UI.openEntity(t.dataset.k, t.dataset.id); return; }
    if (t.dataset.entK) { UI.openEntity(t.dataset.entK, t.dataset.entId); return; }
    if (t.hasAttribute('data-ctxx')) { conv.context = null; renderCtx(); renderSugg(true); return; }
    if (t.dataset.retry) { if (!conv.busy) send(t.dataset.retry, conv.context); return; }
    if (t.dataset.offline) { if (conv.busy) return; const ctl = new AbortController(); conv.ctl = ctl; setBusy(true); askOffline(t.dataset.offline, conv.context, ctl, 'Antwort vom Offline-Copilot (regelbasiert, aus Live-Daten).').finally(() => { setBusy(false); conv.ctl = null; }); }
  }

  // ------------------------------------------------------------------ Bus, Tastatur, Aktualisierung
  WF.bus.on('ai:open', (p) => { if (p && p.toggle === false) UI.open(); else UI.toggle(); });
  WF.bus.on('ai:close', () => UI.close());
  WF.bus.on('ai:ask', (p) => {
    if (!p || !p.text) return;
    // aus dem Benachrichtigungscenter heraus gefragt: Center schließen (es liegt über dem Copilot)
    if (document.querySelector('.notif-panel')) { try { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) { /* */ } }
    UI.ask(p.text, p.context);
  });
  WF.bus.on('select', (p) => {
    if (!panel) return;
    if (openState && p && p.kind && p.id && (!conv.context || conv.context.auto || conv.context.kind !== 'notification')) conv.context = { kind: p.kind, id: p.id, auto: true };
    else if (p && !p.kind && conv.context && conv.context.auto) conv.context = null;
    setTimeout(layout, 0);
    renderCtx(); renderSugg(false);
  });
  WF.bus.on('navigate', () => { if (!panel) return; renderSugg(false); if (!conv.msgs.length && R.log.querySelector('.ai-empty')) renderEmpty(); });
  WF.bus.on('sim:reset', () => { if (panel) { UI.clear(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openState) return;
    if (document.querySelector('.notif-panel') || document.querySelector('.modal-back')) return;
    e.stopPropagation(); e.preventDefault();
    UI.close();
  }, true);
  G.addEventListener && G.addEventListener('resize', () => layout());
  // Live-Zustand der Chips (Zustandsfarben), Kontextzeile und Vorschläge alle 2 s nachziehen – nur sichtbar
  setInterval(() => {
    if (!openState || !panel || !S()) return;
    panel.querySelectorAll('.ai-ent[data-k]').forEach(n => { const c2 = entColor(n.dataset.k, n.dataset.id); if (n._c !== c2) { n._c = c2; n.style.setProperty('--c', c2); } });
    renderCtx(); renderSugg(false);
    if (R.log.querySelector('.ai-empty') && !conv.msgs.length) { const sig = Object.values(S().machines).filter(m => m.state === 'running').length + '|' + Object.values(S().people).filter(p => p.state !== 'offShift').length; if (sig !== R.log._sig) { R.log._sig = sig; renderEmpty(); } }
  }, 2000);
  // Eigenes Scrollen (Rad, Wischen, Tasten) beendet das Mitlaufen bis zur nächsten Frage
  const pin = () => { if (R.log) for (const ev of ['wheel', 'touchmove', 'keydown']) R.log.addEventListener(ev, () => { autoScroll = false; }, { passive: true }); };
  // Panel früh aufbauen (unsichtbar), damit der erste Klick sofort reagiert; Claude-Verbindung im Hintergrund prüfen
  const boot = () => { build(); pin(); getSample(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50)); else setTimeout(boot, 50);
})();
