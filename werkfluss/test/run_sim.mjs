// Schneller Node-Läufer für die Simulations-Engine: lädt 00_core, 05_profile, 10_sim,
// rechnet 36 Sim-Stunden und gibt eine Zusammenfassung aus (Aufträge, KPIs, Ereignisse, Invarianten).
// Aufruf: node werkfluss/test/run_sim.mjs [stunden]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');
globalThis.window = undefined;
for (const f of ['00_core.js', '05_profile.js', '10_sim.js']) {
  const file = path.join(src, f);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
const WF = globalThis.WF;
const U = WF.util;
const HOURS = Number(process.argv[2] || 36);
const errors = [];
const viol = {};
const v = (k, msg) => { viol[k] = (viol[k] || 0) + 1; if (viol[k] <= 3) errors.push(`[${U.fmtDayClock(WF.sim.state.t)}] ${k}: ${msg}`); };

let t0 = performance.now();
WF.sim.init(WF.profile);
const warmMs = performance.now() - t0;
const S = WF.sim.state;

function checkInvariants() {
  const S = WF.sim.state;
  for (const id in S.tools) { const tl = S.tools[id]; if (tl.used < -1e-9 || tl.used > tl.life + 1e-9) v('tool-range', `${id} used ${tl.used} life ${tl.life}`); }
  for (const id in S.machines) {
    const m = S.machines[id];
    if (m.state === 'running') {
      if (!m.op) v('run-no-op', id);
      else if (!m.part && !(m.dressRem > 0)) v('run-no-part', id);
    }
    if (m.part && m.part.sub === 'cut' && m.op) {
      // Werkzeuge müssen beim Start gereicht haben: Reststandzeit (vor Buchung) >= Bedarf
      const o = S.orders[m.op.oid], r = o.routing[m.op.idx];
      for (const tid of m.tools) { const tl = S.tools[tid]; const c = (r.tools || []).find(t => t.type === tl.typeId); if (c && !tl.broken && tl.life - tl.used + 1e-9 < c.cutMinPerPart) v('cut-insufficient', `${id} ${tl.typeId}`); }
    }
  }
  for (const id in S.materials) if (S.materials[id].onHand < -1e-9) v('stock-neg', id);
  for (const id in S.agvs) { const a = S.agvs[id]; if (a.battery < 0 || a.battery > 100) v('battery', id); if (a.load) { const c = S.containers[a.load]; if (c && c.weightKg > a.maxKg) v('agv-overload', id); } }
  const tasksPer = {};
  for (const id in S.people) { const p = S.people[id]; if (p.task) { tasksPer[p.id] = (tasksPer[p.id] || 0) + 1; if (p.state === 'offShift') v('offshift-task', p.id); } }
  for (const id in S.tasks) { const tk = S.tasks[id]; if (tk.assignee && S.people[tk.assignee].task !== tk) v('task-assignee', id + ' ' + tk.type + ' ' + tk.assignee); }
  // Mengenbilanz
  for (const oid in S.orders) {
    const o = S.orders[oid];
    const waiting = {}, out = {}, transit = {};
    for (const cid in S.containers) {
      const c = S.containers[cid]; if (c.orderId !== oid) continue;
      if (c.state === 'input' || (c.state === 'shipped')) waiting[c.idx] = (waiting[c.idx] || 0) + (c.state === 'input' ? c.qty : 0);
      if ((c.state === 'filling' || c.state === 'ready') && !c.relocate) { if (c.src >= 0) out[c.src] = (out[c.src] || 0) + c.qty; }
      if (c.state === 'ready' && c.relocate) waiting[c.idx] = (waiting[c.idx] || 0);
      if (c.state === 'transit' && c.src >= 0 && !c.relocate) transit[c.src] = (transit[c.src] || 0) + c.qty;
    }
    o.ops.forEach((op, i) => {
      const r = o.routing[i];
      if (r.station === 'VERSAND') return;
      const w = waiting[i] || 0;
      if (op.received !== op.good + op.scrap + op.inProc + w) v('balance-recv', `${oid} AG${r.seq}: recv ${op.received} != good ${op.good}+scrap ${op.scrap}+inProc ${op.inProc}+wait ${w}`);
      if (op.good !== op.passed + (out[i] || 0)) v('balance-good', `${oid} AG${r.seq}: good ${op.good} != passed ${op.passed} + out ${out[i] || 0}`);
      if (i + 1 < o.ops.length && op.passed !== o.ops[i + 1].received + (transit[i] || 0)) v('balance-pass', `${oid} AG${r.seq}: passed ${op.passed} != next recv ${o.ops[i + 1].received} + transit ${transit[i] || 0}`);
    });
  }
}
const stuckOp = {};
t0 = performance.now();
let lastT = S.t, stepMs = [];
for (let h = 0; h < HOURS; h++) {
  const a = performance.now();
  for (let k = 0; k < 60; k++) {
    try { WF.sim.advance(60); } catch (e) { errors.push('EXCEPTION ' + (e && e.stack || e)); break; }
    if (WF.sim.state.t <= lastT) v('time', 'not monotonic'); lastT = WF.sim.state.t;
    checkInvariants();
    const sh = WF.sim.shift();
    for (const id in S.machines) { const m = S.machines[id]; if (m.state === 'waitOperator' && sh.id && !sh.inBreak) stuckOp[id] = (stuckOp[id] || 0) + 60; else stuckOp[id] = 0; if (stuckOp[id] > 4 * 3600) v('waitOperator>4h', id); }
  }
  stepMs.push(performance.now() - a);
  if (errors.some(e => e.startsWith('EXCEPTION'))) break;
}
const runMs = performance.now() - t0;

// ---------------------------------------------------------------- Ausgabe
const k = WF.sim.kpis();
console.log(`\n=== werkfluss Sim: Warmup ${warmMs.toFixed(0)} ms, ${HOURS} h in ${runMs.toFixed(0)} ms (max ${Math.max(...stepMs).toFixed(0)} ms/h) → ${WF.sim.clock()} ===`);
console.log('KPIs heute:', JSON.stringify({ oee: +k.oee.toFixed(3), A: +k.availability.toFixed(3), P: +k.performance.toFixed(3), Q: +k.quality.toFixed(3), good: k.good, scrap: k.scrap, scrapBy: k.scrapBy, onTime: +k.onTimePct.toFixed(2), lossEur: k.lossEur, kWh: k.energyKwh, kW: k.powerKw, wip: k.wip, transports: k.transportsToday, toolCost: k.toolCostToday }));
console.log('\nAufträge:');
for (const id in S.orders) {
  const o = S.orders[id], ov = WF.sim.orderView(id);
  console.log(`  ${id} ${o.status.padEnd(11)} ${String(o.shippedQty).padStart(4)}/${String(o.qty).padEnd(4)} prio ${o.priority.padEnd(6)} Termin ${U.fmtDayClock(o.due)}  ${o.doneT ? 'fertig ' + U.fmtDayClock(o.doneT) : 'ETA ' + (ov.eta ? U.fmtDayClock(ov.eta) : '–')}  ` +
    ov.ops.map(x => `${x.seq}:${x.station}[${x.good}${x.scrap ? '/-' + x.scrap : ''}${x.waiting ? ' w' + x.waiting : ''}${x.state === 'active' ? '*' : ''}]`).join(' '));
}
console.log('\nMaschinen:');
for (const id in S.machines) {
  const mv = WF.sim.machineView(id);
  const st = mv.stateTimes, tot = Object.values(st).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(st).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, x]) => `${s} ${Math.round(x / tot * 100)}%`).join(', ');
  console.log(`  ${id.padEnd(4)} ${mv.state.padEnd(12)} OEE ${(mv.oeeToday.oee * 100).toFixed(0).padStart(3)}%  gut ${String(mv.goodToday).padStart(4)}  ${mv.order ? mv.order.id + '/' + mv.order.seq : '–'.padEnd(11)}  [${top}]  ${mv.cause.slice(0, 80)}`);
  for (const tl of mv.tools.filter(x => x.status !== 'idle')) console.log(`        ${tl.typeId.padEnd(9)} ${String(tl.wearPct).padStart(5)}% rest ${String(tl.remainingParts).padStart(3)} ${tl.plannedChange ? 'Wechsel nach Teil ' + tl.plannedChange.afterPart + ' ca. ' + U.fmtClock(tl.plannedChange.etaT) : ''}`);
}
console.log('\nPersonen:');
for (const id in S.people) { const p = S.people[id]; if (p.state !== 'offShift') console.log(`  ${id} ${p.name.padEnd(18)} ${p.state.padEnd(8)} Ausl. ${(p.utilToday * 100).toFixed(0)}%  ${p.activity}`); }
for (const id in S.agvs) { const a = S.agvs[id]; console.log(`  ${a.id} ${a.state.padEnd(10)} Akku ${a.battery.toFixed(0)}%  Transporte heute ${a.transportsToday}  ${a.load || ''}`); }
const evc = {}; for (const e of S.events) evc[e.type] = (evc[e.type] || 0) + 1;
console.log('\nEvents (Ringpuffer', S.events.length + '):', JSON.stringify(evc));
const allTypes = {}; WF.bus.on('sim:event', () => {});
const nOpen = S.notifications.filter(n => n.status !== 'resolved');
console.log('Benachrichtigungen offen:', nOpen.length, '/ gesamt', S.notifications.length);
for (const n of nOpen.slice(0, 14)) console.log(`  [${n.sev}] ${n.title} — ${n.body.slice(0, 110)}`);
console.log('\nMaterial:', Object.values(S.materials).map(m => `${m.id} ${m.onHand.toFixed(1)}${m.onOrder ? '+' + m.onOrder : ''}`).join(' | '));
console.log('Werkzeugausgabe:', Object.entries(S.toolStock).filter(([, x]) => x.regrind || x.scrapToday).map(([k2, x]) => `${k2} r${x.ready}/n${x.regrind}/s${x.scrapToday}`).join(' '));
const snap = JSON.stringify(WF.sim.snapshot());
console.log('Snapshot', (snap.length / 1024).toFixed(1), 'kB');
// Leistung: 1 Sim-Stunde
t0 = performance.now(); WF.sim.advance(3600); const hMs = performance.now() - t0;
console.log(`1 Sim-Stunde: ${hMs.toFixed(0)} ms`);
// Determinismus
const hash = () => U.hash(JSON.stringify({ t: WF.sim.state.t, m: Object.values(WF.sim.state.machines).map(m => [m.state, m.counter, m.tools.map(id => WF.sim.state.tools[id].used)]), o: Object.values(WF.sim.state.orders).map(o => o.ops.map(x => [x.good, x.scrap])), p: Object.values(WF.sim.state.people).map(p => [p.pos.x.toFixed(3), p.state]) }));
WF.sim.init(WF.profile); WF.sim.advance(3600); const h1 = hash();
WF.sim.init(WF.profile); WF.sim.advance(3600); const h2 = hash();
console.log('Determinismus:', h1 === h2 ? 'ok (' + h1 + ')' : 'FEHLER ' + h1 + ' != ' + h2);
console.log('\nVerletzungen:', JSON.stringify(viol));
if (errors.length) { console.log('Fehler:'); for (const e of errors.slice(0, 30)) console.log('  ' + e); }
else console.log('Keine Fehler.');
