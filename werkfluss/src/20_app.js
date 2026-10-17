/* werkfluss – App-Shell: Kopfzeile, Navigation, Ansichtswechsel, Echtzeit-Schleife, Detail-Drawer,
   Benachrichtigungscenter, Toasts, Einstellungen, Modal-Helfer. */
(function () {
  const WF = window.WF;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;

  const STORE_KEY = 'werkfluss.settings.v1';
  const defaults = { companyName: null, site: null, speed: null, lastView: 'leitstand' };
  let settings = { ...defaults };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* Speicher nicht verfügbar */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignorieren */ } };

  const GROUPS = { betrieb: 'Betrieb', ressourcen: 'Ressourcen', einrichtung: 'Einrichtung', ki: 'KI' };

  const app = WF.app = {
    settings,
    current: null,
    selected: null,
    paused: false,
    speed: 30,
  };

  // ------------------------------------------------------------ Hilfen
  app.company = () => ({
    name: settings.companyName || WF.profile.company.name,
    site: settings.site || (WF.profile.company.site + ' · ' + WF.profile.company.address),
  });
  /** Lesbarer Name für eine Entität {kind,id}. */
  app.entityLabel = (ent) => {
    if (!ent) return '';
    const P = WF.profile, S = WF.sim && WF.sim.state;
    switch (ent.kind) {
      case 'machine': { const s = P.stationById[ent.id]; return s ? s.short + ' (' + ent.id + ')' : ent.id; }
      case 'order': { const o = S && S.orders && S.orders[ent.id]; return ent.id + (o && o.part ? ' · ' + o.part.name : ''); }
      case 'person': { const p = P.people.find(x => x.id === ent.id); return p ? p.name : ent.id; }
      case 'agv': { const a = P.agvs.find(x => x.id === ent.id); return a ? a.name : ent.id; }
      case 'material': { const m = P.materials.find(x => x.id === ent.id); return m ? m.name : ent.id; }
      case 'tool': return ent.id;
      default: return ent.id;
    }
  };

  // ------------------------------------------------------------ Kopfzeile
  const LOGO = `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="#152036" stroke="#2d3e5f"/><path d="M6 21c4 0 5-10 10-10s6 10 10 10" fill="none" stroke="#3cc6f2" stroke-width="2.6" stroke-linecap="round"/><circle cx="6" cy="21" r="2.3" fill="#ff9d3d"/><circle cx="26" cy="21" r="2.3" fill="#34d399"/></svg>`;
  let topRefs = {};
  function buildTop() {
    const top = document.getElementById('top');
    const c = app.company();
    top.innerHTML = `
      <div class="brand">${LOGO}<span>werk<b>fluss</b></span></div>
      <span class="sep"></span>
      <div class="company"><strong id="t-company">${esc(c.name)}</strong><span id="t-site">${esc(c.site)}</span></div>
      <button class="btn ghost tv-exit" id="t-tvexit" title="TV-Modus beenden (Esc)">${icon('x', 15)}<span>TV-Modus beenden</span></button>
      <div class="clock"><span class="time" id="t-time">--:--</span><span class="shift-chip" id="t-shift">–</span></div>
      <div class="speed" role="group" aria-label="Simulationstempo">
        <button class="play" id="t-play" title="Pause / Weiter (P)">${icon('pause', 15)}</button>
        ${WF.profile.sim.speeds.map(s => `<button class="sp" data-speed="${s}" title="Simulation ${s}× schneller als Echtzeit">${s}×</button>`).join('')}
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="t-bell" title="Benachrichtigungen" aria-label="Benachrichtigungen">${icon('bell')}<span class="count" id="t-count" hidden>0</span></button>
        ${WF.tour ? `<button class="btn ghost t-tour" id="t-tour" title="Geführte Demo-Tour starten (#tour)" aria-label="Demo-Tour">${icon('route', 16)}<span>Tour</span></button>` : ''}
        <button class="btn-ai" id="t-ai" title="KI-Copilot öffnen">${icon('sparkles', 17)}<span>Copilot</span></button>
        <button class="icon-btn" id="t-settings" title="Einstellungen" aria-label="Einstellungen">${icon('settings')}</button>
      </div>`;
    topRefs = { time: top.querySelector('#t-time'), shift: top.querySelector('#t-shift'), count: top.querySelector('#t-count'), play: top.querySelector('#t-play'), company: top.querySelector('#t-company'), site: top.querySelector('#t-site') };
    top.querySelector('#t-play').onclick = () => app.togglePause();
    top.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
      const speeds = WF.profile.sim.speeds, sp = Number(b.dataset.speed);
      // Schmale Ansicht: nur der aktive Knopf ist sichtbar – Tippen schaltet zum nächsten Tempo
      if (sp === app.speed && window.matchMedia('(max-width: 560px)').matches) app.setSpeed(speeds[(speeds.indexOf(sp) + 1) % speeds.length]);
      else app.setSpeed(sp);
    });
    top.querySelector('#t-bell').onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
    top.querySelector('#t-ai').onclick = () => WF.bus.emit('ai:open', {});
    const tb = top.querySelector('#t-tour'); if (tb) tb.onclick = () => WF.tour.start();
    top.querySelector('#t-settings').onclick = () => openSettings();
    top.querySelector('#t-tvexit').onclick = () => app.setTv(false);
    markSpeed();
  }
  function markSpeed() {
    document.querySelectorAll('#top [data-speed]').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === app.speed));
    if (topRefs.play) topRefs.play.innerHTML = icon(app.paused ? 'play' : 'pause', 15);
  }
  function updateTop() {
    const sim = WF.sim; if (!sim || !sim.state) return;
    topRefs.time.textContent = sim.clock ? sim.clock() : U.fmtDayClock(sim.state.t);
    let sh = null; try { sh = sim.shift ? sim.shift() : null; } catch (e) { sh = null; }
    if (sh) {
      const label = sh.name ? sh.name + (sh.inBreak ? ' · Pause' : '') : 'Keine Schicht';
      topRefs.shift.textContent = label;
      topRefs.shift.classList.toggle('break', !!sh.inBreak);
    }
    const open = (sim.state.notifications || []).filter(n => n.status === 'open' && (n.sev === 'crit' || n.sev === 'warn'));
    const crit = open.filter(n => n.sev === 'crit').length;
    topRefs.count.hidden = open.length === 0;
    topRefs.count.textContent = String(open.length);
    topRefs.count.classList.toggle('warn', crit === 0);
  }

  app.setSpeed = (s) => { app.speed = s; settings.speed = s; save(); markSpeed(); };
  app.togglePause = (force) => { app.paused = force != null ? force : !app.paused; markSpeed(); };

  // ------------------------------------------------------------ Navigation & Ansichten
  /** Tasten: 1–9 = Ansichten mit ganzzahliger Reihenfolge 1–9, 0 = Analyse (Reihenfolge 3,5). */
  function keyOf(v) { return Number.isInteger(v.order) && v.order >= 1 && v.order <= 9 ? String(v.order) : (v.id === 'analyse' ? '0' : null); }
  function viewForKey(k) { return WF.views.find(v => keyOf(v) === k); }
  const viewState = {}; // id -> {root, mounted}
  function buildNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    let lastGroup = null;
    for (const v of WF.views) {
      const g = v.group || 'betrieb';
      if (g !== lastGroup) { nav.append(el('div', { class: 'nav-label', text: GROUPS[g] || g })); lastGroup = g; }
      const b = el('button', { class: 'nav-item', 'data-view': v.id, title: v.title + (keyOf(v) ? ' · Taste ' + keyOf(v) : ''), html: icon(v.icon || 'dot') + `<span class="nav-t">${esc(v.title)}</span><span class="nav-s">${esc(v.short || v.title.split(' & ')[0])}</span><span class="badge" data-badge="${v.id}"></span>` });
      b.onclick = () => app.navigate(v.id);
      nav.append(b);
    }
    const foot = el('div', { class: 'side-foot', html:
      `<div class="edge"><i></i>Edge-Gateways verbunden</div>${esc(WF.profile.company.demoNote)}` });
    nav.append(foot);
  }
  app.navigate = (id, params) => {
    const v = WF.views.find(x => x.id === id) || WF.views[0];
    if (!v) return;
    const host = document.getElementById('views');
    if (app.current && app.current !== v) {
      const prev = viewState[app.current.id];
      if (prev) prev.root.hidden = true;
      try { app.current.hide && app.current.hide(); } catch (e) { console.error(e); }
    }
    let vs = viewState[v.id];
    if (!vs) {
      const root = el('section', { class: 'view' + (v.full ? ' full' : ''), id: 'view-' + v.id, 'aria-label': v.title });
      host.append(root);
      vs = viewState[v.id] = { root, mounted: false };
    }
    vs.root.hidden = false;
    app.current = v;
    if (!vs.mounted) { vs.mounted = true; try { v.mount(vs.root); } catch (e) { console.error('[view mount]', v.id, e); vs.root.append(el('div', { class: 'empty', text: 'Ansicht konnte nicht geladen werden: ' + e.message })); } }
    try { v.show && v.show(params || {}); } catch (e) { console.error(e); }
    try { v.update && v.update(); } catch (e) { console.error(e); }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.view === v.id));
    const onItem = document.querySelector('.nav-item.on');
    if (onItem && window.matchMedia('(max-width: 900px)').matches) { try { onItem.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { /* alt */ } }
    settings.lastView = v.id; save();
    if (location.hash !== '#' + v.id) { try { history.replaceState(null, '', '#' + v.id); } catch (e) { /* Sandbox */ } }
    WF.bus.emit('navigate', { view: v.id, params: params || {} });
  };
  function updateBadges() {
    for (const v of WF.views) {
      if (!v.badge) continue;
      const b = document.querySelector(`[data-badge="${v.id}"]`);
      if (!b) continue;
      let txt = ''; try { txt = String(v.badge() || ''); } catch (e) { txt = ''; }
      if (b.dataset.raw === txt) continue;
      b.dataset.raw = txt;
      // Ein Stil: Verhältnis (11/13) gedämpft, sonst Zähler-Pill nach Schwere; Langtext im Tooltip
      const num = (txt.match(/\d+/) || [''])[0];
      const ratio = /^\s*\d+\s*\/\s*\d+\s*$/.test(txt);
      const sev = /spät|Störung|kritisch/i.test(txt) ? 'crit' : 'warn';
      b.className = 'badge' + (txt ? (ratio ? ' ratio' : ' pill-' + sev) : '');
      b.textContent = ratio ? txt.replace(/\s+/g, '') : num;
      b.title = txt ? v.title + ': ' + txt : '';
    }
  }

  // ------------------------------------------------------------ Detail-Drawer
  // Fokus (Tastatur): Beim Öffnen springt der Fokus auf den Drawer-Titel (Tab erreicht dann den Inhalt), beim Schließen
  // zurück auf das auslösende Element (Kachel, Tabellenzeile …). Wer gerade tippt (Copilot, Suche) oder die Tour bedient,
  // behält den Fokus. Geschlossen ist der Drawer „inert“ – seine Knöpfe liegen nicht unsichtbar in der Tab-Reihenfolge.
  const drawer = () => document.getElementById('drawer');
  let drawerSpec = null, drawerBody = null, drawerOpener = null;
  const isTyping = (n) => !!(n && n.nodeType === 1 && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)));
  /** Element sichtbar und bedienbar (nicht ausgeblendet, nicht in einem inerten Bereich)? */
  const focusable = (n) => !!(n && n.isConnected && typeof n.focus === 'function' && n.getClientRects().length && !n.closest('[inert],[hidden]'));
  app.select = (kind, id) => {
    app.selected = { kind, id };
    WF.bus.emit('select', { kind, id });
    openDetail(kind, id);
  };
  function openDetail(kind, id, refresh) {
    const factory = WF.details[kind];
    const d = drawer();
    let spec;
    try { spec = factory ? factory(id) : null; } catch (e) { console.error('[detail]', kind, id, e); spec = null; }
    if (!spec) spec = { title: app.entityLabel({ kind, id }), subtitle: kind, render: (b) => { b.append(el('div', { class: 'empty', text: 'Keine Detailansicht verfügbar.' })); } };
    const ae = document.activeElement, wasOpen = d.classList.contains('open'), hadFocus = d.contains(ae);
    if (!wasOpen && ae && ae !== document.body && !hadFocus) drawerOpener = ae;
    drawerSpec = spec;
    d.innerHTML = '';
    const title = el('div', { class: 't', id: 'drawer-title', tabindex: '-1', text: spec.title || '' });
    const head = el('div', { class: 'drawer-h' },
      el('div', { style: { flex: '1', minWidth: '0' } }, title, el('div', { class: 's', html: spec.subtitle || '' })),
      WF.ai ? el('button', { class: 'icon-btn', title: 'Den Copilot dazu fragen', 'aria-label': 'Copilot fragen', html: icon('sparkles', 17),
        onclick: () => WF.bus.emit('ai:ask', { text: spec.askPrompt || ('Gib mir eine kurze Lageeinschätzung zu ' + app.entityLabel({ kind, id }) + ': was passiert gerade, was ist kritisch, was empfiehlst du?'), context: { kind, id } }) }) : null,
      el('button', { class: 'icon-btn', title: 'Schließen (Esc)', 'aria-label': 'Details schließen', html: icon('x'), onclick: () => app.closeDrawer() }));
    drawerBody = el('div', { class: 'drawer-b' });
    d.append(head, drawerBody);
    try { spec.render(drawerBody); } catch (e) { console.error('[detail render]', e); drawerBody.append(el('div', { class: 'empty', text: 'Fehler: ' + e.message })); }
    d.inert = false;
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    // Fokus in den Drawer – außer jemand tippt gerade oder bedient Tour/Copilot (deren Fokus bleibt)
    const keep = !hadFocus && (isTyping(ae) || (ae && ae.closest && ae.closest('.tour-card, .ai-panel, .modal-back, .notif-panel')));
    if (hadFocus || (!refresh && !keep)) { try { title.focus({ preventScroll: true }); } catch (e) { /* alt */ } }
  }
  /** Fokus beim Schließen zurückgeben (nur wenn er im Drawer lag – wer inzwischen woanders ist, bleibt dort) */
  function releaseDrawer() {
    const d = drawer(), op = drawerOpener;
    drawerOpener = null;
    if (d.contains(document.activeElement)) {
      if (focusable(op)) { try { op.focus({ preventScroll: true }); } catch (e) { /* alt */ } }
      else { try { document.activeElement.blur(); } catch (e) { /* alt */ } }
    }
    d.inert = true;
  }
  /** Drawer ausblenden, Auswahl (z. B. hervorgehobener Auftrag in der Halle) aber behalten. */
  app.hideDrawer = () => {
    const d = drawer(); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); drawerSpec = null;
    document.body.classList.remove('drawer-open');
    releaseDrawer();
  };
  app.closeDrawer = () => {
    const d = drawer(); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    releaseDrawer();
    drawerSpec = null; app.selected = null; WF.bus.emit('select', { kind: null, id: null });
  };
  app.refreshDrawer = () => { if (app.selected) openDetail(app.selected.kind, app.selected.id, true); };

  // ------------------------------------------------------------ Aktionen aus Benachrichtigungen
  app.runAction = (action) => {
    if (!action || !WF.sim || !WF.sim.actions) return { ok: false, msg: 'Keine Aktion' };
    const { type, args, ...rest } = action;
    if (type === 'select' || type === 'open') { app.select(rest.kind, rest.id); return { ok: true }; }
    if (type === 'navigate') { app.navigate(rest.view, rest.params); return { ok: true }; }
    if (typeof WF.sim.actions.run === 'function') {
      // Engine kennt die Parameter ihrer eigenen Aktionen (Benachrichtigungs-Buttons)
      let r; try { r = WF.sim.actions.run(action); } catch (e) { r = { ok: false, msg: e.message }; }
      const okR = !(r && r.ok === false);
      app.toast((r && r.msg) || (okR ? 'Ausgeführt' : 'Nicht möglich'), okR ? 'ok' : 'warn');
      return r;
    }
    const fn = WF.sim.actions[type];
    if (typeof fn !== 'function') return { ok: false, msg: 'Unbekannte Aktion ' + type };
    let res;
    try { res = fn.apply(null, Array.isArray(args) ? args : Object.values(rest)); } catch (e) { res = { ok: false, msg: e.message }; }
    const ok = !(res && res.ok === false);
    app.toast((res && res.msg) || (ok ? 'Ausgeführt' : 'Nicht möglich'), ok ? 'ok' : 'warn');
    return res;
  };

  // ------------------------------------------------------------ Benachrichtigungscenter
  let npEl = null, npFilter = 'open', npSig = '';
  function toggleNotifPanel(force) {
    const show = force != null ? force : !npEl;
    document.body.classList.toggle('np-open', !!show);
    if (!show) { if (npEl) npEl.remove(); npEl = null; return; }
    // offene Toasts wegräumen – das Panel zeigt dieselben Meldungen
    const tb = document.getElementById('toasts'); if (tb) tb.innerHTML = '';
    npEl = el('div', { class: 'notif-panel', role: 'dialog', 'aria-label': 'Benachrichtigungen' });
    npEl.addEventListener('click', e => e.stopPropagation());
    document.getElementById('app').append(npEl);
    npSig = '';
    renderNotifPanel(true);
  }
  const SEV_LABEL = { crit: 'Kritisch', warn: 'Warnung', info: 'Info', ok: 'Erledigt' };
  function notifCard(n) {
    const S = WF.SEV[n.sev] || WF.SEV.info;
    // Kopfzeile kurz halten (wie im Leitstand): nur die ID, voller Name im Tooltip
    const ent = n.entity && n.entity.id && n.entity.kind !== 'plant' && n.entity.kind !== 'werk' && n.entity.id !== 'werk' ? `<button class="link n-ent" data-ent="${esc(n.entity.kind)}|${esc(n.entity.id)}" title="${esc(app.entityLabel(n.entity))} öffnen">${esc(n.entity.id)}</button>` : '';
    const acts = (n.actions || []).map((a, i) => `<button class="btn sm${i === 0 && n.status !== 'resolved' ? ' primary' : ''}" data-act="${i}">${esc(a.label)}</button>`).join('');
    const status = n.status === 'ack' ? 'quittiert' + (n.ackBy ? ' von ' + esc(n.ackBy) : '') + ' · Ursache besteht noch' : n.status === 'resolved' ? 'erledigt' + (n.resolvedT ? ' ' + U.fmtClock(n.resolvedT) : '') : '';
    return `<div class="notif ${esc(n.status)}" style="--c:${S.color}" data-id="${esc(n.id)}">
      <div class="n-top"><span class="n-sev" style="color:${S.color}">${SEV_LABEL[n.sev] || ''}</span><span class="n-when">${WF.ui.notifTime(n)}${n.role ? ' · ' + esc(n.role) : ''}</span><span class="spacer"></span>${ent}</div>
      <div class="n-t">${esc(n.title)}</div>
      ${n.body ? `<div class="n-b">${esc(n.body)}</div>` : ''}
      ${n.suggestion ? `<div class="n-s"><b>Empfehlung</b> ${esc(n.suggestion)}</div>` : ''}
      <div class="n-a">${acts}${n.status === 'open' ? '<button class="btn sm ghost" data-ack>Quittieren</button>' : ''}<span class="spacer"></span>${status ? `<span class="muted" style="font-size:var(--fs-xs);align-self:center">${status}</span>` : ''}${WF.ai && n.status !== 'resolved' ? `<button class="btn sm ghost" data-ai>${icon('sparkles', 14)} Ursache analysieren</button>` : ''}</div>
    </div>`;
  }
  const isImportant = (n) => n.sev === 'crit' || n.sev === 'warn';
  function renderNotifPanel(force) {
    if (!npEl || !WF.sim) return;
    const all = (WF.sim.state.notifications || []).slice().sort((a, b) => (b.updatedT || b.t) - (a.updatedT || a.t));
    const imp = all.filter(n => n.status === 'open' && isImportant(n)), inf = all.filter(n => n.status === 'open' && !isImportant(n));
    const list = npFilter === 'open' ? imp : npFilter === 'info' ? inf : all.slice(0, 80);
    const sig = npFilter + '|' + list.map(n => n.id + n.status).join(',');
    if (!force && sig === npSig) return;
    npSig = sig;
    npEl.innerHTML = `<div class="np-h"><strong>Benachrichtigungen</strong><span class="spacer"></span>
      <div class="seg"><button data-f="open" class="${npFilter === 'open' ? 'on' : ''}">Wichtig (${imp.length})</button><button data-f="info" class="${npFilter === 'info' ? 'on' : ''}">Info (${inf.length})</button><button data-f="all" class="${npFilter === 'all' ? 'on' : ''}">Verlauf</button></div>
      <button class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button></div>
      <div class="notif-list">${list.length ? list.map(notifCard).join('') : `<div class="empty">${npFilter === 'open' ? 'Keine offenen Warnungen – alles im grünen Bereich.' : npFilter === 'info' ? 'Keine offenen Hinweise.' : 'Noch keine Meldungen.'}</div>`}</div>`;
    npEl.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { npFilter = b.dataset.f; renderNotifPanel(true); });
    npEl.querySelector('[data-close]').onclick = () => toggleNotifPanel(false);
    npEl.querySelectorAll('.notif').forEach(card => {
      const n = all.find(x => x.id === card.dataset.id); if (!n) return;
      const ack = card.querySelector('[data-ack]');
      if (ack) ack.onclick = () => { WF.sim.actions.ack && WF.sim.actions.ack(n.id, 'Schichtleitung'); renderNotifPanel(true); updateTop(); };
      const ent = card.querySelector('[data-ent]');
      if (ent) ent.onclick = () => { const [k, i] = ent.dataset.ent.split('|'); app.select(k, i); };
      card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { app.runAction(n.actions[Number(b.dataset.act)].action); renderNotifPanel(true); });
      const ai = card.querySelector('[data-ai]');
      if (ai) ai.onclick = () => WF.bus.emit('ai:ask', { text: `Analysiere diese Benachrichtigung und sag mir Ursache, Auswirkung (Termin, Kosten) und was ich jetzt tun soll: „${n.title}“ – ${n.body || ''}`, context: { kind: 'notification', id: n.id, entity: n.entity } });
    });
  }
  document.addEventListener('click', () => { if (npEl) toggleNotifPanel(false); });

  // ------------------------------------------------------------ Toasts
  // Regeln: (1) Während der Demo-Tour keine Toasts – die Tour-Karte erzählt, die Glocke zählt weiter.
  // (2) Bestätigung einer Aktion und Meldung zur selben Entität innerhalb von 2 s nur einmal zeigen
  //     (die Meldung gewinnt, sie trägt Ursache und Folgen).
  let lastToast = 0;
  const ENT_RX = /\b(?:M\d{2}|FA-\d{4,6}|AGV\d+|MAT-[A-Z0-9]+|QS)\b/g;
  let recentToasts = []; // { t, ids:Set, el, notif }
  app.toast = (msg, sev = 'info', opts = {}) => {
    if (WF.tour && WF.tour.active && !opts.force) return null;
    const box = document.getElementById('toasts');
    if (!box) return null;
    const now = performance.now();
    recentToasts = recentToasts.filter(r => now - r.t < 2000 && r.el.isConnected);
    const ids = new Set(String((opts.title || '') + ' ' + (msg || '')).match(ENT_RX) || []);
    if (opts.entity && opts.entity.id) ids.add(opts.entity.id);
    if (ids.size) {
      const dup = recentToasts.find(r => r.notif !== !!opts.notif && [...r.ids].some(i => ids.has(i)));
      if (dup && !opts.notif) return dup.el;          // Meldung sagt es bereits
      if (dup && opts.notif) dup.el.remove();         // Meldung ersetzt die kurze Bestätigung
    }
    const S = WF.SEV[sev] || WF.SEV.info;
    const t = el('div', { class: 'toast', style: { '--c': S.color }, role: 'status' },
      el('div', { class: 'tt', text: opts.title || msg }), opts.title ? el('div', { class: 'tb', text: msg }) : null);
    t.onclick = () => { if (opts.onClick) opts.onClick(); t.remove(); };
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), opts.ms || 5200);
    recentToasts.push({ t: now, ids, el: t, notif: !!opts.notif });
    return t;
  };
  const SEV_RANK = { info: 0, ok: 0, warn: 1, crit: 2 };
  const toasted = new Map(); // key → höchste getoastete Schwere
  function markExisting() { for (const n of (WF.sim && WF.sim.state && WF.sim.state.notifications) || []) toasted.set(n.key || n.id, SEV_RANK[n.sev] || 0); }
  let quiet = false; // Neustart: Meldungen des Vorrechnens (06:00–08:40) nicht als Toasts zeigen
  function onNotify(n) {
    if (quiet || !n || n.status !== 'open' || (n.sev !== 'crit' && n.sev !== 'warn')) return;
    const key = n.key || n.id, rank = SEV_RANK[n.sev] || 0;
    if (toasted.has(key) && toasted.get(key) >= rank) return; // bekannt und nicht schwerer geworden
    toasted.set(key, rank);
    // Tour: nichts über die Karte legen – kritische Meldungen zeigt die Karte selbst als Hinweiszeile
    if (WF.tour && WF.tour.active) { if (n.sev === 'crit' && WF.tour.notify) { try { WF.tour.notify(n); } catch (e) { console.error(e); } } return; }
    // Gesammelt ausgeben: bei hohem Tempo / Vorspulen kommen viele Meldungen in einem Tick –
    // nur noch offene und frische zeigen, höchstens zwei, Rest als Sammelhinweis.
    pendingToasts.push(n);
    if (!flushTimer) flushTimer = setTimeout(flushToasts, 60);
  }
  let pendingToasts = [], flushTimer = null;
  function flushToasts() {
    flushTimer = null;
    const list = pendingToasts; pendingToasts = [];
    const simT = WF.sim.state ? WF.sim.state.t : 0;
    const fresh = list.filter(n => n.status === 'open' && !(n.resolvedT != null) && simT - (n.updatedT || n.t) <= 15 * 60)
      .sort((a, b) => (SEV_RANK[b.sev] || 0) - (SEV_RANK[a.sev] || 0) || (b.updatedT || b.t) - (a.updatedT || a.t));
    if (!fresh.length) return;
    const now = performance.now();
    let shown = 0;
    for (const n of fresh) {
      if (shown >= 2) break;
      if (n.sev !== 'crit' && now - lastToast < 2500) continue;
      lastToast = now; shown++;
      app.toast(n.body || '', n.sev, { title: n.title, notif: true, entity: n.entity, onClick: () => { if (n.entity && n.entity.id) app.select(n.entity.kind, n.entity.id); } });
    }
    const rest = fresh.length - shown;
    if (rest > 0 && shown > 0) app.toast(`${rest} weitere ${rest === 1 ? 'Meldung' : 'Meldungen'} – in der Glocke`, 'info', { title: '', onClick: () => toggleNotifPanel(true) });
  }

  // ------------------------------------------------------------ Modal
  // Fokus: beim Öffnen auf das erste Eingabefeld (sonst Hauptaktion, sonst Schließen; auf Touch-Geräten auf den Dialog
  // selbst, damit keine Tastatur aufspringt), Tab bleibt im Dialog, beim Schließen zurück zum Auslöser.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let modalSeq = 0;
  app.modal = ({ title, body, actions = [], width }) => {
    const opener = document.activeElement;
    const back = el('div', { class: 'modal-back' });
    const tid = 'modal-t-' + (++modalSeq);
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, tabindex: '-1', style: width ? { width: `min(${width}px, 100%)` } : null });
    const isTop = () => back.isConnected && back === document.querySelector('#overlay .modal-back:last-child');
    const tabbables = () => [...m.querySelectorAll(FOCUSABLE)].filter(focusable);
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const list = tabbables(), a = document.activeElement;
      if (!list.length) { e.preventDefault(); m.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (!m.contains(a) || a === m) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      const had = m.contains(document.activeElement) || document.activeElement === document.body;
      back.remove(); document.removeEventListener('keydown', onKey, true);
      // Fokus zurück: zum Auslöser, sonst zum darunterliegenden Dialog
      if (had) {
        const below = document.querySelector('#overlay .modal-back:last-child .modal');
        const target = focusable(opener) ? opener : below;
        if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* alt */ } }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const b = el('div', { class: 'modal-b' });
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    const f = el('div', { class: 'modal-f' });
    // Aktionen: {label, primary, danger, ghost, left (links im Fuß), confirm:{text, label} (Bestätigungsschritt im Fuß)}
    // „Abbrechen“ ohne eigene Funktion wird automatisch zum ruhigen Ghost-Knopf.
    const run = (a) => { const r = a.onClick && a.onClick(); if (r !== false) close(); };
    const fillFooter = () => {
      f.className = 'modal-f'; f.innerHTML = '';
      for (const a of actions) {
        const ghost = a.ghost || (!a.onClick && !a.primary && /^abbrechen$/i.test(a.label));
        f.append(el('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + (ghost ? ' ghost' : '') + (a.left ? ' mf-left' : ''),
          html: (a.icon ? icon(a.icon, 15) : '') + esc(a.label), onclick: () => (a.confirm ? askConfirm(a) : run(a)) }));
      }
    };
    const askConfirm = (a) => {
      f.className = 'modal-f confirm'; f.innerHTML = '';
      const q = el('div', { class: 'mf-q', role: 'alert', html: icon('alert', 17) + `<span>${a.confirm.html || esc(a.confirm.text || 'Wirklich ausführen?')}</span>` });
      const no = el('button', { class: 'btn ghost', text: 'Abbrechen', onclick: () => { fillFooter(); } });
      const yes = el('button', { class: 'btn' + (a.danger ? ' danger' : ' primary'), text: a.confirm.label || a.label, onclick: () => run(a) });
      f.append(q, no, yes);
      try { yes.focus(); } catch (e) { /* alt */ }
    };
    fillFooter();
    m.append(el('div', { class: 'modal-h' }, el('strong', { id: tid, text: title }), el('span', { class: 'spacer' }), el('button', { class: 'icon-btn', 'aria-label': 'Schließen', title: 'Schließen (Esc)', html: icon('x'), onclick: close })), b);
    if (actions.length) m.append(f);
    back.append(m);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.getElementById('overlay').append(back);
    // Startfokus (der Aufrufer darf danach selbst fokussieren, z. B. Menge markieren)
    let coarse = false; try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* alt */ }
    const start = coarse ? m
      : b.querySelector('input:not([type="hidden"]):not([disabled]):not([type="checkbox"]):not([type="radio"]), select:not([disabled]), textarea:not([disabled])')
        || f.querySelector('.btn.primary') || m.querySelector('.modal-h .icon-btn') || m;
    try { (focusable(start) ? start : m).focus({ preventScroll: true }); } catch (e) { /* alt */ }
    return { close, body: b };
  };

  // ------------------------------------------------------------ Einstellungen
  function openSettings() {
    const c = app.company();
    const body = el('div', { class: 'stack' });
    body.innerHTML = `
      <p class="muted" style="margin:0">Für Vorführungen bei Interessenten können Firmenname und Standort angepasst werden. Die Fertigungsdaten bleiben simuliert.</p>
      <label class="field" for="set-company">Firmenname<input class="input" id="set-company" value="${esc(c.name)}" maxlength="60"></label>
      <label class="field" for="set-site">Standort<input class="input" id="set-site" value="${esc(c.site)}" maxlength="80"></label>
      <label class="field" for="set-speed">Simulationstempo
        <select class="input" id="set-speed">${WF.profile.sim.speeds.map(s => `<option value="${s}" ${s === app.speed ? 'selected' : ''}>${s}× Echtzeit${s === 30 ? ' (Standard)' : ''}</option>`).join('')}</select></label>
      <div class="card"><div class="card-b" style="font-size:var(--fs-sm);color:var(--text2)">
        <b>Über diese Demo.</b> ${esc(WF.profile.company.demoNote)} Profil: ${esc(WF.profile.company.description)}
        <br><span class="muted">werkfluss ${esc(WF.version)} · Simulation deterministisch (Seed ${WF.profile.sim.seed}) · <button type="button" class="link" data-keys>Tastenkürzel</button> <kbd class="kbd">?</kbd></span></div></div>`;
    body.querySelector('[data-keys]').onclick = () => openKeys();
    app.modal({ title: 'Einstellungen', body, actions: [
      { label: 'Simulation neu starten', icon: 'refresh', danger: true, ghost: true, left: true,
        confirm: { html: '<b>Simulation neu starten?</b> Die Schicht beginnt wieder Mo 06:00 (vorgerechnet bis 08:40). Alle Eingriffe dieser Sitzung – Störungen, Bestellungen, KI-Aufträge – werden zurückgesetzt.', label: 'Jetzt neu starten' },
        onClick: () => {
          quiet = true;
          try { WF.sim.actions && WF.sim.actions.reset ? WF.sim.actions.reset() : WF.sim.init(WF.profile); } finally { quiet = false; }
          app.closeDrawer();
          const box = document.getElementById('toasts'); if (box) box.innerHTML = ''; // Toasts der alten Sitzung
          app.toast('Simulation neu gestartet (Mo 06:00, vorgerechnet bis 08:40)', 'ok');
        } },
      { label: 'Abbrechen' },
      { label: 'Speichern', primary: true, onClick: () => {
        const n = body.querySelector('#set-company').value.trim(), s = body.querySelector('#set-site').value.trim();
        settings.companyName = n && n !== WF.profile.company.name ? n : null;
        settings.site = s && s !== (WF.profile.company.site + ' · ' + WF.profile.company.address) ? s : null;
        app.setSpeed(Number(body.querySelector('#set-speed').value));
        save();
        const cc = app.company(); topRefs.company.textContent = cc.name; topRefs.site.textContent = cc.site;
        WF.bus.emit('settings', settings);
        app.toast('Einstellungen gespeichert', 'ok');
      } },
    ] });
  }

  css(`.nav-item .badge.ratio{color:var(--muted);font-size:var(--fs-xs)}
       .nav-item .badge.pill-warn,.nav-item .badge.pill-crit{min-width:18px;height:18px;padding:0 5px;border-radius:9px;font:700 var(--fs-2xs)/18px var(--f-ui);text-align:center;color:#1a1204;background:var(--st-wait)}
       .nav-item .badge.pill-crit{background:var(--st-fault);color:#1b0606}
       .t-tour{height:36px;padding:0 11px;gap:6px}
       .notif .n-sev{font:700 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase}
       @media (max-width:1180px){.t-tour span{display:none}.t-tour{width:36px;padding:0}}
       @media (min-width:901px) and (max-width:1280px){.nav-item .badge.ratio{display:none!important}.nav-item .badge.pill-warn,.nav-item .badge.pill-crit{min-width:0;width:8px;height:8px;padding:0;font-size:0;top:7px;right:12px;box-shadow:0 0 0 2px var(--panel)}}
       @media (max-width:900px){.nav-item .badge.ratio{display:none!important}
         .nav-item .badge.pill-warn,.nav-item .badge.pill-crit{position:static;min-width:16px;height:16px;padding:0 4px;font:700 var(--fs-2xs)/16px var(--f-ui);margin-left:2px;width:auto;border-radius:8px}}`, 'app-badges');

  // ------------------------------------------------------------ TV-Modus (Leitstand an der Hallenwand)
  // Chrome und Typografie: styles.css (.app.tv). Beenden-Knopf in der Kopfzeile, sichtbar nur nach Maus-/Touch-Aktivität (3 s).
  let tvIdle = null, tvPtrAt = 0;
  function tvActivity() {
    if (!app.tv) return;
    const now = performance.now();
    if (now - tvPtrAt < 150) return; // pointermove feuert sehr oft
    tvPtrAt = now;
    document.getElementById('app').classList.add('tv-ptr');
    clearTimeout(tvIdle);
    tvIdle = setTimeout(() => { const a = document.getElementById('app'); if (a) a.classList.remove('tv-ptr'); }, 3000);
  }
  ['pointermove', 'pointerdown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, tvActivity, { passive: true }));
  app.setTv = (on) => {
    on = !!on;
    const a = document.getElementById('app');
    a.classList.toggle('tv', on); app.tv = on;
    document.body.classList.toggle('tv-on', on);
    clearTimeout(tvIdle); tvPtrAt = 0;
    if (on) {
      // Wandbildschirm: keine offenen Panels, keine Tour
      if (npEl) toggleNotifPanel(false);
      if (drawerSpec) app.closeDrawer();
      WF.bus.emit('ai:close', {});
      if (WF.tour && WF.tour.active) WF.tour.stop();
      tvActivity();
    } else a.classList.remove('tv-ptr');
    WF.bus.emit('settings', settings);
  };

  // ------------------------------------------------------------ Tastenkürzel (Hilfe mit „?“)
  function openKeys() {
    if (document.querySelector('#overlay .app-keys')) return;
    const kbd = (k) => `<kbd class="kbd">${esc(k)}</kbd>`;
    const row = (keys, label) => `<div class="kh-r"><span class="kh-k">${keys.map(kbd).join('')}</span><span class="kh-l">${label}</span></div>`;
    const viewRows = WF.views.map(v => [keyOf(v), v]).filter(x => x[0] != null)
      .sort((a, b) => (a[0] === '0' ? 3.5 : Number(a[0])) - (b[0] === '0' ? 3.5 : Number(b[0])))
      .map(([k, v]) => row([k], esc(v.title))).join('');
    const body = el('div', { class: 'app-keys' });
    body.innerHTML = `
      <section><h4 class="eyebrow">Ansichten</h4>${viewRows}</section>
      <section><h4 class="eyebrow">Allgemein</h4>
        ${row(['P'], 'Simulation anhalten / weiter')}
        ${row(['T'], 'TV-Modus: Leitstand an der Hallenwand')}
        ${row(['Esc'], 'Details, Meldungen oder Dialog schließen')}
        ${row(['?'], 'Diese Übersicht')}
        <h4 class="eyebrow">Demo-Tour</h4>
        ${row(['←', '→'], 'Schritt zurück / weiter')}
        ${row(['Esc'], 'Tour beenden')}
        <h4 class="eyebrow">Copilot</h4>
        ${row(['Enter'], 'Frage senden')}
        ${row(['Shift', 'Enter'], 'Neue Zeile')}</section>`;
    app.modal({ title: 'Tastenkürzel', body, width: 560, actions: [{ label: 'Schließen', primary: true }] }).body.closest('.modal').classList.add('app-keys-m');
  }
  app.showKeys = openKeys;
  css(`.app-keys{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 28px}
       .app-keys section{display:flex;flex-direction:column;gap:2px;min-width:0}
       .app-keys h4{margin:12px 0 6px}.app-keys h4:first-child{margin-top:0}
       .app-keys .kh-r{display:flex;align-items:center;gap:12px;min-height:30px;font-size:var(--fs-md);color:var(--text2)}
       .app-keys .kh-k{display:inline-flex;gap:4px;flex:none;min-width:64px}
       .app-keys .kh-l{min-width:0}
       @media (max-width:560px){.app-keys{grid-template-columns:minmax(0,1fr)}.app-keys section+section h4:first-child{margin-top:12px}}`, 'app-keys');

  // ------------------------------------------------------------ Schleife
  // Simulation und UI-Takt folgen der echten Zeit: bei niedriger Bildrate (Software-GL) läuft die Simulation trotzdem in
  // Echtzeit × Tempo, und Ansichten/Drawer/Meldungen werden weiter ~4×/s aktualisiert. Nur frame(dt) (Animationen)
  // bekommt den auf 0,1 s begrenzten Schritt.
  let last = 0, simAcc = 0, lastSim = 0, lastTick = 0;
  const TICK_MS = 250;
  function tick() {
    updateTop();
    updateBadges();
    if (app.current && app.current.update) { try { app.current.update(); } catch (e) { console.error('[view update]', app.current.id, e); } }
    if (drawerSpec && drawerSpec.update && drawerBody) { try { drawerSpec.update(drawerBody); } catch (e) { console.error('[detail update]', e); } }
    if (npEl) renderNotifPanel(false);
  }
  function loop(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!app.paused && WF.sim && WF.sim.advance) {
      // Simulationszeit folgt der echten Zeit (nicht der Bildrate) – auf langsamen Rechnern bleibt 600× auch 600×
      const realDt = lastSim ? Math.min(2, (now - lastSim) / 1000) : 0;
      simAcc += realDt * app.speed;
      const n = Math.floor(simAcc);
      if (n > 0) { try { WF.sim.advance(n); } catch (e) { console.error('[sim]', e); app.paused = true; markSpeed(); app.toast('Simulation angehalten: ' + e.message, 'crit'); } simAcc -= n; }
    }
    lastSim = now;
    if (app.current && app.current.frame) { try { app.current.frame(dt); } catch (e) { console.error('[view frame]', e); } }
    // UI-Takt nach echter Zeit (nicht nach dem begrenzten dt) – ein verpasster Takt wird nicht nachgeholt
    if (now - lastTick >= TICK_MS) { lastTick = now; tick(); }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ Start
  app.start = () => {
    app.speed = settings.speed || WF.profile.sim.defaultSpeed;
    buildTop();
    buildNav();
    { const d = drawer(); d.inert = true; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'false'); d.setAttribute('aria-labelledby', 'drawer-title'); }
    // Ältere Browser ohne overflow:clip: .main nie seitlich verschoben lassen (Fokus im einfahrenden Drawer)
    { const mn = document.getElementById('main'); if (mn) mn.addEventListener('scroll', () => { if (mn.scrollLeft || mn.scrollTop) { mn.scrollLeft = 0; mn.scrollTop = 0; } }); }
    markExisting();
    WF.bus.on('sim:notify', onNotify);
    WF.bus.on('sim:reset', () => { toasted.clear(); markExisting(); tick(); });
    WF.bus.on('navigate-request', ({ view, params }) => app.navigate(view, params));
    document.addEventListener('keydown', (e) => {
      const t = e.target && e.target.nodeType === 1 ? e.target : null;
      if (isTyping(t) || e.defaultPrevented) return;
      // Offener Dialog: nur er reagiert (Esc/Tab regelt app.modal) – keine Ansichtswechsel oder Pausen dahinter
      if (document.querySelector('#overlay .modal-back')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (npEl) toggleNotifPanel(false); else if (drawerSpec) app.closeDrawer(); else if (app.tv) app.setTv(false); return; }
      if (e.repeat) return; // gedrückt gehaltene Taste schaltet nicht im Takt der Tastenwiederholung
      if (e.key === 'p' || e.key === 'P') app.togglePause();
      else if (e.key === '?') { e.preventDefault(); openKeys(); }
      else if (e.key === 't' || e.key === 'T') {
        if (app.tv) app.setTv(false);
        else if (WF.views.some(v => v.id === 'leitstand')) { if (!app.current || app.current.id !== 'leitstand') app.navigate('leitstand'); app.setTv(true); }
      }
      else if (/^[0-9]$/.test(e.key)) { const v = viewForKey(e.key); if (v) app.navigate(v.id); }
    });
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && (!app.current || app.current.id !== id) && WF.views.find(v => v.id === id)) app.navigate(id); });
    const fromHash = location.hash.slice(1);
    const startView = WF.views.find(v => v.id === fromHash) ? fromHash : (WF.views.find(v => v.id === settings.lastView) ? settings.lastView : (WF.views[0] && WF.views[0].id));
    if (fromHash === 'tour' && WF.tour) { app.navigate('leitstand'); setTimeout(() => WF.tour.start(), 600); }
    else if (startView) app.navigate(startView);
    tick();
    requestAnimationFrame(loop);
    const splash = document.getElementById('splash');
    if (splash) { splash.classList.add('out'); setTimeout(() => splash.remove(), 600); }
  };
})();
