# werkfluss – Spezifikation (Demo-Produkt)

werkfluss ist ein KI-natives MES (Manufacturing Execution System) für produzierende
Mittelständler mit 5–50 Mio. € Umsatz (typisch 30–250 Mitarbeitende, 10–60 Maschinen),
die sich klassische MES-Projekte (Siemens Opcenter, SAP, MPDV …) nicht leisten.

Diese Demo zeigt einen **fiktiven Wiener Lohnfertiger** („Donau Präzisionstechnik GmbH“,
1220 Wien – Profil angelehnt an typische Wiener Zerspanungsbetriebe: Drehen, Fräsen,
Schleifen, Verzahnen, Tieflochbohren, Montage). Alle Daten sind simuliert. Der Firmenname
ist in den Einstellungen änderbar, damit die Demo bei verschiedenen Interessenten
eingesetzt werden kann.

Sprache der Oberfläche: **Deutsch** (österreichisch neutral, „du“ wird in der UI nicht verwendet,
neutrale Formulierungen). Zahlen deutsch formatiert (1.234,5), Zeiten 24h („08:45“).

---------------------------------------------------------------------------------------------

## 1. Architektur

Single-Page-App, ausgeliefert als **eine HTML-Datei** (`dist/werkfluss.html`), erzeugt von
`node werkfluss/build.mjs`. Quellen liegen in `werkfluss/src/` und werden in fester
Reihenfolge (Dateiname) zusammengefügt. **Keine ES-Module, keine Imports**: jede JS-Datei ist
ein IIFE `(function(){ ... })();` und hängt sich an das globale Objekt `window.WF`.

Three.js r147 (UMD, global `THREE`) und `THREE.OrbitControls` werden aus `werkfluss/vendor/`
inline eingebettet → die Demo läuft offline (Messe, Kundentermin ohne WLAN).

```
werkfluss/
  build.mjs           Build: shell.html + styles.css + vendor + src/*.js → dist/werkfluss.html
  SPEC.md             dieses Dokument (Vertrag zwischen den Modulen)
  src/
    shell.html        HTML-Gerüst (Platzhalter %%STYLE%% %%VENDOR%% %%SCRIPT%%)
    styles.css        Design-Tokens + globale Komponenten-Klassen
    00_core.js        WF-Namespace, Utilities, Event-Bus, RNG, Pfadsuche, UI-Helfer, Icons
    05_profile.js     Fabrikprofil: Layout, Maschinen, Werkzeuge, Material, Personal, Aufträge
    10_sim.js         Simulations-Engine (DOM-frei!)
    20_app.js         App-Shell: Navigation, Kopfzeile, Benachrichtigungen, Drawer, Toasts, Loop
    30_hall3d.js      Ansicht „Halle“ (Three.js)
    40_leitstand.js   Ansicht „Leitstand“
    41_orders.js      Ansicht „Aufträge“ (+ Plantafel) und Detail „order“
    42_machine.js     Detail „machine“ (Drawer)
    45_material.js    Ansicht „Material & Logistik“ + Details „agv“, „material“, „container“
    46_tools.js       Ansicht „Werkzeuge“ + Detail „tool“
    47_people.js      Ansicht „Personal“ + Detail „person“
    48_quality.js     Ansicht „Qualität“
    50_connect.js     Ansicht „Anbindung“ (Maschinen anschließen)
    60_ai.js          Copilot, Schichtbriefing, KI-Auftrag (Zeichnung → Arbeitsplan)
    99_boot.js        Start
  test/
    sim.test.mjs      Invarianten-Tests der Engine (Node, ohne DOM)
    smoke.mjs         Playwright-Smoke-Test aller Ansichten
```

### 1.1 Globale Schnittstellen (00_core.js)

