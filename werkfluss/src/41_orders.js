/* werkfluss – Ansicht „Aufträge“ (41_orders.js) + Detail „order“.
   Kopf mit Kennzahlen (offene Aufträge, Terminlage im Plan/knapp/spät, heute versandt, Termintreue, Fremdbearbeitung)
   und Umschalter „Auftragsliste | Plantafel“.
   - Auftragsliste: je Auftrag eine Karte mit Arbeitsplan-Kette (Stationen als verbundene Schritte, Materialfluss
     zwischen den Schritten), Fortschritt, Termin vs. Prognose, Terminlage, Engpass, Eilauftrag-Schalter.
   - Plantafel: Gantt je Arbeitsplatz + Fremdbearbeitung; Vergangenheit = tatsächliche Belegung (aus den Ereignissen)
     mit Zustandsband, Zukunft = Prognose-Blöcke (WF.sim.forecast) je Auftragsfarbe, Rüstanteil schraffiert.
   - Detail „order“: Lage, Aktionen (Priorität, Arbeitsgang verlagern, Halle, Plantafel), Arbeitsgänge, Material, Ereignisse.
   Nur lesen (WF.sim.*), handeln über WF.sim.actions. Aktualisierung inkrementell (Felder patchen, SVG nur bei neuer
   Prognose neu zeichnen). CSS-Präfix .or-  ·  Öffentlich: WF.ordersUi = { colorOf(orderId) }. */
