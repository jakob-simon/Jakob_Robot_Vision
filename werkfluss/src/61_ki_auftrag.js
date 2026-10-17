/* werkfluss – Ansicht „KI-Auftrag“ (61_ki_auftrag.js, Gruppe KI, Reihenfolge 9)
   „Zeichnung rein → Arbeitsplan, Zeit, Preis und Liefertermin raus → mit einem Klick einlasten.“

   Links  Eingabe: drei eingebaute Beispielzeichnungen (Inline-SVG im Stil echter technischer Zeichnungen mit Schriftfeld)
          oder eigene Zeichnung (Bild/PDF, Datei-Auswahl oder Drag & Drop, Vorschau); Kunde, Menge, Priorität, Wunschtermin.
   Rechts Ergebnis, schrittweise aufgedeckt („Zeichnung lesen → Merkmale → Arbeitsplan → Kalkulation → Termin“):
          erkanntes Teil, Rohteil und Materialbedarf (Lagerbestand abzüglich Reservierungen offener Aufträge),
          kritische Merkmale (nummeriert und auf der Zeichnung markiert), Arbeitsplan ausschließlich mit Arbeitsplätzen und
          Werkzeugtypen dieses Werks (jede Station/jedes Werkzeug geprüft), Kalkulation (Zuschlagskalkulation mit sichtbaren
          Formeln, Staffelpreise), Liefertermin aus der Live-Belegung (WF.sim.forecast().machines, Schichtkalender,
          Fremdbearbeitung mit Lieferfenster), Auswirkung auf bestehende Aufträge, Risiken/Hinweise mit Aktionen.
          „Auftrag einlasten“ → WF.sim.actions.addOrder(spec) → der Auftrag läuft durch die simulierte Fabrik.
   Claude (sample-Capability, nur auf Knopfdruck): Zeichnung als PNG (Beispiele: SVG → Canvas) bzw. hochgeladenes Bild +
          deutscher Prompt mit Arbeitsplätzen, Werkzeugtypen und Lagermaterial → strikte JSON-Antwort → Prüfung/Reparatur.
          Ohne Claude: sorgfältig vorberechnete Auswertungen der Beispielzeichnungen. Preis und Termin rechnet werkfluss
          immer selbst aus den Live-Daten (nie die KI).
   Öffentlich: WF.kiAuftrag = { examples, select(id), analyze(opts), quote(), estimate(), spec(), place(), validate(raw), setQty(n), setPriority(p) } */
