/* werkfluss – Detail „machine“ (42_machine.js): Maschinen-Drawer.
   Abschnitte: Status (Zustand, Ursache, Phase, Störung, Erstteil, beauftragter Werkzeugwechsel, Personen, Zustandsband),
   Aktionen, Auftrag & Fortschritt (inkl. Arbeitsplan-Kette), Werkzeuge (Standzeit-Regel erklärt), Live-Signale (je
   Anschluss-Level, mit selbst aufgezeichneten Sparklines), Puffer, Heute (OEE A×P×Q, Zustandsverteilung), Warteschlange,
   Stammdaten, letzte Ereignisse. update(el) patcht abschnittsweise über Signaturen; schnelle Werte (Teilfortschritt,
   Restzeit) werden direkt in [data-live]-Knoten geschrieben. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;

  const WAIT = { waitTool: 1, waitOperator: 1, starved: 1, blocked: 1 };
  const TOOL_C = { ok: 'var(--st-run)', planned: 'var(--st-tool)', due: 'var(--st-wait)', broken: 'var(--st-fault)', changing: 'var(--st-tool)',
    replace: 'var(--st-setup)', keep: 'var(--st-setup)', setup: 'var(--st-setup)', missing: 'var(--st-idle)', idle: 'var(--st-idle)' };
  const STACK = { green: 'var(--st-run)', yellow: 'var(--st-wait)', red: 'var(--st-fault)', off: 'var(--faint)' };
  const MODE_LBL = { AUTO: 'Automatik', STOP: 'Stopp', 'JOG/MDI': 'Einrichten (JOG/MDI)', ALARM: 'Alarm' };
  const AUTOMATION = { barfeeder: 'Stangenlader', pallet: 'Palettenwechsler', magazine: 'Stangenmagazin (Säge)', loader: 'Portallader / Beladeeinrichtung', none: 'keine (manuelle Beladung)' };
  const SPARK_WIN = 30 * 60; // Sparklines: letzte 30 Sim-Minuten
  const LINKABLE = { machine: 1, order: 1, person: 1, agv: 1, tool: 1, material: 1, container: 1 };

  const S = () => WF.sim && WF.sim.state;
  const tclock = (t, now) => (Math.floor(t / 86400) === Math.floor(now / 86400) ? U.fmtClock(t) : U.fmtDayClock(t));
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const teile = (n) => U.fmtNum(n) + (n === 1 ? ' Teil' : ' Teile');
  const durS = (sec) => { if (sec == null) return '–'; sec = Math.max(0, Math.round(sec)); if (sec < 60) return sec + ' s'; if (sec < 600) return Math.floor(sec / 60) + ' min ' + String(sec % 60).padStart(2, '0') + ' s'; return U.fmtDur(sec); };
  const stName = (id) => (WF.sim && WF.sim.stationName ? WF.sim.stationName(id) : id);

  // ------------------------------------------------------------------ CSS (Präfix .md-)
  WF.ui.css(`
  .md-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .md-hero{display:flex;flex-direction:column;gap:9px}
  .md-st{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .md-st .pill{font-size:14px;line-height:24px;padding:3px 12px 3px 10px}
  .md-st .pill i{width:9px;height:9px}
  .md-since{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .md-phase{margin-left:auto}
  .md-cause{font-size:14px;line-height:1.45;color:var(--text);overflow-wrap:anywhere}
  .md-box{--c:var(--info);border-radius:9px;padding:10px 12px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 30%,transparent);font-size:12.5px;line-height:1.45;color:var(--text2);display:flex;flex-direction:column;gap:4px}
  .md-box-h{display:flex;align-items:center;gap:7px;color:color-mix(in srgb,var(--c) 75%,var(--text));font-weight:600;font-size:13px}
  .md-box-h .ico{flex:none}
  .md-box-h .spacer{flex:1}
  .md-box-h small{font-weight:500;color:var(--muted);font-size:11.5px;white-space:nowrap}
  .md-box b{color:var(--text);font-weight:600}
  .md-box .row{margin-top:4px}
  .md-people{display:flex;flex-direction:column;gap:5px}
  .md-person{display:flex;align-items:center;gap:8px;font-size:12.5px;min-width:0;background:transparent;border:0;padding:0;color:inherit;text-align:left;cursor:pointer}
  .md-person:hover b{text-decoration:underline}
  .md-person .avatar{width:24px;height:24px;font-size:10px}
  .md-person span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
  .md-person b{font-weight:600;color:var(--text2)}
  .md-band{display:flex;flex-direction:column;gap:4px}
  .md-band-ax{position:relative;height:12px;font:500 10px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums}
  .md-band-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .md-band-ax span:first-child{transform:none}
  .md-band-ax span:last-child{transform:translateX(-100%)}
  .md-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted)}
  .md-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .md-legend i{width:8px;height:8px;border-radius:2px;background:var(--c)}
  .md-legend b{color:var(--text2);font-weight:600;font-variant-numeric:tabular-nums}

  .md-acts{display:flex;flex-wrap:wrap;gap:6px}
  .md-acts .btn{height:30px;font-size:12.5px}
  .md-acts-note{font-size:11.5px;color:var(--faint);margin-top:6px;line-height:1.4}

  .md-sec h4{display:flex;align-items:center;gap:8px}
  .md-sec h4 .spacer{flex:1}
  .md-sec h4 small{font:500 11.5px/1 var(--f-ui);letter-spacing:0;text-transform:none;color:var(--faint)}
  .md-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 13px;display:flex;flex-direction:column;gap:9px}
  .md-ord-h{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:14px}
  .md-ord-h .link{font-family:var(--f-mono);font-size:13px;flex:none}
  .md-ord-h b{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .md-tag{--c:var(--st-wait);flex:none;align-self:center;font:600 10.5px/1 var(--f-ui);padding:3px 7px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent)}
  .md-meta{font-size:12px;color:var(--muted);line-height:1.5}
  .md-meta b{color:var(--text2);font-weight:600}
  .md-prog{display:flex;flex-direction:column;gap:5px}
  .md-prog-t{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;font-variant-numeric:tabular-nums}
  .md-prog-t b{font-weight:600}
  .md-prog-t span{color:var(--muted);white-space:nowrap}
  .md-prog .bar{height:7px}
  .md-prog .bar.thin{height:4px}
  .md-chain{display:flex;flex-wrap:wrap;align-items:center;gap:4px 2px;font:500 11px/1 var(--f-mono)}
  .md-chain .md-step{--c:var(--line2);display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);color:var(--faint);background:transparent;cursor:default;white-space:nowrap}
  .md-chain .md-step.done{color:var(--muted)}
  .md-chain .md-step.done .ico{color:var(--st-run)}
  .md-chain .md-step.cur{color:var(--text);border-color:color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 14%,transparent)}
  .md-chain .md-step.click{cursor:pointer}
  .md-chain .md-step.click:hover{border-color:var(--line2);color:var(--text2)}
  .md-chain .md-arr{color:var(--faint);padding:0 1px}

  .md-tools{width:100%;border-collapse:collapse;font-size:12.5px}
  .md-tools th{text-align:left;font:600 10px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 6px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
  .md-tools th.r,.md-tools td.r{text-align:right}
  .md-tools td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
  .md-tools tr.md-tr{cursor:pointer}
  .md-tools tr.md-tr:hover td{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .md-tools tr.md-tr.on td{background:color-mix(in srgb,var(--accent) 7%,transparent)}
  .md-tools tr.md-tr.on td:first-child{box-shadow:inset 2px 0 0 var(--accent)}
  .md-tools .md-slot{font:600 11px/1.5 var(--f-mono);color:var(--muted);width:26px}
  .md-tools .md-tn{font-weight:600;color:var(--text);line-height:1.3}
  .md-tools .md-tk{font-size:11px;color:var(--faint);margin-top:2px}
  .md-tools .md-pc{font-size:11.5px;margin-top:4px;color:color-mix(in srgb,var(--c) 75%,var(--text));font-weight:500}
  .md-wear{display:flex;flex-direction:column;gap:4px;min-width:62px;align-items:flex-end}
  .md-wear .bar{width:62px;height:5px;min-width:0}
  .md-wear span{font:500 11.5px/1 var(--f-mono);color:var(--text2)}
  .md-rest{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;margin-bottom:5px}
  .md-rest small{display:block;font-weight:400;color:var(--faint);font-size:10.5px;margin-top:2px}
  .md-chip{--c:var(--st-idle);display:inline-block;font:600 10.5px/1.3 var(--f-ui);padding:2px 6px;border-radius:5px;color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);white-space:nowrap}
  .md-explain{border-radius:9px;padding:10px 12px;background:var(--bg2);border:1px solid var(--line);font-size:12.3px;line-height:1.5;color:var(--text2);display:flex;flex-direction:column;gap:6px}
  .md-explain .md-ex-h{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.04em}
  .md-explain .md-ex-h .ico{color:var(--info)}
  .md-explain .md-ex-h .spacer{flex:1}
  .md-explain .md-rule{font-size:11.5px;line-height:1.5;color:var(--muted);border-top:1px solid var(--line);padding-top:6px}
  .md-explain .md-rule b{color:var(--text2);font-weight:600}
  .md-idle-tools{font-size:11.5px;color:var(--faint);margin-top:8px}

  .md-sig{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .md-s{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0;display:flex;flex-direction:column;gap:3px}
  .md-s.wide{grid-column:1/-1}
  .md-s .l{font:600 9.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .md-s .v{font:600 19px/1.15 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .md-s .v small{font:500 12px/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .md-s .v.mono{font:500 12.5px/1.5 var(--f-mono);white-space:normal;overflow-wrap:anywhere}
  .md-s .sp{height:22px;margin-top:2px}
  .md-s .sp svg{display:block;width:100%;height:22px;overflow:visible}
  .md-sp-ax{display:flex;justify-content:space-between;font:500 9.5px/1 var(--f-ui);color:var(--faint);font-variant-numeric:tabular-nums;margin-top:2px}
  .md-stack{display:inline-flex;flex-direction:column;gap:2px;padding:3px;border-radius:4px;background:var(--bg2);border:1px solid var(--line2);vertical-align:middle;margin-right:8px}
  .md-stack i{width:9px;height:6px;border-radius:2px;background:var(--track)}
  .md-stack i.on{background:var(--c);box-shadow:0 0 6px var(--c)}
  .md-s .v.light{display:flex;align-items:center;font:600 13px/1.2 var(--f-ui)}
  .md-sig-f{font-size:11px;color:var(--faint);margin-top:8px}
  .md-l0{display:flex;gap:12px;align-items:flex-start}
  .md-l0 .ico{color:var(--st-wait);flex:none;margin-top:2px}

  .md-buf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .md-buf-c{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 10px;min-width:0;display:flex;flex-direction:column;gap:6px}
  .md-buf-h{display:flex;align-items:center;justify-content:space-between;gap:6px;font:600 10px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .md-buf-h span:last-child{font:500 11.5px/1 var(--f-mono);letter-spacing:0;color:var(--text2);text-transform:none}
  .md-slots{display:flex;gap:3px}
  .md-slots i{flex:1;height:6px;border-radius:2px;background:var(--track);border:1px solid var(--line2)}
  .md-slots i.f{background:var(--mat);border-color:var(--mat)}
  .md-slots.full i.f{background:var(--st-wait);border-color:var(--st-wait)}
  .md-cont{display:flex;flex-direction:column;gap:1px;font-size:12px;padding:5px 6px;margin:0 -6px;border-radius:6px;cursor:pointer;background:transparent;border:0;color:inherit;text-align:left;width:calc(100% + 12px)}
  .md-cont:hover{background:color-mix(in srgb,var(--raise) 45%,transparent)}
  .md-cont b{font-weight:600}
  .md-cont span{color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .md-buf-e{font-size:11.5px;color:var(--faint)}

  .md-oee{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 18px;align-items:center}
  .md-oee-v{font:600 34px/1 var(--f-cond);font-variant-numeric:tabular-nums}
  .md-oee-v small{display:block;font:500 11.5px/1.3 var(--f-ui);color:var(--muted);margin-top:4px}
  .md-apq{display:flex;flex-direction:column;gap:6px}
  .md-apq div{display:grid;grid-template-columns:86px minmax(0,1fr) 52px;gap:8px;align-items:center;font-size:12px;color:var(--muted)}
  .md-apq div b{font-variant-numeric:tabular-nums;text-align:right;color:var(--text2);font-weight:600}
  .md-dist{display:flex;height:10px;border-radius:3px;overflow:hidden;background:var(--track)}
  .md-dist i{display:block;height:100%;background:var(--c)}
  .md-dl4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .md-dl4 > div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 9px;min-width:0}
  .md-dl4 .l{font:600 9.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .md-dl4 .v{font:600 16px/1.3 var(--f-cond);font-variant-numeric:tabular-nums;white-space:nowrap}

  .md-q{display:flex;flex-direction:column}
  .md-qr{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:4px 9px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}
  .md-qr:last-child{border-bottom:0}
  .md-qr > i{width:8px;height:8px;border-radius:50%;background:var(--c);align-self:center}
  .md-qr .md-qm{min-width:0}
  .md-qr .md-qm div:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .md-qr .md-qm div + div{font-size:11.5px;color:var(--muted);margin-top:2px}
  .md-qr .md-qd{font-size:11.5px;color:var(--muted);white-space:nowrap;text-align:right}

  .md-ev{display:grid;grid-template-columns:40px minmax(0,1fr);gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;line-height:1.4}
  .md-ev:last-child{border-bottom:0}
  .md-ev .num{color:var(--muted);font-size:11.5px}
  .md-ev span:last-child{color:var(--text2);overflow-wrap:anywhere}
  .md-ev i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--c);margin-right:6px;vertical-align:1px}
  .md-dl{font-size:12.5px}
  @media (max-width:440px){ .md-dl4{grid-template-columns:repeat(2,minmax(0,1fr))} .md-tools .md-slot{display:none} }
  `, 'md-css');

  // ------------------------------------------------------------------ Signal-Aufzeichnung (für Sparklines; läuft im Hintergrund, 2×/s)
  // Live-Werte kommen aus machineView().signals (5-s-Raster). Damit die Verläufe schon beim ersten Öffnen und auch bei
  // hohem Sim-Tempo das ganze 30-min-Fenster zeigen, werden fehlende Zeitpunkte aus dem Zustandsverlauf (segments) mit
  // demselben Signalmodell ergänzt: Leistung aus Stillstands-/Schnittleistung des Arbeitsplatzes, Spindel nur beim Schneiden
  // (Takt = Einlegen + Bearbeiten), Drehzahl/Last auf dem zuletzt gemessenen Niveau.
  const SAMPLES = {}, SIGCTX = {};
  const STEP = 10;
  const hn = (a, b) => { let h = Math.imul((a | 0) ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x632BE5AB, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return ((h >>> 0) / 4294967296) * 2 - 1; };
  function segAt(segs, t) {
    for (let i = segs.length - 1; i >= 0; i--) { const g = segs[i]; if (g.t0 <= t) return (g.t1 == null || g.t1 > t) ? g : null; }
    return null;
  }
  function synth(id, mv, t, cx) {
    const g = segAt(mv.segments || [], t), st = g ? g.state : 'idle';
    const nz = hn(Math.floor(t / 5), cx.k);
    let cutting = false;
    if (st === 'running') { const ph = ((t - g.t0) % cx.period + cx.period) % cx.period; cutting = ph >= cx.loadSec; }
    const p = cx.power;
    const kwBase = st === 'running' ? (cutting ? p.run : p.idle + (p.run - p.idle) * 0.25) : st === 'fault' ? p.idle * 0.8 : (st === 'setup' || st === 'toolchange') ? p.idle * 1.1 : p.idle;
    const kw = Math.round(kwBase * (1 + 0.03 * nz) * 10) / 10;
    return {
      t, syn: 1,
      rpm: cx.spindle ? (cutting ? (cx.rpm != null ? Math.round(cx.rpm * (1 + 0.015 * nz)) : null) : 0) : null,
      load: cx.spindle ? (cutting ? (cx.load != null ? Math.max(5, Math.round(cx.load + 4 * nz)) : null) : 0) : null,
      kw, amp: Math.round(kw * 1000 / (1.732 * 400 * 0.85) * 10) / 10,
      temp: cx.washer ? Math.round(((st === 'fault' ? 48 : 60) + 1.5 * nz) * 10) / 10 : null,
    };
  }
  function ctxOf(id, mv, sg) {
    const P = (WF.profile.stationById || {})[id] || {};
    const cx = SIGCTX[id] || (SIGCTX[id] = { k: WF.profile.machines.indexOf(id) + 1 });
    cx.power = P.power || { idle: 1, run: 5 };
    cx.spindle = sg.spindleRpm != null;
    cx.washer = sg.bathTempC != null;
    const learn = cx.rpm == null && sg.spindleRpm > 0;
    if (sg.spindleRpm > 0) cx.rpm = sg.spindleRpm;
    if (sg.spindleLoadPct > 0 && sg.spindleRpm > 0) cx.load = sg.spindleLoadPct;
    // Drehzahl/Last erst jetzt bekannt (beim ersten Öffnen wurde nicht geschnitten) → ergänzte Schnittphasen nachtragen
    if (learn && SAMPLES[id]) for (const x of SAMPLES[id]) if (x.syn && x.rpm === null) { const nz = hn(Math.floor(x.t / 5), cx.k); x.rpm = Math.round(cx.rpm * (1 + 0.015 * nz)); x.load = cx.load != null ? Math.max(5, Math.round(cx.load + 4 * nz)) : null; }
    const cyc = mv.order && mv.order.cycleMin ? mv.order.cycleMin * 60 : 300;
    cx.loadSec = Math.max(10, (P.loadMin != null ? P.loadMin : (mv.loading === 'auto' ? 0.3 : 1)) * 60);
    cx.period = cyc + cx.loadSec;
    return cx;
  }
  function sampleOne(id, mv) {
    const sg = mv && mv.signals; if (!sg) return;
    const arr = SAMPLES[id] || (SAMPLES[id] = []);
    let last = arr[arr.length - 1];
    if (last && last.t === sg.t) return;
    if (last && sg.t < last.t) { arr.length = 0; last = null; } // Reset
    const cx = ctxOf(id, mv, sg);
    // Lücke (erstes Öffnen, hohes Tempo) aus dem Zustandsverlauf füllen
    const from = last ? Math.max(last.t + STEP, sg.t - SPARK_WIN) : sg.t - SPARK_WIN;
    for (let t = Math.ceil(from / STEP) * STEP; t < sg.t - 2; t += STEP) arr.push(synth(id, mv, t, cx));
    arr.push({ t: sg.t, rpm: sg.spindleRpm, load: sg.spindleLoadPct, kw: sg.powerKw != null ? sg.powerKw : mv.powerKw, amp: sg.currentA, temp: sg.bathTempC });
    while (arr.length && arr[0].t < sg.t - SPARK_WIN - 60) arr.shift();
    if (arr.length > 600) arr.splice(0, arr.length - 600);
  }
  setInterval(() => {
    try {
      if (!WF.sim || !WF.sim.state || !WF.profile) return;
      for (const id of WF.profile.machines) { const mv = WF.sim.machineView(id); if (mv && mv.conn.level >= 1) sampleOne(id, mv); }
    } catch (e) { /* Aufzeichnung ist optional */ }
  }, 500);
  if (WF.bus) WF.bus.on('sim:reset', () => { for (const k in SAMPLES) delete SAMPLES[k]; });

  /** Zeitverlauf der letzten 30 min: feste Zeitachse (−30 min … jetzt), Lücken bleiben Lücken, Endpunkt betont */
  function timeSpark(arr, key, now, color) {
    const w = 200, h = 22, pad = 2;
    const pts = (arr || []).filter(x => x.t >= now - SPARK_WIN && x.t <= now);
    const vals = pts.filter(x => x[key] != null && isFinite(x[key]));
    if (vals.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" style="stroke:var(--line2)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/></svg>`;
    let min = Math.min(...vals.map(p => p[key])), max = Math.max(...vals.map(p => p[key]));
    if (min > 0 && min / Math.max(1e-9, max) > 0.6) min = min * 0.85;
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    const t0 = now - SPARK_WIN, span = SPARK_WIN;
    const X = (t) => pad + (t - t0) / span * (w - 2 * pad);
    const Y = (v) => h - pad - (v - min) / (max - min) * (h - 2 * pad);
    let d = '', a = '', run = [], lastP = null;
    const flush = () => {
      if (run.length > 1) {
        const seg = run.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p[key]).toFixed(1)).join('');
        d += seg; a += `${seg}L${X(run[run.length - 1].t).toFixed(1)},${h}L${X(run[0].t).toFixed(1)},${h}Z`;
      }
      run = [];
    };
    for (const p of pts) { if (p[key] == null || !isFinite(p[key])) { flush(); continue; } run.push(p); lastP = p; }
    flush();
    const dot = lastP ? `<path d="M${X(lastP.t).toFixed(1)},${Y(lastP[key]).toFixed(1)}h0" style="stroke:${color}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${a}" style="fill:${color}" opacity=".14"/><path d="${d}" style="fill:none;stroke:${color}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
  }

  // ------------------------------------------------------------------ Abschnitte
  function personAt(pid) { const p = S().people[pid]; return p || null; }

  function secStatus(mv, now) {
    const st = WF.STATE[mv.state] || WF.STATE.idle;
    let h = `<div class="md-hero">
      <div class="md-st">${WF.ui.pill(mv.state)}<span class="md-since">seit ${esc(U.fmtDur(mv.sinceSec))} · ${esc(tclock(mv.since, now))}</span>
        ${mv.order ? `<span class="chip md-phase" title="Phase des aktuellen Arbeitsgangs">${esc(mv.phase)}</span>` : ''}</div>
      <div class="md-cause">${esc(mv.cause || '–')}</div>`;
    if (mv.fault) {
      const f = mv.fault, rp = f.repairBy ? personAt(f.repairBy) : null;
      let rep;
      if (rp && rp.task && rp.task.type === 'repair' && rp.state === 'working' && rp.workRem > 0) rep = `<b>${esc(rp.name)}</b> repariert – fertig ca. <b>${esc(tclock(now + rp.workRem, now))}</b> (noch ${esc(U.fmtDur(rp.workRem))})`;
      else if (rp) rep = `<b>${esc(rp.name)}</b> ist zugeteilt (${esc(rp.activity || '')}) – Erfahrungswert ${f.repairMin[0]}–${f.repairMin[1]} min`;
      else rep = `Wartet auf Instandhaltung – Erfahrungswert ${f.repairMin[0]}–${f.repairMin[1]} min`;
      h += `<div class="md-box" style="--c:var(--st-fault)">
        <div class="md-box-h">${icon('alert', 16)}<span>${esc(f.code)} · ${esc(f.text)}</span><span class="spacer"></span><small>seit ${esc(U.fmtClock(f.t0))} (${esc(U.fmtDur(f.sinceSec))})</small></div>
        <div>Wahrscheinliche Ursache: ${esc(f.cause)}</div>
        <div>${rep}</div>
        ${f.toolBreak ? `<div>Werkzeugbruch${f.toolName ? ': <b>' + esc(f.toolName) + '</b>' : ''} – das laufende Teil ist Ausschuss, das Werkzeug wird nach der Reparatur gewechselt.</div>` : ''}
        ${f.manual ? '<div class="faint">Per Demo-Funktion ausgelöst.</div>' : ''}
        <div class="row"><button class="btn sm" data-act="repair" title="Demo-Funktion: beendet die Störung sofort, ohne Reparaturzeit">${icon('wrench', 14)}Sofort beheben (Demo)</button></div>
      </div>`;
    }
    if (mv.fpi) {
      const fp = mv.fpi, by = fp.by ? personAt(fp.by) : null;
      const stage = WF.sim.label('fpiStage', fp.stage);
      h += `<div class="md-box" style="--c:var(--st-setup)">
        <div class="md-box-h">${icon('target', 16)}<span>${fp.local ? 'Kontrolle erstes Teil an der Maschine' : 'Erstteilprüfung'} – ${esc(stage)}</span><span class="spacer"></span><small>seit ${esc(U.fmtDur(fp.waitingSec))}</small></div>
        <div>Teil ${esc(fp.no)} · Anlass: ${esc(fp.reason || '–')}${by ? ` · ${fp.stage === 'measure' ? 'misst' : 'bringt das Teil'}: <b>${esc(by.name)}</b>` : ''}</div>
        <div class="faint">Serie startet erst nach Freigabe (i.O.). Bei n.i.O. folgt eine Korrektur durch den Einrichter und ein neues Erstteil.</div>
      </div>`;
    }
    if (mv.manualToolChange) {
      const mt = mv.manualToolChange;
      h += `<div class="md-box" style="--c:var(--st-tool)">
        <div class="md-box-h">${icon('wrench', 16)}<span>Vorbeugender Werkzeugwechsel beauftragt</span><span class="spacer"></span><small>${esc(tclock(mt.t, now))}</small></div>
        <div><b>${esc(mt.names.join(', '))}</b>${mt.notBefore ? ` – frühestens ${esc(tclock(mt.notBefore, now))}` : ' – an der nächsten Teilegrenze'}${mt.reason ? ` · Grund: ${esc(mt.reason)}` : ''}</div>
      </div>`;
    }
    const ppl = mv.people.slice();
    if (mv.operator && !ppl.some(p => p.id === mv.operator.id)) ppl.unshift(mv.operator);
    if (ppl.length) {
      h += `<div class="md-people">${ppl.map(p => `<button class="md-person" data-ent="person|${esc(p.id)}" title="${esc(p.name)} (${esc(p.role)}) – ${esc(p.activity || '')}"><span class="avatar">${esc(WF.ui.initials(p.name))}</span><span><b>${esc(p.name)}</b> · ${esc(p.responsible ? 'zuständig – ' + (p.activity || p.stateLabel) : (p.taskLabel || p.activity || p.stateLabel))}${p.where ? ' · ' + esc(p.where) : ''}</span></button>`).join('')}</div>`;
    } else if (mv.loading === 'auto') h += `<div class="md-meta">Niemand im Dienst – Maschine läuft autonom weiter, solange Material, Standzeit und Ausgangspuffer reichen.</div>`;
    // Zustandsband 8 h mit Achse
    const W = 8 * 3600, t0 = now - W;
    const ticks = [];
    for (let k = 0; k <= 4; k++) { const t = t0 + k * W / 4; ticks.push(`<span style="left:${k * 25}%">${k === 4 ? 'jetzt' : U.fmtClock(t)}</span>`); }
    const secs = {};
    for (const sg of mv.segments || []) { const a = Math.max(t0, sg.t0), b = Math.min(now, sg.t1 == null ? now : sg.t1); if (b > a) secs[sg.state] = (secs[sg.state] || 0) + (b - a); }
    const leg = Object.keys(secs).sort((a, b) => secs[b] - secs[a]).slice(0, 5).map(k => `<span style="--c:${(WF.STATE[k] || {}).color}"><i></i>${esc((WF.STATE[k] || {}).label || k)} <b>${esc(U.fmtDur(secs[k]))}</b></span>`).join('');
    h += `<div class="md-band" title="Zustände der letzten 8 Stunden">${WF.ui.stateBand(mv.segments, t0, now, { w: 448, h: 12 })}<div class="md-band-ax">${ticks.join('')}</div><div class="md-legend">${leg}</div></div>`;
    void st;
    return h + '</div>';
  }
  function sigStatus(mv, now) {
    const f = mv.fault, rp = f && f.repairBy ? personAt(f.repairBy) : null;
    return [mv.state, Math.floor(mv.sinceSec / 60), mv.cause, mv.phase, f ? f.code + f.repairBy + Math.floor(f.sinceSec / 60) + (rp ? rp.state + Math.floor((rp.workRem || 0) / 60) : '') : '',
      mv.fpi ? mv.fpi.stage + mv.fpi.by + Math.floor(mv.fpi.waitingSec / 60) : '', JSON.stringify(mv.manualToolChange),
      mv.people.map(p => p.id + p.taskLabel + p.where).join(','), mv.operator ? mv.operator.id + mv.operator.activity : '', Math.floor(now / 120), (mv.segments || []).length].join('|');
  }

  function toolChangeSensible(mv) {
    if (!mv.order || mv.phase !== 'Serie' || mv.state === 'toolchange') return { ok: false, why: !mv.order ? 'Kein Arbeitsgang aktiv' : mv.state === 'toolchange' ? 'Werkzeugwechsel läuft bereits' : `Erst möglich, wenn die Serie läuft (aktuell: ${mv.phase})` };
    const ts = mv.tools.filter(t => t.status === 'ok' || t.status === 'planned');
    if (!ts.length) return { ok: false, why: 'Keine Werkzeuge im Einsatz, die vorbeugend gewechselt werden könnten' };
    if ((mv.partsTotal - mv.partsDone - (mv.partNo != null ? 1 : 0)) <= 0) return { ok: false, why: 'Das letzte Teil des Arbeitsgangs läuft – kein Wechsel mehr nötig' };
    if (mv.manualToolChange) return { ok: false, why: `Vorbeugender Wechsel bereits beauftragt (${mv.manualToolChange.names.join(', ')})` };
    const short = ts.filter(t => t.remainingParts != null && t.neededParts != null && t.remainingParts < t.neededParts);
    if (!short.length) return { ok: false, why: 'Standzeit aller Werkzeuge reicht bis zum Ende des Arbeitsgangs – kein Wechsel nötig' };
    return { ok: true, short, ts };
  }
  function secActions(mv) {
    const tc = toolChangeSensible(mv);
    const hall = WF.views.some(v => v.id === 'halle');
    const hasTools = mv.kind === 'machine' && mv.type !== 'washer';
    return `<div class="md-acts">
      ${hasTools ? `<button class="btn sm" data-act="plan" ${tc.ok ? '' : 'disabled'} title="${esc(tc.ok ? 'Werkzeugwechsel vorziehen – z. B. vor Pause, Schichtende oder Geisterschicht' : tc.why)}">${icon('wrench', 14)}Vorbeugenden Werkzeugwechsel einplanen</button>` : ''}
      ${hall ? `<button class="btn sm" data-act="hall">${icon('cube', 14)}In der Halle zeigen</button>` : ''}
      <button class="btn sm ghost" data-act="fault" ${mv.fault ? 'disabled title="Maschine hat bereits eine Störung"' : 'title="Demo-Funktion: löst einen Alarm aus dem Störungskatalog dieser Maschine aus"'}>${icon('alert', 14)}Störung simulieren</button>
    </div>${tc.ok || !hasTools ? '' : `<div class="md-acts-note">Werkzeugwechsel: ${esc(tc.why)}.</div>`}`;
  }
  function sigActions(mv) { const tc = toolChangeSensible(mv); return [tc.ok, tc.why, !!mv.fault].join('|'); }

  function secOrder(mv, now) {
    if (!mv.order) {
      const q = mv.queue[0];
      return `<div class="md-card"><div class="md-meta">Kein Arbeitsgang aktiv.${q ? ` Als Nächstes: <b>${esc(q.orderId)} AG ${esc(q.seq)} ${esc(q.op)}</b> – ${esc(q.why)}.` : ' Für diesen Arbeitsplatz ist derzeit nichts eingeplant.'}</div></div>`;
    }
    const o = mv.order, ov = WF.sim.orderView(o.id);
    const so = S().orders[o.id];
    const risk = ov ? ov.risk : null;
    const tags = (o.priority === 'eil' ? '<span class="md-tag" style="--c:var(--accent)">Eilauftrag</span>' : '') +
      (risk && risk !== 'ok' && risk !== 'unbekannt' ? `<span class="md-tag" style="--c:${risk === 'spät' ? 'var(--st-fault)' : 'var(--st-wait)'}">${esc(WF.sim.label('risk', risk))}</span>` : '');
    const total = mv.partsTotal || 0, done = mv.partsDone || 0, running = mv.partNo != null;
    // Arbeitsplan-Kette
    let chain = '';
    if (so) {
      const ci = so.routing.findIndex(r => r.seq === o.seq);
      chain = '<div class="md-chain" aria-label="Arbeitsplan">' + so.routing.map((r, i) => {
        const opx = so.ops[i];
        const cls = i === ci ? 'cur' : opx && opx.complete ? 'done' : '';
        const isM = !!(WF.profile.stationById[r.station] && S().machines[r.station]);
        const lbl = r.station === 'VERSAND' ? 'Versand' : r.station === 'EXT' ? 'Extern' : r.station;
        const tip = `AG ${r.seq} ${r.op} – ${r.station === 'EXT' && r.ext ? r.ext.partner : stName(r.station)}${opx && opx.complete ? ' (fertig)' : i === ci ? ' (hier)' : ''}`;
        return (i ? '<span class="md-arr">›</span>' : '') + `<span class="md-step ${cls}${isM && r.station !== mv.id ? ' click' : ''}" style="--c:${mv.stateColor}" title="${esc(tip)}" ${isM && r.station !== mv.id ? `data-ent="machine|${esc(r.station)}"` : ''}>${cls === 'done' ? icon('check', 11) : ''}${esc(lbl)}</span>`;
      }).join('') + '</div>';
    }
    return `<div class="md-card">
      <div class="md-ord-h"><button class="link" data-ent="order|${esc(o.id)}">${esc(o.id)}</button><b title="${esc(o.partName)}">${esc(o.partName)}</b>${tags}</div>
      <div class="md-meta">${esc(o.customer)} · ${esc(U.fmtNum(o.qty))} Stk · Termin <b>${esc(U.fmtDue(o.due, now))}</b>${ov && ov.eta != null ? ` · Prognose fertig <b>${esc(U.fmtDue(ov.eta, now))}</b>` : ''}</div>
      <div class="md-meta"><b>AG ${esc(o.seq)} ${esc(o.op)}</b> · Taktzeit ${esc(U.fmtNum(o.cycleMin, o.cycleMin < 10 ? 1 : 0))} min${o.setupMin ? ` · Rüsten ${esc(o.setupMin)} min` : ''}${o.transferBatch ? ` · Weitergabe je ${esc(o.transferBatch)} Stk` : ''}${o.firstPiece ? ' · mit Erstteilprüfung' : ''}</div>
      ${chain}
      <div class="md-prog">
        <div class="md-prog-t"><b>${running ? `Teil ${esc(U.fmtNum(mv.partNo))} von ${esc(U.fmtNum(total))}` : `${esc(U.fmtNum(done))} von ${esc(U.fmtNum(total))} bearbeitet`}</b><span>${mv.etaOpEnd != null ? `Arbeitsgang fertig ca. <b>${esc(tclock(mv.etaOpEnd, now))}</b>` : ''}</span></div>
        <span class="bar" style="--c:${mv.stateColor}"><i data-live-w="opFrac" style="width:0%"></i></span>
        <div class="md-meta" style="font-size:11.5px">${esc(U.fmtNum(done))} bearbeitet${ov ? (() => { const opv = ov.ops.find(x => x.seq === o.seq); return opv && opv.scrap ? ` · davon ${esc(opv.scrap)} Ausschuss` : ''; })() : ''}${total > done ? ` · ${esc(U.fmtNum(total - done))} offen` : ''}${total > o.qty ? ` · Soll inkl. ${esc(total - o.qty)} Ersatz für Ausschuss` : ''}</div>
      </div>
      ${running ? `<div class="md-prog">
        <div class="md-prog-t"><b data-live="partLbl"></b><span data-live="partEnd"></span></div>
        <span class="bar thin" style="--c:${mv.partSub === 'load' ? 'var(--st-wait)' : 'var(--info)'}"><i data-live-w="partFrac" style="width:0%"></i></span>
      </div>` : ''}
    </div>`;
  }
  function sigOrder(mv, now) {
    if (!mv.order) return 'none|' + (mv.queue[0] ? mv.queue[0].orderId + mv.queue[0].seq + mv.queue[0].why : '');
    const ov = WF.sim.orderView(mv.order.id);
    return [mv.order.id, mv.order.seq, mv.order.priority, mv.partsDone, mv.partsTotal, mv.partNo, mv.partSub, mv.etaOpEnd != null ? Math.floor(mv.etaOpEnd / 60) : '', mv.stateColor,
      ov ? ov.risk + (ov.eta != null ? Math.floor(ov.eta / 60) : '') : '', Math.floor(now / 86400)].join('|');
  }
  function liveOrder(mv, now) {
    const total = mv.partsTotal || 0, done = mv.partsDone || 0, running = mv.partNo != null;
    const v = { opFrac: total ? Math.min(1, (done + (running ? mv.partProgress : 0)) / total) : 0 };
    if (running) {
      if (mv.partSub === 'load') v.partLbl = `Teil ${U.fmtNum(mv.partNo)} wird eingelegt${mv.loadRemainSec != null ? ' – noch ' + durS(mv.loadRemainSec) : ''}`;
      else if (mv.partPaused) v.partLbl = `Teil ${U.fmtNum(mv.partNo)} unterbrochen (${Math.round(mv.partProgress * 100)} %)`;
      else v.partLbl = `Teil ${U.fmtNum(mv.partNo)} · ${Math.round(mv.partProgress * 100)} % · noch ${durS(mv.partRemainSec)}`;
      v.partEnd = mv.partEndT != null ? 'Teilende ca. ' + tclock(mv.partEndT, now) + (mv.fault ? ' (nach Reparatur)' : '') : '';
      v.partFrac = mv.partSub === 'load' ? 0 : mv.partProgress;
    }
    return v;
  }

  function secTools(mv, st) {
    const now = WF.sim.t;
    const ts = mv.tools.filter(t => t.status !== 'idle');
    const idle = mv.tools.filter(t => t.status === 'idle');
    if (!ts.length && !idle.length) return `<div class="md-card"><div class="md-meta">${mv.kind === 'machine' ? 'Kein Arbeitsgang aktiv – Werkzeuge werden beim Rüsten bestückt.' : 'Dieser Arbeitsplatz arbeitet ohne Schneidwerkzeuge (keine Standzeit-Überwachung).'}</div></div>`;
    if (!ts.length) return `<div class="md-card"><div class="md-meta">Kein Arbeitsgang aktiv.</div><div class="md-idle-tools">Montiert, nicht im Einsatz: ${idle.map(t => esc(t.name) + ' (' + esc(U.fmtNum(t.wearPct, 0)) + ' %)').join(', ')}</div></div>`;
    if (!st.toolSel || !ts.some(t => (t.id || t.typeId) === st.toolSel)) {
      const rank = { broken: 0, due: 1, changing: 2, planned: 3, ok: 4 };
      st.toolSel = (ts.slice().sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || (a.remainingParts ?? 1e9) - (b.remainingParts ?? 1e9))[0] || {}).id || ts[0].typeId;
    }
    const rows = ts.map((t, i) => {
      const key = t.id || t.typeId, c = TOOL_C[t.status] || 'var(--st-idle)', pc = t.plannedChange;
      let pcTxt = '';
      if (pc) pcTxt = `${pc.manual ? 'Vorbeugend: ' : ''}Wechsel ${pc.text}${pc.by ? ' · ' + pc.by + (pc.stage && pc.stage !== 'offen' && pc.stage !== 'später' ? ' ' + pc.stage : '') : ''}${pc.bundled ? ' · wird mitgewechselt' : ''}`;
      else if (t.status === 'due') pcTxt = 'Standzeit reicht nicht für das nächste Teil';
      else if (t.status === 'broken') pcTxt = 'Wechsel vor dem nächsten Teil';
      const wear = t.wearPct != null ? t.wearPct : null;
      const rest = t.remainingParts != null ? `noch ${teile(t.remainingParts)}` : '–';
      const need = t.neededParts != null && t.remainingParts != null ? (t.remainingParts >= t.neededParts ? 'reicht bis AG-Ende' : `Bedarf ${teile(t.neededParts)}`) : '';
      return `<tr class="md-tr${key === st.toolSel ? ' on' : ''}" data-tool="${esc(key)}" style="--c:${c}" tabindex="0" title="Klicken: Erklärung anzeigen">
        <td class="md-slot">T${i + 1}</td>
        <td><div class="md-tn">${esc(t.name)}</div><div class="md-tk">${esc(WF.sim.label('toolKind', t.kind))}${t.cutMinPerPart != null ? ' · ' + esc(U.fmtNum(t.cutMinPerPart, 1)) + ' min/Teil' : ''}${t.life ? ' · Standzeit ' + esc(U.fmtNum(t.life)) + ' min' : ''}</div>${pcTxt ? `<div class="md-pc">${esc(pcTxt)}</div>` : ''}</td>
        <td class="r"><div class="md-wear">${wear != null ? `<span>${esc(U.fmtNum(wear, 0))} %</span>${WF.ui.bar(wear / 100, { color: c })}` : '<span>–</span>'}</div></td>
        <td class="r"><div class="md-rest">${esc(rest)}<small>${esc(need)}</small></div><span class="md-chip" style="--c:${c}">${esc(WF.sim.label('toolStatus', t.status))}</span></td></tr>`;
    }).join('');
    const sel = ts.find(t => (t.id || t.typeId) === st.toolSel) || ts[0];
    return `<div class="tbl-wrap"><table class="md-tools"><thead><tr><th class="md-slot"></th><th>Werkzeug</th><th class="r">Verschleiß</th><th class="r">Rest · Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${idle.length ? `<div class="md-idle-tools">Außerdem montiert, im Arbeitsgang nicht im Einsatz: ${idle.map(t => esc(t.name) + ' (' + esc(U.fmtNum(t.wearPct, 0)) + ' %)').join(', ')}</div>` : ''}
      <div class="md-explain" style="margin-top:10px">
        <div class="md-ex-h">${icon('info', 14)}<span>WARUM? · ${esc(sel.name)}</span><span class="spacer"></span>${sel.id ? `<button class="link" data-ent="tool|${esc(sel.id)}" style="font-size:11.5px;font-weight:500;letter-spacing:0">Werkzeugdetails</button>` : ''}</div>
        <div>${esc(sel.explain || '–')}</div>
        <div class="md-rule">${toolRule(sel)}</div>
      </div>`;
  }
  /** Die eine Regel – mit den Werten genau dieses Werkzeugs (Ankündigung = planHorizonParts, Wechselgrenze = changeAtParts) */
  function toolRule(t) {
    const base = 'Regel: Verschleiß zählt am Ende jedes Teils; geschnitten wird nur, wenn die Reststandzeit für das ganze nächste Teil reicht, gewechselt nie mitten im Teil.';
    const H = t.planHorizonParts, at = t.changeAtParts;
    if (H == null || at == null) return esc(base + ' Wechselzeitpunkt und Vorlauf werden berechnet, sobald die Serie läuft.');
    const wear = t.planWearPct != null ? ` (ab ca. ${U.fmtNum(t.planWearPct, 0)} % Verschleiß)` : '';
    const change = at === 0
      ? `<b>Wechsel:</b> an der letzten Teilegrenze, an der die Standzeit noch für ein ganzes Teil reicht${esc(wear)} – Wechselgrenze 0 Teile, weil bei langen Schnitten sonst mehr als ca. 10 % der Standzeit ungenutzt blieben.`
      : `<b>Wechsel:</b> an der Teilegrenze, sobald höchstens ${esc(teile(at))} Reststandzeit übrig ${at === 1 ? 'ist' : 'sind'}${esc(wear)} – Wechselgrenze ${esc(teile(at))}.`;
    return `${esc(base)}<br><b>Ankündigung:</b> ${esc(teile(H))} vorher (Vorlauf zum Holen des Werkzeugs).<br>${change} Reicht die Reststandzeit bis zum Ende des Arbeitsgangs, wird nicht gewechselt.`;
  }
  function sigTools(mv, st) {
    return st.toolSel + '|' + mv.tools.map(t => [t.id, t.status, t.remainingParts, t.wearPct != null ? Math.round(t.wearPct) : '', t.plannedChange ? t.plannedChange.text + t.plannedChange.by + t.plannedChange.stage : '', t.explain, t.changeAtParts, t.planHorizonParts].join('~')).join('||');
  }

  function secSignals(mv, now) {
    const sg = mv.signals || {}, lv = mv.conn.level || 0;
    if (lv === 0) {
      return `<div class="md-card"><div class="md-l0">${icon('plug', 18)}<div style="display:flex;flex-direction:column;gap:6px">
        <div><b>Nicht angebunden</b> – Zustand und Stückzahlen kommen aus Rückmeldungen per Tablet und der Planung.</div>
        <div class="md-meta">Letzte Tablet-Rückmeldung: <b>${esc(sg.lastFeedback || '–')}</b>${sg.lastFeedbackT != null ? ` um ${esc(tclock(sg.lastFeedbackT, now))} (vor ${esc(U.fmtDur(now - sg.lastFeedbackT))})` : ''}</div>
        <div class="md-meta">Mit Nachrüst-Sensorik (Stromsensor + Signalsäule) erfasst werkfluss Laufzeit und Stillstände automatisch – ohne Eingriff in die Steuerung.</div>
        ${WF.views.some(v => v.id === 'anbindung') ? `<div><button class="btn sm primary" data-act="connect">${icon('plug', 14)}Jetzt anbinden</button></div>` : ''}
      </div></div></div>`;
    }
    const arr = SAMPLES[mv.id] || [];
    const tile = (l, v, spark, wide) => `<div class="md-s${wide ? ' wide' : ''}"><span class="l">${l}</span><span class="v${typeof v === 'object' ? ' ' + v.cls : ''}" ${typeof v === 'object' && v.live ? `data-live="${v.live}"` : ''}>${typeof v === 'object' ? v.html : v}</span>${spark ? `<div class="sp">${spark}</div><div class="md-sp-ax"><span>−30 min</span><span>jetzt</span></div>` : ''}</div>`;
    const light = `<span class="md-stack"><i class="${sg.stackLight === 'red' ? 'on' : ''}" style="--c:${STACK.red}"></i><i class="${sg.stackLight === 'yellow' ? 'on' : ''}" style="--c:${STACK.yellow}"></i><i class="${sg.stackLight === 'green' ? 'on' : ''}" style="--c:${STACK.green}"></i></span>${esc(sg.stackLightLabel || '–')}`;
    let h = '<div class="md-sig">';
    if (lv === 1) {
      h += tile('Leistung', `${esc(U.fmtNum(sg.powerKw, 1))}<small>kW</small>`, timeSpark(arr, 'kw', now, 'var(--info)'));
      h += tile('Strom', `${esc(U.fmtNum(sg.currentA, 1))}<small>A</small>`, timeSpark(arr, 'amp', now, 'var(--info)'));
      h += tile('Signalsäule', { cls: 'light', html: light });
      h += tile('Laufzeit heute', esc(U.fmtDur(sg.runtimeTodaySec)));
    } else {
      h += tile('Betriebsart', esc(MODE_LBL[sg.mode] || sg.mode || '–'));
      h += tile('Signalsäule', { cls: 'light', html: light });
      if (sg.spindleRpm !== null && sg.spindleRpm !== undefined) {
        h += tile('Spindeldrehzahl', `${esc(U.fmtNum(sg.spindleRpm))}<small>1/min</small>`, timeSpark(arr, 'rpm', now, 'var(--info)'));
        h += tile('Spindellast', `${esc(U.fmtNum(sg.spindleLoadPct))}<small>%</small>`, timeSpark(arr, 'load', now, sg.spindleLoadPct >= 70 ? 'var(--st-wait)' : 'var(--info)'));
        h += tile('Vorschub-Override', `${esc(U.fmtNum(sg.feedOverridePct))}<small>%</small>`);
        h += tile('Kühlmittel', sg.coolant ? 'ein' : 'aus');
      }
      if (sg.measuringProgram != null) { h += tile('Merkmal', esc(sg.feature || '–')); h += tile('Taster', esc(sg.probe || '–')); }
      if (sg.bathTempC != null) { h += tile('Badtemperatur', `${esc(U.fmtNum(sg.bathTempC))}<small>°C</small>`, timeSpark(arr, 'temp', now, 'var(--info)')); h += tile('Zyklus', esc(sg.cycle || '–')); }
      if (sg.terminalStep != null) h += tile('Montage-Terminal', esc(sg.terminalStep));
      h += tile('Stückzähler Arbeitsgang', `${esc(U.fmtNum(sg.partCounter))}${mv.partsTotal ? `<small>von ${esc(U.fmtNum(mv.partsTotal))}</small>` : ''}`);
      if (mv.powerKw != null) h += tile('Leistung', `${esc(U.fmtNum(mv.powerKw, 1))}<small>kW</small>`, timeSpark(arr, 'kw', now, 'var(--info)'));
      h += tile(sg.measuringProgram != null ? 'Messprogramm' : 'NC-Programm', { cls: 'mono', html: esc(sg.program || '–') }, null, true);
      if (lv >= 3 && sg.spindleRpm !== null && sg.spindleRpm !== undefined) h += tile('Werkzeug in der Spindel', { cls: 'mono', html: sg.toolInSpindle ? `${esc(sg.toolInSpindle)} · ${esc(sg.toolInSpindleName || '')}` : '–' }, null, true);
      if (sg.alarm) h += tile('Alarm', { cls: 'mono', html: `<span style="color:var(--st-fault)">${esc(sg.alarm)}</span>` }, null, true);
    }
    h += '</div>';
    h += `<div class="md-sig-f">Quelle: ${esc(sg.source || mv.conn.protocol)} · Gateway ${esc(mv.conn.gateway || '–')} · Raster 5 s · Verläufe: letzte 30 min · Stand ${esc(U.fmtClock(sg.t || now))}${lv >= 2 ? '' : ' · Level 2 (Steuerung lesen) liefert zusätzlich Programm, Spindel und Stückzähler'}</div>`;
    return h;
  }
  function sigSignals(mv, now) {
    const sg = mv.signals || {};
    if ((mv.conn.level || 0) === 0) return '0|' + sg.lastFeedbackT + '|' + sg.lastFeedback + '|' + Math.floor(now / 60);
    return mv.conn.level + '|' + sg.t + '|' + (SAMPLES[mv.id] || []).length;
  }

  function secBuffers(mv) {
    const slots = (n, cap) => { let s = `<div class="md-slots${n >= cap ? ' full' : ''}">`; for (let i = 0; i < cap; i++) s += `<i class="${i < n ? 'f' : ''}"></i>`; return s + '</div>'; };
    const list = (arr) => arr.map(c => `<button class="md-cont" data-ent="container|${esc(c.id)}" title="${esc(c.where)}"><b>${esc(c.orderId || '–')} · ${esc(U.fmtNum(c.qty))} Stk</b><span>${esc(c.partName || '')} · ${esc(c.stateLabel)}${c.kind !== 'parts' ? ' · ' + esc(WF.sim.label('containerKind', c.kind)) : ''}</span></button>`).join('');
    let inBox;
    if (mv.inCap) inBox = `<div class="md-buf-h"><span>Eingang</span><span>${mv.input.length}/${mv.inCap}</span></div>${slots(mv.input.length, mv.inCap)}${mv.input.length ? list(mv.input) : '<div class="md-buf-e">leer</div>'}`;
    else if (mv.barStockM != null) inBox = `<div class="md-buf-h"><span>Stangenmagazin</span><span>${esc(U.fmtNum(mv.barStockM, 1))}/${esc(U.fmtNum(mv.barMagazineM, 0))} m</span></div>${WF.ui.bar(mv.barStockM / mv.barMagazineM, { color: mv.barStockM < mv.barReorderM ? 'var(--st-wait)' : 'var(--mat)' })}<div class="md-buf-e">${esc(mv.barMaterial || '–')} · Nachschub unter ${esc(U.fmtNum(mv.barReorderM, 0))} m</div>`;
    else inBox = `<div class="md-buf-h"><span>Eingang</span><span>–</span></div><div class="md-buf-e">${mv.type === 'saw' ? 'Entnimmt Stangen direkt aus dem Rohmaterial-Lager' : 'kein Eingangspuffer'}</div>`;
    const outBox = mv.outCap ? `<div class="md-buf-h"><span>Ausgang</span><span>${mv.output.length}/${mv.outCap}</span></div>${slots(mv.output.length, mv.outCap)}${mv.output.length ? list(mv.output) : '<div class="md-buf-e">leer</div>'}` : '<div class="md-buf-h"><span>Ausgang</span><span>–</span></div>';
    return `<div class="md-buf"><div class="md-buf-c">${inBox}</div><div class="md-buf-c">${outBox}</div></div>`;
  }
  function sigBuffers(mv) { return [mv.input.map(c => c.id + c.qty + c.state).join(','), mv.output.map(c => c.id + c.qty + c.state).join(','), mv.barStockM != null ? Math.round(mv.barStockM * 10) : ''].join('|'); }

  function secToday(mv) {
    const o = mv.oeeToday || {}, os = mv.oeeShift || {};
    const apq = (l, v, c) => `<div><span>${l}</span>${WF.ui.bar(v || 0, { color: c, thin: true })}<b>${esc(U.fmtPct(v, 1))}</b></div>`;
    const tot = Object.values(mv.stateTimes || {}).reduce((a, b) => a + b, 0) || 1;
    const keys = Object.keys(WF.STATE).filter(k => (mv.stateTimes || {})[k] > 0);
    const dist = keys.map(k => `<i style="--c:${WF.STATE[k].color};width:${((mv.stateTimes[k] / tot) * 100).toFixed(2)}%" title="${esc(WF.STATE[k].label)}: ${esc(U.fmtDur(mv.stateTimes[k]))}"></i>`).join('');
    const leg = keys.sort((a, b) => mv.stateTimes[b] - mv.stateTimes[a]).slice(0, 6).map(k => `<span style="--c:${WF.STATE[k].color}"><i></i>${esc(WF.STATE[k].label)} <b>${esc(U.fmtDur(mv.stateTimes[k]))}</b></span>`).join('');
    return `<div class="md-card">
      <div class="md-oee"><div class="md-oee-v">${esc(U.fmtPct(o.oee, 0))}<small>OEE heute${os.oee != null ? ' · Schicht ' + esc(U.fmtPct(os.oee, 0)) : ''}</small></div>
        <div class="md-apq">${apq('Verfügbarkeit', o.availability, 'var(--st-run)')}${apq('Leistung', o.performance, 'var(--info)')}${apq('Qualität', o.quality, 'var(--st-setup)')}</div></div>
      <div class="md-dist" aria-label="Zustandsverteilung heute">${dist}</div>
      <div class="md-legend">${leg}</div>
      <div class="md-dl4">
        <div><div class="l">Gutteile</div><div class="v">${esc(U.fmtNum(mv.goodToday))}</div></div>
        <div><div class="l">Ausschuss</div><div class="v" style="${mv.scrapToday ? 'color:var(--st-wait)' : ''}">${esc(U.fmtNum(mv.scrapToday))}</div></div>
        <div><div class="l">Energie</div><div class="v">${esc(U.fmtNum(mv.energyKwhToday, 0))} <small class="muted" style="font-size:11px">kWh</small></div></div>
        <div><div class="l">Stillstand</div><div class="v">${esc(U.fmtEur(mv.lossEurToday))}</div></div>
      </div>
      <div class="md-meta" style="font-size:11px">OEE = Verfügbarkeit × Leistung × Qualität; Bezugszeit ist die Schichtzeit ohne Pausen mit eingeplantem Auftrag. Stillstand = ${esc(U.fmtEur(mv.rate))}/h Maschinenstundensatz × Zeit ohne Produktion.</div>
    </div>`;
  }
  function sigToday(mv) { const o = mv.oeeToday || {}; return [o.oee, o.availability, o.performance, o.quality].map(x => x == null ? '' : Math.round(x * 1000)).join(',') + '|' + Object.values(mv.stateTimes || {}).map(x => Math.floor(x / 60)).join(',') + '|' + mv.goodToday + mv.scrapToday + Math.round(mv.energyKwhToday) + mv.lossEurToday; }

  function secQueue(mv, now) {
    if (!mv.queue.length) return '<div class="md-card"><div class="md-meta">Keine weiteren Arbeitsgänge für diesen Arbeitsplatz eingeplant.</div></div>';
    const C = ['var(--faint)', 'var(--st-wait)', 'var(--st-run)'], L = ['Vorgänger in Arbeit', 'Material kommt', 'Material bereit'];
    return '<div class="md-q">' + mv.queue.slice(0, 8).map(q => {
      const o = S().orders[q.orderId];
      return `<div class="md-qr" style="--c:${C[q.level] || C[0]}"><i title="${esc(L[q.level] || '')}"></i>
        <div class="md-qm"><div><button class="link" data-ent="order|${esc(q.orderId)}">${esc(q.orderId)}</button> AG ${esc(q.seq)} ${esc(q.op)}${q.priority === 'eil' ? ' <span class="md-tag" style="--c:var(--accent)">Eil</span>' : ''}</div><div>${esc(o ? o.part.name + ' · ' : '')}${esc(teile(q.parts))} · ${esc(q.why)}</div></div>
        <div class="md-qd">Termin<br>${esc(U.fmtDue(q.due, now))}</div></div>`;
    }).join('') + (mv.queue.length > 8 ? `<div class="md-meta" style="padding-top:6px">+ ${mv.queue.length - 8} weitere</div>` : '') + '</div>';
  }
  function sigQueue(mv, now) { return mv.queue.map(q => q.orderId + q.seq + q.level + q.why + q.parts + q.priority).join(',') + Math.floor(now / 86400); }

  function secMaster(mv) {
    const P = WF.profile.stationById[mv.id] || {};
    return `<dl class="dl md-dl">
      <dt>Maschine</dt><dd>${esc(mv.name)}</dd>
      <dt>Hersteller / Modell</dt><dd>${esc(mv.vendor || '–')} ${esc(mv.model || '')}</dd>
      <dt>Steuerung</dt><dd>${esc(mv.control || '–')}</dd>
      <dt>Baujahr</dt><dd>${esc(mv.year || '–')}</dd>
      <dt>Bereich</dt><dd>${esc(mv.area || '–')}</dd>
      <dt>Automation</dt><dd>${esc(AUTOMATION[mv.automation] || mv.automation || '–')}</dd>
      <dt>Beladung</dt><dd>${esc(WF.sim.label('loading', mv.loading))}${P.loadMin ? ` (${esc(U.fmtNum(P.loadMin, 1))} min je Teil)` : ''}</dd>
      <dt>Stundensatz</dt><dd>${esc(U.fmtEur(mv.rate))}/h</dd>
      <dt>Anbindung</dt><dd>Level ${esc(mv.conn.level)} – ${esc(WF.sim.label('conn', mv.conn.level))}<br><span class="muted">${esc(mv.conn.protocol || '')}${mv.conn.gateway && mv.conn.gateway !== '–' ? ' · ' + esc(mv.conn.gateway) : ''}</span></dd>
      ${P.inCap != null ? `<dt>Pufferplätze</dt><dd>Eingang ${esc(P.inCap)} · Ausgang ${esc(P.outCap)} Behälter</dd>` : ''}
    </dl>`;
  }
  function sigMaster(mv) { return mv.conn.level + mv.conn.protocol; }

  function machineEvents(id, n) {
    const ev = S().events || [], out = [];
    for (let j = ev.length - 1; j >= 0 && out.length < n; j--) {
      const e = ev[j];
      if (!e.entity || e.entity.id !== id || (e.entity.kind !== 'machine')) continue;
      if (e.type === 'state' && e.data && e.data.minor) continue;
      out.push(e);
    }
    return out;
  }
  function evColor(e) {
    if (e.type === 'state') return (WF.STATE[e.data && e.data.to] || {}).color || 'var(--muted)';
    if (e.type === 'toolChanged' || e.type === 'toolPlanned') return 'var(--st-tool)';
    return (WF.SEV[e.sev] || WF.SEV.info).color;
  }
  function secEvents(mv, now) {
    const list = machineEvents(mv.id, 10);
    if (!list.length) return '<div class="md-meta">Noch keine Ereignisse heute.</div>';
    return list.map(e => `<div class="md-ev" style="--c:${evColor(e)}"><span class="num">${esc(tclock(e.t, now))}</span><span><i></i>${esc(e.msg)}</span></div>`).join('');
  }
  function sigEvents(mv) { const l = machineEvents(mv.id, 1); return l.length ? l[0].id : ''; }

  // ------------------------------------------------------------------ Aktionen
  function openFaultModal(id) {
    const P = WF.profile, st = P.stationById[id] || {};
    const F = P.faults || {};
    let cat;
    if (st.type === 'washer' || st.type === 'cmm' || st.type === 'assembly') cat = (F[st.type] || []).slice();
    else { const noBreak = st.type === 'cylgrinder' || st.type === 'surfgrinder' || st.type === 'saw'; cat = (F.generic || []).filter(x => !(x.toolBreak && noBreak)).concat(F[st.automation] || [], F[st.type] || []); }
    const body = document.createElement('div');
    body.className = 'stack';
    body.innerHTML = `<p class="muted" style="margin:0;font-size:13px">Demo-Funktion: löst an <b style="color:var(--text)">${esc(id)} ${esc(st.short || '')}</b> einen Alarm aus dem Störungskatalog aus. Danach sieht man, wie werkfluss reagiert – Benachrichtigung an die Instandhaltung, automatische Zuteilung der Reparatur, Auswirkung auf Liefertermine und Werkzeugplanung.</p>
      <label class="field" for="md-fcode">Alarm<select class="input" id="md-fcode"><option value="">Zufälliger Alarm aus dem Katalog</option>${cat.map(f => `<option value="${esc(f.code)}">${esc(f.code)} – ${esc(f.text)}${f.toolBreak ? ' (nur während der Bearbeitung)' : ''}</option>`).join('')}</select></label>`;
    WF.app.modal({ title: 'Störung simulieren', body, actions: [
      { label: 'Abbrechen' },
      { label: 'Störung auslösen', danger: true, onClick: () => {
        const code = body.querySelector('#md-fcode').value || undefined;
        const r = WF.sim.actions.triggerFault(id, code);
        WF.app.toast(r && r.msg ? r.msg : 'Ausgelöst', r && r.ok === false ? 'warn' : 'crit');
        return r && r.ok === false ? false : undefined;
      } },
    ] });
  }
  function openPlanModal(id) {
    const mv = WF.sim.machineView(id); if (!mv) return;
    const tc = toolChangeSensible(mv);
    if (!tc.ok) { WF.app.toast(tc.why, 'info'); return; }
    const now = WF.sim.t;
    const body = document.createElement('div');
    body.className = 'stack';
    const sh = WF.sim.shift();
    body.innerHTML = `<p class="muted" style="margin:0;font-size:13px">Der Wechsel erfolgt an einer Teilegrenze – nie mitten im Teil – und wird dem Einrichter als Auftrag angezeigt. Ohne Auswahl wählt werkfluss selbst: das Werkzeug, dessen Standzeit für <b style="color:var(--text)">${esc(mv.order.id)} AG ${esc(mv.order.seq)}</b> zuerst ausläuft, plus Werkzeuge, die sinnvoll mitgewechselt werden.</p>
      <div class="stack" style="gap:6px">${tc.ts.map(t => {
        const shortT = t.remainingParts < t.neededParts;
        return `<label style="display:flex;gap:9px;align-items:flex-start;font-size:13px;cursor:pointer"><input type="checkbox" value="${esc(t.typeId)}" style="margin-top:3px"><span><b>${esc(t.name)}</b><br><span class="muted" style="font-size:12px">${esc(U.fmtNum(t.wearPct, 0))} % Verschleiß · noch ${esc(teile(t.remainingParts))} · Bedarf ${esc(teile(t.neededParts))} – ${shortT ? 'reicht nicht bis AG-Ende' : 'reicht bis AG-Ende'}</span></span></label>`;
      }).join('')}</div>
      <label class="field" for="md-when">Zeitpunkt<select class="input" id="md-when"><option value="">An der nächsten Teilegrenze</option>${sh.id && sh.endsAt > now + 900 ? `<option value="${sh.endsAt - 1800}">Kurz vor Schichtende (ab ${esc(U.fmtClock(sh.endsAt - 1800))}) – z. B. vor der Geisterschicht</option>` : ''}</select></label>
      <label class="field" for="md-reason">Grund (optional)<input class="input" id="md-reason" maxlength="80" value="vom Leitstand vorgezogen"></label>`;
    WF.app.modal({ title: `Vorbeugender Werkzeugwechsel ${id}`, body, actions: [
      { label: 'Abbrechen' },
      { label: 'Wechsel beauftragen', primary: true, onClick: () => {
        const sel = [...body.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value);
        const types = sel.length ? sel : undefined;
        const nb = body.querySelector('#md-when').value;
        const reason = body.querySelector('#md-reason').value.trim();
        const r = WF.sim.actions.planToolChange(id, types, { notBefore: nb ? Number(nb) : undefined, reason: reason || undefined });
        WF.app.toast(r && r.msg ? r.msg : 'Beauftragt', r && r.ok === false ? 'warn' : 'ok');
        return r && r.ok === false ? false : undefined;
      } },
    ] });
  }

  // ------------------------------------------------------------------ Detail-Registrierung
  const SECTIONS = [
    { key: 'status', title: null, render: secStatus, sig: sigStatus },
    { key: 'actions', title: null, render: secActions, sig: sigActions },
    { key: 'order', title: 'Auftrag & Fortschritt', render: secOrder, sig: sigOrder },
    { key: 'tools', title: 'Werkzeuge', render: (mv, now, st) => secTools(mv, st), sig: (mv, now, st) => sigTools(mv, st), sub: (mv) => { const n = mv.tools.filter(t => t.status !== 'idle').length; return n ? `${n} im Arbeitsgang` : ''; } },
    { key: 'signals', title: 'Live-Signale', render: secSignals, sig: sigSignals, sub: (mv) => `Level ${mv.conn.level} · ${WF.sim.label('conn', mv.conn.level)}` },
    { key: 'buffers', title: 'Puffer', render: secBuffers, sig: sigBuffers, sub: () => 'Behälter am Arbeitsplatz' },
    { key: 'today', title: 'Heute', render: secToday, sig: sigToday },
    { key: 'queue', title: 'Warteschlange', render: secQueue, sig: sigQueue, sub: (mv) => mv.queue.length ? `${mv.queue.length} ${mv.queue.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge'}` : '' },
    { key: 'master', title: 'Stammdaten', render: secMaster, sig: sigMaster },
    { key: 'events', title: 'Letzte Ereignisse', render: secEvents, sig: sigEvents },
  ];

  WF.registerDetail('machine', (id) => {
    const mv0 = WF.sim.machineView(id);
    if (!mv0) return null;
    const st = { toolSel: null, nodes: {}, sigs: {}, subs: {} };
    const subtitle = `<span class="md-sub"><span>${esc(id)} · ${esc(mv0.name)}</span><span class="faint">·</span><span>${esc(mv0.area)}</span><span class="conn" data-l="${esc(mv0.conn.level)}" title="${esc(mv0.conn.protocol)}">L${esc(mv0.conn.level)}</span></span>`;
    function render(el) {
      el.innerHTML = '';
      for (const sec of SECTIONS) {
        const node = document.createElement('section');
        node.className = 'md-sec md-' + sec.key;
        node.innerHTML = (sec.title ? `<h4><span>${esc(sec.title)}</span><span class="spacer"></span><small data-sub></small></h4>` : '') + '<div data-body></div>';
        el.append(node);
        st.nodes[sec.key] = { node, body: node.querySelector('[data-body]'), sub: node.querySelector('[data-sub]') };
      }
      el.addEventListener('click', (e) => onClick(e, el));
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.md-tr')) { e.preventDefault(); selectTool(e.target.dataset.tool, el); } });
      update(el, true);
    }
    function selectTool(key, el) { st.toolSel = key; st.sigs.tools = null; update(el, true); const r = el.querySelector(`tr.md-tr[data-tool="${CSS.escape(key)}"]`); if (r) r.focus({ preventScroll: true }); }
    function onClick(e, el) {
      const tr = e.target.closest('tr.md-tr');
      if (tr && !e.target.closest('[data-ent]')) { selectTool(tr.dataset.tool, el); return; }
      const ent = e.target.closest('[data-ent]');
      if (ent) { const [k, i] = ent.dataset.ent.split('|'); if (LINKABLE[k]) WF.app.select(k, i); return; }
      const act = e.target.closest('[data-act]'); if (!act || act.disabled) return;
      switch (act.dataset.act) {
        case 'repair': { const r = WF.sim.actions.repair(id); WF.app.toast(r.msg || 'Behoben', r.ok === false ? 'warn' : 'ok'); update(el, true); break; }
        case 'fault': openFaultModal(id); break;
        case 'plan': openPlanModal(id); break;
        case 'hall': WF.app.navigate('halle'); if (WF.hall && WF.hall.focusStation) { try { WF.hall.focusStation(id); } catch (err) { console.warn(err); } } break;
        case 'connect': WF.app.navigate('anbindung', { machineId: id }); break;
      }
    }
    function update(el, force) {
      if (!el || !st.nodes.status) return;
      const mv = WF.sim.machineView(id); if (!mv) return;
      const now = WF.sim.t;
      for (const sec of SECTIONS) {
        const n = st.nodes[sec.key];
        let sig;
        try { sig = sec.sig(mv, now, st); } catch (e) { sig = Math.random(); }
        if (force || sig !== st.sigs[sec.key]) {
          st.sigs[sec.key] = sig;
          const active = document.activeElement, inside = active && n.body.contains(active);
          const focusKey = inside ? (active.dataset.tool || active.dataset.act || active.dataset.ent) : null;
          n.body.innerHTML = sec.render(mv, now, st);
          if (focusKey) { const f = n.body.querySelector(`[data-tool="${CSS.escape(focusKey)}"],[data-act="${CSS.escape(focusKey)}"],[data-ent="${CSS.escape(focusKey)}"]`); if (f) f.focus({ preventScroll: true }); }
        }
        if (n.sub && sec.sub) { const s = sec.sub(mv); if (st.subs[sec.key] !== s) { st.subs[sec.key] = s; n.sub.textContent = s; } }
      }
      // schnelle Werte
      const live = liveOrder(mv, now);
      el.querySelectorAll('[data-live]').forEach(x => { const v = live[x.dataset.live]; if (v != null && x._t !== v) { x._t = v; x.textContent = v; } });
      el.querySelectorAll('[data-live-w]').forEach(x => { const v = live[x.dataset.liveW]; if (v != null) { const w = (Math.min(1, Math.max(0, v)) * 100).toFixed(1) + '%'; if (x._w !== w) { x._w = w; x.style.width = w; } } });
    }
    return {
      title: mv0.short,
      subtitle,
      render,
      update: (el) => update(el, false),
      askPrompt: `Gib mir eine kurze Lageeinschätzung zu ${id} ${mv0.short}: Was passiert gerade und warum, welche Werkzeugwechsel stehen an, ist der Termin des laufenden Auftrags gefährdet, und was empfiehlst du?`,
    };
  });

  /** Öffentlich: aufgezeichnete Signalverläufe (für andere Ansichten, z. B. Anbindung/Live-Test) */
  WF.machineSignals = { samples: (id) => (SAMPLES[id] || []).slice() };
})();
