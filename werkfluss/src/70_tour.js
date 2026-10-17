/* werkfluss – Geführte Demo-Tour für Präsentationen bei Interessenten.
   Führt in ca. 6 Minuten durch die Kernideen: Leitstand → Maschine → Halle (Material- & Datenfluss)
   → Auftrag verfolgen → Werkzeuglogik → Störung + Copilot → Anbindung alter Maschinen → KI-Auftrag → Nutzen.
   Robust gegen fehlende Module: jeder Schritt prüft, ob seine Ansicht/Funktion existiert.

   Platzierung der Karte (placeCard):
   - Start/Ende: zentriert über einem abgedunkelten Hintergrund (Scrim).
   - Telefon (< 700 px): unten über die ganze Breite, Text auf 3 Zeilen gekürzt („Mehr anzeigen“);
     bei offenem Copilot als schmale Leiste unter dessen Kopf (Antwort und Eingabe bleiben frei).
   - Sonst im freien Bereich neben Drawer/Copilot – aber nie schmaler als 380 px: reicht der Platz nicht,
     liegt die Karte unten über die ganze Breite (bzw. als Leiste im Copilot).
   Der Ring scrollt sein Ziel ins Bild und liegt nie unter der Karte. Während der Tour gibt es keine Toasts
   (20_app.js); kritische Meldungen erscheinen als Hinweiszeile in der Karte. */