(function () {
  const WF = window.WF;
  const { esc, icon } = WF.ui;
  const U = WF.util;
  const DAY = 86400, HOUR = 3600;

  // ------------------------------------------------------------------ Auftragsfarben
  // 12 Farbtöne (OKLCH L 0,575/0,665, C 0,13), zyklisch so angeordnet, dass aufeinanderfolgende Auftragsnummern
  // auch bei Rot-Grün-Sehschwäche klar unterscheidbar sind (geprüft: ΔE ≥ 14,9 deutan, ≥ 18,3 normal; Kontrast ≥ 3:1
  // auf --panel). Rot und Bernstein sind gemieden bzw. gedämpft (Zustandsfarben Störung/Warten bleiben eindeutig).
  // Identität nie nur über Farbe: Blöcke tragen die Auftragsnummer, Hover hebt den ganzen Auftrag hervor.
  const ORDER_HEX = ['#00a8bf', '#d27a44', '#0083ba', '#45ab70', '#7b68bf', '#00ad9e', '#4d77c5', '#7ca245', '#9c5ca6', '#c28621', '#b05584', '#a7951e'];
  const colorMemo = {};
  function colorOf(orderId) {
    const k = String(orderId == null ? '' : orderId);
    if (colorMemo[k]) return colorMemo[k];
    const m = /(\d+)\D*$/.exec(k);
    let idx;
    if (m) idx = Number(m[1]) % ORDER_HEX.length;
    else { let h = 0; for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) >>> 0; idx = h % ORDER_HEX.length; }
    return (colorMemo[k] = ORDER_HEX[idx]);
  }
  WF.ordersUi = { colorOf, palette: ORDER_HEX.slice() };

  // ------------------------------------------------------------------ Helfer
  const S = () => WF.sim && WF.sim.state;
  const simStartT = () => { const s = S(); return s && s.startT != null ? s.startT : WF.profile.sim.startT; };
  const nf = (n) => U.fmtNum(n);
  const dayOf = (t) => Math.floor(t / DAY);
  /** Uhrzeit relativ zu heute: „15:02“, „morgen 06:30“, „Mi 14:00“ */
  function tShort(t, now) {
    if (t == null || !isFinite(t)) return '–';
    const d = dayOf(t) - dayOf(now);
    if (d === 0) return U.fmtClock(t);
    if (d === 1) return 'morgen ' + U.fmtClock(t);
    if (d === -1) return 'gestern ' + U.fmtClock(t);
    return U.fmtDayClock(t);
  }
  /** Ist-Zeitpunkt; vor Simulationsbeginn (Anfangsbestand) ehrlich als „vor Mo 06:00“ */
  function tAct(t, now) {
    if (t == null) return '–';
    if (t <= simStartT()) return 'vor ' + U.fmtDayClock(simStartT());
    return tShort(t, now);
  }
  const fmtDue = (t, now) => (t == null ? '–' : U.fmtDue(t, now));
  function durLong(sec) {
    if (sec == null || !isFinite(sec)) return '–';
    sec = Math.abs(sec);
    if (sec < DAY) return U.fmtDur(sec);
    let d = Math.floor(sec / DAY), h = Math.round((sec - d * DAY) / HOUR);
    if (h === 24) { d++; h = 0; }
    return d + (d === 1 ? ' Tag' : ' Tage') + (h ? ' ' + h + ' h' : '');
  }
  function setText(node, txt) { txt = txt == null ? '' : String(txt); if (node._t !== txt) { node._t = txt; node.textContent = txt; } }
  function setHTML(node, html) { if (node._h !== html) { node._h = html; node.innerHTML = html; } }
  function setAttr(node, k, v) { const key = '_a' + k; if (node[key] !== v) { node[key] = v; if (v == null || v === false) node.removeAttribute(k); else node.setAttribute(k, v === true ? '' : v); } }
  function setVar(node, k, v) { const key = '_v' + k; if (node[key] !== v) { node[key] = v; node.style.setProperty(k, v); } }
  function setCls(node, cls) { if (node._c !== cls) { node._c = cls; node.className = cls; } }
  function setHidden(node, h) { h = !!h; if (node._hid !== h) { node._hid = h; node.hidden = h; } }
  function setW(node, frac) { const w = (U.clamp(frac || 0, 0, 1) * 100).toFixed(1) + '%'; if (node._w !== w) { node._w = w; node.style.width = w; } }
  const refs = (root) => { const r = {}; root.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); return r; };
  const hasView = (id) => WF.views.some(v => v.id === id);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('werkfluss.orders.v1') || '{}') || {}; } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem('werkfluss.orders.v1', JSON.stringify(Object.assign(store.get(), o))); } catch (e) { /* Speicher nicht verfügbar */ } },
  };

  const RISK_C = { ok: 'var(--st-run)', knapp: 'var(--st-wait)', 'spät': 'var(--st-fault)', unbekannt: 'var(--st-idle)' };
  const RISK_RANK = { 'spät': 0, knapp: 1, ok: 2, unbekannt: 3 };
  const riskLabel = (k) => (WF.sim && WF.sim.LABELS && WF.sim.LABELS.risk && WF.sim.LABELS.risk[k]) || k;
  const STATE_SHORT = { running: 'läuft', setup: 'Rüsten', firstPiece: 'Erstteilprüfung', toolchange: 'WZ-Wechsel', waitTool: 'wartet Werkzeug',
    waitOperator: 'wartet Bediener', starved: 'wartet Material', blocked: 'Ausgang voll', fault: 'Störung', idle: 'bereit' };
  const PROBLEM = { waitTool: 1, waitOperator: 1, starved: 1, blocked: 1, fault: 1 };
  const TYPE_GROUP = { lathe: 'turn', swiss: 'turn', biglathe: 'turn', mill5: 'mill', mill3: 'mill' };
  const EV_ICON = { opSelect: 'route', opPause: 'pause', opDone: 'check', orderDone: 'check', orderAdded: 'file', setupStart: 'settings', setupDone: 'settings',
    fpiReady: 'target', fpiOk: 'target', fpiNok: 'target', scrap: 'x', correction: 'gauge', offset: 'gauge', extOut: 'truck', extIn: 'truck',
    priority: 'bolt', moveOp: 'route', issue: 'box', delivery: 'box', toolPlanned: 'clock', toolChanged: 'wrench', fault: 'alert', repair: 'wrench', state: 'dot' };
  const EV_SEV_C = { ok: 'var(--st-run)', warn: 'var(--st-wait)', crit: 'var(--st-fault)', info: 'var(--muted)' };

  const custShort = (c) => String(c || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  function stLabel(op) {
    if (op.station === 'EXT') return op.ext && /härter/i.test(op.ext.partner || '') ? 'Härterei' : 'Fremdbearbeitung';
    if (op.station === 'VERSAND') return 'Versand';
    return op.stationName || op.station;
  }
  function opVis(op) {
    if (op.state === 'done') return { k: 'done', c: 'var(--st-run)', label: 'Fertig' };
    if (op.state === 'active') { const st = WF.STATE[op.machineState] || WF.STATE.idle; return { k: 'active', c: st.color, label: st.label }; }
    if (op.state === 'external') return { k: 'ext', c: 'var(--st-wait)', label: 'In Fremdbearbeitung' };
    if (op.state === 'waiting') return { k: 'wait', c: 'var(--st-idle)', label: op.station === 'VERSAND' ? 'Teilweise versandt' : 'Wartet' };
    return { k: 'open', c: 'var(--line2)', label: 'Offen' };
  }
  /** fertige Gutteile = Gutteile des letzten Bearbeitungsschritts (ohne Versand) */
  function finishedGood(v) {
    for (let i = v.ops.length - 1; i >= 0; i--) if (v.ops[i].station !== 'VERSAND') return v.ops[i].good;
    return 0;
  }
  /** offene Benachrichtigungen zu einem Auftrag (Termin gefährdet, SPC-Trend des Arbeitsgangs, Teilmenge …) */
  function orderNotifs(id, withOk) {
    const s = S(); if (!s || !s.notifications) return [];
    return s.notifications.filter(n => n.status !== 'resolved' && (withOk || n.sev !== 'ok') &&
      ((n.entity && n.entity.kind === 'order' && n.entity.id === id) || (n.spc && n.spc.orderId === id) || keyHas(n.key, id)));
  }
  function keyHas(key, id) {
    if (!key) return false;
    const i = key.indexOf(':' + id);
    if (i < 0) return false;
    const nx = key.charAt(i + 1 + id.length);
    return !nx || !/[0-9A-Za-z]/.test(nx);
  }
  function bnSeq(v) { const m = v.bottleneck && /AG\s*(\d+)/.exec(v.bottleneck); return m ? Number(m[1]) : null; }
  function slackText(v) {
    if (v.status === 'fertig') {
      if (v.shippedQty < v.qty) return nf(v.qty - v.shippedQty) + ' Stk fehlen';
      if (v.slackSec != null && v.slackSec < 0) return durLong(-v.slackSec) + ' nach Termin';
      return v.slackSec != null ? durLong(v.slackSec) + ' vor Termin' : 'geliefert';
    }
    if (v.slackSec == null) return 'keine Prognose';
    return v.slackSec >= 0 ? 'Puffer ' + durLong(v.slackSec) : durLong(-v.slackSec) + ' zu spät';
  }
  function riskBadge(v) {
    if (v.status === 'fertig') {
      const ok = v.onTime;
      return { label: ok ? 'Pünktlich' : (v.shippedQty < v.qty ? 'Teilmenge' : 'Verspätet'), c: ok ? 'var(--st-run)' : 'var(--st-fault)' };
    }
    return { label: v.riskLabel || riskLabel(v.risk), c: RISK_C[v.risk] || RISK_C.unbekannt };
  }
  /** Lose dieses Arbeitsgangs beim Partner (aus den Behältern): [{qty, sentT, returnT}] nach Rückkehr sortiert */
  function extLots(v, op) {
    const by = {};
    for (const c of v.containers) {
      if (c.state !== 'external' || !c.location || (c.seq != null && c.seq !== op.seq)) continue;
      const k = c.location.sentT + '|' + c.location.returnT;
      (by[k] = by[k] || { qty: 0, sentT: c.location.sentT, returnT: c.location.returnT }).qty += c.qty;
    }
    return Object.values(by).sort((a, b) => a.returnT - b.returnT);
  }
  function extText(v, op, now) {
    const lots = extLots(v, op), e = op.ext || {};
    const parts = [];
    if (lots.length === 1) parts.push(`${nf(lots[0].qty)} Stk beim Partner, zurück ca. ${tShort(lots[0].returnT, now)}`);
    else if (lots.length > 1) parts.push(`${lots.length} Lose beim Partner: ` + lots.map(l => `${nf(l.qty)} Stk ca. ${tShort(l.returnT, now)}`).join(', '));
    if (e.waitingPickupQty > 0) parts.push(`${nf(e.waitingPickupQty)} Stk abholbereit${e.pickupT ? ' (Abholung ca. ' + tShort(e.pickupT, now) + ')' : ''}`);
    if (e.returnedQty > 0) parts.push(`${nf(e.returnedQty)} Stk zurück`);
    return parts.join(' · ') || e.returnText || '';
  }
  function chipSub(op, v, now) {
    const tgt = op.targetIn || op.target;
    if (op.station === 'VERSAND') {
      if (op.state === 'done') return 'komplett versandt';
      if (op.good > 0) return nf(op.good) + '/' + nf(v.qty) + ' versandt';
      return v.eta != null ? 'ca. ' + tShort(v.eta, now) : 'offen';
    }
    switch (op.state) {
      case 'done': return op.endT != null && op.endT > simStartT() ? 'fertig ' + tShort(op.endT, now) : 'fertig';
      case 'active': {
        const base = nf(op.good) + '/' + nf(op.target);
        return op.machineState && op.machineState !== 'running' ? base + ' · ' + (STATE_SHORT[op.machineState] || '') : base + ' gut';
      }
      case 'external': {
        const e = op.ext || {};
        if (e.atPartnerQty > 0 && e.returnT) return (extLots(v, op).length > 1 ? 'zurück ab ca. ' : 'zurück ca. ') + tShort(e.returnT, now);
        if (e.waitingPickupQty > 0 && e.pickupT) return 'Abholung ca. ' + tShort(e.pickupT, now);
        return nf(op.good) + '/' + nf(tgt) + ' zurück';
      }
      case 'waiting': return op.waiting > 0 ? nf(op.waiting) + ' Stk im Eingang' : nf(op.good) + '/' + nf(tgt) + ' · wartet';
      default: return op.plannedStart != null ? 'ab ' + tShort(op.plannedStart, now) : 'offen';
    }
  }
  function chipFrac(op, v) {
    if (op.state === 'done') return 1;
    const tgt = op.station === 'VERSAND' ? v.qty : (op.target || op.targetIn || 1);
    return tgt ? Math.min(1, op.good / tgt) : 0;
  }
  function chipTitle(op, v, now) {
    const lines = [`AG ${op.seq} · ${op.op}`, op.station === 'EXT' ? (op.ext ? op.ext.partner + ' – ' + op.ext.process : 'Fremdbearbeitung') : `${stLabel(op)}${op.station !== 'VERSAND' ? ' (' + op.station + ')' : ''}`];
    const vis = opVis(op);
    lines.push(vis.label + (op.cause ? ': ' + op.cause : ''));
    if (op.station === 'EXT' && op.ext) lines.push(extText(v, op, now) || op.ext.returnText);
    else if (op.station !== 'VERSAND') lines.push(`Eingang ${nf(op.received)} · Gut ${nf(op.good)} · Ausschuss ${nf(op.scrap)} · Wartet ${nf(op.waiting)}`);
    if (op.state === 'done') lines.push(`Ist: ${tAct(op.startT, now)} – ${tAct(op.endT, now)}`);
    else if (op.plannedEnd != null) lines.push(`${op.startT != null && (op.received > 0 || op.good > 0) ? 'Begonnen ' + tAct(op.startT, now) : 'Plan ab ' + tShort(op.plannedStart, now)} · fertig ca. ${tShort(op.plannedEnd, now)}`);
    return lines.join('\n');
  }
  /** Ursachentext der Maschine im Kontext des Auftrags: die eigene Auftragsnummer weglassen */
  function cleanCause(cause, oid) {
    if (!cause) return '';
    return String(cause).split(oid + ' ').join('').split(' ' + oid).join('').replace(/\s{2,}/g, ' ').trim();
  }
  const dotHtml = (c) => `<i class="or-dot" style="--c:${c}"></i>`;
  /** „Jetzt“-Zeile: die eine Aussage, warum der Auftrag gerade steht oder läuft */
  function nowLine(v, now) {
    if (v.status === 'fertig') return { cls: 'ok', ic: 'check', html: `Fertig ${esc(fmtDue(v.doneT, now))} · ${nf(v.shippedQty)}/${nf(v.qty)} Stk versandt` };
    const act = v.ops.filter(o => o.state === 'active');
    const prob = act.filter(o => PROBLEM[o.machineState]);
    if (prob.length) {
      const o = prob[0], st = WF.STATE[o.machineState] || {};
      return { cls: o.machineState === 'fault' ? 'crit' : 'warn', ic: 'alert', html: `<b>${esc(stLabel(o))}</b> ${esc(st.label || '')} – ${esc(cleanCause(o.cause, v.id))}` };
    }
    if (act.length) {
      return { cls: '', ic: null, html: act.slice(0, 2).map(o => `${dotHtml((WF.STATE[o.machineState] || WF.STATE.idle).color)}<b>${esc(stLabel(o))}</b> ${esc(cleanCause(o.cause, v.id) || (WF.STATE[o.machineState] || {}).label || '')}`).join('<span class="or-sep">·</span>') };
    }
    const ex = v.ops.find(o => o.state === 'external');
    if (ex && ex.ext) return { cls: '', ic: 'truck', html: `<b>${esc(stLabel(ex))}</b> ${esc(extText(v, ex, now))}` };
    const tr = v.containers.filter(c => c.state === 'transit');
    if (tr.length) {
      const to = v.ops.find(o => o.seq === tr[0].seq);
      return { cls: '', ic: 'truck', html: `${nf(tr.length)} Behälter (${nf(tr.reduce((a, c) => a + c.qty, 0))} Stk) unterwegs${to ? ' zu <b>' + esc(stLabel(to)) + '</b>' : ''} – ${esc(tr[0].where)}` };
    }
    const w = v.ops.find(o => o.state === 'waiting' && o.station !== 'VERSAND' && o.waiting > 0);
    if (w) {
      const s = S(), m = s.machines[w.station];
      const fc = WF.sim.forecast(), fb = (fc.machines[w.station] || []).find(b => b.orderId === v.id && b.seq === w.seq);
      const startTxt = fb && fb.start > now + 60 ? ' · Start ca. ' + esc(tShort(fb.start, now)) : '';
      if (m && m.op && m.op.oid !== v.id) return { cls: '', ic: 'clock', html: `${nf(w.waiting)} Stk warten an <b>${esc(stLabel(w))}</b> – dort läuft noch ${esc(m.op.oid)}${startTxt}` };
      return { cls: '', ic: 'clock', html: `${nf(w.waiting)} Stk warten an <b>${esc(stLabel(w))}</b>${startTxt || (w.plannedEnd != null ? ' · Arbeitsgang fertig ca. ' + esc(tShort(w.plannedEnd, now)) : '')}` };
    }
    const nx = v.ops.find(o => o.state === 'open' || o.state === 'waiting');
    if (nx) return { cls: '', ic: 'clock', html: `Nächster Schritt <b>${esc(stLabel(nx))}</b> (AG ${nx.seq})${nx.plannedStart != null ? ' ab ca. ' + esc(tShort(nx.plannedStart, now)) : ''}` };
    return { cls: '', ic: 'dot', html: 'Wartet auf Einplanung' };
  }

  // ------------------------------------------------------------------ CSS (Präfix .or-)
  WF.ui.css(`
  .or-root{display:flex;flex-direction:column;gap:14px;min-width:0}
  .or-head{margin-bottom:0}
  .or-head .view-sub{display:flex;flex-wrap:wrap;gap:0 6px}
  .or-head-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .or-mode button{display:inline-flex;align-items:center;gap:6px}
  .or-mode button .ico{opacity:.85}

  .or-kpis{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) minmax(0,1.9fr) repeat(3,minmax(0,1fr))}
  .or-kpis .kpi{display:flex;flex-direction:column;min-width:0}
  .or-kpis .kpi .v{display:flex;align-items:baseline;gap:4px}
  .or-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .or-kpis .kpi.click{cursor:pointer}
  .or-kpis .kpi.click:hover{border-color:var(--line2)}
  .or-rk{display:flex;gap:6px;margin-top:5px}
  .or-rk button{--c:var(--st-idle);flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:3px 8px 4px;margin:0;border-radius:7px;border:1px solid transparent;background:transparent;cursor:pointer;color:inherit;text-align:left}
  .or-rk button:hover{background:color-mix(in srgb,var(--c) 9%,transparent);border-color:color-mix(in srgb,var(--c) 25%,transparent)}
  .or-rk button.on{background:color-mix(in srgb,var(--c) 13%,transparent);border-color:color-mix(in srgb,var(--c) 40%,transparent)}
  .or-rk b{font:600 26px/1.05 var(--f-cond);font-variant-numeric:tabular-nums;color:var(--text)}
  .or-rk span{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted);white-space:nowrap}
  .or-rk span i{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
  .or-rk button.zero b{color:var(--faint)}
  .or-rk em{font:500 10.5px/1.3 var(--f-mono);font-style:normal;color:var(--faint);max-width:100%;margin-top:1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-spacing:-1px}
  .or-rk em:empty{display:none}
  .or-rbar{display:flex;gap:2px;height:5px;margin-top:7px;border-radius:3px;overflow:hidden;background:var(--track)}
  .or-rbar i{display:block;height:100%;background:var(--c);transition:width .4s ease}
  .or-rbar i:first-child{border-radius:3px 0 0 3px}

  .or-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;position:sticky;top:-18px;z-index:5;margin:0 -2px;padding:8px 2px;background:var(--bg)}
  .or-chips{display:flex;gap:6px;flex-wrap:wrap;min-width:0}
  .or-fchip{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .or-fchip b{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
  .or-fchip:hover{border-color:var(--line2);color:var(--text)}
  .or-fchip.on{background:var(--raise);border-color:var(--line2);color:var(--text)}
  .or-fchip.on b{color:var(--text2)}
  .or-fchip .or-fdot{width:7px;height:7px;border-radius:50%;background:var(--c,var(--st-wait))}
  .or-search{position:relative;flex:0 1 280px;min-width:180px;margin-left:auto}
  .or-search .ico{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--faint);pointer-events:none}
  .or-search input{height:32px;padding:0 30px 0 32px;font-size:13px;background:var(--card);border-color:var(--line)}
  .or-search input:focus{border-color:var(--accent);background:var(--bg2)}
  .or-search input::-webkit-search-cancel-button{display:none;-webkit-appearance:none}
  .or-search button{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center}
  .or-search button:hover{color:var(--text);background:var(--raise)}
  .or-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted);width:100%;padding:0 2px}
  .or-legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .or-legend .or-lgs{width:20px;height:12px;border-radius:4px;border:1px solid var(--c);background:color-mix(in srgb,var(--c) 18%,transparent)}
  .or-legend .or-lgs.open{border-style:dashed;background:transparent;border-color:var(--line2)}
  .or-legend .or-lgf{width:18px;height:2px;background:repeating-linear-gradient(90deg,var(--mat) 0 4px,transparent 4px 7px)}

  .or-thead,.or-top{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 168px 200px 136px 34px;gap:16px;align-items:center}
  .or-thead{padding:0 16px 0 19px;font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
  .or-list{display:flex;flex-direction:column;gap:8px}
  .or-card{--oc:var(--accent);--rc:var(--st-run);container:orcard / inline-size;position:relative;display:flex;flex-direction:column;gap:11px;padding:13px 16px 12px 19px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;min-width:0;transition:border-color .15s ease,background-color .15s ease}
  .or-card:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 50%,var(--card))}
  .or-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .or-card.r-tight,.or-card.r-late{box-shadow:inset 3px 0 0 var(--rc)}
  .or-card.r-late{border-color:color-mix(in srgb,var(--st-fault) 30%,var(--line));background:color-mix(in srgb,var(--st-fault) 4%,var(--card))}
  .or-card.sel{border-color:color-mix(in srgb,var(--accent) 65%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .or-card.sel.r-tight,.or-card.sel.r-late{box-shadow:inset 3px 0 0 var(--rc),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .or-card.done{background:color-mix(in srgb,var(--panel) 60%,var(--card))}
  .or-top{min-width:0}
  .or-top > *{min-width:0}
  .or-l1{display:flex;align-items:center;gap:7px;min-width:0}
  .or-sw{width:10px;height:10px;border-radius:3px;background:var(--oc);flex:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--oc) 22%,transparent)}
  .or-id{font:600 13px/1.2 var(--f-mono);color:var(--text);letter-spacing:.01em;white-space:nowrap}
  .or-tag{--c:var(--st-idle);display:inline-flex;align-items:center;gap:4px;font:600 10.5px/1 var(--f-ui);letter-spacing:.02em;padding:3px 6px;border-radius:5px;color:color-mix(in srgb,var(--c) 85%,white);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 32%,transparent);white-space:nowrap;flex:none}
  .or-tag.eil{--c:var(--st-fault)}
  .or-tag.eil .ico{margin:-2px 0}
  .or-tag.rel{--c:var(--info)}
  .or-tag.src{--c:var(--accent)}
  .or-cust{display:flex;align-items:baseline;gap:6px;min-width:0;margin-top:5px;font-size:12.5px;white-space:nowrap}
  .or-cust b{font-weight:600;color:var(--text2);overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
  .or-cust span{color:var(--muted);overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1000 auto}
  .or-cust span::before{content:'·';margin-right:6px;color:var(--faint)}
  .or-part{display:flex;flex-direction:column;gap:4px;min-width:0}
  .or-part b{font-weight:600;font-size:14px;line-height:1.2;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-part span{font:500 11.5px/1.2 var(--f-mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-prog{display:flex;flex-direction:column;gap:5px;min-width:0}
  .or-prog-t{display:flex;align-items:baseline;justify-content:space-between;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .or-prog-t b{font:600 17px/1 var(--f-cond);color:var(--text)}
  .or-prog-t span{font-size:11.5px;color:var(--muted)}
  .or-pbar{position:relative;display:block;height:5px;border-radius:3px;background:var(--track);overflow:hidden}
  .or-pbar i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:var(--oc);transition:width .5s ease}
  .or-prog-s{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-prog-s b{color:var(--text2);font-weight:600}
  .or-dates{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;align-items:baseline;font-size:12.5px;font-variant-numeric:tabular-nums}
  .or-dates span{font:600 10px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
  .or-dates b{font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-dates b.eta{color:var(--text)}
  .or-dates small{grid-column:2;font-size:11px;color:var(--muted);margin-top:-2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-risk{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}
  .or-rb{--c:var(--st-run);display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 7px;border-radius:999px;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;color:color-mix(in srgb,var(--c) 82%,white);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 38%,transparent)}
  .or-rb i{width:7px;height:7px;border-radius:50%;background:var(--c)}
  .or-slack{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-variant-numeric:tabular-nums}
  .or-card.r-late .or-slack{color:color-mix(in srgb,var(--st-fault) 70%,var(--text))}
  .or-prio{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--faint);cursor:pointer;justify-self:end}
  .or-prio:hover{color:var(--text);border-color:var(--line2);background:var(--card2)}
  .or-prio.on{color:color-mix(in srgb,var(--st-fault) 85%,white);border-color:color-mix(in srgb,var(--st-fault) 45%,transparent);background:color-mix(in srgb,var(--st-fault) 14%,transparent)}
  .or-prio[hidden]{display:none}
  .or-part-alt{display:none}

  /* Arbeitsplan-Kette */
  .or-chain{display:flex;align-items:stretch;min-width:0;overflow-x:auto;scrollbar-width:none;padding:8px 2px 2px;margin:-6px -2px 0}
  .or-chain::-webkit-scrollbar{display:none}
  .or-step{--c:var(--line2);position:relative;flex:1 1 auto;min-width:96px;max-width:230px;display:flex;align-items:center;gap:8px;padding:6px 9px 9px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg2)}
  .or-st-ic{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;position:relative}
  .or-st-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
  .or-st-l{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:12px;font-weight:600;line-height:1.15;color:var(--text2);white-space:nowrap}
  .or-st-l em{font:500 10px/1 var(--f-mono);font-style:normal;color:var(--faint);flex:none}
  .or-st-l span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-st-s{font-size:11px;line-height:1.15;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-st-bt{position:absolute;left:8px;right:8px;bottom:3px;height:2px;border-radius:1px;background:color-mix(in srgb,var(--c) 16%,transparent);overflow:hidden}
  .or-st-bar{display:block;height:100%;border-radius:inherit;background:var(--c);transition:width .5s ease}
  .or-step.s-done{border-color:color-mix(in srgb,var(--st-run) 22%,var(--line));background:color-mix(in srgb,var(--st-run) 6%,var(--bg2))}
  .or-step.s-done .or-st-ic{background:color-mix(in srgb,var(--st-run) 20%,transparent);color:var(--st-run)}
  .or-step.s-done .or-st-l{color:var(--text2)}
  .or-step.s-done .or-st-bt,.or-step.s-open .or-st-bt{display:none}
  .or-step.s-active{border-color:color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 11%,var(--bg2))}
  .or-step.s-active .or-st-l{color:var(--text)}
  .or-step.s-active .or-st-s{color:var(--text2)}
  .or-step.s-active .or-st-ic::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--c);animation:orPulse 1.8s ease-in-out infinite}
  .or-step.s-ext{--c:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 45%,transparent);background:color-mix(in srgb,var(--st-wait) 9%,var(--bg2))}
  .or-step.s-ext .or-st-ic{color:var(--st-wait)}
  .or-step.s-ext .or-st-l{color:var(--text)}
  .or-step.s-ext .or-st-s{color:color-mix(in srgb,var(--st-wait) 70%,var(--text))}
  .or-step.s-wait .or-st-ic::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--st-idle)}
  .or-step.s-wait .or-st-bt{background:color-mix(in srgb,var(--st-idle) 18%,transparent)}
  .or-step.s-wait .or-st-bar{background:var(--st-idle)}
  .or-step.s-open{border-style:dashed;border-color:var(--line2);background:transparent}
  .or-step.s-open .or-st-ic::before{content:'';width:8px;height:8px;border-radius:50%;border:1.5px solid var(--line2)}
  .or-step.s-open .or-st-l{color:var(--muted)}
  .or-step.s-open .or-st-s{color:var(--faint)}
  .or-step.bn::after{content:'Engpass';position:absolute;top:-7px;right:8px;font:600 8.5px/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;padding:2px 5px 2px;border-radius:4px;color:var(--text2);background:var(--card);border:1px solid var(--line2);white-space:nowrap}
  @keyframes orPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 0%,transparent)}}
  .or-lk{position:relative;flex:0 0 18px;align-self:center;height:2px;background:var(--line2);margin:0 -1px}
  .or-chain.many .or-lk{flex-basis:13px}
  .or-lk::after{content:'';position:absolute;right:-1px;top:50%;width:5px;height:5px;border-top:2px solid var(--line2);border-right:2px solid var(--line2);transform:translateY(-50%) rotate(45deg);border-radius:1px}
  .or-lk.pass{background:color-mix(in srgb,var(--st-run) 55%,var(--line2))}
  .or-lk.pass::after{border-color:color-mix(in srgb,var(--st-run) 55%,var(--line2))}
  .or-lk.rdy{background:color-mix(in srgb,var(--mat) 60%,var(--line2))}
  .or-lk.rdy::after{border-color:var(--mat)}
  .or-lk.flow{height:3px;background:repeating-linear-gradient(90deg,var(--mat) 0 5px,transparent 5px 9px);background-size:9px 3px;animation:orFlow .9s linear infinite}
  .or-lk.flow::after{border-color:var(--mat)}
  @keyframes orFlow{from{background-position:0 0}to{background-position:9px 0}}

  .or-foot{display:flex;align-items:center;gap:6px 16px;min-width:0;font-size:12px;color:var(--text2)}
  .or-now{--c:var(--muted);display:flex;align-items:center;gap:7px;min-width:0;flex:1}
  .or-now > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-now .ico{flex:none;color:var(--c)}
  .or-now b{font-weight:600;color:var(--text)}
  .or-now.warn{--c:var(--st-wait)} .or-now.crit{--c:var(--st-fault)} .or-now.ok{--c:var(--st-run)}
  .or-now.warn > span{color:color-mix(in srgb,var(--st-wait) 40%,var(--text2))}
  .or-now.crit > span{color:color-mix(in srgb,var(--st-fault) 45%,var(--text2))}
  .or-sep{color:var(--faint);margin:0 8px}
  .or-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c);margin-right:7px;vertical-align:1px;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .or-msg{--c:var(--info);display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:40%;padding:2px 8px 2px 7px;border-radius:6px;font-size:11.5px;font-weight:600;color:color-mix(in srgb,var(--c) 80%,var(--text));background:color-mix(in srgb,var(--c) 10%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);white-space:nowrap}
  .or-msg span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-msg .ico{flex:none}
  .or-bn{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;color:var(--muted);white-space:nowrap}
  .or-bn span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-bn .ico{flex:none;color:var(--faint)}
  .or-bn b{font-weight:600;color:var(--text2)}

  .or-donebox{display:flex;flex-direction:column;gap:8px;margin-top:6px}
  .or-done-h{display:flex;align-items:center;gap:10px;width:100%;padding:9px 4px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;text-align:left}
  .or-done-h .ico{transition:transform .2s ease;color:var(--muted)}
  .or-done-h.open .ico{transform:rotate(90deg)}
  .or-done-h small{font-weight:500;color:var(--muted);font-size:12px}
  .or-done-h:hover{color:var(--text)}
  .or-empty{border:1px dashed var(--line2);border-radius:var(--r);background:transparent}
  .or-empty b{display:block;color:var(--text2);font-size:14px;margin-bottom:4px}

  /* Plantafel */
  .or-gbar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
  .or-gbar .seg button{min-width:52px}
  .or-gleg{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0;flex:1;justify-content:flex-end}
  .or-gleg button{--oc:var(--accent);display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px 0 7px;border-radius:7px;border:1px solid var(--line);background:var(--card);color:var(--text2);font:500 11.5px/1 var(--f-mono);cursor:pointer;white-space:nowrap}
  .or-gleg button i{width:9px;height:9px;border-radius:3px;background:var(--oc)}
  .or-gleg button:hover{border-color:var(--line2);color:var(--text)}
  .or-gleg button.on{border-color:var(--oc);background:color-mix(in srgb,var(--oc) 16%,var(--card));color:var(--text)}
  .or-gleg button.risk-spät{box-shadow:inset 0 -2px 0 var(--st-fault)}
  .or-gleg button.risk-knapp{box-shadow:inset 0 -2px 0 var(--st-wait)}
  .or-gsel{--oc:var(--line2);display:flex;align-items:center;gap:8px 12px;min-height:40px;margin:10px 0 8px;padding:6px 8px 6px 12px;border-radius:9px;border:1px solid var(--line);background:var(--card);font-size:12.5px;color:var(--muted);flex-wrap:wrap}
  .or-gsel.on{border-color:color-mix(in srgb,var(--oc) 55%,var(--line));background:color-mix(in srgb,var(--oc) 8%,var(--card));color:var(--text2)}
  .or-gsel .or-sw{width:10px;height:10px}
  .or-gsel b{font-weight:600;color:var(--text)}
  .or-gsel .mono{font-weight:600;color:var(--text)}
  .or-gsel .or-gs-t{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 320px;flex-wrap:wrap}
  .or-gsel .or-gs-t > span{white-space:nowrap}
  .or-gsel .or-gs-a{display:flex;gap:6px;margin-left:auto}
  .or-gsel .or-rb{font-size:11px;line-height:16px;padding:1px 8px 1px 6px}
  .or-gsel .ico{flex:none;color:var(--faint)}
  .or-gcard{--lw:178px;position:relative;display:grid;grid-template-columns:var(--lw) minmax(0,1fr);overflow:hidden;padding:0}
  .or-glabels{border-right:1px solid var(--line);background:var(--card);position:relative;z-index:2}
  .or-gl-h{display:flex;align-items:flex-end;padding:0 12px 7px;font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)}
  .or-gl{--c:var(--st-idle);display:flex;align-items:center;gap:9px;padding:0 10px 0 12px;border-bottom:1px solid var(--line);cursor:pointer;min-width:0;background:transparent;width:100%;border-left:0;border-right:0;border-top:0;color:inherit;text-align:left}
  .or-gl:hover{background:var(--card2)}
  .or-gl i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .or-gl div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .or-gl b{font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-gl small{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-gl small em{font-style:normal;font-family:var(--f-mono);color:var(--faint);margin-right:4px}
  .or-gl.ext{--c:var(--st-wait);cursor:default}
  .or-gl.ext:hover{background:transparent}
  .or-gl.ext i{border-radius:3px}
  .or-gscroll{overflow-x:auto;overflow-y:hidden;position:relative;cursor:grab;scrollbar-width:thin}
  .or-gscroll.drag{cursor:grabbing;user-select:none}
  .or-gsvg{display:block;font-family:var(--f-ui)}
  .or-gsvg text{pointer-events:none}
  .or-gsvg .blk{cursor:pointer;transition:opacity .15s ease}
  .or-gsvg.hl .blk{opacity:.18}
  .or-gsvg.hl .blk.on{opacity:1}
  .or-gsvg.hl .blk.on rect.bf{stroke-width:1.6}
  .or-gsvg .lk{pointer-events:none}
  .or-ltip{position:fixed;z-index:65}
  .or-tip{position:absolute;z-index:6;pointer-events:none;min-width:220px;max-width:300px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;box-shadow:var(--shadow);padding:9px 11px 10px;font-size:12px;line-height:1.45;color:var(--text2)}
  .or-tip-h{display:flex;align-items:center;gap:7px;margin-bottom:3px}
  .or-tip-h i{width:9px;height:9px;border-radius:3px;background:var(--oc);flex:none}
  .or-tip-h b{font:600 12.5px/1.2 var(--f-mono);color:var(--text)}
  .or-tip-h span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-tip-t{font-weight:600;color:var(--text);font-size:12.5px}
  .or-tip-r{display:flex;justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}
  .or-tip-r span{color:var(--muted)}
  .or-tip-r b{font-weight:600;color:var(--text);white-space:nowrap}
  .or-tip-n{margin-top:4px;padding-top:5px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px}
  .or-tip .or-rb{font-size:11px;line-height:16px;padding:1px 7px 1px 6px}
  .or-gkey{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11.5px;color:var(--muted);padding:0 2px}
  .or-gkey span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .or-gkey .k-fc{width:22px;height:12px;border-radius:3px;border:1px solid var(--muted);background:color-mix(in srgb,var(--muted) 25%,transparent)}
  .or-gkey .k-ist{width:22px;height:12px;border-radius:3px;border:1px solid color-mix(in srgb,var(--muted) 40%,transparent);background:color-mix(in srgb,var(--muted) 10%,transparent)}
  .or-gkey .k-su{width:22px;height:12px;border-radius:3px;border:1px solid var(--muted);background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--muted) 55%,transparent) 0 2px,transparent 2px 5px)}
  .or-gkey .k-st{display:inline-flex;gap:1px}
  .or-gkey .k-st i{width:7px;height:4px;background:var(--c)}
  .or-gkey .k-now{width:2px;height:13px;background:var(--accent);border-radius:1px}
  .or-gkey .k-lk{width:22px;height:2px;background:repeating-linear-gradient(90deg,var(--mat) 0 4px,transparent 4px 7px)}
  .or-gkey .k-ext{width:22px;height:12px;border-radius:3px;border:1px dashed var(--muted)}

  /* Detail */
  .or-d-sub{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .or-d-sub .or-sw{width:9px;height:9px}
  .or-hero{--rc:var(--st-run);display:flex;flex-direction:column;gap:11px;padding:13px 14px 13px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--rc) 30%,var(--line));background:linear-gradient(180deg,color-mix(in srgb,var(--rc) 9%,var(--card)),var(--card))}
  .or-hero-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .or-hero-top .or-rb{font-size:13px;line-height:22px;padding:2px 11px 2px 9px}
  .or-hero-top .or-rb i{width:8px;height:8px}
  .or-hero-slack{font-size:13px;font-weight:600;color:var(--text2);font-variant-numeric:tabular-nums}
  .or-hero-d{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .or-hero-d > div{display:flex;flex-direction:column;gap:3px;min-width:0}
  .or-hero-d .eyebrow{font-size:9.5px}
  .or-hero-d b{font:600 19px/1.1 var(--f-cond);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-hero-d small{font-size:11.5px;color:var(--muted);line-height:1.3}
  .or-hero .or-pbar{height:6px}
  .or-hero-n{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.45;color:var(--text2)}
  .or-hero-n .ico{flex:none;margin-top:1px;color:var(--muted)}
  .or-hero-n b{color:var(--text);font-weight:600}
  .or-hero-n.warn .ico{color:var(--st-wait)} .or-hero-n.crit .ico{color:var(--st-fault)} .or-hero-n.ok .ico{color:var(--st-run)}
  .or-nts{display:flex;flex-direction:column;gap:6px}
  .or-nt{--c:var(--info);display:flex;flex-direction:column;gap:3px;padding:9px 11px 10px;border-radius:9px;background:var(--card);border:1px solid var(--line);box-shadow:inset 3px 0 0 var(--c);font-size:12.5px;line-height:1.45;color:var(--text2)}
  .or-nt.ack{opacity:.7}
  .or-nt-h{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--muted)}
  .or-nt-sev{color:color-mix(in srgb,var(--c) 80%,var(--text));font-weight:600}
  .or-nt > b{font-weight:600;color:var(--text);font-size:13px}
  .or-nt p{margin:0}
  .or-nt-s{margin-top:3px;padding:6px 8px;border-radius:7px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 20%,transparent)}
  .or-nt-s b{color:var(--text);font-weight:600}
  .or-nt-a{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
  .or-nt-a:empty{display:none}
  .or-acts{display:flex;flex-wrap:wrap;gap:6px}
  .or-acts .btn{height:30px;font-size:12.5px}
  .or-acts .btn.on{color:color-mix(in srgb,var(--st-fault) 85%,white);border-color:color-mix(in srgb,var(--st-fault) 45%,transparent);background:color-mix(in srgb,var(--st-fault) 10%,transparent)}
  .or-sec h4{display:flex;align-items:center;gap:8px}
  .or-sec h4 .spacer{flex:1}
  .or-sec h4 small{font:500 11.5px/1 var(--f-ui);letter-spacing:0;text-transform:none;color:var(--faint)}
  .or-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 14px;padding:12px 13px;background:var(--card);border:1px solid var(--line);border-radius:var(--r)}
  .or-facts > div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .or-facts span{font:600 9.5px/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  .or-facts b{font-weight:500;font-size:13px;color:var(--text2);overflow-wrap:anywhere}
  .or-facts .wide{grid-column:1/-1}
  .or-dchain{display:flex;flex-wrap:wrap;gap:5px 0;margin:0 0 12px;padding:0;overflow:visible}
  .or-dchain .or-step{flex:0 0 auto;min-width:0;max-width:none;padding:4px 8px 4px 6px;gap:6px;cursor:pointer}
  .or-dchain .or-st-ic{width:14px;height:14px}
  .or-dchain .or-st-ic .ico{width:10px;height:10px}
  .or-dchain .or-step.s-active .or-st-ic::before,.or-dchain .or-step.s-wait .or-st-ic::before,.or-dchain .or-step.s-open .or-st-ic::before{width:7px;height:7px}
  .or-dchain .or-st-l{font-size:11.5px}
  .or-dchain .or-lk{flex-basis:12px}
  .or-dchain .or-step.bn::after{display:none}
  .or-ops{display:flex;flex-direction:column}
  .or-op{--c:var(--line2);display:grid;grid-template-columns:22px minmax(0,1fr);gap:0 10px}
  .or-op-rail{position:relative;display:flex;justify-content:center}
  .or-op-rail::before{content:'';position:absolute;top:22px;bottom:-4px;width:2px;background:var(--line);border-radius:1px}
  .or-op:last-child .or-op-rail::before{display:none}
  .or-op.s-done .or-op-rail::before{background:color-mix(in srgb,var(--st-run) 40%,var(--line))}
  .or-op-node{position:relative;z-index:1;margin-top:3px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--panel);border:2px solid var(--c);color:var(--c)}
  .or-op.s-done .or-op-node{background:color-mix(in srgb,var(--st-run) 22%,var(--panel));border-color:color-mix(in srgb,var(--st-run) 70%,transparent)}
  .or-op.s-active .or-op-node::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--c)}
  .or-op.s-open .or-op-node{border-style:dashed}
  .or-op-b{display:flex;flex-direction:column;gap:6px;min-width:0;padding-bottom:16px}
  .or-op-h{display:flex;align-items:center;gap:8px;min-width:0}
  .or-op-h em{font:600 11px/1 var(--f-mono);font-style:normal;color:var(--muted);flex:none}
  .or-op-h b{font-weight:600;font-size:13.5px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .or-op-h .pill{flex:none}
  .or-op-m{font-size:12px;color:var(--muted);line-height:1.45}
  .or-op-m .link{font-weight:600}
  .or-op-c{font-size:12px;line-height:1.45;color:var(--text2);padding:6px 9px;border-radius:7px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 22%,transparent)}
  .or-op-q{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;border-radius:7px;overflow:hidden;background:var(--line);border:1px solid var(--line)}
  .or-op-q > div{display:flex;flex-direction:column;gap:2px;padding:5px 8px 6px;background:var(--card);min-width:0}
  .or-op-q span{font:600 9.5px/1.2 var(--f-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-op-q b{font:600 15px/1.1 var(--f-cond);color:var(--text);font-variant-numeric:tabular-nums}
  .or-op-q b small{font:500 11px/1 var(--f-ui);color:var(--muted);margin-left:2px}
  .or-op-q .z b{color:var(--faint)}
  .or-op-q .bad b{color:var(--st-fault)}
  .or-op-t{display:flex;flex-wrap:wrap;gap:3px 14px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  .or-op-t b{color:var(--text2);font-weight:600}
  .or-op .bar{height:4px}
  .or-mat{display:flex;flex-direction:column;gap:6px}
  .or-mt{--c:var(--st-idle);display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 10px;border-radius:9px;background:var(--card);border:1px solid var(--line);cursor:pointer}
  .or-mt:hover{border-color:var(--line2)}
  .or-mt-ic{grid-column:1;grid-row:1/3;width:28px;height:28px;border-radius:7px;display:grid;place-items:center;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
  .or-mt-a{grid-column:2;grid-row:1;display:flex;align-items:baseline;gap:7px;min-width:0;font-size:12.5px}
  .or-mt-a b{font:600 12px/1.2 var(--f-mono);color:var(--text);white-space:nowrap;flex:none}
  .or-mt-a span{color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-mt-w{grid-column:2;grid-row:2;font-size:12px;color:var(--muted);min-width:0;overflow-wrap:anywhere;line-height:1.35}
  .or-mt-st{grid-column:3;grid-row:1/3;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .or-mt-st .chip{font-size:11px}
  .or-mt-st .link{font-size:11.5px}
  .or-mt.c-transit{--c:var(--mat)} .or-mt.c-ready{--c:var(--mat)} .or-mt.c-filling{--c:var(--info)} .or-mt.c-external{--c:var(--st-wait)} .or-mt.c-input{--c:var(--st-idle)} .or-mt.c-proc{--c:var(--st-run)}
  .or-msum{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--muted);padding:2px 2px 0}
  .or-msum b{color:var(--text2);font-weight:600}
  .or-ev{display:grid;grid-template-columns:auto 18px minmax(0,1fr);gap:2px 9px;align-items:start;padding:7px 2px;border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.42}
  .or-ev:last-child{border-bottom:0}
  .or-ev time{font:500 11.5px/1.42 var(--f-mono);color:var(--muted);white-space:nowrap}
  .or-ev .ico{color:var(--c,var(--muted));margin-top:1px}
  .or-ev span{color:var(--text2);overflow-wrap:anywhere}
  .or-more{margin-top:6px}
  .or-mv{display:flex;flex-direction:column;gap:14px}
  .or-mv-op{display:flex;flex-direction:column;gap:8px}
  .or-mv-h{display:flex;align-items:baseline;gap:8px;font-size:13px}
  .or-mv-h em{font:600 11px/1 var(--f-mono);font-style:normal;color:var(--muted)}
  .or-mv-h b{font-weight:600}
  .or-mv-h span{color:var(--muted);font-size:12px}
  .or-mv-c{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px}
  .or-mv-c button{--c:var(--st-idle);display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:9px 11px;border-radius:9px;border:1px solid var(--line2);background:var(--card);color:var(--text);cursor:pointer;text-align:left}
  .or-mv-c button:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--card))}
  .or-mv-c button b{font-weight:600;font-size:13px}
  .or-mv-c button b em{font:500 11px/1 var(--f-mono);font-style:normal;color:var(--muted);margin-left:5px}
  .or-mv-c button small{font-size:11.5px;color:var(--muted);line-height:1.35}
  .or-mv-c button .pill{font-size:10.5px;line-height:15px}
  .or-mv-msg{font-size:12.5px;line-height:1.45;padding:8px 10px;border-radius:8px;color:var(--text2);background:color-mix(in srgb,var(--st-wait) 9%,var(--bg2));border:1px solid color-mix(in srgb,var(--st-wait) 32%,transparent)}
  .or-mv-none{font-size:12.5px;color:var(--muted);line-height:1.45}

  /* Kette passt sich der Kartenbreite an: erledigte Schritte werden zuerst verdichtet */
  @container orcard (max-width:1100px){
    .or-chain:not(.or-dchain) .or-step.s-done{flex:0 0 auto;min-width:0}
    .or-chain:not(.or-dchain) .or-step.s-done .or-st-s,.or-chain:not(.or-dchain) .or-st-l em{display:none}
  }
  @container orcard (max-width:900px){
    .or-chain:not(.or-dchain) .or-step.s-done{padding:6px 7px 9px}
    .or-chain:not(.or-dchain) .or-step.s-done .or-st-tx{display:none}
    .or-chain:not(.or-dchain) .or-step:not(.s-done){min-width:118px}
    .or-chain:not(.or-dchain){-webkit-mask-image:linear-gradient(90deg,var(--bg) calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,var(--bg) calc(100% - 24px),transparent);padding-right:20px}
    .or-chain.many .or-lk{flex-basis:11px}
  }
  @media (max-width:1180px){
    .or-cust span{display:none}
    .or-part-alt span{display:none}
  }
  @media (max-width:1380px){
    .or-thead,.or-top{grid-template-columns:minmax(0,1.3fr) 160px 192px 128px 34px;gap:14px}
    .or-thead .h-part,.or-top .or-part{display:none}
    .or-part-alt{display:block;margin-top:4px;font-size:12.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .or-part-alt span{font:500 11px/1 var(--f-mono);color:var(--muted);margin-left:6px}
  }
  @media (max-width:1180px){
    .or-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}
    .or-kpis > .kpi{grid-column:span 2}
    .or-kpis > .or-k-risk{grid-column:span 4}
  }
  @media (max-width:760px){
    .or-kpis{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -16px;padding:0 16px;scroll-padding:0 16px}
    .or-kpis::-webkit-scrollbar{display:none}
    .or-kpis > .kpi{flex:0 0 44%;scroll-snap-align:start}
    .or-kpis > .or-k-risk{flex-basis:80%}
    .or-gsel:not(.on){display:none}
    .or-thead{display:none}
    .or-card{padding:12px 12px 11px 14px;gap:10px}
    .or-top{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) 32px;grid-template-areas:"id risk act" "prog date date";gap:10px 12px;align-items:start}
    .or-ident{grid-area:id}
    .or-risk{grid-area:risk;align-items:flex-end;text-align:right}
    .or-prio{grid-area:act}
    .or-prog{grid-area:prog;align-self:end}
    .or-dates{grid-area:date;align-self:end}
    .or-chain:not(.or-dchain) .or-step:not(.s-done){min-width:124px}
    .or-kpis > .or-k-risk{order:-1}
    .or-op-q span{letter-spacing:.04em}
    .or-foot{flex-wrap:wrap}
    .or-bn{flex-basis:100%}
    .or-search{flex:1 1 100%;margin-left:0}
    .or-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -2px;padding:0 2px}
    .or-chips::-webkit-scrollbar{display:none}
    .or-gcard{--lw:104px}
    .or-gl{padding:0 6px 0 9px;gap:7px}
    .or-gl small{display:none}
    .or-gl b{font-size:11.5px}
    .or-gleg{justify-content:flex-start;flex-basis:100%;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
    .or-gleg::-webkit-scrollbar{display:none}
    .or-gleg button{flex:none}
    .or-kpis .kpi{padding:9px 12px 9px}
    .or-kpis .kpi .v{font-size:24px}
    .or-rk b{font-size:22px}
    .or-hero-d{grid-template-columns:repeat(2,minmax(0,1fr))}
    .or-hero-d > div:last-child{grid-column:1/-1}
  }
  @media (max-width:440px){
    .or-op-q > div{padding:5px 6px 6px}
    .or-mt{grid-template-columns:28px minmax(0,1fr)}
    .or-mt-st{grid-column:2;grid-row:3;flex-direction:row;align-items:center;justify-content:flex-start;gap:8px;margin-top:3px}
  }
  `, 'or-css');

  // ------------------------------------------------------------------ Zustand der Ansicht
  const saved = store.get();
  let root = null, R = null;
  let mode = saved.mode === 'gantt' ? 'gantt' : 'list';
  let filter = ['alle', 'risk', 'work', 'done'].includes(saved.filter) ? saved.filter : 'alle';
  let doneOpen = !!saved.doneOpen;
  let query = '';
  let selectedOrder = null;
  const cards = {};
  let listOrderSig = '', doneOrderSig = '';
  let lastViews = null;

  function collect() {
    const s = S(); const out = [];
    for (const id in s.orders) { const v = WF.sim.orderView(id); if (v) out.push(v); }
    return out;
  }
  const cmpOpen = (a, b) => (RISK_RANK[a.risk] - RISK_RANK[b.risk]) || (a.due - b.due) || (a.id < b.id ? -1 : 1);
  const cmpDone = (a, b) => (b.doneT || 0) - (a.doneT || 0) || (a.id < b.id ? -1 : 1);
  const hay = (v) => (v.id + ' ' + v.customer + ' ' + (v.sector || '') + ' ' + v.part.name + ' ' + (v.part.no || '') + ' ' + (v.part.material || '')).toLowerCase();

  // ------------------------------------------------------------------ Aufbau
  function mount(el) {
    root = el;
    el.innerHTML = `
    <div class="or-root">
      <div class="view-h or-head">
        <div>
          <h1 class="view-t">Aufträge</h1>
          <p class="view-sub" data-r="sub">–</p>
        </div>
        <div class="or-head-r">
        <button type="button" class="btn" data-r="newBtn" hidden title="Zeichnung hochladen – die KI erstellt Arbeitsplan, Zeiten, Preis und Liefertermin">${icon('sparkles', 15)}Neuer Auftrag aus Zeichnung</button>
        <div class="seg or-mode" role="tablist" aria-label="Darstellung" data-r="modeSeg">
          <button data-mode="list" role="tab">${icon('list', 15)}Auftragsliste</button>
          <button data-mode="gantt" role="tab">${icon('layers', 15)}Plantafel</button>
        </div>
        </div>
      </div>

      <div class="or-kpis" data-r="kpis">
        <div class="kpi" title="Freigegebene und laufende Fertigungsaufträge, noch nicht vollständig versandt">
          <div class="l">Offene Aufträge</div><div class="v" data-r="kOpen">–</div><div class="s" data-r="kOpenS">–</div>
        </div>
        <div class="kpi or-k-risk" title="Terminlage laut Liefertermin-Prognose: Im Plan = mehr als 4 h Puffer, Knapp = weniger als 4 h Puffer, Verspätet = Prognose nach dem Liefertermin">
          <div class="l">Terminlage offener Aufträge</div>
          <div class="or-rk" data-r="rk">
            <button type="button" data-rf="ok" style="--c:var(--st-run)"><b data-r="rOk">–</b><span><i></i>Im Plan</span></button>
            <button type="button" data-rf="knapp" style="--c:var(--st-wait)"><b data-r="rKn">–</b><span><i></i>Knapp</span><em data-r="rKnI"></em></button>
            <button type="button" data-rf="spät" style="--c:var(--st-fault)"><b data-r="rLt">–</b><span><i></i>Verspätet</span><em data-r="rLtI"></em></button>
          </div>
          <div class="or-rbar" aria-hidden="true"><i data-r="bOk" style="--c:var(--st-run)"></i><i data-r="bKn" style="--c:var(--st-wait)"></i><i data-r="bLt" style="--c:var(--st-fault)"></i></div>
        </div>
        <div class="kpi" title="Heute an den Versand übergebene Teile (alle Aufträge)">
          <div class="l">Heute versandt</div><div class="v" data-r="kShip">–</div><div class="s" data-r="kShipS">–</div>
        </div>
        <div class="kpi" title="Anteil der Aufträge, die termingerecht und vollständig geliefert werden – fertige Aufträge tatsächlich, offene laut Prognose">
          <div class="l">Termintreue</div><div class="v" data-r="kOt">–</div><div class="s" data-r="kOtS">–</div>
        </div>
        <div class="kpi click" data-r="kExt" title="Teile, die gerade beim Härtepartner sind – Klick zeigt die Plantafel mit der Fremdbearbeitung">
          <div class="l">Fremdbearbeitung</div><div class="v" data-r="kExtV">–</div><div class="s" data-r="kExtS">–</div>
        </div>
      </div>

      <section class="or-pane" data-r="paneList" aria-label="Auftragsliste">
        <div class="or-bar">
          <div class="or-chips" role="group" aria-label="Filter" data-r="chips">
            <button type="button" class="or-fchip" data-f="alle">Alle <b data-r="fAll">0</b></button>
            <button type="button" class="or-fchip" data-f="risk"><span class="or-fdot"></span>Gefährdet <b data-r="fRisk">0</b></button>
            <button type="button" class="or-fchip" data-f="work">In Arbeit <b data-r="fWork">0</b></button>
            <button type="button" class="or-fchip" data-f="done">Fertig <b data-r="fDone">0</b></button>
          </div>
          <label class="or-search">${icon('search', 15)}<input class="input" type="search" data-r="q" placeholder="Auftrag, Kunde oder Teil suchen" aria-label="Aufträge durchsuchen" autocomplete="off" spellcheck="false"><button type="button" data-r="qClear" title="Suche leeren" aria-label="Suche leeren" hidden>${icon('x', 14)}</button></label>
        </div>
        <div class="or-thead" aria-hidden="true" data-r="thead"><span>Auftrag · Kunde</span><span class="h-part">Teil</span><span>Fortschritt</span><span>Liefertermin</span><span>Terminlage</span><span></span></div>
        <div class="or-list" data-r="list" style="margin-top:6px"></div>
        <div class="empty or-empty" data-r="empty" hidden></div>
        <div class="or-donebox" data-r="doneBox">
          <button type="button" class="or-done-h" data-r="doneH">${icon('chevron', 15)}<span data-r="doneT">Abgeschlossene Aufträge</span><small data-r="doneS"></small></button>
          <div class="or-list" data-r="doneList"></div>
        </div>
        <div class="or-legend" aria-label="Legende Arbeitsplan" style="margin-top:12px">
          <span><span class="or-lgs" style="--c:var(--st-run)"></span>Fertig</span>
          <span><span class="or-lgs" style="--c:var(--st-setup)"></span>In Bearbeitung (Farbe = Maschinenzustand)</span>
          <span><span class="or-lgs" style="--c:var(--st-wait)"></span>Fremdbearbeitung</span>
          <span><span class="or-lgs" style="--c:var(--st-idle)"></span>Teile angekommen, wartet</span>
          <span><span class="or-lgs open"></span>Noch offen</span>
          <span><span class="or-lgf"></span>Behälter unterwegs</span>
        </div>
      </section>

      <section class="or-pane" data-r="paneGantt" aria-label="Plantafel" hidden></section>
    </div>`;
    R = refs(el);
    R.modeSeg.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    R.newBtn.onclick = () => WF.app.navigate('ki-auftrag');
    R.chips.querySelectorAll('[data-f]').forEach(b => b.onclick = () => setFilter(b.dataset.f));
    R.rk.querySelectorAll('[data-rf]').forEach(b => b.onclick = () => { setMode('list'); setFilter(b.dataset.rf === 'ok' ? 'alle' : 'risk'); });
    R.kExt.onclick = () => { setMode('gantt'); requestAnimationFrame(() => { if (G.ready) ganttScrollToNow(true); }); };
    R.q.addEventListener('input', () => { query = R.q.value.trim().toLowerCase(); R.qClear.hidden = !query; update(); });
    R.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { R.q.value = ''; query = ''; R.qClear.hidden = true; update(); } });
    R.qClear.onclick = () => { R.q.value = ''; query = ''; R.qClear.hidden = true; R.q.focus(); update(); };
    R.doneH.onclick = () => { doneOpen = !doneOpen; store.set({ doneOpen }); update(); };
    const onListClick = (e) => {
      const card = e.target.closest('.or-card'); if (!card) return;
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'prio') { e.stopPropagation(); togglePriority(card.dataset.id); return; }
      WF.app.select('order', card.dataset.id);
    };
    const onListKey = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('or-card')) { e.preventDefault(); WF.app.select('order', e.target.dataset.id); }
    };
    R.list.addEventListener('click', onListClick); R.doneList.addEventListener('click', onListClick);
    R.list.addEventListener('keydown', onListKey); R.doneList.addEventListener('keydown', onListKey);
    // Tooltip für Arbeitsplan-Schritte und Materialfluss-Verbindungen
    const onTipMove = (e) => {
      const ch = e.target.closest && e.target.closest('.or-step, .or-lk');
      if (!ch) { hideListTip(); return; }
      showListTip(ch);
    };
    for (const box of [R.list, R.doneList]) { box.addEventListener('mouseover', onTipMove); box.addEventListener('mouseleave', hideListTip); }
    el.addEventListener('scroll', hideListTip, { passive: true });
    WF.bus.on('select', (s) => {
      selectedOrder = s && s.kind === 'order' ? s.id : null;
      for (const id in cards) cards[id].el.classList.toggle('sel', id === selectedOrder);
      // Plantafel folgt der Auswahl: gewählter Auftrag wird hervorgehoben, beim Schließen wieder aufgehoben
      if (selectedOrder && S().orders[selectedOrder] && S().orders[selectedOrder].status !== 'fertig') { G.pin = selectedOrder; G.pinFromSel = true; }
      else if (!s || !s.kind) { if (G.pinFromSel) { G.pin = null; G.pinFromSel = false; } }
      if (R.gleg) { R.gleg.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x.dataset.o === G.pin)); if (mode === 'gantt') setHL(G.hov || G.pin); }
    });
    WF.bus.on('sim:reset', () => { G.dirty = true; G.pin = null; G.needScroll = true; listOrderSig = ''; doneOrderSig = ''; if (R.gleg) R.gleg._sig = null; });
    ganttMount(R.paneGantt);
    applyMode();
  }

  function setMode(m) {
    if (m !== 'list' && m !== 'gantt') return;
    if (mode === m) return;
    mode = m; store.set({ mode });
    hideListTip(); hideTip();
    applyMode();
    update();
  }
  function applyMode() {
    R.modeSeg.querySelectorAll('[data-mode]').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    R.paneList.hidden = mode !== 'list';
    R.paneGantt.hidden = mode !== 'gantt';
    if (mode === 'gantt') { G.dirty = true; G.needScroll = G.needScroll || !G.ready; G.entering = true; }
  }
  function setFilter(f) {
    filter = f; store.set({ filter });
    R.chips.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    update();
  }

  function togglePriority(id) {
    const s = S(), o = s && s.orders[id]; if (!o) return;
    if (o.status === 'fertig') { WF.app.toast('Auftrag ist bereits fertig – Priorität nicht mehr änderbar', 'warn'); return; }
    const to = o.priority === 'eil' ? 'normal' : 'eil';
    const before = WF.sim.orderView(id);
    const r = WF.sim.actions.setPriority(id, to);
    if (!r || r.ok === false) { WF.app.toast((r && r.msg) || 'Priorität konnte nicht geändert werden', 'warn'); return; }
    const after = WF.sim.orderView(id);
    const now = s.t;
    let body = to === 'eil'
      ? 'Die Maschinen ziehen den Auftrag bei jedem Auftragswechsel vor – laufende Teile werden nicht unterbrochen.'
      : 'Reihenfolge wieder nach Liefertermin.';
    if (before && after && before.etaRaw != null && after.etaRaw != null && Math.abs(after.etaRaw - before.etaRaw) >= 600)
      body += ` Neu gerechnete Prognose: ${tShort(before.etaRaw, now)} → ${tShort(after.etaRaw, now)} (wird mit der nächsten Planrechnung bestätigt).`;
    else body += ' Die Prognose ändert sich dadurch kaum.';
    WF.app.toast(body, 'ok', { title: r.msg, ms: 6500, onClick: () => WF.app.select('order', id) });
    update();
    if (WF.app.selected && WF.app.selected.kind === 'order' && WF.app.selected.id === id) WF.app.refreshDrawer();
  }

  // ------------------------------------------------------------------ Kennzahlen
  function updateKpis(views, now) {
    const open = views.filter(v => v.status !== 'fertig');
    const cnt = { ok: 0, knapp: 0, 'spät': 0, unbekannt: 0 };
    for (const v of open) cnt[v.risk] = (cnt[v.risk] || 0) + 1;
    const inWork = open.filter(v => v.status === 'in Arbeit').length;
    const eil = open.filter(v => v.priority === 'eil').length;
    setHTML(R.kOpen, open.length < views.length ? `${nf(open.length)}<small>von ${nf(views.length)}</small>` : nf(open.length));
    setHTML(R.kOpenS, `<b>${nf(inWork)}</b> in Arbeit · <b>${nf(open.length - inWork)}</b> freigegeben${eil ? ` · <b>${nf(eil)}</b> Eil` : ''}`);
    setText(R.rOk, nf(cnt.ok)); setText(R.rKn, nf(cnt.knapp)); setText(R.rLt, nf(cnt['spät']));
    const idsOf = (k) => { const l = open.filter(v => v.risk === k).sort((a, b) => a.due - b.due).map(v => numId(v.id)); return l.length > 3 ? l.slice(0, 2).join(' ') + ' +' + (l.length - 2) : l.join(' '); };
    setText(R.rKnI, idsOf('knapp')); setText(R.rLtI, idsOf('spät'));
    const tot = Math.max(1, open.length);
    setW(R.bOk, cnt.ok / tot); setW(R.bKn, cnt.knapp / tot); setW(R.bLt, cnt['spät'] / tot);
    R.rk.querySelectorAll('[data-rf]').forEach(b => {
      const k = b.dataset.rf; b.classList.toggle('zero', !cnt[k]);
      b.classList.toggle('on', filter === 'risk' && (k === 'knapp' || k === 'spät') && mode === 'list');
    });
    const k = WF.sim.kpis();
    const day0 = dayOf(now) * DAY;
    const doneToday = views.filter(v => v.status === 'fertig' && v.doneT != null && v.doneT >= day0).length;
    setHTML(R.kShip, `${nf(k.shippedToday || 0)}<small>Stk</small>`);
    setHTML(R.kShipS, doneToday ? `<b>${nf(doneToday)}</b> ${doneToday === 1 ? 'Auftrag' : 'Aufträge'} abgeschlossen` : 'noch kein Auftrag komplett');
    const okN = views.filter(v => v.status === 'fertig' ? v.onTime : !v.late).length;
    setHTML(R.kOt, U.fmtPct(k.onTimePct));
    setHTML(R.kOtS, `<b>${nf(okN)}</b> von ${nf(views.length)} termingerecht`);
    // Fremdbearbeitung: Behälter beim Partner (eine Wahrheit: state.containers)
    const s = S(); let q = 0, nextT = null; const lots = new Set();
    for (const cid in s.containers) {
      const c = s.containers[cid]; if (c.state !== 'external' || !c.location) continue;
      q += c.qty; lots.add(c.orderId + '|' + c.location.sentT);
      if (c.location.returnT != null && (nextT == null || c.location.returnT < nextT)) nextT = c.location.returnT;
    }
    setHTML(R.kExtV, `${nf(q)}<small>Stk</small>`);
    setHTML(R.kExtS, q ? `${nf(lots.size)} ${lots.size === 1 ? 'Los' : 'Lose'} · zurück ab <b>${esc(tShort(nextT, now))}</b>` : 'keine Teile beim Härtepartner');
    const fc = WF.sim.forecast();
    setHTML(R.sub, `<span>${nf(views.length)} Fertigungsaufträge</span><span class="faint">·</span><span>Liefertermin-Prognose aus Live-Daten, Stand ${esc(U.fmtClock(fc.t))}</span>`);
    // Filterzähler
    setText(R.fAll, nf(open.length));
    setText(R.fRisk, nf(cnt.knapp + cnt['spät']));
    setText(R.fWork, nf(inWork));
    setText(R.fDone, nf(views.length - open.length));
    const riskChip = R.chips.querySelector('[data-f="risk"]');
    setVar(riskChip, '--c', cnt['spät'] ? 'var(--st-fault)' : cnt.knapp ? 'var(--st-wait)' : 'var(--st-run)');
  }

  // ------------------------------------------------------------------ Auftragskarten
  function buildCard(id) {
    const el = document.createElement('article');
    el.className = 'or-card'; el.dataset.id = id; el.tabIndex = 0;
    el.setAttribute('aria-label', 'Auftrag ' + id + ' öffnen');
    el.innerHTML = `
      <div class="or-top">
        <div class="or-ident">
          <div class="or-l1"><span class="or-sw"></span><span class="or-id" data-r="id"></span><span class="or-tag eil" data-r="eil" hidden>${icon('bolt', 11)}Eilauftrag</span><span class="or-tag" data-r="stat" hidden></span></div>
          <div class="or-cust"><b data-r="cust"></b><span data-r="sect"></span></div>
          <div class="or-part-alt" data-r="partAlt"></div>
        </div>
        <div class="or-part"><b data-r="pn"></b><span data-r="pno"></span></div>
        <div class="or-prog">
          <div class="or-prog-t"><b data-r="pct"></b><span data-r="qty"></span></div>
          <span class="or-pbar"><i data-r="pbar"></i></span>
          <div class="or-prog-s" data-r="pS"></div>
        </div>
        <div class="or-dates"><span>Termin</span><b data-r="due"></b><span data-r="etaL">Prognose</span><b class="eta" data-r="eta"></b><small data-r="etaS" hidden></small></div>
        <div class="or-risk"><span class="or-rb" data-r="rb"><i></i><span data-r="rbT"></span></span><span class="or-slack" data-r="slack"></span></div>
        <button type="button" class="or-prio" data-r="prio" data-act="prio">${icon('bolt', 16)}</button>
      </div>
      <div class="or-chain" data-r="chain" aria-label="Arbeitsplan"></div>
      <div class="or-foot"><span class="or-now" data-r="now"><span data-r="nowIc"></span><span data-r="nowT"></span></span><span class="or-msg" data-r="msg" hidden>${icon('bell', 13)}<span data-r="msgT"></span></span><span class="or-bn" data-r="bn" hidden>${icon('gauge', 14)}<span data-r="bnT"></span></span></div>`;
    const c = { el, r: refs(el), chips: [], links: [], nOps: -1 };
    if (selectedOrder === id) el.classList.add('sel');
    return c;
  }
  function buildChain(box, ops, compact) {
    box.innerHTML = '';
    const chips = [], links = [];
    ops.forEach((op, i) => {
      if (i > 0) { const lk = document.createElement('span'); lk.className = 'or-lk'; box.append(lk); links[i] = lk; }
      const ch = document.createElement('div');
      ch.className = 'or-step';
      ch.innerHTML = `<span class="or-st-ic"></span><span class="or-st-tx"><span class="or-st-l"><em></em><span></span></span>${compact ? '' : '<span class="or-st-s"></span>'}</span>${compact ? '' : '<i class="or-st-bt"><i class="or-st-bar"></i></i>'}`;
      const q = (s) => ch.querySelector(s);
      chips.push({ el: ch, ic: q('.or-st-ic'), sq: q('.or-st-l em'), lb: q('.or-st-l span'), sb: q('.or-st-s'), bar: q('.or-st-bar') });
      box.append(ch);
    });
    return { chips, links };
  }
  const ICON_DONE = icon('check', 12), ICON_EXT = icon('truck', 12);
  function patchChain(c, v, now) {
    const ops = v.ops;
    if (c.nOps !== ops.length) { const b = buildChain(c.box, ops, c.compact); c.chips = b.chips; c.links = b.links; c.nOps = ops.length; c.box.classList.toggle('many', ops.length >= 7); }
    const transit = {}, ready = {};
    for (const ct of v.containers) {
      if (ct.state === 'transit' && ct.seq != null) (transit[ct.seq] = transit[ct.seq] || []).push(ct);
      else if (ct.state === 'ready' && ct.srcSeq != null) (ready[ct.srcSeq] = ready[ct.srcSeq] || []).push(ct);
    }
    const bn = v.status !== 'fertig' ? bnSeq(v) : null;
    ops.forEach((op, i) => {
      const ch = c.chips[i]; const vis = opVis(op);
      setCls(ch.el, 'or-step s-' + vis.k + (bn === op.seq && op.state !== 'done' ? ' bn' : ''));
      setVar(ch.el, '--c', vis.c);
      setHTML(ch.ic, vis.k === 'done' ? ICON_DONE : vis.k === 'ext' ? ICON_EXT : '');
      setText(ch.sq, String(op.seq));
      setText(ch.lb, stLabel(op));
      if (ch.sb) setText(ch.sb, chipSub(op, v, now));
      if (ch.bar) setW(ch.bar, chipFrac(op, v));
      ch.el._op = op; ch.el._oid = v.id;
      if (c.compact) setAttr(ch.el, 'title', chipTitle(op, v, now)); else setAttr(ch.el, 'aria-label', chipTitle(op, v, now).replace(/\n/g, ' · '));
      if (i > 0) {
        const lk = c.links[i], prev = ops[i - 1];
        const tr = transit[op.seq], rd = ready[prev.seq];
        let cls = 'or-lk', tip = null;
        if (tr && tr.length) { cls += ' flow'; tip = tr.map(x => `${x.id}: ${nf(x.qty)} Stk ${x.where}`).join('\n'); }
        else if (rd && rd.length) { cls += ' rdy'; tip = rd.map(x => `${x.id}: ${nf(x.qty)} Stk abholbereit – ${x.where}`).join('\n'); }
        else if (op.received > 0 || op.state === 'done' || (op.station === 'VERSAND' && op.good > 0)) cls += ' pass';
        setCls(lk, cls); lk._tip = tip; lk._oid = v.id;
      }
    });
  }
  function listTipHtml(node) {
    const s = S(), now = s.t;
    const v = lastViews && lastViews.find(x => x.id === node._oid); if (!v) return '';
    if (node.classList.contains('or-lk')) {
      if (!node._tip) return '';
      return `<div class="or-tip-t">${node.classList.contains('flow') ? 'Behälter unterwegs' : 'Behälter abholbereit'}</div>` + node._tip.split('\n').map(l => `<div>${esc(l)}</div>`).join('');
    }
    const op = node._op; if (!op) return '';
    const vis = opVis(op);
    const st = op.state === 'active' ? WF.ui.pill(op.machineState) : `<span class="pill" style="--c:${op.state === 'open' ? 'var(--faint)' : vis.c}"><i></i>${esc(vis.label)}</span>`;
    const where = op.station === 'EXT' ? (op.ext ? `${op.ext.partner} · ${op.ext.process}` : 'Fremdbearbeitung') : op.station === 'VERSAND' ? 'Fertigteillager & Versand' : `${op.stationName} (${op.station})`;
    let h = `<div class="or-tip-h" style="--oc:${colorOf(v.id)}"><i></i><b>${esc(v.id)}</b><span>AG ${op.seq} · ${esc(op.op)}</span></div><div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin:2px 0 5px"><span class="muted">${esc(where)}</span>${st}</div>`;
    if (op.state === 'active' && op.cause) h += `<div style="color:var(--text);margin-bottom:4px">${esc(cleanCause(op.cause, v.id))}</div>`;
    if (op.station === 'EXT') { const t = extText(v, op, now); if (t) h += `<div style="color:var(--text);margin-bottom:4px">${esc(t)}</div>`; }
    const row = (l, val) => `<div class="or-tip-r"><span>${esc(l)}</span><b>${esc(val)}</b></div>`;
    if (op.station === 'VERSAND') h += row('Versandt', `${nf(op.good)} / ${nf(v.qty)} Stk`);
    else if (op.station !== 'EXT') {
      h += row('Eingang · Gut · Ausschuss', `${nf(op.received)} · ${nf(op.good)} · ${nf(op.scrap)}`);
      if (op.waiting || op.inProc) h += row('Wartet · in Bearbeitung', `${nf(op.waiting)} · ${nf(op.inProc)}`);
    }
    if (op.state === 'done') h += row('Ist', op.endT != null && op.endT <= simStartT() ? 'vor ' + U.fmtDayClock(simStartT()) : `${tAct(op.startT, now)} – ${tAct(op.endT, now)}`);
    else {
      if (op.startT != null && (op.received > 0 || op.good > 0)) h += row('Begonnen', tAct(op.startT, now));
      else if (op.plannedStart != null) h += row('Start ca.', tShort(op.plannedStart, now));
      if (op.plannedEnd != null) h += row(op.station === 'VERSAND' ? 'Komplett ca.' : 'Fertig ca.', tShort(op.station === 'VERSAND' && v.eta != null ? v.eta : op.plannedEnd, now));
    }
    if (bnSeq(v) === op.seq && v.status !== 'fertig') h += `<div class="or-tip-n">Engpass laut Prognose: längster Arbeitsgang dieses Auftrags</div>`;
    return h;
  }
  let listTipNode = null;
  function showListTip(node) {
    const html = listTipHtml(node);
    if (!html) { hideListTip(); return; }
    let tip = R.ltip;
    if (!tip) { tip = R.ltip = document.createElement('div'); tip.className = 'or-tip or-ltip'; tip.hidden = true; document.body.append(tip); }
    if (tip._h !== html) { tip._h = html; tip.innerHTML = html; }
    tip.hidden = false;
    listTipNode = node;
    const r = node.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight, vw = window.innerWidth;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 64) y = r.bottom + 8;
    x = Math.max(8, Math.min(vw - tw - 8, x));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideListTip() { listTipNode = null; if (R && R.ltip) R.ltip.hidden = true; }
  function updateCard(c, v, now) {
    const r = c.r;
    const rb = riskBadge(v);
    const late = v.status !== 'fertig' && v.risk === 'spät', tight = v.status !== 'fertig' && v.risk === 'knapp';
    setCls(c.el, 'or-card' + (late ? ' r-late' : tight ? ' r-tight' : '') + (v.status === 'fertig' ? ' done' : '') + (selectedOrder === v.id ? ' sel' : ''));
    setVar(c.el, '--oc', colorOf(v.id));
    setVar(c.el, '--rc', rb.c);
    setText(r.id, v.id);
    setHidden(r.eil, v.priority !== 'eil');
    const stat = v.status === 'freigegeben' ? 'Freigegeben' : v.source && v.source !== 'profil' && v.status !== 'fertig' ? v.source : null;
    setHidden(r.stat, !stat);
    if (stat) { setText(r.stat, stat); setCls(r.stat, 'or-tag ' + (v.status === 'freigegeben' ? 'rel' : 'src')); setAttr(r.stat, 'title', v.status === 'freigegeben' ? 'Freigegeben, noch kein Arbeitsgang begonnen' : 'Auftragsquelle'); }
    setText(r.cust, custShort(v.customer)); setAttr(r.cust, 'title', v.customer);
    setText(r.sect, v.sector || '');
    setText(r.pn, v.part.name); setAttr(r.pn, 'title', v.part.name);
    const pno = [v.part.no, v.part.material].filter(Boolean).join(' · ');
    setText(r.pno, pno);
    setHTML(r.partAlt, `${esc(v.part.name)}<span>${esc(v.part.no || '')}</span>`);
    // Fortschritt
    const fin = finishedGood(v);
    setText(r.pct, U.fmtPct(v.progress));
    setText(r.qty, nf(v.qty) + ' Stk');
    setW(r.pbar, v.progress);
    setHTML(r.pS, `<b>${nf(fin)}</b> fertig · <b>${nf(v.shippedQty)}</b> versandt`);
    setAttr(r.pS.parentNode, 'title', `Arbeitsfortschritt ${U.fmtPct(v.progress)} (nach Arbeitsinhalt gewichtet) · ${nf(fin)} von ${nf(v.qty)} Stk fertig bearbeitet · ${nf(v.shippedQty)} Stk versandt`);
    // Termine
    setText(r.due, fmtDue(v.due, now));
    if (v.status === 'fertig') { setText(r.etaL, 'Fertig'); setText(r.eta, fmtDue(v.doneT, now)); }
    else { setText(r.etaL, 'Prognose'); setText(r.eta, v.eta != null ? fmtDue(v.eta, now) : '–'); }
    const pend = v.status !== 'fertig' && v.etaPending != null && v.eta != null && Math.abs(v.etaPending - v.eta) > 900;
    setHidden(r.etaS, !pend);
    if (pend) { setText(r.etaS, 'neu ' + tShort(v.etaPending, now) + ' – wird geprüft'); setAttr(r.etaS, 'title', 'Die letzte Planrechnung ergibt einen deutlich anderen Termin; er wird übernommen, sobald die nächste Rechnung ihn bestätigt.'); }
    // Lage
    setVar(r.rb, '--c', rb.c);
    setText(r.rbT, rb.label);
    setText(r.slack, slackText(v));
    setAttr(r.rb.parentNode, 'title', v.status === 'fertig' ? null : 'Im Plan: > 4 h Puffer · Knapp: < 4 h · Verspätet: Prognose nach Liefertermin');
    // Eil
    setHidden(r.prio, v.status === 'fertig');
    setCls(r.prio, 'or-prio' + (v.priority === 'eil' ? ' on' : ''));
    setAttr(r.prio, 'title', v.priority === 'eil' ? 'Eilauftrag – Priorität aufheben' : 'Als Eilauftrag kennzeichnen (wird beim nächsten Auftragswechsel vorgezogen)');
    setAttr(r.prio, 'aria-pressed', v.priority === 'eil' ? 'true' : 'false');
    setAttr(r.prio, 'aria-label', v.priority === 'eil' ? 'Eilauftrag aufheben' : 'Als Eilauftrag kennzeichnen');
    // Kette
    c.box = r.chain;
    patchChain(c, v, now);
    // Fußzeile
    const nl = nowLine(v, now);
    setCls(r.now, 'or-now' + (nl.cls ? ' ' + nl.cls : ''));
    setHTML(r.nowIc, nl.ic ? icon(nl.ic, 14) : '');
    setHidden(r.nowIc, !nl.ic);
    setHTML(r.nowT, nl.html);
    setAttr(r.nowT, 'title', r.nowT.textContent);
    const nts = v.status !== 'fertig' ? orderNotifs(v.id) : [];
    setHidden(r.msg, !nts.length);
    if (nts.length) {
      const top = nts.find(n => n.sev === 'crit') || nts.find(n => n.sev === 'warn') || nts[0];
      setVar(r.msg, '--c', (WF.SEV[top.sev] || WF.SEV.info).color);
      setText(r.msgT, nts.length === 1 ? top.title.replace(/\s*\(.*\)\s*$/, '').replace(': ' + v.id, '') : nts.length + ' Meldungen');
      setAttr(r.msg, 'title', nts.map(n => n.title + (n.status === 'ack' ? ' (quittiert)' : '')).join('\n'));
    }
    const showBn = v.status !== 'fertig' && !!v.bottleneck;
    setHidden(r.bn, !showBn);
    if (showBn) { setHTML(r.bnT, `Engpass <b>${esc(v.bottleneck.replace(/\s*\(.*$/, ''))}</b>${bnSeq(v) ? ' · AG ' + bnSeq(v) : ''}`); setAttr(r.bn, 'title', 'Engpass laut Prognose (längste Durchlaufzeit): ' + v.bottleneck); }
  }
  function placeCards(box, list, prevSig) {
    const sig = list.map(v => v.id).join(',');
    if (sig === prevSig) return sig;
    let prev = null;
    for (const v of list) {
      const n = cards[v.id].el;
      const want = prev ? prev.nextSibling : box.firstChild;
      if (n.parentNode !== box || want !== n) box.insertBefore(n, want);
      prev = n;
    }
    // überzählige entfernen
    const keep = new Set(list.map(v => v.id));
    Array.from(box.children).forEach(ch => { if (!keep.has(ch.dataset.id)) ch.remove(); });
    return sig;
  }
  function updateList(views, now) {
    for (const v of views) if (!cards[v.id]) cards[v.id] = buildCard(v.id);
    const ids = new Set(views.map(v => v.id));
    for (const id in cards) if (!ids.has(id)) { cards[id].el.remove(); delete cards[id]; }
    const match = (v) => !query || hay(v).includes(query);
    const open = views.filter(v => v.status !== 'fertig').sort(cmpOpen);
    const done = views.filter(v => v.status === 'fertig').sort(cmpDone);
    let main, side;
    if (filter === 'risk') { main = open.filter(v => v.risk === 'spät' || v.risk === 'knapp'); side = null; }
    else if (filter === 'work') { main = open.filter(v => v.status === 'in Arbeit'); side = null; }
    else if (filter === 'done') { main = done; side = null; }
    else { main = open; side = done; }
    main = main.filter(match);
    const sideM = side ? side.filter(match) : [];
    R.chips.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    listOrderSig = placeCards(R.list, main, listOrderSig);
    for (const v of main) updateCard(cards[v.id], v, now);
    // abgeschlossene Aufträge (einklappbar)
    const showSide = !!side && (sideM.length > 0);
    setHidden(R.doneBox, !showSide);
    const openSide = showSide && (doneOpen || (query && sideM.length > 0));
    R.doneH.classList.toggle('open', !!openSide);
    R.doneH.setAttribute('aria-expanded', openSide ? 'true' : 'false');
    setText(R.doneT, `Abgeschlossene Aufträge (${nf(sideM.length)})`);
    const lastDone = sideM[0];
    setText(R.doneS, lastDone ? `zuletzt ${lastDone.id} · fertig ${fmtDue(lastDone.doneT, now)}` : '');
    setHidden(R.doneList, !openSide);
    doneOrderSig = placeCards(R.doneList, openSide ? sideM : [], doneOrderSig);
    if (openSide) for (const v of sideM) updateCard(cards[v.id], v, now);
    // leerer Zustand
    const empty = main.length === 0;
    setHidden(R.empty, !empty);
    setHidden(R.thead, empty);
    if (empty) {
      let h;
      if (query) h = `<b>Keine Treffer für „${esc(query)}“</b>Gesucht wird in Auftragsnummer, Kunde, Branche, Teilebezeichnung, Teilenummer und Werkstoff.`;
      else if (filter === 'risk') h = `<b>Kein Auftrag gefährdet</b>Alle offenen Aufträge haben laut Prognose mehr als 4 Stunden Puffer bis zum Liefertermin.`;
      else if (filter === 'work') h = `<b>Kein Auftrag in Arbeit</b>Sobald der erste Arbeitsgang eines freigegebenen Auftrags beginnt, erscheint er hier.`;
      else if (filter === 'done') h = `<b>Noch kein Auftrag abgeschlossen</b>Fertige Aufträge erscheinen hier mit Liefertermin, Fertigstellung und Termintreue.`;
      else h = `<b>Keine offenen Aufträge</b>Neue Aufträge kommen über die Auftragsfreigabe oder den KI-Auftrag (Zeichnung → Arbeitsplan) in die Fertigung.`;
      setHTML(R.empty, h);
    }
  }

  // ------------------------------------------------------------------ Plantafel (Gantt)
  const G = { ready: false, zoom: null, sig: '', last: 0, pin: null, hov: null, needScroll: true, geo: null, tips: [], d0: null, dragging: false, moved: false };
  const AXIS_H = 46, LANE_H = 35, BLK_Y = 5, BLK_H = 20, EXT_ROW = 24;
  function ganttMount(pane) {
    pane.innerHTML = `
      <div class="or-gbar">
        <div class="seg" role="group" aria-label="Zeitraum" data-r="zoomSeg"><button data-z="8">8 h</button><button data-z="24">24 h</button><button data-z="48">48 h</button></div>
        <button type="button" class="btn sm" data-r="nowBtn" title="Zur aktuellen Uhrzeit springen">${icon('clock', 14)}Jetzt</button>
        <div class="or-gleg" data-r="gleg" aria-label="Aufträge hervorheben"></div>
      </div>
      <div class="or-gsel" data-r="gsel" aria-live="polite"></div>
      <div class="card or-gcard" data-r="gcard">
        <div class="or-glabels" data-r="glabels"></div>
        <div class="or-gscroll" data-r="gscroll"><svg class="or-gsvg" data-r="gsvg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plantafel: Belegung und Prognose je Arbeitsplatz"></svg></div>
      </div>
      <div class="or-gkey" style="margin-top:10px">
        <span><span class="k-ist"></span>Ist-Belegung</span>
        <span><span class="k-fc"></span>Prognose (Farbe = Auftrag)</span>
        <span><span class="k-su"></span>Rüsten</span>
        <span><span class="k-ext"></span>Weitere Lose geplant</span>
        <span><span class="k-st">${['running', 'setup', 'toolchange', 'starved', 'fault', 'idle'].map(k => `<i style="--c:${WF.STATE[k].color}"></i>`).join('')}</span>Zustandsband (Ist)</span>
        <span><span class="k-lk"></span>Materialfluss des hervorgehobenen Auftrags</span>
        <span><span class="k-now"></span>Jetzt</span>
      </div>`;
    Object.assign(R, refs(pane));
    const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
    G.zoom = [8, 24, 48].includes(saved.zoom) ? saved.zoom : (isNarrow() ? 8 : 24);
    R.zoomSeg.querySelectorAll('[data-z]').forEach(b => {
      b.classList.toggle('on', Number(b.dataset.z) === G.zoom);
      b.onclick = () => {
        const z = Number(b.dataset.z); if (z === G.zoom) return;
        G.zoom = z; store.set({ zoom: z });
        R.zoomSeg.querySelectorAll('[data-z]').forEach(x => x.classList.toggle('on', x === b));
        G.needScroll = true; ganttRender(true);
      };
    });
    R.nowBtn.onclick = () => ganttScrollToNow(true);
    R.gsel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-gs]'); if (!b) return;
      const oid = R.gsel.dataset.o; if (!oid) return;
      if (b.dataset.gs === 'open') WF.app.select('order', oid);
      else if (b.dataset.gs === 'unpin') { G.pin = null; R.gleg._sig = null; R.gleg.querySelectorAll('[data-o]').forEach(x => x.classList.remove('on')); setHL(null); }
      else if (b.dataset.gs === 'due') {
        if (G.pin !== oid) { G.pin = oid; R.gleg.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x.dataset.o === oid)); setHL(oid); }
        const o = S().orders[oid], g = G.geo; if (!o || !g) return;
        const left = Math.max(0, g.X(o.due) - R.gscroll.clientWidth * 0.7);
        if (R.gscroll.scrollTo) R.gscroll.scrollTo({ left, behavior: 'smooth' }); else R.gscroll.scrollLeft = left;
      }
    });
    R.gleg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      G.pin = G.pin === b.dataset.o ? null : b.dataset.o; G.pinFromSel = false;
      R.gleg.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x.dataset.o === G.pin));
      setHL(G.pin);
      if (G.pin) scrollToOrder(G.pin);
    });
    R.glabels.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) WF.app.select('machine', b.dataset.m); });
    const sc = R.gscroll, svg = R.gsvg;
    svg.addEventListener('mousemove', (e) => {
      if (G.dragging) return;
      const t = e.target.closest && e.target.closest('[data-i]');
      if (!t) { hideTip(); if (G.hov) { G.hov = null; setHL(G.pin); } return; }
      const info = G.tips[Number(t.dataset.i)]; if (!info) return;
      if (G.hov !== info.o) { G.hov = info.o; setHL(info.o); }
      showTip(info, e);
    });
    svg.addEventListener('mouseleave', () => { hideTip(); G.hov = null; setHL(G.pin); });
    svg.addEventListener('click', (e) => {
      if (G.moved) { G.moved = false; return; }
      const t = e.target.closest && e.target.closest('[data-i]'); if (!t) return;
      const info = G.tips[Number(t.dataset.i)]; if (!info || !info.o) return;
      G.pin = info.o; R.gleg.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x.dataset.o === G.pin)); setHL(G.pin);
      WF.app.select('order', info.o);
    });
    const touch = () => { G.userT = performance.now(); };
    for (const evn of ['wheel', 'pointerdown', 'touchstart', 'keydown']) sc.addEventListener(evn, touch, { passive: true });
    // Ziehen zum Verschieben (Maus); Touch scrollt nativ
    let sx = 0, sl = 0, pid = null;
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      sx = e.clientX; sl = sc.scrollLeft; pid = e.pointerId; G.moved = false;
    });
    sc.addEventListener('pointermove', (e) => {
      if (pid == null || e.pointerId !== pid) return;
      const dx = e.clientX - sx;
      if (!G.dragging && Math.abs(dx) > 4) { G.dragging = true; sc.classList.add('drag'); hideTip(); try { sc.setPointerCapture(pid); } catch (err) { /* egal */ } }
      if (G.dragging) sc.scrollLeft = sl - dx;
    });
    const end = () => { if (G.dragging) { G.moved = true; setTimeout(() => { G.moved = false; }, 0); } G.dragging = false; pid = null; sc.classList.remove('drag'); };
    sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (mode === 'gantt' && !R.paneGantt.hidden) ganttRender(true); }).observe(R.gcard);
    G.ready = true;
  }
  function ganttScrollToNow(smooth) {
    const g = G.geo; if (!g) return;
    const x = (S().t - g.d0) * g.pps;
    const left = Math.max(0, x - R.gscroll.clientWidth * 0.2);
    if (smooth && R.gscroll.scrollTo) R.gscroll.scrollTo({ left, behavior: 'smooth' }); else R.gscroll.scrollLeft = left;
  }
  function scrollToOrder(oid) {
    const g = G.geo; if (!g) return;
    const xs = Array.from(R.gsvg.querySelectorAll(`[data-o="${CSS.escape(oid)}"]`)).map(n => Number(n.dataset.x)).filter(x => isFinite(x));
    if (!xs.length) return;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const W = R.gscroll.clientWidth, L = R.gscroll.scrollLeft;
    if (minX >= L && minX <= L + W - 40) return;
    const left = Math.max(0, Math.min(minX - 40, maxX - W + 40 > minX - 40 ? minX - 40 : maxX - W + 40));
    if (R.gscroll.scrollTo) R.gscroll.scrollTo({ left, behavior: 'smooth' }); else R.gscroll.scrollLeft = left;
  }

  /** Ist-Belegung je Maschine aus den Ereignissen (opSelect … opPause/opDone/moveOp) */
  function pastOccupancy(now) {
    const s = S(), ev = s.events, res = {};
    if (!ev.length) return res;
    const t0buf = ev[0].t;
    const cur = {}, touched = {};
    const push = (mid, b) => { (res[mid] = res[mid] || []).push(b); };
    for (let k = 0; k < ev.length; k++) {
      const e = ev[k]; if (e.t > now) break;
      let mid = null, oid = null, seq = null, open = false;
      const d = e.data || {};
      if (e.type === 'opSelect' && e.entity && e.entity.kind === 'machine') { mid = e.entity.id; oid = d.orderId; seq = d.seq; open = true; }
      else if (e.type === 'opPause' && e.entity && e.entity.kind === 'machine') { mid = e.entity.id; oid = d.orderId; seq = d.seq; }
      else if (e.type === 'opDone' && d.station) { mid = d.station; oid = e.entity && e.entity.id; seq = d.seq; }
      else if (e.type === 'moveOp' && d.from) { mid = d.from; oid = e.entity && e.entity.id; seq = d.seq; }
      else continue;
      if (!mid || !s.machines[mid] || !oid) continue;
      if (!touched[mid]) {
        touched[mid] = true;
        if (!open) { push(mid, { o: oid, seq, t0: t0buf, t1: e.t, pre: true }); continue; }
      }
      const c = cur[mid];
      if (open) {
        if (c) { if (c.o === oid && c.seq === seq) continue; push(mid, { o: c.o, seq: c.seq, t0: c.t0, t1: e.t }); }
        cur[mid] = { o: oid, seq, t0: e.t };
      } else if (c && c.o === oid && c.seq === seq) { push(mid, { o: c.o, seq: c.seq, t0: c.t0, t1: e.t }); cur[mid] = null; }
    }
    for (const mid in s.machines) {
      const c = cur[mid], m = s.machines[mid];
      if (c) push(mid, { o: c.o, seq: c.seq, t0: c.t0, t1: now, live: true });
      else if (!touched[mid] && m.op) {
        const o = s.orders[m.op.oid];
        push(mid, { o: m.op.oid, seq: o && o.routing[m.op.idx] ? o.routing[m.op.idx].seq : null, t0: t0buf, t1: now, live: true, pre: true });
      }
    }
    return res;
  }
  /** Fremdbearbeitung: vergangene Lose (Ereignisse), Lose beim Partner (Behälter), geplante weitere Lose (Prognose) */
  function extItems(fc, views, now, d0) {
    const s = S(), items = [];
    const atKeys = {};
    for (const cid in s.containers) {
      const c = s.containers[cid]; if (c.state !== 'external' || !c.location) continue;
      const key = c.orderId + '|' + c.location.sentT + '|' + c.location.returnT;
      if (atKeys[key]) { atKeys[key].qty += c.qty; atKeys[key].conts.push(c.id); continue; }
      const it = { kind: 'at', o: c.orderId, t0: c.location.sentT != null ? c.location.sentT : now, t1: c.location.returnT != null ? c.location.returnT : now + 3600, qty: c.qty, conts: [c.id], partner: c.location.partner, process: c.location.process };
      atKeys[key] = it; items.push(it);
    }
    const atConts = new Set(); for (const it of items) for (const id of it.conts) atConts.add(id);
    const outs = [];
    for (const e of s.events) {
      if (e.t > now) break;
      const d = e.data || {};
      if (e.type === 'extOut' && d.orderId) outs.push({ o: d.orderId, t0: e.t, t1: null, qty: d.qty, conts: d.containers || [], ret: d.returnT });
      else if (e.type === 'extIn' && d.orderId) { const x = outs.find(y => y.o === d.orderId && y.t1 == null && !y.conts.some(id => atConts.has(id))); if (x) x.t1 = e.t; }
    }
    for (const x of outs) {
      if (x.t1 == null || x.conts.some(id => atConts.has(id)) || x.t1 < d0) continue;
      const o = s.orders[x.o];
      const r = o && o.routing.find(rr => rr.station === 'EXT');
      items.push({ kind: 'past', o: x.o, t0: x.t0, t1: x.t1, qty: x.qty, partner: r && r.ext ? r.ext.partner : '', process: r && r.ext ? r.ext.process : '' });
    }
    for (const v of views) {
      if (v.status === 'fertig') continue;
      const f = fc.orders[v.id]; if (!f || !f.ops) continue;
      v.ops.forEach((op, i) => {
        if (op.station !== 'EXT' || op.complete) return;
        const fe = f.ops[i]; if (!fe || fe.shipNext == null) return;
        items.push({ kind: 'plan', o: v.id, t0: Math.max(fe.shipNext, now), t1: Math.max(fe.lastReturn, fe.shipNext + 600), lotQty: fe.lotQty, shipNext: fe.shipNext, shipLast: fe.shipLast, lastReturn: fe.lastReturn,
          partner: op.ext ? op.ext.partner : '', process: op.ext ? op.ext.process : '', seq: op.seq, remaining: Math.max(0, (op.targetIn || v.qty) - (op.ext ? op.ext.sentQty : 0)) });
      });
    }
    return items;
  }
  function packRows(items, gapSec) {
    const rows = [];
    items.sort((a, b) => a.t0 - b.t0 || (a.kind === 'plan') - (b.kind === 'plan'));
    for (const it of items) {
      let r = rows.findIndex(end => end + gapSec <= it.t0);
      if (r < 0) { r = rows.length; rows.push(0); }
      rows[r] = Math.max(rows[r], it.t1); it.row = r;
    }
    return Math.max(1, rows.length);
  }
  function stateShares(segs, a, b) {
    const acc = {};
    for (const sg of segs || []) {
      const x = Math.max(a, sg.t0), y = Math.min(b, sg.t1 == null ? b : sg.t1);
      if (y > x) acc[sg.state] = (acc[sg.state] || 0) + (y - x);
    }
    return Object.keys(acc).sort((p, q) => acc[q] - acc[p]).map(k => ({ k, sec: acc[k] }));
  }
  // Arbeitszeitfenster (Mo–Fr, Schichten ohne Pausen) wie in der Engine: personengebundene Arbeit nur darin
  let WORKWIN = null;
  function workWindows() {
    if (WORKWIN) return WORKWIN;
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of WF.profile.shifts || []) {
      let a = U.hm(sh.start); const end = U.hm(sh.end);
      for (const b of sh.breaks || []) { const b0 = U.hm(b[0]), b1 = U.hm(b[1]); if (b0 > a) w.push([d * DAY + a, d * DAY + b0]); a = b1; }
      if (end > a) w.push([d * DAY + a, d * DAY + end]);
    }
    return (WORKWIN = w.sort((x, y) => x[0] - y[0]));
  }
  /** Zeiträume ohne Personal (Nacht, Pausen, Wochenende) innerhalb [a, b] */
  function offWork(a, b) {
    const W = workWindows(), out = [], WEEK = 7 * DAY;
    let cur = a, done = false;
    for (let base = Math.floor(a / WEEK) * WEEK, guard = 0; !done && cur < b && guard < 8; base += WEEK, guard++) {
      for (const w of W) {
        const x = base + w[0], y = base + w[1];
        if (y <= cur) continue;
        if (x >= b) { done = true; break; }
        if (x > cur) out.push([cur, x]);
        cur = y;
        if (cur >= b) { done = true; break; }
      }
    }
    if (cur < b) out.push([cur, b]);
    return out;
  }
  const labelFits = (txt, w) => txt.length * 6.1 + 12 <= w;
  function pickLabel(variants, w) { for (const t of variants) if (t && labelFits(t, w)) return t; return ''; }
  const numId = (id) => String(id).replace(/^[A-Za-z]+-/, '');

  function ganttRender(force) {
    if (!R || !R.gscroll || mode !== 'gantt' || R.paneGantt.hidden) return;
    const s = S(), now = s.t, fc = WF.sim.forecast();
    const W = R.gscroll.clientWidth; if (W < 60) return;
    const sig = fc.t + '|' + G.zoom + '|' + W + '|' + Object.keys(s.orders).length + '|' + s.events.length;
    const tNow = performance.now();
    if (G.dirty) { force = true; G.dirty = false; }
    if (!force && sig === G.sig) return;
    if (!force && tNow - G.last < 900) return;
    G.sig = sig; G.last = tNow;
    const views = lastViews || collect();
    const vById = {}; for (const v of views) vById[v.id] = v;
    const P = WF.profile;
    // Zeitachse: ab dem letzten 06:00 (Beginn Frühschicht) bis nach dem Ende der Prognose
    const d0 = Math.floor((now - 6 * HOUR) / DAY) * DAY + 6 * HOUR;
    let maxEnd = now + 50 * HOUR;
    for (const mid in fc.machines) for (const b of fc.machines[mid]) if (b.end > maxEnd) maxEnd = b.end;
    for (const id in fc.orders) { const f = fc.orders[id]; if (f && !f.done && f.eta > maxEnd) maxEnd = f.eta; }
    const d1 = Math.min(d0 + 7 * DAY, Math.ceil((maxEnd + 3 * HOUR) / HOUR) * HOUR);
    const pps = W / (G.zoom * HOUR);
    const width = Math.ceil((d1 - d0) * pps);
    const X = (t) => (t - d0) * pps;
    if (G.geo && G.geo.d0 !== d0 && !G.needScroll) R.gscroll.scrollLeft = Math.max(0, R.gscroll.scrollLeft - (d0 - G.geo.d0) * pps);
    // Fahrspuren
    const lanes = [];
    let y = AXIS_H;
    for (const mid of P.machines) { lanes.push({ id: mid, y, h: LANE_H }); y += LANE_H; }
    const ext = extItems(fc, views, now, d0);
    const extRows = packRows(ext, 6 / pps);
    const extLane = { id: 'EXT', y, h: Math.max(LANE_H, 10 + extRows * EXT_ROW) };
    lanes.push(extLane); y += extLane.h;
    const H = y + 1;
    const laneBy = {}; for (const l of lanes) laneBy[l.id] = l;
    const tips = [];
    const out = [];
    out.push(`<defs><pattern id="or-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="6" style="fill:var(--text)" fill-opacity=".36"/></pattern>` +
      `<marker id="or-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" style="fill:var(--mat)"/></marker></defs>`);
    // Schichten / Nacht
    const tick = G.zoom <= 8 ? 1 : G.zoom <= 24 ? 2 : 4;
    const dayA = dayOf(d0) - 1, dayB = dayOf(d1) + 1;
    out.push('<g class="bg">');
    for (let dd = dayA; dd <= dayB; dd++) {
      const D = dd * DAY;
      const nx0 = X(D + 22 * HOUR), nx1 = X(D + 30 * HOUR);
      if (nx1 > 0 && nx0 < width) out.push(`<rect x="${Math.max(0, nx0).toFixed(1)}" y="0" width="${(Math.min(width, nx1) - Math.max(0, nx0)).toFixed(1)}" height="${H}" style="fill:var(--bg)" fill-opacity=".55"/>`);
    }
    // Stundenraster (Beschriftung unter der Jetzt-Marke ausgelassen)
    const nxA = X(now);
    for (let t = Math.ceil(d0 / (tick * HOUR)) * tick * HOUR; t <= d1; t += tick * HOUR) {
      const xv = X(t), x = xv.toFixed(1), hh = Math.floor((t % DAY) / HOUR);
      const major = hh === 6 || hh === 14 || hh === 22;
      out.push(`<line x1="${x}" x2="${x}" y1="${AXIS_H - 6}" y2="${H}" style="stroke:var(--line${major ? '2' : ''})" stroke-opacity="${major ? 1 : 0.55}"${major ? '' : ' stroke-dasharray="2 3"'}/>`);
      if (xv > nxA - 58 && xv < nxA + 20) continue;
      out.push(`<text x="${(xv + 4).toFixed(1)}" y="${AXIS_H - 10}" font-size="10.5" style="fill:var(--muted)" font-variant-numeric="tabular-nums">${U.fmtClock(t)}</text>`);
    }
    // Schicht-Beschriftung (obere Zeile)
    for (let dd = dayA; dd <= dayB; dd++) {
      const D = dd * DAY;
      for (const [a, labels] of [[6, [U.fmtDay(D) + ' · Frühschicht', U.fmtDay(D) + ' · Früh', U.fmtDay(D)]], [14, ['Spätschicht', 'Spät']], [22, ['unbesetzt – nur autonome Maschinen', 'unbesetzt', '']]]) {
        const t = D + a * HOUR; if (t < d0 - 8 * HOUR || t > d1) continue;
        const x = Math.max(4, X(t) + 4), room = X(t + 8 * HOUR) - x - 8;
        if (room < 16) continue;
        const txt = labels.find(l => l.length * 7.3 <= room);
        if (!txt) continue;
        out.push(`<text x="${x.toFixed(1)}" y="15" font-size="10.5" font-weight="600" letter-spacing=".06em" style="fill:var(--${a === 22 ? 'faint' : 'text2'})">${esc(txt.toUpperCase())}</text>`);
      }
    }
    out.push(`<line x1="0" x2="${width}" y1="${AXIS_H - 0.5}" y2="${AXIS_H - 0.5}" style="stroke:var(--line)"/>`);
    for (const l of lanes) out.push(`<line x1="0" x2="${width}" y1="${(l.y + l.h - 0.5).toFixed(1)}" y2="${(l.y + l.h - 0.5).toFixed(1)}" style="stroke:var(--line)"/>`);
    // Vergangenheit abdunkeln
    out.push(`<rect x="0" y="${AXIS_H}" width="${Math.max(0, X(now)).toFixed(1)}" height="${H - AXIS_H}" style="fill:var(--bg)" fill-opacity=".22"/>`);
    out.push('</g>');
    // Ist-Belegung + Zustandsband
    const past = pastOccupancy(now);
    out.push('<g class="past">');
    for (const l of lanes) {
      if (l.id === 'EXT') continue;
      const m = s.machines[l.id];
      for (const b of past[l.id] || []) {
        const a = Math.max(b.t0, d0), e = Math.min(b.t1, now);
        if (e <= a) continue;
        const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 1) continue;
        const col = colorOf(b.o), i = tips.length;
        tips.push({ kind: 'past', o: b.o, seq: b.seq, mid: l.id, t0: b.t0, t1: b.t1, live: b.live, pre: b.pre, shares: stateShares(m.segments, a, e) });
        const lbl = pickLabel([`${b.o} · AG ${b.seq}`, b.o, numId(b.o)], w);
        out.push(`<g class="blk" data-i="${i}" data-o="${esc(b.o)}" data-x="${x0.toFixed(0)}"><rect class="bf" x="${(x0 + 0.5).toFixed(1)}" y="${l.y + BLK_Y}" width="${Math.max(1, w - 1).toFixed(1)}" height="${BLK_H}" rx="4" fill="${col}" fill-opacity=".13" stroke="${col}" stroke-opacity=".45"/>` +
          (lbl ? `<text x="${(x0 + 7).toFixed(1)}" y="${l.y + BLK_Y + 14.5}" font-size="11" style="fill:var(--muted)">${esc(lbl)}</text>` : '') + '</g>');
      }
      // Zustandsband
      const by = l.y + l.h - 7;
      for (const sg of m.segments || []) {
        const a = Math.max(d0, sg.t0), e = Math.min(now, sg.t1 == null ? now : sg.t1);
        if (e <= a) continue;
        out.push(`<rect x="${X(a).toFixed(2)}" y="${by}" width="${Math.max(0.6, X(e) - X(a)).toFixed(2)}" height="3" fill="${WF.STATE_HEX[sg.state] || '#7b8aa8'}" fill-opacity=".9"/>`);
      }
    }
    out.push('</g>');
    // Prognose-Blöcke
    out.push('<g class="fc">');
    for (const l of lanes) {
      if (l.id === 'EXT') continue;
      for (const b of fc.machines[l.id] || []) {
        const a = Math.max(b.start, now), e = b.end;
        if (e - a < 30) continue;
        const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 0.8) continue;
        const col = colorOf(b.orderId), i = tips.length;
        tips.push({ kind: 'fc', o: b.orderId, seq: b.seq, op: b.op, mid: l.id, start: b.start, end: b.end, opEnd: b.opEnd, setupEnd: b.setupEnd, active: b.active });
        const v = vById[b.orderId];
        const lbl = pickLabel([`${b.orderId} · AG ${b.seq} ${b.op}`, `${b.orderId} · AG ${b.seq}`, b.orderId, numId(b.orderId)], w);
        let su = '';
        if (b.setupEnd != null && b.setupEnd > a + 30) { const sw = Math.min(X(b.setupEnd), x1) - x0; if (sw > 1) su = `<rect x="${(x0 + 0.5).toFixed(1)}" y="${l.y + BLK_Y}" width="${Math.max(1, sw - 0.5).toFixed(1)}" height="${BLK_H}" rx="4" fill="url(#or-hatch)"/>`; }
        const eil = v && v.priority === 'eil';
        // Bediener-gebundene Arbeitsplätze arbeiten nur in der Schichtzeit: Nacht/Pausen im Block abgedunkelt
        let off = '';
        if (s.machines[l.id].loading !== 'auto') {
          for (const [p, q] of offWork(Math.max(a, b.setupEnd || a), e)) {
            const ox = X(p), ow = X(q) - ox; if (ow < 1.5) continue;
            off += `<rect x="${ox.toFixed(1)}" y="${l.y + BLK_Y + 1}" width="${ow.toFixed(1)}" height="${BLK_H - 2}" style="fill:var(--panel)" fill-opacity=".82"/>`;
          }
          if (off) tips[i].staffed = true;
        }
        // Arbeitsplätze, die je Behälter freigeben (Messraum, Waschen, Montage): Arbeitsgang bleibt bis opEnd offen
        let tail = '';
        if (b.opEnd != null && b.opEnd > e + 600) {
          const tx1 = X(b.opEnd), ty = l.y + BLK_Y + BLK_H / 2;
          tail = `<line x1="${(x1 + 2).toFixed(1)}" x2="${tx1.toFixed(1)}" y1="${ty}" y2="${ty}" stroke="${col}" stroke-opacity=".7" stroke-width="1.2" stroke-dasharray="2 3"/><line x1="${tx1.toFixed(1)}" x2="${tx1.toFixed(1)}" y1="${ty - 4}" y2="${ty + 4}" stroke="${col}" stroke-opacity=".8" stroke-width="1.4"/>` +
            `<rect x="${x1.toFixed(1)}" y="${l.y + BLK_Y}" width="${Math.max(0, tx1 - x1).toFixed(1)}" height="${BLK_H}" fill="transparent"/>`;
        }
        out.push(`<g class="blk" data-i="${i}" data-o="${esc(b.orderId)}" data-x="${x0.toFixed(0)}">${tail}<rect class="bf" x="${(x0 + 0.5).toFixed(1)}" y="${l.y + BLK_Y}" width="${Math.max(1, w - 1).toFixed(1)}" height="${BLK_H}" rx="4" fill="${col}" fill-opacity="${b.active ? 0.5 : 0.32}" stroke="${col}" stroke-width="${b.active ? 1.4 : 1}"/>` + off + su +
          (eil && w > 14 ? `<rect x="${(x0 + 0.5).toFixed(1)}" y="${l.y + BLK_Y}" width="3" height="${BLK_H}" rx="1.5" style="fill:var(--st-fault)"/>` : '') +
          (lbl ? `<text x="${(x0 + 7).toFixed(1)}" y="${l.y + BLK_Y + 14.5}" font-size="11" font-weight="${b.active ? 600 : 500}" style="fill:var(--text)">${esc(lbl)}</text>` : '') + '</g>');
      }
    }
    out.push('</g>');
    // Fremdbearbeitung
    out.push('<g class="ext">');
    const extRowOf = {};
    for (const it of ext) {
      const a = Math.max(it.t0, d0), e = it.t1; if (e <= a) continue;
      const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 1) continue;
      const yy = extLane.y + 6 + it.row * EXT_ROW, hh = EXT_ROW - 5;
      const col = colorOf(it.o), i = tips.length;
      tips.push(Object.assign({ mid: 'EXT' }, it));
      if (extRowOf[it.o] == null || it.kind !== 'past') extRowOf[it.o] = yy + hh / 2;
      let rect;
      if (it.kind === 'plan') rect = `<rect class="bf" x="${(x0 + 0.5).toFixed(1)}" y="${yy}" width="${Math.max(1, w - 1).toFixed(1)}" height="${hh}" rx="4" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-opacity=".8" stroke-dasharray="4 3"/>`;
      else if (it.kind === 'past') rect = `<rect class="bf" x="${(x0 + 0.5).toFixed(1)}" y="${yy}" width="${Math.max(1, w - 1).toFixed(1)}" height="${hh}" rx="4" fill="${col}" fill-opacity=".13" stroke="${col}" stroke-opacity=".45"/>`;
      else rect = `<rect class="bf" x="${(x0 + 0.5).toFixed(1)}" y="${yy}" width="${Math.max(1, w - 1).toFixed(1)}" height="${hh}" rx="4" fill="${col}" fill-opacity=".42" stroke="${col}" stroke-width="1.2"/>`;
      const lbl = it.kind === 'plan'
        ? pickLabel([`${it.o} · weitere Lose à ${it.lotQty} Stk`, `${it.o} · Lose à ${it.lotQty}`, it.o, numId(it.o)], w)
        : pickLabel([`${it.o} · ${it.qty} Stk · zurück ${tShort(it.t1, now)}`, `${it.o} · ${it.qty} Stk`, it.o, numId(it.o)], w);
      out.push(`<g class="blk" data-i="${i}" data-o="${esc(it.o)}" data-x="${x0.toFixed(0)}">${rect}` +
        (lbl ? `<text x="${(x0 + 7).toFixed(1)}" y="${yy + hh / 2 + 4}" font-size="11" font-weight="${it.kind === 'at' ? 600 : 500}" style="fill:var(--${it.kind === 'at' ? 'text' : it.kind === 'past' ? 'muted' : 'text2'})">${esc(lbl)}</text>` : '') + '</g>');
    }
    if (!ext.length) out.push(`<text x="${(Math.max(0, X(now)) + 10).toFixed(1)}" y="${extLane.y + extLane.h / 2 + 4}" font-size="11.5" style="fill:var(--faint)">Keine Lose beim Härtepartner und keine weiteren geplant</text>`);
    out.push('</g>');
    out.push('<g class="lk" data-r="links"></g>');
    // Jetzt-Linie
    const nx = X(now);
    out.push(`<g class="now" data-r="nowG" transform="translate(${nx.toFixed(1)},0)"><line x1="0" x2="0" y1="${AXIS_H - 20}" y2="${H}" style="stroke:var(--accent)" stroke-width="1.5"/>` +
      `<rect x="-22" y="${AXIS_H - 25}" width="44" height="17" rx="8.5" style="fill:var(--accent)"/><text data-r="nowTxt" x="0" y="${AXIS_H - 12.5}" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--accent-ink)" font-variant-numeric="tabular-nums">${U.fmtClock(now)}</text></g>`);
    const svg = R.gsvg;
    svg.setAttribute('width', width); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    svg.innerHTML = out.join('');
    G.nowG = svg.querySelector('[data-r="nowG"]'); G.nowTxt = svg.querySelector('[data-r="nowTxt"]'); G.links = svg.querySelector('[data-r="links"]');
    G.tips = tips;
    G.geo = { d0, d1, pps, X, lanes, laneBy, extRowOf, H, width };
    // Beschriftungen links
    const lh = [`<div class="or-gl-h" style="height:${AXIS_H}px">Arbeitsplatz</div>`];
    for (const l of lanes) {
      if (l.id === 'EXT') {
        const nAt = ext.filter(x => x.kind === 'at').reduce((a, x) => a + x.qty, 0);
        lh.push(`<div class="or-gl ext" style="height:${l.h}px" title="Fremdbearbeitung beim Härtepartner (Lose mit Hin- und Rücktransport)"><i></i><div><b>Härterei</b><small><em>EXT</em>${nAt ? nf(nAt) + ' Stk beim Partner' : 'extern'}</small></div></div>`);
        continue;
      }
      const m = s.machines[l.id], st = WF.STATE[m.state] || WF.STATE.idle;
      lh.push(`<button type="button" class="or-gl" data-m="${esc(l.id)}" style="height:${l.h}px;--c:${st.color}" title="${esc(m.name)} (${esc(l.id)}) – ${esc(st.label)}: ${esc(m.cause || '')}"><i></i><div><b>${esc(m.short)}</b><small><em>${esc(l.id)}</em>${esc(st.label)}</small></div></button>`);
    }
    setHTML(R.glabels, lh.join(''));
    R.glabels.style.height = H + 'px';
    if (G.needScroll) { G.needScroll = false; G.entering = false; ganttScrollToNow(false); }
    else if (G.entering) {
      // beim Zurückkehren: „Jetzt“ sichtbar halten, falls die Zeit inzwischen aus dem Ausschnitt gelaufen ist
      G.entering = false;
      const nx = X(now), L = R.gscroll.scrollLeft, Wv = R.gscroll.clientWidth;
      if (nx < L + 20 || nx > L + Wv - 20) ganttScrollToNow(false);
    }
    updateLegend(views);
    setHL(G.hov || G.pin);
    if (G.scrollPin && G.pin) { G.scrollPin = false; scrollToOrder(G.pin); }
  }
  function ganttTick() {
    if (!G.geo || !G.nowG) return;
    const now = S().t;
    const x = (now - G.geo.d0) * G.geo.pps;
    // „Jetzt“ mitführen, solange niemand selbst scrollt (läuft sonst bei hohem Tempo aus dem Bild)
    const sc = R.gscroll, Wv = sc.clientWidth;
    if (!G.dragging && performance.now() - (G.userT || 0) > 8000 && x > sc.scrollLeft + Wv * 0.86 && x < sc.scrollLeft + Wv + 40) sc.scrollLeft = Math.max(0, x - Wv * 0.2);
    const tr = `translate(${x.toFixed(1)},0)`;
    if (G.nowG._tr !== tr) { G.nowG._tr = tr; G.nowG.setAttribute('transform', tr); }
    const txt = U.fmtClock(now);
    if (G.nowTxt._t !== txt) { G.nowTxt._t = txt; G.nowTxt.textContent = txt; }
  }
  function updateLegend(views) {
    const open = views.filter(v => v.status !== 'fertig').sort((a, b) => a.due - b.due);
    const sig = open.map(v => v.id + v.risk + v.priority).join(',') + '|' + G.pin;
    if (R.gleg._sig === sig) return;
    R.gleg._sig = sig;
    if (G.pin && !open.some(v => v.id === G.pin)) G.pin = null;
    R.gleg.innerHTML = open.map(v => `<button type="button" data-o="${esc(v.id)}" class="risk-${esc(v.risk)}${v.id === G.pin ? ' on' : ''}" style="--oc:${colorOf(v.id)}" title="${esc(v.id)} · ${esc(v.part.name)} · ${esc(v.customer)} – Termin ${esc(U.fmtDayClock(v.due))}, ${esc(v.riskLabel || '')}. Klick hebt den Auftrag hervor.">` +
      `<i></i>${esc(numId(v.id))}</button>`).join('');
  }
  function selStrip(oid) {
    const box = R && R.gsel; if (!box) return;
    const s = S(), now = s.t;
    const v = oid && lastViews ? lastViews.find(x => x.id === oid) : null;
    let html, cls = 'or-gsel';
    if (!v) {
      const anyOpen = lastViews && lastViews.some(x => x.status !== 'fertig');
      html = `<span class="or-gs-t">${icon('info', 15)}<span>${anyOpen ? 'Block antippen oder Auftrag oben wählen – dann zeigt die Tafel seinen Materialfluss von Station zu Station und den Liefertermin.' : 'Keine offenen Aufträge eingeplant – die Tafel zeigt die Ist-Belegung des Tages. Neue Aufträge erscheinen hier, sobald sie freigegeben sind.'}</span></span>`;
    } else {
      const rb = riskBadge(v);
      cls += ' on';
      const pinned = G.pin === oid;
      html = `<span class="or-gs-t"><span class="or-sw"></span><span class="mono">${esc(v.id)}</span><span><b>${esc(v.part.name)}</b> · ${esc(custShort(v.customer))}</span>
        <span class="or-rb" style="--c:${rb.c}"><i></i>${esc(rb.label)}</span>
        <span>Termin <b>${esc(tShort(v.due, now))}</b></span><span>${v.status === 'fertig' ? 'Fertig' : 'Prognose'} <b>${esc(tShort(v.status === 'fertig' ? v.doneT : v.eta, now))}</b></span></span>
        <span class="or-gs-a"><button type="button" class="btn sm ghost" data-gs="due">${icon('target', 14)}Zum Termin</button><button type="button" class="btn sm" data-gs="open">Details</button>${pinned ? `<button type="button" class="btn sm ghost" data-gs="unpin" title="Hervorhebung aufheben" aria-label="Hervorhebung aufheben">${icon('x', 14)}</button>` : ''}</span>`;
    }
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
    if (box._c !== cls) { box._c = cls; box.className = cls; }
    setVar(box, '--oc', v ? colorOf(v.id) : 'var(--line2)');
    box.dataset.o = v ? v.id : '';
  }
  function setHL(oid) {
    selStrip(oid);
    const svg = R && R.gsvg; if (!svg) return;
    svg.classList.toggle('hl', !!oid);
    svg.querySelectorAll('.blk.on').forEach(n => n.classList.remove('on'));
    if (G.links) G.links.innerHTML = '';
    if (!oid) return;
    svg.querySelectorAll(`.blk[data-o="${CSS.escape(oid)}"]`).forEach(n => n.classList.add('on'));
    drawLinks(oid);
  }
  /** Materialfluss des hervorgehobenen Auftrags: vom ersten Behälter des Vorgängers zum Start des Nachfolgers, Termin-Linie */
  function drawLinks(oid) {
    const g = G.geo; if (!g || !G.links) return;
    const s = S(), now = s.t, fc = WF.sim.forecast(), f = fc.orders[oid];
    const o = s.orders[oid]; if (!o) return;
    const out = [];
    const laneMid = (st) => st === 'EXT' ? (g.extRowOf[oid] != null ? g.extRowOf[oid] : (g.laneBy.EXT ? g.laneBy.EXT.y + 18 : null)) : (g.laneBy[st] ? g.laneBy[st].y + BLK_Y + BLK_H / 2 : null);
    if (f && f.ops && !f.done) {
      let prev = null;
      f.ops.forEach((op) => {
        if (!op || op.station === 'VERSAND') { return; }
        const y = laneMid(op.station); if (y == null) { prev = null; return; }
        // Übergabe = erster Behälter für den Nachfolger (Fremdbearbeitung: erste Rückkehr)
        const hand = op.station === 'EXT' ? (op.firstReturn != null ? op.firstReturn : op.first) : op.first;
        const cur = { st: op.station, y, start: Math.max(op.start, now), hand: Math.min(Math.max(hand != null ? hand : op.start, op.start, now), Math.max(op.end, now)), end: op.end };
        if (prev) {
          const tA = prev.hand, tB = Math.max(tA, cur.start);
          const ax = g.X(tA), bx = g.X(tB), ay = prev.y, by = cur.y;
          if (Math.abs(by - ay) > 1 || bx - ax > 4) {
            const dx = Math.max(22, Math.abs(bx - ax) / 2);
            out.push(`<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} C${(ax + dx).toFixed(1)} ${ay.toFixed(1)} ${(bx - dx).toFixed(1)} ${by.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" style="stroke:var(--mat)" stroke-width="1.6" stroke-dasharray="5 3" marker-end="url(#or-arr)" opacity=".95"/>`);
            out.push(`<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3" style="fill:var(--mat);stroke:var(--card)" stroke-width="1.5"/>`);
          }
        }
        prev = cur;
      });
    }
    // Liefertermin + Prognose
    const col = colorOf(oid), dx = g.X(o.due);
    if (dx >= 0 && dx <= g.width) {
      out.push(`<line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${AXIS_H}" y2="${g.H}" stroke="${col}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
      const lbl = `Termin ${numId(oid)} · ${tShort(o.due, now)}`;
      const lw = lbl.length * 6 + 14;
      out.push(`<rect x="${(dx - lw / 2).toFixed(1)}" y="${AXIS_H + 3}" width="${lw.toFixed(1)}" height="17" rx="5" fill="${col}"/><text x="${dx.toFixed(1)}" y="${AXIS_H + 15.5}" text-anchor="middle" font-size="10.5" font-weight="700" style="fill:var(--accent-ink)">${esc(lbl)}</text>`);
    }
    G.links.innerHTML = out.join('');
  }
  function showTip(info, e) {
    const s = S(), now = s.t;
    let tip = R.tip;
    if (!tip) { tip = R.tip = document.createElement('div'); tip.className = 'or-tip or-ltip'; tip.hidden = true; document.body.append(tip); }
    const o = s.orders[info.o];
    const v = lastViews && lastViews.find(x => x.id === info.o);
    const head = `<div class="or-tip-h" style="--oc:${colorOf(info.o)}"><i></i><b>${esc(info.o)}</b><span>${esc(o ? o.part.name : '')}</span></div>`;
    const row = (l, val) => `<div class="or-tip-r"><span>${esc(l)}</span><b>${esc(val)}</b></div>`;
    let body = '';
    const cust = o ? `<div class="muted" style="margin-bottom:5px">${esc(o.customer)}</div>` : '';
    if (info.kind === 'fc' || info.kind === 'past') {
      const r = o && o.routing.find(x => x.seq === info.seq);
      const st = s.machines[info.mid];
      body += `<div class="or-tip-t">AG ${esc(info.seq)} · ${esc(info.op || (r ? r.op : ''))}</div><div class="muted" style="margin-bottom:5px">${esc(st ? st.short + ' (' + info.mid + ')' : info.mid)}</div>`;
      if (info.kind === 'fc') {
        const a = Math.max(info.start, now);
        body += row(info.active ? 'Läuft bis ca.' : 'Geplant', info.active ? tShort(info.end, now) : `${tShort(a, now)} – ${tShort(info.end, now)}`);
        body += row('Dauer', U.fmtDur(info.end - a));
        if (info.setupEnd != null && info.setupEnd > a + 30) body += row('davon Rüsten', `${U.fmtDur(info.setupEnd - a)} (bis ${tShort(info.setupEnd, now)})`);
        if (info.opEnd != null && info.opEnd > info.end + 600) { body += row('Arbeitsgang fertig ca.', tShort(info.opEnd, now)); body += `<div class="or-tip-n">Belegt nur, solange Teile da sind – weitere Behälter folgen vom Vorgänger (gestrichelt bis Arbeitsgang-Ende)</div>`; }
        if (info.staffed) body += `<div class="or-tip-n">Bediener legt jedes Teil ein – gearbeitet wird nur in der Schichtzeit (abgedunkelt: Pause, Nacht)</div>`;
      } else {
        body += row('Ist-Belegung', `${tAct(info.t0, now)} – ${info.live ? 'jetzt' : tShort(info.t1, now)}`);
        const sh = (info.shares || []).slice(0, 3).map(x => `${(WF.STATE[x.k] || {}).label || x.k} ${U.fmtDur(x.sec)}`);
        if (sh.length) body += `<div class="or-tip-n">${esc(sh.join(' · '))}</div>`;
      }
    } else {
      body += `<div class="or-tip-t">${esc(info.process || 'Fremdbearbeitung')}</div><div class="muted" style="margin-bottom:5px">${esc(info.partner || '')}</div>`;
      if (info.kind === 'plan') {
        body += row('Nächste Übergabe ca.', tShort(info.shipNext, now));
        if (info.shipLast != null && info.shipLast > info.shipNext + 60) body += row('Letzte Übergabe ca.', tShort(info.shipLast, now));
        body += row('Alles zurück ca.', tShort(info.lastReturn, now));
        body += row('Losgröße', info.lotQty + ' Stk');
      } else {
        body += row('Los', info.qty + ' Stk');
        body += row('Übergeben', tAct(info.t0, now));
        body += row(info.kind === 'past' ? 'Zurück' : 'Zurück ca.', tShort(info.t1, now));
      }
    }
    if (v && v.status !== 'fertig') {
      const rb = riskBadge(v);
      body += `<div class="or-tip-n" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="or-rb" style="--c:${rb.c}"><i></i>${esc(rb.label)}</span><span>Termin ${esc(tShort(v.due, now))} · Prognose ${esc(tShort(v.eta, now))}</span></div>`;
    }
    const html = head + cust + body;
    if (tip._h !== html) { tip._h = html; tip.innerHTML = html; }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = e.clientX + 14, yy = e.clientY + 16;
    if (x + tw > vw - 8) x = e.clientX - tw - 14;
    if (x < 8) x = 8;
    if (yy + th > vh - 8) yy = Math.max(8, e.clientY - th - 12);
    tip.style.left = x + 'px'; tip.style.top = yy + 'px';
  }
  function hideTip() { if (R && R.tip) R.tip.hidden = true; }

  // ------------------------------------------------------------------ Schleife
  function update() {
    if (!root || !WF.sim || !WF.sim.state) return;
    const now = S().t;
    const views = collect();
    lastViews = views;
    updateKpis(views, now);
    if (mode === 'list') { updateList(views, now); if (listTipNode) { if (listTipNode.isConnected) showListTip(listTipNode); else hideListTip(); } }
    else { ganttRender(false); ganttTick(); }
  }
  function show(params) {
    params = params || {};
    if (R && R.newBtn) R.newBtn.hidden = !hasView('ki-auftrag');
    if (params.mode) setMode(params.mode);
    if (params.filter && ['alle', 'risk', 'work', 'done'].includes(params.filter)) setFilter(params.filter);
    if (params.order) {
      if (mode === 'gantt') { G.pin = params.order; G.scrollPin = true; R.gleg._sig = null; }
      else requestAnimationFrame(() => { const c = cards[params.order]; if (c && c.el.isConnected) c.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    }
    if (mode === 'gantt') G.dirty = true;
  }

  WF.registerView({
    id: 'auftraege', title: 'Aufträge', icon: 'list', group: 'betrieb', order: 3,
    mount, show, update,
    hide() { hideTip(); hideListTip(); },
    badge() {
      const s = S(); if (!s || !s.orders) return '';
      let n = 0;
      try { const fc = WF.sim.forecast(); for (const id in s.orders) { const o = s.orders[id]; if (o.status !== 'fertig' && fc.orders[id] && fc.orders[id].late) n++; } } catch (e) { return ''; }
      return n ? n + ' spät' : '';
    },
  });

  // ------------------------------------------------------------------ Detail „order“
  function compatMachines(stationId) {
    const s = S(), P = WF.profile, from = s.machines[stationId];
    if (!from || from.kind !== 'machine') return [];
    const g = TYPE_GROUP[from.type];
    return P.machines.filter(mid => {
      const m = s.machines[mid];
      return m && mid !== stationId && m.kind === 'machine' && (m.type === from.type || (g && TYPE_GROUP[m.type] === g));
    });
  }
  function openMoveModal(id) {
    const s = S(), v = WF.sim.orderView(id); if (!v) return;
    const now = s.t, fc = WF.sim.forecast();
    const body = document.createElement('div'); body.className = 'or-mv';
    const movable = v.ops.filter(o => !o.complete && s.machines[o.station] && s.machines[o.station].kind === 'machine');
    const withAlt = movable.filter(o => compatMachines(o.station).length);
    let modal = null;
    if (!withAlt.length) {
      body.innerHTML = `<div class="or-mv-none">${movable.length
        ? `Für die offenen Arbeitsgänge von ${esc(id)} gibt es keine gleichartige zweite Maschine (${movable.map(o => esc(o.stationName)).join(', ')}). Verlagern ist nur zwischen Dreh- bzw. Fräsmaschinen möglich.`
        : `${esc(id)} hat keinen offenen Bearbeitungsschritt auf einer Maschine mehr.`}</div>`;
    } else {
      body.innerHTML = `<p class="muted" style="margin:0;font-size:12.5px;line-height:1.45">Nur gleichartige Maschinen werden angeboten. Die Engine prüft zusätzlich Teilegewicht, Durchmesser, Stangenmaterial und 5-Achs-Bedarf und begründet eine Ablehnung. Auf der neuen Maschine wird neu gerüstet.</p>`;
      for (const op of withAlt) {
        const sec = document.createElement('div'); sec.className = 'or-mv-op';
        const cands = compatMachines(op.station);
        sec.innerHTML = `<div class="or-mv-h"><em>AG ${op.seq}</em><b>${esc(op.op)}</b><span>derzeit ${esc(op.stationName)} (${esc(op.station)}) · ${nf(Math.max(0, op.target - op.good - op.scrap))} Stk offen</span></div>
          <div class="or-mv-c">${cands.map(mid => {
            const m = s.machines[mid], st = WF.STATE[m.state] || WF.STATE.idle;
            const q = fc.machines[mid] || [];
            const busy = q.length ? Math.max(...q.map(b => b.end)) : null;
            return `<button type="button" data-mid="${esc(mid)}" data-seq="${op.seq}"><b>${esc(m.short)}<em>${esc(mid)}</em></b>${WF.ui.pill(m.state)}<small>${esc(m.name)}<br>${busy && busy > now ? 'eingeplant bis ca. ' + esc(tShort(busy, now)) + ' (' + q.length + ' ' + (q.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge') + ')' : 'derzeit nichts eingeplant'}</small></button>`;
          }).join('')}</div><div class="or-mv-msg" hidden></div>`;
        body.append(sec);
      }
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mid]'); if (!b) return;
        const sec = b.closest('.or-mv-op'), msg = sec.querySelector('.or-mv-msg');
        const r = WF.sim.actions.moveOp(id, Number(b.dataset.seq), b.dataset.mid);
        if (r && r.ok !== false) {
          WF.app.toast('Auf der Zielmaschine wird neu gerüstet; wartende Behälter werden umgeleitet. Die Prognose wird neu berechnet.', 'ok', { title: r.msg || 'Verlagert', ms: 6500 });
          if (modal) modal.close();
          if (WF.app.selected && WF.app.selected.kind === 'order' && WF.app.selected.id === id) WF.app.refreshDrawer();
          update();
        } else {
          msg.hidden = false; msg.textContent = (r && r.msg) || 'Verlagerung nicht möglich';
        }
      });
    }
    modal = WF.app.modal({ title: 'Arbeitsgang verlagern · ' + id, body, width: 620, actions: [{ label: 'Schließen' }] });
  }

  function opRowHtml(op, v, now) {
    const vis = opVis(op);
    const isMachine = !!(S().machines[op.station]);
    let pill;
    if (op.state === 'active') pill = WF.ui.pill(op.machineState);
    else pill = `<span class="pill" style="--c:${op.state === 'open' ? 'var(--faint)' : vis.c}"><i></i>${esc(vis.label)}</span>`;
    const meta = [];
    if (op.station === 'EXT') {
      if (op.ext) { meta.push(esc(op.ext.partner)); meta.push(esc(op.ext.process)); meta.push('Durchlauf ca. ' + U.fmtDur((op.ext.leadMin || 0) * 60)); meta.push('Los ' + nf(op.ext.lotQty) + ' Stk'); }
    } else if (op.station === 'VERSAND') {
      meta.push('Fertigteillager &amp; Versand');
    } else {
      meta.push(isMachine ? `<button class="link" data-ent="machine|${esc(op.station)}">${esc(op.stationName)} (${esc(op.station)})</button>` : esc(op.stationName));
      if (op.setupMin) meta.push('Rüsten ' + nf(op.setupMin) + ' min');
      if (op.cycleMin) meta.push(U.fmtNum(op.cycleMin, op.cycleMin < 1 ? 2 : op.cycleMin < 10 ? 1 : 0) + ' min/Stk');
      if (op.transferBatch) meta.push('Weitergabe je ' + nf(op.transferBatch) + ' Stk');
      if (op.firstPiece) meta.push('mit Erstteilprüfung');
    }
    let cause = '';
    if (op.state === 'active' && op.cause) cause = `<div class="or-op-c">${esc(cleanCause(op.cause, v.id))}</div>`;
    else if (op.state === 'external' && op.ext) cause = `<div class="or-op-c">${esc(extText(v, op, now))}</div>`;
    const cell = (l, n, cls, unit) => `<div class="${cls || (n ? '' : 'z')}"><span>${l}</span><b>${nf(n)}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
    let q = '', bar = '';
    if (op.station === 'EXT' && op.ext) {
      const e = op.ext;
      q = `<div class="or-op-q">${cell('Gesendet', e.sentQty)}${cell('Beim Partner', e.atPartnerQty)}${cell('Abholbereit', e.waitingPickupQty)}${cell('Zurück', e.returnedQty)}</div>`;
      bar = WF.ui.bar((op.targetIn ? e.returnedQty / op.targetIn : 0), { thin: true, color: op.complete ? 'var(--st-run)' : 'var(--st-wait)' });
    } else if (op.station === 'VERSAND') {
      q = `<div class="or-op-q" style="grid-template-columns:repeat(2,minmax(0,1fr))">${cell('Versandt', op.good, null, '/ ' + nf(v.qty))}${cell('Offen', Math.max(0, v.qty - op.good))}</div>`;
      bar = WF.ui.bar(v.qty ? op.good / v.qty : 0, { thin: true, color: 'var(--st-run)' });
    } else {
      const extra = op.inProc > 0 ? ` <small>+${nf(op.inProc)} in Bearb.</small>` : '';
      q = `<div class="or-op-q">${cell('Eingang', op.received)}<div class="${op.good ? '' : 'z'}"><span>Gut</span><b>${nf(op.good)}<small>/ ${nf(op.target)}</small></b></div>${cell('Ausschuss', op.scrap, op.scrap ? 'bad' : 'z')}<div class="${op.waiting || op.inProc ? '' : 'z'}"><span>Wartet</span><b>${nf(op.waiting)}${extra}</b></div></div>`;
      bar = WF.ui.bar(op.target ? op.good / op.target : 0, { thin: true, color: op.complete ? 'var(--st-run)' : vis.k === 'active' ? vis.c : 'var(--st-idle)' });
    }
    const times = [];
    if (op.state === 'done' && op.endT != null && op.endT <= simStartT()) {
      times.push(`Abgeschlossen <b>vor ${esc(U.fmtDayClock(simStartT()))}</b>`);
    } else if (op.state === 'done') {
      times.push(`Ist <b>${esc(tAct(op.startT, now))}</b> – <b>${esc(tAct(op.endT, now))}</b>`);
      if (op.startT != null && op.endT != null && op.startT > simStartT()) times.push('Durchlauf ' + esc(U.fmtDur(op.endT - op.startT)));
    } else if (op.station === 'EXT' && op.ext) {
      const e = op.ext;
      if (e.pickupT != null && (e.waitingPickupQty > 0 || e.sentQty < (op.targetIn || v.qty))) times.push(`Nächste Abholung ca. <b>${esc(tShort(e.pickupT, now))}</b>`);
      if (e.returnT != null) times.push(`${e.atPartnerQty > 0 ? 'Rückkehr' : 'Erste Rückkehr'} ca. <b>${esc(tShort(e.returnT, now))}</b>`);
      if (e.lastReturnT != null && e.lastReturnT !== e.returnT) times.push(`Alles zurück ca. <b>${esc(tShort(e.lastReturnT, now))}</b>`);
    } else if (op.station === 'VERSAND') {
      if (v.eta != null) times.push(`Komplett versandt ca. <b>${esc(tShort(v.eta, now))}</b>`);
    } else {
      if (op.startT != null && (op.received > 0 || op.good > 0 || op.state === 'active')) times.push(`Begonnen <b>${esc(tAct(op.startT, now))}</b>`);
      else if (op.plannedStart != null) times.push(`Start ca. <b>${esc(tShort(op.plannedStart, now))}</b>`);
      if (op.plannedEnd != null) times.push(`Fertig ca. <b>${esc(tShort(op.plannedEnd, now))}</b>`);
    }
    return `<div class="or-op-rail"><span class="or-op-node">${vis.k === 'done' ? icon('check', 11) : vis.k === 'ext' ? icon('truck', 10) : ''}</span></div>
      <div class="or-op-b">
        <div class="or-op-h"><em>AG ${op.seq}</em><b title="${esc(op.op)}">${esc(op.op)}</b>${pill}</div>
        <div class="or-op-m">${meta.join(' · ')}</div>
        ${cause}${q}${bar}
        ${times.length ? `<div class="or-op-t">${times.map(x => `<span>${x}</span>`).join('')}</div>` : ''}
      </div>`;
  }
  function patchKeyed(box, items) {
    const have = new Map();
    for (const ch of Array.from(box.children)) have.set(ch.dataset.k, ch);
    let prev = null;
    for (const it of items) {
      let n = have.get(it.k);
      if (!n) { n = document.createElement('div'); n.dataset.k = it.k; }
      have.delete(it.k);
      if (n._h !== it.html) { n._h = it.html; n.innerHTML = it.html; }
      if (it.cls != null && n._c !== it.cls) { n._c = it.cls; n.className = it.cls; }
      if (it.style != null && n._s !== it.style) { n._s = it.style; n.setAttribute('style', it.style); }
      if (it.ent != null) n.dataset.ent = it.ent;
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== n) box.insertBefore(n, want);
      prev = n;
    }
    for (const n of have.values()) n.remove();
  }
  function heroHtml(v, now) {
    const rb = riskBadge(v);
    const fc = WF.sim.forecast(), f = fc.orders[v.id] || {};
    const fin = finishedGood(v);
    const top = `<div class="or-hero-top"><span class="or-rb" style="--c:${rb.c}"><i></i>${esc(rb.label)}</span><span class="or-hero-slack">${esc(slackText(v))}</span><span class="spacer" style="flex:1"></span>${v.priority === 'eil' ? `<span class="or-tag eil">${icon('bolt', 11)}Eilauftrag</span>` : ''}${v.status === 'freigegeben' ? '<span class="or-tag rel">Freigegeben</span>' : ''}</div>`;
    const pend = v.status !== 'fertig' && v.etaPending != null && v.eta != null && Math.abs(v.etaPending - v.eta) > 900;
    const d = `<div class="or-hero-d">
      <div><span class="eyebrow">Liefertermin</span><b>${esc(fmtDue(v.due, now))}</b><small>${esc(v.status === 'fertig' ? U.fmtDayClock(v.due) : v.due >= now ? 'in ' + durLong(v.due - now) : 'seit ' + durLong(now - v.due) + ' überschritten')}</small></div>
      <div><span class="eyebrow">${v.status === 'fertig' ? 'Fertig' : 'Prognose fertig'}</span><b>${esc(v.status === 'fertig' ? fmtDue(v.doneT, now) : fmtDue(v.eta, now))}</b><small>${pend ? 'neu gerechnet ' + esc(tShort(v.etaPending, now)) + ' – wird geprüft' : v.status === 'fertig' ? (v.onTime ? 'termingerecht und vollständig' : 'nicht termingerecht') : 'aus Live-Daten, inkl. Fremdbearbeitung'}</small></div>
      <div><span class="eyebrow">Fortschritt</span><b>${esc(U.fmtPct(v.progress))}</b><small>${nf(fin)}/${nf(v.qty)} fertig · ${nf(v.shippedQty)} versandt</small></div>
    </div>`;
    const bar = `<span class="or-pbar" style="--oc:${colorOf(v.id)}"><i style="width:${(U.clamp(v.progress, 0, 1) * 100).toFixed(1)}%"></i></span>`;
    const nl = nowLine(v, now);
    let notes = `<div class="or-hero-n ${nl.cls}">${icon(nl.ic || 'arrowRight', 15)}<span>${nl.html}</span></div>`;
    if (v.status !== 'fertig' && v.bottleneck) notes += `<div class="or-hero-n">${icon('gauge', 15)}<span>Engpass laut Prognose: <b>${esc(v.bottleneck)}</b>${f.bottleneckSec ? ' – längster Arbeitsgang mit ca. ' + esc(durLong(f.bottleneckSec)) + ' Durchlauf' : ''}</span></div>`;
    return `<div class="or-hero" style="--rc:${rb.c}">${top}${d}${bar}${notes}</div>`;
  }
  function factsHtml(v, now) {
    const scrap = v.ops.reduce((a, o) => a + (o.scrap || 0), 0);
    const p = v.part;
    const sLabel = (WF.sim.LABELS && WF.sim.LABELS.orderStatus && WF.sim.LABELS.orderStatus[v.status]) || v.status;
    const f = [
      ['Kunde', v.customer, 'wide'], ['Branche', v.sector || '–'], ['Priorität', v.priority === 'eil' ? 'Eilauftrag' : 'Normal'],
      ['Teil', p.name], ['Teilenummer', p.no || '–'],
      ['Zeichnung', p.drawing || '–'], ['Werkstoff', p.material || '–'],
      ['Menge', nf(v.qty) + ' Stk' + (p.weightKg ? ' · ' + U.fmtKg(p.weightKg) + '/Stk' : '')], ['Ausschuss gesamt', scrap ? nf(scrap) + ' Stk (nachgefertigt)' : 'keiner'],
      ['Status', sLabel + (v.startT != null ? ' · begonnen ' + tAct(v.startT, now) : ''), 'wide'],
    ];
    if (v.source && v.source !== 'profil') f.push(['Auftragsquelle', v.source]);
    let h = f.map(([l, val, cls]) => `<div${cls ? ` class="${cls}"` : ''}><span>${esc(l)}</span><b>${esc(val)}</b></div>`).join('');
    if (v.note) h += `<div class="wide"><span>Notiz</span><b>${esc(v.note)}</b></div>`;
    return `<div class="or-facts">${h}</div>`;
  }
  function matItems(v, now) {
    const s = S(), items = [];
    const where = (c) => {
      const l = c.location;
      if (l && l.kind === 'station' && s.machines[l.id]) return `<button class="link" data-ent="machine|${esc(l.id)}">${esc(s.machines[l.id].short)}</button>`;
      if (l && l.kind === 'agv') return `<button class="link" data-ent="agv|${esc(l.id)}">${esc(s.agvs[l.id] ? s.agvs[l.id].name : l.id)}</button>`;
      return '';
    };
    const conts = v.containers.filter(c => c.state !== 'shipped' && c.state !== 'scrap')
      .sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.srcSeq || 0) - (b.srcSeq || 0) || (a.id < b.id ? -1 : 1));
    for (const op of v.ops) {
      if (op.state === 'active' && op.inProc > 0) {
        const m = s.machines[op.station];
        items.push({ k: 'p' + op.seq, cls: 'or-mt c-proc', ent: 'machine|' + op.station,
          html: `<span class="or-mt-ic">${icon('settings', 15)}</span><div class="or-mt-a"><b>${nf(op.inProc)} Stk</b><span>in Bearbeitung · AG ${op.seq}</span></div><div class="or-mt-w">${esc(m ? m.short + ' (' + op.station + ')' : op.stationName)} – ${esc(cleanCause(op.cause, v.id))}</div><div class="or-mt-st"><span class="chip">An der Maschine</span></div>` });
      }
    }
    for (const c of conts) {
      const target = c.seq != null ? v.ops.find(o => o.seq === c.seq) : null;
      const from = c.srcSeq != null ? v.ops.find(o => o.seq === c.srcSeq) : null;
      let what = c.kind === 'raw' ? 'Rohteile' : '';
      if ((c.state === 'filling' || c.state === 'ready') && from) what += ` aus AG ${from.seq}`;
      if (target) what += ` für AG ${target.seq} ${stLabel(target)}`;
      what = what.trim();
      items.push({ k: c.id, cls: 'or-mt c-' + c.state, ent: 'container|' + c.id,
        html: `<span class="or-mt-ic">${icon(c.state === 'transit' ? 'truck' : 'box', 15)}</span><div class="or-mt-a"><b>${esc(c.id)}</b><span>${nf(c.qty)} Stk ${esc(what)}</span></div><div class="or-mt-w">${esc(c.where)}</div><div class="or-mt-st"><span class="chip">${esc(c.stateLabel)}</span>${where(c)}</div>` });
    }
    return items;
  }
  function matSummary(v) {
    const shipped = v.containers.filter(c => c.state === 'shipped'), scrap = v.containers.filter(c => c.state === 'scrap');
    const parts = [];
    if (shipped.length) parts.push(`Versandt: <b>${nf(shipped.reduce((a, c) => a + c.qty, 0))} Stk</b> in ${nf(shipped.length)} ${shipped.length === 1 ? 'Behälter' : 'Behältern'}`);
    if (scrap.length) parts.push(`Sperrlager: <b>${nf(scrap.reduce((a, c) => a + c.qty, 0))} Stk</b> Ausschuss`);
    return parts.join('<span class="or-sep">·</span>');
  }
  function orderEvents(id) {
    const s = S(), out = [];
    for (let k = s.events.length - 1; k >= 0 && out.length < 120; k--) {
      const e = s.events[k], d = e.data || {};
      if (d.minor) continue;
      if ((e.entity && e.entity.kind === 'order' && e.entity.id === id) || d.orderId === id) out.push(e);
    }
    return out;
  }

  WF.registerDetail('order', (id) => {
    const v0 = WF.sim.orderView(id);
    if (!v0) return null;
    const st = { built: false, evAll: false, chain: null };
    const subtitle = `<span class="or-d-sub"><span class="or-sw" style="--oc:${colorOf(id)}"></span><span>${esc(v0.customer)}</span><span class="faint">·</span><span>${esc(v0.sector || '')}</span><span class="faint">·</span><span class="mono">${esc(v0.part.no || '')}</span></span>`;
    let N = null;
    function render(el) {
      el.innerHTML = `
        <section data-n="hero"></section>
        <section class="or-sec" data-n="ntSec" hidden><h4><span>Meldungen zu diesem Auftrag</span></h4><div class="or-nts" data-n="nts"></div></section>
        <section class="or-sec"><div class="or-acts" data-n="acts"></div></section>
        <section class="or-sec"><h4><span>Arbeitsplan</span><span class="spacer"></span><small data-n="opsSub"></small></h4><div class="or-chain or-dchain" data-n="chain"></div><div class="or-ops" data-n="ops"></div></section>
        <section class="or-sec"><h4><span>Wo ist das Material?</span><span class="spacer"></span><small data-n="matSub"></small></h4><div class="or-mat" data-n="mat"></div><div class="or-msum" data-n="msum"></div></section>
        <section class="or-sec"><h4><span>Auftragsdaten</span></h4><div data-n="facts"></div></section>
        <section class="or-sec"><h4><span>Ereignisse</span><span class="spacer"></span><small data-n="evSub"></small></h4><div data-n="ev"></div><button type="button" class="btn sm ghost or-more" data-n="evMore" hidden></button></section>`;
      N = {}; el.querySelectorAll('[data-n]').forEach(n => { N[n.dataset.n] = n; });
      st.chain = { box: N.chain, chips: [], links: [], nOps: -1, compact: true };
      el.addEventListener('click', (e) => onClick(e));
      N.evMore.onclick = () => { st.evAll = !st.evAll; N.ev._h = null; update(el); };
      update(el);
    }
    function onClick(e) {
      const na = e.target.closest('[data-nact]');
      if (na) {
        const [k, nid, idx] = na.dataset.nact.split('|');
        const n = S().notifications.find(x => x.id === nid); if (!n) return;
        if (k === 'ack') { WF.sim.actions.ack(n.id, 'Schichtleitung'); WF.app.toast('Meldung quittiert', 'ok'); }
        else if (k === 'run' && n.actions && n.actions[Number(idx)]) WF.app.runAction(n.actions[Number(idx)].action);
        N.nts._h = null; update(); return;
      }
      const ent = e.target.closest('[data-ent]');
      if (ent) { const [k, i] = ent.dataset.ent.split('|'); WF.app.select(k, i); return; }
      const step = e.target.closest('.or-dchain .or-step');
      if (step && N) { const idx = Array.prototype.indexOf.call(N.chain.querySelectorAll('.or-step'), step); const row = N.ops.children[idx]; if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      const act = e.target.closest('[data-act]'); if (!act || act.disabled) return;
      switch (act.dataset.act) {
        case 'prio': togglePriority(id); break;
        case 'move': openMoveModal(id); break;
        case 'hall':
          if (!hasView('halle')) { WF.app.toast('Die Ansicht Halle 3D ist in dieser Ausgabe nicht verfügbar', 'warn'); break; }
          WF.app.navigate('halle');
          if (WF.hall && WF.hall.focusOrder) { try { WF.hall.focusOrder(id); } catch (err) { console.warn(err); } }
          break;
        case 'plan': WF.app.closeDrawer(); WF.app.navigate('auftraege', { mode: 'gantt', order: id }); break;
      }
    }
    function update(el) {
      if (!N) return;
      const v = WF.sim.orderView(id); if (!v) return;
      const now = S().t;
      setHTML(N.hero, heroHtml(v, now));
      const nts = orderNotifs(id, false);
      setHidden(N.ntSec, !nts.length);
      setHTML(N.nts, nts.map(n => {
        const sv = WF.SEV[n.sev] || WF.SEV.info;
        const acts = (n.actions || []).map((a, i) => ({ a, i })).filter(x => !(x.a.action && x.a.action.type === 'select' && x.a.action.id === id));
        return `<div class="or-nt${n.status === 'ack' ? ' ack' : ''}" style="--c:${sv.color}">
          <div class="or-nt-h"><span>${esc(tShort(n.t, now))} · ${esc(n.role || '')}</span>${n.status === 'ack' ? `<span>quittiert${n.ackBy ? ' von ' + esc(n.ackBy) : ''}</span>` : `<span class="or-nt-sev">${esc(sv.label)}</span>`}</div>
          <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}${n.suggestion ? `<div class="or-nt-s"><b>Empfehlung:</b> ${esc(n.suggestion)}</div>` : ''}
          <div class="or-nt-a">${acts.map(x => `<button type="button" class="btn sm" data-nact="run|${esc(n.id)}|${x.i}">${esc(x.a.label)}</button>`).join('')}${n.status === 'open' ? `<button type="button" class="btn sm ghost" data-nact="ack|${esc(n.id)}">Quittieren</button>` : ''}</div></div>`;
      }).join(''));
      const fin = v.status === 'fertig';
      const hasMove = !fin && v.ops.some(o => !o.complete && compatMachines(o.station).length);
      setHTML(N.acts,
        (fin ? '' : `<button type="button" class="btn${v.priority === 'eil' ? ' on' : ''}" data-act="prio">${icon('bolt', 15)}${v.priority === 'eil' ? 'Eilauftrag aufheben' : 'Als Eilauftrag'}</button>`) +
        (fin ? '' : `<button type="button" class="btn" data-act="move"${hasMove ? '' : ' title="Kein offener Arbeitsgang mit gleichartiger Alternativmaschine"'}>${icon('route', 15)}Arbeitsgang verlagern</button>`) +
        `<button type="button" class="btn" data-act="hall"${hasView('halle') ? '' : ' disabled title="Ansicht Halle nicht verfügbar"'}>${icon('cube', 15)}In der Halle verfolgen</button>` +
        `<button type="button" class="btn ghost" data-act="plan">${icon('layers', 15)}Plantafel</button>`);
      const doneN = v.ops.filter(o => o.state === 'done').length;
      setText(N.opsSub, `${nf(doneN)} von ${nf(v.ops.length)} Schritten fertig`);
      patchChain(st.chain, v, now);
      patchKeyed(N.ops, v.ops.map(op => { const vis = opVis(op); return { k: 'op' + op.seq, cls: 'or-op s-' + vis.k, style: '--c:' + vis.c, html: opRowHtml(op, v, now) }; }));
      const mi = matItems(v, now);
      setText(N.matSub, mi.length ? `${nf(mi.length)} ${mi.length === 1 ? 'Ort' : 'Orte'}` : '');
      if (!mi.length) mi.push({ k: 'none', cls: 'empty', ent: null, html: fin ? 'Alle Teile sind versandt.' : 'Noch kein Material im Umlauf – der erste Arbeitsgang entnimmt das Rohmaterial beim Start.' });
      patchKeyed(N.mat, mi);
      setHTML(N.msum, matSummary(v));
      setHTML(N.facts, factsHtml(v, now));
      const evs = orderEvents(id);
      const shown = st.evAll ? evs : evs.slice(0, 10);
      setText(N.evSub, evs.length ? `${nf(evs.length)}${evs.length >= 120 ? '+' : ''} Einträge` : '');
      const evHtml = shown.length ? shown.map(e => `<div class="or-ev" style="--c:${EV_SEV_C[e.sev] || 'var(--muted)'}"><time>${esc(tShort(e.t, now))}</time>${icon(EV_ICON[e.type] || 'dot', 15)}<span>${esc(e.msg)}</span></div>`).join('')
        : '<div class="empty">Noch keine Ereignisse zu diesem Auftrag.</div>';
      setHTML(N.ev, evHtml);
      setHidden(N.evMore, evs.length <= 10);
      setText(N.evMore, st.evAll ? 'Weniger anzeigen' : `Alle ${nf(evs.length)} Ereignisse anzeigen`);
    }
    return {
      title: `${id} · ${v0.part.name}`,
      subtitle,
      render,
      update: (el) => update(el),
      askPrompt: `Gib mir eine kurze Lageeinschätzung zu Auftrag ${id} (${v0.part.name}, ${v0.qty} Stk für ${v0.customer}): Wo steht er gerade, hält der Liefertermin ${U.fmtDayClock(v0.due)}, was ist der Engpass, und was empfiehlst du (Priorität, Verlagerung, Fremdbearbeitung)?`,
    };
  });
})();
