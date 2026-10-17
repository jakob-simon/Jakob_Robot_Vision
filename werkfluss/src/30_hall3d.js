/* werkfluss – Ansicht „Halle 3D“: digitaler Zwilling der Halle (Three.js r147, global THREE + THREE.OrbitControls).
   Gebäude, Maschinen je Typ prozedural modelliert, Lager/Zonen, Personen, AGVs, Stapler, Behälter.
   Ebenen: Materialfluss (aktive Transporte), Datenfluss (Maschinen-Ereignisse → Kabeltrasse → MES-Server,
   Meldungen → Personen), Personen, Beschriftungen. Hallenplan (Minikarte) mit Kamerablick.
   Liest ausschließlich WF.sim.state und abgeleitete Sichten (machineView, containerView, orderView);
   Klick → WF.app.select(kind, id). Öffentlich: WF.hall = { focusStation(id), focusOrder(id) }. CSS-Präfix .h3- */
(function () {
  'use strict';
  const WF = window.WF;
  if (!WF || !WF.registerView) return;
  const THREE = window.THREE;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;
  const PI = Math.PI, TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = U.clamp;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const fmtN = (n) => U.fmtNum(n, 0);
  const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`;
  const LS_KEY = 'werkfluss.halle.v2';
  const store = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { o = {}; }
    return { get: (k, d) => (o[k] != null ? o[k] : d), set: (k, v) => { o[k] = v; try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* Speicher nicht verfügbar */ } } }; })();

  // ================================================================== CSS
  css(`
.h3-root{position:absolute;inset:0;overflow:hidden;background:var(--bg);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;contain:layout paint}
.h3-cv{position:absolute;inset:0;display:block;width:100%;height:100%;outline:none;touch-action:none;animation:h3fade .9s ease-out both}
@keyframes h3fade{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.h3-cv{animation:none}}
.h3-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 105% at 50% 46%,transparent 58%,rgba(5,9,18,.34) 100%)}
.h3-root.hov .h3-cv{cursor:pointer}
.h3-root.drag .h3-cv{cursor:grabbing}
.h3-glass{background:color-mix(in srgb,var(--panel) 80%,transparent);-webkit-backdrop-filter:blur(16px) saturate(1.25);backdrop-filter:blur(16px) saturate(1.25);border:1px solid color-mix(in srgb,var(--line2) 80%,transparent);border-radius:12px;box-shadow:0 14px 34px rgba(2,6,16,.38),inset 0 1px 0 color-mix(in srgb,white 5%,transparent)}
.h3-ov{position:absolute;z-index:4}
.h3-eb{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap}

/* ---------- Status (oben links) */
.h3-status{left:14px;top:14px;width:288px;padding:11px 12px 12px}
.h3-st-h{display:flex;align-items:center;gap:8px;min-width:0}
.h3-live{display:inline-flex;align-items:center;gap:6px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--st-run);white-space:nowrap;padding:3px 7px 3px 6px;border-radius:999px;background:color-mix(in srgb,var(--st-run) 12%,transparent);border:1px solid color-mix(in srgb,var(--st-run) 30%,transparent)}
.h3-live i{width:6px;height:6px;border-radius:50%;background:var(--st-run);animation:h3pulse 2.2s infinite}
.h3-live.paused{color:var(--muted);background:transparent;border-color:var(--line2)}
.h3-live.paused i{background:var(--muted);animation:none}
@keyframes h3pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--st-run) 60%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
.h3-ttl{font-size:var(--fs-sm);color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.h3-clock{margin-left:auto;font:600 var(--fs-xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;letter-spacing:.02em;white-space:nowrap}
.h3-shift{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:var(--fs-sm);line-height:1.38;color:var(--muted);margin-top:5px;overflow:hidden}
.h3-shift b{font-weight:600;color:var(--text2);margin-right:6px}
.h3-shift.br b{color:var(--st-wait)}
.h3-kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin-top:10px;border:1px solid color-mix(in srgb,var(--line2) 70%,transparent);border-radius:9px;background:color-mix(in srgb,var(--bg) 35%,transparent)}
.h3-kv>div{min-width:0;padding:8px 6px 7px 9px}
.h3-kv>div+div{border-left:1px solid color-mix(in srgb,var(--line2) 60%,transparent)}
.h3-kv .l{display:block;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-kv b{display:block;font:600 var(--fs-2xl)/1 var(--f-cond);font-variant-numeric:tabular-nums;margin-top:5px;white-space:nowrap}
.h3-kv b small{font-size:var(--fs-md);color:var(--muted);font-weight:500;margin-left:1px}
.h3-kv .s{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:var(--fs-xs);line-height:1.3;min-height:2.6em;color:var(--muted);overflow:hidden;margin-top:3px}
.h3-kv .s.w{color:var(--st-wait)}
.h3-kv .s.f{color:var(--st-fault)}
.h3-mapbox{left:14px;bottom:14px;width:288px;padding:9px 10px 10px}
.h3-maph{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 7px}
.h3-maph span:last-child{font-size:var(--fs-xs);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-map{position:relative;border-radius:8px;overflow:hidden;background:color-mix(in srgb,var(--bg) 60%,transparent);border:1px solid color-mix(in srgb,var(--line2) 55%,transparent);cursor:crosshair;touch-action:none}
.h3-map svg{display:block;width:100%;height:auto}
.h3-map .mm{cursor:pointer}
.h3-map .mm rect{transition:fill-opacity .2s}
.h3-map .mm:hover rect{fill-opacity:.85}
.h3-map .mm.fl rect{animation:h3mmf 1.1s steps(2,start) infinite}
@keyframes h3mmf{50%{fill-opacity:.25}}
.h3-map text{font:600 2.7px var(--f-mono);fill:#e5ebf5;pointer-events:none;letter-spacing:0;paint-order:stroke;stroke:rgba(11,17,32,.85);stroke-width:.55px;stroke-linejoin:round}
/* Fokus (Auftragsroute): Status schrumpft auf die Kopfzeile, Hallenplan weicht – die Route bekommt die Fläche */
.h3-root.focus .h3-status{width:auto;max-width:calc(100% - 28px - var(--dw,0px));padding:8px 12px}
.h3-root.focus .h3-status .h3-shift,.h3-root.focus .h3-status .h3-kv,.h3-root.focus .h3-status .h3-sleg,.h3-root.focus .h3-status .h3-mline{display:none}
.h3-root.focus:not(.m) .h3-st-h{gap:10px}
.h3-root.nomap .h3-mapbox{display:none}

/* ---------- Werkzeugleiste oben rechts: Ansicht, Ebenen, Legende */
.h3-tb{right:calc(14px + var(--dw, 0px));top:14px;display:flex;align-items:center;gap:4px;padding:4px;border-radius:11px}
.h3-tsep{width:1px;height:20px;background:color-mix(in srgb,var(--line2) 80%,transparent);margin:0 3px;flex:none}
.h3-ddw{position:relative}
.h3-dd{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 9px 0 9px;border-radius:8px;border:0;background:transparent;color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap}
.h3-dd .ico{color:var(--muted);flex:none}
.h3-dd .ico:last-child{transform:rotate(90deg);transition:transform .18s;color:var(--faint)}
.h3-dd.icn .ico:last-child{transform:none;color:var(--muted)}
.h3-dd:hover,.h3-dd.on{background:color-mix(in srgb,var(--raise) 70%,transparent)}
.h3-dd.on .ico:last-child{transform:rotate(-90deg)}
.h3-dd.icn.on .ico:last-child{transform:none;color:var(--accent)}
.h3-menu,.h3-pop{position:absolute;top:calc(100% + 8px);z-index:8;padding:10px 8px}
.h3-menu{left:-4px;width:248px}
.h3-pop{right:-4px;width:340px;padding:12px 12px 10px}
.h3-menu .h3-eb,.h3-sheet .h3-eb{padding:2px 6px 8px}
.h3-pop .h3-eb{padding:0 0 7px}
.h3-pop .h3-eb~.h3-eb{padding-top:10px;margin-top:9px;border-top:1px solid color-mix(in srgb,var(--line2) 60%,transparent)}
.h3-pre{display:flex;flex-direction:column;gap:1px}
.h3-pre button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:transparent;color:var(--text2);padding:7px 8px;border-radius:7px;font-size:var(--fs-sm);font-weight:500;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-pre button .ico{color:var(--faint);flex:none}
.h3-pre button span{overflow:hidden;text-overflow:ellipsis}
.h3-pre button:hover{background:color-mix(in srgb,var(--raise) 55%,transparent);color:var(--text)}
.h3-pre button.on{background:var(--raise);color:var(--text);box-shadow:inset 2px 0 0 var(--accent)}
.h3-pre button.on .ico{color:var(--accent)}
.h3-lay{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 4px 2px}
.h3-chip{--c:var(--accent);display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px 0 9px;border-radius:8px;font-size:var(--fs-sm);font-weight:600;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap;min-width:0;overflow:hidden}
.h3-chip i{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--c);flex:none;box-sizing:border-box}
.h3-chip:hover{color:var(--text);background:color-mix(in srgb,var(--raise) 45%,transparent)}
.h3-chip.on{color:var(--text);border-color:color-mix(in srgb,var(--c) 42%,transparent);background:color-mix(in srgb,var(--c) 11%,transparent)}
.h3-chip.on i{background:var(--c);box-shadow:0 0 6px var(--c)}
.h3-chip .ls{display:none}
/* Schmal (Tablet, offener Drawer): Ebenen behalten Kurznamen, die Kameraansicht zeigt nur ihr Symbol */
.h3-root.narrow .h3-tb .h3-chip .lf,.h3-root.narrow .h3-tb .h3-dd span{display:none}
.h3-root.narrow .h3-tb .h3-chip .ls{display:inline}
.h3-root.narrow .h3-tb .h3-chip{padding:0 9px 0 8px}
.h3-root.narrow .h3-tb .h3-dd{padding:0 8px}
@media (pointer:coarse){
  .h3-chip,.h3-dd{height:40px;min-width:40px}
  .h3-pre button,.h3-mbar button,.h3-steps button{min-height:40px}
  .h3-mbar button{min-width:40px;justify-content:center}
  .h3-sel .btn{min-height:40px}
  .h3-sel .btn.ic{min-width:40px}
}

/* ---------- Legende */
.h3-leg{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;font-size:var(--fs-xs);color:var(--text2)}
.h3-lg{display:inline-flex;align-items:center;gap:7px;line-height:17px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.h3-lg i{width:9px;height:9px;border-radius:3px;background:var(--c);flex:none}
.h3-lg i.ln{width:16px;height:3px;border-radius:2px;box-shadow:0 0 6px var(--c)}
.h3-lg i.pt{width:7px;height:7px;border-radius:50%;margin:0 1px;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent),0 0 8px var(--c)}
.h3-lg i.rg{width:10px;height:10px;border-radius:50%;background:transparent;border:2px solid var(--c)}
.h3-lg i.arc{width:16px;height:8px;border-radius:9px 9px 0 0;background:transparent;border:2.5px solid var(--c);border-bottom:0}
.h3-lg i.dsh{width:16px;height:0;border-radius:0;background:transparent;border-top:2.5px dashed var(--c)}
.h3-lg i.stp{width:11px;height:11px;border-radius:50%;background:linear-gradient(var(--bg) 0 0) center/6px 2px no-repeat,var(--c)}
.h3-lg i.vest{width:8px;height:11px;border-radius:3px 3px 2px 2px}
.h3-sleg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 8px;margin-top:10px;font-size:var(--fs-xs);color:var(--muted)}
.h3-sleg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.h3-sleg i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 5px color-mix(in srgb,var(--c) 70%,transparent)}
.h3-sheet{left:8px;right:8px;bottom:62px;padding:12px 10px;max-height:calc(100% - 150px);overflow:auto}
.h3-sheet .h3-leg{padding:0 4px}
.h3-sheet .h3-eb~.h3-eb{padding-top:10px}
.h3-sheet .h3-pre{display:grid;grid-template-columns:1fr 1fr}
/* Arbeitsplan im Blatt (Telefon: „Schritte“) */
.h3-steps{display:flex;flex-direction:column;gap:2px}
.h3-steps button{--rc:var(--st-idle);display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;color:var(--text2);padding:6px 6px;border-radius:8px;font-size:var(--fs-sm);cursor:pointer}
.h3-steps button:hover{background:color-mix(in srgb,var(--raise) 55%,transparent)}
.h3-steps .n{display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:11px;background:var(--rc);color:var(--bg);font:700 var(--fs-xs)/1 var(--f-ui);padding:0 5px}
.h3-steps b{display:block;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-steps small{display:block;color:var(--muted);font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-steps .q{font:500 var(--fs-xs)/1 var(--f-mono);color:var(--text2);text-align:right}
.h3-steps .k{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--st-wait);margin-left:6px}

/* ---------- Auswahl-Leiste, Hinweis */
.h3-sel{left:calc((100% - var(--dw, 0px)) / 2);bottom:14px;transform:translateX(-50%);padding:6px 6px 6px 12px;display:flex;align-items:center;gap:10px;font-size:var(--fs-sm);max-width:calc(100% - 28px - var(--dw, 0px))}
.h3-sel .k{color:var(--muted);white-space:nowrap;font-size:var(--fs-2xs);text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.h3-sel .nm{font-weight:600;white-space:nowrap;flex:none}
.h3-sel .ac{color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:300px}
.h3-sel .btn.on{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.h3-sel .btn.ic{padding:0 7px}
.h3-root:not(.nomap) .h3-sel{left:calc((100% - var(--dw, 0px)) / 2 + 151px);max-width:calc(100% - 330px - var(--dw, 0px))}
.h3-hint{left:calc((100% - var(--dw, 0px)) / 2);bottom:14px;transform:translateX(-50%);font-size:var(--fs-xs);line-height:1.45;color:var(--muted);padding:7px 11px;border-radius:9px;background:color-mix(in srgb,var(--panel) 78%,transparent);border:1px solid color-mix(in srgb,var(--line2) 55%,transparent);transition:opacity .6s;pointer-events:none;white-space:nowrap;max-width:calc(100% - 28px - var(--dw, 0px));overflow:hidden;text-overflow:ellipsis;text-align:center}
.h3-hint.gone{opacity:0}
.h3-root:not(.nomap) .h3-hint{left:calc((100% - var(--dw, 0px)) / 2 + 151px);max-width:calc(100% - 330px - var(--dw, 0px))}
.h3-root.selon .h3-hint{opacity:0}
.h3-hint b{color:var(--text2);font-weight:600}

/* ---------- Etiketten */
.h3-labels{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden;contain:strict}
.h3-lead{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.h3-lead line{stroke-width:1.75px;stroke-linecap:round}
.h3-lead circle{stroke:rgba(11,17,32,.85);stroke-width:1.5px}
.h3-lb{--c:var(--st-idle);position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;white-space:nowrap;background:color-mix(in srgb,var(--bg) 84%,transparent);border:1px solid color-mix(in srgb,var(--c) 45%,var(--line2));border-radius:8px;padding:3px 8px 3px 6px;font:500 var(--fs-sm)/1.25 var(--f-ui);color:var(--text);box-shadow:0 4px 14px rgba(0,0,0,.42);transition:opacity .18s;will-change:transform}
.h3-lb::after{content:"";position:absolute;left:50%;top:100%;width:1px;height:9px;background:linear-gradient(color-mix(in srgb,var(--c) 85%,transparent),transparent)}
.h3-lb[data-pl="b"]::after{top:auto;bottom:100%;background:linear-gradient(transparent,color-mix(in srgb,var(--c) 85%,transparent))}
.h3-lb[data-pl="s"]::after{display:none}
.h3-lb.off{opacity:0 !important;pointer-events:none !important}
.h3-lb .r1{display:flex;align-items:center;gap:6px}
.h3-lb .d{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 6px var(--c)}
.h3-lb b{font:600 var(--fs-md)/1 var(--f-cond);letter-spacing:.03em}
.h3-lb .nm{color:var(--text2)}
.h3-lb .sp{display:inline-flex;align-items:center;padding:1px 6px;border-radius:999px;font-size:var(--fs-xs);font-weight:600;line-height:16px;color:color-mix(in srgb,var(--c) 80%,white);background:color-mix(in srgb,var(--c) 17%,transparent)}
.h3-lb .ct{font:500 var(--fs-xs)/1 var(--f-mono);color:var(--text2)}
.h3-lb .wz{display:inline-flex;color:var(--st-tool)}
.h3-lb .r2{display:flex;gap:6px;align-items:center;margin-top:5px;font-size:var(--fs-xs);color:var(--text2);max-width:270px;overflow:hidden}
.h3-lb .r2 .st{color:color-mix(in srgb,var(--c) 80%,white);font-weight:600;flex:none}
.h3-lb .r2 span:last-child{overflow:hidden;text-overflow:ellipsis}
.h3-lb .r3{margin-top:5px;font-size:var(--fs-xs);color:var(--text2);display:flex;align-items:center;gap:7px}
.h3-lb .r3 .bar{flex:1;min-width:70px}
.h3-lb .r3 .mono{color:var(--muted)}
.h3-lb .r4{margin-top:4px;font-size:var(--fs-xs);color:var(--muted);max-width:270px;overflow:hidden;text-overflow:ellipsis}
.h3-lb .r4 .t{color:var(--st-tool)}
.h3-lb[data-l="0"]{padding:2px 7px 2px 5px;border-radius:7px}
.h3-lb[data-l="0"] b{font-size:var(--fs-sm)}
.h3-lb[data-l="0"] .nm,.h3-lb[data-l="0"] .sp,.h3-lb[data-l="0"] .ct,.h3-lb[data-l="0"] .wz,.h3-lb[data-l="0"] .r2,.h3-lb[data-l="0"] .r3,.h3-lb[data-l="0"] .r4,.h3-lb[data-l="1"] .r2,.h3-lb[data-l="1"] .r3,.h3-lb[data-l="1"] .r4{display:none}
.h3-lb[data-l="2"] .sp,.h3-lb.run[data-l="1"] .sp{display:none}
.h3-lb[data-l="2"]{padding:6px 9px 7px 8px;border-radius:9px}
.h3-lb.flt .d{animation:h3dot 1s steps(2,start) infinite}
.h3-lb.flt{border-color:color-mix(in srgb,var(--st-fault) 75%,transparent)}
@keyframes h3dot{50%{opacity:.25}}
.h3-lb.done .ct{color:var(--st-run);transition:none}
.h3-lb .ct{transition:color 1.2s}
.h3-lb.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 6px 18px rgba(0,0,0,.45)}
.h3-lb.hv{border-color:color-mix(in srgb,var(--c) 80%,white)}
.h3-lb.dim{opacity:.32}
/* Auftragsroute: Nummer, Arbeitsgang, Station; Führungslinie zur Maschine */
.h3-lb.rt{--c:var(--text);background:color-mix(in srgb,var(--bg) 90%,transparent);border-color:color-mix(in srgb,var(--rc) 60%,transparent);padding:4px 10px 5px 4px;cursor:default}
.h3-lb.rt::after,.h3-lb.wt::after{display:none}
.h3-lb.rt .r1{gap:7px}
.h3-lb.rt .n{display:inline-grid;place-items:center;min-width:21px;height:21px;border-radius:11px;background:var(--rc);color:var(--bg);font:700 var(--fs-xs)/1 var(--f-ui);padding:0 5px;flex:none}
.h3-lb.rt .o{font-size:var(--fs-sm);color:var(--text);font-weight:600}
.h3-lb.rt .s{font-size:var(--fs-xs);color:var(--text2);margin:2px 0 0 28px}
.h3-lb.rt .k{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--st-wait);border:1px solid color-mix(in srgb,var(--st-wait) 50%,transparent);border-radius:999px;padding:3px 6px 2px;margin-left:1px}
.h3-lb.rt.lim{border-color:color-mix(in srgb,var(--st-wait) 85%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--st-wait) 45%,transparent),0 4px 14px rgba(0,0,0,.42)}
.h3-lb.rt.cur{border-color:var(--rc)}
.h3-lb.rt .cc{display:none;font:600 var(--fs-md)/1 var(--f-cond);letter-spacing:.03em}
.h3-lb.rt.c{padding:3px 9px 3px 3px}
.h3-lb.rt.c .o,.h3-lb.rt.c .s,.h3-lb.rt.c .k{display:none}
.h3-lb.rt.c .cc{display:inline}
/* Wartende Transporte: Grund aus der Engine (Ziel voll, kein Fahrzeug frei …) */
.h3-lb.wt{--c:var(--mat);background:color-mix(in srgb,var(--bg) 90%,transparent);border-color:color-mix(in srgb,var(--mat) 55%,transparent);cursor:default;padding:4px 10px 5px 7px}
.h3-lb.wt .r1{gap:7px}
.h3-lb.wt .stp{width:13px;height:13px;border-radius:50%;flex:none;background:linear-gradient(var(--bg) 0 0) center/7px 2px no-repeat,var(--mat)}
.h3-lb.wt .o{font-weight:600;color:var(--text)}
.h3-lb.wt .s{font-size:var(--fs-xs);color:var(--text2);margin:2px 0 0 20px}
.h3-lb.wt.c .s{display:none}
.h3-lb.wt.c{padding:3px 9px 3px 6px}

/* ---------- Tooltip */
.h3-tip{position:absolute;z-index:6;left:0;top:0;width:340px;max-width:calc(100% - 20px);pointer-events:none;padding:12px 14px 12px;font-size:var(--fs-sm);opacity:0;transition:opacity .12s}
.h3-tip.on{opacity:1}
.h3-tip .h{display:flex;align-items:flex-start;gap:10px}
.h3-tip .t{font:600 var(--fs-xl)/1.1 var(--f-cond);min-width:0;letter-spacing:.01em}
.h3-tip .t small{display:block;font:500 var(--fs-xs)/1.3 var(--f-ui);color:var(--muted);margin-top:3px;letter-spacing:0}
.h3-tip .h .pill{margin-left:auto;flex:none}
.h3-tip .cz{margin-top:9px;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--c,var(--st-idle)) 10%,var(--bg2));border:1px solid color-mix(in srgb,var(--c,var(--st-idle)) 30%,transparent);color:var(--text2);font-size:var(--fs-sm);line-height:1.4}
.h3-tip .cz .muted{white-space:nowrap}
.h3-tip .dl{margin-top:10px;font-size:var(--fs-sm);gap:5px 12px}
.h3-tip .dl dt{white-space:nowrap}
.h3-tip .dl dd{color:var(--text)}
.h3-tip .pg{display:flex;align-items:center;gap:8px}
.h3-tip .pg .bar{flex:1}
.h3-tip .ft{margin-top:10px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--line2) 60%,transparent);font-size:var(--fs-xs);color:var(--faint);display:flex;justify-content:space-between;gap:10px}
.h3-tip .tw{color:var(--st-tool);display:block;margin-top:4px;font-size:var(--fs-xs)}
.h3-tip .tl{display:flex;flex-direction:column;gap:3px}
.h3-tip .ti{display:grid;grid-template-columns:minmax(0,1fr) 50px 56px;align-items:center;gap:7px;font-size:var(--fs-xs)}
.h3-tip .ti .tn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.h3-tip .ti .tr{text-align:right;font-family:var(--f-mono);font-size:var(--fs-2xs);color:var(--text2)}
.h3-tip .ok{color:var(--st-run)}
.h3-tip .wn{color:var(--st-wait)}

/* ---------- Kompakt (Telefon oder wenig Platz neben dem Drawer): Statuszeile oben, Leiste unten */
.h3-mline{display:none}
.h3-mbar{display:none;left:calc((100% - var(--dw, 0px)) / 2);bottom:10px;transform:translateX(-50%);padding:4px;gap:2px}
.h3-mbar button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--text2);padding:8px 11px;border-radius:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap}
.h3-mbar button.on{background:var(--raise);color:var(--text)}
.h3-fb{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 40%,var(--card) 0%,var(--bg) 70%)}
.h3-fb .card{max-width:460px;text-align:left}
.h3-fb .ic{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);color:var(--accent)}
.h3-fb h3{margin:14px 0 6px;font:600 var(--fs-xl)/1.1 var(--f-cond)}
.h3-fb p{margin:0 0 16px;color:var(--text2);font-size:var(--fs-md);line-height:1.5}
.h3-root.m .h3-status{left:8px;right:calc(8px + var(--dw, 0px));top:8px;width:auto;max-width:none;padding:8px 11px}
.h3-root.m .h3-kv,.h3-root.m .h3-shift,.h3-root.m .h3-ttl,.h3-root.m .h3-sleg{display:none}
.h3-root.m .h3-mline{display:flex;gap:12px;margin-top:6px;font-size:var(--fs-xs);color:var(--text2);white-space:nowrap;overflow:hidden}
.h3-root.m .h3-mline b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
.h3-root.m .h3-mline .w{color:var(--st-wait)}
.h3-root.m .h3-mline .f{color:var(--st-fault)}
.h3-root.m .h3-tb{display:none}
.h3-root.m .h3-lay{grid-template-columns:1fr 1fr}
.h3-root.m .h3-mbar{display:flex}
.h3-root.m .h3-sel{bottom:62px;left:calc((100% - var(--dw, 0px)) / 2);max-width:calc(100% - 16px - var(--dw, 0px))}
.h3-root.m .h3-sheet{right:calc(8px + var(--dw, 0px))}
.h3-root.m .h3-hint{bottom:62px;white-space:normal;width:max-content;max-width:min(360px,calc(100% - 24px - var(--dw, 0px)))}
.h3-root.m .h3-tip{display:none}
.h3-root.m.sheet .h3-sel{display:none}
.h3-root.xs .h3-mbar button span,.h3-root.xs .h3-sel .k{display:none}
.h3-root.xs .h3-mbar button{padding:8px 10px}
`, 'h3-css');

  // ================================================================== Laufzeitzustand
  const R = {
    root: null, ok: false, failed: false, visible: false, mobile: false, short: false,
    renderer: null, scene: null, camera: null, controls: null, canvas: null,
    w: 1, h: 1, dpr: 1, dprMax: 1, aniso: 4, quality: 'high',
    time: 0, renderT: 0, lastT: -1, sT0: 0, sT1: 0,
    layers: Object.assign({ flow: true, data: true, people: true, labels: true }, store.get('layers', {})),
    mo: {}, moList: [], people: {}, agvs: {}, fork: null,
    tween: null, follow: null, preset: 'uebersicht',
    sel: null, selTarget: null, hover: null, hoverDirty: false, mouse: { x: 0, y: 0, in: false }, down: null,
    pick: [], pickActive: null, ui: {}, uiRects: [], lb: {}, rtLb: {}, wtLb: {},
    shadowAcc: 0, shadowDirty: true, perfAcc: 0, perfN: 0, perfHigh: 0,
    pending: null, lastCounter: {}, seenNotif: new Set(), walls: [], fade: [],
    // Layout: compact = Statuszeile + Leiste unten (Telefon oder ≤ 640 px frei neben dem Drawer)
    compact: false, drawerW: 0,
    // Kamera-Einpassung: {kind:'preset'|'order'|'station', id, pts, phi, th, rMin, rMax, sig} – gilt bis zur ersten Nutzer-Bewegung
    fit: null, fitPend: '',
    tipSup: null, lbCap: 1, lbBad: 0, lbDry: 0, waitLines: new Map(), flowFlash: 0, lastTap: null, lastDblT: 0,
  };
  let M = null;          // Materialien (nach THREE-Prüfung)
  let V1, V2, V3, V4, Q1, M4, E1, S1, COL, RAY, NDC, PLANE;  // wiederverwendete Objekte (keine Allokation im Bild-Takt)

  // ================================================================== Geometrie-Helfer
  const GC = new Map();
  const cache = (k, f) => { let g = GC.get(k); if (!g) { g = f(); GC.set(k, g); } return g; };
  const gBox = () => cache('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const gBoxC = () => cache('boxc', () => new THREE.BoxGeometry(1, 1, 1));
  const gCyl = (seg = 20) => cache('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0));
  const gCylC = (seg = 20) => cache('cylc' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg));
  const gSph = (seg = 16) => cache('sph' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1)));
  const gPlaneY = () => cache('plY', () => new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2));

  /** Normalen glätten bis zu einem Knickwinkel (für gerundete Kanten aus Extrusionen), Geometrie nicht indiziert */
  function creaseNormals(g, angle) {
    if (g.index) g = g.toNonIndexed();
    const pos = g.attributes.position, n = pos.count, cosT = Math.cos(angle);
    const fn = new Float32Array(n * 3), out = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cb = new THREE.Vector3(), ab = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
      const l = cb.length(); if (l > 1e-12) cb.multiplyScalar(1 / l);
      for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = cb.x; fn[(i + k) * 3 + 1] = cb.y; fn[(i + k) * 3 + 2] = cb.z; }
    }
    const map = new Map(), q = (v) => Math.round(v * 1e4);
    for (let i = 0; i < n; i++) {
      const k = q(pos.getX(i)) + ',' + q(pos.getY(i)) + ',' + q(pos.getZ(i));
      let l = map.get(k); if (!l) map.set(k, l = []); l.push(i);
    }
    for (const l of map.values()) {
      for (const i of l) {
        let x = 0, y = 0, z = 0;
        const nx = fn[i * 3], ny = fn[i * 3 + 1], nz = fn[i * 3 + 2];
        for (const j of l) { const mx = fn[j * 3], my = fn[j * 3 + 1], mz = fn[j * 3 + 2]; if (nx * mx + ny * my + nz * mz >= cosT) { x += mx; y += my; z += mz; } }
        const len = Math.hypot(x, y, z) || 1;
        out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len;
      }
    }
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
    return g;
  }
  function rrShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2; r = Math.max(0.001, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /** Polygon mit individuell gerundeten Ecken: pts [[u,v,r?],…] → Shape */
  function roundPoly(pts) {
    const s = new THREE.Shape(), n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], pr = pts[(i - 1 + n) % n], nx = pts[(i + 1) % n], r = p[2] || 0;
      if (!r) { if (i === 0) s.moveTo(p[0], p[1]); else s.lineTo(p[0], p[1]); continue; }
      const d1 = Math.hypot(pr[0] - p[0], pr[1] - p[1]), d2 = Math.hypot(nx[0] - p[0], nx[1] - p[1]);
      const rr = Math.min(r, d1 * 0.45, d2 * 0.45);
      const ax = p[0] + (pr[0] - p[0]) / d1 * rr, ay = p[1] + (pr[1] - p[1]) / d1 * rr;
      const bx = p[0] + (nx[0] - p[0]) / d2 * rr, by = p[1] + (nx[1] - p[1]) / d2 * rr;
      if (i === 0) s.moveTo(ax, ay); else s.lineTo(ax, ay);
      s.quadraticCurveTo(p[0], p[1], bx, by);
    }
    s.closePath();
    return s;
  }
  /** Quader mit gerundeten senkrechten Kanten (+ Fase oben/unten); Boden bei y = 0, Normalen geglättet. */
  function gRBox(w, h, d, r, bev) {
    const k = ['rb', w.toFixed(3), h.toFixed(3), d.toFixed(3), r.toFixed(3), (bev || 0).toFixed(3)].join('|');
    return cache(k, () => {
      const b = Math.min(bev || 0, h / 3, w / 4, d / 4);
      let g = new THREE.ExtrudeGeometry(rrShape(w - 2 * b, d - 2 * b, Math.max(0.002, r - b)), {
        depth: Math.max(0.001, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
      g.rotateX(-PI / 2); g.translate(0, b, 0);
      g = creaseNormals(g, 50 * DEG);
      return g;
    });
  }
  /** Seitenprofil (u = lokale z nach vorne, v = y) über die Breite w (lokale x) extrudiert, Kanten gefast. */
  function gSide(key, pts, w, bev) {
    return cache('sd|' + key + '|' + w.toFixed(3) + '|' + (bev || 0), () => {
      const b = bev || 0;
      let g = new THREE.ExtrudeGeometry(roundPoly(pts), { depth: Math.max(0.001, w - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 2, curveSegments: 5 });
      g.rotateY(-PI / 2); g.translate(w / 2 - b, 0, 0);
      g = creaseNormals(g, 48 * DEG);
      return g;
    });
  }
  /** Draufsicht-Profil (u = x, v = −z) nach oben extrudiert (Höhe h), Boden bei y = 0 */
  function gPlan(key, pts, h, bev) {
    return cache('pl|' + key + '|' + h.toFixed(3) + '|' + (bev || 0), () => {
      const b = bev || 0;
      let g = new THREE.ExtrudeGeometry(roundPoly(pts), { depth: Math.max(0.001, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 2, curveSegments: 5 });
      g.rotateX(-PI / 2); g.translate(0, b, 0);
      g = creaseNormals(g, 48 * DEG);
      return g;
    });
  }
  /** Drehteil aus Profil [[r, y], …] um die y-Achse */
  function gLathe(key, prof, seg) {
    return cache('la|' + key + '|' + (seg || 28), () => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg || 28));
  }
  function gIBeam(hgt, w, fl, web) {
    return cache('ib' + hgt + '|' + w + '|' + fl, () => {
      const s = new THREE.Shape(), a = w / 2, h = w / 2;
      s.moveTo(-a, -h); s.lineTo(a, -h); s.lineTo(a, -h + fl); s.lineTo(web / 2, -h + fl); s.lineTo(web / 2, h - fl); s.lineTo(a, h - fl);
      s.lineTo(a, h); s.lineTo(-a, h); s.lineTo(-a, h - fl); s.lineTo(-web / 2, h - fl); s.lineTo(-web / 2, -h + fl); s.lineTo(-a, -h + fl); s.lineTo(-a, -h);
      const g = new THREE.ExtrudeGeometry(s, { depth: hgt, bevelEnabled: false });
      g.rotateX(-PI / 2);
      return g;
    });
  }
  /** Offene Kiste (ohne Deckel) – Behälter. */
  function gOpenBox(w, h, d) {
    return cache('ob' + w + '|' + h + '|' + d, () => {
      const g = new THREE.BoxGeometry(w, h, d);
      const idx = g.index.array, keep = [];
      for (let i = 0; i < idx.length; i += 3) {
        const ys = [idx[i], idx[i + 1], idx[i + 2]].map(v => g.attributes.position.getY(v));
        if (ys.every(y => y > h / 2 - 1e-6)) continue;
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep); g.clearGroups(); g.translate(0, h / 2, 0);
      return g;
    });
  }
  const _e = { x: 0, y: 0, z: 0 };
  function xf(x, y, z, rx, ry, rz, sx, sy, sz) {
    const e = new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ');
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e),
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }
  void _e;
  // allokationsfreie Instanz-Matrix (nur Drehung um Y) fuer Updates pro Frame
  let _IM = null;
  function ixf(mesh, i, x, y, z, ry, sx, sy, sz) {
    const m = _IM || (_IM = new THREE.Matrix4()), c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    sx = sx == null ? 1 : sx; sy = sy == null ? 1 : sy; sz = sz == null ? 1 : sz;
    m.set(c * sx, 0, s * sz, x, 0, sy, 0, y, -s * sx, 0, c * sz, z, 0, 0, 0, 1);
    mesh.setMatrixAt(i, m);
  }
  function mergeGeos(list) {
    let n = 0; const parts = [];
    for (const [g, mx] of list) {
      const gg = g.index ? g.toNonIndexed() : g.clone();
      gg.applyMatrix4(mx);
      // negative Skalierung dreht die Dreiecke um → Windung korrigieren
      if (mx.determinant() < 0) { const p = gg.attributes.position.array, nn = gg.attributes.normal && gg.attributes.normal.array, uv = gg.attributes.uv && gg.attributes.uv.array;
        for (let i = 0; i < gg.attributes.position.count; i += 3) { for (const [arr, s] of [[p, 3], [nn, 3], [uv, 2]]) { if (!arr) continue; for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; } } } }
      parts.push(gg); n += gg.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const gg of parts) {
      const c = gg.attributes.position.count;
      pos.set(gg.attributes.position.array, o * 3);
      if (gg.attributes.normal) nor.set(gg.attributes.normal.array, o * 3);
      if (gg.attributes.uv) uv.set(gg.attributes.uv.array.subarray(0, c * 2), o * 2);
      o += c; gg.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  /** Sammelt statische Teile je Material und verschmilzt sie (wenige Draw-Calls). Lokale Koordinaten, ry um die y-Achse. */
  class Builder {
    constructor() { this.map = new Map(); }
    add(geo, mat, mx) { let l = this.map.get(mat); if (!l) this.map.set(mat, l = []); l.push([geo, mx]); return this; }
    box(mat, w, h, d, x, y, z, ry, rx, rz) { return this.add(gBox(), mat, xf(x, y, z, rx, ry, rz, w, h, d)); }
    boxC(mat, w, h, d, x, y, z, ry, rx, rz) { return this.add(gBoxC(), mat, xf(x, y, z, rx, ry, rz, w, h, d)); }
    rbox(mat, w, h, d, r, x, y, z, ry, bev) { return this.add(gRBox(w, h, d, r, bev), mat, xf(x, y, z, 0, ry || 0, 0)); }
    cyl(mat, r, h, x, y, z, seg) { return this.add(gCyl(seg), mat, xf(x, y, z, 0, 0, 0, r, h, r)); }
    cylX(mat, r, len, x0, y, z, seg) { return this.add(gCyl(seg), mat, xf(x0, y, z, 0, 0, -PI / 2, r, len, r)); }
    cylZ(mat, r, len, x, y, z0, seg) { return this.add(gCyl(seg), mat, xf(x, y, z0, PI / 2, 0, 0, r, len, r)); }
    sph(mat, r, x, y, z, seg) { return this.add(gSph(seg), mat, xf(x, y, z, 0, 0, 0, r, r, r)); }
    /** Drehteil um die x-Achse (z. B. Futter, Spindel): Profil [[r, Abstand], …] beginnend bei x0 */
    latheX(mat, key, prof, x0, y, z, seg, dir) { return this.add(gLathe(key, prof, seg), mat, xf(x0, y, z, 0, 0, (dir || 1) > 0 ? -PI / 2 : PI / 2)); }
    latheY(mat, key, prof, x, y0, z, seg) { return this.add(gLathe(key, prof, seg), mat, xf(x, y0, z)); }
    latheZ(mat, key, prof, x, y, z0, seg) { return this.add(gLathe(key, prof, seg), mat, xf(x, y, z0, PI / 2, 0, 0)); }
    side(mat, key, pts, w, x, y, z, ry, bev) { return this.add(gSide(key, pts, w, bev), mat, xf(x, y, z, 0, ry || 0, 0)); }
    plan(mat, key, pts, h, x, y, z, ry, bev) { return this.add(gPlan(key, pts, h, bev), mat, xf(x, y, z, 0, ry || 0, 0)); }
    /** Rohr/Schlauch entlang Punkten [[x,y,z],…] */
    tube(mat, pts, r, seg) {
      const v = pts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const curve = v.length > 2 ? new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.08) : new THREE.LineCurve3(v[0], v[1]);
      return this.add(new THREE.TubeGeometry(curve, Math.max(4, (v.length - 1) * 8), r, seg || 8, false), mat, new THREE.Matrix4());
    }
    /** batchMat: gemeinsames Material für alle einfachen Lacke/Metalle (Farbe, Rauheit, Metallgrad je Ecke) → wenige Draw-Calls */
    build(parent, shadow = true, batchMat) {
      const out = [], bl = [];
      for (const [mat, list] of this.map) {
        if (mat.userData.batch) { for (const it of list) bl.push([it[0], it[1], mat]); continue; }
        const mesh = new THREE.Mesh(mergeGeos(list), mat);
        const tr = mat.transparent || mat.isMeshBasicMaterial || mat.userData.noShadow;
        mesh.castShadow = shadow && !tr; mesh.receiveShadow = !mat.isMeshBasicMaterial;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        if (mat.transparent) mesh.renderOrder = 1;
        parent.add(mesh); out.push(mesh);
      }
      if (bl.length) {
        const geo = mergeGeos(bl.map(x => [x[0], x[1]]));
        const n = geo.attributes.position.count, col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
        let o = 0;
        for (const [g, , mat] of bl) {
          const c = g.index ? g.index.count : g.attributes.position.count, cr = mat.color.r, cg = mat.color.g, cb = mat.color.b, r = mat.roughness, m = mat.metalness;
          for (let i = 0; i < c; i++) { const j = o + i; col[j * 3] = cr; col[j * 3 + 1] = cg; col[j * 3 + 2] = cb; pbr[j * 2] = r; pbr[j * 2 + 1] = m; }
          o += c;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
        const mesh = new THREE.Mesh(geo, batchMat || M.batch);
        mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        parent.add(mesh); out.push(mesh);
      }
      this.map.clear();
      return out;
    }
  }
  function mesh(geo, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = !mat.transparent && !mat.isMeshBasicMaterial; m.receiveShadow = !mat.isMeshBasicMaterial;
    return m;
  }
  function grp(x, y, z) { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; }
  /** lokale Rotation um y: (lx, lz) → Welt-Offset */
  const rotXZ = (lx, lz, ry) => [lx * Math.cos(ry) + lz * Math.sin(ry), -lx * Math.sin(ry) + lz * Math.cos(ry)];
  /** sRGB-Hex → Color mit Rohwerten (für eigene Shader ohne Farbraumumrechnung) */
  function srgb(hex, out) {
    const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
    return (out || new THREE.Color()).setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  /** Durchmesser / Länge aus dem Teilenamen („Achswelle Ø110×1850“) bzw. Material („Ø65“, „Flach 45×25“) */
  function dimsOf(text) {
    const s = String(text || '');
    let m = s.match(/Ø\s*(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+)/);
    if (m) return { d: parseFloat(m[1].replace(',', '.')) / 1000, l: parseFloat(m[2]) / 1000 };
    m = s.match(/Ø\s*(\d+(?:[.,]\d+)?)/);
    if (m) return { d: parseFloat(m[1].replace(',', '.')) / 1000, l: null };
    m = s.match(/Flach\s*(\d+)\s*[×x]\s*(\d+)/);
    if (m) return { flat: true, d: parseFloat(m[1]) / 1000, d2: parseFloat(m[2]) / 1000, l: null };
    m = s.match(/(\d+)\s*[×x]\s*(\d+)\s*[×x]\s*(\d+)/);
    if (m) return { block: true, d: parseFloat(m[1]) / 1000, d2: parseFloat(m[2]) / 1000, l: parseFloat(m[3]) / 1000 };
    return null;
  }

  // ================================================================== Texturen (Canvas, prozedural)
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, o = {}) {
    const t = new THREE.CanvasTexture(c);
    if (o.srgb !== false) t.encoding = THREE.sRGBEncoding;
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    t.anisotropy = o.aniso || R.aniso;
    return t;
  }
  const FONT = (w, px) => `${w} ${px}px "Barlow Condensed", "Barlow", "Arial Narrow", Arial, sans-serif`;
  const FONTUI = (w, px) => `${w} ${px}px "Barlow", "Segoe UI", Arial, sans-serif`;
  const FONTMONO = (w, px) => `${w} ${px}px "JetBrains Mono", Menlo, Consolas, monospace`;
  function spacedText(g, text, x, y, sp) {
    const chars = [...text]; let tw = 0; const ws = chars.map(ch => { const w = g.measureText(ch).width; tw += w; return w; });
    tw += sp * (chars.length - 1);
    let cx = x - tw / 2;
    const al = g.textAlign; g.textAlign = 'center';
    chars.forEach((ch, i) => { g.fillText(ch, cx + ws[i] / 2, y); cx += ws[i] + sp; });
    g.textAlign = al;
    return tw;
  }
  /** kachelbares Wertrauschen (glatt interpoliert), Oktaven summiert → Float32Array N×N in [0,1] */
  function noiseField(N, cells, oct, seed) {
    const out = new Float32Array(N * N), rnd = U.rng(seed);
    let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const C = cells << o, grid = new Float32Array(C * C);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd.next();
      for (let y = 0; y < N; y++) {
        const gy = y / N * C, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy), y1 = (y0 + 1) % C;
        for (let x = 0; x < N; x++) {
          const gx = x / N * C, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx), x1 = (x0 + 1) % C;
          const a = grid[y0 * C + x0], b = grid[y0 * C + x1], c = grid[y1 * C + x0], d = grid[y1 * C + x1];
          out[y * N + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
        }
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  /** Polierter Industrieestrich: ruhige Wolkung, feine Körnung, Kachel = 1 Fugenfeld */
  function texConcrete() {
    const N = 1024, c = cnv(N, N), g = c.getContext('2d');
    const nLo = noiseField(N, 4, 4, 7), nHi = noiseField(N, 64, 2, 13), rnd = U.rng(29);
    const img = g.createImageData(N, N), d = img.data;
    for (let i = 0; i < N * N; i++) {
      const lo = (nLo[i] - 0.5), hi = (nHi[i] - 0.5);
      let v = 150 + lo * 34 + hi * 9 + (rnd.next() - 0.5) * 7;
      if (rnd.next() < 0.004) v += rnd.chance(0.5) ? 22 : -26;   // Zuschlagskorn
      d[i * 4] = v * 0.985; d[i * 4 + 1] = v * 0.995; d[i * 4 + 2] = v * 1.02; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // vereinzelte feine Haarrisse / Polierspuren
    g.strokeStyle = 'rgba(70,74,80,.10)'; g.lineWidth = 1;
    for (let k = 0; k < 6; k++) { g.beginPath(); let x = rnd.range(0, N), y = rnd.range(0, N); g.moveTo(x, y); for (let s = 0; s < 14; s++) { x += rnd.range(-22, 22); y += rnd.range(-22, 22); g.lineTo(x, y); } g.stroke(); }
    return tex(c, { repeat: [10, 6] });
  }
  /** Rauigkeit: polierte Bereiche glänzen leicht (Grünkanal = Roughness in three.js) */
  function texConcreteRough() {
    const N = 256, c = cnv(N, N), g = c.getContext('2d'), n = noiseField(N, 6, 3, 31);
    const img = g.createImageData(N, N), d = img.data;
    for (let i = 0; i < N * N; i++) { const v = 150 + (n[i] - 0.5) * 120; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp(v, 60, 230); d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return tex(c, { repeat: [10, 6], srgb: false });
  }
  function texGround() {
    const N = 1024, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, N * 0.06, N / 2, N / 2, N * 0.5);
    gr.addColorStop(0, '#1d2638'); gr.addColorStop(0.55, '#141c2c'); gr.addColorStop(1, '#0b1120');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    // dezentes Raster (Gelände), zum Rand hin ausgeblendet
    for (let i = 0; i <= 64; i++) {
      const p = i / 64 * N;
      for (const [x0, y0, x1, y1] of [[p, 0, p, N], [0, p, N, p]]) {
        g.strokeStyle = `rgba(120,150,200,${i % 8 === 0 ? 0.10 : 0.045})`; g.lineWidth = i % 8 === 0 ? 1.4 : 1;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    const fade = g.createRadialGradient(N / 2, N / 2, N * 0.12, N / 2, N / 2, N * 0.5);
    fade.addColorStop(0, 'rgba(11,17,32,0)'); fade.addColorStop(1, 'rgba(11,17,32,1)');
    g.fillStyle = fade; g.fillRect(0, 0, N, N);
    return tex(c);
  }
  function texStripes(c1, c2, n = 8, N = 128) {
    const c = cnv(N, N), g = c.getContext('2d');
    g.fillStyle = c1; g.fillRect(0, 0, N, N); g.fillStyle = c2;
    for (let i = -n; i < n * 2; i++) { g.beginPath(); const x = i * N / n; g.moveTo(x, 0); g.lineTo(x + N / n / 2, 0); g.lineTo(x + N / n / 2 - N, N); g.lineTo(x - N, N); g.closePath(); g.fill(); }
    return tex(c);
  }
  /** Sandwich-Paneel (Trapez-/Mikroprofil), horizontal gelegt */
  function texWall() {
    const W = 256, H = 512, c = cnv(W, H), g = c.getContext('2d');
    g.fillStyle = '#d3d7da'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) { g.fillStyle = y % 16 ? 'rgba(255,255,255,.07)' : 'rgba(40,46,54,.05)'; g.fillRect(0, y, W, 2); }
    for (let y = 0; y < H; y += 128) { g.fillStyle = 'rgba(38,44,52,.32)'; g.fillRect(0, y, W, 3); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, y + 3, W, 1); }
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(0,0,0,.05)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    return tex(c, { repeat: [1, 1] });
  }
  function texMesh(col, frame, cell) {
    const N = 128, c = cnv(N, N), g = c.getContext('2d'), s = cell || 16;
    g.clearRect(0, 0, N, N); g.strokeStyle = col; g.lineWidth = 2.5;
    for (let i = 0; i <= N; i += s) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke(); }
    if (frame) { g.lineWidth = 9; g.strokeRect(4.5, 4.5, N - 9, N - 9); }
    return tex(c);
  }
  /** Bedienoberfläche einer CNC-Steuerung (Programm, Achsen, Spindellast) */
  function texHMI(variant) {
    const c = cnv(256, 192), g = c.getContext('2d');
    g.fillStyle = '#0a1522'; g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#132a44'; g.fillRect(0, 0, 256, 22);
    g.fillStyle = '#3cc6f2'; g.fillRect(8, 8, 46, 7); g.fillStyle = 'rgba(160,190,220,.5)'; g.fillRect(60, 8, 60, 7);
    g.fillStyle = variant === 1 ? '#fbbf24' : '#34d399'; g.fillRect(206, 7, 42, 9);
    g.font = FONTMONO(500, 13); g.fillStyle = 'rgba(200,220,240,.85)';
    ['X  124.502', 'Y  -38.115', 'Z   12.040', 'C  270.000'].forEach((t, i) => g.fillText(t, 10, 44 + i * 18));
    for (let i = 0; i < 6; i++) { g.fillStyle = i === 2 ? 'rgba(60,198,242,.35)' : 'rgba(160,190,220,.16)'; g.fillRect(140, 32 + i * 13, 106, 10); }
    g.fillStyle = 'rgba(160,190,220,.25)'; g.fillRect(10, 120, 236, 1);
    g.fillStyle = '#34d399'; g.fillRect(10, 132, 150, 8); g.fillStyle = 'rgba(160,190,220,.18)'; g.fillRect(160, 132, 86, 8);
    g.fillStyle = '#3cc6f2'; g.fillRect(10, 148, 96, 8); g.fillStyle = 'rgba(160,190,220,.18)'; g.fillRect(106, 148, 140, 8);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(160,190,220,.22)'; g.fillRect(10 + i * 40, 168, 34, 16); }
    return tex(c);
  }
  function texDrawers(col) {
    const c = cnv(128, 256), g = c.getContext('2d');
    g.fillStyle = col || '#3d6a99'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 8; i++) { const y = 6 + i * 31; g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(3, y + 27, 122, 3); g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(3, y, 122, 2); g.fillStyle = '#c9d2dc'; g.fillRect(40, y + 11, 48, 5); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(14, y + 9, 16, 9); }
    return tex(c);
  }
  /** Teile im Behälter (Draufsicht): glänzende Rundteile */
  function texParts() {
    const N = 128, c = cnv(N, N), g = c.getContext('2d'), rnd = U.rng(5);
    g.fillStyle = '#3f464c'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 80; i++) { const x = rnd.range(0, N), y = rnd.range(0, N), r = rnd.range(5, 9); const gr = g.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r); gr.addColorStop(0, '#f2f5f7'); gr.addColorStop(0.55, '#9aa4ad'); gr.addColorStop(1, '#30363c'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    return tex(c);
  }
  function texGlow() {
    const N = 64, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.6)'); gr.addColorStop(0.5, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return tex(c, { srgb: false });
  }
  function texBlob() {
    const N = 64, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(0.5, 'rgba(0,0,0,.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return tex(c, { srgb: false });
  }
  function texPool() {   // Lichtkegel einer Hallenleuchte auf dem Boden (additiv)
    const N = 128, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,238,206,1)'); gr.addColorStop(0.28, 'rgba(255,232,196,.62)'); gr.addColorStop(0.62, 'rgba(255,226,186,.18)'); gr.addColorStop(1, 'rgba(255,226,186,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return tex(c);
  }
  function texLabel(text, o = {}) {
    const w = o.w || 512, h = o.h || 128, c = cnv(w, h), g = c.getContext('2d');
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = o.bw || 8; g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth); }
    g.fillStyle = o.color || '#fff'; g.font = FONT(o.weight || 700, o.px || 64); g.textBaseline = 'middle';
    spacedText(g, text, w / 2, h / 2 + 2, o.sp || 4);
    return tex(c);
  }
  /** Schild mit Piktogramm-Kreis und Text (Bereichsschilder an Räumen) */
  function texSign(title, sub, col) {
    const w = 512, h = 160, c = cnv(w, h), g = c.getContext('2d');
    g.fillStyle = '#f4f6f7'; g.fillRect(0, 0, w, h);
    g.fillStyle = col || '#1f4e8c'; g.fillRect(0, 0, 18, h);
    g.fillStyle = '#1b2230'; g.font = FONT(700, 64); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText(title, 44, 82);
    if (sub) { g.fillStyle = '#5b6985'; g.font = FONTUI(500, 30); g.fillText(sub, 46, 128); }
    return tex(c);
  }

  // ================================================================== Materialien
  function makeMaterials() {
    const std = (c, r = 0.6, m = 0, x) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m }, x || {}));
    const basic = (c, x) => new THREE.MeshBasicMaterial(Object.assign({ color: c, toneMapped: false }, x || {}));
    M = {
      paint: std(0xc4c8c7, 0.44),          // RAL 7035 Lichtgrau – Verkleidung
      paintW: std(0xdcdfde, 0.4),          // RAL 9016 – moderne Maschinen
      paintOld: std(0xb2b7a6, 0.58),       // Bestandsmaschine Bj. 1996
      dark: std(0x3a4047, 0.52),           // RAL 7016 Anthrazit – Sockel, Rahmen
      darker: std(0x23282e, 0.58),
      black: std(0x15191d, 0.38, 0.1),     // Fensterrahmen, Steuerungsgehäuse
      mid: std(0x8b939b, 0.4, 0.35),
      steel: std(0xb6bec6, 0.3, 0.9),
      steelDark: std(0x59616a, 0.38, 0.8),
      chrome: std(0xe9eef2, 0.12, 1),
      rubber: std(0x1b1e22, 0.86),
      accent: std(0x2f76a0, 0.34, 0.15),   // Akzentleiste (herstellerneutral)
      accent2: std(0x8fa3b5, 0.3, 0.4),
      yellow: std(0xf2b707, 0.45),
      orange: std(0xe0661f, 0.5),
      red: std(0xc23a31, 0.48),
      green: std(0x2f9a63, 0.5),
      blueRack: std(0x1f4e8c, 0.48, 0.25),
      column: std(0x8c96a0, 0.48, 0.4),
      wood: std(0xc9a06a, 0.86),
      woodDark: std(0x9a7448, 0.86),
      carton: std(0xbb8d58, 0.86),
      wrap: std(0xe8edf1, 0.2, 0, { transparent: true, opacity: 0.9, envMapIntensity: 1.4 }),
      film: std(0xdfe8ee, 0.12, 0, { transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 2.0 }),
      klt: std(0xffffff, 0.5, 0, { side: THREE.DoubleSide }),
      kltB: std(0x2f6fc4, 0.5),
      granite: std(0x2b2f34, 0.24, 0.05, { envMapIntensity: 1.3 }),
      alu: std(0xc9cfd5, 0.34, 0.7),
      stainless: std(0xc4cacf, 0.26, 0.8),
      oilUnit: std(0x355068, 0.42, 0.25),
      chuck: std(0x9ea6ad, 0.28, 0.85),
      hob: std(0xcfa95a, 0.28, 0.9),
      wheel: std(0xd6d0c0, 0.92),
      plant: std(0x3f7f4c, 0.8),
      epoxy: std(0x9aa2a8, 0.36),
      epoxyB: std(0x6f8797, 0.4),
      wall: std(0xffffff, 0.7, 0, { map: texWall() }),
      plinth: std(0x6e747b, 0.92),
      cut: std(0x2a3037, 0.92),
      fixture: std(0xcfd5da, 0.35, 0.6),
      tray: std(0x9aa3ac, 0.36, 0.8),
      cable: std(0x2a2f35, 0.7),
      cableB: std(0x2b6c9a, 0.55),
      blade: std(0xd8dee4, 0.28, 0.9),
      chain: std(0x3a3f45, 0.5, 0.8),
      screenFrame: std(0x101418, 0.3, 0.2),
      winGlass: std(0xa9c1d6, 0.06, 0.1, { emissive: 0xbfd7ef, emissiveIntensity: 0.55, envMapIntensity: 1.2 }),
      glass: std(0x14202a, 0.04, 0.0, { transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.6 }),
      glassRoom: std(0xb8ccd8, 0.03, 0.05, { transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.5, side: THREE.DoubleSide }),
      screen: basic(0xffffff, { map: texHMI(0) }),
      screen2: basic(0xffffff, { map: texHMI(1) }),
      fence: std(0xffffff, 0.55, 0.45, { map: texMesh('#3a4148', true), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
      fenceY: std(0xffffff, 0.55, 0.3, { map: texMesh('#e0a810', true), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
      fenceRed: std(0xffffff, 0.55, 0.3, { map: texMesh('#c23a31', true), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
      gitter: std(0xffffff, 0.42, 0.75, { map: texMesh('#9aa3ab', true, 21), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
      drawers: std(0xffffff, 0.48, 0.2, { map: texDrawers('#3d6a99') }),
      drawersR: std(0xffffff, 0.48, 0.2, { map: texDrawers('#a53a32') }),
      parts: std(0xffffff, 0.32, 0.65, { map: texParts() }),
      hazard: std(0xffffff, 0.55, 0, { map: texStripes('#f2b707', '#1d2024', 6) }),
      vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
      lens: basic(0xffffff),
      blob: new THREE.MeshBasicMaterial({ map: texBlob(), transparent: true, depthWrite: false, toneMapped: false }),
      hidden: new THREE.MeshBasicMaterial({ visible: false }),
      glowT: texGlow(),
      tabletScreen: basic(0x5fb6e6),
      ledG: basic(0x34d399), ledB: basic(0x3cc6f2), ledR: basic(0xf87171), ledY: basic(0xfbbf24),
    };
    M.lens.color.setRGB(2.4, 2.4, 2.25);
    for (const k in M) { const m = M[k]; if (m && m.isMeshStandardMaterial && !m.map && !m.transparent && !m.vertexColors && m.emissive && m.emissive.getHex() === 0) m.userData.batch = true; }
    M.batch = batchMaterial();
    M.ledG.color.multiplyScalar(1.6); M.ledB.color.multiplyScalar(1.6);
    for (const k of ['glass', 'glassRoom', 'wrap', 'film']) M[k].userData.noShadow = true;
  }

  /** Ein Material für viele Teile: Grundfarbe, Rauheit und Metallgrad kommen je Ecke aus der Geometrie */
  function batchMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, emissive: 0x000000 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec2 pbr;\nvarying vec2 vPbr;\nvarying float vWy;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vPbr = pbr;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
      // Bodennahe Verdeckung: Umgebungslicht nimmt zum Hallenboden hin ab (erdet Maschinen, Regale, Behälter)
      sh.fragmentShader = 'varying vec2 vPbr;\nvarying float vWy;\n' + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n float gAO = mix(0.5, 1.0, smoothstep(0.0, 0.85, vWy)); reflectedLight.indirectDiffuse *= gAO; reflectedLight.indirectSpecular *= mix(0.65, 1.0, gAO);');
    };
    m.customProgramCacheKey = () => 'h3batch';
    return m;
  }

  // ================================================================== Szene, Licht, Umgebung
  function buildEnv() {
    const pm = new THREE.PMREMGenerator(R.renderer);
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      const c = y > 0 ? [0.36 + 0.4 * y, 0.39 + 0.42 * y, 0.45 + 0.45 * y] : [0.26 + 0.12 * y, 0.27 + 0.12 * y, 0.3 + 0.12 * y];
      col.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    // Lichtbänder der Hallendecke + Fensterband (für Glanzlichter auf Lack, Glas und Metall)
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff }); lm.color.setRGB(6, 6, 6.3);
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(80, 0.4, 1.4), lm); b.position.set(0, 30, -32 + i * 16); s.add(b); }
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff }); wm.color.setRGB(1.9, 2.15, 2.6);
    const wb = new THREE.Mesh(new THREE.BoxGeometry(100, 7, 1), wm); wb.position.set(0, 9, -45); s.add(wb);
    const wb2 = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 100), wm); wb2.position.set(-45, 9, 0); s.add(wb2);
    const env = pm.fromScene(s, 0.04).texture;
    pm.dispose(); geo.dispose();
    return env;
  }
  function buildLights() {
    const sc = R.scene, P = WF.profile.hall, cx = P.w / 2, cz = P.d / 2;
    R.hemi = new THREE.HemisphereLight(0xe9effc, 0x3c424b, 0.5);
    sc.add(R.hemi);
    const sun = new THREE.DirectionalLight(0xfff5e8, 1.22);
    sun.position.set(cx - 26, 58, cz + 30); sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const big = R.renderer.capabilities.maxTextureSize >= 8192 && !R.mobile;
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    const c = sun.shadow.camera; c.left = -46; c.right = 46; c.top = 34; c.bottom = -34; c.near = 20; c.far = 150;
    sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.028;
    sc.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.3); fill.position.set(cx + 50, 22, cz + 34); fill.target.position.set(cx, 0, cz);
    sc.add(fill, fill.target);
    R.sun = sun; R.fill = fill;
  }

  // ================================================================== Boden: Estrich + Markierungen + Umgebungsverdeckung
  const AISLE_HW = { back: 1.0, main: 1.7, front: 1.0, vl: 1.0, vr: 0.85, vm: 1.0 };
  const ZONE_STYLE = {
    RAW: { fill: 'rgba(150,175,210,.07)', line: 'rgba(205,218,235,.5)', hatch: false },
    PUF: { fill: 'rgba(150,175,210,.07)', line: 'rgba(205,218,235,.5)' },
    CHG: { fill: 'rgba(52,211,153,.09)', line: 'rgba(52,211,153,.65)' },
    WE: { fill: 'rgba(96,165,250,.10)', line: 'rgba(150,190,250,.6)', hatch: true },
    EXT: { fill: 'rgba(255,157,61,.10)', line: 'rgba(255,170,90,.7)', hatch: true },
    SPERR: { fill: 'rgba(248,113,113,.14)', line: 'rgba(248,113,113,.75)', hatch: true },
    VERSAND: { fill: 'rgba(52,211,153,.045)', line: 'rgba(110,220,170,.5)', hatch: false },
    CRIB: { fill: 'rgba(232,238,244,.16)' }, MAINT: { fill: 'rgba(232,238,244,.10)' }, OFFICE: { fill: 'rgba(232,238,244,.20)' }, QS: { fill: 'rgba(236,241,246,.24)' }, M13: { fill: 'rgba(232,238,244,.10)' },
  };
  /** Stellplatz-Raster (wie die Engine: 3 je Reihe, 0,9 m), 2. Reihe zum Gang hin statt in die Maschine */
  /** Stellplatz eines Behälters (Engine: Reihenfolge = slotIndex). Plätze laufen vom Arbeitsplatz weg (die Person steht nie
      im Behälter), die 2. Reihe zum Gang hin; Plätze in Gängen oder auf fremden Aufstellflächen werden übersprungen. */
  const SLOT_CACHE = new Map();
  function slotPos(st, slot, k) {
    const key = st.id + slot;
    let list = SLOT_CACHE.get(key);
    if (!list) { list = slotList(st, slot); SLOT_CACHE.set(key, list); }
    return list[Math.min(k, list.length - 1)];
  }
  function slotList(st, slot) {
    const P = WF.profile, base = slot === 'out' ? st.outPos : st.inPos, w = st.work || st.dock, out = [];
    const room = st.kind === 'qs', asm = st.kind === 'assembly';
    let cx, cz, rx, rz;
    if (asm) { cx = 0; cz = Math.sign(base.z - w.z) || 1; rx = Math.sign(st.dock.x - base.x) || -1; rz = 0; }
    else { cx = Math.sign(base.x - w.x) || (slot === 'out' ? 1 : -1); cz = 0; rx = 0; rz = room ? 1 : (Math.sign(22 - base.z) || 1); }
    const rows = room ? 4 : 2, cols = room ? 2 : 3;
    const inAisle = (x, z) => P.graph.lines.some(L => { if (L.id === 'main' && !room && !asm) return false; const hw = (AISLE_HW[L.id] || 1) - 0.05; return L.axis === 'z' ? Math.abs(x - L.c) < hw + 0.3 && z > L.a - hw && z < L.b + hw : Math.abs(z - L.c) < hw + 0.05 && x > L.a - hw && x < L.b + hw; });
    const onOther = (x, z) => P.stations.some(s => s !== st && s.footprint && (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly') && x > s.footprint.x - 0.3 && x < s.footprint.x + s.footprint.w + 0.3 && z > s.footprint.z - 0.3 && z < s.footprint.z + s.footprint.d + 0.3);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const x = base.x + cx * c * 0.9 + rx * r * 0.9, z = base.z + cz * c * 0.9 + rz * r * 0.9;
      if (!room && (inAisle(x, z) || onOther(x, z))) continue;
      out.push({ x, z, o: room ? r + c * rows : c + r * cols });
    }
    out.sort((a, b) => a.o - b.o);
    if (!out.length) out.push({ x: base.x, z: base.z });
    return out;
  }
  function floorLayout() {
    const P = WF.profile, lines = P.graph.lines;
    const fps = P.stations.filter(s => s.footprint).map(s => s.footprint);
    return { P, lines, fps, HW: P.hall.w, HD: P.hall.d };
  }
  function texFloorMarks(PX) {
    const { P, lines, fps, HW, HD } = floorLayout();
    const c = cnv(Math.round(HW * PX), Math.round(HD * PX)), g = c.getContext('2d');
    const X = (x) => x * PX, Z = (z) => z * PX;
    // Schnittfugen (Feldgröße wie die Estrich-Kachel)
    g.fillStyle = 'rgba(46,50,56,.55)';
    for (let i = 1; i < 10; i++) g.fillRect(X(i * HW / 10) - 0.75, 0, 1.5, Z(HD));
    for (let i = 1; i < 6; i++) g.fillRect(0, Z(i * HD / 6) - 0.75, X(HW), 1.5);
    // Zonen
    for (const s of P.stations) {
      const zs = ZONE_STYLE[s.id], f = s.footprint; if (!zs || !f) continue;
      g.fillStyle = zs.fill; g.fillRect(X(f.x), Z(f.z), f.w * PX, f.d * PX);
      if (zs.line) g.strokeStyle = zs.line; if (zs.line) g.lineWidth = 0.1 * PX; if (zs.line) g.strokeRect(X(f.x) + 0.05 * PX, Z(f.z) + 0.05 * PX, f.w * PX - 0.1 * PX, f.d * PX - 0.1 * PX);
      if (zs.hatch) {
        g.save(); g.beginPath(); g.rect(X(f.x), Z(f.z), f.w * PX, f.d * PX); g.rect(X(f.x) + 0.42 * PX, Z(f.z) + 0.42 * PX, f.w * PX - 0.84 * PX, f.d * PX - 0.84 * PX); g.clip('evenodd');
        g.strokeStyle = zs.line; g.lineWidth = 0.13 * PX;
        for (let i = -40; i < (f.w + f.d) / 0.36; i++) { g.beginPath(); g.moveTo(X(f.x) + i * 0.36 * PX, Z(f.z)); g.lineTo(X(f.x) + i * 0.36 * PX - f.d * PX, Z(f.z + f.d)); g.stroke(); }
        g.restore();
      }
    }
    // Gänge: gelbe Randlinien mit Lücken an Kreuzungen und Stellflächen
    const yellow = 'rgba(247,186,24,.95)', lw = 0.1 * PX;
    const drawEdge = (axis, c0, a, b) => {
      const blocks = [];
      for (const f of fps) {
        if (axis === 'x') { if (c0 >= f.z - 0.15 && c0 <= f.z + f.d + 0.15) blocks.push([f.x - 0.15, f.x + f.w + 0.15]); }
        else if (c0 >= f.x - 0.15 && c0 <= f.x + f.w + 0.15) blocks.push([f.z - 0.15, f.z + f.d + 0.15]);
      }
      for (const L of lines) {
        if (L.axis === axis) continue;
        const hw = AISLE_HW[L.id] || 1;
        if (c0 >= L.a - hw - 0.01 && c0 <= L.b + hw + 0.01) blocks.push([L.c - hw, L.c + hw]);
      }
      blocks.sort((p, q) => p[0] - q[0]);
      let cur = a;
      const seg = (s0, s1) => { if (s1 - s0 < 0.3) return; g.fillStyle = yellow; if (axis === 'x') g.fillRect(X(s0), Z(c0) - lw / 2, (s1 - s0) * PX, lw); else g.fillRect(X(c0) - lw / 2, Z(s0), lw, (s1 - s0) * PX); };
      for (const [b0, b1] of blocks) { if (b1 <= cur) continue; if (b0 > cur) seg(cur, Math.min(b0, b)); cur = Math.max(cur, b1); if (cur >= b) break; }
      if (cur < b) seg(cur, b);
    };
    for (const L of lines) {
      const hw = AISLE_HW[L.id] || 1;
      const a = Math.max(0.4, L.a - hw), b = Math.min(L.axis === 'x' ? HW - 0.4 : HD - 0.4, L.b + hw);
      drawEdge(L.axis, L.c - hw, a, b); drawEdge(L.axis, L.c + hw, a, b);
    }
    // Hauptgang: Mittellinie gestrichelt (Fahrweg Stapler/AGV in beide Richtungen)
    const mainL = lines.find(l => l.id === 'main');
    if (mainL) { g.fillStyle = 'rgba(240,244,248,.42)'; for (let x = mainL.a + 1.2; x < mainL.b - 1; x += 2.0) { const near = lines.some(L => L.axis === 'z' && Math.abs(L.c - x - 0.5) < (AISLE_HW[L.id] || 1) + 0.6 && mainL.c >= L.a && mainL.c <= L.b); if (!near) g.fillRect(X(x), Z(mainL.c) - 0.04 * PX, 1.0 * PX, 0.08 * PX); } }
    // Kreuzungen schraffiert
    for (const A of lines) for (const B of lines) {
      if (A.axis !== 'x' || B.axis !== 'z') continue;
      if (B.c < A.a - 0.01 || B.c > A.b + 0.01 || A.c < B.a - 0.01 || A.c > B.b + 0.01) continue;
      const hx = AISLE_HW[B.id] || 1, hz = AISLE_HW[A.id] || 1;
      const x0 = X(B.c - hx), z0 = Z(A.c - hz), w = 2 * hx * PX, d = 2 * hz * PX;
      g.save(); g.beginPath(); g.rect(x0 + 0.18 * PX, z0 + 0.18 * PX, w - 0.36 * PX, d - 0.36 * PX); g.clip();
      g.strokeStyle = 'rgba(247,186,24,.34)'; g.lineWidth = 0.16 * PX;
      for (let i = -d; i < w + d; i += 0.55 * PX) { g.beginPath(); g.moveTo(x0 + i, z0); g.lineTo(x0 + i - d, z0 + d); g.stroke(); }
      g.restore();
    }
    // Stellflächen Ein-/Ausgang (weiß gestrichelt) mit Beschriftung
    g.setLineDash([0.25 * PX, 0.17 * PX]);
    for (const s of P.stations) {
      if (!s.inPos || !(s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly')) continue;
      [['in', Math.min(6, s.inCap || 0), 'EIN'], ['out', Math.min(6, s.outCap || 0), 'AUS']].forEach(([slot, cap, txt]) => {
        for (let k = 0; k < Math.min(cap, 4); k++) { const p = slotPos(s, slot, k); g.strokeStyle = 'rgba(255,255,255,.26)'; g.lineWidth = 0.05 * PX; g.strokeRect(X(p.x - 0.42), Z(p.z - 0.42), 0.84 * PX, 0.84 * PX); }
        if (cap > 0 && s.kind === 'machine') {
          const p = slotPos(s, slot, 0), dz = (slot === 'out' ? s.outPos : s.inPos).z > 22 ? -0.66 : 0.66;
          g.save(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,.42)'; g.font = FONT(600, 0.3 * PX); g.textBaseline = 'middle';
          spacedText(g, txt, X(p.x), Z(p.z + dz), 0.05 * PX); g.restore();
        }
      });
    }
    g.setLineDash([]);
    // Ladeplätze AGV
    const chg = P.stationById.CHG;
    if (chg) for (const p of [chg.inPos, chg.outPos]) { g.strokeStyle = 'rgba(52,211,153,.8)'; g.lineWidth = 0.07 * PX; g.strokeRect(X(p.x - 0.55), Z(p.z - 0.8), 1.1 * PX, 1.6 * PX); }
    // Übergabeplatz im Versand: hier setzt das AGV ab – Paletten stehen außerhalb (VERS_SLOTS)
    const vs = P.stationById.VERSAND;
    if (vs && vs.inPos) {
      const p = vs.inPos, s = VERS_HAND;
      g.save(); g.setLineDash([0.34 * PX, 0.2 * PX]); g.strokeStyle = 'rgba(52,211,153,.85)'; g.lineWidth = 0.08 * PX;
      g.strokeRect(X(p.x - s / 2), Z(p.z - s / 2), s * PX, s * PX); g.setLineDash([]);
      g.fillStyle = 'rgba(110,231,183,.85)'; g.font = FONT(700, 0.27 * PX); g.textBaseline = 'middle';
      spacedText(g, 'AGV-ÜBERGABE', X(p.x), Z(p.z + s / 2 - 0.3), 0.04 * PX); g.restore();
    }
    // Tore: Schwellen gelb/schwarz + Beschriftung
    for (const d of P.hall.doors) {
      const x0 = X(d.x), z0 = Z(HD - 0.7), w = d.w * PX, h = 0.6 * PX;
      g.save(); g.beginPath(); g.rect(x0, z0, w, h); g.clip(); g.fillStyle = '#1d2024'; g.fillRect(x0, z0, w, h); g.fillStyle = 'rgba(243,190,30,.95)';
      for (let i = -h; i < w + h; i += 0.6 * PX) { g.beginPath(); g.moveTo(x0 + i, z0); g.lineTo(x0 + i + 0.3 * PX, z0); g.lineTo(x0 + i + 0.3 * PX - h, z0 + h); g.lineTo(x0 + i - h, z0 + h); g.fill(); }
      g.restore();
      g.fillStyle = 'rgba(255,255,255,.5)'; g.font = FONT(600, 0.42 * PX); g.textBaseline = 'middle';
      spacedText(g, d.name.toUpperCase(), X(d.x + d.w / 2), Z(HD - 1.15), 0.07 * PX);
    }
    // Bereichsnamen (groß, auf dem Boden)
    g.textBaseline = 'middle';
    for (const a of P.hall.areas) { g.fillStyle = 'rgba(255,255,255,.34)'; g.font = FONT(700, 0.95 * PX); spacedText(g, a.name.toUpperCase(), X(a.x), Z(a.z), 0.16 * PX); }
    for (const s of P.stations) {
      if (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly' || !s.footprint) continue;
      const f = s.footprint, front = f.z > 20;
      if (s.room) continue;
      const x = X(f.x + f.w / 2), z = s.id === 'VERSAND' ? Z(f.z + 0.75) : front ? Z(f.z + 0.75) : Z(f.z + f.d - 0.55);
      g.fillStyle = s.id === 'SPERR' ? 'rgba(255,180,180,.7)' : 'rgba(255,255,255,.5)'; g.font = FONT(700, 0.48 * PX);
      spacedText(g, s.short.toUpperCase(), x, z, 0.08 * PX);
    }
    return tex(c, { aniso: Math.min(8, R.aniso) });
  }
  /** Umgebungsverdeckung (Kontaktschatten) und Fahrspuren, niedrige Auflösung, linear */
  function texFloorAO() {
    const { P, HW, HD } = floorLayout(), PX = 12;
    const c = cnv(HW * PX, HD * PX), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const X = (x) => x * PX, Z = (z) => z * PX;
    const ao = (x, z, w, d, blur, a) => { g.save(); g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = blur; g.shadowOffsetX = 30000; g.fillStyle = '#000'; g.fillRect(X(x) - 30000, Z(z), w * PX, d * PX); g.restore(); };
    ao(-1, -0.5, HW + 2, 0.6, 40, 0.75); ao(-0.5, -1, 0.6, HD + 2, 40, 0.75);
    ao(HW - 0.15, -1, 0.6, HD + 2, 14, 0.5); ao(-1, HD - 0.15, HW + 2, 0.6, 14, 0.5);
    for (const s of P.stations) {
      const f = s.footprint; if (!f) continue;
      if (s.kind === 'machine') { ao(f.x + 0.25, f.z + 0.25, f.w - 0.5, f.d - 0.5, 18, 0.55); ao(f.x + 0.6, f.z + 0.6, f.w - 1.2, f.d - 1.2, 6, 0.35); }
      else if (s.id === 'RAW' || s.id === 'PUF') ao(f.x + 0.3, f.z + 0.2, f.w - 0.6, Math.min(f.d, 3) - 0.4, 14, 0.35);
      else if (s.room) ao(f.x, f.z, f.w, f.d, 8, 0.12);
    }
    // Fahrspuren (Reifenabrieb) im Hauptgang und vorderen Quergang
    const rnd = U.rng(8);
    for (const L of P.graph.lines) {
      if (L.axis !== 'x') continue;
      for (const off of [-0.55, 0.55]) {
        g.strokeStyle = 'rgba(40,40,40,.05)'; g.lineWidth = 0.3 * PX;
        g.beginPath(); g.moveTo(X(L.a), Z(L.c + off)); for (let x = L.a; x <= L.b; x += 2) g.lineTo(X(x), Z(L.c + off + rnd.range(-0.06, 0.06))); g.stroke();
      }
    }
    const t = tex(c, { srgb: false });
    return t;
  }
  function buildFloor() {
    const P = WF.profile, HW = P.hall.w, HD = P.hall.d;
    const PX = R.mobile ? 28 : 44;
    const marks = texFloorMarks(PX), ao = texFloorAO();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f949b, map: texConcrete(), roughnessMap: texConcreteRough(), roughness: 0.62, metalness: 0, envMapIntensity: 0.55 });
    const uni = { uMarks: { value: marks }, uAO: { value: ao } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uMarks = uni.uMarks; sh.uniforms.uAO = uni.uAO;
      sh.vertexShader = 'varying vec2 vUv0;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vUv0 = uv;');
      sh.fragmentShader = 'uniform sampler2D uMarks; uniform sampler2D uAO; varying vec2 vUv0;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n float flAo = texture2D(uAO, vUv0).r; diffuseColor.rgb *= flAo;\n vec4 flMk = texture2D(uMarks, vUv0); diffuseColor.rgb = mix(diffuseColor.rgb, flMk.rgb, flMk.a);');
    };
    mat.customProgramCacheKey = () => 'h3floor';
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW, HD), mat);
    floor.rotation.x = -PI / 2; floor.position.set(HW / 2, 0, HD / 2); floor.receiveShadow = true;
    R.scene.add(floor);
    R.floor = floor; R.floorUni = uni;
    R.redrawMarks = () => { const old = uni.uMarks.value; uni.uMarks.value = texFloorMarks(PX); old.dispose(); };
  }

  // ================================================================== Halle: Gelände, Wände, Stützen, Tore, Leuchten, Kabeltrasse
  const WALL_H = 9, PLINTH = 1.2, WIN0 = 5.0, WIN_H = 1.5, TRAY_Y = 6.2, ROOF_Y = 8.9;
  function buildHall() {
    const P = WF.profile, HW = P.hall.w, HD = P.hall.d, sc = R.scene;
    // Gelände (dunkle Bühne mit feinem Raster, nach außen ausgeblendet)
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshBasicMaterial({ map: texGround(), toneMapped: false }));
    gnd.rotation.x = -PI / 2; gnd.position.set(HW / 2, -0.06, HD / 2); sc.add(gnd);
    const b = new Builder();
    // Fundament + Vorplatz vor den Toren
    b.box(M.plinth, HW + 0.8, 0.1, HD + 0.8, HW / 2, -0.13, HD / 2);
    const apron = std2(0x4a5058, 0.9), AD = 11.5;
    b.box(apron, HW + 0.6, 0.05, AD, HW / 2, -0.09, HD + 0.4 + AD / 2);
    b.box(M.plinth, HW + 0.6, 0.16, 0.14, HW / 2, -0.13, HD + 0.4 + AD);   // Bordstein
    for (const d of P.hall.doors) { b.box(M.darker, d.w + 0.6, 0.012, AD - 0.6, d.x + d.w / 2, -0.04, HD + 0.4 + (AD - 0.6) / 2); for (const s of [-1, 1]) b.box(M.yellow, 0.12, 0.012, AD - 0.6, d.x + d.w / 2 + s * (d.w / 2 + 0.24), -0.035, HD + 0.4 + (AD - 0.6) / 2); }
    buildYard(b, HD);
    buildFloor();

    // ---------- Wände: Rück- und linke Wand voll (Sandwichpaneel, Fensterband), vorne/rechts als Schnitt auf Sockelhöhe
    const TH = 0.3;
    b.box(M.plinth, TH, PLINTH, HD + TH, HW + TH / 2, 0, HD / 2 + TH / 2);
    b.box(M.cut, TH + 0.02, 0.03, HD + TH, HW + TH / 2, PLINTH, HD / 2 + TH / 2);
    const doors = P.hall.doors.slice().sort((p, q) => p.x - q.x);
    let cx = -TH;
    for (const d of doors) {
      if (d.x > cx) { b.box(M.plinth, d.x - cx, PLINTH, TH, (cx + d.x) / 2, 0, HD + TH / 2); b.box(M.cut, d.x - cx, 0.03, TH + 0.02, (cx + d.x) / 2, PLINTH, HD + TH / 2); }
      cx = d.x + d.w;
      for (const px of [d.x - 0.13, d.x + d.w + 0.13]) { b.box(M.hazard, 0.26, PLINTH + 0.25, TH + 0.14, px, 0, HD + TH / 2); b.box(M.cut, 0.27, 0.03, TH + 0.15, px, PLINTH + 0.25, HD + TH / 2); }
      // Torführung (Laufschienen) bis zur Schnitthöhe + Anfahrschutz-Bügel innen
      for (const px of [d.x + 0.05, d.x + d.w - 0.05]) b.box(M.steelDark, 0.1, PLINTH + 0.2, 0.14, px, 0, HD - 0.12);
      for (const px of [d.x - 0.5, d.x + d.w + 0.5]) { b.cyl(M.yellow, 0.06, 0.9, px, 0, HD - 0.55, 12); }
    }
    if (cx < HW + TH) { b.box(M.plinth, HW + TH - cx, PLINTH, TH, (cx + HW + TH) / 2, 0, HD + TH / 2); b.box(M.cut, HW + TH - cx, 0.03, TH + 0.02, (cx + HW + TH) / 2, PLINTH, HD + TH / 2); }
    b.build(sc);

    const mkWall = (len, alongX) => {
      const g = new THREE.Group(), wb = new Builder();
      const hU = WALL_H - PLINTH;
      const wm = M.wall.clone(); wm.map = M.wall.map.clone(); wm.map.needsUpdate = true;
      wm.map.wrapS = wm.map.wrapT = THREE.RepeatWrapping; wm.map.repeat.set(Math.round(len / 2), hU / 4);
      const lower = WIN0 - PLINTH, upper = WALL_H - (WIN0 + WIN_H);
      const inner = TH / 2 + 0.01;
      const geoL = new THREE.BoxGeometry(alongX ? len : TH, lower, alongX ? TH : len).translate(0, lower / 2, 0);
      const geoU = new THREE.BoxGeometry(alongX ? len : TH, upper, alongX ? TH : len).translate(0, WIN0 + WIN_H - PLINTH + upper / 2, 0);
      for (const gg of [geoL, geoU]) { const m = new THREE.Mesh(gg, wm); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      const y0 = WIN0 - PLINTH;
      if (alongX) {
        wb.box(M.winGlass, len, WIN_H, 0.06, 0, y0, 0);
        for (let x = -len / 2; x <= len / 2 + 1e-6; x += 2) wb.box(M.black, 0.07, WIN_H, TH * 0.9, x, y0, 0);
        wb.box(M.black, len, 0.08, TH + 0.04, 0, y0 - 0.04, 0); wb.box(M.black, len, 0.08, TH + 0.04, 0, y0 + WIN_H - 0.04, 0);
        wb.box(M.paintW, len, 0.05, 0.22, 0, y0 - 0.05, inner + 0.08);
        for (let x = -len / 2 + 8; x <= len / 2 - 8 + 1e-6; x += 8) wb.add(gIBeam(WALL_H - 0.1, 0.34, 0.03, 0.016), M.column, xf(x, -PLINTH, inner + 0.17));
        wb.box(M.cut, len + TH * 2, 0.1, TH + 0.04, 0, WALL_H - PLINTH, 0);
      } else {
        wb.box(M.winGlass, 0.06, WIN_H, len, 0, y0, 0);
        for (let z = -len / 2; z <= len / 2 + 1e-6; z += 2) wb.box(M.black, TH * 0.9, WIN_H, 0.07, 0, y0, z);
        wb.box(M.black, TH + 0.04, 0.08, len, 0, y0 - 0.04, 0); wb.box(M.black, TH + 0.04, 0.08, len, 0, y0 + WIN_H - 0.04, 0);
        wb.box(M.paintW, 0.22, 0.05, len, inner + 0.08, y0 - 0.05, 0);
        for (let z = -len / 2 + 8; z <= len / 2 - 8 + 1e-6; z += 8) wb.add(gIBeam(WALL_H - 0.1, 0.34, 0.03, 0.016), M.column, xf(inner + 0.17, -PLINTH, z, 0, PI / 2, 0));
        wb.box(M.cut, TH + 0.04, 0.1, len, 0, WALL_H - PLINTH, 0);
      }
      wb.build(g);
      return g;
    };
    const bp = new Builder();
    bp.box(M.plinth, HW + TH * 2, PLINTH, TH, HW / 2, 0, -TH / 2);
    bp.box(M.plinth, TH, PLINTH, HD, -TH / 2, 0, HD / 2);
    bp.build(sc);
    const back = mkWall(HW + TH * 2, true); back.position.set(HW / 2, PLINTH, -TH / 2); sc.add(back);
    const left = mkWall(HD, false); left.position.set(-TH / 2, PLINTH, HD / 2); sc.add(left);
    R.walls = [{ g: back, f: 1, outside: (c) => c.z < -0.6 }, { g: left, f: 1, outside: (c) => c.x < -0.6 }];

    // ---------- Wandausstattung: Notausgang, Unterverteilungen, Druckluftstation, Feuerlöscher
    const w = new Builder();
    // Notausgang linke Wand
    w.box(M.paintW, 0.08, 2.3, 1.3, 0.04, 0, 30.0); w.box(M.dark, 0.1, 2.38, 0.08, 0.05, 0, 29.31); w.box(M.dark, 0.1, 2.38, 0.08, 0.05, 0, 30.69); w.box(M.dark, 0.1, 0.08, 1.46, 0.05, 2.3, 30.0);
    w.box(M.steel, 0.06, 0.04, 0.9, 0.12, 1.05, 30.0);
    R.exitSign = mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: texLabel('NOTAUSGANG', { bg: '#178a4c', px: 56, w: 512, h: 160, color: '#ffffff' }), toneMapped: false }), 0.1, 2.62, 30.0);
    R.exitSign.rotation.y = PI / 2; sc.add(R.exitSign);
    // Unterverteilungen an der Rückwand
    for (const x of [9.6, 27.1, 42.0]) { w.rbox(M.paint, 0.8, 1.6, 0.28, 0.02, x, 0.5, 0.14); w.box(M.darker, 0.01, 1.3, 0.01, x, 0.65, 0.285); w.box(M.yellow, 0.14, 0.14, 0.01, x - 0.22, 1.85, 0.29); w.box(M.cable, 0.2, 2.6, 0.06, x + 0.2, 2.1, 0.08); }
    // Druckluftstation zwischen Ladestation und Büro
    w.rbox(M.paint, 1.6, 1.55, 0.95, 0.06, 50.0, 0, 1.0, 0, 0.03); w.box(M.accent, 1.5, 0.05, 0.01, 50.0, 1.32, 1.48); w.box(M.darker, 0.9, 0.5, 0.02, 49.95, 0.4, 1.48);
    for (let i = 0; i < 7; i++) w.box(M.darker, 0.6, 0.025, 0.01, 50.3, 0.5 + i * 0.07, 1.485);
    w.rbox(M.paint, 0.8, 1.15, 0.7, 0.05, 51.8, 0, 0.95);
    w.cyl(M.paintW, 0.42, 2.05, 53.6, 0.18, 1.0, 24); w.sph(M.paintW, 0.42, 53.6, 2.23, 1.0, 20); w.sph(M.paintW, 0.42, 53.6, 0.18, 1.0, 20);
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) w.box(M.dark, 0.05, 0.25, 0.05, 53.6 + dx, 0, 1.0 + dz);
    w.tube(M.steelDark, [[50.8, 1.3, 1.0], [52.6, 1.3, 1.0], [53.2, 1.5, 1.0]], 0.035);
    w.tube(M.steelDark, [[53.6, 2.6, 1.0], [53.6, 3.4, 0.4], [53.6, 4.6, 0.2], [30, 4.6, 0.2]], 0.03);
    w.build(sc);
    // Stützen (HEB) mit Anfahrschutz, Feuerlöscher, Stützennummer
    const cb = new Builder();
    P.hall.columns.forEach((c, i) => {
      cb.add(gIBeam(ROOF_Y - 0.3, 0.3, 0.028, 0.014), M.column, xf(c.x, 0, c.z));
      cb.box(M.steelDark, 0.5, 0.025, 0.5, c.x, 0, c.z);
      cb.box(M.hazard, 0.46, 1.0, 0.46, c.x, 0.025, c.z);
      cb.box(M.column, 0.42, 0.04, 0.42, c.x, ROOF_Y - 0.34, c.z);
      cb.cyl(M.red, 0.085, 0.52, c.x + 0.36, 0.42, c.z, 14); cb.cyl(M.darker, 0.028, 0.12, c.x + 0.36, 0.94, c.z, 8); cb.box(M.darker, 0.12, 0.05, 0.03, c.x + 0.4, 1.0, c.z);
      cb.box(M.red, 0.02, 0.28, 0.28, c.x + 0.16, 1.55, c.z);
    });
    cb.build(sc);
    // Hallenleuchten (Tiefstrahler an Abhängung), instanziert
    const lamps = [];
    for (const z of [5.5, 16.2, 27.8, 37.0]) for (let x = 4; x < HW; x += 8) lamps.push([x, z]);
    const lampG = cache('lampg', () => mergeGeos([[new THREE.CylinderGeometry(0.3, 0.22, 0.16, 24), xf(0, 0.08, 0)], [new THREE.CylinderGeometry(0.12, 0.3, 0.1, 24), xf(0, 0.21, 0)], [new THREE.CylinderGeometry(0.01, 0.01, 1, 6), xf(0, 0.76, 0, 0, 0, 0, 1, 1.0, 1)]]));
    const lensG = cache('lensg', () => new THREE.CircleGeometry(0.21, 24).rotateX(PI / 2));
    const hous = new THREE.InstancedMesh(lampG, M.fixture, lamps.length), lens = new THREE.InstancedMesh(lensG, M.lens, lamps.length);
    lamps.forEach(([x, z], i) => { hous.setMatrixAt(i, xf(x, 7.3, z)); lens.setMatrixAt(i, xf(x, 7.295, z)); });
    hous.castShadow = false; lens.castShadow = false;
    sc.add(hous, lens);
    R.fade.push({ obj: hous, mat: M.fixture }, { obj: lens });
    // Lichtkegel am Boden – nur sichtbar, wenn das Tageslicht fehlt (keine Schicht / Geisterschicht)
    R.poolMat = new THREE.MeshBasicMaterial({ map: texPool(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    R.pools = new THREE.InstancedMesh(gPlaneY(), R.poolMat, lamps.length);
    lamps.forEach(([x, z], i) => R.pools.setMatrixAt(i, xf(x, 0.02, z, 0, 0, 0, 7.5, 1, 7.5)));
    R.pools.visible = false; R.pools.renderOrder = 1; R.pools.frustumCulled = false; sc.add(R.pools);

    // ---------- Kabeltrasse (Datenfluss): Hauptgang → rechter Längsgang → Leitstand/MES-Server
    const off = P.stationById.OFFICE, srv = off.server;
    R.TRAY_Y = TRAY_Y;
    const tb = new Builder();
    const traySeg = (x0, z0, x1, z1, wdt) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const [ox, oz] = rotXZ(wdt / 2, 0, ry);
      tb.box(M.tray, 0.025, 0.07, len, mx + ox, TRAY_Y - 0.07, mz + oz, ry); tb.box(M.tray, 0.025, 0.07, len, mx - ox, TRAY_Y - 0.07, mz - oz, ry);
      const n = Math.max(1, Math.floor(len / 0.5));
      for (let i = 0; i <= n; i++) { const t = -len / 2 + i * len / n, [rx, rz] = rotXZ(0, t, ry); tb.box(M.tray, wdt, 0.015, 0.03, mx + rx, TRAY_Y - 0.07, mz + rz, ry); }
      const [cx1, cz1] = rotXZ(-wdt * 0.15, 0, ry); tb.box(M.cable, wdt * 0.42, 0.035, len, mx + cx1, TRAY_Y - 0.055, mz + cz1, ry);
      const [cx2, cz2] = rotXZ(wdt * 0.22, 0, ry); tb.box(M.cableB, wdt * 0.18, 0.03, len, mx + cx2, TRAY_Y - 0.055, mz + cz2, ry);
      for (let i = 0; i <= Math.floor(len / 3); i++) { const t = -len / 2 + 0.2 + i * 3, [rx, rz] = rotXZ(0, Math.min(t, len / 2 - 0.2), ry); for (const s of [-1, 1]) { const [hx, hz] = rotXZ(s * (wdt / 2 + 0.02), 0, ry); tb.cyl(M.steelDark, 0.008, 0.95, mx + rx + hx, TRAY_Y - 0.07, mz + rz + hz, 5); } tb.box(M.steelDark, wdt + 0.1, 0.03, 0.04, mx + rx, TRAY_Y - 0.1, mz + rz, ry); }
    };
    R.trayRoute = [[2.5, 22], [58.5, 22], [58.5, 4.6], [srv.x, 4.6]];
    traySeg(2.5, 22, 58.5, 22, 0.4); traySeg(58.5, 22.2, 58.5, 4.6, 0.4); traySeg(58.7, 4.6, srv.x, 4.6, 0.3);
    tb.box(M.cable, 0.06, TRAY_Y - 2.05, 0.06, srv.x, 2.05, 4.6); tb.box(M.tray, 0.3, 0.02, 2.4, srv.x, TRAY_Y - 0.08, 3.4);
    tb.build(sc, false);
    // Leuchtlinie auf der Trasse (nur Ebene Datenfluss)
    const glowLine = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const gl = new Builder();
    gl.box(glowLine, 56.0, 0.01, 0.05, 30.5, TRAY_Y - 0.02, 22); gl.box(glowLine, 0.05, 0.01, 17.4, 58.5, TRAY_Y - 0.02, 13.3); gl.box(glowLine, srv.x - 58.5, 0.01, 0.05, (58.5 + srv.x) / 2, TRAY_Y - 0.02, 4.6);
    R.trayGlow = gl.build(sc, false);
    R.trayGlowMat = glowLine;
  }
  /** Hof vor den Toren: Koffer-Lkw am Versandtor (Rampe), Kastenwagen der Härterei am Tor Fremdbearbeitung */
  function buildYard(b, HD) {
    const P = WF.profile, door = id => P.hall.doors.find(d => d.id === id);
    const cabM = std2(0xf2f4f5, 0.3, 0.05), boxM = std2(0xe4e8eb, 0.55), ribM = std2(0xc9cfd4, 0.5, 0.3);
    const winM = new THREE.MeshStandardMaterial({ color: 0x0c141b, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.7 });
    const headM = new THREE.MeshBasicMaterial({ color: 0xfff3dc, toneMapped: false }), tailM = new THREE.MeshBasicMaterial({ color: 0xb8241c, toneMapped: false });
    const vanM = std2(0x7d8a94, 0.32, 0.25);
    for (const m of [cabM, boxM, ribM, winM, vanM]) m.userData.batch = true;
    let bb = b;   // aktueller Builder (Lkw direkt in die Halle, Kastenwagen in eine eigene, gedrehte Gruppe)
    const wheel = (x, z, r, w, side) => {
      const x0 = side < 0 ? x - w : x;
      bb.cylX(M.rubber, r, w, x0, r, z, 22);
      bb.cylX(M.alu, r * 0.56, 0.02, side < 0 ? x0 - 0.01 : x0 + w - 0.01, r, z, 18);
      bb.cylX(M.darker, r * 0.2, 0.03, side < 0 ? x0 - 0.02 : x0 + w - 0.01, r, z, 10);
    };
    const glassSlope = (cx, w, z1, y1, z2, y2, y0, zc) => {   // dünne Scheibe parallel zur Schräge (Profil in z/y)
      const dz = z2 - z1, dy = y2 - y1, l = Math.hypot(dz, dy), nz = dy / l * 0.025, ny = -dz / l * 0.025;
      const key = ['gl', z1, y1, z2, y2].map(v => typeof v === 'number' ? v.toFixed(2) : v).join('_');
      bb.side(winM, key, [[z1, y1], [z2, y2], [z2 + nz, y2 + ny], [z1 + nz, y1 + ny]], w, cx, y0, zc);
    };
    // ---- Koffer-Lkw (7,5 t), Heck an der Versandrampe
    const dv = door('D-VS');
    if (dv) {
      const cx = dv.x + dv.w / 2, z0 = HD + 0.75, W = 2.48, BL = 6.3, BH = 2.55, BY = 1.18;
      b.add(gPlaneY(), M.blob, xf(cx, -0.02, z0 + 4.4, 0, 0, 0, W + 1.2, 1, 9.8));
      b.box(M.darker, 0.95, 0.26, 8.4, cx, 0.6, z0 + 4.4);                                  // Rahmen
      b.rbox(boxM, W, BH, BL, 0.04, cx, BY, z0 + BL / 2);                                  // Koffer
      for (let z = z0 + 0.35; z < z0 + BL - 0.2; z += 0.62) for (const sx of [-1, 1]) b.box(ribM, 0.02, BH - 0.12, 0.06, cx + sx * (W / 2 + 0.005), BY + 0.06, z);
      b.box(M.alu, W + 0.04, 0.09, BL + 0.02, cx, BY - 0.02, z0 + BL / 2); b.box(M.alu, W + 0.04, 0.07, BL + 0.02, cx, BY + BH - 0.05, z0 + BL / 2);
      b.box(M.accent, W + 0.012, 0.16, BL - 0.2, cx, BY + 0.2, z0 + BL / 2);
      b.box(M.alu, W + 0.04, BH, 0.06, cx, BY, z0 - 0.01);                                  // Heckportal
      b.box(ribM, W - 0.16, BH - 0.16, 0.02, cx, BY + 0.08, z0 - 0.045);
      b.box(M.darker, 0.03, BH - 0.18, 0.03, cx, BY + 0.09, z0 - 0.06);
      for (const sx of [-1, 1]) { for (const y of [0.35, 1.25, 2.15]) b.box(M.steelDark, 0.12, 0.05, 0.03, cx + sx * 1.05, BY + y, z0 - 0.06); b.box(M.steelDark, 0.025, BH - 0.3, 0.025, cx + sx * 0.45, BY + 0.15, z0 - 0.07); }
      b.box(M.darker, W - 0.2, 0.1, 0.12, cx, 0.42, z0 + 0.05);                              // Unterfahrschutz
      for (const sx of [-1, 1]) { b.box(tailM, 0.32, 0.11, 0.04, cx + sx * 0.98, 0.78, z0 - 0.03); b.box(M.darker, W * 0.5 - 0.15, 0.32, 0.03, cx + sx * 0.62, 0.42, z0 + 1.6); }
      // Räder: Hinterachse zwillingsbereift, Vorderachse einfach
      for (const sx of [-1, 1]) {
        wheel(cx + sx * 0.66, z0 + 2.1, 0.46, 0.56, sx);
        b.rbox(M.darker, 0.66, 0.06, 1.25, 0.03, cx + sx * 0.97, 0.98, z0 + 2.1);
        wheel(cx + sx * 0.92, z0 + 7.45, 0.46, 0.3, sx);
      }
      // Fahrerhaus
      const zc = z0 + BL + 0.12, cw = 2.36;
      b.side(cabM, 'lkwcab', [[0, 0], [2.08, 0], [2.12, 1.2, 0.05], [2.02, 2.06, 0.22], [1.6, 2.22, 0.2], [0, 2.22, 0.06]], cw, cx, 0.72, zc, 0, 0.03);
      b.side(M.darker, 'lkwcabb', [[0, 0], [2.14, 0], [2.14, 0.34], [0, 0.34]], cw + 0.02, cx, 0.62, zc);
      glassSlope(cx, cw - 0.22, 2.115, 1.32, 2.03, 2.0, 0.72, zc);
      for (const sx of [-1, 1]) b.box(winM, 0.02, 0.62, 0.95, cx + sx * (cw / 2 + 0.004), 2.02, zc + 1.45);
      b.box(M.darker, 1.5, 0.42, 0.03, cx, 1.02, zc + 2.12); for (let i = 0; i < 4; i++) b.box(M.steelDark, 1.4, 0.03, 0.035, cx, 1.08 + i * 0.09, zc + 2.125);
      for (const sx of [-1, 1]) { b.box(headM, 0.34, 0.13, 0.03, cx + sx * 0.88, 1.04, zc + 2.13); b.box(M.black, 0.05, 0.34, 0.14, cx + sx * 1.32, 2.0, zc + 1.92); b.box(M.black, 0.16, 0.025, 0.025, cx + sx * 1.24, 2.2, zc + 1.9); }
      b.box(M.darker, 2.42, 0.3, 0.2, cx, 0.5, zc + 2.06);
      b.box(M.accent, cw + 0.01, 0.1, 2.02, cx, 1.62, zc + 1.0);
      b.rbox(cabM, 1.9, 0.35, 1.2, 0.15, cx, 2.94, zc + 0.6);                              // Dachspoiler
    }
    // ---- Kastenwagen (Härterei-Abholung), längs vor der Fassade neben dem Tor Fremdbearbeitung
    const de = door('D-EXT');
    if (de) {
      const vg = new THREE.Group(), vb = new Builder(); bb = vb;
      const cx = 0, z0 = 0, W = 2.0;
      vb.add(gPlaneY(), M.blob, xf(cx, 0.03, z0 + 2.95, 0, 0, 0, W + 0.9, 1, 6.6));
      vb.side(vanM, 'van', [[0, 0], [5.95, 0], [6.0, 0.5, 0.08], [5.7, 0.9, 0.2], [4.55, 1.98, 0.32], [4.1, 2.16, 0.2], [0, 2.16, 0.1]], W, cx, 0.36, z0, 0, 0.03);
      vb.side(M.darker, 'vanb', [[0, 0], [6.02, 0], [6.02, 0.3], [0, 0.3]], W + 0.02, cx, 0.24, z0);
      glassSlope(cx, W - 0.18, 5.62, 0.98, 4.6, 1.93, 0.36, z0);
      for (const sx of [-1, 1]) {
        vb.box(winM, 0.02, 0.58, 0.85, cx + sx * (W / 2 + 0.004), 1.12, z0 + 4.55);
        vb.box(M.darker, 0.02, 0.02, 3.4, cx + sx * (W / 2 + 0.004), 0.95, z0 + 2.3);
        vb.box(headM, 0.26, 0.1, 0.03, cx + sx * 0.7, 0.84, z0 + 6.02);
        vb.box(tailM, 0.1, 0.36, 0.03, cx + sx * 0.88, 1.0, z0 - 0.02);
        vb.box(M.black, 0.05, 0.22, 0.12, cx + sx * 1.1, 1.3, z0 + 4.6);
        wheel(cx + sx * 0.77, z0 + 1.15, 0.34, 0.24, sx); wheel(cx + sx * 0.77, z0 + 4.95, 0.34, 0.24, sx);
      }
      vb.box(M.darker, 0.02, 1.75, 0.02, cx, 0.42, z0 - 0.012);
      vb.box(M.darker, W - 0.1, 0.18, 0.08, cx, 0.3, z0 + 6.0); vb.box(M.orange, W + 0.01, 0.1, 4.4, cx, 1.42, z0 + 2.2);
      vb.build(vg);
      vg.position.set(de.x - 0.9, -0.04, HD + 2.6); vg.rotation.y = -PI / 2;
      R.scene.add(vg);
      bb = b;
    }
  }
  function std2(c, r, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.6 : r, metalness: m || 0 }); }

  // ================================================================== Maschinen – gemeinsame Baugruppen (lokal: +z = Bedienseite)
  const TYPE_H = { saw: 2.6, lathe: 3.4, swiss: 1.95, biglathe: 2.9, deephole: 1.9, hobber: 2.75, mill5: 3.0, mill3: 2.7, cylgrinder: 2.35, surfgrinder: 2.2, washer: 2.4, cmm: 2.8, assembly: 2.2 };
  const FACE_RY = { S: 0, N: PI, W: -PI / 2, E: PI / 2 };
  /** Zylinder entlang der Blickrichtung ry (lokale +z gedreht), Start bei (x,y,z) */
  Builder.prototype.cylF = function (mat, r, len, x, y, z, ry, seg) { return this.add(gCyl(seg || 16), mat, xf(x, y, z, PI / 2, ry || 0, 0, r, len, r)); };
  /** Kasten mit Gier ry und Neigung tilt um die lokale x-Achse (Bodenmitte bei x,y,z) */
  Builder.prototype.tilt = function (mat, w, h, d, x, y, z, ry, tl) { return this.add(gBoxC(), mat, xf(x, y, z, tl || 0, ry || 0, 0, w, h, d)); };

  /** Bedienpult mit Bildschirm, Tastenfeld und Not-Halt; Unterkante bei y, Front zeigt nach ry */
  function hmi(b, x, y, z, ry, o) {
    o = o || {};
    const s = o.s || 1, w = 0.58 * s, h = 0.74 * s, d = 0.11;
    b.add(gRBox(w, h, d, 0.035, 0.012), M.black, xf(x, y, z, 0, ry, 0));
    const f = (lx, ly, lz) => { const [ox, oz] = rotXZ(lx, lz, ry); return [x + ox, y + ly, z + oz]; };
    let p = f(0, h * 0.62, d / 2 + 0.002); b.add(gBoxC(), o.screen || M.screen, xf(p[0], p[1], p[2], 0, ry, 0, w * 0.84, h * 0.5, 0.004));
    p = f(0, h * 0.62, d / 2 + 0.001); b.add(gBoxC(), M.screenFrame, xf(p[0], p[1], p[2], 0, ry, 0, w * 0.9, h * 0.56, 0.003));
    p = f(0, h * 0.17, d / 2 + 0.04); b.add(gBoxC(), M.darker, xf(p[0], p[1], p[2], -0.55, ry, 0, w * 0.92, 0.035, 0.16));
    for (let i = 0; i < 6; i++) { p = f(-w * 0.36 + i * w * 0.12, h * 0.19, d / 2 + 0.07); b.add(gBoxC(), i === 5 ? M.green : M.mid, xf(p[0], p[1], p[2], -0.55, ry, 0, 0.045, 0.012, 0.035)); }
    p = f(w * 0.36, h * 0.3, d / 2); b.cylF(M.yellow, 0.05, 0.012, p[0], p[1], p[2], ry, 18); p = f(w * 0.36, h * 0.3, d / 2 + 0.012); b.cylF(M.red, 0.03, 0.035, p[0], p[1], p[2], ry, 14);
    if (o.handwheel) { p = f(-w * 0.32, h * 0.31, d / 2); b.cylF(M.steelDark, 0.045, 0.03, p[0], p[1], p[2], ry, 16); }
  }
  /** Schwenkarm: senkrechtes Rohr an der Maschine, waagrechter Ausleger zum Pult */
  function swivelArm(b, x0, z0, y0, y1, x1, z1) {
    b.cyl(M.steelDark, 0.045, y1 - y0, x0, y0, z0, 12);
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    b.cylF(M.steelDark, 0.04, len, x0, y1, z0, ry, 12);
    b.cyl(M.dark, 0.06, 0.08, x0, y1 - 0.04, z0, 14); b.cyl(M.dark, 0.06, 0.08, x1, y1 - 0.04, z1, 14);
  }
  /** Schaltschrank mit Kühlgerät; Front zeigt nach ry */
  function elCab(b, x, z, w, h, d, ry, o) {
    o = o || {};
    if (!ry && z < 0) ry = PI;   // Schaltschrank hinter der Maschine: Türen zeigen nach außen
    b.add(gRBox(w, h, d, 0.025, 0.01), o.mat || M.paint, xf(x, 0.1, z, 0, ry, 0));
    b.add(gRBox(w + 0.04, 0.1, d + 0.04, 0.02), M.dark, xf(x, 0, z, 0, ry, 0));
    const f = (lx, ly, lz) => { const [ox, oz] = rotXZ(lx, lz, ry); return [x + ox, ly, z + oz]; };
    const doors = w > 1.1 ? 2 : 1;
    for (let i = 1; i < doors; i++) { const p = f(-w / 2 + i * w / doors, 0.12, d / 2 + 0.003); b.add(gBoxC(), M.darker, xf(p[0], 0.1 + h / 2, p[2], 0, ry, 0, 0.012, h - 0.12, 0.006)); }
    for (let i = 0; i < doors; i++) { const p = f(-w / 2 + (i + 0.82) * w / doors, 0, d / 2 + 0.02); b.add(gBoxC(), M.darker, xf(p[0], 0.1 + h * 0.55, p[2], 0, ry, 0, 0.03, 0.16, 0.03)); }
    let p = f(-w / 2 + 0.16, 0, d / 2 + 0.004); b.add(gBoxC(), M.yellow, xf(p[0], 0.1 + h - 0.22, p[2], 0, ry, 0, 0.1, 0.09, 0.004));
    if (o.cool !== false) { p = f(o.coolX != null ? o.coolX : w * 0.18, 0, d / 2 + 0.06); b.add(gRBox(0.42, 0.55, 0.12, 0.02), M.paintW, xf(p[0], 0.1 + h - 0.85, p[2], 0, ry, 0)); for (let i = 0; i < 5; i++) { p = f(o.coolX != null ? o.coolX : w * 0.18, 0, d / 2 + 0.122); b.add(gBoxC(), M.darker, xf(p[0], 0.1 + h - 0.78 + i * 0.075, p[2], 0, ry, 0, 0.32, 0.02, 0.004)); } }
  }
  /** Rückwand-Details (Fläche bei z, Blick nach -z): Paneelfugen, Griffe, Lüftungsgitter, Warnschild */
  function backDetail(b, x0, x1, y0, y1, z) {
    const W = x1 - x0, n = Math.max(2, Math.round(W / 1.0)), pw = W / n, ph = y1 - y0;
    for (let i = 1; i < n; i++) b.box(M.darker, 0.012, ph, 0.006, x0 + i * pw, y0, z);
    b.box(M.darker, W - 0.1, 0.012, 0.006, (x0 + x1) / 2, y0 + ph * 0.6, z);
    for (let i = 0; i < n; i++) b.box(M.darker, 0.025, 0.14, 0.03, x0 + (i + 0.84) * pw, y0 + ph * 0.32, z - 0.012);
    for (const k of n > 3 ? [0, n - 2] : [0]) {
      const vx = x0 + (k + 0.5) * pw, vy = y0 + ph * 0.7;
      b.box(M.darker, Math.min(0.5, pw * 0.6), 0.28, 0.008, vx, vy, z - 0.001);
      for (let i = 0; i < 4; i++) b.box(M.mid, Math.min(0.46, pw * 0.56), 0.016, 0.01, vx, vy + 0.04 + i * 0.06, z - 0.005);
    }
    b.box(M.yellow, 0.1, 0.09, 0.004, x0 + pw * 1.3, y0 + ph * 0.78, z - 0.001);
  }
  /** Kühlmittel-/Hydraulikaggregat: Tank mit Pumpe und Filter */
  function coolTank(b, x, z, w, d, h, ry) {
    b.add(gRBox(w, h, d, 0.04, 0.012), M.oilUnit, xf(x, 0, z, 0, ry, 0));
    const f = (lx, lz) => { const [ox, oz] = rotXZ(lx, lz, ry); return [x + ox, z + oz]; };
    let p = f(-w * 0.25, 0); b.cyl(M.steelDark, 0.11, 0.3, p[0], h, p[1], 16); b.cyl(M.dark, 0.13, 0.08, p[0], h + 0.3, p[1], 16);
    p = f(w * 0.22, d * 0.1); b.cyl(M.paintW, 0.09, 0.42, p[0], h, p[1], 14);
    p = f(w * 0.42, 0); b.box(M.darker, 0.01, h * 0.5, d * 0.3, p[0] + 0.0, h * 0.2, p[1], ry);
  }
  /** Späneförderer (schräg ansteigend) mit Spänewagen am Abwurf; Richtung ry = Förderrichtung */
  function chipConv(b, x, z, len, ry, h) {
    const hh = h || 1.0, f = (lx, lz) => { const [ox, oz] = rotXZ(lx, lz, ry); return [x + ox, z + oz]; };
    let p = f(0, len * 0.35); b.add(gBoxC(), M.dark, xf(p[0], 0.2, p[1], 0, ry, 0, 0.46, 0.4, len * 0.7));
    const sl = Math.hypot(len * 0.4, hh - 0.2), tl = Math.atan2(hh - 0.2, len * 0.4);
    p = f(0, len * 0.7 + len * 0.2); b.add(gBoxC(), M.dark, xf(p[0], 0.4 + (hh - 0.2) / 2, p[1], -tl, ry, 0, 0.46, 0.34, sl));
    p = f(0, len * 0.7 + len * 0.42); b.add(gBoxC(), M.darker, xf(p[0], hh + 0.12, p[1], 0, ry, 0, 0.5, 0.36, 0.3));
    p = f(0, len * 0.7 + len * 0.45); chipCart(b, p[0], p[1], ry);
  }
  function chipCart(b, x, z, ry) {
    b.add(gRBox(0.72, 0.5, 0.56, 0.06, 0.02), M.oilUnit, xf(x, 0.12, z, 0, ry, 0));
    for (const [lx, lz] of [[-0.27, -0.2], [0.27, -0.2], [-0.27, 0.2], [0.27, 0.2]]) { const [ox, oz] = rotXZ(lx, lz, ry); b.cyl(M.rubber, 0.055, 0.12, x + ox, 0, z + oz, 10); }
    b.add(gBoxC(), M.steelDark, xf(x, 0.6, z, 0, ry, 0, 0.66, 0.05, 0.5));
    for (let i = 0; i < 9; i++) { const [ox, oz] = rotXZ(-0.25 + (i % 3) * 0.25, -0.15 + Math.floor(i / 3) * 0.15, ry); b.add(gBoxC(), M.steel, xf(x + ox, 0.64, z + oz, 0.4 * (i % 2), ry + i, 0, 0.12, 0.03, 0.05)); }
  }
  /** Fenster: Rahmen (schwarz), Rauchglas – Front zeigt nach +z (lokal), Unterkante y0 */
  function windowPane(b, cx, y0, z, w, h, frameMat) {
    const fm = frameMat || M.black, t = 0.045;
    b.box(fm, w + 2 * t, t, 0.035, cx, y0 - t, z); b.box(fm, w + 2 * t, t, 0.035, cx, y0 + h, z);
    b.box(fm, t, h, 0.035, cx - w / 2 - t / 2, y0, z); b.box(fm, t, h, 0.035, cx + w / 2 + t / 2, y0, z);
    b.box(M.glass, w, h, 0.01, cx, y0, z + 0.005);
  }
  /** Signalsäule (3 Leuchtsegmente: unten grün, Mitte Zustand, oben rot); je Maschine eigene Materialien */
  function tower(mo, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const b = new Builder();
    b.box(M.dark, 0.09, 0.03, 0.09, 0, 0, 0); b.cyl(M.steelDark, 0.014, 0.2, 0, 0.03, 0, 10); b.cyl(M.black, 0.045, 0.05, 0, 0.21, 0, 18);
    b.cyl(M.black, 0.045, 0.028, 0, 0.26 + 3 * 0.082, 0, 18);
    b.build(g);
    const base = [0x1d4a33, 0x5e4a14, 0x5e2020];
    const mats = base.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, metalness: 0, emissive: 0x000000, emissiveIntensity: 0, transparent: true, opacity: 0.94 }));
    mats.forEach((m, i) => { const s = mesh(gCyl(18), m, 0, 0.26 + i * 0.082, 0, 0.041, 0.078, 0.041); s.castShadow = false; s.renderOrder = 2; g.add(s); });
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.glowT, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
    halo.scale.set(1.0, 1.0, 1); halo.renderOrder = 6; g.add(halo);
    mo.group.add(g);
    mo.tower = { g, mats, base, halo, lit: -2 };
  }
  /** Gehäuse mit Arbeitsraum, Fensterausschnitt und Schiebetür. Lokal: Breite x0..x1, Tiefe zb..zf (Front +z).
      o: { x0,x1, zb, zf, h, r (Rundung oben vorne), pl (Sockelhöhe), intD (Tiefe Arbeitsraum), win:{x0,x1,y0,y1}, slide (±1), paint } */
  function cabin(mo, b, o) {
    const t = 0.05, pl = o.pl == null ? 0.2 : o.pl, Pm = o.paint || mo.mPaint, r = o.r == null ? 0.18 : o.r;
    const { x0, x1, zb, zf, h } = o, zi = zf - o.intD, W = x1 - x0, cx = (x0 + x1) / 2, key = mo.id + '|cab';
    // Sockel
    b.add(gRBox(W + 0.06, pl, zf - zb + 0.06, 0.05, 0.01), M.dark, xf(cx, 0, (zb + zf) / 2));
    b.box(M.black, W - 0.1, 0.012, 0.01, cx, pl * 0.5, zf + 0.031);
    // Rückteil (massiv) mit gerundeter Oberkante hinten
    b.side(Pm, key + 'back', [[zb, pl], [zi, pl], [zi, h], [zb, h, 0.06]], W, cx, 0, 0, 0, 0.012);
    // Seitenwände des Arbeitsraums mit Profil (Rundung oben vorne)
    const sideP = [[zi - 0.01, pl], [zf, pl], [zf, h, r], [zi - 0.01, h]];
    b.side(Pm, key + 'side', sideP, t, x0 + t / 2, 0, 0, 0, 0.008);
    b.side(Pm, key + 'side', sideP, t, x1 - t / 2, 0, 0, 0, 0.008);
    // Dach als Schale entlang der Rundung
    const yEnd = Math.max(o.win.y1 + 0.12, h - r - 0.02);
    const shell = [[zi - 0.01, h - t], [zi - 0.01, h], [zf, h, r], [zf, yEnd], [zf - t, yEnd], [zf - t, h - t, Math.max(0.01, r - t)]];
    b.side(Pm, key + 'roof|' + yEnd.toFixed(3), shell, W - 2 * t + 0.002, cx, 0, 0, 0, 0);
    // Front um den Fensterausschnitt
    const W0 = o.win.x0, W1 = o.win.x1, wy0 = o.win.y0, wy1 = o.win.y1, m = 0.06;
    b.box(Pm, W - 2 * t, wy0 - m - pl, t, cx, pl, zf - t / 2);
    if (yEnd - (wy1 + m) > 0.005) b.box(Pm, W - 2 * t, yEnd - (wy1 + m), t, cx, wy1 + m, zf - t / 2);
    if (W0 - m - (x0 + t) > 0.005) b.box(Pm, W0 - m - (x0 + t), wy1 - wy0 + 2 * m, t, (x0 + t + W0 - m) / 2, wy0 - m, zf - t / 2);
    if ((x1 - t) - (W1 + m) > 0.005) b.box(Pm, (x1 - t) - (W1 + m), wy1 - wy0 + 2 * m, t, (W1 + m + x1 - t) / 2, wy0 - m, zf - t / 2);
    // Arbeitsraum (Auskleidung leuchtet bei Produktion), Wannenboden, Späneschräge
    const inn = mo.inner, iw = W - 2 * t - 0.01, ic = (zi + zf - t) / 2, idp = zf - t - zi;
    b.box(inn, iw, h - pl - 0.12, 0.02, cx, pl + 0.04, zi + 0.012);
    b.box(inn, 0.015, h - pl - 0.15, idp, x0 + t + 0.008, pl + 0.04, ic);
    b.box(inn, 0.015, h - pl - 0.15, idp, x1 - t - 0.008, pl + 0.04, ic);
    b.box(inn, iw, 0.015, idp, cx, h - t - 0.03, ic);
    b.tilt(M.steelDark, iw, 0.03, idp * 0.7, cx, wy0 - 0.22, ic + idp * 0.1, 0, 0.32);
    b.box(M.steelDark, iw, 0.03, idp, cx, pl + 0.02, ic);
    // Rückseite: Servicepaneele mit Fugen und Griffen, Lüftungsgitter, Warnschild; auf dem Dach ein Ölnebelabscheider
    { const n = Math.max(2, Math.round(W / 0.95)), pw = W / n, bz = zb - 0.003, ph = h - pl - 0.2;
      for (let i = 1; i < n; i++) b.box(M.darker, 0.012, ph, 0.006, x0 + i * pw, pl + 0.06, bz);
      b.box(M.darker, W - 0.12, 0.012, 0.006, cx, pl + ph * 0.62, bz);
      for (let i = 0; i < n; i++) b.box(M.darker, 0.025, 0.14, 0.03, x0 + (i + 0.84) * pw, pl + ph * 0.36, zb - 0.015);
      const vx = x0 + pw * 0.5, vy = pl + ph * 0.74;
      b.box(M.darker, Math.min(0.5, pw * 0.6), 0.3, 0.008, vx, vy, zb - 0.004);
      for (let i = 0; i < 5; i++) b.box(M.mid, Math.min(0.46, pw * 0.56), 0.016, 0.01, vx, vy + 0.035 + i * 0.055, zb - 0.008);
      b.box(M.yellow, 0.1, 0.09, 0.004, x0 + pw * (n > 2 ? 1.5 : 1.3), pl + ph * 0.8, zb - 0.004);
      if (o.mist !== false && zi - zb > 0.55) {
        const mx = x1 - Math.min(0.5, W * 0.2), mz = zb + Math.min(0.32, (zi - zb) / 2);
        b.cyl(Pm, 0.19, 0.38, mx, h - 0.01, mz, 20); b.cyl(M.dark, 0.2, 0.05, mx, h + 0.37, mz, 20); b.cyl(M.darker, 0.07, 0.06, mx, h + 0.42, mz, 12);
        b.box(M.darker, 0.12, 0.12, 0.3, mx - 0.28, h - 0.01, mz); b.box(M.darker, 0.2, 0.06, 0.06, mx - 0.18, h + 0.08, mz);
      } }
    // Akzentleiste + Typenschild-Fläche
    b.box(M.accent, W - 0.2, 0.045, 0.012, cx, Math.min(h - r - 0.08, yEnd - 0.06), zf + 0.004);
    b.box(M.black, 0.42, 0.11, 0.008, x0 + 0.38, Math.min(h - r - 0.2, yEnd - 0.2), zf + 0.004);
    // Schiebetür(en) mit Fenster – breite Fenster: zwei gegenläufige Flügel
    const dwAll = (W1 - W0) + 0.16, dh = (wy1 - wy0) + 0.16, ft = 0.04;
    const mkDoor = (dw, x, slide, hs) => {
      const door = new THREE.Group(), db = new Builder();
      db.box(Pm, dw, 0.08, ft, 0, 0, 0); db.box(Pm, dw, 0.08, ft, 0, dh - 0.08, 0);
      db.box(Pm, 0.08, dh - 0.16, ft, -dw / 2 + 0.04, 0.08, 0); db.box(Pm, 0.08, dh - 0.16, ft, dw / 2 - 0.04, 0.08, 0);
      db.box(M.glass, dw - 0.14, dh - 0.14, 0.012, 0, 0.07, 0.01);
      db.box(M.black, dw - 0.13, 0.025, 0.014, 0, 0.065, 0.012); db.box(M.black, dw - 0.13, 0.025, 0.014, 0, dh - 0.09, 0.012);
      db.box(M.chrome, 0.03, Math.min(0.5, dh * 0.42), 0.05, hs * (dw / 2 - 0.12), dh * 0.3, 0.035);
      db.build(door, true);
      door.position.set(x, wy0 - 0.08, zf + 0.03);
      mo.group.add(door);
      return { obj: door, x0: x, slide };
    };
    const parts = [];
    if (o.split) { const hw = dwAll / 2, c0 = (W0 + W1) / 2; parts.push(mkDoor(hw + 0.02, c0 - hw / 2, -hw * 0.62, 1), mkDoor(hw + 0.02, c0 + hw / 2, hw * 0.62, -1)); }
    else { const s = o.slide || 1, room = s > 0 ? (x1 - 0.05) - W1 : W0 - (x0 + 0.05); parts.push(mkDoor(dwAll, (W0 + W1) / 2, s * Math.max(Math.min(dwAll * 0.86, room + dwAll * 0.45), dwAll * 0.5), s > 0 ? -1 : 1)); }
    b.box(M.steelDark, W - 0.1, 0.03, 0.05, cx, wy1 + 0.1, zf + 0.04); // Führungsschiene
    mo.door = { parts, f: 0 };
    return { zf, zi, zb, x0, x1, cx, floorY: wy0 - 0.2, wy0, wy1, ic, idp };
  }
  /** Tablet-Marker (Anbindung Level 0: Rückmeldung per Tablet) */
  function tabletOn(mo, x, y, z, ry) {
    const g = grp(x, y, z); g.rotation.y = ry;
    const body = mesh(gBoxC(), M.darker, 0, 0, 0, 0.3, 0.21, 0.018); body.rotation.x = -0.35; g.add(body);
    const mat = M.tabletScreen.clone();
    const scr = mesh(gBoxC(), mat, 0, 0.004, 0.011, 0.26, 0.17, 0.002); scr.rotation.x = -0.35; g.add(scr);
    mo.group.add(g);
    return { g, mat, flash: 0 };
  }
  /** Bodenleuchten (Zustandsrahmen um die Aufstellfläche) – Shader mit weichem Verlauf */
  function glowFrame(w, d, width, r) {
    const pts = [], seg = 6, hw = w / 2, hd = d / 2;
    const corners = [[hw - r, hd - r, 0], [-hw + r, hd - r, PI / 2], [-hw + r, -hd + r, PI], [hw - r, -hd + r, PI * 1.5]];
    for (const [cx, cz, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
    const n = pts.length, pos = new Float32Array(n * 3 * 3), e = new Float32Array(n * 3), idx = [];
    pts.forEach(([x, z, nx, nz], i) => { pos.set([x - nx * 0.06, 0, z - nz * 0.06], i * 9); pos.set([x, 0, z], i * 9 + 3); pos.set([x + nx * width, 0, z + nz * width], i * 9 + 6); e[i * 3] = -1; e[i * 3 + 1] = 0; e[i * 3 + 2] = 1; });
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = i * 3 + k + 1, c = j * 3 + k, dd = j * 3 + k + 1; idx.push(a, c, b, b, c, dd); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('e', new THREE.BufferAttribute(e, 1)); g.setIndex(idx);
    return g;
  }
  function glowMat() {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uI: { value: 0.5 } },
      vertexShader: 'attribute float e; varying float vE; void main(){ vE = e; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uI; varying float vE; void main(){ float o = max(vE, 0.0); float a = pow(1.0 - o, 2.6) * 0.5 + (1.0 - smoothstep(0.0, 0.05, abs(vE))) * 0.75; if (vE < 0.0) a = (1.0 + vE) * 0.75; gl_FragColor = vec4(uColor * (1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.06, abs(vE)))), a * uI); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false,
    });
  }

  // ================================================================== Maschinen je Typ (lokal, Front = +z, Breite W, Tiefe D)
  const TB = {};

  // ---------- Bandsägeautomat (Bügel fährt beim Schnitt nach unten, Band läuft) ----------
  TB.saw = (mo, b) => {
    const zc = -0.15, top = 0.86, P = mo.mPaint;
    // Zuführ-Rollenbahn mit Stangenmagazin
    b.box(M.dark, 2.75, 0.1, 0.06, -1.8, 0.74, zc - 0.33); b.box(M.dark, 2.75, 0.1, 0.06, -1.8, 0.74, zc + 0.33);
    for (const x of [-3.05, -2.05, -1.05]) { for (const s of [-1, 1]) b.box(M.dark, 0.07, 0.74, 0.07, x, 0, zc + s * 0.33); b.box(M.dark, 0.07, 0.06, 0.72, x, 0.2, zc); }
    for (let x = -3.1; x <= -0.55; x += 0.28) b.cylZ(M.steel, 0.042, 0.6, x, 0.83, zc - 0.3, 14);
    for (const x of [-2.9, -1.95, -1.0]) { b.tilt(M.dark, 0.07, 0.07, 1.25, x, 0.86, zc - 1.05, 0, -0.1); b.box(M.dark, 0.07, 0.86, 0.07, x, 0, zc - 1.62); b.box(M.yellow, 0.07, 0.12, 0.07, x, 0.86, zc - 1.62); }
    // Maschinenständer, Tisch, Spannstock
    b.rbox(M.dark, 1.75, 0.78, 2.1, 0.06, 0.45, 0, -0.2, 0, 0.012);
    b.rbox(P, 1.68, 0.08, 2.0, 0.03, 0.45, 0.78, -0.2, 0, 0.01);
    b.box(M.accent, 1.6, 0.04, 0.01, 0.45, 0.6, 0.86);
    for (const s of [-1, 1]) { b.rbox(M.steelDark, 0.34, 0.26, 0.18, 0.03, 0.35, top, zc + s * 0.36); b.box(M.dark, 0.2, 0.12, 0.3, 0.35, top + 0.07, zc + s * 0.62); }
    b.cyl(M.chrome, 0.065, 1.95, -0.25, top, -1.2, 18); b.cyl(M.chrome, 0.065, 1.95, 1.1, top, -1.2, 18);
    b.rbox(P, 1.6, 0.24, 0.3, 0.05, 0.42, top + 1.95, -1.2, 0, 0.012);
    b.cyl(M.steelDark, 0.07, 1.25, 0.42, top + 0.65, -1.05, 14); b.cyl(M.chrome, 0.03, 0.6, 0.42, top + 0.1, -1.05, 10);
    // Abfuhr-Rutsche (geschnittene Stücke rutschen nach vorne zum Ausgang)
    b.box(M.dark, 1.5, 0.08, 0.7, 2.0, 0.72, zc); for (let x = 1.35; x <= 2.7; x += 0.28) b.cylZ(M.steel, 0.042, 0.6, x, 0.81, zc - 0.3, 14);
    for (const x of [1.3, 2.7]) for (const s of [-1, 1]) b.box(M.dark, 0.07, 0.72, 0.07, x, 0, zc + s * 0.3);
    b.tilt(M.steelDark, 0.8, 0.04, 1.0, 1.95, 0.62, 0.62, 0, 0.42); b.box(M.steelDark, 0.04, 0.2, 1.0, 1.55, 0.52, 0.6); b.box(M.steelDark, 0.04, 0.2, 1.0, 2.35, 0.52, 0.6);
    // Hydraulik, Schaltschrank, Bedienpult, Späne
    coolTank(b, 1.55, -1.95, 0.85, 0.55, 0.62, 0);
    elCab(b, 2.65, -2.05, 0.95, 1.85, 0.45, 0);
    b.cyl(M.dark, 0.05, 0.95, 1.5, 0, 1.55, 10); b.box(M.dark, 0.32, 0.03, 0.32, 1.5, 0, 1.55);
    hmi(b, 1.5, 0.92, 1.55, -0.35, { s: 0.85 });
    chipCart(b, 0.15, 1.45, 0);
    // Sägebügel (bewegt sich) mit Bandrad-Gehäusen
    const bow = grp(0.42, top + 0.6, zc), bb = new Builder();
    bb.rbox(P, 0.44, 0.46, 2.15, 0.12, 0, 0.1, -0.2, 0, 0.015);
    bb.cylX(P, 0.44, 0.5, -0.25, 0.4, -1.25, 32); bb.cylX(P, 0.44, 0.5, -0.25, 0.4, 0.85, 32);
    bb.cylX(M.dark, 0.18, 0.4, 0.25, 0.4, -1.25, 18); bb.cylX(M.steelDark, 0.12, 0.08, 0.25, 0.4, 0.85, 18);
    bb.box(M.accent, 0.452, 0.05, 1.7, 0, 0.5, -0.2);
    for (const s of [-1, 1]) { bb.box(M.steelDark, 0.12, 0.42, 0.11, 0, -0.32, -0.15 + s * 0.48); bb.box(M.dark, 0.16, 0.08, 0.16, 0, -0.36, -0.15 + s * 0.48); }
    bb.build(bow);
    const bladeMat = M.blade.clone(); bladeMat.map = texStripes('#e2e8ec', '#7c848c', 16); bladeMat.map.wrapS = THREE.RepeatWrapping; bladeMat.map.repeat.set(10, 1);
    const blade = mesh(gBoxC(), bladeMat, 0, -0.3, -0.15, 0.012, 0.032, 1.55); blade.castShadow = false; bow.add(blade);
    mo.group.add(bow);
    // Stange auf der Zuführung + Magazin (Durchmesser je Material)
    const bar = mesh(gCylC(20), M.steel); bar.rotation.z = PI / 2; mo.group.add(bar);
    const mag = [0, 1, 2, 3].map(() => { const m = mesh(gCylC(16), M.steelDark); m.rotation.z = PI / 2; mo.group.add(m); return m; });
    const piece = mesh(gCylC(18), M.steel); piece.rotation.z = PI / 2; piece.visible = false; mo.group.add(piece);
    mo.a = { bow, bladeMat, bar, mag, piece, zc, top, y0: top + 0.6 };
    tower(mo, 2.92, 1.95, -2.12);
    mo.conn = [2.55, 1.95, -2.1];
  };

  // ---------- Drehfräszentrum mit Portallader ----------
  TB.lathe = (mo, b) => {
    const c = cabin(mo, b, { x0: -3.3, x1: 1.1, zb: -1.2, zf: 1.25, h: 2.45, r: 0.48, pl: 0.22, intD: 1.3, win: { x0: -2.45, x1: 0.15, y0: 1.0, y1: 1.92 }, split: true });
    const fy = c.floorY, iz = c.ic - 0.1, ay = fy + 0.62;
    // Arbeitsraum: Spindelkasten, Hauptspindel, Gegenspindel, Revolver
    b.box(M.mid, 0.55, 0.95, 0.9, -2.95, fy, iz - 0.1); b.box(M.mid, 0.45, 0.7, 0.75, 0.75, fy, iz - 0.1);
    b.tilt(M.steelDark, 3.8, 0.04, 0.5, -1.1, fy + 0.25, iz - 0.42, 0, -0.7);
    const chuck = grp(-2.65, ay, iz), cb = new Builder();
    cb.latheX(M.chuck, 'chk1', [[0.0, 0], [0.2, 0], [0.2, 0.1], [0.17, 0.13], [0.06, 0.13], [0.06, 0.17], [0, 0.17]], 0, 0, 0, 28);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; cb.boxC(M.steelDark, 0.06, 0.06, 0.07, 0.15, Math.cos(a) * 0.1, Math.sin(a) * 0.1); }
    cb.build(chuck); mo.group.add(chuck);
    const work = mesh(gCylC(18), M.steel, 0.25, 0, 0, 0.04, 0.16, 0.04); work.rotation.z = PI / 2; chuck.add(work);
    const sub = grp(0.55, ay, iz), sb = new Builder();
    sb.latheX(M.chuck, 'chk2', [[0, 0], [0.13, 0], [0.13, 0.09], [0.04, 0.11], [0, 0.11]], 0, 0, 0, 24, -1); sb.build(sub); mo.group.add(sub);
    const tur = grp(-1.0, ay + 0.42, iz - 0.25), tb = new Builder();
    tb.latheZ(M.steelDark, 'tur', [[0, -0.12], [0.3, -0.12], [0.33, -0.06], [0.33, 0.06], [0.3, 0.12], [0, 0.12]], 0, 0, 0, 12);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; tb.boxC(M.mid, 0.08, 0.1, 0.12, Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0, 0, 0, a); tb.boxC(M.steel, 0.02, 0.12, 0.02, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0, 0, 0, a); }
    tb.build(tur); mo.group.add(tur);
    b.box(M.mid, 0.5, 0.5, 0.35, -1.0, ay + 0.75, iz - 0.42);
    // Späneförderer, Schaltschrank, Kühlmittel
    chipConv(b, -2.95, -0.5, 1.3, -PI / 2, 1.05);
    elCab(b, -1.2, -1.78, 2.1, 2.1, 0.55, 0);
    coolTank(b, 0.55, -1.75, 1.0, 0.55, 0.78, 0);
    // Ladezelle mit Rohteilpalette + Schutzzaun
    b.rbox(M.dark, 2.55, 0.8, 2.3, 0.04, 2.75, 0, 0.25, 0, 0.01);
    b.box(M.steelDark, 2.35, 0.05, 1.0, 2.75, 0.8, -0.25); b.box(M.steelDark, 2.35, 0.05, 1.0, 2.75, 0.8, 0.85);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) b.cyl(M.steel, 0.045, 0.1, 1.8 + i * 0.38, 0.85, -0.5 + j * 0.42, 12);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) b.cyl(M.chrome, 0.04, 0.14, 1.8 + i * 0.38, 0.85, 0.65 + j * 0.42, 12);
    for (const [x, z, w, d] of [[2.75, 1.42, 2.6, 0.02], [4.06, 0.25, 0.02, 2.35], [2.75, -0.93, 2.6, 0.02]]) b.box(M.fenceY, w, 1.15, d, x, 0.82, z);
    for (const [x, z] of [[1.47, 1.42], [4.06, 1.42], [4.06, -0.93], [1.47, -0.93]]) b.box(M.yellow, 0.06, 2.0, 0.06, x, 0, z);
    // Portallader: Säule rechts, Lagerbock auf dem Dach, Balken mit Laufwagen
    b.rbox(P0(mo), 0.3, 3.15, 0.36, 0.04, 3.95, 0, 0.25, 0, 0.01);
    b.rbox(P0(mo), 0.36, 0.62, 0.42, 0.04, -1.95, 2.45, 0.25, 0, 0.01);
    b.side(P0(mo), 'gantry', [[-0.18, 0], [0.18, 0], [0.18, 0.3, 0.05], [-0.18, 0.3, 0.05]], 6.3, 1.0, 3.05, 0.25, 0, 0.012);
    b.box(M.accent, 6.2, 0.04, 0.01, 1.0, 3.22, 0.435);
    b.box(M.chrome, 6.1, 0.03, 0.05, 1.0, 3.02, 0.25);
    b.box(M.dark, 6.2, 0.05, 0.12, 1.0, 3.35, 0.25);
    const car = grp(-0.4, 3.04, 0.25), crb = new Builder();
    crb.rbox(M.paintW, 0.5, 0.42, 0.55, 0.06, 0, -0.06, 0, 0, 0.012); crb.box(M.dark, 0.3, 0.12, 0.3, 0, 0.36, 0);
    crb.build(car);
    const arm = grp(0, 0, 0.2), ab = new Builder();
    ab.box(M.steel, 0.09, 1.2, 0.09, 0, -1.25, 0); ab.box(M.dark, 0.22, 0.14, 0.2, 0, -1.38, 0); ab.box(M.steelDark, 0.04, 0.12, 0.04, -0.07, -1.5, 0); ab.box(M.steelDark, 0.04, 0.12, 0.04, 0.07, -1.5, 0);
    ab.build(arm); car.add(arm); mo.group.add(car);
    const grip = mesh(gCylC(12), M.steel, 0, -1.52, 0, 0.045, 0.1, 0.045); grip.visible = false; arm.add(grip);
    // Bedienpult am Schwenkarm
    swivelArm(b, -3.15, 1.32, 1.1, 1.72, -2.7, 1.62);
    hmi(b, -2.7, 1.0, 1.62, 0.2, { handwheel: true });
    mo.a = { chuck, sub, tur, car, arm, grip, work, carX: { store: 2.4, mach: -1.0 }, loadT: null };
    tower(mo, 0.85, 2.45, -0.95);
    mo.conn = [-1.2, 2.2, -1.78];
  };
  function P0(mo) { return mo.mPaint; }

  // ---------- Langdrehautomat mit Stangenlader ----------
  TB.swiss = (mo, b) => {
    const c = cabin(mo, b, { x0: 0.55, x1: 3.15, zb: -0.75, zf: 0.82, h: 1.88, r: 0.26, pl: 0.18, intD: 0.75, win: { x0: 0.95, x1: 2.35, y0: 0.88, y1: 1.52 }, slide: 1 });
    const fy = c.floorY, iz = c.ic, ay = 1.12;
    b.box(M.mid, 0.36, 0.55, 0.5, 0.82, fy, iz - 0.1);
    b.latheX(M.chuck, 'gb', [[0, 0], [0.08, 0], [0.08, 0.06], [0.03, 0.09], [0, 0.09]], 1.0, ay, iz, 18);
    const sp = grp(1.1, ay, iz), sb = new Builder();
    sb.cylX(M.steel, 0.008, 0.1, 0, 0, 0, 8); sb.build(sp); mo.group.add(sp);
    b.box(M.steelDark, 0.5, 0.18, 0.32, 1.45, ay - 0.06, iz - 0.12);
    for (let i = 0; i < 5; i++) b.box(M.steel, 0.02, 0.08, 0.02, 1.3 + i * 0.07, ay + 0.04, iz - 0.02);
    b.latheX(M.chuck, 'sub2', [[0, 0], [0.06, 0], [0.06, 0.08], [0, 0.08]], 2.05, ay, iz, 16, -1);
    // Stangenlader: Gehäuse mit Deckel, Kanal auf Spindelhöhe, Stangenablage vorne
    const bfP = M.paintW;
    b.rbox(bfP, 3.7, 0.36, 0.58, 0.06, -1.35, 0.86, 0.15, 0, 0.012);
    b.box(M.accent, 3.6, 0.035, 0.012, -1.35, 1.1, 0.445);
    b.box(M.dark, 3.6, 0.04, 0.5, -1.35, 1.22, 0.15);
    for (const x of [-3.0, -1.35, 0.3]) { b.box(M.dark, 0.08, 0.86, 0.4, x, 0, 0.15); b.box(M.dark, 0.55, 0.05, 0.55, x, 0, 0.15); }
    b.box(M.dark, 3.4, 0.03, 0.32, -1.35, 0.98, 0.62, 0, 0.18);
    for (const x of [-2.8, -1.35, 0.1]) b.tilt(M.dark, 0.06, 0.03, 0.36, x, 0.98, 0.62, 0, 0.2);
    b.rbox(M.paintW, 0.38, 0.5, 0.48, 0.04, 0.72, 0.82, 0.15, 0, 0.01);
    b.box(M.black, 0.1, 0.16, 0.01, 0.72, 1.0, 0.395);
    // Pult, Öl/Späne, Schaltschrank
    hmi(b, 2.92, 0.88, 0.95, -0.2, { s: 0.9 });
    b.rbox(M.dark, 0.36, 0.88, 0.25, 0.03, 2.92, 0, 0.95, -0.2);
    coolTank(b, 2.1, -1.12, 1.25, 0.52, 0.55, 0);
    elCab(b, 0.95, -1.12, 0.75, 1.55, 0.4, 0, { cool: false });
    const bars = [0, 1, 2, 3, 4].map(() => { const m = mesh(gCylC(10), M.steel); m.rotation.z = PI / 2; m.castShadow = false; mo.group.add(m); return m; });
    mo.a = { sp, bars };
    tower(mo, 2.95, 1.88, -0.5);
    mo.conn = [0.95, 1.65, -1.12];
  };

  // ---------- Großdrehmaschine (Wellen) ----------
  TB.biglathe = (mo, b) => {
    const ay = 1.45, az = -0.3, P = mo.mPaint;
    b.rbox(M.dark, 8.2, 0.78, 1.75, 0.06, -0.1, 0, az, 0, 0.012);
    b.box(M.steel, 7.2, 0.05, 0.13, 0.4, 0.78, az - 0.42); b.box(M.steel, 7.2, 0.05, 0.13, 0.4, 0.78, az + 0.32);
    for (let i = 0; i < 6; i++) b.box(M.steelDark, 1.1, 0.04, 0.95, -2.2 + i * 1.12, 0.82, az, 0, 0);
    // Spindelstock links (massiv)
    b.rbox(P, 1.55, 1.95, 2.1, 0.08, -3.45, 0.2, -0.35, 0, 0.015);
    b.box(M.accent, 1.45, 0.05, 0.012, -3.45, 1.95, 0.71);
    // Rückwand, halbes Dach, Seitenwand rechts
    b.box(P, 7.6, 2.0, 0.06, 0.45, 0.78, -1.28); b.box(P, 7.6, 0.06, 1.0, 0.45, 2.75, -0.8);
    b.box(P, 0.06, 2.0, 2.0, 4.22, 0.78, -0.3); b.box(M.glass, 0.012, 0.9, 1.3, 4.25, 1.4, -0.2);
    b.box(M.accent, 7.5, 0.05, 0.012, 0.45, 2.55, -1.245);
    backDetail(b, -2.6, 4.2, 0.85, 2.72, -1.313);
    // Schiebetüren vorne (drei Felder, mittleres beweglich)
    for (const x of [-1.7, 2.6]) { b.box(P, 2.3, 0.1, 0.05, x, 0.78, 0.62); b.box(P, 2.3, 0.12, 0.05, x, 2.42, 0.62); b.box(P, 0.08, 1.6, 0.05, x - 1.11, 0.88, 0.62); b.box(P, 0.08, 1.6, 0.05, x + 1.11, 0.88, 0.62); b.box(M.glass, 2.14, 1.52, 0.012, x, 0.9, 0.63); }
    b.box(M.steelDark, 7.6, 0.05, 0.06, 0.45, 2.56, 0.64); b.box(P, 7.6, 0.2, 0.06, 0.45, 2.55, 0.64);
    const door = new THREE.Group(), db = new Builder();
    db.box(P, 2.2, 0.1, 0.05, 0, 0, 0); db.box(P, 2.2, 0.12, 0.05, 0, 1.64, 0); db.box(P, 0.08, 1.56, 0.05, -1.06, 0.1, 0); db.box(P, 0.08, 1.56, 0.05, 1.06, 0.1, 0);
    db.box(M.glass, 2.04, 1.52, 0.012, 0, 0.12, 0.01); db.box(M.chrome, 0.03, 0.5, 0.05, -0.9, 0.7, 0.04);
    db.build(door); door.position.set(0.45, 0.78, 0.69); mo.group.add(door);
    mo.door = { obj: door, x0: 0.45, slide: 2.15, f: 0 };
    // Späneförderer längs vorne, Wagen rechts
    b.box(M.darker, 7.0, 0.3, 0.42, 0.2, 0, 0.92); b.tilt(M.darker, 0.45, 0.34, 1.2, 3.95, 0.55, 0.92, PI / 2, -0.55);
    chipCart(b, 4.05, 1.75, 0);
    // Bedienplattform mit Gitterrost + Bedienpult
    b.box(M.dark, 3.6, 0.16, 0.9, -0.2, 0, 1.55); for (let i = 0; i < 18; i++) b.box(M.steelDark, 0.02, 0.012, 0.86, -1.95 + i * 0.2, 0.16, 1.55);
    b.box(M.yellow, 3.6, 0.03, 0.03, -0.2, 0.16, 2.0);
    b.cyl(M.dark, 0.06, 1.0, 0.85, 0.16, 1.35, 12); hmi(b, 0.85, 1.12, 1.35, -0.25, { handwheel: true });
    // Hydraulik/Kühlmittel, Schaltschränke
    coolTank(b, -2.2, -2.25, 1.7, 0.7, 0.92, 0);
    elCab(b, 1.3, -2.3, 1.6, 2.05, 0.6, 0); elCab(b, 3.1, -2.3, 1.6, 2.05, 0.6, 0, { cool: false });
    // Schwenkkran (gelb)
    b.cyl(M.yellow, 0.16, 4.7, -4.15, 0, -2.35, 18); b.cyl(M.darker, 0.34, 0.16, -4.15, 0, -2.35, 18);
    const jr = Math.atan2(4.0, 1.9);
    b.add(gBox(), M.yellow, xf(-4.15 + Math.sin(jr) * 2.05, 4.32, -2.35 + Math.cos(jr) * 2.05, 0, jr, 0, 0.24, 0.34, 4.1));
    b.add(gBox(), M.yellow, xf(-4.15 + Math.sin(jr) * 0.6, 3.9, -2.35 + Math.cos(jr) * 0.6, -0.65, jr, 0, 0.1, 0.1, 1.3));
    const hx = -4.15 + Math.sin(jr) * 3.0, hz = -2.35 + Math.cos(jr) * 3.0;
    b.box(M.dark, 0.32, 0.3, 0.42, hx, 4.0, hz, jr); b.cyl(M.chain, 0.012, 1.3, hx, 2.7, hz, 6); b.box(M.yellow, 0.12, 0.2, 0.06, hx, 2.5, hz);
    // Futter + Welle (drehen), Reitstock, Lünette, Bettschlitten mit Fräskopf
    const chuck = grp(-2.66, ay, az), cb = new Builder();
    cb.latheX(M.chuck, 'chkB', [[0, 0], [0.46, 0], [0.46, 0.26], [0.42, 0.3], [0.12, 0.3], [0.12, 0.36], [0, 0.36]], 0, 0, 0, 36);
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4; cb.boxC(M.steelDark, 0.15, 0.13, 0.13, 0.36, Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0, a, 0); }
    cb.build(chuck); mo.group.add(chuck);
    const work = mesh(gCylC(28), M.steel); work.rotation.z = PI / 2; chuck.add(work);
    const tail = grp(2.5, 0.78, az), tlb = new Builder();
    tlb.rbox(P, 0.95, 0.66, 1.15, 0.06, 0.25, 0, 0, 0, 0.012); tlb.latheX(M.steel, 'tailq', [[0, 0], [0.1, 0], [0.1, 0.32], [0.03, 0.46], [0, 0.46]], -0.2, ay - 0.78, 0, 18, -1);
    tlb.build(tail); mo.group.add(tail);
    const rest = grp(0.5, 0.78, az), rb = new Builder();
    rb.box(P, 0.32, 0.42, 0.95, 0, 0, 0); rb.add(new THREE.TorusGeometry(0.21, 0.05, 10, 28), P, xf(0, ay - 0.78, 0, 0, PI / 2, 0));
    rb.build(rest); mo.group.add(rest);
    const sup = grp(0, 0.82, az), sbb = new Builder();
    sbb.rbox(P, 1.15, 0.32, 1.55, 0.05, 0, 0, 0, 0, 0.01); sbb.rbox(P, 0.8, 1.25, 0.55, 0.06, 0, 0.32, -0.45, 0, 0.012);
    sbb.box(M.mid, 0.5, 0.42, 0.62, 0, 0.62, -0.05); sbb.latheY(M.steelDark, 'bhead', [[0, 0], [0.12, 0], [0.12, 0.18], [0.05, 0.25], [0, 0.25]], 0, 0.38, 0.12, 18);
    sbb.box(M.accent, 0.82, 0.04, 0.01, 0, 1.4, -0.17);
    sbb.build(sup); mo.group.add(sup);
    mo.a = { chuck, work, tail, rest, sup, ay, cx0: -2.66 };
    tower(mo, 3.95, 2.78, -1.0);
    mo.conn = [1.3, 2.15, -2.3];
  };

  // ---------- Tieflochbohrmaschine (BTA/ELB) ----------
  TB.deephole = (mo, b) => {
    const ay = 1.15, P = mo.mPaint;
    b.rbox(M.dark, 10.7, 0.62, 1.05, 0.05, 0, 0, 0.1, 0, 0.012);
    b.box(M.steel, 10.3, 0.04, 0.1, 0, 0.62, -0.25); b.box(M.steel, 10.3, 0.04, 0.1, 0, 0.62, 0.45);
    b.box(M.darker, 10.3, 0.02, 0.2, 0, 0.62, 0.1);
    // Werkstück-Spindelstock links
    b.rbox(P, 1.15, 1.2, 1.35, 0.07, -4.82, 0.62, 0.1, 0, 0.015);
    b.box(M.accent, 1.05, 0.045, 0.012, -4.82, 1.6, 0.79);
    b.cylX(M.dark, 0.22, 0.4, -5.6, 1.2, -0.2, 16);
    // Späne-/Ölschutzhaube über dem Werkstück
    const hx0 = -4.2, hx1 = -1.3, hw = hx1 - hx0, hc = (hx0 + hx1) / 2;
    b.box(P, hw, 0.05, 1.12, hc, 1.72, 0.1); b.box(M.glass, hw, 1.05, 0.012, hc, 0.67, 0.66); b.box(M.glass, hw, 1.05, 0.012, hc, 0.67, -0.46);
    for (const x of [hx0, hx0 + hw / 2, hx1]) { b.box(P, 0.05, 1.1, 0.05, x, 0.62, 0.66); b.box(P, 0.05, 1.1, 0.05, x, 0.62, -0.46); }
    b.box(M.yellow, hw, 0.03, 0.03, hc, 1.75, 0.68);
    // Bohröl-Aggregat hinten (Tank, Filter, Pumpen, Leitung zum BOZA)
    b.rbox(M.oilUnit, 3.0, 1.0, 0.95, 0.06, -3.6, 0, -1.25, 0, 0.012);
    for (const x of [-4.6, -4.15]) { b.cyl(M.paintW, 0.15, 0.5, x, 1.0, -1.25, 18); b.cyl(M.dark, 0.17, 0.06, x, 1.5, -1.25, 18); }
    b.cyl(M.steel, 0.2, 0.62, -3.4, 1.0, -1.3, 18); b.cyl(M.dark, 0.13, 0.35, -2.75, 1.0, -1.25, 14);
    b.tube(M.steelDark, [[-3.4, 1.62, -1.3], [-3.4, 1.9, -1.0], [-2.2, 1.95, -0.6], [-1.0, 1.6, -0.1]], 0.04, 10);
    b.tube(M.steelDark, [[-2.75, 1.35, -1.25], [-2.3, 0.7, -0.75], [-1.6, 0.45, -0.45]], 0.035, 10);
    // Antrieb rechts, Schaltschrank, Pult, Späne
    b.rbox(P, 0.6, 0.85, 1.0, 0.05, 5.05, 0.62, 0.1, 0, 0.012); b.cylX(M.dark, 0.2, 0.55, 5.3, 1.05, 0.1, 18);
    elCab(b, 2.6, -1.25, 1.7, 1.95, 0.5, 0);
    b.cyl(M.dark, 0.06, 0.95, -3.0, 0, 1.35, 10); b.box(M.dark, 0.34, 0.03, 0.34, -3.0, 0, 1.35);
    hmi(b, -3.0, 0.92, 1.35, 0.15);
    chipCart(b, -1.7, 1.25, 0);
    b.box(M.darker, 1.0, 0.45, 0.55, -1.7, 0, 0.62);
    const chuck = grp(-4.25, ay, 0.1), cb = new Builder();
    cb.latheX(M.chuck, 'chkD', [[0, 0], [0.27, 0], [0.27, 0.16], [0.23, 0.2], [0, 0.2]], 0, 0, 0, 28);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; cb.boxC(M.steelDark, 0.08, 0.1, 0.12, 0.22, Math.cos(a) * 0.16, Math.sin(a) * 0.16); }
    cb.build(chuck); mo.group.add(chuck);
    const work = mesh(gCylC(22), M.steel); work.rotation.z = PI / 2; chuck.add(work);
    const oil = grp(0, 0.62, 0.1), ob = new Builder();
    ob.rbox(P, 0.62, 0.9, 1.0, 0.06, 0, 0, 0, 0, 0.012); ob.box(M.dark, 0.05, 0.5, 0.6, -0.32, 0.25, 0); ob.cylX(M.steelDark, 0.12, 0.16, -0.46, ay - 0.62, 0, 16);
    ob.build(oil); mo.group.add(oil);
    const boring = mesh(gCylC(12), M.chrome); boring.rotation.z = PI / 2; mo.group.add(boring);
    const supports = [0, 1, 2].map(() => { const g = grp(0, 0.62, 0.1), sb = new Builder(); sb.rbox(P, 0.2, 0.62, 0.62, 0.03, 0, 0, 0); sb.cylX(M.steelDark, 0.07, 0.24, -0.12, ay - 0.62, 0, 14); sb.build(g); mo.group.add(g); return g; });
    const car = grp(4, 0.62, 0.1), crb = new Builder();
    crb.rbox(P, 1.15, 0.98, 1.08, 0.07, 0, 0, 0, 0, 0.015); crb.cylX(M.dark, 0.24, 0.58, 0.5, 0.58, 0, 18); crb.box(M.accent, 1.05, 0.045, 0.012, 0, 0.82, 0.545);
    crb.cylX(M.steelDark, 0.09, 0.2, -0.75, ay - 0.62, 0, 14);
    crb.build(car); mo.group.add(car);
    mo.a = { chuck, work, oil, boring, supports, car, ay };
    tower(mo, 3.2, 2.05, -1.28);
    mo.conn = [2.4, 2.05, -1.25];
  };

  // ---------- Wälzfräsmaschine ----------
  TB.hobber = (mo, b) => {
    const c = cabin(mo, b, { x0: -1.6, x1: 1.6, zb: -0.75, zf: 2.0, h: 2.62, r: 0.32, pl: 0.2, intD: 1.4, win: { x0: -1.2, x1: 0.6, y0: 1.0, y1: 2.0 }, slide: 1 });
    const fy = c.floorY, iz = c.ic;
    b.box(M.mid, 0.62, 1.7, 0.75, 0.82, fy, iz - 0.25);
    b.box(M.mid, 0.95, 0.35, 0.95, -0.35, fy, iz - 0.05);
    const table = grp(-0.35, fy + 0.35, iz - 0.05), tbb = new Builder();
    tbb.latheY(M.steelDark, 'hobT', [[0, 0], [0.32, 0], [0.32, 0.12], [0.16, 0.14], [0.16, 0.2], [0, 0.2]], 0, 0, 0, 32);
    for (let i = 0; i < 38; i++) { const a = i * TAU / 38; tbb.boxC(M.steel, 0.018, 0.05, 0.03, Math.cos(a) * 0.165, 0.225, Math.sin(a) * 0.165, -a); }
    tbb.cyl(M.steel, 0.15, 0.05, 0, 0.2, 0, 32);
    tbb.build(table); mo.group.add(table);
    b.box(M.mid, 0.3, 0.32, 0.3, -0.35, fy + 1.3, iz - 0.05); b.box(M.mid, 0.34, 1.0, 0.3, -0.35, fy + 0.62, iz - 0.5); b.box(M.mid, 0.3, 0.12, 0.5, -0.35, fy + 1.5, iz - 0.25);
    b.cyl(M.steel, 0.05, 0.62, -0.35, fy + 0.8, iz - 0.05, 14);
    const head = grp(0.42, fy + 0.85, iz - 0.05), hb = new Builder();
    hb.boxC(M.mid, 0.46, 0.34, 0.46, 0.12, 0, 0); hb.cylX(M.dark, 0.08, 0.2, -0.32, 0, 0, 12);
    hb.build(head); mo.group.add(head);
    const hobT = grp(-0.42, 0, 0); head.add(hobT); hobT.rotation.z = 0.32;
    const hob = grp(0, 0, 0); hobT.add(hob);
    const hb2 = new Builder(); hb2.latheX(M.hob, 'hob', [[0, -0.14], [0.065, -0.14], [0.065, 0.14], [0, 0.14]], 0, 0, 0, 20);
    for (let i = 0; i < 10; i++) hb2.add(new THREE.TorusGeometry(0.066, 0.009, 4, 18), M.hob, xf(-0.12 + i * 0.027, 0, 0, 0, PI / 2, 0)); hb2.build(hob);
    // hinten: Schaltschrank, Hydraulik, Späne; vorne: Pult
    elCab(b, -0.95, -1.62, 1.3, 2.1, 0.55, 0);
    coolTank(b, 0.35, -1.6, 0.9, 0.55, 1.0, 0);
    chipCart(b, 1.25, -1.55, 0);
    swivelArm(b, 1.52, 2.05, 1.05, 1.68, 1.22, 2.22);
    hmi(b, 1.22, 1.05, 2.22, -0.3);
    mo.a = { table, head, hob, fy };
    tower(mo, 1.35, 2.62, -0.45);
    mo.conn = [-0.95, 2.2, -1.62];
  };

  // ---------- 5-Achs-Bearbeitungszentrum mit Palettenwechsler ----------
  TB.mill5 = (mo, b) => {
    const c = cabin(mo, b, { x0: -1.55, x1: 1.25, zb: -1.25, zf: 1.65, h: 2.95, r: 0.55, pl: 0.22, intD: 1.6, win: { x0: -1.05, x1: 0.75, y0: 0.95, y1: 2.2 }, slide: -1 });
    const fy = c.floorY, iz = c.ic;
    // Arbeitsraum: Fahrständer mit Spindelkopf, Schwenkbrücke mit Rundtisch
    b.box(M.mid, 1.4, 1.75, 0.35, -0.15, fy, c.zi + 0.2);
    const spindle = grp(-0.15, fy + 1.15, iz - 0.15), sb = new Builder();
    sb.rbox(M.mid, 0.5, 0.8, 0.5, 0.06, 0, 0.0, -0.1); sb.latheY(M.steelDark, 'sp5', [[0, 0], [0.11, 0], [0.11, -0.08], [0.06, -0.14], [0, -0.14]], 0, 0, -0.05, 18);
    sb.build(spindle); mo.group.add(spindle);
    const tool = grp(0, -0.14, -0.05), tlb = new Builder();
    tlb.latheY(M.steelDark, 'hsk', [[0, 0], [0.05, 0], [0.04, -0.08], [0.022, -0.1], [0, -0.1]], 0, 0, 0, 14); tlb.cyl(M.steel, 0.02, 0.17, 0, -0.27, 0, 10);
    tlb.build(tool); spindle.add(tool);
    b.box(M.mid, 1.3, 0.38, 0.7, -0.15, fy, iz);
    for (const s of [-1, 1]) b.rbox(M.mid, 0.16, 0.4, 0.5, 0.03, -0.15 + s * 0.58, fy + 0.38, iz);
    const table = grp(-0.15, fy + 0.52, iz), tbb = new Builder();
    tbb.latheY(M.steelDark, 'rt5', [[0, 0], [0.33, 0], [0.33, 0.07], [0, 0.07]], 0, 0, 0, 32); tbb.rbox(M.alu, 0.34, 0.22, 0.28, 0.02, 0, 0.07, 0);
    tbb.build(table); mo.group.add(table);
    // Werkzeugmagazin links (Kette, Sichtfenster)
    b.rbox(mo.mPaint, 1.05, 2.55, 2.0, 0.08, -2.12, 0, 0.1, 0, 0.015);
    b.box(M.black, 0.62, 1.15, 0.01, -2.12, 0.95, 1.105); b.box(M.glass, 0.56, 1.08, 0.01, -2.12, 0.985, 1.112);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) b.cylZ(M.steelDark, 0.03, 0.07, -2.32 + i * 0.13, 1.08 + j * 0.13, 1.0, 10);
    b.box(M.accent, 0.95, 0.045, 0.012, -2.12, 2.25, 1.105);
    // Palettenwechsler rechts (Drehstation mit zwei Paletten), Rüstplatz mit Schutzgitter
    b.latheY(M.dark, 'pcb', [[0, 0], [0.9, 0], [0.9, 0.78], [0, 0.78]], 2.3, 0, 0.72, 40);
    b.rbox(mo.mPaint, 0.9, 1.75, 1.95, 0.06, 1.72, 0.78, 0.72, 0, 0.012); b.box(M.glass, 0.012, 0.75, 1.4, 2.18, 1.45, 0.72);
    for (const [x, z] of [[3.22, -0.3], [3.22, 1.75], [1.45, 1.75], [2.35, 1.75]]) b.box(M.yellow, 0.06, 1.4, 0.06, x, 0, z);
    b.box(M.fenceY, 0.02, 0.95, 2.0, 3.22, 0.4, 0.72);
    b.box(M.fenceY, 1.75, 0.95, 0.02, 2.35, 0.4, -0.3);
    b.box(M.darker, 0.1, 0.5, 0.08, 3.22, 1.4, 1.75); b.box(M.ledG, 0.02, 0.4, 0.02, 3.21, 1.42, 1.7);
    const pal = grp(2.3, 0.78, 0.72), pb = new Builder();
    pb.latheY(M.mid, 'pal', [[0, 0], [0.84, 0], [0.84, 0.06], [0, 0.06]], 0, 0, 0, 40);
    for (const s of [-1, 1]) { pb.rbox(M.steelDark, 0.62, 0.08, 0.62, 0.03, s * 0.44, 0.06, 0); pb.rbox(M.alu, 0.34, 0.22, 0.28, 0.02, s * 0.44, 0.14, 0); }
    pb.box(mo.mPaint, 0.04, 1.05, 1.5, 0, 0.06, 0);
    pb.build(pal); mo.group.add(pal);
    // hinten: Schaltschrank, Späneförderer, Kühlmittel; Pult am Schwenkarm
    elCab(b, -0.35, -1.92, 2.0, 2.15, 0.6, 0);
    chipConv(b, 0.95, -1.35, 1.45, PI / 2, 1.0);
    coolTank(b, 2.55, -2.05, 1.2, 0.6, 0.85, 0);
    swivelArm(b, -1.48, 1.72, 1.15, 1.85, -1.15, 1.98);
    hmi(b, -1.15, 1.1, 1.98, 0.28, { handwheel: true });
    mo.a = { spindle, tool, table, pal, palRot: 0, palTarget: 0, sx: -0.15, sy: fy + 1.15, sz: iz - 0.15 };
    tower(mo, 1.02, 2.95, -1.0);
    mo.conn = [-0.35, 2.25, -1.92];
  };

  // ---------- Vertikal-Bearbeitungszentrum ----------
  TB.mill3 = (mo, b) => {
    const c = cabin(mo, b, { x0: -1.6, x1: 1.6, zb: -0.95, zf: 1.2, h: 2.62, r: 0.5, pl: 0.25, intD: 1.25, win: { x0: -1.2, x1: 1.2, y0: 0.98, y1: 1.92 }, split: true });
    const fy = c.floorY, iz = c.ic;
    b.box(M.mid, 0.75, 1.55, 0.35, 0.0, fy, c.zi + 0.18);
    const spindle = grp(0.0, fy + 1.05, iz - 0.12), sb = new Builder();
    sb.rbox(M.mid, 0.46, 0.68, 0.46, 0.05, 0, 0.0, -0.08); sb.latheY(M.steelDark, 'sp3', [[0, 0], [0.09, 0], [0.09, -0.06], [0.05, -0.1], [0, -0.1]], 0, 0, -0.04, 16);
    sb.build(spindle); mo.group.add(spindle);
    const tool = grp(0, -0.1, -0.04), tlb = new Builder(); tlb.latheY(M.steelDark, 'bt40', [[0, 0], [0.045, 0], [0.035, -0.07], [0.02, -0.09], [0, -0.09]], 0, 0, 0, 14); tlb.cyl(M.steel, 0.018, 0.15, 0, -0.24, 0, 10); tlb.build(tool); spindle.add(tool);
    b.box(M.mid, 1.5, 0.15, 0.72, 0, fy, iz);
    const table = grp(0, fy + 0.15, iz), tbb = new Builder();
    tbb.rbox(M.steelDark, 1.6, 0.12, 0.6, 0.02, 0, 0, 0); for (let i = 0; i < 4; i++) tbb.box(M.darker, 1.58, 0.012, 0.03, 0, 0.115, -0.21 + i * 0.14);
    tbb.box(M.dark, 0.34, 0.14, 0.2, 0, 0.12, 0); tbb.box(M.steel, 0.24, 0.1, 0.17, 0, 0.26, 0);
    tbb.build(table); mo.group.add(table);
    // seitlicher Werkzeugwechsler (Schirm)
    b.latheX(mo.mPaint, 'smtc', [[0, 0], [0.56, 0], [0.6, 0.06], [0.6, 0.3], [0, 0.34]], -1.6, 1.85, -0.18, 32, -1);
    b.latheX(M.accent, 'smtcR', [[0.6, 0.18], [0.61, 0.18], [0.61, 0.22], [0.6, 0.22]], -1.6, 1.85, -0.18, 32, -1);
    b.box(M.dark, 0.25, 0.25, 0.7, -1.72, 1.2, -0.18);
    // hinten: Schaltschrank, Kühlmittel; Pult am Schwenkarm
    elCab(b, -0.85, -1.22, 1.35, 1.75, 0.42, 0, { cool: false });
    coolTank(b, 0.75, -1.22, 1.25, 0.48, 0.62, 0);
    b.box(M.darker, 0.5, 0.3, 0.3, 1.65, 0, 0.3);
    swivelArm(b, 1.55, 1.24, 1.25, 2.1, 1.72, 1.4);
    hmi(b, 1.72, 1.15, 1.4, -0.35, { s: 1.05, handwheel: true });
    mo.a = { spindle, tool, table, tx: 0, tz: iz, sy: fy + 1.05 };
    tower(mo, 1.32, 2.62, -0.55);
    mo.conn = [-0.85, 1.85, -1.22];
  };

  // ---------- Rundschleifmaschine ----------
  TB.cylgrinder = (mo, b) => {
    const c = cabin(mo, b, { x0: -1.95, x1: 1.95, zb: -1.0, zf: 1.3, h: 2.25, r: 0.36, pl: 0.2, intD: 1.55, win: { x0: -1.5, x1: 1.3, y0: 0.96, y1: 1.8 }, split: true });
    const fy = c.floorY, iz = c.ic;
    b.box(M.granite, 3.5, 0.24, 1.15, 0, fy, iz - 0.12);
    b.box(M.steelDark, 2.9, 0.08, 0.36, 0, fy + 0.24, iz + 0.16);
    b.rbox(M.mid, 0.48, 0.44, 0.46, 0.04, -1.12, fy + 0.32, iz + 0.16); b.latheX(M.steel, 'whc', [[0, 0], [0.07, 0], [0.02, 0.1], [0, 0.1]], -0.88, fy + 0.6, iz + 0.16, 14);
    const tailG = grp(1.05, fy + 0.32, iz + 0.16), tlb = new Builder(); tlb.rbox(M.mid, 0.4, 0.38, 0.4, 0.04, 0, 0, 0); tlb.latheX(M.steel, 'tlc', [[0, 0], [0.05, 0], [0.02, 0.1], [0, 0.1]], -0.2, 0.28, 0, 12, -1); tlb.build(tailG); mo.group.add(tailG);
    const wy = fy + 0.6;
    const work = mesh(gCylC(22), M.steel, 0, wy, iz + 0.16, 0.05, 1.6, 0.05); work.rotation.z = PI / 2; mo.group.add(work);
    const head = grp(0.1, fy + 0.32, iz - 0.3), hb = new Builder();
    hb.rbox(M.paintW, 0.8, 0.55, 0.6, 0.06, 0, 0, -0.2, 0, 0.012);
    hb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.13, 26, 1, false, PI / 2, PI).rotateZ(PI / 2), M.paintW, xf(0, 0.28, 0.12));
    hb.build(head); mo.group.add(head);
    const wheel = mesh(gCylC(30), M.wheel, 0, 0.28, 0.12, 0.26, 0.063, 0.26); wheel.rotation.z = PI / 2; head.add(wheel);
    elCab(b, -1.0, -1.32, 1.45, 2.0, 0.55, 0);
    coolTank(b, 1.15, -1.32, 1.45, 0.55, 0.9, 0);
    b.rbox(M.paintW, 1.0, 0.4, 0.5, 0.03, 1.15, 0.9, -1.32); b.box(M.darker, 0.7, 0.02, 0.4, 1.15, 1.3, -1.32);
    swivelArm(b, 1.88, 1.35, 1.0, 1.62, 2.12, 1.5);
    hmi(b, 2.12, 0.95, 1.5, -0.3);
    mo.a = { work, head, wheel, tailG, hz: iz - 0.3, wy };
    tower(mo, 1.72, 2.25, -0.75);
    mo.conn = [-1.0, 2.1, -1.32];
  };

  // ---------- Flachschleifmaschine (Bestand, ohne Netzwerk) ----------
  TB.surfgrinder = (mo, b) => {
    const P = M.paintOld;
    b.rbox(P, 1.55, 0.95, 1.3, 0.08, 0, 0, 0.1, 0, 0.02);
    b.rbox(M.dark, 1.6, 0.08, 1.35, 0.06, 0, 0, 0.1);
    b.box(P, 1.35, 0.14, 1.0, 0, 0.95, 0.18);
    b.rbox(P, 0.74, 1.62, 0.72, 0.07, 0, 0.95, -0.46, 0, 0.02);
    b.box(M.dark, 0.5, 0.25, 0.02, 0, 1.6, -0.09);
    for (const [x, y, z, ax] of [[-0.42, 0.62, 0.76, 'z'], [0.42, 0.62, 0.76, 'z'], [0.38, 1.95, -0.45, 'x']]) {
      if (ax === 'z') { b.cylZ(M.chrome, 0.13, 0.03, x, y, z, 22); b.cylZ(M.steelDark, 0.025, 0.08, x, y, z - 0.05, 10); b.cylZ(M.dark, 0.02, 0.08, x + 0.09, y + 0.05, z + 0.03, 8); }
      else { b.cylX(M.chrome, 0.12, 0.03, x, y, z, 22); b.cylX(M.dark, 0.02, 0.08, x + 0.03, y + 0.05, z + 0.08, 8); }
    }
    b.box(M.red, 0.06, 0.06, 0.02, -0.6, 0.78, 0.76); b.box(M.green, 0.06, 0.06, 0.02, -0.6, 0.68, 0.76);
    elCab(b, -1.22, -0.82, 0.56, 1.45, 0.4, 0, { mat: P, cool: false });
    b.box(M.darker, 0.36, 0.2, 0.02, -1.22, 1.05, -0.61);
    coolTank(b, 1.15, -0.82, 0.62, 0.48, 0.5, 0);
    b.tube(M.cable, [[1.15, 0.5, -0.82], [1.0, 0.9, -0.3], [0.6, 1.25, 0.05], [0.2, 1.4, 0.15]], 0.016, 8);
    const table = grp(0, 1.09, 0.3), tb = new Builder();
    tb.box(P, 2.4, 0.13, 0.62, 0, 0, 0); tb.box(M.steelDark, 1.35, 0.07, 0.52, 0, 0.13, 0);
    for (let i = 0; i < 13; i++) tb.box(M.chrome, 0.012, 0.072, 0.5, -0.6 + i * 0.1, 0.13, 0);
    tb.rbox(M.steel, 0.42, 0.04, 0.22, 0.01, -0.15, 0.2, -0.05); tb.rbox(M.steel, 0.42, 0.04, 0.22, 0.01, 0.35, 0.2, 0.08);
    tb.box(M.glass, 0.02, 0.22, 0.58, -0.72, 0.13, 0); tb.box(M.glass, 0.02, 0.22, 0.58, 0.72, 0.13, 0);
    tb.build(table); mo.group.add(table);
    const head = grp(0, 1.5, 0.3), hb = new Builder();
    hb.rbox(P, 0.56, 0.44, 0.82, 0.05, 0, 0.05, -0.5, 0, 0.012);
    hb.cylZ(P, 0.18, 0.42, 0, 0.42, -0.88, 18);
    hb.add(new THREE.CylinderGeometry(0.205, 0.205, 0.075, 24, 1, false, -PI / 2, PI).rotateX(PI / 2), P, xf(0, 0, 0));
    hb.build(head); mo.group.add(head);
    const wheel = mesh(gCylC(28), M.wheel, 0, 0, 0, 0.175, 0.042, 0.175); wheel.rotation.x = PI / 2; head.add(wheel);
    mo.a = { table, head, wheel };
    tower(mo, 0.25, 2.57, -0.62);
    mo.conn = null;
  };

  // ---------- Kammerreinigungsanlage ----------
  TB.washer = (mo, b) => {
    b.rbox(M.stainless, 2.2, 2.0, 1.9, 0.06, 0, 0, -0.1, 0, 0.02);
    b.box(M.dark, 2.25, 0.1, 1.95, 0, 0, -0.1);
    const door = new THREE.Group(), db = new Builder();
    db.rbox(M.paintW, 1.12, 1.18, 0.06, 0.03, 0, 0, 0, 0, 0.01); db.box(M.black, 0.56, 0.42, 0.012, 0, 0.5, 0.032); db.box(M.glass, 0.5, 0.36, 0.01, 0, 0.53, 0.04);
    db.box(M.chrome, 0.5, 0.035, 0.04, 0, 0.18, 0.05); db.box(M.accent, 1.08, 0.04, 0.01, 0, 1.05, 0.032);
    db.build(door); door.position.set(0, 0.48, 0.86); mo.group.add(door);
    mo.door = { obj: door, y0: 0.48, lift: 1.0, f: 0, vertical: true };
    b.box(mo.inner, 0.52, 0.4, 0.01, 0, 0.98, 0.84);
    b.box(M.stainless, 2.22, 0.12, 0.08, 0, 1.78, 0.85);
    for (const s of [-1, 1]) {
      const x0 = s * 1.12, x1 = s * 2.2;
      b.box(M.dark, Math.abs(x1 - x0), 0.08, 0.66, (x0 + x1) / 2, 0.82, -0.05);
      for (const lx of [x0 + s * 0.1, x1 - s * 0.1]) { b.box(M.dark, 0.06, 0.82, 0.06, lx, 0, -0.33); b.box(M.dark, 0.06, 0.82, 0.06, lx, 0, 0.23); }
      for (let x = Math.min(x0, x1) + 0.08; x < Math.max(x0, x1); x += 0.2) b.cylZ(M.steel, 0.035, 0.62, x, 0.92, -0.36, 12);
      b.box(M.gitter, 0.52, 0.25, 0.42, s * 1.68, 0.96, -0.05);
    }
    b.cyl(M.stainless, 0.12, 1.15, 0.55, 2.0, -0.45, 16); b.tube(M.stainless, [[0.55, 3.15, -0.45], [0.55, 3.32, -0.8], [0.55, 3.32, -1.2]], 0.12, 14);
    b.rbox(M.paintW, 0.7, 1.25, 0.32, 0.03, -0.7, 0, -1.2);
    b.cyl(M.steelDark, 0.15, 0.32, -0.25, 2.0, -0.6, 14);
    hmi(b, 0.88, 0.95, 0.86, 0, { s: 0.75 });
    const basket = grp(0, 1.18, 0.62); const bm = mesh(gCylC(14), M.gitter, 0, 0, 0, 0.18, 0.3, 0.18); bm.rotation.x = PI / 2; basket.add(bm); mo.group.add(basket);
    const lamp = mesh(gBoxC(), new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }), 0, 1.18, 0.86, 0.5, 0.36, 0.01); lamp.renderOrder = 3; mo.group.add(lamp);
    mo.a = { basket, lamp };
    tower(mo, 0.95, 2.0, -0.7);
    mo.conn = [0.95, 2.0, -0.85];
  };

  /** Messraum (Weltkoordinaten): Glasraum, KMG (Granittisch, Portal, Pinole), Auswerteplatz, Messmittel */
  TB.cmm = (mo, b) => {
    const st = mo.st, f = st.footprint, c = st.cmm, x0 = f.x, x1 = f.x + f.w, z0 = f.z, z1 = f.z + f.d, H = 2.8;
    const door = [st.dock.x - 0.7, st.dock.x + 0.7];
    glassWalls(b, x0, x1, z0, z1, H, [door], { solid: 0.12 });
    b.box(M.alu, door[1] - door[0], 0.1, 0.09, (door[0] + door[1]) / 2, 2.2, z0);
    // KMG: Unterbau, Granitplatte, Portal
    const tx = c.x + c.w / 2, tz = c.z + c.d / 2;
    b.rbox(M.paintW, c.w - 0.5, 0.52, c.d - 0.5, 0.04, tx, 0.04, tz, 0, 0.01);
    for (const [dx, dz] of [[-1, -1], [1, -1], [0, 1]]) b.cyl(M.darker, 0.13, 0.08, tx + dx * (c.w / 2 - 0.4), 0, tz + dz * (c.d / 2 - 0.4), 14);
    b.rbox(M.granite, c.w, 0.32, c.d, 0.02, tx, 0.55, tz, 0, 0.01);
    for (const s of [-1, 1]) b.box(M.steel, c.w - 0.1, 0.02, 0.06, tx, 0.87, tz + s * (c.d / 2 - 0.12));
    b.rbox(M.alu, 0.5, 0.22, 0.38, 0.02, tx - 0.45, 0.87, tz + 0.15); b.box(M.steelDark, 0.3, 0.06, 0.26, tx - 0.45, 1.09, tz + 0.15);
    b.latheY(M.steel, 'cmmP', [[0, 0], [0.05, 0], [0.05, 0.06], [0.03, 0.1], [0, 0.1]], tx + 0.5, 0.87, tz - 0.3, 16);
    const bridge = grp(tx, 0.87, tz), bb = new Builder();
    for (const s of [-1, 1]) { bb.rbox(M.alu, 0.16, 1.32, 0.32, 0.03, s * (c.w / 2 - 0.14), 0, 0, 0, 0.008); bb.box(M.dark, 0.2, 0.06, 0.36, s * (c.w / 2 - 0.14), 0, 0); }
    bb.rbox(M.paintW, c.w, 0.24, 0.3, 0.04, 0, 1.3, 0, 0, 0.01); bb.box(M.accent, c.w - 0.12, 0.04, 0.01, 0, 1.42, 0.155);
    bb.build(bridge); mo.group.add(bridge);
    const zcar = grp(0, 1.3, 0.06), zb = new Builder(); zb.rbox(M.paintW, 0.32, 0.46, 0.4, 0.04, 0, -0.1, 0.12, 0, 0.01); zb.build(zcar); bridge.add(zcar);
    const ram = grp(0, 0, 0.16), rb = new Builder(); rb.box(M.alu, 0.085, 0.98, 0.085, 0, -0.62, 0); rb.box(M.dark, 0.1, 0.1, 0.1, 0, -0.72, 0); rb.cyl(M.steel, 0.012, 0.14, 0, -0.86, 0, 8); rb.sph(M.red, 0.026, 0, -0.87, 0, 12); rb.build(ram); zcar.add(ram);
    // Steuerschrank, Auswerteplatz mit zwei Monitoren, Messmittelschrank, Höhenmessgerät, Klimagerät
    b.rbox(M.paintW, 0.55, 1.15, 0.5, 0.04, x1 - 0.65, 0, z1 - 0.75, 0, 0.01);
    b.box(M.paintW, 1.7, 0.05, 0.8, x0 + 1.25, 0.74, z1 - 0.62); b.box(M.dark, 0.05, 0.74, 0.72, x0 + 0.45, 0, z1 - 0.62); b.box(M.dark, 0.05, 0.74, 0.72, x0 + 2.05, 0, z1 - 0.62);
    for (const dx of [-0.32, 0.32]) { b.box(M.black, 0.56, 0.36, 0.035, x0 + 1.25 + dx, 0.88, z1 - 0.38, dx * -0.3); b.box(M.screen, 0.52, 0.32, 0.005, x0 + 1.25 + dx, 0.9, z1 - 0.4, PI + dx * -0.3); b.box(M.dark, 0.05, 0.13, 0.05, x0 + 1.25 + dx, 0.79, z1 - 0.36); }
    b.box(M.darker, 0.46, 0.07, 0.46, x0 + 1.25, 0.47, z1 - 1.35); b.cyl(M.darker, 0.03, 0.44, x0 + 1.25, 0.03, z1 - 1.35, 8); b.box(M.darker, 0.46, 0.5, 0.06, x0 + 1.25, 0.52, z1 - 1.12);
    b.box(M.paintW, 1.2, 0.05, 0.6, x1 - 1.0, 0.85, z0 + 1.6); b.box(M.dark, 1.15, 0.85, 0.55, x1 - 1.0, 0, z0 + 1.6);
    b.box(M.granite, 0.5, 0.06, 0.4, x1 - 1.2, 0.9, z0 + 1.6); b.cyl(M.steelDark, 0.025, 0.55, x1 - 1.25, 0.96, z0 + 1.62, 10); b.box(M.paintW, 0.14, 0.12, 0.1, x1 - 1.25, 1.2, z0 + 1.68);
    b.box(M.drawers, 0.9, 1.6, 0.5, x0 + 0.5, 0, z0 + 3.6, PI / 2);
    b.rbox(M.paintW, 1.0, 0.32, 0.22, 0.04, x1 - 0.16, 2.2, (z0 + z1) / 2, PI / 2);
    for (let i = 0; i < 4; i++) b.box(M.darker, 0.02, 0.012, 0.8, x1 - 0.28, 2.27 + i * 0.05, (z0 + z1) / 2);
    roomSign(x0 + 1.6, 2.86, z0, 'Messraum', '20 °C · nur mit Freigabe', '#2f76a0');
    mo.a = { bridge, zcar, ram, tz, w: c.w, d: c.d };
    tower(mo, x1 - 0.65, 1.15, z1 - 0.75);
    mo.conn = [x1 - 0.65, 1.15, z1 - 0.75];
  };

  /** Montage (Weltkoordinaten): drei Montageplätze mit Baugruppen, Durchlaufregal, Terminal */
  TB.assembly = (mo, b) => {
    const f = mo.st.footprint, bx = 59.4;
    const benches = [13.0, 15.0, 17.0];
    mo.a = { mods: [] };
    benches.forEach((z) => {
      b.box(M.paintW, 0.9, 0.05, 1.7, bx, 0.86, z); b.box(M.accent, 0.92, 0.04, 1.72, bx, 0.82, z);
      for (const dz of [-0.78, 0.78]) for (const dx of [-0.38, 0.38]) b.box(M.dark, 0.05, 0.82, 0.05, bx + dx, 0, z + dz);
      b.box(M.dark, 0.85, 0.05, 1.6, bx, 0.18, z);
      b.box(M.dark, 0.04, 1.25, 0.04, bx + 0.42, 0.91, z - 0.8); b.box(M.dark, 0.04, 1.25, 0.04, bx + 0.42, 0.91, z + 0.8);
      b.box(M.paint, 0.02, 0.85, 1.55, bx + 0.43, 1.0, z); for (let k = 0; k < 6; k++) b.box(M.chrome, 0.025, 0.16 + (k % 3) * 0.05, 0.03, bx + 0.4, 1.38 - (k % 2) * 0.2, z - 0.6 + k * 0.24);
      b.box(M.dark, 0.32, 0.04, 1.4, bx + 0.28, 2.12, z); b.box(M.lens, 0.18, 0.012, 1.25, bx + 0.28, 2.105, z);
      for (let k = 0; k < 3; k++) b.box(M.klt, 0.3, 0.14, 0.22, bx + 0.3, 1.88, z - 0.45 + k * 0.45);
      b.box(M.darker, 0.42, 0.06, 0.42, bx - 0.75, 0.62, z + 0.3); b.cyl(M.darker, 0.03, 0.6, bx - 0.75, 0.02, z + 0.3, 8);
      // Baugruppe (Zuführmodul): Profilrahmen + Antrieb + Abdeckung – Teile sichtbar je Fortschritt
      const g = grp(bx - 0.05, 0.91, z), mb = new Builder();
      const fw = 0.58, fh = 0.48, fd = 0.78;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(M.alu, 0.035, fh, 0.035, sx * fw / 2, 0, sz * fd / 2);
      for (const sy of [0, fh - 0.035]) { mb.box(M.alu, fw, 0.035, 0.035, 0, sy, -fd / 2); mb.box(M.alu, fw, 0.035, 0.035, 0, sy, fd / 2); mb.box(M.alu, 0.035, 0.035, fd, -fw / 2, sy, 0); mb.box(M.alu, 0.035, 0.035, fd, fw / 2, sy, 0); }
      mb.build(g);
      const motor = mesh(gCylC(16), M.accent, 0, 0.18, -0.15, 0.085, 0.3, 0.085); motor.rotation.x = PI / 2; g.add(motor);
      const gear = mesh(gBox(), M.mid, 0, 0.04, 0.15, 0.3, 0.22, 0.24); g.add(gear);
      const belt = mesh(gBox(), M.rubber, 0, fh * 0.55, 0, fw - 0.06, 0.03, fd - 0.04); g.add(belt);
      const cover = mesh(gBox(), M.paintW, 0, fh, 0, fw + 0.02, 0.02, fd + 0.02); g.add(cover);
      mo.group.add(g);
      mo.a.mods.push({ g, motor, gear, belt, cover });
    });
    // Durchlaufregal mit KLT an der Wand
    const rx = 62.35;
    for (const z of [11.5, 13.8, 16.1, 18.3]) { b.box(M.blueRack, 0.06, 2.1, 0.06, rx - 0.45, 0, z); b.box(M.blueRack, 0.06, 2.1, 0.06, rx + 0.45, 0, z); }
    const kltC = [M.kltB, M.kltB];
    for (let lv = 0; lv < 4; lv++) {
      const y = 0.32 + lv * 0.48;
      b.tilt(M.orange, 0.95, 0.05, 6.85, rx, y, 14.9, PI / 2 * 0, 0.0);
      for (let i = 0; i < 9; i++) b.tilt(kltC[i % 2], 0.55, 0.24, 0.6, rx, y + 0.15, 11.95 + i * 0.74, 0, 0);
    }
    // Terminal (Tablet am Montageplatz 2)
    b.cyl(M.dark, 0.025, 1.25, bx - 0.55, 0.88, 15.75, 8);
    mo.tablet = tabletOn(mo, bx - 0.55, 2.15, 15.75, -PI / 2);
    tower(mo, bx - 0.55, 2.25, 15.75 + 0.2);
    roomSign(f.x + 0.2, 2.55, f.z + 0.02, null);
    mo.conn = null;
  };

  /** Glaswände eines Raums (unten schmale Sockelleiste), Türöffnungen in der vorderen Wand (z0) */
  function glassWalls(b, x0, x1, z0, z1, H, doors, o) {
    const sol = (o && o.solid) || 0.12;
    const wallX = (z, a, c2) => { const len = c2 - a; if (len <= 0.05) return; b.box(M.paintW, len, sol, 0.08, (a + c2) / 2, 0, z); b.box(M.glassRoom, len, H - sol - 0.06, 0.02, (a + c2) / 2, sol, z); b.box(M.alu, len, 0.06, 0.09, (a + c2) / 2, H - 0.06, z); const n = Math.max(1, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) b.box(M.alu, 0.05, H, 0.07, a + i * len / n, 0, z); };
    const wallZ = (x, a, c2) => { const len = c2 - a; b.box(M.paintW, 0.08, sol, len, x, 0, (a + c2) / 2); b.box(M.glassRoom, 0.02, H - sol - 0.06, len, x, sol, (a + c2) / 2); b.box(M.alu, 0.09, 0.06, len, x, H - 0.06, (a + c2) / 2); const n = Math.max(1, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) b.box(M.alu, 0.07, H, 0.05, x, 0, a + i * len / n); };
    let cur = x0;
    for (const [d0, d1] of doors.slice().sort((p, q) => p[0] - q[0])) { wallX(z0, cur, d0); cur = d1; }
    wallX(z0, cur, x1);
    wallX(z1, x0, x1); wallZ(x0, z0, z1); wallZ(x1, z0, z1);
  }
  /** Raumschild über der Tür (zur Gangseite, Blick −z → +z) */
  function roomSign(x, y, z, title, sub, col) {
    if (!title) return;
    const m = mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshStandardMaterial({ map: texSign(title, sub, col), roughness: 0.5 }), x, y, z + 0.06);
    m.castShadow = false; R.scene.add(m);
    const back = mesh(new THREE.PlaneGeometry(1.5, 0.47), M.paint, x, y, z + 0.055); back.rotation.y = PI; back.castShadow = false; R.scene.add(back);
    return m;
  }

  // ================================================================== Maschine aufbauen (Gruppe, Bodenrahmen, Pick-Proxy, Anker)
  const MODERN = { lathe: 1, swiss: 1, mill5: 1, cylgrinder: 1, cmm: 1, assembly: 1 };
  function buildMachine(st) {
    const f = st.footprint, world = st.type === 'cmm' || st.type === 'assembly';
    const ry = FACE_RY[st.facing] || 0;
    const W = Math.abs(Math.sin(ry)) > 0.5 ? f.d : f.w, D = Math.abs(Math.sin(ry)) > 0.5 ? f.w : f.d;
    const mo = { id: st.id, st, type: st.type, group: new THREE.Group(), W, D, ry, cx: f.x + f.w / 2, cz: f.z + f.d / 2, h: TYPE_H[st.type] || 2.4,
      inner: new THREE.MeshStandardMaterial({ color: 0xa3abb3, roughness: 0.42, metalness: 0.3, emissive: 0xfff3df, emissiveIntensity: 0 }),
      mPaint: (MODERN[st.type] ? M.paintW : M.paint).clone(),
      prog: 0, p0: 0, p1: 0, v: null, state: null, glowI: 0, spin: 0, hl: 0 };
    if (!world) { mo.group.position.set(mo.cx, 0, mo.cz); mo.group.rotation.y = ry; }
    mo.mBatch = batchMaterial();
    const b = new Builder();
    (TB[st.type] || TB.mill3)(mo, b);
    b.build(mo.group, true, mo.mBatch);
    R.scene.add(mo.group);
    mo.group.updateMatrixWorld(true);
    // Zustandsrahmen am Boden
    const gm = glowMat();
    const gf = new THREE.Mesh(glowFrame(f.w + 0.3, f.d + 0.3, 0.85, 0.4), gm);
    gf.position.set(mo.cx, 0.015, mo.cz); gf.renderOrder = 1; R.scene.add(gf);
    mo.glow = { mesh: gf, mat: gm };
    // Pick-Proxy (welt-achsenparallel) + Etikettenanker
    const proxy = new THREE.Mesh(gBox(), M.hidden);
    proxy.position.set(mo.cx, 0, mo.cz); proxy.scale.set(f.w, mo.h, f.d); proxy.userData = { kind: 'machine', id: st.id };
    R.scene.add(proxy); mo.proxy = proxy;
    mo.anchor = new THREE.Vector3(mo.cx, mo.h + 0.45, mo.cz);
    // Kabelabgang (Datenfluss) in Weltkoordinaten
    if (mo.conn) { const p = new THREE.Vector3(mo.conn[0], mo.conn[1], mo.conn[2]); if (!world) mo.group.localToWorld(p); mo.connW = p; } else mo.connW = null;
    if (!mo.tablet && st.conn && st.conn.level === 0 && !world) {
      const ox = -W / 2 + 0.3, oz = D / 2 + 0.35;
      const s = new Builder(); s.cyl(M.dark, 0.025, 1.15, ox, 0, oz, 8); s.cyl(M.darker, 0.16, 0.03, ox, 0, oz, 14); s.build(mo.group);
      mo.tablet = tabletOn(mo, ox, 1.22, oz, 0);
    }
    // Ausgangsstelle für „Teil fertig“-Puls (erster Ausgangsplatz)
    if (st.outPos) mo.outW = new THREE.Vector3(st.outPos.x, 0.05, st.outPos.z);
    R.mo[st.id] = mo; R.moList.push(mo);
    R.pick.push(proxy);
    return mo;
  }

  // ================================================================== Lager, Räume & Zonen (Weltkoordinaten)
  const MAT_COL = { 'MAT-TI10': '#2f7fd8', 'MAT-14404': '#2fae6a', 'MAT-42CR110': '#d8452f', 'MAT-42CR65': '#e98a2a', 'MAT-16MNCR90': '#d9c234', 'MAT-2842': '#9b59d0' };
  function buildStores() {
    const P = WF.profile, ST = P.stationById, b = new Builder(), sc = R.scene, rnd = U.rng(42);
    // ---------- Rohmaterial: Kragarmregal (Stangen je Bestand) + Gitterboxen für Stückgut
    const cols = [1.55, 3.65, 5.75, 7.85], levels = [0.55, 1.25, 1.95, 2.65];
    for (const x of cols) {
      b.add(gIBeam(3.3, 0.26, 0.026, 0.013), M.blueRack, xf(x, 0, 0.62));
      b.box(M.blueRack, 0.24, 0.16, 2.0, x, 0, 1.45); b.box(M.yellow, 0.24, 0.16, 0.06, x, 0, 2.46);
      for (const y of levels) { b.tilt(M.blueRack, 0.12, 0.1, 1.55, x, y, 1.5, 0, -0.03); b.box(M.blueRack, 0.12, 0.13, 0.06, x, y + 0.02, 2.24); }
    }
    b.box(M.blueRack, 6.6, 0.1, 0.12, 4.7, 3.22, 0.62); b.box(M.blueRack, 6.6, 0.06, 0.06, 4.7, 1.0, 0.62, 0, 0.6);
    R.rawSlots = { 'MAT-42CR110': [0, 0], 'MAT-16MNCR90': [1, 0], 'MAT-42CR65': [1, 1], 'MAT-14404': [2, 0], 'MAT-TI10': [2, 1], 'MAT-2842': [3, 0] };
    R.rawLevels = levels;
    R.rawBins = {};
    [['MAT-ALBL', 2.4, 5.4], ['MAT-GUSSLD', 4.1, 5.4]].forEach(([id, x, z]) => {
      gitterboxStatic(b, x, z);
      const fill = mesh(gBox(), id === 'MAT-ALBL' ? M.alu : M.steelDark, x, 0.17, z, 0.72, 0.5, 0.66); fill.castShadow = false; sc.add(fill);
      R.rawBins[id] = fill;
    });
    R.barsInst = new THREE.InstancedMesh(gCylC(14), M.steel, 200); R.barsInst.castShadow = true; R.barsInst.receiveShadow = true; R.barsInst.count = 0; sc.add(R.barsInst);
    R.capsInst = new THREE.InstancedMesh(gCylC(14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), 200); R.capsInst.count = 0; sc.add(R.capsInst);
    R.capsInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(200 * 3), 3);
    R.flatInst = new THREE.InstancedMesh(gBoxC(), M.steelDark, 60); R.flatInst.castShadow = true; R.flatInst.count = 0; sc.add(R.flatInst);
    const rawPick = mesh(gBox(), M.hidden, 4.75, 0, 3.6, 7.6, 3.3, 5.6); rawPick.userData = { kind: 'store', id: 'RAW' }; sc.add(rawPick); R.pick.push(rawPick);
    // ---------- Werkzeugausgabe: Glasraum, Schubladenschränke, Voreinstellgerät, Werkzeugwagen, Ausgabefenster
    const cr = ST.CRIB.footprint;
    room(b, ST.CRIB, { glass: true, door: [17.1, 18.1], counter: [13.6, 15.4] });
    for (let i = 0; i < 6; i++) b.add(gBox(), i % 3 === 2 ? M.drawersR : M.drawers, xf(cr.x + 0.75 + i * 0.95, 0, cr.z + 0.5, 0, 0, 0, 0.88, 1.02, 0.65));
    b.box(M.paintW, 5.8, 0.04, 0.68, cr.x + 3.1, 1.02, cr.z + 0.5);
    for (let s = 0; s < 2; s++) {
      const rx = cr.x + 0.45, rz = cr.z + 2.1 + s * 2.1;
      b.box(M.paint, 0.6, 2.0, 1.8, rx, 0, rz);
      for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 6; i++) { b.cyl(M.steelDark, 0.04, 0.12, rx + 0.32, 0.4 + lv * 0.42, rz - 0.75 + i * 0.3, 10); b.cyl(M.steel, 0.012, 0.12, rx + 0.32, 0.52 + lv * 0.42, rz - 0.75 + i * 0.3, 6); }
    }
    const ps = ST.CRIB.presetter;
    b.rbox(M.paintW, 1.4, 0.85, 0.8, 0.04, ps.x, 0, ps.z, 0, 0.01); b.box(M.granite, 1.3, 0.08, 0.7, ps.x, 0.85, ps.z);
    b.latheY(M.steel, 'pset', [[0, 0], [0.11, 0], [0.11, 0.08], [0.06, 0.12], [0, 0.12]], ps.x - 0.3, 0.93, ps.z, 16);
    b.rbox(M.paintW, 0.18, 1.0, 0.18, 0.02, ps.x + 0.42, 0.93, ps.z - 0.15); b.rbox(M.dark, 0.3, 0.18, 0.22, 0.02, ps.x + 0.22, 1.55, ps.z - 0.1);
    b.box(M.black, 0.5, 0.34, 0.04, ps.x + 0.05, 1.62, ps.z + 0.3, 0.3); b.box(M.screen, 0.45, 0.29, 0.005, ps.x + 0.05, 1.645, ps.z + 0.323, 0.3);
    for (const [x, z] of [[cr.x + 2.3, cr.z + 3.2], [cr.x + 3.5, cr.z + 3.4]]) { b.rbox(M.red, 0.75, 0.82, 0.45, 0.03, x, 0.08, z); for (const dx of [-0.3, 0.3]) for (const dz of [-0.17, 0.17]) b.cyl(M.rubber, 0.045, 0.08, x + dx, 0, z + dz, 10); for (let i = 0; i < 5; i++) b.cyl(M.steelDark, 0.035, 0.15, x - 0.28 + i * 0.14, 0.9, z, 10); }
    roomSign(cr.x + 1.4, 2.95, cr.z + cr.d, 'Werkzeugausgabe', 'Voreinstellung · Nachschliff', '#b18cff');
    // ---------- Instandhaltung: Werkbank, Regal, Säulenbohrmaschine, Schweißwagen, Ersatzteile
    const mt = ST.MAINT.footprint;
    room(b, ST.MAINT, { glass: false, door: [24.6, 25.8] });
    b.box(M.wood, 2.2, 0.06, 0.8, mt.x + 1.6, 0.86, mt.z + 0.55); b.box(M.dark, 2.1, 0.86, 0.75, mt.x + 1.6, 0, mt.z + 0.55);
    b.box(M.steelDark, 0.25, 0.2, 0.18, mt.x + 0.9, 0.92, mt.z + 0.55); b.box(M.paint, 2.2, 1.0, 0.04, mt.x + 1.6, 1.1, mt.z + 0.12);
    for (let i = 0; i < 9; i++) b.box(M.steelDark, 0.03, 0.2 + (i % 3) * 0.06, 0.03, mt.x + 0.7 + i * 0.22, 1.35, mt.z + 0.16);
    b.box(M.blueRack, 1.0, 2.0, 0.5, mt.x + 5.6, 0, mt.z + 0.45);
    for (let lv = 0; lv < 4; lv++) { b.box(M.steelDark, 1.0, 0.03, 0.5, mt.x + 5.6, 0.2 + lv * 0.5, mt.z + 0.45); b.box(M.kltB, 0.4, 0.22, 0.4, mt.x + 5.35, 0.23 + lv * 0.5, mt.z + 0.45); b.box(M.carton, 0.35, 0.25, 0.35, mt.x + 5.85, 0.23 + lv * 0.5, mt.z + 0.45); }
    b.box(M.dark, 0.5, 0.08, 0.5, mt.x + 4.0, 0, mt.z + 0.6); b.cyl(M.steelDark, 0.05, 1.6, mt.x + 4.0, 0.08, mt.z + 0.45, 10); b.rbox(M.green, 0.32, 0.38, 0.48, 0.03, mt.x + 4.0, 1.35, mt.z + 0.55);
    for (const dz of [0, 0.62]) b.cyl(M.oilUnit, 0.29, 0.88, mt.x + 5.7, 0, mt.z + 4.5 + dz, 18);
    b.box(M.wood, 1.2, 0.14, 0.8, mt.x + 3.8, 0, mt.z + 4.4); b.cylX(M.accent, 0.22, 0.55, mt.x + 3.55, 0.36, mt.z + 4.4, 16); b.box(M.dark, 0.3, 0.3, 0.35, mt.x + 4.15, 0.14, mt.z + 4.4);
    b.rbox(M.red, 0.55, 0.75, 0.4, 0.03, mt.x + 1.2, 0.08, mt.z + 4.6); b.cyl(M.green, 0.1, 0.9, mt.x + 1.6, 0.08, mt.z + 4.65, 12);
    roomSign(mt.x + 1.3, 2.95, mt.z + mt.d, 'Instandhaltung', 'Werkstatt · Ersatzteile', '#f87171');
    // ---------- Pufferlager (Palettenregal)
    const pf = ST.PUF.footprint, bays = 5, bw = (pf.w - 0.2) / bays, zF = pf.z + 0.15, zB = pf.z + 1.3;
    for (let i = 0; i <= bays; i++) { const x = pf.x + 0.1 + i * bw; b.box(M.blueRack, 0.09, 4.3, 0.09, x, 0, zF); b.box(M.blueRack, 0.09, 4.3, 0.09, x, 0, zB); for (let y = 0.4; y < 4.2; y += 0.9) b.tilt(M.blueRack, 0.04, 0.04, (zB - zF) * 1.12, x, y, (zF + zB) / 2, 0, 0.45); b.box(M.yellow, 0.2, 0.4, 0.2, x, 0, zB + 0.2); }
    for (let i = 0; i < bays; i++) for (const y of [1.4, 2.8]) { const x = pf.x + 0.1 + (i + 0.5) * bw; b.box(M.orange, bw, 0.11, 0.06, x, y, zF); b.box(M.orange, bw, 0.11, 0.06, x, y, zB); }
    for (let i = 0; i < bays; i++) for (const y of [0, 1.51, 2.91]) for (const s of [-1, 1]) {
      const r = rnd.next(); if (r < 0.18) continue;
      const x = pf.x + 0.1 + (i + 0.5) * bw + s * bw * 0.25, z = (zF + zB) / 2;
      palletStatic(b, x, y, z, PI / 2);
      if (r < 0.52) b.rbox(M.carton, 0.95, 0.7 + rnd.range(0, 0.35), 0.78, 0.02, x, y + 0.144, z, PI / 2);
      else if (r < 0.78) gitterboxStatic(b, x, z, y + 0.144);
      else for (let k = 0; k < 3; k++) b.box(M.kltB, 0.6, 0.28, 0.4, x, y + 0.144 + k * 0.29, z);
    }
    // ---------- AGV-Ladestation
    const ch = ST.CHG;
    for (const p of [ch.inPos, ch.outPos]) {
      b.rbox(M.paintW, 0.62, 1.15, 0.32, 0.04, p.x, 0, ch.footprint.z + 0.2, 0, 0.01);
      b.box(M.dark, 0.9, 0.03, 0.5, p.x, 0, p.z - 0.25); b.box(M.chrome, 0.7, 0.012, 0.06, p.x, 0.03, p.z - 0.35);
      b.box(M.black, 0.36, 0.2, 0.01, p.x, 0.75, ch.footprint.z + 0.365);
    }
    R.chgLeds = [ch.inPos, ch.outPos].map(p => { const m = new THREE.MeshBasicMaterial({ color: 0x1b3a2c, toneMapped: false }); const s = mesh(gBoxC(), m, p.x, 1.0, ch.footprint.z + 0.37, 0.3, 0.05, 0.01); sc.add(s); return m; });
    // ---------- Leitstand / Büro: Arbeitsplätze, MES-Server, Hallen-TV, Pausentisch
    room(b, ST.OFFICE, { glass: true, door: [58.0, 59.0] });
    for (const [x, z] of [[58.3, 3.0], [60.2, 3.0]]) {
      b.box(M.paintW, 1.45, 0.04, 0.75, x, 0.73, z); b.box(M.dark, 0.05, 0.73, 0.7, x - 0.65, 0, z); b.box(M.dark, 0.05, 0.73, 0.7, x + 0.65, 0, z);
      for (const dx of [-0.3, 0.3]) { b.box(M.black, 0.56, 0.35, 0.035, x + dx, 0.86, z - 0.24); b.box(M.screen, 0.52, 0.31, 0.005, x + dx, 0.88, z - 0.218); }
      b.box(M.darker, 0.46, 0.07, 0.46, x, 0.47, z + 0.55); b.box(M.darker, 0.46, 0.5, 0.06, x, 0.5, z + 0.8); b.cyl(M.darker, 0.03, 0.44, x, 0.03, z + 0.55, 8);
    }
    // Pausen-/Besprechungstisch (Pause im Leitstand)
    b.cyl(M.paintW, 0.62, 0.04, 59.5, 0.74, 5.5, 32); b.cyl(M.dark, 0.05, 0.74, 59.5, 0, 5.5, 10); b.cyl(M.dark, 0.3, 0.03, 59.5, 0, 5.5, 18);
    b.rbox(M.dark, 0.45, 0.9, 0.4, 0.03, 57.5, 0, 1.4); b.box(M.black, 0.3, 0.18, 0.02, 57.5, 0.95, 1.61);
    const sv = ST.OFFICE.server;
    b.rbox(M.darker, 0.65, 2.05, 1.0, 0.02, sv.x, 0, sv.z, 0, 0.01); b.box(M.glass, 0.6, 1.9, 0.01, sv.x, 0.08, sv.z + 0.51);
    R.serverLeds = [0, 1, 2].map(k => new THREE.MeshBasicMaterial({ color: [0x34d399, 0x3cc6f2, 0x34d399][k], toneMapped: false }));
    for (let i = 0; i < 16; i++) b.box(R.serverLeds[i % 3], 0.035, 0.014, 0.01, sv.x - 0.2 + (i % 2) * 0.07, 0.3 + i * 0.1, sv.z + 0.5);
    for (let i = 0; i < 8; i++) b.box(M.dark, 0.56, 0.07, 0.02, sv.x + 0.02, 0.26 + i * 0.22, sv.z + 0.495);
    const tvC = cnv(512, 228), tvT = tex(tvC); R.tvTex = tvT;
    b.box(M.dark, 0.08, 1.45, 0.08, 61.4, 0, 7.55); b.box(M.dark, 0.5, 0.04, 0.4, 61.4, 0, 7.55);
    b.rbox(M.darker, 1.72, 0.82, 0.07, 0.02, 61.4, 1.42, 7.6);
    const tv = mesh(new THREE.PlaneGeometry(1.64, 0.74), new THREE.MeshBasicMaterial({ map: tvT, toneMapped: false }), 61.4, 1.83, 7.645); tv.castShadow = false; sc.add(tv);
    b.cyl(M.dark, 0.18, 0.35, 57.6, 0, 7.4, 14); b.sph(M.plant, 0.38, 57.6, 0.78, 7.4, 12);
    roomSign(59.6, 2.95, 8.0, 'Leitstand', 'MES-Server · Schichtleitung', '#3cc6f2');
    // ---------- Wareneingang: Anlieferungen, Hubwagen
    const we = ST.WE.footprint;
    palletStatic(b, 1.6, 0, 36.7, PI / 2); b.rbox(M.wrap, 0.78, 0.95, 1.15, 0.03, 1.6, 0.144, 36.7, 0);
    palletStatic(b, 1.6, 0, 38.4, PI / 2); b.rbox(M.carton, 0.8, 0.6, 1.1, 0.02, 1.6, 0.144, 38.4, 0);
    b.box(M.yellow, 0.55, 0.22, 0.45, we.x + 2.0, 0, 37.0); b.box(M.dark, 0.06, 1.05, 0.06, we.x + 2.0, 0.22, 36.85); b.box(M.steelDark, 0.55, 0.06, 1.15, we.x + 2.0, 0.06, 37.65);
    // ---------- Sperrlager: roter Gitterkäfig mit Schild
    const sp = ST.SPERR.footprint, door = [ST.SPERR.dock.x - 0.6, ST.SPERR.dock.x + 0.6], CH = 2.1;
    const cageX = (z, a, c2) => { if (c2 - a < 0.05) return; b.box(M.fenceRed, c2 - a, CH - 0.12, 0.02, (a + c2) / 2, 0.1, z); b.box(M.red, c2 - a, 0.05, 0.05, (a + c2) / 2, CH, z); };
    const cageZ = (x, a, c2) => { b.box(M.fenceRed, 0.02, CH - 0.12, c2 - a, x, 0.1, (a + c2) / 2); b.box(M.red, 0.05, 0.05, c2 - a, x, CH, (a + c2) / 2); };
    cageX(sp.z + 0.05, sp.x + 0.05, door[0]); cageX(sp.z + 0.05, door[1], sp.x + sp.w - 0.05); cageX(sp.z + sp.d - 0.05, sp.x + 0.05, sp.x + sp.w - 0.05);
    cageZ(sp.x + 0.05, sp.z + 0.05, sp.z + sp.d - 0.05); cageZ(sp.x + sp.w - 0.05, sp.z + 0.05, sp.z + sp.d - 0.05);
    for (const x of [sp.x + 0.05, door[0], door[1], sp.x + sp.w - 0.05]) b.box(M.red, 0.06, CH + 0.05, 0.06, x, 0, sp.z + 0.05);
    for (const x of [sp.x + 0.05, sp.x + sp.w / 2, sp.x + sp.w - 0.05]) b.box(M.red, 0.06, CH + 0.05, 0.06, x, 0, sp.z + sp.d - 0.05);
    const sign = mesh(new THREE.PlaneGeometry(1.3, 0.34), new THREE.MeshStandardMaterial({ map: texLabel('GESPERRT', { bg: '#b8302a', px: 70, w: 512, h: 134 }), roughness: 0.6 }), sp.x + 1.05, 1.75, sp.z + 0.02);
    sign.rotation.y = PI; sc.add(sign);
    const sign2 = sign.clone(); sign2.position.set(sp.x + 1.05, 1.75, sp.z + 0.085); sign2.rotation.y = 0; sc.add(sign2);
    // ---------- Fremdbearbeitung: Hinweisschild
    const ex = ST.EXT.footprint;
    b.box(M.dark, 0.06, 1.6, 0.06, ex.x + 0.25, 0, ex.z + 0.25);
    const exs = mesh(new THREE.PlaneGeometry(1.25, 0.42), new THREE.MeshStandardMaterial({ map: texSign('Härterei', 'Übergabe an Spedition', '#ff9d3d'), roughness: 0.5 }), ex.x + 0.9, 1.65, ex.z + 0.29);
    sc.add(exs);
    // ---------- Versand: Packtisch, Wickelmaschine, Regal
    b.box(M.wood, 1.6, 0.05, 0.8, 61.9, 0.85, 26.0); b.box(M.dark, 1.5, 0.85, 0.7, 61.9, 0, 26.0);
    b.rbox(M.carton, 0.5, 0.35, 0.4, 0.02, 61.6, 0.9, 26.0); b.box(M.paintW, 0.3, 0.2, 0.25, 62.3, 0.9, 25.9);
    // Leerpaletten-Stapel, Plattformwaage, Regal mit Kartonzuschnitten und Stretchfolie
    for (let i = 0; i < 7; i++) palletStatic(b, 58.3, i * 0.144, 25.35, 0);
    b.box(M.darker, 1.25, 0.07, 1.25, 58.75, 0, 37.55); b.box(M.steelDark, 1.15, 0.012, 1.15, 58.75, 0.07, 37.55);
    b.box(M.dark, 0.06, 1.15, 0.06, 57.95, 0, 38.25); b.rbox(M.paint, 0.36, 0.26, 0.1, 0.02, 57.95, 1.12, 38.25); b.box(M.screenFrame, 0.3, 0.16, 0.012, 57.95, 1.17, 38.195);
    { const x = 62.55, z0 = 27.1, z1 = 34.9, H = 1.95;
      for (const z of [z0, (z0 + z1) / 2, z1]) for (const dx of [-0.27, 0.27]) b.box(M.blueRack, 0.06, H, 0.06, x + dx, 0, z);
      for (const y of [0.12, 0.85, 1.55]) { b.box(M.orange, 0.06, 0.08, z1 - z0, x - 0.27, y, (z0 + z1) / 2); b.box(M.orange, 0.06, 0.08, z1 - z0, x + 0.27, y, (z0 + z1) / 2); b.box(M.wood, 0.56, 0.02, z1 - z0 - 0.06, x, y + 0.08, (z0 + z1) / 2); }
      for (let i = 0; i < 5; i++) b.box(M.carton, 0.5, 0.42 - (i % 2) * 0.12, 1.2, x, 0.2, z0 + 0.75 + i * 1.5);
      for (let i = 0; i < 9; i++) b.cylZ(M.wrap, 0.11, 0.5, x - 0.12 + (i % 2) * 0.22, 1.06, z0 + 0.4 + i * 0.82, 16);
      for (let i = 0; i < 6; i++) b.rbox(M.carton, 0.44, 0.32, 0.55, 0.02, x, 1.65, z0 + 0.6 + i * 1.25, 0);
    }
    b.cyl(M.dark, 0.95, 0.1, 61.6, 0, 37.6, 30); b.box(M.paint, 0.3, 2.3, 0.3, 62.8, 0, 37.6); b.box(M.dark, 0.25, 0.35, 0.3, 62.55, 1.0, 37.6); b.cyl(M.wrap, 0.07, 0.5, 62.38, 0.95, 37.6, 12);
    b.build(sc);
    // Versand-Stellplätze (dynamisch je Auftrag), Pick-Flächen für Lager
    for (const [id, f] of [['CRIB', cr], ['PUF', pf], ['MAINT', mt], ['OFFICE', ST.OFFICE.footprint], ['VERSAND', ST.VERSAND.footprint], ['WE', we], ['EXT', ex], ['SPERR', sp], ['CHG', ST.CHG.footprint]]) {
      const p = mesh(gBox(), M.hidden, f.x + f.w / 2, 0, f.z + f.d / 2, f.w, id === 'PUF' ? 4.3 : 2.4, f.d); p.userData = { kind: 'store', id }; sc.add(p); R.pick.push(p);
    }
  }
  function palletStatic(b, x, y, z, ry) {
    const r = ry || 0;
    b.box(M.wood, 1.2, 0.022, 0.8, x, y + 0.122, z, r);
    for (const s of [-1, 0, 1]) { const [ox, oz] = rotXZ(0, s * 0.35, r); b.box(M.woodDark, 1.2, 0.1, 0.1, x + ox, y + 0.022, z + oz, r); }
    for (const s of [-1, 0, 1]) { const [ox, oz] = rotXZ(s * 0.52, 0, r); b.box(M.wood, 0.14, 0.022, 0.8, x + ox, y, z + oz, r); }
  }
  function gitterboxStatic(b, x, z, y) {
    const y0 = y || 0;
    b.box(M.steelDark, 0.82, 0.12, 0.76, x, y0, z);
    b.add(gOpenBox(0.8, 0.66, 0.74), M.gitter, xf(x, y0 + 0.12, z));
    for (const [dx, dz] of [[-0.4, -0.37], [0.4, -0.37], [-0.4, 0.37], [0.4, 0.37]]) b.box(M.steelDark, 0.04, 0.8, 0.04, x + dx, y0, z + dz);
  }
  /** Raum mit Wänden (unten massiv, oben Glas oder Gitter), Tür und optionalem Ausgabefenster */
  function room(b, st, o) {
    const f = st.footprint, H = 2.6, x0 = f.x, x1 = f.x + f.w, z0 = f.z, z1 = f.z + f.d;
    const upper = o.glass ? M.glassRoom : M.fence;
    const wallX = (z, a, c, gaps) => {
      let cur = a;
      const seg = (s0, s1) => { const len = s1 - s0; if (len < 0.05) return; b.box(M.paint, len, 1.0, 0.07, (s0 + s1) / 2, 0, z); b.box(upper, len, H - 1.05, 0.02, (s0 + s1) / 2, 1.0, z); b.box(M.alu, len, 0.05, 0.08, (s0 + s1) / 2, H - 0.05, z); const n = Math.max(1, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) b.box(M.alu, 0.05, H, 0.08, s0 + i * len / n, 0, z); };
      for (const [g0, g1, low] of gaps || []) { seg(cur, g0); if (low) { b.box(M.paint, g1 - g0, 1.0, 0.07, (g0 + g1) / 2, 0, z); b.box(M.wood, g1 - g0 + 0.2, 0.05, 0.5, (g0 + g1) / 2, 1.0, z + 0.15); b.box(M.alu, g1 - g0, 0.05, 0.08, (g0 + g1) / 2, H - 0.05, z); } else b.box(M.alu, g1 - g0, 0.1, 0.08, (g0 + g1) / 2, 2.2, z); cur = g1; }
      seg(cur, c);
    };
    const wallZ = (x, a, c) => { const len = c - a; b.box(M.paint, 0.07, 1.0, len, x, 0, (a + c) / 2); b.box(upper, 0.02, H - 1.05, len, x, 1.0, (a + c) / 2); b.box(M.alu, 0.08, 0.05, len, x, H - 0.05, (a + c) / 2); const n = Math.max(1, Math.round(len / 1.4)); for (let i = 0; i <= n; i++) b.box(M.alu, 0.08, H, 0.05, x, 0, a + i * len / n); };
    const gaps = []; if (o.counter) gaps.push([o.counter[0], o.counter[1], true]); if (o.door) gaps.push([o.door[0], o.door[1], false]);
    gaps.sort((p, q) => p[0] - q[0]);
    wallX(z1, x0, x1, gaps);
    if (z0 > 0.6) wallX(z0, x0, x1, []);
    wallZ(x0, z0, z1);
    if (x1 < 63.5) wallZ(x1, z0, z1);
  }

  // ================================================================== Personen, AGVs, Stapler
  const ROLES = {
    op: { label: 'Bedienung', vest: '#ff7a1f' }, setter: { label: 'Einrichter', vest: '#ffd21f' }, qs: { label: 'Qualitätsprüfung', vest: '#3d8bff' },
    log: { label: 'Logistik', vest: '#6fdc3c' }, maint: { label: 'Instandhaltung', vest: '#e5484d' }, asm: { label: 'Montage', vest: '#a66bff' }, lead: { label: 'Schichtleitung', vest: '#f2f4f7' },
  };
  const roleOf = (role) => /Schichtleit/.test(role) ? 'lead' : /Einricht/.test(role) ? 'setter' : /Qualit/.test(role) ? 'qs' : /Logist/.test(role) ? 'log' : /Instand/.test(role) ? 'maint' : /Monteur/.test(role) ? 'asm' : 'op';
  const SKIN = ['#e9c4a6', '#d8a883', '#b98463', '#f0cdb2', '#a87454'];
  const skinOf = (id) => SKIN[(parseInt(String(id).slice(1), 10) * 7) % SKIN.length];
  function colored(list) {
    const g = mergeGeos(list.map(([geo, mx]) => [geo, mx]));
    const col = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color();
    let o = 0;
    for (const [geo, , hex] of list) {
      const n = (geo.index ? geo.index.count : geo.attributes.position.count);
      c.set(hex);
      for (let i = 0; i < n; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      o += n;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function personGeos(roleKey, skin) {
    return cache('pg' + roleKey + skin, () => {
      const vest = ROLES[roleKey].vest, shirt = roleKey === 'lead' ? '#3a4a66' : '#2a3549', pants = '#262d3b', shoe = '#15181c', hat = roleKey === 'lead' ? '#ffffff' : roleKey === 'setter' ? '#f4f4ee' : roleKey === 'maint' ? '#e8483f' : roleKey === 'qs' ? '#f4f4ee' : '#f2f2ec', refl = '#d6dbe0';
      const torso = new THREE.CapsuleGeometry(0.165, 0.34, 4, 12);
      const body = colored([
        [torso, xf(0, 1.19, 0, 0, 0, 0, 1.12, 1, 0.68), shirt],
        [new THREE.CapsuleGeometry(0.17, 0.27, 4, 12), xf(0, 1.17, 0, 0, 0, 0, 1.14, 1, 0.72), vest],
        [new THREE.CylinderGeometry(0.197, 0.197, 0.04, 16, 1, true), xf(0, 1.06, 0, 0, 0, 0, 1, 1, 0.73), refl],
        [new THREE.CylinderGeometry(0.197, 0.197, 0.04, 16, 1, true), xf(0, 1.22, 0, 0, 0, 0, 1, 1, 0.73), refl],
        [new THREE.CylinderGeometry(0.15, 0.17, 0.12, 14), xf(0, 0.9, 0, 0, 0, 0, 1.12, 1, 0.7), pants],
        [new THREE.CylinderGeometry(0.055, 0.065, 0.08, 10), xf(0, 1.52, 0), skin],
        [new THREE.SphereGeometry(0.102, 16, 12), xf(0, 1.635, 0.005, 0, 0, 0, 1, 1.08, 1), skin],
        [new THREE.SphereGeometry(0.122, 16, 8, 0, TAU, 0, PI / 2), xf(0, 1.68, 0, 0, 0, 0, 1, 0.92, 1.06), hat],
        [new THREE.CylinderGeometry(0.135, 0.135, 0.014, 18), xf(0, 1.68, 0.035, 0, 0, 0, 1, 1, 1.1), hat],
        [new THREE.BoxGeometry(0.14, 0.012, 0.06), xf(0, 1.676, 0.155), hat],
      ]);
      const leg = colored([[new THREE.CapsuleGeometry(0.068, 0.66, 3, 10), xf(0, -0.42, 0), pants], [new THREE.BoxGeometry(0.11, 0.075, 0.25), xf(0, -0.8, 0.045), shoe]]);
      const arm = colored([[new THREE.CapsuleGeometry(0.05, 0.46, 3, 10), xf(0, -0.27, 0), shirt], [new THREE.SphereGeometry(0.048, 10, 8), xf(0, -0.56, 0.005), skin]]);
      const seated = colored([
        [torso, xf(0, 1.13, -0.05, -0.12, 0, 0, 1.12, 1, 0.68), shirt],
        [new THREE.CapsuleGeometry(0.17, 0.27, 4, 12), xf(0, 1.11, -0.05, -0.12, 0, 0, 1.14, 1, 0.72), vest],
        [new THREE.CylinderGeometry(0.197, 0.197, 0.04, 16, 1, true), xf(0, 1.0, -0.04, -0.12, 0, 0, 1, 1, 0.73), refl],
        [new THREE.SphereGeometry(0.102, 16, 12), xf(0, 1.58, -0.1), skin],
        [new THREE.SphereGeometry(0.122, 16, 8, 0, TAU, 0, PI / 2), xf(0, 1.62, -0.1, 0, 0, 0, 1, 0.92, 1.06), hat],
        [new THREE.CapsuleGeometry(0.07, 0.36, 3, 8), xf(-0.1, 0.84, 0.15, PI / 2, 0, 0), pants],
        [new THREE.CapsuleGeometry(0.07, 0.36, 3, 8), xf(0.1, 0.84, 0.15, PI / 2, 0, 0), pants],
        [new THREE.CapsuleGeometry(0.065, 0.36, 3, 8), xf(-0.1, 0.5, 0.36), pants],
        [new THREE.CapsuleGeometry(0.065, 0.36, 3, 8), xf(0.1, 0.5, 0.36), pants],
        [new THREE.CapsuleGeometry(0.05, 0.38, 3, 8), xf(-0.21, 1.24, 0.12, 1.1, 0, 0), shirt],
        [new THREE.CapsuleGeometry(0.05, 0.38, 3, 8), xf(0.21, 1.24, 0.12, 1.1, 0, 0), shirt],
      ]);
      return { body, leg, arm, seated };
    });
  }
  function blob(sx, sz) {
    const m = new THREE.Mesh(gPlaneY(), M.blob);
    m.scale.set(sx, 1, sz); m.position.y = 0.012; m.renderOrder = 0; m.castShadow = false; m.receiveShadow = false; return m;
  }
  function buildPeople() {
    const S = WF.sim.state;
    for (const pp of WF.profile.people) {
      const rk = roleOf(pp.role), G = personGeos(rk, skinOf(pp.id));
      const g = new THREE.Group();
      const body = new THREE.Mesh(G.body, M.vc); body.castShadow = false;
      const legL = grp(-0.09, 0.88, 0), legR = grp(0.09, 0.88, 0), armL = grp(-0.235, 1.42, 0), armR = grp(0.235, 1.42, 0);
      for (const [gg, geo] of [[legL, G.leg], [legR, G.leg], [armL, G.arm], [armR, G.arm]]) { const m = new THREE.Mesh(geo, M.vc); m.castShadow = false; gg.add(m); }
      // Trageobjekt in der rechten Hand: Werkzeug (Einrichter), Messteil (QS)
      const item = grp(0, -0.56, 0.06); item.visible = false;
      const tb = new Builder();
      if (rk === 'qs') { tb.box(M.black, 0.2, 0.012, 0.15, 0, -0.02, 0.05); tb.box(M.screen, 0.18, 0.004, 0.13, 0, -0.008, 0.05); }
      else { tb.latheY(M.steelDark, 'phsk', [[0, 0], [0.04, 0], [0.032, -0.06], [0.018, -0.08], [0, -0.08]], 0, 0, 0, 12); tb.cyl(M.steel, 0.012, 0.11, 0, -0.19, 0, 8); }
      tb.build(item, false); armR.add(item);
      g.add(body, legL, legR, armL, armR, blob(0.8, 0.62));
      const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(0.75, 1.85, 0.75); proxy.userData = { kind: 'person', id: pp.id }; g.add(proxy);
      g.visible = false; R.scene.add(g);
      const p = S.people[pp.id];
      R.people[pp.id] = { id: pp.id, g, legL, legR, armL, armR, item, proxy, rk, x: p ? p.pos.x : pp.home.x, z: p ? p.pos.z : pp.home.z, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, phase: Math.random() * 6, vis: false, work: 0, walk: 0, idleT: 0 };
    }
  }
  function buildAgvs() {
    for (const ap of WF.profile.agvs) {
      const g = new THREE.Group(), b = new Builder();
      b.rbox(M.dark, 0.84, 0.08, 1.28, 0.14, 0, 0.035, 0, 0, 0.01);
      b.rbox(M.paintW, 0.8, 0.22, 1.24, 0.14, 0, 0.1, 0, 0, 0.03);
      b.rbox(M.rubber, 0.66, 0.03, 0.98, 0.08, 0, 0.32, 0);
      for (const s of [-1, 1]) { b.box(M.black, 0.5, 0.07, 0.02, 0, 0.14, s * 0.623); b.box(M.yellow, 0.66, 0.045, 0.015, 0, 0.24, s * 0.624); }
      for (const [x, z] of [[-0.33, 0.55], [0.33, -0.55]]) b.box(M.black, 0.1, 0.07, 0.1, x, 0.26, z);
      b.cyl(M.black, 0.06, 0.06, 0.0, 0.32, 0.53, 18); b.cyl(M.steelDark, 0.045, 0.02, 0.0, 0.38, 0.53, 18);
      b.build(g);
      const led = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, toneMapped: false });
      const ring = mesh(gRBox(0.812, 0.026, 1.252, 0.14), led, 0, 0.212, 0); ring.castShadow = false; g.add(ring);
      const glow = new THREE.Mesh(gPlaneY(), new THREE.MeshBasicMaterial({ map: M.glowT, color: 0x3cc6f2, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      glow.scale.set(1.9, 1, 2.4); glow.position.y = 0.02; glow.renderOrder = 2; g.add(glow);
      g.add(blob(1.35, 1.75));
      const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(0.95, 0.7, 1.4); proxy.userData = { kind: 'agv', id: ap.id }; g.add(proxy);
      g.traverse(o => { if (o.isMesh) o.castShadow = false; });
      R.scene.add(g);
      R.agvs[ap.id] = { id: ap.id, g, led, glow, proxy, x: 0, z: 0, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, init: false };
      R.pick.push(proxy);
    }
  }
  function buildForklift() {
    const g = new THREE.Group(), b = new Builder();
    const body = new THREE.MeshStandardMaterial({ color: 0xe8a317, roughness: 0.42 });
    b.rbox(body, 1.06, 0.6, 1.5, 0.14, 0, 0.16, -0.1, 0, 0.035);
    b.rbox(M.dark, 1.1, 0.88, 0.48, 0.16, 0, 0.16, -0.92, 0, 0.04);
    b.box(M.black, 0.9, 0.06, 0.02, 0, 0.62, -1.17);
    for (const [x, z, r] of [[-0.47, 0.42, 0.24], [0.47, 0.42, 0.24], [-0.47, -0.72, 0.2], [0.47, -0.72, 0.2]]) { b.cylX(M.rubber, r, 0.2, x - 0.1, r, z, 20); b.cylX(M.steelDark, r * 0.5, 0.21, x - 0.105, r, z, 12); }
    for (const [x, z] of [[-0.48, -0.6], [0.48, -0.6], [-0.48, 0.38], [0.48, 0.38]]) b.box(M.black, 0.05, 1.38, 0.05, x, 0.76, z);
    b.box(M.black, 1.02, 0.04, 1.06, 0, 2.12, -0.11);
    for (let i = 0; i < 6; i++) b.box(M.black, 0.98, 0.02, 0.025, 0, 2.15, -0.58 + i * 0.19);
    b.rbox(M.black, 0.52, 0.12, 0.46, 0.06, 0, 0.76, -0.32); b.rbox(M.black, 0.5, 0.42, 0.09, 0.04, 0, 0.88, -0.55);
    b.add(new THREE.TorusGeometry(0.13, 0.016, 8, 20), M.black, xf(0, 1.16, 0.2, -1.0, 0, 0)); b.cyl(M.black, 0.02, 0.35, 0, 0.85, 0.27, 8);
    b.box(M.dark, 0.08, 2.25, 0.12, -0.32, 0.05, 0.78); b.box(M.dark, 0.08, 2.25, 0.12, 0.32, 0.05, 0.78); b.box(M.dark, 0.72, 0.08, 0.12, 0, 2.22, 0.78);
    b.cyl(M.chrome, 0.035, 1.4, -0.12, 0.3, 0.72, 10); b.cyl(M.chrome, 0.035, 1.4, 0.12, 0.3, 0.72, 10);
    b.build(g);
    const forks = grp(0, 0.1, 0), fb = new Builder();
    fb.box(M.darker, 0.8, 0.45, 0.05, 0, 0, 0.88); fb.box(M.steelDark, 0.1, 0.045, 1.05, -0.22, 0, 1.4); fb.box(M.steelDark, 0.1, 0.045, 1.05, 0.22, 0, 1.4);
    fb.build(forks); g.add(forks);
    const bars = grp(0, 0.08, 1.4); for (let i = 0; i < 5; i++) { const m = mesh(gCylC(10), M.steel, -0.2 + (i % 3) * 0.2, 0.04 + Math.floor(i / 3) * 0.07, 0, 0.032, 3.0, 0.032); m.rotation.z = PI / 2; bars.add(m); }
    bars.visible = false; forks.add(bars);
    const beacon = new THREE.MeshBasicMaterial({ color: 0xff9d3d, toneMapped: false });
    const bc = mesh(gCyl(12), beacon, 0.38, 2.16, -0.5, 0.05, 0.08, 0.05); bc.castShadow = false; g.add(bc);
    const spot = new THREE.Mesh(cache('spotg', () => new THREE.CircleGeometry(0.45, 24).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, map: M.glowT, toneMapped: false }));
    spot.position.set(0, 0.02, 3.0); g.add(spot);
    const driver = new THREE.Mesh(personGeos('log', SKIN[1]).seated, M.vc); driver.position.set(0, -0.02, -0.27); driver.visible = false; driver.castShadow = false; g.add(driver);
    g.add(blob(1.7, 2.5));
    const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(1.2, 2.2, 2.7); proxy.position.z = 0.2; proxy.userData = { kind: 'forklift', id: 'STP1' }; g.add(proxy);
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    R.scene.add(g);
    R.fork = { g, forks, bars, beacon, spot, driver, proxy, x: 0, z: 0, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, init: false, fy: 0.1, driverKey: null };
    R.pick.push(proxy);
  }

  // ================================================================== Behälter (instanziert)
  const CMAX = { klt: 160, gb: 90, rack: 30, wrap: 40 };
  function buildContainers() {
    const sc = R.scene, C = R.C = { list: [], byInst: { klt: [], gb: [], rack: [], wrap: [] }, waits: [], vers: [] };
    const inst = (geo, mat, n, shadow) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = shadow !== false; m.receiveShadow = true; m.frustumCulled = false; sc.add(m); return m; };
    C.klt = inst(cache('kltg', () => mergeGeos([[gOpenBox(0.6, 0.27, 0.4), new THREE.Matrix4()], [gBox(), xf(0, 0.235, 0.201, 0, 0, 0, 0.56, 0.035, 0.012)], [gBox(), xf(0, 0.235, -0.201, 0, 0, 0, 0.56, 0.035, 0.012)]])), M.klt, CMAX.klt);
    C.klt.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CMAX.klt * 3), 3);
    C.kltFill = inst(gBox(), M.parts, CMAX.klt, false);
    C.gbBase = inst(cache('gbbase', () => mergeGeos([[gBox(), xf(0, 0, 0, 0, 0, 0, 0.82, 0.11, 0.76)], ...[[-0.39, -0.36], [0.39, -0.36], [-0.39, 0.36], [0.39, 0.36]].map(([x, z]) => [gBox(), xf(x, 0, z, 0, 0, 0, 0.045, 0.8, 0.045)])])), M.steelDark, CMAX.gb);
    C.gb = inst(gOpenBox(0.8, 0.66, 0.74), M.gitter, CMAX.gb, false);
    C.gbFill = inst(gBox(), M.parts, CMAX.gb, false);
    C.rack = inst(cache('rackg', () => mergeGeos([
      [gBox(), xf(-0.36, 0, 0, 0, 0, 0, 0.06, 0.08, 1.4)], [gBox(), xf(0.36, 0, 0, 0, 0, 0, 0.06, 0.08, 1.4)],
      [gBox(), xf(0, 0.08, -0.5, 0, 0, 0, 0.82, 0.12, 0.1)], [gBox(), xf(0, 0.08, 0.5, 0, 0, 0, 0.82, 0.12, 0.1)],
      ...[[-0.36, -0.65], [0.36, -0.65], [-0.36, 0.65], [0.36, 0.65]].map(([x, z]) => [gBox(), xf(x, 0, z, 0, 0, 0, 0.06, 0.52, 0.06)])])), M.blueRack, CMAX.rack);
    C.shaft = inst(cache('shaftg', () => new THREE.CylinderGeometry(1, 1, 1, 22).rotateX(PI / 2)), M.steel, CMAX.rack * 3);
    C.wrap = inst(gRBox(1.16, 1, 0.8, 0.05), M.film, CMAX.wrap, false); C.wrap.renderOrder = 2;
    C.pal = inst(cache('palg', () => { const b = new Builder(); palletStatic(b, 0, 0, 0, 0); const l = []; for (const v of b.map.values()) l.push(...v); b.map.clear(); return mergeGeos(l); }), M.wood, CMAX.wrap);
    C.box = inst(cache('ctnL', () => mergeGeos([[-0.29, -0.195], [0.29, -0.195], [-0.29, 0.195], [0.29, 0.195]].map(([x, z]) => [gRBox(0.56, 0.29, 0.37, 0.015), xf(x, 0, z)]))), M.carton, CMAX.wrap * 3);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    C.ring = inst(cache('cring', () => new THREE.RingGeometry(0.6, 0.72, 40).rotateX(-PI / 2)), ringMat, 60, false); C.ring.renderOrder = 3; C.ring.receiveShadow = false;
    C.wait = inst(cache('wring', () => new THREE.RingGeometry(0.5, 0.6, 36).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0xff9d3d, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }), 40, false); C.wait.renderOrder = 3; C.wait.receiveShadow = false;
    [C.klt, C.gb, C.rack, C.wrap].forEach((m, i) => { m.userData = { kind: 'container', inst: ['klt', 'gb', 'rack', 'wrap'][i] }; R.pick.push(m); });
    M.kltParts = new THREE.Color('#2f6fc4'); M.kltScrap = new THREE.Color('#c8392f'); M.kltRaw = new THREE.Color('#7f8a93');
  }
  /** Versandplätze: je Auftrag ein Stellplatz. Das AGV setzt an VERSAND.inPos (58,5/28) ab und fährt diagonal vom
      Andockpunkt (55,5/31) an – Übergabequadrat (VERS_HAND) und Anfahrt bleiben frei, Paletten stehen längs (0,8 m breit)
      in zwei Reihen vor dem Regal und einer Reihe hinter der Anfahrt. */
  const VERS_HAND = 2.4;
  const VERS_SLOTS = (() => {
    const out = [];
    for (const x of [61.4, 60.2]) for (const z of [27.9, 29.4, 30.9, 32.4, 33.9, 35.4]) out.push({ x, z, ry: PI / 2 });
    for (const z of [32.0, 33.5, 35.0]) out.push({ x: 58.4, z, ry: PI / 2 });
    return out;
  })();
  function updateContainers(S) {
    const C = R.C, list = C.list; list.length = 0;
    const vers = new Map();
    for (const id in S.containers) {
      const c = S.containers[id], l = c.location;
      if (!l || c.state === 'external') continue;
      const o = S.orders[c.orderId]; const pw = o ? (o.part.weightKg || 0.1) : 0.1;
      if (c.state === 'shipped') { const v = vers.get(c.orderId) || { n: 0, qty: 0, kg: 0, last: id, t: 0 }; v.n++; v.qty += c.qty; v.kg += c.weightKg || 0; if ((c.createdT || 0) >= v.t) { v.t = c.createdT || 0; v.last = id; } vers.set(c.orderId, v); continue; }
      const type = pw > 50 ? 'rack' : (c.qty * pw) >= 25 ? 'gb' : 'klt';
      const srcR = o && c.src >= 0 ? o.routing[c.src] : (o ? o.routing[0] : null);
      const cap = srcR && srcR.transferBatch ? srcR.transferBatch : Math.max(1, c.qty);
      const e = { id, type, fill: clamp(c.qty / cap, 0.06, 1), scrap: c.kind === 'scrap', raw: c.kind === 'raw', qty: c.qty, carrier: null, x: 0, z: 0, ry: 0, order: c.orderId };
      if (l.kind === 'station') {
        const st = WF.profile.stationById[l.id]; if (!st) continue;
        const arr = S.stations[l.id] ? (l.slot === 'out' ? S.stations[l.id].out : S.stations[l.id].inp) : [];
        const k = Math.max(0, arr.indexOf(id));
        const p = (st.kind === 'machine' || st.kind === 'qs' || st.kind === 'assembly') ? slotPos(st, l.slot, k) : (() => { const cv = WF.sim.containerView(id); return cv && cv.pos; })();
        if (!p) continue;
        e.x = p.x; e.z = p.z;
      } else if (l.kind === 'agv') e.carrier = R.agvs[l.id] ? { kind: 'agv', id: l.id } : null;
      else if (l.kind === 'forklift') e.carrier = { kind: 'fork' };
      else continue;
      if (l.kind !== 'station' && !e.carrier) continue;
      list.push(e);
    }
    // Versand: Aufträge nach letzter Lieferung sortiert, älteste fallen bei Platzmangel heraus (gelten als abgeholt)
    C.vers = [...vers.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, VERS_SLOTS.length).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([oid, v], i) => ({ order: oid, ...v, slot: VERS_SLOTS[i] }));
    const waits = [];
    for (const id in S.transports) {
      const t = S.transports[id]; if (t.status !== 'open' || t.cancelled || !t.containerId) continue;
      const e = list.find(x => x.id === t.containerId); if (e && !e.carrier) waits.push(e);
    }
    C.waits = waits;
  }
  function writeContainers(t) {
    const C = R.C; if (!C) return;
    const n = { klt: 0, gb: 0, rack: 0, wrap: 0 }, sh = { n: 0 }, rings = { n: 0 }, boxes = { n: 0 };
    const hl = R.route && R.route.id, sel = R.selTarget && R.selTarget.kind === 'container' ? R.selTarget.id : null;
    for (const e of C.list) {
      let x = e.x, z = e.z, y = 0, ry = e.ry;
      if (e.carrier) {
        const car = e.carrier.kind === 'agv' ? R.agvs[e.carrier.id] : R.fork; if (!car) continue;
        ry = car.h;
        if (e.carrier.kind === 'agv') { x = car.x; z = car.z; y = 0.345; }
        else { const [ox, oz] = rotXZ(0, 1.4, car.h); x = car.x + ox; z = car.z + oz; y = R.fork.fy + 0.05; }
      }
      e.wx = x; e.wz = z;
      const k = e.type;
      if (n[k] >= CMAX[k]) continue;
      const i = n[k]++;
      C.byInst[k][i] = e.id;
      if (k === 'klt') {
        ixf(C.klt, i, x, y, z, ry, null, null, null); C.klt.setColorAt(i, e.scrap ? M.kltScrap : e.raw ? M.kltRaw : M.kltParts);
        ixf(C.kltFill, i, x, y + 0.02 + e.fill * 0.22, z, ry, 0.56, 0.012, 0.36);
      } else if (k === 'gb') {
        ixf(C.gbBase, i, x, y, z, ry, null, null, null); ixf(C.gb, i, x, y + 0.11, z, ry, null, null, null);
        ixf(C.gbFill, i, x, y + 0.13 + e.fill * 0.55, z, ry, 0.76, 0.012, 0.7);
      } else if (k === 'rack') {
        ixf(C.rack, i, x, y, z, ry, null, null, null);
        for (let s = 0; s < Math.min(3, e.qty); s++) { if (sh.n >= CMAX.rack * 3) break; const [ox, oz] = rotXZ(-0.22 + s * 0.22, 0, ry); ixf(C.shaft, sh.n++, x + ox, y + 0.28, z + oz, ry, 0.062, 0.062, 1.6); }
      }
      if (((hl && e.order === hl) || sel === e.id) && rings.n < 60) { const s = 1 + Math.sin(t * 4) * 0.06; ixf(C.ring, rings.n++, x, y + 0.03, z, 0, s * (k === 'rack' ? 1.4 : 1), 1, s * (k === 'rack' ? 1.4 : 1)); }
    }
    for (const v of C.vers) {
      if (n.wrap >= CMAX.wrap) break;
      const i = n.wrap++, p = v.slot, layers = clamp(Math.ceil(v.n / 2), 1, 3), hgt = layers * 0.3 + 0.03;
      C.byInst.wrap[i] = v.last;
      ixf(C.pal, i, p.x, 0, p.z, p.ry || 0, null, null, null); ixf(C.wrap, i, p.x, 0.142, p.z, p.ry || 0, 1, hgt, 1);
      for (let L = 0; L < layers && boxes.n < CMAX.wrap * 3; L++) ixf(C.box, boxes.n++, p.x, 0.146 + L * 0.3, p.z, p.ry || 0, null, null, null);
      if (hl && v.order === hl && rings.n < 60) { const s = 1.5 + Math.sin(t * 4) * 0.08; ixf(C.ring, rings.n++, p.x, 0.03, p.z, 0, s, 1, s); }
    }
    C.klt.count = C.kltFill.count = n.klt; C.gb.count = C.gbBase.count = C.gbFill.count = n.gb; C.rack.count = n.rack; C.shaft.count = sh.n; C.wrap.count = C.pal.count = n.wrap; C.box.count = boxes.n; C.ring.count = rings.n;
    for (const m of [C.klt, C.kltFill, C.gb, C.gbBase, C.gbFill, C.rack, C.shaft, C.wrap, C.pal, C.box, C.ring]) m.instanceMatrix.needsUpdate = true;
    if (C.klt.instanceColor) C.klt.instanceColor.needsUpdate = true;
    for (const k in n) C.byInst[k].length = n[k];
    let w = 0;
    for (const e of C.waits) { if (w >= 40) break; const s = 1 + 0.18 * Math.sin(t * 3.5 + w); ixf(C.wait, w++, e.x, 0.035, e.z, 0, s * (e.type === 'rack' ? 1.4 : 1), 1, s * (e.type === 'rack' ? 1.4 : 1)); }
    C.wait.count = w; C.wait.instanceMatrix.needsUpdate = true;
  }

  // ================================================================== Ebene Materialfluss (Transportwege)
  /** Band-Material: Breite als Uniform (wächst mit dem Kameraabstand, bleibt aus der Übersicht lesbar), w0 = Mindestbreite in m */
  function flowMaterial(hex, mode, w0, op) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: srgb(hex) }, uMode: { value: mode }, uOp: { value: op == null ? 1 : op }, uHalfW: { value: w0 / 2 } },
      vertexShader: 'attribute vec2 aN; uniform float uHalfW; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position + vec3(aN.x, 0.0, aN.y) * uHalfW; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uMode; uniform float uOp; varying vec2 vUv;
        void main(){
          float w = abs(vUv.y - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.1, 1.0, w);
          float edge = smoothstep(0.55, 0.85, w) * (1.0 - smoothstep(0.85, 1.0, w));
          float s = fract(vUv.x / 1.3 + uTime * 0.85);
          float chev = smoothstep(0.0, 0.06, s - w * 0.3) * (1.0 - smoothstep(0.14, 0.22, s - w * 0.3));
          float a; vec3 col = uColor;
          if (uMode < 0.5) { a = core * 0.38 + edge * 0.35 + chev * 0.95 * (1.0 - w * 0.4); col = uColor * (0.8 + chev * 0.7); }
          else if (uMode < 1.5) { float dsh = step(0.5, fract(vUv.x / 0.75 + uTime * 0.55)); a = (core * 0.5 + edge * 0.25) * dsh; }
          else { float dsh = step(0.4, fract(vUv.x / 0.9 + uTime * 0.45)); a = (core * 0.72) * dsh + chev * 0.3; }
          gl_FragColor = vec4(col, a * uOp);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    });
    m.userData.w0 = w0;
    return m;
  }
  /** Bandgeometrie entlang einer Polylinie am Boden: Mittellinie + Normale (aN), die Breite setzt der Shader;
      uv.x = Distanz bis zum Ziel (Pfeile laufen zum Ziel) */
  function ribbon(pts, y) {
    const n = pts.length, pos = new Float32Array(n * 6), nrm = new Float32Array(n * 4), uv = new Float32Array(n * 4), idx = [];
    const total = []; let acc = 0; total[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) { acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); total[i] = acc; }
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
      let dx = c.x - a.x, dz = c.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      pos[i * 6] = pos[i * 6 + 3] = pts[i].x; pos[i * 6 + 1] = pos[i * 6 + 4] = y; pos[i * 6 + 2] = pos[i * 6 + 5] = pts[i].z;
      nrm[i * 4] = -dz; nrm[i * 4 + 1] = dx; nrm[i * 4 + 2] = dz; nrm[i * 4 + 3] = -dx;
      uv[i * 4] = uv[i * 4 + 2] = total[i]; uv[i * 4 + 1] = 0; uv[i * 4 + 3] = 1;
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aN', new THREE.BufferAttribute(nrm, 2)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeBoundingSphere(); g.boundingSphere.radius += 2;
    return g;
  }
  /** Punkte ohne Doppelungen (< 5 cm) */
  function dedupe(pts) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - out[out.length - 1].x, pts[i].z - out[out.length - 1].z) > 0.05) out.push(pts[i]); return out; }
  function dropMesh(m) { if (!m) return; if (m.parent) m.parent.remove(m); m.geometry.dispose(); }
  function buildFlow() {
    R.flowMats = { loaded: flowMaterial('#ff9d3d', 0, 0.42), approach: flowMaterial('#ffb36b', 1, 0.28), route: flowMaterial('#3cc6f2', 0, 0.5),
      wait: flowMaterial('#ff9d3d', 1, 0.3, 0.4) };
    R.flowLines = new Map();
    R.flowGroup = new THREE.Group(); R.scene.add(R.flowGroup);
    // Zielmarker (Ring am Abgabeplatz)
    R.flowDst = new THREE.InstancedMesh(cache('fdst', () => new THREE.RingGeometry(0.42, 0.56, 32).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0xff9d3d, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), 30);
    R.flowDst.count = 0; R.flowDst.renderOrder = 3; R.flowDst.frustumCulled = false; R.flowGroup.add(R.flowDst);
    R.netGroup = new THREE.Group(); R.flowGroup.add(R.netGroup);
    // Auftragsfluss: Bögen als Röhren mit Radius aus dem Shader (uR × Gewicht aW) – aus der Übersicht einige Pixel dick;
    // zu den Enden hin ausgeblendet (kein harter Ansatz an der Maschine), Mitte am hellsten
    R.netMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: srgb('#ff9d3d') }, uOp: { value: 0.45 }, uR: { value: 0.05 } },
      vertexShader: 'attribute float aW; uniform float uR; varying float vU; void main(){ vU = uv.x; vec3 p = position + normal * uR * aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOp; varying float vU; void main(){ float a = smoothstep(0.0, 0.12, vU) * smoothstep(1.0, 0.88, vU); gl_FragColor = vec4(uColor * (0.85 + 0.35 * a), uOp * (0.45 + 0.55 * a) * max(a, 0.18)); }',
      transparent: true, depthWrite: false,
    });
    // Quelle/Ziel der Bögen: weiche Leuchtpunkte am Boden
    R.netEnds = new THREE.InstancedMesh(gPlaneY(), new THREE.MeshBasicMaterial({ map: M.glowT, color: 0xff9d3d, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 48);
    R.netEnds.count = 0; R.netEnds.renderOrder = 2; R.netEnds.frustumCulled = false; R.netGroup.add(R.netEnds);
    // Stoppmarker über vollen Eingangspuffern (wartende Transporte)
    const sc = cnv(128, 128), sg = sc.getContext('2d');
    sg.fillStyle = 'rgba(11,17,32,.85)'; sg.beginPath(); sg.arc(64, 64, 62, 0, TAU); sg.fill();
    sg.fillStyle = '#ff9d3d'; sg.beginPath(); sg.arc(64, 64, 54, 0, TAU); sg.fill();
    sg.fillStyle = '#0b1120'; sg.fillRect(30, 55, 68, 18);
    const stopMat = new THREE.SpriteMaterial({ map: tex(sc), transparent: true, depthWrite: false, toneMapped: false });
    R.stops = [];
    for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(stopMat); s.scale.set(1.1, 1.1, 1); s.visible = false; s.renderOrder = 6; R.flowGroup.add(s); R.stops.push(s); }
  }
  function carrierOf(tr, S) {
    if (!tr.assignee) return null;
    if (tr.mode === 'AGV') { const a = S.agvs[tr.assignee], e = R.agvs[tr.assignee]; return a && e ? { node: a.node, e } : null; }
    const p = S.people[tr.assignee]; if (!p) return null;
    return { node: p.node, e: p.vehicle ? R.fork : R.people[p.id] };
  }
  function slotOf(st, slot) { const p = slot === 'out' ? st.outPos : st.inPos; return p ? { x: p.x, z: p.z } : { x: st.dock.x, z: st.dock.z }; }
  function updateFlows(S) {
    const P = WF.profile, seen = new Set(), dst = [];
    for (const id in S.transports) {
      const tr = S.transports[id];
      if (tr.status === 'done' || tr.cancelled || tr.status === 'open') continue;
      const car = carrierOf(tr, S); if (!car || !car.node) continue;
      const loaded = tr.status === 'loaded' || tr.status === 'toDrop';
      const from = P.stationById[tr.from.station], to = P.stationById[tr.to.station]; if (!from || !to) continue;
      const cont = tr.containerId ? S.containers[tr.containerId] : null;
      const pick = cont && cont.location && cont.location.kind === 'station' ? (R.C.list.find(e => e.id === cont.id) || null) : null;
      const pickPt = pick ? { x: pick.x, z: pick.z } : slotOf(from, (tr.from && tr.from.slot) || 'out');
      const dropPt = slotOf(to, (tr.to && tr.to.slot) || 'in');
      dst.push(dropPt);
      const sig = [tr.status, car.node, pickPt.x.toFixed(1), pickPt.z.toFixed(1)].join('|');
      seen.add(id);
      let fl = R.flowLines.get(id);
      if (fl && fl.sig === sig) { fl.car = car; continue; }
      if (fl) { for (const m of fl.meshes) dropMesh(m); }
      fl = { sig, car, meshes: [], heads: [] };
      const legs = [];
      if (!loaded) {
        legs.push({ from: car.node, to: from, end: pickPt, mat: R.flowMats.approach, head: true });
        legs.push({ from: from.dockNode, to, end: dropPt, mat: R.flowMats.loaded, head: false, start: pickPt });
      } else legs.push({ from: car.node, to, end: dropPt, mat: R.flowMats.loaded, head: true });
      for (const lg of legs) {
        const path = U.path(P.graph, lg.from, lg.to.dockNode);
        const pts = path.points.map(p => ({ x: p.x, z: p.z }));
        if (lg.start) pts.unshift(lg.start);
        pts.push(lg.end);
        if (lg.head) pts.unshift({ x: car.e.x, z: car.e.z });
        const clean = dedupe(pts);
        if (clean.length < 2) continue;
        const m = new THREE.Mesh(ribbon(clean, lg.mat === R.flowMats.loaded ? 0.045 : 0.042), lg.mat);
        m.renderOrder = 2; m.frustumCulled = false; R.flowGroup.add(m); fl.meshes.push(m);
        if (lg.head) fl.heads.push({ m, p1: clean[1], u1: m.geometry.attributes.uv.array[4] });
      }
      R.flowLines.set(id, fl);
    }
    for (const [id, fl] of R.flowLines) if (!seen.has(id)) { for (const m of fl.meshes) dropMesh(m); R.flowLines.delete(id); }
    R.flowDstPts = dst;
    updateWaits(S);
  }
  /** Wartende Transporte ehrlich zeigen: gestrichelter Weg Behälter → Ziel, Stoppmarker am vollen Eingang,
      kleines Etikett mit dem Grund aus der Engine (waitCode/waitReason) und der Wartezeit. */
  const WAIT_TXT = { destFull: 'Ziel voll', noVehicle: 'kein Fahrzeug frei', charging: 'Fahrzeug lädt', noDriver: 'wartet auf Stapler' };
  function waitCodeOf(tr) {
    if (tr.waitCode) return tr.waitCode;
    const w = tr.waitReason || '';
    return /^Ziel/.test(w) ? 'destFull' : /lädt/.test(w) ? 'charging' : /Fahrzeug|AGV/.test(w) ? 'noVehicle' : /Stapler|Logistik/.test(w) ? 'noDriver' : 'other';
  }
  function updateWaits(S) {
    const P = WF.profile, groups = R.waitGroups || (R.waitGroups = new Map()), seen = R.waitSeen || (R.waitSeen = new Set());
    groups.clear(); seen.clear();
    for (const id in S.transports) {
      const tr = S.transports[id];
      if (tr.status !== 'open' || tr.cancelled || !tr.containerId || !tr.waitReason) continue;
      const code = waitCodeOf(tr); if (code === 'lowPrio') continue;
      const e = R.C.list.find(x => x.id === tr.containerId); if (!e || e.carrier) continue;
      const from = P.stationById[tr.from.station], to = P.stationById[tr.to.station]; if (!from || !to) continue;
      seen.add(id);
      const sig = e.x.toFixed(1) + ',' + e.z.toFixed(1) + '>' + to.id;
      let wl = R.waitLines.get(id);
      if (!wl || wl.sig !== sig) {
        if (wl) dropMesh(wl.m);
        const path = U.path(P.graph, from.dockNode, to.dockNode);
        const pts = dedupe([{ x: e.x, z: e.z }].concat(path.points.map(p => ({ x: p.x, z: p.z })), [slotOf(to, (tr.to && tr.to.slot) || 'in')]));
        let m = null;
        if (pts.length >= 2) { m = new THREE.Mesh(ribbon(pts, 0.04), R.flowMats.wait); m.renderOrder = 2; m.frustumCulled = false; R.flowGroup.add(m); }
        R.waitLines.set(id, wl = { sig, m });
      }
      const key = code === 'destFull' ? 'f|' + to.id : code + '|' + e.id;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { code, to, e, n: 0, age: 0, reason: tr.waitReason });
      g.n++; g.age = Math.max(g.age, S.t - (tr.createdT != null ? tr.createdT : S.t));
    }
    for (const [id, wl] of R.waitLines) if (!seen.has(id)) { dropMesh(wl.m); R.waitLines.delete(id); }
    // Stoppmarker + Etiketten je Grund (Ziel voll: je Ziel gebündelt)
    let si = 0;
    const keep = R.waitKeep || (R.waitKeep = new Set()); keep.clear();
    for (const [key, g] of groups) {
      const inSlot = g.code === 'destFull' ? (R.mo[g.to.id] ? slotPos(g.to, 'in', 0) : slotOf(g.to, 'in')) : null;
      if (inSlot && si < R.stops.length) { const s = R.stops[si++]; s.position.set(inSlot.x, 1.55, inSlot.z); s.visible = true; }
      keep.add(key);
      let l = R.wtLb[key];
      if (!l) {
        const lbEl = el('div', { class: 'h3-lb wt off' });
        R.ui.labels.append(lbEl);
        l = R.wtLb[key] = { el: lbEl, anchor: new THREE.Vector3(), wait: true, pri: 150, sizes: {}, x: -1, y: -1, shown: false, sig: '' };
      }
      if (inSlot) l.anchor.set(inSlot.x, 1.95, inSlot.z); else l.anchor.set(g.e.x, 0.9, g.e.z);
      const dur = U.fmtDur(g.age);
      const head = (WAIT_TXT[g.code] || g.reason) + (g.code === 'destFull' ? ' · seit ' + dur : ' · wartet ' + dur);
      const nIn = S.stations[g.to.id] ? S.stations[g.to.id].inp.length : null, cap = g.to.inCap;
      const sub = g.code === 'destFull'
        ? `${g.n === 1 ? '1 Behälter' : g.n + ' Behälter'} → ${g.to.short}${cap && nIn != null ? ` · Eingang ${nIn}/${cap}` : ''}`
        : `${fmtN(g.e.qty)} Stk → ${g.to.short}`;
      const sig = head + '|' + sub;
      if (sig !== l.sig) { l.sig = sig; l.sizes = {}; l.el.title = g.reason || ''; l.el.innerHTML = `<div class="r1"><i class="stp"></i><span class="o">${esc(head)}</span></div><div class="s">${esc(sub)}</div>`; }
    }
    for (; si < R.stops.length; si++) R.stops[si].visible = false;
    for (const key in R.wtLb) if (!keep.has(key)) { const l = R.wtLb[key]; l.el.remove(); if (l.ln) { l.ln.remove(); l.dot.remove(); } delete R.wtLb[key]; }
  }
  /** Flussnetz: Verbindungen zwischen den Stationen aller offenen Aufträge (A → B → C), als Bögen mit laufenden Punkten */
  function netEnd(id, from) {
    const st = WF.profile.stationById[id === 'EXT' && from ? 'WE' : id]; if (!st) return null;
    const p = from ? (st.outPos || st.dock) : (st.inPos || st.dock);
    return new THREE.Vector3(p.x, st.kind === 'zone' ? 0.25 : 0.9, p.z);
  }
  function updateNet(S) {
    const links = new Map();
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status === 'fertig') continue;
      for (let i = 0; i < o.routing.length - 1; i++) {
        if (o.ops[i + 1] && o.ops[i + 1].complete) continue;
        const a = o.routing[i].station, b = o.routing[i + 1].station;
        const k = (a === 'EXT' ? 'WE' : a) + '>' + b;
        const l = links.get(k) || { a, b, n: 0, orders: [] }; l.n++; l.orders.push(oid); links.set(k, l);
      }
    }
    const sig = [...links.keys()].sort().map(k => k + links.get(k).n).join(',');
    if (sig === R.netSig) return;
    R.netSig = sig;
    const g = R.netGroup;
    for (let i = g.children.length - 1; i >= 0; i--) { const c = g.children[i]; if (c === R.netEnds) continue; g.remove(c); c.geometry.dispose(); }
    R.netLinks = [];
    const ends = new Map();
    for (const l of links.values()) {
      const A = netEnd(l.a, true), B = netEnd(l.b, false); if (!A || !B) continue;
      const d = A.distanceTo(B); if (d < 0.5) continue;
      const mid = A.clone().lerp(B, 0.5); mid.y += 3 + d * 0.12;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B), pts = curve.getPoints(28);
      // Röhre mit (fast) Nullradius: der Shader schiebt die Ecken entlang der Normalen auf uR × aW
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.001, 6, false);
      const aw = new Float32Array(geo.attributes.position.count).fill(1 + 0.35 * Math.min(4, l.n));
      geo.setAttribute('aW', new THREE.BufferAttribute(aw, 1));
      const m = new THREE.Mesh(geo, R.netMat);
      m.renderOrder = 2; m.frustumCulled = false; g.add(m);
      R.netLinks.push({ path: withLen(pts), n: l.n, acc: Math.random() * 3, l });
      for (const [p, k] of [[A, 'a' + l.a], [B, 'b' + l.b]]) if (!ends.has(k)) ends.set(k, p);
    }
    let k = 0;
    for (const p of ends.values()) { if (k >= 48) break; ixf(R.netEnds, k++, p.x, 0.05, p.z, 0, 1.5, 1, 1.5); }
    R.netEnds.count = k; R.netEnds.instanceMatrix.needsUpdate = true;
  }
  function netPulses(dt) {
    if (!R.netLinks || !R.layers.flow || WF.app.paused || (R.netK != null && R.netK < 0.3)) return;
    for (const k of R.netLinks) {
      k.acc += dt * (0.22 + 0.12 * Math.min(4, k.n));
      if (k.acc >= 1) { k.acc = 0; spawnPulse(k.path, { size: 0.68, speed: 5.5, alpha: 0.95, col: PCOL.mat, net: true }); }
    }
  }
  /** pro Bild: Anfang des Bands an die angezeigte Trägerposition setzen */
  function flowHeads(t) {
    for (const [, fl] of R.flowLines) for (const h of fl.heads) {
      const e = fl.car && fl.car.e; if (!e) continue;
      const pos = h.m.geometry.attributes.position, uv = h.m.geometry.attributes.uv, nr = h.m.geometry.attributes.aN, a = pos.array, n = nr.array;
      let dx = h.p1.x - e.x, dz = h.p1.z - e.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      a[0] = a[3] = e.x; a[2] = a[5] = e.z;
      n[0] = -dz; n[1] = dx; n[2] = dz; n[3] = -dx;
      uv.array[0] = uv.array[2] = h.u1 + l;
      pos.needsUpdate = true; uv.needsUpdate = true; nr.needsUpdate = true;
    }
    const d = R.flowDstPts || [];
    let k = 0;
    for (const p of d) { if (k >= 30) break; const s = 0.9 + 0.12 * Math.sin(t * 4 + k); ixf(R.flowDst, k++, p.x, 0.04, p.z, 0, s, 1, s); }
    R.flowDst.count = k; R.flowDst.instanceMatrix.needsUpdate = true;
  }

  // ================================================================== Ebene Datenfluss (Pulse zum MES-Server, Meldungen an Personen)
  const PULSE_N = 150, PULSE_PTS = 5;
  function buildPulses() {
    const n = PULSE_N * PULSE_PTS, pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC; uniform float uScale; void main(){ vA = aAlpha; vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / -mv.z, 2.0, uScale * 0.02); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); float core = smoothstep(0.18, 0.0, d); if (vA <= 0.001) discard; gl_FragColor = vec4(vC * (0.6 + a) + vec3(core * 0.8), a * a * vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; R.scene.add(pts);
    R.pulse = { pts, g, pos, size, alpha, col, mat, list: [], free: [] };
    for (let i = 0; i < PULSE_N; i++) R.pulse.free.push(i);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    R.pings = [];
    for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(cache('pingg', () => new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-PI / 2)), ringMat.clone()); m.visible = false; m.renderOrder = 4; R.scene.add(m); R.pings.push({ m, t: 1, follow: null }); }
    // Abzweige der Kabeltrasse zu angebundenen Maschinen
    R.branches = {};
    for (const mo of R.moList) {
      if (!mo.connW) continue;
      const b = new Builder(), p = mo.connW, TY = R.TRAY_Y;
      const zT = 22;
      if (Math.abs(p.z - zT) > 0.1) { const len = Math.abs(p.z - zT), mz = (p.z + zT) / 2; b.box(M.tray, 0.02, 0.05, len, p.x - 0.09, TY - 0.06, mz); b.box(M.tray, 0.02, 0.05, len, p.x + 0.09, TY - 0.06, mz); b.box(M.cable, 0.1, 0.025, len, p.x, TY - 0.05, mz); for (let z = Math.min(p.z, zT); z < Math.max(p.z, zT); z += 0.5) b.box(M.tray, 0.2, 0.012, 0.025, p.x, TY - 0.06, z); }
      b.cyl(M.cable, 0.018, TY - p.y, p.x, p.y, p.z, 6);
      b.rbox(M.dark, 0.16, 0.12, 0.1, 0.02, p.x, p.y, p.z);
      const g = new THREE.Group(); b.build(g, false); R.scene.add(g);
      R.branches[mo.id] = g;
      mo.path = pulsePath(mo);
    }
  }
  function pulsePath(mo) {
    const p = mo.connW, TY = R.TRAY_Y, srv = WF.profile.stationById.OFFICE.server;
    const pts = [new THREE.Vector3(p.x, p.y + 0.15, p.z), new THREE.Vector3(p.x, TY, p.z), new THREE.Vector3(p.x, TY, 22),
      new THREE.Vector3(58.5, TY, 22), new THREE.Vector3(58.5, TY, 4.6), new THREE.Vector3(srv.x, TY, 4.6), new THREE.Vector3(srv.x, 2.15, srv.z + 0.3)];
    return withLen(pts);
  }
  function withLen(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1])); return { pts, L, len: L[L.length - 1] }; }
  function pointAt(path, d, out) {
    const { pts, L } = path; if (d <= 0) return out.copy(pts[0]);
    for (let i = 1; i < pts.length; i++) if (d <= L[i]) { const k = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1); return out.copy(pts[i - 1]).lerp(pts[i], k); }
    return out.copy(pts[pts.length - 1]);
  }
  const PCOL = { info: srgb('#3cc6f2'), warn: srgb('#fbbf24'), crit: srgb('#f87171'), ok: srgb('#34d399'), mat: srgb('#ff9d3d') };
  function spawnPulse(path, o = {}) {
    const P = R.pulse; if (!P || !P.free.length) return;
    const slot = P.free.pop();
    P.list.push({ slot, path, d: 0, speed: o.speed || 22, size: o.size || 0.55, onEnd: o.onEnd || null, a: o.alpha || 1, col: o.col || PCOL.info, net: !!o.net });
  }
  function arcPath(a, b, h) {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; const v = new THREE.Vector3().lerpVectors(a, b, t); v.y += Math.sin(t * PI) * h; pts.push(v); }
    return withLen(pts);
  }
  function ping(x, y, z, follow, scale, hex) {
    const p = R.pings.find(q => q.t >= 1) || R.pings[0];
    p.t = 0; p.m.visible = true; p.m.position.set(x, y, z); p.follow = follow || null; p.s = scale || 1;
    p.m.material.color.setHex(hex || 0x3cc6f2);
  }
  function onSimEvent(e) {
    if (!R.ok || !R.visible || !R.layers.data || !e) return;
    const mid = e.entity && e.entity.kind === 'machine' ? e.entity.id : (e.data && e.data.station) || null;
    const mo = mid && R.mo[mid]; if (!mo) return;
    if (e.type === 'state' && e.data && e.data.minor) return;
    const m = WF.sim.state.machines[mid], lv = m && m.conn ? m.conn.level : 0;
    if (lv >= 1 && mo.path) {
      const big = e.sev === 'crit' || e.sev === 'warn' || e.type === 'fault';
      spawnPulse(mo.path, { size: big ? 0.85 : 0.55, speed: 24, col: PCOL[e.sev] && e.sev !== 'ok' ? PCOL[e.sev] : PCOL.info, onEnd: () => { R.serverHit = 1; } });
    } else if (mo.tablet) mo.tablet.flash = 1;
  }
  const NOTIF_ROLE = { Einrichter: ['setter'], QS: ['qs'], Logistik: ['log'], Instandhaltung: ['maint', 'setter'], Schichtleitung: ['lead'], Einkauf: [] };
  function onNotify(n) {
    if (!R.ok || !R.visible || !R.layers.data || !n || n.status !== 'open' || R.seenNotif.has(n.id)) return;
    R.seenNotif.add(n.id);
    if (R.seenNotif.size > 600) R.seenNotif = new Set([...R.seenNotif].slice(-300));
    const S = WF.sim.state, srv = WF.profile.stationById.OFFICE.server;
    const from = new THREE.Vector3(srv.x, 2.3, srv.z);
    const col = PCOL[n.sev] || PCOL.info, hex = n.sev === 'crit' ? 0xf87171 : n.sev === 'warn' ? 0xfbbf24 : 0x3cc6f2;
    let targets = [];
    for (const rk of NOTIF_ROLE[n.role] || []) {
      targets = Object.values(S.people).filter(p => p.onDuty && p.state !== 'offShift' && p.state !== 'break' && roleOf(p.role) === rk);
      if (targets.length) break;
    }
    if (!targets.length) { const tv = new THREE.Vector3(61.4, 2.0, 7.7); spawnPulse(arcPath(from, tv, 2), { size: 0.5, speed: 10, col, onEnd: () => ping(61.4, 0.05, 7.9, null, 1.4, hex) }); return; }
    for (const p of targets.slice(0, 2)) {
      const pe = R.people[p.id]; if (!pe) continue;
      const to = new THREE.Vector3(pe.x, 1.9, pe.z);
      spawnPulse(arcPath(from, to, 5 + to.distanceTo(from) * 0.12), { size: n.sev === 'crit' ? 0.8 : 0.62, speed: 26, col, onEnd: () => ping(pe.x, 0.04, pe.z, pe, 1, hex) });
    }
  }

  // ================================================================== Auswahl, Hover, Auftragsroute
  function buildHighlights() {
    const sc = R.scene;
    // Ecken-Klammern (Auswahl) – Linien, pulsierend
    const pts = [], L = 0.16;
    for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) pts.push(x, y, z, x - Math.sign(x) * L, y, z, x, y, z, x, y + (y ? -L : L), z, x, y, z, x, y, z - Math.sign(z) * L);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    R.selBox = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x3cc6f2, transparent: true, depthWrite: false, toneMapped: false }));
    R.selBox.visible = false; R.selBox.renderOrder = 7; sc.add(R.selBox);
    R.selRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, depthWrite: false, toneMapped: false }));
    R.selRing.visible = false; R.selRing.renderOrder = 4; sc.add(R.selRing);
    R.route = { group: new THREE.Group(), id: null, steps: [], sig: '' }; sc.add(R.route.group);
  }
  function boundsOf(sel) {
    if (!sel || !sel.kind) return null;
    if (sel.kind === 'machine' && R.mo[sel.id]) { const mo = R.mo[sel.id], f = mo.st.footprint; return { x: mo.cx, z: mo.cz, w: f.w + 0.35, d: f.d + 0.35, h: mo.h + 0.15 }; }
    if (sel.kind === 'store') { const st = WF.profile.stationById[sel.id]; if (st && st.footprint) { const f = st.footprint; return { x: f.x + f.w / 2, z: f.z + f.d / 2, w: f.w + 0.2, d: f.d + 0.2, h: sel.id === 'PUF' ? 4.4 : sel.id === 'RAW' ? 3.4 : 2.7 }; } }
    return null;
  }
  function selTargetOf(sel) {
    if (!sel || !sel.kind) return null;
    const S = WF.sim.state;
    if (sel.kind === 'tool') { const t = S.tools[sel.id]; return t && t.machineId ? { kind: 'machine', id: t.machineId } : { kind: 'store', id: 'CRIB' }; }
    if (sel.kind === 'material') return { kind: 'store', id: 'RAW' };
    if (sel.kind === 'notification') { const n = (S.notifications || []).find(x => x.id === sel.id); return n && n.entity ? selTargetOf(n.entity) : null; }
    if (sel.kind === 'station') return R.mo[sel.id] ? { kind: 'machine', id: sel.id } : { kind: 'store', id: sel.id };
    return { kind: sel.kind, id: sel.id };
  }
  function applySelection(sel) {
    R.sel = sel && sel.kind ? { kind: sel.kind, id: sel.id } : null;
    if (R.follow && (!R.sel || R.sel.id !== R.follow.id)) R.follow = null;
    R.tipSup = R.tipSup || (R.hover ? { x: R.mouse.x, y: R.mouse.y } : null);   // Hover-Karte nicht über dem neuen Drawer zeigen
    clearRoute();
    if (R.sel && R.sel.kind === 'order') buildRoute(R.sel.id);
    const target = selTargetOf(R.sel);
    R.selTarget = target;
    const bnd = boundsOf(target);
    if (bnd) { R.selBox.visible = true; R.selBox.position.set(bnd.x, 0, bnd.z); R.selBox.scale.set(bnd.w, bnd.h, bnd.d); }
    else R.selBox.visible = false;
    R.selRing.visible = !!(target && (target.kind === 'person' || target.kind === 'agv' || target.kind === 'container' || target.kind === 'forklift'));
    for (const id in R.lb) R.lb[id].el.classList.toggle('sel', !!(target && target.kind === 'machine' && target.id === id));
    for (const mo of R.moList) mo.hlT = null;
    if (R.ui.sheet && R.ui.sheet.dataset.s === 'steps') closeMenus();
    layoutModes();
    renderSelBar(); renderMapSel(); renderTip(false);
  }
  function clearRoute() {
    const r = R.route; r.id = null; r.steps = []; r.sig = ''; r.lim = null;
    while (r.group.children.length) { const c = r.group.children.pop(); if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); if (c.material && c.material.map) c.material.map.dispose(); if (c.material && c.material.userData.own) c.material.dispose(); }
    for (const id in R.rtLb) { const l = R.rtLb[id]; l.el.remove(); if (l.ln) { l.ln.remove(); l.dot.remove(); } }
    R.rtLb = {};
    for (const id in R.lb) { R.lb[id].el.classList.remove('dim'); R.lb[id].onRoute = false; }
  }
  const OPC = { done: '#34d399', active: '#3cc6f2', external: '#ff9d3d', waiting: '#fbbf24', open: '#7b8aa8' };
  /** Kurzname einer Station für kompakte Etiketten ('M09', 'QS', 'Extern', 'Versand') */
  const stationTag = (st) => (st.kind === 'machine' || st.id === 'QS' || st.id === 'M13') ? st.id : st.id === 'EXT' ? 'Extern' : st.short;
  /** Begrenzender Schritt eines Auftrags (wie Aufträge: Engine limit, sonst bottleneckStation); plant = Werks-Engpass (bottleneck()) */
  function routeLimit(ov) {
    let st = null, seq = null;
    if (ov.limit && ov.limit.stationId) { st = ov.limit.stationId; seq = ov.limit.seq; }
    else if (ov.bottleneckStation) { st = ov.bottleneckStation; try { const f = WF.sim.forecast().orders[ov.id]; seq = f ? f.bottleneckSeq : null; } catch (e) { seq = null; } }
    if (!st) return null;
    let bw = null; try { bw = WF.sim.bottleneck ? WF.sim.bottleneck() : null; } catch (e) { bw = null; }
    return { st, seq: seq == null ? null : seq, plant: !!(bw && bw.stationId === st) };
  }
  /** Etikettenanker eines Schritts: über der Maschine (nicht am gemeinsamen Gang) bzw. Mitte der Zone */
  function stepAnchor(st) {
    const mo = R.mo[st.id];
    if (mo) return new THREE.Vector3(mo.cx, mo.h + 0.4, mo.cz);
    const f = st.footprint; if (f) return new THREE.Vector3(f.x + f.w / 2, 1.2, f.z + f.d / 2);
    return new THREE.Vector3(st.dock.x, 1, st.dock.z);
  }
  /** Nummernscheibe am Boden vor der Station (zwischen Gang und Arbeitsplatz); weitere Besuche versetzt */
  function stepSpot(st, k) {
    const d = st.dock, w = st.work || st.dock;
    let x = d.x + (w.x - d.x) * 0.72, z = d.z + (w.z - d.z) * 0.72;
    const off = (k - 1) * 1.8;
    if (Math.abs(w.z - d.z) >= Math.abs(w.x - d.x)) x += off; else z += off;
    return { x, z };
  }
  function buildRoute(orderId) {
    let ov = null; try { ov = WF.sim.orderView(orderId); } catch (e) { ov = null; }
    if (!ov) return;
    const r = R.route, P = WF.profile; r.id = orderId;
    r.sig = ov.ops.map(o => o.state + ':' + o.good).join(',');
    const lim = r.lim = routeLimit(ov);
    const used = {}, chain = [];
    ov.ops.forEach((op, i) => {
      const st = P.stationById[op.station]; if (!st) return;
      const k = used[op.station] = (used[op.station] || 0) + 1;
      const sp = stepSpot(st, k);
      const isLim = !!(lim && lim.st === op.station && (lim.seq == null || lim.seq === op.seq));
      chain.push({ op, i, st, x: sp.x, z: sp.z, lim: isLim, anchor: stepAnchor(st) });
    });
    // Linien von Station zu Station (Fremdbearbeitung: Rückkehr über den Wareneingang)
    const weSpot = stepSpot(P.stationById.WE, 1);
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1], viaWE = a.st.id === 'EXT';
      const path = U.path(P.graph, viaWE ? P.stationById.WE.dockNode : a.st.dockNode, b.st.dockNode);
      const pts = dedupe([viaWE ? weSpot : { x: a.x, z: a.z }].concat(path.points.map(p => ({ x: p.x, z: p.z })), [{ x: b.x, z: b.z }]));
      if (pts.length < 2) continue;
      const m = new THREE.Mesh(ribbon(pts, 0.05), R.flowMats.route); m.renderOrder = 2; m.frustumCulled = false; r.group.add(m);
    }
    if (chain.some(c => c.st.id === 'EXT')) {
      const disc = new THREE.Mesh(cache('rdisc', () => { const g = new THREE.CircleGeometry(0.6, 28).rotateX(-PI / 2); g.userData.shared = true; return g; }), new THREE.MeshBasicMaterial({ map: texLabel('WE', { w: 128, h: 128, px: 50, bg: '#ff9d3d', color: '#0b1120' }), transparent: true, depthWrite: false, toneMapped: false }));
      disc.material.userData.own = true; disc.position.set(weSpot.x, 0.065, weSpot.z); disc.renderOrder = 3; r.group.add(disc);
    }
    chain.forEach((c, n) => {
      const col = OPC[c.op.state] || OPC.open;
      const t = cnv(128, 128), g = t.getContext('2d');
      g.fillStyle = c.lim ? '#fbbf24' : col; g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fill();
      g.fillStyle = '#0b1120'; g.beginPath(); g.arc(64, 64, 47, 0, TAU); g.fill();
      g.fillStyle = col; g.font = FONT(700, 62); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n + 1), 64, 68);
      const disc = new THREE.Mesh(cache('rdisc2', () => { const gg = new THREE.CircleGeometry(0.8, 32).rotateX(-PI / 2); gg.userData.shared = true; return gg; }), new THREE.MeshBasicMaterial({ map: tex(t), transparent: true, depthWrite: false, toneMapped: false }));
      disc.material.userData.own = true; disc.position.set(c.x, 0.07, c.z); disc.renderOrder = 3; r.group.add(disc);
      const done = c.op.state === 'done', cur = c.op.state === 'active';
      const cnt = c.op.target ? ` · ${fmtN(c.op.good)}/${fmtN(c.op.target)}` : '';
      const stName = (c.st.kind === 'machine' ? c.st.id + ' ' : '') + (c.op.stationName || c.st.short);
      const kTxt = c.lim ? (lim.plant ? 'Engpass' : 'kritisch') : '';
      const lbEl = el('div', { class: 'h3-lb rt off' + (c.lim ? ' lim' : '') + (cur ? ' cur' : ''), style: { '--rc': col } });
      lbEl.title = `AG ${c.op.seq} · ${c.op.op || ''} – ${stName} · ${c.op.stateLabel || ''}${cnt}${c.lim ? (lim.plant ? ' · Werks-Engpass' : ' · begrenzt den Durchlauf') : ''}`;
      lbEl.innerHTML = `<div class="r1"><span class="n">${n + 1}</span><span class="cc">${esc(stationTag(c.st))}${done ? ' ✓' : ''}</span><span class="o">AG ${c.op.seq} · ${esc(c.op.op || c.op.stationName || '')}</span>${kTxt ? `<span class="k">${kTxt}</span>` : ''}</div><div class="s">${esc(stName)} · ${esc(c.op.stateLabel || '')}${cnt}</div>`;
      R.ui.labels.append(lbEl);
      // aktiver und begrenzender Schritt zuerst – sie fallen nie weg
      R.rtLb['s' + n] = { el: lbEl, anchor: c.anchor, x: -1, y: -1, shown: false, route: true, sizes: {}, v: '', pri: c.lim ? 230 : cur ? 220 : 200 - n * 0.01, col };
    });
    const onRoute = new Set(chain.map(c => c.st.id));
    for (const id in R.lb) { const l = R.lb[id]; l.onRoute = onRoute.has(id); l.el.classList.toggle('dim', !l.onRoute); }
    r.steps = chain;
  }
  function refreshRoute() {
    if (!R.route.id) return;
    let ov = null; try { ov = WF.sim.orderView(R.route.id); } catch (e) { ov = null; }
    if (!ov) return;
    const lim = routeLimit(ov);
    const sig = ov.ops.map(o => o.state + ':' + o.good).join(',');
    const ls = lim ? lim.st + lim.seq + lim.plant : '', ol = R.route.lim ? R.route.lim.st + R.route.lim.seq + R.route.lim.plant : '';
    if (sig !== R.route.sig || ls !== ol) { const id = R.route.id; clearRoute(); buildRoute(id); if (R.ui.sheet && R.ui.sheet.dataset.s === 'steps' && !R.ui.sheet.hidden) renderSteps(); }
  }

  // ================================================================== Kamera
  // phi/th = Blickrichtung; fit = Stationen, die vollständig im freien Bildbereich liegen sollen (Übersicht: ganze Halle);
  // zone = Maschinen mit ausführlichem Etikett
  const PRESETS = [
    { id: 'uebersicht', label: 'Übersicht', short: 'Übersicht', icon: 'grid', phi: 46, th: 18 },
    { id: 'dreherei', label: 'Dreherei / Sonderbearbeitung', short: 'Dreherei', icon: 'factory', phi: 52, th: 12, zone: ['M01', 'M02', 'M03', 'M04', 'M07', 'M08'], fit: ['M01', 'M02', 'M03', 'M04', 'M07', 'M08'] },
    { id: 'fraeserei', label: 'Fräserei / Schleiferei', short: 'Fräserei', icon: 'factory', phi: 37, th: 194, zone: ['M05', 'M06', 'M09', 'M10', 'M11'], fit: ['M05', 'M06', 'M09', 'M10', 'M11'] },
    { id: 'logistik', label: 'Logistik & Lager', short: 'Logistik', icon: 'box', phi: 50, th: 6, zone: [], fit: ['RAW', 'CRIB', 'MAINT', 'PUF', 'CHG'] },
    { id: 'messraum', label: 'Messraum & Versand', short: 'Messraum', icon: 'target', phi: 50, th: 30, zone: ['QS', 'M13'], fit: ['QS', 'M13', 'VERSAND'] },
  ];
  function camState() {
    const c = R.camera.position, t = R.controls.target;
    V1.copy(c).sub(t);
    const r = V1.length(), phi = Math.acos(clamp(V1.y / r, -1, 1)), th = Math.atan2(V1.x, V1.z);
    return { tx: t.x, ty: t.y, tz: t.z, r, phi, th };
  }
  function goCam(dst, dur) {
    R.introPending = false;
    const src = camState();
    const th = src.th + angD(src.th, dst.th);
    const d = Math.hypot(dst.tx - src.tx, dst.tz - src.tz) + Math.abs(dst.r - src.r) * 0.5 + Math.abs(angD(src.th, dst.th)) * 20;
    R.tween = { t: 0, dur: dur == null ? clamp(0.7 + d / 70, 0.8, 1.6) : dur, src, dst: { tx: dst.tx, ty: dst.ty || 0, tz: dst.tz, r: dst.r, phi: dst.phi, th } };
  }
  function setCam(s) {
    const sp = Math.sin(s.phi);
    R.controls.target.set(s.tx, s.ty, s.tz);
    R.camera.position.set(s.tx + s.r * sp * Math.sin(s.th), s.ty + s.r * Math.cos(s.phi), s.tz + s.r * sp * Math.cos(s.th));
    R.camera.lookAt(R.controls.target);
  }

  // ---------- Einpassen in den freien Bildbereich (Fläche minus Drawer, Bedienfelder, Tour-Karte)
  /** Bedienfelder, die Fläche belegen (ohne kurzlebige Menüs/Hinweis); Rechtecke in Root-Koordinaten mit Rand */
  function fitRects() {
    const rr = R.root.getBoundingClientRect(), out = [];
    const add = (n, pad) => { if (!n || n.hidden) return; const b = n.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return; out.push([b.left - rr.left - pad, b.top - rr.top - pad, b.right - rr.left + pad, b.bottom - rr.top + pad]); };
    for (const n of [R.ui.status, R.ui.mapbox, R.ui.tb, R.ui.sel, R.ui.mbar]) add(n, 8);
    const tc = document.querySelector('.tour-card:not(.center)'); if (tc) add(tc, 10);
    return out;
  }
  function layoutSig() {
    let s = R.w + 'x' + R.h + '|' + (R.drawerW || 0);
    for (const q of fitRects()) s += '|' + Math.round(q[0] / 16) + ',' + Math.round(q[1] / 16) + ',' + Math.round(q[2] / 16) + ',' + Math.round(q[3] / 16);
    return s;
  }
  /** Eckpunkte einer Station (Grundfläche unten und in Höhe h) – für Zonen ein Ausschnitt um den Bezugspunkt */
  function pushFoot(pts, st, hMax, pad, around) {
    if (!st) return;
    const mo = R.mo[st.id], p = pad || 0;
    let f = st.footprint;
    if (around || !f) { const c = around || st.dock; f = { x: c.x - 2.5, z: c.z - 2.5, w: 5, d: 5 }; }
    const h = Math.min(hMax, mo ? mo.h : st.id === 'PUF' ? 4.3 : st.id === 'RAW' ? 3.3 : 1);
    for (const y of [0, h]) for (const [x, z] of [[f.x - p, f.z - p], [f.x + f.w + p, f.z - p], [f.x - p, f.z + f.d + p], [f.x + f.w + p, f.z + f.d + p]]) pts.push(new THREE.Vector3(x, y, z));
  }
  let FC = null, FV = null;
  /** Kleinster Abstand r (und Zielpunkt), bei dem alle Punkte im freien Bereich liegen – Rastersuche über den Zielpunkt,
      Bisektion über r (bei festem Ziel schrumpft das Bild mit r monoton zum Zielpunkt hin). */
  function solveFit(pts, phi, th, rMin, rMax) {
    if (!FC) { FC = new THREE.PerspectiveCamera(); FV = new THREE.Vector3(); }
    const W = R.w, H = R.h, dw = R.drawerW || 0, m = 14, HP = WF.profile.hall;
    FC.fov = R.camera.fov; FC.near = R.camera.near; FC.far = R.camera.far; FC.aspect = W / H;
    if (dw > 0.5) FC.setViewOffset(W, H, dw / 2, 0, W, H); else FC.clearViewOffset();
    FC.updateProjectionMatrix();
    const bx0 = m, by0 = m, bx1 = W - dw - m, by1 = H - m, rects = fitRects();
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0, 6);
    const sp = Math.sin(phi), cp = Math.cos(phi), st = Math.sin(th), ct = Math.cos(th);
    const ok = (tx, tz, r) => {
      FC.position.set(tx + r * sp * st, r * cp, tz + r * sp * ct); FC.lookAt(tx, 0, tz); FC.updateMatrixWorld(true);
      for (let i = 0; i < pts.length; i++) {
        FV.copy(pts[i]).project(FC);
        if (FV.z > 1 || FV.z < -1) return false;
        const sx = (FV.x + 1) / 2 * W, sy = (1 - FV.y) / 2 * H;
        if (sx < bx0 || sx > bx1 || sy < by0 || sy > by1) return false;
        for (let k = 0; k < rects.length; k++) { const q = rects[k]; if (sx > q[0] && sx < q[2] && sy > q[1] && sy < q[3]) return false; }
      }
      return true;
    };
    let best = null;
    const tryAt = (tx, tz) => {
      tx = clamp(tx, -2, HP.w + 2); tz = clamp(tz, -2, HP.d + 3);
      if (!ok(tx, tz, rMax)) return;
      let lo = rMin, hi = rMax;
      if (!ok(tx, tz, lo)) { for (let i = 0; i < 13; i++) { const mid = (lo + hi) / 2; if (ok(tx, tz, mid)) hi = mid; else lo = mid; } } else hi = lo;
      if (!best || hi < best.r - 0.05) best = { tx, tz, r: hi };
    };
    const G = [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3, -0.42, 0.42];
    for (const a of G) for (const b of G) tryAt(cx + a * span, cz + b * span);
    if (best) { const b0 = best, s = span * 0.05; for (const a of [-1, -0.5, 0.5, 1]) for (const b of [-1, -0.5, 0, 0.5, 1]) tryAt(b0.tx + a * s, b0.tz + b * s); }
    if (!best) return { tx: clamp(cx, -2, HP.w + 2), tz: clamp(cz, -2, HP.d + 3), r: rMax };
    best.r = Math.min(rMax, best.r * 1.03 + 0.4);
    return best;
  }
  /** Einpass-Ziel einer Voreinstellung (Blickrichtung im Hochformat gedreht, damit die lange Hallenseite in die Höhe läuft) */
  function presetFit(p) {
    const P = WF.profile, pts = [], asp = (R.w - (R.drawerW || 0)) / R.h;
    let phi = p.phi, th = p.th;
    if (p.id === 'uebersicht') {
      if (asp < 0.95) { th = 74; phi = 50; }
      // Hallenumriss alle ~8 m abtasten: keine Kante (und kein Lager an der Wand) verschwindet unter einem Bedienfeld
      const HW = P.hall.w, HD = P.hall.d, nx = Math.ceil(HW / 8), nz = Math.ceil(HD / 8);
      for (let i = 0; i <= nx; i++) { const x = HW * i / nx; pts.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, HD)); }
      for (let i = 1; i < nz; i++) { const z = HD * i / nz; pts.push(new THREE.Vector3(0, 0, z), new THREE.Vector3(HW, 0, z)); }
      pts.push(new THREE.Vector3(0, 3, 0), new THREE.Vector3(HW, 3, 0), new THREE.Vector3(0, 3, HD));
    } else for (const id of p.fit) pushFoot(pts, P.stationById[id], 3, 0.6);
    return { kind: 'preset', id: p.id, pts, phi: phi * DEG, th: th * DEG, rMin: 16, rMax: 150 };
  }
  function setFit(f, instant, dur) { R.fit = f; applyFit(instant, dur); }
  function applyFit(instant, dur) {
    const f = R.fit; if (!f || !R.camera || !R.controls) return;
    syncDrawer();
    if (f.kind === 'preset') { const p = PRESETS.find(x => x.id === f.id); if (p) Object.assign(f, presetFit(p)); }
    const s = solveFit(f.pts, f.phi, f.th, f.rMin || 14, f.rMax || 150);
    f.sig = layoutSig(); R.fitPend = '';
    const dst = { tx: s.tx, ty: 0, tz: s.tz, r: s.r, phi: f.phi, th: f.th };
    if (instant) { R.introPending = false; R.tween = null; setCam(dst); R.controls.update(); } else goCam(dst, dur);
  }
  /** 4×/s: hat sich der freie Bereich geändert (Drawer, Tour-Karte, Fokus, Größe) und ist die Lage stabil → neu einpassen */
  function checkFit() {
    const f = R.fit; if (!f || R.tween || R.introPending || R.down) return;
    const sig = layoutSig();
    if (sig === f.sig) { R.fitPend = ''; return; }
    if (R.fitPend === sig) applyFit(false, 0.85); else R.fitPend = sig;
  }
  /** Nutzer bewegt die Kamera selbst: Einpassen und Voreinstellung enden */
  function dropFit() { R.fit = null; R.fitPend = ''; if (R.preset) { R.preset = null; markPresets(); } }
  function preset(id, instant) {
    const p = PRESETS.find(x => x.id === id) || PRESETS[0];
    R.preset = p.id; R.follow = null;
    setFit(presetFit(p), instant);
    markPresets(); renderSelBar();
  }
  function markPresets() {
    const p = PRESETS.find(x => x.id === R.preset);
    R.zone = p && p.zone ? p.zone : null;
    if (R.ui.preLbl) R.ui.preLbl.textContent = p ? p.short : 'Freie Ansicht';
    if (R.root) R.root.querySelectorAll('[data-p]').forEach(b => { b.classList.toggle('on', b.dataset.p === R.preset); b.setAttribute('aria-checked', String(b.dataset.p === R.preset)); });
  }
  function focusStation(id) {
    if (!R.ok) { R.pending = { fn: 'station', id }; return; }
    const st = WF.profile.stationById[id]; if (!st || !st.footprint) return;
    const th = st.facing === 'N' ? 192 : st.facing === 'W' ? -62 : st.id === 'QS' ? 24 : 16;
    R.preset = null; markPresets(); R.follow = null;
    const pts = []; pushFoot(pts, st, 3.5, 2.2);
    setFit({ kind: 'station', id, pts, phi: 54 * DEG, th: th * DEG, rMin: 16, rMax: 70 });
    R.flash = { id, t: 0 };
  }
  function focusOrder(id) {
    if (!R.ok) { R.pending = { fn: 'order', id }; return; }
    syncDrawer();
    if (!R.sel || R.sel.kind !== 'order' || R.sel.id !== id) applySelection({ kind: 'order', id });
    const steps = R.route.steps; if (!steps.length) return;
    const pts = [];
    for (const s of steps) { if (R.mo[s.st.id]) pushFoot(pts, s.st, 2.5, 0.4); else pushFoot(pts, s.st, 1, 0, { x: s.x, z: s.z }); }
    if (steps.some(s => s.st.id === 'EXT')) pushFoot(pts, WF.profile.stationById.WE, 1, 0, stepSpot(WF.profile.stationById.WE, 1));
    const portrait = (R.w - (R.drawerW || 0)) / R.h < 0.95;
    R.preset = null; markPresets(); R.follow = null;
    setFit({ kind: 'order', id, pts, phi: (portrait ? 50 : 44) * DEG, th: (portrait ? 74 : 12) * DEG, rMin: 22, rMax: 150 });
  }
  function clampTarget() {
    const t = R.controls.target, P = WF.profile.hall;
    const cx = clamp(t.x, -2, P.w + 2), cz = clamp(t.z, -2, P.d + 3), cy = clamp(t.y, 0, 3);
    if (cx !== t.x || cz !== t.z || cy !== t.y) { const dx = cx - t.x, dy = cy - t.y, dz = cz - t.z; t.set(cx, cy, cz); R.camera.position.x += dx; R.camera.position.y += dy; R.camera.position.z += dz; }
  }
  /** Mausrad: zum Cursor hin zoomen (Bodenpunkt unter dem Zeiger bleibt stehen) */
  function onWheel(e) {
    if (!R.ok || e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    hideHint();
    R.tween = null; R.introPending = false; dropFit();
    const r = R.root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const f = Math.exp(clamp(dy, -240, 240) * 0.0016);
    const c = R.controls, cam = R.camera, tg = c.target;
    const dist = cam.position.distanceTo(tg), nd = clamp(dist * f, c.minDistance, c.maxDistance), k = nd / dist;
    if (Math.abs(k - 1) < 1e-4) return;
    NDC.set(x / R.w * 2 - 1, -(y / R.h) * 2 + 1); RAY.setFromCamera(NDC, cam);
    const hit = RAY.ray.intersectPlane(PLANE, V3);
    V1.copy(cam.position).sub(tg).multiplyScalar(k);
    if (hit) { V2.copy(tg).sub(hit).multiplyScalar(k).add(hit); tg.copy(V2); tg.y = 0; }
    cam.position.copy(tg).add(V1);
    clampTarget();
  }

  // ================================================================== Overlays (DOM): Status + Hallenplan, Ansicht/Ebenen, Legende, Auswahl
  const SHORT_STATE = { running: 'Produktion', setup: 'Rüsten', firstPiece: 'Erstteil', toolchange: 'Wkz-Wechsel', waitTool: 'Wartet', waitOperator: 'Wartet', starved: 'Wartet', blocked: 'Ausgang voll', fault: 'Störung', idle: 'Bereit' };
  function legendHtml() {
    const sw = (cv, t, cls, ttl) => `<span class="h3-lg"${ttl ? ` title="${esc(ttl)}"` : ''}><i class="${cls || ''}" style="--c:${cv}"></i>${esc(t)}</span>`;
    return `<div class="h3-eb">Maschinenzustand</div><div class="h3-leg">${sw('var(--st-run)', 'Produktion')}${sw('var(--st-setup)', 'Rüsten / Erstteil', '', 'Rüsten oder Erstteilprüfung läuft')}${sw('var(--st-tool)', 'Werkzeugwechsel')}${sw('var(--st-wait)', 'Wartet / Ausgang voll', '', 'Wartet auf Material, Werkzeug oder Bediener bzw. Ausgangspuffer voll')}${sw('var(--st-fault)', 'Störung')}${sw('var(--st-idle)', 'Bereit (kein Auftrag)')}</div>
      <div class="h3-eb">Materialfluss</div><div class="h3-leg">${sw('var(--mat)', 'Auftragsfluss', 'arc', 'Bögen zwischen aufeinanderfolgenden Arbeitsgängen offener Aufträge mit laufenden Punkten – je dicker, desto mehr Aufträge (aus der Übersicht)')}${sw('var(--mat)', 'Transport unterwegs', 'ln', 'Weg vom Fahrzeug über die Abholung zum Ziel')}${sw('var(--mat)', 'Wartet auf Transport', 'dsh', 'Gestrichelt vom Behälter zum Ziel; der Grund steht am Etikett, z. B. Ziel voll (Eingangspuffer begrenzt) oder kein Fahrzeug frei')}${sw('var(--mat)', 'Ziel voll', 'stp', 'Eingangspuffer der Zielmaschine ist voll – der Behälter fährt, sobald Platz ist')}${sw('var(--st-run)', 'Teil fertig', 'rg', 'Kurzer Puls am Ausgang, wenn ein Teil fertig wird')}</div>
      <div class="h3-eb">Datenfluss</div><div class="h3-leg">${sw('var(--info)', 'Daten → MES-Server', 'pt', 'Signale der angebundenen Maschinen laufen über die Kabeltrasse zum MES-Server – Warnungen gelb, Störungen rot')}${sw('var(--info)', 'Meldung an Person', 'rg', 'Benachrichtigung vom Server erreicht die zuständige Rolle – Farbe nach Dringlichkeit')}${sw('#5fb6e6', 'Tablet (ohne Anbindung)', '', 'Maschine ohne Datenschnittstelle – Rückmeldung per Tablet')}</div>
      <div class="h3-eb">Personen</div><div class="h3-leg">${Object.values(ROLES).map(r => sw(r.vest, r.label, 'vest')).join('')}</div>`;
  }
  const isTouch = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  /** Bedienhinweis passend zum Gerät (Maus vs. Gesten) */
  function hintHtml() {
    if (!isTouch()) return '<b>Ziehen</b> drehen · <b>Rechte Maustaste</b> verschieben · <b>Mausrad</b> zoomen · <b>Klick</b> Details · <b>Doppelklick</b> heranholen';
    return R.mobile ? '<b>Wischen</b> drehen · <b>Zwei Finger</b> zoomen &amp; verschieben · <b>Tippen</b> Details'
      : '<b>Wischen</b> drehen · <b>Zwei Finger</b> zoomen &amp; verschieben · <b>Tippen</b> Details · <b>Doppeltippen</b> heranholen';
  }
  const LAYERS = [
    { k: 'flow', c: 'var(--mat)', lf: 'Materialfluss', ls: 'Material', t: 'Materialfluss: Auftragsfluss, Transporte und wartende Behälter' },
    { k: 'data', c: 'var(--info)', lf: 'Datenfluss', ls: 'Daten', t: 'Datenfluss: Maschinendaten zum MES-Server, Meldungen an Personen' },
    { k: 'people', c: 'var(--st-run)', lf: 'Personen', ls: 'Personen', t: 'Personen ein-/ausblenden' },
    { k: 'labels', c: 'var(--text2)', lf: 'Beschriftung', ls: 'Text', t: 'Maschinen-Beschriftungen ein-/ausblenden' },
  ];
  function buildOverlays(root) {
    const ui = R.ui, P = WF.profile;
    ui.labels = el('div', { class: 'h3-labels' });
    ui.lead = sv('svg', { class: 'h3-lead', 'aria-hidden': 'true' }); ui.labels.append(ui.lead);
    ui.tip = el('div', { class: 'h3-tip h3-glass', role: 'tooltip' });
    ui.status = el('div', { class: 'h3-ov h3-status h3-glass', 'aria-live': 'polite' });
    const sdot = (k, t) => `<span title="${esc(WF.STATE[k] ? WF.STATE[k].label : t)}"><i style="--c:${WF.STATE[k].color}"></i>${esc(t)}</span>`;
    ui.status.innerHTML = `<div class="h3-st-h"><span class="h3-live" data-k="live"><i></i>Live</span><span class="h3-ttl" data-k="ttl">${esc(P.company.site || 'Halle')}</span><span class="h3-clock" data-k="clock">–</span></div>
      <div class="h3-shift" data-k="shift">–</div>
      <div class="h3-mline" data-k="mline"></div>
      <div class="h3-kv">
        <div title="Maschinen im Zustand Produktion"><span class="l">Produktion</span><b data-k="run">–</b><span class="s" data-k="runS">–</span></div>
        <div title="Personen in der Halle (ohne Feierabend)"><span class="l">Im Dienst</span><b data-k="ppl">–</b><span class="s" data-k="pplS">–</span></div>
        <div title="Offene Transportaufträge (AGV und Stapler)"><span class="l">Transporte</span><b data-k="tr">–</b><span class="s" data-k="trS">–</span></div>
      </div>
      <div class="h3-sleg">${sdot('running', 'Produktion')}${sdot('setup', 'Rüsten')}${sdot('toolchange', 'Werkzeug')}${sdot('starved', 'Wartet')}${sdot('fault', 'Störung')}${sdot('idle', 'Bereit')}</div>`;
    ui.st = {}; ui.status.querySelectorAll('[data-k]').forEach(n => ui.st[n.dataset.k] = n);
    ui.mapbox = el('div', { class: 'h3-ov h3-mapbox h3-glass' });
    ui.mapbox.innerHTML = `<div class="h3-maph"><span class="h3-eb">Hallenplan</span><span>${isTouch() ? 'Tippen' : 'Klick'}: Maschine · Ziehen: Ausschnitt</span></div><div class="h3-map"></div>`;
    buildMinimap(ui.mapbox.querySelector('.h3-map'));
    // Werkzeugleiste oben rechts: Ansicht (Kamera-Voreinstellungen), Ebenen (immer beschriftet), Legende
    ui.tb = el('div', { class: 'h3-ov h3-tb h3-glass', role: 'toolbar', 'aria-label': 'Ansicht und Ebenen' });
    const chips = LAYERS.map(L => `<button class="h3-chip" data-l="${L.k}" style="--c:${L.c}" title="${esc(L.t)}" aria-label="${esc(L.lf)}"><i></i><span class="lf">${esc(L.lf)}</span><span class="ls">${esc(L.ls)}</span></button>`).join('');
    const presetBtns = PRESETS.map(p => `<button data-p="${p.id}" role="menuitemradio">${icon(p.icon, 15)}<span>${esc(p.label)}</span></button>`).join('');
    ui.tb.innerHTML = `<div class="h3-ddw"><button class="h3-dd" data-dd="pre" aria-haspopup="menu" aria-expanded="false" title="Kameraansicht wählen" aria-label="Kameraansicht">${icon('camera', 15)}<span data-k="pre">Übersicht</span>${icon('chevron', 13)}</button>
        <div class="h3-menu h3-glass" role="menu" hidden><div class="h3-eb">Ansicht</div><div class="h3-pre">${presetBtns}</div></div></div>
      <span class="h3-tsep"></span>${chips}<span class="h3-tsep"></span>
      <div class="h3-ddw"><button class="h3-dd icn" data-dd="leg" aria-haspopup="dialog" aria-expanded="false" title="Legende" aria-label="Legende">${icon('info', 15)}<span>Legende</span></button>
        <div class="h3-pop h3-glass" hidden>${legendHtml()}</div></div>`;
    ui.pre = ui.tb.querySelector('.h3-pre');
    ui.preLbl = ui.tb.querySelector('[data-k="pre"]');
    ui.pre.querySelectorAll('button').forEach(b => b.onclick = () => { preset(b.dataset.p); closeMenus(); });
    ui.tb.querySelectorAll('[data-l]').forEach(b => b.onclick = () => toggleLayer(b.dataset.l));
    ui.tb.querySelectorAll('[data-dd]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const pop = b.nextElementSibling, open = pop.hidden; closeMenus(); pop.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.classList.toggle('on', open); computeUiRects(); });
    // Kompakt: eine Leiste unten, Inhalte als Blatt
    ui.mbar = el('div', { class: 'h3-ov h3-mbar h3-glass' });
    ui.mbar.innerHTML = `<button data-s="pre" aria-label="Ansicht">${icon('camera', 15)}<span>Ansicht</span></button><button data-s="lay" aria-label="Ebenen">${icon('layers', 15)}<span>Ebenen</span></button><button data-s="leg" aria-label="Legende">${icon('info', 15)}<span>Legende</span></button><button data-s="reset" title="Übersicht" aria-label="Übersicht">${icon('grid', 15)}</button>`;
    ui.sheet = el('div', { class: 'h3-ov h3-sheet h3-glass', hidden: true });
    ui.mbar.querySelectorAll('button').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      if (s === 'reset') { preset('uebersicht'); closeMenus(); return; }
      openSheet(s, b);
    });
    ui.sel = el('div', { class: 'h3-ov h3-sel h3-glass', hidden: true });
    ui.hint = el('div', { class: 'h3-ov h3-hint', html: hintHtml() });
    root.append(ui.labels, ui.status, ui.mapbox, ui.tb, ui.sel, ui.hint, ui.mbar, ui.sheet, ui.tip);
    for (const n of [ui.status, ui.mapbox, ui.tb, ui.sel, ui.mbar, ui.sheet]) n.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', () => closeMenus());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && R.visible) closeMenus(); });
    ui.chipsHtml = chips; ui.presetHtml = presetBtns;
    applyLayers(); markPresets();
  }
  /** Blatt der kompakten Leiste: Ansicht, Ebenen, Legende oder Arbeitsplan des Auftrags (Schritte) */
  function openSheet(s, btn) {
    const ui = R.ui;
    const open = ui.sheet.hidden || ui.sheet.dataset.s !== s;
    closeMenus();
    if (!open) return;
    ui.sheet.dataset.s = s; ui.sheet.hidden = false; if (btn) btn.classList.add('on');
    R.root.classList.add('sheet');
    if (s === 'pre') { ui.sheet.innerHTML = `<div class="h3-eb">Ansicht</div><div class="h3-pre">${ui.presetHtml}</div>`; ui.sheet.querySelectorAll('[data-p]').forEach(x => x.onclick = () => { preset(x.dataset.p); closeMenus(); }); markPresets(); }
    else if (s === 'lay') { ui.sheet.innerHTML = `<div class="h3-eb">Ebenen</div><div class="h3-lay">${ui.chipsHtml}</div>`; ui.sheet.querySelectorAll('[data-l]').forEach(x => x.onclick = () => toggleLayer(x.dataset.l)); applyLayers(); }
    else if (s === 'steps') renderSteps();
    else ui.sheet.innerHTML = legendHtml();
    computeUiRects();
  }
  /** Arbeitsplan des verfolgten Auftrags (Telefon): AG, Station, Zustand, Menge – Tippen holt die Station heran */
  function renderSteps() {
    const ui = R.ui, r = R.route; if (!r.id) { closeMenus(); return; }
    const lim = r.lim;
    ui.sheet.innerHTML = `<div class="h3-eb">Arbeitsplan ${esc(r.id)}</div><div class="h3-steps">${r.steps.map((c, n) => {
      const col = OPC[c.op.state] || OPC.open, cnt = c.op.target ? `${fmtN(c.op.good)}/${fmtN(c.op.target)}` : '';
      const k = c.lim ? `<span class="k">${lim && lim.plant ? 'Engpass' : 'kritisch'}</span>` : '';
      return `<button data-st="${esc(c.st.id)}" style="--rc:${col}"><span class="n">${n + 1}</span><span><b>AG ${c.op.seq} · ${esc(c.op.op || '')}${k}</b><small>${esc(stationTag(c.st))} ${esc(c.op.stationName || c.st.short)} · ${esc(c.op.stateLabel || '')}</small></span><span class="q">${cnt}</span></button>`;
    }).join('')}</div>`;
    ui.sheet.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { const id = b.dataset.st; closeMenus(); if (WF.profile.stationById[id] && WF.profile.stationById[id].footprint) focusStation(id); });
  }
  function toggleLayer(k) {
    R.layers[k] = !R.layers[k]; store.set('layers', R.layers); applyLayers();
    if (k === 'flow' && R.layers.flow) R.flowFlash = 1.6;   // beim Einschalten kurz alle Flüsse voll zeigen
  }
  function closeMenus() {
    const ui = R.ui; if (!ui.tb) return;
    ui.tb.querySelectorAll('[data-dd]').forEach(b => { const pop = b.nextElementSibling; if (!pop.hidden) { pop.hidden = true; } b.setAttribute('aria-expanded', 'false'); b.classList.remove('on'); });
    if (ui.sheet && !ui.sheet.hidden) { ui.sheet.hidden = true; ui.sheet.dataset.s = ''; }
    if (R.root) R.root.classList.remove('sheet');
    ui.mbar.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    if (ui.sel) ui.sel.querySelectorAll('[data-steps]').forEach(b => b.classList.remove('on'));
    computeUiRects();
  }
  const closeSheets = closeMenus;
  function applyLayers() {
    const L = R.layers;
    R.root.querySelectorAll('[data-l]').forEach(b => { if (b.classList.contains('h3-chip')) { b.classList.toggle('on', !!L[b.dataset.l]); b.setAttribute('aria-pressed', String(!!L[b.dataset.l])); } });
    if (R.flowGroup) R.flowGroup.visible = L.flow;
    if (R.C) R.C.wait.visible = L.flow;
    if (R.pulse) R.pulse.pts.visible = L.data;
    if (R.trayGlow) R.trayGlow.forEach(m => m.visible = L.data);
    if (R.ui.mmPeople) R.ui.mmPeople.style.display = L.people ? '' : 'none';
    // Etiketten-Ebene bleibt sichtbar (Route und Wartegründe); Maschinen-Etiketten schaltet placeLabels() je Ebene
    if (!L.labels) for (const id in R.lb) { const l = R.lb[id]; if (l.shown) { l.shown = false; l.el.classList.add('off'); } }
    computeUiRects();
  }
  function computeUiRects() {
    if (!R.root) return;
    const rr = R.root.getBoundingClientRect(), out = [];
    for (const n of [R.ui.status, R.ui.mapbox, R.ui.tb, R.ui.sel, R.ui.mbar, R.ui.hint, R.ui.sheet, ...(R.ui.tb ? R.ui.tb.querySelectorAll('.h3-menu,.h3-pop') : [])]) {
      if (!n || n.hidden || (n === R.ui.hint && n.classList.contains('gone'))) continue;
      const b = n.getBoundingClientRect(); if (!b.width || !b.height) continue;
      out.push([b.left - rr.left - 6, b.top - rr.top - 6, b.right - rr.left + 6, b.bottom - rr.top + 6]);
    }
    if (R.drawerW) out.push([R.w - R.drawerW - 8, -10, R.w + 10, R.h + 10]);
    R.uiRects = out;
  }
  /** Layout nach freier Breite (Fläche minus Drawer): kompakt ≤ 640 px, schmal < 1060 px, Hallenplan erst ab 900 px;
      Werkzeugleiste rutscht unter das Statusfeld, falls beide sich sonst berühren. */
  function layoutModes() {
    if (!R.root) return;
    const avail = R.w - (R.drawerW || 0), root = R.root;
    const compact = R.mobile || avail <= 640;
    if (compact !== R.compact) {
      R.compact = compact; root.classList.toggle('m', compact); closeSheets();
      for (const id in R.lb) R.lb[id].sizes = {};
      for (const id in R.rtLb) R.rtLb[id].sizes = {};
      if (R.ui.sel && !R.ui.sel.hidden) { R.ui.selSig = ''; renderSelBar(); }
    }
    const focus = !!(R.route && R.route.id);
    root.classList.toggle('focus', focus);
    root.classList.toggle('xs', compact && avail < 370);
    root.classList.toggle('narrow', !compact && avail < 1060);
    root.classList.toggle('nomap', compact || R.short || focus || avail < 900);
    // Werkzeugleiste darf das Statusfeld nie überdecken: notfalls darunter
    const tb = R.ui.tb, st = R.ui.status;
    if (tb && st && !compact) {
      tb.style.top = '';
      const tbW = tb.offsetWidth, stR = st.offsetLeft + st.offsetWidth;
      tb.style.top = avail - 14 - tbW < stR + 8 ? (st.offsetTop + st.offsetHeight + 8) + 'px' : '';
    }
    computeUiRects();
  }
  function renderSelBar() {
    const ui = R.ui; if (!ui.sel) return;
    const s = R.selTarget;
    const S = WF.sim.state;
    let html = null;
    if (s && (s.kind === 'person' || s.kind === 'agv')) {
      const name = WF.app.entityLabel({ kind: s.kind, id: s.id });
      const on = !!(R.follow && R.follow.id === s.id);
      const act = s.kind === 'person' ? (S.people[s.id] ? S.people[s.id].activity : '') : (S.agvs[s.id] ? (S.agvs[s.id].taskLabel || WF.sim.LABELS.agv[S.agvs[s.id].state] || '') : '');
      html = `<span class="k">${s.kind === 'agv' ? 'AGV' : 'Person'}</span><span class="nm">${esc(name)}</span><span class="ac" data-ac>${esc(act || '')}</span><button class="btn sm ${on ? 'on' : ''}" data-f>${icon('eye', 14)}${on ? 'Folgt' : 'Folgen'}</button>`;
    } else if (R.sel && R.sel.kind === 'order' && R.route.steps.length) {
      const o = S.orders[R.sel.id];
      html = `<span class="k">Auftrag</span><span class="nm">${esc(R.sel.id)}</span><span class="ac">${esc(o ? o.part.name : '')} · ${R.route.steps.length} Schritte</span>` +
        (R.compact ? `<button class="btn sm" data-steps>${icon('list', 14)}Schritte</button>` : `<button class="btn sm" data-r title="Route in den freien Bereich einpassen">${icon('route', 14)}Route zeigen</button>`) +
        `<button class="btn sm ghost ic" data-x title="Verfolgung beenden" aria-label="Verfolgung beenden">${icon('x', 14)}</button>`;
    }
    R.root.classList.toggle('selon', !!html);
    if (!html) { if (!ui.sel.hidden) { ui.sel.hidden = true; computeUiRects(); } ui.selSig = ''; return; }
    if (ui.selSig !== html) {
      ui.selSig = html; ui.sel.innerHTML = html;
      const f = ui.sel.querySelector('[data-f]');
      if (f) f.onclick = () => { const on = !!(R.follow && R.follow.id === s.id); R.follow = on ? null : { kind: s.kind, id: s.id }; if (R.follow) { dropFit(); R.tween = null; zoomToFollow(); } renderSelBar(); };
      const rb = ui.sel.querySelector('[data-r]');
      if (rb) rb.onclick = () => focusOrder(R.sel.id);
      const sb = ui.sel.querySelector('[data-steps]');
      if (sb) sb.onclick = () => { focusOrder(R.sel.id); openSheet('steps', null); };
      const xb = ui.sel.querySelector('[data-x]');
      if (xb) xb.onclick = () => WF.app.closeDrawer();
    }
    if (ui.sel.hidden) ui.sel.hidden = false;
    computeUiRects();
  }
  function zoomToFollow() {
    const cs = camState(), f = R.follow; if (!f) return;
    const ps = f.kind === 'person' ? WF.sim.state.people[f.id] : null;
    const e = f.kind === 'agv' ? R.agvs[f.id] : ps && ps.vehicle ? R.fork : R.people[f.id];
    const tx = e && e.x != null ? e.x : cs.tx, tz = e && e.z != null ? e.z : cs.tz;
    goCam({ tx, ty: 0, tz, r: Math.min(cs.r, 24), phi: Math.min(cs.phi, 58 * DEG), th: cs.th }, 0.9);
  }

  // ---------- Hallenplan (Minikarte, SVG)
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; }
  function buildMinimap(host) {
    const P = WF.profile, HW = P.hall.w, HD = P.hall.d;
    const svg = sv('svg', { viewBox: `-1 -1 ${HW + 2} ${HD + 2}`, preserveAspectRatio: 'xMidYMid meet', 'aria-label': 'Hallenplan' });
    sv('rect', { x: 0, y: 0, width: HW, height: HD, rx: 0.6, fill: 'rgba(255,255,255,.035)', stroke: 'rgba(200,215,235,.22)', 'stroke-width': 0.25 }, svg);
    for (const L of P.graph.lines) { const hw = AISLE_HW[L.id] || 1; if (L.axis === 'x') sv('rect', { x: L.a - hw, y: L.c - hw, width: L.b - L.a + 2 * hw, height: 2 * hw, fill: 'rgba(247,186,24,.07)' }, svg); else sv('rect', { x: L.c - hw, y: L.a - hw, width: 2 * hw, height: L.b - L.a + 2 * hw, fill: 'rgba(247,186,24,.07)' }, svg); }
    for (const s of P.stations) {
      if (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly' || !s.footprint) continue;
      const f = s.footprint, col = s.id === 'SPERR' ? 'rgba(248,113,113,.55)' : s.id === 'EXT' ? 'rgba(255,157,61,.55)' : 'rgba(200,215,235,.28)';
      const g = sv('g', { class: 'mm', 'data-store': s.id }, svg);
      sv('rect', { x: f.x, y: f.z, width: f.w, height: f.d, rx: 0.4, fill: 'rgba(255,255,255,.03)', stroke: col, 'stroke-width': 0.18, 'stroke-dasharray': s.room ? '' : '0.6 0.4' }, g);
      sv('title', {}, g).textContent = s.name;
    }
    R.ui.mm = {};
    const texts = [];
    for (const id of P.machines) {
      const s = P.stationById[id], f = s.footprint;
      const g = sv('g', { class: 'mm', 'data-id': id }, svg);
      const r = sv('rect', { x: f.x + 0.15, y: f.z + 0.15, width: f.w - 0.3, height: f.d - 0.3, rx: 0.5, fill: '#7b8aa8', 'fill-opacity': 0.55, stroke: '#7b8aa8', 'stroke-width': 0.22 }, g);
      const tt = sv('title', {}, g); tt.textContent = `${id} · ${s.short}`;
      R.ui.mm[id] = { g, r, tt, st: null };
      // Beschriftung passt sich der Fläche an (2,7 Einheiten ≈ 11 px): voller Name, nur Nummer, senkrecht oder unter der Fläche
      const FS = 2.7, cw = FS * 0.6, bw = f.w - 0.9, bh = f.d - 0.9, cx = f.x + f.w / 2, cy = f.z + f.d / 2;
      const num = /^M\d+$/.test(id) ? id.slice(1) : id;
      let txt = id, x = cx, y = cy + FS * 0.36, rot = false;
      if (id.length * cw > bw) {
        if (id.length * cw <= bh && bw >= FS) rot = true;
        else if (num.length * cw <= bw) txt = num;
        else { txt = num; y = (f.z + f.d / 2 > 22 ? f.z + f.d + FS * 0.95 : f.z - FS * 0.35); }
      }
      texts.push({ txt, x, y, rot, cx, cy });
    }
    R.ui.mmPeople = sv('g', {}, svg);
    R.ui.mmDots = {};
    for (const pp of P.people) { const d = sv('circle', { r: 0.55, fill: ROLES[roleOf(pp.role)].vest, stroke: '#0b1120', 'stroke-width': 0.18, cx: -9, cy: -9 }, R.ui.mmPeople); R.ui.mmDots[pp.id] = d; }
    for (const a of P.agvs) { const d = sv('rect', { width: 1.1, height: 1.1, rx: 0.25, fill: '#3cc6f2', stroke: '#0b1120', 'stroke-width': 0.18, x: -9, y: -9 }, R.ui.mmPeople); R.ui.mmDots[a.id] = d; }
    R.ui.mmFork = sv('rect', { width: 1.3, height: 1.3, rx: 0.2, fill: '#e8a317', stroke: '#0b1120', 'stroke-width': 0.18, x: -9, y: -9 }, R.ui.mmPeople);
    // Maschinennamen über den Personen-/Fahrzeugpunkten
    const tg = sv('g', { 'pointer-events': 'none' }, svg);
    for (const q of texts) { const t = sv('text', { x: q.x, y: q.y, 'text-anchor': 'middle' }, tg); t.textContent = q.txt; if (q.rot) t.setAttribute('transform', `rotate(-90 ${q.cx} ${q.cy})`); }
    R.ui.mmView = sv('polygon', { points: '', fill: 'rgba(60,198,242,.10)', stroke: 'rgba(60,198,242,.75)', 'stroke-width': 0.28, 'stroke-linejoin': 'round', 'pointer-events': 'none' }, svg);
    R.ui.mmSel = sv('rect', { x: -9, y: -9, width: 1, height: 1, rx: 0.7, fill: 'none', stroke: '#3cc6f2', 'stroke-width': 0.45, 'pointer-events': 'none' }, svg);
    host.append(svg);
    R.ui.mmSvg = svg;
    // Interaktion: Maschine anklicken → fokussieren + Details; sonst Ausschnitt dorthin verschieben (ziehen = fortlaufend)
    const toHall = (e) => { const r = svg.getBoundingClientRect(), vw = HW + 2, vh = HD + 2, s = Math.min(r.width / vw, r.height / vh), ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2; return { x: (e.clientX - r.left - ox) / s - 1, z: (e.clientY - r.top - oy) / s - 1 }; };
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = { x: e.clientX, y: e.clientY, moved: false, id: e.target.closest('[data-id]') ? e.target.closest('[data-id]').dataset.id : null, store: e.target.closest('[data-store]') ? e.target.closest('[data-store]').dataset.store : null }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true; panTo(toHall(e), true);
    });
    svg.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.moved) return;
      if (d.id) { focusStation(d.id); WF.app.select('machine', d.id); }
      else if (d.store) { focusStation(d.store); }
      else panTo(toHall(e), false);
    });
  }
  function panTo(p, instant) {
    const cs = camState(), P = WF.profile.hall;
    const dst = { tx: clamp(p.x, 0, P.w), ty: 0, tz: clamp(p.z, 0, P.d), r: cs.r, phi: cs.phi, th: cs.th };
    dropFit(); R.follow = null;
    if (instant) { R.tween = null; setCam(dst); } else goCam(dst, 0.7);
  }
  /** Sichtbereich der Kamera auf dem Boden (Schnitt der Eckstrahlen mit y = 0) */
  function updateMinimapView() {
    const m = R.ui.mmView; if (!m) return;
    const pts = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      NDC.set(nx, ny); RAY.setFromCamera(NDC, R.camera);
      let hit = RAY.ray.intersectPlane(PLANE, V3);
      if (!hit) { V4.copy(RAY.ray.direction); V4.y = 0; V4.normalize().multiplyScalar(300); hit = V3.copy(R.camera.position).add(V4); }
      pts.push(clamp(hit.x, -40, 110).toFixed(1) + ',' + clamp(hit.z, -40, 90).toFixed(1));
    }
    const s = pts.join(' ');
    if (s !== R.mmViewSig) { R.mmViewSig = s; m.setAttribute('points', s); }
  }
  function renderMapSel() {
    const r = R.ui.mmSel; if (!r) return;
    const t = R.selTarget;
    const st = t && (t.kind === 'machine' || t.kind === 'store') ? WF.profile.stationById[t.id] : null;
    if (st && st.footprint) { const f = st.footprint; r.setAttribute('x', f.x - 0.4); r.setAttribute('y', f.z - 0.4); r.setAttribute('width', f.w + 0.8); r.setAttribute('height', f.d + 0.8); }
    else { r.setAttribute('x', -9); r.setAttribute('y', -9); }
  }

  // ================================================================== Etiketten (HTML) je Maschine
  function buildLabels() {
    R.lb = {}; R.rtLb = {};
    for (const mo of R.moList) {
      const e = el('div', { class: 'h3-lb off', 'data-l': '1' });
      e.addEventListener('click', (ev) => { ev.stopPropagation(); WF.app.select('machine', mo.id); });
      e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      e.addEventListener('mouseenter', () => { R.lbHover = mo.id; setHover({ kind: 'machine', id: mo.id }, true); });
      e.addEventListener('mouseleave', () => { if (R.lbHover === mo.id) { R.lbHover = null; setHover(null); } });
      R.ui.labels.append(e);
      R.lb[mo.id] = { el: e, mo, anchor: mo.anchor, sig: '', level: 1, sizes: {}, x: -1, y: -1, shown: false, pri: 0, done: 0 };
    }
  }
  function critTool(v) {
    const tl = (v.tools || []).filter(t => t.status !== 'idle' && t.status !== 'missing' && t.status !== 'replace' && t.status !== 'keep' && t.remainingParts != null);
    if (!tl.length) return null;
    const pri = { broken: 0, changing: 1, due: 2, planned: 3, setup: 4, ok: 5 };
    tl.sort((a, b) => (pri[a.status] ?? 6) - (pri[b.status] ?? 6) || a.remainingParts - b.remainingParts);
    return tl[0];
  }
  const shortTool = (n) => String(n || '').replace(/\s*\(.*\)\s*/, '').replace('Schleifscheibe Korund', 'Schleifscheibe').slice(0, 30);
  const restTxt = (n) => n == null ? '' : `noch ${plural(n, 'Teil', 'Teile')}`;
  function toolLine(t) {
    if (!t) return '';
    if (t.status === 'changing') return `<span class="t">Werkzeugwechsel läuft</span> · ${esc(shortTool(t.name))}`;
    if (t.status === 'broken') return `<span class="t">Werkzeugbruch</span> · ${esc(shortTool(t.name))}`;
    if (t.status === 'due') return `<span class="t">Standzeit erschöpft</span> · ${esc(shortTool(t.name))}`;
    if (t.status === 'setup') return `Wird beim Rüsten bestückt · ${esc(shortTool(t.name))}`;
    if (t.status === 'planned' && t.plannedChange) return `<span class="t">${esc(shortTool(t.name))}</span> · ${restTxt(t.remainingParts)} · Wechsel ${esc(t.plannedChange.text || '')}`;
    return `${esc(shortTool(t.name))} · ${restTxt(t.remainingParts)}`;
  }
  function counterOf(v) { return v.order && v.partsTotal ? `${v.partNo != null ? v.partNo : v.partsDone}/${v.partsTotal}` : ''; }
  function updateLabel(l, v) {
    const ord = v.order, ct = counterOf(v);
    const t = critTool(v), wz = !!(t && (t.status === 'planned' || t.status === 'due' || t.status === 'changing' || t.status === 'broken'));
    const pct = ord && v.partsTotal ? Math.round((v.partsDone / v.partsTotal) * 100) : 0;
    const eta = v.etaOpEnd ? U.fmtClock(v.etaOpEnd) : '';
    const sig = [v.state, ct, ord ? ord.id + ord.seq : '', wz ? 1 : 0, toolLine(t), pct, v.phase, eta, v.cause].join('|');
    if (sig === l.sig) return;
    l.sig = sig; l.sizes = {};
    const isRun = v.state === 'running';
    const sub = ord && isRun ? `${esc(ord.id)} · AG ${ord.seq} ${esc(ord.op || '')}` : esc(v.cause || '');
    l.el.style.setProperty('--c', v.stateColor || 'var(--st-idle)');
    l.el.classList.toggle('flt', v.state === 'fault'); l.el.classList.toggle('run', isRun);
    l.el.innerHTML = `<div class="r1"><i class="d"></i><b>${esc(v.id)}</b><span class="nm">${esc(v.short)}</span><span class="sp">${esc(SHORT_STATE[v.state] || v.stateLabel || '')}</span>${ct ? `<span class="ct">${ct}</span>` : ''}${wz ? `<span class="wz" title="Werkzeugwechsel geplant">${icon('wrench', 12)}</span>` : ''}</div>
      <div class="r2"><span class="st">${esc(v.stateLabel || '')}</span><span>${sub}</span></div>
      ${ord ? `<div class="r3">${WF.ui.bar(v.partsTotal ? v.partsDone / v.partsTotal : 0, { thin: true, color: v.stateColor })}<span class="mono">${pct} %${eta ? ' · fertig ' + eta : ''}</span></div>` : ''}
      ${t ? `<div class="r4">${toolLine(t)}</div>` : ''}`;
  }
  function priOf(id, v) {
    if (R.selTarget && R.selTarget.kind === 'machine' && R.selTarget.id === id) return 100;
    if (R.hover && R.hover.kind === 'machine' && R.hover.id === id) return 90;
    const st = v ? v.state : 'idle', g = (WF.STATE[st] || {}).group;
    return g === 'fault' ? 60 : g === 'wait' ? 40 : g === 'setup' ? 30 : g === 'prod' ? 20 : 10;
  }
  const _rects = [], _all = [], _dry = [];
  // Route-/Warte-Etiketten: 8 Lagen um den Ankerpunkt in zwei Abständen, Führungslinie zum Anker
  const FL_POS = [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, -1], [0, 1], [1, 0], [-1, 0]], FL_RAD = [12, 40];
  const ML_POS = ['a', 'b', 'r', 'l'];
  function rectFree(rs, x0, y0, x1, y1, W, H) {
    if (x0 < 4 || y0 < 4 || x1 > W - 4 || y1 > H - 4) return false;
    for (let i = 0; i < rs.length; i++) { const r = rs[i]; if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; }
    return true;
  }
  function measure(l, key, apply) {
    let sz = l.sizes[key];
    if (!sz) { apply(); sz = l.sizes[key] = { w: l.el.offsetWidth, h: l.el.offsetHeight }; }
    return sz;
  }
  /** Maschinen-Etikett: Stufe want…0, je Stufe über/unter/rechts/links; Ergebnis in l._lv/_side/_x/_y */
  function placeMachine(l, want, rs, W, H) {
    for (let lv = want; lv >= 0; lv = lv === 2 ? 1 : lv - 1) {
      const sz = measure(l, lv, () => { l.el.dataset.l = String(lv); });
      for (let k = 0; k < 4; k++) {
        const side = ML_POS[k]; let x0, y0;
        if (side === 'a') { x0 = l.sx - sz.w / 2; y0 = l.sy - sz.h - 10; }
        else if (side === 'b') { x0 = l.sx - sz.w / 2; y0 = l.sy + 12; }
        else if (side === 'r') { x0 = l.sx + 12; y0 = l.sy - sz.h / 2; }
        else { x0 = l.sx - 12 - sz.w; y0 = l.sy - sz.h / 2; }
        if (rectFree(rs, x0, y0, x0 + sz.w, y0 + sz.h, W, H)) { l._lv = lv; l._side = side === 'a' ? 'a' : side === 'b' ? 'b' : 's'; l._x = x0; l._y = y0; l._w = sz.w; l._h = sz.h; return true; }
      }
      if (lv === 0) break;
    }
    return false;
  }
  /** Route-/Warte-Etikett: volle Form, sonst kompakt ('5 M09'); Route-Etiketten fallen nie weg */
  function placeFloat(l, rs, W, H) {
    const vars = l.route ? (R.compact ? ['c'] : ['f', 'c']) : (l.dist > 60 || R.compact ? ['c'] : ['f', 'c']);
    for (let vi = 0; vi < vars.length; vi++) {
      const v = vars[vi], sz = measure(l, v, () => setVar(l, v));
      for (let ri = 0; ri < FL_RAD.length; ri++) for (let k = 0; k < FL_POS.length; k++) {
        const rad = FL_RAD[ri], c = FL_POS[k];
        const x0 = c[0] > 0 ? l.sx + rad : c[0] < 0 ? l.sx - rad - sz.w : l.sx - sz.w / 2;
        const y0 = c[1] > 0 ? l.sy + rad : c[1] < 0 ? l.sy - rad - sz.h : l.sy - sz.h / 2;
        if (rectFree(rs, x0, y0, x0 + sz.w, y0 + sz.h, W, H)) { l._v = v; l._x = x0; l._y = y0; l._w = sz.w; l._h = sz.h; return true; }
      }
    }
    if (!l.route) return false;
    const sz = measure(l, 'c', () => setVar(l, 'c'));
    l._v = 'c'; l._w = sz.w; l._h = sz.h;
    l._x = clamp(l.sx + 12, 4, Math.max(4, W - (R.drawerW || 0) - 4 - sz.w)); l._y = clamp(l.sy + 12, 4, Math.max(4, H - 4 - sz.h));
    return true;
  }
  function setVar(l, v) { if (l.v !== v) { l.v = v; l.el.classList.toggle('c', v === 'c'); } }
  /** Führungslinie vom Anker zur nächsten Kante des Etiketts */
  function leader(l, on) {
    if (!on) { if (l.ln && l.lnOn) { l.ln.style.display = 'none'; l.dot.style.display = 'none'; l.lnOn = false; } return; }
    if (!l.ln) {
      l.ln = sv('line', { stroke: 'rgba(229,235,245,.78)' }, R.ui.lead); l.dot = sv('circle', { r: 4, fill: l.col || '#ff9d3d' }, R.ui.lead);
      l.lk = '';
    }
    const px = clamp(l.sx, l._x, l._x + l._w), py = clamp(l.sy, l._y, l._y + l._h);
    const far = Math.hypot(px - l.sx, py - l.sy) > 7;
    const key = far ? Math.round(l.sx) + ',' + Math.round(l.sy) + ',' + Math.round(px) + ',' + Math.round(py) : 'n';
    if (!l.lnOn) { l.ln.style.display = ''; l.dot.style.display = ''; l.lnOn = true; }
    if (key === l.lk) return;
    l.lk = key;
    if (!far) { l.ln.style.display = 'none'; l.dot.style.display = 'none'; l.lnOn = false; l.lk = ''; return; }
    l.ln.setAttribute('x1', l.sx.toFixed(1)); l.ln.setAttribute('y1', l.sy.toFixed(1)); l.ln.setAttribute('x2', px.toFixed(1)); l.ln.setAttribute('y2', py.toFixed(1));
    l.dot.setAttribute('cx', l.sx.toFixed(1)); l.dot.setAttribute('cy', l.sy.toFixed(1));
  }
  function showAt(l, ok) {
    if (ok) {
      const rx = Math.round(l._x), ryy = Math.round(l._y);
      if (rx !== l.x || ryy !== l.y) { l.x = rx; l.y = ryy; l.el.style.transform = `translate3d(${rx}px,${ryy}px,0)`; }
    }
    if (ok !== l.shown) { l.shown = ok; l.el.classList.toggle('off', !ok); }
  }
  function placeLabels() {
    const cam = R.camera, W = R.w, H = R.h, L = R.layers;
    _rects.length = 0; for (const r of R.uiRects) _rects.push(r);
    _all.length = 0;
    for (const id in R.rtLb) _all.push(R.rtLb[id]);
    for (const id in R.wtLb) _all.push(R.wtLb[id]);
    for (const id in R.lb) _all.push(R.lb[id]);
    for (const l of _all) {
      V2.copy(l.anchor).project(cam);
      l.vis = V2.z < 1 && V2.z > -1 && Math.abs(V2.x) < 1.2 && Math.abs(V2.y) < 1.2;
      l.sx = (V2.x + 1) / 2 * W; l.sy = (1 - V2.y) / 2 * H;
      l.dist = cam.position.distanceTo(l.anchor);
      l.p = l.pri;
    }
    // nach Priorität, dann von oben nach unten – Nachbarn lösen sich jedes Bild gleich auf
    _all.sort((a, b) => b.p - a.p || a.sy - b.sy);
    const pxPerM = H / (Math.tan(cam.fov * DEG / 2) * 2);
    const crowd = R.compact ? 1 : 0;
    const zone = R.preset ? R.zone : null;
    const underUi = (x, y) => { for (const r of R.uiRects) if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return true; return false; };
    const wantOf = (l) => {
      const ppm = pxPerM / l.dist;
      let want = ppm > 34 ? 2 : ppm > 12.5 ? 1 : 0;
      if (crowd) want = Math.min(want, 1);
      if (zone && l.mo && zone.indexOf(l.mo.id) < 0 && l.p < 90) want = 0;   // Bereichsansicht: Maschinen außerhalb nur als Kurzetikett
      return want;
    };
    let nWant = 0, nGot = 0;
    for (const l of _all) {
      let ok = l.vis;
      if (l.route || l.wait) {
        if (l.wait && (!L.flow || R.route.id)) ok = false;
        if (ok) ok = placeFloat(l, _rects, W, H);
        if (ok) { setVar(l, l._v); _rects.push([l._x - 4, l._y - 4, l._x + l._w + 4, l._y + l._h + 4]); }
        leader(l, ok);
        showAt(l, ok);
        continue;
      }
      if (!L.labels || l.onRoute) ok = false;
      else if (ok && underUi(l.sx, l.sy)) ok = false;   // Ankerpunkt liegt unter einem Bedienfeld: kein verwaistes Etikett daneben
      else if (ok) {
        let want = wantOf(l);
        const base = want;
        if (l.p < 90) want = Math.min(want, R.lbCap);
        if (l.p >= 100) want = Math.max(want, R.compact ? 1 : 2);   // ausgewählt: ausführlich (Hover zeigt die Karte)
        if (base >= 1 && l.p < 90) nWant++;
        ok = placeMachine(l, want, _rects, W, H);
        if (ok) { l.level = l._lv; if (base >= 1 && l.p < 90 && l._lv >= 1) nGot++; }
      }
      if (ok) {
        _rects.push([l._x - 4, l._y - 4, l._x + l._w + 4, l._y + l._h + 4]);
        if (l.el.dataset.pl !== l._side) l.el.dataset.pl = l._side;
      }
      if (l.el.dataset.l !== String(l.level)) l.el.dataset.l = String(l.level);
      showAt(l, ok);
    }
    // Einheitliche Stufe: passen weniger als 70 % der gewünschten ausführlichen Etiketten, zeigen alle nur das Kurzetikett.
    // Ob die ausführliche Stufe wieder passt, prüft ein Probedurchlauf ohne Darstellung (alle ~0,7 s).
    if (R.lbCap >= 1) {
      if (nWant >= 4 && nGot / nWant < 0.7) { if (++R.lbBad > 4) { R.lbCap = 0; R.lbBad = 0; } } else R.lbBad = 0;
    } else if (++R.lbDry % 40 === 0) {
      _dry.length = 0; for (const r of R.uiRects) _dry.push(r);
      let dw = 0, dg = 0;
      for (const l of _all) {
        if (l.route || l.wait) { if (l.shown) _dry.push([l._x - 4, l._y - 4, l._x + l._w + 4, l._y + l._h + 4]); continue; }
        if (!l.vis || !L.labels || l.onRoute || underUi(l.sx, l.sy)) continue;
        const want = wantOf(l), w1 = l.p >= 100 ? Math.max(want, R.compact ? 1 : 2) : Math.min(want, 1);
        if (want >= 1 && l.p < 90) dw++;
        if (placeMachine(l, w1, _dry, W, H)) { _dry.push([l._x - 4, l._y - 4, l._x + l._w + 4, l._y + l._h + 4]); if (want >= 1 && l.p < 90 && l._lv >= 1) dg++; }
      }
      for (const l of _all) if (l.mo && l.el.dataset.l !== String(l.level)) l.el.dataset.l = String(l.level);
      if (dw === 0 || dg / dw >= 0.8) R.lbCap = 1;
    }
  }

  // ================================================================== Tooltip
  function setHover(h, fromLabel) {
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
    if (same(h, R.hover)) return;
    const prev = R.hover;
    R.hover = h;
    R.root.classList.toggle('hov', !!h);
    if (prev && prev.kind === 'machine' && R.lb[prev.id]) R.lb[prev.id].el.classList.remove('hv');
    if (h && h.kind === 'machine' && R.lb[h.id]) R.lb[h.id].el.classList.add('hv');
    if (fromLabel && h) { const l = R.lb[h.id]; if (l) { const r = l.el.getBoundingClientRect(), rr = R.root.getBoundingClientRect(); R.mouse.x = r.right - rr.left; R.mouse.y = r.bottom - rr.top; } }
    renderTip(true);
  }
  /** Hover-Karte nur, wenn sie etwas zeigt, das sonst nicht sichtbar ist: nicht direkt nach einem Klick (bis die Maus
      sich bewegt), nicht für das Objekt, dessen Details der Drawer schon zeigt, nicht neben einem ausführlichen Etikett */
  function tipSuppressed(h) {
    if (R.tipSup) return true;
    const st = R.selTarget;
    if (st && R.drawerW && st.kind === h.kind && st.id === h.id) return true;
    if (h.kind === 'machine') { const l = R.lb[h.id]; if (l && l.shown && l.level === 2 && R.layers.labels) return true; }
    return false;
  }
  function renderTip(force) {
    const tip = R.ui.tip, h = R.hover;
    if (!h || R.mobile || R.compact || R.down || tipSuppressed(h)) { tip.classList.remove('on'); return; }
    let html = '';
    try { html = tipHtml(h); } catch (e) { html = ''; }
    if (!html) { tip.classList.remove('on'); return; }
    if (force || html !== R.tipHtml) { tip.innerHTML = html; R.tipHtml = html; }
    tip.classList.add('on');
    positionTip();
  }
  function positionTip() {
    const tip = R.ui.tip; if (!tip.classList.contains('on')) return;
    const w = tip.offsetWidth, h = tip.offsetHeight, maxX = R.w - (R.drawerW || 0) - 10;
    let x = R.mouse.x + 18, y = R.mouse.y + 18;
    if (x + w > maxX) x = R.mouse.x - w - 18;
    x = clamp(x, 10, Math.max(10, maxX - w));
    if (y + h > R.h - 10) y = Math.max(10, R.h - h - 10);
    tip.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  function tipHtml(h) {
    const S = WF.sim.state, F = U;
    if (h.kind === 'machine') {
      const mo = R.mo[h.id]; const v = mo && mo.v; if (!v) return '';
      const t = critTool(v), ord = v.order, rows = [];
      if (ord) rows.push(row('Auftrag', `${esc(ord.id)} · ${esc(ord.partName)}<br><span class="muted">${esc(ord.customer)} · AG ${ord.seq} ${esc(ord.op)}</span>`));
      if (ord) rows.push(row('Teile', `<div class="pg">${WF.ui.bar(v.partsTotal ? v.partsDone / v.partsTotal : 0, { color: v.stateColor })}<span class="mono">${counterOf(v)}</span></div>`));
      if (v.partRemainSec != null && (v.state === 'running' || v.partSub === 'load')) rows.push(row('Laufendes Teil', `noch ${F.fmtDur(v.partRemainSec)}${v.partSub === 'load' ? ' <span class="muted">(wird eingelegt)</span>' : ''}`));
      if (v.etaOpEnd) rows.push(row('Arbeitsgang fertig', 'ca. ' + F.fmtDue(v.etaOpEnd, S.t)));
      const act = (v.tools || []).filter(x => x.status !== 'idle' && x.status !== 'missing' && x.status !== 'replace' && x.status !== 'keep');
      if (act.length) rows.push(row('Werkzeuge', `<div class="tl">${act.slice(0, 4).map(x => { const wr = clamp((x.wearPct || 0) / 100, 0, 1), c = x.status === 'broken' || x.status === 'due' ? 'var(--st-fault)' : x.status === 'planned' || x.status === 'changing' ? 'var(--st-tool)' : wr > 0.8 ? 'var(--st-wait)' : 'var(--st-run)'; return `<div class="ti"><span class="tn">${esc(shortTool(x.name))}</span>${WF.ui.bar(wr, { thin: true, color: c })}<span class="tr">${x.status === 'changing' ? 'Wechsel' : x.status === 'broken' ? 'Bruch' : x.remainingParts != null ? fmtN(x.remainingParts) + ' T.' : '–'}</span></div>`; }).join('')}</div>${t && t.plannedChange ? `<span class="tw">Wechsel ${esc(shortTool(t.name))} ${esc(t.plannedChange.text || '')}${t.plannedChange.by ? ' · ' + esc(t.plannedChange.by) : ''}${t.plannedChange.stage && t.plannedChange.stage !== 'offen' ? ' (' + esc(t.plannedChange.stage) + ')' : ''}</span>` : ''}`));
      else if ((v.tools || []).some(x => x.status === 'replace' || x.status === 'setup')) rows.push(row('Werkzeuge', '<span class="muted">werden beim Rüsten neu bestückt</span>'));
      const sg = v.signals;
      if (sg) {
        let s = '';
        if (sg.level >= 2) s = [sg.mode, sg.spindleRpm != null ? 'Spindel ' + fmtN(sg.spindleRpm) + ' 1/min' : null, sg.spindleLoadPct != null ? 'Last ' + fmtN(sg.spindleLoadPct) + ' %' : null, sg.program ? 'Programm ' + sg.program : null].filter(Boolean).map(esc).join(' · ');
        else if (sg.level === 1) s = [sg.stackLightLabel, sg.powerKw != null ? U.fmtNum(sg.powerKw, 1) + ' kW' : null].filter(Boolean).map(esc).join(' · ');
        else s = 'Tablet-Rückmeldung' + (sg.lastFeedback ? ': ' + esc(sg.lastFeedback) : '') + (sg.lastFeedbackT ? ' · ' + U.fmtClock(sg.lastFeedbackT) : '');
        if (s) rows.push(row('Live-Signale', `<span class="muted">${s}</span>`));
      }
      if (v.operator) rows.push(row(v.operator.responsible ? 'Zuständig' : 'An der Maschine', `${esc(v.operator.name)} <span class="muted">· ${esc(v.operator.where || v.operator.activity || v.operator.stateLabel || '')}</span>`));
      if (v.inCap || v.outCap) rows.push(row('Puffer', `Eingang ${fmtN(v.input.length)}/${fmtN(v.inCap)} · Ausgang ${fmtN(v.output.length)}/${fmtN(v.outCap)} Behälter`));
      rows.push(row('Anbindung', `<span class="conn" data-l="${v.conn.level}">L${v.conn.level}</span> <span class="muted">${esc(v.conn.protocol || '')}</span>`));
      return `<div class="h"><div class="t">${esc(v.id)} · ${esc(v.short)}<small>${esc(v.name)}</small></div>${WF.ui.pill(v.state)}</div>
        <div class="cz" style="--c:${v.stateColor}">${esc(v.cause || '')} <span class="muted">· seit ${F.fmtDur(v.sinceSec)}</span></div>
        <dl class="dl">${rows.join('')}</dl><div class="ft"><span>Klicken für Details</span><span>OEE heute ${F.fmtPct(v.oeeToday && v.oeeToday.oee)}</span></div>`;
    }
    if (h.kind === 'person') {
      const p = S.people[h.id]; if (!p) return '';
      const lab = WF.sim.LABELS.person[p.state] || p.state, tk = p.task;
      const rows = [];
      if (tk) rows.push(row('Aufgabe', esc(tk.label || '')));
      if (p.vehicle) rows.push(row('Fahrzeug', esc(p.vehicle)));
      rows.push(row('Auslastung heute', F.fmtPct(p.utilToday)));
      rows.push(row('Aufgaben heute', fmtN(p.tasksToday || 0)));
      return `<div class="h"><div class="t">${esc(p.name)}<small>${esc(p.role)} · ${p.shift === 'F' ? 'Frühschicht' : 'Spätschicht'}</small></div><span class="pill" style="--c:${ROLES[roleOf(p.role)].vest}"><i></i>${esc(lab)}</span></div>
        <div class="cz">${esc(p.activity || '')}</div><dl class="dl">${rows.join('')}</dl><div class="ft"><span>Klicken für Details</span></div>`;
    }
    if (h.kind === 'agv') {
      const a = S.agvs[h.id]; if (!a) return '';
      const tr = a.task ? S.transports[a.task] : null;
      const load = a.load ? S.containers[a.load] : null;
      const rows = [row('Akku', `<div class="pg">${WF.ui.bar(a.battery / 100, { color: a.battery < 25 ? 'var(--st-wait)' : 'var(--st-run)' })}<span class="mono">${fmtN(a.battery)} %</span></div>`)];
      if (load) rows.push(row('Ladung', `${esc(load.id)} · ${fmtN(load.qty)} Stk ${esc(load.partName || '')}`));
      rows.push(row('Transporte heute', fmtN(a.transportsToday || 0)));
      return `<div class="h"><div class="t">${esc(a.name)}<small>Fahrerloses Transportfahrzeug · max. ${fmtN(a.maxKg)} kg</small></div><span class="pill" style="--c:var(--info)"><i></i>${esc(WF.sim.LABELS.agv[a.state] || a.state)}</span></div>
        <div class="cz">${tr ? esc(tr.label) : a.state === 'charging' ? 'Lädt an der Ladestation' : a.state === 'toCharge' ? 'Fährt zur Ladestation (Akku niedrig)' : 'Wartet auf den nächsten Transportauftrag'}</div>
        <dl class="dl">${rows.join('')}</dl><div class="ft"><span>Klicken für Details</span></div>`;
    }
    if (h.kind === 'forklift') {
      const f = S.forklift, p = f.driver ? S.people[f.driver] : null;
      return `<div class="h"><div class="t">${esc(f.name || 'Stapler')}<small>${p ? 'Fahrer: ' + esc(p.name) : 'abgestellt'}</small></div><span class="pill" style="--c:var(--mat)"><i></i>${esc(WF.sim.LABELS.forklift[f.state] || f.state)}</span></div>
        <div class="cz">${p ? esc(p.activity || '') : 'Wird für Transporte über 250 kg und Stangenmaterial eingesetzt.'}</div>${p ? '<div class="ft"><span>Klicken: Fahrer anzeigen</span></div>' : ''}`;
    }
    if (h.kind === 'container') {
      let cv = null; try { cv = WF.sim.containerView(h.id); } catch (e) { cv = null; }
      if (!cv) return '';
      const o = S.orders[cv.orderId];
      if (cv.state === 'shipped') {
        const n = Object.values(S.containers).filter(c => c.orderId === cv.orderId && c.state === 'shipped');
        const q = n.reduce((s, c) => s + c.qty, 0);
        return `<div class="h"><div class="t">Versand · ${esc(cv.orderId)}<small>${esc(o ? o.part.name : cv.partName)} · ${esc(o ? o.customer : '')}</small></div><span class="pill" style="--c:var(--st-run)"><i></i>Im Versand</span></div>
          <dl class="dl">${row('Bereitgestellt', `${fmtN(q)} Stk in ${plural(n.length, 'Behälter', 'Behältern')}`)}${o ? row('Auftrag', `${fmtN(o.shippedQty)}/${fmtN(o.qty)} Stk versandt · ${esc(o.status)}`) : ''}</dl><div class="ft"><span>Klicken für Details</span></div>`;
      }
      return `<div class="h"><div class="t">Behälter ${esc(cv.id)}<small>${esc(cv.partName)} · ${fmtN(cv.qty)} Stk · ${U.fmtKg(cv.weightKg)}</small></div><span class="pill" style="--c:var(--mat)"><i></i>${esc(cv.stateLabel)}</span></div>
        <div class="cz">${esc(cv.where)}</div>
        <dl class="dl">${row('Auftrag', esc(cv.orderId) + (o ? ' · ' + esc(o.customer) : ''))}${cv.seq != null ? row('Nächster Schritt', 'AG ' + cv.seq + (o ? ' · ' + esc((o.routing.find(r => r.seq === cv.seq) || {}).op || '') : '')) : ''}${cv.transportId && S.transports[cv.transportId] ? row('Transport', esc(S.transports[cv.transportId].label) + (S.transports[cv.transportId].waitReason ? `<br><span class="wn">${esc(S.transports[cv.transportId].waitReason)}</span>` : '')) : ''}</dl><div class="ft"><span>Klicken für Details</span></div>`;
    }
    if (h.kind === 'store') return storeTip(h.id, S);
    return '';
  }
  function storeTip(id, S) {
    const st = WF.profile.stationById[id]; if (!st) return '';
    const head = (sub, pill) => `<div class="h"><div class="t">${esc(st.short)}<small>${esc(sub || st.name)}</small></div>${pill || ''}</div>`;
    if (id === 'RAW') {
      const mats = Object.values(S.materials);
      const low = mats.filter(m => m.onHand < m.min).length;
      const rows = mats.map(m => row(esc(m.name), `<span class="${m.onHand < m.min ? 'wn' : ''}">${U.fmtNum(m.onHand, m.unit === 'm' ? 1 : 0)} ${esc(m.unit)}</span> <span class="muted">· min ${U.fmtNum(m.min, 0)}${m.onOrder ? ' · bestellt' : ''}</span>`)).join('');
      return head(st.name, low ? `<span class="pill" style="--c:var(--st-wait)"><i></i>${plural(low, 'Material', 'Materialien')} knapp</span>` : `<span class="pill" style="--c:var(--st-run)"><i></i>Bestand ok</span>`) + `<dl class="dl">${rows}</dl><div class="ft"><span>Klicken: knappstes Material</span></div>`;
    }
    if (id === 'CRIB') {
      let ready = 0, regr = 0; for (const k in S.toolStock) { ready += S.toolStock[k].ready || 0; regr += S.toolStock[k].regrind || 0; }
      const inside = Object.values(S.people).filter(p => p.state !== 'offShift' && Math.abs(p.pos.x - 14.75) < 3.8 && p.pos.z < 8);
      return head(st.name) + `<dl class="dl">${row('Vorvermessen', fmtN(ready) + ' Werkzeuge bereit')}${row('Nachschliff', fmtN(regr) + ' Werkzeuge')}${row('Werkzeugkosten heute', U.fmtEur(S.toolCostToday || 0))}${row('Vor Ort', inside.length ? inside.map(p => esc(p.name)).join(', ') : '–')}</dl>`;
    }
    if (id === 'VERSAND') {
      const vs = R.C.vers || [];
      return head(st.name, `<span class="pill" style="--c:var(--st-run)"><i></i>${plural(vs.length, 'Auftrag', 'Aufträge')}</span>`) + `<dl class="dl">${row('Versandt heute', fmtN(S.today ? S.today.shipped : 0) + ' Stk')}${vs.slice(0, 6).map(v => row(esc(v.order), `${fmtN(v.qty)} Stk · ${plural(v.n, 'Behälter', 'Behälter')}`)).join('')}</dl>`;
    }
    if (id === 'EXT' || id === 'WE' || id === 'SPERR') {
      const ss = S.stations[id], ids = ss ? ss.inp.concat(ss.out) : [];
      const rows = ids.slice(0, 6).map(cid => { const c = S.containers[cid]; if (!c) return ''; let w = ''; try { w = WF.sim.containerView(cid).where; } catch (e) { w = ''; } return row(esc(c.orderId), `${fmtN(c.qty)} Stk · <span class="muted">${esc(w.replace(/^[^·]*·\s*/, ''))}</span>`); }).join('');
      const sub = id === 'EXT' ? 'Bereitstellung für die Härterei (Abholung im Lieferfenster)' : id === 'WE' ? 'Wareneingang: Rücklieferungen und Kundenmaterial' : 'Ausschuss und gesperrte Teile';
      return head(sub) + (rows ? `<dl class="dl">${rows}</dl>` : '<div class="cz">Derzeit keine Behälter.</div>');
    }
    if (id === 'CHG') {
      const rows = Object.values(S.agvs).map(a => row(esc(a.name), `${esc(WF.sim.LABELS.agv[a.state] || a.state)} · Akku ${fmtN(a.battery)} %`)).join('');
      return head(st.name) + `<dl class="dl">${rows}</dl>`;
    }
    if (id === 'OFFICE') {
      const lv = R.moList.filter(mo => mo.v && mo.v.conn.level >= 1).length;
      const brk = Object.values(S.people).filter(p => p.state === 'break').length;
      return head(st.name) + `<dl class="dl">${row('MES-Server', `empfängt Daten von ${lv} angebundenen Maschinen`)}${row('Tablet-Rückmeldung', `${R.moList.length - lv} Arbeitsplätze`)}${row('In Pause', brk ? plural(brk, 'Person', 'Personen') : '–')}</dl>`;
    }
    if (id === 'MAINT') {
      const rep = Object.values(S.people).filter(p => p.task && p.task.type === 'repair');
      return head(st.name) + `<dl class="dl">${row('Reparaturen laufend', rep.length ? rep.map(p => esc(p.name) + ' an ' + esc(p.task.machineId || '')).join('<br>') : 'keine')}${row('Störungen heute', fmtN(S.today ? S.today.faults : 0))}</dl>`;
    }
    if (id === 'PUF') return head(st.name) + '<div class="cz">Palettenregal für Halbzeuge, Vorrichtungen und Verpackung (nicht auftragsgebunden).</div>';
    return head(st.name);
  }

  // ================================================================== Zeiger / Raycast
  function bindPointer() {
    const cv = R.canvas;
    cv.addEventListener('pointermove', (e) => {
      const r = R.root.getBoundingClientRect(); R.mouse.x = e.clientX - r.left; R.mouse.y = e.clientY - r.top; R.mouse.in = true;
      // nach einem Klick bleibt die Hover-Karte aus, bis sich die Maus wirklich bewegt (sonst liegt sie über dem Drawer)
      if (R.tipSup && Math.hypot(R.mouse.x - R.tipSup.x, R.mouse.y - R.tipSup.y) > 6) R.tipSup = null;
      if (e.pointerType === 'mouse') { R.hoverDirty = true; positionTip(); }
      if (R.down && Math.hypot(e.clientX - R.down.x, e.clientY - R.down.y) > 6) R.root.classList.add('drag');
    });
    cv.addEventListener('pointerleave', () => { R.mouse.in = false; if (!R.lbHover) setHover(null); });
    cv.addEventListener('pointerdown', (e) => { R.down = { x: e.clientX, y: e.clientY, t: performance.now() }; R.ui.tip.classList.remove('on'); hideHint(); if (R.compact) closeSheets(); });
    window.addEventListener('pointerup', () => { if (R.root) R.root.classList.remove('drag'); });
    cv.addEventListener('pointerup', (e) => {
      const d = R.down; R.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 650) return;
      const r = R.root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      R.tipSup = { x, y };
      // Touch: Doppeltippen wie Doppelklick (heranholen)
      if (e.pointerType !== 'mouse') {
        const lt = R.lastTap, now = performance.now();
        R.lastTap = { x, y, t: now };
        if (lt && now - lt.t < 360 && Math.hypot(x - lt.x, y - lt.y) < 30) { R.lastTap = null; R.lastDblT = now; zoomAt(x, y); return; }
      }
      const hit = pickAt(x, y);
      if (hit) {
        if (hit.kind === 'forklift') { const f = WF.sim.state.forklift; if (f.driver) WF.app.select('person', f.driver); return; }
        if (hit.kind === 'store') { storeClick(hit.id); return; }
        WF.app.select(hit.kind, hit.id);
      } else if (WF.app.selected) WF.app.closeDrawer();
    });
    // Doppelklick: Maschine heranholen, sonst den angeklickten Hallenpunkt in die Bildmitte holen (Abstand bleibt)
    cv.addEventListener('dblclick', (e) => {
      if (performance.now() - R.lastDblT < 500) return;
      const r = R.root.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top);
    });
    R.root.addEventListener('wheel', onWheel, { passive: false, capture: true });
    // Einpassung/Voreinstellung enden erst, wenn die Nutzerin die Kamera wirklich bewegt (ein Klick allein zählt nicht)
    R.controls.addEventListener('change', () => { R.hoverDirty = true; if (R.userCam) { R.tween = null; R.introPending = false; dropFit(); } });
    R.controls.addEventListener('start', () => { R.userCam = true; });
    R.controls.addEventListener('end', () => { R.userCam = false; });
  }
  function zoomAt(x, y) {
    const hit = pickAt(x, y);
    if (hit && hit.kind === 'machine') { focusStation(hit.id); return; }
    NDC.set(x / R.w * 2 - 1, -(y / R.h) * 2 + 1); RAY.setFromCamera(NDC, R.camera);
    const o = RAY.ray.origin, dv = RAY.ray.direction; if (dv.y > -0.05) return;
    const k = -o.y / dv.y, cs = camState();
    dropFit(); R.follow = null;
    goCam({ tx: clamp(o.x + dv.x * k, 0, WF.profile.hall.w), ty: 0, tz: clamp(o.z + dv.z * k, 0, WF.profile.hall.d), r: Math.min(cs.r, 34), phi: cs.phi, th: cs.th }, 0.8);
  }
  function storeClick(id) {
    const S = WF.sim.state;
    if (id === 'RAW') {
      const mats = Object.values(S.materials).sort((a, b) => (a.onHand / Math.max(1e-6, a.min)) - (b.onHand / Math.max(1e-6, b.min)));
      if (mats[0]) WF.app.select('material', mats[0].id);
      return;
    }
    if (id === 'CRIB' && WF.views.find(v => v.id === 'werkzeuge')) { WF.app.navigate('werkzeuge'); return; }
    if (id === 'CHG') { const a = Object.values(S.agvs).sort((p, q) => p.battery - q.battery)[0]; if (a) WF.app.select('agv', a.id); return; }
    focusStation(id);
    applySelection({ kind: 'station', id });
  }
  function hideHint() { if (R.ui.hint && !R.ui.hint.classList.contains('gone')) { R.ui.hint.classList.add('gone'); setTimeout(computeUiRects, 700); } }
  const _hits = [];
  function pickAt(x, y) {
    NDC.set(x / R.w * 2 - 1, -(y / R.h) * 2 + 1);
    RAY.setFromCamera(NDC, R.camera);
    _hits.length = 0;
    RAY.intersectObjects(R.pickActive || R.pick, true, _hits);
    let store = null;
    for (const h of _hits) {
      let o = h.object, ud = o.userData;
      while (o && !(ud && ud.kind)) { o = o.parent; ud = o && o.userData; }
      if (!ud) continue;
      if (ud.kind === 'container') { const id = R.C.byInst[ud.inst][h.instanceId]; if (id) return { kind: 'container', id }; continue; }
      if (ud.kind === 'person' && !R.layers.people) continue;
      if (ud.kind === 'store') { if (!store) store = { kind: 'store', id: ud.id }; continue; }
      return { kind: ud.kind, id: ud.id };
    }
    return store;
  }

  // ================================================================== Hallen-TV im Leitstand (echte Kennzahlen)
  function drawTV(t) {
    const c = t.image, g = c.getContext('2d'), sim = WF.sim, S = sim.state;
    g.fillStyle = '#0b1120'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111a2e'; g.fillRect(0, 0, c.width, 40);
    g.font = FONT(700, 26); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = '#e5ebf5'; g.fillText('werk', 16, 21); g.fillStyle = '#3cc6f2'; g.fillText('fluss', 16 + g.measureText('werk').width, 21);
    g.fillStyle = '#c3cde0'; g.textAlign = 'right'; g.fillText(sim.clock(), c.width - 16, 21);
    const k = S.kpi || {};
    g.textAlign = 'left'; g.font = FONT(600, 15); g.fillStyle = '#8796b0'; g.fillText('OEE HEUTE', 18, 64); g.fillText('GUTTEILE', 168, 64); g.fillText('TERMINTREUE', 318, 64);
    g.font = FONT(600, 40); g.fillStyle = '#e5ebf5';
    g.fillText(U.fmtPct(k.oee), 16, 98); g.fillText(fmtN(k.goodFinished != null ? k.goodFinished : (k.good || 0)), 166, 98); g.fillText(U.fmtPct(k.onTimePct), 316, 98);
    const ids = WF.profile.machines, cw = (c.width - 32 - (ids.length - 1) * 6) / ids.length;
    ids.forEach((id, i) => {
      const m = S.machines[id], col = WF.STATE_HEX[m ? m.state : 'idle'];
      g.fillStyle = col; g.globalAlpha = 0.22; g.fillRect(16 + i * (cw + 6), 132, cw, 74); g.globalAlpha = 1;
      g.fillRect(16 + i * (cw + 6), 200, cw, 6);
      g.fillStyle = '#e5ebf5'; g.font = FONT(600, 15); g.textAlign = 'center'; g.fillText(id === 'QS' ? 'QS' : id.replace('M', ''), 16 + i * (cw + 6) + cw / 2, 168);
    });
    t.needsUpdate = true;
  }

  /** Detail-Drawer rechts: Breite übernehmen (Werkzeugleiste rückt nach links, Kamera-Ausschnitt wird versetzt) */
  function syncDrawer() {
    if (!R.root) return;
    const dr = document.getElementById('drawer'), dw = dr && dr.classList.contains('open') && !R.mobile ? Math.round(dr.getBoundingClientRect().width) : 0;
    if (dw !== R.drawerW) { R.drawerW = dw; R.root.style.setProperty('--dw', dw + 'px'); closeMenus(); layoutModes(); renderSelBar(); renderTip(false); setTimeout(computeUiRects, 260); }
  }
  // ================================================================== Aktualisierung 4×/s (Daten → Darstellung)
  /** Geisterschicht: was läuft wirklich (Engine kpis().ghost) – nie pauschal „autonome Maschinen laufen“ */
  function ghostText() {
    let g = null;
    if ((R.ghAcc = (R.ghAcc || 0) + 1) % 4 === 1 || !R.ghost) { try { g = WF.sim.kpis().ghost; } catch (e) { g = null; } R.ghost = g || { none: true }; }
    g = R.ghost;
    if (!g || g.none || !g.autonomous) return 'keine Maschine läuft';
    const run = g.running || 0, stop = (g.stoppedIds || []).length;
    if (run) return plural(run, 'autonome Maschine läuft', 'autonome Maschinen laufen') + (stop ? ` · ${stop} gestoppt` : '');
    return stop ? `keine Maschine läuft · ${plural(stop, 'autonome gestoppt', 'autonome gestoppt')}` : 'keine Maschine läuft';
  }
  function update() {
    if (!R.ok) return;
    const sim = WF.sim, S = sim.state; if (!S || !S.machines) return;
    const ui = R.ui.st, sh = sim.shift(), P = WF.profile;
    syncDrawer();
    let run = 0, flt = 0, wait = 0, setup = 0, idle = 0;
    for (const id of P.machines) { const st = S.machines[id] ? S.machines[id].state : 'idle', g = (WF.STATE[st] || {}).group; if (st === 'running') run++; else if (g === 'fault') flt++; else if (g === 'wait') wait++; else if (g === 'setup') setup++; else idle++; }
    let duty = 0, brk = 0, walk = 0;
    for (const id in S.people) { const p = S.people[id]; if (p.state === 'offShift') continue; duty++; if (p.state === 'break') brk++; else if (p.state === 'walking' || p.state === 'driving') walk++; }
    let trOpen = 0, trAgv = 0, trFork = 0, trWait = 0, trPlan = 0;
    for (const id in S.transports) {
      const t = S.transports[id]; if (t.status === 'done' || t.cancelled) continue;
      trOpen++;
      if (t.status !== 'open') { if (t.mode === 'AGV') trAgv++; else trFork++; }
      else if (t.phase === 'geplant' || t.waitCode === 'destFull') trPlan++; else trWait++;
    }
    const set = (k, v, html) => { const n = ui[k]; if (!n) return; if (html) { if (n._v !== v) { n.innerHTML = v; n._v = v; } } else if (n.textContent !== v) n.textContent = v; };
    set('clock', sim.clock());
    if (sh) {
      const until = U.fmtClock(sh.inBreak && sh.breakEndsAt ? sh.breakEndsAt : sh.endsAt);
      set('shift', sh.id ? `<b>${esc(sh.name)}${sh.inBreak ? ' · Pause' : ''}</b><span>bis ${until}</span>` : `<b>Keine Schicht</b><span>${esc(ghostText())} · Schichtbeginn ${U.fmtDayClock(sh.endsAt)}</span>`, true);
      ui.shift.classList.toggle('br', !!sh.inBreak);
    }
    R.lightT = sh && sh.id ? 1 : 0.42;
    ui.live.classList.toggle('paused', !!WF.app.paused);
    if (ui.live._p !== !!WF.app.paused) { ui.live._p = !!WF.app.paused; ui.live.innerHTML = `<i></i>${WF.app.paused ? 'Pausiert' : 'Live'}`; }
    set('run', `${run}<small>/${P.machines.length}</small>`, true);
    const rs = []; if (flt) rs.push(plural(flt, 'Störung', 'Störungen')); if (wait) rs.push(wait + ' wartend'); if (setup) rs.push(setup + ' Rüsten'); if (idle) rs.push(idle + ' bereit');
    set('runS', rs.slice(0, 2).join(' · ') || 'alle in Produktion'); if (ui.runS.title !== rs.join(' · ')) ui.runS.title = rs.join(' · ');
    ui.runS.classList.toggle('f', !!flt); ui.runS.classList.toggle('w', !flt && !!wait);
    set('ppl', String(duty));
    set('pplS', duty ? (brk ? `${brk} in Pause` : `${walk} unterwegs`) : 'Halle leer');
    set('tr', String(trOpen));
    set('trS', trOpen ? [trAgv ? trAgv + ' AGV' : '', trFork ? trFork + ' Stapler' : '', trWait ? trWait + ' wartend' : '', trPlan ? trPlan + ' Ziel voll' : ''].filter(Boolean).join(' · ') : 'alles zugestellt');
    set('mline', `<span><b>${run}/${P.machines.length}</b> in Produktion</span>${flt ? `<span class="f"><b>${flt}</b> Störung</span>` : wait ? `<span class="w"><b>${wait}</b> wartend</span>` : ''}<span><b>${duty}</b> Personen</span><span><b>${trOpen}</b> Transporte</span>`, true);
    // Maschinen
    for (const mo of R.moList) {
      let v = null; try { v = sim.machineView(mo.id); } catch (e) { v = null; }
      if (!v) continue;
      mo.v = v;
      const mm = R.ui.mm && R.ui.mm[mo.id];
      if (mm && mm.st !== v.state) { mm.st = v.state; const hx = WF.STATE_HEX[v.state] || '#7b8aa8'; mm.r.setAttribute('fill', hx); mm.r.setAttribute('stroke', hx); mm.g.classList.toggle('fl', v.state === 'fault'); }
      if (mm) { const tt = `${mo.id} · ${v.short} – ${v.stateLabel}: ${v.cause}`; if (mm.tt.textContent !== tt) mm.tt.textContent = tt; }
      if (mo.state !== v.state) applyMachineState(mo, v.state);
      const l = R.lb[mo.id]; if (l) { updateLabel(l, v); l.pri = priOf(mo.id, v); }
      const lv = v.conn.level;
      if (R.branches[mo.id]) R.branches[mo.id].visible = lv >= 1;
      if (mo.tablet) mo.tablet.g.visible = lv === 0;
      updateMachineDyn(mo, v, S);
    }
    // Minikarte: Personen, AGVs, Stapler
    if (R.ui.mmDots && R.layers.people) {
      for (const id in R.ui.mmDots) {
        const d = R.ui.mmDots[id], p = S.people[id] || S.agvs[id];
        const show = p && (S.agvs[id] || (p.state !== 'offShift' && !p.vehicle));
        const x = show ? p.pos.x : -9, z = show ? p.pos.z : -9;
        if (d.tagName === 'circle') { d.setAttribute('cx', x.toFixed(2)); d.setAttribute('cy', z.toFixed(2)); }
        else { d.setAttribute('x', (x - 0.55).toFixed(2)); d.setAttribute('y', (z - 0.55).toFixed(2)); }
      }
      const f = S.forklift; if (f && R.ui.mmFork) { R.ui.mmFork.setAttribute('x', (f.pos.x - 0.65).toFixed(2)); R.ui.mmFork.setAttribute('y', (f.pos.z - 0.65).toFixed(2)); }
    }
    updateRaw(S);
    updateContainers(S);
    updateFlows(S);
    if ((R.netAcc = (R.netAcc || 0) + 1) % 8 === 1) updateNet(S);
    if (R.hover) renderTip(false);
    const sb = R.ui.sel && !R.ui.sel.hidden && R.ui.sel.querySelector('[data-ac]');
    if (sb && R.selTarget) { const s = R.selTarget; const act = s.kind === 'person' ? (S.people[s.id] ? S.people[s.id].activity : '') : (S.agvs[s.id] ? (S.agvs[s.id].taskLabel || WF.sim.LABELS.agv[S.agvs[s.id].state] || '') : ''); if (sb.textContent !== act) sb.textContent = act || ''; }
    R.tvAcc = (R.tvAcc || 0) + 1;
    if (R.tvTex && R.tvAcc % 20 === 1) drawTV(R.tvTex);
    // Tageslicht im Fensterband
    const hr = (S.t % 86400) / 3600, day = hr > 7 && hr < 18.5 ? 1 : hr > 6 && hr < 19.5 ? 0.55 : 0.08;
    M.winGlass.emissiveIntensity = 0.55 * day; M.winGlass.color.setHex(day > 0.5 ? 0xa9c1d6 : 0x3a4a63);
    // Aktive Pick-Liste
    const act = R.pickActive || (R.pickActive = []); act.length = 0;
    for (const mo of R.moList) act.push(mo.proxy);
    for (const id in R.agvs) act.push(R.agvs[id].proxy);
    act.push(R.fork.proxy);
    if (R.layers.people) for (const id in R.people) if (R.people[id].vis) act.push(R.people[id].proxy);
    act.push(R.C.klt, R.C.gb, R.C.rack, R.C.wrap);
    for (const p of R.pick) if (p.userData && p.userData.kind === 'store') act.push(p);
    if (R.route.id && (R.routeAcc = (R.routeAcc || 0) + 1) % 8 === 0) refreshRoute();
    checkFit();
  }
  function applyMachineState(mo, st) {
    mo.state = st;
    const T = mo.tower, hex = WF.STATE_HEX[st] || '#7b8aa8';
    const idx = st === 'fault' ? 2 : st === 'running' ? 0 : st === 'idle' ? -1 : 1;
    T.mats.forEach((m, i) => {
      if (i === idx) { m.color.set(hex); m.emissive.set(hex); m.emissiveIntensity = 2.2; m.opacity = 1; }
      else { m.color.setHex(T.base[i]); m.emissive.setHex(0x000000); m.emissiveIntensity = 0; m.opacity = 0.9; }
    });
    T.lit = idx;
    if (idx >= 0) { T.halo.position.set(0, 0.26 + idx * 0.082 + 0.04, 0); T.halo.material.color.set(hex); T.halo.material.opacity = 0.9; T.halo.visible = true; }
    else T.halo.visible = false;
    srgb(hex, mo.glow.mat.uniforms.uColor.value);
    mo.glowBase = st === 'idle' ? 0.32 : st === 'fault' ? 1.25 : st === 'running' ? 0.8 : 0.95;
    const lightOn = st === 'running' || st === 'setup' || st === 'toolchange' || st === 'firstPiece';
    mo.innerTarget = st === 'running' ? 0.95 : lightOn ? 0.6 : st === 'fault' ? 0.35 : 0.1;
    mo.inner.emissive.setHex(st === 'fault' ? 0xff6a5a : st === 'running' ? 0xfff3df : 0xe4eeff);
    R.shadowDirty = true;
  }
  /** Daten, die das Modell beeinflussen: Stangen, Werkstückmaße, Montage-Fortschritt */
  function updateMachineDyn(mo, v, S) {
    const m = S.machines[mo.id], a = mo.a; if (!a || !m) return;
    const ord = m.op ? S.orders[m.op.oid] : null, r = ord ? ord.routing[m.op.idx] : null;
    const key = (ord ? ord.id + r.seq : '-');
    if (mo.type === 'saw') {
      const mat = r && r.material ? S.materials[r.material.id] : null;
      const dm = dimsOf(mat ? mat.name : '') || { d: 0.06 };
      const rad = clamp((dm.d || 0.06) / 2, 0.02, 0.07), show = !!mat;
      const sig = key + '|' + rad + '|' + show + '|' + (mat ? Math.round(mat.onHand) : 0);
      if (a.sig !== sig) {
        a.sig = sig;
        a.bar.visible = show;
        if (show) { a.bar.scale.set(rad, 2.75, dm.flat ? dm.d2 / 2 : rad); a.bar.position.set(-1.7, a.top + rad - 0.02, a.zc); }
        const nMag = show ? clamp(Math.ceil((mat.onHand || 0) / 6), 0, 4) : 0;
        a.mag.forEach((g, i) => { g.visible = i < nMag; g.scale.set(rad, 2.6, rad); g.position.set(-1.95, 0.93 + rad + (i % 2) * 0.01, a.zc - 0.62 - i * (rad * 2 + 0.03)); });
        a.cutH = rad * 2 + 0.06;
        R.shadowDirty = true;
      }
    } else if (mo.type === 'swiss') {
      const n = clamp(Math.ceil((m.barStockM || 0) / 3 - 1e-6), 0, 5);
      if (a.n !== n) { a.n = n; a.bars.forEach((g, i) => { g.visible = i < n; g.scale.set(0.008, 3.25, 0.008); g.position.set(-1.35, 1.03 + i * 0.006, 0.52 + i * 0.045); }); }
    } else if (mo.type === 'biglathe' || mo.type === 'deephole') {
      if (a.key !== key) {
        a.key = key;
        const dm = ord ? dimsOf(ord.part.name) : null;
        const rad = clamp(dm && dm.d ? dm.d / 2 * 1.15 : 0.07, 0.035, 0.17), len = clamp(dm && dm.l ? dm.l : 1.6, 0.25, mo.type === 'biglathe' ? 4.6 : 2.6);
        a.wr = rad; a.wl = len;
        if (mo.type === 'biglathe') {
          a.work.scale.set(rad, len, rad); a.work.position.set(0.36 + len / 2, 0, 0);
          const tip = a.cx0 + 0.36 + len; a.tail.position.x = tip + 0.48 + 0.2; a.rest.position.x = a.cx0 + 0.36 + len * 0.55; a.x0 = a.cx0 + 0.6; a.x1 = tip - 0.25;
        } else {
          a.work.scale.set(rad, len, rad); a.work.position.set(0.2 + len / 2, 0, 0);
          a.oilX = -4.25 + 0.2 + len + 0.32; a.oil.position.x = a.oilX;
        }
        R.shadowDirty = true;
      }
      const vis = !!ord && m.state !== 'idle';
      if (a.work.visible !== vis) { a.work.visible = vis; R.shadowDirty = true; }
    } else if (mo.type === 'assembly') {
      const prog = mo.prog || 0, run = m.state === 'running';
      const outN = (S.stations[mo.id] ? S.stations[mo.id].out.length : 0);
      a.mods.forEach((md, i) => {
        const isActive = run && i === 1, done = i === 2 && outN > 0, staged = i === 0 && !!ord;
        md.g.visible = isActive || done || staged;
        const p = isActive ? prog : (done ? 1 : 0.15);
        md.motor.visible = p > 0.3; md.gear.visible = p > 0.5; md.belt.visible = p > 0.7; md.cover.visible = p > 0.9;
      });
    }
  }
  function updateRaw(S) {
    const sig = Object.keys(R.rawSlots).map(id => S.materials[id] ? Math.ceil(S.materials[id].onHand / 6) : 0).join(',') + '|' + ['MAT-ALBL', 'MAT-GUSSLD'].map(id => S.materials[id] ? S.materials[id].onHand : 0).join(',');
    if (sig === R.rawSig) return;
    R.rawSig = sig;
    let nb = 0, nf = 0, nc = 0;
    const col = new THREE.Color();
    for (const id in R.rawSlots) {
      const mt = S.materials[id]; if (!mt) continue;
      const [lv, slot] = R.rawSlots[id], dm = dimsOf(mt.name) || { d: 0.04 };
      const count = clamp(Math.ceil(mt.onHand / 6 - 1e-6), 0, 18);
      const y0 = R.rawLevels[lv] + 0.1, zA = 0.95 + slot * 0.62, zLen = 0.56;
      col.set(MAT_COL[id] || '#cccccc');
      if (dm.flat) {
        const w = dm.d, hh = dm.d2, perRow = Math.max(1, Math.floor(zLen / (w + 0.01)));
        for (let i = 0; i < count && nf < 60; i++) { const rw = i % perRow, layer = Math.floor(i / perRow); const z = zA + w / 2 + rw * (w + 0.01), y = y0 + hh / 2 + layer * (hh + 0.005); R.flatInst.setMatrixAt(nf++, xf(4.7, y, z, 0, 0, 0, 6.0, hh, w)); if (nc < 200) { R.capsInst.setMatrixAt(nc, xf(7.71, y, z, 0, 0, PI / 2, w * 0.45, 0.012, hh * 0.45)); R.capsInst.setColorAt(nc++, col); } }
      } else {
        const r = Math.max(0.012, dm.d / 2), perRow = Math.max(1, Math.floor(zLen / (2 * r + 0.008)));
        for (let i = 0; i < count && nb < 200; i++) {
          const rw = i % perRow, layer = Math.floor(i / perRow);
          const y = y0 + r + layer * 2 * r * 0.87, z = zA + r + rw * (2 * r + 0.008) + (layer % 2) * r;
          M4.makeRotationZ(PI / 2); M4.scale(V3.set(r, 6.0, r)); M4.setPosition(4.7, y, z); R.barsInst.setMatrixAt(nb++, M4);
          if (nc < 200) { M4.makeRotationZ(PI / 2); M4.scale(V3.set(r * 1.01, 0.012, r * 1.01)); M4.setPosition(7.705, y, z); R.capsInst.setMatrixAt(nc, M4); R.capsInst.setColorAt(nc++, col); }
        }
      }
    }
    R.barsInst.count = nb; R.flatInst.count = nf; R.capsInst.count = nc;
    R.barsInst.instanceMatrix.needsUpdate = true; R.flatInst.instanceMatrix.needsUpdate = true; R.capsInst.instanceMatrix.needsUpdate = true; if (R.capsInst.instanceColor) R.capsInst.instanceColor.needsUpdate = true;
    for (const id in R.rawBins) { const mt = S.materials[id]; const f = mt ? clamp(mt.onHand / (mt.reorderQty || 40), 0.03, 1) : 0; R.rawBins[id].scale.y = 0.6 * f; }
    R.shadowDirty = true;
  }

  // ================================================================== Pro Bild: Interpolation & Animation
  /** Pausenplätze im Leitstand: rund um den Pausentisch, danach ein zweiter Ring (die Engine vergibt nur 6 Plätze) */
  const BREAK_SLOTS = (() => {
    const out = [], cx = 59.5, cz = 5.5;
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + PI / 8; out.push({ x: cx + Math.sin(a) * 1.02, z: cz + Math.cos(a) * 1.02 }); }
    for (let k = 0; k < 14; k++) { const a = k * TAU / 14; const x = cx + Math.sin(a) * 1.85, z = cz + Math.cos(a) * 1.85; if (z > 4.2 && z < 7.6 && x > 57.4 && x < 62.2) out.push({ x, z }); }
    return out;
  })();
  function sample(S) {
    let bi = 0;
    for (const id in R.people) {
      const pe = R.people[id], p = S.people[id];
      const vis = !!p && p.state !== 'offShift' && !p.vehicle;
      if (vis && !pe.vis) { pe.x = p.pos.x; pe.z = p.pos.z; pe.th = pe.h = p.heading || 0; }
      pe.vis = vis;
      if (!p) continue;
      const brk = p.state === 'break' && !p.route && BREAK_SLOTS.length ? BREAK_SLOTS[bi++ % BREAK_SLOTS.length] : null;
      pe.x0 = pe.x; pe.z0 = pe.z; pe.x1 = brk ? brk.x : p.pos.x; pe.z1 = brk ? brk.z : p.pos.z;
      if (Math.hypot(pe.x1 - pe.x, pe.z1 - pe.z) > 40) { pe.x = pe.x0 = pe.x1; pe.z = pe.z0 = pe.z1; }
      const mv = Math.hypot(pe.x1 - pe.x0, pe.z1 - pe.z0);
      pe.moving = mv > 0.02 && (p.state === 'walking' || !!p.route);
      if (pe.moving) pe.th = Math.atan2(pe.x1 - pe.x0, pe.z1 - pe.z0);
      else if (p.state === 'working' && p.task) { const tgt = faceTarget(p); if (tgt) pe.th = Math.atan2(tgt.x - pe.x1, tgt.z - pe.z1); }
      else if (p.state === 'break') pe.th = Math.atan2(59.5 - pe.x1, 5.5 - pe.z1);
      pe.working = p.state === 'working';
      const tk = p.task;
      pe.carry = !!(tk && ((tk.type === 'toolChange' && tk.data && tk.data.fetched) || (tk.type === 'fpi' && S.machines[tk.machineId] && S.machines[tk.machineId].fpi && S.machines[tk.machineId].fpi.stage === 'carry')));
      if (pe.rk === 'qs' && tk && (tk.type === 'inspect' || tk.type === 'fpi')) pe.carry = pe.carry || p.state === 'walking';
    }
    for (const id in R.agvs) {
      const ae = R.agvs[id], a = S.agvs[id]; if (!a) continue;
      if (!ae.init) { ae.x = a.pos.x; ae.z = a.pos.z; ae.th = ae.h = a.heading || 0; ae.init = true; }
      ae.x0 = ae.x; ae.z0 = ae.z; ae.x1 = a.pos.x; ae.z1 = a.pos.z;
      if (Math.hypot(ae.x1 - ae.x, ae.z1 - ae.z) > 40) { ae.x = ae.x0 = ae.x1; ae.z = ae.z0 = ae.z1; }
      const mv = Math.hypot(ae.x1 - ae.x0, ae.z1 - ae.z0);
      if (mv > 0.02) ae.th = Math.atan2(ae.x1 - ae.x0, ae.z1 - ae.z0);
      else if (a.state === 'charging') ae.th = PI;
      ae.st = a.state; ae.bat = a.battery; ae.low = a.mustCharge || a.battery < 25;
    }
    const f = S.forklift, fe = R.fork;
    if (f && fe) {
      if (!fe.init) { fe.x = f.pos.x; fe.z = f.pos.z; fe.th = fe.h = f.heading || 0; fe.init = true; }
      fe.x0 = fe.x; fe.z0 = fe.z; fe.x1 = f.pos.x; fe.z1 = f.pos.z;
      if (Math.hypot(fe.x1 - fe.x, fe.z1 - fe.z) > 40) { fe.x = fe.x0 = fe.x1; fe.z = fe.z0 = fe.z1; }
      const mv = Math.hypot(fe.x1 - fe.x0, fe.z1 - fe.z0);
      if (mv > 0.02) fe.th = Math.atan2(fe.x1 - fe.x0, fe.z1 - fe.z0);
      fe.driving = f.state === 'driving'; fe.load = f.load;
      const drv = f.driver ? S.people[f.driver] : null, dk = drv ? drv.id : null;
      if (dk !== fe.driverKey) { fe.driverKey = dk; if (drv) fe.driver.geometry = personGeos(roleOf(drv.role), skinOf(drv.id)).seated; }
      fe.driver.visible = !!drv && R.layers.people;
    }
    for (const mo of R.moList) {
      const m = S.machines[mo.id]; if (!m) continue;
      const p1 = m.part ? (m.part.sub === 'load' ? 0 : clamp(1 - m.part.rem / m.part.dur, 0, 1)) : 0;
      mo.p0 = p1 < mo.prog - 0.05 ? p1 : mo.prog; mo.p1 = p1;
      const c = m.counter;
      if (R.lastCounter[mo.id] != null && c > R.lastCounter[mo.id]) onPartDone(mo);
      R.lastCounter[mo.id] = c;
    }
  }
  function faceTarget(p) {
    const tk = p.task, P = WF.profile;
    let id = tk.machineId;
    for (let k = tk.si; k >= 0 && !id; k--) if (tk.steps[k] && tk.steps[k].to) id = tk.steps[k].to;
    if (!id) return null;
    const st = P.stationById[id]; if (!st) return null;
    if (st.id === 'QS' && st.cmm && Math.hypot(st.work.x - p.pos.x, st.work.z - p.pos.z) < 3) return { x: st.cmm.x + st.cmm.w / 2, z: st.cmm.z + st.cmm.d / 2 };
    if (st.id === 'M13') return { x: 59.4, z: p.pos.z };
    if (st.id === 'CRIB') return { x: st.presetter.x, z: st.presetter.z };
    if (st.footprint && Math.hypot(st.work.x - p.pos.x, st.work.z - p.pos.z) < 2.5) return { x: st.footprint.x + st.footprint.w / 2, z: st.footprint.z + st.footprint.d / 2 };
    return null;
  }
  function onPartDone(mo) {
    if (mo.type === 'mill5') mo.a.palTarget += PI;
    if (mo.type === 'lathe') mo.a.loadT = 0;
    const now = R.time;
    if (now - (mo.lastDone || -9) > 1.4) {
      mo.lastDone = now;
      const l = R.lb[mo.id]; if (l) { l.el.classList.add('done'); clearTimeout(l.doneT); l.doneT = setTimeout(() => l.el.classList.remove('done'), 900); }
      if (mo.outW && R.visible) ping(mo.outW.x, 0.05, mo.outW.z, null, 0.75, 0x34d399);
    }
  }

  const _CS = { tx: 0, ty: 0, tz: 0, r: 1, phi: 1, th: 0 };
  function frame(dt) {
    if (!R.ok || !R.visible) return;
    const S = WF.sim && WF.sim.state; if (!S || !S.machines) return;
    dt = Math.min(dt || 0.016, 0.1);
    R.time += dt;
    // Einflug beim ersten Öffnen: erst nach den ersten Bildern starten (Shader-Kompilierung würde sonst den Anfang verschlucken)
    if (R.introPending && ++R.introN > 3) { R.introPending = false; goCam(R.introDst, 2.2); }
    const t = R.time, app = WF.app;
    // Simulationszeit für die Interpolation (Engine rechnet in 1-s-Schritten)
    if (S.t !== R.lastT) {
      if (R.lastT < 0 || S.t < R.lastT || S.t - R.renderT > 30) R.renderT = S.t - 0.001;
      R.sT0 = Math.max(R.renderT, S.t - 3); R.renderT = R.sT0; R.sT1 = S.t; R.lastT = S.t;
      sample(S);
    }
    if (app.paused) R.renderT = R.sT1; else R.renderT = Math.min(R.sT1, R.renderT + dt * (app.speed || 30));
    const al = R.sT1 > R.sT0 ? clamp((R.renderT - R.sT0) / (R.sT1 - R.sT0), 0, 1) : 1;
    const running = !app.paused;
    // Hallenbeleuchtung: außerhalb der Schichten gedimmt (Geisterschicht – nur die Maschinen leuchten)
    const lt = R.lightT == null ? 1 : R.lightT;
    if (Math.abs((R.lightK == null ? 1 : R.lightK) - lt) > 0.002) { R.lightK = damp(R.lightK == null ? 1 : R.lightK, lt, 1.6, dt); R.sun.intensity = 1.22 * R.lightK; R.hemi.intensity = 0.5 * (0.35 + 0.65 * R.lightK); R.fill.intensity = 0.3 * R.lightK;
      const night = Math.max(0, Math.min(1, (1 - R.lightK) / 0.58));
      if (R.envMats) for (const m of R.envMats) m.envMapIntensity = m.userData.envBase * (1 - 0.6 * night);
      if (R.poolMat) { R.poolMat.opacity = 0.5 * night; R.pools.visible = night > 0.02; } }

    // Kamera: Fahrt, Folgen, Steuerung
    if (R.tween) {
      const tw = R.tween; tw.t += dt / tw.dur; const k = easeIO(Math.min(1, tw.t)), s = tw.src, d = tw.dst, c = _CS;
      c.tx = s.tx + (d.tx - s.tx) * k; c.ty = s.ty + (d.ty - s.ty) * k; c.tz = s.tz + (d.tz - s.tz) * k; c.r = s.r + (d.r - s.r) * k; c.phi = s.phi + (d.phi - s.phi) * k; c.th = s.th + (d.th - s.th) * k;
      setCam(c); R.hoverDirty = true;
      if (tw.t >= 1) R.tween = null;
    } else if (R.follow) {
      const ps = R.follow.kind === 'person' ? S.people[R.follow.id] : null;
      const e = R.follow.kind === 'agv' ? R.agvs[R.follow.id] : ps && ps.vehicle ? R.fork : R.people[R.follow.id];
      if (e && (R.follow.kind === 'agv' || (ps && (ps.vehicle || R.people[R.follow.id].vis)))) { const tg = R.controls.target, nx = damp(tg.x, e.x, 4, dt), nz = damp(tg.z, e.z, 4, dt); R.camera.position.x += nx - tg.x; R.camera.position.z += nz - tg.z; tg.x = nx; tg.z = nz; }
    }
    const vo = (R.drawerW || 0) / 2;
    if (Math.abs((R.viewOff || 0) - vo) > 0.5) { R.viewOff = damp(R.viewOff || 0, vo, 7, dt); if (Math.abs(R.viewOff - vo) <= 0.6) R.viewOff = vo; applyViewOffset(); }
    R.controls.update();
    clampTarget();
    const cp = R.camera.position;
    for (const w of R.walls) {
      const tgt = w.outside(cp) ? 0 : 1;
      if (Math.abs(w.f - tgt) > 0.001) { w.f = damp(w.f, tgt, 7, dt); if (Math.abs(w.f - tgt) < 0.01) w.f = tgt; w.g.scale.y = Math.max(0.001, w.f); w.g.visible = w.f > 0.01; R.shadowDirty = true; }
    }
    // Hallenleuchten nur in der Nahansicht (aus der Übersicht wirken sie wie Flecken)
    const lampOn = cp.y < 7.5;
    for (const f of R.fade) if (f.obj.visible !== lampOn) f.obj.visible = lampOn;

    // Personen
    for (const id in R.people) {
      const pe = R.people[id];
      const show = pe.vis && R.layers.people;
      if (pe.g.visible !== show) pe.g.visible = show;
      if (!pe.vis) continue;
      const nx = pe.x0 + (pe.x1 - pe.x0) * al, nz = pe.z0 + (pe.z1 - pe.z0) * al;
      const dist = Math.hypot(nx - pe.x, nz - pe.z);
      pe.x = nx; pe.z = nz;
      pe.h += angD(pe.h, pe.th) * (1 - Math.exp(-dt * 10));
      if (!show) continue;
      pe.g.position.set(pe.x, 0, pe.z); pe.g.rotation.y = pe.h;
      const walking = pe.moving && running;
      pe.walk = damp(pe.walk, walking ? 1 : 0, 8, dt);
      pe.work = damp(pe.work, pe.working && !walking ? 1 : 0, 5, dt);
      if (walking) pe.phase += Math.min(dist * 4.4, dt * 14);
      const sw = Math.sin(pe.phase) * 0.55 * pe.walk;
      pe.legL.rotation.x = sw; pe.legR.rotation.x = -sw;
      const wk = pe.work * (-0.52 + Math.sin(t * 3.1 + pe.x) * 0.1);
      pe.armL.rotation.x = -sw * 0.8 + wk; pe.armR.rotation.x = sw * 0.8 + wk * (pe.carry ? 0.3 : 1) - (pe.carry ? 0.55 : 0);
      pe.armL.rotation.z = -0.06 + pe.work * 0.2; pe.armR.rotation.z = 0.06 - pe.work * 0.2;
      pe.g.position.y = Math.abs(Math.cos(pe.phase)) * 0.028 * pe.walk;
      if (pe.item.visible !== pe.carry) pe.item.visible = pe.carry;
    }
    // AGVs
    for (const id in R.agvs) {
      const ae = R.agvs[id];
      ae.x = ae.x0 + (ae.x1 - ae.x0) * al; ae.z = ae.z0 + (ae.z1 - ae.z0) * al;
      ae.h += angD(ae.h, ae.th) * (1 - Math.exp(-dt * 6));
      ae.g.position.set(ae.x, 0, ae.z); ae.g.rotation.y = ae.h;
      const busy = ae.st && ae.st !== 'idle' && ae.st !== 'charging';
      let col = 0xc9d4e0, k = 0.5;
      if (ae.st === 'charging') { col = 0x34d399; k = 0.6 + 0.4 * Math.sin(t * 2.4) ** 2; }
      else if (ae.low) { col = 0xfbbf24; k = 0.55 + 0.45 * (Math.sin(t * 5) > 0 ? 1 : 0); }
      else if (busy) { col = 0x3cc6f2; k = 1; }
      ae.led.color.setHex(col).multiplyScalar(k * 1.7);
      ae.glow.material.color.setHex(col); ae.glow.material.opacity = 0.16 + 0.22 * k;
    }
    if (R.chgLeds) ['AGV1', 'AGV2'].forEach((id, i) => { const a = S.agvs[id]; const on = a && a.state === 'charging'; R.chgLeds[i].color.setHex(on ? 0x34d399 : 0x1b3a2c); if (on) R.chgLeds[i].color.multiplyScalar(1.4 + 0.6 * Math.sin(t * 3)); });
    // Stapler
    const fe = R.fork;
    if (fe && fe.init) {
      fe.x = fe.x0 + (fe.x1 - fe.x0) * al; fe.z = fe.z0 + (fe.z1 - fe.z0) * al;
      fe.h += angD(fe.h, fe.th) * (1 - Math.exp(-dt * 6));
      fe.g.position.set(fe.x, 0, fe.z); fe.g.rotation.y = fe.h;
      fe.fy = damp(fe.fy, fe.load ? 0.32 : 0.1, 3, dt); fe.forks.position.y = fe.fy - 0.1;
      fe.bars.visible = fe.load === 'Stangen';
      fe.spot.visible = fe.driving; fe.spot.material.opacity = 0.45 + 0.2 * Math.sin(t * 6);
      fe.beacon.color.setHex(fe.driving && Math.sin(t * 9) > 0 ? 0xffb347 : 0x5a3a14).multiplyScalar(fe.driving ? 1.8 : 1);
    }
    for (const mo of R.moList) animMachine(mo, dt, t, al, S, running);
    writeContainers(t);
    if (R.layers.flow) { flowHeads(t); for (const k in R.flowMats) R.flowMats[k].uniforms.uTime.value = t; }
    else if (R.route.id) R.flowMats.route.uniforms.uTime.value = t;
    // Auswahl
    const st = R.selTarget;
    if (st && R.selRing.visible) {
      let x = null, z = null;
      if (st.kind === 'person') { const pe = R.people[st.id], ps = S.people[st.id]; if (ps && ps.vehicle) { x = fe.x; z = fe.z; } else if (pe && pe.vis) { x = pe.x; z = pe.z; } }
      else if (st.kind === 'agv') { const ae = R.agvs[st.id]; if (ae) { x = ae.x; z = ae.z; } }
      else if (st.kind === 'forklift') { x = fe.x; z = fe.z; }
      else if (st.kind === 'container') { const e = R.C.list.find(c => c.id === st.id); if (e && e.wx != null) { x = e.wx; z = e.wz; } else { const v = R.C.vers.find(q => q.last === st.id); if (v) { x = v.slot.x; z = v.slot.z; } } }
      if (x != null) { R.selRing.position.set(x, 0.03, z); const s = 1.15 + 0.08 * Math.sin(t * 4), big = st.kind === 'agv' || st.kind === 'forklift' ? 1.6 : 1; R.selRing.scale.set(s * big, 1, s * big); R.selRing.material.opacity = 0.95; }
      else R.selRing.material.opacity = 0;
    }
    if (R.selBox.visible) R.selBox.material.opacity = 0.65 + 0.35 * Math.sin(t * 3.2);
    // Flussnetz nur in der Übersicht: aus der Nähe würden die Bögen als breite Lichtbänder vor der Kamera stehen
    { const cd = R.camera.position.distanceTo(R.controls.target), k = Math.max(0, Math.min(1, (cd - 34) / 26));
      if (R.flowFlash > 0) R.flowFlash = Math.max(0, R.flowFlash - dt);
      const fl = Math.min(1, R.flowFlash / 0.6);   // „Fluss“-Hervorhebung nach dem Einschalten der Ebene
      R.netK = Math.max(k, fl * 0.85);
      R.netMat.uniforms.uOp.value = Math.max(0.62 * k * (R.route && R.route.id ? 0.3 : 1), 0.95 * fl);
      R.netMat.uniforms.uR.value = Math.max(0.03, cd * 0.001);
      R.netEnds.material.opacity = 0.85 * R.netK * (R.route && R.route.id ? 0.35 : 1);
      R.netGroup.visible = R.netK > 0.02;
      // Bänder wachsen mit dem Abstand (Mindestbreite w0), damit Transporte aus der Übersicht sichtbar bleiben
      const wk = Math.max(1, cd * 0.0065 / 0.42) * (1 + 0.5 * fl);
      for (const key in R.flowMats) { const m = R.flowMats[key]; m.uniforms.uHalfW.value = m.userData.w0 * 0.5 * wk; }
      R.flowMats.wait.uniforms.uOp.value = 0.4 + 0.5 * fl;
      const ss = Math.max(1.1, cd * 0.016); for (const sp of R.stops) if (sp.visible) sp.scale.set(ss, ss, 1); }
    netPulses(dt);
    pulses(dt, t);
    // Hover (Raycast höchstens jedes zweite Bild)
    R.hoverN = (R.hoverN || 0) + 1;
    if (R.hoverDirty && !R.down && R.mouse.in && !R.lbHover && R.hoverN % 2 === 0) { R.hoverDirty = false; setHover(pickAt(R.mouse.x, R.mouse.y)); }
    else if (R.down) { if (R.hover) setHover(null); }
    R.shadowAcc += dt;
    if (R.shadowAcc > 0.25 || (R.shadowDirty && R.shadowAcc > 0.05)) { R.shadowAcc = 0; R.shadowDirty = false; R.renderer.shadowMap.needsUpdate = true; }
    adaptPerf(dt);
    R.renderer.render(R.scene, R.camera);
    placeLabels();
    if ((R.mmN = (R.mmN || 0) + 1) % 3 === 0) updateMinimapView();
  }

  function animMachine(mo, dt, t, al, S, running) {
    const m = S.machines[mo.id]; if (!m) return;
    const st = m.state, a = mo.a || {};
    mo.prog = mo.p0 + (mo.p1 - mo.p0) * al;
    const cutting = st === 'running' && m.part && m.part.sub === 'cut' && !m.part.paused && running;
    const dressing = st === 'running' && m.dressRem > 0 && running;
    if (mo.door) {
      const open = !!(m.setupRun || m.toolchange || m.corrRun || (m.part && m.part.sub === 'load') || st === 'fault' && m.fault && m.fault.repairBy);
      const d = mo.door, tg = open ? 1 : 0;
      if (Math.abs(d.f - tg) > 0.002) {
        d.f = damp(d.f, tg, 3.5, dt); if (Math.abs(d.f - tg) < 0.003) d.f = tg;
        if (d.vertical) d.obj.position.y = d.y0 + d.lift * d.f; else if (d.parts) for (const p of d.parts) p.obj.position.x = p.x0 + p.slide * d.f; else d.obj.position.x = d.x0 + d.slide * d.f;
        R.shadowDirty = true;
      }
    }
    const it = mo.innerTarget != null ? mo.innerTarget : 0.1;
    if (Math.abs(mo.inner.emissiveIntensity - it) > 0.003) mo.inner.emissiveIntensity = damp(mo.inner.emissiveIntensity, it, 4, dt);
    let gi = mo.glowBase || 0.4;
    if (st === 'fault') {
      gi *= 0.55 + 0.45 * (Math.sin(t * 7) > 0 ? 1 : 0.2);
      if (t - (mo.alarmT || -9) > 1.7 && R.visible) { mo.alarmT = t; const f = mo.st.footprint; ping(mo.cx, 0.05, mo.cz, null, Math.max(f.w, f.d) * 0.42, 0xf87171); }
    }
    else if ((WF.STATE[st] || {}).group === 'wait') gi *= 0.72 + 0.28 * Math.sin(t * 2.2);
    const hov = R.hover && R.hover.kind === 'machine' && R.hover.id === mo.id, sel = R.selTarget && R.selTarget.kind === 'machine' && R.selTarget.id === mo.id;
    if (hov || sel) gi = Math.min(1.3, gi * 1.35);
    if (R.flash && R.flash.id === mo.id) { R.flash.t += dt; gi += Math.max(0, 1 - R.flash.t / 2.4) * 0.8 * (0.5 + 0.5 * Math.sin(t * 9)); if (R.flash.t > 2.4) R.flash = null; }
    mo.glow.mat.uniforms.uI.value = gi;
    const hl = hov ? 1 : sel ? 0.55 : 0;
    if (Math.abs(mo.hl - hl) > 0.004) { mo.hl = damp(mo.hl, hl, 10, dt); mo.mBatch.emissive.setRGB(0.05 * mo.hl, 0.09 * mo.hl, 0.13 * mo.hl); mo.mPaint.emissive.setRGB(0.05 * mo.hl, 0.09 * mo.hl, 0.13 * mo.hl); }
    if (mo.tower && st === 'fault') { const on = Math.sin(t * 7) > 0; const mm = mo.tower.mats[2]; mm.emissiveIntensity = on ? 2.8 : 0.15; mo.tower.halo.material.opacity = on ? 0.95 : 0.08; }
    if (mo.tablet) { const tb = mo.tablet; tb.flash = Math.max(0, tb.flash - dt * 1.5); tb.mat.color.setHex(0x5fb6e6).multiplyScalar(0.75 + tb.flash * 1.8); }
    const spin = cutting ? 1 : dressing ? 0.4 : 0;
    mo.spin = damp(mo.spin || 0, spin, 2.5, dt);
    const w = mo.spin;
    switch (mo.type) {
      case 'saw': {
        const yTop = a.y0 + (a.cutH || 0.12), yBot = a.top + 0.02;
        const tg = cutting ? yTop - (yTop - yBot) * mo.prog : yTop;
        a.bow.position.y = damp(a.bow.position.y, tg, 6, dt);
        if (w > 0.01) a.bladeMat.map.offset.x -= dt * 2.5 * w;
        break;
      }
      case 'lathe': {
        a.chuck.rotation.x += dt * 24 * w; a.sub.rotation.x -= dt * 24 * w * 0.6;
        if (a.loadT != null) { a.loadT += dt; if (a.loadT > 4.2) a.loadT = null; }
        const ph = a.loadT != null ? a.loadT / 4.2 : -1;
        let cx = a.carX.mach, dy = 0;
        if (ph >= 0) { const k = ph < 0.5 ? ph * 2 : (1 - ph) * 2; cx = a.carX.mach + (a.carX.store - a.carX.mach) * easeIO(clamp(k * 1.25, 0, 1)); dy = Math.max(0, Math.sin(ph * PI * 2)) ** 2 * 0.45; }
        a.car.position.x = damp(a.car.position.x, cx, 6, dt); a.arm.position.y = -dy; a.grip.visible = ph >= 0 && ph < 0.5;
        if (cutting) a.tur.rotation.z = Math.round(mo.prog * 5) * TAU / 12;
        break;
      }
      case 'swiss': a.sp.rotation.x += dt * 30 * w; break;
      case 'biglathe': {
        a.chuck.rotation.x += dt * 4 * w;
        if (a.x0 != null) { const pass = (mo.prog * 3) % 1, tri = pass < 0.85 ? pass / 0.85 : 1 - (pass - 0.85) / 0.15; const tx = cutting ? a.x0 + (a.x1 - a.x0) * tri : a.x1 - 0.3; a.sup.position.x = damp(a.sup.position.x, tx, 4, dt); }
        break;
      }
      case 'deephole': {
        a.chuck.rotation.x += dt * 9 * w;
        const ox = a.oilX != null ? a.oilX : -1.9, startX = 4.3, depth = Math.min(a.wl || 1.6, startX - ox - 1.4);
        const cx = st === 'running' ? startX - depth * mo.prog : startX;
        a.car.position.x = damp(a.car.position.x, cx, 4, dt);
        const bx0 = ox + 0.3, bx1 = a.car.position.x - 0.75, L = Math.max(0.1, bx1 - bx0);
        a.boring.scale.set(0.035, L, 0.035); a.boring.position.set((bx0 + bx1) / 2, a.ay, 0.1);
        a.supports.forEach((g, i) => { g.position.x = bx0 + L * (i + 1) / 4; });
        break;
      }
      case 'hobber': {
        a.hob.rotation.x += dt * 28 * w; a.table.rotation.y += dt * 1.3 * w;
        a.head.position.y = damp(a.head.position.y, a.fy + 0.85 + (cutting ? 0.22 - mo.prog * 0.3 : 0.28), 4, dt);
        break;
      }
      case 'mill5': {
        a.tool.rotation.y += dt * 40 * w;
        if (cutting) { a.spindle.position.x = a.sx + Math.sin(t * 0.9) * 0.16; a.spindle.position.y = a.sy + Math.sin(t * 1.7) * 0.05; a.table.rotation.y += dt * 0.25; }
        if (Math.abs(a.palRot - a.palTarget) > 0.001) { a.palRot = damp(a.palRot, a.palTarget, 2.2, dt); if (Math.abs(a.palRot - a.palTarget) < 0.002) a.palRot = a.palTarget; a.pal.rotation.y = a.palRot; R.shadowDirty = true; }
        break;
      }
      case 'mill3': {
        a.tool.rotation.y += dt * 40 * w;
        if (cutting) { a.table.position.x = a.tx + Math.sin(t * 0.8) * 0.4; a.table.position.z = a.tz + Math.sin(t * 1.3) * 0.08; a.spindle.position.y = a.sy + Math.sin(t * 2.1) * 0.03; }
        break;
      }
      case 'cylgrinder': a.wheel.rotation.x += dt * 45 * w; a.work.rotation.x += dt * 6 * (cutting ? 1 : 0); a.head.position.z = damp(a.head.position.z, a.hz + (cutting ? Math.sin(t * 2) * 0.012 + 0.03 : -0.05), 5, dt); break;
      case 'surfgrinder': a.wheel.rotation.z += dt * 45 * w; if (cutting) a.table.position.x = Math.sin(t * 1.4) * 0.45; a.head.position.y = damp(a.head.position.y, cutting ? 1.47 - mo.prog * 0.02 : 1.52, 4, dt); break;
      case 'washer': {
        a.basket.rotation.z += dt * 3 * w;
        const on = st === 'running' ? 0.55 + 0.25 * Math.sin(t * 5) : 0;
        a.lamp.material.opacity = damp(a.lamp.material.opacity, on, 4, dt);
        break;
      }
      case 'cmm': {
        if (st === 'running' && running) {
          a.bridge.position.z = a.tz + Math.sin(t * 0.55) * (a.d / 2 - 0.45);
          a.zcar.position.x = Math.sin(t * 0.83 + 1) * (a.w / 2 - 0.55);
          a.ram.position.y = -0.06 + (Math.sin(t * 1.9) * 0.5 + 0.5) * 0.2;
        }
        break;
      }
      default: break;
    }
  }
  function pulses(dt, t) {
    const P = R.pulse; if (!P) return;
    const pos = P.pos, size = P.size, alpha = P.alpha, colA = P.col;
    for (let i = P.list.length - 1; i >= 0; i--) {
      const q = P.list[i];
      q.d += q.speed * dt;
      const done = q.d >= q.path.len, qa = q.net ? q.a * (R.netK == null ? 1 : R.netK) : q.a;
      for (let k = 0; k < PULSE_PTS; k++) {
        const j = q.slot * PULSE_PTS + k, d = q.d - k * 0.5;
        pointAt(q.path, Math.min(d, q.path.len), V1);
        pos[j * 3] = V1.x; pos[j * 3 + 1] = V1.y; pos[j * 3 + 2] = V1.z;
        size[j] = q.size * (1 - k * 0.17); alpha[j] = d < 0 ? 0 : qa * (1 - k * 0.2);
        colA[j * 3] = q.col.r; colA[j * 3 + 1] = q.col.g; colA[j * 3 + 2] = q.col.b;
      }
      if (done) {
        for (let k = 0; k < PULSE_PTS; k++) alpha[q.slot * PULSE_PTS + k] = 0;
        if (q.onEnd) q.onEnd();
        P.free.push(q.slot); P.list.splice(i, 1);
      }
    }
    P.g.attributes.position.needsUpdate = true; P.g.attributes.aSize.needsUpdate = true; P.g.attributes.aAlpha.needsUpdate = true; P.g.attributes.aCol.needsUpdate = true;
    // Grundrauschen: angebundene, laufende Maschinen senden fortlaufend Signale (Level ≥ 2: Stückzähler, Spindeldaten)
    if (R.layers.data && !WF.app.paused) {
      R.hbAcc = (R.hbAcc || 0) + dt;
      if (R.hbAcc > 0.8) {
        R.hbAcc = 0;
        const S = WF.sim.state;
        const cand = R.moList.filter(mo => mo.path && S.machines[mo.id] && S.machines[mo.id].conn.level >= 2 && S.machines[mo.id].state === 'running');
        if (cand.length) spawnPulse(cand[Math.floor(Math.random() * cand.length)].path, { size: 0.34, speed: 20, alpha: 0.55, onEnd: () => { R.serverHit = Math.max(R.serverHit || 0, 0.4); } });
      }
    }
    R.serverHit = Math.max(0, (R.serverHit || 0) - dt * 2.5);
    if (R.serverLeds) R.serverLeds.forEach((m, i) => { const b = 0.5 + 0.5 * (Math.sin(t * (7 + i * 3.3) + i) > 0.2 ? 1 : 0) + R.serverHit * 2; m.color.setHex(i === 1 ? 0x3cc6f2 : 0x34d399).multiplyScalar(0.6 + b); });
    if (R.trayGlowMat) R.trayGlowMat.opacity = (0.38 + 0.12 * Math.sin(t * 1.6) + R.serverHit * 0.2) * (0.55 + 0.45 * (R.netK == null ? 1 : R.netK));
    for (const p of R.pings) {
      if (p.t >= 1) { if (p.m.visible) p.m.visible = false; continue; }
      p.t += dt / 1.1;
      if (p.follow) p.m.position.set(p.follow.x, 0.04, p.follow.z);
      const s = (0.6 + p.t * 2.2) * (p.s || 1); p.m.scale.set(s, 1, s); p.m.material.opacity = (1 - p.t) * 0.95;
    }
  }
  function applyViewOffset() {
    if ((R.viewOff || 0) > 0.5) R.camera.setViewOffset(R.w, R.h, R.viewOff, 0, R.w, R.h); else R.camera.clearViewOffset();
  }
  function adaptPerf(dt) {
    R.perfAcc += dt; R.perfN++;
    if (R.perfAcc < 2) return;
    const avg = R.perfAcc / R.perfN; R.perfAcc = 0; R.perfN = 0;
    if (avg > 0.034 && R.dpr > 1) { R.dpr = Math.max(1, R.dpr - 0.25); resize(true); }
    else if (avg < 0.0125 && R.dpr < R.dprMax) { R.perfHigh++; if (R.perfHigh > 3) { R.perfHigh = 0; R.dpr = Math.min(R.dprMax, R.dpr + 0.25); resize(true); } }
  }
  function resize(force) {
    if (!R.root || !R.renderer) return;
    const w = R.root.clientWidth, h = R.root.clientHeight;
    if (!w || !h) return;
    const changed = w !== R.w || h !== R.h;
    if (!force && !changed) return;
    R.w = w; R.h = h;
    R.renderer.setPixelRatio(R.dpr);
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h; R.camera.updateProjectionMatrix(); applyViewOffset();
    R.pulse.mat.uniforms.uScale.value = h * R.dpr / (2 * Math.tan(R.camera.fov * DEG / 2));
    if (!changed) return;
    const mob = w <= 640;
    if (mob !== R.mobile) { R.mobile = mob; if (R.ui.hint) R.ui.hint.innerHTML = hintHtml(); }
    const short = !mob && h < 640;
    if (short !== R.short) { R.short = short; R.root.classList.toggle('short', short); }
    syncDrawer();
    layoutModes();
    for (const id in R.lb) R.lb[id].sizes = {};
    // neue Größe: aktive Einpassung (Voreinstellung, Route, Station) sofort neu rechnen
    if (R.fit && !R.introPending && R.ok) applyFit(true);
  }

  // ================================================================== Aufbau / Lebenszyklus
  function fallback(root, msg) {
    R.failed = true;
    root.innerHTML = '';
    const box = el('div', { class: 'h3-fb' });
    box.innerHTML = `<div class="card"><div class="card-b" style="padding:24px 26px"><span class="ic">${icon('cube', 24)}</span><h3>3D-Ansicht nicht verfügbar</h3>
      <p>${esc(msg || 'Dieser Browser oder Rechner unterstützt kein WebGL (3D-Grafik). Alle Live-Daten der Halle – Maschinen, Aufträge, Personal und Transporte – stehen im Leitstand und in den Ressourcen-Ansichten zur Verfügung.')}</p>
      <div class="row"><button class="btn primary" data-go>${icon('grid', 15)}Zum Leitstand</button><span class="muted" style="font-size:12px">Tipp: Hardwarebeschleunigung im Browser aktivieren.</span></div></div></div>`;
    box.querySelector('[data-go]').onclick = () => WF.app.navigate('leitstand');
    root.append(box);
  }
  function webglOk() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } }

  function mount(rootEl) {
    const root = el('div', { class: 'h3-root' });
    rootEl.append(root); R.root = root;
    if (!THREE || !THREE.WebGLRenderer || !THREE.OrbitControls) { fallback(root, 'Die 3D-Bibliothek konnte nicht geladen werden. Alle Live-Daten der Halle stehen im Leitstand zur Verfügung.'); return; }
    if (!webglOk()) { fallback(root); return; }
    if (!WF.sim || !WF.sim.state || !WF.sim.state.machines) { fallback(root, 'Die Simulation ist nicht verfügbar.'); return; }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false }); }
    catch (e) { fallback(root); return; }
    THREE.ColorManagement.legacyMode = false;
    V1 = new THREE.Vector3(); V2 = new THREE.Vector3(); V3 = new THREE.Vector3(); V4 = new THREE.Vector3(); Q1 = new THREE.Quaternion(); M4 = new THREE.Matrix4(); E1 = new THREE.Euler(); S1 = new THREE.Vector3(); COL = new THREE.Color(); RAY = new THREE.Raycaster(); NDC = new THREE.Vector2(); PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    void Q1; void E1; void S1; void COL;
    R.renderer = renderer;
    R.dprMax = Math.min(2, window.devicePixelRatio || 1); R.dpr = R.dprMax;
    R.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x0b1120, 1);
    R.canvas = renderer.domElement; R.canvas.className = 'h3-cv'; R.canvas.setAttribute('aria-label', 'Hallenmodell 3D – ziehen zum Drehen, klicken für Details');
    R.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.ok = false; }, false);
    R.canvas.addEventListener('webglcontextrestored', () => { R.ok = true; R.shadowDirty = true; }, false);
    root.append(R.canvas, el('div', { class: 'h3-vig', 'aria-hidden': 'true' }));
    R.mobile = (root.clientWidth || window.innerWidth) <= 640;
    R.w = root.clientWidth || 1; R.h = root.clientHeight || 1;
    const t0 = performance.now();
    try {
      R.scene = new THREE.Scene();
      R.scene.background = new THREE.Color(0x0b1120);
      R.scene.fog = new THREE.Fog(0x0b1120, 120, 300);
      R.camera = new THREE.PerspectiveCamera(32, R.w / R.h, 0.5, 700);
      R.controls = new THREE.OrbitControls(R.camera, R.canvas);
      const c = R.controls;
      c.enableDamping = true; c.dampingFactor = 0.09; c.minDistance = 6; c.maxDistance = 150;
      c.minPolarAngle = 14 * DEG; c.maxPolarAngle = 76 * DEG; c.screenSpacePanning = false;
      c.rotateSpeed = 0.55; c.zoomSpeed = 0.9; c.panSpeed = 0.9;
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      makeMaterials();
      R.scene.environment = buildEnv();
      buildLights();
      buildHall();
      for (const id of WF.profile.machines) { const st = WF.profile.stationById[id]; if (st && st.footprint) buildMachine(st); }
      buildStores();
      buildPeople(); buildAgvs(); buildForklift();
      buildContainers(); buildFlow(); buildPulses(); buildHighlights();
      buildOverlays(root); buildLabels();
      bindPointer();
      layoutModes();
      // Materialien mit Umgebungsreflexion sammeln (nachts wird die Reflexion mit dem Licht gedimmt)
      R.envMats = []; const seenM = new Set();
      R.scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m && m.isMeshStandardMaterial && !seenM.has(m)) { seenM.add(m); m.userData.envBase = m.envMapIntensity; R.envMats.push(m); } });
      preset('uebersicht', true);
    } catch (e) {
      console.error('[halle] Aufbau fehlgeschlagen', e);
      try { renderer.dispose(); } catch (e2) { /* ignorieren */ }
      fallback(root, 'Beim Aufbau des 3D-Modells ist ein Fehler aufgetreten (' + e.message + '). Alle Live-Daten der Halle stehen im Leitstand zur Verfügung.');
      return;
    }
    R.buildMs = Math.round(performance.now() - t0);
    R.ok = true;
    new ResizeObserver(() => resize()).observe(root);
    WF.bus.on('sim:event', onSimEvent);
    WF.bus.on('sim:notify', onNotify);
    WF.bus.on('select', (s) => { if (R.ok) applySelection(s); });
    // Drawer öffnet/schließt → sofort nachziehen (nicht erst beim nächsten 4-Hz-Update)
    { const dr = document.getElementById('drawer'); if (dr && window.MutationObserver) new MutationObserver(() => { if (R.ok) syncDrawer(); }).observe(dr, { attributes: true, attributeFilter: ['class', 'style'] }); }
    WF.bus.on('sim:reset', onReset);
    WF.bus.on('settings', () => { if (R.ok) setTimeout(() => { resize(true); }, 60); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (R.ok && !R.fontsDone) { R.fontsDone = true; R.redrawMarks(); for (const id in R.lb) R.lb[id].sizes = {}; } });
    if (WF.app.selected) applySelection(WF.app.selected);
    setTimeout(hideHint, isTouch() ? 7000 : 15000);
  }
  function onReset() {
    if (!R.ok) return;
    R.lastT = -1; R.lastCounter = {}; R.rawSig = null;
    for (const id in R.agvs) R.agvs[id].init = false;
    if (R.fork) R.fork.init = false;
    for (const id in R.people) R.people[id].vis = false;
    for (const [, fl] of R.flowLines) for (const m of fl.meshes) dropMesh(m);
    R.flowLines.clear();
    for (const [, wl] of R.waitLines) dropMesh(wl.m);
    R.waitLines.clear();
    for (const key in R.wtLb) { const l = R.wtLb[key]; l.el.remove(); if (l.ln) { l.ln.remove(); l.dot.remove(); } delete R.wtLb[key]; }
    if (R.pulse) { for (const q of R.pulse.list) { R.pulse.free.push(q.slot); for (let k = 0; k < PULSE_PTS; k++) R.pulse.alpha[q.slot * PULSE_PTS + k] = 0; } R.pulse.list.length = 0; }
    for (const mo of R.moList) { mo.state = null; mo.prog = mo.p0 = mo.p1 = 0; if (mo.a) { mo.a.key = null; mo.a.sig = null; mo.a.n = null; } if (R.lb[mo.id]) R.lb[mo.id].sig = ''; }
    if (R.route.id) { const id = R.route.id; clearRoute(); buildRoute(id); }
    R.seenNotif = new Set(); R.netSig = null;
    R.shadowDirty = true;
  }
  function show() {
    R.visible = true;
    if (!R.ok) return;
    resize(true);
    if (!R.introDone) {
      R.introDone = true;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce && !R.pending && !WF.app.selected && R.preset === 'uebersicht') {
        const d = camState(); R.introDst = d; R.introN = 0; R.introPending = true;
        setCam({ tx: d.tx, ty: d.ty, tz: d.tz, r: d.r * 1.42, phi: Math.max(0.3, d.phi - 0.2), th: d.th + 0.5 }); R.controls.update();
      }
    }
    R.lastT = -1;
    if (R.pending) { const p = R.pending; R.pending = null; if (p.fn === 'station') focusStation(p.id); else focusOrder(p.id); }
    R.shadowDirty = true;
  }
  function hide() { R.visible = false; if (R.ok) { setHover(null); R.ui.tip.classList.remove('on'); R.follow = null; } }

  WF.registerView({ id: 'halle', title: 'Halle 3D', icon: 'cube', group: 'betrieb', order: 2, full: true, mount, show, hide, update, frame });
  WF.hall = {
    focusStation: (id) => focusStation(id),
    focusOrder: (id) => focusOrder(id),
    get ready() { return R.ok; },
    _debug: R,
  };
})();
