/* werkfluss – Ansicht „Halle 3D“: digitaler Zwilling der Halle (Three.js r147, global THREE + THREE.OrbitControls).
   Gebäude, Maschinen je Typ prozedural modelliert, Lager/Zonen, Personen, AGVs, Stapler, Behälter.
   Ebenen: Materialfluss (aktive Transporte), Datenfluss (Maschinen-Ereignisse → Kabeltrasse → MES-Server,
   Meldungen → Personen), Personen, Beschriftungen.
   Liest ausschließlich WF.sim.state und abgeleitete Sichten (machineView, containerView, orderView);
   Klick → WF.app.select(kind, id). Öffentlich: WF.hall = { focusStation(id), focusOrder(id) }. CSS-Präfix .h3- */
(function () {
  'use strict';
  const WF = window.WF;
  if (!WF || !WF.registerView) return;
  const THREE = window.THREE;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;
  const PI = Math.PI, TAU = Math.PI * 2;
  const clamp = U.clamp;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const angD = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const fmtN = (n) => U.fmtNum(n, 0);

  // ================================================================== CSS
  css(`
.h3-root{position:absolute;inset:0;overflow:hidden;background:var(--bg);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.h3-cv{position:absolute;inset:0;display:block;width:100%;height:100%;outline:none;touch-action:none}
.h3-root.hov .h3-cv{cursor:pointer}
.h3-glass{background:color-mix(in srgb,var(--panel) 80%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);border:1px solid color-mix(in srgb,var(--line2) 85%,transparent);border-radius:12px;box-shadow:0 12px 30px rgba(2,6,16,.42)}
.h3-ov{position:absolute;z-index:4}
.h3-status{left:14px;top:14px;width:318px;padding:11px 13px 12px}
.h3-st-h{display:flex;align-items:center;gap:10px;min-width:0}
.h3-live{display:inline-flex;align-items:center;gap:7px;font:600 10.5px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.h3-live i{width:7px;height:7px;border-radius:50%;background:var(--st-run);animation:h3pulse 2.2s infinite}
@keyframes h3pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--st-run) 60%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.h3-clock{margin-left:auto;font:600 20px/1 var(--f-cond);font-variant-numeric:tabular-nums;letter-spacing:.02em;white-space:nowrap}
.h3-shift{font-size:12px;color:var(--text2);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-shift.br{color:var(--st-wait)}
.h3-kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:11px;padding-top:10px;border-top:1px solid color-mix(in srgb,var(--line2) 70%,transparent)}
.h3-kv>div{min-width:0}
.h3-kv .l{display:block;font:600 9.5px/1.25 var(--f-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3-kv b{display:block;font:600 23px/1.05 var(--f-cond);font-variant-numeric:tabular-nums;margin-top:4px;white-space:nowrap}
.h3-kv b small{font-size:14px;color:var(--muted);font-weight:500;margin-left:1px}
.h3-kv .s{display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.h3-strip{display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:3px;margin-top:11px}
.h3-strip button{--c:var(--st-idle);position:relative;height:24px;min-width:0;border-radius:5px;border:0;padding:0;cursor:pointer;background:color-mix(in srgb,var(--c) 20%,var(--card));box-shadow:inset 0 -3px 0 var(--c);color:var(--text2);font:600 9.5px/24px var(--f-mono);overflow:hidden}
.h3-strip button:hover{background:color-mix(in srgb,var(--c) 34%,var(--card));color:var(--text)}
.h3-strip button.fl{animation:h3blink 1.1s steps(2,start) infinite}
@keyframes h3blink{50%{background:color-mix(in srgb,var(--c) 55%,var(--card))}}
.h3-ctl{right:14px;top:14px;width:236px;padding:10px 10px 11px}
.h3-sec{font:600 10px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:3px 5px 8px}
.h3-pre{display:flex;flex-direction:column;gap:1px;margin-bottom:9px}
.h3-pre button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:transparent;color:var(--text2);padding:6px 7px;border-radius:7px;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.h3-pre button .ico{color:var(--faint);flex:none}
.h3-pre button:hover{background:color-mix(in srgb,var(--raise) 55%,transparent);color:var(--text)}
.h3-pre button.on{background:var(--raise);color:var(--text)}
.h3-pre button.on .ico{color:var(--accent)}
.h3-lay{display:flex;flex-wrap:wrap;gap:5px}
.h3-chip{--c:var(--accent);display:inline-flex;align-items:center;gap:6px;padding:4px 9px 4px 7px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap}
.h3-chip i{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--c);flex:none}
.h3-chip:hover{color:var(--text)}
.h3-chip.on{color:var(--text);border-color:color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 13%,transparent)}
.h3-chip.on i{background:var(--c)}
.h3-legend{left:14px;bottom:14px;padding:10px 13px 11px;font-size:11.5px;color:var(--text2);display:grid;grid-template-columns:auto auto;gap:0 20px}
.h3-legend .h3-sec{grid-column:1/-1;padding:2px 0 7px}
.h3-lg{display:flex;align-items:center;gap:7px;line-height:19px;white-space:nowrap}
.h3-lg i{width:9px;height:9px;border-radius:3px;background:var(--c);flex:none}
.h3-lg i.ln{width:16px;height:3px;border-radius:2px;box-shadow:0 0 6px var(--c)}
.h3-lg i.pt{width:8px;height:8px;border-radius:50%;box-shadow:0 0 7px var(--c)}
.h3-lg i.rg{width:10px;height:10px;border-radius:50%;background:transparent;border:2px solid var(--c)}
.h3-lg i.vest{width:9px;height:11px;border-radius:3px 3px 2px 2px}
.h3-lgc{display:flex;flex-direction:column}
.h3-lgc+.h3-lgc{border-left:1px solid color-mix(in srgb,var(--line2) 70%,transparent);padding-left:16px;margin-left:-4px}
.h3-sel{left:50%;bottom:14px;transform:translateX(-50%);padding:6px 6px 6px 13px;display:flex;align-items:center;gap:10px;font-size:12.5px;max-width:calc(100% - 28px)}
.h3-sel .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.h3-sel .k{color:var(--muted);white-space:nowrap}
.h3-sel .btn.on{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.h3-hint{right:14px;bottom:14px;font-size:11px;color:var(--faint);padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--bg) 55%,transparent);transition:opacity .6s;pointer-events:none;white-space:nowrap}
.h3-hint.gone{opacity:0}
.h3-labels{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden;contain:strict}
.h3-lb{--c:var(--st-idle);position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;white-space:nowrap;background:color-mix(in srgb,var(--bg) 86%,transparent);border:1px solid color-mix(in srgb,var(--c) 42%,var(--line2));border-radius:8px;padding:4px 8px 4px 7px;font:500 11.5px/1.25 var(--f-ui);color:var(--text);box-shadow:0 4px 14px rgba(0,0,0,.38);transition:opacity .16s;will-change:transform}
.h3-lb::after{content:"";position:absolute;left:50%;top:100%;width:1px;height:8px;background:linear-gradient(color-mix(in srgb,var(--c) 75%,transparent),transparent)}
.h3-lb.off{opacity:0;pointer-events:none}
.h3-lb .r1{display:flex;align-items:center;gap:6px}
.h3-lb .d{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 6px var(--c)}
.h3-lb b{font:600 12.5px/1 var(--f-cond);letter-spacing:.03em}
.h3-lb .nm{color:var(--text2)}
.h3-lb .ct{font:500 10.5px/1 var(--f-mono);color:var(--text2);margin-left:2px}
.h3-lb .wz{display:inline-flex;color:var(--st-tool)}
.h3-lb .r2{display:flex;gap:7px;align-items:center;margin-top:4px;font-size:11px;color:var(--muted)}
.h3-lb .st{color:color-mix(in srgb,var(--c) 80%,white);font-weight:600}
.h3-lb .r3{margin-top:5px;font-size:10.5px;color:var(--text2);display:flex;align-items:center;gap:6px}
.h3-lb .r3 .bar{flex:1;min-width:60px}
.h3-lb .r4{margin-top:3px;font-size:10.5px;color:var(--muted);max-width:230px;overflow:hidden;text-overflow:ellipsis}
.h3-lb .r4 .t{color:var(--st-tool)}
.h3-lb[data-l="0"]{padding:3px 6px}
.h3-lb[data-l="0"] .nm,.h3-lb[data-l="0"] .ct,.h3-lb[data-l="0"] .wz,.h3-lb[data-l="0"] .r2,.h3-lb[data-l="0"] .r3,.h3-lb[data-l="0"] .r4,.h3-lb[data-l="1"] .r2,.h3-lb[data-l="1"] .r3,.h3-lb[data-l="1"] .r4{display:none}
.h3-lb.flt .d{animation:h3dot 1s steps(2,start) infinite}
@keyframes h3dot{50%{opacity:.25}}
.h3-lb.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 6px 18px rgba(0,0,0,.45)}
.h3-lb.dim{opacity:.38}
.h3-lb.rt{--c:var(--text);background:color-mix(in srgb,var(--bg) 90%,transparent);border-color:color-mix(in srgb,var(--rc) 60%,transparent);padding:3px 8px 3px 4px;cursor:default}
.h3-lb.rt::after{display:none}
.h3-lb.rt .n{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:9px;background:var(--rc);color:var(--bg);font:700 11px/1 var(--f-ui);padding:0 5px}
.h3-lb.rt .o{font-size:11px;color:var(--text2)}
.h3-lb.rt .s{font-size:10.5px;color:var(--muted)}
.h3-tip{position:absolute;z-index:6;left:0;top:0;width:330px;max-width:calc(100% - 20px);pointer-events:none;padding:11px 13px 12px;font-size:12.5px;opacity:0;transition:opacity .12s}
.h3-tip.on{opacity:1}
.h3-tip .h{display:flex;align-items:flex-start;gap:10px}
.h3-tip .t{font:600 17px/1.12 var(--f-cond);min-width:0}
.h3-tip .t small{display:block;font:500 11.5px/1.3 var(--f-ui);color:var(--muted);margin-top:2px}
.h3-tip .h .pill{margin-left:auto;flex:none}
.h3-tip .cz{margin-top:8px;padding:7px 9px;border-radius:7px;background:color-mix(in srgb,var(--c,var(--st-idle)) 10%,var(--bg2));border:1px solid color-mix(in srgb,var(--c,var(--st-idle)) 30%,transparent);color:var(--text2);font-size:12px;line-height:1.4}
.h3-tip .dl{margin-top:9px;font-size:12px;gap:4px 12px}
.h3-tip .dl dd{color:var(--text)}
.h3-tip .pg{display:flex;align-items:center;gap:8px}
.h3-tip .pg .bar{flex:1}
.h3-tip .ft{margin-top:9px;font-size:11px;color:var(--faint)}
.h3-tip .tw{color:var(--st-tool)}
.h3-mline{display:none}
.h3-mbar{display:none;left:50%;bottom:10px;transform:translateX(-50%);padding:4px;gap:3px}
.h3-mbar button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--text2);padding:8px 11px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.h3-mbar button.on{background:var(--raise);color:var(--text)}
.h3-fb{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 40%,var(--card) 0%,var(--bg) 70%)}
.h3-fb .card{max-width:440px;padding:22px 24px;text-align:left}
.h3-fb h3{margin:10px 0 6px;font:600 22px/1.1 var(--f-cond)}
.h3-fb p{margin:0 0 14px;color:var(--text2);font-size:13px}
.h3-root.m .h3-status{left:8px;right:8px;top:8px;width:auto;padding:8px 11px}
.h3-root.m .h3-kv,.h3-root.m .h3-strip,.h3-root.m .h3-shift{display:none}
.h3-root.m .h3-mline{display:flex;gap:10px;margin-top:5px;font-size:11.5px;color:var(--text2);white-space:nowrap;overflow:hidden}
.h3-root.m .h3-mline b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
.h3-root.m .h3-clock{font-size:17px}
.h3-root.m .h3-ctl,.h3-root.m .h3-legend,.h3-root.m .h3-hint{display:none}
.h3-root.m .h3-ctl.open,.h3-root.m .h3-legend.open{display:block;left:8px;right:8px;top:auto;bottom:60px;width:auto;max-height:calc(100% - 140px);overflow:auto}
.h3-root.m .h3-legend.open{display:grid}
.h3-root.m .h3-mbar{display:flex}
.h3-root.m .h3-sel{bottom:60px}
.h3-root.m .h3-tip{display:none}
`, 'h3-css');

  // ================================================================== Laufzeitzustand
  const R = {
    root: null, ok: false, failed: false, visible: false, mobile: false,
    renderer: null, scene: null, camera: null, controls: null, canvas: null,
    w: 1, h: 1, dpr: 1, dprMax: 1, aniso: 4,
    time: 0, renderT: 0, lastT: -1, sT0: 0, sT1: 0, alpha: 1,
    layers: { flow: true, data: true, people: true, labels: true },
    mo: {}, moList: [], people: {}, agvs: {}, fork: null,
    tween: null, follow: null, preset: 'uebersicht',
    sel: null, hover: null, hoverDirty: false, mouse: { x: 0, y: 0, in: false }, down: null,
    pick: [], ui: {}, uiRects: [],
    shadowAcc: 0, perfAcc: 0, perfN: 0, perfLow: 0, perfHigh: 0,
    pending: null, lastCounter: {}, seenNotif: new Set(),
  };
  let M = null;          // Materialien
  let V1, V2, V3, Q1, M4, COL, RAY, NDC;  // temporäre Objekte (nach THREE-Prüfung)

  // ================================================================== Geometrie-Helfer
  const GC = new Map();
  const cache = (k, f) => { let g = GC.get(k); if (!g) { g = f(); GC.set(k, g); } return g; };
  const gBox = () => cache('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const gBoxC = () => cache('boxc', () => new THREE.BoxGeometry(1, 1, 1));
  const gCyl = (seg = 20) => cache('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0));
  const gCylC = (seg = 20) => cache('cylc' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg));
  const gSph = (seg = 16) => cache('sph' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1)));
  function rrShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2; r = Math.max(0.001, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /** Quader mit gerundeten senkrechten Kanten (+ optional Fase oben/unten); Boden bei y = 0. */
  function gRBox(w, h, d, r, bev) {
    const k = ['rb', w.toFixed(3), h.toFixed(3), d.toFixed(3), r.toFixed(3), (bev || 0).toFixed(3)].join('|');
    return cache(k, () => {
      const b = Math.min(bev || 0, h / 3, w / 4, d / 4);
      const g = new THREE.ExtrudeGeometry(rrShape(w - 2 * b, d - 2 * b, Math.max(0.002, r - b)), {
        depth: Math.max(0.001, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
      g.rotateX(-PI / 2); g.translate(0, b, 0);
      return g;
    });
  }
  function gIBeam(hgt, w, fl, web) {
    return cache('ib' + hgt + w, () => {
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
    return cache('ob' + w + h + d, () => {
      const g = new THREE.BoxGeometry(w, h, d);
      const idx = g.index.array, keep = [];
      for (let i = 0; i < idx.length; i += 3) {
        // obere Fläche (+y) entfernen: alle drei Ecken auf y = +h/2
        const ys = [idx[i], idx[i + 1], idx[i + 2]].map(v => g.attributes.position.getY(v));
        if (ys.every(y => y > h / 2 - 1e-6)) continue;
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep); g.clearGroups(); g.translate(0, h / 2, 0);
      return g;
    });
  }
  function xf(x, y, z, rx, ry, rz, sx, sy, sz) {
    const e = new THREE.Euler(rx || 0, ry || 0, rz || 0);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e),
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }
  function mergeGeos(list) {
    let n = 0; const parts = [];
    for (const [g, mx] of list) { const gg = g.index ? g.toNonIndexed() : g.clone(); gg.applyMatrix4(mx); parts.push(gg); n += gg.attributes.position.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const gg of parts) {
      const c = gg.attributes.position.count;
      pos.set(gg.attributes.position.array, o * 3);
      if (gg.attributes.normal) nor.set(gg.attributes.normal.array, o * 3);
      if (gg.attributes.uv) uv.set(gg.attributes.uv.array, o * 2);
      o += c; gg.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  /** Sammelt statische Teile je Material und verschmilzt sie (wenige Draw-Calls). */
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
    build(parent, shadow = true) {
      const out = [];
      for (const [mat, list] of this.map) {
        const mesh = new THREE.Mesh(mergeGeos(list), mat);
        const tr = mat.transparent || mat.isMeshBasicMaterial;
        mesh.castShadow = shadow && !tr; mesh.receiveShadow = !mat.isMeshBasicMaterial;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
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
    m.castShadow = !mat.transparent; m.receiveShadow = true;
    return m;
  }
  /** lokale Rotation um y: (lx, lz) → Welt-Offset */
  const rotXZ = (lx, lz, ry) => [lx * Math.cos(ry) + lz * Math.sin(ry), -lx * Math.sin(ry) + lz * Math.cos(ry)];
  /** sRGB-Hex → Color mit Rohwerten (für eigene Shader ohne Farbraumumrechnung) */
  function srgb(hex, out) {
    const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
    return (out || new THREE.Color()).setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  const hexN = (h) => (typeof h === 'number' ? h : parseInt(String(h || '#7b8aa8').replace('#', ''), 16));

  // ================================================================== Texturen (Canvas)
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, o = {}) {
    const t = new THREE.CanvasTexture(c);
    if (o.srgb !== false) t.encoding = THREE.sRGBEncoding;
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    t.anisotropy = o.aniso || R.aniso;
    return t;
  }
  const FONT = (w, px) => `${w} ${px}px "Barlow Condensed", "Barlow", "Arial Narrow", Arial, sans-serif`;
  function spacedText(g, text, x, y, sp) {
    const chars = [...text]; let tw = 0; const ws = chars.map(ch => { const w = g.measureText(ch).width; tw += w; return w; });
    tw += sp * (chars.length - 1);
    let cx = x - tw / 2;
    chars.forEach((ch, i) => { g.fillText(ch, cx + ws[i] / 2, y); cx += ws[i] + sp; });
  }
  function texConcrete() {
    const N = 1024, c = cnv(N, N), g = c.getContext('2d'), rnd = U.rng(11);
    g.fillStyle = '#a6aaae'; g.fillRect(0, 0, N, N);
    const blob = (x, y, r, col) => {
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const X = x + ox, Y = y + oy; if (X + r < 0 || X - r > N || Y + r < 0 || Y - r > N) continue;
        const gr = g.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(X - r, Y - r, 2 * r, 2 * r);
      }
    };
    for (let i = 0; i < 240; i++) blob(rnd.range(0, N), rnd.range(0, N), rnd.range(40, 260), rnd.chance(0.5) ? `rgba(255,255,255,${rnd.range(0.02, 0.055).toFixed(3)})` : `rgba(40,46,54,${rnd.range(0.025, 0.065).toFixed(3)})`);
    const img = g.getImageData(0, 0, N, N), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd.next() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 3200; i++) { g.fillStyle = rnd.chance(0.5) ? 'rgba(60,66,72,.22)' : 'rgba(240,242,244,.2)'; const s = rnd.range(0.6, 2.2); g.fillRect(rnd.range(0, N), rnd.range(0, N), s, s); }
    // Schnittfugen am Kachelrand (Raster 6 m)
    g.fillStyle = 'rgba(38,42,48,.5)'; g.fillRect(0, 0, N, 3); g.fillRect(0, 0, 3, N);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, 3, N, 1); g.fillRect(3, 0, 1, N);
    return tex(c, { repeat: [64 / 6, 40 / 6] });
  }
  function texGround() {
    const N = 512, c = cnv(N, N), g = c.getContext('2d');
    g.fillStyle = '#121a29'; g.fillRect(0, 0, N, N);
    const rnd = U.rng(3);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${rnd.range(0.01, 0.035).toFixed(3)})`; g.fillRect(rnd.range(0, N), rnd.range(0, N), 1.5, 1.5); }
    g.strokeStyle = 'rgba(120,150,200,.12)'; g.lineWidth = 2; g.strokeRect(1, 1, N - 2, N - 2);
    return tex(c, { repeat: [60, 60] });
  }
  function texStripes(c1, c2, n = 8) {
    const N = 128, c = cnv(N, N), g = c.getContext('2d');
    g.fillStyle = c1; g.fillRect(0, 0, N, N); g.fillStyle = c2;
    for (let i = -n; i < n * 2; i++) { g.beginPath(); const x = i * N / n; g.moveTo(x, 0); g.lineTo(x + N / n / 2, 0); g.lineTo(x + N / n / 2 - N, N); g.lineTo(x - N, N); g.closePath(); g.fill(); }
    return tex(c);
  }
  function texWall() {
    const W = 512, Hh = 512, c = cnv(W, Hh), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#c9ced3'); gr.addColorStop(1, '#b9bfc5');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    for (let y = 0; y < Hh; y += 64) { g.fillStyle = 'rgba(40,46,54,.22)'; g.fillRect(0, y, W, 2); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y + 2, W, 1); }
    for (let x = 0; x < W; x += 16) { g.fillStyle = 'rgba(40,46,54,.05)'; g.fillRect(x, 0, 3, Hh); }
    return tex(c, { repeat: [16, 2] });
  }
  function texMesh(col, frame) {
    const N = 128, c = cnv(N, N), g = c.getContext('2d');
    g.clearRect(0, 0, N, N); g.strokeStyle = col; g.lineWidth = 3;
    for (let i = 0; i <= N; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke(); }
    if (frame) { g.lineWidth = 10; g.strokeRect(5, 5, N - 10, N - 10); }
    const t = tex(c); return t;
  }
  function texHMI() {
    const c = cnv(256, 192), g = c.getContext('2d');
    g.fillStyle = '#0c1a2c'; g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#16314f'; g.fillRect(0, 0, 256, 26);
    g.fillStyle = '#3cc6f2'; g.fillRect(8, 9, 60, 8);
    g.fillStyle = '#34d399'; g.fillRect(200, 8, 46, 10);
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(160,190,220,.55)'; g.fillRect(10, 40 + i * 22, 80 + (i * 37) % 70, 7); g.fillStyle = 'rgba(160,190,220,.25)'; g.fillRect(170, 40 + i * 22, 70, 7); }
    g.strokeStyle = '#3cc6f2'; g.lineWidth = 3; g.beginPath(); g.moveTo(10, 175); for (let x = 0; x < 236; x += 12) g.lineTo(10 + x, 160 - Math.sin(x / 30) * 10 - x / 20); g.stroke();
    return tex(c);
  }
  function texDrawers() {
    const c = cnv(128, 256), g = c.getContext('2d');
    g.fillStyle = '#3f6a9a'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 8; i++) { const y = 8 + i * 30; g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(4, y + 26, 120, 3); g.fillStyle = '#c9d2dc'; g.fillRect(44, y + 10, 40, 5); }
    return tex(c);
  }
  function texParts() {
    const N = 128, c = cnv(N, N), g = c.getContext('2d'), rnd = U.rng(5);
    g.fillStyle = '#4a5157'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 70; i++) { const x = rnd.range(0, N), y = rnd.range(0, N), r = rnd.range(5, 9); const gr = g.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r); gr.addColorStop(0, '#e9eef2'); gr.addColorStop(0.6, '#9aa4ad'); gr.addColorStop(1, '#3b4248'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    return tex(c);
  }
  function texGlow() {
    const N = 64, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return tex(c, { srgb: false });
  }
  function texBlob() {
    const N = 64, c = cnv(N, N), g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return tex(c, { srgb: false });
  }
  function texVest(col) {
    const c = cnv(64, 64), g = c.getContext('2d');
    g.fillStyle = col; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d7dbe0'; g.fillRect(0, 22, 64, 5); g.fillRect(0, 36, 64, 5);
    return tex(c);
  }
  function texLabel(text, o = {}) {
    const w = o.w || 512, h = o.h || 128, c = cnv(w, h), g = c.getContext('2d');
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = o.color || '#fff'; g.font = FONT(o.weight || 700, o.px || 64); g.textAlign = 'center'; g.textBaseline = 'middle';
    spacedText(g, text, w / 2, h / 2 + 2, o.sp || 4);
    return tex(c);
  }
  /** Fernseher im Leitstand: echte Kennzahlen, alle paar Sekunden neu gezeichnet. */
  function drawTV(t) {
    const c = t.image, g = c.getContext('2d'), sim = WF.sim, S = sim.state;
    g.fillStyle = '#0b1120'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111a2e'; g.fillRect(0, 0, c.width, 40);
    g.font = FONT(700, 26); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = '#e5ebf5'; g.fillText('werk', 16, 21); g.fillStyle = '#3cc6f2'; g.fillText('fluss', 16 + g.measureText('werk').width, 21);
    g.fillStyle = '#c3cde0'; g.textAlign = 'right'; g.fillText(sim.clock(), c.width - 16, 21);
    const k = S.kpi || {};
    g.textAlign = 'left'; g.font = FONT(600, 15); g.fillStyle = '#8796b0'; g.fillText('OEE HEUTE', 18, 66); g.fillText('GUTTEILE', 150, 66); g.fillText('TERMINTREUE', 282, 66);
    g.font = FONT(600, 40); g.fillStyle = '#e5ebf5';
    g.fillText(U.fmtPct(k.oee), 16, 100); g.fillText(fmtN(k.good || 0), 148, 100); g.fillText(U.fmtPct(k.onTimePct), 280, 100);
    const ids = WF.profile.machines, cw = (c.width - 32 - (ids.length - 1) * 6) / ids.length;
    ids.forEach((id, i) => {
      const m = S.machines[id], col = WF.STATE_HEX[m ? m.state : 'idle'];
      g.fillStyle = col; g.globalAlpha = 0.25; g.fillRect(16 + i * (cw + 6), 136, cw, 70); g.globalAlpha = 1;
      g.fillRect(16 + i * (cw + 6), 200, cw, 6);
      g.fillStyle = '#e5ebf5'; g.font = FONT(600, 15); g.textAlign = 'center'; g.fillText(id.replace('M', ''), 16 + i * (cw + 6) + cw / 2, 170);
    });
    t.needsUpdate = true;
  }

  // ================================================================== Materialien
  function makeMaterials() {
    const std = (c, r = 0.6, m = 0, x) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m }, x || {}));
    const glowT = texGlow();
    M = {
      paint: std(0xc8cdc9, 0.4),        // RAL 7035
      paintW: std(0xe4e7e6, 0.36),
      paintOld: std(0xb8beb0, 0.5),
      dark: std(0x363c42, 0.55),        // RAL 7016 anthrazit
      darker: std(0x22262b, 0.6),
      mid: std(0x7e868d, 0.45, 0.25),
      steel: std(0xb9c1c8, 0.3, 0.85),
      steelDark: std(0x5d656d, 0.4, 0.7),
      chrome: std(0xe2e7ec, 0.16, 1),
      rubber: std(0x1d2024, 0.85),
      accent: std(0x2f6e9e, 0.38, 0.1),
      yellow: std(0xf0b520, 0.5),
      orange: std(0xe0662a, 0.5),
      red: std(0xbd2f2a, 0.5),
      blueRack: std(0x2b5c9c, 0.5, 0.15),
      column: std(0x47525f, 0.55, 0.3),
      wood: std(0xb98e5c, 0.85),
      carton: std(0xb58b5b, 0.8),
      wrap: std(0xdfe3e6, 0.25, 0, { transparent: true, opacity: 0.92 }),
      klt: std(0xffffff, 0.55, 0, { side: THREE.DoubleSide }),
      granite: std(0x2a2d31, 0.3),
      alu: std(0xc6ccd2, 0.35, 0.6),
      stainless: std(0xc4cacf, 0.3, 0.7),
      oilUnit: std(0x3a4b5e, 0.5, 0.2),
      chuck: std(0x8f979e, 0.32, 0.75),
      hob: std(0xc9a45a, 0.32, 0.85),
      wheel: std(0xd6d2c6, 0.85),
      plant: std(0x3f8a4f, 0.8),
      floorEpoxy: std(0xb7bec6, 0.4),
      wall: std(0xffffff, 0.8, 0, { map: texWall() }),
      plinth: std(0x8e9399, 0.85),
      winGlass: new THREE.MeshStandardMaterial({ color: 0x9fb4c6, roughness: 0.1, metalness: 0.2, emissive: 0xbcd4ea, emissiveIntensity: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.8 }),
      glassRoom: new THREE.MeshStandardMaterial({ color: 0xa7c0d0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.13, depthWrite: false, envMapIntensity: 1.4, side: THREE.DoubleSide }),
      screen: new THREE.MeshBasicMaterial({ map: texHMI(), toneMapped: false }),
      fence: new THREE.MeshStandardMaterial({ map: texMesh('#3b4249', true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
      fenceRed: new THREE.MeshStandardMaterial({ map: texMesh('#c23a33', true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }),
      gitter: new THREE.MeshStandardMaterial({ map: texMesh('#9aa3ab', true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.7 }),
      drawers: std(0xffffff, 0.5, 0.2, { map: texDrawers() }),
      parts: std(0xffffff, 0.35, 0.6, { map: texParts() }),
      hazard: std(0xffffff, 0.6, 0, { map: texStripes('#f2b81c', '#1d2024', 6) }),
      vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }),
      fixture: std(0x30363d, 0.5, 0.4),
      lens: new THREE.MeshBasicMaterial({ color: 0xf6f8ff }),
      tray: std(0x9aa3ab, 0.4, 0.7),
      cable: std(0x23272c, 0.7),
      blade: std(0xd7dde3, 0.3, 0.9),
      chain: std(0x3a3f45, 0.5, 0.8),
      blob: new THREE.MeshBasicMaterial({ map: texBlob(), transparent: true, depthWrite: false, toneMapped: false }),
      hidden: new THREE.MeshBasicMaterial({ visible: false }),
      glowT,
      tabletScreen: new THREE.MeshBasicMaterial({ color: 0x5fb6e6, toneMapped: false }),
    };
    M.lens.color.multiplyScalar(2.2);
    M.hmiArm = M.steelDark;
  }

  // ================================================================== Szene, Licht, Umgebung
  function buildEnv() {
    const pm = new THREE.PMREMGenerator(R.renderer);
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      const c = y > 0 ? [0.32 + 0.45 * y, 0.35 + 0.47 * y, 0.4 + 0.5 * y] : [0.32 + 0.24 * y, 0.33 + 0.25 * y, 0.36 + 0.27 * y];
      col.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff }); lm.color.setRGB(7, 7, 7.4);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(70, 0.4, 1.6), lm); b.position.set(0, 32, -27 + i * 18); s.add(b); }
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff }); wm.color.setRGB(2.2, 2.4, 2.8);
    const wb = new THREE.Mesh(new THREE.BoxGeometry(90, 6, 1), wm); wb.position.set(0, 10, -44); s.add(wb);
    const env = pm.fromScene(s, 0.035).texture;
    pm.dispose(); geo.dispose();
    return env;
  }
  function buildLights() {
    const sc = R.scene;
    sc.add(new THREE.HemisphereLight(0xe6eeff, 0x30353e, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.75);
    sun.position.set(32 - 26, 58, 21 + 34); sun.target.position.set(32, 0, 20);
    sun.castShadow = true;
    const big = R.renderer.capabilities.maxTextureSize >= 8192 && !R.mobile;
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    const sc2 = sun.shadow.camera; sc2.left = -46; sc2.right = 46; sc2.top = 36; sc2.bottom = -36; sc2.near = 10; sc2.far = 150;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
    sc.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xc9dbff, 0.4); fill.position.set(80, 30, -20); fill.target.position.set(32, 0, 20);
    sc.add(fill, fill.target);
    R.sun = sun;
  }

  // ================================================================== Halle: Boden, Markierungen, Wände, Stützen, Tore, Licht, Trasse
  const AISLE_HW = { back: 1.0, main: 1.7, front: 1.0, vl: 1.0, vr: 0.85, vm: 1.0 };
  const ZONE_STYLE = {
    RAW: ['rgba(140,170,210,.10)', 'rgba(200,215,235,.45)'], PUF: ['rgba(140,170,210,.10)', 'rgba(200,215,235,.45)'],
    CRIB: ['rgba(230,236,242,.20)', null], MAINT: ['rgba(230,236,242,.14)', null], OFFICE: ['rgba(230,236,242,.22)', null], QS: ['rgba(235,240,246,.26)', null],
    CHG: ['rgba(52,211,153,.10)', 'rgba(52,211,153,.6)'], WE: ['rgba(96,165,250,.10)', 'rgba(150,190,250,.55)'],
    EXT: ['rgba(255,157,61,.10)', 'rgba(255,170,90,.6)'], SPERR: ['rgba(248,113,113,.14)', 'rgba(248,113,113,.7)'],
    VERSAND: ['rgba(52,211,153,.08)', 'rgba(110,220,170,.5)'], M13: ['rgba(230,236,242,.10)', null],
  };
  function contSlot(st, slot, k) {
    const base = slot === 'out' ? st.outPos : st.inPos;
    return { x: base.x + ((k % 3) - 1) * 0.9, z: base.z + Math.floor(k / 3) * 0.9 * (base.z > 20 ? 1 : -1) };
  }
  function texFloorMarks() {
    const PX = 40, P = WF.profile, HW = P.hall.w, HD = P.hall.d;
    const c = cnv(HW * PX, HD * PX), g = c.getContext('2d');
    const X = (x) => x * PX, Z = (z) => z * PX;
    const ao = (x, z, w, d, blur, a) => { g.save(); g.shadowColor = `rgba(6,10,16,${a})`; g.shadowBlur = blur; g.shadowOffsetX = 30000; g.fillStyle = '#000'; g.fillRect(X(x) - 30000, Z(z), w * PX, d * PX); g.restore(); };
    ao(0, -0.3, HW, 0.5, 70, 0.55); ao(-0.3, 0, 0.5, HD, 70, 0.55);
    const rnd = U.rng(19);
    for (const s of P.stations) {
      const f = s.footprint; if (!f) continue;
      if (s.kind === 'machine') {
        ao(f.x + 0.2, f.z + 0.2, f.w - 0.4, f.d - 0.4, 40, 0.5);
        for (let i = 0; i < 4; i++) { // Ölflecken / Gebrauchsspuren
          const x = X(f.x + rnd.range(0, f.w)), z = Z(f.z + f.d * (s.facing === 'N' ? rnd.range(-0.05, 0.25) : rnd.range(0.75, 1.05))), r = rnd.range(14, 42);
          const gr = g.createRadialGradient(x, z, 0, x, z, r); gr.addColorStop(0, 'rgba(30,34,40,.10)'); gr.addColorStop(1, 'rgba(30,34,40,0)'); g.fillStyle = gr; g.fillRect(x - r, z - r, 2 * r, 2 * r);
        }
      }
      const zs = ZONE_STYLE[s.id];
      if (zs) {
        if (zs[0]) { g.fillStyle = zs[0]; g.fillRect(X(f.x), Z(f.z), f.w * PX, f.d * PX); }
        if (zs[1]) {
          g.strokeStyle = zs[1]; g.lineWidth = 4; g.setLineDash([]); g.strokeRect(X(f.x) + 2, Z(f.z) + 2, f.w * PX - 4, f.d * PX - 4);
          if (s.id === 'SPERR' || s.id === 'EXT') { // schraffierter Rand
            g.save(); g.beginPath(); g.rect(X(f.x), Z(f.z), f.w * PX, f.d * PX); g.rect(X(f.x) + 18, Z(f.z) + 18, f.w * PX - 36, f.d * PX - 36); g.clip('evenodd');
            g.strokeStyle = zs[1]; g.lineWidth = 6; for (let i = -40; i < (f.w + f.d) * PX / 14; i++) { g.beginPath(); g.moveTo(X(f.x) + i * 14, Z(f.z)); g.lineTo(X(f.x) + i * 14 - f.d * PX, Z(f.z + f.d)); g.stroke(); }
            g.restore();
          }
        }
      }
    }
    // Gänge: Randlinien (gelb) mit Lücken an Kreuzungen und Stellflächen
    const lines = P.graph.lines;
    const fps = P.stations.filter(s => s.footprint).map(s => s.footprint);
    const yellow = 'rgba(243,198,35,.92)';
    const drawEdge = (axis, c0, a, b) => {
      const blocks = [];
      for (const f of fps) {
        if (axis === 'x') { if (c0 >= f.z - 0.12 && c0 <= f.z + f.d + 0.12) blocks.push([f.x - 0.12, f.x + f.w + 0.12]); }
        else if (c0 >= f.x - 0.12 && c0 <= f.x + f.w + 0.12) blocks.push([f.z - 0.12, f.z + f.d + 0.12]);
      }
      for (const L of lines) {
        if (L.axis === axis) continue;
        const hw = AISLE_HW[L.id] || 1;
        if (c0 >= L.a - hw - 0.01 && c0 <= L.b + hw + 0.01) blocks.push([L.c - hw, L.c + hw]);
      }
      blocks.sort((p, q) => p[0] - q[0]);
      let cur = a;
      const seg = (s0, s1) => { if (s1 - s0 < 0.3) return; g.fillStyle = yellow; if (axis === 'x') g.fillRect(X(s0), Z(c0) - 2, (s1 - s0) * PX, 4); else g.fillRect(X(c0) - 2, Z(s0), 4, (s1 - s0) * PX); };
      for (const [b0, b1] of blocks) { if (b1 <= cur) continue; if (b0 > cur) seg(cur, Math.min(b0, b)); cur = Math.max(cur, b1); if (cur >= b) break; }
      if (cur < b) seg(cur, b);
    };
    for (const L of lines) {
      const hw = AISLE_HW[L.id] || 1;
      const a = Math.max(0.4, L.a - hw), b = Math.min(L.axis === 'x' ? HW - 0.4 : HD - 0.4, L.b + hw);
      drawEdge(L.axis, L.c - hw, a, b); drawEdge(L.axis, L.c + hw, a, b);
    }
    // Kreuzungen schraffiert
    for (const A of lines) for (const B of lines) {
      if (A.axis !== 'x' || B.axis !== 'z') continue;
      if (B.c < A.a - 0.01 || B.c > A.b + 0.01 || A.c < B.a - 0.01 || A.c > B.b + 0.01) continue;
      const hx = AISLE_HW[B.id] || 1, hz = AISLE_HW[A.id] || 1;
      const x0 = X(B.c - hx), z0 = Z(A.c - hz), w = 2 * hx * PX, d = 2 * hz * PX;
      g.save(); g.beginPath(); g.rect(x0 + 6, z0 + 6, w - 12, d - 12); g.clip();
      g.strokeStyle = 'rgba(243,198,35,.38)'; g.lineWidth = 7;
      for (let i = -d; i < w + d; i += 22) { g.beginPath(); g.moveTo(x0 + i, z0); g.lineTo(x0 + i - d, z0 + d); g.stroke(); }
      g.restore();
    }
    // Stellflächen Ein-/Ausgang (weiß gestrichelt) mit Beschriftung
    g.setLineDash([10, 7]);
    for (const s of P.stations) {
      if (!s.inPos || ['CRIB', 'MAINT', 'OFFICE', 'CHG', 'PUF', 'RAW'].includes(s.id)) continue;
      const caps = s.kind === 'zone' ? [s.id === 'VERSAND' ? 0 : 3, s.id === 'VERSAND' || s.id === 'SPERR' ? 0 : 3] : [Math.min(6, s.inCap || 0), Math.min(6, s.outCap || 0)];
      [['in', caps[0], 'EIN'], ['out', caps[1], 'AUS']].forEach(([slot, cap, txt]) => {
        for (let k = 0; k < cap; k++) { const p = contSlot(s, slot, k); g.strokeStyle = 'rgba(255,255,255,.40)'; g.lineWidth = 2; g.strokeRect(X(p.x - 0.42), Z(p.z - 0.42), 0.84 * PX, 0.84 * PX); }
        if (cap > 0 && s.kind !== 'zone') {
          const p = contSlot(s, slot, 0), dz = (slot === 'out' ? s.outPos : s.inPos).z > 20 ? -0.72 : 0.72;
          g.save(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,.5)'; g.font = FONT(600, 13); g.textAlign = 'center'; g.textBaseline = 'middle';
          spacedText(g, txt, X(s.kind === 'qs' ? p.x : p.x), Z(p.z + dz), 2); g.restore();
        }
      });
    }
    g.setLineDash([]);
    // Ladeplätze
    const chg = P.stationById.CHG;
    if (chg) for (const p of [chg.inPos, chg.outPos]) { g.strokeStyle = 'rgba(52,211,153,.75)'; g.lineWidth = 3; g.strokeRect(X(p.x - 0.5), Z(p.z - 0.75), PX, 1.5 * PX); }
    // Tore: Schwellen gelb/schwarz
    for (const d of P.hall.doors) {
      const x0 = X(d.x), z0 = Z(HD - 0.75), w = d.w * PX, h = 0.6 * PX;
      g.save(); g.beginPath(); g.rect(x0, z0, w, h); g.clip(); g.fillStyle = '#1d2024'; g.fillRect(x0, z0, w, h); g.fillStyle = 'rgba(243,190,30,.95)';
      for (let i = -h; i < w + h; i += 24) { g.beginPath(); g.moveTo(x0 + i, z0); g.lineTo(x0 + i + 12, z0); g.lineTo(x0 + i + 12 - h, z0 + h); g.lineTo(x0 + i - h, z0 + h); g.fill(); }
      g.restore();
      g.fillStyle = 'rgba(255,255,255,.45)'; g.font = FONT(600, 18); g.textAlign = 'center'; g.textBaseline = 'middle';
      spacedText(g, d.name.toUpperCase(), X(d.x + d.w / 2), Z(HD - 1.25), 3);
    }
    // Bereichsnamen
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const a of P.hall.areas) { g.fillStyle = 'rgba(255,255,255,.40)'; g.font = FONT(700, 0.95 * PX); spacedText(g, a.name.toUpperCase(), X(a.x), Z(a.z), 0.16 * PX); }
    for (const s of P.stations) {
      if (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly' || !s.footprint) continue;
      const f = s.footprint, front = f.z > 20;
      const x = X(f.x + f.w / 2), z = s.id === 'VERSAND' ? Z(f.z + 0.65) : front ? Z(f.z + 0.6) : Z(f.z + f.d - 0.55);
      g.fillStyle = s.id === 'SPERR' ? 'rgba(255,170,170,.62)' : 'rgba(255,255,255,.48)'; g.font = FONT(700, 0.5 * PX);
      spacedText(g, s.short.toUpperCase(), x, z, 0.08 * PX);
    }
    return tex(c, { aniso: Math.min(8, R.aniso) });
  }

  function buildHall() {
    const P = WF.profile, HW = P.hall.w, HD = P.hall.d, HH = P.hall.height || 9, sc = R.scene;
    // Außengelände
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: texGround(), roughness: 0.95, color: 0xffffff }));
    gnd.rotation.x = -PI / 2; gnd.position.set(HW / 2, -0.02, HD / 2); gnd.receiveShadow = true; sc.add(gnd);
    // Fundament-Kante
    const b = new Builder();
    b.box(M.plinth, HW + 0.8, 0.12, HD + 0.8, HW / 2, -0.11, HD / 2);
    // Hallenboden
    const floorMat = new THREE.MeshStandardMaterial({ map: texConcrete(), roughness: 0.42, metalness: 0.0, envMapIntensity: 0.55 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW, HD), floorMat);
    floor.rotation.x = -PI / 2; floor.position.set(HW / 2, 0, HD / 2); floor.receiveShadow = true; sc.add(floor);
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(HW, HD), new THREE.MeshStandardMaterial({ map: texFloorMarks(), transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    marks.rotation.x = -PI / 2; marks.position.set(HW / 2, 0.006, HD / 2); marks.receiveShadow = true; marks.renderOrder = -1; sc.add(marks);
    R.floor = floor;

    // Wände: Sockel immer, Oberteil (mit Fensterband) nur Rück- und linke Wand; verschwindet, wenn die Kamera dahinter ist
    const TH = 0.3, PL = 1.15;
    b.box(M.plinth, HW + TH * 2, PL, TH, HW / 2, 0, -TH / 2);              // hinten
    b.box(M.plinth, TH, PL, HD, -TH / 2, 0, HD / 2);                        // links
    b.box(M.plinth, TH, PL, HD + TH, HW + TH / 2, 0, HD / 2 + TH / 2);      // rechts (niedrig)
    // vorne niedrig mit Toröffnungen
    const doors = P.hall.doors.slice().sort((p, q) => p.x - q.x);
    let cx = -TH;
    for (const d of doors) { if (d.x > cx) b.box(M.plinth, d.x - cx, PL, TH, (cx + d.x) / 2, 0, HD + TH / 2); cx = d.x + d.w; }
    if (cx < HW + TH) b.box(M.plinth, HW + TH - cx, PL, TH, (cx + HW + TH) / 2, 0, HD + TH / 2);
    // Abdeckungen (Schnittkante) dunkel
    b.box(M.darker, TH + 0.04, 0.04, HD + TH, HW + TH / 2, PL, HD / 2 + TH / 2);
    cx = -TH;
    for (const d of doors) {
      if (d.x > cx) b.box(M.darker, d.x - cx, 0.04, TH + 0.04, (cx + d.x) / 2, PL, HD + TH / 2);
      cx = d.x + d.w;
      // Torzargen gelb/schwarz
      for (const px of [d.x - 0.12, d.x + d.w + 0.12]) b.box(M.hazard, 0.24, PL + 0.35, TH + 0.12, px, 0, HD + TH / 2);
    }
    if (cx < HW + TH) b.box(M.darker, HW + TH - cx, 0.04, TH + 0.04, (cx + HW + TH) / 2, PL, HD + TH / 2);
    b.build(sc);

    // Obere Wandteile (abklappbar)
    const mkWall = (len, alongX) => {
      const g = new THREE.Group(), wb = new Builder();
      const hU = HH - PL;
      const wallGeo = new THREE.BoxGeometry(alongX ? len : TH, hU, alongX ? TH : len).translate(0, hU / 2, 0);
      const wm = new THREE.Mesh(wallGeo, M.wall); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
      // Fensterband 4,6–6,2 m (Innenseite)
      const y0 = 4.6 - PL, wh = 1.6, inner = TH / 2 + 0.01;
      if (alongX) {
        wb.box(M.winGlass, len - 1.2, wh, 0.04, 0, y0, inner);
        for (let x = -len / 2 + 0.6; x <= len / 2 - 0.6 + 1e-6; x += 2) wb.box(M.darker, 0.08, wh + 0.1, 0.07, x, y0 - 0.05, inner + 0.01);
        wb.box(M.darker, len - 1.1, 0.09, 0.09, 0, y0 - 0.09, inner + 0.01); wb.box(M.darker, len - 1.1, 0.09, 0.09, 0, y0 + wh, inner + 0.01);
        for (let x = -len / 2; x <= len / 2 + 1e-6; x += 8) wb.add(gIBeam(hU + PL - 0.2, 0.32, 0.03, 0.015), M.column, xf(x, -PL, inner + 0.17));
        wb.box(M.darker, len + 0.6, 0.12, TH + 0.06, 0, hU, 0);
      } else {
        wb.box(M.winGlass, 0.04, wh, len - 1.2, inner, y0, 0);
        for (let z = -len / 2 + 0.6; z <= len / 2 - 0.6 + 1e-6; z += 2) wb.box(M.darker, 0.07, wh + 0.1, 0.08, inner + 0.01, y0 - 0.05, z);
        wb.box(M.darker, 0.09, 0.09, len - 1.1, inner + 0.01, y0 - 0.09, 0); wb.box(M.darker, 0.09, 0.09, len - 1.1, inner + 0.01, y0 + wh, 0);
        for (let z = -len / 2 + 8; z <= len / 2 + 1e-6; z += 8) wb.add(gIBeam(hU + PL - 0.2, 0.32, 0.03, 0.015), M.column, xf(inner + 0.17, -PL, z, 0, PI / 2, 0));
        wb.box(M.darker, TH + 0.06, 0.12, len, 0, hU, 0);
      }
      wb.build(g);
      return g;
    };
    const back = mkWall(HW + TH * 2, true); back.position.set(HW / 2, PL, -TH / 2); sc.add(back);
    const left = mkWall(HD, false); left.position.set(-TH / 2, PL, HD / 2); sc.add(left);
    R.walls = [{ g: back, f: 1, outside: (c) => c.z < -0.5 }, { g: left, f: 1, outside: (c) => c.x < -0.5 }];
    // Wandmaterial-Texturwiederholung passend zur Länge
    M.wall.map.repeat.set(16, 2);

    // Stützen (HEB) mit Anfahrschutz
    const cb = new Builder();
    for (const c of P.hall.columns) {
      cb.add(gIBeam(8.4, 0.32, 0.03, 0.015), M.column, xf(c.x, 0, c.z));
      cb.box(M.hazard, 0.5, 1.0, 0.5, c.x, 0, c.z);
      cb.box(M.darker, 0.42, 0.04, 0.42, c.x, 8.4, c.z);
      // Feuerlöscher an der Stütze
      cb.cyl(M.red, 0.085, 0.55, c.x + 0.33, 0.35, c.z, 12); cb.cyl(M.darker, 0.03, 0.12, c.x + 0.33, 0.9, c.z, 8);
      cb.box(M.red, 0.02, 0.3, 0.3, c.x + 0.17, 1.6, c.z);
    }
    // Hallenleuchten (Lichtbänder, instanziert)
    const rows = [4.8, 16, 28, 37];
    const n = rows.length * 15;
    const hous = new THREE.InstancedMesh(gBoxC(), M.fixture, n), lens = new THREE.InstancedMesh(gBoxC(), M.lens, n);
    let k = 0;
    for (const z of rows) for (let i = 0; i < 15; i++) {
      const x = 3 + i * 4.15;
      hous.setMatrixAt(k, xf(x, 7.4, z, 0, 0, 0, 1.6, 0.09, 0.26)); lens.setMatrixAt(k, xf(x, 7.35, z, 0, 0, 0, 1.5, 0.02, 0.18)); k++;
    }
    hous.instanceMatrix.needsUpdate = lens.instanceMatrix.needsUpdate = true;
    sc.add(hous, lens);
    // Kabeltrasse (Datenfluss): Hauptgang → rechter Längsgang → Leitstand/Server
    const TY = R.TRAY_Y = 6.2;
    const off = P.stationById.OFFICE, srv = off.server;
    R.trayPts = [[3, 22], [55.5 + 3, 22], [58.5, 4.6], [srv.x, 4.6]];
    const tb = new Builder();
    const traySeg = (x0, z0, x1, z1, w) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
      tb.box(M.tray, w, 0.03, len, (x0 + x1) / 2, TY - 0.06, (z0 + z1) / 2, ry);
      const [ox, oz] = rotXZ(w / 2, 0, ry);
      tb.box(M.tray, 0.02, 0.09, len, (x0 + x1) / 2 + ox, TY - 0.06, (z0 + z1) / 2 + oz, ry);
      tb.box(M.tray, 0.02, 0.09, len, (x0 + x1) / 2 - ox, TY - 0.06, (z0 + z1) / 2 - oz, ry);
    };
    traySeg(3, 22, 58.5, 22, 0.4); traySeg(58.5, 22, 58.5, 4.6, 0.4); traySeg(58.5, 4.6, srv.x, 4.6, 0.3);
    tb.box(M.cable, 0.05, TY - 2.1, 0.05, srv.x, 2.1, 4.6); tb.box(M.tray, 0.3, 0.03, 2.4, srv.x, TY - 0.06, 3.4);
    tb.build(sc, false);
    // Leuchtlinie auf der Trasse (nur Ebene Datenfluss)
    const glowLine = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
    const gl = new Builder();
    gl.box(glowLine, 55.5, 0.012, 0.06, 30.75, TY - 0.02, 22); gl.box(glowLine, 0.06, 0.012, 17.4, 58.5, TY - 0.02, 13.3); gl.box(glowLine, srv.x - 58.5, 0.012, 0.06, (58.5 + srv.x) / 2, TY - 0.02, 4.6);
    R.trayGlow = gl.build(sc, false);
    R.trayGlowMat = glowLine;
    cb.build(sc);
  }

  // ================================================================== Maschinen
  const TYPE_H = { saw: 2.25, lathe: 3.35, swiss: 1.95, biglathe: 2.6, deephole: 1.85, hobber: 2.6, mill5: 2.95, mill3: 2.65, cylgrinder: 2.35, surfgrinder: 2.6, washer: 2.3, cmm: 2.8, assembly: 2.2 };
  const FACE_RY = { S: 0, N: PI, W: -PI / 2, E: PI / 2 };

  /** Bedienpult mit Bildschirm (Front = lokale +z des Pults bei ry). */
  function hmi(b, x, y, z, ry, small) {
    const s = small ? 0.75 : 1;
    b.rbox(M.dark, 0.56 * s, 0.7 * s, 0.11, 0.03, x, y, z, ry);
    const [fx, fz] = rotXZ(0, 0.058, ry);
    b.box(M.screen, 0.44 * s, 0.32 * s, 0.006, x + fx, y + 0.31 * s, z + fz, ry);
    const [kx, kz] = rotXZ(0, 0.06, ry);
    b.box(M.darker, 0.48 * s, 0.05, 0.13, x + kx, y + 0.08 * s, z + kz, ry, -0.35);
    b.box(M.red, 0.05, 0.03, 0.05, x + kx + rotXZ(0.19 * s, 0, ry)[0], y + 0.06, z + kz + rotXZ(0.19 * s, 0, ry)[1], ry);
  }
  function chipCart(b, x, z, ry) {
    b.rbox(M.oilUnit, 0.75, 0.55, 0.55, 0.05, x, 0.1, z, ry);
    for (const [lx, lz] of [[-0.28, -0.2], [0.28, -0.2], [-0.28, 0.2], [0.28, 0.2]]) { const [ox, oz] = rotXZ(lx, lz, ry); b.cyl(M.rubber, 0.05, 0.1, x + ox, 0, z + oz, 10); }
    const [cx, cz] = rotXZ(0, 0, ry); b.box(M.steelDark, 0.68, 0.06, 0.48, x + cx, 0.62, z + cz, ry);
  }
  function cabinet(b, x, z, w, h, d, ry, mat) {
    b.rbox(mat || M.paint, w, h, d, 0.03, x, 0, z, ry);
    const [fx, fz] = rotXZ(0, d / 2 + 0.004, ry);
    b.box(M.darker, 0.012, h - 0.25, 0.01, x + fx, 0.12, z + fz, ry);
    const [hx, hz] = rotXZ(w * 0.3, d / 2 + 0.02, ry); b.box(M.darker, 0.03, 0.14, 0.03, x + hx, h * 0.55, z + hz, ry);
    const [lx, lz] = rotXZ(-w * 0.25, d / 2 + 0.006, ry);
    for (let i = 0; i < 4; i++) b.box(M.darker, w * 0.3, 0.015, 0.01, x + lx, h - 0.4 - i * 0.06, z + lz, ry);
  }
  /** Signalsäule: 3 Segmente (unten grün, Mitte gelb/blau/violett, oben rot), je Maschine eigene Materialien */
  function tower(mo, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    g.add(mesh(gCyl(10), M.steelDark, 0, 0, 0, 0.018, 0.24, 0.018));
    g.add(mesh(gCyl(12), M.darker, 0, 0, 0, 0.04, 0.03, 0.04));
    const base = [0x1d5a3a, 0x6a5418, 0x6a2222];
    const mats = base.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, emissive: 0x000000, emissiveIntensity: 0, transparent: false }));
    mats.forEach((m, i) => { const s = mesh(gCyl(14), m, 0, 0.24 + i * 0.085, 0, 0.05, 0.078, 0.05); s.castShadow = false; g.add(s); });
    g.add(mesh(gCyl(14), M.darker, 0, 0.24 + 3 * 0.085, 0, 0.052, 0.03, 0.052));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.glowT, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    halo.scale.set(0.9, 0.9, 1); g.add(halo);
    mo.group.add(g);
    mo.tower = { g, mats, base, halo, lit: -2, hex: null };
  }
  /** Kabine mit Arbeitsraum hinter einer Schiebetür mit Fenster (Front = lokale +z). */
  function cabin(mo, b, o) {
    const t = 0.05, pl = o.plinth == null ? 0.2 : o.plinth, P = o.paint || M.paint;
    const x0 = o.cx - o.w / 2, x1 = o.cx + o.w / 2, zf = o.cz + o.d / 2, zb = o.cz - o.d / 2, zi = zf - o.intD;
    b.rbox(M.dark, o.w + 0.05, pl, o.d + 0.05, 0.05, o.cx, 0, o.cz);
    b.rbox(P, o.w, o.h - pl, zi - zb, 0.09, o.cx, pl, (zb + zi) / 2, 0, 0.02);
    b.box(P, t, o.h - pl, o.intD, x0 + t / 2, pl, (zi + zf) / 2);
    b.box(P, t, o.h - pl, o.intD, x1 - t / 2, pl, (zi + zf) / 2);
    b.box(P, o.w, 0.07, o.intD, o.cx, o.h - 0.07, (zi + zf) / 2);
    const W = o.win, wx0 = o.cx + (W.cx || 0) - W.w / 2, wx1 = wx0 + W.w, wy0 = W.y0, wy1 = W.y0 + W.h;
    const ox0 = wx0 - 0.1, ox1 = wx1 + 0.1, oy0 = wy0 - 0.22, oy1 = wy1 + 0.1;
    b.box(P, o.w, oy0 - pl, t, o.cx, pl, zf - t / 2);
    b.box(P, o.w, o.h - 0.07 - oy1, t, o.cx, oy1, zf - t / 2);
    if (ox0 - x0 > 0.01) b.box(P, ox0 - x0, oy1 - oy0, t, (x0 + ox0) / 2, oy0, zf - t / 2);
    if (x1 - ox1 > 0.01) b.box(P, x1 - ox1, oy1 - oy0, t, (ox1 + x1) / 2, oy0, zf - t / 2);
    // Arbeitsraum (Auskleidung leuchtet bei Produktion)
    const inn = mo.inner, iw = o.w - 2 * t - 0.01;
    b.box(M.steelDark, iw, 0.05, o.intD - t, o.cx, oy0 - 0.12, (zi + zf) / 2 - t / 2);
    b.box(inn, iw, o.h - pl - 0.2, 0.02, o.cx, pl + 0.05, zi + 0.012);
    b.box(inn, 0.015, o.h - pl - 0.2, o.intD - t, x0 + t + 0.008, pl + 0.05, (zi + zf) / 2 - t / 2);
    b.box(inn, 0.015, o.h - pl - 0.2, o.intD - t, x1 - t - 0.008, pl + 0.05, (zi + zf) / 2 - t / 2);
    b.box(inn, iw, 0.015, o.intD - t, o.cx, o.h - 0.1, (zi + zf) / 2 - t / 2);
    // Akzentleiste
    b.box(M.accent, o.w - 0.1, 0.05, 0.012, o.cx, o.h - 0.25, zf + 0.004);
    // Tür
    const door = new THREE.Group(), db = new Builder();
    const dw = ox1 - ox0 + 0.1, dh = oy1 - oy0 + 0.1, fw = (dw - W.w) / 2, ft = 0.04;
    db.box(P, dw, fw + 0.02, ft, 0, 0, 0); db.box(P, dw, fw, ft, 0, dh - fw, 0);
    db.box(P, fw, dh, ft, -dw / 2 + fw / 2, 0, 0); db.box(P, fw, dh, ft, dw / 2 - fw / 2, 0, 0);
    db.box(M.glass, W.w + 0.02, W.h + 0.02, 0.012, 0, fw + 0.02, 0);
    const hs = (o.slide || 1) > 0 ? -1 : 1;
    db.box(M.chrome, 0.03, Math.min(0.5, dh * 0.4), 0.05, hs * (dw / 2 - fw / 2), dh * 0.35, 0.04);
    db.build(door, true);
    door.position.set((ox0 + ox1) / 2, oy0 - 0.05, zf + 0.03);
    mo.group.add(door);
    mo.door = { obj: door, x0: door.position.x, slide: (o.slide || 1) * dw * 0.9, f: 0 };
    return { zf, zi, zb, x0, x1, floorY: oy0 - 0.07, wy0, wy1, wx0, wx1, ic: (zi + zf) / 2 };
  }
  function dyn(mo, parent, obj) { (parent || mo.group).add(obj); return obj; }
  function grp(x, y, z) { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; }
  /** Durchmesser / Länge aus dem Teilenamen („Achswelle Ø110×1850“) bzw. Material („Ø65“, „Flach 45×25“) */
  function dimsOf(text) {
    const s = String(text || '');
    let m = s.match(/Ø\s*(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+)/);
    if (m) return { d: parseFloat(m[1].replace(',', '.')) / 1000, l: parseFloat(m[2]) / 1000 };
    m = s.match(/Ø\s*(\d+(?:[.,]\d+)?)/);
    if (m) return { d: parseFloat(m[1].replace(',', '.')) / 1000, l: null };
    m = s.match(/Flach\s*(\d+)\s*[×x]\s*(\d+)/);
    if (m) return { flat: true, d: parseFloat(m[1]) / 1000, d2: parseFloat(m[2]) / 1000, l: null };
    return null;
  }

  const TB = {}; // Typ-Bauer: (mo, b, W, D) → lokale Koordinaten, Front = +z

  TB.saw = (mo, b, W, D) => {
    const zc = -0.15, top = 0.87;
    // Zuführ-Rollenbahn links
    b.box(M.dark, 2.95, 0.09, 0.56, -1.9, 0.72, zc);
    for (const x of [-3.1, -2.0, -0.85]) { b.box(M.dark, 0.08, 0.72, 0.08, x, 0, zc - 0.22); b.box(M.dark, 0.08, 0.72, 0.08, x, 0, zc + 0.22); }
    for (let x = -3.25; x <= -0.6; x += 0.3) b.cylZ(M.steel, 0.045, 0.5, x, 0.85, zc - 0.25, 12);
    // Stangenmagazin hinter der Zuführung
    b.box(M.dark, 2.9, 0.08, 0.7, -1.9, 0.78, zc - 0.85, 0, -0.12);
    for (const x of [-3.1, -0.85]) b.box(M.dark, 0.08, 0.8, 0.08, x, 0, zc - 1.1);
    // Grundkörper + Tisch
    b.rbox(M.dark, 2.0, 0.76, 2.3, 0.06, 0.55, 0, -0.1);
    b.rbox(M.paint, 1.9, 0.11, 2.2, 0.04, 0.55, 0.76, -0.1);
    b.box(M.steelDark, 0.32, 0.3, 0.16, 0.55, top, zc - 0.32); b.box(M.steelDark, 0.32, 0.3, 0.16, 0.55, top, zc + 0.32);
    b.cyl(M.chrome, 0.07, 1.75, 0.05, top, -1.05, 16); b.cyl(M.chrome, 0.07, 1.75, 1.05, top, -1.05, 16);
    b.box(M.paint, 1.3, 0.25, 0.25, 0.55, top + 1.75, -1.05);
    b.cyl(M.steelDark, 0.06, 1.0, 0.55, top, -0.85, 12);
    // Abfuhr rechts
    b.box(M.dark, 1.7, 0.09, 0.56, 2.4, 0.7, zc);
    for (const x of [1.7, 3.1]) { b.box(M.dark, 0.08, 0.7, 0.08, x, 0, zc - 0.22); b.box(M.dark, 0.08, 0.7, 0.08, x, 0, zc + 0.22); }
    for (let x = 1.65; x <= 3.2; x += 0.3) b.cylZ(M.steel, 0.045, 0.5, x, 0.83, zc - 0.25, 12);
    b.box(M.steelDark, 0.7, 0.05, 0.6, 2.9, 0.55, zc + 0.75, 0, 0.45);
    // Schaltschrank, Hydraulik, Pult, Späne
    cabinet(b, 2.6, -1.95, 0.9, 1.9, 0.5, 0);
    b.rbox(M.oilUnit, 0.75, 0.6, 0.55, 0.04, 1.65, 0, -1.95);
    b.cyl(M.steelDark, 0.13, 0.32, 1.45, 0.6, -1.95, 12);
    b.cyl(M.dark, 0.05, 0.85, 1.95, 0, 1.45, 10); hmi(b, 1.95, 0.85, 1.45, 0);
    chipCart(b, 0.55, 1.45, 0);
    // Sägebügel (bewegt sich mit dem Schnittfortschritt nach unten)
    const bow = grp(0.55, top + 0.6, zc), bb = new Builder();
    bb.rbox(M.paint, 0.46, 0.5, 2.2, 0.1, 0, 0.12, -0.15, 0, 0.02);
    bb.cylX(M.paint, 0.4, 0.48, -0.24, 0.42, -1.25, 24); bb.cylX(M.paint, 0.4, 0.48, -0.24, 0.42, 0.95, 24);
    bb.box(M.accent, 0.47, 0.05, 2.0, 0, 0.5, -0.15);
    bb.box(M.steelDark, 0.15, 0.32, 0.13, 0, -0.05, -0.62); bb.box(M.steelDark, 0.15, 0.32, 0.13, 0, -0.05, 0.62);
    bb.cylX(M.dark, 0.16, 0.36, 0.2, 0.42, -1.25, 16);
    bb.build(bow);
    const bladeMat = M.blade.clone(); bladeMat.map = texStripes('#dfe5ea', '#7e868d', 16); bladeMat.map.wrapS = THREE.RepeatWrapping; bladeMat.map.repeat.set(8, 1);
    const blade = mesh(gBoxC(), bladeMat, 0, 0.0, -0.15, 0.012, 0.03, 1.5); blade.castShadow = false; bow.add(blade);
    dyn(mo, null, bow);
    // Stange auf der Zuführung (Durchmesser/Länge je Material)
    const bar = mesh(gCylC(18), M.steel); bar.rotation.z = PI / 2; mo.group.add(bar);
    const mag = [0, 1, 2].map(() => { const m = mesh(gCylC(14), M.steelDark); m.rotation.z = PI / 2; mo.group.add(m); return m; });
    mo.a = { bow, bladeMat, bar, mag, zc, top, y0: top + 0.6 };
    tower(mo, 2.6, 1.9, -1.95);
    mo.conn = [2.6, 1.9, -1.95];
  };

  TB.lathe = (mo, b, W, D) => {
    const cx = 0.9;
    const c = cabin(mo, b, { cx, cz: 0.25, w: 5.0, h: 2.4, d: 2.6, intD: 1.3, win: { w: 2.5, h: 1.0, y0: 1.0, cx: -0.3 }, slide: 1 });
    const iz = c.ic, fy = c.floorY;
    b.box(M.mid, 0.75, 0.85, 0.9, cx - 1.85, fy, iz - 0.15);
    b.box(M.mid, 0.6, 0.55, 0.7, cx + 1.25, fy, iz - 0.2);
    // Futter + Werkstück
    const chuck = grp(cx - 1.45, fy + 0.5, iz - 0.1), cb = new Builder();
    cb.cylX(M.chuck, 0.17, 0.12, 0, 0, 0, 20); cb.cylX(M.steel, 0.05, 0.14, 0.12, 0, 0, 14);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; cb.boxC(M.steelDark, 0.07, 0.07, 0.07, 0.15, Math.cos(a) * 0.1, Math.sin(a) * 0.1); }
    cb.build(chuck); mo.group.add(chuck);
    // Revolver
    const tur = grp(cx + 0.35, fy + 0.85, iz - 0.25), tb = new Builder();
    tb.cylX(M.steelDark, 0.3, 0.16, -0.08, 0, 0, 16);
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; tb.boxC(M.mid, 0.12, 0.08, 0.08, 0, Math.cos(a) * 0.33, Math.sin(a) * 0.33); }
    tb.build(tur); mo.group.add(tur);
    // Ladezelle mit Rohteilen + Schutzzaun
    b.rbox(M.dark, 2.6, 0.82, 1.9, 0.04, -2.85, 0, 0.25);
    b.box(M.rubber, 2.4, 0.03, 1.6, -2.85, 0.82, 0.25);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) b.cyl(M.steel, 0.045, 0.1, -3.9 + i * 0.4, 0.85, -0.35 + j * 0.4, 12);
    for (const [x, z, w, d] of [[-2.85, 1.25, 2.7, 0.03], [-4.18, 0.25, 0.03, 2.0], [-2.85, -0.75, 2.7, 0.03]]) {
      b.box(M.fence, w, 1.0, d, x, 0.85, z);
    }
    for (const [x, z] of [[-4.18, 1.25], [-1.55, 1.25], [-4.18, -0.75]]) b.box(M.yellow, 0.06, 1.85, 0.06, x, 0, z);
    // Portallader
    b.box(M.paint, 0.24, 3.15, 0.3, -4.0, 0, 0.25);
    b.box(M.paint, 0.24, 0.65, 0.3, 2.6, 2.4, 0.25);
    b.rbox(M.paint, 6.9, 0.32, 0.34, 0.04, -0.7, 3.05, 0.25);
    b.box(M.accent, 6.8, 0.05, 0.01, -0.7, 3.2, 0.425);
    b.box(M.steel, 6.7, 0.04, 0.06, -0.7, 3.01, 0.25);
    const car = grp(-0.4, 3.05, 0.25), crb = new Builder();
    crb.rbox(M.paintW, 0.5, 0.42, 0.55, 0.05, 0, -0.05, 0);
    crb.build(car);
    const arm = grp(0, 0, 0.2), ab = new Builder();
    ab.box(M.steel, 0.1, 1.25, 0.1, 0, -1.25, 0); ab.box(M.dark, 0.22, 0.14, 0.18, 0, -1.37, 0);
    ab.build(arm); car.add(arm); mo.group.add(car);
    // Schaltschrank hinten, Späneförderer rechts, Pult
    cabinet(b, cx - 0.6, -1.65, 2.0, 2.05, 0.6, 0);
    b.rbox(M.oilUnit, 0.9, 0.9, 0.6, 0.04, cx + 1.4, 0, -1.65);
    b.box(M.dark, 0.55, 0.45, 1.6, 3.8, 0, -0.1); b.box(M.dark, 0.5, 0.4, 0.9, 3.8, 0.45, -0.6, 0, -0.55);
    chipCart(b, 3.85, 1.3, PI / 2);
    b.box(M.steelDark, 0.08, 0.08, 0.5, cx + 2.15, 1.65, c.zf + 0.15);
    hmi(b, cx + 2.15, 1.05, c.zf + 0.42, -0.25);
    mo.a = { chuck, tur, car, arm, carX: { store: -2.85, mach: cx - 1.45 } };
    tower(mo, cx + 2.15, 2.4, -0.7);
    mo.conn = [cx - 0.6, 2.05, -1.65];
  };

  TB.swiss = (mo, b, W, D) => {
    const cx = 1.9;
    const c = cabin(mo, b, { cx, cz: 0.15, w: 2.5, h: 1.85, d: 1.55, intD: 0.85, win: { w: 1.3, h: 0.62, y0: 0.95, cx: -0.15 }, slide: -1 });
    const fy = c.floorY, iz = c.ic;
    b.box(M.mid, 0.4, 0.45, 0.5, cx - 0.85, fy, iz - 0.1);
    const sp = grp(cx - 0.62, fy + 0.3, iz - 0.05), sb = new Builder();
    sb.cylX(M.chuck, 0.07, 0.1, 0, 0, 0, 16); sb.cylX(M.steel, 0.012, 0.12, 0.1, 0, 0, 8);
    sb.build(sp); mo.group.add(sp);
    b.box(M.steelDark, 0.35, 0.25, 0.3, cx - 0.2, fy + 0.35, iz - 0.15);
    // Stangenlader
    b.rbox(M.paint, 3.85, 0.42, 0.55, 0.06, -1.3, 0.78, 0.15, 0, 0.02);
    b.box(M.accent, 3.75, 0.04, 0.01, -1.3, 1.08, 0.43);
    for (const x of [-3.0, -1.3, 0.4]) { b.box(M.dark, 0.08, 0.78, 0.4, x, 0, 0.15); b.box(M.dark, 0.5, 0.05, 0.5, x, 0, 0.15); }
    b.box(M.dark, 3.7, 0.04, 0.42, -1.3, 1.2, -0.12, 0, 0.18);
    b.box(M.dark, 0.1, 0.6, 0.6, -3.24, 0.78, 0.15);
    b.box(M.paint, 0.4, 0.5, 0.45, 0.85, 0.75, 0.15);
    // Pult, Späne, Schrank
    hmi(b, cx + 1.0, 0.95, c.zf + 0.08, 0, true);
    chipCart(b, cx + 0.5, -0.95, 0);
    cabinet(b, cx - 0.6, -0.95, 0.9, 1.6, 0.4, 0);
    const bars = [0, 1, 2].map(() => { const m = mesh(gCylC(10), M.steel); m.rotation.z = PI / 2; m.castShadow = false; mo.group.add(m); return m; });
    mo.a = { sp, bars };
    tower(mo, cx + 1.0, 1.85, -0.35);
    mo.conn = [cx - 0.6, 1.6, -0.95];
  };

  TB.biglathe = (mo, b, W, D) => {
    const ay = 1.45, az = -0.25;
    b.rbox(M.dark, 8.5, 0.75, 1.55, 0.06, 0.15, 0, -0.25);
    b.box(M.steel, 7.0, 0.05, 0.14, 0.8, 0.75, -0.62); b.box(M.steel, 7.0, 0.05, 0.14, 0.8, 0.75, 0.12);
    b.rbox(M.paint, 1.7, 1.6, 1.95, 0.08, -3.35, 0.6, -0.3, 0, 0.02);
    b.box(M.accent, 1.6, 0.05, 0.01, -3.35, 2.0, 0.68);
    b.box(M.paint, 6.9, 1.7, 0.06, 0.85, 0.75, -1.08);
    b.box(M.accent, 6.8, 0.05, 0.012, 0.85, 2.3, -1.04);
    for (let i = 0; i < 3; i++) {
      const x = -1.35 + i * 2.2;
      b.box(M.paint, 2.2, 0.08, 0.05, x, 0.8, 0.62); b.box(M.paint, 2.2, 0.08, 0.05, x, 1.92, 0.62);
      b.box(M.paint, 0.06, 1.2, 0.05, x - 1.07, 0.8, 0.62); b.box(M.glass, 2.1, 1.05, 0.012, x, 0.87, 0.63);
    }
    b.box(M.steel, 6.8, 0.05, 0.06, 0.85, 2.0, 0.62);
    b.box(M.darker, 6.6, 0.32, 0.5, 0.9, 0, 0.95);
    chipCart(b, 4.0, 1.7, 0);
    b.cyl(M.dark, 0.07, 1.0, 3.55, 0, 1.85, 10); hmi(b, 3.55, 1.0, 1.85, -0.2);
    // Schwenkkran (gelb)
    b.cyl(M.yellow, 0.15, 4.6, -4.15, 0, -2.25, 16); b.cyl(M.darker, 0.3, 0.15, -4.15, 0, -2.25, 16);
    const jr = Math.atan2(2.4, 1.6);
    b.add(gBox(), M.yellow, xf(-4.15 + Math.sin(jr) * 1.9, 4.25, -2.25 + Math.cos(jr) * 1.9, 0, jr, 0, 0.22, 0.32, 3.9));
    b.box(M.dark, 0.3, 0.3, 0.4, -4.15 + Math.sin(jr) * 2.6, 3.95, -2.25 + Math.cos(jr) * 2.6, jr);
    b.cyl(M.chain, 0.015, 1.4, -4.15 + Math.sin(jr) * 2.6, 2.55, -2.25 + Math.cos(jr) * 2.6, 6);
    b.box(M.yellow, 0.12, 0.18, 0.06, -4.15 + Math.sin(jr) * 2.6, 2.4, -2.25 + Math.cos(jr) * 2.6);
    cabinet(b, 3.6, -2.25, 1.6, 2.0, 0.6, 0);
    b.rbox(M.oilUnit, 1.0, 1.0, 0.6, 0.04, 2.2, 0, -2.25);
    // Futter + Welle (drehen), Reitstock, Lünette, Support
    const chuck = grp(-2.5, ay, az), cb = new Builder();
    cb.cylX(M.chuck, 0.43, 0.3, 0, 0, 0, 28); cb.cylX(M.steel, 0.41, 0.02, 0.3, 0, 0, 28);
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4; cb.boxC(M.steelDark, 0.14, 0.14, 0.22, 0.38, Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0, a, 0); }
    cb.build(chuck); mo.group.add(chuck);
    const work = mesh(gCylC(24), M.steel); work.rotation.z = PI / 2; chuck.add(work);
    const tail = grp(0, 0.75, az), tlb = new Builder();
    tlb.rbox(M.paint, 0.9, 0.62, 1.1, 0.05, 0.25, 0, 0); tlb.cylX(M.steel, 0.09, 0.35, -0.45, ay - 0.75, 0, 16); tlb.cylX(M.steelDark, 0.04, 0.12, -0.55, ay - 0.75, 0, 12);
    tlb.build(tail); mo.group.add(tail);
    const rest = grp(0, 0.75, az), rb = new Builder();
    rb.box(M.paint, 0.3, 0.45, 0.9, 0, 0, 0); rb.add(new THREE.TorusGeometry(0.2, 0.05, 8, 24), M.paint, xf(0, ay - 0.75, 0, 0, PI / 2, 0));
    rb.build(rest); mo.group.add(rest);
    const sup = grp(0, 0.8, az), sbb = new Builder();
    sbb.rbox(M.paint, 1.1, 0.3, 1.45, 0.05, 0, 0, 0); sbb.box(M.mid, 0.8, 0.25, 0.75, 0, 0.3, -0.35);
    sbb.cylZ(M.steelDark, 0.3, 0.3, 0, 0.75, -0.8, 18); sbb.box(M.steel, 0.12, 0.08, 0.32, 0, 0.62, -0.35);
    sbb.build(sup); mo.group.add(sup);
    mo.a = { chuck, work, tail, rest, sup, ay, cx0: -2.2 };
    tower(mo, -3.95, 2.2, -1.0);
    mo.conn = [3.6, 2.0, -2.25];
  };

  TB.deephole = (mo, b, W, D) => {
    const ay = 1.15;
    b.rbox(M.dark, 10.8, 0.62, 1.15, 0.05, 0, 0, 0.05);
    b.box(M.steel, 10.4, 0.04, 0.1, 0, 0.62, -0.3); b.box(M.steel, 10.4, 0.04, 0.1, 0, 0.62, 0.4);
    b.rbox(M.paint, 1.15, 1.15, 1.45, 0.06, -4.85, 0.6, 0.05, 0, 0.02);
    b.box(M.accent, 1.05, 0.05, 0.01, -4.85, 1.55, 0.78);
    // Späneschutzhaube über dem Werkstück
    const hx0 = -4.25, hx1 = -1.45, hw = hx1 - hx0;
    b.box(M.paint, hw, 0.06, 1.0, (hx0 + hx1) / 2, 1.7, 0.05);
    b.box(M.glass, hw, 1.0, 0.012, (hx0 + hx1) / 2, 0.7, 0.55); b.box(M.glass, hw, 1.0, 0.012, (hx0 + hx1) / 2, 0.7, -0.45);
    for (const x of [hx0, hx1]) { b.box(M.paint, 0.05, 1.08, 0.05, x, 0.62, 0.55); b.box(M.paint, 0.05, 1.08, 0.05, x, 0.62, -0.45); }
    // Bohröl-Aggregat hinten links
    b.rbox(M.oilUnit, 2.4, 1.05, 0.9, 0.05, -3.8, 0, -1.25);
    b.cyl(M.dark, 0.16, 0.42, -4.4, 1.05, -1.25, 14); b.cyl(M.dark, 0.16, 0.42, -3.9, 1.05, -1.25, 14);
    b.cyl(M.steel, 0.2, 0.75, -3.15, 1.05, -1.25, 16);
    b.cylX(M.steelDark, 0.05, 2.6, -4.4, 1.55, -1.1, 10);
    b.cylZ(M.steelDark, 0.05, 1.2, -1.8, 1.55, -1.1, 10);
    // Pult, Schrank, Späne
    b.cyl(M.dark, 0.06, 0.95, 0.4, 0, 1.25, 10); hmi(b, 0.4, 0.95, 1.25, 0);
    cabinet(b, 2.2, -1.3, 1.4, 1.9, 0.55, 0);
    b.box(M.darker, 0.9, 0.5, 0.6, -1.2, 0, 1.0);
    const chuck = grp(-4.27, ay, 0.05), cb = new Builder();
    cb.cylX(M.chuck, 0.25, 0.2, 0, 0, 0, 22);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; cb.boxC(M.steelDark, 0.08, 0.1, 0.12, 0.22, Math.cos(a) * 0.15, Math.sin(a) * 0.15); }
    cb.build(chuck); mo.group.add(chuck);
    const work = mesh(gCylC(20), M.steel); work.rotation.z = PI / 2; chuck.add(work);
    const oil = grp(0, 0.62, 0.05), ob = new Builder();
    ob.rbox(M.paint, 0.6, 0.85, 0.95, 0.05, 0, 0, 0); ob.box(M.dark, 0.05, 0.5, 0.6, 0.31, 0.2, 0);
    ob.build(oil); mo.group.add(oil);
    const boring = mesh(gCylC(10), M.chrome); boring.rotation.z = PI / 2; mo.group.add(boring);
    const supports = [0, 1, 2].map(() => { const g = grp(0, 0.62, 0.05), sb = new Builder(); sb.box(M.paint, 0.18, 0.62, 0.55, 0, 0, 0); sb.cylX(M.steelDark, 0.07, 0.2, -0.1, ay - 0.62, 0, 12); sb.build(g); mo.group.add(g); return g; });
    const car = grp(4, 0.62, 0.05), crb = new Builder();
    crb.rbox(M.paint, 1.1, 0.95, 1.05, 0.06, 0, 0, 0, 0, 0.02); crb.cylX(M.dark, 0.22, 0.55, 0.5, 0.55, 0, 16); crb.box(M.accent, 1.0, 0.04, 0.01, 0, 0.8, 0.53);
    crb.build(car); mo.group.add(car);
    mo.a = { chuck, work, oil, boring, supports, car, ay };
    tower(mo, -5.15, 1.75, -0.5);
    mo.conn = [2.2, 1.9, -1.3];
  };

  TB.hobber = (mo, b, W, D) => {
    const cx = 0;
    const c = cabin(mo, b, { cx, cz: 0.35, w: 3.0, h: 2.55, d: 2.7, intD: 1.35, win: { w: 1.45, h: 0.85, y0: 1.05, cx: -0.3 }, slide: -1 });
    const fy = c.floorY, iz = c.ic;
    b.box(M.mid, 0.6, 1.5, 0.75, cx + 0.85, fy, iz - 0.15);
    b.box(M.mid, 0.35, 1.3, 0.4, cx - 0.35, fy + 0.55, iz - 0.4);
    const table = grp(cx - 0.35, fy, iz - 0.05), tbb = new Builder();
    tbb.cyl(M.steelDark, 0.3, 0.18, 0, 0, 0, 24); tbb.cyl(M.steel, 0.15, 0.06, 0, 0.18, 0, 30);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; tbb.boxC(M.steel, 0.02, 0.055, 0.02, Math.cos(a) * 0.155, 0.21, Math.sin(a) * 0.155); }
    tbb.build(table); mo.group.add(table);
    const head = grp(cx + 0.2, fy + 0.6, iz - 0.05), hb = new Builder();
    hb.boxC(M.mid, 0.5, 0.32, 0.38, 0.12, 0, 0);
    hb.build(head); mo.group.add(head);
    const hob = mesh(gCylC(14), M.hob, -0.18, 0, 0, 0.07, 0.24, 0.07); hob.rotation.z = PI / 2 + 0.3; head.add(hob);
    cabinet(b, -0.75, -1.65, 1.4, 2.0, 0.55, 0);
    b.rbox(M.oilUnit, 1.2, 1.15, 0.55, 0.04, 0.85, 0, -1.65);
    chipCart(b, 1.45, 1.95, 0);
    b.box(M.steelDark, 0.08, 0.08, 0.45, cx + 1.2, 1.6, c.zf + 0.15);
    hmi(b, cx + 1.25, 1.0, c.zf + 0.4, -0.2);
    mo.a = { table, head, hob, fy };
    tower(mo, cx + 1.15, 2.55, -0.55);
    mo.conn = [-0.75, 2.0, -1.65];
  };

  TB.mill5 = (mo, b, W, D) => {
    const cx = -0.25;
    const c = cabin(mo, b, { cx, cz: 0.55, w: 3.2, h: 2.95, d: 2.9, intD: 1.6, win: { w: 1.9, h: 1.25, y0: 0.95, cx: 0 }, slide: -1 });
    const fy = c.floorY, iz = c.ic;
    const spindle = grp(cx, fy + 1.05, iz - 0.1), sb = new Builder();
    sb.boxC(M.mid, 0.55, 0.85, 0.55, 0, 0.55, -0.1);
    sb.build(spindle); mo.group.add(spindle);
    const tool = grp(0, 0, 0), tlb = new Builder();
    tlb.cyl(M.steelDark, 0.09, 0.14, 0, -0.02, 0, 16); tlb.cyl(M.steel, 0.022, 0.2, 0, -0.2, 0, 10);
    tlb.build(tool); spindle.add(tool);
    b.box(M.mid, 1.3, 0.35, 0.8, cx, fy, iz);
    const table = grp(cx, fy + 0.38, iz), tbb = new Builder();
    tbb.cyl(M.steelDark, 0.34, 0.08, 0, 0, 0, 28); tbb.box(M.alu, 0.38, 0.24, 0.3, 0, 0.08, 0);
    tbb.build(table); mo.group.add(table);
    // Werkzeugmagazin (Trommel) links
    b.cyl(M.paint, 0.75, 2.45, -2.45, 0, 0.15, 32); b.cyl(M.dark, 0.77, 0.12, -2.45, 0, 0.15, 32);
    b.box(M.glass, 0.5, 1.2, 0.012, -2.45, 0.9, 0.9);
    b.cyl(M.accent, 0.765, 0.05, -2.45, 2.1, 0.15, 32);
    // Palettenwechsler rechts (Haube über der inneren Hälfte)
    b.cyl(M.dark, 0.88, 0.82, 2.4, 0, 0.75, 32);
    b.box(M.paint, 0.95, 1.6, 1.9, 1.85, 0.82, 0.75); b.box(M.glass, 0.012, 0.7, 1.4, 2.33, 1.4, 0.75);
    for (const [x, z] of [[3.25, 0], [3.25, 1.5], [2.4, 1.72], [2.4, -0.22]]) b.box(M.yellow, 0.05, 1.3, 0.05, x, 0, z);
    b.box(M.fence, 0.02, 0.8, 1.5, 3.25, 0.45, 0.75);
    const pal = grp(2.4, 0.82, 0.75), pb = new Builder();
    pb.cyl(M.mid, 0.82, 0.05, 0, 0, 0, 32);
    for (const s of [-1, 1]) { pb.box(M.steelDark, 0.62, 0.08, 0.62, s * 0.45, 0.05, 0); pb.box(M.alu, 0.34, 0.22, 0.28, s * 0.45, 0.13, 0); }
    pb.box(M.paint, 0.04, 1.05, 1.5, 0, 0.05, 0);
    pb.build(pal); mo.group.add(pal);
    cabinet(b, cx - 0.8, -1.3, 1.8, 2.1, 0.6, 0);
    b.box(M.dark, 0.6, 0.5, 1.4, cx + 1.0, 0, -1.5); b.box(M.dark, 0.55, 0.45, 0.9, cx + 1.0, 0.5, -2.0, 0, -0.5);
    chipCart(b, cx + 1.0, -2.2, PI / 2);
    b.box(M.steelDark, 0.08, 0.08, 0.5, cx - 1.45, 1.75, c.zf + 0.15);
    hmi(b, cx - 1.45, 1.1, c.zf + 0.42, 0.25);
    mo.a = { spindle, tool, table, pal, palRot: 0, palTarget: 0, sx: cx, sy: fy + 1.05, sz: iz - 0.1 };
    tower(mo, cx + 1.35, 2.95, -0.6);
    mo.conn = [cx - 0.8, 2.1, -1.3];
  };

  TB.mill3 = (mo, b, W, D) => {
    const cx = -0.05;
    const c = cabin(mo, b, { cx, cz: 0.25, w: 3.2, h: 2.6, d: 2.2, intD: 1.25, win: { w: 1.75, h: 0.8, y0: 1.0, cx: 0.1 }, slide: 1 });
    const fy = c.floorY, iz = c.ic;
    b.box(M.mid, 0.7, 1.5, 0.35, cx + 0.1, fy, c.zi + 0.2);
    const spindle = grp(cx + 0.1, fy + 1.0, iz - 0.15), sb = new Builder();
    sb.boxC(M.mid, 0.5, 0.65, 0.5, 0, 0.35, -0.08); sb.build(spindle); mo.group.add(spindle);
    const tool = grp(0, 0, 0), tlb = new Builder(); tlb.cyl(M.steelDark, 0.08, 0.12, 0, -0.06, 0, 14); tlb.cyl(M.steel, 0.02, 0.18, 0, -0.22, 0, 10); tlb.build(tool); spindle.add(tool);
    const table = grp(cx, fy + 0.15, iz), tbb = new Builder();
    tbb.box(M.steelDark, 1.6, 0.12, 0.6, 0, 0, 0); tbb.box(M.dark, 0.32, 0.14, 0.2, 0, 0.12, 0); tbb.box(M.steel, 0.24, 0.1, 0.16, 0, 0.26, 0);
    tbb.build(table); mo.group.add(table);
    b.box(M.mid, 1.4, 0.15, 0.7, cx, fy, iz);
    // seitlicher Werkzeugwechsler (Scheibe)
    b.cylX(M.paint, 0.58, 0.3, cx - 1.6 - 0.3, 1.85, -0.15, 30); b.cylX(M.dark, 0.6, 0.05, cx - 1.6 - 0.34, 1.85, -0.15, 30);
    b.cylX(M.accent, 0.585, 0.03, cx - 1.6 - 0.18, 1.85, -0.15, 30);
    b.rbox(M.dark, 1.3, 0.6, 0.55, 0.04, cx - 0.9, 0, -1.15);
    b.box(M.steelDark, 0.25, 0.25, 0.7, cx + 1.2, 0.1, -1.15);
    b.box(M.steelDark, 0.06, 0.4, 0.06, cx + 1.4, 2.2, c.zf + 0.2);
    hmi(b, cx + 1.4, 1.15, c.zf + 0.25, -0.15);
    mo.a = { spindle, tool, table, tx: cx, tz: iz };
    tower(mo, cx + 1.35, 2.6, -0.55);
    mo.conn = [cx - 0.9, 2.6, -0.6];
  };

  TB.cylgrinder = (mo, b, W, D) => {
    const cx = 0.2;
    const c = cabin(mo, b, { cx, cz: 0.2, w: 3.9, h: 2.3, d: 2.4, intD: 1.45, win: { w: 2.6, h: 0.85, y0: 1.0, cx: 0 }, slide: 1 });
    const fy = c.floorY, iz = c.ic;
    b.box(M.granite, 3.4, 0.2, 1.1, cx, fy, iz - 0.1);
    b.box(M.steelDark, 2.8, 0.1, 0.38, cx, fy + 0.2, iz + 0.15);
    b.box(M.mid, 0.45, 0.42, 0.42, cx - 1.15, fy + 0.3, iz + 0.15); b.box(M.mid, 0.38, 0.36, 0.38, cx + 1.1, fy + 0.3, iz + 0.15);
    const wy = fy + 0.58;
    const work = mesh(gCylC(20), M.steel, cx, wy, iz + 0.15, 0.05, 1.8, 0.05); work.rotation.z = PI / 2; mo.group.add(work);
    const head = grp(cx + 0.1, fy + 0.3, iz - 0.25), hb = new Builder();
    hb.boxC(M.paintW, 0.75, 0.55, 0.55, 0, 0.27, -0.15);
    hb.add(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 22, 1, false, 0, PI).rotateZ(PI / 2), M.paintW, xf(0, 0.28, 0.12, 0, 0, 0));
    hb.build(head); mo.group.add(head);
    const wheel = mesh(gCylC(26), M.wheel, 0, 0.28, 0.12, 0.25, 0.063, 0.25); wheel.rotation.z = PI / 2; head.add(wheel);
    cabinet(b, cx + 1.1, -1.3, 1.3, 2.0, 0.55, 0);
    b.rbox(M.oilUnit, 1.5, 0.95, 0.55, 0.04, cx - 0.75, 0, -1.3);
    b.box(M.paint, 0.9, 0.35, 0.5, cx - 0.75, 0.95, -1.3);
    b.box(M.steelDark, 0.08, 0.08, 0.5, cx - 1.75, 1.55, c.zf + 0.15);
    hmi(b, cx - 1.75, 1.0, c.zf + 0.42, 0.2);
    mo.a = { work, head, wheel, hz: iz - 0.25 };
    tower(mo, cx + 1.7, 2.3, -0.7);
    mo.conn = [cx + 1.1, 2.0, -1.3];
  };

  TB.surfgrinder = (mo, b, W, D) => {
    const P = M.paintOld;
    b.rbox(P, 1.5, 0.95, 1.3, 0.08, 0, 0, 0.05, 0, 0.02);
    b.box(P, 1.3, 0.14, 1.0, 0, 0.95, 0.15);
    b.rbox(P, 0.72, 1.62, 0.7, 0.06, 0, 0.95, -0.45, 0, 0.02);
    b.cylZ(M.chrome, 0.12, 0.03, 0.45, 1.0, 0.65, 18); b.cylX(M.chrome, 0.12, 0.03, 0.75, 1.0, 0.2, 18);
    b.rbox(M.dark, 0.6, 0.5, 0.45, 0.04, 1.25, 0, -0.75);
    cabinet(b, -1.2, -0.85, 0.55, 1.45, 0.4, 0, P);
    const table = grp(0, 1.09, 0.3), tb = new Builder();
    tb.box(P, 2.4, 0.13, 0.62, 0, 0, 0); tb.box(M.steelDark, 1.3, 0.07, 0.5, 0, 0.13, 0);
    for (let i = 0; i < 3; i++) tb.box(M.steel, 0.4, 0.02, 0.04, -0.2 + i * 0.12, 0.2, -0.12 + i * 0.12, 0.2);
    tb.box(M.glass, 0.02, 0.2, 0.55, -0.7, 0.13, 0); tb.box(M.glass, 0.02, 0.2, 0.55, 0.7, 0.13, 0);
    tb.build(table); mo.group.add(table);
    const head = grp(0, 1.49, 0.3), hb = new Builder();
    hb.boxC(P, 0.56, 0.42, 0.8, 0, 0.26, -0.48);
    hb.cylZ(P, 0.18, 0.4, 0, 0.42, -0.85, 16);
    hb.add(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 22, 1, false, -PI / 2, PI).rotateX(PI / 2), P, xf(0, 0, 0));
    hb.build(head); mo.group.add(head);
    const wheel = mesh(gCylC(24), M.wheel, 0, 0, 0, 0.175, 0.04, 0.175); wheel.rotation.x = PI / 2; head.add(wheel);
    mo.a = { table, head, wheel };
    tower(mo, 0.25, 2.57, -0.62);
    mo.conn = null;
  };

  TB.washer = (mo, b, W, D) => {
    b.rbox(M.stainless, 2.3, 2.05, 2.0, 0.06, 0, 0, -0.05, 0, 0.02);
    b.box(M.paintW, 1.15, 1.25, 0.05, 0, 0.5, 0.95);
    b.box(M.dark, 0.55, 0.42, 0.02, 0, 0.98, 0.985);
    b.box(M.glass, 0.48, 0.36, 0.01, 0, 1.01, 0.995);
    b.box(mo.inner, 0.46, 0.34, 0.01, 0, 1.02, 0.94);
    b.box(M.accent, 2.2, 0.05, 0.012, 0, 1.85, 0.955);
    for (const s of [-1, 1]) {
      const x0 = s * 1.17, x1 = s * 2.2;
      b.box(M.dark, Math.abs(x1 - x0), 0.08, 0.66, (x0 + x1) / 2, 0.82, -0.05);
      for (const lx of [x0 + s * 0.1, x1 - s * 0.1]) { b.box(M.dark, 0.06, 0.82, 0.06, lx, 0, -0.33); b.box(M.dark, 0.06, 0.82, 0.06, lx, 0, 0.23); }
      for (let x = Math.min(x0, x1) + 0.08; x < Math.max(x0, x1); x += 0.22) b.cylZ(M.steel, 0.035, 0.62, x, 0.92, -0.36, 10);
      b.box(M.gitter, 0.5, 0.25, 0.4, s * 1.75, 0.95, -0.05);
    }
    b.cyl(M.stainless, 0.11, 0.75, 0.6, 2.05, -0.45, 14); b.cylZ(M.stainless, 0.11, 0.85, 0.6, 2.75, -1.25, 14);
    b.rbox(M.paintW, 0.6, 1.2, 0.45, 0.04, -0.95, 0, -1.1);
    hmi(b, 0.85, 0.9, 1.0, 0, true);
    const basket = grp(0, 1.18, 0.75); const bm = mesh(gCylC(12), M.gitter, 0, 0, 0, 0.17, 0.25, 0.17); bm.rotation.x = PI / 2; basket.add(bm); mo.group.add(basket);
    mo.a = { basket };
    tower(mo, 0.95, 2.05, -0.8);
    mo.conn = [0.95, 2.05, -0.8];
  };

  /** Messraum (Weltkoordinaten): Glasraum, KMG mit Granittisch und Portal, Arbeitsplatz */
  TB.cmm = (mo, b) => {
    const f = mo.st.footprint, c = mo.st.cmm, x0 = f.x, x1 = f.x + f.w, z0 = f.z, z1 = f.z + f.d, H = 2.8;
    const door = [mo.st.dock.x - 0.7, mo.st.dock.x + 0.7];
    const wallX = (z, a, bb) => { // Glaswand entlang x
      const len = bb - a; if (len <= 0.05) return;
      b.box(M.paintW, len, 0.12, 0.08, (a + bb) / 2, 0, z); b.box(M.glassRoom, len, H - 0.17, 0.02, (a + bb) / 2, 0.12, z); b.box(M.alu, len, 0.06, 0.08, (a + bb) / 2, H - 0.06, z);
      for (let x = a; x <= bb + 1e-6; x += Math.max(0.6, len / Math.max(1, Math.round(len / 1.5)))) b.box(M.alu, 0.05, H, 0.07, x, 0, z);
    };
    const wallZ = (x, a, bb) => {
      const len = bb - a;
      b.box(M.paintW, 0.08, 0.12, len, x, 0, (a + bb) / 2); b.box(M.glassRoom, 0.02, H - 0.17, len, x, 0.12, (a + bb) / 2); b.box(M.alu, 0.08, 0.06, len, x, H - 0.06, (a + bb) / 2);
      for (let z = a; z <= bb + 1e-6; z += len / Math.round(len / 1.5)) b.box(M.alu, 0.07, H, 0.05, x, 0, z);
    };
    wallX(z0, x0, door[0]); wallX(z0, door[1], x1); wallX(z1, x0, x1); wallZ(x0, z0, z1); wallZ(x1, z0, z1);
    b.box(M.alu, door[1] - door[0], 0.1, 0.08, (door[0] + door[1]) / 2, H - 0.3, z0);
    b.box(M.floorEpoxy, f.w - 0.1, 0.012, f.d - 0.1, (x0 + x1) / 2, 0, (z0 + z1) / 2);
    // KMG
    const tx = c.x + c.w / 2, tz = c.z + c.d / 2;
    b.box(M.dark, c.w - 0.4, 0.5, c.d - 0.4, tx, 0.05, tz);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(M.darker, 0.12, 0.1, tx + dx * (c.w / 2 - 0.35), 0, tz + dz * (c.d / 2 - 0.35), 12);
    b.box(M.granite, c.w, 0.3, c.d, tx, 0.55, tz);
    b.box(M.alu, 0.5, 0.3, 0.4, tx - 0.4, 0.85, tz + 0.1); b.box(M.steelDark, 0.3, 0.06, 0.3, tx - 0.4, 0.85, tz + 0.1);
    const bridge = grp(tx, 0.85, tz), bb = new Builder();
    for (const s of [-1, 1]) bb.box(M.alu, 0.16, 1.25, 0.34, s * (c.w / 2 - 0.12), 0, 0);
    bb.box(M.paintW, c.w, 0.24, 0.3, 0, 1.25, 0); bb.box(M.accent, c.w - 0.1, 0.04, 0.01, 0, 1.36, 0.155);
    bb.build(bridge); mo.group.add(bridge);
    const zcar = grp(0, 1.25, 0.05), zb = new Builder(); zb.box(M.paintW, 0.32, 0.42, 0.42, 0, -0.08, 0.1); zb.build(zcar); bridge.add(zcar);
    const ram = grp(0, 0, 0.12), rb = new Builder(); rb.box(M.alu, 0.09, 0.95, 0.09, 0, -0.55, 0); rb.cyl(M.steel, 0.012, 0.12, 0, -0.67, 0, 8); rb.sph(M.red, 0.025, 0, -0.68, 0, 10); rb.build(ram); zcar.add(ram);
    // Steuerschrank + Arbeitsplatz
    b.rbox(M.paintW, 0.55, 1.1, 0.5, 0.04, x1 - 0.7, 0, z1 - 0.8);
    b.box(M.paintW, 1.6, 0.05, 0.75, x0 + 1.2, 0.74, z1 - 0.6); b.box(M.dark, 1.5, 0.74, 0.05, x0 + 1.2, 0, z1 - 0.25);
    b.box(M.darker, 0.55, 0.36, 0.04, x0 + 1.2, 0.85, z1 - 0.45); b.box(M.screen, 0.5, 0.3, 0.005, x0 + 1.2, 0.88, z1 - 0.47, PI);
    b.box(M.darker, 0.45, 0.06, 0.45, x0 + 1.2, 0.48, z1 - 1.3); b.cyl(M.darker, 0.03, 0.45, x0 + 1.2, 0.03, z1 - 1.3, 8);
    b.box(M.paintW, 0.25, 0.45, 1.1, x1 - 0.16, 2.0, (z0 + z1) / 2);
    mo.a = { bridge, zcar, ram, tz, w: c.w, d: c.d };
    tower(mo, x1 - 0.7, 1.1, z1 - 0.8);
    mo.conn = [x1 - 0.7, 1.1, z1 - 0.8];
  };

  /** Montage (Weltkoordinaten): drei Montageplätze mit Baugruppen, Bereitstellregal, Terminal */
  TB.assembly = (mo, b) => {
    const f = mo.st.footprint, bx = 59.3;
    b.box(M.floorEpoxy, f.w - 0.2, 0.01, f.d - 0.2, f.x + f.w / 2, 0, f.z + f.d / 2);
    const benches = [13.0, 15.0, 17.0];
    mo.a = { mods: [] };
    benches.forEach((z, i) => {
      b.box(M.paintW, 0.9, 0.05, 1.6, bx, 0.85, z); b.box(M.dark, 0.85, 0.08, 1.55, bx, 0.12, z);
      for (const dz of [-0.72, 0.72]) for (const dx of [-0.38, 0.38]) b.box(M.dark, 0.05, 0.85, 0.05, bx + dx, 0, z + dz);
      b.box(M.steelDark, 0.04, 1.1, 1.6, bx + 0.45, 0.9, z); b.box(M.paint, 0.02, 0.8, 1.5, bx + 0.42, 1.05, z);
      b.box(M.dark, 0.05, 0.05, 1.6, bx + 0.45, 2.0, z); b.box(M.lens, 0.18, 0.02, 1.1, bx + 0.25, 1.97, z); b.box(M.dark, 0.25, 0.04, 1.2, bx + 0.25, 1.99, z);
      for (let k = 0; k < 5; k++) b.box(M.chrome, 0.02, 0.18, 0.03, bx + 0.4, 1.3 + (k % 2) * 0.25, z - 0.55 + k * 0.27);
      // Baugruppe (Zuführmodul): Profilrahmen + Antrieb – sichtbare Teile je Fortschritt
      const g = grp(bx - 0.05, 0.9, z), mb = new Builder();
      const fw = 0.6, fh = 0.5, fd = 0.75;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(M.alu, 0.035, fh, 0.035, sx * fw / 2, 0, sz * fd / 2);
      for (const sy of [0, fh]) { mb.box(M.alu, fw, 0.035, 0.035, 0, sy, -fd / 2); mb.box(M.alu, fw, 0.035, 0.035, 0, sy, fd / 2); mb.box(M.alu, 0.035, 0.035, fd, -fw / 2, sy, 0); mb.box(M.alu, 0.035, 0.035, fd, fw / 2, sy, 0); }
      mb.build(g);
      const motor = mesh(gCylC(16), M.accent, 0, 0.18, -0.15, 0.09, 0.32, 0.09); motor.rotation.x = PI / 2; g.add(motor);
      const gear = mesh(gBox(), M.mid, 0, 0.04, 0.15, 0.3, 0.22, 0.24); g.add(gear);
      const cover = mesh(gBox(), M.paintW, 0, fh + 0.035, 0, fw + 0.02, 0.02, fd + 0.02); g.add(cover);
      mo.group.add(g);
      mo.a.mods.push({ g, motor, gear, cover });
    });
    // Bereitstellregal mit KLT
    const rx = 62.3;
    for (const z of [11.6, 14.0, 16.4, 18.2]) b.box(M.blueRack, 0.06, 2.0, 0.06, rx - 0.45, 0, z), b.box(M.blueRack, 0.06, 2.0, 0.06, rx + 0.45, 0, z);
    for (let lv = 0; lv < 4; lv++) {
      const y = 0.3 + lv * 0.48;
      b.box(M.orange, 0.95, 0.05, 6.65, rx, y, 14.9, 0, 0.15);
      for (let i = 0; i < 9; i++) b.box(M.klt, 0.55, 0.25, 0.62, rx, y + 0.07, 11.95 + i * 0.73, 0, 0.15);
    }
    // Terminal (Tablet am Montageplatz 2)
    b.cyl(M.dark, 0.025, 1.2, bx - 0.55, 0.9, 15.75, 8);
    mo.tablet = tabletOn(mo, bx - 0.55, 2.1, 15.75, PI / 2);
    tower(mo, bx - 0.55, 2.2, 15.75 + 0.18);
    mo.conn = null;
  };
  /** Tablet-Marker (Level 0: Rückmeldung per Tablet) */
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
    const n = pts.length, pos = new Float32Array(n * 2 * 3), e = new Float32Array(n * 2), idx = [];
    pts.forEach(([x, z, nx, nz], i) => { pos.set([x, 0, z], i * 6); pos.set([x + nx * width, 0, z + nz * width], i * 6 + 3); e[i * 2] = 0; e[i * 2 + 1] = 1; });
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = i * 2, b = i * 2 + 1, c = j * 2, dd = j * 2 + 1; idx.push(a, c, b, b, c, dd); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('e', new THREE.BufferAttribute(e, 1)); g.setIndex(idx);
    return g;
  }
  function glowMat() {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uI: { value: 0.5 } },
      vertexShader: 'attribute float e; varying float vE; void main(){ vE = e; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uI; varying float vE; void main(){ float a = pow(1.0 - vE, 2.4) * 0.55 + smoothstep(0.07, 0.0, vE) * 0.6; gl_FragColor = vec4(uColor, a * uI); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
  }

  function buildMachine(st) {
    const f = st.footprint, world = st.type === 'cmm' || st.type === 'assembly';
    const ry = FACE_RY[st.facing] || 0;
    const W = Math.abs(Math.sin(ry)) > 0.5 ? f.d : f.w, D = Math.abs(Math.sin(ry)) > 0.5 ? f.w : f.d;
    const mo = { id: st.id, st, type: st.type, group: new THREE.Group(), W, D, ry, cx: f.x + f.w / 2, cz: f.z + f.d / 2, h: TYPE_H[st.type] || 2.4,
      inner: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.45, metalness: 0.25, emissive: 0xfff1da, emissiveIntensity: 0 }),
      prog: 0, p0: 0, p1: 0, v: null, sig: '', state: null, glowI: 0, t: 0 };
    if (!world) { mo.group.position.set(mo.cx, 0, mo.cz); mo.group.rotation.y = ry; }
    const b = new Builder();
    (TB[st.type] || TB.mill3)(mo, b, W, D);
    b.build(mo.group);
    R.scene.add(mo.group);
    // Zustandsrahmen am Boden
    const gm = glowMat();
    const gf = new THREE.Mesh(glowFrame(f.w + 0.2, f.d + 0.2, 0.9, 0.35), gm);
    gf.position.set(mo.cx, 0.02, mo.cz); gf.renderOrder = 1; R.scene.add(gf);
    mo.glow = { mesh: gf, mat: gm };
    // Pick-Proxy + Bounds (welt-achsenparallel)
    const proxy = new THREE.Mesh(gBox(), M.hidden);
    proxy.position.set(mo.cx, 0, mo.cz); proxy.scale.set(f.w, mo.h, f.d); proxy.userData = { kind: 'machine', id: st.id };
    R.scene.add(proxy); mo.proxy = proxy;
    mo.anchor = new THREE.Vector3(mo.cx, mo.h + 0.35, mo.cz);
    // Verbindungspunkt (Kabel) in Weltkoordinaten
    if (mo.conn) { const p = new THREE.Vector3(mo.conn[0], mo.conn[1], mo.conn[2]); if (!world) mo.group.localToWorld(mo.group.updateMatrixWorld(true) && p); mo.connW = p; }
    else mo.connW = null;
    if (!mo.tablet && st.conn && st.conn.level === 0 && !world) {
      // Level 0 ohne eigenes Tablet-Modell: Tablet am Ständer vor der Maschine
      const [ox, oz] = [-W / 2 + 0.35, D / 2 + 0.35];
      const s = new Builder(); s.cyl(M.dark, 0.025, 1.15, ox, 0, oz, 8); s.cyl(M.darker, 0.16, 0.03, ox, 0, oz, 14); s.build(mo.group);
      mo.tablet = tabletOn(mo, ox, 1.22, oz, 0);
    }
    // Werkzeugwechsel-Markierung / Lokale Werte
    R.mo[st.id] = mo; R.moList.push(mo);
    R.pick.push(proxy);
    return mo;
  }

  // ================================================================== Lager & Zonen
  function buildStores() {
    const P = WF.profile, ST = P.stationById, b = new Builder(), sc = R.scene, rnd = U.rng(42);
    // ---------- Rohmaterial: Kragarmregal
    const raw = ST.RAW, rf = raw.footprint;
    const cols = [1.55, 3.65, 5.75, 7.85], levels = [0.5, 1.2, 1.9, 2.6];
    for (const x of cols) {
      b.add(gIBeam(3.3, 0.24, 0.025, 0.012), M.blueRack, xf(x, 0, 0.75));
      b.box(M.blueRack, 0.22, 0.14, 1.7, x, 0, 1.4);
      for (const y of levels) { b.box(M.blueRack, 0.12, 0.1, 1.3, x, y, 1.55, 0, 0.04); b.box(M.blueRack, 0.12, 0.14, 0.06, x, y + 0.08, 2.18); }
    }
    b.box(M.blueRack, 6.5, 0.1, 0.12, 4.7, 3.2, 0.75);
    R.rawSlots = { 'MAT-42CR110': [0, 0], 'MAT-16MNCR90': [1, 0], 'MAT-42CR65': [1, 1], 'MAT-14404': [2, 0], 'MAT-TI10': [2, 1], 'MAT-2842': [3, 0] };
    R.rawLevels = levels;
    // Stk-Materialien in Gitterboxen vor dem Regal
    R.rawBins = {};
    [['MAT-ALBL', 2.6, 5.4], ['MAT-GUSSLD', 4.2, 5.4]].forEach(([id, x, z]) => {
      gitterboxStatic(b, x, z);
      const fill = mesh(gBox(), id === 'MAT-ALBL' ? M.alu : M.steelDark, x, 0.16, z, 0.72, 0.5, 0.66); fill.castShadow = false; sc.add(fill);
      R.rawBins[id] = fill;
    });
    // Stangen (instanziert, Menge = Bestand)
    R.barsInst = new THREE.InstancedMesh(gCylC(14), M.steel, 160); R.barsInst.castShadow = true; R.barsInst.receiveShadow = true; R.barsInst.count = 0; sc.add(R.barsInst);
    R.flatInst = new THREE.InstancedMesh(gBoxC(), M.steelDark, 40); R.flatInst.castShadow = true; R.flatInst.count = 0; sc.add(R.flatInst);
    // ---------- Werkzeugausgabe
    room(b, ST.CRIB, { glass: true, door: [17.1, 18.1], counter: [13.8, 15.2] });
    const cr = ST.CRIB.footprint;
    for (let i = 0; i < 6; i++) b.add(gBox(), M.drawers, xf(cr.x + 0.75 + i * 0.95, 0, cr.z + 0.55, 0, 0, 0, 0.88, 1.05, 0.65));
    b.box(M.paintW, 5.8, 0.04, 0.68, cr.x + 3.1, 1.05, cr.z + 0.55);
    for (let s = 0; s < 2; s++) {
      const rx = cr.x + 0.45, rz = cr.z + 2.0 + s * 2.1;
      b.box(M.paint, 0.6, 2.0, 1.8, rx, 0, rz);
      for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 6; i++) { b.cyl(M.steelDark, 0.04, 0.12, rx + 0.32, 0.4 + lv * 0.42, rz - 0.75 + i * 0.3, 10); b.cyl(M.steel, 0.012, 0.12, rx + 0.32, 0.52 + lv * 0.42, rz - 0.75 + i * 0.3, 6); }
    }
    const ps = ST.CRIB.presetter;
    b.rbox(M.paintW, 1.4, 0.85, 0.8, 0.04, ps.x, 0, ps.z); b.box(M.granite, 1.3, 0.08, 0.7, ps.x, 0.85, ps.z);
    b.cyl(M.steel, 0.09, 0.2, ps.x - 0.3, 0.93, ps.z, 16); b.box(M.paintW, 0.16, 0.95, 0.16, ps.x + 0.45, 0.93, ps.z - 0.15);
    b.box(M.dark, 0.3, 0.18, 0.2, ps.x + 0.2, 1.5, ps.z - 0.1); b.box(M.darker, 0.5, 0.34, 0.04, ps.x + 0.1, 1.62, ps.z + 0.3); b.box(M.screen, 0.45, 0.29, 0.005, ps.x + 0.1, 1.645, ps.z + 0.323);
    b.box(M.paint, 0.9, 0.9, 0.55, cr.x + 2.2, 0, cr.z + 3.0); for (let i = 0; i < 5; i++) b.cyl(M.steelDark, 0.04, 0.16, cr.x + 1.9 + i * 0.15, 0.9, cr.z + 3.0, 10);
    // ---------- Instandhaltung
    room(b, ST.MAINT, { glass: false, door: [24.6, 25.8] });
    const mt = ST.MAINT.footprint;
    b.box(M.wood, 2.2, 0.06, 0.8, mt.x + 1.6, 0.86, mt.z + 0.6); b.box(M.dark, 2.1, 0.86, 0.75, mt.x + 1.6, 0, mt.z + 0.6);
    b.box(M.steelDark, 0.25, 0.2, 0.18, mt.x + 0.9, 0.92, mt.z + 0.6); b.box(M.paint, 2.2, 1.0, 0.04, mt.x + 1.6, 1.1, mt.z + 0.15);
    for (let i = 0; i < 9; i++) b.box(M.steelDark, 0.03, 0.2 + (i % 3) * 0.06, 0.03, mt.x + 0.7 + i * 0.22, 1.35, mt.z + 0.19);
    b.box(M.blueRack, 1.0, 2.0, 0.5, mt.x + 5.6, 0, mt.z + 0.45);
    for (let lv = 0; lv < 4; lv++) { b.box(M.steelDark, 1.0, 0.03, 0.5, mt.x + 5.6, 0.2 + lv * 0.5, mt.z + 0.45); b.box(M.klt, 0.4, 0.22, 0.4, mt.x + 5.35, 0.23 + lv * 0.5, mt.z + 0.45); b.box(M.carton, 0.35, 0.25, 0.35, mt.x + 5.85, 0.23 + lv * 0.5, mt.z + 0.45); }
    b.box(M.dark, 0.5, 0.08, 0.5, mt.x + 4.0, 0, mt.z + 0.6); b.cyl(M.steelDark, 0.05, 1.6, mt.x + 4.0, 0.08, mt.z + 0.45, 10); b.box(M.paint, 0.3, 0.35, 0.45, mt.x + 4.0, 1.4, mt.z + 0.55);
    for (const dz of [0, 0.62]) b.cyl(M.accent, 0.29, 0.88, mt.x + 5.7, 0, mt.z + 4.6 + dz, 18);
    b.box(M.wood, 1.2, 0.14, 0.8, mt.x + 3.8, 0, mt.z + 4.4); b.cylX(M.accent, 0.22, 0.55, mt.x + 3.55, 0.36, mt.z + 4.4, 16); b.box(M.dark, 0.3, 0.3, 0.35, mt.x + 4.15, 0.14, mt.z + 4.4);
    // ---------- Pufferlager (Palettenregal)
    const pf = ST.PUF.footprint, bays = 5, bw = (pf.w - 0.2) / bays, zF = pf.z + 0.15, zB = pf.z + 1.25;
    for (let i = 0; i <= bays; i++) { const x = pf.x + 0.1 + i * bw; b.box(M.blueRack, 0.09, 4.3, 0.09, x, 0, zF); b.box(M.blueRack, 0.09, 4.3, 0.09, x, 0, zB); for (let y = 0.4; y < 4.2; y += 0.9) b.box(M.blueRack, 0.04, 0.04, zB - zF, x, y, (zF + zB) / 2, 0, 0.5); }
    for (let i = 0; i < bays; i++) for (const y of [1.4, 2.8]) { const x = pf.x + 0.1 + (i + 0.5) * bw; b.box(M.orange, bw, 0.11, 0.06, x, y, zF); b.box(M.orange, bw, 0.11, 0.06, x, y, zB); }
    for (let i = 0; i < bays; i++) for (const y of [0, 1.51, 2.91]) for (const s of [-1, 1]) {
      const r = rnd.next(); if (r < 0.2) continue;
      const x = pf.x + 0.1 + (i + 0.5) * bw + s * bw * 0.25, z = (zF + zB) / 2;
      palletStatic(b, x, y, z, PI / 2);
      if (r < 0.55) b.rbox(M.carton, 0.95, 0.7 + rnd.range(0, 0.3), 0.75, 0.02, x, y + 0.15, z, PI / 2);
      else if (r < 0.8) gitterboxStatic(b, x, z, y + 0.15);
      else for (let k = 0; k < 3; k++) b.box(M.klt, 0.6, 0.28, 0.4, x, y + 0.15 + k * 0.29, z);
    }
    // ---------- Ladestation
    const ch = ST.CHG;
    for (const p of [ch.inPos, ch.outPos]) {
      b.rbox(M.paintW, 0.62, 1.15, 0.32, 0.03, p.x, 0, ch.footprint.z + 0.2);
      b.box(M.dark, 0.9, 0.03, 0.5, p.x, 0, p.z - 0.2); b.box(M.chrome, 0.7, 0.012, 0.06, p.x, 0.03, p.z - 0.3);
    }
    R.chgLeds = [ch.inPos, ch.outPos].map(p => { const m = new THREE.MeshBasicMaterial({ color: 0x1b3a2c }); const s = mesh(gBoxC(), m, p.x, 0.9, ch.footprint.z + 0.37, 0.3, 0.06, 0.01); sc.add(s); return m; });
    // ---------- Leitstand / Büro mit MES-Server
    room(b, ST.OFFICE, { glass: true, door: [58.0, 59.0], solidBack: true });
    const of = ST.OFFICE.footprint;
    for (const [x, z] of [[58.4, 3.2], [60.2, 3.2]]) {
      b.box(M.paintW, 1.4, 0.04, 0.75, x, 0.73, z); b.box(M.dark, 0.05, 0.73, 0.7, x - 0.65, 0, z); b.box(M.dark, 0.05, 0.73, 0.7, x + 0.65, 0, z);
      b.box(M.darker, 0.58, 0.36, 0.04, x, 0.85, z - 0.25); b.box(M.screen, 0.54, 0.32, 0.005, x, 0.87, z - 0.226);
      b.box(M.darker, 0.45, 0.07, 0.45, x, 0.47, z + 0.55); b.box(M.darker, 0.45, 0.45, 0.06, x, 0.5, z + 0.8);
    }
    const sv = ST.OFFICE.server;
    b.rbox(M.darker, 0.65, 2.05, 1.0, 0.02, sv.x, 0, sv.z); b.box(M.glass, 0.6, 1.9, 0.01, sv.x, 0.08, sv.z + 0.51);
    R.serverLeds = [0, 1, 2].map(k => new THREE.MeshBasicMaterial({ color: [0x34d399, 0x3cc6f2, 0x34d399][k], toneMapped: false }));
    for (let i = 0; i < 14; i++) b.box(R.serverLeds[i % 3], 0.04, 0.015, 0.01, sv.x - 0.2 + (i % 2) * 0.08, 0.3 + i * 0.11, sv.z + 0.5);
    for (let i = 0; i < 7; i++) b.box(M.dark, 0.56, 0.08, 0.02, sv.x, 0.28 + i * 0.24, sv.z + 0.495);
    // Hallen-TV (Leitstand-Ansicht, echte Kennzahlen)
    const tvC = cnv(512, 228), tvT = tex(tvC); R.tvTex = tvT;
    b.box(M.dark, 0.08, 1.5, 0.08, 61.4, 0, 7.55); b.box(M.dark, 0.5, 0.04, 0.4, 61.4, 0, 7.55);
    b.rbox(M.darker, 1.72, 0.82, 0.07, 0.02, 61.4, 1.45, 7.6);
    const tv = mesh(new THREE.PlaneGeometry(1.64, 0.74), new THREE.MeshBasicMaterial({ map: tvT, toneMapped: false }), 61.4, 1.86, 7.64); tv.castShadow = false; sc.add(tv);
    b.cyl(M.dark, 0.18, 0.35, 57.6, 0, 7.4, 14); b.sph(M.plant, 0.38, 57.6, 0.75, 7.4, 12);
    // ---------- Wareneingang (Anlieferungen)
    const we = ST.WE.footprint;
    palletStatic(b, 1.6, 0, 36.6, 0); b.rbox(M.wrap, 0.78, 0.95, 1.15, 0.03, 1.6, 0.15, 36.6, PI / 2);
    palletStatic(b, 7.9, 0, 36.6, 0); b.rbox(M.carton, 0.8, 0.6, 1.1, 0.02, 7.9, 0.15, 36.6, PI / 2);
    b.box(M.yellow, 0.55, 0.2, 0.45, we.x + 4.75, 0, 36.55); b.box(M.dark, 0.06, 1.0, 0.06, we.x + 4.75, 0.2, 36.35); b.box(M.steelDark, 0.55, 0.05, 1.1, we.x + 4.75, 0.05, 37.2);
    // ---------- Sperrlager: roter Gitterkäfig
    const sp = ST.SPERR.footprint, door = [ST.SPERR.dock.x - 0.6, ST.SPERR.dock.x + 0.6], CH = 2.1;
    const cageX = (z, a, c2) => { if (c2 - a < 0.05) return; b.box(M.fenceRed, c2 - a, CH - 0.1, 0.02, (a + c2) / 2, 0.08, z); b.box(M.red, c2 - a, 0.05, 0.05, (a + c2) / 2, CH, z); };
    const cageZ = (x, a, c2) => { b.box(M.fenceRed, 0.02, CH - 0.1, c2 - a, x, 0.08, (a + c2) / 2); b.box(M.red, 0.05, 0.05, c2 - a, x, CH, (a + c2) / 2); };
    cageX(sp.z + 0.05, sp.x + 0.05, door[0]); cageX(sp.z + 0.05, door[1], sp.x + sp.w - 0.05); cageX(sp.z + sp.d - 0.05, sp.x + 0.05, sp.x + sp.w - 0.05);
    cageZ(sp.x + 0.05, sp.z + 0.05, sp.z + sp.d - 0.05); cageZ(sp.x + sp.w - 0.05, sp.z + 0.05, sp.z + sp.d - 0.05);
    for (const x of [sp.x + 0.05, door[0], door[1], sp.x + sp.w - 0.05]) b.box(M.red, 0.06, CH + 0.05, 0.06, x, 0, sp.z + 0.05);
    for (const x of [sp.x + 0.05, sp.x + sp.w / 2, sp.x + sp.w - 0.05]) b.box(M.red, 0.06, CH + 0.05, 0.06, x, 0, sp.z + sp.d - 0.05);
    const sign = mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: texLabel('GESPERRT', { bg: '#b8302a', px: 70, w: 512, h: 128 }), roughness: 0.6 }), sp.x + 1.15, 1.75, sp.z + 0.02);
    sign.rotation.y = PI; sc.add(sign);
    const sign2 = sign.clone(); sign2.position.set(sp.x + 1.15, 1.75, sp.z + 0.08); sign2.rotation.y = 0; sc.add(sign2);
    // ---------- Versand: Packtisch, Wickelmaschine
    const vs = ST.VERSAND.footprint;
    b.box(M.wood, 1.6, 0.05, 0.8, 61.9, 0.85, 26.2); b.box(M.dark, 1.5, 0.85, 0.7, 61.9, 0, 26.2);
    b.rbox(M.carton, 0.5, 0.35, 0.4, 0.02, 61.6, 0.9, 26.2); b.box(M.paintW, 0.3, 0.2, 0.25, 62.3, 0.9, 26.1);
    b.cyl(M.dark, 0.95, 0.1, 61.5, 0, 31.0, 30); b.box(M.paint, 0.3, 2.3, 0.3, 62.7, 0, 31.0); b.box(M.dark, 0.25, 0.35, 0.3, 62.45, 1.0, 31.0); b.cyl(M.wrap, 0.07, 0.5, 62.3, 0.95, 31.0, 12);
    palletStatic(b, 61.5, 0.1, 31.0, 0); b.rbox(M.wrap, 0.8, 1.0, 1.2, 0.04, 61.5, 0.25, 31.0, PI / 2);
    b.box(M.blueRack, 0.08, 2.4, 0.08, 63.1, 0, 33.5); b.box(M.blueRack, 0.08, 2.4, 0.08, 63.1, 0, 38.5);
    b.build(sc);
    void vs; void we; void rf; void of;
  }
  function palletStatic(b, x, y, z, ry) {
    const r = ry || 0;
    b.box(M.wood, 1.2, 0.022, 0.8, x, y + 0.122, z, r);
    for (const s of [-1, 0, 1]) { const [ox, oz] = rotXZ(0, s * 0.35, r); b.box(M.wood, 1.2, 0.1, 0.1, x + ox, y + 0.022, z + oz, r); }
    for (const s of [-1, 0, 1]) { const [ox, oz] = rotXZ(s * 0.5, 0, r); b.box(M.wood, 0.14, 0.022, 0.8, x + ox, y, z + oz, r); }
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
      const seg = (s0, s1) => { const len = s1 - s0; if (len < 0.05) return; b.box(M.paint, len, 1.0, 0.07, (s0 + s1) / 2, 0, z); b.box(upper, len, H - 1.05, 0.02, (s0 + s1) / 2, 1.0, z); b.box(M.alu, len, 0.05, 0.08, (s0 + s1) / 2, H - 0.05, z); for (let x = s0; x <= s1 + 1e-6; x += Math.max(0.8, len / Math.max(1, Math.round(len / 1.4)))) b.box(M.alu, 0.05, H, 0.08, x, 0, z); };
      for (const [g0, g1, low] of gaps || []) { seg(cur, g0); if (low) { b.box(M.paint, g1 - g0, 1.0, 0.07, (g0 + g1) / 2, 0, z); b.box(M.wood, g1 - g0 + 0.2, 0.05, 0.5, (g0 + g1) / 2, 1.0, z + 0.15); b.box(M.alu, g1 - g0, 0.05, 0.08, (g0 + g1) / 2, H - 0.05, z); } else b.box(M.alu, g1 - g0, 0.1, 0.08, (g0 + g1) / 2, 2.2, z); cur = g1; }
      seg(cur, c);
    };
    const wallZ = (x, a, c) => { const len = c - a; b.box(M.paint, 0.07, 1.0, len, x, 0, (a + c) / 2); b.box(upper, 0.02, H - 1.05, len, x, 1.0, (a + c) / 2); b.box(M.alu, 0.08, 0.05, len, x, H - 0.05, (a + c) / 2); for (let z = a; z <= c + 1e-6; z += len / Math.max(1, Math.round(len / 1.4))) b.box(M.alu, 0.08, H, 0.05, x, 0, z); };
    const gaps = []; if (o.counter) gaps.push([o.counter[0], o.counter[1], true]); if (o.door) gaps.push([o.door[0], o.door[1], false]);
    gaps.sort((p, q) => p[0] - q[0]);
    wallX(z1, x0, x1, gaps);
    if (z0 > 0.6) wallX(z0, x0, x1, []);
    wallZ(x0, z0, z1);
    if (x1 < 63.5) wallZ(x1, z0, z1);
    else b.box(M.paint, 0.07, H, z1 - z0, x1 - 0.04, 0, (z0 + z1) / 2);
    b.box(M.floorEpoxy, f.w - 0.12, 0.01, f.d - 0.12, (x0 + x1) / 2, 0.002, (z0 + z1) / 2);
  }

  // ================================================================== Personen, AGVs, Stapler
  const ROLES = {
    op: { label: 'Bedienung', vest: '#ff7a1f' }, setter: { label: 'Einrichter', vest: '#ffd21f' }, qs: { label: 'Qualitätsprüfung', vest: '#3d8bff' },
    log: { label: 'Logistik', vest: '#6fdc3c' }, maint: { label: 'Instandhaltung', vest: '#e5484d' }, asm: { label: 'Montage', vest: '#a66bff' }, lead: { label: 'Schichtleitung', vest: '#f2f4f7' },
  };
  const roleOf = (role) => /Schichtleit/.test(role) ? 'lead' : /Einricht/.test(role) ? 'setter' : /Qualit/.test(role) ? 'qs' : /Logist/.test(role) ? 'log' : /Instand/.test(role) ? 'maint' : /Monteur/.test(role) ? 'asm' : 'op';
  const SKIN = ['#e9c4a6', '#d8a883', '#b98463', '#f0cdb2', '#a87454'];
  function colored(list) {
    // list: [geometry, matrix, hex] → BufferGeometry mit Vertexfarben (linear)
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
      const vest = ROLES[roleKey].vest, shirt = '#2c3a52', pants = '#283041', shoe = '#1a1d22', hat = roleKey === 'lead' ? '#f4f5f2' : '#f1f1ec', refl = '#d9dde2';
      const torso = new THREE.CapsuleGeometry(0.17, 0.3, 4, 10);
      const body = colored([
        [torso, xf(0, 1.2, 0, 0, 0, 0, 1.12, 1, 0.72), vest],
        [new THREE.CylinderGeometry(0.193, 0.193, 0.045, 14), xf(0, 1.1, 0, 0, 0, 0, 1, 1, 0.74), refl],
        [new THREE.CylinderGeometry(0.192, 0.192, 0.045, 14), xf(0, 1.27, 0, 0, 0, 0, 1, 1, 0.74), refl],
        [new THREE.CylinderGeometry(0.06, 0.07, 0.08, 10), xf(0, 1.53, 0), skin],
        [new THREE.SphereGeometry(0.105, 14, 10), xf(0, 1.65, 0), skin],
        [new THREE.SphereGeometry(0.118, 14, 7, 0, TAU, 0, PI / 2), xf(0, 1.68, 0), hat],
        [new THREE.CylinderGeometry(0.128, 0.128, 0.014, 16), xf(0, 1.68, 0.025), hat],
      ]);
      const leg = colored([[new THREE.CapsuleGeometry(0.07, 0.66, 3, 8), xf(0, -0.42, 0), pants], [new THREE.BoxGeometry(0.11, 0.07, 0.24), xf(0, -0.8, 0.04), shoe]]);
      const arm = colored([[new THREE.CapsuleGeometry(0.052, 0.46, 3, 8), xf(0, -0.28, 0), shirt], [new THREE.SphereGeometry(0.05, 8, 6), xf(0, -0.57, 0), skin]]);
      const seated = colored([
        [torso, xf(0, 1.15, -0.05, -0.1, 0, 0, 1.12, 1, 0.72), vest],
        [new THREE.CylinderGeometry(0.193, 0.193, 0.045, 14), xf(0, 1.05, -0.04, -0.1, 0, 0, 1, 1, 0.74), refl],
        [new THREE.SphereGeometry(0.105, 14, 10), xf(0, 1.6, -0.08), skin],
        [new THREE.SphereGeometry(0.118, 14, 7, 0, TAU, 0, PI / 2), xf(0, 1.63, -0.08), hat],
        [new THREE.CapsuleGeometry(0.07, 0.36, 3, 8), xf(-0.1, 0.86, 0.15, PI / 2, 0, 0), pants],
        [new THREE.CapsuleGeometry(0.07, 0.36, 3, 8), xf(0.1, 0.86, 0.15, PI / 2, 0, 0), pants],
        [new THREE.CapsuleGeometry(0.05, 0.38, 3, 8), xf(-0.21, 1.25, 0.12, 1.1, 0, 0), shirt],
        [new THREE.CapsuleGeometry(0.05, 0.38, 3, 8), xf(0.21, 1.25, 0.12, 1.1, 0, 0), shirt],
      ]);
      return { body, leg, arm, seated };
    });
  }
  function blob(sx, sz) {
    const m = new THREE.Mesh(cache('blobg', () => new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)), M.blob);
    m.scale.set(sx, 1, sz); m.position.y = 0.012; m.renderOrder = 0; return m;
  }
  function buildPeople() {
    const S = WF.sim.state;
    for (const pp of WF.profile.people) {
      const rk = roleOf(pp.role), skin = SKIN[(parseInt(pp.id.slice(1), 10) * 7) % SKIN.length], G = personGeos(rk, skin);
      const g = new THREE.Group();
      const body = new THREE.Mesh(G.body, M.vc); body.castShadow = false;
      const legL = grp(-0.09, 0.86, 0), legR = grp(0.09, 0.86, 0), armL = grp(-0.235, 1.43, 0), armR = grp(0.235, 1.43, 0);
      legL.add(new THREE.Mesh(G.leg, M.vc)); legR.add(new THREE.Mesh(G.leg, M.vc)); armL.add(new THREE.Mesh(G.arm, M.vc)); armR.add(new THREE.Mesh(G.arm, M.vc));
      const item = grp(0, -0.55, 0.06); item.visible = false;
      const tool = new Builder(); tool.cyl(M.steelDark, 0.035, 0.08, 0, -0.04, 0, 10); tool.cyl(M.steel, 0.012, 0.12, 0, -0.16, 0, 6); const tm = tool.build(item, false);
      armR.add(item);
      g.add(body, legL, legR, armL, armR, blob(0.75, 0.6));
      const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(0.7, 1.85, 0.7); proxy.userData = { kind: 'person', id: pp.id }; g.add(proxy);
      g.visible = false; R.scene.add(g);
      const p = S.people[pp.id];
      R.people[pp.id] = { id: pp.id, g, legL, legR, armL, armR, item, tm, proxy, rk, G, x: p ? p.pos.x : pp.home.x, z: p ? p.pos.z : pp.home.z, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, phase: 0, vis: false, work: 0, walk: 0 };
    }
  }
  function buildAgvs() {
    for (const ap of WF.profile.agvs) {
      const g = new THREE.Group(), b = new Builder();
      b.rbox(M.dark, 0.84, 0.09, 1.28, 0.12, 0, 0.03, 0);
      b.rbox(M.paintW, 0.8, 0.22, 1.24, 0.12, 0, 0.1, 0, 0, 0.03);
      b.box(M.rubber, 0.66, 0.035, 0.98, 0, 0.32, 0);
      b.box(M.yellow, 0.6, 0.06, 0.02, 0, 0.12, 0.625); b.box(M.yellow, 0.6, 0.06, 0.02, 0, 0.12, -0.625);
      b.cyl(M.darker, 0.065, 0.07, 0.28, 0.32, 0.5, 16);
      b.box(M.darker, 0.42, 0.06, 0.012, 0, 0.2, 0.622);
      b.build(g);
      const led = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, toneMapped: false });
      const ring = mesh(gRBox(0.815, 0.028, 1.255, 0.12), led, 0, 0.215, 0); ring.castShadow = false; g.add(ring);
      const lid = mesh(gCyl(16), led, 0.28, 0.39, 0.5, 0.05, 0.012, 0.05); lid.castShadow = false; g.add(lid);
      g.add(blob(1.3, 1.7));
      const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(0.9, 0.6, 1.35); proxy.userData = { kind: 'agv', id: ap.id }; g.add(proxy);
      R.scene.add(g);
      R.agvs[ap.id] = { id: ap.id, g, led, proxy, x: 0, z: 0, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, init: false };
      R.pick.push(proxy);
    }
  }
  function buildForklift() {
    const g = new THREE.Group(), b = new Builder();
    const body = new THREE.MeshStandardMaterial({ color: 0xe0a21c, roughness: 0.45 });
    b.rbox(body, 1.05, 0.55, 1.55, 0.12, 0, 0.16, -0.12, 0, 0.03);
    b.rbox(M.dark, 1.08, 0.9, 0.45, 0.14, 0, 0.16, -0.95, 0, 0.04);
    for (const [x, z, r] of [[-0.46, 0.45, 0.23], [0.46, 0.45, 0.23], [-0.46, -0.72, 0.19], [0.46, -0.72, 0.19]]) b.cylX(M.rubber, r, 0.18, x - 0.09, r, z, 16);
    for (const [x, z] of [[-0.47, -0.55], [0.47, -0.55], [-0.47, 0.4], [0.47, 0.4]]) b.box(M.darker, 0.05, 1.35, 0.05, x, 0.7, z);
    b.box(M.darker, 1.0, 0.04, 1.02, 0, 2.05, -0.07);
    for (let i = 0; i < 5; i++) b.box(M.darker, 0.95, 0.02, 0.03, 0, 2.08, -0.5 + i * 0.22);
    b.box(M.darker, 0.5, 0.12, 0.45, 0, 0.71, -0.3); b.box(M.darker, 0.5, 0.4, 0.08, 0, 0.83, -0.53);
    b.add(new THREE.TorusGeometry(0.13, 0.015, 6, 18), M.darker, xf(0, 1.15, 0.2, -1.0, 0, 0));
    b.box(M.dark, 0.08, 2.2, 0.12, -0.32, 0.05, 0.8); b.box(M.dark, 0.08, 2.2, 0.12, 0.32, 0.05, 0.8); b.box(M.dark, 0.72, 0.08, 0.12, 0, 2.17, 0.8);
    b.build(g);
    const forks = grp(0, 0.1, 0), fb = new Builder();
    fb.box(M.darker, 0.78, 0.42, 0.05, 0, 0, 0.88); fb.box(M.steelDark, 0.1, 0.045, 1.05, -0.22, 0, 1.38); fb.box(M.steelDark, 0.1, 0.045, 1.05, 0.22, 0, 1.38);
    fb.build(forks); g.add(forks);
    const bars = grp(0, 0.08, 1.4); for (let i = 0; i < 5; i++) { const m = mesh(gCylC(10), M.steel, -0.2 + (i % 3) * 0.2, 0.04 + Math.floor(i / 3) * 0.07, 0, 0.032, 3.0, 0.032); m.rotation.z = PI / 2; bars.add(m); }
    bars.visible = false; forks.add(bars);
    const beacon = new THREE.MeshBasicMaterial({ color: 0xff9d3d, toneMapped: false });
    const bc = mesh(gCyl(12), beacon, 0.35, 2.09, -0.45, 0.05, 0.08, 0.05); bc.castShadow = false; g.add(bc);
    const spot = new THREE.Mesh(cache('spotg', () => new THREE.CircleGeometry(0.45, 24).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, map: M.glowT }));
    spot.position.set(0, 0.02, 3.0); g.add(spot);
    const driver = new THREE.Mesh(personGeos('log', SKIN[1]).seated, M.vc); driver.position.set(0, -0.02, -0.25); driver.visible = false; g.add(driver);
    g.add(blob(1.6, 2.4));
    const proxy = new THREE.Mesh(gBox(), M.hidden); proxy.scale.set(1.2, 2.1, 2.6); proxy.position.z = 0.2; proxy.userData = { kind: 'forklift', id: 'STP1' }; g.add(proxy);
    R.scene.add(g);
    R.fork = { g, forks, bars, beacon, spot, driver, proxy, x: 0, z: 0, h: 0, x0: 0, z0: 0, x1: 0, z1: 0, th: 0, init: false, fy: 0.1, driverRole: null };
    R.pick.push(proxy);
  }

  // ================================================================== Behälter (instanziert)
  const CMAX = { klt: 140, gb: 80, rack: 24, wrap: 70 };
  function buildContainers() {
    const sc = R.scene, C = R.C = { list: [], byInst: { klt: [], gb: [], rack: [], wrap: [] } };
    const inst = (geo, mat, n, shadow) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = shadow !== false; m.receiveShadow = true; m.frustumCulled = false; sc.add(m); return m; };
    C.klt = inst(gOpenBox(0.6, 0.3, 0.4), M.klt, CMAX.klt); C.klt.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CMAX.klt * 3), 3);
    C.kltFill = inst(gBox(), M.parts, CMAX.klt, false);
    C.gbBase = inst(cache('gbbase', () => mergeGeos([[gBox(), xf(0, 0, 0, 0, 0, 0, 0.82, 0.11, 0.76)], ...[[-0.39, -0.36], [0.39, -0.36], [-0.39, 0.36], [0.39, 0.36]].map(([x, z]) => [gBox(), xf(x, 0, z, 0, 0, 0, 0.045, 0.8, 0.045)])])), M.steelDark, CMAX.gb);
    C.gb = inst(gOpenBox(0.8, 0.66, 0.74), M.gitter, CMAX.gb, false);
    C.gbFill = inst(gBox(), M.parts, CMAX.gb, false);
    C.rack = inst(cache('rackg', () => mergeGeos([
      [gBox(), xf(-0.34, 0, 0, 0, 0, 0, 0.06, 0.08, 1.3)], [gBox(), xf(0.34, 0, 0, 0, 0, 0, 0.06, 0.08, 1.3)],
      [gBox(), xf(0, 0.08, -0.45, 0, 0, 0, 0.8, 0.12, 0.1)], [gBox(), xf(0, 0.08, 0.45, 0, 0, 0, 0.8, 0.12, 0.1)],
      ...[[-0.34, -0.6], [0.34, -0.6], [-0.34, 0.6], [0.34, 0.6]].map(([x, z]) => [gBox(), xf(x, 0, z, 0, 0, 0, 0.06, 0.5, 0.06)])])), M.blueRack, CMAX.rack);
    C.shaft = inst(cache('shaftg', () => new THREE.CylinderGeometry(1, 1, 1, 20).rotateX(PI / 2)), M.steel, CMAX.rack * 3);
    C.wrap = inst(cache('wrapg', () => mergeGeos([[gRBox(0.78, 0.8, 0.78, 0.05), xf(0, 0.14, 0)]])), M.wrap, CMAX.wrap);
    C.pal = inst(cache('palg', () => { const b = new Builder(); palletStatic(b, 0, 0, 0, 0); const l = b.map.get(M.wood); b.map.clear(); return mergeGeos(l); }), M.wood, CMAX.wrap);
    C.ring = inst(cache('cring', () => new THREE.RingGeometry(0.62, 0.74, 40).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }), 60, false);
    C.ring.renderOrder = 3;
    C.wait = inst(cache('wring', () => new THREE.RingGeometry(0.5, 0.58, 36).rotateX(-PI / 2)), new THREE.MeshBasicMaterial({ color: 0xff9d3d, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), 30, false);
    C.wait.renderOrder = 3;
    [C.klt, C.gb, C.rack, C.wrap].forEach((m, i) => { m.userData = { kind: 'container', inst: ['klt', 'gb', 'rack', 'wrap'][i] }; R.pick.push(m); });
  }

  // ================================================================== Ebenen: Materialfluss (Transportwege)
  function flowMaterial(hex, mode) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: srgb(hex) }, uMode: { value: mode }, uOp: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uMode; uniform float uOp; varying vec2 vUv;
        void main(){
          float w = abs(vUv.y - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.15, 1.0, w);
          float sp = uMode > 1.5 ? 1.6 : 1.25;
          float s = fract(vUv.x / sp + uTime * (uMode > 1.5 ? 0.45 : 0.9));
          float c = smoothstep(0.0, 0.05, s - w * 0.32) * (1.0 - smoothstep(0.16, 0.24, s - w * 0.32));
          float a;
          vec3 col = uColor;
          if (uMode < 0.5) { a = core * 0.42 + c * 0.95 * (1.0 - w * 0.5); col = uColor * (0.85 + c * 0.6); }
          else if (uMode < 1.5) { float dsh = step(0.55, fract(vUv.x / 0.7 + uTime * 0.6)); a = core * 0.45 * dsh; }
          else { float dsh = step(0.42, fract(vUv.x / 0.9 + uTime * 0.45)); a = (core * 0.7) * dsh + c * 0.35; }
          gl_FragColor = vec4(col, a * uOp);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
  }
  /** Bandgeometrie entlang einer Polylinie am Boden; uv.x = Distanz bis zum Ziel (Chevrons laufen zum Ziel) */
  function ribbon(pts, width, y) {
    const n = pts.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    const total = []; let acc = 0; total[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) { acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); total[i] = acc; }
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
      let dx = c.x - a.x, dz = c.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * width / 2, nz = dx * width / 2;
      pos.set([pts[i].x + nx, y, pts[i].z + nz, pts[i].x - nx, y, pts[i].z - nz], i * 6);
      uv.set([total[i], 0, total[i], 1], i * 4);
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  function buildFlow() {
    R.flowMats = { loaded: flowMaterial('#ff9d3d', 0), approach: flowMaterial('#ff9d3d', 1), route: flowMaterial('#e5ebf5', 2) };
    R.flowLines = new Map(); // transportId → {mesh, sig}
    R.flowGroup = new THREE.Group(); R.scene.add(R.flowGroup);
  }

  // ================================================================== Ebene Datenfluss (Pulse)
  const PULSE_N = 70, PULSE_PTS = 4;
  function buildPulses() {
    const n = PULSE_N * PULSE_PTS, pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: srgb('#3cc6f2') }, uScale: { value: 400 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); a *= a; if (vA <= 0.001) discard; gl_FragColor = vec4(uColor * (0.7 + a) + vec3(a * a * 0.5), a * vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; R.scene.add(pts);
    R.pulse = { pts, g, pos, size, alpha, mat, list: [], free: [] };
    for (let i = 0; i < PULSE_N; i++) R.pulse.free.push(i);
    // Ping-Ringe (Meldung erreicht Person / Server)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    R.pings = [];
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(cache('pingg', () => new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-PI / 2)), ringMat.clone()); m.visible = false; m.renderOrder = 4; R.scene.add(m); R.pings.push({ m, t: 1, follow: null }); }
    // Abzweige der Kabeltrasse zu angebundenen Maschinen
    R.branches = {};
    for (const mo of R.moList) {
      if (!mo.connW) continue;
      const b = new Builder(), p = mo.connW, TY = R.TRAY_Y;
      const zT = mo.id === 'M13' ? p.z : 22;
      if (Math.abs(p.z - zT) > 0.1) b.box(M.tray, 0.16, 0.025, Math.abs(p.z - zT), p.x, TY - 0.05, (p.z + zT) / 2);
      b.box(M.cable, 0.035, TY - p.y, 0.035, p.x, p.y, p.z);
      b.box(M.dark, 0.16, 0.12, 0.1, p.x, p.y, p.z);
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
  function spawnPulse(path, o = {}) {
    const P = R.pulse; if (!P.free.length) return;
    const slot = P.free.pop();
    P.list.push({ slot, path, d: 0, speed: o.speed || 22, size: o.size || 0.55, onEnd: o.onEnd || null, a: o.alpha || 1 });
  }
  function arcPath(a, b, h) {
    const pts = [];
    for (let i = 0; i <= 18; i++) { const t = i / 18; const v = new THREE.Vector3().lerpVectors(a, b, t); v.y += Math.sin(t * PI) * h; pts.push(v); }
    return withLen(pts);
  }
  function ping(x, y, z, follow, scale) {
    const p = R.pings.find(q => q.t >= 1) || R.pings[0];
    p.t = 0; p.m.visible = true; p.m.position.set(x, y, z); p.follow = follow || null; p.s = scale || 1;
  }
  function onSimEvent(e) {
    if (!R.ok || !R.visible || !R.layers.data || !e) return;
    let mid = e.entity && e.entity.kind === 'machine' ? e.entity.id : (e.data && e.data.station) || null;
    const mo = mid && R.mo[mid]; if (!mo) return;
    const m = WF.sim.state.machines[mid], lv = m && m.conn ? m.conn.level : 0;
    if (e.type === 'state' && e.data && e.data.minor) return;
    if (lv >= 1 && mo.path) {
      const big = e.sev === 'crit' || e.sev === 'warn' || e.type === 'fault';
      spawnPulse(mo.path, { size: big ? 0.8 : 0.55, speed: 24, onEnd: () => { R.serverHit = 1; } });
    } else if (mo.tablet) mo.tablet.flash = 1;
  }
  const NOTIF_ROLE = { Einrichter: ['setter'], QS: ['qs'], Logistik: ['log'], Instandhaltung: ['maint', 'setter'], Schichtleitung: ['lead'], Einkauf: [] };
  function onNotify(n) {
    if (!R.ok || !R.visible || !R.layers.data || !n || n.status !== 'open' || R.seenNotif.has(n.id)) return;
    R.seenNotif.add(n.id);
    if (R.seenNotif.size > 600) R.seenNotif = new Set([...R.seenNotif].slice(-300));
    const S = WF.sim.state, srv = WF.profile.stationById.OFFICE.server;
    const from = new THREE.Vector3(srv.x, 2.3, srv.z);
    let targets = [];
    for (const rk of NOTIF_ROLE[n.role] || []) {
      targets = Object.values(S.people).filter(p => p.onDuty && p.state !== 'offShift' && p.state !== 'break' && roleOf(p.role) === rk);
      if (targets.length) break;
    }
    if (!targets.length) { const tv = new THREE.Vector3(61.4, 2.0, 7.7); spawnPulse(arcPath(from, tv, 2), { size: 0.5, speed: 10, onEnd: () => ping(61.4, 0.05, 7.9, null, 1.4) }); return; }
    for (const p of targets.slice(0, 2)) {
      const pe = R.people[p.id]; if (!pe) continue;
      const to = new THREE.Vector3(pe.x, 1.9, pe.z);
      spawnPulse(arcPath(from, to, 5 + to.distanceTo(from) * 0.12), { size: n.sev === 'crit' ? 0.75 : 0.6, speed: 26, onEnd: () => ping(pe.x, 0.04, pe.z, pe, 1) });
    }
  }

  // ================================================================== Auswahl, Hover, Auftragsroute
  function buildHighlights() {
    const sc = R.scene;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    R.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    R.hoverBox.visible = false; sc.add(R.hoverBox);
    // Ecken-Klammern (Auswahl)
    const pts = [], L = 0.18;
    for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) {
      pts.push(x, y, z, x - Math.sign(x) * L, y, z, x, y, z, x, y + (y ? -L : L), z, x, y, z, x, y, z - Math.sign(z) * L);
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    R.selBox = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x3cc6f2, transparent: true, depthWrite: false, toneMapped: false }));
    R.selBox.visible = false; sc.add(R.selBox);
    R.selRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0x3cc6f2, transparent: true, depthWrite: false, toneMapped: false }));
    R.selRing.visible = false; R.selRing.renderOrder = 4; sc.add(R.selRing);
    R.route = { group: new THREE.Group(), id: null, steps: [] }; sc.add(R.route.group);
  }
  function boundsOf(sel) {
    if (!sel || !sel.kind) return null;
    if (sel.kind === 'machine' && R.mo[sel.id]) { const f = R.mo[sel.id].st.footprint, mo = R.mo[sel.id]; return { x: mo.cx, z: mo.cz, w: f.w + 0.3, d: f.d + 0.3, h: mo.h + 0.2 }; }
    if (sel.kind === 'store') { const st = WF.profile.stationById[sel.id]; if (st && st.footprint) { const f = st.footprint; return { x: f.x + f.w / 2, z: f.z + f.d / 2, w: f.w, d: f.d, h: 3.4 }; } }
    return null;
  }
  function applySelection(sel) {
    R.sel = sel && sel.kind ? { kind: sel.kind, id: sel.id } : null;
    if (R.follow && (!R.sel || R.sel.id !== R.follow.id)) R.follow = null;
    clearRoute();
    if (R.sel && R.sel.kind === 'order') buildRoute(R.sel.id);
    let target = R.sel;
    if (R.sel && R.sel.kind === 'tool') { const t = WF.sim.state.tools[R.sel.id]; target = t && t.machineId ? { kind: 'machine', id: t.machineId } : null; }
    if (R.sel && R.sel.kind === 'material') target = { kind: 'store', id: 'RAW' };
    if (R.sel && R.sel.kind === 'notification') { const n = (WF.sim.state.notifications || []).find(x => x.id === R.sel.id); target = n && n.entity ? n.entity : null; }
    R.selTarget = target;
    const bnd = boundsOf(target);
    if (bnd) { R.selBox.visible = true; R.selBox.position.set(bnd.x, 0, bnd.z); R.selBox.scale.set(bnd.w, bnd.h, bnd.d); }
    else R.selBox.visible = false;
    R.selRing.visible = !!(target && (target.kind === 'person' || target.kind === 'agv' || target.kind === 'container'));
    for (const id in R.lb) { const l = R.lb[id]; l.el.classList.toggle('sel', !!(target && target.kind === 'machine' && target.id === id)); }
    renderSelBar();
  }
  function clearRoute() {
    const r = R.route; r.id = null; r.steps = [];
    while (r.group.children.length) { const c = r.group.children.pop(); if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); if (c.material && c.material.map) c.material.map.dispose(); if (c.material && c.material.userData.own) c.material.dispose(); }
    for (const id in R.rtLb) R.rtLb[id].el.remove();
    R.rtLb = {};
    for (const id in R.lb) R.lb[id].el.classList.remove('dim');
  }
  const OPC = { done: '#34d399', active: '#3cc6f2', external: '#ff9d3d', waiting: '#fbbf24', open: '#7b8aa8' };
  function stationPt(id) { const st = WF.profile.stationById[id]; return st ? st.dock : null; }
  function buildRoute(orderId) {
    let ov = null; try { ov = WF.sim.orderView(orderId); } catch (e) { ov = null; }
    if (!ov) return;
    const r = R.route, P = WF.profile; r.id = orderId;
    const used = {};
    const chain = [];
    ov.ops.forEach((op, i) => {
      const st = P.stationById[op.station]; if (!st) return;
      const k = used[op.station] = (used[op.station] || 0) + 1;
      const d = st.dock, off = (k - 1) * 1.1;
      chain.push({ op, i, st, x: d.x + (st.dock.z === 22 ? off : 0), z: d.z + (st.dock.z !== 22 ? off : 0) });
    });
    // Linien zwischen den Stationen (EXT: Rückkehr über den Wareneingang)
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      const fromNode = a.st.id === 'EXT' ? P.stationById.WE.dockNode : a.st.dockNode;
      const path = U.path(P.graph, fromNode, b.st.dockNode);
      const pts = path.points.map(p => ({ x: p.x, z: p.z }));
      if (pts.length < 2) continue;
      const m = new THREE.Mesh(ribbon(pts, 0.42, 0.045), R.flowMats.route); m.renderOrder = 2; r.group.add(m);
    }
    if (chain.some(c => c.st.id === 'EXT')) {
      const we = P.stationById.WE.dock;
      const disc = new THREE.Mesh(cache('rdisc', () => { const g = new THREE.CircleGeometry(0.55, 28).rotateX(-PI / 2); g.userData.shared = true; return g; }), new THREE.MeshBasicMaterial({ map: texLabel('WE', { w: 128, h: 128, px: 50, bg: '#ff9d3d', color: '#0b1120' }), transparent: true, depthWrite: false }));
      disc.material.userData.own = true; disc.position.set(we.x, 0.06, we.z); disc.renderOrder = 3; r.group.add(disc);
    }
    chain.forEach((c, n) => {
      const col = OPC[c.op.state] || OPC.open;
      const t = cnv(128, 128), g = t.getContext('2d');
      g.fillStyle = col; g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fill();
      g.fillStyle = '#0b1120'; g.beginPath(); g.arc(64, 64, 46, 0, TAU); g.fill();
      g.fillStyle = col; g.font = FONT(700, 62); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n + 1), 64, 68);
      const disc = new THREE.Mesh(cache('rdisc2', () => { const gg = new THREE.CircleGeometry(0.8, 32).rotateX(-PI / 2); gg.userData.shared = true; return gg; }), new THREE.MeshBasicMaterial({ map: tex(t), transparent: true, depthWrite: false, toneMapped: false }));
      disc.material.userData.own = true; disc.position.set(c.x, 0.07, c.z); disc.renderOrder = 3; r.group.add(disc);
      // HTML-Schritt-Etikett
      const lbEl = el('div', { class: 'h3-lb rt', style: { '--rc': col } });
      lbEl.innerHTML = `<div class="r1"><span class="n">${n + 1}</span><span class="o">AG ${c.op.seq} · ${esc(c.op.op || c.op.stationName || '')}</span></div><div class="s" style="margin:2px 0 0 25px">${esc(c.op.stationName || c.st.short)} · ${esc(c.op.stateLabel || '')}${c.op.target ? ' · ' + fmtN(c.op.good) + '/' + fmtN(c.op.target) : ''}</div>`;
      R.ui.labels.append(lbEl);
      R.rtLb['s' + n] = { el: lbEl, anchor: new THREE.Vector3(c.x, 0.1, c.z), w: 0, h: 0, x: -1, y: -1, shown: false, route: true, measured: false };
    });
    const onRoute = new Set(chain.map(c => c.st.id));
    for (const id in R.lb) R.lb[id].el.classList.toggle('dim', !onRoute.has(id));
    r.steps = chain;
  }

  // ================================================================== Kamera
  const PRESETS = [
    { id: 'uebersicht', label: 'Übersicht', icon: 'grid', t: [31.5, 0, 21], r: 88, phi: 47, th: 20 },
    { id: 'dreherei', label: 'Dreherei / Sonderbearbeitung', icon: 'factory', t: [29, 0, 16], r: 44, phi: 50, th: 12 },
    { id: 'fraeserei', label: 'Fräserei / Schleiferei', icon: 'factory', t: [25, 0, 27.5], r: 40, phi: 52, th: 168 },
    { id: 'logistik', label: 'Logistik & Lager', icon: 'box', t: [24, 0, 7], r: 42, phi: 48, th: 8 },
    { id: 'messraum', label: 'Messraum & Versand', icon: 'target', t: [53, 0, 29], r: 34, phi: 50, th: 36 },
  ];
  const DEG = PI / 180;
  function camState() {
    const c = R.camera.position, t = R.controls.target;
    V1.copy(c).sub(t);
    const r = V1.length(), phi = Math.acos(clamp(V1.y / r, -1, 1)), th = Math.atan2(V1.x, V1.z);
    return { tx: t.x, ty: t.y, tz: t.z, r, phi, th };
  }
  function goCam(dst, dur) {
    const src = camState();
    let th = dst.th; th = src.th + angD(src.th, th);
    R.tween = { t: 0, dur: dur == null ? 1.15 : dur, src, dst: { tx: dst.tx, ty: dst.ty || 0, tz: dst.tz, r: dst.r, phi: dst.phi, th } };
  }
  function setCam(s) {
    const sp = Math.sin(s.phi);
    R.controls.target.set(s.tx, s.ty, s.tz);
    R.camera.position.set(s.tx + s.r * sp * Math.sin(s.th), s.ty + s.r * Math.cos(s.phi), s.tz + s.r * sp * Math.cos(s.th));
    R.camera.lookAt(R.controls.target);
  }
  function preset(id, instant) {
    const p = PRESETS.find(x => x.id === id) || PRESETS[0];
    R.preset = p.id; R.follow = null;
    const dst = { tx: p.t[0], ty: p.t[1], tz: p.t[2], r: p.r * (R.mobile ? 1.35 : 1), phi: p.phi * DEG, th: p.th * DEG };
    if (instant) { setCam(dst); R.controls.update(); } else goCam(dst);
    markPresets(); renderSelBar();
  }
  function markPresets() { if (R.ui.pre) R.ui.pre.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === R.preset)); }
  function focusStation(id) {
    if (!R.ok) { R.pending = { fn: 'station', id }; return; }
    const st = WF.profile.stationById[id]; if (!st || !st.footprint) return;
    const f = st.footprint, sz = Math.max(f.w, f.d);
    const th = st.facing === 'N' ? 168 : st.facing === 'W' ? -78 : st.facing === 'E' ? 78 : 14;
    R.preset = null; markPresets(); R.follow = null;
    goCam({ tx: f.x + f.w / 2, ty: 0, tz: f.z + f.d / 2, r: clamp(sz * 2.4 + 12, 18, 42) * (R.mobile ? 1.3 : 1), phi: 52 * DEG, th: th * DEG });
    R.flash = { id, t: 0 };
  }
  function focusOrder(id) {
    if (!R.ok) { R.pending = { fn: 'order', id }; return; }
    applySelection({ kind: 'order', id });
    const steps = R.route.steps; if (!steps.length) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const s of steps) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const span = Math.max(x1 - x0, (z1 - z0) * 1.5, 12);
    R.preset = null; markPresets();
    goCam({ tx: (x0 + x1) / 2, ty: 0, tz: (z0 + z1) / 2 + 1, r: clamp(span * 1.25 + 14, 26, 95) * (R.mobile ? 1.3 : 1), phi: 48 * DEG, th: 14 * DEG });
  }
  function clampTarget() {
    const t = R.controls.target, P = WF.profile.hall;
    const cx = clamp(t.x, -2, P.w + 2), cz = clamp(t.z, -2, P.d + 2), cy = clamp(t.y, 0, 3);
    if (cx !== t.x || cz !== t.z || cy !== t.y) { const dx = cx - t.x, dy = cy - t.y, dz = cz - t.z; t.set(cx, cy, cz); R.camera.position.x += dx; R.camera.position.y += dy; R.camera.position.z += dz; }
  }

  // ================================================================== Overlays (DOM)
  function buildOverlays(root) {
    const ui = R.ui;
    ui.labels = el('div', { class: 'h3-labels' });
    ui.tip = el('div', { class: 'h3-tip h3-glass', role: 'tooltip' });
    ui.status = el('div', { class: 'h3-ov h3-status h3-glass', 'aria-live': 'polite' });
    ui.status.innerHTML = `<div class="h3-st-h"><span class="h3-live"><i></i>Halle 3D · Live</span><span class="h3-clock" data-k="clock">–</span></div>
      <div class="h3-shift" data-k="shift">–</div>
      <div class="h3-mline" data-k="mline"></div>
      <div class="h3-kv">
        <div><span class="l">In Produktion</span><b data-k="run">–</b><span class="s" data-k="runS">–</span></div>
        <div><span class="l">Personen im Dienst</span><b data-k="ppl">–</b><span class="s" data-k="pplS">–</span></div>
        <div><span class="l">Offene Transporte</span><b data-k="tr">–</b><span class="s" data-k="trS">–</span></div>
      </div>
      <div class="h3-strip" data-k="strip"></div>`;
    ui.st = {}; ui.status.querySelectorAll('[data-k]').forEach(n => ui.st[n.dataset.k] = n);
    ui.strip = {};
    for (const id of WF.profile.machines) {
      const st = WF.profile.stationById[id];
      const b = el('button', { title: `${id} · ${st.short}`, 'aria-label': `${id} ${st.short}`, text: id === 'QS' ? 'QS' : id.replace('M', '') });
      b.onclick = () => { focusStation(id); WF.app.select('machine', id); };
      ui.st.strip.append(b); ui.strip[id] = b;
    }
    ui.ctl = el('div', { class: 'h3-ov h3-ctl h3-glass' });
    ui.ctl.innerHTML = `<div class="h3-sec">Kamera</div><div class="h3-pre">${PRESETS.map(p => `<button data-p="${p.id}" title="${esc(p.label)}">${icon(p.icon, 15)}<span>${esc(p.label)}</span></button>`).join('')}</div>
      <div class="h3-sec">Ebenen</div><div class="h3-lay">
        <button class="h3-chip" data-l="flow" style="--c:var(--mat)"><i></i>Materialfluss</button>
        <button class="h3-chip" data-l="data" style="--c:var(--info)"><i></i>Datenfluss</button>
        <button class="h3-chip" data-l="people" style="--c:var(--text2)"><i></i>Personen</button>
        <button class="h3-chip" data-l="labels" style="--c:var(--text2)"><i></i>Beschriftungen</button></div>`;
    ui.pre = ui.ctl.querySelector('.h3-pre');
    ui.pre.querySelectorAll('button').forEach(b => b.onclick = () => { preset(b.dataset.p); closeSheets(); });
    ui.ctl.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { R.layers[b.dataset.l] = !R.layers[b.dataset.l]; applyLayers(); });
    ui.legend = el('div', { class: 'h3-ov h3-legend h3-glass' });
    const sw = (c, t, cls) => `<div class="h3-lg"><i class="${cls || ''}" style="--c:${c}"></i>${esc(t)}</div>`;
    ui.legend.innerHTML = `<div class="h3-sec">Legende</div>
      <div class="h3-lgc">${sw('var(--st-run)', 'Produktion')}${sw('var(--st-setup)', 'Rüsten / Erstteilprüfung')}${sw('var(--st-tool)', 'Werkzeugwechsel')}${sw('var(--st-wait)', 'Wartet / Ausgang voll')}${sw('var(--st-fault)', 'Störung')}${sw('var(--st-idle)', 'Bereit (kein Auftrag)')}</div>
      <div class="h3-lgc">${sw('var(--mat)', 'Transport (beladen)', 'ln')}${sw('var(--mat)', 'Wartet auf Abholung', 'rg')}${sw('var(--info)', 'Maschinendaten → Server', 'pt')}${sw('var(--info)', 'Meldung an Person', 'rg')}
        <div class="h3-lg" style="margin-top:2px">${Object.values(ROLES).map(r => `<i class="vest" title="${esc(r.label)}" style="--c:${r.vest}"></i>`).join('')}<span class="muted" style="margin-left:2px">Warnweste = Rolle</span></div></div>`;
    ui.legend.querySelector('.h3-lg:last-child').title = Object.values(ROLES).map(r => r.label).join(' · ');
    ui.sel = el('div', { class: 'h3-ov h3-sel h3-glass', hidden: true });
    ui.hint = el('div', { class: 'h3-ov h3-hint', text: 'Ziehen: drehen · Rechte Maustaste: verschieben · Mausrad: zoomen · Klick: Details' });
    ui.mbar = el('div', { class: 'h3-ov h3-mbar h3-glass' });
    ui.mbar.innerHTML = `<button data-s="ctl">${icon('camera', 15)}Ansicht</button><button data-s="legend">${icon('layers', 15)}Legende</button><button data-s="reset">${icon('grid', 15)}Übersicht</button>`;
    ui.mbar.querySelectorAll('button').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      if (s === 'reset') { preset('uebersicht'); closeSheets(); return; }
      const tgt = s === 'ctl' ? ui.ctl : ui.legend, open = !tgt.classList.contains('open');
      closeSheets(); tgt.classList.toggle('open', open); b.classList.toggle('on', open);
    });
    root.append(ui.labels, ui.status, ui.ctl, ui.legend, ui.sel, ui.hint, ui.mbar, ui.tip);
    applyLayers(); markPresets();
  }
  function closeSheets() { const ui = R.ui; ui.ctl.classList.remove('open'); ui.legend.classList.remove('open'); ui.mbar.querySelectorAll('button').forEach(b => b.classList.remove('on')); }
  function applyLayers() {
    const L = R.layers;
    R.ui.ctl.querySelectorAll('[data-l]').forEach(b => b.classList.toggle('on', !!L[b.dataset.l]));
    if (R.flowGroup) R.flowGroup.visible = L.flow;
    if (R.C) R.C.wait.visible = L.flow;
    if (R.pulse) R.pulse.pts.visible = L.data;
    if (R.trayGlow) R.trayGlow.forEach(m => m.visible = L.data);
    R.ui.labels.style.display = L.labels ? '' : 'none';
    computeUiRects();
  }
  function computeUiRects() {
    if (!R.root) return;
    const rr = R.root.getBoundingClientRect(), out = [];
    for (const n of [R.ui.status, R.ui.ctl, R.ui.legend, R.ui.sel, R.ui.mbar]) {
      if (!n || n.hidden) continue;
      const b = n.getBoundingClientRect(); if (!b.width || !b.height) continue;
      out.push([b.left - rr.left - 6, b.top - rr.top - 6, b.right - rr.left + 6, b.bottom - rr.top + 6]);
    }
    R.uiRects = out;
  }
  function renderSelBar() {
    const ui = R.ui; if (!ui.sel) return;
    const s = R.selTarget || R.sel;
    if (!s || (s.kind !== 'person' && s.kind !== 'agv')) { if (!ui.sel.hidden) { ui.sel.hidden = true; computeUiRects(); } return; }
    const name = WF.app.entityLabel({ kind: s.kind, id: s.id });
    const on = !!(R.follow && R.follow.id === s.id);
    ui.sel.innerHTML = `<span class="k">${s.kind === 'agv' ? 'AGV' : 'Person'}</span><span class="nm">${esc(name)}</span><button class="btn sm ${on ? 'on' : ''}" data-f>${icon('eye', 14)}${on ? 'Folgt' : 'Folgen'}</button>`;
    ui.sel.querySelector('[data-f]').onclick = () => { R.follow = on ? null : { kind: s.kind, id: s.id }; if (R.follow) { R.preset = null; markPresets(); R.tween = null; } renderSelBar(); };
    if (ui.sel.hidden) { ui.sel.hidden = false; }
    computeUiRects();
  }

  // ================================================================== Etiketten (HTML) je Maschine
  function buildLabels() {
    R.lb = {}; R.rtLb = {};
    for (const mo of R.moList) {
      const e = el('div', { class: 'h3-lb', 'data-l': '1' });
      e.addEventListener('click', (ev) => { ev.stopPropagation(); WF.app.select('machine', mo.id); });
      e.addEventListener('mouseenter', () => { R.lbHover = mo.id; setHover({ kind: 'machine', id: mo.id }, true); });
      e.addEventListener('mouseleave', () => { if (R.lbHover === mo.id) { R.lbHover = null; setHover(null); } });
      R.ui.labels.append(e);
      R.lb[mo.id] = { el: e, mo, anchor: mo.anchor, sig: '', level: -1, sizes: {}, x: -1, y: -1, shown: false, pri: 0 };
    }
  }
  function critTool(v) {
    const tl = (v.tools || []).filter(t => t.status !== 'idle' && t.remainingParts != null);
    if (!tl.length) return null;
    const pri = { broken: 0, changing: 1, due: 2, planned: 3, ok: 4 };
    tl.sort((a, b) => (pri[a.status] ?? 5) - (pri[b.status] ?? 5) || a.remainingParts - b.remainingParts);
    return tl[0];
  }
  const shortTool = (n) => String(n || '').replace(/\s*\(.*\)\s*/, '').replace('Schleifscheibe Korund', 'Schleifscheibe').slice(0, 30);
  function toolLine(t) {
    if (!t) return '';
    if (t.status === 'changing') return `<span class="t">Wechsel läuft</span> · ${esc(shortTool(t.name))}`;
    if (t.status === 'broken') return `<span class="t">Werkzeugbruch</span> · ${esc(shortTool(t.name))}`;
    if (t.status === 'due') return `<span class="t">Standzeit erschöpft</span> · ${esc(shortTool(t.name))}`;
    const rest = t.remainingParts != null ? `noch ${fmtN(t.remainingParts)} Teile` : '';
    if (t.status === 'planned' && t.plannedChange) return `<span class="t">${esc(shortTool(t.name))}</span> · ${rest} · Wechsel ${esc(t.plannedChange.text || '')}`;
    return `${esc(shortTool(t.name))} · ${rest}`;
  }
  function updateLabel(l, v) {
    const ord = v.order, ct = ord ? `${v.partNo != null ? v.partNo : v.partsDone}/${v.partsTotal}` : '';
    const t = critTool(v), wz = t && (t.status === 'planned' || t.status === 'due' || t.status === 'changing' || t.status === 'broken');
    const pct = ord && v.partsTotal ? Math.round((v.partsDone / v.partsTotal) * 100) : 0;
    const sig = [v.state, ct, ord ? ord.id : '', wz ? 1 : 0, toolLine(t), pct, v.phase, v.partSub].join('|');
    if (sig === l.sig) return;
    l.sig = sig; l.sizes = {};
    const sub = ord ? `${esc(ord.id)} · AG ${ord.seq}` : esc(v.cause || '').slice(0, 44);
    l.el.style.setProperty('--c', v.stateColor || 'var(--st-idle)');
    l.el.classList.toggle('flt', v.state === 'fault');
    l.el.innerHTML = `<div class="r1"><i class="d"></i><b>${esc(v.id)}</b><span class="nm">${esc(v.short)}</span>${ct ? `<span class="ct">${ct}</span>` : ''}${wz ? `<span class="wz" title="Werkzeugwechsel">${icon('wrench', 12)}</span>` : ''}</div>
      <div class="r2"><span class="st">${esc(v.stateLabel || '')}</span><span>${sub}</span></div>
      ${ord ? `<div class="r3">${WF.ui.bar(v.partsTotal ? v.partsDone / v.partsTotal : 0, { thin: true, color: v.stateColor })}<span class="mono">${pct} %</span></div>` : ''}
      ${t ? `<div class="r4">${toolLine(t)}</div>` : ''}`;
  }
  function priOf(id, v) {
    if (R.selTarget && R.selTarget.kind === 'machine' && R.selTarget.id === id) return 100;
    if (R.hover && R.hover.kind === 'machine' && R.hover.id === id) return 90;
    const st = v ? v.state : 'idle', g = (WF.STATE[st] || {}).group;
    return g === 'fault' ? 60 : g === 'wait' ? 40 : g === 'setup' ? 30 : g === 'prod' ? 20 : 10;
  }
  const _rects = [];
  function placeLabels() {
    if (!R.layers.labels) return;
    const cam = R.camera, W = R.w, H = R.h;
    _rects.length = 0; for (const r of R.uiRects) _rects.push(r);
    const all = [];
    for (const id in R.rtLb) all.push(R.rtLb[id]);
    for (const id in R.lb) all.push(R.lb[id]);
    for (const l of all) {
      V2.copy(l.anchor).project(cam);
      l.vis = V2.z < 1 && V2.z > -1;
      l.sx = (V2.x + 1) / 2 * W; l.sy = (1 - V2.y) / 2 * H;
      l.dist = cam.position.distanceTo(l.anchor);
      l.p = l.route ? 200 : l.pri;
    }
    all.sort((a, b) => b.p - a.p || a.dist - b.dist);
    const fov = Math.tan(cam.fov * DEG / 2) * 2, pxPerM = H / fov;
    for (const l of all) {
      let ok = l.vis;
      if (!l.route) {
        const ppm = pxPerM / l.dist;
        let lv = ppm > 26 ? 2 : ppm > 13 ? 1 : 0;
        if (R.mobile) lv = Math.min(lv, 1);
        if (l.p >= 90) lv = Math.max(lv, 1);
        if (lv !== l.level) { l.level = lv; l.el.dataset.l = String(lv); }
      }
      let sz = l.route ? (l.measured ? l : null) : l.sizes[l.level];
      if (ok && !sz) {
        const w = l.el.offsetWidth, h = l.el.offsetHeight;
        if (l.route) { l.w = w; l.h = h; l.measured = true; sz = l; } else sz = l.sizes[l.level] = { w, h };
      }
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      if (ok) {
        const w = sz.w, h = sz.h;
        if (l.route) { x0 = l.sx - 12; y0 = l.sy + 10; } else { x0 = l.sx - w / 2; y0 = l.sy - h - 9; }
        x1 = x0 + w; y1 = y0 + h;
        if (x0 < 2 || y0 < 2 || x1 > W - 2 || y1 > H - 2) ok = false;
      }
      if (ok) for (const r of _rects) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { ok = false; break; }
      if (ok) {
        _rects.push([x0 - 3, y0 - 3, x1 + 3, y1 + 3]);
        const rx = Math.round(x0), ryy = Math.round(y0);
        if (rx !== l.x || ryy !== l.y) { l.x = rx; l.y = ryy; l.el.style.transform = `translate3d(${rx}px,${ryy}px,0)`; }
      }
      if (ok !== l.shown) { l.shown = ok; l.el.classList.toggle('off', !ok); }
    }
  }

  // ================================================================== Tooltip
  function setHover(h, fromLabel) {
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
    if (same(h, R.hover)) return;
    R.hover = h;
    R.root.classList.toggle('hov', !!h);
    if (h && h.kind === 'machine') { const bnd = boundsOf(h); R.hoverBox.visible = true; R.hoverBox.position.set(bnd.x, 0, bnd.z); R.hoverBox.scale.set(bnd.w, bnd.h, bnd.d); }
    else R.hoverBox.visible = false;
    if (fromLabel && h) { const l = R.lb[h.id]; if (l) { const r = l.el.getBoundingClientRect(), rr = R.root.getBoundingClientRect(); R.mouse.x = r.right - rr.left; R.mouse.y = r.bottom - rr.top; } }
    renderTip(true);
  }
  function renderTip(force) {
    const tip = R.ui.tip, h = R.hover;
    if (!h || R.mobile || R.down) { tip.classList.remove('on'); return; }
    const html = tipHtml(h);
    if (!html) { tip.classList.remove('on'); return; }
    if (force || html !== R.tipHtml) { tip.innerHTML = html; R.tipHtml = html; }
    tip.classList.add('on');
    positionTip();
  }
  function positionTip() {
    const tip = R.ui.tip; if (!tip.classList.contains('on')) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = R.mouse.x + 16, y = R.mouse.y + 16;
    if (x + w > R.w - 10) x = R.mouse.x - w - 16;
    if (y + h > R.h - 10) y = Math.max(10, R.h - h - 10);
    tip.style.transform = `translate3d(${Math.round(Math.max(10, x))}px,${Math.round(y)}px,0)`;
  }
  function tipHtml(h) {
    const S = WF.sim.state, F = U;
    if (h.kind === 'machine') {
      const mo = R.mo[h.id]; const v = mo && mo.v; if (!v) return '';
      const t = critTool(v), ord = v.order;
      const rows = [];
      if (ord) rows.push(['Auftrag', `${esc(ord.id)} · ${esc(ord.partName)}<br><span class="muted">${esc(ord.customer)} · AG ${ord.seq} ${esc(ord.op)}</span>`]);
      if (ord) rows.push(['Teil', `<div class="pg">${WF.ui.bar(v.partsTotal ? v.partsDone / v.partsTotal : 0, { color: v.stateColor })}<span class="mono">${v.partNo != null ? v.partNo : v.partsDone}/${v.partsTotal}</span></div>`]);
      if (v.partRemainSec != null && v.state === 'running') rows.push(['Laufendes Teil', `noch ${F.fmtDur(v.partRemainSec)}${v.partSub === 'load' ? ' (wird eingelegt)' : ''}`]);
      if (v.etaOpEnd) rows.push(['Arbeitsgang fertig', 'ca. ' + F.fmtDue(v.etaOpEnd, S.t)]);
      if (t) rows.push(['Werkzeug', `${esc(shortTool(t.name))} · ${t.remainingParts != null ? 'noch ' + fmtN(t.remainingParts) + ' Teile' : ''}${t.plannedChange ? `<br><span class="tw">Wechsel ${esc(t.plannedChange.text || '')}${t.plannedChange.by ? ' · ' + esc(t.plannedChange.by) : ''}</span>` : ''}`]);
      if (v.operator) rows.push([v.operator.responsible ? 'Zuständig' : 'An der Maschine', `${esc(v.operator.name)} <span class="muted">· ${esc(v.operator.activity || v.operator.stateLabel || '')}</span>`]);
      rows.push(['Anbindung', `<span class="conn" data-l="${v.conn.level}">L${v.conn.level}</span> <span class="muted">${esc(v.conn.protocol || '')}</span>`]);
      return `<div class="h"><div class="t">${esc(v.id)} · ${esc(v.short)}<small>${esc(v.name)}</small></div>${WF.ui.pill(v.state)}</div>
        <div class="cz" style="--c:${v.stateColor}">${esc(v.cause || '')} <span class="muted">· seit ${F.fmtDur(v.sinceSec)}</span></div>
        <dl class="dl">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl><div class="ft">Klicken für Details</div>`;
    }
    if (h.kind === 'person') {
      const p = S.people[h.id]; if (!p) return '';
      const lab = WF.sim.LABELS.person[p.state] || p.state;
      return `<div class="h"><div class="t">${esc(p.name)}<small>${esc(p.role)} · ${p.shift === 'F' ? 'Frühschicht' : 'Spätschicht'}</small></div><span class="pill" style="--c:${ROLES[roleOf(p.role)].vest}"><i></i>${esc(lab)}</span></div>
        <div class="cz">${esc(p.activity || '')}</div>
        <dl class="dl"><dt>Auslastung heute</dt><dd>${F.fmtPct(p.utilToday)}</dd><dt>Aufgaben heute</dt><dd>${fmtN(p.tasksToday || 0)}</dd></dl><div class="ft">Klicken für Details</div>`;
    }
    if (h.kind === 'agv') {
      const a = S.agvs[h.id]; if (!a) return '';
      const tr = a.task ? S.transports[a.task] : null;
      return `<div class="h"><div class="t">${esc(a.name)}<small>Fahrerloses Transportfahrzeug · max. ${fmtN(a.maxKg)} kg</small></div><span class="pill" style="--c:var(--info)"><i></i>${esc(WF.sim.LABELS.agv[a.state] || a.state)}</span></div>
        <div class="cz">${tr ? esc(tr.label) : a.state === 'charging' ? 'Lädt an der Ladestation' : 'Wartet auf den nächsten Transportauftrag'}</div>
        <dl class="dl"><dt>Akku</dt><dd><div class="pg">${WF.ui.bar(a.battery / 100, { color: a.battery < 25 ? 'var(--st-wait)' : 'var(--st-run)' })}<span class="mono">${fmtN(a.battery)} %</span></div></dd><dt>Transporte heute</dt><dd>${fmtN(a.transportsToday || 0)}</dd></dl><div class="ft">Klicken für Details</div>`;
    }
    if (h.kind === 'forklift') {
      const f = S.forklift, p = f.driver ? S.people[f.driver] : null;
      return `<div class="h"><div class="t">${esc(f.name)}<small>${p ? 'Fahrer: ' + esc(p.name) : 'abgestellt'}</small></div><span class="pill" style="--c:var(--mat)"><i></i>${esc(WF.sim.LABELS.forklift[f.state] || f.state)}</span></div>
        ${p ? `<div class="cz">${esc(p.activity || '')}</div><div class="ft">Klicken: Fahrer anzeigen</div>` : ''}`;
    }
    if (h.kind === 'container') {
      let cv = null; try { cv = WF.sim.containerView(h.id); } catch (e) { cv = null; }
      if (!cv) return '';
      const o = S.orders[cv.orderId];
      return `<div class="h"><div class="t">Behälter ${esc(cv.id)}<small>${esc(cv.partName)} · ${fmtN(cv.qty)} Stk · ${U.fmtKg(cv.weightKg)}</small></div><span class="pill" style="--c:var(--mat)"><i></i>${esc(cv.stateLabel)}</span></div>
        <div class="cz">${esc(cv.where)}</div>
        <dl class="dl"><dt>Auftrag</dt><dd>${esc(cv.orderId)}${o ? ' · ' + esc(o.customer) : ''}</dd>${cv.seq != null ? `<dt>Nächster Schritt</dt><dd>AG ${cv.seq}</dd>` : ''}</dl><div class="ft">Klicken für Details</div>`;
    }
    return '';
  }

  // ================================================================== Pointer / Raycast
  function bindPointer() {
    const cv = R.canvas;
    cv.addEventListener('pointermove', (e) => {
      const r = R.root.getBoundingClientRect(); R.mouse.x = e.clientX - r.left; R.mouse.y = e.clientY - r.top; R.mouse.in = true;
      if (e.pointerType === 'mouse') { R.hoverDirty = true; positionTip(); }
    });
    cv.addEventListener('pointerleave', () => { R.mouse.in = false; if (!R.lbHover) setHover(null); });
    cv.addEventListener('pointerdown', (e) => { R.down = { x: e.clientX, y: e.clientY, t: performance.now() }; R.ui.tip.classList.remove('on'); hideHint(); if (R.mobile) closeSheets(); });
    cv.addEventListener('pointerup', (e) => {
      const d = R.down; R.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const r = R.root.getBoundingClientRect();
      const hit = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        if (hit.kind === 'forklift') { const f = WF.sim.state.forklift; if (f.driver) WF.app.select('person', f.driver); return; }
        WF.app.select(hit.kind, hit.id);
      } else if (WF.app.selected) WF.app.closeDrawer();
    });
    cv.addEventListener('wheel', hideHint, { passive: true });
    R.controls.addEventListener('start', () => { R.tween = null; if (R.preset) { R.preset = null; markPresets(); } });
  }
  function hideHint() { if (R.ui.hint && !R.ui.hint.classList.contains('gone')) R.ui.hint.classList.add('gone'); }
  const _hits = [];
  function pickAt(x, y) {
    NDC.set(x / R.w * 2 - 1, -(y / R.h) * 2 + 1);
    RAY.setFromCamera(NDC, R.camera);
    _hits.length = 0;
    RAY.intersectObjects(R.pickActive || R.pick, true, _hits);
    for (const h of _hits) {
      let o = h.object, ud = o.userData;
      while (o && !(ud && ud.kind)) { o = o.parent; ud = o && o.userData; }
      if (!ud) continue;
      if (ud.kind === 'container') { const id = R.C.byInst[ud.inst][h.instanceId]; if (id) return { kind: 'container', id }; continue; }
      if (ud.kind === 'person' && !R.layers.people) continue;
      return { kind: ud.kind, id: ud.id };
    }
    return null;
  }

  // ================================================================== Aktualisierung 4×/s (Daten → Darstellung)
  function update() {
    if (!R.ok) return;
    const sim = WF.sim, S = sim.state; if (!S || !S.machines) return;
    // Statuspanel
    const ui = R.ui.st, sh = sim.shift();
    let run = 0, flt = 0, wait = 0;
    for (const id of WF.profile.machines) { const st = S.machines[id] ? S.machines[id].state : 'idle'; if (st === 'running') run++; else if (st === 'fault') flt++; else if ((WF.STATE[st] || {}).group === 'wait') wait++; }
    let duty = 0, brk = 0, walk = 0;
    for (const id in S.people) { const p = S.people[id]; if (p.state === 'offShift') continue; duty++; if (p.state === 'break') brk++; else if (p.state === 'walking' || p.state === 'driving') walk++; }
    let trOpen = 0, trAgv = 0, trFork = 0, trWait = 0;
    for (const id in S.transports) { const t = S.transports[id]; if (t.status === 'done' || t.cancelled) continue; trOpen++; if (t.status === 'open') trWait++; else if (t.mode === 'AGV') trAgv++; else trFork++; }
    const set = (k, v, html) => { const n = ui[k]; if (!n) return; if (html) { if (n._v !== v) { n.innerHTML = v; n._v = v; } } else if (n.textContent !== v) n.textContent = v; };
    set('clock', sim.clock());
    set('shift', sh ? (sh.id ? `${sh.name}${sh.inBreak ? ' · Pause' : ''} · bis ${U.fmtClock(sh.inBreak && sh.breakEndsAt ? sh.breakEndsAt : sh.endsAt)}` : `${sh.name} · nächster Schichtbeginn ${U.fmtDayClock(sh.endsAt)}`) : '–');
    ui.shift.classList.toggle('br', !!(sh && sh.inBreak));
    set('run', `${run}<small>/${WF.profile.machines.length}</small>`, true);
    set('runS', flt ? `${flt} Störung${flt > 1 ? 'en' : ''}${wait ? ' · ' + wait + ' wartend' : ''}` : wait ? `${wait} wartend` : 'keine Störung');
    set('ppl', String(duty));
    set('pplS', duty ? (brk ? `${brk} in Pause` : `${walk} unterwegs`) : 'niemand im Dienst');
    set('tr', String(trOpen));
    set('trS', trOpen ? [trAgv ? trAgv + ' AGV' : '', trFork ? trFork + ' Stapler' : '', trWait ? trWait + ' wartend' : ''].filter(Boolean).join(' · ') : 'alles zugestellt');
    set('mline', `<span><b>${run}/${WF.profile.machines.length}</b> in Produktion</span><span><b>${duty}</b> Personen</span><span><b>${trOpen}</b> Transporte</span>`, true);
    // Maschinen
    for (const mo of R.moList) {
      let v = null; try { v = sim.machineView(mo.id); } catch (e) { v = null; }
      if (!v) continue;
      mo.v = v;
      const b = R.ui.strip[mo.id];
      if (b && b._st !== v.state) { b._st = v.state; b.style.setProperty('--c', v.stateColor); b.classList.toggle('fl', v.state === 'fault'); }
      if (b) { const tt = `${mo.id} · ${v.short} – ${v.stateLabel}: ${v.cause}`; if (b.title !== tt) b.title = tt; }
      if (mo.state !== v.state) applyMachineState(mo, v.state);
      const l = R.lb[mo.id]; if (l) { updateLabel(l, v); l.pri = priOf(mo.id, v); }
      // Verbindung (Level kann sich zur Laufzeit ändern)
      const lv = v.conn.level;
      if (R.branches[mo.id]) R.branches[mo.id].visible = lv >= 1;
      if (mo.tablet) mo.tablet.g.visible = lv === 0;
      updateMachineDyn(mo, v, S);
    }
    updateRaw(S);
    updateContainers(S);
    updateFlows(S);
    if (R.hover) renderTip(false);
    // Hallen-TV alle ~5 s
    R.tvAcc = (R.tvAcc || 0) + 1;
    if (R.tvTex && R.tvAcc % 20 === 1) drawTV(R.tvTex);
    // Fenster: Tageslicht je Uhrzeit
    const hr = (S.t % 86400) / 3600, day = hr > 6.3 && hr < 19.2 ? 1 : hr > 5.8 && hr < 19.8 ? 0.5 : 0.08;
    M.winGlass.emissiveIntensity = 0.5 * day;
    // Aktive Pick-Liste
    const act = [];
    for (const mo of R.moList) act.push(mo.proxy);
    for (const id in R.agvs) act.push(R.agvs[id].proxy);
    act.push(R.fork.proxy);
    if (R.layers.people) for (const id in R.people) if (R.people[id].vis) act.push(R.people[id].proxy);
    act.push(R.C.klt, R.C.gb, R.C.rack, R.C.wrap);
    R.pickActive = act;
    if (R.route.id && (R.routeAcc = (R.routeAcc || 0) + 1) % 8 === 0) refreshRoute();
  }
  function refreshRoute() {
    let ov = null; try { ov = WF.sim.orderView(R.route.id); } catch (e) { ov = null; }
    if (!ov) return;
    const sig = ov.ops.map(o => o.state + o.good).join(',');
    if (sig !== R.route.sig) { const id = R.route.id; const had = R.route.sig; R.route.sig = sig; if (had) { clearRoute(); buildRoute(id); R.route.sig = sig; } }
  }
  function applyMachineState(mo, st) {
    mo.state = st;
    const T = mo.tower, hex = WF.STATE_HEX[st] || '#7b8aa8';
    const idx = st === 'fault' ? 2 : st === 'running' ? 0 : st === 'idle' ? -1 : 1;
    T.mats.forEach((m, i) => {
      if (i === idx) { m.color.set(hex); m.emissive.set(hex); m.emissiveIntensity = 2.4; }
      else { m.color.setHex(T.base[i]); m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
    });
    T.lit = idx;
    if (idx >= 0) { T.halo.position.set(0, 0.24 + idx * 0.085 + 0.04, 0); T.halo.material.color.set(hex); T.halo.material.opacity = 0.85; T.halo.visible = true; }
    else T.halo.visible = false;
    srgb(hex, mo.glow.mat.uniforms.uColor.value);
    mo.glowBase = st === 'idle' ? 0.35 : st === 'fault' ? 1.0 : 0.85;
    const lightOn = st === 'running' || st === 'setup' || st === 'toolchange' || st === 'firstPiece';
    mo.innerTarget = st === 'running' ? 0.9 : lightOn ? 0.55 : st === 'fault' ? 0.3 : 0.12;
  }
  /** Daten, die das Modell beeinflussen: Stangen am Sägeautomat / Stangenlader, Werkstücklänge, Montage-Fortschritt */
  function updateMachineDyn(mo, v, S) {
    const m = S.machines[mo.id], a = mo.a; if (!a) return;
    const ord = m.op ? S.orders[m.op.oid] : null, r = ord ? ord.routing[m.op.idx] : null;
    const key = (ord ? ord.id + r.seq : '-');
    if (mo.type === 'saw') {
      const mat = r && r.material ? S.materials[r.material.id] : null;
      const dm = dimsOf(mat ? mat.name : '') || { d: 0.06 };
      const rad = Math.max(0.02, (dm.d || 0.06) / 2), show = !!mat && (m.state !== 'idle');
      a.bar.visible = show;
      if (show) { a.bar.scale.set(rad, 2.9, dm.flat ? rad : rad); a.bar.position.set(-1.45 + 0.55 - 0.05, a.top + rad, a.zc); }
      a.mag.forEach((g, i) => { g.visible = show; g.scale.set(rad, 2.8, rad); g.position.set(-1.9, 0.86 + rad + i * 0.0 - 0.06 * i, a.zc - 0.6 - i * (rad * 2 + 0.02)); });
      a.cutH = rad * 2 + 0.06;
    } else if (mo.type === 'swiss') {
      const n = Math.min(3, Math.ceil((m.barStockM || 0) / 3 - 1e-6));
      a.bars.forEach((g, i) => { g.visible = i < n; g.scale.set(0.016, 3.3, 0.016); g.position.set(-1.3, 1.27, -0.05 - i * 0.05); });
    } else if (mo.type === 'biglathe' || mo.type === 'deephole') {
      if (a.key !== key) {
        a.key = key;
        const dm = ord ? dimsOf(ord.part.name) : null;
        const rad = clamp(dm && dm.d ? dm.d / 2 * 1.15 : 0.07, 0.04, 0.16), len = clamp(dm && dm.l ? dm.l : 1.6, 0.25, mo.type === 'biglathe' ? 4.5 : 2.4);
        a.wr = rad; a.wl = len;
        if (mo.type === 'biglathe') {
          a.work.scale.set(rad, len, rad); a.work.position.set(0.3 + len / 2, 0, 0);
          const tx = -2.5 + 0.3 + len; a.tail.position.x = tx + 0.45; a.rest.position.x = -2.5 + 0.3 + len * 0.55; a.x0 = -2.5 + 0.35; a.x1 = tx - 0.1;
        } else {
          a.work.scale.set(rad, len, rad); a.work.position.set(0.2 + len / 2, 0, 0);
          a.oilX = -4.27 + 0.2 + len + 0.3; a.oil.position.x = a.oilX;
        }
      }
      a.work.visible = !!ord && m.state !== 'idle';
    } else if (mo.type === 'assembly') {
      const prog = mo.prog || 0, run = m.state === 'running', active = run ? 1 : -1;
      const outN = (S.stations[mo.id] ? S.stations[mo.id].out.length : 0);
      a.mods.forEach((md, i) => {
        const isActive = i === active, done = i === 2 && outN > 0;
        md.g.visible = isActive || done || (i === 0 && !!ord);
        const p = isActive ? prog : (done ? 1 : 0.15);
        md.motor.visible = p > 0.35; md.gear.visible = p > 0.6; md.cover.visible = p > 0.88;
      });
    }
  }
  function updateRaw(S) {
    const sig = Object.keys(R.rawSlots).map(id => S.materials[id] ? S.materials[id].onHand : 0).join(',') + '|' + ['MAT-ALBL', 'MAT-GUSSLD'].map(id => S.materials[id] ? S.materials[id].onHand : 0).join(',');
    if (sig === R.rawSig) return;
    R.rawSig = sig;
    let nb = 0, nf = 0;
    for (const id in R.rawSlots) {
      const mt = S.materials[id]; if (!mt) continue;
      const [lv, slot] = R.rawSlots[id], dm = dimsOf(mt.name) || { d: 0.04 };
      const count = clamp(Math.ceil(mt.onHand / 6 - 1e-6), 0, 18);
      const y0 = R.rawLevels[lv] + 0.1, zA = 1.08 + slot * 0.58, zLen = 0.52;
      if (dm.flat) {
        const w = dm.d, hh = dm.d2;
        const perRow = Math.max(1, Math.floor(zLen / (w + 0.01)));
        for (let i = 0; i < count && nf < 40; i++) { const row = i % perRow, layer = Math.floor(i / perRow); R.flatInst.setMatrixAt(nf++, xf(4.7, y0 + hh / 2 + layer * (hh + 0.005), zA + w / 2 + row * (w + 0.01), 0, 0, 0, 6.0, hh, w)); }
      } else {
        const r = Math.max(0.012, dm.d / 2), perRow = Math.max(1, Math.floor(zLen / (2 * r + 0.008)));
        for (let i = 0; i < count && nb < 160; i++) { const row = i % perRow, layer = Math.floor(i / perRow); M4.makeRotationZ(PI / 2); M4.scale(V3.set(r, 6.0, r)); M4.setPosition(4.7, y0 + r + layer * 2 * r * 0.87, zA + r + row * (2 * r + 0.008) + (layer % 2) * r); R.barsInst.setMatrixAt(nb++, M4); }
      }
    }
    R.barsInst.count = nb; R.flatInst.count = nf; R.barsInst.instanceMatrix.needsUpdate = true; R.flatInst.instanceMatrix.needsUpdate = true;
    for (const id in R.rawBins) { const mt = S.materials[id]; const f = mt ? clamp(mt.onHand / (mt.reorderQty || 40), 0.02, 1) : 0; R.rawBins[id].scale.y = 0.6 * f; }
    R.shadowDirty = true;
  }
  /** Behälter → Instanzen (Position je Stellplatz über containerView; auf AGV/Stapler je Bild) */
  function updateContainers(S) {
    const C = R.C, list = C.list; list.length = 0;
    for (const id in S.containers) {
      const c = S.containers[id], l = c.location;
      if (!l || c.state === 'external') continue;
      const o = S.orders[c.orderId]; const pw = o ? (o.part.weightKg || 0.1) : 0.1;
      let type = pw > 50 ? 'rack' : (c.weightKg - c.qty * pw) >= 25 ? 'gb' : 'klt';
      if (c.state === 'shipped') type = 'wrap';
      const srcR = o && c.src >= 0 ? o.routing[c.src] : (o ? o.routing[0] : null);
      const cap = srcR && srcR.transferBatch ? srcR.transferBatch : Math.max(1, c.qty);
      const e = { id, type, fill: clamp(c.qty / cap, 0.06, 1), scrap: c.kind === 'scrap', raw: c.kind === 'raw', qty: c.qty, carrier: null, x: 0, z: 0, ry: 0, order: c.orderId };
      if (l.kind === 'station') { const cv = WF.sim.containerView(id); if (!cv || !cv.pos) continue; e.x = cv.pos.x; e.z = cv.pos.z; e.ry = 0; }
      else if (l.kind === 'agv') e.carrier = R.agvs[l.id] ? { kind: 'agv', id: l.id } : null;
      else if (l.kind === 'forklift') e.carrier = { kind: 'fork' };
      else continue;
      list.push(e);
    }
    // wartende Transporte (offen) → Ring am Abholort
    const waits = [];
    for (const id in S.transports) {
      const t = S.transports[id]; if (t.status !== 'open' || t.cancelled || !t.containerId) continue;
      const c = S.containers[t.containerId]; if (!c || !c.location || c.location.kind !== 'station') continue;
      const cv = WF.sim.containerView(c.id); if (cv && cv.pos) waits.push(cv.pos);
    }
    C.waits = waits;
    C.dirty = true;
  }
  const CCOL = { parts: new THREE.Color(), scrap: new THREE.Color(), raw: new THREE.Color() };
  function writeContainers(t) {
    const C = R.C; if (!C) return;
    if (!CCOL._init) { CCOL.parts.set('#2f6fc4'); CCOL.scrap.set('#c83a32'); CCOL.raw.set('#7f8a93'); CCOL._init = true; }
    const n = { klt: 0, gb: 0, rack: 0, wrap: 0 }, sh = { n: 0 }, rings = { n: 0 };
    const hl = R.route.id;
    for (const e of C.list) {
      let x = e.x, z = e.z, y = 0, ry = e.ry;
      if (e.carrier) {
        const car = e.carrier.kind === 'agv' ? R.agvs[e.carrier.id] : R.fork; if (!car) continue;
        ry = car.h;
        if (e.carrier.kind === 'agv') { x = car.x; z = car.z; y = 0.345; }
        else { const [ox, oz] = rotXZ(0, 1.4, car.h); x = car.x + ox; z = car.z + oz; y = R.fork.fy + 0.05; }
      }
      const k = e.type;
      if (n[k] >= CMAX[k]) continue;
      const i = n[k]++;
      C.byInst[k][i] = e.id;
      if (k === 'klt') {
        C.klt.setMatrixAt(i, xf(x, y, z, 0, ry, 0)); C.klt.setColorAt(i, e.scrap ? CCOL.scrap : e.raw ? CCOL.raw : CCOL.parts);
        C.kltFill.setMatrixAt(i, xf(x, y + 0.02 + e.fill * 0.24, z, 0, ry, 0, 0.56, 0.012, 0.36));
      } else if (k === 'gb') {
        C.gbBase.setMatrixAt(i, xf(x, y, z, 0, ry, 0)); C.gb.setMatrixAt(i, xf(x, y + 0.11, z, 0, ry, 0));
        C.gbFill.setMatrixAt(i, xf(x, y + 0.13 + e.fill * 0.55, z, 0, ry, 0, 0.76, 0.012, 0.7));
      } else if (k === 'rack') {
        C.rack.setMatrixAt(i, xf(x, y, z, 0, ry, 0));
        for (let s = 0; s < Math.min(3, e.qty); s++) { if (sh.n >= CMAX.rack * 3) break; const [ox, oz] = rotXZ(-0.2 + s * 0.2, 0, ry); C.shaft.setMatrixAt(sh.n++, xf(x + ox, y + 0.27, z + oz, 0, ry, 0, 0.065, 0.065, 1.5)); }
      } else {
        C.wrap.setMatrixAt(i, xf(x, y, z, 0, ry, 0)); C.pal.setMatrixAt(i, xf(x, y, z, 0, ry + PI / 2, 0, 0.75, 1, 1.05));
      }
      if (hl && e.order === hl && rings.n < 60) { const s = 1 + Math.sin(t * 4) * 0.06; C.ring.setMatrixAt(rings.n++, xf(x, y + 0.03, z, 0, 0, 0, s, 1, s)); }
    }
    C.klt.count = C.kltFill.count = n.klt; C.gb.count = C.gbBase.count = C.gbFill.count = n.gb; C.rack.count = n.rack; C.shaft.count = sh.n; C.wrap.count = C.pal.count = n.wrap; C.ring.count = rings.n;
    for (const m of [C.klt, C.kltFill, C.gb, C.gbBase, C.gbFill, C.rack, C.shaft, C.wrap, C.pal, C.ring]) m.instanceMatrix.needsUpdate = true;
    if (C.klt.instanceColor) C.klt.instanceColor.needsUpdate = true;
    for (const k in n) C.byInst[k].length = n[k];
    let w = 0;
    if (C.waits) for (const p of C.waits) { if (w >= 30) break; const s = 1 + 0.18 * Math.sin(t * 3.5 + w); C.wait.setMatrixAt(w++, xf(p.x, 0.035, p.z, 0, 0, 0, s, 1, s)); }
    C.wait.count = w; C.wait.instanceMatrix.needsUpdate = true;
  }
  /** Materialfluss: aktive Transporte als Bänder vom Träger zum Ziel */
  function carrierOf(tr, S) {
    if (!tr.assignee) return null;
    if (tr.mode === 'AGV') { const a = S.agvs[tr.assignee], e = R.agvs[tr.assignee]; return a && e ? { node: a.node, e } : null; }
    const p = S.people[tr.assignee]; if (!p) return null;
    return { node: p.node, e: p.vehicle ? R.fork : R.people[p.id] };
  }
  function updateFlows(S) {
    const P = WF.profile, seen = new Set();
    for (const id in S.transports) {
      const tr = S.transports[id];
      if (tr.status === 'done' || tr.cancelled || tr.status === 'open') continue;
      const car = carrierOf(tr, S); if (!car || !car.node) continue;
      const loaded = tr.status === 'loaded' || tr.status === 'toDrop';
      const from = P.stationById[tr.from.station], to = P.stationById[tr.to.station]; if (!from || !to) continue;
      const sig = [tr.status, car.node].join('|');
      seen.add(id);
      let fl = R.flowLines.get(id);
      if (fl && fl.sig === sig) { fl.car = car; continue; }
      if (fl) { for (const m of fl.meshes) { R.flowGroup.remove(m); m.geometry.dispose(); } }
      fl = { sig, car, meshes: [], heads: [] };
      const legs = [];
      const endPt = (st, slot) => { const p = slot === 'out' ? st.outPos : st.inPos; return p ? { x: p.x, z: p.z } : { x: st.dock.x, z: st.dock.z }; };
      if (!loaded) {
        legs.push({ from: car.node, to: from, end: endPt(from, 'out'), mat: R.flowMats.approach, head: true });
        legs.push({ from: from.dockNode, to, end: endPt(to, 'in'), mat: R.flowMats.loaded, head: false, start: endPt(from, 'out') });
      } else legs.push({ from: car.node, to, end: endPt(to, 'in'), mat: R.flowMats.loaded, head: true });
      for (const lg of legs) {
        const path = U.path(P.graph, lg.from, lg.to.dockNode);
        const pts = path.points.map(p => ({ x: p.x, z: p.z }));
        if (lg.start) pts.unshift(lg.start);
        pts.push(lg.end);
        if (lg.head) pts.unshift({ x: car.e.x, z: car.e.z });
        const clean = [pts[0]]; for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - clean[clean.length - 1].x, pts[i].z - clean[clean.length - 1].z) > 0.05) clean.push(pts[i]);
        if (clean.length < 2) continue;
        const m = new THREE.Mesh(ribbon(clean, lg.mat === R.flowMats.loaded ? 0.36 : 0.26, lg.mat === R.flowMats.loaded ? 0.04 : 0.038), lg.mat);
        m.renderOrder = 2; m.frustumCulled = false; R.flowGroup.add(m); fl.meshes.push(m);
        if (lg.head) fl.heads.push({ m, p1: clean[1], u1: m.geometry.attributes.uv.array[4] });
      }
      R.flowLines.set(id, fl);
    }
    for (const [id, fl] of R.flowLines) if (!seen.has(id)) { for (const m of fl.meshes) { R.flowGroup.remove(m); m.geometry.dispose(); } R.flowLines.delete(id); }
  }
  /** pro Bild: Anfang des Bands an die angezeigte Trägerposition setzen */
  function flowHeads() {
    for (const [, fl] of R.flowLines) for (const h of fl.heads) {
      const e = fl.car && fl.car.e; if (!e) continue;
      const pos = h.m.geometry.attributes.position, uv = h.m.geometry.attributes.uv, a = pos.array;
      let dx = h.p1.x - e.x, dz = h.p1.z - e.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = (h.m.material === R.flowMats.loaded ? 0.36 : 0.26) / 2, nx = -dz * w, nz = dx * w;
      a[0] = e.x + nx; a[2] = e.z + nz; a[3] = e.x - nx; a[5] = e.z - nz;
      uv.array[0] = uv.array[2] = h.u1 + l;
      pos.needsUpdate = true; uv.needsUpdate = true;
    }
  }

  // ================================================================== Pro Bild: Interpolation & Animation
  function sample(S) {
    for (const id in R.people) {
      const pe = R.people[id], p = S.people[id];
      const vis = !!p && p.state !== 'offShift' && p.state !== 'break' && !p.vehicle;
      if (vis && !pe.vis) { pe.x = p.pos.x; pe.z = p.pos.z; pe.th = pe.h = p.heading || 0; }
      pe.vis = vis;
      if (!p) continue;
      pe.x0 = pe.x; pe.z0 = pe.z; pe.x1 = p.pos.x; pe.z1 = p.pos.z;
      if (Math.hypot(pe.x1 - pe.x, pe.z1 - pe.z) > 40) { pe.x = pe.x0 = pe.x1; pe.z = pe.z0 = pe.z1; }
      const mv = Math.hypot(pe.x1 - pe.x0, pe.z1 - pe.z0);
      pe.moving = mv > 0.02 && (p.state === 'walking' || p.route);
      if (pe.moving) pe.th = Math.atan2(pe.x1 - pe.x0, pe.z1 - pe.z0);
      else if (p.state === 'working' && p.task) {
        const tgt = faceTarget(p);
        if (tgt) pe.th = Math.atan2(tgt.x - pe.x1, tgt.z - pe.z1);
      }
      pe.working = p.state === 'working';
      const tk = p.task;
      pe.carry = !!(tk && ((tk.type === 'toolChange' && tk.data && tk.data.fetched) || (tk.type === 'fpi' && S.machines[tk.machineId] && S.machines[tk.machineId].fpi && S.machines[tk.machineId].fpi.stage === 'carry')));
      pe.carryKind = tk ? tk.type : null;
    }
    for (const id in R.agvs) {
      const ae = R.agvs[id], a = S.agvs[id]; if (!a) continue;
      if (!ae.init) { ae.x = a.pos.x; ae.z = a.pos.z; ae.th = ae.h = a.heading || 0; ae.init = true; }
      ae.x0 = ae.x; ae.z0 = ae.z; ae.x1 = a.pos.x; ae.z1 = a.pos.z;
      if (Math.hypot(ae.x1 - ae.x, ae.z1 - ae.z) > 40) { ae.x = ae.x0 = ae.x1; ae.z = ae.z0 = ae.z1; }
      const mv = Math.hypot(ae.x1 - ae.x0, ae.z1 - ae.z0);
      if (mv > 0.02) ae.th = Math.atan2(ae.x1 - ae.x0, ae.z1 - ae.z0);
      else if (a.state === 'charging' || a.state === 'idle') ae.th = PI;
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
      const drv = f.driver ? S.people[f.driver] : null, rk = drv ? roleOf(drv.role) : null;
      if (rk !== fe.driverRole) { fe.driverRole = rk; if (rk) fe.driver.geometry = personGeos(rk, SKIN[(parseInt(drv.id.slice(1), 10) * 7) % SKIN.length]).seated; }
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
    if (st.id === 'QS' && st.cmm) return { x: st.cmm.x + st.cmm.w / 2, z: st.cmm.z + st.cmm.d / 2 };
    if (st.id === 'M13') return { x: 59.3, z: p.pos.z };
    if (st.footprint && Math.hypot(st.work.x - p.pos.x, st.work.z - p.pos.z) < 2.5) return { x: st.footprint.x + st.footprint.w / 2, z: st.footprint.z + st.footprint.d / 2 };
    return null;
  }
  function onPartDone(mo) {
    if (mo.type === 'mill5') mo.a.palTarget += PI;
    if (mo.type === 'lathe') mo.a.loadT = 0;
  }

  function frame(dt) {
    if (!R.ok || !R.visible) return;
    const S = WF.sim && WF.sim.state; if (!S || !S.machines) return;
    dt = Math.min(dt || 0.016, 0.1);
    R.time += dt;
    const t = R.time, app = WF.app;
    // Simulationszeit für die Interpolation
    if (S.t !== R.lastT) {
      if (R.lastT < 0 || S.t < R.lastT || S.t - R.renderT > 30) R.renderT = S.t - 0.001;
      R.sT0 = Math.max(R.renderT, S.t - 3); R.renderT = R.sT0; R.sT1 = S.t; R.lastT = S.t;
      sample(S);
    }
    if (app.paused) R.renderT = R.sT1; else R.renderT = Math.min(R.sT1, R.renderT + dt * (app.speed || 30));
    const al = R.sT1 > R.sT0 ? clamp((R.renderT - R.sT0) / (R.sT1 - R.sT0), 0, 1) : 1;
    const running = !app.paused;

    // Kamera
    if (R.tween) {
      const tw = R.tween; tw.t += dt / tw.dur; const k = easeIO(Math.min(1, tw.t)), s = tw.src, d = tw.dst;
      setCam({ tx: s.tx + (d.tx - s.tx) * k, ty: s.ty + (d.ty - s.ty) * k, tz: s.tz + (d.tz - s.tz) * k, r: s.r + (d.r - s.r) * k, phi: s.phi + (d.phi - s.phi) * k, th: s.th + (d.th - s.th) * k });
      if (tw.t >= 1) R.tween = null;
    } else if (R.follow) {
      const e = R.follow.kind === 'agv' ? R.agvs[R.follow.id] : R.people[R.follow.id];
      const ps = R.follow.kind === 'person' ? WF.sim.state.people[R.follow.id] : null;
      const ex = ps && ps.vehicle ? R.fork.x : e ? e.x : null, ez = ps && ps.vehicle ? R.fork.z : e ? e.z : null;
      if (ex != null) { const tg = R.controls.target, nx = damp(tg.x, ex, 4, dt), nz = damp(tg.z, ez, 4, dt); R.camera.position.x += nx - tg.x; R.camera.position.z += nz - tg.z; tg.x = nx; tg.z = nz; }
    }
    R.controls.update();
    clampTarget();
    // Wände ausblenden, wenn die Kamera dahinter ist
    const cp = R.camera.position;
    for (const w of R.walls) {
      const tgt = w.outside(cp) ? 0 : 1;
      if (Math.abs(w.f - tgt) > 0.001) { w.f = damp(w.f, tgt, 7, dt); if (Math.abs(w.f - tgt) < 0.01) w.f = tgt; w.g.scale.y = Math.max(0.001, w.f); w.g.visible = w.f > 0.01; R.shadowDirty = true; }
    }

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
      if (walking) pe.phase += Math.min(dist * 4.2, dt * 13);
      const sw = Math.sin(pe.phase) * 0.55 * pe.walk;
      pe.legL.rotation.x = sw; pe.legR.rotation.x = -sw;
      const wk = pe.work * (-0.95 + Math.sin(t * 3.1 + pe.x) * 0.12);
      pe.armL.rotation.x = -sw * 0.8 + wk; pe.armR.rotation.x = sw * 0.8 + wk * (pe.carry ? 0.4 : 1) - (pe.carry ? 0.5 : 0);
      pe.g.position.y = Math.abs(Math.cos(pe.phase)) * 0.025 * pe.walk;
      pe.item.visible = pe.carry;
    }
    // AGVs
    for (const id in R.agvs) {
      const ae = R.agvs[id];
      ae.x = ae.x0 + (ae.x1 - ae.x0) * al; ae.z = ae.z0 + (ae.z1 - ae.z0) * al;
      ae.h += angD(ae.h, ae.th) * (1 - Math.exp(-dt * 6));
      ae.g.position.set(ae.x, 0, ae.z); ae.g.rotation.y = ae.h;
      const busy = ae.st && ae.st !== 'idle' && ae.st !== 'charging';
      let col = 0xd9e2ec, k = 0.55;
      if (ae.st === 'charging') { col = 0x34d399; k = 0.55 + 0.45 * Math.sin(t * 2.4) ** 2; }
      else if (ae.low) { col = 0xfbbf24; k = 0.6 + 0.4 * (Math.sin(t * 5) > 0 ? 1 : 0); }
      else if (busy) { col = 0x3cc6f2; k = 1; }
      ae.led.color.setHex(col).multiplyScalar(k * 1.6);
    }
    // Ladestation-LEDs
    if (R.chgLeds) { const S2 = S; ['AGV1', 'AGV2'].forEach((id, i) => { const a = S2.agvs[id]; const on = a && a.state === 'charging'; R.chgLeds[i].color.setHex(on ? 0x34d399 : 0x1b3a2c); if (on) R.chgLeds[i].color.multiplyScalar(1.4 + 0.6 * Math.sin(t * 3)); }); }
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
    // Maschinen
    for (const mo of R.moList) animMachine(mo, dt, t, al, S, running);
    // Behälter, Materialfluss
    writeContainers(t);
    if (R.layers.flow) { flowHeads(); for (const k in R.flowMats) R.flowMats[k].uniforms.uTime.value = t; }
    // Auswahl
    const st = R.selTarget;
    if (st && R.selRing.visible) {
      let x = null, z = null;
      if (st.kind === 'person') { const pe = R.people[st.id], ps = S.people[st.id]; if (ps && ps.vehicle) { x = fe.x; z = fe.z; } else if (pe && pe.vis) { x = pe.x; z = pe.z; } }
      else if (st.kind === 'agv') { const ae = R.agvs[st.id]; if (ae) { x = ae.x; z = ae.z; } }
      else if (st.kind === 'container') { const e = R.C.list.find(c => c.id === st.id); if (e) { if (e.carrier) { const car = e.carrier.kind === 'agv' ? R.agvs[e.carrier.id] : R.fork; x = car.x; z = car.z; } else { x = e.x; z = e.z; } } }
      if (x != null) { R.selRing.position.set(x, 0.03, z); const s = 1.15 + 0.08 * Math.sin(t * 4); R.selRing.scale.set(st.kind === 'agv' ? s * 1.5 : s, 1, st.kind === 'agv' ? s * 1.5 : s); R.selRing.material.opacity = 0.9; }
      else R.selRing.material.opacity = 0;
    }
    if (R.selBox.visible) R.selBox.material.opacity = 0.7 + 0.3 * Math.sin(t * 3.2);
    // Datenfluss
    pulses(dt, t);
    // Hover
    if (R.hoverDirty && !R.down && R.mouse.in && !R.lbHover) { R.hoverDirty = false; setHover(pickAt(R.mouse.x, R.mouse.y)); }
    else if (R.down) { if (R.hover) setHover(null); }
    // Schatten gedrosselt aktualisieren
    R.shadowAcc += dt;
    if (R.shadowAcc > 0.25 || R.shadowDirty) { R.shadowAcc = 0; R.shadowDirty = false; R.renderer.shadowMap.needsUpdate = true; }
    // Auflösung bei schwacher Grafik anpassen
    adaptPerf(dt);
    R.renderer.render(R.scene, R.camera);
    placeLabels();
  }

  function animMachine(mo, dt, t, al, S, running) {
    const m = S.machines[mo.id]; if (!m) return;
    const st = m.state, a = mo.a || {};
    mo.prog = mo.p0 + (mo.p1 - mo.p0) * al;
    const cutting = st === 'running' && m.part && m.part.sub === 'cut' && !m.part.paused && running;
    const dressing = st === 'running' && m.dressRem > 0;
    // Tür: offen beim Rüsten, Werkzeugwechsel, Korrektur oder wenn ein Teil eingelegt wird
    if (mo.door) {
      const open = !!(m.setupRun || m.toolchange || m.corrRun || (m.part && m.part.sub === 'load'));
      const d = mo.door, tg = open ? 1 : 0;
      if (Math.abs(d.f - tg) > 0.002) { d.f = damp(d.f, tg, 3.5, dt); d.obj.position.x = d.x0 + d.slide * d.f; }
    }
    // Innenlicht, Bodenrahmen, Signalsäule
    const it = mo.innerTarget != null ? mo.innerTarget : 0.1;
    if (Math.abs(mo.inner.emissiveIntensity - it) > 0.003) mo.inner.emissiveIntensity = damp(mo.inner.emissiveIntensity, it, 4, dt);
    let gi = mo.glowBase || 0.4;
    if (st === 'fault') gi *= 0.55 + 0.45 * (Math.sin(t * 7) > 0 ? 1 : 0.2);
    else if ((WF.STATE[st] || {}).group === 'wait') gi *= 0.75 + 0.25 * Math.sin(t * 2.2);
    const hv = (R.hover && R.hover.kind === 'machine' && R.hover.id === mo.id) || (R.selTarget && R.selTarget.kind === 'machine' && R.selTarget.id === mo.id);
    if (hv) gi = Math.min(1.25, gi * 1.35);
    if (R.flash && R.flash.id === mo.id) { R.flash.t += dt; gi += Math.max(0, 1 - R.flash.t / 2.4) * 0.8 * (0.5 + 0.5 * Math.sin(t * 9)); if (R.flash.t > 2.4) R.flash = null; }
    mo.glow.mat.uniforms.uI.value = gi;
    if (mo.tower && st === 'fault') { const on = Math.sin(t * 7) > 0; const mm = mo.tower.mats[2]; mm.emissiveIntensity = on ? 2.8 : 0.15; mo.tower.halo.material.opacity = on ? 0.95 : 0.1; }
    if (mo.tablet) { const tb = mo.tablet; tb.flash = Math.max(0, tb.flash - dt * 1.5); tb.mat.color.setHex(0x5fb6e6).multiplyScalar(0.8 + tb.flash * 1.8); }
    const spin = cutting ? 1 : dressing ? 0.35 : 0;
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
        a.chuck.rotation.x += dt * 22 * w;
        if (a.loadT != null) { a.loadT += dt; if (a.loadT > 4) a.loadT = null; }
        const ph = a.loadT != null ? a.loadT / 4 : -1;
        let cx = a.carX.mach, dy = 0;
        if (ph >= 0) { const k = ph < 0.5 ? ph * 2 : (1 - ph) * 2; cx = a.carX.mach + (a.carX.store - a.carX.mach) * easeIO(k); dy = Math.sin(ph * PI * 2) ** 2 * 0.3; }
        a.car.position.x = damp(a.car.position.x, cx, 5, dt); a.arm.position.y = -dy;
        if (cutting) a.tur.rotation.x = Math.round(mo.prog * 4) * PI / 4;
        break;
      }
      case 'swiss': a.sp.rotation.x += dt * 30 * w; break;
      case 'biglathe': {
        a.chuck.rotation.x += dt * 4 * w;
        if (a.x0 != null) { const pass = (mo.prog * 3) % 1, tri = pass < 0.85 ? pass / 0.85 : 1 - (pass - 0.85) / 0.15; const tx = cutting ? a.x0 + (a.x1 - a.x0) * tri : a.x1 - 0.2; a.sup.position.x = damp(a.sup.position.x, tx, 4, dt); }
        break;
      }
      case 'deephole': {
        a.chuck.rotation.x += dt * 9 * w;
        const ox = a.oilX != null ? a.oilX : -1.9, startX = 4.3, depth = Math.min(a.wl || 1.6, startX - ox - 1.4);
        const cx = cutting || st === 'running' ? startX - depth * mo.prog : startX;
        a.car.position.x = damp(a.car.position.x, cx, 4, dt);
        const bx0 = ox + 0.3, bx1 = a.car.position.x - 0.55, L = Math.max(0.1, bx1 - bx0);
        a.boring.scale.set(0.035, L, 0.035); a.boring.position.set((bx0 + bx1) / 2, a.ay, 0.05);
        a.supports.forEach((g, i) => { g.position.x = bx0 + L * (i + 1) / 4; });
        break;
      }
      case 'hobber': {
        a.hob.rotation.y += dt * 28 * w; a.table.rotation.y += dt * 1.3 * w;
        a.head.position.y = a.fy + 0.6 + (cutting ? 0.25 - mo.prog * 0.3 : 0.3);
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
        if (cutting) { a.table.position.x = a.tx + Math.sin(t * 0.8) * 0.4; a.table.position.z = a.tz + Math.sin(t * 1.3) * 0.08; }
        break;
      }
      case 'cylgrinder': a.wheel.rotation.x += dt * 45 * w; a.work.rotation.x += dt * 6 * (cutting ? 1 : 0); a.head.position.z = a.hz + (cutting ? Math.sin(t * 2) * 0.015 + 0.02 : -0.05); break;
      case 'surfgrinder': a.wheel.rotation.z += dt * 45 * w; if (cutting) a.table.position.x = Math.sin(t * 1.4) * 0.45; break;
      case 'washer': a.basket.rotation.z += dt * 3 * w; break;
      case 'cmm': {
        if (st === 'running') {
          a.bridge.position.z = a.tz + Math.sin(t * 0.55) * (a.d / 2 - 0.45);
          a.zcar.position.x = Math.sin(t * 0.83 + 1) * (a.w / 2 - 0.5);
          a.ram.position.y = -0.08 + (Math.sin(t * 1.9) * 0.5 + 0.5) * 0.18;
        }
        break;
      }
      default: break;
    }
  }
  function pulses(dt, t) {
    const P = R.pulse; if (!P) return;
    const pos = P.pos, size = P.size, alpha = P.alpha;
    for (let i = P.list.length - 1; i >= 0; i--) {
      const q = P.list[i];
      q.d += q.speed * dt;
      const done = q.d >= q.path.len;
      for (let k = 0; k < PULSE_PTS; k++) {
        const j = q.slot * PULSE_PTS + k, d = q.d - k * 0.55;
        pointAt(q.path, Math.min(d, q.path.len), V1);
        pos[j * 3] = V1.x; pos[j * 3 + 1] = V1.y; pos[j * 3 + 2] = V1.z;
        size[j] = q.size * (1 - k * 0.22); alpha[j] = d < 0 ? 0 : q.a * (1 - k * 0.28);
      }
      if (done) {
        for (let k = 0; k < PULSE_PTS; k++) alpha[q.slot * PULSE_PTS + k] = 0;
        if (q.onEnd) q.onEnd();
        P.free.push(q.slot); P.list.splice(i, 1);
      }
    }
    P.g.attributes.position.needsUpdate = true; P.g.attributes.aSize.needsUpdate = true; P.g.attributes.aAlpha.needsUpdate = true;
    // Grundrauschen: angebundene, laufende Maschinen senden alle paar Sekunden Signale (Level ≥ 2: Stückzähler, Spindel)
    if (R.layers.data) {
      R.hbAcc = (R.hbAcc || 0) + dt;
      if (R.hbAcc > 0.9) {
        R.hbAcc = 0;
        const S = WF.sim.state;
        const cand = R.moList.filter(mo => mo.path && S.machines[mo.id] && S.machines[mo.id].conn.level >= 2 && S.machines[mo.id].state === 'running');
        if (cand.length) spawnPulse(cand[Math.floor(Math.random() * cand.length)].path, { size: 0.32, speed: 20, alpha: 0.55, onEnd: () => { R.serverHit = Math.max(R.serverHit || 0, 0.4); } });
      }
    }
    // Server-LEDs
    R.serverHit = Math.max(0, (R.serverHit || 0) - dt * 2.5);
    if (R.serverLeds) R.serverLeds.forEach((m, i) => { const b = 0.5 + 0.5 * (Math.sin(t * (7 + i * 3.3) + i) > 0.2 ? 1 : 0) + R.serverHit * 2; m.color.setHex(i === 1 ? 0x3cc6f2 : 0x34d399).multiplyScalar(0.6 + b); });
    for (const p of R.pings) {
      if (p.t >= 1) { if (p.m.visible) p.m.visible = false; continue; }
      p.t += dt / 1.1;
      if (p.follow) p.m.position.set(p.follow.x, 0.04, p.follow.z);
      const s = (0.6 + p.t * 2.2) * (p.s || 1); p.m.scale.set(s, 1, s); p.m.material.opacity = (1 - p.t) * 0.95;
    }
  }
  function adaptPerf(dt) {
    R.perfAcc += dt; R.perfN++;
    if (R.perfAcc < 2) return;
    const avg = R.perfAcc / R.perfN; R.perfAcc = 0; R.perfN = 0;
    if (avg > 0.03 && R.dpr > 1) { R.dpr = Math.max(1, R.dpr - 0.25); resize(true); }
    else if (avg < 0.0125 && R.dpr < R.dprMax) { R.perfHigh++; if (R.perfHigh > 3) { R.perfHigh = 0; R.dpr = Math.min(R.dprMax, R.dpr + 0.25); resize(true); } }
  }
  function resize(force) {
    if (!R.root || !R.renderer) return;
    const w = R.root.clientWidth, h = R.root.clientHeight;
    if (!w || !h) return;
    if (!force && w === R.w && h === R.h) return;
    R.w = w; R.h = h;
    R.renderer.setPixelRatio(R.dpr);
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
    R.pulse.mat.uniforms.uScale.value = h * R.dpr / (2 * Math.tan(R.camera.fov * DEG / 2));
    const mob = w <= 640;
    if (mob !== R.mobile) { R.mobile = mob; R.root.classList.toggle('m', mob); closeSheets(); }
    computeUiRects();
    for (const id in R.lb) R.lb[id].sizes = {};
  }

  // ================================================================== Aufbau / Lebenszyklus
  function fallback(root, msg) {
    R.failed = true;
    root.innerHTML = '';
    const box = el('div', { class: 'h3-fb' });
    box.innerHTML = `<div class="card"><div class="card-b" style="padding:22px 24px">${icon('cube', 28)}<h3>3D-Ansicht nicht verfügbar</h3>
      <p>${esc(msg || 'Dieser Browser oder Rechner unterstützt kein WebGL. Alle Live-Daten der Halle – Maschinen, Aufträge, Personal und Transporte – stehen im Leitstand und in den Ressourcen-Ansichten zur Verfügung.')}</p>
      <button class="btn primary" data-go>${icon('grid', 15)}Zum Leitstand</button></div></div>`;
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
    V1 = new THREE.Vector3(); V2 = new THREE.Vector3(); V3 = new THREE.Vector3(); Q1 = new THREE.Quaternion(); M4 = new THREE.Matrix4(); COL = new THREE.Color(); RAY = new THREE.Raycaster(); NDC = new THREE.Vector2();
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
    root.append(R.canvas);
    R.mobile = (root.clientWidth || window.innerWidth) <= 640; root.classList.toggle('m', R.mobile);
    const t0 = performance.now();
    try {
      R.scene = new THREE.Scene();
      R.scene.background = new THREE.Color(0x0b1120);
      R.scene.fog = new THREE.Fog(0x0b1120, 130, 320);
      R.camera = new THREE.PerspectiveCamera(32, 1.6, 0.5, 700);
      R.controls = new THREE.OrbitControls(R.camera, R.canvas);
      const c = R.controls;
      c.enableDamping = true; c.dampingFactor = 0.09; c.minDistance = 7; c.maxDistance = 150;
      c.minPolarAngle = 10 * DEG; c.maxPolarAngle = 76 * DEG; c.screenSpacePanning = false;
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
    WF.bus.on('select', (s) => applySelection(s));
    WF.bus.on('sim:reset', onReset);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { /* Bodenbeschriftung mit geladener Schrift neu zeichnen */
      if (!R.ok || R.fontsDone) return; R.fontsDone = true;
      const marks = R.scene.children.find(o => o.isMesh && o.material && o.material.transparent && o.material.map && o.position.y > 0.004 && o.position.y < 0.01);
      if (marks) { const old = marks.material.map; marks.material.map = texFloorMarks(); marks.material.needsUpdate = true; old.dispose(); }
    });
    if (WF.app.selected) applySelection(WF.app.selected);
    setTimeout(hideHint, 14000);
  }
  function onReset() {
    if (!R.ok) return;
    R.lastT = -1; R.lastCounter = {}; R.rawSig = null;
    for (const id in R.agvs) R.agvs[id].init = false;
    if (R.fork) R.fork.init = false;
    for (const id in R.people) R.people[id].vis = false;
    for (const [, fl] of R.flowLines) for (const m of fl.meshes) { R.flowGroup.remove(m); m.geometry.dispose(); }
    R.flowLines.clear();
    if (R.pulse) { for (const q of R.pulse.list) { R.pulse.free.push(q.slot); for (let k = 0; k < PULSE_PTS; k++) R.pulse.alpha[q.slot * PULSE_PTS + k] = 0; } R.pulse.list.length = 0; }
    for (const mo of R.moList) { mo.state = null; mo.prog = mo.p0 = mo.p1 = 0; if (R.lb[mo.id]) R.lb[mo.id].sig = ''; }
    if (R.route.id) { const id = R.route.id; clearRoute(); buildRoute(id); }
    R.shadowDirty = true;
  }
  function show() {
    R.visible = true;
    if (!R.ok) return;
    resize(true);
    R.lastT = -1;
    if (R.pending) { const p = R.pending; R.pending = null; if (p.fn === 'station') focusStation(p.id); else focusOrder(p.id); }
    R.shadowDirty = true;
  }
  function hide() { R.visible = false; if (R.ok) { setHover(null); R.ui.tip.classList.remove('on'); } }

  WF.registerView({ id: 'halle', title: 'Halle 3D', icon: 'cube', group: 'betrieb', order: 2, full: true, mount, show, hide, update, frame });
  WF.hall = {
    focusStation: (id) => focusStation(id),
    focusOrder: (id) => focusOrder(id),
    get ready() { return R.ok; },
    _debug: R,
  };
})();