```
WF.util  : clamp, lerp, round, rng(seed) → {next(),range(a,b),int(a,b),pick(a),normal(mu,s),chance(p)},
           fmtClock(t) "08:45", fmtDayClock(t) "Mo 08:45", fmtDur(sec) "1 h 05 min" / "12 min",
           fmtNum(n, dec), fmtPct(x, dec) (x in 0..1), fmtEur(n), fmtKg(n),
           uid(prefix) – fortlaufende IDs (deterministisch, Zähler),
           path(graph, fromNodeId, toNodeId) → {nodes:[ids], points:[{x,z}], length}  (Dijkstra, gecacht),
           nearestNode(graph, x, z) → nodeId, dist(a,b)
WF.bus   : on(type, fn) → off-Funktion, off(type, fn), emit(type, payload)
WF.ui    : el(tag, attrs, ...children), css(cssText) (fügt <style> einmalig ein), icon(name, size) → SVG-String,
           esc(str), spark(values, {w,h,color,fill,min,max}) → SVG-String,
           stateBand(segments [{t0,t1,state}], t0, t1, {w,h}) → SVG-String,
           pill(stateKey) → HTML-String, bar(frac, {color}) → HTML-String, initials(name)
WF.STATE : Metadaten aller Maschinenzustände {key:{label, color(css var), group}}
WF.views / WF.registerView(def) / WF.registerDetail(kind, factory)   (siehe §5)
```

Event-Bus-Typen (verbindlich):
- `sim:event`   – jedes Sim-Ereignis (Objekt `Event`, §3.9)
- `sim:notify`  – neue oder geänderte Benachrichtigung (Objekt `Notification`)
- `sim:reset`   – Simulation neu gestartet
- `select`      – `{kind, id}` (kind ∈ machine | order | person | agv | tool | material | container | notification)
- `navigate`    – `{view, params}`
- `ai:ask`      – `{text, context}` (öffnet Copilot und stellt Frage)
- `settings`    – Einstellungen geändert

---------------------------------------------------------------------------------------------

## 2. Fachliches Modell (Profil – 05_profile.js → `WF.profile`)

Koordinaten in **Metern**. Halle 64 m (x, links→rechts) × 40 m (z, hinten→vorne). y = oben.
Materialfluss grob links → rechts.

- `profile.company` – {name, site, address, employees, revenueHint, description}
- `profile.hall` – {w:64, d:40, zones:[{id,name,x,z,w,d,kind}], doors, walls}
- `profile.graph` – Wegenetz (Gänge): {nodes:{id:{x,z}}, edges:[[a,b]]}. Personen, AGVs und Stapler
  bewegen sich NUR entlang dieser Kanten (plus letztes kurzes Stück zum Arbeitspunkt).
- `profile.stations` – alles, wo Material liegt/bearbeitet wird: Maschinen, QS (Messraum),
  Montage, Lagerorte. Jede Station: `{id, kind, name, short, dock (nodeId), work:{x,z}, inPos:{x,z}, outPos:{x,z}, ...}`
- `profile.machines` – Liste der Maschinen-IDs in Anzeigereihenfolge (Teilmenge der Stations)
- `profile.toolTypes` – Werkzeugtypen {id, name, kind, lifeMin (Standzeit in Schnittminuten), cost, presetMin}
- `profile.materials` – Rohmaterial {id, name, form ('Stange'|'Platte'|'Stk'), unit ('m'|'Stk'), onHand, min,
  reorderQty, supplier, leadMin, location (stationId), pricePerUnit}
- `profile.people` – {id, name, role, shift ('F'|'S'), skills:[...], machines:[...], home:{x,z}}
- `profile.agvs` – {id, name, maxKg, speed, start (nodeId)}
- `profile.shifts` – Früh 06:00–14:00, Spät 14:00–22:00 inkl. Pausen
- `profile.orders` – Fertigungsaufträge inkl. Arbeitsplan (Routing) und Anfangszustand (§2.2)
- `profile.faults` – Störungskatalog je Steuerungstyp
- `profile.sim` – {seed, startT, warmupUntilT, defaultSpeed, toolPolicy:{planAtParts:2}, ...}

### 2.1 Maschinen (Station kind 'machine' | 'qs' | 'assembly')
Felder (zusätzlich zu Station): `type` (saw | lathe | swiss | biglathe | mill5 | mill3 | deephole | hobber |
cylgrinder | surfgrinder | washer | cmm | assembly), `vendor`, `model`, `control`, `year`,
`footprint:{x,z,w,d}`, `facing` ('S' = Front zeigt nach +z, 'N' = nach −z),
`automation` ('barfeeder' | 'pallet' | 'magazine' | 'loader' | 'none'),
`loading` ('auto' = läuft autonom Teil für Teil | 'perPart' = Bediener muss jedes Teil einlegen, Dauer `loadMin` |
'attended' = Person muss während der ganzen Bearbeitung anwesend sein (QS, Montage)),
`skill` (Qualifikationsschlüssel), `rate` (Maschinenstundensatz €/h), `power:{idle,run}` (kW),
`inCap` / `outCap` (Pufferplätze in Behältern), `mtbfH` (mittlere Laufzeit zwischen Störungen in h),
`conn:{level 0..3, protocol, gateway}`.

