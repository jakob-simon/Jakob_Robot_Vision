/* werkfluss – Ansicht „Qualität“ (48_quality.js).
   Kennzahlen (Gutteilquote je Arbeitsgang, Ausschuss Stk/€ (Schätzung), Erstteilprüfungen, Prüflose am Messraum,
   SPC-Warnungen), Messraum-Strecke (in Prüfung → Warteschlange → wartende Erstteile), SPC-Regelkarte (Einzelwerte)
   mit Toleranz- und Eingriffsgrenzen, Cp/Cpk, Trendhinweis, Werkzeugwechsel/Korrekturen als Marker,
   Ausschuss nach Ursache und Maschine, Erstteilprüfungen, Sperrlager, Messprotokoll.
   Nur lesen: Messwerte aus state.measurements, Grenzen über WF.sim.charOf, Ereignisse (scrap/fpi*) aus dem Ereignisstrom.
   Öffentlich: WF.quality = { stats(key, n), unitCost(orderId, seq), charLabel(key), select(key) }. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;
  const DAY = 86400;

  const S = () => WF.sim && WF.sim.state;
  const P = () => WF.profile;
  const st = (id) => P().stationById[id];
  const mLabel = (id) => { const s = st(id); return s ? (s.kind === 'machine' || s.kind === 'qs' || s.kind === 'assembly' ? id + ' ' + s.short : s.short) : id; };
  const tclock = (t, now) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(n || ''); };
  const durMin = (sec) => (sec < 60 ? '< 1 min' : U.fmtDur(Math.floor(sec / 60) * 60));
  const hasDetail = (k) => !!(WF.details && WF.details[k]);
  /** Quelle des Maschinenzustands laut Anbindung (WF.connect) – L0 nur laut Tablet */
  const stateSrc = (id) => (WF.connect && WF.connect.provenance ? WF.connect.provenance(id, 'state') : '');
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node && node._t !== txt) { node._t = txt; node.textContent = txt; } }
  function setHTML(node, html) { if (node && node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setAttr(node, k, v) { const key = '_a' + k; if (node && node[key] !== v) { node[key] = v; if (v == null) node.removeAttribute(k); else node.setAttribute(k, v); } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  /** Nachkommastellen wie die Engine (Toleranzbreite) */
  const decOf = (ch) => { const span = ch.tolPlus - ch.tolMinus; return span < 0.05 ? 4 : span < 1 ? 3 : 2; };
  const fv = (v, ch, plus) => (v == null || !isFinite(v) ? '–' : (plus && v > 0 ? '+' : '') + U.fmtNum(v, decOf(ch)));
  const SCRAP_REASONS = ['Maß', 'Werkzeugbruch', 'Erstteil n.i.O.'];
  const REASON_TXT = { 'Maß': 'Maß außer Toleranz', 'Werkzeugbruch': 'Werkzeugbruch (Teil im Eingriff)', 'Erstteil n.i.O.': 'Erstteil n.i.O.' };

  // ------------------------------------------------------------------ Ereignis-Cache (seit Laden, auch Vorrechnen)
  const KEEP = { scrap: 1, fpiReady: 1, fpiOk: 1, fpiNok: 1, toolChanged: 1, offset: 1 };
  const EVL = [];          // relevante Ereignisse in Zeitfolge (Bus liefert sie chronologisch)
  let evSeeded = false, evVer = 0;
  WF.bus.on('sim:event', (e) => {
    if (!e) return;
    if (e.type === 'reset') { EVL.length = 0; evSeeded = true; evVer++; return; }
    if (!KEEP[e.type]) return;
    EVL.push(e); evSeeded = true; evVer++;
    if (EVL.length > 8000) { const lim = e.t - 2 * DAY; let n = 0; while (n < EVL.length && EVL[n].t < lim) n++; if (n) EVL.splice(0, n); }
  });
  function allEvents() {
    if (!evSeeded && S() && S().events) { for (const e of S().events) if (KEEP[e.type]) EVL.push(e); evSeeded = true; }
    return EVL;
  }
  const today0 = (now) => Math.floor(now / DAY) * DAY;

  // ------------------------------------------------------------------ Herstellkosten-Schätzung je Teil bis zum Arbeitsgang
  const costCache = {};
  function unitCost(orderId, seq) {
    const k = orderId + '/' + seq;
    if (costCache[k]) return costCache[k];
    const o = S().orders[orderId]; if (!o) return null;
    let mat = 0, mach = 0, matKnown = false, opsN = 0;
    const r0 = o.routing[0];
    if (r0 && r0.material && S().materials[r0.material.id]) { mat = r0.material.perPart * S().materials[r0.material.id].pricePerUnit; matKnown = true; }
    for (const r of o.routing) {
      if (r.station !== 'EXT' && r.station !== 'VERSAND') {
        const s = st(r.station);
        if (s && s.rate) { mach += (r.cycleMin || 0) / 60 * s.rate; opsN++; }
      }
      if (r.seq >= seq) break;
    }
    return (costCache[k] = { mat, mach, total: mat + mach, matKnown, opsN });
  }

  // ------------------------------------------------------------------ Merkmale
  function keyInfo(key) {
    const i = key.lastIndexOf('/'), oid = key.slice(0, i), seq = Number(key.slice(i + 1));
    const o = S().orders[oid];
    const r = o ? o.routing.find(x => x.seq === seq) : null;
    let ch = null; try { ch = WF.sim.charOf(oid, seq); } catch (e) { ch = null; }
    return { key, oid, seq, o, r, ch, station: r ? r.station : null, explicit: !!(r && r.char) };
  }
  const charLabel = (key) => { const k = keyInfo(key); return `${k.oid} · AG ${k.seq} · ${k.ch ? k.ch.name : '–'}`; };
  function defaultKey() {
    const Sx = S();
    const spc = (Sx.notifications || []).find(n => n.status === 'open' && n.key && n.key.startsWith('spc:'));
    if (spc && Sx.measurements[spc.key.slice(4)]) return spc.key.slice(4);
    if (!capInfo.n) renderCap(Sx.t, true);
    if (capInfo.worst && Sx.measurements[capInfo.worst]) return capInfo.worst;
    let best = null, bt = -1;
    for (const k of Object.keys(Sx.measurements)) {
      const arr = Sx.measurements[k]; if (!arr.length) continue;
      const ki = keyInfo(k); if (!ki.explicit) continue;
      const t = arr[arr.length - 1].t + Math.min(arr.length, 30) * 30;
      if (t > bt) { bt = t; best = k; }
    }
    return best || Object.keys(Sx.measurements)[0] || null;
  }

  // ------------------------------------------------------------------ Statistik
  function stats(key, n) {
    const Sx = S(), ki = keyInfo(key), arr = Sx.measurements[key] || [];
    const pts = n ? arr.slice(-n) : arr.slice();
    const ch = ki.ch;
    if (!ch) return null;
    const lsl = ch.lsl != null ? ch.lsl : ch.nominal + ch.tolMinus, usl = ch.usl != null ? ch.usl : ch.nominal + ch.tolPlus, center = (lsl + usl) / 2;
    const ser = pts.filter(p => !p.fpi), vals = ser.map(p => p.v);
    const N = vals.length;
    const mean = N ? vals.reduce((a, b) => a + b, 0) / N : null;
    let mr = 0;
    for (let i = 1; i < N; i++) mr += Math.abs(vals[i] - vals[i - 1]);
    let sigma = N >= 2 ? (mr / (N - 1)) / 1.128 : null;
    if (sigma != null && !(sigma > 0)) { const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, N - 1)); sigma = sd > 0 ? sd : null; }
    const ucl = sigma != null ? mean + 3 * sigma : null, lcl = sigma != null ? mean - 3 * sigma : null;
    const enough = N >= 10 && sigma != null;
    const cp = enough ? (usl - lsl) / (6 * sigma) : null;
    const cpk = enough ? Math.min(usl - mean, mean - lsl) / (3 * sigma) : null;
    const nok = pts.filter(p => !p.ok).length;
    // Trend wie die Engine-SPC: Mittel der letzten 8 Serienteile seit der letzten Korrektur
    const offs = allEvents().filter(e => e.type === 'offset' && e.data && e.data.orderId === ki.oid && e.data.seq === ki.seq);
    const since = offs.length ? offs[offs.length - 1].t : -1;
    const recent = arr.filter(p => !p.fpi && p.t > since).slice(-8);
    let trend = null;
    if (recent.length >= 8) {
      const m8 = recent.reduce((a, p) => a + p.v, 0) / recent.length, dev = m8 - center, half = dev >= 0 ? usl - center : center - lsl;
      const ratio = half > 0 ? Math.abs(dev) / half : 0;
      trend = { mean: m8, dev, ratio, side: dev >= 0 ? 'upper' : 'lower', from: recent[0].t };
    }
    let run = null;
    if (N >= 7) {
      const last = vals.slice(-7); let up = true, dn = true;
      for (let i = 1; i < last.length; i++) { if (!(last[i] > last[i - 1])) up = false; if (!(last[i] < last[i - 1])) dn = false; }
      if (up || dn) run = up ? 'steigend' : 'fallend';
    }
    const lastV = ser.length ? ser[ser.length - 1].v : null;
    const outCtl = enough && lastV != null && (lastV > ucl || lastV < lcl);
    return { ki, ch, pts, N, mean, sigma, ucl, lcl, lsl, usl, center, cp, cpk, nok, trend, run, outCtl, since, enough };
  }

  // ------------------------------------------------------------------ CSS (Präfix .qa-)
  WF.ui.css(`
  .qa-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .qa-root .view-h{margin-bottom:0}
  .qa-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}
  @media (max-width:900px){.qa-kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}
  @media (max-width:560px){.qa-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.qa-kpis .kpi:last-child:nth-child(odd){grid-column:1/-1}}
  .qa-kpis .kpi.click{cursor:pointer}.qa-kpis .kpi.click:hover{border-color:var(--line2)}
  .qa-kpis .kpi .v{display:flex;align-items:baseline;gap:5px}
  .qa-kpis .kpi .v small{margin-left:0}
  .qa-kpis .kpi .v .sep{color:var(--faint);font-weight:400;margin:0 3px}
  .qa-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .qa-kpis .kpi .s{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4}
  .qa-now .m b{color:var(--text2);font-weight:600}
  .qa-now .m.occ{color:var(--faint);font-size:var(--fs-xs)}
  .qa-kpis .kpi .s .bad{color:var(--st-fault)}
  .qa-kpis .kpi .s .bad b{color:inherit}
  .qa-kpis .kpi .s .wa,.qa-kpis .kpi .s .wa b{color:var(--st-wait)}
  .qa-fpy{display:flex;height:6px;gap:2px;margin-top:auto;padding-top:0}
  .qa-fpy-w{margin-top:auto;padding-top:8px}
  .qa-fpy i{display:block;height:100%;border-radius:2px;background:var(--c)}
  .qa-tag{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:2px 5px;border-radius:4px;color:var(--muted);border:1px solid var(--line2);margin-left:6px;vertical-align:2px}

  /* Messraum-Strecke */
  .qa-lab{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr) minmax(200px,280px);align-items:stretch}
  .qa-lab > div{padding:12px 14px;min-width:0}
  .qa-lab > div + div{border-left:1px solid var(--line)}
  .qa-lab .eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .qa-lab .eyebrow b{font-weight:600;color:var(--text2);letter-spacing:0;text-transform:none;font-size:var(--fs-xs)}
  .qa-now{display:flex;flex-direction:column;gap:6px}
  .qa-now .row{gap:8px}
  .qa-now .t{font-size:var(--fs-md);line-height:1.4;color:var(--text)}
  .qa-now .m{font-size:var(--fs-sm);color:var(--muted)}
  .qa-now .bar{height:5px}
  .qa-q{display:flex;align-items:center;gap:6px;overflow:hidden;padding-bottom:2px;min-height:58px}
  .qa-ct{--c:var(--mat);flex:none;display:flex;flex-direction:column;gap:2px;width:var(--qa-cw,136px);min-width:0;padding:7px 10px;border-radius:8px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 30%,transparent);cursor:pointer;font-size:var(--fs-sm);position:relative}
  .qa-ct > *{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .qa-ct:hover{border-color:color-mix(in srgb,var(--c) 60%,transparent)}
  .qa-ct b{font:600 var(--fs-sm)/1.2 var(--f-mono);color:var(--text)}
  .qa-ct span{color:var(--muted);white-space:nowrap;font-size:var(--fs-xs)}
  .qa-ct em{font-style:normal;font-weight:600;color:var(--text2);font-variant-numeric:tabular-nums}
  .qa-ct.tr{border-style:dashed;opacity:.8}
  .qa-ct.nx::before{content:"als Nächstes";position:absolute;top:-8px;left:8px;font:600 var(--fs-2xs)/14px var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:4px;background:var(--mat);color:var(--accent-ink)}
  .qa-q{padding-top:8px}
  .qa-ct.cur{--c:var(--info)}
  .qa-ct.cur::before{content:"in Prüfung";position:absolute;top:-8px;left:8px;font:600 var(--fs-2xs)/14px var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:4px;background:var(--info);color:var(--accent-ink)}
  .qa-arrow{flex:none;width:16px;color:var(--faint);display:flex;align-items:center;justify-content:center}
  .qa-more{flex:none;align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:52px;border-radius:8px;border:1px dashed var(--line2);color:var(--text2);font:600 var(--fs-md)/1.1 var(--f-ui);cursor:default}
  .qa-more small{font:500 var(--fs-2xs)/1.1 var(--f-ui);color:var(--muted)}
  .qa-q-empty{font-size:var(--fs-sm);color:var(--muted)}
  .qa-fpis{display:flex;flex-direction:column;gap:6px}
  .qa-fp{--c:var(--st-setup);display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);padding:6px 9px;border-radius:7px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 28%,transparent);cursor:pointer}
  .qa-fp b{font-weight:600;color:var(--text)}
  .qa-fp span{color:var(--muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
  .qa-fp em{font-style:normal;color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
  .qa-fp.warn{--c:var(--st-wait)}
  .qa-fp.warn em{color:var(--st-wait)}

  /* zwei Spalten gleich hoch: die jeweils letzte Karte füllt auf, ihr Fußtext steht unten (keine Lücke vor dem Messprotokoll) */
  .qa-main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:stretch}
  .qa-col{display:flex;flex-direction:column;gap:14px;min-width:0}
  .qa-col > .card:last-child{flex:1 1 auto;display:flex;flex-direction:column}
  .qa-col > .card:last-child .qa-card-f{margin-top:auto}
  .qa-up{padding:10px 14px 12px;border-top:1px solid var(--line)}
  .qa-up-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}
  .qa-up-h .muted{font-size:var(--fs-xs)}
  .qa-up-r{display:grid;grid-template-columns:44px minmax(0,1fr) minmax(0,1.3fr) auto;gap:10px;align-items:center;min-height:32px;padding:4px 6px;margin:0 -6px;border-radius:7px;font-size:var(--fs-sm);cursor:pointer}
  .qa-up-r:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .qa-up-r b{font:600 var(--fs-md) var(--f-cond);color:var(--text)}
  .qa-up-r .nm{color:var(--text2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-up-r .o{font-family:var(--f-mono);font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-up-r .t{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;min-width:72px}
  .qa-up-r .t small{display:block;font-weight:500;color:var(--muted);font-size:var(--fs-xs)}
  .qa-up-e{font-size:var(--fs-sm);color:var(--muted)}
  .qa-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}

  /* SPC */
  .qa-spc .card-h{flex-wrap:wrap}
  .qa-spc-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
  .qa-spc-ctl select.input{width:auto;max-width:360px;height:30px;padding:3px 30px 3px 10px;font-size:var(--fs-sm);background-color:var(--bg2)}
  .qa-spc-ctl .seg button{padding:5px 9px;font-size:var(--fs-sm)}
  .qa-spc-meta{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--muted);padding:10px 14px 0}
  .qa-spc-meta b{color:var(--text);font-weight:600}
  .qa-spc-meta .link{font-size:var(--fs-sm)}
  .qa-chart{position:relative;padding:6px 8px 0 4px}
  .qa-chart svg{display:block;width:100%;overflow:visible}
  .qa-chart text{font-family:var(--f-ui);font-size:var(--fs-2xs);fill:var(--muted)}
  .qa-chart .tk{font-variant-numeric:tabular-nums}
  .qa-chart .lb{font-weight:600;font-size:var(--fs-2xs)}
  .qa-chart .grid{stroke:var(--line);stroke-width:1}
  .qa-chart .hit{fill:transparent;cursor:crosshair}
  .qa-lg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:var(--fs-xs);color:var(--muted);padding:6px 14px 0}
  .qa-lg span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .qa-lg svg{flex:none}
  .qa-st{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;margin:12px 14px 0;border:1px solid var(--line);border-radius:9px;background:var(--bg2);overflow:hidden}
  .qa-st > div{padding:8px 11px;min-width:0}
  .qa-st > div + div{border-left:1px solid var(--line)}
  .qa-st .l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .qa-st .v{font:600 var(--fs-xl)/1.25 var(--f-cond);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-st .v small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .qa-st .v.ok{color:var(--st-run)} .qa-st .v.warn{color:var(--st-wait)} .qa-st .v.crit{color:var(--st-fault)}
  .qa-expl{margin:10px 14px 0;font-size:var(--fs-sm);line-height:1.5;color:var(--text2)}
  .qa-expl b{color:var(--text);font-weight:600}
  .qa-hint{--c:var(--st-wait);margin:10px 14px 0;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 32%,transparent);font-size:var(--fs-sm);line-height:1.5;color:var(--text2)}
  .qa-hint .ico{flex:none;color:var(--c);margin-top:2px}
  .qa-hint b{color:var(--text);font-weight:600}
  .qa-hint .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .qa-hint.info{--c:var(--info)}
  .qa-hint.ok{--c:var(--st-run)}
  .qa-hint.crit{--c:var(--st-fault)}
  .qa-spc-foot{height:14px}
  .qa-tip{position:fixed;z-index:80;pointer-events:none;background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:7px 10px;font-size:var(--fs-sm);line-height:1.45;box-shadow:var(--shadow);max-width:280px;color:var(--text2)}
  .qa-tip b{color:var(--text);font-weight:600}

  /* Prozessfähigkeit */
  .qa-cap{padding:6px 0 10px}
  .qa-cr{display:grid;grid-template-columns:minmax(0,1fr) 104px 38px;gap:10px;align-items:center;padding:7px 14px;cursor:pointer}
  .qa-cr:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .qa-cr.on{background:color-mix(in srgb,var(--accent) 7%,transparent);box-shadow:inset 2px 0 0 var(--accent)}
  .qa-cr .n{min-width:0;display:flex;flex-direction:column;gap:1px}
  .qa-cr .n b{font-weight:600;font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-cr .n span{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-cr .n em{font-style:normal;color:var(--st-run)}
  .qa-cr .tr{position:relative;display:block;height:8px;border-radius:3px;background:var(--track)}
  .qa-cr .tr i{position:absolute;left:0;top:0;bottom:0;border-radius:0 3px 3px 0}
  .qa-cr .tr b{position:absolute;top:-3px;bottom:-3px;width:0;border-left:1px solid var(--muted);opacity:.7}
  .qa-cr .v{font:600 var(--fs-lg)/1 var(--f-cond);text-align:right;font-variant-numeric:tabular-nums}
  .qa-cap-ax{position:relative;height:12px;margin:2px 14px 0;margin-left:calc(100% - 14px - 38px - 10px - 104px);width:104px;font:500 var(--fs-2xs)/1 var(--f-ui);color:var(--faint)}
  .qa-cap-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
  .qa-cap-more{font-size:var(--fs-xs);color:var(--faint);padding:6px 14px 0}
  /* Balken */
  .qa-bars{display:grid;grid-template-columns:minmax(78px,max-content) minmax(50px,1fr) max-content max-content;gap:9px 10px;align-items:center}
  .qa-br{display:grid;grid-column:1/-1;grid-template-columns:subgrid;align-items:center;border-radius:5px}
  .qa-br.click{cursor:pointer}
  .qa-br.click:hover{background:color-mix(in srgb,var(--raise) 35%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--raise) 35%,transparent)}
  .qa-br.click:hover .qa-l{color:var(--text)}
  .qa-br:focus-visible{outline-offset:4px}
  .qa-l{font-size:var(--fs-sm);color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-tr{position:relative;height:12px;border-radius:3px;background:var(--track)}
  .qa-tr i{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0;background:var(--c,var(--st-fault))}
  .qa-v{font:600 var(--fs-md)/1 var(--f-ui);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--text)}
  .qa-v small{font-weight:500;color:var(--muted);font-size:var(--fs-xs);margin-left:2px}
  .qa-m{font-size:var(--fs-xs);color:var(--muted);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:52px}
  .qa-sub{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:16px 0 10px}
  .qa-sub:first-child{margin-top:0}
  .qa-note{font-size:var(--fs-xs);color:var(--faint);margin-top:12px;line-height:1.45}
  .qa-empty{font-size:var(--fs-sm);color:var(--muted);padding:6px 0;display:flex;gap:8px;align-items:center}
  .qa-empty .ico{color:var(--st-run);flex:none}

  /* Tabellen */
  .qa-tbl td{font-variant-numeric:tabular-nums}
  .qa-tbl td.mono,.qa-tbl .mono{font-size:var(--fs-sm)}
  .qa-tbl td .sub{display:block;font-size:var(--fs-xs);color:var(--faint)}
  .qa-res{--c:var(--st-run);display:inline-flex;align-items:center;gap:5px;font:600 var(--fs-xs)/18px var(--f-ui);padding:0 8px 0 6px;border-radius:999px;white-space:nowrap;color:color-mix(in srgb,var(--c) 82%,white);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 36%,transparent)}
  .qa-res i{width:6px;height:6px;border-radius:50%;background:var(--c)}
  .qa-res.nok{--c:var(--st-fault)} .qa-res.open{--c:var(--st-setup)} .qa-res.wait{--c:var(--st-wait)} .qa-res.rw{--c:var(--st-wait)}
  .qa-gauge{display:block}
  .qa-tw{max-height:420px;overflow:auto}
  .qa-tbl tr.nok td{background:color-mix(in srgb,var(--st-fault) 6%,transparent)}
  .qa-tbl tr.cur td{background:color-mix(in srgb,var(--accent) 6%,transparent)}
  .qa-tbl tr.cur td:first-child{box-shadow:inset 2px 0 0 var(--accent)}
  .qa-tot td{font-weight:600;color:var(--text);background:var(--bg2)}
  .qa-tbl td .sub{white-space:nowrap;font-family:var(--f-ui);font-size:var(--fs-xs)}
  .qa-tbl td b{font-weight:600;color:var(--text)}
  .qa-late{color:var(--st-wait)!important}
  .qa-fpit td{padding-top:7px;padding-bottom:7px}
  .qa-sps{display:flex;flex-direction:column}
  .qa-sp{display:flex;justify-content:space-between;gap:10px;padding:9px 14px;border-bottom:1px solid var(--line);box-shadow:inset 3px 0 0 color-mix(in srgb,var(--st-fault) 70%,transparent)}
  .qa-sp:last-child{border-bottom:0}
  .qa-sp.click{cursor:pointer}.qa-sp.click:hover{background:color-mix(in srgb,var(--raise) 35%,transparent)}
  .qa-sp > div{display:flex;flex-direction:column;gap:1px;min-width:0}
  .qa-sp .a b{font:600 var(--fs-sm)/1.3 var(--f-mono);color:var(--text)}
  .qa-sp .b{align-items:flex-end;flex:none}
  .qa-sp .b b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--text)}
  .qa-sp span{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-sp span.r{color:var(--faint)}
  /* Tastaturfokus: Tabellenzeilen bekommen den Ring an den Zellen (Chromium zeichnet keine Umrisse an <tr>) */
  .qa-tbl tr.click{outline:none}
  .qa-tbl tr.click:focus-visible td{background:color-mix(in srgb,var(--accent) 9%,transparent);box-shadow:inset 0 2px 0 var(--accent),inset 0 -2px 0 var(--accent)}
  .qa-tbl tr.click:focus-visible td:first-child{box-shadow:inset 2px 0 0 var(--accent),inset 0 2px 0 var(--accent),inset 0 -2px 0 var(--accent)}
  .qa-tbl tr.click:focus-visible td:last-child{box-shadow:inset -2px 0 0 var(--accent),inset 0 2px 0 var(--accent),inset 0 -2px 0 var(--accent)}
  .qa-cr:focus-visible,.qa-up-r:focus-visible,.qa-sp:focus-visible{outline-offset:-2px}
  .qa-root section.card:focus{outline:none}
  .qa-root section.card:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}
  .qa-card-f{padding:9px 14px 11px;border-top:1px solid var(--line);font-size:var(--fs-xs);color:var(--faint);line-height:1.45}

  @media (max-width:1280px){.qa-main{grid-template-columns:minmax(0,1fr) 320px}.qa-lab{grid-template-columns:minmax(200px,260px) minmax(0,1fr) minmax(190px,240px)}}
  @media (max-width:1100px){.qa-main,.qa-two{grid-template-columns:minmax(0,1fr)}.qa-lab{grid-template-columns:minmax(0,1fr)}.qa-lab > div + div{border-left:0;border-top:1px solid var(--line)}.qa-st{grid-template-columns:repeat(3,minmax(0,1fr))}.qa-st > div:nth-child(4){border-left:0}.qa-st > div:nth-child(n+4){border-top:1px solid var(--line)}}
  @media (max-width:560px){.qa-spc-ctl{width:100%}.qa-spc-ctl select.input{max-width:none;flex:1;min-width:0;width:100%}.qa-bars{grid-template-columns:minmax(64px,max-content) minmax(40px,1fr) max-content}.qa-m{display:none}
    .qa-st{grid-template-columns:repeat(2,minmax(0,1fr))}.qa-st > div:nth-child(n){border-left:0;border-top:1px solid var(--line)}.qa-st > div:nth-child(2n){border-left:1px solid var(--line)}.qa-st > div:nth-child(-n+2){border-top:0}
    .qa-tbl .hm{display:none}.qa-tbl td,.qa-tbl th{padding-left:8px;padding-right:8px}}
  @media (pointer:coarse){.qa-spc-ctl select.input{height:40px}.qa-cr,.qa-up-r,.qa-sp.click{min-height:44px}.qa-fp{min-height:40px}.qa-ct{min-height:44px}.qa-br.click{min-height:40px}}
  .qa-mo{display:none}
  @media (max-width:560px){.qa-mo{display:inline}}
  `, 'quality');

  // ------------------------------------------------------------------ Ansicht
  let root = null, R = {}, selKey = null, winN = 60, userPicked = false, logFilter = 'all';
  let sig = {}, chartW = 0, chartModel = null, tipEl = null, ro = null, labQW = 0;

  function mount(el) {
    root = el;
    el.innerHTML = `
      <div class="qa-root">
        <div class="view-h"><div><h1 class="view-t">Qualität</h1>
          <p class="view-sub">Gutteile, Ausschuss und Prozessfähigkeit – direkt aus den Messwerten jedes Arbeitsgangs. Trends werden erkannt, bevor Ausschuss entsteht.</p></div></div>
        <div class="kpis qa-kpis">
          <div class="kpi"><div class="l">Gutteilquote (FPY)</div><div class="v" data-r="kFpy">–</div><div class="s" data-r="kFpyS">–</div><div class="qa-fpy-w"><div class="qa-fpy" data-r="kFpyB"></div></div></div>
          <div class="kpi click" data-r="kScrapBox" title="Zu Ausschuss nach Ursache" tabindex="0" role="button"><div class="l">Ausschuss heute</div><div class="v" data-r="kScrap">–</div><div class="s" data-r="kScrapS">–</div></div>
          <div class="kpi click" data-r="kFpiBox" title="Zu den Erstteilprüfungen" tabindex="0" role="button"><div class="l">Erstteile heute</div><div class="v" data-r="kFpi">–</div><div class="s" data-r="kFpiS">–</div></div>
          <div class="kpi"><div class="l">Prüflose am Messraum</div><div class="v" data-r="kLab">–</div><div class="s" data-r="kLabS">–</div></div>
          <div class="kpi click" data-r="kSpcBox" title="SPC-Regelkarte des betroffenen Merkmals öffnen" tabindex="0" role="button"><div class="l">SPC-Warnungen</div><div class="v" data-r="kSpc">–</div><div class="s" data-r="kSpcS">–</div></div>
        </div>
        <section class="card" aria-label="Messraum">
          <div class="card-h"><h3>Messraum</h3><span class="muted" data-r="labSub"></span></div>
          <div class="qa-lab">
            <div><div class="eyebrow">In Prüfung</div><div class="qa-now" data-r="labNow"></div></div>
            <div><div class="eyebrow">Warteschlange Prüflose <b data-r="labQn"></b></div><div class="qa-q" data-r="labQ"></div></div>
            <div><div class="eyebrow">Erstteile warten auf Freigabe <b data-r="labFn"></b></div><div class="qa-fpis" data-r="labF"></div></div>
          </div>
        </section>
        <div class="qa-main">
          <div class="qa-col">
          <section class="card qa-spc" data-r="spcCard" aria-label="SPC-Regelkarte" tabindex="-1">
            <div class="card-h"><h3>SPC-Regelkarte · Einzelwerte</h3>
              <div class="qa-spc-ctl"><select class="input" data-r="sel" aria-label="Merkmal wählen"></select>
                <div class="seg" data-r="win"><button data-n="30">30</button><button data-n="60" class="on">60</button><button data-n="0">alle</button></div></div></div>
            <div class="qa-spc-meta" data-r="meta"></div>
            <div class="qa-chart" data-r="chart"></div>
            <div class="qa-lg" data-r="lg"></div>
            <div class="qa-st" data-r="stats"></div>
            <div class="qa-expl" data-r="expl"></div>
            <div data-r="hint"></div>
            <div class="qa-spc-foot"></div>
          </section>
          <section class="card" data-r="fpiCard" aria-label="Erstteilprüfungen" tabindex="-1">
            <div class="card-h"><h3>Erstteilprüfungen</h3><span class="muted" data-r="fpiSub"></span></div>
            <div class="tbl-wrap qa-tw" data-r="fpi"></div>
            <div class="qa-up" data-r="fpiUp"></div>
            <div class="qa-card-f">Erstteil = erstes Teil nach dem Rüsten (oder nach dem Wechsel eines Formwerkzeugs). Die Serie läuft erst nach der Freigabe weiter – Wartezeit bis zur Freigabe ist Stillstand.</div>
          </section>
          </div>
          <div class="qa-col">
            <section class="card" aria-label="Prozessfähigkeit je Merkmal">
              <div class="card-h"><h3>Prozessfähigkeit je Merkmal</h3><span class="muted" data-r="capSub"></span></div>
              <div class="qa-cap" data-r="cap"></div>
            </section>
            <section class="card" data-r="scrapCard" aria-label="Ausschuss" tabindex="-1">
              <div class="card-h"><h3>Ausschuss heute</h3><span class="muted" data-r="scrapSub"></span></div>
              <div class="card-b"><div class="qa-sub">Nach Ursache</div><div data-r="byReason"></div>
                <div class="qa-sub">Nach Maschine</div><div data-r="byMachine"></div>
                <div class="qa-note">€ = Schätzung: Material laut Arbeitsplan + Maschinenzeit (Taktzeit × Stundensatz) aller Arbeitsgänge bis zum Ausschuss.</div></div>
            </section>
            <section class="card" aria-label="Sperrlager">
              <div class="card-h"><h3>Sperrlager</h3><span class="muted" data-r="sperrSub"></span></div>
              <div data-r="sperr"></div>
              <div class="qa-card-f">Ausschuss wird je Auftrag in einem gesperrten Behälter gesammelt und bleibt bis zur Bewertung durch die QS gesperrt.</div>
            </section>
          </div>
        </div>
        <section class="card" aria-label="Messprotokoll">
          <div class="card-h" style="flex-wrap:wrap"><h3>Messprotokoll</h3>
            <div class="row"><span class="muted" data-r="logSub"></span><div class="seg" data-r="logF"><button data-f="all" class="on">Alle</button><button data-f="nok">n.i.O.</button><button data-f="fpi">Erstteile</button></div></div></div>
          <div class="tbl-wrap qa-tw" data-r="log"></div>
        </section>
      </div>`;
    R = refs(el);
    tipEl = document.createElement('div'); tipEl.className = 'qa-tip'; tipEl.hidden = true; document.body.append(tipEl);
    R.sel.addEventListener('change', () => { selKey = R.sel.value; userPicked = true; sig.chart = ''; renderSpc(true); });
    R.win.addEventListener('click', (e) => { const b = e.target.closest('button[data-n]'); if (!b) return; winN = Number(b.dataset.n); R.win.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderSpc(true); });
    R.logF.addEventListener('click', (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; logFilter = b.dataset.f; R.logF.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); sig.log = ''; renderLog(true); });
    const goCard = (card) => { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); try { card.focus({ preventScroll: true }); } catch (e) { /* alt */ } };
    R.kScrapBox.addEventListener('click', () => goCard(R.scrapCard));
    R.kFpiBox.addEventListener('click', () => goCard(R.fpiCard));
    R.kSpcBox.addEventListener('click', () => {
      const n = (S().notifications || []).find(x => x.status === 'open' && x.key && x.key.startsWith('spc:'));
      if (n) selectKey(n.key.slice(4)); else if (capInfo.min && capInfo.min.cpk < 1.33) selectKey(capInfo.min.k);
      goCard(R.spcCard);
    });
    el.addEventListener('click', (e) => {
      const fx = e.target.closest('[data-fix]');
      if (fx && selKey) { e.stopPropagation(); const ki = keyInfo(selKey); WF.app.runAction({ type: 'applyOffset', orderId: ki.oid, seq: ki.seq, value: Number(fx.dataset.fix) }); sig.chart = ''; renderSpc(true); return; }
      const a = e.target.closest('[data-act]');
      if (a) { e.stopPropagation(); const n = (S().notifications || []).find(x => x.id === a.dataset.nid); if (n && n.actions[Number(a.dataset.act)]) { WF.app.runAction(n.actions[Number(a.dataset.act)].action); sig.chart = ''; renderSpc(true); } return; }
      const lk = e.target.closest('[data-sel]');
      if (lk) {
        e.stopPropagation(); const [k, id] = lk.dataset.sel.split('|');
        if (k === 'char') { const fromLog = R.log.contains(lk); selectKey(id); if (fromLog) goCard(R.spcCard); else R.spcCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else WF.app.select(k, id);
      }
    });
    // Tastatur: klickbare Zeilen/Karten (tabindex) per Enter/Leertaste – Knöpfe und Felder machen das selbst
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (!t.matches || !t.matches('[tabindex="0"]') || t.matches('button,a,select,input,textarea')) return;
      e.preventDefault(); t.click();
    });
    // Listen pausieren ihre Aktualisierung, solange der Mauszeiger darüber ist oder ein Eintrag den Fokus hat (Klickziele bleiben stabil)
    for (const k of ['log', 'fpi', 'fpiUp', 'sperr', 'cap', 'labQ', 'labF', 'byMachine']) {
      const n = R[k]; n.addEventListener('mouseenter', () => { n._hover = true; }); n.addEventListener('mouseleave', () => { n._hover = false; });
    }
    R.chart.addEventListener('mousemove', onChartMove);
    R.chart.addEventListener('mouseleave', hideTip);
    if (window.ResizeObserver) { ro = new ResizeObserver(() => { const w = R.chart.clientWidth; if (Math.abs(w - chartW) > 2) { chartW = w; sig.chart = ''; renderSpc(true); } }); ro.observe(R.chart);
      new ResizeObserver(() => { labQW = R.labQ.clientWidth; }).observe(R.labQ); }
    WF.bus.on('sim:reset', () => { sig = {}; if (!userPicked) selKey = null; for (const k in costCache) delete costCache[k]; });
  }
  /** Liste anhalten: Maus darüber oder Tastaturfokus darin */
  const held = (n) => !!(n && (n._hover || n.contains(document.activeElement)));
  /** Nach dem Neuaufbau einer Liste den Fokus auf denselben Eintrag (gleiches data-sel) zurücksetzen */
  function keepFocus(box, fn) {
    const a = document.activeElement, key = box && a && box.contains(a) && a.dataset ? a.dataset.sel : null;
    fn();
    if (key) { const nx = [...box.querySelectorAll('[data-sel]')].find(x => x.dataset.sel === key); if (nx) try { nx.focus({ preventScroll: true }); } catch (e) { /* alt */ } }
  }
  function selectKey(k) {
    if (!k || !S().measurements[k]) return;
    selKey = k; userPicked = true; sig.chart = ''; sig.opts = ''; sig.log = ''; sig.cap = '';
    renderSpc(true); renderCap(S().t, true); renderLog(true);
  }

  // ---------------- Kennzahlen
  function updateKpis(now) {
    const Sx = S(), k = WF.sim.kpis();
    const total = k.good + k.scrap;
    setHTML(R.kFpy, total ? U.fmtPct(k.fpy, 1) : '–');
    setHTML(R.kFpyS, total ? `<b>${U.fmtNum(k.good)}</b> gut · <b>${U.fmtNum(k.scrap)}</b> Ausschuss` : 'heute noch keine Teile');
    setAttr(R.kFpyS, 'title', 'Gutteile ÷ alle bearbeiteten Teile, gezählt je Arbeitsgang (auch Waschen und Prüfen)');
    setHTML(R.kFpyB, total ? `<i style="--c:var(--st-run);flex:${k.good}"></i>${k.scrap ? `<i style="--c:var(--st-fault);flex:${Math.max(k.scrap, total * 0.012)}"></i>` : ''}` : '');
    const sc = scrapToday(now);
    setHTML(R.kScrap, `${U.fmtNum(k.scrap)}<small>Stk</small>${sc.eur > 0 ? `<span class="sep">·</span><small style="margin-right:1px">≈</small>${U.fmtEur(sc.eur)}` : ''}`);
    setHTML(R.kScrapS, k.scrap ? `${SCRAP_REASONS.filter(r => k.scrapBy[r]).map(r => `${esc(r)} <b>${k.scrapBy[r]}</b>`).join(' · ')} · € geschätzt` : 'kein Ausschuss heute');
    R.kScrapBox.classList.toggle('warn', k.scrap > 0 && k.fpy < 0.97);
    const open = openFpis();
    setHTML(R.kFpi, `${U.fmtNum(k.fpiOk)}<small>i.O.</small><span class="sep">·</span>${U.fmtNum(k.fpiNok)}<small>n.i.O.</small>`);
    const waitL = open.filter(x => !x.local).sort((a, b) => b.waitingSec - a.waitingSec);
    setHTML(R.kFpiS, open.length ? `<b>${open.length} offen</b>${waitL[0] ? ` · ${esc(waitL[0].mid)} ${waitL[0].stage === 'measure' ? 'wird gemessen' : 'wartet ' + esc(durMin(waitL[0].waitingSec))}` : ''}` : 'keine offen');
    // lange Wartezeit betrifft nicht den Wert (i.O./n.i.O.) – Hinweis nur in der Zusatzzeile
    const fpiLate = open.some(x => !x.local && x.stage !== 'measure' && x.waitingSec >= 600);
    if (fpiLate) setHTML(R.kFpiS, `<span class="wa">${R.kFpiS.innerHTML}</span>`);
    const lab = labQueue(now);
    setHTML(R.kLab, `${lab.items.length}<small>${lab.items.length === 1 ? 'Los' : 'Lose'}</small>${lab.items.length ? `<span class="sep">·</span>${U.fmtNum(lab.qty)}<small>Stk</small>` : ''}`);
    setText(R.kLabS, lab.items.length ? `ca. ${U.fmtDur(lab.sec)} Prüfzeit${lab.transit ? ` · ${lab.transit} unterwegs` : ''}` : lab.transit ? `${lab.transit} unterwegs zum Messraum` : 'Warteschlange leer');
    setAttr(R.kLabS, 'title', 'Behälter im Eingang des Messraums (inkl. Restmenge des Loses in Prüfung); Prüfzeit = Menge × Prüfzeit je Teil');
    const spcAll = (Sx.notifications || []).filter(n => n.key && n.key.startsWith('spc:'));
    const spcOpen = spcAll.filter(n => n.status === 'open'), spcAck = spcAll.filter(n => n.status === 'ack');
    const spcToday = spcAll.filter(n => n.t >= today0(now));
    const worst = capInfo.min;
    let kv, ks, kc = '';
    if (spcOpen.length) {
      kv = `${spcOpen.length}<small>offen</small>`;
      ks = esc((spcOpen[0].entity ? spcOpen[0].entity.id + ' · ' : '') + charLabel(spcOpen[0].key.slice(4)).split(' · ').slice(-1)[0] + (spcOpen.length > 1 ? ` · +${spcOpen.length - 1}` : ''));
      kc = 'warn';
    } else {
      kv = `0<small>offen</small>${spcToday.length ? `<span class="sep">·</span>${spcToday.length}<small>heute</small>` : ''}`;
      const bits = [];
      if (worst && worst.cpk < 1) bits.push(`<span class="bad"><b>${esc(worst.station)} ${esc(worst.name)}: Cpk ${U.fmtNum(worst.cpk, 2)}</b> – nicht fähig</span>`);
      // Anzahl steht schon im Wert („2 heute“) – hier nur der Stand
      if (spcToday.length) bits.push(spcToday.every(n => n.status === 'resolved') ? `${spcToday.length === 1 ? 'Trend' : 'Trends'} korrigiert` : `${spcAck.length} quittiert`);
      else if (spcAck.length) bits.push(`${spcAck.length} quittiert`);
      if (!bits.length) bits.push('kein Trend heute', capInfo.n ? (capInfo.low ? `${capInfo.low} ${capInfo.low === 1 ? 'Merkmal' : 'Merkmale'} Cpk < 1,33` : 'alle Merkmale fähig') : '');
      ks = bits.filter(Boolean).join(' · ');
      kc = '';   // Wert 0 offen: kein Hinweisstreifen (UI-Regel 14) – nur die Zusatzzeile nennt das nicht fähige Merkmal
    }
    setHTML(R.kSpc, kv);
    setHTML(R.kSpcS, ks);
    setAttr(R.kSpcBox, 'title', spcOpen.length ? 'SPC-Regelkarte des betroffenen Merkmals öffnen' : worst ? `Regelkarte ${worst.station} ${worst.name} öffnen – mit Empfehlung` : 'Zur SPC-Regelkarte');
    R.kSpcBox.classList.toggle('warn', kc === 'warn');
    R.kSpcBox.classList.toggle('crit', kc === 'crit');
  }

  // ---------------- Messraum
  function openFpis() {
    const Sx = S(), out = [];
    for (const id of P().machines) {
      const m = Sx.machines[id]; if (!m || !m.fpi) continue;
      const f = m.fpi;
      out.push({ mid: id, stage: f.stage, t0: f.t0, waitingSec: Sx.t - f.t0, local: !!f.local, by: f.by, orderId: m.op ? m.op.oid : null, seq: m.op ? Sx.orders[m.op.oid].routing[m.op.idx].seq : null, value: f.value });
    }
    return out;
  }
  function labQueue(now) {
    const Sx = S(), qs = Sx.stations.QS, items = [];
    let qty = 0, sec = 0;
    for (const cid of (qs ? qs.inp : [])) {
      const c = Sx.containers[cid]; if (!c || c.kind === 'scrap') continue;
      const o = Sx.orders[c.orderId], r = o ? o.routing[c.idx] : null;
      const cyc = r && r.station === 'QS' ? r.cycleMin || 0 : 0;
      items.push({ c, r, o, sec: c.qty * cyc * 60 });
      qty += c.qty; sec += c.qty * cyc * 60;
    }
    let transit = 0;
    for (const id in Sx.transports) { const t = Sx.transports[id]; if (t.to && t.to.station === 'QS' && t.status !== 'done' && t.containerId) transit++; }
    return { items, qty, sec, transit };
  }
  function renderLab(now) {
    const Sx = S();
    let mv = null; try { mv = WF.sim.machineView('QS'); } catch (e) { mv = null; }
    const op = mv && mv.operator;
    const nsig = mv ? [mv.state, mv.order && mv.order.id, mv.order && mv.order.seq, mv.partsDone, mv.partsTotal, mv.partNo, op && op.id, op && op.state, mv.etaOpEnd != null ? Math.floor(mv.etaOpEnd / 60) : '', mv.etaBusyEnd != null ? Math.floor(mv.etaBusyEnd / 60) : '', mv.cause].join('|') : '-';
    if (sig.labNow !== nsig) {
      sig.labNow = nsig;
      if (!mv) R.labNow.innerHTML = '<div class="qa-q-empty">Kein Messraum im Profil.</div>';
      else {
        const o = mv.order;
        // gleiche Wortwahl und gleiche Zeit wie Leitstand-Kachel und Maschinendetail: „Teil 4 von 30 · Arbeitsgang fertig ca. …“ (etaOpEnd)
        const running = mv.state === 'running' && mv.partNo != null;
        const cnt = running ? `Teil ${U.fmtNum(mv.partNo)} von ${U.fmtNum(mv.partsTotal)}` : `${U.fmtNum(mv.partsDone)} von ${U.fmtNum(mv.partsTotal)} geprüft`;
        // Belegung (etaBusyEnd) nur zusätzlich, wenn der Messraum das Los zwischendurch freigibt (weitere Teile folgen vom Vorgänger)
        const occ = o && mv.etaBusyEnd != null && mv.etaOpEnd != null && mv.etaOpEnd - mv.etaBusyEnd > 600
          ? `<div class="m occ">Messraum mit diesem Los belegt bis ca. ${esc(tclock(mv.etaBusyEnd, now))} – die übrigen Teile folgen vom Vorgänger</div>` : '';
        R.labNow.innerHTML = `<div class="row">${mv.state === 'running' ? WF.ui.pill('running', 'Prüfung läuft') : WF.ui.machinePill(mv)}${op ? `<button class="link" data-sel="person|${esc(op.id)}">${esc(op.name)}</button>` : '<span class="muted">niemand anwesend</span>'}</div>
          <div class="t">${o ? `<button class="link mono" data-sel="${hasDetail('order') ? 'order' : 'machine'}|${esc(hasDetail('order') ? o.id : 'QS')}">${esc(o.id)}</button> · AG ${o.seq} ${esc(o.op)}` : esc(mv.cause || 'Keine Prüfung eingeplant')}</div>
          ${o ? `<div class="m">${esc(o.partName)} · ${cnt}${mv.etaOpEnd != null ? ` · Arbeitsgang fertig ca. <b>${esc(tclock(mv.etaOpEnd, now))}</b>` : ''}</div>${WF.ui.bar(mv.partsTotal ? mv.partsDone / mv.partsTotal : 0, { color: mv.stateColor })}${occ}` : ''}
          ${o && mv.state !== 'running' ? `<div class="m">${esc(mv.cause || '')}</div>` : ''}`;
      }
    }
    const lab = labQueue(now);
    // Reihenfolge und Zeiten aus dem Plan der Engine (forecast().machines.QS – dieselben Blöcke wie in der Plantafel);
    // ohne Planeintrag: Reihenfolge von machineView('QS').queue
    const curO = mv && mv.order ? mv.order.id + '/' + mv.order.seq : null;
    const qIdx = {}; (mv && mv.queue || []).forEach((q, i) => { qIdx[q.orderId + '/' + q.seq] = i; });
    let fc = null; try { fc = WF.sim.forecast(); } catch (e) { fc = null; }
    const planL = (fc && fc.machines && fc.machines.QS) || [], plan = {};
    for (const e of planL) plan[e.orderId + '/' + e.seq] = e;
    const keyC = (x) => x.c.orderId + '/' + (x.r ? x.r.seq : '');
    const rk = (x) => { const k = keyC(x); if (k === curO) return -1e12; if (plan[k]) return plan[k].start; return 1e11 + (qIdx[k] != null ? qIdx[k] : 99); };
    lab.items.sort((a, b) => rk(a) - rk(b));
    const trans = [];
    for (const id in Sx.transports) { const t = Sx.transports[id]; if (t.to && t.to.station === 'QS' && t.status !== 'done' && t.containerId && Sx.containers[t.containerId]) trans.push({ t, c: Sx.containers[t.containerId] }); }
    if (!labQW) labQW = R.labQ.clientWidth;
    const qw = labQW || 0, small = qw < 420, cw = small ? 108 : 136;
    const planSig = lab.items.map(x => { const e = plan[keyC(x)]; return e ? Math.floor(e.start / 60) + '-' + Math.floor(e.end / 60) : ''; }).join(',');
    const qsig = lab.items.map(x => x.c.id + ':' + x.c.qty).join(',') + '|' + trans.map(x => x.c.id + x.t.status).join(',') + '|' + curO + '|' + planSig + '|' + Math.round(qw / 10);
    if (sig.labQ !== qsig && !held(R.labQ)) {
      sig.labQ = qsig;
      setText(R.labQn, lab.items.length ? `${lab.items.length} · ${U.fmtNum(lab.qty)} Stk · ca. ${U.fmtDur(lab.sec)}` : '');
      const firstPlanned = planL.filter(e => !e.active).reduce((m, e) => Math.min(m, e.start), Infinity);
      const all = lab.items.map(x => ({ c: x.c, r: x.r, tr: null })).concat(trans.map(x => { const o = Sx.orders[x.c.orderId]; return { c: x.c, r: o ? o.routing[x.c.idx] : null, tr: x.t }; }));
      let nextDone = false, curDone = false;
      const chip = (x) => {
        const { c, r, tr } = x, k = c.orderId + '/' + (r ? r.seq : ''), e = plan[k], cur = !tr && k === curO && !curDone;
        if (cur) curDone = true;
        const sameLot = !tr && !cur && k === curO;
        const first = !tr && !cur && !sameLot && !nextDone && (!e || e.start <= firstPlanned + 1);
        if (!tr && !cur && !sameLot && !nextDone) nextDone = true;
        const when = tr ? 'unterwegs (' + esc(tr.mode) + ')'
          : cur ? (mv && mv.etaBusyEnd != null ? 'belegt bis ca. ' + esc(tclock(mv.etaBusyEnd, now)) : 'in Prüfung')
          : sameLot ? 'gleiches Los, danach'
          : e ? 'ca. ' + esc(tclock(e.start, now)) + '–' + esc(tclock(e.end, now))
          : r && r.cycleMin ? 'ca. ' + esc(U.fmtDur(c.qty * r.cycleMin * 60)) + ' Prüfzeit' : esc(c.id);
        const tip = `${c.id} · ${c.partName || ''}${r ? ' · AG ' + r.seq + ' ' + r.op : ''}${tr ? ' – unterwegs: ' + (tr.label || '') : e ? ` – Plan: Prüfung ${tclock(e.start, now)}–${tclock(e.end, now)}${e.opEnd > e.end + 600 ? ', Arbeitsgang fertig ca. ' + tclock(e.opEnd, now) : ''}` : ''}`;
        return `<div class="qa-ct${tr ? ' tr' : ''}${first ? ' nx' : ''}${cur ? ' cur' : ''}" style="--qa-cw:${cw}px" data-sel="${hasDetail('container') ? 'container|' + esc(c.id) : hasDetail('order') ? 'order|' + esc(c.orderId) : 'machine|QS'}" title="${esc(tip)}" tabindex="0" role="button" aria-label="${esc(tip)}">
          <b>${esc(c.orderId)}</b><span><em>${U.fmtNum(c.qty)} Stk</em> · ${esc(r ? r.op : c.partName || '')}</span><span>${when}</span></div>`;
      };
      // so viele Behälter, wie ganz hineinpassen – der Rest als „+N“ statt abgeschnittener Karten
      const arrowW = 16 + 12, moreW = 52 + 12;
      let fit = all.length;
      if (qw > 0) { fit = Math.max(1, Math.floor((qw + arrowW) / (cw + arrowW))); if (fit < all.length) fit = Math.max(1, Math.floor((qw + arrowW - moreW) / (cw + arrowW))); }
      const parts = [];
      all.slice(0, fit).forEach((x, i) => { if (i) parts.push(`<span class="qa-arrow" aria-hidden="true">${icon('arrowRight', 12)}</span>`); parts.push(chip(x)); });
      const rest = all.slice(fit);
      if (rest.length) parts.push(`<div class="qa-more" title="${esc(rest.map(x => `${x.c.orderId} (${x.c.qty} Stk${x.tr ? ', unterwegs' : ''})`).join(' · '))}">+${rest.length}<small>${rest.length === 1 ? 'Los' : 'Lose'}</small></div>`);
      R.labQ.innerHTML = parts.length ? parts.join('') : '<div class="qa-q-empty">Keine Prüflose in der Warteschlange – Behälter erscheinen hier, sobald sie am Messraum ankommen.</div>';
    }
    const fp = openFpis().filter(x => !x.local).sort((a, b) => b.waitingSec - a.waitingSec);
    setText(R.labSub, `${lab.items.length ? `${lab.items.length} ${lab.items.length === 1 ? 'Prüflos' : 'Prüflose'} in der Warteschlange` : 'Warteschlange leer'} · ${fp.length ? `${fp.length} ${fp.length === 1 ? 'Erstteil wartet' : 'Erstteile warten'}` : 'kein Erstteil offen'}`);
    const fsig = fp.map(x => x.mid + x.stage + Math.floor(x.waitingSec / 60)).join(',');
    if (sig.labF !== fsig && !held(R.labF)) {
      sig.labF = fsig;
      setText(R.labFn, fp.length ? String(fp.length) : '');
      const stg = WF.sim.LABELS.fpiStage || {};
      R.labF.innerHTML = fp.length ? fp.map(x => `<div class="qa-fp${x.stage !== 'measure' && x.waitingSec >= 600 ? ' warn' : ''}" data-sel="machine|${esc(x.mid)}" title="${esc(stg[x.stage] || x.stage)}" tabindex="0" role="button" aria-label="${esc(x.mid)}: Erstteil ${esc(stg[x.stage] || x.stage)}, ${esc(durMin(x.waitingSec))} – Maschine öffnen"><b>${esc(x.mid)}</b><span>${esc(stg[x.stage] || x.stage)}</span><em>${esc(durMin(x.waitingSec))}</em></div>`).join('')
        : `<div class="qa-empty">${icon('check', 15)}<span>Kein Erstteil wartet – alle Maschinen freigegeben.</span></div>`;
    }
  }

  // ---------------- SPC
  function buildOptions() {
    const Sx = S(), keys = Object.keys(Sx.measurements).filter(k => Sx.measurements[k].length);
    const osig = keys.length + '|' + keys.join(',');
    if (!selKey || !Sx.measurements[selKey]) { selKey = defaultKey(); sig.cap = ''; capRT = 0; }
    if (sig.opts === osig + selKey) {
      if (document.activeElement !== R.sel) for (const o of R.sel.options) { const arr = Sx.measurements[o.value]; if (!arr) continue; const t = o.textContent.replace(/\(\d+\)$/, '(' + arr.length + ')'); if (t !== o.textContent) o.textContent = t; }
      return;
    }
    sig.opts = osig + selKey;
    const byM = {};
    for (const k of keys) { const ki = keyInfo(k); (byM[ki.station || '–'] = byM[ki.station || '–'] || []).push(ki); }
    const order = P().machines.filter(id => byM[id]).concat(Object.keys(byM).filter(id => !P().machines.includes(id)));
    R.sel.innerHTML = order.map(mid => `<optgroup label="${esc(mLabel(mid))}">${byM[mid].sort((a, b) => (a.oid + a.seq).localeCompare(b.oid + b.seq)).map(ki => `<option value="${esc(ki.key)}"${ki.key === selKey ? ' selected' : ''}>${esc(ki.oid)} · AG ${ki.seq} · ${esc(ki.ch ? ki.ch.name : '–')} (${Sx.measurements[ki.key].length})</option>`).join('')}</optgroup>`).join('');
    R.sel.value = selKey || '';
  }
  let spcRT = 0;
  /** Achsenschritt aus 1-2-5 × 10^k (keine 2,5-Schritte: bei µm-Toleranzen fielen die Marken sonst zwischen ganze µm),
      gewählt nach der Markenzahl, die dem Ziel am nächsten kommt. */
  function niceStep(span, target) {
    const p0 = Math.pow(10, Math.floor(Math.log10(span / target)));
    let best = p0, bd = Infinity;
    for (const m of [0.5, 1, 2, 5, 10]) { const st = m * p0, n = span / st, d = Math.abs(n - target) + (n < 2.5 ? 2 : 0); if (d < bd) { bd = d; best = st; } }
    return best;
  }
  /** Nachkommastellen, die einen Schritt exakt darstellen (0,002 → 3; 0,0005 → 4) */
  const stepDec = (st) => { for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(st * 10 ** d) - st * 10 ** d) < 1e-6) return d; return 6; };
  function renderSpc(force) {
    if (!R.sel) return;
    buildOptions();
    if (!selKey) { R.chart.innerHTML = '<div class="empty">Noch keine Messwerte. Sobald ein Teil fertig ist, wird sein Hauptmerkmal hier eingetragen.</div>'; R.meta.innerHTML = ''; R.stats.innerHTML = ''; R.expl.innerHTML = ''; R.hint.innerHTML = ''; R.lg.innerHTML = ''; return; }
    const arr = S().measurements[selKey] || [];
    const spcN = (S().notifications || []).find(n => n.key === 'spc:' + selKey && n.status !== 'resolved');
    const csig = [selKey, winN, arr.length, arr.length ? arr[arr.length - 1].t : 0, chartW, spcN ? spcN.id + spcN.status + spcN.body : ''].join('|');
    if (!force && sig.chart === csig) return;
    if (!force && sig.chart && performance.now() - spcRT < 900 && sig.chart.split('|').slice(0, 2).join('|') === csig.split('|').slice(0, 2).join('|')) return;
    sig.chart = csig; spcRT = performance.now();
    const d = stats(selKey, winN || null);
    if (!d) return;
    const ki = d.ki, ch = d.ch, Sx = S(), now = Sx.t;
    // Kopfzeile
    const mid = ki.station;
    let mv = null; try { mv = mid && Sx.machines[mid] ? WF.sim.machineView(mid) : null; } catch (e) { mv = null; }
    const active = mv && mv.order && mv.order.id === ki.oid && mv.order.seq === ki.seq;
    const metaH = `<span><button class="link" data-sel="machine|${esc(mid)}">${esc(mLabel(mid))}</button></span>
      <span><b class="mono">${esc(ki.oid)}</b> ${esc(ki.o ? ki.o.part.name : '')} · AG ${ki.seq} ${esc(ki.r ? ki.r.op : '')}</span>
      <span>Merkmal <b>${esc(ch.name)}</b> · Soll ${esc(fv(ch.nominal, ch))} <span class="faint">${esc(fv(ch.tolMinus, ch, true))}/${esc(fv(ch.tolPlus, ch, true))}</span> ${esc(ch.unit)}</span>
      ${active ? `<span title="${esc(stateSrc(mid))}">${WF.ui.machinePill(mv)}${WF.connect && WF.connect.canShow && !WF.connect.canShow(mid, 'state') ? ' <span class="faint">laut Tablet</span>' : ''}</span>` : `<span class="faint">Arbeitsgang ${ki.o && ki.o.ops && ki.o.ops.find(x => x.seq === ki.seq && x.complete) ? 'abgeschlossen' : 'nicht aktiv'}</span>`}`;
    setHTML(R.meta, metaH);
    R.chart.innerHTML = chartSvg(d, Math.max(280, R.chart.clientWidth - 12));
    chartW = R.chart.clientWidth;
    const leg = (svg, t) => `<span>${svg}${t}</span>`;
    const lgH = [
      leg(`<svg width="18" height="8"><line x1="0" x2="18" y1="4" y2="4" style="stroke:var(--st-fault)" stroke-width="2"/></svg>`, 'USG / OSG (Toleranz)'),
      leg(`<svg width="18" height="8"><line x1="0" x2="18" y1="4" y2="4" style="stroke:var(--info)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`, 'UEG / OEG (±3σ)'),
      leg(`<svg width="18" height="8"><line x1="0" x2="18" y1="4" y2="4" style="stroke:var(--text2)" stroke-width="1.5"/></svg>`, 'Mittelwert x̄'),
      leg(`<svg width="10" height="10"><circle cx="5" cy="5" r="4" style="fill:var(--st-run)"/></svg>`, 'i.O.'),
      leg(`<svg width="10" height="10"><circle cx="5" cy="5" r="4" style="fill:var(--st-fault)"/></svg>`, 'n.i.O.'),
      leg(`<svg width="11" height="11"><rect x="2" y="2" width="7" height="7" transform="rotate(45 5.5 5.5)" style="fill:none;stroke:var(--text)" stroke-width="1.6"/></svg>`, 'Erstteil'),
      leg(`<svg width="10" height="12"><line x1="5" x2="5" y1="0" y2="12" style="stroke:var(--st-tool)" stroke-width="1.5"/></svg>`, 'Werkzeugwechsel'),
      leg(`<svg width="10" height="12"><line x1="5" x2="5" y1="0" y2="12" style="stroke:var(--st-setup)" stroke-width="1.5" stroke-dasharray="2 2"/></svg>`, 'Korrektur'),
    ].join('');
    setHTML(R.lg, lgH);
    // Kennwerte
    const cls = (c) => (c == null ? '' : c >= 1.33 ? 'ok' : c >= 1 ? 'warn' : 'crit');
    const stH = `
      <div><div class="l">Werte</div><div class="v">${U.fmtNum(d.N)}<small>Serie${d.pts.length - d.N ? ' +' + (d.pts.length - d.N) + ' EP' : ''}</small></div></div>
      <div><div class="l">Mittelwert</div><div class="v">${esc(fv(d.mean, ch))}</div></div>
      <div><div class="l">Streuung <span style="text-transform:none">σ</span></div><div class="v">${d.sigma != null ? esc(U.fmtNum(d.sigma, decOf(ch) + 1)) : '–'}</div></div>
      <div><div class="l">Cp</div><div class="v ${cls(d.cp)}">${d.cp != null ? U.fmtNum(d.cp, 2) : '–'}${d.cp != null && d.N < 30 ? '<small>vorläufig</small>' : ''}</div></div>
      <div><div class="l">Cpk</div><div class="v ${cls(d.cpk)}">${d.cpk != null ? U.fmtNum(d.cpk, 2) : '–'}${d.cpk != null && d.N < 30 ? '<small>vorläufig</small>' : ''}</div></div>
      <div><div class="l">n.i.O.</div><div class="v ${d.nok ? 'crit' : ''}">${U.fmtNum(d.nok)}<small>${d.pts.length ? U.fmtPct(d.nok / d.pts.length, 1) : ''}</small></div></div>`;
    setHTML(R.stats, stH);
    setHTML(R.expl, explain(d));
    setHTML(R.hint, hint(d, spcN, now));
  }
  function explain(d) {
    if (!d.enough) return `<span class="muted">Für Cp/Cpk werden mindestens 10 Serienwerte benötigt (aktuell ${d.N}).</span>`;
    const half = (d.usl - d.lsl) / 2, pos = (d.mean - d.center) / half, near = pos < 0 ? 'unteren' : 'oberen';
    const pp = Math.round(Math.abs(pos) * 100);
    let t;
    if (d.cpk >= 1.33) t = 'Prozess fähig – Streuung und Lage passen sicher in die Toleranz.';
    else if (Math.abs(pos) > 0.15 && d.cp >= 1.33) t = `Die Streuung passt, aber der Mittelwert liegt ${pp} % aus der Toleranzmitte Richtung ${near} Grenze.`;
    else if (Math.abs(pos) > 0.15) t = `Streuung knapp und Mittelwert ${pp} % aus der Toleranzmitte Richtung ${near} Grenze.`;
    else t = 'Lage nahezu mittig – die Streuung ist für diese Toleranz zu groß.';
    return `<b>Cpk ${U.fmtNum(d.cpk, 2)} · Cp ${U.fmtNum(d.cp, 2)}</b> (Ziel ≥ 1,33): ${t}${d.N < 30 ? ' <span class="muted">Vorläufig – erst ab ca. 30 Werten belastbar.</span>' : ''} <span class="faint">σ aus der gleitenden Spannweite der ${d.N} angezeigten Serienwerte, Erstteile ausgenommen.</span>`;
  }
  /** Korrekturvorschlag (Lage) – nur aus Werten nach der letzten Korrektur, nur für den laufenden Arbeitsgang */
  function fixOf(d, now) {
    const ch = d.ch, ki = d.ki, m = ki.station && S().machines[ki.station];
    const active = !!(m && m.op && m.op.oid === ki.oid && S().orders[ki.oid].routing[m.op.idx].seq === ki.seq);
    const half = (d.usl - d.lsl) / 2;
    const after = (S().measurements[ki.key] || []).filter(p => !p.fpi && p.t > d.since);
    const pending = d.since > 0 && after.length < 8 ? 8 - after.length : 0;
    const am = after.length >= 8 ? after.slice(-12).reduce((x, p) => x + p.v, 0) / Math.min(12, after.length) : null;
    const corr = am != null ? d.center - am : null;
    const step = Math.pow(10, -decOf(ch)), val = corr != null ? Math.round(corr / step) * step : 0;
    const can = active && !pending && corr != null && Math.abs(corr) > 0.15 * half && val !== 0;
    const centred = am != null && Math.abs(corr) <= 0.15 * half;
    return { active, pending, val, can, am, centred, html: can ? `<div class="acts"><button class="btn sm primary" data-fix="${esc(String(val))}">Korrektur ${esc(fv(val, ch, true))} ${esc(ch.unit)} an ${esc(ki.station)} übernehmen</button></div>` : '',
      note: pending ? `<br><span class="muted">Korrektur eingegeben ${esc(tclock(d.since, now))} – die Wirkung zeigt sich mit den nächsten ${pending} Teilen.</span>` : '' };
  }
  /** Heute gemeldete SPC-Trends dieses Merkmals (Benachrichtigungen der Engine) – damit „kein Trend“ nie falsch klingt */
  function trendsToday(key, now) {
    const list = (S().notifications || []).filter(x => x.key === 'spc:' + key && x.t >= today0(now));
    if (!list.length) return null;
    const offs = allEvents().filter(e => e.type === 'offset' && e.t >= today0(now) && e.data && e.data.orderId + '/' + e.data.seq === key);
    const lastOff = offs.length ? offs[offs.length - 1].t : null;
    return { n: list.length, txt: `Heute ${list.length} ${list.length === 1 ? 'SPC-Trend' : 'SPC-Trends'}${offs.length ? `, ${offs.length}× korrigiert (zuletzt ${tclock(lastOff, now)})` : ''}` };
  }
  function hint(d, n, now) {
    const ch = d.ch;
    const tt = trendsToday(d.ki.key, now);
    const acts = n && n.status === 'open' ? (n.actions || []).map((a, i) => `<button class="btn sm${i === 0 ? ' primary' : ''}" data-act="${i}" data-nid="${esc(n.id)}">${esc(a.label)}</button>`).join('') : '';
    if (n) {
      return `<div class="qa-hint">${icon('alert', 16)}<div><b>${esc(n.title)}</b><br>${esc(n.body || '')}${n.suggestion ? `<br><span class="muted">${esc(n.suggestion)}</span>` : ''}${n.status === 'ack' ? `<br><span class="faint">quittiert${n.ackBy ? ' von ' + esc(n.ackBy) : ''} – Korrektur wird an der Maschine eingegeben</span>` : ''}${acts ? `<div class="acts">${acts}</div>` : ''}</div></div>`;
    }
    const half = (d.usl - d.lsl) / 2;
    const lageLimited = d.enough && Math.abs(d.mean - d.center) > 0.15 * half && d.cp >= 1;
    const fx = d.enough ? fixOf(d, now) : { html: '', note: '', can: false };
    if (d.trend && d.trend.ratio > 0.4) {
      const lim = d.trend.side === 'upper' ? 'oberen' : 'unteren';
      return `<div class="qa-hint">${icon('alert', 16)}<div><b>Trend zur ${lim} Toleranzgrenze:</b> Mittelwert der letzten 8 Teile ${esc(fv(d.trend.mean, ch))} ${esc(ch.unit)} – ${Math.round(d.trend.ratio * 100)} % des Wegs zur ${d.trend.side === 'upper' ? 'OSG' : 'USG'} (${esc(fv(d.trend.side === 'upper' ? d.usl : d.lsl, ch))}). Ab 55 % meldet werkfluss den SPC-Trend an QS und Bediener${fx.can ? ' – mit einer Korrektur lässt sich das vorher abfangen' : ''}.${tt ? `<br><span class="muted">${esc(tt.txt)}.${tt.n >= 2 ? ' Der Trend kommt wieder: Korrekturintervall verkürzen oder den Werkzeugwechsel vorziehen.' : ''}</span>` : ''}${fx.note}${fx.html}</div></div>`;
    }
    const lastV = d.pts.length ? d.pts[d.pts.length - 1] : null;
    if (d.outCtl) return `<div class="qa-hint info">${icon('info', 16)}<div><b>Letzter Wert außerhalb der Eingriffsgrenzen</b> (±3σ)${lastV && lastV.ok ? ' – noch in Toleranz, aber ungewöhnlich' : ''}. Nächste Teile beobachten; bei Wiederholung Ursache an der Maschine prüfen.</div></div>`;
    if (d.run) return `<div class="qa-hint info">${icon('info', 16)}<div><b>7 Werte in Folge ${d.run}</b> – typisch für Werkzeugverschleiß. Noch kein Eingriff nötig, Lage beobachten.</div></div>`;
    if (!d.enough) return '';
    if (d.cpk < 1) {
      let txt;
      if (lageLimited) txt = fx.can ? `Hebel ist die Lage: Eine Werkzeugkorrektur von <b>${esc(fv(fx.val, ch, true))} ${esc(ch.unit)}</b> (aus den letzten Teilen) zentriert den Prozess.` : fx.pending ? 'Hebel ist die Lage – eine Korrektur wurde bereits eingegeben.' : fx.centred && d.since > 0 ? `Die Korrektur wirkt: Die letzten Teile liegen wieder mittig (Ø ${esc(fv(fx.am, ch))} ${esc(ch.unit)}). Cpk steigt, sobald die älteren Werte aus dem Fenster fallen.` : `Hebel ist die Lage: Mittelwert ${esc(fv(d.mean, ch))} statt Toleranzmitte ${esc(fv(d.center, ch))}${fx.active ? '' : ' – beim nächsten Rüsten Nullpunkt/Korrektur anpassen'}.`;
      else txt = 'Hebel ist die Streuung: Spannung, Schnittwerte und Werkzeugzustand prüfen oder Toleranz mit dem Kunden klären – eine Korrektur allein reicht nicht.';
      const rec = tt && tt.n >= 2 ? ' Weil der Trend heute wiederholt auftrat: Korrekturintervall verkürzen oder den Werkzeugwechsel vorziehen.' : '';
      return `<div class="qa-hint${d.cpk < 1 ? ' crit' : ''}">${icon('alert', 16)}<div><b>${d.N < 30 ? 'Vorläufig: ' : ''}Nicht fähig${tt ? '' : ', aber stabil'}.</b> ${txt}${tt ? `<br><span class="muted">${esc(tt.txt)}.${rec}</span>` : ''}${lageLimited ? fx.note + fx.html : ''}</div></div>`;
    }
    if (d.cpk < 1.33) return `<div class="qa-hint${tt ? '' : ' info'}">${icon(tt ? 'alert' : 'info', 16)}<div><b>Bedingt fähig.</b> ${tt ? `Aktuell kein Trend – ${esc(tt.txt)}.` : 'Kein Trend und keine Werte außerhalb der Eingriffsgrenzen'}; für Serienfreigabe wird Cpk ≥ 1,33 angestrebt.${lageLimited ? fx.note + fx.html : ''}</div></div>`;
    return `<div class="qa-hint ok">${icon('check', 16)}<div><b>Stabil und fähig.</b> ${tt ? `Aktuell kein Trend (${esc(tt.txt)})` : 'Kein Trend'}, keine Werte außerhalb der Eingriffsgrenzen${d.trend ? ` · Mittel der letzten 8 Teile ${Math.round(d.trend.ratio * 100)} % des Wegs zur ${d.trend.side === 'upper' ? 'OSG' : 'USG'}` : ''}.</div></div>`;
  }
  function chartSvg(d, W) {
    const small = W < 520;
    const pts = d.pts, ch = d.ch, n = pts.length;
    let lo = Math.min(d.lsl, d.lcl != null ? d.lcl : d.lsl), hi = Math.max(d.usl, d.ucl != null ? d.ucl : d.usl);
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    const padv = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; lo -= padv; hi += padv;
    // linker Rand nach der längsten Achsenbeschriftung (4 Nachkommastellen bei µm-Toleranzen)
    const decA = decOf(ch), lw = Math.max(U.fmtNum(lo, Math.max(decA, 3)).length, U.fmtNum(hi, Math.max(decA, 3)).length);
    const H = small ? 230 : 290, ml = Math.max(small ? 44 : 54, Math.round(lw * 6.2 + 14)), mr = small ? 44 : 54, mt = 16, mb = 26;
    const pw = W - ml - mr, ph = H - mt - mb;
    const Y = (v) => mt + (1 - (v - lo) / (hi - lo)) * ph;
    const step = n > 1 ? pw / (n - 1) : 0;
    const X = (i) => ml + (n > 1 ? i * step : pw / 2);
    const dec = decOf(ch);
    let g = '';
    // Raster + Achse links (nur saubere Werte)
    // Marken auf ganzen Schritten (ganzzahlig gezählt – keine Rundungsdrift), so viele Stellen wie das Merkmal (Soll 8,0000 → 4)
    const st0 = niceStep(hi - lo, small ? 4 : 5);
    const tdec = Math.min(6, Math.max(dec, stepDec(st0)));
    for (let k = Math.ceil(lo / st0 - 1e-9), kEnd = Math.floor(hi / st0 + 1e-9); k <= kEnd; k++) {
      const v = k * st0, y = Y(v);
      g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="tk" x="${ml - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(U.fmtNum(v, tdec))}</text>`;
    }
    // Toleranzband
    g += `<rect x="${ml}" y="${Y(d.usl).toFixed(1)}" width="${pw}" height="${Math.max(0, Y(d.lsl) - Y(d.usl)).toFixed(1)}" style="fill:color-mix(in srgb,var(--st-run) 5%,transparent)"/>`;
    // Trendfenster (letzte 8)
    if (d.trend && d.trend.ratio > 0.4) {
      const i0 = pts.findIndex(p => p.t >= d.trend.from);
      if (i0 >= 0) g += `<rect x="${(X(i0) - Math.max(3, step / 2)).toFixed(1)}" y="${mt}" width="${(X(n - 1) - X(i0) + Math.max(6, step)).toFixed(1)}" height="${ph}" rx="4" style="fill:color-mix(in srgb,var(--st-wait) 9%,transparent)"/>`;
    }
    // Marker Werkzeugwechsel / Korrektur
    if (n > 1) {
      const t0 = pts[0].t, t1 = pts[n - 1].t;
      const evs = allEvents().filter(e => e.t > t0 && e.t <= t1 && ((e.type === 'toolChanged' && e.entity && e.entity.id === d.ki.station) || (e.type === 'offset' && e.data && e.data.orderId === d.ki.oid && e.data.seq === d.ki.seq)));
      let lastX = -99;
      for (const e of evs) {
        const i = pts.findIndex(p => p.t >= e.t); if (i <= 0) continue;
        const x = (X(i - 1) + X(i)) / 2, tc = e.type === 'toolChanged';
        const names = tc && e.data && e.data.tools ? e.data.tools.map(t => t.name).join(', ') : '';
        g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${mt}" y2="${mt + ph}" style="stroke:${tc ? 'var(--st-tool)' : 'var(--st-setup)'}" stroke-width="1.5"${tc ? '' : ' stroke-dasharray="3 3"'} opacity=".85"><title>${esc(U.fmtDayClock(e.t))} ${tc ? 'Werkzeugwechsel: ' + esc(names) : esc(e.msg)}</title></line>`;
        if (x - lastX > 26) { g += `<text x="${x.toFixed(1)}" y="${mt - 4}" text-anchor="middle" class="lb" style="fill:${tc ? 'var(--st-tool)' : 'var(--st-setup)'}">${tc ? 'WZ' : 'Korr.'}</text>`; lastX = x; }
      }
    }
    // Grenzlinien
    const lines = [
      { v: d.usl, l: 'OSG', s: 'stroke:var(--st-fault)', w: 1.6, da: '' },
      { v: d.lsl, l: 'USG', s: 'stroke:var(--st-fault)', w: 1.6, da: '' },
      { v: d.center, l: 'Mitte', s: 'stroke:var(--faint)', w: 1, da: '1 3' },
    ];
    if (d.ucl != null && d.enough) { lines.push({ v: d.ucl, l: 'OEG', s: 'stroke:var(--info)', w: 1.3, da: '5 4' }); lines.push({ v: d.lcl, l: 'UEG', s: 'stroke:var(--info)', w: 1.3, da: '5 4' }); }
    if (d.mean != null) lines.push({ v: d.mean, l: 'x̄', s: 'stroke:var(--text2)', w: 1.3, da: '' });
    for (const L of lines) {
      const y = Y(L.v);
      if (y < mt - 1 || y > mt + ph + 1) continue;
      g += `<line x1="${ml}" x2="${ml + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" style="${L.s}" stroke-width="${L.w}"${L.da ? ` stroke-dasharray="${L.da}"` : ''}/>`;
    }
    // rechte Beschriftung mit Kollisionsvermeidung
    const labs = lines.map(L => ({ y: Y(L.v), l: L.l, c: L.s.replace('stroke:', ''), v: L.v })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 11) labs[i].y = labs[i - 1].y + 11;
    for (let i = labs.length - 2; i >= 0; i--) if (labs[i].y > labs[i + 1].y - 11) labs[i].y = labs[i + 1].y - 11;
    for (const L of labs) g += `<text x="${ml + pw + 12}" y="${(L.y + 3.5).toFixed(1)}" class="lb" style="fill:${L.c === 'var(--faint)' ? 'var(--muted)' : L.c}"><title>${esc(L.l)} ${esc(fv(L.v, ch))} ${esc(ch.unit)}</title>${esc(L.l)}</text>`;
    // Verbindungslinie
    if (n > 1) g += `<polyline points="${pts.map((p, i) => X(i).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ')}" style="fill:none;stroke:var(--text2)" stroke-width="1.2" stroke-linejoin="round" opacity=".45"/>`;
    // Punkte
    const r = n > 90 ? 2.6 : n > 45 ? 3.4 : 4;
    pts.forEach((p, i) => {
      const x = X(i).toFixed(1), y = Y(p.v).toFixed(1), c = p.ok ? 'var(--st-run)' : 'var(--st-fault)';
      if (p.fpi) g += `<rect x="${(X(i) - r - 1).toFixed(1)}" y="${(Y(p.v) - r - 1).toFixed(1)}" width="${(2 * r + 2).toFixed(1)}" height="${(2 * r + 2).toFixed(1)}" transform="rotate(45 ${x} ${y})" style="fill:${c};stroke:var(--text)" stroke-width="1.5"/>`;
      else g += `<circle cx="${x}" cy="${y}" r="${r}" style="fill:${c};stroke:var(--card)" stroke-width="${n > 90 ? 1 : 2}"/>`;
    });
    // letzter Wert betont
    if (n) { const p = pts[n - 1]; g += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${r + 3.5}" style="fill:none;stroke:${p.ok ? 'var(--st-run)' : 'var(--st-fault)'}" stroke-width="1.5" opacity=".7"/>`; }
    // x-Achse: Uhrzeiten
    const nt = small ? 3 : 6;
    if (n > 1) {
      let lastLx = -99;
      for (let k = 0; k < nt; k++) {
        const i = Math.round(k * (n - 1) / (nt - 1)), x = X(i);
        if (x - lastLx < 50) continue; lastLx = x;
        g += `<text class="tk" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${k === 0 ? 'start' : k === nt - 1 ? 'end' : 'middle'}">${esc(tclock(pts[i].t, S().t))}</text>`;
      }
    }
    g += `<line x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}" style="stroke:var(--line2)" stroke-width="1"/>`;
    g += `<g data-cross></g><rect class="hit" x="${ml - 6}" y="${mt}" width="${pw + 12}" height="${ph}"/>`;
    chartModel = { X, Y, n, pts, ml, pw, mt, ph, step, d, W, H };
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Regelkarte ${esc(ch.name)}">${g}</svg>`;
  }
  function onChartMove(e) {
    const m = chartModel; if (!m || !m.n) return;
    const svg = R.chart.querySelector('svg'); if (!svg) return;
    const rc = svg.getBoundingClientRect();
    const sx = (e.clientX - rc.left) * (m.W / rc.width);
    if (sx < m.ml - 8 || sx > m.ml + m.pw + 8) { hideTip(); return; }
    const i = m.n > 1 ? U.clamp(Math.round((sx - m.ml) / m.step), 0, m.n - 1) : 0;
    const p = m.pts[i], ch = m.d.ch;
    const cross = svg.querySelector('[data-cross]');
    const x = m.X(i), y = m.Y(p.v);
    cross.innerHTML = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.mt}" y2="${m.mt + m.ph}" style="stroke:var(--muted)" stroke-width="1" opacity=".6"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" style="fill:none;stroke:var(--text)" stroke-width="1.5"/>`;
    const dev = p.v - ch.nominal;
    tipEl.innerHTML = `<b>Teil ${esc(p.partNo != null ? p.partNo : '–')}${p.fpi ? ' · Erstteil' : ''}</b> · ${esc(U.fmtDayClock(p.t))}<br>${esc(ch.name)}: <b>${esc(fv(p.v, ch))} ${esc(ch.unit)}</b> (${esc(fv(dev, ch, true))} zum Soll)<br><span style="color:${p.ok ? 'var(--st-run)' : 'var(--st-fault)'}">${p.ok ? 'i.O.' : 'n.i.O. – außerhalb ' + esc(fv(m.d.lsl, ch)) + ' … ' + esc(fv(m.d.usl, ch))}</span>`;
    tipEl.hidden = false;
    const tx = rc.left + x * (rc.width / m.W), ty = rc.top + y * (rc.height / m.H);
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = tx + 14, top = ty - th - 10;
    if (left + tw > window.innerWidth - 8) left = tx - tw - 14;
    if (top < 8) top = ty + 14;
    tipEl.style.left = Math.max(8, left) + 'px'; tipEl.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; const c = R.chart && R.chart.querySelector('[data-cross]'); if (c) c.innerHTML = ''; }

  // ---------------- Ausschuss
  function scrapToday(now) {
    const d0 = today0(now), list = allEvents().filter(e => e.type === 'scrap' && e.t >= d0);
    const byR = {}, byM = {};
    let eur = 0;
    for (const e of list) {
      const dt = e.data || {}, q = dt.qty || 1, c = unitCost(dt.orderId, dt.seq), v = c ? c.total * q : 0;
      eur += v;
      const r = byR[dt.reason] || (byR[dt.reason] = { n: 0, eur: 0 }); r.n += q; r.eur += v;
      const mid = e.entity ? e.entity.id : '–';
      const m = byM[mid] || (byM[mid] = { n: 0, eur: 0, reasons: {} }); m.n += q; m.eur += v; m.reasons[dt.reason] = (m.reasons[dt.reason] || 0) + q;
    }
    return { list, byR, byM, eur };
  }
  function bars(rows, empty) {
    if (!rows.length) return `<div class="qa-empty">${icon('check', 15)}<span>${esc(empty)}</span></div>`;
    const max = Math.max(1, ...rows.map(r => r.n));
    return `<div class="qa-bars">${rows.map(r => `<div class="qa-br${r.sel ? ' click' : ''}" ${r.sel ? `data-sel="${esc(r.sel)}" tabindex="0" role="button" aria-label="${esc(r.label)}: ${esc(r.n)} Stk Ausschuss – öffnen"` : ''} title="${esc(r.tip || '')}">
      <span class="qa-l">${esc(r.label)}</span><span class="qa-tr">${r.n ? `<i style="width:${(Math.max(0.02, r.n / max) * 100).toFixed(1)}%"></i>` : ''}</span>
      <span class="qa-v">${U.fmtNum(r.n)}<small>Stk</small></span><span class="qa-m">${r.n ? '≈ ' + U.fmtEur(r.eur) : '–'}</span></div>`).join('')}</div>`;
  }
  function renderScrap(now) {
    const k = WF.sim.kpis(), sc = scrapToday(now);
    const ssig = sc.list.length + '|' + JSON.stringify(k.scrapBy);
    if (sig.scrap === ssig) return;
    sig.scrap = ssig;
    setText(R.scrapSub, k.scrap ? `${U.fmtNum(k.scrap)} Stk · ≈ ${U.fmtEur(sc.eur)}` : '');
    // nach Ursache: Stückzahl aus den Engine-Kennzahlen (eine Wahrheit), € aus den Ereignissen
    const reasons = SCRAP_REASONS.concat(Object.keys(k.scrapBy).filter(r => !SCRAP_REASONS.includes(r)));
    R.byReason.innerHTML = k.scrap ? bars(reasons.map(r => ({ label: r, n: k.scrapBy[r] || 0, eur: (sc.byR[r] || {}).eur || 0, tip: REASON_TXT[r] || r }))) : bars([], 'Heute noch kein Ausschuss – alle Teile innerhalb der Toleranz.');
    const ms = Object.entries(sc.byM).sort((a, b) => b[1].n - a[1].n || b[1].eur - a[1].eur);
    R.byMachine.innerHTML = bars(ms.map(([mid, v]) => ({ label: mLabel(mid), n: v.n, eur: v.eur, sel: 'machine|' + mid, tip: Object.entries(v.reasons).map(([r, q]) => r + ': ' + q + ' Stk').join(' · ') })), 'Keine Maschine mit Ausschuss heute.');
  }

  // ---------------- Erstteilprüfungen
  function fpiRecords(now) {
    const evs = allEvents().filter(e => e.type === 'fpiReady' || e.type === 'fpiOk' || e.type === 'fpiNok');
    const open = {}, recs = [];
    for (const e of evs) {
      const mid = e.entity && e.entity.id, dt = e.data || {};
      if (e.type === 'fpiReady') { const r = { mid, orderId: dt.orderId, seq: dt.seq, local: !!dt.local, ready: e.t, res: null }; open[mid] = r; recs.push(r); continue; }
      let r = open[mid];
      if (!r || r.orderId !== dt.orderId || r.seq !== dt.seq) { r = { mid, orderId: dt.orderId, seq: dt.seq, local: !!dt.local, ready: null }; recs.push(r); }
      r.res = e; r.value = dt.value; r.ok = e.type === 'fpiOk'; r.rework = !!dt.rework; r.last = !!dt.last;
      const by = /durch ([^–(]+?)\s*$/.exec(e.msg || ''); r.by = by ? by[1].trim() : null;
      delete open[mid];
    }
    const d0 = today0(now);
    const cur = {}; for (const f of openFpis()) cur[f.mid] = f;
    return recs.filter(r => (r.res ? r.res.t : r.ready) >= d0 || (!r.res && cur[r.mid])).map(r => {
      if (!r.res) { const f = cur[r.mid]; r.stage = f ? f.stage : null; r.by = f && f.by && S().people[f.by] ? shortName(S().people[f.by].name) : null; }
      return r;
    }).filter(r => r.res || r.stage).sort((a, b) => (b.res ? 0 : 1) - (a.res ? 0 : 1) || (b.ready || (b.res && b.res.t) || 0) - (a.ready || (a.res && a.res.t) || 0));
  }
  /** Nächste Erstteile laut Plan: Arbeitsgänge mit Erstteilprüfung, deren Rüsten noch bevorsteht (forecast().machines) */
  let upCache = { k: -1, list: [] };
  function upcomingFpis(now) {
    const k = Math.floor(now / 60);
    if (upCache.k === k) return upCache.list;
    let fc = null; try { fc = WF.sim.forecast(); } catch (e) { fc = null; }
    const Sx = S(), out = [];
    for (const mid of P().machines) {
      for (const e of (fc && fc.machines && fc.machines[mid]) || []) {
        const o = Sx.orders[e.orderId], r = o && o.routing.find(x => x.seq === e.seq);
        if (!r || !r.firstPiece) continue;
        const t = e.setupEnd != null ? e.setupEnd : e.start;
        if (t == null || t < now) continue;
        out.push({ mid, orderId: e.orderId, seq: e.seq, op: r.op, t, setupMin: r.setupMin || 0 });
      }
    }
    upCache = { k, list: out.sort((a, b) => a.t - b.t).slice(0, 3) };
    return upCache.list;
  }
  function renderUpcoming(now) {
    if (held(R.fpiUp) && sig.up) return;
    const list = upcomingFpis(now);
    const usig = list.map(x => x.mid + x.orderId + x.seq + Math.floor(x.t / 60)).join(',');
    if (sig.up === usig) return;
    sig.up = usig;
    R.fpiUp.innerHTML = `<div class="qa-up-h"><span class="eyebrow">Nächste Erstteile laut Plan</span><span class="muted">nach dem Rüsten</span></div>` + (list.length
      ? list.map(x => `<div class="qa-up-r" data-sel="machine|${esc(x.mid)}" tabindex="0" role="button" title="${esc(mLabel(x.mid))} · ${esc(x.orderId)} AG ${esc(x.seq)} ${esc(x.op)} – Rüsten ca. ${esc(U.fmtDur(x.setupMin * 60))}, danach Erstteilprüfung">
          <b>${esc(x.mid)}</b><span class="nm">${esc(st(x.mid) ? st(x.mid).short : '')}</span><span class="o">${esc(x.orderId)} · AG ${esc(x.seq)}</span><span class="t">ca. ${esc(tclock(x.t, now))}</span></div>`).join('')
      : '<div class="qa-up-e">Kein weiteres Rüsten mit Erstteilprüfung geplant.</div>');
  }
  function renderFpi(now) {
    renderUpcoming(now);
    if (held(R.fpi) && sig.fpi) return;
    const recs = fpiRecords(now);
    const fsig = recs.map(r => r.mid + (r.ready || '') + (r.res ? r.res.id : r.stage) + (r.res ? '' : Math.floor((now - (r.ready || now)) / 60))).join(',');
    if (sig.fpi === fsig) return;
    sig.fpi = fsig;
    const k = WF.sim.kpis(), openN = recs.filter(r => !r.res).length;
    setText(R.fpiSub, `heute ${U.fmtNum(k.fpiOk)} i.O. · ${U.fmtNum(k.fpiNok)} n.i.O.${openN ? ` · ${openN} offen` : ''}`);
    const stg = WF.sim.LABELS.fpiStage || {};
    if (!recs.length) { R.fpi.innerHTML = '<div class="empty">Heute noch keine Erstteilprüfung. Nach jedem Rüsten wird das erste Teil hier mit Ergebnis und Wartezeit bis zur Freigabe eingetragen.</div>'; return; }
    R.fpi.innerHTML = `<table class="tbl qa-tbl qa-fpit"><thead><tr><th class="hm">Erstteil fertig</th><th>Maschine · Auftrag</th><th>Ergebnis</th><th class="hm">Geprüft von</th><th class="r hm">Messwert</th><th class="r">Bis Freigabe</th></tr></thead><tbody>${recs.map(r => {
      const ki = r.orderId ? keyInfo(r.orderId + '/' + r.seq) : null, ch = ki && ki.ch;
      let res, sub;
      if (!r.res) { res = `<span class="qa-res ${r.stage === 'measure' ? 'open' : 'wait'}"><i></i>${esc(r.stage === 'measure' ? 'wird gemessen' : 'offen')}</span>`; sub = stg[r.stage] || ''; }
      else if (r.ok) { res = `<span class="qa-res"><i></i>i.O. · freigegeben</span>`; sub = r.local ? 'Kontrolle an der Maschine' : 'Messraum (KMG)'; }
      else { res = `<span class="qa-res ${r.rework ? 'rw' : 'nok'}"><i></i>${r.rework ? 'n.i.O. · Nacharbeit' : 'n.i.O. · Ausschuss'}</span>`; sub = r.rework ? 'Nebenmerkmal – Korrektur, erneute Prüfung' : r.last ? 'letztes Teil – Nachfertigung nötig' : 'Korrektur, danach neues Erstteil'; }
      const dur = r.ready != null ? ((r.res ? r.res.t : now) - r.ready) : null;
      const late = !r.res && dur != null && dur >= 600 && r.stage !== 'measure';
      return `<tr class="click" data-sel="machine|${esc(r.mid)}" tabindex="0" aria-label="${esc(r.mid)} · ${esc(r.orderId || '')} AG ${esc(r.seq)} – Maschine öffnen"><td class="mono hm">${r.ready != null ? esc(tclock(r.ready, now)) : '–'}<span class="sub">${r.local ? 'nach Werkzeugwechsel' : 'nach Rüsten'}</span></td>
        <td><b>${esc(r.mid)}</b> <span class="muted">${esc(st(r.mid) ? st(r.mid).short : '')}</span><span class="sub mono">${esc(r.orderId || '–')} · AG ${esc(r.seq)}<span class="qa-mo"> · ${r.ready != null ? esc(tclock(r.ready, now)) : ''}</span></span></td>
        <td>${res}<span class="sub">${esc(sub)}</span></td>
        <td class="hm">${esc(r.by || '–')}</td>
        <td class="r mono hm">${r.value != null && ch ? esc(fv(r.value, ch)) + ' <span class="faint">' + esc(ch.unit) + '</span>' : '–'}<span class="sub">${ch ? esc(ch.name) : ''}</span></td>
        <td class="r">${dur != null ? `<b class="${late ? 'qa-late' : ''}">${esc(durMin(dur))}</b>` : '–'}<span class="sub">${!r.res ? (late ? 'Maschine wartet' : 'läuft') : r.ok ? 'Serie läuft' : ''}</span></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  // ---------------- Sperrlager
  function renderSperr(now) {
    if (held(R.sperr) && sig.sperr) return;
    const Sx = S();
    const list = Object.values(Sx.containers).filter(c => c.kind === 'scrap' || c.state === 'scrap').sort((a, b) => b.createdT - a.createdT);
    const ssig = list.map(c => c.id + ':' + c.qty + c.lastReason).join(',');
    if (sig.sperr === ssig) return;
    sig.sperr = ssig;
    let tq = 0, te = 0;
    // Gründe je Behälter aus den Ausschuss-Ereignissen (Behälter sammelt je Auftrag)
    const reasons = {};
    for (const e of allEvents()) if (e.type === 'scrap' && e.data) { const r = reasons[e.data.orderId] || (reasons[e.data.orderId] = {}); r[e.data.reason] = (r[e.data.reason] || 0) + (e.data.qty || 1); }
    const rows = list.map(c => {
      const o = Sx.orders[c.orderId];
      const seq = c.srcSeq != null ? c.srcSeq : (o ? o.routing[Math.max(0, c.src)].seq : 0);
      const cost = unitCost(c.orderId, seq);
      const v = cost ? cost.total * c.qty : 0; tq += c.qty; te += v;
      const sel = hasDetail('container') ? 'container|' + c.id : hasDetail('order') ? 'order|' + c.orderId : '';
      const rs = reasons[c.orderId] ? Object.entries(reasons[c.orderId]).map(([r, q]) => `${r} ${q}`).join(' · ') : (c.lastReason || '');
      return `<div class="qa-sp${sel ? ' click' : ''}" ${sel ? `data-sel="${esc(sel)}" tabindex="0" role="button"` : ''} title="${esc(c.id)} · ${esc(c.partName || '')} · AG ${esc(seq)}">
        <div class="a"><b>${esc(c.orderId)}</b><span>${esc(c.partName || '')}</span><span class="r">${esc(rs)} · seit ${esc(tclock(c.createdT, now))}</span></div>
        <div class="b"><b>${U.fmtNum(c.qty)} Stk</b><span>${v ? '≈ ' + esc(U.fmtEur(v)) : '–'}</span><span class="r">${esc(c.id)}</span></div></div>`;
    });
    setText(R.sperrSub, list.length ? `${list.length} Behälter · ${U.fmtNum(tq)} Stk · ≈ ${U.fmtEur(te)}` : '');
    R.sperr.innerHTML = list.length ? `<div class="qa-sps">${rows.join('')}</div>` : '<div class="empty">Sperrlager leer – kein Ausschuss in Quarantäne.</div>';
  }

  // ---------------- Messprotokoll
  function gauge(v, ch) {
    const lsl = ch.nominal + ch.tolMinus, usl = ch.nominal + ch.tolPlus, w = 96, h = 14, pad = 6;
    const span = usl - lsl || 1, f = (v - lsl) / span;
    const x = pad + U.clamp(f, -0.08, 1.08) * (w - 2 * pad);
    const ok = v >= lsl - 1e-12 && v <= usl + 1e-12;
    const mid = pad + 0.5 * (w - 2 * pad);
    return `<svg class="qa-gauge" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect x="${pad}" y="5" width="${w - 2 * pad}" height="4" rx="2" style="fill:var(--track)"/>
      <rect x="${pad}" y="5" width="${(w - 2 * pad) * 0.15}" height="4" rx="2" style="fill:color-mix(in srgb,var(--st-wait) 35%,transparent)"/><rect x="${pad + (w - 2 * pad) * 0.85}" y="5" width="${(w - 2 * pad) * 0.15}" height="4" rx="2" style="fill:color-mix(in srgb,var(--st-wait) 35%,transparent)"/>
      <line x1="${mid}" x2="${mid}" y1="3" y2="11" style="stroke:var(--faint)" stroke-width="1"/>
      <line x1="${pad}" x2="${pad}" y1="2" y2="12" style="stroke:var(--st-fault)" stroke-width="1.2"/><line x1="${w - pad}" x2="${w - pad}" y1="2" y2="12" style="stroke:var(--st-fault)" stroke-width="1.2"/>
      <circle cx="${x.toFixed(1)}" cy="7" r="3.6" style="fill:${ok ? 'var(--st-run)' : 'var(--st-fault)'};stroke:var(--card)" stroke-width="1.5"/></svg>`;
  }
  let logRT = 0;
  function renderLog(force) {
    if (!force && ((performance.now() - logRT < 1200 && sig.log) || held(R.log))) return;
    const Sx = S(), now = Sx.t, keys = Object.keys(Sx.measurements);
    let total = 0, lastT = 0;
    for (const k of keys) { const a = Sx.measurements[k]; total += a.length; if (a.length && a[a.length - 1].t > lastT) lastT = a[a.length - 1].t; }
    const lsig = logFilter + '|' + total + '|' + lastT + '|' + selKey;
    if (sig.log === lsig) return;
    sig.log = lsig; logRT = performance.now();
    let rows = [];
    for (const k of keys) {
      const a = Sx.measurements[k];
      const src = logFilter === 'nok' ? a.filter(x => !x.ok) : logFilter === 'fpi' ? a.filter(x => x.fpi) : a.slice(-40);
      for (const m of src) rows.push({ k, m });
    }
    rows.sort((a, b) => b.m.t - a.m.t || (b.m.partNo || 0) - (a.m.partNo || 0));
    rows = rows.slice(0, 40);
    setText(R.logSub, `${U.fmtNum(total)} Messwerte gespeichert · ${keys.length} Merkmale`);
    if (!rows.length) { R.log.innerHTML = `<div class="empty">${logFilter === 'nok' ? 'Keine n.i.O.-Messwerte im Speicher.' : logFilter === 'fpi' ? 'Noch keine Erstteil-Messwerte.' : 'Noch keine Messwerte.'}</div>`; return; }
    const info = {};
    keepFocus(R.log, () => { R.log.innerHTML = `<table class="tbl qa-tbl"><thead><tr><th>Zeit</th><th class="hm">Maschine</th><th>Auftrag · AG</th><th class="hm">Merkmal</th><th class="r hm">Teil</th><th class="r">Messwert</th><th class="hm">Lage in Toleranz</th><th>Ergebnis</th></tr></thead><tbody>${rows.map(({ k, m }) => {
      const ki = info[k] || (info[k] = keyInfo(k)), ch = ki.ch; if (!ch) return '';
      return `<tr class="click${m.ok ? '' : ' nok'}${k === selKey ? ' cur' : ''}" data-sel="char|${esc(k)}" tabindex="0" title="In der Regelkarte anzeigen" aria-label="${esc(tclock(m.t, now))} ${esc(ki.oid)} AG ${ki.seq} ${esc(ch.name)} ${esc(fv(m.v, ch))} ${esc(ch.unit)} – in der Regelkarte anzeigen"><td class="mono">${esc(tclock(m.t, now))}</td>
        <td class="hm">${esc(ki.station || '–')}<span class="sub">${esc(st(ki.station) ? st(ki.station).short : '')}</span></td>
        <td class="mono">${esc(ki.oid)}<span class="sub">AG ${ki.seq}<span class="qa-mo"> · ${esc(ki.station || '')}${m.fpi ? ' · Erstteil' : ''}</span></span></td>
        <td class="hm">${esc(ch.name)}<span class="sub">Soll ${esc(fv(ch.nominal, ch))} ${esc(fv(ch.tolMinus, ch, true))}/${esc(fv(ch.tolPlus, ch, true))}</span></td>
        <td class="r mono hm">${esc(m.partNo != null ? m.partNo : '–')}${m.fpi ? '<span class="sub">Erstteil</span>' : ''}</td>
        <td class="r mono">${esc(fv(m.v, ch))}<span class="sub">${esc(ch.unit)}</span></td>
        <td class="hm">${gauge(m.v, ch)}</td>
        <td><span class="qa-res ${m.ok ? '' : 'nok'}"><i></i>${m.ok ? 'i.O.' : 'n.i.O.'}</span></td></tr>`;
    }).join('')}</tbody></table>`; });
  }

  // ---------------- Prozessfähigkeit je Merkmal
  let capRT = 0, capInfo = { n: 0, low: 0, worst: null, min: null };
  function renderCap(now, force) {
    if (!force && ((performance.now() - capRT < 3000 && sig.cap) || held(R.cap))) return;
    const Sx = S(), rows = [];
    let total = 0;
    for (const k of Object.keys(Sx.measurements)) {
      const arr = Sx.measurements[k]; if (!arr.length) continue;
      const ki = keyInfo(k);
      const m = ki.station && Sx.machines[ki.station];
      const active = !!(m && m.op && m.op.oid === ki.oid && Sx.orders[ki.oid].routing[m.op.idx].seq === ki.seq);
      const recent = now - arr[arr.length - 1].t <= 4 * 3600;
      if (!active && !recent) continue;
      const d = stats(k, 60);
      if (!d || !d.enough || d.N < 20) continue;
      total++;
      rows.push({ k, ki, d, active });
    }
    const csig = rows.map(r => r.k + ':' + r.d.N + ':' + (r.d.cpk != null ? r.d.cpk.toFixed(2) : '-')).join(',') + '|' + selKey;
    capRT = performance.now();
    if (sig.cap === csig) return;
    sig.cap = csig;
    rows.sort((a, b) => a.d.cpk - b.d.cpk);
    capInfo = { n: rows.length, low: rows.filter(r => r.d.cpk < 1.33).length, worst: (rows.find(r => r.active) || rows[0] || {}).k || null,
      min: rows[0] ? { k: rows[0].k, cpk: rows[0].d.cpk, station: rows[0].ki.station || '–', name: rows[0].ki.ch ? rows[0].ki.ch.name : '–' } : null };
    const shown = rows.slice(0, 7), rest = rows.slice(7);
    const capable = rows.filter(r => r.d.cpk >= 1.33).length;
    setText(R.capSub, rows.length ? `${capable} von ${rows.length} fähig (Cpk ≥ 1,33)` : '');
    const X = (v) => (U.clamp(v, 0, 2) / 2 * 100).toFixed(1);
    keepFocus(R.cap, () => { R.cap.innerHTML = shown.length ? shown.map(r => {
      const c = r.d.cpk, col = c >= 1.33 ? 'var(--st-run)' : c >= 1 ? 'var(--st-wait)' : 'var(--st-fault)';
      return `<div class="qa-cr${r.k === selKey ? ' on' : ''}" data-sel="char|${esc(r.k)}" tabindex="0" role="button" aria-pressed="${r.k === selKey}" title="${esc(charLabel(r.k))} – Cp ${U.fmtNum(r.d.cp, 2)} · Cpk ${U.fmtNum(c, 2)} aus ${r.d.N} Werten">
        <div class="n"><b>${esc(r.ki.station || '–')} · ${esc(r.ki.ch.name)}</b><span>${esc(r.ki.oid)} · AG ${r.ki.seq}${r.active ? ' · <em>läuft</em>' : ''}</span></div>
        <div class="g"><span class="tr"><i style="width:${X(c)}%;background:${col}"></i><b style="left:50%"></b><b style="left:66.5%"></b></span></div>
        <div class="v" style="color:${col}">${U.fmtNum(c, 2)}</div></div>`;
    }).join('') + `<div class="qa-cap-ax"><span style="left:50%;transform:translateX(calc(-100% - 3px))">1,0</span><span style="left:66.5%;transform:translateX(3px)">1,33 Ziel</span></div>${rest.length ? `<div class="qa-cap-more">+ ${rest.length} weitere Merkmale${rest.every(r => r.d.cpk >= 1.33) ? ', alle fähig' : ''}</div>` : ''}`
      : '<div class="empty">Noch zu wenige Messwerte (mind. 10 je Merkmal).</div>'; });
  }

  function update() {
    if (!root || !WF.sim || !S()) return;
    const now = S().t;
    renderCap(now);
    updateKpis(now);
    renderLab(now);
    renderSpc(false);
    renderScrap(now);
    renderFpi(now);
    renderSperr(now);
    renderLog();
  }

  WF.registerView({ id: 'qualitaet', title: 'Qualität', icon: 'shield', group: 'ressourcen', order: 7, mount, update,
    show(params) { if (params && params.char && S() && S().measurements[params.char]) { selKey = params.char; userPicked = true; sig.chart = ''; sig.opts = ''; } },
    hide() { hideTip(); },
    badge() { const Sx = S(); if (!Sx) return ''; const n = (Sx.notifications || []).filter(x => x.status === 'open' && x.key && x.key.startsWith('spc:')).length; return n ? String(n) : ''; } });

  WF.quality = { stats, unitCost, charLabel, select: (key) => { if (!root) { selKey = key; userPicked = true; return; } selectKey(key); } };
})();
