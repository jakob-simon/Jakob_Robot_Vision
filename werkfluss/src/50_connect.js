/* werkfluss – Ansicht „Anbindung“: Wie wird eine alte Fabrik digital?
   Übersicht: Anbindungsgrad (Stufen 0–3), Datenfluss Maschine → Gateway → werkfluss-Server (live),
   was jede Stufe freischaltet, Maschinenliste mit Live-Signalen.
   Assistent „Maschine anbinden“ (5 Schritte): Typenschild-Erkennung, KI-Empfehlung des Anbindungswegs,
   KI-Signalzuordnung, Live-Test (Zustandserkennung gegen den Maschinenzustand), Aktivierung über
   WF.sim.actions.connectMachine. Die Live-Vorschau höherer Stufen bildet die Signalberechnung der Engine
   exakt nach (gleiches 5-s-Raster, gleiche Formeln) – nach dem Aktivieren zeigt die Engine dieselben Werte. */
(function () {
  'use strict';
  const WF = window.WF;
  const { esc, icon, css } = WF.ui;
  const U = WF.util;

  // =================================================================== Stil
  css(`
  .cn-root{--cn-l0:var(--st-wait);--cn-l1:color-mix(in srgb,var(--st-setup) 20%,color-mix(in srgb,var(--text2) 60%,var(--muted)));--cn-l2:var(--info);--cn-l3:var(--st-run)}
  .cn-root .view-h{margin-bottom:14px}
  .cn-acts{display:flex;gap:8px;flex-wrap:wrap}
  .cn-lv{--c:var(--cn-l0);display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:20px;padding:0 6px;border-radius:5px;font:700 11px/1 var(--f-ui);letter-spacing:.04em;white-space:nowrap;font-variant-numeric:tabular-nums;
    color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 42%,transparent)}
  .cn-lv.lg{height:28px;min-width:40px;font-size:13.5px;border-radius:7px}
  .cn-sec{margin-top:14px}
  .cn-h2{font:600 19px/1.2 var(--f-cond);letter-spacing:.01em;margin:0}
  .cn-p{margin:4px 0 0;color:var(--muted);font-size:13px;max-width:70ch}
  .cn-ai{display:inline-flex;align-items:center;gap:5px;font:700 10.5px/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);white-space:nowrap}
  .cn-ai .ico{color:var(--accent)}
  .cn-live{display:inline-flex;align-items:center;gap:6px;font:600 10.5px/1 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--st-run)}
  .cn-live i{width:7px;height:7px;border-radius:50%;background:var(--st-run);box-shadow:0 0 0 0 color-mix(in srgb,var(--st-run) 60%,transparent);animation:cnPulse 1.6s ease-out infinite}
  @keyframes cnPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--st-run) 55%,transparent)}100%{box-shadow:0 0 0 7px transparent}}
  @keyframes cnIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @keyframes cnFade{from{opacity:0}to{opacity:1}}
  @keyframes cnSpin{to{transform:rotate(360deg)}}
  @keyframes cnShimmer{0%{background-position:-160px 0}100%{background-position:160px 0}}
  .cn-spin{display:inline-block;box-sizing:border-box;width:14px;height:14px;min-width:14px;max-width:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:cnSpin .8s linear infinite;flex:none}
  .cn-shim{display:block;height:10px;border-radius:4px;background:linear-gradient(90deg,var(--card2) 0,var(--raise) 50%,var(--card2) 100%);background-size:320px 100%;animation:cnShimmer 1.2s linear infinite}

  /* ---------- Kopf: Anbindungsgrad */
  .cn-hero{display:grid;grid-template-columns:minmax(0,1.55fr) repeat(3,minmax(0,1fr));overflow:hidden}
  .cn-hero>div{padding:14px 16px 13px;min-width:0}
  .cn-hero>div+div{border-left:1px solid var(--line)}
  .cn-big{display:flex;align-items:baseline;gap:9px;margin-top:5px;flex-wrap:wrap}
  .cn-big b{font:600 40px/1 var(--f-cond);font-variant-numeric:tabular-nums;letter-spacing:.01em}
  .cn-big span{color:var(--text2);font-size:14px}
  .cn-seg{display:flex;height:20px;border-radius:5px;overflow:hidden;margin-top:12px;gap:2px;background:var(--track)}
  .cn-seg i{display:flex;align-items:center;justify-content:center;height:100%;background:var(--c);min-width:18px;font:700 11px/1 var(--f-ui);font-style:normal;color:color-mix(in srgb,var(--c) 22%,black);font-variant-numeric:tabular-nums}
  .cn-leg{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:9px;font-size:12px;color:var(--muted)}
  .cn-leg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .cn-leg i{width:9px;height:9px;border-radius:3px;background:var(--c)}
  .cn-road{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
  .cn-road-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:11.5px}
  .cn-road-r{display:flex;align-items:center;gap:12px;width:100%;padding:6px 8px;margin:0 -8px;width:calc(100% + 16px);border:0;border-radius:8px;background:none;color:var(--text);text-align:left;cursor:pointer;font:inherit}
  .cn-road-r:hover{background:var(--card2)}
  .cn-road-r .lv{display:inline-flex;align-items:center;gap:4px;color:var(--faint);flex:none}
  .cn-road-r .t{flex:1;min-width:0;display:flex;flex-direction:column}
  .cn-road-r .t b{font-size:13px;font-weight:600}
  .cn-road-r .t span{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cn-road-r>.ico{color:var(--faint);flex:none}
  .cn-road-r:hover>.ico{color:var(--accent)}
  .cn-road-e{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text2)}.cn-road-e .ico{color:var(--st-run)}
  .cn-alarm{color:var(--st-fault)}
  @media (max-width:560px){.cn-hs{display:none}}
  .cn-stat .v{font:600 28px/1.1 var(--f-cond);margin-top:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .cn-stat .v small{font-size:14px;color:var(--muted);font-weight:500;margin-left:3px}
  .cn-stat .s{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.35}
  .cn-stat .s b{color:var(--text2);font-weight:600}
  .cn-stat .link{font-size:12px;margin-top:6px;display:inline-flex;align-items:center;gap:4px;text-decoration:none}
  @media (max-width:1180px){.cn-hero{grid-template-columns:repeat(3,minmax(0,1fr))}.cn-hero>div:first-child{grid-column:1/-1;border-bottom:1px solid var(--line)}.cn-hero>div:nth-child(2){border-left:0}}
  @media (max-width:640px){.cn-hero{grid-template-columns:repeat(2,minmax(0,1fr))}.cn-hero>div{padding:12px 12px 11px}.cn-hero>div:nth-child(4){grid-column:1/-1;border-left:0;border-top:1px solid var(--line)}
    .cn-stat .v{font-size:24px}.cn-stat .s{font-size:11.5px}.cn-big b{font-size:34px}}

  /* ---------- Datenfluss + Stufen */
  .cn-rowA{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px;margin-top:14px;align-items:stretch}
  @media (max-width:1320px){.cn-rowA{grid-template-columns:minmax(0,1fr)}}
  .cn-rowA>.card{display:flex;flex-direction:column}
  .cn-flow{position:relative;padding:12px 14px 10px;flex:1}
  .cn-flow svg{display:block;width:100%;max-width:1000px;margin:0 auto;overflow:visible}
  .cn-flow text{font-family:var(--f-ui);font-size:12px;fill:var(--text2)}
  .cn-flow .fx-chip{cursor:pointer}
  .cn-flow .fx-chip rect.bg{fill:var(--card2);stroke:var(--line)}
  .cn-flow .fx-chip:hover rect.bg,.cn-flow .fx-chip.hl rect.bg{stroke:var(--line2);fill:var(--raise)}
  .cn-flow .fx-n{fill:var(--text);font-weight:600}
  .cn-flow .fx-id{fill:var(--faint);font-family:var(--f-mono);font-size:10px}
  .cn-flow .fx-lvt{font-weight:700;font-size:10px;letter-spacing:.04em}
  .cn-flow .fx-p{fill:none;stroke:var(--info);stroke-opacity:.32;stroke-width:1.4;transition:stroke-opacity .2s}
  .cn-flow .fx-p.l0{stroke:var(--st-wait);stroke-opacity:.45;stroke-dasharray:3 5;animation:cnDash 3s linear infinite}
  .cn-flow .fx-p.hl{stroke-opacity:.95;stroke-width:2}
  .cn-flow .fx-p.up{stroke-opacity:.5;stroke-width:1.8}
  @keyframes cnDash{to{stroke-dashoffset:-32}}
  .cn-flow .fx-pk{fill:var(--info)}
  .cn-flow .fx-pkg{fill:var(--info);opacity:.22}
  .cn-flow .fx-box{fill:var(--panel);stroke:var(--line2)}
  .cn-flow .fx-box.tab{stroke:color-mix(in srgb,var(--st-wait) 40%,transparent);stroke-dasharray:4 3}
  .cn-flow .fx-bt{fill:var(--text);font-weight:600;font-size:12.5px}
  .cn-flow .fx-bs{fill:var(--muted);font-size:11px}
  .cn-flow .fx-bs.ok{fill:var(--st-run)}
  .cn-flow .fx-bs.wa{fill:var(--st-wait)}
  .cn-flow .fx-hb{fill:var(--st-run)}
  .cn-flow .fx-hbr{fill:none;stroke:var(--st-run);opacity:0;transform-box:fill-box;transform-origin:center;animation:cnRing 2s ease-out infinite}
  @keyframes cnRing{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(2.6)}}
  .cn-flow .fx-srv{fill:color-mix(in srgb,var(--accent) 7%,var(--panel));stroke:color-mix(in srgb,var(--accent) 45%,transparent)}
  .cn-flow .fx-st{fill:var(--text);font-weight:600;font-size:14px}
  .cn-flow .fx-sv{fill:var(--text);font-family:var(--f-cond);font-weight:600;font-size:26px}
  .cn-flow .fx-out{fill:var(--card2);stroke:var(--line)}
  .cn-flow .fx-outt{fill:var(--text2);font-size:11.5px}
  .cn-flow .fx-sep{stroke:var(--line);stroke-width:1}
  .cn-flow-f{display:flex;gap:6px 16px;flex-wrap:wrap;padding:9px 14px 11px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted)}
  .cn-flow-f span{display:inline-flex;align-items:center;gap:6px}
  .cn-flow-f i.ln{width:18px;height:0;border-top:2px solid var(--info);opacity:.7}
  .cn-flow-f i.ln.d{border-top:2px dashed var(--st-wait)}
  .cn-flow-f i.pk{width:6px;height:6px;border-radius:50%;background:var(--info);box-shadow:0 0 6px var(--info)}
  /* schmale Variante */
  .cn-fm{display:flex;flex-direction:column;gap:10px}
  .cn-fm-g{border:1px solid var(--line);border-radius:9px;background:var(--bg2);overflow:hidden}
  .cn-fm-g.tab{border-style:dashed;border-color:color-mix(in srgb,var(--st-wait) 40%,transparent)}
  .cn-fm-h{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .cn-fm-h b{font-size:13px}
  .cn-fm-h .m{font-size:11.5px;color:var(--muted);margin-left:auto;font-variant-numeric:tabular-nums}
  .cn-fm-c{display:flex;flex-wrap:wrap;gap:6px;padding:9px 11px}
  .cn-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 6px 4px 8px;border-radius:7px;border:1px solid var(--line);background:var(--card2);font-size:12px;cursor:pointer;color:var(--text)}
  .cn-chip:hover{border-color:var(--line2)}
  .cn-chip .mono{color:var(--faint);font-size:10.5px}
  .cn-dot{--c:var(--st-idle);width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 16%,transparent)}
  .cn-fm-srv{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:9px;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 7%,var(--bg2));font-size:12.5px}
  .cn-fm-srv .ic{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);flex:none}
  .cn-fm-srv .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .cn-fm-srv .t{font-weight:600;font-size:13px}
  .cn-fm-srv .s{font-size:11.5px;color:var(--muted)}
  .cn-fm-srv .nv{display:flex;flex-direction:column;align-items:flex-end;flex:none}
  .cn-fm-srv .nv b{font:600 22px/1 var(--f-cond);font-variant-numeric:tabular-nums}
  .cn-fm-srv .nv span{font-size:10.5px;color:var(--muted);margin-top:2px}

  .cn-mx{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
  .cn-mx th{padding:0 4px 9px;vertical-align:bottom;text-align:center;font-weight:400}
  .cn-mx th.l{text-align:left;padding-left:0}
  .cn-mx th .t{display:block;font:600 10.5px/1.25 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:5px;white-space:nowrap}
  .cn-mx td{padding:5px 4px;border-top:1px solid var(--line);text-align:center;vertical-align:middle}
  .cn-mx td.l{text-align:left;color:var(--text2);padding-left:0;white-space:nowrap}
  .cn-mx tr.f td{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .cn-mx tr.f td b{color:var(--text);font:600 15px/1 var(--f-cond)}
  .cn-ck{--c:var(--st-run);display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)}
  .cn-ck .ico{stroke-width:2.6}
  .cn-mn{display:inline-block;font-size:10.5px;color:var(--muted);border:1px dashed var(--line2);border-radius:5px;padding:1px 5px;white-space:nowrap}
  .cn-no{color:var(--faint)}
  @media (max-width:560px){.cn-mx{font-size:11.5px}.cn-mx td.l{white-space:normal}.cn-mx th .t{font-size:9.5px;letter-spacing:.03em}.cn-mn{font-size:9.5px;padding:1px 3px}}

  /* ---------- Maschinenliste */
  .cn-list{container-type:inline-size;min-width:0}
  .cn-lh,.cn-lr{display:grid;grid-template-columns:minmax(168px,1.45fr) 58px minmax(116px,1.05fr) minmax(140px,1.25fr) 46px minmax(190px,2fr) 112px 128px;gap:12px;align-items:center;padding:0 14px}
  .cn-lh{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}
  .cn-lh span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cn-lr{padding-top:9px;padding-bottom:9px;border-bottom:1px solid var(--line);cursor:pointer;min-height:56px}
  .cn-lr:last-child{border-bottom:0}
  .cn-lr:hover{background:color-mix(in srgb,var(--raise) 32%,transparent)}
  .cn-lr.fresh{animation:cnFresh 2.4s ease}
  @keyframes cnFresh{0%,30%{background:color-mix(in srgb,var(--st-run) 14%,transparent)}100%{background:transparent}}
  .cn-mc{display:flex;align-items:center;gap:10px;min-width:0}
  .cn-mc>div{min-width:0}
  .cn-mc b{font-weight:600;font-size:13.5px}
  .cn-mc .mono{color:var(--faint);font-size:10.5px;margin-left:5px}
  .cn-sub{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cn-cell{min-width:0;font-size:12.5px;color:var(--text2)}
  .cn-cell .t1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cn-cell .t2{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .cn-new{display:inline-block;font:700 9.5px/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--st-run);border:1px solid color-mix(in srgb,var(--st-run) 40%,transparent);border-radius:4px;padding:2px 4px;margin-left:6px;vertical-align:1px}
  .cn-livec{display:flex;align-items:center;gap:9px;min-width:0}
  .cn-livec>div{min-width:0}
  .cn-sl{display:inline-flex;flex-direction:column;gap:2px;padding:2px;border-radius:3px;background:var(--bg2);border:1px solid var(--line2);flex:none}
  .cn-sl i{width:7px;height:4px;border-radius:1px;background:var(--track)}
  .cn-sl[data-l=red] i:nth-child(1){background:var(--st-fault);box-shadow:0 0 5px var(--st-fault)}
  .cn-sl[data-l=yellow] i:nth-child(2){background:var(--st-wait);box-shadow:0 0 5px var(--st-wait)}
  .cn-sl[data-l=green] i:nth-child(3){background:var(--st-run);box-shadow:0 0 5px var(--st-run)}
  .cn-tab{display:inline-grid;place-items:center;width:13px;height:16px;border-radius:3px;border:1.5px solid var(--cn-l0);flex:none;opacity:.8}
  .cn-tab::after{content:"";width:3px;height:1.5px;border-radius:1px;background:var(--cn-l0);margin-top:9px}
  .cn-ago{font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap;display:flex;align-items:center;gap:6px}
  .cn-ago i{width:6px;height:6px;border-radius:50%;background:var(--st-run);flex:none;opacity:.35;transition:opacity .2s}
  .cn-ago i.on{opacity:1;box-shadow:0 0 6px var(--st-run)}
  .cn-ago.old{color:var(--st-wait)}.cn-ago.old i{background:var(--st-wait);opacity:.8}
  .cn-opt-ok{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.25;color:var(--muted)}
  .cn-opt-ok .ico{color:var(--st-run);flex:none}
  .cn-lr .btn{width:100%}
  .cn-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cn-c-d,.m-ago{display:none}
  /* Karte < 1080 px: ohne Steuerungsspalte */
  @container (max-width:1079px){.cn-lh,.cn-lr{grid-template-columns:minmax(150px,1.4fr) 58px minmax(130px,1.3fr) 44px minmax(170px,2fr) 104px 118px}.cn-c-ctrl{display:none}}
  /* < 890 px: Baujahr und „Letzte Meldung“ wandern in die Zeile (Alter rechts in den Live-Daten) */
  @container (max-width:889px){.cn-lh,.cn-lr{grid-template-columns:minmax(150px,1.3fr) minmax(130px,1.2fr) 44px minmax(170px,2fr) 118px}.cn-c-year,.cn-c-ago{display:none}
    .cn-c-live .m-ago{display:inline-flex;margin-left:auto}}
  /* < 700 px: gestapelte Zeilen */
  @container (max-width:699px){
    .cn-lh{display:none}
    .cn-lr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"m lv" "d d" "p act" "live live";gap:8px 12px;padding:12px 14px}
    .cn-c-m{grid-area:m}.cn-c-lv{grid-area:lv;justify-self:end}.cn-c-year{display:none}.cn-c-ctrl{display:none}
    .cn-c-proto{grid-area:p;align-self:center}.cn-c-live{grid-area:live}.cn-c-ago{display:none}.cn-c-act{grid-area:act;justify-self:end;align-self:center}
    .cn-c-d{display:block;grid-area:d;margin-top:-4px}
    .cn-lr .btn{width:auto}
    .cn-c-live .cn-livec{background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
    .cn-c-live .m-ago{display:inline-flex;margin-left:auto}
  }

  /* ---------- Neue Maschine */
  .cn-newc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr);gap:18px;padding:16px;align-items:center}
  .cn-newc h3{margin:6px 0 4px;font:600 21px/1.15 var(--f-cond)}
  .cn-newc p{margin:0 0 12px;color:var(--text2);font-size:13px}
  .cn-proc{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;counter-reset:s;list-style:none;margin:0;padding:0}
  .cn-proc li{position:relative;padding:0 10px 0 0}
  .cn-proc li .ic{position:relative;z-index:1;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--card2);border:1px solid var(--line2);color:var(--accent)}
  .cn-proc li:not(:last-child)::after{content:"";position:absolute;left:46px;right:8px;top:19px;height:0;border-top:1px dashed var(--line2)}
  .cn-proc li b{display:block;font-size:13px;margin-top:9px}
  .cn-proc li span{display:block;font-size:11.8px;color:var(--muted);margin-top:2px;line-height:1.35}
  .cn-proc li em{font-style:normal;font:600 10px/1 var(--f-ui);letter-spacing:.1em;color:var(--faint);display:block;margin-top:9px}
  @media (max-width:1100px){.cn-newc{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:700px){.cn-proc{grid-template-columns:minmax(0,1fr);gap:12px}.cn-proc li{display:grid;grid-template-columns:38px minmax(0,1fr);column-gap:12px;padding:0}.cn-proc li .ic{grid-row:span 3}.cn-proc li b,.cn-proc li em{margin-top:0}.cn-proc li:not(:last-child)::after{display:none}}

  /* =================================================================== Assistent */
  .cn-wz{display:flex;flex-direction:column;gap:14px;animation:cnFade .25s ease}
  .cn-wz-top{display:flex;align-items:flex-end;gap:12px 18px;flex-wrap:wrap}
  .cn-crumb{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);margin-bottom:5px}
  .cn-crumb button{background:none;border:0;padding:0;color:var(--muted);cursor:pointer;font:inherit}
  .cn-crumb button:hover{color:var(--text)}
  .cn-crumb .ico{opacity:.6}
  .cn-wz-top .view-t{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cn-stepper{display:flex;align-items:center;padding:12px 16px;gap:0}
  .cn-st{display:flex;align-items:center;gap:10px;min-width:0;flex:none;background:none;border:0;padding:2px 0;color:inherit;text-align:left;font:inherit;cursor:default}
  .cn-st.can{cursor:pointer}
  .cn-st .n{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;flex:none;font:600 13px/1 var(--f-ui);border:1.5px solid var(--line2);color:var(--muted);background:var(--bg2);transition:all .25s}
  .cn-st .tx{min-width:0}
  .cn-st .tt{display:block;font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap}
  .cn-st .ts{display:block;font-size:11.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
  .cn-st.on .n{border-color:var(--accent);color:var(--accent-ink);background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
  .cn-st.on .tt{color:var(--text)}
  .cn-st.on .ts{color:var(--muted)}
  .cn-st.done .n{border-color:color-mix(in srgb,var(--accent) 60%,transparent);color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg2))}
  .cn-st.done .tt{color:var(--text2)}
  .cn-st.done .ts{color:var(--muted)}
  .cn-st.can:hover .tt{color:var(--text)}
  .cn-stl{flex:1;height:2px;min-width:18px;margin:0 14px;border-radius:2px;background:var(--line);position:relative;overflow:hidden}
  .cn-stl i{position:absolute;inset:0;background:var(--accent);transform-origin:left;transform:scaleX(0);transition:transform .4s ease}
  .cn-stl.done i{transform:scaleX(1)}
  .cn-st-m{display:none}
  @media (max-width:1100px){.cn-st .ts{display:none}}
  @media (max-width:760px){
    .cn-stepper{flex-wrap:wrap;row-gap:10px;padding:11px 12px}
    .cn-st .tx{display:none}.cn-stl{margin:0 6px;min-width:8px}
    .cn-st-m{display:flex;align-items:baseline;justify-content:space-between;gap:10px;width:100%;font-size:12.5px;color:var(--muted)}
    .cn-st-m b{color:var(--text);font-size:14px}
  }
  .cn-wz-body{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
  @media (max-width:1280px){.cn-wz-body{grid-template-columns:minmax(0,1fr)}
    .cn-aside .card-b{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr);gap:14px;align-items:start}
    .cn-aside .cn-aside-n{grid-column:1/-1}}
  @media (max-width:760px){.cn-aside .card-b{display:flex}}
  .cn-wz-main{display:flex;flex-direction:column;min-height:420px}
  .cn-wz-c{padding:18px 20px 20px;flex:1}
  .cn-wz-f{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--panel) 60%,var(--card));border-radius:0 0 var(--r) var(--r);position:sticky;bottom:-28px;z-index:2}
  .cn-wz-f .hint{font-size:12px;color:var(--muted);min-width:0;flex:1}
  .cn-wz-f .hint.warn{color:var(--st-wait)}
  @media (max-width:640px){.cn-wz-c{padding:14px 14px 16px}.cn-wz-f{flex-wrap:wrap;padding:10px 12px;gap:8px 10px}.cn-wz-f .hint{order:-1;flex:1 1 100%;font-size:11.5px;line-height:1.35}.cn-wz-f .btn.primary{margin-left:auto}}

  .cn-aside .card-b{display:flex;flex-direction:column;gap:12px}
  .cn-asm{display:flex;align-items:center;gap:11px}
  .cn-asm .ic{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--card2);border:1px solid var(--line2);color:var(--text2);flex:none}
  .cn-asm b{display:block;font-size:14px}
  .cn-asm span{display:block;font-size:12px;color:var(--muted)}
  .cn-lvch{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;background:var(--bg2);border:1px solid var(--line)}
  .cn-lvch .a{display:flex;flex-direction:column;gap:4px;min-width:0}
  .cn-lvch .a{flex:1}
  .cn-lvch .a span{font-size:11px;color:var(--muted);line-height:1.3}
  .cn-lvch .ar{color:var(--faint);flex:none}
  .cn-aside .dl{font-size:12.5px;gap:7px 12px}
  .cn-aside .dl dd{color:var(--text2)}
  .cn-ok{color:var(--st-run)}.cn-bad{color:var(--st-fault)}.cn-wa{color:var(--st-wait)}
  .cn-aside-n{font-size:11.5px;color:var(--muted);line-height:1.45;padding-top:10px;border-top:1px solid var(--line)}

  /* Schritt 1 */
  .cn-s0{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);grid-template-areas:"a b" "c b";grid-template-rows:auto 1fr;column-gap:22px;align-items:start}
  .cn-s0>.a{grid-area:a}.cn-s0>.b{grid-area:b}.cn-s0>.c{grid-area:c}
  @media (max-width:960px){.cn-s0{grid-template-columns:minmax(0,1fr);grid-template-areas:"a" "b" "c";grid-template-rows:auto}.cn-s0>.b{margin-top:16px}}
  .cn-s0 .field{margin-top:14px}
  .cn-note{display:flex;gap:9px;align-items:flex-start;margin-top:12px;padding:10px 12px;border-radius:9px;font-size:12.8px;color:var(--text2);background:color-mix(in srgb,var(--c,var(--info)) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c,var(--info)) 28%,transparent)}
  .cn-note .ico{color:var(--c,var(--info));flex:none;margin-top:1px}
  .cn-note b{color:var(--text)}
  .cn-photo{position:relative}
  .cn-photo-in{position:relative;border-radius:12px;overflow:hidden;transform:perspective(1100px) rotateX(3deg) rotate(-1deg);box-shadow:0 14px 40px rgba(0,0,0,.45);background:var(--bg2);aspect-ratio:600/360}
  .cn-photo canvas{display:block;width:100%;height:100%}
  .cn-ov{position:absolute;inset:0;pointer-events:none}
  .cn-corner{position:absolute;width:26px;height:26px;border:2px solid color-mix(in srgb,var(--accent) 85%,white);opacity:.85}
  .cn-corner.tl{left:10px;top:10px;border-right:0;border-bottom:0;border-radius:6px 0 0 0}
  .cn-corner.tr{right:10px;top:10px;border-left:0;border-bottom:0;border-radius:0 6px 0 0}
  .cn-corner.bl{left:10px;bottom:10px;border-right:0;border-top:0;border-radius:0 0 0 6px}
  .cn-corner.br{right:10px;bottom:10px;border-left:0;border-top:0;border-radius:0 0 6px 0}
  .cn-scan{position:absolute;left:0;right:0;top:0;height:22%;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--accent) 22%,transparent) 85%,color-mix(in srgb,var(--accent) 90%,white) 100%);border-bottom:2px solid var(--accent);box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 50%,transparent);animation:cnScan 1.15s ease-in-out 2 alternate both;opacity:.9}
  @keyframes cnScan{from{transform:translateY(-100%)}to{transform:translateY(455%)}}
  .cn-photo.scan .cn-photo-in::after{content:"";position:absolute;inset:0;background:color-mix(in srgb,var(--accent) 6%,transparent);pointer-events:none}
  .cn-box{position:absolute;border:1.5px solid var(--accent);border-radius:4px;background:color-mix(in srgb,var(--accent) 12%,transparent);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 0 14px color-mix(in srgb,var(--accent) 45%,transparent)}
  .cn-photo.scan .cn-box{animation:cnBox .35s ease both}
  @keyframes cnBox{from{opacity:0;transform:scale(1.25)}to{opacity:1;transform:none}}
  .cn-box span{position:absolute;left:-1.5px;bottom:100%;margin-bottom:3px;white-space:nowrap;font:700 10px/1 var(--f-ui);letter-spacing:.03em;padding:3px 5px;border-radius:3px;background:var(--accent);color:var(--accent-ink)}
  .cn-box.in span{left:auto;right:3px;bottom:auto;top:50%;margin:0;transform:translateY(-50%);font-size:9px;padding:2px 4px}
  @media (max-width:560px){.cn-box span{font-size:8.5px;padding:2px 4px}}
  .cn-photo-cta{position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;background:radial-gradient(closest-side,rgba(4,8,16,.55),rgba(4,8,16,.15))}
  .cn-photo-cta .btn{box-shadow:var(--shadow)}
  .cn-photo-cap{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:11.5px;color:var(--muted);flex-wrap:wrap}
  .cn-photo-cap .spacer{flex:1}
  .cn-badge-ok{position:absolute;right:12px;top:12px;display:inline-flex;align-items:center;gap:5px;padding:4px 8px 4px 6px;border-radius:999px;background:var(--st-run);color:#06231a;font:700 11px/1 var(--f-ui);box-shadow:var(--shadow);animation:cnIn .3s ease both}
  .cn-cmpt{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg2)}
  .cn-cr{display:grid;grid-template-columns:96px minmax(0,1fr) minmax(0,1.1fr);gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12.8px;min-height:36px}
  .cn-cr.two{grid-template-columns:96px minmax(0,1fr)}
  .cn-cr.span{grid-template-columns:96px minmax(0,1fr)}
  .cn-cr:last-child{border-bottom:0}
  .cn-cr.h{font:600 10px/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);background:var(--card);min-height:0;padding-top:8px;padding-bottom:8px}
  .cn-cr .k{color:var(--muted);font-size:12px}
  .cn-cr .s{color:var(--text);min-width:0;overflow-wrap:anywhere}
  .cn-cr .x{color:var(--text2);min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:2px}
  .cn-cr .o{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
  .cn-cr .o .v{font-weight:600;color:var(--text);min-width:0;overflow-wrap:anywhere;font-family:var(--f-mono);font-size:12px}
  .cn-cr .o .n{flex-basis:100%;font-size:11px;color:var(--muted);margin-top:-4px}
  .cn-cr .o .cf{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .cn-cr .o .cf .cn-ok{display:inline-flex}
  .cn-cr.in .o{animation:cnIn .3s ease both}
  .cn-cr.in:nth-child(3) .o{animation-delay:.05s}.cn-cr.in:nth-child(4) .o{animation-delay:.1s}.cn-cr.in:nth-child(5) .o{animation-delay:.15s}.cn-cr.in:nth-child(6) .o{animation-delay:.2s}.cn-cr.in:nth-child(7) .o{animation-delay:.25s}
  @media (max-width:560px){.cn-cr{grid-template-columns:78px minmax(0,1fr) minmax(0,1fr);gap:8px;padding:8px 10px}.cn-cr.two,.cn-cr.span{grid-template-columns:78px minmax(0,1fr)}.cn-cr .o .cf{margin-left:0}}
  .cn-demo{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}
  .cn-demo button{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;padding:10px 11px;border-radius:9px;border:1px solid var(--line2);background:var(--bg2);cursor:pointer;color:var(--text);font:inherit;min-width:0}
  .cn-demo button:hover{border-color:var(--muted)}
  .cn-demo button.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--bg2));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
  .cn-demo b{font-size:13px}
  .cn-demo span{font-size:11.5px;color:var(--muted)}
  @media (max-width:560px){.cn-demo{grid-template-columns:minmax(0,1fr)}}

  /* Schritt 2 */
  .cn-reco{border-radius:12px;border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 9%,var(--card)),var(--card) 70%);padding:16px 18px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 6%,transparent)}
  .cn-reco-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cn-reco-t{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
  .cn-reco-t b{font:600 24px/1.1 var(--f-cond)}
  .cn-reco-s{color:var(--text2);font-size:13.5px;margin-top:3px}
  .cn-facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .cn-fact{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;background:var(--bg2);border:1px solid var(--line);font-size:12px;color:var(--text2)}
  .cn-fact .ico{color:var(--muted)}
  .cn-reco-g{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px;margin-top:14px}
  @media (max-width:900px){.cn-reco-g{grid-template-columns:minmax(0,1fr)}}
  .cn-why{margin:7px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
  .cn-why li{position:relative;padding-left:17px;font-size:13px;color:var(--text2);line-height:1.45}
  .cn-why li::before{content:"";position:absolute;left:2px;top:7px;width:6px;height:6px;border-radius:2px;background:var(--accent);opacity:.8}
  .cn-gain{display:flex;flex-direction:column;gap:6px;margin-top:7px}
  .cn-gain div{display:flex;align-items:center;gap:8px;font-size:12.8px;color:var(--text2)}
  .cn-gain .ico{flex:none}
  .cn-gain .y .ico{color:var(--st-run)}
  .cn-gain .n{color:var(--muted)}.cn-gain .n .ico{color:var(--faint)}
  .cn-opts-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:20px 0 9px}
  .cn-opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  @media (max-width:900px){.cn-opts{grid-template-columns:minmax(0,1fr)}}
  .cn-opt{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;padding:12px 13px;border-radius:10px;border:1px solid var(--line2);background:var(--bg2);cursor:pointer;transition:border-color .15s,background .15s;outline:none}
  .cn-opt:hover{border-color:var(--muted)}
  .cn-opt:focus-visible{box-shadow:0 0 0 2px var(--accent)}
  .cn-opt.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--bg2))}
  .cn-opt.dis{cursor:default;opacity:.62;border-style:dashed}
  .cn-opt.dis:hover{border-color:var(--line2)}
  .cn-opt.cur{cursor:default;border-style:dashed}
  .cn-opt.cur:hover{border-color:var(--line2)}
  .cn-radio{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--line2);margin-top:2px;display:grid;place-items:center}
  .cn-opt.on .cn-radio{border-color:var(--accent)}
  .cn-opt.on .cn-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}
  .cn-opt.dis .cn-radio{border-style:dashed}
  .cn-opt-h{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .cn-opt-h b{font-size:13.5px}
  .cn-opt-h .e{margin-left:auto;font-size:11.5px;color:var(--muted);white-space:nowrap}
  .cn-opt-s{font-size:12px;color:var(--muted);margin-top:3px}
  .cn-pc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 14px;margin-top:9px}
  .cn-pc ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
  .cn-pc li{font-size:12px;color:var(--text2);padding-left:14px;position:relative;line-height:1.4}
  .cn-pc .pro li::before{content:"+";position:absolute;left:0;color:var(--st-run);font-weight:700}
  .cn-pc .con li::before{content:"–";position:absolute;left:0;color:var(--st-wait);font-weight:700}
  @media (max-width:560px){.cn-pc{grid-template-columns:minmax(0,1fr)}}
  .cn-opt-x{font-size:12px;color:var(--text2);margin-top:7px;line-height:1.45}
  .cn-opt-x b{color:var(--muted);font-weight:600}
  .cn-tag{display:inline-flex;align-items:center;gap:4px;font:700 9.5px/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;border-radius:4px;white-space:nowrap}
  .cn-tag.rec{color:var(--accent-ink);background:var(--accent)}
  .cn-tag.cur{color:var(--muted);border:1px solid var(--line2)}
  .cn-tag.no{color:var(--faint);border:1px dashed var(--line2)}
  .cn-tag.new{color:var(--st-run);border:1px solid color-mix(in srgb,var(--st-run) 40%,transparent)}
  .cn-tag.act{color:var(--muted);border:1px solid var(--line2)}
  .cn-tag.chk{color:var(--st-wait);border:1px solid color-mix(in srgb,var(--st-wait) 45%,transparent)}
  .cn-inst{margin-top:18px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg2)}
  .cn-inst ol{margin:9px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;counter-reset:i}
  .cn-inst li{counter-increment:i;font-size:12.3px;color:var(--text2);line-height:1.4;position:relative;padding-top:28px}
  .cn-inst li::before{content:counter(i);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:600 11px/1 var(--f-ui);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
  @media (max-width:900px){.cn-inst ol{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:520px){.cn-inst ol{grid-template-columns:minmax(0,1fr)}.cn-inst li{padding:2px 0 0 32px;min-height:22px}}

  /* Schritt 3 */
  .cn-s2-h{display:flex;align-items:flex-start;justify-content:space-between;gap:12px 18px;flex-wrap:wrap}
  .cn-aist{display:flex;align-items:center;gap:9px;margin-top:12px;padding:9px 12px;border-radius:9px;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 8%,var(--bg2));font-size:12.5px;color:var(--text2)}
  .cn-aist.ok{border-color:color-mix(in srgb,var(--st-run) 40%,transparent);background:color-mix(in srgb,var(--st-run) 7%,var(--bg2))}
  .cn-aist.ok .ico{color:var(--st-run)}
  .cn-aist b{color:var(--text)}
  .cn-map{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .cn-mh,.cn-mr{display:grid;grid-template-columns:minmax(170px,1.45fr) minmax(88px,.7fr) 16px minmax(170px,1.15fr) 122px;gap:12px;align-items:center;padding:0 14px}
  .cn-mh{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:9px;padding-bottom:9px;background:var(--bg2);border-bottom:1px solid var(--line)}
  .cn-mr{padding-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .cn-mr:last-child{border-bottom:0}
  .cn-msep{display:flex;align-items:center;gap:7px;padding:8px 14px;font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--bg2);border-bottom:1px solid var(--line)}
  .cn-msep .ico{color:var(--st-run)}
  .cn-mr.ex .raw .mono,.cn-mr.ex .val{opacity:.8}
  .cn-mr.anim{animation:cnIn .35s ease both}
  .cn-mr.warn{background:color-mix(in srgb,var(--st-wait) 6%,transparent)}
  .cn-mr .raw{min-width:0}
  .cn-mr .raw .mono{display:block;color:var(--text);font-size:11.8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cn-mr .raw .nt{display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .cn-mr .val{font-family:var(--f-mono);font-size:11.8px;color:var(--info);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .cn-mr .val i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:0;background:var(--c,var(--faint))}
  .cn-mr .arr{color:var(--faint)}
  .cn-mr .sem{position:relative;min-width:0}
  .cn-mr select.input{padding:5px 8px;font-size:12.5px;height:31px}
  .cn-mr .ph{position:absolute;inset:0;display:flex;align-items:center;gap:8px;padding:0 9px;border-radius:8px;border:1px dashed color-mix(in srgb,var(--accent) 45%,transparent);background:var(--bg2);font-size:12px;color:var(--accent);animation:cnFade .2s ease reverse both}
  .cn-mr.anim .ph{animation:cnFade .25s ease reverse both;animation-delay:inherit}
  .cn-mr .conf{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
  .cn-mr .conf .bar{width:34px;min-width:34px}
  .cn-mr .conf .cn-tag{padding:2px 5px;font-size:9px}
  .cn-mr.anim .sem select,.cn-mr.anim .conf{animation:cnFade .3s ease both}
  @media (max-width:820px){
    .cn-mh{display:none}
    .cn-mr{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"raw val" "sem sem" "conf conf";gap:7px 10px;padding:10px 12px}
    .cn-mr .raw{grid-area:raw}.cn-mr .val{grid-area:val;justify-self:end}.cn-mr .arr{display:none}.cn-mr .sem{grid-area:sem}.cn-mr .conf{grid-area:conf}
  }
  .cn-val{display:flex;flex-direction:column;gap:6px;margin-top:12px}
  .cn-val div{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text2)}
  .cn-val .e .ico{color:var(--st-fault)}.cn-val .w .ico{color:var(--st-wait)}.cn-val .o .ico{color:var(--st-run)}
  .cn-val .ico{flex:none;margin-top:1px}

  /* Schritt 4 */
  .cn-s3-g{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.4fr);gap:14px;margin-top:14px;align-items:start}
  @media (max-width:900px){.cn-s3-g{grid-template-columns:minmax(0,1fr)}}
  .cn-det{border:1px solid var(--line);border-radius:12px;background:var(--bg2);padding:14px 16px;display:flex;gap:16px;align-items:center}
  .cn-tower{display:flex;flex-direction:column;align-items:center;flex:none}
  .cn-tower i{display:block;width:30px;height:20px;border-radius:4px 4px 2px 2px;margin-bottom:3px;background:color-mix(in srgb,var(--c) 14%,var(--track));border:1px solid color-mix(in srgb,var(--c) 25%,transparent);transition:all .3s}
  .cn-tower i.on{background:var(--c);box-shadow:0 0 14px var(--c),0 0 30px color-mix(in srgb,var(--c) 50%,transparent);border-color:var(--c)}
  .cn-tower em{display:block;width:8px;height:22px;background:var(--line2);border-radius:0 0 2px 2px}
  .cn-tower span{display:block;width:34px;height:6px;border-radius:3px;background:var(--line2)}
  .cn-tower.cur i{opacity:.35}
  .cn-det-b{min-width:0;flex:1;display:flex;flex-direction:column;gap:10px}
  .cn-det-r{display:flex;flex-direction:column;gap:4px}
  .cn-det-r .k{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .cn-det-r .w{font-size:12px;color:var(--muted)}
  .cn-det-m{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:8px;font-size:12.8px;font-weight:600}
  .cn-det-m>span:not(.cn-spin){flex:1;min-width:0}
  .cn-det-m .ico{flex:none}
  .cn-det-m .btn{flex-basis:100%;margin-top:2px}
  .cn-det-m.ok{color:var(--st-run);background:color-mix(in srgb,var(--st-run) 10%,transparent);border:1px solid color-mix(in srgb,var(--st-run) 30%,transparent)}
  .cn-det-m.bad{color:var(--st-fault);background:color-mix(in srgb,var(--st-fault) 10%,transparent);border:1px solid color-mix(in srgb,var(--st-fault) 30%,transparent)}
  .cn-det-m.pend{color:var(--muted);background:var(--card);border:1px solid var(--line)}
  .cn-tiles{display:flex;flex-wrap:wrap;gap:8px}
  .cn-tiles>.cn-tile{flex:1 1 118px}
  .cn-tile{border:1px solid var(--line);border-radius:10px;background:var(--bg2);padding:9px 11px;min-width:0}
  .cn-tile .l{font:600 10px/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
  .cn-tile .v{font:600 21px/1.15 var(--f-cond);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .cn-tile .v small{font:500 12px var(--f-ui);color:var(--muted);margin-left:3px}
  .cn-tile .v.s{font:500 12.5px/1.35 var(--f-mono);white-space:normal;overflow-wrap:anywhere;margin-top:6px}
  .cn-tiles>.cn-tile.wide{flex-basis:100%}
  .cn-s3-r{display:flex;flex-direction:column;gap:8px;min-width:0}
  .cn-chart{border:1px solid var(--line);border-radius:10px;background:var(--bg2);padding:9px 11px 6px;flex:1;display:flex;flex-direction:column;justify-content:space-between}
  .cn-chart-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .cn-chart-h .l{font:600 10px/1.2 var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
  .cn-chart-h .v{font:600 18px/1 var(--f-cond);font-variant-numeric:tabular-nums}
  .cn-chart-h .v small{font:500 11.5px var(--f-ui);color:var(--muted)}
  .cn-checks{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .cn-ch{display:grid;grid-template-columns:24px 150px minmax(0,1fr);gap:10px;align-items:center;padding:9px 14px;border-bottom:1px solid var(--line);font-size:12.8px}
  .cn-ch:last-child{border-bottom:0}
  .cn-ch .k{color:var(--text);font-weight:600}
  .cn-ch .t{color:var(--text2);min-width:0}
  .cn-ch.pend .k,.cn-ch.pend .t{color:var(--faint)}
  .cn-ch .ic{display:grid;place-items:center;width:22px;height:22px;border-radius:50%}
  .cn-ch.ok .ic{background:color-mix(in srgb,var(--st-run) 16%,transparent);color:var(--st-run)}
  .cn-ch.bad .ic{background:color-mix(in srgb,var(--st-fault) 16%,transparent);color:var(--st-fault)}
  .cn-ch.ok .ic .ico,.cn-ch.bad .ic .ico{stroke-width:2.6}
  .cn-ch.okin{animation:cnIn .3s ease both}
  @media (max-width:560px){.cn-ch{grid-template-columns:24px minmax(0,1fr)}.cn-ch .t{grid-column:2}}
  .cn-cmp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:14px}
  .cn-cmp>div{border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:var(--bg2)}
  .cn-cmp>div.now{border-color:color-mix(in srgb,var(--st-run) 35%,transparent);background:color-mix(in srgb,var(--st-run) 5%,var(--bg2))}
  .cn-cmp .k{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
  .cn-cmp .v{font-size:13px;color:var(--text);margin-top:6px}
  .cn-cmp .s{font-size:12px;color:var(--muted);margin-top:3px}
  @media (max-width:560px){.cn-cmp{grid-template-columns:minmax(0,1fr)}}

  /* Schritt 5 */
  .cn-done{display:flex;align-items:center;gap:18px;padding:4px 0 6px}
  .cn-done-ic{position:relative;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:color-mix(in srgb,var(--st-run) 16%,transparent);color:var(--st-run);flex:none;animation:cnPop .5s cubic-bezier(.2,1.4,.4,1) both}
  .cn-done-ic::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid color-mix(in srgb,var(--st-run) 40%,transparent);animation:cnRing2 1.6s ease-out .2s both}
  .cn-done-ic .ico{stroke-width:2.6}
  @keyframes cnPop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
  @keyframes cnRing2{from{transform:scale(.8);opacity:1}to{transform:scale(1.5);opacity:0}}
  .cn-done h3{margin:0;font:600 26px/1.1 var(--f-cond)}
  .cn-done p{margin:5px 0 0;color:var(--text2);font-size:13.5px}
  .cn-caps{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:9px}
  .cn-cap{display:flex;gap:9px;align-items:flex-start;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--st-run) 30%,transparent);background:color-mix(in srgb,var(--st-run) 5%,var(--bg2));font-size:12.8px;color:var(--text);animation:cnIn .35s ease both}
  .cn-cap .ico{color:var(--st-run);flex:none;margin-top:1px}
  .cn-cap span{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
  .cn-cap.keep{border-color:var(--line);background:var(--bg2);color:var(--text2)}
  .cn-cap.keep .ico{color:var(--faint)}
  .cn-where{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
  .cn-lbl{font:600 10.5px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:20px;display:block}
  `, 'connect');

  // =================================================================== Grunddaten
  const S = () => WF.sim.state;
  const PR = () => WF.profile;
  const ST = (id) => WF.profile.stationById[id];
  const IDS = () => WF.profile.machines.filter(id => S().machines[id]);
  const nowT = () => S().t;
  const lvOf = (id) => { const m = S().machines[id]; return m && m.conn ? (m.conn.level || 0) : 0; };
  const lvVar = (l) => `var(--cn-l${l})`;
  const lvBadge = (l, cls) => `<span class="cn-lv${cls ? ' ' + cls : ''}" style="--c:${lvVar(l)}" title="Level ${l}: ${esc(WF.sim.label('conn', l))}">L${l}</span>`;
  const fA = (a) => U.fmtNum(a, 1) + ' A';
  const stColor = (st) => (WF.STATE[st] || WF.STATE.idle).color;
  const stLabel = (st) => (WF.STATE[st] || WF.STATE.idle).label;
  const MODE_DE = { AUTO: 'Automatik', STOP: 'Stopp', 'JOG/MDI': 'Einrichten', ALARM: 'Alarm' };
  const LIGHT_DE = { green: 'grün', yellow: 'gelb', red: 'rot', off: 'aus' };
  const LIGHT_C = { green: 'var(--st-run)', yellow: 'var(--st-wait)', red: 'var(--st-fault)', off: 'var(--faint)' };
  const ago = (sec) => sec == null ? '–' : sec < 60 ? `vor ${Math.max(0, Math.round(sec))} s` : 'vor ' + U.fmtDur(sec);
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /** Anbindungsstufen – was sie technisch sind und was sie in werkfluss freischalten */
  const LV = [
    { l: 0, name: 'Tablet-Rückmeldung', short: 'Tablet', effort: 'sofort' },
    { l: 1, name: 'Nachrüst-Sensorik', short: 'Sensorik', effort: 'ca. 20 min' },
    { l: 2, name: 'Steuerung lesen', short: 'Steuerung', effort: '30–60 min' },
    { l: 3, name: 'Werkzeug- & Programmdaten', short: '+ Werkzeug', effort: '+ 15–30 min' },
  ];
  const CAPS = [
    { k: 'state', label: 'Maschinenzustand', v: ['manuell', 'auto', 'auto', 'auto'], d: 'Produktion, Warten, Störung – ohne Zutun' },
    { k: 'runtime', label: 'Laufzeit & Stillstände', v: ['manuell', 'auto', 'auto', 'auto'], d: 'jeder Stillstand mit Dauer und Kosten' },
    { k: 'energy', label: 'Energie (kW, kWh)', v: ['geschätzt', 'auto', 'auto', 'auto'], d: 'gemessen statt aus dem Modell geschätzt' },
    { k: 'count', label: 'Stückzahl', v: ['manuell', 'manuell', 'auto', 'auto'], d: 'Teilezähler direkt aus der Steuerung' },
    { k: 'alarm', label: 'Alarme mit Code & Text', v: [null, null, 'auto', 'auto'], d: 'Störungen im Klartext, z. B. für die Instandhaltung' },
    { k: 'nc', label: 'Programm, Spindel, Override', v: [null, null, 'auto', 'auto'], d: 'NC-Programm, Drehzahl, Last und Override live' },
    { k: 'tool', label: 'Werkzeug in der Spindel', v: [null, null, null, 'auto'], d: 'aktives Werkzeug je Teil' },
    { k: 'life', label: 'Standzeit aus der Steuerung', v: [null, null, null, 'auto'], d: 'Abgleich mit der Werkzeugplanung' },
  ];

  /** Fähigkeiten je Stationstyp: Handarbeitsplatz, Waschanlage und Messraum haben weder Spindel noch Zerspanwerkzeug */
  function capsFor(type) {
    const out = [];
    for (const c of CAPS) {
      if (['washer', 'cmm', 'assembly'].includes(type) && (c.k === 'tool' || c.k === 'life')) continue;
      if (type === 'assembly' && c.k === 'energy') continue;
      let o = c;
      if (c.k === 'nc') {
        if (type === 'assembly') o = Object.assign({}, c, { label: 'Arbeitsschritt & Anzugsmomente', d: 'Montageschritt und jedes Schraubergebnis live' });
        else if (type === 'washer') o = Object.assign({}, c, { label: 'Programm, Phase & Badtemperatur', d: 'Prozessdaten je Charge' });
        else if (type === 'cmm') o = Object.assign({}, c, { label: 'Messprogramm & Merkmal', d: 'welches Teil gerade gemessen wird' });
      }
      if (c.k === 'alarm' && type === 'assembly') o = Object.assign({}, o, { label: 'Schraubfehler mit Code', d: 'n. i. O.-Verschraubungen sofort sichtbar' });
      out.push(o);
    }
    return out;
  }

  // =================================================================== Engine-Spiegel: Signale einer höheren Stufe
  // Gleiche Formeln und gleiches 5-s-Raster wie computeSignals() in 10_sim.js; nur lesend.
  const RPM = { saw: 45, lathe: 2400, swiss: 6500, biglathe: 380, mill5: 12000, mill3: 8000, deephole: 650, hobber: 900, cylgrinder: 1800, surfgrinder: 1500, washer: 0, cmm: 0, assembly: 0 };
  const hnoise = (a, b) => { let h = Math.imul((a | 0) ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x632BE5AB, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return ((h >>> 0) / 4294967296) * 2 - 1; };
  const o4 = (o) => (o.part.no || o.id).replace(/[^A-Za-z0-9]/g, '');
  function progName(o, r) { const n = 4000 + (parseInt(U.hash(o.part.no || o.id), 16) % 5000); return 'O' + n + '_' + o.id.replace('-', '') + '_OP' + r.seq; }
  function curOf(m) {
    if (!m || !m.op) return null;
    const o = S().orders[m.op.oid]; if (!o) return null;
    return { o, r: o.routing[m.op.idx], op: o.ops[m.op.idx] };
  }
  const cutFor = (r, typeId) => { for (const t of (r && r.tools) || []) if (t.type === typeId) return t.cutMinPerPart; return 0; };
  function mainTool(m, r) {
    let main = null, mc = -1;
    for (const tid of m.tools || []) { const tl = S().tools[tid]; if (!tl) continue; const c = cutFor(r, tl.typeId); if (c > mc) { mc = c; main = tl; } }
    return mc > 0 ? main : null;
  }
  function powerOf(m, st) {
    const p = (st && st.power) || { idle: 1, run: 5 };
    switch (m.state) {
      case 'running': return m.part && m.part.sub === 'cut' ? p.run : p.idle + (p.run - p.idle) * 0.25;
      case 'fault': return p.idle * 0.8;
      case 'setup': case 'toolchange': return p.idle * 1.1;
      default: return p.idle;
    }
  }
  const ampsOf = (kw) => Math.round(kw * 1000 / (1.732 * 400 * 0.85) * 10) / 10;

  /** Vollständiger Signal-Kontext einer realen Maschine (alle Stufen), konsistent zum Engine-Zustand. */
  function fullCtx(id) {
    const s = S(), m = s.machines[id], st = ST(id);
    const T = s.t - (s.t % 5), idx = WF.profile.machines.indexOf(id);
    const c = curOf(m);
    const cutting = m.state === 'running' && !!m.part && m.part.sub === 'cut' && !m.part.paused;
    const dressing = m.state === 'running' && !m.part && m.dressRem > 0;
    const nz = hnoise(T, idx + 1);
    const light = m.state === 'fault' ? 'red' : m.state === 'running' ? 'green' : m.state === 'idle' ? 'off' : 'yellow';
    const kw = Math.round(powerOf(m, st) * (1 + 0.03 * nz) * 10) / 10;
    const amps = ampsOf(kw);
    const p = (st && st.power) || { idle: 1, run: 5 };
    const tl = c ? mainTool(m, c.r) : null, wear = tl ? tl.used / tl.life : 0;
    const base = RPM[st.type] || 0, spindle = base > 0;
    const mode = m.state === 'fault' ? 'ALARM' : cutting || dressing ? 'AUTO' : m.state === 'setup' || m.state === 'toolchange' ? 'JOG/MDI' : 'STOP';
    const x = {
      demo: false, id, T, type: st.type, state: m.state, cause: m.cause, cutting, dressing, light, kw, amps, spindle, mode,
      ph: [0, 1, 2].map(k => Math.round(amps * (1 + 0.014 * hnoise(T, 101 + 100 * k + idx)) * 10) / 10),
      thrA: ampsOf(p.idle * 1.25),
      runtime: m.kd && m.kd.stateSec ? m.kd.stateSec.running : null,
      rpm: spindle ? (cutting ? Math.round(base * (1 + 0.015 * nz)) : dressing ? Math.round(base * 0.6) : 0) : null,
      load: spindle ? (cutting ? Math.max(5, Math.round(36 + 32 * wear + 5 * nz)) : dressing ? 12 : 0) : null,
      ovr: spindle ? (c ? (wear > 0.9 ? 90 : 100) : 100) : null,
      prog: c ? (st.type === 'cmm' ? 'CALYPSO_' + o4(c.o) + '_AG' + c.r.seq : st.type === 'assembly' ? 'Montageanweisung ' + (c.o.part.drawing || c.o.part.no) : st.type === 'washer' ? 'Waschprogramm ' + (c.o.part.material || 'Standard') : progName(c.o, c.r)) : '–',
      count: c ? c.op.good + c.op.scrap : 0, total: m.counter,
      tool: tl ? tl.typeId : null, toolName: tl ? tl.name : null, wearPct: tl ? Math.round(tl.used / tl.life * 100) : null,
      alarm: m.fault ? m.fault.code + ' ' + m.fault.text : null, coolant: cutting && spindle,
    };
    if (st.type === 'cmm') { const ch = c ? WF.sim.charOf(c.o.id, c.r.seq) : null; x.feature = cutting && ch ? ch.name : null; x.probe = m.fault ? 'Taster gestört' : cutting ? 'misst' : 'bereit'; }
    if (st.type === 'washer') { x.temp = Math.round((m.fault ? 48 : 60) + 1.5 * nz); x.cycle = cutting ? (m.part.rem > m.part.dur * 0.3 ? 'Waschen' : 'Trocknen') : '–'; }
    if (st.type === 'assembly') {
      const n = 7, k = cutting ? Math.min(n, 1 + Math.floor((1 - m.part.rem / m.part.dur) * n)) : 0;
      x.step = cutting ? `Schritt ${k}/${n}` : '–';
      const ms = c ? (s.measurements[c.o.id + '/' + c.r.seq] || []) : [];
      const last = ms.length ? ms[ms.length - 1] : null;
      x.torque = last ? last.v : null; x.tightOk = last ? (last.ok ? 1 : 0) : null;
    }
    return x;
  }
  /** Signale einer Maschine auf Stufe lv – gleiche Form und Werte wie state.machines[id].signals der Engine. */
  function previewSignals(id, lv, force) {
    const m = S().machines[id]; if (!m) return null;
    if (!force && lv === (m.conn.level || 0)) return m.signals;
    const x = fullCtx(id);
    if (lv <= 0) return m.signals;
    if (lv === 1) return { t: x.T, level: 1, source: 'Stromsensor + Signalsäule', powerKw: x.kw, currentA: x.amps, stackLight: x.light, stackLightLabel: WF.sim.label('stackLight', x.light), runtimeTodaySec: x.runtime, partCounter: null };
    const sg = { t: x.T, level: lv, source: m.conn.protocol, mode: x.mode, stackLight: x.light, stackLightLabel: WF.sim.label('stackLight', x.light),
      spindleRpm: x.rpm, spindleLoadPct: x.load, feedOverridePct: x.ovr, program: x.prog, partCounter: x.count, totalCounter: x.total,
      toolInSpindle: lv >= 3 && x.spindle && x.tool ? x.tool : null, toolInSpindleName: lv >= 3 && x.spindle && x.tool ? x.toolName : null, alarm: x.alarm, coolant: x.coolant };
    if (x.type === 'cmm') { sg.measuringProgram = sg.program; sg.feature = x.feature; sg.probe = x.probe; }
    if (x.type === 'washer') { sg.bathTempC = x.temp; sg.cycle = x.cycle; }
    if (x.type === 'assembly') sg.terminalStep = x.step;
    return sg;
  }
  /** Anzahl erfasster Signale je Station und Stufe (5-s-Raster → ×12 je Minute) */
  function sigCount(type, lv) {
    if (lv <= 0) return 0;
    if (lv === 1) return 4;
    const spindle = (RPM[type] || 0) > 0;
    let n = 8 + (spindle ? 3 : 0);
    if (type === 'cmm') n += 3; else if (type === 'washer') n += 2; else if (type === 'assembly') n += 1;
    if (lv >= 3 && spindle) n += 2;
    return n;
  }
  const dpMin = (id) => sigCount(ST(id).type, lvOf(id)) * 12;

  // =================================================================== Gateways
  const GW_META = {
    'werkfluss Edge 01': { ip: '10.20.1.21', net: 'LAN', base: 7 },
    'werkfluss Edge 02': { ip: '10.20.1.22', net: 'LAN', base: 9 },
    'werkfluss Edge 03': { ip: '10.20.1.23', net: 'WLAN', base: 15 },
    'direkt (Steuerung)': { ip: '–', net: 'Firmennetz', base: 3 },
  };
  const gwKey = (c) => !c || (c.level || 0) === 0 || !c.gateway || c.gateway === '–' ? 'tablet' : c.gateway;
  const gwKind = (k) => k === 'tablet' ? 'tablet' : /direkt/i.test(k) ? 'direct' : 'edge';
  const gwTitle = (k) => k === 'tablet' ? 'Tablet-Rückmeldung' : gwKind(k) === 'direct' ? 'Direkt · Firmennetz' : k;
  function gwLatency(k) {
    const meta = GW_META[k] || { base: 12 };
    const T = Math.floor(nowT() / 5);
    return Math.max(1, Math.round(meta.base + 2.2 + 2.2 * hnoise(T, 7 + (parseInt(U.hash(k), 16) % 97))));
  }
  const gwHeartbeat = (k) => (nowT() + (parseInt(U.hash(k), 16) % 10)) % 10;
  /** Übertragungsphase je Gateway im 5-s-Raster: Messwert des Rasters T kommt bei T + Phase im Server an
      (direkte OPC-UA-/MTConnect-Abos sofort, Edge-Gateways bündeln versetzt). */
  const GW_PHASE = { 'werkfluss Edge 01': 1, 'werkfluss Edge 02': 3, 'werkfluss Edge 03': 2, 'direkt (Steuerung)': 0 };
  function msgAge(id) {
    const m = S().machines[id], sg = m && m.signals; if (!sg || sg.t == null) return null;
    const ph = GW_PHASE[m.conn.gateway] != null ? GW_PHASE[m.conn.gateway] : 1;
    const r = nowT() - sg.t;
    return ((r - ph) % 5 + 5) % 5;
  }
  function gatewayGroups() {
    const map = new Map();
    for (const id of IDS()) { const k = gwKey(S().machines[id].conn); if (!map.has(k)) map.set(k, []); map.get(k).push(id); }
    const rank = (k) => gwKind(k) === 'edge' ? 0 : gwKind(k) === 'direct' ? 1 : 2;
    return [...map.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(k => ({ key: k, kind: gwKind(k), ids: map.get(k) }));
  }
  const edgeKeys = () => gatewayGroups().filter(g => g.kind === 'edge').map(g => g.key);

  // =================================================================== Wissensbasis: Schnittstellen & Anbindungswege
  const FACTS = {
    M01: { kind: 's7', iface: 'Siemens S7-300 mit Ethernet (CP 343-1)' },
    M02: { kind: 'umati', iface: 'SINUMERIK 840D sl · OPC UA (umati) aktiv' },
    M03: { kind: 'mtconnect', iface: 'Mitsubishi M800 · MTConnect-Adapter' },
    M04: { kind: 'opcua', iface: 'SINUMERIK 840D sl · OPC-UA-Server aktiv' },
    M05: { kind: 'umati', iface: 'Heidenhain TNC 640 · OPC UA (umati) aktiv' },
    M06: { kind: 'mtconnect', iface: 'Haas NGC · MTConnect integriert' },
    M07: { kind: 'sinumerik-pl', iface: 'SINUMERIK 840D powerline (Retrofit 2011) · Ethernet an der NCU, kein OPC-UA-Server' },
    M08: { kind: 'sinumerik-pl', iface: 'SINUMERIK 840D · gelesen über werkfluss Edge 02' },
    M09: { kind: 'focas', iface: 'Fanuc 31i-B · FOCAS2 über Ethernet' },
    M10: { kind: 'none', iface: 'Keine Netzwerkschnittstelle · RS-232 nur für NC-Programme', rs232: true },
    M11: { kind: 's7ua', iface: 'Siemens S7-1500 · integrierter OPC-UA-Server (ab Firmware 2.0)' },
    QS: { kind: 'calypso', iface: 'ZEISS CALYPSO · Messprotokoll-Export' },
    M13: { kind: 'terminal', iface: 'Montage-Terminal (Tablet) · Schraubsteuerung mit Open Protocol' },
  };
  function factsFor(sj) {
    if (sj.facts) return sj.facts;
    const f = FACTS[sj.id]; if (f) return f;
    const c = String(sj.control || '');
    if (/TNC|Heidenhain/i.test(c)) return { kind: 'umati', iface: c + ' · OPC UA (umati)' };
    if (/840D sl/i.test(c)) return { kind: 'opcua', iface: c + ' · OPC UA' };
    if (/840D/i.test(c)) return { kind: 'sinumerik-pl', iface: c };
    if (/Fanuc/i.test(c)) return { kind: 'focas', iface: c + ' · FOCAS2' };
    if (/Mitsubishi|Haas|Okuma|Mazak/i.test(c)) return { kind: 'mtconnect', iface: c + ' · MTConnect' };
    if (/S7-1500/i.test(c)) return { kind: 's7ua', iface: c };
    if (/S7|SPS/i.test(c)) return { kind: 's7', iface: c };
    if (/CALYPSO/i.test(c)) return { kind: 'calypso', iface: c };
    if (/Terminal/i.test(c)) return { kind: 'terminal', iface: c };
    return { kind: 'none', iface: 'Keine Datenschnittstelle bekannt' };
  }
  function famOfProtocol(p) {
    p = String(p || '');
    if (/Nachrüst/i.test(p)) return 'retrofit';
    if (/umati/i.test(p)) return 'umati';
    if (/S7-1500/i.test(p)) return 's7ua';
    if (/OPC UA/i.test(p)) return 'sinumerik';
    if (/MTConnect/i.test(p)) return 'mtconnect';
    if (/FOCAS/i.test(p)) return 'focas';
    if (/S7/i.test(p)) return 's7';
    if (/Open Protocol|Schrauber/i.test(p)) return 'op';
    if (/CALYPSO/i.test(p)) return 'calypso';
    return 'tablet';
  }
  function breakHint() {
    const t = nowT(), s = ((t % 86400) + 86400) % 86400;
    for (const sh of PR().shifts) {
      const a = U.hm(sh.start), b = U.hm(sh.end);
      if (s >= a && s < b) {
        for (const [x, y] of sh.breaks) { const bx = U.hm(x), by = U.hm(y); if (s < by) return { now: s >= bx, text: `${x}–${y}`, until: y }; }
        return { end: true, text: sh.end };
      }
    }
    return { off: true };
  }
  /** Wann die Montage am wenigsten stört – aus Schichtplan und Beladeart der Maschine */
  function downtimeText(sj, mins) {
    if (sj.loading === 'auto') return `ca. ${mins} min spannungsfrei – beim nächsten Rüsten oder Werkzeugwechsel`;
    const b = breakHint();
    if (b.now) return `ca. ${mins} min spannungsfrei – jetzt in der Pause bis ${b.until}`;
    if (b.text && !b.end && !b.off) return `ca. ${mins} min spannungsfrei – in der Pause ${b.text}`;
    if (b.end) return `ca. ${mins} min spannungsfrei – nach Schichtende ${b.text}`;
    return `ca. ${mins} min spannungsfrei – sofort möglich (keine Schicht)`;
  }
  function timingWhy(sj) {
    const per = sj.loading === 'perPart' ? 'die Maschine wird je Teil eingelegt' : 'die Maschine wird bedient';
    if (sj.loading === 'auto') return 'Die Maschine läuft auch in den Pausen – die Montage passt am besten in das nächste Rüsten oder einen Werkzeugwechsel.';
    const b = breakHint();
    if (b.now) return `Jetzt ist Pause bis ${b.until}: ${per} und steht ohnehin – die Montage kann sofort erfolgen.`;
    if (b.text && !b.end && !b.off) return `Montage am besten in der Pause ${b.text}: ${per} und steht dann ohnehin.`;
    if (b.end) return `Montage nach Schichtende ${b.text} – dann steht die Maschine ohnehin.`;
    return 'Außerhalb der Schicht steht die Maschine – die Montage kann sofort erfolgen.';
  }
  const faultOf = (type) => { const f = (PR().faults[type] || [])[0] || (PR().faults.generic || [])[0]; return f ? `${f.code} ${f.text}` : null; };
  const priciestTool = (id) => {
    let best = null; const m = S().machines[id];
    for (const tid of (m && m.tools) || []) { const tl = S().tools[tid], tt = tl && PR().toolTypeById[tl.typeId]; if (tt && (!best || tt.cost > best.cost)) best = tt; }
    return best;
  };
  const medCustomer = (id) => Object.values(S().orders).some(o => o.sector === 'Medizintechnik' && (o.routing || []).some(r => r.station === id));

  /** Alle Anbindungswege einer Maschine inkl. Empfehlung und Begründung (regelbasiert aus Steuerung, Baujahr, Ist-Stand). */
  function analyze(sj) {
    const f = factsFor(sj), cur = sj.cur, opts = [];
    const gw = (lv) => sj.demo ? (sj.demoGw || 'werkfluss Edge 03') : lv === 0 ? '–' : (sj.gateway && sj.gateway !== '–' ? sj.gateway : 'werkfluss Edge 03');
    const gwNew = (lv) => gw(lv) === 'werkfluss Edge 03' && !edgeKeys().includes('werkfluss Edge 03');
    const gwTxt = (lv) => { const g = gw(lv); return /direkt/i.test(g) ? 'direkt über das Firmennetz' : g + (gwNew(lv) ? ' (neu)' : ''); };
    const noTools = ['washer', 'cmm', 'assembly'].includes(sj.type);
    const fault = faultOf(sj.type);
    const tool = sj.demo ? null : priciestTool(sj.id);
    const rateTxt = sj.rate ? `${U.fmtNum(sj.rate)} €/h` : null;
    const impossible = (level, title, reason) => ({ key: 'x' + level + title.length, level, title, possible: false, reason, family: null });
    const tablet = () => ({ key: 'tablet', level: 0, family: 'tablet', title: 'Tablet-Rückmeldung', sub: 'Bediener melden Start, Stopp und Stückzahl am Tablet', possible: true,
      protocol: sj.protocol || 'nicht angebunden – Rückmeldung per Tablet', effort: 'sofort', downtime: 'kein Stillstand', intervention: 'keine Hardware',
      pros: ['Keine Hardware, sofort nutzbar'], cons: ['Zustand nur so aktuell wie die letzte Meldung', 'Kurze Stillstände und Energie werden nicht erfasst'] });
    const retrofit = () => ({ key: 'retrofit', level: 1, family: 'retrofit', possible: true, title: 'Nachrüst-Sensorik', sub: 'Stromsensor im Schaltschrank + Abgriff der Signalsäule',
      protocol: 'Nachrüst-Sensorik (Strom + Signalsäule)', gateway: gw(1), effort: 'ca. 20 min Montage', effortShort: 'ca. 20 min', downtime: downtimeText(sj, 10), intervention: 'Kein Eingriff in Steuerung, SPS oder NC-Programm',
      hw: ['3 Klapp-Stromwandler auf der Zuleitung', sj.noLight ? 'Abgriff des Hauptschützes (24 V)' : 'Signalsäulen-Abgriff 24 V (Optokoppler)', gwTxt(1).replace(/^direkt.*/, 'werkfluss Edge') + ' auf der Hutschiene'],
      pros: ['Zustand, Laufzeit und Stillstände automatisch', 'Energie gemessen statt geschätzt', 'Herstellerunabhängig – für jede Maschine jeden Alters'],
      cons: ['Keine Stückzahl und kein Programmname – Stückzahl weiter per Tablet'],
      why: [
        f.kind === 'none' ? `Baujahr ${sj.year}: ${sj.controlShort} ohne Netzwerkschnittstelle${f.rs232 ? ' – die RS-232-Schnittstelle überträgt nur NC-Programme, keine Zustände' : ''}.` : `${sj.controlShort} bietet heute keinen offenen Datenzugang – die Sensorik liefert sofort belastbare Zustände.`,
        sj.noLight ? 'Der Laststrom zeigt zuverlässig, ob die Maschine zerspant oder steht – auch ohne Signalsäule.' : 'Strom und Signalsäule zeigen zuverlässig, ob die Maschine arbeitet, wartet oder gestört ist – unabhängig vom Hersteller.',
        'Klemmen statt Eingreifen: Steuerung, NC-Programm und CE-Konformität bleiben unberührt.',
        timingWhy(sj),
      ],
      install: ['Schaltschrank durch eine Elektrofachkraft spannungsfrei schalten', 'Stromwandler um die drei Phasen der Zuleitung klappen', sj.noLight ? 'Hauptschütz-Rückmeldung an Eingang DI0 klemmen' : 'Signalsäule grün / gelb / rot parallel an DI0–DI2 klemmen', 'Edge auf die Hutschiene setzen, 24 V anschließen, per QR-Code koppeln'] });
    const s7 = () => ({ key: 's7', level: 2, family: 's7', possible: true, title: 'SPS lesen (S7-Protokoll)', sub: `${gw(2)} liest die Datenbausteine der SPS – nur lesend`,
      protocol: 'Siemens S7 (SPS lesen)', gateway: gw(2), effort: 'ca. 30 min', effortShort: 'ca. 30 min', downtime: 'kein Stillstand', intervention: 'Nur lesender Zugriff (PUT/GET), kein Eingriff ins SPS-Programm',
      pros: ['Schnittzähler = Stückzahl automatisch', 'Störcodes im Klartext', 'Programm und Antrieb sichtbar'], cons: ['Belegung der Datenbausteine einmalig mit dem Hersteller-Service abstimmen'],
      why: [`Die ${sj.vendor}-Steuerung basiert auf einer Siemens S7-300 mit Ethernet: Zustand, Schnittzähler und Störcodes liegen in Datenbausteinen.`,
        cur >= 1 ? `${gw(2)} ist bereits an der Maschine (heute Stromsensor) – kein neues Gerät nötig, der Stromsensor bleibt für die Energie aktiv.` : `${gw(2)} liest die SPS über das Firmennetz.`,
        `Neu gegenüber heute: Stückzahl automatisch und Störungen mit Code${fault ? `, z. B. „${fault}“` : ''}.`],
      install: ['Netzwerkkabel SPS → Switch', 'PUT/GET-Zugriff für die Datenbausteine freigeben', `Treiber „S7“ auf ${gw(2)} aktivieren`, 'KI-Vorschlag der Signalzuordnung prüfen'] });
    const s7ua = () => ({ key: 's7ua', level: 2, family: 's7ua', possible: true, title: 'OPC UA der S7-1500', sub: 'Badtemperatur, Programm und Prozessphase direkt aus der SPS',
      protocol: 'OPC UA (S7-1500 integriert)', gateway: gw(2), effort: 'ca. 30 min', effortShort: 'ca. 30 min', downtime: 'ca. 5 min (SPS laden) – zwischen zwei Chargen', intervention: 'Konfiguration der SPS, kein Eingriff in den Ablauf',
      pros: ['Badtemperatur und Prozessphase live', 'Stückzahl automatisch', `Alarme mit Code${fault ? ` („${fault.split(' ').slice(0, 2).join(' ')}“)` : ''}`], cons: ['TIA-Projekt der Anlage und Elektriker nötig'],
      why: ['Die Anlage hat eine Siemens S7-1500 mit integriertem OPC-UA-Server – er muss nur freigeschaltet werden.',
        'Heute erkennt werkfluss nur „läuft / steht“ über den Strom; künftig auch Programm, Phase und Badtemperatur.',
        medCustomer(sj.id) ? 'Prozessdaten je Charge werden dokumentiert – ein Reinigungsnachweis für die Medizintechnik-Kunden.' : 'Prozessdaten je Charge werden automatisch dokumentiert.'],
      install: ['OPC-UA-Server im TIA-Projekt aktivieren und laden', `Zertifikat von ${gw(2)} in der SPS vertrauen`, 'Leserechte für den Benutzer „werkfluss“ anlegen', 'KI-Vorschlag der Signalzuordnung prüfen'] });
    const ctrl = (fam, level, o) => Object.assign({ key: fam + level, level, family: fam, possible: true, gateway: gw(level) }, o);
    const l3why = (base) => [base,
      tool ? `Teuerstes Werkzeug an der Maschine: ${tool.name} (${U.fmtEur(tool.cost)}) – mit der Standzeit aus der Steuerung wird es bis zum Ende genutzt, ohne zu überziehen.` : 'Die Standzeit aus der Steuerung bestätigt die Werkzeugplanung von werkfluss.',
      rateTxt ? `Bei ${rateTxt} Maschinenstundensatz zählt jede vermiedene Wartezeit auf ein Werkzeug.` : 'Jede vermiedene Wartezeit auf ein Werkzeug zählt.'];
    const l3 = { pros: ['Werkzeug in der Spindel live', 'Standzeit direkt aus der Steuerung'], cons: ['Standzeitüberwachung muss in der Steuerung gepflegt sein'], downtime: 'kein Stillstand', intervention: 'Keine Hardware, nur Konfiguration' };
    switch (f.kind) {
      case 'none':
        opts.push(tablet(), retrofit(),
          impossible(2, 'Steuerung lesen', `${sj.controlShort} (${sj.year}) hat weder Ethernet noch OPC UA oder MTConnect${f.rs232 ? '; über RS-232 sind keine Zustandsdaten abrufbar' : ''}.`),
          impossible(9, 'Steuerungs-Retrofit (neue CNC)', 'Technisch möglich, aber unwirtschaftlich: mehrere zehntausend Euro und 1–2 Wochen Stillstand – für die Anbindung nicht nötig.'));
        break;
      case 'terminal':
        opts.push(tablet(),
          impossible(1, 'Nachrüst-Sensorik', 'Handarbeitsplatz ohne Maschinenstrom und Signalsäule – ein Stromsensor liefert hier keine Aussage.'),
          ctrl('op', 2, { title: 'Montage-Terminal + Schraubsteuerung', sub: 'Schraubergebnisse per Open Protocol, Arbeitsschritte vom Terminal', protocol: 'Montage-Terminal + Schrauber (Open Protocol)',
            effort: 'ca. 1 h Konfiguration', effortShort: 'ca. 1 h', downtime: 'kein Stillstand', intervention: 'Keine Montage – Schraubsteuerung ins Firmennetz, App auf dem Terminal',
            pros: ['Stückzahl und Montageschritt automatisch', 'Anzugsmomente je Baugruppe dokumentiert (Rückverfolgbarkeit)'], cons: ['Sichtprüfungen bleiben eine Bestätigung am Terminal'],
            why: ['Handarbeitsplatz ohne Maschinenstrom und Signalsäule – Nachrüst-Sensorik bringt hier nichts.',
              'Die Akku-Schrauber haben eine Schraubsteuerung mit Open-Protocol-Schnittstelle: jedes Anzugsmoment wird automatisch übertragen.',
              'Das Terminal meldet Arbeitsschritt und fertige Baugruppe – die Stückzahl kommt ohne Zusatzeingabe.'],
            install: ['Schraubsteuerung per LAN ins Firmennetz', `Open Protocol auf ${gw(2)} aktivieren`, 'werkfluss-App auf dem Montage-Terminal anmelden', 'KI-Vorschlag der Signalzuordnung prüfen'] }));
        break;
      case 's7': opts.push(retrofit(), s7(), impossible(3, 'Werkzeugdaten', 'Die Sägesteuerung führt keine Sägeband-Standzeit – werkfluss berechnet sie aus den Schnittzeiten (bereits aktiv).')); break;
      case 's7ua': opts.push(retrofit(), s7ua(), impossible(3, 'Werkzeugdaten', 'Reinigungsanlage ohne Werkzeuge – Level 2 ist hier das Maximum.')); break;
      case 'calypso':
        opts.push(ctrl('calypso', 2, { title: 'Messprotokoll-Export (CALYPSO)', sub: 'Messprogramm, Merkmal und Ergebnis je Teil', protocol: sj.protocol || 'Messprotokoll-Export (CALYPSO)', effort: '–', downtime: 'kein Stillstand', intervention: 'nur lesend', pros: ['Messwerte automatisch'], cons: [] }),
          impossible(3, 'Werkzeugdaten', 'Messmaschine ohne Zerspanwerkzeuge – Level 2 (Messprotokolle) ist hier das Maximum.'));
        break;
      case 'sinumerik-pl':
        if (cur <= 1) opts.push(retrofit());
        opts.push(ctrl('sinumerik', 2, { title: 'Steuerung lesen über Edge-Gateway', sub: `${gw(2)} liest die NCU und stellt die Daten als OPC UA bereit`, protocol: 'OPC UA (über Gateway)',
          effort: 'ca. 45 min', effortShort: 'ca. 45 min', downtime: 'kein Stillstand', intervention: 'Nur lesender Zugriff auf die NCU',
          pros: ['Stückzahl automatisch', 'Alarme mit Code und Text', 'Programm, Spindel und Override live'], cons: ['Netzwerkkabel zur NCU nötig'],
          why: [`Die Maschine (Bj. ${sj.year}) läuft mit ${sj.controlShort}: die NCU hat Ethernet, aber keinen eingebauten OPC-UA-Server.`,
            `${gw(2)} übersetzt die Steuerungsdaten in OPC UA${cur >= 1 ? ' – dasselbe Gateway, das heute schon den Stromsensor liest' : ''}.`,
            `Neu: Drehzahl, Programm, Stückzähler und Alarme mit Code${fault ? `, z. B. „${fault}“` : ''}.`],
          install: ['Netzwerkkabel NCU → Edge', `Treiber „SINUMERIK powerline“ auf ${gw(2)} aktivieren`, 'Leserechte in der NCU einrichten', 'KI-Vorschlag der Signalzuordnung prüfen'] }));
        opts.push(ctrl('sinumerik', 3, Object.assign({}, l3, { title: 'Steuerung lesen inkl. Werkzeugdaten', sub: 'zusätzlich Werkzeugverwaltung der SINUMERIK', protocol: 'OPC UA (über Gateway, inkl. Werkzeugdaten)',
          effort: cur >= 2 ? 'ca. 30 min Konfiguration' : 'ca. 75 min', effortShort: cur >= 2 ? 'ca. 30 min' : 'ca. 75 min',
          why: l3why(cur >= 2 ? `Bereits Level 2 über ${gw(3)} – die Werkzeugverwaltung der SINUMERIK ist über denselben Zugang lesbar.` : 'Die Werkzeugverwaltung der SINUMERIK ist über das Gateway zusätzlich lesbar.'),
          install: [`Werkzeug-Knoten auf ${gw(3)} freischalten`, 'Standzeitüberwachung in der Steuerung prüfen', 'Werkzeugnummern mit werkfluss abgleichen', 'Live-Test'] })));
        break;
      case 'opcua':
        opts.push(ctrl('sinumerik', 2, { title: 'OPC UA (SINUMERIK)', sub: 'Zustand, Programm, Spindel und Stückzähler', protocol: 'OPC UA', effort: 'ca. 30 min', effortShort: 'ca. 30 min', downtime: 'kein Stillstand', intervention: 'nur lesend', pros: ['Stückzahl und Alarme automatisch'], cons: [] }),
          ctrl('sinumerik', 3, Object.assign({}, l3, { title: 'OPC UA inkl. Werkzeugverwaltung', sub: 'Werkzeugdaten der SINUMERIK-Werkzeugverwaltung zusätzlich lesen', protocol: 'OPC UA (inkl. Werkzeugverwaltung)',
            effort: 'ca. 20 min Konfiguration', effortShort: 'ca. 20 min', intervention: 'Nur Leserechte für den Benutzer „werkfluss“',
            why: l3why('Die 840D sl ist bereits per OPC UA angebunden (Level 2) – die Werkzeugverwaltung führt Standzeit und aktives Werkzeug und ist über denselben Server lesbar.'),
            install: ['Werkzeug-Knoten im OPC-UA-Server freigeben', 'Leserechte für „werkfluss“ erweitern', 'Werkzeugnummern mit werkfluss abgleichen', 'Live-Test'] })));
        break;
      case 'umati':
        opts.push(ctrl('umati', 2, { title: 'OPC UA (umati) – Basis', sub: 'standardisierte Zustands- und Programmdaten', protocol: 'OPC UA (umati)', effort: 'ca. 15 min', effortShort: 'ca. 15 min', downtime: 'kein Stillstand', intervention: 'nur lesend, Zertifikat',
            pros: ['Bedeutung jedes Signals ist standardisiert', 'Zuordnung vollautomatisch'], cons: ['ohne Werkzeugdaten'] }),
          ctrl('umati', 3, Object.assign({}, l3, { title: 'OPC UA (umati) komplett', sub: 'Zustand, Programm, Stückzahl und Werkzeugdaten nach Standard', protocol: 'OPC UA (umati)',
            effort: 'ca. 15 min', effortShort: 'ca. 15 min', intervention: 'Nur lesend, Zertifikat in der Steuerung vertrauen', pros: ['Alles in einem Schritt', 'Semantik standardisiert (umati) – keine Handarbeit'], cons: ['umati-Option der Steuerung muss freigeschaltet sein'],
            why: [`${sj.controlShort} spricht OPC UA nach dem Branchenstandard umati – die Bedeutung jedes Signals ist festgelegt.`,
              'Damit ordnet werkfluss die Signale ohne Rückfragen zu, inklusive Werkzeug- und Programmdaten.',
              'Kein Gateway nötig: die Steuerung hängt direkt im Firmennetz.'],
            install: ['Maschine ins Firmennetz (LAN)', 'OPC-UA-Server und umati in der Steuerung aktivieren', 'Zertifikat von werkfluss vertrauen', 'Live-Test'] })));
        break;
      case 'focas':
        if (cur <= 1) opts.push(retrofit());
        opts.push(ctrl('focas', 2, { title: 'Steuerung lesen (Fanuc FOCAS)', sub: 'Zustand, Programm, Spindel, Stückzähler und Alarme über FOCAS2', protocol: 'Fanuc FOCAS',
            effort: 'ca. 30 min', effortShort: 'ca. 30 min', downtime: 'kein Stillstand', intervention: 'Nur lesend – Ethernet-Parameter in der Steuerung setzen',
            pros: ['Stückzahl automatisch (Makro #3901)', 'Alarme mit Nummer und Text', 'Programm, Spindel und Override live'], cons: ['Feste IP-Adresse in der Steuerung nötig'],
            why: [`${sj.controlShort} hat ${sj.year < 2005 ? 'ab Werk eine Embedded-Ethernet-Schnittstelle' : 'Ethernet'} mit FOCAS2 – die Daten sind ohne Zusatzhardware lesbar.`,
              `Ein werkfluss Edge liest die Steuerung zyklisch und puffert bei Netzausfall bis zu 72 h.`,
              'Gegenüber Nachrüst-Sensorik zusätzlich Stückzahl, Programm und Alarme im Klartext.'],
            install: ['IP-Adresse und FOCAS-Port in der Steuerung setzen', `Treiber „FOCAS2“ auf ${gw(2)} aktivieren`, 'Verbindung testen (Ping, FOCAS-Handshake)', 'KI-Vorschlag der Signalzuordnung prüfen'] }),
          ctrl('focas', 3, Object.assign({}, l3, { title: 'FOCAS inkl. Werkzeugdaten', sub: 'Standzeitverwaltung der Steuerung zusätzlich lesen', protocol: 'Fanuc FOCAS (inkl. Werkzeugdaten)',
            effort: cur >= 2 ? 'ca. 15 min Konfiguration' : 'ca. 45 min', effortShort: cur >= 2 ? 'ca. 15 min' : 'ca. 45 min',
            why: l3why(cur >= 2 ? 'Bereits Level 2 über FOCAS – die Standzeitverwaltung der Steuerung ist über dieselbe Verbindung lesbar.' : 'Die Standzeitverwaltung der Fanuc ist über FOCAS lesbar.'),
            install: ['Standzeitverwaltung in der Steuerung prüfen', 'FOCAS-Werkzeugfunktionen freischalten', 'Werkzeugnummern mit werkfluss abgleichen', 'Live-Test'] })));
        break;
      case 'mtconnect':
        opts.push(ctrl('mtconnect', 2, { title: 'MTConnect', sub: 'Zustand, Programm, Spindel und Stückzähler', protocol: 'MTConnect', effort: 'ca. 30 min', effortShort: 'ca. 30 min', downtime: 'kein Stillstand', intervention: 'nur lesend', pros: ['Stückzahl und Alarme automatisch'], cons: [] }),
          ctrl('mtconnect', 3, Object.assign({}, l3, { title: 'MTConnect inkl. Werkzeugdaten', sub: 'Werkzeugnummer und Standzeit über die CuttingTool-Assets', protocol: 'MTConnect (inkl. Werkzeugdaten)',
            effort: 'ca. 15 min Konfiguration', effortShort: 'ca. 15 min',
            why: l3why(`${sj.controlShort} meldet heute schon Zustand, Programm und Stückzähler per MTConnect (Level 2) – Werkzeugnummer und Standzeitzähler kommen über die CuttingTool-Assets dazu.`),
            install: [sj.gateway && /Edge/.test(sj.gateway) ? `MTConnect-Agent auf ${sj.gateway} aktualisieren` : 'MTConnect-Agent der Steuerung aktualisieren', 'Standzeitüberwachung in der Steuerung aktivieren', 'Werkzeugnummern mit werkfluss abgleichen', 'Live-Test'] })));
        break;
      default: opts.push(tablet());
    }
    if (noTools) for (const o of opts) if (o.possible && o.level >= 3) { o.possible = false; o.reason = 'Keine Zerspanwerkzeuge an dieser Station.'; }
    const curFam = famOfProtocol(sj.protocol);
    for (const o of opts) {
      if (!o.possible) continue;
      o.current = !sj.demo && o.level === cur && (o.family === curFam || (cur === 0 && o.family === 'tablet') || o.family === 'calypso');
      o.below = !sj.demo && o.level < cur;
    }
    const list = opts.filter(o => !o.below || o.current);
    const cand = list.filter(o => o.possible && !o.current && o.level > cur);
    const ctrlC = cand.filter(o => o.level >= 2);
    let rec = null;
    if (sj.demo && f.kind === 'umati' && ctrlC.length) rec = ctrlC.reduce((a, b) => b.level > a.level ? b : a);
    else if (ctrlC.length) rec = ctrlC.reduce((a, b) => b.level < a.level ? b : a);
    else if (cand.length) rec = cand.reduce((a, b) => b.level < a.level ? b : a);
    if (rec) rec.rec = true;
    const order = (o) => o.rec ? 0 : o.possible && !o.current ? 1 : o.current ? 2 : 3;
    list.sort((a, b) => order(a) - order(b) || a.level - b.level);
    const max = Math.max(cur, ...list.filter(o => o.possible).map(o => o.level));
    return { facts: f, options: list, rec, max, upgradable: !!rec };
  }

  // =================================================================== Signal-Familien (Rohsignale je Protokoll)
  const SEM = {
    run: { label: 'Maschine läuft (Produktion)', kind: 'bit' }, wait: { label: 'Warten / Rüsten', kind: 'bit' }, fault: { label: 'Störung', kind: 'bit' },
    tightOk: { label: 'Verschraubung i. O.', kind: 'bit' },
    current: { label: 'Laststrom → Zustand', kind: 'num' }, power: { label: 'Wirkleistung / Energie', kind: 'num', multi: true },
    rpm: { label: 'Spindeldrehzahl', kind: 'num' }, load: { label: 'Spindellast', kind: 'num' }, ovr: { label: 'Vorschub-Override', kind: 'num' },
    toolLife: { label: 'Werkzeug-Standzeit', kind: 'num' }, temp: { label: 'Badtemperatur', kind: 'num' }, torque: { label: 'Anzugsmoment', kind: 'num' },
    count: { label: 'Stückzähler', kind: 'int' }, light: { label: 'Signalsäule', kind: 'color' }, mode: { label: 'Betriebsart', kind: 'mode' },
    progState: { label: 'Programmstatus', kind: 'prog' }, prog: { label: 'Programm', kind: 'text' }, alarm: { label: 'Alarm (Code + Text)', kind: 'text' },
    tool: { label: 'Werkzeug in der Spindel', kind: 'text' }, phase: { label: 'Prozessphase', kind: 'text' }, step: { label: 'Montageschritt', kind: 'text' },
    none: { label: 'nicht verwenden', kind: '*' },
  };
  const mc = (x) => x.mode === 'JOG/MDI' ? 'MANUAL' : 'AUTO';
  const pc = (x) => x.mode === 'AUTO' ? 'RUN' : x.mode === 'ALARM' ? 'ABORT' : 'STOP';
  const vNum = (n, unit, dec) => (x) => { const v = n(x); return { sv: v, txt: v == null ? '–' : U.fmtNum(v, dec || 0) + (unit ? ' ' + unit : '') }; };
  const vBit = (fn) => (x) => { const b = fn(x) ? 1 : 0; return { sv: b, txt: String(b) }; };
  const vText = (fn, empty) => (x) => { const v = fn(x); return { sv: v || null, txt: v || (empty || '–') }; };
  const vLight = (x) => ({ sv: x.light, txt: LIGHT_DE[x.light] || '–', c: LIGHT_C[x.light] });
  const vMode = (tbl) => (x) => { const k = mc(x); return { sv: k, txt: tbl[k] }; };
  const vProg = (tbl) => (x) => { const k = pc(x); return { sv: k, txt: tbl[k] }; };
  const R = (id, raw, kind, sem, conf, val, o) => Object.assign({ id, raw, kind, sem, conf, val, lvMin: 2 }, o || {});
  function familyRows(fam, sj, lv) {
    let rows = [];
    switch (fam) {
      case 'retrofit':
        rows = [
          R('ai0', 'AI0 · Stromwandler L1', 'num', 'current', 97, vNum(x => x.ph[0], 'A', 1), { lvMin: 1, note: (x) => `Laststrom · „läuft“ ab ${fA(x.thrA)}` }),
          R('ai1', 'AI1 · Stromwandler L2', 'num', 'power', 94, vNum(x => x.ph[1], 'A', 1), { lvMin: 1, note: () => 'Wirkleistung aus L1–L3 (400 V)' }),
          R('ai2', 'AI2 · Stromwandler L3', 'num', 'power', 94, vNum(x => x.ph[2], 'A', 1), { lvMin: 1, note: () => 'Wirkleistung aus L1–L3 (400 V)' }),
        ];
        if (sj.noLight) rows.push(R('di0', 'DI0 · Hauptschütz K1', 'bit', 'none', 74, vBit(() => true), { lvMin: 1, check: true, note: () => 'Maschine eingeschaltet – für den Zustand nicht nötig' }));
        else rows.push(
          R('di0', 'DI0 · Signalsäule grün', 'bit', 'run', 96, vBit(x => x.light === 'green'), { lvMin: 1, note: () => 'grüne Ader laut Klemmenplan, aktiv mit Laststrom' }),
          R('di1', 'DI1 · Signalsäule gelb', 'bit', 'wait', 91, vBit(x => x.light === 'yellow'), { lvMin: 1, note: () => 'aktiv bei Stillstand mit Auftrag' }),
          R('di2', 'DI2 · Signalsäule rot', 'bit', 'fault', 95, vBit(x => x.light === 'red'), { lvMin: 1, note: () => 'aktiv bei Alarm' }),
          R('di3', 'DI3 · Eingang 4', 'bit', 'none', 62, vBit(() => false), { lvMin: 1, check: true, note: () => 'kein Pegelwechsel beobachtet – vermutlich nicht belegt' }));
        break;
      case 's7':
        rows = [
          R('m', 'DB10.DBX0.0 · Automatik', 'mode', 'mode', 84, vMode({ AUTO: '1 (Automatik)', MANUAL: '0 (Hand)' })),
          R('l', 'A4.0–A4.2 · Signalsäule', 'color', 'light', 92, vLight),
          R('f', 'DB10.DBX0.2 · Sammelstörung', 'bit', 'fault', 90, vBit(x => x.state === 'fault')),
          R('a', 'DB10.DBW4 · Störcode', 'text', 'alarm', 86, vText(x => x.alarm, '0 (keine)')),
          R('c', 'DB10.DBW2 · Schnittzähler', 'int', 'count', 89, vNum(x => x.count)),
          R('p', 'DB20.DBW0 · Schnittprogramm-Nr.', 'text', 'prog', 77, vText(x => x.prog === '–' ? null : 'Nr. ' + x.prog.slice(1, 5)), { check: true, note: () => 'Programmnummer statt Name – bitte bestätigen' }),
          R('r', 'DB12.DBW0 · Bandantrieb (Ist)', 'num', 'rpm', 73, vNum(x => x.rpm, '1/min'), { check: true, note: () => 'vermutlich Antriebsdrehzahl des Sägebands' }),
          R('d', 'DB12.DBW2 · Antriebslast', 'num', 'load', 81, vNum(x => x.load, '%')),
          R('u', 'DB10.DBW8 · unbekannt', 'num', 'none', 58, vNum(() => 0), { check: true, note: () => 'Wert konstant 0 – vermutlich Reserve' }),
        ];
        break;
      case 's7ua':
        rows = [
          R('m', '"DB_Status".Betriebsart', 'mode', 'mode', 95, vMode({ AUTO: 'Automatik', MANUAL: 'Hand' })),
          R('l', '"DB_Status".Signalsaeule', 'color', 'light', 96, vLight),
          R('p', '"DB_Prozess".Programm', 'text', 'prog', 95, vText(x => x.prog === '–' ? null : x.prog)),
          R('ph', '"DB_Prozess".Phase', 'text', 'phase', 93, vText(x => x.cycle && x.cycle !== '–' ? x.cycle : null, 'Bereit')),
          R('t', '"DB_Prozess".Badtemperatur', 'num', 'temp', 98, vNum(x => x.temp, '°C')),
          R('c', '"DB_Zaehler".Teile', 'int', 'count', 89, vNum(x => x.count)),
          R('a', '"DB_Alarm".Meldung', 'text', 'alarm', 96, vText(x => x.alarm, 'keine')),
        ];
        break;
      case 'sinumerik':
        rows = [
          R('m', 'ns=2;s=/Bag/State/opMode', 'mode', 'mode', 94, vMode({ AUTO: '2 (AUTO)', MANUAL: '0 (JOG)' })),
          R('ps', 'ns=2;s=/Channel/State/progStatus', 'prog', 'progState', 92, vProg({ RUN: '3 (aktiv)', STOP: '2 (gestoppt)', ABORT: '5 (abgebrochen)' })),
          R('l', 'ns=2;s=/Plc/QB12 · Signalsäule', 'color', 'light', 86, vLight, { note: () => 'aus dem PLC-Ausgang abgeleitet' }),
          R('p', 'ns=2;s=/Channel/ProgramInfo/progName', 'text', 'prog', 97, vText(x => x.prog === '–' ? null : x.prog)),
          R('c', 'ns=2;s=/Channel/State/actParts', 'int', 'count', 93, vNum(x => x.count)),
          R('r', 'ns=2;s=/Channel/Spindle/actSpeed', 'num', 'rpm', 98, vNum(x => x.rpm, '1/min'), { spindle: true }),
          R('ld', 'ns=2;s=/Channel/Spindle/driveLoad', 'num', 'load', 95, vNum(x => x.load, '%'), { spindle: true }),
          R('o', 'ns=2;s=/Channel/State/feedRateIpoOvr', 'num', 'ovr', 96, vNum(x => x.ovr, '%'), { spindle: true }),
          R('a', 'ns=2;s=/Nck/LastAlarm', 'text', 'alarm', 95, vText(x => x.alarm, 'keiner')),
          R('t', 'ns=2;s=/Channel/State/actTNumber', 'text', 'tool', 94, vText(x => x.tool ? x.tool + ' · ' + x.toolName : null), { lvMin: 3, spindle: true }),
          R('tl', 'ns=2;s=/Tool/Supervision/data', 'num', 'toolLife', 88, vNum(x => x.wearPct, '% verbraucht'), { lvMin: 3, spindle: true }),
        ];
        break;
      case 'umati':
        rows = [
          R('m', 'Monitoring/MachineTool/OperationMode', 'mode', 'mode', 99, vMode({ AUTO: 'AUTOMATIC', MANUAL: 'MANUAL' })),
          R('l', 'Monitoring/Stacklight', 'color', 'light', 99, vLight),
          R('ps', 'Production/ActiveProgram/State', 'prog', 'progState', 99, vProg({ RUN: 'Running', STOP: 'Stopped', ABORT: 'Aborted' })),
          R('p', 'Production/ActiveProgram/Name', 'text', 'prog', 99, vText(x => x.prog === '–' ? null : x.prog)),
          R('c', 'Monitoring/MachineTool/PartsCounter', 'int', 'count', 98, vNum(x => x.count)),
          R('r', 'Monitoring/Spindle/ActualSpeed', 'num', 'rpm', 99, vNum(x => x.rpm, '1/min'), { spindle: true }),
          R('ld', 'Monitoring/Spindle/Load', 'num', 'load', 97, vNum(x => x.load, '%'), { spindle: true }),
          R('o', 'Monitoring/Channel/FeedOverride', 'num', 'ovr', 98, vNum(x => x.ovr, '%'), { spindle: true }),
          R('a', 'Notification/Messages', 'text', 'alarm', 99, vText(x => x.alarm, 'keine')),
          R('t', 'Equipment/Tools/ActiveTool/Identifier', 'text', 'tool', 98, vText(x => x.tool ? x.tool + ' · ' + x.toolName : null), { lvMin: 3, spindle: true }),
          R('tl', 'Equipment/Tools/ActiveTool/ToolLife', 'num', 'toolLife', 97, vNum(x => x.wearPct, '% verbraucht'), { lvMin: 3, spindle: true }),
        ];
        break;
      case 'mtconnect':
        rows = [
          R('m', 'mode · ControllerMode', 'mode', 'mode', 98, vMode({ AUTO: 'AUTOMATIC', MANUAL: 'MANUAL_DATA_INPUT' })),
          R('ps', 'execution · Execution', 'prog', 'progState', 97, vProg({ RUN: 'ACTIVE', STOP: 'READY', ABORT: 'STOPPED' })),
          R('l', 'stack_light · Signalsäule', 'color', 'light', 84, vLight, { note: () => 'Adapter-Erweiterung (PLC-Ausgang)' }),
          R('p', 'program · Program', 'text', 'prog', 98, vText(x => x.prog === '–' ? null : x.prog)),
          R('c', 'part_count · PartCount', 'int', 'count', 96, vNum(x => x.count)),
          R('r', 'Sspeed · SpindleSpeed', 'num', 'rpm', 98, vNum(x => x.rpm, '1/min'), { spindle: true }),
          R('ld', 'Sload · Load', 'num', 'load', 94, vNum(x => x.load, '%'), { spindle: true }),
          R('o', 'Fovr · PathFeedrateOverride', 'num', 'ovr', 96, vNum(x => x.ovr, '%'), { spindle: true }),
          R('a', 'system · Condition', 'text', 'alarm', 95, vText(x => x.alarm ? 'FAULT ' + x.alarm : null, 'NORMAL')),
          R('t', 'Tool_number · ToolNumber', 'text', 'tool', 95, vText(x => x.tool ? x.tool + ' · ' + x.toolName : null), { lvMin: 3, spindle: true }),
          R('tl', 'CuttingTool · ToolLife', 'num', 'toolLife', 90, vNum(x => x.wearPct, '% verbraucht'), { lvMin: 3, spindle: true }),
        ];
        break;
      case 'focas':
        rows = [
          R('m', 'cnc_statinfo · aut', 'mode', 'mode', 95, vMode({ AUTO: 'MEM', MANUAL: 'MDI' })),
          R('ps', 'cnc_statinfo · run', 'prog', 'progState', 95, vProg({ RUN: '3 (STRT)', STOP: '1 (STOP)', ABORT: '0 (RESET)' })),
          R('l', 'PMC Y0010.0–2 · Signalsäule', 'color', 'light', 83, vLight, { note: () => 'Farbbelegung aus dem PMC-Kontaktplan' }),
          R('p', 'cnc_exeprgname', 'text', 'prog', 97, vText(x => x.prog === '–' ? null : x.prog)),
          R('c', 'Makro #3901 · Teilezähler', 'int', 'count', 91, vNum(x => x.count)),
          R('r', 'cnc_acts · Spindel-Istdrehzahl', 'num', 'rpm', 98, vNum(x => x.rpm, '1/min'), { spindle: true }),
          R('ld', 'cnc_rdspmeter · Spindellast', 'num', 'load', 94, vNum(x => x.load, '%'), { spindle: true }),
          R('o', 'PMC G0012 · Override', 'num', 'ovr', 86, vNum(x => x.ovr, '%'), { spindle: true }),
          R('a', 'cnc_rdalmmsg2', 'text', 'alarm', 97, vText(x => x.alarm, 'keiner')),
          R('t', 'cnc_rdtlinfo · aktives Werkzeug', 'text', 'tool', 92, vText(x => x.tool ? x.tool + ' · ' + x.toolName : null), { lvMin: 3, spindle: true }),
          R('tl', 'cnc_rdtlusegrp · Standzeit', 'num', 'toolLife', 89, vNum(x => x.wearPct, '% verbraucht'), { lvMin: 3, spindle: true }),
        ];
        break;
      case 'op':
        rows = [
          R('l', 'Terminal · Status', 'color', 'light', 94, vLight),
          R('st', 'Terminal · Arbeitsschritt', 'text', 'step', 99, vText(x => x.step && x.step !== '–' ? x.step : null, 'kein Auftrag aktiv')),
          R('c', 'Terminal · Baugruppen fertig', 'int', 'count', 97, vNum(x => x.count)),
          R('p', 'Terminal · Montageanweisung', 'text', 'prog', 96, vText(x => x.prog === '–' ? null : x.prog)),
          R('tq', 'MID 0061 · Torque', 'num', 'torque', 98, vNum(x => x.torque, 'Nm', 1)),
          R('ok', 'MID 0061 · TighteningStatus', 'bit', 'tightOk', 96, vBit(x => x.tightOk === 1)),
          R('ps', 'MID 0015 · Parameter Set', 'text', 'none', 71, vText(() => 'PSet 3'), { check: true, note: () => 'Schraubprogramm-Nummer – für werkfluss nicht nötig' }),
          R('a', 'MID 0071 · Alarm', 'text', 'alarm', 92, vText(x => x.alarm, 'keiner')),
        ];
        break;
      default: rows = [];
    }
    const spindle = (RPM[sj.type] || 0) > 0 || (sj.demo && sj.spindle);
    return rows.filter(r => r.lvMin <= lv && (!r.spindle || spindle));
  }
  const semOptions = (row, rows) => {
    const fam = new Set(rows.map(r => r.sem)); fam.add('none');
    return Object.keys(SEM).filter(k => k === 'none' || (fam.has(k) && SEM[k].kind === row.kind));
  };

  // =================================================================== Zustandserkennung aus zugeordneten Signalen
  const CAT = {
    run: { l: 'Produktion', c: 'var(--st-run)' }, fault: { l: 'Störung', c: 'var(--st-fault)' }, setup: { l: 'Rüsten / Werkzeugwechsel', c: 'var(--st-setup)' },
    wait: { l: 'Warten', c: 'var(--st-wait)' }, waitSetup: { l: 'Warten / Rüsten', c: 'var(--st-wait)' }, off: { l: 'Bereit / aus', c: 'var(--st-idle)' }, stand: { l: 'Stillstand', c: 'var(--st-idle)' },
  };
  const expectedCat = (state) => state === 'running' ? 'run' : state === 'fault' ? 'fault' : state === 'idle' ? 'off' : state === 'setup' || state === 'toolchange' ? 'setup' : 'wait';
  const catMatches = (det, exp) => det === exp || (det === 'waitSetup' && (exp === 'wait' || exp === 'setup')) || (det === 'stand' && exp !== 'run');
  function detect(rows, sel, x) {
    const by = {};
    for (const r of rows) { const s = sel[r.id]; if (!s || s === 'none') continue; (by[s] = by[s] || []).push({ r, v: r.val(x) }); }
    const one = (k) => by[k] && by[k][0];
    const nm = (e) => e.r.raw.split(' · ')[0].replace(/^ns=\d;s=/, '');
    const bit = (k) => { const e = one(k); if (!e) return null; const v = e.v.sv; return typeof v === 'number' ? v > 0 : !!v; };
    const al = one('alarm'); if (al && al.v.sv) return { cat: 'fault', why: `Alarm aktiv: ${al.v.txt}` };
    if (bit('fault')) return { cat: 'fault', why: `${nm(one('fault'))} („Störung“) aktiv` };
    const li = one('light'), mo = one('mode'), ps = one('progState');
    const liV = li && typeof li.v.sv === 'string' ? li.v.sv : null;
    if (liV === 'red') return { cat: 'fault', why: 'Signalsäule rot' };
    if (ps && ps.v.sv === 'ABORT') return { cat: 'fault', why: `Programmstatus ${ps.v.txt}` };
    if (mo && mo.v.sv === 'MANUAL') return { cat: 'setup', why: `Betriebsart ${mo.v.txt}` };
    if (liV === 'green') return { cat: 'run', why: 'Signalsäule grün' };
    if (liV === 'yellow') return { cat: mo ? 'wait' : 'waitSetup', why: 'Signalsäule gelb' + (mo ? `, Betriebsart ${mo.v.txt}` : '') };
    if (liV === 'off') return { cat: 'off', why: 'Signalsäule aus' };
    if (bit('run')) return { cat: 'run', why: `${nm(one('run'))} („läuft“) aktiv` };
    if (bit('wait')) return { cat: 'waitSetup', why: `${nm(one('wait'))} („Warten / Rüsten“) aktiv` };
    const hasBits = !!(one('run') || one('wait') || one('fault'));
    const cu = one('current');
    if (cu && typeof cu.v.sv === 'number') {
      const a = cu.v.sv;
      if (a > x.thrA) return { cat: 'run', why: `${hasBits ? 'keine Lampe aktiv, aber ' : ''}Laststrom ${fA(a)} über ${fA(x.thrA)}` };
      return { cat: hasBits ? 'off' : 'stand', why: `${hasBits ? 'keine Signalsäulen-Lampe aktiv · ' : ''}Laststrom ${fA(a)} unter ${fA(x.thrA)}` };
    }
    if (hasBits) return { cat: 'off', why: 'kein Signalsäulen-Eingang aktiv' };
    if (ps) return ps.v.sv === 'RUN' ? { cat: 'run', why: `Programmstatus ${ps.v.txt}` } : { cat: 'stand', why: `Programmstatus ${ps.v.txt}` };
    return { cat: null, why: 'Kein Zustandssignal zugeordnet' };
  }
  function validate(rows, sel, lv) {
    const errs = [], warns = [];
    const used = {};
    for (const r of rows) { const s = sel[r.id]; if (s && s !== 'none') (used[s] = used[s] || []).push(r); }
    for (const k in used) if (!SEM[k].multi && used[k].length > 1) errs.push(`„${SEM[k].label}“ ist mehrfach zugeordnet (${used[k].map(r => r.raw.split(' · ')[0].replace(/^ns=\d;s=/, '')).join(', ')}).`);
    if (!['run', 'current', 'light', 'progState'].some(k => used[k])) errs.push('Für den Maschinenzustand fehlt ein Signal („Maschine läuft“, „Laststrom“, „Signalsäule“ oder „Programmstatus“).');
    const has = (k) => rows.some(r => r.sem === k);
    if (lv >= 2 && has('count') && !used.count) errs.push('„Stückzähler“ ist nicht zugeordnet – Level 2 liefert die Stückzahl aus der Steuerung.');
    if (lv >= 3 && has('tool') && !used.tool) errs.push('„Werkzeug in der Spindel“ ist nicht zugeordnet – nötig für Level 3.');
    if ((has('fault') || has('alarm')) && !used.fault && !used.alarm) warns.push('Ohne „Störung“ bzw. „Alarm“ erkennt werkfluss Störungen nur indirekt.');
    if (has('power') && !used.power && !used.current) warns.push('Ohne Stromkanäle wird die Energie weiter geschätzt.');
    return { errs, warns, ok: errs.length === 0 };
  }

  // =================================================================== Demo-Maschinen („Neue Maschine hinzufügen“)
  const DEMOS = {
    hermle: { key: 'hermle', vendor: 'Hermle', model: 'C 32 U', year: 2024, control: 'Heidenhain TNC7', type: 'mill5', name: '5-Achs-Bearbeitungszentrum', short: 'Hermle C 32 U',
      area: 'Fräserei (geplant)', loading: 'auto', rate: 130, power: { idle: 5, run: 24 }, facts: { kind: 'umati', iface: 'Ethernet ab Werk · OPC UA (umati) in der TNC7' }, demoGw: 'direkt (Steuerung)', spindle: true,
      tag: 'Neumaschine', plate: { brand: 'HERMLE', sub: 'Maschinenfabrik', serial: 'C32-41187', supply: '3~ 400 V 50 Hz', amp: '63 A', kg: '9.800 kg', country: 'Made in Germany', band: '#b3121d', ink: '#ffffff', paint: '#cfd3d7', line: 'BEARBEITUNGSZENTRUM · MACHINING CENTRE', ce: true },
      script: { prog: 'WARMLAUF_SPINDEL.H', rpmSteps: [2000, 6000, 10000, 14000], label: 'Warmlaufprogramm (Inbetriebnahme)' } },
    mori: { key: 'mori', vendor: 'Mori Seiki', model: 'SL-25Y', year: 1999, control: 'Fanuc 18i-TB', type: 'lathe', name: 'CNC-Drehmaschine (gebraucht)', short: 'Mori Seiki SL-25Y',
      area: 'Dreherei (geplant)', loading: 'perPart', rate: 85, power: { idle: 3, run: 18 }, facts: { kind: 'focas', iface: 'Fanuc 18i-TB · Embedded Ethernet mit FOCAS2' }, demoGw: 'werkfluss Edge 01', spindle: true,
      tag: 'Gebrauchtmaschine', plate: { brand: 'MORI SEIKI', sub: 'CO., LTD.', serial: 'SL25Y-1532', supply: '3~ 400 V 50 Hz', amp: '38 A', kg: '5.300 kg', country: 'Made in Japan', band: '#1f4f99', ink: '#ffffff', paint: '#d7d2c0', line: 'CNC-DREHMASCHINE · CNC LATHE', ce: true },
      script: { prog: 'O9001 (WARMLAUF)', rpmSteps: [500, 1500, 3000], label: 'Warmlaufprogramm (Probelauf)' } },
    weiler: { key: 'weiler', vendor: 'Weiler', model: 'Praktikant VC', year: 1988, control: 'konventionell (ohne CNC)', type: 'lathe', name: 'Konventionelle Drehmaschine', short: 'Weiler Praktikant',
      area: 'Lehrwerkstatt', loading: 'attended', rate: 45, power: { idle: 0.6, run: 4.5 }, facts: { kind: 'none', iface: 'Keine Steuerung, keine Schnittstelle' }, demoGw: 'werkfluss Edge 03', noLight: true, spindle: false,
      tag: 'Altmaschine', plate: { brand: 'WEILER', sub: 'Werkzeugmaschinen', serial: '4-1163', supply: '3~ 380 V 50 Hz', amp: '11 A', kg: '1.250 kg', country: 'Made in W.-Germany', band: '#2c5a3c', ink: '#f3efe2', paint: '#66806b', line: 'DREHMASCHINE · LATHE', ce: false },
      script: { label: 'Bediener dreht (Probelauf)', cycle: [9, 5] } },
  };
  function demoCtx(d) {
    const tr = (performance.now() - (WZ ? WZ.t0 : 0)) / 1000;
    const T = Math.floor(tr / 2) * 2;
    const nz = hnoise(T, 77), p = d.power;
    const sc = d.script;
    let cutting = true, rpm = 0;
    if (sc.cycle) { const per = sc.cycle[0] + sc.cycle[1]; cutting = (T % per) < sc.cycle[0]; }
    else rpm = sc.rpmSteps[Math.floor(T / 6) % sc.rpmSteps.length];
    const kw = Math.round((cutting ? (sc.cycle ? p.run : p.idle + (p.run - p.idle) * (0.18 + 0.5 * rpm / 15000)) : p.idle) * (1 + 0.03 * nz) * 10) / 10;
    const amps = ampsOf(kw);
    return {
      demo: true, T, type: d.type, state: cutting ? 'running' : 'waitOperator', cutting, light: cutting ? 'green' : 'yellow', kw, amps,
      ph: [0, 1, 2].map(k => Math.round(amps * (1 + 0.014 * hnoise(T, 300 + k)) * 10) / 10), thrA: ampsOf(p.idle * 1.25),
      mode: cutting ? 'AUTO' : 'STOP', spindle: d.spindle, rpm: d.spindle ? Math.round(rpm * (1 + 0.01 * nz)) : null, load: d.spindle ? Math.round(6 + 4 * nz + rpm / 2500) : null, ovr: d.spindle ? 100 : null,
      prog: sc.prog || '–', count: 0, total: 0, tool: null, toolName: null, wearPct: null, alarm: null, coolant: false, runtime: null,
      cause: cutting ? sc.label : 'Bediener misst am Werkstück',
    };
  }

  // =================================================================== Typenschild (Canvas, Fotostil)
  const PLATES = {
    Okamoto: { brand: 'OKAMOTO', sub: 'MACHINE TOOL WORKS, LTD.', country: 'Made in Japan', band: '#1d3a6e', ink: '#ffffff', paint: '#c6ccc2' },
    Behringer: { brand: 'BEHRINGER', sub: 'Sägetechnik', country: 'Made in Germany', band: '#c8102e', ink: '#ffffff', paint: '#d9d9d5' },
    INDEX: { brand: 'INDEX', sub: 'Werkzeugmaschinen', country: 'Made in Germany', band: '#0b4ea2', ink: '#ffffff', paint: '#e6e8eb' },
    Citizen: { brand: 'CITIZEN', sub: 'MACHINERY', country: 'Made in Japan', band: '#00468b', ink: '#ffffff', paint: '#e4e5e1' },
    'WFL Millturn': { brand: 'WFL', sub: 'Millturn Technologies', country: 'Made in Austria', band: '#1f2f4f', ink: '#ffffff', paint: '#474d55' },
    Tiefbohrtechnik: { brand: 'TIEFBOHRTECHNIK', sub: 'Tieflochbohrmaschinen', country: 'Made in Germany', band: '#24507a', ink: '#ffffff', paint: '#7d8f74' },
    Liebherr: { brand: 'LIEBHERR', sub: 'Verzahntechnik', country: 'Made in Germany', band: '#f2c400', ink: '#1b1b1b', paint: '#d6d6d0' },
    'DMG MORI': { brand: 'DMG MORI', sub: '', country: 'Made in Germany', band: '#2b3a4a', ink: '#ffffff', paint: '#41474f' },
    Haas: { brand: 'HAAS', sub: 'Automation, Inc.', country: 'Made in USA', band: '#b5121b', ink: '#ffffff', paint: '#d8dadc' },
    Studer: { brand: 'STUDER', sub: 'Schleifmaschinen', country: 'Made in Switzerland', band: '#1b4f9c', ink: '#ffffff', paint: '#e3e4e0' },
    Reinigungstechnik: { brand: 'REINIGUNGSTECHNIK', sub: 'Industrielle Teilereinigung', country: 'Made in Germany', band: '#2f6f4f', ink: '#ffffff', paint: '#cfd5d8' },
    ZEISS: { brand: 'ZEISS', sub: 'Industrial Quality', country: 'Made in Germany', band: '#0f3d8a', ink: '#ffffff', paint: '#dfe2e6' },
  };
  const LINE_DE = { saw: 'BANDSÄGEAUTOMAT · BAND SAW', lathe: 'CNC-DREHMASCHINE · CNC LATHE', swiss: 'LANGDREHAUTOMAT · SWISS-TYPE LATHE', biglathe: 'DREHMASCHINE · TURNING CENTRE',
    mill5: 'BEARBEITUNGSZENTRUM · MACHINING CENTRE', mill3: 'BEARBEITUNGSZENTRUM · MACHINING CENTRE', deephole: 'TIEFBOHRMASCHINE · DEEP HOLE DRILLING', hobber: 'WÄLZFRÄSMASCHINE · GEAR HOBBING',
    cylgrinder: 'RUNDSCHLEIFMASCHINE · CYLINDRICAL GRINDER', surfgrinder: 'FLACHSCHLEIFMASCHINE · SURFACE GRINDER', washer: 'REINIGUNGSANLAGE · CLEANING SYSTEM', cmm: 'KOORDINATENMESSGERÄT · CMM' };
  const ctrlShort = (c) => String(c || '').replace(/\s*\((Bj\.|Citizen)[^)]*\)/, '').replace(/^Siemens\s+/, '').trim();
  function plateFor(sj) {
    if (sj.demo) return Object.assign({ model: sj.model, year: sj.year, control: sj.year >= 2000 ? sj.control : '—' }, sj.plate);
    const base = PLATES[sj.vendor]; if (!base) return null;
    const st = ST(sj.id), h = parseInt(U.hash(sj.id + sj.model), 16);
    const kw = (st.power && st.power.run) || 10;
    const amp = Math.max(6, Math.round(kw * 1000 / (1.732 * 400 * 0.85) * 1.25));
    const kg = { saw: 1900, lathe: 6800, swiss: 2400, biglathe: 38000, mill5: 7400, mill3: 4100, deephole: 14500, hobber: 6200, cylgrinder: 5200, surfgrinder: 2900, washer: 1800, cmm: 2600 }[sj.type] || 3000;
    return Object.assign({}, base, { model: sj.model, year: sj.year, serial: (sj.model.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'M') + '-' + String(1000 + h % 8999),
      control: sj.year >= 2005 ? ctrlShort(sj.control) : '—', supply: '3~ 400 V 50 Hz', amp: amp + ' A', kg: U.fmtNum(kg) + ' kg', line: LINE_DE[sj.type] || 'WERKZEUGMASCHINE · MACHINE TOOL', ce: sj.year >= 1995 });
  }
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16), f = pct / 100;
    const ch = (v) => Math.round(Math.max(0, Math.min(255, f >= 0 ? v + (255 - v) * f : v * (1 + f))));
    return 'rgb(' + ch(n >> 16) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) + ')';
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  /** Zeichnet ein Typenschild als „Foto“ (Lackfläche, gebürstetes Alu, Nieten, Gravur, Licht) und liefert die OCR-Felder in %. */
  function drawPlate(cv, p) {
    const W = 600, H = 360, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); if (!g) return [];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = U.rng(parseInt(U.hash(p.serial + p.model), 16) || 7);
    const bg = g.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, shade(p.paint, 14)); bg.addColorStop(0.55, p.paint); bg.addColorStop(1, shade(p.paint, -22));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2200; i++) { g.fillStyle = rnd.next() < 0.5 ? 'rgba(0,0,0,' + (rnd.next() * 0.06).toFixed(3) + ')' : 'rgba(255,255,255,' + (rnd.next() * 0.06).toFixed(3) + ')'; g.fillRect(rnd.next() * W, rnd.next() * H, 1.3, 1.3); }
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 24); g.lineTo(W, 17); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0, 26); g.lineTo(W, 19); g.stroke();
    // Schraube der Verkleidung
    const screw = (x, y) => { const sg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7); sg.addColorStop(0, '#f3f3f3'); sg.addColorStop(1, '#6a6d70'); g.fillStyle = sg; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.stroke(); };
    screw(28, 52); screw(W - 28, 46);
    const px = 72, py = 50, pw = 456, ph = 268;
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16; g.shadowOffsetY = 7;
    rrect(g, px, py, pw, ph, 10); const al = g.createLinearGradient(px, py, px + pw, py + ph);
    al.addColorStop(0, '#e9ecef'); al.addColorStop(0.45, '#c6cbd0'); al.addColorStop(0.7, '#dde1e5'); al.addColorStop(1, '#b4b9bf');
    g.fillStyle = al; g.fill(); g.restore();
    g.save(); rrect(g, px, py, pw, ph, 10); g.clip();
    for (let i = 0; i < 260; i++) { const y = py + rnd.next() * ph; g.strokeStyle = rnd.next() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.07)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(px, y); g.lineTo(px + pw, y + (rnd.next() - 0.5) * 2); g.stroke(); }
    // Kopfband
    g.fillStyle = p.band; rrect(g, px + 30, py + 14, pw - 60, 56, 5); g.fill();
    g.fillStyle = p.ink; g.textBaseline = 'alphabetic';
    let bs = 34; g.font = `700 ${bs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    try { g.letterSpacing = '2px'; } catch (e) { /* älterer Browser */ }
    let bw = g.measureText(p.brand).width;
    while (bw > pw - 210 && bs > 20) { bs -= 2; g.font = `700 ${bs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`; bw = g.measureText(p.brand).width; }
    g.fillText(p.brand, px + 46, py + 54);
    try { g.letterSpacing = '0px'; } catch (e) { /* älterer Browser */ }
    g.font = '600 11px Barlow, Arial, sans-serif'; g.textAlign = 'right'; g.globalAlpha = 0.85;
    g.fillText(p.sub || '', px + pw - 46, py + 49); g.globalAlpha = 1; g.textAlign = 'left';
    g.fillStyle = '#3a3f45'; g.font = '600 10.5px Barlow, Arial, sans-serif';
    try { g.letterSpacing = '1.4px'; } catch (e) { /* älterer Browser */ }
    g.fillText(p.line || '', px + 32, py + 92);
    try { g.letterSpacing = '0px'; } catch (e) { /* älterer Browser */ }
    const boxes = [{ k: 'brand', x: px + 38, y: py + 18, w: Math.min(bw + 18, pw - 120), h: 48 }];
    const field = (k, lab, val, x, y, w) => {
      g.fillStyle = '#4a5057'; g.font = '600 9.5px Barlow, Arial, sans-serif'; g.fillText(lab, x, y);
      g.fillStyle = 'rgba(0,0,0,.07)'; rrect(g, x, y + 5, w, 26, 3); g.fill(); g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(x + 2, y + 31.5); g.lineTo(x + w - 2, y + 31.5); g.stroke();
      g.fillStyle = '#15181c'; g.font = '700 15px "JetBrains Mono", Consolas, monospace'; g.fillText(val, x + 9, y + 23.5);
      if (k) boxes.push({ k, x: x - 3, y: y + 2, w: w + 6, h: 32 });
    };
    const c1 = px + 32, c2 = px + 240, cw = 184;
    field('model', 'Typ / Type', p.model, c1, py + 114, cw);
    field('year', 'Baujahr / Year', String(p.year), c2, py + 114, cw);
    field('serial', 'Masch.-Nr. / Serial No.', p.serial, c1, py + 158, cw);
    field(p.control && p.control !== '—' ? 'control' : null, 'Steuerung / Control', p.control || '—', c2, py + 158, cw);
    field(null, 'Anschluss / Supply', p.supply, c1, py + 202, cw);
    field(null, 'Nennstrom · Gewicht / Current · Weight', p.amp + '  ·  ' + p.kg, c2, py + 202, cw);
    g.fillStyle = '#2f343a'; g.font = '600 10px Barlow, Arial, sans-serif'; g.fillText(p.country, c1, py + ph - 14);
    if (p.ce) { g.font = '700 21px Arial, sans-serif'; g.fillText('CE', px + pw - 70, py + ph - 12); }
    for (let i = 0; i < 9; i++) { g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 0.8; const sx = px + rnd.next() * pw, sy = py + 70 + rnd.next() * (ph - 80); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 20 + rnd.next() * 50, sy + (rnd.next() - 0.5) * 8); g.stroke(); }
    g.restore();
    const rivet = (x, y) => { const rg = g.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 6); rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#b9bec3'); rg.addColorStop(1, '#5d6268'); g.fillStyle = rg; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill(); };
    rivet(px + 15, py + 15); rivet(px + pw - 15, py + 15); rivet(px + 15, py + ph - 15); rivet(px + pw - 15, py + ph - 15);
    rrect(g, px, py, pw, ph, 10); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
    // Licht + Vignette (Foto)
    const sp = g.createLinearGradient(0, 0, W, H); sp.addColorStop(0.15, 'rgba(255,255,255,0)'); sp.addColorStop(0.35, 'rgba(255,255,255,.20)'); sp.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = sp; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.66); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    return boxes.map(b => ({ k: b.k, x: b.x / W * 100, y: b.y / H * 100, w: b.w / W * 100, h: b.h / H * 100 }));
  }
  const OCR_LBL = { brand: 'Hersteller', model: 'Typ', year: 'Baujahr', serial: 'Nr.', control: 'Steuerung' };
  const OCR_CONF = { brand: 98, model: 96, year: 94, serial: 99, control: 91 };

  // =================================================================== Modulzustand
  let root = null, ovEl = null, wzEl = null, ro = null, lastW = 0;
  let ovSig = '', filter = 'all', ovRefs = null, flowRefs = null, ovScroll = 0;
  let WZ = null, wzSig = {}, wzRefs = {};

  // =================================================================== Übersicht
  function counts() {
    const c = [0, 0, 0, 0];
    for (const id of IDS()) c[Math.min(3, lvOf(id))]++;
    return c;
  }
  function subjectOf(id) {
    const st = ST(id), m = S().machines[id];
    return { id, demo: false, st, vendor: st.vendor, model: st.model, year: st.year, control: st.control, controlShort: ctrlShort(st.control), type: st.type, name: st.name, short: st.short, area: st.area,
      loading: st.loading, rate: st.rate, cur: m.conn.level || 0, protocol: m.conn.protocol, gateway: m.conn.gateway, kind: st.kind };
  }
  function subjectDemo(key) {
    const d = DEMOS[key];
    return Object.assign({ id: 'NEU-' + key, demo: true, cur: 0, protocol: 'nicht angebunden', gateway: '–', controlShort: ctrlShort(d.control), kind: 'machine' }, d);
  }
  const analysisCache = {};
  function analysisOf(id) {
    const m = S().machines[id], k = id + '|' + m.conn.level + '|' + m.conn.protocol + '|' + m.conn.gateway + '|' + edgeKeys().join(',') + '|' + Math.floor(nowT() / 300);
    const c = analysisCache[id];
    if (c && c.k === k) return c.a;
    const a = analyze(subjectOf(id));
    analysisCache[id] = { k, a };
    return a;
  }
  function structSig() {
    return IDS().map(id => { const c = S().machines[id].conn; return id + c.level + c.protocol + c.gateway + (c.connectedT || ''); }).join('|') + '#' + filter;
  }
  function renderOverview() {
    const c = counts(), total = IDS().length, conn = total - c[0];
    const groups = gatewayGroups();
    const l0 = IDS().filter(id => lvOf(id) === 0);
    const edges = groups.filter(g => g.kind === 'edge');
    const direct = groups.filter(g => g.kind === 'direct').reduce((a, g) => a + g.ids.length, 0);
    const up = IDS().filter(id => analysisOf(id).upgradable);
    const optimal = total - up.length;
    const list = IDS().filter(id => filter === 'all' ? true : filter === 'up' ? analysisOf(id).upgradable : !analysisOf(id).upgradable);
    const legend = [3, 2, 1, 0].map(l => `<span style="--c:${lvVar(l)}" title="${esc(LV[l].name)}"><i></i>L${l} ${esc(LV[l].short.replace('+ ', ''))}</span>`).join('');
    const seg = [3, 2, 1, 0].filter(l => c[l] > 0).map(l => `<i style="--c:${lvVar(l)};flex:${c[l]}" title="Level ${l} · ${esc(LV[l].name)}: ${c[l]} ${c[l] === 1 ? 'Station' : 'Stationen'}">${c[l]}</i>`).join('');
    const byYear = IDS().map(id => ST(id)).filter(s => s.kind === 'machine').sort((a, b) => a.year - b.year);
    const oldest = byYear[0], newest = byYear[byYear.length - 1];
    ovEl.innerHTML = `
      <div class="view-h">
        <div><h1 class="view-t">Anbindung</h1>
          <p class="view-sub">Jede Maschine wird digital – von der ${esc(oldest.short)} aus ${oldest.year} ohne Netzwerk bis zur ${esc(newest.short)} (${newest.year}) mit OPC UA. Ohne Eingriff in alte Steuerungen, in Minuten statt Monaten.</p></div>
        <div class="cn-acts">
          ${l0.length ? `<button class="btn" data-act="wz-open" data-id="${esc(l0[0])}">${icon('plug', 15)}${esc(ST(l0[0]).short)} anbinden</button>` : ''}
          <button class="btn primary" data-act="wz-new">${icon('camera', 15)}Neue Maschine hinzufügen</button>
        </div>
      </div>
      <div class="card cn-hero">
        <div>
          <div class="eyebrow">Digital angebunden</div>
          <div class="cn-big"><b data-k="h-conn">${conn}</b><span>von ${total} Stationen liefern Daten automatisch</span></div>
          <div class="cn-seg">${seg}</div>
          <div class="cn-leg">${legend}</div>
        </div>
        <div class="cn-stat"><div class="eyebrow">Datenpunkte</div><div class="v"><span data-k="h-dp">–</span><small>/ min</small></div><div class="s" data-k="h-dps">–</div></div>
        <div class="cn-stat"><div class="eyebrow">Edge-Gateways</div><div class="v"><span>${edges.length}/${edges.length}</span><small>online</small></div><div class="s"><span data-k="h-gw">–</span>${direct ? ` · ${direct} Stationen direkt im Firmennetz` : ''}</div></div>
        <div class="cn-stat"><div class="eyebrow">Tablet-Rückmeldung</div><div class="v"><span>${l0.length}</span><small>${l0.length === 1 ? 'Station' : 'Stationen'}</small></div>
          <div class="s">${l0.length ? esc(l0.map(id => ST(id).short).join(', ')) + ' – Zustand nur so aktuell wie die letzte Meldung' : 'Alle Stationen melden automatisch.'}</div>
          ${l0.length ? '<div class="s" data-k="h-loss"></div>' : ''}
          ${l0.length ? `<button class="link" data-act="wz-open" data-id="${esc(l0[0])}">Jetzt anbinden ${icon('arrowRight', 13)}</button>` : ''}</div>
      </div>
      <div class="cn-rowA">
        <div class="card">
          <div class="card-h"><h3>Datenfluss: Maschine → Gateway → werkfluss</h3><span class="cn-live"><i></i>live<span class="cn-hs"> · 5-s-Raster</span></span></div>
          <div class="cn-flow" data-k="flow"></div>
          <div class="cn-flow-f"><span><i class="ln"></i>automatisch (Steuerung / Sensorik)</span><span><i class="ln d"></i>manuell (Tablet)</span><span><i class="pk"></i>Datenpaket</span><span><span class="cn-dot" style="--c:var(--st-run)"></span>Punkt = Maschinenzustand</span></div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Was jede Stufe in werkfluss freischaltet</h3></div>
          <div class="card-b">${matrixHtml(c)}</div>
        </div>
      </div>
      <div class="card cn-sec">
        <div class="card-h"><h3>Maschinen &amp; Stationen</h3>
          <div class="cn-filter"><div class="seg" role="tablist">
            <button data-act="filter" data-f="all" class="${filter === 'all' ? 'on' : ''}">Alle ${total}</button>
            <button data-act="filter" data-f="up" class="${filter === 'up' ? 'on' : ''}">Ausbaufähig ${up.length}</button>
            <button data-act="filter" data-f="max" class="${filter === 'max' ? 'on' : ''}">Optimal ${optimal}</button></div></div></div>
        <div class="cn-list">
          <div class="cn-lh"><span>Maschine</span><span class="cn-c-year">Baujahr</span><span class="cn-c-ctrl">Steuerung</span><span>Protokoll · Gateway</span><span>Level</span><span>Live-Daten</span><span class="cn-c-ago">Letzte Meldung</span><span></span></div>
          ${list.map(rowHtml).join('') || '<div class="empty">Keine Station in dieser Auswahl.</div>'}
        </div>
      </div>
      <div class="card cn-sec cn-newc">
        <div>
          <div class="eyebrow">Neue Maschine</div>
          <h3>Von der Anlieferung zur Live-Kennzahl in unter einer Stunde</h3>
          <p>Typenschild fotografieren – werkfluss erkennt Hersteller, Modell und Baujahr, schlägt den passenden Anbindungsweg vor und ordnet die Signale zu. Kein IT-Projekt, kein Eingriff in die Steuerung.</p>
          <button class="btn primary" data-act="wz-new">${icon('camera', 15)}Neue Maschine anbinden</button>
        </div>
        <ol class="cn-proc">
          <li><span class="ic">${icon('camera', 18)}</span><em>SCHRITT 1</em><b>Typenschild fotografieren</b><span>KI liest Hersteller, Modell, Baujahr</span></li>
          <li><span class="ic">${icon('sparkles', 18)}</span><em>SCHRITT 2</em><b>Anbindungsweg</b><span>Empfehlung mit Begründung und Aufwand</span></li>
          <li><span class="ic">${icon('plug', 18)}</span><em>SCHRITT 3</em><b>Signale zuordnen</b><span>KI ordnet Rohsignale der Bedeutung zu</span></li>
          <li><span class="ic">${icon('gauge', 18)}</span><em>SCHRITT 4</em><b>Live-Test</b><span>Erkannter Zustand gegen die Realität</span></li>
          <li><span class="ic">${icon('check', 18)}</span><em>SCHRITT 5</em><b>Fertig</b><span>Leitstand, Analyse und Copilot nutzen die Daten</span></li>
        </ol>
      </div>`;
    ovRefs = { rows: {} };
    ovEl.querySelectorAll('[data-k]').forEach(e => { ovRefs[e.dataset.k] = e; });
    ovEl.querySelectorAll('.cn-lr').forEach(r => {
      const id = r.dataset.id, q = (k) => r.querySelector(`[data-r="${k}"]`);
      ovRefs.rows[id] = { el: r, dot: q('dot'), l1: q('l1'), l2: q('l2'), sl: q('sl'), ago: q('ago'), agoDot: q('agoDot'), mago: q('mago') };
    });
    renderFlow(true);
  }
  function matrixHtml(c) {
    const cell = (v, l) => v === 'auto' ? `<span class="cn-ck" style="--c:${lvVar(Math.max(1, l))}">${icon('check', 12)}</span>` : v ? `<span class="cn-mn">${esc(v)}</span>` : '<span class="cn-no">–</span>';
    return `<div class="tbl-wrap"><table class="cn-mx"><thead><tr><th class="l"></th>${LV.map(L => `<th>${lvBadge(L.l)}<span class="t">${esc(L.short)}</span></th>`).join('')}</tr></thead>
      <tbody>${CAPS.map(cp => `<tr><td class="l" title="${esc(cp.d)}">${esc(cp.label)}</td>${cp.v.map((v, l) => `<td>${cell(v, l)}</td>`).join('')}</tr>`).join('')}
      <tr class="f"><td class="l">Aufwand</td>${LV.map(L => `<td>${esc(L.effort)}</td>`).join('')}</tr>
      <tr class="f"><td class="l">Stationen heute</td>${LV.map(L => `<td><b>${c[L.l]}</b></td>`).join('')}</tr></tbody></table></div>
      ${roadmapHtml()}`;
  }
  /** Empfohlener Ausbau: niedrigste Stufe zuerst, bei Gleichstand höchster Maschinenstundensatz */
  function roadmapHtml() {
    const items = IDS().map(id => ({ id, a: analysisOf(id), lv: lvOf(id), rate: ST(id).rate || 0 }))
      .filter(x => x.a.upgradable).sort((a, b) => a.lv - b.lv || b.rate - a.rate).slice(0, 3);
    if (!items.length) return `<div class="cn-road"><div class="cn-road-h"><span class="eyebrow">Empfohlener Ausbau</span></div><div class="cn-road-e">${icon('check', 15)}Alle Stationen sind optimal angebunden.</div></div>`;
    return `<div class="cn-road"><div class="cn-road-h"><span class="eyebrow">Empfohlener Ausbau</span><span class="muted">größter Nutzen zuerst</span></div>
      ${items.map(x => `<button class="cn-road-r" data-act="wz-open" data-id="${esc(x.id)}">
        <span class="lv">${lvBadge(x.lv)}${icon('arrowRight', 12)}${lvBadge(x.a.rec.level)}</span>
        <span class="t"><b>${esc(ST(x.id).short)}</b><span>${esc(x.a.rec.title)} · ${esc(x.a.rec.effortShort || x.a.rec.effort)}</span></span>
        ${icon('chevron', 15)}</button>`).join('')}</div>`;
  }
  function rowHtml(id) {
    const st = ST(id), m = S().machines[id], c = m.conn, lv = c.level || 0, a = analysisOf(id);
    const isNew = c.connectedT != null && nowT() - c.connectedT < 6 * 3600;
    const btn = a.upgradable
      ? `<button class="btn sm${lv === 0 ? ' primary' : ''}" data-act="wz-open" data-id="${esc(id)}">${icon('plug', 14)}${lv === 0 ? 'Anbinden' : 'Verbessern'}</button>`
      : `<span class="cn-opt-ok">${icon('check', 14)}Optimal angebunden</span>`;
    const gwT = lv === 0 ? 'manuell' : /direkt/i.test(c.gateway) ? 'direkt an werkfluss' : c.gateway;
    return `<div class="cn-lr${isNew && nowT() - c.connectedT < 120 ? ' fresh' : ''}" data-act="sel" data-id="${esc(id)}" role="button" tabindex="0" title="Details zu ${esc(st.short)} öffnen">
      <div class="cn-mc cn-c-m"><span class="cn-dot" data-r="dot" style="--c:${stColor(m.state)}" title="${esc(stLabel(m.state))}"></span><div><div><b>${esc(st.short)}</b><span class="mono">${esc(id)}</span>${isNew ? '<span class="cn-new">neu</span>' : ''}</div><div class="cn-sub">${esc(st.name)}</div></div></div>
      <div class="cn-cell cn-c-d"><div class="t2">${esc(st.vendor !== '–' ? st.vendor + ' ' + st.model : st.model)} · Bj. ${esc(st.year)} · ${esc(ctrlShort(st.control))}</div></div>
      <div class="cn-cell cn-c-year num">${esc(st.year)}</div>
      <div class="cn-cell cn-c-ctrl"><div class="t1" title="${esc(st.control)}">${esc(ctrlShort(st.control))}</div><div class="t2">${esc(st.vendor !== '–' ? st.vendor + ' ' + st.model : st.model)}</div></div>
      <div class="cn-cell cn-c-proto"><div class="t1" title="${esc(c.protocol)}">${esc(lv === 0 ? 'Tablet-Rückmeldung' : c.protocol)}</div><div class="t2">${esc(gwT)}${isNew ? ' · seit ' + esc(U.fmtClock(c.connectedT)) : ''}</div></div>
      <div class="cn-c-lv">${lvBadge(lv)}</div>
      <div class="cn-cell cn-c-live"><div class="cn-livec">${lv === 0 ? '<span class="cn-tab" title="Tablet"></span>' : '<span class="cn-sl" data-r="sl"><i></i><i></i><i></i></span>'}<div><div class="t1" data-r="l1">–</div><div class="t2" data-r="l2">–</div></div><span class="cn-ago m-ago" data-r="mago"></span></div></div>
      <div class="cn-c-ago"><span class="cn-ago" data-r="ago"><i data-r="agoDot"></i><span>–</span></span></div>
      <div class="cn-c-act">${btn}</div>
    </div>`;
  }
  function liveOf(id) {
    const m = S().machines[id], st = ST(id), lv = m.conn.level || 0, sg = m.signals || {};
    if (lv === 0) {
      const age = sg.lastFeedbackT != null ? nowT() - sg.lastFeedbackT : null;
      return { l1: `Tablet: „${esc(sg.lastFeedback || stLabel(m.state))}“`, l2: 'Zustand aus Rückmeldung und Planung', age, old: age != null && age > 600, light: null, t: sg.lastFeedbackT };
    }
    const age = msgAge(id);
    const prog = sg.program && sg.program !== '–' ? sg.program : 'kein Programm aktiv';
    let l1, l2;
    if (lv === 1) { l1 = `${U.fmtNum(sg.powerKw, 1)} kW · ${U.fmtNum(sg.currentA, 1)} A`; l2 = `Signalsäule ${LIGHT_DE[sg.stackLight] || '–'} · Laufzeit heute ${U.fmtDur(sg.runtimeTodaySec)}`; }
    else if (st.type === 'cmm') { l1 = `${MODE_DE[sg.mode] || sg.mode} · Taster ${sg.probe || '–'}${sg.feature ? ' · ' + sg.feature : ''}`; l2 = `${prog} · Zähler ${U.fmtNum(sg.partCounter)}`; }
    else if (st.type === 'washer') { l1 = `${MODE_DE[sg.mode] || sg.mode} · ${U.fmtNum(sg.bathTempC)} °C · ${sg.cycle && sg.cycle !== '–' ? sg.cycle : 'bereit'}`; l2 = `${prog} · Zähler ${U.fmtNum(sg.partCounter)}`; }
    else if (st.type === 'assembly') { l1 = `${sg.terminalStep && sg.terminalStep !== '–' ? 'Montage ' + sg.terminalStep : 'kein Montageschritt aktiv'}`; l2 = `${prog} · Zähler ${U.fmtNum(sg.partCounter)}`; }
    else {
      const loading = m.state === 'running' && m.part && m.part.sub === 'load';
      l1 = sg.spindleRpm > 0 ? `${MODE_DE[sg.mode] || sg.mode} · ${U.fmtNum(sg.spindleRpm)} 1/min · Last ${U.fmtNum(sg.spindleLoadPct)} %` : `${MODE_DE[sg.mode] || sg.mode}${loading ? ' · Teil wird eingelegt' : ''} · Spindel steht`;
      l2 = `${prog}${sg.program && sg.program !== '–' ? ' · Zähler ' + U.fmtNum(sg.partCounter) : ''}${lv >= 3 && sg.toolInSpindleName ? ' · ' + sg.toolInSpindleName : ''}`;
    }
    if (sg.alarm) l1 = `Alarm ${sg.alarm}`;
    return { l1: esc(l1), l2: esc(l2), age, old: false, light: sg.stackLight, t: sg.t, alarm: !!sg.alarm };
  }
  const setT = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
  const setH = (e, v) => { if (e && e._h !== v) { e._h = v; e.innerHTML = v; } };
  const setA = (e, k, v) => { if (e && e.getAttribute(k) !== v) e.setAttribute(k, v); };
  function patchOverview() {
    if (!ovRefs) return;
    let dp = 0, nDp = 0;
    for (const id of IDS()) { const d = dpMin(id); dp += d; if (d) nDp++; }
    setT(ovRefs['h-dp'], U.fmtNum(dp));
    setT(ovRefs['h-dps'], `von ${nDp} Stationen · Raster 5 s`);
    const ek = gatewayGroups().filter(g => g.kind === 'edge').map(g => g.key);
    const lat = ek.length ? Math.round(ek.reduce((a, k) => a + gwLatency(k), 0) / ek.length) : null;
    setT(ovRefs['h-gw'], ek.length ? `Ø Latenz ${lat} ms` : 'kein Edge-Gateway');
    if (ovRefs['h-loss']) {
      let sec = 0, eur = 0;
      for (const id of IDS()) { if (lvOf(id) !== 0) continue; const kd = S().machines[id].kd || {}; sec += kd.lossSec || 0; eur += kd.lossEur || 0; }
      setH(ovRefs['h-loss'], sec > 0 ? `Stillstand heute <b>${esc(U.fmtDur(sec))}</b> · ${esc(U.fmtEur(eur))} – nur per Rückmeldung erfasst` : 'heute noch kein Stillstand gemeldet');
    }
    for (const id in ovRefs.rows) {
      const r = ovRefs.rows[id], m = S().machines[id]; if (!m) continue;
      const lv = liveOf(id);
      if (r.dot) { r.dot.style.setProperty('--c', stColor(m.state)); setA(r.dot, 'title', stLabel(m.state) + ' – ' + (m.cause || '')); }
      setH(r.l1, lv.l1); setH(r.l2, lv.l2);
      if (r.sl && lv.light) setA(r.sl, 'data-l', lv.light);
      const agoTxt = ago(lv.age);
      if (r.ago) { setT(r.ago.lastChild, agoTxt); r.ago.classList.toggle('old', !!lv.old); }
      if (r.mago) { setT(r.mago, agoTxt); r.mago.classList.toggle('old', !!lv.old); }
      if (r.agoDot) r.agoDot.classList.toggle('on', (m.conn.level || 0) > 0 && lv.age != null && lv.age <= 1);
      if (r.l1) r.l1.classList.toggle('cn-alarm', !!lv.alarm);
    }
    patchFlow();
  }

  // ---------------------------------------------------------------- Datenfluss-Diagramm
  function renderFlow(force) {
    const host = ovRefs && ovRefs.flow; if (!host) return;
    const W = Math.min(1000, Math.round(host.clientWidth - 28));
    if (!force && Math.abs(W - lastW) < 6) return;
    lastW = W;
    const groups = gatewayGroups();
    flowRefs = { gw: {}, chips: {}, srv: null };
    if (W < 560) { host.innerHTML = flowMobile(groups); bindFlowRefs(host); return; }
    // verfügbare Höhe: Karte daneben (gleiche Rasterzeile) – Diagramm füllt sie ohne Leerband
    let availH = 0;
    const card = host.closest('.card'), row = host.closest('.cn-rowA');
    if (card && row && getComputedStyle(row).gridTemplateColumns.split(' ').length > 1) {
      const other = [...row.children].find(c => c !== card);
      if (other) availH = other.offsetHeight - (card.offsetHeight - host.clientHeight) - 24;
    }
    host.innerHTML = flowSvg(Math.max(560, W), groups, availH);
    bindFlowRefs(host);
  }
  function bindFlowRefs(host) {
    host.querySelectorAll('[data-fk]').forEach(e => { flowRefs[e.dataset.fk] = e; });
    host.querySelectorAll('[data-chip]').forEach(e => { flowRefs.chips[e.dataset.chip] = e.querySelector('[data-dot]') || e; });
  }
  function flowSvg(W, groups, availH) {
    const nRows = groups.reduce((a, g) => a + g.ids.length, 0);
    const natural = nRows * 32 + (groups.length - 1) * 16 + 4;
    const extra = Math.max(0, (availH || 0) - natural);
    const rowH = Math.min(38, 32 + extra * 0.75 / Math.max(1, nRows)), chipH = 25, gapG = Math.min(28, 16 + extra * 0.25 / Math.max(1, groups.length - 1)), boxH = 78, pad = 2;
    let y = pad; const rows = [];
    for (const g of groups) {
      const inner = g.ids.length * rowH - (rowH - chipH);
      const span = Math.max(inner, boxH);
      let ry = y + (span - inner) / 2;
      g.yc = y + span / 2;
      g.ids.forEach((id, i) => { rows.push({ id, g, i, y: ry }); ry += rowH; });
      y += span + gapG;
    }
    const H = y - gapG + pad;
    const mW = U.clamp(Math.round(W * 0.27), 162, 214), gW = U.clamp(Math.round(W * 0.25), 160, 200), sW = U.clamp(Math.round(W * 0.23), 160, 224);
    const rest = W - mW - gW - sW, gX = mW + Math.round(rest * 0.56), sX = gX + gW + (rest - Math.round(rest * 0.56));
    const srvH = Math.min(H - 4, 206), srvY = (H - srvH) / 2, srvC = srvY + srvH / 2;
    const reduce = reduceMotion();
    let paths = '', pk = '', chips = '', boxes = '';
    const cubic = (x1, y1, x2, y2) => { const dx = (x2 - x1) * 0.5; return `M${x1},${y1.toFixed(1)} C${(x1 + dx).toFixed(1)},${y1.toFixed(1)} ${(x2 - dx).toFixed(1)},${y2.toFixed(1)} ${x2},${y2.toFixed(1)}`; };
    for (const r of rows) {
      const m = S().machines[r.id], st = ST(r.id), lv = m.conn.level || 0, n = r.g.ids.length;
      const cy = r.y + chipH / 2, ey = r.g.yc + (r.i - (n - 1) / 2) * Math.min(10, (boxH - 26) / Math.max(1, n));
      const d = cubic(mW, cy, gX, ey);
      paths += `<path class="fx-p${lv === 0 ? ' l0' : ''}" data-p="${esc(r.id)}" d="${d}"/>`;
      if (lv > 0 && !reduce) {
        const dur = (2.4 + (parseInt(U.hash(r.id), 16) % 7) * 0.12).toFixed(2), off = ((parseInt(U.hash(r.id + 'o'), 16) % 100) / 100 * dur).toFixed(2);
        pk += `<circle class="fx-pkg" r="4.5"><animateMotion dur="${dur}s" begin="-${off}s" repeatCount="indefinite" path="${d}"/></circle><circle class="fx-pk" r="2.2"><animateMotion dur="${dur}s" begin="-${off}s" repeatCount="indefinite" path="${d}"/></circle>`;
      }
      chips += `<g class="fx-chip" data-chip="${esc(r.id)}" data-act="sel" data-id="${esc(r.id)}" transform="translate(0,${r.y.toFixed(1)})"><title>${esc(st.name)} – ${esc(stLabel(m.state))}</title>
        <rect class="bg" x="0.5" y="0" width="${mW - 1}" height="${chipH}" rx="6"/>
        <circle data-dot cx="12" cy="${chipH / 2}" r="4" style="fill:${stColor(m.state)}"/>
        <text x="23" y="${chipH / 2 + 4}"><tspan class="fx-n">${esc(st.short)}</tspan><tspan class="fx-id" dx="6">${esc(r.id)}</tspan></text>
        <rect x="${mW - 33}" y="5" width="26" height="14" rx="3.5" style="fill:color-mix(in srgb,${lvVar(lv)} 15%,transparent);stroke:color-mix(in srgb,${lvVar(lv)} 45%,transparent)"/>
        <text class="fx-lvt" x="${mW - 20}" y="${chipH / 2 + 3.5}" text-anchor="middle" style="fill:${lvVar(lv)}">L${lv}</text></g>`;
    }
    groups.forEach((g, gi) => {
      const by = g.yc - boxH / 2, x = gX, kind = g.kind, ids = g.ids;
      const dpG = ids.reduce((a, id) => a + dpMin(id), 0);
      const sy = srvC + (gi - (groups.length - 1) / 2) * Math.min(16, (srvH - 40) / Math.max(1, groups.length));
      const d = cubic(gX + gW, g.yc, sX, sy);
      paths += `<path class="fx-p${kind === 'tablet' ? ' l0' : ' up'}" d="${d}"/>`;
      if (kind !== 'tablet' && !reduce) for (let k = 0; k < 2; k++) pk += `<circle class="fx-pkg" r="5"><animateMotion dur="1.9s" begin="-${(k * 0.95 + gi * 0.31).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle><circle class="fx-pk" r="2.5"><animateMotion dur="1.9s" begin="-${(k * 0.95 + gi * 0.31).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle>`;
      const key = esc(g.key);
      const head = kind === 'tablet'
        ? `<circle cx="${x + 15}" cy="${by + 18}" r="4" style="fill:none;stroke:var(--st-wait);stroke-width:1.5"/>`
        : `<circle class="fx-hbr" cx="${x + 15}" cy="${by + 18}" r="4" stroke-width="1.5"/><circle class="fx-hb" cx="${x + 15}" cy="${by + 18}" r="4"/>`;
      const meta = GW_META[g.key] || {};
      const l2 = kind === 'tablet' ? `<text class="fx-bs wa" x="${x + 27}" y="${by + 37}">manuell – keine Live-Daten</text>`
        : `<text class="fx-bs" x="${x + 27}" y="${by + 37}"><tspan class="ok">online</tspan> · <tspan data-fk="lat-${key}">–</tspan>${kind === 'edge' ? ' · ' + esc(meta.net || 'LAN') : ''}</text>`;
      const l3 = kind === 'tablet' ? `<text class="fx-bs" x="${x + 27}" y="${by + 53}" data-fk="tab-last">–</text>`
        : `<text class="fx-bs" x="${x + 27}" y="${by + 53}" data-fk="hb-${key}">–</text>`;
      const l4 = `<text class="fx-bs" x="${x + 27}" y="${by + 69}">${kind === 'tablet' ? `${ids.length} ${ids.length === 1 ? 'Station' : 'Stationen'}` : U.fmtNum(dpG) + ' Datenpunkte/min'}</text>`;
      boxes += `<g><title>${esc(gwTitle(g.key))}${meta.ip && meta.ip !== '–' ? ' · ' + esc(meta.ip) : ''}</title><rect class="fx-box${kind === 'tablet' ? ' tab' : ''}" x="${x}" y="${by}" width="${gW}" height="${boxH}" rx="9"/>${head}
        <text class="fx-bt" x="${x + 27}" y="${by + 22}">${esc(gwTitle(g.key))}</text>${l2}${l3}${l4}</g>`;
    });
    const outs = ['Leitstand & Halle 3D', 'Analyse & Termine', 'Copilot (KI)', 'Benachrichtigungen'];
    const oy0 = srvY + srvH - 4 - outs.length * 24;
    const srv = `<g><rect class="fx-srv" x="${sX}" y="${srvY}" width="${sW}" height="${srvH}" rx="11"/>
      <text class="fx-st" x="${sX + 14}" y="${srvY + 24}">werkfluss Server</text>
      <text class="fx-bs" x="${sX + 14}" y="${srvY + 40}">Büro · On-Premises</text>
      <text class="fx-sv" x="${sX + 14}" y="${srvY + 74}" data-fk="srv-dp">–</text>
      <text class="fx-bs" x="${sX + 14}" y="${srvY + 90}">Datenpunkte / min</text>
      <line class="fx-sep" x1="${sX + 12}" x2="${sX + sW - 12}" y1="${oy0 - 8}" y2="${oy0 - 8}"/>
      ${outs.map((o, i) => `<g transform="translate(${sX + 12},${oy0 + i * 24})"><rect class="fx-out" width="${sW - 24}" height="19" rx="5"/><text class="fx-outt" x="9" y="13.5">→ ${esc(o)}</text></g>`).join('')}</g>`;
    return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" height="${H.toFixed(0)}" role="img" aria-label="Datenfluss von den Maschinen über die Gateways zum werkfluss-Server">${paths}${boxes}${srv}${chips}${pk}</svg>`;
  }
  function flowMobile(groups) {
    return `<div class="cn-fm">${groups.map(g => {
      const meta = GW_META[g.key] || {}, tab = g.kind === 'tablet';
      const dpG = g.ids.reduce((a, id) => a + dpMin(id), 0);
      return `<div class="cn-fm-g${tab ? ' tab' : ''}"><div class="cn-fm-h">${tab ? '<span class="cn-dot" style="--c:var(--st-wait)"></span>' : '<span class="cn-dot" style="--c:var(--st-run)"></span>'}<b>${esc(gwTitle(g.key))}</b>
        <span class="m" ${tab ? 'data-fk="tab-last"' : `data-fk="mlat-${esc(g.key)}"`}>${tab ? 'manuell' : 'online'}</span></div>
        <div class="cn-fm-c">${g.ids.map(id => { const m = S().machines[id]; return `<button class="cn-chip" data-act="sel" data-id="${esc(id)}" data-chip="${esc(id)}"><span class="cn-dot" data-dot style="--c:${stColor(m.state)}"></span>${esc(ST(id).short)}<span class="mono">${esc(id)}</span>${lvBadge(m.conn.level || 0)}</button>`; }).join('')}</div>
        ${!tab ? `<div class="cn-fm-c" style="padding-top:0;font-size:11.5px;color:var(--muted)">${g.ids.length} ${g.ids.length === 1 ? 'Station' : 'Stationen'} · ${U.fmtNum(dpG)} Datenpunkte/min${meta.net ? ' · ' + esc(meta.net) : ''}</div>` : ''}</div>`;
    }).join('')}<div class="cn-fm-srv"><span class="ic">${icon('cpu', 18)}</span><div class="tx"><span class="t">werkfluss Server · Büro</span><span class="s">→ Leitstand, Analyse, Copilot, Meldungen</span></div><div class="nv"><b data-fk="srv-dp">–</b><span>Datenpunkte/min</span></div></div></div>`;
  }
  function patchFlow() {
    if (!flowRefs) return;
    let dp = 0; for (const id of IDS()) dp += dpMin(id);
    setT(flowRefs['srv-dp'], U.fmtNum(dp));
    for (const g of gatewayGroups()) {
      if (g.kind === 'tablet') {
        let last = null; for (const id of g.ids) { const sg = S().machines[id].signals; if (sg && sg.lastFeedbackT != null && (last == null || sg.lastFeedbackT > last)) last = sg.lastFeedbackT; }
        setT(flowRefs['tab-last'], last != null ? 'letzte Meldung ' + ago(nowT() - last) : 'keine Meldung');
        continue;
      }
      const lat = gwLatency(g.key);
      setT(flowRefs['lat-' + g.key], lat + ' ms');
      setT(flowRefs['hb-' + g.key], `Heartbeat ${ago(gwHeartbeat(g.key))}`);
      setT(flowRefs['mlat-' + g.key], `online · ${lat} ms · Heartbeat ${ago(gwHeartbeat(g.key))}`);
    }
    for (const id in flowRefs.chips) {
      const e = flowRefs.chips[id], m = S().machines[id]; if (!e || !m) continue;
      if (e.tagName === 'circle') { const c = stColor(m.state); if (e.style.fill !== c) e.style.fill = c; }
      else e.style.setProperty('--c', stColor(m.state));
    }
  }

  // =================================================================== Assistent
  function defaultMachine() {
    const up = IDS().filter(id => analysisOf(id).upgradable);
    up.sort((a, b) => lvOf(a) - lvOf(b));
    return up[0] || IDS()[0];
  }
  function openWizard(opts) {
    opts = opts || {};
    if (!WZ && ovEl && root) ovScroll = root.scrollTop;
    WZ = { mode: opts.newMachine ? 'new' : 'existing', id: opts.machineId && S().machines[opts.machineId] ? opts.machineId : defaultMachine(), demo: opts.demo || 'mori',
      step: 0, reached: 0, scan: { phase: 'idle', t0: 0 }, pathKey: null, map: null, test: null, done: null, t0: performance.now(), samples: [] };
    resetFromMachine();
    wzSig = {};
    ovEl.hidden = true; wzEl.hidden = false;
    renderWizard();
    if (root) root.scrollTop = 0;
  }
  function closeWizard() {
    WZ = null; wzSig = {};
    wzEl.hidden = true; wzEl.innerHTML = ''; ovEl.hidden = false;
    ovSig = ''; update();
    if (root) root.scrollTop = ovScroll || 0;
  }
  function subj() { return WZ.mode === 'new' ? subjectDemo(WZ.demo) : subjectOf(WZ.id); }
  function curAnalysis() { const sj = subj(); WZ._a = analyze(sj); return WZ._a; }
  function resetFromMachine() {
    const a = curAnalysis();
    WZ.pathKey = a.rec ? a.rec.key : null;
    WZ.scan = { phase: 'idle', t0: 0 };
    WZ.map = null; WZ.test = null; WZ.samples = [];
    WZ.step = 0; WZ.reached = 0;
  }
  const selPath = () => { const a = WZ._a || curAnalysis(); return a.options.find(o => o.key === WZ.pathKey) || null; };
  function ctxNow() { return WZ.mode === 'new' ? demoCtx(DEMOS[WZ.demo]) : fullCtx(WZ.id); }
  function mapRows() {
    const p = selPath(); if (!p) return [];
    const sj = subj();
    return familyRows(p.family, sj, p.level);
  }
  function ensureMap() {
    const p = selPath(); if (!p) return;
    if (WZ.map && WZ.map.key === p.key) return;
    const rows = mapRows(), sj = subj(), curFam = famOfProtocol(sj.protocol);
    const existing = (r) => !sj.demo && p.family === curFam && r.lvMin <= sj.cur;
    const sel = {}; rows.forEach(r => { sel[r.id] = r.sem; });
    const anyNew = rows.some(r => !existing(r));
    WZ.map = { key: p.key, phase: anyNew ? 'run' : 'done', t0: performance.now(), sel, existing: Object.fromEntries(rows.map(r => [r.id, existing(r)])) };
    WZ.test = null;
  }
  const mapDur = (n) => 900 + n * 230 + 600;
  function canNext() {
    const s = WZ.step, a = WZ._a || curAnalysis(), p = selPath();
    if (s === 0) {
      if (WZ.mode === 'new' && WZ.scan.phase !== 'done') return { ok: false, hint: 'Typenschild analysieren, um die Maschine zu erkennen.' };
      if (!a.upgradable) return { ok: false, hint: 'Diese Station ist bereits optimal angebunden – bitte eine andere wählen.' };
      return { ok: true, hint: WZ.mode === 'existing' && WZ.scan.phase !== 'done' ? 'Maschine aus den Stammdaten übernommen. Optional: Typenschild analysieren.' : 'Maschine erkannt.' };
    }
    if (s === 1) {
      if (!p || !p.possible) return { ok: false, hint: 'Bitte einen möglichen Anbindungsweg wählen.' };
      if (p.current) return { ok: false, hint: 'Das ist der heutige Stand – bitte einen Weg mit höherer Stufe wählen.' };
      return { ok: true, hint: `Gewählt: ${p.title} · Level ${p.level}` };
    }
    if (s === 2) {
      if (!WZ.map || WZ.map.phase !== 'done') return { ok: false, hint: 'KI ordnet die Signale zu …' };
      const v = validate(mapRows(), WZ.map.sel, p.level);
      return v.ok ? { ok: true, hint: 'Zuordnung vollständig.' } : { ok: false, hint: v.errs[0], warn: true };
    }
    if (s === 3) {
      const t = WZ.test; if (!t) return { ok: false, hint: '' };
      if (t.phase !== 'done') return { ok: false, hint: 'Live-Test läuft …' };
      if (!t.pass) return { ok: false, hint: 'Zustand stimmt nicht überein – Zuordnung prüfen.', warn: true };
      return { ok: true, hint: WZ.mode === 'new' ? 'Live-Test bestanden – Anbindung kann gespeichert werden.' : 'Live-Test bestanden – Anbindung kann aktiviert werden.' };
    }
    return { ok: true, hint: '' };
  }
  function goStep(n) {
    if (!WZ || WZ.done) return;
    n = U.clamp(n, 0, 3);
    if (n > WZ.step) { for (let s = WZ.step; s < n; s++) { WZ.step = s; if (!canNext().ok) { renderWizard(); return; } } }
    WZ.step = n; WZ.reached = Math.max(WZ.reached, n);
    if (n === 2) ensureMap();
    if (n === 3) startTest();
    renderWizard();
    if (root) { const top = wzEl.offsetTop - 8; if (root.scrollTop > top) root.scrollTop = top; }
  }
  function startTest() {
    WZ.test = { phase: 'run', t0: performance.now(), pass: false, revealed: 0 };
    WZ.samples = [];
  }
  function activate() {
    const p = selPath(), sj = subj();
    if (!p) return;
    if (WZ.mode === 'new') {
      WZ.done = { demo: true, from: 0, to: p.level, protocol: p.protocol, gateway: p.gateway || sj.demoGw, t: nowT(), title: p.title };
      WZ.step = 4; WZ.reached = 4;
      WF.app.toast(`${sj.short}: Anbindung gespeichert (Level ${p.level} · ${p.protocol})`, 'ok', { title: 'Neue Maschine vorbereitet' });
      renderWizard(); return;
    }
    const before = sj.cur;
    let r;
    try { r = WF.sim.actions.connectMachine(sj.id, p.level, p.protocol); } catch (e) { r = { ok: false, msg: e.message }; }
    if (r && r.ok === false) { WF.app.toast(r.msg || 'Anbindung nicht möglich', 'warn'); return; }
    const c = S().machines[sj.id].conn;
    WZ.done = { demo: false, from: before, to: c.level, protocol: c.protocol, gateway: c.gateway, t: c.connectedT != null ? c.connectedT : nowT(), title: p.title };
    WZ.step = 4; WZ.reached = 4;
    WF.app.toast(`${sj.short} liefert jetzt Daten über ${/direkt/i.test(c.gateway) ? 'das Firmennetz' : c.gateway} (Level ${before} → ${c.level}).`, 'ok', { title: (r && r.msg) || `${sj.id} angebunden` });
    renderWizard();
  }

  // ---------------------------------------------------------------- Rendering Assistent
  const STEPS = ['Maschine', 'Anbindungsweg', 'Signale zuordnen', 'Live-Test', 'Fertig'];
  function stepSub(i) {
    const sj = subj(), p = selPath();
    if (i === 0) return WZ.mode === 'new' ? (WZ.scan.phase === 'done' ? sj.short : 'Typenschild') : `${sj.id} · ${sj.short}`;
    if (i === 1) return p ? `L${p.level} · ${p.title}` : 'Weg wählen';
    if (i === 2) { if (!WZ.map) return 'KI-Vorschlag'; if (WZ.map.phase === 'run') return 'KI ordnet zu …'; const n = mapRows().filter(r => WZ.map.sel[r.id] && WZ.map.sel[r.id] !== 'none').length; return `${n} Signale zugeordnet`; }
    if (i === 3) return WZ.test ? (WZ.test.phase !== 'done' ? 'läuft …' : WZ.test.pass ? 'bestanden' : 'nicht bestanden') : 'Zustand prüfen';
    return WZ.done ? (WZ.done.demo ? 'gespeichert' : 'aktiv') : 'aktivieren';
  }
  function stepperHtml() {
    let h = '';
    STEPS.forEach((t, i) => {
      const done = WZ.done ? true : i < WZ.step, on = !WZ.done && i === WZ.step, can = !WZ.done && i <= WZ.reached && i !== WZ.step;
      if (i > 0) h += `<span class="cn-stl${i <= WZ.step || WZ.done ? ' done' : ''}"><i></i></span>`;
      h += `<button class="cn-st${on ? ' on' : ''}${done && !on ? ' done' : ''}${can ? ' can' : ''}" ${can ? `data-act="wz-step" data-step="${i}"` : 'tabindex="-1"'} aria-current="${on ? 'step' : 'false'}">
        <span class="n">${done && !on ? icon('check', 14) : i + 1}</span><span class="tx"><span class="tt">${esc(t)}</span><span class="ts">${esc(stepSub(i))}</span></span></button>`;
    });
    const cur = WZ.done ? 4 : WZ.step;
    h += `<div class="cn-st-m"><span>Schritt ${cur + 1} von 5</span><b>${esc(STEPS[cur])}</b></div>`;
    return h;
  }
  function renderWizard() {
    if (!WZ) return;
    curAnalysis();
    const sj = subj();
    const title = WZ.mode === 'new' ? (WZ.done ? `${sj.short} vorbereitet` : 'Neue Maschine anbinden') : WZ.done ? `${sj.short} angebunden` : `${sj.short} anbinden`;
    if (!wzRefs.shell || !wzEl.contains(wzRefs.shell)) {
      wzEl.innerHTML = `<div class="cn-wz">
        <div class="cn-wz-top"><div style="min-width:0;flex:1">
          <div class="cn-crumb"><button data-act="wz-close">Anbindung</button>${icon('chevron', 13)}<span>Maschine anbinden</span></div>
          <h1 class="view-t" data-w="title"></h1></div>
          <div class="cn-acts" data-w="topact"></div></div>
        <div class="card cn-stepper" data-w="stepper"></div>
        <div class="cn-wz-body">
          <div class="card cn-wz-main"><div class="cn-wz-c" data-w="content"></div><div class="cn-wz-f" data-w="foot"></div></div>
          <aside class="card cn-aside" data-w="aside"></aside>
        </div></div>`;
      wzRefs = { shell: wzEl.firstElementChild };
      wzEl.querySelectorAll('[data-w]').forEach(e => { wzRefs[e.dataset.w] = e; });
    }
    setH(wzRefs.topact, `<button class="btn ghost" data-act="wz-close">${icon('x', 15)}${WZ.done ? 'Schließen' : 'Abbrechen'}</button>`);
    setH(wzRefs.title, `${esc(title)}${WZ.mode === 'existing' ? ` <span class="mono" style="font-size:14px;color:var(--muted);font-family:var(--f-mono)">${esc(sj.id)}</span>` : ''}`);
    const parts = { stepper: stepperHtml(), aside: asideHtml(), foot: footHtml() };
    for (const k in parts) if (wzSig[k] !== parts[k]) { wzSig[k] = parts[k]; wzRefs[k].innerHTML = parts[k]; }
    const cs = contentSig();
    if (wzSig.content !== cs) { wzSig.content = cs; wzRefs.content.innerHTML = contentHtml(); afterContent(); }
    patchWizard();
  }
  function contentSig() {
    const p = selPath();
    return [WZ.mode, WZ.id, WZ.demo, WZ.step, WZ.scan.phase, WZ.pathKey, WZ.map ? WZ.map.key + WZ.map.phase : '', WZ.test ? 't' + WZ.test.t0 : '', WZ.done ? 'd' : '', p ? p.level : '', WZ.step === 0 ? (WZ._a && WZ._a.upgradable) : ''].join('|');
  }
  function contentHtml() {
    if (WZ.done) return step4Html();
    return [step0Html, step1Html, step2Html, step3Html][WZ.step]();
  }
  function afterContent() {
    const cv = wzRefs.content.querySelector('canvas[data-plate]');
    if (cv) {
      const pl = plateFor(subj());
      if (pl) {
        const boxes = drawPlate(cv, pl);
        WZ._boxes = boxes;
        const ov = wzRefs.content.querySelector('[data-w="boxes"]');
        if (ov) ov.innerHTML = boxesHtml(boxes);
        if (document.fonts && document.fonts.ready && !afterContent._f) { afterContent._f = true; document.fonts.ready.then(() => { const c2 = wzRefs.content && wzRefs.content.querySelector('canvas[data-plate]'); if (c2 && WZ) drawPlate(c2, plateFor(subj())); }); }
      }
    }
  }
  function boxesHtml(boxes) {
    if (WZ.scan.phase === 'idle') return '';
    return boxes.map((b, i) => `<div class="cn-box${b.k === 'brand' ? '' : ' in'}" style="left:${b.x.toFixed(2)}%;top:${b.y.toFixed(2)}%;width:${b.w.toFixed(2)}%;height:${b.h.toFixed(2)}%;animation-delay:${(0.55 + i * 0.32).toFixed(2)}s"><span>${esc(OCR_LBL[b.k])} · ${OCR_CONF[b.k]} %</span></div>`).join('');
  }
  function footHtml() {
    const cn = canNext();
    if (WZ.done) {
      const nxt = WZ.mode === 'existing' ? nextCandidate() : null;
      return `<button class="btn" data-act="wz-close">${icon('grid', 15)}Zur Übersicht</button><span class="spacer" style="flex:1"></span>
        ${nxt ? `<button class="btn primary" data-act="wz-open" data-id="${esc(nxt)}">Nächste Maschine: ${esc(ST(nxt).short)} ${icon('arrowRight', 15)}</button>` : `<button class="btn primary" data-act="wz-new">${icon('camera', 15)}Weitere Maschine</button>`}`;
    }
    const back = WZ.step > 0 ? `<button class="btn" data-act="wz-back">Zurück</button>` : `<button class="btn ghost" data-act="wz-close">Abbrechen</button>`;
    const nextLbl = WZ.step === 3 ? (WZ.mode === 'new' ? `${icon('check', 15)}Anbindung speichern` : `${icon('plug', 15)}Anbindung aktivieren`) : `Weiter: ${STEPS[WZ.step + 1]} ${icon('arrowRight', 15)}`;
    return `${back}<span class="hint${cn.warn ? ' warn' : ''}">${esc(cn.hint || '')}</span>
      <button class="btn primary" data-act="${WZ.step === 3 ? 'wz-activate' : 'wz-next'}" ${cn.ok ? '' : 'disabled'}>${nextLbl}</button>`;
  }
  function nextCandidate() {
    const up = IDS().filter(id => id !== WZ.id && analysisOf(id).upgradable);
    up.sort((a, b) => lvOf(a) - lvOf(b));
    return up[0] || null;
  }
  function asideHtml() {
    const sj = subj(), p = selPath();
    const to = WZ.done ? WZ.done.to : p ? p.level : null;
    const from = WZ.done ? WZ.done.from : sj.cur;
    const gw = WZ.done ? WZ.done.gateway : p ? (p.gateway || '–') : '–';
    const gwT = !gw || gw === '–' ? '–' : /direkt/i.test(gw) ? 'direkt (Firmennetz)' : gw + (gw === 'werkfluss Edge 03' && !edgeKeys().includes(gw) && !WZ.done ? ' (neu)' : '');
    const mapped = WZ.map && WZ.map.phase === 'done' ? mapRows().filter(r => WZ.map.sel[r.id] && WZ.map.sel[r.id] !== 'none').length : null;
    const testTxt = !WZ.test ? '–' : WZ.test.phase !== 'done' ? 'läuft …' : WZ.test.pass ? '<span class="cn-ok">bestanden</span>' : '<span class="cn-bad">nicht bestanden</span>';
    return `<div class="card-h"><h3>Ihre Anbindung</h3>${WZ.done ? `<span class="cn-live"><i></i>aktiv</span>` : ''}</div>
      <div class="card-b">
        <div class="cn-asm"><span class="ic">${icon(sj.type === 'assembly' ? 'users' : sj.type === 'cmm' ? 'target' : 'factory', 20)}</span><div style="min-width:0"><b>${esc(sj.short)}</b><span>${esc(sj.vendor !== '–' ? sj.vendor + ' ' + sj.model : sj.model)} · Bj. ${esc(sj.year)}</span></div></div>
        <div class="cn-lvch"><div class="a">${lvBadge(from, 'lg')}<span>${esc(LV[from].name)}</span></div><span class="ar">${icon('arrowRight', 18)}</span>
          <div class="a">${to != null ? lvBadge(to, 'lg') : WZ._a && !WZ._a.upgradable ? lvBadge(sj.cur, 'lg') : '<span class="cn-lv lg" style="--c:var(--line2)">?</span>'}<span>${to != null ? esc(LV[to].name) : WZ._a && !WZ._a.upgradable ? 'bereits optimal' : 'Ziel wählen'}</span></div></div>
        <dl class="dl">
          <dt>Steuerung</dt><dd>${esc(sj.controlShort || '–')}</dd>
          <dt>Weg</dt><dd>${p ? esc(p.title) : '–'}</dd>
          <dt>Protokoll</dt><dd>${p && p.protocol ? esc(p.protocol) : '–'}</dd>
          <dt>Gateway</dt><dd>${esc(gwT)}</dd>
          <dt>Aufwand</dt><dd>${p && p.effort ? esc(p.effort) : '–'}</dd>
          <dt>Eingriff</dt><dd>${p && p.intervention ? esc(p.intervention) : '–'}</dd>
          <dt>Signale</dt><dd>${mapped != null ? mapped + ' zugeordnet' : WZ.map ? 'KI ordnet zu …' : '–'}</dd>
          <dt>Live-Test</dt><dd>${testTxt}</dd>
        </dl>
        <div class="cn-aside-n">${WZ.mode === 'new' ? 'Demo: Neue Stationen werden nicht in die simulierte Halle übernommen – der Ablauf ist derselbe wie bei einer echten Inbetriebnahme.' : 'Alle Zugriffe sind lesend. werkfluss schreibt nie in Steuerung oder NC-Programm.'}</div>
      </div>`;
  }

  // ---------------------------------------------------------------- Schritt 1: Maschine identifizieren
  /** Abgleich Stammdaten ↔ Typenschild (KI). Liefert Zeilen {k, master, plate:{v, c, note}|null, span} */
  function identRows(sj, pl) {
    const ctrlPrinted = pl && pl.control && pl.control !== '—';
    const rows = [
      { k: 'Hersteller', master: sj.vendor !== '–' ? sj.vendor : null, plate: pl ? { v: sj.vendor, c: OCR_CONF.brand } : null },
      { k: 'Modell', master: sj.model, plate: pl ? { v: sj.model, c: OCR_CONF.model } : null },
      { k: 'Baujahr', master: `${sj.year} (${2026 - sj.year} Jahre)`, plate: pl ? { v: String(sj.year), c: OCR_CONF.year } : null },
      { k: 'Masch.-Nr.', master: null, plate: pl ? { v: pl.serial, c: OCR_CONF.serial, add: true } : null },
      { k: 'Steuerung', master: sj.demo ? null : sj.control, plate: pl ? (ctrlPrinted ? { v: pl.control, c: OCR_CONF.control } : sj.demo ? { v: sj.controlShort, c: 84, note: 'aus Modell und Baujahr abgeleitet' } : { v: null, note: 'nicht auf dem Schild' }) : null },
      { k: 'Anschluss', master: null, plate: pl ? { v: `${pl.supply} · ${pl.amp}`, c: 95, add: true } : null },
    ];
    return rows;
  }
  function identHtml(sj, pl, ph) {
    const f = factsFor(sj), two = !pl || sj.demo;
    const plateCell = (r) => {
      if (!pl) return '';
      if (ph === 'idle') return '<span class="faint">–</span>';
      if (ph === 'run') return '<span class="cn-shim" style="width:72%"></span>';
      const p = r.plate; if (!p) return '<span class="faint">–</span>';
      if (p.v == null) return `<span class="muted">${esc(p.note || '–')}</span>`;
      const same = !sj.demo && r.master != null && String(r.master).startsWith(String(p.v));
      return `<span class="v">${esc(p.v)}</span><span class="cf">${same ? `<span class="cn-ok" title="stimmt mit den Stammdaten überein">${icon('check', 13)}</span>` : p.add && !sj.demo ? '<span class="cn-tag new">ergänzt</span>' : ''}${p.c != null ? p.c + ' %' : ''}</span>${p.note ? `<span class="n">${esc(p.note)}</span>` : ''}`;
    };
    const rows = identRows(sj, pl);
    const head = sj.demo ? `<div class="cn-cr h two"><span>Merkmal</span><span>Erkannt vom Typenschild</span></div>`
      : `<div class="cn-cr h${two ? ' two' : ''}"><span>Merkmal</span><span>Stammdaten</span>${two ? '' : '<span>Typenschild-Foto</span>'}</div>`;
    const body = rows.map(r => sj.demo
      ? `<div class="cn-cr two${ph === 'done' ? ' in' : ''}"><span class="k">${esc(r.k)}</span><span class="o">${plateCell(r)}</span></div>`
      : `<div class="cn-cr${two ? ' two' : ''}${ph === 'done' ? ' in' : ''}"><span class="k">${esc(r.k)}</span><span class="s">${r.master != null ? esc(r.master) : '<span class="faint">nicht gepflegt</span>'}</span>${two ? '' : `<span class="o">${plateCell(r)}</span>`}</div>`).join('');
    const ifaceRow = (!sj.demo || ph === 'done') ? `<div class="cn-cr span"><span class="k">Schnittstelle</span><span class="x"><span class="cn-ai" style="margin-right:6px">${icon('sparkles', 12)}KI</span>${esc(f.iface)}</span></div>` : '';
    const today = sj.demo ? '' : `<div class="cn-cr span"><span class="k">Heute</span><span class="x">${lvBadge(sj.cur)} <span style="margin-left:6px">${esc(sj.cur === 0 ? 'Tablet-Rückmeldung' : sj.protocol)}</span>${sj.cur > 0 ? `<span class="muted"> · ${esc(/direkt/i.test(sj.gateway) ? 'direkt im Firmennetz' : sj.gateway)}</span>` : ''}</span></div>`;
    return `<div class="cn-cmpt">${head}${body}${ifaceRow}${today}</div>`;
  }
  function step0Html() {
    const sj = subj(), a = WZ._a, pl = plateFor(sj), ph = WZ.scan.phase;
    const photo = pl ? `<div class="cn-photo ${ph === 'run' ? 'scan' : ph}">
        <div class="cn-photo-in"><canvas data-plate width="600" height="360" aria-label="Foto des Typenschilds von ${esc(sj.short)}"></canvas>
          <div class="cn-ov">${ph !== 'done' ? '<i class="cn-corner tl"></i><i class="cn-corner tr"></i><i class="cn-corner bl"></i><i class="cn-corner br"></i>' : ''}${ph === 'run' ? '<div class="cn-scan"></div>' : ''}<div data-w="boxes"></div>
            ${ph === 'idle' ? `<div class="cn-photo-cta"><button class="btn primary" data-act="wz-scan">${icon('sparkles', 15)}Typenschild-Foto analysieren</button></div>` : ''}
            ${ph === 'done' ? `<span class="cn-badge-ok">${icon('check', 13)}erkannt</span>` : ''}</div></div>
        <div class="cn-photo-cap">${icon('camera', 14)}<span>IMG_${String(4100 + (parseInt(U.hash(sj.id), 16) % 800))}.jpg · Hallen-Tablet</span><span class="spacer"></span>
          ${ph === 'run' ? '<span class="cn-ai"><span class="cn-spin"></span>KI liest das Typenschild …</span>' : ph === 'done' ? `<button class="link" data-act="wz-scan">Erneut analysieren</button>` : ''}</div></div>`
      : `<div class="cn-note" style="--c:var(--muted);margin-top:0">${icon('info', 16)}<div><b>Kein Typenschild</b><br>${esc(sj.short)} ist ein Handarbeitsplatz – die Station wird aus den Stammdaten übernommen.</div></div>`;
    const after = ph !== 'done' ? '' : sj.demo
      ? `<div class="cn-note" style="--c:var(--accent)">${icon('sparkles', 16)}<div><b>Neue Maschine erkannt:</b> ${esc(sj.vendor)} ${esc(sj.model)} (${sj.year}) – ${esc(sj.name)}. Nicht in den Stammdaten, wird als neue Station im Bereich ${esc(sj.area)} angelegt.</div></div>`
      : `<div class="cn-note" style="--c:var(--st-run)">${icon('check', 16)}<div><b>Passt zu ${esc(sj.id)} · ${esc(sj.short)}</b> (${esc(sj.area)}). Hersteller, Modell und Baujahr bestätigen die Stammdaten; Seriennummer und Anschlusswerte werden ergänzt.</div></div>`;
    if (WZ.mode === 'new') {
      return `<div class="cn-s0"><div class="a">
        <h2 class="cn-h2">Typenschild fotografieren</h2>
        <p class="cn-p">Ein Foto mit dem Tablet genügt: werkfluss liest Hersteller, Modell, Baujahr und Seriennummer und leitet daraus Steuerung und Schnittstelle ab. Für die Demo stehen drei Beispielfotos bereit.</p>
        <div class="cn-demo">${Object.values(DEMOS).map(d => `<button class="${d.key === WZ.demo ? 'on' : ''}" data-act="wz-demo" data-key="${d.key}"><b>${esc(d.vendor)} ${esc(d.model)}</b><span>${esc(d.tag)} · Bj. ${d.year}</span></button>`).join('')}</div>
        </div><div class="b">${photo}${after}</div><div class="c">${identHtml(sj, pl, ph)}</div></div>`;
    }
    const opts = IDS().map(id => { const s2 = ST(id); return `<option value="${esc(id)}" ${id === WZ.id ? 'selected' : ''}>${esc(id)} · ${esc(s2.short)} – ${esc(s2.name)} (L${lvOf(id)})</option>`; }).join('');
    const status = a.upgradable
      ? `<div class="cn-note" style="--c:var(--accent)">${icon('sparkles', 16)}<div><b>Ausbaufähig:</b> heute Level ${sj.cur} (${esc(LV[sj.cur].name)}), möglich ist Level ${a.max}.${a.rec ? ` werkfluss empfiehlt <b>${esc(a.rec.title)}</b>.` : ''}</div></div>`
      : `<div class="cn-note" style="--c:var(--st-run)">${icon('check', 16)}<div><b>Bereits optimal angebunden</b> (Level ${sj.cur}). ${esc((a.options.find(o => !o.possible) || {}).reason || 'Mehr Daten liefert diese Steuerung nicht.')}</div></div>`;
    return `<div class="cn-s0"><div class="a">
        <h2 class="cn-h2">Welche Maschine soll angebunden werden?</h2>
        <p class="cn-p">Aus den Stammdaten wählen – oder das Typenschild fotografieren. werkfluss erkennt Hersteller, Modell und Baujahr und gleicht sie mit den Stammdaten ab.</p>
        <label class="field">Maschine<select class="input" data-f="machine">${opts}</select></label>
        </div><div class="b">${photo}${after}</div><div class="c">${identHtml(sj, pl, ph)}${status}</div></div>`;
  }

  // ---------------------------------------------------------------- Schritt 2: Anbindungsweg
  function step1Html() {
    const sj = subj(), a = WZ._a, rec = a.rec, p = selPath();
    const caps = capsFor(sj.type);
    const capsGain = (lv) => caps.filter(c => c.v[lv] === 'auto' && c.v[sj.cur] !== 'auto');
    const capsKeep = (lv) => caps.filter(c => c.v[lv] !== 'auto' && c.v[lv] != null);
    const recHtml = rec ? `<div class="cn-reco">
        <div class="cn-reco-h"><span class="cn-ai">${icon('sparkles', 14)}KI-Empfehlung für ${esc(sj.short)}</span><span class="spacer" style="flex:1"></span>${WF.ai ? `<button class="btn sm ghost" data-act="ask">${icon('sparkles', 13)}Copilot fragen</button>` : ''}</div>
        <div class="cn-reco-t"><b>${esc(rec.title)}</b>${lvBadge(rec.level, 'lg')}</div>
        <div class="cn-reco-s">${esc(rec.sub || '')}</div>
        <div class="cn-facts">
          <span class="cn-fact">${icon('clock', 14)}${esc(rec.effort)}</span>
          <span class="cn-fact">${icon('shield', 14)}${esc(rec.intervention)}</span>
          ${rec.gateway ? `<span class="cn-fact">${icon('cpu', 14)}${esc(/direkt/i.test(rec.gateway) ? 'direkt über das Firmennetz' : rec.gateway + (rec.gateway === 'werkfluss Edge 03' && !edgeKeys().includes(rec.gateway) ? ' (neu, im Kit)' : ''))}</span>` : ''}
          <span class="cn-fact">${icon('pause', 14)}${esc(rec.downtime.split(' – ')[0])}</span>
        </div>
        <div class="cn-reco-g">
          <div><div class="eyebrow">Warum dieser Weg?</div><ul class="cn-why">${(rec.why || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
          <div><div class="eyebrow">Damit in werkfluss</div><div class="cn-gain">
            ${capsGain(rec.level).map(c => `<div class="y">${icon('check', 15)}<span>${esc(c.label)}</span></div>`).join('')}
            ${capsKeep(rec.level).map(c => `<div class="n">${icon('dot', 15)}<span>${esc(c.label)}: ${esc(c.v[rec.level])}</span></div>`).join('')}
          </div></div>
        </div></div>` : '';
    const optHtml = (o) => {
      const cls = !o.possible ? 'dis' : o.current ? 'cur' : o.key === WZ.pathKey ? 'on' : '';
      const tag = o.rec ? '<span class="cn-tag rec">Empfohlen</span>' : o.current ? '<span class="cn-tag cur">heute</span>' : !o.possible ? '<span class="cn-tag no">nicht möglich</span>' : '';
      const interactive = o.possible && !o.current;
      return `<div class="cn-opt ${cls}" ${interactive ? `role="radio" tabindex="0" aria-checked="${o.key === WZ.pathKey}" data-act="wz-path" data-key="${esc(o.key)}"` : 'aria-disabled="true"'}>
        <span class="cn-radio"></span>
        <div style="min-width:0">
          <div class="cn-opt-h"><b>${esc(o.title)}</b>${o.level != null && o.level <= 3 ? lvBadge(o.level) : ''}${tag}${o.possible && o.effortShort && !o.current ? `<span class="e">${esc(o.effortShort)}</span>` : ''}</div>
          ${o.sub ? `<div class="cn-opt-s">${esc(o.sub)}</div>` : ''}
          ${o.possible && ((o.pros && o.pros.length) || (o.cons && o.cons.length)) ? `<div class="cn-pc"><ul class="pro">${(o.pros || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul><ul class="con">${(o.cons || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${!o.possible ? `<div class="cn-opt-x"><b>Warum nicht:</b> ${esc(o.reason)}</div>` : ''}
        </div></div>`;
    };
    const inst = p && p.install ? `<div class="cn-inst"><div class="row"><span class="eyebrow">So läuft die Installation · ${esc(p.title)}</span><span class="spacer"></span><span class="muted" style="font-size:12px">${esc(p.downtime || '')}</span></div>
        <ol>${p.install.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : '';
    return `${recHtml}
      <div class="cn-opts-h"><h2 class="cn-h2" style="font-size:16px">Alle Wege für diese Maschine</h2><span class="muted" style="font-size:12px">Auswahl bestimmt Signale und Live-Test</span></div>
      <div class="cn-opts">${a.options.map(optHtml).join('')}</div>${inst}`;
  }

  // ---------------------------------------------------------------- Schritt 3: Signale zuordnen
  function step2Html() {
    const sj = subj(), p = selPath(), rows = mapRows(), M = WZ.map, run = M.phase === 'run';
    const x = ctxNow();
    const gwT = !p.gateway ? '' : /direkt/i.test(p.gateway) ? 'direkt an der Steuerung' : 'an ' + p.gateway;
    const newRows = rows.filter(r => !M.existing[r.id]);
    const chk = rows.filter(r => !M.existing[r.id] && r.conf < 80).length;
    let i = 0;
    const rowH = (r) => {
      const ex = M.existing[r.id], anim = run && !ex, d = anim ? (0.15 + (i++) * 0.23) : 0;
      const v = r.val(x), sel = M.sel[r.id];
      const opts = semOptions(r, rows).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(SEM[k].label)}</option>`).join('');
      const conf = ex ? '<span class="cn-tag act">aktiv</span>' : `${WF.ui.bar(r.conf / 100, { thin: true, color: r.conf >= 90 ? 'var(--st-run)' : r.conf >= 80 ? 'var(--info)' : 'var(--st-wait)' })}<span>${r.conf} %</span>${r.conf < 80 ? '<span class="cn-tag chk">prüfen</span>' : ''}`;
      const note = r.note ? r.note(x) : (ex ? 'bereits zugeordnet' : '');
 return `<div class="cn-mr${anim ? ' anim' : ''}${ex ? ' ex' : ''}${!ex && r.conf < 80 ? ' warn' : ''}" ${anim ? `style="animation-delay:${d.toFixed(2)}s"` : ''} data-row="${esc(r.id)}">
        <div class="raw"><span class="mono" title="${esc(r.raw)}">${esc(r.raw)}</span>${note ? `<span class="nt">${esc(note)}</span>` : ''}</div>
        <div class="val" data-v="${esc(r.id)}">${v.c ? `<i style="--c:${v.c}"></i>` : ''}${esc(v.txt)}</div>
        <div class="arr">${icon('arrowRight', 14)}</div>
        <div class="sem"><select class="input" data-map="${esc(r.id)}" aria-label="Bedeutung von ${esc(r.raw)}" ${anim ? `style="animation-delay:${(d + 0.9).toFixed(2)}s"` : ''}>${opts}</select>
          ${anim ? `<div class="ph" style="animation-delay:${(d + 0.9).toFixed(2)}s"><span class="cn-spin"></span>KI analysiert …</div>` : ''}</div>
        <div class="conf" ${anim ? `style="animation-delay:${(d + 0.9).toFixed(2)}s"` : ''}>${conf}</div></div>`;
    };
    return `<h2 class="cn-h2">Signale zuordnen</h2>
        <p class="cn-p">werkfluss hat ${rows.length} Signale ${esc(gwT)} gefunden${newRows.length < rows.length ? ` (${rows.length - newRows.length} davon bereits aktiv)` : ''} und schlägt ihre Bedeutung vor. Die Live-Werte kommen direkt von der Maschine – jede Zuordnung lässt sich ändern.</p>
        <div class="cn-aist${run ? '' : ' ok'}" data-w="aist">${run ? `<span class="cn-spin"></span><span>KI ordnet <b>${newRows.length}</b> Signale zu – Signalnamen, Wertebereich und Verlauf werden ausgewertet …</span>` : `${icon('check', 15)}<span><b>${newRows.length - chk} von ${newRows.length}</b> ${newRows.length < rows.length ? 'neuen ' : ''}Signalen sicher zugeordnet${chk ? ` · <b>${chk}</b> bitte prüfen (unter 80 %)` : ''}</span>`}</div>
      <div class="cn-map"><div class="cn-mh"><span>Rohsignal</span><span>Live-Wert</span><span></span><span>Bedeutung in werkfluss</span><span>KI-Sicherheit</span></div>${newRows.map(rowH).join('')}
        ${newRows.length < rows.length ? `<div class="cn-msep">${icon('check', 13)}Bereits aktiv seit Level ${sj.cur} · ${rows.length - newRows.length} Signale</div>${rows.filter(r => M.existing[r.id]).map(rowH).join('')}` : ''}</div>
      <div class="cn-val" data-w="val">${run ? '' : valHtml()}</div>`;
  }
  function valHtml() {
    const p = selPath(), v = validate(mapRows(), WZ.map.sel, p.level);
    if (v.ok && !v.warns.length) return `<div class="o">${icon('check', 15)}<span>Alle Pflichtsignale für Level ${p.level} sind zugeordnet. Im Live-Test prüft werkfluss, ob der erkannte Zustand zur Maschine passt.</span></div>`;
    return v.errs.map(e => `<div class="e">${icon('alert', 15)}<span>${esc(e)}</span></div>`).join('') + v.warns.map(w => `<div class="w">${icon('info', 15)}<span>${esc(w)}</span></div>`).join('') +
      (v.ok ? `<div class="o">${icon('check', 15)}<span>Pflichtsignale vollständig.</span></div>` : '');
  }

  // ---------------------------------------------------------------- Schritt 4: Live-Test
  const TEST_STEP = 700;
  function testChecks() {
    const p = selPath(), sj = subj(), rows = mapRows(), sel = WZ.map.sel;
    const n = rows.filter(r => sel[r.id] && sel[r.id] !== 'none').length;
    const gk = p.gateway || 'werkfluss Edge 03', lat = GW_META[gk] ? gwLatency(gk) : 12;
    return [
      { k: 'Verbindung', t: /direkt/i.test(gk) ? `Steuerung direkt erreichbar · Zertifikat vertraut · Latenz ${lat} ms` : `${gk} erreichbar · Latenz ${lat} ms${GW_META[gk] ? ' · ' + GW_META[gk].net : ''}` },
      { k: 'Signale', t: `${n} von ${n} zugeordneten Signalen empfangen · Raster ${sj.demo ? '2' : '5'} s` },
      { k: 'Zeitstempel', t: 'synchron zur werkfluss-Uhr (NTP, Abweichung 2 ms)' },
      { k: 'Zustandserkennung', state: true },
      { k: 'Offline-Puffer', t: 'aktiv – bis zu 72 h Daten bei Netzausfall' },
    ];
  }
  function step3Html() {
    const sj = subj(), p = selPath();
    const checks = testChecks();
    return `<div class="cn-s2-h"><div><h2 class="cn-h2">Live-Test</h2>
        <p class="cn-p">${esc(sj.short)} sendet bereits – werkfluss erkennt den Zustand nur aus den zugeordneten Signalen und vergleicht ihn mit dem, was ${sj.demo ? 'das Inbetriebnahme-Protokoll' : 'werkfluss heute über die Maschine weiß'}.</p></div>
        <span class="cn-live"><i></i>live</span></div>
      <div class="cn-s3-g">
        <div class="cn-det">
          <div class="cn-tower${mapHas('light') || mapHas('run') || mapHas('wait') || mapHas('fault') ? '' : ' cur'}" data-w="tower"><i style="--c:var(--st-fault)"></i><i style="--c:var(--st-wait)"></i><i style="--c:var(--st-run)"></i><em></em><span></span></div>
          <div class="cn-det-b">
            <div class="cn-det-r"><span class="k">Aus den Signalen erkannt</span><span data-w="det">–</span><span class="w" data-w="detWhy">–</span></div>
            <div class="cn-det-r"><span class="k">${sj.demo ? 'Laut Inbetriebnahme' : sj.cur === 0 ? 'werkfluss heute (Tablet / Planung)' : `werkfluss heute (Level ${sj.cur})`}</span><span data-w="exp">–</span><span class="w" data-w="expWhy">–</span></div>
            <div class="cn-det-m pend" data-w="match"><span class="cn-spin"></span>wird geprüft …</div>
          </div>
        </div>
        <div class="cn-s3-r"><div class="cn-tiles" data-w="tiles"></div>
          <div class="cn-chart" data-w="chart" hidden><div class="cn-chart-h"><span class="l" data-w="chartL"></span><span class="v" data-w="chartV"></span></div><div data-w="chartSvg"></div></div></div>
      </div>
      <div class="cn-checks">${checks.map((c, i) => `<div class="cn-ch pend" data-ck="${i}"><span class="ic"><span class="cn-spin"></span></span><span class="k">${esc(c.k)}</span><span class="t" data-ckt="${i}">${c.state ? 'Zustand aus den Signalen ableiten …' : esc(c.t)}</span></div>`).join('')}</div>
      ${compareHtml()}`;
  }
  const mapHas = (k) => WZ.map && Object.values(WZ.map.sel).includes(k);
  function compareHtml() {
    const sj = subj(), p = selPath();
    if (sj.demo) return '';
    const m = S().machines[sj.id], sg = m.signals || {};
    const before = sj.cur === 0 ? { v: `Letzte Tablet-Meldung ${sg.lastFeedbackT != null ? ago(nowT() - sg.lastFeedbackT) : '–'}`, s: 'Stillstände und kurze Unterbrechungen fehlen, bis jemand meldet.' }
      : sj.cur === 1 ? { v: 'Zustand und Energie über Strom und Signalsäule', s: 'Keine Stückzahl, kein Programm, Störungen ohne Code.' }
        : { v: 'Zustand, Programm und Stückzahl aus der Steuerung', s: 'Werkzeugdaten kommen bisher aus der werkfluss-Planung.' };
    const gain = capsFor(sj.type).filter(c => c.v[p.level] === 'auto' && c.v[sj.cur] !== 'auto').map(c => c.label);
    return `<div class="cn-cmp"><div><div class="k">Bisher · ${lvBadge(sj.cur)}</div><div class="v">${esc(before.v)}</div><div class="s">${esc(before.s)}</div></div>
      <div class="now"><div class="k">Ab jetzt · ${lvBadge(p.level)}</div><div class="v">Signale alle 5 s, automatisch</div><div class="s">Neu: ${esc(gain.join(', ') || '–')}.</div></div></div>`;
  }
  function tilesFor(x, lv, sel, rows) {
    const t = [];
    const v = (sem) => { const r = rows.find(rr => sel[rr.id] === sem); return r ? r.val(x) : null; };
    if (lv === 1) {
      const a = v('current'); if (a) t.push(['Laststrom L1', U.fmtNum(a.sv, 1), 'A', null]);
      if (rows.some(r => sel[r.id] === 'power')) t.push(['Wirkleistung', U.fmtNum(x.kw, 1), 'kW', null]);
      if (rows.some(r => r.kind === 'bit' && ['run', 'wait', 'fault'].includes(sel[r.id]))) t.push(['Signalsäule', LIGHT_DE[x.light] || '–', '', null]);
      if (x.runtime != null) t.push(['Laufzeit heute', U.fmtDur(x.runtime), '', null]);
    } else {
      const mo = v('mode'); if (mo) t.push(['Betriebsart', mo.txt, '', null]);
      const li = v('light'); if (li) t.push(['Signalsäule', li.txt, '', null]);
      const r = v('rpm'); if (r && r.sv != null) t.push(['Spindeldrehzahl', U.fmtNum(r.sv), '1/min', null]);
      const ld = v('load'); if (ld && ld.sv != null) t.push(['Spindellast', U.fmtNum(ld.sv), '%', null]);
      const tp = v('temp'); if (tp && tp.sv != null) t.push(['Badtemperatur', U.fmtNum(tp.sv), '°C', null]);
      const phs = v('phase'); if (phs) t.push(['Prozessphase', phs.txt, '', null]);
      const st = v('step'); if (st) t.push(['Montageschritt', st.txt, '', null]);
      const tq = v('torque'); if (tq) t.push(['Anzugsmoment', tq.sv != null ? U.fmtNum(tq.sv, 1) : '–', tq.sv != null ? 'Nm' : '', null]);
      const c = v('count'); if (c) t.push(['Stückzähler', U.fmtNum(c.sv), '', null]);
      const pr = v('prog'); if (pr) t.push(['Programm', pr.txt, '', null, true]);
      const tl = v('tool'); if (tl) t.push(['Werkzeug in der Spindel', tl.sv ? tl.txt : 'kein Werkzeug eingewechselt', '', null, true]);
      const al = v('alarm'); if (al && al.sv) t.push(['Alarm', al.txt, '', null, true]);
    }
    return t;
  }
  /** Kleiner Verlauf (eine Skala ab 0, Raster dezent, Endpunkt betont, optionale Schwelle). */
  function trendSvg(vals, o) {
    const w = o.w, h = o.h, L = 40, R = 10, T = 10, B = 18;
    if (vals.length < 2) return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}"><text x="${L}" y="${h / 2}" style="fill:var(--muted);font:11.5px var(--f-ui)">Messwerte werden gesammelt …</text></svg>`;
    const vmax = Math.max(...vals, o.thr ? o.thr * 1.35 : 0) * 1.12 || 1;
    const step = Math.pow(10, Math.floor(Math.log10(vmax))), top = Math.ceil(vmax / step * 2) / 2 * step;
    const n = Math.max(vals.length, 12);
    const X = (i) => L + i / (n - 1) * (w - L - R), Y = (v) => T + (1 - v / top) * (h - T - B);
    const pts = vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1));
    const lx = X(vals.length - 1), ly = Y(vals[vals.length - 1]);
    const fmt = (v) => U.fmtNum(v, top < 10 && o.dec ? 1 : 0);
    let g = `<line x1="${L}" x2="${w - R}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--line2)"/><line x1="${L}" x2="${w - R}" y1="${Y(top)}" y2="${Y(top)}" style="stroke:var(--line)" stroke-dasharray="2 4"/>`;
    g += `<text x="${L - 6}" y="${Y(0) + 4}" text-anchor="end" style="fill:var(--faint);font:10.5px var(--f-ui)">0</text><text x="${L - 6}" y="${Y(top) + 4}" text-anchor="end" style="fill:var(--faint);font:10.5px var(--f-ui)">${fmt(top)}</text>`;
 let thrG = '';
    if (o.thr) thrG = `<line x1="${L}" x2="${w - R}" y1="${Y(o.thr).toFixed(1)}" y2="${Y(o.thr).toFixed(1)}" style="stroke:var(--st-wait)" stroke-dasharray="5 4" stroke-width="1.2"/><text x="${L + 6}" y="${(Y(o.thr) - 5).toFixed(1)}" style="fill:var(--st-wait);font:600 10.5px var(--f-ui);paint-order:stroke;stroke:var(--bg2);stroke-width:4px;stroke-linejoin:round">Schwelle „läuft“ ${esc(U.fmtNum(o.thr, 1))} ${esc(o.unit)}</text>`;
    const area = `M${X(0).toFixed(1)},${Y(0)} L${pts.join(' L')} L${lx.toFixed(1)},${Y(0)} Z`;
    const dur = (vals.length - 1) * o.sampleSec;
    g += `<path d="${area}" style="fill:var(--info)" opacity=".13"/><polyline points="${pts.join(' ')}" style="fill:none;stroke:var(--info)" stroke-width="1.8" stroke-linejoin="round"/>`;
    g += thrG + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" style="fill:var(--info)" opacity=".25"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.8" style="fill:var(--info)"/>`;
    g += `<text x="${L}" y="${h - 3}" style="fill:var(--faint);font:10.5px var(--f-ui)">vor ${esc(U.fmtDur(dur))}${o.simTime ? ' (Simulationszeit)' : ''}</text><text x="${w - R}" y="${h - 3}" text-anchor="end" style="fill:var(--faint);font:10.5px var(--f-ui)">jetzt</text>`;
    return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${g}</svg>`;
  }
  function patchTest() {
    const T = WZ.test; if (!T) return;
    const c = wzRefs.content; if (!c) return;
    const x = ctxNow(), p = selPath(), rows = mapRows(), sel = WZ.map.sel, sj = subj();
    // Messreihe für die Sparkline
    if (WZ.samples.length === 0 || WZ.samples[WZ.samples.length - 1].T !== x.T) { WZ.samples.push({ T: x.T, amps: x.amps, kw: x.kw, rpm: x.rpm, temp: x.temp }); if (WZ.samples.length > 40) WZ.samples.shift(); }
    const det = detect(rows, sel, x), exp = expectedCat(x.state), match = det.cat != null && catMatches(det.cat, exp);
    const el = (k) => c.querySelector(`[data-w="${k}"]`);
    const elapsed = performance.now() - T.t0;
    const checks = testChecks(), revealed = Math.min(checks.length, Math.floor((elapsed - 500) / TEST_STEP) + 1);
    const tower = el('tower');
    if (tower) { const lights = tower.querySelectorAll('i'); const lg = x.light; const lit = mapHas('light') || mapHas('run') || mapHas('wait') || mapHas('fault'); lights[0].classList.toggle('on', lit && lg === 'red'); lights[1].classList.toggle('on', lit && lg === 'yellow'); lights[2].classList.toggle('on', lit && lg === 'green'); }
    const stateCheckDone = revealed > 3;
    setH(el('det'), det.cat ? WF.ui.pill(det.cat === 'run' ? 'running' : det.cat === 'fault' ? 'fault' : det.cat === 'setup' ? 'setup' : det.cat === 'off' || det.cat === 'stand' ? 'idle' : 'waitOperator', CAT[det.cat].l) : '<span class="muted">nicht eindeutig</span>');
    setT(el('detWhy'), det.why);
    setH(el('exp'), WF.ui.pill(x.state, sj.demo ? (x.state === 'running' ? 'Produktion' : 'Stillstand') : null));
    setT(el('expWhy'), x.cause || '');
    const mt = el('match');
    if (mt) {
      const cls = !stateCheckDone ? 'pend' : match ? 'ok' : 'bad';
      if (mt.className !== 'cn-det-m ' + cls) mt.className = 'cn-det-m ' + cls;
      setH(mt, !stateCheckDone ? '<span class="cn-spin"></span>wird geprüft …' : match ? `${icon('check', 15)}<span>Stimmt überein – die Zuordnung ist plausibel.</span>` : `${icon('alert', 15)}<span>Stimmt nicht überein. Vermutlich sind Signale vertauscht.</span><button class="btn sm danger" data-act="wz-step" data-step="2">Zuordnung prüfen</button>`);
    }
    checks.forEach((ck, i) => {
      const row = c.querySelector(`[data-ck="${i}"]`); if (!row) return;
      const on = i < revealed;
      const ok = ck.state ? match : true;
      const cls = !on ? 'pend' : ok ? 'ok' : 'bad';
      if (!row.classList.contains(cls)) { row.className = 'cn-ch ' + cls + (on ? ' okin' : ''); setH(row.querySelector('.ic'), !on ? '<span class="cn-spin"></span>' : icon(ok ? 'check' : 'x', 13)); }
      if (ck.state) setT(c.querySelector(`[data-ckt="${i}"]`), !on ? 'Zustand aus den Signalen ableiten …' : det.cat ? `${CAT[det.cat].l} (${det.why}) – ${match ? 'passt' : 'passt nicht'} zu „${sj.demo ? (x.state === 'running' ? 'Produktion' : 'Stillstand') : stLabel(x.state)}“` : 'Kein Zustandssignal zugeordnet');
    });
    // Kacheln
    const tiles = tilesFor(x, p.level, sel, rows);
    const key = tiles.map(t => t[0]).join('|');
    const box = el('tiles');
    if (box && box._k !== key) {
      box._k = key;
      box.innerHTML = tiles.map((t, i) => `<div class="cn-tile${t[4] ? ' wide' : ''}"><div class="l">${esc(t[0])}</div><div class="v${t[4] ? ' s' : ''}" data-tv="${i}"></div></div>`).join('');
    }
    if (box) tiles.forEach((t, i) => setH(box.querySelector(`[data-tv="${i}"]`), `${esc(t[1])}${t[2] ? `<small>${esc(t[2])}</small>` : ''}`));
    // Verlauf seit Teststart (eine Skala, Schwelle sichtbar)
    const ch = el('chart');
    if (ch) {
      const usedCur = p.level === 1 && rows.some(r => sel[r.id] === 'current');
      const metric = usedCur || p.level === 1 ? { k: 'amps', l: 'Laststrom seit Teststart', u: 'A', d: 1, thr: x.thrA } : x.rpm != null && rows.some(r => sel[r.id] === 'rpm') ? { k: 'rpm', l: 'Spindeldrehzahl seit Teststart', u: '1/min', d: 0 } : x.temp != null ? { k: 'temp', l: 'Badtemperatur seit Teststart', u: '°C', d: 0 } : null;
      ch.hidden = !metric;
      if (metric) {
        const vals = WZ.samples.map(s2 => s2[metric.k]).filter(v2 => v2 != null);
        setT(el('chartL'), metric.l);
        setH(el('chartV'), vals.length ? `${esc(U.fmtNum(vals[vals.length - 1], metric.d))} <small>${esc(metric.u)}</small>` : '–');
        const host = el('chartSvg'), w = Math.max(240, Math.round(host.clientWidth || 420));
        const sig = w + '|' + vals.join(',') + '|' + (metric.thr || '');
        if (host._s !== sig) { host._s = sig; host.innerHTML = trendSvg(vals, { w, h: 104, thr: metric.thr, unit: metric.u, dec: metric.d, sampleSec: x.demo ? 2 : 5, simTime: !x.demo }); }
      }
    }
    // Abschluss
    const finished = revealed >= checks.length;
    if (finished && T.phase !== 'done') { T.phase = 'done'; }
    if (finished) T.pass = match;
  }

  // ---------------------------------------------------------------- Schritt 5: Fertig
  function step4Html() {
    const sj = subj(), D = WZ.done;
    const caps = capsFor(sj.type);
    const gain = caps.filter(c => c.v[D.to] === 'auto' && c.v[D.from] !== 'auto');
    const keep = caps.filter(c => c.v[D.to] === 'manuell');
    const gwT = !D.gateway || D.gateway === '–' ? '–' : /direkt/i.test(D.gateway) ? 'direkt über das Firmennetz' : D.gateway;
    if (D.demo) {
      return `<div class="cn-done"><span class="cn-done-ic">${icon('check', 30)}</span><div><h3>${esc(sj.short)} ist vorbereitet</h3>
          <p>Level ${D.to} · ${esc(D.protocol)} · ${esc(gwT)}. Sobald die Maschine in der Halle steht und eingeplant ist, liefert sie ab dem ersten Teil Daten.</p></div></div>
        <span class="cn-lbl">Damit verfügbar</span>
        <div class="cn-caps">${gain.map((c, i) => `<div class="cn-cap" style="animation-delay:${i * 0.07}s">${icon('check', 16)}<div>${esc(c.label)}<span>${esc(c.d)}</span></div></div>`).join('')}
          ${keep.map(c => `<div class="cn-cap keep">${icon('dot', 16)}<div>${esc(c.label)}<span>weiter per Tablet</span></div></div>`).join('')}</div>
        <span class="cn-lbl">Nächste Schritte</span>
        <div class="cn-caps"><div class="cn-cap keep">${icon('grid', 16)}<div>Station im Hallenlayout platzieren<span>Bereich: ${esc(sj.area)}</span></div></div>
          <div class="cn-cap keep">${icon('list', 16)}<div>Arbeitsgänge und Stundensatz zuordnen<span>Vorschlag: ${esc(U.fmtEur(sj.rate))}/h</span></div></div>
          <div class="cn-cap keep">${icon('users', 16)}<div>Qualifikationen hinterlegen<span>wer die Maschine bedienen und rüsten darf</span></div></div></div>
        <div class="cn-note" style="--c:var(--muted)">${icon('info', 16)}<div>Demo: Die Simulation der Donau-Halle wird dabei nicht verändert.</div></div>`;
    }
    return `<div class="cn-done"><span class="cn-done-ic">${icon('check', 30)}</span><div><h3>${esc(sj.short)} ist jetzt digital angebunden</h3>
        <p>Level ${D.from} → <b>Level ${D.to}</b> · ${esc(D.protocol)} · ${esc(gwT)} · aktiv seit ${esc(U.fmtClock(D.t))}</p></div></div>
      <span class="cn-lbl">Jetzt automatisch in werkfluss</span>
      <div class="cn-caps">${gain.map((c, i) => `<div class="cn-cap" style="animation-delay:${i * 0.07}s">${icon('check', 16)}<div>${esc(c.label)}<span>${esc(c.d)}</span></div></div>`).join('')}
        ${keep.map(c => `<div class="cn-cap keep">${icon('dot', 16)}<div>${esc(c.label)}<span>weiter per Tablet-Rückmeldung</span></div></div>`).join('')}</div>
      <span class="cn-lbl">Erste Live-Werte aus der Engine <span class="cn-live" style="margin-left:8px"><i></i>live</span></span>
      <div class="cn-tiles" style="margin-top:9px" data-w="dtiles"></div>
      <span class="cn-lbl">Wo Sie es sehen</span>
      <div class="cn-where">
        <button class="btn" data-act="sel" data-id="${esc(sj.id)}">${icon('eye', 15)}Maschinendetail · Live-Signale</button>
        ${WF.views.some(v => v.id === 'leitstand') ? `<button class="btn" data-act="nav" data-view="leitstand">${icon('grid', 15)}Leitstand-Kachel (L${D.to})</button>` : ''}
        ${WF.views.some(v => v.id === 'halle') ? `<button class="btn" data-act="nav" data-view="halle">${icon('cube', 15)}Halle 3D · Datenfluss</button>` : ''}
      </div>`;
  }
  function patchDone() {
    const box = wzRefs.content && wzRefs.content.querySelector('[data-w="dtiles"]'); if (!box) return;
    const id = WZ.id, m = S().machines[id], sg = m.signals || {}, lv = m.conn.level || 0, st = ST(id);
    const t = [];
    if (lv === 1) { t.push(['Leistung', U.fmtNum(sg.powerKw, 1), 'kW'], ['Laststrom', U.fmtNum(sg.currentA, 1), 'A'], ['Signalsäule', LIGHT_DE[sg.stackLight] || '–', ''], ['Laufzeit heute', U.fmtDur(sg.runtimeTodaySec), '']); }
    else if (lv >= 2) {
      t.push(['Betriebsart', MODE_DE[sg.mode] || sg.mode || '–', ''], ['Signalsäule', LIGHT_DE[sg.stackLight] || '–', '']);
      if (sg.spindleRpm != null) t.push(['Spindeldrehzahl', U.fmtNum(sg.spindleRpm), '1/min']);
      if (sg.bathTempC != null) t.push(['Badtemperatur', U.fmtNum(sg.bathTempC), '°C']);
      if (sg.terminalStep != null) t.push(['Montageschritt', sg.terminalStep, '']);
      t.push(['Stückzähler', U.fmtNum(sg.partCounter), '']);
      if (lv >= 3 && sg.toolInSpindleName) t.push(['Werkzeug in der Spindel', sg.toolInSpindleName, '', true]);
      t.push(['Programm', sg.program || '–', '', true]);
      if (sg.alarm) t.push(['Alarm', sg.alarm, '', true]);
    }
    t.push(['Zustand', stLabel(m.state), '', false, true]);
    const html = t.map(x => `<div class="cn-tile${x[3] ? ' wide' : ''}"><div class="l">${esc(x[0])}</div><div class="v${x[3] ? ' s' : ''}">${x[4] ? WF.ui.pill(m.state) : esc(x[1]) + (x[2] ? `<small>${esc(x[2])}</small>` : '')}</div></div>`).join('') +
      `<div class="cn-tile wide"><div class="l">Quelle</div><div class="v s">${esc(sg.source || m.conn.protocol)} · ${esc(/direkt/i.test(m.conn.gateway) ? 'direkt' : m.conn.gateway)} · Stand ${esc(U.fmtClock(sg.t != null ? sg.t : nowT()))} (${esc(ago(sg.t != null ? nowT() - sg.t : null))}) · ${esc(st.short)}</div></div>`;
    setH(box, html);
  }

  // ---------------------------------------------------------------- Live-Patches im Assistenten
  function patchWizard() {
    if (!WZ) return;
    const c = wzRefs.content; if (!c) return;
    if (WZ.autoScanAt && performance.now() >= WZ.autoScanAt) { WZ.autoScanAt = 0; if (WZ.step === 0 && WZ.scan.phase === 'idle') { WZ.scan = { phase: 'run', t0: performance.now() }; renderWizard(); return; } }
    // Scan-Ende
    if (WZ.scan.phase === 'run' && performance.now() - WZ.scan.t0 > 2900) { WZ.scan.phase = 'done'; renderWizard(); return; }
    if (WZ.step === 2 && WZ.map && WZ.map.phase === 'run') {
      const n = mapRows().filter(r => !WZ.map.existing[r.id]).length;
      if (performance.now() - WZ.map.t0 > mapDur(n)) { WZ.map.phase = 'done'; renderWizard(); return; }
    }
    if (WZ.done) { patchDone(); return; }
    if (WZ.step === 2 && WZ.map) {
      const x = ctxNow();
      for (const r of mapRows()) { const e = c.querySelector(`[data-v="${r.id}"]`); if (!e) continue; const v = r.val(x); setH(e, `${v.c ? `<i style="--c:${v.c}"></i>` : ''}${esc(v.txt)}`); }
    }
    if (WZ.step === 3) {
      const before = WZ.test && WZ.test.phase + WZ.test.pass;
      patchTest();
      const after = WZ.test && WZ.test.phase + WZ.test.pass;
      if (before !== after) { const parts = { stepper: stepperHtml(), aside: asideHtml(), foot: footHtml() }; for (const k in parts) if (wzSig[k] !== parts[k]) { wzSig[k] = parts[k]; wzRefs[k].innerHTML = parts[k]; } }
    }
  }
  function onMapChange(rowId, val) {
    if (!WZ || !WZ.map) return;
    WZ.map.sel[rowId] = val;
    WZ.test = null;
    const v = wzRefs.content.querySelector('[data-w="val"]'); if (v) v.innerHTML = valHtml();
    const parts = { stepper: stepperHtml(), aside: asideHtml(), foot: footHtml() };
    for (const k in parts) if (wzSig[k] !== parts[k]) { wzSig[k] = parts[k]; wzRefs[k].innerHTML = parts[k]; }
  }

  // =================================================================== Ereignisse
  function onClick(e) {
    const t = e.target.closest('[data-act]'); if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'sel' && e.target.closest('button,select,a') && e.target.closest('button,select,a') !== t) return;
    switch (act) {
      case 'sel': WF.app.select('machine', t.dataset.id); break;
      case 'nav': WF.app.navigate(t.dataset.view); break;
      case 'filter': filter = t.dataset.f; ovSig = ''; update(); break;
      case 'wz-open': e.stopPropagation(); openWizard({ machineId: t.dataset.id }); break;
      case 'wz-new': openWizard({ newMachine: true, demo: 'mori' }); break;
      case 'wz-close': closeWizard(); break;
      case 'wz-next': if (canNext().ok) goStep(WZ.step + 1); break;
      case 'wz-back': goStep(WZ.step - 1); break;
      case 'wz-step': goStep(Number(t.dataset.step)); break;
      case 'wz-scan': WZ.scan = { phase: 'run', t0: performance.now() }; renderWizard(); break;
      case 'wz-demo': if (WZ.demo !== t.dataset.key) { WZ.demo = t.dataset.key; WZ.t0 = performance.now(); resetFromMachine(); renderWizard(); } break;
      case 'wz-path': if (WZ.pathKey !== t.dataset.key) { WZ.pathKey = t.dataset.key; WZ.map = null; WZ.test = null; WZ.reached = 1; renderWizard(); } break;
      case 'wz-activate': if (canNext().ok) activate(); break;
      case 'ask': {
        const sj = subj(), p = selPath();
        WF.bus.emit('ai:ask', { text: `Warum empfiehlt werkfluss für ${sj.short} (${sj.vendor} ${sj.model}, Baujahr ${sj.year}, Steuerung ${sj.control}) die Anbindung „${p ? p.title : ''}“ (Level ${p ? p.level : '?'})? Was bringt das im Alltag, und was bleibt manuell?`, context: sj.demo ? null : { kind: 'machine', id: sj.id } });
        break;
      }
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches('select[data-f="machine"]')) { WZ.id = t.value; WZ.t0 = performance.now(); resetFromMachine(); renderWizard(); return; }
    if (t.matches('select[data-map]')) onMapChange(t.dataset.map, t.value);
  }
  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.cn-opt[data-act], .cn-lr[data-act]')) { e.preventDefault(); e.target.click(); }
  }
  function onHover(e) {
    const g = e.target.closest && e.target.closest('.fx-chip'); const host = ovRefs && ovRefs.flow; if (!host) return;
    host.querySelectorAll('.fx-p.hl, .fx-chip.hl').forEach(x => x.classList.remove('hl'));
    if (g && e.type === 'mouseover') { g.classList.add('hl'); const p = host.querySelector(`.fx-p[data-p="${g.dataset.chip}"]`); if (p) p.classList.add('hl'); }
  }

  // =================================================================== Lebenszyklus
  function mount(el) {
    root = el;
    root.classList.add('cn-root');
    ovEl = document.createElement('div');
    wzEl = document.createElement('div'); wzEl.hidden = true;
    root.append(ovEl, wzEl);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    root.addEventListener('mouseover', onHover);
    root.addEventListener('mouseout', onHover);
    if (window.ResizeObserver) { ro = new ResizeObserver(() => { if (!WZ && ovRefs) renderFlow(false); }); ro.observe(root); }
    WF.bus.on('sim:reset', () => { ovSig = ''; for (const k in analysisCache) delete analysisCache[k]; if (WZ && WZ.done) closeWizard(); else if (WZ) { resetFromMachine(); wzSig = {}; renderWizard(); } });
  }
  function show(params) {
    params = params || {};
    const opening = (params.machineId && S().machines[params.machineId]) || params.newMachine;
    if (opening && WF.app.selected) WF.app.closeDrawer();
    if (params.machineId && S().machines[params.machineId]) {
      openWizard({ machineId: params.machineId });
      // In der Demo-Tour startet die Typenschild-Erkennung von selbst – der Vortragende muss nichts klicken
      if (WZ && (params.autoScan || (WF.tour && WF.tour.active)) && plateFor(subj())) WZ.autoScanAt = performance.now() + 900;
    } else if (params.newMachine) openWizard({ newMachine: true, demo: params.demo || 'mori' });
    else if (WZ && (WZ.done || (WZ.step === 0 && WZ.reached === 0 && WZ.scan.phase === 'idle'))) closeWizard();
  }
  function update() {
    if (!root || !WF.sim || !WF.sim.state) return;
    if (WZ) { patchWizard(); return; }
    const sig = structSig();
    if (sig !== ovSig) { ovSig = sig; renderOverview(); }
    patchOverview();
  }

  WF.registerView({
    id: 'anbindung', title: 'Anbindung', icon: 'plug', group: 'einrichtung', order: 8,
    mount, show, update, hide() { /* Zustand bleibt erhalten */ },
    badge: () => { if (!WF.sim || !WF.sim.state) return ''; const c = counts(); return (IDS().length - c[0]) + '/' + IDS().length; },
  });

  /** Öffentliche Schnittstelle (Tour, andere Ansichten, Tests) */
  WF.connect = {
    open: (machineId) => WF.app.navigate('anbindung', { machineId }),
    openNew: (demo) => WF.app.navigate('anbindung', { newMachine: true, demo }),
    close: () => { if (WZ) closeWizard(); },
    previewSignals,
    recommend: (id) => { const a = analyze(subjectOf(id)); return a.rec ? { level: a.rec.level, protocol: a.rec.protocol, title: a.rec.title, why: a.rec.why || [] } : null; },
    maxLevel: (id) => analyze(subjectOf(id)).max,
    get wizard() { return WZ ? { mode: WZ.mode, id: WZ.id, step: WZ.done ? 4 : WZ.step, path: WZ.pathKey, done: !!WZ.done } : null; },
  };
})();