Anschluss-Level: 0 = nicht angebunden (manuelle Rückmeldung per Tablet), 1 = Nachrüst-Sensorik
(Stromsensor + Signalsäule: Zustand, Laufzeit), 2 = Steuerung gelesen (OPC UA / MTConnect / FOCAS:
Programm, Spindel, Override, Alarme, Stückzähler), 3 = zusätzlich Werkzeug- und Programmdaten.

### 2.2 Aufträge
```
{ id:'FA-24117', customer, part:{no, name, material, drawing, weightKg}, qty, due (Sim-Sekunden),
  priority: 'normal'|'eil', status, note,
  routing: [ { seq:10, op:'Langdrehen', station:'M03', setupMin, cycleMin,
               tools:[{type:'TT-…', cutMinPerPart}], material:{id, perPart} (nur erster Schritt),
               transferBatch (Teile je Behälter), firstPiece (bool), loadMin?,
               ext?:{partner, process, leadMin}  (Fremdbearbeitung, station:'EXT') } ],
  initial: { ops:{ [seq]:{done, scrap, atInput:[behältermengen], atOutput} }, activeSeq, setupDone, fpiReleased } }
```
Spezielle Stationen im Routing: `'EXT'` (Fremdbearbeitung – Härterei), `'QS'` (Messraum),
`'VERSAND'` (letzter Schritt, nur Ablage – kein Bearbeitungsschritt), `'M13'` Montage.

---------------------------------------------------------------------------------------------

## 3. Simulations-Engine (10_sim.js → `WF.sim`)

**DOM-frei** (läuft auch in Node für Tests: kein `window.document`, kein `requestAnimationFrame`).
Alle Zufallswerte ausschließlich über den geseedeten RNG → **deterministisch**: gleicher Seed +
gleiche Aktionen ⇒ identischer Zustand.

### 3.1 Zeit
- `state.t` = Sim-Sekunden ab Montag 00:00. Start `profile.sim.startT` (Mo 06:00), beim Boot wird
  synchron bis `warmupUntilT` (Mo 08:40) vorgerechnet, damit Historie, KPIs und Log gefüllt sind.
- `sim.advance(simSeconds)` rechnet in festen Unterschritten von 1 s (max. 3600 Unterschritte je Aufruf).
- Geschwindigkeit wird von der App gesteuert (Voreinstellungen 10×, 30×, 120×, 600×; Standard 30×).
- Schichten: Früh 06:00–14:00 (Pausen 09:00–09:15, 12:00–12:30), Spät 14:00–22:00 (Pausen 17:00–17:15,
  19:30–20:00). Außerhalb: niemand im Dienst; autonome Maschinen (`loading:'auto'`) laufen weiter, solange
  Material, Werkzeug-Standzeit und Ausgangspuffer reichen („Geisterschicht“).

### 3.2 Maschinenzustände (WF.STATE, verbindlich)
| key | Label | Bedeutung |
|---|---|---|
| `running` | Produktion | Teil wird bearbeitet |
| `setup` | Rüsten | Person rüstet (Werkzeuge, Programm, Spannmittel) |
| `firstPiece` | Erstteilprüfung | Erstes Teil im Messraum, Maschine wartet auf Freigabe |
| `toolchange` | Werkzeugwechsel | Person wechselt Werkzeug (nur zwischen zwei Teilen) |
| `waitTool` | Wartet auf Werkzeug | Standzeit reicht nicht für das nächste Teil, Einrichter noch nicht da |
| `waitOperator` | Wartet auf Bediener | Einlegen/Rüsten nötig, niemand verfügbar (Pause, Schichtende, beschäftigt) |
| `starved` | Wartet auf Material | Auftrag aktiv, aber kein Teil im Eingangspuffer / kein Rohmaterial |
| `blocked` | Ausgang voll | Ausgangspuffer voll, Abholung ausstehend |
| `fault` | Störung | Alarm aktiv, Instandhaltung nötig |
| `idle` | Bereit | kein Auftrag eingeplant |

