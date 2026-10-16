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
  stateTimes { <stateKey>: seconds today }, goodToday, scrapToday, lossEurToday, energyKwhToday,
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
  plannedChange: null | { afterPart, etaT|null, waitFromT|null (machine stops from here until the setter arrives),
                          by (name)|null, byId|null, stage ('offen'|'holt Werkzeug'|'unterwegs mit Werkzeug'|'an der Maschine'|'Werkzeug liegt bereit'|'später'),
                          manual, bundled ('wird mitgewechselt'), withTools:[names changed together], note|null, text ('nach Teil 37 · ca. 10:42') },
  manualOrder: null | { t, notBefore|null, reason|null, due },
  broken, explain (German sentence – the one visible rule, always show it), mountedT, parts, dressEvery|null, sinceDress|null }
```
Other mounted tools: `{ id, typeId, name, kind, wearPct, used, life, remainingParts:null, remainingPartsAfterPart:null, cutMinPerPart:null, plannedChange:null, broken, status:'idle', explain }`.
Guarantee: every tool that is swapped was shown with status `planned`/`due`/`broken` at least one part (≥ 1 s) before.

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
  status ('freigegeben'|'in Arbeit'|'fertig'), note, source ('profil'|'KI-Auftrag'|…),
  shippedQty, shortQty (finished orders: qty − shipped), progress 0..1 (1 when fertig),
  eta (published, smoothed; doneT when fertig) | null, etaRaw (latest computation), etaPending (unconfirmed jump) | null,
  late (eta > due, or delivered short), slackSec (due − eta), risk ('ok'|'knapp'|'spät'|'unbekannt'), riskLabel,
  onTime (fertig: on time AND complete) | null, bottleneck (text) | null, startT, doneT,
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
  orders: { <orderId>: { eta, etaRaw, etaStable, etaPending|null, late, slackSec, bottleneck|null, bottleneckSec|null,
                         ops: [ null (already complete) |
                                { seq, station, start, end, first, busyStart, busyEnd, setupEnd, active }      // machine op
                              | { seq, station:'EXT', start, end, first, shipNext|null, shipLast|null, firstReturn|null, lastReturn, lotQty }
                              | { seq, station:'VERSAND', start, end, first } ] }
            | finished: { eta: doneT, late, slackSec, done:true, ops:[], etaRaw, etaStable:false } } }
```
`eta` is the published value (one truth for order list, KPI on-time %, AI, "Termin gefährdet"): changes ≤ 15 min are
taken immediately, larger jumps only after the next 5-min computation confirms them (`etaPending` shows the pending value).

---------------------------------------------------------------------------------------------------------------

## 5. `kpis()`

```
{ t, oee, availability, performance (null when there was no planned/run time today, e.g. at night), quality,
  oeeShift|null (current shift), oeeLastShift|null, lastShift ('F'|'S')|null,
  good, goodOps (= good: good parts per operation – washing/QS count too), goodFinished (good parts of each order's last processing op),
  scrap, fpy (good/(good+scrap) per operation), onTimePct (0..1; finished orders count only if on time AND complete),
  lossEur, energyKwh, powerKw, wip, transportsToday, toolCostToday, shippedToday,
  scrapBy {'Maß','Werkzeugbruch','Erstteil n.i.O.'}, faultsToday, toolChangesToday, setupsToday, fpiOk, fpiNok }
```
`state.kpi` holds the last value (refreshed every 60 s); `state.history.oee[]` contains `null` for samples without planned time.

---------------------------------------------------------------------------------------------------------------

## 6. `snapshot()` (AI context, < 12 000 chars – budget loop trims `recent`, then `alerts`, then `orders`)

```
{ t, clock, shift, company, kpi {oee, availability, performance, quality, good, goodFinished, scrap, fpy, onTimePct, lossEur, energyKwh, powerKw, wip, transportsToday, toolCostToday},
  ordersOpen, ordersDone, ordersLate,
  machines: [{ id, name, st, since ('Mo 08:45'), ord ('FA-24117/AG10')|null, part ('245/415')|null, why, eta|null, tool {name, rem, wear}|null, change ('WSP … nach Teil 37 · ca. 10:42')|null, oee|null, conn }],
  orders: [{ id, cust, part, qty, st, prio, shipped, due, eta, slackMin, risk, bottleneck }]   // open by risk/due (≤ 15) + last 3 finished
  alerts: [{ id, sev, role, title, t }], materialsLow: [{ id, name, onHand, min, unit, onOrder }],
  people: [{ id, name, role, st, act }], agvs: [{ id, st, bat, load }], recent: [{ t, msg }] }
```

---------------------------------------------------------------------------------------------------------------

## 7. `state` (read only)

`state = { t, startT, seed, machines{}, people{}, agvs{}, forklift, orders{}, containers{}, transports{}, materials{}, tools{},
toolStock{}, tasks{}, purchases[], stations{}, events[], notifications[], measurements{}, history, kpi, toolCostToday,
energyKwh, powerKw, today, shiftStats, shiftId, inBreak, lastShiftReport, etaPub, engineErrors[] … }`
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
AGV: `{ id, name, maxKg, speed, battery (0..100), state ('idle'|'toPickup'|'loading'|'toDrop'|'unloading'|'toCharge'|'charging'), pos {x,z}, heading, node, load (containerId)|null, task (transportId)|null, taskLabel|null, waitRem, mustCharge, slot, distToday, transportsToday, freeSince }`
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
{ id, containerId|null, kind ('container'|'bars'|'ext-out'|'ext-in'|'supply'), from {station}, to {station}, weightKg,
  mode ('AGV'|'Stapler'), status ('open'|'assigned'|'toPickup'|'loaded'|'toDrop'|'done'), assignee (agvId|personId)|null,
  createdT, pickupT|null, doneT|null, orderId|null, label, waitReason|null ('Zielpuffer … voll', 'kein AGV frei …'), taskId|null,
  materialId?/meters? (bars), cancelled? }
