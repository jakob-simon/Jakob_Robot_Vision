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
      <div class="clock"><span class="time" id="t-time">--:--</span><span class="shift-chip" id="t-shift">–</span></div>
      <div class="speed" role="group" aria-label="Simulationstempo">
        <button class="play" id="t-play" title="Pause / Weiter (P)">${icon('pause', 15)}</button>
        ${WF.profile.sim.speeds.map(s => `<button class="sp" data-speed="${s}" title="Simulation ${s}× schneller als Echtzeit">${s}×</button>`).join('')}
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="t-bell" title="Benachrichtigungen" aria-label="Benachrichtigungen">${icon('bell')}<span class="count" id="t-count" hidden>0</span></button>
        ${WF.tour ? `<button class="icon-btn" id="t-tour" title="Geführte Demo-Tour starten" aria-label="Demo-Tour">${icon('play', 16)}</button>` : ''}
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
  const viewState = {}; // id -> {root, mounted}
  function buildNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    let lastGroup = null;
    for (const v of WF.views) {
      const g = v.group || 'betrieb';
      if (g !== lastGroup) { nav.append(el('div', { class: 'nav-label', text: GROUPS[g] || g })); lastGroup = g; }
      const b = el('button', { class: 'nav-item', 'data-view': v.id, title: v.title, html: icon(v.icon || 'dot') + `<span>${esc(v.title)}</span><span class="badge" data-badge="${v.id}"></span>` });
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
    settings.lastView = v.id; save();
    if (location.hash !== '#' + v.id) { try { history.replaceState(null, '', '#' + v.id); } catch (e) { /* Sandbox */ } }
    WF.bus.emit('navigate', { view: v.id, params: params || {} });
  };
  function updateBadges() {
    for (const v of WF.views) {
      if (!v.badge) continue;
      const b = document.querySelector(`[data-badge="${v.id}"]`);
      if (b) { try { b.textContent = v.badge() || ''; } catch (e) { b.textContent = ''; } }
    }
  }

  // ------------------------------------------------------------ Detail-Drawer
  const drawer = () => document.getElementById('drawer');
  let drawerSpec = null, drawerBody = null;
  app.select = (kind, id) => {
    app.selected = { kind, id };
    WF.bus.emit('select', { kind, id });
    openDetail(kind, id);
  };
  function openDetail(kind, id) {
    const factory = WF.details[kind];
    const d = drawer();
    let spec;
    try { spec = factory ? factory(id) : null; } catch (e) { console.error('[detail]', kind, id, e); spec = null; }
    if (!spec) spec = { title: app.entityLabel({ kind, id }), subtitle: kind, render: (b) => { b.append(el('div', { class: 'empty', text: 'Keine Detailansicht verfügbar.' })); } };
    drawerSpec = spec;
    d.innerHTML = '';
    const head = el('div', { class: 'drawer-h' },
      el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 't', text: spec.title || '' }), el('div', { class: 's', html: spec.subtitle || '' })),
      WF.ai ? el('button', { class: 'icon-btn', title: 'Den Copilot dazu fragen', 'aria-label': 'Copilot fragen', html: icon('sparkles', 17),
        onclick: () => WF.bus.emit('ai:ask', { text: spec.askPrompt || ('Gib mir eine kurze Lageeinschätzung zu ' + app.entityLabel({ kind, id }) + ': was passiert gerade, was ist kritisch, was empfiehlst du?'), context: { kind, id } }) }) : null,
      el('button', { class: 'icon-btn', title: 'Schließen (Esc)', 'aria-label': 'Schließen', html: icon('x'), onclick: () => app.closeDrawer() }));
    drawerBody = el('div', { class: 'drawer-b' });
    d.append(head, drawerBody);
    try { spec.render(drawerBody); } catch (e) { console.error('[detail render]', e); drawerBody.append(el('div', { class: 'empty', text: 'Fehler: ' + e.message })); }
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
  }
  app.closeDrawer = () => {
    const d = drawer(); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    drawerSpec = null; app.selected = null; WF.bus.emit('select', { kind: null, id: null });
  };
  app.refreshDrawer = () => { if (app.selected) openDetail(app.selected.kind, app.selected.id); };

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
    if (!show) { if (npEl) npEl.remove(); npEl = null; return; }
    npEl = el('div', { class: 'notif-panel', role: 'dialog', 'aria-label': 'Benachrichtigungen' });
    npEl.addEventListener('click', e => e.stopPropagation());
    document.getElementById('app').append(npEl);
    npSig = '';
    renderNotifPanel(true);
  }
  function notifCard(n) {
    const S = WF.SEV[n.sev] || WF.SEV.info;
    const ent = n.entity && n.entity.id ? `<button class="link" data-ent="${esc(n.entity.kind)}|${esc(n.entity.id)}">${esc(app.entityLabel(n.entity))}</button>` : '';
    const acts = (n.actions || []).map((a, i) => `<button class="btn sm" data-act="${i}">${esc(a.label)}</button>`).join('');
    const status = n.status === 'ack' ? ' · quittiert' + (n.ackBy ? ' von ' + esc(n.ackBy) : '') : n.status === 'resolved' ? ' · erledigt' : '';
    return `<div class="notif ${esc(n.status)}" style="--c:${S.color}" data-id="${esc(n.id)}">
      <div class="n-top"><span>${U.fmtDayClock(n.t)}</span><span>·</span><span>${esc(n.role || '')}</span><span class="spacer"></span>${ent}</div>
      <div class="n-t">${esc(n.title)}</div>
      ${n.body ? `<div class="n-b">${esc(n.body)}</div>` : ''}
      ${n.suggestion ? `<div class="n-s"><b>Empfehlung:</b> ${esc(n.suggestion)}</div>` : ''}
      <div class="n-a">${n.status === 'open' ? '<button class="btn sm" data-ack>Quittieren</button>' : ''}${acts}${WF.ai ? `<button class="btn sm ghost" data-ai>${icon('sparkles', 14)} Ursache analysieren</button>` : ''}<span class="muted" style="font-size:11.5px;align-self:center">${status}</span></div>
    </div>`;
  }
  function renderNotifPanel(force) {
    if (!npEl || !WF.sim) return;
    const all = (WF.sim.state.notifications || []).slice().sort((a, b) => b.t - a.t);
    const list = npFilter === 'open' ? all.filter(n => n.status === 'open') : all.slice(0, 80);
    const sig = npFilter + '|' + list.map(n => n.id + n.status).join(',');
    if (!force && sig === npSig) return;
    npSig = sig;
    npEl.innerHTML = `<div class="np-h"><strong>Benachrichtigungen</strong><span class="spacer"></span>
      <div class="seg"><button data-f="open" class="${npFilter === 'open' ? 'on' : ''}">Offen (${all.filter(n => n.status === 'open').length})</button><button data-f="all" class="${npFilter === 'all' ? 'on' : ''}">Alle</button></div>
      <button class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button></div>
      <div class="notif-list">${list.length ? list.map(notifCard).join('') : '<div class="empty">Keine offenen Benachrichtigungen. Alles im grünen Bereich.</div>'}</div>`;
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
  let lastToast = 0;
  app.toast = (msg, sev = 'info', opts = {}) => {
    const box = document.getElementById('toasts');
    const S = WF.SEV[sev] || WF.SEV.info;
    const t = el('div', { class: 'toast', style: { '--c': S.color }, role: 'status' },
      el('div', { class: 'tt', text: opts.title || msg }), opts.title ? el('div', { class: 'tb', text: msg }) : null);
    t.onclick = () => { if (opts.onClick) opts.onClick(); t.remove(); };
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), opts.ms || 5200);
  };
  function onNotify(n) {
    if (!n || n.status !== 'open' || (n.sev !== 'crit' && n.sev !== 'warn')) return;
    if (n._toasted) return; n._toasted = true;
    const now = performance.now();
    if (now - lastToast < 2500 && n.sev !== 'crit') return;
    lastToast = now;
    app.toast(n.body || '', n.sev, { title: n.title, onClick: () => { if (n.entity && n.entity.id) app.select(n.entity.kind, n.entity.id); } });
  }

  // ------------------------------------------------------------ Modal
  app.modal = ({ title, body, actions = [], width }) => {
    const back = el('div', { class: 'modal-back' });
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-label': title, style: width ? { width: `min(${width}px, 100%)` } : null });
    const close = () => back.remove();
    const b = el('div', { class: 'modal-b' });
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    const f = el('div', { class: 'modal-f' });
    for (const a of actions) f.append(el('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), text: a.label, onclick: () => { const r = a.onClick && a.onClick(); if (r !== false) close(); } }));
    m.append(el('div', { class: 'modal-h' }, el('strong', { text: title }), el('span', { class: 'spacer' }), el('button', { class: 'icon-btn', 'aria-label': 'Schließen', html: icon('x'), onclick: close })), b);
    if (actions.length) m.append(f);
    back.append(m);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.getElementById('overlay').append(back);
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
      <div class="card"><div class="card-b" style="font-size:12.5px;color:var(--text2)">
        <b>Über diese Demo.</b> ${esc(WF.profile.company.demoNote)} Profil: ${esc(WF.profile.company.description)}
        <br><span class="muted">werkfluss ${esc(WF.version)} · Simulation deterministisch (Seed ${WF.profile.sim.seed}).</span></div></div>`;
    app.modal({ title: 'Einstellungen', body, actions: [
      { label: 'Simulation neu starten', danger: true, onClick: () => { WF.sim.actions && WF.sim.actions.reset ? WF.sim.actions.reset() : WF.sim.init(WF.profile); app.toast('Simulation neu gestartet (Mo 06:00, vorgerechnet bis 08:40)', 'ok'); app.closeDrawer(); } },
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

  // ------------------------------------------------------------ TV-Modus (Leitstand an der Hallenwand)
  css(`.app.tv{grid-template-columns:0 minmax(0,1fr)}.app.tv .side{display:none}
       @media (max-width:900px){.app.tv{grid-template-rows:var(--top-h) 0 minmax(0,1fr)}}`, 'app-tv');
  app.setTv = (on) => { document.getElementById('app').classList.toggle('tv', !!on); app.tv = !!on; WF.bus.emit('settings', settings); };

  // ------------------------------------------------------------ Schleife
  let last = 0, acc = 0, simAcc = 0;
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
      simAcc += dt * app.speed;
      const n = Math.floor(simAcc);
      if (n > 0) { try { WF.sim.advance(n); } catch (e) { console.error('[sim]', e); app.paused = true; markSpeed(); app.toast('Simulation angehalten: ' + e.message, 'crit'); } simAcc -= n; }
    }
    if (app.current && app.current.frame) { try { app.current.frame(dt); } catch (e) { console.error('[view frame]', e); } }
    acc += dt;
    if (acc >= 0.25) { acc = 0; tick(); }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ Start
  app.start = () => {
    app.speed = settings.speed || WF.profile.sim.defaultSpeed;
    buildTop();
    buildNav();
    WF.bus.on('sim:notify', onNotify);
    WF.bus.on('sim:reset', () => { tick(); });
    WF.bus.on('navigate-request', ({ view, params }) => app.navigate(view, params));
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
      if (e.key === 'Escape') { if (npEl) toggleNotifPanel(false); else if (drawerSpec) app.closeDrawer(); else if (app.tv) app.setTv(false); }
      else if (e.key === 'p' || e.key === 'P') app.togglePause();
      else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { const v = WF.views[Number(e.key) - 1]; if (v) app.navigate(v.id); }
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