Jeder Zustandswechsel erzeugt ein `Event` mit `type:'state'`, `data:{from,to,cause}` (Ursache als Text).
Pro Maschine werden Zustandsdauern akkumuliert (heute, laufende Schicht) und Zustandssegmente für das
Zustandsband gespeichert (`m.segments: [{t0,t1,state}]`, letzte 24 h).

### 3.3 Ablauf je Maschine (Regeln)
1. **Auftragswahl**: Jede Maschine bearbeitet genau einen Arbeitsgang (`m.op`) gleichzeitig. Ist der aktuelle
   Arbeitsgang fertig (alle Teile bearbeitet), wählt sie den nächsten für sie eingeplanten Arbeitsgang:
   Priorität 'eil' zuerst, dann früheste Fälligkeit, dann Auftragsnummer. Ein Arbeitsgang ist wählbar, sobald
   der Auftrag freigegeben ist – das **Rüsten darf vor Materialeingang beginnen**.
2. **Rüsten**: Benötigt eine Person mit passender Qualifikation (Einrichter: alle CNC; Bediener: ihre Maschinen),
   die zur Maschine geht und `setupMin` dort arbeitet. Beim Rüsten werden alle Werkzeuge des Arbeitsgangs mit
   **neuen (vermessenen) Werkzeugen** bestückt (Standzeitverbrauch 0). Danach, falls `firstPiece`: genau ein Teil
   fertigen → Zustand `firstPiece`, QS-Prüfer:in holt das Teil, misst im Messraum (`fpiMin` je Maschine, 10–25 min),
   Ergebnis i.O. (≥ 93 %) → Freigabe (Event), sonst Korrektur (Einrichter, 10 min) und erneutes Erstteil.
3. **Teil starten** nur wenn ALLE Bedingungen erfüllt:
   a) Eingangsteil vorhanden (bzw. beim ersten Schritt Rohmaterial verfügbar: Säge zieht direkt aus dem Lager,
      Stangenlader-Maschinen aus ihrem Stangenmagazin `m.barStockM`, andere erster Schritt aus einem
      Rohteile-Behälter im Eingangspuffer),
   b) Ausgangspuffer nicht voll (sonst `blocked`),
   c) **jedes** Werkzeug des Arbeitsgangs hat Reststandzeit ≥ `cutMinPerPart` (sonst `waitTool` bzw. Wechsel),
   d) bei `loading:'perPart'`: ein Bediener hat das Teil eingelegt (`loadMin`); bei `'attended'` ist die Person
      während der gesamten Bearbeitung anwesend,
   e) keine Störung, Freigabe nach Erstteilprüfung liegt vor.
4. **Bearbeitung**: Dauer = `cycleMin` × (1 ± 3 % Streuung). Am Teilende: Werkzeug-Standzeitverbrauch +=
   `cutMinPerPart` je Werkzeug; Messwert des Hauptmerkmals = Nennmaß + Drift(Verschleiß) + Rauschen;
   außerhalb Toleranz → Ausschuss (Behälter „Sperrlager“). Gutteil → Ausgangspuffer.
5. **Weitergabe**: Erreicht der Ausgangspuffer `transferBatch` Teile dieses Arbeitsgangs (oder ist der Arbeitsgang
   fertig), entsteht ein Behälter (`Container`) und ein Transportauftrag zur nächsten Station.
6. **Schleifscheiben** (kind 'wheel'): zusätzlich alle `dressEvery` Teile automatisches Abrichten (1,5 min,
   Zustand bleibt `running`, Aktivität „Abrichten“).

### 3.4 Werkzeug-Standzeit (die eine, sichtbare Regel)
- Verschleiß in % = `used / life`. Er steigt **nur am Ende eines bearbeiteten Teils** und **nie über 100 %**.
- `remainingParts = floor((life − used) / cutMinPerPart)`.
- Sobald `remainingParts ≤ toolPolicy.planAtParts` (2) → Werkzeugwechsel wird **geplant** (Event `toolPlanned`,
  Info-Benachrichtigung an Einrichter mit geschätzter Uhrzeit). Der Einrichter holt ein vermessenes Werkzeug in
  der Werkzeugausgabe (3 min), geht zur Maschine und wechselt **an der nächsten Teilegrenze, an der
  remainingParts ≤ planAtParts gilt** (Zustand `toolchange`, 3–6 min). Altes Werkzeug → „Nachschliff“ oder
  „verschrottet“ (Kosten). Event `toolChanged` mit Grund.