(function () {
  const WF = window.WF;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;

  css(`
  .tour-scrim{position:fixed;inset:0;z-index:64;background:rgba(4,8,16,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);
    opacity:0;pointer-events:none;transition:opacity .35s ease}
  .tour-scrim.on{opacity:1;pointer-events:auto}
  .tour-card{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:65;
    width:min(620px,calc(100vw - 32px));background:color-mix(in srgb,var(--panel) 94%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
    border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow),0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent);
    padding:16px 18px 14px;animation:tourIn .28s ease}
  .tour-card.center{top:50%;bottom:auto;transform:translate(-50%,-50%);width:min(700px,calc(100vw - 32px));padding:24px 28px 20px;
    max-height:calc(100vh - 32px);overflow:auto}
  @keyframes tourIn{from{opacity:0;translate:0 10px}to{opacity:1;translate:0 0}}
  .tour-top{display:flex;align-items:center;gap:10px;margin-bottom:6px;min-width:0}
  .tour-top .spacer{flex:1}
  .tour-step{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);white-space:nowrap}
  .tour-dots{display:flex;gap:4px}
  .tour-dots i{width:16px;height:3px;border-radius:2px;background:var(--line2)}
  .tour-dots i.on{background:var(--accent)}.tour-dots i.done{background:color-mix(in srgb,var(--accent) 45%,var(--line2))}
  .tour-card [data-x]{flex:none}
  .tour-t{font:600 22px/1.15 var(--f-cond);margin:2px 0 8px;text-wrap:balance}
  .tour-card.center .tour-t{font-size:34px;margin-bottom:10px}
  .tour-x{color:var(--text2);font-size:14px;line-height:1.5;max-width:68ch}
  .tour-x b{color:var(--text)}
  .tour-x ul{margin:8px 0 0;padding-left:18px}.tour-x li{margin:3px 0}
  .tour-card.compact .tour-x{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .tour-more{font-size:var(--fs-xs);margin-top:6px;display:none}
  .tour-card.can-more .tour-more{display:inline-block}
  /* Ergebnis eines Schritts (z. B. Auswirkung der Störung auf den Liefertermin) – steht vorn und wird nie gekürzt */
  .tour-res{--c:var(--st-run);display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin:0 0 10px;padding:9px 12px 10px;border-radius:10px;
    background:color-mix(in srgb,var(--c) 8%,var(--card));border:1px solid color-mix(in srgb,var(--c) 32%,transparent);box-shadow:inset 3px 0 0 var(--c)}
  .tour-res .l{flex-basis:100%;font:600 var(--fs-2xs)/1.3 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .tour-res b{font:600 var(--fs-xl)/1.2 var(--f-cond);color:var(--text);font-variant-numeric:tabular-nums}
  .tour-res span{font-size:var(--fs-sm);color:var(--text2)}
  .tour-res em{font-style:normal;font-weight:600;color:color-mix(in srgb,var(--c) 85%,white)}
  /* Kritische Meldung während der Tour: Hinweiszeile statt Toast */
  .tour-alert{display:flex;align-items:center;gap:8px;margin-top:10px;padding:7px 10px;border-radius:8px;font-size:var(--fs-sm);min-width:0;
    background:color-mix(in srgb,var(--st-fault) 8%,var(--card));box-shadow:inset 3px 0 0 var(--st-fault);animation:tourIn .25s ease}
  .tour-alert .ico{color:var(--st-fault);flex:none}
  .tour-alert b{font-weight:600;color:var(--text);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tour-alert .tour-alert-t{margin-left:auto;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;font-variant-numeric:tabular-nums}
  .tour-f{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}
  .tour-f .spacer{flex:1}
  .tour-auto{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);cursor:pointer;user-select:none}
  .tour-auto input{accent-color:var(--accent)}
  .tour-ring{position:fixed;z-index:64;border-radius:12px;pointer-events:none;
    box-shadow:0 0 0 2px var(--accent),0 0 0 6px color-mix(in srgb,var(--accent) 25%,transparent),0 0 0 9999px rgba(3,7,15,.5);
    transition:left .3s ease,top .3s ease,width .3s ease,height .3s ease,opacity .2s ease}
  .tour-ring.off{opacity:0}
  .tour-hero{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
  .tour-hero div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 13px 12px;min-width:0}
  .tour-hero b{display:block;font:600 30px/1.05 var(--f-cond);color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}
  .tour-hero span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:5px;font-size:var(--fs-sm);line-height:1.4;color:var(--muted)}
  .tour-note{margin:12px 0 0;font-size:var(--fs-xs);line-height:1.45;color:var(--muted)}
  .tour-progress{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:12px}
  .tour-progress i{display:block;height:100%;background:var(--accent);width:0}
  @media (max-width:560px){
    .tour-dots{display:none}.tour-card{padding:12px 14px 12px}.tour-x{font-size:var(--fs-md)}.tour-t{font-size:var(--fs-xl);margin-bottom:6px}
    .tour-card.center{padding:16px 16px 14px;max-height:calc(100vh - 100px)}.tour-card.center .tour-t{font-size:var(--fs-2xl)}
    .tour-hero{grid-template-columns:1fr;gap:6px;margin-top:12px}
    .tour-hero div{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:10px;padding:8px 11px}
    .tour-hero b{font-size:22px}.tour-hero span{margin:0}
    .tour-res b{font-size:17px}.tour-f{margin-top:10px}}
  /* Schmale Leiste (Copilot offen auf schmalen Bildschirmen): Schritt, Titel, Weiter */
  .tour-card.mini{bottom:auto;padding:8px 10px 8px 14px;transform:none;
    display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:10px}
  .tour-card.mini .tour-top{grid-column:1;margin:0}.tour-card.mini .tour-t{grid-column:1;font-size:var(--fs-lg);margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tour-card.mini .tour-f{grid-column:2;grid-row:1/3;margin:0}
  .tour-card.mini .tour-x,.tour-card.mini .tour-res,.tour-card.mini .tour-alert,.tour-card.mini .tour-more,.tour-card.mini .tour-auto,.tour-card.mini .tour-dots,
  .tour-card.mini [data-prev],.tour-card.mini .tour-f .spacer,.tour-card.mini .tour-progress{display:none}
  body.tour-on .drawer-b::after{content:"";display:block;flex:none;height:var(--tour-dpad,0px)}
  `, 'tour');

  const has = (viewId) => WF.views.some(v => v.id === viewId);
  const sim = () => WF.sim;

  /** Ein angekündigter Wechsel soll während des Schritts angekündigt bleiben (bei 30× ≈ 7 Sim-Minuten je Schritt). */
  const AHEAD = 15 * 60;
  const plannedEta = (t) => (t && t.plannedChange && t.plannedChange.etaT) || null;
  /** Maschine mit dem nächsten geplanten Werkzeugwechsel, der noch nicht unmittelbar bevorsteht. */
  function pickToolMachine() {
    const now = sim().state.t;
    let best = null, bestT = Infinity, near = null, nearT = Infinity;
    for (const id of WF.profile.machines) {
      let mv; try { mv = sim().machineView(id); } catch (e) { continue; }
      if (!mv || !mv.tools || mv.state !== 'running') continue;
      for (const t of mv.tools) {
        const eta = plannedEta(t); if (!eta) continue;
        if (eta >= now + AHEAD && eta < bestT) { bestT = eta; best = id; }
        if (eta < nearT) { nearT = eta; near = id; }
      }
    }
    return best || near || 'M05';
  }
  /** Werkzeug mit dem frühesten (nicht unmittelbar bevorstehenden) geplanten Wechsel an einer Maschine. */
  function soonestTool(mv) {
    const now = sim().state.t, tools = (mv && mv.tools) || [];
    const by = (list) => list.reduce((b, t) => (!b || plannedEta(t) < plannedEta(b) ? t : b), null);
    return by(tools.filter(t => plannedEta(t) >= now + AHEAD)) || by(tools.filter(plannedEta)) || tools.find(t => t.remainingParts != null) || null;
  }
  const parts = (n) => U.fmtNum(n) + (n === 1 ? ' Teil' : ' Teile');
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
  /** Ergebniszeile der Störung: Was passiert mit dem verfolgten Auftrag? (eine Wahrheit: Engine-Prognose, Termin) */
  function faultResult(ctx) {
    if (!ctx || !ctx.orderId || ctx.after == null) return '';
    const S = sim().state, o = S.orders[ctx.orderId];
    if (!o) return '';
    const now = S.t, d = ctx.before != null ? ctx.after - ctx.before : 0, slack = o.due - ctx.after;
    const shifted = d > 60;
    const c = slack < 0 ? 'var(--st-fault)' : shifted ? 'var(--st-wait)' : 'var(--st-run)';
    const main = shifted
      ? `<b>${U.fmtDue(ctx.before, now)} → ${U.fmtDue(ctx.after, now)}</b><span><em>+${U.fmtDur(d)}</em> · Termin ${U.fmtDue(o.due, now)} · ${slack < 0 ? `<em>${U.fmtDur(-slack)} zu spät</em>` : `noch ${U.fmtDur(slack)} Puffer`}</span>`
      : `<b>Termin hält – fertig ${U.fmtDue(ctx.after, now)}</b><span>Termin ${U.fmtDue(o.due, now)} · ${slack < 0 ? `<em>${U.fmtDur(-slack)} zu spät</em>` : `Puffer <em>${U.fmtDur(slack)}</em>`}</span>`;
    return `<div class="tour-res" style="--c:${c}"><span class="l">Auswirkung auf ${esc(ctx.orderId)} · neu gerechnet</span>${main}</div>`;
  }

  const STEPS = [
    { id: 'intro', center: true, title: 'werkfluss – das KI-native MES für den Mittelstand',
      body: () => `Produzierende Betriebe mit 5–50 Mio. € Umsatz steuern ihre Fertigung oft mit Zuruf, Excel und Papier. Klassische MES-Projekte kosten sechsstellig und dauern Monate.
          <b>werkfluss</b> rüstet eine Altmaschine in rund 20 Minuten nach, bringt das ganze Werk an einem Tag live und macht Material- und Informationsfluss in Echtzeit sichtbar. Ein Copilot kennt die Live-Daten und sagt, was zu tun ist.`,
      // Kennzahlen und Fußnote volle Kartenbreite (unter dem Text, der auf ~68 Zeichen begrenzt bleibt)
      after: () => {
        const k = sim().kpis();
        let late = null;
        try { const f = sim().forecast(); for (const id in f.orders) { const o = f.orders[id]; if (o && !o.done && o.late && (!late || o.slackSec < late.slackSec)) late = { id, slackSec: o.slackSec }; } } catch (e) { late = null; }
        return `<div class="tour-hero">
            <div><b>${liveCount()} / ${WF.profile.machines.length}</b><span>Stationen live – auch Baujahr 1998</span></div>
            <div><b>${U.fmtEur(k.lossEur)}</b><span>Stillstand heute – mit Ursache</span></div>
            <div><b>${late ? esc(late.id) : 'Termine'}</b><span>${late ? 'Verzug erkannt, bevor der Kunde anruft' : 'Liefertermine live prognostiziert'}</span></div>
          </div>
          <p class="tour-note">${esc(WF.profile.company.demoNote)}</p>`;
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
          (t ? ` Werkzeug <b>${esc(t.name)}</b>: ${t.remainingParts != null ? 'noch <b>' + parts(t.remainingParts) + '</b>' : ''}${plannedEta(t) ? (t.remainingParts != null ? ', ' : '') + 'Wechsel geplant ca. <b>' + U.fmtClock(plannedEta(t)) + '</b>' : ''} – angekündigt, bevor es passiert.` : '');
      } },
    { id: 'hall', view: 'halle', run: () => { WF.app.closeDrawer(); }, title: 'Der digitale Zwilling der Halle',
      body: () => `Alle Maschinen, Personen, AGVs und Behälter in Echtzeit. <b>Orange</b>: Materialfluss – welcher Behälter gerade von wo nach wo fährt. <b>Cyan</b>: Datenfluss – jede Meldung einer Maschine läuft zum werkfluss-Server. ${touch() ? 'Tippen' : 'Klick'} auf ein Objekt öffnet die Details.` },
    { id: 'order', view: 'halle', run: () => {
        const id = pickExternalOrder();
        if (id) {
          WF.app.select('order', id);
          // Unter 1280 px: Detail ausblenden, damit die Route die ganze Halle nutzt (Auswahl bleibt)
          if (window.innerWidth < 1280 && WF.app.hideDrawer) WF.app.hideDrawer();
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
      body: () => `Verschleiß wächst nur am Teilende und nie über 100 %. Gewechselt wird <b>nur zwischen zwei Teilen</b>, angekündigt mit Uhrzeit und Person. Wendeplatten wendet der Bediener direkt an der Maschine (Schneide 2 von 4); erst nach der letzten Schneide holt der Einrichter ein vermessenes Werkzeug aus der Ausgabe. Kein „plötzlich getauscht“, kein Bruch durch Überziehen.` },
    { id: 'fault', view: 'leitstand', compact: true, run: () => {
        const orderId = ctxs.order || null;
        // Zurück und wieder vor: dieselbe Störung zeigen statt eine zweite Maschine anzuhalten
        const prev = ctxs.fault, S = sim().state;
        if (prev && prev.ok && S.machines[prev.id] && S.machines[prev.id].state === 'fault') { WF.app.select('machine', prev.id); return prev; }
        const id = pickFaultMachine(orderId);
        const before = orderId ? etaRawOf(orderId) : null;
        const r = sim().actions.triggerFault(id, 'ALM 1021');
        const after = orderId ? etaRawOf(orderId) : null;
        let f = null; try { const mv = sim().machineView(id); f = mv && mv.fault; } catch (e) { f = null; }
        WF.app.select('machine', id);
        return { id, orderId, before, after, ok: !(r && r.ok === false), text: f && f.text };
      }, title: 'Störung – und was jetzt?',
      lead: (ctx) => faultResult(ctx),
      body: (ctx) => {
        const s = WF.profile.stationById[ctx && ctx.id];
        if (!ctx || !ctx.ok) return 'Fällt eine Maschine aus, alarmiert werkfluss sofort die Instandhaltung mit Ursache und Empfehlung und rechnet die Liefertermine neu.';
        return `An <b>${esc(s ? s.short : ctx.id)}</b> meldet die Steuerung gerade „${esc(ctx.text || 'Kühlmitteldruck zu niedrig')}“ (Demo). werkfluss alarmiert sofort die Instandhaltung mit Ursache und Empfehlung und rechnet die Liefertermine neu – das Ergebnis steht oben.`;
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
        timers.push(setTimeout(() => { if (idx === stepAt && WF.kiAuftrag && WF.kiAuftrag.analyze) { try { WF.kiAuftrag.analyze({ demo: true }); } catch (e) { /* ignorieren */ } } }, 1200));
      },
      title: 'Von der Zeichnung zum eingelasteten Auftrag',
      body: () => `Lohnfertiger kalkulieren den ganzen Tag. werkfluss liest die Zeichnung, schlägt Arbeitsplan, Maschinen, Zeiten, Preis und den realistischen Liefertermin aus der aktuellen Auslastung vor – ein Klick, und der Auftrag läuft durch die Fabrik.` },
    { id: 'value', center: true, title: 'Was werkfluss bringt',
      run: () => { WF.bus.emit('ai:close', {}); },
      body: () => {
        const k = sim().kpis();
        return `<ul>
          <li><b>Transparenz in Echtzeit</b> statt Zuruf: jede Maschine, jeder Auftrag, jeder Behälter, jede Person.</li>
          <li><b>Stillstand in Euro</b>: heute bisher ${U.fmtEur(k.lossEur)} – mit Ursache, damit er morgen kleiner ist.</li>
          <li><b>Planbare Werkzeugwechsel</b> und weniger Ausschuss durch Erstteil- und SPC-Prüfung.</li>
          <li><b>Termintreue</b> durch Prognose mit Engpasserkennung – inklusive Fremdbearbeitung.</li></ul>`;
      },
      after: () => {
        const r = roi();
        const price = 89, n = WF.profile.machines.length, yearCost = price * 12 * n;
        return `<div class="tour-hero">
            <div><b>+${U.fmtNum(r.gain / 1000)} T€</b><span>Kapazität pro Jahr bei +5 OEE-Punkten</span></div>
            <div><b>${price} €</b><span>je Station und Monat (Preisbeispiel)</span></div>
            <div><b>1 Tag</b><span>bis das ganze Werk live ist</span></div>
          </div>
          <p class="tour-note">Beispielrechnung mit den Stundensätzen dieser Demo: Ø ${U.fmtEur(r.rates / r.machines)}/h, ${r.machines} Maschinen, 2 Schichten à 8 h, 225 Tage. Preis: ${n} Stationen × ${price} € = ${U.fmtEur(yearCost)} im Jahr; Altmaschinen in ca. 20 Minuten nachgerüstet. Danke! Die Demo läuft weiter – alles ist anklickbar.</p>`;
      } },
  ];

  const touch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  let idx = -1, card = null, ring = null, scrim = null, ctxs = {}, autoTimer = null, auto = false, timers = [], expanded = false;
  let ringSel = null, ringScrolled = false, alertN = null, inRun = false, placeTimer = null, burstUntil = 0, placeSig = '';
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /** Endgültige linke Kante eines rechts angedockten Panels (ohne laufende Einblend-Animation). */
  function panelLeft(p) {
    const cs = getComputedStyle(p);
    if (cs.position === 'fixed' || cs.position === 'absolute') return window.innerWidth - (parseFloat(cs.right) || 0) - p.offsetWidth;
    return p.getBoundingClientRect().left;
  }
  /** Freier Bereich neben offenem Drawer / Copilot (in px) – dort andocken statt Inhalte zu verdecken. */
  function freeArea() {
    const vw = window.innerWidth;
    const side = document.querySelector('.side'); const sideR = side ? side.getBoundingClientRect() : null;
    const left = sideR && sideR.height > window.innerHeight * 0.5 ? sideR.right : 0;
    let right = vw;
    const dr = document.querySelector('.drawer.open'); if (dr) right = Math.min(right, panelLeft(dr));
    const ai = document.querySelector('.ai-panel.open'); if (ai) right = Math.min(right, panelLeft(ai));
    return { left, right, docked: right < vw - 8, drawer: dr, ai };
  }
  const MIN_W = 380;
  function setPad(name, px) { const v = Math.round(px) + 'px'; if (document.body.style.getPropertyValue(name) !== v) document.body.style.setProperty(name, v); }

  function placeCard() {
    if (!card) return;
    const step = STEPS[idx];
    if (card.classList.contains('center')) { setPad('--tour-pad', 0); setPad('--tour-dpad', 0); return; }
    const vw = window.innerWidth, f = freeArea();
    const phone = vw < 700, avail = f.right - f.left - 32, narrow = !phone && avail < MIN_W;
    const mini = !!f.ai && (phone || narrow);
    let mode, left = null, width = null, top = null;
    if (mini) {
      // Leiste im Copilot direkt unter dessen Kopf
      const aiL = Math.max(0, panelLeft(f.ai)), aiW = f.ai.offsetWidth;
      const h = f.ai.querySelector('.ai-h');
      mode = 'mini'; left = aiL + 10; width = Math.min(aiW, vw - aiL) - 20;
      top = (h ? h.getBoundingClientRect().bottom : f.ai.getBoundingClientRect().top + 56) + 8;
    } else if (phone) {
      mode = 'phone';
    } else if (narrow) {
      // Neben dem Drawer ist kein Platz: unten über die ganze Breite (Drawer-Inhalt scrollt darüber)
      mode = 'wide'; left = 16; width = vw - 32;
    } else {
      mode = 'dock';
      const w = Math.min(f.docked ? 540 : 600, avail);
      // In der Halle rechtsbündig, damit Hallenplan und Statuspanel links sichtbar bleiben
      const hall = WF.app && WF.app.current && WF.app.current.id === 'halle';
      const x = hall && avail > w + 40 ? f.right - 16 - w : f.left + 16 + (avail - w) / 2;
      left = Math.max(8, Math.round(x)); width = Math.round(w);
    }
    const wantCompact = mode !== 'dock' || !!step.compact;
    const sig = [mode, left, width, top, wantCompact, expanded].join('|');
    if (sig !== placeSig) {
      placeSig = sig;
      card.classList.toggle('mini', mode === 'mini');
      card.classList.toggle('compact', wantCompact && !expanded);
      card.style.left = left != null ? left + 'px' : '';
      card.style.width = width != null ? width + 'px' : '';
      card.style.top = top != null ? Math.round(top) + 'px' : '';
      card.style.transform = left != null ? 'none' : '';
      // „Mehr anzeigen“ nur, wenn wirklich etwas gekürzt ist
      const x = card.querySelector('.tour-x'), more = card.querySelector('[data-more]');
      const clipped = !!x && x.scrollHeight > x.clientHeight + 2;
      card.classList.toggle('can-more', wantCompact && mode !== 'mini' && (expanded || clipped));
      if (more) more.textContent = expanded ? 'Weniger anzeigen' : 'Mehr anzeigen';
    }
    // Inhalte unter der Karte bleiben erreichbar: Ansicht/Drawer bekommen unten so viel Scrollraum wie die Karte hoch ist
    const r = card.getBoundingClientRect();
    const pad = mode === 'mini' ? 0 : window.innerHeight - r.top + 12;
    setPad('--tour-pad', pad);
    setPad('--tour-dpad', f.drawer && (mode === 'phone' || mode === 'wide') ? pad : 0);
  }

  /** Ring um das Ziel: einmal ins Bild scrollen, auf sichtbaren Teil zuschneiden, nie unter der Karte. */
  function trackRing() {
    if (!ringSel || !card || card.classList.contains('mini')) { if (ring) ring.classList.add('off'); return; }
    const target = document.querySelector(ringSel);
    const tr = target && target.getBoundingClientRect();
    if (!tr || !tr.width || !tr.height) { if (ring) ring.classList.add('off'); return; }
    const cont = target.closest('.drawer-b, .view');
    const cr = cont ? cont.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const kr = card.getBoundingClientRect();
    const overlapsX = (a) => a.left < kr.right && a.right > kr.left;
    const limit = overlapsX(tr) ? Math.min(cr.bottom, kr.top - 12) : cr.bottom;
    if (!ringScrolled && cont) {
      ringScrolled = true;
      const fits = tr.top >= cr.top + 4 && tr.bottom <= limit - 4;
      if (!fits) {
        const top = Math.max(0, cont.scrollTop + tr.top - cr.top - 12);
        try { cont.scrollTo({ top, behavior: 'smooth' }); } catch (e) { cont.scrollTop = top; }
      }
    }
    // sichtbarer Ausschnitt des Ziels (+6 px Rand), innerhalb des Containers und oberhalb der Karte
    const L = Math.max(tr.left - 6, cr.left + 3), R = Math.min(tr.right + 6, cr.right - 3);
    const T = Math.max(tr.top - 6, cr.top + 3), B = Math.min(tr.bottom + 6, limit - 3, window.innerHeight - 3);
    if (!ring) { ring = el('div', { class: 'tour-ring off' }); document.body.append(ring); }
    if (R - L < 40 || B - T < 28) { ring.classList.add('off'); return; }
    Object.assign(ring.style, { left: Math.round(L) + 'px', top: Math.round(T) + 'px', width: Math.round(R - L) + 'px', height: Math.round(B - T) + 'px' });
    ring.classList.remove('off');
  }
  /** Kurz nach Schrittwechsel/Auswahl jede Frame nachführen (Drawer/Copilot gleiten herein), danach alle 450 ms. */
  function burst(ms) {
    const was = burstUntil > performance.now();
    burstUntil = Math.max(burstUntil, performance.now() + ms);
    if (was) return;
    const tickF = () => { if (idx < 0) return; placeCard(); trackRing(); if (performance.now() < burstUntil) requestAnimationFrame(tickF); };
    requestAnimationFrame(tickF);
  }
  let scrollRaf = 0;
  function onScroll() { if (idx < 0 || scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; trackRing(); }); }

  const AUTO_MS = 14000;
  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  function alertHtml(n) { return `${icon('alert', 15)}<b>${esc(n.title)}</b><span class="tour-alert-t">${WF.ui.notifTime(n)}</span>`; }
  function renderAlert() {
    if (!card || !alertN) return;
    let a = card.querySelector('.tour-alert');
    if (!a) { a = el('div', { class: 'tour-alert', role: 'status' }); card.insertBefore(a, card.querySelector('.tour-f')); }
    a.innerHTML = alertHtml(alertN);
    placeSig = ''; placeCard(); trackRing();
  }
  function render() {
    const step = STEPS[idx];
    if (card) card.remove();
    card = el('div', { class: 'tour-card' + (step.center ? ' center' : ''), role: 'dialog', 'aria-label': 'Demo-Tour' });
    let body = '', lead = '', after = '';
    try { body = step.body(ctxs[step.id]); } catch (e) { body = ''; console.error('[tour]', e); }
    try { after = step.after ? step.after(ctxs[step.id]) : ''; } catch (e) { after = ''; console.error('[tour]', e); }
    try { lead = step.lead ? step.lead(ctxs[step.id]) : ''; } catch (e) { lead = ''; console.error('[tour]', e); }
    card.innerHTML = `
      <div class="tour-top"><span class="tour-step">Demo-Tour · ${idx + 1} / ${STEPS.length}</span><span class="spacer"></span>
        <span class="tour-dots" aria-hidden="true">${STEPS.map((s, i) => `<i class="${i === idx ? 'on' : i < idx ? 'done' : ''}"></i>`).join('')}</span>
        <button class="icon-btn" data-x aria-label="Tour beenden" title="Tour beenden (Esc)">${icon('x')}</button></div>
      <div class="tour-t">${esc(step.title)}</div>
      ${lead}<div class="tour-x">${body}</div>${after}${step.center ? '' : '<button class="link tour-more" data-more>Mehr anzeigen</button>'}
      ${alertN ? `<div class="tour-alert" role="status">${alertHtml(alertN)}</div>` : ''}
      <div class="tour-f">
        <label class="tour-auto"><input type="checkbox" id="tour-auto" ${auto ? 'checked' : ''}> Automatisch weiter</label>
        <span class="spacer"></span>
        ${idx > 0 ? '<button class="btn" data-prev>Zurück</button>' : ''}
        <button class="btn primary" data-next>${idx === STEPS.length - 1 ? 'Tour beenden' : idx === 0 ? 'Tour starten' : 'Weiter'} ${idx < STEPS.length - 1 ? icon('arrowRight', 15) : ''}</button>
      </div>
      <div class="tour-progress"><i></i></div>`;
    card.querySelector('.tour-x').dataset.h = body;
    card.querySelector('[data-x]').onclick = () => stop();
    card.querySelector('[data-next]').onclick = () => go(idx + 1);
    const pv = card.querySelector('[data-prev]'); if (pv) pv.onclick = () => go(idx - 1);
    card.querySelector('#tour-auto').onchange = (e) => { auto = e.target.checked; scheduleAuto(); };
    const more = card.querySelector('[data-more]'); if (more) more.onclick = () => { expanded = !expanded; placeSig = ''; placeCard(); trackRing(); };
    document.body.append(card);
    if (!scrim) { scrim = el('div', { class: 'tour-scrim' }); document.body.insertBefore(scrim, card); }
    scrim.classList.toggle('on', !!step.center);
    placeSig = '';
    placeCard();
    burst(900);
    // Drawer/Copilot öffnen oft erst nach dem Schritt (Animation) – Position nachführen
    let n = 0;
    clearInterval(placeTimer); placeTimer = setInterval(() => { placeCard(); trackRing(); if (++n % 4 === 0) refreshText(); }, 450);
    scheduleAuto();
  }
  /** Zahlen im Kartentext laufen mit der Simulation mit (eine Wahrheit mit Drawer und Ansicht). */
  function refreshText() {
    if (!card || idx < 0) return;
    const step = STEPS[idx], x = card.querySelector('.tour-x');
    let html = null; try { html = step.body(ctxs[step.id]); } catch (e) { html = null; }
    if (x && html != null && x.dataset.h !== html) { x.innerHTML = html; x.dataset.h = html; placeSig = ''; placeCard(); }
  }
  function scheduleAuto() {
    clearAuto();
    const bar = card && card.querySelector('.tour-progress i');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0'; }
    if (!auto || idx >= STEPS.length - 1) return;
    requestAnimationFrame(() => { if (bar) { bar.style.transition = `width ${AUTO_MS}ms linear`; bar.style.width = '100%'; } });
    autoTimer = setTimeout(() => go(idx + 1), AUTO_MS);
  }
  function go(i) {
    if (i < 0) return;
    if (i >= STEPS.length) { stop(); return; }
    const prevCtx = idx >= 0 ? ctxs[STEPS[idx].id] : null;
    clearTimers(); expanded = false; alertN = null;
    idx = i;
    document.body.classList.add('tour-on');
    const step = STEPS[idx];
    if (step.view && has(step.view)) WF.app.navigate(step.view, step.viewParams);
    // Meldungen, die der Schritt selbst auslöst (Demo-Störung), erzählt die Karte – keine Hinweiszeile dafür
    inRun = true;
    if (step.run) { try { ctxs[step.id] = step.run(prevCtx); } catch (e) { console.error('[tour run]', e); } }
    inRun = false;
    ringSel = step.ring || null; ringScrolled = false;
    if (ring) ring.classList.add('off');
    render();
  }
  function stop() {
    clearAuto(); clearTimers(); clearInterval(placeTimer); placeTimer = null; burstUntil = 0;
    if (card) card.remove(); card = null;
    if (ring) ring.remove(); ring = null;
    if (scrim) { const s = scrim; scrim = null; s.classList.remove('on'); setTimeout(() => s.remove(), 400); }
    idx = -1; ctxs = {}; ringSel = null; alertN = null; placeSig = '';
    document.body.classList.remove('tour-on');
    document.body.style.removeProperty('--tour-pad'); document.body.style.removeProperty('--tour-dpad');
  }
  document.addEventListener('keydown', (e) => {
    if (idx < 0) return;
    if (e.key === 'Escape') { stop(); e.stopPropagation(); return; }
    // Pfeiltasten nicht abfangen, solange jemand tippt (z. B. Frage an den Copilot)
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
  }, true);
  window.addEventListener('resize', () => { if (idx >= 0) { placeSig = ''; ringScrolled = false; burst(400); } });
  document.addEventListener('scroll', onScroll, true);
  // Drawer/Copilot öffnen sich animiert – Karte und Ring nachführen
  WF.bus.on('select', () => { if (idx >= 0) burst(600); });

  WF.tour = {
    start: (opts = {}) => { auto = !!opts.auto; go(0); },
    stop,
    get active() { return idx >= 0; },
    /** Kritische Meldung während der Tour (statt Toast). Die Störung des Störungs-Schritts erzählt die Karte selbst. */
    notify(n) {
      if (idx < 0 || !n || inRun) return;
      const f = ctxs.fault;
      if (f && n.entity && n.entity.id === f.id) return;
      alertN = n; renderAlert();
    },
    steps: STEPS,
  };
})();
