# werkfluss – Engine API (`WF.sim`, src/10_sim.js)

Binding field list for all view modules (UI_GUIDE.md rule 1). Views only **read** `WF.sim.state` and the derived
views below; every change goes through `WF.sim.actions.*` (or `WF.sim.runAction(notification.actions[i].action)`).
All times are **sim seconds since Monday 00:00** (format with `WF.util.fmtClock / fmtDayClock / fmtDur / fmtDue`).
`null` always means "not known / not applicable" – render `–`, never `0`.

German labels for every enum shown in the UI: `WF.sim.LABELS` (see end) or `WF.sim.label(group, key)`;
machine states: `WF.STATE[key].label`, severities: `WF.SEV[key].label`.

---------------------------------------------------------------------------------------------------------------

## 1. Functions

| Function | Returns |
|---|---|
| `init(profile?)` | rebuilds the state deterministically (seed), pre-computes to `profile.sim.warmupUntilT` (Mo 08:40), emits `sim:reset`; returns `state` |
| `reset()` | = `actions.reset()` |
| `advance(simSeconds)` | runs 1-s sub-steps (max 3600 per call, fractions accumulate); returns number of steps |
| `step()` | exactly one 1-s step |
| `state` (getter) | complete state (same object identity across resets) – read only |
| `history` (getter) | = `state.history` |
| `t` (getter) | = `state.t` |
| `speedHint` | `profile.sim.defaultSpeed` (30) |
| `clock()` | `"Mo 08:45"` |
| `shift()` | `{id:'F'|'S'|null, name, inBreak, endsAt, breakEndsAt?}` (`id:null, name:'Keine Schicht (Geisterschicht)'`, `endsAt` = next work start) |
| `machineView(id)` | §2 (null if unknown) |
| `orderView(id)` | §3 |
| `forecast(maxAgeSec = 60)` | §4 (cached; recomputed when the plan version changes or older than maxAge) |
| `kpis()` | §5 |
| `bottleneck()` | §4.1 – THE plant bottleneck (one definition for Leitstand, Analyse, AI) or `null` |
| `occupancy()` | §5.1 (= `kpis().occupancy`) |
| `workContent()` | `{ <stationId>: seconds }` remaining work content per station (setup + processing incl. loading + rest of running part/fault) of all open ops |
| `whatIf(spec)` | §4.2 – forecast on a temporarily changed plan, read-only |
| `whatIfPriority(orderId, priority = 'eil')` | = `whatIf({type:'setPriority', orderId, priority})` |
| `orderAdvice(orderId)` | §4.3 – the one recommendation for an order (late notification, Leitstand card, AI) |
| `costs()` | §12 – `{currency, energyEurPerKwh, labourEurPerHour, overtimeSurchargePct, machineRates {id: €/h}, assumed}` from `profile.costs` – the one price source for Analyse and Copilot |
| `ghostCheck()` | §11 – copy of the current Geisterschicht-Check (`state.ghostCheck`) or `null` |
| `snapshot()` | §6 compact JSON for the AI, always < 12 000 chars |
| `actions.*`, `runAction(a)` | §8 |
| `stationName(id)` | short name (`'INDEX G220'`, `'Messraum'` …) |
| `partsLeft(orderId, seq)` | parts of that op still to be started |
| `charOf(orderId, seq)` | main characteristic `{name, nominal, tolMinus, tolPlus, unit, sigma, driftAt100, lsl, usl, center}` |
| `containerWhere(id)` | location text of a container (`'Fremdbearbeitung · Los 10/20 Stk – wartet auf Restmenge …'`) |
| `containerView(id)` | container view (§7.4 view shape) |
| `LABELS`, `label(group, key)` | German labels (§9) |
| `config` | engine constants (`CFG`, read only) |

Bus events: `sim:event` (every Event), `sim:notify` (new/changed Notification), `sim:reset`.

---------------------------------------------------------------------------------------------------------------

## 2. `machineView(id)`

```
{ id, name, short, type, kind ('machine'|'qs'|'assembly'), area, vendor, model, control, year,
  automation, loading ('auto'|'perPart'|'attended'), rate (€/h), conn {level 0..3, protocol, gateway, connectedT?},
  state (WF.STATE key), stateLabel, stateColor (css var), stateHex, cause (German text – always show it),
  since, sinceSec,
  phase: 'Bereit'|'Rüsten ausstehend'|'Rüsten'|'Korrektur'|'Erstteil'|'Erstteilprüfung'|'Serie',
  order: null | { id, customer, partName, partNo, qty, due, priority, seq, op, cycleMin, setupMin, transferBatch, firstPiece, released },
  partNo (number of the running part or null), partsDone (good+scrap of the op), partsTotal (op total incl. replacements for scrap),
  partProgress 0..1 (0 while loading), partRemainSec (cut rest + remaining loading) | null, loadRemainSec | null,
  partSub: 'load'|'cut'|null, partEndT (sim time the running part ends, incl. fault rest) | null,
  partPaused (attended part paused: break/shift end – machine is 'waitOperator'),
  etaOpEnd   – end of this operation (never in the past) | null,
  etaBusyEnd – end of the current machine occupancy (= etaOpEnd except QS/washer/assembly, which release the op after each container),
  tools: [Tool],                                   // tools of the current op first, then other mounted tools (status 'idle')
  operator: Person | null,                         // who loads/attends/sets up/corrects here; else the responsible on-duty person (responsible:true)
  people: [Person],                                // everybody with a task at this machine (setter fetching a tool, QS picking the first piece, repair …)
  manualToolChange: null | { types:[typeId], names:[German], t, notBefore|null, reason|null },   // ordered preventive change
  input: [ContainerView], output: [ContainerView], inCap, outCap,
  oeeToday, oeeShift: { oee|null, availability|null, performance|null, quality, plannedSec, runSec },
                                                   // performance includes the running part pro rata (cycle × progress) – see §5
  stateTimes { <stateKey>: seconds today (all seconds – state band) },
  plannedStateTimes { <stateKey>: planned seconds today } (only OEE-planned time: shift time without breaks with an op, plus the
                   ghost shift of autonomous machines – no-shift time is NOT in here; Σ = oeeToday planned time),
  lossByState { <stateKey>: € today } (> 0.005 € only; Σ = lossEurToday – use this for the Analyse loss Pareto, not stateTimes),
  goodToday, scrapToday, lossEurToday, energyKwhToday, energyEurToday (energyKwhToday × costs().energyEurPerKwh),
  powerKw (measured, level ≥ 1) | null, powerKwEst (model value, always), powerMeasured,
  signals: Signals,
  barStockM, barMagazineM, barReorderM, barMaterial (bar feeder only, else null),
  fault: null | { code, text, cause, t0, repairSec, repairMin:[a,b], toolBreak, repairBy, manual, partScrapped, toolId, toolName, sinceSec },
  fpi: null | { stage 'wait'|'carry'|'hold'|'measure', t0, value, measOk, no, by, local (check at the machine after a form-tool change), reason, waitingSec },
  dressing (wheel dressing running), queue: [{ orderId, seq, op, due, priority, level 0|1|2, why, parts }],
  segments: [{ t0, t1|null, state }] (last 24 h, for the state band), counter (parts since start) }
```

