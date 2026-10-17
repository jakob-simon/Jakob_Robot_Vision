/* werkfluss – Ansicht „Leitstand“ (40_leitstand.js)
   Erste Ansicht des Produktionsleiters und TV-Wandtafel: Kopf mit Schicht/Personal, KPI-Leiste,
   Kachel je Arbeitsplatz (Zustand, Ursache, Auftrag, Fortschritt, kritischstes Werkzeug, Bediener,
   Puffer und Materialfluss, Zustandsband 4 h), Abschluss-Kachel „Schichtverlauf · Als Nächstes“,
   rechts „Jetzt wichtig“, KI-Schichtbriefing, „Gerade passiert“.
   Nur lesen (WF.sim.*), handeln über WF.app.runAction / WF.sim.actions. Inkrementelle Aktualisierung:
   jede Kachel/Zeile wird einmal aufgebaut und danach nur feldweise gepatcht. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;

  const TARGET_OEE = 0.75;
  const BAND_SEC = 4 * 3600;
  const WAIT = { waitTool: 1, waitOperator: 1, starved: 1, blocked: 1 };
  const SETUPISH = { setup: 1, firstPiece: 1, toolchange: 1 };
  // Bereiche in Materialfluss-Reihenfolge (Zuschnitt → Drehen/Fräsen → Sonderbearbeitung → Schleifen → Waschen → Prüfen → Montage)
  const AREA_ORDER = ['Zuschnitt', 'Dreherei', 'Fräserei', 'Sonderbearbeitung', 'Verzahnung', 'Schleiferei', 'Reinigung', 'Qualität', 'Montage'];
  // Zusammenfassung über den Kacheln: dieselben Bezeichnungen wie die Pills (UI_GUIDE Regel 19) –
  // „Keine Schicht“ (geplanter Stillstand ohne Schicht) zählt getrennt von „Bereit“ und erscheint nur, wenn es vorkommt
  const STATE_GROUPS = [
    { key: 'prod', label: 'Produktion', color: 'var(--st-run)' },
    { key: 'setup', label: 'Rüsten/Prüfen', color: 'var(--st-setup)' },
    { key: 'wait', label: 'Wartet', color: 'var(--st-wait)' },
    { key: 'fault', label: 'Störung', color: 'var(--st-fault)' },
    { key: 'idle', label: 'Bereit', color: 'var(--st-idle)' },
    { key: 'noshift', label: 'Keine Schicht', color: 'var(--st-idle)', optional: true },
  ];
  const NO_TOOL = {
    cmm: 'Prüfmittel 3D-KMG · ohne Werkzeug',
    washer: 'Reinigung · ohne Schneidwerkzeug',
    assembly: 'Handmontage · ohne Schneidwerkzeug',
  };
  // Ereignisse für „Gerade passiert“ (ohne Planungs-/Routine-Rauschen wie Einlegen-Wartezeiten)
  const FEED_TYPES = {
    fault: 'alert', repair: 'wrench', toolChanged: 'wrench', toolPlanned: 'clock', orderDone: 'check', opDone: 'check',
    setupStart: 'settings', setupDone: 'settings', fpiReady: 'target', fpiOk: 'target', fpiNok: 'target', scrap: 'x',
    correction: 'gauge', offset: 'gauge', shift: 'users', break: 'clock', extOut: 'truck', extIn: 'truck', delivery: 'box',
    reorder: 'box', priority: 'bolt', moveOp: 'route', connect: 'plug', orderAdded: 'file', bars: 'layers', barsFail: 'layers',
    state: 'dot',
  };
  const FEED_STATE_TO = { waitTool: 1, starved: 1, blocked: 1 };
  const LINKABLE = { machine: 1, order: 1, person: 1, agv: 1, tool: 1, material: 1, container: 1 };

  // ------------------------------------------------------------------ kleine Helfer
  const S = () => WF.sim && WF.sim.state;
  /** Ein Zeitformat für die ganze Ansicht: heute nur die Uhrzeit, gestern/morgen relativ (wie fmtDue in Aufträgen
      und Drawer), weiter weg mit Wochentag. */
  const tclock = (t, now) => {
    const d = Math.floor(t / 86400) - Math.floor(now / 86400);
    return d === 0 ? U.fmtClock(t) : (d === 1 || d === -1) ? U.fmtDue(t, now) : U.fmtDayClock(t);
  };
  const DAYN = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  /** Engine-Texte nennen Zeitpunkte mit Wochentag („weiter Di 06:00“). Für gestern/heute/morgen dieselbe relative
      Schreibweise wie in den übrigen Zeilen (sonst stünde „Di 06:00“ neben „morgen 06:49“ in derselben Kachel). */
  function relDays(s, now) {
    if (!s || String(s).indexOf(':') < 0) return s;
    return String(s).replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So) (\d{2}):(\d{2})\b/g, (m, d, hh, mm) => {
      const day0 = Math.floor(now / 86400), dow = ((day0 % 7) + 7) % 7;
      let delta = DAYN.indexOf(d) - dow; if (delta > 3) delta -= 7; if (delta < -3) delta += 7;
      if (Math.abs(delta) > 1) return m;
      return U.fmtDue((day0 + delta) * 86400 + Number(hh) * 3600 + Number(mm) * 60, now);
    });
  }
  /** Zustandsname und Pill – eine Benennung für Kachel, Zusammenfassung und Drawer (WF.ui.machineStateLabel, Regel 19).
      Unbekannte Engine-Zustände (z. B. künftige Messraum-Zustände) mit Engine-Label und -Farbe statt Rohschlüssel. */
  function stateLabel(mv) {
    if (!mv) return '';
    if (!WF.STATE[mv.state]) return mv.stateLabel || mv.state;
    return WF.ui.machineStateLabel ? WF.ui.machineStateLabel(mv) : WF.STATE[mv.state].label;
  }
  function statePill(mv) {
    if (!WF.STATE[mv.state]) return `<span class="pill" style="--c:${esc(mv.stateColor || 'var(--st-setup)')}"><i></i>${esc(stateLabel(mv))}</span>`;
    return WF.ui.machinePill ? WF.ui.machinePill(mv) : WF.ui.pill(mv.state);
  }
  function groupOf(mv) {
    const s = mv && mv.state;
    if (s === 'running') return 'prod';
    if (s === 'fault') return 'fault';
    if (WAIT[s]) return 'wait';
    if (s === 'idle') return stateLabel(mv) === 'Keine Schicht' ? 'noshift' : 'idle';
    return 'setup';   // Rüsten, Erstteilprüfung, Werkzeugwechsel und unbekannte Belegt-Zustände (ruhig, nicht „Wartet“)
  }
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const custShort = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+(GmbH|AG|KG|OG|GesmbH)\b\.?/g, '').trim();
  const toolShort = (n) => String(n || '').replace(/\s*\([^)]*\)/g, '').trim();
  const teile = (n) => U.fmtNum(n) + (n === 1 ? ' Teil' : ' Teile');
  const sinceText = (sec) => (sec < 60 ? 'seit gerade eben' : 'seit ' + U.fmtDur(Math.floor(sec / 60) * 60));
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node._t !== txt) { node._t = txt; node.textContent = txt; } }
  function setHTML(node, html) { if (node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setAttr(node, k, v) { const key = '_a' + k; if (node[key] !== v) { node[key] = v; if (v == null || v === false) node.removeAttribute(k); else node.setAttribute(k, v === true ? '' : v); } }
  function setVar(node, k, v) { const key = '_v' + k; if (node[key] !== v) { node[key] = v; node.style.setProperty(k, v); } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  const hasView = (id) => WF.views.some(v => v.id === id);

  // ------------------------------------------------------------------ CSS (Präfix .ls-)
  WF.ui.css(`
  .ls-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .ls-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px 18px;flex-wrap:wrap}
  .ls-head .view-sub{display:flex;flex-wrap:wrap;gap:0 6px}
  .ls-head-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
  .ls-shift{display:flex;align-items:stretch;background:var(--card);border:1px solid var(--line);border-radius:var(--r);min-width:0}
  .ls-sh{display:flex;align-items:center;gap:9px;padding:7px 13px;min-width:0}
  .ls-sh + .ls-sh{border-left:1px solid var(--line)}
  .ls-sh .eyebrow{display:block;margin-bottom:4px}
  .ls-sh b{display:block;font-weight:600;font-size:var(--fs-md);white-space:nowrap}
  .ls-sh small{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap}
  .ls-sh .ls-dot{width:8px;height:8px;border-radius:50%;background:var(--c,var(--st-run));box-shadow:0 0 0 3px color-mix(in srgb,var(--c,var(--st-run)) 22%,transparent);flex:none}

  /* Kennzahl-Leiste: eine .kpi-Anatomie (Eyebrow · Wert · 2 Zeilen · Verlauf unten), Hinweis nur über .warn/.crit */
  .ls-kpis{display:grid;gap:10px;grid-template-columns:minmax(0,1.3fr) repeat(5,minmax(0,1fr))}
  .ls-kpis .kpi.click{cursor:pointer;transition:border-color .15s ease}
  .ls-kpis .kpi.click:hover{border-color:var(--line2)}
  .ls-kpis .kpi .s{-webkit-line-clamp:1;overflow-wrap:anywhere}
  .ls-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .ls-k-spark{height:30px}
  /* Zwei Aussagezeilen (Schichten/Nacht, Geisterschicht): Unterzeile darf 2 Zeilen haben, V × L × Q entfällt */
  .ls-kpis .kpi.two .s{-webkit-line-clamp:2}
  .ls-kpis .kpi.two .ls-s2{display:none}
  .ls-kpis .kpi .s .ln{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ls-k-spark svg{display:block;width:100%;height:100%;overflow:visible}
  /* OEE Schichten gegen Nacht (wenn der Tagesverlauf die Nacht enthält): zwei Balken, gemeinsame Ziel-Marke */
  .ls-k-bars{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;align-items:center;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .ls-k-bars em{font-style:normal}
  .ls-k-bars > span{position:relative;height:5px;border-radius:3px;background:var(--track)}
  .ls-k-bars > span > i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:var(--c)}
  .ls-k-bars > span > b{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--muted)}

  .ls-main{display:grid;grid-template-columns:minmax(0,1fr) 344px;gap:14px;align-items:start}
  .ls-side{display:flex;flex-direction:column;gap:14px;min-width:0}
  .ls-machines{min-width:0}
  .ls-bar{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;margin-bottom:10px}
  .ls-sum{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
  .ls-sum button{--c:var(--st-idle);display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap;transition:border-color .15s ease,background-color .15s ease}
  .ls-sum button i{width:8px;height:8px;border-radius:50%;background:var(--c)}
  .ls-sum button b{font-variant-numeric:tabular-nums;color:var(--text)}
  .ls-sum button.zero{opacity:.5}
  .ls-sum button[hidden]{display:none}
  .ls-sum button.on{border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 14%,var(--card))}
  .ls-sum button:hover{border-color:var(--line2)}
  .ls-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(256px,1fr))}
  .ls-empty-filter{grid-column:1/-1}

  /* Maschinenkachel – Zustandsband als feine Zeitleiste innerhalb der Kachel */
  .ls-tile{--c:var(--st-idle);position:relative;display:flex;flex-direction:column;gap:7px;min-width:0;padding:11px 13px 14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;overflow:hidden;outline-offset:2px;transition:border-color .15s ease,background-color .15s ease}
  .ls-tile:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 55%,var(--card))}
  .ls-tile.sel{border-color:color-mix(in srgb,var(--accent) 70%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
  .ls-tile.sev{box-shadow:inset 3px 0 0 var(--c)}
  .ls-tile.sev.sel{box-shadow:inset 3px 0 0 var(--c),0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
  .ls-tile.crit{background:color-mix(in srgb,var(--st-fault) 7%,var(--card));border-color:color-mix(in srgb,var(--st-fault) 38%,var(--line))}
  .ls-tile.crit:hover{background:color-mix(in srgb,var(--st-fault) 10%,var(--card))}
  .ls-th{display:flex;align-items:center;gap:8px;min-width:0}
  .ls-name{display:flex;align-items:baseline;gap:7px;min-width:0;flex:1}
  .ls-name b{font:600 var(--fs-xl)/1.15 var(--f-cond);letter-spacing:.01em;white-space:nowrap;flex:none;max-width:70%;overflow:hidden;text-overflow:ellipsis}
  .ls-name .ls-id{font:500 var(--fs-xs)/1 var(--f-mono);color:var(--muted);flex:none}
  .ls-name .ls-area{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-th .conn{flex:none}
  .ls-flag{--c:var(--info);flex:none;display:inline-flex;align-items:center;gap:4px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.04em;text-transform:uppercase;padding:3px 6px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 11%,transparent);border:1px solid color-mix(in srgb,var(--c) 34%,transparent)}
  .ls-st{display:flex;align-items:center;gap:8px;min-width:0}
  .ls-st .pill{font-size:var(--fs-sm);line-height:20px;padding:2px 10px 2px 8px}
  .ls-st .pill i{position:relative;width:8px;height:8px}
  /* Aufmerksamkeit nur bei Störung/Warten – Ring über transform/opacity (Compositor), ruhige Produktion */
  .ls-tile.sev .ls-st .pill i::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--c);animation:lsRing 2s ease-out infinite;will-change:transform,opacity}
  @keyframes lsRing{0%{transform:scale(1);opacity:.6}70%,100%{transform:scale(2.7);opacity:0}}
  .ls-since{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .ls-cause{font-size:var(--fs-sm);line-height:1.38;color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .ls-tile.crit .ls-cause{color:color-mix(in srgb,var(--st-fault) 55%,var(--text))}
  .ls-tile.sev:not(.crit) .ls-cause{color:color-mix(in srgb,var(--st-wait) 40%,var(--text))}
  .ls-ordb{display:flex;flex-direction:column;gap:2px;min-width:0;border-top:1px solid var(--line);padding-top:8px;margin-top:1px}
  .ls-ord{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:var(--fs-md)}
  .ls-ord .mono{color:var(--text);font-weight:500;flex:none;font-size:var(--fs-sm)}
  .ls-ord .ls-pn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ls-risk{--c:var(--st-wait);flex:none;align-self:center;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.03em;padding:3px 6px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
  .ls-ord.none .ls-pn{font-weight:500;color:var(--muted)}
  .ls-op{font-size:var(--fs-sm);color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ls-op b{font-weight:600;color:var(--muted);font-family:var(--f-mono);font-size:var(--fs-xs);margin-right:5px}
  .ls-op em{font-style:normal;color:var(--faint)}
  .ls-prog{display:flex;flex-direction:column;gap:4px}
  .ls-prog-t{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:var(--fs-sm);font-variant-numeric:tabular-nums;white-space:nowrap;min-width:0}
  .ls-prog-t b{font-weight:600;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-prog-t b em{display:none;font-style:normal;font-weight:500;color:var(--st-wait)}
  .ls-prog-t span{color:var(--muted);flex:none}
  .ls-prog .bar{height:5px}
  .ls-prog .bar i{width:100%;transform-origin:0 50%;transform:scaleX(0);transition:transform .5s linear}
  .ls-tool{--tc:var(--muted);display:flex;flex-direction:column;gap:2px;min-width:0;padding:5px 8px;border-radius:7px;background:color-mix(in srgb,var(--tc) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--tc) 16%,transparent)}
  .ls-tool-n{display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--text2);min-width:0}
  .ls-tool-n .ico{color:var(--tc);flex:none}
  .ls-tool-n > span:not(.ls-wear){white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ls-wear{display:inline-flex;align-items:center;gap:5px;flex:none}
  .ls-wear-b{display:block;width:34px;height:4px;border-radius:2px;background:var(--track);overflow:hidden}
  .ls-wear-b i{display:block;height:100%;background:var(--tc);border-radius:inherit}
  .ls-wear b{font:500 var(--fs-2xs)/1 var(--f-mono);color:var(--muted);min-width:30px;text-align:right}
  .ls-tool-s{font-size:var(--fs-xs);font-weight:600;color:color-mix(in srgb,var(--tc) 78%,var(--text));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:19px;font-variant-numeric:tabular-nums}
  .ls-tool.u-ok .ls-tool-s,.ls-tool.u-rest .ls-tool-s{font-weight:500;color:var(--text2)}
  .ls-tool.u-faint{background:transparent;border-color:transparent;padding:0}
  .ls-tool.u-faint .ls-tool-n{color:var(--faint)}
  .ls-tool-x{display:none;font-weight:500;color:var(--muted)}
  .ls-op8{display:flex;align-items:center;gap:7px;min-width:0;font-size:var(--fs-sm)}
  .ls-op8 .avatar{width:22px;height:22px;font-size:var(--fs-2xs)}
  .ls-op8 .avatar.wait{color:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 50%,transparent)}
  .ls-op8 .avatar.auto{color:var(--st-run);border-color:color-mix(in srgb,var(--st-run) 40%,transparent)}
  .ls-op8 .avatar.none{color:var(--faint)}
  .ls-op8 span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--text2)}
  .ls-op8 span em{font-style:normal;color:var(--muted)}
  .ls-op8.wait span{color:color-mix(in srgb,var(--st-wait) 75%,var(--text))}
  .ls-more{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 5px;margin-left:2px;border-radius:11px;background:var(--raise);border:1px solid var(--line2);font:600 var(--fs-2xs)/1 var(--f-ui);color:var(--text2);flex:none}
  /* Materialfluss am Platz: Eingang › Ausgang (Behälterplätze in Materialfarbe) */
  .ls-foot{display:flex;align-items:center;gap:7px;min-width:0;margin-top:auto;padding-top:1px;font-size:var(--fs-2xs);line-height:1;color:var(--muted);white-space:nowrap;overflow:hidden}
  .ls-bg{display:inline-flex;align-items:center;gap:5px;min-width:0}
  .ls-bn{font:500 var(--fs-2xs)/1 var(--f-mono);color:var(--text2)}
  .ls-barr{color:var(--faint);font-size:var(--fs-sm)}
  .ls-slots{display:inline-flex;gap:2px}
  .ls-slots i{width:6px;height:10px;border-radius:2px;background:var(--track);border:1px solid var(--line2)}
  .ls-slots i.f{background:var(--mat);border-color:var(--mat)}
  .ls-slots.full i.f{background:var(--st-wait);border-color:var(--st-wait)}
  .ls-mini{display:inline-block;width:30px;height:6px;border-radius:2px;background:var(--track);border:1px solid var(--line2);overflow:hidden}
  .ls-mini i{display:block;height:100%;background:var(--mat)}
  .ls-mini.full i{background:var(--st-wait)}
  /* Zustandsband: innerhalb der Kachel, Fenster = letzte 4 h (ab Datenbeginn, nie leer), Achse bei Hover/Fokus */
  .ls-band{position:relative;flex:none;height:4px;margin-top:3px}
  .ls-foot[hidden] + .ls-band{margin-top:auto}
  .ls-band svg{display:block;height:4px;border-radius:2px}
  .ls-band span{position:absolute;top:6px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap;opacity:0;transition:opacity .15s ease;pointer-events:none}
  .ls-band .a0{left:0}
  .ls-band .a1{right:0}
  .ls-tile:hover .ls-band span,.ls-tile:focus-visible .ls-band span{opacity:1}
  /* Ohne Schicht geplant „Bereit“ (nicht autonome Maschinen): ruhig, ohne Warnfarben */
  .ls-tile.rest .ls-cause{color:var(--muted)}
  .ls-tile.rest .ls-ord .ls-pn{color:var(--text2)}

  /* Abschluss-Kachel: Schichtverlauf + Als Nächstes (füllt die letzte Reihe) */
  .ls-x{cursor:default;gap:8px;padding-bottom:12px}
  .ls-x:hover{border-color:var(--line);background:var(--card)}
  .ls-x-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
  .ls-x-h h3{margin:0;font:600 var(--fs-lg)/1.25 var(--f-ui);flex:none}
  .ls-x-sh{font-size:var(--fs-sm);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-x-sh b{font-weight:600;color:var(--text)}
  .ls-x-tl{display:flex;flex-direction:column;gap:5px;padding-top:2px}
  .ls-x-tr{position:relative;height:8px;border-radius:3px;background:var(--track)}
  .ls-x-tr .el{position:absolute;left:0;top:0;bottom:0;border-radius:3px 0 0 3px;background:color-mix(in srgb,var(--info) 30%,transparent)}
  .ls-x-tr .bk{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--muted) 55%,transparent) 0 2px,transparent 2px 5px)}
  .ls-x-tr .tk{position:absolute;top:-3px;bottom:-3px;width:3px;margin-left:-1.5px;border-radius:2px;background:var(--c)}
  .ls-x-tr .nw{position:absolute;top:-5px;bottom:-5px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text);box-shadow:0 0 0 2px var(--card)}
  .ls-x-ax{position:relative;height:11px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .ls-x-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .ls-x-ax span.a0{transform:none}
  .ls-x-ax span.a1{transform:translateX(-100%)}
  .ls-x-ax span.nw{color:var(--text2);font-weight:600}
  .ls-x-lh{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--line);padding-top:8px;margin-top:2px}
  /* Liste „Als Nächstes“: feste Zeilenhöhe, Höhe kommt vom Raster (height:0 + flex:1) – die Zeilenzahl wird aus der
     beim Größenwechsel gemessenen Höhe berechnet, update() liest kein Layout (keine angeschnittenen Zeilen) */
  .ls-x{--xr:24px}
  .ls-x-list{display:flex;flex-direction:column;overflow:hidden;flex:1 1 0;height:0;min-height:calc(var(--xr) * 4)}
  .ls-x-row{--c:var(--muted);display:grid;grid-template-columns:40px 16px minmax(0,1fr);gap:6px;align-items:center;font-size:var(--fs-sm);line-height:1.35;height:var(--xr);flex:none;color:var(--text2)}
  .ls-x-row[data-ent]{cursor:pointer}
  .ls-x-row[data-ent]:hover span:last-child{color:var(--text)}
  .ls-x-row .num{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap}
  .ls-x-list.wd .ls-x-row{grid-template-columns:76px 16px minmax(0,1fr)}
  .ls-x-row .ico{color:var(--c)}
  .ls-x-row span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ls-x-empty{font-size:var(--fs-sm);color:var(--muted);padding:2px 0}

  .ls-side .card-h h3{display:flex;align-items:center;gap:7px}
  .ls-side .card-h h3 .ico{color:var(--muted)}
  .ls-cnt{display:inline-grid;place-items:center;min-width:20px;height:18px;padding:0 6px;border-radius:9px;font:700 var(--fs-xs)/1 var(--f-ui);background:var(--raise);color:var(--text2)}
  .ls-cnt.crit{background:var(--st-fault);color:#1b0606}
  .ls-cnt.warn{background:var(--st-wait);color:#231703}
  .ls-now-list{display:flex;flex-direction:column}
  .ls-n{--c:var(--st-wait);position:relative;padding:11px 14px 12px 16px;border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--c)}
  .ls-n:last-child{border-bottom:0}
  .ls-n.ack{opacity:.72;box-shadow:inset 3px 0 0 color-mix(in srgb,var(--c) 45%,transparent)}
  .ls-n-top{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--muted);min-width:0;white-space:nowrap;font-variant-numeric:tabular-nums}
  .ls-n-top .sev{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:var(--fs-2xs);color:var(--c);flex:none}
  .ls-n-top > span:nth-child(2){overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-n-top .link{font-size:var(--fs-xs);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%;flex:none}
  .ls-n-t{font-weight:600;font-size:var(--fs-md);line-height:1.3;margin:5px 0 2px}
  .ls-n-b{font-size:var(--fs-sm);color:var(--text2);line-height:1.42;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .ls-n-s{margin-top:8px;font-size:var(--fs-sm);line-height:1.42;color:var(--text2);padding:7px 10px;border-radius:7px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 18%,transparent)}
  .ls-n-s b{color:var(--accent);font-weight:600}
  .ls-n-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
  .ls-n-a .btn.sm{font-size:var(--fs-xs)}
  .ls-n-st{font-size:var(--fs-xs);color:var(--muted);align-self:center}
  .ls-now-ok{display:flex;gap:10px;align-items:flex-start;padding:14px;font-size:var(--fs-sm);color:var(--text2)}
  .ls-now-ok .ico{color:var(--st-run);flex:none;margin-top:1px}
  .ls-now-more{display:block;width:100%;padding:10px 14px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--accent);font-size:var(--fs-sm);font-weight:600;cursor:pointer;text-align:left}

  /* KI-Schichtbriefing: 3–5 Punkte mit Kategorie, je eine Kernaussage + eine leise Zeile; nichts aus den Karten darüber */
  .ls-brief .card-h{cursor:pointer;user-select:none}
  .ls-brief .card-h:hover h3{color:var(--text)}
  .ls-brief.closed .card-h{border-bottom-color:transparent}
  .ls-brief.closed [data-r="briefBody"]{display:none}
  .ls-brief .card-b{display:flex;flex-direction:column;gap:2px;padding-top:6px;padding-bottom:10px}
  .ls-bl{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
  .ls-bl li{--c:var(--info);display:flex;flex-direction:column;gap:4px;padding:9px 0 10px;border-bottom:1px solid var(--line)}
  .ls-bl li:last-child{border-bottom:0}
  .ls-bl li.click{cursor:pointer}
  .ls-bl li.click:hover .ls-bl-m b{color:var(--accent)}
  .ls-bl-k{display:flex;align-items:center;gap:6px;font:600 var(--fs-2xs)/1.25 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
  .ls-bl-k::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c);flex:none;transform:translateY(-.5px)}
  .ls-bl-m{min-width:0;display:flex;flex-direction:column;gap:2px;padding-left:12px}
  .ls-bl-m b{font-weight:600;font-size:var(--fs-sm);line-height:1.38;color:var(--text)}
  .ls-bl-m span{font-size:var(--fs-xs);line-height:1.4;color:var(--muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  /* Bezüge wie im Copilot: schlichte Links (Mono, gepunktet unterstrichen) */
  .ls-bl .link{font-family:var(--f-mono);font-size:.94em;font-weight:500;color:inherit;text-decoration:underline dotted;text-decoration-color:color-mix(in srgb,var(--accent) 70%,transparent);text-underline-offset:3px}
  .ls-bl .link:hover{color:var(--accent);text-decoration-style:solid}
  .ls-brief-f{display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);color:var(--faint);flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--line)}
  .ls-brief-f .spacer{flex:1}
  .ls-brief-n{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
  .ls-mode{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:3px 6px;border-radius:5px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent)}
  .ls-ibtn{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}
  .ls-ibtn:hover{color:var(--text);border-color:var(--line2)}
  .ls-brief [data-r="briefToggle"] .ico{transition:transform .2s ease;transform:rotate(90deg)}
  .ls-brief.closed [data-r="briefToggle"] .ico{transform:none}
  .ls-feed-list.wd .ls-ev{grid-template-columns:76px 22px minmax(0,1fr)}

  .ls-feed-list{display:flex;flex-direction:column;padding:4px 0}
  .ls-ev{--c:var(--muted);display:grid;grid-template-columns:40px 22px minmax(0,1fr);gap:6px;align-items:start;padding:6px 14px;font-size:var(--fs-sm);line-height:1.38;border:0;background:transparent;color:inherit;text-align:left;width:100%}
  .ls-ev.link-ev{cursor:pointer}
  .ls-ev.link-ev:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .ls-ev .num{color:var(--muted);font-size:var(--fs-xs);padding-top:1px}
  .ls-ev .ls-ev-i{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
  .ls-ev .ls-ev-m{color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .ls-ev.new{animation:lsIn .6s ease}
  @keyframes lsIn{from{background:color-mix(in srgb,var(--accent) 14%,transparent)}to{background:transparent}}

  .ls-jump{display:none}

  /* Kompakte KPI-Leiste: kleine Laptops, Beamer (1280×720), niedrige Fenster – eine Zeile Erläuterung */
  @media (max-width:1320px),(max-height:820px){
    .ls-kpis .kpi{padding:10px 12px 10px;min-height:0}
    .ls-kpis .kpi .v{font-size:var(--fs-2xl)}
    .ls-kpis .ls-s2{display:none}
    .ls-k-spark{height:24px}
    .ls-head .view-sub{margin-top:2px}
  }
  @media (max-width:1100px){
    .ls-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
    .ls-main{display:flex;flex-direction:column}
    .ls-side{display:contents}
    .ls-now{order:1}.ls-machines{order:2}.ls-brief{order:3}.ls-feed{order:4}
    .ls-main > *, .ls-side > *{width:100%}
  }
  @media (max-width:640px){
    .ls-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .ls-kpis .ls-k-oee{grid-column:1/-1}
    .ls-kpis .kpi:last-child{grid-column:1/-1}
    .ls-sum{flex:1 1 100%}
    .ls-bar .seg{width:100%}
    .ls-bar .seg button{flex:1}
    .ls-head-r{width:100%}
    .ls-shift{width:100%}
    .ls-tvbtn{display:none}
    .ls-grid{grid-template-columns:minmax(0,1fr)}
    .ls-x-list{height:auto;flex:none;min-height:0}
  }
  /* Telefon: KPI- und Schicht-Leiste zum Wischen, Maschinen als kompakte Statuszeilen, Sprungleiste */
  @media (max-width:560px){
    .ls-root{gap:12px}
    .ls-shift{display:flex;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x proximity}
    .ls-shift::-webkit-scrollbar,.ls-kpis::-webkit-scrollbar,.ls-jump::-webkit-scrollbar{display:none}
    .ls-sh{flex:none;scroll-snap-align:start}
    .ls-kpis{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;gap:8px;margin:0 -18px;padding:0 18px;scroll-padding:0 18px}
    .ls-kpis .kpi{flex:0 0 72%;scroll-snap-align:start;padding:10px 12px}
    .ls-kpis .ls-k-oee{flex-basis:84%}
    .ls-jump{display:flex;gap:6px;position:sticky;top:-18px;z-index:6;margin:-4px -18px -2px;padding:8px 18px;background:var(--bg);border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
    .ls-jump button{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font-size:var(--fs-sm);font-weight:600;cursor:pointer}
    .ls-jump button b{display:inline-grid;place-items:center;min-width:18px;height:17px;padding:0 5px;border-radius:9px;font:700 var(--fs-2xs)/1 var(--f-ui);background:var(--raise);color:var(--text2)}
    .ls-jump button b.warn{background:var(--st-wait);color:#231703}
    .ls-jump button b.crit{background:var(--st-fault);color:#1b0606}
    .ls-now,.ls-machines,.ls-brief,.ls-feed{scroll-margin-top:62px}
    .ls-sum{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -18px;padding:0 18px}
    .ls-sum::-webkit-scrollbar{display:none}
    .ls-sum button{flex:none}
    .ls-grid{gap:8px}
    .ls-tile{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"th st" "cause cause" "ord ord" "prog prog" "band band";gap:4px 10px;padding:10px 12px 12px}
    .ls-tile:not(.has-cause){grid-template-areas:"th st" "ord ord" "prog prog" "band band"}
    .ls-tile .ls-prog-t b em{display:inline}
    .ls-tile .ls-th{grid-area:th}
    .ls-tile .ls-st{grid-area:st}
    .ls-tile .ls-cause{grid-area:cause;-webkit-line-clamp:1}
    .ls-tile .ls-ordb{grid-area:ord;border-top:0;padding-top:0;margin-top:0}
    .ls-tile .ls-prog{grid-area:prog;flex-direction:row;align-items:center;gap:8px}
    .ls-tile .ls-prog-t{display:contents}
    .ls-tile .ls-prog-t b{order:0;flex:0 1 auto}
    .ls-tile .ls-prog-t span{order:2;font-size:var(--fs-xs)}
    .ls-tile .ls-prog .bar{order:1;flex:1 1 40px;min-width:30px}
    .ls-tile .ls-band{grid-area:band;margin-top:5px}
    .ls-tile .ls-band span{display:none}
    .ls-tile .ls-op,.ls-tile .ls-tool,.ls-tile .ls-op8,.ls-tile .ls-foot,.ls-tile .ls-since,.ls-name .ls-area,.ls-th .conn{display:none !important}
    .ls-tile .ls-st .pill{font-size:var(--fs-xs);line-height:18px;padding:1px 9px 1px 7px}
    .ls-tile .ls-prog .bar{height:4px}
    .ls-tile.ls-x{display:flex;padding-bottom:12px}
  }
  /* Touch: Bedienflächen mindestens 40 px */
  @media (pointer:coarse){
    .ls-sum button{height:40px;padding:0 14px}
    .ls-jump button{height:40px}
    .ls-n-a .btn.sm{height:auto;min-height:40px;padding:0 14px}
    .ls-ibtn{width:40px;height:40px}
    .ls-now-more{min-height:44px}
    .ls-brief-f .link,.ls-n-top .link{padding:10px 0;margin:-10px 0}
  }

  /* TV-Modus (Hallen-Wandtafel 1080p, 3–5 m Betrachtungsabstand): keine Bedienelemente, große Schrift, 5 Spalten */
  .ls-tvinfo{display:none}
  .view.ls-tvview{padding-top:14px;padding-bottom:16px}
  .ls-root.ls-tv .ls-tvhide,.ls-root.ls-tv .ls-head,.ls-root.ls-tv .ls-brief,.ls-root.ls-tv .ls-feed,.ls-root.ls-tv .ls-jump,.ls-root.ls-tv .ls-n-a{display:none !important}
  .ls-root.ls-tv{gap:12px}
  .ls-root.ls-tv .ls-tvinfo{display:block;margin-left:auto;font-size:16px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-root.ls-tv .ls-tvinfo b{color:var(--text2);font-weight:600}
  .ls-root.ls-tv .ls-bar{flex-wrap:nowrap}
  .ls-root.ls-tv .ls-sum{flex:0 1 auto;flex-wrap:nowrap}
  .ls-root.ls-tv .ls-sum button{height:36px;font-size:16px;cursor:default;padding:0 13px}
  .ls-root.ls-tv .ls-sum button i{width:10px;height:10px}
  .ls-root.ls-tv .ls-kpis .kpi{padding:12px 16px 12px;min-height:0}
  .ls-root.ls-tv .ls-kpis .kpi .l{font-size:14px;letter-spacing:.08em}
  .ls-root.ls-tv .ls-kpis .kpi .v{font-size:44px;line-height:1.05;margin-top:6px}
  .ls-root.ls-tv .ls-kpis .kpi .v small{font-size:20px}
  .ls-root.ls-tv .ls-kpis .kpi .s{font-size:14px;margin-top:4px}
  .ls-root.ls-tv .ls-kpis .ls-s2{display:none}
  .ls-root.ls-tv .ls-k-spark{height:28px}
  .ls-root.ls-tv .ls-main{grid-template-columns:minmax(0,1fr) 400px}
  .ls-root.ls-tv .ls-grid{grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
  .ls-root.ls-tv .ls-tile{gap:5px;padding:12px 15px 12px}
  /* TV: Werkzeugzeile nur, wenn die Maschine produziert (sonst sagt die Ursache, was los ist) – Platz für 2 Zeilen Ursache */
  .ls-root.ls-tv .ls-tile.has-cause:not([data-state="running"]) .ls-tool,.ls-root.ls-tv .ls-tile.rest .ls-tool{display:none}
  .ls-root.ls-tv .ls-band{height:6px;margin-top:auto}
  .ls-root.ls-tv .ls-band svg{height:6px;border-radius:3px}
  .ls-root.ls-tv .ls-band span{display:none}
  .ls-root.ls-tv .ls-name b{font-size:28px;line-height:1.1}
  .ls-root.ls-tv .ls-name .ls-id{font-size:16px}
  .ls-root.ls-tv .ls-name .ls-area,.ls-root.ls-tv .ls-th .conn,.ls-root.ls-tv .ls-op,.ls-root.ls-tv .ls-tool-n,.ls-root.ls-tv .ls-foot{display:none}
  .ls-root.ls-tv .ls-flag{font-size:14px;padding:4px 8px}
  .ls-root.ls-tv .ls-tile.flag .ls-id{display:none}
  .ls-root.ls-tv .ls-name b{max-width:100%}
  .ls-root.ls-tv .ls-st .pill{font-size:16px;line-height:26px;padding:2px 13px 2px 11px}
  .ls-root.ls-tv .ls-st .pill i{width:10px;height:10px}
  .ls-root.ls-tv .ls-since{font-size:14px}
  .ls-root.ls-tv .ls-cause{font-size:14px;line-height:1.3;flex:none}
  .ls-root.ls-tv .ls-tile.has-cause .ls-op8{display:none}
  .ls-root.ls-tv .ls-ordb{padding-top:7px}
  .ls-root.ls-tv .ls-ord{font-size:18px}
  .ls-root.ls-tv .ls-ord .mono{font-size:16px}
  .ls-root.ls-tv .ls-risk{font-size:14px;padding:4px 7px}
  .ls-root.ls-tv .ls-prog-t{font-size:14px}
  .ls-root.ls-tv .ls-prog-t b{font-size:20px}
  .ls-root.ls-tv .ls-prog .bar{height:7px}
  .ls-root.ls-tv .ls-tool{padding:5px 9px}
  .ls-root.ls-tv .ls-tool-s{padding-left:0;font-size:14px}
  .ls-root.ls-tv .ls-tool-x{display:inline}
  .ls-root.ls-tv .ls-op8{font-size:14px}
  .ls-root.ls-tv .ls-op8 .avatar{width:30px;height:30px;font-size:14px}
  .ls-root.ls-tv .ls-more{height:24px;min-width:28px;font-size:14px;border-radius:12px}
  .ls-root.ls-tv .ls-x-h h3{font-size:18px}
  .ls-root.ls-tv .ls-x-sh{font-size:14px}
  .ls-root.ls-tv .ls-x-tr{height:10px}
  .ls-root.ls-tv .ls-x .eyebrow{font-size:14px}
  .ls-root.ls-tv .ls-x-ax{font-size:14px;height:15px}
  .ls-root.ls-tv .ls-x{--xr:30px}
  .ls-root.ls-tv .ls-x-row{font-size:15px;grid-template-columns:50px 18px minmax(0,1fr)}
  .ls-root.ls-tv .ls-x-row .num{font-size:14px}
  .ls-root.ls-tv .ls-x-list.wd .ls-x-row{grid-template-columns:100px 18px minmax(0,1fr)}
  /* „Jetzt wichtig“ in 16 px – nimmt im TV-Modus die ganze rechte Spalte ein */
  .ls-root.ls-tv .ls-now .card-h{padding:13px 16px}
  .ls-root.ls-tv .ls-now .card-h h3{font-size:19px}
  .ls-root.ls-tv .ls-cnt{min-width:26px;height:24px;font-size:14px;border-radius:12px}
  .ls-root.ls-tv .ls-n{padding:13px 16px 14px 18px}
  .ls-root.ls-tv .ls-n-top{font-size:14px}
  .ls-root.ls-tv .ls-n-top .sev{font-size:14px}
  .ls-root.ls-tv .ls-n-top .link{font-size:14px}
  .ls-root.ls-tv .ls-n-t{font-size:18px;line-height:1.28}
  .ls-root.ls-tv .ls-n-b{font-size:16px;line-height:1.4}
  .ls-root.ls-tv .ls-n-s{font-size:16px;line-height:1.4;padding:8px 11px}
  .ls-root.ls-tv .ls-now-ok{font-size:16px}
  .ls-root.ls-tv .ls-now-more{pointer-events:none;color:var(--muted);font-size:14px}
  @media (max-width:1100px){
    .ls-root.ls-tv .ls-bar{flex-wrap:wrap}
    .ls-root.ls-tv .ls-sum{flex:1 1 auto;flex-wrap:wrap}
    .ls-root.ls-tv .ls-tvinfo{flex:1 1 100%;margin-left:0;white-space:normal}
  }
  /* 1080p und größer: Raster füllt genau die Höhe (3 Reihen à 5), Statuszeile unten neben „TV-Modus beenden“ */
  @media (min-width:1660px) and (min-height:940px){
    .ls-root.ls-tv{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr)}
    .ls-root.ls-tv .ls-main{min-height:0;align-items:stretch}
    .ls-root.ls-tv .ls-machines{display:flex;flex-direction:column;min-height:0}
    .ls-root.ls-tv .ls-bar{order:2;margin:10px 0 0;min-height:36px}
    .ls-root.ls-tv .ls-grid{flex:1;min-height:0;grid-template-columns:repeat(5,minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}
    .ls-root.ls-tv .ls-side{min-height:0}
    .ls-root.ls-tv .ls-now{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
    .ls-root.ls-tv .ls-now-list{flex:1;min-height:0;overflow:hidden}
  }
  `, 'ls-css');

  // ------------------------------------------------------------------ Modulzustand
  let root = null, R = {}, tv = false;
  let sortMode = 'flow', filter = null;
  const tiles = {};          // machineId -> {el, r, vm}
  let order = [];            // Reihenfolge der Kacheln (Materialfluss)
  let selected = null;
  let lastMVs = {};
  let nowNodes = new Map(), nowExpanded = false;
  let feedNodes = new Map(), feedLastId = null, feedDay = -1;
  let brief = { k: -1, nowSig: '', items: null };
  let nowListSig = '';
  let kpiCache = { t: -1, risk: null };
  let bnCache = { t: -1, id: null, text: '' };
  let X = null;              // Abschluss-Kachel {el, r}
  let lastNextSig = null, lastTlSig = null, gridCols = 0;   // null = neu zeichnen erzwingen
  let gridW = 0, xListH = 0, xCap = 7;                      // gemessen im ResizeObserver (nie in update())
  let nowClipDirty = true, nowClipSig = '', nowClipped = 0;
  const TV_FIT = '(min-width:1660px) and (min-height:940px)';
  const mq = (q) => { try { return window.matchMedia(q); } catch (e) { return { matches: false }; } };
  const MQ_PHONE = mq('(max-width:640px)'), MQ_TVFIT = mq(TV_FIT);
  const BRIEF_KEY = 'werkfluss.leitstand.briefOpen';
  let briefOpen = true;
  try { const v = localStorage.getItem(BRIEF_KEY); if (v === '0') briefOpen = false; } catch (e) { /* ohne Speicher: offen */ }

  function flowOrder() {
    const P = WF.profile;
    return P.machines.slice().sort((a, b) => {
      const sa = P.stationById[a], sb = P.stationById[b];
      const ia = AREA_ORDER.indexOf(sa.area), ib = AREA_ORDER.indexOf(sb.area);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || P.machines.indexOf(a) - P.machines.indexOf(b);
    });
  }

  // ------------------------------------------------------------------ Aufbau
  function mount(el) {
    root = el;
    const c = WF.app.company();
    el.innerHTML = `
    <div class="ls-root">
      <div class="ls-head">
        <div>
          <h1 class="view-t">Leitstand</h1>
          <p class="view-sub"><span data-r="company">${esc(c.name)}</span><span class="faint">·</span><span data-r="site">${esc(c.site)}</span></p>
        </div>
        <div class="ls-head-r">
          <div class="ls-shift" data-r="shift">
            <div class="ls-sh"><span class="ls-dot" data-r="shDot"></span><div><span class="eyebrow" data-r="shEy">Schicht</span><b data-r="shName">–</b><small data-r="shSub">–</small></div></div>
            <div class="ls-sh" data-r="leadBox"><span class="avatar" data-r="leadAv">–</span><div><span class="eyebrow" data-r="leadEy">Schichtleitung</span><b data-r="leadName">–</b><small data-r="leadSub"></small></div></div>
            <div class="ls-sh"><div><span class="eyebrow">Personal</span><b data-r="staff">–</b><small data-r="staffSub">–</small></div></div>
          </div>
          <button class="btn ls-tvbtn ls-tvhide" data-r="tvBtn" title="Leitstand als Hallen-Wandtafel anzeigen (Esc beendet)">${icon('tv', 16)}TV-Modus</button>
        </div>
      </div>

      <div class="ls-kpis" data-r="kpis">
        <div class="kpi ls-k-oee" data-r="kOee" title="Gesamtanlageneffektivität der Bearbeitungsmaschinen seit 00:00">
          <div class="l" data-r="kOeeL">OEE heute</div>
          <div class="v" data-r="kOeeV">–</div>
          <div class="s" data-r="kOeeS1">–</div>
          <div class="s ls-s2" data-r="kOeeS2">–</div>
          <div class="viz ls-k-spark" data-r="kOeeSpark"></div>
        </div>
        <div class="kpi click" data-r="kGood" data-nav="auftraege" title="Gutteile, die heute den letzten Bearbeitungsschritt ihres Auftrags abgeschlossen haben">
          <div class="l">Fertige Teile heute</div><div class="v" data-r="kGoodV">–</div><div class="s" data-r="kGoodS">–</div><div class="s ls-s2" data-r="kGoodS2">–</div>
        </div>
        <div class="kpi click" data-r="kOt" data-nav="auftraege" title="Anteil der Aufträge, die laut Prognose (bzw. tatsächlich) termingerecht und vollständig geliefert werden">
          <div class="l">Termintreue</div><div class="v" data-r="kOtV">–</div><div class="s" data-r="kOtS">–</div><div class="s ls-s2" data-r="kOtS2">–</div>
        </div>
        <div class="kpi click ls-k-loss" data-r="kLoss" title="Maschinenstundensatz × Zeit in der Schicht, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Rüsten, Warten, Störung)">
          <div class="l">Stillstandskosten</div><div class="v" data-r="kLossV">–</div><div class="s" data-r="kLossS">–</div><div class="s ls-s2" data-r="kLossS2">–</div>
        </div>
        <div class="kpi" data-r="kEn" title="Elektrische Leistung der Halle (Maschinen, AGVs, Grundlast) – gemessen bzw. aus Zustand geschätzt">
          <div class="l">Energie</div>
          <div class="v" data-r="kEnV">–</div>
          <div class="s" data-r="kEnS">–</div>
          <div class="viz ls-k-spark" data-r="kEnSpark"></div>
        </div>
        <div class="kpi click" data-r="kMsg" title="Offene Warnungen und Störungen">
          <div class="l">Offene Meldungen</div><div class="v" data-r="kMsgV">–</div><div class="s" data-r="kMsgS">–</div><div class="s ls-s2" data-r="kMsgS2">–</div>
        </div>
      </div>

      <nav class="ls-jump" data-r="jump" aria-label="Abschnitte des Leitstands">
        <button data-jump="nowCard">Jetzt wichtig <b data-r="jNow">0</b></button>
        <button data-jump="machines">Arbeitsplätze <b data-r="jMach">0</b></button>
        <button data-jump="briefCard">Briefing</button>
        <button data-jump="feedCard">Gerade passiert</button>
      </nav>

      <div class="ls-main">
        <section class="ls-machines" data-r="machines" aria-label="Arbeitsplätze">
          <div class="ls-bar">
            <div class="ls-sum" data-r="sum" role="group" aria-label="Nach Zustand filtern"></div>
            <div class="seg ls-tvhide" role="group" aria-label="Reihenfolge" data-r="sortSeg">
              <button data-sort="flow" class="on" title="Reihenfolge des Materialflusses durch die Halle">Materialfluss</button>
              <button data-sort="urgent" title="Störung › Wartet › Werkzeugwechsel/Erstteil in 15 min › später oder knapper Auftrag › frei mit Arbeit › Produktion › frei ohne Arbeit">Handlungsbedarf</button>
            </div>
            <span class="ls-tvinfo" data-r="tvInfo"></span>
          </div>
          <div class="ls-grid" data-r="grid"></div>
        </section>
        <div class="ls-side">
          <section class="card ls-now" data-r="nowCard" aria-label="Jetzt wichtig">
            <div class="card-h"><h3>${icon('alert', 16)}Jetzt wichtig</h3><span class="ls-cnt" data-r="nowCnt">0</span></div>
            <div class="ls-now-list" data-r="nowList"></div>
            <button class="ls-now-more" data-r="nowMore" hidden></button>
          </section>
          <section class="card ls-brief" data-r="briefCard" aria-label="KI-Schichtbriefing">
            <div class="card-h" data-r="briefHead"><h3>${icon('sparkles', 16)}KI-Schichtbriefing</h3>
              <div class="row" style="gap:8px"><span class="ls-brief-n" data-r="briefN"></span><span class="ls-mode" data-r="briefMode" title="Aus den Live-Daten der Halle nach festen Regeln zusammengestellt – laufend aktuell">Live</span><button class="ls-ibtn ls-tvhide" data-r="briefToggle" aria-expanded="true" aria-controls="ls-brief-body" title="Briefing ein-/ausklappen" aria-label="Briefing ein- oder ausklappen">${icon('chevron', 15)}</button></div></div>
            <div class="card-b" id="ls-brief-body" data-r="briefBody"><div class="muted">Briefing wird erstellt …</div></div>
          </section>
          <section class="card ls-feed" data-r="feedCard" aria-label="Gerade passiert">
            <div class="card-h"><h3>${icon('clock', 16)}Gerade passiert</h3><span class="muted" data-r="feedSub">letzte 12 Ereignisse</span></div>
            <div class="ls-feed-list" data-r="feed"></div>
          </section>
        </div>
      </div>
    </div>`;
    R = refs(el);

    // Kacheln einmalig aufbauen
    order = flowOrder();
    for (const id of order) {
      const t = buildTile(id);
      tiles[id] = t;
      R.grid.append(t.el);
    }
    X = buildX();
    R.grid.append(X.el);
    buildSummary();

    // Ereignisse
    R.tvBtn.onclick = () => WF.app.setTv(true);
    R.sortSeg.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
      sortMode = b.dataset.sort;
      R.sortSeg.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
      applyOrder(true);
    });
    R.kGood.onclick = R.kOt.onclick = () => { if (!tv && hasView('auftraege')) WF.app.navigate('auftraege'); };
    R.kLoss.onclick = () => { if (tv) return; const L = lossModel(WF.sim.kpis()), top = L.top || topLoss(); if (top) WF.app.select('machine', top.id); };
    R.kMsg.onclick = () => { if (!tv) R.nowCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    R.jump.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]'); if (!b || !R[b.dataset.jump]) return;
      R[b.dataset.jump].scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Briefing ein-/ausklappen (Kopfzeile oder Pfeil) – je Betrachter gemerkt
    R.briefHead.addEventListener('click', (e) => { if (e.target.closest('a,.link')) return; setBriefOpen(!briefOpen, true); });
    setBriefOpen(briefOpen, false);
    R.nowMore.onclick = () => { if (tv) return; nowExpanded = !nowExpanded; renderNow(true); };
    R.feed.addEventListener('click', (e) => {
      const row = e.target.closest('[data-ent]'); if (!row) return;
      const [k, i] = row.dataset.ent.split('|'); WF.app.select(k, i);
    });
    R.briefBody.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ent]'); if (!a) return;
      const [k, i] = a.dataset.ent.split('|'); WF.app.select(k, i);
    });
    // Größen nur beim Größenwechsel messen (ResizeObserver, nach dem Layout): Rasterbreite → Spaltenzahl der
    // Abschluss-Kachel, Listenhöhe → Zeilenzahl „Als Nächstes“, Höhe „Jetzt wichtig“ (TV). update() liest kein Layout.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver((entries) => {
        for (const en of entries) {
          if (en.target === R.grid) { gridW = en.contentRect.width; fitX(); }
          else if (en.target === X.r.xList) { xListH = en.contentRect.height; fitXRows(); }
          else if (en.target === R.nowList) nowClipDirty = true;
        }
      });
      ro.observe(R.grid); ro.observe(X.r.xList); ro.observe(R.nowList);
    }

    WF.bus.on('select', (s) => { selected = s && s.kind === 'machine' ? s.id : null; for (const id in tiles) tiles[id].el.classList.toggle('sel', id === selected); });
    WF.bus.on('settings', () => {
      const cc = WF.app.company(); setText(R.company, cc.name); setText(R.site, cc.site);
      setTvClass();
    });
    WF.bus.on('sim:reset', () => {
      lastMVs = {}; kpiCache = { t: -1, risk: null }; bnCache = { t: -1, id: null, text: '' }; brief = { k: -1, nowSig: '', items: null }; ghostPrev = { k: -1, real: 0, v: null };
      feedLastId = null; for (const n of feedNodes.values()) n.remove(); feedNodes.clear();
      for (const n of nowNodes.values()) n.remove(); nowNodes.clear(); lastNextSig = null; lastTlSig = null;
      for (const id in tiles) { tiles[id].vm = {}; }
    });
    setTvClass();
  }

  function setTvClass() {
    const appEl = document.getElementById('app');
    const on = !!(WF.app.tv || (appEl && appEl.classList.contains('tv')));
    const changed = on !== tv;
    tv = on;
    if (!root) return;
    root.firstElementChild.classList.toggle('ls-tv', tv);
    root.classList.toggle('ls-tvview', tv);
    if (changed) {
      if (tv && filter) { filter = null; R.sum.querySelectorAll('[data-g]').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); applyOrder(true); }
      lastNextSig = null; lastTlSig = null; nowClipDirty = true;
      if (tv) root.scrollTop = 0;
      fitX(); fitXRows();
      if (WF.sim && S()) renderNow(true);
    }
  }

  // ------------------------------------------------------------------ Kachel
  function buildTile(id) {
    const st = WF.profile.stationById[id];
    const el = document.createElement('article');
    el.className = 'ls-tile';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.dataset.id = id;
    el.innerHTML = `
      <div class="ls-th">
        <div class="ls-name"><b>${esc(st.short)}</b><span class="ls-id">${esc(id)}</span><span class="ls-area">${esc(st.area)}</span></div>
        <span class="ls-flag" data-r="flag" hidden>${icon('gauge', 11)}Engpass</span>
        <span class="conn" data-r="conn"></span>
      </div>
      <div class="ls-st"><span data-r="pill"></span><span class="ls-since" data-r="since"></span></div>
      <div class="ls-cause" data-r="cause"></div>
      <div class="ls-ordb">
        <div class="ls-ord" data-r="ord"><span class="mono" data-r="oid"></span><span class="ls-pn" data-r="pn"></span><span class="ls-risk" data-r="risk" hidden></span></div>
        <div class="ls-op" data-r="op"></div>
      </div>
      <div class="ls-prog" data-r="prog"><div class="ls-prog-t"><b data-r="progL"></b><span data-r="progR"></span></div><span class="bar" data-r="bar" style="--c:var(--st-run)"><i data-r="barI"></i></span></div>
      <div class="ls-tool" data-r="tool">
        <div class="ls-tool-n">${icon('wrench', 13)}<span data-r="toolN"></span><span class="ls-wear" data-r="wear" hidden><span class="ls-wear-b"><i data-r="wearI"></i></span><b data-r="wearT"></b></span></div>
        <div class="ls-tool-s"><span data-r="toolS"></span><span class="ls-tool-x" data-r="toolX"></span></div>
      </div>
      <div class="ls-op8" data-r="opr"><span class="avatar" data-r="av"></span><span data-r="oprT"></span><span class="ls-more" data-r="more" hidden></span></div>
      <div class="ls-foot" data-r="buf"></div>
      <div class="ls-band" data-r="band"><div data-r="bandB"></div><span class="a0" data-r="bandA0"></span><span class="a1">jetzt</span></div>`;
    const r = refs(el);
    const open = () => WF.app.select('machine', id);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return { el, r, vm: {}, id };
  }

  /** Kritischstes Werkzeug des laufenden Arbeitsgangs: gebrochen > Standzeit erschöpft > wird gewechselt > Wechsel geplant > ok (geringste Restteile) */
  function toolLine(mv, now) {
    if (!mv.order) return null;
    const ts = mv.tools.filter(t => t.status !== 'idle');
    const all = ts.map(x => `${x.name}: ${x.wearPct != null ? U.fmtNum(x.wearPct, 0) + ' % Verschleiß, ' : ''}${x.remainingParts != null ? 'noch ' + teile(x.remainingParts) : ''} (${WF.sim.label('toolStatus', x.status)})`).join('\n');
    if (!ts.length) return { name: NO_TOOL[mv.type] || 'Kein Schneidwerkzeug', status: '', u: 'faint', c: 'var(--faint)', wear: null, title: '' };
    if (ts.some(t => t.status === 'replace' || t.status === 'keep' || t.status === 'setup' || t.status === 'missing')) {
      const n = ts.filter(t => t.status !== 'keep').length;
      const kept = ts.length - n;
      return { name: ts.length === 1 ? toolShort(ts[0].name) : `${ts.length} Werkzeuge`, u: 'setup', c: 'var(--st-setup)', wear: null, title: all,
        status: (mv.state === 'setup' ? (n === 1 ? 'wird gerade neu bestückt' : `${n} werden gerade neu bestückt`) : (n === 1 && ts.length === 1 ? 'wird beim Rüsten neu bestückt' : `${n} neu beim Rüsten`)) + (kept ? `, ${kept} ${kept === 1 ? 'bleibt' : 'bleiben'}` : '') };
    }
    const rank = { broken: 0, due: 1, changing: 2, planned: 3, ok: 4 };
    const t = ts.slice().sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || (a.remainingParts ?? 1e9) - (b.remainingParts ?? 1e9))[0];
    const pc = t.plannedChange;
    const when = pc ? (pc.etaT != null ? 'ca. ' + tclock(pc.etaT, now) : 'nach Teil ' + pc.afterPart) : '';
    const base = { name: toolShort(t.name), wear: t.wearPct, title: all + '\n\n' + t.explain };
    // Wendeschneidplatte: Bediener wendet die Schneide an der Maschine (kein Werkzeugwechsel durch den Einrichter)
    const verb = (pc && pc.action === 'index') || (!pc && t.nextAction === 'index') ? 'Wenden' : 'Wechsel';
    switch (t.status) {
      case 'broken': return Object.assign(base, { status: 'gebrochen – Wechsel nötig', u: 'crit', c: 'var(--st-fault)' });
      case 'due': return Object.assign(base, { status: `Standzeit erschöpft · ${pc && pc.by ? pc.by + ' ' + (pc.stage || 'kommt') : pc && pc.etaT != null ? verb + ' ' + when : verb + ' angefordert'}`, u: 'warn', c: 'var(--st-wait)' });
      case 'changing': return Object.assign(base, { status: 'wird gerade gewechselt', u: 'tool', c: 'var(--st-tool)' });
      case 'planned': {
        const stop = pc && pc.waitFromT != null;
        return Object.assign(base, { status: `noch ${teile(t.remainingParts)} · ${pc && pc.manual && verb === 'Wechsel' ? 'vorbeugender ' : ''}${verb} ${when}${stop ? ' · Stopp ab ' + tclock(pc.waitFromT, now) : ''}`, u: stop ? 'warn' : 'tool', c: stop ? 'var(--st-wait)' : 'var(--st-tool)' });
      }
      default: {
        const enough = ts.every(x => x.remainingParts == null || x.neededParts == null || x.remainingParts >= x.neededParts);
        return Object.assign(base, { status: `noch ${teile(t.remainingParts)}${enough ? ' · reicht bis AG-Ende' : ''}`, u: 'ok', c: 'var(--st-run)' });
      }
    }
  }

  function operatorLine(mv) {
    const op = mv.operator, others = mv.people.filter(p => !op || p.id !== op.id);
    const more = others.length ? { n: others.length, title: others.map(p => `${p.name}: ${p.taskLabel || p.activity}${p.where ? ' (' + p.where + ')' : ''}`).join('\n') } : null;
    if (mv.state === 'waitOperator') {
      return { cls: 'wait', av: op ? WF.ui.initials(op.name) : '?', avCls: 'wait', html: `Wartet auf Bediener${op ? ` <em>· ${esc(shortName(op.name))} ${esc(op.where || '')}</em>` : ''}`, title: mv.cause, more, pid: op && op.id };
    }
    if (op && !op.responsible) {
      return { cls: '', av: WF.ui.initials(op.name), avCls: '', html: `${esc(shortName(op.name))} <em>· ${esc(op.taskLabel ? op.taskLabel.split(' ')[0] : op.stateLabel)}</em>`, title: `${op.name} (${op.role}): ${op.activity}`, more, pid: op.id };
    }
    if (mv.loading === 'auto' && (mv.state === 'running' || mv.state === 'blocked' || mv.state === 'starved')) {
      return { cls: '', av: 'A', avCls: 'auto', html: `Läuft autonom${op ? ` <em>· ${esc(shortName(op.name))}</em>` : ' <em>· ohne Personal</em>'}`, title: op ? `${op.name} (${op.role}) ist zuständig – ${op.activity}` : 'Autonomer Betrieb ohne Personal (Geisterschicht)', more, pid: op && op.id };
    }
    if (op) return { cls: '', av: WF.ui.initials(op.name), avCls: '', html: `${esc(shortName(op.name))} <em>(zuständig)</em>`, title: `${op.name} (${op.role}): ${op.activity}`, more, pid: op.id };
    return { cls: '', av: '–', avCls: 'none', html: '<em>Niemand im Dienst</em>', title: 'Keine zuständige Person im Dienst', more, pid: null };
  }

  /** Materialfluss am Arbeitsplatz: „Eingang ▮▮▯ 2/3 › Ausgang ▮▯▯ 1/3“ (bzw. Stangenmagazin / Rohmaterial-Lager) */
  function bufHTML(mv) {
    const slots = (n, cap, warnFull) => {
      if (!cap) return '';
      if (cap > 4) return `<span class="ls-mini${warnFull && n >= cap ? ' full' : ''}"><i style="width:${Math.round(Math.min(1, n / cap) * 100)}%"></i></span>`;
      const k = Math.min(n, cap);
      let s = `<span class="ls-slots${warnFull && n >= cap ? ' full' : ''}">`;
      for (let i = 0; i < cap; i++) s += `<i class="${i < k ? 'f' : ''}"></i>`;
      return s + '</span>';
    };
    const S0 = S(); const o = mv.order && S0.orders[mv.order.id];
    let prev = null, next = null;
    if (o) {
      const i = o.routing.findIndex(r => r.seq === mv.order.seq);
      if (i > 0) prev = o.routing[i - 1].station;
      if (i >= 0 && i < o.routing.length - 1) next = o.routing[i + 1].station;
    }
    const parts = [];
    if (mv.inCap) parts.push(`<span class="ls-bg">Eingang${slots(mv.input.length, mv.inCap, false)}<span class="ls-bn">${mv.input.length}/${mv.inCap}</span></span>`);
    else if (mv.barStockM != null) parts.push(`<span class="ls-bg">Stangenmagazin<span class="ls-bn">${U.fmtNum(mv.barStockM, 1)} m</span></span>`);
    else if (mv.type === 'saw') parts.push('<span class="ls-bg">Rohmaterial-Lager</span>');
    if (mv.outCap) parts.push(`<span class="ls-bg">Ausgang${slots(mv.output.length, mv.outCap, true)}<span class="ls-bn">${mv.output.length}/${mv.outCap}</span></span>`);
    const title = [
      mv.inCap ? `Eingang ${mv.input.length}/${mv.inCap} Behälter${prev ? ' (Teile von ' + WF.sim.stationName(prev) + ')' : ''}` : mv.type === 'saw' ? 'Säge entnimmt Stangen direkt aus dem Rohmaterial-Lager' : mv.barStockM != null ? `Stangenmagazin ${U.fmtNum(mv.barStockM, 1)} von ${U.fmtNum(mv.barMagazineM, 0)} m` : '',
      mv.outCap ? `Ausgang ${mv.output.length}/${mv.outCap} Behälter${next ? ' (weiter an ' + WF.sim.stationName(next) + ')' : ''}` : '',
    ].filter(Boolean).join(' · ');
    return { h: parts.join('<span class="ls-barr">›</span>'), title };
  }

  /** Ursache nur zeigen, wenn sie mehr sagt als Auftragszeile und Fortschritt („Teil 39/80 … in Bearbeitung“ ist dort schon zu sehen). */
  function causeIsInfo(mv) {
    if (!mv.cause) return false;
    if (mv.state !== 'running') return true;
    return !/^Teil\s+\d+\s*\/\s*\d+\b/.test(mv.cause);
  }

  /** Beginn des Zustandsbands: höchstens 4 h zurück, aber nie vor dem ersten aufgezeichneten Zustand (kein leerer Anfang) */
  function bandStart(segs, now) {
    const first = segs && segs.length ? segs[0].t0 : now - BAND_SEC;
    return Math.min(now - 1800, Math.max(now - BAND_SEC, first));
  }
  /** Ohne Schicht geplant (nicht autonome Maschine wartet auf den Schichtbeginn) – ruhige Kachel, keine Warnung.
      Bezeichnung „Keine Schicht“ aus WF.ui.machineStateLabel (eine Benennung für Kachel, Zusammenfassung, Drawer, Halle). */
  const restCause = /^Keine Schicht\s*[–-]\s*/;
  function tileVM(mv, now, noShift) {
    const st = WF.STATE[mv.state] || { label: stateLabel(mv), color: mv.stateColor || 'var(--st-setup)' };
    const showCause = causeIsInfo(mv);
    const label = stateLabel(mv);
    const restHold = label === 'Keine Schicht';
    const rest = !!((noShift && mv.state === 'idle') || restHold);
    // „Keine Schicht“ steht schon in der Pill – Ursache ohne Präfix; Zeitangaben wie in den übrigen Zeilen (morgen 06:00)
    const cause = relDays(restHold ? (s => s.charAt(0).toUpperCase() + s.slice(1))(String(mv.cause || '').replace(restCause, '')) : (mv.cause || '–'), now);
    const vm = {
      state: mv.state + '|' + label, color: st.color, rest,
      sev: mv.state === 'fault' ? 'crit' : WAIT[mv.state] ? 'warn' : '',
      pill: statePill(mv),
      since: sinceText(mv.sinceSec),
      sinceTitle: 'seit ' + U.fmtDayClock(mv.since),
      cause, showCause,
      conn: 'L' + (mv.conn.level || 0), connL: String(mv.conn.level || 0),
      connTitle: `Anbindung Level ${mv.conn.level}: ${WF.sim.LABELS.conn[mv.conn.level] || ''} – ${mv.conn.protocol || ''}`,
    };
    const bn = bottleneck(now);
    vm.flag = bn.id === mv.id ? 'Engpass' : '';
    vm.flagTitle = bn.id === mv.id ? bn.text : '';
    vm.flagC = bn.risk ? 'var(--st-wait)' : 'var(--info)';
    const o = mv.order;
    if (o) {
      vm.oid = o.id; vm.pn = o.partName; vm.none = false;
      const rk = riskOf(o.id);
      vm.risk = o.priority === 'eil' ? 'Eil' : rk === 'spät' ? 'verspätet' : rk === 'knapp' ? 'knapp' : '';
      vm.riskC = o.priority === 'eil' ? 'var(--accent)' : rk === 'spät' ? 'var(--st-fault)' : 'var(--st-wait)';
      vm.riskTitle = `${o.priority === 'eil' ? 'Eilauftrag · ' : ''}Termin ${U.fmtDue(o.due, now)}${rk ? ' · Liefertermin ' + WF.sim.label('risk', rk) : ''}`;
      vm.op = `<b>AG ${esc(o.seq)}</b>${esc(o.op)}<em> · ${esc(custShort(o.customer))}</em>`;
      vm.opTitle = `AG ${o.seq} ${o.op} – ${o.customer}, ${U.fmtNum(o.qty)} Stk, Termin ${U.fmtDue(o.due, now)}`;
      const total = mv.partsTotal || 0, done = mv.partsDone || 0;
      const running = mv.partNo != null;
      let left;
      if ((mv.phase === 'Rüsten' || mv.phase === 'Rüsten ausstehend') && done > 0) left = `${esc(U.fmtNum(done))} von ${esc(U.fmtNum(total))} fertig`;
      else if (mv.phase === 'Rüsten' || mv.phase === 'Rüsten ausstehend' || mv.phase === 'Erstteilprüfung' || mv.phase === 'Korrektur') left = `${esc(mv.phase)} · ${esc(U.fmtNum(done))} von ${esc(U.fmtNum(total))}`;
      else if (running) left = `${mv.phase === 'Erstteil' ? 'Erstteil · ' : ''}Teil ${esc(U.fmtNum(mv.partNo))} von ${esc(U.fmtNum(total))}${mv.partSub === 'load' && mv.state === 'running' ? ' <em>· wird eingelegt</em>' : ''}`;
      else left = `${esc(U.fmtNum(done))} von ${esc(U.fmtNum(total))} fertig`;
      vm.progL = left;
      vm.progR = mv.etaOpEnd != null ? 'fertig ca. ' + tclock(mv.etaOpEnd, now) : '';
      vm.progTitle = `${done} von ${total} Teilen bearbeitet${running ? `, Teil ${mv.partNo} ${mv.partSub === 'load' ? 'wird eingelegt' : 'zu ' + Math.round(mv.partProgress * 100) + ' %'}` : ''}${total > o.qty ? ` · Soll inkl. ${total - o.qty} Ersatz für Ausschuss` : ''}${mv.etaOpEnd != null ? ' · Arbeitsgang fertig ca. ' + U.fmtDayClock(mv.etaOpEnd) : ''}`;
      vm.frac = total ? Math.min(1, (done + (running ? mv.partProgress : 0)) / total) : 0;
      vm.barC = st.color;
    } else {
      const q = mv.queue[0];
      vm.oid = ''; vm.pn = q ? 'Kein Auftrag aktiv' : 'Kein Auftrag eingeplant'; vm.none = true; vm.risk = ''; vm.riskC = ''; vm.riskTitle = '';
      // „Als Nächstes“ steht bei freien Plätzen schon in der Ursache (Engine-Text) – nicht doppelt
      vm.op = q && !showCause ? `<em>Als Nächstes:</em> ${esc(q.orderId)} AG ${esc(q.seq)} <em>· ${esc(relDays(q.why, now))}</em>` : '';
      vm.opTitle = mv.queue.map(x => `${x.orderId} AG ${x.seq} ${x.op} – ${x.parts} Teile – ${x.why}`).join('\n');
      vm.progL = ''; vm.progR = ''; vm.frac = 0; vm.progTitle = '';
    }
    const tl = toolLine(mv, now);
    vm.toolN = tl ? tl.name : ''; vm.toolS = tl ? tl.status : ''; vm.toolU = tl ? tl.u : ''; vm.toolC = tl ? tl.c : ''; vm.toolTitle = tl ? tl.title : '';
    // ohne Schicht: Werkzeugzeile neutral (der Wechsel kommt mit der nächsten Schicht – kein Handlungsbedarf jetzt)
    if (rest && tl && tl.u !== 'faint' && tl.u !== 'crit') { vm.toolU = 'rest'; vm.toolC = 'var(--muted)'; }
    vm.wear = tl && tl.wear != null ? tl.wear : null;
    const op = operatorLine(mv);
    vm.oprCls = op.cls; vm.av = op.av; vm.avCls = op.avCls; vm.opr = op.html; vm.oprTitle = op.title;
    vm.more = op.more ? '+' + op.more.n : ''; vm.moreTitle = op.more ? op.more.title : '';
    const b = bufHTML(mv); vm.buf = b.h; vm.bufTitle = b.title;
    const segs = mv.segments || [];
    const last = segs[segs.length - 1];
    vm.band0 = bandStart(segs, now);
    vm.bandKey = segs.length + '|' + (last ? last.state + last.t0 : '') + '|' + Math.floor(now / 60) + '|' + Math.floor(vm.band0 / 60);
    vm.bandA0 = tclock(vm.band0, now);
    vm.bandTitle = `Zustände ${tclock(vm.band0, now)}–${U.fmtClock(now)}${now - vm.band0 >= BAND_SEC - 60 ? ' (letzte 4 h)' : ' (seit Aufzeichnungsbeginn)'}`;
    vm.aria = `${mv.short} ${mv.id}: ${label}, ${vm.since}. ${vm.cause}`;
    return vm;
  }

  function patchTile(t, mv, now, noShift) {
    const vm = tileVM(mv, now, noShift), p = t.vm, r = t.r, el = t.el;
    if (p.state !== vm.state) { el.dataset.state = mv.state; setVar(el, '--c', vm.color); setHTML(r.pill, vm.pill); }
    if (p.sev !== vm.sev) { el.classList.toggle('sev', !!vm.sev); el.classList.toggle('crit', vm.sev === 'crit'); }
    if (p.rest !== vm.rest) el.classList.toggle('rest', vm.rest);
    if (p.showCause !== vm.showCause) { el.classList.toggle('has-cause', vm.showCause); setAttr(r.cause, 'hidden', !vm.showCause); }
    setText(r.since, vm.since); setAttr(r.since, 'title', vm.sinceTitle);
    setText(r.cause, vm.cause); setAttr(r.cause, 'title', vm.cause);
    setAttr(r.flag, 'hidden', !vm.flag); setAttr(r.flag, 'title', vm.flagTitle); if (vm.flag) setVar(r.flag, '--c', vm.flagC);
    if (p.flag !== vm.flag) el.classList.toggle('flag', !!vm.flag);
    setText(r.conn, vm.conn); setAttr(r.conn, 'data-l', vm.connL); setAttr(r.conn, 'title', vm.connTitle);
    setText(r.oid, vm.oid); setText(r.pn, vm.pn); setAttr(r.pn, 'title', vm.pn);
    if (p.none !== vm.none) { r.ord.classList.toggle('none', vm.none); r.prog.hidden = vm.none; r.oid.hidden = vm.none; }
    setAttr(r.risk, 'hidden', !vm.risk); setText(r.risk, vm.risk); setAttr(r.risk, 'title', vm.riskTitle); if (vm.riskC) setVar(r.risk, '--c', vm.riskC);
    setHTML(r.op, vm.op); setAttr(r.op, 'title', vm.opTitle); setAttr(r.op, 'hidden', !vm.op);
    setHTML(r.progL, vm.progL); setText(r.progR, vm.progR); setAttr(r.prog, 'title', vm.progTitle);
    const sx = 'scaleX(' + vm.frac.toFixed(4) + ')';
    if (r.barI._s !== sx) {
      // Rücksprung (neuer Arbeitsgang) ohne Animation
      if (vm.frac < (p.frac || 0) - 0.02) { r.barI.style.transition = 'none'; requestAnimationFrame(() => { r.barI.style.transition = ''; }); }
      r.barI._s = sx; r.barI.style.transform = sx;
    }
    if (vm.barC && p.barC !== vm.barC) setVar(r.bar, '--c', vm.barC);
    setAttr(r.tool, 'hidden', !vm.toolN);
    setText(r.toolN, vm.toolN); setText(r.toolS, vm.toolS); setAttr(r.toolS.parentNode, 'hidden', !vm.toolS); setText(r.toolX, vm.toolS && vm.toolN ? ' · ' + vm.toolN : ''); setAttr(r.tool, 'title', vm.toolTitle);
    if (p.toolU !== vm.toolU) { r.tool.className = 'ls-tool u-' + vm.toolU; }
    if (vm.toolC) setVar(r.tool, '--tc', vm.toolC);
    setAttr(r.wear, 'hidden', vm.wear == null);
    if (vm.wear != null) { setText(r.wearT, U.fmtNum(vm.wear, 0) + ' %'); const ww = Math.min(100, vm.wear).toFixed(0) + '%'; if (r.wearI._w !== ww) { r.wearI._w = ww; r.wearI.style.width = ww; } setAttr(r.wear, 'title', 'Verschleiß ' + U.fmtNum(vm.wear, 1) + ' % der Standzeit'); }
    if (p.oprCls !== vm.oprCls) r.opr.className = 'ls-op8 ' + vm.oprCls;
    setText(r.av, vm.av); if (p.avCls !== vm.avCls) r.av.className = 'avatar ' + vm.avCls;
    setHTML(r.oprT, vm.opr); setAttr(r.opr, 'title', vm.oprTitle);
    setText(r.more, vm.more); setAttr(r.more, 'hidden', !vm.more); setAttr(r.more, 'title', vm.moreTitle);
    setHTML(r.buf, vm.buf); setAttr(r.buf, 'title', vm.bufTitle); setAttr(r.buf, 'hidden', !vm.buf);
    if (p.bandKey !== vm.bandKey) setHTML(r.bandB, WF.ui.stateBand(mv.segments, vm.band0, now, { w: 280, h: 6 }));
    setText(r.bandA0, vm.bandA0);
    setAttr(r.band, 'title', vm.bandTitle);
    setAttr(el, 'aria-label', vm.aria);
    t.vm = vm;
  }

  // ------------------------------------------------------------------ Engpass (eine Definition aus der Engine, falls vorhanden)
  function bottleneck(now) {
    const k = Math.floor(now / 60);
    if (bnCache.t === k) return bnCache;
    let id = null, text = '', risk = false, raw = null;
    if (WF.sim && typeof WF.sim.bottleneck === 'function') {
      try {
        const b = WF.sim.bottleneck();
        if (typeof b === 'string') id = b;
        else if (b) {
          raw = b;
          id = b.stationId || b.machineId || b.id || b.station || null;
          text = b.why || b.text || b.reason || '';
          risk = !!b.atRisk;
        }
      } catch (e) { id = null; }
    }
    if (id && !tiles[id]) id = null;
    bnCache = { t: k, id, risk, raw: id ? raw : null, text: id ? 'Engpass der Halle' + (text ? ': ' + text : '') : '' };
    return bnCache;
  }

  // ------------------------------------------------------------------ Zusammenfassung / Filter / Sortierung
  function buildSummary() {
    R.sum.innerHTML = STATE_GROUPS.map(g => `<button data-g="${g.key}" style="--c:${g.color}" aria-pressed="false" title="Nur ${esc(g.label)} anzeigen"${g.optional ? ' hidden' : ''}><i></i><b>0</b>${esc(g.label)}</button>`).join('');
    R.sum.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      if (tv) return;
      filter = filter === b.dataset.g ? null : b.dataset.g;
      R.sum.querySelectorAll('[data-g]').forEach(x => { x.classList.toggle('on', x.dataset.g === filter); x.setAttribute('aria-pressed', String(x.dataset.g === filter)); });
      applyOrder(true);
    });
  }
  function updateSummary() {
    const cnt = {};
    for (const id in lastMVs) { const g = groupOf(lastMVs[id]); cnt[g] = (cnt[g] || 0) + 1; }
    // „Keine Schicht“ nur, wenn es vorkommt; dann (nachts) leere Gruppen ausblenden – die Leiste bleibt einzeilig
    const night = (cnt.noshift || 0) > 0;
    R.sum.querySelectorAll('[data-g]').forEach(b => {
      const g = b.dataset.g, n = cnt[g] || 0, def = STATE_GROUPS.find(x => x.key === g);
      setText(b.querySelector('b'), String(n));
      b.classList.toggle('zero', n === 0 && filter !== g);
      setAttr(b, 'hidden', n === 0 && filter !== g && !!(def && (def.optional || night)));
    });
  }
  /** Handlungsbedarf: Störung › Wartet › laufender Eingriff (Rüsten, Wechsel, Erstteil) › Werkzeugwechsel/Erstteil in ≤ 15 min ›
      später Auftrag › knapper Auftrag › frei mit Arbeit in der Warteschlange › Produktion › frei ohne fällige Arbeit */
  function urgency(mv, now) {
    const s = mv.state;
    if (s === 'fault') return [0, -mv.sinceSec];
    if (WAIT[s]) return [1, -mv.sinceSec];
    if (SETUPISH[s]) return [2, -mv.sinceSec];
    let soon = Infinity;
    for (const t of mv.tools) {
      if (t.status === 'broken' || t.status === 'due') soon = 0;
      else if (t.status === 'planned' && t.plannedChange) soon = Math.min(soon, t.plannedChange.etaT != null ? Math.max(0, t.plannedChange.etaT - now) : 0);
    }
    if (mv.fpi) soon = 0;
    if (soon <= 900) return [3, soon];
    if (mv.order) { const rk = riskOf(mv.order.id); if (rk === 'spät') return [4, 0]; if (rk === 'knapp') return [5, 0]; }
    if (s === 'idle') return stateLabel(mv) === 'Keine Schicht' ? [8, 1] : mv.queue.some(q => q.level >= 1) ? [6, 0] : [8, 0];
    return [7, 0];
  }
  let orderSig = '';
  function applyOrder(force) {
    const ids = order.slice();
    if (sortMode === 'urgent') {
      const now = WF.sim.t, U0 = {};
      for (const id of ids) U0[id] = lastMVs[id] ? urgency(lastMVs[id], now) : [9, 0];
      ids.sort((a, b) => U0[a][0] - U0[b][0] || U0[a][1] - U0[b][1] || order.indexOf(a) - order.indexOf(b));
    }
    const g = filter ? STATE_GROUPS.find(x => x.key === filter) : null;
    const vis = ids.map(id => !g || (lastMVs[id] && groupOf(lastMVs[id]) === g.key));
    const sig = ids.join(',') + '|' + vis.join(',');
    if (!force && sig === orderSig) return;
    orderSig = sig;
    const active = document.activeElement;
    ids.forEach((id, k) => {
      const t = tiles[id];
      t.el.hidden = !vis[k];
      if (R.grid.children[k] !== t.el) R.grid.insertBefore(t.el, R.grid.children[k] || null);
    });
    if (X && R.grid.children[ids.length] !== X.el) R.grid.insertBefore(X.el, R.grid.children[ids.length] || null);
    if (X) X.el.hidden = !!filter;
    let empty = R.grid.querySelector('.ls-empty-filter');
    if (!vis.some(Boolean)) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'empty ls-empty-filter card'; R.grid.append(empty); }
      empty.textContent = `Derzeit kein Arbeitsplatz im Zustand „${g ? g.label : ''}“.`;
    } else if (empty) empty.remove();
    if (active && active !== document.activeElement && root.contains(active)) active.focus({ preventScroll: true });
    fitX();
  }

  // ------------------------------------------------------------------ Abschluss-Kachel „Schichtverlauf · Als Nächstes“
  function buildX() {
    const el = document.createElement('article');
    el.className = 'ls-tile ls-x';
    el.setAttribute('aria-label', 'Schichtverlauf und als Nächstes geplante Ereignisse');
    el.innerHTML = `<div class="ls-x-h"><h3>Schichtverlauf</h3><span class="ls-x-sh" data-r="xSh"></span></div>
      <div class="ls-x-tl"><div class="ls-x-tr" data-r="xTr"></div><div class="ls-x-ax" data-r="xAx"></div></div>
      <div class="ls-x-lh"><span class="eyebrow" data-r="xLh">Als Nächstes · 2 h</span></div>
      <div class="ls-x-list" data-r="xList"></div>`;
    const r = refs(el);
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-ent]'); if (!row) return;
      const [k, i] = row.dataset.ent.split('|'); WF.app.select(k, i);
    });
    return { el, r };
  }
  /** Spaltenzahl wie das CSS-Raster (auto-fill, minmax(256px|290px TV, 1fr), Lücke 10 px) aus der gemessenen Breite –
      ohne getComputedStyle (kein erzwungenes Layout) */
  function gridColumns() {
    if (MQ_PHONE.matches) return 1;
    if (tv && MQ_TVFIT.matches) return 5;
    const min = tv ? 290 : 256, gap = 10;
    return Math.max(1, Math.floor((gridW + gap) / (min + gap)));
  }
  /** Spannweite der Abschluss-Kachel = freie Zellen der letzten Reihe (volle Reihe, wenn keine frei ist) */
  function fitX() {
    if (!X || !R.grid || !gridW) return;
    const cols = gridColumns();
    const n = order.filter(id => !tiles[id].el.hidden).length;
    const rem = n % cols, span = Math.max(1, rem ? cols - rem : cols);
    const v = 'span ' + span;
    if (X.el._span !== v || gridCols !== cols) { X.el._span = v; gridCols = cols; X.el.style.gridColumn = v; lastNextSig = null; }
  }
  /** Vorschau-Horizont: in der Schicht 2 h, in der Geisterschicht bis 2 h nach Schichtbeginn (höchstens 12 h) */
  function horizon(now) {
    const sh = WF.sim.shift();
    if (sh.id) return { end: now + 2 * 3600, label: '2 h' };
    const end = Math.min(sh.endsAt + 2 * 3600, now + 12 * 3600);
    return { end, label: 'bis ' + tclock(end, now) };
  }
  /** Geplante Ereignisse im Horizont: Werkzeugwechsel, Arbeitsgang fertig, Pausen/Schichtende bzw. Schichtbeginn */
  function nextItems(now, H2) {
    const items = [];
    for (const id of order) {
      const mv = lastMVs[id]; if (!mv) continue;
      const seen = new Set();
      for (const t of mv.tools) {
        const pc = t.plannedChange;
        if (!pc || pc.etaT == null || pc.etaT > H2 || seen.has(pc.afterPart)) continue;
        if (t.status !== 'planned' && t.status !== 'due') continue;
        seen.add(pc.afterPart);
        const names = [toolShort(t.name)].concat((pc.withTools || []).map(toolShort));
        items.push({ t: pc.etaT, ic: 'wrench', c: pc.waitFromT != null ? 'var(--st-wait)' : 'var(--st-tool)', text: `${id} ${pc.action === 'index' ? 'Schneide wenden' : 'Werkzeugwechsel'} ${names.join(', ')}${pc.by ? ' · ' + pc.by : ''}`, ent: 'machine|' + id });
      }
      if (mv.order && mv.etaOpEnd != null && mv.etaOpEnd <= H2 && mv.etaOpEnd > now) items.push({ t: mv.etaOpEnd, ic: 'check', c: 'var(--st-run)', text: `${id} fertig mit ${mv.order.id} AG ${mv.order.seq}${mv.queue[0] && mv.queue[0].level === 2 ? ' · danach ' + mv.queue[0].orderId : ''}`, ent: 'machine|' + id });
    }
    const sh = WF.sim.shift();
    if (sh.id) {
      const def = WF.profile.shifts.find(s => s.id === sh.id);
      if (def) for (const [a, b] of def.breaks) { const t0 = U.dayStart(now) + U.hm(a); if (t0 > now && t0 <= H2) items.push({ t: t0, ic: 'clock', c: 'var(--info)', text: `Pause ${sh.name} bis ${b}`, ent: '' }); }
      if (sh.endsAt > now && sh.endsAt <= H2) items.push({ t: sh.endsAt, ic: 'users', c: 'var(--info)', text: `Schichtende ${sh.name}`, ent: '' });
    } else if (sh.endsAt > now && sh.endsAt <= H2) {
      const tod = U.fmtClock(sh.endsAt), nx = WF.profile.shifts.find(s => s.start === tod);
      items.push({ t: sh.endsAt, ic: 'users', c: 'var(--info)', text: `Schichtbeginn ${nx ? nx.name : ''}`.trim() + ' – Einrichter:innen übernehmen offene Wechsel', ent: '' });
    }
    return items.sort((a, b) => a.t - b.t);
  }
  /** Schichtfenster [w0, w1] mit Pausen (ohne Schicht: Geisterschicht-Fenster um „jetzt“) */
  function shiftWindow(now) {
    const sh = WF.sim.shift();
    const def = sh.id ? WF.profile.shifts.find(s => s.id === sh.id) : null;
    if (sh.id && def) {
      const len = ((U.hm(def.end) - U.hm(def.start)) + 86400) % 86400 || 86400;
      const w1 = sh.endsAt, w0 = w1 - len;
      const breaks = (def.breaks || []).map(([a, b]) => { const s0 = w0 + ((U.hm(a) - U.hm(def.start) + 86400) % 86400); const s1 = w0 + ((U.hm(b) - U.hm(def.start) + 86400) % 86400); return [s0, s1, a]; });
      return { sh, def, w0, w1, breaks };
    }
    return { sh, def: null, w0: now - 3600, w1: Math.max(now + 3 * 3600, horizon(now).end), breaks: [] };
  }
  function updateX(now) {
    if (!X) return;
    const r = X.r;
    const W = shiftWindow(now), sh = W.sh;
    if (sh.id) {
      setHTML(r.xSh, `<b>${esc(sh.name)}</b> ${esc(W.def ? W.def.start + '–' + W.def.end : '')} · ${sh.inBreak ? 'Pause' + (sh.breakEndsAt ? ' bis ' + esc(U.fmtClock(sh.breakEndsAt)) : '') : 'noch ' + esc(U.fmtDur(Math.max(0, sh.endsAt - now)))}`);
    } else setHTML(r.xSh, `<b>Geisterschicht</b> · nächste Schicht ${esc(tclock(sh.endsAt, now))}`);
    const HZ = horizon(now);
    const items = nextItems(now, HZ.end);
    setText(r.xLh, 'Als Nächstes · ' + HZ.label);
    // Zeitleiste (Minutenraster)
    const tlSig = Math.floor(now / 60) + '|' + W.w0 + '|' + items.map(x => Math.floor(x.t / 60) + x.ic).join(',');
    if (tlSig !== lastTlSig) {
      lastTlSig = tlSig;
      const span = Math.max(1, W.w1 - W.w0), P = (t) => Math.max(0, Math.min(100, (t - W.w0) / span * 100));
      const nowP = P(now);
      let tr = `<i class="el" style="width:${nowP.toFixed(2)}%"></i>`;
      for (const [b0, b1] of W.breaks) tr += `<i class="bk" style="left:${P(b0).toFixed(2)}%;width:${Math.max(0.6, P(b1) - P(b0)).toFixed(2)}%" title="Pause ${esc(U.fmtClock(b0))}–${esc(U.fmtClock(b1))}"></i>`;
      for (const x of items) if (x.ic !== 'clock' && x.ic !== 'users' && x.t <= W.w1) tr += `<i class="tk" style="left:${P(x.t).toFixed(2)}%;--c:${x.c}" title="${esc(U.fmtClock(x.t) + ' ' + x.text)}"></i>`;
      tr += `<i class="nw" style="left:${nowP.toFixed(2)}%" title="jetzt ${esc(U.fmtClock(now))}"></i>`;
      setHTML(r.xTr, tr);
      // Achse: Anfang, Pausen, Ende, „jetzt“ – ohne Überlappung
      const labels = [{ p: nowP, txt: U.fmtClock(now), cls: 'nw' }, { p: 0, txt: U.fmtClock(W.w0), cls: 'a0' }, { p: 100, txt: U.fmtClock(W.w1), cls: 'a1' }]
        .concat(W.breaks.map(b => ({ p: P(b[0]), txt: U.fmtClock(b[0]), cls: '' })));
      const placed = [];
      let ax = '';
      for (const l of labels) {
        if (placed.some(q => Math.abs(q - l.p) < 11)) continue;
        placed.push(l.p);
        ax += `<span class="${l.cls}" style="left:${l.p.toFixed(2)}%">${esc(l.txt)}</span>`;
      }
      setHTML(r.xAx, ax);
    }
    const list = items.slice(0, Math.min(tv ? 6 : 7, xCap));
    const sig = HZ.label + '|' + list.map(x => Math.floor(x.t / 60) + x.text).join('|');
    if (sig === lastNextSig) return;
    lastNextSig = sig;
    const other = list.some(x => Math.floor(x.t / 86400) !== Math.floor(now / 86400));
    r.xList.classList.toggle('wd', other);
    // Tag („morgen“) nur in der ersten Zeile eines anderen Tages – darunter genügt die Uhrzeit
    let lastDay = Math.floor(now / 86400);
    setHTML(r.xList, list.length ? list.map(x => {
      const d = Math.floor(x.t / 86400), when = d !== lastDay ? tclock(x.t, now) : U.fmtClock(x.t);
      lastDay = d;
      return `<div class="ls-x-row" style="--c:${x.c}" ${x.ent ? `data-ent="${esc(x.ent)}"` : ''} title="${esc(U.fmtDayClock(x.t) + ' – ' + x.text)}"><span class="num">${esc(when)}</span>${icon(x.ic, 14)}<span>${esc(x.text)}</span></div>`;
    }).join('')
      : `<div class="ls-x-empty">Keine Werkzeugwechsel, Arbeitsgang-Abschlüsse oder Pausen ${sh.id ? 'in den nächsten 2 Stunden' : 'bis zum Schichtbeginn'}.</div>`);
  }
  /** Liste „Als Nächstes“: nur ganze Zeilen (feste Zeilenhöhe --xr) – Zeilenzahl aus der gemessenen Listenhöhe.
      Telefon: Liste wächst mit dem Inhalt (alle Einträge). Aufruf nur aus dem ResizeObserver bzw. beim TV-Wechsel. */
  function fitXRows() {
    const rowH = tv ? 30 : 24;
    const cap = MQ_PHONE.matches ? 7 : Math.max(1, Math.floor((xListH + 0.5) / rowH));
    if (cap !== xCap) { xCap = cap; lastNextSig = null; if (WF.sim && S()) updateX(WF.sim.t); }
  }

  // ------------------------------------------------------------------ Kopf: Schicht & Personal
  function shiftLead(shiftId) {
    const people = WF.profile.people.filter(p => p.shift === shiftId);
    const lead = people.find(p => p.skills.includes('lead') || /schichtleit/i.test(p.role));
    if (lead) return { p: lead, label: 'Schichtleitung', note: lead.role };
    const setter = people.find(p => /einricht/i.test(p.role));
    if (setter) return { p: setter, label: 'Schichtverantwortung', note: setter.role + ' (keine Schichtleitung eingeteilt)' };
    return null;
  }
  /** Geisterschicht in einem Satz aus der Engine (kpis().ghost) – nie pauschal „autonome Maschinen laufen“ */
  function ghostLine() {
    let g = null; try { const k = WF.sim.kpis(); g = k && k.ghost; } catch (e) { g = null; }
    if (!g) return 'autonome Maschinen laufen weiter';
    if (!g.autonomous) return 'keine Maschine für die Geisterschicht freigegeben';
    const st = g.stoppedIds ? g.stoppedIds.length : 0;
    return g.running ? `${g.running} von ${g.autonomous} autonomen Maschinen laufen${st ? ` · ${st} gestoppt` : ''}`
      : `alle ${g.autonomous} autonomen Maschinen stehen${st ? ` (${st} warten)` : ''}`;
  }
  function updateHead(now) {
    const sh = WF.sim.shift();
    const Sx = S();
    const def = sh.id ? WF.profile.shifts.find(s => s.id === sh.id) : null;
    if (sh.id) {
      setText(R.shEy, sh.inBreak ? 'Pause' : 'Schicht');
      setText(R.shName, `${sh.name} ${def ? def.start + '–' + def.end : ''}`.trim());
      setText(R.shSub, sh.inBreak && sh.breakEndsAt ? `Pause bis ${U.fmtClock(sh.breakEndsAt)} · Schichtende ${U.fmtClock(sh.endsAt)}` : `noch ${U.fmtDur(Math.max(0, sh.endsAt - now))} bis Schichtende`);
      setVar(R.shDot, '--c', sh.inBreak ? 'var(--st-wait)' : 'var(--st-run)');
    } else {
      setText(R.shEy, 'Keine Schicht');
      setText(R.shName, 'Geisterschicht');
      setText(R.shSub, `nächste Schicht ${tclock(sh.endsAt, now)}`);
      setVar(R.shDot, '--c', 'var(--st-idle)');
    }
    const lead = sh.id ? shiftLead(sh.id) : null;
    setAttr(R.leadBox, 'hidden', !lead);
    if (lead) {
      const live = Sx.people[lead.p.id];
      setText(R.leadEy, lead.label); setText(R.leadName, lead.p.name); setText(R.leadAv, WF.ui.initials(lead.p.name));
      setText(R.leadSub, live && live.state !== 'offShift' ? (live.state === 'break' ? 'in der Pause' : lead.note) : 'nicht im Dienst');
      setAttr(R.leadBox, 'title', live ? `${lead.p.name} (${lead.p.role}) – ${live.activity || ''}` : lead.p.name);
    }
    let present = 0, shiftSize = 0, others = 0, inBreak = 0;
    for (const p of WF.profile.people) {
      const lp = Sx.people[p.id]; if (!lp) continue;
      const here = lp.state !== 'offShift';
      if (sh.id && p.shift === sh.id) { shiftSize++; if (here) present++; if (lp.state === 'break') inBreak++; }
      else if (here) others++;
    }
    // TV-Statuszeile: Schicht steht in der Abschluss-Kachel – hier nur Verantwortung und Besetzung
    setHTML(R.tvInfo, sh.id ? `${lead ? esc(lead.label) + ' <b>' + esc(lead.p.name) + '</b> · ' : ''}<b>${present} von ${shiftSize}</b> im Dienst${inBreak ? ` · ${inBreak} in Pause` : ''}` : `${others ? `<b>${others}</b> noch in der Halle · ` : ''}Geisterschicht: ${esc(ghostLine())}`);
    if (sh.id) {
      setText(R.staff, `${present} von ${shiftSize} im Dienst`);
      setText(R.staffSub, [inBreak ? `${inBreak} in Pause` : '', others ? `+${others} aus Vorschicht` : '', !inBreak && !others ? `Fertigung: ${WF.profile.people.length} Personen, ${WF.profile.shifts.length} Schichten` : ''].filter(Boolean).join(' · '));
    } else {
      setText(R.staff, others ? `${others} noch in der Halle` : 'Niemand im Dienst');
      setText(R.staffSub, ghostLine());
    }
  }

  // ------------------------------------------------------------------ KPI-Leiste
  function sparkSVG(vals, o) {
    const w = 160, h = 34, pad = 3;
    const v = vals.filter(x => x != null && isFinite(x));
    if (v.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
    let min = Math.min(...v), max = Math.max(...v);
    if (o.target != null) { min = Math.min(min, o.target); max = Math.max(max, o.target); }
    if (o.min != null) min = Math.min(min, o.min);
    const span = (max - min) || 1; min -= span * 0.08; max += span * 0.08;
    const X0 = (i) => pad + i / (vals.length - 1) * (w - 2 * pad);
    const Y = (x) => h - pad - (x - min) / (max - min) * (h - 2 * pad);
    let d = '', area = '', started = false, firstX = 0, lastX = 0, lastY = 0;
    vals.forEach((x, i) => {
      if (x == null || !isFinite(x)) { started = false; return; }
      const px = X0(i).toFixed(1), py = Y(x).toFixed(1);
      d += (started ? 'L' : 'M') + px + ',' + py;
      if (!area) firstX = px;
      area += (area ? 'L' : 'M') + px + ',' + py;
      started = true; lastX = px; lastY = py;
    });
    const fillPath = area ? `${area}L${lastX},${h}L${firstX},${h}Z` : '';
    const col = o.color || 'var(--info)';
    const tgt = o.target != null ? `<line x1="0" x2="${w}" y1="${Y(o.target).toFixed(1)}" y2="${Y(o.target).toFixed(1)}" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity=".8"/>` : '';
    // Endpunkt betont (runde Kappe einer Null-Linie bleibt bei preserveAspectRatio="none" rund)
    const dot = `<path d="M${lastX},${lastY}h0" style="stroke:${col}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${tgt}<path d="${fillPath}" style="fill:${col}" opacity=".13"/><path d="${d}" style="fill:none;stroke:${col}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
  }
  function riskCounts(now) {
    if (kpiCache.risk && Math.floor(now / 60) === kpiCache.t) return kpiCache.risk;
    const Sx = S(); let late = 0, tight = 0, open = 0, worst = null; const map = {};
    for (const id in Sx.orders) {
      const o = Sx.orders[id]; if (o.status === 'fertig') continue;
      open++;
      const ov = WF.sim.orderView(id); if (!ov) continue;
      map[id] = ov.risk;
      if (ov.risk === 'spät') { late++; if (!worst || ov.slackSec < worst.slackSec) worst = ov; }
      else if (ov.risk === 'knapp') tight++;
    }
    kpiCache = { t: Math.floor(now / 60), risk: { late, tight, open, worst, map } };
    return kpiCache.risk;
  }
  function riskOf(orderId) { const rc = kpiCache.risk || riskCounts(WF.sim.t); return rc.map[orderId] || ''; }
  function topLoss() {
    let top = null;
    for (const id in lastMVs) { const mv = lastMVs[id]; if (mv.lossEurToday > 0 && (!top || mv.lossEurToday > top.lossEurToday)) top = mv; }
    return top;
  }
  function openNotifs() {
    const Sx = S();
    return (Sx.notifications || []).filter(n => (n.status === 'open' || n.status === 'ack') && (n.sev === 'crit' || n.sev === 'warn'));
  }
  /** Hinweis an einer Kennzahl-Kachel nur über .kpi.warn / .kpi.crit (UI_GUIDE Regel 14) */
  function setHint(node, h) { if (node._hint !== h) { node._hint = h; node.classList.toggle('warn', h === 'warn'); node.classList.toggle('crit', h === 'crit'); } }
  const valUnit = (v, unit) => `${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ''}`;
  const pctV = (x, dec) => (x == null ? '–' : valUnit(U.fmtNum(x * 100, dec), '%'));
  const sameV = (a, b) => a != null && b != null && Math.abs(a - b) < 0.0005;
  /** Anzahl aus einem Engine-Feld, das Zahl oder ID-Liste sein darf */
  const num = (x) => (Array.isArray(x) ? x.length : typeof x === 'number' && isFinite(x) ? x : 0);
  /** OEE-Kachel: nach einer Nacht ist der Tageswert (inkl. Geisterschicht) nicht die Schicht-Leistung. Liefert die Engine
      kpis().oeeStaffedToday, zeigt die Kachel die besetzten Schichten und weist die Nacht getrennt aus. */
  function oeeModel(k) {
    const has = Object.prototype.hasOwnProperty.call(k, 'oeeStaffedToday');
    const st = has ? k.oeeStaffedToday : undefined;
    const nightPart = has && k.oee != null && !sameV(k.oee, st);
    if (!nightPart) return { value: k.oee, staffed: false, label: 'OEE heute' };
    if (st == null) return { value: k.oee, staffed: false, label: 'OEE heute · Nacht' };     // bisher nur Geisterschicht-Zeit
    return { value: st, staffed: true, label: 'OEE heute · Schichten' };
  }
  /** Stillstandskosten: Wert = Schichtzeit; Nacht (kpis().lossEurNightToday) getrennt. Größter Posten und Hauptursache
      nur, wenn sie zum Wert passen (je Maschine ohne Nacht – sonst würde eine nachts stehende Maschine „größter“). */
  function lossModel(k) {
    const night = typeof k.lossEurNightToday === 'number' && k.lossEurNightToday >= 0.5 ? k.lossEurNightToday : 0;
    const value = typeof k.lossEurStaffedToday === 'number' ? k.lossEurStaffedToday : Math.max(0, (k.lossEur || 0) - night);
    let top = null, cause = null;
    const split = !night || Object.values(lastMVs).some(mv => typeof mv.lossEurNightToday === 'number');
    if (split) {
      const by = {}; let sum = 0;
      for (const id in lastMVs) {
        const mv = lastMVs[id], e = (mv.lossEurToday || 0) - (night ? mv.lossEurNightToday || 0 : 0);
        if (e >= 0.5 && (!top || e > top.eur)) top = { id, eur: e };
        if (!night && mv.lossByState) for (const st in mv.lossByState) { by[st] = (by[st] || 0) + mv.lossByState[st]; sum += mv.lossByState[st]; }
      }
      const kk = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
      if (kk && sum > 0) cause = { label: WF.STATE[kk] ? WF.STATE[kk].label : kk, share: by[kk] / sum };
    }
    return { value, night, top, cause };
  }
  /** Schichten gegen Nacht: zwei Balken mit gemeinsamer Ziel-Marke (statt einer Tageskurve, die die Nacht enthält) */
  function oeeBars(v, col, nv, nl) {
    const bar = (x, c) => `<span>${x != null ? `<i style="width:${(U.clamp(x, 0, 1) * 100).toFixed(1)}%;--c:${c}"></i>` : ''}<b style="left:${(TARGET_OEE * 100).toFixed(0)}%"></b></span>`;
    return `<div class="ls-k-bars" aria-hidden="true"><em>Schichten</em>${bar(v, col)}${nv != null ? `<em>${esc(nl)}</em>${bar(nv, 'color-mix(in srgb,var(--text2) 45%,transparent)')}` : ''}</div>`;
  }
  function updateKpis(now) {
    const k = WF.sim.kpis(), Sx = S(), H = Sx.history;
    // OEE (eine Wahrheit: kpis(), 1 Nachkommastelle überall – Wert, Schicht, Nacht, V, L, Q)
    const M = oeeModel(k), g = k.ghost;   // g nur ohne Schicht: autonome, für den unbemannten Lauf freigegebene Maschinen
    setText(R.kOeeL, M.label);
    setHTML(R.kOeeV, pctV(M.value, 1));
    setHint(R.kOee, M.value != null && M.value < TARGET_OEE ? 'warn' : '');
    const day0 = U.dayStart(now);
    const tgtTxt = (v) => { const d = (v - TARGET_OEE) * 100; return `Ziel ${U.fmtPct(TARGET_OEE)} · ${d >= 0 ? '+' : '−'}${U.fmtNum(Math.abs(d), 1)} Pkt.`; };
    const shiftTxt = !g && k.oeeShift != null && !sameV(k.oeeShift, M.value) ? ` · Schicht <b>${U.fmtPct(k.oeeShift, 1)}</b>` : '';
    let l1, l2 = '', nightV = null, nightL = 'Nacht';
    if (g) {
      l1 = g.autonomous ? `Geisterschicht: <b>${g.running} von ${g.autonomous}</b> laufen` : 'Geisterschicht: keine autonome Maschine';
      if (M.staffed) { nightV = k.oeeShift; nightL = 'Nacht'; l2 = nightV != null ? `Nacht bisher <b>${U.fmtPct(nightV, 1)}</b>` : tgtTxt(M.value); }
      else if (M.value != null) l2 = tgtTxt(M.value);
    } else if (M.value == null) l1 = `Ziel ${U.fmtPct(TARGET_OEE)} · noch keine Planzeit heute`;
    else {
      l1 = tgtTxt(M.value) + shiftTxt;
      if (M.staffed) {
        const gn = k.ghostLastNight;
        if (gn && gn.oee != null) {
          const sp = num(gn.stopped), pv = num(gn.prevented);
          nightV = gn.oee;
          l2 = `Nacht <b>${U.fmtPct(gn.oee, 1)}</b> · ${sp || pv ? [sp ? sp + ' gestoppt' : '', pv ? pv + ' abgesichert' : ''].filter(Boolean).join(', ') : 'alle liefen durch'}`;
        } else { nightV = null; l2 = `inkl. Geisterschicht <b>${U.fmtPct(k.oee, 1)}</b>`; }
      }
    }
    const two = !!l2;
    R.kOee.classList.toggle('two', two);
    setHTML(R.kOeeS1, two ? `<span class="ln">${l1}</span><span class="ln">${l2}</span>` : l1);
    setAttr(R.kOeeS1, 'title', g ? `Ohne Schicht laufen nur autonome Maschinen (Stangenlader, Palettenwechsler, Portallader).${g.stoppedIds && g.stoppedIds.length ? ' Stehen: ' + g.stoppedIds.join(', ') + '.' : ''}`
      : M.staffed ? 'Kennzahl über die besetzten Schichten. Die Nacht (Geisterschicht: nur autonome Maschinen) wird getrennt ausgewiesen – stehende Maschinen sind dort ungenutzte Kapazität.' : null);
    setHTML(R.kOeeS2, `V <b>${U.fmtPct(k.availability, 1)}</b> × L <b>${U.fmtPct(k.performance, 1)}</b> × Q <b>${U.fmtPct(k.quality, 1)}</b>`);
    setAttr(R.kOeeS2, 'title', 'Verfügbarkeit × Leistung × Qualität');
    const apq = `V ${U.fmtPct(k.availability, 1)} × L ${U.fmtPct(k.performance, 1)} × Q ${U.fmtPct(k.quality, 1)}`;
    const sd = k.staffedToday;
    setAttr(R.kOee, 'title', M.staffed
      ? `OEE der besetzten Schichten heute ${U.fmtPct(M.value, 1)}${sd ? ` (V ${U.fmtPct(sd.availability, 1)} × L ${U.fmtPct(sd.performance, 1)} × Q ${U.fmtPct(sd.quality, 1)})` : ''} · ganzer Tag inkl. Geisterschicht ${U.fmtPct(k.oee, 1)}`
      : `Gesamtanlageneffektivität der Bearbeitungsmaschinen seit 00:00 – ${apq}${k.oeeShift != null ? ' · ' + (g ? 'Geisterschicht' : 'laufende Schicht') + ' ' + U.fmtPct(k.oeeShift, 1) : ''}`);
    // Verlauf: Tageskurve (history.oee) passt nur, wenn der Wert der ganze Tag ist; sonst Schichten gegen Nacht als Balken
    const hs = M.staffed && Array.isArray(H.oeeStaffed) && H.oeeStaffed.length === H.oee.length ? H.oeeStaffed : null;
    const series = M.staffed ? hs : H.oee;
    const sig = 'o' + H.t.length + '|' + (H.t[H.t.length - 1] || 0) + '|' + (M.value != null && M.value >= TARGET_OEE) + '|' + (series ? 's' : 'b' + Math.round((M.value || 0) * 1000) + '/' + (nightV == null ? '' : Math.round(nightV * 1000)));
    if (R.kOeeSpark._sig !== sig) {
      R.kOeeSpark._sig = sig;
      const col = M.value != null && M.value >= TARGET_OEE ? 'var(--st-run)' : 'var(--st-wait)';
      if (series) {
        let idx = H.t.findIndex(t => t >= day0);
        if (idx >= 0) while (idx < H.t.length - 1 && series[idx] == null) idx++; // ab dem ersten Wert mit Planzeit (Schichtbeginn)
        R.kOeeSpark.innerHTML = sparkSVG(idx >= 0 ? series.slice(idx) : [], { target: TARGET_OEE, color: col });
        R.kOeeSpark.title = `${hs ? 'OEE-Verlauf der Schichten heute' : 'OEE-Verlauf heute'} (5-min-Werte, kumuliert seit 00:00) – gestrichelt: Ziel ${U.fmtPct(TARGET_OEE)}`;
      } else {
        R.kOeeSpark.innerHTML = oeeBars(M.value, col, nightV, nightL);
        R.kOeeSpark.title = `Schichten ${U.fmtPct(M.value, 1)}${nightV != null ? ' · Nacht ' + U.fmtPct(nightV, 1) : ''} – Marke: Ziel ${U.fmtPct(TARGET_OEE)}`;
      }
    }
    // Teile
    setHTML(R.kGoodV, valUnit(U.fmtNum(k.goodFinished), 'Stk'));
    setHTML(R.kGoodS, `Arbeitsgänge: <b>${U.fmtNum(k.goodOps)}</b> gut`);
    setHTML(R.kGoodS2, `Ausschuss ${U.fmtNum(k.scrap)} · FPY ${U.fmtPct(k.fpy, 1)}`);
    // Termintreue – Hinweis nur, wenn ein offener Auftrag verspätet ist
    const rc = riskCounts(now);
    setHTML(R.kOtV, pctV(k.onTimePct, 0));
    setHint(R.kOt, rc.late ? 'warn' : '');
    setHTML(R.kOtS, rc.late ? `<b>${rc.late}</b> verspätet${rc.tight ? ` · ${rc.tight} knapp` : ''}` : rc.tight ? `${rc.tight} knapp · keiner verspätet` : 'alle offenen Aufträge im Plan');
    setText(R.kOtS2, rc.worst ? `${rc.worst.id}: ${U.fmtDur(-rc.worst.slackSec)} Verzug` : `${rc.open} offene Aufträge`);
    setAttr(R.kOt, 'title', `Termintreue ${U.fmtPct(k.onTimePct, 0)} – ${rc.late} Auftrag/Aufträge verspätet, ${rc.tight} mit weniger als 4 h Puffer (Prognose)`);
    // Stillstandskosten – Schichtzeit; die Nacht (Geisterschicht) ist ungenutzte Kapazität und steht getrennt daneben
    const L = lossModel(k);
    setHTML(R.kLossV, valUnit(U.fmtNum(L.value, 0), '€'));
    const topTxt = L.top ? `größter: <b>${esc(L.top.id)}</b> · ${U.fmtEur(L.top.eur)}` : L.value > 0 ? 'Rüsten, Warten, Störung' : 'heute kein Stillstand';
    R.kLoss.classList.toggle('two', L.night > 0);
    if (L.night > 0) setHTML(R.kLossS, `<span class="ln">${L.top ? topTxt : 'in der Schichtzeit'}</span><span class="ln">zzgl. Nacht <b>${esc(U.fmtEur(L.night))}</b></span>`);
    else setHTML(R.kLossS, topTxt);
    setText(R.kLossS2, L.cause ? `meist ${L.cause.label} (${U.fmtPct(L.cause.share, 0)})` : 'Rüsten, Warten, Störung');
    setAttr(R.kLoss, 'title', 'Maschinenstundensatz × Zeit in der Schicht, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Rüsten, Warten, Störung)' +
      (L.night > 0 ? ` · Nacht (Geisterschicht): ${U.fmtEur(L.night)} ungenutzte Kapazität autonomer Maschinen – nicht im Wert enthalten` : ''));
    // Energie
    setHTML(R.kEnV, valUnit(U.fmtNum(k.powerKw, 0), 'kW'));
    setText(R.kEnS, `heute ${U.fmtNum(k.energyKwh, 0)} kWh · Ø ${U.fmtNum(avgPower(H, day0), 0)} kW`);
    const esig = 'e' + H.t.length + '|' + (H.t[H.t.length - 1] || 0);
    if (R.kEnSpark._sig !== esig) {
      R.kEnSpark._sig = esig;
      const n = Math.round(BAND_SEC / (WF.profile.sim.historyStepSec || 300));
      R.kEnSpark.innerHTML = sparkSVG(H.powerKw.slice(-n), { color: 'var(--info)', min: 0 });
      R.kEnSpark.title = 'Leistungsaufnahme der letzten 4 h (5-min-Mittelwerte)';
    }
    // Meldungen – kritisch, wenn eine Störung offen ist; sonst Warnung (nie bei 0)
    const on = openNotifs();
    const open = on.filter(n => n.status === 'open'), crit = open.filter(n => n.sev === 'crit').length;
    const acked = on.length - open.length;
    setHTML(R.kMsgV, valUnit(String(open.length), 'offen'));
    setHint(R.kMsg, crit ? 'crit' : open.length ? 'warn' : '');
    setHTML(R.kMsgS, open.length ? `${crit ? `<b>${crit}</b> kritisch · ` : ''}${open.length - crit} ${open.length - crit === 1 ? 'Warnung' : 'Warnungen'}` : 'keine offenen Warnungen');
    const info = (Sx.notifications || []).filter(n => n.status === 'open' && n.sev === 'info').length;
    const roles = {};
    for (const n of open) roles[n.role || 'Leitstand'] = (roles[n.role || 'Leitstand'] || 0) + 1;
    const rl = Object.keys(roles).sort((a, b) => roles[b] - roles[a]).slice(0, 2).map(r => `${roles[r]} ${r}`).join(' · ');
    setText(R.kMsgS2, [acked ? `${acked} quittiert` : '', rl || (info ? `${info} Info` : '')].filter(Boolean).join(' · ') || 'keine Meldungen');
    setAttr(R.kMsg, 'title', 'Offene Warnungen und Störungen nach Rolle: ' + (Object.keys(roles).map(r => `${r} ${roles[r]}`).join(', ') || 'keine') + (info ? ` · zusätzlich ${info} Info-Meldungen` : ''));
    // Sprungleiste (Telefon)
    setText(R.jNow, String(open.length));
    setAttr(R.jNow, 'class', crit ? 'crit' : open.length ? 'warn' : '');
    setText(R.jMach, String(order.length));
  }
  function avgPower(H, day0) {
    let s = 0, n = 0;
    for (let i = H.t.length - 1; i >= 0 && H.t[i] > day0; i--) { s += H.powerKw[i]; n++; }
    return n ? s / n : null;
  }

  // ------------------------------------------------------------------ Jetzt wichtig
  const SEV_RANK = { crit: 0, warn: 1 };
  function renderNow(force) {
    const now = WF.sim.t;
    const list = openNotifs().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.t - a.t);
    const LIMIT = tv ? 8 : 4;   // TV: so viele, wie in die rechte Spalte passen (clipNow)
    const show = nowExpanded && !tv ? list.slice(0, 40) : list.slice(0, LIMIT);
    const openN = list.filter(n => n.status === 'open').length, critN = list.filter(n => n.status === 'open' && n.sev === 'crit').length;
    nowListSig = list.map(n => n.id + n.status).join(',');
    setText(R.nowCnt, String(openN));
    setAttr(R.nowCnt, 'class', 'ls-cnt' + (critN ? ' crit' : openN ? ' warn' : ''));
    const keep = new Set(show.map(n => n.id));
    for (const [id, node] of nowNodes) if (!keep.has(id)) { node.remove(); nowNodes.delete(id); }
    let okNode = R.nowList.querySelector('.ls-now-ok');
    if (!show.length) {
      if (!okNode) { okNode = document.createElement('div'); okNode.className = 'ls-now-ok'; R.nowList.append(okNode); }
      setHTML(okNode, `${icon('check', 18)}<div><b>Keine offenen Warnungen oder Störungen.</b><br><span class="muted">Hier erscheinen Störungen, Wartezeiten über 5 min, gefährdete Termine und Materialengpässe – mit Ursache und Empfehlung.</span></div>`);
    } else if (okNode) okNode.remove();
    const active = document.activeElement, activeKey = active && active.closest && active.closest('.ls-n') ? [active.closest('.ls-n').dataset.id, active.dataset.k] : null;
    show.forEach((n, k) => {
      let node = nowNodes.get(n.id);
      if (!node) { node = buildNotif(n); nowNodes.set(n.id, node); }
      patchNotif(node, n, now);
      if (R.nowList.children[k] !== node) R.nowList.insertBefore(node, R.nowList.children[k] || null);
    });
    if (activeKey && document.activeElement !== active) { const n = nowNodes.get(activeKey[0]); const b = n && n.querySelector(`[data-k="${activeKey[1]}"]`); if (b) b.focus({ preventScroll: true }); }
    let hiddenN = list.length - show.length;
    if (tv) {
      // TV: Höhen nur messen, wenn sich Inhalt oder Größe geändert haben (nicht 4× je Sekunde)
      const csig = show.map(n => n.id + n.status + (n.updatedT || n.t) + n.title + (n.body || '').length + (n.suggestion || '').length).join('|');
      if (nowClipDirty || csig !== nowClipSig) { nowClipSig = csig; nowClipDirty = false; nowClipped = clipNow(show); }
      hiddenN += nowClipped;
    } else if (nowClipped) { for (const node of nowNodes.values()) if (node.style.display) node.style.display = ''; nowClipped = 0; nowClipSig = ''; }
    setAttr(R.nowMore, 'hidden', !(hiddenN > 0 || (nowExpanded && !tv && list.length > 4)));
    setText(R.nowMore, tv ? `+ ${hiddenN} weitere ${hiddenN === 1 ? 'Meldung' : 'Meldungen'}` : nowExpanded ? 'Weniger anzeigen' : `${hiddenN} weitere ${hiddenN === 1 ? 'Meldung' : 'Meldungen'} anzeigen`);
    void force;
  }
  /** TV-Wandtafel (feste Höhe): nur Meldungen zeigen, die ganz hineinpassen – keine abgeschnittenen Texte */
  function clipNow(show) {
    const nodes = show.map(n => nowNodes.get(n.id)).filter(Boolean);
    const fit = MQ_TVFIT.matches;
    for (const node of nodes) if (node.style.display) node.style.display = '';
    if (!fit || !nodes.length) return 0;
    const bottom = R.nowList.getBoundingClientRect().bottom + 1;
    let clipped = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (clipped || nodes[i].getBoundingClientRect().bottom > bottom) { if (i === 0) break; nodes[i].style.display = 'none'; clipped++; }
    }
    return clipped;
  }
  function buildNotif(n) {
    const node = document.createElement('article');
    node.className = 'ls-n';
    node.dataset.id = n.id;
    node.innerHTML = `<div class="ls-n-top"><span class="sev" data-r="sev"></span><span data-r="meta"></span><button class="link" data-r="ent" data-k="ent" hidden></button></div>
      <div class="ls-n-t" data-r="t"></div><div class="ls-n-b" data-r="b"></div><div class="ls-n-s" data-r="s" hidden></div>
      <div class="ls-n-a" data-r="a"></div>`;
    node._r = refs(node);
    node.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const cur = (S().notifications || []).find(x => x.id === n.id); if (!cur) return;
      if (b.dataset.k === 'ent' && cur.entity) WF.app.select(cur.entity.kind, cur.entity.id);
      else if (b.dataset.k === 'ack') { const r = WF.sim.actions.ack(cur.id, 'Schichtleitung'); WF.app.toast(r && r.msg ? r.msg : 'Quittiert', r && r.ok === false ? 'warn' : 'ok'); renderNow(true); }
      else if (b.dataset.k && b.dataset.k.startsWith('a')) { const a = cur.actions[Number(b.dataset.k.slice(1))]; if (a) { WF.app.runAction(a.action); renderNow(true); } }
    });
    return node;
  }
  function patchNotif(node, n, now) {
    const r = node._r, S0 = WF.SEV[n.sev] || WF.SEV.warn;
    setVar(node, '--c', S0.color);
    node.classList.toggle('ack', n.status === 'ack');
    setText(r.sev, S0.label);
    // Zeitstempel wie im Benachrichtigungscenter: Entstehungszeit, ggf. „aktualisiert hh:mm“ (UI_GUIDE Regel 16)
    setHTML(r.meta, `${WF.ui.notifTime(n)}${n.role ? ' · ' + esc(n.role) : ''}`);
    setAttr(r.meta, 'title', `entstanden ${U.fmtDayClock(n.t)}${n.updatedT != null && n.updatedT - n.t > 60 ? ' · aktualisiert ' + U.fmtDayClock(n.updatedT) : ''}`);
    const ent = n.entity && n.entity.id && LINKABLE[n.entity.kind] ? n.entity : null;
    setAttr(r.ent, 'hidden', !ent);
    if (ent) { setText(r.ent, ent.kind === 'machine' || ent.kind === 'order' ? ent.id : WF.app.entityLabel(ent)); setAttr(r.ent, 'title', 'Öffnen: ' + WF.app.entityLabel(ent)); }
    // Zeitangaben wie in den Kacheln („morgen 06:00“ statt „Di 06:00“) – Inhalt unverändert aus der Meldung
    setText(r.t, relDays(n.title, now)); setText(r.b, relDays(n.body || '', now)); setAttr(r.b, 'hidden', !n.body);
    setAttr(r.s, 'hidden', !n.suggestion);
    if (n.suggestion) setHTML(r.s, `<b>Empfehlung</b> ${esc(relDays(n.suggestion, now))}`);
    const sig = n.status + '|' + (n.actions || []).map(a => a.label).join('|') + '|' + (n.ackBy || '');
    if (r.a._sig !== sig) {
      r.a._sig = sig;
      const acts = (n.actions || []).map((a, i) => {
        const primary = i === 0 && a.action && a.action.type !== 'select';
        return `<button class="btn sm${primary ? ' primary' : ''}" data-k="a${i}">${esc(a.label)}</button>`;
      }).join('');
      r.a.innerHTML = acts + (n.status === 'open' ? '<button class="btn sm ghost" data-k="ack">Quittieren</button>' : `<span class="ls-n-st">quittiert${n.ackBy ? ' von ' + esc(n.ackBy) : ''}${n.ackT != null ? ' ' + U.fmtClock(n.ackT) : ''} · Ursache besteht noch</span>`);
    }
  }

  // ------------------------------------------------------------------ KI-Schichtbriefing
  /* 3–5 knappe Punkte, die über die Karten darüber hinausgehen: Jetzt tun · Engpass · Heute Nacht (Geisterschicht-
     Vorschau) · Termine · Material. Was „Jetzt wichtig“ schon als Meldung zeigt, wird nicht wiederholt. Live aus der
     Engine (abgeleitete Sichten, die update() ohnehin liest), Neuaufbau nur bei geänderter Signatur. Das ausführliche
     Briefing formuliert der Copilot („Im Copilot vertiefen“). */
  const BRIEF_C = { crit: 'var(--st-fault)', warn: 'var(--st-wait)', tool: 'var(--st-tool)', ok: 'var(--st-run)', info: 'var(--info)', mat: 'var(--mat)' };
  const NOSTOP = { done: 1, ahead: 1, through: 1 };
  let ghostPrev = { k: -1, real: 0, v: null };
  function setBriefOpen(open, save) {
    briefOpen = !!open;
    if (R.briefCard) R.briefCard.classList.toggle('closed', !briefOpen);
    if (R.briefToggle) R.briefToggle.setAttribute('aria-expanded', String(briefOpen));
    if (save) { try { localStorage.setItem(BRIEF_KEY, briefOpen ? '1' : '0'); } catch (e) { /* ohne Speicher */ } }
    if (brief.items) setText(R.briefN, briefOpen ? '' : `${brief.items.length} Punkte`);
  }
  const entLink = (kind, id, txt) => `<button class="link" data-ent="${esc(kind + '|' + id)}">${esc(txt || id)}</button>`;
  /** Was „Jetzt wichtig“ schon zeigt (alle offenen/quittierten Warnungen und Störungen) */
  function coveredBy() {
    const ents = new Set(), keys = [];
    for (const n of openNotifs()) {
      if (n.entity) ents.add(n.entity.kind + '|' + n.entity.id);
      if (n.spc && n.spc.machineId) ents.add('machine|' + n.spc.machineId);
      keys.push(String(n.key || ''));
    }
    const has = (kind, id) => ents.has(kind + '|' + id) || keys.some(k => k.split(':').slice(1).indexOf(id) >= 0);
    return { has, ghost: keys.some(k => k.indexOf('ghost:') === 0) };
  }
  /** Geisterschicht-Vorschau aus der Engine (zwischengespeichert: höchstens alle 5 Sim-Minuten bzw. 3 s Echtzeit) */
  function ghostPreviewNow(now) {
    const fn = WF.sim && (typeof WF.sim.ghostPreview === 'function' ? WF.sim.ghostPreview : typeof WF.sim.ghostCheck === 'function' ? WF.sim.ghostCheck : null);
    if (!fn) return null;
    const k = Math.floor(now / 300), real = performance.now();
    if (ghostPrev.k !== k && real - ghostPrev.real > 3000 || ghostPrev.k === -1) {
      ghostPrev.k = k; ghostPrev.real = real;
      try { ghostPrev.v = fn.call(WF.sim) || null; } catch (e) { ghostPrev.v = null; }
    }
    return ghostPrev.v;
  }
  function briefItems(now) {
    const C = coveredBy(), sh = WF.sim.shift(), out = [];
    const mvs = order.map(id => lastMVs[id]).filter(Boolean);
    // 1 · Jetzt tun – der eine Eingriff, der (noch) nicht als Meldung oben steht
    const todo = [];
    for (const mv of mvs) {
      if (C.has('machine', mv.id)) continue;
      if (mv.state === 'fault') todo.push({ r: 0, sev: 'crit', main: `Störung an ${entLink('machine', mv.id)} beheben`, sub: mv.fault ? `${mv.fault.code} · ${mv.fault.text}` : mv.cause });
      else if (sh.id && WAIT[mv.state] && mv.sinceSec >= 300) todo.push({ r: 1, sev: 'warn', main: `${entLink('machine', mv.id)} ${esc(mv.short)} wieder anlaufen lassen`, sub: `${stateLabel(mv)} seit ${U.fmtDur(Math.floor(mv.sinceSec / 60) * 60)} – ${relDays(mv.cause, now)}` });
      else if (sh.id && mv.fpi && mv.fpi.waitingSec >= 600) todo.push({ r: 3, sev: 'warn', main: `Erstteil ${entLink('machine', mv.id)} prüfen lassen`, sub: `Maschine wartet seit ${U.fmtDur(Math.floor(mv.fpi.waitingSec / 60) * 60)} auf die Freigabe` });
      if (!sh.id) continue;
      for (const t of mv.tools || []) {
        const pc = t.plannedChange;
        if (!pc || pc.by || pc.etaT == null || pc.etaT - now > 3600 || pc.stage === 'später' || (t.status !== 'planned' && t.status !== 'due')) continue;
        if (pc.action === 'index' || t.nextAction === 'index') continue;   // Schneide wenden macht der Bediener selbst
        todo.push({ r: 2, sev: 'tool', main: `Werkzeugwechsel ${entLink('machine', mv.id)} ca. ${esc(tclock(pc.etaT, now))} besetzen`, sub: `${toolShort(t.name)}${(pc.withTools || []).length ? ' + ' + pc.withTools.length : ''} – noch kein Einrichter zugeteilt`, t: pc.etaT });
        break;
      }
    }
    todo.sort((a, b) => a.r - b.r || (a.t || 0) - (b.t || 0));
    if (todo[0]) out.push(Object.assign({ k: 'Jetzt tun' }, todo[0], todo.length > 1 ? { sub: todo[0].sub + ` · +${todo.length - 1} weitere` } : {}));
    // 1b · Letzte Nacht (morgens, bis 4 h nach Schichtbeginn): welche autonomen Maschinen standen, wie lange, was es kostete
    const gn = sh.id ? WF.sim.kpis().ghostLastNight : null;
    if (gn && gn.to != null && Math.floor(gn.to / 86400) === Math.floor(now / 86400) && now - gn.to < 4 * 3600) {
      const st = Array.isArray(gn.stopped) ? gn.stopped.slice().sort((a, b) => (b.lossEur || 0) - (a.lossEur || 0)) : [];
      const pv = num(gn.prevented), n = gn.autonomous || null;
      // Dauer statt € – der Nacht-Betrag des Tages steht in „Stillstandskosten“ (ab 00:00), hier zählt die ganze Nacht
      const parts = st.slice(0, 2).map(x => `${x.machineId} stand ${U.fmtDur(Math.floor((x.stoodSec || 0) / 60) * 60)}${x.since != null ? ' (ab ' + tclock(x.since, now) + ')' : ''}`);
      out.push({ k: 'Letzte Nacht', sev: st.length ? 'warn' : 'ok', ent: st[0] ? 'machine|' + st[0].machineId : null,
        main: st.length ? `${st.length}${n ? ' von ' + n : ''} autonomen Maschinen ${st.length === 1 ? 'stand' : 'standen'} still` : `${n ? 'Alle ' + n + ' autonomen' : 'Die autonomen'} Maschinen liefen durch`,
        sub: [parts.join(' · '), pv ? `${pv} Stopp${pv === 1 ? '' : 's'} vorbeugend abgesichert` : ''].filter(Boolean).join(' · ') || `OEE der Nacht ${U.fmtPct(gn.oee, 1)}` });
    }
    // 2 · Engpass – nur der Werks-Engpass (WF.sim.bottleneck, Regel 18)
    const bn = bottleneck(now).raw;
    if (bn && bn.stationId && tiles[bn.stationId]) {
      const late = (bn.late || []).length;
      out.push({ k: 'Engpass', sev: bn.atRisk ? 'warn' : 'info',
        main: `${entLink('machine', bn.stationId)} ${esc(bn.short || WF.sim.stationName(bn.stationId))} ${late ? `bremst ${late} ${late === 1 ? 'Auftrag' : 'Aufträge'}` : '– größter Arbeitsvorrat'}`,
        sub: `${bn.why || ''}${bn.atRisk ? ' – dort nichts warten lassen' : ''}` });
    }
    // 3 · Heute Nacht / Geisterschicht
    if (!C.ghost) {
      if (sh.id) {
        const gp = ghostPreviewNow(now);
        const ents = gp ? (Array.isArray(gp.machines) ? gp.machines : Object.values(gp.machines || {})).filter(e => e && e.machineId) : [];
        if (ents.length) {
          const stops = ents.filter(e => e.stopT != null && !NOSTOP[e.reason]).sort((a, b) => a.stopT - b.stopT);
          out.push({ k: 'Heute Nacht', sev: stops.length ? 'warn' : 'ok',
            main: stops.length ? `${stops.length} von ${ents.length} autonomen Maschinen ${stops.length === 1 ? 'stoppt' : 'stoppen'}` : ents.length === 1 ? 'Die autonome Maschine läuft durch' : `Alle ${ents.length} autonomen Maschinen laufen durch`,
            sub: stops.length ? relDays(gp.body || stops.map(e => `${e.machineId} ca. ${tclock(e.stopT, now)}`).join(' · '), now) : `bis ${tclock(gp.nextStart || gp.until, now)} – Standzeit, Stangen und Puffer reichen`,
            ent: stops[0] ? 'machine|' + stops[0].machineId : null });
        }
      } else {
        const g = WF.sim.kpis().ghost;
        if (g && g.autonomous) {
          const st = (g.machines || []).filter(m => (g.stoppedIds || []).indexOf(m.id) >= 0);
          out.push({ k: 'Geisterschicht', sev: st.length ? 'warn' : 'ok', main: `${g.running} von ${g.autonomous} autonomen Maschinen ${g.running === 1 ? 'läuft' : 'laufen'}`,
            sub: st.length ? st.slice(0, 3).map(m => `${m.id} steht seit ${tclock(m.since, now)}`).join(' · ') : `bis ${tclock(g.until, now)} ohne Stopp`, ent: st[0] ? 'machine|' + st[0].id : null });
        }
      }
    }
    // 4 · Material
    const mats = Object.values(S().materials || {});
    const low = mats.filter(m => m.onHand < m.min && !C.has('material', m.id)).sort((a, b) => a.onHand / a.min - b.onHand / b.min);
    const pur = (S().purchases || []).filter(p => p.status === 'bestellt').sort((a, b) => a.etaT - b.etaT);
    const matName = (m) => String(m.name).replace(/\s+Zuschnitt\b/, '').replace(/\s*\(Beispiel\)/, '');
    if (low.length) {
      const open = low.filter(m => !m.onOrder);
      const p0 = pur.find(p => low.some(m => m.id === p.materialId));
      const unit = (m, v) => `${U.fmtNum(v, m.unit === 'm' ? 1 : 0)} ${m.unit}`;
      const state = open.length ? (open.length === low.length ? 'nicht bestellt' : `${open.length} nicht bestellt`) : low.length === 1 ? 'bestellt' : 'alle bestellt';
      out.push({ k: 'Material', sev: open.length ? 'warn' : 'info', ent: 'material|' + (open[0] || low[0]).id,
        main: low.length === 1 ? `${esc(matName(low[0]))} unter Mindestbestand – ${state}` : `${low.length} Materialien unter Mindestbestand – ${state}`,
        sub: (low.length === 1 ? `Bestand ${unit(low[0], low[0].onHand)} (Min. ${unit(low[0], low[0].min)})` : low.slice(0, 2).map(matName).join(', ') + (low.length > 2 ? ` +${low.length - 2}` : ''))
          + (p0 ? ` · Lieferung ${tclock(p0.etaT, now)}` : '') });
    } else {
      const starved = mvs.filter(mv => mv.state === 'starved' && /material|rohteil|stange/i.test(mv.cause || '') && !C.has('machine', mv.id));
      if (starved.length) out.push({ k: 'Material', sev: 'warn', main: `${entLink('machine', starved[0].id)} wartet auf Material`, sub: relDays(starved[0].cause, now) });
      else out.push({ k: 'Material', sev: 'ok', main: 'Alle Bestände über Mindestbestand', sub: pur[0] && S().materials[pur[0].materialId] ? `nächste Lieferung ${matName(S().materials[pur[0].materialId])} ${tclock(pur[0].etaT, now)}` : 'keine Lieferung offen' });
    }
    // 5 · Termine – knappe Aufträge (verspätete stehen als Meldung oben)
    const rc = riskCounts(now);
    const tight = Object.keys(rc.map).filter(id => rc.map[id] === 'knapp' && !C.has('order', id));
    if (tight.length) {
      const ovs = tight.map(id => WF.sim.orderView(id)).filter(Boolean).sort((a, b) => a.slackSec - b.slackSec);
      if (ovs.length) out.push({ k: 'Termine', sev: 'warn', main: `${ovs.length} ${ovs.length === 1 ? 'Auftrag' : 'Aufträge'} knapp: ${ovs.slice(0, 3).map(o => entLink('order', o.id)).join(', ')}`,
        sub: `${ovs[0].id} hat nur ${U.fmtDur(Math.max(0, ovs[0].slackSec))} Puffer bis ${tclock(ovs[0].due, now)}` });
    }
    // Auffüllen auf mindestens 3 Punkte: der nächste fertige Auftrag
    if (out.length < 3) {
      const f = WF.sim.forecast(), nx = Object.keys(f.orders || {}).map(id => ({ id, o: f.orders[id], so: S().orders[id] })).filter(x => x.so && x.so.status !== 'fertig' && x.o && x.o.eta != null && !x.o.done).sort((a, b) => a.o.eta - b.o.eta)[0];
      if (nx) out.push({ k: 'Als Nächstes', sev: 'ok', main: `${entLink('order', nx.id)} fertig ca. ${esc(tclock(nx.o.eta, now))}`, sub: `${nx.so.part.name} · ${custShort(nx.so.customer)}${nx.o.eta <= nx.so.due ? ' · termingerecht' : ''}` });
    }
    return out.slice(0, 5);
  }
  function renderBrief() {
    const now = WF.sim.t;
    const k = Math.floor(now / 30);   // Inhalte ändern sich im Minutenraster; 4×/s neu zu rechnen bringt nichts
    if (brief.k === k && brief.nowSig === nowListSig && brief.items) return;
    brief.k = k; brief.nowSig = nowListSig;
    let items;
    try { items = briefItems(now); } catch (e) { console.warn('[leitstand] Briefing', e); items = brief.items || []; }
    brief.items = items;
    const html = `<ul class="ls-bl">${items.map(x => `<li style="--c:${BRIEF_C[x.sev] || BRIEF_C.info}"${x.ent && x.main.indexOf('data-ent') < 0 ? ` data-ent="${esc(x.ent)}" class="click"` : ''}><span class="ls-bl-k">${esc(x.k)}</span><div class="ls-bl-m"><b>${x.main}</b>${x.sub ? `<span title="${esc(x.sub)}">${esc(x.sub)}</span>` : ''}</div></li>`).join('')}</ul>
      <div class="ls-brief-f"><span title="Das Briefing wiederholt keine Meldung aus „Jetzt wichtig“">Stand ${esc(U.fmtClock(now))} · ergänzt „Jetzt wichtig“</span><span class="spacer"></span>${WF.ai ? '<button class="link ls-tvhide" data-ask>Im Copilot vertiefen</button>' : ''}</div>`;
    if (R.briefBody._h !== html) {
      setHTML(R.briefBody, html);
      const ask = R.briefBody.querySelector('[data-ask]');
      if (ask) ask.onclick = () => WF.bus.emit('ai:ask', { text: 'Erstelle mir ein ausführliches Schichtbriefing: Lage, Risiken für Termine, Werkzeugwechsel und Personal in den nächsten 2 Stunden, mit konkreten Empfehlungen.', context: { kind: 'view', id: 'leitstand' } });
    }
    setText(R.briefN, briefOpen ? '' : `${items.length} Punkte`);
  }

  // ------------------------------------------------------------------ Gerade passiert
  function feedEvent(e) {
    if (!FEED_TYPES[e.type]) return false;
    if (e.type === 'state') return !!(e.data && !e.data.minor && FEED_STATE_TO[e.data.to]);
    if (e.type === 'toolPlanned') return !!(e.data && e.data.manual); // geplante Wechsel stehen unter „Als Nächstes“
    return true;
  }
  function feedColor(e) {
    if (e.type === 'state') return (WF.STATE[e.data && e.data.to] || {}).color || 'var(--muted)';
    if (e.type === 'toolChanged' || e.type === 'toolPlanned') return 'var(--st-tool)';
    if (e.type === 'setupStart' || e.type === 'setupDone') return 'var(--st-setup)';
    if (e.type === 'extOut' || e.type === 'extIn' || e.type === 'bars' || e.type === 'delivery' || e.type === 'reorder') return 'var(--mat)';
    if (e.sev === 'crit') return 'var(--st-fault)';
    if (e.sev === 'warn') return 'var(--st-wait)';
    if (e.sev === 'ok') return 'var(--st-run)';
    return 'var(--info)';
  }
  function updateFeed(now) {
    const ev = S().events || [];
    const last = ev.length ? ev[ev.length - 1].id : null;
    // Tageswechsel: Zeitangaben („gestern 23:50“) neu schreiben
    const day = Math.floor(now / 86400);
    if (day !== feedDay) { feedDay = day; feedLastId = null; for (const n of feedNodes.values()) n.remove(); feedNodes.clear(); }
    if (last === feedLastId) return;
    const first = feedLastId == null;
    feedLastId = last;
    const pick = [];
    for (let j = ev.length - 1; j >= 0 && pick.length < 12; j--) if (feedEvent(ev[j])) pick.push(ev[j]);
    const keep = new Set(pick.map(e => e.id));
    for (const [id, node] of feedNodes) if (!keep.has(id)) { node.remove(); feedNodes.delete(id); }
    pick.forEach((e, k) => {
      let node = feedNodes.get(e.id);
      if (!node) {
        const ent = e.entity && LINKABLE[e.entity.kind] ? e.entity : null;
        node = document.createElement(ent ? 'button' : 'div');
        node.className = 'ls-ev' + (ent ? ' link-ev' : '') + (first ? '' : ' new');
        if (ent) { node.type = 'button'; node.dataset.ent = ent.kind + '|' + ent.id; node.title = 'Öffnen: ' + WF.app.entityLabel(ent); }
        node.style.setProperty('--c', feedColor(e));
        node.innerHTML = `<span class="num">${esc(tclock(e.t, now))}</span><span class="ls-ev-i">${icon(FEED_TYPES[e.type], 13)}</span><span class="ls-ev-m">${esc(e.msg)}</span>`;
        feedNodes.set(e.id, node);
      }
      if (R.feed.children[k] !== node) R.feed.insertBefore(node, R.feed.children[k] || null);
    });
    R.feed.classList.toggle('wd', pick.some(e => Math.floor(e.t / 86400) !== day));
    if (!pick.length && !R.feed.querySelector('.empty')) R.feed.innerHTML = '<div class="empty">Noch keine Ereignisse heute. Hier erscheinen Störungen, Werkzeugwechsel, Rüstvorgänge, Erstteilprüfungen und fertige Aufträge.</div>';
    else if (pick.length) { const em = R.feed.querySelector('.empty'); if (em) em.remove(); }
  }

  // ------------------------------------------------------------------ Update-Schleife
  function update() {
    if (!root || !WF.sim || !S()) return;
    const now = WF.sim.t;
    const tvNow = !!WF.app.tv;
    if (tvNow !== tv) setTvClass();
    const noShift = !WF.sim.shift().id;
    for (const id of order) {
      const mv = WF.sim.machineView(id); if (!mv) continue;
      lastMVs[id] = mv;
      patchTile(tiles[id], mv, now, noShift);
    }
    updateSummary();
    applyOrder(false);
    updateX(now);
    updateHead(now);
    updateKpis(now);
    renderNow(false);
    renderBrief();
    updateFeed(now);
  }

  WF.registerView({
    id: 'leitstand', title: 'Leitstand', icon: 'grid', group: 'betrieb', order: 1,
    mount,
    show() { setTvClass(); fitX(); },
    hide() { if (WF.app.tv) WF.app.setTv(false); },
    update,
    badge() {
      const Sx = S(); if (!Sx) return '';
      const n = (Sx.notifications || []).filter(x => x.status === 'open' && x.sev === 'crit').length;
      return n ? String(n) : '';
    },
  });
  /** Öffentlich: Leitstand-Hilfen für andere Module (z. B. KI-Briefing-Fallback, Tests) */
  WF.leitstand = {
    briefing: () => briefItems(WF.sim.t).map(x => ({ category: x.k, sev: x.sev, text: (x.main.replace(/<[^>]+>/g, '') + (x.sub ? ' – ' + x.sub : '')).replace(/&amp;/g, '&') })),
    refreshBriefing: () => { brief.k = -1; renderBrief(); },
  };
})();
