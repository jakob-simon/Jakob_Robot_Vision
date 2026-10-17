/* werkfluss – Ansicht „Personal“ (47_people.js) + Detail „person“.
   Schichtkopf (laufende Schicht, Schichtwechsel, nächste Pause, Schichtleitung, Schichtmodell des Tages),
   Kennzahlen, darunter ein Band aus Lageplan (wer ist wo) und offenen Aufgaben ohne Person (wer wäre qualifiziert,
   warum wartet es), dann die Personenkarten der laufenden Schicht als strenges Raster (Zustand + Dauer, Tätigkeit,
   Ort, Aufgabe, Tagesverlauf), die nächste Schicht kompakt und die Qualifikationsmatrix mit Engpass-Analyse
   (laufende Schicht aufgeklappt, andere Schicht einklappbar).
   Nur lesen (WF.sim.state). Der Tagesverlauf je Person wird lokal aufgezeichnet (Engine speichert keine
   Personen-Historie): Stichprobe bei jedem Sim-Ereignis (auch während des Vorrechnens) und alle 250 ms. Je Abschnitt
   wird der Zuwachs des Engine-Zählers workSec mitgeschrieben – die dunkelgrüne Arbeitszeit im Verlauf ist damit
   exakt die Arbeitszeit der Engine (eine Wahrheit mit Kachel „Arbeitszeit“ und Auslastung).
   Öffentlich: WF.people = { whereOf, qualified, coverage, bottlenecks, timeline, recentTasks, workCheck }. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;
  const DAY = 86400;

  // ------------------------------------------------------------------ Konstanten
  const PST = {
    working: { c: 'var(--st-run)', label: 'Arbeitet' },
    driving: { c: 'var(--mat)', label: 'Fährt Stapler' },
    walking: { c: 'var(--info)', label: 'Unterwegs' },
    idle: { c: 'var(--st-idle)', label: 'Verfügbar' },
    break: { c: 'var(--st-wait)', label: 'Pause' },
    offShift: { c: 'var(--faint)', label: 'Nicht im Dienst' },
  };
  const PST_ORDER = ['working', 'driving', 'walking', 'idle', 'break'];
  // Verlauf: je Abschnitt zuerst die Arbeitszeit laut Engine (workSec-Zuwachs: Arbeitsschritte, Staplerfahrten,
  // begleitete Bearbeitung), der Rest nach Zustand – „arbeitet“ ohne Zählerzuwachs = Bereitschaft an der Maschine.
  const SEG = {
    work: { c: 'var(--st-run)', label: 'Arbeitszeit' },
    standby: { c: 'color-mix(in srgb,var(--st-run) 38%,var(--track))', label: 'Bereitschaft an der Maschine' },
    driving: { c: 'var(--mat)', label: 'Fährt Stapler' },
    walking: { c: 'var(--info)', label: 'Unterwegs' },
    idle: { c: 'var(--st-idle)', label: 'Verfügbar' },
    break: { c: 'var(--st-wait)', label: 'Pause' },
  };
  const SEG_ORDER = ['work', 'standby', 'driving', 'walking', 'idle', 'break'];
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
  const pLabel = (state) => (WF.sim.LABELS && WF.sim.LABELS.person && WF.sim.LABELS.person[state]) || (PST[state] || {}).label || state;
  const pColor = (state) => (PST[state] || PST.idle).c;
  const shiftDef = (id) => P().shifts.find(s => s.id === id) || null;
  const shiftName = (id) => (shiftDef(id) || {}).name || id;
  const durMin = (sec) => (sec < 60 ? 'gerade eben' : U.fmtDur(Math.floor(sec / 60) * 60));
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node && node._t !== txt) { node._t = txt; node.textContent = txt; } }
  function setHTML(node, html) { if (node && node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setVar(node, k, v) { const key = '_v' + k; if (node && node[key] !== v) { node[key] = v; node.style.setProperty(k, v); } }
  function setAttr(node, k, v) { const key = '_a' + k; if (node && node[key] !== v) { node[key] = v; if (v == null || v === false) node.removeAttribute(k); else node.setAttribute(k, v === true ? '' : v); } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  const pill = (state, label) => `<span class="pill" style="--c:${pColor(state)}"><i></i>${esc(label || pLabel(state))}</span>`;
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

  // ------------------------------------------------------------------ Tagesverlauf (lokale Aufzeichnung)
  const LOG = {};           // personId → [{t0, t1, s, ss, k (taskId), ty, lb, m, o, a, w (workSec-Zuwachs der Engine in diesem Abschnitt)}]
  const SEEN = {};          // taskId → {t, by}: zuletzt einer Person zugeteilt gesehen (für zurückgegebene Aufgaben)
  const LASTW = {};         // personId → workSec bei der letzten Stichprobe
  let lastT = -1;
  function resetLog() { for (const k in LOG) delete LOG[k]; for (const k in SEEN) delete SEEN[k]; for (const k in LASTW) delete LASTW[k]; lastT = -1; }
  function segState(p, Sx) {
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
    const rest = x.state === 'working' ? 'standby' : x.state === 'driving' ? 'driving' : (SEG[x.state] ? x.state : 'idle');
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
  .pe-f .eyebrow{display:block;font-size:9.5px;margin-bottom:4px}
  .pe-f b{display:block;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-f small{display:block;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .pe-f > div{min-width:0}
  .pe-f .pe-dot{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent);flex:none}
  .pe-f .pe-ic{flex:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--c,var(--muted));background:color-mix(in srgb,var(--c,var(--muted)) 12%,transparent)}
  .pe-f .avatar{width:30px;height:30px;font-size:11px}
  .pe-f.click{cursor:pointer}.pe-f.click:hover b{text-decoration:underline;text-underline-offset:2px}

  /* Schichtmodell des Tages: Beschriftung über dem Balken, Jetzt-Marke in der Zeitachse – nichts überdeckt sich */
  .pe-tl{position:relative;padding:0 1px}
  .pe-tl-cap{position:relative;height:17px;margin-bottom:5px}
  .pe-tl-c{--c:var(--st-setup);position:absolute;top:0;display:flex;align-items:baseline;gap:7px;padding-left:1px;white-space:nowrap;overflow:hidden;font-size:11.5px;color:var(--muted)}
  .pe-tl-c b{font-weight:600;color:var(--text2)}
  .pe-tl-c em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--faint)}
  .pe-tl-c i{font-style:normal;display:inline-flex;align-items:center;gap:5px;color:var(--st-run);font-weight:600;font-size:11px}
  .pe-tl-c i::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--st-run);box-shadow:0 0 0 3px color-mix(in srgb,var(--st-run) 20%,transparent)}
  .pe-tl-c.cur b{color:var(--text)}
  .pe-tl-tr{position:relative;height:14px;border-radius:5px;background:var(--track)}
  .pe-tl-sh{position:absolute;top:0;bottom:0;border-radius:5px;background:color-mix(in srgb,var(--c) 22%,var(--card2));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 34%,transparent)}
  .pe-tl-sh.cur{background:color-mix(in srgb,var(--c) 42%,var(--card2));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 60%,transparent)}
  .pe-tl-br{position:absolute;top:2px;bottom:2px;border-radius:3px;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--st-wait) 70%,transparent) 0 2.5px,transparent 2.5px 5px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--st-wait) 55%,transparent)}
  .pe-tl-past{position:absolute;left:0;top:0;bottom:0;border-radius:5px 0 0 5px;background:color-mix(in srgb,var(--bg) 50%,transparent);pointer-events:none}
  .pe-tl-now{position:absolute;top:-4px;bottom:-9px;width:0;border-left:2px solid var(--accent);pointer-events:none;box-shadow:0 0 8px color-mix(in srgb,var(--accent) 60%,transparent)}
  .pe-tl-ax{position:relative;height:16px;margin-top:6px;font:500 10.5px/16px var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-tl-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .pe-tl-ax span.s0{transform:none}.pe-tl-ax span.s1{transform:translateX(-100%)}
  .pe-tl-ax span.now{z-index:1;font-weight:600;padding:0 6px;border-radius:5px;background:var(--accent);color:var(--accent-ink)}
  .pe-tl-note{font-size:12px;color:var(--muted);margin-top:4px}

  .pe-kpis .kpi.click{cursor:pointer}
  .pe-kpis .kpi.click:hover{border-color:var(--line2)}
  .pe-kpis .kpi .v{display:flex;align-items:baseline;gap:4px}
  .pe-kpis .kpi .v small{margin-left:0}
  .pe-kpis .kpi .s{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4}
  .pe-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .pe-kpis .kpi.warn{border-color:color-mix(in srgb,var(--st-wait) 45%,var(--line));background:color-mix(in srgb,var(--st-wait) 6%,var(--card))}
  .pe-kpis .kpi.warn .v{color:color-mix(in srgb,var(--st-wait) 70%,var(--text))}
  .pe-dist{display:flex;height:6px;border-radius:3px;overflow:hidden;gap:2px;margin-top:7px;background:transparent}
  .pe-dist i{display:block;height:100%;background:var(--c);min-width:3px;border-radius:2px}

  /* Band: Lageplan + offene Aufgaben (gleich hoch, Liste scrollt in sich) */
  .pe-band{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:14px;align-items:stretch}
  .pe-band > .card{display:flex;flex-direction:column;min-width:0}
  .pe-qcard{contain:size}
  .pe-qcard .pe-q{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
  .pe-sec-h{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:10px}
  .pe-sec-h h2{margin:0;font:600 15px/1.2 var(--f-ui)}
  .pe-sec-h .muted{font-size:12.5px}
  .pe-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted);margin-left:auto}
  .pe-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .pe-legend i{width:8px;height:8px;border-radius:50%;background:var(--c)}
  .pe-legend b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}

  /* Personenkarten: strenges Raster – jede Zeile hat ihren festen Platz */
  /* höchstens 5 Spalten (10 Personen = 2 volle Reihen), mindestens 212 px je Karte */
  .pe-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(max(212px,calc((100% - 48px) / 5)),1fr))}
  .pe-card{--c:var(--st-idle);position:relative;display:flex;flex-direction:column;min-width:0;padding:12px 13px 11px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;box-shadow:inset 3px 0 0 var(--c);transition:border-color .15s ease,background-color .15s ease}
  .pe-card:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 50%,var(--card))}
  .pe-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .pe-card.sel{border-color:color-mix(in srgb,var(--accent) 65%,transparent);box-shadow:inset 3px 0 0 var(--c),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .pe-card.prev{background:color-mix(in srgb,var(--panel) 55%,var(--card))}
  .pe-ch{display:flex;align-items:center;gap:10px;min-width:0;height:36px}
  .pe-av{position:relative;flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:600 12px/1 var(--f-ui);color:var(--text);background:var(--raise);border:1px solid var(--line2)}
  .pe-av::after{content:"";position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;background:var(--c);border:2px solid var(--card)}
  .pe-card[data-state="working"] .pe-av::after,.pe-card[data-state="driving"] .pe-av::after{animation:pePulse 1.8s ease-in-out infinite}
  @keyframes pePulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 0%,transparent)}}
  .pe-nm{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
  .pe-nm b{font:600 14.5px/1.15 var(--f-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nm span{font-size:11.5px;line-height:1.2;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-st{display:flex;align-items:center;gap:8px;min-width:0;height:22px;margin-top:11px}
  .pe-st .pill{flex:none}
  .pe-since{margin-left:auto;flex:none;font-size:11.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .pe-since b{color:var(--text2);font-weight:600}
  .pe-act{margin-top:8px;font-size:12.8px;line-height:19px;height:38px;color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .pe-act.dim{color:var(--muted)}
  .pe-rows{display:flex;flex-direction:column;gap:4px;margin-top:10px;padding-top:9px;border-top:1px solid var(--line)}
  .pe-r{display:flex;align-items:center;gap:8px;min-width:0;height:21px;font-size:12px;color:var(--text2)}
  .pe-r > .ico{flex:none;color:var(--faint)}
  .pe-r .tx{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-r .tx:empty{display:none}
  .pe-r .tx.none{color:var(--faint)}
  .pe-r .link{font-size:12px}
  .pe-tchip{--c:var(--st-idle);display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0;max-width:100%;font:600 11px/19px var(--f-ui);padding:0 7px;border-radius:5px;color:color-mix(in srgb,var(--c) 80%,var(--text));background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);white-space:nowrap}
  .pe-tchip i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--c)}
  .pe-tchip span{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .pe-foot{display:flex;flex-direction:column;gap:5px;margin-top:11px}
  .pe-mini{position:relative;height:8px}
  .pe-mini svg{display:block;width:100%;height:8px;border-radius:3px}
  .pe-mini .nw{position:absolute;top:-3px;bottom:-3px;width:0;border-left:1.5px solid var(--text)}
  .pe-mini-ax{display:flex;justify-content:space-between;font:500 9.5px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-ft{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px}
  .pe-ft b{color:var(--text);font-weight:600}

  /* Lageplan */
  .pe-map{padding:10px 12px 2px;min-width:0}
  .pe-map svg{display:block;width:100%;height:auto}
  .pe-map-p{cursor:pointer}
  .pe-map-p .hit{fill:transparent}
  .pe-map-p text{font-family:var(--f-ui);font-weight:700;fill:var(--accent-ink);pointer-events:none}
  .pe-map-m{cursor:pointer}
  .pe-map-m:hover rect{stroke:var(--text2)!important}
  .pe-map-lg{display:flex;flex-wrap:wrap;gap:3px 14px;padding:6px 14px 11px;font-size:11px;color:var(--muted)}
  .pe-map-lg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .pe-map-lg .dot{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;background:var(--c);color:var(--accent-ink);font:700 7.5px/1 var(--f-ui);font-style:normal}
  .pe-map-lg .ln{width:14px;height:0;border-top:1.5px dashed var(--info)}
  .pe-map-lg .sq{width:10px;height:8px;border-radius:2px;background:color-mix(in srgb,var(--st-run) 30%,var(--card2));border:1px solid color-mix(in srgb,var(--st-run) 60%,transparent)}
  .pe-map-lg .fk{width:10px;height:10px;border-radius:2px;background:var(--mat)}

  /* Offene Aufgaben */
  .pe-q{display:flex;flex-direction:column}
  .pe-qi{--c:var(--st-idle);display:flex;flex-direction:column;gap:5px;padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer}
  .pe-qi:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .pe-qi:last-child{border-bottom:0}
  .pe-qi-h{display:flex;align-items:flex-start;gap:8px;min-width:0}
  .pe-qi-h .pe-tchip{margin-top:1px;flex:none}
  .pe-qi-h b{font-weight:600;font-size:13px;line-height:1.35;min-width:0;flex:1}
  .pe-qi-h .pe-wait{flex:none;font:600 12px/1.6 var(--f-ui);font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap}
  .pe-qi-h .pe-wait.warn{color:var(--st-wait)}
  .pe-qi-who{font-size:12px;color:var(--muted);line-height:1.45}
  .pe-qi-who b{color:var(--text2);font-weight:600}
  .pe-qi-why{font-size:12px;line-height:1.45;color:color-mix(in srgb,var(--st-wait) 72%,var(--text));display:flex;gap:6px}
  .pe-qi-why .ico{flex:none;margin-top:1px}
  .pe-qi.held .pe-qi-h b{font-weight:500;color:var(--text2)}
  .pe-q-sub{position:sticky;top:0;z-index:1;padding:8px 14px 6px;font:600 10px/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line);background:var(--bg2)}
  .pe-q-empty{flex:1;padding:22px 16px;text-align:center;color:var(--muted);font-size:12.5px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
  .pe-q-empty .ico{color:var(--st-run)}
  .pe-q-empty.sm{flex:none;flex-direction:row;padding:12px 14px;justify-content:flex-start;text-align:left;border-bottom:1px solid var(--line)}
  .pe-qa{display:flex;align-items:center;gap:9px;min-width:0;height:36px;padding:0 14px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);cursor:pointer;font-size:12.5px}
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
  .pe-nxp .avatar{width:28px;height:28px;font-size:10.5px}
  .pe-nxp > span:not(.avatar){min-width:0;display:flex;flex-direction:column;gap:1px;flex:1}
  .pe-nxp b{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nxp small{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-nxp em{flex:none;font-style:normal;width:7px;height:7px;border-radius:50%;background:var(--st-run);box-shadow:0 0 0 3px color-mix(in srgb,var(--st-run) 20%,transparent)}

  /* Qualifikationsmatrix */
  .pe-mx-card .card-h{flex-wrap:wrap}
  .pe-mx-lg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:var(--muted);align-items:center}
  .pe-mx-lg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .pe-mx-wrap{overflow-x:auto;overscroll-behavior-x:contain}
  table.pe-mx{border-collapse:separate;border-spacing:0;width:100%;min-width:980px;font-size:12.5px}
  .pe-mx th,.pe-mx td{padding:0;text-align:center;vertical-align:middle}
  .pe-mx thead th{font:600 10.5px/1.15 var(--f-ui);letter-spacing:.02em;color:var(--muted);padding:8px 3px 8px;border-bottom:1px solid var(--line);vertical-align:bottom;background:var(--card)}
  .pe-mx thead th small{display:block;font:500 10px/1.2 var(--f-mono);color:var(--faint);margin-top:3px;letter-spacing:0}
  .pe-mx thead tr.grp th{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);padding:8px 6px 4px;border-bottom:0;text-align:left}
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
  .pe-mx-p .avatar{width:24px;height:24px;font-size:9.5px}
  .pe-mx-p div{min-width:0}
  .pe-mx-p b{display:block;font-weight:600;font-size:12.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
  .pe-mx-p div span{display:block;font-size:11px;line-height:1.25;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pe-mx-p i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--c);margin-left:auto}
  .pe-mx tr.shr td{height:44px;padding:0;text-align:left;background:var(--bg2);border-bottom:1px solid var(--line);cursor:pointer}
  .pe-mx tr.shr:hover td{background:color-mix(in srgb,var(--raise) 40%,var(--bg2))}
  .pe-mx tr.shr td.nm{max-width:none}
  .pe-shr{position:sticky;left:0;display:inline-flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:8px 14px;max-width:min(100%,calc(100vw - 72px))}
  .pe-shr .ico{flex:none;color:var(--muted);transition:transform .18s ease}
  .pe-mx tr.shr.open .pe-shr > .ico:first-child{transform:rotate(90deg)}
  .pe-shr b{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--text2)}
  .pe-shr > span{font-size:11.5px;color:var(--faint);white-space:nowrap}
  .pe-shr em{font-style:normal;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--st-run)}
  .pe-shr em::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--st-run)}
  .pe-shr-w{--c:var(--st-wait);display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:6px;color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 11%,transparent);border:1px solid color-mix(in srgb,var(--c) 34%,transparent);white-space:nowrap}
  .pe-shr-w.crit{--c:var(--st-fault)}
  .pe-shr-w .ico{color:var(--c)}
  .pe-shr-n{font-size:11.5px;color:var(--muted)}
  .pe-mx tr.cov td{height:34px;background:color-mix(in srgb,var(--bg2) 60%,var(--card));border-bottom:1px solid var(--line)}
  .pe-mx tr.cov td.nm{font-size:11.5px;color:var(--muted);background:color-mix(in srgb,var(--bg2) 60%,var(--card))}
  .pe-d{display:inline-block;width:13px;height:13px;border-radius:50%;vertical-align:middle}
  .pe-d.stamm{background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
  .pe-d.qual,.pe-d.full{background:var(--text2)}
  .pe-d.own,.pe-d.sub{background:linear-gradient(90deg,var(--text2) 50%,transparent 50%);border:1.5px solid var(--text2)}
  .pe-d.none{width:4px;height:4px;background:var(--line2)}
  .pe-mx td.spof{background:color-mix(in srgb,var(--st-wait) 11%,transparent)}
  .pe-mx td.spof .pe-d{box-shadow:0 0 0 2px var(--card),0 0 0 3.5px var(--st-wait)}
  .pe-mx tbody tr.pr:hover td.spof{background:color-mix(in srgb,var(--st-wait) 16%,var(--card))}
  .pe-cv{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;border-radius:6px;font:600 11.5px/1 var(--f-ui);font-variant-numeric:tabular-nums;color:var(--muted)}
  .pe-cv small{font-weight:500;color:var(--faint);margin-left:1px;font-size:10.5px}
  .pe-cv.warn{color:color-mix(in srgb,var(--st-wait) 85%,white);background:color-mix(in srgb,var(--st-wait) 15%,transparent);border:1px solid color-mix(in srgb,var(--st-wait) 40%,transparent)}
  .pe-cv.crit{color:color-mix(in srgb,var(--st-fault) 85%,white);background:color-mix(in srgb,var(--st-fault) 15%,transparent);border:1px solid color-mix(in srgb,var(--st-fault) 40%,transparent)}
  .pe-bn{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 22px;padding:12px 14px 14px;border-top:1px solid var(--line)}
  .pe-bn:empty{display:none}
  .pe-bn.one{grid-template-columns:minmax(0,1fr)}
  .pe-bn-s{display:flex;flex-direction:column;min-width:0}
  .pe-bn-s h4{margin:0 0 8px;font:600 10.5px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
  .pe-bn-s h4 em{font-style:normal;letter-spacing:0;text-transform:none;font-weight:500;color:var(--faint)}
  .pe-bn-l{display:grid;grid-template-columns:minmax(0,1fr);column-gap:22px}
  .pe-bn.one .pe-bn-l{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pe-bn-i{--c:var(--st-wait);display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:var(--text2);padding:6px 2px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
  .pe-bn-i .ico{flex:none;color:var(--c);margin-top:1px}
  .pe-bn-i b{color:var(--text);font-weight:600}
  .pe-bn-i.crit{--c:var(--st-fault)}
  .pe-bn-i.key{--c:var(--st-fault);padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid color-mix(in srgb,var(--c) 30%,transparent);background:color-mix(in srgb,var(--c) 7%,var(--bg2))}
  .pe-bn-k{grid-column:1/-1}

  .pe-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}
  @media (max-width:1100px){.pe-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-f:nth-child(3){border-left:0}.pe-f:nth-child(n+3){border-top:1px solid var(--line)}}
  @media (max-width:999px){.pe-band{grid-template-columns:minmax(0,1fr)}.pe-qcard{contain:none}.pe-qcard .pe-q{flex:none;overflow:visible}}
  @media (max-width:900px){.pe-kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.pe-bn{grid-template-columns:minmax(0,1fr)}.pe-bn.one .pe-bn-l{grid-template-columns:minmax(0,1fr)}
    .pe-map{overflow-x:auto;overscroll-behavior-x:contain;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
    .pe-map svg{min-width:680px}}
  @media (max-width:560px){.pe-act{height:auto;max-height:38px}.pe-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-kpis .kpi:last-child:nth-child(odd){grid-column:1/-1}
    .pe-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.pe-f{padding:8px 10px;gap:8px}.pe-f:first-child,.pe-f:last-child{grid-column:1/-1}.pe-f:nth-child(2){border-left:0}.pe-f:nth-child(3){border-left:1px solid var(--line)}.pe-f:nth-child(n+2){border-top:1px solid var(--line)}
    .pe-f .pe-ic{display:none}.pe-f b{font-size:13px}.pe-tl-c em{display:none}.pe-tl-c i{font-size:0;gap:0}
    .pe-grid{grid-template-columns:minmax(0,1fr)}.pe-nx{grid-template-columns:repeat(2,minmax(0,1fr))}
    .pe-mx .nm{min-width:150px;max-width:160px;padding-left:10px}.pe-mx-p div span{display:none}.pe-legend{margin-left:0}}

  /* Detail-Drawer */
  .pe-dh{display:flex;flex-direction:column;gap:9px}
  .pe-dh-st{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pe-dh-st .pill{font-size:13.5px;line-height:22px;padding:3px 12px 3px 10px}
  .pe-dh-st .pill i{width:9px;height:9px}
  .pe-dh-st small{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .pe-dh-act{font-size:15px;line-height:1.45;color:var(--text);overflow-wrap:anywhere}
  .pe-dh-where{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text2)}
  .pe-dh-where .ico{color:var(--muted)}
  .pe-box{--c:var(--info);border-radius:9px;padding:10px 12px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 28%,transparent);font-size:12.5px;line-height:1.5;color:var(--text2);display:flex;flex-direction:column;gap:5px}
  .pe-box-h{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;color:var(--text)}
  .pe-box-h .pe-tchip{flex:none}
  .pe-box-h small{margin-left:auto;font-weight:500;color:var(--muted);font-size:11.5px;white-space:nowrap}
  .pe-box .row{gap:6px}
  .pe-steps{display:flex;flex-wrap:wrap;align-items:center;gap:4px 3px;margin-top:2px}
  .pe-step{display:inline-flex;align-items:center;gap:3px;font:600 10.5px/1 var(--f-ui);padding:4px 7px;border-radius:5px;border:1px solid var(--line2);color:var(--faint);white-space:nowrap}
  .pe-step.done{color:var(--muted);border-color:var(--line)}
  .pe-step.done .ico{color:var(--st-run)}
  .pe-step.cur{color:var(--text);border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 16%,transparent)}
  .pe-step-ar{color:var(--faint);font-size:11px}
  .pe-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .pe-s{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0;display:flex;flex-direction:column;gap:3px}
  .pe-s .l{font:600 9.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .pe-s .v{font:600 20px/1.15 var(--f-cond);white-space:nowrap}
  .pe-s .v small{font:500 12px/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .pe-s .bar{height:4px;margin-top:2px}
  .pe-band-d{display:flex;flex-direction:column;gap:5px}
  .pe-band-d svg{display:block;width:100%;height:22px;border-radius:5px}
  .pe-band-ax{position:relative;height:12px;font:500 10px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .pe-band-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .pe-band-ax span:first-child{transform:none}.pe-band-ax span:last-child{transform:translateX(-100%)}
  .pe-band-lg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted)}
  .pe-band-lg span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .pe-band-lg i{width:8px;height:8px;border-radius:2px;background:var(--c)}
  .pe-band-lg b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}
  .pe-band-lg span.main b{color:var(--text)}
  .pe-band-note{font-size:11px;color:var(--faint);line-height:1.45}
  .pe-tl-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--card)}
  .pe-tli{--c:var(--st-idle);display:grid;grid-template-columns:minmax(86px,max-content) minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line);font-size:12.5px;box-shadow:inset 3px 0 0 var(--c)}
  .pe-tli:last-child{border-bottom:0}
  .pe-tli .t{font:500 11.5px/1.2 var(--f-mono);color:var(--muted);white-space:nowrap}
  .pe-tli .lb{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text2)}
  .pe-tli .lb b{color:var(--text);font-weight:600}
  .pe-tli .d{font-size:11.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .pe-tli.on{background:color-mix(in srgb,var(--c) 7%,var(--card))}
  .pe-tli.on .d{color:var(--st-run)}
  .pe-chips{display:flex;flex-wrap:wrap;gap:5px}
  .pe-chips .chip.stamm{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 9%,transparent);cursor:pointer}
  .pe-chips .chip.stamm:hover{border-color:var(--accent)}
  .pe-risk{--c:var(--st-wait);display:flex;gap:8px;font-size:12.5px;line-height:1.45;color:var(--text2);padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--c) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 26%,transparent)}
  .pe-risk .ico{flex:none;color:var(--c);margin-top:1px}
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
          <div class="kpi"><div class="l">Arbeiten gerade</div><div class="v" data-r="kWork">–</div><div class="s" data-r="kWorkS">–</div><div class="pe-dist" data-r="kDist"></div></div>
          <div class="kpi"><div class="l">Pause</div><div class="v" data-r="kBreak">–</div><div class="s" data-r="kBreakS">–</div></div>
          <div class="kpi"><div class="l">Ø Auslastung heute</div><div class="v" data-r="kUtil">–</div><div class="s" data-r="kUtilS">–</div></div>
          <div class="kpi click" data-r="kOpenBox" title="Zur Liste der offenen Aufgaben"><div class="l">Aufgaben ohne Person</div><div class="v" data-r="kOpen">–</div><div class="s" data-r="kOpenS">–</div></div>
        </div>
        <div class="pe-band">
          <section class="card" aria-label="Lageplan">
            <div class="card-h"><h3>Lageplan · wer ist wo</h3><span class="muted" data-r="mapSub"></span></div>
            <div class="pe-map" data-r="map"></div>
            <div class="pe-map-lg"><span><i class="dot" style="--c:var(--st-run)">AB</i>Person (Farbe = Zustand)</span><span><i class="ln"></i>unterwegs zum Ziel</span><span><i class="sq"></i>Maschine (Farbe = Zustand)</span><span><i class="fk"></i>Stapler</span></div>
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

  // ---------------- Lageplan (2D, Meter): Stationen, Gänge, Personen live – Schrift und Punkte in Bildschirm-Pixeln
  let mapRefs = null, mapW = 0, gridW = 0, nxW = 0;
  const MAP_LBL = { CRIB: ['Werkzeugausgabe', 'Werkzeuge'], MAINT: ['Instandhaltung', 'Instandh.'], OFFICE: ['Leitstand', 'Büro'], RAW: ['Rohmaterial', 'Rohmat.'],
    PUF: ['Pufferlager', 'Puffer'], WE: ['Wareneingang', 'WE'], SPERR: ['Sperrlager', 'Sperr'], EXT: ['Fremdbearbeitung', 'Härterei'], VERSAND: ['Versand'], CHG: ['AGV laden', 'AGV'], QS: ['QS · Messraum', 'Messraum', 'QS'], M13: ['Montage'] };
  function buildMap() {
    const H = P().hall, G = P().graph;
    const vw = H.w + 2;
    const wpx = Math.max(280, R.map.clientWidth - 24 || 0);
    // Breite Bildschirme: höchstens ~440 px hoch (zentriert), Telefon/Tablet: mindestens 680 px breit im Scroller
    const phone = window.matchMedia('(max-width: 900px)').matches;
    const svgW = phone ? Math.max(680, wpx) : Math.min(wpx, Math.round(440 * vw / (H.d + 2)));
    mapW = R.map.clientWidth;
    const u = vw / svgW;                          // Meter je Bildschirm-Pixel
    const fs = (px) => (px * u).toFixed(3);
    const tw = (txt, px, wt) => String(txt).length * px * u * (wt ? 0.58 : 0.54);   // grobe Textbreite (Barlow)
    let h = `<svg viewBox="-1 -1 ${vw} ${H.d + 2}" role="img" aria-label="Lageplan der Halle mit Personen"${phone ? '' : ` style="max-width:${svgW}px;margin:0 auto"`}>`;
    h += `<rect x="0" y="0" width="${H.w}" height="${H.d}" rx=".8" style="fill:var(--bg2);stroke:var(--line2)" stroke-width="${fs(1)}"/>`;
    for (const [a, b] of G.edges) { const A = G.nodes[a], B = G.nodes[b]; h += `<line x1="${A.x}" y1="${A.z}" x2="${B.x}" y2="${B.z}" style="stroke:var(--track)" stroke-width="2.2" stroke-linecap="round"/>`; }
    for (const d of H.doors || []) if (d.wall === 'front') h += `<line x1="${d.x}" y1="${H.d}" x2="${d.x + d.w}" y2="${H.d}" style="stroke:var(--mat)" stroke-width="${fs(3)}" opacity=".75"><title>${esc(d.name)}</title></line>`;
    for (const s of P().stations) {
      const f = s.footprint; if (!f) continue;
      const isM = !!(s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly');
      h += `<g ${isM ? `data-mid="${esc(s.id)}" class="pe-map-m"` : ''}><rect data-st="${esc(s.id)}" x="${f.x}" y="${f.z}" width="${f.w}" height="${f.d}" rx=".5" style="fill:var(--card2);stroke:var(--line2)" stroke-width="${fs(1)}"><title>${esc(s.name)}${isM ? ' (' + esc(s.id) + ')' : ''}</title></rect>`;
      if (s.kind === 'machine') {
        // Kennung immer (≥ 10,5 px), Kurzname darunter nur, wenn er in die Grundfläche passt
        const two = tw(s.short, 10, false) <= f.w - 0.6 && f.d >= 26 * u;
        const cy = f.z + f.d / 2;
        h += `<text x="${f.x + f.w / 2}" y="${(two ? cy - 2 * u : cy + 3.8 * u).toFixed(2)}" text-anchor="middle" style="fill:var(--text);font:700 ${fs(10.5)}px var(--f-ui)" pointer-events="none">${esc(s.id)}</text>`;
        if (two) h += `<text x="${f.x + f.w / 2}" y="${(cy + 10 * u).toFixed(2)}" text-anchor="middle" style="fill:var(--text2);font:500 ${fs(10)}px var(--f-ui)" pointer-events="none">${esc(s.short)}</text>`;
      } else {
        const cands = MAP_LBL[s.id] || [s.short];
        const lb = cands.find(c => tw(c, 10, true) <= f.w - 0.7);
        if (lb) h += `<text x="${(f.x + 5 * u).toFixed(2)}" y="${(f.z + 13 * u).toFixed(2)}" style="fill:${isM ? 'var(--text2)' : 'var(--muted)'};font:600 ${fs(10)}px var(--f-ui)" pointer-events="none">${esc(lb)}</text>`;
      }
      h += '</g>';
    }
    const r = 8.5 * u;
    h += `<g data-r="lines"></g><g data-r="dots">`;
    for (const pp of P().people) h += `<g class="pe-map-p" data-pid="${esc(pp.id)}" style="display:none"><circle class="hit" r="${(16 * u).toFixed(3)}"/><circle class="dot" r="${r.toFixed(3)}" stroke-width="${fs(1.8)}"/><text text-anchor="middle" y="${(3.1 * u).toFixed(3)}" style="font-size:${fs(8.5)}px">${esc(WF.ui.initials(pp.name))}</text><title></title></g>`;
    h += `</g><g data-r="fork" style="display:none"><rect x="${(-9 * u).toFixed(3)}" y="${(-9 * u).toFixed(3)}" width="${(18 * u).toFixed(3)}" height="${(18 * u).toFixed(3)}" rx="${(3 * u).toFixed(3)}" style="fill:var(--mat);stroke:var(--card)" stroke-width="${fs(1.8)}"/><text text-anchor="middle" y="${(3.1 * u).toFixed(3)}" style="font:700 ${fs(8.5)}px var(--f-ui);fill:var(--accent-ink)" pointer-events="none"></text><title>Stapler</title></g></svg>`;
    R.map.innerHTML = h;
    const svg = R.map.querySelector('svg');
    mapRefs = { svg, u, lines: svg.querySelector('[data-r="lines"]'), fork: svg.querySelector('[data-r="fork"]'), dots: {}, st: {} };
    mapRefs.forkT = mapRefs.fork.querySelector('text'); mapRefs.forkTitle = mapRefs.fork.querySelector('title');
    svg.querySelectorAll('[data-pid]').forEach(g => { mapRefs.dots[g.dataset.pid] = { g, c: g.querySelector('circle.dot'), t: g.querySelector('title') }; });
    svg.querySelectorAll('rect[data-st]').forEach(rc => { mapRefs.st[rc.dataset.st] = rc; });
    if (S()) updateMap(S().t);
  }
  function updateMap(now) {
    if (!mapRefs) return;
    const Sx = S(), sel = WF.app.selected, u = mapRefs.u;
    let lines = '', n = 0;
    for (const pp of P().people) {
      const p = Sx.people[pp.id], d = mapRefs.dots[pp.id];
      const vis = !!(p && p.state !== 'offShift' && p.state !== 'break' && !p.vehicle);
      d.g.style.display = vis ? '' : 'none';
      if (!vis) continue;
      n++;
      const tr = `translate(${p.pos.x.toFixed(2)} ${p.pos.z.toFixed(2)})`;
      if (d._tr !== tr) { d._tr = tr; d.g.setAttribute('transform', tr); }
      const c = pColor(p.state);
      if (d._c !== c) { d._c = c; d.c.style.fill = c; }
      const on = !!(sel && sel.kind === 'person' && sel.id === pp.id);
      if (d._on !== on) { d._on = on; d.c.style.stroke = on ? 'var(--accent)' : 'var(--card)'; d.c.setAttribute('r', ((on ? 10.5 : 8.5) * u).toFixed(3)); if (on) d.g.parentNode.append(d.g); }
      setText(d.t, `${pp.name} – ${pLabel(p.state)}: ${p.activity || ''}`);
      const tk = p.task, s0 = tk && tk.steps ? tk.steps[tk.si] : null;
      if (s0 && s0.to && (p.state === 'walking' || p.state === 'driving')) {
        const st0 = st(s0.to); const w = st0 && (st0.work || st0.dock);
        if (w) lines += `<line x1="${p.pos.x.toFixed(2)}" y1="${p.pos.z.toFixed(2)}" x2="${w.x}" y2="${w.z}" style="stroke:var(--info)" stroke-width="${(1.6 * u).toFixed(3)}" stroke-dasharray="${(5 * u).toFixed(2)} ${(4 * u).toFixed(2)}" opacity=".85"/><circle cx="${w.x}" cy="${w.z}" r="${(4 * u).toFixed(3)}" style="fill:none;stroke:var(--info)" stroke-width="${(1.5 * u).toFixed(3)}"/>`;
      }
    }
    if (mapRefs._lines !== lines) { mapRefs._lines = lines; mapRefs.lines.innerHTML = lines; }
    const f = Sx.forklift;
    if (f) {
      mapRefs.fork.style.display = '';
      const tr = `translate(${f.pos.x.toFixed(2)} ${f.pos.z.toFixed(2)})`;
      if (mapRefs._ftr !== tr) { mapRefs._ftr = tr; mapRefs.fork.setAttribute('transform', tr); }
      const drv = f.driver && Sx.people[f.driver];
      setText(mapRefs.forkT, drv ? WF.ui.initials(drv.name) : '');
      setText(mapRefs.forkTitle, drv ? `Stapler – fährt ${drv.name}` : 'Stapler (abgestellt)');
      if (drv) mapRefs.fork.dataset.pid = drv.id; else delete mapRefs.fork.dataset.pid;
      if (f.driver) n++;
    }
    for (const id in mapRefs.st) {
      const m = Sx.machines[id]; if (!m) continue;
      const c = (WF.STATE[m.state] || {}).color || 'var(--st-idle)';
      const fill = `color-mix(in srgb,${c} 30%,var(--card2))`;
      if (mapRefs.st[id]._f !== fill) { mapRefs.st[id]._f = fill; mapRefs.st[id].style.fill = fill; mapRefs.st[id].style.stroke = `color-mix(in srgb,${c} 60%,transparent)`; }
    }
    const brk = P().people.filter(pp => { const p = Sx.people[pp.id]; return p && p.state === 'break'; }).length;
    setText(R.mapSub, n ? `${n} in der Halle${brk ? ` · ${brk} in der Pause` : ''}` : brk ? `${brk} in der Pause` : 'niemand in der Halle');
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
      setText(R.leadSub, !live || live.state === 'offShift' ? (sh.id ? 'nicht im Dienst' : 'ab ' + tclock(nx.startT, now)) : `${pLabel(live.state)} · ${whereOf(live).text}`);
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
        <div class="pe-ft"><span>Auslastung <b data-r="util">–</b></span><span data-r="tasks"></span></div></div>`;
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
      const r = c.r, w = whereOf(p);
      counts[p.state] = (counts[p.state] || 0) + 1;
      setVar(c.el, '--c', pColor(p.state));
      if (c.el.dataset.state !== p.state) c.el.dataset.state = p.state;
      c.el.classList.toggle('prev', x.prev);
      setText(r.role, x.prev ? `${p.role} · ${shiftName(p.shift)}` : p.role);
      setHTML(r.pill, pill(p.state));
      let act = p.activity || '';
      if (p.state === 'break' && p.breakUntil) act = `Pause bis ${U.fmtClock(p.breakUntil)}${p.breakMakeup ? ' (holt die Pause nach)' : ''}`;
      if (p.state === 'idle' && !p.task) act = p.endShift ? 'Schichtende – geht gleich' : p.breakPending ? 'Geht gleich in die Pause' : 'Wartet auf die nächste Aufgabe';
      if (x.prev) act = (p.task ? 'Beendet noch die Aufgabe: ' : '') + act;
      setHTML(r.act, escNb(act));
      r.act.classList.toggle('dim', p.state === 'idle' || p.state === 'break');
      const lg = LOG[p.id], ls = lg && lg[lg.length - 1];
      const has = !!(ls && ls.s === p.state);
      setHTML(r.since, has ? `seit <b>${esc(sinceTxt(now - ls.t0))}</b>` : '');
      setAttr(r.since, 'title', has ? `${pLabel(p.state)} seit ${U.fmtClock(ls.t0)}` : null);
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
      } else {
        setHTML(r.tchip, '');
        setHTML(r.task, 'keine Aufgabe');
        r.task.classList.add('none');
        setAttr(r.taskRow, 'title', 'Keine Aufgabe zugeteilt');
      }
      setText(r.util, p.dutySec > 0 ? U.fmtPct(p.utilToday || 0) : '–');
      setAttr(r.util.parentNode, 'title', p.dutySec > 0 ? `Arbeitszeit ${U.fmtDur(p.workSec)} von ${U.fmtDur(p.dutySec)} im Dienst` : null);
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
          setAttr(r.mini, 'title', `Verlauf ${def.start}–${U.fmtClock(end)}: Arbeitszeit ${U.fmtDur(tot.work + tot.fork)}` + ['standby', 'walking', 'idle', 'break'].map(k => (tot[k] || 0) >= 60 ? ' · ' + SEG[k].label + ' ' + U.fmtDur(tot[k]) : '').join(''));
        }
      }
      setAttr(c.el, 'aria-label', `${p.name}, ${p.role}: ${pLabel(p.state)} – ${act}`);
    }
    setText(R.gridT, sh.id ? `Im Dienst · ${sh.name}` : 'Im Dienst');
    setText(R.gridSub, `${roster.filter(x => x.p.state !== 'offShift').length} Personen in der Halle`);
    setHTML(R.gridLg, PST_ORDER.filter(k => counts[k]).map(k => `<span style="--c:${pColor(k)}"><i></i>${esc(pLabel(k))} <b>${counts[k]}</b></span>`).join(''));
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
    const work = (counts.working || 0) + (counts.driving || 0);
    setHTML(R.kWork, `${work}<small>/ ${present.length}</small>`);
    const stby = roster.filter(x => x.p.state === 'working' && segState(x.p, Sx) === 'standby').length;
    // „davon“ nur für die Bereitschaft (Teil der Arbeitenden) – die übrigen Zustände stehen getrennt daneben
    const others = [counts.walking ? `${counts.walking} unterwegs` : '', counts.idle ? `${counts.idle} verfügbar` : '', counts.break ? `${counts.break} in der Pause` : ''].filter(Boolean);
    let ws;
    if (!present.length) ws = 'niemand im Dienst';
    else if (stby) ws = `davon ${stby} in Bereitschaft${others.length ? ' · außerdem ' + others.join(', ') : ''}`;
    else ws = others.length ? others.join(' · ') : 'alle bei der Arbeit';
    setText(R.kWorkS, ws);
    setAttr(R.kWorkS, 'title', ws);
    const tot = present.length || 1;
    setHTML(R.kDist, present.length ? PST_ORDER.filter(k => counts[k]).map(k => `<i style="--c:${pColor(k)};flex:${counts[k] / tot}" title="${esc(pLabel(k))}: ${counts[k]}"></i>`).join('') : '');
    const br = sh.id ? breakInfo(sh, now) : null;
    const inBreak = counts.break || 0, pending = roster.filter(x => x.p.breakPending && x.p.state !== 'break' && x.p.state !== 'offShift').length;
    setHTML(R.kBreak, `${inBreak}`);
    setText(R.kBreakS, !sh.id ? 'keine Schicht' : br && br.now ? `bis ${U.fmtClock(br.b)}${pending ? ` · ${pending} beendet noch Arbeit` : ''}` : pending ? `${pending} holt Pause nach` : br ? `nächste ${U.fmtClock(br.a)}–${U.fmtClock(br.b)}` : 'keine Pause mehr in dieser Schicht');
    let n = 0, sum = 0;
    for (const id in Sx.people) { const p = Sx.people[id]; if (p.dutySec > 0) { n++; sum += p.utilToday || 0; } }
    setHTML(R.kUtil, n ? U.fmtPct(sum / n) : '–');
    setText(R.kUtilS, n ? 'Arbeitszeit ÷ Anwesenheit' : 'heute noch niemand im Dienst');
    setAttr(R.kUtil.parentNode, 'title', n ? `Mittel über ${n} Personen, die heute im Dienst waren. Arbeitszeit = Arbeitsschritte, Staplerfahrten und begleitete Bearbeitung; Wege und Bereitschaft zählen nicht.` : null);
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
    return pLabel(p.state).toLowerCase();
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
        <span class="w">${esc(mid ? mLabel(mid) : '')}${tk.orderId ? ' · ' + esc(tk.orderId) : ''}</span><span class="who" style="--c:${pColor(p.state)}"><i></i>${esc(shortName(p.name))}</span></div>`;
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
        h += `<tr class="pr" data-id="${esc(pp.id)}"><td class="nm"><div class="pe-mx-p"><span class="avatar">${esc(WF.ui.initials(pp.name))}</span><div><b>${esc(pp.name)}</b><span>${esc(pp.role)}</span></div><i data-live="${esc(pp.id)}"${p && p.state !== 'offShift' ? ` style="--c:${pColor(p.state)}" title="${esc(pLabel(p.state))}"` : ' hidden'}></i></div></td>`;
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
      if (on) { setVar(d, '--c', pColor(p.state)); setAttr(d, 'title', pLabel(p.state) + ' – ' + (p.activity || '')); }
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
      return `<div class="pe-bn-s"><h4>Engpässe ${esc(def.name)}<em>${b.items.length} von ${cols().length} Qualifikationen</em></h4>${head.join('')}<div class="pe-bn-l">${rows.join('') || (head.length ? '' : '<div class="muted" style="font-size:12.5px">Jede Qualifikation ist mindestens doppelt besetzt.</div>')}</div></div>`;
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

  WF.registerView({ id: 'personal', title: 'Personal', icon: 'users', group: 'ressourcen', order: 6, mount, show() { gridSig = ''; }, update,
    badge() { const Sx = S(); if (!Sx || !Sx.tasks) return ''; let n = 0; for (const id in Sx.tasks) { const t = Sx.tasks[id]; if (t.status === 'open' && !t.held) n++; } return n ? String(n) : ''; } });

  // ------------------------------------------------------------------ Detail „person“
  function bandSvg(tl, t0, t1) {
    const w = 1000, span = Math.max(1, t1 - t0);
    let r = '';
    for (const s of tl) for (const q of pieces(s)) {
      const x = (q.t0 - t0) / span * w, ww = Math.max(0.8, (q.t1 - q.t0) / span * w);
      r += `<rect x="${x.toFixed(2)}" y="0" width="${ww.toFixed(2)}" height="22" style="fill:${sColor(q.k)}"><title>${esc(U.fmtClock(s.t0))}–${esc(U.fmtClock(s.t1))} ${esc(pLabel(s.state))}${q.work ? ' · ' + esc(U.fmtDur(q.t1 - q.t0)) + ' Arbeitszeit' : s.state === 'working' ? ' · Bereitschaft ' + esc(U.fmtDur(q.t1 - q.t0)) : ''}${s.label ? ' · ' + esc(s.label) : ''}</title></rect>`;
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
          <div class="pe-s"><span class="l">Auslastung</span><span class="v" data-r="util">–</span><span class="bar" data-r="ubar"><i></i></span></div>
          <div class="pe-s"><span class="l">Arbeitszeit</span><span class="v" data-r="work">–</span><span class="muted" style="font-size:11px" data-r="duty"></span></div>
          <div class="pe-s"><span class="l">Aufgaben</span><span class="v" data-r="tasks">–</span><span class="muted" style="font-size:11px">heute übernommen</span></div>
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
      body.skills.innerHTML = `<div class="stack" style="gap:8px">
        ${own ? `<div><div class="eyebrow" style="margin-bottom:6px">Stammarbeitsplätze</div><div class="pe-chips">${own}</div></div>` : ''}
        ${mach.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Maschinen</div><div class="pe-chips">${mach.map(c => `<span class="chip" title="${esc(c.machines.map(mLabel).join(', '))}">${esc(SKILL[c.key])}</span>`).join('')}</div></div>` : ''}
        ${acts.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Tätigkeiten</div><div class="pe-chips">${acts.map(x => `<span class="chip" title="${esc(levelTip(pp, x.c, x.lv))}">${esc(SKILL[x.c.key])}${x.lv === 'own' ? ' (eigene Maschinen)' : x.lv === 'sub' ? ' (vertretend)' : ''}</span>`).join('')}${pp.skills.includes('lead') ? '<span class="chip info">Schichtleitung</span>' : ''}</div></div>` : ''}
      </div>`;
      const b = bottlenecks(pp.shift), mine = b.byPerson[pp.id] || [];
      const subs = [];
      for (const c of C) {
        if (c.kind !== 'm' || !pp.skills.includes(c.key)) continue;
        const others = P().people.filter(x => x.id !== pp.id && x.shift === pp.shift && x.skills.includes(c.key));
        if (others.length) subs.push(`${SKILL[c.key]}: ${others.map(x => shortName(x.name)).join(', ')}`);
      }
      body.risk.innerHTML = (mine.length ? `<div class="pe-risk">${icon('alert', 15)}<span>Einzige Person der ${esc(def.name)} für <b>${mine.map(i => esc(SKILL[i.key])).join(', ')}</b>.</span></div>` : '') +
        (subs.length ? `<div class="muted" style="font-size:12px;margin-top:${mine.length ? 8 : 0}px;line-height:1.5">Vertretung in der Schicht – ${subs.map(esc).join(' · ')}</div>` : (mine.length ? '' : '<div class="muted" style="font-size:12.5px">Keine Engpass-Qualifikation.</div>'));
    }
    function update(el) {
      const Sx = S(); if (!Sx) return;
      const p = Sx.people[id], now = Sx.t; if (!p) return;
      sample();
      const w = whereOf(p);
      setHTML(body.pill, pill(p.state));
      const segs = LOG[id] || [], last = segs[segs.length - 1];
      setText(body.since, last && last.s === p.state && last.t0 > Sx.t - DAY ? `seit ${U.fmtClock(last.t0)} (${durMin(now - last.t0)})` : '');
      let act = p.activity || '';
      if (p.state === 'break' && p.breakUntil) act = `Pause bis ${U.fmtClock(p.breakUntil)}`;
      if (p.state === 'idle' && !p.task) act = p.endShift ? 'Schichtende – verlässt gleich die Halle' : p.breakPending ? 'Geht gleich in die Pause' : 'Wartet auf die nächste Aufgabe';
      if (p.state === 'offShift') act = `Nicht im Dienst – ${def.name} ${def.start}–${def.end}`;
      setHTML(body.act, escNb(act));
      const sid = w.sid && st(w.sid) && (st(w.sid).kind === 'machine' || st(w.sid).kind === 'qs' || st(w.sid).kind === 'assembly') ? w.sid : null;
      setHTML(body.where, sid ? `<button class="link" data-sel="machine|${esc(sid)}">${esc(w.text)}</button>` : esc(w.text));
      // aktuelle Aufgabe
      const tk = p.task;
      const tsig = tk ? tk.id + '|' + tk.si + '|' + Math.floor((now - (tk.assignedT || now)) / 60) : '-';
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
            <div class="row">${tk.machineId ? `<button class="link" data-sel="machine|${esc(tk.machineId)}">${esc(mLabel(tk.machineId))}</button>` : ''}${tk.orderId ? `<span class="faint">·</span><button class="link" data-sel="order|${esc(tk.orderId)}">${esc(tk.orderId)}${tk.seq != null ? ' AG ' + tk.seq : ''}</button>` : ''}<span class="spacer"></span><span class="muted" style="font-size:11.5px" data-live="rem"></span></div>
            <div class="pe-steps">${steps}</div>
          </div>`;
        } else body.task.innerHTML = `<div class="muted" style="font-size:12.5px">${p.state === 'offShift' ? 'Nicht im Dienst.' : 'Keine Aufgabe zugeteilt – die Engine vergibt die nächste passende Aufgabe nach Priorität und Weg.'}</div>`;
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
        if (!win.started) body.band.innerHTML = `<div class="muted" style="font-size:12.5px">${wkend ? 'Wochenende – heute keine Schicht.' : `${esc(def.name)} beginnt ${esc(U.fmtClock(win.a))} – noch kein Verlauf für heute.`}</div>`;
        else {
          const tot = totals(tl);
          const ax = [];
          for (let h = Math.ceil(win.a / 3600) * 3600; h <= win.b; h += 3600) if ((h - win.a) % 7200 === 0 || win.b - win.a <= 6 * 3600) ax.push(h);
          const X = (t) => ((t - win.a) / Math.max(1, win.b - win.a) * 100).toFixed(2);
          const nowX = now < win.b ? `<div style="position:absolute;top:-2px;bottom:-2px;left:${X(now)}%;border-left:2px solid var(--accent)"></div>` : '';
          const lg = [`<span class="main" style="--c:${SEG.work.c}"><i></i>Arbeitszeit <b>${esc(p.workSec > 0 ? U.fmtDur(p.workSec) : '–')}</b></span>`]
            .concat(['standby', 'walking', 'idle', 'break'].filter(k => (tot[k] || 0) >= 30).map(k => `<span style="--c:${SEG[k].c}"><i></i>${esc(SEG[k].label)} <b>${esc(U.fmtDur(tot[k]))}</b></span>`));
          if (tot.fork >= 30) lg.splice(1, 0, `<span style="--c:${SEG.driving.c}"><i></i>davon Stapler <b>${esc(U.fmtDur(tot.fork))}</b></span>`);
          body.band.innerHTML = `<div class="pe-band-d"><div style="position:relative">${bandSvg(tl, win.a, win.b)}${nowX}</div>
            <div class="pe-band-ax"><span style="left:0">${esc(U.fmtClock(win.a))}</span>${ax.filter(h => h > win.a + 1800 && h < win.b - 1800).map(h => `<span style="left:${X(h)}%">${esc(U.fmtClock(h))}</span>`).join('')}<span style="left:100%">${esc(U.fmtClock(win.b))}</span></div>
            <div class="pe-band-lg">${lg.join('')}</div>
            <div class="pe-band-note">Dunkelgrün = Arbeitszeit wie in der Kachel oben (Arbeitsschritte, Staplerfahrten, begleitete Bearbeitung). Hellgrün = an der Maschine, aber ohne Arbeitsschritt (wartet auf Zyklusende oder Messmaschine) – zählt nicht zur Auslastung.</div></div>`;
        }
        const rec = recentTasks(id, 8);
        body.recent.innerHTML = rec.length ? `<div class="pe-tl-list">${rec.map(r => `<div class="pe-tli${r.active ? ' on' : ''}" style="--c:${TASK_C[r.type] || 'var(--st-idle)'}">
            <span class="t">${esc(tclock(r.t0, now))}${r.active ? ' –' : '–' + esc(U.fmtClock(r.t1))}</span>
            <span class="lb"><b>${esc(taskLabel(r.type))}</b> ${esc(r.machineId ? mLabel(r.machineId) : '')}${r.orderId ? ' · ' + esc(r.orderId) : ''}</span>
            <span class="d">${r.active ? 'läuft' : esc(U.fmtDur(Math.max(60, r.t1 - r.t0)))}</span></div>`).join('')}</div>`
          : `<div class="muted" style="font-size:12.5px">${p.state === 'offShift' ? 'Heute noch keine Aufgaben.' : 'Noch keine Aufgabe aufgezeichnet.'}</div>`;
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
    coverage, bottlenecks, timeline, recentTasks, workCheck };
})();