**Tool** (current op)
```
{ id, typeId, name, kind ('insert'|'drill'|'mill'|'hob'|'wheel'|'saw'), wearPct (used/life·100), used, life,
  remainingParts (now), remainingMin, cutMinPerPart,
  remainingPartsAfterPart / wearAfterPartPct  – state after the running part (= now if no part runs),
  changeAtParts   – change limit of this tool (= min(planAtParts, ⌊10 % life / cut⌋)),
  planAtParts, planHorizonParts (announce lead in parts), planWearPct (wear % from which remainingParts ≤ changeAtParts),
  neededParts (parts this op still needs incl. the running one),
  status: 'ok'|'planned'|'due'|'broken'|'changing'|'replace'|'keep'|'setup'|'missing',
          ('replace'/'keep' before setup: will be replaced / stays mounted; 'setup' while setting up)
  plannedChange: null | { afterPart, etaT|null (never before now), waitFromT|null (machine stops from here until the setter arrives),
                          waiting (true = the machine already stands for this change: waitFromT = machine.since, in the past;
                                   text 'Maschine steht seit 22:35 (Wartet auf Werkzeug)' – never clamped to now),
                          action ('index' = Schneide wenden at the machine | 'replace' = Werkzeug tauschen),
                          by (name)|null, byId|null, stage ('offen'|'holt Werkzeug'|'unterwegs mit Werkzeug'|'unterwegs zur Maschine'|'an der Maschine'|'Werkzeug liegt bereit'|'später'),
                          manual, bundled ('wird mitgewechselt'), withTools:[names changed together], note|null, text ('nach Teil 37 · ca. 10:42') },
  edge, edges, edgeText ('Schneide 2/4' | null)   – indexable inserts (toolTypes[].edges > 1): one tool record per cutting edge,
  nextAction ('index'|'replace')                   – the next change: index (operator, 1–2 min, no crib walk) until the last edge, then replace
  manualOrder: null | { t, notBefore|null, reason|null, due },
  broken, explain (German sentence – the one visible rule, always show it), mountedT, parts, dressEvery|null, sinceDress|null }
```
Other mounted tools: `{ id, typeId, name, kind, wearPct, used, life, remainingParts:null, remainingPartsAfterPart:null, cutMinPerPart:null, plannedChange:null, broken, status:'idle', explain, edge, edges, edgeText }`.
Guarantee: every tool that is swapped was shown with status `planned`/`due`/`broken` at least one part (≥ 1 s) before.
**Inserts (Wendeschneidplatten)**: `lifeMin` is per cutting edge. When an edge is worn and the insert has a free edge the operator
indexes it at the machine (task `toolChange` with `data.index`, label 'Schneide wenden …', 1–2 min, no walk to the crib, own operator
preferred); the old edge record gets `state:'indexed'`, the new record continues with `edge+1`. Only after the last edge a new insert
comes from the crib (`replace`). Tool cost is booked per edge (`cost / edges`). Explain texts say 'Schneide wenden' vs 'Werkzeug tauschen'.

**Person** (machineView.operator / people)
`{ id, name, role, activity, state, stateLabel, task (task type)|null, taskLabel|null, where ('an M02'|'in der Werkzeugausgabe'|'im Messraum'|'unterwegs zu …'|'in der Pause'…), responsible? }`

**Signals** (computed on read, 5-s raster; also `state.machines[id].signals`)
- level 0: `{ t, level:0, source:'Tablet', lastFeedbackT, lastFeedback }`
- level 1: `{ t, level:1, source, powerKw, currentA, stackLight 'green'|'yellow'|'red'|'off', stackLightLabel, runtimeTodaySec, partCounter:null }`
- level 2/3: `{ t, level, source, mode 'AUTO'|'STOP'|'JOG/MDI'|'ALARM', stackLight, stackLightLabel, spindleRpm|null, spindleLoadPct|null, feedOverridePct|null, program, partCounter, totalCounter, toolInSpindle|null, toolInSpindleName|null (level 3), alarm|null, coolant }`
  – no spindle (`null`) for cmm/washer/assembly; extra: cmm `{measuringProgram, feature, probe}`, washer `{bathTempC, cycle}`, assembly `{terminalStep}`.

---------------------------------------------------------------------------------------------------------------

## 3. `orderView(id)`

```
{ id, customer, sector, part {no, name, material, drawing, weightKg}, qty, due, priority ('normal'|'eil'),
  status ('freigegeben'|'in Arbeit'|'fertig'), note, source ('profil'|'ERP' (order intake)|'KI-Auftrag'|'Nachfertigung'|…),
  shippedQty, shortQty (finished orders: qty − shipped), progress 0..1 (1 when fertig),
  eta (published, smoothed; doneT when fertig) | null, etaRaw (latest computation), etaPending (unconfirmed jump) | null,
  late (eta > due, or delivered short), slackSec (due − eta), risk ('ok'|'knapp'|'spät'|'unbekannt'), riskLabel,
  onTime (fertig: on time AND complete) | null, bottleneck (label of the order's limiting op) | null, bottleneckStation | null, startT, doneT,
  delayBreakdown: [DelayEntry] (§4.4, sorted by sec desc; [] when fertig), delayCause ('Wartezeiten an … und …')|null,
  limit {kind, stationId, seq, name, sec, blockingOrders}|null (largest delay contributor), limitText ('begrenzt durch Härterei Wolf (AG 40)' | 'Werks-Engpass M07 Tiefbohren (AG 30)')|null,
  expectedQty (qty − scrap after op 1; op-1 scrap is re-made automatically),
  qtyRisk: null | { qty, expectedQty, scrapAfterFirst, remakeQty, remakes:[orderIds], missing (not covered by a remake), text },
  remakeOf (parent id of a re-make order) | null, remakes: [orderIds], template (intake template id) | null,
  ops: [Op], containers: [ContainerView] }
```
**Op** – the chain is chronological (`plannedStart`/`plannedEnd` never before the predecessor; done ops = actual times):
```
{ seq, op, station, stationName, received, good, scrap, inProc, waiting, inOutput, passed,
  target (op total incl. replacements = machineView.partsTotal), targetIn (expected input), replacementQty (op 1: scrap remade),
  complete, state ('done'|'active'|'external'|'waiting'|'open'), stateLabel, machineState|null, cause|null,
  setupMin, cycleMin, transferBatch|null, firstPiece,
  plannedStart|null, plannedEnd|null, plannedBusyStart|null, plannedBusyEnd|null, firstOutT (first container ready for the successor)|null,
  returnT (EXT: next return)|null, startT, endT, measKey ('FA-24117/10' → state.measurements),
  ext: null | { partner, process, leadMin, lotQty, sentQty, atPartnerQty, waitingPickupQty, returnedQty, lotComplete|null,
                pickupT|null, returnT|null, lastReturnT|null, returnText } }
```

