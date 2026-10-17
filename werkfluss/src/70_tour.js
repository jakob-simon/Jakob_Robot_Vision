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
  .tour-progress{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:12px}
  .tour-progress i{display:block;height:100%;background:var(--accent);width:0}
  @media (max-width:560px){.tour-hero{grid-template-columns:1fr}.tour-card.center .tour-t{font-size:26px}}
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
  /** Laufende Maschine für die Störungsdemo (bevorzugt eine mit Folgeschritten). */
  function pickFaultMachine() {
    const prefer = ['M02', 'M05', 'M06', 'M04', 'M03'];
    for (const id of prefer) { const m = sim().state.machines[id]; if (m && m.state === 'running') return id; }
    return WF.profile.machines.find(id => sim().state.machines[id] && sim().state.machines[id].state === 'running') || 'M02';
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
        const c = WF.app.company();
        return `Produzierende Betriebe mit 5–50 Mio. € Umsatz arbeiten oft mit Zuruf, Excel und Papier. Klassische MES-Projekte kosten sechsstellig und dauern Monate.
          <b>werkfluss</b> bindet jede Maschine in Stunden an – auch die von 1996 – und macht Material- und Informationsfluss in Echtzeit sichtbar. Ein Copilot kennt die Live-Daten und sagt, was zu tun ist.
          <div class="tour-hero">
            <div><b>13</b><span>Stationen bei ${esc(c.name)} angebunden oder anbindbar</span></div>
            <div><b>1 Tag</b><span>bis zur ersten Live-Kennzahl – ohne Eingriff in alte Steuerungen</span></div>
            <div><b>0 Papier</b><span>Rückmeldung, Erstteilprüfung, Werkzeugwechsel digital</span></div>
          </div>
          <p class="muted" style="margin:12px 0 0;font-size:12.5px">${esc(WF.profile.company.demoNote)}</p>`;
      } },
    { id: 'leitstand', view: 'leitstand', title: 'Leitstand: die ganze Halle auf einen Blick',
      body: () => {
        const k = sim().kpis();
        return `Jede Kachel ist eine Maschine: <b>was sie gerade macht</b>, welches Teil, wann der Arbeitsgang fertig ist und welches Werkzeug als Nächstes getauscht wird. Oben die Kennzahlen der Schicht – aktuell OEE <b>${U.fmtPct(k.oee)}</b>, ${U.fmtNum(k.goodFinished != null ? k.goodFinished : k.good)} fertige Teile, Stillstandkosten heute <b>${U.fmtEur(k.lossEur)}</b>.`;
      } },
    { id: 'machine', view: 'leitstand', run: () => { const id = pickToolMachine(); WF.app.select('machine', id); return id; },
      title: 'Jede Maschine erklärt sich selbst',
      body: (ctx) => {
        const mv = sim().machineView(ctx);
        const t = mv && (mv.tools || []).find(x => x.plannedChange) || (mv && mv.tools && mv.tools[0]);
        return `${esc(mv ? mv.name : '')}: Zustand mit Ursache, Auftrag, Teilefortschritt und Live-Signale aus der Steuerung.` +
          (t ? ` Werkzeug <b>${esc(t.name)}</b>: ${t.remainingParts != null ? 'noch <b>' + t.remainingParts + ' Teile</b>' : ''}${t.plannedChange && t.plannedChange.etaT ? ', Wechsel geplant ca. <b>' + U.fmtClock(t.plannedChange.etaT) + '</b>' : ''} – angekündigt, bevor es passiert.` : '');
      } },
    { id: 'hall', view: 'halle', run: () => { WF.app.closeDrawer(); }, title: 'Der digitale Zwilling der Halle',
      body: () => `Alle Maschinen, Personen, AGVs und Behälter in Echtzeit. <b>Orange</b>: Materialfluss – welcher Behälter gerade von wo nach wo fährt. <b>Cyan</b>: Datenfluss – jede Meldung einer Maschine läuft zum werkfluss-Server. Klick auf ein Objekt öffnet die Details.` },
    { id: 'order', view: 'halle', run: () => { const id = pickExternalOrder(); if (id) { WF.app.select('order', id); if (WF.hall && WF.hall.focusOrder) WF.hall.focusOrder(id); } return id; },
      title: 'Einen Auftrag durch die Fabrik verfolgen',
      body: (ctx) => {
        const ov = ctx && sim().orderView(ctx);
        if (!ov) return 'Auftrag mit allen Arbeitsgängen von A nach B nach C.';
        const chain = ov.ops.filter(o => o.station !== 'VERSAND').map(o => o.stationName || o.station).join(' → ');
        return `<b>${esc(ov.id)}</b> · ${esc(ov.part.name)} für ${esc(ov.customer)}: ${esc(chain)}. Prognose fertig <b>${ov.eta ? U.fmtDue(ov.eta, sim().state.t) : '–'}</b>, Termin ${U.fmtDue(ov.due, sim().state.t)} – <b>${esc(ov.riskLabel || ov.risk || '')}</b>. Auch die externe Härterei ist eingeplant, inklusive Rückkehrzeit.`;
      } },
    { id: 'tools', view: 'werkzeuge', run: () => WF.app.closeDrawer(), title: 'Werkzeuge: eine Regel, die jeder versteht',
      body: () => `Verschleiß wächst nur am Teilende und nie über 100 %. Gewechselt wird <b>nur zwischen zwei Teilen</b>, angekündigt mit Uhrzeit und Person; der Einrichter holt das vermessene Werkzeug vorher aus der Ausgabe. Kein „plötzlich getauscht“, kein Bruch durch Überziehen.` },
    { id: 'fault', view: 'leitstand', run: () => {
        const id = pickFaultMachine();
        const r = sim().actions.triggerFault(id);
        WF.app.select('machine', id);
        return { id, ok: !(r && r.ok === false) };
      }, title: 'Störung – und was jetzt?',
      body: (ctx) => {
        const s = WF.profile.stationById[ctx && ctx.id];
        return `An <b>${esc(s ? s.short : '')}</b> ist gerade eine Störung aufgetreten (Demo). werkfluss meldet sie sofort mit Alarmtext, Ursache und Empfehlung an die Instandhaltung, die Prognose rechnet die Termine neu. Fragen Sie den Copilot: <b>„Was bedeutet das für meine Termine?“</b>`;
      } },
    { id: 'copilot', view: 'leitstand', run: (prev) => {
        const id = prev && prev.id;
        const s = id && WF.profile.stationById[id];
        WF.bus.emit('ai:ask', { text: `Die ${s ? s.short : 'Maschine'} hat eine Störung. Was bedeutet das für meine Termine und was soll ich jetzt tun?`, context: { kind: 'machine', id } });
      }, title: 'Der Copilot kennt jede Zahl in der Halle',
      body: () => `Er beantwortet Fragen in Alltagssprache aus den Live-Daten: gefährdete Aufträge, Engpässe, Werkzeugwechsel, Material, Schichtübergabe. Auf Wunsch handelt er auch – Nachbestellung auslösen, Auftrag priorisieren, Arbeitsgang verlagern.` },
    { id: 'connect', view: 'anbindung', viewParams: { machineId: 'M10' }, run: () => { WF.bus.emit('ai:close', {}); WF.app.closeDrawer(); },
      title: 'Auch die Maschine von 1996 wird digital',
      body: () => `Die Flachschleifmaschine hat keine Netzwerkschnittstelle. werkfluss schlägt die passende Anbindung vor – hier Nachrüst-Sensorik mit Stromsensor und Signalsäulen-Abgriff, ohne Eingriff in die Steuerung – und ordnet die Signale per KI zu. Moderne Maschinen kommen per OPC UA (umati) oder MTConnect.` },
    { id: 'ki', view: 'ki-auftrag', title: 'Von der Zeichnung zum eingelasteten Auftrag',
      body: () => `Lohnfertiger kalkulieren den ganzen Tag. werkfluss liest die Zeichnung, schlägt Arbeitsplan, Maschinen, Zeiten, Preis und den realistischen Liefertermin aus der aktuellen Auslastung vor – ein Klick, und der Auftrag läuft durch die Fabrik.` },
    { id: 'value', center: true, title: 'Was werkfluss bringt',
      body: () => {
        const k = sim().kpis();
        const loss = k.lossEur || 0;
        return `<ul>
          <li><b>Transparenz in Echtzeit</b> statt Zuruf: jede Maschine, jeder Auftrag, jeder Behälter.</li>
          <li><b>Stillstand in Euro</b>: heute bisher ${U.fmtEur(loss)} – mit Ursache, damit er morgen kleiner ist.</li>
          <li><b>Planbare Werkzeugwechsel</b> und weniger Ausschuss durch Erstteil- und SPC-Prüfung.</li>
          <li><b>Termintreue</b> durch Prognose mit Engpasserkennung – inklusive Fremdbearbeitung.</li>
          <li><b>Start in einem Tag</b>, Abo je Maschine, ohne IT-Projekt.</li></ul>
          <p class="muted" style="margin:12px 0 0;font-size:12.5px">Danke! Die Demo läuft weiter – alles ist anklickbar.</p>`;
      } },
  ];

  let idx = -1, card = null, ring = null, ctxs = {}, autoTimer = null, auto = false, autoStart = 0;
  const AUTO_MS = 14000;

  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  function render() {
    const step = STEPS[idx];
    if (card) card.remove();
    card = el('div', { class: 'tour-card' + (step.center ? ' center' : ''), role: 'dialog', 'aria-label': 'Demo-Tour' });
    let body = '';
    try { body = step.body(ctxs[step.id]); } catch (e) { body = ''; console.error('[tour]', e); }
    card.innerHTML = `
      <div class="tour-top"><span class="tour-step">Demo-Tour · ${idx + 1} / ${STEPS.length}</span>
        <span class="tour-dots">${STEPS.map((s, i) => `<i class="${i === idx ? 'on' : i < idx ? 'done' : ''}"></i>`).join('')}</span>
        <button class="icon-btn" data-x aria-label="Tour beenden" title="Tour beenden (Esc)">${icon('x')}</button></div>
      <div class="tour-t">${esc(step.title)}</div>
      <div class="tour-x">${body}</div>
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
    document.body.append(card);
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
    idx = i;
    const step = STEPS[idx];
    if (step.view && has(step.view)) WF.app.navigate(step.view, step.viewParams);
    if (step.run) { try { ctxs[step.id] = step.run(prevCtx); } catch (e) { console.error('[tour run]', e); } }
    render();
    setTimeout(() => placeRing(step.ring), 450);
  }
  function stop() {
    clearAuto();
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
  window.addEventListener('resize', () => { if (idx >= 0) placeRing(STEPS[idx].ring); });

  WF.tour = { start: (opts = {}) => { auto = !!opts.auto; go(0); }, stop, get active() { return idx >= 0; }, steps: STEPS };
})();
