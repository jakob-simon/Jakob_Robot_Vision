/* werkfluss – Kern: Namespace, Utilities, Event-Bus, RNG, Pfadsuche, UI-Helfer, Icons.
   Läuft im Browser und in Node (Tests): kein DOM-Zugriff außerhalb von WF.ui. */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const WF = G.WF = G.WF || {};
  WF.version = '1.0.0';

  // ------------------------------------------------------------------ Utilities
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const nf = (dec) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const nfCache = {};
  const fmtNum = (n, dec = 0) => {
    if (n == null || Number.isNaN(n)) return '–';
    return (nfCache[dec] || (nfCache[dec] = nf(dec))).format(n);
  };
  let uidCounter = {};

  const util = WF.util = {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    round: (v, dec = 0) => { const f = 10 ** dec; return Math.round(v * f) / f; },
    dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),

    /** Deterministischer RNG (mulberry32). */
    rng(seed) {
      let s = seed >>> 0;
      const next = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let spare = null;
      return {
        next,
        range: (a, b) => a + (b - a) * next(),
        int: (a, b) => Math.floor(a + (b - a + 1) * next()),
        pick: (arr) => arr[Math.floor(next() * arr.length)],
        chance: (p) => next() < p,
        normal(mu = 0, sigma = 1) {
          if (spare != null) { const v = spare; spare = null; return mu + sigma * v; }
          let u = 0, v = 0;
          while (u === 0) u = next();
          while (v === 0) v = next();
          const mag = Math.sqrt(-2 * Math.log(u));
          spare = mag * Math.sin(2 * Math.PI * v);
          return mu + sigma * mag * Math.cos(2 * Math.PI * v);
        },
        get seed() { return s; },
        set seed(v) { s = v >>> 0; spare = null; },
      };
    },

    /** Zeit: Sim-Sekunden ab Montag 00:00 */
    hm(str) { const [h, m] = str.split(':').map(Number); return h * 3600 + m * 60; },
    dayStart: (t) => Math.floor(t / 86400) * 86400,
    fmtClock(t) {
      const s = ((t % 86400) + 86400) % 86400;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    },
    fmtDayClock(t) { return DAYS[Math.floor(t / 86400) % 7] + ' ' + util.fmtClock(t); },
    fmtDay(t) { return DAYS[Math.floor(t / 86400) % 7]; },
    /** Termin relativ: "heute 13:30", "morgen 10:00", "Mi 14:00" */
    fmtDue(t, now) {
      const d = Math.floor(t / 86400) - Math.floor(now / 86400);
      if (d === 0) return 'heute ' + util.fmtClock(t);
      if (d === 1) return 'morgen ' + util.fmtClock(t);
      if (d === -1) return 'gestern ' + util.fmtClock(t);
      // Wochenbezug, damit „Mi“ der nächsten Woche nicht früher wirkt als „Do“ dieser Woche
      const w = Math.floor(t / 604800) - Math.floor(now / 604800);
      if (w === 1) return 'nächste Woche ' + util.fmtDayClock(t);
      if (w === -1) return 'letzte Woche ' + util.fmtDayClock(t);
      if (w > 1) return 'in ' + w + ' Wochen ' + util.fmtDayClock(t);
      return util.fmtDayClock(t);
    },
    fmtDur(sec) {
      if (sec == null || !isFinite(sec)) return '–';
      sec = Math.max(0, Math.round(sec));
      if (sec < 60) return sec + ' s';
      const m = Math.round(sec / 60);
      if (m < 60) return m + ' min';
      const h = Math.floor(m / 60), r = m % 60;
      if (h >= 24) { const dd = Math.floor(h / 24), hh = h % 24; return dd + ' T' + (hh ? ' ' + hh + ' h' : ''); }
      return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') + ' min' : '');
    },
    fmtNum,
    fmtPct: (x, dec = 0) => (x == null || Number.isNaN(x)) ? '–' : fmtNum(x * 100, dec) + ' %',
    fmtEur: (n, dec = 0) => (n == null || Number.isNaN(n)) ? '–' : fmtNum(n, dec) + ' €',
    fmtKg: (n) => n >= 1000 ? fmtNum(n / 1000, 1) + ' t' : fmtNum(n, n < 10 ? 1 : 0) + ' kg',

    /** Fortlaufende, deterministische IDs je Präfix. resetUids() beim Sim-Reset. */
    uid(prefix) { uidCounter[prefix] = (uidCounter[prefix] || 0) + 1; return prefix + '-' + String(uidCounter[prefix]).padStart(4, '0'); },
    resetUids() { uidCounter = {}; },

    /** Dijkstra auf dem Wegenetz {nodes:{id:{x,z}}, edges:[[a,b]]}. Ergebnis gecacht. */
    path(graph, from, to) {
      if (!graph._adj) {
        const adj = {};
        for (const id in graph.nodes) adj[id] = [];
        for (const [a, b] of graph.edges) {
          const d = util.dist(graph.nodes[a], graph.nodes[b]);
          adj[a].push([b, d]); adj[b].push([a, d]);
        }
        Object.defineProperty(graph, '_adj', { value: adj, enumerable: false });
        Object.defineProperty(graph, '_cache', { value: new Map(), enumerable: false });
      }
      const key = from + '>' + to;
      const hit = graph._cache.get(key);
      if (hit) return hit;
      const dist = { [from]: 0 }, prev = {}, done = new Set();
      const open = [from];
      while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        const u = open.splice(bi, 1)[0];
        if (u === to) break;
        if (done.has(u)) continue;
        done.add(u);
        for (const [v, w] of graph._adj[u] || []) {
          const nd = dist[u] + w;
          if (dist[v] == null || nd < dist[v]) { dist[v] = nd; prev[v] = u; open.push(v); }
        }
      }
      let res;
      if (dist[to] == null) res = { nodes: [from], points: [graph.nodes[from]], length: 0, ok: false };
      else {
        const nodes = [to];
        while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
        res = { nodes, points: nodes.map(n => graph.nodes[n]), length: dist[to], ok: true };
      }
      graph._cache.set(key, res);
      return res;
    },
    nearestNode(graph, x, z) {
      let best = null, bd = Infinity;
      for (const id in graph.nodes) {
        const n = graph.nodes[id], d = Math.hypot(n.x - x, n.z - z);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    },
    /** Stabiler Hash (für Determinismus-Tests). */
    hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); },
  };

  // ------------------------------------------------------------------ Event-Bus
  const handlers = {};
  WF.bus = {
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => WF.bus.off(type, fn); },
    off(type, fn) { const l = handlers[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(type, payload) {
      const l = handlers[type]; if (!l) return;
      for (const fn of l.slice()) { try { fn(payload); } catch (e) { (G.console || console).error('[bus]', type, e); } }
    },
  };

  // ------------------------------------------------------------------ Zustände
  WF.STATE = {
    running:      { label: 'Produktion',            color: 'var(--st-run)',   group: 'prod' },
    setup:        { label: 'Rüsten',                color: 'var(--st-setup)', group: 'setup' },
    firstPiece:   { label: 'Erstteilprüfung',       color: 'var(--st-setup)', group: 'setup' },
    toolchange:   { label: 'Werkzeugwechsel',       color: 'var(--st-tool)',  group: 'setup' },
    waitTool:     { label: 'Wartet auf Werkzeug',   color: 'var(--st-wait)',  group: 'wait' },
    waitOperator: { label: 'Wartet auf Bediener',   color: 'var(--st-wait)',  group: 'wait' },
    starved:      { label: 'Wartet auf Material',   color: 'var(--st-wait)',  group: 'wait' },
    blocked:      { label: 'Ausgang voll',          color: 'var(--st-wait)',  group: 'wait' },
    fault:        { label: 'Störung',               color: 'var(--st-fault)', group: 'fault' },
    idle:         { label: 'Bereit',                color: 'var(--st-idle)',  group: 'idle' },
  };
  /** Rohe Hex-Farben der Zustände (für Canvas/WebGL, wo CSS-Variablen nicht greifen). */
  WF.STATE_HEX = {
    running: '#34d399', setup: '#60a5fa', firstPiece: '#60a5fa', toolchange: '#b18cff',
    waitTool: '#fbbf24', waitOperator: '#fbbf24', starved: '#fbbf24', blocked: '#fbbf24',
    fault: '#f87171', idle: '#7b8aa8',
  };
  WF.SEV = {
    info: { label: 'Info', color: 'var(--info)' },
    ok:   { label: 'Erledigt', color: 'var(--st-run)' },
    warn: { label: 'Warnung', color: 'var(--st-wait)' },
    crit: { label: 'Kritisch', color: 'var(--st-fault)' },
  };

  // ------------------------------------------------------------------ View-/Detail-Registry
  WF.views = WF.views || [];
  WF.details = WF.details || {};
  WF.registerView = (def) => { WF.views.push(def); WF.views.sort((a, b) => (a.order || 99) - (b.order || 99)); };
  WF.registerDetail = (kind, factory) => { WF.details[kind] = factory; };

  // ------------------------------------------------------------------ UI-Helfer (nur Browser)
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const injected = new Set();
  const ui = WF.ui = {
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]),
    /** el('div', {class:'x', onclick:fn, html:'<b>..</b>'}, child1, 'text') */
    el(tag, attrs, ...children) {
      const e = document.createElement(tag);
      if (attrs) for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : v);
      }
      for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
      return e;
    },
    css(text, key) {
      const k = key || text;
      if (injected.has(k) || typeof document === 'undefined') return;
      injected.add(k);
      const s = document.createElement('style'); s.textContent = text; document.head.append(s);
    },
    initials: (name) => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    pill(stateKey, labelOverride) {
      const st = WF.STATE[stateKey] || { label: stateKey, color: 'var(--st-idle)' };
      return `<span class="pill" style="--c:${st.color}"><i></i>${ui.esc(labelOverride || st.label)}</span>`;
    },
    /** Zeitstempel einer Benachrichtigung – überall gleich: Entstehungszeit, ggf. „aktualisiert hh:mm“ (UI_GUIDE Regel 2). */
    notifTime(n, opt = {}) {
      if (!n) return '';
      const t0 = WF.util.fmtClock(n.t);
      const up = n.updatedT != null && n.updatedT - n.t > 60 ? WF.util.fmtClock(n.updatedT) : '';
      if (opt.text) return t0 + (up ? ' · aktualisiert ' + up : '');
      return ui.esc(t0) + (up ? ` <span class="n-upd" style="color:var(--faint)">· aktualisiert ${ui.esc(up)}</span>` : '');
    },
    sevPill(sev, text) {
      const s = WF.SEV[sev] || WF.SEV.info;
      return `<span class="pill" style="--c:${s.color}"><i></i>${ui.esc(text || s.label)}</span>`;
    },
    bar(frac, opts = {}) {
      const f = util.clamp(frac || 0, 0, 1);
      return `<span class="bar${opts.thin ? ' thin' : ''}" style="--c:${opts.color || 'var(--accent)'}"><i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
    },
    /** Sparkline als SVG-String. */
    spark(values, o = {}) {
      const w = o.w || 120, h = o.h || 28, pad = 2;
      const vals = (values || []).filter(v => v != null && isFinite(v));
      if (vals.length < 2) return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`;
      const min = o.min != null ? o.min : Math.min(...vals), max = o.max != null ? o.max : Math.max(...vals);
      const span = max - min || 1;
      const X = i => pad + i / (vals.length - 1) * (w - 2 * pad);
      const Y = v => h - pad - (v - min) / span * (h - 2 * pad);
      const pts = vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
      const col = o.color || 'var(--info)';
      const area = `M${X(0).toFixed(1)},${h - pad} L${pts.split(' ').join(' L')} L${X(vals.length - 1).toFixed(1)},${h - pad} Z`;
      const lx = X(vals.length - 1), ly = Y(vals[vals.length - 1]);
      return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
        (o.fill !== false ? `<path d="${area}" style="fill:${col}" opacity=".14"/>` : '') +
        `<polyline points="${pts}" style="fill:none;stroke:${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.4" style="fill:${col}"/></svg>`;
    },
    /** Zustandsband: Segmente [{t0,t1,state}] im Fenster [t0,t1]. */
    stateBand(segments, t0, t1, o = {}) {
      const w = o.w || 240, h = o.h || 10, span = Math.max(1, t1 - t0);
      let rects = '';
      for (const s of segments || []) {
        const a = Math.max(t0, s.t0), b = Math.min(t1, s.t1 == null ? t1 : s.t1);
        if (b <= a) continue;
        const x = (a - t0) / span * w, ww = Math.max(0.6, (b - a) / span * w);
        rects += `<rect x="${x.toFixed(2)}" y="0" width="${ww.toFixed(2)}" height="${h}" fill="${WF.STATE_HEX[s.state] || '#555'}"/>`;
      }
      return `<svg class="band" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><rect width="${w}" height="${h}" style="fill:var(--track)"/>${rects}</svg>`;
    },
    icon(name, size = 18) {
      const p = ICONS[name] || ICONS.dot;
      return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    },
  };

  // Einfache Linien-Icons (24er Raster)
  const ICONS = {
    dot: '<circle cx="12" cy="12" r="3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    box: '<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4 1.4.6-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    fast: '<path d="M4 5v14l8-7zM12 5v14l8-7z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    truck: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    factory: '<path d="M2 20V9l6 4V9l6 4V4h4l2 16z"/><path d="M6 17h2M11 17h2M16 17h2"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    gauge: '<path d="M12 14 16 9"/><path d="M3.3 19a10 10 0 1 1 17.4 0z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="m17 2-5 5-5-5"/>',
  };
  WF.ICONS = ICONS;
})();