---------------------------------------------------------------------------------------------------------------

## 4. `forecast()`

```
{ t,
  machines: { <machineId>: [{ orderId, seq, op, start, end (machine busy until), opEnd (op end), setupEnd, active, kind:'run' }] },  // Gantt
  orders: { <orderId>: { eta, etaRaw, etaStable, etaPending|null, late, slackSec, bottleneck|null (label), bottleneckStation|null (station id),
                         bottleneckSeq|null, bottleneckSec|null, delay:[DelayEntry] (§4.4), limit|null, delayCause|null, delayCause1|null,
                         ops: [ null (already complete) |
                                { seq, station, start, end, first, busyStart, busyEnd, setupEnd, active }      // machine op
                              | { seq, station:'EXT', start, end, first, shipNext|null, shipLast|null, firstReturn|null, lastReturn, lotQty }
                              | { seq, station:'VERSAND', start, end, first } ] }
            | finished: { eta: doneT, late, slackSec, done:true, ops:[], etaRaw, etaStable:false, bottleneck:null, bottleneckStation:null } } }
```
`bottleneck`/`bottleneckStation` = the order's own limiting **machine** operation: the largest working span + queue from the
delay breakdown (§4.4) – time outside shifts does **not** count (M13 no longer "wins" because its span crosses a night).
The „begrenzt durch …“ line uses `limit` (largest delay contributor, may be the external partner): `limitTxt` →
„begrenzt durch Härterei Wolf (AG 40)“ / „begrenzt durch M08 Liebherr LC 180 (AG 30)“ – the word „Engpass“ is reserved for the
plant bottleneck (§4.1, „Werks-Engpass M07 Tiefbohren (AG 30)“).
`eta` is the published value (one truth for order list, KPI on-time %, AI, "Termin gefährdet"): changes ≤ 15 min are
taken immediately, larger jumps only after the next 5-min computation confirms them (`etaPending` shows the pending value).

### 4.1 `bottleneck()` – one bottleneck definition for all views
```
null | { stationId, short, name, workSec (remaining work content incl. setups of all open ops on that station), workDays,
         atRisk (true = chosen among the limiting stations of late/knapp orders), orders:[ids whose forecast bottleneckStation is it],
         late:[ids of those that are 'spät'/'knapp'], why ('Arbeitsvorrat 29 h · begrenzt FA-24122 (verspätet)') }
```
Rule: among the stations that are `forecast().orders[id].bottleneckStation` of at-risk orders (risk 'spät'/'knapp', same risk
as `orderView`), the one with the largest remaining work content; if no order is at risk, the station with the largest work
content overall.

### 4.2 `whatIf(spec)` / `whatIfPriority(orderId, priority='eil')`
`spec = {type:'setPriority', orderId, priority} | {type:'moveOp', orderId, seq, stationId}` (moveOp uses the same capability checks
as `actions.moveOp`). Forecast on a temporarily changed plan; the state is restored exactly (no events, no caches). Compares unsmoothed ETAs:
```
{ ok:true, spec, orderId, target {orderId, due, before, after, deltaSec, lateBefore, lateAfter, slackBefore, slackAfter, riskAfter},
  affected:[same row shape, |deltaSec| ≥ 5 min], newlyLate:[ids], laterLate:[ids of already-late orders getting > 5 min later],
  gainSec, recommend (gain ≥ 15 min AND newlyLate = laterLate = []), text ('Als Eilauftrag: FA-24122 fertig ca. Mi 14:32 statt Mi 20:05 (−5 h 33 min); FA-24119 dadurch Do 08:05 – 22 h zu spät') }
| { ok:false, msg }
```
Durations always via `fmtDur`; |Δ| < 1 min reads 'Als Eilauftrag: keine spürbare Änderung für FA-24132 (fertig ca. Mi 09:08)' (never '(−0 s)').

### 4.3 `orderAdvice(orderId)` – the one recommendation (late notification, Leitstand card, AI)
```
null | { orderId, risk, lateSec (eta − due), eta, due, cause (short German, from the delay breakdown – ≤ 2 contributors),
         causeKind ('queue'|'ext'|'fault'|'tool'|'material'|'bottleneck' (no delay contributor ≥ 15 min – working span)|'done'|null),
         bottleneckStation|null, limit|null, limitText|null, delayBreakdown:[DelayEntry] (= orderView.delayBreakdown),
         text ('Ursache: … Empfehlung: <one primary action>.' ≤ ~180 chars – shown verbatim on cards; shortened to the largest
               contributor, then without the parenthesis of the action, if longer),
         detail (long explanation incl. why a rush order does / does not help and the other options), primaryKind,
         action ({type:'setPriority',orderId,priority:'eil'} | {type:'moveOp',orderId,seq,stationId} | null), actionLabel|null,
         actions:[{label, action}] (primary first, then 'Auftrag öffnen' – identical to the late notification),
         alternatives:[{kind:'priority'|'moveOp'|'overtime'|'express'|'material'|'partial', label, ok, gainSec?, text, note?, action|null}],
         sideEffects:[{orderId, beforeT, afterT, lateBy}] (of the rush-order what-if), whatIf:{recommend, gainSec, newlyLate, laterLate, text}|null }
```
Rules: 'Als Eilauftrag' only if `whatIfPriority` recommends it (no other order becomes late or later); 'verlagern' only if a
machine of the same group and capability exists, is not in fault, is not the limiting station itself and its what-if
recommends it (never for M07 – the only deep-hole drill); EXT-dominated delay → 'Expressdurchlauf bei <Partner> anfragen';
missing raw material → 'Liefertermin … beschleunigen'; otherwise overtime at the limiting station (≤ 8 h late) or partial delivery.
No identifiable cause → 'Ursache: … – Optionen im Copilot prüfen.' The `late:` notification uses `text`/`actions` (refreshed ≤ every 30 min)
and its body is one line: 'Prognose Do 08:05 · Termin Mi 10:00 · 22 h 06 min zu spät · begrenzt durch Härterei Wolf (AG 40)' (= `limitText`).
Notification, Leitstand, Aufträge and Copilot all read the same `delayBreakdown` / `cause` / `limitText`.

