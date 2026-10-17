/* werkfluss – Geführte Demo-Tour für Präsentationen bei Interessenten.
   Führt in ca. 6 Minuten durch die Kernideen: Leitstand → Maschine → Halle (Material- & Datenfluss)
   → Auftrag verfolgen → Werkzeuglogik → Störung + Copilot → Anbindung alter Maschinen → KI-Auftrag → Nutzen.
   Robust gegen fehlende Module: jeder Schritt prüft, ob seine Ansicht/Funktion existiert. */
(function () {
  const WF = window.WF;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;

  css(`
  .tour-card{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:65;
    width:min(620px,calc(100vw - 32px));background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(14px);
    border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow),0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent);
    padding:16px 18px 14px;animation:tourIn .28s ease}
  .tour-card.center{top:50%;bottom:auto;transform:translate(-50%,-50%);width:min(680px,calc(100vw - 32px));padding:26px 28px 20px}
  @keyframes tourIn{from{opacity:0;translate:0 10px}to{opacity:1;translate:0 0}}
  .tour-top{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .tour-step{font:600 11px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
  .tour-dots{display:flex;gap:4px;margin-left:auto}
  .tour-dots i{width:16px;height:3px;border-radius:2px;background:var(--line2)}
  .tour-dots i.on{background:var(--accent)}.tour-dots i.done{background:color-mix(in srgb,var(--accent) 45%,var(--line2))}
  .tour-t{font:600 22px/1.15 var(--f-cond);margin:2px 0 6px;text-wrap:balance}
  .tour-card.center .tour-t{font-size:34px}
  .tour-x{color:var(--text2);font-size:14px;line-height:1.5;max-width:68ch}
  .tour-x b{color:var(--text)}
  .tour-x ul{margin:8px 0 0;padding-left:18px}.tour-x li{margin:3px 0}
  .tour-f{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}
  .tour-f .spacer{flex:1}
  .tour-auto{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
  .tour-auto input{accent-color:var(--accent)}
  .tour-ring{position:fixed;z-index:64;border-radius:12px;pointer-events:none;
    box-shadow:0 0 0 2px var(--accent),0 0 0 6px color-mix(in srgb,var(--accent) 25%,transparent),0 0 0 9999px rgba(3,7,15,.5);
    transition:all .35s ease}
  .tour-hero{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
  .tour-hero div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
  .tour-hero b{display:block;font:600 24px/1.1 var(--f-cond);color:var(--text)}
  .tour-hero span{font-size:12px;color:var(--muted)}
  .tour-card.compact .tour-x{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .tour-more{font-size:12px;margin-top:6px}
  .tour-progress{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:12px}
  .tour-progress i{display:block;height:100%;background:var(--accent);width:0}
  @media (max-width:560px){.tour-hero{grid-template-columns:1fr}.tour-card.center .tour-t{font-size:26px}
    .tour-dots{display:none}.tour-step{white-space:nowrap}.tour-card{padding:12px 14px 12px}.tour-x{font-size:13px}.tour-t{font-size:19px}
    .tour-card.center{max-height:calc(100vh - 120px);overflow:auto}.tour-hero div{padding:8px 10px}.tour-hero b{font-size:20px}}
  @media (min-width:900px){body.ai-open .tour-card:not(.center){left:max(16px,calc(var(--side-w) + 16px));transform:none;width:min(560px,calc(100vw - var(--side-w) - 440px - 48px))}}
  `, 'tour');

  const has = (viewId) => WF.views.some(v => v.id === viewId);
  const sim = () => WF.sim;

  /** Maschine mit dem nächsten geplanten Werkzeugwechsel (für eine anschauliche Detailansicht). */
  function pickToolMachine() {
    let best = null, bestT = Infinity;
    for (const id of WF.profile.machines) {
      let mv; try { mv = sim().machineView(id); } catch (e) { continue; }
      if (!mv || !mv.tools) continue;
      for (const t of mv.tools) {
        const eta = t.plannedChange && t.plannedChange.etaT;
        if (eta && eta < bestT && mv.state === 'running') { bestT = eta; best = id; }
      }
    }
    return best || 'M05';
  }
  /** Werkzeug mit dem frühesten geplanten Wechsel an einer Maschine. */
  function soonestTool(mv) {
    let best = null;
    for (const t of (mv && mv.tools) || []) { const e = t.plannedChange && t.plannedChange.etaT; if (e != null && (!best || e < best.plannedChange.etaT)) best = t; }
    return best || ((mv && mv.tools) || []).find(t => t.remainingParts != null) || null;
  }
  /** Störungsdemo dort, wo sie Termine bewegt: laufende Maschine des verfolgten Auftrags, sonst Engpass. */
  function pickFaultMachine(orderId) {
    const S = sim().state;
    const running = (id) => S.machines[id] && S.machines[id].state === 'running';
    if (orderId) {
      let ov = null; try { ov = sim().orderView(orderId); } catch (e) { ov = null; }
      if (ov) {
        const act = ov.ops.find(o => o.state === 'active' && running(o.station));
        if (act) return act.station;
        const bn = ov.bottleneck && String(ov.bottleneck).split(' ')[0];
        if (bn && running(bn)) return bn;
      }
    }
    if (typeof sim().bottleneck === 'function') { try { const b = sim().bottleneck(); if (b && running(b.stationId)) return b.stationId; } catch (e) { /* weiter */ } }
    const prefer = ['M07', 'M04', 'M02', 'M05', 'M06', 'M03'];
    return prefer.find(running) || WF.profile.machines.find(running) || 'M02';
  }
  const etaRawOf = (id) => { try { const f = sim().forecast(0); const o = f.orders[id]; return o ? (o.etaRaw != null ? o.etaRaw : o.eta) : null; } catch (e) { return null; } };
  const liveCount = () => WF.profile.machines.filter(id => { const m = sim().state.machines[id]; return m && m.conn && m.conn.level >= 1; }).length;
  /** Beispielrechnung Nutzen: +5 OEE-Punkte auf alle Bearbeitungsmaschinen, 2 Schichten × 225 Tage. */
  function roi() {
    const rates = WF.profile.stations.filter(s => s.kind === 'machine').reduce((a, s) => a + (s.rate || 0), 0);
    const hours = 2 * 8 * 225;
    return { rates, hours, gain: 0.05 * rates * hours, machines: WF.profile.stations.filter(s => s.kind === 'machine').length };
  }
  function pickExternalOrder() {
    const S = sim().state;
    const ids = Object.keys(S.orders).filter(id => S.orders[id].status !== 'fertig');
    const withExt = ids.find(id => (S.orders[id].routing || []).some(r => r.station === 'EXT'));
    return withExt || ids[0];
  }

  const STEPS = [
    { id: 'intro', center: true, title: 'werkfluss – das KI-native MES für den Mittelstand',
      body: () => {
        const c = WF.app.company(), k = sim().kpis();
        let late = null;
        try { const f = sim().forecast(); for (const id in f.orders) { const o = f.orders[id]; if (o && !o.done && o.late && (!late || o.slackSec < late.slackSec)) late = { id, slackSec: o.slackSec }; } } catch (e) { late = null; }
        return `Produzierende Betriebe mit 5–50 Mio. € Umsatz steuern ihre Fertigung oft mit Zuruf, Excel und Papier. Klassische MES-Projekte kosten sechsstellig und dauern Monate.
          <b>werkfluss</b> rüstet eine Altmaschine in rund 20 Minuten nach, bringt das ganze Werk an einem Tag live und macht Material- und Informationsfluss in Echtzeit sichtbar. Ein Copilot kennt die Live-Daten und sagt, was zu tun ist.
          <div class="tour-hero">
            <div><b>${liveCount()} / ${WF.profile.machines.length}</b><span>Stationen bei ${esc(c.name)} live – auch eine Maschine von 1998</span></div>
            <div><b>${U.fmtEur(k.lossEur)}</b><span>Stillstandkosten heute – sichtbar mit Ursache statt geschätzt</span></div>
            <div><b>${late ? esc(late.id) : 'Termine'}</b><span>${late ? 'Verzug erkannt, bevor der Kunde anruft' : 'Liefertermine laufend aus Live-Daten prognostiziert'}</span></div>
          </div>
          <p class="muted" style="margin:12px 0 0;font-size:12.5px">${esc(WF.profile.company.demoNote)}</p>`;
      } },
    { id: 'leitstand', view: 'leitstand', ring: '.ls-kpis', title: 'Leitstand: die ganze Halle auf einen Blick',
      body: () => {
        const k = sim().kpis();
        return `Jede Kachel ist eine Maschine: <b>was sie gerade macht</b>, welches Teil, wann der Arbeitsgang fertig ist und welches Werkzeug als Nächstes getauscht wird. Oben die Kennzahlen der Schicht – aktuell OEE <b>${U.fmtPct(k.oee)}</b>, ${U.fmtNum(k.goodFinished != null ? k.goodFinished : k.good)} fertige Teile, Stillstandkosten heute <b>${U.fmtEur(k.lossEur)}</b>.`;
      } },
    { id: 'machine', view: 'leitstand', ring: '.drawer.open .md-tools', run: () => { const id = pickToolMachine(); WF.app.select('machine', id); return id; },
      title: 'Jede Maschine erklärt sich selbst',
      body: (ctx) => {
        const mv = sim().machineView(ctx);
        const t = soonestTool(mv);
        return `${esc(mv ? mv.name : '')}: Zustand mit Ursache, Auftrag, Teilefortschritt und Live-Signale aus der Steuerung.` +
          (t ? ` Werkzeug <b>${esc(t.name)}</b>: ${t.remainingParts != null ? 'noch <b>' + t.remainingParts + ' Teile</b>' : ''}${t.plannedChange && t.plannedChange.etaT ? ', Wechsel geplant ca. <b>' + U.fmtClock(t.plannedChange.etaT) + '</b>' : ''} – angekündigt, bevor es passiert.` : '');
      } },
    { id: 'hall', view: 'halle', run: () => { WF.app.closeDrawer(); }, title: 'Der digitale Zwilling der Halle',
      body: () => `Alle Maschinen, Personen, AGVs und Behälter in Echtzeit. <b>Orange</b>: Materialfluss – welcher Behälter gerade von wo nach wo fährt. <b>Cyan</b>: Datenfluss – jede Meldung einer Maschine läuft zum werkfluss-Server. Klick auf ein Objekt öffnet die Details.` },
    { id: 'order', view: 'halle', run: () => {
        const id = pickExternalOrder();
        if (id) {
          WF.app.select('order', id);
          // Schmale Bildschirme: Detail ausblenden, damit die Route in der Halle sichtbar ist (Auswahl bleibt)
          if (window.matchMedia('(max-width: 900px)').matches && WF.app.hideDrawer) WF.app.hideDrawer();
          if (WF.hall && WF.hall.focusOrder) WF.hall.focusOrder(id);
        }
        return id; },
      title: 'Einen Auftrag durch die Fabrik verfolgen',
      body: (ctx) => {
        const ov = ctx && sim().orderView(ctx);
        if (!ov) return 'Auftrag mit allen Arbeitsgängen von A nach B nach C.';
        const chain = ov.ops.filter(o => o.station !== 'VERSAND').map(o => o.stationName || o.station).join(' → ');
        return `<b>${esc(ov.id)}</b> · ${esc(ov.part.name)} für ${esc(ov.customer)}: ${esc(chain)}. Prognose fertig <b>${ov.eta ? U.fmtDue(ov.eta, sim().state.t) : '–'}</b>, Termin ${U.fmtDue(ov.due, sim().state.t)} – <b>${esc(ov.riskLabel || ov.risk || '')}</b>. Auch die externe Härterei ist eingeplant, inklusive Rückkehrzeit.`;
      } },
    { id: 'tools', view: 'werkzeuge', run: () => WF.app.closeDrawer(), title: 'Werkzeuge: eine Regel, die jeder versteht',
      body: () => `Verschleiß wächst nur am Teilende und nie über 100 %. Gewechselt wird <b>nur zwischen zwei Teilen</b>, angekündigt mit Uhrzeit und Person; der Einrichter holt das vermessene Werkzeug vorher aus der Ausgabe. Kein „plötzlich getauscht“, kein Bruch durch Überziehen.` },
    { id: 'fault', view: 'leitstand', compact: true, run: (prev) => {
        const orderId = ctxs.order || null;
        const id = pickFaultMachine(orderId);
        const before = orderId ? etaRawOf(orderId) : null;
        const r = sim().actions.triggerFault(id, 'ALM 1021');
        const after = orderId ? etaRawOf(orderId) : null;
        WF.app.select('machine', id);
        return { id, orderId, before, after, ok: !(r && r.ok === false) };
      }, title: 'Störung – und was jetzt?',
      body: (ctx) => {
        const s = WF.profile.stationById[ctx && ctx.id];
        const d = ctx && ctx.before != null && ctx.after != null ? ctx.after - ctx.before : null;
        const eff = ctx && ctx.orderId && d != null
          ? ` Prognose für <b>${esc(ctx.orderId)}</b>: ${U.fmtDue(ctx.before, sim().state.t)} → <b>${U.fmtDue(ctx.after, sim().state.t)}</b>${d > 60 ? ` (+${U.fmtDur(d)})` : ' (noch im Puffer)'}.`
          : '';
        return `An <b>${esc(s ? s.short : '')}</b> meldet die Steuerung gerade „Kühlmitteldruck zu niedrig“ (Demo). werkfluss alarmiert sofort die Instandhaltung mit Ursache und Empfehlung und rechnet die Liefertermine neu.${eff}`;
      } },
    { id: 'copilot', view: 'leitstand', run: (prev) => {
        const id = prev && prev.id;
        const s = id && WF.profile.stationById[id];
        const oid = prev && prev.orderId;
        WF.bus.emit('ai:ask', { text: `Die ${s ? s.short : 'Maschine'} hat eine Störung.${oid ? ' Was bedeutet das für ' + oid + ' und meine anderen Termine' : ' Was bedeutet das für meine Termine'} – und was soll ich jetzt tun?`, context: { kind: 'machine', id } });
      }, compact: true, ring: '.ai-panel.open', title: 'Der Copilot kennt jede Zahl in der Halle',
      body: () => `Er beantwortet Fragen in Alltagssprache aus den Live-Daten: gefährdete Aufträge, Engpässe, Werkzeugwechsel, Material, Schichtübergabe. Auf Wunsch handelt er auch – Nachbestellung auslösen, Auftrag priorisieren, Arbeitsgang verlagern.` },
    { id: 'connect', view: 'anbindung', viewParams: { machineId: 'M10' }, compact: true,
      run: () => {
        WF.bus.emit('ai:close', {}); WF.app.closeDrawer();
        // Assistent sichtbar durchlaufen: Typenschild → Anbindungsweg → KI-Signalzuordnung → Live-Test
        const stepAt = idx;
        const next = (n) => {
          if (idx !== stepAt || n <= 0) return;
          const b = document.querySelector('#view-anbindung [data-act="wz-next"]:not([disabled])');
          if (b) b.click();
          timers.push(setTimeout(() => next(n - 1), 4200));
        };
        timers.push(setTimeout(() => next(3), 4200));
      },
      title: 'Auch die Maschine von 1996 wird digital',
      body: () => `Die Flachschleifmaschine hat keine Netzwerkschnittstelle. werkfluss liest das Typenschild, empfiehlt Nachrüst-Sensorik (Stromsensor und Signalsäulen-Abgriff, ca. 20 Minuten Montage, kein Eingriff in die Steuerung), ordnet die Signale per KI zu und prüft sie live gegen den echten Maschinenzustand. Moderne Maschinen kommen per OPC UA (umati) oder MTConnect.` },
    { id: 'ki', view: 'ki-auftrag', compact: true,
      run: () => {
        const stepAt = idx;
        timers.push(setTimeout(() => { if (idx === stepAt && WF.kiAuftrag && WF.kiAuftrag.analyze) { try { WF.kiAuftrag.analyze(); } catch (e) { /* ignorieren */ } } }, 1200));
      },
      title: 'Von der Zeichnung zum eingelasteten Auftrag',
      body: () => `Lohnfertiger kalkulieren den ganzen Tag. werkfluss liest die Zeichnung, schlägt Arbeitsplan, Maschinen, Zeiten, Preis und den realistischen Liefertermin aus der aktuellen Auslastung vor – ein Klick, und der Auftrag läuft durch die Fabrik.` },
    { id: 'value', center: true, title: 'Was werkfluss bringt',
      body: () => {
        const k = sim().kpis(), r = roi();
        const price = 89, yearCost = price * 12 * WF.profile.machines.length;
        return `<ul>
          <li><b>Transparenz in Echtzeit</b> statt Zuruf: jede Maschine, jeder Auftrag, jeder Behälter, jede Person.</li>
          <li><b>Stillstand in Euro</b>: heute bisher ${U.fmtEur(k.lossEur)} – mit Ursache, damit er morgen kleiner ist.</li>
          <li><b>Planbare Werkzeugwechsel</b> und weniger Ausschuss durch Erstteil- und SPC-Prüfung.</li>
          <li><b>Termintreue</b> durch Prognose mit Engpasserkennung – inklusive Fremdbearbeitung.</li></ul>
          <div class="tour-hero">
            <div><b>+${U.fmtNum(r.gain / 1000)} T€</b><span>Kapazität pro Jahr bei +5 OEE-Punkten (Ø ${U.fmtNum(r.rates / r.machines)} €/h, ${r.machines} Maschinen, 2 Schichten)</span></div>
            <div><b>${price} €</b><span>je Maschine und Monat (Preisbeispiel) – ${U.fmtEur(yearCost)} im Jahr für das ganze Werk</span></div>
            <div><b>1 Tag</b><span>bis das Werk live ist – Altmaschinen in ca. 20 Minuten nachgerüstet</span></div>
          </div>
          <p class="muted" style="margin:12px 0 0;font-size:12.5px">Beispielrechnung auf Basis der Stundensätze dieser Demo. Danke! Die Demo läuft weiter – alles ist anklickbar.</p>`;
      } },
  ];

  let idx = -1, card = null, ring = null, ctxs = {}, autoTimer = null, auto = false, autoStart = 0, timers = [], expanded = false;
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  /** Freier Bereich neben offenem Drawer / Copilot (in px) – dort andocken statt Inhalte zu verdecken. */
  function freeArea() {
    const vw = window.innerWidth;
    const side = document.querySelector('.side'); const sideR = side ? side.getBoundingClientRect() : null;
    const left = sideR && sideR.height > window.innerHeight * 0.5 ? sideR.right : 0;
    let right = vw;
    const dr = document.querySelector('.drawer.open'); if (dr) right = Math.min(right, dr.getBoundingClientRect().left);
    const ai = document.querySelector('.ai-panel.open'); if (ai) right = Math.min(right, ai.getBoundingClientRect().left);
    return { left, right, docked: right < vw - 8 };
  }
  function placeCard() {
    if (!card || card.classList.contains('center')) return;
    const f = freeArea();
    if (!f.docked || window.innerWidth < 700) { card.style.left = ''; card.style.width = ''; card.style.transform = ''; return; }
    const w = Math.min(560, f.right - f.left - 32);
    card.style.width = Math.max(300, w) + 'px';
    card.style.left = (f.left + (f.right - f.left) / 2) + 'px';
  }
  const AUTO_MS = 14000;

  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  function render() {
    const step = STEPS[idx];
    if (card) card.remove();
    const compact = !!step.compact && !expanded;
    card = el('div', { class: 'tour-card' + (step.center ? ' center' : '') + (compact ? ' compact' : ''), role: 'dialog', 'aria-label': 'Demo-Tour' });
    let body = '';
    try { body = step.body(ctxs[step.id]); } catch (e) { body = ''; console.error('[tour]', e); }
    card.innerHTML = `
      <div class="tour-top"><span class="tour-step">Demo-Tour · ${idx + 1} / ${STEPS.length}</span>
        <span class="tour-dots">${STEPS.map((s, i) => `<i class="${i === idx ? 'on' : i < idx ? 'done' : ''}"></i>`).join('')}</span>
        <button class="icon-btn" data-x aria-label="Tour beenden" title="Tour beenden (Esc)">${icon('x')}</button></div>
      <div class="tour-t">${esc(step.title)}</div>
      <div class="tour-x">${body}</div>${step.compact ? `<button class="link tour-more" data-more>${compact ? 'Mehr anzeigen' : 'Weniger anzeigen'}</button>` : ''}
      <div class="tour-f">
        <label class="tour-auto"><input type="checkbox" id="tour-auto" ${auto ? 'checked' : ''}> Automatisch weiter</label>
        <span class="spacer"></span>
        ${idx > 0 ? '<button class="btn" data-prev>Zurück</button>' : ''}
        <button class="btn primary" data-next>${idx === STEPS.length - 1 ? 'Tour beenden' : idx === 0 ? 'Tour starten' : 'Weiter'} ${idx < STEPS.length - 1 ? icon('arrowRight', 15) : ''}</button>
      </div>
      <div class="tour-progress"><i></i></div>`;
    card.querySelector('[data-x]').onclick = () => stop();
    card.querySelector('[data-next]').onclick = () => go(idx + 1);
    const pv = card.querySelector('[data-prev]'); if (pv) pv.onclick = () => go(idx - 1);
    card.querySelector('#tour-auto').onchange = (e) => { auto = e.target.checked; scheduleAuto(); };
    const more = card.querySelector('[data-more]'); if (more) more.onclick = () => { expanded = !expanded; render(); };
    document.body.append(card);
    placeCard();
    setTimeout(placeCard, 380);
    scheduleAuto();
  }
  function scheduleAuto() {
    clearAuto();
    const bar = card && card.querySelector('.tour-progress i');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0'; }
    if (!auto || idx >= STEPS.length - 1) return;
    autoStart = performance.now();
    requestAnimationFrame(() => { if (bar) { bar.style.transition = `width ${AUTO_MS}ms linear`; bar.style.width = '100%'; } });
    autoTimer = setTimeout(() => go(idx + 1), AUTO_MS);
  }
  function placeRing(sel) {
    if (ring) { ring.remove(); ring = null; }
    if (!sel) return;
    const target = document.querySelector(sel);
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (!r.width) return;
    ring = el('div', { class: 'tour-ring' });
    Object.assign(ring.style, { left: (r.left - 6) + 'px', top: (r.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
    document.body.append(ring);
  }
  function go(i) {
    if (i < 0) return;
    if (i >= STEPS.length) { stop(); return; }
    const prevCtx = idx >= 0 ? ctxs[STEPS[idx].id] : null;
    clearTimers(); expanded = false;
    idx = i;
    const step = STEPS[idx];
    if (step.view && has(step.view)) WF.app.navigate(step.view, step.viewParams);
    if (step.run) { try { ctxs[step.id] = step.run(prevCtx); } catch (e) { console.error('[tour run]', e); } }
    render();
    setTimeout(() => placeRing(step.ring), 450);
  }
  function stop() {
    clearAuto(); clearTimers();
    if (card) card.remove(); card = null;
    if (ring) ring.remove(); ring = null;
    idx = -1; ctxs = {};
  }
  document.addEventListener('keydown', (e) => {
    if (idx < 0) return;
    if (e.key === 'Escape') { stop(); e.stopPropagation(); }
    else if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
  }, true);
  window.addEventListener('resize', () => { if (idx >= 0) { placeRing(STEPS[idx].ring); placeCard(); } });
  // Drawer/Copilot öffnen sich animiert – Karte nachführen
  WF.bus.on('select', () => { if (idx >= 0) setTimeout(placeCard, 260); });

  WF.tour = { start: (opts = {}) => { auto = !!opts.auto; go(0); }, stop, get active() { return idx >= 0; }, steps: STEPS };
})();
