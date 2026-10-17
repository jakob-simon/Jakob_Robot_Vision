/* werkfluss – Ansicht „Analyse“: Wo verliert die Fertigung heute Zeit und Geld?
   Verlust-Pareto in Euro (Maschinenstundensatz × nicht produktive Planbelegungszeit), Verlustmatrix
   Maschine × Ursache, OEE je Maschine (V × L × Q), Ausstoß- und Leistungsverlauf, Energie je Maschine,
   abgeleitete Handlungsempfehlungen. Alle Werte aus der Engine (kd = heute, ks = laufende Schicht). */
(function () {
  const WF = window.WF;
  const { el, esc, icon, css } = WF.ui;
  const U = WF.util;

  css(`
  .an-grid{display:grid;gap:14px;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}
  .an-grid.even{grid-template-columns:repeat(2,minmax(0,1fr))}
  @media (max-width:1100px){.an-grid,.an-grid.even{grid-template-columns:minmax(0,1fr)}}
  .an-sec{margin-top:14px}
  .an-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}
  @media (max-width:1180px){.an-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media (max-width:640px){.an-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.an-kpis .kpi:last-child:nth-child(odd){grid-column:1/-1}}
  .an-flow{width:100%;display:block}
  .an-pw{display:inline-flex;align-items:center;gap:8px;font-size:12px}.an-pw b{font:600 14px/1 var(--f-ui);font-variant-numeric:tabular-nums}
  .an-bars{display:grid;grid-template-columns:minmax(84px,max-content) minmax(60px,1fr) max-content max-content;gap:7px 12px;align-items:center}
  .an-row{display:contents}
  .an-row.click .an-l{cursor:pointer}.an-row.click:hover .an-l{color:var(--text)}
  .an-l{color:var(--text2);font-size:12.8px;text-align:right;white-space:nowrap}
  .an-track{position:relative;height:14px;border-radius:4px;background:var(--track)}
  .an-track i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
  .an-tg{position:absolute;top:-4px;bottom:-4px;width:0;border-left:2px dashed var(--accent);opacity:.8}
  .an-v{font:600 13px/1 var(--f-ui);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .an-m{color:var(--muted);font-size:11.8px;white-space:nowrap;font-variant-numeric:tabular-nums}
  @media (max-width:560px){.an-bars{grid-template-columns:minmax(70px,max-content) minmax(40px,1fr) max-content}.an-m{display:none}.an-l{font-size:12px}}
  .an-grid>.card{align-self:stretch}
  .an-subh{font:600 10.5px/1 var(--f-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:14px 14px 10px;border-top:1px solid var(--line)}
  .an-chart{width:100%;display:block}
  .an-chart text{font-family:var(--f-ui);fill:var(--muted);font-size:11px}
  .an-chart .lbl{fill:var(--text2);font-size:12px}
  .an-chart .val{fill:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
  .an-chart .grid{stroke:var(--line);stroke-width:1}
  .an-chart .axis{stroke:var(--line2);stroke-width:1}
  .an-chart .hit{fill:transparent;cursor:pointer}
  .an-chart .hit:hover{fill:color-mix(in srgb,var(--raise) 40%,transparent)}
  .an-matrix{width:100%;border-collapse:separate;border-spacing:3px;font-size:12px}
  .an-matrix th{font:600 10.5px/1.2 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 6px;text-align:center;white-space:nowrap}
  .an-matrix th.m{text-align:left}
  .an-matrix td{height:30px;border-radius:5px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text);min-width:58px}
  .an-matrix td.m{text-align:left;color:var(--text2);padding:0 8px 0 2px;white-space:nowrap;cursor:pointer}
  .an-matrix td.m:hover{color:var(--text)}
  .an-matrix td.z{color:var(--faint)}
  .an-matrix td.sum{font-weight:600;color:var(--text);text-align:right;padding:0 8px;position:relative;min-width:84px}
  .an-matrix td.sum i{position:absolute;left:8px;bottom:4px;height:2px;border-radius:1px;background:var(--accent);opacity:.7;max-width:calc(100% - 16px)}
  .an-matrix td.hi{color:var(--accent-ink);font-weight:600}
  .an-reco{display:flex;flex-direction:column;border-top:1px solid var(--line)}
  .an-rc{--c:var(--accent);padding:12px 14px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:5px;box-shadow:inset 3px 0 0 var(--c)}
  .an-rc:last-child{border-bottom:0}
  .an-rk{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--raise);color:var(--text2);font:600 11px/1 var(--f-ui);margin-right:8px;vertical-align:1px}
  .an-rc .acts{justify-content:space-between;align-items:center}
  .an-rc .acts .muted{font-size:12px}
  .an-rc .h{display:flex;align-items:baseline;gap:8px;justify-content:space-between}
  .an-rc .h b{font:600 15px/1.2 var(--f-ui)}
  .an-rc .h span{font:600 18px/1 var(--f-cond);color:var(--c);white-space:nowrap}
  .an-rc p{margin:0;color:var(--text2);font-size:12.8px}
  .an-rc .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
  .an-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--muted)}
  .an-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .an-tip{position:fixed;z-index:80;pointer-events:none;background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font-size:12px;box-shadow:var(--shadow);max-width:280px}
  `, 'analyse');

  // Verlustursachen = nicht produktive Zustände mit eingeplantem Auftrag
  // Ursachenfarben ausschließlich aus Zustands-Tokens (eine Farbwelt mit Leitstand und Halle)
  const LOSS = [
    { key: 'starved',      label: 'Wartet auf Material',  color: 'var(--mat)' },
    { key: 'waitOperator', label: 'Wartet auf Bediener',  color: 'var(--st-wait)' },
    { key: 'setup',        label: 'Rüsten',               color: 'var(--st-setup)' },
    { key: 'firstPiece',   label: 'Erstteilprüfung',      color: 'var(--info)' },
    { key: 'toolchange',   label: 'Werkzeugwechsel',      color: 'var(--st-tool)' },
    { key: 'waitTool',     label: 'Wartet auf Werkzeug',  color: 'color-mix(in srgb, var(--st-tool) 55%, var(--st-wait))' },
    { key: 'fault',        label: 'Störung',              color: 'var(--st-fault)' },
    { key: 'blocked',      label: 'Ausgang voll',         color: 'var(--st-idle)' },
  ];
  const RECO = {
    starved: 'Material kommt zu spät an der Maschine an. Transporte früher anstoßen, Weitergabemenge (Behältergröße) verkleinern oder Vorgänger-Arbeitsgang priorisieren.',
    waitOperator: 'Maschinen warten auf Personal – meist in Pausen und bei Mehrmaschinenbedienung. Pausen staffeln oder Einlegen/Rüsten über die Schicht verteilen.',
    setup: 'Rüsten kostet Kapazität. Rüstfolge ähnlicher Aufträge bündeln und externes Rüsten (Werkzeuge voreinstellen, Spannmittel vorbereiten) ausbauen.',
    firstPiece: 'Erstteile warten auf den Messraum. Prüfplätze an der Maschine (Erstteil lokal) oder feste Prüffenster für Erstteile einplanen.',
    toolchange: 'Werkzeugwechsel unterbrechen die Fertigung. Wechsel bündeln und vorbereitete Schwesterwerkzeuge nutzen.',
    waitTool: 'Maschinen stehen, weil der Einrichter noch nicht da ist. Wechsel früher ankündigen oder zweiten Einrichter in der Spätschicht.',
    fault: 'Störungen verursachen Stillstand. Häufigste Alarme auswerten und vorbeugende Wartung einplanen.',
    blocked: 'Fertige Behälter werden nicht abgeholt. AGV-Prioritäten anpassen oder Pufferplätze erweitern.',
  };

  let root, range = 'kd', sig = '', tip = null, flowW = 640;
  const S = () => WF.sim.state;
  const machines = () => WF.profile.machines.filter(id => S().machines[id]);
  const stats = (m) => (range === 'ks' ? m.ks : m.kd) || {};

  /** Verlust je Maschine und Ursache in € und Sekunden. Der Gesamtwert je Maschine entspricht exakt dem
      Engine-Wert lossEur; die Aufteilung auf Ursachen erfolgt anteilig nach Zustandszeiten. */
  function lossMatrix() {
    const rows = [];
    for (const id of machines()) {
      const m = S().machines[id], st = stats(m), sec = st.stateSec || {};
      const lossSec = LOSS.reduce((a, l) => a + (sec[l.key] || 0), 0);
      const eur = st.lossEur || 0;
      const cells = {};
      for (const l of LOSS) {
        const share = lossSec > 0 ? (sec[l.key] || 0) / lossSec : 0;
        cells[l.key] = { eur: eur * share, sec: (st.lossSec || 0) * share };
      }
      rows.push({ id, short: m.short, eur, lossSec: st.lossSec || 0, cells });
    }
    return rows;
  }
  function pareto(rows) {
    const items = LOSS.map(l => ({ ...l, eur: rows.reduce((a, r) => a + r.cells[l.key].eur, 0), sec: rows.reduce((a, r) => a + r.cells[l.key].sec, 0) }))
      .filter(x => x.eur > 0.5).sort((a, b) => b.eur - a.eur);
    const total = items.reduce((a, x) => a + x.eur, 0);
    let cum = 0;
    for (const x of items) { cum += x.eur; x.cum = total ? cum / total : 0; }
    return { items, total };
  }
  function oeeRows() {
    return machines().filter(id => S().machines[id].kind === 'machine').map(id => {
      const mv = WF.sim.machineView(id);
      const o = range === 'ks' ? mv.oeeShift : mv.oeeToday;
      return { id, short: mv.short, oee: o.oee, a: o.availability, p: o.performance, q: o.quality, energy: mv.energyKwhToday, good: mv.goodToday };
    });
  }

  // ------------------------------------------------------------ Diagramme (SVG, maßstabsgetreu)
  /** Balkenliste (HTML, skaliert sauber bis Handybreite): Label | Balken | Wert | Zusatz */
  function bars(rows, opts = {}) {
    if (!rows.length) return `<div class="empty">${opts.empty || 'Keine Daten'}</div>`;
    return `<div class="an-bars${opts.target != null ? ' tgt' : ''}">${rows.map(r => `
      <div class="an-row${r.id ? ' click' : ''}" ${r.id ? `data-id="${r.id}"` : ''} data-tip="${esc(r.tip || '')}">
        <span class="an-l">${esc(r.label)}</span>
        <span class="an-track">${r.frac != null ? `<i style="width:${(Math.max(0.005, Math.min(1, r.frac)) * 100).toFixed(1)}%;background:${r.color}"></i>` : ''}${opts.target != null ? `<b class="an-tg" style="left:${opts.target * 100}%"></b>` : ''}</span>
        <span class="an-v">${r.value}</span>
        <span class="an-m">${r.meta || ''}</span>
      </div>`).join('')}</div>`;
  }
  function paretoSvg(par) {
    if (!par.items.length) return '<div class="empty">Noch keine Verluste in diesem Zeitraum.</div>';
    const max = par.items[0].eur;
    return bars(par.items.map(it => ({ label: it.label, frac: it.eur / max, color: it.color, value: U.fmtEur(it.eur),
      meta: `${U.fmtDur(it.sec)} · kum. ${U.fmtPct(it.cum)}`, tip: `${it.label}: ${U.fmtEur(it.eur)} (${U.fmtDur(it.sec)} Maschinenzeit) – kumuliert ${U.fmtPct(it.cum)}` })));
  }
  function oeeSvg(rows) {
    const sorted = rows.slice().sort((a, b) => (a.oee == null ? -1 : a.oee) - (b.oee == null ? -1 : b.oee));
    return bars(sorted.map(r => ({ id: r.id, label: r.short, frac: r.oee, color: r.oee == null ? 'var(--st-idle)' : r.oee >= 0.75 ? 'var(--st-run)' : r.oee >= 0.55 ? 'var(--st-wait)' : 'var(--st-fault)',
      value: r.oee == null ? '–' : U.fmtPct(r.oee), meta: `V ${pct0(r.a)} · L ${pct0(r.p)} · Q ${pct0(r.q)}`,
      tip: `${r.short}: OEE ${r.oee == null ? '–' : U.fmtPct(r.oee, 1)} = Verfügbarkeit ${pct0(r.a)} × Leistung ${pct0(r.p)} × Qualität ${pct0(r.q)}` })), { target: 0.75 }) +
      `<div class="an-legend" style="margin-top:10px"><span><i style="background:var(--accent);width:2px"></i>Ziel 75 %</span><span>V = Verfügbarkeit · L = Leistung · Q = Qualität</span></div>`;
  }
  function energySvg(rows) {
    const list = rows.filter(r => r.energy > 0).sort((a, b) => b.energy - a.energy);
    if (!list.length) return '<div class="empty">Noch kein Energieverbrauch erfasst.</div>';
    const max = list[0].energy;
    return bars(list.map(r => { const pp = r.good > 0 ? r.energy / r.good : null; return { id: r.id, label: r.short, frac: r.energy / max, color: 'var(--info)',
      value: U.fmtNum(r.energy, 1) + ' kWh', meta: pp != null ? U.fmtNum(pp, pp < 1 ? 2 : 1) + ' kWh/Teil' : '',
      tip: `${r.short}: ${U.fmtNum(r.energy, 1)} kWh, ${U.fmtNum(r.good)} Gutteile${pp != null ? ' → ' + U.fmtNum(pp, 2) + ' kWh je Teil' : ''}` }; }));
  }
  const pct0 = (v) => v == null ? '–' : Math.round(v * 100) + ' %';
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  /** Ausstoß je Stunde (Gutteile aller Arbeitsgänge) + Leistungsaufnahme als Linie. */
  /** Gutteile je Stunde über den ganzen Arbeitstag 06–22 Uhr: vergangene Stunden voll, laufende schraffiert,
      künftige als leere Plätze – so wirkt der Tag nie wie ein Platzhalter. */
  function flowSvg() {
    const h = S().history, d0 = U.dayStart(S().t), t0 = d0 + 6 * 3600, now = S().t;
    const slots = [];
    for (let k = 0; k < 16; k++) slots.push({ t: t0 + k * 3600, good: 0 });
    for (let i = 0; i < h.t.length; i++) {
      const t = h.t[i]; if (t <= t0 || t > now + 1) continue;
      const k = Math.floor((t - 1 - t0) / 3600); if (slots[k]) slots[k].good += h.good[i] || 0;
    }
    const W = Math.max(300, Math.round(flowW || 640)), H = W < 480 ? 180 : 200, left = 38, right = 8, top = 16, bottom = 24;
    const maxG = Math.max(10, ...slots.map(x => x.good)), gStep = niceStep(maxG / 4), gMax = Math.ceil(maxG / gStep) * gStep;
    const sw = (W - left - right) / slots.length, bw = Math.min(24, sw * 0.62);
    const y = (v) => top + (H - top - bottom) * (1 - v / gMax);
    let g = `<defs><pattern id="an-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--st-run)" opacity=".35"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--st-run)" stroke-width="3"/></pattern></defs>`;
    for (let v = 0; v <= gMax + 1e-6; v += gStep) g += `<line class="grid" x1="${left}" y1="${y(v)}" x2="${W - right}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${U.fmtNum(v)}</text>`;
    const shiftX = left + 8 * sw;
    g += `<line class="axis" x1="${shiftX}" y1="${top - 6}" x2="${shiftX}" y2="${H - bottom}" stroke-dasharray="2 3"/><text x="${shiftX + 4}" y="${top - 4}">Spätschicht</text><text x="${left + 4}" y="${top - 4}">Frühschicht</text>`;
    slots.forEach((x, i) => {
      const cx = left + i * sw + sw / 2, bx = cx - bw / 2;
      const past = x.t + 3600 <= now, cur = !past && x.t <= now;
      if (past || cur) g += `<rect x="${bx}" y="${y(x.good)}" width="${bw}" height="${Math.max(0, y(0) - y(x.good))}" rx="3" style="fill:${cur ? 'url(#an-hatch)' : 'var(--st-run)'}" opacity="${cur ? 1 : 0.88}"/>`;
      else g += `<rect x="${bx}" y="${top + 2}" width="${bw}" height="${H - top - bottom - 2}" rx="3" style="fill:none;stroke:var(--line)" stroke-dasharray="2 3"/>`;
      if (i % 2 === 0) g += `<text x="${cx}" y="${H - 7}" text-anchor="middle">${U.fmtClock(x.t)}</text>`;
      if (past || cur) g += `<rect class="hit" data-tip="${U.fmtClock(x.t)}–${U.fmtClock(x.t + 3600)}: ${U.fmtNum(x.good)} Gutteile (alle Arbeitsgänge)${cur ? ' – laufende Stunde' : ''}" x="${left + i * sw}" y="${top}" width="${sw}" height="${H - top - bottom}"/>`;
    });
    return `<svg class="an-chart an-flow" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gutteile je Stunde heute">${g}</svg>`;
  }
  function matrixHtml(rows) {
    const used = LOSS.filter(l => rows.some(r => r.cells[l.key].eur > 0.5));
    if (!used.length) return '<div class="empty">Noch keine Verluste in diesem Zeitraum.</div>';
    const max = Math.max(1, ...rows.flatMap(r => used.map(l => r.cells[l.key].eur)));
    const sorted = rows.slice().sort((a, b) => b.eur - a.eur);
    const maxRow = Math.max(1, ...rows.map(r => r.eur));
    const head = `<tr><th class="m">Maschine</th>${used.map(l => `<th title="${esc(l.label)}">${esc(l.label.replace('Wartet auf ', 'Wart. '))}</th>`).join('')}<th>Summe</th></tr>`;
    const body = sorted.map(r => `<tr><td class="m" data-id="${r.id}">${esc(r.short)}</td>${used.map(l => {
      const v = r.cells[l.key].eur;
      if (v < 0.5) return '<td class="z">·</td>';
      const a = 0.12 + 0.7 * Math.sqrt(v / max);
      return `<td class="${a > 0.5 ? 'hi' : ''}" style="background:color-mix(in srgb, var(--accent) ${Math.round(a * 85)}%, transparent)" title="${esc(r.short)} · ${esc(l.label)}: ${esc(U.fmtEur(v))} (${esc(U.fmtDur(r.cells[l.key].sec))})">${U.fmtNum(v)}</td>`;
    }).join('')}<td class="sum"><span>${U.fmtNum(r.eur)} €</span><i style="width:${(r.eur / maxRow * 100).toFixed(1)}%"></i></td></tr>`).join('');
    return `<div class="tbl-wrap"><table class="an-matrix">${head}${body}</table></div>`;
  }
  function recos(rows, par) {
    const out = [];
    for (const it of par.items.slice(0, 3)) {
      const worst = rows.slice().sort((a, b) => b.cells[it.key].eur - a.cells[it.key].eur)[0];
      out.push({ it, worst });
    }
    if (!out.length) return '<div class="empty">Keine nennenswerten Verluste – die Schicht läuft rund.</div>';
    return `<div class="an-reco">${out.map(({ it, worst }, n) => `
      <div class="an-rc" style="--c:${it.color}">
        <div class="h"><b><span class="an-rk">${n + 1}</span>${esc(it.label)}</b><span>${U.fmtEur(it.eur)}</span></div>
        <p>${esc(RECO[it.key] || '')}</p>
        <div class="acts"><span class="muted">Stärkster Posten: <button class="link" data-id="${worst.id}">${esc(worst.short)}</button> · ${U.fmtEur(worst.cells[it.key].eur)} · ${U.fmtDur(worst.cells[it.key].sec)}</span>${WF.ai ? `<button class="btn sm ghost" data-ask="${esc(it.label)}|${worst.id}">${icon('sparkles', 14)} Analysieren</button>` : ''}</div>
      </div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------ Rendern
  function render() {
    const rows = lossMatrix(), par = pareto(rows), oee = oeeRows();
    const k = WF.sim.kpis();
    const lossTotal = rows.reduce((a, r) => a + r.eur, 0);
    const top = par.items[0];
    const bott = bottleneck();
    // Fertigungsenergie (Maschinen, ohne Hallen-Grundlast) je Fertigteil – stabil über den Tag
    const machEnergy = WF.profile.machines.reduce((a, id) => { const m = S().machines[id]; return a + (m && m.kd ? m.kd.energyKwh || 0 : 0); }, 0);
    const energyPerPart = k.goodFinished > 0 ? machEnergy / k.goodFinished : null;
    // Neu zeichnen höchstens je 2 Sim-Minuten (ruhiges Bild, Tooltips bleiben stehen)
    const sigNow = range + '|' + Math.floor(S().t / 120);
    if (sigNow === sig) return;
    sig = sigNow;
    const oo = range === 'ks' ? { oee: k.oeeShift } : k;
    root.querySelector('.an-body').innerHTML = `
      <div class="kpis an-kpis">
        <div class="kpi"><div class="l">Verlust ${range === 'ks' ? 'Schicht' : 'heute'}</div><div class="v">${U.fmtNum(lossTotal)}<small>€</small></div><div class="s">Maschinenstundensatz × Stillstand bei eingeplantem Auftrag</div></div>
        <div class="kpi"><div class="l">Größte Ursache</div><div class="v" style="font-size:22px">${top ? esc(top.label) : '–'}</div><div class="s">${top ? U.fmtEur(top.eur) + ' · ' + U.fmtPct(par.total ? top.eur / par.total : 0) + ' des Verlusts' : 'keine Verluste'}</div></div>
        <div class="kpi"><div class="l">Werk-OEE</div><div class="v">${oo.oee == null ? '–' : U.fmtNum(oo.oee * 100, 1)}<small>%</small></div><div class="s">${range === 'ks' ? 'laufende Schicht' : `V ${pct0(k.availability)} × L ${pct0(k.performance)} × Q ${pct0(k.quality)}`}</div></div>
        <div class="kpi"><div class="l">Engpass</div><div class="v" style="font-size:22px">${bott ? esc(bott.short) : '–'}</div><div class="s">${bott ? esc(bott.why) : 'kein eindeutiger Engpass'}</div></div>
        <div class="kpi"><div class="l">Energie je Fertigteil</div><div class="v">${energyPerPart != null ? U.fmtNum(energyPerPart, 2) : '–'}<small>kWh</small></div><div class="s">${U.fmtNum(machEnergy)} kWh Maschinen · ${U.fmtNum(k.goodFinished)} Fertigteile</div></div>
      </div>
      <div class="an-sec an-grid an-top">
        <div class="card"><div class="card-h"><h3>Wo verlieren wir Geld? – Verlustursachen</h3><span class="muted">€ · Maschinenzeit · kumuliert</span></div><div class="card-b">${paretoSvg(par)}</div>
          <div class="an-subh">Empfehlungen aus den größten Verlusten</div>${recos(rows, par)}</div>
        <div class="card"><div class="card-h"><h3>OEE je Maschine</h3><span class="muted">Verfügbarkeit × Leistung × Qualität</span></div><div class="card-b">${oeeSvg(oee)}</div></div>
      </div>
      <div class="an-sec card"><div class="card-h"><h3>Verlustmatrix Maschine × Ursache</h3><span class="muted">Euro ${range === 'ks' ? 'laufende Schicht' : 'heute'} · dunkler = mehr</span></div><div class="card-b">${matrixHtml(rows)}</div></div>
      <div class="an-sec an-grid even">
        <div class="card"><div class="card-h"><h3>Ausstoß im Tagesverlauf</h3><span class="muted">Gutteile je Stunde · alle Arbeitsgänge</span></div><div class="card-b an-flowbox">${flowSvg()}</div></div>
        <div class="card"><div class="card-h"><h3>Energie je Maschine heute</h3><span class="an-pw">${WF.ui.spark((S().history.powerKw || []).slice(-96), { w: 110, h: 24, color: 'var(--info)' })}<b>${U.fmtNum(k.powerKw)} kW</b><span class="muted">jetzt</span></span></div><div class="card-b">${energySvg(oee)}</div></div>
      </div>`;
    // Diagramm in Pixelbreite des Containers zeichnen (Schrift bleibt auch auf dem Handy lesbar)
    const fb = root.querySelector('.an-flowbox');
    if (fb && fb.clientWidth) { const w = fb.clientWidth - 28; if (Math.abs(w - flowW) > 8) { flowW = w; sig = ''; render(); } }
  }
  /** Engpass: eine Definition für alle Ansichten (Engine), Fallback aus der Prognose. */
  function bottleneck() {
    if (WF.sim.bottleneck) {
      let b = null; try { b = WF.sim.bottleneck(); } catch (e) { b = null; }
      if (b && b.stationId) return { id: b.stationId, short: b.short || (WF.profile.stationById[b.stationId] || {}).short || b.stationId, why: b.why || '' };
    }
    let fc; try { fc = WF.sim.forecast(); } catch (e) { fc = null; }
    const count = {};
    if (fc) for (const id in fc.orders) {
      const o = fc.orders[id]; if (!o || o.done) continue;
      const sid = o.bottleneckStation || (typeof o.bottleneck === 'string' ? o.bottleneck.split(' ')[0] : null);
      if (!sid || !WF.profile.stationById[sid]) continue;
      count[sid] = (count[sid] || 0) + (o.late ? 3 : (o.slackSec != null && o.slackSec < 4 * 3600 ? 2 : 1));
    }
    const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const st = WF.profile.stationById[best[0]];
    const n = Object.values(fc.orders).filter(o => o && !o.done && (o.bottleneckStation || (typeof o.bottleneck === 'string' ? o.bottleneck.split(' ')[0] : '')) === best[0]).length;
    return { id: best[0], short: st.short, why: `begrenzt ${n} Auftr${n === 1 ? 'ag' : 'äge'} laut Prognose` };
  }

  WF.registerView({
    id: 'analyse', title: 'Analyse', icon: 'gauge', group: 'betrieb', order: 3.5,
    mount(r) {
      root = r;
      r.innerHTML = `<div class="view-h"><div><h1 class="view-t">Analyse</h1>
          <p class="view-sub">Wo die Fertigung Zeit und Geld verliert – live aus Maschinenzuständen und Stundensätzen.</p></div>
          <div class="seg" role="tablist" aria-label="Zeitraum"><button data-r="kd" class="on">Heute</button><button data-r="ks">Laufende Schicht</button></div></div>
        <div class="an-body"></div>`;
      r.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = b.dataset.r; r.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); sig = ''; render(); });
      r.addEventListener('click', (e) => {
        const ask = e.target.closest('[data-ask]');
        if (ask) { const [label, id] = ask.dataset.ask.split('|'); WF.bus.emit('ai:ask', { text: `Analysiere den Verlust „${label}“ heute, besonders an ${WF.profile.stationById[id].short}: Ursachen, Kosten und konkrete Maßnahmen für die nächste Schicht.`, context: { kind: 'machine', id } }); return; }
        const t = e.target.closest('[data-id]');
        if (t && WF.profile.stationById[t.dataset.id]) WF.app.select('machine', t.dataset.id);
      });
      r.addEventListener('mousemove', (e) => {
        const t = e.target.closest('[data-tip]');
        if (!t) { if (tip) { tip.remove(); tip = null; } return; }
        if (!tip) { tip = el('div', { class: 'an-tip' }); document.body.append(tip); }
        tip.textContent = t.getAttribute('data-tip');
        tip.style.left = Math.min(window.innerWidth - 290, e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
      });
      r.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
      window.addEventListener('resize', () => { sig = ''; });
      render();
    },
    show() { sig = ''; },
    hide() { if (tip) { tip.remove(); tip = null; } },
    update() { render(); },
  });
})();
