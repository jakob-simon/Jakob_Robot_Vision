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

  let root = null, range = 'kd', tip = null, flowW = 0, slowKey = '', plan = null, planTimer = 0, bneckCache = null;
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
  /** Stillstandskosten je Maschine und Ursache – exakt aus der Engine (lossEurBy, Σ = lossEur; Zeit = plannedStateSec). */
  function lossModel() {
    const rows = [], causes = {};
    for (const id of machines()) {
      const m = S().machines[id], st = stats(m), by = st.lossEurBy, ps = st.plannedStateSec || {};
      const cells = {};
      if (by) {
        for (const k in by) if (k !== 'running' && k !== 'idle' && by[k] > 0) cells[k] = { eur: by[k], sec: ps[k] || 0 };
      } else {   // ältere Engine: anteilig nach Zustandszeiten
        const sec = st.stateSec || {}, tot = ORDER.reduce((a, k) => a + (sec[k] || 0), 0);
        for (const k of ORDER) if (sec[k] > 0 && tot > 0) cells[k] = { eur: (st.lossEur || 0) * sec[k] / tot, sec: (st.lossSec || 0) * sec[k] / tot };
      }
      for (const k in cells) { const c = causes[k] || (causes[k] = { key: k, label: stLabel(k), color: stColor(k), eur: 0, sec: 0 }); c.eur += cells[k].eur; c.sec += cells[k].sec; }
      rows.push({ id, short: m.short, eur: st.lossEur || 0, sec: st.lossSec || 0, cells });
    }
    const total = rows.reduce((a, r) => a + r.eur, 0);
    const all = Object.values(causes).sort((a, b) => b.eur - a.eur || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    let cum = 0;
    for (const c of all) { cum += c.eur; c.share = total > 0 ? c.eur / total : 0; c.cum = total > 0 ? Math.min(1, cum / total) : 0; }
    return { rows, items: all.filter(c => c.eur >= 0.5), total, totalSec: rows.reduce((a, r) => a + r.sec, 0) };
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
  function energyModel() {
    const rows = [];
    for (const id of machines()) {
      const m = S().machines[id], e = m.kd ? m.kd.energyKwh || 0 : 0, g = m.kd ? m.kd.good || 0 : 0;
      rows.push({ id, short: m.short, kwh: e, good: g, pp: g > 0 ? e / g : null });
    }
    const total = rows.reduce((a, r) => a + r.kwh, 0);
    return { rows: rows.filter(r => r.kwh >= 0.05).sort((a, b) => b.kwh - a.kwh), total };
  }

  // ------------------------------------------------------------ Prognose je Stunde (aus der Plantafel)
  let SHC = null;
  const shifts = () => SHC || (SHC = (WF.profile.shifts || []).map(s => ({ id: s.id, name: s.name, a: U.hm(s.start), b: U.hm(s.end),
    br: (s.breaks || []).map(x => [U.hm(x[0]), U.hm(x[1])]) })));
  /** Arbeitszeit in [a,b): Schichtzeit ohne Pausen, Mo–Fr; autonome Maschinen laufen durch (wie die Prognose der Engine) */
  function workIn(a, b, auto) {
    if (!(b > a)) return 0;
    if (auto) return b - a;
    let sum = 0;
    for (let d = Math.floor(a / 86400); d * 86400 < b; d++) {
      if ((((d % 7) + 7) % 7) >= 5) continue;
      for (const s of shifts()) {
        let x = s.a;
        const segs = [];
        for (const br of s.br) { segs.push([x, br[0]]); x = br[1]; }
        segs.push([x, s.b]);
        for (const [p, r] of segs) { const lo = Math.max(a, d * 86400 + p), hi = Math.min(b, d * 86400 + r); if (hi > lo) sum += hi - lo; }
      }
    }
    return sum;
  }
  /** erwartete Teile je Stunde (Index 0–23 des Tages d0) ab `from` – aus der Plantafel (forecast().machines) und dem
      Materialfluss: je Arbeitsgang die offenen Teile gleichmäßig über die Arbeitszeit zwischen Rüstende und Belegungsende,
      aber nie mehr, als der Vorgänger bis dahin geliefert hat (Messraum, Waschen, Montage sind sonst nur für die schon
      vorhandenen Behälter eingeplant). Fremdbearbeitung/Versand liefern innerhalb des Tages nichts nach. */
  function forecastHours(fc, from, d0) {
    const out = new Array(24).fill(0), Sx = S();
    if (!fc || !fc.machines) return out;
    const ent = {};
    for (const mid in fc.machines) for (const e of fc.machines[mid]) ent[e.orderId + '/' + e.seq] = { e, mid };
    const B = []; for (let h = 0; h <= 24; h++) B.push(d0 + h * 3600);
    const zero = B.map(() => 0);
    for (const oid in Sx.orders) {
      const o = Sx.orders[oid]; if (!o || o.status === 'fertig') continue;
      let prev = null;
      for (let i = 0; i < o.routing.length; i++) {
        const r = o.routing[i], op = o.ops[i], x = ent[oid + '/' + r.seq];
        if (!op || op.complete || !x) { prev = zero; continue; }
        const m = Sx.machines[x.mid], auto = !!m && m.loading === 'auto', e = x.e;
        const n = (WF.sim.partsLeft ? WF.sim.partsLeft(oid, r.seq) || 0 : 0) + (e.active ? op.inProc || 0 : 0);
        const a = Math.max(from, e.setupEnd != null ? e.setupEnd : e.start), b = e.end, tot = workIn(a, b, auto);
        let cum = B.map(t => (tot > 0 && n > 0 && t > a) ? n * workIn(a, Math.min(b, t), auto) / tot : 0);
        if (i > 0 && prev) {
          const p = o.ops[i - 1], avail0 = Math.max(0, (p.good || 0) - (op.good || 0) - (op.scrap || 0));
          cum = cum.map((c, h) => Math.min(c, avail0 + prev[h]));
        }
        for (let h = 0; h < 24; h++) out[h] += Math.max(0, cum[h + 1] - cum[h]);
        prev = cum;
      }
    }
    return out;
  }
  /** Tagesplan einfrieren (Prognose zu Tagesbeginn bzw. nach Start/Reset) – Bezug für „Ist gegen Plan“ */
  function takePlan() {
    planTimer = 0;
    const Sx = S(); if (!Sx || !WF.sim.forecast) return;
    let fc, k; try { fc = WF.sim.forecast(); k = WF.sim.kpis(); } catch (e) { return; }
    const d0 = U.dayStart(Sx.t);
    plan = { day: d0, t: Sx.t, base: k.good || 0, hours: forecastHours(fc, Sx.t, d0).map(v => v * (k.fpy || 1)) };
    slowKey = '';   // Diagramm beim nächsten Takt mit Plan zeichnen
  }
  const schedulePlan = () => { if (!planTimer) planTimer = setTimeout(takePlan, 0); };
  WF.bus.on('sim:reset', () => { plan = null; schedulePlan(); });
  WF.bus.on('sim:event', (e) => { if (e && e.type === 'shift' && (!plan || plan.day !== U.dayStart(e.t))) schedulePlan(); });

  // ------------------------------------------------------------ Kennzahlen
  function renderKpis(k, L, totalEur) {
    const b = bneckCache, top = L.items[0];
    const oee = range === 'ks' ? k.oeeShift : k.oee;
    const warn = oee != null && oee < TARGET_OEE;
    const E = energyModel(), pr = price();
    const perPart = k.goodFinished > 0 ? E.total / k.goodFinished : null;
    const ghost = range === 'ks' && WF.sim.shift && !WF.sim.shift().id;
    const struct = [range, b ? b.id : '', warn ? 'w' : '', ghost ? 'g' : ''].join('|');
    paint('kpis', q('[data-s="kpis"]'), struct, (T) => `
      <div class="kpi" title="Maschinenstundensatz × Zeit, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Rüsten, Warten, Störung) – gleiche Zahl wie im Leitstand">
        <div class="l">Stillstandskosten ${range === 'ks' ? 'Schicht' : 'heute'}</div>
        ${T('lv', `${U.fmtNum(totalEur)}<small>€</small>`, 'div', 'class="v"')}
        ${T('ls', top ? `größte Ursache <b style="color:var(--text2)">${esc(top.label)}</b> · ${U.fmtEur(top.eur)} (${pct0(top.share)})` : 'kein Stillstand mit eingeplantem Auftrag', 'div', 'class="s"')}
      </div>
      <div class="kpi${warn ? ' warn' : ''}" title="OEE = Verfügbarkeit × Leistung × Qualität, Bearbeitungsmaschinen">
        <div class="l">Werk-OEE ${range === 'ks' ? (ghost ? 'Geisterschicht' : 'Schicht') : 'heute'}</div>
        ${T('ov', oee == null ? '–' : `${U.fmtNum(oee * 100, 1)}<small>%</small>`, 'div', 'class="v"')}
        ${T('os', range === 'ks'
          ? `Ziel ${pct0(TARGET_OEE)} · ${ghost ? 'nur autonome Maschinen' : 'laufende Schicht'}`
          : `Ziel ${pct0(TARGET_OEE)} · V ${pct1(k.availability)} × L ${pct1(k.performance)} × Q ${pct1(k.quality)}`, 'div', 'class="s"')}
      </div>
      <div class="kpi${b ? ' an-click' : ''}"${b ? ` data-id="${esc(b.id)}" title="${esc(b.full || 'Werks-Engpass')} – Klick öffnet die Maschine"` : ''}>
        <div class="l">Werks-Engpass</div>
        <div class="v">${b ? `${esc(b.id)}<small>${esc(b.short)}</small>` : '–'}</div>
        ${T('bs', b ? esc(b.why) : 'kein Werks-Engpass erkennbar', 'div', 'class="s"')}
      </div>
      <div class="kpi" title="Energie der Maschinen heute (ohne Hallen-Grundlast) je Fertigteil (letzter Bearbeitungsschritt je Auftrag)">
        <div class="l">Energie je Fertigteil</div>
        ${T('ev', perPart != null ? `${kwh(perPart)}<small>kWh</small>` : '–', 'div', 'class="v"')}
        ${T('es', nb(`${pr && perPart != null ? `≈ ${U.fmtEur(perPart * pr, 2)} je Teil · ` : ''}${U.fmtNum(E.total)} kWh · ${U.fmtNum(k.goodFinished)} Fertigteile heute`), 'div', 'class="s"')}
      </div>`);
  }

  // ------------------------------------------------------------ Held: Wo verlieren wir Geld?
  function renderHero(L, totalEur) {
    const items = L.items, N = items.length;
    const recos = items.slice(0, 3).map(it => {
      const worst = L.rows.filter(r => r.cells[it.key]).sort((a, b) => b.cells[it.key].eur - a.cells[it.key].eur)[0] || null;
      return { it, worst };
    });
    const struct = [range, items.map(i => i.key).join(','), recos.map(r => r.worst ? r.worst.id : '').join(',')].join('|');
    const when = range === 'ks' ? 'in dieser Schicht' : 'heute';
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
    paint('hero', q('[data-s="hero"]'), struct, (T, W, C, A) => `
      <div class="card-h an-ch"><h3>Wo verlieren wir Geld?</h3>${T('hs', `Stillstandskosten nach Ursache · ${when} · <b style="color:var(--text2)">${U.fmtEur(totalEur)}</b> in ${U.fmtDur(L.totalSec)}`, 'span', 'class="muted"')}</div>
      <div class="an-hb">
        <div class="an-hl">
          ${N ? `${T('ins', ins, 'p', 'class="an-ins"')}
          <div class="an-par" role="img" aria-label="Stillstandskosten nach Ursache, absteigend, mit kumuliertem Anteil">
            <span class="axh c1" style="grid-column:1">Ursache</span>
            <div class="ax">${ax.map(v => `<span${v === 0.25 || v === 0.75 ? ' class="q"' : ''} style="left:${v * 100}%">${v * 100} %</span>`).join('')}</div>
            <span class="axh c3" style="grid-column:3">€</span><span class="axh c4" style="grid-column:4">Zeit · kumuliert</span>
            <div class="gr" style="grid-row:2 / span ${N}">${ax.slice(1).map(v => `<b style="left:${v * 100}%"></b>`).join('')}</div>
            ${items.map((it, i) => {
              const tipTxt = `${it.label}: ${U.fmtEur(it.eur)} in ${U.fmtDur(it.sec)} geplanter Maschinenzeit – ${pct0(it.share)} der Stillstandskosten, kumuliert ${pct0(it.cum)}`;
              return `<span class="pl" style="grid-row:${i + 2}" ${A('pl' + it.key, tipTxt)}><i style="background:${it.color}"></i><span>${hy(esc(it.label))}</span></span>
              <span class="pb" style="grid-row:${i + 2};--c:${it.color}" ${A('pb' + it.key, tipTxt)}><i ${W('b' + it.key, it.share)}></i></span>
              ${T('v' + it.key, U.fmtEur(it.eur), 'span', `class="pv" style="grid-row:${i + 2}"`)}
              ${T('m' + it.key, `${U.fmtDur(it.sec)} · ${pct0(it.cum)}`, 'span', `class="pm" style="grid-row:${i + 2}"`)}`;
            }).join('')}
            ${T('cum', cumHtml(items), 'div', `class="cum" style="grid-row:2 / span ${N}"`)}
          </div>
          <div class="an-plg"><span><i class="b"></i>Anteil je Ursache</span><span><i class="c"></i>kumulierter Anteil</span><span>€ = Stundensatz × geplante Zeit ohne Produktion</span></div>`
          : `<div class="empty">Noch keine Stillstandskosten ${when} – alle Maschinen mit Auftrag produzieren.</div>`}
        </div>
        <div class="an-hr">
          <div class="an-rh"><h4>Was jetzt hilft</h4><span>aus den größten Posten</span></div>
          ${recos.length ? recos.map(({ it, worst }, n) => `
            <div class="an-rc" style="--c:${it.color}">
              <div class="h"><span class="an-rk">${n + 1}</span><b>${esc(it.label)}</b>${T('re' + it.key, U.fmtEur(it.eur), 'span', 'class="e"')}</div>
              <p>${esc(RECO[it.key] || 'Ursache im Copilot analysieren.')}</p>
              <div class="acts">${worst ? `<span class="muted">größter Posten <button class="link" data-id="${esc(worst.id)}">${esc(worst.short)}</button> · ${T('rw' + it.key, recoWorst(it, worst), 'span')}</span>` : '<span></span>'}${WF.ai && worst ? `<button class="btn sm ghost" data-ask="${esc(it.label)}|${esc(worst.id)}">${icon('sparkles', 14)} Analysieren</button>` : ''}</div>
            </div>`).join('') : '<div class="empty">Keine nennenswerten Verluste – die Schicht läuft rund.</div>'}
        </div>
      </div>`);
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
    const cols = L.items;   // Spalten = Ursachen in Pareto-Reihenfolge (größte zuerst)
    const rows = L.rows.filter(r => r.eur >= 0.5).sort((a, b) => b.eur - a.eur);
    const none = L.rows.filter(r => r.eur < 0.5).map(r => r.short);
    const max = Math.max(1, ...rows.flatMap(r => cols.map(c => r.cells[c.key] ? r.cells[c.key].eur : 0)));
    const step = niceStep(max / 5);           // 5 Stufen, lineare €-Klassen
    const lvl = (v) => Math.min(4, Math.floor(v / step));
    const maxRow = Math.max(1, ...rows.map(r => r.eur));
    const nz = rows.map(r => cols.filter(c => r.cells[c.key] && r.cells[c.key].eur >= 0.5).map(c => c.key).join('+')).join(',');
    const struct = [range, cols.map(c => c.key).join(','), rows.map(r => r.id).join(','), nz, step].join('|');
    const when = range === 'ks' ? 'laufende Schicht' : 'heute';
    const legend = [0, 1, 2, 3, 4].map(i => `<span class="k"><i class="an-h${i}"></i>${i < 4 ? (i === 0 ? '< ' + U.fmtNum(step) : U.fmtNum(i * step) + '–' + U.fmtNum((i + 1) * step)) : '≥ ' + U.fmtNum(4 * step)}</span>`).join('');
    paint('matrix', q('[data-s="matrix"]'), struct, (T, W, C, A) => {
      const cell = (r, c) => {
        const x = r.cells[c.key], v = x ? x.eur : 0, key = r.id + c.key;
        const tipTxt = x ? `${r.short} · ${c.label}: ${U.fmtEur(v)} (${U.fmtDur(x.sec)})` : `${r.short} · ${c.label}: kein Stillstand`;
        return `<td ${C('mc' + key, v >= 0.5 ? 'an-h' + lvl(v) : 'z')} ${A('mt' + key, tipTxt)}>${T('mv' + key, v >= 0.5 ? U.fmtNum(v) : '·')}</td>`;
      };
      const minW = 140 + cols.length * 92 + 160;
      return `
      <div class="card-h an-ch"><h3>Verlustmatrix Maschine × Ursache</h3><div class="an-lg"><span class="t">€ je Zelle</span>${legend}</div></div>
      <div class="card-b">${rows.length && cols.length ? `
        <div class="an-mx-wrap"><table class="an-mx" style="min-width:${minW}px">
          <colgroup><col style="width:140px">${cols.map(() => '<col>').join('')}<col style="width:160px"></colgroup>
          <thead><tr><th class="m">Maschine</th>${cols.map(c => `<th title="${esc(c.label)}">${hy(esc(c.label))}</th>`).join('')}<th class="s">Summe</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td class="m" data-id="${esc(r.id)}" title="${esc(r.short)} öffnen">${esc(r.short)}</td>${cols.map(c => cell(r, c)).join('')}
            <td class="s"><span class="an-sb"><span class="tr"><i ${W('ms' + r.id, r.eur / maxRow)}></i></span>${T('mS' + r.id, U.fmtEur(r.eur), 'b')}</span></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="an-ml">${rows.map(r => `<div class="r" data-id="${esc(r.id)}">
            <div class="t"><span>${esc(r.short)}</span><span class="an-sb"><span class="tr"><i ${W('ls' + r.id, r.eur / maxRow)}></i></span>${T('lS' + r.id, U.fmtEur(r.eur), 'b')}</span></div>
            <div class="cs">${cols.filter(c => r.cells[c.key] && r.cells[c.key].eur >= 0.5).map(c => { const v = r.cells[c.key].eur; return `<span ${C('lc' + r.id + c.key, 'an-h' + lvl(v))}>${esc(c.label)} ${T('lv' + r.id + c.key, U.fmtEur(v), 'b')}</span>`; }).join('')}</div>
          </div>`).join('')}</div>
        ${none.length ? `<div class="an-mfoot">Ohne Stillstandskosten ${when}: ${esc(none.join(', '))}</div>` : ''}`
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
    // Prognose ab jetzt (Plantafel), Gutteile = Teile × FPY
    let fc = null; try { fc = WF.sim.forecast(); } catch (e) { fc = null; }
    const fpy = k.fpy || 1, fcH = forecastHours(fc, now, d0).map(v => v * fpy);
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
    let m2v = 10; for (let h = 6; h < 22; h++) m2v = Math.max(m2v, barVal(h));
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
      if (h < hNow) {
        if (act[h] > 0) g += `<rect x="${f(bx)}" y="${f(Y2(act[h]))}" width="${f(bw)}" height="${f(b2 - Y2(act[h]))}" rx="2.5" style="fill:var(--text2)" opacity=".5"/>`;
        tipTxt = `${lab}: ${U.fmtNum(act[h])} Gutteile`;
      } else if (h === hNow) {
        const a = act[h], r = fcH[h] || 0;
        if (r > 0.5) g += `<rect x="${f(bx)}" y="${f(Y2(a + r))}" width="${f(bw)}" height="${f(Y2(a) - Y2(a + r))}" rx="2.5" style="fill:var(--text2)" opacity=".22"/>`;
        if (a > 0) g += `<rect x="${f(bx)}" y="${f(Y2(a))}" width="${f(bw)}" height="${f(b2 - Y2(a))}" rx="2.5" style="fill:var(--text2)" opacity=".5"/>`;
        tipTxt = `${lab}: bisher ${U.fmtNum(a)} Gutteile · bis ${U.fmtClock(ha + 3600)} ca. ${U.fmtNum(r)} weitere laut Prognose`;
      } else {
        const v = fcH[h] || 0;
        if (v >= 0.5) g += `<rect x="${f(bx + 0.5)}" y="${f(Y2(v) + 0.5)}" width="${f(bw - 1)}" height="${f(Math.max(1, b2 - Y2(v) - 0.5))}" rx="2.5" style="fill:var(--text2);stroke:var(--text2)" fill-opacity=".05" stroke-opacity=".42" stroke-dasharray="3 2"/>`;
        tipTxt = `${lab}: ca. ${U.fmtNum(v)} Gutteile laut Prognose (Plantafel)`;
      }
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
    const svg = `<svg class="an-chart" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="Gutteile heute: je Stunde und kumuliert, Ist gegen Plan und Prognose">${g}</svg>`;
    // Kopfzahlen – nach 22:00 wird am Ende des Tagesfensters verglichen (Geisterschicht separat)
    const after = now >= w1, cumAt = (t) => { let v = 0; for (let i = 0; i < cumPts.length; i++) { const p = cumPts[i]; if (p[0] <= t) v = p[1]; else { const p0 = cumPts[i - 1]; if (p0) v = p0[1] + (p[1] - p0[1]) * (t - p0[0]) / Math.max(1, p[0] - p0[0]); break; } } return v; };
    const istRef = after ? Math.round(cumAt(w1)) : good;
    const delta = planNow != null && P && now > P.t ? istRef - planNow : null;
    const tol = planNow != null ? Math.max(5, planNow * 0.02) : 5;
    const dTxt = delta == null ? '<small>eben eingefroren</small>' : Math.abs(delta) < tol ? '<small class="up">im Plan</small>'
      : `<small class="${delta < 0 ? 'down' : 'up'}">${delta >= 0 ? '+' : '−'}${U.fmtNum(Math.abs(delta))} ${delta >= 0 ? 'über' : 'unter'} Plan</small>`;
    const os = `
      <div><span class="l">Ist bis ${after ? '22:00' : 'jetzt'}</span><span class="v">${U.fmtNum(istRef)}<small>Gutteile</small></span></div>
      ${P ? `<div><span class="l">Plan bis ${after ? '22:00' : 'jetzt'} · Stand ${U.fmtClock(P.t)}</span><span class="v">${U.fmtNum(planNow)}${dTxt}</span></div>` : ''}
      ${after && good > istRef ? `<div><span class="l">Seit 22:00 (Geisterschicht)</span><span class="v">+${U.fmtNum(good - istRef)}<small>Gutteile</small></span></div>` : ''}
      ${fcEnd != null ? `<div><span class="l">Prognose bis 22:00</span><span class="v acc">≈ ${U.fmtNum(fcEnd)}<small>Gutteile</small></span></div>` : ''}`;
    host.innerHTML = `
      <div class="card-h an-ch"><h3>Ausstoß heute</h3><span class="muted">Gutteile aller Arbeitsgänge · Prognose aus der Plantafel</span></div>
      <div class="card-b an-flowbox"><div class="an-os">${os}</div>${svg}
        <div class="an-legend"><span><i class="act"></i>Ist je Stunde</span><span><i class="gh"></i>Prognose je Stunde</span><span><i class="ln"></i>Ist kumuliert</span><span><i class="fc"></i>Prognose kumuliert</span>${P ? `<span><i class="pl"></i>Plan (Stand ${U.fmtClock(P.t)})</span>` : ''}</div></div>`;
  }

  // ------------------------------------------------------------ OEE je Maschine
  function renderOee() {
    const rows = machines().filter(id => S().machines[id].kind === 'machine').map(id => {
      const mv = WF.sim.machineView(id), o = (range === 'ks' ? mv.oeeShift : mv.oeeToday) || {};
      return { id, short: mv.short, oee: o.oee, a: o.availability, p: o.performance, q: o.quality };
    }).sort((a, b) => (a.oee == null ? -1 : a.oee) - (b.oee == null ? -1 : b.oee) || (a.id < b.id ? -1 : 1));
    const cls = (v) => v == null ? 'n' : v >= TARGET_OEE ? 'g' : v >= 0.55 ? 'y' : 'r';
    const below = rows.filter(r => r.oee != null && r.oee < TARGET_OEE).length;
    const struct = range + '|' + rows.map(r => r.id).join(',');
    paint('oee', q('[data-s="oee"]'), struct, (T, W, C, A) => `
      <div class="card-h an-ch"><h3>OEE je Maschine</h3>${T('osub', `${range === 'ks' ? 'laufende Schicht' : 'heute'} · ${below ? below + ' unter Ziel' : 'alle im Ziel'}`, 'span', 'class="muted"')}</div>
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

  // ------------------------------------------------------------ Energie je Teil
  function renderEnergy(k) {
    const E = energyModel(), pr = price(), rows = E.rows, max = Math.max(0.1, ...rows.map(r => r.kwh));
    const topR = rows[0];
    const struct = rows.map(r => r.id).join(',') + '|' + (pr ? 'p' : '');
    const ins = topR && E.total > 0
      ? `<b>${esc(topR.short)}</b> braucht ${pct0(topR.kwh / E.total)} der Maschinenenergie heute${topR.pp != null ? ` – <strong style="color:var(--text)">${kwh(topR.pp)} kWh</strong> je Teil` : ''}.` +
        ` Maschinen gesamt ${U.fmtNum(E.total)} kWh${pr ? ` ≈ ${U.fmtEur(E.total * pr)} (${U.fmtNum(pr, 2)} €/kWh)` : ''}.`
      : 'Noch kein Energieverbrauch erfasst.';
    const insN = nb(ins);
    const hist = (S().history.powerKw || []).slice(-96);
    paint('energy', q('[data-s="energy"]'), struct, (T, W, C, A) => `
      <div class="card-h an-ch"><h3>Energie je Maschine heute</h3>${T('pw', `${WF.ui.spark(hist, { w: 96, h: 22, color: 'var(--text2)' })}<b>${U.fmtNum(k.powerKw)} kW</b><span>jetzt</span>`, 'span', 'class="an-pw" title="Leistungsaufnahme des Werks (letzte 8 h)"')}</div>
      <div class="card-b">
        ${T('ins', insN, 'p', 'class="an-eins"')}
        ${rows.length ? `<div class="an-bars en">
          <div class="an-bh"><span></span><span style="text-align:left">Energie heute</span><span>kWh</span><span class="hm">je Teil</span></div>
          ${rows.map(r => {
            const tipTxt = `${r.short}: ${U.fmtNum(r.kwh, 1)} kWh heute, ${U.fmtNum(r.good)} Gutteile${r.pp != null ? ' → ' + kwh(r.pp) + ' kWh je Teil' + (pr ? ' ≈ ' + U.fmtEur(r.pp * pr, 2) : '') : ' – noch kein Gutteil'}`;
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
    // Tagesplan: einmal je Tag (Schichtbeginn bzw. nach Start); Rückfall, falls kein Ereignis kam
    const d0 = U.dayStart(Sx.t);
    if ((!plan || plan.day !== d0) && !planTimer && Sx.t >= d0 + 6 * 3600 && WF.sim.shift && WF.sim.shift().id) takePlan();
    const fb = q('[data-s="flow"] .an-flowbox') || q('[data-s="flow"]');
    if (fb && fb.clientWidth) { const w = fb.clientWidth - 28; if (Math.abs(w - flowW) > 4) { flowW = w; force = true; } }
    const key = range + '|' + Math.floor(Sx.t / 60) + '|' + flowW;
    const slow = force || key !== slowKey;
    if (slow) { slowKey = key; bneckCache = bneck(); }
    const L = lossModel();
    const totalEur = range === 'kd' && k.lossEur != null ? k.lossEur : Math.round(L.total);   // eine Zahl mit dem Leitstand
    renderKpis(k, L, totalEur);
    renderHero(L, totalEur);
    renderMatrix(L);
    if (slow) { renderFlow(k); renderOee(); renderEnergy(k); }
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
          WF.bus.emit('ai:ask', { text: `Analysiere die Stillstandskosten „${label}“ ${range === 'ks' ? 'in dieser Schicht' : 'heute'}, besonders an ${st ? st.short : id}: Ursachen, Kosten und konkrete Maßnahmen für die nächste Schicht.`, context: { kind: 'machine', id } });
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
