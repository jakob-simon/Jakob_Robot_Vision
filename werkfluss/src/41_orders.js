/* werkfluss – Ansicht „Aufträge“ (41_orders.js) + Detail „order“.
   Kopf mit Kennzahlen (offene Aufträge, Terminlage im Plan/knapp/spät, heute versandt, Termintreue, Fremdbearbeitung)
   und Umschalter „Auftragsliste | Plantafel“.
   - Auftragsliste: je Auftrag eine Karte mit Arbeitsplan-Kette (Stationen als verbundene Schritte, Materialfluss
     zwischen den Schritten), Fortschritt, Termin vs. Prognose, Terminlage, Engpass, Eilauftrag-Schalter.
   - Plantafel: Gantt je Arbeitsplatz + Fremdbearbeitung; Vergangenheit = tatsächliche Belegung (aus den Ereignissen)
     mit Zustandsband, Zukunft = Prognose-Blöcke (WF.sim.forecast) je Auftragsfarbe, Rüstanteil schraffiert.
   - Detail „order“: Lage, Aktionen (Priorität, Arbeitsgang verlagern, Halle, Plantafel), Arbeitsgänge, Material, Ereignisse.
   Nur lesen (WF.sim.*), handeln über WF.sim.actions. Aktualisierung inkrementell (Felder patchen, SVG nur bei neuer
   Prognose neu zeichnen). CSS-Präfix .or-  ·  Öffentlich: WF.ordersUi = { colorOf(orderId), route(ops, opts) },
   WF.ui.route(ops, {mode:'row'|'stack', current}) – eine Arbeitsplan-Darstellung für alle Ansichten. */
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
  // Seit der ruhigen Plantafel nutzt diese Ansicht die Auftragsfarben nicht mehr (hervorgehoben = Akzent);
  // colorOf bleibt als öffentliche Schnittstelle erhalten.
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
  /** Wochentag mit Wochenbezug: „Mi 14:00“ (diese Woche), „nächsten Mo 12:00“, „letzten Fr 10:00“, „in 2 Wochen Di 08:00“ –
      sonst wäre am Montag „Mo 12:00“ der nächsten Woche nicht von heute zu unterscheiden */
  function weekDayClock(t, now) {
    const w = Math.floor(t / (7 * DAY)) - Math.floor(now / (7 * DAY));
    if (w === 0) return U.fmtDayClock(t);
    if (w === 1) return 'nächsten ' + U.fmtDayClock(t);
    if (w === -1) return 'letzten ' + U.fmtDayClock(t);
    return (w > 0 ? 'in ' + w + ' Wochen ' : 'vor ' + (-w) + ' Wochen ') + U.fmtDayClock(t);
  }
  /** Uhrzeit relativ zu heute: „15:02“, „morgen 06:30“, „Mi 14:00“, „nächsten Mo 12:00“ */
  function tShort(t, now) {
    if (t == null || !isFinite(t)) return '–';
    const d = dayOf(t) - dayOf(now);
    if (d === 0) return U.fmtClock(t);
    if (d === 1) return 'morgen ' + U.fmtClock(t);
    if (d === -1) return 'gestern ' + U.fmtClock(t);
    return weekDayClock(t, now);
  }
  /** Ist-Zeitpunkt; vor Simulationsbeginn (Anfangsbestand) ehrlich als „vor Mo 06:00“ */
  function tAct(t, now) {
    if (t == null) return '–';
    if (t <= simStartT()) return 'vor ' + U.fmtDayClock(simStartT());
    return tShort(t, now);
  }
  const fmtDue = (t, now) => (t == null ? '–' : U.fmtDue(t, now));
  /** Termin für Karten und Drawer (ein Format): „heute 14:00“, „morgen 10:00“, „Mi 14:00“, „nächsten Mo 10:00“ */
  function dueShort(t, now) {
    if (t == null || !isFinite(t)) return '–';
    const d = dayOf(t) - dayOf(now);
    if (d === 0) return 'heute ' + U.fmtClock(t);
    if (d === 1) return 'morgen ' + U.fmtClock(t);
    if (d === -1) return 'gestern ' + U.fmtClock(t);
    return weekDayClock(t, now);
  }
  /** Neu gerechnete, noch unbestätigte Prognose (Engine: etaPending; bis zur nächsten Veröffentlichung etaRaw bei > 15 min Abstand) */
  function pendingEta(v) {
    if (!v || v.status === 'fertig' || v.eta == null) return null;
    const p = v.etaPending != null ? v.etaPending : (v.etaRaw != null && Math.abs(v.etaRaw - v.eta) > 900 ? v.etaRaw : null);
    return p != null && Math.abs(p - v.eta) >= 60 ? p : null;
  }
  /** Menge gefährdet (Engine: qtyRisk.missing > 0 – Ausschuss nach dem 1. Arbeitsgang, keine Nachfertigung eingeplant) */
  const qtyShort = (v) => (v && v.status !== 'fertig' && v.qtyRisk && typeof v.qtyRisk === 'object' && v.qtyRisk.missing > 0 ? v.qtyRisk : null);
  /** Terminlage für die Darstellung: Engine-Risiko – eine fehlende Menge ist nie „Im Plan“, sondern mindestens Stufe „knapp“ */
  function riskOf(v) {
    if (v.status !== 'fertig' && qtyShort(v) && (v.risk === 'ok' || v.risk === 'unbekannt' || !v.risk)) return 'knapp';
    return v.risk;
  }
  /** Termin selbst gefährdet (verspätet oder < 4 h Puffer) – nur dann gibt es eine Verzögerungs-Ursache und Termin-Hebel */
  const timeRisk = (v) => v.status !== 'fertig' && (v.risk === 'spät' || (v.risk === 'knapp' && !(qtyShort(v) && v.slackSec != null && v.slackSec >= 4 * HOUR)));
  /** Begrenzender Schritt eines Auftrags (Engine: limit/limitText, sonst bottleneck) → {name, seq, plant, text} */
  function limitOf(v) {
    const bw = plantBottleneck();
    if (v.limit && (v.limit.stationId || v.limit.name)) {
      const L = v.limit, st = L.stationId;
      const name = L.name || (st === 'EXT' ? 'Fremdbearbeitung' : (WF.sim.stationName ? (st + ' ' + WF.sim.stationName(st)) : st));
      const plant = !!(bw && bw.stationId && st === bw.stationId) || /^Werks-Engpass/.test(v.limitText || '');
      return { name, seq: L.seq, plant, text: v.limitText || ((plant ? 'Werks-Engpass ' : 'begrenzt durch ') + name + (L.seq != null ? ' (AG ' + L.seq + ')' : '')), sec: L.sec };
    }
    if (!v.bottleneck) return null;
    const plant = !!(bw && bw.stationId && String(v.bottleneckStation || '') === bw.stationId);
    return { name: v.bottleneck.replace(/\s*\(.*$/, ''), seq: bnSeq(v), plant, text: (plant ? 'Werks-Engpass ' : 'begrenzt durch ') + v.bottleneck, sec: null };
  }
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
    if (op.state === 'external') return { k: 'ext', c: 'var(--ext)', label: 'In Fremdbearbeitung' };
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
  function bnSeq(v) {
    if (v.limit && v.limit.seq != null) return v.limit.seq;
    if (v.bottleneckSeq != null) return v.bottleneckSeq;
    const f = WF.sim.forecast().orders[v.id];
    if (f && f.bottleneckSeq != null) return f.bottleneckSeq;
    const m = v.bottleneck && /AG\s*(\d+)/.exec(v.bottleneck); return m ? Number(m[1]) : null;
  }
  /** Engpass im Werk – eine Definition (Engine), sonst null */
  let bnMemo = { k: null, v: null };
  function plantBottleneck() {
    if (!WF.sim || typeof WF.sim.bottleneck !== 'function') return null;
    const k = S() ? S().t : null;   // je Simulationszeitpunkt einmal rechnen (Karten, Kette, Kopf fragen mehrfach)
    if (bnMemo.k === k && k != null) return bnMemo.v;
    try { bnMemo.v = WF.sim.bottleneck(); } catch (e) { bnMemo.v = null; }
    bnMemo.k = k;
    return bnMemo.v;
  }
  /** besondere Auftragsherkunft als Etikett (Profil-/ERP-Aufträge ohne Etikett) */
  function srcTag(v) {
    if (v.status === 'fertig') return null;
    if (v.remakeOf || v.source === 'Nachfertigung') return { label: 'Nachfertigung', title: 'Nachfertigung' + (v.remakeOf ? ' für ' + v.remakeOf : '') + ' – Ausschuss nach dem ersten Arbeitsgang wird neu gefertigt' };
    if (v.source === 'KI-Auftrag') return { label: 'KI-Auftrag', title: 'Aus einer Zeichnung mit dem KI-Auftrag eingelastet' };
    return null;
  }
  /** Termin gefährdet (knapp oder verspätet) – nur dann wird der begrenzende Schritt des Auftrags als Etikett gezeigt */
  const atRisk = (v) => timeRisk(v);
  /** Fortschritt einer Auftragskarte: Stückzahl als Hauptaussage, Arbeitsinhalt (Engine: progress) als zweite Ebene */
  function progOf(v) {
    const qty = Math.max(1, v.qty), work = U.clamp(v.progress || 0, 0, 1);
    // Menge gefährdet (Engine: qtyRisk) – Ausschuss nach dem 1. Arbeitsgang wird nicht automatisch nachgefertigt
    const qr = v.status !== 'fertig' && v.qtyRisk && typeof v.qtyRisk === 'object' ? v.qtyRisk : null;
    const xq = qr && qr.missing > 0 ? qr.expectedQty : null;
    const qWarn = xq != null ? ` <span class="nw q" title="${esc(qr.text || '')}">nur ${nf(xq)}/${nf(v.qty)} Stk lieferbar</span>`
      : qr && qr.remakeQty > 0 ? ` <span class="nw r" title="${esc(qr.text || '')}">${nf(qr.remakeQty)} Stk in Nachfertigung</span>` : '';
    if (v.status === 'fertig') {
      const short = Math.max(0, v.qty - v.shippedQty);
      return { n: v.shippedQty, label: 'versandt', frac: v.shippedQty / qty, work: 1,
        sub: short ? `<b>${nf(short)} Stk</b> fehlen` : 'vollständig geliefert',
        title: `${nf(v.shippedQty)} von ${nf(v.qty)} Stk versandt${short ? ' – ' + nf(short) + ' Stk fehlen' : ''}` };
    }
    const fin = Math.min(v.qty, finishedGood(v));
    return { n: fin, label: 'fertig', frac: fin / qty, work,
      // Mengenwarnung zuerst – sie darf nicht im Abschneiden der Zeile verschwinden
      sub: (xq != null ? qWarn.trim() + ' ' : '') + `<span class="nw">Arbeitsinhalt <b>${U.fmtPct(work)}</b></span>${v.shippedQty ? ` <span class="nw"><b>${nf(v.shippedQty)}</b> versandt</span>` : ''}${xq != null ? '' : qWarn}`,
      title: `${nf(fin)} von ${nf(v.qty)} Stk fertig bearbeitet (kräftiger Balken) · ${nf(v.shippedQty)} Stk versandt\nArbeitsinhalt ${U.fmtPct(work)} erledigt (heller Balken: Rüst- und Bearbeitungszeit aller Arbeitsgänge, auch Teile in Arbeit)` +
        (qr && qr.text ? `\n${qr.text}` : '') };
  }
  function slackText(v, compact) {
    if (v.status === 'fertig') {
      if (v.shippedQty < v.qty) return nf(v.qty - v.shippedQty) + ' Stk fehlen';
      if (v.slackSec != null && v.slackSec < 0) return durLong(-v.slackSec) + ' nach Termin';
      return v.slackSec != null ? durLong(v.slackSec) + ' vor Termin' : 'geliefert';
    }
    const qs = qtyShort(v), qTxt = qs ? nf(qs.missing) + ' Stk fehlen' : '';
    if (v.slackSec == null) return qTxt || 'keine Prognose';
    const tTxt = v.slackSec >= 0 ? 'Puffer ' + durLong(v.slackSec) : durLong(-v.slackSec) + ' zu spät';
    // Karte: bei reinem Mengenrisiko zählt die fehlende Menge (der Termin selbst hält); ausführlich im Drawer
    if (qTxt && compact && !timeRisk(v)) return qTxt;
    return qTxt ? qTxt + ' · ' + tTxt : tTxt;
  }
  function riskBadge(v) {
    if (v.status === 'fertig') {
      const ok = v.onTime;
      return { label: ok ? 'Pünktlich' : (v.shippedQty < v.qty ? 'Teilmenge' : 'Verspätet'), c: ok ? 'var(--st-run)' : 'var(--st-fault)' };
    }
    const rk = riskOf(v);
    // Menge gefährdet bei sonst gutem Termin: nie „Im Plan“ (Engine-Label übernehmen, sobald die Engine es selbst liefert)
    if (rk !== v.risk || (qtyShort(v) && !timeRisk(v))) return { label: 'Menge gefährdet', c: RISK_C.knapp, qty: true };
    return { label: v.riskLabel || riskLabel(rk), c: RISK_C[rk] || RISK_C.unbekannt };
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
      const parts = act.map(o => `${dotHtml((WF.STATE[o.machineState] || WF.STATE.idle).color)}<b>${esc(stLabel(o))}</b> ${esc(cleanCause(o.cause, v.id) || (WF.STATE[o.machineState] || {}).label || '')}`);
      return { cls: '', ic: null, parts, html: parts.slice(0, 2).join('<span class="or-sep">·</span>') };
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
  .or-head .view-sub{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;max-width:none}
  @media (max-width:560px){.or-head .view-sub > .faint{display:none}.or-head .view-sub > span{flex-basis:100%}.or-head .view-sub > .or-bnw{margin-top:2px}}
  .or-bnw{position:relative;display:inline-flex;align-items:center;gap:6px;height:22px;margin-left:4px;padding:0 9px 0 7px;border-radius:999px;border:1px solid var(--line2);background:var(--card);color:var(--muted);font:500 var(--fs-xs)/1 var(--f-ui);cursor:pointer;white-space:nowrap}
  .or-bnw b{font-weight:600;color:var(--text2)}
  .or-bnw .ico{color:var(--faint)}
  .or-bnw:hover{border-color:var(--muted);color:var(--text2)}
  .or-bnw.risk{border-color:color-mix(in srgb,var(--st-wait) 40%,transparent);background:color-mix(in srgb,var(--st-wait) 8%,var(--card))}
  .or-bnw.risk .ico{color:var(--st-wait)}
  @media (max-width:560px){.or-bnw{margin-left:0}}
  .or-head-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .or-mode button{display:inline-flex;align-items:center;gap:6px}
  .or-mode button .ico{opacity:.85}

  /* Kennzahlen: eine Kachel je Aussage (UI_GUIDE Regel 14) – Terminlage in „Verspätet“ und „Knapp“ aufgeteilt */
  .or-kpis{display:grid;gap:10px;grid-template-columns:repeat(6,minmax(0,1fr))}
  .or-kpis .kpi .s b{color:var(--text2);font-weight:600}
  .or-kpis .kpi .s .mono{font-size:var(--fs-xs)}
  .or-kpis .kpi.click{cursor:pointer;transition:border-color .15s ease}
  .or-kpis .kpi.click:hover{border-color:var(--line2)}
  .or-kpis .kpi.click:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .or-rbar{display:flex;gap:2px;height:4px;border-radius:2px;overflow:hidden;background:var(--track)}
  .or-rbar i{display:block;height:100%;background:var(--c);transition:width .4s ease}

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
  .or-search input{height:32px;padding:0 30px 0 32px;font-size:var(--fs-md);background:var(--card);border-color:var(--line)}
  .or-search input:focus{border-color:var(--accent);background:var(--bg2)}
  .or-search input::-webkit-search-cancel-button{display:none;-webkit-appearance:none}
  .or-search button{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center}
  .or-search button:hover{color:var(--text);background:var(--raise)}
  .or-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted);width:100%;padding:0 2px}
  .or-legend span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .or-legend .or-lgs{width:20px;height:12px;border-radius:4px;border:1px solid var(--c);background:color-mix(in srgb,var(--c) 18%,transparent)}
  .or-legend .or-lgs.open{border-style:dashed;background:transparent;border-color:var(--line2)}
  .or-legend .or-lgf{width:18px;height:2px;background:repeating-linear-gradient(90deg,var(--mat) 0 4px,transparent 4px 7px)}

  .or-thead,.or-top{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 168px 200px 136px 40px;gap:16px;align-items:center}
  .or-thead{padding:0 16px 0 19px;font:600 10.5px/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
  .or-list{display:flex;flex-direction:column;gap:8px}
  .or-card{--rc:var(--st-run);container:orcard / inline-size;position:relative;display:flex;flex-direction:column;gap:11px;padding:13px 16px 12px 19px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);cursor:pointer;min-width:0;transition:border-color .15s ease,background-color .15s ease}
  .or-card:hover{border-color:var(--line2);background:color-mix(in srgb,var(--card2) 50%,var(--card))}
  .or-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .or-card.r-tight,.or-card.r-late{box-shadow:inset 3px 0 0 var(--rc)}
  .or-card.r-late{border-color:color-mix(in srgb,var(--st-fault) 30%,var(--line));background:color-mix(in srgb,var(--st-fault) 4%,var(--card))}
  .or-card.sel{border-color:color-mix(in srgb,var(--accent) 65%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .or-card.sel.r-tight,.or-card.sel.r-late{box-shadow:inset 3px 0 0 var(--rc),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
  .or-card.done{background:color-mix(in srgb,var(--panel) 60%,var(--card))}
  .or-top{min-width:0}
  .or-top > *{min-width:0}
  .or-ident{min-width:0;overflow:hidden}
  .or-l1{display:flex;align-items:center;flex-wrap:wrap;gap:4px 7px;min-width:0}
  .or-id{font:600 var(--fs-md)/1.2 var(--f-mono);color:var(--text);letter-spacing:.01em;white-space:nowrap}
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
  .or-part b{font-weight:600;font-size:var(--fs-md);line-height:1.2;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-part span{font:500 11.5px/1.2 var(--f-mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-prog{display:flex;flex-direction:column;gap:5px;min-width:0}
  .or-prog-t{display:flex;align-items:baseline;justify-content:space-between;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .or-prog-t b{font:600 var(--fs-xl)/1 var(--f-cond);color:var(--text)}
  .or-prog-t b small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:3px}
  .or-prog-t span{font-size:var(--fs-xs);color:var(--muted)}
  .or-pbar{position:relative;display:block;height:5px;border-radius:3px;background:var(--track);overflow:hidden}
  .or-pbar i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:color-mix(in srgb,var(--text2) 72%,transparent);transition:width .5s ease}
  .or-pbar i.w{background:color-mix(in srgb,var(--text2) 20%,transparent)}
  .or-prog-s{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-prog-s b{color:var(--text2);font-weight:600}
  .or-prog-s .q{color:color-mix(in srgb,var(--st-wait) 80%,var(--text))}
  .or-prog-s .r{color:color-mix(in srgb,var(--info) 75%,var(--text))}
  .or-prog-s .nw{white-space:nowrap}
  .or-prog-s .nw + .nw::before{content:'·';margin:0 5px 0 1px;color:var(--faint);font-weight:400}
  .or-hero-d small .nw{display:block}
  .or-dates{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;align-items:baseline;font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
  .or-dates span{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
  .or-dates b{font-weight:600;color:var(--text2);white-space:normal;overflow-wrap:anywhere;min-width:0}
  .or-dates b.eta{color:var(--text)}
  .or-dates small{grid-column:1/-1;display:flex;align-items:center;gap:5px;font-size:var(--fs-xs);font-weight:600;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-dates small .ico{flex:none}
  .or-dates small.dn{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))}
  .or-dates small.up{color:color-mix(in srgb,var(--st-run) 85%,var(--text))}
  .or-risk{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}
  .or-rb{--c:var(--st-run);display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 7px;border-radius:999px;font-size:var(--fs-xs);font-weight:600;line-height:18px;white-space:nowrap;color:color-mix(in srgb,var(--c) 82%,white);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 38%,transparent)}
  .or-rb i{width:7px;height:7px;border-radius:50%;background:var(--c)}
  .or-slack{font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-variant-numeric:tabular-nums}
  .or-card.r-late .or-slack{color:color-mix(in srgb,var(--st-fault) 70%,var(--text))}
  .or-prio{position:relative;width:36px;height:36px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--faint);cursor:pointer;justify-self:end}
  .or-prio:hover{color:var(--text);border-color:var(--line2);background:var(--card2)}
  .or-prio.on{color:color-mix(in srgb,var(--st-fault) 85%,white);border-color:color-mix(in srgb,var(--st-fault) 45%,transparent);background:color-mix(in srgb,var(--st-fault) 14%,transparent)}
  .or-prio[hidden]{display:none}
  .or-part-alt{display:none}

  /* Arbeitsplan-Kette */
  .or-chain{display:flex;align-items:stretch;min-width:0;overflow-x:auto;scrollbar-width:none;padding:10px 2px 2px;margin:-8px -2px 0}
  .or-chain::-webkit-scrollbar{display:none}
  .or-step{--c:var(--line2);position:relative;flex:1 1 auto;min-width:96px;max-width:230px;display:flex;align-items:center;gap:8px;padding:6px 9px 9px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg2)}
  .or-st-ic{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;position:relative}
  .or-st-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
  .or-st-l{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:var(--fs-sm);font-weight:600;line-height:1.15;color:var(--text2);white-space:nowrap}
  .or-st-l em{font:500 var(--fs-2xs)/1 var(--f-mono);font-style:normal;color:var(--faint);flex:none}
  .or-st-l span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-st-s{font-size:var(--fs-xs);line-height:1.2;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
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
  .or-step.s-ext{--c:var(--ext);border-color:color-mix(in srgb,var(--ext) 45%,transparent);background:color-mix(in srgb,var(--ext) 9%,var(--bg2))}
  .or-step.s-ext .or-st-ic{color:var(--ext)}
  .or-step.s-ext .or-st-l{color:var(--text)}
  .or-step.s-ext .or-st-s{color:color-mix(in srgb,var(--ext) 60%,var(--text))}
  .or-step.s-wait .or-st-ic::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--st-idle)}
  .or-step.s-wait .or-st-bt{background:color-mix(in srgb,var(--st-idle) 18%,transparent)}
  .or-step.s-wait .or-st-bar{background:var(--st-idle)}
  .or-step.s-open{border-style:dashed;border-color:var(--line2);background:transparent}
  .or-step.s-open .or-st-ic::before{content:'';width:8px;height:8px;border-radius:50%;border:1.5px solid var(--line2)}
  .or-step.s-open .or-st-l{color:var(--muted)}
  .or-step.s-open .or-st-s{color:var(--faint)}
  .or-step.bn::after{content:'Kritisch';position:absolute;top:-9px;right:8px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:2px 5px 2px;border-radius:4px;color:var(--text2);background:var(--card);border:1px solid var(--line2);white-space:nowrap}
  .or-step.bn.plant::after{content:'Engpass';color:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 45%,transparent)}
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

  .or-foot{display:flex;align-items:center;gap:6px 16px;min-width:0;font-size:var(--fs-sm);color:var(--text2)}
  .or-now{--c:var(--muted);display:flex;align-items:center;gap:7px;min-width:0;flex:1}
  .or-now > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-now > span:first-child{flex:none;overflow:visible;display:inline-flex}
  .or-now .ico{flex:none;color:var(--c)}
  .or-now b{font-weight:600;color:var(--text)}
  .or-now.warn{--c:var(--st-wait)} .or-now.crit{--c:var(--st-fault)} .or-now.ok{--c:var(--st-run)}
  .or-now.warn > span{color:color-mix(in srgb,var(--st-wait) 40%,var(--text2))}
  .or-now.crit > span{color:color-mix(in srgb,var(--st-fault) 45%,var(--text2))}
  .or-sep{color:var(--faint);margin:0 8px}
  .or-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c);margin-right:7px;vertical-align:1px;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .or-msg{--c:var(--info);display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:40%;padding:2px 8px 2px 7px;border-radius:6px;font-size:var(--fs-xs);font-weight:600;color:color-mix(in srgb,var(--c) 80%,var(--text));background:color-mix(in srgb,var(--c) 10%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);white-space:nowrap}
  .or-msg span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-msg .ico{flex:none}
  .or-bn{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;color:var(--muted);white-space:nowrap}
  .or-bn span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-bn .ico{flex:none;color:var(--faint)}
  .or-bn b{font-weight:600;color:var(--text2)}

  .or-donebox{display:flex;flex-direction:column;gap:8px;margin-top:6px}
  .or-done-h{display:flex;align-items:center;gap:10px;width:100%;padding:9px 4px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--text2);font-size:var(--fs-md);font-weight:600;cursor:pointer;text-align:left}
  .or-done-h .ico{transition:transform .2s ease;color:var(--muted)}
  .or-done-h.open .ico{transform:rotate(90deg)}
  .or-done-h small{font-weight:500;color:var(--muted);font-size:var(--fs-xs)}
  .or-done-h:hover{color:var(--text)}
  .or-empty{border:1px dashed var(--line2);border-radius:var(--r);background:transparent}
  .or-empty b{display:block;color:var(--text2);font-size:var(--fs-md);margin-bottom:4px}

  /* Plantafel – ruhig: neutrale Blöcke, Farbe nur für die Aussage (hervorgehobener Auftrag = Akzent,
     Termin gefährdet = Kontur in Zustandsfarbe, laufender Arbeitsgang = Kante in Maschinenzustand) */
  .or-gbar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
  .or-gbar .seg button{min-width:52px}
  .or-glw{display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 0}
  .or-gl-l{flex:none;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 4px 0 6px}
  .or-gleg{--ml:0px;--mr:32px;display:flex;align-items:center;gap:5px;flex-wrap:nowrap;min-width:0;flex:1 1 0;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:3px 2px;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 var(--ml),#000 calc(100% - var(--mr)),transparent);mask-image:linear-gradient(90deg,transparent 0,#000 var(--ml),#000 calc(100% - var(--mr)),transparent)}
  .or-gleg.scl{--ml:22px}
  .or-gleg.end{--mr:0px}
  .or-gleg::-webkit-scrollbar{display:none}
  .or-gleg button{--c:transparent;position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text2);font:500 var(--fs-xs)/1 var(--f-mono);cursor:pointer;white-space:nowrap}
  .or-gleg button i{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
  .or-gleg button.risk-spät{--c:var(--st-fault)} .or-gleg button.risk-knapp{--c:var(--st-wait)}
  .or-gleg button .ico{margin:0 -2px 0 -3px;color:var(--st-fault)}
  .or-gleg button:hover{border-color:var(--line2);color:var(--text)}
  .or-gleg button.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,var(--card));color:var(--text)}
  .or-gwrap{margin-top:10px;overflow:hidden}
  .or-gh{flex-wrap:wrap;min-height:52px;padding-top:8px;padding-bottom:8px}
  .or-gh h3{flex:none}
  .or-gsel{display:flex;align-items:center;justify-content:flex-end;gap:6px 12px;flex-wrap:wrap;min-width:0;flex:1 1 300px;font-size:var(--fs-sm);color:var(--text2)}
  .or-gsel .or-gs-hint{font-size:var(--fs-xs);color:var(--muted);text-align:right}
  .or-gsel .or-gs-t{display:flex;align-items:center;justify-content:flex-end;gap:4px 12px;min-width:0;flex-wrap:wrap}
  .or-gsel .or-gs-t > span{white-space:nowrap}
  .or-gsel .or-gs-id{display:inline-flex;align-items:center;gap:7px}
  .or-gsel .or-gs-id i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .or-gsel b{font-weight:600;color:var(--text)}
  .or-gsel .mono{font-weight:600;color:var(--text)}
  .or-gsel .or-gs-a{display:flex;gap:6px}
  .or-gsel .or-rb{line-height:16px;padding:1px 8px 1px 6px}
  .or-gsel .or-gs-p{font-style:normal;font-weight:600}
  .or-gsel .or-gs-p.dn{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))} .or-gsel .or-gs-p.up{color:color-mix(in srgb,var(--st-run) 85%,var(--text))}
  .or-gs-new{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);background:var(--accent)}
  .or-gcard{--lw:184px;position:relative;display:grid;grid-template-columns:var(--lw) minmax(0,1fr);overflow:hidden}
  .or-glabels{border-right:1px solid var(--line);background:var(--card);position:relative;z-index:2}
  .or-gl-h{display:flex;align-items:flex-end;padding:0 12px 9px 14px;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)}
  .or-gl{--c:var(--st-idle);display:grid;grid-template-columns:8px minmax(0,1fr);grid-template-rows:auto auto;align-content:center;column-gap:11px;row-gap:3px;padding:0 10px 0 14px;border:0;border-bottom:1px solid var(--line);cursor:pointer;min-width:0;background:transparent;width:100%;color:inherit;text-align:left;font:inherit}
  .or-gl:hover{background:var(--card2)}
  .or-gl i{grid-row:1/3;align-self:center;width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .or-gl b{font:600 var(--fs-md)/1.15 var(--f-ui);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-gl small{font:500 var(--fs-2xs)/1.2 var(--f-ui);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-gl small em{font-style:normal;font-family:var(--f-mono);color:var(--faint);margin-right:5px}
  .or-gl.ext{--c:var(--ext);cursor:default}
  .or-gl.ext:hover{background:transparent}
  .or-gl.ext i{border-radius:2px}
  .or-gscroll{overflow-x:auto;overflow-y:hidden;position:relative;cursor:grab;scrollbar-width:thin}
  .or-gscroll.drag{cursor:grabbing;user-select:none}
  .or-gsvg{display:block;font-family:var(--f-ui)}
  .or-gsvg text{pointer-events:none}
  .or-gsvg .blk{cursor:pointer;transition:opacity .15s ease}
  .or-gsvg .bf{fill:var(--card2);stroke:var(--line2);stroke-width:1}
  .or-gsvg .bf.ps{fill:var(--card);fill-opacity:.55;stroke:var(--line)}
  .or-gsvg .bf.pl{fill:transparent;stroke:var(--line2);stroke-dasharray:4 3}
  .or-gsvg .bf.act{stroke:color-mix(in srgb,var(--muted) 70%,var(--line2))}
  .or-gsvg .bf.r-knapp{stroke:var(--st-wait);stroke-width:1.5}
  .or-gsvg .bf.r-spät{stroke:var(--st-fault);stroke-width:1.5}
  .or-gsvg .su{fill:url(#or-hatch)}
  .or-gsvg .ns{fill:url(#or-ns)}
  .or-gsvg .nsl{stroke:var(--line2);stroke-width:1.2;stroke-dasharray:2 3}
  .or-gsvg .blk.on .nsl{stroke:var(--accent);stroke-opacity:.8}
  .or-gsvg .blk.on .ns{fill:url(#or-ns)}
  .or-gsvg .off{fill:var(--bg);fill-opacity:.62}
  .or-gsvg .tail{stroke:var(--muted);stroke-opacity:.7;stroke-width:1.2;stroke-dasharray:2 3;fill:none}
  .or-gsvg .tailx{stroke:var(--muted);stroke-width:1.4}
  .or-gsvg .eil{fill:var(--st-fault)}
  .or-gsvg text.tl{fill:var(--text2);font-size:11.5px;font-weight:500}
  .or-gsvg text.tl.act{fill:var(--text);font-weight:600}
  .or-gsvg text.tl.ps{fill:var(--muted)}
  .or-gsvg.hl .blk{opacity:.32}
  .or-gsvg.hl .blk.on{opacity:1}
  .or-gsvg .blk.on .bf{fill:color-mix(in srgb,var(--accent) 26%,var(--card2));stroke:var(--accent);stroke-width:1.5}
  .or-gsvg .blk.on .bf.ps{fill:color-mix(in srgb,var(--accent) 12%,var(--card));stroke:color-mix(in srgb,var(--accent) 55%,transparent)}
  .or-gsvg .blk.on .bf.pl{fill:color-mix(in srgb,var(--accent) 8%,transparent);stroke:var(--accent)}
  .or-gsvg .blk.on .bf.r-knapp{stroke:var(--st-wait)} .or-gsvg .blk.on .bf.r-spät{stroke:var(--st-fault)}
  .or-gsvg .blk.on text.tl{fill:var(--text);font-weight:600}
  .or-gsvg .blk.on .tail,.or-gsvg .blk.on .tailx{stroke:var(--accent);stroke-opacity:1}
  .or-gsvg .lk{pointer-events:none}
  .or-gsvg .blk.fresh .bf{animation:orFresh 1.3s ease-in-out 5}
  .or-gsvg .blk.shift .bf{animation:orShift 1.3s ease-in-out 4}
  .or-gsvg.hl .blk.shift{opacity:.9}
  @keyframes orFresh{0%,100%{stroke-width:1.5}50%{stroke-width:4;stroke:var(--accent)}}
  @keyframes orShift{0%,100%{}50%{stroke:var(--st-wait);stroke-width:2.5}}
  .or-card.fresh{animation:orCardIn 1.5s ease-in-out 3}
  @keyframes orCardIn{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 55%,transparent)}}
  .or-ltip{position:fixed;z-index:65}
  .or-tip{position:absolute;z-index:6;pointer-events:none;min-width:220px;max-width:300px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;box-shadow:var(--shadow);padding:9px 11px 10px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .or-tip-h{display:flex;align-items:center;gap:7px;margin-bottom:3px}
  .or-tip-h b{font:600 var(--fs-sm)/1.2 var(--f-mono);color:var(--text)}
  .or-tip-h span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-tip-t{font-weight:600;color:var(--text);font-size:var(--fs-sm)}
  .or-tip-r{display:flex;justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}
  .or-tip-r span{color:var(--muted)}
  .or-tip-r b{font-weight:600;color:var(--text);white-space:nowrap}
  .or-tip-n{margin-top:4px;padding-top:5px;border-top:1px solid var(--line);color:var(--muted);font-size:var(--fs-xs)}
  .or-tip .or-rb{line-height:16px;padding:1px 7px 1px 6px}
  .or-gkey{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:var(--fs-xs);color:var(--muted);padding:0 2px}
  .or-gkey span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .or-gkey .k-fc,.or-gkey .k-ist,.or-gkey .k-su,.or-gkey .k-ext,.or-gkey .k-hl,.or-gkey .k-rl,.or-gkey .k-rk,.or-gkey .k-eil{position:relative;width:22px;height:12px;border-radius:3px;border:1px solid var(--line2);background:var(--card2)}
  .or-gkey .k-ist{border-color:var(--line);background:color-mix(in srgb,var(--card) 55%,transparent)}
  .or-gkey .k-su{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--text) 22%,transparent) 0 2px,var(--card2) 2px 5px)}
  .or-gkey .k-ext{border-style:dashed;background:transparent}
  .or-gkey .k-hl{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 26%,var(--card2))}
  .or-gkey .k-rl{border:1.5px solid var(--st-fault)}
  .or-gkey .k-rk{border:1.5px solid var(--st-wait)}
  .or-gkey .k-eil::before{content:'';position:absolute;left:-1px;top:-1px;border-style:solid;border-width:7px 7px 0 0;border-color:var(--st-fault) transparent transparent transparent;border-radius:3px 0 0 0}
  .or-gkey .k-st{display:inline-flex;gap:1px}
  .or-gkey .k-st i{width:7px;height:4px;background:var(--c)}
  .or-gkey .k-now{width:2px;height:13px;background:var(--accent);border-radius:1px}
  .or-gkey .k-lk{width:22px;height:2px;background:repeating-linear-gradient(90deg,var(--mat) 0 4px,transparent 4px 7px)}
  .or-gkey .k-ns{width:22px;height:8px;border-radius:2px;background:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--muted) 45%,transparent) 0 1.3px,transparent 1.3px 4px)}

  /* Bestätigung Priorität */
  .or-pm{display:flex;flex-direction:column;gap:10px}
  .or-pm-lead{margin:0;font-size:var(--fs-md);line-height:1.5;color:var(--text2)}
  .or-pm-lead b{color:var(--text);font-weight:600}
  .or-pm-h{display:flex;justify-content:space-between;gap:10px;margin-top:2px;font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .or-pm-t{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--r);background:var(--card);overflow:hidden}
  .or-pm-r{display:grid;grid-template-columns:auto minmax(0,1fr) auto 64px auto;align-items:center;gap:4px 10px;padding:9px 12px;border-top:1px solid var(--line);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
  .or-pm-r:first-child{border-top:0}
  .or-pm-r.self{background:color-mix(in srgb,var(--accent) 8%,var(--card))}
  .or-pm-id{font:600 var(--fs-sm)/1.2 var(--f-mono);color:var(--text)}
  .or-pm-pt{min-width:0;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-pm-pt small{display:block;font-size:var(--fs-xs);color:var(--muted)}
  .or-pm-eta{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:var(--muted)}
  .or-pm-eta s{text-decoration-color:color-mix(in srgb,var(--muted) 70%,transparent)}
  .or-pm-eta b{color:var(--text);font-weight:600}
  .or-pm-eta .ico{color:var(--faint)}
  .or-pm-d{text-align:right;font-weight:600;color:var(--muted);white-space:nowrap}
  .or-pm-d.up{color:var(--st-run)} .or-pm-d.dn{color:var(--st-wait)}
  .or-pm-r .or-rb{line-height:16px;padding:1px 8px 1px 6px;justify-self:end}
  .or-pm-n{margin:0;font-size:var(--fs-xs);line-height:1.45;color:var(--muted)}
  .or-pm-n b{color:var(--text2);font-weight:600}
  .or-pm-w{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);background:color-mix(in srgb,var(--st-wait) 9%,var(--bg2));border:1px solid color-mix(in srgb,var(--st-wait) 32%,transparent)}
  .or-pm-w .ico{flex:none;margin-top:1px;color:var(--st-wait)}
  .or-pm-w b{color:var(--text);font-weight:600}
  @media (max-width:560px){
    .or-pm-r{grid-template-columns:auto minmax(0,1fr) auto;padding:9px 10px}
    .or-pm-eta{grid-column:1/3;grid-row:2}
    .or-pm-d{grid-column:3;grid-row:2}
    .or-pm-r .or-rb{grid-column:3;grid-row:1}
  }

  /* Detail */
  .or-d-sub{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .or-hero{--rc:var(--st-run);display:flex;flex-direction:column;gap:11px;padding:13px 14px 13px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--rc) 30%,var(--line));background:linear-gradient(180deg,color-mix(in srgb,var(--rc) 9%,var(--card)),var(--card))}
  .or-hero-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .or-hero-top .or-rb{font-size:var(--fs-md);line-height:22px;padding:2px 11px 2px 9px}
  .or-hero-top .or-rb i{width:8px;height:8px}
  .or-hero-slack{font-size:var(--fs-md);font-weight:600;color:var(--text2);font-variant-numeric:tabular-nums}
  .or-hero-d{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .or-hero-d > div{display:flex;flex-direction:column;gap:3px;min-width:0}
  .or-hero-d b{font:600 var(--fs-xl)/1.1 var(--f-cond);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-hero-d small{font-size:var(--fs-xs);color:var(--muted);line-height:1.3}
  .or-hero .or-pbar{height:6px}
  .or-hero-d small b{font:inherit;font-weight:600;color:var(--text2)}
  .or-hero-d small .q{color:color-mix(in srgb,var(--st-wait) 80%,var(--text))}
  .or-hero-d small .r{color:color-mix(in srgb,var(--info) 75%,var(--text))}
  .or-hero-d small .pd{display:inline-flex;align-items:center;gap:4px;font-weight:600}
  .or-hero-d small .pd.dn{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))}
  .or-hero-d small .pd.up{color:color-mix(in srgb,var(--st-run) 85%,var(--text))}
  .or-hero-n{display:flex;align-items:flex-start;gap:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .or-hero-n .ico{flex:none;margin-top:1px;color:var(--muted)}
  .or-hero-n b{color:var(--text);font-weight:600}
  .or-hero-a .or-dot{margin:0 9px 0 4px}
  .or-hero-n.warn .ico{color:var(--st-wait)} .or-hero-n.crit .ico{color:var(--st-fault)} .or-hero-n.ok .ico{color:var(--st-run)}
  .or-nts{display:flex;flex-direction:column;gap:6px}
  .or-nt{--c:var(--info);display:flex;flex-direction:column;gap:3px;padding:9px 11px 10px;border-radius:9px;background:var(--card);border:1px solid var(--line);box-shadow:inset 3px 0 0 var(--c);font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .or-nt.ack{opacity:.7}
  .or-nt-h{display:flex;justify-content:space-between;gap:8px;font-size:var(--fs-xs);color:var(--muted)}
  .or-nt-sev{color:color-mix(in srgb,var(--c) 80%,var(--text));font-weight:600}
  .or-nt > b{font-weight:600;color:var(--text);font-size:var(--fs-md)}
  .or-nt p{margin:0}
  .or-nt-s{margin-top:3px;padding:6px 8px;border-radius:7px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 20%,transparent)}
  .or-nt-s b{color:var(--text);font-weight:600}
  .or-nt-a{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
  .or-nt-a:empty{display:none}
  .or-acts{display:flex;flex-wrap:wrap;gap:6px}
  .or-acts .btn{height:32px;font-size:var(--fs-sm)}
  .or-acts .btn.on{color:color-mix(in srgb,var(--st-fault) 85%,white);border-color:color-mix(in srgb,var(--st-fault) 45%,transparent);background:color-mix(in srgb,var(--st-fault) 10%,transparent)}
  .or-sec h4{display:flex;align-items:center;gap:8px}
  .or-sec h4 .spacer{flex:1}
  .or-sec h4 small{font:500 var(--fs-xs)/1 var(--f-ui);letter-spacing:0;text-transform:none;color:var(--faint)}
  .or-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 14px;padding:12px 13px;background:var(--card);border:1px solid var(--line);border-radius:var(--r)}
  .or-facts > div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .or-facts span{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  .or-facts b{font-weight:500;font-size:var(--fs-md);color:var(--text2);overflow-wrap:anywhere}
  .or-facts .wide{grid-column:1/-1}
  .or-ops{display:flex;flex-direction:column}
  .or-op{--c:var(--line2);display:grid;grid-template-columns:22px minmax(0,1fr);gap:0 10px}
  .or-op-rail{position:relative;display:flex;justify-content:center}
  .or-op-rail::before{content:'';position:absolute;top:22px;bottom:-4px;width:2px;background:var(--line);border-radius:1px}
  .or-op:last-child .or-op-rail::before{display:none}
  .or-op.s-done .or-op-rail::before{background:color-mix(in srgb,var(--st-run) 40%,var(--line))}
  .or-op-node{position:relative;z-index:1;margin-top:3px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--panel);border:2px solid var(--c);color:var(--c)}
  .or-op.s-done .or-op-node{background:color-mix(in srgb,var(--st-run) 22%,var(--panel));border-color:color-mix(in srgb,var(--st-run) 70%,transparent)}
  .or-op.s-active .or-op-node::before,.or-op.s-wait .or-op-node::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--c)}
  .or-op.s-open .or-op-node{border-style:dashed}
  .or-op-b{display:flex;flex-direction:column;gap:6px;min-width:0;padding-bottom:16px}
  .or-op-h{display:flex;align-items:center;gap:8px;min-width:0}
  .or-op-h em{font:600 var(--fs-xs)/1 var(--f-mono);font-style:normal;color:var(--muted);flex:none}
  .or-op-h b{font-weight:600;font-size:var(--fs-md);color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .or-op-h .pill{flex:none}
  .or-op-m{font-size:var(--fs-sm);color:var(--muted);line-height:1.45}
  .or-op-m .link{font-weight:600}
  .or-op-c{font-size:var(--fs-sm);line-height:1.45;color:var(--text2);padding:6px 9px;border-radius:7px;background:color-mix(in srgb,var(--c) 8%,var(--bg2));border:1px solid color-mix(in srgb,var(--c) 22%,transparent)}
  .or-op-q{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;border-radius:7px;overflow:hidden;background:var(--line);border:1px solid var(--line)}
  .or-op-q > div{display:flex;flex-direction:column;gap:2px;padding:5px 8px 6px;background:var(--card);min-width:0}
  .or-op-q span{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-op-q b{font:600 var(--fs-lg)/1.1 var(--f-cond);color:var(--text);font-variant-numeric:tabular-nums}
  .or-op-q b small{font:500 var(--fs-xs)/1 var(--f-ui);color:var(--muted);margin-left:2px}
  .or-op-q .z b{color:var(--faint)}
  .or-op-q .bad b{color:var(--st-fault)}
  .or-op-t{display:flex;flex-wrap:wrap;gap:3px 14px;font-size:var(--fs-sm);color:var(--muted);font-variant-numeric:tabular-nums}
  .or-op-t b{color:var(--text2);font-weight:600}
  .or-op .bar{height:4px}
  .or-mat{display:flex;flex-direction:column;gap:6px}
  .or-mt{--c:var(--st-idle);display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 10px;border-radius:9px;background:var(--card);border:1px solid var(--line);cursor:pointer}
  .or-mt:hover{border-color:var(--line2)}
  .or-mt-ic{grid-column:1;grid-row:1/3;width:28px;height:28px;border-radius:7px;display:grid;place-items:center;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
  .or-mt-a{grid-column:2;grid-row:1;display:flex;align-items:baseline;gap:7px;min-width:0;font-size:var(--fs-sm)}
  .or-mt-a b{font:600 var(--fs-sm)/1.2 var(--f-mono);color:var(--text);white-space:nowrap;flex:none}
  .or-mt-a span{color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .or-mt-w{grid-column:2;grid-row:2;font-size:var(--fs-sm);color:var(--muted);min-width:0;overflow-wrap:anywhere;line-height:1.35}
  .or-mt-st{grid-column:3;grid-row:1/3;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .or-mt-st .link{font-size:var(--fs-xs)}
  .or-mt.c-transit{--c:var(--mat)} .or-mt.c-ready{--c:var(--mat)} .or-mt.c-filling{--c:var(--info)} .or-mt.c-external{--c:var(--ext)} .or-mt.c-input{--c:var(--st-idle)} .or-mt.c-proc{--c:var(--st-run)}
  .or-msum{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:var(--fs-sm);color:var(--muted);padding:2px 2px 0}
  .or-msum b{color:var(--text2);font-weight:600}
  .or-ev{display:grid;grid-template-columns:auto 18px minmax(0,1fr);gap:2px 9px;align-items:start;padding:7px 2px;border-bottom:1px solid var(--line);font-size:var(--fs-sm);line-height:1.42}
  .or-ev:last-child{border-bottom:0}
  .or-ev time{font:500 var(--fs-xs)/1.42 var(--f-mono);color:var(--muted);white-space:nowrap}
  .or-ev .ico{color:var(--c,var(--muted));margin-top:1px}
  .or-ev span{color:var(--text2);overflow-wrap:anywhere}
  .or-more{margin-top:6px}
  .or-mv{display:flex;flex-direction:column;gap:14px}
  .or-mv-op{display:flex;flex-direction:column;gap:8px}
  .or-mv-h{display:flex;align-items:baseline;gap:8px;font-size:var(--fs-md)}
  .or-mv-h em{font:600 var(--fs-xs)/1 var(--f-mono);font-style:normal;color:var(--muted)}
  .or-mv-h b{font-weight:600}
  .or-mv-h span{color:var(--muted);font-size:var(--fs-sm)}
  .or-mv-c{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px}
  .or-mv-c button{--c:var(--st-idle);display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:9px 11px;border-radius:9px;border:1px solid var(--line2);background:var(--card);color:var(--text);cursor:pointer;text-align:left}
  .or-mv-c button:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--card))}
  .or-mv-c button b{font-weight:600;font-size:var(--fs-md)}
  .or-mv-c button b em{font:500 var(--fs-xs)/1 var(--f-mono);font-style:normal;color:var(--muted);margin-left:5px}
  .or-mv-c button small{font-size:var(--fs-xs);color:var(--muted);line-height:1.35}
  .or-mv-c button .pill{font-size:var(--fs-2xs);line-height:15px}
  .or-mv-c button.no{border-color:color-mix(in srgb,var(--st-fault) 40%,var(--line2));background:color-mix(in srgb,var(--st-fault) 5%,var(--card));cursor:not-allowed}
  .or-mv-c button.no:hover{border-color:color-mix(in srgb,var(--st-fault) 40%,var(--line2))}
  .or-mv-no{font-size:var(--fs-xs);font-weight:600;color:color-mix(in srgb,var(--st-fault) 80%,var(--text))}
  .or-mv-why{color:var(--muted)}
  .or-mv-p{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-top:2px;padding-top:6px;border-top:1px solid var(--line);width:100%;font-size:var(--fs-sm);color:var(--text2);font-variant-numeric:tabular-nums}
  .or-mv-p b{font-weight:600;color:var(--text)}
  .or-mv-p em{font-style:normal;font-weight:600;color:var(--muted);margin-left:auto}
  .or-mv-p.up em{color:var(--st-run)} .or-mv-p.dn em{color:var(--st-wait)}
  .or-mv-side{font-size:var(--fs-xs);color:color-mix(in srgb,var(--st-wait) 80%,var(--text))}
  .or-mv-msg{font-size:var(--fs-sm);line-height:1.45;padding:8px 10px;border-radius:8px;color:var(--text2);background:color-mix(in srgb,var(--st-wait) 9%,var(--bg2));border:1px solid color-mix(in srgb,var(--st-wait) 32%,transparent)}
  .or-mv-none{font-size:var(--fs-sm);color:var(--muted);line-height:1.45}

  /* Arbeitsplan im Drawer: senkrechte Schrittfolge – erledigte und offene Schritte einzeilig, laufende ausführlich */
  .or-op.cmp .or-op-b{gap:2px;padding-bottom:12px}
  .or-op-h .or-op-r{flex:none;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .or-op.s-done .or-op-h b{color:var(--text2);font-weight:500}
  .or-op.s-open .or-op-h b{color:var(--text2)}
  .or-op.cur .or-op-node{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 22%,transparent)}
  .or-op-k{display:inline-flex;align-items:center;gap:4px;margin-left:2px;font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;padding:3px 5px;border-radius:4px;color:var(--text2);border:1px solid var(--line2);white-space:nowrap;flex:none}
  .or-op-k.plant{color:var(--st-wait);border-color:color-mix(in srgb,var(--st-wait) 45%,transparent)}
  .or-op-in{display:flex;align-items:center;gap:7px;margin:-4px 0 8px;padding-left:2px;font-size:var(--fs-xs);color:color-mix(in srgb,var(--mat) 80%,var(--text))}
  .or-op-in .ico{flex:none;color:var(--mat)}
  .or-op-in.rdy{color:var(--muted)}

  /* Warum spät / knapp – Beiträge zur Verzögerung als kleine Balken (Engine: delayBreakdown, orderAdvice) */
  .or-why{--rc:var(--st-wait);display:flex;flex-direction:column;gap:11px;padding:12px 13px 13px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:inset 3px 0 0 var(--rc)}
  .or-why-c{display:flex;flex-direction:column;gap:3px}
  .or-why-l{font:600 var(--fs-2xs)/1.2 var(--f-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  .or-why-c b{font-weight:600;font-size:var(--fs-md);color:var(--text);line-height:1.4}
  .or-why-bars{display:flex;flex-direction:column;gap:8px}
  .or-wb{display:grid;grid-template-columns:minmax(0,1fr) 84px 64px;align-items:center;gap:3px 10px;font-size:var(--fs-sm)}
  .or-wb-l{display:flex;align-items:center;gap:7px;min-width:0;color:var(--text2)}
  .or-wb-l .ico{flex:none;color:var(--muted)}
  .or-wb-l span{min-width:0;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .or-wb-b{height:6px;border-radius:3px;background:var(--track);overflow:hidden}
  .or-wb-b i{display:block;height:100%;border-radius:inherit;background:color-mix(in srgb,var(--text2) 42%,transparent)}
  .or-wb.hi .or-wb-b i{background:var(--rc)}
  .or-wb.hi .or-wb-l{color:var(--text)}
  .or-wb.ns .or-wb-l{color:var(--muted)}
  .or-wb.ns .or-wb-b i{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--text2) 35%,transparent) 0 3px,transparent 3px 6px)}
  .or-wb-v{font-weight:600;color:var(--text);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .or-wb-o{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;padding-left:22px;font-size:var(--fs-xs);color:var(--muted)}
  .or-wb-o .link{font-family:var(--f-mono);font-size:var(--fs-xs)}
  .or-why-rec{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--accent) 7%,var(--bg2));border:1px solid color-mix(in srgb,var(--accent) 20%,transparent);font-size:var(--fs-sm);line-height:1.45;color:var(--text2)}
  .or-why-rec .ico{flex:none;margin-top:2px;color:var(--accent)}
  .or-why-rec b{color:var(--text);font-weight:600}
  .or-why-opts{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
  .or-why-opts li{display:grid;grid-template-columns:16px minmax(0,1fr);gap:8px;font-size:var(--fs-sm);line-height:1.4;color:var(--text2)}
  .or-why-opts li .ico{margin-top:2px;color:var(--st-run)}
  .or-why-opts li.no{color:var(--muted)}
  .or-why-opts li.no .ico{color:var(--faint)}
  .or-why-opts li b{font-weight:600;color:var(--text)}
  .or-why-opts li.no b{color:var(--text2)}
  .or-why-a{display:flex;gap:6px;flex-wrap:wrap}
  .or-why-a:empty{display:none}
  .or-whys{display:flex;flex-direction:column;gap:10px}
  /* Hebel: ausführbare Maßnahmen mit Wirkung auf den Liefertermin und Kosten (Engine: orderAdvice().alternatives) */
  .or-lvs{display:flex;flex-direction:column;gap:6px}
  .or-lv{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:9px 10px 9px 9px;border-radius:9px;background:var(--bg2);border:1px solid var(--line)}
  .or-lv.prim{border-color:color-mix(in srgb,var(--accent) 38%,var(--line));background:color-mix(in srgb,var(--accent) 6%,var(--bg2))}
  .or-lv-ic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--text2);background:var(--card2);border:1px solid var(--line2);align-self:start}
  .or-lv.prim .or-lv-ic{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}
  .or-lv-b{display:flex;flex-direction:column;gap:3px;min-width:0}
  .or-lv-h{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
  .or-lv-h b{font-weight:600;font-size:var(--fs-md);color:var(--text)}
  .or-lv-tag{font:600 var(--fs-2xs)/1 var(--f-ui);letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;border-radius:4px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
  .or-lv-t{font-size:var(--fs-sm);line-height:1.4;color:var(--text2)}
  .or-lv-m{display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;font-size:var(--fs-xs);color:var(--muted);font-variant-numeric:tabular-nums}
  .or-lv-m > span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
  .or-lv-m b{color:var(--text);font-weight:600}
  .or-lv-g{font-weight:700}
  .or-lv-g.up{color:var(--st-run)} .or-lv-g.dn{color:var(--st-wait)}
  .or-lv-ok{color:color-mix(in srgb,var(--st-run) 85%,var(--text))}
  .or-lv-no{color:color-mix(in srgb,var(--st-wait) 85%,var(--text))}
  .or-lv-c{color:var(--text2)}
  .or-lv-c .ico,.or-lv-ok .ico{flex:none}
  .or-lv-n{font-size:var(--fs-xs);line-height:1.4;color:var(--muted)}
  .or-lv > .btn{align-self:center}
  @media (max-width:440px){.or-lv{grid-template-columns:30px minmax(0,1fr)}.or-lv > .btn{grid-column:2;justify-self:start;margin-top:3px}}
  .or-lv-cost{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;font-size:var(--fs-sm);line-height:1.45;color:var(--text2);background:var(--bg2);border:1px solid var(--line)}
  .or-lv-cost .ico{flex:none;margin-top:1px;color:var(--muted)}
  .or-lv-cost b{color:var(--text);font-weight:600}
  .or-lv-draft{min-height:150px;font-family:var(--f-mono);font-size:var(--fs-sm);line-height:1.5;resize:vertical}
  /* Hebel als Schnellaktion auf der Karte */
  .or-lvq{position:relative;flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px 0 7px;border-radius:7px;border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 10%,var(--card));color:var(--text);font:600 var(--fs-xs)/1 var(--f-ui);cursor:pointer;white-space:nowrap}
  .or-lvq:hover{background:color-mix(in srgb,var(--accent) 18%,var(--card));border-color:var(--accent)}
  .or-lvq .ico{flex:none;color:var(--accent)}
  .or-lvq span{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-lvq b{font-weight:700;color:var(--st-run);font-variant-numeric:tabular-nums}
  .or-lvq[hidden]{display:none}

  /* Gemeinsame Arbeitsplan-Darstellung WF.ui.route(ops, {mode}) – „row“ = Kette wie in der Auftragsliste
     (bricht nie um, verschiebbar), „stack“ = senkrechte Schrittfolge für schmale Drawer */
  .or-route.or-chain{padding-right:20px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}
  .or-route .or-step{flex:1 1 0;min-width:104px;max-width:none}
  .or-route .or-step.cur{box-shadow:0 0 0 1px var(--c)}
  .or-route.many .or-step.s-done{flex:0 0 auto;min-width:0;padding:6px 7px 9px}
  .or-route.many .or-step.s-done .or-st-tx{display:none}
  .or-rs{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
  .or-rs li{--c:var(--line2);position:relative;display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:1px 10px;align-items:center;padding:0 0 12px}
  .or-rs li + li::before{content:'';position:absolute;left:8px;bottom:calc(100% - 3px);height:15px;width:2px;border-radius:1px;background:var(--line)}
  .or-rs li.s-done + li::before{background:color-mix(in srgb,var(--st-run) 40%,var(--line))}
  .or-rs li:last-child{padding-bottom:0}
  .or-rs .n{grid-row:1/3;align-self:start;position:relative;z-index:1;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--panel);border:2px solid var(--c);color:var(--c)}
  .or-rs li.s-done .n{background:color-mix(in srgb,var(--st-run) 22%,var(--panel));border-color:color-mix(in srgb,var(--st-run) 70%,transparent)}
  .or-rs li.s-active .n::before,.or-rs li.s-wait .n::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--c)}
  .or-rs li.s-open .n{border-style:dashed}
  .or-rs li.cur .n{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 22%,transparent)}
  .or-rs .t{display:flex;align-items:baseline;gap:7px;min-width:0}
  .or-rs .t em{font:500 var(--fs-2xs)/1 var(--f-mono);font-style:normal;color:var(--faint);flex:none}
  .or-rs .t b{font:600 var(--fs-sm)/1.25 var(--f-ui);color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .or-rs li.s-done .t b,.or-rs li.s-open .t b{color:var(--text2);font-weight:500}
  .or-rs .s{grid-column:2/4;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .or-rs li.s-ext .s{color:color-mix(in srgb,var(--ext) 60%,var(--text))}

  /* Kette passt sich der Kartenbreite an: erledigte Schritte werden zuerst verdichtet */
  @container orcard (max-width:1100px){
    .or-chain:not(.or-route) .or-step.s-done{flex:0 0 auto;min-width:0}
    .or-chain:not(.or-route) .or-step.s-done .or-st-s,.or-chain:not(.or-route) .or-st-l em{display:none}
  }
  @container orcard (max-width:900px){
    .or-chain:not(.or-route) .or-step.s-done{padding:6px 7px 9px}
    .or-chain:not(.or-route) .or-step.s-done .or-st-tx{display:none}
    .or-chain:not(.or-route) .or-step:not(.s-done){min-width:118px}
    .or-chain:not(.or-route){-webkit-mask-image:linear-gradient(90deg,var(--bg) calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,var(--bg) calc(100% - 24px),transparent);padding-right:20px}
    .or-chain.many .or-lk{flex-basis:11px}
  }
  /* Kartenlayout nach der verfügbaren Breite der Liste (nicht des Fensters): Seitenleiste, Tablet, Drawer */
  .or-pane{container:orpane / inline-size;min-width:0}
  @container orpane (max-width:1150px){
    .or-thead,.or-top{grid-template-columns:minmax(0,1.3fr) 160px 192px 128px 40px;gap:14px}
    .or-thead .h-part,.or-top .or-part{display:none}
    .or-part-alt{display:block;margin-top:4px;font-size:12.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .or-part-alt span{font:500 var(--fs-xs)/1 var(--f-mono);color:var(--muted);margin-left:6px}
  }
  @container orpane (max-width:960px){
    .or-cust span{display:none}
    .or-part-alt span{display:none}
  }
  @container orpane (max-width:860px){
    .or-thead{display:none}
    .or-card{padding:12px 12px 11px 14px;gap:10px}
    .or-top{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) 40px;grid-template-areas:"id risk act" "prog date date";gap:10px 12px;align-items:start}
    .or-ident{grid-area:id}
    .or-risk{grid-area:risk;align-items:flex-end;text-align:right}
    .or-prio{grid-area:act}
    .or-prog{grid-area:prog;align-self:end}
    .or-dates{grid-area:date;align-self:end}
    .or-chain:not(.or-route) .or-step:not(.s-done){min-width:124px}
    .or-foot{flex-wrap:wrap}
    .or-bn{flex-basis:100%}
  }
  @container orpane (max-width:560px){
    /* Telefon: Kunde und Teil über die ganze Kartenbreite, Termin und Prognose kompakt daneben */
    .or-top{grid-template-columns:minmax(0,1fr) auto 40px;grid-template-areas:"l1 risk act" "cust cust cust" "part part part" "prog date date";row-gap:4px}
    .or-ident{display:contents}
    .or-l1{grid-area:l1;align-self:center}
    .or-cust{grid-area:cust;margin-top:2px}
    .or-cust span{display:inline}
    .or-part-alt{grid-area:part;margin-top:0}
    .or-prog,.or-dates{margin-top:8px}
    .or-risk{gap:3px}
  }
  @container orpane (max-width:520px){
    .or-prog-s{white-space:normal;line-height:1.35}
    .or-prog-s .nw.q{white-space:normal}
    .or-prog-s .nw{display:block}
    .or-prog-s .nw + .nw::before{content:none}
  }
  @media (max-width:1180px){
    .or-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media (max-width:760px){
    .or-kpis{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -18px;padding:0 18px 2px;scroll-padding:0 18px}
    .or-kpis::-webkit-scrollbar{display:none}
    .or-kpis > .kpi{flex:0 0 46%;scroll-snap-align:start}
    .or-gsel:not(.on){display:none}
    .or-gh{min-height:0}
    .or-op-q span{letter-spacing:.04em}
    .or-search{flex:1 1 100%;margin-left:0}
    .or-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -2px;padding:0 2px}
    .or-chips::-webkit-scrollbar{display:none}
    .or-gcard{--lw:112px}
    .or-gl{padding:0 6px 0 10px;column-gap:8px}
    .or-gl b{font-size:var(--fs-sm)}
    .or-glw{flex-basis:100%}
    .or-gkey{gap:6px 12px}
    .or-hero-d{grid-template-columns:repeat(2,minmax(0,1fr))}
    .or-hero-d > div:last-child{grid-column:1/-1}
  }
  @media (max-width:440px){
    .or-op-q > div{padding:5px 6px 6px}
    .or-mt{grid-template-columns:28px minmax(0,1fr)}
    .or-mt-st{grid-column:2;grid-row:3;flex-direction:row;align-items:center;justify-content:flex-start;gap:8px;margin-top:3px}
    .or-wb{grid-template-columns:minmax(0,1fr) 56px 58px}
  }
  /* Touch: Bedienflächen ≥ 40 px (UI_GUIDE Regel 17) – kleine Knöpfe behalten ihr Bild, die Trefferfläche wächst unsichtbar */
  @media (pointer:coarse){
    .or-fchip{height:40px;padding:0 14px}
    .or-search input{height:40px}
    .or-search button{width:36px;height:36px}
    .or-prio{width:40px;height:40px}
    .or-bnw::after,.or-gleg button::after,.or-lvq::after{content:'';position:absolute;inset:-9px -3px}
    .or-gleg{padding-top:9px;padding-bottom:9px;margin:-6px 0}
    .or-done-h{min-height:44px}
    .or-acts .btn{height:auto}
    .or-gl{min-height:40px}
    .or-mode button,.or-gbar .seg button{min-height:40px}
    .or-op-m .link,.or-wb-o .link,.or-mt-st .link{position:relative}
    .or-op-m .link::after,.or-wb-o .link::after,.or-mt-st .link::after{content:'';position:absolute;inset:-6px -2px}
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
  const cmpOpen = (a, b) => (RISK_RANK[riskOf(a)] - RISK_RANK[riskOf(b)]) || (a.due - b.due) || (a.id < b.id ? -1 : 1);
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
        <div class="kpi" title="Freigegebene und laufende Fertigungsaufträge, noch nicht vollständig versandt. Balken: Terminlage laut Prognose (Im Plan · Knapp · Verspätet)">
          <div class="l">Offene Aufträge</div><div class="v" data-r="kOpen">–</div><div class="s" data-r="kOpenS">–</div>
          <div class="viz" aria-hidden="true"><div class="or-rbar"><i data-r="bOk" style="--c:var(--st-run)"></i><i data-r="bKn" style="--c:var(--st-wait)"></i><i data-r="bLt" style="--c:var(--st-fault)"></i></div></div>
        </div>
        <div class="kpi click" data-r="kLate" data-rf="risk" role="button" tabindex="0" title="Offene Aufträge, deren Prognose nach dem Liefertermin liegt – Klick zeigt die gefährdeten Aufträge">
          <div class="l">Verspätet</div><div class="v" data-r="kLateV">–</div><div class="s" data-r="kLateS">–</div>
        </div>
        <div class="kpi click" data-r="kTight" data-rf="risk" role="button" tabindex="0" title="Offene Aufträge mit weniger als 4 h Puffer bis zum Liefertermin oder mit gefährdeter Menge (Ausschuss ohne Nachfertigung) – Klick zeigt die gefährdeten Aufträge">
          <div class="l">Knapp</div><div class="v" data-r="kTightV">–</div><div class="s" data-r="kTightS">–</div>
        </div>
        <div class="kpi" title="Heute an den Versand übergebene Teile (alle Aufträge)">
          <div class="l">Heute versandt</div><div class="v" data-r="kShip">–</div><div class="s" data-r="kShipS">–</div>
        </div>
        <div class="kpi" title="Anteil der Aufträge, die termingerecht und vollständig geliefert werden – fertige Aufträge tatsächlich, offene laut Prognose">
          <div class="l">Termintreue</div><div class="v" data-r="kOt">–</div><div class="s" data-r="kOtS">–</div>
        </div>
        <div class="kpi click" data-r="kExt" role="button" tabindex="0" title="Teile, die gerade beim Härtepartner sind – Klick zeigt die Plantafel mit der Fremdbearbeitung">
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
          <span><span class="or-lgs" style="--c:var(--ext)"></span>Fremdbearbeitung (Härterei)</span>
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
    R.sub.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) WF.app.select('machine', b.dataset.m); });
    R.chips.querySelectorAll('[data-f]').forEach(b => b.onclick = () => setFilter(b.dataset.f));
    const riskGo = () => { setMode('list'); setFilter('risk'); };
    const extGo = () => { G.focusExt = true; if (mode === 'gantt') ganttRender(true); else setMode('gantt'); };
    for (const [n, fn] of [[R.kLate, riskGo], [R.kTight, riskGo], [R.kExt, extGo]]) {
      n.onclick = fn;
      n.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
    }
    R.q.addEventListener('input', () => { query = R.q.value.trim().toLowerCase(); R.qClear.hidden = !query; update(); });
    R.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { R.q.value = ''; query = ''; R.qClear.hidden = true; update(); } });
    R.qClear.onclick = () => { R.q.value = ''; query = ''; R.qClear.hidden = true; R.q.focus(); update(); };
    R.doneH.onclick = () => { doneOpen = !doneOpen; store.set({ doneOpen }); update(); };
    const onListClick = (e) => {
      const card = e.target.closest('.or-card'); if (!card) return;
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'prio') { e.stopPropagation(); togglePriority(card.dataset.id); return; }
      if (act && act.dataset.act === 'lever') {
        e.stopPropagation();
        const c = cards[card.dataset.id], L = c && c.lever; if (!L) return;
        if (L.qtyRemake) { WF.app.runAction(L.action); update(); } else openLeverModal(card.dataset.id, L);
        return;
      }
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

  /** Was-wäre-wenn der Engine (falls vorhanden) auf eine einheitliche Liste bringen: [{id, before, after}] */
  function whatIfPrio(id, to) {
    if (!WF.sim || typeof WF.sim.whatIfPriority !== 'function') return null;
    let r;
    try { r = WF.sim.whatIfPriority(id, to); } catch (e) { console.warn('[whatIfPriority]', e); return null; }
    if (!r || r.ok === false) return null;
    // Engine: { target: Zeile des Auftrags, affected: andere Aufträge mit ≥ 5 min Verschiebung, newlyLate, laterLate, text }
    const list = (r.target || Array.isArray(r.affected)) ? [r.target].concat(r.affected || []).filter(Boolean)
      : Array.isArray(r) ? r : Array.isArray(r.orders) ? r.orders : Array.isArray(r.changes) ? r.changes
      : (r.orders && typeof r.orders === 'object') ? Object.keys(r.orders).map(k => Object.assign({ id: k }, r.orders[k])) : null;
    if (!list) return null;
    const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
    const rows = list.map(x => ({
      id: x.id || x.orderId,
      before: num(x.before != null && typeof x.before === 'object' ? x.before.eta : x.before) ?? num(x.etaBefore),
      after: num(x.after != null && typeof x.after === 'object' ? x.after.eta : x.after) ?? num(x.etaAfter),
      risk: x.riskAfter || null,
    })).filter(x => x.id && x.before != null && x.after != null);
    return { rows, raw: r, newlyLate: r.newlyLate || [], laterLate: r.laterLate || [], text: r.text || '' };
  }
  function riskOfEta(o, eta) {
    if (eta == null) return 'unbekannt';
    const slack = o.due - eta;
    return slack < 0 ? 'spät' : slack < 4 * HOUR ? 'knapp' : 'ok';
  }
  const fmtDelta = (d) => (Math.abs(d) < 60 ? '±0' : (d < 0 ? '−' : '+') + durLong(Math.abs(d)));
  /** Zeile „Liefertermin-Prognose vorher → nachher“ (Bestätigungsdialoge Eilauftrag und Hebel); after == null: nur heutiger Stand */
  function pmRow(oid, before, after, self, riskK) {
    const s = S(), now = s.t, oo = s.orders[oid]; if (!oo) return '';
    const cmp = after != null;
    const rk = riskK || riskOfEta(oo, cmp ? after : before), d = cmp ? after - before : 0;
    const cls = !cmp || Math.abs(d) < 60 ? '' : d < 0 ? ' up' : ' dn';
    const eta = cmp && Math.abs(d) >= 60 ? `<s>${esc(tShort(before, now))}</s>${icon('arrowRight', 12)}<b>${esc(tShort(after, now))}</b>` : `<b>${esc(tShort(cmp ? after : before, now))}</b>`;
    return `<div class="or-pm-r${self ? ' self' : ''}"><span class="or-pm-id">${esc(oid)}</span><span class="or-pm-pt">${esc(oo.part.name)}<small>Termin ${esc(tShort(oo.due, now))}</small></span>` +
      `<span class="or-pm-eta">${eta}</span><span class="or-pm-d${cls}">${cmp ? esc(fmtDelta(d)) : ''}</span>` +
      `<span class="or-rb" style="--c:${RISK_C[rk]}"><i></i>${esc(riskLabel(rk))}</span></div>`;
  }
  /** Priorität ändern – vorher bestätigen, mit Liefertermin-Prognose vorher/nachher der betroffenen Aufträge */
  function togglePriority(id) {
    const s = S(), o = s && s.orders[id]; if (!o) return;
    if (o.status === 'fertig') { WF.app.toast('Auftrag ist bereits fertig – Priorität nicht mehr änderbar', 'warn'); return; }
    const to = o.priority === 'eil' ? 'normal' : 'eil';
    const v = WF.sim.orderView(id), now = s.t;
    const wi = whatIfPrio(id, to);
    const body = document.createElement('div'); body.className = 'or-pm';
    const lead = to === 'eil'
      ? `<b>${esc(id)}</b> · ${esc(v.part.name)} wird an jeder Maschine beim nächsten Auftragswechsel vorgezogen. Laufende Teile werden nicht unterbrochen; andere Aufträge rücken dafür nach hinten.`
      : `<b>${esc(id)}</b> · ${esc(v.part.name)} wird wieder nach Liefertermin eingereiht. Aufträge, die bisher warten mussten, können dadurch früher fertig werden.`;
    let tbl = '';
    const row = (oid, before, after, self, riskK) => pmRow(oid, before, after, self, riskK);
    if (wi) {
      const rows = wi.rows.filter(x => x.id === id || Math.abs(x.after - x.before) >= 5 * 60);
      rows.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : Math.abs(b.after - b.before) - Math.abs(a.after - a.before)));
      const others = rows.filter(x => x.id !== id);
      const late = wi.newlyLate.concat(wi.laterLate.filter(x => !wi.newlyLate.includes(x)));
      const self0 = wi.rows.find(x => x.id === id);
      tbl = `<div class="or-pm-h"><span>Liefertermin-Prognose</span><span>vorher → nachher</span></div><div class="or-pm-t">${rows.slice(0, 8).map(x => row(x.id, x.before, x.after, x.id === id, x.risk)).join('')}</div>` +
        (rows.length > 8 ? `<p class="or-pm-n">+ ${nf(rows.length - 8)} weitere Aufträge mit kleineren Verschiebungen.</p>` : '') +
        (self0 && to === 'eil' && self0.before - self0.after < 15 * 60 ? `<p class="or-pm-n"><b>Vorziehen bringt ${esc(id)} laut Planung kaum Zeit</b> – die Reihenfolge an den Maschinen ist hier nicht der begrenzende Faktor.</p>` : '') +
        (late.length ? `<div class="or-pm-w">${icon('alert', 15)}<span>Dadurch ${late.length === 1 ? 'wird' : 'werden'} <b>${late.map(esc).join(', ')}</b> ${wi.newlyLate.length ? 'zu spät' : 'noch später'} – Alternative: Arbeitsgang verlagern oder Überstunden am Engpass.</span></div>` : '') +
        `<p class="or-pm-n">${others.length ? `${nf(others.length)} ${others.length === 1 ? 'weiterer Auftrag verschiebt' : 'weitere Aufträge verschieben'} sich um mehr als 5 min.` : 'Kein anderer Auftrag verschiebt sich um mehr als 5 min.'} Was-wäre-wenn-Rechnung derselben Planung wie die Plantafel; nach der Umstellung bestätigt die nächste Planrechnung die Werte.</p>`;
    } else {
      tbl = `<div class="or-pm-h"><span>Liefertermin-Prognose</span><span>derzeit</span></div><div class="or-pm-t">${v.eta != null ? row(id, v.eta, null, true) : ''}</div>` +
        `<p class="or-pm-n">Die Planung rechnet nach der Umstellung neu – die Auswirkung auf alle Aufträge zeigt danach die Plantafel.</p>`;
    }
    body.innerHTML = `<p class="or-pm-lead">${lead}</p>${tbl}`;
    WF.app.modal({ title: to === 'eil' ? 'Als Eilauftrag kennzeichnen?' : 'Eilauftrag aufheben?', body, width: 600, actions: [
      { label: 'Abbrechen' },
      { label: to === 'eil' ? 'Als Eilauftrag kennzeichnen' : 'Priorität aufheben', primary: true, onClick: () => { applyPriority(id, to, wi); } },
    ] });
  }
  function applyPriority(id, to, wi) {
    const s = S(), now = s.t;
    const before = WF.sim.orderView(id);
    const r = WF.sim.actions.setPriority(id, to);
    if (!r || r.ok === false) { WF.app.toast((r && r.msg) || 'Priorität konnte nicht geändert werden', 'warn'); return; }
    const after = WF.sim.orderView(id);
    let body = to === 'eil'
      ? 'Die Maschinen ziehen den Auftrag bei jedem Auftragswechsel vor – laufende Teile werden nicht unterbrochen.'
      : 'Reihenfolge wieder nach Liefertermin.';
    const self = wi && wi.rows.find(x => x.id === id);
    const b0 = self ? self.before : before && before.etaRaw, a0 = self ? self.after : after && after.etaRaw;
    if (b0 != null && a0 != null && Math.abs(a0 - b0) >= 600) body += ` Prognose ${tShort(b0, now)} → ${tShort(a0, now)} (wird mit der nächsten Planrechnung bestätigt).`;
    else body += ' Die Prognose dieses Auftrags ändert sich dadurch kaum.';
    WF.app.toast(body, 'ok', { title: r.msg, ms: 6500, onClick: () => WF.app.select('order', id) });
    update();
  }

  // ------------------------------------------------------------------ Kennzahlen
  function updateKpis(views, now) {
    const open = views.filter(v => v.status !== 'fertig');
    const cnt = { ok: 0, knapp: 0, 'spät': 0, unbekannt: 0 };
    for (const v of open) { const rk = riskOf(v); cnt[rk] = (cnt[rk] || 0) + 1; }
    const inWork = open.filter(v => v.status === 'in Arbeit').length;
    const eil = open.filter(v => v.priority === 'eil').length;
    setHTML(R.kOpen, nf(open.length));
    setHTML(R.kOpenS, `<b>${nf(inWork)}</b> in Arbeit · <b>${nf(open.length - inWork)}</b> freigegeben${eil ? ` · <b>${nf(eil)}</b> Eil` : ''}<br><b>${nf(cnt.ok)}</b> im Plan (mehr als 4 h Puffer)`);
    const tot = Math.max(1, open.length);
    setW(R.bOk, cnt.ok / tot); setW(R.bKn, cnt.knapp / tot); setW(R.bLt, cnt['spät'] / tot);
    // Verspätet / Knapp: je eine Kachel, Hinweis nur über .warn/.crit und nie bei 0 (UI_GUIDE Regel 14)
    const byRisk = (k) => open.filter(v => riskOf(v) === k).sort((a, b) => (a.slackSec == null ? 0 : a.slackSec) - (b.slackSec == null ? 0 : b.slackSec));
    const idList = (l) => (l.length > 2 ? l.slice(0, 2).map(v => v.id).join(', ') + ' +' + (l.length - 2) : l.map(v => v.id).join(', '));
    const late = byRisk('spät'), tight = byRisk('knapp');
    setText(R.kLateV, nf(late.length));
    setCls(R.kLate, 'kpi click' + (late.length ? ' crit' : ''));
    setHTML(R.kLateS, late.length ? `<span class="mono">${esc(idList(late))}</span><br>${late[0].slackSec != null ? 'bis ' + esc(durLong(-late[0].slackSec)) + ' zu spät' : 'Prognose nach Termin'}` : 'keiner – alle Prognosen vor dem Liefertermin');
    // Knapp = weniger als 4 h Puffer ODER Menge gefährdet (Ausschuss nach AG 1 ohne Nachfertigung) – beides wird beim Kunden spät/unvollständig
    const tightT = tight.filter(v => timeRisk(v)), tightQ = tight.filter(v => !timeRisk(v));
    setText(R.kTightV, nf(tight.length));
    setCls(R.kTight, 'kpi click' + (tight.length ? ' warn' : ''));
    const qLine = tightQ.length ? (tightQ.length === 1 ? 'Menge gefährdet' : nf(tightQ.length) + '× Menge gefährdet') : '';
    setHTML(R.kTightS, tight.length ? `<span class="mono">${esc(idList(tightT.concat(tightQ)))}</span><br>${tightT.length ? (tightT[0].slackSec != null ? 'Puffer ab ' + esc(durLong(tightT[0].slackSec)) : 'weniger als 4 h Puffer') + (qLine ? ' · ' + qLine : '') : qLine}` : 'keiner mit weniger als 4 h Puffer');
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
    const bw = plantBottleneck();
    setHTML(R.sub, `<span>${nf(views.length)} Fertigungsaufträge</span><span class="faint">·</span><span>Liefertermin-Prognose aus Live-Daten, Stand ${esc(U.fmtClock(fc.t))}</span>` +
      (bw && bw.stationId ? `<button type="button" class="or-bnw${bw.atRisk ? ' risk' : ''}" data-m="${esc(bw.stationId)}" title="${esc('Engpass im Werk: ' + bw.name + ' (' + bw.stationId + ') – ' + (bw.why || ''))}">${icon('gauge', 13)}Engpass im Werk <b>${esc(bw.stationId)} ${esc(bw.short || '')}</b></button>` : ''));
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
          <div class="or-l1"><span class="or-id" data-r="id"></span><span class="or-tag eil" data-r="eil" hidden>${icon('bolt', 11)}Eilauftrag</span><span class="or-tag rel" data-r="stat" hidden>Freigegeben</span><span class="or-tag src" data-r="src" hidden></span></div>
          <div class="or-cust"><b data-r="cust"></b><span data-r="sect"></span></div>
          <div class="or-part-alt" data-r="partAlt"></div>
        </div>
        <div class="or-part"><b data-r="pn"></b><span data-r="pno"></span></div>
        <div class="or-prog">
          <div class="or-prog-t"><b data-r="pct"></b><span data-r="qty"></span></div>
          <span class="or-pbar"><i class="w" data-r="pwork"></i><i data-r="pbar"></i></span>
          <div class="or-prog-s" data-r="pS"></div>
        </div>
        <div class="or-dates"><span>Termin</span><b data-r="due"></b><span data-r="etaL">Prognose</span><b class="eta" data-r="eta"></b><small data-r="etaS" hidden></small></div>
        <div class="or-risk"><span class="or-rb" data-r="rb"><i></i><span data-r="rbT"></span></span><span class="or-slack" data-r="slack"></span></div>
        <button type="button" class="or-prio" data-r="prio" data-act="prio">${icon('bolt', 16)}</button>
      </div>
      <div class="or-chain" data-r="chain" aria-label="Arbeitsplan"></div>
      <div class="or-foot"><span class="or-now" data-r="now"><span data-r="nowIc"></span><span data-r="nowT"></span></span><span class="or-msg" data-r="msg" hidden>${icon('bell', 13)}<span data-r="msgT"></span></span><span class="or-bn" data-r="bn" hidden>${icon('gauge', 14)}<span data-r="bnT"></span></span><button type="button" class="or-lvq" data-r="lvq" data-act="lever" hidden></button></div>`;
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
    const lim = atRisk(v) ? limitOf(v) : null;
    const bn = lim ? lim.seq : null, bnPlant = !!(lim && lim.plant);
    ops.forEach((op, i) => {
      const ch = c.chips[i]; const vis = opVis(op);
      setCls(ch.el, 'or-step s-' + vis.k + (bn === op.seq && op.state !== 'done' ? (bnPlant ? ' bn plant' : ' bn') : ''));
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
    let h = `<div class="or-tip-h"><b>${esc(v.id)}</b><span>AG ${op.seq} · ${esc(op.op)}</span></div><div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin:2px 0 5px"><span class="muted">${esc(where)}</span>${st}</div>`;
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
    const lim = v.status !== 'fertig' ? limitOf(v) : null;
    if (lim && lim.seq === op.seq) h += `<div class="or-tip-n">${esc(lim.plant ? 'Werks-Engpass – begrenzt den Durchlauf dieses Auftrags' : 'Begrenzt den Durchlauf dieses Auftrags')}${v.delayCause ? ' · ' + esc(v.delayCause) : ''}</div>`;
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
    const rk = v.status !== 'fertig' ? riskOf(v) : null, late = rk === 'spät', tight = rk === 'knapp';
    setCls(c.el, 'or-card' + (late ? ' r-late' : tight ? ' r-tight' : '') + (v.status === 'fertig' ? ' done' : '') + (selectedOrder === v.id ? ' sel' : ''));
    setVar(c.el, '--rc', rb.c);
    setText(r.id, v.id);
    setHidden(r.eil, v.priority !== 'eil');
    // Status- und Herkunftsetikett: „Freigegeben“ (noch kein Arbeitsgang begonnen) und besondere Quellen (KI-Auftrag, Nachfertigung)
    setHidden(r.stat, v.status !== 'freigegeben');
    setAttr(r.stat, 'title', 'Freigegeben, noch kein Arbeitsgang begonnen');
    const src = srcTag(v);
    setHidden(r.src, !src);
    if (src) { setText(r.src, src.label); setAttr(r.src, 'title', src.title); }
    setText(r.cust, custShort(v.customer)); setAttr(r.cust, 'title', v.customer);
    setText(r.sect, v.sector || '');
    setText(r.pn, v.part.name); setAttr(r.pn, 'title', v.part.name);
    const pno = [v.part.no, v.part.material].filter(Boolean).join(' · ');
    setText(r.pno, pno);
    setHTML(r.partAlt, `${esc(v.part.name)}<span>${esc(v.part.no || '')}</span>`);
    // Fortschritt: Stückzahl zuerst (fertig bearbeitet bzw. versandt), gewichteter Arbeitsinhalt als zweite Ebene
    const pg = progOf(v);
    setHTML(r.pct, `${nf(pg.n)}<small>/ ${nf(v.qty)} Stk ${pg.label}</small>`);
    setText(r.qty, '');
    setW(r.pbar, pg.frac);
    setW(r.pwork, pg.work);
    setHTML(r.pS, pg.sub);
    setAttr(r.pS.parentNode, 'title', pg.title);
    // Termine
    // kompaktes Format, damit nichts abgeschnitten wird; volle Angabe im Tooltip
    setText(r.due, dueShort(v.due, now)); setAttr(r.due, 'title', 'Liefertermin ' + fmtDue(v.due, now));
    const t2 = v.status === 'fertig' ? v.doneT : v.eta;
    setText(r.etaL, v.status === 'fertig' ? 'Fertig' : 'Prognose');
    setText(r.eta, dueShort(t2, now)); setAttr(r.eta, 'title', t2 != null ? (v.status === 'fertig' ? 'Fertig ' : 'Prognose ') + fmtDue(t2, now) : null);
    // sofort sichtbar, wenn eine Störung o. Ä. die Prognose verschiebt: neu gerechnet, wird mit der nächsten Planrechnung bestätigt
    const pend = pendingEta(v);
    setHidden(r.etaS, pend == null);
    if (pend != null) {
      setHTML(r.etaS, `${icon('refresh', 11)}neu ${esc(tShort(pend, now))} – wird geprüft`);
      setCls(r.etaS, pend > v.eta ? 'dn' : 'up');
      setAttr(r.etaS, 'title', `Die letzte Planrechnung ergibt ${tShort(pend, now)} (${pend > v.eta ? '+' : '−'}${durLong(Math.abs(pend - v.eta))}). Der Liefertermin wird übernommen, sobald die nächste Planrechnung ihn bestätigt.`);
    }
    // Lage
    setVar(r.rb, '--c', rb.c);
    setText(r.rbT, rb.label);
    setText(r.slack, slackText(v, true));
    setAttr(r.rb.parentNode, 'title', v.status === 'fertig' ? null : (qtyShort(v) ? qtyShort(v).text + '\n' : '') + 'Im Plan: > 4 h Puffer · Knapp: < 4 h oder Menge gefährdet · Verspätet: Prognose nach Liefertermin');
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
    // Schnellaktion „Hebel“: beste ausführbare Maßnahme der Engine (Eilauftrag hat den eigenen Blitz-Knopf);
    // bei gefährdeter Menge die Nachfertigung
    let lv = null;
    if (timeRisk(v)) lv = leversOf(adviceOf(v.id, v, 5000)).find(x => x.action.type !== 'setPriority') || null;
    else if (qtyShort(v)) lv = { kind: 'planRemake', qtyRemake: true, label: `Nachfertigung ${nf(qtyShort(v).missing)} Stk`, action: { type: 'planRemake', orderId: v.id } };
    c.lever = lv;
    setHidden(r.lvq, !lv);
    if (lv) {
      const lm = LEVER[lv.kind] || LEVER[lv.action.type] || { ic: 'arrowRight' };
      const g = !lv.qtyRemake && num0(lv.gainSec) != null && lv.gainSec >= 60 ? lv.gainSec : null;
      setHTML(r.lvq, `${icon(lm.ic || 'arrowRight', 13)}<span>${esc(lv.label || lm.t || '')}</span>${g ? `<b>−${esc(durLong(g))}</b>` : ''}`);
      setAttr(r.lvq, 'title', lv.qtyRemake ? 'Nachfertigung als Eilauftrag einplanen – dann ist die volle Menge lieferbar' : (lv.text || lv.label || '') + (leverCost(lv) != null ? ` · ca. ${U.fmtEur(leverCost(lv))}` : '') + ' – prüfen und umsetzen');
    }
    // Meldungschip: Terminmeldung entfällt, wenn ein Hebel daneben steht (sagt dasselbe, der Hebel handelt)
    const nts = v.status !== 'fertig' ? orderNotifs(v.id).filter(n => !(lv && /^(late|qty):/.test(n.key || ''))) : [];
    setHidden(r.msg, !nts.length);
    if (nts.length) {
      const top = nts.find(n => n.sev === 'crit') || nts.find(n => n.sev === 'warn') || nts[0];
      setVar(r.msg, '--c', (WF.SEV[top.sev] || WF.SEV.info).color);
      setText(r.msgT, nts.length === 1 ? top.title.replace(/\s*\(.*\)\s*$/, '').replace(': ' + v.id, '') : nts.length + ' Meldungen');
      setAttr(r.msg, 'title', nts.map(n => n.title + (n.status === 'ack' ? ' (quittiert)' : '')).join('\n'));
    }
    const lim = atRisk(v) ? limitOf(v) : null;
    setHidden(r.bn, !lim);
    if (lim) {
      // „Engpass“ nur für den Werks-Engpass (Engine: bottleneck()); sonst begrenzt der Schritt nur diesen Auftrag (Regel 18)
      setHTML(r.bnT, `${lim.plant ? 'Werks-Engpass' : 'begrenzt durch'} <b>${esc(lim.name)}</b>${lim.seq != null ? ' · AG ' + lim.seq : ''}`);
      setAttr(r.bn, 'title', v.delayCause ? lim.text + ' – ' + v.delayCause : lim.text);
    }
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
    if (filter === 'risk') { main = open.filter(v => riskOf(v) === 'spät' || riskOf(v) === 'knapp'); side = null; }
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
  const AXIS_H = 46, LANE_H = 40, BLK_Y = 7, BLK_H = 22, EXT_ROW = 26;
  function ganttMount(pane) {
    pane.innerHTML = `
      <div class="or-gbar">
        <div class="seg" role="group" aria-label="Zeitraum" data-r="zoomSeg"><button data-z="8">8 h</button><button data-z="24">24 h</button><button data-z="48">48 h</button></div>
        <button type="button" class="btn sm" data-r="nowBtn" title="Zur aktuellen Uhrzeit springen">${icon('clock', 14)}Jetzt</button>
        <div class="or-glw"><span class="or-gl-l" data-r="glegL">Hervorheben</span><div class="or-gleg" data-r="gleg" aria-label="Aufträge hervorheben"></div></div>
      </div>
      <section class="card or-gwrap" aria-label="Belegung je Arbeitsplatz">
        <div class="card-h or-gh"><h3>Belegung je Arbeitsplatz</h3><div class="or-gsel" data-r="gsel" aria-live="polite"></div></div>
        <div class="or-gcard" data-r="gcard">
          <div class="or-glabels" data-r="glabels"></div>
          <div class="or-gscroll" data-r="gscroll" tabindex="0" aria-label="Zeitachse – verschieben zum Blättern"><svg class="or-gsvg" data-r="gsvg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plantafel: Belegung und Prognose je Arbeitsplatz"></svg></div>
        </div>
      </section>
      <div class="or-gkey" style="margin-top:10px">
        <span><span class="k-ist"></span>Ist-Belegung</span>
        <span><span class="k-fc"></span>Prognose</span>
        <span><span class="k-su"></span>Rüsten</span>
        <span><span class="k-ext"></span>Weitere Lose geplant</span>
        <span title="Bediener-Arbeitsplätze (Einlegen von Hand, Messraum, Montage) arbeiten nur in der Schichtzeit – Nacht und Wochenende ohne Schicht"><span class="k-ns"></span>Keine Schicht (Bediener-Arbeitsplatz)</span>
        <span><span class="k-hl"></span>Hervorgehobener Auftrag</span>
        <span><span class="k-rl"></span>Verspätet</span>
        <span><span class="k-rk"></span>Knapp</span>
        <span><span class="k-eil"></span>Eilauftrag</span>
        <span><span class="k-st">${['running', 'setup', 'toolchange', 'starved', 'fault', 'idle'].map(k => `<i style="--c:${WF.STATE[k].color}"></i>`).join('')}</span>Zustandsband (Ist)</span>
        <span><span class="k-lk"></span>Materialfluss</span>
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
    // Auftragsleiste: waagrecht verschiebbar (Mausrad wirkt waagrecht), Randverlauf zeigt weitere Aufträge an
    R.gleg.addEventListener('scroll', glegMask, { passive: true });
    R.gleg.addEventListener('wheel', (e) => {
      const g = R.gleg; if (g.scrollWidth <= g.clientWidth + 2 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      g.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
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
    let stickRaf = 0;
    sc.addEventListener('scroll', () => { if (!stickRaf) stickRaf = requestAnimationFrame(() => { stickRaf = 0; stickLabels(); }); }, { passive: true });
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
    // erster geplanter Block des Auftrags (sonst irgendeiner), links mit etwas Luft in den Ausschnitt holen
    const pick = (sel) => Array.from(R.gsvg.querySelectorAll(sel)).map(n => Number(n.dataset.x)).filter(x => isFinite(x));
    let xs = pick(`.fc .blk[data-o="${CSS.escape(oid)}"], .ext .blk[data-o="${CSS.escape(oid)}"]`);
    if (!xs.length) xs = pick(`.blk[data-o="${CSS.escape(oid)}"]`);
    if (!xs.length) return;
    const minX = Math.min(...xs);
    const W = R.gscroll.clientWidth, L = R.gscroll.scrollLeft;
    if (minX >= L && minX <= L + W - 40) return;
    const left = Math.max(0, minX - 60);
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
  /** Belegung eines Bediener-Arbeitsplatzes in Arbeitsabschnitte zerlegen: Zeiten ohne Schicht ≥ 90 min (Nacht, Wochenende)
      sind Lücken, kürzere (Pausen) bleiben im Block. → { work:[[a,b]], gaps:[[a,b]], brk:[[a,b]] } */
  function staffedSplit(a, e) {
    const work = [], gaps = [], brk = [];
    let cur = a;
    for (const [p, q] of offWork(a, e)) {
      if (q - p >= 90 * 60) { if (p > cur + 30) work.push([cur, p]); gaps.push([p, q]); cur = q; }
      else brk.push([p, q]);
    }
    if (e > cur + 30) work.push([cur, e]);
    return { work, gaps, brk };
  }
  // Beschriftung 11,5 px: ca. 6,4 px je Zeichen; Blöcke unter 28 px bleiben unbeschriftet
  const CW = 6.4;
  const labelFits = (txt, w) => w >= 28 && txt.length * CW + 14 <= w;
  /** Blockbeschriftung, die beim horizontalen Scrollen am linken Rand „kleben“ bleibt (solange der Block sichtbar ist) */
  const stickyText = (txt, x0, x1, y, cls, variants) => `<text class="bl tl${cls ? ' ' + cls : ''}" data-a="${(x0 + 8).toFixed(1)}" data-b="${x1.toFixed(1)}" data-w="${(txt.length * CW).toFixed(0)}" data-v="${esc((variants || [txt]).filter(Boolean).join('|'))}" x="${(x0 + 8).toFixed(1)}" y="${y}">${esc(txt)}</text>`;
  function pickLabel(variants, w) { for (const t of variants) if (t && labelFits(t, w)) return t; return ''; }
  /** ein Beschriftungsformat für alle Blöcke: „FA-24119 · AG 20“, sonst „24119“ */
  const blkLabels = (oid, seq) => [seq != null ? `${oid} · AG ${seq}` : oid, numId(oid)];
  const riskCls = (v) => { const rk = v && v.status !== 'fertig' ? riskOf(v) : null; return rk === 'spät' || rk === 'knapp' ? ' r-' + rk : ''; };
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
    const freshOn = !!(G.fresh && performance.now() < G.fresh.until);
    const freshCls = (oid) => (!freshOn ? '' : oid === G.fresh.id ? ' fresh' : G.fresh.shifted.has(oid) ? ' shift' : '');
    out.push(`<defs><pattern id="or-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" style="fill:var(--text)" fill-opacity=".2"/></pattern>` +
      `<pattern id="or-ns" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="1.3" height="5" style="fill:var(--muted)" fill-opacity=".38"/></pattern>` +
      `<marker id="or-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" style="fill:var(--mat)"/></marker></defs>`);
    // Schichten / Nacht
    const pxH = pps * HOUR;
    const tick = [1, 2, 3, 4, 6, 12].find(h => h * pxH >= 50) || 12;
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
        out.push(`<text class="bl" data-a="${x.toFixed(1)}" data-b="${(X(t + 8 * HOUR) - 4).toFixed(1)}" data-w="${(txt.length * 7.3).toFixed(0)}" x="${x.toFixed(1)}" y="15" font-size="10.5" font-weight="600" letter-spacing=".06em" style="fill:var(--${a === 22 ? 'faint' : 'text2'})">${esc(txt.toUpperCase())}</text>`);
      }
    }
    out.push(`<line x1="0" x2="${width}" y1="${AXIS_H - 0.5}" y2="${AXIS_H - 0.5}" style="stroke:var(--line)"/>`);
    for (const l of lanes) out.push(`<line x1="0" x2="${width}" y1="${(l.y + l.h - 0.5).toFixed(1)}" y2="${(l.y + l.h - 0.5).toFixed(1)}" style="stroke:var(--line)"/>`);
    // Vergangenheit abdunkeln
    out.push(`<rect x="0" y="${AXIS_H}" width="${Math.max(0, X(now)).toFixed(1)}" height="${H - AXIS_H}" style="fill:var(--bg)" fill-opacity=".22"/>`);
    out.push('</g>');
    // Ist-Belegung + Zustandsband
    const past = pastOccupancy(now);
    const rr = (x, yy, w, h, cls, extra) => `<rect class="${cls}" x="${x.toFixed(1)}" y="${yy}" width="${Math.max(1, w).toFixed(1)}" height="${h}" rx="4"${extra || ''}/>`;
    /** Bediener-Arbeitsplatz: Nacht/Wochenende als Lücke „keine Schicht“ (schraffiert, ohne Kontur), kurze Pausen dunkel im Block */
    const gapHtml = (sp, yy) => sp ? sp.gaps.map(([p, q]) => {
      const gx = X(p), gw = X(q) - gx; if (gw < 2) return '';
      return `<rect class="ns" x="${gx.toFixed(1)}" y="${yy + 4}" width="${gw.toFixed(1)}" height="${BLK_H - 8}" rx="2"/><line class="nsl" x1="${gx.toFixed(1)}" x2="${(gx + gw).toFixed(1)}" y1="${yy + BLK_H / 2}" y2="${yy + BLK_H / 2}"/>`;
    }).join('') : '';
    const brkHtml = (sp, yy) => sp ? sp.brk.map(([p, q]) => {
      const ox = X(p), ow = X(q) - ox; if (ow < 1.5) return '';
      return `<rect class="off" x="${ox.toFixed(1)}" y="${yy + 1}" width="${ow.toFixed(1)}" height="${BLK_H - 2}"/>`;
    }).join('') : '';
    out.push('<g class="past">');
    for (const l of lanes) {
      if (l.id === 'EXT') continue;
      const m = s.machines[l.id];
      const staffed = m.loading !== 'auto';
      for (const b of past[l.id] || []) {
        const a = Math.max(b.t0, d0), e = Math.min(b.t1, now);
        if (e <= a) continue;
        const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 1) continue;
        const i = tips.length;
        tips.push({ kind: 'past', o: b.o, seq: b.seq, mid: l.id, t0: b.t0, t1: b.t1, live: b.live, pre: b.pre, shares: stateShares(m.segments, a, e) });
        const pv = blkLabels(b.o, b.seq), yy = l.y + BLK_Y;
        const sp = staffed ? staffedSplit(a, e) : null;
        const segs = sp && sp.work.length ? sp.work : [[a, e]];
        let h = gapHtml(sp && sp.work.length ? sp : null, yy);
        for (const [p, q] of segs) {
          const sx0 = X(p), sx1 = X(q), sw = sx1 - sx0; if (sw < 1) continue;
          const lbl = pickLabel(pv, sw);
          h += rr(sx0 + 0.5, yy, sw - 1, BLK_H, 'bf ps') + (lbl ? stickyText(lbl, sx0, sx1, yy + 15, 'ps', pv) : '');
        }
        out.push(`<g class="blk" data-i="${i}" data-o="${esc(b.o)}" data-x="${x0.toFixed(0)}">${h}</g>`);
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
    // Prognose-Blöcke: neutral; laufender Arbeitsgang mit Kante in der Farbe des Maschinenzustands,
    // gefährdete Aufträge mit Kontur in Zustandsfarbe, Eilauftrag mit roter Ecke.
    // Bediener-gebundene Arbeitsplätze arbeiten nur in der Schichtzeit: die Prognose der Engine belegt die Maschine über
    // Nacht durchgehend – hier wird die Nacht als Lücke „keine Schicht“ gezeigt, Pausen dunkel im Block.
    out.push('<g class="fc">');
    for (const l of lanes) {
      if (l.id === 'EXT') continue;
      const mst = WF.STATE[s.machines[l.id].state] || WF.STATE.idle;
      const staffed = s.machines[l.id].loading !== 'auto';
      for (const b of fc.machines[l.id] || []) {
        const a = Math.max(b.start, now), e = b.end;
        if (e - a < 30) continue;
        const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 0.8) continue;
        const i = tips.length;
        const sp0 = staffed ? staffedSplit(a, e) : null, sp = sp0 && sp0.work.length ? sp0 : null;
        const segs = sp ? sp.work : [[a, e]];
        const workSec = sp ? segs.reduce((acc, [p, q]) => acc + (q - p), 0) - sp.brk.reduce((acc, [p, q]) => acc + (q - p), 0) : e - a;
        tips.push({ kind: 'fc', o: b.orderId, seq: b.seq, op: b.op, mid: l.id, start: b.start, end: b.end, opEnd: b.opEnd, setupEnd: b.setupEnd, active: b.active,
          staffed: !!(sp && (sp.brk.length || sp.gaps.length)), night: !!(sp && sp.gaps.length), workSec });
        const v = vById[b.orderId];
        const fv = blkLabels(b.orderId, b.seq);
        const yy = l.y + BLK_Y;
        const eil = v && v.priority === 'eil';
        const sx0 = X(segs[0][0]), fx1 = X(segs[0][1]);
        let su = '';
        if (b.setupEnd != null && b.setupEnd > a + 30) { const sw = Math.min(X(b.setupEnd), fx1) - sx0; if (sw > 1) su = rr(sx0 + 0.5, yy, sw - 0.5, BLK_H, 'su'); }
        // Arbeitsplätze, die je Behälter freigeben (Messraum, Waschen, Montage): Arbeitsgang bleibt bis opEnd offen
        let tail = '';
        if (b.opEnd != null && b.opEnd > e + 600) {
          const tx1 = X(b.opEnd), ty = yy + BLK_H / 2;
          tail = `<line class="tail" x1="${(x1 + 2).toFixed(1)}" x2="${tx1.toFixed(1)}" y1="${ty}" y2="${ty}"/><line class="tailx" x1="${tx1.toFixed(1)}" x2="${tx1.toFixed(1)}" y1="${ty - 4}" y2="${ty + 4}"/>` +
            `<rect x="${x1.toFixed(1)}" y="${yy}" width="${Math.max(0, tx1 - x1).toFixed(1)}" height="${BLK_H}" fill="transparent"/>`;
        }
        const edge = b.active && fx1 - sx0 > 6 ? `<rect x="${(sx0 + 0.5).toFixed(1)}" y="${yy}" width="3" height="${BLK_H}" rx="1.5" style="fill:${mst.color}"/>` : '';
        const eilMk = eil && fx1 - sx0 > 10 ? `<path class="eil" d="M${(sx0 + 0.5).toFixed(1)} ${yy + 4}a4 4 0 0 1 4-4h5l-9 9z"/>` : '';
        const cls = 'bf' + (b.active ? ' act' : '') + riskCls(v);
        let h = tail + gapHtml(sp, yy);
        segs.forEach(([p, q], k) => {
          const px0 = X(p), px1 = X(q), pw = px1 - px0; if (pw < 0.8) return;
          h += rr(px0 + 0.5, yy, pw - 1, BLK_H, cls);
        });
        h += brkHtml(sp, yy) + (!sp && sp0 ? brkHtml({ brk: sp0.gaps.concat(sp0.brk) }, yy) : '') + su + edge + eilMk;
        // Beschriftung je Arbeitsabschnitt (vor und nach der Nacht), sofern sie hineinpasst
        segs.forEach(([p, q], k) => {
          const px0 = X(p) + (k === 0 && edge ? 3 : 0), px1 = X(q), lbl = pickLabel(fv, px1 - px0);
          if (lbl) h += stickyText(lbl, px0, px1, yy + 15, b.active && k === 0 ? 'act' : '', fv);
        });
        out.push(`<g class="blk${freshCls(b.orderId)}" data-i="${i}" data-o="${esc(b.orderId)}" data-x="${sx0.toFixed(0)}">${h}</g>`);
      }
    }
    out.push('</g>');
    // Fremdbearbeitung
    out.push('<g class="ext">');
    const extRowOf = {};
    for (const it of ext) {
      const a = Math.max(it.t0, d0), e = it.t1; if (e <= a) continue;
      const x0 = X(a), x1 = X(e), w = x1 - x0; if (w < 1) continue;
      const yy = extLane.y + 7 + it.row * EXT_ROW, hh = EXT_ROW - 5;
      const i = tips.length, v = vById[it.o];
      tips.push(Object.assign({ mid: 'EXT' }, it));
      if (extRowOf[it.o] == null || it.kind !== 'past') extRowOf[it.o] = yy + hh / 2;
      let rect;
      if (it.kind === 'plan') rect = rr(x0 + 0.5, yy, w - 1, hh, 'bf pl' + riskCls(v));
      else if (it.kind === 'past') rect = rr(x0 + 0.5, yy, w - 1, hh, 'bf ps');
      else rect = rr(x0 + 0.5, yy, w - 1, hh, 'bf' + riskCls(v)) + (w > 6 ? `<rect x="${(x0 + 0.5).toFixed(1)}" y="${yy}" width="3" height="${hh}" rx="1.5" style="fill:var(--ext)"/>` : '');
      const ev = it.kind === 'plan'
        ? [`${it.o} · weitere Lose à ${it.lotQty} Stk`, `${it.o} · Lose à ${it.lotQty}`, numId(it.o)]
        : [`${it.o} · ${it.qty} Stk · zurück ${tShort(it.t1, now)}`, `${it.o} · ${it.qty} Stk`, numId(it.o)];
      const lbl = pickLabel(ev, w);
      out.push(`<g class="blk" data-i="${i}" data-o="${esc(it.o)}" data-x="${x0.toFixed(0)}">${rect}` +
        (lbl ? stickyText(lbl, x0 + (it.kind === 'at' ? 3 : 0), x1, yy + hh / 2 + 4, it.kind === 'at' ? 'act' : it.kind === 'past' ? 'ps' : '', ev) : '') + '</g>');
    }
    if (!ext.length) out.push(`<text x="${(Math.max(0, X(now)) + 10).toFixed(1)}" y="${extLane.y + extLane.h / 2 + 4}" font-size="11.5" style="fill:var(--faint)">Keine Lose beim Härtepartner und keine weiteren geplant</text>`);
    out.push('</g>');
    out.push('<g class="lk" data-r="links"></g>');
    // Jetzt-Linie
    const nx = X(now);
    out.push(`<g class="now" data-r="nowG" transform="translate(${nx.toFixed(1)},0)"><line x1="0" x2="0" y1="${AXIS_H - 20}" y2="${H}" style="stroke:var(--accent)" stroke-width="1.5"/>` +
      `<rect x="-22" y="${AXIS_H - 25}" width="44" height="17" rx="8.5" style="fill:var(--accent)"/><text data-r="nowTxt" x="0" y="${AXIS_H - 12.5}" text-anchor="middle" font-size="11.5" font-weight="700" style="fill:var(--accent-ink)" font-variant-numeric="tabular-nums">${U.fmtClock(now)}</text></g>`);
    const svg = R.gsvg;
    svg.setAttribute('width', width); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    svg.innerHTML = out.join('');
    G.nowG = svg.querySelector('[data-r="nowG"]'); G.nowTxt = svg.querySelector('[data-r="nowTxt"]'); G.links = svg.querySelector('[data-r="links"]');
    G.blText = null; G.stickL = null;
    G.tips = tips;
    G.geo = { d0, d1, pps, X, lanes, laneBy, extRowOf, H, width };
    // Beschriftungen links
    const lh = [`<div class="or-gl-h" style="height:${AXIS_H}px">Arbeitsplatz</div>`];
    for (const l of lanes) {
      if (l.id === 'EXT') {
        const nAt = ext.filter(x => x.kind === 'at').reduce((a, x) => a + x.qty, 0);
        lh.push(`<div class="or-gl ext" style="height:${l.h}px" title="Fremdbearbeitung beim Härtepartner (Lose mit Hin- und Rücktransport)"><i></i><b>Härterei</b><small><em>EXT</em>${nAt ? nf(nAt) + ' Stk beim Partner' : 'Fremdbearbeitung'}</small></div>`);
        continue;
      }
      const m = s.machines[l.id], st = WF.STATE[m.state] || WF.STATE.idle;
      lh.push(`<button type="button" class="or-gl" data-m="${esc(l.id)}" style="height:${l.h}px;--c:${st.color}" title="${esc(m.name)} (${esc(l.id)}) – ${esc(st.label)}: ${esc(m.cause || '')}"><i></i><b>${esc(m.short)}</b><small><em>${esc(l.id)}</em>${esc(st.label)}</small></button>`);
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
    stickLabels();
    if (G.focusExt) {
      G.focusExt = false;
      const ex = R.glabels.querySelector('.or-gl.ext');
      if (ex && ex.scrollIntoView) ex.scrollIntoView({ block: 'center', behavior: 'smooth' });
      ganttScrollToNow(true);
    }
  }
  function stickLabels() {
    if (!R || !R.gsvg) return;
    const L = R.gscroll.scrollLeft;
    if (G.stickL === L && G.stickN === G.sig) return;
    G.stickL = L; G.stickN = G.sig;
    const list = G.blText || (G.blText = Array.from(R.gsvg.querySelectorAll('text.bl')).map(n => {
      const v = (n.dataset.v || n.textContent).split('|'), cw = +n.dataset.w / Math.max(1, n.textContent.length);
      return { n, a: +n.dataset.a, b: +n.dataset.b, cw, v, full: n.textContent, txt: n.textContent, x: +n.dataset.a };
    }));
    for (const t of list) {
      const left = Math.max(t.a, L + 6);
      // längste Variante, die in den sichtbaren Teil des Blocks passt (ganzer Block: ursprünglich gewählte)
      const room = t.b - left - 6;
      let txt = t.a >= L + 6 ? t.full : (t.v.find(x => x.length * t.cw <= room && x.length <= t.full.length) || '');
      const w = txt.length * t.cw;
      let x = Math.min(left, t.b - w - 6);
      if (x < t.a) x = t.a;
      if (txt !== t.txt) { t.txt = txt; t.n.textContent = txt; }
      if (Math.abs(x - t.x) > 0.5) { t.x = x; t.n.setAttribute('x', x.toFixed(1)); }
    }
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
    const open = views.filter(v => v.status !== 'fertig').sort((a, b) => (RISK_RANK[riskOf(a)] - RISK_RANK[riskOf(b)]) || (a.due - b.due));
    const sig = open.map(v => v.id + riskOf(v) + v.priority).join(',') + '|' + G.pin;
    if (R.gleg._sig === sig) return;
    R.gleg._sig = sig;
    if (G.pin && !open.some(v => v.id === G.pin)) G.pin = null;
    setHidden(R.glegL, !open.length);
    // neutrale Chips; Punkt nur bei gefährdetem Termin, Blitz bei Eilauftrag
    R.gleg.innerHTML = open.map(v => `<button type="button" data-o="${esc(v.id)}" class="risk-${esc(riskOf(v))}${v.id === G.pin ? ' on' : ''}" aria-pressed="${v.id === G.pin}" title="${esc(v.id)} · ${esc(v.part.name)} · ${esc(v.customer)} – Termin ${esc(U.fmtDayClock(v.due))}, ${esc(riskBadge(v).label)}${v.priority === 'eil' ? ' · Eilauftrag' : ''}">` +
      `${riskOf(v) === 'spät' || riskOf(v) === 'knapp' ? '<i></i>' : ''}${v.priority === 'eil' ? icon('bolt', 12) : ''}${esc(numId(v.id))}</button>`).join('');
    glegMask();
  }
  function glegMask() {
    const g = R && R.gleg; if (!g) return;
    const sl = g.scrollLeft;
    g.classList.toggle('scl', sl > 2);
    g.classList.toggle('end', sl + g.clientWidth >= g.scrollWidth - 2);
  }
  function selStrip(oid) {
    const box = R && R.gsel; if (!box) return;
    const s = S(), now = s.t;
    const v = oid && lastViews ? lastViews.find(x => x.id === oid) : null;
    let html, cls = 'or-gsel';
    if (!v) {
      const anyOpen = lastViews && lastViews.some(x => x.status !== 'fertig');
      html = `<span class="or-gs-hint">${anyOpen ? 'Block oder Auftrag oben wählen – zeigt Materialfluss und Liefertermin' : 'Keine offenen Aufträge eingeplant – Ist-Belegung des Tages'}</span>`;
    } else {
      const rb = riskBadge(v);
      cls += ' on';
      const pinned = G.pin === oid;
      html = `<span class="or-gs-t"><span class="or-gs-id"><i></i><span class="mono">${esc(v.id)}</span></span><span><b>${esc(v.part.name)}</b> · ${esc(custShort(v.customer))}</span>
        <span class="or-rb" style="--c:${rb.c}"><i></i>${esc(rb.label)}</span>
        <span>Termin <b>${esc(tShort(v.due, now))}</b></span><span>${v.status === 'fertig' ? 'Fertig' : 'Prognose'} <b>${esc(tShort(v.status === 'fertig' ? v.doneT : v.eta, now))}</b>${pendingEta(v) != null ? ` <em class="or-gs-p ${pendingEta(v) > v.eta ? 'dn' : 'up'}" title="neu gerechnet – wird mit der nächsten Planrechnung bestätigt">→ neu ${esc(tShort(pendingEta(v), now))}</em>` : ''}</span>${G.fresh && G.fresh.id === v.id ? '<span class="or-gs-new">Neu eingelastet</span>' : ''}</span>
        <span class="or-gs-a"><button type="button" class="btn sm ghost" data-gs="due">${icon('target', 14)}Zum Termin</button><button type="button" class="btn sm" data-gs="open">Details</button>${pinned ? `<button type="button" class="btn sm ghost" data-gs="unpin" title="Hervorhebung aufheben" aria-label="Hervorhebung aufheben">${icon('x', 14)}</button>` : ''}</span>`;
    }
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
    if (box._c !== cls) { box._c = cls; box.className = cls; }
    box.dataset.o = v ? v.id : '';
  }
  /** hervorgehobenen Auftrag in der (waagrecht scrollbaren) Auftragsleiste sichtbar halten */
  function revealPin() {
    const box = R && R.gleg, b = box && box.querySelector('button.on'); if (!b) return;
    const L = box.scrollLeft, W = box.clientWidth, x0 = b.offsetLeft - box.offsetLeft, x1 = x0 + b.offsetWidth;
    if (x0 < L + 4) box.scrollLeft = Math.max(0, x0 - 40); else if (x1 > L + W - 28) box.scrollLeft = x1 - W + 40;
  }
  function setHL(oid) {
    selStrip(oid);
    if (G.pin) revealPin();
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
    const dx = g.X(o.due), v = lastViews && lastViews.find(x => x.id === oid);
    const rkL = v ? riskOf(v) : null, dc = rkL === 'spät' ? 'var(--st-fault)' : rkL === 'knapp' ? 'var(--st-wait)' : 'var(--accent)';
    if (dx >= 0 && dx <= g.width) {
      out.push(`<line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${AXIS_H}" y2="${g.H}" style="stroke:${dc}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
      const lbl = `Termin ${numId(oid)} · ${tShort(o.due, now)}`;
      const lw = lbl.length * 6.2 + 16;
      out.push(`<rect x="${(dx - lw / 2).toFixed(1)}" y="${AXIS_H + 3}" width="${lw.toFixed(1)}" height="18" rx="6" style="fill:${dc}"/><text x="${dx.toFixed(1)}" y="${AXIS_H + 16}" text-anchor="middle" font-size="11.5" font-weight="700" style="fill:var(--accent-ink)">${esc(lbl)}</text>`);
    }
    G.links.innerHTML = out.join('');
  }
  function showTip(info, e) {
    const s = S(), now = s.t;
    let tip = R.tip;
    if (!tip) { tip = R.tip = document.createElement('div'); tip.className = 'or-tip or-ltip'; tip.hidden = true; document.body.append(tip); }
    const o = s.orders[info.o];
    const v = lastViews && lastViews.find(x => x.id === info.o);
    const head = `<div class="or-tip-h"><b>${esc(info.o)}</b><span>${esc(o ? o.part.name : '')}</span></div>`;
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
        if (info.night || info.staffed) { body += row('Arbeitszeit', U.fmtDur(info.workSec)); if (info.night) body += row('Belegt (inkl. ohne Schicht)', U.fmtDur(info.end - a)); }
        else body += row('Dauer', U.fmtDur(info.end - a));
        if (info.setupEnd != null && info.setupEnd > a + 30) body += row('davon Rüsten', `${U.fmtDur(info.setupEnd - a)} (bis ${tShort(info.setupEnd, now)})`);
        if (info.opEnd != null && info.opEnd > info.end + 600) { body += row('Arbeitsgang fertig ca.', tShort(info.opEnd, now)); body += `<div class="or-tip-n">Belegt nur, solange Teile da sind – weitere Behälter folgen vom Vorgänger (gestrichelt bis Arbeitsgang-Ende)</div>`; }
        if (info.staffed) body += `<div class="or-tip-n">${info.night ? 'Bediener-Arbeitsplatz – in der Nacht ohne Schicht (schraffiert) steht er geplant, weiter mit Schichtbeginn; dunkel: Pausen' : 'Bediener legt jedes Teil ein – gearbeitet wird nur in der Schichtzeit (dunkel: Pausen)'}</div>`;
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
    if (G.fresh && performance.now() > G.fresh.until) { G.fresh = null; G.dirty = true; }
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
    // frisch eingelastet (KI-Auftrag): neuer Auftrag hervorgehoben, verschobene Aufträge kurz markiert
    if (params.fresh && params.order) G.fresh = { id: params.order, shifted: new Set(params.shifted || []), until: performance.now() + 20000 };
    if (params.order) {
      if (mode === 'gantt') { G.pin = params.order; G.pinFromSel = false; G.scrollPin = true; R.gleg._sig = null; }
      else requestAnimationFrame(() => {
        const c = cards[params.order]; if (!c || !c.el.isConnected) return;
        c.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (params.fresh) { c.el.classList.remove('fresh'); void c.el.offsetWidth; c.el.classList.add('fresh'); setTimeout(() => c.el.classList.remove('fresh'), 6000); }
      });
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

  // ------------------------------------------------------------------ Gemeinsame Arbeitsplan-Darstellung
  /** Eine Darstellung des Arbeitsplans für alle Ansichten (Auftragsliste, Maschinen- und Behälter-Drawer, Copilot):
      WF.ui.route(orderIdOrOps, { mode:'row'|'stack', current: AG-Nr., orderId })
      - 'row'  : Kette wie in der Auftragsliste – Schritte gleich breit, Verbinder zwischen den Schritten, bricht nie um
                 (schmaler Platz: waagrecht verschiebbar), Materialfluss am Verbinder
      - 'stack': senkrechte Schrittfolge für Drawer ≤ 480 px – AG, Arbeitsplatz, Status je Zeile
      Ohne mode: 'row' ab 640 px Fensterbreite, sonst 'stack'. Liefert HTML (Klassen .or-…, CSS aus diesem Modul). */
  function route(src, opts = {}) {
    const s = S(); if (!s) return '';
    let v = null, ops = src;
    if (typeof src === 'string') { v = WF.sim.orderView(src); ops = v ? v.ops : []; }
    else if (opts.orderId) { try { v = WF.sim.orderView(opts.orderId); } catch (e) { v = null; } }
    ops = (ops || []).filter(Boolean);
    if (!ops.length) return '';
    const vv = v || { id: opts.orderId || '', qty: opts.qty || 0, containers: [], eta: null };
    const now = s.t, cur = opts.current;
    const mode = opts.mode === 'stack' || opts.mode === 'row' ? opts.mode : (window.matchMedia('(max-width: 640px)').matches ? 'stack' : 'row');
    if (mode === 'stack') {
      return `<ol class="or-rs" aria-label="Arbeitsplan">` + ops.map(op => {
        const vis = opVis(op);
        return `<li class="s-${vis.k}${op.seq === cur ? ' cur' : ''}" style="--c:${vis.c}" title="${esc(chipTitle(op, vv, now))}"><span class="n">${vis.k === 'done' ? icon('check', 11) : vis.k === 'ext' ? icon('truck', 10) : ''}</span>` +
          `<span class="t"><em>AG ${op.seq}</em><b>${esc(stLabel(op))}</b></span><span class="s">${esc(chipSub(op, vv, now))}</span></li>`;
      }).join('') + `</ol>`;
    }
    const transit = {};
    for (const ct of vv.containers || []) if (ct.state === 'transit' && ct.seq != null) transit[ct.seq] = true;
    return `<div class="or-chain or-route${ops.length >= 6 ? ' many' : ''}" aria-label="Arbeitsplan">` + ops.map((op, i) => {
      const vis = opVis(op);
      const lk = i === 0 ? '' : `<span class="or-lk${transit[op.seq] ? ' flow' : op.received > 0 || op.state === 'done' ? ' pass' : ''}"></span>`;
      return lk + `<div class="or-step s-${vis.k}${op.seq === cur ? ' cur' : ''}" style="--c:${vis.c}" title="${esc(chipTitle(op, vv, now))}"><span class="or-st-ic">${vis.k === 'done' ? ICON_DONE : vis.k === 'ext' ? ICON_EXT : ''}</span>` +
        `<span class="or-st-tx"><span class="or-st-l"><em>${op.seq}</em><span>${esc(stLabel(op))}</span></span><span class="or-st-s">${esc(chipSub(op, vv, now))}</span></span>` +
        (vis.k === 'done' || vis.k === 'open' ? '' : `<i class="or-st-bt"><i class="or-st-bar" style="width:${(chipFrac(op, vv) * 100).toFixed(1)}%"></i></i>`) + `</div>`;
    }).join('') + `</div>`;
  }
  WF.ordersUi.route = route;
  if (!WF.ui.route) WF.ui.route = route;

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
  /** Was-wäre-wenn „Arbeitsgang verlagern“ (Engine), sonst null */
  function whatIfMove(orderId, seq, stationId) {
    if (!WF.sim || typeof WF.sim.whatIf !== 'function') return null;
    try { return WF.sim.whatIf({ type: 'moveOp', orderId, seq, stationId }); } catch (e) { console.warn('[whatIf moveOp]', e); return null; }
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
      body.innerHTML = `<p class="muted" style="margin:0;font-size:12.5px;line-height:1.45">Angeboten werden gleichartige Maschinen. ${typeof WF.sim.whatIf === 'function' ? 'Teilegewicht, Durchmesser, Stangenmaterial und 5-Achs-Bedarf prüft die Planung vorab; die Prognose je Maschine stammt aus derselben Planrechnung wie die Plantafel (inkl. Neu-Rüsten).' : 'Die Engine prüft zusätzlich Teilegewicht, Durchmesser, Stangenmaterial und 5-Achs-Bedarf und begründet eine Ablehnung. Auf der neuen Maschine wird neu gerüstet.'}</p>`;
      for (const op of withAlt) {
        const sec = document.createElement('div'); sec.className = 'or-mv-op';
        const cands = compatMachines(op.station);
        sec.innerHTML = `<div class="or-mv-h"><em>AG ${op.seq}</em><b>${esc(op.op)}</b><span>derzeit ${esc(op.stationName)} (${esc(op.station)}) · ${nf(Math.max(0, op.target - op.good - op.scrap))} Stk offen</span></div>
          <div class="or-mv-c">${cands.map(mid => {
            const m = s.machines[mid];
            const q = fc.machines[mid] || [];
            const busy = q.length ? Math.max(...q.map(b => b.end)) : null;
            // Was-wäre-wenn der Engine: dieselbe Prüfung (Gewicht, Ø, Stange, 5-Achs) und dieselbe Prognose wie nach dem Verlagern
            const w = whatIfMove(id, op.seq, mid);
            let pred = '', no = false;
            if (w && w.ok === false) { no = true; pred = `<span class="or-mv-no">nicht geeignet</span><small class="or-mv-why">${esc(w.msg || '')}</small>`; }
            else if (w && w.target) {
              const d = w.target.after - w.target.before, cls = Math.abs(d) < 300 ? '' : d < 0 ? ' up' : ' dn';
              const late = (w.newlyLate || []).concat((w.laterLate || []).filter(x => !(w.newlyLate || []).includes(x)));
              pred = `<span class="or-mv-p${cls}">${esc(id)} fertig ca. <b>${esc(tShort(w.target.after, now))}</b><em>${esc(fmtDelta(d))}</em></span>` +
                (late.length ? `<span class="or-mv-side">macht ${late.map(esc).join(', ')} später</span>` : '');
            }
            return `<button type="button" data-mid="${esc(mid)}" data-seq="${op.seq}"${no ? ' class="no" disabled' : ''}><b>${esc(m.short)}<em>${esc(mid)}</em></b>${WF.ui.pill(m.state)}<small>${esc(m.name)}<br>${busy && busy > now ? 'eingeplant bis ca. ' + esc(tShort(busy, now)) + ' (' + q.length + ' ' + (q.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge') + ')' : 'derzeit nichts eingeplant'}</small>${pred}</button>`;
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
          update();
        } else {
          msg.hidden = false; msg.textContent = (r && r.msg) || 'Verlagerung nicht möglich';
          b.classList.add('no'); b.disabled = true;
          const sm = b.querySelector('small'); if (sm && !b.querySelector('.or-mv-no')) sm.insertAdjacentHTML('beforebegin', '<span class="or-mv-no">nicht geeignet</span>');
        }
      });
    }
    modal = WF.app.modal({ title: 'Arbeitsgang verlagern · ' + id, body, width: 620, actions: [{ label: 'Schließen' }] });
  }

  // ------------------------------------------------------------------ Hebel gegen Verspätung (Engine: orderAdvice().alternatives)
  // Ausführbar ist eine Alternative, wenn die Engine sie für sinnvoll hält (ok) und eine Aktion mitliefert – z. B. „Los teilen“
  // (splitLot), „Expressdurchlauf“ (expressExt), „Überstunden“ (overtime), „verlagern“ (moveOp), „Als Eilauftrag“ (setPriority).
  // Wirkung (gainSec, ggf. Was-wäre-wenn) und Kosten (costEur) kommen aus der Engine; die Ansicht rechnet nichts selbst.
  const LEVER = {
    priority: { ic: 'bolt', t: 'Als Eilauftrag' }, setPriority: { ic: 'bolt', t: 'Als Eilauftrag' },
    moveOp: { ic: 'route', t: 'Arbeitsgang verlagern' }, splitLot: { ic: 'layers', t: 'Los teilen' },
    expressExt: { ic: 'truck', t: 'Expressdurchlauf' }, express: { ic: 'truck', t: 'Expressdurchlauf' },
    overtime: { ic: 'clock', t: 'Überstunden' }, material: { ic: 'box', t: 'Material beschleunigen' },
    partial: { ic: 'box', t: 'Teillieferung' }, planRemake: { ic: 'refresh', t: 'Nachfertigung' },
  };
  const ADV = {};   // orderId → { key, at, adv } – Empfehlung je Planstand (Was-wäre-wenn ist teuer)
  /** Empfehlung der Engine (eine Wahrheit mit Meldung, Leitstand, Copilot) – je Planstand, höchstens alle minGapMs neu */
  function adviceOf(id, v, minGapMs) {
    if (!v || !timeRisk(v) || typeof WF.sim.orderAdvice !== 'function') { delete ADV[id]; return null; }
    // Planstand = Prognose-Objekt der Engine (neu bei jeder Neuberechnung, auch bei angehaltener Simulation nach einem Eingriff)
    const fc = WF.sim.forecast(), key = v.risk, tn = performance.now(), c = ADV[id];
    if (c && ((c.fc === fc && c.key === key) || tn - c.at < (minGapMs == null ? 3000 : minGapMs))) return c.adv;
    let adv = null;
    try { adv = WF.sim.orderAdvice(id); } catch (e) { console.warn('[orderAdvice]', e); adv = null; }
    ADV[id] = { fc, key, at: tn, adv };
    return adv;
  }
  const sameAct = (a, b) => !!(a && b) && JSON.stringify(a) === JSON.stringify(b);
  const num0 = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  /** Ausführbare Hebel: Hauptempfehlung der Engine zuerst, dann nach Zeitgewinn */
  function leversOf(adv) {
    if (!adv) return [];
    const L = (adv.alternatives || []).filter(a => a && a.ok && a.action && a.action.type).map(a => Object.assign({}, a));
    if (adv.action && adv.action.type && !L.some(a => sameAct(a.action, adv.action)))
      L.unshift({ kind: adv.primaryKind || adv.action.type, label: adv.actionLabel || (LEVER[adv.action.type] || {}).t || adv.action.type, ok: true, action: adv.action,
        gainSec: adv.whatIf ? adv.whatIf.gainSec : null, text: adv.whatIf ? adv.whatIf.text : '' });
    for (const a of L) a.primary = sameAct(a.action, adv.action) || (!adv.action && a.kind === adv.primaryKind);
    return L.sort((a, b) => (b.primary - a.primary) || ((num0(b.gainSec) || 0) - (num0(a.gainSec) || 0)));
  }
  /** Was-wäre-wenn-Spezifikation eines Hebels: eigene Angabe der Engine, sonst die Aktion selbst (gleiche Form wie bei setPriority/moveOp) */
  const specOf = (a) => (a.whatIf && a.whatIf.type ? a.whatIf : a.spec && a.spec.type ? a.spec : a.action);
  /** Prognose nach dem Hebel: Angabe der Engine (etaAfter / whatIf.target.after), sonst Prognose − Zeitgewinn */
  function leverEta(v, a) {
    const t = a.whatIf && a.whatIf.target ? a.whatIf.target : null;
    const before = num0(a.etaBefore) ?? (t ? num0(t.before) : null) ?? v.eta;
    const after = num0(a.etaAfter) ?? (t ? num0(t.after) : null) ?? (num0(a.gainSec) != null && before != null ? before - a.gainSec : null);
    return { before, after };
  }
  const leverCost = (a) => num0(a.costEur) ?? num0(a.cost) ?? null;
  const leverDraft = (a) => { const d = a.draft || a.mailText || a.requestText || a.email || null; if (!d) return null; if (typeof d === 'string') return d; return [d.to ? 'An: ' + d.to : '', d.subject ? 'Betreff: ' + d.subject : '', '', d.body || d.text || ''].filter((x, i) => x || i === 2).join('\n').trim(); };
  /** Kurzzeile eines Hebels: „Mi 13:12 statt Do 07:12 · −18 h · Termin hält · ca. 240 €“ */
  function leverMeta(v, a, now) {
    const { before, after } = leverEta(v, a), cost = leverCost(a), out = [];
    if (after != null && before != null && Math.abs(before - after) >= 60) {
      out.push(`<span class="or-lv-eta">fertig ca. <b>${esc(tShort(after, now))}</b> statt ${esc(tShort(before, now))}</span>`);
      out.push(`<span class="or-lv-g ${after < before ? 'up' : 'dn'}">${esc(fmtDelta(after - before))}</span>`);
      out.push(after <= v.due ? `<span class="or-lv-ok">${icon('check', 12)}Termin hält</span>` : `<span class="or-lv-no">noch ${esc(durLong(after - v.due))} zu spät</span>`);
    } else if (num0(a.gainSec) != null && a.gainSec > 60) out.push(`<span class="or-lv-g up">−${esc(durLong(a.gainSec))}</span>`);
    if (cost != null) out.push(`<span class="or-lv-c">${icon('euro', 12)}${cost > 0 ? 'ca. ' + esc(U.fmtEur(cost)) : 'ohne Mehrkosten'}</span>`);
    return out.join('');
  }
  /** Hebel-Liste im Abschnitt „Warum verspätet/knapp“ */
  function leversHtml(v, adv, now) {
    const L = leversOf(adv);
    if (!L.length) return '';
    return `<div class="or-lvs"><span class="or-why-l">Hebel · Wirkung auf den Liefertermin</span>` + L.slice(0, 4).map((a, i) => {
      const meta = LEVER[a.kind] || LEVER[a.action.type] || { ic: 'arrowRight' };
      const title = a.label || meta.t || a.kind;
      const txt = a.text && a.text !== title ? a.text : '';
      return `<div class="or-lv${a.primary ? ' prim' : ''}"><span class="or-lv-ic">${icon(meta.ic || 'arrowRight', 16)}</span>` +
        `<div class="or-lv-b"><div class="or-lv-h"><b>${esc(title)}</b>${a.primary ? '<span class="or-lv-tag">Empfohlen</span>' : ''}</div>` +
        (txt ? `<div class="or-lv-t">${esc(txt)}</div>` : '') + `<div class="or-lv-m">${leverMeta(v, a, now)}</div>${a.note ? `<div class="or-lv-n">${esc(a.note)}</div>` : ''}</div>` +
        `<button type="button" class="btn sm${a.primary ? ' primary' : ''}" data-lever="${i}">Prüfen</button></div>`;
    }).join('') + `</div>`;
  }
  /** Bestätigungsdialog eines Hebels – wie beim Eilauftrag: Liefertermin vorher → nachher der betroffenen Aufträge, Kosten */
  function openLeverModal(id, a) {
    if (!a || !a.action) return;
    if (a.action.type === 'setPriority') { togglePriority(id); return; }
    const s = S(), v = WF.sim.orderView(id); if (!v) return;
    const meta = LEVER[a.kind] || LEVER[a.action.type] || {};
    let wi = null;
    const spec = specOf(a);
    if (spec && spec.type && typeof WF.sim.whatIf === 'function') { try { const r = WF.sim.whatIf(spec); if (r && r.ok !== false && r.target) wi = r; } catch (e) { wi = null; } }
    const body = document.createElement('div'); body.className = 'or-pm';
    let rows = [];
    if (wi) {
      rows = [wi.target].concat(wi.affected || []).filter(Boolean).map(x => ({ id: x.orderId || x.id, before: x.before, after: x.after, risk: x.riskAfter || null }))
        .filter((x, k, arr) => x.id && arr.findIndex(y => y.id === x.id) === k && (x.id === id || Math.abs(x.after - x.before) >= 5 * 60));
      rows.sort((p, q) => (p.id === id ? -1 : q.id === id ? 1 : Math.abs(q.after - q.before) - Math.abs(p.after - p.before)));
    } else {
      const e = leverEta(v, a);
      if (e.before != null) rows = [{ id, before: e.before, after: e.after, risk: null }];
    }
    const late = wi ? (wi.newlyLate || []).concat((wi.laterLate || []).filter(x => !(wi.newlyLate || []).includes(x))) : [];
    const cost = leverCost(a), draft = leverDraft(a);
    let h = `<p class="or-pm-lead"><b>${esc(id)}</b> · ${esc(v.part.name)}: ${esc(a.text || a.label || meta.t || '')}</p>`;
    if (rows.length) h += `<div class="or-pm-h"><span>Liefertermin-Prognose</span><span>vorher → nachher</span></div><div class="or-pm-t">${rows.slice(0, 8).map(x => pmRow(x.id, x.before, x.after, x.id === id, x.risk)).join('')}</div>`;
    if (late.length) h += `<div class="or-pm-w">${icon('alert', 15)}<span>Dadurch ${late.length === 1 ? 'wird' : 'werden'} <b>${late.map(esc).join(', ')}</b> ${(wi.newlyLate || []).length ? 'zu spät' : 'noch später'}.</span></div>`;
    if (cost != null || a.costText) h += `<div class="or-lv-cost">${icon('euro', 15)}<span>${cost === 0 ? '<b>Keine Mehrkosten</b>' : `Mehrkosten ca. <b>${cost != null ? esc(U.fmtEur(cost)) : '–'}</b>`}${a.costText || a.costNote ? ' · ' + esc(a.costText || a.costNote) : ''}</span></div>`;
    if (a.note) h += `<p class="or-pm-n">${esc(a.note)}</p>`;
    if (draft) h += `<div class="or-pm-h"><span>Anfrage an den Partner</span><span>zum Kopieren</span></div><textarea class="input or-lv-draft" readonly spellcheck="false">${esc(draft)}</textarea>`;
    h += `<p class="or-pm-n">${wi ? 'Was-wäre-wenn-Rechnung derselben Planung wie die Plantafel; nach dem Umsetzen bestätigt die nächste Planrechnung die Werte.' : 'Wirkung laut Planung der Engine; nach dem Umsetzen rechnet die Planung neu – die Plantafel zeigt die Auswirkung auf alle Aufträge.'}</p>`;
    body.innerHTML = h;
    const acts = [{ label: 'Abbrechen' }];
    if (draft) acts.push({ label: 'Text kopieren', icon: 'file', onClick: () => {
      const ta = body.querySelector('textarea'), ok = () => WF.app.toast('Anfragetext in die Zwischenablage kopiert', 'ok');
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, () => { ta.select(); document.execCommand('copy'); ok(); }); else { ta.select(); document.execCommand('copy'); ok(); } } catch (e) { ta.select(); }
      return false;
    } });
    acts.push({ label: a.actionLabel || a.label || meta.t || 'Umsetzen', primary: true, onClick: () => applyLever(id, a) });
    WF.app.modal({ title: (a.label || meta.t || 'Hebel') + ' · ' + id, body, width: 620, actions: acts });
  }
  function applyLever(id, a) {
    const r = WF.app.runAction(a.action);   // Bestätigung bzw. Ablehnungsgrund als Meldung (App)
    delete ADV[id];
    if (r && r.ok === false) return;
    update();
  }

  /** Zeile der senkrechten Schrittfolge im Drawer. Erledigte und noch nicht begonnene Schritte einzeilig,
      laufende/wartende/externe ausführlich mit Mengen; zufließende Behälter als Materialfluss-Hinweis über dem Schritt. */
  function opRowHtml(op, v, now, ctx) {
    const vis = opVis(op);
    const isMachine = !!(S().machines[op.station]);
    const lim = ctx && ctx.lim;
    const isLim = !!(lim && lim.seq === op.seq && op.state !== 'done');
    const kBadge = isLim ? `<span class="or-op-k${lim.plant ? ' plant' : ''}" title="${esc(lim.text)}">${lim.plant ? 'Engpass' : 'Kritisch'}</span>` : '';
    const noParts = op.state === 'open' && !op.received && !op.good && !(op.ext && (op.ext.sentQty || op.ext.waitingPickupQty));
    const compact = op.state === 'done' || noParts;
    const where = op.station === 'EXT' ? (op.ext ? esc(op.ext.partner) : 'Fremdbearbeitung') : op.station === 'VERSAND' ? 'Fertigteillager &amp; Versand'
      : isMachine ? `<button class="link" data-ent="machine|${esc(op.station)}">${esc(op.stationName)} (${esc(op.station)})</button>` : esc(op.stationName);
    // Materialfluss in diesen Schritt (Behälter unterwegs / abholbereit beim Vorgänger)
    let inflow = '';
    if (ctx && op.state !== 'done') {
      const tr = ctx.transit[op.seq], rd = ctx.ready[ctx.prevSeq];
      if (tr && tr.length) inflow = `<div class="or-op-in">${icon('truck', 13)}<span>${nf(tr.length)} ${tr.length === 1 ? 'Behälter' : 'Behälter'} mit ${nf(tr.reduce((a, c) => a + c.qty, 0))} Stk unterwegs hierher</span></div>`;
      else if (rd && rd.length) inflow = `<div class="or-op-in rdy">${icon('box', 13)}<span>${nf(rd.reduce((a, c) => a + c.qty, 0))} Stk abholbereit beim Vorgänger</span></div>`;
    }
    if (compact) {
      let right = '';
      const meta = [where];
      if (op.state === 'done') {
        right = op.endT != null && op.endT <= simStartT() ? 'vor ' + U.fmtDayClock(simStartT()) : op.endT != null ? 'fertig ' + tShort(op.endT, now) : 'fertig';
        if (op.station === 'VERSAND') meta.push(nf(op.good) + ' Stk versandt');
        else if (op.station !== 'EXT') { meta.push(nf(op.good) + ' gut'); if (op.scrap) meta.push(`<span style="color:var(--st-fault)">${nf(op.scrap)} Ausschuss</span>`); }
        else if (op.ext) meta.push(esc(op.ext.process));
        if (op.startT != null && op.endT != null && op.startT > simStartT()) meta.push('Durchlauf ' + esc(U.fmtDur(op.endT - op.startT)));
      } else {
        right = op.station === 'VERSAND' ? (v.eta != null ? 'ca. ' + tShort(v.eta, now) : '') : op.plannedStart != null ? 'ab ca. ' + tShort(op.plannedStart, now) : 'offen';
        if (op.station === 'EXT' && op.ext) { meta.push(esc(op.ext.process)); meta.push('Durchlauf ca. ' + U.fmtDur((op.ext.leadMin || 0) * 60)); }
        else if (op.station !== 'VERSAND') {
          if (op.setupMin) meta.push('Rüsten ' + nf(op.setupMin) + ' min');
          if (op.cycleMin) meta.push(U.fmtNum(op.cycleMin, op.cycleMin < 1 ? 2 : op.cycleMin < 10 ? 1 : 0) + ' min/Stk');
          if (op.plannedEnd != null) meta.push('fertig ca. ' + esc(tShort(op.plannedEnd, now)));
        }
      }
      return `<div class="or-op-rail"><span class="or-op-node">${vis.k === 'done' ? icon('check', 11) : ''}</span></div>
        <div class="or-op-b">${inflow}
          <div class="or-op-h"><em>AG ${op.seq}</em><b title="${esc(op.op)}">${esc(op.op)}</b>${kBadge}<span class="or-op-r">${esc(right)}</span></div>
          <div class="or-op-m">${meta.join(' · ')}</div>
        </div>`;
    }
    let pill;
    if (op.state === 'active') pill = WF.ui.pill(op.machineState);
    else pill = `<span class="pill" style="--c:${vis.c}"><i></i>${esc(vis.label)}</span>`;
    const meta = [where];
    if (op.station === 'EXT') {
      if (op.ext) { meta.push(esc(op.ext.process)); meta.push('Durchlauf ca. ' + U.fmtDur((op.ext.leadMin || 0) * 60)); meta.push('Los ' + nf(op.ext.lotQty) + ' Stk'); }
    } else if (op.station !== 'VERSAND') {
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
      bar = WF.ui.bar((op.targetIn ? e.returnedQty / op.targetIn : 0), { thin: true, color: op.complete ? 'var(--st-run)' : 'var(--ext)' });
    } else if (op.station === 'VERSAND') {
      q = `<div class="or-op-q" style="grid-template-columns:repeat(2,minmax(0,1fr))">${cell('Versandt', op.good, null, '/ ' + nf(v.qty))}${cell('Offen', Math.max(0, v.qty - op.good))}</div>`;
      bar = WF.ui.bar(v.qty ? op.good / v.qty : 0, { thin: true, color: 'var(--st-run)' });
    } else {
      const extra = op.inProc > 0 ? ` <small>+${nf(op.inProc)} in Bearb.</small>` : '';
      q = `<div class="or-op-q">${cell('Eingang', op.received)}<div class="${op.good ? '' : 'z'}"><span>Gut</span><b>${nf(op.good)}<small>/ ${nf(op.target)}</small></b></div>${cell('Ausschuss', op.scrap, op.scrap ? 'bad' : 'z')}<div class="${op.waiting || op.inProc ? '' : 'z'}"><span>Wartet</span><b>${nf(op.waiting)}${extra}</b></div></div>`;
      bar = WF.ui.bar(op.target ? op.good / op.target : 0, { thin: true, color: op.complete ? 'var(--st-run)' : vis.k === 'active' ? vis.c : 'var(--st-idle)' });
    }
    const times = [];
    if (op.station === 'EXT' && op.ext) {
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
    return `<div class="or-op-rail"><span class="or-op-node">${vis.k === 'ext' ? icon('truck', 10) : ''}</span></div>
      <div class="or-op-b">${inflow}
        <div class="or-op-h"><em>AG ${op.seq}</em><b title="${esc(op.op)}">${esc(op.op)}</b>${kBadge}${pill}</div>
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
    const pg = progOf(v);
    const top = `<div class="or-hero-top"><span class="or-rb" style="--c:${rb.c}"><i></i>${esc(rb.label)}</span><span class="or-hero-slack">${esc(slackText(v))}</span><span class="spacer" style="flex:1"></span>${v.priority === 'eil' ? `<span class="or-tag eil">${icon('bolt', 11)}Eilauftrag</span>` : ''}${v.status === 'freigegeben' ? '<span class="or-tag rel">Freigegeben</span>' : ''}${(() => { const t = srcTag(v); return t ? `<span class="or-tag src" title="${esc(t.title)}">${esc(t.label)}</span>` : ''; })()}</div>`;
    const pend = pendingEta(v);
    // ein Terminformat für Karte und Drawer (dueShort): „morgen 16:00“, „nächsten Mo 12:00“
    const d = `<div class="or-hero-d">
      <div><span class="eyebrow">Liefertermin</span><b title="${esc(fmtDue(v.due, now))}">${esc(dueShort(v.due, now))}</b><small>${esc(v.status === 'fertig' ? U.fmtDayClock(v.due) : v.due >= now ? 'in ' + durLong(v.due - now) : 'seit ' + durLong(now - v.due) + ' überschritten')}</small></div>
      <div><span class="eyebrow">${v.status === 'fertig' ? 'Fertig' : 'Prognose fertig'}</span><b>${esc(v.status === 'fertig' ? dueShort(v.doneT, now) : dueShort(v.eta, now))}</b><small>${pend != null ? `<span class="pd ${pend > v.eta ? 'dn' : 'up'}">${icon('refresh', 11)}neu ${esc(tShort(pend, now))} – wird geprüft</span>` : v.status === 'fertig' ? (v.onTime ? 'termingerecht und vollständig' : 'nicht termingerecht') : 'aus Live-Daten, inkl. Fremdbearbeitung'}</small></div>
      <div title="${esc(pg.title)}"><span class="eyebrow">${v.status === 'fertig' ? 'Versandt' : 'Fertig bearbeitet'}</span><b>${nf(pg.n)}/${nf(v.qty)} Stk</b><small>${pg.sub}</small></div>
    </div>`;
    const bar = `<span class="or-pbar" title="${esc(pg.title)}"><i class="w" style="width:${(pg.work * 100).toFixed(1)}%"></i><i style="width:${(U.clamp(pg.frac, 0, 1) * 100).toFixed(1)}%"></i></span>`;
    const nl = nowLine(v, now);
    let notes = nl.parts ? nl.parts.map(p => `<div class="or-hero-n or-hero-a"><span>${p}</span></div>`).join('')
      : `<div class="or-hero-n ${nl.cls}">${icon(nl.ic || 'arrowRight', 15)}<span>${nl.html}</span></div>`;
    // begrenzender Schritt: bei gefährdetem Termin erklärt „Warum spät/knapp“ darunter ausführlich
    const lim = v.status !== 'fertig' && !atRisk(v) ? limitOf(v) : null;
    if (lim) notes += `<div class="or-hero-n">${icon('gauge', 15)}<span>Durchlauf ${lim.plant ? 'begrenzt durch den <b>Werks-Engpass ' + esc(lim.name) + '</b>' : 'begrenzt durch <b>' + esc(lim.name) + '</b>'}${lim.seq != null ? ' (AG ' + lim.seq + ')' : ''}${!v.limit && f.bottleneckSec ? ' – längster Arbeitsgang mit ca. ' + esc(durLong(f.bottleneckSec)) + ' Durchlauf' : ''}</span></div>`;
    return `<div class="or-hero" style="--rc:${rb.c}">${top}${d}${bar}${notes}</div>`;
  }
  // ------------------------------------------------------------------ „Warum spät / knapp“ (Engine: delayBreakdown, orderAdvice)
  const DELAY_IC = { queue: 'clock', ext: 'truck', noShift: 'pause', fault: 'alert', tool: 'wrench', material: 'box', process: 'settings' };
  function delayLabel(e, v) {
    // Engine-Text ohne Dauer-Klammer: „Warten an M09 Studer S33“, „Einsatzhärten 58–62 HRC bei Härterei Wolf“
    let t = String(e.text || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
    if (!t) {
      const st = e.stationId, op = v.ops.find(o => o.seq === e.seq);
      const stN = st === 'EXT' ? (op && op.ext ? op.ext.partner : 'Fremdbearbeitung') : (op ? op.stationName : st);
      t = ({ queue: 'Warten an ', ext: 'Fremdbearbeitung bei ', noShift: 'Außerhalb der Schicht an ', fault: 'Störung an ', tool: 'Werkzeugwechsel an ', material: 'Material fehlt an ' }[e.kind] || 'Bearbeitung ') + stN;
    }
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function whyHtml(v, adv, now) {
    const db = Array.isArray(v.delayBreakdown) ? v.delayBreakdown.filter(e => e && e.sec > 0) : [];
    const late = v.risk === 'spät';
    const cause = (adv && adv.cause) || v.delayCause || (limitOf(v) || {}).text || '';
    let h = cause ? `<div class="or-why-c"><span class="or-why-l">Ursache</span><b>${esc(cause)}</b></div>` : '';
    if (db.length) {
      // Reihenfolge wie die Ursache der Engine: echte Verzögerungen (Warten, Fremdbearbeitung, Störung, Werkzeug, Material)
      // zuerst, Zeiten außerhalb der Schicht danach; reine Bearbeitung nur, wenn sonst nichts bremst
      const CAUSE = { queue: 1, ext: 1, fault: 1, tool: 1, material: 1 };
      const byS = (a, b) => b.sec - a.sec;
      const main = db.filter(e => CAUSE[e.kind]).sort(byS), shift = db.filter(e => e.kind === 'noShift').sort(byS);
      let list = main.concat(shift);
      if (!list.length) list = db.slice().sort(byS);
      list = list.slice(0, 4);
      const L = v.limit, isLim = (e) => !!(L && e.kind === L.kind && e.stationId === L.stationId && e.seq === L.seq);
      const hi = list.some(isLim) ? list.findIndex(isLim) : (main.length ? 0 : -1);
      const max = Math.max(1, ...list.map(e => e.sec));
      const total = db.reduce((a, e) => a + e.sec, 0), proc = db.filter(e => e.kind === 'process').reduce((a, e) => a + e.sec, 0);
      h += `<div class="or-why-bars"><span class="or-why-l">Größte Verzögerungen bis zur Fertigstellung</span>` + list.map((e, i) => {
        const blk = (e.blockingOrders || []).filter(Boolean);
        return `<div class="or-wb${i === hi ? ' hi' : ''}${e.kind === 'noShift' ? ' ns' : ''}" title="${esc(e.text || '')}"><span class="or-wb-l">${icon(DELAY_IC[e.kind] || 'dot', 14)}<span>${esc(delayLabel(e, v))}</span></span>` +
          `<span class="or-wb-b"><i style="width:${(e.sec / max * 100).toFixed(1)}%"></i></span><span class="or-wb-v">${esc(durLong(e.sec))}</span>` +
          (blk.length ? `<span class="or-wb-o">hinter ${blk.slice(0, 4).map(x => `<button type="button" class="link" data-ent="order|${esc(x)}">${esc(x)}</button>`).join(', ')}${blk.length > 4 ? ' …' : ''}</span>` : '') + '</div>';
      }).join('') + `</div>` +
        (total > 0 ? `<div class="or-pm-n">Bis zur Fertigstellung noch ca. <b>${esc(durLong(total))}</b> – davon ${esc(durLong(proc))} Bearbeitung, ${esc(durLong(Math.max(0, total - proc)))} Warte-, Liege- und Fremdzeiten.</div>` : '');
    }
    if (adv) {
      const m = /Empfehlung:\s*(.+?)\.?\s*$/.exec(adv.text || '');
      const rec = m ? m[1] : null;
      if (rec) h += `<div class="or-why-rec">${icon('arrowRight', 14)}<span><b>Empfehlung:</b> ${esc(rec)}</span></div>`;
      // ausführbare Hebel mit Wirkung und Kosten; übrige Optionen (ohne Aktion) als Liste, nicht sinnvolle durchgestrichen erklärt
      h += leversHtml(v, adv, now);
      const lv = leversOf(adv);
      const alts = (adv.alternatives || []).filter(a => a && !lv.some(x => sameAct(x.action, a.action) && a.action) && !(a.kind === adv.primaryKind && !a.action && rec));
      if (alts.length) {
        h += `<ul class="or-why-opts">` + alts.slice(0, 4).map(a => a.ok
          ? `<li>${icon('check', 14)}<span>${esc(a.text || a.label)}${a.gainSec > 60 && !/\(−/.test(a.text || '') ? ` <b>(−${esc(durLong(a.gainSec))})</b>` : ''}${leverCost(a) > 0 ? ` · ca. ${esc(U.fmtEur(leverCost(a)))}` : ''}</span></li>`
          : `<li class="no">${icon('x', 14)}<span>${esc(a.note || a.text || a.label)}</span></li>`).join('') + `</ul>`;
      }
    }
    return h ? `<div class="or-why" style="--rc:${late ? 'var(--st-fault)' : 'var(--st-wait)'}">${h}</div>` : '';
  }
  /** Menge gefährdet: Ursache (Ausschuss nach AG 1 ohne Nachfertigung) und der eine Hebel – Nachfertigung einplanen (Engine: planRemake) */
  function qtyWhyHtml(v, qs, now) {
    const op1 = v.ops[0] || {};
    const nt = orderNotifs(v.id).find(n => /^qty:/.test(n.key || ''));
    const na = nt && (nt.actions || []).find(x => x.action && x.action.type === 'planRemake');
    const lbl = na ? na.label : `Nachfertigung ${nf(qs.missing)} Stk einplanen`;
    return `<div class="or-why" style="--rc:var(--st-wait)">
      <div class="or-why-c"><span class="or-why-l">Ursache</span><b>${esc(qs.text || `nur ${nf(qs.expectedQty)}/${nf(qs.qty)} Stk – Ausschuss nach AG ${op1.seq}, keine Nachfertigung eingeplant`)}</b></div>
      <div class="or-lvs"><span class="or-why-l">Hebel · Menge sichern</span>
        <div class="or-lv prim"><span class="or-lv-ic">${icon('refresh', 16)}</span><div class="or-lv-b"><div class="or-lv-h"><b>Nachfertigung einplanen</b><span class="or-lv-tag">Empfohlen</span></div>
          <div class="or-lv-t">Neuer Eilauftrag über ${nf(qs.missing)} Stk mit gleichem Arbeitsplan ab ${esc(op1.stationName || op1.station || '')} (AG ${esc(op1.seq)}), Termin wie ${esc(v.id)}.</div>
          <div class="or-lv-m"><span class="or-lv-ok">${icon('check', 12)}dann ${nf(qs.qty)}/${nf(qs.qty)} Stk lieferbar</span><span>sonst nur ${nf(qs.expectedQty)}/${nf(qs.qty)} Stk</span></div></div>
          <button type="button" class="btn sm primary" data-qact="remake" title="${esc(lbl)}">Einplanen</button></div></div></div>`;
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
    if (v.source && v.source !== 'profil') f.push(['Auftragsquelle', v.source === 'ERP' ? 'Auftragseingang (ERP)' : v.source]);
    if (v.remakeOf) f.push(['Nachfertigung für', v.remakeOf]);
    if (v.remakes && v.remakes.length) f.push(['Nachfertigung', v.remakes.join(', ')]);
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
    return parts.map(x => `<span>${x}</span>`).join('');
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
    const st = { evAll: false, adv: null };
    const subtitle = `<span class="or-d-sub"><span>${esc(v0.customer)}</span><span class="faint">·</span><span>${esc(v0.sector || '')}</span><span class="faint">·</span><span class="mono">${esc(v0.part.no || '')}</span></span>`;
    let N = null;
    /** Empfehlung der Engine (eine Wahrheit mit Meldung, Leitstand, Copilot) – je Planstand, höchstens alle 3 s (Was-wäre-wenn ist teuer) */
    function advice(v) { st.adv = adviceOf(id, v, 3000); return st.adv; }
    function render(el) {
      el.innerHTML = `
        <section data-n="hero"></section>
        <section class="or-sec" data-n="whySec" hidden><h4><span data-n="whyT">Warum verspätet</span></h4><div data-n="why"></div></section>
        <section class="or-sec" data-n="ntSec" hidden><h4><span>Meldungen zu diesem Auftrag</span></h4><div class="or-nts" data-n="nts"></div></section>
        <section class="or-sec"><div class="or-acts" data-n="acts"></div></section>
        <section class="or-sec"><h4><span>Arbeitsplan</span><span class="spacer"></span><small data-n="opsSub"></small></h4><div class="or-ops" data-n="ops"></div></section>
        <section class="or-sec"><h4><span>Wo ist das Material?</span><span class="spacer"></span><small data-n="matSub"></small></h4><div class="or-mat" data-n="mat"></div><div class="or-msum" data-n="msum"></div></section>
        <section class="or-sec"><h4><span>Auftragsdaten</span></h4><div data-n="facts"></div></section>
        <section class="or-sec"><h4><span>Ereignisse</span><span class="spacer"></span><small data-n="evSub"></small></h4><div data-n="ev"></div><button type="button" class="btn sm ghost or-more" data-n="evMore" hidden></button></section>`;
      N = {}; el.querySelectorAll('[data-n]').forEach(n => { N[n.dataset.n] = n; });
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
      const lb = e.target.closest('[data-lever]');
      if (lb && st.adv) { const L = leversOf(st.adv)[Number(lb.dataset.lever)]; if (L) openLeverModal(id, L); return; }
      const qb = e.target.closest('[data-qact]');
      if (qb) { const r = WF.app.runAction({ type: 'planRemake', orderId: id }); if (r && r.ok !== false) { N.why._h = null; update(); } return; }
      const ent = e.target.closest('[data-ent]');
      if (ent) { const [k, i] = ent.dataset.ent.split('|'); WF.app.select(k, i); return; }
      const act = e.target.closest('[data-act]'); if (!act || act.disabled) return;
      switch (act.dataset.act) {
        case 'prio': togglePriority(id); break;
        case 'move': openMoveModal(id); break;
        case 'hall':
          if (!hasView('halle')) { WF.app.toast('Die Ansicht Halle 3D ist in dieser Ausgabe nicht verfügbar', 'warn'); break; }
          // Schmale Bildschirme: der Drawer deckt die Halle ganz zu – ausblenden, Auswahl (Route in der Halle) bleibt
          if (window.matchMedia('(max-width: 900px)').matches && typeof WF.app.hideDrawer === 'function') WF.app.hideDrawer();
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
      // Warum spät / knapp / Menge gefährdet – mit Hebeln
      const adv = advice(v);
      const qs = qtyShort(v);
      const whyT = atRisk(v) ? whyHtml(v, adv, now) : '', whyQ = qs ? qtyWhyHtml(v, qs, now) : '';
      const why = whyT + whyQ;
      setHidden(N.whySec, !why);
      setText(N.whyT, whyT ? (v.risk === 'spät' ? 'Warum verspätet' : 'Warum knapp') : 'Warum Menge gefährdet');
      setHTML(N.why, why ? `<div class="or-whys">${why}</div>` : '');
      const nts = orderNotifs(id, false);
      setHidden(N.ntSec, !nts.length);
      setHTML(N.nts, nts.map(n => {
        const sv = WF.SEV[n.sev] || WF.SEV.info;
        // Terminmeldung: Empfehlung und Aktion stehen schon unter „Warum …“ – hier nicht doppelt
        const dup = (!!whyT && /^late:/.test(n.key || '')) || (!!whyQ && /^qty:/.test(n.key || ''));
        const acts = dup ? [] : (n.actions || []).map((a, i) => ({ a, i })).filter(x => !(x.a.action && x.a.action.type === 'select' && x.a.action.id === id));
        return `<div class="or-nt${n.status === 'ack' ? ' ack' : ''}" style="--c:${sv.color}">
          <div class="or-nt-h"><span>${WF.ui.notifTime ? WF.ui.notifTime(n) : esc(tShort(n.t, now))} · ${esc(n.role || '')}</span>${n.status === 'ack' ? `<span>quittiert${n.ackBy ? ' von ' + esc(n.ackBy) : ''}</span>` : `<span class="or-nt-sev">${esc(sv.label)}</span>`}</div>
          <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}${n.suggestion && !dup ? `<div class="or-nt-s"><b>Empfehlung:</b> ${esc(n.suggestion)}</div>` : ''}
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
      // senkrechte Schrittfolge (bricht nie um): Materialfluss zwischen den Schritten als Hinweis am Folgeschritt
      const transit = {}, ready = {};
      for (const ct of v.containers) {
        if (ct.state === 'transit' && ct.seq != null) (transit[ct.seq] = transit[ct.seq] || []).push(ct);
        else if (ct.state === 'ready' && ct.srcSeq != null) (ready[ct.srcSeq] = ready[ct.srcSeq] || []).push(ct);
      }
      const lim = !fin ? limitOf(v) : null;
      const cur = v.ops.find(o => o.state === 'active' || o.state === 'external' || o.state === 'waiting');
      patchKeyed(N.ops, v.ops.map((op, i) => {
        const vis = opVis(op);
        const ctx = { lim: atRisk(v) ? lim : null, transit, ready, prevSeq: i > 0 ? v.ops[i - 1].seq : null };
        const cmp = op.state === 'done' || (op.state === 'open' && !op.received && !op.good && !(op.ext && (op.ext.sentQty || op.ext.waitingPickupQty)));
        return { k: 'op' + op.seq, cls: 'or-op s-' + vis.k + (cmp ? ' cmp' : '') + (cur && cur.seq === op.seq ? ' cur' : ''), style: '--c:' + vis.c, html: opRowHtml(op, v, now, ctx) };
      }));
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
      askPrompt: `Gib mir eine kurze Lageeinschätzung zu Auftrag ${id} (${v0.part.name}, ${v0.qty} Stk für ${v0.customer}): Wo steht er gerade, hält der Liefertermin ${U.fmtDayClock(v0.due)}, was begrenzt den Durchlauf, und was empfiehlst du (Priorität, Verlagerung, Fremdbearbeitung)?`,
    };
  });
})();