```
Done transports are kept 6 h.

### 7.6 `state.tools[id]`
```
{ id, typeId, name, kind, machineId|null, used (cut minutes), life, mountedT, parts, sinceDress, broken, brokenT?, dressDue?,
  state ('mounted'|'stock-used'|'regrind'|'scrap'), plannedT (announced)|null,
  // after dismount: dismountT, reason, cost (€), disposal (text), lastMachine }
```
Mounted tools of a machine: `state.machines[id].tools` (array of tool ids). Last 150 dismounted tools are kept.
`state.toolStock[typeId] = { ready, regrind, scrapToday, usedStock }`.

### 7.7 `state.materials[id]`
`{ id, name, form ('Stange'|'Platte'|'Stk'), unit ('m'|'Stk'), onHand, min, reorderQty, supplier, leadMin, pricePerUnit, location, onOrder, usedToday }`
`state.purchases[] = { id, materialId, qty, orderedT, etaT, status ('bestellt'|'geliefert'), supplier, costEur, deliveredT? }`

### 7.8 `state.notifications[]` (newest first, max 400)
```
{ id, key (dedup: 'fault:M02', 'wait:M07', 'tool:M03', 'ghost:M03', 'fpi:M08', 'spc:FA-24117/10', 'missing:MAT-ALBL:M06',
  'stock:MAT-ALBL', 'late:FA-24122', 'done:FA-24118', 'short:FA-24130', 'agvbat:AGV1', 'shift:<t>'),
  t, updatedT, sev ('info'|'warn'|'crit'|'ok'), title, body, role ('Schichtleitung'|'Einrichter'|'QS'|'Logistik'|'Instandhaltung'|'Einkauf'),
  entity {kind, id}|null, status ('open'|'ack'|'resolved'), ackBy, ackT, resolvedT, resolveNote?, suggestion,
  actions: [{ label, action: {type, …} }]  → run with WF.sim.runAction(action) (or app.runAction),
  autoResolveT|null, spc? {machineId, orderId, seq, since, value}, ghost? {machineId, stopT, tool, types, gainSec, until} }
```
Open notifications are updated in place (same key; `sim:notify` fires) and resolved automatically when the cause disappears.

### 7.9 `state.events[]` (ring buffer 3000, oldest first)
`{ id, t, type, sev, entity {kind,id}|null, msg (German), data|null }`
Types: `state` (data `{from, to, cause, code, minor}` – `minor` = walking/assigning, may be hidden), `opSelect, opPause, opDone,
orderDone, orderAdded, setupStart, setupDone, fpiReady, fpiOk, fpiNok, correction, offset, toolPlanned (data {toolId, typeId, rem,
remAfterPart, changeAt, wearPct, bundled, manual, afterPart, etaT} or {parked:true}), toolChanged (data {tools:[{typeId, name, oldToolId,
newToolId, wearPct, rem, reason, disposal, bundled, manual}], cause, toolBreak, manual, partProgress:0, by, durSec, firstPieceAfter}),
toolReturn, fault, repair, scrap, issue, return, extOut, extIn, delivery, reorder, priority, moveOp, connect, bars, barsOrder, barsFail,
crib, shift, break, breakMakeup, partPause, partResume, reassign, taskDropped, reset`.

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

Other: `state.today {day, good, goodFinished, scrap, scrapBy, fpiOk, fpiNok, transports, shipped, toolChanges, faults, setups, energyKwh, lossEur}`,
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
| `addOrder(spec)` | `spec {customer, part {name, no?, material?, drawing?, weightKg?}, qty, due?, priority?, note?, source?, routing:[{op, station, setupMin, cycleMin, tools:[{type, cutMinPerPart}], material:{id, perPart}?, transferBatch?, firstPiece?, loadMin?, char?, ext?}]}`; first step `EXT` = customer-supplied parts from goods-in |
| `moveOp(orderId, seq, stationId)` | same machine group AND capability (weight, Ø, bar stock for the Swiss lathe, 5-axis) – rejection text explains why |
| `connectMachine(machineId, level, protocol?)` | |
| `applyOffset(orderId, seq, value)` | immediate (Leitstand); automatic SPC corrections are entered by a person at the machine |
| `planToolChange(machineId, types?, notBefore?, reason?)` | preventive change; without `types` the tools that will not last for the rest of the op are chosen; `notBefore` (sim time) = change at the first part boundary after it; refused while the last part runs |
| `run(action)` / `runAction(action)` | executes `{type:'reorder'|'setPriority'|'repair'|'triggerFault'|'moveOp'|'applyOffset'|'planToolChange'|'ack'|'resolve'|'select', …}` |
| `reset()` | |

---------------------------------------------------------------------------------------------------------------

## 9. `WF.sim.LABELS` (German)

`person, agv, forklift, transport, transportKind, transportMode, container, containerKind, opState, orderStatus, priority, risk,
task (task types), taskStatus, toolStatus, toolState, toolKind, fpiStage, notifStatus, purchase, conn (level 0..3), loading, stackLight`
– e.g. `LABELS.person.walking = 'Unterwegs'`, `LABELS.toolStatus.planned = 'Wechsel geplant'`, `LABELS.container.external = 'In Fremdbearbeitung'`.
`WF.sim.label('machineState', 'waitTool')` → `'Wartet auf Werkzeug'`, `label('sev', 'crit')` → `'Kritisch'`.