### 4.4 Delay breakdown (`orderView.delayBreakdown`, `orderAdvice.delayBreakdown`, `forecast().orders[id].delay`)
```
DelayEntry = { kind: 'queue'|'ext'|'process'|'fault'|'tool'|'material'|'noShift', stationId ('M08'|'EXT'|'VERSAND'…), seq, sec,
               blockingOrders: [orderIds] (queue: orders occupying the machine meanwhile), text ('Warten an M08 Liebherr LC 180 (19 h, hinter FA-24125/FA-24130)') }
```
Computed from the forecast ops along the order's chain: the interval between the predecessor's completion and the op's own
completion belongs to that op and is split into `queue` (machine busy with other orders: busyStart − predecessor end, work time),
`process` (setup, first piece, processing), `noShift` (time outside any shift inside queue/processing, only for non-autonomous
machines), `ext` (external lead time), `fault` (remaining repair of the active op), `tool` (waiting for a tool change, staffed),
`material` (raw material missing for the active op, until the purchase ETA). Entries < 30 s are dropped; Σ sec = etaRaw − now.
Sorted by `sec` desc. `delayCause` = up to 2 contributors of kinds queue/ext/fault/tool/material with ≥ 15 min, merged per station:
'Wartezeiten an M08 Liebherr LC 180 (19 h, hinter FA-24125/FA-24130) und Einsatzhärten bei Härterei Wolf (1 T)'.

---------------------------------------------------------------------------------------------------------------

## 5. `kpis()`

```
{ t, oee, availability, performance (null when there was no planned/run time today, e.g. at night), quality,
  oeeShift|null (current shift), oeeLastShift|null, lastShift ('F'|'S')|null,
  good, goodOps (= good: good parts per operation – washing/QS count too), goodFinished (good parts of each order's last processing op),
  scrap, fpy (good/(good+scrap) per operation), onTimePct (0..1; finished orders count only if on time AND complete),
  lossEur, energyKwh, energyEurToday (energyKwh × costs().energyEurPerKwh), powerKw, wip, transportsToday, toolCostToday, shippedToday,
  scrapBy {'Maß','Werkzeugbruch','Erstteil n.i.O.'}, faultsToday, toolChangesToday, setupsToday, fpiOk, fpiNok,
  occupancy (§5.1),
  ghost: null (a shift is active) | { autonomous (auto machines with set-up, released op), running (running/toolchange),
          stoppedIds:[ids standing with loss: waitTool/starved/blocked/fault], idleIds:[ids planned 'Bereit', e.g. saw cut ahead],
          machines:[{id, state, since, cause}], until (next work start), ghostWindow (weekday night → planned time) } }
```
`oeeShift` during the ghost shift (no shift active) is computed **only over the autonomous machines** (the others stand
planned and are not part of the period); in a shift it covers all machines as before.
`state.kpi` holds the last value (refreshed every 60 s); `state.history.oee[]` contains `null` for samples without planned time.

OEE definition (per machine, plant = sum over kind 'machine'): planned time = shift time without breaks with an op assigned
(state ≠ 'Bereit') + every 'running' second + **ghost shift** (Mon→Tue … Fri→Sat nights between the last shift end and the next
shift start; not weekends): every second in which an autonomous machine (`loading:'auto'`) with a set-up, released op is not
'Bereit' – it should run unattended, so waitTool/starved/blocked/fault there are availability losses and accrue `lossEur`.
Performance = Σ ideal cycle time of processed parts / run time, **plus the running part pro rata** (cycle × progress within the
period, computed on read, booked only at part end – shift/day OEE moves continuously instead of jumping at part ends).

### 5.1 `occupancy()` / `kpis().occupancy`
`{ machinesWithWork (machines with an op assigned), machinesWithBacklog (remaining work > 0), total, backlogDays (mean over
production machines of work content / shift capacity per working day, 14.5 h), backlogDaysMax, backlogMaxMachine, byMachine {id: days} }`
– Leitstand: 'Belegung: Maschinen mit Auftrag x/13 · Vorrat y Tage'.

---------------------------------------------------------------------------------------------------------------

## 6. `snapshot()` (AI context, < 12 000 chars – budget loop trims `recent`, then `alerts`, then `orders`)

```
{ t, clock, shift, company, bottleneck {station, name, workH, why, late[]}|null, occupancy {withWork, total, backlogDays},
  kpi {oee, availability, performance, quality, good, goodFinished, scrap, fpy, onTimePct, lossEur, energyKwh, powerKw, wip, transportsToday, toolCostToday},
  ordersOpen, ordersDone, ordersLate,
  machines: [{ id, name, st, since ('Mo 08:45'), ord ('FA-24117/AG10')|null, part ('245/415')|null, why, eta|null, tool {name, rem, wear}|null, change ('WSP … nach Teil 37 · ca. 10:42')|null, oee|null, conn }],
  orders: [{ id, cust, part, qty, expQty? (< qty: scrap after op 1), remakeOf?, st, prio, shipped, due, eta, slackMin, risk, bottleneck }]   // open by risk/due (≤ 15) + last 3 finished
  alerts: [{ id, sev, role, title, t }], materialsLow: [{ id, name, onHand, min, unit, onOrder }],
  people: [{ id, name, role, st, act }], agvs: [{ id, st, bat, load }], recent: [{ t, msg }] }
```

---------------------------------------------------------------------------------------------------------------

## 7. `state` (read only)

`state = { t, startT, seed, machines{}, people{}, agvs{}, forklift, orders{}, containers{}, transports{}, materials{}, tools{},
toolStock{}, tasks{}, purchases[], stations{}, events[], notifications[], measurements{}, history, kpi, toolCostToday,
energyKwh, powerKw, today, shiftStats, shiftId, inBreak, lastShiftReport, ghostCheck (§11)|null, etaPub, engineErrors[],
intake {n, lastT, lastTpl}, orderSeq (last order number – never reused), archived (count) … }`
Bounded for continuous operation: finished orders are removed `profile.sim.archiveAfterH` (72 h) after completion together with
their containers, measurements and caches; shipped containers leave with the forwarder ≈ `shipPickupH` (2 h) after completion in
the delivery window 06–20 (event `shipOut`); delivered purchases are kept 72 h; events 3000, notifications 400, history 48 h.
(fields not listed here are engine-internal caches – do not use).

### 7.1 `state.people[id]`
```
{ id, name, role, shift ('F'|'S'), skills[], machines[], home {x,z}, pos {x,z}, heading (rad), node,
  state ('idle'|'walking'|'working'|'driving'|'break'|'offShift'), activity (German text),
  task: Task|null (live object, see 7.10), vehicle ('Stapler'|null), onDuty, endShift, breakPending, breakUntil, breakFrom, breakLen, breakMakeup?,
  goal ('home'|'break'|'exit'|null), atHome, idleSince, workRem (s left in the current work step),
  workSec, dutySec, utilToday (0..1), tasksToday }
```
Render only `state !== 'offShift'`. Internal: `homeNode, idx, route, dlT, dlV, at`.