- Ist `remainingParts = 0` und der Einrichter noch nicht da → `waitTool` (Warnung nach 3 min).
- Es wird **niemals** mit unzureichender Standzeit geschnitten und **niemals** mitten im Teil gewechselt.
- Die UI zeigt pro Werkzeug: Verschleiß-%, „noch N Teile“, geplanter Wechsel „nach Teil 37 · ca. 10:42“.

### 3.5 Personen
- Zustände: `idle` (verfügbar), `walking` (geht), `working` (arbeitet: rüsten, einlegen, messen, montieren,
  reparieren, Werkzeug wechseln, voreinstellen), `driving` (Stapler), `break` (Pause), `offShift`.
- Aufgaben (`Task`): `setup`, `load`, `toolChange`, `fpi`, `inspect`, `repair`, `forklift`, `bars`, `assembly`,
  `correction`. Vergabe jede Sekunde an freie, qualifizierte Personen im Dienst: höchste Priorität zuerst
  (repair > toolChange-wartend > fpi > setup > load > forklift/bars > inspect > assembly > toolChange-geplant),
  bei Gleichstand die nächstgelegene Person. Eine Person hat höchstens eine Aufgabe.
- Bewegung entlang `profile.graph` (1,3 m/s; Stapler 2,0 m/s). Positionen `p.pos {x,z}`, `p.heading` (rad).
- Pause / Schichtende: laufende Aufgabe wird noch beendet, danach Pause bzw. Feierabend (Person verlässt die Halle
  über Gang zu `home`, wird als `offShift` nicht gerendert).

### 3.6 Logistik (AGVs, Stapler)
- `TransportTask`: {id, containerId|null, kind ('container'|'bars'|'ext-out'|'ext-in'|'supply'), from:{station},
  to:{station}, weightKg, mode ('AGV'|'Stapler'), status ('open'|'assigned'|'toPickup'|'loaded'|'toDrop'|'done'),
  assignee, createdT, doneT}.
- Behälter ≤ 250 kg → AGV, sonst Stapler (Logistiker:in). Stangenmaterial immer Stapler/Logistik.
- AGV-Zustände: `idle`, `toPickup`, `loading`, `toDrop`, `unloading`, `toCharge`, `charging`, `blocked`.
  Akku 0–100 %: Verbrauch 0,05 %/s Fahrt, Laden 0,12 %/s. Unter 25 % → Ladestation (`CHG`).
  Be-/Entladen je 30 s. AGVs fahren auf dem Wegenetz; Position `a.pos`, `a.heading`, `a.load` (containerId).
- Fremdbearbeitung (`EXT`, Härterei): Behälter wird zur Bereitstellung `EXT` gebracht, verlässt die Halle
  („bei Härterei Wolf (Beispiel)“), kommt nach `leadMin` im Wareneingang `WE` zurück → Transport zur nächsten Station.
- Rohmaterial: Entnahme bucht `onHand` ab. Unter `min` → Warnung „Mindestbestand unterschritten“ mit
  Bestellvorschlag (Aktion `reorder`). Bestellung trifft nach `leadMin` ein (Event `delivery`).

### 3.7 Qualität
- Erstteilprüfung (§3.3), Losprüfung an Station `QS` (Messraum, `loading:'attended'`, Prüfer:in).
- Je Arbeitsgang ein Hauptmerkmal `{name, nominal, tolMinus, tolPlus, unit}` (aus dem Profil oder
  Engine-Default je Maschinentyp); Messwerte werden gespeichert (letzte 200 je Arbeitsgang) für SPC.
- Kennzahlen: FPY (Gutteile/alle), Ausschuss je Ursache (Maß, Werkzeugbruch, Erstteil n.i.O.).

### 3.8 Störungen
- Zufällig nach `mtbfH` (Exponentialverteilung, nur während `running`) oder per Aktion `triggerFault`.
- Alarm `{code, text, cause}` aus `profile.faults`; Instandhalter:in (Frühschicht) bzw. Einrichter:in (Spätschicht)
  repariert `repairMin` (10–45 min). Ein laufendes Teil bei „Werkzeugbruch“ wird Ausschuss und das betroffene
  Werkzeug muss getauscht werden.

