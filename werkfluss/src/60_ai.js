/* werkfluss – KI-Schicht (60_ai.js): WF.ai, Copilot-Panel, Schichtbriefing, „Ursache analysieren“.
   ----------------------------------------------------------------------------------------------------
   Zwei Betriebsarten, gleiche Oberfläche:
     „Claude · live“  – veröffentlicht auf claude.ai über die Artifact-Capability `sample`
                        (window.claude.use('sample')). Leitender user-Turn mit Produkt, Fabrik, Regeln und
                        kompakter Lageübersicht (WF.sim.snapshot); Details liest Claude über Datenabfragen
                        (get_machine, get_order …), Aktionen (trigger_fault, set_priority …) laufen nur nach
                        Bestätigung im Panel. Aufruf nur auf ausdrückliche Nutzeraktion (Senden, Vorschlag).
     „Lokal · aus Live-Daten“ – lokal geöffnet, ohne Freigabe oder bei Fehlern: regelbasierter Agent, der die häufigen
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
  /** Maschinenzustand benennen wie alle Ansichten (UI_GUIDE Regel 19: „Keine Schicht“ statt „Bereit“ ohne Schicht) */
  const msl = (mv) => (!mv ? '' : WF.ui && WF.ui.machineStateLabel ? WF.ui.machineStateLabel(mv) : stLabel(mv.state));
  /** Satzbaustein zum Zustand: „produziert“, „rüstet“, „wartet auf Werkzeug“ … (für „M05 produziert gerade FA-24120“) */
  const STATE_VERB = { running: 'produziert', setup: 'rüstet', firstPiece: 'wartet auf die Erstteilprüfung', toolchange: 'wechselt Werkzeug', waitTool: 'wartet auf Werkzeug', waitOperator: 'wartet auf Bediener', starved: 'wartet auf Material', blocked: 'steht (Ausgang voll)', fault: 'ist gestört', idle: 'ist bereit' };
  const stateVerb = (mv) => (msl(mv) === 'Keine Schicht' ? 'steht planmäßig (keine Schicht)' : STATE_VERB[mv.state] || lc1(msl(mv)));
  /** Partner der Fremdbearbeitung ohne den Zusatz „(Beispiel)“ im Fließtext */
  const partnerName = (p) => String(p || 'Fremdbearbeiter').replace(/\s*\(Beispiel\)/, '');
  /** Anzeige-Zustand einer Person – dieselbe Einteilung wie die Personalansicht (WF.people.displayState):
      working/driving/walking = mit Aufgabe, tending = betreut eigene laufende Maschinen, lead = Schichtleitung, idle = verfügbar */
  function pDisp(p) {
    if (!p) return { key: 'offShift', label: 'Nicht im Dienst', machines: [] };
    if (WF.people && typeof WF.people.displayState === 'function') { try { const d = WF.people.displayState(p.id); if (d && d.key) return d; } catch (e) { /* Rohzustand */ } }
    return { key: p.state, label: p.state === 'idle' ? 'Verfügbar' : label('person', p.state), machines: [] };
  }
  const P_ACTIVE = { working: 1, driving: 1, walking: 1, tending: 1, lead: 1 };
  /** Besetzung wie die Kennzahl der Personalansicht: im Einsatz = mit Aufgabe + betreut Maschinen + Schichtleitung; verfügbar = ohne Aufgabe und ohne laufende eigene Maschine */
  function crewCounts(list) {
    const ds = list.map(p => ({ p, d: pDisp(p) }));
    const task = ds.filter(x => x.p.task && x.p.state !== 'break').length;
    const tend = ds.filter(x => !(x.p.task && x.p.state !== 'break') && x.d.key === 'tending').length;
    const lead = ds.filter(x => !(x.p.task && x.p.state !== 'break') && x.d.key === 'lead').length;
    const free = ds.filter(x => x.d.key === 'idle' && !x.p.task), brk = ds.filter(x => x.p.state === 'break').length;
    const parts = [task ? task + ' mit Aufgabe' : '', tend ? tend + (tend === 1 ? ' betreut' : ' betreuen') + ' Maschinen' : '', lead ? (lead === 1 ? 'Schichtleitung' : lead + '× Schichtleitung') : '',
      free.length ? free.length + ' verfügbar' : 'niemand verfügbar', brk ? brk + ' in der Pause' : ''].filter(Boolean);
    return { task, tend, lead, free: free.map(x => x.p), brk, einsatz: task + tend + lead, txt: parts.join(', ') };
  }
  /** OEE-Kopfzahl wie Leitstand und Analyse: enthält der Tag eine Geisterschicht, gilt die OEE der besetzten Schichten
      (kpis().oeeStaffedToday, Faktoren aus kpis().staffedToday) – der ganze Tag inkl. Nacht wird nur dazu genannt */
  function oeeHead(k) {
    const has = !!k && Object.prototype.hasOwnProperty.call(k, 'oeeStaffedToday'), st = has ? k.oeeStaffedToday : undefined;
    if (!(has && k.oee != null && st != null && Math.abs(k.oee - st) >= 0.0005)) return { v: k ? k.oee : null, a: k && k.availability, p: k && k.performance, q: k && k.quality, staffed: false, label: 'OEE heute' };
    const s2 = k.staffedToday || {};
    return { v: st, a: s2.availability, p: s2.performance, q: s2.quality, staffed: true, label: 'OEE heute · Schichten', day: k.oee };
  }
  /** Stillstandskosten wie Leitstand und Analyse: Wert = Schichtzeit, die Nacht (Geisterschicht) getrennt */
  function lossHead(k) {
    const night = k && typeof k.lossEurNightToday === 'number' && k.lossEurNightToday >= 0.5 ? k.lossEurNightToday : 0;
    const value = k && typeof k.lossEurStaffedToday === 'number' ? k.lossEurStaffedToday : Math.max(0, ((k && k.lossEur) || 0) - night);
    return { value, night, split: night > 0 };
  }
  /** OEE einer Maschine wie die Analyse: nach einer Nacht die besetzten Schichten (Tageswerte minus Nachtanteil der Engine) */
  function machineOee(mv, k) {
    const o0 = (mv && mv.oeeToday) || {};
    if (!mv || !oeeHead(k).staffed) return o0;
    const m = S().machines[mv.id], d = m && m.kd, n = m && m.kn && typeof m.kn.lossEur === 'number' && m.kn.lossEurBy ? m.kn : null;
    if (!d || !n || !(n.planned > 0)) return o0;
    const planned = d.planned - n.planned, run = d.run - n.run;
    const idealD = o0.performance != null && o0.performance < 1 && o0.runSec > 0 ? o0.performance * o0.runSec : d.ideal;
    const ideal = idealD - (n.ideal || 0), good = d.good - (n.good || 0), scrap = d.scrap - (n.scrap || 0);
    const a = planned > 0 ? Math.min(1, run / planned) : null, p = run > 0 ? Math.min(1, Math.max(0, ideal) / run) : null, q = good + scrap > 0 ? good / (good + scrap) : 1;
    return { oee: a != null && p != null ? a * p * q : null, availability: a, performance: p, quality: q, plannedSec: planned, runSec: run, staffed: true, day: o0.oee };
  }
  /** Bilanz der letzten Geisterschicht (Engine kpis().ghostLastNight) – nur in den ersten Stunden danach */
  function ghostNightTxt(k) {
    const g = k && k.ghostLastNight;
    if (!g || g.to == null || NOW() - g.to > 6 * 3600 || NOW() < g.to) return '';
    const st = (g.stopped || []).slice().sort((x, y) => (y.lossEur || 0) - (x.lossEur || 0));
    const nPrev = (g.prevented || []).length;
    return `Letzte Nacht (Geisterschicht): ${g.autonomous ? g.autonomous + ' autonome Maschinen, ' : ''}OEE ${pct(g.oee, 1)}, Stillstand ${eur(g.lossEur)}` +
      (st.length ? ` – ${listJoin(st.slice(0, 3).map(x => `${x.machineId} stand ${durR(x.stoodSec)}${x.state ? ' (' + causeLabel(x.state) + ')' : ''}`))}` : ' – keine Maschine stand') +
      (nPrev ? `; ${pl(nPrev, 'Stopp', 'Stopps')} vorbeugend verhindert` : '') + '.';
  }
  /** Verb-Satz für eine Person: „arbeitet an M08“, „betreut M02 · M03“, „ist verfügbar“ */
  function personVerb(p, where) {
    const d = pDisp(p);
    switch (d.key) {
      case 'working': return 'arbeitet' + (where && where !== 'am Arbeitsplatz' ? ' ' + where : '');
      case 'driving': return 'fährt Stapler';
      case 'walking': return 'ist ' + (where && /^unterwegs/.test(where) ? where : 'unterwegs');
      case 'tending': return lc1(d.label);
      case 'lead': return 'ist in der Schichtleitung';
      case 'idle': return 'ist verfügbar';
      case 'break': return 'ist in der Pause';
      case 'offShift': return 'ist nicht im Dienst';
      default: return lc1(d.label);
    }
  }
  const listJoin = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' und ' + arr[arr.length - 1]);
  /** Veränderung als Text – unter 1 min gibt es keine „~0 s“, sondern „keine spürbare Änderung“ */
  const NOCHG = 'keine spürbare Änderung';
  const deltaTxt = (sec) => (sec == null || Math.abs(sec) < 60 ? NOCHG : (sec > 0 ? '+' : '−') + durR(Math.abs(sec)));
  /** Puffer bzw. Verzug eines Auftrags (Sekunden bis Termin) */
  const slackTxt = (s) => (s == null ? 'ohne Prognose' : s < 0 ? durR(-s) + ' Verzug' : s < 60 ? 'kein Puffer' : 'Puffer ' + durR(s));
  /** OEE-Kachel: nahe am Ziel (± 0,5 Pkt.) mit einer Nachkommastelle, damit Farbe und Zahl zusammenpassen (74,6 % statt „75 %“ in Gelb) */
  const oeeStat = (oee, sub, dec, lbl) => ({ l: lbl || 'OEE heute', v: oee == null ? '–' : pct(oee, dec != null ? dec : 1), s: sub, c: oee == null ? '' : oee >= TARGET_OEE ? 'ok' : 'warn' });
  const oeeDec = (oee) => (oee != null && Math.abs(oee - TARGET_OEE) < 0.005 ? 1 : 0);
  /** Stückpreis: unter 100 € mit Cent (9,80 €), sonst ganze Euro */
  const eurUnit = (n) => U.fmtEur(n, n < 100 && Math.round(n) !== n ? 2 : 0);
  /** Strompreis (€/kWh): aus dem Profil, sonst Annahme Industrietarif */
  const ENERGY_PRICE = () => {
    // eine Quelle: Engine-Kosten (profile.costs), sonst ältere Profilfelder, sonst Annahme
    let c = null; try { c = WF.sim.costs ? WF.sim.costs() : null; } catch (e) { c = null; }
    const p = PROF() || {};
    const v = (c && c.energyEurPerKwh) || (p.costs && p.costs.energyEurPerKwh) || (p.energy && p.energy.eurPerKwh) || (p.company && p.company.eurPerKwh);
    return v > 0 ? { v, assumed: false } : { v: 0.19, assumed: true };
  };

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
  /** Prognose-Verlauf (für „vorher/nachher“ bei Störungen): letzte Liefertermin- und Arbeitsgang-Prognosen, höchstens
      alle 30 Sim-Sekunden ein Eintrag. Gelesen wird nur die (gecachte) Prognose – wie in jeder Ansicht. */
  const etaLog = [];
  function logEta() {
    if (!WF.sim || !S() || typeof WF.sim.forecast !== 'function') return;
    const t = NOW(), last = etaLog[etaLog.length - 1];
    if (last && t < last.t) etaLog.length = 0; // Neustart der Simulation
    else if (last && t - last.t < 30) return;
    let fc; try { fc = WF.sim.forecast(); } catch (e) { return; }
    if (!fc) return;
    const eta = {}, opEnd = {};
    // veröffentlichte Prognose (wie Auftragsliste und Leitstand) – „bisher“ bei Störungen
    for (const id in fc.orders) { const x = fc.orders[id]; if (!x.done) eta[id] = x.eta != null ? x.eta : x.etaRaw; }
    for (const mid in fc.machines) for (const e of fc.machines[mid]) opEnd[e.orderId + '/' + e.seq] = e.opEnd != null ? e.opEnd : e.end;
    const faulted = {};
    for (const mid in S().machines) if (S().machines[mid].state === 'fault' || S().machines[mid].fault) faulted[mid] = 1;
    const sig = JSON.stringify(eta) + Object.keys(faulted).join();
    if (last && last.sig === sig && last.fcT === fc.t) { last.t = t; return; }
    etaLog.push({ t, fcT: fc.t != null ? fc.t : t, eta, opEnd, faulted, sig });
    if (etaLog.length > 80) etaLog.shift();
  }
  /** letzte Prognose vor einer Störung an mid (berechnet, als mid noch nicht gestört war; höchstens 2 h alt) */
  const etaBefore = (t0, mid) => {
    for (let i = etaLog.length - 1; i >= 0; i--) { const x = etaLog[i]; if (x.fcT <= t0 && !x.faulted[mid]) return t0 - x.fcT <= 7200 ? x : null; }
    return null;
  };
  function data() {
    logEta();
    const c = { t: NOW() };
    const mvs = {}, ovs = {};
    let fc = null, k = null;
    c.mv = (id) => { if (!(id in mvs)) { try { mvs[id] = WF.sim.machineView(id); } catch (e) { mvs[id] = null; } } return mvs[id]; };
    c.mvs = () => PROF().machines.map(c.mv).filter(Boolean);
    c.ov = (id) => { if (!(id in ovs)) { try { ovs[id] = effEta(WF.sim.orderView(id)); } catch (e) { ovs[id] = null; } } return ovs[id]; };
    c.ovs = () => Object.keys(S().orders).sort().map(c.ov).filter(Boolean);
    c.open = () => c.ovs().filter(o => o.status !== 'fertig');
    c.fc = () => fc || (fc = WF.sim.forecast());
    c.k = () => k || (k = WF.sim.kpis());
    c.notifs = () => (S().notifications || []).filter(n => n.status !== 'resolved');
    return c;
  }
  /** Eine Prognose je Auftrag für jede Antwort: die veröffentlichte (eta, wie Auftragsliste und Leitstand). Liegt eine
      Neuberechnung vor (etaPending; nach einer Störung auf dem Weg des Auftrags die frische Rechnung), gilt sie als
      „neu gerechnet“: Kopf, Kennzahlen, Puffer, Text und Empfehlung lesen dann alle diesen Wert, der alte erscheint nur als „bisher“. */
  function effEta(o) {
    if (!o) return o;
    o.etaPub = o.eta; o.etaNew = false; o.etaWhy = null;
    if (o.status === 'fertig' || o.eta == null) return o;
    const flt = o.ops.find(op => !op.complete && S().machines[op.station] && S().machines[op.station].state === 'fault');
    const cand = o.etaPending != null ? o.etaPending : flt && o.etaRaw != null ? o.etaRaw : null;
    if (cand == null || Math.abs(cand - o.eta) < 60) return o;
    const slack = o.due - cand, risk = slack < 0 ? 'spät' : slack < 4 * 3600 ? 'knapp' : 'ok';
    return Object.assign(o, { eta: cand, etaNew: true, etaWhy: flt ? 'Störung an ' + flt.station : null, slackSec: Math.round(slack), risk, riskLabel: label('risk', risk), late: slack < 0 });
  }
  /** Zusatz zur Prognose, wenn neu gerechnet: „ (neu gerechnet nach Störung an M07, bisher 14:55)“ */
  const etaTag = (o) => (o && o.etaNew ? ` (neu gerechnet${o.etaWhy ? ' nach ' + o.etaWhy : ''}, bisher ${tc(o.etaPub)})` : '');
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
  const bnMachine = (o) => (o ? o.bottleneckStation || (o.bottleneck ? o.bottleneck.split(' ')[0] : null) : null);

  // ================================================================== Kritischer Pfad: warum ist ein Auftrag knapp oder spät?
  /** Segmente der offenen Arbeitsgänge laut Prognose (Plantafel):
      – Warten: die Teile wären da (bzw. der Vorgänger liefert), der Arbeitsplatz ist aber mit anderen Aufträgen belegt,
      – Bearbeitung: eigene Rest-Bearbeitungszeit (nur wenn sie das Ende bestimmt, nicht der Nachlauf des Vorgängers),
      – Fremdbearbeitung: Abholung bis letzter Rücklauf,
      – Stopp: der laufende Arbeitsgang steht gerade (Störung, Werkzeug, Material, Bediener).
      Zeiten in Arbeitszeit bei bemannten, in Kalenderzeit bei unbemannt laufenden Arbeitsplätzen. */
  function orderChain(c, o) {
    const f = c.fc().orders[o.id];
    if (!f || f.done || !f.ops) return null;
    const now = c.t, raw = S().orders[o.id], segs = [];
    let stop = null;
    o.ops.forEach((op, i) => {
      const fe = f.ops[i];
      if (op.complete || op.station === 'VERSAND' || !fe) return;
      if (op.station === 'EXT') {
        // Beitrag der Fremdbearbeitung: Rücklauf des letzten Loses nach dem Ende des Vorgängers (Lieferfenster + Durchlauf)
        const pf = i > 0 && !o.ops[i - 1].complete ? f.ops[i - 1] : null;
        const from = Math.max(now, fe.start, pf && pf.end != null ? pf.end : 0), to = fe.lastReturn != null ? fe.lastReturn : fe.end;
        segs.push({ kind: 'ext', i, op, from, to, sec: workBetween(from, to), partner: (op.ext && op.ext.partner) || 'dem Fremdbearbeiter', process: (op.ext && op.ext.process) || op.op });
        return;
      }
      const st = station(op.station);
      if (!st || !S().machines[op.station]) return;
      const auto = st.loading === 'auto', span = (a, b) => (b <= a ? 0 : auto ? b - a : workBetween(a, b));
      const r = (raw && raw.routing[i]) || {};
      const load = st.loading === 'perPart' ? ((r.loadMin != null ? r.loadMin : st.loadMin) || 1) : 0;
      const left = Math.max(0, WF.sim.partsLeft(o.id, op.seq) || 0) + (op.inProc || 0);
      const cyc = ((op.cycleMin || 0) + load) * 60;
      const own = left * cyc + (op.state === 'active' || op.good + op.scrap > 0 ? 0 : (op.setupMin || 0) * 60);
      const from = Math.max(now, fe.start);
      const seg = { kind: 'run', i, op, station: op.station, auto, left, own, runSpan: span(from, fe.end), start: fe.start, end: fe.end, wait: 0, blockers: [] };
      // Ende bestimmt der Nachlauf des Vorgängers (wie die Prognose: letzter Behälter + Transport), nicht die eigene Bearbeitung
      const pfe0 = i > 0 && !o.ops[i - 1].complete ? f.ops[i - 1] : null;
      const pEnd = pfe0 ? (o.ops[i - 1].station === 'EXT' && pfe0.lastReturn != null ? pfe0.lastReturn : pfe0.end) : null;
      seg.tail = pEnd != null && fe.end <= pEnd + Math.min(op.transferBatch || 10, Math.max(1, left)) * cyc + 600 + 300;
      seg.prevEnd = pEnd;
      if (op.state === 'active') {
        const mv = c.mv(op.station);
        if (mv && (mv.state === 'fault' || WAIT[mv.state])) stop = { i, op, mv };
      } else {
        const pfe = i > 0 ? f.ops[i - 1] : null;
        const avail = i === 0 || op.waiting > 0 ? now : pfe && pfe.first != null ? pfe.first : now;
        const ready = Math.max(now, avail - (op.setupMin || 0) * 60);
        if (fe.start > ready + 300) {
          seg.wait = span(ready, fe.start); seg.waitFrom = ready;
          seg.blockers = (c.fc().machines[op.station] || []).filter(e => e.orderId !== o.id && e.start < fe.start && e.end > ready).sort((a, b) => a.start - b.start);
        }
      }
      segs.push(seg);
    });
    return { f, segs, stop };
  }
  const blockTxt = (bl) => (bl.length ? listJoin(bl.slice(0, 2).map(e => `${e.orderId} AG ${e.seq}${e.active ? ' (läuft)' : ''}`)) + (bl.length > 2 ? ' u. a.' : '') : 'anderen Aufträgen');
  /** Ursachen eines knappen/späten Auftrags aus der Kette – in Routenreihenfolge; main = größter Beitrag */
  function delayCauses(c, o) {
    const ch = orderChain(c, o);
    if (!ch) return null;
    const items = [];
    if (ch.stop) {
      const { op, mv } = ch.stop, fi = faultInfo(mv);
      items.push({ kind: 'stop', i: ch.stop.i, sec: fi ? fi.rem : mv.sinceSec, station: op.station, state: mv.state, mv,
        text: fi ? `AG ${op.seq} an ${op.station} steht: Störung ${mv.fault.code} ${mv.fault.text} – Reparatur bis ca. ${clk(fi.endT)}` : `AG ${op.seq} an ${op.station} steht seit ${durR(mv.sinceSec)}: ${msl(mv)} – ${causeCore(mv)}`,
        short: fi ? `Störung an ${op.station}` : `${msl(mv)} an ${op.station}` });
    }
    for (const s of ch.segs) {
      if (s.kind !== 'run' || s.tail || s.wait < 1800) continue;
      const until = s.blockers.length ? Math.min(s.start, Math.max(...s.blockers.map(e => e.end))) : s.start;
      items.push({ kind: 'wait', i: s.i, sec: s.wait, station: s.station, auto: s.auto, blockers: s.blockers, seg: s,
        text: `${durR(s.wait)} Warten an ${mName(s.station)} – belegt mit ${blockTxt(s.blockers)} bis ca. ${tc(until)}`, short: `Wartezeit an ${s.station}` });
    }
    const runs = ch.segs.filter(s => s.kind === 'run' && !s.tail && s.own >= 3600).sort((a, b) => b.own - a.own);
    if (runs[0]) {
      const s = runs[0];
      items.push({ kind: 'run', i: s.i, sec: s.own, station: s.station, auto: s.auto, seg: s,
        text: `${durR(s.own)} Bearbeitung an ${mName(s.station)} (AG ${s.op.seq}, ${teile(s.left)} à ${nm(s.op.cycleMin, s.op.cycleMin < 10 ? 1 : 0)} min) – fertig ca. ${tc(s.end)}`, short: `Bearbeitungszeit an ${s.station}` });
    }
    const ext = ch.segs.filter(s => s.kind === 'ext' && s.sec >= 2 * 3600).sort((a, b) => b.sec - a.sec)[0];
    if (ext) items.push({ kind: 'ext', i: ext.i, sec: ext.sec, partner: ext.partner, process: ext.process,
      text: `Fremdbearbeitung ${ext.process} bei ${ext.partner} – Rücklauf ca. ${tc(ext.to)}`, short: `Fremdbearbeitung (${ext.process})` });
    const op0 = o.ops.find(x => !x.complete);
    if (op0 && op0.state === 'active' && !ch.stop) {
      const mv = c.mv(op0.station);
      if (mv && mv.state === 'starved' && /Rohmaterial|Lager|Stangen/.test(mv.cause)) items.push({ kind: 'material', i: o.ops.indexOf(op0), sec: mv.sinceSec, station: op0.station, mv, text: `Rohmaterial fehlt an ${op0.station}: ${mv.cause}`, short: 'fehlendes Rohmaterial' });
    }
    const main = items.slice().sort((a, b) => b.sec - a.sec)[0] || null;
    const list = items.slice().sort((a, b) => b.sec - a.sec).slice(0, 4).sort((a, b) => a.i - b.i);
    return { items: list, main, chain: ch };
  }
  /** kompakte Bausteine für die Risiko-Karten: wo steht der Auftrag jetzt, was bremst ihn (Hauptursache laut Plantafel) */
  function orderWhyParts(c, o) {
    const cur = curOp(o);
    let now = '';
    if (cur) {
      const isM = !!S().machines[cur.station], mv = isM ? c.mv(cur.station) : null;
      const fe = (c.fc().orders[o.id] || {}).ops ? c.fc().orders[o.id].ops[o.ops.indexOf(cur)] : null;
      if (cur.state === 'active' && mv) {
        if (mv.state === 'fault' || WAIT[mv.state]) now = `AG ${cur.seq} an ${cur.station} steht: ${msl(mv)} – ${causeCore(mv)}`;
        else now = `AG ${cur.seq} „${cur.op}“ an ${cur.station}${mv.state !== 'running' ? ' (' + msl(mv) + ')' : ''} · ${nm(cur.good + cur.scrap)}/${nm(cur.target)}${mv.etaOpEnd ? ' · fertig ca. ' + tc(mv.etaOpEnd) : ''}`;
      } else if (cur.state === 'external' && cur.ext) now = `AG ${cur.seq} ${cur.op}: ${cur.ext.returnText}`;
      else if (cur.state === 'waiting') now = `AG ${cur.seq} „${cur.op}“ wartet an ${cur.station}${cur.waiting ? ' · ' + stk(cur.waiting) + ' im Eingang' : ''}${fe && fe.start > c.t + 300 ? ' · Start ca. ' + tc(fe.start) : ''}`;
      else now = `nächster Schritt AG ${cur.seq} „${cur.op}“ an ${cur.station === 'EXT' ? 'Fremdbearbeitung' : cur.station}${fe ? ' ab ca. ' + tc(Math.max(c.t, fe.start)) : ''}`;
    }
    const ew = engineWhy(c, o);
    if (ew) return { now, bn: ew.cause };
    const dc = delayCauses(c, o);
    return { now, bn: dc && dc.main ? dc.main.text : o.bottleneck ? 'begrenzt durch ' + o.bottleneck : '' };
  }
  /** Ursachenkette als Satz (für Klartext, Übergabe, Claude) – Engine-Ursache zuerst (gleicher Wortlaut wie die Meldung) */
  function orderWhy(c, o) {
    const ew = engineWhy(c, o);
    if (ew) return `Ursache: ${ew.cause}.`;
    const dc = delayCauses(c, o);
    if (!dc || !dc.items.length) return o.bottleneck ? `Begrenzt durch ${o.bottleneck}.` : '';
    return 'Ursache laut Plantafel: ' + dc.items.map(x => x.text).join('; ') + '.';
  }
  /** kurze Ursache für Listen (Briefing, Übergabe): Engine-Ursache, sonst Hauptbeitrag der eigenen Kette */
  function whyShort(c, o) {
    const ew = engineWhy(c, o);
    if (ew) return ew.cause;
    const dc = delayCauses(c, o);
    return dc && dc.main ? dc.main.short : '';
  }
  /** Arbeitsplatz, an dem der Termin hängt (für „im Blick behalten“) – Engine (limit/bottleneckStation), sonst eigene Kette */
  function watchStation(c, o) {
    const ew = engineWhy(c, o);
    if (ew && ew.station) return ew.station;
    const dc = delayCauses(c, o);
    return dc && dc.main && dc.main.station ? dc.main.station : bnMachine(o);
  }
  // ================================================================== Ursache aus der Engine (eine Wahrheit)
  /** orderAdvice(id).cause / limit / delayBreakdown – derselbe Wortlaut wie die Meldung „Termin gefährdet“, die
      Leitstand-Karte und der Auftrags-Drawer. null, wenn die Engine (noch) keine Ursache liefert → eigene Kette. */
  const DLY = {
    queue: { l: 'Warten', c: 'var(--st-wait)' }, process: { l: 'Bearbeitung', c: 'var(--st-run)' }, ext: { l: 'Fremdbearbeitung', c: 'var(--ext)' },
    noShift: { l: 'außerhalb der Schicht', c: 'var(--st-idle)' }, fault: { l: 'Störung', c: 'var(--st-fault)' }, tool: { l: 'Werkzeug', c: 'var(--st-tool)' },
    material: { l: 'Material', c: 'var(--mat)' },
  };
  const DLY_ORDER = { queue: 0, noShift: 1, fault: 2, tool: 3, material: 4, process: 5, ext: 6 };
  function engineWhy(c, o) {
    if (!o || o.status === 'fertig' || !(WF.sim && typeof WF.sim.orderAdvice === 'function')) return null;
    const adv = simAdvice(o.id);
    if (!adv || adv.local || !adv.cause || adv.causeKind === 'done') return null;
    const bd = Array.isArray(adv.delayBreakdown) ? adv.delayBreakdown : Array.isArray(o.delayBreakdown) ? o.delayBreakdown : null;
    const all = (bd || []).filter(e => e && e.sec > 0);
    const lim = adv.limit || o.limit || null;
    const station = lim && lim.stationId && S().machines[lim.stationId] ? lim.stationId : adv.bottleneckStation || bnMachine(o);
    return { adv, cause: String(adv.cause).replace(/\.$/, ''), causeKind: adv.causeKind, all, total: all.reduce((x, e) => x + e.sec, 0), limit: lim, station };
  }
  /** Bezeichnung eines Verzugs-Beitrags ohne Dauer („Warten an M08 Liebherr LC 180 – hinter FA-24125, FA-24130“) */
  function dlyLabel(o, e) {
    const st = e.stationId && S().machines[e.stationId] ? mName(e.stationId) : null;
    const blk = (e.blockingOrders || []).slice(0, 2);
    switch (e.kind) {
      case 'queue': return `Warten an ${st || e.stationId}${blk.length ? ' – hinter ' + listJoin(blk) : ''}`;
      case 'process': return `Bearbeitung an ${st || e.stationId} (AG ${e.seq})`;
      case 'noShift': return `außerhalb der Schicht an ${st || e.stationId}`;
      case 'fault': return `Störung an ${st || e.stationId}`;
      case 'tool': return `Werkzeug an ${st || e.stationId}`;
      case 'material': return `Material für ${st || e.stationId}`;
      case 'ext': return String(e.text || 'Fremdbearbeitung').replace(/\s*\([^()]*\)\s*$/, '');
      default: return String(e.text || e.kind || '').replace(/\s*\([^()]*\)\s*$/, '');
    }
  }

  // ================================================================== Terminberatung (eine Regel für Meldung, Auftragsliste und Copilot)
  /** WF.sim.orderAdvice, sonst dieselbe Regel lokal: Eilauftrag nur, wenn er mindestens 15 min bringt und kein anderer
      Auftrag dadurch spät (bzw. später spät) wird – Was-wäre-wenn der Engine, ohne sie eine vorsichtige Schätzung. */
  let ADVC = { t: -1, m: {} };
  function simAdvice(orderId) {
    if (ADVC.t !== NOW()) ADVC = { t: NOW(), m: {} };
    if (orderId in ADVC.m) return ADVC.m[orderId];
    let r = null;
    if (WF.sim && typeof WF.sim.orderAdvice === 'function') {
      try { r = WF.sim.orderAdvice(orderId); } catch (e) { r = null; if (G.console) console.warn('[ai] orderAdvice', e); }
    }
    if (!r) r = fallbackAdvice(orderId);
    return (ADVC.m[orderId] = r);
  }
  function fallbackAdvice(orderId) {
    const c = data(), o = c.ov(orderId);
    if (!o) return null;
    const open = { label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id: o.id } };
    const base = { orderId: o.id, risk: o.risk, lateSec: o.eta != null ? o.eta - o.due : null, eta: o.eta, due: o.due, bottleneckStation: bnMachine(o) };
    if (o.status === 'fertig') return Object.assign(base, { cause: 'Auftrag fertig', causeKind: 'done', text: `${o.id} ist fertig (${o.shippedQty}/${o.qty} Stk).`, action: null, actionLabel: null, actions: [open], alternatives: [], sideEffects: [], whatIf: null });
    let wi = null;
    if (o.priority !== 'eil') {
      let w = null;
      if (typeof WF.sim.whatIfPriority === 'function') { try { w = WF.sim.whatIfPriority(o.id, 'eil'); } catch (e) { w = null; } }
      wi = w && w.ok ? { recommend: !!w.recommend, gainSec: w.gainSec || 0, newlyLate: w.newlyLate || [], laterLate: w.laterLate || [],
        side: (w.affected || []).filter(r => Math.abs(r.deltaSec) >= 300).map(r => ({ orderId: r.orderId, beforeT: r.before, afterT: r.after, lateBy: Math.max(0, r.after - r.due) })) } : localEilCheck(c, o);
    }
    const dc = delayCauses(c, o), main = dc && dc.main;
    const action = wi && wi.recommend ? { type: 'setPriority', orderId: o.id, priority: 'eil' } : null;
    const r = Object.assign(base, { local: true, cause: main ? main.text : slackTxt(o.slackSec), causeKind: main ? ({ wait: 'queue', run: 'bottleneck' }[main.kind] || main.kind) : null,
      action, actionLabel: action ? 'Als Eilauftrag' : null, actions: action ? [{ label: 'Als Eilauftrag', action }, open] : [open], alternatives: [],
      sideEffects: wi ? wi.side : [], whatIf: wi ? { recommend: wi.recommend, gainSec: wi.gainSec, newlyLate: wi.newlyLate, laterLate: wi.laterLate } : null });
    r.text = adviceText(c, o, r).text.replace(/\*\*/g, '');
    return r;
  }
  /** Schätzung ohne Was-wäre-wenn der Engine: überholbar sind nur eingeplante Arbeitsgänge, die erst starten, wenn die
      eigenen Teile schon da sind; die Überholten rutschen um die eigene Belegzeit nach hinten. */
  function localEilCheck(c, o) {
    const now = c.t, cand = [];
    for (const op of o.ops) {
      if (op.complete || !S().machines[op.station] || op.state === 'active') continue;
      const b = blockerOn(c, op.station, o.id, op.seq); if (!b || !b.queued.length) continue;
      const i = o.ops.indexOf(op), prev = i > 0 ? o.ops[i - 1] : null;
      const av = i <= 0 || op.waiting > 0 || !prev ? now : prev.complete || prev.inOutput > 0 ? now + 600 : (prev.firstOutT || now);
      const ov = b.queued.filter(e => e.start >= av - 300);
      if (ov.length) cand.push({ op, ov });
    }
    const none = { recommend: false, gainSec: 0, newlyLate: [], laterLate: [], side: [] };
    if (!cand.length) return none;
    const q = cand[0];
    const mine = (c.fc().machines[q.op.station] || []).find(e => e.orderId === o.id && e.seq === q.op.seq);
    const push = mine ? Math.max(0, mine.end - mine.start) : 0;
    const gain = q.ov.reduce((s, e) => s + Math.max(0, e.end - e.start), 0);
    const side = [], newlyLate = [], laterLate = [];
    for (const id of new Set(q.ov.map(e => e.orderId))) {
      const x = c.ov(id); if (!x || x.eta == null) continue;
      const after = x.eta + push;
      side.push({ orderId: id, beforeT: x.eta, afterT: after, lateBy: Math.max(0, after - x.due) });
      if (after > x.due) (x.eta > x.due ? laterLate : newlyLate).push(id);
    }
    return { recommend: gain >= 900 && !newlyLate.length && !laterLate.length, gainSec: gain, newlyLate, laterLate, side };
  }
  /** Empfehlung zu einem Auftrag: Eilauftrag nur nach der Engine-Regel, sonst der Hebel an der Hauptursache.
      → { text (Markdown), actions: [Aktionskarten], eilOk, main (Hauptursache), causes } */
  function adviceText(c, o, adv) {
    adv = adv || simAdvice(o.id) || {};
    if (!adv.local && adv.cause && adv.causeKind !== 'done') return engineAdviceText(c, o, adv);
    const dc = delayCauses(c, o), main = dc && dc.main;
    const late = o.slackSec != null && o.slackSec < 0, need = late ? -o.slackSec : 0;
    const wi = adv.whatIf, acts = [];
    const sideFx = (adv.sideEffects || []).filter(x => x.orderId !== o.id && Math.abs(x.afterT - x.beforeT) >= 300);
    const lateOf = (id) => { const x = sideFx.find(y => y.orderId === id); return x && x.lateBy > 0 ? `${id} würde ${durR(x.lateBy)} zu spät` : `${id} würde spät`; };
    const eilOk = !!(adv.action && adv.action.type === 'setPriority');
    let eil = '';
    if (o.priority === 'eil') eil = `${o.id} ist bereits Eilauftrag.`;
    else if (eilOk) {
      const g = wi && wi.gainSec ? wi.gainSec : 0;
      eil = `**${o.id} als Eilauftrag kennzeichnen:** fertig ca. ${tc(o.eta - g)} statt ${tc(o.eta)} (${deltaTxt(-g)}); kein anderer Auftrag wird dadurch spät${sideFx.length ? ' – später fertig werden ' + listJoin(sideFx.slice(0, 3).map(x => `${x.orderId} (${deltaTxt(x.afterT - x.beforeT)})`)) : ''}.`;
      acts.push({ label: `${o.id} als Eilauftrag`, desc: `Fertig ca. ${dueTxt(o.eta - g)} statt ${dueTxt(o.eta)} · Maschinen ziehen ihn beim nächsten Auftragswechsel vor`, action: adv.action, icon: 'bolt' });
    } else if (wi) {
      const hurt = (wi.newlyLate || []).concat(wi.laterLate || []);
      if (hurt.length) eil = `Kein Eilauftrag – er würde den Verzug nur verschieben: ${listJoin(hurt.slice(0, 2).map(lateOf))}.`;
      else if (!(wi.gainSec >= 60)) {
        const ws = dc ? dc.items.filter(x => x.kind === 'wait').map(x => x.station) : [];
        eil = `Ein Eilauftrag bringt nichts – ${ws.length ? listJoin(ws) + (ws.length === 1 ? ' ist' : ' sind') + ' schon belegt, bevor die Teile ankommen (laufende Arbeitsgänge werden nicht unterbrochen)' : 'vor ' + o.id + ' liegt nur laufende bzw. ohnehin früher fertige Arbeit'}.`;
      } else if (wi.gainSec < 900) eil = `Ein Eilauftrag brächte nur ${durR(wi.gainSec)}.`;
    }
    // Hebel an der Hauptursache – ein klarer Satz je Hebel
    const lev = [];
    if (adv.action && adv.action.type === 'moveOp') {
      const ac = adv.action, alt = (adv.alternatives || []).find(x => x.kind === 'moveOp' && x.action && x.action.stationId === ac.stationId);
      lev.push(`AG ${ac.seq} auf ${mName(ac.stationId)} verlagern${alt && alt.gainSec >= 60 ? ' – ' + durR(alt.gainSec) + ' früher fertig' : ''}`);
      acts.push({ label: `${o.id} AG ${ac.seq} auf ${ac.stationId} verlagern`, desc: `Dort wird neu gerüstet${alt && alt.gainSec >= 60 ? ' · ' + durR(alt.gainSec) + ' früher fertig' : ''}`, action: ac, icon: 'route' });
    }
    let watch = '';
    if (main) {
      const st = main.station;
      if (main.kind === 'stop' && main.mv) {
        const fi = faultInfo(main.mv);
        lev.push(fi ? `Störung an ${st} zuerst beheben – ${fi.working ? 'Reparatur läuft' : fi.person ? sn(fi.person.name) + ' ist unterwegs' : 'Instandhaltung hinschicken'}, Ende ca. ${clk(fi.endT)}` : waitAdvice(c, main.mv).replace(/\.$/, ''));
        watch = lev[lev.length - 1];
      } else if (main.kind === 'run' || main.kind === 'wait') {
        if (main.auto) watch = main.kind === 'wait' ? `${st} läuft auch unbemannt – Standzeit und Material sichern, damit die Warteschlange dort auch nachts weiterläuft` : `${st} läuft auch unbemannt – Standzeit und Material für die Nacht sichern`;
        else watch = main.kind === 'run' ? `${st} ohne Unterbrechung laufen lassen (${durR(main.sec)} Bearbeitung bis ca. ${tc(main.seg.end)}) – Pausenablösung, Störungen dort zuerst beheben` : `${st} ist bis ca. ${tc(main.seg.start)} belegt – Störungen dort zuerst beheben`;
        if (late && !main.auto) lev.push(need > 8 * 3600 ? `Überstunden allein holen ${durR(need)} nicht auf – am meisten bringt Zeit an ${st}` : `ca. ${durR(Math.max(900, Math.min(main.sec, need)))} Überstunden an ${st}`);
        else if (late) lev.push(watch);
      } else if (main.kind === 'ext') { watch = `Rücklauf aus der Fremdbearbeitung (ca. ${tc(main.seg ? main.seg.to : o.eta)}) – Lose pünktlich bereitstellen`; lev.push(`Expressdurchlauf bei ${main.partner} anfragen (${main.process})`); }
      else if (main.kind === 'material' && main.mv) { lev.push(waitAdvice(c, main.mv).replace(/\.$/, '')); watch = lev[lev.length - 1]; }
    }
    if (late) { const tl = `Teillieferung mit ${custShort(o.customer)} abstimmen`; if (need > 8 * 3600) lev.unshift(tl); else lev.push(tl); }
    let text;
    if (!late && o.slackSec != null) {
      if (eilOk && o.slackSec < 2 * 3600) text = `Termin hält knapp (${slackTxt(o.slackSec)}). Zur Absicherung: ${eil}`;
      else {
        text = `${o.slackSec < 2 * 3600 ? 'Termin hält, aber nur mit ' + slackTxt(o.slackSec) + ' – kein Eilauftrag nötig.' : 'Kein Eingriff nötig – ' + slackTxt(o.slackSec) + ' reicht.'}${watch ? ' Im Blick: ' + watch + '.' : ''}${wi && (wi.newlyLate || []).concat(wi.laterLate || []).length ? ' ' + eil : ''}`;
        const k = acts.findIndex(x => x.action && x.action.type === 'setPriority'); if (k >= 0) acts.splice(k, 1);
      }
    } else {
      text = [eil, lev.length ? (eilOk ? 'Außerdem: ' : 'Hebel: ') + lev.map(uc1).join('; ') + '.' : ''].filter(Boolean).join(' ');
    }
    const eilWhy = !eilOk && eil ? eil + (o.slackSec >= 0 ? ` Der Termin hält ohnehin (${slackTxt(o.slackSec)}).` : '') : '';
    return { text: text.replace(/\s+/g, ' ').trim(), eilWhy, actions: acts, eilOk, main, causes: dc };
  }
  /** Empfehlung aus orderAdvice der Engine – dieselbe Hauptmaßnahme wie Meldung und Auftrags-Drawer, ergänzt um die
      Begründung zum Eilauftrag (Was-wäre-wenn) und die übrigen tragfähigen Optionen. Aktionen: Eilauftrag bzw. Verlagern. */
  function engineAdviceText(c, o, adv) {
    const ew = engineWhy(c, o);
    const late = o.slackSec != null && o.slackSec < 0;
    const wi = adv.whatIf, acts = [];
    const sideFx = (adv.sideEffects || []).filter(x => x.orderId !== o.id && Math.abs(x.afterT - x.beforeT) >= 300);
    const eilOk = !!(adv.action && adv.action.type === 'setPriority');
    const pm = /Empfehlung:\s*(.*?)\.(?=\s+Weitere Optionen:|\s*$)/.exec(adv.detail || '') || /Empfehlung:\s*(.*?)\.?\s*$/.exec(adv.text || '');
    const primary = pm ? pm[1].trim() : '';
    const pa = (adv.alternatives || []).find(x => x.kind === 'priority');
    const why = o.priority === 'eil' ? `${o.id} ist bereits Eilauftrag.` : pa && pa.note ? pa.note : '';
    const others = (adv.alternatives || []).filter(x => x.ok && x.kind !== 'priority' && x.kind !== adv.primaryKind).map(x => x.text).slice(0, 2);
    let eil = '';
    if (eilOk) {
      const g = wi && wi.gainSec ? wi.gainSec : 0;
      eil = `**${o.id} als Eilauftrag kennzeichnen:** fertig ca. ${tc(o.eta - g)} statt ${tc(o.eta)} (${deltaTxt(-g)}); kein anderer Auftrag wird dadurch spät${sideFx.length ? ' – später fertig werden ' + listJoin(sideFx.slice(0, 3).map(x => `${x.orderId} (${deltaTxt(x.afterT - x.beforeT)})`)) : ''}.`;
      acts.push({ label: `${o.id} als Eilauftrag`, desc: `Fertig ca. ${dueTxt(o.eta - g)} statt ${dueTxt(o.eta)} · Maschinen ziehen ihn beim nächsten Auftragswechsel vor`, action: adv.action, icon: 'bolt' });
    }
    if (adv.action && adv.action.type === 'moveOp') {
      const ac = adv.action, alt = (adv.alternatives || []).find(x => x.kind === 'moveOp' && x.action && x.action.stationId === ac.stationId);
      acts.push({ label: `${o.id} AG ${ac.seq} auf ${ac.stationId} verlagern`, desc: `Dort wird neu gerüstet${alt && alt.gainSec >= 60 ? ' · ' + durR(alt.gainSec) + ' früher fertig' : ''}`, action: ac, icon: 'route' });
    } else if (adv.action && adv.action.type !== 'setPriority') {
      // weitere Hebel der Engine (Los teilen, Express, …) – Aktion wie in der Meldung „Termin gefährdet“
      const sig = JSON.stringify(adv.action), alt = (adv.alternatives || []).find(x => x.action && JSON.stringify(x.action) === sig);
      const ce = alt ? (alt.costEur != null ? alt.costEur : alt.cost) : null;
      acts.push({ label: `${o.id}: ${alt ? alt.label : adv.actionLabel || 'Hebel ausführen'}`, desc: [alt && alt.gainSec >= 60 ? durR(alt.gainSec) + ' früher fertig' : '', ce != null ? (ce > 0 ? 'ca. ' + eur(ce) : 'ohne Zusatzkosten') : '', alt && alt.addedLateSec > 0 ? 'ein anderer Auftrag wird ' + durR(alt.addedLateSec) + ' später spät' : ''].filter(Boolean).join(' · '), action: adv.action, icon: adv.action.type === 'expressExt' ? 'truck' : 'route' });
    }
    let text;
    if (!late && o.slackSec != null) {
      text = `${o.slackSec < 2 * 3600 ? 'Termin hält, aber nur mit ' + slackTxt(o.slackSec) + '.' : 'Kein Eingriff nötig – ' + slackTxt(o.slackSec) + ' reicht.'}${eilOk && o.slackSec < 2 * 3600 ? ' Zur Absicherung: ' + eil : primary ? ' Im Blick: ' + uc1(primary) + '.' : ''}`;
      if (!(eilOk && o.slackSec < 2 * 3600)) { const k = acts.findIndex(x => x.action && x.action.type === 'setPriority'); if (k >= 0) acts.splice(k, 1); }
    } else {
      text = [eilOk ? eil : primary ? `**${uc1(primary)}.**` : '', !eilOk && why ? why : '', others.length ? 'Weitere Optionen: ' + others.join('; ') + '.' : ''].filter(Boolean).join(' ') || 'Optionen im Copilot prüfen.';
    }
    const eilWhy = !eilOk && why ? why + (o.slackSec >= 0 ? ` Der Termin hält ohnehin (${slackTxt(o.slackSec)}).` : '') : '';
    const causes = ew ? { items: ew.all.filter(e => e.sec >= 900).sort((x, y) => y.sec - x.sec).slice(0, 4).map(e => ({ text: dlyLabel(o, e) + ' (' + durR(e.sec) + ')', station: e.stationId, kind: e.kind })), main: null } : null;
    return { text: text.replace(/\s+/g, ' ').trim(), eilWhy, actions: acts, eilOk, main: null, causes, engine: true, primary };
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
    // Stangen im Magazin des Langdrehautomaten sind bereits ausgebucht (offen ausgewiesen: Bedarf brutto – Magazin = netto)
    const gross = Object.assign({}, need), mag = {};
    for (const id in S().machines) {
      const m = S().machines[id];
      if (m.barMat && m.barStockM > 0 && need[m.barMat] != null) { (mag[m.barMat] = mag[m.barMat] || []).push({ machine: id, m: m.barStockM }); need[m.barMat] = Math.max(0, need[m.barMat] - m.barStockM); }
    }
    return { need, users, gross, mag };
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
  /** geplante Werkzeugwechsel aller Maschinen (eine Zeile je Maschine und Teilegrenze). action 'index' = nur Schneide
      wenden (Bediener:in an der Maschine, 1–2 min, kein Einrichter); 'replace' = Werkzeug tauschen (Einrichter:in) */
  function plannedChanges(c, untilT) {
    const out = [];
    for (const mv of c.mvs()) {
      const groups = {};
      for (const t of mv.tools || []) {
        const pc = t.plannedChange; if (!pc || pc.etaT == null) continue;
        if (untilT != null && pc.etaT > untilT) continue;
        const key = pc.afterPart + '|' + pc.etaT;
        const g = groups[key] || (groups[key] = { machine: mv.id, mv, t: pc.etaT, afterPart: pc.afterPart, tools: [], by: pc.by, stage: pc.stage, waitFromT: pc.waitFromT, manual: pc.manual, note: pc.note, text: pc.text, index: true });
        g.tools.push(t);
        if (pc.manual) g.manual = true;
        if (pc.action !== 'index') g.index = false;
      }
      for (const k in groups) out.push(groups[k]);
    }
    return out.sort((a, b) => a.t - b.t);
  }
  const chgVerb = (g) => (g.index ? 'Schneide wenden' : 'Werkzeugwechsel');
  /** Wer erledigt einen geplanten Wechsel: Wenden = Bediener:in der Maschine, Tauschen = zugeteilte Einrichter:in */
  function chgWho(g, staffed) {
    if (g.index) { const op = g.mv && g.mv.operator; return 'Bediener:in' + (op ? ' ' + sn(op.name) : '') + ' an der Maschine, 1–2 min'; }
    if (g.by) return sn(g.by) + (g.stage && g.stage !== 'offen' ? ', ' + g.stage : '');
    if (g.stage === 'später') return 'wird rechtzeitig angekündigt';
    if (g.stage === 'Werkzeug liegt bereit') return 'Werkzeug liegt bereit';
    return staffed ? 'Einrichter:in noch nicht zugeteilt' : 'mit der nächsten Schicht';
  }
  /** Wechselplan wie die Werkzeuge-Ansicht (WF.tools.model): angekündigte Wechsel der Engine („geplant“) und die dort
      hochgerechneten („voraussichtlich“) mit denselben Uhrzeiten. Ohne die Ansicht nur der Engine-Plan. */
  function toolPlan(c, untilT, opt) {
    opt = opt || {};
    const rows = [];
    let m = null;
    if (WF.tools && typeof WF.tools.model === 'function') { try { m = WF.tools.model(); } catch (e) { m = null; } }
    const eng = plannedChanges(c, untilT);
    if (!m) return eng.map(g => Object.assign({ kind: 'plan' }, g));
    for (const mx of m.machines) {
      if (opt.machine && mx.id !== opt.machine) continue;
      for (const g of mx.groups) {
        if (g.t == null || g.t > untilT) continue;
        const e = eng.find(x => x.machine === mx.id && x.afterPart === g.afterPart) || null;
        rows.push(Object.assign({ kind: 'plan' }, e || { machine: mx.id, mv: c.mv(mx.id), t: g.t, afterPart: g.afterPart, tools: g.tools, by: g.by, stage: g.stage, waitFromT: g.waitFromT, index: g.tools.every(x => x.plannedChange && x.plannedChange.action === 'index') }));
      }
      for (const p of mx.proj) {
        if (p.t == null || p.t > untilT || (opt.onlyProj && p.kind !== 'proj')) continue;
        rows.push({ kind: 'proj', next: p.kind === 'next', machine: mx.id, mv: c.mv(mx.id), t: p.t, afterPart: p.afterPart, tools: p.members.map(mb => mb.s.tx), bundled: p.members.filter(mb => mb.bundled).length, by: null, stage: null, waitFromT: p.waitFromT, index: !!p.index });
      }
    }
    if (opt.machine) for (const g of eng) if (g.machine === opt.machine && !rows.some(r => r.kind === 'plan' && r.afterPart === g.afterPart)) rows.push(Object.assign({ kind: 'plan' }, g));
    return rows.sort((a, b) => a.t - b.t);
  }
  /** Kennzahl wie die Werkzeuge-Ansicht: geplante Werkzeuge in 2 h + voraussichtliche Wechsel (WF.tools.summary) */
  function toolSummary() { if (WF.tools && typeof WF.tools.summary === 'function') { try { return WF.tools.summary(); } catch (e) { return null; } } return null; }
  /** Verlust je Ursache (€ und Zeit) – exakt die Engine-Werte, die auch die Analyse zeigt (ENGINE_API §2):
      € = machineView.lossByState[Zustand], Zeit = plannedStateTimes[Zustand] (Schichtzeit ohne Pausen, autonome Maschinen
      auch in der Geisterschicht). Σ je Maschine = lossEurToday, Σ Werk = kpis().lossEur. Ältere Engine: anteilig nach Zustandsband. */
  function lossByCause(c) {
    const t = c.t, d0 = Math.floor(t / DAY) * DAY, k = c.k();
    // nach einer Nacht wie Leitstand und Analyse: Ursachen = Schichtzeit (Tag − Nachtanteil), die Nacht als eigener Posten
    const split = lossHead(k).split;
    const byCause = {}, byMachine = [], bySec = {}, byN = {}, nightBy = {}, nightSec = {}, nightM = [];
    for (const mv of c.mvs()) {
      let causes, nightLoss = 0;
      if (mv.lossByState) {
        const ps = mv.plannedStateTimes || {}, raw = S().machines[mv.id], perSec = (mv.rate || 0) / 3600;
        const kn = split && raw && raw.kn && typeof raw.kn.lossEur === 'number' && raw.kn.lossEurBy ? raw.kn : null;
        nightLoss = kn ? kn.lossEur : split && typeof mv.lossEurNightToday === 'number' ? mv.lossEurNightToday : 0;
        causes = [];
        for (const st of Object.keys(mv.lossByState)) {
          if (st === 'running' || st === 'idle') continue;
          const nE = kn ? kn.lossEurBy[st] || 0 : 0, e = mv.lossByState[st] - nE;
          if (nE > 0.005) { nightBy[st] = (nightBy[st] || 0) + nE; nightSec[st] = (nightSec[st] || 0) + (perSec > 0 ? nE / perSec : 0); }
          if (e > 0.005) causes.push({ state: st, eur: e, sec: Math.max(0, (ps[st] || 0) - (perSec > 0 ? nE / perSec : 0)) });
        }
      } else {
        const sec = {}; let tot = 0;
        for (const sg of mv.segments || []) {
          if (LOSS_STATES.indexOf(sg.state) < 0) continue;
          const a = Math.max(d0, sg.t0), b = Math.min(t, sg.t1 == null ? t : sg.t1);
          if (b <= a) continue;
          const w = workBetween(a, b); if (w <= 0) continue;
          sec[sg.state] = (sec[sg.state] || 0) + w; tot += w;
        }
        causes = Object.keys(sec).map(x => ({ state: x, sec: sec[x], eur: tot > 0 ? (mv.lossEurToday || 0) * sec[x] / tot : 0 }));
      }
      const loss = Math.max(0, (mv.lossEurToday || 0) - nightLoss);
      causes.sort((a, b) => b.eur - a.eur);
      for (const x of causes) { byCause[x.state] = (byCause[x.state] || 0) + x.eur; bySec[x.state] = (bySec[x.state] || 0) + x.sec; byN[x.state] = (byN[x.state] || 0) + 1; }
      byMachine.push({ mv, loss, causes, lossSec: causes.reduce((s2, x) => s2 + x.sec, 0), night: nightLoss });
      if (nightLoss >= 0.5) nightM.push({ mv, eur: nightLoss });
    }
    byMachine.sort((a, b) => b.loss - a.loss);
    nightM.sort((a, b) => b.eur - a.eur);
    const causes = Object.keys(byCause).map(x => ({ state: x, eur: byCause[x], sec: bySec[x], machines: byN[x] })).sort((a, b) => b.eur - a.eur);
    const nightCauses = Object.keys(nightBy).map(x => ({ state: x, eur: nightBy[x], sec: nightSec[x] })).sort((a, b) => b.eur - a.eur);
    const total = causes.reduce((s2, x) => s2 + x.eur, 0), nightTotal = nightCauses.reduce((s2, x) => s2 + x.eur, 0);
    // Selbstprüfung: Ursachen + Nacht = Stillstandskosten des Werks (±1 €)
    const check = k.lossEur == null || Math.abs(total + nightTotal - k.lossEur) <= 1;
    if (!check && G.console && !lossByCause.warned) { lossByCause.warned = true; console.warn('[ai] Verlust je Ursache ≠ kpis().lossEur', Math.round(total + nightTotal), k.lossEur); }
    return { byMachine, causes, total, check, split, nightCauses, nightTotal, nightMachines: nightM };
  }
  // dieselben Bezeichnungen wie die Analyse (Zustandsnamen der Engine)
  const CAUSE_LABEL = { setup: 'Rüsten', firstPiece: 'Erstteilprüfung', toolchange: 'Werkzeugwechsel', waitTool: 'Wartet auf Werkzeug', waitOperator: 'Wartet auf Bediener', starved: 'Wartet auf Material', blocked: 'Ausgang voll', fault: 'Störung' };
  const causeLabel = (k) => CAUSE_LABEL[k] || stLabel(k);
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
  /** Empfehlung je Verlustursache; Werkzeug-Stopps aus der Geisterschicht bekommen den Nacht-Hebel (vorbeugend vor Schichtende) */
  function causeAdvice(state, k) {
    const g = k && k.ghostLastNight;
    if ((state === 'waitTool' || state === 'starved') && ((k && k.lossEurNightToday >= 1) || (g && (g.stopped || []).some(x => x.state === state))))
      return state === 'waitTool' ? 'Die Werkzeug-Stopps entstanden vor allem in der Geisterschicht: vor Schichtende vorbeugend wechseln bzw. Schneiden wenden – der Geisterschicht-Check schlägt die Zeitpunkte vor.'
        : 'Die Material-Stopps entstanden vor allem in der Geisterschicht: Stangenmagazine und Eingangspuffer der autonomen Maschinen vor Schichtende auffüllen.';
    return CAUSE_ADVICE[state] || '';
  }
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
  /** „≈ 3,2 Tage bei zwei Schichten“ bzw. „≈ 1,7 Tage rund um die Uhr“ (autonome Maschine) */
  const daysOf = (x) => '≈ ' + daysTxt(x.days) + (x.auto ? ' rund um die Uhr' : ' bei zwei Schichten');
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
  // Umlaute wie im Alias-Wörterbuch (ä → ae), übrige diakritische Zeichen weg (Petrović → petrovic)
  const norm = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/ø/g, 'o')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[„“”"'?!]/g, ' ').replace(/\s+/g, ' ').trim();
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
  /** Gattungsbegriffe → alle passenden Arbeitsplätze (Antwort dann als Vergleich) */
  const TYPE_ALIAS = [
    ['fraese', ['M05', 'M06']], ['fraesen', ['M05', 'M06']], ['fraesmaschine*', ['M05', 'M06']], ['fraeszentr*', ['M05', 'M06']], ['bearbeitungszentr*', ['M05', 'M06']],
    ['schleifmaschine*', ['M09', 'M10']], ['schleifmaschinen', ['M09', 'M10']],
    ['drehmaschine*', ['M02', 'M03', 'M04']], ['drehbank', ['M02', 'M03', 'M04']], ['drehzentr*', ['M02', 'M03', 'M04']], ['drehautomat*', ['M02', 'M03', 'M04']],
    ['waschmaschine*', ['M11']], ['bohrmaschine*', ['M07']], ['messmaschine*', ['QS']], ['wellendrehmaschine*', ['M04']],
  ];
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
    // klein geschrieben und einstellig („m5“) nur am Satzanfang oder vor Zustandswörtern – sonst ist „m2 z38“ ein Modul
    const STATUSW = /^\s*(status|zustand|los|gerade|jetzt|laeuft|läuft|steht|wartet|macht|oee|werkzeug|stoerung|störung|\?|$)/i;
    while ((m = reM.exec(raw))) {
      if (m[3].length === 1 && m[2] !== 'M' && !(m.index === 0 || /^\s*$/.test(raw.slice(0, m.index + m[1].length)) || STATUSW.test(raw.slice(m.index + m[0].length)))) continue;
      const id = 'M' + m[3].padStart(2, '0'); if (st.machines[id]) add(E.machines, id);
    }
    // Aliase auch auf die getrennte Schreibweise prüfen („dmu65“ → „dmu 65“)
    const qSplit = q.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
    for (const id in MACHINE_ALIAS) for (const a of MACHINE_ALIAS[id]) if (hasWord(q, a) || (qSplit !== q && hasWord(qSplit, a))) { if (a === 'qs' && /qs-|qs pruef/.test(q)) continue; add(E.machines, id); break; }
    // „Maschine 7“, „Nr. 7“, „Platz 7“ → M07
    const reN = /\b(maschine|maschinen?nummer|nr\.?|nummer|platz|arbeitsplatz|anlage)\s*(\d{1,2})\b/g;
    while ((m = reN.exec(q))) { const id = 'M' + m[2].padStart(2, '0'); if (st.machines[id]) add(E.machines, id); }
    // Gattungsbegriffe („die Fräse“, „Schleifmaschine“) – nur, wenn keine Maschine ausdrücklich genannt ist
    if (!E.machines.length) for (const [w, ids] of TYPE_ALIAS) if (hasWord(q, w)) { for (const id of ids) if (st.machines[id]) add(E.machines, id); E.typeWord = w.replace('*', ''); break; }
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
    if (/42crmo4/.test(q) && !E.materials.some(x => x.indexOf('42CR') >= 0)) {
      // Abmessung entscheidet (Ø65 / 65 mm / 110) – nur ohne Angabe beide Stangen
      if (/(^|[^0-9])(o\s?)?65([^0-9]|$)/.test(q)) add(E.materials, 'MAT-42CR65');
      else if (/(^|[^0-9])(o\s?)?110([^0-9]|$)/.test(q)) add(E.materials, 'MAT-42CR110');
      else { add(E.materials, 'MAT-42CR110'); add(E.materials, 'MAT-42CR65'); }
    }
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
  /** Antwort: Kopf (eyebrow, head, sev), Kennzahlen (stats), Text (md), Empfehlung (rec + actions), Datenbasis (sources) */
  function A(kind) { return { kind, eyebrow: null, head: null, sev: null, md: [], stats: null, rec: null, sources: [], actions: [], followups: [], impact: null, entity: null, slots: null }; }
  /** Platzhalter „\u0005name“ im Markdown = grafischer Block (z. B. Arbeitsgang-Kette); a.text enthält stattdessen den Klartext */
  const SLOT = (a, name, text, data) => { (a.slots = a.slots || {})[name] = { text, data }; a.md.push('\u0005' + name); };
  const REC_RE = /^>\s*\*\*(Empfehlung|Einschätzung|Hinweis|Jetzt tun):\*\*\s*(.*)$/;
  const done = (a) => {
    // Empfehlung als eigener Block (mit den Aktionen), Überschrift aus einer reinen Fett-Zeile am Anfang
    const body = [];
    for (const l of a.md) { const m = REC_RE.exec(l); if (m && !a.rec) a.rec = { label: m[1], text: m[2] }; else body.push(l); }
    if (!a.head) {
      const k = body.findIndex(l => l.trim()), m = k >= 0 ? /^\*\*([^*]{6,}?)\*\*(.*)$/.exec(body[k].trim()) : null;
      if (m) {
        a.head = m[1].replace(/[.:]$/, '');
        const rest = m[2].replace(/^[\s:.,;–-]+/, '').trim();
        if (rest && rest !== '.') body[k] = uc1(rest); else body.splice(k, 1);
      }
    }
    const j = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    a.display = j;
    const plain = (a.slots ? j.replace(/\u0005(\w+)/g, (_, k) => (a.slots[k] ? a.slots[k].text : '')) : j.replace(/\u0005\w+/g, '')).replace(/\n{3,}/g, '\n\n').trim();
    a.body = plain;
    a.text = [a.head ? '**' + a.head + '**' : '', plain, a.rec ? '> **' + a.rec.label + ':** ' + a.rec.text : ''].filter(Boolean).join('\n\n');
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
    const oh = oeeHead(k), lh = lossHead(k);
    const oeeTxt = oh.v != null ? `${oh.staffed ? 'OEE der Schichten heute' : 'OEE heute'} **${pct(oh.v, 1)}** – ${oh.v >= TARGET_OEE ? 'über' : 'unter'} dem Ziel von ${pct(TARGET_OEE)}${oh.staffed ? ` (ganzer Tag inkl. Geisterschicht ${pct(oh.day, 1)})` : ''}` : 'noch keine OEE-Bezugszeit heute';
    const prodV = prod.length === 1 ? 'produziert' : 'produzieren';
    const runTxt = sh.id ? `${prod.length} von ${mvs.length} Arbeitsplätzen ${prodV}` : prod.length ? `${prod.length} von ${mvs.length} Arbeitsplätzen ${prodV} unbemannt` : 'kein Arbeitsplatz produziert';
    a.eyebrow = `Lage · ${shName} · ${WF.sim.clock()}`;
    a.sev = faults.length ? 'crit' : late.length || waits.some(m => m.sinceSec >= 600) ? 'warn' : 'ok';
    a.head = faults.length ? `Störung an ${listJoin(faults.map(m => m.id))} – ${runTxt}` : late.length ? `${uc1(runTxt)} – ${pl(late.length, 'Termin', 'Termine')} verspätet` : `${uc1(runTxt)}, Termine im Plan`;
    a.md.push(`${oeeTxt}${sh.id ? '' : '; Frühschicht ab ' + dueTxt(sh.endsAt)}.`);
    const gl = ghostNightTxt(k);
    if (gl) a.md.push(gl);
    a.stats = [
      oeeStat(oh.v, oh.staffed ? 'Tag inkl. Nacht ' + pct(oh.day, 1) : sh.id && k.oeeShift != null ? 'Schicht ' + pct(k.oeeShift, 1) : 'Ziel ' + pct(TARGET_OEE), null, oh.staffed ? 'OEE · Schichten' : null),
      { l: 'Fertige Teile', v: nm(k.goodFinished), s: nm(k.good) + ' Arbeitsgänge gut' },
      { l: 'Termintreue', v: pct(k.onTimePct), s: late.length + ' spät · ' + tight.length + ' knapp', c: late.length ? 'warn' : 'ok' },
      { l: 'Stillstand', v: eur(lh.value), s: lh.split ? 'Schicht · Nacht ' + eur(lh.night) : 'Kosten heute', c: 'info' },
    ];
    a.md.push('');
    for (const m of faults) { const fi = faultInfo(m); a.md.push(`- **Störung ${mName(m.id)}** seit ${clk(m.since)}: ${m.fault.code} ${m.fault.text} – ${fi.who}.`); }
    const waitsS = waits.filter(m => !noStaff(m)), waitsNS = waits.filter(noStaff);
    for (const m of waitsS.slice(0, 3)) a.md.push(`- **${mName(m.id)}** ${lc1(msl(m))} seit ${durR(m.sinceSec)}: ${m.cause}.`);
    if (waitsS.length > 3) a.md.push(`- Weitere wartende Arbeitsplätze: ${waitsS.slice(3).map(m => m.id).join(', ')}.`);
    a.md.push(...groupNoStaff(waitsNS));
    if (setups.length) a.md.push(`- ${setups.length === 1 ? 'Rüsten/Prüfen' : setups.length + ' Arbeitsplätze rüsten/prüfen'}: ${setups.map(m => `${mName(m.id)} (${msl(m)}${m.order ? ', ' + m.order.id : ''})`).join('; ')}.`);
    if (idle.length) {
      const idleTxt = (m) => `${mName(m.id)} – ${String(m.cause).replace(/^Frei\s*[–-]\s*/i, '')}`;
      a.md.push(idle.length <= 2 ? `- Ohne laufenden Auftrag: ${idle.map(idleTxt).join('; ')}.` : `- Ohne laufenden Auftrag: ${idle.map(m => m.id).join(', ')} – als Nächstes ${idle.filter(m => /ca\. \d/.test(m.cause)).slice(0, 2).map(idleTxt).join('; ') || 'Vorgänger noch in Arbeit bzw. nichts eingeplant'}.`);
    }
    if (late.length || tight.length) {
      const lt = late.map(o => `**${o.id}** ${dur0(-o.slackSec)} zu spät`).concat(tight.slice(0, 3).map(o => `${o.id} nur ${dur0(o.slackSec)} Puffer`));
      a.md.push(`- Termine: ${lt.join(', ')}.`);
    } else a.md.push(`- Termine: alle ${open.length} offenen Aufträge im Plan.`);
    const ch = plannedChanges(c, c.t + 2 * 3600);
    if (ch.length) a.md.push(`- Werkzeugwechsel bis ${clk(c.t + 7200)}: ${ch.length} geplant – als Nächstes ${clk(ch[0].t)} an ${mName(ch[0].machine)}: ${chgVerb(ch[0])} ${toolShort(ch[0].tools[0].name)}${ch[0].tools.length > 1 ? ' +' + (ch[0].tools.length - 1) : ''}${ch[0].index ? ' (Bediener:in, 1–2 min)' : ''}.`);
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min);
    if (low.length) a.md.push(`- Material unter Mindestbestand: ${low.map(mt => `${mt.name} (${matQty(mt, mt.onHand)}${mt.onOrder ? ', bestellt' : ', nicht bestellt'})`).join('; ')}.`);
    if (people.length) {
      const pc = crewCounts(people);
      a.md.push(`- Personal: ${people.length} im Dienst – ${pc.txt}.`);
    } else a.md.push(`- Personal: niemand im Dienst – autonome Maschinen laufen weiter, solange Material und Standzeit reichen.`);
    a.md.push(`- Qualität: ${nm(k.scrap)} Ausschuss, FPY ${pct(k.fpy, 1)}.`);
    // Empfehlung: das Wichtigste zuerst (dieselbe Rangfolge wie „Was muss ich jetzt tun?“)
    const todo = todoList(c);
    let rec;
    if (!sh.id && morningPlan(c)) rec = morningPlan(c);
    else if (todo.length) {
      rec = todo[0].text + (todo[1] ? ` Danach: ${todo[1].short || todo[1].text}` : '');
      for (const x of todo.slice(0, 2)) for (const ac of x.actions || []) addAction(a, ac);
    } else if (ch.length) rec = `Keine akuten Eingriffe nötig. Nächster Fokus: ${ch[0].index ? 'Schneide wenden' : 'Werkzeugwechsel'} ${clk(ch[0].t)} an ${mName(ch[0].machine)}${ch[0].index ? ' (Bediener:in)' : ' vorbereiten'}.`;
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
      if (/passt nicht mehr vor Schichtende|übernimmt ab/.test(mv.cause || '')) return `${mv.id} wird mit der nächsten Schicht gerüstet – das Rüsten würde über das Schichtende reichen; kein Eingriff nötig.`;
      if (ns) return `${mName(mv.id)} wartet auf Bedienung bis zum ${startTxt} – dort zuerst einlegen lassen${mv.order ? ' (' + mv.order.id + ')' : ''}.`;
      const free = freePeopleFor(mv.id);
      const fd = free.length ? pDisp(free[0]) : null;
      return free.length ? (fd.key === 'idle' ? `${sn(free[0].name)} (${free[0].role}) ist verfügbar und für ${mv.id} qualifiziert – dorthin schicken.` : `${sn(free[0].name)} (${free[0].role}) ${lc1(fd.label)} und ist für ${mv.id} qualifiziert – kann dort mit einlegen.`) : `Niemand mit passender Qualifikation ist frei – Pausen versetzen, Mehrmaschinenbedienung neu verteilen oder Einrichter:in als Springer einsetzen.`;
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
    return steps.length ? `Zum Schichtbeginn ${clk(sh.endsAt)}: ${steps.length === 1 ? steps[0] : steps.map((x, i) => (i + 1) + ') ' + x).join('; ')}.` : null;
  }
  /** „Jetzt tun“: konkrete Eingriffe, wichtigste zuerst – je Punkt Text (Handlung zuerst, ID vorn), kurze Fassung,
      Bezug und optionale Aktion. Eine Rangfolge für Lage, Briefing, Übergabe und „Was muss ich jetzt tun?“. */
  function todoList(c) {
    const out = [], sh = WF.sim.shift(), mvs = c.mvs();
    const push = (x) => { if (!out.some(y => y.key === x.key)) out.push(x); };
    for (const m of mvs.filter(x => x.state === 'fault')) {
      const fi = faultInfo(m), hit = affectedOrders(c, m.id).filter(x => x.o.risk !== 'ok');
      push({ key: 'fault:' + m.id, rank: 0, sev: 'crit', t: fi.endT, entity: { kind: 'machine', id: m.id },
        text: `${m.id}: Störung ${m.fault.code} beheben – ${fi.working ? 'Reparatur läuft (' + sn(fi.person.name) + ')' : fi.person ? sn(fi.person.name) + ' ist unterwegs' : 'Instandhaltung hinschicken'}, Ende ca. ${clk(fi.endT)}${hit.length ? '; betroffen: ' + listJoin(hit.slice(0, 2).map(x => x.o.id)) : ''}.`,
        short: `Störung an ${m.id} beheben.`, actions: m.fault.manual ? [{ label: `Störung an ${m.id} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort.', action: { type: 'repair', machineId: m.id }, icon: 'wrench' }] : [] });
    }
    for (const m of mvs.filter(x => WAIT[x.state] && x.sinceSec >= 300 && !noStaff(x)).sort((x, y) => y.sinceSec - x.sinceSec).slice(0, 2)) {
      push({ key: 'wait:' + m.id, rank: 1, sev: 'warn', entity: { kind: 'machine', id: m.id }, text: `${m.id}: ${waitAdvice(c, m)}`, short: `${m.id} wieder anlaufen lassen (${lc1(msl(m))}).` });
    }
    const open = c.open().filter(o => o.eta != null);
    for (const o of open.filter(x => x.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec).slice(0, 2)) {
      const adv = adviceText(c, o);
      push({ key: 'late:' + o.id, rank: 2, sev: 'warn', entity: { kind: 'order', id: o.id }, text: `${o.id} (${durR(-o.slackSec)} Verzug): ${adv.text}`, short: `${o.id}: ${adv.eilOk ? 'als Eilauftrag kennzeichnen' : adv.primary ? adv.primary.replace(/\s*\([^()]*\)$/, '') : /Teillieferung/.test(adv.text) ? 'Teillieferung mit ' + custShort(o.customer) + ' klären' : 'Hebel prüfen'}.`, actions: adv.actions });
    }
    if (sh.id) {
      // nur echte Werkzeugwechsel ohne Einrichter:in – Schneide wenden erledigt die Bediener:in an der Maschine
      for (const g of plannedChanges(c, c.t + 3600).filter(x => !x.index && !x.by && x.stage !== 'später').slice(0, 1)) {
        const ready = g.stage === 'Werkzeug liegt bereit';
        push({ key: 'tool:' + g.machine, rank: 3, sev: 'tool', t: g.t, entity: { kind: 'machine', id: g.machine }, text: `${g.machine}: Einrichter:in für den Werkzeugwechsel ca. ${clk(g.t)} einplanen (${g.tools.map(x => toolShort(x.name)).join(' + ')}) – ${ready ? 'Werkzeug liegt bereit, ' : ''}noch niemand zugeteilt.`, short: `Werkzeugwechsel ${g.machine} ${clk(g.t)} besetzen.` });
      }
    }
    for (const n of c.notifs().filter(x => x.status !== 'resolved' && String(x.key).indexOf('spc:') === 0).slice(0, 1)) {
      const ax = (n.actions || []).find(x => x.action.type === 'applyOffset'), mid = n.spc ? n.spc.machineId : n.entity && n.entity.id;
      push({ key: 'spc:' + mid, rank: 4, sev: 'warn', entity: mid ? { kind: 'machine', id: mid } : null, text: `${mid}: SPC-Korrektur übernehmen – das Maß läuft zur Toleranzgrenze.`, short: `SPC-Korrektur an ${mid}.`, actions: ax ? [{ label: `${ax.label} (${mid})`, desc: n.suggestion, action: ax.action, icon: 'gauge' }] : [] });
    }
    for (const m of mvs.filter(x => x.fpi && x.fpi.waitingSec >= 600).slice(0, 1)) push({ key: 'fpi:' + m.id, rank: 4, sev: 'warn', entity: { kind: 'machine', id: m.id }, text: `${m.id}: Erstteil prüfen – die Maschine steht seit ${durR(m.fpi.waitingSec)} bis zur Freigabe.`, short: `Erstteil ${m.id} prüfen.` });
    for (const mt of Object.values(S().materials).filter(x => x.onHand < x.min && !x.onOrder).slice(0, 1)) push({ key: 'mat:' + mt.id, rank: 5, sev: 'warn', entity: { kind: 'material', id: mt.id }, text: `${mt.name} nachbestellen – ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}), nicht bestellt.`, short: `${mt.name} nachbestellen.`, actions: [reorderAction(mt)] });
    for (const n of c.notifs().filter(x => x.status === 'open' && String(x.key).indexOf('ghost:') === 0 && sh.id && sh.endsAt - c.t <= 3 * 3600).slice(0, 1)) {
      const ga = (n.actions || []).find(x => x.action.type === 'planToolChange'), mid = n.entity && n.entity.id;
      push({ key: 'ghost:' + mid, rank: 5, sev: 'warn', entity: mid ? { kind: 'machine', id: mid } : null, text: `${mid}: vor Schichtende vorbeugend Werkzeug wechseln – sonst steht die Maschine in der Geisterschicht.`, short: `Vorbeugender Wechsel an ${mid}.`, actions: ga ? [{ label: `${ga.label} (${mid})`, desc: n.suggestion, action: ga.action, icon: 'wrench' }] : [] });
    }
    return out.sort((x, y) => x.rank - y.rank);
  }
  function freePeopleFor(mid) {
    const st = station(mid), skill = st && st.skill;
    const ok = Object.values(S().people).filter(p => p.onDuty && !p.endShift && p.state === 'idle' && !p.task && (p.machines.indexOf(mid) >= 0 || (skill && p.skills.indexOf(skill) >= 0)));
    // verfügbar (wie die Personalansicht) zuerst, dann wer nur die eigenen laufenden Maschinen betreut
    return ok.sort((a, b) => (pDisp(a).key === 'idle' ? 0 : 1) - (pDisp(b).key === 'idle' ? 0 : 1));
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
    a.eyebrow = 'Termine' + (customer ? ' · ' + custShort(customer) : '') + ' · ' + pl(open.length, 'offener Auftrag', 'offene Aufträge');
    if (!late.length && !tight.length) {
      const min = open.slice().sort((x, y) => x.slackSec - y.slackSec)[0];
      a.sev = 'ok';
      a.head = `Alle ${open.length} offenen Aufträge ${scope} liegen im Plan`.replace(/\s+/g, ' ');
      a.md.push('Puffer überall mehr als 4 h.');
      if (min) a.md.push('', `Geringster Puffer: **${min.id}** ${min.part.name} (${custShort(min.customer)}) – Prognose ${dueTxt(min.eta)}, Termin ${dueTxt(min.due)}, ${slackTxt(min.slackSec)}.`);
      a.md.push('', '> **Empfehlung:** Keine Termin-Maßnahme nötig. Engpass im Blick behalten – „Was ist der Engpass?“ zeigt, wo die nächste Verzögerung entstehen würde.');
    } else {
      a.sev = late.length ? 'warn' : 'info';
      a.head = `${late.length ? pl(late.length, 'Auftrag', 'Aufträge') + ' verspätet' : 'Kein Auftrag verspätet'}${tight.length ? ', ' + nm(tight.length) + ' knapp' : ''}`;
      a.md.push(`Knapp = weniger als 4 h Puffer bis zum Liefertermin; von ${open.length} offenen Aufträgen${scope ? ' ' + scope : ''}.`, '');
      a.stats = [
        { l: 'Verspätet', v: nm(late.length), s: late[0] ? late[0].id + ' · ' + durR(-late[0].slackSec) : 'kein Auftrag', c: late.length ? 'crit' : 'ok' },
        { l: 'Knapp', v: nm(tight.length), s: tight[0] ? tight[0].id + ' · ' + slackTxt(tight[0].slackSec) : 'kein Auftrag', c: tight.length ? 'warn' : 'ok' },
        { l: 'Im Plan', v: nm(open.length - late.length - tight.length), s: 'Puffer > 4 h', c: 'ok' },
      ];
      const lines = late.map(o => `- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)} → **${durR(-o.slackSec)} Verzug**${o.priority === 'eil' ? ' (bereits Eilauftrag)' : ''}. ${orderWhy(c, o)}`)
        .concat(tight.map(o => `- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)} – nur **${slackTxt(o.slackSec)}**. ${orderWhy(c, o)}`));
      SLOT(a, 'risk', lines.join('\n'), late.concat(tight).map(o => Object.assign({ id: o.id, part: o.part.name, cust: custShort(o.customer), late: o.slackSec < 0, slack: o.slackSec, eta: dueTxt(o.eta) + (o.etaNew ? ' (neu gerechnet)' : ''), due: dueTxt(o.due), eil: o.priority === 'eil' }, orderWhyParts(c, o))));
      const recs = [];
      if (late.length) { const adv = adviceText(c, late[0]); recs.push(`${late[0].id}: ${adv.text}`); for (const x of adv.actions) addAction(a, x); }
      if (tight.length) {
        const watch = tight.map(o => watchStation(c, o)).filter(Boolean);
        const bms = [...new Set(watch)];
        recs.push(`${listJoin(tight.map(o => o.id))}: ${tight.length === 1 ? 'Termin hält' : 'Termine halten'} knapp – ${bms.length ? listJoin(bms) + ' ohne Unterbrechung laufen lassen und Störungen dort zuerst beheben' : 'Engpass ohne Unterbrechung laufen lassen'}.`);
      }
      a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
      // Termin-Diagramm nur für Claude-Grafik [[termine]]; offline zeigen die Risiko-Karten dieselben Zahlen
      a.impact = { title: 'Prognose gegen Termin', hidden: true, rows: late.concat(tight).slice(0, 6).map(o => ({ id: o.id, label: custShort(o.customer), before: o.eta, after: null, due: o.due })) };
      a.entity = { kind: 'order', id: (late[0] || tight[0]).id };
    }
    a.sources = ['Prognose / Plantafel (veröffentlichte Liefertermine)', 'Arbeitsgang-Kette je Auftrag', srcStand()];
    const first = late[0] || tight[0];
    a.followups = first ? [`Wo steht ${first.id} gerade?`, 'Was ist der Engpass?', first.bottleneck ? `Was passiert, wenn ${first.bottleneck.split(' ')[0]} 2 h ausfällt?` : 'Wie läuft die Schicht?'] : ['Was ist der Engpass?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Engpass
  /** Arbeitsvorrat je Arbeitsplatz – eine Rechnung mit Leitstand/Analyse: WF.sim.occupancy() (Schichttage), sonst eigene Schätzung */
  function loadRows(c) {
    const perDay = staffedPerDay();
    let occ = null, wc = null;
    if (typeof WF.sim.workContent === 'function') { try { wc = WF.sim.workContent(); if (wc && wc.w) wc = wc.w; } catch (e) { wc = null; } }
    if (!wc && typeof WF.sim.occupancy === 'function') { try { occ = WF.sim.occupancy(); } catch (e) { occ = null; } }
    let rows;
    if (wc) rows = PROF().machines.map(id => ({ id, st: station(id), auto: station(id).loading === 'auto', work: wc[id] || 0 }));
    else if (occ && occ.byMachine) rows = PROF().machines.map(id => ({ id, st: station(id), auto: station(id).loading === 'auto', work: (occ.byMachine[id] || 0) * perDay }));
    else rows = machineLoad(c).map(x => ({ id: x.id, st: x.st, auto: x.auto, work: x.work }));
    // Tage: bemannte Plätze über zwei Schichten, autonome rund um die Uhr (sie laufen auch in der Geisterschicht)
    for (const x of rows) x.days = x.work / (x.auto ? DAY : perDay);
    return rows.filter(x => x.work > 0).sort((x, y) => y.work - x.work);
  }
  const hTxt = (sec) => nm(sec / 3600, sec < 36000 ? 1 : 0) + ' h';
  function ansBottleneck(c) {
    const a = A('bottleneck');
    const open = c.open();
    const bnOf = (id) => open.filter(o => bnMachine(o) === id);
    const rows = loadRows(c);
    let eng = null;
    if (typeof WF.sim.bottleneck === 'function') { try { eng = WF.sim.bottleneck(); } catch (e) { eng = null; } }
    let top = eng ? rows.find(x => x.id === eng.stationId) : null;
    if (!top) { // gleiche Regel wie die Engine: unter den Plätzen, die gefährdete Aufträge begrenzen, der mit dem größten Vorrat
      const risky = rows.filter(x => bnOf(x.id).some(o => o.risk === 'spät' || o.risk === 'knapp'));
      top = risky[0] || rows[0];
    }
    a.eyebrow = 'Engpass · Plantafel';
    if (!top) { a.head = 'Kein Engpass'; a.md.push('Kein Arbeitsplatz hat offene Arbeitsgänge.'); a.sources = ['Plantafel', srcStand()]; return done(a); }
    const mv = c.mv(top.id), bn = bnOf(top.id), riskBn = bn.filter(o => o.risk !== 'ok');
    const until = Math.max(...(c.fc().machines[top.id] || []).map(e => e.end), c.t);
    a.sev = riskBn.some(o => o.risk === 'spät') ? 'warn' : riskBn.length ? 'info' : 'ok';
    a.head = `Engpass: ${mName(top.id)} – ${hTxt(top.work)} Arbeitsvorrat`;
    a.md.push(`${daysOf(top)}${top.auto ? ' (läuft auch unbemannt)' : ''}, laut Plantafel belegt bis ${dueTxt(until)}.${bn.length ? ` Dort liegt der längste Arbeitsgang von ${listJoin(bn.slice(0, 3).map(o => o.id + (o.risk !== 'ok' ? ' (' + o.riskLabel.toLowerCase() + ')' : '')))}${bn.length > 3 ? ' u. a.' : ''}.` : ''}`);
    if (rows[0] && rows[0].id !== top.id) a.md.push('', `Terminkritisch ist ${top.id}, nicht der Platz mit dem größten Vorrat (${mName(rows[0].id)}, ${hTxt(rows[0].work)}): dort hängt kein gefährdeter Auftrag.`);
    a.md.push('');
    if (mv) {
      if (mv.order) a.md.push(`- Jetzt: ${msl(mv)} – ${mv.order.id} AG ${mv.order.seq}, ${nm(mv.partsDone)}/${nm(mv.partsTotal)} fertig${mv.partNo != null ? ', Teil ' + mv.partNo + ' läuft' : ''}, ${nm(mv.order.cycleMin, mv.order.cycleMin < 10 ? 1 : 0)} min je Teil; Arbeitsgang fertig ca. ${tc(mv.etaOpEnd)}.`);
      else a.md.push(`- Jetzt: ${msl(mv)} – ${mv.cause}.`);
    }
    const others = rows.filter(x => x.id !== top.id).slice(0, 3);
    if (others.length) a.md.push(`- Danach am stärksten belastet: ${others.map(x => `${mName(x.id)} ${hTxt(x.work)}`).join('; ')}.`);
    const loadR = rows.slice(0, 6);
    if (loadR.length > 1) {
      a.md.push('', '### Arbeitsvorrat je Arbeitsplatz');
      SLOT(a, 'bars3', loadR.map(x => `- ${mName(x.id)}: ${hTxt(x.work)} (${daysOf(x)})`).join('\n'), { unit: 'h', rows: loadR.map(x => ({ ent: { kind: 'machine', id: x.id }, label: x.st.short, v: x.work, vTxt: hTxt(x.work), sub: daysOf(x) + (x.auto ? ' · läuft auch unbemannt' : '') + (bnOf(x.id).some(o => o.risk !== 'ok') ? ' · längster Arbeitsgang von ' + listJoin(bnOf(x.id).filter(o => o.risk !== 'ok').map(o => o.id)) : ''), c: x.id === top.id ? 'var(--st-wait)' : 'var(--info)' })) });
      a.md.push('');
    }
    const waits = c.mvs().filter(m => WAIT[m.state] || m.state === 'fault');
    if (waits.length) a.md.push(`- Akut gebremst: ${waits.map(m => `${mName(m.id)} (${msl(m)})`).join(', ')}.`);
    const alt = altMachines(top.id);
    const recs = [];
    recs.push(top.auto
      ? `${top.id} läuft auch unbemannt – Werkzeug- und Materialreichweite für die Geisterschicht sichern, Rüsten dort möglichst vermeiden.`
      : `${top.id} läuft nur bemannt – Bedienung in Pausen und zum Schichtwechsel sicherstellen; jede Stunde Stillstand dort verschiebt ${riskBn.length ? listJoin(riskBn.map(o => o.id)) : 'die nachfolgenden Aufträge'}.`);
    const ld = machineLoad(c).find(x => x.id === top.id);
    const movable = (ld ? ld.ops : []).filter(x => !x.active).map(x => ({ x, ok: capableAlts(x.orderId, x.seq, top.id) })).filter(y => y.ok.length);
    recs.push(!alt.length ? `Keine Alternativmaschine im Werk (einzige ${station(top.id).name}).` : movable.length ? `Entlastung möglich: ${movable.slice(0, 2).map(y => `${y.x.orderId} AG ${y.x.seq} auf ${listJoin(y.ok)}`).join('; ')} verlagern (dort neu rüsten).` : `Gleichartige Maschinen (${listJoin(alt)}) können die eingeplanten Arbeitsgänge nicht übernehmen (Gewicht, Durchmesser bzw. Stangenmaterial).`);
    for (const y of movable.slice(0, 1)) addAction(a, { label: `${y.x.orderId} AG ${y.x.seq} auf ${y.ok[0]} verlagern`, desc: `Entlastet ${top.id} um ca. ${hTxt(y.x.sec)} – auf ${station(y.ok[0]).short} wird neu gerüstet`, action: { type: 'moveOp', orderId: y.x.orderId, seq: y.x.seq, stationId: y.ok[0] }, icon: 'route' });
    a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
    a.stats = [{ l: top.id + ' ' + top.st.short, v: hTxt(top.work), s: 'Engpass · ≈ ' + daysTxt(top.days) + (top.auto ? ' (24 h)' : ''), c: 'warn' }].concat(others.slice(0, 2).map(x => ({ l: x.id + ' ' + x.st.short, v: hTxt(x.work), s: '≈ ' + daysTxt(x.days) + (x.auto ? ' (24 h)' : '') })));
    a.sources = ['Arbeitsvorrat offener Arbeitsgänge (Taktzeit, Rüsten)', 'Plantafel', 'Engpass-Definition der Prognose', 'Schichtkalender', srcStand()];
    a.entity = { kind: 'machine', id: top.id };
    a.followups = [`Was passiert, wenn ${top.id} 2 h ausfällt?`, 'Welche Aufträge sind gefährdet und warum?', `Was macht ${top.id} gerade?`];
    return done(a);
  }

  // ------------------------------------------------------------------ Maschine
  /** Personenzeile ohne Doppelungen („Legt Teil in M06 ein · an M06“ → nur Tätigkeit) */
  function actWhere(act, w) {
    act = act || ''; w = w || '';
    const actTxt = /^bereit$/i.test(act) ? 'verfügbar' : act;
    const red = !w || w === 'am Arbeitsplatz' || (w.indexOf('an ') === 0 && act.indexOf(w.slice(3)) >= 0) || (w.indexOf('unterwegs') === 0 && /^(geht|unterwegs|f(ä|ae)hrt|bringt|holt|kommt)/i.test(act)) || (w === 'in der Pause' && /pause/i.test(act)) || (w === 'im Messraum' && /messraum/i.test(act)) || (w === 'in der Werkzeugausgabe' && /werkzeugausgabe/i.test(act));
    return actTxt + (red ? '' : ' · ' + w);
  }
  /** Tätigkeit einer Person wie in der Personalansicht: betreut Maschinen / Schichtleitung / Tätigkeit · Ort */
  function personAct(p) {
    const d = pDisp(p);
    if (d.key === 'tending') return d.label;
    if (d.key === 'lead') return 'Schichtleitung';
    const raw = S().people[p.id];
    return actWhere(p.activity, p.where || (raw ? personWhere(raw) : ''));
  }
  function personLine(p) { return `${sn(p.name)} (${p.role}) – ${personAct(p)}`; }
  function ansMachine(c, id, focus) {
    const a = A('machine'), mv = c.mv(id);
    if (!mv) { a.md.push(`Arbeitsplatz ${id} ist nicht bekannt.`); return done(a); }
    a.entity = { kind: 'machine', id };
    const st = station(id), o = mv.order, fi = faultInfo(mv);
    const waiting = !!WAIT[mv.state];
    const opTools = (mv.tools || []).filter(t => t.status !== 'idle');
    const staffed = !!WF.sim.shift().id;
    // Wechselplan wie die Werkzeuge-Ansicht: angekündigt (Engine) und voraussichtlich (hochgerechnet) – dieselben Uhrzeiten
    const plan = o ? toolPlan(c, c.t + 6 * 3600, { machine: id }) : [];
    const nx = plan[0] || null, nx2 = plan[1] || null;
    const pTools = (g) => g.tools.map(x => toolShort(x.name)).join(' + ');
    const pWhen = (g) => (g.kind === 'plan' && g.text ? g.text : `nach Teil ${g.kind === 'proj' ? '~' : ''}${g.afterPart} · ca. ${tc(g.t)}`);
    const pLine = (g) => `${chgVerb(g)} ${pTools(g)} ${pWhen(g)}${g.kind === 'proj' ? ' (voraussichtlich)' : ''}`;
    const chgTxt = nx ? `${pLine(nx)} – ${chgWho(nx, staffed)}${nx.waitFromT && !(nx.text && /steht ab|wartet/.test(nx.text)) ? '; Maschine wartet ab ca. ' + clk(nx.waitFromT) + ' auf ' + (nx.index ? 'die Bediener:in' : 'den Wechsel') : ''}` : null;
    const since = `seit ${durR(mv.sinceSec)} (${clk(mv.since)})`;
    a.eyebrow = 'Arbeitsplatz · ' + trimTxt(mv.name, 52);
    a.sev = fi ? 'crit' : waiting ? 'warn' : mv.state === 'running' ? 'ok' : 'info';
    // Kernaussage – passend zur Frage
    if (focus === 'why' && !waiting && !fi && mv.state === 'running') { a.head = `${mName(id)} ${/steht/.test(c.q || '') ? 'steht nicht' : 'wartet nicht'} – sie produziert`; a.md.push(`${uc1(since)}. ${uc1(mv.cause)}.`); }
    else if (focus === 'tools') {
      const chg = opTools.filter(t => t.status === 'changing');
      if (chg.length) { a.head = `An ${mName(id)} wird gerade ${chg.every(t => t.nextAction === 'index' || (t.plannedChange && t.plannedChange.action === 'index')) ? 'die Schneide gewendet' : 'gewechselt'}`; a.md.push(`${chg.map(t => toolShort(t.name)).join(', ')}.`); }
      else if (nx) {
        a.head = nx.kind === 'plan' ? `Nächster Wechsel an ${id}: ${chgVerb(nx)} ${pTools(nx)} ${pWhen(nx)}` : `Voraussichtlich ca. ${tc(nx.t)}: ${chgVerb(nx)} ${pTools(nx)} an ${id}`;
        a.md.push(nx.kind === 'plan' ? `${uc1(chgWho(nx, staffed))}.${nx2 ? ' Danach ' + pLine(nx2) + '.' : ''}`
          : `Noch nicht angekündigt – hochgerechnet aus Reststandzeit und Taktzeit, wie in der Werkzeuge-Ansicht; ${nx.index ? 'die Bediener:in wendet an der Maschine (1–2 min).' : 'die Ankündigung mit Uhrzeit und Einrichter:in folgt.'}${nx2 ? ' Danach ' + pLine(nx2) + '.' : ''}`);
      } else if (opTools.length) { a.head = `Kein Werkzeugwechsel bis Ende ${o ? o.id + ' AG ' + o.seq : 'des Arbeitsgangs'}`; a.md.push(`Die Standzeiten an ${mName(id)} reichen für die restlichen ${teile(Math.max(0, mv.partsTotal - mv.partsDone))}.`); }
      else { a.head = `${mName(id)}: ${st.kind === 'machine' ? 'kein eingerichteter Arbeitsgang' : 'Arbeitsplatz ohne Schneidwerkzeug'}`; if (st.kind === 'machine') a.md.push('Werkzeuge werden beim nächsten Rüsten bestückt.'); }
      a.md.push(`${msl(mv)} ${since}: ${mv.cause}.`);
    } else if (focus === 'impact' && !fi) {
      const aff = affectedOrders(c, id), crit = aff.filter(x => x.o.risk !== 'ok');
      const one = aff.length === 1 ? aff[0].o : null;
      a.head = !aff.length ? `An ${mName(id)} ist nichts eingeplant – kein Einfluss auf Termine`
        : one ? `An ${mName(id)} hängt ${one.id} – ${one.slackSec >= 0 ? (one.risk === 'ok' ? 'Termin hält, ' + slackTxt(one.slackSec) : 'knapp, ' + slackTxt(one.slackSec)) : durR(-one.slackSec) + ' Verzug'}`
        : `An ${mName(id)} hängen ${aff.length} Aufträge${crit.length ? `, ${crit.length} mit Terminrisiko` : ' – alle mit Puffer'}`;
      a.md.push(`${msl(mv)} ${since}: ${mv.cause}.`);
    } else if (focus === 'people') {
      const op = mv.operator;
      a.head = op ? `${op.responsible ? 'Zuständig für' : 'An'} ${id}: ${op.name}` : `${mName(id)}: ${st.loading === 'auto' ? 'läuft autonom' : 'niemand Zuständiges im Dienst'}`;
      a.md.push(`${op ? op.role + ' – ' + personAct(op) + '. ' : ''}${msl(mv)} ${since}: ${mv.cause}.`);
    } else if (focus === 'free') {
      // „frei ab“ = Ende der letzten Belegung laut Plantafel – dieselbe Rechnung wie die Kapazitätsprüfung
      const list = (c.fc().machines[id] || []).slice().sort((x, y) => x.start - y.start);
      const free = Math.max(c.t, ...list.map(e => e.end));
      a.head = list.length ? `${mName(id)} frei ab ${dueTxt(free)}` : `${mName(id)} ist frei – nichts eingeplant`;
      a.md.push(list.length ? `Laut Plantafel ${list.length === 1 ? 'noch ein Arbeitsgang' : 'noch ' + list.length + ' Arbeitsgänge'} bis ${dueTxt(free)}; danach ist ${id} frei für Verlagerungen oder neue Aufträge.` : `${msl(mv)} ${since}: ${mv.cause}.`);
      if (list.length) { a.md.push(''); for (const e of list.slice(0, 5)) a.md.push(`- ${e.orderId} AG ${e.seq}${e.active ? ' (läuft)' : ''}: ${tc(Math.max(c.t, e.start))}–${tc(e.end)}`); if (list.length > 5) a.md.push(`- … und ${list.length - 5} weitere`); }
    } else if (focus === 'eta' && o && mv.etaOpEnd) { a.head = `${id}: ${o.id} AG ${o.seq} fertig ca. ${tc(mv.etaOpEnd)}`; a.md.push(`${nm(mv.partsDone)}/${nm(mv.partsTotal)} Teile · ${msl(mv)} ${since}. ${uc1(mv.cause)}.`); }
    else { a.head = `${mName(id)}: ${msl(mv)}${fi ? ' – ' + mv.fault.code : waiting ? '' : mv.order ? ' – ' + mv.order.id : ''}`; a.md.push(`${uc1(since)}. ${waiting || fi ? 'Ursache: ' : ''}${uc1(mv.cause)}.`); }
    if (focus === 'full') {
      const crit = affectedOrders(c, id).filter(x => x.o.risk !== 'ok');
      const v = fi ? `Störung – Reparatur bis ca. ${clk(fi.endT)}` : waiting ? `steht (${msl(mv)})` : mv.state === 'idle' ? (msl(mv) === 'Keine Schicht' ? 'steht planmäßig (keine Schicht)' : 'ohne Auftrag') : SETUPISH[mv.state] ? msl(mv) + ' – Serie folgt' : 'läuft planmäßig';
      a.md.push(`**Einschätzung:** ${v}${crit.length ? '; Terminrisiko bei ' + listJoin(crit.map(x => `${x.o.id} (${slackTxt(x.o.slackSec)})`)) : '; keine gefährdeten Termine an ' + id}.`);
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
        tag: t.status === 'ok' ? '' : t.plannedChange ? (t.plannedChange.action === 'index' ? 'Wenden ' : 'Wechsel ') + t.plannedChange.text + (t.plannedChange.by ? ' · ' + sn(t.plannedChange.by) : '') : label('toolStatus', t.status) })));
      const crit = opTools.slice().sort((x, y) => (x.remainingParts == null ? 1e9 : x.remainingParts) - (y.remainingParts == null ? 1e9 : y.remainingParts))[0];
      if (crit && crit.explain) a.md.push('', `~ Regel: ${explainTxt(crit.explain)}`);
      if (nx && nx.note) a.md.push(`Hinweis: ${nx.note}.`);
    } else if (opTools.length) {
      if (chgTxt) a.md.push(`- **Nächster Wechsel:** ${chgTxt}.`);
      else {
        const crit = opTools.slice().sort((x, y) => (x.remainingParts == null ? 1e9 : x.remainingParts) - (y.remainingParts == null ? 1e9 : y.remainingParts))[0];
        if (crit && crit.status !== 'changing' && crit.explain) a.md.push(`- **Werkzeug ${toolShort(crit.name)}:** ${explainTxt(crit.explain)}`);
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
      const moe = machineOee(mv, c.k()), lrow = lossByCause(c).byMachine.find(x => x.mv.id === id) || { loss: mv.lossEurToday || 0, night: 0 };
      const todayTxt = `- Heute: OEE${moe.staffed ? ' (Schichten)' : ''} ${pct(moe.oee, oeeDec(moe.oee))}, ${pl(mv.goodToday, 'Gutteil', 'Gutteile')}, ${nm(mv.scrapToday)} Ausschuss, Stillstandskosten ${eur(lrow.loss)}${lrow.night >= 0.5 ? ' zzgl. ' + eur(lrow.night) + ' nachts' : ''} (Satz ${eur(mv.rate)}/h).`;
      if (!focus || focus === 'full') {
        // Kennzahlen-Leiste statt Textzeile (im kopierten Text bleibt die Zeile erhalten)
        const oee = moe.oee;
        a.stats = [
          (() => { const L = msl(mv), short = L === 'Werkzeugwechsel' ? 'WZ-Wechsel' : L.length > 13 && L.indexOf(' ') > 0 ? L.slice(0, L.indexOf(' ')) : L, rest = short !== L && short !== 'WZ-Wechsel' ? L.slice(short.length + 1) + ' · ' : '';
            return { l: 'Status', v: short, s: rest + 'seit ' + durR(mv.sinceSec), c: mv.state === 'fault' ? 'crit' : WAIT[mv.state] ? 'warn' : mv.state === 'running' ? 'ok' : 'info' }; })(),
          o ? { l: 'AG ' + o.seq + ' · Teile', v: nm(mv.partsDone) + '/' + nm(mv.partsTotal), s: mv.etaOpEnd ? 'fertig ca. ' + tc(mv.etaOpEnd) : o.id }
            : mv.queue && mv.queue.length ? { l: 'Als Nächstes', v: mv.queue[0].orderId, s: (mv.queue[0].why || 'AG ' + mv.queue[0].seq).replace(/^Teile\s+/, '') } : { l: 'Auftrag', v: '–', s: 'nichts eingeplant' },
          oeeStat(oee, pl(mv.goodToday, 'Gutteil', 'Gutteile') + (mv.scrapToday ? ' · ' + nm(mv.scrapToday) + ' Ausschuss' : ''), oeeDec(oee), moe.staffed ? 'OEE · Schichten' : null),
          { l: 'Stillstand', v: eur(lrow.loss), s: lrow.night >= 0.5 ? 'zzgl. ' + eur(lrow.night) + ' nachts' : 'heute · ' + eur(mv.rate) + '/h', c: 'info' },
        ];
        SLOT(a, 'today', todayTxt, null);
      } else if (focus !== 'eta') a.md.push(todayTxt);
    }
    // Auswirkung (Störung/Wartezeit oder ausdrücklich gefragt)
    if (focus === 'impact' || focus === 'full' || fi || (waiting && mv.sinceSec >= 300)) {
      const aff = affectedOrders(c, id);
      if (aff.length) {
        a.md.push('', '### Auswirkung auf Termine');
        for (const x of aff.slice(0, 5)) a.md.push(`- **${x.o.id}** (${custShort(x.o.customer)}, AG ${x.seq}${x.active ? ', läuft hier' : ', ab ca. ' + tc(Math.max(c.t, x.start))}): Prognose ${dueTxt(x.o.eta)}, Termin ${dueTxt(x.o.due)} – ${slackTxt(x.o.slackSec)}.`);
        if (fi || waiting) a.md.push(`Die Prognose enthält ${fi ? 'die Reparatur bis ca. ' + clk(fi.endT) : 'die bisherige Wartezeit'} bereits.`);
        a.impact = { title: 'Termine an ' + id, rows: aff.slice(0, 6).map(x => ({ id: x.o.id, label: 'AG ' + x.seq, before: x.o.eta, after: null, due: x.o.due })) };
      } else a.md.push('', `Keine offenen Arbeitsgänge an ${id} eingeplant – kein Einfluss auf Termine.`);
    }
    // Empfehlung
    let rec = null;
    if (fi) {
      rec = `${fi.working ? 'Reparatur läuft' : fi.person ? sn(fi.person.name) + ' ist unterwegs' : 'Instandhaltung zu ' + id + ' schicken'} – Ende ca. ${clk(fi.endT)}. Auswirkung auf die Termine: „Was bedeutet die Störung an ${id}?“`;
      if (mv.fault.manual) addAction(a, { label: `Störung an ${id} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort – die Maschine nimmt die Arbeit wieder auf.', action: { type: 'repair', machineId: id }, icon: 'wrench' });
    } else if (waiting) rec = waitAdvice(c, mv);
    else if (mv.state === 'firstPiece') rec = `Erstteil zügig prüfen – ${id} darf bis zur Freigabe nicht weiterfertigen (Stillstand ${eur(mv.rate)}/h).`;
    else if (mv.state === 'idle') rec = mv.queue && mv.queue.length ? `Freie Kapazität bis zum nächsten Arbeitsgang ${mv.queue[0].orderId} AG ${mv.queue[0].seq} (${mv.queue[0].why}).` : `${id} hat keinen eingeplanten Arbeitsgang – freie Kapazität für Verlagerungen oder neue Aufträge.`;
    else if (nx && nx.kind === 'plan' && nx.t - c.t < 3600) {
      const prepared = nx.stage === 'Werkzeug liegt bereit' || /mit Werkzeug|an der Maschine|holt Werkzeug/.test(nx.stage || '');
      rec = nx.index ? `${chgVerb(nx)} ${pTools(nx)} ca. ${clk(nx.t)} durch die Bediener:in an der Maschine (1–2 min) – keine Vorbereitung nötig.`
        : prepared ? `Werkzeugwechsel ca. ${clk(nx.t)} ist vorbereitet (${nx.stage}${nx.by ? ', ' + sn(nx.by) : ''}) – keine weitere Maßnahme nötig.`
          : `Werkzeug für den Wechsel ca. ${clk(nx.t)} vermessen bereitlegen${nx.by ? '' : ' und Einrichter:in zuteilen'} – dann dauert der Stopp nur die reine Wechselzeit.`;
    }
    else if (focus === 'full' || focus === 'impact') {
      const crit = affectedOrders(c, id).filter(x => x.o.risk !== 'ok');
      if (crit.length) { const adv = adviceText(c, crit[0].o); rec = `${crit[0].o.id}: ${adv.text}`; for (const x of adv.actions) addAction(a, x); }
      else rec = `${id} läuft planmäßig – keine Maßnahme nötig.`;
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
  // ------------------------------------------------------------------ Störung: was bedeutet sie für die Termine?
  /** Auswirkung einer Störung je Auftrag an dieser Maschine: Arbeitsgang-Ende und Liefertermin vorher/nachher.
      „Vorher“ = letzte Prognose, bevor die Maschine gestört war (Prognose-Verlauf); fehlt sie, wird das Arbeitsgang-Ende
      aus der Reparaturdauer zurückgerechnet und der Liefertermin nur als aktueller Stand genannt. */
  function faultImpact(c, mid) {
    const mv = c.mv(mid), fi = faultInfo(mv);
    if (!fi) return null;
    const f = mv.fault, t0 = f.t0 != null ? f.t0 : c.t - (f.sinceSec || 0);
    const before = etaBefore(t0, mid);
    const lost = Math.max(0, fi.endT - t0);
    const rows = affectedOrders(c, mid).map(x => {
      // eine Quelle: Prognose des Auftrags wie in jeder Antwort (veröffentlicht bzw. „neu gerechnet“); „bisher“ = veröffentlicht
      const o = x.o;
      const etaA = o.eta, etaB = o.etaNew ? o.etaPub : before && before.eta[o.id] != null ? before.eta[o.id] : null;
      const opA = x.active && mv.etaOpEnd ? mv.etaOpEnd : x.opEnd != null ? x.opEnd : x.end;
      const opB = before && before.opEnd[o.id + '/' + x.seq] != null ? before.opEnd[o.id + '/' + x.seq] : x.active ? opA - lost : null;
      return { o, seq: x.seq, active: x.active, start: x.start, opA, opB, etaA, etaB, dEta: etaB != null ? etaA - etaB : null, dOp: opB != null ? opA - opB : null, slack: o.due - etaA };
    });
    return { mv, fi, f, t0, before, lost, rows };
  }
  /** Wie lange reicht der Vorrat des Nachfolgers, wenn diese Maschine steht? (Teile im Eingang × Taktzeit) */
  function successorCover(c, o, seq) {
    const i = o.ops.findIndex(op => op.seq === seq), nx = i >= 0 ? o.ops[i + 1] : null;
    if (!nx || !S().machines[nx.station] || nx.complete) return null;
    const mvN = c.mv(nx.station), st = station(nx.station);
    const runs = mvN && mvN.order && mvN.order.id === o.id && mvN.order.seq === nx.seq;
    const parts = (nx.waiting || 0) + (runs ? 0 : 0);
    const per = ((nx.cycleMin || 0) + (st.loading === 'perPart' ? (st.loadMin || 1) : 0)) * 60;
    const sec = parts * per + (runs && mvN.partRemainSec ? mvN.partRemainSec : 0);
    return sec > 0 ? { station: nx.station, seq: nx.seq, parts, sec, runs } : { station: nx.station, seq: nx.seq, parts: 0, sec: 0, runs };
  }
  function etaLine(r) {
    if (r.dEta == null) return `Prognose ${dueTxt(r.etaA)} (${slackTxt(r.slack)}) – Reparatur ist eingerechnet`;
    if (Math.abs(r.dEta) < 60) return `Liefertermin bleibt ${dueTxt(r.etaA)} (${slackTxt(r.slack)})`;
    return `Liefertermin bisher ${dueTxt(r.etaB)} → neu gerechnet **${dueTxt(r.etaA)}** (${deltaTxt(r.dEta)}; ${slackTxt(r.slack)})`;
  }
  function ansFault(c, mid, named) {
    const a = A('fault');
    named = (named || []).filter(id => S().orders[id]);
    let fx = faultImpact(c, mid), note = '';
    if (!fx) { // genannte Maschine ist nicht gestört – betrifft eine andere Störung den genannten Auftrag?
      const other = c.mvs().filter(m => m.state === 'fault' && (!named.length || named.some(oid => { const ov = c.ov(oid); return ov && ov.ops.some(op => op.station === m.id && !op.complete); })));
      if (other.length) { note = `${mName(mid)} hat keine Störung – gestört ist ${mName(other[0].id)}${named.length ? ', und das betrifft ' + listJoin(named) : ''}.`; mid = other[0].id; fx = faultImpact(c, mid); }
    }
    a.entity = { kind: 'machine', id: mid };
    if (!fx) {
      const mv = c.mv(mid);
      a.eyebrow = 'Arbeitsplatz · ' + trimTxt(mv.name, 52); a.sev = 'ok';
      a.head = `${mName(mid)} hat keine Störung`;
      a.md.push(`${msl(mv)} seit ${durR(mv.sinceSec)}: ${mv.cause}.`);
      for (const oid of named) {
        const ov = c.ov(oid), on = ov.ops.find(op => op.station === mid && !op.complete);
        a.md.push('', on ? `${oid} AG ${on.seq} „${on.op}“ läuft über ${mid} – ${on.state === 'active' ? 'gerade in Bearbeitung' : 'Start laut Plantafel ca. ' + tc(Math.max(c.t, on.plannedStart || c.t))}; ${slackTxt(ov.slackSec)}.` : `${oid} läuft nicht über ${mid} (Route: ${ov.ops.map(op => op.station === 'EXT' ? 'Härterei/extern' : op.station).filter(x => x !== 'VERSAND').join(' → ')}).`);
      }
      a.md.push('', `> **Hinweis:** Wie sich ein Ausfall auswirken würde, rechnet „Was passiert, wenn ${mid} 2 h ausfällt?“ durch.`);
      addAction(a, { label: `Störung an ${mid} auslösen (Demo)`, desc: 'Alarm aus dem Störungskatalog – Meldung, Instandhaltung und Prognose reagieren live.', action: { type: 'triggerFault', machineId: mid }, icon: 'alert', danger: true });
      a.sources = [`Maschinenstatus ${mid}`, 'Prognose / Plantafel', srcStand()];
      a.followups = [`Was passiert, wenn ${mid} 2 h ausfällt?`, named[0] ? `Wo steht ${named[0]} gerade?` : 'Wie läuft die Schicht?'];
      return done(a);
    }
    const { mv, fi, f, t0, rows } = fx;
    a.eyebrow = 'Störung · ' + trimTxt(mv.name, 52);
    a.sev = 'crit';
    a.head = `Störung ${mName(mid)}: ${f.code} ${f.text}`;
    const standSec = Math.max(0, c.t - t0);
    if (note) a.md.push(note, '');
    a.md.push(`Seit ${clk(t0)} – ${fi.who}. Erfahrungswert ${f.repairMin[0]}–${f.repairMin[1]} min, Ende ca. **${clk(fi.endT)}**. Wahrscheinliche Ursache: ${f.cause}.${f.partScrapped ? ' Das laufende Teil ist Ausschuss.' : ''}${f.toolName ? ' Werkzeug ' + toolShort(f.toolName) + ' gebrochen – wird nach der Reparatur gewechselt.' : ''}`);
    // Aufträge: genannte zuerst, dann der laufende, dann alle mit spürbarer Verschiebung (≥ 5 min)
    const order = (r) => (named.indexOf(r.o.id) >= 0 ? 0 : r.active ? 1 : 2);
    const shown = rows.filter(r => named.indexOf(r.o.id) >= 0 || r.active || (r.dEta != null && Math.abs(r.dEta) >= 300) || (r.slack < 4 * 3600 && r.start <= fi.endT)).sort((x, y) => order(x) - order(y) || x.start - y.start);
    const rest = rows.filter(r => shown.indexOf(r) < 0);
    const act = rows.find(r => r.active);
    const focusR = shown[0] || act || null;
    a.stats = [
      { l: 'Reparatur bis', v: clk(fi.endT), s: fi.person ? sn(fi.person.name) : 'niemand zugeteilt', c: 'crit' },
      { l: 'Stillstand', v: durR(standSec + fi.rem), s: 'ca. ' + eur(mv.rate * (standSec + fi.rem) / 3600), c: 'warn' },
    ];
    if (act) a.stats.push({ l: `AG ${act.seq} fertig`, v: tc(act.opA), s: act.dOp != null ? (Math.abs(act.dOp) < 60 ? 'unverändert' : deltaTxt(act.dOp)) : act.o.id, c: act.dOp != null && act.dOp >= 300 ? 'warn' : '' });
    if (focusR) a.stats.push({ l: 'Lieferung ' + focusR.o.id, v: tc(focusR.etaA), s: focusR.dEta != null && Math.abs(focusR.dEta) >= 60 ? deltaTxt(focusR.dEta) : slackTxt(focusR.slack), c: focusR.slack < 0 ? 'crit' : focusR.slack < 4 * 3600 ? 'warn' : 'ok' });
    a.md.push('', '### Auswirkung auf Aufträge');
    const notOn = named.filter(oid => !rows.some(r => r.o.id === oid));
    for (const oid of notOn) { const ov = c.ov(oid); a.md.push(`- **${oid}** läuft nicht über ${mid} – keine Auswirkung (${slackTxt(ov.slackSec)}).`); }
    for (const r of shown.slice(0, 5)) {
      const why = [];
      if (r.active) {
        const cov = successorCover(c, r.o, r.seq);
        if (cov && cov.sec > 0 && (r.dEta == null || Math.abs(r.dEta) < 60)) why.push(`${cov.station} hat noch ca. ${durR(cov.sec)} Arbeit im Eingang – erst wenn ${mid} länger steht, fehlt dort Nachschub`);
        else if (r.dEta != null && Math.abs(r.dEta) < 60) {
          const ew = engineWhy(c, r.o), dc = ew ? null : delayCauses(c, r.o);
          if (ew && ew.limit && ew.limit.stationId && ew.limit.stationId !== mid) why.push(`der Termin hängt an ${ew.limit.name || (S().machines[ew.limit.stationId] ? mName(ew.limit.stationId) : ew.limit.stationId)}, nicht an ${mid}`);
          else if (dc && dc.main && dc.main.station !== mid) why.push(`der Termin hängt an ${dc.main.short}, nicht an ${mid}`);
        }
      }
      a.md.push(`- **${r.o.id}** ${r.o.part.name} (${custShort(r.o.customer)}), AG ${r.seq}: ${r.active ? `fertig ca. ${tc(r.opA)}${r.opB != null && Math.abs(r.opA - r.opB) >= 60 ? ' statt ' + tc(r.opB) + ' (' + deltaTxt(r.opA - r.opB) + ')' : ''}` : `Start an ${mid} ca. ${tc(Math.max(c.t, r.start))}`}; ${etaLine(r)}${why.length ? ' – ' + why.join('; ') : ''}.`);
    }
    if (rest.length) a.md.push(`- ${pl(rest.length, 'weiterer Auftrag', 'weitere Aufträge')} an ${mid} (${listJoin(rest.slice(0, 3).map(r => r.o.id))}${rest.length > 3 ? ' u. a.' : ''}) ${rest.length === 1 ? 'startet' : 'starten'} später – ${rest.some(r => r.dEta == null) ? 'Liefertermine mit ausreichend Puffer' : 'Liefertermine: ' + NOCHG}.`);
    if (!rows.length) a.md.push(`- An ${mid} ist kein offener Arbeitsgang eingeplant – kein Einfluss auf Termine.`);
    const imp = shown.filter(r => r.etaA != null).slice(0, 5);
    if (imp.length) a.impact = { title: `Liefertermine · Störung ${mid}`, rows: imp.map(r => ({ id: r.o.id, label: 'AG ' + r.seq, before: r.etaB != null ? r.etaB : r.etaA, after: r.etaB != null ? r.etaA : null, due: r.o.due })) };
    // Empfehlung: Jetzt tun
    const recs = [];
    recs.push(fi.working ? `Reparatur läuft (${sn(fi.person.name)}) – Ende ca. ${clk(fi.endT)}.` : fi.person ? `${sn(fi.person.name)} ist unterwegs – Ende ca. ${clk(fi.endT)}.` : `Instandhaltung zu ${mid} schicken – noch niemand zugeteilt.`);
    if (!fi.working) recs.push(`Ursache prüfen: ${f.cause}.`);
    const crit = rows.filter(r => r.slack < 4 * 3600 && (r.active || r.start <= fi.endT));
    if (act) {
      const cov = successorCover(c, act.o, act.seq);
      if (act.dEta != null && act.dEta >= 60) recs.push(`${act.o.id} verschiebt sich um ${durR(act.dEta)}${act.slack < 0 ? ' und ist jetzt ' + durR(-act.slack) + ' zu spät' : ''} – ${act.slack < 0 ? 'Kunde ' + custShort(act.o.customer) + ' informieren bzw. Teillieferung abstimmen' : 'jede weitere Minute Stillstand geht vom Puffer ab'}.`);
      else if (cov && cov.sec > 0) recs.push(`${act.o.id} hält, solange ${cov.station} Nachschub hat (ca. ${durR(cov.sec)} im Eingang)${act.slack < 4 * 3600 ? '; danach geht jede Minute Stillstand vom Puffer (' + durR(act.slack) + ') ab' : ''}.`);
      else if (act.slack < 4 * 3600) recs.push(`${act.o.id} ist knapp (${slackTxt(act.slack)}) – Reparatur hat Vorrang vor allen anderen Aufgaben.`);
      else recs.push('Termine halten – keine weitere Maßnahme nötig.');
    } else if (!crit.length) recs.push('Termine halten – keine weitere Maßnahme nötig.');
    const d0 = Math.floor(c.t / DAY) * DAY;
    const nF = (S().events || []).filter(e => e.type === 'fault' && e.t >= d0 && e.entity && e.entity.id === mid).length;
    if (nF > 1) recs.push(`Schon die ${nF}. Störung heute an ${mid} – Ursache dauerhaft abstellen.`);
    a.md.push('', '> **Empfehlung:** ' + recs.join(' '));
    if (f.manual) addAction(a, { label: `Störung an ${mid} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort – die Maschine nimmt die Arbeit wieder auf.', action: { type: 'repair', machineId: mid }, icon: 'wrench' });
    if (focusR) addAction(a, { label: `${focusR.o.id} öffnen`, desc: 'Arbeitsgang-Kette und Behälter im Detail', action: { type: 'select', kind: 'order', id: focusR.o.id }, icon: 'list', quiet: true });
    a.sources = [`Störung ${f.code} (${label('conn', mv.conn.level)})`, 'Instandhaltung (Aufgabe, Erfahrungswert)', fx.before ? 'Prognose vor der Störung (' + clk(fx.before.fcT) + ') und jetzt' : 'Prognose / Plantafel', srcStand()];
    a.followups = [focusR ? `Wo steht ${focusR.o.id} gerade?` : `Was macht ${mid} gerade?`, `Was passiert, wenn ${mid} 2 h ausfällt?`, 'Welche Aufträge sind gefährdet und warum?'];
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
    if (!o) { a.head = `Auftrag ${id} ist nicht bekannt`; return done(a); }
    a.entity = { kind: 'order', id };
    a.eyebrow = 'Auftrag · ' + trimTxt(custShort(o.customer) + ' · ' + o.part.name, 60);
    if (o.status === 'fertig') {
      a.sev = o.onTime ? 'ok' : 'warn';
      a.head = `${o.id} ist fertig – ${o.onTime ? 'termingerecht und vollständig' : o.shortQty > 0 ? 'Teillieferung, ' + stk(o.shortQty) + ' fehlen' : 'nach dem Termin'}`;
      a.md.push(`${o.part.name} (${o.part.no}) für ${o.customer}: fertig ${dueTxt(o.doneT)}, Termin ${dueTxt(o.due)}; ${stk(o.shippedQty)} von ${stk(o.qty)} versandt.`);
      a.sources = ['Auftrag ' + id, srcStand()];
      return done(a);
    }
    const late = o.slackSec != null && o.slackSec < 0;
    a.sev = late ? 'crit' : o.risk === 'knapp' ? 'warn' : 'ok';
    const nw = o.etaNew ? ' (neu gerechnet)' : '';
    a.head = focus === 'eta' ? `${o.id} fertig ca. ${dueTxt(o.eta)}${nw} – ${late ? durR(-o.slackSec) + ' nach dem Termin' : slackTxt(o.slackSec)}`
      : late ? `${o.id} ist ${durR(-o.slackSec)} zu spät${nw}` : o.risk === 'knapp' ? `${o.id} hält knapp – ${slackTxt(o.slackSec)}${nw}` : `${o.id} liegt im Plan – fertig ca. ${dueTxt(o.eta)}${nw}`;
    a.md.push(`${o.part.name} (${o.part.no}) für ${o.customer} – ${stk(o.qty)}, Termin ${dueTxt(o.due)}${o.priority === 'eil' ? ', **Eilauftrag**' : ''}; Prognose ${dueTxt(o.eta)}${etaTag(o)}.`);
    // Schritte wie im Auftrags-Drawer gezählt (alle Arbeitsgänge inkl. Versand, fertig = abgeschlossen)
    const nDone = o.ops.filter(op => op.state === 'done' || op.complete).length, nAll = o.ops.length;
    a.stats = [
      { l: o.etaNew ? 'Prognose · neu' : 'Prognose', v: tc(o.eta), s: o.etaNew ? 'bisher ' + tc(o.etaPub) : 'Termin ' + tc(o.due) + (o.priority === 'eil' ? ' · Eil' : ''), c: late ? 'crit' : o.risk === 'knapp' ? 'warn' : 'ok' },
      { l: late ? 'Verzug' : 'Puffer', v: o.slackSec == null ? '–' : o.slackSec < 60 && o.slackSec >= 0 ? '0 min' : durR(Math.abs(o.slackSec)), s: o.etaNew ? 'Termin ' + tc(o.due) : o.riskLabel, c: late ? 'crit' : o.risk === 'knapp' ? 'warn' : 'ok' },
      { l: 'Fortschritt', v: pct(o.progress), s: `${nDone} von ${nAll} Schritten${o.shippedQty ? ' · ' + stk(o.shippedQty) + ' versandt' : ''}` },
    ];
    // Störung auf dem Weg des Auftrags: zuerst nennen (Reparatur, vorher/nachher)
    for (const op of o.ops) {
      if (op.complete || op.state !== 'active' || !S().machines[op.station]) continue;
      const fx = faultImpact(c, op.station); if (!fx) continue;
      const r = fx.rows.find(x => x.o.id === o.id);
      a.md.push('', `**Störung an ${op.station} (${fx.f.code} ${fx.f.text})** – ${fx.fi.working ? 'Reparatur ' + sn(fx.fi.person.name) : fx.fi.person ? sn(fx.fi.person.name) + ' unterwegs' : 'noch niemand zugeteilt'}, Ende ca. ${clk(fx.fi.endT)}.${r ? ` AG ${op.seq} fertig ca. ${tc(r.opA)}${r.opB != null && Math.abs(r.opA - r.opB) >= 60 ? ' statt ' + tc(r.opB) : ''}; ${etaLine(r)}.` : ''}`);
      if (r && r.etaB != null && Math.abs(r.dEta) >= 60) a.impact = { title: 'Liefertermin vor / nach der Störung', rows: [{ id: o.id, label: 'AG ' + op.seq, before: r.etaB, after: r.etaA, due: o.due }] };
    }
    // Warum knapp/spät: Ursache der Engine (gleicher Wortlaut wie Meldung und Auftrags-Drawer) + Zerlegung der Restlaufzeit;
    // ohne Engine-Ursache die eigene Kette (Warten, Bearbeitung, Fremdbearbeitung, Stopp)
    const want = o.risk !== 'ok' || focus === 'why';
    const ew = want ? engineWhy(c, o) : null;
    const dc = want && !ew ? delayCauses(c, o) : null;
    if (ew) {
      a.md.push('', late ? '### Warum verspätet' : o.risk === 'knapp' ? '### Warum knapp' : '### Was den Termin bestimmt');
      a.md.push(`**Ursache: ${uc1(ew.cause)}.**`);
      const rows = ew.all.filter(e => e.sec >= 60);
      if (rows.length) {
        const isLim = (e) => !!(ew.limit && e.kind === ew.limit.kind && e.stationId === ew.limit.stationId);
        // Zeilen: zuerst die Verzugs-Beiträge (Warten, Fremdbearbeitung, Störung, Werkzeug, Material) einzeln – daraus
        // stammt die Ursache –, danach Bearbeitung und Zeit außerhalb der Schicht zusammengefasst
        const delays = rows.filter(e => e.kind !== 'process' && e.kind !== 'noShift' && e.sec >= 900).sort((x, y) => y.sec - x.sec).slice(0, 4)
          .map(e => ({ kind: e.kind, sec: e.sec, label: dlyLabel(o, e), lim: isLim(e) }));
        const sum = (k) => rows.filter(e => e.kind === k).reduce((x, e) => x + e.sec, 0);
        const nProc = new Set(rows.filter(e => e.kind === 'process').map(e => e.seq)).size;
        const agg = [];
        if (sum('process') >= 60) agg.push({ kind: 'process', sec: sum('process'), label: `Bearbeitung (${pl(nProc, 'Arbeitsgang', 'Arbeitsgänge')})`, lim: !delays.some(x => x.lim) && !!(ew.limit && ew.limit.kind === 'process') });
        if (sum('noShift') >= 60) agg.push({ kind: 'noShift', sec: sum('noShift'), label: 'außerhalb der Schicht (Nacht, Wochenende, Pausen)', lim: false });
        const list = delays.concat(agg);
        SLOT(a, 'delay', list.map(e => `- ${uc1(e.label)}: ${durR(e.sec)}`).join('\n'), {
          total: ew.total, eta: o.eta,
          segs: rows.slice().sort((x, y) => (x.seq - y.seq) || ((DLY_ORDER[x.kind] ?? 9) - (DLY_ORDER[y.kind] ?? 9))).map(e => ({ kind: e.kind, sec: e.sec, label: dlyLabel(o, e), lim: isLim(e) })),
          top: list,
        });
      }
    } else if (dc && dc.items.length) {
      a.md.push('', late ? '### Warum verspätet' : o.risk === 'knapp' ? '### Warum knapp' : '### Was den Termin bestimmt');
      for (const x of dc.items) a.md.push(`- ${x === dc.main ? '**' + uc1(x.text) + '**' : uc1(x.text)}`);
    }
    a.md.push('', '### Arbeitsgänge');
    const fops = (c.fc().orders[o.id] || {}).ops || [];
    const routeTxt = [], route = [];
    o.ops.forEach((op, i) => {
      const isM = !!S().machines[op.station], fe = fops[i] || null;
      const r = { seq: op.seq, op: op.op, station: op.station, st: 'plan', pill: 'geplant', sub: '', pct: null, c: 'var(--faint)' };
      if (op.station === 'VERSAND' && !op.complete) {
        routeTxt.push(`- AG ${op.seq} ${op.op}: nach Abschluss ca. ${tc(o.eta)}`);
        Object.assign(r, { st: 'ship', pill: 'Versand', sub: `nach Abschluss ca. ${tc(o.eta)}`, c: 'var(--muted)' }); route.push(r); return;
      }
      const where = op.station === 'EXT' ? (op.ext && op.ext.partner ? op.ext.partner.replace(/\s*\(Beispiel\)/, '') : 'extern') : op.station === 'VERSAND' ? 'Versand' : mName(op.station);
      const startEnd = fe ? `Start ca. ${tc(Math.max(c.t, fe.start))} · fertig ca. ${tc(Math.max(c.t, op.station === 'EXT' && fe.lastReturn != null ? fe.lastReturn : fe.end))}` : '';
      let s;
      if (op.complete) {
        s = `fertig (${nm(op.good)}/${nm(op.targetIn)}${op.scrap ? ', ' + nm(op.scrap) + ' Ausschuss' : ''})`;
        Object.assign(r, { st: 'done', pill: 'fertig', sub: `${nm(op.good)}/${nm(op.targetIn)} gut${op.scrap ? ' · ' + nm(op.scrap) + ' Ausschuss' : ''}${op.endT ? ' · ' + tc(op.endT) : ''}`, c: 'var(--st-run)', pct: 1 });
      } else if (op.state === 'active') {
        const mv = isM ? c.mv(op.station) : null;
        const stopTxt = mv && (WAIT[mv.state] || mv.state === 'fault') ? causeCore(mv) : '';
        s = `**${mv ? msl(mv) : 'in Bearbeitung'}** – ${nm(op.good + op.scrap)}/${nm(op.target)}${stopTxt ? ': ' + stopTxt : ''}${mv && mv.etaOpEnd ? ', fertig ca. ' + tc(mv.etaOpEnd) : ''}`;
        const col = mv ? ((WF.STATE[mv.state] || {}).color || 'var(--st-run)') : 'var(--st-run)';
        Object.assign(r, { st: 'act', pill: mv ? msl(mv) : 'in Bearbeitung', c: col, pct: op.target ? Math.min(1, (op.good + op.scrap) / op.target) : null,
          sub: `${nm(op.good + op.scrap)}/${nm(op.target)}${stopTxt ? ' · ' + stopTxt : ''}${mv && mv.etaOpEnd ? ' · fertig ca. ' + tc(mv.etaOpEnd) : ''}` });
      } else if (op.state === 'external') {
        s = `**in Fremdbearbeitung** – ${op.ext ? op.ext.returnText : ''}`;
        Object.assign(r, { st: 'ext', pill: 'extern', c: 'var(--ext)', sub: op.ext ? op.ext.returnText : 'in Fremdbearbeitung' });
      } else if (op.state === 'waiting') {
        const b = isM ? blockerOn(c, op.station, o.id, op.seq) : null;
        const bl = b ? (b.running.length ? `nach ${b.running[0].orderId} AG ${b.running[0].seq} (läuft bis ${tc(b.running[0].end)})` : `nach ${listJoin(b.before.slice(0, 2).map(e => e.orderId + ' AG ' + e.seq))}`) : '';
        s = `wartet${op.waiting ? ' (' + stk(op.waiting) + ' im Eingang)' : ''}${op.good ? ', ' + nm(op.good) + ' fertig' : ''}${bl ? ' – ' + bl : ''}${startEnd ? '; ' + startEnd : ''}`;
        Object.assign(r, { st: 'wait', pill: 'wartet', c: 'var(--st-wait)', pct: op.target && op.good ? Math.min(1, op.good / op.target) : null,
          sub: [op.waiting ? stk(op.waiting) + ' im Eingang' : '', op.good ? nm(op.good) + ' fertig' : '', bl, startEnd].filter(Boolean).join(' · ') });
      } else {
        s = startEnd || 'noch nicht eingeplant';
        Object.assign(r, { sub: startEnd || 'noch nicht eingeplant', pill: op.station === 'EXT' ? 'extern' : 'geplant' });
      }
      r.where = where;
      routeTxt.push(`- AG ${op.seq} ${op.op} · ${where}: ${s}`);
      route.push(r);
    });
    SLOT(a, 'route', routeTxt.join('\n'), route);
    const cont = o.containers.filter(x => x.state !== 'shipped' && x.state !== 'scrap');
    if (cont.length && focus !== 'eta' && focus !== 'why') {
      // je Ort zusammenfassen: „WFL M80 · Eingang: 5 Stk (2 Behälter)“
      const byW = [];
      for (const x of cont) { const g = byW.find(y => y.w === x.where); if (g) { g.q += x.qty; g.n++; } else byW.push({ w: x.where, q: x.qty, n: 1 }); }
      a.md.push('', `Behälter: ${byW.slice(0, 4).map(g => `${g.w} ${stk(g.q)}${g.n > 1 ? ' (' + g.n + ' Behälter)' : ''}`).join('; ')}${byW.length > 4 ? ' (+' + (byW.length - 4) + ' Orte)' : ''}.`);
    }
    if (!dc && !ew && o.bottleneck) a.md.push('', `Begrenzt durch ${o.bottleneck}.`);
    let eilOk = false;
    if (o.risk !== 'ok') {
      const adv = adviceText(c, o); eilOk = adv.eilOk;
      a.md.push('', '> **Empfehlung:** ' + adv.text);
      for (const x of adv.actions) addAction(a, x);
    } else a.md.push('', `> **Einschätzung:** Termin hält nach aktueller Prognose – keine Maßnahme nötig.`);
    a.sources = ['Auftrag ' + id + ' (Arbeitsgang-Kette)', 'Prognose / Plantafel', 'Was-wäre-wenn Eilauftrag', srcStand()];
    const cur = curOp(o), bm = ew && ew.station ? ew.station : dc && dc.main && dc.main.station ? dc.main.station : bnMachine(o);
    a.followups = [cur && S().machines[cur.station] ? `Was macht ${cur.station} gerade?` : 'Welche Aufträge sind gefährdet und warum?', bm && S().machines[bm] ? `Was passiert, wenn ${bm} 2 h ausfällt?` : 'Was ist der Engpass?'];
    if (focus !== 'why' && o.risk !== 'ok') a.followups.unshift(`Warum ist ${o.id} ${late ? 'verspätet' : 'knapp'}?`);
    if (eilOk) a.followups.unshift(`${o.id} als Eilauftrag kennzeichnen`);
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
    let until = t + 2 * 3600, horizon = 'in den nächsten 2 Stunden', h2 = true;
    if (/heute|bis abend|tagsueber/.test(q)) { until = Math.floor(t / DAY) * DAY + 22 * 3600; horizon = 'bis 22:00'; h2 = false; }
    else if (/schicht/.test(q) && sh.id) { until = sh.endsAt; horizon = 'bis Schichtende ' + clk(sh.endsAt); h2 = false; }
    else if (/nacht|geisterschicht|morgen frueh/.test(q)) { until = t + 12 * 3600; horizon = 'in den nächsten 12 Stunden'; h2 = false; }
    else { const m = /(\d+)\s*(h|std|stunden?)/.exec(q); if (m) { until = t + Number(m[1]) * 3600; horizon = `in den nächsten ${m[1]} Stunden`; h2 = Number(m[1]) === 2; } }
    if (until <= t) { until = t + 2 * 3600; h2 = true; }
    // ein Wechselplan mit der Werkzeuge-Ansicht: geplant (Engine) + voraussichtlich (dort hochgerechnet); 2 h = dieselbe Kennzahl
    const rows = toolPlan(c, until, { onlyProj: h2 });
    const plan = rows.filter(r => r.kind === 'plan'), proj = rows.filter(r => r.kind === 'proj');
    const nPlanTools = plan.reduce((n, r) => n + r.tools.length, 0);
    const mvs = c.mvs();
    const nowTools = [];
    for (const mv of mvs) for (const tl of mv.tools || []) if (tl.status === 'due' || tl.status === 'broken' || tl.status === 'changing') nowTools.push({ mv, tl });
    a.eyebrow = 'Werkzeuge · Wechselplanung';
    a.head = rows.length ? `${horizon === 'in den nächsten 2 Stunden' ? 'Bis ' + clk(until) : uc1(horizon)}: ${nPlanTools ? pl(nPlanTools, 'Werkzeug', 'Werkzeuge') + ' geplant' : 'nichts geplant'}${proj.length ? ', ' + proj.length + ' voraussichtlich' : ''}` : `Kein Werkzeugwechsel ${horizon}`;
    a.sev = mvs.some(m => m.state === 'waitTool') ? 'warn' : rows.some(g => g.waitFromT != null && g.waitFromT <= until) ? 'warn' : 'ok';
    const nIdx = rows.filter(r => r.index).length, nBy = plan.filter(r => !r.index && r.by).length, nRep = plan.filter(r => !r.index).length;
    a.stats = [
      { l: 'Geplant', v: nm(nPlanTools), s: plan.length ? 'nächster ' + clk(plan[0].t) + ' an ' + plan[0].machine : 'angekündigt' },
      { l: 'Voraussichtlich', v: nm(proj.length), s: proj.length ? 'erster ca. ' + clk(proj[0].t) : 'hochgerechnet' },
      { l: 'Schneide wenden', v: nm(nIdx), s: 'Bediener:in, 1–2 min' },
      { l: 'Einrichter:in', v: nRep ? nm(nBy) + ' / ' + nm(nRep) : '–', s: nRep ? 'zugeteilt' : 'kein Tausch geplant', c: nRep && nBy < nRep && sh.id ? 'warn' : '' },
    ];
    a.md.push(`Geplant = angekündigt (Einrichter:in informiert), voraussichtlich = aus Reststandzeit und Taktzeit hochgerechnet – dieselben Zeiten wie in der Werkzeuge-Ansicht.`, '');
    const line = (g) => {
      const waitNow = g.waitFromT != null && g.waitFromT <= t + 60;
      const late = sh.id && g.t > sh.endsAt && !nextShiftStaffed(g.t);
      const what = `${chgVerb(g)} ${g.tools.map(x => toolShort(x.name)).join(' + ')}`;
      const who = g.kind === 'proj' ? (g.index ? 'Bediener:in' : 'noch nicht angekündigt') : chgWho(g, !!sh.id);
      return `- **${tc(g.t)}** ${mName(g.machine)} – ${what} nach Teil ${g.kind === 'proj' ? '~' : ''}${g.afterPart}${g.kind === 'proj' ? ' · *voraussichtlich*' : ''} · ${who}${g.manual ? ' · vorbeugend beauftragt' : ''}${g.waitFromT != null ? (waitNow ? ' · Maschine steht bereits' : ' · Maschine wartet ab ' + clk(g.waitFromT)) : ''}${late ? ' · außerhalb der Schicht' : ''}`;
    };
    SLOT(a, 'tplan', rows.slice(0, 9).map(line).join('\n') + (rows.length > 9 ? `\n- … und ${rows.length - 9} weitere` : ''), rows.slice(0, 9).map(g => ({
      t: g.t, tTxt: tc(g.t), machine: g.machine, short: station(g.machine).short, kind: g.kind, index: !!g.index, what: chgVerb(g), tools: g.tools.map(x => toolShort(x.name)).join(' + '),
      after: (g.kind === 'proj' ? '~' : '') + g.afterPart, who: g.kind === 'proj' ? (g.index ? 'Bediener:in' : 'Ankündigung folgt') : chgWho(g, !!sh.id), warn: g.waitFromT != null, waitTxt: g.waitFromT != null ? (g.waitFromT <= t + 60 ? 'steht bereits' : 'wartet ab ' + clk(g.waitFromT)) : '' })).concat(rows.length > 9 ? [{ more: rows.length - 9 }] : []));
    const waitT = mvs.filter(m => m.state === 'waitTool');
    const nowOther = nowTools.filter(x => !waitT.some(m => m.id === x.mv.id));
    if (nowOther.length) a.md.push('', `Jetzt: ${nowOther.map(x => `${mName(x.mv.id)} ${toolShort(x.tl.name)} – ${label('toolStatus', x.tl.status)}`).join('; ')}.`);
    if (waitT.length) a.md.push('', `Wartet auf Werkzeug: ${waitT.map(m => `${mName(m.id)} seit ${clk(m.since)} (${causeCore(m)})`).join('; ')}${waitT.some(noStaff) && !sh.id ? ` – niemand im Dienst bis ${clk(sh.endsAt)}` : ''}.`);
    // Werkzeugausgabe: kein vermessenes Werkzeug für anstehende Wechsel (nur Tausch – Wenden braucht kein neues Werkzeug)
    const stock = S().toolStock || {};
    const empty = [];
    for (const g of rows) if (!g.index) for (const tl of g.tools) if (stock[tl.typeId] && stock[tl.typeId].ready <= 0 && empty.indexOf(tl.typeId) < 0) empty.push(tl.typeId);
    if (empty.length) a.md.push(`Werkzeugausgabe: kein vermessenes ${empty.map(x => toolShort((PROF().toolTypeById[x] || {}).name || x)).join(', ')} vorrätig – Voreinstellen verlängert den Wechsel um einige Minuten.`);
    const k = c.k();
    a.md.push('', `Heute bisher ${pl(k.toolChangesToday || 0, 'Werkzeugwechsel', 'Werkzeugwechsel')}, Werkzeugkosten ${eur(k.toolCostToday)}.`);
    const ghost = c.notifs().filter(n => String(n.key).indexOf('ghost:') === 0);
    if (ghost.length) a.md.push(`Geisterschicht: ${ghost.map(n => n.title.replace('Geisterschicht: ', '')).join('; ')}.`);
    let rec;
    const rep = plan.filter(g => !g.index);
    if (waitT.length && waitT.every(noStaff)) rec = `${listJoin(waitT.map(m => m.id))} ${waitT.length === 1 ? 'steht' : 'stehen'} bis zum Schichtbeginn – Wechsel dort als Erstes${settersNext().length ? ' (' + settersNext().join(', ') + ')' : ''}; künftig vor Schichtende vorbeugend wechseln.`;
    else if (waitT.length) rec = `Einrichter:in sofort zu ${listJoin(waitT.filter(m => !noStaff(m)).map(m => m.id))} – die Maschine steht, bis das Werkzeug gewechselt ist.`;
    else if (rows.some(g => g.waitFromT != null)) { const g = rows.find(x => x.waitFromT != null); rec = `${g.machine}: ${g.index ? 'Bediener:in' : 'Einrichter:in'} kommt voraussichtlich erst nach der Teilegrenze – früher einplanen, sonst steht die Maschine ab ca. ${clk(g.waitFromT)}.`; }
    else if (rep.some(g => !g.by && g.stage !== 'später' && sh.id)) { const g = rep.find(x => !x.by && x.stage !== 'später'); rec = `${g.machine}: Einrichter:in für den Werkzeugwechsel ca. ${clk(g.t)} zuteilen${g.stage === 'Werkzeug liegt bereit' ? ' – das Werkzeug liegt bereit' : ' und Werkzeug vermessen bereitlegen'}.`; }
    else if (rep.length) rec = `Die Werkzeugwechsel sind besetzt bzw. vorbereitet; Wechsel an derselben Maschine werden automatisch gebündelt.${nIdx ? ' Das Wenden der Schneiden erledigen die Bediener:innen an der Maschine.' : ''}`;
    else if (rows.length) rec = nIdx === rows.length ? 'Nur Schneiden wenden – das erledigen die Bediener:innen an der Maschine (1–2 min); kein Einrichter nötig.' : 'Die voraussichtlichen Wechsel werden mit Uhrzeit und Einrichter:in angekündigt – derzeit keine Aktion nötig.';
    else rec = 'Keine Werkzeugaktion nötig – die Standzeiten reichen über den Zeitraum.';
    if (ghost.length && ghost[0].actions && ghost[0].actions.find(x => x.action.type === 'planToolChange')) { const ga = ghost[0].actions.find(x => x.action.type === 'planToolChange'); addAction(a, { label: ga.label + ' (' + ghost[0].entity.id + ')', desc: ghost[0].suggestion, action: ga.action, icon: 'wrench' }); }
    a.md.push('', '> **Empfehlung:** ' + rec);
    if ((WF.views || []).some(v => v.id === 'werkzeuge')) addAction(a, { label: 'Werkzeuge-Ansicht öffnen', desc: 'Zeitleiste geplant / voraussichtlich je Maschine', action: { type: 'navigate', view: 'werkzeuge' }, icon: 'wrench', quiet: true });
    a.sources = ['Wechselplan der Engine (angekündigt)', 'Hochrechnung der Werkzeuge-Ansicht (voraussichtlich)', 'Werkzeugausgabe', srcStand()];
    a.followups = rows.length ? [`Wann ist der nächste Werkzeugwechsel an ${rows[0].machine}?`, 'Wo verlieren wir heute Geld?'] : ['Wie läuft die Schicht?'];
    return done(a);
  }
  function nextShiftStaffed(t) { const s = t % DAY, d = Math.floor(t / DAY) % 7; return d < 5 && s >= 6 * 3600 && s < 22 * 3600; }

  // ------------------------------------------------------------------ Material
  function ansMaterial(c, ids) {
    const a = A('material');
    const { need, users, gross, mag } = materialNeeds();
    const mats = Object.values(S().materials).filter(mt => !ids || !ids.length || ids.indexOf(mt.id) >= 0);
    const rows = mats.map(mt => {
      const nd = need[mt.id] || 0;
      const status = mt.onHand < mt.min ? 'unter' : mt.onHand + mt.onOrder < nd ? 'fehlt' : mt.onHand < mt.min * 1.2 || mt.onHand + mt.onOrder - nd < mt.min ? 'knapp' : 'ok';
      return { mt, nd, status };
    });
    const rank = { unter: 0, fehlt: 1, knapp: 2, ok: 3 };
    rows.sort((x, y) => rank[x.status] - rank[y.status] || x.mt.onHand / x.mt.min - y.mt.onHand / y.mt.min);
    const crit = rows.filter(r => r.status !== 'ok');
    const single = ids && ids.length === 1;
    if (single) {
      const r = rows[0], mt = r.mt;
      a.entity = { kind: 'material', id: mt.id };
      a.eyebrow = 'Material · ' + mt.id; a.sev = r.status === 'ok' ? 'ok' : r.status === 'fehlt' ? 'crit' : 'warn';
      a.head = `${mt.name}: ${mt.onHand + (mt.onOrder || 0) >= r.nd ? (mt.onHand >= r.nd ? 'reicht für alle offenen Aufträge' : 'reicht mit der offenen Bestellung') : 'reicht nicht für die offenen Aufträge'}`;
      a.md.push(`Bestand **${matQty(mt, mt.onHand)}**, Mindestbestand ${matQty(mt, mt.min)}${mt.onOrder ? ', bestellt ' + matQty(mt, mt.onOrder) : ''} – Lagerort ${WF.sim.stationName(mt.location)}.`, '');
      a.stats = [{ l: 'Bestand', v: matQty(mt, mt.onHand), s: 'Min. ' + matQty(mt, mt.min), c: mt.onHand < mt.min ? 'warn' : 'ok' }, { l: 'Bedarf offen', v: matQty(mt, r.nd), s: 'noch nicht ausgebucht' }, { l: 'Bestellt', v: mt.onOrder ? matQty(mt, mt.onOrder) : '–', s: openPurchases(mt.id)[0] ? 'Lieferung ' + dueTxt(openPurchases(mt.id)[0].etaT) : 'keine Bestellung', c: mt.onOrder ? 'info' : '' }];
      const mg = mag[mt.id] || [], ul = users[mt.id] || [];
      const usersTxt = ul.map(u => `${u.orderId}: ${nm(u.parts)} × ${nm(u.perPart, u.perPart < 1 ? 3 : 0)} ${mt.unit}`).join(' + ');
      a.md.push(`- Bedarf offener Aufträge (noch nicht ausgebucht): ca. ${matQty(mt, r.nd)}${ul.length ? ' – ' + usersTxt + (mg.length ? ` = ${matQty(mt, gross[mt.id] || 0)}, abzüglich ${mg.map(x => matQty(mt, x.m) + ' im Stangenmagazin ' + x.machine).join(' und ')} → ${matQty(mt, r.nd)}` : '') : ''}.`);
      a.md.push(`- ${mt.onHand >= r.nd ? 'Bestand reicht für alle offenen Aufträge' + (mt.onHand - r.nd < mt.min ? ', danach unter Mindestbestand' : '') : 'Bestand reicht nicht: es fehlen ca. ' + matQty(mt, r.nd - mt.onHand) + (mt.onOrder ? ' (Bestellung deckt ' + (mt.onHand + mt.onOrder >= r.nd ? 'den Rest' : 'nur einen Teil') + ')' : '')}.`);
      if (mt.usedToday) a.md.push(`- Verbrauch heute: ${matQty(mt, mt.usedToday)}.`);
      for (const p of openPurchases(mt.id)) a.md.push(`- Bestellung ${p.id}: ${matQty(mt, p.qty)} bei ${p.supplier}, Lieferung ca. ${dueTxt(p.etaT)}.`);
      a.md.push(`- Lieferant: ${mt.supplier}, Lieferzeit ca. ${durR(mt.leadMin * 60)}, ${eurUnit(mt.pricePerUnit)} je ${mt.unit}.`);
      if (r.status !== 'ok' && !mt.onOrder) { addAction(a, reorderAction(mt)); a.md.push('', `> **Empfehlung:** Nachbestellen (${matQty(mt, mt.reorderQty)}, ca. ${eur(mt.reorderQty * mt.pricePerUnit)}).`); }
    } else {
      const nU = rows.filter(r => r.status === 'unter' || r.status === 'fehlt').length, nK = rows.filter(r => r.status === 'knapp').length, nOk = rows.length - nU - nK;
      a.eyebrow = 'Material · Rohmaterial'; a.sev = rows.some(r => r.status === 'fehlt' && !r.mt.onOrder) ? 'crit' : nU ? 'warn' : nK ? 'info' : 'ok';
      a.head = nU ? `${nU} ${nU === 1 ? 'Material' : 'Materialien'} unter Mindestbestand${nK ? `, ${nK} knapp` : ''}` : nK ? `Kein Material unter Mindestbestand – ${nK} knapp` : `Alle ${rows.length} Rohmaterialien im grünen Bereich`;
      a.md.push(nU || nK ? `${nOk} weitere im grünen Bereich${rows.some(r => r.status === 'fehlt') ? '; mindestens eines reicht nicht für die offenen Aufträge' : ''}.` : 'Bestand über Mindestbestand und ausreichend für die offenen Aufträge.', '');
      for (const r of (crit.length ? crit : rows.slice(0, 4))) {
        const mt = r.mt;
        const covers = mt.onHand >= r.nd;
        const after = mt.onHand + (mt.onOrder || 0) - r.nd;
        const st = r.status === 'unter' ? (covers ? 'unter Mindestbestand, reicht aber für die offenen Aufträge' : 'unter Mindestbestand und zu wenig für die offenen Aufträge') : r.status === 'fehlt' ? 'reicht nicht für die offenen Aufträge'
          : r.status === 'knapp' ? (after < mt.min ? `reicht für die offenen Aufträge, danach ca. ${matQty(mt, Math.max(0, after))} – unter Mindestbestand` : 'knapp über Mindestbestand') : 'ausreichend';
        a.md.push(`- **${mt.name}**: ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}) – ${st}; Bedarf offener Aufträge ca. ${matQty(mt, r.nd)}${mt.onOrder ? '; bestellt ' + matQty(mt, mt.onOrder) + (openPurchases(mt.id)[0] ? ', Lieferung ca. ' + dueTxt(openPurchases(mt.id)[0].etaT) : '') : ''}.`);
      }
      const starved = c.mvs().filter(m => m.state === 'starved');
      if (starved.length) a.md.push(`- Wartet auf Material: ${starved.map(m => `${mName(m.id)} – ${m.cause}`).join('; ')}.`);

      const bars = c.mvs().filter(m => m.barStockM != null);
      for (const m of bars) a.md.push(`- ${mName(m.id)}: Stangenmagazin ${nm(m.barStockM, 1)} m ${m.barMaterial || ''}${m.barStockM < (m.barReorderM || 0) ? ' – wird nachgeladen' : ''}.`);
      const pur = openPurchases();
      if (pur.length) a.md.push(`- Offene Bestellungen: ${pur.map(p => `${p.id} ${matQty(S().materials[p.materialId], p.qty)} ${S().materials[p.materialId].name}, Lieferung ca. ${dueTxt(p.etaT)}`).join('; ')}.`);
      if (rows.length > 1) {
        a.md.push('', '### Bestände');
        SLOT(a, 'stock', rows.map(r => `- ${r.mt.name}: ${matQty(r.mt, r.mt.onHand)} (Min. ${matQty(r.mt, r.mt.min)}, Bedarf ca. ${matQty(r.mt, r.nd)})`).join('\n'),
          rows.map(r => ({ id: r.mt.id, name: r.mt.name, on: r.mt.onHand, min: r.mt.min, nd: r.nd, ord: r.mt.onOrder || 0, status: r.status, q: matQty(r.mt, r.mt.onHand), minQ: matQty(r.mt, r.mt.min), ndQ: matQty(r.mt, r.nd), ordQ: r.mt.onOrder ? matQty(r.mt, r.mt.onOrder) : '' })));
        a.md.push('');
      }
      const toOrder = crit.filter(r => !r.mt.onOrder && r.status !== 'knapp');
      for (const r of toOrder) addAction(a, reorderAction(r.mt));
      const soon = crit.filter(r => r.status === 'knapp' && !r.mt.onOrder);
      const soonTxt = soon.length ? ` ${listJoin(soon.map(r => r.mt.name))}: nächste Bestellung einplanen – nach den offenen Aufträgen unter Mindestbestand.` : '';
      a.md.push('', '> **Empfehlung:** ' + (toOrder.length ? `${toOrder.map(r => r.mt.name).join(', ')} nachbestellen – ${toOrder.length === 1 ? 'Bestellvorschlag' : 'Bestellvorschläge'} unten.${soonTxt}` : soon.length ? soonTxt.trim() : crit.length ? 'Bestellungen laufen; Liefertermine im Blick behalten.' : 'Keine Bestellung nötig.'));
    }
    a.sources = ['Rohmaterialbestände', 'Bedarf aus offenen Arbeitsgängen', 'Bestellungen', srcStand()];
    a.followups = single ? ['Welches Material wird knapp?', 'Wie läuft die Schicht?'] : ['Was machen die AGVs gerade?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Personal
  function ansPeople(c, ids, roles, q) {
    const a = A('people');
    q = q || '';
    const all = Object.values(S().people);
    let list = all;
    if (ids && ids.length) list = all.filter(p => ids.indexOf(p.id) >= 0);
    else if (roles && roles.length) list = all.filter(p => roles.some(r => p.role.indexOf(r) === 0));
    const whereMap = {};
    for (const mv of c.mvs()) for (const p of [mv.operator].concat(mv.people || [])) if (p && !p.responsible) whereMap[p.id] = p.where;
    const whereOf = (p) => whereMap[p.id] || personWhere(p);
    if ((!ids || !ids.length) && roles && roles.length) { const onR = list.filter(p => p.state !== 'offShift'); if (onR.length === 1) { ids = [onR[0].id]; list = onR; } }
    if (ids && ids.length === 1) {
      const p = list[0], d = pDisp(p);
      a.entity = { kind: 'person', id: p.id };
      a.eyebrow = `Personal · ${p.role} · ${p.shift === 'F' ? 'Frühschicht' : 'Spätschicht'}`; a.sev = p.state === 'offShift' ? 'info' : 'ok';
      a.head = `${p.name} ${personVerb(p, p.state !== 'offShift' && p.state !== 'break' ? whereOf(p) : '')}`;
      if (p.state !== 'offShift') {
        if (d.key === 'tending') a.md.push(`Ohne eigene Aufgabe an den eigenen laufenden Maschinen (${d.machines.join(', ')}) – zählt in der Personalansicht als „im Einsatz“.`);
        else if (d.key === 'lead') a.md.push('Schichtleitung im Leitstand – zählt in der Personalansicht als „im Einsatz“.');
        else if (!/^bereit$/i.test(p.activity || '')) a.md.push(`Tätigkeit: ${p.activity}.`);
        a.md.push('');
        if (p.task) { const tl = p.task.label || label('task', p.task.type); a.md.push(`- Aufgabe: ${tl}${p.task.machineId && tl.indexOf(p.task.machineId) < 0 ? ' an ' + mName(p.task.machineId) : ''}.`); }
        a.md.push(`- Auslastung heute ${pct(p.utilToday)}, ${pl(p.tasksToday || 0, 'Aufgabe', 'Aufgaben')} erledigt.`);
      } else a.md.push('', `- ${p.shift === 'F' ? 'Frühschicht 06:00–14:00' : 'Spätschicht 14:00–22:00'}.`);
      if (p.machines && p.machines.length) a.md.push(`- Zuständig für: ${p.machines.map(mName).join(', ')}.`);
      a.md.push(`- Qualifikationen: ${p.skills.map(skillLabel).join(', ')}.`);
      a.sources = ['Personaleinsatz live (wie Personalansicht)', srcStand()];
      a.followups = p.machines && p.machines.length ? [`Was macht ${p.machines[0]} gerade?`, 'Wer ist gerade wo?'] : ['Wer ist gerade wo?'];
      return done(a);
    }
    const on = list.filter(p => p.state !== 'offShift');
    const sh = WF.sim.shift();
    const wantFree = /verfuegbar|\bfrei\b|zeit hat|zeit haben|wer hat zeit|wer kann|unbeschaeftigt|ohne aufgabe/.test(q);
    a.eyebrow = 'Personal · ' + (sh.id ? sh.name : 'keine Schicht'); a.sev = 'info';
    if (!on.length) {
      a.md.push(`**Niemand ${roles && roles.length ? 'aus dieser Rolle ' : ''}im Dienst** (${sh.id ? sh.name : 'keine Schicht'}).`);
      if (!sh.id) a.md.push(`Nächster Schichtbeginn ${dueTxt(sh.endsAt)} – bis dahin laufen nur autonome Maschinen (Geisterschicht).`);
    } else {
      // dieselbe Einteilung wie die Kennzahl der Personalansicht („Im Einsatz 9/10 · 5 mit Aufgabe · 3 betreuen Maschinen · Schichtleitung · 1 verfügbar“)
      const cc = crewCounts(on);
      const who = roles && roles.length ? ' (' + roles.join(', ') + ')' : '';
      if (wantFree) a.head = cc.free.length ? `${cc.free.length} verfügbar: ${listJoin(cc.free.map(p => sn(p.name)))}` : `Gerade niemand verfügbar${who} – ${cc.einsatz} von ${on.length} im Einsatz`;
      else a.head = `${on.length} ${on.length === 1 ? 'Person' : 'Personen'}${who} im Dienst – ${cc.einsatz} im Einsatz, ${cc.free.length} verfügbar`;
      a.md.push(`${uc1(cc.txt)}. Im Einsatz zählt, wer eine Aufgabe hat, eigene laufende Maschinen betreut oder die Schicht leitet – wie in der Personalansicht.`);
      a.stats = [{ l: 'Im Einsatz', v: nm(cc.einsatz) + ' / ' + nm(on.length), s: `${cc.task} mit Aufgabe${cc.tend ? ' · ' + cc.tend + ' betreuen' : ''}` }, { l: 'Verfügbar', v: nm(cc.free.length), s: cc.free.length ? listJoin(cc.free.slice(0, 2).map(p => sn(p.name))) : 'niemand' }, { l: 'Pause', v: nm(cc.brk), s: sh.inBreak ? 'bis ' + clk(sh.breakEndsAt) : 'gerade' }];
      const ORD = wantFree ? { idle: 0, tending: 1, lead: 2, working: 3, driving: 3, walking: 4, break: 5 } : { working: 0, driving: 0, walking: 1, tending: 2, lead: 3, idle: 4, break: 5 };
      const rows = on.map(p => ({ p, d: pDisp(p) }));
      const sorted = rows.sort((x, y) => ((ORD[x.d.key] != null ? ORD[x.d.key] : 6) - (ORD[y.d.key] != null ? ORD[y.d.key] : 6)) || x.p.id.localeCompare(y.p.id));
      const actOf = (x) => (x.d.key === 'idle' ? (/^bereit$/i.test(x.p.activity || '') ? '' : x.p.activity) : x.d.key === 'tending' ? 'an den eigenen laufenden Maschinen' : x.d.key === 'lead' ? 'im Leitstand' : actWhere(x.p.activity, x.p.state === 'break' ? '' : whereOf(x.p)));
      SLOT(a, 'crew', sorted.map(x => `- **${sn(x.p.name)}** (${x.p.role}) – ${x.d.label}${actOf(x) ? ': ' + actOf(x) : ''}`).join('\n'),
        sorted.map(x => ({ id: x.p.id, name: sn(x.p.name), full: x.p.name, role: x.p.role, state: x.d.key, st: x.d.label, act: actOf(x), util: x.p.utilToday })));
    }
    const wo = c.mvs().filter(m => m.state === 'waitOperator' && m.sinceSec >= 120);
    if (wo.length && wo.every(noStaff)) a.md.push('', ...groupNoStaff(wo));
    else if (wo.length) a.md.push('', `Warten auf Bedienung: ${wo.map(m => `${mName(m.id)} – ${m.cause}`).join('; ')}.`);
    if (sh.id) {
      const next = all.filter(p => p.shift !== sh.id);
      a.md.push('', `Nächste Schicht (${sh.id === 'F' ? 'Spätschicht ab 14:00' : 'Frühschicht ab 06:00'}): ${next.length} Personen – ${roleSummary(next)}.`);
    }
    a.sources = ['Personaleinsatz live (Einteilung wie Personalansicht)', 'Schichtplan', srcStand()];
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
    a.eyebrow = 'Qualität · heute';
    a.head = !(k.good + k.scrap > 0) ? 'Heute noch keine Teile gefertigt' : `FPY heute ${pct(k.fpy, 1)} – ${nm(k.scrap)} Ausschuss`;
    a.md.push(`${nm(k.good)} Gutteile (je Arbeitsgang gezählt), ${nm(k.scrap)} Ausschuss${k.scrap ? ' (' + Object.keys(by).filter(x => by[x]).map(x => x + ' ' + by[x]).join(', ') + ')' : ''}.`);
    a.stats = [
      { l: 'FPY heute', v: k.good + k.scrap > 0 ? pct(k.fpy, 1) : '–', s: k.good + k.scrap > 0 ? 'gut / alle je AG' : 'noch keine Teile', c: !(k.good + k.scrap > 0) ? '' : k.fpy >= 0.98 ? 'ok' : 'warn' },
      { l: 'Ausschuss', v: nm(k.scrap) + ' Stk', s: Object.keys(by).filter(x => by[x]).map(x => x + ' ' + by[x]).join(' · ') || 'heute', c: k.scrap ? 'warn' : 'ok' },
      { l: 'Erstteile i.O.', v: nm(k.fpiOk || 0) + ' / ' + nm((k.fpiOk || 0) + (k.fpiNok || 0)), s: 'geprüft heute', c: k.fpiNok ? 'warn' : 'ok' },
    ];
    // Prozessfähigkeit wie die Qualitätsansicht („5 von 9 fähig“)
    const caps = capRows(c), capLow = caps.filter(r => r.d.cpk < 1.33);
    if (caps.length) a.stats.push({ l: 'Fähig', v: (caps.length - capLow.length) + '/' + caps.length, s: 'Merkmale mit Cpk ≥ 1,33', c: capLow.some(r => r.d.cpk < 1) ? 'crit' : capLow.length ? 'warn' : '' });
    a.md.push('');
    if (capLow.length) a.md.push(`- **Prozessfähigkeit: ${caps.length - capLow.length} von ${caps.length} Merkmalen fähig** – nicht fähig: ${capLow.slice(0, 4).map(r => `${capName(r)} Cpk ${nm(r.d.cpk, 2)}`).join(', ')}${capLow.length > 4 ? ' u. a.' : ''}.`);
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
    else if (capLow.length) { const r0 = capLow[0], ex = capExplain(r0.d); rec = `${capName(r0)} zuerst (Cpk ${nm(r0.d.cpk, 2)}): ${ex.lage && !ex.streu ? 'Werkzeugkorrektur zentriert den Prozess' : ex.lage ? 'zentrieren hebt Cpk höchstens auf Cp ' + nm(r0.d.cp, 2) + ', zusätzlich die Streuung senken (Werkzeug, Spannung)' : 'Streuung senken (Werkzeug, Spannung, Schnittwerte)'}.`; }
    else rec = 'Prozess stabil – keine Maßnahme nötig.';
    a.sev = spcOpen.length || repeat || fpiWait.length || capLow.some(r => r.d.cpk < 1) ? 'warn' : 'ok';
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = ['Messwerte / SPC je Merkmal', 'Ausschussbuchungen heute', 'Erstteilprüfungen', srcStand()];
    a.followups = repeat ? [`Was macht ${repeat.mid} gerade?`, `Wann ist der nächste Werkzeugwechsel an ${repeat.mid}?`] : capLow.length && capLow[0].station ? [`Wie ist der Cpk an ${capLow[0].station}?`, 'Wo verlieren wir heute Geld?'] : ['Wo verlieren wir heute Geld?', 'Wie läuft die Schicht?'];
    if (capLow.length) a.sources.splice(1, 0, 'Prozessfähigkeit je Merkmal (wie Qualitätsansicht)');
    return done(a);
  }

  // ------------------------------------------------------------------ Kosten / Verluste
  function ansLoss(c) {
    const a = A('loss'), k = c.k();
    const L = lossByCause(c);
    const top = L.byMachine.filter(x => x.loss > 0).slice(0, 4);
    const lh = lossHead(k);
    a.eyebrow = 'Kosten · heute'; a.sev = 'warn';
    a.head = lh.split ? `Heute ${eur(lh.value)} Stillstandskosten in der Schichtzeit – zzgl. ${eur(lh.night)} in der Nacht` : `Heute bisher ${eur(k.lossEur)} Stillstandskosten`;
    a.md.push('Maschinenstundensatz × Zeit, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert – Schichtzeit ohne Pausen, autonome Maschinen auch in der Geisterschicht. Dieselbe Aufteilung wie in der Analyse.');
    a.stats = [
      { l: lh.split ? 'Stillstand · Schicht' : 'Stillstand', v: eur(lh.value), s: lh.split ? 'zzgl. Nacht ' + eur(lh.night) : 'heute', c: 'warn' },
      { l: 'Werkzeuge', v: eur(k.toolCostToday), s: pl(k.toolChangesToday || 0, 'Wechsel', 'Wechsel') },
      { l: 'Ausschuss', v: nm(k.scrap) + ' Stk', s: 'FPY ' + pct(k.fpy, 1), c: k.scrap ? 'warn' : 'ok' },
      { l: 'Energie', v: nm(k.energyKwh, 0) + ' kWh', s: 'jetzt ' + nm(k.powerKw, 0) + ' kW' },
    ];
    const stCol = (st) => (WF.STATE[st] || {}).color || 'var(--st-wait)';
    if (L.causes.length) {
      a.md.push('', lh.split ? '### Nach Ursache (Schichtzeit)' : '### Nach Ursache');
      const cs = L.causes.slice(0, 5).filter(x => x.eur >= 1);
      SLOT(a, 'bars1', cs.map(x => `- **${causeLabel(x.state)}**: ca. ${eur(x.eur)}`).join('\n'),
        { rows: cs.map(x => ({ label: causeLabel(x.state), v: x.eur, vTxt: eur(x.eur), sub: `${durR(x.sec)} an ${pl(x.machines, 'Arbeitsplatz', 'Arbeitsplätzen')} · ${pct(L.total > 0 ? x.eur / L.total : 0)} der Stillstandskosten`, c: stCol(x.state) })) });
    }
    if (top.length) {
      a.md.push('', '### Nach Arbeitsplatz');
      const txt = (x) => `${x.causes.length ? x.causes.slice(0, 2).map(y => `${causeLabel(y.state)} ${durR(y.sec)}`).join(', ') : 'Zustand vor Tagesbeginn'}${x.mv.state !== 'running' ? '; jetzt: ' + msl(x.mv) : ''}`;
      SLOT(a, 'bars2', top.map(x => `- **${mName(x.mv.id)}**: ${eur(x.loss)} (${eur(x.mv.rate)}/h) – ${txt(x)}`).join('\n'),
        { rows: top.map(x => ({ ent: { kind: 'machine', id: x.mv.id }, label: station(x.mv.id).short, v: x.loss, vTxt: eur(x.loss), sub: txt(x) + ' · ' + eur(x.mv.rate) + '/h', c: x.causes.length ? stCol(x.causes[0].state) : 'var(--st-wait)' })) });
    }
    if (lh.split && L.nightMachines.length) {
      a.md.push('', '### Nacht (Geisterschicht)');
      a.md.push(`${eur(lh.night)} – ${listJoin(L.nightMachines.slice(0, 3).map(x => `${mName(x.mv.id)} ${eur(x.eur)}`))}${L.nightCauses[0] ? `; vor allem ${causeLabel(L.nightCauses[0].state)} (${durR(L.nightCauses[0].sec)})` : ''}. Autonome Maschinen, die nachts stehen, sind ungenutzte Kapazität – getrennt von der Schichtzeit wie im Leitstand.`);
    }
    const nowLoss = c.mvs().filter(m => m.state !== 'running' && m.state !== 'idle' && WF.sim.shift().id && !WF.sim.shift().inBreak);
    if (nowLoss.length) a.md.push('', `Gerade kostet Stillstand ca. ${eur(nowLoss.reduce((s, m) => s + m.rate, 0))}/h: ${nowLoss.map(m => `${m.id} ${msl(m)}`).join(', ')}.`);
    const main = L.causes[0];
    const nMain = L.nightCauses[0];
    a.md.push('', '> **Empfehlung:** ' + (main ? `Größter Hebel ist **${causeLabel(main.state)}** (ca. ${eur(main.eur)}). ${CAUSE_ADVICE[main.state] || ''}${lh.split && nMain && nMain.eur > main.eur * 0.5 ? ' Nachts: ' + causeAdvice(nMain.state, k) : ''}` : lh.split && nMain ? causeAdvice(nMain.state, k) : 'Bisher kaum Stillstand – weiter so.'));
    a.sources = ['Stillstandskosten je Maschine und Zustand (Engine, wie Analyse)', 'Planzeit je Zustand', 'Kennzahlen heute', srcStand()];
    a.followups = top.length ? [`Was macht ${top[0].mv.id} gerade?`, 'Wie hoch ist der Energieverbrauch?', 'Was ist der Engpass?'] : ['Wie läuft die Schicht?'];
    return done(a);
  }
  /** Zustandsursachen einer Maschine heute (Schichtzeit): Segmente des Zustands mit der Ursache aus dem Zustandsereignis */
  function causeBreakdown(c, id, state) {
    const t = c.t, d0 = Math.floor(t / DAY) * DAY, mv = c.mv(id);
    const evs = (S().events || []).filter(e => e.type === 'state' && e.entity && e.entity.id === id && e.data && e.data.to === state && e.t >= d0 - DAY);
    const groups = {}, auto = mv.loading === 'auto';
    for (const sg of mv.segments || []) {
      if (sg.state !== state) continue;
      const a = Math.max(d0, sg.t0), b = Math.min(t, sg.t1 == null ? t : sg.t1);
      // autonome Maschinen zählen auch in der Geisterschicht (Planzeit der Engine), bemannte nur in der Schichtzeit
      const w = auto ? Math.max(0, b - a) : workBetween(a, b); if (w <= 0) continue;
      let ev = null; for (const e of evs) if (Math.abs(e.t - sg.t0) <= 2) ev = e;
      const cause = ev && ev.data.cause ? String(ev.data.cause) : stLabel(state);
      const key = cause.replace(/\d+([.,:]\d+)?/g, '#').replace(/\(.*?\)/g, '').slice(0, 60);
      const g = groups[key] || (groups[key] = { cause, sec: 0, n: 0 });
      g.sec += w; g.n++;
    }
    const out = Object.values(groups);
    // Summe auf die Planzeit der Engine abgleichen (gleiche Minuten wie Analyse und Kostenaufteilung)
    const tot = out.reduce((x, g) => x + g.sec, 0), ps = mv.plannedStateTimes && mv.plannedStateTimes[state];
    if (ps != null && tot > 0 && Math.abs(ps - tot) > 30) for (const g of out) g.sec = g.sec * ps / tot;
    return out.sort((x, y) => y.sec - x.sec);
  }
  function ansLossMachine(c, id, q) {
    const a = A('loss'), mv = c.mv(id);
    a.entity = { kind: 'machine', id };
    const row = lossByCause(c).byMachine.find(x => x.mv.id === id);
    const want = Object.keys(CAUSE_LABEL).find(k => q.indexOf(norm(CAUSE_LABEL[k]).split(' ').pop()) >= 0) || (/material/.test(q) ? 'starved' : /bediener/.test(q) ? 'waitOperator' : /werkzeug/.test(q) && /wartet/.test(q) ? 'waitTool' : /stoerung/.test(q) ? 'fault' : /erstteil/.test(q) ? 'firstPiece' : null);
    if (!row || !(row.loss > 0)) { a.md.push(row && row.night >= 0.5 ? `**${mName(id)}: in der Schichtzeit keine Stillstandskosten** – nur nachts in der Geisterschicht ${eur(row.night)}.` : `**${mName(id)}: heute keine Stillstandskosten** – die Maschine hat in der Schichtzeit produziert oder hatte keinen Auftrag.`); a.sources = ['Stillstandskosten je Maschine', srcStand()]; return done(a); }
    a.md.push(`**${mName(id)}: heute ${eur(row.loss)} Stillstandskosten${row.night >= 0.5 ? ' in der Schichtzeit' : ''}** – ${durR(row.lossSec)} mit Auftrag ohne Produktion, Satz ${eur(mv.rate)}/h.${row.night >= 0.5 ? ` Zusätzlich ${eur(row.night)} in der Nacht (Geisterschicht).` : ''}`, '');
    for (const x of row.causes.filter(y => y.eur >= 1 || y.sec >= 300)) a.md.push(`- **${causeLabel(x.state)}**: ca. ${eur(x.eur)} (${durR(x.sec)})`);
    if (want && !row.causes.some(x => x.state === want)) {
      const allDay = (mv.stateTimes && mv.stateTimes[want]) || 0;
      a.md.push('', `**${causeLabel(want)} an ${id}:** heute ${allDay > 0 ? 'nur außerhalb der Schichtzeit bzw. in Pausen (' + durR(allDay) + ') – das zählt nicht als Stillstandskosten' : 'nicht aufgetreten'}.`);
    }
    const focus = want && row.causes.some(x => x.state === want) ? want : row.causes[0] && row.causes[0].state;
    if (focus) {
      a.md.push('', `### Ursachen ${causeLabel(focus)}`);
      const br = causeBreakdown(c, id, focus);
      for (const g of br.slice(0, 4)) a.md.push(`- ${durR(g.sec)}${g.n > 1 ? ' (' + g.n + '×)' : ''}: ${g.cause}`);
      if (!br.length) a.md.push('- Keine Einzelereignisse in der Schichtzeit zuordenbar.');
      const d0 = Math.floor(c.t / DAY) * DAY;
      if (focus === 'fault') { const fs2 = (S().events || []).filter(e => e.type === 'fault' && e.t >= d0 && e.entity && e.entity.id === id); if (fs2.length) a.md.push(`- Alarme heute: ${fs2.map(e => clk(e.t) + ' ' + (e.data && e.data.code ? e.data.code : '')).join(', ')}.`); }
      if (focus === 'toolchange') { const tcs = (S().events || []).filter(e => e.type === 'toolChanged' && e.t >= d0 && e.entity && e.entity.id === id); if (tcs.length) a.md.push(`- ${pl(tcs.length, 'Werkzeugwechsel', 'Werkzeugwechsel')} heute, zusammen ${durR(tcs.reduce((s2, e) => s2 + ((e.data && e.data.durSec) || 0), 0))}${tcs.some(e => e.data && e.data.tools && e.data.tools.some(x => x.bundled)) ? ', teils gebündelt' : ''}.`); }
      a.md.push('', '> **Empfehlung:** ' + causeAdvice(focus, c.k()));
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
    const pr = ENERGY_PRICE(), cost = (k.energyKwh || 0) * pr.v;
    a.eyebrow = 'Energie · heute'; a.sev = 'info';
    a.head = `Energie heute: ${nm(k.energyKwh, 0)} kWh – ca. ${eur(cost)}`;
    a.md.push(`Aktuelle Leistung ${nm(k.powerKw, 0)} kW${peak ? `, Spitze heute ${nm(peak.v, 0)} kW um ${clk(peak.t)} (5-min-Mittel)` : ''}. Kosten mit ${U.fmtEur(pr.v, 2)}/kWh${pr.assumed ? ' (Annahme Industrietarif – im Profil hinterlegbar)' : ''}.`, '');
    a.stats = [{ l: 'Energie', v: nm(k.energyKwh, 0) + ' kWh', s: 'heute' }, { l: 'Kosten', v: eur(cost), s: U.fmtEur(pr.v, 2) + '/kWh' }, { l: 'Leistung', v: nm(k.powerKw, 0) + ' kW', s: peak ? 'Spitze ' + nm(peak.v, 0) + ' kW' : 'jetzt' }];
    for (const m of mvs.slice(0, 5)) a.md.push(`- **${mName(m.id)}**: ${nm(m.energyKwhToday, 0)} kWh (ca. ${eur((m.energyKwhToday || 0) * pr.v)}) heute, jetzt ${m.powerKw != null ? nm(m.powerKw, 1) + ' kW gemessen' : nm(m.powerKwEst, 1) + ' kW (Modellwert, nicht angebunden)'} – ${msl(m)}`);
    const idleDraw = c.mvs().filter(m => m.state !== 'running' && (m.powerKw != null ? m.powerKw : m.powerKwEst) >= 3);
    if (idleDraw.length) a.md.push('', `Grundlast ohne Produktion: ${idleDraw.map(m => `${m.id} ${nm(m.powerKw != null ? m.powerKw : m.powerKwEst, 1)} kW (${msl(m)})`).join(', ')} – zusammen ${nm(idleDraw.reduce((s, m) => s + (m.powerKw != null ? m.powerKw : m.powerKwEst), 0), 0)} kW.`);
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
    a.eyebrow = 'Logistik · AGV und Stapler'; a.sev = 'info';
    a.head = `${agvs.length === 1 ? agvs[0].name : agvs.length + ' AGVs'}, ${pl(trs.length, 'offener Transport', 'offene Transporte')}`;
    a.md.push(`Heute ${nm(c.k().transportsToday)} Transporte erledigt.`, '');
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
    // nur Aufträge, deren Liefertermin sich spürbar (≥ 5 min) verschiebt
    const moved = rows.filter(r => r.after - r.before >= 300);
    const quiet = rows.length - moved.length;
    moved.sort((x, y) => (y.after - y.o.due) - (x.after - x.o.due));
    const flips = moved.filter(r => r.before <= r.o.due && r.after > r.o.due), stillLate = moved.filter(r => r.before > r.o.due);
    a.eyebrow = `Was-wäre-wenn · Ausfall ${id}`;
    a.sev = flips.length ? 'crit' : stillLate.length ? 'warn' : 'ok';
    // Kernaussage: Annahme + Ergebnis
    if (!list.length) a.head = `Kein Einfluss auf Termine – an ${id} ist nichts eingeplant`;
    else if (!rows.length) a.head = `Kein Einfluss auf Termine – ${id} beginnt den nächsten Arbeitsgang erst ${tc(list[0].start)}`;
    else if (flips.length) a.head = `${pl(flips.length, 'Termin kippt', 'Termine kippen')}: ${listJoin(flips.map(r => r.o.id))}`;
    else if (stillLate.length) a.head = `Kein weiterer Termin kippt – ${listJoin(stillLate.map(r => r.o.id))} ${stillLate.length === 1 ? 'verschiebt sich' : 'verschieben sich'} weiter`;
    else if (moved.length) a.head = `Kein Termin kippt – ${moved.length === 1 ? moved[0].o.id + ' behält' : 'alle ' + moved.length + ' Aufträge behalten'} Puffer`;
    else a.head = `Kein Liefertermin verschiebt sich spürbar`;
    a.md.push(`Annahme: ${mName(id)} fällt ab jetzt (${clk(t)}) für ${durR(N)} aus – bis ca. ${tc(T1)}.${mv.state === 'fault' ? ` ${id} ist bereits gestört (${mv.fault.code}); betrachtet wird ein zusätzlicher Ausfall.` : ''}`, '');
    const lostTxt = durR(auto ? N : lostWork);
    a.stats = [
      { l: 'Ausfall', v: durR(N), s: `${auto ? 'Maschinenzeit' : 'Arbeitszeit'} ${lostTxt}`, c: 'info' },
      { l: 'Kosten', v: eur(cost), s: `${eur(mv.rate)}/h Stundensatz`, c: 'warn' },
      { l: 'Termine', v: flips.length ? pl(flips.length, 'kippt', 'kippen') : 'halten', s: moved.length ? `${moved.length} von ${rows.length} verschoben` : NOCHG, c: flips.length ? 'crit' : stillLate.length ? 'warn' : 'ok' },
    ];
    for (const r of moved) {
      const o = r.o, newSlack = o.due - r.after;
      let verdict;
      if (r.before > o.due) verdict = `bleibt verspätet (${durR(-newSlack)} statt ${durR(r.before - o.due)} Verzug)`;
      else if (newSlack < 0) verdict = `**kippt: ${durR(-newSlack)} Verzug** (bisher ${slackTxt(o.due - r.before)})`;
      else verdict = `hält (${slackTxt(newSlack)} statt ${durR(o.due - r.before)})`;
      a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}), AG ${r.e.seq}${r.e.active ? ' läuft hier' : ' ab ' + tc(Math.max(t, r.e.start))}: Prognose ${dueTxt(r.before)} → **${dueTxt(r.after)}** (${deltaTxt(r.after - r.before)}); Termin ${dueTxt(o.due)} ${verdict}.`);
    }
    if (quiet > 0 && rows.length) a.md.push(`- ${pl(quiet, 'weiterer Auftrag', 'weitere Aufträge')} an ${id}: ${NOCHG} am Liefertermin (unter 5 min – Folgeschritte fangen die Verschiebung auf).`);
    if (rows.length) {
      const nParts = mv.order && mv.order.cycleMin && mv.state === 'running' ? Math.min(Math.max(0, mv.partsTotal - mv.partsDone), Math.floor((auto ? N : lostWork) / (mv.order.cycleMin * 60 + (st.loading === 'perPart' ? (st.loadMin || 1) * 60 : 0)))) : 0;
      a.md.push(`- Kosten: ca. **${eur(cost)}** Stillstand (${eur(mv.rate)}/h × ${lostTxt} ${auto ? 'Maschinenzeit' : 'Arbeitszeit'})${nParts > 0 && mv.order ? `, ca. ${teile(nParts)} ${mv.order.id} weniger bis ${clk(T1)}` : ''}.`);
    }
    // Empfehlung: zuerst die Ausfallzeit an derselben Maschine aufholen, Eilauftrag nur nach der Engine-Regel und nie für
    // zwei Aufträge, die sich noch einen Arbeitsplatz teilen
    const recs = [];
    if (flips.length || stillLate.length) {
      const crit = flips.concat(stillLate);
      const shiftEnd = (() => { const W = workWindows(), base = Math.floor(t / WEEK) * WEEK, d0 = Math.floor(t / DAY) * DAY; let e = null; for (const w of W) { const b = base + w[1]; if (b >= d0 && b <= d0 + DAY) e = b; } return e; })();
      if (!auto) recs.push(`ca. ${durR(Math.max(900, lostWork))} Überstunden an ${id}${shiftEnd ? ' (nach Schichtende ' + clk(shiftEnd) + ' bzw. am Samstag)' : ''} holen den Ausfall auf.`);
      else recs.push(`${id} läuft auch unbemannt – den Ausfall über Nacht bzw. am Wochenende aufholen (Standzeit und Material sichern).`);
      const altOk = [...new Set(crit.flatMap(r => capableAlts(r.o.id, r.e.seq, id)))].filter(x => { const v = c.mv(x); return v && v.state !== 'fault'; });
      if (altOk.length) recs.push(`Verlagerung auf ${listJoin(altOk.slice(0, 2))} prüfen (dort neu rüsten).`);
      const remainSt = (o) => new Set(o.ops.filter(op => !op.complete && S().machines[op.station]).map(op => op.station));
      const eilFor = [];
      for (const r of crit.filter(x => x.o.priority !== 'eil')) {
        const adv = simAdvice(r.o.id);
        if (!(adv && adv.action && adv.action.type === 'setPriority')) continue;
        if (eilFor.some(y => [...remainSt(y.o)].some(sid => remainSt(r.o).has(sid)))) continue;
        eilFor.push(r);
      }
      const noEil = crit.filter(r => r.o.priority !== 'eil' && eilFor.indexOf(r) < 0);
      if (eilFor.length) recs.push(`Zusätzlich ${listJoin(eilFor.map(r => r.o.id))} als Eilauftrag – laut Was-wäre-wenn holt ${eilFor.length === 1 ? 'er' : 'jeder'} Zeit auf, ohne andere Aufträge spät zu machen.`);
      if (noEil.length) recs.push(`Eilauftrag für ${listJoin(noEil.map(r => r.o.id))} bringt nichts bzw. ginge zulasten anderer Aufträge.`);
      for (const r of eilFor) addAction(a, { label: `${r.o.id} als Eilauftrag`, desc: `Vorbeugend: ${r.o.id} wird an allen Arbeitsplätzen beim nächsten Auftragswechsel vorgezogen.`, action: { type: 'setPriority', orderId: r.o.id, priority: 'eil' }, icon: 'bolt' });
      if (flips.length) recs.push(`Bei echtem Ausfall ${listJoin([...new Set(flips.map(r => custShort(r.o.customer)))])} früh informieren.`);
    } else if (moved.length) recs.push(`Die Puffer reichen – ein Ausfall von ${durR(N)} kostet vor allem Maschinenzeit (ca. ${eur(cost)}).${st.loading !== 'auto' && mv.operator ? ' Bediener:in während des Ausfalls an einer anderen Maschine einsetzen.' : ''}`);
    else if (rows.length) recs.push(`Keine Termin-Maßnahme nötig – die Verschiebung fangen Folgeschritte und Puffer auf; es bleiben ca. ${eur(cost)} Stillstandskosten.`);
    else recs.push('Keine Maßnahme nötig.');
    a.md.push('', '> **Empfehlung:** ' + uc1(recs.join(' ')));
    a.md.push('', `~ Schätzung aus der Plantafel: Arbeitsgänge an ${id} verschieben sich um die Ausfallzeit (${auto ? 'Kalenderzeit – läuft auch unbemannt' : 'Arbeitszeit – läuft nur bemannt'}), Folgeschritte um die verlorene Arbeitszeit. Wartezeiten (z. B. Härterei-Lieferfenster) können einen Teil auffangen.`);
    if (!mv.fault && mv.state !== 'setup' && mv.state !== 'toolchange') addAction(a, { label: `Störung an ${id} jetzt auslösen (Demo)`, desc: `Simuliert einen Alarm aus dem Störungskatalog (Reparatur laut Katalog, nicht ${durR(N)}) – Meldung, Instandhaltung und Prognose reagieren live.`, action: { type: 'triggerFault', machineId: id }, icon: 'alert', danger: true });
    a.impact = moved.length ? { title: `Ausfall ${id} · ${durR(N)}`, rows: moved.slice(0, 6).map(r => ({ id: r.o.id, label: 'AG ' + r.e.seq, before: r.before, after: r.after, due: r.o.due })) } : null;
    a.sources = [`Plantafel ${id} (${list.length} Arbeitsgänge)`, 'Prognose je Auftrag', 'Was-wäre-wenn Eilauftrag', 'Schichtkalender', `Stundensatz ${eur(mv.rate)}/h`, srcStand()];
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
      let n = 0; const names = [], evs = [];
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
          if (tAt >= from && workBetween(tAt - 1, tAt + 1) > 0) { cnt++; evs.push({ t: tAt, name: toolShort(tl.name), insert: tl.kind === 'insert' && (tl.edges || 1) > 1 }); }
          idx += Math.max(1, full - lim);
        }
        if (cnt) { n += cnt; names.push(toolShort(tl.name) + (cnt > 1 ? ' ×' + cnt : '')); }
      }
      if (n) out.push({ id: mv.id, n, names, evs });
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
    a.md.push(`Stand ${WF.sim.clock()}${sh.id ? ' · Schichtende ' + clk(sh.endsAt) : ''} · ${W.next} ${tc(W.from)}–${clk(W.to)} · aus Live-Daten erstellt.`, '');
    // Lage
    const prod = mvs.filter(m => m.state === 'running').length;
    const ss = S().shiftStats || {};
    a.md.push('### Lage');
    const ohH = oeeHead(k);
    a.md.push(`- ${prod} von ${mvs.length} Arbeitsplätzen ${prod === 1 ? 'produziert' : 'produzieren'}; OEE ${sh.id ? 'Schicht ' + pct(k.oeeShift, 1) + ', ' : ''}heute ${ohH.staffed ? '(Schichten) ' : ''}${pct(ohH.v, 1)}.`);
    if (sh.id) a.md.push(`- Heute ${nm(k.goodFinished)} fertige Teile, ${nm(k.shippedToday || 0)} versandt; in dieser Schicht ${nm(ss.good || 0)} Arbeitsgänge gut und ${nm(ss.scrap || 0)} Ausschuss.`);
    // Offene Punkte
    const pts = [];
    for (const m of mvs.filter(x => x.state === 'fault')) { const fi = faultInfo(m); pts.push(`**Störung ${mName(m.id)}**: ${m.fault.code} ${m.fault.text} – ${fi.who}, Ende ca. ${clk(fi.endT)}.`); }
    const hw = mvs.filter(x => WAIT[x.state] && x.sinceSec >= 300);
    for (const m of hw.filter(x => !noStaff(x))) pts.push(`**${mName(m.id)}** ${lc1(msl(m))} seit ${durR(m.sinceSec)}: ${m.cause}.`);
    for (const l of groupNoStaff(hw.filter(noStaff))) pts.push(l.replace(/^- /, ''));
    for (const m of mvs.filter(x => x.fpi)) pts.push(`Erstteil ${mName(m.id)}: ${label('fpiStage', m.fpi.stage)} seit ${durR(m.fpi.waitingSec)}.`);
    for (const m of mvs.filter(x => x.state === 'setup')) pts.push(`${mName(m.id)} rüstet ${m.order ? m.order.id + ' AG ' + m.order.seq : ''} – ${m.cause}.`);
    const open = c.notifs().filter(n => n.status === 'open' && (n.sev === 'crit' || n.sev === 'warn') && !/^(fault|wait|fpi|late|stock|missing|spc|ghost|tool):/.test(n.key));
    for (const n of open.slice(0, 4)) pts.push(`${n.title}${n.suggestion ? ' – ' + trimTxt(n.suggestion, 120) : ''}`);
    a.md.push('', '### Störungen und Wartezeiten');
    if (pts.length) for (const p of pts) a.md.push('- ' + p); else a.md.push('- Keine Störung, kein Arbeitsplatz wartet länger als 5 min.');
    // Termine
    // nur Aufträge, die über das Schichtende hinaus laufen – was vorher fertig wird, betrifft die nächste Schicht nicht
    const ord = c.open().filter(o => o.risk !== 'ok' && o.eta != null && o.eta >= W.from).sort((x, y) => x.slackSec - y.slackSec);
    a.md.push('', '### Termine');
    if (ord.length) for (const o of ord.slice(0, 5)) { const w = o.risk !== 'ok' ? whyShort(c, o) : ''; a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): Prognose ${dueTxt(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)} – ${o.slackSec >= 0 ? 'Puffer ' + dur0(o.slackSec) : dur0(o.slackSec) + ' Verzug'}${w ? '; Ursache: ' + w : o.bottleneck ? '; begrenzt durch ' + o.bottleneck.split(' (')[0] : ''}.`); }
    else a.md.push('- Alle offenen Aufträge im Plan.');
    const fin = c.open().filter(o => o.eta != null).sort((x, y) => x.eta - y.eta);
    // nur, was die nächste Schicht betrifft (ab Schichtende)
    const nextFin = fin.filter(o => o.eta >= (sh.id ? sh.endsAt : t) && o.eta <= W.to);
    if (nextFin.length) a.md.push(`- Bis Ende ${W.next} fertig: ${nextFin.slice(0, 5).map(o => `${o.id} ca. ${tc(o.eta)}`).join(', ')}.`);
    // Werkzeugwechsel der nächsten Schicht: nur Zeitpunkte ab Schichtende – angekündigt (Engine), voraussichtlich wie die
    // Werkzeuge-Ansicht (deren Hochrechnung reicht 6 h), danach aus Reststandzeit und Taktzeit geschätzt
    const horizonEnd = t + 6 * 3600;
    const tRows = toolPlan(c, W.to).filter(g => g.t >= W.from && g.stage !== 'später');
    for (const x of estimateChanges(c, Math.max(W.from, horizonEnd), W.to)) for (const e of x.evs) if (e.t > horizonEnd && !tRows.some(r => r.machine === x.id && Math.abs(r.t - e.t) < 1800)) tRows.push({ kind: 'est', machine: x.id, t: e.t, tools: [{ name: e.name }], index: false, maybeIdx: e.insert });
    tRows.sort((x, y) => x.t - y.t);
    const nIdxH = tRows.filter(r => r.index).length;
    a.md.push('', `### Werkzeugwechsel ${W.next} (${tc(W.from)}–${clk(W.to)})`);
    for (const g of tRows.slice(0, 7)) a.md.push(`- ca. ${tc(g.t)} ${mName(g.machine)}: ${g.kind === 'est' ? (g.maybeIdx ? 'Wenden/Wechsel' : 'Werkzeugwechsel') : chgVerb(g)} ${g.tools.map(x => toolShort(x.name)).join(' + ')}${g.kind === 'plan' ? (g.manual ? ' (vorbeugend beauftragt)' : ' (angekündigt)') : ' (voraussichtlich)'}${g.index ? ' – Bediener:in' : ''}`);
    if (tRows.length > 7) a.md.push(`- … und ${tRows.length - 7} weitere.`);
    if (tRows.length) a.md.push(`- Zusammen ${pl(tRows.length, 'Wechsel', 'Wechsel')}${nIdxH ? `, davon ${nIdxH}× Schneide wenden durch die Bediener:in` : ''}${tRows.length > nIdxH ? ` – Einrichter:in für ${nIdxH ? 'die übrigen' : 'die Wechsel'} einplanen` : ''}.`);
    else a.md.push('- Kein Wechsel absehbar – die Standzeiten reichen für die laufenden Arbeitsgänge.');
    const ghost = c.notifs().filter(n => String(n.key).indexOf('ghost:') === 0 && !(n.ghost && n.ghost.stopT < t));
    for (const n of ghost) a.md.push(`- ${n.title}: ${trimTxt(n.suggestion, 150)}`);
    // Material
    a.md.push('', '### Material');
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min);
    const pur = openPurchases().filter(p => p.etaT >= W.from && p.etaT <= W.to + 4 * 3600);
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
    // Offen für die nächste Schicht: dieselbe Rangfolge wie „Jetzt tun“
    // offene Punkte, die bis Schichtende erledigt sind (z. B. Werkzeugwechsel 08:45), gehören nicht in die Übergabe
    const todo = todoList(c).filter(x => x.t == null || x.t >= W.from);
    a.md.push('', `### Offen für die ${W.next}`);
    if (todo.length) todo.slice(0, 5).forEach((x, i) => a.md.push(`${i + 1}. ${x.text}`));
    else a.md.push('1. Keine offenen Eingriffe – laufende Aufträge planmäßig weiterführen.');
    a.eyebrow = `Schichtübergabe · ${W.cur} → ${W.next}`;
    a.head = `Übergabe an die ${W.next}: ${todo.length ? pl(todo.length, 'offener Punkt', 'offene Punkte') : 'keine offenen Punkte'}${ord.length ? ', ' + pl(ord.length, 'Termin', 'Termine') + ' im Blick' : ''}`;
    a.sev = mvs.some(m => m.state === 'fault') ? 'crit' : todo.length || ord.length ? 'warn' : 'ok';
    a.stats = [oeeStat(ohH.v, sh.id && k.oeeShift != null ? 'Schicht ' + pct(k.oeeShift, 1) : 'Ziel ' + pct(TARGET_OEE), null, ohH.staffed ? 'OEE · Schichten' : null), { l: 'Fertige Teile heute', v: nm(k.goodFinished), s: `${nm(ss.good || 0)} Arbeitsgänge gut · ${nm(k.shippedToday || 0)} versandt` }, { l: 'Termine', v: ord.length ? nm(ord.length) : '0', s: ord.length ? 'knapp oder spät' : 'alle im Plan', c: ord.some(o => o.slackSec < 0) ? 'crit' : ord.length ? 'warn' : 'ok' }];
    a.sources = ['Maschinenstatus', 'Meldungen', 'Prognose', 'Werkzeugplanung', 'Material & Bestellungen', 'Schichtplan', srcStand()];
    a.followups = ['Welche Aufträge sind gefährdet und warum?', 'Welche Werkzeugwechsel stehen in der Schicht an?', 'Was ist der Engpass?'];
    a.copyable = true;
    return done(a);
  }

  // ------------------------------------------------------------------ Schichtbriefing (formuliert)
  function ansBriefing(c) {
    const a = A('briefing'), b = briefing(), t = c.t, sh = WF.sim.shift(), k = c.k();
    const until = t + 2 * 3600;
    const ov = ansOverview(c);
    a.eyebrow = `Schichtbriefing · ${U.fmtDayClock(t)} · ${sh.id ? sh.name + ' bis ' + clk(sh.endsAt) : 'Geisterschicht'}`;
    a.head = ov.head; a.sev = ov.sev;
    a.stats = ov.stats;
    // Termine
    const open = c.open().filter(o => o.eta != null);
    const late = open.filter(o => o.risk === 'spät').sort((x, y) => x.slackSec - y.slackSec), tight = open.filter(o => o.risk === 'knapp').sort((x, y) => x.slackSec - y.slackSec);
    a.md.push('### Termine');
    if (!late.length && !tight.length) a.md.push(`- Alle ${open.length} offenen Aufträge im Plan.`);
    for (const o of late.concat(tight).slice(0, 4)) { const w = whyShort(c, o); a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): ${o.slackSec < 0 ? '**' + durR(-o.slackSec) + ' Verzug**' : 'nur ' + slackTxt(o.slackSec)} – Prognose ${dueTxt(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)}${w ? '; Ursache: ' + w : ''}.`); }
    const fin = open.filter(o => o.eta <= until).sort((x, y) => x.eta - y.eta);
    if (fin.length) a.md.push(`- Fertig in den nächsten 2 h: ${fin.map(o => `${o.id} ca. ${clk(o.eta)}`).join(', ')}.`);
    // Nächste 2 Stunden
    a.md.push('', `### Nächste 2 Stunden (bis ${clk(until)})`);
    const ch = plannedChanges(c, until);
    if (ch.length) for (const g of ch.slice(0, 4)) a.md.push(`- ${chgVerb(g)} ${clk(g.t)} an ${mName(g.machine)}: ${g.tools.map(x => toolShort(x.name)).join(' + ')} – ${chgWho(g, !!sh.id)}.`);
    else a.md.push('- Kein Werkzeugwechsel fällig.');
    if (sh.id) {
      const shDef = PROF().shifts.find(x => x.id === sh.id);
      const d0 = Math.floor(t / DAY) * DAY;
      const brk = (shDef ? shDef.breaks : []).map(x => ({ a: d0 + U.hm(x[0]), b: d0 + U.hm(x[1]) })).find(x => x.a >= t && x.a <= until);
      if (sh.inBreak) a.md.push(`- Pause läuft bis ${clk(sh.breakEndsAt)} – bemannte Arbeitsplätze stehen, laufende Teile werden fertig.`);
      else if (brk) a.md.push(`- Pause ${clk(brk.a)}–${clk(brk.b)}: die ${PROF().machines.filter(id => station(id).loading !== 'auto').length} bemannten Arbeitsplätze pausieren nach dem laufenden Teil, autonome laufen weiter.`);
      if (sh.endsAt <= until) a.md.push(`- Schichtende ${clk(sh.endsAt)}: Übergabe vorbereiten („Schreib mir die Schichtübergabe“).`);
      const free = Object.values(S().people).filter(p => p.onDuty && !p.endShift && p.state === 'idle' && !p.task && pDisp(p).key === 'idle');
      if (free.length) a.md.push(`- Gerade verfügbar: ${free.map(p => `${sn(p.name)} (${p.role})`).join(', ')}.`);
    } else a.md.push(`- Unbemannt bis ${clk(sh.endsAt)} – ${b.bullets.length ? 'Stopps werden zum Schichtbeginn abgearbeitet' : 'keine Besonderheiten'}.`);
    // Material & Qualität
    a.md.push('', '### Material & Qualität');
    for (const x of b.bullets.filter(x => x.category === 'material' || x.category === 'qualitaet' || x.category === 'stoerung')) a.md.push(`- ${x.text}`);
    // Jetzt tun (dieselbe Rangfolge wie Lage und Übergabe)
    const recs = [];
    if (!sh.id && morningPlan(c)) recs.push(morningPlan(c));
    const todo = todoList(c);
    for (const x of todo.slice(0, 4)) { recs.push(x.text); for (const ac of x.actions || []) addAction(a, ac); }
    const bms = [...new Set(tight.map(o => watchStation(c, o)).filter(Boolean))];
    if (tight.length && bms.length && recs.length < 4) recs.push(`${listJoin(tight.slice(0, 3).map(o => o.id))}: knappe Termine absichern – ${listJoin(bms)} ohne Unterbrechung laufen lassen.`);
    if (!recs.length) recs.push('Keine akuten Eingriffe nötig – Fokus auf die anstehenden Werkzeugwechsel und den Engpass.');
    a.md.push('', '### Jetzt tun');
    recs.slice(0, 4).forEach((r, i) => a.md.push(`${i + 1}. ${r}`));
    a.sources = ['Briefing-Regeln aus Live-Daten', 'Prognose / Plantafel', 'Werkzeugplanung', 'Schichtplan', 'Material', srcStand()];
    a.followups = ['Schreib mir die Schichtübergabe', 'Was ist der Engpass?', 'Wo verlieren wir heute Geld?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Benachrichtigung erklären
  /** Empfehlungstext der Engine ohne doppeltes „Empfehlung:“; ist niemand im Dienst, bezieht sich der Rest auf den Schichtbeginn */
  const cleanSuggestion = (t) => String(t || '').replace(/\.\s*Empfehlung:\s*/g, /nächste Schicht/.test(t) ? '. Zu Schichtbeginn: ' : '. ').replace(/^Empfehlung:\s*/, '');
  function ansNotification(c, n) {
    const a = A('notification');
    if (!n) { a.head = 'Diese Benachrichtigung ist nicht mehr vorhanden'; return done(a); }
    const sev = (WF.SEV[n.sev] || WF.SEV.info).label;
    const st = n.status === 'resolved' ? 'erledigt' + (n.resolveNote ? ' – ' + n.resolveNote : '') : n.status === 'ack' ? 'quittiert' + (n.ackBy ? ' von ' + n.ackBy : '') : 'offen';
    a.eyebrow = `${sev} · ${WF.ui && WF.ui.notifTime ? WF.ui.notifTime(n, { text: true }) : tc(n.t)} · ${n.role} · ${st}`;
    a.head = n.title;
    a.sev = n.sev === 'crit' ? 'crit' : n.sev === 'warn' ? 'warn' : n.sev === 'ok' ? 'ok' : 'info';
    if (n.body) a.md.push(n.body);
    const key = String(n.key || ''), kind = key.split(':')[0];
    const ent = n.entity;
    let sub = null;
    if (ent && ent.kind === 'machine' && S().machines[ent.id]) sub = kind === 'fault' && S().machines[ent.id].state === 'fault' ? ansFault(c, ent.id) : ansMachine(c, ent.id, kind === 'tool' || kind === 'ghost' ? 'tools' : 'impact');
    else if (ent && ent.kind === 'order' && S().orders[ent.id]) sub = ansOrder(c, ent.id, kind === 'late' ? 'why' : null);
    else if (ent && ent.kind === 'material' && S().materials[ent.id]) sub = ansMaterial(c, [ent.id]);
    else if (ent && ent.kind === 'agv') sub = ansLogistics(c, [ent.id]);
    a.md.push('', '### Ursache und Einordnung');
    if (kind === 'ghost' && n.ghost) a.md.push(`- Standzeit von ${toolShort((PROF().toolTypeById[n.ghost.tool] || {}).name || n.ghost.tool)} reicht unbemannt bis ca. ${clk(n.ghost.stopT)}; danach Stillstand bis ${dueTxt(n.ghost.until)}.${n.ghost.gainSec ? ' Ein vorbeugender Wechsel bringt +' + durR(n.ghost.gainSec) + ' unbemannte Laufzeit.' : ''}`);
    if (kind === 'spc' && n.spc) a.md.push(`- Werkzeugverschleiß verschiebt das Maß; Mittelwert der letzten 8 Teile wandert zur Toleranzgrenze. Vorgeschlagene Korrektur ${nm(n.spc.value, 4)} mm.`);
    const own = /^(fault|late|wait)$/.test(kind);
    if (sub) {
      if (sub.head && kind !== 'fault') a.md.push(`**${sub.head}.**`);
      a.md.push(...sub.md.filter(l => !REC_RE.test(l)));
      if (sub.slots) a.slots = Object.assign(a.slots || {}, sub.slots);
      if (!a.stats && sub.stats) a.stats = sub.stats;
      a.impact = sub.impact; a.entity = sub.entity;
      for (const x of sub.actions) addAction(a, x);
    }
    if (own && sub && sub.rec && n.status !== 'resolved') a.md.push('', `> **${sub.rec.label}:** ${sub.rec.text}`);
    else if (n.suggestion) a.md.push('', '> **Empfehlung:** ' + cleanSuggestion(n.suggestion));
    for (const x of n.actions || []) {
      if (!x.action || x.action.type === 'select') continue;
      // Eilauftrag nur, wenn die Terminberatung ihn empfiehlt (eine Regel)
      if (x.action.type === 'setPriority' && x.action.priority === 'eil') { const adv = simAdvice(x.action.orderId); if (!(adv && adv.action && adv.action.type === 'setPriority')) continue; }
      addAction(a, { label: x.label, desc: 'Vorschlag aus der Meldung', action: x.action, icon: x.action.type === 'reorder' ? 'box' : x.action.type === 'setPriority' ? 'bolt' : x.action.type === 'applyOffset' ? 'gauge' : 'wrench' });
    }
    if (n.status === 'open') addAction(a, { label: 'Meldung quittieren', desc: 'Als gesehen markieren (bleibt bis zur Klärung sichtbar).', action: { type: 'ack', id: n.id, by: 'Schichtleitung' }, icon: 'check', quiet: true });
    a.sources = ['Benachrichtigung ' + n.id, ent ? WF.app && WF.app.entityLabel ? WF.app.entityLabel(ent) : ent.id : 'Werk', srcStand()];
    a.followups = sub && sub.followups ? sub.followups.slice(0, 2) : ['Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Weitere Fragen: Jetzt tun, Rangliste, fällig, Anzahl, Schicht, Fremdbearbeitung, Cpk, Kapazität, Stillstand
  function ansTodo(c) {
    const a = A('todo'), todo = todoList(c), sh = WF.sim.shift();
    a.eyebrow = 'Jetzt tun · ' + WF.sim.clock();
    const mp = !sh.id ? morningPlan(c) : null;
    if (!todo.length && !mp) {
      a.sev = 'ok'; a.head = 'Gerade ist kein Eingriff nötig';
      a.md.push('Keine Störung, kein Arbeitsplatz wartet länger als 5 min, kein Termin verspätet, Material unter Mindestbestand ist bestellt.');
      const ch = plannedChanges(c, c.t + 2 * 3600);
      a.md.push('', `> **Empfehlung:** ${ch.length ? `Nächster Fokus: ${chgVerb(ch[0])} ${clk(ch[0].t)} an ${mName(ch[0].machine)}${ch[0].index ? ' (Bediener:in, 1–2 min)' : ' vorbereiten'}.` : 'Engpass im Blick behalten („Was ist der Engpass?“).'}`);
    } else {
      a.sev = todo[0] && todo[0].sev === 'crit' ? 'crit' : 'warn';
      a.head = mp ? 'Zum Schichtbeginn: Stopps abarbeiten' : /^(FA-|M\d|QS)/.test(todo[0].short) ? `Zuerst ${todo[0].short.replace(/\.$/, '')}` : `Zuerst: ${todo[0].short.replace(/\.$/, '')}`;
      const list = (mp ? [mp] : []).concat(todo.slice(0, 5).map(x => x.text));
      a.md.push('Reihenfolge nach Wirkung: Störungen, wartende Maschinen, verspätete Aufträge, dann Vorbereitung.', '');
      list.forEach((x, i) => a.md.push(`${i + 1}. ${x}`));
      for (const x of todo.slice(0, 3)) for (const ac of x.actions || []) addAction(a, ac);
      a.md.push('', `> **Empfehlung:** Mit Punkt 1 beginnen${list.length > 1 ? ' – die übrigen Punkte hängen nicht davon ab und können parallel verteilt werden' : ''}.`);
    }
    a.sources = ['Maschinenstatus', 'Terminberatung je Auftrag', 'Werkzeugplanung', 'Meldungen', srcStand()];
    a.followups = ['Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?', 'Schreib mir die Schichtübergabe'];
    return done(a);
  }
  function ansRanking(c, q) {
    const a = A('ranking');
    const metric = /stillstand|verlust|kost|geld/.test(q) ? 'loss' : /energie|strom|verbrauch|kwh/.test(q) ? 'energy' : /ausschuss|qualitaet|fpy/.test(q) ? 'scrap' : 'oee';
    // Richtung: OEE „beste/schlechteste“, alle anderen Kennzahlen absteigend (höchste zuerst) – außer nach dem unteren Ende gefragt
    const lowEnd = /wenigst|geringst|niedrigst|kleinst/.test(q);
    const best = metric === 'oee' ? /\bbest|hoechst|groesst/.test(q) && !/schlecht|niedrig|wenigst|geringst/.test(q) : !lowEnd;
    const L = lossByCause(c), kk = c.k();
    // gleiche Werte wie Analyse/Leitstand: OEE und Stillstand nach einer Nacht über die besetzten Schichten
    let rows = c.mvs().map(mv => {
      const oe = machineOee(mv, kk), lr = L.byMachine.find(x => x.mv.id === mv.id);
      return { mv, v: metric === 'oee' ? oe.oee : metric === 'loss' ? (lr ? lr.loss : mv.lossEurToday || 0) : metric === 'energy' ? mv.energyKwhToday || 0 : mv.scrapToday || 0, oe };
    }).filter(r => r.v != null);
    const desc = metric === 'oee' ? best : !lowEnd;
    rows.sort((x, y) => (desc ? y.v - x.v : x.v - y.v));
    if (metric === 'oee' && !best) rows = rows.filter(r => r.oe.plannedSec > 0 || r.v > 0);
    const fmtV = (v) => (metric === 'oee' ? pct(v, oeeDec(v)) : metric === 'loss' ? eur(v) : metric === 'energy' ? nm(v, 0) + ' kWh' : stk(v));
    const stf = metric === 'oee' ? oeeHead(kk).staffed : metric === 'loss' ? L.split : false;
    const what = { oee: stf ? 'OEE heute (Schichten)' : 'OEE heute', loss: stf ? 'Stillstandskosten heute (Schichtzeit)' : 'Stillstandskosten heute', energy: 'Energieverbrauch heute', scrap: 'Ausschuss heute' }[metric];
    a.eyebrow = 'Rangliste · ' + what;
    const top = rows[0];
    if (!top) { a.head = 'Keine Werte für heute'; a.md.push('Heute gab es noch keine Planzeit.'); return done(a); }
    if (metric !== 'oee' && !lowEnd && !(top.v > 0)) {
      a.sev = 'ok'; a.head = { loss: 'Heute an keinem Arbeitsplatz Stillstandskosten', energy: 'Heute noch kein Energieverbrauch erfasst', scrap: 'Heute an keinem Arbeitsplatz Ausschuss' }[metric];
      a.md.push(metric === 'scrap' ? `FPY heute ${pct(c.k().fpy, 1)}.` : 'Alle Werte heute bei null.');
      a.sources = ['Kennzahlen je Maschine heute', srcStand()]; a.followups = ['Wie läuft die Schicht?']; return done(a);
    }
    const ADJ = { oee: best ? 'Beste OEE' : 'Schlechteste OEE', loss: lowEnd ? 'Geringste Stillstandskosten' : 'Höchste Stillstandskosten', energy: lowEnd ? 'Geringster Energieverbrauch' : 'Höchster Energieverbrauch', scrap: lowEnd ? 'Am wenigsten Ausschuss' : 'Am meisten Ausschuss' };
    a.sev = metric === 'oee' ? (top.v >= TARGET_OEE ? 'ok' : 'warn') : metric === 'energy' ? 'info' : lowEnd ? 'ok' : 'warn';
    a.head = `${ADJ[metric]} heute${stf ? (metric === 'oee' ? ' (Schichten)' : ' (Schichtzeit)') : ''}: ${mName(top.mv.id)} mit ${fmtV(top.v)}`;
    const row = L.byMachine.find(x => x.mv.id === top.mv.id);
    if (metric === 'oee') {
      const oe = top.oe, comp = [['Verfügbarkeit', oe.availability], ['Leistung', oe.performance], ['Qualität', oe.quality]].filter(x => x[1] != null);
      const low = comp.slice().sort((x, y) => x[1] - y[1])[0];
      a.md.push(`${comp.map(x => x[0] + ' ' + pct(x[1], 1)).join(' × ')}${low ? ` – größter Verlust bei der ${low[0]}` : ''}${row && row.causes[0] ? ` (vor allem ${causeLabel(row.causes[0].state)}, ${durR(row.causes[0].sec)})` : ''}.`);
    } else if (metric === 'loss') {
      if (row && row.causes.length) a.md.push(`${row.causes.slice(0, 3).map(y => `${causeLabel(y.state)} ${eur(y.eur)} (${durR(y.sec)})`).join(', ')} – Stundensatz ${eur(top.mv.rate)}/h.`);
    } else if (metric === 'energy') {
      const pr = ENERGY_PRICE(), tot = c.k().energyKwh || 0;
      a.md.push(`Ca. ${eur(top.mv.energyEurToday != null ? top.mv.energyEurToday : top.v * pr.v)} bei ${U.fmtEur(pr.v, 2)}/kWh – ${pct(tot > 0 ? top.v / tot : 0)} des Werksverbrauchs heute (${nm(tot, 0)} kWh); jetzt ${top.mv.powerKw != null ? nm(top.mv.powerKw, 1) + ' kW gemessen' : nm(top.mv.powerKwEst, 1) + ' kW (Modellwert)'}.`);
    } else {
      const ev = (S().events || []).filter(e => e.type === 'scrap' && e.t >= Math.floor(c.t / DAY) * DAY && e.entity && e.entity.id === top.mv.id).slice(-2);
      a.md.push(`FPY heute ${pct(c.k().fpy, 1)} im Werk.${ev.length ? ' Zuletzt: ' + ev.map(e => clk(e.t) + ' ' + e.msg).join('; ') + '.' : ''}`);
    }
    a.md.push('', '### ' + what + ' je Arbeitsplatz');
    const shown = rows.slice(0, 6);
    const subOf = (r) => metric === 'oee' ? `V ${pct(r.oe.availability, 0)} · L ${pct(r.oe.performance, 0)} · Q ${pct(r.oe.quality, 0)} · jetzt ${msl(r.mv)}`
      : metric === 'loss' ? ((L.byMachine.find(x => x.mv.id === r.mv.id) || { causes: [] }).causes.slice(0, 2).map(y => `${causeLabel(y.state)} ${durR(y.sec)}`).join(', ') || 'kein Stillstand') + ` · jetzt ${msl(r.mv)}`
        : metric === 'energy' ? `jetzt ${r.mv.powerKw != null ? nm(r.mv.powerKw, 1) + ' kW' : nm(r.mv.powerKwEst, 1) + ' kW (Modell)'} · ${msl(r.mv)}` : `${pl(r.mv.goodToday || 0, 'Gutteil', 'Gutteile')} · jetzt ${msl(r.mv)}`;
    SLOT(a, 'bars', shown.map(r => `- ${mName(r.mv.id)}: ${fmtV(r.v)}`).join('\n'), { max: metric === 'oee' ? 1 : null, rows: shown.map(r => ({ ent: { kind: 'machine', id: r.mv.id }, label: station(r.mv.id).short, v: r.v, vTxt: fmtV(r.v), sub: subOf(r),
      c: metric === 'oee' ? (r.v >= TARGET_OEE ? 'var(--st-run)' : 'var(--st-wait)') : metric === 'loss' ? ((WF.STATE[((L.byMachine.find(x => x.mv.id === r.mv.id) || { causes: [] }).causes[0] || {}).state] || {}).color || 'var(--st-wait)') : 'color-mix(in srgb,var(--text2) 70%,transparent)' })) });
    let rec;
    if (metric === 'oee' || metric === 'loss') rec = !lowEnd && (metric === 'loss' || !best) && row && row.causes[0] ? `An ${top.mv.id} zuerst ${causeLabel(row.causes[0].state)} angehen: ${causeAdvice(row.causes[0].state, c.k())}` : 'Keine Maßnahme nötig.';
    else if (metric === 'energy') rec = !lowEnd && top.mv.state !== 'running' && (top.mv.powerKw != null ? top.mv.powerKw : top.mv.powerKwEst) >= 3 ? `${top.mv.id} zieht gerade ohne Produktion Leistung – Nebenaggregate (Kühlmittel, Späneförderer) in längeren Stillständen abschalten.` : `Der Verbrauch folgt der Bearbeitung (${top.mv.id} ${msl(top.mv)}) – kein auffälliger Leerlauf.`;
    else rec = !lowEnd ? `Ausschuss an ${top.mv.id} prüfen: Maß- und Werkzeugzustand, SPC-Verlauf in der Qualitätsansicht.` : 'Keine Maßnahme nötig.';
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.entity = { kind: 'machine', id: top.mv.id };
    a.sources = [metric === 'loss' ? 'Stillstandskosten je Maschine (Engine, wie Analyse)' : metric === 'energy' ? 'Energiezähler je Maschine heute' : 'Kennzahlen je Maschine heute', srcStand()];
    a.followups = [`Was macht ${top.mv.id} gerade?`, metric === 'energy' ? 'Wie hoch ist der Energieverbrauch?' : 'Wo verlieren wir heute Geld?'];
    return done(a);
  }
  /** Was wird bis Schichtende fertig? Aufträge mit Prognose bis zum Schichtende und Arbeitsgänge, die bis dahin abschließen */
  function ansUntilShiftEnd(c) {
    const a = A('due'), t = c.t, sh = WF.sim.shift();
    const until = sh.id ? sh.endsAt : sh.endsAt + 8 * 3600;
    const lbl = sh.id ? 'Schichtende ' + clk(until) : 'Ende der Frühschicht ' + tc(until);
    const fin = c.open().filter(o => o.eta != null && o.eta <= until).sort((x, y) => x.eta - y.eta);
    const ops = c.mvs().filter(m => m.order && m.etaOpEnd != null && m.etaOpEnd <= until).sort((x, y) => x.etaOpEnd - y.etaOpEnd);
    a.eyebrow = `Termine · bis ${lbl}`;
    a.sev = fin.some(o => o.slackSec < 0) ? 'warn' : 'ok';
    a.head = fin.length ? `Bis ${lbl}: ${pl(fin.length, 'Auftrag', 'Aufträge')} fertig – ${listJoin(fin.slice(0, 3).map(o => o.id + ' ca. ' + tc(o.eta)))}` : `Bis ${lbl} wird kein Auftrag fertig`;
    a.md.push(`Fertig = letzter Arbeitsgang abgeschlossen laut Prognose (wie Auftragsliste und Schichtübergabe).`, '');
    for (const o of fin) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}): fertig ca. ${tc(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)} – ${o.slackSec < 0 ? durR(-o.slackSec) + ' zu spät' : slackTxt(o.slackSec)}.`);
    if (ops.length) a.md.push('', `Außerdem schließen bis dahin ${pl(ops.length, 'Arbeitsgang', 'Arbeitsgänge')} ab: ${ops.slice(0, 6).map(m => `${m.id} ${m.order.id} AG ${m.order.seq} (${clk(m.etaOpEnd)})`).join(', ')}${ops.length > 6 ? ' u. a.' : ''} – danach rüsten diese Maschinen um.`);
    const late = fin.filter(o => o.slackSec < 0);
    a.md.push('', '> **Empfehlung:** ' + (late.length ? `${late[0].id}: ${adviceText(c, late[0]).text}` : fin.length ? 'Versand für die fertigen Aufträge vorbereiten; Umrüsten der freiwerdenden Maschinen rechtzeitig besetzen.' : 'Keine Maßnahme nötig.'));
    a.sources = ['Prognose / Plantafel', 'Schichtkalender', srcStand()];
    a.followups = ['Schreib mir die Schichtübergabe', 'Welche Aufträge werden heute ausgeliefert?'];
    return done(a);
  }
  function ansDue(c, q) {
    const a = A('due'), t = c.t;
    const off = /uebermorgen/.test(q) ? 2 : /morgen/.test(q) ? 1 : 0;
    const d0 = Math.floor(t / DAY) * DAY + off * DAY, d1 = d0 + DAY;
    const dayTxt = off === 0 ? 'heute' : off === 1 ? 'morgen' : U.fmtDay(d0);
    const all = c.ovs();
    const due = all.filter(o => o.due >= d0 && o.due < d1).sort((x, y) => x.due - y.due);
    const fin = all.filter(o => o.status !== 'fertig' && o.eta != null && o.eta >= d0 && o.eta < d1 && due.indexOf(o) < 0).sort((x, y) => x.eta - y.eta);
    a.eyebrow = `Termine · ${dayTxt}`;
    const lateDue = due.filter(o => o.status !== 'fertig' && o.slackSec < 0);
    a.sev = lateDue.length ? 'warn' : 'ok';
    a.head = due.length ? `${dayTxt === 'heute' ? 'Heute' : uc1(dayTxt)} ${due.length === 1 ? 'ist 1 Auftrag' : 'sind ' + due.length + ' Aufträge'} fällig${lateDue.length ? ' – ' + lateDue.length + ' davon verspätet' : ''}` : `${uc1(dayTxt)} ist kein Auftrag fällig`;
    for (const o of due) a.md.push(`- **${o.id}** ${o.part.name} (${custShort(o.customer)}), Termin ${clk(o.due)}: ${o.status === 'fertig' ? 'fertig ' + dueTxt(o.doneT) + (o.onTime ? ' – termingerecht' : '') : 'Prognose ' + dueTxt(o.eta) + ' – ' + slackTxt(o.slackSec)}.`);
    if (fin.length) a.md.push('', `${uc1(dayTxt)} fertig (Termin später): ${fin.slice(0, 6).map(o => `${o.id} ca. ${clk(o.eta)}`).join(', ')}.`);
    a.md.push('', '> **Empfehlung:** ' + (lateDue.length ? `${lateDue[0].id}: ${adviceText(c, lateDue[0]).text}` : due.length ? 'Alle fälligen Aufträge halten – Versand vorbereiten.' : 'Keine Maßnahme nötig.'));
    a.sources = ['Aufträge und Liefertermine', 'Prognose', srcStand()];
    a.followups = ['Welche Aufträge sind gefährdet und warum?', off ? 'Welche Aufträge sind heute fällig?' : 'Welche Aufträge sind morgen fällig?'];
    return done(a);
  }
  function ansCounts(c) {
    const a = A('counts'), all = c.ovs(), open = all.filter(o => o.status !== 'fertig');
    const inW = open.filter(o => o.status === 'in Arbeit'), rel = open.filter(o => o.status !== 'in Arbeit');
    const late = open.filter(o => o.risk === 'spät'), tight = open.filter(o => o.risk === 'knapp'), eil = open.filter(o => o.priority === 'eil');
    const d0 = Math.floor(c.t / DAY) * DAY, doneToday = all.filter(o => o.status === 'fertig' && o.doneT >= d0);
    a.eyebrow = 'Aufträge · Übersicht'; a.sev = late.length ? 'warn' : 'ok';
    a.head = `${open.length} Aufträge offen – ${inW.length} in Arbeit, ${rel.length} freigegeben`;
    a.stats = [{ l: 'Offen', v: nm(open.length), s: `${inW.length} in Arbeit` }, { l: 'Verspätet', v: nm(late.length), s: late[0] ? late[0].id : '–', c: late.length ? 'crit' : 'ok' }, { l: 'Knapp', v: nm(tight.length), s: '< 4 h Puffer', c: tight.length ? 'warn' : 'ok' }, { l: 'Heute fertig', v: nm(doneToday.length), s: 'Aufträge' }];
    a.md.push(`${eil.length ? pl(eil.length, 'Eilauftrag', 'Eilaufträge') + ' (' + listJoin(eil.map(o => o.id)) + '). ' : ''}${all.length - open.length ? nm(all.length - open.length) + ' Aufträge fertig, davon ' + doneToday.length + ' heute.' : 'Heute noch kein Auftrag fertig.'} Verspätet: ${late.length ? listJoin(late.map(o => o.id)) : 'keiner'}; knapp: ${tight.length ? listJoin(tight.map(o => o.id)) : 'keiner'}.`);
    a.sources = ['Auftragsbestand', 'Prognose', srcStand()];
    a.followups = ['Welche Aufträge sind gefährdet und warum?', 'Welche Aufträge sind heute fällig?'];
    return done(a);
  }
  function ansShift(c, q) {
    const a = A('shift'), t = c.t, sh = WF.sim.shift();
    const want = /spaet/.test(q) ? 'S' : /frueh/.test(q) ? 'F' : /naechst|kommende|uebernaechst/.test(q) ? (sh.id === 'F' ? 'S' : 'F') : sh.id || 'F';
    const def = PROF().shifts.find(x => x.id === want);
    const d0 = Math.floor(t / DAY) * DAY;
    let start = d0 + U.hm(def.start), end = d0 + U.hm(def.end);
    if (end <= t) { let d = Math.floor(t / DAY) + 1; while (d % 7 >= 5) d++; start = d * DAY + U.hm(def.start); end = d * DAY + U.hm(def.end); }
    const running = sh.id === want;
    const crew = Object.values(S().people).filter(p => p.shift === want);
    a.eyebrow = 'Schicht · ' + def.name;
    a.sev = 'info';
    a.head = running ? `${def.name} läuft bis ${clk(sh.endsAt)} – ${crew.length} Personen` : `${def.name} ab ${dueTxt(start)} – ${crew.length} Personen`;
    a.md.push(running ? `Noch ${durR(sh.endsAt - t)} bis Schichtende; Pausen ${def.breaks.map(b => b[0] + '–' + b[1]).join(', ')}.` : `Beginnt in ${durR(start - t)} (${def.start}–${def.end}, Pausen ${def.breaks.map(b => b[0] + '–' + b[1]).join(', ')}).`, '');
    for (const p of crew.slice().sort((x, y) => x.role.localeCompare(y.role))) a.md.push(`- **${p.name}** (${p.role})${p.machines && p.machines.length ? ' – ' + p.machines.join(', ') : ''}${running ? ' · ' + pDisp(p).label : ''}`);
    a.md.push('', `Besetzung: ${roleSummary(crew)}.`);
    if (want === 'S' && !crew.some(p => /^Instandhalt/.test(p.role))) a.md.push(`In der Spätschicht keine Instandhaltung – Reparaturen übernimmt ${crew.filter(p => p.skills.indexOf('repair') >= 0).map(p => sn(p.name)).join(', ') || 'die Schichtleitung'}.`);
    a.sources = ['Schichtplan', 'Personalstamm', srcStand()];
    a.followups = ['Wer ist gerade wo?', 'Schreib mir die Schichtübergabe'];
    return done(a);
  }
  function ansExt(c, q, E) {
    const a = A('ext'), t = c.t;
    const rows = [];
    for (const o of c.open()) {
      const fops = (c.fc().orders[o.id] || {}).ops || [];
      o.ops.forEach((op, i) => { if (op.station === 'EXT' && !op.complete) rows.push({ o, op, fe: fops[i] || null }); });
    }
    // genannter Partner („die Härterei“, „Hartchrom“, „Eloxal“) – sonst alle Fremdbearbeitungen
    const PF = [[/haerter/, /härter/i], [/chrom/, /chrom/i], [/eloxal/, /eloxal/i], [/galvan|beschicht/, /galvan|beschicht/i]].find(x => x[0].test(q));
    if (PF) { const f = rows.filter(r => PF[1].test(String(r.op.ext && r.op.ext.partner || '') + ' ' + String(r.op.ext && r.op.ext.process || ''))); if (f.length) rows.splice(0, rows.length, ...f); }
    const m = /(\d+|ein|einen|zwei|drei)\s*(tag|tage|tagen)/.exec(q);
    const days = m ? (NUMW[m[1]] || Number(m[1]) || 1) : /tag spaeter|tag verspaet/.test(q) ? 1 : 0;
    const delay = days ? days * DAY : E && E.hours && /spaeter|verzoeger|verspaet/.test(q) ? E.hours * 3600 : 0;
    const partners = [...new Set(rows.map(r => partnerName(r.op.ext && r.op.ext.partner)))];
    a.eyebrow = 'Fremdbearbeitung' + (partners.length === 1 ? ' · ' + partners[0] : partners.length ? ' · ' + partners.length + ' Partner' : '');
    if (!rows.length) { a.sev = 'ok'; a.head = 'Keine offene Fremdbearbeitung'; a.md.push('Alle Lose sind zurück bzw. kein offener Auftrag hat einen externen Arbeitsgang.'); return done(a); }
    const back = (r) => (r.fe && r.fe.lastReturn != null ? r.fe.lastReturn : r.op.ext && r.op.ext.lastReturnT ? r.op.ext.lastReturnT : r.fe ? r.fe.end : null);
    rows.sort((x, y) => (back(x) || 0) - (back(y) || 0));
    if (!delay) {
      a.sev = rows.some(r => r.o.risk === 'spät') ? 'warn' : 'info';
      const first = rows.find(r => r.op.ext && r.op.ext.atPartnerQty > 0) || rows[0];
      a.head = first.op.ext && first.op.ext.returnT ? `Nächster Rücklauf: ${first.o.id} ca. ${dueTxt(first.op.ext.returnT)}` : `${pl(rows.length, 'Auftrag', 'Aufträge')} mit offener Fremdbearbeitung`;
      // Zeilen aus den Los-Feldern (Partner nur einmal, Zeiten relativ wie im Kopf)
      const lotTxt = (x) => { const e = x.ext || {}, p = []; if (e.atPartnerQty) p.push(`${stk(e.atPartnerQty)} dort${e.returnT ? ' bis ca. ' + dueTxt(e.returnT) : ''}`); if (e.waitingPickupQty) p.push(`${stk(e.waitingPickupQty)} an der Bereitstellung${e.pickupT ? ' (Abholung ca. ' + dueTxt(e.pickupT) + ')' : e.lotComplete === false ? ' (Los noch nicht komplett)' : ''}`); if (e.returnedQty) p.push(`${stk(e.returnedQty)} zurück`); return p.join('; ') || 'noch keine Teile'; };
      for (const r of rows) a.md.push(`- **${r.o.id}** AG ${r.op.seq} ${r.op.ext ? r.op.ext.process : r.op.op}${partners.length > 1 ? ' bei ' + partnerName(r.op.ext && r.op.ext.partner) : ''}: ${lotTxt(r.op)}${back(r) ? '; letzter Rücklauf ca. ' + dueTxt(back(r)) : ''} – Auftrag ${slackTxt(r.o.slackSec)}${etaTag(r.o)}.`);
      const lateR = rows.find(r => r.o.risk === 'spät');
      a.md.push('', '> **Empfehlung:** ' + (lateR ? `${lateR.o.id}: Expressdurchlauf bei ${partnerName(lateR.op.ext && lateR.op.ext.partner)} anfragen – die Fremdbearbeitung liegt auf dem kritischen Weg.` : 'Lose pünktlich zum Lieferfenster bereitstellen – Rückläufe passen zu den Terminen.'));
    } else {
      const res = rows.map(r => { const after = r.o.eta + delay; return { r, after, slack: r.o.due - after }; });
      const flips = res.filter(x => x.slack < 0 && x.r.o.slackSec >= 0);
      a.sev = flips.length ? 'crit' : 'ok';
      const who = partners.length === 1 ? partners[0].replace(/\s+(GmbH|AG|KG)$/, '') : 'die Fremdbearbeitung';
      a.head = flips.length ? `${pl(flips.length, 'Termin kippt', 'Termine kippen')}, wenn ${who} ${durR(delay)} später liefert` : `Kein Termin kippt, wenn ${who} ${durR(delay)} später liefert`;
      a.md.push(`Annahme: alle offenen Lose kommen ${durR(delay)} später zurück; die Folgeschritte verschieben sich entsprechend (obere Grenze – Puffer in der Kette fangen einen Teil auf).`, '');
      for (const x of res) a.md.push(`- **${x.r.o.id}** (${custShort(x.r.o.customer)}): Prognose ${dueTxt(x.r.o.eta)} → **${dueTxt(x.after)}**; Termin ${dueTxt(x.r.o.due)} ${x.slack < 0 ? (x.r.o.slackSec < 0 ? 'bleibt verspätet (' + durR(-x.slack) + ')' : '**kippt (' + durR(-x.slack) + ' Verzug)**') : 'hält (' + slackTxt(x.slack) + ')'}.`);
      a.impact = { title: `Fremdbearbeitung ${durR(delay)} später`, rows: res.slice(0, 6).map(x => ({ id: x.r.o.id, label: 'AG ' + x.r.op.seq, before: x.r.o.eta, after: x.after, due: x.r.o.due })) };
      a.md.push('', '> **Empfehlung:** ' + (flips.length ? `Für ${listJoin(flips.map(x => x.r.o.id))} den Rücklauftermin bei ${who} schriftlich bestätigen lassen und ${listJoin([...new Set(flips.map(x => custShort(x.r.o.customer)))])} vorab informieren.` : 'Die Puffer reichen – keine Maßnahme nötig.'));
    }
    a.sources = ['Fremdbearbeitungs-Lose (Abholung, Rücklauf)', 'Prognose', srcStand()];
    a.followups = ['Was wäre, wenn die Härterei einen Tag später liefert?', 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  /** Prozessfähigkeit eines Merkmals – gleiche Rechnung und gleiches Fenster (letzte 60 Werte) wie die Qualitätsansicht
      (WF.quality.stats), sonst identisch nachgerechnet */
  const CAP_N = 60;
  function capOf(key, n) {
    n = n || CAP_N;
    if (WF.quality && typeof WF.quality.stats === 'function') { try { const d = WF.quality.stats(key, n); if (d) return d; } catch (e) { /* eigene Rechnung */ } }
    const [oid, sq] = key.split('/'), ch = WF.sim.charOf ? WF.sim.charOf(oid, Number(sq)) : null;
    const arr = ((S().measurements || {})[key] || []).slice(-n).filter(p => !p.fpi), v = arr.map(p => p.v), N = v.length;
    if (!ch || N < 2) return { N, enough: false };
    const lsl = ch.lsl != null ? ch.lsl : ch.nominal + ch.tolMinus, usl = ch.usl != null ? ch.usl : ch.nominal + ch.tolPlus;
    const mean = v.reduce((x, y) => x + y, 0) / N; let mr = 0; for (let i = 1; i < N; i++) mr += Math.abs(v[i] - v[i - 1]);
    const sigma = mr / (N - 1) / 1.128, enough = N >= 10 && sigma > 0;
    return { N, enough, mean, lsl, usl, center: (lsl + usl) / 2, cp: enough ? (usl - lsl) / (6 * sigma) : null, cpk: enough ? Math.min(usl - mean, mean - lsl) / (3 * sigma) : null };
  }
  /** Merkmale wie die Liste „Prozessfähigkeit je Merkmal“ der Qualitätsansicht: laufender oder in den letzten 4 h gemessener
      Arbeitsgang, mindestens 20 Serienwerte im Fenster – aufsteigend nach Cpk */
  function capRows(c) {
    const Sx = S(), out = [];
    for (const k of Object.keys(Sx.measurements || {})) {
      const arr = Sx.measurements[k]; if (!arr || !arr.length) continue;
      const [oid, sq] = k.split('/'), seq = Number(sq), o = Sx.orders[oid];
      const r = o ? o.routing.find(x => x.seq === seq) : null, stId = r ? r.station : null, m = stId ? Sx.machines[stId] : null;
      const active = !!(m && m.op && m.op.oid === oid && o.routing[m.op.idx] && o.routing[m.op.idx].seq === seq);
      if (!active && c.t - arr[arr.length - 1].t > 4 * 3600) continue;
      const d = capOf(k);
      if (!d || !d.enough || d.N < 20) continue;
      out.push({ k, oid, seq, station: stId, ch: WF.sim.charOf ? WF.sim.charOf(oid, seq) : null, d, active });
    }
    return out.sort((x, y) => x.d.cpk - y.d.cpk);
  }
  /** Lage/Streuung in Worten – derselbe Wortlaut wie die Qualitätsansicht */
  function capExplain(d) {
    const lsl = d.lsl, usl = d.usl, center = d.center != null ? d.center : (lsl + usl) / 2;
    const half = (usl - lsl) / 2, pos = half > 0 ? (d.mean - center) / half : 0, near = pos < 0 ? 'unteren' : 'oberen', pp = Math.round(Math.abs(pos) * 100);
    if (d.cpk >= 1.33) return { t: 'Prozess fähig – Streuung und Lage passen sicher in die Toleranz.', lage: false, streu: false };
    if (Math.abs(pos) > 0.15 && d.cp >= 1.33) return { t: `Die Streuung passt, aber der Mittelwert liegt ${pp} % aus der Toleranzmitte Richtung ${near} Grenze.`, lage: true, streu: false };
    if (Math.abs(pos) > 0.15) return { t: `Streuung knapp und Mittelwert ${pp} % aus der Toleranzmitte Richtung ${near} Grenze.`, lage: true, streu: true };
    return { t: 'Lage nahezu mittig – die Streuung ist für diese Toleranz zu groß.', lage: false, streu: true };
  }
  const capName = (r) => `${r.station || '–'} ${r.ch ? r.ch.name : 'Hauptmerkmal'}`;
  function ansCapability(c, mid) {
    const a = A('quality');
    a.eyebrow = 'Qualität · Prozessfähigkeit';
    const nr = (v) => nm(v, 2);
    if (mid) {
      const mv = c.mv(mid);
      const key = mv && mv.order ? mv.order.id + '/' + mv.order.seq : null;
      const d = key ? capOf(key) : null, ch = key ? (WF.sim.charOf ? WF.sim.charOf(mv.order.id, mv.order.seq) : null) : null;
      a.entity = { kind: 'machine', id: mid };
      if (!d) { a.head = `${mName(mid)}: kein laufendes Merkmal`; a.md.push('Cp/Cpk werden aus den Serienmesswerten des laufenden Arbeitsgangs berechnet (letzte 60 Werte, wie die Qualitätsansicht).'); return done(a); }
      a.sev = !d.enough ? 'info' : d.cpk >= 1.33 ? 'ok' : d.cpk >= 1 ? 'warn' : 'crit';
      a.head = d.enough ? `${mName(mid)}: Cpk ${nr(d.cpk)} – ${d.cpk >= 1.33 ? 'fähig' : d.cpk >= 1 ? 'bedingt fähig' : 'nicht fähig'}` : `${mName(mid)}: noch zu wenig Messwerte für Cpk`;
      if (!d.enough) { a.md.push(`Für Cp/Cpk werden mindestens 10 Serienwerte benötigt (aktuell ${d.N}).`, '', '> **Empfehlung:** Weitere Teile abwarten.'); a.sources = ['Messwerte je Merkmal (Serie)', srcStand()]; return done(a); }
      const ex = capExplain(d);
      a.md.push(`Merkmal ${ch ? ch.name : 'Hauptmerkmal'} (${mv.order.id} AG ${mv.order.seq}): ${ex.t}${d.N < 30 ? ' Vorläufig – erst ab ca. 30 Werten belastbar.' : ''}`);
      a.stats = [{ l: 'Cpk', v: nr(d.cpk), s: 'Ziel ≥ 1,33 · Lage + Streuung', c: d.cpk >= 1.33 ? '' : d.cpk >= 1 ? 'warn' : 'crit' }, { l: 'Cp', v: nr(d.cp), s: d.cp >= 1.33 ? 'Streuung passt' : 'Streuung zu groß', c: d.cp >= 1.33 ? '' : 'warn' }, { l: 'Messwerte', v: nm(d.N), s: 'letzte Serienwerte' }];
      a.md.push('', `- **Cp ${nr(d.cp)}** misst nur die Streuung: ${d.cp >= 1.33 ? 'sie passt in die Toleranz' : 'sie ist für diese Toleranz zu groß (Ziel ≥ 1,33)'}.`);
      a.md.push(`- **Cpk ${nr(d.cpk)}** berücksichtigt zusätzlich die Lage des Mittelwerts${ex.lage ? ' – der Prozess liegt außermittig' : ''}.`);
      if (ex.lage && d.cp < 1.33) a.md.push(`- Zentrieren hebt Cpk höchstens auf Cp ${nr(d.cp)} – für Cpk ≥ 1,33 muss zusätzlich die Streuung sinken (Werkzeug, Spannung, Schnittwerte).`);
      let rec;
      if (d.cpk >= 1.33) rec = 'Keine Maßnahme nötig.';
      else if (ex.lage && !ex.streu) rec = `Prozess zentrieren: Werkzeugkorrektur an ${mid} (Vorschlag in der Qualitätsansicht) – damit erreicht Cpk fast Cp ${nr(d.cp)}.`;
      else if (ex.lage) rec = `Streuung zu groß und Prozess außermittig: an ${mid} zuerst zentrieren (Werkzeugkorrektur – hebt Cpk höchstens auf ${nr(d.cp)}), zusätzlich Streuung senken (Werkzeugzustand, Spannung, Schnittwerte).`;
      else rec = `Hebel ist die Streuung: Spannung, Schnittwerte und Werkzeugzustand an ${mid} prüfen oder Toleranz mit dem Kunden klären – eine Korrektur allein reicht nicht.`;
      a.md.push('', '> **Empfehlung:** ' + rec);
      if ((WF.views || []).some(v => v.id === 'qualitaet')) addAction(a, { label: 'Merkmal in der Qualitätsansicht öffnen', desc: 'Regelkarte, Verteilung und Korrekturvorschlag', action: { type: 'navigate', view: 'qualitaet', params: { char: key } }, icon: 'shield', quiet: true });
    } else {
      const rows = capRows(c);
      if (!rows.length) { a.head = 'Noch zu wenige Messwerte für Cp/Cpk'; a.md.push('Je Merkmal werden mindestens 20 Serienwerte benötigt.'); return done(a); }
      const low = rows.filter(r => r.d.cpk < 1.33), capable = rows.length - low.length;
      a.sev = low.some(r => r.d.cpk < 1) ? 'crit' : low.length ? 'warn' : 'ok';
      a.head = `${capable} von ${rows.length} Merkmalen fähig (Cpk ≥ 1,33)`;
      a.stats = [{ l: 'Fähig', v: capable + '/' + rows.length, s: 'Cpk ≥ 1,33', c: low.length ? 'warn' : '' }, { l: 'Niedrigster Cpk', v: nr(rows[0].d.cpk), s: capName(rows[0]), c: rows[0].d.cpk < 1 ? 'crit' : rows[0].d.cpk < 1.33 ? 'warn' : '' }];
      a.md.push('Gleiche Liste wie „Prozessfähigkeit je Merkmal“ in der Qualitätsansicht (letzte 60 Serienwerte je Merkmal).', '');
      for (const r of rows.slice(0, 8)) a.md.push(`- **${capName(r)}** (${r.oid}): Cpk ${nr(r.d.cpk)}, Cp ${nr(r.d.cp)}${r.d.cpk < 1.33 ? ' – ' + lc1(capExplain(r.d).t) : ''}`);
      a.md.push('', '> **Empfehlung:** ' + (low.length ? `${low[0].station || low[0].oid} zuerst: ${capExplain(low[0].d).lage && low[0].d.cp >= 1 ? 'Werkzeugkorrektur zentriert den Prozess' : 'Streuung senken (Werkzeug, Spannung, Schnittwerte)'}${low[0].d.cp < 1.33 && capExplain(low[0].d).lage ? ' – Zentrieren allein hebt Cpk höchstens auf ' + nr(low[0].d.cp) : ''}.` : 'Keine Maßnahme nötig.'));
    }
    a.sources = ['Messwerte je Merkmal (Serie)', 'Toleranzen laut Zeichnung', 'gleiche Rechnung wie Qualitätsansicht', srcStand()];
    a.followups = ['Wie steht es um die Qualität heute?', mid ? `Was macht ${mid} gerade?` : 'Wie läuft die Schicht?'];
    return done(a);
  }
  const GROUP_LABEL = { turn: 'Drehen', mill: 'Fräsen' };
  function ansCapacity(c, q) {
    const a = A('capacity'), rows = loadRows(c), t = c.t;
    const freeAt = (id) => Math.max(t, ...(c.fc().machines[id] || []).map(e => e.end));
    const ms = PROF().machines.filter(id => station(id).kind === 'machine').map(id => ({ id, st: station(id), free: freeAt(id), work: (rows.find(r => r.id === id) || { work: 0 }).work }));
    ms.sort((x, y) => x.free - y.free);
    const turn = /welle|bolzen|drehteil|dreh|achs/.test(q), mill = /gehaeuse|platte|fraes|block/.test(q);
    const rel = ms.filter(m => (turn ? TYPE_GROUP[m.st.type] === 'turn' : mill ? TYPE_GROUP[m.st.type] === 'mill' : true));
    a.eyebrow = 'Kapazität · neuer Auftrag';
    const first = rel[0];
    a.sev = first && first.free - t < 4 * 3600 ? 'ok' : 'warn';
    const dayEnd = Math.floor(t / DAY) * DAY + 22 * 3600, grp = turn ? 'Dreh' : mill ? 'Fräs' : '';
    a.head = !first ? 'Keine passende Maschine' : /heute/.test(q) && first.free > dayEnd ? `Heute keine freie ${grp ? grp + '-' : ''}Kapazität – frühestens ${mName(first.id)} ab ${dueTxt(first.free)}` : `${turn ? 'Drehen' : mill ? 'Fräsen' : 'Frühester freier Platz'}: ${mName(first.id)} frei ab ${dueTxt(first.free)}`;
    a.md.push('Frei ab = Ende der letzten eingeplanten Belegung laut Plantafel; ein Eilauftrag könnte eingeplante (nicht laufende) Arbeitsgänge überholen.', '');
    for (const m of rel.slice(0, 5)) a.md.push(`- **${mName(m.id)}** (${GROUP_LABEL[TYPE_GROUP[m.st.type]] || m.st.area || m.st.name}): frei ab ${dueTxt(m.free)} – Vorrat ${hTxt(m.work)}`);
    const hasKi = (WF.views || []).some(v => v.id === 'ki-auftrag');
    a.md.push('', '> **Empfehlung:** ' + (hasKi ? 'Zeichnung im KI-Auftrag hochladen – dort werden Arbeitsplan, Durchlaufzeit und frühester Liefertermin gegen die echte Plantafel gerechnet, bevor zugesagt wird.' : 'Arbeitsplan und Durchlaufzeit gegen die Plantafel prüfen, bevor zugesagt wird.'));
    if (hasKi) addAction(a, { label: 'KI-Auftrag öffnen', desc: 'Zeichnung → Arbeitsplan → Liefertermin gegen die Plantafel', action: { type: 'navigate', view: 'ki-auftrag' }, icon: 'file', quiet: true });
    a.sources = ['Plantafel (Belegung je Maschine)', 'Arbeitsvorrat', srcStand()];
    a.followups = ['Was ist der Engpass?', 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  function ansIdle(c) {
    const a = A('idle'), mvs = c.mvs(), sh = WF.sim.shift();
    const idle = mvs.filter(m => m.state === 'idle'), waits = mvs.filter(m => WAIT[m.state]), faults = mvs.filter(m => m.state === 'fault');
    const rows = loadRows(c);
    a.eyebrow = 'Auslastung · ' + WF.sim.clock();
    a.sev = faults.length ? 'crit' : waits.length > 2 ? 'warn' : 'info';
    const stand = idle.length + waits.length + faults.length;
    a.head = stand ? `${stand} von ${mvs.length} Arbeitsplätzen ${stand === 1 ? 'produziert' : 'produzieren'} gerade nicht` : `Alle ${mvs.length} Arbeitsplätze produzieren`;
    if (!sh.id) a.md.push(`Geisterschicht: bemannte Plätze stehen bis ${dueTxt(sh.endsAt)}; nur autonome Maschinen laufen weiter.`, '');
    else if (sh.inBreak) a.md.push(`Pause bis ${clk(sh.breakEndsAt)} – bemannte Plätze pausieren nach dem laufenden Teil.`, '');
    for (const m of idle) {
      const next = (c.fc().machines[m.id] || []).filter(e => e.start > c.t).sort((x, y) => x.start - y.start)[0];
      const r = rows.find(x => x.id === m.id);
      a.md.push(`- **${mName(m.id)}** ${msl(m) === 'Keine Schicht' ? 'steht planmäßig (keine Schicht)' : 'ohne Auftrag'} – ${next ? `nächster Arbeitsgang ${next.orderId} AG ${next.seq} ab ca. ${tc(next.start)} (Vorgänger noch in Arbeit)` : 'nichts eingeplant'}${r ? '; Vorrat ' + hTxt(r.work) : ''}.`);
    }
    for (const m of waits) a.md.push(`- **${mName(m.id)}** ${lc1(msl(m))} seit ${durR(m.sinceSec)}: ${causeCore(m)}.`);
    for (const m of faults) a.md.push(`- **${mName(m.id)}** Störung ${m.fault.code} – Ende ca. ${clk(faultInfo(m).endT)}.`);
    const free = idle.filter(m => !(c.fc().machines[m.id] || []).length);
    a.md.push('', '> **Empfehlung:** ' + (waits.length ? `${waits[0].id} zuerst wieder anlaufen lassen: ${waitAdvice(c, waits[0])}` : free.length ? `${listJoin(free.map(m => m.id))} ${free.length === 1 ? 'hat' : 'haben'} nichts eingeplant – freie Kapazität für Verlagerungen vom Engpass oder neue Aufträge.` : 'Die freien Plätze warten auf Teile vom Vorgänger – kein Eingriff nötig.'));
    a.sources = ['Maschinenstatus', 'Plantafel', 'Arbeitsvorrat', srcStand()];
    a.followups = ['Was ist der Engpass?', 'Kann ich heute noch einen Eilauftrag annehmen?'];
    return done(a);
  }
  function ansOee(c) {
    const a = A('oee'), k = c.k(), L = lossByCause(c), oh = oeeHead(k);
    a.eyebrow = 'Kennzahl · ' + oh.label;
    if (oh.v == null) { a.head = 'Heute noch keine OEE'; a.md.push('Ohne Planzeit (Nacht, Wochenende) gibt es keine Bezugszeit.'); return done(a); }
    a.sev = oh.v >= TARGET_OEE ? 'ok' : 'warn';
    a.head = `${oh.staffed ? 'OEE der Schichten heute' : 'OEE heute'} ${pct(oh.v, 1)} – ${oh.v >= TARGET_OEE ? 'über' : 'unter'} dem Ziel von ${pct(TARGET_OEE)}`;
    const comp = [['Verfügbarkeit', oh.a], ['Leistung', oh.p], ['Qualität', oh.q]].filter(x => x[1] != null);
    const low = comp.slice().sort((x, y) => x[1] - y[1])[0];
    a.md.push(`${comp.map(x => x[0] + ' ' + pct(x[1], 1)).join(' × ')} = ${pct(oh.v, 1)}.${low ? ` Größter Verlust: **${low[0]}** (${pct(1 - low[1], 1)} gehen dort verloren).` : ''}${oh.staffed ? ` Ganzer Tag inkl. Geisterschicht ${pct(oh.day, 1)} – die Nacht zählt getrennt wie im Leitstand.` : ''}`);
    a.stats = [{ l: oh.staffed ? 'OEE · Schichten' : 'OEE', v: pct(oh.v, 1), s: 'Ziel ' + pct(TARGET_OEE), c: a.sev }].concat(comp.map(x => ({ l: x[0], v: pct(x[1], 1), s: x === low ? 'größter Verlust' : '', c: x === low ? 'warn' : '' })));
    if (L.causes.length) a.md.push('', `Verfügbarkeit kosten vor allem: ${L.causes.slice(0, 3).map(x => `${causeLabel(x.state)} ${durR(x.sec)}`).join(', ')}.`);
    a.md.push('', '> **Empfehlung:** ' + (L.causes[0] ? `Größter Hebel ${causeLabel(L.causes[0].state)}: ${CAUSE_ADVICE[L.causes[0].state]}` : 'Keine Maßnahme nötig.'));
    a.sources = ['Kennzahlen heute (Verfügbarkeit × Leistung × Qualität)', 'Zustandsband', srcStand()];
    a.followups = ['Welche Maschine hat die schlechteste OEE?', 'Wo verlieren wir heute Geld?'];
    return done(a);
  }
  function ansRate(c, id) {
    const a = A('loss'), mv = c.mv(id);
    a.entity = { kind: 'machine', id };
    a.eyebrow = 'Kosten · Stundensatz'; a.sev = 'info';
    a.head = `Eine Stunde Stillstand an ${mName(id)} kostet ca. ${eur(mv.rate)}`;
    a.md.push(`Maschinenstundensatz ${eur(mv.rate)}/h – gezählt wird die Zeit, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Schichtzeit ohne Pausen). Heute bisher ${eur(mv.lossEurToday)}.`);
    const rank = c.mvs().slice().sort((x, y) => y.rate - x.rate);
    a.md.push('', `Teuerste Stunden im Werk: ${rank.slice(0, 3).map(m => `${m.id} ${eur(m.rate)}/h`).join(', ')}.`);
    a.sources = ['Stundensätze (Stammdaten)', 'Stillstandskosten heute', srcStand()];
    a.followups = [`Was macht ${id} gerade?`, 'Wo verlieren wir heute Geld?'];
    return done(a);
  }
  function ansSmall(q) {
    const a = A('small');
    if (/^(danke|vielen dank|merci|super|top|perfekt|passt|ok|okay|alles klar)/.test(q)) { a.head = 'Gern.'; a.md.push('Wenn sich an der Lage etwas ändert, frag einfach erneut – die Antworten kommen immer aus den Live-Daten.'); }
    else { a.head = 'Grüß Gott!'; a.md.push('Ich beantworte Fragen zur Fertigung aus den Live-Daten – Lage, Termine, Maschinen, Werkzeuge, Material, Personal und Kosten.'); }
    a.followups = ['Was muss ich jetzt tun?', 'Wie läuft die Schicht?'];
    return done(a);
  }

  // ------------------------------------------------------------------ Meldungen, Ausbringung, Versand, Überstunden, Kunden, Eilauftrag, Verzugskosten, OEE je Maschine, Vergleich
  const SEV_RANK = { crit: 0, warn: 1, info: 2, ok: 3 };
  /** Empfehlungsteil einer Meldung (eine Zeile): „Empfehlung: …“ aus der Engine-Zeile, sonst der erste Satz */
  const sugShort = (n) => { const t = String(n.suggestion || ''), m = /Empfehlung:\s*([^]*?)\.?\s*$/.exec(t); return trimTxt((m ? m[1] : t.split(/(?<=\.)\s/)[0] || '').replace(/\.$/, ''), 140); };
  /** Offene Meldungen – dieselbe Zählung wie Glocke und Leitstand: offen = Warnungen/kritische Meldungen ohne Quittung */
  function ansNotifications(c) {
    const a = A('notifs');
    const all = (S().notifications || []).filter(n => n.status !== 'resolved');
    const isImp = (n) => n.sev === 'crit' || n.sev === 'warn';
    const sortN = (l) => l.slice().sort((x, y) => ((SEV_RANK[x.sev] || 0) - (SEV_RANK[y.sev] || 0)) || ((y.updatedT || y.t) - (x.updatedT || x.t)));
    const imp = sortN(all.filter(n => n.status === 'open' && isImp(n))), ack = sortN(all.filter(n => n.status === 'ack' && isImp(n))), info = sortN(all.filter(n => n.status === 'open' && !isImp(n)));
    const crit = imp.filter(n => n.sev === 'crit').length;
    a.eyebrow = 'Meldungen · ' + WF.sim.clock();
    a.sev = crit ? 'crit' : imp.length ? 'warn' : 'ok';
    a.head = imp.length ? `${pl(imp.length, 'offene Meldung', 'offene Meldungen')}${crit ? ` – ${crit} kritisch` : ''}${imp.length - crit ? `${crit ? ',' : ' –'} ${imp.length - crit} ${imp.length - crit === 1 ? 'Warnung' : 'Warnungen'}` : ''}` : 'Keine offenen Warnungen';
    a.md.push(`Gezählt wie Glocke und Leitstand: offen = Warnungen und kritische Meldungen ohne Quittung${ack.length ? `; ${ack.length} quittiert (Ursache besteht noch)` : ''}${info.length ? `; dazu ${pl(info.length, 'Hinweis', 'Hinweise')} (Info)` : ''}.`);
    a.stats = [{ l: 'Offen', v: nm(imp.length), s: crit ? crit + ' kritisch' : imp.length ? 'Warnungen' : 'keine Warnung', c: crit ? 'crit' : imp.length ? 'warn' : '' }, { l: 'Quittiert', v: nm(ack.length), s: 'Ursache besteht noch' }, { l: 'Info', v: nm(info.length), s: 'Hinweise' }];
    const list = imp.concat(ack, info.slice(0, Math.max(2, 7 - imp.length - ack.length))).slice(0, 8);
    if (list.length) {
      a.md.push('');
      SLOT(a, 'notifs', list.map(n => `- **${n.title}** (${(WF.SEV[n.sev] || WF.SEV.info).label}${n.status === 'ack' ? ', quittiert' : ''} · ${WF.ui.notifTime(n, { text: true })} · ${n.role}) – ${sugShort(n) || n.body || ''}`).join('\n'),
        list.map(n => ({ id: n.id, sev: n.sev, sevL: (WF.SEV[n.sev] || WF.SEV.info).label, ack: n.status === 'ack', time: WF.ui.notifTime(n, { text: true }), role: n.role, title: n.title, sug: sugShort(n) || n.body || '', ent: n.entity && n.entity.id && n.entity.kind !== 'plant' ? n.entity : null })));
      if (all.length > list.length) a.md.push(`Weitere ${all.length - list.length} in der Glocke (Verlauf).`);
    } else a.md.push('', 'Alles im grünen Bereich – keine offenen Meldungen.');
    const top = imp[0] || ack[0] || null;
    a.md.push('', '> **Empfehlung:** ' + (top ? `Mit „${top.title}“ beginnen${sugShort(top) ? ': ' + sugShort(top) : ''}.` : info.length ? 'Keine Warnung offen – die Hinweise bei Gelegenheit quittieren.' : 'Keine Maßnahme nötig.'));
    if (top) addAction(a, { label: 'Meldung analysieren', desc: top.title, action: { type: 'explain', id: top.id }, icon: 'sparkles' });
    const ackable = imp.concat(info);
    if (ackable.length > 1) addAction(a, { label: `Alle ${ackable.length} quittieren`, desc: 'Als gesehen markieren (bleiben bis zur Klärung sichtbar)', action: { type: 'ackMany', ids: ackable.map(n => n.id) }, icon: 'check', quiet: true });
    a.sources = ['Benachrichtigungen (wie Glocke)', srcStand()];
    a.followups = ['Was muss ich jetzt tun?', 'Wie läuft die Schicht?'];
    return done(a);
  }
  /** Ausbringung heute – dieselben Zähler wie die Leitstand-Kachel „Fertige Teile heute“ */
  function ansParts(c) {
    const a = A('parts'), k = c.k(), sh = WF.sim.shift(), ss = S().shiftStats || {}, d0 = Math.floor(c.t / DAY) * DAY;
    a.eyebrow = 'Ausbringung · heute';
    a.sev = 'info';
    a.head = `Heute ${nm(k.goodFinished)} fertige Teile · ${nm(k.good)} Arbeitsgänge gut · ${nm(k.shippedToday || 0)} versandt`;
    a.md.push('Fertige Teile = Gutteile des letzten Bearbeitungsschritts je Auftrag (wie die Leitstand-Kachel); „Arbeitsgänge gut“ zählt jede gute Bearbeitung, auch Waschen und Prüfen.');
    a.stats = [{ l: 'Fertige Teile', v: nm(k.goodFinished), s: 'letzter Bearbeitungsschritt' }, { l: 'Arbeitsgänge gut', v: nm(k.good), s: sh.id ? 'Schicht ' + nm(ss.good || 0) : 'heute' }, { l: 'Versandt', v: nm(k.shippedToday || 0), s: 'Teile heute' }, { l: 'Ausschuss', v: nm(k.scrap), s: 'FPY ' + pct(k.fpy, 1), c: k.scrap ? 'warn' : '' }];
    const doneToday = c.ovs().filter(o => o.status === 'fertig' && o.doneT >= d0).sort((x, y) => x.doneT - y.doneT);
    if (doneToday.length) a.md.push('', `Heute abgeschlossen: ${doneToday.map(o => `${o.id} (${stk(o.qty)}${o.onTime ? '' : ', nach dem Termin'})`).join(', ')}.`);
    const rows = c.mvs().filter(m => m.goodToday > 0).sort((x, y) => y.goodToday - x.goodToday).slice(0, 6);
    if (rows.length) {
      a.md.push('', '### Gutteile je Arbeitsplatz (je Arbeitsgang)');
      SLOT(a, 'bars', rows.map(m => `- ${mName(m.id)}: ${nm(m.goodToday)}`).join('\n'), { rows: rows.map(m => ({ ent: { kind: 'machine', id: m.id }, label: station(m.id).short, v: m.goodToday, vTxt: nm(m.goodToday) + ' Stk', sub: `${m.order ? m.order.id + ' AG ' + m.order.seq + ' · ' : ''}${m.scrapToday ? nm(m.scrapToday) + ' Ausschuss · ' : ''}jetzt ${msl(m)}`, c: 'color-mix(in srgb,var(--text2) 70%,transparent)' })) });
    }
    a.md.push('', `> **Einschätzung:** ${k.scrap ? `${nm(k.scrap)} Ausschuss, FPY ${pct(k.fpy, 1)}` : 'Kein Ausschuss'}; Termintreue ${pct(k.onTimePct)}.`);
    a.sources = ['Teilezähler heute (Engine)', 'Leitstand-Kennzahl Fertige Teile', srcStand()];
    a.followups = ['Was wird bis Schichtende noch fertig?', 'Welche Aufträge werden heute ausgeliefert?'];
    return done(a);
  }
  /** Versand heute – dieselbe Zählung wie kpis().shippedToday (Teile, die heute in den Versand gingen), je Auftrag;
      dazu Abholung durch die Spedition (Ereignis shipOut) und was heute noch fällig ist */
  function ansShip(c) {
    const a = A('ship'), t = c.t, d0 = Math.floor(t / DAY) * DAY, k = c.k();
    const by = {};
    for (const x of Object.values(S().containers || {})) {
      if (x.state !== 'shipped' || x.kind === 'scrap') continue;
      const tt = x.readyT != null ? x.readyT : x.createdT; if (!(tt >= d0)) continue;
      const g = by[x.orderId] || (by[x.orderId] = { id: x.orderId, qty: 0, t: tt }); g.qty += x.qty || 0; g.t = Math.max(g.t, tt);
    }
    const out = {};
    for (const e of (S().events || [])) if (e.type === 'shipOut' && e.t >= d0 && e.data && e.data.orderId) out[e.data.orderId] = e.t;
    const rows = Object.values(by).sort((x, y) => x.t - y.t), sum = rows.reduce((s2, x) => s2 + x.qty, 0);
    const due = c.open().filter(o => o.due >= d0 && o.due < d0 + DAY).sort((x, y) => x.due - y.due);
    a.eyebrow = 'Versand · heute';
    a.sev = due.some(o => o.slackSec < 0) ? 'warn' : 'ok';
    a.head = rows.length ? `Heute ${nm(k.shippedToday != null ? k.shippedToday : sum)} Teile versandt – ${pl(rows.length, 'Auftrag', 'Aufträge')}` : 'Heute noch nichts versandt';
    a.md.push('Versandt = Behälter, die heute in den Versand gingen (gleiche Zahl wie „versandt“ im Leitstand); die Spedition holt ca. 2 h später ab (Lieferfenster 06–20 Uhr).', '');
    for (const x of rows) {
      const o = c.ov(x.id), part = o && o.status !== 'fertig';
      a.md.push(`- **${x.id}** ${o ? o.part.name + ' (' + custShort(o.customer) + ')' : ''}: ${stk(x.qty)} um ${clk(x.t)}${out[x.id] ? ', abgeholt ' + clk(out[x.id]) : ', wartet auf Abholung'}${part ? ` – Teillieferung (${nm(o.shippedQty)}/${nm(o.qty)} gesamt)` : ''}.`);
    }
    if (due.length) a.md.push(`- Heute noch fällig: ${due.map(o => `${o.id} Termin ${clk(o.due)}, Prognose ${dueTxt(o.eta)}${etaTag(o)} (${slackTxt(o.slackSec)})`).join('; ')}.`);
    if (!rows.length && !due.length) a.md.push('- Heute ist kein Auftrag fällig und noch nichts in den Versand gegangen.');
    a.stats = [{ l: 'Versandt', v: nm(k.shippedToday != null ? k.shippedToday : sum), s: 'Teile heute' }, { l: 'Aufträge', v: nm(rows.length), s: rows.filter(x => { const o = c.ov(x.id); return o && o.status !== 'fertig'; }).length + ' als Teillieferung' }, { l: 'Heute fällig', v: nm(due.length), s: due.some(o => o.slackSec < 0) ? 'davon verspätet' : 'offen', c: due.some(o => o.slackSec < 0) ? 'warn' : '' }];
    const lateDue = due.filter(o => o.slackSec < 0);
    a.md.push('', '> **Empfehlung:** ' + (lateDue.length ? `${lateDue[0].id}: ${adviceText(c, lateDue[0]).text}` : due.length ? 'Fällige Aufträge halten – Versandpapiere vorbereiten.' : 'Keine Maßnahme nötig.'));
    a.sources = ['Behälter im Versand heute', 'Spedition (Abholung)', 'Aufträge und Liefertermine', srcStand()];
    a.followups = ['Welche Aufträge sind morgen fällig?', 'Wie viele Teile haben wir heute gefertigt?'];
    return done(a);
  }
  /** Kosten einer Überstunde (Personal-Vollkosten + Zuschlag, Engine costs()) */
  function overtimeRate() {
    let co = null; try { co = WF.sim.costs ? WF.sim.costs() : null; } catch (e) { co = null; }
    const lab = co && co.labourEurPerHour ? co.labourEurPerHour : null, sur = co && co.overtimeSurchargePct != null ? co.overtimeSurchargePct : 50;
    return lab ? lab * (1 + sur / 100) : null;
  }
  /** Engpass eines Auftrags intern (Maschine – Überstunden helfen) oder extern (Fremdbearbeitung – Überstunden helfen nicht) */
  function limitOf(c, o) {
    const adv = simAdvice(o.id) || {}, lim = adv.limit || o.limit || null;
    const ext = adv.causeKind === 'ext' || (lim && (lim.stationId === 'EXT' || lim.kind === 'ext'));
    const st = !ext ? (lim && lim.stationId && S().machines[lim.stationId] ? lim.stationId : adv.bottleneckStation || bnMachine(o)) : null;
    const extOp = ext ? o.ops.find(op => op.station === 'EXT' && !op.complete) : null;
    return { adv, ext, station: st, partner: extOp && extOp.ext ? partnerName(extOp.ext.partner) : 'dem Fremdbearbeiter', process: extOp ? (extOp.ext && extOp.ext.process) || extOp.op : null };
  }
  function ansOvertime(c, E) {
    const a = A('overtime'), rate = overtimeRate();
    let open = c.open().filter(o => o.eta != null);
    if (E && E.orders.length) open = open.filter(o => E.orders.indexOf(o.id) >= 0);
    const late = open.filter(o => o.slackSec < 0).sort((x, y) => x.slackSec - y.slackSec);
    const tight = open.filter(o => o.risk === 'knapp');
    a.eyebrow = 'Kapazität · Überstunden';
    if (!late.length) {
      a.sev = 'ok'; a.head = `Keine Überstunden nötig – ${E && E.orders.length ? E.orders[0] + ' hält den Termin' : 'kein Auftrag verspätet'}`;
      a.md.push(tight.length ? `${listJoin(tight.map(o => o.id + ' (' + slackTxt(o.slackSec) + ')'))} ${tight.length === 1 ? 'ist' : 'sind'} knapp – dort zuerst Stillstand vermeiden statt Überstunden einplanen.` : 'Alle offenen Aufträge haben mehr als 4 h Puffer.');
      a.md.push('', '> **Empfehlung:** Keine Zusatzschicht – Engpass ohne Unterbrechung laufen lassen.');
      a.sources = ['Prognose / Plantafel', srcStand()]; a.followups = ['Was ist der Engpass?', 'Welche Aufträge sind gefährdet und warum?']; return done(a);
    }
    const costOf = (x) => (x.costEur != null ? x.costEur : x.cost != null ? x.cost : null);
    const rows = late.map(o => {
      // Überstunden-Hebel der Engine (Abend / Samstag mit Gewinn und Kosten), sonst eigene Schätzung
      const L = limitOf(c, o), ots = (L.adv.alternatives || []).filter(x => x.kind === 'overtime');
      const best = ots.filter(x => x.ok !== false && x.gainSec >= 900).sort((x, y) => y.gainSec - x.gainSec || (costOf(x) || 0) - (costOf(y) || 0))[0] || null;
      const need = -o.slackSec, hrs = Math.min(need, 8 * 3600);
      const costE = best ? costOf(best) : rate ? rate * hrs / 3600 : null;
      const other = (L.adv.alternatives || []).filter(x => x.ok && x.kind !== 'overtime' && x.kind !== 'priority' && x.kind !== 'partial' && x.gainSec >= 900).sort((x, y) => y.gainSec - x.gainSec)[0] || null;
      return { o, L, best, ots, need, hrs, costE, other, helps: best ? true : ots.length ? false : !L.ext && !!L.station && need <= 8 * 3600 };
    });
    const help = rows.filter(r => r.helps), noHelp = rows.filter(r => !r.helps);
    a.sev = help.length ? 'warn' : 'info';
    const h0 = help[0];
    a.head = h0 ? (h0.best ? `Ja: ${h0.best.label} für ${h0.o.id} – ${durR(h0.best.gainSec)} früher${h0.costE != null ? ', ca. ' + eur(h0.costE) : ''}` : `Ja, an ${mName(h0.L.station)}: ca. ${durR(h0.hrs)} für ${h0.o.id}${h0.costE != null ? ' (ca. ' + eur(h0.costE) + ')' : ''}`)
      : `Überstunden helfen nicht – ${listJoin(noHelp.map(r => r.o.id))} ${noHelp.length === 1 ? 'hängt' : 'hängen'} an ${noHelp[0].L.ext ? noHelp[0].L.partner : 'einer anderen Stelle'}`;
    a.md.push(`Überstunden bringen nur Zeit, wenn der Auftrag an einer eigenen Maschine hängt; liegt die Begrenzung bei einem Fremdbearbeiter, ändert Mehrarbeit im Werk den Liefertermin nicht.${rate ? ` Kostensatz ${eur(rate)}/h (Personal inkl. Überstundenzuschlag).` : ''}`, '');
    const otTxt = (r) => r.ots.length ? r.ots.slice(0, 2).map(x => x.label.replace(/^Überstunden an /, '')).join(', ') : '';
    for (const r of rows) a.md.push(`- **${r.o.id}** (${durR(r.need)} Verzug, ${r.L.ext ? 'begrenzt durch ' + r.L.partner + (r.L.process ? ' – ' + r.L.process : '') : r.L.station ? 'begrenzt durch ' + mName(r.L.station) : 'Begrenzung unklar'}): ${r.best ? `${r.best.label} bringt ${durR(r.best.gainSec)}${r.costE != null ? ', ca. ' + eur(r.costE) : ''}` : r.ots.length ? `Überstunden (${otTxt(r)}) bringen keine spürbare Änderung` : r.helps ? `ca. ${durR(r.hrs)} Überstunden${r.costE != null ? ', ca. ' + eur(r.costE) : ''}${r.need > 8 * 3600 ? ' (holen allein nicht alles auf)' : ''}` : r.L.ext ? 'Überstunden im Werk helfen nicht' : 'Verzug größer als eine Zusatzschicht'}${!r.helps && r.other ? `; wirksamer: ${r.other.label} (${durR(r.other.gainSec)} früher${costOf(r.other) != null ? ', ' + (costOf(r.other) > 0 ? 'ca. ' + eur(costOf(r.other)) : 'ohne Zusatzkosten') : ''})` : ''}.`);
    const alt0 = noHelp.find(r => r.other);
    a.md.push('', '> **Empfehlung:** ' + (h0 ? `${h0.best ? h0.best.label : 'Überstunden an ' + mName(h0.L.station)} für ${h0.o.id} einplanen${noHelp.length ? '; für ' + listJoin(noHelp.map(r => r.o.id)) + ' stattdessen ' + (alt0 ? alt0.other.label : noHelp[0].L.ext ? 'Expressdurchlauf bei ' + noHelp[0].L.partner + ' anfragen' : 'Teillieferung abstimmen') : ''}.`
      : alt0 ? `Keine Überstunden – für ${alt0.o.id} wirkt ${alt0.other.label} (${durR(alt0.other.gainSec)} früher).` : noHelp[0].L.ext ? `Expressdurchlauf bei ${noHelp[0].L.partner} anfragen und ${custShort(noHelp[0].o.customer)} informieren.` : `Teillieferung mit ${custShort(noHelp[0].o.customer)} abstimmen.`));
    if (!h0 && alt0) for (const x of adviceText(c, alt0.o).actions) addAction(a, x);
    a.sources = ['Terminberatung je Auftrag (Engine)', 'Kostensätze (Profil)', srcStand()];
    a.followups = [`Warum ist ${late[0].id} verspätet?`, 'Was ist der Engpass?'];
    a.entity = { kind: 'order', id: late[0].id };
    return done(a);
  }
  /** Kunden nach offenen Aufträgen */
  function ansCustomers(c) {
    const a = A('customers'), by = {};
    for (const o of c.open()) { const g = by[o.customer] || (by[o.customer] = { name: o.customer, n: 0, qty: 0, late: 0, tight: 0, next: null }); g.n++; g.qty += o.qty; if (o.risk === 'spät') g.late++; else if (o.risk === 'knapp') g.tight++; if (g.next == null || o.due < g.next) g.next = o.due; }
    const rows = Object.values(by).sort((x, y) => y.n - x.n || y.qty - x.qty);
    a.eyebrow = 'Kunden · offene Aufträge';
    if (!rows.length) { a.head = 'Keine offenen Aufträge'; return done(a); }
    const top = rows[0], tie = rows.filter(r => r.n === top.n);
    a.sev = rows.some(r => r.late) ? 'warn' : 'info';
    a.head = tie.length > 1 ? `${listJoin(tie.map(r => custShort(r.name)))} mit je ${top.n} offenen Aufträgen vorn` : `${custShort(top.name)} hat die meisten offenen Aufträge (${top.n})`;
    a.md.push(`${rows.length} Kunden mit offenen Aufträgen; insgesamt ${pl(c.open().length, 'Auftrag', 'Aufträge')}.`, '');
    SLOT(a, 'bars', rows.slice(0, 7).map(r => `- ${custShort(r.name)}: ${pl(r.n, 'Auftrag', 'Aufträge')}`).join('\n'), { rows: rows.slice(0, 7).map(r => ({ label: custShort(r.name), v: r.n, vTxt: pl(r.n, 'Auftrag', 'Aufträge'), sub: `${stk(r.qty)} · nächster Termin ${dueTxt(r.next)}${r.late ? ' · ' + r.late + ' verspätet' : ''}${r.tight ? ' · ' + r.tight + ' knapp' : ''}`, c: r.late ? 'var(--st-fault)' : r.tight ? 'var(--st-wait)' : 'color-mix(in srgb,var(--text2) 70%,transparent)' })) });
    const risky = rows.filter(r => r.late || r.tight);
    a.md.push('', '> **Empfehlung:** ' + (risky.length ? `${custShort(risky[0].name)}: ${risky[0].late ? risky[0].late + ' verspätet' : risky[0].tight + ' knapp'} – Termine dort zuerst absichern („Welche Aufträge sind gefährdet und warum?“).` : 'Alle Kunden im Plan – keine Maßnahme nötig.'));
    a.sources = ['Auftragsbestand', 'Prognose', srcStand()];
    a.followups = [`Wie stehen die Aufträge von ${custShort(top.name)}?`, 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  /** „Was bringt ein Eilauftrag für FA-…?“ – Antwort aus dem Was-wäre-wenn der Engine (keine Rückfrage) */
  function ansEil(c, id) {
    const a = A('eil'), o = c.ov(id);
    a.eyebrow = 'Was-wäre-wenn · Eilauftrag';
    if (!o) { a.head = `Auftrag ${id} ist nicht bekannt`; return done(a); }
    a.entity = { kind: 'order', id };
    if (o.status === 'fertig') { a.head = `${id} ist bereits fertig`; return done(a); }
    if (o.priority === 'eil') { a.sev = 'info'; a.head = `${id} ist bereits Eilauftrag – Prognose ${dueTxt(o.eta)}`; a.md.push(`${slackTxt(o.slackSec)}${etaTag(o)}.`); a.followups = [`Warum ist ${id} ${o.slackSec < 0 ? 'verspätet' : 'knapp'}?`]; return done(a); }
    let w = null; try { w = WF.sim.whatIfPriority ? WF.sim.whatIfPriority(id, 'eil') : null; } catch (e) { w = null; }
    const adv = simAdvice(id) || {}, ad = adviceText(c, o, adv);
    const gain = w && w.ok ? Math.max(0, w.gainSec || 0) : 0, rec = !!(w && w.ok && w.recommend);
    const after = o.eta - gain, newSlack = o.due - after;
    const hurt = w && w.ok ? (w.newlyLate || []).concat(w.laterLate || []) : [];
    a.sev = rec ? 'ok' : gain < 60 ? 'info' : 'warn';
    a.head = gain < 60 ? `Eilauftrag bringt für ${id} nichts – Prognose bleibt ${dueTxt(o.eta)}` : rec ? `Als Eilauftrag: ${id} ca. ${durR(gain)} früher fertig (${dueTxt(after)})` : `Eilauftrag holt ${durR(gain)} – aber ${listJoin(hurt.slice(0, 2))} ${hurt.length === 1 ? 'würde' : 'würden'} dadurch spät`;
    a.stats = [{ l: 'Prognose jetzt', v: tc(o.eta), s: 'Termin ' + tc(o.due), c: o.slackSec < 0 ? 'crit' : o.risk === 'knapp' ? 'warn' : '' }, { l: 'Als Eilauftrag', v: tc(after), s: gain < 60 ? NOCHG : deltaTxt(-gain), c: newSlack < 0 ? 'crit' : '' }, { l: 'Andere Aufträge', v: nm(hurt.length), s: hurt.length ? 'würden (später) spät' : 'keiner wird spät', c: hurt.length ? 'warn' : '' }];
    if (w && w.ok && w.text) a.md.push(`${w.text.replace(/\.$/, '')}.`);
    const pa = (adv.alternatives || []).find(x => x.kind === 'priority');
    if (!rec && (pa && pa.note)) a.md.push('', pa.note);
    else if (!rec && ad.eilWhy) a.md.push('', ad.eilWhy);
    const aff = w && w.ok ? (w.affected || []).filter(r => r.orderId !== id && Math.abs(r.deltaSec) >= 300) : [];
    if (aff.length) { a.md.push('', '### Auswirkung auf andere Aufträge'); for (const r of aff.slice(0, 5)) a.md.push(`- **${r.orderId}**: ${dueTxt(r.before)} → ${dueTxt(r.after)} (${deltaTxt(r.deltaSec)})${r.after > r.due ? ' – dann ' + durR(r.after - r.due) + ' zu spät' : ''}`); }
    if (rec) { a.md.push('', `> **Empfehlung:** ${id} als Eilauftrag kennzeichnen – die Maschinen ziehen ihn beim nächsten Auftragswechsel vor, kein anderer Auftrag wird dadurch spät.`); addAction(a, { label: `${id} als Eilauftrag`, desc: `Fertig ca. ${dueTxt(after)} statt ${dueTxt(o.eta)}`, action: { type: 'setPriority', orderId: id, priority: 'eil' }, icon: 'bolt' }); }
    else { a.md.push('', `> **Empfehlung:** ${ad.primary ? uc1(ad.primary) + '.' : o.slackSec >= 0 ? 'Kein Eilauftrag nötig – der Termin hält.' : ad.text}`); for (const x of ad.actions.filter(x => !(x.action && x.action.type === 'setPriority'))) addAction(a, x); addAction(a, { label: 'Trotzdem als Eilauftrag', desc: 'Vorrang beim nächsten Auftragswechsel', action: { type: 'setPriority', orderId: id, priority: 'eil' }, icon: 'bolt', quiet: true }); }
    a.sources = ['Was-wäre-wenn Eilauftrag (Engine)', 'Terminberatung', srcStand()];
    a.followups = [`Warum ist ${id} ${o.slackSec < 0 ? 'verspätet' : o.risk === 'knapp' ? 'knapp' : 'im Plan'}?`, 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  /** „Was kostet uns der Verzug von FA-…?“ – Verzug, Kosten der Hebel; Vertragsstrafe ist nicht hinterlegt */
  function ansOrderCost(c, id) {
    const a = A('ordercost'), o = c.ov(id);
    a.eyebrow = 'Kosten · Verzug ' + id;
    if (!o) { a.head = `Auftrag ${id} ist nicht bekannt`; return done(a); }
    a.entity = { kind: 'order', id };
    const L = limitOf(c, o), rate = overtimeRate();
    if (o.status === 'fertig' || o.slackSec == null || o.slackSec >= 0) {
      a.sev = 'ok'; a.head = o.status === 'fertig' ? `${id} ist fertig – ${o.onTime ? 'termingerecht' : 'nach dem Termin'}` : `${id} ist nicht verspätet – ${slackTxt(o.slackSec)}`;
      a.md.push('Ohne Verzug entstehen keine Verzugskosten.'); a.sources = ['Prognose', srcStand()]; return done(a);
    }
    const need = -o.slackSec;
    const alts = (L.adv.alternatives || []).filter(x => x.ok);
    const costOf = (x) => (x.cost != null ? x.cost : x.costEur != null ? x.costEur : null);
    a.sev = 'warn';
    const eff = alts.filter(x => costOf(x) != null && x.gainSec >= 900).sort((x, y) => costOf(x) - costOf(y) || y.gainSec - x.gainSec);
    const cheapest = eff[0] || null;
    const otCost = !L.ext && L.station && rate && !alts.some(x => x.kind === 'overtime') ? rate * Math.min(need, 8 * 3600) / 3600 : null;
    const costTxt = (v) => (v > 0 ? 'ca. ' + eur(v) : 'ohne Zusatzkosten');
    a.head = `${id}: ${durR(need)} Verzug${cheapest ? ` – aufholbar ${costTxt(costOf(cheapest))} (${cheapest.label}, ${durR(cheapest.gainSec)} früher)` : otCost != null ? ` – Überstunden an ${L.station} ca. ${eur(otCost)}` : L.ext ? ` – hängt an ${L.partner}` : ''}`;
    a.stats = [{ l: 'Verzug', v: durR(need), s: 'Termin ' + tc(o.due), c: 'crit' }, { l: 'Prognose', v: tc(o.eta), s: o.etaNew ? 'neu gerechnet' : 'veröffentlicht' }, { l: 'Begrenzt durch', v: L.ext ? 'extern' : L.station || '–', s: L.ext ? L.partner : L.station ? station(L.station).short : '' }];
    a.md.push(`Eine Vertragsstrafe ist für ${custShort(o.customer)} nicht hinterlegt – der direkte Schaden hängt am Kundenvertrag. Beziffern lassen sich die Kosten, den Verzug aufzuholen:`, '');
    const allL = (L.adv.alternatives || []).filter(x => x.kind !== 'priority' && x.kind !== 'partial');
    for (const x of allL.slice(0, 5)) a.md.push(`- **${x.label}**: ${x.ok && x.gainSec >= 60 ? durR(x.gainSec) + ' früher' : 'keine spürbare Änderung'}${costOf(x) != null ? ' · ' + costTxt(costOf(x)) : ''}${x.addedLateSec > 0 ? ' · ein anderer Auftrag wird ' + durR(x.addedLateSec) + ' später spät' : ''}.`);
    if (alts.some(x => x.kind === 'partial')) a.md.push(`- **Teillieferung** mit ${custShort(o.customer)} abstimmen – Frachtkosten je Lieferung.`);
    if (!alts.some(x => x.kind === 'overtime') && otCost != null) a.md.push(`- **Überstunden an ${mName(L.station)}**: ca. ${durR(Math.min(need, 8 * 3600))} × ${eur(rate)}/h = ca. ${eur(otCost)}${need > 8 * 3600 ? ' (holt allein nicht alles auf)' : ''}.`);
    if (L.ext) a.md.push(`- Überstunden im Werk helfen nicht: begrenzt durch ${L.partner}${L.process ? ' (' + L.process + ')' : ''}.`);
    a.md.push('', '> **Empfehlung:** ' + (L.adv.text ? String(L.adv.text).replace(/^Ursache:[^.]*\.\s*/, '').replace(/^Empfehlung:\s*/, '') : `Teillieferung mit ${custShort(o.customer)} abstimmen.`));
    for (const x of adviceText(c, o, L.adv).actions) addAction(a, x);
    a.sources = ['Terminberatung (Engine)', 'Kostensätze (Profil)', srcStand()];
    a.followups = [`Warum ist ${id} verspätet?`, `Was bringt ein Eilauftrag für ${id}?`];
    return done(a);
  }
  /** OEE einer Maschine: V × L × Q und die Verlustursachen (Engine, wie Analyse) */
  function ansOeeMachine(c, id) {
    const a = A('oee'), mv = c.mv(id);
    if (!mv) { a.head = `Arbeitsplatz ${id} ist nicht bekannt`; return done(a); }
    a.entity = { kind: 'machine', id };
    const oe = machineOee(mv, c.k());
    a.eyebrow = 'Kennzahl · OEE ' + id + (oe.staffed ? ' · Schichten' : '');
    if (oe.oee == null) { a.sev = 'info'; a.head = `${mName(id)}: heute noch keine OEE-Bezugszeit`; a.md.push(`${msl(mv)} – ohne eingeplanten Arbeitsgang in der Planzeit zählt keine OEE.`); return done(a); }
    const comp = [['Verfügbarkeit', oe.availability], ['Leistung', oe.performance], ['Qualität', oe.quality]].filter(x => x[1] != null);
    const low = comp.slice().sort((x, y) => x[1] - y[1])[0];
    a.sev = oe.oee >= TARGET_OEE ? 'ok' : 'warn';
    a.head = `${mName(id)}: OEE ${oe.staffed ? 'der Schichten ' : ''}heute ${pct(oe.oee, oeeDec(oe.oee))} – ${oe.oee >= TARGET_OEE ? 'über' : 'unter'} dem Ziel von ${pct(TARGET_OEE)}`;
    a.md.push(`${comp.map(x => x[0] + ' ' + pct(x[1], 1)).join(' × ')} = ${pct(oe.oee, 1)}.${low ? ` Größter Verlust: **${low[0]}** (${pct(1 - low[1], 1)} gehen dort verloren).` : ''}${oe.staffed && oe.day != null ? ` Ganzer Tag inkl. Geisterschicht ${pct(oe.day, 1)}.` : ''}`);
    a.stats = [{ l: 'OEE', v: pct(oe.oee, oeeDec(oe.oee)), s: 'Ziel ' + pct(TARGET_OEE), c: oe.oee >= TARGET_OEE ? '' : 'warn' }].concat(comp.map(x => ({ l: x[0], v: pct(x[1], 1), s: x === low ? 'größter Verlust' : '', c: x === low && x[1] < 0.95 ? 'warn' : '' })));
    const row = lossByCause(c).byMachine.find(x => x.mv.id === id);
    if (row && row.causes.length) {
      a.md.push('', '### Stillstand nach Ursache (Verfügbarkeit)');
      SLOT(a, 'bars', row.causes.map(x => `- ${causeLabel(x.state)}: ${durR(x.sec)} (${eur(x.eur)})`).join('\n'), { rows: row.causes.slice(0, 5).map(x => ({ label: causeLabel(x.state), v: x.sec, vTxt: durR(x.sec), sub: `${eur(x.eur)} Stillstandskosten · ${eur(mv.rate)}/h`, c: (WF.STATE[x.state] || {}).color || 'var(--st-wait)' })) });
    }
    let rec;
    if (low && low[0] === 'Verfügbarkeit' && row && row.causes[0]) rec = `An ${id} zuerst ${causeLabel(row.causes[0].state)} angehen (${durR(row.causes[0].sec)} heute): ${causeAdvice(row.causes[0].state, c.k())}`;
    else if (low && low[0] === 'Leistung') rec = `Leistung ${pct(low[1], 1)}: die Teile brauchen länger als die Vorgabezeit – Einlege- und Nebenzeiten an ${id} prüfen.`;
    else if (low && low[0] === 'Qualität') rec = `Ausschuss an ${id} prüfen (${nm(mv.scrapToday)} heute) – Maß- und Werkzeugzustand.`;
    else rec = 'Keine Maßnahme nötig.';
    a.md.push('', '> **Empfehlung:** ' + rec);
    a.sources = [`Kennzahlen ${id} heute`, 'Stillstandskosten je Zustand (Engine, wie Analyse)', srcStand()];
    a.followups = [`Was macht ${id} gerade?`, 'Welche Maschine hat die schlechteste OEE?'];
    return done(a);
  }
  /** Mehrere Arbeitsplätze nebeneinander (Vergleich bzw. Gattungsbegriff „die Fräse“) */
  function ansCompare(c, ids, typeWord) {
    const a = A('compare');
    const mvs = ids.map(id => c.mv(id)).filter(Boolean);
    const TW = { fraese: 'Fräsen', fraesen: 'Fräsen', fraesmaschine: 'Fräsmaschinen', fraeszentr: 'Fräszentren', bearbeitungszentr: 'Bearbeitungszentren', schleifmaschine: 'Schleifmaschinen', schleifmaschinen: 'Schleifmaschinen', drehmaschine: 'Drehmaschinen', drehbank: 'Drehmaschinen', drehzentr: 'Drehzentren', drehautomat: 'Drehautomaten' };
    a.eyebrow = typeWord ? `${TW[typeWord] || 'Arbeitsplätze'} · ${mvs.length} Maschinen` : 'Vergleich · ' + mvs.map(m => m.id).join(' · ');
    const run = mvs.filter(m => m.state === 'running'), bad = mvs.filter(m => m.state === 'fault' || WAIT[m.state]);
    a.sev = bad.some(m => m.state === 'fault') ? 'crit' : bad.length ? 'warn' : 'ok';
    a.head = typeWord ? `${TW[typeWord] || 'Arbeitsplätze'}: ${run.length} von ${mvs.length} ${run.length === 1 ? 'produziert' : 'produzieren'}${bad.length ? ' – ' + listJoin(bad.map(m => m.id + ' ' + lc1(msl(m)))) : ''}` : `${listJoin(mvs.map(m => m.id))} im Vergleich`;
    a.md.push(typeWord ? `Gemeint sein können ${listJoin(mvs.map(m => mName(m.id)))} – hier ${mvs.length === 2 ? 'beide' : 'alle'} nebeneinander.` : 'Zustand, Auftrag und Kennzahlen von heute nebeneinander.', '');
    const freeAt = (id) => { const l = c.fc().machines[id] || []; return l.length ? Math.max(c.t, ...l.map(e => e.end)) : null; };
    const L = lossByCause(c);
    const rows = mvs.map(m => ({ m, oee: m.oeeToday ? m.oeeToday.oee : null, free: freeAt(m.id), loss: m.lossEurToday || 0, cause: ((L.byMachine.find(x => x.mv.id === m.id) || { causes: [] }).causes[0] || null) }));
    SLOT(a, 'cmp', rows.map(r => `- **${mName(r.m.id)}**: ${msl(r.m)}${r.m.order ? ' – ' + r.m.order.id + ' AG ' + r.m.order.seq + ', ' + r.m.partsDone + '/' + r.m.partsTotal : ''}; OEE ${pct(r.oee, oeeDec(r.oee))}, Stillstand ${eur(r.loss)}${r.free ? ', frei ab ' + dueTxt(r.free) : ''}`).join('\n'),
      rows.map(r => ({ id: r.m.id, short: r.m.short, pill: WF.ui.machinePill ? WF.ui.machinePill(r.m) : WF.ui.pill(r.m.state), order: r.m.order ? `${r.m.order.id} AG ${r.m.order.seq} · ${nm(r.m.partsDone)}/${nm(r.m.partsTotal)}${r.m.etaOpEnd ? ' · fertig ca. ' + tc(r.m.etaOpEnd) : ''}` : (r.m.queue && r.m.queue[0] ? 'als Nächstes ' + r.m.queue[0].orderId : 'kein Auftrag'), cause: WAIT[r.m.state] || r.m.state === 'fault' ? causeCore(r.m) : '',
        oee: r.oee == null ? '–' : pct(r.oee, oeeDec(r.oee)), oeeC: r.oee == null ? '' : r.oee >= TARGET_OEE ? 'ok' : 'warn', loss: eur(r.loss), free: r.free ? dueTxt(r.free) : 'jetzt' })));
    const worst = bad[0] || rows.filter(r => r.oee != null).sort((x, y) => x.oee - y.oee).map(r => r.m)[0];
    a.md.push('', '> **Empfehlung:** ' + (bad.length ? `${bad[0].id}: ${bad[0].state === 'fault' ? 'Störung zuerst beheben.' : waitAdvice(c, bad[0])}` : worst && worst.oeeToday && worst.oeeToday.oee != null && worst.oeeToday.oee < TARGET_OEE ? `${worst.id} liegt unter dem OEE-Ziel – „Warum hat ${worst.id} nur ${pct(worst.oeeToday.oee)} OEE?“ zeigt die Ursachen.` : (mvs.length === 2 ? 'Beide laufen' : 'Alle laufen') + ' planmäßig – keine Maßnahme nötig.'));
    a.sources = ['Maschinenstatus', 'Kennzahlen heute', 'Plantafel', srcStand()];
    a.followups = mvs.slice(0, 2).map(m => `Was macht ${m.id} gerade?`);
    return done(a);
  }

  // ------------------------------------------------------------------ Hilfe / Rückfall
  function ansHelp() {
    const a = A('help');
    a.md.push('**Der Copilot beantwortet Fragen aus den Live-Daten der Halle**, zum Beispiel:', '');
    a.md.push('- **Lage:** „Wie läuft die Schicht?“, „Was muss ich jetzt tun?“, „Schreib mir die Schichtübergabe“');
    a.md.push('- **Termine:** „Welche Aufträge sind gefährdet und warum?“, „Wo steht FA-24118?“');
    a.md.push('- **Engpass & Was-wäre-wenn:** „Was ist der Engpass?“, „Was passiert, wenn die Studer S33 2 h ausfällt?“');
    a.md.push('- **Maschinen & Werkzeuge:** „Warum wartet M07?“, „Wann ist der nächste Werkzeugwechsel an M05?“');
    a.md.push('- **Ressourcen:** „Welches Material wird knapp?“, „Wer ist gerade wo?“, „Wie steht es um die Qualität?“');
    a.md.push('- **Kosten:** „Wo verlieren wir heute Geld?“, „Wie hoch ist der Energieverbrauch?“, „Was kostet uns der Verzug von FA-24119?“');
    a.md.push('- **Meldungen & Ausbringung:** „Gibt es offene Meldungen?“, „Wie viele Teile haben wir heute gefertigt?“, „Was wird bis Schichtende fertig?“');
    a.md.push('- **Aktionen:** „FA-24122 als Eilauftrag“, „Titan nachbestellen“, „Störung an M05 auslösen“, „Öffne die Plantafel“ – jede Aktion erst nach Bestätigung.');
    a.sources = ['Live-Simulation ' + (WF.app && WF.app.company ? WF.app.company().name : PROF().company.name)];
    a.followups = ['Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?'];
    return done(a);
  }
  /** Rückfall: nie „keine Daten“ für Begriffe aus der Fertigung – stattdessen die nächstliegenden Fragen anbieten */
  const FB_HINT = [
    [/auftrag|auftraeg|termin|liefer|kunde|eil/, ['Welche Aufträge sind gefährdet und warum?', 'Welche Aufträge sind heute fällig?']],
    [/maschine|anlage|arbeitsplatz|laeuft|steht|produzier/, ['Wie läuft die Schicht?', 'Was ist der Engpass?']],
    [/teil|stueck|menge|ausbringung|output/, ['Wie viele Teile haben wir heute gefertigt?', 'Was wird bis Schichtende noch fertig?']],
    [/werkzeug|wechsel|schneide/, ['Welche Werkzeugwechsel stehen in den nächsten 2 h an?']],
    [/material|lager|bestand|stange/, ['Welches Material wird knapp?']],
    [/person|mitarbeit|leute|schicht|team/, ['Wer ist gerade verfügbar?', 'Wer ist gerade wo?']],
    [/kost|geld|euro|verlust|spar/, ['Wo verlieren wir heute Geld?']],
    [/qualitaet|ausschuss|mess|toleranz/, ['Wie ist die Qualität heute?']],
    [/meldung|warnung|hinweis/, ['Gibt es offene Meldungen?']],
    [/energie|strom/, ['Wie hoch ist der Energieverbrauch?']],
  ];
  function ansFallback(c, text) {
    const a = A('fallback'), k = c.k(), q = norm(text);
    const mvs = c.mvs();
    const sug = [];
    for (const [re, l] of FB_HINT) if (re.test(q)) for (const x of l) if (sug.indexOf(x) < 0) sug.push(x);
    a.eyebrow = 'Copilot'; a.sev = 'info';
    a.head = sug.length ? 'Meinten Sie eine dieser Fragen?' : 'Diese Frage kann ich so nicht zuordnen';
    a.md.push(sug.length ? 'Mit einer dieser Formulierungen antworte ich direkt aus den Live-Daten – oder die Frage etwas konkreter stellen (Maschine, Auftrag, Zeitraum).' : 'Ich beantworte Fragen zu Lage, Terminen, Engpass, Maschinen, Aufträgen, Werkzeugen, Material, Personal, Qualität, Kosten, Meldungen, Was-wäre-wenn und Schichtübergabe – immer aus den Live-Daten der Halle.', '');
    const nl = c.open().filter(o => o.risk === 'spät').length, np = mvs.filter(m => m.state === 'running').length;
    a.md.push(`Kurz zur Lage: ${np} von ${mvs.length} Arbeitsplätzen ${np === 1 ? 'produziert' : 'produzieren'}, OEE heute ${pct(oeeHead(k).v, 1)}, ${nl ? pl(nl, 'Auftrag', 'Aufträge') + ' verspätet' : 'kein Auftrag verspätet'}.`);
    a.sources = ['Live-Daten', srcStand()];
    a.followups = (sug.length ? sug : ['Was kannst du?', 'Wie läuft die Schicht?', 'Welche Aufträge sind gefährdet und warum?']).slice(0, 3);
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
      a.eyebrow = 'Aktion · Demo-Störung'; a.sev = 'warn'; a.entity = { kind: 'machine', id: m0 };
      a.head = `Störung an ${mName(m0)} auslösen?`;
      a.md.push(`${mName(m0)} ${stateVerb(mv)}${mv.order ? ' gerade ' + mv.order.id + ' AG ' + mv.order.seq : ''}. Ausgelöst wird ein Alarm aus dem Störungskatalog der ${String(station(m0).control || 'Steuerung').replace(/\s*\(Bj\.[^)]*\)/, '')}; Instandhaltung, Prognose und Termine reagieren live.`);
      const aff = affectedOrders(c, m0).slice(0, 3);
      if (aff.length) a.md.push('', `Betroffen wären: ${aff.map(x => `${x.o.id} (${slackTxt(x.o.slackSec)})`).join(', ')}.`);
      addAction(a, { label: `Störung an ${m0} auslösen`, desc: 'Demo-Aktion · Reparaturdauer laut Störungskatalog', action: { type: 'triggerFault', machineId: m0 }, icon: 'alert', danger: true });
      a.followups = [`Was bedeutet eine Störung an ${m0} für die Termine?`, `Was passiert, wenn ${m0} 2 h ausfällt?`];
    } else if (kind === 'repair') {
      a.eyebrow = 'Aktion · Störung beheben (Demo)';
      const ids = m0 ? [m0] : c.mvs().filter(m => m.fault).map(m => m.id);
      if (!ids.length) { a.md.push('Aktuell hat keine Maschine eine Störung.'); return done(a); }
      for (const id of ids) { const mv = c.mv(id); if (!mv.fault) { a.md.push(`${mName(id)} hat keine Störung.`); continue; } a.md.push(`- ${mName(id)}: ${mv.fault.code} ${mv.fault.text} seit ${clk(mv.fault.t0)}.`); addAction(a, { label: `Störung an ${id} beheben (Demo)`, desc: 'Beendet die simulierte Störung sofort.', action: { type: 'repair', machineId: id }, icon: 'wrench' }); }
    } else if (kind === 'priority') {
      const normal = /normal|zurueck|entfern|aufheb|kein eil/.test(q);
      if (!o0) { return ansRisk(c); }
      const o = c.ov(o0);
      if (o.status === 'fertig') { a.md.push(`${o0} ist bereits fertig.`); return done(a); }
      if (!normal && o.priority === 'eil') { a.head = `${o0} ist bereits Eilauftrag`; a.eyebrow = 'Aktion · Priorität'; a.sev = 'info'; a.md.push(`Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – ${slackTxt(o.slackSec)}.`); a.entity = { kind: 'order', id: o0 }; a.followups = [`Stell ${o0} wieder auf normal`, `Wo steht ${o0} gerade?`]; return done(a); }
      if (normal && o.priority !== 'eil') { a.head = `${o0} hat bereits normale Priorität`; a.eyebrow = 'Aktion · Priorität'; a.sev = 'info'; a.md.push(`Die Maschinen planen ${o0} nach Termin ein (Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – ${slackTxt(o.slackSec)}).`); a.entity = { kind: 'order', id: o0 }; a.followups = [`Wo steht ${o0} gerade?`]; return done(a); }
      a.md.push(normal ? `${o.part.name} (${custShort(o.customer)}), ${o.priority === 'eil' ? 'derzeit Eilauftrag' : 'derzeit schon normal'} – die Maschinen planen ihn dann wieder nach Termin ein (Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)}).` : `${o.part.name} (${custShort(o.customer)}), Prognose ${dueTxt(o.eta)}, Termin ${dueTxt(o.due)} – ${slackTxt(o.slackSec)}. Jede Maschine zieht ihn beim nächsten Auftragswechsel vor; laufende Teile werden nicht unterbrochen.`);
      let eilOk = true;
      if (!normal) { const adv = adviceText(c, o); eilOk = adv.eilOk; a.md.push('', `> **${eilOk ? 'Empfehlung' : 'Hinweis'}:** ${eilOk ? adv.text : adv.eilWhy || adv.text}`); }
      a.head = normal ? `${o0} wieder auf normale Priorität setzen?` : `${o0} als Eilauftrag kennzeichnen?`;
      a.eyebrow = 'Aktion · Priorität'; a.sev = !normal && !eilOk ? 'warn' : 'info';
      addAction(a, { label: normal ? `${o0} normal priorisieren` : eilOk ? `${o0} als Eilauftrag` : `Trotzdem als Eilauftrag`, desc: normal ? 'Priorität normal – Einplanung wieder nach Termin' : 'Priorität Eil – Vorrang beim nächsten Auftragswechsel', action: { type: 'setPriority', orderId: o0, priority: normal ? 'normal' : 'eil' }, icon: 'bolt' });
      a.entity = { kind: 'order', id: o0 };
      a.followups = [`Wo steht ${o0} gerade?`, 'Welche Aufträge sind gefährdet und warum?'];
    } else if (kind === 'reorder') {
      let ids = E.materials.slice();
      if (!ids.length && /alle|alles|mindestbestand|knapp/.test(q)) ids = Object.values(S().materials).filter(mt => mt.onHand + mt.onOrder < mt.min || mt.onHand < mt.min).map(mt => mt.id);
      if (!ids.length) return ansMaterial(c);
      const qty = (() => { const m = /(\d+(?:[.,]\d+)?)\s*(m|stk|stueck|meter)\b/.exec(q); return m ? Number(m[1].replace(',', '.')) : null; })();
      const { need } = materialNeeds();
      // Deckt Bestand + offene Bestellung den Bedarf und den Mindestbestand, ist keine weitere Bestellung nötig
      const rows = ids.map(id => { const mt = S().materials[id], nd = need[id] || 0, after = mt.onHand + (mt.onOrder || 0) - nd; return { mt, nd, after, covered: after >= mt.min && !qty, pur: openPurchases(id) }; });
      a.eyebrow = 'Aktion · Nachbestellung';
      const todo = rows.filter(r => !r.covered);
      a.sev = todo.length ? 'info' : 'ok';
      a.head = rows.length === 1 ? (rows[0].covered ? `${rows[0].mt.name}: bereits bestellt – deckt Bedarf und Mindestbestand` : `Bestellvorschlag: ${rows[0].mt.name}`) : todo.length ? `${pl(todo.length, 'Bestellvorschlag', 'Bestellvorschläge')}${todo.length < rows.length ? ', ' + (rows.length - todo.length) + ' bereits gedeckt' : ''}` : 'Alle genannten Materialien sind bereits gedeckt';
      if (rows.length === 1) a.entity = { kind: 'material', id: rows[0].mt.id };
      for (const r of rows) {
        const mt = r.mt, p0 = r.pur[0];
        if (r.covered) {
          a.md.push(`${rows.length > 1 ? '- **' + mt.name + '**: ' : ''}Bereits bestellt${p0 ? ` (${p0.id}, ${matQty(mt, p0.qty)}, Lieferung ${dueTxt(p0.etaT)})` : ''} – Bestand ${matQty(mt, mt.onHand)} + bestellt ${matQty(mt, mt.onOrder || 0)} − Bedarf ${matQty(mt, r.nd)} = ${matQty(mt, r.after)} ≥ Mindestbestand ${matQty(mt, mt.min)}.`);
          addAction(a, Object.assign(reorderAction(mt, qty), { label: `Trotzdem nachbestellen (${matQty(mt, qty || mt.reorderQty)})`, quiet: true }));
        } else {
          a.md.push(`${rows.length > 1 ? '- ' : ''}**${mt.name}**: Bestand ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}, Bedarf offener Aufträge ca. ${matQty(mt, r.nd)})${mt.onOrder ? ', bereits bestellt ' + matQty(mt, mt.onOrder) + (p0 ? ' (' + p0.id + ', ' + dueTxt(p0.etaT) + ')' : '') : ''} → **${matQty(mt, qty || mt.reorderQty)}** bei ${partnerName(mt.supplier)}, Lieferung ca. **${dueTxt(deliveryT(mt))}** (Lieferzeit ${durR(mt.leadMin * 60)}), ca. ${eur((qty || mt.reorderQty) * mt.pricePerUnit)}.`);
          addAction(a, reorderAction(mt, qty));
        }
      }
      if (!todo.length) a.md.push('', '> **Einschätzung:** Keine Bestellung nötig – die offene Lieferung deckt die Aufträge und hält den Mindestbestand.');
      a.followups = ['Welches Material wird knapp?'];
    } else if (kind === 'move') {
      a.eyebrow = 'Aktion · Verlagerung';
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
      if (lt && lf) a.md.push(`- Belastung: ${mName(cur.station)} ${hTxt(lf.work)} · ${mName(target)} ${hTxt(lt.work)} Arbeitsinhalt.`);
      addAction(a, { label: `AG ${cur.seq} auf ${target} verlagern`, desc: `${o0} · ${cur.op}`, action: { type: 'moveOp', orderId: o0, seq: cur.seq, stationId: target }, icon: 'route' });
      a.entity = { kind: 'order', id: o0 };
      a.followups = [`Wo steht ${o0} gerade?`, `Was macht ${target} gerade?`];
    } else if (kind === 'toolchange') {
      if (!m0) return ansTools(c, q);
      a.eyebrow = 'Aktion · Werkzeugwechsel';
      const mv = c.mv(m0);
      if (!mv.order) { a.md.push(`${mName(m0)} hat keinen eingerichteten Arbeitsgang – kein Werkzeugwechsel möglich.`); return done(a); }
      a.md.push(`**Vorbeugenden Werkzeugwechsel an ${mName(m0)} beauftragen?** Gewechselt werden die Werkzeuge, deren Reststandzeit nicht für den Rest von ${mv.order.id} AG ${mv.order.seq} reicht – an der nächsten Teilegrenze, durch den Einrichter.`);
      const opTools = mv.tools.filter(t => t.status !== 'idle');
      for (const t of opTools) a.md.push(`- ${toolLine(t)}`);
      addAction(a, { label: `Werkzeugwechsel an ${m0} planen`, desc: 'Vorbeugend, an der nächsten Teilegrenze', action: { type: 'planToolChange', machineId: m0 }, icon: 'wrench' });
      a.entity = { kind: 'machine', id: m0 };
      a.followups = [`Wann ist der nächste Werkzeugwechsel an ${m0}?`];
    } else if (kind === 'ack') {
      a.eyebrow = 'Aktion · Quittieren';
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
    const short = q.length < 70;
    const deictic = /\b(dies(e[rsnm]?|es)?|hier|dort|da(fuer|von|mit|bei|rauf)|er|ihn|ihm|dessen|derselbe)\b|\bdas\s+(fuer|bedeutet|heisst)\b|(bedeutet|heisst|kostet|bringt) das\b/.test(q)
      || (short && /^(und|aber|und dann)\b/.test(q)) // Folgefrage: „Und wann ist der fertig?“
      || (short && /\b(der|die|das|den|dem)\s*(denn\s*)?(fertig|dran|los|gerade|jetzt|weiter|zurueck)?\s*$/.test(q));
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
    if (q.length < 40 && has(/^(danke|vielen dank|merci|super|top|perfekt|passt|ok|okay|alles klar|hallo|servus|gruess gott|guten (morgen|tag|abend)|hi)\b/)) return { intent: 'small', E, q };
    // Fremdbearbeitung (auch „Was wäre, wenn die Härterei einen Tag später liefert?“)
    if (has(/haerterei|fremdbearbeit|eloxal|lohnhaert|galvanik|beschichter/) && !E.machines.length) return { intent: 'ext', E, q };
    // Was-wäre-wenn (vor Aktionen: „simuliere einen Ausfall für 2 h“ ist eine Analyse)
    const whatIf = has(/was (passiert|waere|ist|bedeutet)[a-z ,]*\b(wenn|falls)\b|\bwenn\b.*\b(ausfaell|ausfaellt|ausfallen|steht|stehen|stillsteht|kaputt)|\bfalls\b.*\b(ausfaell|ausfaellt|steht)|angenommen|szenario|was waere wenn|\bausfall\b.*\d|\d.*\bausfall\b/);
    if (whatIf && (E.machines.length || has(/ausfaell|ausfall|steht/))) return { intent: 'whatif', E, q };
    // Aktionen (Imperative)
    const imp = has(/^(bitte |kannst du |koenntest du |jetzt )?(loese|loes|simulier|erzeug|bestell|setz|setze|stell|stelle|mach|markier|kennzeichne|priorisier|verlager|plan|beauftrag|quittier|oeffne|zeig|geh|wechsle zu|navigier|repariere|behebe)|bitte\b|\b(ausloesen|simulieren|nachbestellen|bestellen|quittieren|verlagern|priorisieren|oeffnen|beheben|reparieren|beauftragen)\b/);
    if (has(/(stoerung|alarm|fehler|ausfall)\w*.*\b(ausloes|simulier|erzeug|provozier|starte)|\b(ausloes|simulier|erzeug|provozier|starte)\w*.*\b(stoerung|alarm|ausfall)|\bloes\w*\b.*\b(stoerung|alarm)\w*\b.*\baus\b/)) return { intent: 'action', act: 'fault', E, q };
    if (has(/\b(repar|beheb|stoerung (beenden|aufheben|weg))/) && imp) return { intent: 'action', act: 'repair', E, q };
    if (has(/quittier/)) return { intent: 'action', act: 'ack', E, q };
    // offene Meldungen lesen (Glocke) – nicht mit „Störung auslösen“ verwechseln
    if (has(/\bmeldung|benachrichtigung|\bwarnungen\b|\balarme\b|\bglocke\b/) && !E.machines.length && !E.orders.length && !has(/ausloes|simulier|erzeug/)) return { intent: 'notifs', E, q };
    // „Was bringt ein Eilauftrag für FA-…?“ ist eine Frage, keine Aktion
    if (E.orders.length && has(/\beil|prioris|vorzieh/) && has(/was bringt|bringt|bringen|hilft|helfen|lohnt|wuerde|waere|sinnvoll|nuetzt|was passiert|sollte|sollten|ob\b/)) return { intent: 'eilQ', E, q };
    if (has(/\beil(auftrag|ig|-)?\b|als eil|prioris|vorzieh|hoeher prior|dringend machen|normale? prior|(auf|wieder) normal|nicht mehr eil|kein eil/) && (E.orders.length || imp) && !has(/welche|sollte|sollten|wer |was ist|annehmen/)) return { intent: 'action', act: 'priority', E, q };
    if (has(/(nach)?bestell/) && imp && !has(/welche|was muss|muessen wir|sollte/)) return { intent: 'action', act: 'reorder', E, q };
    if (has(/verlager|umplan|auf (eine )?andere maschine/) && imp) return { intent: 'action', act: 'move', E, q };
    if ((has(/(werkzeugwechsel|wechsel)\w*.*\b(planen|beauftrag|vorzieh|vorbeug)|vorbeugend\w* (werkzeug)?wechsel/) && imp) || has(/^(bitte )?(plane|plan|beauftrage)\b.*wechsel/)) return { intent: 'action', act: 'toolchange', E, q };
    if (has(/^(bitte )?(oeffne|zeig mir die|zeige die|geh (zu|zur|in)|wechsle (zu|zur|in)|navigier)/) && (E.views.length || E.machines.length || E.orders.length)) return { intent: 'action', act: 'view', E, q };
    if (E.machines.length && has(/(stunde|std) stillstand|stundensatz|kostet .*stunde|pro stunde|je stunde|stunde .*kostet/)) return { intent: 'rate', E, q };
    // Störung: Alarm, Reparatur, Auswirkung – nie die allgemeine Auftragskarte
    if (has(/stoerung|alarm|defekt|kaputt|reparatur|ausgefallen|stillstand (an|bei|der|des)/) && !has(/welche maschine|stoerungen heute|wie viele stoerung|kost|teuer|\bgeld|euro/)) {
      // genannte Maschine (ansFault leitet auf die gestörte Maschine auf dem Weg des Auftrags um), sonst die gestörte
      const faulted = Object.keys(S().machines).filter(id => S().machines[id].state === 'fault');
      const onRoute = faulted.find(x => E.orders.some(oid => { const o = S().orders[oid]; return o && o.routing.some((r, i) => r.station === x && !o.ops[i].complete); }));
      const mid = E.machines.find(x => S().machines[x]) || onRoute || faulted[0];
      if (mid) return { intent: 'fault', E, q, machine: mid };
    }
    if (has(/was (muss|soll|sollte|sollten) (ich|wir)|was ist (jetzt )?zu tun|was tun\b|wichtigste|prioritaeten|womit (soll ich )?anfangen|wo (soll|muss) ich anfangen|was steht an/) && !E.machines.length && !E.orders.length) return { intent: 'todo', E, q };
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
    // Ausbringung, Schichtende, Versand, Überstunden, Kunden
    if (has(/bis (zum )?schichtende|bis ende der schicht|bis schichtschluss|in dieser schicht noch|noch in (der|dieser) schicht/) && has(/fertig|schaffen|raus|liefern|abgeschlossen/) && !E.orders.length) return { intent: 'shiftEnd', E, q };
    if (has(/wie ?viele?\s*(fertige\s*)?(teile|stueck)|stueckzahl|ausbringung|teile\s*(haben wir\s*)?(heute\s*)?(gefertigt|produziert|hergestellt|geschafft)|(gefertigt|produziert)e?n? teile|output heute/) && !E.orders.length && !E.machines.length) return { intent: 'parts', E, q };
    if (has(/ausgeliefert|ausliefern|versandt|versendet|verschickt|abgeholt|\bversand\b|geliefert/) && !has(/morgen|uebermorgen|faellig|material|lieferant|bestell|haerterei/) && !E.orders.length && !E.materials.length) return { intent: 'ship', E, q };
    if (has(/ueberstunde|zusatzschicht|samstagsschicht|am samstag arbeiten|mehrarbeit|sonderschicht/) && !E.machines.length) return { intent: 'overtime', E, q };
    if (has(/\bkunden?\b/) && has(/meist|welche[rnms]?|wie viele|uebersicht|rangliste|groesst|wichtigst/) && !E.customers.length && !E.orders.length) return { intent: 'customers', E, q };
    // Schicht, Kennzahlen, Rangliste, Fälligkeiten, Kapazität
    if (has(/(spaet|frueh|naechste|kommende)\s*schicht|schichtwechsel|schichtbeginn/) && has(/\bwer\b|wann|wie viele|besetz|personal|kommt|beginnt|faengt|leute|im dienst|\bist\b/)) return { intent: 'shift', E, q };
    if (has(/\bcpk\b|\bcp\b|prozessfaehig|maschinenfaehig|faehigkeit/)) return { intent: 'capability', E, q };
    if (E.machines.length === 1 && has(/\boee\b|verfuegbarkeit|leistungsgrad|nutzungsgrad/) && !has(/schlechtest|best|hoechst|niedrigst|welche maschine/)) return { intent: 'oeeM', E, q };
    if (has(/(schlechtest|best|hoechst|niedrigst|meist|wenigst|groesst|geringst)\w*/) && has(/oee|stillstand|verlust|kost|energie|strom|ausschuss|verbrauch/) && !(E.machines.length && !E.fromContext)) return { intent: 'ranking', E, q };
    if (has(/\boee\b/) && has(/warum|wieso|weshalb|ziel|zusammen|aufschluessel|verfuegbarkeit|leistung|wie hoch|wie ist|wie gut/) && !(E.machines.length && !E.fromContext)) return { intent: 'oee', E, q };
    if (has(/(heute|morgen|uebermorgen)\s*(noch\s*)?(faellig|ausliefern|geliefert|versand|versendet|raus)|faellig\s*(heute|morgen)|geht heute raus|liefern wir heute|heute fertig werden|heute fertig\b/) && !E.orders.length) return { intent: 'due', E, q };
    if (has(/wie ?viele\s*(offene\s*)?auftraege|anzahl\s*(der\s*)?(offenen\s*)?auftraege|auftraege (sind )?(noch )?offen\b|offene auftraege gibt/) && !has(/gefaehrdet|verspaet|knapp/)) return { intent: 'counts', E, q };
    if (has(/annehmen|zusaetzliche[nr]? auftrag|neue[nr]? auftrag|freie kapazitaet|kapazitaet frei|reinschieben|einschieben|dazwischen schieben|noch rein|unterbringen/) && !E.orders.length) return { intent: 'capacity', E, q };
    if (!(E.machines.length && !E.fromContext) && has(/(maschinen|arbeitsplaetze|plaetze|anlagen)\b.*\b(frei|leer|stehen|still|untaetig|nichts zu tun)|warum (stehen|sind so viele)|ohne auftrag|nicht ausgelastet|leerlauf|stehen (so viele|so viel)/)) return { intent: 'idle', E, q };
    // Themen
    if (has(/engpass|flaschenhals|bottleneck|limitier|kapazitaet|auslastung|ausgelastet|arbeitsvorrat/) && !E.orders.length && !(E.machines.length && !E.fromContext)) return { intent: 'bottleneck', E, q };
    if (has(/angebunden|anbindung|vernetzt|\bopc\b|mtconnect|focas|schnittstelle|nachruest|sensorik|datenquelle|digitalisier|\blevel \d/)) return E.machines.length ? { intent: 'connectM', E, q } : { intent: 'connect', E, q };
    if (E.orders.length && !E.fromContext && has(/\bgeld|kost(en|et)|\beuro\b|€|\bteuer|vertragsstraf|poenale|schaden/)) return { intent: 'orderCost', E, q };
    if (has(/\bgeld|kost(en|et)|verlust|verlier|stillstandskost|\beuro\b|€|\bteuer|verschwend|\bsparen|rentab|wirtschaftlich/) && !has(/werkzeugkosten|strom|energie|kwh/)) return E.machines.length ? { intent: 'lossM', E, q } : { intent: 'loss', E, q };
    if (has(/energie|strom|kwh|kilowatt|verbrauch|leistungsaufnahme|\bkw\b/) && !E.materials.length) return { intent: 'energy', E, q };
    if (has(/qualitaet|ausschuss|\bspc\b|fpy|messwert|erstteil|toleranz|n\.?i\.?o|nacharbeit|regelkarte|reklamation/)) return { intent: 'quality', E, q, focusM: E.machines[0] };
    const toolQ = has(/werkzeug|\bwsp\b|wendeplatte|wendeschneid|standzeit|verschleiss|schleifscheibe|waelzfraeser|bohrer|saegeband|bohrkopf|schneide/);
    // mehrere Arbeitsplätze: Vergleich („Vergleich M02 und M03“, „Was macht die Fräse?“)
    if (E.machines.length >= 2 && !toolQ && !E.orders.length && (E.typeWord || has(/vergleich|\bvs\b|versus|gegenueber|unterschied|beide|jeweils|\bund\b/))) return { intent: 'compare', E, q };
    // Rollen („Was macht der Logistiker?“) – vor den Logistik-/Werkzeug-Themen
    if (E.roles.length && !E.machines.length && has(/\bwo\b|was macht|was machen|wer ist|was tut|womit|beschaeftigt/)) return { intent: 'people', E, q };
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
    if (/\bfrei\b|wieder frei|verfuegbar (ab|ist)|wann .*verfuegbar|freie kapazitaet/.test(q)) return 'free';
    if (/termin|auftraeg|bedeutet|auswirkung|folgen|kunde/.test(q)) return 'impact';
    if (/wie steht es|wie stehts|wie geht|wie gehts|wie laeuft|status|zustand|was macht|was ist (mit|los)/.test(q)) return null;
    if (/warum|wieso|weshalb|wartet|steht/.test(q)) return 'why';
    if (/wann|fertig/.test(q)) return 'eta';
    return null;
  }
  /** Offline-Antwort: {kind, text (Markdown), stats, impact, sources, actions, followups, entity} */
  function offlineAnswer(text, context) {
    const c = data();
    const cl = classify(text, context);
    const E = cl.E;
    c.q = cl.q;
    let a;
    try {
      switch (cl.intent) {
        case 'notification': a = ansNotification(c, (S().notifications || []).find(n => n.id === cl.id || n.key === cl.id)); break;
        case 'help': a = ansHelp(); break;
        case 'whatif': {
          const id = E.machines[0];
          if (!id) { a = A('whatif'); a.head = 'Welche Maschine soll ausfallen?'; a.md.push('Zum Beispiel: „Was passiert, wenn die Studer S33 2 h ausfällt?“'); a.followups = ['Was passiert, wenn M09 2 h ausfällt?', 'Was passiert, wenn M07 4 h ausfällt?']; a = done(a); }
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
        case 'people': a = ansPeople(c, E.people, E.roles, cl.q); break;
        case 'notifs': a = ansNotifications(c); break;
        case 'eilQ': a = ansEil(c, E.orders[0]); break;
        case 'orderCost': a = ansOrderCost(c, E.orders[0]); break;
        case 'shiftEnd': a = ansUntilShiftEnd(c); break;
        case 'parts': a = ansParts(c); break;
        case 'ship': a = ansShip(c); break;
        case 'overtime': a = ansOvertime(c, E); break;
        case 'customers': a = ansCustomers(c); break;
        case 'oeeM': a = ansOeeMachine(c, E.machines[0]); break;
        case 'compare': a = ansCompare(c, E.machines, E.typeWord); break;
        case 'order': a = ansOrder(c, E.orders[0], cl.focus); break;
        case 'customer': a = ansCustomer(c, E.customers[0]); break;
        case 'risk': a = ansRisk(c, cl.customer); break;
        case 'machine': {
          const mv0 = c.mv(E.machines[0]);
          // gestörte Maschine: Alarm, Reparatur und Auswirkung zuerst (außer bei Werkzeug-/Personal-/Termin-Fragen)
          a = mv0 && mv0.state === 'fault' && ['tools', 'people', 'eta'].indexOf(cl.focus) < 0 ? ansFault(c, E.machines[0], E.orders) : ansMachine(c, E.machines[0], cl.focus);
          break;
        }
        case 'fault': a = ansFault(c, cl.machine, E.orders); break;
        case 'todo': a = ansTodo(c); break;
        case 'small': a = ansSmall(cl.q); break;
        case 'ext': a = ansExt(c, cl.q, E); break;
        case 'shift': a = ansShift(c, cl.q); break;
        case 'capability': a = ansCapability(c, E.machines[0]); break;
        case 'ranking': a = ansRanking(c, cl.q); break;
        case 'oee': a = ansOee(c); break;
        case 'due': a = ansDue(c, cl.q); break;
        case 'counts': a = ansCounts(c); break;
        case 'capacity': a = ansCapacity(c, cl.q); break;
        case 'idle': a = ansIdle(c); break;
        case 'rate': a = ansRate(c, E.machines[0]); break;
        case 'overview': a = ansOverview(c); break;
        default: a = ansFallback(c, text);
      }
    } catch (e) {
      if (G.console) console.error('[ai] offline', e);
      a = done(Object.assign(A('error'), { head: 'Auswertung nicht möglich', sev: 'warn', md: ['Bei der Auswertung ist ein Fehler aufgetreten: ' + (e && e.message ? e.message : e)] }));
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
      const w = whyShort(c, o);
      B.push({ cat: 'termine', sev: 'warn', entity: ent('order', o.id), text: `Termin: ${o.id} (${custShort(o.customer)}) ${durR(-o.slackSec)} zu spät – Prognose ${dueTxt(o.eta)}${etaTag(o)}, Termin ${dueTxt(o.due)}${w ? '; Ursache: ' + w : ''}${late.length > 1 ? `; außerdem verspätet: ${late.slice(1, 3).map(x => x.id).join(', ')}` : ''}${tight.length ? `; knapp: ${tight.slice(0, 2).map(x => x.id + ' (' + durR(x.slackSec) + ')').join(', ')}` : ''}.` });
    } else if (tight.length) {
      const o = tight[0];
      B.push({ cat: 'termine', sev: 'info', entity: ent('order', o.id), text: `Termine halten; am knappsten ${o.id} (${custShort(o.customer)}) mit ${slackTxt(o.slackSec)} bis ${dueTxt(o.due)}${tight.length > 1 ? `, außerdem knapp: ${tight.slice(1, 3).map(x => x.id).join(', ')}` : ''}.` });
    } else {
      const nx = open.slice().sort((x, y) => x.eta - y.eta)[0];
      B.push({ cat: 'termine', sev: 'ok', entity: nx ? ent('order', nx.id) : null, text: `Alle ${open.length} offenen Aufträge im Plan${nx ? `; als Nächstes fertig: ${nx.id} ${nx.part.name} ca. ${tc(nx.eta)}` : ''}.` });
    }
    // Engpass / Wartezustände
    if (waits.length) {
      const m = waits[0];
      B.push({ cat: 'engpass', sev: 'warn', entity: ent('machine', m.id), text: `${mName(m.id)} ${lc1(msl(m))} seit ${durR(m.sinceSec)}: ${m.cause}${waits.length > 1 ? ` (auch ${waits.slice(1, 3).map(x => x.id).join(', ')})` : ''}.` });
    } else {
      const ab = ansBottleneck(c), top = ab.entity && ab.entity.kind === 'machine' ? ab.entity.id : null;
      if (top) {
        const bn = open.filter(o => bnMachine(o) === top && o.risk !== 'ok');
        const row = loadRows(c).find(x => x.id === top);
        B.push({ cat: 'engpass', sev: bn.some(o => o.risk === 'spät') ? 'warn' : 'info', entity: ent('machine', top), text: `Engpass ${mName(top)}: ${row ? hTxt(row.work) + ' Arbeitsvorrat (' + daysOf(row) + ')' : 'größter Arbeitsvorrat'}${bn.length ? ` – begrenzt ${bn.slice(0, 3).map(o => o.id).join(', ')}` : ''}.` });
      }
    }
    // Werkzeugwechsel nächste 2 h
    const ch = plannedChanges(c, t + 2 * 3600);
    if (ch.length) {
      const txt = ch.slice(0, 3).map(g => `${clk(g.t)} ${g.machine} ${g.index ? 'Schneide wenden ' : ''}${toolShort(g.tools[0].name)}${g.tools.length > 1 ? ' +' + (g.tools.length - 1) : ''}${g.index ? ' (Bediener:in)' : g.by ? ' (' + sn(g.by) + ')' : sh.id && g.stage !== 'später' ? ' (noch niemand zugeteilt)' : ''}`).join('; ');
      const waitAt = ch.find(g => g.waitFromT), open1 = sh.id && ch.find(g => !g.index && !g.by && g.stage !== 'später' && g.t - t <= 3600);
      B.push({ cat: 'werkzeug', sev: waitAt || open1 ? 'warn' : 'tool', entity: ent('machine', (open1 || ch[0]).machine), text: `Werkzeugwechsel bis ${clk(t + 7200)}: ${txt}${ch.length > 3 ? ` (+${ch.length - 3})` : ''}${waitAt ? ` – ${waitAt.machine} wartet ab ${clk(waitAt.waitFromT)} auf ${waitAt.index ? 'die Bediener:in' : 'den Einrichter'}` : ''}.` });
    } else {
      const due = mvs.filter(m => m.state === 'waitTool');
      B.push({ cat: 'werkzeug', sev: due.length ? 'warn' : 'ok', entity: due.length ? ent('machine', due[0].id) : null, text: due.length ? `${mName(due[0].id)} wartet auf Werkzeug: ${due[0].cause}.` : `Kein Werkzeugwechsel in den nächsten 2 Stunden – Standzeiten reichen.` });
    }
    // Material
    const low = Object.values(S().materials).filter(mt => mt.onHand < mt.min).sort((x, y) => x.onHand / x.min - y.onHand / y.min);
    const starved = mvs.filter(m => m.state === 'starved' && /material|rohteil|stange/i.test(m.cause));
    if (low.length) {
      const mt = low[0];
      const p0 = openPurchases(mt.id)[0];
      B.push({ cat: 'material', sev: mt.onOrder ? 'info' : 'warn', entity: ent('material', mt.id), text: `Material ${mt.name.replace(/\s+Zuschnitt\b/, '')}: ${matQty(mt, mt.onHand)} (Min. ${matQty(mt, mt.min)}) – ${mt.onOrder ? matQty(mt, mt.onOrder) + ' bestellt' + (p0 ? ', Lieferung ' + dueTxt(p0.etaT) : '') : 'nicht bestellt – Vorschlag ' + matQty(mt, mt.reorderQty) + ' bei ' + mt.supplier.replace(' (Beispiel)', '')}${low.length > 1 ? ` (auch ${low.slice(1).map(x => x.name).join(', ')})` : ''}.` });
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
      else if (!(k.good + k.scrap > 0)) B.push({ cat: 'qualitaet', sev: 'ok', entity: null, text: 'Qualität: heute noch keine Teile gefertigt – keine SPC-Warnung offen.' });
      else B.push({ cat: 'qualitaet', sev: k.scrap > 0 && k.fpy < 0.97 ? 'warn' : 'ok', entity: null, text: `Qualität: keine Störung, FPY ${pct(k.fpy, 1)} bei ${nm(k.scrap)} Ausschuss${k.scrap ? ' (' + Object.keys(k.scrapBy || {}).filter(x => k.scrapBy[x]).map(x => x + ' ' + k.scrapBy[x]).join(', ') + ')' : ''}, keine SPC-Warnung.` });
    }
    const RANK = { crit: 0, warn: 1, tool: 2, info: 3, ok: 4 };
    const CAT = ['stoerung', 'termine', 'engpass', 'werkzeug', 'material', 'qualitaet'];
    B.sort((x, y) => RANK[x.sev] - RANK[y.sev] || CAT.indexOf(x.cat) - CAT.indexOf(y.cat));
    const ohB = oeeHead(k);
    const oeeTxt = ohB.v != null ? `OEE${ohB.staffed ? ' der Schichten' : ''} ${pct(ohB.v, 1)} ${ohB.v >= TARGET_OEE ? 'über' : 'unter'} Ziel ${pct(TARGET_OEE)}` : 'noch keine OEE-Bezugszeit';
    const head = `${sh.id ? sh.name : 'Geisterschicht'}: ${prod} von ${mvs.length} Arbeitsplätzen produzieren, ${oeeTxt}` +
      (faults.length ? `, ${pl(faults.length, 'Störung', 'Störungen')}` : '') + (late.length ? `, ${pl(late.length, 'Termin', 'Termine')} verspätet` : tight.length ? `, ${nm(tight.length)} knapp` : ', Termine im Plan') + '.';
    const bullets = B.slice(0, 5).map(b => ({ sev: b.sev, text: b.text, entity: b.entity || undefined, category: b.cat }));
    // Jetzt tun: die zwei wichtigsten Eingriffe (Handlung zuerst, mit Bezug und – wo möglich – Aktion)
    const todo = sh.id || !morningPlan(c) ? todoList(c).slice(0, 2) : [];
    if (todo.length) bullets.push({ sev: todo[0].sev === 'crit' ? 'crit' : 'warn', category: 'todo', text: 'Jetzt tun: ' + todo.map(x => x.short || x.text).join(' '), entity: todo[0].entity ? ent(todo[0].entity.kind, todo[0].entity.id) : undefined,
      actions: todo.flatMap(x => x.actions || []).slice(0, 2).map(x => ({ label: x.label, action: x.action })) });
    else if (!sh.id && morningPlan(c)) bullets.push({ sev: 'info', category: 'todo', text: 'Jetzt tun: ' + morningPlan(c) });
    return { headline: head, bullets, todo: todo.map(x => ({ text: x.text, short: x.short, entity: x.entity, actions: (x.actions || []).map(y => ({ label: y.label, action: y.action })) })), generatedT: t, mode: 'regelbasiert' };
  }

  // ================================================================== Live-Modus (Claude über `sample`)
  const live = { status: 'verbinde', reason: 'Verbindung zu Claude wird geprüft …', sample: null, tools: false, promise: null, maxTools: 0 };
  function getSample() {
    if (live.promise) return live.promise;
    const cl = G.claude;
    if (!cl || typeof cl.use !== 'function') {
      live.status = 'offline'; live.failed = false; live.reason = 'Regelbasierter Copilot: beantwortet die Fragen direkt aus den Live-Daten dieser Fertigung – dieselben Zahlen wie in den Ansichten.';
      live.promise = Promise.resolve(null);
      emitStatus();
      return live.promise;
    }
    live.promise = Promise.resolve().then(() => cl.use('sample')).then(async (fn) => {
      if (!fn) { live.status = 'offline'; live.failed = false; live.reason = 'Claude ist in dieser Ansicht nicht freigeschaltet – der regelbasierte Copilot antwortet direkt aus den Live-Daten.'; emitStatus(); return null; }
      live.sample = fn;
      try { const lim = await fn.limits(); live.tools = !!(lim && lim.tools); live.maxTools = lim && lim.tools ? lim.tools.maxCount : 0; } catch (e) { live.tools = false; }
      live.status = 'live';
      live.reason = live.tools ? 'Claude antwortet aus den Live-Daten, liest Details über Datenabfragen und führt Aktionen nur nach Bestätigung aus.' : 'Claude antwortet aus der Lageübersicht (ohne Datenabfragen in dieser Ansicht).';
      emitStatus();
      return fn;
    }, () => { live.status = 'offline'; live.failed = true; live.reason = 'Verbindung zu Claude fehlgeschlagen – Antworten kommen lokal aus den Live-Daten.'; emitStatus(); return null; });
    return live.promise;
  }
  function goOffline(reason, failed) { live.status = 'offline'; live.failed = !!failed; live.reason = reason; live.sample = null; live.promise = Promise.resolve(null); emitStatus(); }
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
      zustand: msl(mv), seit: tc(mv.since), ursache: mv.cause, phase: mv.phase,
      auftrag: mv.order ? { id: mv.order.id, kunde: custShort(mv.order.customer), teil: mv.order.partName, ag: mv.order.seq, op: mv.order.op, taktMin: mv.order.cycleMin, termin: U.fmtDayClock(mv.order.due), prio: mv.order.priority } : null,
      teile: mv.order ? mv.partsDone + '/' + mv.partsTotal : null, laufendesTeil: mv.partNo, restTeilMin: minOf(mv.partRemainSec), agFertig: mv.etaOpEnd ? U.fmtDayClock(mv.etaOpEnd) : null,
      werkzeuge: (mv.tools || []).filter(t => t.status !== 'idle').map(t => ({ name: t.name, status: label('toolStatus', t.status), verschleissPct: t.wearPct, restTeile: t.remainingParts, schneide: t.edgeText || undefined,
        wechsel: t.plannedChange ? { wann: t.plannedChange.text, aktion: t.plannedChange.action === 'index' ? 'Schneide wenden (Bediener:in an der Maschine, 1–2 min, kein Einrichter)' : 'Werkzeug tauschen (Einrichter:in)', durch: t.plannedChange.by || (t.plannedChange.action === 'index' ? 'Bediener:in' : null), stufe: t.plannedChange.stage || null } : null,
        naechsteAktion: t.nextAction ? label('toolAction', t.nextAction) : undefined, regel: trimTxt(t.explain, 160) })),
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
      versandt: o.shippedQty, fortschrittPct: Math.round(o.progress * 100), prognose: o.eta ? U.fmtDayClock(o.eta) : null, pufferMin: minOf(o.slackSec), risiko: o.riskLabel, begrenztDurch: o.bottleneck, verzugUrsache: o.delayCause || undefined,
      arbeitsgaenge: o.ops.map((op, i) => { const fe = ((WF.sim.forecast().orders[o.id] || {}).ops || [])[i]; return { ag: op.seq, op: op.op, platz: op.station, status: op.stateLabel, gut: op.good, ausschuss: op.scrap, soll: op.target, wartend: op.waiting, ursache: op.cause ? trimTxt(op.cause, 90) : undefined, plan: op.complete ? null : fe ? 'Start ' + tc(Math.max(NOW(), fe.start)) + ', fertig ' + tc(Math.max(NOW(), fe.lastReturn != null ? fe.lastReturn : fe.end)) : null, extern: op.ext ? op.ext.returnText : undefined }; }),
      behaelter: o.containers.filter(x => x.state !== 'shipped').slice(0, 6).map(x => x.qty + ' Stk ' + x.where),
    };
  }
  const TOOLS = [
    { name: 'get_overview', label: () => 'Liest Lageübersicht', description: 'Aktuelle Lageübersicht der Halle: Kennzahlen, alle Arbeitsplätze (Zustand, Ursache, Auftrag, Werkzeug), offene Aufträge mit Prognose und Risiko, Meldungen, knappes Material, Personal. Nach Aktionen erneut lesen.',
      run: () => { const s = WF.sim.snapshot(); return fit({ zeit: s.clock, schicht: s.shift, kpi: s.kpi, maschinen: s.machines, auftraege: s.orders, meldungen: s.alerts, materialKnapp: s.materialsLow, personal: s.people.map(p => p.name + ' (' + p.role + '): ' + p.act).slice(0, 14) }); } },
    { name: 'get_machine', label: (i) => 'Liest Maschinenstatus ' + (i.id || ''), description: 'Details eines Arbeitsplatzes (id z. B. "M05", "QS", "M13"): Zustand mit Ursache, Auftrag, Teilefortschritt, Werkzeuge mit Verschleiß und geplantem Wechsel, Personen, Puffer, Warteschlange, Tageswerte.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Maschinen-ID, z. B. M05' } }, required: ['id'] },
      run: (i) => { const id = normMachineId(i.id); const mv = id && WF.sim.machineView(id); if (!mv) throw new Error('Unbekannte Maschine: ' + i.id + ' (gültig: ' + PROF().machines.join(', ') + ')'); return fit(trimMachine(mv)); } },
    { name: 'get_order', label: (i) => 'Liest Auftrag ' + (i.id || ''), description: 'Details eines Fertigungsauftrags (id z. B. "FA-24118"): Prognose, Puffer, Risiko, Ursache und begrenzender Arbeitsgang, Arbeitsgang-Kette mit Status und Plan, Behälterorte.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Auftrags-ID, z. B. FA-24118' } }, required: ['id'] },
      run: (i) => { const id = String(i.id || '').toUpperCase().replace(/^FA(\d)/, 'FA-$1').replace(/^(\d{5})$/, 'FA-$1'); const o = WF.sim.orderView(id); if (!o) throw new Error('Unbekannter Auftrag: ' + i.id);
        const r = trimOrder(o);
        // Vorab-Abwägung der Regel-Engine (hilft ein Eilauftrag? wer würde überholt? Alternativen) – Claude prüft und nutzt sie
        if (o.status !== 'fertig' && o.risk !== 'ok') {
          try { const c = data(), adv = adviceText(c, o), dc = adv.causes, ew = engineWhy(c, o); if (ew) r.ursache = ew.cause; r.ursachen = dc ? dc.items.map(x => x.text) : []; r.regelEinschaetzung = trimTxt(adv.text.replace(/\*\*/g, ''), 600); r.eilauftragEmpfohlen = adv.eilOk; } catch (e) { /* ohne Einschätzung */ }
        }
        return fit(r); } },
    { name: 'get_forecast', label: () => 'Liest Prognose und Plantafel', description: 'Prognose: je offenem Auftrag Liefertermin-Prognose, Puffer (min) und begrenzender Arbeitsgang; je Maschine die nächsten eingeplanten Arbeitsgänge (Start–Ende).',
      run: () => { const f = WF.sim.forecast(), o = {}, m = {}; for (const id in f.orders) { const x = f.orders[id]; if (x.done) continue; o[id] = { prognose: U.fmtDayClock(x.eta), pufferMin: minOf(x.slackSec), spaet: x.late, begrenztDurch: x.bottleneck }; } for (const id in f.machines) m[id] = f.machines[id].slice(0, 4).map(e => e.orderId + ' AG' + e.seq + ' ' + tc(e.start) + '–' + tc(e.end)); return fit({ auftraege: o, plantafel: m }); } },
    { name: 'get_notifications', label: () => 'Liest Meldungen', description: 'Offene und quittierte Benachrichtigungen (neueste zuerst) mit Titel, Text, Empfehlung, Rolle und möglichen Aktionen.',
      run: () => fit((S().notifications || []).filter(n => n.status !== 'resolved').slice(0, 14).map(n => ({ id: n.id, schwere: n.sev, status: n.status, rolle: n.role, zeit: tc(n.t), titel: n.title, text: trimTxt(n.body, 200), empfehlung: trimTxt(n.suggestion, 200), aktionen: (n.actions || []).filter(x => x.action.type !== 'select').map(x => x.label) }))) },
    { name: 'get_materials', label: () => 'Liest Materialbestände', description: 'Rohmaterial: Bestand, Mindestbestand, bestellt, Bedarf der offenen Aufträge, Lieferant und Lieferzeit; offene Bestellungen.',
      run: () => { const { need } = materialNeeds(); return fit({ material: Object.values(S().materials).map(mt => ({ id: mt.id, name: mt.name, bestand: r1(mt.onHand), min: mt.min, einheit: mt.unit, bestellt: r1(mt.onOrder), bedarfOffen: r1(need[mt.id] || 0), lieferant: mt.supplier, lieferzeitH: r1(mt.leadMin / 60), bestellmenge: mt.reorderQty })), bestellungen: openPurchases().map(p => ({ id: p.id, material: p.materialId, menge: p.qty, lieferung: U.fmtDayClock(p.etaT) })) }); } },
    { name: 'get_people', label: () => 'Liest Personaleinsatz', description: 'Personal im Dienst: Name, Rolle, Zustand, Tätigkeit, Ort, Auslastung heute; dazu die nächste Schicht.',
      run: () => { const on = Object.values(S().people).filter(p => p.state !== 'offShift'), cc = crewCounts(on);
        return fit({ hinweis: 'Einteilung wie die Personalansicht: im Einsatz = mit Aufgabe, betreut eigene laufende Maschinen oder Schichtleitung; verfügbar = nur ohne Aufgabe und ohne laufende eigene Maschine', zusammenfassung: cc.txt, imEinsatz: cc.einsatz, verfuegbar: cc.free.map(p => p.name),
          imDienst: on.map(p => ({ id: p.id, name: p.name, rolle: p.role, anzeige: pDisp(p).label, taetigkeit: trimTxt(p.activity, 80), ort: personWhere(p), auslastungPct: Math.round((p.utilToday || 0) * 100) })), schicht: WF.sim.shift().name }); } },
    { name: 'get_tools', label: (i) => 'Liest Werkzeugdaten' + (i.machineId ? ' ' + i.machineId : ''), description: 'Werkzeuge im Einsatz mit Verschleiß %, Rest-Teilen, Status und geplantem Wechsel (Uhrzeit, Einrichter). Optional machineId für eine Maschine; ohne: alle geplanten Wechsel.',
      inputSchema: { type: 'object', properties: { machineId: { type: 'string', description: 'optional, z. B. M05' } } },
      run: (i) => {
        const c = data(), id = normMachineId(i.machineId);
        const act = (g) => (g.index ? 'Schneide wenden (Bediener:in, 1–2 min, kein Einrichter)' : 'Werkzeug tauschen (Einrichter:in)');
        if (id) { const mv = c.mv(id); if (!mv) throw new Error('Unbekannte Maschine: ' + i.machineId + ' (gültig: ' + PROF().machines.join(', ') + ')');
          return fit({ maschine: id, werkzeuge: mv.tools.map(t => ({ name: t.name, status: label('toolStatus', t.status), verschleissPct: t.wearPct, restTeile: t.remainingParts, schneide: t.edgeText || undefined, wechsel: t.plannedChange ? t.plannedChange.text : null, aktion: t.plannedChange ? (t.plannedChange.action === 'index' ? 'Schneide wenden (Bediener:in)' : 'Werkzeug tauschen (Einrichter:in)') : null, durch: t.plannedChange ? t.plannedChange.by : null, stufe: t.plannedChange ? t.plannedChange.stage : null, regel: trimTxt(t.explain, 180) })),
            plan: toolPlan(c, c.t + 6 * 3600, { machine: id }).map(g => ({ zeit: tc(g.t), art: g.kind === 'plan' ? 'angekündigt' : 'voraussichtlich', aktion: act(g), werkzeuge: g.tools.map(x => x.name), nachTeil: g.afterPart, durch: g.by || null, stufe: g.stage || null })) }); }
        const tp = toolPlan(c, c.t + 12 * 3600), sm = toolSummary();
        return fit({ hinweis: 'gleiche Zeiten wie die Werkzeuge-Ansicht: angekündigt = Engine-Plan, voraussichtlich = Hochrechnung aus Reststandzeit', kennzahl2h: sm ? { geplanteWerkzeuge: sm.planned2h, voraussichtlich: sm.projected2h } : undefined,
          wechsel: tp.map(g => ({ zeit: tc(g.t), maschine: g.machine, art: g.kind === 'plan' ? 'angekündigt' : 'voraussichtlich', aktion: act(g), werkzeuge: g.tools.map(x => x.name), nachTeil: g.afterPart, durch: g.by || null, stufe: g.stage || null })), werkzeugkostenHeute: c.k().toolCostToday, wechselHeute: c.k().toolChangesToday });
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
    { name: 'select_entity', label: (i) => 'Öffnet ' + (i.id || ''), description: 'Öffnet das Detail einer Entität rechts (kind: machine|order|person|agv|tool|material|container, id). Nur IDs aus der Lageübersicht oder aus Datenabfragen verwenden.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['machine', 'order', 'person', 'agv', 'tool', 'material', 'container'] }, id: { type: 'string' } }, required: ['kind', 'id'] },
      run: (i, ctx) => {
        const r = resolveEntity(i.kind, i.id);
        if (!r) throw new Error('Unbekannt: ' + i.kind + ' ' + i.id + ' – nur IDs aus der Lageübersicht oder den Datenabfragen verwenden.');
        // Während Claude antwortet, den Copilot nicht schließen: ohne Platz neben dem Drawer als Link in der Antwort anbieten
        if (ctx && ctx.m && !roomBeside()) { offerEntity(ctx.m, r.kind, r.id); return { ok: true, angeboten: true, hinweis: 'Als Link „' + r.id + ' öffnen“ unter der Antwort angeboten – der Nutzer öffnet es selbst.' }; }
        if (WF.app) UI.openEntity(r.kind, r.id);
        return { ok: true, geoeffnet: r.id };
      } },
  ];
  /** Tools nach Wichtigkeit – reicht das Kontingent (maxCount) nicht, fallen zuerst die seltenen weg */
  const TOOL_PRIO = ['get_overview', 'get_order', 'get_machine', 'get_forecast', 'set_priority', 'reorder_material', 'get_tools', 'get_materials', 'get_people', 'get_notifications', 'trigger_fault', 'move_operation', 'plan_tool_change', 'ack_notification', 'open_view', 'select_entity'];
  const toolList = () => TOOLS.slice().sort((x, y) => TOOL_PRIO.indexOf(x.name) - TOOL_PRIO.indexOf(y.name)).slice(0, live.maxTools || TOOLS.length);
  /** Entität prüfen und normieren (select_entity) – null, wenn es sie nicht gibt */
  function resolveEntity(kind, id) {
    const k = String(kind || '').toLowerCase().trim(), raw = String(id || '').trim(), st = S();
    if (k === 'machine') { const m = normMachineId(raw); return m && st.machines[m] ? { kind: 'machine', id: m } : null; }
    if (k === 'order') { const o = raw.toUpperCase().replace(/^FA(\d)/, 'FA-$1').replace(/^(\d{5})$/, 'FA-$1'); return st.orders[o] ? { kind: 'order', id: o } : null; }
    if (k === 'person') { const p = raw.toUpperCase(); if (st.people[p]) return { kind: 'person', id: p }; const f = Object.values(st.people).find(x => norm(x.name) === norm(raw)); return f ? { kind: 'person', id: f.id } : null; }
    if (k === 'agv') { const v = raw.toUpperCase().replace(/\s+/g, ''); return st.agvs[v] ? { kind: 'agv', id: v } : null; }
    if (k === 'material') { const mt = raw.toUpperCase(); return st.materials[mt] ? { kind: 'material', id: mt } : null; }
    if (k === 'container') { const cn = raw.toUpperCase(); return st.containers[cn] ? { kind: 'container', id: cn } : null; }
    if (k === 'tool') { const tl = raw.toUpperCase(); return st.tools[tl] || (PROF().toolTypeById && PROF().toolTypeById[raw]) ? { kind: 'tool', id: st.tools[tl] ? tl : raw } : null; }
    return null;
  }
  function normMachineId(x) {
    if (!x) return null;
    const s = String(x).trim().toUpperCase();
    if (S().machines[s]) return s;
    const m = /^M\s?-?(\d{1,2})$/.exec(s); if (m && S().machines['M' + m[1].padStart(2, '0')]) return 'M' + m[1].padStart(2, '0');
    const E = entities(String(x)); return E.machines[0] || null;
  }
  const ACT_LABEL = { trigger_fault: 'Störung auslösen (Demo)', set_priority: 'Priorität', reorder_material: 'Nachbestellung', move_operation: 'Verlagerung', plan_tool_change: 'Werkzeugwechsel planen', ack_notification: 'Quittieren' };
  function instructions(ctx, tools) {
    const P = PROF(), co = WF.app && WF.app.company ? WF.app.company() : { name: P.company.name, site: P.company.site };
    const view = WF.app && WF.app.current ? WF.app.current.title : 'Leitstand';
    const ent = ctx && ctx.kind && ctx.id && ctx.kind !== 'view' ? (WF.app ? WF.app.entityLabel({ kind: ctx.kind === 'notification' && ctx.entity ? ctx.entity.kind : ctx.kind, id: ctx.kind === 'notification' && ctx.entity ? ctx.entity.id : ctx.id }) : ctx.id) : null;
    const machines = P.machines.map(id => { const s = station(id); return `${id} ${s.short} (${s.name}, ${label('loading', s.loading)}, ${s.rate} €/h)`; }).join('; ');
    const snap = WF.sim.snapshot();
    // ein Firmenname in Anweisung und Lageübersicht (Einstellungen können ihn für Vorführungen ändern)
    snap.company = co.name; if (co.site) snap.site = co.site;
    return [
      `Du bist der werkfluss Copilot – der KI-Assistent im MES „werkfluss“ bei ${co.name} (${co.site}). ${P.company.description} ${P.company.employees} Mitarbeitende, 2 AGVs, Frühschicht 06:00–14:00, Spätschicht 14:00–22:00 (Pausen 09:00, 12:00, 17:00, 19:30); danach laufen autonome Maschinen unbemannt weiter (Geisterschicht). Alle Daten stammen aus einer Live-Simulation der Fertigung; behandle sie wie echte Betriebsdaten.`,
      `Arbeitsplätze: ${machines}. Fremdbearbeitung (externe Partner): ${extPartners().join(', ') || 'keine'}.`,
      '- Werkzeuge: Wendeschneidplatten mit freier Schneide werden von der Bediener:in an der Maschine gewendet („Schneide wenden“, 1–2 min, kein Einrichter); erst nach der letzten Schneide tauscht die Einrichter:in das Werkzeug. get_tools/get_machine nennen je Wechsel die Aktion.',
      '- Personal: „verfügbar“ ist nur, wer weder eine Aufgabe hat noch eigene laufende Maschinen betreut (wie die Personalansicht, siehe get_people).',
      `Nutzer: Produktions- bzw. Schichtleitung. Geöffnete Ansicht: ${view}${ent ? '; Bezug der Frage: ' + ent : ''}. Jetzt: ${WF.sim.clock()}, ${WF.sim.shift().name}.`,
      'Regeln:',
      '- Antworte auf Deutsch, sachlich und knapp (meist 4–10 Zeilen), neutrale Formulierungen ohne Du/Sie, keine Emojis.',
      '- Nenne konkrete IDs und Zahlen (FA-24118, M05, P06, Uhrzeiten, Teile, €) ausschließlich aus der Lageübersicht unten oder aus den Ergebnissen deiner Datenabfragen (Tools). Erfinde nichts; fehlt etwas, sag es und frag es über ein Tool ab. „Werkzeug“ bedeutet in dieser Fabrik immer Schneidwerkzeug.',
      '- Aufbau: erste Zeile = Kernaussage fett (**…**, höchstens ca. 12 Wörter), danach 2–6 Zeilen Begründung mit Zahlen, zum Schluss eine eigene Zeile „> **Empfehlung:** …“ (Handlung zuerst, ID vorn).',
      '- Erkläre Ursachen (Zustand → Ursache → Auswirkung auf Termin/Kosten) und schließe mit einer konkreten Empfehlung als eigener Zeile „> **Empfehlung:** …“.',
      '- Formatierung: **fett** für Kernaussagen, Listen mit „- “, höchstens Überschriften „### “. Keine Tabellen.',
      '- Grafiken: Eine eigene Zeile [[route FA-24118]] zeigt die Arbeitsgang-Kette eines Auftrags, [[werkzeuge M05]] die Werkzeug-Standzeiten, [[maschine M05]] die Kennzahlen einer Maschine, [[termine]] Prognose gegen Termin der gefährdeten Aufträge, [[risiko]] die Risiko-Karten, [[engpass]] den Arbeitsinhalt je Arbeitsplatz, [[verluste]] die Stillstandskosten je Arbeitsplatz, [[ursachen]] die Stillstandskosten je Ursache, [[material]] die Bestände, [[personal]] das Personal im Dienst. Höchstens zwei pro Antwort und nur, wenn sie die Aussage stützen; die gezeigten Zahlen dann nicht noch einmal als Liste wiederholen.',
      '- Eilauftrag nur empfehlen, wenn er wirklich Zeit gewinnt: er wirkt erst beim nächsten Auftragswechsel und nur, wenn die Teile schon da sind; überholte Aufträge rutschen um die Belegzeit nach hinten. Das Feld regelEinschaetzung in get_order enthält diese Abwägung bereits.',
      (() => { const acts = (tools || []).filter(t => t.act).map(t => ACT_LABEL[t.name] || t.name); return acts.length ? `- Aktionen (${acts.join(', ')}) nur auf ausdrücklichen Wunsch; der Nutzer bestätigt jede Aktion im Panel. Abgelehnt = nicht erneut versuchen. Nach einer Aktion das Ergebnis kurz berichten.` : '- Aktionen kannst du in dieser Ansicht nicht ausführen – nenne die passende Aktion als Empfehlung; der Nutzer führt sie in der Oberfläche aus.'; })(),
      '- Fachbegriffe: Zustände Produktion, Rüsten, Erstteilprüfung, Werkzeugwechsel, Wartet auf Werkzeug/Bediener/Material, Ausgang voll, Störung, Bereit. Werkzeuge werden nur zwischen zwei Teilen gewechselt, angekündigt mit Uhrzeit und Einrichter. Prognose = Plantafel; „Engpass“ heißt nur der Werks-Engpass (bottleneck), der begrenzende Schritt eines Auftrags heißt „begrenzt durch …“; Ursache eines Verzugs = Engine-Ursache (orderAdvice, wie in der Meldung „Termin gefährdet“); Stillstandskosten = Maschinenstundensatz × Zeit mit eingeplantem Auftrag ohne Produktion (Schichtzeit).',
      tools && tools.length ? `- Für Details die Tools nutzen (${tools.filter(t => !t.act).map(t => t.name).join(', ')}).` : '- In dieser Ansicht gibt es keine Tools: antworte nur aus der Lageübersicht und sag, wenn Details fehlen.',
      '',
      `Lageübersicht (JSON, Stand ${snap.clock}):`,
      JSON.stringify(snap),
    ].join('\n');
  }
  /** Externe Partner aus dem Profil (Aufträge und Vorlagen) – ohne „(Beispiel)“ */
  function extPartners() {
    const set = new Set(), P = PROF();
    const scan = (r) => { for (const x of r || []) if (x && x.ext && x.ext.partner) set.add(partnerName(x.ext.partner) + (x.ext.process ? ' (' + String(x.ext.process).replace(/\s+\d.*$/, '') + ')' : '')); };
    for (const o of P.orders || []) scan(o.routing);
    for (const t of P.orderTemplates || []) scan(t.routing);
    for (const id in (S() || {}).orders || {}) scan(S().orders[id].routing);
    // je Partner nur ein Eintrag mit allen Verfahren
    const by = {};
    for (const x of set) { const m = /^(.*?)(?: \((.*)\))?$/.exec(x); (by[m[1]] = by[m[1]] || new Set()); if (m[2]) by[m[1]].add(m[2]); }
    return Object.keys(by).map(k => k + (by[k].size ? ' – ' + [...by[k]].join(', ') : ''));
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
  const PERMANENT = { not_granted: 'Claude wurde für diese Seite nicht freigegeben', sampling_disabled: 'Claude ist für dieses Konto nicht verfügbar', not_declared: 'Die Seite hat keinen Claude-Zugang', capability_disabled: 'Claude ist in dieser Ansicht deaktiviert', capability_removed: 'Diese Claude-Funktion ist hier nicht verfügbar' };
  // Seitenfehler (nichts wurde gesendet) – nur Hinweis, kein dauerhafter Wechsel auf die lokale Auswertung
  ERR.transform_error = 'Die Anfrage an Claude konnte nicht vorbereitet werden – bitte erneut senden.';
  ERR.queue_overflow = 'Zu viele Anfragen auf einmal – bitte kurz warten und erneut senden.';
  ERR.invalid_request = 'Claude konnte die Anfrage mit Datenabfragen nicht annehmen. Erneut senden – dann ohne Datenabfragen, nur mit der Lageübersicht.';
  /** Ergebnis bleibt bei unveränderter Frage gleich – kein „Erneut senden“, sondern umformulieren oder offline antworten */
  const NO_RETRY = { refused: 1, empty_completion: 1 };

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
    lossByCause: () => { const L = lossByCause(data()); return { causes: L.causes.map(x => ({ state: x.state, label: causeLabel(x.state), eur: Math.round(x.eur) })), machines: L.byMachine.map(x => ({ id: x.mv.id, eur: x.loss, lossSec: x.lossSec, causes: x.causes.map(y => ({ state: y.state, sec: y.sec, eur: Math.round(y.eur) })) })) }; },
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
      for (const x of ['Wie läuft die Schicht?', 'Was muss ich jetzt tun?', 'Welche Aufträge sind gefährdet und warum?', 'Was passiert, wenn die Studer S33 2 h ausfällt?', 'Schreib mir die Schichtübergabe', 'Wo verlieren wir heute Geld?']) push(x);
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
  .ai-panel.cover{width:min(480px,100%)}
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
  .ai-ttl{font:600 var(--fs-xl)/1.1 var(--f-cond);letter-spacing:.01em;white-space:nowrap}
  .ai-ttl b{color:var(--accent);font-weight:600}
  .ai-modew{position:relative;display:inline-flex;margin-top:4px}
  /* Betriebsart: ruhiges, neutrales Abzeichen – Punkt in Datenfluss-Farbe; Warnfarbe nur bei echtem Verbindungsfehler */
  .ai-mode{--c:var(--info);display:inline-flex;align-items:center;gap:6px;font:500 var(--fs-xs)/1 var(--f-ui);letter-spacing:.01em;padding:4px 9px 4px 7px;border-radius:999px;cursor:help;
    color:var(--text2);background:color-mix(in srgb,var(--card) 80%,transparent);border:1px solid var(--line2)}
  .ai-mode i{width:6px;height:6px;border-radius:50%;background:var(--c);flex:none;opacity:.9}
  .ai-mode.live{--c:var(--accent)} .ai-mode.live i{animation:aiPulse 2.4s ease-in-out infinite}
  .ai-mode.local{--c:var(--info)}
  .ai-mode.failed{--c:var(--st-wait);color:color-mix(in srgb,var(--st-wait) 80%,white);border-color:color-mix(in srgb,var(--st-wait) 34%,transparent);background:color-mix(in srgb,var(--st-wait) 10%,transparent)}
  .ai-mode.verbinde{--c:var(--muted)} .ai-mode.verbinde i{animation:aiBlinkDot 1s ease-in-out infinite}
  .ai-tip{position:absolute;left:0;top:calc(100% + 8px);width:300px;max-width:calc(100vw - 40px);z-index:5;padding:11px 12px;border-radius:10px;background:var(--card2);border:1px solid var(--line2);
    box-shadow:var(--shadow);font:400 var(--fs-sm)/1.45 var(--f-ui);color:var(--text2);opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity .15s ease,transform .15s ease}
  .ai-tip b{color:var(--text);font-weight:600;display:block;margin-bottom:3px}
  .ai-modew:hover .ai-tip,.ai-modew:focus-within .ai-tip{opacity:1;transform:none}
  .ai-hb{display:flex;align-items:center;gap:4px}
  .ai-ib{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer}
  .ai-ib:hover{color:var(--text);background:var(--card);border-color:var(--line)}
  .ai-ib:disabled{opacity:.35;cursor:default;background:transparent;border-color:transparent}
  .ai-ctx{position:relative;display:flex;align-items:center;gap:8px;padding:7px 14px 7px 16px;border-bottom:1px solid var(--line);font-size:var(--fs-sm);color:var(--muted);min-height:38px;background:color-mix(in srgb,var(--bg2) 55%,transparent)}
  .ai-ctx .eyebrow{font-size:var(--fs-2xs);flex:none}
  .ai-ctx .ai-ent{max-width:100%}
  .ai-ctx .ai-ctxs{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ai-ctx button.ai-x{flex:none;border:0;background:transparent;color:var(--faint);cursor:pointer;padding:2px;border-radius:5px;display:grid;place-items:center}
  .ai-ctx button.ai-x:hover{color:var(--text)}
  .ai-log{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 16px 14px;display:flex;flex-direction:column;gap:18px;overscroll-behavior:contain}
  .ai-m{display:flex;flex-direction:column;min-width:0;animation:aiIn .22s ease}
  .ai-m.u{align-self:flex-end;align-items:flex-end;max-width:88%}
  .ai-bub{background:color-mix(in srgb,var(--accent) 14%,var(--card));border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:14px 14px 4px 14px;
    padding:8px 12px;font-size:var(--fs-md);line-height:1.45;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
  .ai-meta{font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);margin-top:5px;font-variant-numeric:tabular-nums;display:flex;gap:6px;align-items:center}
  .ai-m.a{display:flex;flex-direction:column;gap:7px}
  .ai-ah{display:flex;align-items:center;gap:7px;min-height:20px;padding:0 2px;font-size:var(--fs-xs);color:var(--text2);font-weight:600}
  .ai-ah .ai-orb.sm{--s:20px;border-radius:6px}
  .ai-ah .ai-tag{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;padding:3px 5px;border-radius:4px;color:var(--muted);border:1px solid var(--line2)}
  /* Antwortkarte: Bezug · Kernaussage · Kennzahlen · Text · Empfehlung mit Aktionen · Datenbasis */
  .ai-card{--c:var(--info);position:relative;min-width:0;padding:14px 15px 12px;border-radius:13px;border:1px solid var(--line);
    background:linear-gradient(180deg,color-mix(in srgb,var(--c) 5%,var(--card)) 0,var(--card) 90px);box-shadow:0 12px 32px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.035);overflow:hidden}
  .ai-card::before{content:"";position:absolute;left:14px;right:14px;top:0;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 0%,transparent));opacity:.85}
  .ai-card.sev-crit{--c:var(--st-fault)} .ai-card.sev-warn{--c:var(--st-wait)} .ai-card.sev-ok{--c:var(--st-run)} .ai-card.sev-info{--c:var(--info)}
  .ai-top:empty{display:none}
  .ai-eb{display:flex;align-items:center;gap:7px;min-width:0;margin:1px 0 7px;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .ai-eb i{width:7px;height:7px;border-radius:50%;flex:none;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .ai-eb span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-hl{margin:0 0 10px;font:600 var(--fs-xl)/1.24 var(--f-cond);letter-spacing:.005em;color:var(--text);text-wrap:balance;overflow-wrap:anywhere}
  .ai-md > .ai-hl:first-child{margin-top:0}
  .ai-rec{margin:12px 0 2px;padding:11px 12px 11px;border-radius:10px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 24%,var(--line))}
  .ai-rec.note{background:color-mix(in srgb,var(--st-wait) 6%,var(--bg2));border-color:color-mix(in srgb,var(--st-wait) 26%,var(--line))}
  .ai-rec-h{display:flex;align-items:center;gap:6px;margin-bottom:5px;font:700 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
  .ai-rec.note .ai-rec-h{color:var(--st-wait)}
  .ai-rec-t{font-size:var(--fs-md);line-height:1.55;color:var(--text)}
  .ai-rec-t b{font-weight:600}
  .ai-ras{display:flex;flex-direction:column;gap:6px;margin-top:10px}
  .ai-ra{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 9px;border-radius:9px;background:var(--card);border:1px solid var(--line);min-width:0}
  .ai-ra .ic{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;flex:none;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
  .ai-ra .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .ai-ra .tx b{font-size:var(--fs-sm);font-weight:600;color:var(--text);line-height:1.3}
  .ai-ra .tx small{font-size:var(--fs-xs);color:var(--muted);line-height:1.35;overflow-wrap:anywhere}
  .ai-ra .b{flex:none;display:flex;align-items:center}
  .ai-ra .res{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);font-weight:600;white-space:nowrap}
  .ai-ra .res.ok,.ai-ra.done .ic{color:var(--st-run)} .ai-ra .res.fail{color:var(--st-wait)}
  .ai-ra.done{border-color:color-mix(in srgb,var(--st-run) 35%,var(--line))} .ai-ra.done .ic{background:color-mix(in srgb,var(--st-run) 12%,transparent)}
  .ai-more{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
  .ai-mb{display:inline-flex;align-items:center;gap:6px;height:27px;padding:0 10px;border-radius:7px;border:1px solid var(--line2);background:transparent;color:var(--text2);font:500 var(--fs-sm)/1 var(--f-ui);cursor:pointer}
  .ai-mb:hover{border-color:var(--muted);color:var(--text)}
  .ai-mb.danger{color:color-mix(in srgb,var(--st-fault) 85%,white);border-color:color-mix(in srgb,var(--st-fault) 35%,transparent)}
  .ai-mb.done{opacity:.55;cursor:default}
  .ai-extra.ai-in > *{animation:aiIn .25s ease}
  .ai-after:empty{display:none}
  .ai-after .ai-fu{margin-top:2px;padding-left:2px}
  .ai-md:empty{display:none}
  .ai-ah .ai-tag.ki{color:var(--text2);letter-spacing:.04em;text-transform:none;font-weight:500;border-color:color-mix(in srgb,var(--accent) 30%,var(--line2))}
  .ai-ah time{margin-left:auto;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .ai-tchips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
  .ai-copy{display:inline-grid;place-items:center;width:24px;height:22px;margin:-3px -4px -3px 2px;border-radius:6px;border:0;background:transparent;color:var(--faint);cursor:pointer;opacity:0;transition:opacity .15s ease,color .15s ease}
  .ai-m.a:hover .ai-copy,.ai-copy:focus-visible{opacity:1}
  .ai-copy:hover{color:var(--text);background:var(--card)}
  .ai-copy.ok{opacity:1;color:var(--st-run)}
  @media (hover:none){.ai-copy{opacity:.8}}
  .ai-md{font-size:var(--fs-md);line-height:1.56;color:var(--text2);overflow-wrap:anywhere}
  .ai-md > :first-child{margin-top:0}
  .ai-md p{margin:0 0 8px}
  .ai-md b,.ai-md strong{color:var(--text);font-weight:600}
  .ai-md ul,.ai-md ol{margin:2px 0 9px;padding:0;list-style:none}
  .ai-md ol{counter-reset:ai}
  .ai-md li{position:relative;padding-left:16px;margin:4px 0}
  .ai-md ul > li::before{content:"";position:absolute;left:3px;top:.66em;width:5px;height:5px;border-radius:50%;background:color-mix(in srgb,var(--accent) 75%,var(--muted))}
  .ai-md ol > li{counter-increment:ai;padding-left:20px}
  .ai-md ol > li::before{content:counter(ai) ".";position:absolute;left:0;top:0;color:var(--muted);font-variant-numeric:tabular-nums;font-size:var(--fs-sm)}
  .ai-md h4{margin:14px 0 6px;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .ai-md h4:first-child{margin-top:2px}
  .ai-md blockquote{margin:10px 0 4px;padding:9px 11px 9px 12px;border-radius:9px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));
    border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--accent) 70%,transparent);color:var(--text2)}
  .ai-md blockquote + blockquote{margin-top:6px}
  .ai-md code{font:500 var(--fs-sm)/1 var(--f-mono);background:var(--bg2);border:1px solid var(--line);border-radius:4px;padding:1px 4px}
  .ai-md hr{border:0;border-top:1px solid var(--line);margin:10px 0}
  .ai-tblw{overflow-x:auto;margin:6px 0 10px;border:1px solid var(--line);border-radius:8px}
  .ai-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .ai-tbl th{text-align:left;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line);background:var(--bg2);white-space:nowrap}
  .ai-tbl td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  .ai-tbl tr:last-child td{border-bottom:0}
  .ai-pre{margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:var(--bg2);border:1px solid var(--line);font:500 var(--fs-xs)/1.5 var(--f-mono);color:var(--text2);white-space:pre-wrap;overflow-wrap:anywhere}
  .ai-md p.ai-note{font-size:var(--fs-xs);line-height:1.5;color:var(--faint);margin:10px 0 0}
  .ai-md p + p.ai-note, .ai-md h4 + p.ai-note{margin-top:-4px;margin-bottom:8px}
  .ai-md .ai-cursor{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:var(--accent);animation:aiCaret 1s steps(2,start) infinite}
  /* Bezüge im Text: schlichte Links (Mono, gepunktet unterstrichen), Zustandspunkt nur bei Maschinen – keine Rahmen im Fließtext */
  .ai-ent{--c:var(--info);display:inline;padding:0;margin:0;border:0;background:none;color:var(--text);font-family:var(--f-mono);font-size:.95em;font-weight:500;line-height:inherit;letter-spacing:-.01em;cursor:pointer;white-space:nowrap;
    text-decoration:underline dotted;text-decoration-color:color-mix(in srgb,var(--accent) 70%,transparent);text-decoration-thickness:1px;text-underline-offset:3px;transition:color .15s ease}
  .ai-ent:hover{color:var(--accent);text-decoration-style:solid}
  .ai-nb{white-space:nowrap}
  .ai-ent i{display:none}
  .ai-ent[data-k="machine"] i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--c);margin:0 4px 0 1px;vertical-align:.1em}
  /* Bezugszeile (Kontext): als Pille */
  .ai-ctx .ai-ent{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 6px 0 5px;border-radius:5px;border:1px solid color-mix(in srgb,var(--c) 26%,transparent);background:color-mix(in srgb,var(--c) 10%,transparent);text-decoration:none;font-size:var(--fs-xs);flex:none}
  .ai-ctx .ai-ent i{display:inline-block;width:5px;height:5px;margin:0;border-radius:50%;background:var(--c)}
  /* Kennzahl-Leiste der Antwort: .kpi-Anatomie (Eyebrow · Wert · Zeile), Hinweis nur warn/crit über Streifen + Wertfarbe */
  .ai-stats{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));margin:9px 0 11px;border-radius:9px;background:var(--bg2);border:1px solid var(--line);overflow:hidden}
  .ai-stat{position:relative;padding:9px 11px 9px;min-width:0}
  .ai-stat + .ai-stat{border-left:1px solid var(--line)}
  .ai-stat.warn::before,.ai-stat.crit::before{content:"";position:absolute;inset:0 0 auto;height:2px;background:var(--st-wait)}
  .ai-stat.crit::before{background:var(--st-fault)}
  .ai-stat.warn .v{color:var(--st-wait)} .ai-stat.crit .v{color:var(--st-fault)}
  .ai-stat .l{font:500 var(--fs-xs)/1.2 var(--f-ui);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-stat .v{font:600 var(--fs-xl)/1.15 var(--f-cond);color:var(--text);margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-stats.n4 .ai-stat{padding:9px 9px 9px 10px}
  @media (max-width:520px){.ai-stats.n4{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-stats.n4 .ai-stat:nth-child(3){border-left:0}.ai-stats.n4 .ai-stat:nth-child(n+3){border-top:1px solid var(--line)}}
  .ai-stat .s{font-size:var(--fs-2xs);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .ai-imp{margin:9px 0 11px;padding:10px 12px 8px;border-radius:9px;background:var(--bg2);border:1px solid var(--line)}
  .ai-imp-h{display:flex;align-items:center;gap:10px;margin-bottom:6px;min-width:0}
  .ai-imp-h .tt{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ai-imp-h .lg{margin-left:auto;display:flex;gap:10px;font-size:var(--fs-2xs);color:var(--faint);white-space:nowrap}
  .ai-imp-h .lg span{display:inline-flex;align-items:center;gap:4px}
  .lg-due{display:inline-block;width:2px;height:10px;border-radius:1px;background:var(--text2)}
  .lg-was{display:inline-block;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--muted)}
  .lg-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--st-run)}
  .ai-imp-b{position:relative;margin-left:76px;margin-right:82px}
  .ai-imp-g{position:absolute;inset:0;pointer-events:none}
  .ai-imp-g i{position:absolute;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--line) 70%,transparent)}
  .ai-imp-r{position:relative;display:block;height:34px}
  .ai-imp-r .id{position:absolute;left:-76px;top:0;width:70px;height:34px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
  .ai-imp-r .id button{border:0;background:transparent;padding:0;text-align:left;font:500 var(--fs-xs)/1 var(--f-mono);color:var(--text);cursor:pointer;white-space:nowrap}
  .ai-imp-r .id button:hover{color:var(--accent)}
  .ai-imp-r .id small{font-size:var(--fs-2xs);line-height:1;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-imp-r .tr{position:absolute;left:0;right:0;top:0;height:34px}
  .ai-imp-r .tr::before{content:"";position:absolute;left:0;right:0;top:16px;height:2px;border-radius:1px;background:var(--track)}
  .ai-imp-r .sl{position:absolute;top:14px;height:6px;border-radius:3px}
  .ai-imp-r .mv{position:absolute;top:16.5px;height:0;border-top:1.5px dashed color-mix(in srgb,var(--muted) 80%,transparent)}
  .ai-imp-r .due{position:absolute;top:8px;width:2px;height:18px;margin-left:-1px;border-radius:1px;background:var(--text2)}
  .ai-imp-r .dot{position:absolute;top:12px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px var(--bg2),0 0 0 4px color-mix(in srgb,var(--c) 25%,transparent)}
  .ai-imp-r .dot.was{top:13px;width:8px;height:8px;margin-left:-4px;background:var(--bg2);border:1.5px solid var(--muted);box-shadow:none}
  .ai-imp-r .v{position:absolute;right:-82px;top:0;width:76px;height:34px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:2px;font:600 var(--fs-sm)/1 var(--f-ui);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ai-imp-r .v small{font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint)}
  .ai-imp-ax{position:relative;height:14px;margin:2px 82px 0 76px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .ai-imp-ax span{position:absolute;top:3px;transform:translateX(-50%);white-space:nowrap}
  .ai-imp-ax span.now{left:0;transform:none}
  .ai-tc{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border-radius:999px;font-size:var(--fs-xs);color:var(--text2);background:var(--card);border:1px solid var(--line);animation:aiIn .2s ease}
  .ai-tc .ico{color:var(--st-run)} .ai-tc.err .ico{color:var(--st-fault)} .ai-tc.err{color:var(--muted)}
  .ai-spin{width:11px;height:11px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:aiSpin .8s linear infinite;flex:none}
  .ai-typing{display:flex;align-items:center;gap:9px;height:24px;color:var(--muted);font-size:var(--fs-sm)}
  .ai-dots{display:inline-flex;gap:4px}
  .ai-dots i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--accent) 70%,var(--muted));animation:aiDot 1.2s ease-in-out infinite}
  .ai-dots i:nth-child(2){animation-delay:.15s} .ai-dots i:nth-child(3){animation-delay:.3s}
  .ai-src{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--line) 75%,transparent);font-size:var(--fs-2xs);line-height:1.45;color:var(--faint)}
  .ai-src .ico{flex:none;margin-top:1px;color:var(--faint)}
  .ai-src b{font-weight:600;color:var(--muted)}
  .ai-acts{display:flex;flex-direction:column;gap:7px;margin-top:11px}
  .ai-asks:empty{display:none} .ai-asks .ai-acts{margin:0 0 10px}
  .ai-act{--c:var(--accent);display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;column-gap:10px;row-gap:9px;padding:10px 11px;border-radius:10px;
    border:1px solid color-mix(in srgb,var(--c) 30%,var(--line));background:color-mix(in srgb,var(--c) 6%,var(--card));animation:aiIn .22s ease}
  .ai-act > div:nth-child(2){padding-top:1px}
  .ai-act.danger{--c:var(--st-fault)} .ai-act.quiet{--c:var(--line2)}
  .ai-act .ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
  .ai-act .t{font-size:var(--fs-sm);font-weight:600;color:var(--text);line-height:1.3}
  .ai-act .d{font-size:var(--fs-xs);color:var(--muted);line-height:1.35;margin-top:2px;overflow-wrap:anywhere}
  .ai-act .b{grid-column:2;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .ai-act .btn.sm{height:28px}
  .ai-act.ok{--c:var(--st-run)} .ai-act.fail{--c:var(--st-wait)} .ai-act.no{--c:var(--line2);opacity:.75}
  .ai-act .res{font-size:var(--fs-xs);font-weight:600;color:var(--c);white-space:nowrap;display:flex;align-items:center;gap:5px}
  .ai-notice{display:flex;gap:8px;align-items:flex-start;margin:2px 0 9px;padding:7px 10px;border-radius:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);
    background:color-mix(in srgb,var(--st-wait) 7%,transparent);border:1px solid color-mix(in srgb,var(--st-wait) 26%,transparent)}
  .ai-notice .ico{flex:none;color:var(--st-wait);margin-top:1px}
  /* Meldungen bei offenem Copilot oben rechts im freien Bereich – nie über Navigation, Tour-Karte oder Drawer */
  @media (min-width:561px){ body.ai-open #toasts{top:calc(var(--top-h) + 12px);bottom:auto;right:calc(var(--ai-occ,440px) + 16px)} }
  @media (min-width:561px) and (max-width:900px){ body.ai-open #toasts{left:12px;right:calc(var(--ai-occ,440px) + 12px)} body.ai-open .toast{min-width:0;max-width:none} }
  @media (hover:none){ .ai-kb{display:none} }
  .ai-err{display:flex;gap:9px;align-items:flex-start;margin-top:8px;padding:9px 11px;border-radius:9px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);
    background:color-mix(in srgb,var(--st-wait) 8%,var(--card));border:1px solid color-mix(in srgb,var(--st-wait) 32%,transparent)}
  .ai-err .ico{color:var(--st-wait);flex:none;margin-top:1px}
  .ai-err .b{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .ai-fu{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .ai-chip{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 11px;border-radius:999px;border:1px solid var(--line2);background:var(--card);color:var(--text2);
    font:500 var(--fs-sm)/1.25 var(--f-ui);cursor:pointer;text-align:left;transition:border-color .15s ease,color .15s ease,background-color .15s ease}
  .ai-chip:hover{border-color:color-mix(in srgb,var(--accent) 55%,transparent);color:var(--text);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
  .ai-chip .ico{color:var(--accent);flex:none}
  .ai-chip:disabled{opacity:.45;cursor:default}
  .ai-empty{display:flex;flex-direction:column;gap:16px;padding:6px 0 4px;margin:auto 0}
  .ai-hero{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:7px;isolation:isolate}
  .ai-hero::before{content:"";position:absolute;z-index:-1;left:-40px;top:-46px;width:260px;height:170px;pointer-events:none;
    background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 16%,transparent),transparent);filter:blur(6px)}
  .ai-hero h3 span{color:var(--accent)}
  .ai-hero h3{margin:0;font:600 var(--fs-2xl)/1.15 var(--f-cond);letter-spacing:.01em;color:var(--text)}
  .ai-hero p{margin:0;color:var(--muted);font-size:var(--fs-md);line-height:1.5;max-width:50ch}
  .ai-live{display:flex;flex-wrap:wrap;gap:6px}
  .ai-live > span{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;font-size:var(--fs-xs);color:var(--text2);background:var(--card);border:1px solid var(--line);white-space:nowrap}
  .ai-live > span > i{width:6px;height:6px;border-radius:50%;background:var(--c,var(--st-run))}
  .ai-live b{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;margin-right:2px}
  .ai-exg{display:flex;flex-direction:column;gap:6px}
  .ai-exg .eyebrow{font-size:var(--fs-2xs);margin:2px 0 1px}
  .ai-ex{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px 9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--text2);font:500 var(--fs-md)/1.3 var(--f-ui);text-align:left;cursor:pointer;transition:border-color .15s ease,color .15s ease,background-color .15s ease}
  .ai-ex .ico{color:var(--muted);flex:none;transition:color .15s ease}
  .ai-ex .tx{flex:1;min-width:0}
  .ai-ex .ar{flex:none;display:grid;color:var(--faint);opacity:0;transform:translateX(-4px);transition:opacity .15s ease,transform .15s ease}
  .ai-ex:hover{border-color:var(--line2);color:var(--text);background:var(--card2)}
  .ai-ex:hover .ico{color:var(--accent)} .ai-ex:hover .ar{opacity:1;transform:none}
  .ai-tipline{display:flex;gap:7px;align-items:flex-start;margin:2px 0 0;font-size:var(--fs-xs);line-height:1.45;color:var(--faint)}
  .ai-tipline .ico{flex:none;margin-top:1px;color:var(--accent);opacity:.8}
  .ai-foot{position:relative;border-top:1px solid var(--line);padding:9px 12px max(10px,env(safe-area-inset-bottom,0px));background:var(--panel)}
  .ai-sugg{display:flex;gap:6px;overflow-x:auto;padding:1px 0 9px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .ai-sugg::-webkit-scrollbar{display:none}
  .ai-sugg .ai-chip{white-space:nowrap}
  .ai-comp{display:flex;align-items:flex-end;gap:8px;padding:5px 5px 5px 12px;border-radius:12px;background:var(--bg2);border:1px solid var(--line2);transition:border-color .15s ease,box-shadow .15s ease}
  .ai-comp:focus-within{border-color:color-mix(in srgb,var(--accent) 70%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
  .ai-comp textarea{flex:1;min-width:0;border:0;outline:none;background:transparent;resize:none;color:var(--text);font:400 var(--fs-md)/1.45 var(--f-ui);padding:6px 0;max-height:132px;min-height:32px}
  .ai-comp textarea::placeholder{color:var(--faint)}
  .ai-send{flex:none;width:34px;height:34px;border-radius:9px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;cursor:pointer;transition:filter .15s ease,opacity .15s ease}
  .ai-send:hover{filter:brightness(1.08)}
  .ai-send:disabled{opacity:.35;cursor:default;filter:none}
  .ai-send.stop{background:var(--card2);border-color:var(--line2);color:var(--text)}
  .ai-send.stop i{width:10px;height:10px;border-radius:2px;background:currentColor}
  .ai-hint{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:var(--fs-2xs);color:var(--faint);white-space:nowrap;min-width:0}
  .ai-hint > span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ai-hint kbd{font:500 var(--fs-2xs)/1 var(--f-mono);padding:2px 4px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);background:var(--card)}
  .ai-sys{align-self:center;max-width:92%;display:flex;align-items:center;gap:7px;font-size:var(--fs-xs);color:var(--muted);padding:5px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);animation:aiIn .2s ease}
  .ai-sys .ico{flex:none}
  .ai-sys.ok .ico{color:var(--st-run)} .ai-sys.warn .ico{color:var(--st-wait)}
  .btn-ai.ai-on{background:color-mix(in srgb,var(--accent) 26%,var(--card));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent) inset}
  .ai-slot:empty,.ai-embed:empty{display:none}
  /* Balken */
  .ai-bars{display:grid;gap:9px;margin:4px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-br .h{display:flex;align-items:center;gap:7px;min-width:0;font-size:var(--fs-sm);line-height:19px}
  .ai-br .h .ai-ent{flex:none}
  .ai-br .n{flex:1;min-width:0;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-br .q{flex:none;font-weight:600;font-size:var(--fs-sm);font-variant-numeric:tabular-nums;color:var(--text)}
  .ai-br .tr{height:6px;margin-top:4px;border-radius:3px;background:var(--track);overflow:hidden}
  .ai-br .tr i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 70%,transparent),var(--c))}
  .ai-br .s{margin-top:3px;font-size:var(--fs-xs);line-height:1.4;color:var(--muted)}
  /* Risiko-Karten */
  .ai-risk{display:grid;gap:8px;margin:4px 0 12px}
  .ai-rk{position:relative;padding:9px 11px 9px 13px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent);overflow:hidden}
  .ai-rk::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c)}
  .ai-rk .h{display:flex;align-items:center;gap:7px;min-width:0}
  .ai-rk .h .ai-ent{flex:none;font-weight:600}
  .ai-rk .nm{flex:1;min-width:0;font-weight:600;font-size:var(--fs-sm);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-rk .tg{flex:none;font:600 var(--fs-2xs)/17px var(--f-ui);padding:0 7px;border-radius:999px;white-space:nowrap;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
  .ai-rk .m{margin:4px 0 5px;font-size:var(--fs-xs);color:var(--muted)}
  .ai-rk .m b{color:var(--text2);font-weight:600}
  .ai-rk .ln{display:grid;grid-template-columns:58px minmax(0,1fr);gap:8px;padding:3px 0 0;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .ai-rk .ln + .ln{margin-top:2px}
  .ai-rk .k{font:600 var(--fs-2xs)/18px var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  /* Personal */
  .ai-crew{display:grid;margin:4px 0 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent);overflow:hidden}
  .ai-pp{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 10px}
  .ai-pp + .ai-pp{border-top:1px solid var(--line)}
  .ai-pp .av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:600 var(--fs-xs)/1 var(--f-ui);letter-spacing:.02em;color:var(--text);cursor:pointer;
    background:color-mix(in srgb,var(--c) 18%,var(--card));border:1.5px solid color-mix(in srgb,var(--c) 65%,transparent);padding:0}
  .ai-pp .av:hover{background:color-mix(in srgb,var(--c) 30%,var(--card))}
  .ai-pp .tx{min-width:0}
  .ai-pp .n{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:var(--fs-sm);line-height:17px}
  .ai-pp .n button{all:unset;cursor:pointer;font-weight:600;color:var(--text);white-space:nowrap}
  .ai-pp .n button:hover{color:var(--accent)}
  .ai-pp .n small{min-width:0;font-size:var(--fs-xs);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-pp .a{font-size:var(--fs-sm);line-height:1.45;color:var(--muted);margin-top:1px}
  .ai-pp .tg{flex:none;font:600 var(--fs-2xs)/16px var(--f-ui);padding:0 7px;border-radius:999px;white-space:nowrap;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
  /* Rohmaterial */
  .ai-stock{display:grid;gap:9px;margin:4px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-sk .h{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:var(--fs-sm);line-height:18px}
  .ai-sk .n{all:unset;cursor:pointer;flex:1 1 auto;min-width:0;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-sk .n:hover{color:var(--accent)}
  .ai-sk .tg{flex:none;font:600 var(--fs-2xs)/16px var(--f-ui);padding:0 6px;border-radius:999px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
  .ai-sk .q{flex:none;font-weight:600;font-size:var(--fs-sm);font-variant-numeric:tabular-nums;color:var(--c)}
  .ai-sk .wb{position:relative;height:6px;margin-top:4px;border-radius:3px;background:var(--track)}
  .ai-sk .wb .tr{position:absolute;inset:0;border-radius:3px;overflow:hidden}
  .ai-sk .wb i{position:absolute;left:0;top:0;bottom:0;background:var(--c)}
  .ai-sk .wb i.ord{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 45%,transparent) 0 3px,transparent 3px 6px)}
  .ai-sk .wb b{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px}
  .ai-sk .wb b.min{background:var(--text2);opacity:.8}
  .ai-sk .wb i.res{background:color-mix(in srgb,var(--c) 38%,transparent)}
  .ai-sk .wb i.sh{background:color-mix(in srgb,var(--st-fault) 22%,transparent);box-shadow:inset 0 0 0 1.5px var(--st-fault)}
  .ai-sk-lg{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px;font-size:var(--fs-2xs);color:var(--faint)}
  .ai-sk-lg span{display:inline-flex;align-items:center;gap:5px}
  .ai-sk-lg i{display:inline-block}
  .ai-sk-lg .l-min{width:2px;height:10px;border-radius:1px;background:var(--text2)}
  .ai-sk-lg .l-free{width:12px;height:6px;border-radius:2px;background:var(--st-run)}
  .ai-sk-lg .l-res{width:12px;height:6px;border-radius:2px;background:color-mix(in srgb,var(--st-run) 38%,transparent)}
  .ai-sk-lg .l-ord{width:12px;height:6px;border-radius:2px;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--st-run) 55%,transparent) 0 3px,transparent 3px 6px)}
  /* Werkzeug-Standzeiten */
  .ai-tools{display:grid;gap:8px;margin:4px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-tl .h{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:var(--fs-sm);line-height:18px}
  .ai-tl .n{flex:1;min-width:0;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ai-tl .r{flex:none;font-weight:600;font-size:var(--fs-sm);font-variant-numeric:tabular-nums;color:var(--c)}
  .ai-tl .wb{position:relative;height:6px;margin:4px 0 4px;border-radius:3px;background:var(--track);overflow:visible}
  .ai-tl .wb i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--c)}
  .ai-tl .wb i.nx{border-radius:0 3px 3px 0;background:color-mix(in srgb,var(--c) 40%,transparent)}
  .ai-tl .wb b{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text2);opacity:.75}
  .ai-tl .s{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:var(--fs-xs);color:var(--muted)}
  .ai-tl .tg{display:inline-flex;align-items:center;gap:4px;padding:0 7px;border-radius:999px;font-weight:600;font-size:var(--fs-2xs);line-height:17px;color:var(--st-tool);background:color-mix(in srgb,var(--st-tool) 13%,transparent);border:1px solid color-mix(in srgb,var(--st-tool) 30%,transparent)}
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
  .ai-rt .sq{flex:none;font:600 var(--fs-2xs)/20px var(--f-mono);color:var(--faint);letter-spacing:.02em}
  .ai-rt .op{flex:1 1 auto;min-width:0;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ai-rt.s-done .op,.ai-rt.s-plan .op,.ai-rt.s-ship .op{color:var(--text2);font-weight:500}
  .ai-rt .tg{flex:none;align-self:center;font:600 var(--fs-2xs)/16px var(--f-ui);padding:0 7px;border-radius:999px;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);white-space:nowrap}
  .ai-rt.s-plan .tg,.ai-rt.s-ship .tg{color:var(--muted);background:transparent;border-color:var(--line2)}
  .ai-rt .w{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;margin-top:1px;font-size:var(--fs-sm);line-height:1.5;color:var(--muted)}
  .ai-rt .wh{color:var(--text2)}
  .ai-rt .sub{min-width:0}
  .ai-rt .w.sub2{display:block;margin-top:2px}
  .ai-rt .wh:not(:last-child)::after{content:"·";margin-left:6px;color:var(--faint)}
  .ai-rt .pg{display:block;height:4px;margin-top:6px;border-radius:2px;background:var(--track);overflow:hidden}
  .ai-rt .pg i{display:block;height:100%;border-radius:2px;background:var(--c);transition:width .4s}
  .ai-rt.s-wait .pg i{background:color-mix(in srgb,var(--c) 70%,transparent)}
  @keyframes aiIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @keyframes aiSpin{to{transform:rotate(360deg)}}
  @keyframes aiDot{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-4px);opacity:1}}
  @keyframes aiCaret{to{visibility:hidden}}
  @keyframes aiPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 0%,transparent)}}
  @keyframes aiBlinkDot{50%{opacity:.3}}
  @media (max-width:560px){
    .ai-h{padding:10px 8px 10px 12px;gap:9px} .ai-orb{--s:30px} .ai-ttl{font-size:var(--fs-xl)}
    .ai-log{padding:12px 12px 8px;gap:16px} .ai-ctx{padding:6px 10px 6px 12px}
    .ai-foot{padding:8px 10px max(9px,env(safe-area-inset-bottom,0px))} .ai-hint .ai-kb{display:none}
    .ai-card{padding:12px 12px 11px;border-radius:12px} .ai-hl{font-size:var(--fs-xl)} .ai-ra{flex-wrap:wrap} .ai-ra .b{margin-left:36px}
    .ai-m.u{max-width:92%}
    .ai-tip{width:260px}
  }
  /* Personal: betreut / Schichtleitung als Kontur (im Einsatz, aber ohne eigene Aufgabe) – wie die Personalansicht */
  .ai-pp.s-tending .av,.ai-pp.s-lead .av{background:var(--card)}
  .ai-pp.s-idle .tg{color:var(--text2)}
  /* Offene Meldungen */
  .ai-nts{display:grid;gap:6px;margin:4px 0 12px}
  .ai-nt{--c:var(--info);position:relative;padding:8px 11px 9px 13px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent);overflow:hidden;min-width:0}
  .ai-nt::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c)}
  .ai-nt.ack{opacity:.74}
  .ai-nt .mt{display:flex;align-items:center;gap:8px;min-width:0;font-size:var(--fs-xs);line-height:18px;color:var(--muted)}
  .ai-nt .sv{flex:none;font:700 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--c)}
  .ai-nt .tw{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-nt .en{margin-left:auto;flex:none;font-size:var(--fs-xs)}
  .ai-nt .tt{margin-top:3px;font-weight:600;font-size:var(--fs-sm);line-height:1.4;color:var(--text);overflow-wrap:anywhere}
  .ai-nt .sg{margin-top:3px;font-size:var(--fs-xs);line-height:1.5;color:var(--text2)}
  /* Vergleich mehrerer Arbeitsplätze */
  .ai-cmp{display:grid;gap:8px;margin:4px 0 12px}
  .ai-cm{padding:10px 12px 10px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent);min-width:0}
  .ai-cm .h{display:flex;align-items:center;gap:8px;min-width:0}
  .ai-cm .h .ai-ent{flex:none;font-weight:600}
  .ai-cm .n{flex:1;min-width:0;font-weight:600;font-size:var(--fs-sm);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-cm .h .pill{flex:none}
  .ai-cm .o{margin-top:5px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .ai-cm .c{margin-top:2px;font-size:var(--fs-xs);line-height:1.45;color:var(--muted)}
  .ai-cm .k{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--line) 80%,transparent)}
  .ai-cm .k span{display:flex;flex-direction:column;gap:2px;min-width:0}
  .ai-cm .k small{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);white-space:nowrap}
  .ai-cm .k b{font:600 var(--fs-lg)/1.15 var(--f-cond);color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-cm .k b.warn{color:var(--st-wait)}
  /* Wechselplan (Zeitleiste) */
  .ai-tp{margin:4px 0 12px;padding:10px 12px 4px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-tpr{--c:var(--st-tool);position:relative;display:grid;grid-template-columns:40px 12px minmax(0,1fr);column-gap:9px;padding-bottom:10px}
  .ai-tpr::after{content:"";position:absolute;left:54.5px;top:15px;bottom:-1px;width:1px;background:var(--line2)}
  .ai-tpr:last-child::after,.ai-tpr:nth-last-child(2):has(+ .ai-tp-more)::after{content:none}
  .ai-tpr .tm{font:600 var(--fs-sm)/18px var(--f-ui);font-variant-numeric:tabular-nums;color:var(--text);text-align:right}
  .ai-tpr .nd{position:relative;z-index:1;width:10px;height:10px;margin-top:4px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px var(--card2)}
  .ai-tpr.idx{--c:color-mix(in srgb,var(--st-tool) 60%,var(--text2))}
  .ai-tpr.proj .nd{background:var(--card2);border:1.5px dashed var(--c);box-sizing:border-box}
  .ai-tpr .bd{min-width:0}
  .ai-tpr .h{display:flex;align-items:center;gap:7px;min-width:0;line-height:18px}
  .ai-tpr .h .ai-ent{flex:none}
  .ai-tpr .n{flex:1;min-width:0;font-size:var(--fs-sm);font-weight:500;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-tpr .tg{flex:none;font:600 var(--fs-2xs)/16px var(--f-ui);padding:0 7px;border-radius:999px;color:color-mix(in srgb,var(--st-tool) 85%,white);background:color-mix(in srgb,var(--st-tool) 13%,transparent);border:1px solid color-mix(in srgb,var(--st-tool) 30%,transparent)}
  .ai-tpr.proj .tg{color:var(--muted);background:transparent;border:1px dashed var(--line2)}
  .ai-tpr .w{margin-top:2px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .ai-tpr .w b{font-weight:600;color:var(--text)}
  .ai-tpr .s{font-size:var(--fs-xs);line-height:1.45;color:var(--muted)}
  .ai-tpr .wt{color:var(--st-wait);font-weight:600}
  .ai-tp-more{padding:0 0 9px 61px;font-size:var(--fs-xs);color:var(--faint)}
  .ai-offer{margin:2px 0 10px}
  /* Restlaufzeit nach Ursache (Engine delayBreakdown): Balken in Arbeitsgang-Reihenfolge, darunter die größten Beiträge */
  .ai-dly{margin:6px 0 12px;padding:10px 12px 11px;border:1px solid var(--line);border-radius:var(--r-sm);background:color-mix(in srgb,var(--card2) 70%,transparent)}
  .ai-dly-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}
  .ai-dly-h .tt{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .ai-dly-h .tot{font:600 var(--fs-sm)/1 var(--f-ui);color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ai-dly-bar{display:flex;gap:2px;height:10px;border-radius:3px;overflow:hidden;background:var(--track)}
  .ai-dly-bar i{display:block;height:100%;min-width:2px;background:var(--c);opacity:.72}
  .ai-dly-bar i.lim{opacity:1}
  .ai-dly .k-noShift{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--st-idle) 70%,transparent) 0 2px,transparent 2px 5px) !important}
  .ai-dly-l{display:grid;gap:4px;margin-top:10px}
  .ai-dly-l .r{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:baseline;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .ai-dly-l .r > i{width:8px;height:8px;border-radius:2px;background:var(--c);align-self:center;opacity:.85}
  .ai-dly-l .r b{font-weight:600;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ai-dly-l .r.lim .t,.ai-dly-l .r.lim b{color:var(--text);font-weight:600}
  .ai-dly-l .r.lim > i{opacity:1}
  /* Touch: Bedienflächen ≥ 40 px, Eingabefeld 16 px (kein Zoom unter iOS) */
  @media (pointer:coarse){
    .ai-chip{min-height:40px;padding:6px 13px}
    .ai-mb{height:40px;padding:0 12px}
    .ai-copy{width:40px;height:40px;margin:-10px -10px -10px 0;opacity:.8}
    .ai-ib,.ai-send{width:40px;height:40px}
    .ai-ctx button.ai-x{width:40px;height:40px;margin:-8px -10px -8px 0}
    .ai-ex{min-height:44px}
    .ai-comp textarea{font-size:16px !important;min-height:40px}
    .ai-md .ai-ent,.ai-rec-t .ai-ent,.ai-rt .ai-ent,.ai-rk .ai-ent,.ai-br .ai-ent{padding:9px 0;margin:-9px 0}
    .ai-imp-r .id button,.ai-pp .n button,.ai-sk .n{padding:9px 0;margin:-9px 0}
  }
  `, 'ai-copilot');

  // ------------------------------------------------------------------ Markdown (fett, kursiv, Listen, Zitat, Überschriften, Code) + Entitäts-Chips
  const ENT_RE = /\b(FA-\d{5})\b|\b(M(?:0[1-9]|1[0-3]))\b|\b(P(?:0[1-9]|1[0-9]))\b|\b(AGV ?[12])\b|\b(MAT-[A-Z0-9]+)\b|\b(WZ-\d{4})\b|\b(BH-\d{4})\b/g;
  function entColor(kind, id) {
    const st = S(); if (!st) return 'var(--info)';
    if (kind === 'machine') { const m = st.machines[id]; return m ? (WF.STATE[m.state] || {}).color || 'var(--info)' : 'var(--info)'; }
    if (kind === 'order') { const o = st.orders[id]; if (!o) return 'var(--info)'; if (o.status === 'fertig') return 'var(--st-run)'; const f = WF.sim.forecast().orders[id]; if (!f || f.eta == null) return 'var(--info)'; const sl = o.due - f.eta; return sl < 0 ? 'var(--st-fault)' : sl < 4 * 3600 ? 'var(--st-wait)' : 'var(--st-run)'; }
    if (kind === 'person') { const p = st.people[id]; if (!p) return 'var(--info)'; const k = pDisp(p).key; return k === 'working' || k === 'tending' || k === 'lead' ? 'var(--st-run)' : k === 'driving' ? 'var(--mat)' : k === 'break' ? 'var(--st-wait)' : k === 'offShift' ? 'var(--faint)' : k === 'walking' ? 'var(--info)' : 'var(--st-idle)'; }
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
    if (!noLinks) { t = linkEntities(t, keep); t = t.replace(/(\u0001\d+\u0002)([)\].,;:!?]+)/g, (_, ph1, pn) => keep('<span class="ai-nb">') + ph1 + pn + keep('</span>')); }
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>');
    t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
    t = t.replace(/\u0003/g, '<span class="ai-cursor"></span>');
    // Zahl und Einheit nicht trennen („2 h 05 min“, „25 Stk“, „AG 20“, „Di 06:00“)
    t = t.replace(/(\d) (?=(?:h|min|s|Stk|m|kW|kWh|T|Tage|Tag|Teile|Teil|mm|Std|Uhr)(?![A-Za-zÄÖÜäöüß])|€|%)/g, '$1\u00a0')
      .replace(/(^|[\s(])(h|T|AG|Mo|Di|Mi|Do|Fr|Sa|So|ca\.|Teil|Nr\.) (?=\d)/g, '$1$2\u00a0');
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
    const flushQ = () => {
      if (!quote.length) return;
      const mm = /^\*\*(Empfehlung|Einschätzung|Hinweis|Jetzt tun):\*\*\s*(.*)$/.exec(quote[0]);
      if (mm) html += `<div class="ai-rec${mm[1] === 'Hinweis' ? ' note' : ''}"><div class="ai-rec-h">${icon(mm[1] === 'Hinweis' ? 'info' : mm[1] === 'Einschätzung' ? 'check' : 'target', 13)}${esc(mm[1])}</div><div class="ai-rec-t">${[mm[2]].concat(quote.slice(1)).map(x => inline(x)).join('<br>')}</div></div>`;
      else html += '<blockquote>' + quote.map(x => inline(x)).join('<br>') + '</blockquote>';
      quote = [];
    };
    const closeL = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (code != null) { if (/^\s*```/.test(line)) { html += '<pre class="ai-pre">' + esc(code.join('\n')) + '</pre>'; code = null; } else code.push(raw); continue; }
      if (/^\s*```/.test(line)) { flushP(); flushQ(); closeL(); flushT(); code = []; continue; }
      if ((m = /^\u0005(\w+)$/.exec(line.trim()))) { flushP(); flushQ(); closeL(); flushT(); html += `<div class="ai-slot" data-slot="${m[1]}"></div>`; continue; }
      if ((m = /^\[\[([a-zäöü]+)(?:\s+([A-Za-z0-9-]+))?\]\]$/i.exec(line.trim()))) { flushP(); flushQ(); closeL(); flushT(); html += `<div class="ai-embed" data-e="${esc(m[1].toLowerCase())}" data-id="${esc(m[2] || '')}"></div>`; continue; }
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
    { g: 'Lage', items: [['gauge', 'Wie läuft die Schicht?'], ['target', 'Was muss ich jetzt tun?'], ['file', 'Schreib mir die Schichtübergabe']] },
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
    const st = live.status, failed = st === 'offline' && live.failed;
    // ruhiges, neutrales Abzeichen: lokal = „Lokal · aus Live-Daten“, live = „Claude“; Warnfarbe nur bei echtem Fehler
    R.mode.className = 'ai-mode ' + (st === 'live' ? 'live' : st === 'verbinde' ? 'verbinde' : failed ? 'failed' : 'local');
    R.modeT.textContent = st === 'live' ? 'Claude' : st === 'verbinde' ? 'Verbinde …' : failed ? 'Claude nicht erreichbar · lokal' : 'Lokal · aus Live-Daten';
    R.tip.innerHTML = st === 'live'
      ? `<b>Claude</b>${esc(live.reason)} Jede Anfrage zählt zum Claude-Kontingent des angemeldeten Kontos.`
      : st === 'offline'
        ? `<b>${failed ? 'Claude nicht erreichbar' : 'Lokal aus Live-Daten'}</b>${esc(live.reason)} Beantwortet werden Lage, Termine, Engpass, Maschinen, Aufträge, Werkzeuge, Material, Personal, Qualität, Kosten, Meldungen, Was-wäre-wenn und Schichtübergabe. Auf claude.ai veröffentlicht antwortet Claude frei formuliert – mit denselben Daten.`
        : `<b>Verbindung wird geprüft</b>${esc(live.reason)}`;
    R.hintR.textContent = st === 'live' ? 'Claude · Aktionen nur nach Bestätigung' : 'Aus Live-Daten · Aktionen nur nach Bestätigung';
  };

  // ------------------------------------------------------------------ Öffnen / Schließen / Kontext
  let openState = false, beside = false, selfSelect = false;
  const wide = () => G.matchMedia && G.matchMedia('(min-width: 1100px)').matches;
  /** Copilot neben dem Drawer nur, wenn danach noch genug Arbeitsfläche bleibt (≥ 1680 px); sonst deckt er den Drawer bündig ab */
  const roomBeside = () => G.matchMedia && G.matchMedia('(min-width: 1680px)').matches;
  const drawerOpen = () => { const d = document.getElementById('drawer'); return !!(d && d.classList.contains('open')); };
  function layout() {
    if (!panel) return;
    const dr = openState && drawerOpen();
    beside = dr && roomBeside();
    const cover = dr && !beside;
    panel.classList.toggle('beside', beside);
    panel.classList.toggle('cover', cover);
    document.body.classList.toggle('ai-beside', beside);
    // Breite, die rechts belegt ist – Meldungen (Toasts) stehen links davon
    const w = G.innerWidth || 1440, pw = Math.min(cover ? 480 : 440, w);
    document.body.style.setProperty('--ai-occ', (beside ? Math.min(480, w) + pw : pw) + 'px');
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
    // ohne Platz neben dem Drawer: Copilot schließen, damit das Detail sichtbar ist (Unterhaltung bleibt erhalten)
    if (!roomBeside()) UI.close();
    selfSelect = true;
    try { WF.app.select(kind, id); } finally { selfSelect = false; }
    layout();
  };
  function ctxLabel(ctx) {
    if (!ctx) return '';
    if (ctx.kind === 'notification') { const n = (S().notifications || []).find(x => x.id === ctx.id); return n ? n.title : 'Meldung'; }
    if (ctx.kind === 'view') return '';
    if (ctx.kind === 'machine') { const mv = S().machines[ctx.id]; return mv ? `${mv.short} · ${msl(mv)}` : ''; }
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
        <h3>Fragen an die <span>Fertigung</span></h3>
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
    n.innerHTML = `<div class="ai-ah"><span class="ai-orb sm" aria-hidden="true">${icon('sparkles', 12)}</span><span class="ai-who">Copilot</span>${mode === 'KI' ? '<span class="ai-tag ki" title="Antwort von Claude aus den Live-Daten">Claude</span>' : ''}<time title="${esc(U.fmtDayClock(m.t))} (Simulationszeit)">${nowLabel()}</time><button type="button" class="ai-copy" data-copy="${m.id}" title="Antwort als Text kopieren" aria-label="Antwort kopieren" hidden>${icon('file', 13)}</button></div>
      <div class="ai-card">
        <div class="ai-tchips" hidden></div>
        <div class="ai-asks"></div>
        <div class="ai-top"></div>
        <div class="ai-body"><div class="ai-typing"><span class="ai-dots"><i></i><i></i><i></i></span><span class="ai-tyt">${mode === 'KI' ? 'Claude denkt nach …' : 'Liest Live-Daten …'}</span></div></div>
        <div class="ai-extra"></div>
      </div>
      <div class="ai-after"></div>`;
    R.log.append(n);
    m.el = n; m.card = n.querySelector('.ai-card'); m.top = n.querySelector('.ai-top'); m.body = n.querySelector('.ai-body'); m.toolsEl = n.querySelector('.ai-tchips');
    m.extra = n.querySelector('.ai-extra'); m.after = n.querySelector('.ai-after'); m.asks = n.querySelector('.ai-asks'); m.tagEl = n.querySelector('.ai-tag');
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
    // während des Streamens eine angefangene Grafik-Zeile „[[…“ noch nicht als Text zeigen
    const src = streaming ? m.text.replace(/(^|\n)\[\[[^\]\n]*\]?$/, '$1') : m.text;
    let html = md(src + (streaming ? '\u0003' : ''));
    // Claude: erste fette Zeile = Kernaussage (gleiche Gestaltung wie die Offline-Antworten)
    if (m.mode === 'KI') html = html.replace(/^<p><b>((?:(?!<\/b>)[\s\S]){3,4000}?)<\/b>(<\/p>|<br>)/, (_, t, end) => `<h3 class="ai-hl">${t}</h3>` + (end === '<br>' ? '<p>' : ''));
    if (m._h === html) return;
    m._h = html;
    m.body.innerHTML = `<div class="ai-md">${html}</div>`;
    if (m.slots) for (const el of m.body.querySelectorAll('.ai-slot')) { const x = m.slots[el.dataset.slot]; if (x) el.innerHTML = x; }
    for (const el of m.body.querySelectorAll('.ai-embed')) {
      const key = el.dataset.e + '|' + el.dataset.id;
      m.embeds = m.embeds || {};
      if (!(key in m.embeds)) { try { m.embeds[key] = embedHTML(el.dataset.e, el.dataset.id); } catch (e) { m.embeds[key] = ''; } }
      el.innerHTML = m.embeds[key];
    }
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
    return `<div class="ai-stats n${stats.length}" style="--n:${stats.length}">${stats.map(x => `<div class="ai-stat ${x.c || ''}" title="${esc(x.l + ': ' + x.v + (x.s ? ' · ' + x.s : ''))}"><div class="l">${esc(x.l)}</div><div class="v">${esc(x.v)}</div>${x.s ? `<div class="s">${esc(x.s)}</div>` : ''}</div>`).join('')}</div>`;
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
    else { const ds = Math.max(1, Math.ceil(span / DAY / 5)) * DAY; for (let t = Math.floor(t0 / DAY) * DAY + DAY; t <= t1; t += ds) ticks.push({ t, l: U.fmtDay(t) }); }
    const ax = ticks.filter(x => X(x.t) > 16 && X(x.t) < 92).map(x => `<span style="left:${X(x.t).toFixed(2)}%">${esc(x.l)}</span>`).join('');
    const grid = ticks.filter(x => X(x.t) > 0 && X(x.t) < 100).map(x => `<i style="left:${X(x.t).toFixed(2)}%"></i>`).join('');
    return `<div class="ai-imp"><div class="ai-imp-h"><span class="tt">${esc(imp.title || 'Prognose gegen Termin')}</span><span class="lg"><span><i class="lg-due"></i>Termin</span>${shifted ? '<span><i class="lg-was"></i>vorher</span>' : ''}<span><i class="lg-dot"></i>Prognose</span></span></div>
      <div class="ai-imp-b"><div class="ai-imp-g">${grid}</div>${rows}</div><div class="ai-imp-ax"><span class="now" title="${esc(U.fmtDayClock(t0))}">jetzt</span>${ax}</div></div>`;
  }
  /** Arbeitsgang-Kette als Stepper: fertig (Haken), aktiv (Status-Farbe, Fortschritt), wartend, geplant, extern, Versand */
  function routeHTML(list) {
    if (!list || !list.length) return '';
    const node = (r) => (r.st === 'done' ? icon('check', 11) : r.st === 'ship' ? icon('truck', 11) : r.st === 'ext' ? icon('route', 11) : '');
    const where = (r) => (r.st === 'ship' ? '' : S().machines[r.station] ? entChip('machine', r.station, r.station) + `<span class="wh">${esc(station(r.station).short)}</span>` : `<span class="wh">${esc(r.where || r.station)}</span>`);
    return `<ol class="ai-route">${list.map(r => `<li class="ai-rt s-${r.st}" style="--c:${r.c}">
      <span class="nd">${node(r)}</span>
      <div class="bd"><div class="h"><span class="sq">AG ${esc(r.seq)}</span><span class="op">${esc(r.op)}</span><span class="tg">${esc(r.pill)}</span></div>
        ${r.sub && r.sub.length > 38 && where(r) ? `<div class="w">${where(r)}</div><div class="w sub2">${inline(r.sub)}</div>` : `<div class="w">${where(r)}${r.sub ? `<span class="sub">${inline(r.sub)}</span>` : ''}</div>`}
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
  /** Personal im Dienst: Initialen (Farbe = Zustand), Name/Rolle, Tätigkeit, Zustand */
  function crewHTML(list) {
    if (!list || !list.length) return '';
    // Farben wie die Personalansicht: betreut/Schichtleitung als Kontur (im Einsatz ohne eigene Aufgabe)
    const col = { working: 'var(--st-run)', driving: 'var(--mat)', walking: 'var(--info)', tending: 'var(--st-run)', lead: 'var(--st-run)', idle: 'var(--st-idle)', break: 'var(--st-wait)' };
    const ini = (n) => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    return `<div class="ai-crew">${list.map(p => `<div class="ai-pp s-${esc(p.state)}" style="--c:${col[p.state] || 'var(--muted)'}">
      <button type="button" class="av" data-ent-k="person" data-ent-id="${esc(p.id)}" title="${esc(p.full)} öffnen">${esc(ini(p.full))}</button>
      <div class="tx"><div class="n"><button type="button" data-ent-k="person" data-ent-id="${esc(p.id)}">${esc(p.name)}</button><small>${esc(p.role)}</small></div>
        <div class="a">${p.act && p.act !== 'verfügbar' ? inline(p.act) : '<span class="muted">ohne Aufgabe – bereit für die nächste</span>'}</div></div>
      <span class="tg">${esc(p.st)}</span></div>`).join('')}</div>`;
  }
  /** Rohmaterial: frei (voll) + für offene Aufträge verplant (hell) + bestellt (schraffiert), Fehlmenge rot umrandet; Strich = Mindestbestand */
  function stockHTML(list) {
    if (!list || !list.length) return '';
    const col = { unter: 'var(--st-wait)', fehlt: 'var(--st-fault)', knapp: 'var(--st-wait)', ok: 'var(--st-run)' };
    const tag = { unter: 'unter Min.', fehlt: 'fehlt', knapp: 'knapp', ok: '' };
    return `<div class="ai-stock">${list.map(r => {
      const max = Math.max(r.on + r.ord, r.min * 2, r.nd, 1) * 1.08, X = (v) => Math.max(0, Math.min(100, v / max * 100));
      const free = Math.max(0, r.on - r.nd), res = Math.min(r.on, r.nd), short = Math.max(0, r.nd - r.on - r.ord);
      const tip = `${r.name}: Bestand ${r.q} · Mindestbestand ${r.minQ} · Bedarf offener Aufträge ca. ${r.ndQ}${r.ordQ ? ' · bestellt ' + r.ordQ : ''}`;
      return `<div class="ai-sk" style="--c:${col[r.status]}" title="${esc(tip)}">
        <div class="h"><button type="button" class="n" data-ent-k="material" data-ent-id="${esc(r.id)}">${esc(r.name)}</button>${tag[r.status] ? `<span class="tg">${esc(tag[r.status])}</span>` : ''}<span class="q">${esc(r.q)}</span></div>
        <div class="wb"><span class="tr">${free > 0 ? `<i style="width:${X(free).toFixed(1)}%"></i>` : ''}${res > 0 ? `<i class="res" style="left:${X(free).toFixed(1)}%;width:${(X(r.on) - X(free)).toFixed(1)}%"></i>` : ''}${r.ord ? `<i class="ord" style="left:${X(r.on).toFixed(1)}%;width:${(X(r.on + r.ord) - X(r.on)).toFixed(1)}%"></i>` : ''}${short > 0 ? `<i class="sh" style="left:${X(r.on + r.ord).toFixed(1)}%;width:${(X(r.nd) - X(r.on + r.ord)).toFixed(1)}%"></i>` : ''}</span><b class="min" style="left:${X(r.min).toFixed(1)}%"></b></div></div>`;
    }).join('')}<div class="ai-sk-lg"><span><i class="l-free"></i>frei</span><span><i class="l-res"></i>für offene Aufträge verplant</span><span><i class="l-ord"></i>bestellt</span><span><i class="l-min"></i>Mindestbestand</span></div></div>`;
  }
  /** Risiko-Karten: je Auftrag Kopf (Puffer/Verzug), Prognose/Termin, „Jetzt“ und „Ursache“ (Engine, wie die Meldung) */
  function riskHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-risk">${list.map(r => `<div class="ai-rk${r.late ? ' late' : ''}" style="--c:${r.late ? 'var(--st-fault)' : 'var(--st-wait)'}">
      <div class="h">${entChip('order', r.id)}<span class="nm">${esc(r.part)}</span><span class="tg">${esc(dur0(Math.abs(r.slack)) + (r.late ? ' Verzug' : ' Puffer'))}</span></div>
      <div class="m">${esc(r.cust)} · Prognose <b>${esc(r.eta)}</b> · Termin ${esc(r.due)}${r.eil ? ' · <b>Eilauftrag</b>' : ''}</div>
      ${r.now ? `<div class="ln"><span class="k">Jetzt</span><span class="v">${inline(r.now)}</span></div>` : ''}
      ${r.bn ? `<div class="ln"><span class="k">Ursache</span><span class="v">${inline(uc1(r.bn))}</span></div>` : ''}</div>`).join('')}</div>`;
  }
  /** Balken (horizontal): Wert relativ zum größten Wert; optional Maschinen-Chip und Unterzeile */
  function barsHTML(d) {
    const rows = d && d.rows || []; if (!rows.length) return '';
    const max = d.max != null ? d.max : Math.max(...rows.map(r => r.v || 0), 1e-9);
    return `<div class="ai-bars">${rows.map(r => `<div class="ai-br" style="--c:${r.c || 'var(--accent)'}">
      <div class="h">${r.ent ? entChip(r.ent.kind, r.ent.id) : ''}<span class="n">${esc(r.label)}</span><span class="q">${esc(r.vTxt)}</span></div>
      <div class="tr"><i style="width:${Math.max(1.5, (r.v || 0) / max * 100).toFixed(1)}%"></i></div>
      ${r.sub ? `<div class="s">${inline(r.sub)}</div>` : ''}</div>`).join('')}</div>`;
  }
  /** Restlaufzeit bis zur Prognose nach Ursache (Engine delayBreakdown): ein Balken in Arbeitsgang-Reihenfolge (Warten,
      Bearbeitung, Fremdbearbeitung …), darunter die größten Beiträge; der begrenzende Beitrag („Ursache“) ist betont */
  function delayHTML(d) {
    if (!d || !d.segs || !d.segs.length) return '';
    const tot = d.total || d.segs.reduce((x, e) => x + e.sec, 0) || 1;
    const K = (k) => DLY[k] || { l: k, c: 'var(--muted)' };
    const bar = d.segs.map(e => `<i class="k-${esc(e.kind)}${e.lim ? ' lim' : ''}" style="--c:${K(e.kind).c};width:${(e.sec / tot * 100).toFixed(2)}%" title="${esc(uc1(e.label) + ': ' + durR(e.sec))}"></i>`).join('');
    const rows = (d.top || []).map(e => `<div class="r${e.lim ? ' lim' : ''}" style="--c:${K(e.kind).c}"><i class="k-${esc(e.kind)}"></i><span class="t">${inline(uc1(e.label))}</span><b>${esc(durR(e.sec))}</b></div>`).join('');
    return `<div class="ai-dly"><div class="ai-dly-h"><span class="tt">Restlaufzeit bis zur Prognose${d.eta != null ? ' ' + esc(tc(d.eta)) : ''}</span><span class="tot">${esc(durR(tot))}</span></div><div class="ai-dly-bar" role="img" aria-label="Restlaufzeit nach Ursache">${bar}</div>${rows ? `<div class="ai-dly-l">${rows}</div>` : ''}</div>`;
  }
  /** Offene Meldungen: Schwere als Farbstreifen (WF.SEV), Zeit (notifTime), Rolle, Titel, Empfehlung, Bezug */
  function notifsHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-nts">${list.map(n => `<div class="ai-nt${n.ack ? ' ack' : ''}" style="--c:${(WF.SEV[n.sev] || WF.SEV.info).color}">
      <div class="mt"><span class="sv">${esc(n.sevL)}${n.ack ? ' · quittiert' : ''}</span><span class="tw">${esc(n.time)}${n.role ? ' · ' + esc(n.role) : ''}</span>${n.ent ? `<span class="en">${entChip(n.ent.kind, n.ent.id)}</span>` : ''}</div>
      <div class="tt">${esc(n.title)}</div>${n.sug ? `<div class="sg">${inline(uc1(n.sug))}</div>` : ''}</div>`).join('')}</div>`;
  }
  /** Arbeitsplätze nebeneinander: Zustand (gleiche Pill wie überall), Auftrag, Kennzahlen heute */
  function cmpHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-cmp">${list.map(r => `<div class="ai-cm">
      <div class="h">${entChip('machine', r.id)}<span class="n">${esc(r.short)}</span>${r.pill}</div>
      <div class="o">${inline(r.order)}</div>${r.cause ? `<div class="c">${inline(r.cause)}</div>` : ''}
      <div class="k"><span><small>OEE heute</small><b class="${r.oeeC}">${esc(r.oee)}</b></span><span><small>Stillstand</small><b>${esc(r.loss)}</b></span><span><small>Frei ab</small><b>${esc(r.free)}</b></span></div></div>`).join('')}</div>`;
  }
  /** Wechselplan als Zeitleiste: geplant (gefüllt) / voraussichtlich (gestrichelt), Schneide wenden heller – wie die Werkzeuge-Ansicht */
  function tplanHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-tp">${list.map(r => r.more ? `<div class="ai-tp-more">+ ${esc(r.more)} weitere in der Werkzeuge-Ansicht</div>` : `<div class="ai-tpr${r.kind === 'proj' ? ' proj' : ''}${r.index ? ' idx' : ''}${r.warn ? ' warn' : ''}">
      <span class="tm">${esc(r.tTxt)}</span><span class="nd"></span>
      <div class="bd"><div class="h">${entChip('machine', r.machine)}<span class="n">${esc(r.short)}</span><span class="tg">${r.kind === 'proj' ? 'voraussichtlich' : 'geplant'}</span></div>
        <div class="w"><b>${esc(r.what)}</b> ${esc(r.tools)} · nach Teil ${esc(r.after)}</div>
        <div class="s">${esc(r.who)}${r.waitTxt ? ` · <span class="wt">Maschine ${esc(r.waitTxt)}</span>` : ''}</div></div></div>`).join('')}</div>`;
  }
  /** Bezug, den Claude öffnen wollte – als Link unter der Antwort (das Panel bleibt offen) */
  function offerEntity(m, kind, id) {
    if (!m || !m.extra) return;
    let box = m.extra.querySelector('.ai-offer');
    if (!box) { box = WF.ui.el('div', { class: 'ai-more ai-offer' }); m.extra.prepend(box); }
    if (box.querySelector(`[data-ent-id="${CSS && CSS.escape ? CSS.escape(id) : id}"]`)) return;
    box.insertAdjacentHTML('beforeend', `<button type="button" class="ai-mb" data-ent-k="${esc(kind)}" data-ent-id="${esc(id)}">${icon(kind === 'order' ? 'list' : kind === 'machine' ? 'factory' : kind === 'person' ? 'user' : kind === 'material' ? 'box' : 'arrowRight', 13)}${esc(id)} öffnen</button>`);
  }
  const SLOT_HTML = { route: routeHTML, tools: toolsHTML, crew: crewHTML, stock: stockHTML, risk: riskHTML, bars: barsHTML, delay: delayHTML, notifs: notifsHTML, cmp: cmpHTML, tplan: tplanHTML, today: () => '' };
  /** Grafiken, die Claude im Live-Modus per eigener Zeile „[[route FA-24118]]“ einbetten kann – aus denselben Bausteinen wie der Offline-Copilot */
  function embedHTML(kind, id) {
    const c = data(), slotOf = (a, k) => (a && a.slots && a.slots[k] ? (SLOT_HTML[k] || SLOT_HTML[k.replace(/\d+$/, '')])(a.slots[k].data) : '');
    const oid = String(id || '').toUpperCase().replace(/^FA(\d)/, 'FA-$1').replace(/^(\d{5})$/, 'FA-$1'), mid = normMachineId(id);
    switch (kind) {
      case 'route': case 'auftrag': return S().orders[oid] ? slotOf(ansOrder(c, oid), 'route') : '';
      case 'werkzeuge': case 'tools': return mid ? slotOf(ansMachine(c, mid, 'tools'), 'tools') : '';
      case 'termine': { const a = ansRisk(c); return a.impact ? impactHTML(a.impact) : ''; }
      case 'risiko': return slotOf(ansRisk(c), 'risk');
      case 'engpass': return slotOf(ansBottleneck(c), 'bars3');
      case 'verluste': { const a = ansLoss(c); return slotOf(a, 'bars2') || slotOf(a, 'bars1'); }
      case 'ursachen': return slotOf(ansLoss(c), 'bars1');
      case 'material': return slotOf(ansMaterial(c), 'stock');
      case 'personal': return slotOf(ansPeople(c), 'crew');
      case 'maschine': { if (!mid) return ''; const a = ansMachine(c, mid, 'full'); return a.stats ? statsHTML(a.stats) : ''; }
      default: return '';
    }
  }
  const durShort = (sec) => durR(sec);
  function sourcesHTML(src) {
    if (!src || !src.length) return '';
    return `<div class="ai-src">${icon('layers', 13)}<span><b>Datenbasis:</b> ${src.map(x => esc(x)).join(' · ')}</span></div>`;
  }
  function followHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="ai-fu">${list.slice(0, 3).map(s => `<button type="button" class="ai-chip" data-ask="${esc(s)}">${icon('arrowRight', 12)}${esc(s)}</button>`).join('')}</div>`;
  }
  /** Bestätigungskarte für Aktionen, die Claude vorschlägt (Live-Modus): „Bestätigen“ → Ergebnis an Claude zurück */
  function actionCard(m, act, opts) {
    const host = m.asks;
    const box = host.querySelector('.ai-acts') || host.appendChild(WF.ui.el('div', { class: 'ai-acts' }));
    const n = WF.ui.el('div', { class: 'ai-act' + (act.danger ? ' danger' : '') + (act.quiet ? ' quiet' : '') });
    n.innerHTML = `<span class="ic">${icon(act.icon || 'bolt', 15)}</span><div style="min-width:0"><div class="t">${esc(act.title || act.label)}</div>${act.desc ? `<div class="d">${esc(act.desc)}</div>` : ''}</div>
      <div class="b"><button type="button" class="btn sm ghost" data-no>Ablehnen</button><button type="button" class="btn sm ${act.danger ? 'danger' : 'primary'}" data-go>${icon('check', 13)}Bestätigen</button></div>`;
    box.append(n);
    scrollEnd(false);
    return new Promise((resolve) => {
      const fin = (cls, html, res) => { n.className = 'ai-act ' + cls; n.querySelector('.b').innerHTML = `<span class="res">${html}</span>`; resolve(res); };
      n.querySelector('[data-go]').onclick = () => {
        const r = runAct(act.action);
        const ok = !(r && r.ok === false);
        fin(ok ? 'ok' : 'fail', `${icon(ok ? 'check' : 'alert', 13)}${esc(ok ? 'Ausgeführt ' + nowLabel() : 'Nicht möglich')}`, { ok, msg: (r && r.msg) || (ok ? 'Ausgeführt' : 'Nicht möglich'), result: r });
        renderSugg(true);
      };
      n.querySelector('[data-no]').onclick = () => fin('no', `${icon('x', 13)}Abgelehnt`, { ok: false, rejected: true, msg: 'Vom Nutzer abgelehnt' });
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => { if (n.querySelector('[data-go]')) fin('no', `${icon('x', 13)}Abgebrochen`, { ok: false, rejected: true, msg: 'Abgebrochen' }); });
    });
  }
  /** Aktion ausführen – über WF.app.runAction (eine Stelle für Meldungen, Leitstand und Copilot) */
  function runAct(action) {
    if (!action) return { ok: false, msg: 'Keine Aktion' };
    ADVC = { t: -1, m: {} };
    if (action.type === 'select' || action.type === 'open') { UI.openEntity(action.kind, action.id); return { ok: true, msg: 'Geöffnet' }; }
    if (action.type === 'ackMany') { let n = 0; for (const id of action.ids || []) { const r = WF.sim.actions.ack(id, 'Schichtleitung'); if (r && r.ok) n++; } if (WF.app && WF.app.toast) WF.app.toast(n ? pl(n, 'Meldung', 'Meldungen') + ' quittiert' : 'Keine Meldung mehr offen', n ? 'ok' : 'warn'); return { ok: n > 0, msg: n ? pl(n, 'Meldung', 'Meldungen') + ' quittiert' : 'Keine Meldung mehr offen' }; }
    if (action.type === 'navigate') { if (WF.app) WF.app.navigate(action.view, action.params); return { ok: true, msg: 'Ansicht ' + VIEW_TITLE(action.view) + ' geöffnet' }; }
    if (action.type === 'explain') { setTimeout(() => { WF.ai.explainNotification(action.id); }, 0); return { ok: true, msg: 'Analyse folgt unten' }; }
    let r;
    try { r = WF.app && WF.app.runAction ? WF.app.runAction(action) : WF.sim.runAction(action); } catch (e) { r = { ok: false, msg: e.message }; }
    return r;
  }
  /** Kopf der Antwort: Bezugszeile (eyebrow), Kernaussage, 2–4 Kennzahlen; bei Szenarien/Störung gleich das Termin-Diagramm */
  const TOP_IMPACT = { whatif: 1, fault: 1, ext: 1 };
  function topHTML(a) {
    let h = '';
    if (a.eyebrow) h += `<div class="ai-eb"><i></i><span>${esc(a.eyebrow)}</span></div>`;
    if (a.head) h += `<h3 class="ai-hl">${inline(a.head, true)}</h3>`;
    if (a.stats && a.stats.length) h += statsHTML(a.stats.slice(0, 4));
    if (a.impact && !a.impact.hidden && TOP_IMPACT[a.kind]) h += impactHTML(a.impact);
    return h;
  }
  /** Empfehlung mit den zugehörigen Aktionen (Handlung ausführen = WF.app.runAction), Nebenaktionen leise darunter */
  function recHTML(a) {
    const acts = a.actions || [];
    const prim = acts.filter(x => !x.quiet && !x.danger), sec = acts.filter(x => x.quiet || x.danger);
    let h = '';
    if (a.rec || prim.length) {
      const lab = a.rec ? a.rec.label : 'Vorschlag';
      h += `<div class="ai-rec${lab === 'Hinweis' ? ' note' : ''}"><div class="ai-rec-h">${icon(lab === 'Hinweis' ? 'info' : lab === 'Einschätzung' ? 'check' : 'target', 13)}${esc(lab)}</div>${a.rec ? `<div class="ai-rec-t">${inline(a.rec.text)}</div>` : ''}`;
      if (prim.length) h += `<div class="ai-ras">${prim.map((x, i) => `<div class="ai-ra" data-ai-act="${acts.indexOf(x)}"><span class="ic">${icon(x.icon || 'bolt', 14)}</span><span class="tx"><b>${esc(x.label)}</b>${x.desc ? `<small>${esc(x.desc)}</small>` : ''}</span><span class="b"><button type="button" class="btn sm ${i === 0 ? 'primary' : ''}" data-run="${acts.indexOf(x)}">Ausführen</button></span></div>`).join('')}</div>`;
      h += '</div>';
    }
    if (sec.length) h += `<div class="ai-more">${sec.map(x => `<button type="button" class="ai-mb${x.danger ? ' danger' : ''}" data-run="${acts.indexOf(x)}" title="${esc(x.desc || '')}">${icon(x.icon || 'arrowRight', 13)}${esc(x.label)}</button>`).join('')}</div>`;
    return h;
  }
  function finishExtras(m, a) {
    let html = '';
    if (a.impact && !a.impact.hidden && !TOP_IMPACT[a.kind]) html += impactHTML(a.impact);
    html += recHTML(a);
    html += sourcesHTML(a.sources);
    m.extra.insertAdjacentHTML('beforeend', html);
    m.extra.classList.add('ai-in');
    m.actions = a.actions || [];
    m.after.innerHTML = followHTML(a.followups);
    m.followups = a.followups || [];
    scrollEnd(false);
  }
  /** Aktion aus der Empfehlung ausführen; Ergebnis bleibt sichtbar an der Zeile */
  function runFromCard(m, idx, btn) {
    const act = m.actions && m.actions[idx]; if (!act) return;
    const r = runAct(act.action), ok = !(r && r.ok === false);
    const row = btn.closest('.ai-ra');
    const res = `<span class="res ${ok ? 'ok' : 'fail'}">${icon(ok ? 'check' : 'alert', 13)}${esc(ok ? (act.action.type === 'select' || act.action.type === 'navigate' ? 'Geöffnet' : act.action.type === 'explain' ? 'Analyse unten' : 'Ausgeführt ' + nowLabel()) : 'Nicht möglich')}</span>`;
    if (row) { row.classList.add(ok ? 'done' : 'fail'); row.querySelector('.b').innerHTML = res; if (r && r.msg) { const sm = row.querySelector('small'); if (sm) sm.textContent = r.msg; else row.querySelector('.tx').insertAdjacentHTML('beforeend', `<small>${esc(r.msg)}</small>`); } }
    else { btn.disabled = true; btn.classList.add(ok ? 'done' : 'fail'); btn.title = (r && r.msg) || ''; }
    renderSugg(true);
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
    const pending = addAssistant('KI'); setTyping(pending, 'Verbinde …');
    const s = await Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 3500)), new Promise(r => ctl.signal.addEventListener('abort', () => r(null)))]);
    pending.el.remove(); conv.msgs.splice(conv.msgs.indexOf(pending), 1);
    if (s === 'timeout') { conv.pendingNote = 'Die Verbindung zu Claude wird noch aufgebaut – diese Antwort kommt lokal aus den Live-Daten.'; return null; }
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
        if (note) m.asks.insertAdjacentHTML('beforebegin', `<div class="ai-notice">${icon('info', 14)}<span>${esc(note)}</span></div>`);
        m.card.className = 'ai-card sev-' + (a.sev || 'info');
        m.top.innerHTML = topHTML(a);
        const full = a.display != null ? a.display : a.text;
        m.plain = a.text;
        if (a.slots) { m.slots = {}; for (const k in a.slots) { const f = SLOT_HTML[k] || SLOT_HTML[k.replace(/\d+$/, '')]; m.slots[k] = f ? f(a.slots[k].data) : ''; } }
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
            // lokale Antworten nicht als Claude-Turn ausgeben (Vertrag: keine Worte in Claudes Mund) – als Kontext der Seite
            conv.history.push({ role: 'user', content: text }, { role: 'user', content: 'Regelbasierte Auswertung der Seite (nicht von Claude), zur Information: ' + trimTxt(String(a.text || '').replace(/\*\*/g, ''), 1500) });
            resolve(a);
          }
        };
        tick();
      }, 280 + Math.random() * 220);
    });
  }
  /** Live: Claude mit leitender Anweisung, Verlauf und Werkzeugen */
  async function askLive(sample, text, context, ctl, noTools) {
    const m = addAssistant('KI');
    const toolSet = live.tools && !noTools ? toolList() : [];
    const turns = [{ role: 'user', content: instructions(context, toolSet) }];
    const hist = conv.history.slice(-10).map(x => ({ role: x.role, content: trimTxt(x.content, 3000) }));
    for (const x of hist) turns.push(x);
    turns.push({ role: 'user', content: text });
    const opts = {
      signal: ctl.signal,
      modelTier: pickTier(text),
      onText: ({ text: tx }) => { m.text = tx; renderBody(m, true); },
    };
    if (toolSet.length) {
      opts.tools = toolSet.map(tl => ({
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
          try { const out = tl.run(input, { m }); chip.done(true, out && out.angeboten ? 'Als Link angeboten: ' + (input.id || '') : lb.replace(/^Liest /, 'Gelesen: ').replace(/^Öffnet /, 'Geöffnet: ')); return out; }
          catch (e) { chip.done(false, lb + ' – Fehler'); throw e; }
        },
      }));
    } else opts.cache = false;
    try {
      const r = await sample(turns, opts);
      m.text = r.text; renderBody(m, false); m.status = 'done'; showCopy(m);
      if (r.truncated) m.extra.insertAdjacentHTML('beforeend', `<div class="ai-err">${icon('info', 14)}<div>Antwort wurde gekürzt (Längenlimit). Für Details gezielter nachfragen.</div></div>`);
      m.extra.insertAdjacentHTML('beforeend', sourcesHTML(['Claude' + (r.modelTierApplied ? ' (' + (r.modelTierApplied === 'quick' ? 'schnell' : r.modelTierApplied === 'complex' ? 'ausführlich' : 'Standard') + ')' : ''), 'Lageübersicht ' + U.fmtClock(NOW()), live.tools ? 'Live-Datenabfragen' : 'ohne Datenabfragen']));
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
      if (code === 'tools_unavailable' && toolSet.length) {
        // Datenabfragen hier nicht verfügbar: genau ein Aufruf ohne Tools (vom Nutzer ausgelöst, keine Schleife)
        live.tools = false; live.reason = 'Claude antwortet aus der Lageübersicht (ohne Datenabfragen in dieser Ansicht).'; emitStatus();
        m.el.remove(); conv.msgs.splice(conv.msgs.indexOf(m), 1);
        return askLive(sample, text, context, ctl, true);
      }
      if (PERMANENT[code]) {
        goOffline(PERMANENT[code] + ' – Antworten kommen lokal aus den Live-Daten.', true);
        m.el.remove(); conv.msgs.splice(conv.msgs.indexOf(m), 1);
        return askOffline(text, context, ctl, `${PERMANENT[code]} – Antwort lokal aus den Live-Daten.`);
      }
      if (code === 'invalid_request' && live.tools) { live.tools = false; emitStatus(); }
      const msg = code === 'invalid_request' && !toolSet.length ? 'Die Anfrage an Claude war ungültig – bitte anders formulieren oder erneut senden.' : ERR[code] || ERR.upstream_error;
      const btns = NO_RETRY[code]
        ? `<button type="button" class="btn sm" data-rephrase="${esc(text)}">${icon('file', 13)}Frage umformulieren</button><button type="button" class="btn sm ghost" data-offline="${esc(text)}">Lokale Antwort anzeigen</button>`
        : `<button type="button" class="btn sm" data-retry="${esc(text)}">${icon('refresh', 13)}Erneut senden</button><button type="button" class="btn sm ghost" data-offline="${esc(text)}">Lokale Antwort anzeigen</button>`;
      m.extra.insertAdjacentHTML('beforeend', `<div class="ai-err">${icon('alert', 15)}<div>${esc(msg)}<div class="b">${btns}</div></div></div>`);
      if (!m.text && !m.body.innerHTML) m.body.innerHTML = '';
      scrollEnd(false);
      return null;
    }
  }

  function showCopy(m) { const b = m.el && m.el.querySelector('.ai-copy'); if (b && m.text) b.hidden = false; }
  /** Antwort als Klartext (Markdown ohne Sternchen) – z. B. Schichtübergabe in E-Mail/Schichtbuch übernehmen */
  function copyMsg(id, btn) {
    const m = conv.msgs.find(x => String(x.id) === String(id)); if (!m) return;
    const plain = (m.plain || m.text).replace(/^\[\[[^\]\n]+\]\]\s*$/gm, '').replace(/\*\*/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^~\s+/gm, '').replace(/^>\s?/gm, '');
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
    if (t.dataset.run != null) { const mEl = t.closest('.ai-m'), m = mEl && conv.msgs.find(x => String(x.id) === mEl.dataset.mid); if (m && !t.disabled) runFromCard(m, Number(t.dataset.run), t); return; }
    if (t.classList.contains('ai-ent') && t.dataset.k) { UI.openEntity(t.dataset.k, t.dataset.id); return; }
    if (t.dataset.entK) { UI.openEntity(t.dataset.entK, t.dataset.entId); return; }
    if (t.hasAttribute('data-ctxx')) { conv.context = null; renderCtx(); renderSugg(true); return; }
    if (t.dataset.retry) { if (!conv.busy) send(t.dataset.retry, conv.context); return; }
    if (t.dataset.rephrase) { R.input.value = t.dataset.rephrase; autoGrow(); R.send.disabled = false; try { R.input.focus(); R.input.select(); } catch (e2) { /* */ } return; }
    if (t.dataset.offline) { if (conv.busy) return; const ctl = new AbortController(); conv.ctl = ctl; setBusy(true); askOffline(t.dataset.offline, conv.context, ctl, 'Lokale Antwort (regelbasiert, aus denselben Live-Daten).').finally(() => { setBusy(false); conv.ctl = null; }); }
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
    // Detail in der App geöffnet und kein Platz daneben: der Copilot würde es verdecken – also Platz machen
    if (openState && p && p.kind && p.id && !selfSelect && !roomBeside()) { setTimeout(() => { if (openState && drawerOpen() && !conv.busy && !roomBeside()) UI.close(); }, 0); }
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
  // Prognose-Verlauf mitschreiben (für „vorher/nachher“ bei Störungen) – liest nur die gecachte Prognose
  setInterval(() => { try { logEta(); } catch (e) { /* optional */ } }, 2000);
  WF.bus.on('sim:reset', () => { etaLog.length = 0; ADVC = { t: -1, m: {} }; });
  // Eigenes Scrollen (Rad, Wischen, Tasten) beendet das Mitlaufen bis zur nächsten Frage
  const pin = () => { if (R.log) for (const ev of ['wheel', 'touchmove', 'keydown']) R.log.addEventListener(ev, () => { autoScroll = false; }, { passive: true }); };
  // Panel früh aufbauen (unsichtbar), damit der erste Klick sofort reagiert; Claude-Verbindung im Hintergrund prüfen
  const boot = () => { build(); pin(); getSample(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50)); else setTimeout(boot, 50);
})();