### 7.2 `state.agvs[id]` / `state.forklift`
AGV: `{ id, name, maxKg, speed, battery (0..100), state ('idle'|'toPickup'|'loading'|'toDrop'|'unloading'|'toCharge'|'charging'), pos {x,z}, heading, node, load (containerId)|null, loadKind ('container'|'empty'|null – 'empty' = Leergut stack, `loadN` bins, no container object), loadN, task (transportId)|null, taskLabel|null, waitRem, mustCharge, slot, distToday, transportsToday, freeSince }`
Battery: drain 0.006 %/s while driving (≈ 4.6 h pure driving), charge 0.05 %/s; AGVs go to the charger when idle. Loaded
(container or Leergut) an AGV drives at `speed × 0.8` (`config.agvLoadedFactor`).
Forklift: `{ id:'STP1', name, pos {x,z}, heading, node, driver (personId)|null, state ('parked'|'driving'), reservedBy|null, load (containerId|'Stangen')|null }`

### 7.3 `state.containers[id]`
```
{ id, orderId, src (op index of origin, −1 = raw/customer parts), idx (target op index), srcSeq|null, seq|null, qty, weightKg,
  state ('filling'|'ready'|'transit'|'input'|'external'|'shipped'|'scrap'), kind ('parts'|'raw'|'scrap'), partName,
  location: null | {kind:'station', id, slot:'in'|'out'} | {kind:'agv', id} | {kind:'forklift', id, personId}
                  | {kind:'external', partner, process, returnT, sentT, lotQty},
  createdT, readyT?, transportId|null, leaveT?/arrT? (at EXT), relocate?, lastReason? (scrap), supplied? (customer parts) }
```
### 7.4 ContainerView (`machineView.input/output`, `orderView.containers`, `containerView(id)`)
`{ id, orderId, seq, srcSeq, qty, weightKg, state, stateLabel, kind, partName, where (text), location (copy), slotIndex|null, pos {x,z}|null (render position; null when external/shipped), transportId, createdT }`

### 7.5 `state.transports[id]`
```
{ id, containerId|null, kind ('container'|'bars'|'ext-out'|'ext-in'|'supply'|'empty'), from {station, slot?}, to {station, slot?}, weightKg,
  mode ('AGV'|'Stapler'), status ('open'|'assigned'|'toPickup'|'loaded'|'toDrop'|'done'), assignee (agvId|personId)|null,
  phase ('geplant'|'wartend'|'unterwegs'|'erledigt' – LABELS.transportPhase),
  waitCode|null ('destFull' → phase 'geplant' | 'noVehicle' | 'charging' | 'noDriver' | 'lowPrio' (Leergut) → phase 'wartend'),
  waitReason|null ('Ziel voll (Zielpuffer INDEX G220 3/3)' | 'kein Fahrzeug frei (AGV 1 unterwegs, AGV 2 unterwegs)' |
                   'Fahrzeug lädt (AGV 2 24 %)' | 'wartet auf Logistiker:in (Stapler)' | 'Leergut – fährt, sobald ein AGV frei ist'),
  createdT, pickupT|null, doneT|null, orderId|null, label, taskId|null,
  materialId?/meters? (bars), empties? (Leergut: number of stacked bins), finalTo? (rerouted to the Pufferlager), fromBuffer?, cancelled? }
```
Done transports are kept 6 h. **Phase semantics for the hall**: 'geplant' = the target buffer is full, the container stays (planned)
at the source output or in the Pufferlager – show it as planned, not as a waiting transport; 'wartend' = target has room, a vehicle /
driver is missing (`waitReason` says which); 'unterwegs' = assigned/driving/loaded. Material flow:
- **Pufferlager** (`PUF`, `profile.stations PUF.cap` = 12): when the target buffer is full and the source machine's output is full,
  a free AGV takes the container to the Pufferlager (label '… → Pufferlager (Ziel INDEX G220 voll)', event `buffer`) and a new
  transport Pufferlager → target is created ('geplant' until there is room). The saw keeps its cut-ahead in its own Zuschnitt-Ablage.
  Containers in the Pufferlager: `location {kind:'station', id:'PUF', slot:'out'}`, state 'ready'; `containerView().pos` spreads them
  in front of the rack.
- **Leergut** (`kind:'empty'`, `containerId:null`, `mode:'AGV'`, `from.slot:'in'`, `to.slot:'out'`): every container emptied at a machine
  input goes back to the output of the station that filled it (raw containers to RAW); open Leergut transports of the same route stack
  (≤ 4 bins, `empties`); AGVs drive them only when no material transport waits. Counted in `state.today.emptyReturns`, not in
  `today.transports`.
- Transfer batches in the profile are sized so a container fills in ≈ ≤ 75 min (`transferBatch`; small Swiss-lathe parts in boxes
  of 40–100), washer program change 2 min, i.e. regular moves; in the
  default run an AGV or the forklift is driving ≈ 40–45 % of staffed time (≈ 50 % in the first 40 min after 08:40), ≈ 60 % incl.
  loading/unloading (test 15 requires ≥ 35 %).
- Wash/measure programs stay set: a releasable op (no first piece, setup ≤ 10 min) re-activated for the next container of the
  same order on the same machine needs no new setup ('Programm noch eingestellt – kein Rüsten').

### 7.6 `state.tools[id]`
```
{ id, typeId, name, kind, machineId|null, used (cut minutes), life, mountedT, parts, sinceDress, broken, brokenT?, dressDue?,
  edge, edges (inserts: current cutting edge 1..edges; other tools 1/1),
  state ('mounted'|'stock-used'|'regrind'|'scrap'|'indexed' (edge used up, insert indexed to the next edge)), plannedT (announced)|null,
  // after dismount: dismountT, reason, cost (€), disposal (text), lastMachine }
```
Mounted tools of a machine: `state.machines[id].tools` (array of tool ids). Last 150 dismounted tools are kept.
`state.toolStock[typeId] = { ready, regrind, scrapToday, usedStock }`.

### 7.7 `state.materials[id]`
`{ id, name, form ('Stange'|'Platte'|'Stk'), unit ('m'|'Stk'), onHand, min, reorderQty, supplier, leadMin, pricePerUnit, location, onOrder, usedToday, kanban }`
`state.purchases[] = { id, materialId, qty, orderedT, etaT, status ('bestellt'|'geliefert'), supplier, costEur, deliveredT?, kanban? }`
**Kanban rule** (`kanban:true`, Rahmenvertrag): if stock + open purchases + bar magazines no longer cover the open demand of the
released orders (first op, not yet issued) **or stock + open purchases fall below the reorder point `min`** (≈ consumption during
the lead time; the profile's starting stock covers the first lead time), the engine calls off `reorderQty` (or a multiple) automatically (event `reorder`
with `data.kanban`, msg 'Kanban-Abruf …'). Below `min` the `stock:` notification is only 'info' for Kanban materials ('warn' for the others). Titanium (`kanban:false`) is
ordered per order: the intake only releases titanium orders that the stock covers.