### 3.9 Ereignisse und Benachrichtigungen
```
Event        { id, t, type, sev ('info'|'warn'|'crit'|'ok'), entity:{kind,id}, msg, data }
Notification { id, t, sev, title, body, role ('Schichtleitung'|'Einrichter'|'QS'|'Logistik'|'Instandhaltung'|'Einkauf'),
               entity:{kind,id}, status ('open'|'ack'|'resolved'), ackBy, ackT, resolvedT,
               suggestion (Text: Ursache + Empfehlung), actions:[{label, action:{type, ...}}], key (Dedup) }
```
Regeln (mindestens): Störung (crit), Maschine wartet > 5 min auf Material/Bediener/Werkzeug (warn),
Werkzeugwechsel geplant (info), Erstteilprüfung wartet > 10 min (warn), Mindestbestand (warn),
Termin gefährdet laut Prognose (warn), AGV-Akku niedrig (info), SPC-Trend (warn), Auftrag fertig (ok),
Schichtwechsel (info). Benachrichtigungen werden automatisch `resolved`, wenn die Ursache entfällt.
Deduplizierung über `key`.

### 3.10 Öffentliche API `WF.sim`
```
init(profile)                 → baut Zustand neu auf (deterministisch), feuert 'sim:reset'
advance(simSeconds)           → rechnet weiter (Unterschritte 1 s)
state                         → kompletter Zustand (nur lesen!)
  state.t, state.machines{id}, state.people{id}, state.agvs{id}, state.orders{id}, state.containers{id},
  state.transports{id}, state.materials{id}, state.tools{id}, state.toolStock{typeId:{ready, regrind, scrapToday}},
  state.events [ringpuffer 3000], state.notifications [..], state.history{...}, state.kpi{...}
clock()                       → "Mo 08:45"; shift() → {id,name,inBreak,endsAt}
machineView(id)               → abgeleitete Sicht (Status-Label/Farbe, Auftrag, Teil x/y, ETA Arbeitsgang,
                                Werkzeuge mit Verschleiß/RestTeile/Wechselplan, Bediener, Puffer, OEE heute, Signale)
orderView(id)                 → Fortschritt je Arbeitsgang, Ort der Behälter, Prognose fertig, Risiko
forecast()                    → {machines:{id:[{orderId,seq,start,end}]}, orders:{id:{eta,late}}}
kpis()                        → {oee, availability, performance, quality, good, scrap, fpy, onTimePct,
                                lossEur, energyKwh, powerKw, wip, transportsToday, toolCostToday}
snapshot()                    → kompakte JSON-Sicht für die KI (< 12 kB)
history                       → Zeitreihen alle 5 Sim-min: t[], good[], oee[], powerKw[], wip[], perMachine{id:state[]}
actions.triggerFault(machineId, code?)       actions.repair(machineId)  (sofort, nur Demo)
actions.ack(notificationId, by)              actions.resolve(notificationId)
actions.reorder(materialId, qty?)            actions.setPriority(orderId, 'eil'|'normal')
actions.addOrder(spec) → orderId             actions.moveOp(orderId, seq, stationId)  (Alternativmaschine)
actions.connectMachine(machineId, level, protocol)
actions.reset()
```

### 3.11 Invarianten (test/sim.test.mjs prüft sie über ≥ 36 Sim-Stunden)
1. Werkzeug: `0 ≤ used ≤ life` immer; `toolChanged` nur wenn `partProgress === 0`.
2. Maschine `running` ⇒ Arbeitsgang aktiv, Eingangsteil reserviert, alle Werkzeuge mit Reststandzeit ≥ Bedarf.
3. Mengenbilanz je Auftrag und Arbeitsgang: erhalten = gut + Ausschuss + in Bearbeitung + wartend;
   gut = weitergegeben + im Ausgangspuffer; weitergegeben = beim Nachfolger erhalten + unterwegs.
4. Rohmaterial `onHand ≥ 0`; AGV-Last ≤ maxKg; Akku in [0, 100].
5. Eine Person hat ≤ 1 Aufgabe; niemand arbeitet `offShift` (außer laufende Aufgabe beendet sich).
6. Jeder Maschinen-Zustandswechsel hat ein Event mit Ursache.
7. Kein Deadlock: alle Aufträge des Profils sind nach 60 Sim-Stunden fertig oder nachvollziehbar wartend
   (Fremdbearbeitung/Material) – keine Maschine steht > 4 h in `waitOperator` während einer Schicht.
8. Determinismus: gleicher Seed ⇒ identischer Zustands-Hash nach 24 h.
9. KPIs in [0, 1], Zeit monoton.

---------------------------------------------------------------------------------------------

