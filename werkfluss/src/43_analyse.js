/* werkfluss – Ansicht „Analyse“: Wo verliert die Fertigung heute Zeit und Geld?
   Held der Seite: Stillstandskosten nach Ursache (Pareto, € = Maschinenstundensatz × geplante Zeit ohne Produktion,
   exakt aus der Engine: kd/ks.lossEurBy, plannedStateSec) mit Empfehlungen daneben – Schichtzeit; die Nacht
   (Geisterschicht, kpis().lossEurNightToday) wird getrennt ausgewiesen. Darunter Verlustmatrix Maschine × Ursache,
   Ausstoß im Tagesverlauf (Arbeitsgänge gut je Stunde, Prognose aus einem Materialfluss-Modell der bekannten Aufträge,
   kumuliert gegen den um 06:00 eingefrorenen Tagesplan), OEE je Maschine und Energie (Werk = Leitstand, davon Maschinen).
   Eine Wahrheit: Bezeichnungen und Zahlen wie im Leitstand (OEE, Stillstandskosten, Fertige Teile, Energie).
   Rendern diff-basiert: Struktur nur bei geänderter Reihenfolge neu, Werte gezielt (Klicks gehen nie verloren). */
(function () {
  const WF = window.WF;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;
  const TARGET_OEE = 0.75;   // gleiches Ziel wie im Leitstand

  css(`
  .an-body{display:flex;flex-direction:column;gap:14px}
  .an-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
  @media (max-width:900px){.an-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .an-kpis .kpi.an-click{cursor:pointer}
  .an-kpis .kpi.an-click:hover{border-color:var(--line2)}
  .an-pair{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}
  @media (max-width:1100px){.an-pair{grid-template-columns:minmax(0,1fr)}}
  .an-ch{flex-wrap:wrap;row-gap:6px}
  .an-ch .muted{font-size:var(--fs-xs)}

  /* ---------- Held: Wo verlieren wir Geld? */
  .an-hb{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,1fr)}
  .an-hl{padding:16px 18px 14px;min-width:0}
  .an-hr{border-left:1px solid var(--line);min-width:0;display:flex;flex-direction:column}
  @media (max-width:1100px){.an-hb{grid-template-columns:minmax(0,1fr)}.an-hr{border-left:0;border-top:1px solid var(--line)}}
  .an-ins{margin:0 0 14px;font-size:var(--fs-md);line-height:1.5;color:var(--text2);max-width:76ch}
  .an-ins b{color:var(--accent);font-weight:600}
  .an-ins strong{color:var(--text);font-weight:600}
  .an-par{display:grid;grid-template-columns:minmax(128px,max-content) minmax(0,1fr) minmax(58px,max-content) minmax(118px,max-content);grid-template-rows:22px;grid-auto-rows:40px;column-gap:14px;align-items:center}
  .an-par>*{min-width:0}
  .an-par .pl{grid-column:1;display:flex;align-items:center;gap:9px;font-size:var(--fs-md);color:var(--text);white-space:nowrap;height:100%}
  .an-par .pl i{width:9px;height:9px;border-radius:3px;flex:none}
  .an-par .pb{grid-column:2;height:100%;display:flex;align-items:center;position:relative;z-index:1}
  .an-par .pb i{display:block;height:14px;border-radius:3px;min-width:3px;opacity:.88;background:var(--c);transition:width .3s ease}
  .an-par .pv{grid-column:3;font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .an-par .pm{grid-column:4;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-par .ax{grid-column:2;grid-row:1;position:relative;height:100%}
  .an-par .ax span{position:absolute;top:3px;transform:translateX(-50%);font-size:var(--fs-2xs);color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-par .ax span:first-child{transform:none}
  .an-par .ax span:last-child{transform:translateX(-100%)}
  .an-par .axh{grid-row:1;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);align-self:center}
  .an-par .axh.c3{text-align:right}
  .an-par .gr{grid-column:2;position:relative;align-self:stretch;pointer-events:none;z-index:0}
  .an-par .gr b{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed var(--line)}
  .an-par .cum{grid-column:2;position:relative;align-self:stretch;pointer-events:none;z-index:2}
  .an-par .cum svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .an-par .cum span{position:absolute;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--card);border:1.5px solid var(--text2)}
  .an-plg{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:var(--fs-xs);color:var(--muted)}
  .an-plg i{display:inline-block;vertical-align:middle;margin-right:6px}
  .an-plg .b{width:14px;height:8px;border-radius:2px;background:var(--text2);opacity:.6}
  .an-plg .c{width:18px;height:0;border-top:1.5px solid var(--text2);position:relative}
  .an-plg .c::after{content:"";position:absolute;left:5px;top:-4.5px;width:6px;height:6px;border-radius:50%;border:1.5px solid var(--text2);background:var(--card)}
  /* Nacht (Geisterschicht) – getrennt von der Schichtzeit, neutral schraffiert (kein Maschinenzustand) */
  .an-hatch{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--text2) 55%,transparent) 0 1.5px,transparent 1.5px 4px)}
  .an-nt{margin-top:16px;padding:12px 14px 13px;border-radius:9px;background:var(--bg2);border:1px solid var(--line)}
  .an-nt .h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .an-nt .h i{width:12px;height:12px;border-radius:3px;flex:none;border:1px solid var(--line2)}
  .an-nt .h .t{font:600 var(--fs-md)/1.2 var(--f-ui);color:var(--text)}
  .an-nt .h .t span{color:var(--muted);font-weight:500;font-size:var(--fs-xs);margin-left:6px}
  .an-nt .h b{margin-left:auto;font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-nt .ms{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .an-nt .ms button{font:inherit;font-size:var(--fs-xs);color:var(--text2);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 9px;cursor:pointer;font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-nt .ms button:hover{border-color:var(--line2);color:var(--text)}
  .an-nt .ms button b{color:var(--text);font-weight:600;margin-left:4px}
  .an-nt p{margin:8px 0 0;font-size:var(--fs-xs);color:var(--muted);line-height:1.45}
  .an-rc.night .h b{color:var(--text)}
  .an-rc.night{--c:var(--line2)}
  @media (max-width:560px){
    .an-hl{padding:14px 14px 12px}
    .an-par{grid-template-columns:minmax(0,116px) minmax(0,1fr) max-content;column-gap:10px}
    .an-par .ax span.q{display:none}
    .an-par .pm,.an-par .axh.c4{display:none}
    .an-par .pl{white-space:normal;line-height:1.15;font-size:var(--fs-sm);hyphens:manual}
  }
  .an-rh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:16px 16px 10px}
  .an-rh h4{margin:0;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .an-rh span{font-size:var(--fs-xs);color:var(--faint)}
  .an-rc{--c:var(--line2);padding:12px 16px 13px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px;box-shadow:inset 3px 0 0 var(--c)}
  .an-rc .h{display:flex;align-items:center;gap:9px}
  .an-rc .h b{font:600 var(--fs-lg)/1.2 var(--f-ui);flex:1;min-width:0}
  .an-rc .h .e{font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-rk{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--raise);color:var(--text2);font:600 var(--fs-xs)/1 var(--f-ui);flex:none}
  .an-rc p{margin:0;color:var(--text2);font-size:var(--fs-sm);line-height:1.45}
  .an-rc .acts{display:flex;align-items:center;justify-content:space-between;gap:6px 10px;flex-wrap:wrap}
  .an-rc .acts .muted{font-size:var(--fs-xs)}
  .an-rc .acts .btn{margin-left:auto}
  .an-rc .acts .muted b{color:var(--text2);font-weight:600}

  /* ---------- Verlustmatrix */
  .an-mx-wrap{overflow-x:auto}
  .an-mx{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:3px;font-size:var(--fs-sm)}
  .an-mx th{font:600 var(--fs-2xs)/1.25 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:2px 4px 6px;text-align:center;vertical-align:bottom;white-space:normal;hyphens:manual;overflow-wrap:break-word}
  .an-mx th.m{text-align:left;padding-left:4px}
  .an-mx th.s{text-align:right;padding-right:4px}
  .an-mx td{height:32px;border-radius:5px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text);padding:0 4px}
  .an-mx td.m{text-align:left;color:var(--text2);padding:0 8px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
  .an-mx td.m:hover{color:var(--text)}
  .an-mx td.z{color:var(--faint)}
  .an-mx td.s{padding:0 4px 0 12px}
  .an-sb{display:flex;align-items:center;gap:10px}
  .an-sb .tr{flex:1;min-width:24px;height:6px;border-radius:3px;background:var(--track);overflow:hidden}
  .an-sb .tr i{display:block;height:100%;border-radius:inherit;background:var(--text2);opacity:.55;transition:width .3s ease}
  .an-sb b{font-weight:600;min-width:46px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-h0{background:color-mix(in srgb,var(--st-fault) 13%,var(--card2))}
  .an-h1{background:color-mix(in srgb,var(--st-fault) 27%,var(--card2))}
  .an-h2{background:color-mix(in srgb,var(--st-fault) 41%,var(--card2))}
  .an-h3{background:color-mix(in srgb,var(--st-fault) 56%,var(--card2));font-weight:600}
  .an-h4{background:color-mix(in srgb,var(--st-fault) 70%,var(--card2));font-weight:600}
  .an-mx td.an-hn,.an-ml .cs span.an-hn{color:var(--text2);background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--text2) 13%,var(--card2)) 0 3px,var(--card2) 3px 7px);box-shadow:inset 0 0 0 1px var(--line2)}
  .an-mx th.n{color:var(--text2)}
  @media (max-width:1100px){
    .an-mx th.m,.an-mx td.m{position:sticky;left:0;z-index:1;background:var(--card)}
    .an-mx th.s,.an-mx td.s{position:sticky;right:0;z-index:1;background:var(--card);box-shadow:0 0 0 3px var(--card),-1px 0 0 3px var(--line)}
    .an-mx th.m,.an-mx td.m{box-shadow:0 0 0 3px var(--card),1px 0 0 3px var(--line)}
  }
  .an-lg{display:flex;align-items:center;gap:3px;font-size:var(--fs-xs);color:var(--muted);flex-wrap:wrap}
  .an-lg .t{margin-right:6px}
  .an-lg span.k{display:inline-flex;align-items:center;gap:5px;margin-right:9px;font-variant-numeric:tabular-nums}
  .an-lg i{display:inline-block;width:18px;height:10px;border-radius:2px}
  .an-ml{display:none;flex-direction:column}
  .an-ml .r{padding:11px 0 12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:8px;cursor:pointer}
  .an-ml .r:first-child{padding-top:2px}
  .an-ml .r:last-child{border-bottom:0}
  .an-ml .t{display:flex;align-items:center;gap:12px}
  .an-ml .t>span{font-weight:600;font-size:var(--fs-md);width:92px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .an-ml .t .an-sb{flex:1;min-width:0}
  .an-ml .t .an-sb b{font:600 var(--fs-lg)/1 var(--f-cond)}
  .an-ml .cs{display:flex;flex-wrap:wrap;gap:5px}
  .an-ml .cs span{font-size:var(--fs-xs);padding:3px 8px;border-radius:5px;color:var(--text);font-variant-numeric:tabular-nums}
  .an-mfoot{margin-top:10px;font-size:var(--fs-xs);color:var(--muted)}
  @media (max-width:560px){.an-mx-wrap{display:none}.an-ml{display:flex}}

  /* ---------- Ausstoß */
  .an-os{display:flex;flex-wrap:wrap;gap:10px 30px;margin:2px 0 12px}
  .an-os>div{display:flex;flex-direction:column;gap:5px;min-width:0}
  .an-os .l{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .an-os .v{font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}
  .an-os .v small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:6px}
  .an-os .v small.up{color:var(--text2)}
  .an-os .v small.down{color:var(--st-wait)}
  .an-os .v.acc{color:var(--accent)}
  .an-chart{width:100%;display:block;overflow:visible}
  .an-chart text{font-family:var(--f-ui);fill:var(--muted);font-size:var(--fs-2xs);font-variant-numeric:tabular-nums}
  .an-chart text.ey{fill:var(--faint);font-weight:600;letter-spacing:.1em}
  .an-chart text.vl{fill:var(--text);font-weight:600;font-size:var(--fs-xs)}
  .an-chart text.fc{fill:var(--accent);font-weight:600;font-size:var(--fs-xs)}
  .an-chart text.pl{fill:var(--muted);font-weight:600;font-size:var(--fs-xs)}
  .an-chart text.now{fill:var(--accent);font-weight:600}
  .an-chart .grid{stroke:var(--line);stroke-width:1}
  .an-chart .axis{stroke:var(--line2);stroke-width:1}
  .an-chart .hit{fill:transparent;cursor:default}
  .an-chart .hit:hover{fill:color-mix(in srgb,var(--raise) 30%,transparent)}
  .an-legend{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted);margin-top:10px}
  .an-legend i{display:inline-block;width:12px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
  .an-legend i.act{background:var(--text2);opacity:.5}
  .an-legend i.gh{background:color-mix(in srgb,var(--text2) 6%,transparent);border:1px dashed color-mix(in srgb,var(--text2) 45%,transparent)}
  .an-legend i.ln{width:18px;height:0;border-radius:0;border-top:2px solid var(--accent);vertical-align:3px}
  .an-legend i.fc{width:18px;height:0;border-radius:0;border-top:2px dashed var(--accent);opacity:.8;vertical-align:3px}
  .an-legend i.pl{width:18px;height:0;border-radius:0;border-top:2px dotted var(--muted);vertical-align:3px}
  .an-legend i.pt{width:14px;height:0;border-radius:0;border-top:2px solid var(--muted);vertical-align:3px}
  .an-legend .nt{margin-left:auto;color:var(--faint)}
  @media (max-width:560px){.an-legend .nt{margin-left:0}}
  .an-os .v small.fin{color:var(--muted)}
  .an-chart .plt{stroke:var(--muted);stroke-width:2;stroke-linecap:round}

  /* ---------- Balkenlisten (OEE, Energie) */
  .an-bars{display:grid;grid-template-columns:minmax(84px,max-content) minmax(60px,1fr) max-content max-content;gap:8px 12px;align-items:center}
  .an-row{display:contents}
  .an-row.click .an-l{cursor:pointer}
  .an-row.click:hover .an-l{color:var(--text)}
  .an-l{color:var(--text2);font-size:var(--fs-sm);text-align:right;white-space:nowrap}
  .an-track{position:relative;height:12px;border-radius:3px;background:var(--track)}
  .an-track i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;transition:width .3s ease}
  .an-track i.g{background:var(--st-run)}.an-track i.y{background:var(--st-wait)}.an-track i.r{background:var(--st-fault)}.an-track i.n{background:var(--st-idle)}
  .an-track i.q{background:var(--text2);opacity:.38}
  .an-tg{position:absolute;top:-4px;bottom:-4px;width:0;border-left:1.5px dashed var(--muted)}
  .an-v{font:600 var(--fs-sm)/1 var(--f-ui);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .an-v.mu{color:var(--muted);font-weight:500}
  .an-m{color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;font-variant-numeric:tabular-nums}
  .an-m.em{color:var(--text);font:600 var(--fs-lg)/1 var(--f-cond);text-align:right}
  .an-m.em small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .an-bh{display:contents}
  .an-bh span{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);text-align:right;white-space:nowrap}
  .an-legend2{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted);margin-top:12px}
  .an-legend2 i{display:inline-block;width:0;height:12px;border-left:1.5px dashed var(--muted);margin-right:6px;vertical-align:-2px}
  .an-eins{margin:0 0 12px;font-size:var(--fs-sm);color:var(--text2);line-height:1.5}
  .an-eins b{color:var(--accent);font-weight:600}
  .an-es{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--track);margin:0 0 6px}
  .an-es i{display:block;height:100%}
  .an-es i.m{background:var(--text2);opacity:.55}
  .an-es i.b{opacity:.9}
  .an-esl{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:var(--fs-xs);color:var(--muted);margin:0 0 14px;font-variant-numeric:tabular-nums}
  .an-esl i{display:inline-block;width:10px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}
  .an-esl i.m{background:var(--text2);opacity:.55}
  .an-esl b{color:var(--text2);font-weight:600}
  .an-pw{display:inline-flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--muted)}
  .an-pw b{font:600 var(--fs-md)/1 var(--f-ui);color:var(--text);font-variant-numeric:tabular-nums}
  @media (max-width:560px){
    .an-bars{grid-template-columns:minmax(70px,max-content) minmax(40px,1fr) max-content}
    .an-bars .an-m{display:none}
    .an-bars.en{grid-template-columns:minmax(70px,max-content) minmax(40px,1fr) max-content max-content}
    .an-bars.en .an-m{display:block}
    .an-bars.en .an-v{font-size:var(--fs-xs)}
    .an-bh span.hm{display:none}
    .an-bars.en .an-bh span.hm{display:block}
  }
  @media (pointer:coarse){
    .an-bars{row-gap:0}
    .an-row.click .an-l{min-height:40px;display:flex;align-items:center;justify-content:flex-end}
    .an-mx td{height:40px}
  }
  .an-tip{position:fixed;z-index:80;pointer-events:none;background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font-size:var(--fs-xs);color:var(--text2);box-shadow:var(--shadow);max-width:300px;line-height:1.4}
  `, 'analyse');

  // Verlustursachen = Zustände mit eingeplantem Auftrag ohne Produktion; Farben = Zustandsfarben (WF.STATE)
  const ORDER = ['setup', 'firstPiece', 'toolchange', 'waitTool', 'waitOperator', 'starved', 'blocked', 'fault'];
  const RECO = {
    setup: 'Rüstfolge ähnlicher Aufträge bündeln und hauptzeitparallel rüsten: Werkzeuge voreinstellen, Spannmittel vorbereiten.',
    firstPiece: 'Erstteile warten auf den Messraum. Feste Prüffenster einplanen oder das Erstteil an der Maschine prüfen.',
    waitOperator: 'Maschinen warten auf Personal – meist in Pausen und bei Mehrmaschinenbedienung. Pausen staffeln, Einlegen über die Schicht verteilen.',
    toolchange: 'Werkzeugwechsel bündeln und Schwesterwerkzeuge voreingestellt bereitlegen.',
    waitTool: 'Die Maschine steht, bis der Einrichter mit dem Werkzeug kommt. Wechsel früher ankündigen, Werkzeug vorab bereitstellen.',
    starved: 'Material kommt zu spät an die Maschine. Transporte früher anstoßen oder die Weitergabemenge verkleinern.',
    blocked: 'Fertige Behälter werden nicht abgeholt. AGV-Prioritäten anpassen oder Pufferplätze erweitern.',
    fault: 'Störungen verursachen Stillstand. Häufigste Alarme auswerten und vorbeugende Wartung einplanen.',
  };
  const stColor = (k) => (WF.STATE[k] && WF.STATE[k].color) || 'var(--st-idle)';
  const stLabel = (k) => (WF.STATE[k] && WF.STATE[k].label) || k;
  /** weiche Trennstellen für lange Komposita (schmale Spalten am Handy) */
  const hy = (s) => s.replace('Werkzeugwechsel', 'Werkzeug\u00adwechsel').replace('Erstteilprüfung', 'Erstteil\u00adprüfung');
  const pct0 = (v) => v == null ? '–' : Math.round(v * 100) + ' %';
  const pct1 = (v) => v == null ? '–' : U.fmtNum(v * 100, 1) + ' %';
  const kwh = (v) => U.fmtNum(v, v < 10 ? 2 : 1);
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  /** Achse: kleinster „schöner“ Schritt, mit dem höchstens `ticks` Intervalle den Wert abdecken */
  function niceAxis(v, ticks) {
    v = Math.max(v, 1);
    const p = Math.pow(10, Math.floor(Math.log10(v / ticks)));
    for (const m of [1, 2, 2.5, 5, 10, 20]) { const st = m * p; if (Math.ceil(v / st - 1e-9) <= ticks) return { step: st, max: Math.ceil(v / st - 1e-9) * st }; }
    return { step: v, max: v };
  }
  /** Zahl und Einheit nicht umbrechen */
  const nb = (str) => String(str).replace(/ (€|%|kWh|kW|h|min|Teile)(?![\wäöü])/g, '\u00a0$1');

  let root = null, range = 'kd', tip = null, flowW = 0, slowKey = '', plan = null, bneckCache = null;
  const SEC = {};
  const S = () => WF.sim && WF.sim.state;
  const machines = () => WF.profile.machines.filter(id => S().machines[id]);
  const stats = (m) => (range === 'ks' ? m.ks : m.kd) || {};
  const price = () => { try { const c = WF.sim.costs ? WF.sim.costs() : WF.profile.costs; return c && c.energyEurPerKwh > 0 ? c.energyEurPerKwh : null; } catch (e) { return null; } };
  const q = (sel) => root.querySelector(sel);

  /** Abschnitt rendern: Struktur (Reihenfolge) geändert → einmal neu aufbauen; sonst nur geänderte Werte setzen.
      T = Text/HTML eines Elements, W = Balkenbreite, C = Klasse, A = Tooltip (data-tip). */
  function paint(name, host, struct, build) {
    if (!host) return;
    let sec = SEC[name];
    if (!sec || sec.host !== host) sec = SEC[name] = { host, struct: null, nodes: null, last: {} };
    const vals = {};
    const T = (k, html, tag = 'span', attrs = '') => { vals['t' + k] = html; return `<${tag} data-t="${k}"${attrs ? ' ' + attrs : ''}>${html}</${tag}>`; };
    const W = (k, frac) => { const v = (U.clamp(frac || 0, 0, 1) * 100).toFixed(1) + '%'; vals['w' + k] = v; return `data-w="${k}" style="width:${v}"`; };
    const C = (k, cls) => { vals['c' + k] = cls; return `data-c="${k}" class="${cls}"`; };
    const A = (k, text) => { vals['a' + k] = text; return `data-a="${k}" data-tip="${esc(text)}"`; };
    const html = build(T, W, C, A);
    if (struct !== sec.struct) {
      host.innerHTML = html;
      sec.struct = struct; sec.nodes = new Map();
      for (const n of host.querySelectorAll('[data-t],[data-w],[data-c],[data-a]')) {
        const d = n.dataset;
        if (d.t != null) sec.nodes.set('t' + d.t, n);
        if (d.w != null) sec.nodes.set('w' + d.w, n);
        if (d.c != null) sec.nodes.set('c' + d.c, n);
        if (d.a != null) sec.nodes.set('a' + d.a, n);
      }
    } else {
      for (const k in vals) {
        if (sec.last[k] === vals[k]) continue;
        const n = sec.nodes.get(k); if (!n) continue;
        const kind = k[0];
        if (kind === 't') n.innerHTML = vals[k];
        else if (kind === 'w') n.style.width = vals[k];
        else if (kind === 'c') n.className = vals[k];
        else n.setAttribute('data-tip', vals[k]);
      }
    }
    sec.last = vals;
  }

  // ------------------------------------------------------------ Daten
  /** Nachtanteil (Geisterschicht) der Tageswerte einer Maschine – Engine-Feld kn (heute ohne Schicht), falls vorhanden */
  const nightStats = (m) => (m && m.kn && typeof m.kn.lossEur === 'number' && m.kn.lossEurBy ? m.kn : null);
  /** Nacht getrennt ausweisen? Nur „Heute“ und nur, wenn die Engine den Nachtanteil liefert (kpis().lossEurNightToday). */
  const nightSplit = (k) => range === 'kd' && k && typeof k.lossEurNightToday === 'number';
  /** Stillstandskosten je Maschine und Ursache – exakt aus der Engine (lossEurBy, Σ = lossEur; Zeit = plannedStateSec).
      „Heute“ mit Nachtanteil: Ursachen = Schichtzeit (kd − kn), die Nacht (Geisterschicht) als eigener Posten je Maschine. */
  function lossModel(k) {
    const rows = [], causes = {}, nightBy = {};
    const split = nightSplit(k);
    for (const id of machines()) {
      const m = S().machines[id], st = stats(m), by = st.lossEurBy, ps = st.plannedStateSec || {};
      const nt = split ? nightStats(m) : null, perSec = (m.rate || 0) / 3600;
      const cells = {};
      if (by) {
        for (const key in by) {
          if (key === 'running' || key === 'idle') continue;
          const nE = nt ? nt.lossEurBy[key] || 0 : 0, eur = by[key] - nE;
          if (nE > 0.005) nightBy[key] = (nightBy[key] || 0) + nE;
          if (eur > 0.005) cells[key] = { eur, sec: Math.max(0, (ps[key] || 0) - (perSec > 0 ? nE / perSec : 0)) };
        }
      } else {   // ältere Engine: anteilig nach Zustandszeiten
        const sec = st.stateSec || {}, tot = ORDER.reduce((a, x) => a + (sec[x] || 0), 0);
        for (const x of ORDER) if (sec[x] > 0 && tot > 0) cells[x] = { eur: (st.lossEur || 0) * sec[x] / tot, sec: (st.lossSec || 0) * sec[x] / tot };
      }
      for (const key in cells) { const c = causes[key] || (causes[key] = { key, label: stLabel(key), color: stColor(key), eur: 0, sec: 0 }); c.eur += cells[key].eur; c.sec += cells[key].sec; }
      const night = nt ? nt.lossEur || 0 : 0, nightSec = nt ? nt.lossSec || 0 : 0;
      let nightKey = null; if (nt) for (const key in nt.lossEurBy) if (nt.lossEurBy[key] > 0.005 && (!nightKey || nt.lossEurBy[key] > nt.lossEurBy[nightKey])) nightKey = key;
      rows.push({ id, short: m.short, eur: Math.max(0, (st.lossEur || 0) - night), sec: Math.max(0, (st.lossSec || 0) - nightSec), night, nightSec, nightKey, cells });
    }
    const total = rows.reduce((a, r) => a + r.eur, 0);
    const all = Object.values(causes).sort((a, b) => b.eur - a.eur || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    let cum = 0;
    for (const c of all) { cum += c.eur; c.share = total > 0 ? c.eur / total : 0; c.cum = total > 0 ? Math.min(1, cum / total) : 0; }
    // eine Zahl mit dem Leitstand: Schichtzeit = kpis().lossEurStaffedToday, Nacht = kpis().lossEurNightToday
    const nightTotal = split ? Math.max(0, k.lossEurNightToday || 0) : 0;
    const staffed = range === 'kd'
      ? (split && typeof k.lossEurStaffedToday === 'number' ? k.lossEurStaffedToday : Math.max(0, (k.lossEur != null ? k.lossEur : Math.round(total)) - nightTotal))
      : Math.round(total);
    return { rows, items: all.filter(c => c.eur >= 0.5), total, totalSec: rows.reduce((a, r) => a + r.sec, 0), staffed,
      night: nightTotal >= 0.5 ? nightTotal : 0, nightSec: rows.reduce((a, r) => a + r.nightSec, 0), nightBy };
  }
  /** Werks-Engpass – nur aus WF.sim.bottleneck() (UI_GUIDE Regel 18) */
  function bneck() {
    let b = null; try { b = WF.sim.bottleneck ? WF.sim.bottleneck() : null; } catch (e) { b = null; }
    if (!b || !b.stationId) return null;
    const st = WF.profile.stationById[b.stationId] || {};
    const h = b.workSec != null ? b.workSec / 3600 : null, parts = [];
    if (h != null) parts.push('Vorrat ' + U.fmtNum(h, h < 10 ? 1 : 0) + ' h');
    if (b.late && b.late.length) parts.push(b.late.length === 1 ? b.late[0] + ' gefährdet' : b.late.length + ' Aufträge gefährdet');
    else if (b.orders && b.orders.length) parts.push(b.orders.length === 1 ? 'begrenzt ' + b.orders[0] : 'begrenzt ' + b.orders.length + ' Aufträge');
    return { id: b.stationId, short: b.short || st.short || b.stationId, why: parts.join(' · ') || b.why || '', full: b.why || '' };
  }
  /** Energie: Werk heute = kpis().energyKwh (wie im Leitstand), davon Maschinen = Σ machineView.energyKwhToday-Quelle (kd),
      Rest = Hallen-Grundlast und AGVs */
  function energyModel(k) {
    const rows = [];
    for (const id of machines()) {
      const m = S().machines[id], e = m.kd ? m.kd.energyKwh || 0 : 0, g = m.kd ? m.kd.good || 0 : 0;
      rows.push({ id, short: m.short, kwh: e, good: g, pp: g > 0 ? e / g : null });
    }
    const machinesKwh = rows.reduce((a, r) => a + r.kwh, 0);
    const plant = k && k.energyKwh != null ? k.energyKwh : machinesKwh;
    return { rows: rows.filter(r => r.kwh >= 0.05).sort((a, b) => b.kwh - a.kwh), machines: machinesKwh, plant, base: Math.max(0, plant - machinesKwh) };
  }
  /** OEE-Kachel wie im Leitstand: liefert die Engine die OEE der besetzten Schichten (kpis().oeeStaffedToday) und weicht
      sie vom Tageswert ab (Geisterschicht), zeigt die Kachel die Schichten und weist die Nacht getrennt aus. */
  function oeeModel(k) {
    const has = Object.prototype.hasOwnProperty.call(k, 'oeeStaffedToday');
    const st = has ? k.oeeStaffedToday : undefined;
    const sameV = (a, b) => a != null && b != null && Math.abs(a - b) < 0.0005;
    if (!has || k.oee == null || sameV(k.oee, st)) return { value: k.oee, staffed: false, label: 'OEE heute', apq: k };
    if (st == null) return { value: k.oee, staffed: false, label: 'OEE heute · Nacht', apq: k };
    return { value: st, staffed: true, label: 'OEE heute · Schichten', apq: k.staffedToday || k };
  }

  // ------------------------------------------------------------ Ausstoß-Prognose: Materialfluss-Modell
  /* Die Plantafel (forecast()) plant Termine konservativ (Puffer, autonome Maschinen mit Nachtanteil, Messraum nur für
     vorhandene Behälter) – für eine Stundenprognose der Teile ist sie zu pessimistisch. Darum ein kleines Flussmodell
     direkt aus dem Zustand (nur lesend, ohne Engine-Caches → darf auch beim Schichtbeginn-Ereignis laufen):
     je Maschine eine Warteschlange (laufender Arbeitsgang zuerst, dann Eil → Termin → Auftrag, nur mit Material),
     Rüsten/Erstteil in der Schichtzeit, Bearbeitung mit Plan-Taktzeit (+ Einlegen, + Werkzeugwechsel-Anteil wie die
     Engine), personalgebundene Maschinen nur in der Schichtzeit ohne Pausen, autonome durchgehend. Weitergabe in
     Behältern (transferBatch) mit 10 min Transport, Fremdbearbeitung über Rückkehrzeit bzw. Lieferfenster + Durchlaufzeit,
     Säge mit Zuschnitt-Vorrat ≤ 8 h am Ziel. Neuaufträge (Auftragseingang) sind nicht enthalten. */
  let SHC = null;
  const shifts = () => SHC || (SHC = (WF.profile.shifts || []).map(s => ({ id: s.id, name: s.name, a: U.hm(s.start), b: U.hm(s.end),
    br: (s.breaks || []).map(x => [U.hm(x[0]), U.hm(x[1])]) })));
  /** Arbeitszeit in [a,b): Schichtzeit ohne Pausen, Mo–Fr */
  function workIn(a, b) {
    if (!(b > a)) return 0;
    let sum = 0;
    for (let d = Math.floor(a / 86400); d * 86400 < b; d++) {
      if ((((d % 7) + 7) % 7) >= 5) continue;
      for (const s of shifts()) {
        let x = s.a;
        for (let j = 0; j <= s.br.length; j++) {
          const p = x, r = j < s.br.length ? s.br[j][0] : s.b;
          if (j < s.br.length) x = s.br[j][1];
          const lo = Math.max(a, d * 86400 + p), hi = Math.min(b, d * 86400 + r);
          if (hi > lo) sum += hi - lo;
        }
      }
    }
    return sum;
  }
  const inDayWin = (t) => { const d = ((Math.floor(t / 86400) % 7) + 7) % 7, s = t - Math.floor(t / 86400) * 86400; return d < 5 && s >= 6 * 3600 && s < 20 * 3600; };
  const nextDayWin = (t) => { if (inDayWin(t)) return t; let d = Math.floor(t / 86400); const s = t - d * 86400; if (((d % 7) + 7) % 7 < 5 && s < 6 * 3600) return d * 86400 + 23400; d++; while (((d % 7) + 7) % 7 >= 5) d++; return d * 86400 + 23400; };
  const FLOW_DT = 300, FLOW_TR = 600;
  /** Teile je Stunde (Index 0–23 des Tages d0), die in [from, until) an Bearbeitungs-, Wasch-, Prüf- und Montageplätzen
      fertig werden (wie kpis().good: Fremdbearbeitung und Versand zählen nicht) – vor Ausschuss */
  function flowHours(Sx, from, until, d0) {
    const out = new Array(24).fill(0);
    if (!Sx || !Sx.orders || !(until > from)) return out;
    const TT = WF.profile.toolTypeById || {};
    const idx = {}, ops = [], byStation = {};
    for (const oid in Sx.orders) {
      const o = Sx.orders[oid]; if (!o || o.status === 'fertig' || !o.routing) continue;
      let prev = null;
      for (let i = 0; i < o.routing.length; i++) {
        const r = o.routing[i], op = o.ops[i] || {}, m = Sx.machines[r.station], ext = r.station === 'EXT';
        const pl = WF.sim.partsLeft ? WF.sim.partsLeft(oid, r.seq) : 0;
        const left = Math.max(0, pl || 0) + (ext ? 0 : (op.inProc || 0));
        const n = { o, i, r, m, sid: r.station, ext, prev, next: null, left, inQ: i === 0 ? Infinity : 0, pipe: [], pq: 0, fill: 0,
          done: !!op.complete || left <= 1e-9, setupRem: 0, cyc: 60, auto: false, tb: Math.max(1, r.transferBatch || 10), held: -1,
          rel: i > 0 && !(r.setupMin > 10) && !r.firstPiece, k0: o.priority === 'eil' ? 0 : 1 };
        if (m) {
          let allow = 0;
          for (const tl of r.tools || []) { const tt = TT[tl.type]; if (tt && tt.lifeMin) allow += (tl.cutMinPerPart / tt.lifeMin) * 300; }
          n.cyc = Math.max(1, (r.cycleMin || 1) * 60 + (m.loading === 'perPart' ? ((r.loadMin != null ? r.loadMin : m.loadMin) || 1) * 60 : 0) + allow);
          n.auto = m.loading === 'auto';
          n.setupRem = (r.setupMin || 0) * 60 + (r.firstPiece ? 1800 : 0);
        }
        if (prev) prev.next = n;
        idx[oid + '/' + i] = n;
        if (!n.done) { ops.push(n); if (m) (byStation[n.sid] || (byStation[n.sid] = [])).push(n); }
        prev = n;
      }
    }
    const pushQ = (n, t, q) => { if (n && q > 1e-9) { n.pipe.push([t, q]); n.pq += q; } };
    // Bestände: Eingang (jetzt), abholbereit/unterwegs (+ Transport), Ausgangsbehälter in Füllung, beim Fremdbearbeiter
    for (const cid in Sx.containers) {
      const c = Sx.containers[cid]; if (!c || c.kind === 'scrap') continue;
      const tgt = idx[c.orderId + '/' + c.idx]; if (!tgt) continue;
      if (c.state === 'external') { const rt = c.location && c.location.returnT != null ? c.location.returnT : from; pushQ(tgt.next, Math.max(from, rt) + FLOW_TR, c.qty); continue; }
      if (tgt.done) continue;
      if (c.state === 'input') { if (tgt.inQ !== Infinity) tgt.inQ += c.qty; }
      else if (c.state === 'ready' || c.state === 'transit') pushQ(tgt, from + FLOW_TR, c.qty);
      else if (c.state === 'filling') { const src = idx[c.orderId + '/' + (c.idx - 1)]; if (src && !src.done) src.fill += c.qty; else pushQ(tgt, from + FLOW_TR, c.qty); }
    }
    const mach = {};
    for (const sid in byStation) {
      const m = Sx.machines[sid], list = byStation[sid];
      list.sort((a, b) => a.k0 - b.k0 || a.o.due - b.o.due || (a.o.id < b.o.id ? -1 : a.o.id > b.o.id ? 1 : a.i - b.i));
      const M = mach[sid] = { m, cur: null, down: from };
      if (m.op) {
        const n = idx[m.op.oid + '/' + m.op.idx];
        if (n && !n.done) {
          M.cur = n;
          n.setupRem = m.setupDone ? 0 : (m.setupRun ? Math.max(0, m.setupRun.dur - (from - m.setupRun.t0)) : (n.r.setupMin || 0) * 60);
          if (n.r.firstPiece && !m.released) n.setupRem += m.fpi ? 900 : 1800;
          if (n.inQ !== Infinity) n.inQ += n.o.ops[n.i].inProc || 0;     // eingelegte Teile sind schon am Platz
          if (m.fault) M.down = Math.max(M.down, from + (m.fault.repairSec || 0) + 300);
        }
      }
    }
    // „Rüsten vorab“: Material ist unterwegs oder der Vorgänger arbeitet gerade daran
    const coming = (n) => n.inQ > 1e-6 || n.pq > 1e-6 || (n.prev && !n.prev.done && (n.prev.ext || (mach[n.prev.sid] && mach[n.prev.sid].cur === n.prev)));
    for (let t = from; t < until; t += FLOW_DT) {
      const t1 = Math.min(until, t + FLOW_DT), span = t1 - t, wFull = workIn(t, t1);
      const hOut = Math.floor((t1 - 1 - d0) / 3600);
      for (const n of ops) if (n.pq > 1e-9) {
        let keep = null;
        for (const p of n.pipe) { if (p[0] <= t1) { if (n.inQ !== Infinity) n.inQ += p[1]; n.pq -= p[1]; } else (keep || (keep = [])).push(p); }
        n.pipe = keep || []; if (!n.pipe.length) n.pq = 0;
      }
      // Fremdbearbeitung: Los versenden (Lieferfenster), Rückkehr nach Durchlaufzeit
      for (const n of ops) if (n.ext && !n.done && n.inQ > 1e-6) {
        if (n.inQ >= Math.min(n.tb, n.left) - 1e-6 || (n.prev && n.prev.done)) {
          const ship = nextDayWin(t1 + 1200), lead = ((n.r.ext && n.r.ext.leadMin) || 480) * 60;
          pushQ(n.next, nextDayWin(ship + lead) + FLOW_TR, n.inQ);
          n.left -= n.inQ; n.inQ = 0; if (n.left <= 1e-6) n.done = true;
        }
      }
      for (const sid in mach) {
        const M = mach[sid], list = byStation[sid];
        let frac = M.down >= t1 ? 0 : M.down > t ? (t1 - M.down) / span : 1;
        for (let guard = 0; frac > 1e-6 && guard < 12; guard++) {
          let n = M.cur;
          // Vorgänger fertig und nichts mehr unterwegs → Arbeitsgang abgeschlossen (Ausschuss unterwegs fehlt am Ende)
          if (n && !n.done && n.prev && n.prev.done && n.inQ <= 1e-6 && n.pq <= 1e-9 && n.prev.fill <= 1e-6) n.done = true;
          if (!n || n.done) {
            n = null;
            for (const x of list) if (!x.done && x.inQ > 1e-6 && x.held !== t1) { n = x; break; }
            if (!n) for (const x of list) if (!x.done && !x.rel && x.held !== t1 && coming(x)) { n = x; break; }
            M.cur = n;
            if (!n) break;
          }
          if (n.setupRem > 0) {   // Rüsten / Erstteil nur mit Personal (Schichtzeit ohne Pausen)
            const w = wFull * frac;
            if (w <= 0) break;
            const use = Math.min(w, n.setupRem);
            n.setupRem -= use; frac -= frac * use / w;
            continue;
          }
          const cap = (n.auto ? span : wFull) * frac / n.cyc;
          if (cap <= 1e-9) break;
          let room = Infinity;
          if (n.i === 0 && M.m.type === 'saw' && n.next && n.next.m) {   // Zuschnitt-Vorrat am Ziel ≤ 8 h Arbeit
            let wc = 0;
            for (const x of byStation[n.next.sid] || []) if (!x.done) wc += ((x.inQ === Infinity ? 0 : x.inQ) + x.pq + (x.prev ? x.prev.fill : 0)) * (x.r.cycleMin || 1) * 60;
            room = Math.max(0, (8 * 3600 - wc) / ((n.next.r.cycleMin || 1) * 60)) + 1e-6;
          }
          const q = Math.max(0, Math.min(cap, n.left, n.inQ, room));
          if (q > 1e-9) {
            n.left -= q; if (n.inQ !== Infinity) n.inQ -= q;
            if (hOut >= 0 && hOut < 24) out[hOut] += q;
            if (n.next) {
              n.fill += q;
              while (n.fill >= n.tb - 1e-6) { pushQ(n.next, t1 + FLOW_TR, n.tb); n.fill -= n.tb; }
              if (n.left <= 1e-6 && n.fill > 1e-6) { pushQ(n.next, t1 + FLOW_TR, n.fill); n.fill = 0; }
            }
          }
          frac -= frac * q / cap;
          if (n.left <= 1e-6) { n.done = true; M.cur = null; continue; }
          if (frac <= 1e-6) break;
          // kein Material (Waschen, Messraum, Montage geben den Platz frei) bzw. Zuschnitt-Vorrat voll → anderen Auftrag vorziehen
          if (n.rel || q >= room - 1e-6) {
            M.cur = null; n.held = t1;
            const other = list.find(x => x !== n && !x.done && x.inQ > 1e-6 && x.held !== t1 && (n.rel || !((x.r.setupMin || 0) > 15)));
            if (!other) break;
            M.cur = other;
          } else break;
        }
      }
    }
    return out;
  }
  /** Ausbeute für Gutteile: FPY von heute (ab 50 Teilen), sonst 99 % */
  const fpyOf = (today) => { const g = (today && today.good) || 0, s = (today && today.scrap) || 0; return g + s >= 50 ? g / (g + s) : 0.99; };

  /** Tagesplan: einmal je Tag zum Schichtbeginn eingefroren (06:00; beim Start/Neustart aus dem Zustand um 06:00, also vor
      dem Vorrechnen bis 08:40) – Bezug für „Ist gegen Plan“. Gleiches Modell wie die Prognose → Abweichungen sind echte Verluste. */
  function capturePlan(label) {
    const Sx = S(); if (!Sx || !Sx.orders || !Sx.today) return;
    const t = Sx.t, d0 = U.dayStart(t), q = fpyOf(Sx.today);
    plan = { day: d0, t, base: Sx.today.good || 0, hours: flowHours(Sx, t, d0 + 22 * 3600, d0).map(v => v * q), how: label || 'Schichtbeginn' };
    slowKey = '';
  }
  let fcCache = null;
  WF.bus.on('sim:event', (e) => {
    if (!e) return;
    try {
      if (e.type === 'reset') { plan = null; fcCache = null; capturePlan('Start'); }
      else if (e.type === 'shift' && e.data && e.data.to && !e.data.from && (!plan || plan.day !== U.dayStart(e.t))) capturePlan('Schichtbeginn');
      // Aufträge, die zum Schichtbeginn freigegeben werden, gehören noch zum Tagesplan „Stand 06:00“
      else if (e.type === 'orderIntake' && plan && plan.day === U.dayStart(e.t) && e.t - plan.t <= 60) capturePlan(plan.how);
    } catch (err) { plan = null; }
  });
  /** Prognose ab jetzt (zwischengespeichert, höchstens alle 5 Sim-Minuten neu – der Rest der laufenden Stunde wird anteilig gekürzt) */
  function outputForecast(now, d0, fpy) {
    const Sx = S();
    if (!fcCache || fcCache.day !== d0 || now < fcCache.t || now - fcCache.t >= 300 || fcCache.n !== Object.keys(Sx.orders).length) {
      fcCache = { t: now, day: d0, n: Object.keys(Sx.orders).length, hours: flowHours(Sx, now, d0 + 22 * 3600, d0) };
    }
    const h = fcCache.hours.map(v => v * fpy), hNow = Math.floor((now - d0) / 3600), hEnd = d0 + (hNow + 1) * 3600;
    if (now > fcCache.t && hNow >= 0 && hNow < 24) h[hNow] *= Math.max(0, (hEnd - now) / Math.max(1, hEnd - fcCache.t));
    return h;
  }
  /** für Copilot/Tests: Tagesplan und Ausstoß-Prognose (Arbeitsgänge gut je Stunde) */
  WF.analyse = {
    dayPlan: () => (plan ? { day: plan.day, t: plan.t, base: plan.base, hours: plan.hours.slice() } : null),
    outputForecast: () => { const Sx = S(); if (!Sx) return null; const d0 = U.dayStart(Sx.t), k = WF.sim.kpis(); const h = outputForecast(Sx.t, d0, k.fpy || 1); let c = k.good || 0; for (let x = Math.floor((Sx.t - d0) / 3600); x < 22; x++) c += Math.max(0, h[x] || 0); return { t: Sx.t, good: k.good, hours: h, endOfDay: Math.round(c) }; },
  };

  // ------------------------------------------------------------ Kennzahlen
  function renderKpis(k, L) {
    const b = bneckCache, top = L.items[0];
    const ghost = range === 'ks' && WF.sim.shift && !WF.sim.shift().id;
    const M = range === 'ks' ? { value: k.oeeShift, staffed: false, label: 'OEE ' + (ghost ? 'Geisterschicht' : 'laufende Schicht'), apq: null } : oeeModel(k);
    const oee = M.value, warn = oee != null && oee < TARGET_OEE;
    const E = energyModel(k), pr = price();
    // Energie je Fertigteil: Werk-Energie (= Leitstand „Energie heute“) ÷ fertige Teile (= Leitstand „Fertige Teile heute“)
    const perPart = k.goodFinished > 0 && E.plant > 0 ? E.plant / k.goodFinished : null;
    const gn = k.ghostLastNight;
    let oeeS;
    if (range === 'ks') oeeS = `Ziel ${pct0(TARGET_OEE)} · ${ghost ? 'nur autonome Maschinen' : 'seit Schichtbeginn'}`;
    else {
      const a = M.apq || k;
      oeeS = `Ziel ${pct0(TARGET_OEE)} · V ${pct1(a.availability)} × L ${pct1(a.performance)} × Q ${pct1(a.quality)}`;
      if (M.staffed) oeeS += `<br>${gn && gn.oee != null ? `Nacht (Geisterschicht) ${pct1(gn.oee)}` : `inkl. Geisterschicht ${pct1(k.oee)}`}`;
    }
    const lossTop = top ? `größte Ursache <b style="color:var(--text2)">${esc(top.label)}</b> · ${U.fmtEur(top.eur)} (${pct0(top.share)})` : 'kein Stillstand mit eingeplantem Auftrag';
    const lossS = L.night > 0 ? `${lossTop}<br>zzgl. Nacht (Geisterschicht) <b style="color:var(--text2)">${U.fmtEur(L.night)}</b>` : lossTop;
    const struct = [range, b ? b.id : '', warn ? 'w' : '', M.label].join('|');
    paint('kpis', q('[data-s="kpis"]'), struct, (T) => `
      <div class="kpi" title="Maschinenstundensatz × Zeit, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Rüsten, Warten, Störung) – ${range === 'ks' ? 'laufende Schicht' : 'Schichtzeit heute, gleiche Zahl wie im Leitstand; die Nacht (Geisterschicht) ist getrennt ausgewiesen'}">
        <div class="l">Stillstandskosten ${range === 'ks' ? (ghost ? 'Geisterschicht' : 'Schicht') : 'heute'}</div>
        ${T('lv', `${U.fmtNum(L.staffed)}<small>€</small>`, 'div', 'class="v"')}
        ${T('ls', lossS, 'div', 'class="s"')}
      </div>
      <div class="kpi${warn ? ' warn' : ''}" title="OEE = Verfügbarkeit × Leistung × Qualität der Bearbeitungsmaschinen – gleiche Zahl wie im Leitstand${M.staffed ? '; besetzte Schichten, die Geisterschicht zählt getrennt' : ''}">
        <div class="l">${esc(M.label)}</div>
        ${T('ov', oee == null ? '–' : `${U.fmtNum(oee * 100, 1)}<small>%</small>`, 'div', 'class="v"')}
        ${T('os', oeeS, 'div', 'class="s"')}
      </div>
      <div class="kpi${b ? ' an-click' : ''}"${b ? ` data-id="${esc(b.id)}" title="${esc(b.full || 'Werks-Engpass')} – Klick öffnet die Maschine"` : ''}>
        <div class="l">Werks-Engpass</div>
        <div class="v">${b ? `${esc(b.id)}<small>${esc(b.short)}</small>` : '–'}</div>
        ${T('bs', b ? esc(b.why) : 'kein Werks-Engpass erkennbar', 'div', 'class="s"')}
      </div>
      <div class="kpi" title="Energie des Werks heute (Maschinen, Grundlast, AGVs – wie im Leitstand) je fertigem Teil (Gutteile des letzten Bearbeitungsschritts je Auftrag)">
        <div class="l">Energie je Fertigteil</div>
        ${T('ev', perPart != null ? `${kwh(perPart)}<small>kWh</small>` : '–', 'div', 'class="v"')}
        ${T('es', nb(`${pr && perPart != null ? `≈ ${U.fmtEur(perPart * pr, 2)} je Teil · ` : ''}Werk ${U.fmtNum(E.plant)} kWh<br>${U.fmtNum(k.goodFinished)} fertige Teile heute`), 'div', 'class="s"')}
      </div>`);
  }

  // ------------------------------------------------------------ Held: Wo verlieren wir Geld?
  const NIGHT_RECO = 'Autonome Maschinen standen ohne Personal. Im Geisterschicht-Check vor Schichtende Werkzeuge vorbeugend wechseln und Stangen nachladen – dann laufen sie bis zum Morgen durch.';
  function renderHero(L) {
    const items = L.items, N = items.length, night = L.night > 0;
    const recos = items.slice(0, night ? 2 : 3).map(it => {
      const worst = L.rows.filter(r => r.cells[it.key]).sort((a, b) => b.cells[it.key].eur - a.cells[it.key].eur)[0] || null;
      return { it, worst };
    });
    const nRows = night ? L.rows.filter(r => r.night >= 0.5).sort((a, b) => b.night - a.night) : [];
    const struct = [range, items.map(i => i.key).join(','), recos.map(r => r.worst ? r.worst.id : '').join(','), nRows.map(r => r.id + (r.nightKey || '')).join(',')].join('|');
    const ghost = range === 'ks' && WF.sim.shift && !WF.sim.shift().id;
    const when = range === 'ks' ? (ghost ? 'in dieser Geisterschicht' : 'in dieser Schicht') : night ? 'heute in der Schichtzeit' : 'heute';
    // Aussage: größte Ursache + wie viele Ursachen 80 % erklären
    let ins = '';
    if (N) {
      const top = items[0];
      const k80 = items.findIndex(x => x.cum >= 0.8) + 1 || N;
      const more = items.slice(1, Math.max(2, k80));
      ins = `<b>${esc(top.label)}</b> kostet ${when} <strong>${U.fmtEur(top.eur)}</strong> – ${pct0(top.share)} der Stillstandskosten.` +
        (more.length && k80 > 1 ? ` Zusammen mit ${more.map(x => esc(x.label)).join(more.length > 1 ? ', ' : '').replace(/, ([^,]*)$/, ' und $1')} sind es <strong>${pct0(items[k80 - 1].cum)}</strong>.` : '');
    }
    const ax = [0, 0.25, 0.5, 0.75, 1];
    ins = nb(ins);
    const head = range === 'kd' && night ? 'Schichtzeit heute' : range === 'ks' ? (ghost ? 'Geisterschicht' : 'laufende Schicht') : 'heute';
    paint('hero', q('[data-s="hero"]'), struct, (T, W, C, A) => { const nb2 = night ? nightHtml(T, L, nRows) : ''; return `
      <div class="card-h an-ch"><h3>Wo verlieren wir Geld?</h3>${T('hs', `Stillstandskosten nach Ursache · ${head} · <b style="color:var(--text2)">${U.fmtEur(L.staffed)}</b> in ${U.fmtDur(L.totalSec)}`, 'span', 'class="muted"')}</div>
      <div class="an-hb">
        <div class="an-hl">
          ${N ? `${T('ins', ins, 'p', 'class="an-ins"')}
          <div class="an-par" role="img" aria-label="Stillstandskosten nach Ursache, absteigend, mit kumuliertem Anteil">
            <span class="axh c1" style="grid-column:1">Ursache</span>
            <div class="ax">${ax.map(v => `<span${v === 0.25 || v === 0.75 ? ' class="q"' : ''} style="left:${v * 100}%">${v * 100} %</span>`).join('')}</div>
            <span class="axh c3" style="grid-column:3">€</span><span class="axh c4" style="grid-column:4">Zeit · kumuliert</span>
            <div class="gr" style="grid-row:2 / span ${N}">${ax.slice(1).map(v => `<b style="left:${v * 100}%"></b>`).join('')}</div>
            ${items.map((it, i) => {
              const tipTxt = `${it.label}: ${U.fmtEur(it.eur)} in ${U.fmtDur(it.sec)} geplanter Maschinenzeit${night ? ' (Schichtzeit)' : ''} – ${pct0(it.share)} der Stillstandskosten, kumuliert ${pct0(it.cum)}`;
              return `<span class="pl" style="grid-row:${i + 2}" ${A('pl' + it.key, tipTxt)}><i style="background:${it.color}"></i><span>${hy(esc(it.label))}</span></span>
              <span class="pb" style="grid-row:${i + 2};--c:${it.color}" ${A('pb' + it.key, tipTxt)}><i ${W('b' + it.key, it.share)}></i></span>
              ${T('v' + it.key, U.fmtEur(it.eur), 'span', `class="pv" style="grid-row:${i + 2}"`)}
              ${T('m' + it.key, `${U.fmtDur(it.sec)} · ${pct0(it.cum)}`, 'span', `class="pm" style="grid-row:${i + 2}"`)}`;
            }).join('')}
            ${T('cum', cumHtml(items), 'div', `class="cum" style="grid-row:2 / span ${N}"`)}
          </div>
          <div class="an-plg"><span><i class="b"></i>Anteil je Ursache</span><span><i class="c"></i>kumulierter Anteil</span><span>€ = Stundensatz × geplante Zeit ohne Produktion</span></div>`
          : `<div class="empty">Noch keine Stillstandskosten ${when} – alle Maschinen mit Auftrag produzieren.</div>`}
          ${nb2}
        </div>
        <div class="an-hr">
          <div class="an-rh"><h4>Was jetzt hilft</h4><span>aus den größten Posten</span></div>
          ${recos.length ? recos.map(({ it, worst }, n) => `
            <div class="an-rc" style="--c:${it.color}">
              <div class="h"><span class="an-rk">${n + 1}</span><b>${esc(it.label)}</b>${T('re' + it.key, U.fmtEur(it.eur), 'span', 'class="e"')}</div>
              <p>${esc(RECO[it.key] || 'Ursache im Copilot analysieren.')}</p>
              <div class="acts">${worst ? `<span class="muted">größter Posten <button class="link" data-id="${esc(worst.id)}">${esc(worst.short)}</button> · ${T('rw' + it.key, recoWorst(it, worst), 'span')}</span>` : '<span></span>'}${WF.ai && worst ? `<button class="btn sm ghost" data-ask="${esc(it.label)}|${esc(worst.id)}">${icon('sparkles', 14)} Analysieren</button>` : ''}</div>
            </div>`).join('') : night ? '' : '<div class="empty">Keine nennenswerten Verluste – die Schicht läuft rund.</div>'}
          ${night ? `
            <div class="an-rc night">
              <div class="h"><span class="an-rk">${recos.length + 1}</span><b>Nacht (Geisterschicht)</b>${T('reN', U.fmtEur(L.night), 'span', 'class="e"')}</div>
              <p>${esc(NIGHT_RECO)}</p>
              <div class="acts">${nRows[0] ? `<span class="muted">größter Posten <button class="link" data-id="${esc(nRows[0].id)}">${esc(nRows[0].short)}</button> · ${T('rwN', `<b>${U.fmtEur(nRows[0].night)}</b> · ${U.fmtDur(nRows[0].nightSec)}`, 'span')}</span>` : '<span></span>'}${WF.ai && nRows[0] ? `<button class="btn sm ghost" data-ask="Nacht (Geisterschicht)|${esc(nRows[0].id)}">${icon('sparkles', 14)} Analysieren</button>` : ''}</div>
            </div>` : ''}
        </div>
      </div>`; });
  }
  /** Nacht (Geisterschicht): eigener, schraffierter Posten unter dem Pareto – Summe = kpis().lossEurNightToday */
  function nightHtml(T, L, nRows) {
    return `
          <div class="an-nt" title="Geisterschicht: ohne Personal sollen nur autonome Maschinen laufen – ihr Stillstand ist ungenutzte Kapazität und wird getrennt von der Schichtzeit ausgewiesen (gleiche Zahl wie im Leitstand)">
            <div class="h"><i class="an-hatch"></i><span class="t">Nacht (Geisterschicht)${T('nt', `getrennt ausgewiesen · ${U.fmtDur(L.nightSec)} Stillstand`, 'span')}</span>${T('nv', U.fmtEur(L.night), 'b')}</div>
            <div class="ms">${nRows.map(r => `<button data-id="${esc(r.id)}" title="${esc(r.short)} öffnen">${esc(r.short)}${r.nightKey ? ' · ' + esc(stLabel(r.nightKey)) : ''}${T('nm' + r.id, U.fmtEur(r.night), 'b')}</button>`).join('')}</div>
            <p>Autonome Maschinen mit eingeplantem Auftrag, die ohne Personal standen – nicht in den Ursachen oben enthalten.</p>
          </div>`;
  }
  const recoWorst = (it, w) => `<b>${U.fmtEur(w.cells[it.key].eur)}</b> · ${U.fmtDur(w.cells[it.key].sec)}`;
  /** kumulierte Linie über den Balken (gleiche Skala 0–100 %), je Zeile ein Punkt */
  function cumHtml(items) {
    const N = items.length, h = N * 40;
    const pts = items.map((it, i) => `${(it.cum * 100).toFixed(2)},${i * 40 + 20}`).join(' ');
    return `<svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" style="fill:none;stroke:var(--text2)" stroke-width="1.5" stroke-opacity=".7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>` +
      items.map((it, i) => `<span style="left:${(it.cum * 100).toFixed(2)}%;top:${i * 40 + 20}px"></span>`).join('');
  }

  // ------------------------------------------------------------ Verlustmatrix
  function renderMatrix(L) {
    const cols = L.items;   // Spalten = Ursachen in Pareto-Reihenfolge (größte zuerst), Schichtzeit
    const night = L.night > 0;
    const tot = (r) => r.eur + (night ? r.night : 0);
    const rows = L.rows.filter(r => tot(r) >= 0.5).sort((a, b) => tot(b) - tot(a));
    const none = L.rows.filter(r => tot(r) < 0.5).map(r => r.short);
    const max = Math.max(1, ...rows.flatMap(r => cols.map(c => r.cells[c.key] ? r.cells[c.key].eur : 0)));
    const step = niceStep(max / 5);           // 5 Stufen, lineare €-Klassen
    const lvl = (v) => Math.min(4, Math.floor(v / step));
    const maxRow = Math.max(1, ...rows.map(tot));
    const nz = rows.map(r => cols.filter(c => r.cells[c.key] && r.cells[c.key].eur >= 0.5).map(c => c.key).join('+') + (night && r.night >= 0.5 ? '+N' : '')).join(',');
    const struct = [range, cols.map(c => c.key).join(','), rows.map(r => r.id).join(','), nz, step, night ? 'N' : ''].join('|');
    const when = range === 'ks' ? 'laufende Schicht' : 'heute';
    const legend = [0, 1, 2, 3, 4].map(i => `<span class="k"><i class="an-h${i}"></i>${i < 4 ? (i === 0 ? '< ' + U.fmtNum(step) : U.fmtNum(i * step) + '–' + U.fmtNum((i + 1) * step)) : '≥ ' + U.fmtNum(4 * step)}</span>`).join('') +
      (night ? '<span class="k"><i class="an-hn" style="background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--text2) 30%,var(--card2)) 0 3px,var(--card2) 3px 7px)"></i>Nacht</span>' : '');
    paint('matrix', q('[data-s="matrix"]'), struct, (T, W, C, A) => {
      const cell = (r, c) => {
        const x = r.cells[c.key], v = x ? x.eur : 0, key = r.id + c.key;
        const tipTxt = x ? `${r.short} · ${c.label}${night ? ' (Schichtzeit)' : ''}: ${U.fmtEur(v)} (${U.fmtDur(x.sec)})` : `${r.short} · ${c.label}: kein Stillstand`;
        return `<td ${C('mc' + key, v >= 0.5 ? 'an-h' + lvl(v) : 'z')} ${A('mt' + key, tipTxt)}>${T('mv' + key, v >= 0.5 ? U.fmtNum(v) : '·')}</td>`;
      };
      const nCell = (r) => {
        const v = r.night, tipTxt = v >= 0.5 ? `${r.short} · Nacht (Geisterschicht): ${U.fmtEur(v)} (${U.fmtDur(r.nightSec)})${r.nightKey ? ' – meist ' + stLabel(r.nightKey) : ''}` : `${r.short} · Nacht: kein Stillstand`;
        return `<td ${C('mn' + r.id, v >= 0.5 ? 'an-hn' : 'z')} ${A('mtn' + r.id, tipTxt)}>${T('mnv' + r.id, v >= 0.5 ? U.fmtNum(v) : '·')}</td>`;
      };
      const nc = cols.length + (night ? 1 : 0);
      const minW = 140 + nc * 92 + 160;
      return `
      <div class="card-h an-ch"><h3>Verlustmatrix Maschine × Ursache</h3><div class="an-lg"><span class="t">€ je Zelle</span>${legend}</div></div>
      <div class="card-b">${rows.length && (cols.length || night) ? `
        <div class="an-mx-wrap"><table class="an-mx" style="min-width:${minW}px">
          <colgroup><col style="width:140px">${cols.map(() => '<col>').join('')}${night ? '<col>' : ''}<col style="width:160px"></colgroup>
          <thead><tr><th class="m">Maschine</th>${cols.map(c => `<th title="${esc(c.label)}${night ? ' – Schichtzeit' : ''}">${hy(esc(c.label))}</th>`).join('')}${night ? '<th class="n" title="Nacht (Geisterschicht) – getrennt von der Schichtzeit">Nacht (Geister­schicht)</th>' : ''}<th class="s">Summe</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td class="m" data-id="${esc(r.id)}" title="${esc(r.short)} öffnen">${esc(r.short)}</td>${cols.map(c => cell(r, c)).join('')}${night ? nCell(r) : ''}
            <td class="s"><span class="an-sb"><span class="tr"><i ${W('ms' + r.id, tot(r) / maxRow)}></i></span>${T('mS' + r.id, U.fmtEur(tot(r)), 'b')}</span></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="an-ml">${rows.map(r => `<div class="r" data-id="${esc(r.id)}">
            <div class="t"><span>${esc(r.short)}</span><span class="an-sb"><span class="tr"><i ${W('ls' + r.id, tot(r) / maxRow)}></i></span>${T('lS' + r.id, U.fmtEur(tot(r)), 'b')}</span></div>
            <div class="cs">${cols.filter(c => r.cells[c.key] && r.cells[c.key].eur >= 0.5).map(c => { const v = r.cells[c.key].eur; return `<span ${C('lc' + r.id + c.key, 'an-h' + lvl(v))}>${esc(c.label)} ${T('lv' + r.id + c.key, U.fmtEur(v), 'b')}</span>`; }).join('')}${night && r.night >= 0.5 ? `<span class="an-hn">Nacht ${T('lvN' + r.id, U.fmtEur(r.night), 'b')}</span>` : ''}</div>
          </div>`).join('')}</div>
        <div class="an-mfoot">${night ? `Ursachen = Schichtzeit · Nacht (Geisterschicht) getrennt · Summe = ganzer Tag (${U.fmtEur(L.staffed + L.night)})` : ''}${none.length ? `${night ? ' · ' : ''}Ohne Stillstandskosten ${when}: ${esc(none.join(', '))}` : ''}</div>`
        : `<div class="empty">Noch keine Stillstandskosten ${when}.</div>`}</div>`;
    });
  }

  // ------------------------------------------------------------ Ausstoß im Tagesverlauf
  function renderFlow(k) {
    const host = q('[data-s="flow"]'); if (!host) return;
    const Sx = S(), now = Sx.t, d0 = U.dayStart(now), w0 = d0 + 6 * 3600, w1 = d0 + 22 * 3600, H = Sx.history;
    const hNow = Math.floor((now - d0) / 3600);
    // Ist: 5-min-Werte der Engine, laufendes Intervall aus dem Tageszähler (kpis().good) → Endpunkt exakt
    const act = new Array(24).fill(0), cumPts = [[d0, 0]];
    let cum = 0;
    for (let i = 0; i < H.t.length; i++) {
      const t = H.t[i]; if (t <= d0 || t > now) continue;
      const g = H.good[i] || 0; act[Math.min(23, Math.floor((t - 1 - d0) / 3600))] += g; cum += g; cumPts.push([t, cum]);
    }
    const good = k.good || 0;
    if (good > cum) act[Math.min(23, hNow)] += good - cum;
    cumPts.push([now, good]);
    // Prognose ab jetzt (Materialfluss-Modell der bekannten Aufträge), Gutteile = Teile × FPY
    const fpy = k.fpy || 1, fcH = now < w1 ? outputForecast(now, d0, fpy) : new Array(24).fill(0);
    const fcPts = [[now, good]]; let c = good;
    for (let h = hNow; h < 22; h++) { const hb = d0 + (h + 1) * 3600; c += fcH[h] || 0; if (hb > now) fcPts.push([hb, c]); }
    const fcEnd = now < w1 ? c : null;
    // Plan (eingefroren) – nur für heute
    const P = plan && plan.day === d0 ? plan : null;
    let planPts = null, planEnd = null, planNow = null;
    if (P) {
      planPts = [[P.t, P.base]]; let pc = P.base;
      const hp = Math.floor((P.t - d0) / 3600);
      for (let h = hp; h < 22; h++) {
        const ha = Math.max(P.t, d0 + h * 3600), hb = d0 + (h + 1) * 3600, v = P.hours[h] || 0;
        if (now > ha && now <= hb) planNow = pc + v * (now - ha) / (hb - ha);
        pc += v; planPts.push([hb, pc]);
      }
      planEnd = pc;
      if (now <= P.t) planNow = P.base; else if (planNow == null) planNow = now >= w1 ? pc : P.base;
    }
    // Geometrie in Pixeln des Containers (Schrift bleibt auf jedem Gerät 10,5 px+)
    const Wd = Math.max(300, Math.round(flowW || 640)), narrow = Wd < 560;
    const padL = narrow ? 34 : 44, padR = narrow ? 44 : 60, top = 22, h1 = narrow ? 118 : 150, gap = 26, h2 = narrow ? 76 : 96, xl = 20;
    const Ht = top + h1 + gap + h2 + xl, plotW = Wd - padL - padR;
    const X = (t) => padL + (t - w0) / (w1 - w0) * plotW;
    const ax1 = niceAxis(Math.max(10, good, fcEnd || 0, planEnd || 0), narrow ? 4 : 5), s1 = ax1.step, m1 = ax1.max;
    const barVal = (h) => h < hNow ? act[h] : h === hNow ? act[h] + (fcH[h] || 0) : (fcH[h] || 0);
    // Plan je Stunde (nur volle Stunden ab dem Einfrieren)
    const planH = (h) => (P && d0 + h * 3600 >= P.t - 1 ? P.hours[h] || 0 : null);
    let m2v = 10; for (let h = 6; h < 22; h++) m2v = Math.max(m2v, barVal(h), planH(h) || 0);
    const ax2 = niceAxis(m2v, 2), s2 = ax2.step, m2 = ax2.max;
    const Y1 = (v) => top + h1 * (1 - v / m1), b2 = top + h1 + gap + h2, Y2 = (v) => b2 - h2 * v / m2;
    const f = (n) => n.toFixed(1);
    let g = `<defs><clipPath id="an-clip"><rect x="${padL}" y="0" width="${plotW}" height="${Ht}"/></clipPath></defs>`;
    // laufende Schicht hervorheben (Zeitraum „Laufende Schicht“)
    const sh = WF.sim.shift ? WF.sim.shift() : null;
    if (range === 'ks' && sh && sh.id) {
      const sd = shifts().find(x => x.id === sh.id);
      if (sd) g += `<rect x="${f(X(d0 + sd.a))}" y="${top}" width="${f(X(d0 + sd.b) - X(d0 + sd.a))}" height="${b2 - top}" style="fill:var(--raise)" opacity=".28"/>`;
    }
    // Raster + Achsen
    for (let v = 0; v <= m1 + 1e-6; v += s1) g += `<line class="grid" x1="${padL}" x2="${Wd - padR}" y1="${f(Y1(v))}" y2="${f(Y1(v))}"/><text x="${padL - 7}" y="${f(Y1(v) + 3.5)}" text-anchor="end">${U.fmtNum(v)}</text>`;
    for (let v = 0; v <= m2 + 1e-6; v += s2) g += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${padL}" x2="${Wd - padR}" y1="${f(Y2(v))}" y2="${f(Y2(v))}"/><text x="${padL - 7}" y="${f(Y2(v) + 3.5)}" text-anchor="end">${U.fmtNum(v)}</text>`;
    g += `<text class="ey" x="${padL + 6}" y="${top + 13}">KUMULIERT</text><text class="ey" x="${padL}" y="${top + h1 + gap - 8}">JE STUNDE</text>`;
    // Schichtgrenzen + Namen
    const labels = [];
    for (const s of shifts()) {
      const xs = X(d0 + s.a);
      if (s.a > 6 * 3600 && s.a < 22 * 3600) g += `<line class="axis" x1="${f(xs)}" x2="${f(xs)}" y1="${top - 6}" y2="${b2}" stroke-dasharray="2 3"/>`;
      if (s.a >= 6 * 3600 && s.a < 22 * 3600) labels.push({ x: xs + 4, w: s.name.length * 6, t: s.name });
    }
    const xNow = X(now), showNow = now > w0 && now < w1;
    for (const l of labels) if (!(showNow && xNow > l.x - 24 && xNow < l.x + l.w + 8)) g += `<text x="${f(l.x)}" y="11">${esc(l.t)}</text>`;
    // Balken je Stunde: vergangen voll, laufend voll + Prognose-Rest (halbe Deckkraft), künftig als Umriss aus der Prognose
    const sw = plotW / 16, bw = Math.max(5, Math.min(30, sw * 0.6));
    let hits = '';
    for (let h = 6; h < 22; h++) {
      const ha = d0 + h * 3600, cx = X(ha + 1800), bx = cx - bw / 2, lab = `${U.fmtClock(ha)}–${U.fmtClock(ha + 3600)}`;
      let tipTxt;
      const pv = planH(h), pTxt = pv != null ? ` · Plan ${U.fmtNum(pv)}` : '';
      if (h < hNow) {
        if (act[h] > 0) g += `<rect x="${f(bx)}" y="${f(Y2(act[h]))}" width="${f(bw)}" height="${f(b2 - Y2(act[h]))}" rx="2.5" style="fill:var(--text2)" opacity=".5"/>`;
        tipTxt = `${lab}: ${U.fmtNum(act[h])} Arbeitsgänge gut${pTxt}`;
      } else if (h === hNow) {
        const a = act[h], r = fcH[h] || 0;
        if (r > 0.5) g += `<rect x="${f(bx)}" y="${f(Y2(a + r))}" width="${f(bw)}" height="${f(Y2(a) - Y2(a + r))}" rx="2.5" style="fill:var(--text2)" opacity=".22"/>`;
        if (a > 0) g += `<rect x="${f(bx)}" y="${f(Y2(a))}" width="${f(bw)}" height="${f(b2 - Y2(a))}" rx="2.5" style="fill:var(--text2)" opacity=".5"/>`;
        tipTxt = `${lab}: bisher ${U.fmtNum(a)} Arbeitsgänge gut · bis ${U.fmtClock(ha + 3600)} ca. ${U.fmtNum(r)} weitere laut Prognose${pTxt}`;
      } else {
        const v = fcH[h] || 0;
        if (v >= 0.5) g += `<rect x="${f(bx + 0.5)}" y="${f(Y2(v) + 0.5)}" width="${f(bw - 1)}" height="${f(Math.max(1, b2 - Y2(v) - 0.5))}" rx="2.5" style="fill:var(--text2);stroke:var(--text2)" fill-opacity=".05" stroke-opacity=".42" stroke-dasharray="3 2"/>`;
        tipTxt = `${lab}: ca. ${U.fmtNum(v)} Arbeitsgänge gut laut Prognose${pTxt}`;
      }
      if (pv != null && pv >= 0.5) g += `<line class="plt" x1="${f(bx - 3)}" x2="${f(bx + bw + 3)}" y1="${f(Y2(pv))}" y2="${f(Y2(pv))}"/>`;
      const every = sw < 26 ? 4 : 2;
      if ((h - 6) % every === 0) g += `<text x="${f(X(ha))}" y="${Ht - 5}" text-anchor="${h === 6 ? 'start' : 'middle'}">${U.fmtClock(ha)}</text>`;
      hits += `<rect class="hit" data-tip="${esc(tipTxt)}" x="${f(X(ha))}" y="${top}" width="${f(sw)}" height="${f(b2 - top)}"/>`;
    }
    g += `<text x="${f(X(w1))}" y="${Ht - 5}" text-anchor="end">22:00</text>`;
    // kumulierte Linien (gleiche Zeitachse): Plan, Prognose, Ist
    const path = (pts, Y) => pts.map((p, i) => (i ? 'L' : 'M') + f(X(p[0])) + ',' + f(Y(p[1]))).join(' ');
    let lines = '';
    if (planPts) lines += `<path d="${path(planPts, Y1)}" style="fill:none;stroke:var(--muted)" stroke-width="1.5" stroke-dasharray="1.5 3.5" stroke-linecap="round"/>`;
    if (fcEnd != null) lines += `<path d="${path(fcPts, Y1)}" style="fill:none;stroke:var(--accent)" stroke-width="1.6" stroke-dasharray="5 4" opacity=".8"/>`;
    if (now > w0) {
      const ist = cumPts.filter(p => p[0] <= now);
      lines += `<path d="${path(ist, Y1)} L${f(X(now))},${f(Y1(0))} L${f(X(ist[0][0]))},${f(Y1(0))} Z" style="fill:var(--accent)" opacity=".09"/>` +
        `<path d="${path(ist, Y1)}" style="fill:none;stroke:var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
    }
    g += `<g clip-path="url(#an-clip)">${lines}</g>`;
    // jetzt-Linie, Endpunkt, Endwerte rechts
    if (showNow) {
      g += `<line x1="${f(xNow)}" x2="${f(xNow)}" y1="${top - 6}" y2="${b2}" style="stroke:var(--accent)" stroke-width="1" opacity=".45"/>` +
        `<text class="now" x="${f(xNow)}" y="11" text-anchor="middle">jetzt</text>` +
        `<circle cx="${f(xNow)}" cy="${f(Y1(good))}" r="4.2" style="fill:var(--accent);stroke:var(--card)" stroke-width="2"/>`;
      const lx = xNow - padL < 54 ? xNow + 8 : xNow - 8;
      g += `<text class="vl" x="${f(lx)}" y="${f(Math.max(top + 12, Y1(good) - 9))}" text-anchor="${xNow - padL < 54 ? 'start' : 'end'}">${U.fmtNum(good)}</text>`;
    }
    const ends = [];
    if (fcEnd != null) ends.push({ y: Y1(fcEnd), t: '≈ ' + U.fmtNum(fcEnd), c: 'fc' });
    if (planEnd != null && (fcEnd == null || Math.abs(planEnd - fcEnd) > Math.max(5, m1 * 0.012))) ends.push({ y: Y1(planEnd), t: U.fmtNum(planEnd), c: 'pl' });
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 14) { const mid = (ends[0].y + ends[1].y) / 2; ends[0].y = mid - 7; ends[1].y = mid + 7; }
    for (const e of ends) g += `<text class="${e.c}" x="${Wd - padR + 6}" y="${f(e.y + 4)}">${esc(e.t)}</text>`;
    g += hits;
    const svg = `<svg class="an-chart" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="Arbeitsgänge gut heute: je Stunde und kumuliert, Ist gegen Plan und Prognose">${g}</svg>`;
    // Kopfzahlen – nach 22:00 wird am Ende des Tagesfensters verglichen (Geisterschicht separat)
    const after = now >= w1, cumAt = (t) => { let v = 0; for (let i = 0; i < cumPts.length; i++) { const p = cumPts[i]; if (p[0] <= t) v = p[1]; else { const p0 = cumPts[i - 1]; if (p0) v = p0[1] + (p[1] - p0[1]) * (t - p0[0]) / Math.max(1, p[0] - p0[0]); break; } } return v; };
    const istRef = after ? Math.round(cumAt(w1)) : good;
    const delta = planNow != null && P && now > P.t ? istRef - planNow : null;
    const tol = planNow != null ? Math.max(5, planNow * 0.02) : 5;
    const dTxt = delta == null ? '<small>Tagesbeginn</small>' : Math.abs(delta) < tol ? '<small class="up">im Plan</small>'
      : `<small class="${delta < 0 ? 'down' : 'up'}">${delta >= 0 ? '+' : '−'}${U.fmtNum(Math.abs(delta))} ${delta >= 0 ? 'über' : 'unter'} Plan</small>`;
    const pLab = P ? `Plan (Stand ${U.fmtClock(P.t)})` : '';
    const os = `
      <div title="Gutteile je Arbeitsgang (Bearbeiten, Waschen, Prüfen, Montage) – wie im Leitstand „Arbeitsgänge … gut“"><span class="l">Arbeitsgänge gut bis ${after ? '22:00' : 'jetzt'}</span><span class="v">${U.fmtNum(istRef)}</span></div>
      ${P ? `<div title="${esc(`Tagesplan, eingefroren um ${U.fmtClock(P.t)} (${P.how === 'Start' ? 'Stand beim Start der Simulation' : 'Schichtbeginn'}) – gleiches Flussmodell wie die Prognose; Abweichungen sind Verluste bzw. Gewinne seither`)}"><span class="l">Plan bis ${after ? '22:00' : 'jetzt'} · Stand ${U.fmtClock(P.t)}</span><span class="v">${U.fmtNum(planNow)}${dTxt}</span></div>` : ''}
      ${after && good > istRef ? `<div><span class="l">Seit 22:00 (Geisterschicht)</span><span class="v">+${U.fmtNum(good - istRef)}</span></div>` : ''}
      ${fcEnd != null ? `<div title="Bekannte Aufträge mit Plan-Taktzeiten, Rüsten, Schichtplan und Materialfluss – Neuaufträge kommen hinzu"><span class="l">Prognose bis 22:00</span><span class="v acc">≈ ${U.fmtNum(fcEnd)}</span></div>` : ''}
      <div title="Gutteile, die heute den letzten Bearbeitungsschritt ihres Auftrags abgeschlossen haben – wie im Leitstand"><span class="l">Fertige Teile heute</span><span class="v">${U.fmtNum(k.goodFinished)}<small class="fin">Stk</small></span></div>`;
    host.innerHTML = `
      <div class="card-h an-ch"><h3>Ausstoß heute</h3><span class="muted">Arbeitsgänge gut je Stunde · Bearbeiten, Waschen, Prüfen, Montage</span></div>
      <div class="card-b an-flowbox"><div class="an-os">${os}</div>${svg}
        <div class="an-legend"><span><i class="act"></i>Ist je Stunde</span>${P ? '<span><i class="pt"></i>Plan je Stunde</span>' : ''}<span><i class="gh"></i>Prognose je Stunde</span><span><i class="ln"></i>Ist kumuliert</span><span><i class="fc"></i>Prognose kumuliert</span>${P ? `<span><i class="pl"></i>${esc(pLab)}</span>` : ''}<span class="nt">Prognose: bekannte Aufträge, ohne Neuaufträge</span></div></div>`;
  }

  // ------------------------------------------------------------ OEE je Maschine
  function renderOee(k) {
    const rows = machines().filter(id => S().machines[id].kind === 'machine').map(id => {
      const mv = WF.sim.machineView(id), o = (range === 'ks' ? mv.oeeShift : mv.oeeToday) || {};
      return { id, short: mv.short, oee: o.oee, a: o.availability, p: o.performance, q: o.quality };
    }).sort((a, b) => (a.oee == null ? -1 : a.oee) - (b.oee == null ? -1 : b.oee) || (a.id < b.id ? -1 : 1));
    const cls = (v) => v == null ? 'n' : v >= TARGET_OEE ? 'g' : v >= 0.55 ? 'y' : 'r';
    const below = rows.filter(r => r.oee != null && r.oee < TARGET_OEE).length;
    const struct = range + '|' + rows.map(r => r.id).join(',');
    // je Maschine liefert die Engine den Tageswert – mit Nachtanteil ehrlich als „inkl. Geisterschicht“ bezeichnen
    const incl = range === 'kd' && oeeModel(k).staffed;
    paint('oee', q('[data-s="oee"]'), struct, (T, W, C, A) => `
      <div class="card-h an-ch"><h3>OEE je Maschine</h3>${T('osub', `${range === 'ks' ? 'laufende Schicht' : incl ? 'heute inkl. Geisterschicht' : 'heute'} · ${below ? below + ' unter Ziel' : 'alle im Ziel'}`, 'span', 'class="muted"')}</div>
      <div class="card-b">
        <div class="an-bars">
          ${rows.map(r => `<div class="an-row click" data-id="${esc(r.id)}" ${A('or' + r.id, `${r.short}: OEE ${r.oee == null ? '–' : pct1(r.oee)} = Verfügbarkeit ${pct0(r.a)} × Leistung ${pct0(r.p)} × Qualität ${pct0(r.q)}`)}>
            <span class="an-l">${esc(r.short)}</span>
            <span class="an-track"><i ${C('oc' + r.id, cls(r.oee))} ${W('ow' + r.id, r.oee == null ? 0.004 : Math.max(0.004, r.oee))}></i><b class="an-tg" style="left:${TARGET_OEE * 100}%"></b></span>
            ${T('ov' + r.id, r.oee == null ? '–' : pct0(r.oee), 'span', 'class="an-v"')}
            ${T('om' + r.id, `V ${pct0(r.a)} · L ${pct0(r.p)} · Q ${pct0(r.q)}`, 'span', 'class="an-m"')}
          </div>`).join('')}
        </div>
        <div class="an-legend2"><span><i></i>Ziel ${pct0(TARGET_OEE)}</span><span>V = Verfügbarkeit · L = Leistung · Q = Qualität</span></div>
      </div>`);
  }

  // ------------------------------------------------------------ Energie je Maschine (Werk = Leitstand, davon Maschinen)
  function renderEnergy(k) {
    const E = energyModel(k), pr = price(), rows = E.rows, max = Math.max(0.1, ...rows.map(r => r.kwh));
    const topR = rows[0];
    const struct = rows.map(r => r.id).join(',') + '|' + (pr ? 'p' : '');
    const mShare = E.plant > 0 ? Math.min(1, E.machines / E.plant) : 0;
    const ins = E.plant > 0
      ? `Werk heute <strong style="color:var(--text)">${U.fmtNum(E.plant)} kWh</strong>${pr ? ` ≈ ${U.fmtEur(E.plant * pr)}` : ''} – wie im Leitstand.` +
        (topR ? ` Am meisten braucht <b>${esc(topR.short)}</b>: ${U.fmtNum(topR.kwh)} kWh${topR.pp != null ? `, ${kwh(topR.pp)} kWh je Teil` : ''}.` : '')
      : 'Noch kein Energieverbrauch erfasst.';
    const hist = (S().history.powerKw || []).slice(-96);
    paint('energy', q('[data-s="energy"]'), struct, (T, W, C, A) => `
      <div class="card-h an-ch"><h3>Energie je Maschine heute</h3>${T('pw', `${WF.ui.spark(hist, { w: 96, h: 22, color: 'var(--text2)' })}<b>${U.fmtNum(k.powerKw)} kW</b><span>jetzt</span>`, 'span', 'class="an-pw" title="Leistungsaufnahme des Werks (letzte 8 h)"')}</div>
      <div class="card-b">
        ${T('ins', nb(ins), 'p', 'class="an-eins"')}
        <div class="an-es" role="img" aria-label="Werksenergie heute: Maschinen und Grundlast/AGVs"><i class="m" ${W('esm', mShare)}></i><i class="b an-hatch" ${W('esb', 1 - mShare)}></i></div>
        ${T('esl', `<span><i class="m"></i>Maschinen <b>${U.fmtNum(E.machines)} kWh</b> (${pct0(mShare)})</span><span><i class="an-hatch"></i>Hallen-Grundlast und AGVs <b>${U.fmtNum(E.base)} kWh</b></span>`, 'div', 'class="an-esl"')}
        ${rows.length ? `<div class="an-bars en">
          <div class="an-bh"><span></span><span style="text-align:left">Maschine heute</span><span>kWh</span><span class="hm">je Teil</span></div>
          ${rows.map(r => {
            const tipTxt = `${r.short}: ${U.fmtNum(r.kwh, 1)} kWh heute, ${U.fmtNum(r.good)} Gutteile an dieser Maschine${r.pp != null ? ' → ' + kwh(r.pp) + ' kWh je Teil' + (pr ? ' ≈ ' + U.fmtEur(r.pp * pr, 2) : '') : ' – noch kein Gutteil'}`;
            return `<div class="an-row click" data-id="${esc(r.id)}" ${A('er' + r.id, tipTxt)}>
              <span class="an-l">${esc(r.short)}</span>
              <span class="an-track"><i class="q" ${W('ew' + r.id, r.kwh / max)}></i></span>
              ${T('ev' + r.id, U.fmtNum(r.kwh, 1), 'span', 'class="an-v mu"')}
              ${T('ep' + r.id, r.pp != null ? `${kwh(r.pp)}<small>kWh</small>` : '–', 'span', 'class="an-m em"')}
            </div>`;
          }).join('')}
        </div>` : '<div class="empty">Noch kein Energieverbrauch erfasst.</div>'}
      </div>`);
  }

  // ------------------------------------------------------------ Takt
  function update(force) {
    if (!root || !S() || !WF.sim.kpis) return;
    const Sx = S(), k = WF.sim.kpis();
    // Tagesplan kommt aus dem Schichtbeginn-Ereignis (06:00); Rückfall nur, falls keins kam – dann ehrlich „Stand hh:mm“
    const d0 = U.dayStart(Sx.t);
    if ((!plan || plan.day !== d0) && Sx.t >= d0 + 6 * 3600 && Sx.t < d0 + 22 * 3600 && WF.sim.shift && WF.sim.shift().id) { try { capturePlan('nachgeholt'); } catch (e) { plan = null; } }
    const fb = q('[data-s="flow"] .an-flowbox') || q('[data-s="flow"]');
    if (fb && fb.clientWidth) { const w = fb.clientWidth - 28; if (Math.abs(w - flowW) > 4) { flowW = w; force = true; } }
    const key = range + '|' + Math.floor(Sx.t / 60) + '|' + flowW;
    const slow = force || key !== slowKey;
    if (slow) { slowKey = key; bneckCache = bneck(); }
    const L = lossModel(k);   // Schichtzeit = kpis().lossEurStaffedToday, Nacht = lossEurNightToday (eine Zahl mit dem Leitstand)
    renderKpis(k, L);
    renderHero(L);
    renderMatrix(L);
    if (slow) { renderFlow(k); renderOee(k); renderEnergy(k); }
  }

  WF.registerView({
    id: 'analyse', title: 'Analyse', icon: 'gauge', group: 'betrieb', order: 3.5,
    mount(r) {
      root = r;
      r.innerHTML = `<div class="view-h"><div><h1 class="view-t">Analyse</h1>
          <p class="view-sub">Wo die Fertigung Zeit und Geld verliert – live aus Maschinenzuständen und Stundensätzen.</p></div>
          <div class="seg" role="tablist" aria-label="Zeitraum"><button role="tab" aria-selected="true" data-r="kd" class="on">Heute</button><button role="tab" aria-selected="false" data-r="ks">Laufende Schicht</button></div></div>
        <div class="an-body">
          <div class="kpis an-kpis" data-s="kpis"></div>
          <section class="card an-hero" data-s="hero" aria-label="Wo verlieren wir Geld?"></section>
          <section class="card" data-s="matrix" aria-label="Verlustmatrix"></section>
          <section class="card" data-s="flow" aria-label="Ausstoß heute"><div class="card-b an-flowbox"></div></section>
          <div class="an-pair"><section class="card" data-s="oee" aria-label="OEE je Maschine"></section><section class="card" data-s="energy" aria-label="Energie je Maschine"></section></div>
        </div>`;
      r.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
        range = b.dataset.r;
        r.querySelectorAll('[data-r]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
        update(true);
      });
      r.addEventListener('click', (e) => {
        const ask = e.target.closest('[data-ask]');
        if (ask) {
          const [label, id] = ask.dataset.ask.split('|'), st = WF.profile.stationById[id];
          const txt = /^Nacht/.test(label)
            ? `Analysiere die Stillstandskosten der letzten Nacht (Geisterschicht), besonders an ${st ? st.short : id}: warum standen die autonomen Maschinen, was hat es gekostet und was sollte die Spätschicht vor Schichtende vorbereiten?`
            : `Analysiere die Stillstandskosten „${label}“ ${range === 'ks' ? 'in dieser Schicht' : 'heute'}, besonders an ${st ? st.short : id}: Ursachen, Kosten und konkrete Maßnahmen für die nächste Schicht.`;
          WF.bus.emit('ai:ask', { text: txt, context: { kind: 'machine', id } });
          return;
        }
        const t = e.target.closest('[data-id]');
        if (t && WF.profile.stationById[t.dataset.id]) WF.app.select('machine', t.dataset.id);
      });
      r.addEventListener('mousemove', (e) => {
        const t = e.target.closest('[data-tip]');
        if (!t) { if (tip) { tip.remove(); tip = null; } return; }
        if (!tip) { tip = el('div', { class: 'an-tip' }); document.body.append(tip); }
        tip.textContent = t.getAttribute('data-tip');
        tip.style.left = Math.max(8, Math.min(window.innerWidth - 310, e.clientX + 14)) + 'px';
        tip.style.top = Math.min(window.innerHeight - 70, e.clientY + 14) + 'px';
      });
      r.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
      window.addEventListener('resize', () => { slowKey = ''; });
      update(true);
    },
    show() { slowKey = ''; },
    hide() { if (tip) { tip.remove(); tip = null; } },
    update() { update(false); },
  });
})();