### 7.8 `state.notifications[]` (newest first, max 400)
```
{ id, key (dedup: 'fault:M02', 'wait:M07', 'tool:M03', 'ghost:check', 'fpi:M08', 'spc:FA-24117/10', 'missing:MAT-ALBL:M06',
  'stock:MAT-ALBL', 'late:FA-24122', 'done:FA-24118', 'qty:FA-24118', 'intake:FA-24142', 'agvbat:AGV1', 'shift:<t>'),
  t, updatedT, sev ('info'|'warn'|'crit'|'ok'), title, body, role ('Schichtleitung'|'Einrichter'|'QS'|'Logistik'|'Instandhaltung'|'Einkauf'),
  entity {kind, id}|null, status ('open'|'ack'|'resolved'), ackBy, ackT, resolvedT, resolveNote?, suggestion,
  actions: [{ label, action: {type, …} }]  → run with WF.sim.runAction(action) (or app.runAction),
  autoResolveT|null, spc? {machineId, orderId, seq, since, value}, ghost? {t, staffEnd, until, nextStart, machines:[GhostEntry]} (ghost:check, §11),
  whatIf? {recommend, gainSec, newlyLate, laterLate, text} (late:) }
```
Open notifications are updated in place (same key; `sim:notify` fires) and resolved automatically when the cause disappears.
**Compact style (all keys)**: `body` is one short line (' · '-separated facts, no sentences, no line breaks); `suggestion` is
'Ursache: <cause>. Empfehlung: <one action>.' ≤ ~180 chars (helper `brief`, verbatim on the Leitstand card). Long names are
shortened (customers without legal form, tools 'CNMG 120408', 'VCGT 1103'). Verified by test group 15 for every key below.
- `wait:` – 'M03 Citizen L20: Wartet auf Werkzeug seit 22:07'; raised when an episode lasts ≥ `waitWarnSec`/`toolWarnSec`
  counted from max(episode start, shift start) – a machine that stood overnight and is served right at 06:00 raises nothing.
  Each episode has its own notification: 'seit' is always the start of the current episode; on resolve the title is closed
  ('M05 DMU 65: Wartet auf Bediener 16:42–16:52 (10 min)', body 'Wartet auf Bediener 16:42–16:52 · FA-24131 AG 10 · Stillstand ca. 23 €')
  so a resolved card is never shown with an open 'seit'. The resolved Geisterschicht-Check reads '… standen in der Nacht' / 'M03 stand ab 22:22 (…)'.
  Suggestion by state, e.g. night waitTool: 'Ursache: Schneide 1/2 von VCGT 1103 verschlissen, niemand im Haus. Empfehlung: Di 06:00
  als Erstes wenden (1–2 min); künftig vor Schichtende vorbeugend wenden.' At night a stop announced in the Geisterschicht-Check
  raises no separate `wait:` warning – the check card shows 'M03 steht seit 22:07 (VCGT 1103)' instead.