## 4. Ansichten (Navigation links)

| id | Titel | Inhalt |
|---|---|---|
| `leitstand` | Leitstand | KPI-Leiste, Kachel je Maschine (Status, Auftrag, Teil x/y, ETA, Werkzeug-Restteile, Bediener, Anschluss-Level, Zustandsband 4 h), Live-Benachrichtigungen, KI-Schichtbriefing, „Gerade passiert“ |
| `halle` | Halle 3D | Three.js-Hallenmodell, realistische Maschinen, Personen, AGVs, Behälter, Materialfluss- und Datenfluss-Ebenen, Klick → Details |
| `auftraege` | Aufträge | Auftragsliste mit Arbeitsplan-Kette, Prognose, Termin-Risiko; Plantafel (Gantt je Maschine: Ist + Prognose) |
| `material` | Material & Logistik | Rohmaterialbestände, Behälter/WIP, Transportaufträge, AGV-Flotte, Materialfluss-Diagramm (Station → Station) |
| `werkzeuge` | Werkzeuge | Werkzeuge in den Maschinen, Standzeiten, Wechselplan (Zeitleiste), Werkzeugausgabe-Bestand, Kosten |
| `personal` | Personal | Schicht, wer ist wo und tut was, Auslastung, Qualifikationsmatrix |
| `qualitaet` | Qualität | FPY, Ausschuss nach Ursache, SPC-Regelkarte je Merkmal, Messprotokoll, Erstteilprüfungen |
| `anbindung` | Anbindung | Anschluss-Level je Maschine, Assistent „Maschine anschließen“ (Protokoll, Signal-Mapping mit KI, Live-Test) |
| `ki-auftrag` | KI-Auftrag | Zeichnung hochladen/Beispiel wählen → KI erstellt Arbeitsplan, Zeit- und Preisschätzung → Auftrag einlasten |

Global: Kopfzeile (Firma, Uhr + Schicht, Tempo, Glocke mit Benachrichtigungscenter, Copilot-Knopf, Einstellungen),
rechter Detail-Drawer, Toasts.

## 5. View- und Detail-API (20_app.js)

```
WF.registerView({ id, title, icon, order,
                  mount(rootEl),          // einmalig beim ersten Anzeigen
                  show?(), hide?(),       // bei Wechsel
                  update?(),              // ca. 4×/s solange sichtbar
                  frame?(dtReal) })       // jedes Animationsframe solange sichtbar (nur Halle)
WF.registerDetail(kind, id => ({ title, subtitle, render(el), update?(el) }))
WF.app.select(kind, id)     WF.app.navigate(viewId, params)     WF.app.toast(msg, sev)
WF.app.settings             // {companyName, speed, ...}
```
Views dürfen `WF.sim.state` nur lesen und Aktionen ausschließlich über `WF.sim.actions.*` auslösen.
CSS: globale Klassen aus `styles.css` verwenden; view-spezifisches CSS per `WF.ui.css()` mit Präfix
(z. B. `.ls-…` für Leitstand), damit nichts kollidiert.

## 6. KI (60_ai.js)
- Copilot-Drawer: Chat, kennt `WF.sim.snapshot()`, darf über Tools lesen und handeln
  (Störung auslösen/quittieren, Priorität setzen, Nachbestellung, Arbeitsgang verlagern, Ansicht/Detail öffnen).
- Läuft auf claude.ai mit der Artifact-Capability `sample` (Tools + Bilder); sonst Offline-Modus mit
  regelbasiertem Agenten, der die häufigsten Fragen korrekt aus den Live-Daten beantwortet.
- Schichtbriefing (Leitstand-Karte), „Ursache analysieren“ bei Benachrichtigungen, KI-Auftrag.

## 7. Gestaltung
- Dunkles Leitstand-Design (bewusst einheitlich dunkel), Farben ausschließlich über Tokens aus `styles.css`.
- Zustandsfarben semantisch: Produktion grün, Rüsten blau, Warten amber, Störung rot, Werkzeugwechsel violett,
  Bereit grau. Material-Fluss orange, Informations-Fluss cyan.
- Schrift: „Barlow“ (UI), „Barlow Condensed“ (Labels/Ziffern groß), „JetBrains Mono“ (Daten); Fallback System.
- Muss bei 400 px Breite benutzbar bleiben (Navigation wird zur Leiste oben), keine horizontale Seiten-Scrollbar.
