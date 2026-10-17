/* werkfluss – Ansicht „Leitstand“ (40_leitstand.js)
   Erste Ansicht des Produktionsleiters und TV-Wandtafel: Kopf mit Schicht/Personal, KPI-Leiste,
   Kachel je Arbeitsplatz (Zustand, Ursache, Auftrag, Fortschritt, kritischstes Werkzeug, Bediener,
   Puffer und Materialfluss, Zustandsband 4 h), rechts „Jetzt wichtig“, KI-Schichtbriefing, „Gerade passiert“.
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
  const URGENCY = { fault: 0, waitTool: 1, waitOperator: 1, starved: 1, blocked: 1, toolchange: 2, setup: 2, firstPiece: 2, idle: 3, running: 4 };
  const STATE_GROUPS = [
    { key: 'prod', label: 'Produktion', color: 'var(--st-run)', match: (s) => s === 'running' },
    { key: 'setup', label: 'Rüsten/Prüfen', color: 'var(--st-setup)', match: (s) => !!SETUPISH[s] },
    { key: 'wait', label: 'Wartet', color: 'var(--st-wait)', match: (s) => !!WAIT[s] },
    { key: 'fault', label: 'Störung', color: 'var(--st-fault)', match: (s) => s === 'fault' },
    { key: 'idle', label: 'Bereit', color: 'var(--st-idle)', match: (s) => s === 'idle' },
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
  const tclock = (t, now) => (Math.floor(t / 86400) === Math.floor(now / 86400) ? U.fmtClock(t) : U.fmtDayClock(t));
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
  .ls-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 18px;flex-wrap:wrap}
  .ls-head .view-sub{display:flex;flex-wrap:wrap;gap:0 6px}
  .ls-head-r{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap;min-width:0}
  .ls-shift{display:flex;align-items:stretch;background:var(--card);border:1px solid var(--line);border-radius:var(--r);min-width:0}
  .ls-sh{display:flex;align-items:center;gap:9px;padding:7px 13px;min-width:0}
  .ls-sh + .ls-sh{border-left:1px solid var(--line)}
  .ls-sh .eyebrow{display:block;font-size:9.5px;margin-bottom:3px}
  .ls-sh b{display:block;font-weight:600;font-size:13px;white-space:nowrap}
  .ls-sh small{color:var(--muted);font-size:11.5px;white-space:nowrap}
  .ls-sh .ls-dot{width:8px;height:8px;border-radius:50%;background:var(--c,var(--st-run));box-shadow:0 0 0 3px color-mix(in srgb,var(--c,var(--st-run)) 22%,transparent);flex:none}
  .ls-tvbtn{align-self:center}

  .ls-kpis{display:grid;gap:10px;grid-template-columns:minmax(0,1.45fr) repeat(5,minmax(0,1fr))}
  .ls-kpis .kpi{position:relative;display:flex;flex-direction:column}
  .ls-kpis .kpi.click{cursor:pointer}
  .ls-kpis .kpi.click:hover{border-color:var(--line2)}
  .ls-kpis .kpi .v{display:flex;align-items:baseline;gap:6px}
  .ls-kpis .kpi .v small{margin-left:0}
  .ls-k-row{display:flex;align-items:flex-end;gap:12px;min-width:0}
  .ls-k-row .v{flex:none}
  .ls-k-spark{flex:1;min-width:60px;height:34px;margin-bottom:3px}
  .ls-k-spark svg{display:block;width:100%;height:34px;overflow:visible}
  .ls-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .ls-kpis .kpi .s .ok{color:var(--st-run)} .ls-kpis .kpi .s .warn{color:var(--st-wait)} .ls-kpis .kpi .s .crit{color:var(--st-fault)}
  .ls-k-badge{position:absolute;top:10px;right:12px;font:600 10.5px/1 var(--f-ui);padding:3px 6px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}

  .ls-main{display:grid;grid-template-columns:minmax(0,1fr) 344px;gap:14px;align-items:start}
  .ls-side{display:flex;flex-direction:column;gap:14px;min-width:0}
  .ls-machines{min-width:0}
  .ls-bar{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;margin-bottom:10px}
  .ls-bar h2{margin:0;font:600 15px/1.2 var(--f-ui)}
  .ls-sum{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
  .ls-sum button{--c:var(--st-idle);display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
  .ls-sum button i{width:8px;height:8px;border-radius:50%;background:var(--c)}
  .ls-sum button b{font-variant-numeric:tabular-nums;color:var(--text)}
  .ls-sum button.zero{opacity:.5}
  .ls-sum button.on{border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 14%,var(--card))}
  .ls-sum button:hover{border-color:var(--line2)}
  .ls-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(256px,1fr))}
  .ls-empty-filter{grid-column:1/-1}

  .ls-tile{--c:var(--st-idle);position:relative;display:flex;flex-direction:column;gap:7px;min-width:0;padding:10px 13px 11px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;outline-offset:2px;transition:border-color .15s ease,background-color .15s ease}
  .ls-tile:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 55%,var(--card))}
  .ls-tile.sel{border-color:color-mix(in srgb,var(--accent) 70%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
  .ls-tile.sev{box-shadow:inset 3px 0 0 var(--c)}
  .ls-tile.sev.sel{box-shadow:inset 3px 0 0 var(--c),0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
  .ls-tile.crit{background:color-mix(in srgb,var(--st-fault) 7%,var(--card));border-color:color-mix(in srgb,var(--st-fault) 38%,var(--line))}
  .ls-tile.crit:hover{background:color-mix(in srgb,var(--st-fault) 10%,var(--card))}
  .ls-th{display:flex;align-items:center;gap:8px;min-width:0}
  .ls-name{display:flex;align-items:baseline;gap:7px;min-width:0;flex:1}
  .ls-name b{font:600 18px/1.15 var(--f-cond);letter-spacing:.01em;white-space:nowrap;flex:none;max-width:70%;overflow:hidden;text-overflow:ellipsis}
  .ls-name .ls-id{font:500 11.5px/1 var(--f-mono);color:var(--muted);flex:none}
  .ls-name .ls-area{font:600 9.5px/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-th .conn{flex:none}
  .ls-st{display:flex;align-items:center;gap:8px;min-width:0}
  .ls-st .pill{font-size:12.5px;line-height:20px;padding:2px 10px 2px 8px}
  .ls-st .pill i{width:8px;height:8px}
  .ls-tile[data-state="running"] .ls-st .pill i{animation:lsPulse 1.8s ease-in-out infinite}
  @keyframes lsPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 55%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 0%,transparent)}}
  .ls-since{font-size:11.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .ls-cause{font-size:12px;line-height:1.38;color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.76em;overflow-wrap:anywhere}
  .ls-tile.crit .ls-cause{color:color-mix(in srgb,var(--st-fault) 55%,var(--text))}
  .ls-sep{height:1px;background:var(--line);margin:1px 0}
  .ls-ordb{display:flex;flex-direction:column;gap:2px;min-width:0;border-top:1px solid var(--line);padding-top:8px;margin-top:1px}
  .ls-ord{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:13px}
  .ls-ord .mono{color:var(--text);font-weight:500;flex:none;font-size:12px}
  .ls-ord .ls-pn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ls-risk{--c:var(--st-wait);flex:none;align-self:center;font:600 10px/1 var(--f-ui);letter-spacing:.03em;padding:3px 6px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
  .ls-ord.none .ls-pn{font-weight:500;color:var(--muted)}
  .ls-op{font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ls-op b{font-weight:600;color:var(--muted);font-family:var(--f-mono);font-size:11px;margin-right:5px}
  .ls-op em{font-style:normal;color:var(--faint)}
  .ls-prog{display:flex;flex-direction:column;gap:4px}
  .ls-prog-t{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .ls-prog-t b{font-weight:600}
  .ls-prog-t span{color:var(--muted);overflow:hidden;text-overflow:ellipsis}
  .ls-prog .bar{height:5px}
  .ls-prog .bar i{transition:width .5s linear}
  .ls-tool{--tc:var(--muted);display:flex;flex-direction:column;gap:2px;min-width:0;padding:5px 8px;border-radius:7px;background:color-mix(in srgb,var(--tc) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--tc) 16%,transparent)}
  .ls-tool-n{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);min-width:0}
  .ls-tool-n .ico{color:var(--tc);flex:none}
  .ls-tool-n > span:not(.ls-wear){white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
  .ls-wear{display:inline-flex;align-items:center;gap:5px;flex:none}
  .ls-wear-b{display:block;width:34px;height:4px;border-radius:2px;background:var(--track);overflow:hidden}
  .ls-wear-b i{display:block;height:100%;background:var(--tc);border-radius:inherit}
  .ls-wear b{font:500 10.5px/1 var(--f-mono);color:var(--muted);min-width:30px;text-align:right}
  .ls-tool-s{font-size:11.5px;font-weight:600;color:color-mix(in srgb,var(--tc) 78%,var(--text));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:19px;font-variant-numeric:tabular-nums}
  .ls-tool.u-ok .ls-tool-s{font-weight:500;color:var(--text2)}
  .ls-tool.u-faint{background:transparent;border-color:transparent;padding:0}
  .ls-tool.u-faint .ls-tool-n{color:var(--faint)}
  .ls-foot{display:flex;align-items:center;gap:10px;min-width:0;margin-top:auto;padding-top:1px}
  .ls-band{flex:1;min-width:0}
  .ls-op8{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px}
  .ls-op8 .avatar{width:22px;height:22px;font-size:9.5px}
  .ls-op8 .avatar.wait{color:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 50%,transparent)}
  .ls-op8 .avatar.auto{color:var(--st-run);border-color:color-mix(in srgb,var(--st-run) 40%,transparent)}
  .ls-op8 .avatar.none{color:var(--faint)}
  .ls-op8 span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--text2)}
  .ls-op8 span em{font-style:normal;color:var(--muted)}
  .ls-op8.wait span{color:color-mix(in srgb,var(--st-wait) 75%,var(--text))}
  .ls-more{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 5px;margin-left:2px;border-radius:11px;background:var(--raise);border:1px solid var(--line2);font:600 10px/1 var(--f-ui);color:var(--text2);flex:none}
  .ls-buf{display:flex;align-items:center;gap:4px;flex:none;font:600 9.5px/1 var(--f-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
  .ls-buf .ls-arr + .ls-slots{margin-right:5px}
  .ls-buf .ls-slots:last-child{margin-right:0}
  .ls-buf .ls-slots{display:inline-flex;gap:2px}
  .ls-buf .ls-slots i{width:5px;height:9px;border-radius:1.5px;background:var(--track);border:1px solid var(--line2)}
  .ls-buf .ls-slots i.f{background:var(--mat);border-color:var(--mat)}
  .ls-buf .ls-slots.full i.f{background:var(--st-wait);border-color:var(--st-wait)}
  .ls-buf .ls-arr{color:var(--faint)}
  .ls-buf .ls-cnt-t{font:500 10.5px/1 var(--f-mono);letter-spacing:0;text-transform:none;color:var(--muted);margin-right:5px}
  .ls-buf .ls-cnt-t:last-child{margin-right:0}
  .ls-band svg{display:block;border-radius:2px}

  .ls-side .card-h h3{display:flex;align-items:center;gap:7px}
  .ls-side .card-h h3 .ico{color:var(--muted)}
  .ls-cnt{display:inline-grid;place-items:center;min-width:20px;height:18px;padding:0 6px;border-radius:9px;font:700 11px/1 var(--f-ui);background:var(--raise);color:var(--text2)}
  .ls-cnt.crit{background:var(--st-fault);color:#1b0606}
  .ls-cnt.warn{background:var(--st-wait);color:#231703}
  .ls-now-list{display:flex;flex-direction:column}
  .ls-n{--c:var(--st-wait);position:relative;padding:11px 14px 11px 16px;border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 var(--c)}
  .ls-n:last-child{border-bottom:0}
  .ls-n.ack{opacity:.72;box-shadow:inset 3px 0 0 color-mix(in srgb,var(--c) 45%,transparent)}
  .ls-n-top{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);min-width:0;white-space:nowrap}
  .ls-n-top .sev{font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:10px;color:var(--c);flex:none}
  .ls-n-top > span:nth-child(2){overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ls-n-top .link{font-size:11.5px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%;flex:none}
  .ls-n-t{font-weight:600;font-size:13px;line-height:1.3;margin:4px 0 2px}
  .ls-n-b{font-size:12px;color:var(--text2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .ls-n-s{margin-top:7px;font-size:12px;line-height:1.4;color:var(--text2);padding:6px 9px;border-radius:7px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 18%,transparent)}
  .ls-n-s b{color:var(--accent);font-weight:600}
  .ls-n-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .ls-n-a .btn.sm{height:26px;font-size:11.5px;padding:0 9px}
  .ls-n-st{font-size:11px;color:var(--muted);align-self:center}
  .ls-now-ok{display:flex;gap:10px;align-items:flex-start;padding:14px;font-size:12.5px;color:var(--text2)}
  .ls-now-ok .ico{color:var(--st-run);flex:none;margin-top:1px}
  .ls-now-more{display:block;width:100%;padding:9px 14px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;text-align:left}
  .ls-next{border-top:1px solid var(--line);padding:10px 14px 12px}
  .ls-next .eyebrow{display:block;margin-bottom:7px}
  .ls-next-row{display:grid;grid-template-columns:44px 16px minmax(0,1fr);gap:6px;align-items:baseline;font-size:12px;padding:3px 0;color:var(--text2);cursor:pointer}
  .ls-next-row:hover span:last-child{color:var(--text)}
  .ls-next-row .num{color:var(--muted);font-size:11.5px}
  .ls-next-row .ico{color:var(--c);align-self:center}
  .ls-next-row span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .ls-brief .card-b{display:flex;flex-direction:column;gap:9px}
  .ls-brief-h{font-weight:600;font-size:13.5px;line-height:1.4}
  .ls-brief ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
  .ls-brief li{--c:var(--info);position:relative;padding-left:14px;font-size:12.3px;line-height:1.42;color:var(--text2)}
  .ls-brief li::before{content:"";position:absolute;left:1px;top:.5em;width:6px;height:6px;border-radius:50%;background:var(--c)}
  .ls-brief li .link{font-size:inherit}
  .ls-brief-f{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--faint);flex-wrap:wrap}
  .ls-brief-f .spacer{flex:1}
  .ls-mode{font:600 10px/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:3px 6px;border-radius:5px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent)}
  .ls-ibtn{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}
  .ls-ibtn:hover{color:var(--text);border-color:var(--line2)}

  .ls-feed-list{display:flex;flex-direction:column;padding:4px 0}
  .ls-ev{--c:var(--muted);display:grid;grid-template-columns:40px 22px minmax(0,1fr);gap:6px;align-items:start;padding:6px 14px;font-size:12px;line-height:1.38;border:0;background:transparent;color:inherit;text-align:left;width:100%}
  .ls-ev.link-ev{cursor:pointer}
  .ls-ev.link-ev:hover{background:color-mix(in srgb,var(--raise) 40%,transparent)}
  .ls-ev .num{color:var(--muted);font-size:11.5px;padding-top:1px}
  .ls-ev .ls-ev-i{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
  .ls-ev .ls-ev-m{color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .ls-ev.new{animation:lsIn .6s ease}
  @keyframes lsIn{from{background:color-mix(in srgb,var(--accent) 14%,transparent)}to{background:transparent}}

  /* TV-Modus (Hallen-Wandtafel 1080p): keine Bedienelemente, größere Schrift, kompakte Kachel – alle 13 Arbeitsplätze ohne Scrollen */
  .ls-tool-x{display:none;font-weight:500;color:var(--muted)}
  .ls-tvexit,.ls-tvinfo{display:none}
  .ls-root.ls-tv .ls-tvhide,.ls-root.ls-tv .ls-head{display:none !important}
  .ls-root.ls-tv .ls-tvexit{display:inline-flex}
  .ls-root.ls-tv .ls-tvinfo{display:block;margin-left:auto;font-size:12.5px;color:var(--muted);white-space:nowrap}
  .ls-root.ls-tv .ls-sum{flex:0 1 auto}
  .ls-root.ls-tv .ls-sum button{height:30px;font-size:13px}
  .ls-root.ls-tv .ls-kpis .kpi .v{font-size:36px}
  .ls-root.ls-tv .ls-kpis .kpi .l{font-size:11.5px}
  .ls-root.ls-tv .ls-kpis .kpi .s{font-size:13px}
  .ls-root.ls-tv .ls-main{grid-template-columns:minmax(0,1fr) 360px}
  .ls-root.ls-tv .ls-grid{grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:10px}
  .ls-root.ls-tv .ls-tile{gap:6px;padding:10px 12px}
  .ls-root.ls-tv .ls-name b{font-size:21px}
  .ls-root.ls-tv .ls-name .ls-area,.ls-root.ls-tv .ls-th .conn,.ls-root.ls-tv .ls-op,.ls-root.ls-tv .ls-tool-n,.ls-root.ls-tv .ls-buf{display:none}
  .ls-root.ls-tv .ls-st .pill{font-size:14px;line-height:22px}
  .ls-root.ls-tv .ls-since{font-size:13px}
  .ls-root.ls-tv .ls-cause{font-size:13.5px}
  .ls-root.ls-tv .ls-ord{font-size:14.5px}
  .ls-root.ls-tv .ls-prog-t,.ls-root.ls-tv .ls-op8{font-size:13px}
  .ls-root.ls-tv .ls-tool{padding:4px 8px}
  .ls-root.ls-tv .ls-tool-s{padding-left:0;font-size:13px}
  .ls-root.ls-tv .ls-tool-x{display:inline}
  .ls-root.ls-tv .ls-prog .bar{height:6px}
  .ls-root.ls-tv .ls-n-t{font-size:14.5px}
  .ls-root.ls-tv .ls-n-b,.ls-root.ls-tv .ls-n-s,.ls-root.ls-tv .ls-ev,.ls-root.ls-tv .ls-brief li{font-size:13px}
  .ls-root.ls-tv .ls-brief-h{font-size:14.5px}

  @media (max-width:1320px){.ls-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media (max-width:1100px){
    .ls-main{display:flex;flex-direction:column}
    .ls-side{display:contents}
    .ls-now{order:1}.ls-machines{order:2}.ls-brief{order:3}.ls-feed{order:4}
    .ls-main > *, .ls-side > *{width:100%}
  }
  @media (max-width:640px){
    .ls-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .ls-kpis .ls-k-oee{grid-column:1/-1}
    .ls-shift{width:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .ls-sh{min-width:0}
    .ls-sh:first-child{grid-column:1/-1;border-bottom:1px solid var(--line)}
    .ls-sh + .ls-sh:nth-child(2){border-left:0}
    .ls-sh b,.ls-sh small{white-space:normal}
    .ls-kpis .kpi:last-child{grid-column:1/-1}
    .ls-sum{flex:1 1 100%}
    .ls-bar .seg{width:100%}
    .ls-bar .seg button{flex:1}
    .ls-head-r{width:100%}
    .ls-tvbtn{display:none}
    .ls-grid{grid-template-columns:minmax(0,1fr)}
    .ls-kpis .kpi .v{font-size:25px}
    .ls-cause{min-height:0}
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
  let feedNodes = new Map(), feedLastId = null;
  let brief = { t: -1e9, data: null, pending: false, sig: '' };
  let kpiCache = { t: -1, risk: null };
  let lastNextSig = '';

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
          <div class="l">OEE heute</div>
          <div class="ls-k-row"><div class="v" data-r="kOeeV">–</div><div class="ls-k-spark" data-r="kOeeSpark"></div></div>
          <div class="s" data-r="kOeeS1">–</div>
          <div class="s" data-r="kOeeS2">–</div>
        </div>
        <div class="kpi click" data-r="kGood" data-nav="auftraege" title="Gutteile, die heute den letzten Bearbeitungsschritt ihres Auftrags abgeschlossen haben">
          <div class="l">Fertige Teile heute</div><div class="v" data-r="kGoodV">–</div><div class="s" data-r="kGoodS">–</div><div class="s" data-r="kGoodS2">–</div>
        </div>
        <div class="kpi click" data-r="kOt" data-nav="auftraege" title="Anteil der Aufträge, die laut Prognose (bzw. tatsächlich) termingerecht und vollständig geliefert werden">
          <div class="l">Termintreue</div><div class="v" data-r="kOtV">–</div><div class="s" data-r="kOtS">–</div><div class="s" data-r="kOtS2">–</div>
        </div>
        <div class="kpi click" data-r="kLoss" title="Maschinenstundensatz × Zeit in der Schicht, in der ein Auftrag eingeplant ist, die Maschine aber nicht produziert (Rüsten, Warten, Störung)">
          <div class="l">Stillstandkosten</div><div class="v" data-r="kLossV">–</div><div class="s" data-r="kLossS">–</div><div class="s" data-r="kLossS2">–</div>
        </div>
        <div class="kpi" data-r="kEn" title="Elektrische Leistung der Halle (Maschinen, AGVs, Grundlast) – gemessen bzw. aus Zustand geschätzt">
          <div class="l">Energie</div>
          <div class="ls-k-row"><div class="v" data-r="kEnV">–</div><div class="ls-k-spark" data-r="kEnSpark"></div></div>
          <div class="s" data-r="kEnS">–</div>
        </div>
        <div class="kpi click" data-r="kMsg" title="Offene Warnungen und Störungen">
          <div class="l">Offene Meldungen</div><div class="v" data-r="kMsgV">–</div><div class="s" data-r="kMsgS">–</div><div class="s" data-r="kMsgS2">–</div>
        </div>
      </div>

      <div class="ls-main">
        <section class="ls-machines" aria-label="Arbeitsplätze">
          <div class="ls-bar">
            <div class="ls-sum" data-r="sum" role="group" aria-label="Nach Zustand filtern"></div>
            <div class="seg ls-tvhide" role="group" aria-label="Reihenfolge" data-r="sortSeg">
              <button data-sort="flow" class="on" title="Reihenfolge des Materialflusses durch die Halle">Materialfluss</button>
              <button data-sort="urgent" title="Störungen und Wartezeiten zuerst">Handlungsbedarf</button>
            </div>
            <span class="ls-tvinfo" data-r="tvInfo"></span>
            <button class="btn sm ghost ls-tvexit" data-r="tvExit" title="TV-Modus beenden (Esc)">${icon('x', 14)}TV beenden</button>
          </div>
          <div class="ls-grid" data-r="grid"></div>
        </section>
        <div class="ls-side">
          <section class="card ls-now" data-r="nowCard" aria-label="Jetzt wichtig">
            <div class="card-h"><h3>${icon('alert', 16)}Jetzt wichtig</h3><span class="ls-cnt" data-r="nowCnt">0</span></div>
            <div class="ls-now-list" data-r="nowList"></div>
            <button class="ls-now-more ls-tvhide" data-r="nowMore" hidden></button>
            <div class="ls-next" data-r="next"></div>
          </section>
          <section class="card ls-brief" aria-label="KI-Schichtbriefing">
            <div class="card-h"><h3>${icon('sparkles', 16)}KI-Schichtbriefing</h3>
              <div class="row" style="gap:6px"><span class="ls-mode" data-r="briefMode">–</span><button class="ls-ibtn ls-tvhide" data-r="briefRefresh" title="Briefing neu erstellen" aria-label="Briefing neu erstellen">${icon('refresh', 15)}</button></div></div>
            <div class="card-b" data-r="briefBody"><div class="muted">Briefing wird erstellt …</div></div>
          </section>
          <section class="card ls-feed" aria-label="Gerade passiert">
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
    buildSummary();

    // Ereignisse
    R.tvBtn.onclick = () => WF.app.setTv(true);
    R.tvExit.onclick = () => WF.app.setTv(false);
    R.sortSeg.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
      sortMode = b.dataset.sort;
      R.sortSeg.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
      applyOrder(true);
    });
    R.kGood.onclick = R.kOt.onclick = (e) => { if (hasView('auftraege')) WF.app.navigate('auftraege'); };
    R.kLoss.onclick = () => { const top = topLoss(); if (top) WF.app.select('machine', top.id); };
    R.kMsg.onclick = () => { R.nowCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    R.briefRefresh.onclick = () => refreshBrief(true);
    R.nowMore.onclick = () => { nowExpanded = !nowExpanded; renderNow(true); };
    R.next.addEventListener('click', (e) => {
      const row = e.target.closest('[data-ent]'); if (!row) return;
      const [k, i] = row.dataset.ent.split('|'); WF.app.select(k, i);
    });
    R.feed.addEventListener('click', (e) => {
      const row = e.target.closest('[data-ent]'); if (!row) return;
      const [k, i] = row.dataset.ent.split('|'); WF.app.select(k, i);
    });
    R.briefBody.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ent]'); if (!a) return;
      const [k, i] = a.dataset.ent.split('|'); WF.app.select(k, i);
    });

    WF.bus.on('select', (s) => { selected = s && s.kind === 'machine' ? s.id : null; for (const id in tiles) tiles[id].el.classList.toggle('sel', id === selected); });
    WF.bus.on('settings', () => {
      const cc = WF.app.company(); setText(R.company, cc.name); setText(R.site, cc.site);
      setTvClass();
    });
    WF.bus.on('sim:reset', () => {
      lastMVs = {}; kpiCache = { t: -1, risk: null }; brief = { t: -1e9, data: null, pending: false, sig: '' };
      feedLastId = null; for (const n of feedNodes.values()) n.remove(); feedNodes.clear();
      for (const n of nowNodes.values()) n.remove(); nowNodes.clear(); lastNextSig = '';
      for (const id in tiles) { tiles[id].vm = {}; }
    });
    setTvClass();
  }

  function setTvClass() {
    tv = !!(WF.app.tv || (document.getElementById('app') || {}).classList && document.getElementById('app').classList.contains('tv'));
    if (root) root.firstElementChild.classList.toggle('ls-tv', tv);
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
        <span class="conn" data-r="conn"></span>
      </div>
      <div class="ls-st"><span data-r="pill"></span><span class="ls-since" data-r="since"></span></div>
      <div class="ls-cause" data-r="cause"></div>
      <div class="ls-ordb">
        <div class="ls-ord" data-r="ord"><span class="mono" data-r="oid"></span><span class="ls-pn" data-r="pn"></span><span class="ls-risk" data-r="risk" hidden></span></div>
        <div class="ls-op" data-r="op"></div>
      </div>
      <div class="ls-prog" data-r="prog"><div class="ls-prog-t"><b data-r="progL"></b><span data-r="progR"></span></div><span class="bar" data-r="bar" style="--c:var(--st-run)"><i data-r="barI" style="width:0%"></i></span></div>
      <div class="ls-tool" data-r="tool">
        <div class="ls-tool-n">${icon('wrench', 13)}<span data-r="toolN"></span><span class="ls-wear" data-r="wear" hidden><span class="ls-wear-b"><i data-r="wearI"></i></span><b data-r="wearT"></b></span></div>
        <div class="ls-tool-s"><span data-r="toolS"></span><span class="ls-tool-x" data-r="toolX"></span></div>
      </div>
      <div class="ls-op8" data-r="opr"><span class="avatar" data-r="av"></span><span data-r="oprT"></span><span class="ls-more" data-r="more" hidden></span></div>
      <div class="ls-foot"><div class="ls-band" data-r="bandBox"><div data-r="band"></div></div><div class="ls-buf" data-r="buf"></div></div>`;
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
    switch (t.status) {
      case 'broken': return Object.assign(base, { status: 'gebrochen – Wechsel nötig', u: 'crit', c: 'var(--st-fault)' });
      case 'due': return Object.assign(base, { status: `Standzeit erschöpft · ${pc && pc.by ? pc.by + ' ' + (pc.stage || 'kommt') : pc && pc.etaT != null ? 'Wechsel ' + when : 'Wechsel angefordert'}`, u: 'warn', c: 'var(--st-wait)' });
      case 'changing': return Object.assign(base, { status: 'wird gerade gewechselt', u: 'tool', c: 'var(--st-tool)' });
      case 'planned': {
        const stop = pc && pc.waitFromT != null;
        return Object.assign(base, { status: `noch ${teile(t.remainingParts)} · ${pc && pc.manual ? 'vorbeugender ' : ''}Wechsel ${when}${stop ? ' · Stopp ab ' + tclock(pc.waitFromT, now) : ''}`, u: stop ? 'warn' : 'tool', c: stop ? 'var(--st-wait)' : 'var(--st-tool)' });
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

  function bufHTML(mv) {
    const slots = (n, cap) => {
      if (!cap) return '';
      if (cap > 4) return `<span class="ls-slots${n >= cap ? ' full' : ''}"><i class="${n ? 'f' : ''}"></i></span><span class="ls-cnt-t">${n}/${cap}</span>`;
      const k = Math.min(n, cap);
      let s = `<span class="ls-slots${n >= cap ? ' full' : ''}">`;
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
    let h = '';
    if (mv.inCap) h += `<span class="ls-arr">Ein</span>` + slots(mv.input.length, mv.inCap);
    else if (mv.barStockM != null) h += `<span class="ls-arr">Stange</span><span class="ls-cnt-t">${U.fmtNum(mv.barStockM, 1)} m</span>`;
    else if (mv.type === 'saw') h += '<span class="ls-arr">Lager</span>';
    if (mv.outCap) h += `<span class="ls-arr">Aus</span>` + slots(mv.output.length, mv.outCap);
    const title = [
      mv.inCap ? `Eingang ${mv.input.length}/${mv.inCap} Behälter${prev ? ' (Teile von ' + WF.sim.stationName(prev) + ')' : ''}` : mv.type === 'saw' ? 'Säge entnimmt Stangen direkt aus dem Rohmaterial-Lager' : mv.barStockM != null ? `Stangenmagazin ${U.fmtNum(mv.barStockM, 1)} von ${U.fmtNum(mv.barMagazineM, 0)} m` : '',
      mv.outCap ? `Ausgang ${mv.output.length}/${mv.outCap} Behälter${next ? ' (weiter an ' + WF.sim.stationName(next) + ')' : ''}` : '',
    ].filter(Boolean).join(' · ');
    return { h, title };
  }

  function tileVM(mv, now) {
    const st = WF.STATE[mv.state] || WF.STATE.idle;
    const vm = {
      state: mv.state, color: st.color,
      sev: mv.state === 'fault' ? 'crit' : WAIT[mv.state] ? 'warn' : '',
      pill: WF.ui.pill(mv.state),
      since: sinceText(mv.sinceSec),
      sinceTitle: 'seit ' + U.fmtDayClock(mv.since),
      cause: mv.cause || '–',
      conn: 'L' + (mv.conn.level || 0), connL: String(mv.conn.level || 0),
      connTitle: `Anbindung Level ${mv.conn.level}: ${WF.sim.LABELS.conn[mv.conn.level] || ''} – ${mv.conn.protocol || ''}`,
    };
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
      if ((mv.phase === 'Rüsten' || mv.phase === 'Rüsten ausstehend') && done > 0) left = `${U.fmtNum(done)} von ${U.fmtNum(total)} fertig`;
      else if (mv.phase === 'Rüsten' || mv.phase === 'Rüsten ausstehend' || mv.phase === 'Erstteilprüfung' || mv.phase === 'Korrektur') left = `${mv.phase} · ${U.fmtNum(done)} von ${U.fmtNum(total)}`;
      else if (running) left = `${mv.phase === 'Erstteil' ? 'Erstteil · ' : ''}Teil ${U.fmtNum(mv.partNo)} von ${U.fmtNum(total)}`;
      else left = `${U.fmtNum(done)} von ${U.fmtNum(total)} fertig`;
      vm.progL = left;
      vm.progR = mv.etaOpEnd != null ? 'fertig ca. ' + tclock(mv.etaOpEnd, now) : '';
      vm.progTitle = `${done} von ${total} Teilen bearbeitet${running ? `, Teil ${mv.partNo} ${mv.partSub === 'load' ? 'wird eingelegt' : 'zu ' + Math.round(mv.partProgress * 100) + ' %'}` : ''}${mv.etaOpEnd != null ? ' · Arbeitsgang fertig ca. ' + U.fmtDayClock(mv.etaOpEnd) : ''}`;
      vm.frac = total ? Math.min(1, (done + (running ? mv.partProgress : 0)) / total) : 0;
      vm.barC = st.color;
    } else {
      const q = mv.queue[0];
      vm.oid = ''; vm.pn = q ? 'Kein Auftrag aktiv' : 'Kein Auftrag eingeplant'; vm.none = true; vm.risk = ''; vm.riskC = ''; vm.riskTitle = '';
      vm.op = q ? `<em>Als Nächstes:</em> ${esc(q.orderId)} AG ${esc(q.seq)} <em>· ${esc(q.why)}</em>` : '';
      vm.opTitle = mv.queue.map(x => `${x.orderId} AG ${x.seq} ${x.op} – ${x.parts} Teile – ${x.why}`).join('\n');
      vm.progL = ''; vm.progR = ''; vm.frac = 0; vm.progTitle = '';
    }
    const tl = toolLine(mv, now);
    vm.toolN = tl ? tl.name : ''; vm.toolS = tl ? tl.status : ''; vm.toolU = tl ? tl.u : ''; vm.toolC = tl ? tl.c : ''; vm.toolTitle = tl ? tl.title : '';
    vm.wear = tl && tl.wear != null ? tl.wear : null;
    const op = operatorLine(mv);
    vm.oprCls = op.cls; vm.av = op.av; vm.avCls = op.avCls; vm.opr = op.html; vm.oprTitle = op.title;
    vm.more = op.more ? '+' + op.more.n : ''; vm.moreTitle = op.more ? op.more.title : '';
    const b = bufHTML(mv); vm.buf = b.h; vm.bufTitle = b.title;
    const segs = mv.segments || [];
    const last = segs[segs.length - 1];
    vm.bandKey = segs.length + '|' + (last ? last.state + last.t0 : '') + '|' + Math.floor(now / 60);
    vm.bandTitle = `Zustände ${U.fmtClock(now - BAND_SEC)}–${U.fmtClock(now)} (letzte 4 h)`;
    vm.aria = `${mv.short} ${mv.id}: ${st.label}, ${vm.since}. ${vm.cause}`;
    return vm;
  }

  function patchTile(t, mv, now) {
    const vm = tileVM(mv, now), p = t.vm, r = t.r, el = t.el;
    if (p.state !== vm.state) { el.dataset.state = vm.state; setVar(el, '--c', vm.color); setHTML(r.pill, vm.pill); }
    if (p.sev !== vm.sev) { el.classList.toggle('sev', !!vm.sev); el.classList.toggle('crit', vm.sev === 'crit'); }
    setText(r.since, vm.since); setAttr(r.since, 'title', vm.sinceTitle);
    setText(r.cause, vm.cause); setAttr(r.cause, 'title', vm.cause);
    setText(r.conn, vm.conn); setAttr(r.conn, 'data-l', vm.connL); setAttr(r.conn, 'title', vm.connTitle);
    setText(r.oid, vm.oid); setText(r.pn, vm.pn); setAttr(r.pn, 'title', vm.pn);
    if (p.none !== vm.none) { r.ord.classList.toggle('none', vm.none); r.prog.hidden = vm.none; r.oid.hidden = vm.none; }
    setAttr(r.risk, 'hidden', !vm.risk); setText(r.risk, vm.risk); setAttr(r.risk, 'title', vm.riskTitle); if (vm.riskC) setVar(r.risk, '--c', vm.riskC);
    setHTML(r.op, vm.op); setAttr(r.op, 'title', vm.opTitle); setAttr(r.op, 'hidden', !vm.op);
    setText(r.progL, vm.progL); setText(r.progR, vm.progR); setAttr(r.prog, 'title', vm.progTitle);
    const w = (vm.frac * 100).toFixed(1) + '%';
    if (r.barI._w !== w) { if (vm.frac < (p.frac || 0) - 0.02) { r.barI.style.transition = 'none'; requestAnimationFrame(() => { r.barI.style.transition = ''; }); } r.barI._w = w; r.barI.style.width = w; }
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
    setHTML(r.buf, vm.buf); setAttr(r.buf, 'title', vm.bufTitle);
    if (p.bandKey !== vm.bandKey) setHTML(r.band, WF.ui.stateBand(mv.segments, now - BAND_SEC, now, { w: 280, h: 8 }));
    setAttr(r.bandBox, 'title', vm.bandTitle);
    setAttr(el, 'aria-label', vm.aria);
    t.vm = vm;
  }

  // ------------------------------------------------------------------ Zusammenfassung / Filter / Sortierung
  function buildSummary() {
    R.sum.innerHTML = STATE_GROUPS.map(g => `<button data-g="${g.key}" style="--c:${g.color}" aria-pressed="false" title="Nur ${esc(g.label)} anzeigen"><i></i><b>0</b>${esc(g.label)}</button>`).join('');
    R.sum.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      if (tv) return;
      filter = filter === b.dataset.g ? null : b.dataset.g;
      R.sum.querySelectorAll('[data-g]').forEach(x => { x.classList.toggle('on', x.dataset.g === filter); x.setAttribute('aria-pressed', String(x.dataset.g === filter)); });
      applyOrder(true);
    });
  }
  function updateSummary() {
    const cnt = {};
    for (const id in lastMVs) { const s = lastMVs[id].state; const g = STATE_GROUPS.find(x => x.match(s)); if (g) cnt[g.key] = (cnt[g.key] || 0) + 1; }
    R.sum.querySelectorAll('[data-g]').forEach(b => { const n = cnt[b.dataset.g] || 0; setText(b.querySelector('b'), String(n)); b.classList.toggle('zero', n === 0 && filter !== b.dataset.g); });
  }
  let orderSig = '';
  function applyOrder(force) {
    const ids = order.slice();
    if (sortMode === 'urgent') ids.sort((a, b) => {
      const ma = lastMVs[a], mb = lastMVs[b];
      const ua = ma ? URGENCY[ma.state] ?? 5 : 5, ub = mb ? URGENCY[mb.state] ?? 5 : 5;
      return ua - ub || (ma && mb && ua <= 1 ? mb.sinceSec - ma.sinceSec : 0) || order.indexOf(a) - order.indexOf(b);
    });
    const g = filter ? STATE_GROUPS.find(x => x.key === filter) : null;
    const vis = ids.map(id => !g || (lastMVs[id] && g.match(lastMVs[id].state)));
    const sig = ids.join(',') + '|' + vis.join(',');
    if (!force && sig === orderSig) return;
    orderSig = sig;
    const active = document.activeElement;
    ids.forEach((id, k) => {
      const t = tiles[id];
      t.el.hidden = !vis[k];
      if (R.grid.children[k] !== t.el) R.grid.insertBefore(t.el, R.grid.children[k] || null);
    });
    let empty = R.grid.querySelector('.ls-empty-filter');
    if (!vis.some(Boolean)) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'empty ls-empty-filter card'; R.grid.append(empty); }
      empty.textContent = `Derzeit kein Arbeitsplatz im Zustand „${g ? g.label : ''}“.`;
    } else if (empty) empty.remove();
    if (active && active !== document.activeElement && root.contains(active)) active.focus({ preventScroll: true });
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
    setText(R.tvInfo, sh.id ? `${sh.name}${sh.inBreak ? ' · Pause' : ''} · ${lead ? lead.label + ' ' + lead.p.name + ' · ' : ''}${present} von ${shiftSize} im Dienst` : `Geisterschicht · nächste Schicht ${tclock(sh.endsAt, now)}`);
    if (sh.id) {
      setText(R.staff, `${present} von ${shiftSize} im Dienst`);
      setText(R.staffSub, [inBreak ? `${inBreak} in Pause` : '', others ? `+${others} aus Vorschicht` : '', !inBreak && !others ? `Fertigung: ${WF.profile.people.length} Personen, ${WF.profile.shifts.length} Schichten` : ''].filter(Boolean).join(' · '));
    } else {
      setText(R.staff, others ? `${others} noch in der Halle` : 'Niemand im Dienst');
      setText(R.staffSub, 'autonome Maschinen laufen weiter');
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
    const X = (i) => pad + i / (vals.length - 1) * (w - 2 * pad);
    const Y = (x) => h - pad - (x - min) / (max - min) * (h - 2 * pad);
    let d = '', area = '', started = false, firstX = 0, lastX = 0, lastY = 0;
    vals.forEach((x, i) => {
      if (x == null || !isFinite(x)) { started = false; return; }
      const px = X(i).toFixed(1), py = Y(x).toFixed(1);
      d += (started ? 'L' : 'M') + px + ',' + py;
      if (!area) firstX = px;
      area += (area ? 'L' : 'M') + px + ',' + py;
      started = true; lastX = px; lastY = py;
    });
    const fillPath = area ? `${area}L${lastX},${h}L${firstX},${h}Z` : '';
    const col = o.color || 'var(--info)';
    const tgt = o.target != null ? `<line x1="0" x2="${w}" y1="${Y(o.target).toFixed(1)}" y2="${Y(o.target).toFixed(1)}" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity=".8"/>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${tgt}<path d="${fillPath}" style="fill:${col}" opacity=".13"/><path d="${d}" style="fill:none;stroke:${col}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
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
  function updateKpis(now) {
    const k = WF.sim.kpis(), Sx = S(), H = Sx.history;
    // OEE
    setText(R.kOeeV, U.fmtPct(k.oee, 1));
    const day0 = U.dayStart(now);
    let idx = H.t.findIndex(t => t >= day0);
    if (idx >= 0) while (idx < H.t.length - 1 && H.oee[idx] == null) idx++; // ab dem ersten Wert mit Planzeit (Schichtbeginn)
    const oeeVals = idx >= 0 ? H.oee.slice(idx) : [];
    const sig = 'o' + H.t.length + '|' + (H.t[H.t.length - 1] || 0);
    if (R.kOeeSpark._sig !== sig) {
      R.kOeeSpark._sig = sig;
      R.kOeeSpark.innerHTML = sparkSVG(oeeVals, { target: TARGET_OEE, color: k.oee != null && k.oee >= TARGET_OEE ? 'var(--st-run)' : 'var(--st-wait)' });
      R.kOeeSpark.title = 'OEE-Verlauf heute (5-min-Werte, kumuliert seit 00:00) – gestrichelt: Ziel 75 %';
    }
    if (k.oee == null) setHTML(R.kOeeS1, `Ziel ${U.fmtPct(TARGET_OEE)} · noch keine Planzeit heute`);
    else {
      const d = (k.oee - TARGET_OEE) * 100;
      setHTML(R.kOeeS1, `Ziel ${U.fmtPct(TARGET_OEE)} · <span class="${d >= 0 ? 'ok' : 'warn'}">${d >= 0 ? '+' : '−'}${U.fmtNum(Math.abs(d), 1)} Pkt.</span>${k.oeeShift != null ? ` · ${WF.sim.shift().id ? 'Schicht' : 'Geisterschicht'} ${U.fmtPct(k.oeeShift, 0)}` : ''}`);
    }
    setHTML(R.kOeeS2, `V <b>${U.fmtPct(k.availability, 0)}</b> × L <b>${U.fmtPct(k.performance, 0)}</b> × Q <b>${U.fmtPct(k.quality, 1)}</b>`);
    setAttr(R.kOeeS2, 'title', 'Verfügbarkeit × Leistung × Qualität');
    // Teile
    setHTML(R.kGoodV, `${U.fmtNum(k.goodFinished)}<small>Stk</small>`);
    setHTML(R.kGoodS, `Arbeitsgänge: <b>${U.fmtNum(k.goodOps)}</b> Gutteile`);
    setHTML(R.kGoodS2, `Ausschuss ${U.fmtNum(k.scrap)} · FPY ${U.fmtPct(k.fpy, 1)}`);
    // Termintreue
    const rc = riskCounts(now);
    setText(R.kOtV, U.fmtPct(k.onTimePct, 0));
    setHTML(R.kOtS, rc.late ? `<span class="crit">${rc.late} verspätet</span>${rc.tight ? ` · <span class="warn">${rc.tight} knapp</span>` : ''}` : rc.tight ? `<span class="warn">${rc.tight} knapp</span> · keiner verspätet` : '<span class="ok">alle offenen Aufträge im Plan</span>');
    setText(R.kOtS2, rc.worst ? `${rc.worst.id}: ${U.fmtDur(-rc.worst.slackSec)} Verzug` : `${rc.open} offene Aufträge`);
    setAttr(R.kOt, 'title', `Termintreue ${U.fmtPct(k.onTimePct, 0)} – ${rc.late} Auftrag/Aufträge verspätet, ${rc.tight} mit weniger als 4 h Puffer (Prognose)`);
    // Stillstandkosten
    setHTML(R.kLossV, `${esc(U.fmtEur(k.lossEur))}<small>heute</small>`);
    const top = topLoss();
    setHTML(R.kLossS, top ? `größter Posten <b>${esc(top.id)}</b> · ${U.fmtEur(top.lossEurToday)}` : 'kein Stillstand heute');
    setText(R.kLossS2, 'Rüsten, Warten, Störung');
    // Energie
    setHTML(R.kEnV, `${U.fmtNum(k.powerKw, 0)}<small>kW</small>`);
    setText(R.kEnS, `heute ${U.fmtNum(k.energyKwh, 0)} kWh · Ø ${U.fmtNum(avgPower(H, day0), 0)} kW`);
    if (R.kEnSpark._sig !== sig) {
      R.kEnSpark._sig = sig;
      const n = Math.round(BAND_SEC / (WF.profile.sim.historyStepSec || 300));
      R.kEnSpark.innerHTML = sparkSVG(H.powerKw.slice(-n), { color: 'var(--info)', min: 0 });
      R.kEnSpark.title = 'Leistungsaufnahme der letzten 4 h (5-min-Mittelwerte)';
    }
    // Meldungen
    const on = openNotifs();
    const open = on.filter(n => n.status === 'open'), crit = open.filter(n => n.sev === 'crit').length;
    const acked = on.length - open.length;
    setText(R.kMsgV, String(open.length));
    setHTML(R.kMsgS, open.length ? `${crit ? `<span class="crit">${crit} kritisch</span> · ` : ''}<span class="warn">${open.length - crit} ${open.length - crit === 1 ? 'Warnung' : 'Warnungen'}</span>` : '<span class="ok">keine offenen Warnungen</span>');
    const info = (Sx.notifications || []).filter(n => n.status === 'open' && n.sev === 'info').length;
    const roles = {};
    for (const n of open) roles[n.role || 'Leitstand'] = (roles[n.role || 'Leitstand'] || 0) + 1;
    const rl = Object.keys(roles).sort((a, b) => roles[b] - roles[a]).slice(0, 2).map(r => `${roles[r]} ${r}`).join(' · ');
    setText(R.kMsgS2, [acked ? `${acked} quittiert` : '', rl || (info ? `${info} Info` : '')].filter(Boolean).join(' · ') || 'keine Meldungen');
    setAttr(R.kMsg, 'title', 'Offene Warnungen und Störungen nach Rolle: ' + (Object.keys(roles).map(r => `${r} ${roles[r]}`).join(', ') || 'keine') + (info ? ` · zusätzlich ${info} Info-Meldungen` : ''));
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
    const LIMIT = tv ? 6 : 4;
    const show = nowExpanded || tv ? list.slice(0, tv ? LIMIT : 40) : list.slice(0, LIMIT);
    const openN = list.filter(n => n.status === 'open').length, critN = list.filter(n => n.status === 'open' && n.sev === 'crit').length;
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
    const hiddenN = list.length - show.length;
    setAttr(R.nowMore, 'hidden', !(hiddenN > 0 || (nowExpanded && list.length > LIMIT)));
    setText(R.nowMore, nowExpanded ? 'Weniger anzeigen' : `${hiddenN} weitere ${hiddenN === 1 ? 'Meldung' : 'Meldungen'} anzeigen`);
    renderNext(now, show.length);
  }
  function buildNotif(n) {
    const node = document.createElement('article');
    node.className = 'ls-n';
    node.dataset.id = n.id;
    node.innerHTML = `<div class="ls-n-top"><span class="sev" data-r="sev"></span><span data-r="meta"></span><button class="link" data-r="ent" data-k="ent" hidden></button></div>
      <div class="ls-n-t" data-r="t"></div><div class="ls-n-b" data-r="b"></div><div class="ls-n-s" data-r="s" hidden></div>
      <div class="ls-n-a ls-tvhide" data-r="a"></div>`;
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
    setText(r.sev, n.sev === 'crit' ? 'Störung' : 'Warnung');
    setText(r.meta, `${tclock(n.t, now)} · ${n.role || ''}`);
    const ent = n.entity && n.entity.id && LINKABLE[n.entity.kind] ? n.entity : null;
    setAttr(r.ent, 'hidden', !ent);
    if (ent) { setText(r.ent, ent.kind === 'machine' || ent.kind === 'order' ? ent.id : WF.app.entityLabel(ent)); setAttr(r.ent, 'title', 'Öffnen: ' + WF.app.entityLabel(ent)); }
    setText(r.t, n.title); setText(r.b, n.body || ''); setAttr(r.b, 'hidden', !n.body);
    setAttr(r.s, 'hidden', !n.suggestion);
    if (n.suggestion) setHTML(r.s, `<b>Empfehlung</b> ${esc(n.suggestion)}`);
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

  // Als Nächstes (geplante Ereignisse der nächsten 2 h: Werkzeugwechsel, Arbeitsgang fertig, Pausen/Schichtende)
  function renderNext(now, shown) {
    const items = [];
    const H2 = now + 2 * 3600;
    for (const id in lastMVs) {
      const mv = lastMVs[id];
      const seen = new Set();
      for (const t of mv.tools) {
        const pc = t.plannedChange;
        if (!pc || pc.etaT == null || pc.etaT > H2 || seen.has(pc.afterPart)) continue;
        if (t.status !== 'planned' && t.status !== 'due') continue;
        seen.add(pc.afterPart);
        const names = [toolShort(t.name)].concat((pc.withTools || []).map(toolShort));
        items.push({ t: pc.etaT, ic: 'wrench', c: pc.waitFromT != null ? 'var(--st-wait)' : 'var(--st-tool)', text: `${id} Werkzeugwechsel ${names.join(', ')}${pc.by ? ' · ' + pc.by : ''}`, ent: 'machine|' + id });
      }
      if (mv.order && mv.etaOpEnd != null && mv.etaOpEnd <= H2 && mv.etaOpEnd > now) items.push({ t: mv.etaOpEnd, ic: 'check', c: 'var(--st-run)', text: `${id} fertig mit ${mv.order.id} AG ${mv.order.seq}${mv.queue[0] && mv.queue[0].level === 2 ? ' · danach ' + mv.queue[0].orderId : ''}`, ent: 'machine|' + id });
    }
    const sh = WF.sim.shift();
    if (sh.id) {
      const def = WF.profile.shifts.find(s => s.id === sh.id);
      if (def) for (const [a, b] of def.breaks) { const t0 = U.dayStart(now) + U.hm(a); if (t0 > now && t0 <= H2) items.push({ t: t0, ic: 'clock', c: 'var(--info)', text: `Pause ${sh.name} bis ${b}`, ent: '' }); }
      if (sh.endsAt > now && sh.endsAt <= H2) items.push({ t: sh.endsAt, ic: 'users', c: 'var(--info)', text: `Schichtende ${sh.name}`, ent: '' });
    }
    items.sort((a, b) => a.t - b.t);
    const max = shown >= 3 ? 3 : 5;
    const list = items.slice(0, max);
    const sig = list.map(x => Math.floor(x.t / 60) + x.text).join('|');
    if (sig === lastNextSig) return;
    lastNextSig = sig;
    setAttr(R.next, 'hidden', !list.length);
    R.next.innerHTML = `<span class="eyebrow">Als Nächstes · 2 h</span>` + list.map(x =>
      `<div class="ls-next-row" style="--c:${x.c}" ${x.ent ? `data-ent="${esc(x.ent)}"` : ''} title="${esc(U.fmtDayClock(x.t) + ' – ' + x.text)}"><span class="num">${U.fmtClock(x.t)}</span>${icon(x.ic, 13)}<span>${esc(x.text)}</span></div>`).join('');
  }

  // ------------------------------------------------------------------ KI-Schichtbriefing
  function refreshBrief(force) {
    const now = WF.sim.t;
    if (brief.pending) return;
    const real = performance.now();
    const aiMode = !!(WF.ai && typeof WF.ai.briefing === 'function');
    // automatisch alle 15 Sim-Minuten – bei hohem Tempo höchstens alle 5 s (regelbasiert) bzw. 2 min (KI) Echtzeit
    if (!force && brief.data && now >= brief.t && (now - brief.t < 15 * 60 || real - (brief.real || 0) < (aiMode ? 120000 : 5000))) return;
    brief.t = now; brief.real = real;
    let res = null;
    if (WF.ai && typeof WF.ai.briefing === 'function') {
      try { res = WF.ai.briefing(); } catch (e) { console.warn('[leitstand] WF.ai.briefing', e); res = null; }
    }
    const apply = (r) => { brief.pending = false; brief.data = normalizeBrief(r) || ruleBrief(); renderBrief(); };
    if (res && typeof res.then === 'function') {
      brief.pending = true;
      if (!brief.data) brief.data = ruleBrief();
      renderBrief(true);
      res.then(apply, () => apply(null));
    } else apply(res);
  }
  function normalizeBrief(r) {
    if (!r || (!r.headline && !(r.bullets && r.bullets.length))) return null;
    return { headline: r.headline || '', bullets: (r.bullets || []).map(b => typeof b === 'string' ? { text: b, sev: 'info' } : { text: b.text || '', sev: b.sev || 'info', ent: b.entity || b.ent || null }), t: r.generatedT != null ? r.generatedT : WF.sim.t, mode: r.mode || 'KI' };
  }
  function ruleBrief() {
    const snap = WF.sim.snapshot(), now = WF.sim.t;
    const mvs = {};
    for (const id of WF.profile.machines) { const mv = WF.sim.machineView(id); if (mv) mvs[id] = mv; }
    const n = snap.machines.length;
    const running = snap.machines.filter(m => m.st === 'running').length;
    const faults = snap.machines.filter(m => m.st === 'fault');
    const k = snap.kpi;
    const sh = WF.sim.shift();
    const bullets = [];
    const machineLabel = (m) => `${m.id} ${m.name}`;
    for (const m of faults) bullets.push({ sev: 'crit', ent: 'machine|' + m.id, text: `Störung ${machineLabel(m)}: ${m.why}.` });
    const waits = Object.values(mvs).filter(mv => WAIT[mv.state] && mv.sinceSec >= 300).sort((a, b) => b.sinceSec - a.sinceSec);
    for (const mv of waits.slice(0, 2)) bullets.push({ sev: 'warn', ent: 'machine|' + mv.id, text: `${mv.id} ${mv.short} ${WF.STATE[mv.state].label.toLowerCase()} seit ${U.fmtDur(mv.sinceSec)} – ${mv.cause}.` });
    const late = snap.orders.filter(o => o.st !== 'fertig' && o.risk === 'spät');
    for (const o of late.slice(0, 2)) bullets.push({ sev: 'warn', ent: 'order|' + o.id, text: `${o.id} (${custShort(o.cust)}) gefährdet: Prognose ${o.eta}, Termin ${o.due}${o.bottleneck ? ' – Engpass ' + o.bottleneck : ''}.` });
    const changes = [];
    for (const id in mvs) {
      for (const t of mvs[id].tools) { const pc = t.plannedChange; if (pc && pc.etaT != null && pc.etaT - now <= 3600 && pc.etaT >= now && (t.status === 'planned' || t.status === 'due')) { changes.push({ t: pc.etaT, text: `${id} ${toolShort(t.name)} ca. ${U.fmtClock(pc.etaT)}` }); break; } }
    }
    changes.sort((a, b) => a.t - b.t);
    if (changes.length) bullets.push({ sev: 'tool', text: `Werkzeugwechsel in der nächsten Stunde: ${changes.slice(0, 3).map(c => c.text).join('; ')}${changes.length > 3 ? ` (+${changes.length - 3})` : ''}.` });
    for (const mt of snap.materialsLow.filter(x => x.onHand < x.min).slice(0, 1)) bullets.push({ sev: 'warn', ent: 'material|' + mt.id, text: `${mt.name}: Bestand ${U.fmtNum(mt.onHand, mt.unit === 'm' ? 1 : 0)} ${mt.unit} unter Mindestbestand ${U.fmtNum(mt.min)} ${mt.unit}${mt.onOrder ? ` – ${U.fmtNum(mt.onOrder, 0)} ${mt.unit} bestellt` : ' – Nachbestellung empfohlen'}.` });
    const finishing = Object.keys(S().orders).map(id => S().orders[id]).filter(o => o.status !== 'fertig').map(o => ({ o, f: WF.sim.forecast().orders[o.id] })).filter(x => x.f && x.f.eta != null).sort((a, b) => a.f.eta - b.f.eta)[0];
    if (finishing && bullets.length < 5) bullets.push({ sev: 'ok', ent: 'order|' + finishing.o.id, text: `Als Nächstes fertig: ${finishing.o.id} ${finishing.o.part.name} (${custShort(finishing.o.customer)}) ca. ${tclock(finishing.f.eta, now)}${finishing.f.eta <= finishing.o.due ? ', termingerecht' : ''}.` });
    if (sh.id && sh.endsAt - now <= 2 * 3600 && bullets.length < 6) {
      const ghost = (S().notifications || []).filter(x => x.status === 'open' && String(x.key).startsWith('ghost:'));
      bullets.push({ sev: ghost.length ? 'warn' : 'info', text: ghost.length ? `Vor Schichtende ${U.fmtClock(sh.endsAt)}: ${ghost.length} ${ghost.length === 1 ? 'Maschine würde' : 'Maschinen würden'} in der Geisterschicht stehen bleiben – vorbeugender Werkzeugwechsel empfohlen (siehe „Jetzt wichtig“).` : `Schichtende ${U.fmtClock(sh.endsAt)}: autonome Maschinen laufen in der Geisterschicht weiter, solange Material und Standzeit reichen.` });
    }
    if (!bullets.length) bullets.push({ sev: 'ok', text: 'Keine Störungen, keine gefährdeten Termine – alle Arbeitsplätze laufen planmäßig.' });
    const oeeTxt = k.oee != null ? `OEE ${U.fmtPct(k.oee, 0)} ${k.oee >= TARGET_OEE ? 'über' : 'unter'} dem Ziel von ${U.fmtPct(TARGET_OEE)}` : 'noch keine OEE-Bezugszeit';
    const head = `${sh.id ? sh.name : 'Geisterschicht'}: ${running} von ${n} Arbeitsplätzen produzieren, ${oeeTxt}` +
      (faults.length ? `, ${faults.length} ${faults.length === 1 ? 'Störung' : 'Störungen'}` : '') + (late.length ? `, ${late.length} ${late.length === 1 ? 'Termin' : 'Termine'} gefährdet` : '') + '.';
    return { headline: head, bullets: bullets.slice(0, 6), t: now, mode: 'regelbasiert' };
  }
  const BRIEF_C = { crit: 'var(--st-fault)', warn: 'var(--st-wait)', tool: 'var(--st-tool)', ok: 'var(--st-run)', info: 'var(--info)' };
  function renderBrief(pending) {
    const b = brief.data; if (!b) return;
    const now = WF.sim.t;
    setText(R.briefMode, brief.pending ? 'erstellt …' : b.mode === 'regelbasiert' ? 'Regelbasiert' : b.mode);
    setAttr(R.briefMode, 'title', b.mode === 'regelbasiert' ? 'Offline-Modus: aus Live-Daten nach festen Regeln erstellt' : 'Vom KI-Modell erstellt');
    const linkify = (x) => {
      const txt = esc(x.text);
      if (!x.ent) return txt;
      const [kind, id] = x.ent.split('|');
      return txt.replace(esc(id), `<button class="link" data-ent="${esc(x.ent)}">${esc(id)}</button>`);
    };
    const html = `<div class="ls-brief-h">${esc(b.headline)}</div>
      <ul>${b.bullets.map(x => `<li style="--c:${BRIEF_C[x.sev] || BRIEF_C.info}">${linkify(x)}</li>`).join('')}</ul>
      <div class="ls-brief-f"><span>Stand ${esc(tclock(b.t, now))}</span><span>·</span><span>aktualisiert alle 15 min</span><span class="spacer"></span>${WF.ai ? '<button class="link ls-tvhide" data-ask>Im Copilot vertiefen</button>' : ''}</div>`;
    if (R.briefBody._h !== html) {
      setHTML(R.briefBody, html);
      const ask = R.briefBody.querySelector('[data-ask]');
      if (ask) ask.onclick = () => WF.bus.emit('ai:ask', { text: 'Erstelle mir ein ausführliches Schichtbriefing: Lage, Risiken für Termine, Werkzeugwechsel und Personal in den nächsten 2 Stunden, mit konkreten Empfehlungen.', context: { kind: 'view', id: 'leitstand' } });
    }
    void pending;
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
    if (last === feedLastId) {
      // nur relative Zeitangaben am Tageswechsel nachziehen ist nicht nötig (Uhrzeit absolut)
      return;
    }
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
    if (!pick.length && !R.feed.querySelector('.empty')) R.feed.innerHTML = '<div class="empty">Noch keine Ereignisse heute. Hier erscheinen Störungen, Werkzeugwechsel, Rüstvorgänge, Erstteilprüfungen und fertige Aufträge.</div>';
    else if (pick.length) { const em = R.feed.querySelector('.empty'); if (em) em.remove(); }
  }

  // ------------------------------------------------------------------ Update-Schleife
  function update() {
    if (!root || !WF.sim || !S()) return;
    const now = WF.sim.t;
    const tvNow = !!WF.app.tv;
    if (tvNow !== tv) setTvClass();
    for (const id of order) {
      const mv = WF.sim.machineView(id); if (!mv) continue;
      lastMVs[id] = mv;
      patchTile(tiles[id], mv, now);
    }
    updateSummary();
    applyOrder(false);
    updateHead(now);
    updateKpis(now);
    renderNow(false);
    refreshBrief(false);
    updateFeed(now);
  }

  WF.registerView({
    id: 'leitstand', title: 'Leitstand', icon: 'grid', group: 'betrieb', order: 1,
    mount,
    show() { setTvClass(); },
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
    briefing: () => ruleBrief(),
    refreshBriefing: () => refreshBrief(true),
  };
})();