- `tool:` – re-worded every sim minute from the current plan (time never before now); title 'Schneide wenden geplant' for pure
  indexing (role Schichtleitung), else 'Werkzeugwechsel geplant'; body 'CNMG 120408 (Schneide 1/4) → wenden nach Teil 16 ca. 14:02 ·
  FA-24122 AG 20'; while the change runs: 'Schneide wenden läuft seit 08:41: DNMG 150608 · FA-24118 AG 20'. Staffing gaps by reason:
  break, shift handover, before shift end ('… siehe Geisterschicht-Check'), night ('… niemand im Haus bis Di 06:00. Empfehlung:
  Di 06:00 als Erstes wenden …'). `sev` 'warn' only if the machine will stop in staffed time and the stop is not already in the
  Geisterschicht-Check; at night always 'info'.
- `ghost:check` – one card per evening (§11); per-machine `ghost:<id>` notifications no longer exist.
- `stock:` – 'info' for Kanban materials (the call-off follows the demand automatically), 'warn' otherwise.
- `missing:<mat>:<machine>` – crit 'Material fehlt: 1.2842 Flach 45×25 für M01', body 'M01 steht · Bestand 0,02 m < 0,120 m je Teil ·
  Lieferung ca. 14:10'; the delivery time is live (refreshed every sim minute): once the ETA has passed without delivery it reads
  'Lieferung überfällig seit Mo 14:10 – beim Lieferanten nachfragen'. On resolve the card is closed: 'Material fehlte: … für M01
  (11:21–11:22)', body 'M01 wartete 1 min · Material wieder verfügbar (Bestand 18 m)' – never a stale ETA.
- `fpi:` – raised only in staffed time (counted from shift start), resolved at shift end (the first piece waits planned overnight).
- `late:` – suggestion/actions from `orderAdvice` (§4.3).
- `qty:` – 'Menge gefährdet: FA-24118 nur 11/12 – Nachfertigung ab Säge einplanen' (warn, Schichtleitung) as soon as a part is
  scrapped after op 1; action `{type:'planRemake', orderId}`; resolved when the re-make is planned or the order is finished.
- `intake:` – info, Schichtleitung, `autoResolveT` = +30 sim-min: 'Auftragseingang FA-… : 40 Stk …'.

### 7.9 `state.events[]` (ring buffer 3000, oldest first)
`{ id, t, type, sev, entity {kind,id}|null, msg (German), data|null }`
Types: `state` (data `{from, to, cause, code, minor}` – `minor` = walking/assigning, may be hidden), `opSelect, opPause, opDone,
orderDone, orderAdded, setupStart, setupDone, fpiReady, fpiOk, fpiNok, correction, offset, toolPlanned (data {toolId, typeId, rem,
remAfterPart, changeAt, wearPct, bundled, manual, afterPart, etaT} or {parked:true}), toolChanged (data {tools:[{typeId, name, oldToolId,
newToolId, wearPct, rem, reason, disposal, bundled, manual}], cause, toolBreak, manual, partProgress:0, by, durSec, firstPieceAfter}),
toolReturn, fault, repair, scrap, issue, return, extOut, extIn, delivery, reorder, priority, moveOp, connect, bars, barsOrder, barsFail,
crib, shift, break, breakMakeup, partPause, partResume, reassign, taskDropped, reset, buffer (container to the Pufferlager, data {orderId, from, to}), orderIntake (sev 'ok', msg 'Auftragseingang: FA-24142 · 40 Stk
Hydraulikkolben Ø60×220 für Hydrava Pumpen GmbH, Termin Do 14:00', data {orderId, template, qty, due, priority, why, source:'ERP'}),
shipOut (data {orderId, qty, containers}), remake (data {orderId, remakeOf, qty})`.
`toolChanged.data.tools[]` additionally carries `action ('index'|'replace'), edgeFrom, edgeTo, edges`; `data.index` = pure indexing.
`toolPlanned.data` carries `action, edge, edges`; `delivery.data` carries `purchaseId, kanban`; `reorder.data` carries `kanban`.

### 7.10 `state.tasks[id]` (open/assigned person tasks; a person's live task is `person.task`)
`{ id, type ('setup'|'load'|'toolChange'|'fpi'|'inspect'|'repair'|'forklift'|'bars'|'assembly'|'correction'|'offset'), prio, label,
machineId|null, orderId|null, seq|null, target {kind,id}, status ('open'|'assigned'), assignee|null, createdT, assignedT?, steps[], si,
ready, workStarted, data {fetched?, local?, …}, held?, lateWhy? ('Rüsten (ca. 40 min) passt nicht mehr vor Schichtende 14:00 – …') }`

### 7.11 `state.machines[id]` (raw; prefer `machineView`)
Stable fields: `id, name, short, kind, type, loading, conn, state, since, cause, op {oid, idx}|null, setupDone, released, needCorr,
part {oid, idx, seq, sub 'load'|'cut', rem, dur, first, by, t0, no, of, rework, label, loadLabel, paused?}|null, dressRem, fpi, setupRun,
corrRun, toolchange {taskId, by, t0, dur, manual, list:[{type, toolId, rem, why, at, reason}], cause}|null, fault, manualTC
{types, notBefore, t, reason}|null, tools [toolId], segments, kd/ks (today/shift stats), counter, barStockM, barMat, signals (getter)`.

### 7.12 `state.orders[id]`
`{ id, customer, sector, part, qty, due, priority, note, routing[{seq, op, station, setupMin, cycleMin, tools[], material, transferBatch,
firstPiece, ext, char, loadMin}], status, releasedT, startT, doneT, shippedQty, source, lateStreak,
ops[{ seq, station, received, good, scrap, passed, inProc, complete, startT, endT, machine, offset, fpiCount }] }`

### 7.13 `state.history` (every 5 sim-min, last 48 h)
`{ t[], good[] (good parts in the interval), oee[] (null without planned time), powerKw[] (interval mean), wip[], perMachine{ <id>: state[] } }`

### 7.14 `state.measurements`
`{ '<orderId>/<seq>': [{ t, v, ok, partNo, fpi }] }` – last 200 per op; limits via `WF.sim.charOf(orderId, seq)`.

Other: `state.today {day, good, goodFinished, scrap, scrapBy, fpiOk, fpiNok, transports, emptyReturns, shipped, toolChanges, faults, setups, energyKwh, lossEur}`,
`state.stations[id] = {id, inp:[containerId], out:[containerId]}` (order = stacking order), `state.lastShiftReport {t, from, to, good, scrap, oee, faults[], waiting[]}`,
`state.engineErrors[]` (must stay empty – internal error log).

---------------------------------------------------------------------------------------------------------------

## 8. Actions (`WF.sim.actions.*` → `{ok, msg, …}`; `addOrder` → order id string or `{ok:false, msg}`)

| Action | Notes |
|---|---|
| `triggerFault(machineId, code?)` | demo fault; codes must belong to the machine's catalog; tool-break codes (`ALM 4410`, `E 31`) only while the machine is cutting – otherwise `{ok:false, msg}` |
| `repair(machineId)` | demo: ends the fault immediately |
| `ack(notificationId, by?)`, `resolve(notificationId)` | id or key |
| `reorder(materialId, qty?)` | → `{ok, id (purchase), msg}` |
| `setPriority(orderId, 'eil'|'normal')` | |
| `addOrder(spec)` | ids continue after the profile/intake numbers (shared counter `state.orderSeq`, never reused); `spec {customer, part {name, no?, material?, drawing?, weightKg?}, qty, due?, priority?, note?, source?, routing:[{op, station, setupMin, cycleMin, tools:[{type, cutMinPerPart}], material:{id, perPart}?, transferBatch?, firstPiece?, loadMin?, char?, ext?}]}`; first step `EXT` = customer-supplied parts from goods-in |
| `moveOp(orderId, seq, stationId)` | same machine group AND capability (weight, Ø, bar stock for the Swiss lathe, 5-axis) – rejection text explains why |
| `connectMachine(machineId, level, protocol?)` | |
| `applyOffset(orderId, seq, value)` | immediate (Leitstand); automatic SPC corrections are entered by a person at the machine |
| `planToolChange(machineId, types?, notBefore?, reason?)` | preventive change; without `types` the tools that will not last for the rest of the op are chosen; `notBefore` (sim time) = change at the first part boundary after it; refused while the last part runs |
| `planRemake(orderId, qty?)` | re-make for scrap after op 1: new order (source 'Nachfertigung', priority 'eil', same routing from op 10, due = parent due or +2 working days, `remakeOf`); → `{ok, id, msg}`; refused without open shortfall |
| `releaseIntake()` | demo: release the next order from the order pool now (same rules as the automatic intake) → `{ok, id, msg}` |
| `refillBars(machineId)` | preventive bar refill (forklift task 'Stangen nachladen') even above the reorder mark – e.g. from the Geisterschicht-Check; refused without bar feeder / full magazine / no stock |
| `run(action)` / `runAction(action)` | executes `{type:'reorder'|'setPriority'|'repair'|'triggerFault'|'moveOp'|'applyOffset'|'planToolChange'|'refillBars'|'planRemake'|'releaseIntake'|'ack'|'resolve'|'select', …}` |
| `reset()` | |

---------------------------------------------------------------------------------------------------------------

## 9. `WF.sim.LABELS` (German)

`person, agv, forklift, transport, transportKind (incl. 'empty' = 'Leergut'), transportPhase, transportMode, container, containerKind, opState, orderStatus, priority, risk,
task (task types), taskStatus, toolStatus, toolState (incl. 'indexed'), toolAction ('index' = 'Schneide wenden', 'replace' = 'Werkzeug tauschen'),
toolKind, fpiStage, notifStatus, purchase, conn (level 0..3), loading, stackLight`
– e.g. `LABELS.person.walking = 'Unterwegs'`, `LABELS.toolStatus.planned = 'Wechsel geplant'`, `LABELS.container.external = 'In Fremdbearbeitung'`.
`WF.sim.label('machineState', 'waitTool')` → `'Wartet auf Werkzeug'`, `label('sev', 'crit')` → `'Kritisch'`.

---------------------------------------------------------------------------------------------------------------

## 10. Order book and order intake (`profile.orders`, `profile.orderTemplates`, `profile.sim.intake`)

- The profile starts with 25 released orders (FA-24117 … FA-24141, due Mo … next Fri); every production machine has roughly
  1–2 days of queue at start (`occupancy().byMachine`).
- **Order intake** (deterministic, own seeded RNG): from `profile.orderTemplates` (`{id, customer, sector, part, qty:[min,max,step],
  dueDays:[a,b], weight, routing, note}` – repeat and variant orders of all customers over M01…M13, EXT, QS) new orders are released
  with status 'freigegeben', `source:'ERP'`, ids continuing after the highest existing number:
  - at every shift start Mon–Fri `perShift` (1–2) orders while `occupancy().backlogDays < backlogMaxDays` (2.0),
  - during shift time whenever fewer than `openMin` (9) orders are open or the backlog drops below `backlogMinDays` (1.0)
    (≥ `minGapMin` = 20 min apart),
  - load-oriented: a template's weight is divided by the backlog of its most loaded station; stations above `stationMaxDays`
    (2.5 days) get no new orders; at most `maxSameOpen` (2) open orders per part number; titanium only when covered by stock;
  - due = now + 2–4 working days of shift time (Mon–Fri 06–22, full hour 07:00–21:00); `eilProb` (5 %) rush orders.
- Each release emits event `orderIntake` and an info notification `intake:<id>` (Schichtleitung, auto-resolved after 30 sim-min),
  then runs the Kanban check (§7.7).
- Verified by `test/sim.test.mjs` group 13 (7-day run: every weekday shift busy, open orders/WIP/state bounded, no deadlock).

---------------------------------------------------------------------------------------------------------------

## 11. Night and ghost shift

- **Planned idle off shift**: without a shift, every machine that cannot run unattended (`loading` ≠ 'auto', or not set up and
  released) stands planned: state `'idle'`, cause 'Keine Schicht – weiter Di 06:00 mit Einlegen FA-24129 AG 20' (next step and
  start time). No notification, no loss, no availability penalty (not planned time). Only autonomous machines with a released op
  can stop with waiting states, losses and warnings in the ghost shift.
- **Saw cut-ahead / lot split**: when all output containers of the saw wait for full successor buffers, the saw is 'Bereit'
  ('Zuschnitt auf Vorrat – 6 Behälter warten auf Haas VF-4, INDEX G220 (Folgemaschinen ausgelastet); weiter mit …'), not 'Ausgang voll'.
  Any machine with ≥ 2 stuck containers switches to another released op whose successor has room (`ops[i].outHold`, normal setup,
  cheap setup ≤ 15 min at once, otherwise after 60 min blocked) and splits the lot. M01 Zuschnitt-Ablage: `outCap` 6.
  Test 15: saw 'blocked' < 5 % of staffed time (≈ 1 %).
- **Geisterschicht-Check** (`notification key 'ghost:check'`, `state.ghostCheck`, `WF.sim.ghostCheck()`): from 1 h before the last
  shift end of a day (21:00) re-evaluated every 10 min and after every relevant change (tool change ordered/done, op finished,
  fault, bar refill); frozen at shift end; at night only the actual stops are added. One card:
  - title 'Geisterschicht-Check: 3 von 4 autonomen Maschinen stoppen in der Nacht' (or 'kein vorzeitiger Stopp (n autonome Maschinen)'),
  - body (one line) 'M03 ca. 22:07 (VCGT 1103) · M02 ca. 23:02 (CNMG 120408) · M05 ca. 23:30 (Schaftfräser Ø10 Z4) · M01 Zuschnitt-Vorrat voll'
    – at night 'M03 steht seit 22:07 (VCGT 1103)',
  - suggestion before shift end 'Ursache: nach 22:00 niemand im Haus bis Di 06:00. Empfehlung: M03 ca. 21:49 wechseln; M02 ca. 21:47 wenden;
    M05 Schwesterwerkzeug prüfen.'; after shift end 'Ursache: Standzeit reicht nicht bis Di 06:00, niemand im Haus. Empfehlung: Di 06:00
    als Erstes M03 wenden, M02 wenden, M05 wechseln; künftig vor Schichtende vorbeugend wenden/wechseln.',
  - actions (staffed): per machine `planToolChange` ('M03: vor Schichtende wechseln') or `refillBars` ('M03: Stangen nachladen'), then 'Maschine öffnen',
  - `sev` 'warn' if any machine stops, else 'info'; `autoResolveT` = end of the ghost window; resolved at shift start; created once per evening
    (a card the user resolved is not re-created that evening).
  ```
  GhostEntry = { machineId, orderId, seq, reason: 'tool'|'bars'|'input'|'output'|'material'|'fpi'|'fault' (stops) | 'done' (op finishes
                 in the night) | 'ahead' (saw cut-ahead full – planned) | 'through' (runs until the next shift start),
                 stopT|null, tool|null (limiting tool type), types:[recommended tool types], gainSec, tLast (last reachable part boundary),
                 rec (one sentence ≤ ~180, e.g. 'ca. 21:49 vorbeugend wechseln: VCGT 1103, Abstechplatte 1,5 mm – dann läuft M03 bis ca. 23:13 (+1 h 06 min)'),
                 recShort, recNight, action|null, actionLabel?, atStart? (no boundary reachable before shift end → first task at shift start),
                 waitingSince|null (night: machine actually stands since) }
  ```
  The projection runs part by part until the next shift start: tool life with the normal change rule until shift end, bar
  magazine (refill until 15 min before shift end), raw material at the saw, parts in the input (predecessor not running unattended)
  and room in the output/successor input; a preventive change at the last reachable boundary is recommended only if it gains
  ≥ max(30 min, 3 cycles).
- `kpis().ghost` (§5) and `oeeShift` over the autonomous machines only while no shift is active.
- Test group 15 ("Night realism") checks at Mo 22:30: non-autonomous machines 'idle' with 'Keine Schicht – weiter …', ≤ 4
  machine-related warnings (currently 1: the Geisterschicht-Check; total warnings 5 incl. 2 'late:' and 2 'qty:'), no loss off shift
  for them, Σ lossEurBy = lossEur and Σ plannedStateSec = planned (day and shift stats), one ghost check per evening, compact texts,
  fresh 'seit' and closed titles of resolved wait notifications, saw rarely blocked.

## 12. Costs (`profile.costs`, `WF.sim.costs()`)

```
profile.costs = { currency:'EUR', energyEurPerKwh: 0.19, labourEurPerHour: 48, overtimeSurchargePct: 50, machineRates: 'stations[].rate' }
```
- **Strompreis** `energyEurPerKwh` (Industrietarif netto inkl. Netzentgelt) – the one value for energy cost: `kpis().energyEurToday`,
  `machineView().energyEurToday`; Analyse and Copilot must read `WF.sim.costs().energyEurPerKwh` (not their own fallback).
- **Maschinenstundensätze** live per station in `profile.stations[].rate` (€/h, machine incl. operator) – `machineView().rate`,
  `costs().machineRates`; they price downtime (`lossEur`, 'Stillstand ca. 95 €/h') and tool-change stops.
- `labourEurPerHour` / `overtimeSurchargePct` – personnel full-cost rate and overtime surcharge for overtime/extra-shift estimates.
