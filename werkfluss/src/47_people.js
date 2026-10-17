/* werkfluss – Ansicht „Personal“ (47_people.js) + Detail „person“.
   Schichtkopf (laufende Schicht, Schichtwechsel, nächste Pause, Schichtleitung, Schichtmodell des Tages),
   Kennzahlen, darunter ein Band aus Lageplan (wer ist wo) und offenen Aufgaben ohne Person (wer wäre qualifiziert,
   warum wartet es), dann die Personenkarten der laufenden Schicht als strenges Raster (Zustand + Dauer, Tätigkeit,
   Ort, Aufgabe, Tagesverlauf), die nächste Schicht kompakt und die Qualifikationsmatrix mit Engpass-Analyse
   (laufende Schicht aufgeklappt, andere Schicht einklappbar).
   Nur lesen (WF.sim.state). Der Tagesverlauf je Person wird lokal aufgezeichnet (Engine speichert keine
   Personen-Historie): Stichprobe bei jedem Sim-Ereignis (auch während des Vorrechnens) und alle 250 ms. Je Abschnitt
   wird der Zuwachs des Engine-Zählers workSec mitgeschrieben – die dunkelgrüne Arbeitszeit im Verlauf ist damit
   exakt die Arbeitszeit der Engine (eine Wahrheit mit Kachel „Aufgabenzeit“ und Aufgabenzeit-Anteil).
   Öffentlich: WF.people = { whereOf, qualified, coverage, bottlenecks, timeline, recentTasks, workCheck, displayState }. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;
  const DAY = 86400;

  // ------------------------------------------------------------------ Konstanten
  // Anzeige-Zustände: Engine-Zustand (state), dazu zwei abgeleitete für „idle“ ohne Aufgabe:
  // tending = steht an eigenen, laufenden Maschinen (betreut sie) · lead = Schichtleitung im Leitstand.
  // Beide sind im Einsatz (Kontur statt Fläche: keine Aufgabe, aber nicht „verfügbar“).
  const PST = {
    working: { c: 'var(--st-run)', label: 'Arbeitet' },
    driving: { c: 'var(--mat)', label: 'Fährt Stapler' },
    walking: { c: 'var(--info)', label: 'Unterwegs' },
    tending: { c: 'var(--st-run)', label: 'Betreut Maschinen', o: true },
    lead: { c: 'var(--st-run)', label: 'Schichtleitung', o: true },
    idle: { c: 'var(--st-idle)', label: 'Verfügbar' },
    break: { c: 'var(--st-wait)', label: 'Pause' },
    offShift: { c: 'var(--faint)', label: 'Nicht im Dienst' },
  };
  const PST_ORDER = ['working', 'driving', 'walking', 'tending', 'lead', 'idle', 'break'];
  const BUSY = { working: 1, driving: 1, walking: 1, tending: 1, lead: 1 };
  // Verlauf: je Abschnitt zuerst die Arbeitszeit laut Engine (workSec-Zuwachs: Arbeitsschritte, Staplerfahrten,
  // begleitete Bearbeitung), der Rest nach Zustand – „arbeitet“ ohne Zählerzuwachs = Bereitschaft an der Maschine.
  const SEG = {
    work: { c: 'var(--st-run)', label: 'Aufgabenzeit' },
    standby: { c: 'color-mix(in srgb,var(--st-run) 38%,var(--track))', label: 'Bereitschaft an der Maschine' },
    tend: { c: 'color-mix(in srgb,var(--st-run) 17%,var(--track))', label: 'Betreut laufende Maschinen' },
    lead: { c: 'color-mix(in srgb,var(--st-run) 17%,var(--track))', label: 'Schichtleitung ohne Aufgabe' },
    driving: { c: 'var(--mat)', label: 'Fährt Stapler' },
    walking: { c: 'var(--info)', label: 'Unterwegs' },
    idle: { c: 'var(--st-idle)', label: 'Verfügbar' },
    break: { c: 'var(--st-wait)', label: 'Pause' },
  };
  const SEG_ORDER = ['work', 'standby', 'tend', 'lead', 'driving', 'walking', 'idle', 'break'];
  const TASK_C = {
    setup: 'var(--st-setup)', correction: 'var(--st-setup)', toolChange: 'var(--st-tool)', offset: 'var(--st-tool)',
    fpi: 'var(--info)', inspect: 'var(--info)', repair: 'var(--st-fault)', load: 'var(--st-run)',
    forklift: 'var(--mat)', bars: 'var(--mat)', assembly: 'var(--st-idle)',
  };
  const SKILL = {
    saw: 'Sägen', lathe: 'Drehen', swiss: 'Langdrehen', biglathe: 'Großdrehen', deephole: 'Tiefbohren', hobber: 'Verzahnen',
    mill5: '5-Achs-Fräsen', mill3: '3-Achs-Fräsen', cylgrinder: 'Rundschleifen', surfgrinder: 'Flachschleifen', washer: 'Reinigen',
    setup: 'Einrichten', toolchange: 'Werkzeugwechsel', qs: 'Qualitätsprüfung', forklift: 'Stapler', assembly: 'Montage', repair: 'Instandhaltung', lead: 'Schichtleitung',
  };
  const SKILL_HEAD = {
    saw: 'Sägen', lathe: 'Drehen', swiss: 'Lang&shy;drehen', biglathe: 'Groß&shy;drehen', deephole: 'Tief&shy;bohren', hobber: 'Ver&shy;zahnen',
    mill5: 'Fräsen 5-Achs', mill3: 'Fräsen 3-Achs', cylgrinder: 'Rund&shy;schleifen', surfgrinder: 'Flach&shy;schleifen', washer: 'Reinigen',
    setup: 'Ein&shy;richten', toolchange: 'Werkzeug&shy;wechsel', qs: 'Qualitäts&shy;prüfung', forklift: 'Stapler', assembly: 'Montage', repair: 'Instand&shy;haltung',
  };
  const ACT_COLS = ['setup', 'toolchange', 'qs', 'forklift', 'assembly', 'repair'];
  /** kleine Linien-Icons, die WF.ui.icon nicht kennt (gleiches 24er Raster, gleiche Strichstärke) */
  const SVG = (p, s) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC_PIN = (s = 13) => SVG('<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>', s);
  const IC_TASK = (s = 13) => SVG('<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M9 3.5h6M8.5 10h7M8.5 14h5"/>', s);

  // ------------------------------------------------------------------ Helfer
  const S = () => WF.sim && WF.sim.state;
  const P = () => WF.profile;
  const st = (id) => P().stationById[id];
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const tclock = (t, now) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const mLabel = (id) => { const s = st(id); return s ? (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly' ? id + ' ' + s.short : s.short) : id; };
  const taskLabel = (type) => (WF.sim.LABELS && WF.sim.LABELS.task && WF.sim.LABELS.task[type]) || type;
  const pLabel = (state) => (PST[state] && PST[state].o ? PST[state].label : null) || (WF.sim.LABELS && WF.sim.LABELS.person && WF.sim.LABELS.person[state]) || (PST[state] || {}).label || state;
  const pColor = (state) => (PST[state] || PST.idle).c;
  const pOutline = (state) => !!(PST[state] && PST[state].o);
  const shiftDef = (id) => P().shifts.find(s => s.id === id) || null;
  const shiftName = (id) => (shiftDef(id) || {}).name || id;
  const durMin = (sec) => (sec < 60 ? 'gerade eben' : U.fmtDur(Math.floor(sec / 60) * 60));
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node && node._t !== txt) { node._t = txt; node.textContent = txt; } }
  function setHTML(node, html) { if (node && node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setVar(node, k, v) { const key = '_v' + k; if (node && node[key] !== v) { node[key] = v; node.style.setProperty(k, v); } }
  function setAttr(node, k, v) { const key = '_a' + k; if (node && node[key] !== v) { node[key] = v; if (v == null || v === false) node.removeAttribute(k); else node.setAttribute(k, v === true ? '' : v); } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  const pill = (state, label) => `<span class="pill${pOutline(state) ? ' pe-po' : ''}" style="--c:${pColor(state)}"${label && label.length > 18 ? ` title="${esc(label)}"` : ''}><i></i><span>${esc(label || pLabel(state))}</span></span>`;
  const hasDetail = (k) => !!(WF.details && WF.details[k]);
  /** Text escapen; Kennungen (FA-24117, M02 …) nicht umbrechen */
  const escNb = (t) => esc(t).replace(/\b([A-Z]{1,3}-\d{3,6}(?:\/\d+)?)\b/g, '<span style="white-space:nowrap">$1</span>');

  /** Spalten der Matrix: Maschinen-Qualifikationen in Materialfluss-Reihenfolge (+ zugehörige Maschinen), dann Tätigkeiten */
  let COLS = null;
  function cols() {
    if (COLS) return COLS;
    const mcols = [], seen = {};
    for (const id of P().machines) {
      const s = st(id); if (!s || s.kind !== 'machine' || !s.skill) continue;
      if (!seen[s.skill]) { seen[s.skill] = { key: s.skill, kind: 'm', machines: [] }; mcols.push(seen[s.skill]); }
      seen[s.skill].machines.push(id);
    }
    COLS = mcols.concat(ACT_COLS.map(k => ({ key: k, kind: 'a', machines: [] })));
    return COLS;
  }
  /** Maschinen, an denen gerüstet bzw. Werkzeug gewechselt wird (CNC + Säge + Waschanlage) */
  const cncMachines = () => P().machines.filter(id => { const s = st(id); return s && s.kind === 'machine'; });

  // ------------------------------------------------------------------ Qualifikation (gleiche Regeln wie die Aufgabenvergabe der Engine)
  /** Kann Person p die Aufgabe tk übernehmen? (Spiegel der Vergaberegeln, nur aus Stammdaten) */
  function qualified(p, tk) {
    const mid = tk.machineId, m = mid ? st(mid) : null, sk = p.skills || [], own = (p.machines || []).includes(mid);
    switch (tk.type) {
      case 'setup': case 'correction': case 'offset': return !!(m && sk.includes(m.skill) && (sk.includes('setup') || own));
      case 'load': return !!(m && sk.includes(m.skill));
      case 'toolChange': return sk.includes('toolchange') || !!(m && own && sk.includes(m.skill));
      case 'fpi': if (tk.data && tk.data.local) return sk.includes('qs') || !!(m && sk.includes(m.skill) && (own || sk.includes('setup'))); return sk.includes('qs');
      case 'inspect': return sk.includes('qs');
      case 'assembly': return sk.includes('assembly');
      case 'repair': return sk.includes('repair') || (sk.includes('setup') && !sk.includes('lead'));
      case 'forklift': case 'bars': return sk.includes('forklift');
    }
    return false;
  }
  const canSetup = (pp, mid) => { const m = st(mid); return !!(m && pp.skills.includes(m.skill) && (pp.skills.includes('setup') || pp.machines.includes(mid))); };
  const canTool = (pp, mid) => { const m = st(mid); return pp.skills.includes('toolchange') || !!(m && pp.machines.includes(mid) && pp.skills.includes(m.skill)); };
  /** Stufe einer Person in einer Matrixspalte: stamm | qual | full | own | sub | null */
  function level(pp, col) {
    const sk = pp.skills;
    if (col.kind === 'm') {
      if (!sk.includes(col.key)) return null;
      return col.machines.some(id => pp.machines.includes(id)) ? 'stamm' : 'qual';
    }
    switch (col.key) {
      case 'setup': {
        const n = cncMachines().filter(id => canSetup(pp, id));
        if (!n.length) return null;
        return sk.includes('setup') ? 'full' : 'own';
      }
      case 'toolchange': if (sk.includes('toolchange')) return 'full'; return cncMachines().some(id => canTool(pp, id)) ? 'own' : null;
      case 'repair': if (sk.includes('repair')) return 'full'; return sk.includes('setup') && !sk.includes('lead') ? 'sub' : null;
      default: return sk.includes(col.key) ? 'full' : null;
    }
  }
  function levelTip(pp, col, lv) {
    const nm = pp.name;
    if (!lv) return `${nm}: keine Qualifikation ${SKILL[col.key]}`;
    if (col.kind === 'm') return `${nm}: ${SKILL[col.key]} (${col.machines.map(mLabel).join(', ')}) – ${lv === 'stamm' ? 'Stammarbeitsplatz' : 'qualifiziert, Vertretung'}`;
    if (col.key === 'setup') { const ms = cncMachines().filter(id => canSetup(pp, id)); return `${nm}: Einrichten ${lv === 'full' ? 'aller Maschinen der eigenen Qualifikation' : 'nur an eigenen Maschinen'} (${ms.join(', ')})`; }
    if (col.key === 'toolchange') { if (lv === 'full') return `${nm}: Werkzeugwechsel an allen Maschinen`; return `${nm}: Werkzeugwechsel nur an eigenen Maschinen (${cncMachines().filter(id => canTool(pp, id)).join(', ')})`; }
    if (col.key === 'repair') return lv === 'full' ? `${nm}: Instandhaltung (Fachkraft)` : `${nm}: Instandhaltung vertretend (Einrichter:in springt ein, wenn keine Fachkraft frei ist)`;
    return `${nm}: ${SKILL[col.key]}`;
  }
  /** Abdeckung je Schicht und Spalte: { full:[names], part:[names], flag:null|'warn'|'crit', note } */
  const COV = {};
  function coverage(shiftId) {
    if (COV[shiftId]) return COV[shiftId];
    return (COV[shiftId] = coverage0(shiftId));
  }
  function coverage0(shiftId) {
    const people = P().people.filter(p => p.shift === shiftId);
    const out = {};
    for (const col of cols()) {
      const full = [], part = [];
      for (const pp of people) { const lv = level(pp, col); if (lv === 'own' || lv === 'sub') part.push(pp); else if (lv) full.push(pp); }
      let flag = null, note = '';
      const n = full.length + part.length;
      if (n === 0) { flag = 'crit'; note = `${SKILL[col.key]}: niemand in der ${shiftName(shiftId)} qualifiziert`; }
      else if (n === 1) { flag = 'warn'; note = `${SKILL[col.key]}: nur ${(full[0] || part[0]).name}`; }
      else if (col.kind === 'a' && full.length === 1 && (col.key === 'setup' || col.key === 'toolchange' || col.key === 'repair')) {
        flag = 'warn';
        note = col.key === 'repair' ? `Instandhaltung: Fachkraft nur ${full[0].name} – vertretend ${part.map(x => shortName(x.name)).join(', ')}`
          : col.key === 'setup' ? `Einrichten aller Maschinen: nur ${full[0].name} – sonst rüsten Bediener nur ihre Stammmaschinen`
          : `Werkzeugwechsel an allen Maschinen: nur ${full[0].name} – sonst wechseln Bediener nur an eigenen Maschinen`;
      } else if (col.kind === 'a' && full.length === 0 && part.length) { flag = 'warn'; note = `${SKILL[col.key]}: keine Fachkraft – nur vertretend (${part.map(x => shortName(x.name)).join(', ')})`; }
      // Einrichten/Werkzeugwechsel: Maschinen, die in dieser Schicht nur eine Person bedienen kann
      let weak = [];
      if (col.key === 'setup') weak = cncMachines().map(id => ({ id, who: people.filter(pp => canSetup(pp, id)) })).filter(x => x.who.length <= 1);
      if (col.key === 'toolchange') weak = cncMachines().map(id => ({ id, who: people.filter(pp => canTool(pp, id)) })).filter(x => x.who.length <= 1);
      out[col.key] = { full, part, flag, note, weak };
    }
    return out;
  }
  /** Engpässe je Schicht in Klartext, gruppiert nach Person (Klumpenrisiko) */
  function bottlenecks(shiftId) {
    const cov = coverage(shiftId), items = [], byPerson = {};
    for (const col of cols()) {
      const c = cov[col.key]; if (!c.flag) continue;
      items.push({ key: col.key, flag: c.flag, text: c.note, person: c.full.length === 1 ? c.full[0].id : (c.full.length + c.part.length === 1 ? (c.full[0] || c.part[0]).id : null) });
    }
    for (const it of items) if (it.person) (byPerson[it.person] = byPerson[it.person] || []).push(it);
    return { items, byPerson, cov };
  }

  // ------------------------------------------------------------------ Ort einer Person
  function nearestStation(pos) {
    let best = null, bd = Infinity;
    for (const s of P().stations) {
      const f = s.footprint;
      if (f && pos.x >= f.x && pos.x <= f.x + f.w && pos.z >= f.z && pos.z <= f.z + f.d) return s.id;
      const d = Math.hypot((s.work || s.dock).x - pos.x, (s.work || s.dock).z - pos.z);
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  }
  function placeText(id) {
    if (id === 'CRIB') return 'in der Werkzeugausgabe';
    if (id === 'QS') return 'im Messraum';
    if (id === 'MAINT') return 'in der Instandhaltung';
    if (id === 'OFFICE') return 'im Leitstand / Büro';
    const s = st(id); if (!s) return id;
    if (s.kind === 'machine' || s.kind === 'assembly') return 'an ' + id + ' · ' + s.short;
    return 'bei ' + s.short;
  }
  /** Wo ist die Person? → { text, sid (Station, falls bekannt), moving } */
  function whereOf(p) {
    if (!p) return { text: '–', sid: null };
    if (p.state === 'offShift') return { text: 'nicht im Dienst', sid: null };
    if (p.state === 'break') return { text: 'in der Pause (Pausenraum)', sid: null };
    const tk = p.task, steps = tk && tk.steps, s = steps ? steps[tk.si] : null;
    if (s && (s.k === 'walk' || s.k === 'drive') && (p.state === 'walking' || p.state === 'driving') && s.to) return { text: 'unterwegs zu ' + mLabel(s.to), sid: s.to, moving: true };
    if (s && s.k === 'toForklift') return { text: 'unterwegs zum Stapler', sid: null, moving: true };
    let at = null;
    if (steps) for (let k = Math.min(tk.si, steps.length - 1); k >= 0; k--) if (steps[k] && steps[k].to) { at = steps[k].to; break; }
    if (at) return { text: placeText(at), sid: at };
    if (p.state === 'walking') {
      if (p.goal === 'break') return { text: 'auf dem Weg in die Pause', sid: null, moving: true };
      if (p.goal === 'exit') return { text: 'verlässt die Halle (Feierabend)', sid: null, moving: true };
      if (p.goal === 'home') return { text: 'geht zum Arbeitsplatz', sid: nearestStation(p.home), moving: true };
    }
    const n = nearestStation(p.pos), s0 = st(n);
    if (!s0) return { text: 'in der Halle', sid: null };
    if (s0.room || s0.kind === 'qs') return { text: placeText(n), sid: n };
    return { text: 'bei ' + (s0.kind === 'machine' || s0.kind === 'assembly' ? n + ' · ' + s0.short : s0.short), sid: n };
  }

  // ------------------------------------------------------------------ Anzeige-Zustand (betreut / leitet / verfügbar)
  /** Laufende eigene Maschinen, die eine Person ohne Aufgabe gerade betreut (sie steht an ihrem Arbeitsplatz) – sonst null */
  function tendOf(p) {
    if (!p || p.state !== 'idle' || p.task || p.endShift || p.breakPending || p.onDuty === false) return null;
    const Sx = S(), own = (p.machines || []).filter(id => Sx.machines[id]);
    if (!own.length) return null;
    const run = own.filter(id => Sx.machines[id].state === 'running');
    if (!run.length) return null;
    if (!p.atHome) { const w = whereOf(p); if (!w.sid || !own.includes(w.sid)) return null; }
    return run;
  }
  /** Anzeige-Zustand: Engine-Zustand, „idle“ wird zu tending (betreut laufende eigene Maschinen) bzw. lead (Schichtleitung im Leitstand) */
  function dstate(p) {
    if (!p) return 'offShift';
    if (p.state !== 'idle') return p.state;
    if (tendOf(p)) return 'tending';
    if (!p.task && !p.endShift && !p.breakPending && p.onDuty !== false && (p.skills || []).includes('lead') && whereOf(p).sid === 'OFFICE') return 'lead';
    return 'idle';
  }
  const tendLabel = (run) => 'Betreut ' + run.slice(0, 2).join(' · ') + (run.length > 2 ? ' +' + (run.length - 2) : '');
  /** Nächster Eingriff an einer laufenden Maschine laut Engine (Teilewechsel, geplanter Werkzeugwechsel, Arbeitsgangende) – je 15 Sim-s gecacht */
  const NX = {};
  function nextStep(mid, now) {
    const k = Math.floor(now / 15), c = NX[mid];
    if (c && c.k === k) return c.v;
    let mv = null; try { mv = WF.sim.machineView(mid); } catch (e) { mv = null; }
    const cand = [];
    if (mv && mv.state === 'running') {
      if (mv.loading === 'perPart' && mv.partEndT != null) cand.push({ t: mv.partEndT, what: 'Teilewechsel' });
      for (const tl of mv.tools || []) { const pc = tl.plannedChange; if (pc && pc.etaT != null) cand.push({ t: pc.etaT, what: pc.action === 'index' ? 'Schneide wenden' : 'Werkzeugwechsel' }); }
      if (mv.etaOpEnd != null) cand.push({ t: mv.etaOpEnd, what: 'Arbeitsgang fertig' });
    }
    cand.sort((a, b) => a.t - b.t);
    const v = cand[0] ? Object.assign({ mid }, cand[0]) : null;
    NX[mid] = { k, v };
    return v;
  }
  /** Tätigkeitstext je Anzeige-Zustand (Karten, Drawer, Karte) */
  function actText(p, ds, now, prev, short) {
    let act = p.activity || '';
    if (p.state === 'break' && p.breakUntil) act = `Pause bis ${U.fmtClock(p.breakUntil)}${p.breakMakeup ? ' (holt die Pause nach)' : ''}`;
    if (ds === 'tending') {
      const run = tendOf(p) || [];
      let nx = null;
      for (const mid of run) { const v = nextStep(mid, now); if (v && (!nx || v.t < nx.t)) nx = v; }
      const what = run.length === 1 ? `Überwacht ${run[0]}` : `Überwacht ${run.length} Maschinen`, when = nx ? tclock(Math.max(nx.t, now), now) : '';
      // Karte: die Pill nennt schon die Maschinen – dort nur der nächste Eingriff
      act = short ? (nx ? `Nächster Eingriff ca. ${when}: ${nx.what}${run.length > 1 ? ' ' + nx.mid : ''}` : 'Maschinen laufen autonom')
        : nx ? `${what} – nächster Eingriff ca. ${when} (${nx.what}${run.length > 1 ? ' ' + nx.mid : ''})` : `${what} – laufen autonom`;
    } else if (ds === 'lead') act = 'Schichtleitung im Leitstand – übernimmt bei Bedarf Rüsten und Werkzeugwechsel';
    else if (p.state === 'idle' && !p.task) act = p.endShift ? 'Schichtende – geht gleich' : p.breakPending ? 'Geht gleich in die Pause'
      : (p.skills || []).includes('repair') ? 'Bereit für Störungen und Instandhaltung' : 'Wartet auf die nächste Aufgabe';
    if (prev) act = (p.task ? 'Beendet noch die Aufgabe: ' : '') + act;
    return act;
  }

  // ------------------------------------------------------------------ Tagesverlauf (lokale Aufzeichnung)
  const LOG = {};           // personId → [{t0, t1, s, ss, k (taskId), ty, lb, m, o, a, w (workSec-Zuwachs der Engine in diesem Abschnitt)}]
  const SEEN = {};          // taskId → {t, by}: zuletzt einer Person zugeteilt gesehen (für zurückgegebene Aufgaben)
  const LASTW = {};         // personId → workSec bei der letzten Stichprobe
  let lastT = -1;
  function resetLog() { for (const k in LOG) delete LOG[k]; for (const k in SEEN) delete SEEN[k]; for (const k in LASTW) delete LASTW[k]; lastT = -1; }
  function segState(p, Sx) {
    if (p.state === 'idle') { const ds = dstate(p); return ds === 'tending' ? 'tend' : ds === 'lead' ? 'lead' : 'idle'; }
    if (p.state !== 'working') return p.state;
    if (p.workRem > 0) return 'work';
    const tk = p.task, s = tk && tk.steps ? tk.steps[tk.si] : null;
    if (s && s.k === 'attend') { const m = tk.machineId ? Sx.machines[tk.machineId] : null; return m && m.part ? 'work' : 'standby'; }
    return s && (s.k === 'wait' || s.k === 'hold') ? 'standby' : 'work';
  }
  const sColor = (ss) => (SEG[ss] || SEG.idle).c;
  function sample() {
    const Sx = S(); if (!Sx || !Sx.people) return;
    const t = Sx.t; if (t === lastT) return;
    if (t < lastT) resetLog();
    lastT = t;
    for (const id in Sx.people) {
      const p = Sx.people[id], tk = p.task;
      const arr = LOG[id] || (LOG[id] = []);
      const last = arr[arr.length - 1];
      // Arbeitszeit-Zuwachs seit der letzten Stichprobe gehört zum bis jetzt laufenden Abschnitt (Tageswechsel: Zähler beginnt bei 0)
      const ws = p.workSec || 0, pw = LASTW[id];
      LASTW[id] = ws;
      if (last && pw != null) { const dw = ws >= pw ? ws - pw : ws; if (dw > 0) last.w = (last.w || 0) + dw; }
      const k = tk ? tk.id : null, ss = segState(p, Sx);
      if (tk) SEEN[tk.id] = { t, by: id };
      if (last && last.s === p.state && last.k === k && last.ss === ss) { last.t1 = t; continue; }
      if (last) last.t1 = t;
      if (p.state === 'offShift' && (!last || last.s === 'offShift')) { if (!last) arr.push({ t0: t, t1: t, s: 'offShift', k: null, w: 0 }); continue; }
      arr.push({ t0: t, t1: t, s: p.state, ss, k, ty: tk ? tk.type : null, lb: tk ? tk.label : null, m: tk ? tk.machineId : null, o: tk ? tk.orderId : null, a: p.activity || '', w: 0 });
      if (arr.length > 1600) arr.splice(0, arr.length - 1600);
    }
  }
  WF.bus.on('sim:event', (e) => { if (e && e.type === 'reset') resetLog(); sample(); });
  WF.bus.on('sim:notify', sample);
  WF.bus.on('sim:reset', sample);
  setInterval(sample, 250);

  function timeline(pid, t0, t1) {
    const arr = LOG[pid] || [];
    return arr.filter(x => x.t1 > t0 && x.t0 < t1).map(x => {
      const a = Math.max(t0, x.t0), b = Math.min(t1, x.t1), full = x.t1 - x.t0;
      // beim Abschneiden am Fensterrand die Arbeitszeit anteilig mitnehmen
      const w = full > 0 ? (x.w || 0) * Math.min(1, (b - a) / full) : 0;
      return { t0: a, t1: b, state: x.s, seg: x.ss || x.s, task: x.ty, label: x.lb, machineId: x.m, orderId: x.o, activity: x.a, w };
    });
  }
  /** Abschnitt → Teilstücke für Verlauf und Summen: Arbeitszeit (Engine) zuerst, danach der Rest nach Zustand */
  function pieces(x) {
    const d = x.t1 - x.t0; if (d <= 0 || x.state === 'offShift') return [];
    const wk = U.clamp(x.w || 0, 0, d);
    const rest = x.state === 'working' ? 'standby' : x.seg === 'tend' || x.seg === 'lead' ? x.seg : x.state === 'driving' ? 'driving' : (SEG[x.state] ? x.state : 'idle');
    const out = [];
    if (wk > 0) out.push({ t0: x.t0, t1: x.t0 + wk, k: x.state === 'driving' ? 'driving' : 'work', work: true });
    if (d - wk > 0) out.push({ t0: x.t0 + wk, t1: x.t1, k: rest, work: false });
    return out;
  }
  /** Summen je Kategorie im Fenster; work = Arbeitszeit ohne Stapler, fork = Staplerfahrten (beides zählt als Arbeitszeit) */
  function totals(tl) {
    const tot = { work: 0, fork: 0 };
    for (const x of tl) for (const q of pieces(x)) {
      if (q.work) { if (q.k === 'driving') tot.fork += q.t1 - q.t0; else tot.work += q.t1 - q.t0; }
      else tot[q.k] = (tot[q.k] || 0) + (q.t1 - q.t0);
    }
    return tot;
  }
  /** zuletzt bearbeitete Aufgaben (aus der Aufzeichnung): [{id, type, label, machineId, orderId, t0, t1, active}] */
  function recentTasks(pid, n = 10) {
    const arr = LOG[pid] || [], map = new Map();
    for (const x of arr) {
      if (!x.k) continue;
      let r = map.get(x.k);
      if (!r) { r = { id: x.k, type: x.ty, label: x.lb, machineId: x.m, orderId: x.o, t0: x.t0, t1: x.t1, work: 0 }; map.set(x.k, r); }
      r.t1 = Math.max(r.t1, x.t1);
      r.work += x.w || 0;
    }
    const p = S().people[pid];
    const list = [...map.values()].sort((a, b) => b.t0 - a.t0).slice(0, n);
    for (const r of list) r.active = !!(p && p.task && p.task.id === r.id);
    return list;
  }
  /** Prüfhilfe: Arbeitszeit laut Engine vs. dunkelgrüner Anteil des Verlaufs heute (Sekunden) */
  function workCheck(pid) {
    const Sx = S(), p = Sx && Sx.people[pid]; if (!p) return null;
    sample();
    const d0 = Math.floor(Sx.t / DAY) * DAY, tot = totals(timeline(pid, d0, Sx.t + 1));
    return { engine: p.workSec || 0, band: Math.round(tot.work + tot.fork) };
  }

  // ------------------------------------------------------------------ Schicht
  function shiftLead(shiftId) {
    const people = P().people.filter(p => p.shift === shiftId);
    const lead = people.find(p => p.skills.includes('lead') || /schichtleit/i.test(p.role));
    if (lead) return { p: lead, label: 'Schichtleitung', note: lead.role };
    const setter = people.find(p => /einricht/i.test(p.role));
    if (setter) return { p: setter, label: 'Schichtverantwortung', note: setter.role + ' (keine Schichtleitung eingeteilt)' };
    return null;
  }
  /** nächste Schicht nach der laufenden (bzw. nach der Geisterschicht) → { def, startT } */
  function nextShift(sh, now) {
    const SH = P().shifts.map(s => ({ s, a: U.hm(s.start), b: U.hm(s.end) }));
    let t = sh.id ? sh.endsAt : sh.endsAt;
    if (sh.id) {
      const nx = SH.find(x => x.a === t % DAY && x.s.id !== sh.id);
      if (nx) return { def: nx.s, startT: t };
      // letzte Schicht des Tages → erste Schicht des nächsten Arbeitstags
      let d = Math.floor(now / DAY) + 1; while (d % 7 >= 5) d++;
      const first = SH.slice().sort((a, b) => a.a - b.a)[0];
      return { def: first.s, startT: d * DAY + first.a };
    }
    const x = SH.find(y => y.a === t % DAY) || SH[0];
    return { def: x.s, startT: t };
  }
  function breakInfo(sh, now) {
    const def = sh.id ? shiftDef(sh.id) : null;
    if (!def) return null;
    const d = Math.floor(now / DAY) * DAY, s = now - d;
    if (sh.inBreak) {
      const b = def.breaks.find(x => s >= U.hm(x[0]) && s < U.hm(x[1]));
      return { now: true, a: d + U.hm(b[0]), b: d + U.hm(b[1]) };
    }
    const b = def.breaks.find(x => U.hm(x[0]) > s);
    return b ? { now: false, a: d + U.hm(b[0]), b: d + U.hm(b[1]) } : null;
  }

  // ------------------------------------------------------------------ CSS (Präfix .pe-)
  WF.ui.css(`
  .pe-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .pe-root .view-h{margin-bottom:0}
  .pe-sh{display:flex;flex-direction:column;gap:14px;padding:12px 14px 12px}
  .pe-facts{display:grid;grid-template-columns:minmax(0,1.25fr) repeat(3,minmax(0,1fr));gap:0;border:1px solid var(--line);border-radius:9px;background:var(--bg2);overflow:hidden}
  .pe-f{display:flex;align-items:center;gap:10px;padding:9px 13px;min-width:0}
  .pe-f + .pe-f{border-left:1px solid var(--line)}
  .pe-f .eyebrow{display:block;margin-bottom:4px}
  .pe-f b{display:block;font-weight:600;font-size:var(--fs-md);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-f small{display:block;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .pe-f > div{min-width:0}
  .pe-f .pe-dot{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent);flex:none}
  .pe-f .pe-ic{flex:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--c,var(--muted));background:color-mix(in srgb,var(--c,var(--muted)) 12%,transparent)}
  .pe-f .avatar{width:30px;height:30px}
  .pe-f.click{cursor:pointer}.pe-f.click:hover b{text-decoration:underline;text-underline-offset:2px}

  /* Schichtmodell des Tages: Beschriftung über dem Balken, Jetzt-Marke in der Zeitachse – nichts überdeckt sich */
  .pe-tl{position:relative;padding:0 1px}
  .pe-tl-cap{position:relative;height:17px;margin-bottom:5px}
  .pe-tl-c{--c:var(--st-setup);position:absolute;top:0;display:flex;align-items:baseline;gap:7px;padding-left:1px;white-space:nowrap;overflow:hidden;font-size:var(--fs-xs);color:var(--muted)}
  .pe-tl-c b{font-weight:600;color:var(--text2)}
  .pe-tl-c em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--faint)}
  .pe-tl-c i{font-style:normal;display:inline-flex;align-items:center;gap:5px;color:var(--st-run);font-weight:600;font-size:var(--fs-xs)}
  .pe-tl-c i::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--st-run);box-shadow:0 0 0 3px color-mix(in srgb,var(--st-run) 20%,transparent)}
  .pe-tl-c.cur b{color:var(--text)}
  .pe-tl-tr{position:relative;height:14px;border-radius:5px;background:var(--track)}
  .pe-tl-sh{position:absolute;top:0;bottom:0;border-radius:5px;background:color-mix(in srgb,var(--c) 22%,var(--card2));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 34%,transparent)}
  .pe-tl-sh.cur{background:color-mix(in srgb,var(--c) 42%,var(--card2));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 60%,transparent)}
  .pe-tl-br{position:absolute;top:2px;bottom:2px;border-radius:3px;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--st-wait) 70%,transparent) 0 2.5px,transparent 2.5px 5px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--st-wait) 55%,transparent)}
  .pe-tl-past{position:absolute;left:0;top:0;bottom:0;border-radius:5px 0 0 5px;background:color-mix(in srgb,var(--bg) 50%,transparent);pointer-events:none}
  .pe-tl-now{position:absolute;top:-4px;bottom:-9px;width:0;border-left:2px solid var(--accent);pointer-events:none;box-shadow:0 0 8px color-mix(in srgb,var(--accent) 60%,transparent)}
  .pe-tl-ax{position:relative;height:16px;margin-top:6px;font:500 var(--fs-2xs)/16px var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-tl-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .pe-tl-ax span.s0{transform:none}.pe-tl-ax span.s1{transform:translateX(-100%)}
  .pe-tl-ax span.now{z-index:1;font-weight:600;padding:0 6px;border-radius:5px;background:var(--accent);color:var(--accent-ink)}
  .pe-tl-note{font-size:var(--fs-sm);color:var(--muted);margin-top:4px}

  /* Kennzahlen: Standard-Kachel (.kpi), nur Klickbarkeit und Verteilungsbalken sind modulspezifisch */
  .pe-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
  .pe-kpis .kpi.click{cursor:pointer}
  .pe-kpis .kpi.click:hover{border-color:var(--line2)}
  .pe-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .pe-dist{display:flex !important;height:6px;gap:2px;margin-top:auto;padding-top:0 !important}
  .pe-dist-w{margin-top:auto;padding-top:8px}
  .pe-dist i{display:block;height:6px;background:var(--c);min-width:3px;border-radius:2px}
  .pe-dist i.o{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}

  /* Kontur-Pill: im Einsatz ohne Aufgabe (betreut Maschinen, leitet die Schicht) */
  .pill.pe-po{background:transparent;border-color:color-mix(in srgb,var(--c) 60%,transparent)}
  .pill.pe-po i{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}
  .pill > span{min-width:0;overflow:hidden;text-overflow:ellipsis}

  /* Band: Lageplan + offene Aufgaben (gleich hoch, Liste scrollt in sich) */
  .pe-band{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:stretch}
  .pe-band > .card{display:flex;flex-direction:column;min-width:0}
  .pe-qcard{contain:size}
  .pe-qcard .pe-q{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
  .pe-sec-h{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:10px}
  .pe-sec-h h2{margin:0;font:600 var(--fs-lg)/1.2 var(--f-ui)}
  .pe-sec-h .muted{font-size:var(--fs-sm)}
  .pe-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--fs-xs);color:var(--muted);margin-left:auto}
  .pe-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .pe-legend i{width:8px;height:8px;border-radius:50%;background:var(--c)}
  .pe-legend i.o{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}
  .pe-legend b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}

  /* Personenkarten: drei Zonen – Kopf (Person, Zustand), Tätigkeit, unten bündig Ort/Aufgabe + Tagesverlauf */
  .pe-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(max(212px,calc((100% - 48px) / 5)),1fr))}
  .pe-card{--c:var(--st-idle);position:relative;display:flex;flex-direction:column;min-width:0;padding:12px 13px 11px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;box-shadow:inset 3px 0 0 var(--c);transition:border-color .15s ease,background-color .15s ease}
  .pe-card.o{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--c) 45%,transparent)}
  .pe-card:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 50%,var(--card))}
  .pe-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .pe-card.sel{border-color:color-mix(in srgb,var(--accent) 65%,transparent);box-shadow:inset 3px 0 0 var(--c),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .pe-card.prev{background:color-mix(in srgb,var(--panel) 55%,var(--card))}
  .pe-ch{display:flex;align-items:center;gap:10px;min-width:0;height:36px}
  .pe-av{position:relative;flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:600 var(--fs-sm)/1 var(--f-ui);color:var(--text);background:var(--raise);border:1px solid var(--line2)}
  .pe-av::after{content:"";position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;background:var(--c);border:2px solid var(--card)}
  .pe-card.o .pe-av::after{background:var(--card);box-shadow:inset 0 0 0 2px var(--c)}
  .pe-card[data-state="working"] .pe-av::after,.pe-card[data-state="driving"] .pe-av::after{animation:pePulse 1.8s ease-in-out infinite}
  @keyframes pePulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 0%,transparent)}}
  .pe-nm{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
  .pe-nm b{font:600 var(--fs-lg)/1.15 var(--f-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nm span{font-size:var(--fs-xs);line-height:1.2;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-st{display:flex;align-items:center;gap:8px;min-width:0;height:22px;margin-top:11px}
  .pe-st > span:first-child{min-width:0;display:flex}
  .pe-st .pill{min-width:0;max-width:100%}
  .pe-since{margin-left:auto;flex:none;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .pe-since b{color:var(--text2);font-weight:600}
  .pe-act{margin:8px 0 12px;font-size:var(--fs-md);line-height:19px;max-height:38px;color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .pe-act.dim{color:var(--muted)}
  .pe-rows{display:flex;flex-direction:column;gap:4px;margin-top:auto;padding-top:9px;border-top:1px solid var(--line)}
  .pe-r{display:flex;align-items:center;gap:8px;min-width:0;height:21px;font-size:var(--fs-sm);color:var(--text2)}
  .pe-r > .ico{flex:none;color:var(--faint)}
  .pe-r .tx{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-r .tx:empty{display:none}
  .pe-r .tx.none{color:var(--faint)}
  .pe-r .link{font-size:var(--fs-sm)}
  .pe-tchip{--c:var(--st-idle);display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0;max-width:100%;font:600 var(--fs-xs)/19px var(--f-ui);padding:0 7px;border-radius:5px;color:color-mix(in srgb,var(--c) 80%,var(--text));background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);white-space:nowrap}
  .pe-tchip i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--c)}
  .pe-tchip.o{background:transparent;border-color:color-mix(in srgb,var(--c) 45%,transparent)}
  .pe-tchip.o i{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}
  .pe-tchip span{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .pe-foot{display:flex;flex-direction:column;gap:5px;margin-top:11px}
  .pe-mini{position:relative;height:8px}
  .pe-mini svg{display:block;width:100%;height:8px;border-radius:3px}
  .pe-mini .nw{position:absolute;top:-3px;bottom:-3px;width:0;border-left:1.5px solid var(--text)}
  .pe-mini-ax{display:flex;justify-content:space-between;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-ft{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px}
  .pe-ft b{color:var(--text);font-weight:600}

  /* Lageplan: gleiche Bildsprache wie der Materialfluss (Hallenboden, Fahrwege, Bereiche, Stationen als Chips) –
     Personen als Avatare mit Initialen und Zustandsring; alle Maße in Bildschirm-Pixeln */
  .pe-map{position:relative;padding:8px 12px 2px;min-width:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain}
  .pe-map svg{display:block;user-select:none;-webkit-user-select:none}
  .pe-map.fr{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent)}
  .pe-mp-floor{fill:var(--bg2);stroke:var(--line2);stroke-width:1.2}
  .pe-mp-wall{fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;opacity:.5}
  .pe-mp-doorm{stroke:var(--faint);stroke-width:1;stroke-dasharray:2 3}
  .pe-mp-aisle{fill:none;stroke:color-mix(in srgb,var(--line) 70%,var(--bg2));stroke-linecap:round}
  .pe-mp-aisle-c{fill:none;stroke:color-mix(in srgb,var(--line2) 65%,transparent);stroke-width:.8;stroke-dasharray:5 7}
  .pe-mp-room{fill:color-mix(in srgb,var(--card) 50%,transparent);stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}
  .pe-mp-room.ext{fill:color-mix(in srgb,var(--ext) 5%,transparent);stroke:color-mix(in srgb,var(--ext) 40%,var(--line))}
  .pe-mp-t{font:600 var(--fs-2xs) var(--f-ui);letter-spacing:.08em;fill:var(--faint);text-transform:uppercase}
  .pe-mp-t.ext{fill:color-mix(in srgb,var(--ext) 75%,var(--muted))}
  .pe-mp-area{font:600 var(--fs-2xs) var(--f-ui);letter-spacing:.12em;fill:color-mix(in srgb,var(--faint) 85%,transparent);text-transform:uppercase}
  .pe-mp-n{cursor:pointer}
  .pe-mp-n .bg{fill:var(--card2);stroke:var(--line2);stroke-width:1.1;transition:stroke .15s ease}
  .pe-mp-n:hover .bg{stroke:color-mix(in srgb,var(--accent) 65%,var(--line2))}
  .pe-mp-n.wait .bg{stroke:color-mix(in srgb,var(--st-wait) 55%,var(--line2))}
  .pe-mp-n.fault .bg{fill:color-mix(in srgb,var(--st-fault) 14%,var(--card2));stroke:color-mix(in srgb,var(--st-fault) 70%,var(--line2))}
  .pe-mp-n.sel .bg{stroke:var(--accent);stroke-width:1.8}
  .pe-mp-n .id{font:600 var(--fs-md) var(--f-cond);fill:var(--text);letter-spacing:.01em}
  .pe-mp-n .nm{font:500 var(--fs-2xs) var(--f-ui);fill:var(--muted)}
  .pe-mp-n .sdh{opacity:.25}
  .pe-mp-tether{fill:none;stroke:var(--st-run);stroke-width:1.2;stroke-dasharray:1.5 3.5;stroke-linecap:round;opacity:.6}
  .pe-mp-path{fill:none;stroke:var(--info);stroke-width:1.5;stroke-dasharray:5 4;opacity:.9}
  .pe-mp-p{cursor:pointer;outline:none}
  .pe-mp-p .hit{fill:transparent}
  .pe-mp-p .halo{fill:var(--bg2)}
  .pe-mp-p .ring{fill:color-mix(in srgb,var(--c) 26%,var(--card2));stroke:var(--c);stroke-width:2}
  .pe-mp-p.o .ring{fill:var(--card2)}
  .pe-mp-p.idle .ring{fill:var(--card2);stroke-width:1.6}
  .pe-mp-p .in{font:700 var(--fs-2xs) var(--f-ui);fill:var(--text);letter-spacing:.02em;pointer-events:none}
  .pe-mp-p .lb{opacity:0;transition:opacity .15s ease;pointer-events:none}
  .pe-mp-p:hover .lb,.pe-mp-p:focus-visible .lb,.pe-mp-p.on .lb{opacity:1}
  .pe-mp-p .lbb{fill:var(--panel);stroke:var(--line2);stroke-width:1}
  .pe-mp-p .lb text{font:600 var(--fs-xs) var(--f-ui);fill:var(--text)}
  .pe-mp-p.on .halo{fill:var(--accent)}
  .pe-mp-more{font:700 var(--fs-2xs) var(--f-ui);fill:var(--text2)}
  .pe-mp-fk .vb{fill:var(--card2);stroke:var(--muted);stroke-width:1.4}
  .pe-mp-fk .vk{stroke:var(--muted);stroke-width:1.6;stroke-linecap:round}
  .pe-map-lg{display:flex;flex-wrap:wrap;gap:5px 16px;padding:7px 14px 11px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--line);margin-top:6px}
  .pe-map-lg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .pe-map-lg svg{flex:none;display:block}

  /* Offene Aufgaben */
  .pe-q{display:flex;flex-direction:column}
  .pe-qi{--c:var(--st-idle);display:flex;flex-direction:column;gap:5px;padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer}
  .pe-qi:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .pe-qi:last-child{border-bottom:0}
  .pe-qi-h{display:flex;align-items:flex-start;gap:8px;min-width:0}
  .pe-qi-h .pe-tchip{margin-top:1px;flex:none}
  .pe-qi-h b{font-weight:600;font-size:var(--fs-md);line-height:1.35;min-width:0;flex:1}
  .pe-qi-h .pe-wait{flex:none;font:600 var(--fs-sm)/1.6 var(--f-ui);font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap}
  .pe-qi-h .pe-wait.warn{color:var(--st-wait)}
  .pe-qi-who{font-size:var(--fs-sm);color:var(--muted);line-height:1.45}
  .pe-qi-who b{color:var(--text2);font-weight:600}
  .pe-qi-why{font-size:var(--fs-sm);line-height:1.45;color:color-mix(in srgb,var(--st-wait) 72%,var(--text));display:flex;gap:6px}
  .pe-qi-why .ico{flex:none;margin-top:1px}
  .pe-qi.held .pe-qi-h b{font-weight:500;color:var(--text2)}
  .pe-q-sub{position:sticky;top:0;z-index:1;padding:8px 14px 6px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line);background:var(--bg2)}
  .pe-q-empty{flex:1;padding:22px 16px;text-align:center;color:var(--muted);font-size:var(--fs-sm);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
  .pe-q-empty .ico{color:var(--st-run)}
  .pe-q-empty.sm{flex:none;flex-direction:row;padding:12px 14px;justify-content:flex-start;text-align:left;border-bottom:1px solid var(--line)}
  .pe-qa{display:flex;align-items:center;gap:9px;min-width:0;height:36px;padding:0 14px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);cursor:pointer;font-size:var(--fs-sm)}
  .pe-qa:last-child{border-bottom:0}
  .pe-qa:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .pe-qa .pe-tchip{flex:none}
  .pe-qa .w{flex:1;min-width:0;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-qa .who{--c:var(--st-idle);flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--text);font-weight:600;white-space:nowrap}
  .pe-qa .who i{width:7px;height:7px;border-radius:50%;background:var(--c)}

  /* Nächste Schicht (kompakte Leiste) */
  .pe-nxs .card-h{flex-wrap:wrap}
  .pe-nx{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:10px 12px 12px}
  .pe-nxp{display:flex;align-items:center;gap:9px;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid var(--line);background:var(--bg2);cursor:pointer;color:var(--text);text-align:left;font:inherit}
  .pe-nxp:hover{border-color:var(--line2);background:color-mix(in srgb,var(--raise) 40%,var(--bg2))}
  .pe-nxp .avatar{width:28px;height:28px}
  .pe-nxp > span:not(.avatar){min-width:0;display:flex;flex-direction:column;gap:1px;flex:1}
  .pe-nxp b{font-weight:600;font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nxp small{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nxp em{flex:none;font-style:normal;width:7px;height:7px;border-radius:50%;background:var(--st-run);box-shadow:0 0 0 3px color-mix(in srgb,var(--st-run) 20%,transparent)}

  /* Qualifikationsmatrix */
  .pe-mx-card .card-h{flex-wrap:wrap}
  .pe-mx-lg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:var(--fs-xs);color:var(--muted);align-items:center}
  .pe-mx-lg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .pe-mx-wrap{overflow-x:auto;overscroll-behavior-x:contain}
  table.pe-mx{border-collapse:separate;border-spacing:0;width:100%;min-width:980px;font-size:var(--fs-sm)}
  .pe-mx th,.pe-mx td{padding:0;text-align:center;vertical-align:middle}
  .pe-mx thead th{font:600 var(--fs-2xs)/1.15 var(--f-ui);letter-spacing:.02em;color:var(--muted);padding:8px 3px 8px;border-bottom:1px solid var(--line);vertical-align:bottom;background:var(--card)}
  .pe-mx thead th small{display:block;font:500 var(--fs-2xs)/1.2 var(--f-mono);color:var(--faint);margin-top:3px;letter-spacing:0}
  .pe-mx thead tr.grp th{letter-spacing:.12em;text-transform:uppercase;color:var(--faint);padding:8px 6px 4px;border-bottom:0;text-align:left}
  .pe-mx thead tr.grp th.g{border-bottom:1px solid var(--line2)}
  .pe-mx .nm{position:sticky;left:0;z-index:1;text-align:left;background:var(--card);padding:4px 12px 4px 14px;min-width:210px;max-width:240px}
  .pe-mx thead .nm{z-index:2}
  .pe-mx td.nm{border-right:1px solid var(--line)}
  .pe-mx thead th.nm{border-right:1px solid var(--line)}
  .pe-mx .sep{border-left:1px solid var(--line2)}
  .pe-mx td{height:38px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);min-width:52px}
  .pe-mx tbody tr.pr{cursor:pointer}
  .pe-mx tbody tr.pr:hover td{background:color-mix(in srgb,var(--raise) 35%,var(--card))}
  .pe-mx tbody tr.pr.on td.nm{box-shadow:inset 2px 0 0 var(--accent)}
  .pe-mx-p{display:flex;align-items:center;gap:9px;min-width:0}
  .pe-mx-p .avatar{width:26px;height:26px}
  .pe-mx-p div{min-width:0}
  .pe-mx-p b{display:block;font-weight:600;font-size:var(--fs-sm);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
  .pe-mx-p div span{display:block;font-size:var(--fs-xs);line-height:1.25;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-mx-p i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--c);margin-left:auto}
  .pe-mx-p i.o{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}
  .pe-mx tr.shr td{height:44px;padding:0;text-align:left;background:var(--bg2);border-bottom:1px solid var(--line);cursor:pointer}
  .pe-mx tr.shr:hover td{background:color-mix(in srgb,var(--raise) 40%,var(--bg2))}
  .pe-mx tr.shr td.nm{max-width:none}
  .pe-shr{position:sticky;left:0;display:inline-flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:8px 14px;max-width:min(100%,calc(100vw - 72px))}
  .pe-shr .ico{flex:none;color:var(--muted);transition:transform .18s ease}
  .pe-mx tr.shr.open .pe-shr > .ico:first-child{transform:rotate(90deg)}
  .pe-shr b{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--text2)}
  .pe-shr > span{font-size:var(--fs-xs);color:var(--faint);white-space:nowrap}
  .pe-shr em{font-style:normal;display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);font-weight:600;color:var(--st-run)}
  .pe-shr em::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--st-run)}
  .pe-shr-w{--c:var(--st-wait);display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;padding:2px 8px;border-radius:6px;color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 11%,transparent);border:1px solid color-mix(in srgb,var(--c) 34%,transparent);white-space:nowrap}
  .pe-shr-w.crit{--c:var(--st-fault)}
  .pe-shr-w .ico{color:var(--c)}
  .pe-shr-n{font-size:var(--fs-xs);color:var(--muted)}
  .pe-mx tr.cov td{height:34px;background:color-mix(in srgb,var(--bg2) 60%,var(--card));border-bottom:1px solid var(--line)}
  .pe-mx tr.cov td.nm{font-size:var(--fs-xs);color:var(--muted);background:color-mix(in srgb,var(--bg2) 60%,var(--card))}
  .pe-d{display:inline-block;width:13px;height:13px;border-radius:50%;vertical-align:middle}
  .pe-d.stamm{background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
  .pe-d.qual,.pe-d.full{background:var(--text2)}
  .pe-d.own,.pe-d.sub{background:linear-gradient(90deg,var(--text2) 50%,transparent 50%);border:1.5px solid var(--text2)}
  .pe-d.none{width:4px;height:4px;background:var(--line2)}
  .pe-mx td.spof{background:color-mix(in srgb,var(--st-wait) 11%,transparent)}
  .pe-mx td.spof .pe-d{box-shadow:0 0 0 2px var(--card),0 0 0 3.5px var(--st-wait)}
  .pe-mx tbody tr.pr:hover td.spof{background:color-mix(in srgb,var(--st-wait) 16%,var(--card))}
  .pe-cv{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;border-radius:6px;font:600 var(--fs-xs)/1 var(--f-ui);font-variant-numeric:tabular-nums;color:var(--muted)}
  .pe-cv small{font-weight:500;color:var(--faint);margin-left:1px;font-size:var(--fs-2xs)}
  .pe-cv.warn{color:color-mix(in srgb,var(--st-wait) 85%,white);background:color-mix(in srgb,var(--st-wait) 15%,transparent);border:1px solid color-mix(in srgb,var(--st-wait) 40%,transparent)}
  .pe-cv.crit{color:color-mix(in srgb,var(--st-fault) 85%,white);background:color-mix(in srgb,var(--st-fault) 15%,transparent);border:1px solid color-mix(in srgb,var(--st-fault) 40%,transparent)}
  .pe-bn{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 22px;padding:12px 14px 14px;border-top:1px solid var(--line)}
  .pe-bn:empty{display:none}
  .pe-bn.one{grid-template-columns:minmax(0,1fr)}
  .pe-bn-s{display:flex;flex-direction:column;min-width:0}
  .pe-bn-s h4{margin:0 0 8px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
  .pe-bn-s h4 em{font-style:normal;letter-spacing:0;text-transform:none;font-weight:500;color:var(--faint)}
  .pe-bn-l{display:grid;grid-template-columns:minmax(0,1fr);column-gap:22px}
  .pe-bn.one .pe-bn-l{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pe-bn-i{--c:var(--st-wait);display:flex;gap:9px;align-items:flex-start;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);padding:6px 2px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
  .pe-bn-i .ico{flex:none;color:var(--c);margin-top:1px}
  .pe-bn-i b{color:var(--text);font-weight:600}
  .pe-bn-i.crit{--c:var(--st-fault)}
  .pe-bn-i.key{--c:var(--st-fault);padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid color-mix(in srgb,var(--c) 30%,transparent);background:color-mix(in srgb,var(--c) 7%,var(--bg2))}
  .pe-bn-k{grid-column:1/-1}

  @media (max-width:1100px){.pe-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-f:nth-child(3){border-left:0}.pe-f:nth-child(n+3){border-top:1px solid var(--line)}}
  @media (max-width:999px){.pe-band{grid-template-columns:minmax(0,1fr)}.pe-qcard{contain:none}.pe-qcard .pe-q{flex:none;overflow:visible}}
  @media (max-width:900px){.pe-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-bn{grid-template-columns:minmax(0,1fr)}.pe-bn.one .pe-bn-l{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:560px){.pe-act{max-height:38px}
    .pe-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-f{padding:8px 10px;gap:8px}.pe-f:first-child,.pe-f:last-child{grid-column:1/-1}.pe-f:nth-child(2){border-left:0}.pe-f:nth-child(3){border-left:1px solid var(--line)}.pe-f:nth-child(n+2){border-top:1px solid var(--line)}
    .pe-f .pe-ic{display:none}.pe-f b{font-size:var(--fs-md)}.pe-tl-c em{display:none}.pe-tl-c i{font-size:0;gap:0}
    .pe-grid{grid-template-columns:minmax(0,1fr)}.pe-nx{grid-template-columns:repeat(2,minmax(0,1fr))}
    .pe-mx .nm{min-width:150px;max-width:160px;padding-left:10px}.pe-mx-p div span{display:none}.pe-legend{margin-left:0}}
  @media (pointer:coarse){.pe-mx td{height:44px}.pe-nxp{min-height:44px}.pe-r .link{padding:10px 0;margin:-10px 0}.pe-mx tr.shr td{height:48px}.pe-qa{height:44px}}

  /* Detail-Drawer */
  .pe-dh{display:flex;flex-direction:column;gap:9px}
  .pe-dh-st{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pe-dh-st .pill{font-size:var(--fs-md);line-height:22px;padding:3px 12px 3px 10px}
  .pe-dh-st .pill i{width:9px;height:9px}
  .pe-dh-st small{font-size:var(--fs-sm);color:var(--muted);font-variant-numeric:tabular-nums}
  .pe-dh-act{font-size:var(--fs-lg);line-height:1.45;color:var(--text);overflow-wrap:anywhere}
  .pe-dh-where{display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--text2)}
  .pe-dh-where .ico{color:var(--muted)}
  .pe-box{--c:var(--info);border-radius:9px;padding:10px 12px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 28%,transparent);font-size:var(--fs-sm);line-height:1.5;color:var(--text2);display:flex;flex-direction:column;gap:5px}
  .pe-box-h{display:flex;align-items:center;gap:8px;font-weight:600;font-size:var(--fs-md);color:var(--text)}
  .pe-box-h .pe-tchip{flex:none}
  .pe-box-h small{margin-left:auto;font-weight:500;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap}
  .pe-box .row{gap:6px}
  .pe-tend{display:flex;flex-direction:column;gap:6px}
  .pe-tend-r{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;background:var(--card);border:1px solid var(--line);font-size:var(--fs-sm)}
  .pe-tend-r .k{font:600 var(--fs-md) var(--f-cond);color:var(--text)}
  .pe-tend-r .t{color:var(--text2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-tend-r .n{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .pe-tend-r .n b{color:var(--text);font-weight:600}
  .pe-steps{display:flex;flex-wrap:wrap;align-items:center;gap:4px 3px;margin-top:2px}
  .pe-step{display:inline-flex;align-items:center;gap:3px;font:600 var(--fs-2xs)/1 var(--f-ui);padding:4px 7px;border-radius:5px;border:1px solid var(--line2);color:var(--faint);white-space:nowrap}
  .pe-step.done{color:var(--muted);border-color:var(--line)}
  .pe-step.done .ico{color:var(--st-run)}
  .pe-step.cur{color:var(--text);border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 16%,transparent)}
  .pe-step-ar{color:var(--faint);font-size:var(--fs-xs)}
  .pe-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .pe-s{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0;display:flex;flex-direction:column;gap:3px}
  .pe-s .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-s .v{font:600 var(--fs-xl)/1.15 var(--f-cond);white-space:nowrap}
  .pe-s .v small{font:500 var(--fs-sm)/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .pe-s .bar{height:4px;margin-top:2px}
  .pe-s .muted{font-size:var(--fs-xs)}
  .pe-band-d{display:flex;flex-direction:column;gap:5px}
  .pe-band-d svg{display:block;width:100%;height:22px;border-radius:5px}
  .pe-band-ax{position:relative;height:13px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-band-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .pe-band-ax span:first-child{transform:none}.pe-band-ax span:last-child{transform:translateX(-100%)}
  .pe-band-lg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--fs-xs);color:var(--muted)}
  .pe-band-lg span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .pe-band-lg i{width:8px;height:8px;border-radius:2px;background:var(--c)}
  .pe-band-lg b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}
  .pe-band-lg span.main b{color:var(--text)}
  .pe-band-note{font-size:var(--fs-xs);color:var(--faint);line-height:1.45}
  .pe-tl-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--card)}
  .pe-tli{--c:var(--st-idle);display:grid;grid-template-columns:minmax(86px,max-content) minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line);font-size:var(--fs-sm);box-shadow:inset 3px 0 0 var(--c)}
  .pe-tli:last-child{border-bottom:0}
  .pe-tli .t{font:500 var(--fs-xs)/1.2 var(--f-mono);color:var(--muted);white-space:nowrap}
  .pe-tli .lb{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text2)}
  .pe-tli .lb b{color:var(--text);font-weight:600}
  .pe-tli .d{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .pe-tli.on{background:color-mix(in srgb,var(--c) 7%,var(--card))}
  .pe-tli.on .d{color:var(--st-run)}
  .pe-ql{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 14px;align-items:start}
  .pe-ql > .k{font-size:var(--fs-sm);color:var(--muted);line-height:24px;white-space:nowrap}
  .pe-ql > .none{font-size:var(--fs-sm);color:var(--faint);line-height:24px}
  .pe-chips{display:flex;flex-wrap:wrap;gap:5px}
  .pe-chips .chip{min-height:24px}
  .pe-chips .chip.stamm{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 9%,transparent);cursor:pointer}
  .pe-chips .chip.stamm:hover{border-color:var(--accent)}
  .pe-risk{--c:var(--st-wait);display:flex;gap:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--c) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 26%,transparent)}
  .pe-risk .ico{flex:none;color:var(--c);margin-top:1px}
  .pe-subs{font-size:var(--fs-sm);color:var(--muted);line-height:1.5}
  `, 'people');

  // ------------------------------------------------------------------ Ansicht
  let root = null, R = {}, cards = {}, gridSig = '', qSig = '', nxSig = '', mxSig = '', bnSig = '', tlSig = '';
  let heldCache = { t: -1, map: {} };
  const mxOpen = {};        // Schicht-ID → vom Nutzer auf-/zugeklappt (sonst: laufende Schicht offen, andere zu)
  let mxShift = null;

  function mount(el) {
    root = el;
    el.innerHTML = `
      <div class="pe-root">
        <div class="view-h">
          <div><h1 class="view-t">Personal</h1>
            <p class="view-sub">Wer ist im Dienst, wer tut gerade was und wo – und welche Aufgabe wartet auf wen. Unten: Qualifikationen und Engpässe je Schicht.</p></div>
        </div>
        <section class="card pe-sh" aria-label="Schicht">
          <div class="pe-facts">
            <div class="pe-f"><span class="pe-dot" data-r="shDot"></span><div><span class="eyebrow" data-r="shEy">Schicht</span><b data-r="shName">–</b><small data-r="shSub">–</small></div></div>
            <div class="pe-f"><span class="pe-ic" data-r="chIc">${icon('refresh', 16)}</span><div><span class="eyebrow">Schichtwechsel</span><b data-r="chT">–</b><small data-r="chSub">–</small></div></div>
            <div class="pe-f"><span class="pe-ic" data-r="brIc" style="--c:var(--st-wait)">${icon('clock', 16)}</span><div><span class="eyebrow" data-r="brEy">Nächste Pause</span><b data-r="brT">–</b><small data-r="brSub">–</small></div></div>
            <div class="pe-f click" data-r="leadBox"><span class="avatar" data-r="leadAv">–</span><div><span class="eyebrow" data-r="leadEy">Schichtleitung</span><b data-r="leadName">–</b><small data-r="leadSub">–</small></div></div>
          </div>
          <div class="pe-tl" data-r="tl"></div>
        </section>
        <div class="kpis pe-kpis" data-r="kpis">
          <div class="kpi"><div class="l">Im Dienst</div><div class="v" data-r="kDuty">–</div><div class="s" data-r="kDutyS">–</div></div>
          <div class="kpi"><div class="l">Im Einsatz</div><div class="v" data-r="kWork">–</div><div class="s" data-r="kWorkS">–</div><div class="pe-dist-w"><div class="pe-dist" data-r="kDist"></div></div></div>
          <div class="kpi"><div class="l">Aufgabenzeit-Anteil</div><div class="v" data-r="kUtil">–</div><div class="s" data-r="kUtilS">–</div></div>
          <div class="kpi click" data-r="kOpenBox" title="Zur Liste der offenen Aufgaben"><div class="l">Aufgaben ohne Person</div><div class="v" data-r="kOpen">–</div><div class="s" data-r="kOpenS">–</div></div>
        </div>
        <div class="pe-band">
          <section class="card" aria-label="Lageplan">
            <div class="card-h"><h3>Lageplan · wer ist wo</h3><span class="muted" data-r="mapSub"></span></div>
            <div class="pe-map" data-r="map"></div>
            <div class="pe-map-lg">${MAP_LEGEND()}</div>
          </section>
          <section class="card pe-qcard" data-r="qCard" aria-label="Offene Aufgaben">
            <div class="card-h"><h3>Offene Aufgaben</h3><span class="muted" data-r="qSub"></span></div>
            <div class="pe-q" data-r="q"></div>
          </section>
        </div>
        <section aria-label="Im Dienst">
          <div class="pe-sec-h"><h2 data-r="gridT">Im Dienst</h2><span class="muted" data-r="gridSub"></span>
            <div class="pe-legend" data-r="gridLg"></div></div>
          <div class="pe-grid" data-r="grid"></div>
        </section>
        <section class="card pe-nxs" aria-label="Nächste Schicht">
          <div class="card-h"><h3 data-r="nxT">Nächste Schicht</h3><span class="muted" data-r="nxSub"></span></div>
          <div class="pe-nx" data-r="nx"></div>
        </section>
        <section class="card pe-mx-card" aria-label="Qualifikationsmatrix">
          <div class="card-h"><h3>Qualifikationsmatrix</h3>
            <div class="pe-mx-lg">
              <span><i class="pe-d stamm"></i>Stammarbeitsplatz</span>
              <span><i class="pe-d qual"></i>qualifiziert</span>
              <span><i class="pe-d own"></i>eingeschränkt (eigene Maschinen / vertretend)</span>
              <span><span class="pe-cv warn">1</span>Engpass: nur eine Person je Schicht</span>
            </div></div>
          <div class="pe-mx-wrap" data-r="mx"></div>
          <div class="pe-bn" data-r="bn"></div>
        </section>
      </div>`;
    R = refs(el);
    R.leadBox.addEventListener('click', () => { if (R.leadBox.dataset.pid) WF.app.select('person', R.leadBox.dataset.pid); });
    R.kOpenBox.addEventListener('click', () => R.qCard.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    R.grid.addEventListener('click', (e) => {
      const lk = e.target.closest('[data-sel]');
      if (lk) { e.stopPropagation(); const [k, id] = lk.dataset.sel.split('|'); WF.app.select(k, id); return; }
      const c = e.target.closest('.pe-card'); if (c) WF.app.select('person', c.dataset.id);
    });
    R.grid.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pe-card')) { e.preventDefault(); WF.app.select('person', e.target.dataset.id); } });
    for (const k of ['q', 'nx']) { const n = R[k]; n.addEventListener('mouseenter', () => { n._hover = true; }); n.addEventListener('mouseleave', () => { n._hover = false; }); }
    R.q.addEventListener('click', (e) => {
      const lk = e.target.closest('[data-sel]');
      if (lk) { const [k, id] = lk.dataset.sel.split('|'); WF.app.select(k, id); }
    });
    R.nx.addEventListener('click', (e) => { const r = e.target.closest('[data-id]'); if (r) WF.app.select('person', r.dataset.id); });
    R.map.addEventListener('scroll', mapScrollHint, { passive: true });
    R.map.addEventListener('click', (e) => { const g = e.target.closest('[data-pid]'); if (g) { WF.app.select('person', g.dataset.pid); return; } const m = e.target.closest('[data-mid]'); if (m && hasDetail('machine')) WF.app.select('machine', m.dataset.mid); });
    R.mx.addEventListener('click', (e) => {
      const h = e.target.closest('tr[data-shift]');
      if (h) { const id = h.dataset.shift; mxOpen[id] = !isOpen(id); mxSig = bnSig = ''; renderMatrix(WF.sim.shift()); renderBottlenecks(WF.sim.shift()); return; }
      const r = e.target.closest('tr[data-id]'); if (r) WF.app.select('person', r.dataset.id);
    });
    R.mx.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-shift]')) { e.preventDefault(); e.target.click(); } });
    WF.bus.on('select', (s) => {
      for (const id in cards) cards[id].el.classList.toggle('sel', !!(s && s.kind === 'person' && s.id === id));
      if (R.mx) R.mx.querySelectorAll('tr[data-id]').forEach(r => r.classList.toggle('on', !!(s && s.kind === 'person' && s.id === r.dataset.id)));
    });
    WF.bus.on('sim:reset', () => { gridSig = qSig = nxSig = mxSig = bnSig = tlSig = ''; });
    buildMap();
    if (window.ResizeObserver) {
      new ResizeObserver(() => { const w = R.map.clientWidth; if (w && Math.abs(w - mapW) > 8) buildMap(); }).observe(R.map);
      new ResizeObserver(() => { const w = R.tl.clientWidth; if (w && Math.abs(w - tlW) > 8) { tlW = w; tlSig = ''; } }).observe(R.tl);
      // Breiten nur hier messen (nicht in update(): kein erzwungenes Layout 4×/s)
      new ResizeObserver(() => { gridW = R.grid.clientWidth; nxW = R.nx.clientWidth; }).observe(R.grid);
    }
  }

  // ---------------- Lageplan (2D) – gleiche Bildsprache wie der Materialfluss: Hallenboden, Wände mit Toren, Fahrwege,
  // Bereiche, Stationen als Chips (Zustandspunkt, Kennung, Name). Personen als Avatare (Initialen, Zustandsring) an ihrer
  // Station, Wege als gestrichelter Pfeil zum Ziel, betreute Maschinen über eine gepunktete Linie. Maße in Bildschirm-Pixeln.
  let mapRefs = null, mapW = 0, gridW = 0, nxW = 0;
  const MAP_NODES = [['M01', 5.25, 16.2], ['M02', 15.25, 16.2], ['M03', 24.3, 16.2], ['M04', 33.5, 16.2], ['M07', 44.2, 16.2], ['M08', 52.1, 16.2], ['M13', 60.2, 16.2],
    ['M05', 14, 28.2], ['M06', 20.6, 28.2], ['M09', 27.2, 28.2], ['M10', 33.8, 28.2], ['M11', 40.4, 28.2], ['QS', 48.8, 28.2]];
  const MAP_AREAS = [['Dreherei', 24.3, 11.4], ['Fräserei', 17.3, 32.6], ['Schleiferei', 30.5, 32.6], ['Zuschnitt', 5.25, 11.4], ['Montage', 60.2, 11.4],
    ['Verzahnung', 52.1, 11.4], ['Reinigung', 40.4, 32.6], ['Sonderbearbeitung', 44.2, 11.4]];
  const MAP_LBL = { CRIB: ['Werkzeugausgabe', 'Werkzeuge', 'WZ'], MAINT: ['Instandhaltung', 'Instandh.', 'IH'], OFFICE: ['Leitstand', 'Büro'], RAW: ['Rohmaterial', 'Rohmat.'],
    PUF: ['Pufferlager', 'Puffer'], WE: ['Wareneingang', 'WE'], SPERR: ['Sperrlager', 'Sperr'], EXT: ['Fremdbearbeitung', 'Fremdbearb.', 'Extern'], VERSAND: ['Versand'], CHG: ['AGV laden', 'AGV'] };
  const MZ = 0.8, MPAD = 14, AVR = 12, NH = 34;
  const twU = (s, px) => String(s).length * px * 0.56;           // Textbreite Barlow (grob)
  const twC = (s, px, ls) => String(s).length * px * (0.58 + ls); // Versalien mit Sperrung
  const r1 = (v) => Math.round(v * 10) / 10;
  function avSvg(c, o, sz = 18) {
    const h = sz / 2;
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${h - 1.5}" style="fill:${o ? 'var(--card2)' : `color-mix(in srgb,${c} 26%,var(--card2))`};stroke:${c}" stroke-width="2"/></svg>`;
  }
  function MAP_LEGEND() {
    return [
      [avSvg('var(--st-run)'), 'arbeitet an einer Aufgabe'],
      [avSvg('var(--st-run)', true), 'betreut laufende Maschinen'],
      [avSvg('var(--info)') + '<svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><path d="M1,5 H15" style="stroke:var(--info)" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M14,1.5 L20,5 L14,8.5 Z" style="fill:var(--info)"/></svg>', 'unterwegs zum Ziel'],
      [avSvg('var(--st-idle)', true), 'verfügbar'],
      [avSvg('var(--mat)'), 'fährt Stapler'],
      ['<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="1" width="24" height="14" rx="4" style="fill:var(--card2);stroke:var(--line2)"/><circle cx="7.5" cy="8" r="2.6" style="fill:var(--st-run)"/></svg>', 'Maschine · Punkt = Zustand'],
    ].map(([g, t]) => `<span>${g}${esc(t)}</span>`).join('');
  }
  function buildMap() {
    const Pp = P(), H = Pp.hall;
    const phone = window.matchMedia('(max-width: 900px)').matches;
    mapW = R.map.clientWidth;
    const cw = Math.max(0, mapW - 24);
    const W = Math.round(Math.max(phone ? 660 : 480, cw || 640));
    const KX = (W - 2 * MPAD) / H.w, KZ = KX * MZ;
    const PX = (x) => MPAD + x * KX, PY = (z) => MPAD + z * KZ;
    const Hh = Math.round(PY(H.d) + 24);
    let h = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Lageplan der Halle: wer ist wo">`;
    h += '<defs><marker id="pe-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--info)"/></marker></defs>';
    h += `<rect class="pe-mp-floor" x="${r1(PX(0))}" y="${r1(PY(0))}" width="${r1(H.w * KX)}" height="${r1(H.d * KZ)}" rx="6"/>`;
    // Fahrwege
    const aw = U.clamp(1.5 * KZ, 8, 14).toFixed(1);
    for (const Ln of Pp.graph.lines || []) {
      const d = Ln.axis === 'x' ? `M${r1(PX(Ln.a))},${r1(PY(Ln.c))} H${r1(PX(Ln.b))}` : `M${r1(PX(Ln.c))},${r1(PY(Ln.a))} V${r1(PY(Ln.b))}`;
      h += `<path class="pe-mp-aisle" stroke-width="${aw}" d="${d}"/><path class="pe-mp-aisle-c" d="${d}"/>`;
    }
    // Räume und Zonen (alles ohne Maschinen-Chip)
    const nodeIds = new Set(MAP_NODES.map(n => n[0])), rooms = {};
    for (const s of Pp.stations) {
      const fp = s.footprint; if (!fp || nodeIds.has(s.id)) continue;
      const x = PX(fp.x), y = PY(fp.z), w = fp.w * KX, d = fp.d * KZ, ext = s.id === 'EXT';
      h += `<rect class="pe-mp-room${ext ? ' ext' : ''}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(d)}" rx="4"><title>${esc(s.name)}</title></rect>`;
      const lb = (MAP_LBL[s.id] || [s.short]).find(c => twC(c, 10.5, 0.08) <= w - 10);
      if (lb) h += `<text class="pe-mp-t${ext ? ' ext' : ''}" x="${r1(x + 6)}" y="${r1(y + 14)}">${esc(lb)}</text>`;
      const lbw = lb ? twC(lb, 10.5, 0.08) : 0;
      rooms[s.id] = d >= 2 * AVR + 24
        ? { x, y, w, h: d, ax: x + w / 2, ay: y + 17 + (d - 17) / 2 }
        : { x, y, w, h: d, ax: Math.min(x + w - AVR - 3, x + 12 + lbw + AVR), ay: y + d / 2 };
    }
    // Bereichsbeschriftungen (nur ohne Überlappung)
    const placed = [];
    for (const [a, ax0, az] of MAP_AREAS) {
      const tw = twC(a, 10.5, 0.12), ax = PX(ax0), ay = PY(az);
      const bx = { x0: ax - tw / 2 - 6, x1: ax + tw / 2 + 6 };
      if (bx.x0 < PX(0.5) || bx.x1 > PX(H.w - 0.5) || placed.some(q => q.y === az && !(bx.x1 < q.x0 || bx.x0 > q.x1))) continue;
      placed.push(Object.assign(bx, { y: az }));
      h += `<text class="pe-mp-area" x="${r1(ax)}" y="${r1(ay + 4)}" text-anchor="middle">${esc(a)}</text>`;
    }
    // Wände mit Toren (vorne)
    const x0 = PX(0), x1 = PX(H.w), y0 = PY(0), y1 = PY(H.d);
    h += `<path class="pe-mp-wall" d="M${r1(x0)},${r1(y1 - 6)} V${r1(y0 + 6)} Q${r1(x0)},${r1(y0)} ${r1(x0 + 6)},${r1(y0)} H${r1(x1 - 6)} Q${r1(x1)},${r1(y0)} ${r1(x1)},${r1(y0 + 6)} V${r1(y1 - 6)}"/>`;
    let wx = 0, front = '';
    for (const d of (H.doors || []).filter(q => q.wall === 'front').sort((a, b) => a.x - b.x)) {
      front += `M${r1(PX(Math.max(0.3, wx)))},${r1(y1)} H${r1(PX(d.x))} `;
      h += `<path class="pe-mp-doorm" d="M${r1(PX(d.x))},${r1(y1)} H${r1(PX(d.x + d.w))}"/>`;
      if (twC(d.name, 10.5, 0.08) < (d.w + 8) * KX) h += `<text class="pe-mp-t" x="${r1(PX(d.x + d.w / 2))}" y="${r1(y1 + 15)}" text-anchor="middle">${esc(d.name)}</text>`;
      wx = d.x + d.w;
    }
    front += `M${r1(PX(wx))},${r1(y1)} H${r1(PX(H.w - 0.3))}`;
    h += `<path class="pe-mp-wall" d="${front}"/>`;
    h += '<g data-r="tethers"></g><g data-r="paths"></g>';
    // Stationen als Chips
    const NODES = {}, rowsX = {};
    for (const [, x, z] of MAP_NODES) (rowsX[z] = rowsX[z] || []).push(x);
    for (const [id, x, z] of MAP_NODES) {
      const s = st(id); if (!s) continue;
      const others = rowsX[z].filter(v => v !== x);
      const gap = others.length ? Math.min(...others.map(v => Math.abs(v - x))) * KX : 140;
      const w = Math.round(U.clamp(gap - 6, 36, 124)), cx = PX(x), cy = PY(z);
      const nm = [s.short, String(s.short).split(/\s+/)[0]].find(c => twU(c, 10.5) <= w - 12);
      NODES[id] = { cx, cy, w, h: NH, top: z < 22 };
      h += `<g class="pe-mp-n" data-mid="${esc(id)}" transform="translate(${r1(cx)},${r1(cy)})"><title>${esc(s.name)} (${esc(id)})</title>
        <rect class="bg" x="${-w / 2}" y="${-NH / 2}" width="${w}" height="${NH}" rx="8"/>
        <circle class="sdh" cx="${-w / 2 + 11}" cy="-5.5" r="6"/><circle class="sd" cx="${-w / 2 + 11}" cy="-5.5" r="3.5"/>
        <text class="id" x="${-w / 2 + 19}" y="-0.5">${esc(id)}</text>${nm ? `<text class="nm" x="${-w / 2 + 8}" y="12">${esc(nm)}</text>` : ''}</g>`;
    }
    // Personen (Avatare) und abgestellter Stapler
    h += '<g data-r="people">';
    const lws = {};
    for (const pp of Pp.people) {
      const lw = lws[pp.id] = Math.ceil(twU(pp.name, 11.5) + 18);
      h += `<g class="pe-mp-p" data-pid="${esc(pp.id)}" style="display:none"><circle class="hit" r="20"/><circle class="halo" r="${AVR + 2.5}"/><circle class="ring" r="${AVR - 1}"/>` +
        `<text class="in" text-anchor="middle" y="3.8">${esc(WF.ui.initials(pp.name))}</text>` +
        `<g class="lb" transform="translate(${AVR + 6},0)"><rect class="lbb" x="0" y="-11" width="${lw}" height="22" rx="6"/><text x="9" y="4">${esc(pp.name)}</text></g><title></title></g>`;
    }
    h += '</g><g data-r="more"></g><g class="pe-mp-fk" data-r="fk" style="display:none"><rect class="vb" x="-8.5" y="-5.5" width="13" height="11" rx="2.5"/><path class="vk" d="M5.5,-3.5 h6 M5.5,3.5 h6"/><title>Stapler (abgestellt)</title></g></svg>';
    R.map.innerHTML = h;
    const svg = R.map.querySelector('svg');
    mapRefs = { svg, W, H: Hh, PX, PY, NODES, rooms, tethers: svg.querySelector('[data-r="tethers"]'), paths: svg.querySelector('[data-r="paths"]'),
      more: svg.querySelector('[data-r="more"]'), fk: svg.querySelector('[data-r="fk"]'), p: {}, n: {} };
    svg.querySelectorAll('.pe-mp-p').forEach(g => { const id = g.dataset.pid; mapRefs.p[id] = { g, t: g.querySelector('title'), lb: g.querySelector('.lb'), lw: lws[id] }; });
    svg.querySelectorAll('.pe-mp-n').forEach(g => { mapRefs.n[g.dataset.mid] = { g, sd: g.querySelector('.sd'), sdh: g.querySelector('.sdh'), t: g.querySelector('title') }; });
    mapScrollHint();
    if (S()) updateMap(S().t);
  }
  function mapPlace(d) { const tr = `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`; if (d._tr !== tr) { d._tr = tr; d.g.setAttribute('transform', tr); } }
  /** je Bild: Avatare gleiten zu ihrem Ziel (update() setzt Ziele nur 4×/s) */
  function mapFrame(dt) {
    const M = mapRefs; if (!M || !dt) return;
    const k = 1 - Math.exp(-dt * 9);
    for (const id in M.p) {
      const d = M.p[id];
      if (d._hid !== false || d.x == null || d.tx == null) continue;
      const dx = d.tx - d.x, dy = d.ty - d.y;
      if (Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) { if (dx || dy) { d.x = d.tx; d.y = d.ty; mapPlace(d); } continue; }
      d.x += dx * k; d.y += dy * k; mapPlace(d);
    }
  }
  function mapScrollHint() { if (R.map) R.map.classList.toggle('fr', R.map.scrollWidth - R.map.clientWidth - R.map.scrollLeft > 4); }
  /** Zielpunkt eines Weges: Kante des Stations-Chips bzw. nächster Punkt des Raums */
  function mapTarget(sid, x, y) {
    const M = mapRefs, n = M.NODES[sid];
    if (n) return { x: U.clamp(x, n.cx - n.w / 2 + 8, n.cx + n.w / 2 - 8), y: y > n.cy ? n.cy + n.h / 2 + 3 : n.cy - n.h / 2 - 3 };
    const r = M.rooms[sid];
    if (r) { const ix = U.clamp(x, r.x, r.x + r.w), iy = U.clamp(y, r.y, r.y + r.h); return ix === x && iy === y ? { x: r.ax, y: r.ay } : { x: ix, y: iy }; }
    const s = st(sid), w = s && (s.work || s.dock);
    return w ? { x: M.PX(w.x), y: M.PY(w.z) } : null;
  }
  function mapAnchor(sid) {
    const M = mapRefs, n = M.NODES[sid];
    if (n) return { x: n.cx, y: n.top ? n.cy + n.h / 2 + AVR + 6 : n.cy - n.h / 2 - AVR - 6 };
    const r = M.rooms[sid];
    return r ? { x: r.ax, y: r.ay } : null;
  }
  function updateMap(now) {
    const M = mapRefs; if (!M) return;
    const Sx = S(), sel = WF.app.selected;
    const items = [], at = {}, tethers = [];
    let nIn = 0, brk = 0;
    for (const pp of P().people) {
      const p = Sx.people[pp.id], d = M.p[pp.id];
      if (p && p.state === 'break') brk++;
      if (!p || p.state === 'offShift' || p.state === 'break') { d.hidden = true; continue; }
      nIn++;
      const ds = dstate(p), w = whereOf(p);
      const fkD = !!(p.vehicle && Sx.forklift && Sx.forklift.driver === p.id);
      const pos = fkD ? Sx.forklift.pos : p.pos;
      const it = { id: pp.id, pp, p, ds, d, w, x: M.PX(pos.x), y: M.PY(pos.z), moving: !!(w.moving || p.state === 'walking' || p.state === 'driving') };
      it.on = !!(sel && sel.kind === 'person' && sel.id === pp.id);
      if (ds === 'tending') { for (const mid of tendOf(p) || []) if (M.NODES[mid]) tethers.push([it, M.NODES[mid]]); }
      else if (!it.moving && w.sid && mapAnchor(w.sid)) { it.snap = w.sid; (at[w.sid] = at[w.sid] || []).push(it); }
      if (it.moving) { const tk = p.task, s0 = tk && tk.steps ? tk.steps[tk.si] : null; it.to = (s0 && s0.to) || (w.sid || null); }
      items.push(it);
    }
    // an einer Station: nebeneinander, höchstens drei Plätze (sonst zwei Avatare + „+n“)
    let more = '';
    for (const sid in at) {
      const list = at[sid].sort((a, b) => (b.on ? 1 : 0) - (a.on ? 1 : 0)), a = mapAnchor(sid), n = list.length, slots = Math.min(3, n);
      list.forEach((it, i) => {
        if (n > 3 && i >= 2) { it.hide = true; return; }
        it.x = a.x + (i - (slots - 1) / 2) * (2 * AVR + 4); it.y = a.y;
      });
      if (n > 3) {
        const mx = a.x + (2 - (slots - 1) / 2) * (2 * AVR + 4);
        more += `<g transform="translate(${r1(mx)},${r1(a.y)})"><circle r="${AVR + 2.5}" style="fill:var(--bg2)"/><circle r="${AVR - 1}" style="fill:var(--raise);stroke:var(--line2)" stroke-width="1.4"/><text class="pe-mp-more" text-anchor="middle" y="3.8">+${n - 2}</text><title>${esc(list.slice(2).map(x => x.pp.name).join(', '))}</title></g>`;
      }
    }
    // Überlappung auflösen (gestapelte Avatare an Stationen bleiben möglichst stehen)
    const vis = items.filter(it => !it.hide), min = 2 * AVR + 4;
    for (let k = 0; k < 4; k++) for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j]; let dx = b.x - a.x, dy = b.y - a.y; const dd = Math.hypot(dx, dy);
      if (dd >= min) continue;
      if (dd < 0.01) { dx = 1; dy = 0; } else { dx /= dd; dy /= dd; }
      const push = (min - dd) / 2, wa = a.snap && !b.snap ? 0 : !a.snap && b.snap ? 2 : 1, wb = 2 - wa;
      a.x -= dx * push * wa; a.y -= dy * push * wa; b.x += dx * push * wb; b.y += dy * push * wb;
    }
    let tl = '', pl = '';
    for (const it of items) {
      const d = it.d;
      if (it.hide) { d.hidden = true; continue; }
      d.hidden = false;
      it.x = U.clamp(it.x, MPAD + AVR, M.W - MPAD - AVR); it.y = U.clamp(it.y, MPAD + AVR, M.H - AVR - 2);
      // Ziel setzen – frame() gleitet weich dorthin; neu sichtbare Avatare springen direkt an ihren Platz
      d.tx = it.x; d.ty = it.y;
      if (d.x == null || d._hid !== false) { d.x = it.x; d.y = it.y; mapPlace(d); }
      const cls = 'pe-mp-p' + (pOutline(it.ds) ? ' o' : '') + (it.ds === 'idle' ? ' idle' : '') + (it.on ? ' on' : '');
      if (d._cls !== cls) { d._cls = cls; d.g.setAttribute('class', cls); if (it.on) d.g.parentNode.append(d.g); }
      const c = pColor(it.ds);
      if (d._c !== c) { d._c = c; d.g.style.setProperty('--c', c); }
      const left = it.x > M.W - d.lw - 2 * AVR - 12;
      if (d._left !== left) { d._left = left; d.lb.setAttribute('transform', left ? `translate(${-(AVR + 6 + d.lw)},0)` : `translate(${AVR + 6},0)`); }
      const run = it.ds === 'tending' ? tendOf(it.p) : null;
      setText(d.t, `${it.pp.name} – ${run ? tendLabel(run) : pLabel(it.ds)}: ${actText(it.p, it.ds, now, false)}`);
      if (it.moving && it.to) {
        const tg = mapTarget(it.to, it.x, it.y);
        if (tg) {
          const dx = tg.x - it.x, dy = tg.y - it.y, dd = Math.hypot(dx, dy);
          if (dd > 2 * AVR + 10) pl += `<path class="pe-mp-path" marker-end="url(#pe-arr)" d="M${r1(it.x + dx / dd * (AVR + 3))},${r1(it.y + dy / dd * (AVR + 3))} L${r1(tg.x - dx / dd * 2)},${r1(tg.y - dy / dd * 2)}"/>`;
        }
      }
    }
    for (const [it, n] of tethers) {
      if (it.hide) continue;
      const ex = U.clamp(it.x, n.cx - n.w / 2 + 10, n.cx + n.w / 2 - 10), ey = it.y > n.cy ? n.cy + n.h / 2 : n.cy - n.h / 2;
      const dx = ex - it.x, dy = ey - it.y, dd = Math.hypot(dx, dy);
      if (dd > AVR + 6) tl += `<path class="pe-mp-tether" d="M${r1(it.x + dx / dd * (AVR + 3))},${r1(it.y + dy / dd * (AVR + 3))} L${r1(ex)},${r1(ey)}"/>`;
    }
    for (const id in M.p) { const d = M.p[id], hid = d.hidden !== false; if (d._hid !== hid) { d._hid = hid; d.g.style.display = hid ? 'none' : ''; if (hid) d.x = null; } }
    if (M._tl !== tl) { M._tl = tl; M.tethers.innerHTML = tl; }
    if (M._pl !== pl) { M._pl = pl; M.paths.innerHTML = pl; }
    if (M._more !== more) { M._more = more; M.more.innerHTML = more; }
    const f = Sx.forklift, parked = !!(f && !f.driver);
    if (M._fkp !== parked) { M._fkp = parked; M.fk.style.display = parked ? '' : 'none'; }
    if (parked) { const tr = `translate(${r1(M.PX(f.pos.x))},${r1(M.PY(f.pos.z))})`; if (M._ftr !== tr) { M._ftr = tr; M.fk.setAttribute('transform', tr); } }
    for (const id in M.n) {
      const m = Sx.machines[id], n = M.n[id]; if (!m) continue;
      const S0 = WF.STATE[m.state] || WF.STATE.idle, grp = S0.group;
      const cls = 'pe-mp-n' + (grp === 'wait' ? ' wait' : grp === 'fault' ? ' fault' : '') + (sel && sel.kind === 'machine' && sel.id === id ? ' sel' : '');
      if (n._cls !== cls) { n._cls = cls; n.g.setAttribute('class', cls); }
      if (n._c !== S0.color) { n._c = S0.color; n.sd.style.fill = S0.color; n.sdh.style.fill = S0.color; }
      setText(n.t, `${st(id).name} (${id}) – ${S0.label}`);
    }
    setText(R.mapSub, nIn ? `${nIn} in der Halle${brk ? ` · ${brk} in der Pause` : ''}` : brk ? `${brk} in der Pause` : 'niemand in der Halle');
  }

  // ---------------- Schichtkopf
  function updateHead(now) {
    const sh = WF.sim.shift(), def = sh.id ? shiftDef(sh.id) : null;
    const dow = Math.floor(now / DAY) % 7;
    if (sh.id) {
      setText(R.shEy, sh.inBreak ? 'Schicht · Pause' : 'Schicht läuft');
      setText(R.shName, `${sh.name} ${def.start}–${def.end}`);
      setText(R.shSub, `seit ${U.fmtDur(now - (Math.floor(now / DAY) * DAY + U.hm(def.start)))} · noch ${U.fmtDur(Math.max(0, sh.endsAt - now))}`);
      setVar(R.shDot, '--c', sh.inBreak ? 'var(--st-wait)' : 'var(--st-run)');
    } else {
      setText(R.shEy, 'Keine Schicht');
      setText(R.shName, dow >= 5 ? 'Wochenende' : 'Geisterschicht');
      setText(R.shSub, `autonome Maschinen laufen · nächste Schicht ${tclock(sh.endsAt, now)}`);
      setVar(R.shDot, '--c', 'var(--st-idle)');
    }
    const nx = nextShift(sh, now);
    setText(R.chT, `${tclock(nx.startT, now)} → ${nx.def.name}`);
    setText(R.chSub, sh.id ? `in ${U.fmtDur(Math.max(0, sh.endsAt - now))}` + (nx.startT !== sh.endsAt ? ` · ab ${U.fmtClock(sh.endsAt)} Geisterschicht` : ' · Übergabe') : `in ${U.fmtDur(Math.max(0, nx.startT - now))}`);
    const br = sh.id ? breakInfo(sh, now) : null;
    if (br && br.now) { setText(R.brEy, 'Pause läuft'); setText(R.brT, `${U.fmtClock(br.a)}–${U.fmtClock(br.b)}`); setText(R.brSub, `noch ${U.fmtDur(Math.max(0, br.b - now))}`); setAttr(R.brSub, 'title', 'Laufende Arbeiten werden noch beendet, danach Pause'); }
    else if (br) { setText(R.brEy, 'Nächste Pause'); setText(R.brT, `${U.fmtClock(br.a)}–${U.fmtClock(br.b)}`); setText(R.brSub, `in ${U.fmtDur(Math.max(0, br.a - now))} · ${U.fmtDur(br.b - br.a)}`); }
    else { setText(R.brEy, 'Nächste Pause'); setText(R.brT, sh.id ? 'keine mehr' : '–'); setText(R.brSub, sh.id ? 'bis Schichtende keine Pause' : 'Pausen nur in den Schichten'); }
    const lead = shiftLead(sh.id || nx.def.id);
    if (lead) {
      const live = S().people[lead.p.id];
      R.leadBox.dataset.pid = lead.p.id;
      setText(R.leadEy, sh.id ? lead.label : lead.label + ' (nächste Schicht)');
      setText(R.leadName, lead.p.name); setText(R.leadAv, WF.ui.initials(lead.p.name));
      const lds = live ? dstate(live) : 'offShift';
      setText(R.leadSub, !live || live.state === 'offShift' ? (sh.id ? 'nicht im Dienst' : 'ab ' + tclock(nx.startT, now)) : lds === 'lead' ? `im Leitstand · ${pLabel(lds)}` : `${pLabel(lds)} · ${whereOf(live).text}`);
      setAttr(R.leadBox, 'title', `${lead.p.name} (${lead.note})`);
    }
    renderTimeline(sh, now);
  }
  let tlW = 0;
  function renderTimeline(sh, now) {
    const d0 = Math.floor(now / DAY) * DAY, dow = Math.floor(now / DAY) % 7;
    const defs = P().shifts.map(s => ({ s, a: U.hm(s.start), b: U.hm(s.end) })).sort((x, y) => x.a - y.a);
    const A = defs[0].a, B = defs[defs.length - 1].b, span = B - A;
    const X = (sec) => U.clamp((sec - A) / span * 100, 0, 100);
    const s = now - d0, inWin = s >= A && s <= B && dow < 5;
    if (!tlW) tlW = R.tl.clientWidth || 1000;
    const sig = [dow < 5, sh.id, Math.floor(s / 60), inWin, tlW].join('|');
    if (sig === tlSig) return;
    tlSig = sig;
    const narrow = tlW < 520;
    let cap = '', tr = '';
    for (const x of defs) {
      const cur = sh.id === x.s.id;
      const c = x.s.id === 'F' ? 'var(--st-setup)' : 'var(--st-tool)';
      cap += `<span class="pe-tl-c${cur ? ' cur' : ''}" style="--c:${c};left:${X(x.a)}%;width:${(X(x.b) - X(x.a)).toFixed(2)}%"><b>${esc(x.s.name)}</b><em>${x.s.start}–${x.s.end}</em>${cur ? `<i>${sh.inBreak ? 'Pause' : 'läuft'}</i>` : ''}</span>`;
      tr += `<div class="pe-tl-sh${cur ? ' cur' : ''}" title="${esc(x.s.name)} ${x.s.start}–${x.s.end}" style="--c:${c};left:${X(x.a)}%;width:calc(${(X(x.b) - X(x.a)).toFixed(2)}% - 2px)"></div>`;
      for (const b of x.s.breaks) tr += `<div class="pe-tl-br" title="Pause ${b[0]}–${b[1]}" style="left:${X(U.hm(b[0]))}%;width:${(X(U.hm(b[1])) - X(U.hm(b[0]))).toFixed(2)}%"></div>`;
    }
    if (inWin) tr += `<div class="pe-tl-past" style="width:${X(s).toFixed(2)}%"></div><div class="pe-tl-now" style="left:${X(s).toFixed(2)}%"></div>`;
    // Zeitachse: Stundenmarken, die die Jetzt-Marke überdecken würde, entfallen
    const nowX = inWin ? X(s) : null, gap = 50 / tlW * 100;
    let ax = '';
    const step = narrow ? 4 * 3600 : 7200;
    for (let hh = A; hh <= B; hh += step) {
      const x = X(hh);
      if (nowX != null && Math.abs(x - nowX) < gap) continue;
      ax += `<span class="${hh === A ? 's0' : hh === B ? 's1' : ''}" style="left:${x.toFixed(2)}%">${U.fmtClock(hh)}</span>`;
    }
    if (inWin) {
      const nx = U.clamp(nowX, 2.2 / tlW * 100 * 10, 100 - 2.2 / tlW * 100 * 10);
      ax += `<span class="now" style="left:${nx.toFixed(2)}%">${U.fmtClock(now)}</span>`;
    }
    let h = `<div class="pe-tl-cap">${cap}</div><div class="pe-tl-tr">${tr}</div><div class="pe-tl-ax">${ax}</div>`;
    if (dow >= 5) h += `<div class="pe-tl-note">Wochenende – kein Schichtbetrieb. Nächste Schicht ${esc(U.fmtDayClock(sh.endsAt))}.</div>`;
    else if (!inWin) h += `<div class="pe-tl-note">Außerhalb der Schichten (Geisterschicht): niemand im Dienst, autonome Maschinen arbeiten ihre Puffer ab.</div>`;
    R.tl.innerHTML = h;
  }

  // ---------------- Personen der laufenden Schicht
  function rosterNow(sh) {
    const Sx = S(), list = [];
    for (const pp of P().people) {
      const p = Sx.people[pp.id]; if (!p) continue;
      const mine = sh.id && p.shift === sh.id;
      if (mine || p.state !== 'offShift') list.push({ p, prev: !mine });
    }
    // laufende Schicht zuerst, Personen der Vorschicht (beenden noch / gehen) danach
    return list.filter(x => !x.prev).concat(list.filter(x => x.prev));
  }
  function miniBand(tl, t0, t1) {
    const w = 400, span = Math.max(1, t1 - t0);
    let r = '';
    for (const x of tl) for (const q of pieces(x)) {
      const a = (q.t0 - t0) / span * w, ww = Math.max(0.6, (q.t1 - q.t0) / span * w);
      r += `<rect x="${a.toFixed(1)}" y="0" width="${ww.toFixed(1)}" height="8" style="fill:${sColor(q.k)}"/>`;
    }
    return `<svg viewBox="0 0 ${w} 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${w}" height="8" style="fill:var(--track)"/>${r}</svg>`;
  }
  /** Spaltenzahl für n Karten: so viele wie passen (höchstens max), Reihen möglichst gleich voll (10 → 5+5, 7 → 4+3) */
  function balancedCols(n, width, minW, gap, max) {
    const fit = Math.max(1, Math.min(max, Math.floor((width + gap) / (minW + gap))));
    if (n <= 0) return fit;
    const rows = Math.ceil(n / fit);
    return Math.max(1, Math.ceil(n / rows));
  }
  const sinceTxt = (sec) => (sec < 60 ? '< 1 min' : U.fmtDur(Math.floor(sec / 60) * 60));
  function cardEl(p) {
    const el = document.createElement('article');
    el.className = 'pe-card'; el.dataset.id = p.id; el.tabIndex = 0; el.setAttribute('role', 'button');
    el.innerHTML = `
      <div class="pe-ch"><span class="pe-av">${esc(WF.ui.initials(p.name))}</span>
        <div class="pe-nm"><b>${esc(p.name)}</b><span data-r="role"></span></div></div>
      <div class="pe-st"><span data-r="pill"></span><span class="pe-since" data-r="since"></span></div>
      <div class="pe-act" data-r="act"></div>
      <div class="pe-rows">
        <div class="pe-r" title="Ort">${IC_PIN(13)}<span class="tx" data-r="where"></span></div>
        <div class="pe-r" data-r="taskRow">${IC_TASK(13)}<span data-r="tchip"></span><span class="tx" data-r="task"></span></div>
      </div>
      <div class="pe-foot"><div class="pe-mini" data-r="mini"></div><div class="pe-mini-ax" data-r="ax"></div>
        <div class="pe-ft"><span>Aufgabenzeit <b data-r="util">–</b></span><span data-r="tasks"></span></div></div>`;
    const r = refs(el);
    return { el, r };
  }
  function updateCards(sh, now) {
    const roster = rosterNow(sh);
    const sig = (sh.id || '-') + ':' + roster.map(x => x.p.id + (x.prev ? '*' : '')).join(',');
    if (sig !== gridSig) {
      gridSig = sig;
      const keep = {};
      R.grid.innerHTML = '';
      for (const x of roster) { const c = cards[x.p.id] || cardEl(x.p); keep[x.p.id] = c; R.grid.append(c.el); }
      for (const id in cards) if (!keep[id]) delete cards[id];
      Object.assign(cards, keep);
      if (!roster.length) R.grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">Niemand im Dienst. ${sh.id ? '' : 'Die nächste Schicht beginnt ' + esc(tclock(sh.endsAt, now)) + ' – bis dahin laufen nur autonome Maschinen (Stangenlader, Palette, Portallader) weiter.'}</div>`;
      const sel = WF.app.selected;
      for (const id in cards) cards[id].el.classList.toggle('sel', !!(sel && sel.kind === 'person' && sel.id === id));
    }
    if (!gridW) gridW = R.grid.clientWidth;
    const gc = roster.length ? balancedCols(roster.length, gridW || 1000, 212, 12, 5) : 1;
    setVar(R.grid, 'grid-template-columns', `repeat(${gc},minmax(0,1fr))`);
    const counts = {};
    const d0 = Math.floor(now / DAY) * DAY;
    for (const x of roster) {
      const p = x.p, c = cards[p.id]; if (!c) continue;
      const r = c.r, w = whereOf(p), ds = x.prev && p.state === 'idle' ? 'idle' : dstate(p), run = ds === 'tending' ? tendOf(p) : null;
      counts[ds] = (counts[ds] || 0) + 1;
      setVar(c.el, '--c', pColor(ds));
      if (c.el.dataset.state !== ds) c.el.dataset.state = ds;
      c.el.classList.toggle('o', pOutline(ds));
      c.el.classList.toggle('prev', x.prev);
      setText(r.role, x.prev ? `${p.role} · ${shiftName(p.shift)}` : p.role);
      setHTML(r.pill, pill(ds, run ? tendLabel(run) : null));
      const act = actText(p, ds, now, x.prev, true);
      setHTML(r.act, escNb(act));
      r.act.classList.toggle('dim', ds === 'idle' || ds === 'break');
      const lg = LOG[p.id], ls = lg && lg[lg.length - 1];
      const has = !!(ls && ls.s === p.state);
      setHTML(r.since, has ? `seit <b>${esc(sinceTxt(now - ls.t0))}</b>` : '');
      setAttr(r.since, 'title', has ? `${run ? tendLabel(run) : pLabel(ds)} seit ${U.fmtClock(ls.t0)}` : null);
      const sid = w.sid && st(w.sid) && (st(w.sid).kind === 'machine' || st(w.sid).kind === 'qs' || st(w.sid).kind === 'assembly') && hasDetail('machine') ? w.sid : null;
      setHTML(r.where, sid ? `<span class="link" role="button" data-sel="machine|${esc(sid)}">${esc(w.text)}</span>` : esc(w.text));
      if (p.task) {
        const tk = p.task;
        const bits = [];
        if (tk.machineId && tk.machineId !== w.sid && !tk.orderId) bits.push(esc(mLabel(tk.machineId)));
        if (tk.orderId) bits.push(hasDetail('order') ? `<span class="link" role="button" data-sel="order|${esc(tk.orderId)}">${esc(tk.orderId)}</span>` : esc(tk.orderId));
        setHTML(r.tchip, `<span class="pe-tchip" style="--c:${TASK_C[tk.type] || 'var(--st-idle)'}"><i></i><span>${esc(taskLabel(tk.type))}</span></span>`);
        setHTML(r.task, bits.join(' · '));
        r.task.classList.remove('none');
        setAttr(r.taskRow, 'title', `Aufgabe: ${tk.label || taskLabel(tk.type)}${tk.assignedT != null ? ` · zugeteilt ${U.fmtClock(tk.assignedT)} (vor ${sinceTxt(now - tk.assignedT)})` : ''}`);
      } else if (run) {
        // betreut laufende Maschinen: keine Aufgabe, aber im Einsatz – Maschinen als Verweise
        setHTML(r.tchip, '<span class="pe-tchip o" style="--c:var(--st-run)"><i></i><span>Betreuung</span></span>');
        setHTML(r.task, run.map(mid => hasDetail('machine') ? `<span class="link" role="button" data-sel="machine|${esc(mid)}">${esc(mid)}</span>` : esc(mid)).join(' · '));
        r.task.classList.remove('none');
        setAttr(r.taskRow, 'title', `Keine Aufgabe – betreut ${run.map(mLabel).join(', ')} (laufen)`);
      } else {
        setHTML(r.tchip, '');
        setHTML(r.task, 'keine Aufgabe');
        r.task.classList.add('none');
        setAttr(r.taskRow, 'title', 'Keine Aufgabe zugeteilt');
      }
      setText(r.util, p.dutySec > 0 ? U.fmtPct(p.utilToday || 0) : '–');
      setAttr(r.util.parentNode, 'title', p.dutySec > 0 ? `Aufgabenzeit ${U.fmtDur(p.workSec)} von ${U.fmtDur(p.dutySec)} im Dienst – Arbeitsschritte, Staplerfahrten und begleitete Bearbeitung; Maschinenbetreuung und Wege zählen nicht` : null);
      setHTML(r.tasks, `<b>${U.fmtNum(p.tasksToday || 0)}</b> ${(p.tasksToday || 0) === 1 ? 'Aufgabe' : 'Aufgaben'} heute`);
      const def = shiftDef(p.shift);
      if (def) {
        const a = d0 + U.hm(def.start), b = d0 + U.hm(def.end);
        const msig = Math.floor(now / 90) + '|' + (LOG[p.id] || []).length + '|' + p.state;
        if (c.msig !== msig) {
          c.msig = msig;
          const end = Math.max(b, Math.min(now, d0 + DAY));
          const tl = timeline(p.id, a, Math.min(now, end));
          r.mini.innerHTML = miniBand(tl, a, end) + (now > a && now < end ? `<span class="nw" style="left:${((now - a) / (end - a) * 100).toFixed(2)}%"></span>` : '');
          setHTML(r.ax, `<span>${def.start}</span><span>${U.fmtClock(end)}</span>`);
          const tot = totals(tl);
          setAttr(r.mini, 'title', `Verlauf ${def.start}–${U.fmtClock(end)}: Aufgabenzeit ${U.fmtDur(tot.work + tot.fork)}` + ['standby', 'tend', 'lead', 'walking', 'idle', 'break'].map(k => (tot[k] || 0) >= 60 ? ' · ' + SEG[k].label + ' ' + U.fmtDur(tot[k]) : '').join(''));
        }
      }
      setAttr(c.el, 'aria-label', `${p.name}, ${p.role}: ${run ? tendLabel(run) : pLabel(ds)} – ${act}`);
    }
    setText(R.gridT, sh.id ? `Im Dienst · ${sh.name}` : 'Im Dienst');
    setText(R.gridSub, `${roster.filter(x => x.p.state !== 'offShift').length} Personen in der Halle`);
    setHTML(R.gridLg, PST_ORDER.filter(k => counts[k]).map(k => `<span style="--c:${pColor(k)}"><i${pOutline(k) ? ' class="o"' : ''}></i>${esc(k === 'tending' ? 'Betreut Maschinen' : pLabel(k))} <b>${counts[k]}</b></span>`).join(''));
    return { roster, counts };
  }

  // ---------------- Kennzahlen
  function updateKpis(sh, now, roster, counts) {
    const Sx = S();
    const mine = roster.filter(x => !x.prev), present = roster.filter(x => x.p.state !== 'offShift');
    const size = sh.id ? P().people.filter(p => p.shift === sh.id).length : 0;
    const prev = roster.filter(x => x.prev && x.p.state !== 'offShift').length;
    if (sh.id) {
      setHTML(R.kDuty, `${mine.filter(x => x.p.state !== 'offShift').length}<small>/ ${size}</small>`);
      setText(R.kDutyS, `${sh.name}${prev ? ` · +${prev} aus Vorschicht` : ' · vollzählig'}`);
    } else { setHTML(R.kDuty, `${present.length}`); setText(R.kDutyS, present.length ? 'noch in der Halle (Schichtende)' : 'Geisterschicht – niemand im Dienst'); }
    // Im Einsatz = mit Aufgabe + betreut laufende eigene Maschinen + Schichtleitung im Leitstand
    const pres = present.map(x => ({ p: x.p, ds: x.prev && x.p.state === 'idle' ? 'idle' : dstate(x.p) }));
    const withTask = pres.filter(x => x.p.task && x.p.state !== 'break').length;
    const tendN = pres.filter(x => x.ds === 'tending').length, leadN = pres.filter(x => x.ds === 'lead').length;
    const free = pres.filter(x => x.ds === 'idle' && !x.p.task).length, brk = counts.break || 0;
    const einsatz = withTask + tendN + leadN;
    setHTML(R.kWork, present.length ? `${einsatz}<small>/ ${present.length}</small>` : '–');
    const ws = !present.length ? 'niemand im Dienst' : [`<b>${withTask}</b> mit Aufgabe`, tendN ? `<b>${tendN}</b> ${tendN === 1 ? 'betreut' : 'betreuen'} Maschinen` : '', leadN ? 'Schichtleitung' : '',
      free ? `${free} verfügbar` : '', brk ? `${brk} in der Pause` : ''].filter(Boolean).join(' · ');
    setHTML(R.kWorkS, ws);
    setAttr(R.kWorkS, 'title', present.length ? 'Im Einsatz: mit Aufgabe, an eigenen laufenden Maschinen (Betreuung) oder in der Schichtleitung. Verfügbar: ohne Aufgabe und ohne laufende Maschine.' : null);
    const tot = present.length || 1;
    setHTML(R.kDist, present.length ? PST_ORDER.filter(k => counts[k]).map(k => `<i class="${pOutline(k) ? 'o' : ''}" style="--c:${pColor(k)};flex:${counts[k] / tot}" title="${esc(k === 'tending' ? 'Betreut Maschinen' : pLabel(k))}: ${counts[k]}"></i>`).join('') : '');
    let n = 0, sum = 0;
    for (const id in Sx.people) { const p = Sx.people[id]; if (p.dutySec > 0) { n++; sum += p.utilToday || 0; } }
    setHTML(R.kUtil, n ? U.fmtPct(sum / n) : '–');
    setText(R.kUtilS, n ? 'heute · Zeit mit Arbeitsschritten ÷ Anwesenheit (ohne Betreuung und Wege)' : 'heute noch niemand im Dienst');
    setAttr(R.kUtil.parentNode, 'title', n ? `Mittel über ${n} Personen, die heute im Dienst waren. Aufgabenzeit = Arbeitsschritte, Staplerfahrten und begleitete Bearbeitung.` : null);
    const open = Object.values(Sx.tasks).filter(t => t.status === 'open');
    const waiting = open.filter(t => !t.held), held = open.length - waiting.length;
    const oldest = waiting.reduce((m, t) => Math.max(m, now - Math.max(t.createdT, SEEN[t.id] ? SEEN[t.id].t : 0)), 0);
    setHTML(R.kOpen, `${waiting.length}`);
    setText(R.kOpenS, waiting.length ? `längste wartet ${durMin(oldest)}${held ? ` · +${held} vorgemerkt` : ''}` : held ? `${held} vorgemerkt (noch nicht fällig)` : 'alle Aufgaben vergeben');
    R.kOpenBox.classList.toggle('warn', waiting.length > 0 && oldest >= 300 && !!sh.id && !sh.inBreak);
  }

  // ---------------- Offene Aufgaben
  function heldInfo(tk, now) {
    if (heldCache.t !== Math.floor(now / 30)) heldCache = { t: Math.floor(now / 30), map: {} };
    if (tk.id in heldCache.map) return heldCache.map[tk.id];
    let txt = null;
    if (tk.type === 'toolChange' && tk.machineId) {
      let mv = null; try { mv = WF.sim.machineView(tk.machineId); } catch (e) { mv = null; }
      const tl = mv && mv.tools && mv.tools.find(x => x.plannedChange);
      if (mv && mv.fault) txt = `Maschine gestört (${mv.fault.code}) – Wechsel nach der Reparatur`;
      else if (tl) txt = `Wechsel ${tl.plannedChange.text}${tl.plannedChange.withTools && tl.plannedChange.withTools.length ? ` · mit ${tl.plannedChange.withTools.length + 1} Werkzeugen` : ''} – Einrichter:in wird rechtzeitig vorher zugeteilt`;
    }
    heldCache.map[tk.id] = txt || 'noch nicht fällig – wird rechtzeitig zugeteilt';
    return heldCache.map[tk.id];
  }
  function whoFor(tk, now) {
    const Sx = S();
    const on = [], later = [];
    for (const pp of P().people) {
      const p = Sx.people[pp.id]; if (!p || !qualified(pp, tk)) continue;
      if (p.onDuty && !p.endShift && p.state !== 'offShift') on.push(p); else later.push(pp);
    }
    return { on, later };
  }
  function personState(p) {
    if (p.state === 'break') return 'Pause' + (p.breakUntil ? ' bis ' + U.fmtClock(p.breakUntil) : '');
    if (p.breakPending && !p.task) return 'geht in die Pause';
    if (p.task) return taskLabel(p.task.type) + (p.task.machineId ? ' ' + p.task.machineId : '');
    const ds = dstate(p), run = ds === 'tending' ? tendOf(p) : null;
    if (run) return 'betreut ' + run.join(', ');
    if (ds === 'lead') return 'im Leitstand';
    return pLabel(ds).toLowerCase();
  }
  function updateQueue(now) {
    const Sx = S(), sh = WF.sim.shift();
    const open = Object.values(Sx.tasks).filter(t => t.status === 'open').sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || b.prio - a.prio || a.createdT - b.createdT);
    const assignedL = Object.values(Sx.tasks).filter(t => t.status === 'assigned' && t.assignee && Sx.people[t.assignee]).sort((a, b) => b.prio - a.prio || (a.assignedT || 0) - (b.assignedT || 0));
    const assigned = assignedL.length;
    const parts = [];
    let firstHeld = true;
    const sigParts = [assigned, assignedL.map(t => t.id + t.assignee + Sx.people[t.assignee].state).join(',')];
    for (const tk of open) {
      const who = whoFor(tk, now);
      const seen = SEEN[tk.id] && SEEN[tk.id].t > tk.createdT ? SEEN[tk.id] : null;
      const since = seen ? seen.t : tk.createdT, wait = now - since;
      sigParts.push(tk.id, tk.held ? 1 : 0, Math.floor(wait / 60), tk.lateWhy || '', who.on.map(p => p.id + p.state + (p.task ? p.task.id : '')).join('.'));
      if (tk.held && firstHeld) { parts.push(`<div class="pe-q-sub">Vorgemerkt – noch nicht fällig</div>`); firstHeld = false; }
      const mid = tk.machineId || (tk.target && tk.target.id);
      const sel = tk.machineId && hasDetail('machine') ? `data-sel="machine|${esc(tk.machineId)}"` : '';
      const c = TASK_C[tk.type] || 'var(--st-idle)';
      let body = '';
      if (tk.held) body = `<div class="pe-qi-who">${esc(heldInfo(tk, now))}</div>`;
      else {
        const free = who.on.filter(p => !p.task && p.state !== 'break' && !p.breakPending);
        let whoTxt;
        if (!who.on.length) {
          const nx = nextShift(sh, now);
          const nxt = who.later.filter(p => p.shift === nx.def.id), other = who.later.filter(p => p.shift !== nx.def.id);
          whoTxt = `<b>Niemand Qualifiziertes im Dienst.</b> ${nxt.length ? `Übernimmt die ${esc(nx.def.name)} ab ${esc(tclock(nx.startT, now))}: ${nxt.slice(0, 3).map(p => esc(shortName(p.name))).join(', ')}${nxt.length > 3 ? ' +' + (nxt.length - 3) : ''}.`
            : other.length ? `Qualifiziert nur in der ${esc(shiftName(other[0].shift))}: ${other.slice(0, 3).map(p => esc(shortName(p.name))).join(', ')}.` : 'Keine Person mit dieser Qualifikation.'}`;
        } else whoTxt = 'Qualifiziert im Dienst: ' + who.on.slice(0, 4).map(p => `<b>${esc(shortName(p.name))}</b> (${esc(personState(p))})`).join(', ') + (who.on.length > 4 ? ` +${who.on.length - 4}` : '');
        body = `<div class="pe-qi-who">${seen && S().people[seen.by] ? `Zurückgegeben von <b>${esc(shortName(S().people[seen.by].name))}</b> um ${esc(U.fmtClock(seen.t))}${S().people[seen.by].state === 'break' || S().people[seen.by].breakPending ? ' (Pause)' : S().people[seen.by].endShift || S().people[seen.by].state === 'offShift' ? ' (Schichtende)' : ''}. ` : ''}${whoTxt}</div>`;
        let why = tk.lateWhy || null;
        if (!why && who.on.length && !free.length) {
          const brk = who.on.filter(p => p.state === 'break' || p.breakPending);
          why = brk.length === who.on.length ? `Alle Qualifizierten in der Pause${brk[0].breakUntil ? ' bis ' + U.fmtClock(brk[0].breakUntil) : ''}` : 'Alle Qualifizierten sind mit anderen Aufgaben beschäftigt – Vergabe nach Priorität, sobald jemand frei wird';
        }
        if (why) body += `<div class="pe-qi-why">${icon('alert', 14)}<span>${esc(why)}</span></div>`;
      }
      parts.push(`<div class="pe-qi${tk.held ? ' held' : ''}" ${sel}>
        <div class="pe-qi-h"><span class="pe-tchip" style="--c:${c}"><i></i><span>${esc(taskLabel(tk.type))}</span></span><b>${esc(mid ? mLabel(mid) : '')}${tk.orderId ? ' · ' + esc(tk.orderId) : ''}</b>
          <span class="pe-wait${!tk.held && wait >= 300 && who.on.some(p => p.state !== 'break' && !p.breakPending) ? ' warn' : ''}" title="${seen ? 'angelegt ' + esc(U.fmtClock(tk.createdT)) + ', zurückgegeben ' + esc(U.fmtClock(seen.t)) : 'angelegt ' + esc(U.fmtClock(tk.createdT))}">${tk.held ? 'seit ' + esc(U.fmtClock(tk.createdT)) : (seen ? 'wieder offen ' : 'wartet ') + esc(durMin(wait))}</span></div>
        ${body}</div>`);
    }
    const sig = sigParts.join('|');
    if (sig === qSig || (R.q._hover && qSig)) return;
    qSig = sig;
    const waiting = open.filter(t => !t.held).length;
    setText(R.qSub, `${waiting} wartend${open.length - waiting ? ` · ${open.length - waiting} vorgemerkt` : ''} · ${assigned} vergeben`);
    const empty = parts.length ? '' : `<div class="pe-q-empty">${icon('check', 20)}<span>Jede Aufgabe hat eine Person. Neue Aufgaben (Rüsten, Einlegen, Werkzeugwechsel, Prüfen, Transporte) erscheinen hier, solange niemand Qualifiziertes frei ist.</span></div>`;
    // darunter: wer gerade woran arbeitet (vergebene Aufgaben) – Informationsfluss von der Aufgabe zur Person
    const busy = assignedL.length ? `<div class="pe-q-sub">In Arbeit · ${assignedL.length} vergeben</div>` + assignedL.map(tk => {
      const p = Sx.people[tk.assignee], mid = tk.machineId || (tk.target && tk.target.id);
      return `<div class="pe-qa" data-sel="person|${esc(p.id)}" title="${esc(p.name)}: ${esc(p.activity || '')}"><span class="pe-tchip" style="--c:${TASK_C[tk.type] || 'var(--st-idle)'}"><i></i><span>${esc(taskLabel(tk.type))}</span></span>
        <span class="w">${esc(mid ? mLabel(mid) : '')}${tk.orderId ? ' · ' + esc(tk.orderId) : ''}</span><span class="who" style="--c:${pColor(dstate(p))}"><i></i>${esc(shortName(p.name))}</span></div>`;
    }).join('') : '';
    R.q.innerHTML = parts.length ? parts.join('') + busy : (assignedL.length ? `<div class="pe-q-empty sm">${icon('check', 16)}<span>Keine Aufgabe wartet – jede hat eine Person.</span></div>` + busy : empty);
  }

  // ---------------- Nächste Schicht (kompakte Leiste)
  function skillSummary(pp) {
    const m = pp.skills.filter(k => SKILL[k] && k !== 'lead' && cols().some(c => c.kind === 'm' && c.key === k));
    const a = pp.skills.filter(k => ACT_COLS.includes(k));
    if (pp.skills.includes('setup') && m.length >= 6) return 'Einrichten aller CNC-Maschinen' + (pp.skills.includes('repair') ? ' · Instandhaltung' : '');
    const own = pp.machines.length ? pp.machines.join(', ') : '';
    const lbl = m.map(k => SKILL[k]).concat(a.map(k => SKILL[k])).slice(0, 3).join(', ');
    return (lbl || pp.role) + (own ? ' · ' + own : '');
  }
  function updateNext(now) {
    const sh = WF.sim.shift(), nx = nextShift(sh, now);
    const list = P().people.filter(p => p.shift === nx.def.id);
    const Sx = S();
    if (!nxW) nxW = R.nx.clientWidth;
    const nc = balancedCols(list.length, nxW - 24 || 1000, 140, 8, 7);
    const sig = nx.def.id + nx.startT + '|' + list.map(p => Sx.people[p.id].state).join(',') + '|' + Math.floor((nx.startT - now) / 60) + '|' + nc;
    if (sig === nxSig || (R.nx._hover && nxSig)) return;
    nxSig = sig;
    R.nx.style.gridTemplateColumns = `repeat(${nc},minmax(0,1fr))`;
    setText(R.nxT, `Nächste Schicht · ${nx.def.name}`);
    setText(R.nxSub, `${list.length} Personen · ab ${tclock(nx.startT, now)} · in ${U.fmtDur(Math.max(0, nx.startT - now))}`);
    R.nx.innerHTML = list.map(pp => {
      const p = Sx.people[pp.id], here = p && p.state !== 'offShift';
      return `<button class="pe-nxp" data-id="${esc(pp.id)}" title="${esc(pp.name)} – ${esc(pp.role)} · ${esc(skillSummary(pp))}${here ? ' · schon in der Halle' : ''}"><span class="avatar">${esc(WF.ui.initials(pp.name))}</span>
        <span><b>${esc(pp.name)}</b><small>${esc(pp.role)}</small></span>${here ? '<em aria-label="in der Halle"></em>' : ''}</button>`;
    }).join('');
  }

  // ---------------- Qualifikationsmatrix (laufende Schicht offen, andere Schicht eingeklappt)
  function defaultOpenShift(sh) { return sh.id || nextShift(sh, S().t).def.id; }
  function isOpen(id) { const sh = WF.sim.shift(); return id in mxOpen ? mxOpen[id] : id === defaultOpenShift(sh); }
  function keyRisks(shiftId) {
    const b = bottlenecks(shiftId);
    return { b, key: Object.entries(b.byPerson).filter(([, its]) => its.length >= 3) };
  }
  function renderMatrix(sh) {
    const Sx = S();
    // Schichtwechsel: Nutzerwahl verwerfen, die neue laufende Schicht ist offen
    const cur = defaultOpenShift(sh);
    if (mxShift !== cur) { mxShift = cur; for (const k in mxOpen) delete mxOpen[k]; }
    const opens = P().shifts.map(d => isOpen(d.id) ? 1 : 0).join('');
    const sig = (sh.id || '-') + '|' + opens;
    if (sig === mxSig) { patchMatrix(); return; }
    mxSig = sig;
    const C = cols(), mc = C.filter(c => c.kind === 'm'), ac = C.filter(c => c.kind === 'a');
    let h = `<table class="pe-mx"><thead>
      <tr class="grp"><th class="nm"></th><th class="g" colspan="${mc.length}">Maschinen bedienen</th><th class="g sep" colspan="${ac.length}">Tätigkeiten</th></tr>
      <tr><th class="nm" style="text-align:left;padding-left:14px">Person</th>${C.map((c, i) => `<th class="${i === mc.length ? 'sep' : ''}" title="${esc(SKILL[c.key])}${c.machines.length ? ' · ' + esc(c.machines.map(mLabel).join(', ')) : ''}">${SKILL_HEAD[c.key]}${c.machines.length ? `<small>${esc(c.machines.join(' '))}</small>` : '<small>&nbsp;</small>'}</th>`).join('')}</tr></thead><tbody>`;
    for (const def of P().shifts) {
      const people = P().people.filter(p => p.shift === def.id);
      const cov = coverage(def.id);
      const running = sh.id === def.id, open = isOpen(def.id);
      const { b, key } = keyRisks(def.id);
      const warn = key.length
        ? key.map(([pid]) => `<span class="pe-shr-w crit">${icon('alert', 13)}Klumpenrisiko ${esc(P().people.find(x => x.id === pid).name)}</span>`).join('')
        : '';
      h += `<tr class="shr${open ? ' open' : ''}" data-shift="${esc(def.id)}" tabindex="0" role="button" aria-expanded="${open}" title="${open ? 'Einklappen' : 'Aufklappen'}"><td class="nm" colspan="${C.length + 1}"><div class="pe-shr">${icon('chevron', 14)}<b>${esc(def.name)}</b><span>${def.start}–${def.end} · ${people.length} Personen</span>${running ? '<em>läuft</em>' : ''}${warn}<span class="pe-shr-n">${b.items.length} Engpässe</span></div></td></tr>`;
      if (!open) continue;
      for (const pp of people) {
        const p = Sx.people[pp.id];
        h += `<tr class="pr" data-id="${esc(pp.id)}"><td class="nm"><div class="pe-mx-p"><span class="avatar">${esc(WF.ui.initials(pp.name))}</span><div><b>${esc(pp.name)}</b><span>${esc(pp.role)}</span></div><i data-live="${esc(pp.id)}"${p && p.state !== 'offShift' ? ` style="--c:${pColor(dstate(p))}" title="${esc(pLabel(dstate(p)))}"` : ' hidden'}></i></div></td>`;
        C.forEach((c, i) => {
          const lv = level(pp, c), cv = cov[c.key];
          const spof = lv && cv.flag && ((cv.full.length === 1 && cv.full[0].id === pp.id && lv !== 'own' && lv !== 'sub') || (cv.full.length + cv.part.length === 1));
          h += `<td class="${i === mc.length ? 'sep' : ''}${spof ? ' spof' : ''}" title="${esc(levelTip(pp, c, lv))}${spof ? ' – Engpass: ' + esc(cv.note) : ''}"><i class="pe-d ${lv || 'none'}"></i></td>`;
        });
        h += '</tr>';
      }
      h += `<tr class="cov"><td class="nm">Abdeckung ${esc(def.name)}</td>${C.map((c, i) => {
        const cv = cov[c.key], n = cv.full.length, pn = cv.part.length;
        const tip = cv.flag ? cv.note : `${SKILL[c.key]}: ${n} qualifiziert${pn ? `, ${pn} eingeschränkt` : ''}`;
        const weak = cv.weak && cv.weak.length ? ' · nur eine Person: ' + cv.weak.map(w => w.id + (w.who[0] ? ' (' + shortName(w.who[0].name) + ')' : ' (niemand)')).join(', ') : '';
        return `<td class="${i === mc.length ? 'sep' : ''}" title="${esc(tip + weak)}"><span class="pe-cv ${cv.flag || ''}">${n}${pn ? `<small>+${pn}</small>` : ''}</span></td>`;
      }).join('')}</tr>`;
    }
    h += '</tbody></table>';
    const sx = R.mx.scrollLeft;
    R.mx.innerHTML = h;
    R.mx.scrollLeft = sx;
    const sel = WF.app.selected;
    if (sel && sel.kind === 'person') R.mx.querySelectorAll('tr[data-id]').forEach(r => r.classList.toggle('on', r.dataset.id === sel.id));
    liveDots = null;
    patchMatrix();
  }
  let liveDots = null;
  function patchMatrix() {
    const Sx = S();
    if (!liveDots) liveDots = [...R.mx.querySelectorAll('[data-live]')];
    for (const d of liveDots) {
      const p = Sx.people[d.dataset.live];
      const on = !!(p && p.state !== 'offShift');
      setAttr(d, 'hidden', !on);
      if (on) { const ds = dstate(p); setVar(d, '--c', pColor(ds)); d.classList.toggle('o', pOutline(ds)); setAttr(d, 'title', pLabel(ds) + ' – ' + actText(p, ds, Sx.t, false)); }
    }
  }
  function renderBottlenecks(sh) {
    const shown = P().shifts.filter(d => isOpen(d.id));
    const sig = (sh.id || '-') + '|' + shown.map(d => d.id).join(',');
    if (sig === bnSig) return;
    bnSig = sig;
    R.bn.classList.toggle('one', shown.length === 1);
    R.bn.innerHTML = shown.map(def => {
      const { b, key } = keyRisks(def.id);
      const head = [], rows = [];
      for (const [pid, its] of key) {
        const pp = P().people.find(x => x.id === pid);
        head.push(`<div class="pe-bn-i key">${icon('alert', 15)}<span><b>Klumpenrisiko ${esc(pp.name)}:</b> einzige Person der ${esc(def.name)} für ${its.map(i => esc(SKILL[i.key])).join(', ')}. Fällt ${esc(pp.name.split(' ')[0])} aus, stehen diese Aufgaben bis zur nächsten Schicht.</span></div>`);
      }
      for (const it of b.items) {
        if (it.person && key.some(([pid]) => pid === it.person)) continue;
        rows.push(`<div class="pe-bn-i ${it.flag}">${icon(it.flag === 'crit' ? 'x' : 'user', 15)}<span>${esc(it.text)}</span></div>`);
      }
      return `<div class="pe-bn-s"><h4>Engpässe ${esc(def.name)}<em>${b.items.length} von ${cols().length} Qualifikationen</em></h4>${head.join('')}<div class="pe-bn-l">${rows.join('') || (head.length ? '' : '<div class="muted" style="font-size:var(--fs-sm)">Jede Qualifikation ist mindestens doppelt besetzt.</div>')}</div></div>`;
    }).join('');
  }

  function update() {
    if (!root || !WF.sim || !S()) return;
    sample();
    const now = S().t, sh = WF.sim.shift();
    updateHead(now);
    updateMap(now);
    const { roster, counts } = updateCards(sh, now);
    updateKpis(sh, now, roster, counts);
    updateQueue(now);
    updateNext(now);
    renderMatrix(sh);
    renderBottlenecks(sh);
  }

  WF.registerView({ id: 'personal', title: 'Personal', icon: 'users', group: 'ressourcen', order: 6, mount, show() { gridSig = ''; }, update, frame: mapFrame,
    badge() { const Sx = S(); if (!Sx || !Sx.tasks) return ''; let n = 0; for (const id in Sx.tasks) { const t = Sx.tasks[id]; if (t.status === 'open' && !t.held) n++; } return n ? String(n) : ''; } });

  // ------------------------------------------------------------------ Detail „person“
  function bandSvg(tl, t0, t1) {
    const w = 1000, span = Math.max(1, t1 - t0);
    let r = '';
    for (const s of tl) for (const q of pieces(s)) {
      const x = (q.t0 - t0) / span * w, ww = Math.max(0.8, (q.t1 - q.t0) / span * w);
      r += `<rect x="${x.toFixed(2)}" y="0" width="${ww.toFixed(2)}" height="22" style="fill:${sColor(q.k)}"><title>${esc(U.fmtClock(s.t0))}–${esc(U.fmtClock(s.t1))} ${esc(pLabel(s.state))}${q.work ? ' · ' + esc(U.fmtDur(q.t1 - q.t0)) + ' Aufgabenzeit' : s.state === 'working' ? ' · Bereitschaft ' + esc(U.fmtDur(q.t1 - q.t0)) : ''}${s.label ? ' · ' + esc(s.label) : ''}</title></rect>`;
    }
    return `<svg viewBox="0 0 ${w} 22" preserveAspectRatio="none" aria-hidden="true"><rect width="${w}" height="22" style="fill:var(--track)"/>${r}</svg>`;
  }
  WF.registerDetail('person', (id) => {
    const pp = P().people.find(x => x.id === id);
    if (!pp) return null;
    const def = shiftDef(pp.shift);
    let sig = {};
    const body = {};
    function window0(now) {
      const d0 = Math.floor(now / DAY) * DAY, a = d0 + U.hm(def.start), b = d0 + U.hm(def.end);
      const segs = (LOG[id] || []).filter(x => x.t1 > d0 && x.s !== 'offShift');
      let lo = a, hi = b;
      for (const x of segs) { lo = Math.min(lo, Math.max(d0, x.t0)); hi = Math.max(hi, x.t1); }
      const wk = Math.floor(now / DAY) % 7 >= 5;
      return { a: lo, b: Math.max(hi, Math.min(now, hi)), d0, started: segs.length > 0 || (!wk && now >= a) };
    }
    function render(el) {
      sig = {};
      el.innerHTML = `
        <section><div class="pe-dh">
          <div class="pe-dh-st"><span data-r="pill"></span><small data-r="since"></small></div>
          <div class="pe-dh-act" data-r="act"></div>
          <div class="pe-dh-where">${IC_PIN(14)}<span data-r="where"></span></div>
        </div></section>
        <section data-r="taskSec"><h4>Aktuelle Aufgabe</h4><div data-r="task"></div></section>
        <section><h4>Heute</h4><div class="pe-stats">
          <div class="pe-s" title="Zeit mit Arbeitsschritten ÷ Anwesenheit – Betreuung laufender Maschinen und Wege zählen nicht"><span class="l">Aufgabenanteil</span><span class="v" data-r="util">–</span><span class="bar" data-r="ubar"><i></i></span></div>
          <div class="pe-s"><span class="l">Aufgabenzeit</span><span class="v" data-r="work">–</span><span class="muted" data-r="duty"></span></div>
          <div class="pe-s"><span class="l">Aufgaben</span><span class="v" data-r="tasks">–</span><span class="muted">heute übernommen</span></div>
        </div></section>
        <section><h4>Verlauf heute</h4><div data-r="band"></div></section>
        <section><h4>Zuletzt bearbeitet</h4><div data-r="recent"></div></section>
        <section><h4>Qualifikationen</h4><div data-r="skills"></div></section>
        <section data-r="riskSec"><h4>Vertretung &amp; Engpässe</h4><div data-r="risk"></div></section>`;
      Object.assign(body, refs(el));
      el.addEventListener('click', (e) => { const lk = e.target.closest('[data-sel]'); if (lk) { const [k, i] = lk.dataset.sel.split('|'); WF.app.select(k, i); } });
      renderStatic();
      update(el);
    }
    function renderStatic() {
      const C = cols();
      const mach = C.filter(c => c.kind === 'm' && pp.skills.includes(c.key));
      const acts = C.filter(c => c.kind === 'a').map(c => ({ c, lv: level(pp, c) })).filter(x => x.lv);
      const own = pp.machines.map(mid => `<span class="chip stamm" data-sel="machine|${esc(mid)}" title="Stammarbeitsplatz">${esc(mLabel(mid))}</span>`).join('');
      // eine Liste mit Zeilenbeschriftung statt gestapelter Überschriften – leere Gruppen als „–“
      const actChips = acts.map(x => `<span class="chip" title="${esc(levelTip(pp, x.c, x.lv))}">${esc(SKILL[x.c.key])}${x.lv === 'own' ? ' (eigene Maschinen)' : x.lv === 'sub' ? ' (vertretend)' : ''}</span>`).join('') + (pp.skills.includes('lead') ? '<span class="chip info">Schichtleitung</span>' : '');
      const row = (k, chips) => `<span class="k">${esc(k)}</span>${chips ? `<div class="pe-chips">${chips}</div>` : '<span class="none">–</span>'}`;
      body.skills.innerHTML = `<div class="pe-ql">
        ${own ? row('Stammarbeitsplätze', own) : ''}
        ${row('Maschinen', mach.map(c => `<span class="chip" title="${esc(c.machines.map(mLabel).join(', '))}">${esc(SKILL[c.key])}</span>`).join(''))}
        ${row('Tätigkeiten', actChips)}
      </div>`;
      const b = bottlenecks(pp.shift), mine = b.byPerson[pp.id] || [];
      const subs = [];
      for (const c of C) {
        if (c.kind !== 'm' || !pp.skills.includes(c.key)) continue;
        const others = P().people.filter(x => x.id !== pp.id && x.shift === pp.shift && x.skills.includes(c.key));
        if (others.length) subs.push(`${SKILL[c.key]}: ${others.map(x => shortName(x.name)).join(', ')}`);
      }
      body.risk.innerHTML = (mine.length ? `<div class="pe-risk">${icon('alert', 15)}<span>Einzige Person der ${esc(def.name)} für <b>${mine.map(i => esc(SKILL[i.key])).join(', ')}</b>.</span></div>` : '') +
        (subs.length ? `<div class="pe-subs" style="margin-top:${mine.length ? 8 : 0}px">Vertretung in der Schicht – ${subs.map(esc).join(' · ')}</div>` : (mine.length ? '' : '<div class="pe-subs">Keine Engpass-Qualifikation.</div>'));
    }
    function update(el) {
      const Sx = S(); if (!Sx) return;
      const p = Sx.people[id], now = Sx.t; if (!p) return;
      sample();
      const w = whereOf(p);
      const ds = dstate(p), run = ds === 'tending' ? tendOf(p) : null;
      setHTML(body.pill, pill(ds, run ? tendLabel(run) : null));
      const segs = LOG[id] || [], last = segs[segs.length - 1];
      setText(body.since, last && last.s === p.state && last.t0 > Sx.t - DAY ? `seit ${U.fmtClock(last.t0)} (${durMin(now - last.t0)})` : '');
      let act = actText(p, ds, now, false);
      if (p.state === 'offShift') act = `Nicht im Dienst – ${def.name} ${def.start}–${def.end}`;
      setHTML(body.act, escNb(act));
      const sid = w.sid && st(w.sid) && (st(w.sid).kind === 'machine' || st(w.sid).kind === 'qs' || st(w.sid).kind === 'assembly') ? w.sid : null;
      setHTML(body.where, sid ? `<button class="link" data-sel="machine|${esc(sid)}">${esc(w.text)}</button>` : esc(w.text));
      // aktuelle Aufgabe
      const tk = p.task;
      const tsig = tk ? tk.id + '|' + tk.si + '|' + Math.floor((now - (tk.assignedT || now)) / 60) : '-|' + ds + '|' + (run ? run.join(',') + '|' + Math.floor(now / 15) : '');
      if (sig.task !== tsig) {
        sig.task = tsig;
        if (tk) {
          const c = TASK_C[tk.type] || 'var(--info)';
          const ACT = { setup: 'Rüsten', corr: 'Korrigieren', load: 'Einlegen', fetch: 'Werkzeug holen', tc: 'Wechseln', repair: 'Reparieren', fpiPick: 'Erstteil entnehmen',
            fpiMeasure: 'Messen', offset: 'Korrektur eingeben', flPick: 'Aufnehmen', flDrop: 'Abstellen', barsPick: 'Stangen entnehmen', barsLoad: 'Stangen laden' };
          const where = (to) => { const x = st(to); return x ? (x.kind === 'machine' || x.kind === 'assembly' ? to : x.short) : to; };
          const stepTxt = (s) => s.k === 'walk' ? 'Weg zu ' + where(s.to) : s.k === 'drive' ? 'Fahrt zu ' + where(s.to) : s.k === 'toForklift' ? 'zum Stapler' : s.k === 'attend' ? (tk.type === 'assembly' ? 'Montieren' : 'Prüfen') : s.k === 'hold' ? 'Warten (KMG)' : s.k === 'wait' ? 'Bereit (Zyklusende)' : (ACT[s.act] || s.label || 'Arbeit');
          const steps = (tk.steps || []).map((x, k) => `<span class="pe-step${k < tk.si ? ' done' : k === tk.si ? ' cur' : ''}">${k < tk.si ? icon('check', 11) : ''}${esc(stepTxt(x))}</span>`).join('<span class="pe-step-ar">›</span>');
          body.task.innerHTML = `<div class="pe-box" style="--c:${c}">
            <div class="pe-box-h"><span class="pe-tchip" style="--c:${c}"><i></i><span>${esc(taskLabel(tk.type))}</span></span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tk.label || '')}</span><small>${tk.assignedT != null ? 'seit ' + esc(U.fmtClock(tk.assignedT)) : ''}</small></div>
            <div class="row">${tk.machineId ? `<button class="link" data-sel="machine|${esc(tk.machineId)}">${esc(mLabel(tk.machineId))}</button>` : ''}${tk.orderId ? `<span class="faint">·</span><button class="link" data-sel="order|${esc(tk.orderId)}">${esc(tk.orderId)}${tk.seq != null ? ' AG ' + tk.seq : ''}</button>` : ''}<span class="spacer"></span><span class="muted" style="font-size:var(--fs-xs)" data-live="rem"></span></div>
            <div class="pe-steps">${steps}</div>
          </div>`;
        } else if (run) {
          // betreut laufende Maschinen: je Maschine Zustand und nächster Eingriff laut Engine
          body.task.innerHTML = `<div class="pe-tend">${run.map(mid => {
            const m = Sx.machines[mid], nx = nextStep(mid, now), S0 = WF.STATE[m.state] || WF.STATE.idle;
            return `<div class="pe-tend-r"><button class="link pe-tend-k" data-sel="machine|${esc(mid)}"><span class="k">${esc(mid)}</span></button><span class="t">${esc(st(mid).short)} · ${esc(S0.label)}${m.cause ? ' – ' + esc(m.cause) : ''}</span>${nx ? `<span class="n">${esc(nx.what)} ca. <b>${esc(tclock(Math.max(nx.t, now), now))}</b></span>` : '<span class="n">läuft autonom</span>'}</div>`;
          }).join('')}</div><div class="pe-subs" style="margin-top:6px">Keine Aufgabe – betreut die eigenen laufenden Maschinen. Die Engine teilt die nächste Aufgabe zu, sobald eine Maschine einen Eingriff braucht.</div>`;
        } else body.task.innerHTML = `<div class="pe-subs">${p.state === 'offShift' ? 'Nicht im Dienst.' : ds === 'lead' ? 'Keine Aufgabe – leitet die Schicht im Leitstand und übernimmt Rüsten oder Werkzeugwechsel, wenn sonst niemand frei ist.' : 'Keine Aufgabe zugeteilt – die Engine vergibt die nächste passende Aufgabe nach Priorität und Weg.'}</div>`;
      }
      const remEl = body.task.querySelector('[data-live="rem"]');
      if (remEl) setText(remEl, p.workRem > 0 ? 'Arbeitsschritt noch ' + U.fmtDur(p.workRem) : p.state === 'walking' || p.state === 'driving' ? 'unterwegs' : '');
      // Kennzahlen heute (Engine)
      const u = p.utilToday || 0;
      setText(body.util, p.dutySec > 0 ? U.fmtPct(u) : '–');
      setHTML(body.ubar, `<i style="width:${(u * 100).toFixed(1)}%;background:${u >= 0.85 ? 'var(--st-wait)' : 'var(--st-run)'}"></i>`);
      setHTML(body.work, p.workSec > 0 ? esc(U.fmtDur(p.workSec)) : '–');
      setText(body.duty, p.dutySec > 0 ? 'von ' + U.fmtDur(p.dutySec) + ' im Dienst' : 'heute noch nicht im Dienst');
      setText(body.tasks, U.fmtNum(p.tasksToday || 0));
      // Verlauf – dunkelgrün = Arbeitszeit der Engine, daher steht in der Legende dieselbe Zahl wie in der Kachel
      const win = window0(now);
      const bsig = Math.floor(now / 30) + '|' + segs.length + '|' + Math.floor((p.workSec || 0) / 60);
      if (sig.band !== bsig) {
        sig.band = bsig;
        const end = Math.min(win.b, Math.max(now, win.a));
        const tl = timeline(id, win.a, Math.min(end, now));
        const wkend = Math.floor(now / DAY) % 7 >= 5;
        if (!win.started) body.band.innerHTML = `<div class="muted" style="font-size:var(--fs-sm)">${wkend ? 'Wochenende – heute keine Schicht.' : `${esc(def.name)} beginnt ${esc(U.fmtClock(win.a))} – noch kein Verlauf für heute.`}</div>`;
        else {
          const tot = totals(tl);
          const ax = [];
          for (let h = Math.ceil(win.a / 3600) * 3600; h <= win.b; h += 3600) if ((h - win.a) % 7200 === 0 || win.b - win.a <= 6 * 3600) ax.push(h);
          const X = (t) => ((t - win.a) / Math.max(1, win.b - win.a) * 100).toFixed(2);
          const nowX = now < win.b ? `<div style="position:absolute;top:-2px;bottom:-2px;left:${X(now)}%;border-left:2px solid var(--accent)"></div>` : '';
          const lg = [`<span class="main" style="--c:${SEG.work.c}"><i></i>Aufgabenzeit <b>${esc(p.workSec > 0 ? U.fmtDur(p.workSec) : '–')}</b></span>`]
            .concat(['standby', 'tend', 'lead', 'walking', 'idle', 'break'].filter(k => (tot[k] || 0) >= 30).map(k => `<span style="--c:${SEG[k].c}"><i></i>${esc(SEG[k].label)} <b>${esc(U.fmtDur(tot[k]))}</b></span>`));
          if (tot.fork >= 30) lg.splice(1, 0, `<span style="--c:${SEG.driving.c}"><i></i>davon Stapler <b>${esc(U.fmtDur(tot.fork))}</b></span>`);
          body.band.innerHTML = `<div class="pe-band-d"><div style="position:relative">${bandSvg(tl, win.a, win.b)}${nowX}</div>
            <div class="pe-band-ax"><span style="left:0">${esc(U.fmtClock(win.a))}</span>${ax.filter(h => h > win.a + 1800 && h < win.b - 1800).map(h => `<span style="left:${X(h)}%">${esc(U.fmtClock(h))}</span>`).join('')}<span style="left:100%">${esc(U.fmtClock(win.b))}</span></div>
            <div class="pe-band-lg">${lg.join('')}</div>
            <div class="pe-band-note">Dunkelgrün = Aufgabenzeit wie in der Kachel oben (Arbeitsschritte, Staplerfahrten, begleitete Bearbeitung). Hellgrün = an der Maschine, aber ohne Arbeitsschritt (wartet auf Zyklusende oder Messmaschine). Blassgrün = ohne Aufgabe an den eigenen laufenden Maschinen (Betreuung). Beides zählt nicht zum Aufgabenzeit-Anteil.</div></div>`;
        }
        const rec = recentTasks(id, 8);
        body.recent.innerHTML = rec.length ? `<div class="pe-tl-list">${rec.map(r => `<div class="pe-tli${r.active ? ' on' : ''}" style="--c:${TASK_C[r.type] || 'var(--st-idle)'}">
            <span class="t">${esc(tclock(r.t0, now))}${r.active ? ' –' : '–' + esc(U.fmtClock(r.t1))}</span>
            <span class="lb"><b>${esc(taskLabel(r.type))}</b> ${esc(r.machineId ? mLabel(r.machineId) : '')}${r.orderId ? ' · ' + esc(r.orderId) : ''}</span>
            <span class="d">${r.active ? 'läuft' : esc(U.fmtDur(Math.max(60, r.t1 - r.t0)))}</span></div>`).join('')}</div>`
          : `<div class="muted" style="font-size:var(--fs-sm)">${p.state === 'offShift' ? 'Heute noch keine Aufgaben.' : 'Noch keine Aufgabe aufgezeichnet.'}</div>`;
      }
    }
    return {
      title: pp.name,
      subtitle: `${esc(pp.role)} · ${esc(def.name)} ${def.start}–${def.end}`,
      render, update,
      askPrompt: `Was macht ${pp.name} (${pp.role}) gerade, wie ausgelastet ist ${/in$/.test(pp.role) ? 'sie' : 'er'} heute, und welche offenen Aufgaben könnte ${/in$/.test(pp.role) ? 'sie' : 'er'} übernehmen?`,
    };
  });

  WF.people = { whereOf, qualified: (personId, task) => { const pp = P().people.find(x => x.id === personId); return !!(pp && task && qualified(pp, task)); },
    coverage, bottlenecks, timeline, recentTasks, workCheck,
    /** Anzeige-Zustand wie in der Personalansicht: { key ('working'|'tending'|'lead'|'idle'|…), label, machines (betreute, laufende) } */
    displayState: (personId) => { const p = S() && S().people[personId]; if (!p) return null; const k = dstate(p), run = k === 'tending' ? tendOf(p) : null; return { key: k, label: run ? tendLabel(run) : pLabel(k), machines: run || [] }; } };
})();
