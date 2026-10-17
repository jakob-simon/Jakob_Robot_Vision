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
  /* Störung: vorher → jetzt (vorher gedämpft), Verschiebung groß daneben */
  .tour-res .was{font:inherit;color:var(--muted)}
  .tour-res .tr-eta i{font-style:normal;color:var(--muted);margin:0 7px;font-weight:500}
  .tour-res .tr-d{font:600 var(--fs-xl)/1.2 var(--f-cond);font-variant-numeric:tabular-nums}
  .tour-res .tr-s{flex-basis:100%;margin-top:1px}
  .tour-res .tr-s .was{font-size:inherit}
  /* Geisterschicht-Prognose: Nachtband je autonomer Maschine (läuft → steht), Achse Schichtende → Schichtbeginn */
  .tour-gh{--c:var(--st-wait);margin:0 0 10px;padding:10px 12px 11px;border-radius:10px;background:color-mix(in srgb,var(--c) 6%,var(--card));
    border:1px solid color-mix(in srgb,var(--c) 28%,transparent);box-shadow:inset 3px 0 0 var(--c)}
  .tour-gh .l{display:block;font:600 var(--fs-2xs)/1.3 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .tg-hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin:3px 0 9px}
  .tg-h{font:600 var(--fs-xl)/1.2 var(--f-cond);color:var(--text)}
  .tg-s{font-size:var(--fs-sm);color:var(--text2);font-variant-numeric:tabular-nums}
  .tg-rows{display:flex;flex-direction:column;gap:4px}
  .tg-r{display:grid;grid-template-columns:118px minmax(0,1fr) 172px;align-items:center;gap:12px;min-height:30px}
  .tg-id{display:flex;align-items:baseline;gap:6px;min-width:0;white-space:nowrap;overflow:hidden}
  .tg-id b{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
  .tg-id small{font-size:var(--fs-xs);color:var(--muted);overflow:hidden;text-overflow:ellipsis}
  .tg-bar{position:relative;height:10px;border-radius:3px;background:var(--track);overflow:hidden}
  .tg-bar i{position:absolute;top:0;bottom:0}
  .tg-bar.none{background:none;box-shadow:inset 0 0 0 1px var(--line);opacity:.7}
  .tg-r.open .tg-id b{color:var(--text2)}
  .tg-bar .run{background:color-mix(in srgb,var(--st-run) 62%,transparent)}
  .tg-bar .halt{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--st-wait) 80%,transparent) 0 4px,color-mix(in srgb,var(--st-wait) 34%,transparent) 4px 8px)}
  .tg-bar .free{background:color-mix(in srgb,var(--st-idle) 28%,transparent)}
  .tg-bar .gain{border:1.5px dashed color-mix(in srgb,var(--st-run) 90%,white);border-radius:2px;background:color-mix(in srgb,var(--st-run) 16%,transparent)}
  .tg-w{display:flex;flex-direction:column;min-width:0;line-height:1.25}
  .tg-w b{font-size:var(--fs-sm);font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tg-w small{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tg-r.stop .tg-w b{color:color-mix(in srgb,var(--st-wait) 85%,white)}
  .tg-r.open .tg-w b{color:var(--text2);font-weight:500}
  .tg-axis{min-height:0}
  .tg-ticks{position:relative;height:13px}
  .tg-ticks span{position:absolute;top:0;transform:translateX(-50%);font-size:var(--fs-2xs);line-height:1.2;color:var(--faint);font-variant-numeric:tabular-nums}
  .tg-ticks span:first-child{transform:none}.tg-ticks span:last-child{transform:translateX(-100%)}
  .tg-a{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:9px;padding-top:10px;border-top:1px solid color-mix(in srgb,var(--c) 18%,var(--line))}
  .tg-gain{font-size:var(--fs-sm);color:var(--text2);font-variant-numeric:tabular-nums}.tg-gain b{color:color-mix(in srgb,var(--st-run) 85%,white);font-weight:600}
  .tg-ok{display:inline-flex;align-items:center;gap:6px;flex-basis:100%;font-size:var(--fs-sm);font-weight:600;color:color-mix(in srgb,var(--st-run) 85%,white)}
  .tg-ok .ico{flex:none}
  .tg-rec{display:flex;align-items:flex-start;gap:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .tg-rec>.ico{flex:none;margin-top:2px;color:color-mix(in srgb,var(--st-run) 85%,white)}.tg-rec b{color:var(--text);font-weight:600}
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
  /* Nutzen-Folie: vier Kacheln 2 × 2, die zwei Aussagen (Kapazität, Amortisation) im Akzent */
  .tour-hero.c4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tour-hero .hl{border-color:color-mix(in srgb,var(--accent) 34%,var(--line));background:color-mix(in srgb,var(--accent) 6%,var(--card))}
  .tour-hero .hl b{color:color-mix(in srgb,var(--accent) 70%,white)}
  .tour-note{margin:12px 0 0;font-size:var(--fs-xs);line-height:1.45;color:var(--muted)}
  .tour-progress{height:2px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:12px}
  .tour-progress i{display:block;height:100%;background:var(--accent);width:0}
  @media (max-width:560px){
    .tour-dots{display:none}.tour-card{padding:12px 14px 12px}.tour-x{font-size:var(--fs-md)}.tour-t{font-size:var(--fs-xl);margin-bottom:6px}
    .tour-card.center{padding:16px 16px 14px;max-height:calc(100vh - 100px)}.tour-card.center .tour-t{font-size:var(--fs-2xl)}
    .tour-hero{grid-template-columns:1fr;gap:6px;margin-top:12px}
    .tour-hero div{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:10px;padding:8px 11px}
    .tour-hero b{font-size:22px}.tour-hero span{margin:0}
    .tour-res b{font-size:17px}.tour-res .tr-d{font-size:17px}.tour-f{margin-top:10px}
    .tour-hero.c4{grid-template-columns:1fr}
    .tg-h{font-size:17px}.tg-s{font-size:var(--fs-xs)}
    .tg-r{grid-template-columns:46px minmax(0,1fr) 116px;gap:8px;min-height:28px}
    .tg-id small{display:none}.tg-ticks span:nth-child(2n){display:none}}
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
  const short = (id) => { const s = WF.profile.stationById[id]; return s ? s.short : id; };

  // ---------------------------------------------------------------- Störung: dort, wo der Termin sich sichtbar bewegt
  /** Alarm mit der längsten Reparaturzeit aus dem Katalog der Station – ohne Werkzeugbruch (kein Ausschuss in der Demo). */
  function longFaultCode(id) {
    const P = WF.profile, st = P.stationById[id] || {}, F = P.faults || {};
    const cat = (st.type === 'washer' || st.type === 'cmm' || st.type === 'assembly' ? (F[st.type] || [])
      : (F.generic || []).concat(F[st.automation] || [], F[st.type] || [])).filter(f => !f.toolBreak);
    if (!cat.length) return undefined;
    return cat.reduce((b, f) => ((f.repairMin || [0, 0])[1] > (b.repairMin || [0, 0])[1] ? f : b)).code;
  }
  /** Kandidaten (Maschine, Auftrag) in der Reihenfolge, in der eine Störung den Liefertermin am sichersten bewegt:
      beim verfolgten Auftrag der am weitesten fortgeschrittene laufende Arbeitsgang (er taktet den Rest der Kette),
      dann sein begrenzender Schritt; danach knappe Aufträge (Kippen „knapp → verspätet“), dann die mit wenig Puffer. */
  function faultCandidates(trackId) {
    const S = sim().state, out = [];
    const ok = (id) => { const m = S.machines[id], st = WF.profile.stationById[id]; return !!(m && st && st.kind === 'machine' && m.state === 'running' && !m.fault); };
    const add = (id, oid) => { if (id && ok(id) && !out.some(c => c.id === id)) out.push({ id, orderId: oid }); };
    const pushOrder = (oid) => {
      let ov = null; try { ov = sim().orderView(oid); } catch (e) { ov = null; }
      if (!ov || ov.status === 'fertig') return;
      ov.ops.filter(o => o.state === 'active').sort((a, b) => b.seq - a.seq).forEach(o => add(o.station, oid));
      if (ov.bottleneckStation) add(ov.bottleneckStation, oid);
    };
    if (trackId) pushOrder(trackId);
    let f = null; try { f = sim().forecast(); } catch (e) { f = null; }
    const rank = { knapp: 0, ok: 1, 'spät': 2 };
    const ids = Object.keys(S.orders).filter(id => S.orders[id].status !== 'fertig' && id !== trackId);
    const riskOf = (id) => { try { return sim().orderView(id).risk; } catch (e) { return 'ok'; } };
    const slack = (id) => (f && f.orders[id] && f.orders[id].slackSec != null ? f.orders[id].slackSec : Infinity);
    ids.map(id => ({ id, r: rank[riskOf(id)] != null ? rank[riskOf(id)] : 3, s: slack(id) }))
      .sort((a, b) => a.r - b.r || a.s - b.s).slice(0, 12).forEach(x => pushOrder(x.id));
    if (!out.length) { const any = WF.profile.machines.find(ok); if (any) out.push({ id: any, orderId: trackId }); }
    return out;
  }
  /** Ungeglättete Prognose aller offenen Aufträge (dieselbe Rechnung, die die Engine nach einer Störung sofort veröffentlicht) */
  function etaMap() {
    const m = {};
    try { const f = sim().forecast(0); for (const id in f.orders) { const o = f.orders[id]; if (o && !o.done) m[id] = o.etaRaw != null ? o.etaRaw : o.eta; } } catch (e) { /* leer */ }
    return m;
  }
  /** Störung auslösen und den Auftrag wählen, an dem man die Reaktion sieht (verfolgter Auftrag, wenn er sich bewegt). */
  function runFault(trackId) {
    const S = sim().state, cands = faultCandidates(trackId);
    const c = cands[0] || { id: 'M07', orderId: trackId };
    const before = etaMap(), code = longFaultCode(c.id);
    let r = sim().actions.triggerFault(c.id, code);
    if (r && r.ok === false && code) r = sim().actions.triggerFault(c.id);
    const after = etaMap();
    const due = (id) => S.orders[id] ? S.orders[id].due : Infinity;
    const moved = Object.keys(after).filter(id => before[id] != null && after[id] - before[id] >= 60)
      .map(id => ({ id, d: after[id] - before[id], flip: before[id] <= due(id) && after[id] > due(id) }));
    const pick = moved.find(x => x.id === trackId) || moved.find(x => x.flip) || moved.find(x => x.id === c.orderId) || moved.sort((a, b) => b.d - a.d)[0] || null;
    const oid = pick ? pick.id : (trackId || c.orderId);
    let mv = null; try { mv = sim().machineView(c.id); } catch (e) { mv = null; }
    const fl = mv && mv.fault;
    return { id: c.id, orderId: oid, trackId, before: oid ? before[oid] : null, after: oid ? after[oid] : null, ok: !(r && r.ok === false),
      text: fl && fl.text, code: fl && fl.code, repairMin: fl && fl.repairMin, moved: moved.length };
  }

  // ---------------------------------------------------------------- Geisterschicht-Prognose (Engine: ghostPreview, sonst ghostCheck)
  const GHOST_WHAT = { bars: 'Stangen leer', input: 'Teile fehlen', output: 'Ausgang voll', material: 'Material fehlt', fpi: 'Erstteil nicht freigegeben', fault: 'Störung' };
  const ghostStops = (e) => e.stopT != null && e.reason !== 'done' && e.reason !== 'ahead' && e.reason !== 'through';
  function ghostInfo() {
    const s = sim(); let g = null, src = null;
    if (typeof s.ghostPreview === 'function') { try { g = s.ghostPreview(); src = 'preview'; } catch (e) { console.error('[tour ghost]', e); g = null; } }
    if (!g && typeof s.ghostCheck === 'function') { try { g = s.ghostCheck(); src = 'check'; } catch (e) { g = null; } }
    if (!g) return null;
    const raw = Array.isArray(g.machines) ? g.machines : g.machines ? Object.values(g.machines) : Array.isArray(g.entries) ? g.entries : [];
    const list = raw.map(e => Object.assign({}, e, { machineId: e.machineId || e.id })).filter(e => e.machineId);
    if (!list.length) return null;
    const order = (e) => (ghostStops(e) ? 0 : e.reason === 'done' ? 1 : 2);
    list.sort((a, b) => order(a) - order(b) || (a.stopT == null ? Infinity : a.stopT) - (b.stopT == null ? Infinity : b.stopT) || (a.machineId < b.machineId ? -1 : 1));
    const nextStart = g.nextStart || g.until, staffEnd = g.staffEnd;
    const stops = list.filter(ghostStops);
    // ungenutzte Maschinenzeit in der Nacht zum Maschinenstundensatz (Engine: costs().machineRates)
    let rates = null; try { rates = s.costs && s.costs().machineRates; } catch (e) { rates = null; }
    const rateOf = (id) => (rates && rates[id] != null ? rates[id] : (WF.profile.stationById[id] || {}).rate || 0);
    const idleSec = (e) => Math.max(0, (nextStart || 0) - Math.max(e.stopT, staffEnd || 0));
    const lossEur = g.lossEur != null ? g.lossEur : stops.reduce((a, e) => a + idleSec(e) / 3600 * rateOf(e.machineId), 0);
    const idleH = stops.reduce((a, e) => a + idleSec(e), 0) / 3600;
    return { src, list, stops, staffEnd, nextStart, lossEur, idleH, night: sim().state.t >= (staffEnd || Infinity) };
  }
  /** Prognose als Nachtband je Maschine: läuft (grün) bis zum Stopp, danach steht sie (gelb gestreift) bis Schichtbeginn. */
  function ghostLead() {
    const G = ghostInfo();
    if (!G) return '';
    const t0 = G.staffEnd, t1 = G.nextStart;
    if (!(t1 > t0)) return '';
    const span = t1 - t0, pct = (t) => U.clamp((t - t0) / span * 100, 0, 100);
    const seg = (cls, from, to) => (to - from > 0.2 ? `<i class="${cls}" style="left:${from.toFixed(1)}%;width:${(to - from).toFixed(1)}%"></i>` : '');
    // Tagsüber endende Arbeitsgänge (Nacht noch offen) ans Ende
    const dayDone = (e) => e.reason === 'done' && e.stopT != null && e.stopT <= t0;
    const list = G.list.slice().sort((x, y) => (dayDone(x) ? 1 : 0) - (dayDone(y) ? 1 : 0));
    const rows = list.slice(0, phoneish() ? 4 : 5).map(e => {
      const stop = ghostStops(e), done = e.reason === 'done', open = dayDone(e);
      const end = e.stopT == null ? t1 : Math.max(t0, e.stopT), p = pct(end);
      let when, what, bar;
      if (stop) {
        when = e.waitingSince != null ? 'steht seit ' + U.fmtClock(e.waitingSince) : 'stoppt ca. ' + U.fmtClock(end);
        what = e.reason === 'tool' ? 'Standzeit ' + toolLabel(e.toolName || e.tool) : GHOST_WHAT[e.reason] || e.reason;
        // gestrichelt: so lange liefe sie mit dem empfohlenen Handgriff vor Schichtende
        bar = seg('run', 0, p) + seg('halt', p, 100) + (e.gainSec > 0 ? seg('gain', p, pct(end + e.gainSec)) : '');
      } else if (open) {
        when = 'fertig ca. ' + U.fmtClock(e.stopT); what = (e.orderId ? e.orderId + ' · ' : '') + 'vor Schichtende'; bar = '';
      } else if (done) {
        when = 'fertig ca. ' + U.fmtClock(end); what = 'Auftrag fertig – danach frei'; bar = seg('run', 0, p) + seg('free', p, 100);
      } else {
        when = 'läuft bis ' + U.fmtClock(t1); what = e.prevented ? 'vorbeugend abgesichert' : 'Standzeit, Stangen, Puffer reichen'; bar = seg('run', 0, 100);
      }
      return `<div class="tg-r${stop ? ' stop' : ''}${open ? ' open' : ''}" title="${esc(e.rec || '')}"><span class="tg-id"><b>${esc(e.machineId)}</b><small>${esc(short(e.machineId))}</small></span>
        <span class="tg-bar${open ? ' none' : ''}">${bar}</span><span class="tg-w"><b>${esc(when)}</b><small>${esc(what)}</small></span></div>`;
    }).join('');
    const act = G.stops.find(e => e.action);
    const tip = !act && G.stops.filter(e => e.gainSec > 0 && e.rec).sort((a, b) => b.gainSec - a.gainSec)[0];
    const k = G.stops.length, n = G.list.length;
    const head = k ? `${k} von ${n} autonomen Maschinen ${k === 1 ? 'stoppt' : 'stoppen'} in der Nacht` : `Alle ${n} autonomen Maschinen laufen durch`;
    const sub = k ? `≈ ${U.fmtEur(Math.round(G.lossEur / 10) * 10)} ungenutzte Maschinenzeit · ${U.fmtNum(G.idleH, 1)} h Stillstand bis ${U.fmtClock(t1)}` : `Standzeit, Stangen und Puffer reichen bis ${U.fmtClock(t1)}`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<span style="left:${(f * 100).toFixed(1)}%">${U.fmtClock(t0 + f * span)}</span>`).join('');
    const done = ghostDone ? `<span class="tg-ok">${icon('check', 14)}${esc(ghostDone)}</span>` : '';
    const btn = act ? `<button class="btn sm primary" data-gh-act="${esc(act.machineId)}">${icon('wrench', 14)}${esc(act.actionLabel || act.machineId + ': vorbeugend wechseln')}</button>
        <span class="tg-gain">${act.gainSec ? `<b>+${esc(U.fmtDur(act.gainSec))}</b> Laufzeit` : ''}${act.tLast ? ` · Wechsel ca. ${esc(U.fmtClock(act.tLast))}` : ''}</span>`
      : tip ? `<span class="tg-rec">${icon('wrench', 14)}<span><b>Empfehlung ${esc(tip.machineId)}:</b> ${esc(tip.rec)}</span></span>` : '';
    return `<div class="tour-gh" style="--c:${k ? 'var(--st-wait)' : 'var(--st-run)'}">
      <span class="l">${G.night ? 'Geisterschicht läuft' : 'Heute Nacht'} · unbemannt ${esc(U.fmtClock(t0))}–${esc(U.fmtClock(t1))}${G.src === 'preview' && !G.night ? ' · Prognose' : ''}</span>
      <div class="tg-hd"><b class="tg-h">${esc(head)}</b><span class="tg-s">${esc(sub)}</span></div>
      <div class="tg-rows">${rows}<div class="tg-r tg-axis"><span></span><span class="tg-ticks">${ticks}</span><span></span></div></div>
      ${done || btn ? `<div class="tg-a">${done}${btn}</div>` : ''}</div>`;
  }
  let ghostDone = '';
  /** Dieselbe Prognose im Leitstand (eigene Karte oder Zeile „Heute Nacht“ im KI-Schichtbriefing) – für den Ring */
  function ghostRow() {
    const v = document.getElementById('view-leitstand'); if (!v) return null;
    return v.querySelector('[data-ghost], .ls-ghost') || [...v.querySelectorAll('.ls-bl li')].find(li => /Heute Nacht|Geisterschicht/.test((li.querySelector('.ls-bl-k') || li).textContent)) || null;
  }
  /** Kurzname eines Werkzeugtyps wie in den Meldungen („VCGT 1103“, „Stechplatte 3 mm“) */
  function toolLabel(type) {
    const tt = (WF.profile.toolTypeById || {})[type], n = String((tt && tt.name) || type || 'Werkzeug').replace(/\s*\([^)]*\)/g, '').replace(/^WSP\s+/, '');
    const code = n.match(/\b[A-Z]{4}\s?\d{4,6}\b/);
    if (code) return code[0];
    return n.length > 24 ? n.split(/\s+/).slice(0, 2).join(' ') : n;
  }
  const phoneish = () => window.innerWidth < 700;
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
  /** „vorher → jetzt“ kompakt: gleicher Tag nur einmal nennen („morgen 14:55 → 15:28“) */
  function dueArrow(a, b, now) {
    const da = U.fmtDue(a, now), db = U.fmtDue(b, now);
    const pa = da.slice(0, da.length - 5), pb = db.slice(0, db.length - 5);
    return `<span class="was">${esc(da)}</span><i>→</i>${esc(pa === pb ? U.fmtClock(b) : db)}`;
  }
  const slackTxt = (s) => (s < 0 ? `${U.fmtDur(-s)} zu spät` : `${U.fmtDur(s)} Puffer`);
  /** Ergebnis der Störung: Was passiert mit dem Liefertermin? (eine Wahrheit: Engine-Prognose, sofort neu gerechnet) */
  function faultResult(ctx) {
    if (!ctx || !ctx.ok || !ctx.orderId || ctx.after == null) return '';
    const S = sim().state, o = S.orders[ctx.orderId];
    if (!o) return '';
    const now = S.t, d = ctx.before != null ? ctx.after - ctx.before : 0;
    const s0 = ctx.before != null ? o.due - ctx.before : null, s1 = o.due - ctx.after;
    const shifted = d >= 60, flip = s0 != null && s0 >= 0 && s1 < 0;
    const c = s1 < 0 ? 'var(--st-fault)' : shifted ? 'var(--st-wait)' : 'var(--st-run)';
    const other = ctx.trackId && ctx.orderId !== ctx.trackId;
    if (!shifted) {
      let lim = ''; try { lim = sim().orderView(ctx.orderId).limitText || ''; } catch (e) { lim = ''; }
      return `<div class="tour-res" style="--c:${c}"><span class="l">Auswirkung auf ${esc(ctx.orderId)} · neu gerechnet</span>
        <b>Termin hält – fertig ${esc(U.fmtDue(ctx.after, now))}</b><span>Termin ${esc(U.fmtDue(o.due, now))} · Puffer <em>${esc(U.fmtDur(s1))}</em>${lim ? ' · ' + esc(lim) : ''}</span></div>`;
    }
    return `<div class="tour-res tr-move" style="--c:${c}"><span class="l">Auswirkung auf ${esc(ctx.orderId)}${other ? ' · ' + esc(o.part && o.part.name ? o.part.name : '') : ''} · vorher → jetzt</span>
      <b class="tr-eta">${dueArrow(ctx.before, ctx.after, now)}</b><em class="tr-d">+${esc(U.fmtDur(d))}</em>
      <span class="tr-s">Termin ${esc(U.fmtDue(o.due, now))} · ${s0 != null ? `<span class="was">${esc(slackTxt(s0))}</span> → ` : ''}<em>${esc(slackTxt(s1))}</em>${flip ? ' – <em>Termin kippt</em>' : ''}</span></div>`;
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
        if (!mv) return 'Zustand mit Ursache, Auftrag, Teilefortschritt und Live-Signale aus der Steuerung.';
        const t = soonestTool(mv);
        return `<b>${esc(mv.short)} (${esc(mv.id)})</b>: Zustand mit Ursache, Auftrag, Teilefortschritt und Live-Signale aus der Steuerung – ${esc(mv.vendor ? mv.vendor + ', ' : '')}Baujahr ${esc(mv.year || '–')}.` +
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
    { id: 'ghost', view: 'leitstand', compact: true, ring: () => ghostRow(),
      run: () => { WF.app.closeDrawer(); ghostDone = ''; },
      title: 'Heute Nacht: der Geisterschicht-Check',
      lead: () => ghostLead(), liveLead: true,
      body: () => {
        const G = ghostInfo();
        if (!G) return `Nach Schichtende laufen autonome Maschinen allein weiter. Ab 21:00 rechnet werkfluss Teil für Teil durch, welche davon in der Nacht stehen bleiben – Standzeit, Stangen, Puffer – und empfiehlt den einen Handgriff vor Schichtende, der die Nacht rettet.`;
        const act = G.stops.some(e => e.action);
        return `Nach ${esc(U.fmtClock(G.staffEnd))} ist niemand mehr im Haus, die autonomen Maschinen laufen allein weiter. werkfluss rechnet schon jetzt Teil für Teil durch, <b>welche in der Nacht stehen bleiben</b> und warum – und welcher Handgriff vor Schichtende die Nacht rettet${act ? '. Ein Klick plant ihn ein.' : ` (gestrichelt). Ab ${esc(U.fmtClock(G.staffEnd - 3600))} kommt das als Meldung mit Ein-Klick-Aktion${ghostRow() ? '; im Leitstand steht es schon jetzt unter „Heute Nacht“' : ''}.`}`;
      } },
    { id: 'fault', view: 'leitstand', compact: true, run: () => {
        // Zurück und wieder vor: dieselbe Störung zeigen statt eine zweite Maschine anzuhalten
        const prev = ctxs.fault, S = sim().state;
        if (prev && prev.ok && S.machines[prev.id] && S.machines[prev.id].state === 'fault') { WF.app.select('machine', prev.id); return prev; }
        const r = runFault(ctxs.order || null);
        WF.app.select('machine', r.id);
        return r;
      }, title: 'Störung – und der Liefertermin reagiert sofort',
      lead: (ctx) => faultResult(ctx),
      body: (ctx) => {
        if (!ctx || !ctx.ok) return 'Fällt eine Maschine aus, alarmiert werkfluss sofort die Instandhaltung mit Ursache und Empfehlung und rechnet die Liefertermine neu.';
        const rep = ctx.repairMin ? ` (Reparatur ca. ${ctx.repairMin[0]}–${ctx.repairMin[1]} min)` : '';
        let risk = ''; try { risk = ctx.orderId ? sim().orderView(ctx.orderId).risk : ''; } catch (e) { risk = ''; }
        const why = risk === 'spät' ? '„Warum verspätet“' : risk === 'knapp' ? '„Warum knapp“' : '';
        return `An <b>${esc(short(ctx.id))} (${esc(ctx.id)})</b> meldet die Steuerung gerade „${esc(ctx.text || 'Störung')}“${esc(rep)} – Demo. werkfluss alarmiert sofort die Instandhaltung mit Ursache und Empfehlung und rechnet alle Liefertermine neu – das Ergebnis steht oben${why ? `, ${why} im Auftrag zeigt Ursache und Hebel` : ''}.`;
      } },
    { id: 'copilot', view: 'leitstand', run: (prev) => {
        const id = prev && prev.id;
        const oid = prev && prev.orderId;
        askCopilot(`Die ${id ? short(id) : 'Maschine'} hat eine Störung.${oid ? ' Was bedeutet das für ' + oid + ' und meine anderen Termine' : ' Was bedeutet das für meine Termine'} – und was soll ich jetzt tun?`, id ? { kind: 'machine', id } : null);
      }, compact: true, ring: '.ai-panel.open', title: 'Der Copilot kennt jede Zahl in der Halle',
      body: () => `Er beantwortet Fragen in Alltagssprache aus den Live-Daten: gefährdete Aufträge, Engpässe, Werkzeugwechsel, Material, Schichtübergabe. Auf Wunsch handelt er auch – Eilauftrag, Express bei der Härterei, Los teilen, Nachbestellung – immer erst nach Bestätigung.` },
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
        const months = r.gain > 0 ? yearCost / (r.gain / 12) : null;
        const pay = months == null ? '–' : months < 1 ? '< 1 Monat' : `ca. ${U.fmtNum(Math.ceil(months))} Monate`;
        return `<div class="tour-hero c4">
            <div class="hl"><b>+${U.fmtNum(r.gain / 1000)} T€</b><span>zusätzliche Kapazität (Umsatzpotenzial) pro Jahr bei +5 OEE-Punkten</span></div>
            <div class="hl"><b>${pay}</b><span>Amortisation: ${U.fmtEur(yearCost)} Abo im Jahr gegen ${U.fmtNum(r.gain / 1000)} T€</span></div>
            <div><b>${price} €</b><span>je Station und Monat (Preisbeispiel)</span></div>
            <div><b>1 Tag</b><span>bis das ganze Werk live ist</span></div>
          </div>
          <p class="tour-note">Beispielrechnung mit den Stundensätzen dieser Demo: Ø ${U.fmtEur(r.rates / r.machines)}/h, ${r.machines} Maschinen, 2 Schichten à 8 h, 225 Tage – bewertet zum Maschinenstundensatz (Umsatzpotenzial, kein Gewinn). Preis: ${n} Stationen × ${price} € × 12 = ${U.fmtEur(yearCost)} im Jahr; Altmaschinen in ca. 20 Minuten nachgerüstet. Danke! Die Demo läuft weiter – alles ist anklickbar.</p>`;
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
    let target = null;
    try { target = typeof ringSel === 'function' ? ringSel() : document.querySelector(ringSel); } catch (e) { target = null; }
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
    // War der Ring aus (neuer Schritt), springt er an die neue Stelle und blendet ein – kein Gleiten vom alten Ziel
    const wasOff = ring.classList.contains('off');
    if (wasOff) ring.style.transition = 'opacity .2s ease';
    Object.assign(ring.style, { left: Math.round(L) + 'px', top: Math.round(T) + 'px', width: Math.round(R - L) + 'px', height: Math.round(B - T) + 'px' });
    ring.classList.remove('off');
    if (wasOff) { const r0 = ring; requestAnimationFrame(() => requestAnimationFrame(() => { r0.style.transition = ''; })); }
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

  /** Copilot-Frage der Tour: immer die schnelle Antwort aus den Live-Daten (regelbasiert) – nie ein langsamer Live-Aufruf
      mit Datenabfragen, den „Automatisch weiter“ überholen würde. 60_ai: askOffline(), sonst context.tour. */
  function askCopilot(text, context) {
    const A = WF.ai, ctx = Object.assign({}, context || {}, { tour: true, offline: true });
    if (A && typeof A.askOffline === 'function') { try { A.askOffline(text, ctx); return; } catch (e) { console.error('[tour ai]', e); } }
    WF.bus.emit('ai:ask', { text, context: ctx });
  }
  /** Ein-Klick-Vorbeugung aus der Geisterschicht-Prognose (gleiche Aktion wie in der Meldung „Geisterschicht-Check“) */
  function runGhostAction(mid) {
    const G = ghostInfo(), e = G && G.stops.find(x => x.machineId === mid && x.action);
    if (!e) return;
    const s = sim();
    let r; try { r = s.actions && typeof s.actions.run === 'function' ? s.actions.run(e.action) : s.runAction(e.action); } catch (err) { r = { ok: false, msg: err.message }; }
    ghostDone = r && r.ok === false ? (r.msg || 'Nicht möglich') : `Eingeplant: ${e.recShort || e.actionLabel || mid}${e.gainSec ? ' – +' + U.fmtDur(e.gainSec) + ' Laufzeit in der Nacht' : ''}`;
    refreshText(true);
  }

  const AUTO_MS = 14000, AI_HOLD_MS = 30000;
  let autoHoldT = 0;
  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } autoHoldT = 0; }
  /** Automatisch weiter – aber nie, während der Copilot noch schreibt (höchstens 30 s warten) */
  function autoNext() {
    autoTimer = null;
    const busy = document.querySelector('.ai-panel.open.busy');
    if (busy) {
      if (!autoHoldT) autoHoldT = performance.now();
      if (performance.now() - autoHoldT < AI_HOLD_MS) { autoTimer = setTimeout(autoNext, 700); return; }
    }
    autoHoldT = 0;
    go(idx + 1);
  }
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
      ${lead ? `<div class="tour-lead" data-lead>${lead}</div>` : ''}<div class="tour-x">${body}</div>${after}${step.center ? '' : '<button class="link tour-more" data-more>Mehr anzeigen</button>'}
      ${alertN ? `<div class="tour-alert" role="status">${alertHtml(alertN)}</div>` : ''}
      <div class="tour-f">
        <label class="tour-auto"><input type="checkbox" id="tour-auto" ${auto ? 'checked' : ''}> Automatisch weiter</label>
        <span class="spacer"></span>
        ${idx > 0 ? '<button class="btn" data-prev>Zurück</button>' : ''}
        <button class="btn primary" data-next>${idx === STEPS.length - 1 ? 'Tour beenden' : idx === 0 ? 'Tour starten' : 'Weiter'} ${idx < STEPS.length - 1 ? icon('arrowRight', 15) : ''}</button>
      </div>
      <div class="tour-progress"><i></i></div>`;
    card.querySelector('.tour-x').dataset.h = body;
    { const lb = card.querySelector('[data-lead]'); if (lb) lb.dataset.h = lead; }
    card.addEventListener('click', (e) => { const b = e.target.closest('[data-gh-act]'); if (b && !b.disabled) { b.disabled = true; runGhostAction(b.dataset.ghAct); } });
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
  /** Zahlen im Kartentext (und im Ergebnisblock) laufen mit der Simulation mit (eine Wahrheit mit Drawer und Ansicht). */
  function refreshText(withLead) {
    if (!card || idx < 0) return;
    const step = STEPS[idx], x = card.querySelector('.tour-x');
    let html = null; try { html = step.body(ctxs[step.id]); } catch (e) { html = null; }
    let changed = false;
    if (x && html != null && x.dataset.h !== html) { x.innerHTML = html; x.dataset.h = html; changed = true; }
    // Ergebnisblock (z. B. Geisterschicht-Prognose) nur auf Wunsch bzw. bei Live-Schritten neu zeichnen – Störung bleibt „vorher → jetzt“
    if (step.lead && (withLead || step.liveLead)) {
      const box = card.querySelector('[data-lead]');
      let lh = ''; try { lh = step.lead(ctxs[step.id]) || ''; } catch (e) { lh = ''; }
      if (box && box.dataset.h !== lh) { box.innerHTML = lh; box.dataset.h = lh; changed = true; }
    }
    if (changed) { placeSig = ''; placeCard(); }
  }
  function scheduleAuto() {
    clearAuto();
    const bar = card && card.querySelector('.tour-progress i');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0'; }
    if (!auto || idx >= STEPS.length - 1) return;
    requestAnimationFrame(() => { if (bar) { bar.style.transition = `width ${AUTO_MS}ms linear`; bar.style.width = '100%'; } });
    autoTimer = setTimeout(autoNext, AUTO_MS);
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