(function () {
  const WF = window.WF;
  if (!WF || !WF.registerView) return;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;
  const DAY = 86400, WEEK = 7 * DAY;
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const P = () => WF.profile;
  const S = () => WF.sim && WF.sim.state;
  const STN = (id) => WF.profile.stationById[id] || null;
  const TTY = (id) => WF.profile.toolTypeById[id] || null;
  const clamp = U.clamp;
  const r2 = (v) => Math.round(v * 100) / 100;
  const nf = (v, d) => U.fmtNum(v, d == null ? 0 : d);
  const eur = (v, d) => U.fmtEur(v, d == null ? 2 : d);
  const minDec = (m) => (m < 1 ? (Math.round(m * 100) % 10 ? 2 : 1) : Math.round(m * 10) % 10 ? 1 : 0);
  const minTxt = (m) => nf(m, minDec(m)) + ' min';
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const sleep = (ms) => new Promise(r => setTimeout(r, reduceMotion() ? 0 : ms));

  // ------------------------------------------------------------------ Zeitformate
  const fClock = U.fmtClock;
  /** „Do 14:20“ (Folgewoche wird angehängt) */
  function fDay(t) {
    const now = S() ? S().t : 0;
    const wk = Math.floor(t / WEEK) !== Math.floor(now / WEEK);
    return DAYS[Math.floor(t / DAY) % 7] + ' ' + fClock(t) + (wk ? ' (Folgewoche)' : '');
  }
  /** relativ: „heute 14:20“, „morgen 06:30“, „Do 14:20“ */
  function fRel(t) {
    const now = S() ? S().t : 0;
    const d = Math.floor(t / DAY) - Math.floor(now / DAY);
    if (d === 0) return 'heute ' + fClock(t);
    if (d === 1) return 'morgen ' + fClock(t);
    return fDay(t);
  }
  /** Dauer lang: „2 T 5 h“, „7 h 40 min“ */
  function fDurL(sec) {
    if (sec == null || !isFinite(sec)) return '–';
    sec = Math.max(0, sec);
    if (sec >= DAY) { const d = Math.floor(sec / DAY), h = Math.round((sec - d * DAY) / 3600); return d + ' T' + (h ? ' ' + h + ' h' : ''); }
    return U.fmtDur(Math.round(sec / 60) * 60);
  }
  const fH = (h) => nf(h, h < 10 ? 2 : 1) + ' h';
  /** Werkstoff-/Normbezeichnungen nicht am Bindestrich umbrechen */
  const nw = (t) => String(t || '').split(' ').map(w => /-/.test(w) ? `<span style="white-space:nowrap">${esc(w)}</span>` : esc(w)).join(' ');

  // ------------------------------------------------------------------ Arbeitszeitkalender (Nachbau der Engine-Regeln)
  // Engine-intern (10_sim.js addWork/nextWorkStart/nextDayWindow) – nicht öffentlich; identisch aus profile.shifts nachgebaut.
  let WW = null;
  function workWin() {
    if (WW) return WW;
    const w = [], hm = U.hm;
    for (let d = 0; d < 5; d++) for (const sh of P().shifts) {
      let a = hm(sh.start);
      for (const b of sh.breaks) { const b0 = hm(b[0]), b1 = hm(b[1]); if (b0 > a) w.push([d * DAY + a, d * DAY + b0]); a = b1; }
      const e = hm(sh.end); if (e > a) w.push([d * DAY + a, d * DAY + e]);
    }
    w.sort((x, y) => x[0] - y[0]);
    return (WW = w);
  }
  /** Arbeitszeit (Schicht ohne Pausen) ab t addieren → Endzeitpunkt */
  function addWork(t, sec) {
    if (!(sec > 0)) return t;
    let base = Math.floor(t / WEEK) * WEEK;
    for (let g = 0; g < 60; g++) {
      for (const w of workWin()) {
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
  function nextWorkStart(t) {
    let base = Math.floor(t / WEEK) * WEEK;
    for (let g = 0; g < 4; g++) {
      for (const w of workWin()) { const a = base + w[0], b = base + w[1]; if (b > t) return Math.max(a, t); }
      base += WEEK;
    }
    return t;
  }
  /** Arbeitszeitfenster im Intervall [a, b] (für die Darstellung bemannter Bearbeitung) */
  function workSpans(a, b) {
    const out = []; let base = Math.floor(a / WEEK) * WEEK;
    for (let g = 0; g < 6 && base < b; g++) {
      for (const w of workWin()) { const x = Math.max(a, base + w[0]), y = Math.min(b, base + w[1]); if (y > x) out.push([x, y]); }
      base += WEEK;
    }
    return out;
  }
  /** Spedition/Lieferanten: Mo–Fr 06:00–20:00 (Engine: inDayWindow/nextDayWindow) */
  function inDayWindow(t) { const d = ((Math.floor(t / DAY) % 7) + 7) % 7, s = t % DAY; return d < 5 && s >= 6 * 3600 && s < 20 * 3600; }
  function nextDayWindow(t) {
    if (inDayWindow(t)) return t;
    let d = Math.floor(t / DAY); const s = t - d * DAY;
    if (d % 7 < 5 && s < 6 * 3600) return d * DAY + 23400;
    d++; while (d % 7 >= 5) d++;
    return d * DAY + 23400;
  }
  const EXT_HANDOVER = () => (WF.sim && WF.sim.config && WF.sim.config.extHandoverSec) || 1200;

  // ------------------------------------------------------------------ Technische Zeichnungen (SVG)
  // Papier/Tusche als feste Farben: die Zeichnung ist ein Dokument (auch als PNG an Claude), kein Theme-Element.
  const C = { paper: '#f3f5f8', ink: '#141c28', thin: '#2b3a4f', hatch: '#7c8a9c', cl: '#566880', tb: '#1a2433', mute: '#5f6e82', iso1: '#e4e9f0', iso2: '#d3dbe5', iso3: '#c3cdda' };
  const FONT = "'Barlow Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif";
  const LW = { thick: 0.6, mid: 0.42, thin: 0.22 };
  let svgSeq = 0;
  const f2 = (v) => Math.round(v * 100) / 100;
  function Sheet() {
    const id = 'kad' + (++svgSeq);
    const o = [];
    const s = {
      id, o,
      raw(x) { o.push(x); return s; },
      path(d, a = {}) {
        o.push(`<path d="${d}" fill="${a.fill || 'none'}" stroke="${a.stroke || C.ink}" stroke-width="${a.w != null ? a.w : LW.thick}"${a.dash ? ` stroke-dasharray="${a.dash}"` : ''} stroke-linejoin="round" stroke-linecap="${a.cap || 'butt'}"${a.extra || ''}/>`);
        return s;
      },
      poly(pts, a = {}) { return s.path('M' + pts.map(p => f2(p[0]) + ' ' + f2(p[1])).join('L') + (a.close ? 'Z' : ''), a); },
      line(x1, y1, x2, y2, a = {}) { return s.path(`M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`, Object.assign({ w: LW.thin, stroke: C.thin }, a)); },
      thick(x1, y1, x2, y2) { return s.line(x1, y1, x2, y2, { w: LW.thick, stroke: C.ink }); },
      center(x1, y1, x2, y2) { return s.line(x1, y1, x2, y2, { w: LW.thin, stroke: C.cl, dash: '7 1.3 1.2 1.3' }); },
      hidden(x1, y1, x2, y2) { return s.line(x1, y1, x2, y2, { w: 0.3, stroke: C.thin, dash: '2.2 1.1' }); },
      chain(x1, y1, x2, y2) { return s.line(x1, y1, x2, y2, { w: 0.62, stroke: C.ink, dash: '6 1.2 1 1.2' }); },
      rect(x, y, w, h, a = {}) { return s.path(`M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}Z`, Object.assign({ w: LW.thin, stroke: C.thin }, a)); },
      circle(cx, cy, r, a = {}) {
        o.push(`<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="${a.fill || 'none'}" stroke="${a.stroke || C.ink}" stroke-width="${a.w != null ? a.w : LW.thick}"${a.dash ? ` stroke-dasharray="${a.dash}"` : ''}/>`);
        return s;
      },
      /** 3/4-Kreis (Gewinde-Außendurchmesser in der Draufsicht, ISO 6410) */
      arc34(cx, cy, r) {
        const a0 = -Math.PI / 2 + 0.25, a1 = Math.PI * 1.0 - 0.25;
        const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        return s.path(`M${f2(p0[0])} ${f2(p0[1])}A${r} ${r} 0 1 1 ${f2(p1[0])} ${f2(p1[1])}`, { w: LW.thin, stroke: C.thin });
      },
      text(x, y, str, a = {}) {
        const sz = a.size || 4.2;
        const tr = a.rot ? ` transform="rotate(${a.rot} ${f2(x)} ${f2(y)})"` : '';
        const halo = a.halo === false ? '' : ` stroke="${C.paper}" stroke-width="${a.haloW || 1.3}" paint-order="stroke" stroke-linejoin="round"`;
        o.push(`<text x="${f2(x)}" y="${f2(y)}" font-size="${sz}" font-family="${FONT}" font-weight="${a.weight || 500}" fill="${a.fill || C.ink}" text-anchor="${a.anchor || 'start'}"${a.ls ? ` letter-spacing="${a.ls}"` : ''}${halo}${tr}>${esc(str)}</text>`);
        return s;
      },
      /** Maßpfeil: Spitze bei (x, y), Richtung ang (rad) */
      arrow(x, y, ang, a = {}) {
        const L = a.len || 2.5, H = a.half || 0.62, c = Math.cos(ang), n = Math.sin(ang);
        const bx = x - c * L, by = y - n * L;
        o.push(`<path d="M${f2(x)} ${f2(y)}L${f2(bx - n * H)} ${f2(by + c * H)}L${f2(bx + n * H)} ${f2(by - c * H)}Z" fill="${a.fill || C.thin}"/>`);
        return s;
      },
      /** waagrechtes Maß; e1/e2 = y der Formelemente für Maßhilfslinien (null = keine) */
      dimH(x1, x2, y, a = {}) {
        const g = 1.1, ov = 1.6;
        if (a.e1 != null) { const d = Math.sign(y - a.e1) || 1; s.line(x1, a.e1 + d * g, x1, y + d * ov); }
        if (a.e2 != null) { const d = Math.sign(y - a.e2) || 1; s.line(x2, a.e2 + d * g, x2, y + d * ov); }
        if (Math.abs(x2 - x1) < 7.5 || a.out) { s.line(x1 - 4.5, y, x2 + 4.5, y); s.arrow(x1, y, 0); s.arrow(x2, y, Math.PI); }
        else { s.line(x1, y, x2, y); s.arrow(x1, y, Math.PI); s.arrow(x2, y, 0); }
        if (a.label) s.text(a.tx != null ? a.tx : (x1 + x2) / 2, y - 1.05, a.label, { anchor: 'middle', size: a.size || 4.1 });
        return s;
      },
      /** senkrechtes Maß (Text um −90° gedreht links der Maßlinie); half = Halbmaß (ein Pfeil) */
      dimV(y1, y2, x, a = {}) {
        const g = 1.1, ov = 1.6;
        if (a.e1 != null) { const d = Math.sign(x - a.e1) || 1; s.line(a.e1 + d * g, y1, x + d * ov, y1); }
        if (a.e2 != null) { const d = Math.sign(x - a.e2) || 1; s.line(a.e2 + d * g, y2, x + d * ov, y2); }
        if (a.half) { s.line(x, y1, x, y2); s.arrow(x, y1, y1 < y2 ? -Math.PI / 2 : Math.PI / 2); }
        else if (Math.abs(y2 - y1) < 7.5) { s.line(x, y1 - 4.5, x, y2 + 4.5); s.arrow(x, y1, Math.PI / 2); s.arrow(x, y2, -Math.PI / 2); }
        else { s.line(x, y1, x, y2); s.arrow(x, y1, -Math.PI / 2); s.arrow(x, y2, Math.PI / 2); }
        if (a.label) s.text(x - 1.05, a.ty != null ? a.ty : (y1 + y2) / 2, a.label, { anchor: 'middle', rot: -90, size: a.size || 4.1 });
        return s;
      },
      /** Hinweislinie mit Pfeil an pts[0] und optionaler Bezugslinie + Text */
      leader(pts, a = {}) {
        s.poly(pts, { w: LW.thin, stroke: C.thin });
        const [p0, p1] = pts;
        if (a.dot) o.push(`<circle cx="${f2(p0[0])}" cy="${f2(p0[1])}" r="0.7" fill="${C.thin}"/>`);
        else s.arrow(p0[0], p0[1], Math.atan2(p0[1] - p1[1], p0[0] - p1[0]));
        if (a.label) { const q = pts[pts.length - 1]; s.text(q[0] + (a.dx || 0), q[1] - 1.1, a.label, { anchor: a.anchor || 'start', size: a.size || 3.9 }); }
        return s;
      },
      /** Oberflächensymbol ISO 1302 – Spitze auf der Fläche (x, y), Symbol oberhalb */
      surf(x, y, label) {
        const bar = Math.max(9, label.length * 1.75 + 2);
        s.path(`M${f2(x - 2.1)} ${f2(y - 3.6)}L${f2(x)} ${f2(y)}L${f2(x + 4.2)} ${f2(y - 7.3)}h${f2(bar)}`, { w: 0.3, stroke: C.thin });
        s.text(x + 4.9, y - 3.0, label, { size: 3.3 });
        return s;
      },
      /** Form- und Lagetoleranz-Rahmen; cells: [{sym}|{t}] */
      fcf(x, y, cells, h = 5.6) {
        let cx = x;
        for (const c of cells) {
          const w = c.sym ? h : Math.max(h, String(c.t).length * 1.95 + 2.4);
          s.rect(cx, y, w, h, { w: 0.28, stroke: C.thin });
          if (c.sym) s.sym(c.sym, cx + w / 2, y + h / 2);
          else s.text(cx + w / 2, y + h / 2 + 1.45, c.t, { anchor: 'middle', size: 3.6, halo: false });
          cx += w;
        }
        return cx;
      },
      sym(k, x, y) {
        const w = 0.3, st = C.ink;
        if (k === 'runout') { s.line(x - 1.7, y + 1.7, x + 1.5, y - 1.5, { w, stroke: st }); s.arrow(x + 1.8, y - 1.8, -Math.PI / 4, { len: 1.5, half: 0.55, fill: st }); }
        else if (k === 'perp') { s.line(x, y - 1.9, x, y + 1.7, { w, stroke: st }); s.line(x - 2, y + 1.7, x + 2, y + 1.7, { w, stroke: st }); }
        else if (k === 'flat') s.poly([[x - 2.3, y + 1.2], [x + 1.1, y + 1.2], [x + 2.3, y - 1.2], [x - 1.1, y - 1.2]], { close: true, w, stroke: st });
        else if (k === 'parallel') { s.line(x - 1.6, y + 1.8, x - 0.2, y - 1.8, { w, stroke: st }); s.line(x + 0.4, y + 1.8, x + 1.8, y - 1.8, { w, stroke: st }); }
        else if (k === 'position') { s.circle(x, y, 1.35, { w, stroke: st }); s.line(x - 2.2, y, x + 2.2, y, { w, stroke: st }); s.line(x, y - 2.2, x, y + 2.2, { w, stroke: st }); }
        return s;
      },
      /** Bezugsdreieck ISO 5459: Dreieck auf der Fläche, Buchstabe im Kasten (dir 1 = nach unten, −1 = nach oben) */
      datum(x, y, letter, dir = 1) {
        const b = 1.45, t = 2.4 * dir;
        o.push(`<path d="M${f2(x - b)} ${f2(y)}L${f2(x + b)} ${f2(y)}L${f2(x)} ${f2(y + t)}Z" fill="${C.ink}"/>`);
        s.line(x, y + t, x, y + t + 2.4 * dir, { w: 0.28 });
        const by = dir > 0 ? y + t + 2.4 : y + t - 2.4 - 5.4;
        s.rect(x - 2.7, by, 5.4, 5.4, { w: 0.3, stroke: C.thin });
        s.text(x, by + 4.15, letter, { anchor: 'middle', size: 3.9, weight: 600, halo: false });
        return s;
      },
      defs() {
        o.push(`<defs><pattern id="${id}-h" patternUnits="userSpaceOnUse" width="2.1" height="2.1" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.1" stroke="${C.hatch}" stroke-width="0.24"/></pattern></defs>`);
        return s;
      },
      hatch() { return `url(#${id}-h)`; },
      /** Blattrahmen mit Feldeinteilung (Zonen A–D, 1–6) */
      border() {
        const x0 = 12, y0 = 8, x1 = 289, y1 = 202;
        s.rect(x0, y0, x1 - x0, y1 - y0, { w: 0.7, stroke: C.ink });
        const cw = (x1 - x0) / 6, rh = (y1 - y0) / 4;
        for (let i = 0; i < 6; i++) {
          const cx = x0 + cw * (i + 0.5);
          s.text(cx, 5.6, String(i + 1), { anchor: 'middle', size: 2.6, fill: C.mute, halo: false });
          s.text(cx, 206.6, String(i + 1), { anchor: 'middle', size: 2.6, fill: C.mute, halo: false });
          if (i) { s.line(x0 + cw * i, 3.5, x0 + cw * i, y0, { w: 0.25 }); s.line(x0 + cw * i, y1, x0 + cw * i, 206.5, { w: 0.25 }); }
        }
        'ABCD'.split('').forEach((L, i) => {
          const cy = y0 + rh * (i + 0.5) + 1;
          s.text(7.2, cy, L, { anchor: 'middle', size: 2.6, fill: C.mute, halo: false });
          s.text(293.2, cy, L, { anchor: 'middle', size: 2.6, fill: C.mute, halo: false });
          if (i) { s.line(4, y0 + rh * i, x0, y0 + rh * i, { w: 0.25 }); s.line(x1, y0 + rh * i, 293, y0 + rh * i, { w: 0.25 }); }
        });
        return s;
      },
      /** Schriftfeld (angelehnt an ISO 7200) */
      titleBlock(i) {
        const X = 167, Y = 158, W = 122, H = 44, x1 = X + W;
        const lab = (x, y, t) => s.text(x + 1.2, y + 2.9, t, { size: 2.25, fill: C.mute, halo: false, ls: 0.1 });
        const val = (x, y, t, sz, wt) => s.text(x + 1.2, y, t, { size: sz || 3.9, weight: wt || 500, fill: C.tb, halo: false });
        s.rect(X, Y, W, H, { w: 0.7, stroke: C.ink });
        const rows = [Y + 7, Y + 19, Y + 28, Y + 36];
        rows.forEach(y => s.line(X, y, x1, y, { w: 0.3 }));
        // Zeile 0: Kunde | Erstellt
        s.line(X + 76, Y, X + 76, Y + 7, { w: 0.3 });
        lab(X, Y, 'KUNDE'); val(X + 13, Y + 5.3, i.customer, 3.2);
        s.line(X + 99, Y, X + 99, Y + 7, { w: 0.3 });
        lab(X + 76, Y, 'GEZ. / GEPR.'); val(X + 76, Y + 6.3, i.drawn || 'ML / TB', 2.9);
        lab(X + 99, Y, 'DATUM'); val(X + 99, Y + 6.3, i.date || '–', 2.9);
        // Zeile 1: Benennung | Maßstab | Projektion
        s.line(X + 76, Y + 7, X + 76, Y + 19, { w: 0.3 }); s.line(X + 100, Y + 7, X + 100, Y + 19, { w: 0.3 });
        lab(X, Y + 7, 'BENENNUNG'); val(X, Y + 16.6, i.name, 6, 600);
        lab(X + 76, Y + 7, 'MASSSTAB'); val(X + 76, Y + 16.6, i.scale, 5.2, 600);
        // Projektionssymbol (Methode 1, ISO 128-30)
        const px = X + 104.5, py = Y + 13.2;
        s.poly([[px, py - 2.4], [px + 6, py - 3.6], [px + 6, py + 3.6], [px, py + 2.4]], { close: true, w: 0.3, stroke: C.ink });
        s.circle(px + 13, py, 3.6, { w: 0.3 }); s.circle(px + 13, py, 2.4, { w: 0.3 });
        s.line(px - 1.5, py, px + 18, py, { w: 0.18, stroke: C.cl, dash: '3 0.8 0.8 0.8' });
        // Zeile 2: Zeichnungsnr. | Rev | Blatt
        s.line(X + 62, Y + 19, X + 62, Y + 28, { w: 0.3 }); s.line(X + 84, Y + 19, X + 84, Y + 28, { w: 0.3 }); s.line(X + 100, Y + 19, X + 100, Y + 28, { w: 0.3 });
        lab(X, Y + 19, 'ZEICHNUNGSNR.'); val(X, Y + 26.6, i.no, 4.4, 600);
        lab(X + 62, Y + 19, 'REV.'); val(X + 62, Y + 26.6, i.rev, 4.4, 600);
        lab(X + 84, Y + 19, 'BLATT'); val(X + 84, Y + 26.6, '1/1', 3.9);
        lab(X + 100, Y + 19, 'FORMAT'); val(X + 100, Y + 26.6, 'A4', 3.9);
        // Zeile 3: Werkstoff | Masse
        s.line(X + 84, Y + 28, X + 84, Y + 36, { w: 0.3 });
        lab(X, Y + 28, 'WERKSTOFF'); val(X, Y + 34.8, i.material, 3.7, 600);
        lab(X + 84, Y + 28, 'MASSE'); val(X + 84, Y + 34.8, i.mass, 3.7);
        // Zeile 4: Allgemeintoleranzen | Kanten | Oberfläche
        s.line(X + 46, Y + 36, X + 46, Y + 44, { w: 0.3 }); s.line(X + 84, Y + 36, X + 84, Y + 44, { w: 0.3 });
        lab(X, Y + 36, 'ALLGEMEINTOL.'); val(X, Y + 42.8, i.tol, 3.3);
        lab(X + 46, Y + 36, 'KANTEN'); val(X + 46, Y + 42.8, i.edges, 3.3);
        lab(X + 84, Y + 36, 'OBERFLÄCHE'); val(X + 84, Y + 42.8, 'ISO 1302 · ISO 21920', 2.9);
        return s;
      },
      /** allgemeine Oberflächenangabe √Ra x ( √ ) oberhalb des Schriftfelds */
      surfGeneral(x, y, main, extra) {
        s.surf(x, y, main);
        let cx = x + 4.2 + Math.max(9, main.length * 1.75 + 2) + 2.5;
        s.text(cx, y - 2.6, '(', { size: 5.2, weight: 400, halo: false });
        cx += 2.2;
        for (const e of extra || []) { s.surf(cx + 2.1, y, e); cx += 4.2 + Math.max(9, e.length * 1.75 + 2) + 3.4; }
        s.text(cx - 1.2, y - 2.6, ')', { size: 5.2, weight: 400, halo: false });
        return s;
      },
      notes(x, y, lines, w) {
        s.text(x, y, 'HINWEISE', { size: 2.8, weight: 600, fill: C.mute, ls: 0.2, halo: false });
        let yy = y + 5.2;
        lines.forEach((ln, k) => {
          s.text(x, yy, String(k + 1), { size: 3.3, weight: 600, halo: false });
          const words = ln.split(' '); let cur = '';
          const maxc = Math.floor((w - 5) / 1.62);
          const flush = () => { s.text(x + 4.2, yy, cur.trim(), { size: 3.3, halo: false }); yy += 4.3; cur = ''; };
          for (const wd of words) { if ((cur + ' ' + wd).trim().length > maxc) flush(); cur += ' ' + wd; }
          if (cur.trim()) flush();
          yy += 0.9;
        });
        return s;
      },
      svg(attrs, vb) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb || '0 0 297 210'}"${attrs || ''}><rect width="297" height="210" fill="${C.paper}"/>${o.join('')}</svg>`;
      },
    };
    return s;
  }

  // ---------------- Beispiel 1: Flanschwelle 42CrMo4 (Maßstab 1:1)
  function dwgFlanschwelle(attrs, vb) {
    const s = Sheet(); s.defs(); s.border();
    const y0 = 76;
    const up = [[30, y0 - 29], [31, y0 - 30], [46, y0 - 30], [46, y0 - 22.5], [71, y0 - 22.5], [71, y0 - 21], [191, y0 - 21], [191, y0 - 20], [215, y0 - 20], [215, y0 - 17.5],
      [222, y0 - 17.5], [222, y0 - 12.5], [262, y0 - 12.5], [262, y0 - 17.5], [269, y0 - 17.5], [270, y0 - 16.5]];
    const lo = [[30, y0 + 29], [31, y0 + 30], [46, y0 + 30], [46, y0 + 22.5], [71, y0 + 22.5], [71, y0 + 21], [191, y0 + 21], [191, y0 + 20], [215, y0 + 20], [215, y0 + 17.5], [269, y0 + 17.5], [270, y0 + 16.5]];
    s.poly(up.concat(lo.slice().reverse()), { close: true, w: LW.thick });
    [[31, 30], [46, 30], [71, 22.5], [191, 21], [215, 20], [269, 17.5]].forEach(([x, r]) => s.thick(x, y0 - r, x, y0 + r));
    s.thick(222, y0 - 16.77, 262, y0 - 16.77);            // Nutkante
    // Zentrierbohrung DIN 332-DS M10 (verdeckt)
    s.hidden(248, y0 - 5, 270, y0 - 5); s.hidden(248, y0 + 5, 270, y0 + 5);
    s.hidden(245, y0 - 4.25, 248, y0 - 4.25); s.hidden(245, y0 + 4.25, 248, y0 + 4.25);
    s.hidden(248, y0 - 5, 248, y0 + 5);
    s.hidden(245, y0 - 4.25, 242.6, y0); s.hidden(245, y0 + 4.25, 242.6, y0);
    s.center(22, y0, 279, y0);
    // Härtezonen (dicke Strichpunktlinie, ISO 15787)
    s.chain(47, y0 + 24, 70, y0 + 24); s.chain(192, y0 + 21.5, 214, y0 + 21.5);
    // Durchmesser
    s.dimV(y0 - 30, y0 + 30, 38.5, { label: 'Ø60', ty: y0 + 14 });
    s.dimV(y0 - 22.5, y0 + 22.5, 58.5, { label: 'Ø45 k6', ty: y0 + 11 });
    s.dimV(y0 - 21, y0 + 21, 131, { label: 'Ø42', ty: y0 + 10 });
    s.dimV(y0 - 20, y0 + 20, 203, { label: 'Ø40 k6', ty: y0 + 10.5 });
    s.dimV(y0 - 17.5, y0 + 17.5, 218.5, { label: 'Ø35 h6', ty: y0 + 9.6 });
    // Längen (unten): Kette + Gesamtlänge
    const yc = y0 + 40, yo = y0 + 50;
    s.line(30, y0 + 30.1, 30, yo + 1.6); s.line(46, y0 + 31.1, 46, yc + 1.6); s.line(71, y0 + 23.6, 71, yc + 1.6);
    s.line(191, y0 + 22.1, 191, yc + 1.6); s.line(215, y0 + 21.1, 215, yc + 1.6); s.line(270, y0 + 17.6, 270, yo + 1.6);
    s.dimH(30, 46, yc, { label: '16' }); s.dimH(46, 71, yc, { label: '25' }); s.dimH(71, 191, yc, { label: '(120)' });
    s.dimH(191, 215, yc, { label: '24' }); s.dimH(215, 270, yc, { label: '55' }); s.dimH(30, 270, yo, { label: '240' });
    // Passfedernut: Länge + Abstand zum Ende (oben)
    const yk = y0 - 32;
    s.line(222, y0 - 18.7, 222, yk - 1.6); s.line(262, y0 - 18.7, 262, yk - 1.6); s.line(270, y0 - 17.7, 270, yk - 1.6);
    s.dimH(222, 262, yk, { label: '40' }); s.dimH(262, 270, yk, { label: '8' });
    // Schnittverlauf A–A
    s.line(250, y0 - 21.5, 250, y0 - 26.5, { w: 0.75, stroke: C.ink }); s.line(250, y0 + 21.5, 250, y0 + 26.5, { w: 0.75, stroke: C.ink });
    s.line(250, y0 - 26.5, 255.5, y0 - 26.5, { w: 0.3 }); s.arrow(256.8, y0 - 26.5, 0, { len: 2.6, half: 0.8 });
    s.line(250, y0 + 26.5, 255.5, y0 + 26.5, { w: 0.3 }); s.arrow(256.8, y0 + 26.5, 0, { len: 2.6, half: 0.8 });
    s.text(258.6, y0 - 24.6, 'A', { size: 4.6, weight: 600 }); s.text(258.6, y0 + 29.7, 'A', { size: 4.6, weight: 600 });
    // Bezüge A/B + Oberflächen (oben)
    s.datum(56, y0 - 22.5, 'A', -1); s.datum(196, y0 - 20, 'B', -1);
    s.surf(63, y0 - 22.5, 'Ra 0,4'); s.surf(203.5, y0 - 20, 'Ra 0,4');
    // Freistiche an beiden Lagersitz-Schultern (Flansch/Ø45 und Ø42/Ø40): zwei Hinweislinien auf eine Bezugslinie
    s.leader([[46.7, y0 - 22.9], [51, y0 - 38], [158, y0 - 38]]);
    s.leader([[191.5, y0 - 20.3], [158, y0 - 38]]);
    s.text(104.5, y0 - 39.1, '2× Freistich DIN 509-F1×0,2', { anchor: 'middle', size: 3.8 });
    // Planlauf Flansch, Rundlauf Zapfen
    s.fcf(15.5, 24, [{ sym: 'runout' }, { t: '0,02' }, { t: 'A-B' }]);
    s.leader([[29.6, y0 - 20], [22, y0 - 20], [22, 29.6]]);
    s.fcf(222, y0 + 26.4, [{ sym: 'runout' }, { t: '0,01' }, { t: 'A-B' }]);
    s.leader([[236, y0 + 17.9], [236, y0 + 26.4]]);
    // Zentrierbohrung
    s.line(250, 17.6, 287, 17.6, { w: LW.thin });
    s.leader([[270.5, y0 - 2.2], [282, 17.6]]);
    s.text(268.5, 16.4, 'DIN 332-DS M10', { anchor: 'middle', size: 3.9 });
    // Schnitt A–A (Maßstab 1:1)
    const cx = 50, cy = 167, R = 17.5;
    s.text(cx, 136.5, 'A–A', { anchor: 'middle', size: 5, weight: 600 });
    const yN = cy - Math.sqrt(R * R - 25), yB = cy - 12.5;
    s.path(`M45 ${f2(yN)}L45 ${f2(yB)}L55 ${f2(yB)}L55 ${f2(yN)}A${R} ${R} 0 1 1 45 ${f2(yN)}Z`, { fill: s.hatch(), w: LW.thick });
    s.center(cx - 23, cy, cx + 23, cy); s.center(cx, cy - 22, cx, cy + 22);
    s.line(45, yN - 1.1, 45, 140.4); s.line(55, yN - 1.1, 55, 140.4);
    s.dimH(45, 55, 142, { label: '10 P9', out: true, tx: 50 });
    s.line(56.1, yB, 77.6, yB); s.line(cx + 1.1, cy + R, 77.6, cy + R);
    s.dimV(yB, cy + R, 76, { label: '30 −0,2' });
    // Hinweise + allgemeine Oberfläche
    s.notes(92, 146, [
      'Lagersitze Ø45 k6 und Ø40 k6 (━ · ━) induktiv gehärtet 55+3 HRC, Rht 1,5+1 mm',
      'Rundlauf und Lagersitze nach dem Schleifen 100 % prüfen',
      'Passfedernut DIN 6885-A, Kanten entgratet',
      'Werkstoffzeugnis EN 10204-3.1',
    ], 72);
    s.surfGeneral(205, 153, 'Ra 3,2', ['Ra 0,4', 'Ra 0,8']);
    s.titleBlock({ customer: 'Kärntner Antriebstechnik GmbH', name: 'Flanschwelle', scale: '1:1', no: 'FW-6024-01', rev: 'A',
      material: '42CrMo4+QT (1.7225)', mass: '2,3 kg', tol: 'ISO 2768-mK', edges: 'ISO 13715 −0,3', date: '2026-10-12' });
    return s.svg(attrs, vb);
  }

  // ---------------- Beispiel 2: Lagerbuchse 1.4404 (Maßstab 5:1)
  function dwgLagerbuchse(attrs, vb) {
    const s = Sheet(); s.defs(); s.border();
    const y0 = 84, xa = 70, xb = 150, Ro = 27.5, Ri = 17.5;
    // Halbschnitt oben (geschnitten), unten Ansicht
    s.poly([[xa + 1.5, y0 - Ro], [xb - 1.5, y0 - Ro], [xb, y0 - Ro + 1.5], [xb, y0 - Ri - 1], [xb - 1, y0 - Ri], [xa + 1, y0 - Ri], [xa, y0 - Ri - 1], [xa, y0 - Ro + 1.5]], { close: true, fill: s.hatch(), w: LW.thick });
    s.thick(xa + 1, y0 - Ri, xa + 1, y0); s.thick(xb - 1, y0 - Ri, xb - 1, y0);
    s.poly([[xa, y0], [xa, y0 + Ro - 1.5], [xa + 1.5, y0 + Ro], [xb - 1.5, y0 + Ro], [xb, y0 + Ro - 1.5], [xb, y0]], { w: LW.thick });
    s.thick(xa + 1.5, y0, xa + 1.5, y0 + Ro); s.thick(xb - 1.5, y0, xb - 1.5, y0 + Ro);
    s.center(62, y0, 158, y0);
    // Seitenansicht
    const ex = 232;
    s.circle(ex, y0, Ro); s.circle(ex, y0, Ro - 1.5, { w: LW.mid }); s.circle(ex, y0, Ri); s.circle(ex, y0, Ri + 1, { w: LW.mid });
    s.center(ex - 33, y0, ex + 33, y0); s.center(ex, y0 - 33, ex, y0 + 33);
    // Maße
    s.dimV(y0 - Ro, y0 + Ro, 58, { e1: xa + 1.5, e2: xa + 1.5, label: 'Ø11 r6' });
    s.dimV(y0 - Ri, y0 + 7, 130, { half: true, label: 'Ø7 H7', ty: y0 - 9.4 });
    s.dimH(xa, xb, 124, { e1: y0 + Ro - 1.5, e2: y0 + Ro - 1.5, label: '16 ±0,05' });
    s.leader([[xb - 0.75, y0 - Ro + 0.75], [160, 49], [178, 49]], { label: '0,3×45°', dx: -17 });
    s.leader([[xb - 0.5, y0 - Ri - 0.5], [160, 62.5], [178, 62.5]], { label: '0,2×45°', dx: -17 });
    // Bezug A an der Bohrung, Form-/Lagetoleranzen
    s.datum(84, y0 - Ri, 'A', 1);
    s.fcf(86, 34, [{ sym: 'runout' }, { t: '0,02' }, { t: 'A' }]);
    s.leader([[98, y0 - Ro - 0.4], [98, 39.6]]);
    s.fcf(156, 96, [{ sym: 'perp' }, { t: '0,02' }, { t: 'A' }]);
    s.leader([[xb + 0.4, 99], [156, 99]]);
    // Oberflächen
    s.surf(118, y0 - Ro, 'Ra 1,6');
    s.leader([[102, y0 - Ri + 0.4], [102, 80.5], [117, 80.5]]);
    s.surf(104.5, 80.5, 'Ra 0,8');
    s.text(xa + 40, 138.5, 'M 5:1', { anchor: 'middle', size: 3.4, fill: C.mute, halo: false });
    s.notes(22, 150, [
      'Teile gratfrei und ölfrei gereinigt, Restschmutz ≤ 2 mg je Teil (Medienkontakt)',
      'Bohrung Ø7 H7 ausgedreht, keine Riefen in Längsrichtung',
      'Nicht bemaßte Kanten ISO 13715 −0,1',
      'Werkstoffzeugnis EN 10204-3.1',
    ], 138);
    s.surfGeneral(205, 153, 'Ra 3,2', ['Ra 1,6', 'Ra 0,8']);
    s.titleBlock({ customer: 'Hydrava Pumpen GmbH', name: 'Lagerbuchse', scale: '5:1', no: 'LB-1107-02', rev: 'B',
      material: '1.4404 (X2CrNiMo17-12-2)', mass: '7 g', tol: 'ISO 2768-fH', edges: 'ISO 13715 −0,1', date: '2026-09-28' });
    return s.svg(attrs, vb);
  }

  // ---------------- Beispiel 3: Halteplatte AlMgSi1 (Maßstab 1:1)
  function dwgHalteplatte(attrs, vb) {
    const s = Sheet(); s.defs(); s.border();
    const X0 = 36, Y0 = 30, W = 110, H = 75, R = 8, cx = X0 + W / 2, cy = Y0 + H / 2;
    s.path(`M${X0 + R} ${Y0}H${X0 + W - R}A${R} ${R} 0 0 1 ${X0 + W} ${Y0 + R}V${Y0 + H - R}A${R} ${R} 0 0 1 ${X0 + W - R} ${Y0 + H}H${X0 + R}A${R} ${R} 0 0 1 ${X0} ${Y0 + H - R}V${Y0 + R}A${R} ${R} 0 0 1 ${X0 + R} ${Y0}Z`, { w: LW.thick });
    // Ø30 H7
    s.circle(cx, cy, 15);
    // 4× M10 (Kernloch dick, Außen-Ø als 3/4-Kreis dünn)
    const mh = [[cx - 45, cy - 27.5], [cx + 45, cy - 27.5], [cx - 45, cy + 27.5], [cx + 45, cy + 27.5]];
    for (const [x, y] of mh) { s.circle(x, y, 4.25); s.arc34(x, y, 5); s.center(x - 7.5, y, x + 7.5, y); s.center(x, y - 7.5, x, y + 7.5); }
    // 2× Ø10
    for (const x of [cx - 32, cx + 32]) { s.circle(x, cy, 5); s.center(x, cy - 7.5, x, cy + 7.5); }
    s.center(X0 - 5, cy, X0 + W + 5, cy); s.center(cx, Y0 - 5, cx, Y0 + H + 5);
    // Maße Draufsicht
    s.dimH(X0, X0 + W, 18.5, { e1: Y0, e2: Y0, label: '110' });
    s.line(cx - 45, cy - 35.6, cx - 45, 23.8); s.line(cx + 45, cy - 35.6, cx + 45, 23.8);
    s.dimH(cx - 45, cx + 45, 25.4, { label: '90' });
    s.line(X0 + W + 1.1, Y0, 166, Y0); s.line(X0 + W + 1.1, Y0 + H, 166, Y0 + H);
    s.line(cx + 52.6, cy - 27.5, 159.2, cy - 27.5); s.line(cx + 52.6, cy + 27.5, 159.2, cy + 27.5);
    s.dimV(cy - 27.5, cy + 27.5, 157.6, { label: '55' });
    s.dimV(Y0, Y0 + H, 164.4, { label: '75' });
    s.leader([[cx + 48.6, cy + 31.1], [146, 112.5], [171, 112.5]], { label: '4× M10 – durch', dx: -24.6 });
    s.leader([[cx - 35.6, cy + 3.6], [68, 89.5], [96, 89.5]], { label: '2× Ø10 – durch', dx: -27.6 });
    s.leader([[X0 + R - R * Math.SQRT1_2, Y0 + H - R + R * Math.SQRT1_2], [30, 111], [17, 111]], { label: '4× R8' });
    // Schnittverlauf B–B
    for (const x of [X0 - 4.5, X0 + W + 0.5]) s.line(x, cy, x + 4, cy, { w: 0.75, stroke: C.ink });
    s.line(X0 - 2.5, cy, X0 - 2.5, cy + 6.5, { w: 0.3 }); s.arrow(X0 - 2.5, cy + 7.7, Math.PI / 2, { len: 2.6, half: 0.8 });
    s.line(X0 + W + 2.5, cy, X0 + W + 2.5, cy + 6.5, { w: 0.3 }); s.arrow(X0 + W + 2.5, cy + 7.7, Math.PI / 2, { len: 2.6, half: 0.8 });
    s.text(X0 - 7.4, cy + 9.3, 'B', { size: 4.6, weight: 600 }); s.text(X0 + W + 4.2, cy + 9.3, 'B', { size: 4.6, weight: 600 });
    // Schnitt B–B
    const sy = 125, T = 15;
    s.text(22, sy + 9.5, 'B–B', { anchor: 'middle', size: 5, weight: 600 });
    const segs = [[X0, cx - 37], [cx - 27, cx - 15], [cx + 15, cx + 27], [cx + 37, X0 + W]];
    for (const [a, b] of segs) s.rect(a, sy, b - a, T, { fill: s.hatch(), w: LW.thick, stroke: C.ink });
    for (const x of [cx - 32, cx, cx + 32]) s.center(x, sy - 3, x, sy + T + 3);
    s.dimV(sy, sy + T, 157.6, { e1: X0 + W, e2: X0 + W, label: '15' });
    s.line(cx - 15, sy - 1.1, cx - 15, 116.4); s.line(cx + 15, sy - 1.1, cx + 15, 116.4);
    s.dimH(cx - 15, cx + 15, 118, { label: 'Ø30 H7' });
    s.fcf(cx + 17, 113, [{ sym: 'perp' }, { t: 'Ø0,02' }, { t: 'A' }]);
    s.line(cx - 32, sy + T + 3.6, cx - 32, 155.2); s.line(cx + 32, sy + T + 3.6, cx + 32, 155.2);
    s.dimH(cx - 32, cx + 32, 153.6, { label: '64' });
    s.datum(46, sy + T, 'A', 1);
    s.fcf(15, 147, [{ sym: 'flat' }, { t: '0,02' }]);
    s.leader([[38, sy + T + 0.4], [38, 149.8], [30.4, 149.8]]);
    s.fcf(150, 119.2, [{ sym: 'parallel' }, { t: '0,02' }, { t: 'A' }]);
    s.leader([[141, sy - 0.4], [141, 122], [150, 122]]);
    s.surf(44, sy, 'Ra 1,6');
    // Isometrie (ohne Maßstab)
    const iso = (x, y, z) => [222 + (x - y) * 0.42, 52 + (x + y) * 0.243 - z * 0.485];
    const outline = (z) => {
      const pts = [], k = 6;
      const corner = (ccx, ccy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (i / k) * Math.PI / 2; pts.push(iso(ccx + R * Math.cos(a), ccy + R * Math.sin(a), z)); } };
      corner(W - R, R, -Math.PI / 2); corner(W - R, H - R, 0); corner(R, H - R, Math.PI / 2); corner(R, R, Math.PI);
      return pts;
    };
    const top = outline(T), bot = outline(0);
    const ix = (pts) => pts.reduce((m, p, i) => p[0] > pts[m][0] ? i : m, 0), iy = (pts) => pts.reduce((m, p, i) => p[0] < pts[m][0] ? i : m, 0);
    const iR = ix(top), iL = iy(top);
    // sichtbare Mantelfläche: von ganz links (iL) über vorne bis ganz rechts (iR)
    const front = []; for (let i = iR; ; i = (i + 1) % top.length) { front.push(i); if (i === iL) break; }
    const side = front.map(i => top[i]).concat(front.slice().reverse().map(i => bot[i]));
    s.poly(side, { close: true, fill: C.iso2, w: LW.mid, stroke: C.ink });
    s.poly(top, { close: true, fill: C.iso1, w: LW.mid, stroke: C.ink });
    const ell = (x, y, r, z) => { const p = []; for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2; p.push(iso(x + r * Math.cos(a), y + r * Math.sin(a), z)); } return p; };
    {
      const e = ell(W / 2, H / 2, 15, T);
      s.raw(`<clipPath id="${s.id}-c"><path d="M${e.map(p => f2(p[0]) + ' ' + f2(p[1])).join('L')}Z"/></clipPath>`);
      s.poly(e, { close: true, fill: C.iso3, w: LW.mid, stroke: C.ink });
      const eb = ell(W / 2, H / 2, 15, 0);
      s.raw(`<g clip-path="url(#${s.id}-c)">`); s.poly(eb, { close: true, fill: C.paper, w: LW.thin, stroke: C.thin }); s.raw('</g>');
    }
    for (const [x, y] of [[10, 10], [100, 10], [10, 65], [100, 65]]) s.poly(ell(x, y, 4.25, T), { close: true, fill: C.iso3, w: 0.3, stroke: C.ink });
    for (const x of [W / 2 - 32, W / 2 + 32]) s.poly(ell(x, H / 2, 5, T), { close: true, fill: C.iso3, w: 0.3, stroke: C.ink });
    s.notes(176, 121, [
      'Eloxiert E6/EV1 natur, Schichtdicke 10–15 µm',
      'Ø30 H7 vor dem Eloxieren abdecken (Passung)',
      'Alle Kanten gratfrei, gebrochen 0,3×45°',
    ], 110);
    s.surfGeneral(205, 153, 'Ra 3,2', ['Ra 1,6', 'Ra 0,8']);
    s.titleBlock({ customer: 'Pinzgauer Fördertechnik GmbH', name: 'Halteplatte', scale: '1:1', no: 'HP-1175-03', rev: 'A',
      material: 'EN AW-6082 T651 (AlMgSi1)', mass: '0,30 kg', tol: 'ISO 2768-mK', edges: 'ISO 13715 −0,3', date: '2026-10-07' });
    return s.svg(attrs, vb);
  }

  // ------------------------------------------------------------------ Beispiele mit vorberechneter Auswertung
  // Zeiten/Werkzeuge passend zu den Maschinen des Profils (Taktzeiten vergleichbarer Profilaufträge: Ø60-Kolben M02 7,5 min,
  // Rundschleifen M09 5–6 min, Distanzhülse M03 0,9 min, Pumpengehäuse M05 28 min …). Merkmalspositionen in Zeichnungseinheiten.
  const HAERTEREI = 'Härterei Wolf GmbH (Beispiel)';
  const EXAMPLES = [
    {
      id: 'flanschwelle', thumb: '18 22 266 112', title: 'Flanschwelle', sub: '42CrMo4 · Ø60 × 240 · gehärtet + geschliffen', draw: dwgFlanschwelle,
      defaults: { qty: 20, customer: 'Kärntner Antriebstechnik GmbH', dueWd: 4, dueTime: '14:00' },
      desc: 'Flanschwelle FW-6024-01 Rev. A, Werkstoff 42CrMo4+QT, Masse 2,3 kg, Maßstab 1:1. Stufenwelle: Flansch Ø60×16, Lagersitz Ø45 k6×25 (Ra 0,4, Bezug A), Ø42×120, Lagersitz Ø40 k6×24 (Ra 0,4, Bezug B), Zapfen Ø35 h6×55 mit Passfedernut 10 P9×40 (Nuttiefe: Restmaß 30 −0,2), Gesamtlänge 240. Zentrierbohrung DIN 332-DS M10. Planlauf Flansch 0,02 A-B, Rundlauf Zapfen 0,01 A-B. Lagersitze induktiv gehärtet 55+3 HRC, Rht 1,5+1 mm. Freistiche DIN 509-F1×0,2. Allgemeintoleranz ISO 2768-mK, Ra 3,2 allgemein.',
      result: {
        part: { name: 'Flanschwelle', no: 'FW-6024', drawing: 'FW-6024-01 Rev. A', material: '42CrMo4+QT (1.7225)', weightKg: 2.3, dims: 'Ø60 × 240 mm', customer: 'Kärntner Antriebstechnik GmbH' },
        raw: { materialId: 'MAT-42CR65', text: 'Stange 42CrMo4+QT Ø65 · Zuschnitt 246 mm (Plan-Aufmaß + Schnittfuge)', perPart: 0.246, unit: 'm' },
        features: [
          { kind: 'fit', text: 'Ø45 k6', detail: 'Lagersitz, geschliffen Ra 0,4 · Bezug A', critical: true, pos: [64, 88] },
          { kind: 'fit', text: 'Ø40 k6', detail: 'Lagersitz, geschliffen Ra 0,4 · Bezug B', critical: true, pos: [208, 88] },
          { kind: 'fit', text: 'Ø35 h6', detail: 'Antriebszapfen, Ra 0,8', critical: true, pos: [238, 89] },
          { kind: 'runout', text: '0,01 A-B', detail: 'Rundlauf Zapfen zu den Lagersitzen', critical: true, pos: [216.6, 105.2] },
          { kind: 'hardness', text: '55+3 HRC', detail: 'Lagersitze induktiv gehärtet, Rht 1,5+1 mm', critical: true, pos: [58, 100.5] },
          { kind: 'keyway', text: 'Nut 10 P9 × 40', detail: 'Passfedernut DIN 6885-A, Restmaß 30 −0,2', critical: false, pos: [242, 60] },
          { kind: 'thread', text: 'DIN 332-DS M10', detail: 'Zentrierbohrung mit Gewinde', critical: false, pos: [262, 76] },
          { kind: 'runout', text: '0,02 A-B', detail: 'Planlauf Flanschfläche', critical: false, pos: [49.6, 26.8] },
          { kind: 'tol', text: 'ISO 2768-mK', detail: 'Allgemeintoleranzen, Kanten ISO 13715', critical: false },
        ],
        routing: [
          { op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1.9, transferBatch: 20, firstPiece: false,
            tools: [{ type: 'TT-SB', cutMinPerPart: 1.5 }], reason: 'Stange Ø65 auf 246 mm – Säge zieht direkt aus dem Kragarmregal' },
          { op: 'Drehen/Fräsen komplett', station: 'M02', setupMin: 55, cycleMin: 11.5, transferBatch: 20, firstPiece: true,
            tools: [{ type: 'TT-CNMG', cutMinPerPart: 3.6 }, { type: 'TT-VNMG', cutMinPerPart: 2.2 }, { type: 'TT-STECH', cutMinPerPart: 0.5 }, { type: 'TT-VHM10', cutMinPerPart: 1.4 }, { type: 'TT-DR85', cutMinPerPart: 0.3 }, { type: 'TT-GBM10', cutMinPerPart: 0.25 }],
            char: { name: 'Ø 45,3 Schleifaufmaß', nominal: 45.3, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.004, driftAt100: 0.008 },
            reason: 'Dreh-Fräszentrum mit Gegenspindel: beide Seiten in einer Aufspannung, Passfedernut und M10 mit angetriebenen Werkzeugen; Lagersitze mit 0,3 mm Schleifaufmaß' },
          { op: 'Induktionshärten Lagersitze', station: 'EXT', transferBatch: 20,
            ext: { partner: HAERTEREI, process: 'Induktionshärten 55+3 HRC, Rht 1,5+1 · Tagesdurchlauf (Rahmenvertrag)', leadMin: 360 },
            reason: 'Lohnhärten: Rht 1,5+1 mm an Ø45/Ø40 – ganzes Los als eine Charge. Rahmenvertrag mit täglicher Abholung: 6 h beim Partner (ohne Rahmenvertrag üblich 2–5 Arbeitstage)' },
          { op: 'Rundschleifen Lagersitze + Zapfen', station: 'M09', setupMin: 30, cycleMin: 7.5, transferBatch: 20, firstPiece: true,
            tools: [{ type: 'TT-SSR', cutMinPerPart: 6 }],
            char: { name: 'Ø 45 k6 geschliffen', nominal: 45.010, tolMinus: -0.008, tolPlus: 0.008, unit: 'mm', sigma: 0.0016, driftAt100: 0.003 },
            reason: 'k6/h6 und Ra 0,4 nach dem Härten nur durch Schleifen; Einstechschleifen mit In-Prozess-Messung' },
          { op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.3, transferBatch: 20, firstPiece: false, reason: 'Schleifschlamm entfernen vor der Endprüfung' },
          { op: 'Endprüfung Rundlauf + Lagersitze', station: 'QS', setupMin: 0, cycleMin: 2.5, transferBatch: 20, firstPiece: false, reason: 'Ø45 k6, Ø40 k6, Ø35 h6 und Rundlauf 0,01 am KMG; Härteprüfung Stichprobe' },
        ],
        notes: ['Rundlauf 0,01 A-B ist nur über Schleifen zwischen Spitzen sicher – Zentrierbohrungen bleiben bis zum Schluss erhalten.'],
        confidence: 0.9,
      },
    },
    {
      id: 'lagerbuchse', thumb: '40 30 230 97', title: 'Lagerbuchse', sub: '1.4404 · Ø11 r6 / Ø7 H7 × 16 · Serie', draw: dwgLagerbuchse,
      defaults: { qty: 500, customer: 'Hydrava Pumpen GmbH', dueWd: 3, dueTime: '12:00' },
      desc: 'Lagerbuchse LB-1107-02 Rev. B, Werkstoff 1.4404 (X2CrNiMo17-12-2), Masse 7 g, Maßstab 5:1, Halbschnitt. Außen Ø11 r6 (Ra 1,6), Bohrung Ø7 H7 durchgehend (Ra 0,8, ausgedreht, Bezug A), Länge 16 ±0,05, Fasen außen 0,3×45°, innen 0,2×45°. Rundlauf außen 0,02 zu A, Rechtwinkligkeit Planfläche 0,02 zu A. Teile gratfrei und ölfrei gereinigt (Restschmutz ≤ 2 mg). Allgemeintoleranz ISO 2768-fH.',
      result: {
        part: { name: 'Lagerbuchse', no: 'LB-1107', drawing: 'LB-1107-02 Rev. B', material: '1.4404 (X2CrNiMo17-12-2)', weightKg: 0.007, dims: 'Ø11 × 16 mm', customer: 'Hydrava Pumpen GmbH' },
        raw: { materialId: 'MAT-14404', text: 'Stange 1.4404 Ø12 h9 · 20 mm je Teil inkl. Abstich', perPart: 0.02, unit: 'm' },
        features: [
          { kind: 'fit', text: 'Ø7 H7', detail: 'Lagerbohrung ausgedreht, Ra 0,8 · Bezug A', critical: true, pos: [134, 72] },
          { kind: 'fit', text: 'Ø11 r6', detail: 'Presssitz im Pumpengehäuse', critical: true, pos: [52, 98] },
          { kind: 'runout', text: '0,02 A', detail: 'Rundlauf außen zur Bohrung', critical: true, pos: [92, 30] },
          { kind: 'note', text: 'gratfrei, ölfrei', detail: 'Restschmutz ≤ 2 mg je Teil – Reinigung nötig', critical: true, pos: [20, 156] },
          { kind: 'tol', text: '16 ±0,05', detail: 'Länge', critical: false, pos: [124, 119] },
          { kind: 'perp', text: '0,02 A', detail: 'Planfläche rechtwinklig zur Bohrung', critical: false, pos: [182, 99] },
          { kind: 'geometry', text: '0,3×45° / 0,2×45°', detail: 'Fasen außen / innen', critical: false, pos: [183, 55] },
        ],
        routing: [
          { op: 'Langdrehen komplett', station: 'M03', setupMin: 40, cycleMin: 1.3, transferBatch: 250, firstPiece: true,
            tools: [{ type: 'TT-MIKRO', cutMinPerPart: 0.6 }, { type: 'TT-DR68', cutMinPerPart: 0.25 }, { type: 'TT-ABST', cutMinPerPart: 0.25 }],
            char: { name: 'Bohrung Ø 7 H7', nominal: 7.0075, tolMinus: -0.0075, tolPlus: 0.0075, unit: 'mm', sigma: 0.0016, driftAt100: -0.004 },
            reason: 'Langdreher mit Stangenlader: von der Stange Ø12 h9 außen drehen, Ø6,8 bohren, Ø7 H7 ausdrehen, abstechen – läuft auch unbemannt' },
          { op: 'Reinigen (ölfrei)', station: 'M11', setupMin: 5, cycleMin: 0.04, transferBatch: 250, firstPiece: false, reason: 'Restschmutz ≤ 2 mg: Kammerreinigung im Korb' },
          { op: 'Losprüfung (Stichprobe)', station: 'QS', setupMin: 0, cycleMin: 0.05, transferBatch: 250, firstPiece: false, reason: 'Ø7 H7 mit Lehrdorn, Ø11 r6 und Rundlauf als Stichprobe (AQL 0,65)' },
        ],
        notes: ['Bei 500 Stück lohnt die Geisterschicht: der Langdreher läuft nachts unbemannt weiter, solange Standzeit und Stangenmagazin reichen.'],
        confidence: 0.92,
      },
    },
    {
      id: 'halteplatte', thumb: '14 12 280 118', title: 'Halteplatte', sub: 'AlMgSi1 · 110 × 75 × 15 · Bohrbild, M10, eloxiert', draw: dwgHalteplatte,
      defaults: { qty: 24, customer: 'Pinzgauer Fördertechnik GmbH', dueWd: 3, dueTime: '16:00' },
      desc: 'Halteplatte HP-1175-03 Rev. A, Werkstoff EN AW-6082 T651 (AlMgSi1), Masse 0,30 kg, Maßstab 1:1. Platte 110×75×15, Ecken R8. Zentrierbohrung Ø30 H7 durch (⊥ Ø0,02 zu A), 4× M10 durch auf Teilung 90×55, 2× Ø10 durch im Abstand 64. Auflagefläche A Ebenheit 0,02, Oberseite parallel 0,02 zu A, Ra 1,6 auf den Flächen, Ra 0,8 in Ø30. Eloxiert E6/EV1 natur 10–15 µm, Ø30 H7 abdecken. Allgemeintoleranz ISO 2768-mK.',
      result: {
        part: { name: 'Halteplatte', no: 'HP-1175', drawing: 'HP-1175-03 Rev. A', material: 'EN AW-6082 T651 (AlMgSi1)', weightKg: 0.3, dims: '110 × 75 × 15 mm', customer: 'Pinzgauer Fördertechnik GmbH' },
        raw: { materialId: 'MAT-ALBL', text: 'Lagerblock AlMgSi1 160×120×80 → 8 Platten 120×80×17 je Block (Säge)', perPart: 0.125, unit: 'Stk' },
        features: [
          { kind: 'fit', text: 'Ø30 H7', detail: 'Zentrierbohrung, Ra 0,8', critical: true, pos: [91, 67.5] },
          { kind: 'perp', text: 'Ø0,02 A', detail: 'Bohrung senkrecht zur Auflagefläche', critical: true, pos: [136.6, 115.8] },
          { kind: 'flat', text: '0,02', detail: 'Ebenheit der Auflagefläche A', critical: true, pos: [10, 150] },
          { kind: 'coating', text: 'Eloxal E6/EV1', detail: 'natur 10–15 µm, Passung Ø30 abdecken', critical: true, pos: [171.6, 131.4] },
          { kind: 'thread', text: '4× M10 durch', detail: 'Teilung 90 × 55', critical: false, pos: [136, 95] },
          { kind: 'hole', text: '2× Ø10 durch', detail: 'Abstand 64', critical: false, pos: [59, 67.5] },
          { kind: 'parallel', text: '0,02 A', detail: 'Parallelität Oberseite zur Auflage', critical: false, pos: [175.6, 113.2] },
        ],
        routing: [
          { op: 'Sägen (Platten aus Lagerblock)', station: 'M01', setupMin: 10, cycleMin: 1.2, transferBatch: 24, firstPiece: false,
            tools: [{ type: 'TT-SB', cutMinPerPart: 0.9 }], reason: 'Lagerblock 160×120×80 in Scheiben 17 mm – 8 Platten je Block statt Neubestellung' },
          { op: 'Fräsen komplett (2 Aufspannungen)', station: 'M06', setupMin: 45, cycleMin: 14, transferBatch: 12, firstPiece: true,
            tools: [{ type: 'TT-PF63', cutMinPerPart: 3 }, { type: 'TT-VHM16', cutMinPerPart: 4.5 }, { type: 'TT-VHM10', cutMinPerPart: 2.5 }, { type: 'TT-DR85', cutMinPerPart: 0.8 }, { type: 'TT-GBM10', cutMinPerPart: 0.6 }, { type: 'TT-DR10', cutMinPerPart: 0.4 }],
            char: { name: 'Bohrung Ø 30 H7', nominal: 30.0105, tolMinus: -0.0105, tolPlus: 0.0105, unit: 'mm', sigma: 0.003, driftAt100: -0.006 },
            reason: 'Planfräsen beidseitig, Kontur R8, Ø30 H7 zirkular gefräst, Bohrbild und M10 – 3-Achs genügt' },
          { op: 'Entgraten + Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.4, transferBatch: 12, firstPiece: false, reason: 'Kühlschmierstoff und Späne vor dem Eloxieren entfernen' },
          { op: 'Eloxieren E6/EV1 natur', station: 'EXT', transferBatch: 24,
            ext: { partner: 'Eloxalwerk Simmering (Beispiel)', process: 'Eloxieren E6/EV1 natur 10–15 µm, Ø30 abgedeckt · 24-h-Service', leadMin: 1440 },
            reason: 'Fremdvergabe an Eloxierer, Ø30 H7 abgedeckt – 24-h-Service (Standard 3–5 Arbeitstage)' },
          { op: 'Endprüfung KMG', station: 'QS', setupMin: 0, cycleMin: 3, transferBatch: 12, firstPiece: false, reason: 'Ø30 H7, Rechtwinkligkeit, Ebenheit und Lochbild am KMG; Schichtdicke Stichprobe' },
        ],
        notes: ['Passung Ø30 H7 und Eloxal: die Schicht wächst ca. 5–7 µm je Seite – Bohrung abdecken oder mit Vorhalt fertigen.'],
        confidence: 0.88,
      },
    },
  ];
  const exById = (id) => EXAMPLES.find(e => e.id === id) || null;

  // ------------------------------------------------------------------ Merkmal-Arten (Symbole wie in der Zeichnung)
  const FEAT = {
    fit: 'Passung', tol: 'Maßtoleranz', surface: 'Oberfläche', thread: 'Gewinde', hardness: 'Härte', runout: 'Lauf',
    perp: 'Rechtwinkligkeit', flat: 'Ebenheit', parallel: 'Parallelität', position: 'Position', keyway: 'Nut',
    coating: 'Beschichtung', hole: 'Bohrung', geometry: 'Geometrie', note: 'Hinweis',
  };
  const FEAT_SVG = {
    fit: '<circle cx="8" cy="8" r="4.6"/><path d="M3.4 12.6 12.6 3.4"/>',
    tol: '<path d="M8 2.8v6.4M4.8 6h6.4M4.8 12.8h6.4"/>',
    surface: '<path d="M2.4 8.6 5 13 9.6 3.4h4"/>',
    thread: '<path d="M2.6 5.2 5.3 10.8 8 5.2l2.7 5.6 2.7-5.6"/>',
    hardness: '<path d="M8 2.4 12.6 8 8 13.6 3.4 8z"/><path d="M8 6.2v3.6"/>',
    runout: '<path d="M3.6 12.4 11.8 4.2M7.4 4h4.6v4.6"/>',
    perp: '<path d="M8 2.8v9.8M3 12.6h10"/>',
    flat: '<path d="M2.2 11.2h8.4l3.2-6.4H5.4z"/>',
    parallel: '<path d="M4.4 13.2 7.6 2.8M8.6 13.2l3.2-10.4"/>',
    position: '<circle cx="8" cy="8" r="3.4"/><path d="M8 1.8v12.4M1.8 8h12.4"/>',
    keyway: '<rect x="2.2" y="5.4" width="11.6" height="5.2" rx="2.6"/>',
    coating: '<rect x="2.4" y="2.8" width="11.2" height="5" rx="1"/><path d="M2.4 10.6h11.2M2.4 13.2h11.2"/>',
    hole: '<circle cx="8" cy="8" r="4.8"/><circle cx="8" cy="8" r="1.1"/>',
    geometry: '<path d="M3 13.2V6.6l3.6-3.6h6.4"/>',
    note: '<circle cx="8" cy="8" r="5.6"/><path d="M8 7.2v4.2M8 4.9v.1"/>',
  };
  const featIcon = (k) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FEAT_SVG[k] || FEAT_SVG.note}</svg>`;

  // ------------------------------------------------------------------ Fähigkeiten der Arbeitsplätze (Nachbau Engine-CAPS)
  const TYPE_GROUP = { lathe: 'turn', swiss: 'turn', biglathe: 'turn', mill5: 'mill', mill3: 'mill' };
  const CAPS = {
    swiss:    { barOnly: true, maxBarDia: 20, maxKg: 0.5, what: 'Langdrehautomat mit Stangenlader (Stangen bis Ø 20 mm)' },
    lathe:    { maxKg: 30, maxDia: 220, maxLen: 600, what: 'Dreh-Fräszentrum mit Portallader (bis Ø 220 × 600 mm, 30 kg)' },
    biglathe: { minKg: 10, what: 'Großdrehmaschine für Wellen (ab ca. 10 kg bis 5 t)' },
    mill5:    { maxKg: 300, what: '5-Achs-Bearbeitungszentrum (bis ca. 300 kg)' },
    mill3:    { maxKg: 1000, no5axis: true, what: '3-Achs-Bearbeitungszentrum' },
  };
  const numDe = (x) => Number(String(x).replace(',', '.'));
  function partDims(name) {
    const n = String(name || '');
    let m = /Ø\s*(\d+(?:[.,]\d+)?)(?:\s*[×x]\s*(\d+(?:[.,]\d+)?))?/.exec(n);
    if (m) return { dia: numDe(m[1]), len: m[2] ? numDe(m[2]) : null };
    m = /(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)(?:\s*[×x]\s*(\d+(?:[.,]\d+)?))?/.exec(n);
    if (m) return { dia: null, len: Math.max(numDe(m[1]), numDe(m[2]), m[3] ? numDe(m[3]) : 0) };
    return { dia: null, len: null };
  }
  const matOf = (id) => (id && S() && S().materials && S().materials[id]) || (id ? P().materials.find(m => m.id === id) : null) || null;
  function barDia(matId) { const mt = matOf(matId); const m = mt && /Ø\s*(\d+(?:[.,]\d+)?)/.exec(mt.name); return m ? numDe(m[1]) : null; }
  /** null = Arbeitsplatz kann den Schritt k bearbeiten, sonst Begründung */
  function capWhy(q, k, sid) {
    const sn = STN(sid); if (!sn) return 'Arbeitsplatz unbekannt';
    const cap = CAPS[sn.type] || {}, r = q.routing[k], kg = q.part.weightKg || 0;
    const d = partDims((q.part.dims || '') + ' ' + (q.part.name || ''));
    if (cap.barOnly) {
      const mt = k === 0 && q.raw.materialId ? matOf(q.raw.materialId) : null;
      if (!mt || mt.form !== 'Stange') return `${sid} ${sn.short}: nur direkt von der Stange (erster Arbeitsgang mit Stangenmaterial)`;
      const bd = barDia(mt.id); if (bd && bd > cap.maxBarDia) return `${sid} ${sn.short}: Stange Ø${nf(bd)} > Ø${cap.maxBarDia} mm`;
    }
    if (cap.maxKg && kg > cap.maxKg) return `${sid} ${sn.short}: Teilegewicht ${nf(kg, 1)} kg > ${nf(cap.maxKg)} kg`;
    if (cap.minKg && kg < cap.minKg) return `${sid} ${sn.short}: ${cap.what} – Teil mit ${nf(kg, kg < 1 ? 2 : 1)} kg zu klein`;
    if (cap.maxDia && d.dia && d.dia > cap.maxDia) return `${sid} ${sn.short}: Ø${nf(d.dia)} mm > Ø${cap.maxDia} mm`;
    if (cap.maxLen && d.len && d.len > cap.maxLen) return `${sid} ${sn.short}: Länge ${nf(d.len)} mm > ${cap.maxLen} mm`;
    if (cap.no5axis && /5-?Achs/i.test(r.op || '')) return `${sid} ${sn.short}: Schritt verlangt 5-Achs-Bearbeitung`;
    return null;
  }
  /** Alternativ-Arbeitsplätze gleicher Gruppe (Drehen/Fräsen) mit Zeitumrechnung */
  function altFor(q, k) {
    const r = q.routing[k], base = r.orig || r, sn = STN(base.station);
    if (!sn || !TYPE_GROUP[sn.type]) return [];
    const out = [];
    for (const id of P().machines) {
      const t = STN(id); if (!t || id === base.station || TYPE_GROUP[t.type] !== TYPE_GROUP[sn.type]) continue;
      if (capWhy(q, k, id)) continue;
      let sAdd = 0, c = 1;
      if (sn.type === 'mill5' && t.type === 'mill3') { sAdd = 15; c = 1.3; }
      else if (sn.type === 'mill3' && t.type === 'mill5') { sAdd = 15; c = 0.9; }
      else if (t.type !== sn.type) continue; // Drehen: nur gleiche Bauart sinnvoll (Stange/Portallader/Großdrehen)
      const cut = (base.tools || []).reduce((a, x) => a + x.cutMinPerPart, 0);
      out.push({ station: id, setupMin: Math.round(base.setupMin + sAdd), cycleMin: r2(Math.max(cut * 1.05, base.cycleMin * c)),
        note: t.type === 'mill3' ? '3-Achs: zusätzliche Aufspannung, Bediener legt ein' : t.type === 'mill5' ? '5-Achs mit Palettenwechsler: weniger Umspannen, läuft autonom' : '' });
    }
    return out;
  }

  // ------------------------------------------------------------------ Material: Bestand, Reservierungen, Bedarf
  /** Bedarf offener Aufträge an diesem Material (erster Arbeitsgang, noch nicht entnommen) */
  let ignoreOid = null;   // eingelasteter Auftrag dieses Angebots – zählt bei der eigenen Neuberechnung nicht als Fremdbelegung
  /** offener Materialbedarf eines Auftrags (erster Arbeitsgang, noch nicht entnommen) */
  function needOf(o, matId, mag) {
    const st = S(), r0 = o.routing[0];
    if (!r0 || !r0.material || r0.material.id !== matId || o.status === 'fertig') return 0;
    const left = WF.sim.partsLeft(o.id, r0.seq); if (!(left > 0)) return 0;
    const sn = STN(r0.station) || {};
    let amount = left * r0.material.perPart;
    if (sn.type === 'saw') { /* Säge entnimmt je Teil */ }
    else if (sn.barMagazineM) { const m = st.machines[r0.station]; if (m && m.barMat === matId && mag && !mag[m.id]) { amount -= m.barStockM || 0; mag[m.id] = 1; } }
    else {
      let issued = 0;
      for (const cid in st.containers) { const c = st.containers[cid]; if (c.orderId === o.id && c.idx === 0 && c.kind === 'raw' && (c.state === 'ready' || c.state === 'transit' || c.state === 'input')) issued += c.qty; }
      amount -= issued * r0.material.perPart;
    }
    return Math.max(0, amount);
  }
  function reservedOf(matId) {
    const st = S(), list = []; let total = 0; const mag = {};
    for (const id in st.orders) {
      if (id === ignoreOid) continue;
      const amount = needOf(st.orders[id], matId, mag);
      if (amount > 1e-6) { total += amount; list.push({ id, amount }); }
    }
    return { total, list };
  }
  /** Material für diesen Auftrag: Bestand minus Bedarf der Aufträge, die laut Plantafel VOR ihm beginnen (s0 = geplanter Start) */
  function matInfo(q, qty, s0, fc) {
    const id = q.raw && q.raw.materialId; const mt = matOf(id);
    if (!mt) return { none: true, ok: true };
    const st = S(), now = st.t, perPart = q.raw.perPart || 0;
    // bereits eingelastet: nur noch der offene Rest dieses Auftrags (Entnahmen sind schon im Bestand verbucht)
    const need = ignoreOid && st.orders[ignoreOid] ? needOf(st.orders[ignoreOid], id, {}) : qty * perPart;
    const res = reservedOf(id);
    const startOf = (oid) => {
      const o = st.orders[oid], f = fc && fc.orders[oid]; if (!o || !f || !f.ops) return -Infinity;
      const r0 = o.routing[0], rec = f.ops.find(x => x && x.seq === r0.seq);
      return rec ? rec.start : -Infinity;
    };
    const before = res.list.filter(x => s0 == null || startOf(x.id) <= s0 + 60), after = res.list.filter(x => !before.includes(x));
    const resBefore = before.reduce((a, x) => a + x.amount, 0);
    const free = mt.onHand - resBefore;
    const open = (st.purchases || []).filter(p => p.materialId === id && p.status === 'bestellt').sort((a, b) => a.etaT - b.etaT);
    let readyT = null, needsOrder = false, viaOrder = null;
    // Bestellungen, die vor dem geplanten Start eintreffen, zählen als verfügbar
    const early = open.filter(p => s0 != null && p.etaT <= s0);
    const freeAtStart = free + early.reduce((a, p) => a + p.qty, 0);
    const ok = freeAtStart + 1e-9 >= need;
    if (ok && free + 1e-9 < need) viaOrder = early[early.length - 1] || null;
    if (!ok) {
      let cover = Math.max(0, free);
      for (const p of open) { cover += p.qty; if (cover + 1e-9 >= need) { readyT = p.etaT; break; } }
      if (readyT == null) { needsOrder = true; readyT = now + mt.leadMin * 60; }
    }
    const afterQ = mt.onHand + (mt.onOrder || 0) - res.total - need;
    const laterShort = ok && afterQ < -1e-6 && after.length > 0;
    const dec = mt.unit === 'm' ? 1 : 0;
    const suggest = Math.max(mt.reorderQty, Math.ceil(Math.max(0, mt.min - afterQ)));
    const shortParts = ok ? 0 : Math.ceil((need - Math.max(0, free)) / Math.max(1e-9, perPart));
    return { id, mt, perPart, need, res, before, resBefore, free, freeAtStart, viaOrder, open, early, s0, ok, readyT, needsOrder, after: afterQ, laterList: after, laterShort, belowMin: afterQ < mt.min, suggest, dec, shortParts };
  }
  const qtyU = (v, mt) => nf(v, mt && mt.unit === 'm' ? (v < 1 ? (Math.round(v * 1000) % 10 ? 3 : 2) : v < 10 ? 2 : 1) : (Math.round(v * 1000) % 1000 ? (Math.round(v * 1000) % 10 ? 3 : 2) : 0)) + ' ' + (mt ? mt.unit : '');

  // ------------------------------------------------------------------ Terminrechnung (Nachbau der Engine-Prognose, §4)
  function stepWork(sn, r, qty) {
    const setup = (r.setupMin || 0) * 60;
    const fpi = r.firstPiece ? ((sn.fpiMin || 15) * 60 + 900) : 0;
    const load = sn.loading === 'perPart' ? Math.round(((r.loadMin != null ? r.loadMin : sn.loadMin) || 1) * 60) : 0;
    const cyc = (r.cycleMin || 1) * 60 + load;
    let allow = 0;
    for (const t of r.tools || []) { const tt = TTY(t.type); if (tt) allow += (t.cutMinPerPart / tt.lifeMin) * 300; }
    return { setup, fpi, load, cyc, run: qty * (cyc + allow) * 1.03 };
  }
  function calEnd(sn, start, w) {
    const tS = addWork(start, w.setup + w.fpi);
    if (sn.loading === 'auto') return Math.max(tS + w.run * 1.1, addWork(tS, w.run * 0.75));
    return addWork(tS, w.run);
  }
  /** frühester Beginn auf der Maschine – wie die Listenplanung der Engine: wer früher beginnen kann, ist zuerst dran;
      bei gleichem Beginn (±1 s) entscheidet Eil → Termin → Auftragsnummer. Spätere Einträge werden verschoben. */
  function fitMachine(fc, mid, earliest, prio, myDue, impacts) {
    // bereits verschobene Aufträge kommen an ihren Folge-Arbeitsgängen entsprechend später an (Kaskade)
    const list = (fc.machines[mid] || []).filter(e => e.orderId !== ignoreOid).map(e => {
      const im = impacts && impacts[e.orderId], d = im && e.seq > im.seq && !e.active ? im.delay : 0;
      return d ? Object.assign({}, e, { start: e.start + d, end: e.end + d }) : e;
    }).sort((a, b) => a.start - b.start);
    const myKey = [prio === 'eil' ? 0 : 1, myDue, 'FA-~'];
    const keyOf = (oid) => { const o = S().orders[oid]; return [o && o.priority === 'eil' ? 0 : 1, o ? o.due : 0, oid]; };
    const before = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; } return false; };
    let s = earliest; const blockers = [], pushed = [];
    for (const e of list) {
      if (e.end <= s) continue;
      const blocks = e.active || e.start < s - 1 || (Math.abs(e.start - s) <= 1 && before(keyOf(e.orderId), myKey));
      if (blocks) { blockers.push(e); s = Math.max(s, e.end); } else pushed.push(e);
    }
    return { start: s, blockers, pushed };
  }
  function schedule(q, qty, prio, opt = {}) {
    const now = S().t;
    const fc = WF.sim.forecast(120);
    const wd = dueT();
    const out = { now, steps: [], impacts: {}, mat: null, prio, myDue: opt.due != null ? opt.due : wd && wd > now ? wd : addWork(now, 3 * 16 * 3600) };
    let mat = { none: true, ok: true };
    let prevEnd = now, prevFirst = now, prevBatch = 1, prevCyc = 0;
    q.routing.forEach((r, k) => {
      if (r.station === 'EXT') {
        const ext = r.ext || {}, lead = (ext.leadMin || 480) * 60;
        const B = Math.min(qty, Math.max(1, Math.round(r.transferBatch || qty))), lot = Math.min(B, qty);
        const pb = Math.max(1, prevBatch), pc = prevCyc;
        const delivT = (n) => n <= 0 ? now : Math.min(Math.max(prevFirst, prevEnd + 600), prevFirst + Math.max(0, Math.ceil(n / pb) - 1) * pb * pc);
        const H = EXT_HANDOVER();
        const shipNext = delivT(lot) + H, shipLast = qty > lot ? Math.max(shipNext, prevEnd + 600 + H) : shipNext;
        const retOf = (sh) => nextDayWindow(nextDayWindow(Math.max(now, sh)) + lead);
        const firstRet = retOf(shipNext), lastRet = retOf(shipLast), end = Math.max(lastRet, now);
        const succ = Math.min(firstRet, end);
        out.steps.push({ k, kind: 'ext', station: 'EXT', ready: delivT(lot), start: shipNext, pickup: nextDayWindow(Math.max(now, shipNext)), firstRet, lastRet, end, lot, lots: Math.ceil(qty / lot), lead, partner: ext.partner, process: ext.process, first: succ + 900 });
        prevEnd = end; prevFirst = succ + 900; prevBatch = 1; prevCyc = 0;
        return;
      }
      const sn = STN(r.station); if (!sn) return;
      const w = stepWork(sn, r, qty);
      const bq = Math.min(qty, Math.max(1, Math.round(r.transferBatch || Math.min(qty, 20))));
      const avail = k === 0 ? now : prevFirst;
      let tail = k === 0 ? 0 : prevEnd + Math.min(bq, qty) * w.cyc + 600;
      const earliest = Math.max(now, avail - w.setup);
      const fit = fitMachine(fc, r.station, earliest, prio, out.myDue, out.impacts);
      const start = fit.start;
      // Material (erster Arbeitsgang): Verbrauch in Plan-Reihenfolge; fehlt etwas, kann der Rest erst nach dem Wareneingang laufen
      let matTail = 0;
      if (k === 0) {
        mat = matInfo(q, qty, start, fc);
        if (!mat.ok && mat.readyT) {
          const restT = mat.shortParts * w.cyc * 1.03;
          matTail = (sn.loading === 'auto' ? mat.readyT + restT : addWork(mat.readyT, restT)) + 300;
          tail = Math.max(tail, matTail);
        }
      }
      const occ = Math.max(calEnd(sn, start, w), calEnd(sn, Math.max(start, avail), { setup: 0, fpi: w.fpi, run: w.run }));
      const end = Math.max(occ, tail);
      const setupEnd = addWork(start, w.setup), fpiEnd = addWork(start, w.setup + w.fpi);
      const runStart = Math.max(fpiEnd, avail);
      const need = Math.min(bq, qty);
      let first = (sn.loading === 'auto' ? runStart + need * w.cyc : addWork(runStart, need * w.cyc)) + 600;
      if (matTail && mat.free / Math.max(1e-9, mat.perPart) < need) first = Math.max(first, mat.readyT + (need - Math.max(0, Math.floor(mat.free / mat.perPart))) * w.cyc + 600);
      first = Math.min(first, end + 600);
      const releasable = k > 0 && !(r.setupMin > 10) && !r.firstPiece;
      const busyEnd = releasable ? occ : end;
      // verschobene Einträge (Kaskade auf derselben Maschine)
      let shift = busyEnd;
      for (const e of fit.pushed) {
        const ns = Math.max(e.start, shift), d = ns - e.start;
        if (d <= 60) { if (e.start >= shift) break; continue; }
        const cur = out.impacts[e.orderId];
        if (!cur || cur.delay < d) out.impacts[e.orderId] = { orderId: e.orderId, delay: d, seq: e.seq, station: r.station, op: e.op };
        shift = e.end + d;
      }
      out.steps.push({ k, kind: 'machine', station: r.station, start, setupEnd, fpiEnd, runStart, end, busyEnd, first, avail, earliest,
        wait: Math.max(0, start - earliest), blockers: fit.blockers, w, bq, auto: sn.loading === 'auto', matTail });
      prevEnd = end; prevFirst = first; prevBatch = bq; prevCyc = w.cyc;
    });
    const ship = Math.max(now, prevEnd) + 600;
    out.mat = mat;
    out.steps.push({ kind: 'ship', station: 'VERSAND', start: ship, end: ship });
    out.eta = ship;
    out.pickup = nextDayWindow(ship);
    out.lead = ship - now;
    return out;
  }
  /** Zusage-Vorschlag: frühester Termin + Sicherheit (10 % Durchlauf, mind. 2 h Arbeitszeit), auf volle Stunde, im Lieferfenster */
  function zusageOf(sch) {
    const buf = Math.max(2 * 3600, 0.1 * (sch.eta - sch.now));
    let t = addWork(sch.eta, buf);
    t = Math.ceil(t / 3600) * 3600;
    return nextDayWindow(t);
  }

  // ------------------------------------------------------------------ Kalkulation (Zuschlagskalkulation)
  const MGK = 0.10, EIL = 0.15, ZUS_OPTS = [0.12, 0.15, 0.18, 0.22, 0.25];
  const EXT_RATE = [
    { re: /induktion/i, perKg: 1.4, perPc: 0.9, min: 120, label: 'Induktionshärten' },
    { re: /einsatz/i, perKg: 1.8, perPc: 0.5, min: 150, label: 'Einsatzhärten' },
    { re: /vakuum/i, perKg: 2.2, perPc: 0.6, min: 150, label: 'Vakuumhärten' },
    { re: /elox/i, perKg: 4.0, perPc: 1.1, min: 90, label: 'Eloxieren' },
    { re: /nitrier/i, perKg: 2.0, perPc: 0.6, min: 140, label: 'Nitrieren' },
    { re: /passivier|beiz/i, perKg: 3.0, perPc: 0.4, min: 110, label: 'Passivieren' },
    { re: /verzink|galvan|beschicht|brünier|vernickel|chrom|lackier/i, perKg: 2.4, perPc: 0.6, min: 90, label: 'Beschichten' },
    { re: /./, perKg: 2.0, perPc: 1.0, min: 100, label: 'Fremdbearbeitung' },
  ];
  function extCost(r, qty, kg) {
    const txt = ((r.ext && r.ext.process) || '') + ' ' + (r.op || '');
    const rt = EXT_RATE.find(x => x.re.test(txt));
    const v = qty * (kg * rt.perKg + rt.perPc);
    return { cost: Math.max(rt.min, v), raw: v, rt, minApplied: v < rt.min };
  }
  function toolUse(r, qty) {
    return (r.tools || []).map(t => {
      const tt = TTY(t.type); if (!tt) return null;
      const perEdge = Math.max(1, Math.floor(tt.lifeMin / t.cutMinPerPart));
      const changes = Math.max(0, Math.ceil(qty / perEdge) - 1);
      return { type: t.type, tt, cut: t.cutMinPerPart, perEdge, changes, costPerPart: t.cutMinPerPart / tt.lifeMin * tt.cost };
    }).filter(Boolean);
  }
  function price(q, qty, prio, zus) {
    const kg = q.part.weightKg || 1;
    const mt = matOf(q.raw.materialId);
    let mat = 0, matLine = null;
    if (mt) { mat = qty * q.raw.perPart * mt.pricePerUnit; matLine = { qty, perPart: q.raw.perPart, unit: mt.unit, price: mt.pricePerUnit, name: mt.name }; }
    else if (q.raw.costPerPart > 0) { mat = qty * q.raw.costPerPart; matLine = { est: true, qty, costPerPart: q.raw.costPerPart }; }
    const mgk = mat * MGK;
    const mach = [], tools = [], ext = [];
    let machSum = 0, toolPer = 0, extSum = 0;
    for (const r of q.routing) {
      if (r.station === 'EXT') { const e = extCost(r, qty, kg); ext.push(Object.assign({ r }, e)); extSum += e.cost; continue; }
      const sn = STN(r.station); if (!sn) continue;
      const load = sn.loading === 'perPart' ? ((r.loadMin != null ? r.loadMin : sn.loadMin) || 1) : 0;
      const min = (r.setupMin || 0) + qty * ((r.cycleMin || 0) + load);
      const cost = min / 60 * sn.rate;
      machSum += cost; mach.push({ r, sn, load, min, cost });
      for (const u of toolUse(r, qty)) { toolPer += u.costPerPart; tools.push(Object.assign({ station: r.station }, u)); }
    }
    const toolSum = toolPer * qty;
    const hk = mat + mgk + machSum + toolSum + extSum;
    const z = hk * zus, e = prio === 'eil' ? (hk + z) * EIL : 0;
    const unit = Math.ceil((hk + z + e) / qty * 100) / 100;
    return { mat, matLine, mgk, mach, machSum, tools, toolPer, toolSum, ext, extSum, hk, z, e, unit, total: r2(unit * qty), zus, prio, qty };
  }
  function niceQty(n) {
    if (n <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(n))), m = n / p;
    const s = m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10;
    return Math.max(1, Math.round(s * p));
  }
  function staffel(q, qty, prio, zus) {
    const set = new Set([niceQty(qty / 4), niceQty(qty / 2), qty, niceQty(qty * 2), niceQty(qty * 5)].filter(n => n >= 1 && n <= 100000));
    return [...set].sort((a, b) => a - b).map(n => ({ n, unit: price(q, n, prio, zus).unit, cur: n === qty }));
  }

  // ------------------------------------------------------------------ Claude: Prompt, Bild, Prüfung/Reparatur
  const TYPE2ST = { saw: 'M01', lathe: 'M02', swiss: 'M03', biglathe: 'M04', mill5: 'M05', mill3: 'M06', deephole: 'M07', hobber: 'M08', cylgrinder: 'M09', surfgrinder: 'M10', washer: 'M11', cmm: 'QS', assembly: 'M13' };
  const KEYMAP = [
    [/härt|nitrier|vergüt|elox|beschicht|galvan|verzink|brünier|lackier|strahl|glüh|vernickel|chrom/i, 'EXT'],
    [/säg|zuschn|trenn/i, 'M01'], [/lang ?dreh|swiss|citizen/i, 'M03'], [/groß ?dreh|wfl/i, 'M04'],
    [/tiefloch|bta|einlippen/i, 'M07'], [/wälz|verzahn|hobb/i, 'M08'], [/rundschl|innenschl|außenschl/i, 'M09'],
    [/flachschl|planschl|okamoto/i, 'M10'], [/wasch|reinig|entfett/i, 'M11'], [/prüf|mess|kmg|kontroll|qs\b/i, 'QS'],
    [/montage|montier/i, 'M13'], [/5[- ]?achs|dmu/i, 'M05'], [/fräs|bohr|gewinde|haas/i, 'M06'], [/dreh|index/i, 'M02'],
  ];
  const DEFAULT_TOOL = { saw: 'TT-SB', lathe: 'TT-CNMG', swiss: 'TT-MIKRO', biglathe: 'TT-CNMGL', mill5: 'TT-VHM10', mill3: 'TT-VHM16', deephole: 'TT-ELB20', hobber: 'TT-WF2', cylgrinder: 'TT-SSR', surfgrinder: 'TT-SSF' };
  const VALID_ST = () => { const v = { EXT: 1 }; for (const id of P().machines) v[id] = 1; return v; };
  function mapStation(raw, op) {
    let s = String(raw || '').trim();
    const mm = /^m\s*0?(\d{1,2})\b/i.exec(s); if (mm) { const id = 'M' + String(mm[1]).padStart(2, '0'); if (VALID_ST()[id]) return id; }
    if (/^(qs|messraum)$/i.test(s)) return 'QS';
    if (/^(ext|extern)/i.test(s)) return 'EXT';
    if (TYPE2ST[s.toLowerCase()]) return TYPE2ST[s.toLowerCase()];
    for (const [re, id] of KEYMAP) if (re.test(s) || re.test(op || '')) return id;
    return null;
  }
  const str = (v, n) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, n || 80);
  const num = (v) => { const x = typeof v === 'string' ? numDe(v) : Number(v); return isFinite(x) ? x : NaN; };
  function extDefaults(process, op) {
    const t = (process || '') + ' ' + (op || '');
    if (/elox/i.test(t)) return { partner: 'Eloxalwerk Simmering (Beispiel)', leadMin: 1440 };
    if (/beschicht|verzink|galvan|vernickel|chrom|brünier|lackier|passivier|beiz/i.test(t)) return { partner: 'Oberflächentechnik Wien (Beispiel)', leadMin: 1440 };
    if (/induktion/i.test(t)) return { partner: HAERTEREI, leadMin: 360 };
    if (/vakuum/i.test(t)) return { partner: HAERTEREI, leadMin: 420 };
    return { partner: HAERTEREI, leadMin: 480 };
  }
  /** Antwort von Claude (oder vorberechnet) prüfen und reparieren → Angebotsmodell */
  function validate(raw, ctx = {}) {
    const rep = [];
    const o = raw && typeof raw === 'object' ? raw : {};
    const p = o.part && typeof o.part === 'object' ? o.part : {};
    const qty = Math.max(1, Math.round(ctx.qty || 1));
    const part = {
      name: str(p.name, 60) || 'Teil laut Zeichnung',
      no: str(p.no, 24) || str(p.drawingNo, 24).replace(/-\d{2}$/, '') || '',
      drawing: str(p.drawing || [p.drawingNo, p.revision ? 'Rev. ' + p.revision : ''].filter(Boolean).join(' '), 40) || '–',
      material: str(p.material, 50) || '–',
      weightKg: clamp(num(p.weightKg) > 0 ? num(p.weightKg) : 1, 0.001, 5000),
      dims: str(p.dims, 40),
      customer: str(p.customer, 60),
    };
    if (!(num(p.weightKg) > 0)) rep.push('Teilegewicht nicht erkannt – 1 kg angenommen');
    const rw = o.raw && typeof o.raw === 'object' ? o.raw : {};
    let materialId = rw.materialId ? String(rw.materialId).trim().toUpperCase() : null;
    if (materialId && !matOf(materialId)) { rep.push(`Material „${rw.materialId}“ nicht im Lager – Rohteil wird beigestellt bzw. separat beschafft`); materialId = null; }
    const mtx = matOf(materialId);
    let perPart = num(rw.perPart);
    if (mtx) {
      const lim = mtx.unit === 'm' ? 3 : 1;
      if (!(perPart > 0)) { perPart = mtx.unit === 'm' ? 0.1 : 1; rep.push('Materialbedarf je Teil geschätzt'); }
      if (perPart > lim) { rep.push(`Materialbedarf ${nf(perPart, 2)} ${mtx.unit} je Teil unplausibel – auf ${lim} ${mtx.unit} begrenzt`); perPart = lim; }
    }
    const rawM = { materialId, text: str(rw.text, 90) || (mtx ? mtx.name : 'Rohteil laut Zeichnung'), perPart: mtx ? r2(perPart * 1000) / 1000 : 0, unit: mtx ? mtx.unit : '', costPerPart: num(rw.costPerPart) > 0 ? clamp(num(rw.costPerPart), 0.01, 5000) : null };
    // Arbeitsplan
    const VALID = VALID_ST();
    const steps = [];
    for (const r0 of Array.isArray(o.routing) ? o.routing : []) {
      if (!r0 || typeof r0 !== 'object') continue;
      const op = str(r0.op, 60) || 'Arbeitsgang';
      let sid = String(r0.station || '').trim().toUpperCase();
      if (sid === 'VERSAND') continue;
      if (!VALID[sid]) {
        const m = mapStation(r0.station, op);
        if (!m) { rep.push(`„${op}“: Arbeitsplatz „${str(r0.station, 20)}“ unbekannt – Schritt entfernt`); continue; }
        rep.push(`„${op}“: Arbeitsplatz „${str(r0.station, 20) || '–'}“ → ${m}${STN(m) ? ' ' + STN(m).short : ''}`);
        sid = m;
      }
      const tb = Math.round(num(r0.transferBatch));
      const transferBatch = clamp(tb > 0 ? tb : Math.min(qty, 20), 1, 10000);
      if (sid === 'EXT') {
        const e0 = r0.ext && typeof r0.ext === 'object' ? r0.ext : {};
        const process = str(e0.process, 70) || op;
        const d = extDefaults(process, op);
        let lead = Math.round(num(e0.leadMin));
        if (!(lead > 0)) lead = d.leadMin;
        if (lead < 120 || lead > 4320) { rep.push(`Durchlaufzeit „${process}“ ${nf(lead)} min unplausibel – ${nf(d.leadMin)} min angenommen`); lead = d.leadMin; }
        steps.push({ op, station: 'EXT', transferBatch, ext: { partner: str(e0.partner, 50) || d.partner, process, leadMin: lead }, reason: str(r0.reason, 160) });
        continue;
      }
      const sn = STN(sid);
      const light = sn.kind === 'qs' || sn.type === 'washer' || sn.kind === 'assembly';
      let setup = num(r0.setupMin), cyc = num(r0.cycleMin);
      const sMax = light ? 30 : 240, sMin = light ? 0 : 5;
      if (!(setup >= 0)) { setup = light ? 0 : 30; rep.push(`${sid} „${op}“: Rüstzeit fehlte – ${nf(setup)} min angenommen`); }
      if (setup < sMin || setup > sMax) { const v = clamp(setup, sMin, sMax); rep.push(`${sid} „${op}“: Rüstzeit ${nf(setup)} → ${nf(v)} min`); setup = v; }
      if (!(cyc > 0)) { cyc = light ? 1 : 5; rep.push(`${sid} „${op}“: Stückzeit fehlte – ${nf(cyc)} min angenommen`); }
      if (cyc < 0.02 || cyc > 600) { const v = clamp(cyc, 0.02, 600); rep.push(`${sid} „${op}“: Stückzeit ${nf(cyc, 2)} → ${nf(v, 2)} min`); cyc = v; }
      const tools = [], seen = {};
      for (const t of Array.isArray(r0.tools) ? r0.tools : []) {
        const tid = String((t && (t.type || t.id)) || '').trim().toUpperCase();
        const tt = TTY(tid);
        if (!tt) { if (tid) rep.push(`${sid}: Werkzeug „${str(t.type || t.id, 24)}“ nicht im Werkzeugbestand – entfernt (Sonderwerkzeug prüfen)`); continue; }
        if (seen[tid]) continue; seen[tid] = 1;
        let cut = num(t.cutMinPerPart);
        if (!(cut > 0)) cut = cyc * 0.3;
        cut = clamp(cut, 0.01, Math.min(cyc, tt.lifeMin));
        tools.push({ type: tid, cutMinPerPart: r2(cut * 100) / 100 });
      }
      const sumCut = tools.reduce((a, t) => a + t.cutMinPerPart, 0);
      if (sumCut > cyc + 1e-9) { const f = cyc / sumCut * 0.95; tools.forEach(t => { t.cutMinPerPart = Math.max(0.01, r2(t.cutMinPerPart * f * 100) / 100); }); rep.push(`${sid}: Schnittzeiten > Stückzeit – anteilig gekürzt`); }
      if (!tools.length && sn.kind === 'machine' && DEFAULT_TOOL[sn.type]) {
        tools.push({ type: DEFAULT_TOOL[sn.type], cutMinPerPart: r2(Math.min(cyc * 0.6, TTY(DEFAULT_TOOL[sn.type]).lifeMin) * 100) / 100 });
        rep.push(`${sid}: kein gültiges Werkzeug – ${TTY(DEFAULT_TOOL[sn.type]).name} angenommen`);
      }
      const fp = r0.firstPiece != null ? !!r0.firstPiece : (sn.kind === 'machine' && sn.type !== 'saw' && sn.type !== 'washer');
      let ch = null;
      if (r0.char && typeof r0.char === 'object' && isFinite(num(r0.char.nominal)) && num(r0.char.tolPlus) > num(r0.char.tolMinus)) {
        const tm = num(r0.char.tolMinus), tp = num(r0.char.tolPlus), span = tp - tm;
        const sg = num(r0.char.sigma), dr = num(r0.char.driftAt100);
        ch = { name: str(r0.char.name, 30) || 'Hauptmerkmal', nominal: num(r0.char.nominal), tolMinus: tm, tolPlus: tp, unit: str(r0.char.unit, 6) || 'mm',
          sigma: sg > 0 && sg < span ? sg : Math.round(span / 10 * 1e5) / 1e5, driftAt100: isFinite(dr) && Math.abs(dr) < span ? dr : Math.round(span * 0.35 * 1e5) / 1e5 };
      }
      steps.push({ op, station: sid, setupMin: Math.round(setup), cycleMin: r2(cyc * 100) / 100, tools, firstPiece: fp, transferBatch, char: ch || null, reason: str(r0.reason, 180) });
    }
    if (!steps.some(s => s.station !== 'EXT')) throw { code: 'no_routing', message: 'Kein gültiger Bearbeitungsschritt erkannt' };
    const q = { part, raw: rawM, routing: steps };
    // Fähigkeiten (Langdreher nur von der Stange, Gewicht/Ø/Länge, 5-Achs)
    steps.forEach((r, k) => {
      if (r.station === 'EXT') return;
      const why = capWhy(q, k, r.station); if (!why) return;
      const sn = STN(r.station), grp = TYPE_GROUP[sn.type];
      const cand = grp ? P().machines.filter(id => STN(id) && TYPE_GROUP[STN(id).type] === grp && !capWhy(q, k, id)) : [];
      if (cand.length) { rep.push(`${why} → ${cand[0]} ${STN(cand[0]).short}`); r.station = cand[0]; }
      else rep.push(why);
    });
    { const bd = mtx && mtx.form === 'Stange' ? barDia(mtx.id) : null, pd = partDims((part.dims || '') + ' ' + part.name).dia;
      if (bd && pd && pd > bd) rep.push(`Rohteil prüfen: Stange Ø${nf(bd)} ist kleiner als das Teil (Ø${nf(pd)}) – passendes Stangenmaterial bestellen`); }
    if (rawM.materialId && steps[0] && steps[0].station === 'EXT') { rep.push('Erster Schritt Fremdbearbeitung: Teile werden beigestellt – Lagermaterial entfällt'); rawM.materialId = null; rawM.perPart = 0; }
    if (!steps.some(s => s.station === 'QS')) {
      const crit = (Array.isArray(o.features) ? o.features : []).filter(f => f && f.critical).length;
      steps.push({ op: 'Endprüfung', station: 'QS', setupMin: 0, cycleMin: clamp(0.5 + crit * 0.4, 0.3, 8), tools: [], firstPiece: false, transferBatch: Math.min(qty, 20), char: null, reason: 'Prüfung der kritischen Merkmale (ergänzt)' });
      rep.push('Endprüfung im Messraum ergänzt');
    }
    // Merkmale
    const feats = [];
    for (const f of Array.isArray(o.features) ? o.features.slice(0, 12) : []) {
      if (!f || typeof f !== 'object') continue;
      const text = str(f.text, 40); if (!text) continue;
      let pos = null;
      if (Array.isArray(f.pos) && f.pos.length === 2) { const x = num(f.pos[0]), y = num(f.pos[1]); if (x >= 0 && x <= 1 && y >= 0 && y <= 1) pos = [x, y]; }
      feats.push({ kind: FEAT[f.kind] ? f.kind : 'note', text, detail: str(f.detail, 90), critical: !!f.critical, pos });
    }
    feats.sort((a, b) => (b.critical - a.critical));
    const notes = (Array.isArray(o.notes) ? o.notes : []).map(x => str(x, 220)).filter(Boolean).slice(0, 4);
    const conf = num(o.confidence);
    return Object.assign(q, { features: feats, notes, repairs: rep, confidence: conf >= 0 && conf <= 1 ? conf : null });
  }

  function promptFor(src, qty, withImage) {
    const st = S();
    const lines = [];
    for (const id of P().machines) {
      const s = STN(id), cap = CAPS[s.type];
      const lim = cap ? cap.what : s.type === 'cmm' ? 'Messraum mit 3D-KMG (Prüfung)' : s.type === 'washer' ? 'Kammerreinigung (Waschen)' : s.type === 'assembly' ? 'Handmontage' : s.type === 'saw' ? 'Zuschnitt Stangen/Blöcke bis 320 mm' : s.type === 'deephole' ? 'BTA/ELB-Tiefbohren bis 3.200 mm' : s.type === 'hobber' ? 'Wälzfräsen Stirnräder' : s.type === 'cylgrinder' ? 'Außen-/Innenrundschleifen' : s.type === 'surfgrinder' ? 'Flachschleifen' : '';
      lines.push(`${id} | ${s.type} | ${s.name} (${s.vendor} ${s.model}) | ${lim} | ${s.rate} €/h`);
    }
    lines.push('EXT | extern | Fremdbearbeitung – Härterei Wolf (Rahmenvertrag mit täglicher Abholung, Tagesdurchlauf): Induktions-, Einsatz-, Vakuumhärten 360–480 min beim Partner; Eloxal/Beschichten (24-h-Service) ca. 1440 min; ohne Rahmenvertrag üblich 2–5 Arbeitstage | ext.partner, ext.process, ext.leadMin angeben | –');
    const tools = P().toolTypes.map(t => `${t.id} | ${t.name} | ${t.kind} | Standzeit ${t.lifeMin} min`).join('\n');
    const mats = Object.values(st.materials).map(m => `${m.id} | ${m.name} | ${m.form} | ${m.unit} | ${nf(m.pricePerUnit, 2)} €/${m.unit} | Bestand ${nf(m.onHand, m.unit === 'm' ? 1 : 0)} ${m.unit}`).join('\n');
    const ex = src.kind === 'example' ? exById(src.id) : null;
    return `Du bist erfahrene Arbeitsvorbereitung (AV) in einem österreichischen Lohnfertigungsbetrieb für Zerspanung und erstellst aus einer technischen Zeichnung einen Arbeitsplan mit Vorgabezeiten.
Betrieb: ${(WF.app && WF.app.company ? WF.app.company().name : P().company.name)}. Zwei Schichten Mo–Fr (06:00–14:00, 14:00–22:00). Anfrage: ${qty} Stück.
${withImage ? 'Die Zeichnung ist als Bild beigefügt.' : 'Zeichnungsinhalt (Textauszug):\n' + (ex ? ex.desc : '')}

AUFGABE
1. Zeichnung lesen: Benennung, Zeichnungsnummer, Revision, Werkstoff, Abmessungen, Masse, Passungen/Toleranzen, Oberflächen, Form- und Lagetoleranzen, Wärmebehandlung, Beschichtung, Hinweise.
2. Rohteil festlegen – bevorzugt Lagermaterial aus der Liste, Bedarf je Teil inkl. Aufmaß, Schnittfuge bzw. Abstich (Einheit des Materials).
3. Arbeitsplan NUR mit den Arbeitsplätzen und Werkzeugtypen unten. setupMin = Rüstzeit je Los, cycleMin = Bearbeitungszeit je Teil ohne Einlegen, tools[].cutMinPerPart = Schnittzeit je Teil (Summe ≤ cycleMin).
   Regeln: Stangen über Ø20 und Blöcke zuerst sägen (M01, Material dort angeben). M03 nur direkt von der Stange bis Ø20. Wärmebehandlung/Beschichtung als Station "EXT" mit ext. Schleifen nach dem Härten. Zum Schluss Prüfung im Messraum (QS). VERSAND nicht angeben.
4. Kritische Merkmale auflisten (Passungen, enge Toleranzen, Ra ≤ 0,8, Härte, Form/Lage, Beschichtung).

ARBEITSPLÄTZE (id | Typ | Bezeichnung | Grenzen | Stundensatz)
${lines.join('\n')}

WERKZEUGTYPEN (id | Bezeichnung | Art | Standzeit)
${tools}

LAGERMATERIAL (id | Bezeichnung | Form | Einheit | Preis | Bestand)
${mats}

ANTWORT: ausschließlich EIN JSON-Objekt (kein Markdown, kein Text davor/danach) mit genau dieser Struktur:
{"part":{"name":"…","drawingNo":"…","revision":"…","material":"…","weightKg":0.0,"dims":"…","customer":"…"},
 "raw":{"materialId":"MAT-… oder null","text":"Rohteil kurz","perPart":0.0,"unit":"m|Stk","costPerPart":null},
 "features":[{"kind":"fit","text":"Ø… H7","detail":"…","critical":true,"pos":[0.5,0.4]}],
 "routing":[{"op":"…","station":"M0…","setupMin":0,"cycleMin":0.0,"tools":[{"type":"TT-…","cutMinPerPart":0.0}],"firstPiece":true,"transferBatch":0,"reason":"warum diese Maschine","char":{"name":"…","nominal":0.0,"tolMinus":0.0,"tolPlus":0.0,"unit":"mm"}},
            {"op":"…","station":"EXT","ext":{"partner":"…","process":"…","leadMin":0},"transferBatch":0,"reason":"…"}],
 "confidence":0.0,
 "notes":["…"]}
kind ∈ fit, tol, surface, thread, hardness, runout, perp, flat, parallel, position, keyway, coating, hole, geometry, note.
pos = ungefähre Lage des Merkmals im Bild (x, y je 0–1, links oben 0,0) oder null. char = Hauptmerkmal des Schritts (optional, sonst null).
costPerPart nur wenn kein Lagermaterial passt (geschätzte Rohteilkosten in €). Unleserliches plausibel schätzen und in notes nennen. Keine Arbeitsplätze, Werkzeuge oder Materialien erfinden.`;
  }
  function svgToPng(svg, w) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * 210 / 297);
          const g = c.getContext('2d'); g.fillStyle = C.paper; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Zeichnung konnte nicht gerendert werden'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  /** große Fotos verkleinern (≤ 2400 px, JPEG) – die Plattform verkleinert ohnehin auf ca. 1,2 MP */
  function shrinkImage(file, maxBytes) {
    return new Promise((resolve) => {
      if (file.size <= Math.min(maxBytes || 4e6, 4e6)) return resolve(file);
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b || file), 'image/jpeg', 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  const AI_MSG = {
    not_granted: 'Claude wurde für diese Seite nicht freigegeben.',
    sampling_disabled: 'Claude ist für dieses Konto nicht verfügbar.',
    not_declared: 'Diese Seite darf Claude nicht verwenden.',
    capability_disabled: 'Claude ist in dieser Ansicht nicht verfügbar.',
    capability_removed: 'Diese App-Version unterstützt die Auswertung nicht.',
    images_unavailable: 'In dieser Ansicht dürfen keine Bilder an Claude gesendet werden.',
    image_rejected: 'Das Bild wurde nicht angenommen (Format oder Größe). Bitte ein PNG/JPG bis 20 MB verwenden.',
    rate_limited: 'Zu viele Anfragen – bitte in einer Minute erneut versuchen.',
    session_expired: 'Die Anmeldung ist abgelaufen – bitte neu anmelden.',
    refused: 'Claude hat diese Zeichnung nicht ausgewertet.',
    empty_completion: 'Claude hat keine Antwort geliefert.',
    invalid_json: 'Die Antwort war unvollständig oder nicht lesbar.',
    upstream_error: 'Verbindung zu Claude unterbrochen.',
    prompt_too_large: 'Die Anfrage ist zu groß.',
    no_routing: 'Aus der Antwort ließ sich kein gültiger Arbeitsplan bilden.',
  };
  const AI_HIDE = { not_granted: 1, sampling_disabled: 1, not_declared: 1, capability_disabled: 1, capability_removed: 1 };

  // ------------------------------------------------------------------ CSS (Präfix .ka-)
  const CSS = `
  .ka-root{min-width:0}
  .ka-hr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ka-ai{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:var(--fs-xs);color:var(--text2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .ka-ai i{width:8px;height:8px;border-radius:50%;background:var(--st-idle);flex:none}
  .ka-ai[data-s="ready"] i,.ka-ai[data-s="noimg"] i{background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .ka-ai[data-s="off"] i{background:var(--st-wait)}
  .ka-ai[data-s="checking"] i{animation:kaBlink 1.1s ease-in-out infinite}
  .ka-grid{display:grid;gap:16px;grid-template-columns:minmax(420px,.86fr) minmax(0,1.14fr);align-items:start}
  .ka-subh{display:flex;align-items:center;gap:10px;padding:10px 14px 0;border-top:1px solid var(--line)}
  @media (min-width:700px) and (max-width:1240px){
    .ka-srcgrid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(250px,1fr)}
    .ka-srcB{border-left:1px solid var(--line);display:flex;flex-direction:column}
    .ka-srcB .ka-subh{border-top:0;padding-top:14px}
    .ka-srcB .ka-form{grid-template-columns:minmax(0,1fr)}
    .ka-srcB .ka-go{margin-top:auto}
  }
  .ka-subh h3{margin:0;font:600 var(--fs-lg)/1.25 var(--f-ui)}.ka-subh .muted{font-size:var(--fs-xs);margin-left:auto}
  @media (max-width:1240px){.ka-grid{grid-template-columns:minmax(0,1fr)}}
  .ka-left,.ka-right{display:flex;flex-direction:column;gap:14px;min-width:0}
  .ka-card-h{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line)}
  .ka-card-h h3{margin:0;font:600 var(--fs-lg)/1.25 var(--f-ui);white-space:nowrap}
  .ka-card-h .muted{font-size:var(--fs-xs);margin-left:auto;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ka-card-h .btn{flex:none;margin:-4px -6px -4px 0}
  .ka-exs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .ka-ex{position:relative;display:flex;flex-direction:column;gap:5px;padding:6px 6px 7px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);color:var(--text2);cursor:pointer;text-align:left;min-width:0;font:inherit;transition:border-color .15s,background .15s,box-shadow .15s}
  .ka-ex:hover{border-color:var(--line2);background:var(--card2)}
  .ka-ex.on{border-color:color-mix(in srgb,var(--accent) 75%,transparent);background:color-mix(in srgb,var(--accent) 9%,var(--card2));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
  .ka-ex .th{display:block;border-radius:4px;overflow:hidden;aspect-ratio:2.35/1;box-shadow:0 0 0 1px var(--line)}
  .ka-ex .th svg{display:block;width:100%;height:100%}
  .ka-ex b{display:block;font-size:var(--fs-sm);font-weight:600;color:var(--text);padding:0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:16px}
  @media (min-width:1241px){.ka-left.stick{position:sticky;top:0}}
  .ka-ex small{display:block;font-size:var(--fs-2xs);line-height:1.25;color:var(--muted);padding:0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ka-ex.up .th{display:grid;place-items:center;align-content:center;gap:2px;background:var(--bg);border:1px dashed var(--line2);box-shadow:none;color:var(--muted)}
  .ka-ex.up.on .th{border-color:var(--accent);color:var(--accent)}
  @media (max-width:560px){.ka-ex small{display:none}.ka-ex b{font-size:var(--fs-xs)}}
  .ka-stage{position:relative;margin-top:12px;border-radius:7px;overflow:hidden;background:var(--bg2);box-shadow:0 0 0 1px var(--line2),0 16px 36px rgba(0,0,0,.38)}
  .ka-stage .ka-dwg{display:block;width:100%;height:auto}
  .ka-stage.drag{box-shadow:0 0 0 2px var(--accent),0 16px 36px rgba(0,0,0,.38)}
  .ka-ov{position:absolute;inset:0;pointer-events:none}
  .ka-scan{position:absolute;left:0;right:0;top:0;height:26%;pointer-events:none;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--accent) 14%,transparent) 70%,color-mix(in srgb,var(--accent) 38%,transparent));border-bottom:2px solid var(--accent);animation:kaScan 1.7s cubic-bezier(.45,.05,.55,.95) infinite;box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 30%,transparent)}
  .ka-mk{position:absolute;width:19px;height:19px;margin:-9.5px 0 0 -9.5px;border-radius:50%;display:grid;place-items:center;font:700 var(--fs-2xs)/1 var(--f-ui);color:var(--accent-ink);background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent),0 2px 6px rgba(4,16,30,.45);animation:kaPop .42s cubic-bezier(.2,.9,.3,1.35) both;pointer-events:auto;cursor:default;transition:transform .15s,box-shadow .15s}
  .ka-mk.hl{transform:scale(1.35);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 40%,transparent),0 2px 8px rgba(4,16,30,.5);z-index:2}
  .ka-imgbox{position:relative;display:block;margin:0 auto;width:max-content;max-width:100%}
  .ka-imgbox img{display:block;max-width:100%;max-height:440px;height:auto}
  .ka-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;aspect-ratio:297/210;padding:18px;border:1.5px dashed var(--line2);border-radius:7px;color:var(--muted);font-size:var(--fs-sm);cursor:pointer;background:var(--bg)}
  .ka-drop:hover,.ka-stage.drag .ka-drop{border-color:var(--accent);color:var(--text2)}
  .ka-drop b{color:var(--text);font-size:var(--fs-md)}
  .ka-pdf{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:297/210;padding:18px;text-align:center;color:var(--text2);font-size:var(--fs-sm);background:var(--bg)}
  .ka-pdf .ic{width:52px;height:64px;border-radius:6px;display:grid;place-items:center;background:var(--card2);border:1px solid var(--line2);color:var(--st-fault);font:700 var(--fs-sm) var(--f-ui)}
  .ka-sinfo{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}
  .ka-sinfo .chip{font-family:var(--f-mono);font-size:var(--fs-xs)}
  .ka-form{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:10px 12px;padding:10px 14px 12px}
  @media (max-width:520px){.ka-form{grid-template-columns:minmax(0,1fr)}}
  .ka-form .full{grid-column:1/-1}
  .ka-form label.field{min-width:0}
  .ka-form .input{height:34px;padding:6px 10px}
  .ka-qty{display:grid;grid-template-columns:32px minmax(0,1fr) 32px}
  .ka-qty button{border:1px solid var(--line2);background:var(--card2);color:var(--text2);cursor:pointer;font:600 15px/1 var(--f-ui);height:34px}
  .ka-qty button:hover{color:var(--text);background:var(--raise)}
  .ka-qty button:first-child{border-radius:8px 0 0 8px;border-right:0}.ka-qty button:last-child{border-radius:0 8px 8px 0;border-left:0}
  .ka-qty .input{border-radius:0;text-align:center;font-variant-numeric:tabular-nums;-moz-appearance:textfield;appearance:textfield}
  .ka-qty .input::-webkit-inner-spin-button,.ka-qty .input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
  .ka-due{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:6px}
  .ka-seg{display:flex;width:100%}
  .ka-seg button{flex:1;height:28px;padding:0 8px}
  .ka-form .seg{height:34px;align-items:stretch}
  .ka-go{display:flex;flex-direction:column;gap:9px;padding:0 14px 14px}
  .ka-gorow{display:flex;gap:8px;align-items:stretch}
  .ka-gobtn{flex:1;height:42px;font-size:var(--fs-md);border-radius:9px;gap:9px}
  .ka-gobtn .spin{width:15px;height:15px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent-ink) 35%,transparent);border-top-color:var(--accent-ink);animation:kaSpin .8s linear infinite}
  .ka-gohint{display:flex;align-items:flex-start;gap:7px;font-size:var(--fs-xs);line-height:1.4;color:var(--muted);min-height:16px}
  .ka-gohint .ico{flex:none;margin-top:1px;color:var(--faint)}
  .ka-mode{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--muted)}
  .ka-mode .seg button{padding:4px 10px;font-size:var(--fs-xs)}
  .ka-recent .row{padding:8px 14px;border-top:1px solid var(--line);gap:10px;flex-wrap:nowrap;cursor:pointer}
  .ka-recent .row:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .ka-recent .row .id{font-family:var(--f-mono);font-size:var(--fs-sm);color:var(--text)}
  .ka-recent .row .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--fs-sm);color:var(--text2)}
  .ka-recent .row .eta{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  /* Ergebnis */
  .ka-flow{padding:14px 12px 12px}
  .ka-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
  .ka-st{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;min-width:0;padding:0 2px}
  .ka-st::before{content:"";position:absolute;top:15px;right:calc(50% + 21px);left:calc(-50% + 21px);height:2px;border-radius:2px;background:var(--line2);transition:background .3s}
  .ka-st:first-child::before{display:none}
  .ka-st.done::before,.ka-st.act::before{background:var(--accent)}
  .ka-st .d{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);border:1.5px solid var(--line2);color:var(--faint);transition:background .25s,border-color .25s,color .25s}
  .ka-st.act .d{color:var(--accent);border-color:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 14%,transparent);animation:kaRing 1.3s ease-in-out infinite}
  .ka-st.done .d{color:var(--accent-ink);background:var(--accent);border-color:var(--accent)}
  .ka-st.err .d{color:var(--st-fault);border-color:var(--st-fault)}
  .ka-st b{font-size:var(--fs-sm);font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .ka-st.act b,.ka-st.done b{color:var(--text)}
  .ka-st small{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-variant-numeric:tabular-nums;min-height:15px}
  .ka-st b .sm{display:none}
  @media (max-width:560px){.ka-st b{font-size:var(--fs-xs)}.ka-st b .lg{display:none}.ka-st b .sm{display:inline}.ka-st small{display:none}.ka-st .d{width:28px;height:28px}.ka-st::before{top:13px;right:calc(50% + 18px);left:calc(-50% + 18px)}}
  .ka-sec{overflow:hidden}
  .ka-sum{display:flex;align-items:flex-start;gap:9px;margin:12px 4px 0;padding:10px 12px 0;border-top:1px solid var(--line);font-size:var(--fs-sm);color:var(--text2);line-height:1.5}
  .ka-sum>.ico{flex:none;margin-top:3px;color:var(--accent)}
  .ka-sum b{color:var(--text);font-weight:600}
  .ka-sum b.ok{color:var(--st-run)}.ka-sum b.bad{color:var(--st-fault)}.ka-sum b.warn{color:var(--st-wait)}
  .ka-sum i{font-style:normal;color:var(--faint);margin:0 7px}
  .ka-wait{padding:16px}
  .ka-wait .hd{display:flex;align-items:flex-start;gap:12px}
  .ka-wait .hd>div{flex:1;min-width:0}
  .ka-wait b{font-size:var(--fs-md)}
  .ka-wait p{margin:3px 0 0;font-size:var(--fs-sm);color:var(--muted);font-variant-numeric:tabular-nums}
  .ka-wait .sp{flex:none;width:22px;height:22px;margin-top:1px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:kaSpin .9s linear infinite}
  .ka-sk{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:18px;margin-top:16px}
  .ka-sk i{display:block;height:10px;border-radius:5px;margin-bottom:11px;background:linear-gradient(90deg,var(--card2) 0%,var(--raise) 45%,var(--card2) 90%);background-size:220% 100%;animation:kaShim 1.5s linear infinite}
  .ka-sk i.h{height:20px;width:55%;margin-bottom:14px}
  @keyframes kaShim{from{background-position:120% 0}to{background-position:-120% 0}}
  .ka-sh{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);min-width:0}
  .ka-sh .n{flex:none;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font:700 11.5px/1 var(--f-ui);color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 32%,transparent)}
  .ka-sh h3{margin:0;font:600 var(--fs-lg)/1.25 var(--f-ui);white-space:nowrap}
  .ka-sh .m{margin-left:auto;font-size:var(--fs-xs);color:var(--muted);display:flex;gap:8px;align-items:center;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ka-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:var(--fs-xs);font-weight:600;border:1px solid var(--line2);color:var(--text2);background:var(--card2);white-space:nowrap}
  .ka-badge.ai{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 9%,transparent)}
  .ka-in{animation:kaIn .5s cubic-bezier(.2,.7,.2,1) both}
  .ka-est{text-decoration:underline dotted color-mix(in srgb,var(--accent) 65%,transparent);text-underline-offset:3px;text-decoration-thickness:1.5px;cursor:help}
  /* 1 Teil */
  .ka-part{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:0}
  .ka-pmain{padding:14px;border-right:1px solid var(--line);min-width:0}
  .ka-pname{font:600 var(--fs-2xl)/1.05 var(--f-cond);letter-spacing:.01em}
  .ka-psub{margin-top:4px;font-size:var(--fs-sm);color:var(--muted)}
  .ka-psub .mono{color:var(--text2)}
  .ka-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px;margin-top:14px}
  .ka-fact{min-width:0}
  .ka-fact .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .ka-fact .v{margin-top:3px;font-size:var(--fs-md);font-weight:600;color:var(--text);overflow-wrap:break-word}
  .ka-fact .s{margin-top:1px;font-size:var(--fs-xs);color:var(--muted);line-height:1.35}
  .ka-fact.full{grid-column:1/-1}
  .ka-stock{margin-top:8px}
  .ka-stock .bw{position:relative}
  .ka-stock .trk{height:10px;border-radius:5px;background:var(--track);overflow:hidden;display:flex}
  .ka-stock .trk i{display:block;height:100%}
  .ka-stock .mn{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;border-radius:1px;background:var(--st-wait);box-shadow:0 0 0 1.5px var(--card)}
  .ka-stock .lg{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:6px;font-size:var(--fs-xs);color:var(--muted)}
  .ka-stock .lg span{display:inline-flex;align-items:center;gap:5px;white-space:normal;min-width:0}
  .ka-stock .lg i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:none}
  .ka-stock .lg .w{color:color-mix(in srgb,var(--st-wait) 80%,var(--text))}
  .ka-stock .lg .x{color:color-mix(in srgb,var(--st-fault) 80%,var(--text))}
  .ka-stock .trk i + i{box-shadow:inset 1px 0 0 var(--card)}
  .ka-stock .oh{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text2);opacity:.75;box-shadow:0 0 0 1.5px var(--card)}
  .ka-feats{padding:12px 14px 14px;min-width:0}
  .ka-feats .eyebrow{display:flex;justify-content:space-between;margin-bottom:8px}
  .ka-fl{display:flex;flex-direction:column;gap:5px}
  .ka-feat{display:grid;grid-template-columns:20px 26px minmax(0,1fr);gap:9px;align-items:center;padding:6px 9px 6px 7px;border-radius:7px;background:var(--bg2);border:1px solid var(--line);transition:border-color .15s,background .15s}
  .ka-feat.hl{border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:color-mix(in srgb,var(--accent) 7%,var(--bg2))}
  .ka-feat .no{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:700 var(--fs-2xs)/1 var(--f-ui);color:var(--accent-ink);background:var(--accent)}
  .ka-feat .no.x{background:var(--raise);color:var(--muted)}
  .ka-feat .ic{width:26px;height:24px;border-radius:5px;display:grid;place-items:center;color:var(--text2);background:var(--card2);border:1px solid var(--line2)}
  .ka-feat .t{display:flex;align-items:baseline;gap:8px;min-width:0}
  .ka-feat .t b{font-family:var(--f-mono);font-size:var(--fs-sm);font-weight:500;color:var(--text);white-space:nowrap}
  .ka-feat .t .crit{font-size:var(--fs-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--st-wait)}
  .ka-feat .d{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media (max-width:760px){.ka-part{grid-template-columns:minmax(0,1fr)}.ka-pmain{border-right:0;border-bottom:1px solid var(--line)}}
  /* 2 Arbeitsplan */
  .ka-oph,.ka-op{display:grid;grid-template-columns:36px minmax(0,1fr) 222px;gap:4px 14px;padding:0 14px}
  .ka-oph{padding-top:8px;padding-bottom:7px;border-bottom:1px solid var(--line);font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
  .ka-oph .nums span,.ka-op .nums>div{text-align:right}
  .ka-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .ka-op{padding-top:11px;padding-bottom:11px;border-bottom:1px solid var(--line);align-items:start}
  .ka-op:last-child{border-bottom:0}
  .ka-op .seq{font:600 var(--fs-sm)/20px var(--f-mono);color:var(--muted)}
  .ka-op .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
  .ka-op .hd b{font-size:var(--fs-md);font-weight:600}
  .ka-op .why{margin-top:3px;font-size:var(--fs-sm);line-height:1.4;color:var(--muted)}
  .ka-op .meta{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:4px;font-size:var(--fs-xs);color:var(--muted)}
  .ka-op .meta span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
  .ka-op .meta .w{color:color-mix(in srgb,var(--st-wait) 88%,white)}
  .ka-op .meta .ico{opacity:.8}
  .ka-op .tl{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .ka-op .tl .chip{font-size:var(--fs-xs);padding:2px 7px}
  .ka-op .tl .chip em{font-style:normal;color:var(--muted);margin-left:2px}
  .ka-op .tl .chip.chg{border-color:color-mix(in srgb,var(--st-tool) 45%,transparent)}
  .ka-op .tl .chip.chg em{color:color-mix(in srgb,var(--st-tool) 85%,white)}
  .ka-op .nums>div{font:600 var(--fs-md)/20px var(--f-ui);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ka-op .nums small{display:block;font:500 var(--fs-xs)/1.3 var(--f-ui);color:var(--muted);white-space:nowrap}
  .ka-mc{position:relative;display:inline-flex;align-items:center;gap:6px;padding:2px 8px 2px 7px;border-radius:6px;background:var(--card2);border:1px solid var(--line2);font-size:var(--fs-xs);color:var(--text2);white-space:nowrap;cursor:pointer}
  .ka-mc:hover{border-color:var(--muted);color:var(--text)}
  .ka-mc i{width:7px;height:7px;border-radius:50%;background:var(--c,var(--st-idle));flex:none}
  .ka-mc .id{font-family:var(--f-mono);font-size:var(--fs-xs);color:var(--text)}
  .ka-mc.ext{cursor:default;border-color:color-mix(in srgb,var(--ext) 40%,transparent);color:color-mix(in srgb,var(--ext) 85%,white);background:color-mix(in srgb,var(--ext) 8%,transparent)}
  .ka-altb{position:relative;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:6px;border:1px dashed var(--line2);background:transparent;color:var(--text2);font:500 var(--fs-xs)/1 var(--f-ui);cursor:pointer;white-space:nowrap}
  .ka-altb:hover{border-color:var(--accent);color:var(--text)}
  .ka-altb em{font-style:normal;color:var(--muted)}
  .ka-free{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
  .ka-free.w{color:color-mix(in srgb,var(--st-wait) 85%,white)}
  .ka-chain{display:flex;align-items:center;flex-wrap:wrap;gap:6px 4px;padding:10px 14px;border-bottom:1px solid var(--line);background:linear-gradient(90deg,color-mix(in srgb,var(--mat) 5%,transparent),transparent 70%)}
  .ka-cc{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px 0 8px;border-radius:7px;background:var(--bg2);border:1px solid var(--line2);font-size:var(--fs-xs);color:var(--text2);white-space:nowrap}
  .ka-cc i{width:7px;height:7px;border-radius:50%;background:var(--c,var(--st-idle))}
  .ka-cc b{font:600 var(--fs-xs)/1 var(--f-mono);color:var(--text)}
  .ka-cc small{font-size:var(--fs-xs);color:var(--muted)}
  .ka-cc.ext{border-color:color-mix(in srgb,var(--ext) 45%,transparent);background:color-mix(in srgb,var(--ext) 9%,transparent);color:color-mix(in srgb,var(--ext) 85%,white)}
  .ka-cc.ext b{color:color-mix(in srgb,var(--ext) 90%,white);font-family:var(--f-ui)}
  .ka-ca{display:inline-grid;place-items:center;color:var(--mat);opacity:.9}
  .ka-ops-f{display:flex;gap:6px 18px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);background:var(--bg2);font-size:var(--fs-sm);color:var(--muted)}
  .ka-ops-f b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
  .ka-legend{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted)}
  @media (max-width:640px){
    .ka-oph{display:none}
    .ka-op{grid-template-columns:30px minmax(0,1fr)}
    .ka-op .nums{grid-column:2;margin-top:6px}
    .ka-op .nums>div{text-align:left}
  }
  /* 3 Kalkulation */
  .ka-calc{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(230px,.9fr)}
  .ka-cl{padding:12px 14px;border-right:1px solid var(--line);min-width:0}
  .ka-cr{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:2px 14px;align-items:baseline;padding:5px 0;border-bottom:1px dashed var(--line)}
  .ka-cr:last-child{border-bottom:0}
  .ka-cr .k{font-size:var(--fs-sm);color:var(--text2);min-width:0}
  .ka-cr .k small{display:block;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere;margin-top:1px}
  .ka-cr .a{font:600 var(--fs-md)/1.2 var(--f-ui);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--text)}
  .ka-cr.sub{border-bottom:0;padding:2px 0 2px 12px}
  .ka-cr.sub .k{font-size:var(--fs-sm);color:var(--muted)}
  .ka-cr.sub .a{font-weight:500;font-size:var(--fs-sm);color:var(--text2)}
  .ka-cr.sum{border-top:1px solid var(--line2);border-bottom:0;margin-top:4px;padding-top:7px}
  .ka-cr.sum .k{color:var(--text);font-weight:600}
  .ka-cr.tot .k{font-weight:700;color:var(--text)}
  .ka-cr.tot .a{font-size:var(--fs-lg)}
  .ka-price{padding:14px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 6%,transparent),transparent 60%);min-width:0}
  .ka-price .big{font:600 var(--fs-kpi)/1.1 var(--f-cond);margin-top:5px;font-variant-numeric:tabular-nums;letter-spacing:.01em}
  .ka-price .big small{font-size:var(--fs-lg);color:var(--muted);font-weight:500;margin-left:4px}
  .ka-price .tot{font-size:var(--fs-sm);margin-top:3px;color:var(--text2)}
  .ka-price .tot b{font-variant-numeric:tabular-nums}
  .ka-zrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--muted)}
  .ka-zrow .seg button{padding:4px 8px;font-size:var(--fs-xs)}
  .ka-stf{display:flex;flex-direction:column;gap:4px}
  .ka-stf button{display:grid;grid-template-columns:62px minmax(0,1fr) 74px;align-items:center;gap:8px;padding:3px 4px;border:0;border-radius:6px;background:transparent;color:var(--text2);cursor:pointer;font:inherit;font-size:var(--fs-sm);text-align:left}
  .ka-stf button:hover{background:color-mix(in srgb,var(--raise) 50%,transparent)}
  .ka-stf button .q{font-variant-numeric:tabular-nums;white-space:nowrap}
  .ka-stf button .b{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
  .ka-stf button .b i{display:block;height:100%;border-radius:4px;background:color-mix(in srgb,var(--accent) 45%,var(--line2))}
  .ka-stf button .p{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
  .ka-stf button.cur{background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--text)}
  .ka-stf button.cur .b i{background:var(--accent)}
  @media (max-width:760px){.ka-calc{grid-template-columns:minmax(0,1fr)}.ka-cl{border-right:0;border-bottom:1px solid var(--line)}}
  /* 4 Termin */
  .ka-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 14px 4px}
  /* Termin-Kennzahlen: Standard-Kachel .kpi (UI_GUIDE Regel 14) – Hinweis nur über .warn/.crit */
  .ka-tiles .kpi{min-height:0;background:var(--bg2)}
  .ka-tiles .kpi .s b{color:var(--text2);font-weight:600}
  .ka-gantt{position:relative;padding:8px 14px 4px;min-width:0}
  .ka-gantt svg{display:block;width:100%;overflow:visible}
  .ka-gantt text{font-family:var(--f-ui);font-size:11.5px;fill:var(--muted)}
  .ka-gantt .lb{fill:var(--text2);font-size:11.5px;font-weight:600}
  .ka-gantt .lb2{fill:var(--muted);font-size:10.5px}
  .ka-gantt .bt{fill:var(--bg);font-size:10.5px;font-weight:600}
  .ka-gantt .qt{fill:var(--text2);font-size:10.5px}
  .ka-gantt [data-tip]{cursor:default}
  .ka-gb{transform-box:fill-box;transform-origin:left center}
  .ka-gantt.anim .ka-gb{animation:kaGrow .7s cubic-bezier(.2,.7,.2,1) both}
  .ka-glg{display:flex;gap:4px 14px;flex-wrap:wrap;padding:2px 14px 10px;font-size:var(--fs-xs);color:var(--muted)}
  .ka-glg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .ka-glg i{width:12px;height:8px;border-radius:2px;display:inline-block}
  .ka-tip{position:fixed;z-index:80;pointer-events:none;max-width:300px;padding:7px 9px;border-radius:8px;background:var(--card2);border:1px solid var(--line2);box-shadow:var(--shadow);font-size:var(--fs-sm);line-height:1.4;color:var(--text2)}
  .ka-tip b{color:var(--text)}
  .ka-imp{padding:4px 14px 12px}
  .ka-imp .eyebrow{margin:6px 0 6px}
  .ka-imp .r{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:var(--fs-sm)}
  .ka-imp .r .id{font-family:var(--f-mono);font-size:var(--fs-sm);color:var(--text)}
  .ka-imp .r .t{color:var(--text2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ka-imp .none{font-size:var(--fs-sm);color:var(--muted);display:flex;gap:8px;align-items:center}
  .ka-duec{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);background:var(--bg2);font-size:var(--fs-sm);color:var(--muted)}
  .ka-duec .seg button{padding:5px 10px;font-size:var(--fs-sm)}
  @media (max-width:760px){.ka-tiles{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.ka-tiles .kpi:first-child{grid-column:1/-1}}
  /* 5 Hinweise */
  .ka-hints{display:flex;flex-direction:column;gap:7px;padding:12px 14px 14px}
  .ka-hint{--c:var(--info);display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:10px;align-items:start;padding:9px 11px;border-radius:8px;background:var(--bg2);border:1px solid var(--line);box-shadow:inset 3px 0 0 var(--c)}
  .ka-hint .ic{color:var(--c);margin-top:1px}
  .ka-hint b{display:block;font-size:var(--fs-md);font-weight:600;color:var(--text)}
  .ka-hint p{margin:2px 0 0;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .ka-hint .btn{align-self:center}
  @media (max-width:560px){.ka-hint{grid-template-columns:20px minmax(0,1fr)}.ka-hint .btn{grid-column:2;justify-self:start}}
  /* Fußleiste */
  /* bündig am unteren Rand angedockt: hebt den unteren Innenabstand der Ansicht (28 px) auf, Inhalt läuft mit Verlauf darunter */
  .ka-foot{position:sticky;bottom:-28px;margin-bottom:-28px;z-index:6;display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));border-radius:var(--r) var(--r) 0 0;background:color-mix(in srgb,var(--card2) 94%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--line2);border-bottom:0;box-shadow:0 -10px 30px rgba(4,8,16,.45)}
  .ka-foot::before{content:"";position:absolute;left:-1px;right:-1px;bottom:calc(100% + 1px);height:26px;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 0%,transparent),var(--bg));pointer-events:none}
  .ka-foot .sum{display:flex;align-items:baseline;gap:6px 22px;flex-wrap:wrap;min-width:0;flex:1}
  .ka-foot .sum div{display:flex;flex-direction:column;min-width:0}
  .ka-foot .sum .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .ka-foot .sum .v{font:600 var(--fs-xl)/1.2 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .ka-foot .acts{display:flex;gap:8px;flex-wrap:wrap}
  .ka-foot .btn.primary{height:40px;padding:0 18px;font-size:var(--fs-md)}
  .ka-foot .btn{height:40px}
  @media (max-width:560px){
    .ka-foot{padding:10px 12px;gap:8px}
    .ka-foot .sum{gap:2px 14px}
    .ka-foot .sum .v{font-size:var(--fs-lg)}
    .ka-foot .acts{width:100%;flex-wrap:nowrap}
    .ka-foot .acts .btn{height:40px}
    .ka-foot .acts .btn.primary{flex:1}
    .ka-foot .acts .btn .tx{display:none}
  }
  /* Banner, Leer- und Fehlerzustand */
  .ka-ban{--c:var(--st-run);display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:var(--r);background:color-mix(in srgb,var(--c) 9%,var(--card));border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
  .ka-ban .ic{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:none;color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent)}
  .ka-ban .tx{flex:1;min-width:200px}
  .ka-ban b{font-size:var(--fs-md)}
  .ka-ban p{margin:2px 0 0;font-size:var(--fs-sm);color:var(--text2)}
  .ka-ban .bar{margin-top:7px;max-width:360px}
  .ka-empty{padding:22px 22px 18px}
  .ka-empty .hd{display:flex;gap:14px;align-items:flex-start}
  .ka-empty .hd .ic{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent)}
  .ka-empty h2{margin:0;font:600 var(--fs-xl)/1.15 var(--f-cond)}
  .ka-empty .hd p{margin:6px 0 0;color:var(--text2);font-size:var(--fs-md);line-height:1.5;max-width:62ch}
  .ka-esteps{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:0}
  .ka-esteps li{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
  .ka-esteps li .d{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);border:1px solid var(--line2);color:var(--accent)}
  .ka-esteps li b{display:block;font-size:var(--fs-md)}
  .ka-esteps li span{font-size:var(--fs-sm);color:var(--muted);line-height:1.4}
  .ka-esteps li .who{font-size:var(--fs-2xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:3px 7px;border-radius:5px;white-space:nowrap}
  .ka-esteps li .who.c{color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
  .ka-esteps li .who.w{color:var(--st-run);background:color-mix(in srgb,var(--st-run) 10%,transparent)}
  .ka-esteps li .who.p{color:var(--text2);background:var(--card2);border:1px solid var(--line2)}
  .ka-tag{position:absolute;top:5px;right:5px;padding:2px 6px;border-radius:4px;font:600 var(--fs-2xs)/1.2 var(--f-ui);color:var(--text2);background:var(--card2);border:1px solid var(--line2);white-space:nowrap}
  .ka-goff{flex:0 1 auto;color:var(--muted)}
  .ka-gorow .ka-goff + .btn{flex:1 1 auto}
  @media (max-width:560px){.ka-gorow{flex-wrap:wrap}.ka-gorow .ka-goff{flex:1 1 100%}}
  .ka-off{padding-bottom:6px}
  .ka-nexs{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;margin-top:12px}
  .ka-nex{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:12px;align-items:center;padding:6px 12px 6px 6px;border-radius:9px;border:1px solid var(--line2);background:var(--bg2);color:var(--text2);cursor:pointer;text-align:left;font:inherit}
  .ka-nex:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--bg2))}
  .ka-nex .th{display:block;aspect-ratio:2.35/1;border-radius:4px;overflow:hidden;box-shadow:0 0 0 1px var(--line)}
  .ka-nex .th svg{display:block;width:100%;height:100%}
  .ka-nex .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
  .ka-nex b{font-size:var(--fs-md);font-weight:600;color:var(--text)}
  .ka-nex small{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ka-nex > .ico{color:var(--accent)}
  .ka-offsteps{padding:4px 18px 16px}
  .ka-offsteps .eyebrow{display:flex;justify-content:space-between;gap:10px;margin-top:6px}
  .ka-offsteps .ka-esteps{margin-top:8px}
  @media (pointer:coarse){.ka-nex{min-height:48px}}
  .ka-cap{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
  .ka-cap .eyebrow{display:flex;justify-content:space-between;gap:10px}
  .ka-capg{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:6px;margin-top:9px}
  .ka-capg .c{display:grid;grid-template-columns:7px minmax(0,1fr);grid-template-rows:auto auto auto;gap:2px 8px;align-items:center;padding:7px 9px 8px;border-radius:7px;background:var(--bg2);border:1px solid var(--line);font-size:var(--fs-sm);min-width:0}
  .ka-capg .c .nmw{display:flex;gap:6px;align-items:baseline;min-width:0}
  .ka-capg .c .frw{grid-column:2;display:flex;align-items:baseline;gap:6px;min-width:0}
  .ka-capg .c .bis{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}
  .ka-capg .c .occ{grid-column:1/-1;position:relative;display:block;height:4px;margin-top:4px;border-radius:2px;background:var(--track);overflow:hidden}
  .ka-capg .c .occ i{position:absolute;top:0;bottom:0;width:auto;height:auto;border-radius:1px;background:color-mix(in srgb,var(--muted) 55%,transparent)}
  .ka-capg .c .occ i.a{background:var(--c)}
  .ka-capg .c .fr.bad{color:var(--st-fault)}
  .ka-capg .c.bn{border-color:color-mix(in srgb,var(--st-wait) 40%,var(--line))}
  .ka-capg .c .bnt{flex:none;align-self:center;display:inline-grid;place-items:center;color:var(--st-wait)}
  .ka-caplg .bnl{display:inline-flex;align-items:center;gap:5px}
  .ka-caplg .bnl .ico{color:var(--st-wait)}
  .ka-caplg{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:var(--fs-xs);color:var(--muted)}
  .ka-caplg span{display:inline-flex;align-items:center;gap:6px}
  .ka-caplg i{display:inline-block;width:14px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--muted) 55%,transparent)}
  .ka-caplg i.a{background:var(--st-run)}
  .ka-capg .c i{width:7px;height:7px;border-radius:50%;flex:none;background:var(--c)}
  .ka-capg .c .id{font-family:var(--f-mono);font-size:var(--fs-xs);color:var(--muted)}
  .ka-capg .c .nm{color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
  .ka-capg .c .fr{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--text);flex:none}
  .ka-capg .c .fr.ok{color:var(--st-run)}
  .ka-note{padding:18px;display:flex;gap:14px;align-items:flex-start}
  .ka-note .ic{flex:none;width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:var(--c,var(--st-wait));background:color-mix(in srgb,var(--c,var(--st-wait)) 13%,transparent)}
  .ka-note h3{margin:0;font:600 var(--fs-xl)/1.2 var(--f-cond)}
  .ka-note p{margin:5px 0 0;font-size:var(--fs-md);color:var(--text2);line-height:1.5}
  .ka-note .row{margin-top:12px}
  .ka-qt{width:100%;min-height:330px;font-family:var(--f-mono);font-size:var(--fs-sm);line-height:1.5;resize:vertical}
  .ka-zm{background:var(--bg2);border-radius:8px;overflow:hidden;position:relative}
  .ka-zm svg{display:block;width:100%;height:auto}
  .ka-zm .ka-mk{animation:none;cursor:pointer}
  .ka-mk{cursor:pointer}
  .ka-zhint{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--muted);margin:-4px 0 0}
  .ka-zhint .ico{flex:none;color:var(--faint)}
  /* Telefon: Lightbox als Vollbild, Zeichnung in fester Breite – verschieben und mit zwei Fingern zoomen */
  .modal-back.ka-zback{padding:0}
  .modal.ka-zmodal{width:100vw !important;max-width:none;height:100dvh;max-height:none;border-radius:0;border:0;display:flex;flex-direction:column;overflow:hidden}
  .modal.ka-zmodal .modal-h{padding-top:max(14px,env(safe-area-inset-top,0px))}
  .modal.ka-zmodal .modal-b{flex:1;min-height:0;padding:10px 0 0;gap:8px}
  .modal.ka-zmodal .ka-zhint{padding:0 16px;margin:0}
  .ka-zpan{flex:1;min-height:0;overflow:auto;touch-action:pan-x pan-y pinch-zoom;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--bg2);padding-bottom:env(safe-area-inset-bottom,0px)}
  .ka-zpan .ka-zm{width:1100px;border-radius:0}
  .ka-zpan .ka-mk{width:26px;height:26px;margin:-13px 0 0 -13px;font-size:var(--fs-sm)}
  /* Touch: Bedienflächen ≥ 40 px, Eingaben 16 px (UI_GUIDE Regel 17) */
  @media (pointer:coarse){
    .ka-form .input{height:40px}
    .ka-form .seg{height:auto}
    .ka-qty{grid-template-columns:40px minmax(0,1fr) 40px}
    .ka-qty button{height:40px}
    .ka-seg button,.ka-mode .seg button,.ka-zrow .seg button,.ka-duec .seg button{min-height:40px}
    .ka-stf button{min-height:40px}
    .ka-altb::after,.ka-mc:not(.ext)::after{content:'';position:absolute;inset:-9px -3px}
    .ka-mk::after{content:'';position:absolute;inset:-11px;border-radius:50%}
    .ka-recent .row{min-height:44px}
    .ka-foot .btn,.ka-foot .btn.primary{height:auto}
  }
  .ka-feat.flash{animation:kaFlash 1.6s ease}
  @keyframes kaFlash{0%,60%{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,var(--bg2));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}100%{box-shadow:0 0 0 0 transparent}}
  @keyframes kaIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes kaScan{0%{transform:translateY(-100%)}100%{transform:translateY(390%)}}
  @keyframes kaPop{0%{opacity:0;transform:scale(.2)}70%{opacity:1;transform:scale(1.18)}100%{opacity:1;transform:scale(1)}}
  @keyframes kaRing{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--accent) 6%,transparent)}}
  @keyframes kaGrow{from{transform:scaleX(0);opacity:.2}to{transform:scaleX(1);opacity:1}}
  @keyframes kaSpin{to{transform:rotate(360deg)}}
  @keyframes kaBlink{50%{opacity:.25}}
  `;

  // ------------------------------------------------------------------ Zustand der Ansicht
  const LS_KEY = 'werkfluss.kiAuftrag.v1';
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { pref = {}; }
  const savePref = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(pref)); } catch (e) { /* ohne Speicher */ } };
  const ui = { src: { kind: 'example', id: 'flanschwelle' }, upload: null, mode: pref.mode === 'demo' ? 'demo' : 'live', qty: 20, prio: 'normal',
    customer: '', dueDay: null, dueTime: '14:00', zus: 0.18, dueChoice: 'auto', notice: null };
  const ai = { state: 'checking', sampler: null, img: null };
  let root = null, R = {}, quote = null, run = null, placed = null, calc = null, calcAt = 0, tipEl = null, ro = null, lastW = 0, emptyAt = 0, qtyTimer = 0, dayKey = -1;
  const shown = {};
  const html = {};
  const refs = (n) => { const r = {}; n.querySelectorAll('[data-r]').forEach(x => { r[x.dataset.r] = x; }); return r; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hasView = (id) => WF.views.some(v => v.id === id);
  const toolShort = (n) => String(n || '').replace(/\s*\([^)]*\)/g, '').trim();
  const secTxt = (ms) => (ms < 10000 ? nf(ms / 1000, 1) : nf(Math.round(ms / 1000))) + ' s';
  const SEVC = { crit: 'var(--st-fault)', warn: 'var(--st-wait)', info: 'var(--info)', ok: 'var(--st-run)' };
  const SEVO = { crit: 0, warn: 1, info: 2, ok: 3 };
  const stColor = (id) => { const m = S() && S().machines[id]; return m && WF.STATE[m.state] ? WF.STATE[m.state].color : 'var(--st-idle)'; };
  const stLabel = (id) => { const m = S() && S().machines[id]; return m && WF.STATE[m.state] ? WF.STATE[m.state].label : ''; };

  /** HTML eines Bereichs nur bei Änderung setzen; Fokus (data-focus) bleibt erhalten */
  function put(node, h) {
    if (!node) return false;
    const k = node.dataset.r;
    if (html[k] === h) return false;
    html[k] = h;
    const ae = document.activeElement, fk = ae && node.contains(ae) ? ae.getAttribute('data-focus') : null;
    node.innerHTML = h;
    if (fk) { const n = node.querySelector(`[data-focus="${fk}"]`); if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* egal */ } } }
    return true;
  }
  function vis(node, on, anim) {
    if (!node) return;
    const k = node.dataset.r;
    if (!on) { node.hidden = true; shown[k] = false; return; }
    node.hidden = false;
    if (!shown[k] && anim && !reduceMotion()) {
      node.classList.remove('ka-in'); void node.offsetWidth; node.classList.add('ka-in');
      node.addEventListener('animationend', function done(e) { if (e.target === node) { node.classList.remove('ka-in'); node.removeEventListener('animationend', done); } });
    }
    shown[k] = true;
  }

  // ------------------------------------------------------------------ Termin-Eingabe
  function workdaysFrom(day, n) { let d = day, c = 0; while (c < n) { d++; if (d % 7 < 5) c++; } return d; }
  function dueT() { return ui.dueDay == null ? null : ui.dueDay * DAY + U.hm(ui.dueTime); }
  function applyDefaults(ex) {
    const today = Math.floor(S().t / DAY);
    ui.qty = ex.defaults.qty; ui.customer = ex.defaults.customer; ui.prio = 'normal';
    ui.dueDay = workdaysFrom(today, ex.defaults.dueWd); ui.dueTime = ex.defaults.dueTime; ui.dueChoice = 'auto';
  }
  function dayOptions() {
    const now = S().t, today = Math.floor(now / DAY);
    const opts = [];
    let d = today; if (d % 7 >= 5 || now % DAY > 20 * 3600) d = workdaysFrom(today, 1);
    for (let i = 0; i < 10; i++) {
      const rel = d - today, wk = Math.floor(d / 7) !== Math.floor(today / 7);
      const lab = (rel === 0 ? 'heute · ' : rel === 1 ? 'morgen · ' : '') + DAYS_LONG[d % 7] + (wk ? ' (Folgewoche)' : '');
      opts.push({ d, lab });
      d = workdaysFrom(d, 1);
    }
    return opts;
  }
  function renderDue(force) {
    const today = Math.floor(S().t / DAY);
    if (!force && dayKey === today) return;
    if (!force && R.dueDay && document.activeElement === R.dueDay) return;
    dayKey = today;
    const opts = dayOptions();
    if (ui.dueDay != null && !opts.some(o => o.d === ui.dueDay)) opts.push({ d: ui.dueDay, lab: DAYS_LONG[ui.dueDay % 7] + (ui.dueDay < today ? ' (vorbei)' : '') });
    R.dueDay.innerHTML = `<option value="">kein Wunschtermin</option>` + opts.sort((a, b) => a.d - b.d).map(o => `<option value="${o.d}"${o.d === ui.dueDay ? ' selected' : ''}>${esc(o.lab)}</option>`).join('');
    const times = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
    R.dueTime.innerHTML = times.map(t => `<option${t === ui.dueTime ? ' selected' : ''}>${t}</option>`).join('');
    R.dueTime.disabled = ui.dueDay == null;
  }
  function syncForm() {
    R.cust.value = ui.customer;
    R.qty.value = String(ui.qty);
    R.prio.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.prio));
    renderDue(true);
  }

  // ------------------------------------------------------------------ Berechnung (live)
  function quoteKey() { return quote ? [quote.uid, ui.qty, ui.prio, quote.routing.map(r => r.station).join(','), ui.customer.trim(), dueT(), ui.dueChoice].join('|') : ''; }
  function chosenDue(c) {
    if (ui.dueChoice === 'zusage' || !c.wunsch || c.wunsch <= S().t) return c.zus;
    if (ui.dueChoice === 'wunsch') return c.wunsch;
    return c.wunsch >= c.sch.eta ? c.wunsch : c.zus;
  }
  function withStation(k, sid) {
    const q2 = Object.assign({}, quote, { routing: quote.routing.slice() });
    const r = quote.routing[k], base = r.orig;
    const alt = sid === base.station ? base : r.alts.find(a => a.station === sid);
    q2.routing[k] = Object.assign({}, r, { station: sid, setupMin: alt.setupMin, cycleMin: alt.cycleMin });
    return q2;
  }
  function recalc() {
    if (!quote || !S()) { calc = null; return null; }
    ignoreOid = placed && S().orders[placed.id] && placed.key === quoteKey() ? placed.id : null;
    const qty = ui.qty, prio = ui.prio;
    // zwei Durchgänge: Gleichstände entscheidet die Engine nach dem Termin, der tatsächlich eingetragen wird
    let sch = schedule(quote, qty, prio);
    const due1 = chosenDue({ sch, zus: zusageOf(sch), wunsch: dueT() });
    if (Math.abs(due1 - sch.myDue) > 60) sch = schedule(quote, qty, prio, { due: due1 });
    const mat = sch.mat;
    const schAlt = prio === 'normal' ? schedule(quote, qty, 'eil', { due: due1 }) : null;
    const pr = price(quote, qty, prio, ui.zus);
    const zus = zusageOf(sch);
    const wunsch = dueT();
    const altEta = quote.routing.map((r, k) => {
      if (!r.alts || !r.alts.length) return null;
      return [r.orig.station].concat(r.alts.map(a => a.station)).map(sid => {
        if (sid === r.station) return { sid, eta: sch.eta, dCost: 0 };
        const q2 = withStation(k, sid);
        return { sid, eta: schedule(q2, qty, prio, { due: sch.myDue }).eta, dCost: price(q2, qty, prio, ui.zus).machSum - pr.machSum };
      });
    });
    const fc = WF.sim.forecast(120);
    const imp = Object.values(sch.impacts).map(x => {
      const f = fc.orders[x.orderId], o = S().orders[x.orderId];
      const slack = f ? f.slackSec : null;
      return Object.assign({}, x, { slack, after: slack != null ? slack - x.delay : null, part: o ? o.part.name : '', due: o ? o.due : null });
    }).sort((a, b) => b.delay - a.delay);
    calc = { qty, prio, mat, sch, schAlt, pr, zus, wunsch, altEta, imp, stf: staffel(quote, qty, prio, ui.zus) };
    calc.dueT = chosenDue(calc);
    calc.hints = buildHints(calc);
    calcAt = performance.now();
    ignoreOid = null;
    return calc;
  }
  function buildHints(c) {
    const H = [], q = quote, sch = c.sch, m = c.mat, now = S().t;
    if (c.wunsch) {
      if (c.wunsch <= now) H.push({ sev: 'warn', ic: 'clock', t: 'Wunschtermin liegt in der Vergangenheit', p: `${fDay(c.wunsch)} ist vorbei – frühestens ${fDay(sch.eta)} versandbereit.` });
      else if (c.wunsch < sch.eta) {
        let p = `Frühestens ${fDay(sch.eta)} versandbereit – ${fDurL(sch.eta - c.wunsch)} nach dem Wunschtermin ${fDay(c.wunsch)}.`, act = null;
        if (c.schAlt && c.schAlt.eta < sch.eta - 1800) { p += ` Als Eilauftrag: ${fDay(c.schAlt.eta)}${c.schAlt.eta <= c.wunsch ? ' – Wunschtermin erreichbar' : ''} (+15 % Eilzuschlag, schiebt andere Aufträge).`; act = { label: 'Als Eilauftrag rechnen', act: 'eil' }; }
        else p += ` Zusage-Vorschlag: ${fDay(c.zus)}.`;
        H.push({ sev: 'crit', ic: 'alert', t: 'Wunschtermin nicht erreichbar', p, act });
      } else if (c.wunsch < c.zus) H.push({ sev: 'warn', ic: 'clock', t: 'Wunschtermin nur knapp erreichbar', p: `Puffer ${fDurL(c.wunsch - sch.eta)} – weniger als die übliche Sicherheit. Zusage-Vorschlag: ${fDay(c.zus)}.` });
    }
    if (m && !m.none) {
      const mt = m.mt, resTxt = m.res.list.length ? ' für ' + m.res.list.map(x => x.id).join(', ') : '';
      const bTxt = m.before.length ? ` − ${qtyU(m.resBefore, mt)} für ${m.before.map(x => x.id).join(', ')} (vorher eingeplant)` : '';
      if (!m.ok) H.push({ sev: m.needsOrder ? 'crit' : 'warn', ic: 'box', t: m.needsOrder ? `Material reicht nicht: ${mt.name}` : `Material kommt mit offener Bestellung: ${mt.name}`,
        p: `Bedarf ${qtyU(m.need, mt)}, verfügbar ${qtyU(Math.max(0, m.free), mt)} (Bestand ${qtyU(mt.onHand, mt)}${bTxt}) – ${nf(m.shortParts)} Teile erst nach dem Wareneingang. ` +
          (m.needsOrder ? `Bei Bestellung jetzt (${mt.supplier}, ca. ${fDurL(mt.leadMin * 60)}) im Haus ${fRel(m.readyT)} – der Termin rechnet damit.` : `Lieferung ${fRel(m.readyT)} – der Termin rechnet damit.`),
        act: m.needsOrder ? { label: `${qtyU(m.suggest, mt)} bestellen`, act: 'reorder' } : null });
      else if (m.laterShort) H.push({ sev: 'warn', ic: 'box', t: `Danach fehlt Material für ${m.laterList.map(x => x.id).join(', ')}`, p: `Dieser Auftrag läuft vorher und verbraucht ${qtyU(m.need, mt)} ${mt.name} – für ${m.laterList.map(x => x.id).join(', ')} fehlen dann ${qtyU(-m.after, mt)}. Rechtzeitig nachbestellen (${mt.supplier}, ca. ${fDurL(mt.leadMin * 60)}).`,
        act: mt.onOrder ? null : { label: `${qtyU(m.suggest, mt)} nachbestellen`, act: 'reorder' } });
      else if (m.belowMin) H.push({ sev: 'warn', ic: 'box', t: 'Bestand fällt unter Mindestbestand', p: `${mt.name}: nach diesem Auftrag und den Reservierungen${resTxt} noch ${qtyU(Math.max(0, m.after), mt)} (Mindestbestand ${qtyU(mt.min, mt)})${mt.onOrder ? ' – bestellt: ' + qtyU(mt.onOrder, mt) : ''}.`,
        act: mt.onOrder ? null : { label: `${qtyU(Math.max(mt.reorderQty, m.suggest), mt)} nachbestellen`, act: 'reorder' } });
      else if (m.viaOrder) {
        const ev = (m.early || []).filter(x => x.etaT <= m.viaOrder.etaT), names = ev.map(x => x.id).join(', ') || m.viaOrder.id;
        H.push({ sev: 'ok', ic: 'box', t: `Gedeckt durch Bestellung ${names} (${fRel(m.viaOrder.etaT)})`,
          p: `${qtyU(m.need, mt)} ${mt.name}: ${qtyU(Math.max(0, Math.min(m.need, m.free)), mt)} aus dem Lager, ${qtyU(Math.max(0, m.need - Math.max(0, m.free)), mt)} aus ${names} – Lieferung ${fRel(m.viaOrder.etaT)}, vor dem geplanten Start ${m.s0 != null ? fRel(m.s0) : ''}.`.replace(' .', '.') });
      } else H.push({ sev: 'ok', ic: 'box', t: 'Material aus dem Lager', p: `${qtyU(m.need, mt)} ${mt.name} frei verfügbar – danach ${qtyU(m.after, mt)} (Mindestbestand ${qtyU(mt.min, mt)}).` });
      if (m.ok && m.viaOrder && m.belowMin && !m.laterShort) H.push({ sev: 'info', ic: 'box', t: 'Bestand danach unter Mindestbestand', p: `${mt.name}: nach diesem Auftrag ${qtyU(Math.max(0, m.after), mt)} (Mindestbestand ${qtyU(mt.min, mt)}).` });
    } else if (q.raw && !q.raw.materialId) H.push({ sev: 'info', ic: 'box', t: 'Rohteil nicht im Lager', p: `${q.raw.text} – Beistellung durch den Kunden oder Beschaffung klären${q.raw.costPerPart ? ` (geschätzt ${eur(q.raw.costPerPart)} je Teil)` : ''}.` });
    const bw = plantBottleneck();
    for (const s of sch.steps) {
      if (s.kind !== 'machine' || s.wait < 2 * 3600) continue;
      const sn = STN(s.station), ids = [...new Set(s.blockers.filter(e => e.end > s.earliest).map(e => e.orderId))];
      const isBn = bw && bw.stationId === s.station;
      H.push({ sev: s.wait > 8 * 3600 || isBn ? 'warn' : 'info', ic: 'gauge', t: `${isBn ? 'Engpass im Werk' : 'Wartezeit an'} ${s.station} ${sn.short}`, p: `Belegt bis ${fRel(s.start)}${ids.length ? ' durch ' + ids.slice(0, 3).join(', ') + (ids.length > 3 ? ' …' : '') : ''} – ${fDurL(s.wait)} Wartezeit vor AG ${(s.k + 1) * 10} „${q.routing[s.k].op}“.${isBn && bw.why ? ' ' + bw.why + '.' : ''}` });
    }
    c.altEta.forEach((al, k) => {
      if (!al) return;
      const best = al.filter(a => a.sid !== q.routing[k].station).sort((a, b) => a.eta - b.eta)[0];
      if (best && best.eta < sch.eta - 3600) H.push({ sev: 'info', ic: 'route', t: `Schneller über ${best.sid} ${STN(best.sid).short} (AG ${(k + 1) * 10})`, p: `Versandbereit ${fDay(best.eta)} statt ${fDay(sch.eta)} – ${fDurL(sch.eta - best.eta)} früher, Maschinenkosten ${best.dCost >= 0 ? '+' : '−'}${eur(Math.abs(best.dCost), 0)}.`, act: { label: 'Übernehmen', act: 'alt', k, sid: best.sid } });
    });
    for (const x of c.imp) {
      if (x.delay < 15 * 60 || x.slack == null) continue;
      if (x.slack >= 0 && x.after < 0) H.push({ sev: 'warn', ic: 'alert', t: `Gefährdet ${x.orderId} (${x.part})`, p: `Einlastung schiebt AG ${x.seq} auf ${x.station} um bis zu ${fDurL(x.delay)} – Puffer bis Termin nur ${fDurL(x.slack)}.` });
    }
    const chg = [];
    let stockWarn = null;
    q.routing.forEach((r) => {
      if (r.station === 'EXT') return;
      for (const u of toolUse(r, c.qty)) {
        if (!u.changes) continue;
        chg.push(`${r.station} ${toolShort(u.tt.name)} alle ${nf(u.perEdge)} Teile (${u.changes}×)`);
        const ts = S().toolStock && S().toolStock[u.type];
        if (ts && ts.ready + ts.regrind < u.changes && !stockWarn) stockWarn = { u, ts, r };
      }
    });
    if (chg.length) H.push({ sev: 'info', ic: 'wrench', t: 'Werkzeugwechsel im Los eingeplant', p: chg.slice(0, 4).join(' · ') + (chg.length > 4 ? ' …' : '') + ' – jeder Wechsel wird dem Einrichter mit Uhrzeit angekündigt.' });
    if (stockWarn) H.push({ sev: 'warn', ic: 'wrench', t: `Werkzeugausgabe knapp: ${toolShort(stockWarn.u.tt.name)}`, p: `${stockWarn.ts.ready} vermessen + ${stockWarn.ts.regrind} im Nachschliff, benötigt ${stockWarn.u.changes} Wechsel – rechtzeitig nachbestellen (${eur(stockWarn.u.tt.cost, 0)} je Stück).` });
    for (const s of sch.steps) {
      if (s.kind !== 'machine' || !s.auto) continue;
      const off = (s.end - s.runStart) - workSpans(s.runStart, s.end).reduce((a, w) => a + (w[1] - w[0]), 0);
      if (off > 2 * 3600) { H.push({ sev: 'ok', ic: 'bolt', t: `${s.station} ${STN(s.station).short} läuft unbemannt weiter`, p: `Ca. ${fDurL(off)} Bearbeitung außerhalb der Schichten (Geisterschicht) – Standzeiten und Material werden vorher geprüft.` }); break; }
    }
    for (const s of sch.steps) if (s.kind === 'ext') H.push({ sev: 'info', ic: 'truck', t: `Fremdbearbeitung: ${s.partner || 'Partner'}`, p: `${s.process || ''} – Abholung ${fRel(s.pickup)}, zurück ${fRel(s.lastRet)}${s.lots > 1 ? ` (${s.lots} Lose à ${s.lot} Stk)` : ''}. Spedition Mo–Fr 06:00–20:00.` });
    for (const n of q.notes || []) H.push({ sev: 'info', ic: 'sparkles', t: q.source === 'claude' ? 'Hinweis von Claude' : 'Hinweis aus der Analyse', p: n });
    if (q.repairs && q.repairs.length) H.push({ sev: 'warn', ic: 'wrench', t: 'KI-Vorschlag geprüft und angepasst', p: q.repairs.slice(0, 6).join(' · ') + (q.repairs.length > 6 ? ` · (+${q.repairs.length - 6})` : '') });
    if (q.source === 'claude' && q.confidence != null && q.confidence < 0.6) H.push({ sev: 'warn', ic: 'eye', t: 'Zeichnung nur teilweise lesbar', p: `Sicherheit laut Claude ${U.fmtPct(q.confidence)} – Maße und Zeiten vor der Freigabe prüfen.` });
    return H.map((h, i) => Object.assign(h, { i })).sort((a, b) => SEVO[a.sev] - SEVO[b.sev] || a.i - b.i);
  }

  // ------------------------------------------------------------------ Gerüst
  function mount(el) {
    root = el;
    css(CSS, 'ki-auftrag');
    root.classList.add('ka-root');
    root.innerHTML = `
      <header class="view-h">
        <div><h1 class="view-t">KI-Auftrag</h1>
          <p class="view-sub">Zeichnung rein → Arbeitsplan, Zeit, Preis und Liefertermin raus → mit einem Klick einlasten.</p></div>
        <div class="ka-hr"><span class="ka-ai" data-r="ai" data-s="checking"><i></i><span>Claude: Verbindung wird geprüft</span></span></div>
      </header>
      <div class="ka-grid">
        <div class="ka-left">
          <section class="card" data-r="srcCard">
            <div class="ka-card-h"><h3>Zeichnung</h3><span class="muted" data-r="srcHint">Beispiel wählen oder eigene Zeichnung ablegen</span><button type="button" class="btn sm ghost" data-act="zoom" data-r="zoomBtn" title="Zeichnung vergrößern">${icon('search', 14)} Vergrößern</button></div>
            <div class="ka-srcgrid"><div class="card-b ka-srcA">
              <div class="ka-exs" data-r="exs"></div>
              <div class="ka-stage" data-r="stage"></div>
              <div class="ka-sinfo" data-r="sinfo"></div>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" data-r="file" hidden>
            </div><div class="ka-srcB">
            <div class="ka-subh"><h3>Anfrage</h3><span class="muted">auch nach der Analyse änderbar</span></div>
            <div class="ka-form">
              <label class="field">Kunde<input class="input" data-r="cust" list="ka-cust" maxlength="60" autocomplete="off" data-focus="cust"></label>
              <label class="field">Menge (Stk)<span class="ka-qty"><button type="button" data-act="qm" aria-label="Menge verringern">−</button><input class="input" type="number" min="1" max="100000" step="1" inputmode="numeric" data-r="qty" data-focus="qty"><button type="button" data-act="qp" aria-label="Menge erhöhen">+</button></span></label>
              <datalist id="ka-cust" data-r="custList"></datalist>
              <label class="field">Wunschtermin des Kunden<span class="ka-due"><select class="input" data-r="dueDay" data-focus="dueDay" aria-label="Tag"></select><select class="input" data-r="dueTime" data-focus="dueTime" aria-label="Uhrzeit"></select></span></label>
              <div class="field">Priorität<div class="seg ka-seg" data-r="prio"><button type="button" data-act="prio" data-v="normal">Normal</button><button type="button" data-act="prio" data-v="eil">Eilauftrag</button></div></div>
            </div>
            <div class="ka-go" data-r="go"></div>
            </div></div>
          </section>
          <section class="card ka-recent" data-r="recent" hidden></section>
        </div>
        <div class="ka-right">
          <div data-r="ban" hidden></div>
          <section class="card" data-r="empty"></section>
          <section class="card ka-flow" data-r="flow" hidden></section>
          <section class="card" data-r="wait" hidden></section>
          <section class="card" data-r="err" hidden></section>
          <section class="card ka-sec" data-r="sPart" hidden></section>
          <section class="card ka-sec" data-r="sRoute" hidden></section>
          <section class="card ka-sec" data-r="sCalc" hidden></section>
          <section class="card ka-sec" data-r="sTermin" hidden></section>
          <section class="card ka-sec" data-r="sHints" hidden></section>
          <div class="ka-foot" data-r="foot" hidden></div>
        </div>
      </div>`;
    R = refs(root);
    const custs = [...new Set(P().orders.map(o => o.customer).concat(EXAMPLES.map(e => e.defaults.customer)))].sort();
    R.custList.innerHTML = custs.map(c => `<option value="${esc(c)}">`).join('');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('mouseover', onHover);
    root.addEventListener('mouseout', onHover);
    root.addEventListener('mousemove', onTip);
    root.addEventListener('mouseleave', () => tip(null));
    const card = R.srcCard;
    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); R.stage.classList.add('drag'); } }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, (e) => { if (ev === 'dragleave' && card.contains(e.relatedTarget)) return; R.stage.classList.remove('drag'); }));
    card.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
    R.file.addEventListener('change', () => { const f = R.file.files && R.file.files[0]; if (f) handleFile(f); R.file.value = ''; });
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { const w = R.sTermin.clientWidth; if (Math.abs(w - lastW) > 8 && calc && shown.sTermin) { lastW = w; renderSections(); } });
      ro.observe(R.sTermin);
    }
    window.addEventListener('resize', () => updateStick());
    WF.bus.on('sim:reset', () => { placed = null; if (quote) { recalc(); renderSections(); } renderRecent(); dayKey = -1; renderDue(true); });
    selectExample('flanschwelle', true);
    initAI();
  }

  // ------------------------------------------------------------------ Eingabe: Beispiele, Upload, Bühne
  function renderExamples() {
    const s = ui.src;
    R.exs.innerHTML = EXAMPLES.map(ex => `<button type="button" class="ka-ex${s.kind === 'example' && s.id === ex.id ? ' on' : ''}" data-act="ex" data-id="${ex.id}" title="${esc(ex.title + ' – ' + ex.sub)}">
        <span class="th">${ex.draw(' aria-hidden="true" preserveAspectRatio="xMidYMid slice"', ex.thumb)}</span><b>${esc(ex.title)}</b></button>`).join('') +
      `<button type="button" class="ka-ex up${s.kind === 'upload' ? ' on' : ''}" data-act="up" title="${ai.state === 'off' ? 'Eigene Zeichnungen wertet Claude aus – verfügbar, wenn werkfluss auf claude.ai läuft' : 'Eigene Zeichnung als Bild oder PDF hochladen'}"><span class="th">${icon('upload', 18)}<span style="font-size:10.5px">Bild / PDF</span></span><b>${ui.upload ? esc(ui.upload.name) : 'Eigene Zeichnung'}</b>${ai.state === 'off' ? '<span class="ka-tag">nur mit Claude</span>' : ''}</button>`;
  }
  function selectExample(id, first) {
    const ex = exById(id); if (!ex) return;
    cancelRun();
    ui.src = { kind: 'example', id }; ui.notice = null;
    applyDefaults(ex);
    resetResult();
    renderExamples(); renderStage(); syncForm(); renderGo(); renderOut();
    R.srcHint.textContent = ex.sub;
  }
  function handleFile(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const isImg = /^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '');
    if (!isPdf && !isImg) { WF.app.toast('Bitte eine Zeichnung als Bild (PNG, JPG, WebP) oder PDF wählen.', 'warn', { title: 'Dateityp nicht unterstützt' }); return; }
    if (file.size > 25 * 1024 * 1024) { WF.app.toast('Die Datei ist größer als 25 MB.', 'warn', { title: 'Datei zu groß' }); return; }
    cancelRun();
    if (ui.upload && ui.upload.url) { try { URL.revokeObjectURL(ui.upload.url); } catch (e) { /* egal */ } }
    ui.upload = { kind: isPdf ? 'pdf' : 'image', file, name: file.name || 'Zeichnung', size: file.size, type: file.type, url: isImg ? URL.createObjectURL(file) : null, w: 0, h: 0 };
    if (ui.src.kind !== 'upload') { ui.customer = ''; R.cust.value = ''; }
    ui.src = { kind: 'upload' }; ui.notice = ai.state === 'off' ? 'offline' : null;
    resetResult();
    renderExamples(); renderStage(); renderGo(); renderOut();
    R.srcHint.textContent = (isPdf ? 'PDF' : 'Bild') + ' · ' + (file.name || '');
  }
  function renderStage() {
    const s = ui.src, box = R.stage;
    R.zoomBtn.hidden = !(s.kind === 'example' || (ui.upload && ui.upload.kind === 'image' && s.kind === 'upload'));
    box.classList.remove('drag');
    if (s.kind === 'example') {
      const ex = exById(s.id);
      box.className = 'ka-stage';
      box.innerHTML = ex.draw(` class="ka-dwg" role="img" aria-label="Technische Zeichnung ${esc(ex.title)}"`) + `<div class="ka-ov"></div><div class="ka-scan" hidden></div>`;
      R.sinfo.innerHTML = ''; R.sinfo.hidden = true;
    } else if (ui.upload && ui.upload.kind === 'image') {
      box.className = 'ka-stage';
      box.innerHTML = `<div class="ka-imgbox"><img src="${ui.upload.url}" alt="Hochgeladene Zeichnung"><div class="ka-ov"></div><div class="ka-scan" hidden></div></div>`;
      const img = box.querySelector('img');
      img.onload = () => { ui.upload.w = img.naturalWidth; ui.upload.h = img.naturalHeight; renderSinfo(); updateStick(); };
      renderSinfo();
    } else if (ui.upload && ui.upload.kind === 'pdf') {
      box.className = 'ka-stage';
      box.innerHTML = `<div class="ka-pdf"><span class="ic">PDF</span><b>${esc(ui.upload.name)}</b><span class="muted">${nf(ui.upload.size / 1024)} KB · Vorschau im Browser nicht verfügbar</span><span class="muted" style="max-width:44ch">Claude liest Zeichnungen hier als Bild. Bitte die Seite als PNG/JPG exportieren oder ein Foto der Zeichnung hochladen.</span></div>`;
      renderSinfo();
    } else {
      box.className = 'ka-stage';
      box.innerHTML = `<div class="ka-drop" data-act="pick">${icon('upload', 26)}<b>Zeichnung hier ablegen</b><span>oder klicken, um eine Datei zu wählen</span><span class="faint">PNG, JPG, WebP oder PDF · auch ein Handyfoto der Zeichnung</span></div>`;
      R.sinfo.innerHTML = ''; R.sinfo.hidden = true;
    }
    renderStageFx();
    updateStick();
  }
  function renderSinfo() {
    const u = ui.upload; if (!u) { R.sinfo.innerHTML = ''; R.sinfo.hidden = true; return; }
    R.sinfo.hidden = false;
    R.sinfo.innerHTML = `<span class="chip">${esc(u.name.length > 34 ? u.name.slice(0, 32) + '…' : u.name)}</span><span class="chip">${u.w ? u.w + ' × ' + u.h + ' px · ' : ''}${nf(u.size / 1024)} KB</span><span class="spacer"></span><button type="button" class="btn sm ghost" data-act="pick">${icon('refresh', 14)} Andere Datei</button>`;
  }
  function markerHtml() {
    if (!quote || !run || run.stage < 1 || run.error) return '';
    let n = 0;
    return quote.features.map((f, i) => f.pos ? `<span class="ka-mk" data-fi="${i}" style="left:${(f.pos[0] * 100).toFixed(2)}%;top:${(f.pos[1] * 100).toFixed(2)}%;animation-delay:${(n++) * 90}ms" title="${esc(f.text + ' – ' + (f.detail || ''))}">${i + 1}</span>` : '').join('');
  }
  function renderStageFx() {
    const scan = R.stage.querySelector('.ka-scan'), ov = R.stage.querySelector('.ka-ov');
    if (scan) scan.hidden = !(run && run.stage === 0 && !run.error && !run.done);
    if (ov) { const h = markerHtml(); if (ov._h !== h) { ov._h = h; ov.innerHTML = h; } }
  }
  function renderGo() {
    const s = ui.src, busy = run && !run.done && !run.error;
    const live = !!ai.sampler && ai.state !== 'off';
    const exMode = s.kind === 'example' && live;
    const useLive = s.kind === 'upload' ? live : exMode && ui.mode === 'live';
    let hint;
    if (busy) hint = run.live ? 'Antworten mit Bild dauern meist 20–60 s' : 'Auswertung läuft …';
    else if (s.kind === 'upload' && !ui.upload) hint = 'Zuerst eine Zeichnung ablegen oder auswählen.';
    else if (s.kind === 'upload' && !live) hint = ai.state === 'checking' ? 'Verbindung zu Claude wird geprüft …' : 'Eigene Zeichnungen wertet Claude aus, wenn werkfluss auf claude.ai läuft. Hier ohne Claude-Verbindung: mit einer der drei Beispielzeichnungen weiterrechnen.';
    else if (useLive) hint = ai.img ? 'Claude liest die Zeichnung · Preis und Termin rechnet werkfluss live' : 'Claude liest den Zeichnungstext · Preis und Termin rechnet werkfluss live';
    else hint = 'Vorberechnete Auswertung · Preis, Material und Termin live aus der Belegung';
    put(R.go, `${exMode ? `<div class="ka-mode"><span>Auswertung</span><div class="seg"><button type="button" data-act="mode" data-v="live" class="${ui.mode === 'live' ? 'on' : ''}">${icon('sparkles', 12)} Claude live</button><button type="button" data-act="mode" data-v="demo" class="${ui.mode === 'demo' ? 'on' : ''}">Vorberechnet</button></div></div>` : ''}
      <div class="ka-gorow">${busy
        ? `<button type="button" class="btn primary ka-gobtn" disabled><span class="spin"></span>Analysiere …</button>${run.live ? `<button type="button" class="btn ka-gobtn" style="flex:0 0 auto" data-act="stop">Abbrechen</button>` : ''}`
        : s.kind === 'upload' && ui.upload && !live && ai.state !== 'checking'
          ? `<button type="button" class="btn ka-gobtn ka-goff" disabled title="Die Auswertung eigener Zeichnungen braucht Claude">${icon('sparkles', 16)}Analyse nur mit Claude</button><button type="button" class="btn primary ka-gobtn" data-act="exgo" title="Flanschwelle (Beispiel) vorberechnet auswerten – Preis und Termin live">${icon('arrowRight', 16)}Mit Beispiel weiterrechnen</button>`
          : `<button type="button" class="btn primary ka-gobtn" data-act="go">${icon('sparkles', 17)}${quote ? 'Erneut analysieren' : 'Analysieren'}</button>`}</div>
      <div class="ka-gohint">${icon('info', 14)}<span>${esc(hint)}</span></div>`);
    updateStick();
  }
  function renderAI() {
    const n = R.ai; if (!n) return;
    const txt = { checking: 'Claude: Verbindung wird geprüft', ready: 'Claude verbunden · liest Zeichnungen', noimg: 'Claude verbunden · ohne Bildfreigabe', off: 'Ohne Claude · vorberechnete Beispiele' }[ai.state];
    n.dataset.s = ai.state; n.title = ai.state === 'off' ? 'Auf claude.ai veröffentlicht liest Claude die Zeichnung live. Hier: vorberechnete Auswertung der drei Beispiele; Preis und Termin werden trotzdem live gerechnet.' : '';
    n.innerHTML = `<i></i><span>${esc(txt)}</span>`;
    if (R.exs) renderExamples();
    if (ui.src.kind === 'upload' && ui.upload && ai.state === 'off' && !run) ui.notice = 'offline';
    renderGo();
    if (!run) renderOut();
  }
  async function initAI() {
    let s = null;
    try {
      if (WF.ai && typeof WF.ai.getSample === 'function') s = await WF.ai.getSample();
      else if (window.claude && typeof window.claude.use === 'function') s = await window.claude.use('sample');
    } catch (e) { s = null; }
    ai.sampler = typeof s === 'function' || (s && typeof s.json === 'function') ? s : null;
    ai.img = null;
    if (ai.sampler && typeof ai.sampler.limits === 'function') {
      try { const lim = await ai.sampler.limits(); ai.img = lim && lim.images ? lim.images : null; } catch (e) { ai.img = null; }
    }
    ai.state = !ai.sampler ? 'off' : ai.img ? 'ready' : 'noimg';
    renderAI();
  }

  // ------------------------------------------------------------------ Analyse
  function resetResult() { quote = null; run = null; calc = null; placed = placed && S().orders[placed.id] ? placed : null; for (const k in html) if (/^s|^flow|^foot|^ban/.test(k)) delete html[k]; }
  function cancelRun() { if (run && run.ctl) { try { run.ctl.abort(); } catch (e) { /* egal */ } } if (run && !run.done) run.cancelled = true; }
  function prepDemo(ex) {
    const r = clone(ex.result);
    r.features.forEach(f => { if (f.pos) f.pos = [f.pos[0] / 297, f.pos[1] / 210]; });
    return r;
  }
  let uidSeq = 0;
  function finalize(q, source, src) {
    q.uid = ++uidSeq; q.source = source; q.src = src; q.t = S().t;
    q.routing.forEach(r => { r.orig = { station: r.station, setupMin: r.setupMin, cycleMin: r.cycleMin }; });
    q.routing.forEach((r, k) => { r.alts = altFor(q, k); });
    return q;
  }
  async function claudeAnalyze(src, myRun) {
    let withImage = !!ai.img;
    let images = null;
    if (withImage) {
      if (src.kind === 'example') {
        // Beispiel als PNG; gelingt das in einer Sandbox nicht, bekommt Claude den Zeichnungsinhalt als Text
        try { images = [await svgToPng(exById(src.id).draw(' width="1600" height="1131"'), 1600)]; } catch (e) { images = null; withImage = false; }
      }
      else {
        const lim = ai.img, f = ui.upload.file;
        if (lim.mediaTypes && lim.mediaTypes.length && !lim.mediaTypes.includes(f.type)) throw { code: 'image_rejected', message: 'type' };
        images = [await shrinkImage(f, lim.maxInputBytes)];
      }
    }
    const prompt = promptFor(src, ui.qty, withImage);
    const opts = { modelTier: 'default', signal: myRun.ctl.signal, onText: (x) => { myRun.chars = (x && x.text ? x.text.length : 0); } };
    if (images) opts.images = images;
    if (typeof ai.sampler.json !== 'function') throw { code: 'capability_removed', message: 'json' };
    return await ai.sampler.json(prompt, opts);
  }
  async function analyze(opt = {}) {
    if (run && !run.done && !run.error) return;
    const src = Object.assign({}, ui.src);
    const live = !!ai.sampler && ai.state !== 'off';
    if (src.kind === 'upload') {
      if (!ui.upload) { R.file.click(); return; }
      if (!live) { ui.notice = 'offline'; run = null; renderOut(); return; }
      if (ui.upload.kind === 'pdf') { ui.notice = 'pdf'; run = null; renderOut(); return; }
      if (!ai.img) { ui.notice = 'noimg'; run = null; renderOut(); return; }
    }
    ui.notice = null;
    const useLive = !opt.demo && live && (src.kind === 'upload' || ui.mode === 'live');
    const myRun = run = { stage: 0, t0: performance.now(), live: useLive, src, chars: 0, ctl: useLive ? new AbortController() : null, done: false, error: null };
    quote = null; calc = null;
    renderOut(); renderStageFx(); renderGo();
    try {
      let q;
      if (useLive) {
        const raw = await claudeAnalyze(src, myRun);
        if (run !== myRun || myRun.cancelled) return;
        q = finalize(validate(raw, { qty: ui.qty }), 'claude', src);
        if (src.kind === 'upload' && q.part.customer && !ui.customer.trim()) { ui.customer = q.part.customer; R.cust.value = ui.customer; }
      } else {
        await sleep(1250);
        if (run !== myRun || myRun.cancelled) return;
        q = finalize(validate(prepDemo(exById(src.id)), { qty: ui.qty }), 'demo', src);
      }
      myRun.ms = performance.now() - myRun.t0;
      quote = q;
      recalc();
      const dur = [0, 800, 850, 700, 700];
      for (let st = 1; st <= 5; st++) {
        myRun.stage = st;
        renderOut(st); renderStageFx();
        if (st < 5) await sleep(dur[st]);
        if (run !== myRun || myRun.cancelled) return;
      }
      myRun.done = true;
      renderOut(); renderGo();
    } catch (e) {
      if (run !== myRun) return;
      const code = (e && e.code) || 'upstream_error';
      if (code === 'cancelled' || myRun.cancelled) { run = null; renderOut(); renderStageFx(); renderGo(); return; }
      myRun.error = { code, msg: AI_MSG[code] || (e && e.message) || 'Unbekannter Fehler', raw: e && e.text ? String(e.text).slice(0, 400) : '' };
      if (AI_HIDE[code]) { ai.state = 'off'; ai.sampler = null; renderAI(); }
      if (code === 'images_unavailable') { ai.img = null; ai.state = 'noimg'; renderAI(); }
      renderOut(); renderStageFx(); renderGo();
    }
  }

  // ------------------------------------------------------------------ Ergebnis: Rahmen
  const STEPS = [
    { t: 'Zeichnung lesen', s: 'Lesen', ic: 'eye' }, { t: 'Merkmale', s: 'Merkmale', ic: 'target' }, { t: 'Arbeitsplan', s: 'Plan', ic: 'route' },
    { t: 'Kalkulation', s: 'Preis', ic: 'euro' }, { t: 'Termin', s: 'Termin', ic: 'clock' },
  ];
  function stepSub(i) {
    const st = run.stage, q = quote, c = calc;
    if (run.error && i === st) return 'abgebrochen';
    if (i === 0) {
      if (st === 0) { const sec = (performance.now() - run.t0) / 1000; return run.live ? `Claude · ${nf(Math.floor(sec))} s${run.chars ? ' · ' + nf(run.chars) + ' Zeichen' : ''}` : 'liest …'; }
      return run.live ? 'Claude · ' + secTxt(run.ms || 0) : 'erkannt';
    }
    if (st < i) return '';
    if (st === i && !run.done) return ['', 'werden markiert …', 'wird geplant …', 'wird gerechnet …', 'aus der Belegung …'][i];
    if (!q || !c) return '';
    if (i === 1) { const cr = q.features.filter(f => f.critical).length; return `${q.features.length} Merkmale · ${cr} kritisch`; }
    if (i === 2) return `${q.routing.length + 1} Arbeitsgänge`;
    if (i === 3) return `${eur(c.pr.unit)} je Stk`;
    if (i === 4) return 'frühestens ' + fDay(c.sch.eta);
    return '';
  }
  function summaryHtml() {
    if (!run.done || !quote || !calc) return '';
    const c = calc, w = c.wunsch, now = S().t;
    const ws = !w || w <= now ? '' : w >= c.sch.eta ? `Wunschtermin ${fDay(w)} <b class="ok">erreichbar</b>` : `Wunschtermin ${fDay(w)} <b class="bad">nicht erreichbar</b>`;
    const open = c.hints.filter(h => h.sev === 'crit' || h.sev === 'warn').length;
    const parts = [`<b>${esc(quote.part.name)}</b> · ${nf(c.qty)} Stk`, `<b>${eur(c.pr.unit)}</b> je Stk (${eur(c.pr.total, 0)})`, `frühestens <b>${esc(fDay(c.sch.eta))}</b>`];
    if (ws) parts.push(ws);
    parts.push(open ? `<b class="warn">${open} ${open === 1 ? 'Punkt' : 'Punkte'} zu klären</b>` : '<b class="ok">nichts Kritisches</b>');
    return `<div class="ka-sum">${icon('sparkles', 14)}<span>${parts.join('<i>·</i>')}</span></div>`;
  }
  function flowHtml() {
    const st = run.stage;
    return `<div class="ka-steps">${STEPS.map((s, i) => {
      const cls = run.error && i === st ? 'err' : (run.done || i < st) ? 'done' : i === st ? 'act' : '';
      return `<div class="ka-st ${cls}"><span class="d">${cls === 'done' ? icon('check', 16) : cls === 'err' ? icon('x', 16) : icon(s.ic, 16)}</span><b><span class="lg">${s.t}</span><span class="sm">${s.s}</span></b><small>${esc(stepSub(i))}</small></div>`;
    }).join('')}</div>${summaryHtml()}`;
  }
  function waitHtml() {
    const sec = Math.floor((performance.now() - run.t0) / 1000);
    const sk = '<div><i class="h"></i><i style="width:80%"></i><i style="width:64%"></i><i style="width:72%"></i><i style="width:45%"></i></div><div><i style="width:90%"></i><i style="width:86%"></i><i style="width:92%"></i><i style="width:78%"></i><i style="width:84%"></i></div>';
    const p = run.live
      ? `${ai.img ? 'Zeichnung als Bild' : 'Zeichnungsinhalt'} und Werksdaten gesendet (${P().machines.length} Arbeitsplätze, ${P().toolTypes.length} Werkzeugtypen, Lagermaterial) · ${sec} s · ${run.chars ? 'Antwort kommt: ' + nf(run.chars) + ' Zeichen' : 'Claude denkt nach'}`
      : 'Schriftfeld, Bemaßung, Toleranzen, Oberflächen und Hinweise';
    return `<div class="ka-wait"><div class="hd"><span class="sp"></span><div><b>${run.live ? 'Claude liest die Zeichnung' : 'Zeichnung wird gelesen'}</b><p>${esc(p)}</p></div>${run.live ? '<button type="button" class="btn sm" data-act="stop">Abbrechen</button>' : ''}</div><div class="ka-sk">${sk}</div></div>`;
  }
  function updateStick() {
    const left = root && root.querySelector('.ka-left'); if (!left) return;
    const view = root.closest('.view') || root;
    left.classList.toggle('stick', left.offsetHeight <= view.clientHeight - 30);
  }
  function renderOut(reveal) {
    if (!root) return;
    if (!run) { vis(R.wait, false); vis(R.err, false);
      put(R.empty, ui.notice ? noticeHtml(ui.notice) : emptyHtml()); vis(R.empty, true);
      ['flow', 'sPart', 'sRoute', 'sCalc', 'sTermin', 'sHints', 'foot'].forEach(k => vis(R[k], false));
      renderBanner(); return;
    }
    put(R.flow, flowHtml()); vis(R.flow, true, reveal === undefined && run.stage === 0);
    const waiting = run.stage === 0 && !run.error && !run.done;
    if (waiting) put(R.wait, waitHtml());
    vis(R.wait, waiting, true);
    vis(R.empty, false);
    if (run.error) {
      put(R.err, errorHtml()); vis(R.err, true, true);
      ['sPart', 'sRoute', 'sCalc', 'sTermin', 'sHints', 'foot'].forEach(k => vis(R[k], false));
      return;
    }
    vis(R.err, false);
    if (quote && !calc) recalc();
    renderSections(reveal);
  }
  function renderSections(reveal) {
    if (!run || !quote || !calc || run.error) return;
    const st = run.stage;
    const secs = [['sPart', 1, partHtml], ['sRoute', 2, routeHtml], ['sCalc', 3, calcHtml], ['sTermin', 4, terminHtml], ['sHints', 5, hintsHtml], ['foot', 5, footHtml]];
    for (const [k, need, fn] of secs) {
      if (st < need) { vis(R[k], false); continue; }
      const first = !shown[k];
      if (k === 'sTermin') { lastW = R.sTermin.clientWidth || lastW; }
      put(R[k], fn(first && reveal === need));
      vis(R[k], true, reveal === need);
    }
    put(R.flow, flowHtml());
    renderBanner();
  }

  /** Materialbalken – dieselbe Rechnung wie der Hinweis (matInfo): Verbrauch in Plan-Reihenfolge über Bestand + offene Bestellungen.
      Rot („fehlt“) nur, wenn Bestand und alle Bestellungen nach den vorher eingeplanten Aufträgen nicht reichen. */
  function stockHtml(m) {
    const mt = m.mt, onH = Math.max(0, mt.onHand), now = S().t;
    const sumOpen = m.open.reduce((a, p) => a + p.qty, 0), supply = onH + sumOpen;
    const freeS = Math.max(0, m.free), freeE = Math.max(0, m.freeAtStart), freeAll = Math.max(0, m.free + sumOpen);
    const A = Math.min(m.resBefore, supply);                                   // vorher eingeplante Aufträge
    const B = Math.min(m.need, freeS);                                         // dieser Auftrag aus dem Lager
    const C = Math.min(m.need - B, Math.max(0, freeE - freeS));                // … aus Bestellungen vor dem Planstart
    const L = Math.min(m.need - B - C, Math.max(0, freeAll - freeE));          // … aus Bestellungen nach dem Planstart
    const M = Math.max(0, m.need - B - C - L);                                 // nicht gedeckt (nur bei nötiger Bestellung)
    const resAfter = m.laterList.reduce((a, x) => a + x.amount, 0);
    const E = Math.min(resAfter, Math.max(0, supply - A - B - C - L));         // später eingeplante Aufträge
    const F = Math.max(0, supply - A - B - C - L - E);                         // frei danach
    const scale = Math.max(supply + M, mt.min) * 1.04 || 1, pc = (x) => (x / scale * 100).toFixed(2) + '%';
    const hatch = (c) => `repeating-linear-gradient(135deg,${c} 0 3px,color-mix(in srgb,${c} 35%,transparent) 3px 6px)`;
    const seg = (x, bg, tip) => (x > 1e-6 ? `<i style="width:${pc(x)};background:${bg}" title="${esc(tip)}"></i>` : '');
    const ids = (l) => l.map(x => x.id).join(', ');
    const buyTxt = (list) => list.map(p => `${p.id} (${fRel(p.etaT)})`).join(', ');
    const early = (m.early || []).slice(), late = m.open.filter(p => !early.includes(p));
    const lg = [];
    if (A > 1e-6) lg.push(`<span><i style="background:var(--line2)"></i>vorher eingeplant ${qtyU(m.resBefore, mt)} (${esc(ids(m.before))})</span>`);
    lg.push(`<span><i style="background:var(--mat)"></i>dieser Auftrag ${qtyU(m.need, mt)}${B > 1e-6 && (C + L) > 1e-6 ? ` – ${qtyU(B, mt)} aus dem Lager` : B > 1e-6 ? ' aus dem Lager' : ''}</span>`);
    if (C > 1e-6) lg.push(`<span><i style="background:${hatch('var(--mat)')}"></i>${qtyU(C, mt)} aus ${esc(buyTxt(early))}</span>`);
    if (L > 1e-6) lg.push(`<span class="w"><i style="background:${hatch('var(--mat)')}"></i>${qtyU(L, mt)} aus ${esc(buyTxt(late))} – nach dem Planstart</span>`);
    if (M > 1e-6) lg.push(`<span class="x"><i style="background:var(--st-fault)"></i>fehlt ${qtyU(M, mt)} – Bestellung nötig</span>`);
    if (E > 1e-6) lg.push(`<span><i style="background:${hatch('var(--line2)')}"></i>später eingeplant ${qtyU(resAfter, mt)} (${esc(ids(m.laterList))})</span>`);
    lg.push(`<span><i style="background:color-mix(in srgb,var(--st-run) 45%,transparent)"></i>frei danach ${qtyU(Math.max(0, m.after), mt)}</span>`);
    lg.push(`<span><i style="background:var(--st-wait);width:2px;border-radius:1px"></i>Mindestbestand ${qtyU(mt.min, mt)}</span>`);
    const tip = `Lagerbestand ${qtyU(onH, mt)}${sumOpen ? ' + bestellt ' + qtyU(sumOpen, mt) : ''} · vorher eingeplant ${qtyU(m.resBefore, mt)} · dieser Auftrag ${qtyU(m.need, mt)} · später eingeplant ${qtyU(resAfter, mt)}`;
    return `<div class="ka-stock" title="${esc(tip)}">
        <div class="bw"><div class="trk">${seg(A, 'var(--line2)', 'vorher eingeplant')}${seg(B, 'var(--mat)', 'dieser Auftrag aus dem Lager')}${seg(C, hatch('var(--mat)'), 'dieser Auftrag aus Bestellung (vor Planstart)')}${seg(L, hatch('var(--mat)'), 'dieser Auftrag aus Bestellung (nach Planstart)')}${seg(E, hatch('var(--line2)'), 'später eingeplant')}${seg(F, 'color-mix(in srgb,var(--st-run) 45%,transparent)', 'frei danach')}${seg(M, 'var(--st-fault)', 'fehlt')}</div>
          ${sumOpen > 1e-6 ? `<span class="oh" style="left:${pc(onH)}" title="Lagerbestand ${esc(qtyU(onH, mt))} | dahinter offene Bestellungen ${esc(qtyU(sumOpen, mt))}"></span>` : ''}<span class="mn" style="left:${pc(mt.min)}"></span></div>
        <div class="lg">${lg.join('')}</div></div>`;
  }
  // ------------------------------------------------------------------ 1 Erkanntes Teil
  function partHtml() {
    const q = quote, c = calc, m = c.mat, p = q.part;
    const badge = q.source === 'claude' ? `<span class="ka-badge ai">${icon('sparkles', 12)} Claude${run.ms ? ' · ' + secTxt(run.ms) : ''}</span>` : `<span class="ka-badge">Vorberechnete Auswertung</span>`;
    const est = q.source === 'claude' ? ' class="ka-est" title="Von Claude aus der Zeichnung geschätzt – vor Freigabe prüfen"' : '';
    let stock = '';
    if (m && !m.none) stock = stockHtml(m);
    const matTxt = m && !m.none ? `${qtyU(m.need, m.mt)}` : '–';
    const onOrd = m && !m.none ? m.open.reduce((a, x) => a + x.qty, 0) : 0;
    const matSub = m && !m.none ? `${nf(c.qty)} × ${qtyU(q.raw.perPart, m.mt)} · Bestand ${qtyU(m.mt.onHand, m.mt)}${onOrd > 1e-6 ? ' + bestellt ' + qtyU(onOrd, m.mt) : ''} · ${m.mt.location === 'RAW' ? 'Kragarmregal' : esc(m.mt.location)}` : 'kein Lagermaterial – beigestellt bzw. separat beschafft';
    let n = 0;
    const feats = q.features.map((f, i) => `<div class="ka-feat" data-fi="${i}">${f.pos ? `<span class="no">${i + 1}</span>` : `<span class="no x">–</span>`}<span class="ic" title="${esc(FEAT[f.kind] || '')}">${featIcon(f.kind)}</span><div style="min-width:0"><div class="t"><b>${esc(f.text)}</b>${f.critical ? '<span class="crit">kritisch</span>' : ''}</div><div class="d">${esc(f.detail || FEAT[f.kind] || '')}</div></div></div>`).join('');
    n = q.features.filter(f => f.critical).length;
    return `<div class="ka-sh"><span class="n">1</span><h3>Erkanntes Teil</h3><span class="m">${badge}</span></div>
      <div class="ka-part">
        <div class="ka-pmain">
          <div class="ka-pname">${esc(p.name)}</div>
          <div class="ka-psub"><span class="mono">${esc(p.drawing)}</span>${p.customer ? ' · ' + esc(p.customer) : ''}</div>
          <div class="ka-facts">
            <div class="ka-fact"><div class="l">Werkstoff</div><div class="v">${nw(p.material)}</div></div>
            <div class="ka-fact"><div class="l">Abmessung · Masse</div><div class="v">${esc(p.dims || '–')}</div><div class="s"><span${est}>${nf(p.weightKg, p.weightKg < 0.1 ? 3 : p.weightKg < 10 ? 2 : 1)} kg</span> je Teil</div></div>
            <div class="ka-fact full"><div class="l">Rohteil</div><div class="v">${esc(q.raw.text)}</div><div class="s">${q.raw.materialId ? `<span class="mono">${esc(q.raw.materialId)}</span> · ` : ''}${m && !m.none ? esc(m.mt.name) + ' · ' + esc(m.mt.supplier) : ''}</div></div>
            <div class="ka-fact full"><div class="l">Materialbedarf</div><div class="v">${matTxt}</div><div class="s">${matSub}</div>${stock}</div>
          </div>
        </div>
        <div class="ka-feats"><div class="eyebrow"><span>Merkmale aus der Zeichnung</span><span>${n} kritisch</span></div><div class="ka-fl">${feats || '<div class="empty">Keine Merkmale erkannt.</div>'}</div></div>
      </div>`;
  }

  // ------------------------------------------------------------------ 2 Arbeitsplan
  function routeHtml() {
    const q = quote, c = calc, sch = c.sch, qty = c.qty;
    const est = q.source === 'claude';
    const E = (v) => est ? `<span class="ka-est" title="Von Claude geschätzt – vor Freigabe prüfen">${v}</span>` : v;
    let sumSetup = 0, sumRun = 0;
    const rows = q.routing.map((r, k) => {
      const s = sch.steps.find(x => x.k === k), seq = (k + 1) * 10;
      if (r.station === 'EXT') {
        const lead = (r.ext && r.ext.leadMin || 0) * 60;
        return `<div class="ka-op"><span class="seq">${seq}</span><div style="min-width:0"><div class="hd"><b>${esc(r.op)}</b><span class="ka-mc ext">${icon('truck', 12)} Fremdbearbeitung</span></div>
          <div class="why">${esc((r.ext && r.ext.partner) || '')} · ${esc((r.ext && r.ext.process) || '')}</div>${r.reason ? `<div class="why">${esc(r.reason)}</div>` : ''}</div>
          <div class="ka-nums nums"><div>–<small>Rüsten</small></div><div>${E(fDurL(lead))}<small>Durchlauf</small></div><div>${s ? nf(s.lot) : '–'} Stk<small>${s && s.lots > 1 ? s.lots + ' Lose' : 'ein Los'}</small></div></div></div>`;
      }
      const sn = STN(r.station);
      const load = sn.loading === 'perPart' ? ((r.loadMin != null ? r.loadMin : sn.loadMin) || 1) : 0;
      const tot = (r.setupMin || 0) + qty * ((r.cycleMin || 0) + load);
      sumSetup += r.setupMin || 0; sumRun += qty * ((r.cycleMin || 0) + load);
      const uses = toolUse(r, qty);
      const tools = uses.map(u => `<span class="chip${u.changes ? ' chg' : ''}" title="${esc(u.tt.name)} · Standzeit ${nf(u.tt.lifeMin)} min · ${nf(u.cut, 2)} min je Teil → ${nf(u.perEdge)} Teile je Schneide · ${eur(u.tt.cost, 0)}">${esc(toolShort(u.tt.name))}<em>${u.changes ? '· ' + u.changes + '× Wechsel' : '· reicht'}</em></span>`).join('');
      let alts = '';
      if (r.alts && r.alts.length && c.altEta[k]) {
        alts = c.altEta[k].filter(x => x.sid !== r.station).map(x => `<button type="button" class="ka-altb" data-act="altsw" data-k="${k}" data-sid="${x.sid}" title="AG ${seq} auf ${x.sid} ${esc(STN(x.sid).name)} verlegen – Zeiten werden umgerechnet">${icon('refresh', 12)}${x.sid === r.orig.station ? 'zurück zu ' : ''}${x.sid} ${esc(STN(x.sid).short)} <em>→ ${esc(fDay(x.eta).replace(' (Folgewoche)', ''))}</em></button>`).join('');
      }
      const meta = [];
      if (s) meta.push(s.wait > 10 * 60 ? `<span class="w">${icon('clock', 12)}belegt bis ${esc(fRel(s.start))}</span>` : `<span>${icon('clock', 12)}frei ab ${esc(fRel(s.start))}</span>`);
      const mode = sn.type === 'washer' ? 'Korbreinigung · automatisch' : sn.type === 'cmm' ? 'Prüfung am KMG · bemannt' : sn.type === 'assembly' ? 'Handmontage · bemannt'
        : sn.loading === 'auto' ? ({ barfeeder: 'Stangenlader', pallet: 'Palettenwechsler', magazine: 'Stangenmagazin', loader: 'Portallader' }[sn.automation] || 'Automation') + ' · läuft autonom'
        : sn.loading === 'perPart' ? 'Bediener legt ein (' + minTxt(load) + ')' : 'bemannt';
      meta.push(`<span>${esc(mode)}</span>`);
      if (r.firstPiece) meta.push(`<span>Erstteilprüfung ${sn.fpiMin || 15} min</span>`);
      const changed = r.station !== r.orig.station ? ` <span class="ka-badge">geändert</span>` : '';
      return `<div class="ka-op"><span class="seq">${seq}</span><div style="min-width:0">
          <div class="hd"><b>${esc(r.op)}</b><span class="ka-mc" data-act="mc" data-id="${r.station}" style="--c:${stColor(r.station)}" title="${esc(sn.name + ' · jetzt: ' + stLabel(r.station))}"><i></i><span class="id">${r.station}</span>${esc(sn.short)}</span>${alts}${changed}</div>
          <div class="meta">${meta.join('')}</div>
          ${r.reason ? `<div class="why">${esc(r.reason)}</div>` : ''}
          ${tools ? `<div class="tl">${tools}</div>` : ''}</div>
        <div class="ka-nums nums"><div>${r.setupMin ? E(minTxt(r.setupMin)) : '–'}<small>Rüsten</small></div><div>${E(minTxt(r.cycleMin || 0))}<small>je Stk</small></div><div>${fH(tot / 60)}<small>Los ${nf(qty)} Stk</small></div></div></div>`;
    }).join('');
    const ship = `<div class="ka-op"><span class="seq">${(q.routing.length + 1) * 10}</span><div style="min-width:0"><div class="hd"><b>Versand</b><span class="ka-mc" style="--c:var(--st-run);cursor:default"><i></i><span class="id">VERSAND</span>Fertigteillager</span></div><div class="why">Ablage im Fertigteillager, Lieferschein – Abholung im Lieferfenster Mo–Fr 06:00–20:00</div></div>
      <div class="ka-nums nums"><div></div><div></div><div>${esc(fDay(sch.eta).replace(' (Folgewoche)', ''))}<small>versandbereit</small></div></div></div>`;
    const legend = est ? `<span class="ka-legend"><span class="ka-est">Wert</span> = von Claude geschätzt</span>` : `<span class="ka-legend">nur Arbeitsplätze und Werkzeugtypen dieses Werks</span>`;
    const chain = q.routing.map(r => {
      if (r.station === 'EXT') return `<span class="ka-cc ext" title="${esc((r.ext && r.ext.partner) || '')}">${icon('truck', 12)}<b>Extern</b><small>${esc(((r.ext && r.ext.process) || r.op).split(/[ ,]/)[0])}</small></span>`;
      const sn = STN(r.station);
      return `<span class="ka-cc" style="--c:${stColor(r.station)}" title="${esc(sn.name + ' · jetzt: ' + stLabel(r.station))}"><i></i><b>${r.station}</b><small>${esc(sn.short)}</small></span>`;
    }).concat([`<span class="ka-cc" style="--c:var(--st-run)"><i></i><b>Versand</b></span>`]).join(`<span class="ka-ca">${icon('arrowRight', 12)}</span>`);
    return `<div class="ka-sh"><span class="n">2</span><h3>Arbeitsplan</h3><span class="m">${legend}</span></div>
      <div class="ka-chain" aria-label="Materialfluss">${chain}</div>
      <div class="ka-oph"><span>AG</span><span>Arbeitsgang · Arbeitsplatz · Werkzeuge</span><span class="ka-nums nums"><span>Rüsten</span><span>Stückzeit</span><span>Los</span></span></div>
      ${rows}${ship}
      <div class="ka-ops-f"><span>Σ Rüsten <b>${fH(sumSetup / 60)}</b></span><span>Σ Bearbeitung <b>${fH(sumRun / 60)}</b></span><span>Durchlauf bis versandbereit <b>${fDurL(sch.eta - sch.now)}</b></span></div>`;
  }

  // ------------------------------------------------------------------ 3 Kalkulation
  function calcHtml() {
    const c = calc, p = c.pr, q = quote, qty = c.qty;
    const row = (k, f, a, cls) => `<div class="ka-cr${cls ? ' ' + cls : ''}"><div class="k">${k}${f ? `<small>${f}</small>` : ''}</div><div class="a">${a}</div></div>`;
    let h = '';
    if (p.matLine && !p.matLine.est) h += row('Material', `${nf(qty)} × ${esc(qtyU(p.matLine.perPart, { unit: p.matLine.unit }))} × ${eur(p.matLine.price)}/${esc(p.matLine.unit)}`, eur(p.mat));
    else if (p.matLine) h += row('Material (Schätzung)', `${nf(qty)} × ${eur(p.matLine.costPerPart)} Rohteil`, eur(p.mat));
    else h += row('Material', 'beigestellt bzw. separat', eur(0));
    h += row('Materialgemeinkosten', `${nf(MGK * 100)} % auf Material`, eur(p.mgk));
    h += row('Maschinen- und Prüfzeit', `${p.mach.length} Arbeitsplätze · Stundensätze laut Kostenstelle`, eur(p.machSum));
    for (const x of p.mach) {
      const f = `(${nf(x.r.setupMin || 0)} + ${nf(qty)} × ${x.load ? '(' + nf(x.r.cycleMin, 2) + ' + ' + nf(x.load, 1) + ')' : nf(x.r.cycleMin, 2)}) min = ${nf(x.min / 60, 2)} h × ${nf(x.sn.rate)} €/h`;
      h += row(`${x.r.station} ${esc(x.sn.short)}`, f, eur(x.cost), 'sub');
    }
    if (p.tools.length) {
      const per = {};
      for (const t of p.tools) per[t.tt.kind] = (per[t.tt.kind] || 0) + t.costPerPart;
      const parts = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([kd, v]) => `${(WF.sim.LABELS.toolKind || {})[kd] || kd} ${eur(v)}`).join(' · ');
      h += row('Werkzeugverschleiß', `${nf(qty)} × ${eur(p.toolPer)} je Teil (Schnittzeit ÷ Standzeit × Preis) · ${parts}`, eur(p.toolSum));
    }
    for (const x of p.ext) {
      h += row(`Fremdbearbeitung`, `${esc(x.rt.label)}: ${nf(qty)} × (${nf(q.part.weightKg, 2)} kg × ${eur(x.rt.perKg)} + ${eur(x.rt.perPc)})${x.minApplied ? ` → Mindestpreis ${eur(x.rt.min, 0)}` : ''} · Richtpreis`, eur(x.cost));
    }
    h += row('Herstellkosten', '', eur(p.hk), 'sum');
    h += row(`Zuschlag ${nf(p.zus * 100)} %`, 'Verwaltung, Vertrieb, Wagnis und Gewinn', eur(p.z));
    if (p.e) h += row('Eilzuschlag 15 %', 'Vorrang in der Fertigung, verschiebt andere Aufträge', eur(p.e));
    h += row('Angebotspreis netto', `${nf(qty)} Stk × ${eur(p.unit)}`, eur(p.total), 'sum tot');
    const maxU = Math.max(...c.stf.map(x => x.unit));
    const stf = c.stf.map(x => `<button type="button" class="${x.cur ? 'cur' : ''}" data-act="stf" data-n="${x.n}" title="Menge auf ${nf(x.n)} Stk setzen"><span class="q">${nf(x.n)} Stk</span><span class="b"><i style="width:${(x.unit / maxU * 100).toFixed(1)}%"></i></span><span class="p">${eur(x.unit)}</span></button>`).join('');
    const zs = ZUS_OPTS.map(z => `<button type="button" data-act="zus" data-v="${z}" class="${Math.abs(z - ui.zus) < 1e-6 ? 'on' : ''}">${nf(z * 100)} %</button>`).join('');
    return `<div class="ka-sh"><span class="n">3</span><h3>Kalkulation</h3><span class="m">Zuschlagskalkulation · alle Werte netto</span></div>
      <div class="ka-calc"><div class="ka-cl">${h}</div>
        <div class="ka-price">
          <div><div class="eyebrow">Preis je Stück</div><div class="big">${eur(p.unit)}</div><div class="tot">Angebotssumme <b>${eur(p.total)}</b> für ${nf(qty)} Stk</div></div>
          <div class="ka-zrow"><span>Zuschlag</span><div class="seg">${zs}</div></div>
          <div><div class="eyebrow" style="margin-bottom:6px">Staffelpreise je Stück</div><div class="ka-stf">${stf}</div></div>
        </div></div>`;
  }

  // ------------------------------------------------------------------ 4 Liefertermin
  function terminHtml(anim) {
    const c = calc, sch = c.sch, now = S().t;
    const w = c.wunsch;
    let wState, wCls = '';
    if (!w) wState = 'kein Wunschtermin angegeben';
    else if (w <= now) { wState = 'liegt in der Vergangenheit'; wCls = ' warn'; }
    else if (w < sch.eta) { wState = `<b>nicht erreichbar</b> · ${fDurL(sch.eta - w)} zu spät`; wCls = ' crit'; }
    else if (w < c.zus) { wState = `<b>knapp</b> · Puffer ${fDurL(w - sch.eta)}`; wCls = ' warn'; }
    else wState = `<b>erreichbar</b> · Puffer ${fDurL(w - sch.eta)}`;
    // Wert = Tag und Uhrzeit; „Folgewoche“ steht in der Zeile darunter (die Kennzahl bleibt einzeilig)
    const wk = (t) => Math.floor(t / WEEK) !== Math.floor(now / WEEK);
    const kv = (t) => esc(DAYS[Math.floor(t / DAY) % 7] + ' ' + fClock(t));
    const ks = (t, txt) => (wk(t) ? 'Folgewoche · ' : '') + txt;
    const etaSub = sch.pickup > sch.eta + 60 ? `versandbereit ${fClock(sch.eta)} · Abholung ab ${fRel(sch.pickup)}` : `versandbereit · Durchlauf ${fDurL(sch.eta - now)}`;
    const eil = c.schAlt && c.schAlt.eta < sch.eta - 1800 ? `<br>Als Eilauftrag: <b>${esc(fDay(c.schAlt.eta))}</b>` : c.prio === 'eil' ? '<br>Eilauftrag – zieht vor anderen Aufträgen ein' : '';
    const tiles = `<div class="ka-tiles">
      <div class="kpi"><div class="l">Frühestens</div><div class="v">${kv(sch.eta)}</div><div class="s">${esc(ks(sch.eta, etaSub))}${eil}</div></div>
      <div class="kpi${wCls}"><div class="l">Wunschtermin</div><div class="v">${w ? kv(w) : '–'}</div><div class="s">${w && wk(w) ? 'Folgewoche · ' : ''}${wState}</div></div>
      <div class="kpi"><div class="l">Zusage-Vorschlag</div><div class="v">${kv(c.zus)}</div><div class="s">${esc(ks(c.zus, 'inkl. Sicherheit ' + fDurL(Math.max(0, c.zus - sch.eta)) + ' · im Lieferfenster'))}</div></div></div>`;
    const W = Math.max(300, (R.sTermin.clientWidth || 640) - 28);
    const g = ganttSvg(c, W);
    const imp = c.imp.filter(x => x.delay >= 10 * 60);
    const impH = imp.length ? imp.slice(0, 4).map(x => {
      const ok = x.after == null ? null : x.after >= 0;
      const pill = x.slack == null ? '' : x.slack < 0 ? WF.ui.sevPill('warn', 'bereits verspätet') : ok ? WF.ui.sevPill('ok', 'bleibt im Termin') : WF.ui.sevPill('crit', 'wird knapp');
      return `<div class="r"><span class="id">${esc(x.orderId)}</span><span class="t">AG ${x.seq} ${esc(STN(x.station) ? STN(x.station).short : x.station)} · bis zu +${fDurL(x.delay)}${x.after != null ? ' · Puffer danach ' + (x.after < 0 ? '−' : '') + fDurL(Math.abs(x.after)) : ''}</span>${pill}</div>`;
    }).join('') : `<div class="none">${icon('check', 15)}Keine Verschiebung bestehender Aufträge – Einlastung in freie Kapazität.</div>`;
    const dc = (v, lab) => `<button type="button" data-act="due" data-v="${v}" class="${ui.dueChoice === v ? 'on' : ''}">${lab}</button>`;
    return `<div class="ka-sh"><span class="n">4</span><h3>Liefertermin</h3><span class="m">aus der Live-Belegung · Schichtkalender · Lieferfenster</span></div>
      ${tiles}
      <div class="ka-gantt${anim ? ' anim' : ''}" data-r2="gantt">${g}</div>
      <div class="ka-glg"><span><i style="background:var(--line2)"></i>belegt durch andere Aufträge</span><span><i style="background:var(--st-setup)"></i>Rüsten · Erstteil</span><span><i style="background:var(--st-run)"></i>Bearbeitung</span><span><i style="background:color-mix(in srgb,var(--st-run) 28%,transparent)"></i>ohne Bediener (Pause/Nacht)</span><span><i style="background:transparent;border:1px dashed color-mix(in srgb,var(--st-run) 60%,transparent)"></i>wartet auf nächsten Behälter</span><span><i style="background:var(--ext)"></i>Fremdbearbeitung</span><span><i style="background:var(--mat);height:2px"></i>Materialfluss</span></div>
      <div class="ka-imp"><div class="eyebrow">Auswirkung auf bestehende Aufträge</div>${impH}</div>
      <div class="ka-duec"><span>Termin für den Auftrag</span><div class="seg">${dc('auto', 'Automatisch')}${w && w > now ? dc('wunsch', 'Wunschtermin') : ''}${dc('zusage', 'Zusage-Vorschlag')}</div><span>→ <b style="color:var(--text)">${esc(fDay(c.dueT))}</b></span></div>`;
  }
  function ganttSvg(c, W) {
    const sch = c.sch, now = sch.now, q = quote;
    const rows = sch.steps;
    const LWd = W < 520 ? 74 : 124, RH = 32, top = 30, padR = 10;
    const t0 = Math.floor(now / 3600) * 3600;
    let t1 = Math.max(sch.eta, c.wunsch && c.wunsch > now ? c.wunsch : 0, c.zus) + 3 * 3600;
    if (t1 - t0 < 18 * 3600) t1 = t0 + 18 * 3600;
    t1 = Math.ceil(t1 / 3600) * 3600;
    const X0 = LWd, X1 = W - padR, span = t1 - t0;
    const x = (t) => X0 + (clamp(t, t0, t1) - t0) / span * (X1 - X0);
    const Hh = top + rows.length * RH + 4, HB = Hh + 16;
    const o = [];
    const rect = (a, b, y, h, fill, extra) => { const xa = x(a), xb = x(b); if (xb - xa < 0.6) return ''; return `<rect x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${h}" rx="2.5" style="fill:${fill}"${extra || ''}/>`; };
    // arbeitsfreie Zeiten
    let cur = t0;
    for (const [a, b] of workSpans(t0, t1)) { if (a > cur) o.push(rect(cur, a, top - 6, Hh - top + 6, 'var(--bg2)', ' rx="0" opacity=".95"')); cur = Math.max(cur, b); }
    if (cur < t1) o.push(rect(cur, t1, top - 6, Hh - top + 6, 'var(--bg2)', ' rx="0" opacity=".95"'));
    // Tage + Stunden
    for (let d = Math.floor(t0 / DAY); d * DAY < t1; d++) {
      const a = Math.max(t0, d * DAY), b = Math.min(t1, (d + 1) * DAY), wpx = x(b) - x(a);
      if (d * DAY > t0) o.push(`<line x1="${x(d * DAY).toFixed(1)}" x2="${x(d * DAY).toFixed(1)}" y1="4" y2="${Hh}" style="stroke:var(--line2)" stroke-width="1"/>`);
      if (wpx > 26) o.push(`<text x="${((x(a) + x(b)) / 2).toFixed(1)}" y="13" text-anchor="middle" class="lb" style="font-size:11.5px">${wpx > 70 ? DAYS_LONG[d % 7] : DAYS[d % 7]}</text>`);
      for (const hh of [6, 14, 22]) {
        const t = d * DAY + hh * 3600; if (t <= t0 || t >= t1) continue;
        const px = x(t);
        if ((X1 - X0) / (span / 3600) * 8 > 30) o.push(`<text x="${px.toFixed(1)}" y="25" text-anchor="middle" style="font-size:10.5px;fill:var(--faint)">${String(hh).padStart(2, '0')}</text>`);
        o.push(`<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${top - 3}" y2="${Hh}" style="stroke:var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`);
      }
    }
    // Zeilen
    rows.forEach((s, i) => {
      const y = top + i * RH, by = y + 8, bh = RH - 16;
      if (i) o.push(`<line x1="0" x2="${W}" y1="${y}" y2="${y}" style="stroke:var(--line)" stroke-width="1"/>`);
      const r = s.kind === 'ship' ? null : q.routing[s.k];
      const lab = s.kind === 'ship' ? 'Versand' : `AG ${(s.k + 1) * 10} · ${s.station}`;
      const sub = s.kind === 'ship' ? 'Fertigteillager' : s.kind === 'ext' ? 'extern' : STN(s.station).short;
      o.push(`<text x="0" y="${y + 14}" class="lb">${esc(lab)}</text><text x="0" y="${y + 26}" class="lb2">${esc(LWd < 100 ? sub.slice(0, 11) : sub)}</text>`);
      if (s.kind === 'machine') {
        for (const e of s.blockers) {
          const a = Math.max(e.start, now), b = Math.min(e.end, s.start); if (b - a < 300) continue;
          const tipTxt = `<b>${esc(e.orderId)}</b> AG ${e.seq} ${esc(e.op || '')} belegt ${esc(s.station)} bis ${esc(fRel(e.end))}`;
          o.push(rect(a, b, by, bh, 'var(--line2)', ` data-tip="${esc(tipTxt)}"`));
          if (x(b) - x(a) > 54) o.push(`<text x="${(x(a) + 5).toFixed(1)}" y="${by + bh / 2 + 3.5}" class="qt">${esc(e.orderId)}</text>`);
        }
        const tip1 = `<b>AG ${(s.k + 1) * 10} ${esc(r.op)}</b> · ${esc(s.station)} ${esc(STN(s.station).short)}<br>Rüsten ${esc(fRel(s.start))}–${esc(fClock(s.setupEnd))}${s.fpiEnd > s.setupEnd ? `, Erstteilprüfung bis ${esc(fClock(s.fpiEnd))}` : ''}<br>Serie ${esc(fRel(s.runStart))} bis ${esc(fRel(s.end))}${s.auto ? ' · läuft autonom' : ''}`;
        o.push(`<g class="ka-gb" data-tip="${esc(tip1)}" style="animation-delay:${i * 90}ms">`);
        o.push(rect(s.start, s.setupEnd, by, bh, 'var(--st-setup)'));
        o.push(rect(s.setupEnd, s.fpiEnd, by, bh, 'color-mix(in srgb,var(--st-setup) 55%,transparent)'));
        if (s.runStart - s.fpiEnd > 300) o.push(rect(s.fpiEnd, s.runStart, by + 2, bh - 4, 'transparent', ' style="fill:transparent;stroke:var(--st-wait)" stroke-dasharray="3 2"'));
        const prevM = s.k > 0 && rows[i - 1] && rows[i - 1].kind === 'machine';
        const batchT = Math.min(s.bq, c.qty) * s.w.cyc * 1.03;
        if (prevM && (s.end - s.runStart) > s.w.run * 1.5 + 1800 && batchT * 2 < s.end - s.runStart) {
          // nimmt Behälter für Behälter ab: erster und letzter Behälter, dazwischen Warten auf den Vorgänger
          o.push(rect(s.runStart + batchT, s.end - batchT, by + 3, bh - 6, 'transparent', ' style="fill:transparent;stroke:color-mix(in srgb,var(--st-run) 55%,transparent)" stroke-dasharray="2 3"'));
          o.push(rect(s.runStart, s.runStart + batchT, by, bh, 'var(--st-run)'));
          o.push(rect(s.end - batchT, s.end, by, bh, 'var(--st-run)'));
        } else if (s.auto) o.push(rect(s.runStart, s.end, by, bh, 'var(--st-run)'));
        else {
          o.push(rect(s.runStart, s.end, by, bh, 'color-mix(in srgb,var(--st-run) 28%,transparent)'));
          for (const [a, b] of workSpans(s.runStart, s.end)) o.push(rect(a, b, by, bh, 'var(--st-run)', ' rx="1.5"'));
        }
        o.push('</g>');
      } else if (s.kind === 'ext') {
        const tip2 = `<b>${esc(r.op)}</b> · ${esc(s.partner || '')}<br>Bereitstellung ab ${esc(fRel(s.ready))}, Abholung ${esc(fRel(s.pickup))}<br>zurück ${esc(fRel(s.firstRet))}${s.lastRet > s.firstRet ? ' bis ' + esc(fRel(s.lastRet)) : ''}`;
        o.push(`<g class="ka-gb" data-tip="${esc(tip2)}" style="animation-delay:${i * 90}ms">`);
        if (s.pickup - s.ready > 300) o.push(rect(s.ready, s.pickup, by + 2, bh - 4, 'transparent', ' style="fill:transparent;stroke:var(--ext)" stroke-dasharray="3 2"'));
        o.push(rect(s.pickup, s.lastRet, by, bh, 'color-mix(in srgb,var(--ext) 80%,transparent)'));
        if (x(s.lastRet) - x(s.pickup) > 92) o.push(`<text x="${(x(s.pickup) + 6).toFixed(1)}" y="${by + bh / 2 + 3.5}" class="bt">${esc((s.partner || '').replace(/\s*\(Beispiel\)/, '').replace(/ GmbH/, ''))}</text>`);
        o.push('</g>');
      } else {
        const px = x(s.end), cy = by + bh / 2;
        o.push(`<path d="M${px.toFixed(1)} ${cy - 7}l7 7-7 7-7-7z" style="fill:var(--st-run);stroke:var(--card);stroke-width:1.5" data-tip="${esc('<b>versandbereit ' + fDay(s.end) + '</b>')}"/>`);
        const tx = px + 12 + 120 < W ? px + 12 : px - 12;
        o.push(`<text x="${tx.toFixed(1)}" y="${cy + 4}" text-anchor="${tx > px ? 'start' : 'end'}" class="lb" style="fill:var(--text)">${esc(fDay(s.end))}</text>`);
      }
      // Materialfluss zur nächsten Zeile (erster Behälter)
      const nx = rows[i + 1];
      if (nx && s.kind !== 'ship') {
        const tf = nx.kind === 'machine' ? nx.avail : nx.kind === 'ext' ? nx.ready : s.end;
        const px = x(tf);
        o.push(`<path d="M${px.toFixed(1)} ${by + bh + 1}V${y + RH + 6}" style="stroke:var(--mat)" stroke-width="1.4" stroke-dasharray="2 2"/><path d="M${(px - 3).toFixed(1)} ${y + RH + 3}l3 4 3-4z" style="fill:var(--mat)"/>`);
      }
    });
    // jetzt / Wunsch
    const nx = x(now);
    o.push(`<line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${top - 6}" y2="${Hh + 3}" style="stroke:var(--accent)" stroke-width="1.5"/><text x="${(nx + 3).toFixed(1)}" y="${HB - 2}" style="fill:var(--accent);font-size:10.5px;font-weight:600">jetzt ${fClock(now)}</text>`);
    if (c.wunsch && c.wunsch > t0 && c.wunsch < t1) {
      const wx = x(c.wunsch), okW = c.wunsch >= sch.eta;
      o.push(`<line x1="${wx.toFixed(1)}" x2="${wx.toFixed(1)}" y1="${top - 6}" y2="${Hh + 3}" style="stroke:${okW ? 'var(--st-run)' : 'var(--st-fault)'}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
      o.push(`<text x="${(wx - 3).toFixed(1)}" y="${HB - 2}" text-anchor="end" style="fill:${okW ? 'var(--st-run)' : 'var(--st-fault)'};font-size:10.5px;font-weight:600">Wunsch ${esc(fDay(c.wunsch).replace(' (Folgewoche)', ''))}</text>`);
    }
    return `<svg width="${W}" height="${HB}" viewBox="0 0 ${W} ${HB}" role="img" aria-label="Terminplan je Arbeitsgang">${o.join('')}</svg>`;
  }

  // ------------------------------------------------------------------ 5 Hinweise, Fußleiste, Banner
  function hintsHtml() {
    const H = calc.hints;
    const cnt = H.filter(h => h.sev === 'crit' || h.sev === 'warn').length;
    return `<div class="ka-sh"><span class="n">5</span><h3>Risiken und Hinweise</h3><span class="m">${cnt ? cnt + ' zu klären' : 'nichts Kritisches'}</span></div>
      <div class="ka-hints">${H.map((h, i) => `<div class="ka-hint" style="--c:${SEVC[h.sev]}"><span class="ic">${icon(h.ic, 17)}</span><div><b>${esc(h.t)}</b><p>${esc(h.p)}</p></div>${h.act ? `<button type="button" class="btn sm${h.sev === 'crit' ? ' primary' : ''}" data-act="hint" data-i="${i}">${esc(h.act.label)}</button>` : ''}</div>`).join('')}</div>`;
  }
  function footHtml() {
    const c = calc, p = c.pr;
    const placedNow = placed && placed.key === quoteKey() && S().orders[placed.id];
    return `<div class="sum">
        <div><span class="l">Menge</span><span class="v">${nf(c.qty)} Stk</span></div>
        <div><span class="l">Angebot netto</span><span class="v">${eur(p.total, 0)}</span></div>
        <div><span class="l">Auftragstermin${c.prio === 'eil' ? ' · Eil' : ''}</span><span class="v">${esc(fDay(c.dueT))}</span></div></div>
      <div class="acts"><button type="button" class="btn" data-act="quote" title="Angebotstext für die E-Mail an den Kunden">${icon('file', 15)}<span class="tx">Angebotstext</span></button>${placedNow
        ? `<button type="button" class="btn ok" data-act="open" data-id="${esc(placed.id)}">${icon('check', 15)} ${esc(placed.id)} öffnen</button>`
        : `<button type="button" class="btn primary" data-act="place">${icon('arrowRight', 16)} Auftrag einlasten</button>`}</div>`;
  }
  function renderBanner() {
    const n = R.ban; if (!n) return;
    const o = placed && S().orders[placed.id] ? WF.sim.orderView(placed.id) : null;
    if (!o) { if (!n.hidden) { n.hidden = true; html.ban = ''; } return; }
    const act = o.ops.find(x => x.state === 'active') || o.ops.find(x => x.state === 'external') || o.ops.find(x => x.state === 'waiting');
    const eta = o.eta != null ? o.eta : null;
    const dev = eta != null && placed.etaQuote ? eta - placed.etaQuote : null;
    const stTxt = o.status === 'fertig' ? 'fertig' : act ? `AG ${act.seq} ${act.op || ''} · ${act.stationName || act.station} – ${act.stateLabel || ''}` : WF.sim.label('orderStatus', o.status);
    const h = `<div class="ka-ban" style="--c:${o.late ? 'var(--st-wait)' : 'var(--st-run)'}"><span class="ic">${icon('check', 18)}</span>
      <div class="tx"><b>${esc(o.id)} eingelastet · ${esc(o.part.name)}</b>
        <p>${esc(stTxt)}${eta != null ? ` · Prognose Plantafel ${esc(fDay(eta))}` : ''}${dev != null && Math.abs(dev) > 900 ? ` (Angebot: ${esc(fDay(placed.etaQuote))})` : ''}</p>
        <div class="bar" title="Fortschritt ${U.fmtPct(o.progress)}">${WF.ui.bar(o.progress, { color: 'var(--st-run)', thin: true })}</div></div>
      <div class="row"><button type="button" class="btn sm" data-act="open" data-id="${esc(o.id)}">Auftrag öffnen</button>${hasView('auftraege') ? `<button type="button" class="btn sm ghost" data-act="plan" data-id="${esc(o.id)}">${icon('layers', 14)} Plantafel</button>` : ''}${hasView('halle') ? `<button type="button" class="btn sm ghost" data-act="hall" data-id="${esc(o.id)}">${icon('cube', 14)} In der Halle</button>` : ''}</div></div>`;
    n.hidden = false; put(n, h);
  }
  function renderRecent() {
    if (!R.recent || !S()) return;
    const list = Object.values(S().orders).filter(o => o.source === 'KI-Auftrag').sort((a, b) => b.releasedT - a.releasedT).slice(0, 5);
    if (!list.length) { R.recent.hidden = true; return; }
    const fc = WF.sim.forecast(120);
    const h = `<div class="ka-card-h"><h3>Zuletzt eingelastet</h3><span class="muted">${list.length} KI-Auftr${list.length === 1 ? 'ag' : 'äge'}</span></div>` +
      list.map(o => {
        const f = fc.orders[o.id], eta = o.status === 'fertig' ? o.doneT : f ? f.eta : null;
        const pill = o.status === 'fertig' ? WF.ui.sevPill('ok', 'fertig') : f && f.late ? WF.ui.sevPill('warn', 'spät') : WF.ui.sevPill('info', WF.sim.label('orderStatus', o.status));
        return `<div class="row" data-act="open" data-id="${esc(o.id)}"><span class="id">${esc(o.id)}</span><span class="nm">${nf(o.qty)} × ${esc(o.part.name)}</span>${pill}<span class="eta">${eta != null ? esc(fRel(eta)) : '–'}</span></div>`;
      }).join('');
    R.recent.hidden = false; put(R.recent, h);
  }

  // ------------------------------------------------------------------ Leer-, Hinweis- und Fehlerzustand
  /** Uhrzeit kurz relativ zu heute: „14:17“, „morgen 08:27“, „Mi 19:04“ */
  function fShort(t) {
    const now = S() ? S().t : 0, d = Math.floor(t / DAY) - Math.floor(now / DAY);
    return d === 0 ? fClock(t) : d === 1 ? 'morgen ' + fClock(t) : DAYS[Math.floor(t / DAY) % 7] + ' ' + fClock(t);
  }
  /** Ende eines Fensters kompakt: „16:31“ heute, sonst „Di 13:20“ */
  function fBis(t) { const now = S() ? S().t : 0; return Math.floor(t / DAY) === Math.floor(now / DAY) ? fClock(t) : DAYS[Math.floor(t / DAY) % 7] + ' ' + fClock(t); }
  const FREE_MIN = 2 * 3600, CAP_H = 48;
  /** Engpass im Werk und Arbeitsvorrat je Arbeitsplatz – Werte der Engine (eine Wahrheit), falls vorhanden */
  function plantBottleneck() { try { return WF.sim && typeof WF.sim.bottleneck === 'function' ? WF.sim.bottleneck() : null; } catch (e) { return null; } }
  function plantOccupancy() {
    try {
      if (WF.sim && typeof WF.sim.occupancy === 'function') return WF.sim.occupancy();
      const k = WF.sim && WF.sim.state && WF.sim.state.kpi; return k && k.occupancy && k.occupancy.byMachine ? k.occupancy : null;
    } catch (e) { return null; }
  }
  /** Belegung eines Arbeitsplatzes aus der Plantafel (WF.sim.forecast().machines): erstes freies Fenster ≥ 2 h ab jetzt,
      belegte Abschnitte und Belegungsanteil der nächsten 48 h */
  function capOf(fc, id, now) {
    const list = (fc.machines[id] || []).filter(e => e.end > now).slice().sort((a, b) => a.start - b.start);
    let cur = now, win = null;
    for (const e of list) {
      if (e.start - cur >= FREE_MIN) { win = { a: cur, b: e.start }; break; }
      cur = Math.max(cur, e.end);
    }
    if (!win) win = { a: cur, b: null };
    const h1 = now + CAP_H * 3600, segs = [];
    let busy = 0;
    for (const e of list) {
      const a = Math.max(now, e.start), b = Math.min(h1, e.end); if (b <= a) continue;
      const last = segs[segs.length - 1];
      if (last && a <= last.b + 60 && last.active === !!e.active) last.b = Math.max(last.b, b); else segs.push({ a, b, active: !!e.active });
    }
    let reach = now;
    for (const g of segs) { busy += Math.max(0, g.b - Math.max(g.a, reach)); reach = Math.max(reach, g.b); }
    return { win, segs, share: busy / (CAP_H * 3600), next: list[0] || null };
  }
  function emptyHtml() {
    const fc = WF.sim.forecast(120), now = S().t, H = CAP_H * 3600;
    const bw = plantBottleneck(), occ = plantOccupancy();
    const caps = P().machines.map(id => {
      const sn = STN(id), m = S().machines[id], c = capOf(fc, id, now);
      let fr, bis = '';
      if (m && m.state === 'fault') fr = '<span class="fr bad">Störung</span>';
      else if (c.win.a <= now + 900) { fr = '<span class="fr ok">jetzt frei</span>'; bis = c.win.b != null ? 'bis ' + fBis(c.win.b) : 'ohne Auftrag'; }
      else { fr = `<span class="fr">frei ab ${esc(fShort(c.win.a))}</span>`; bis = c.win.b != null ? 'bis ' + fBis(c.win.b) : ''; }
      const bar = c.segs.map(g => `<i class="${g.active ? 'a' : ''}" style="left:${((g.a - now) / H * 100).toFixed(2)}%;width:${Math.max(0.8, (g.b - g.a) / H * 100).toFixed(2)}%"></i>`).join('');
      const isBn = !!(bw && bw.stationId === id), bd = occ && occ.byMachine ? occ.byMachine[id] : null;
      const tipTxt = `${sn.name} · ${stLabel(id)}` + (m && m.op ? ` (${m.op.oid})` : '') +
        (bd != null ? `\nArbeitsvorrat ${nf(bd, bd < 10 ? 1 : 0)} Schichttage` : '') +
        `\nBelegt in den nächsten 48 h: ${U.fmtPct(c.share)}` + (c.win.b != null ? `\nFreies Fenster ≥ 2 h: ${fShort(Math.max(now, c.win.a))} – ${fShort(c.win.b)}` : `\nFrei ab ${fShort(Math.max(now, c.win.a))}`) +
        (isBn ? `\nEngpass im Werk – ${bw.why || ''}` : '');
      return `<div class="c${isBn ? ' bn' : ''}" style="--c:${stColor(id)}" title="${esc(tipTxt)}"><i></i><span class="nmw"><span class="id">${id}</span><span class="nm">${esc(sn.short)}</span>${isBn ? `<span class="bnt" aria-label="Engpass im Werk">${icon('gauge', 13)}</span>` : ''}</span><span class="frw">${fr}${bis ? `<span class="bis">${esc(bis)}</span>` : ''}</span><span class="occ" aria-hidden="true">${bar}</span></div>`;
    }).join('');
    const off = ai.state === 'off';
    // ohne Claude ehrlich: die Beispiele sind vorberechnet gelesen, Preis und Termin rechnet werkfluss trotzdem live
    const intro = off
      ? 'Eine Beispielzeichnung wählen und „Analysieren“ klicken. Ohne Claude-Verbindung zeigt werkfluss die vorberechnete Auswertung der drei Beispiele; Preis, Material und Liefertermin rechnet werkfluss live aus der aktuellen Belegung Ihrer Fertigung – und lastet den Auftrag auf Wunsch sofort ein. Eigene Zeichnungen liest Claude, wenn werkfluss auf claude.ai läuft.'
      : 'Eine Beispielzeichnung wählen oder eine eigene ablegen und „Analysieren“ klicken. Claude liest die Zeichnung; werkfluss rechnet Preis und Liefertermin aus der aktuellen Belegung Ihrer Fertigung – und lastet den Auftrag auf Wunsch sofort ein.';
    return `<div class="ka-empty"><div class="hd"><span class="ic">${icon('sparkles', 22)}</span><div><h2>Vom Zeichnungsstand zum Angebot – in einer Minute</h2>
        <p>${esc(intro)}</p></div></div>
      ${stepsHtml(off)}
      <div class="ka-cap"><div class="eyebrow"><span>Live-Belegung der Arbeitsplätze · nächste 48 h</span><span>${esc(WF.sim.clock())}</span></div><div class="ka-capg">${caps}</div>
        <div class="ka-caplg"><span><i class="a"></i>laufender Auftrag</span><span><i></i>eingeplant</span>${bw && bw.stationId ? `<span class="bnl" title="${esc(bw.why || '')}">${icon('gauge', 13)}Engpass im Werk</span>` : ''}<span>„frei“ = erste Lücke von mindestens 2 h laut Plantafel</span></div></div></div>`;
  }
  /** Die fünf Schritte der Auswertung – wer was macht (Claude liest, werkfluss rechnet); ohne Claude vorberechnet */
  function stepsHtml(off) {
    const who = (w) => (off && w === 'Claude' ? 'Vorberechnet' : w);
    const step = (ic, t, d, w) => `<li><span class="d">${icon(ic, 16)}</span><div><b>${t}</b><span>${d}</span></div><span class="who ${w === 'Claude' ? (off ? 'p' : 'c') : 'w'}">${esc(who(w))}</span></li>`;
    return `<ol class="ka-esteps">
        ${step('eye', 'Zeichnung lesen', 'Bemaßung, Schriftfeld, Werkstoff, Masse und Hinweise.', 'Claude')}
        ${step('target', 'Merkmale', 'Passungen, Oberflächen, Härte, Form- und Lagetoleranzen – nummeriert auf der Zeichnung.', 'Claude')}
        ${step('route', 'Arbeitsplan', `Nur mit den ${P().machines.length} Arbeitsplätzen und ${P().toolTypes.length} Werkzeugtypen dieses Werks – jede Station und jedes Werkzeug geprüft.`, 'Claude')}
        ${step('euro', 'Kalkulation', 'Lagermaterial, Maschinenstundensätze, Werkzeugverschleiß, Fremdbearbeitung, Zuschlag – jede Formel sichtbar.', 'werkfluss')}
        ${step('clock', 'Termin', 'Warteschlangen der Maschinen, Schichtkalender, Härterei-Lieferfenster und Materialbestand – live.', 'werkfluss')}
      </ol>`;
  }
  function noticeHtml(kind) {
    if (kind === 'offline') {
      // eigene Zeichnung ohne Claude: kein Leerlauf – erklären, was mit Claude passiert, und sofort mit einem Beispiel weiter
      const exs = EXAMPLES.map(e => `<button type="button" class="ka-nex" data-act="exgo" data-id="${e.id}"><span class="th">${e.draw(' aria-hidden="true" preserveAspectRatio="xMidYMid slice"', e.thumb)}</span><span class="tx"><b>${esc(e.title)}</b><small>${esc(e.sub)}</small></span>${icon('arrowRight', 15)}</button>`).join('');
      return `<div class="ka-note ka-off"><span class="ic" style="--c:var(--accent)">${icon('sparkles', 20)}</span><div>
          <h3>Eigene Zeichnungen – mit Claude verfügbar</h3>
          <p>Diese Demo läuft gerade ohne Claude-Verbindung (z. B. lokal geöffnet). Veröffentlicht auf claude.ai liest Claude Ihre Zeichnung live; Preis, Material und Liefertermin rechnet werkfluss danach aus der aktuellen Belegung. Ausprobieren lässt sich der Ablauf hier mit einer der drei Beispielzeichnungen – vorberechnet gelesen, Preis und Termin live.</p>
          <div class="ka-nexs">${exs}</div></div></div>
        <div class="ka-offsteps"><div class="eyebrow"><span>So läuft die Auswertung mit Claude</span><span>ca. 20–60 s</span></div>${stepsHtml(false)}</div>`;
    }
    const exBtns = EXAMPLES.map(e => `<button type="button" class="btn sm" data-act="ex" data-id="${e.id}">${esc(e.title)}</button>`).join('');
    const T = {
      pdf: ['PDF bitte als Bild', 'Claude liest Zeichnungen hier als Bild. Bitte die Zeichnung als PNG oder JPG exportieren (oder ein Foto aufnehmen) und erneut ablegen.', 'file'],
      noimg: ['Bilder sind hier nicht freigegeben', 'Claude ist verbunden, darf in dieser Ansicht aber keine Bilder lesen. Für die Beispielzeichnungen erhält Claude den Zeichnungsinhalt als Text.', 'eye'],
    }[kind] || ['Hinweis', '', 'info'];
    return `<div class="ka-note"><span class="ic">${icon(T[2], 20)}</span><div><h3>${esc(T[0])}</h3><p>${esc(T[1])}</p><div class="row">${exBtns}${kind === 'pdf' ? `<button type="button" class="btn sm primary" data-act="pick">${icon('upload', 14)} Bild wählen</button>` : ''}</div></div></div>`;
  }
  function errorHtml() {
    const e = run.error, ex = run.src && run.src.kind === 'example';
    return `<div class="ka-note" style="--c:var(--st-fault)"><span class="ic">${icon('alert', 20)}</span><div><h3>Auswertung nicht möglich</h3><p>${esc(e.msg)}${ex ? ' Die Beispielzeichnung lässt sich auch mit der vorberechneten Auswertung zeigen.' : ''}</p>
      <div class="row">${AI_HIDE[e.code] ? '' : `<button type="button" class="btn sm primary" data-act="go">${icon('refresh', 14)} Erneut versuchen</button>`}${ex ? `<button type="button" class="btn sm" data-act="demo">Vorberechnete Auswertung verwenden</button>` : EXAMPLES.map(x => `<button type="button" class="btn sm" data-act="ex" data-id="${x.id}">${esc(x.title)}</button>`).join('')}</div></div></div>`;
  }

  // ------------------------------------------------------------------ Einlasten, Angebotstext, Vergrößern
  function sectorOf(cust) { const o = P().orders.find(x => x.customer === cust); return o ? o.sector : /förder/i.test(cust) ? 'Fördertechnik' : ''; }
  function buildSpec() {
    const c = calc || recalc(), q = quote;
    if (!c || !q) return null;
    const routing = q.routing.map((r, k) => {
      if (r.station === 'EXT') return { op: r.op, station: 'EXT', ext: Object.assign({}, r.ext), transferBatch: Math.min(c.qty, r.transferBatch || c.qty) };
      const o = { op: r.op, station: r.station, setupMin: r.setupMin, cycleMin: r.cycleMin, tools: r.tools.map(t => ({ type: t.type, cutMinPerPart: t.cutMinPerPart })),
        transferBatch: Math.min(c.qty, r.transferBatch || 20), firstPiece: !!r.firstPiece };
      if (k === 0 && q.raw.materialId) o.material = { id: q.raw.materialId, perPart: q.raw.perPart };
      if (r.char) o.char = Object.assign({}, r.char);
      return o;
    });
    routing.push({ op: 'Versand', station: 'VERSAND' });
    const cust = ui.customer.trim() || q.part.customer || 'Neukunde';
    const dims = String(q.part.dims || '').replace(/\s*mm\b/g, '').replace(/\s*×\s*/g, '×').trim();
    const name = (q.part.name + (dims && !q.part.name.includes(dims) ? ' ' + dims : '')).slice(0, 60);
    return {
      customer: cust, sector: sectorOf(cust), qty: c.qty, due: c.dueT, priority: c.prio, source: 'KI-Auftrag',
      part: { name, no: q.part.no || undefined, material: q.part.material, drawing: q.part.drawing, weightKg: q.part.weightKg },
      note: `KI-Auftrag aus Zeichnung ${q.part.drawing} (${q.source === 'claude' ? 'Claude' : 'vorberechnete Auswertung'}) · Angebot ${eur(c.pr.total)} (${eur(c.pr.unit)}/Stk) · frühestens ${fDay(c.sch.eta)}`,
      routing,
    };
  }
  function place() {
    if (!quote || !run || !run.done) return null;
    const spec = buildSpec(); if (!spec) return null;
    // Prognose aller offenen Aufträge vorher (ungeglättet) – danach zeigt die Plantafel, wer sich verschiebt
    const etaOf = (fc) => { const m = {}; for (const oid in fc.orders) { const f = fc.orders[oid]; if (f && !f.done) m[oid] = f.etaRaw != null ? f.etaRaw : f.eta; } return m; };
    let before = {};
    try { before = etaOf(WF.sim.forecast(0)); } catch (e) { before = {}; }
    let id;
    try { id = WF.sim.actions.addOrder(spec); } catch (e) { id = { ok: false, msg: e.message }; }
    if (!id || typeof id !== 'string') { WF.app.toast((id && id.msg) || 'Auftrag konnte nicht eingelastet werden.', 'warn', { title: 'Einlastung abgelehnt' }); return null; }
    let etaPlan = null, after = {};
    try { const fc = WF.sim.forecast(0), f = fc.orders[id]; etaPlan = f ? (f.etaRaw != null ? f.etaRaw : f.eta) : null; after = etaOf(fc); } catch (e) { etaPlan = null; }
    const shifted = Object.keys(before).filter(oid => after[oid] != null && after[oid] - before[oid] >= 10 * 60).sort((a, b) => (after[b] - before[b]) - (after[a] - before[a]));
    placed = { id, t: S().t, key: quoteKey(), etaQuote: calc.sch.eta, etaPlan, total: calc.pr.total, qty: calc.qty, shifted };
    // Meldung sagt, was wirklich passiert: wann der erste Arbeitsgang beginnt, Prognose und Termin, wer sich verschiebt
    let v = null; try { v = WF.sim.orderView(id); } catch (e) { v = null; }
    const op1 = v && v.ops && v.ops[0];
    const now = S().t;
    const startTxt = op1 ? (op1.state === 'active' ? `Start jetzt an ${op1.stationName || op1.station}` : op1.plannedStart != null ? `Start ${op1.stationName || op1.station} (AG ${op1.seq}) ${op1.plannedStart <= now + 300 ? 'sofort' : 'ca. ' + fRel(op1.plannedStart)}` : '') : '';
    const body = [startTxt, etaPlan != null ? `Prognose ${fDay(etaPlan)} (Termin ${fDay(spec.due)})` : `Termin ${fDay(spec.due)}`,
      shifted.length ? `${shifted.length} ${shifted.length === 1 ? 'Auftrag verschiebt' : 'Aufträge verschieben'} sich` : 'kein anderer Auftrag verschiebt sich'].filter(Boolean).join(' · ');
    WF.app.toast(body, 'ok', { title: `${id} eingelastet · ${nf(spec.qty)} Stk ${spec.part.name}`, onClick: () => WF.app.select('order', id), ms: 9000 });
    recalc(); renderSections(); renderRecent();
    // Plantafel mit dem neuen Auftrag hervorgehoben (neue Blöcke reihen sich ein), verschobene Aufträge kurz markiert
    if (hasView('auftraege')) WF.app.navigate('auftraege', { mode: 'gantt', order: id, fresh: true, shifted });
    return id;
  }
  function quoteText() {
    const c = calc, q = quote, p = c.pr, co = WF.app.company ? WF.app.company() : { name: P().company.name, site: '' };
    const cust = ui.customer.trim() || q.part.customer || 'Kunde';
    const crit = q.features.filter(f => f.critical).map(f => f.text).join(', ');
    const steps = q.routing.map(r => r.station === 'EXT' ? r.op + ' (extern)' : r.op).join(' – ');
    const stf = c.stf.filter(x => !x.cur).map(x => `${nf(x.n)} Stk: ${eur(x.unit)}`).join(' · ');
    return `${co.name}
Angebot an: ${cust}
Betreff: ${q.part.name}, Zeichnung ${q.part.drawing}

Pos. 1   ${nf(c.qty)} Stk   ${q.part.name}${q.part.dims ? ' ' + q.part.dims : ''}
         Zeichnung ${q.part.drawing}, Werkstoff ${q.part.material}
         Kritische Merkmale: ${crit || '–'}
         Fertigung: ${steps}
         Einzelpreis ${eur(p.unit)}   Gesamt ${eur(p.total)} netto${p.e ? ' (inkl. Eilzuschlag)' : ''}

Staffelpreise je Stück: ${stf}
Liefertermin: ${fDay(c.dueT).replace(' (Folgewoche)', ' (Folgewoche)')} versandbereit ab Werk${c.wunsch && c.wunsch < c.sch.eta ? ` (Ihr Wunschtermin ${fDay(c.wunsch)} ist nicht erreichbar – frühestens ${fDay(c.sch.eta)})` : ''}
Preisbasis: ${q.raw.materialId ? 'Material ' + q.raw.text : 'Rohteile beigestellt'}${p.ext.length ? ', inkl. ' + p.ext.map(x => x.rt.label).join(', ') : ''}.
Angebot gültig 14 Tage, Zahlung 30 Tage netto, Lieferung ab Werk.

Erstellt mit werkfluss KI-Auftrag · ${WF.sim.clock()}`;
  }
  function openQuote() {
    const ta = el('textarea', { class: 'input ka-qt', readonly: true, spellcheck: 'false' });
    ta.value = quoteText();
    const body = el('div', { class: 'stack' }, el('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' }, text: 'Zum Einfügen in eine E-Mail an den Kunden. Preise und Termin stammen aus der aktuellen Kalkulation.' }), ta);
    WF.app.modal({ title: 'Angebotstext', body, width: 680, actions: [
      { label: 'Schließen' },
      { label: 'Kopieren', primary: true, onClick: () => {
        const ok = () => WF.app.toast('Angebotstext in die Zwischenablage kopiert', 'ok');
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value).then(ok, () => { ta.select(); document.execCommand('copy'); ok(); }); } else { ta.select(); document.execCommand('copy'); ok(); } } catch (e) { ta.select(); }
        return false;
      } },
    ] });
  }
  /** Merkmal in der Ergebnisliste zeigen (Klick auf eine nummerierte Markierung der Zeichnung) */
  function flashFeature(i) {
    const n = root && root.querySelector(`.ka-feat[data-fi="${i}"]`);
    if (!n || !shown.sPart) return false;
    try { n.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) { n.scrollIntoView(); }
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
    setTimeout(() => n.classList.remove('flash'), 1700);
    return true;
  }
  function openZoom() {
    let inner = '';
    if (ui.src.kind === 'example') inner = exById(ui.src.id).draw(' role="img"');
    else if (ui.upload && ui.upload.kind === 'image') inner = `<img src="${ui.upload.url}" alt="" style="display:block;width:100%;height:auto">`;
    else return;
    const phone = window.matchMedia('(max-width: 640px)').matches;
    const box = el('div', { class: 'ka-zm', html: inner + `<div class="ka-ov">${markerHtml()}</div>` });
    const title = ui.src.kind === 'example' ? exById(ui.src.id).result.part.drawing + ' · ' + exById(ui.src.id).title : ui.upload.name;
    const hasMk = !!box.querySelector('.ka-mk');
    let body = box, pan = null;
    if (phone) {
      pan = el('div', { class: 'ka-zpan' }, box);
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      body = el('div', { style: { display: 'contents' } },
        el('div', { class: 'ka-zhint', html: icon(portrait ? 'refresh' : 'search', 14) + `<span>${portrait ? 'Querformat empfohlen · ' : ''}verschieben und mit zwei Fingern zoomen${hasMk ? ' · Nummer antippen zeigt das Merkmal' : ''}</span>` }), pan);
    } else if (hasMk) {
      body = el('div', { class: 'stack' }, box, el('div', { class: 'ka-zhint', html: icon('info', 14) + '<span>Nummer anklicken zeigt das Merkmal in der Auswertung</span>' }));
    }
    const ar = ui.src.kind === 'example' ? 297 / 210 : (ui.upload.w && ui.upload.h ? ui.upload.w / ui.upload.h : 1.414);
    const w = Math.round(Math.max(320, Math.min(1180, (window.innerHeight - 150) * ar + 34)));
    const m = WF.app.modal({ title, body, width: phone ? null : w });
    box.addEventListener('click', (e) => {
      const mk = e.target.closest('.ka-mk'); if (!mk) return;
      const i = mk.dataset.fi;
      if (root.querySelector(`.ka-feat[data-fi="${i}"]`) && shown.sPart) { m.close(); setTimeout(() => flashFeature(i), 60); }
    });
    if (phone && m.body) {
      const modal = m.body.closest('.modal'); if (modal) { modal.classList.add('ka-zmodal'); if (modal.parentNode) modal.parentNode.classList.add('ka-zback'); }
      // Start beim Schriftfeld (rechts unten): Benennung, Zeichnungsnummer, Werkstoff, Maßstab
      requestAnimationFrame(() => {
        if (!pan) return;
        if (ui.src.kind === 'example') { pan.scrollLeft = Math.max(0, 1100 * 167 / 297 - 12); pan.scrollTop = pan.scrollHeight; }
        else { pan.scrollLeft = pan.scrollWidth; pan.scrollTop = pan.scrollHeight; }
      });
    }
  }

  // ------------------------------------------------------------------ Ereignisse
  function setQty(n, now) {
    n = Math.round(Number(n));
    if (!(n >= 1)) return;
    ui.qty = clamp(n, 1, 100000);
    if (document.activeElement !== R.qty) R.qty.value = String(ui.qty);
    clearTimeout(qtyTimer);
    const go = () => { if (quote) { recalc(); renderSections(); } };
    if (now) go(); else qtyTimer = setTimeout(go, 140);
  }
  function stepQty(dir) {
    const q = ui.qty, st = q < 10 ? 1 : q < 50 ? 5 : q < 200 ? 10 : q < 1000 ? 50 : 100;
    setQty(dir > 0 ? Math.floor(q / st) * st + st : Math.max(1, Math.ceil(q / st) * st - st), true);
    R.qty.value = String(ui.qty);
  }
  function setPriority(p) {
    ui.prio = p === 'eil' ? 'eil' : 'normal';
    R.prio.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.prio));
    if (quote) { recalc(); renderSections(); }
  }
  function onClick(e) {
    const mk = e.target.closest && e.target.closest('.ka-stage .ka-mk');
    if (mk && root.contains(mk)) { flashFeature(mk.dataset.fi); return; }
    const b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'ex') selectExample(b.dataset.id);
    else if (a === 'up' || a === 'pick') {
      if (a === 'up' && ui.src.kind !== 'upload') { cancelRun(); ui.src = { kind: 'upload' }; ui.notice = ai.state === 'off' ? 'offline' : null; ui.customer = ''; R.cust.value = ''; resetResult(); renderExamples(); renderStage(); renderGo(); renderOut(); R.srcHint.textContent = 'Bild oder PDF ablegen'; if (ui.upload) return; }
      R.file.click();
    }
    else if (a === 'zoom') openZoom();
    else if (a === 'go') { if (run && run.error) run = null; analyze(); }
    else if (a === 'demo') { run = null; analyze({ demo: true }); }
    else if (a === 'exgo') { selectExample(b.dataset.id || 'flanschwelle'); analyze({ demo: true }); }
    else if (a === 'stop') { cancelRun(); run = null; renderOut(); renderStageFx(); renderGo(); }
    else if (a === 'qm') stepQty(-1);
    else if (a === 'qp') stepQty(1);
    else if (a === 'prio') setPriority(b.dataset.v);
    else if (a === 'mode') { ui.mode = b.dataset.v === 'demo' ? 'demo' : 'live'; pref.mode = ui.mode; savePref(); renderGo(); }
    else if (a === 'zus') { ui.zus = Number(b.dataset.v); recalc(); renderSections(); }
    else if (a === 'due') { ui.dueChoice = b.dataset.v; recalc(); renderSections(); }
    else if (a === 'stf') { setQty(Number(b.dataset.n), true); R.qty.value = String(ui.qty); }
    else if (a === 'mc') WF.app.select('machine', b.dataset.id);
    else if (a === 'altsw') selectAlt(Number(b.dataset.k), b.dataset.sid);
    else if (a === 'hint') {
      const h = calc && calc.hints[Number(b.dataset.i)]; if (!h || !h.act) return;
      if (h.act.act === 'eil') setPriority('eil');
      else if (h.act.act === 'alt') selectAlt(h.act.k, h.act.sid);
      else if (h.act.act === 'reorder' && calc.mat && calc.mat.mt) {
        const m = calc.mat, qtyR = m.ok ? Math.max(m.mt.reorderQty, m.suggest) : m.suggest;
        const r = WF.sim.actions.reorder(m.mt.id, qtyR);
        WF.app.toast((r && r.msg) || 'Bestellung ausgelöst', r && r.ok === false ? 'warn' : 'ok', { title: 'Material nachbestellt' });
        recalc(); renderSections();
      }
    }
    else if (a === 'place') place();
    else if (a === 'quote') openQuote();
    else if (a === 'open') WF.app.select('order', b.dataset.id);
    else if (a === 'plan') WF.app.navigate('auftraege', b.dataset.id ? { mode: 'gantt', order: b.dataset.id } : null);
    else if (a === 'hall') {
      WF.app.navigate('halle');
      if (b.dataset.id && WF.hall && WF.hall.focusOrder) { try { WF.hall.focusOrder(b.dataset.id); } catch (err) { console.warn(err); } }
    }
  }
  function selectAlt(k, sid) {
    const r = quote.routing[k]; if (!r) return;
    const alt = sid === r.orig.station ? r.orig : r.alts.find(x => x.station === sid); if (!alt) return;
    r.station = sid; r.setupMin = alt.setupMin; r.cycleMin = alt.cycleMin;
    recalc(); renderSections();
    WF.app.toast(`AG ${(k + 1) * 10} auf ${sid} ${STN(sid).short} – versandbereit ${fDay(calc.sch.eta)}`, 'info');
  }
  function onChange(e) {
    const t = e.target;
    if (t === R.dueDay) { ui.dueDay = t.value === '' ? null : Number(t.value); R.dueTime.disabled = ui.dueDay == null; if (quote) { recalc(); renderSections(); } }
    else if (t === R.dueTime) { ui.dueTime = t.value; if (quote) { recalc(); renderSections(); } }
    else if (t === R.qty) { const n = Math.round(Number(t.value)); if (n >= 1) setQty(n, true); t.value = String(ui.qty); }
  }
  function onInput(e) {
    const t = e.target;
    if (t === R.cust) { ui.customer = t.value; if (quote && shown.foot) put(R.foot, footHtml()); }
    else if (t === R.qty) { const n = Math.round(Number(t.value)); if (n >= 1 && n <= 100000) setQty(n); }
  }
  function onHover(e) {
    const n = e.target.closest && e.target.closest('[data-fi]');
    if (!n) return;
    const i = n.dataset.fi, on = e.type === 'mouseover';
    root.querySelectorAll(`[data-fi="${i}"]`).forEach(x => x.classList.toggle('hl', on));
  }
  function tip(html2, ev) {
    if (!html2) { if (tipEl) tipEl.hidden = true; return; }
    if (!tipEl) { tipEl = el('div', { class: 'ka-tip' }); document.body.append(tipEl); }
    tipEl.hidden = false; if (tipEl._h !== html2) { tipEl._h = html2; tipEl.innerHTML = html2; }
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
  }
  function onTip(e) {
    const n = e.target.closest && e.target.closest('[data-tip]');
    if (n && root.contains(n)) tip(n.getAttribute('data-tip'), e); else tip(null);
  }

  // ------------------------------------------------------------------ Lebenszyklus
  function show() { if (!root) return; dayKey = -1; renderDue(); setTimeout(updateStick, 0); if (quote) { recalc(); renderSections(); } renderRecent(); renderOut(); }
  function hide() { tip(null); }
  function update() {
    if (!root || !S()) return;
    const tnow = performance.now();
    renderDue();
    if (run && !run.done && !run.error && run.stage === 0) { put(R.flow, flowHtml()); put(R.wait, waitHtml()); }
    if (quote && run && run.stage >= 1 && !run.error && tnow - calcAt > 700) { recalc(); renderSections(); }
    if (!run && !ui.notice && tnow - emptyAt > 1500) { emptyAt = tnow; put(R.empty, emptyHtml()); }
    if (placed) renderBanner();
    renderRecent();
  }

  WF.registerView({ id: 'ki-auftrag', title: 'KI-Auftrag', icon: 'sparkles', group: 'ki', order: 9, mount, show, hide, update,
    badge() { return ''; } });

  /** Öffentlich (Tour, Tests, andere Module) */
  WF.kiAuftrag = {
    examples: EXAMPLES.map(e => ({ id: e.id, title: e.title, sub: e.sub })),
    select: (id) => { if (!root) WF.app.navigate('ki-auftrag'); selectExample(id); },
    analyze: (opt) => analyze(opt || {}),
    quote: () => (quote ? clone(Object.assign({}, quote, { src: undefined })) : null),
    estimate: () => (calc ? { eta: calc.sch.eta, zusage: calc.zus, earliestText: 'frühestens ' + fDay(calc.sch.eta), unitPrice: calc.pr.unit, total: calc.pr.total, steps: calc.sch.steps.map(s => ({ station: s.station, start: s.start, end: s.end })), material: calc.mat && !calc.mat.none ? { id: calc.mat.id, need: calc.mat.need, free: calc.mat.free, ok: calc.mat.ok } : null, hints: calc.hints.map(h => ({ sev: h.sev, title: h.t })) } : null),
    spec: () => buildSpec(),
    place: () => place(),
    validate: (raw, qty) => validate(raw, { qty: qty || ui.qty }),
    setQty: (n) => { setQty(n, true); if (R.qty) R.qty.value = String(ui.qty); },
    setPriority: (p) => setPriority(p),
    drawingSvg: (id, attrs) => (exById(id) ? exById(id).draw(attrs || '') : null),
  };
})();
