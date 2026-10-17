/* werkfluss – Simulations-Engine (10_sim.js → WF.sim)
   ----------------------------------------------------------------------------------------------
   DOM-frei: läuft im Browser und in Node (Tests). Deterministisch: alle Zufallswerte über den
   geseedeten RNG (WF.util.rng(profile.sim.seed)), keine Uhrzeit, kein Math.random.

   Aufbau eines Sim-Schritts (1 s, siehe step()):
     Schicht/Pausen → Lieferungen & Fremdbearbeitung → Maschinen (Zustandsautomat §3.2/§3.3)
     → Transporte (AGV/Stapler) → Aufgabenvergabe an Personen → Personen bewegen/arbeiten
     → AGVs → Kennzahlen/Energie → Regeln & Benachrichtigungen → Historie

   Grundsatz „kein sinnloser Ablauf“: Jede Zustandsänderung läuft über eine Funktion, die eine
   Ursache (Text) mitschreibt (setState → Event 'state' {from,to,cause}). Werkzeuge folgen genau
   einer sichtbaren Regel (§3.4, toolCheck()/planTools()). Personen tun nur, was eine Aufgabe (Task) verlangt.

   Öffentliche API (WF.sim) – verbindliche Feldliste: werkfluss/ENGINE_API.md
     init(profile) · reset() · advance(simSeconds) → Anzahl Schritte · step()
     state (Getter, Objekt-Identität bleibt über Resets erhalten) · history · t · speedHint
     clock() → "Mo 08:45" · shift() → {id,name,inBreak,endsAt,breakEndsAt}
     machineView(id) · orderView(id) · forecast() · kpis() · snapshot() · LABELS / label(group, key)
     bottleneck() · occupancy() · workContent() · whatIf(spec) · whatIfPriority(orderId) · orderAdvice(orderId)
     actions.{triggerFault, repair, ack, resolve, reorder, setPriority, addOrder, moveOp, connectMachine,
       applyOffset, planToolChange, planRemake, releaseIntake, run, reset} → {ok,msg,…}; addOrder → Auftrags-ID (String) bzw. {ok:false,msg}
     runAction({type,…}) führt Benachrichtigungs-Aktionen aus (reorder, setPriority, applyOffset, planToolChange, select …)

   Bewusste Ergänzungen gegenüber SPEC (alle sichtbar begründet):
     - Disposition: Eil → Material-Bereitschaft (am Platz/unterwegs vor „kommt bald“) → Termin → Auftragsnummer.
       Rüsten vorab nur, wenn das Material spätestens kurz nach Rüstende eintrifft. Arbeitsplätze ohne
       Rüstaufwand (Waschen, Messraum, Montage) geben einen leer gearbeiteten Arbeitsgang frei.
     - Werkzeug (§3.4): Wechselgrenze je Werkzeug = min(planAtParts, ⌊10 % Standzeit / Schnittzeit je Teil⌋) Teile –
       lange Schnitte (BTA-Kopf, Wälzfräser) werden erst gewechselt, wenn kein Teil mehr geht (≤ 10 % Standzeit ungenutzt).
       Geplant/angekündigt wird mit Vorlauf max(planAtParts, Holzeit/Taktzeit) Teile; während ein Teil läuft, zählt der
       Stand „nach diesem Teil“ – jedes getauschte Werkzeug war mindestens ein Teil vorher in der Ansicht „geplant“.
       Mitwechseln: Wird ohnehin gewechselt, kommen Werkzeuge mit, deren eigener Wechsel in ≤ 30 min käme, die ≤ 35 %
       Standzeit haben und deren Rest weniger kostet als ein zweiter Stopp. Kein Wechsel, wenn die Reststandzeit für den
       Rest des Arbeitsgangs reicht. Sägeband/Schleifscheibe/Wälzfräser gleichen Typs bleiben beim Rüsten montiert.
       Wechseldauer je Werkzeugart; nach Wechsel eines Formwerkzeugs (Wälzfräser, Schleifscheibe) wird das erste Teil an
       der Maschine kontrolliert. Werkzeugbruch nur während der Bearbeitung (Teil Ausschuss, realer Verschleiß bleibt).
       Vorbeugender Wechsel (Aktion planToolChange, z. B. aus der Geisterschicht-Meldung) steht als Auftrag an der
       Maschine (manualTC, optional „nicht vor“) und ist in machineView sichtbar.
     - Messwert = Toleranzmitte + Drift·Verschleiß (+ Korrekturwert) + Rauschen; an Einlege-Arbeitsplätzen
       kompensiert der Bediener 60 % der Drift. Erstteil n.i.O. wegen Nebenmerkmal → Nacharbeit statt Ausschuss.
       SPC-Korrektur gibt eine Person an der Maschine ein (Aufgabe „Werkzeugkorrektur eingeben“).
     - Ausschuss im 1. Arbeitsgang wird aus Rohmaterial nachgefertigt („Teil 405/407 … inkl. 7 Ersatz für Ausschuss“);
       Ausschuss in Folgearbeitsgängen fehlt in der Liefermenge (Fehlmengen-Meldung, Fertigmeldung „Teillieferung“).
     - Werkzeugwechsel-Logistik: Einrichter:in wird so losgeschickt, dass sie kurz vor der Ziel-Teilegrenze da ist
       (Vorlauf inkl. Voreinstellen bei leerer Werkzeugausgabe); ist niemand im Dienst, nennt die Planung „frühestens
       06:0x (Frühschicht)“ und den Stopp dazwischen. Steht sie sinnlos an der Maschine (Störung, Teilegrenze > 10 min
       entfernt, Maschine fertigt nicht), legt sie das Werkzeug bereit und übernimmt andere Aufgaben. Endet das Teil in
       ≤ 3 min, wird vor der Pause noch gewechselt bzw. eingelegt. Keine Aufgabe überlebt ihren Arbeitsgang.
     - Personal: lange Arbeiten werden kurz vor Pause/Schichtende nicht mehr begonnen (≤ 10 min Überzug, letzte Schicht
       ≤ 20 min); bemannte Bearbeitung (Messraum, Montage) wird für Pausen unterbrochen und danach fortgesetzt; wer eine
       Pause durcharbeiten musste, holt sie nach. Reparaturen: Instandhaltung, sonst Einrichter:in (nicht Schichtleitung).
     - Fremdbearbeitung: Behälter gehen als Los (transferBatch bzw. Restmenge) zum Partner, spätestens nach 24 h als Teillos.
       Erster Schritt Fremdbearbeitung (Lohnhärten) = Beistellteile des Kunden aus dem Wareneingang.
     - Prognose: Arbeitsplätze ohne Rüstaufwand sind nur für die Bearbeitungszeit belegt; Rüsten vorab vor Materialeingang;
       Materialeingang des Nachfolgers = erster abgabefertiger Behälter; Lose der Fremdbearbeitung; Cache über Plan-Version.
       Veröffentlichte Liefertermine (eta) werden geglättet: Sprünge > 15 min erst nach Bestätigung (5-min-Takt).
       „Termin gefährdet“ erst, wenn zwei Prüfungen (10 min) hintereinander spät sind.
     - Arbeitsgang verlagern (moveOp) prüft Leistungsgrenzen je Maschinentyp (Gewicht, Ø, Stange, 5-Achs).
     - Auftragseingang (Dauerbetrieb): Vorlagen aus profile.orderTemplates werden zu Schichtbeginn und bei wenig Vorrat
       belastungsorientiert freigegeben (eigener RNG); Kanban-Abruf, wenn Bestand + Bestellungen den Bedarf nicht decken;
       fertige Aufträge werden nach 72 h archiviert (begrenzter Zustand).
     - Wendeschneidplatten: Schneide wenden durch den Bediener (1–2 min), Tausch erst nach der letzten Schneide.
     - Geisterschicht-OEE: autonome Maschinen mit freigegebenem Arbeitsgang haben nachts geplante Zeit; Leistung zählt das
       laufende Teil anteilig (beim Lesen). Engpass = bottleneck() (eine Definition), Empfehlungen aus Was-wäre-wenn (orderAdvice).
     - Ausschuss nach AG 10: sofort „Menge gefährdet“ mit Nachfertigung (planRemake).
*/
(function () {
  'use strict';
  const G = typeof window !== 'undefined' && window ? window : globalThis;
  const WF = G.WF = G.WF || {};
  const U = WF.util;
  const DAY = 86400, WEEK = 7 * DAY;

  // ------------------------------------------------------------------ Konfiguration
  const CFG = {
    precallSec: 150,       // perPart: Bediener wird so viele s vor Zyklusende gerufen (kein Leerlauf)
    agvHandleSec: 30,      // Be-/Entladen (aus profile.sim.agvLoadSec)
    fpiPickSec: 30,        // Erstteil an der Maschine entnehmen
    fpiLocalSec: 300,      // Kontrolle des ersten Teils nach Formwerkzeug-Wechsel an der Maschine (Zahnweite/Durchmesser)
    correctionSec: 600,    // Korrektur nach Erstteil n.i.O. (10 min)
    dressSec: 90,          // Abrichten Schleifscheibe (1,5 min)
    extHandoverSec: 1200,  // Bereitstellung Fremdbearbeitung → Abholung Spedition
    extMaxWaitSec: 86400,  // unvollständiges Los geht spätestens nach 24 h als Teillos
    barsPickSec: 90, barsLoadSec: 180, barLenM: 3,
    waitWarnSec: 300, toolWarnSec: 180, fpiWarnSec: 600,
    idleHomeSec: 40,
    // Personal: Aufgabe darf höchstens so weit über Pause/Schichtende hinausgehen (Übergabe an die nächste Schicht: 10 min,
    // letzte Schicht des Tages: 20 min); bemannte Teile (Messraum, Montage) werden für die Pause unterbrochen, wenn sie noch
    // länger als attendFinishSec dauern; wer durcharbeitet, holt die Pause nach (später als makeupLateSec → volle Länge)
    overrunSec: 600, overrunLastSec: 1200, attendFinishSec: 600, makeupLateSec: 300,
    pickEverySec: 10, switchCheckSec: 30,
    spcReactSec: 300,      // SPC-Trend: nach 5 min gibt Bediener/Einrichter die Korrektur an der Maschine ein
    batteryLow: 25, batteryFull: 90, batteryAssign: 30, agvDrain: 0.006, agvCharge: 0.05, agvLoadedFactor: 0.8,
    basePowerKw: 12,
    eventsMax: 3000, notificationsMax: 400, measMax: 200, transportsKeepSec: DAY, toolsKeep: 150,
    // Werkzeug: Wechselfenster ≤ 10 % der Standzeit; Mitwechseln, wenn der eigene Wechsel in ≤ 30 min käme, höchstens 35 %
    // der Standzeit übrig sind und der Rest der Schneide weniger kostet als ein zweiter Stopp (Maschinenstundensatz × Wechseldauer)
    changeFrac: 0.10, bundleSec: 1800, bundleFrac: 0.35,
    // Wechseldauer je Werkzeugart in min (Wendeplatten: profile.sim.toolPolicy.changeMin)
    changeMinByKind: { insert: [3, 6], drill: [5, 8], mill: [4, 7], hob: [20, 30], wheel: [30, 45], saw: [10, 15] },
    // Wendeschneidplatte wenden (nächste Schneide) durch den Bediener an der Maschine – kein Gang zur Werkzeugausgabe
    indexMin: [1, 2], indexLeadSec: 120,
  };
  // Vergabe-Priorität (§3.5): repair > toolChange-wartend > fpi > setup > load > forklift/bars > inspect > assembly > toolChange-geplant
  const PRIO = { repair: 100, toolChangeWait: 90, fpi: 80, correction: 72, setup: 70, load: 60, forklift: 50, bars: 50, offset: 74, inspect: 40, assembly: 35, toolChange: 30 };
  const TASK_LABEL = { setup: 'Rüsten', load: 'Einlegen', toolChange: 'Werkzeugwechsel', fpi: 'Erstteilprüfung', inspect: 'Losprüfung',
    repair: 'Reparatur', forklift: 'Staplertransport', bars: 'Stangen nachladen', assembly: 'Montage', correction: 'Korrektur', offset: 'Werkzeugkorrektur eingeben' };
  /** Deutsche Bezeichnungen aller Schlüssel, die Ansichten anzeigen (eine Wahrheit für alle Module) – WF.sim.LABELS */
  const LABELS = {
    person: { idle: 'Verfügbar', walking: 'Unterwegs', working: 'Arbeitet', driving: 'Fährt Stapler', break: 'Pause', offShift: 'Nicht im Dienst' },
    agv: { idle: 'Bereit', toPickup: 'Fährt zur Abholung', loading: 'Lädt auf', toDrop: 'Fährt zum Ziel', unloading: 'Lädt ab', toCharge: 'Fährt zur Ladestation', charging: 'Lädt Akku', blocked: 'Blockiert' },
    forklift: { parked: 'Abgestellt', driving: 'Im Einsatz' },
    transport: { open: 'Offen', assigned: 'Zugeteilt', toPickup: 'Unterwegs zur Abholung', loaded: 'Beladen', toDrop: 'Unterwegs zum Ziel', done: 'Erledigt' },
    transportKind: { container: 'Behälter', bars: 'Stangenmaterial', 'ext-out': 'Zur Fremdbearbeitung', 'ext-in': 'Aus Fremdbearbeitung', supply: 'Rohteile / Beistellteile', empty: 'Leergut' },
    transportPhase: { geplant: 'Geplant (Ziel voll)', wartend: 'Wartet auf Fahrzeug', unterwegs: 'Unterwegs', erledigt: 'Erledigt' },
    transportMode: { AGV: 'AGV', Stapler: 'Stapler' },
    container: { filling: 'Wird befüllt', ready: 'Abholbereit', transit: 'Unterwegs', input: 'Im Eingang', external: 'In Fremdbearbeitung', shipped: 'Im Versand', scrap: 'Sperrlager' },
    containerKind: { parts: 'Teile', raw: 'Rohteile', scrap: 'Ausschuss' },
    opState: { active: 'In Bearbeitung', waiting: 'Wartet', done: 'Fertig', open: 'Offen', external: 'In Fremdbearbeitung' },
    orderStatus: { freigegeben: 'Freigegeben', 'in Arbeit': 'In Arbeit', fertig: 'Fertig' },
    priority: { normal: 'Normal', eil: 'Eilauftrag' },
    risk: { ok: 'Im Plan', knapp: 'Knapp', 'spät': 'Verspätet', unbekannt: 'Unbekannt' },
    task: TASK_LABEL,
    taskStatus: { open: 'Offen', assigned: 'Zugeteilt', done: 'Erledigt', cancelled: 'Entfallen' },
    toolStatus: { ok: 'In Ordnung', planned: 'Wechsel geplant', due: 'Standzeit erschöpft', broken: 'Gebrochen', changing: 'Wird gewechselt', missing: 'Nicht bestückt', idle: 'Nicht im Einsatz',
      replace: 'Wird beim Rüsten ersetzt', keep: 'Bleibt beim Rüsten montiert', setup: 'Beim Rüsten eingesetzt' },
    toolState: { mounted: 'Eingebaut', 'stock-used': 'Gebraucht in der Werkzeugausgabe', regrind: 'Zum Nachschliff', scrap: 'Verschrottet', indexed: 'Schneide verbraucht (Platte gewendet)' },
    toolAction: { index: 'Schneide wenden', replace: 'Werkzeug tauschen' },
    toolKind: { insert: 'Wendeschneidplatte', drill: 'Bohrer', mill: 'Fräser', hob: 'Wälzfräser', wheel: 'Schleifscheibe', saw: 'Sägeband' },
    fpiStage: { wait: 'Wartet auf Abholung (QS)', carry: 'Wird in den Messraum gebracht', hold: 'Wartet – Messmaschine gestört', measure: 'Wird gemessen' },
    notifStatus: { open: 'Offen', ack: 'Quittiert', resolved: 'Erledigt' },
    purchase: { bestellt: 'Bestellt', geliefert: 'Geliefert' },
    conn: { 0: 'Nicht angebunden (Tablet-Rückmeldung)', 1: 'Nachrüst-Sensorik (Strom, Signalsäule)', 2: 'Steuerung gelesen', 3: 'Steuerung + Werkzeug-/Programmdaten' },
    loading: { auto: 'Läuft autonom', perPart: 'Bediener legt jedes Teil ein', attended: 'Person während der Bearbeitung anwesend' },
    stackLight: { green: 'Grün (Produktion)', yellow: 'Gelb (Warten/Rüsten)', red: 'Rot (Störung)', off: 'Aus' },
  };
  // Engine-Default-Hauptmerkmal je Maschinentyp (falls im Arbeitsgang kein char definiert ist)
  const DEFAULT_CHAR = {
    saw:        { name: 'Zuschnittlänge (Abw.)', nominal: 0, tolMinus: -0.5, tolPlus: 0.5, unit: 'mm', sigma: 0.1, driftAt100: 0.15 },
    lathe:      { name: 'Durchmesser (Abw.)', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.004, driftAt100: 0.008 },
    swiss:      { name: 'Durchmesser (Abw.)', nominal: 0, tolMinus: -0.01, tolPlus: 0.01, unit: 'mm', sigma: 0.002, driftAt100: 0.004 },
    biglathe:   { name: 'Lagersitz (Abw.)', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.012 },
    mill5:      { name: 'Position Bohrbild', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.004, driftAt100: 0.008 },
    mill3:      { name: 'Ebenheit / Position', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.01 },
    deephole:   { name: 'Bohrungs-Ø (Abw.)', nominal: 0, tolMinus: -0.05, tolPlus: 0.05, unit: 'mm', sigma: 0.01, driftAt100: 0.02 },
    hobber:     { name: 'Zahnweite (Abw.)', nominal: 0, tolMinus: -0.03, tolPlus: 0.03, unit: 'mm', sigma: 0.006, driftAt100: 0.012 },
    cylgrinder: { name: 'Durchmesser geschliffen (Abw.)', nominal: 0, tolMinus: -0.006, tolPlus: 0.006, unit: 'mm', sigma: 0.0014, driftAt100: 0.003 },
    surfgrinder:{ name: 'Dicke (Abw.)', nominal: 0, tolMinus: -0.01, tolPlus: 0.01, unit: 'mm', sigma: 0.0022, driftAt100: 0.004 },
    washer:     { name: 'Restschmutz', nominal: 1.5, tolMinus: -1.5, tolPlus: 2.5, unit: 'mg', sigma: 0.35, driftAt100: 0 },
    cmm:        { name: 'Prüfmerkmal Lage (Abw.)', nominal: 0, tolMinus: -0.02, tolPlus: 0.02, unit: 'mm', sigma: 0.0035, driftAt100: 0 },
    assembly:   { name: 'Anzugsmoment Verschraubung', nominal: 25, tolMinus: -2.5, tolPlus: 2.5, unit: 'Nm', sigma: 0.5, driftAt100: 0 },
  };
  const STOCK_DEFAULT = { insert: 8, drill: 4, mill: 4, hob: 2, wheel: 2, saw: 3 };
  // typische Spindeldrehzahlen (für Signale bei Anschluss-Level ≥ 2)
  const RPM = { saw: 45, lathe: 2400, swiss: 6500, biglathe: 380, mill5: 12000, mill3: 8000, deephole: 650, hobber: 900,
    cylgrinder: 1800, surfgrinder: 1500, washer: 0, cmm: 0, assembly: 0 };
  const EXTRA_FAULTS = {
    cmm: [{ code: 'KMG 101', text: 'Tastkopf-Kollision', cause: 'Taster neu einmessen', repairMin: [10, 20] }],
    assembly: [{ code: 'MT 12', text: 'Schraubersteuerung meldet Fehler', cause: 'Akku-Schrauber kalibrieren', repairMin: [8, 15] }],
  };

  // ------------------------------------------------------------------ Modulzustand
  let P = null, S = null, R = null, RI = null, ST = null, TT = null, GRAPH = null;   // RI = eigener RNG für den Auftragseingang
  let SH = [], WORKWIN = [], SHIFTWIN = [], NIDX = {}, FC = null, cur = null;
  let WALK = 1.3, FORK = 2.0, PLAN_AT = 2;
  let DAY_START = 6 * 3600, DAY_END = 22 * 3600;   // frühester Schichtbeginn / spätestes Schichtende (aus profile.shifts)
  let DAYCAP = 14.5 * 3600, WARM = false;          // Schichtzeit ohne Pausen je Werktag; true während init vorrechnet
  let MA = [], PA = [], AA = [];   // Arrays der Maschinen/Personen/AGVs (schnelle Schleifen)
  let CV = 0, INB = null;          // Behälter-Version (Cache-Invalidierung) und Cache für inboundQty
  let GDIRTY = false;              // Geisterschicht-Check bei der nächsten Minute neu bewerten
  const ATR = new Set();           // Ids der nicht erledigten Transporte (Erstellreihenfolge = for-in-Reihenfolge von state.transports)
  /** nicht erledigte Transporte (erledigte werden dabei aus dem Index entfernt) */
  function activeTransports() {
    const out = [];
    for (const id of ATR) { const t = S.transports[id]; if (!t || t.status === 'done') { ATR.delete(id); if (t && t.phase !== 'erledigt') t.phase = 'erledigt'; continue; } out.push(t); }
    return out;
  }
  let PV = 0;                      // Plan-Version: steigt bei jeder Änderung, die die Prognose verschiebt (Cache-Invalidierung)
  const planChanged = () => { PV++; };

  // ------------------------------------------------------------------ kleine Helfer
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const nm = (n, d) => U.fmtNum(n, d || 0);
  const sn = (name) => { const p = String(name || '').split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : String(name || ''); };
  const pname = (id) => (S.people[id] ? sn(S.people[id].name) : '–');
  const tclock = (t) => (Math.floor(t / DAY) === Math.floor(S.t / DAY) ? U.fmtClock(t) : U.fmtDayClock(t));
  const stShort = (id) => (ST[id] ? (ST[id].short || ST[id].name) : id);
  const mLabel = (id) => (ST[id] && ST[id].kind !== 'zone' && ST[id].kind !== 'store' ? id + ' ' + (ST[id].short || '') : stShort(id));
  const teile = (n) => n + (n === 1 ? ' Teil' : ' Teile');
  /** kompakte Empfehlung für Meldungen (Leitstand-Karte zeigt sie wörtlich): „Ursache: … Empfehlung: ….“ ≤ ca. 180 Zeichen */
  const brief = (cause, rec) => { const c = String(cause || '').replace(/[.\s]+$/, ''), r = String(rec || '').replace(/[.\s]+$/, '');
    const s0 = `Ursache: ${c}. Empfehlung: ${r}.`; if (s0.length <= 190) return s0;
    const room = 190 - 24, rN = Math.min(r.length, 120), cN = Math.max(40, room - rN);
    return `Ursache: ${trimStr(c, cN)}. Empfehlung: ${trimStr(r, room - Math.min(cN, c.length))}.`; };
  /** Kurzname für Meldungen: ohne Klammerzusätze („(Beispiel)“, „(Schwesterfirma)“) und Rechtsform */
  const shortName = (s0) => String(s0 || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+(GmbH(\s*&\s*Co\.?\s*KG)?|AG|KG|e\.U\.)$/, '').trim();
  const opBatch = (r) => Math.max(1, r.transferBatch || 10);
  const sumArr = (a) => { let s = 0; for (const x of a || []) s += x; return s; };
  /** deterministisches Rauschen ohne RNG-Verbrauch (für Signale) */
  const hnoise = (a, b) => { let h = Math.imul((a | 0) ^ 0x9E3779B1, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x632BE5AB, 0xC2B2AE35); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return ((h >>> 0) / 4294967296) * 2 - 1; };

  // ------------------------------------------------------------------ Zeit & Schichten
  function shiftInfo(t) {
    const day = Math.floor(t / DAY), dow = ((day % 7) + 7) % 7, s = t - day * DAY;
    if (dow >= 5) return null; // Wochenende: keine Schicht
    for (const sh of SH) {
      if (s >= sh.start && s < sh.end) {
        let br = null;
        for (const b of sh.breaks) if (s >= b[0] && s < b[1]) { br = b; break; }
        return { sh, day, inBreak: !!br, breakEnd: br ? day * DAY + br[1] : null, end: day * DAY + sh.end };
      }
    }
    return null;
  }
  function buildWorkWindows() {
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of SH) {
      let a = sh.start;
      for (const b of sh.breaks) { if (b[0] > a) w.push([d * DAY + a, d * DAY + b[0]]); a = b[1]; }
      if (sh.end > a) w.push([d * DAY + a, d * DAY + sh.end]);
    }
    return w.sort((x, y) => x[0] - y[0]);
  }
  /** Schichtfenster je Woche inkl. Pausen (zusammengefasst) – Basis für „außerhalb der Schicht“ (noShift) */
  function buildShiftWindows() {
    const w = [];
    for (let d = 0; d < 5; d++) for (const sh of SH) w.push([d * DAY + sh.start, d * DAY + sh.end]);
    w.sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const x of w) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push(x.slice()); }
    return out;
  }
  /** Sekunden in [a, b] außerhalb jeder Schicht (Nacht, Wochenende) */
  function offShiftSec(a, b) {
    if (!(b > a)) return 0;
    let inS = 0;
    for (let base = Math.floor(a / WEEK) * WEEK; base < b; base += WEEK) for (const w of SHIFTWIN) { const lo = Math.max(a, base + w[0]), hi = Math.min(b, base + w[1]); if (hi > lo) inS += hi - lo; }
    return (b - a) - inS;
  }
  /** Arbeitszeit (Schichtzeit ohne Pausen) ab t addieren → Endzeitpunkt. */
  function addWork(t, sec) {
    if (!(sec > 0)) return t;
    let base = Math.floor(t / WEEK) * WEEK;
    for (let guard = 0; guard < 60; guard++) {
      for (const w of WORKWIN) {
        const a = base + w[0], b = base + w[1];
        if (b <= t) continue;
        const s = Math.max(a, t), cap = b - s;
        if (sec <= cap) return s + sec;
        sec -= cap; t = b;
      }
      base += WEEK;
    }
    return t + sec;
  }
  /** nächster Beginn einer Arbeitszeit ≥ t */
  function nextWorkStart(t) {
    let base = Math.floor(t / WEEK) * WEEK;
    for (let guard = 0; guard < 4; guard++) {
      for (const w of WORKWIN) { const a = base + w[0], b = base + w[1]; if (b > t) return Math.max(a, t); }
      base += WEEK;
    }
    return t;
  }
  /** Spedition/Lieferanten: Mo–Fr 06:00–20:00 */
  function inDayWindow(t) { const d = ((Math.floor(t / DAY) % 7) + 7) % 7, s = t % DAY; return d < 5 && s >= 6 * 3600 && s < 20 * 3600; }
  function nextDayWindow(t) {
    if (inDayWindow(t)) return t;
    let d = Math.floor(t / DAY); const s = t - d * DAY;
    if (d % 7 < 5 && s < 6 * 3600) return d * DAY + 23400;
    d++; while (d % 7 >= 5) d++;
    return d * DAY + 23400; // 06:30
  }

  // ------------------------------------------------------------------ Bewegung auf dem Wegenetz
  function stPos(sid, at) {
    const s = ST[sid]; if (!s) return null;
    if (at && typeof at === 'object') return at;
    if (at === 'in') return s.inPos; if (at === 'out') return s.outPos;
    return s.work;
  }
  /** Route von der aktuellen Position über das Wegenetz zu toNode, danach kurzes Stück zu endPos. */
  function routeTo(ent, toNode, endPos) {
    let from = ent.node; const r0 = ent.route;
    if (r0) { // Umplanung unterwegs: ab dem nächsten Knoten in Fahrtrichtung
      let k = r0.i + 1; while (k < r0.nodes.length && !r0.nodes[k]) k++;
      if (k < r0.nodes.length) from = r0.nodes[k];
    }
    const pts = [], nodes = [];
    const push = (x, z, id) => {
      const l = pts[pts.length - 1];
      if (l && Math.abs(l.x - x) < 1e-3 && Math.abs(l.z - z) < 1e-3) { if (id) nodes[nodes.length - 1] = id; return; }
      pts.push({ x, z }); nodes.push(id || null);
    };
    push(ent.pos.x, ent.pos.z, null);
    const gp = U.path(GRAPH, from, toNode);
    for (const id of gp.nodes) { const n = GRAPH.nodes[id]; push(n.x, n.z, id); }
    if (endPos) push(endPos.x, endPos.z, null);
    const seg = []; let len = 0;
    for (let k = 0; k < pts.length - 1; k++) { const d = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z); seg.push(d); len += d; }
    ent.route = { pts, nodes, seg, i: 0, f: 0, len, toNode };
    if (nodes[0]) ent.node = nodes[0];
    return ent.route;
  }
  /** bewegt ent um d Meter entlang der Route; true = angekommen */
  function moveEnt(ent, d) {
    const r = ent.route;
    while (r.i < r.pts.length - 1) {
      const L = r.seg[r.i], a = r.pts[r.i], b = r.pts[r.i + 1];
      if (L > 1e-9) ent.heading = Math.atan2(b.x - a.x, b.z - a.z);
      const left = L - r.f;
      if (d < left) { r.f += d; const k = r.f / L; ent.pos.x = a.x + (b.x - a.x) * k; ent.pos.z = a.z + (b.z - a.z) * k; return false; }
      d -= left; r.i++; r.f = 0; ent.pos.x = b.x; ent.pos.z = b.z;
      if (r.nodes[r.i]) ent.node = r.nodes[r.i];
    }
    return true;
  }
  function routeLeft(ent) {
    const r = ent.route; if (!r) return 0;
    let s = (r.seg[r.i] || 0) - r.f; for (let k = r.i + 1; k < r.seg.length; k++) s += r.seg[k];
    return s;
  }
  const PLC = new Map();
  function pathLen(fromNode, sid) {
    const s = ST[sid]; if (!s || !fromNode) return 30;
    let mm = PLC.get(fromNode); if (!mm) PLC.set(fromNode, mm = {});
    const v = mm[sid]; if (v != null) return v;
    return (mm[sid] = U.path(GRAPH, fromNode, s.dockNode).length + 2);
  }

  // ------------------------------------------------------------------ Initialisierung
  function newStats() {
    const stateSec = {}; for (const k in WF.STATE) stateSec[k] = 0;
    // idealPre = Ideal-Zeit des beim Zeitraumbeginn schon laufenden Teils, die dem vorigen Zeitraum (Schicht/Tag) gehört
    // plannedStateSec / lossEurBy: nur geplante Zeit (Schichtzeit ohne Pausen bzw. Geisterschicht der Autonomen) – Ursachen-
    // Aufteilung des Verlusts (Analyse) passt damit genau zu lossEur; stateSec = alle Sekunden (Zustandsband)
    const plannedStateSec = {}, lossEurBy = {}; for (const k in WF.STATE) { plannedStateSec[k] = 0; lossEurBy[k] = 0; }
    return { stateSec, plannedStateSec, lossEurBy, planned: 0, run: 0, ideal: 0, idealPre: 0, good: 0, scrap: 0, lossSec: 0, lossEur: 0, energyKwh: 0 };
  }
  /** neue Zeitraum-Statistik: der Anteil des laufenden Teils bis jetzt gehört noch zum alten Zeitraum (stetige Leistung) */
  function freshStats(m) { const s = newStats(); s.idealPre = partDoneIdeal(m); return s; }
  /** Ideal-Zeit (Plan-Taktzeit) des laufenden Teils, anteilig nach Bearbeitungsfortschritt (Einlegen zählt nicht) */
  function partDoneIdeal(m) {
    const pt = m && m.part;
    if (!pt || pt.sub !== 'cut' || !(pt.dur > 0)) return 0;
    const o = S.orders[pt.oid], r = o && o.routing[pt.idx];
    if (!r) return 0;
    const cyc = (r.cycleMin || 1) * 60;
    return cyc * Math.min(1, Math.max(0, (pt.dur - pt.rem) / pt.dur));
  }
  /** Leistung beim Lesen: Ideal-Zeit des laufenden Teils im Zeitraum (wird erst am Teilende gebucht – nichts doppelt) */
  const idealOpen = (m, st) => Math.max(0, partDoneIdeal(m) - (st.idealPre || 0));
  const oeeKd = (m) => oeeOf(m.kd, idealOpen(m, m.kd));
  const oeeKs = (m) => oeeOf(m.ks, idealOpen(m, m.ks));
  function newMachine(st, idx, t0) {
    return {
      id: st.id, idx, name: st.name, short: st.short, kind: st.kind, type: st.type, area: st.area,
      loading: st.loading || 'auto', loadMin: st.loadMin || 0, skill: st.skill, rate: st.rate || 60,
      power: st.power || { idle: 1, run: 5 }, inCap: st.inCap != null ? st.inCap : 3, outCap: st.outCap != null ? st.outCap : 3,
      mtbfH: st.mtbfH || 0, mtbfP: st.mtbfH ? 1 / (st.mtbfH * 3600) : 0, fpiMin: st.fpiMin || 0,
      automation: st.automation || 'none', conn: Object.assign({ level: 0, protocol: '–', gateway: '–' }, st.conn || {}),
      barMagazineM: st.barMagazineM || 0, barReorderM: st.barReorderM || 0, barStockM: st.barMagazineM ? 0 : null, barMat: null,
      state: 'idle', since: t0, cause: 'Kein Arbeitsgang eingeplant', waitCode: null,
      op: null, setupDone: false, released: false, needCorr: false, part: null, dressRem: 0, fpi: null,
      setupRun: null, corrRun: null, toolchange: null, fault: null, toolStaged: null, manualTC: null, missing: null, rework: false, reworking: false,
      tools: [], tv: 0, tcM: null, tasks: { setup: null, load: null, tc: null, fpi: null, corr: null, repair: null, attend: null, bars: null, offset: null },
      segments: [{ t0, t1: null, state: 'idle' }], kd: newStats(), ks: newStats(), counter: 0,
      nextPickT: 0, starvedSince: null, lastSwitchCheck: 0, idleCause: null, lastPartT: null,
    };
  }
  /** Signale werden erst beim Lesen berechnet (5-s-Raster, deterministisch) – kostet im Sim-Schritt nichts */
  const SIGC = new WeakMap();
  function attachSignals(m) {
    Object.defineProperty(m, 'signals', { enumerable: false, configurable: true, get() {
      const T = S.t - (S.t % 5), c = SIGC.get(m);
      if (c && c.T === T && c.st === m.state && c.lv === m.conn.level && c.p === !!m.part) return c.v;
      const v = computeSignals(m, T);
      SIGC.set(m, { T, st: m.state, lv: m.conn.level, p: !!m.part, v });
      return v;
    } });
    return m;
  }

  function init(profile) {
    P = profile || WF.profile;
    if (!P) throw new Error('WF.sim.init: kein Profil');
    R = U.rng((P.sim.seed >>> 0) || 1);
    RI = U.rng((((P.sim.seed >>> 0) ^ 0x1A7A4E) >>> 0) || 7);
    U.resetUids(); NIDX = {}; FC = null; PBC = null; INB = null; CV = 0; PV = 0; GDIRTY = false; ATR.clear(); OPX = null; WCC = null; RAWC = null; PLC.clear(); DIRTY.length = 0; for (const k in PROG) delete PROG[k];
    ST = P.stationById || Object.fromEntries(P.stations.map(s => [s.id, s]));
    TT = P.toolTypeById || Object.fromEntries(P.toolTypes.map(t => [t.id, t]));
    GRAPH = P.graph;
    for (const s of P.stations) if (!s.dockNode) s.dockNode = U.nearestNode(GRAPH, s.dock.x, s.dock.z);
    WALK = P.sim.walkSpeed || 1.3; FORK = P.sim.forkliftSpeed || 2.0;
    PLAN_AT = P.sim.toolPolicy && P.sim.toolPolicy.planAtParts != null ? P.sim.toolPolicy.planAtParts : 2;
    CFG.agvHandleSec = P.sim.agvLoadSec || 30;
    SH = P.shifts.map(sh => ({ id: sh.id, name: sh.name, start: U.hm(sh.start), end: U.hm(sh.end), breaks: (sh.breaks || []).map(b => [U.hm(b[0]), U.hm(b[1])]) }));
    for (const sh of SH) { // Arbeitsfenster je Schicht (ohne Pausen), Sekunden ab Tagesbeginn
      sh.wins = []; let a = sh.start;
      for (const b of sh.breaks) { if (b[0] > a) sh.wins.push([a, b[0]]); a = b[1]; }
      if (sh.end > a) sh.wins.push([a, sh.end]);
    }
    WORKWIN = buildWorkWindows(); SHIFTWIN = buildShiftWindows();
    DAY_START = Math.min(...SH.map(x => x.start)); DAY_END = Math.max(...SH.map(x => x.end));
    DAYCAP = SH.reduce((a, sh) => a + sh.wins.reduce((b, x) => b + x[1] - x[0], 0), 0) || 14.5 * 3600;
    const t0 = P.sim.startT != null ? P.sim.startT : 6 * 3600;

    const fresh = {
      t: t0, startT: t0, seed: P.sim.seed,
      machines: {}, people: {}, agvs: {}, forklift: null, orders: {}, containers: {}, transports: {},
      materials: {}, tools: {}, toolStock: {}, tasks: {}, purchases: [], stations: {},
      events: [], notifications: [], measurements: {},
      history: { t: [], good: [], oee: [], powerKw: [], wip: [], perMachine: {} },
      kpi: {}, toolCostToday: 0, energyKwh: 0, powerKw: 0, spcSince: {}, etaPub: {}, engineErrors: [],
      today: { day: Math.floor(t0 / DAY), good: 0, goodFinished: 0, scrap: 0, scrapBy: { 'Maß': 0, 'Werkzeugbruch': 0, 'Erstteil n.i.O.': 0 }, fpiOk: 0, fpiNok: 0,
        transports: 0, emptyReturns: 0, shipped: 0, toolChanges: 0, faults: 0, setups: 0, energyKwh: 0, lossEur: 0 },
      shiftStats: { id: null, startT: t0, good: 0, scrap: 0 },
      shiftId: null, inBreak: false, histAcc: { good: 0, powerSum: 0, n: 0 }, lastShiftReport: null, ghostCheck: null,
      intake: { n: 0, lastT: null, lastTpl: null }, orderSeq: 0, archived: 0,
    };
    // gleiche Objekt-Identität über Resets hinweg (Ansichten dürfen WF.sim.state zwischenspeichern)
    if (S) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, fresh); } else S = fresh;
    for (const s of P.stations) S.stations[s.id] = { id: s.id, inp: [], out: [] };
    for (const mt of P.materials) S.materials[mt.id] = Object.assign({}, mt, { onHand: mt.onHand, onOrder: 0, usedToday: 0 });
    for (const tt of P.toolTypes) S.toolStock[tt.id] = { ready: STOCK_DEFAULT[tt.kind] != null ? STOCK_DEFAULT[tt.kind] : 4, regrind: 0, scrapToday: 0, usedStock: 0 };
    P.machines.forEach((id, idx) => { S.machines[id] = attachSignals(newMachine(ST[id], idx, t0)); S.history.perMachine[id] = []; });

    P.people.forEach((pp, idx) => {
      const homeNode = U.nearestNode(GRAPH, pp.home.x, pp.home.z);
      S.people[pp.id] = {
        id: pp.id, name: pp.name, role: pp.role, shift: pp.shift, skills: pp.skills.slice(), machines: (pp.machines || []).slice(),
        home: { x: pp.home.x, z: pp.home.z }, homeNode, idx, pos: { x: pp.home.x, z: pp.home.z }, heading: 0, node: homeNode,
        state: 'offShift', task: null, activity: 'Nicht im Dienst', vehicle: null, route: null,
        onDuty: false, endShift: false, breakPending: false, breakUntil: null, goal: null, idleSince: t0, atHome: true,
        workRem: 0, workSec: 0, dutySec: 0, utilToday: 0, tasksToday: 0, at: null,
      };
    });
    const chg = ST.CHG || P.stations[0];
    P.agvs.forEach((ag, k) => {
      const pos = k % 2 ? chg.outPos : chg.inPos;
      S.agvs[ag.id] = { id: ag.id, name: ag.name, maxKg: ag.maxKg, speed: ag.speed || 1.1, battery: ag.battery != null ? ag.battery : 80,
        state: 'idle', pos: { x: pos.x, z: pos.z }, heading: 0, node: chg.dockNode, load: null, task: null, route: null,
        waitRem: 0, mustCharge: false, slot: k, distToday: 0, transportsToday: 0 };
    });
    const raw = ST.RAW;
    S.forklift = { id: 'STP1', name: 'Stapler 1', pos: { x: raw.dock.x + 2.6, z: raw.dock.z + 1.6 }, heading: Math.PI / 2, node: raw.dockNode, driver: null, state: 'parked' };

    MA = Object.values(S.machines); PA = Object.values(S.people); AA = Object.values(S.agvs);
    for (const po of P.orders) buildOrder(po);
    for (const po of P.orders) applyInitial(S.orders[po.id], po.initial || {});
    nextOrderNo(0);
    persistentTools();

    cur = shiftInfo(S.t);
    S.shiftId = cur ? cur.sh.id : null; S.inBreak = cur ? cur.inBreak : false;
    S.shiftStats.id = S.shiftId;
    for (const id in S.people) {
      const p = S.people[id];
      if (p.shift === S.shiftId) { p.onDuty = true; p.state = 'idle'; p.activity = 'Bereit'; if (S.inBreak) { p.breakPending = true; p.breakUntil = cur.breakEnd; } }
    }
    for (const id in S.machines) planTools(S.machines[id]);
    for (const id in S.materials) checkStock(S.materials[id]);
    ev('reset', 'info', { kind: 'plant', id: 'werk' }, 'Simulation gestartet – ' + P.company.name + ', ' + (cur ? cur.sh.name : 'keine Schicht'), null);

    const until = P.sim.warmupUntilT != null ? P.sim.warmupUntilT : t0;
    WARM = true;                       // Vorrechnen: reine Anzeige-Kennzahl S.kpi erst am Ende (liest die Simulation nie)
    try { while (S.t < until) step(); } finally { WARM = false; }
    refreshToolNotes();
    S.kpi = kpis();
    WF.bus.emit('sim:reset', { t: S.t });
    return S;
  }

  function buildOrder(po) {
    const routing = po.routing.map((r, k) => Object.assign({}, r, {
      seq: r.seq != null ? r.seq : (k + 1) * 10,
      tools: (r.tools || []).map(x => Object.assign({}, x)),
      material: r.material ? Object.assign({}, r.material) : null,
      ext: r.ext ? Object.assign({}, r.ext) : null,
      char: r.char ? Object.assign({}, r.char) : null,
    }));
    ORDV++;
    const o = {
      id: po.id, customer: po.customer, sector: po.sector || '', part: Object.assign({}, po.part), qty: po.qty, due: po.due,
      priority: po.priority || 'normal', note: po.note || '', routing,
      status: 'freigegeben', releasedT: S.t, startT: null, doneT: null, shippedQty: 0, source: po.source || 'profil', lateStreak: 0,
      ops: routing.map(r => ({ seq: r.seq, station: r.station, received: 0, good: 0, scrap: 0, passed: 0, inProc: 0,
        complete: false, startT: null, endT: null, machine: null, offset: 0, fpiCount: 0 })),
    };
    S.orders[o.id] = o;
    return o;
  }

  /** Anfangszustand aus profile.orders[].initial (Behälter, Stückzahlen, aktiver Arbeitsgang). */
  function applyInitial(o, init) {
    const ops = init.ops || {};
    o.routing.forEach((r, i) => {
      const x = ops[r.seq] || {}, op = o.ops[i];
      const atIn = (x.atInput || []).filter(q => q > 0), inSum = sumArr(atIn);
      if (r.station === 'VERSAND') {
        for (const q of atIn) { const c = newContainer(o, i - 1, i, q, 'shipped'); placeAt(c, 'VERSAND', 'inp'); }
        op.received = op.good = inSum; o.shippedQty = inSum;
        return;
      }
      op.good = x.done || 0; op.scrap = x.scrap || 0;
      for (const q of atIn) { const c = newContainer(o, i - 1, i, q, 'input'); placeAt(c, r.station, 'inp'); }
      op.received = op.good + op.scrap + inSum;
      const atOut = r.station === 'EXT' ? 0 : (x.atOutput || 0);
      if (atOut > 0) { const c = newContainer(o, i, i + 1, atOut, 'filling'); placeAt(c, r.station, 'out'); if (atOut >= opBatch(r)) closeContainer(c); }
      op.passed = Math.max(0, op.good - atOut);
      if (op.received > 0) { op.startT = S.t - 3600; o.status = 'in Arbeit'; }
    });
    for (let i = 0; i < o.ops.length; i++) checkOpComplete(o, i, true);
    if (init.activeSeq != null) {
      const i = o.routing.findIndex(r => r.seq === init.activeSeq);
      const r = o.routing[i], m = r && S.machines[r.station];
      if (m && !o.ops[i].complete && !m.op) {
        m.op = { oid: o.id, idx: i }; o.ops[i].machine = m.id; o.status = 'in Arbeit';
        if (!o.startT) o.startT = S.t - 3600;
        m.setupDone = !!init.setupDone || !(r.setupMin > 0);
        m.released = m.setupDone && (!!init.fpiReleased || !r.firstPiece);
        if (m.setupDone) for (const tl of r.tools) mountTool(m, tl.type, (init.toolsUsed || {})[tl.type] || 0);
        if (isBarFed(m, r)) { m.barStockM = init.barStockM != null ? init.barStockM : 0; m.barMat = r.material.id; }
      }
    }
    if (o.ops[o.ops.length - 1].complete) { o.status = 'fertig'; o.doneT = S.t; }
  }
  /** Maschinen ohne aktiven Arbeitsgang behalten ihr Dauerwerkzeug (Sägeband) – teilverschlissen. */
  function persistentTools() {
    for (const id in S.machines) {
      const m = S.machines[id];
      if (m.tools.length || m.type !== 'saw') continue;
      const tt = P.toolTypes.find(t => t.kind === 'saw');
      if (tt) mountTool(m, tt.id, Math.round(tt.lifeMin * 0.45));
    }
  }

  // ------------------------------------------------------------------ Ereignisse & Benachrichtigungen
  function ev(type, sev, entity, msg, data) {
    const e = { id: U.uid('EV'), t: S.t, type, sev: sev || 'info', entity: entity || null, msg, data: data || null };
    S.events.push(e);
    if (S.events.length > CFG.eventsMax) S.events.splice(0, S.events.length - CFG.eventsMax);
    WF.bus.emit('sim:event', e);
    return e;
  }
  /** Benachrichtigung anlegen oder (gleicher key, noch offen) aktualisieren. */
  function notify(o) {
    let n = NIDX[o.key];
    if (n && n.status !== 'resolved') {
      let changed = false;
      for (const k of ['sev', 'title', 'body', 'suggestion', 'role']) if (o[k] != null && n[k] !== o[k]) { n[k] = o[k]; changed = true; }
      if (o.actions) n.actions = o.actions;
      if (changed) { n.updatedT = S.t; WF.bus.emit('sim:notify', n); }
      return n;
    }
    n = { id: U.uid('NT'), t: S.t, sev: o.sev || 'info', title: o.title, body: o.body || '', role: o.role || 'Schichtleitung',
      entity: o.entity || null, status: 'open', ackBy: null, ackT: null, resolvedT: null, suggestion: o.suggestion || '',
      actions: o.actions || [], key: o.key, updatedT: S.t, autoResolveT: o.autoResolveT || null };
    NIDX[o.key] = n;
    S.notifications.unshift(n);
    if (S.notifications.length > CFG.notificationsMax) {
      for (let k = S.notifications.length - 1; k >= 0 && S.notifications.length > CFG.notificationsMax; k--) if (S.notifications[k].status === 'resolved') S.notifications.splice(k, 1);
      if (S.notifications.length > CFG.notificationsMax) S.notifications.length = CFG.notificationsMax;
    }
    WF.bus.emit('sim:notify', n);
    return n;
  }
  function resolveKey(key, note) {
    const n = NIDX[key];
    if (!n) return;
    delete NIDX[key];
    if (n.status === 'resolved') return;
    n.status = 'resolved'; n.resolvedT = S.t; n.resolveNote = note || 'Ursache entfallen';
    WF.bus.emit('sim:notify', n);
  }
  const hasOpen = (key) => !!(NIDX[key] && NIDX[key].status !== 'resolved');

  // ------------------------------------------------------------------ Behälter
  /** Behälter: src = Arbeitsgang-Index, aus dem die Teile stammen (-1 = Rohmaterial), idx = Ziel-Arbeitsgang. */
  function newContainer(o, src, idx, qty, state, kind) {
    const c = {
      id: U.uid('BH'), orderId: o.id, src, idx,
      srcSeq: src >= 0 ? o.routing[src].seq : null, seq: idx < o.routing.length ? o.routing[idx].seq : null,
      qty, weightKg: 0, state, kind: kind || 'parts', location: null, createdT: S.t, transportId: null, partName: o.part.name,
    };
    setWeight(c, o);
    S.containers[c.id] = c; CV++;
    return c;
  }
  function setWeight(c, o) {
    o = o || S.orders[c.orderId];
    const w = c.qty * (o.part.weightKg || 0.1);
    c.weightKg = Math.round((w + (w > 60 ? 30 : 3)) * 10) / 10; // Gitterbox bzw. Kleinladungsträger
  }
  function placeAt(c, sid, slot) {
    unplace(c); CV++;
    c.location = { kind: 'station', id: sid, slot: slot === 'out' ? 'out' : 'in' };
    const st = S.stations[sid]; if (st) (slot === 'out' ? st.out : st.inp).push(c.id);
  }
  function unplace(c) {
    CV++;
    const l = c.location;
    if (l && l.kind === 'station') {
      const st = S.stations[l.id];
      if (st) { const arr = l.slot === 'out' ? st.out : st.inp; const k = arr.indexOf(c.id); if (k >= 0) arr.splice(k, 1); }
    }
    c.location = null;
  }
  function removeContainer(c) { unplace(c); delete S.containers[c.id]; CV++; }
  /** Summe der Teile, die an der Station des Arbeitsgangs i im Eingang warten */
  function waitingQty(oid, i) {
    const o = S.orders[oid], st = S.stations[o.routing[i].station]; let q = 0;
    if (st) for (const cid of st.inp) { const c = S.containers[cid]; if (c.orderId === oid && c.idx === i && c.state === 'input') q += c.qty; }
    return q;
  }
  function firstInput(sid, oid, i) {
    const st = S.stations[sid]; if (!st) return null;
    for (const cid of st.inp) { const c = S.containers[cid]; if (c.orderId === oid && c.idx === i && c.state === 'input' && c.qty > 0) return c; }
    return null;
  }
  /** Teile für Arbeitsgang i, die bereits abgeschlossen in einem Behälter liegen bzw. unterwegs sind */
  function inboundQty(oid, i) {
    if (!INB || INB.v !== CV) {
      INB = { v: CV, m: new Map() };
      for (const id in S.containers) { const c = S.containers[id]; if (c.state === 'transit' || c.state === 'ready') { const k = c.orderId + '|' + c.idx; INB.m.set(k, (INB.m.get(k) || 0) + c.qty); } }
    }
    return INB.m.get(oid + '|' + i) || 0;
  }
  function fillingAt(sid, oid, src) {
    const st = S.stations[sid]; if (!st) return null;
    for (const cid of st.out) { const c = S.containers[cid]; if (c.orderId === oid && c.src === src && c.state === 'filling') return c; }
    return null;
  }
  function countOut(sid) { const st = S.stations[sid]; return st ? st.out.length : 0; }
  function countIn(sid) { const st = S.stations[sid]; return st ? st.inp.length : 0; }
  /** Behälter schließen → bereit zur Abholung, Transportauftrag zur nächsten Station */
  function closeContainer(c) {
    if (c.state !== 'filling') return;
    c.state = 'ready'; c.readyT = S.t; CV++;
    createTransport(c);
  }

  // ------------------------------------------------------------------ Aufträge: Mengen & Abschluss
  /** erwartete Zugangsmenge des Arbeitsgangs i (Ausschuss vorgelagerter Schritte fehlt; Ausschuss im 1. AG wird nachgefertigt) */
  function opTargetIn(o, i) {
    if (i === 0) return o.qty;
    const p = o.ops[i - 1];
    if (p.complete) return p.good;
    let q = o.qty; for (let j = 1; j < i; j++) q -= o.ops[j].scrap;
    return Math.max(0, q);
  }
  /** Gesamtzahl der in Arbeitsgang i zu bearbeitenden Teile (1. AG: Auftragsmenge + Nachfertigung für Ausschuss) */
  function opTotal(o, i) { return i === 0 ? o.qty + o.ops[0].scrap : opTargetIn(o, i); }
  /** noch zu startende Teile in Arbeitsgang i */
  function partsLeft(o, i) {
    const op = o.ops[i];
    if (i === 0) return Math.max(0, o.qty - op.good - op.inProc);
    return Math.max(0, opTargetIn(o, i) - op.good - op.scrap - op.inProc);
  }
  function checkOpComplete(o, i, silent) {
    const op = o.ops[i];
    if (op.complete) return true;
    let done;
    if (i === 0) done = op.good >= o.qty && op.inProc === 0;
    else done = o.ops[i - 1].complete && op.inProc === 0 && op.good + op.scrap >= o.ops[i - 1].good;
    if (done && waitingQty(o.id, i) > 0) done = false;
    if (!done) return false;
    op.complete = true; op.endT = S.t;
    const r = o.routing[i];
    // offenen Ausgangsbehälter (Restmenge) schließen und weitergeben
    const f = fillingAt(r.station, o.id, i);
    if (f) { if (f.qty > 0) closeContainer(f); else removeContainer(f); }
    if (!silent) {
      if (r.station !== 'VERSAND') ev('opDone', 'ok', { kind: 'order', id: o.id }, `${o.id} AG ${r.seq} „${r.op}“ abgeschlossen (${op.good} gut${op.scrap ? ', ' + op.scrap + ' Ausschuss' : ''})`, { seq: r.seq, station: r.station });
    }
    if (i + 1 < o.ops.length) checkOpComplete(o, i + 1, silent);
    else orderDone(o, silent);
    return true;
  }
  function orderDone(o, silent) {
    if (o.status === 'fertig') return;
    o.status = 'fertig'; o.doneT = S.t;
    if (silent) return;
    const late = S.t > o.due, short0 = o.qty - o.shippedQty;
    const d = U.fmtDur(Math.abs(o.due - S.t));
    ev('orderDone', late || short0 > 0 ? 'warn' : 'ok', { kind: 'order', id: o.id }, `Auftrag ${o.id} fertig – ${o.shippedQty}${short0 > 0 ? ' von ' + o.qty : ''} Stk ${o.part.name} im Versand (${late ? d + ' nach' : d + ' vor'} Termin)${short0 > 0 ? ' – Teillieferung, ' + short0 + (short0 === 1 ? ' Stk fehlt' : ' Stk fehlen') : ''}`, { late, shortQty: short0 });
    resolveKey('late:' + o.id, 'Auftrag fertig');
    if (hasOpen('qty:' + o.id)) resolveKey('qty:' + o.id, `Auftrag fertig – ${o.shippedQty} von ${o.qty} Stk geliefert`);
    const short = o.qty - o.shippedQty;
    notify({ key: 'done:' + o.id, sev: late || short > 0 ? 'warn' : 'ok', role: 'Schichtleitung', entity: { kind: 'order', id: o.id }, autoResolveT: S.t + 4 * 3600,
      title: `Auftrag ${o.id} fertig${short > 0 ? ' – Teillieferung' : ''}`,
      body: `${o.shippedQty}/${o.qty} Stk ${o.part.name} im Versand · ${shortName(o.customer)} · ${late ? d + ' nach Termin' : d + ' vor Termin'}${short > 0 ? ' · ' + short + (short === 1 ? ' Stk fehlt' : ' Stk fehlen') + (o.remakes && o.remakes.length ? ' (Nachfertigung ' + o.remakes.join(', ') + ')' : '') : ''}`,
      suggestion: late ? brief(`Termin um ${d} überschritten`, `${shortName(o.customer)} über den Lieferverzug informieren; Verlauf im Auftrag prüfen`)
        : short > 0 ? brief(`${short} Stk Ausschuss in Folgearbeitsgängen`, o.remakes && o.remakes.length ? 'Teillieferung avisieren, Rest kommt mit der Nachfertigung' : 'Nachfertigung oder Teillieferung mit dem Kunden klären')
        : brief('Auftrag termingerecht fertig', 'Lieferschein erstellen und Versand avisieren'), actions: [{ label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id: o.id } }] });
  }

  // ------------------------------------------------------------------ Transportaufträge
  /** Transport für einen abholbereiten Behälter anlegen (Ziel = Station des Ziel-Arbeitsgangs). */
  function createTransport(c) {
    const o = S.orders[c.orderId];
    const from = c.location ? c.location.id : 'RAW';
    const to = c.idx < o.routing.length ? o.routing[c.idx].station : 'VERSAND';
    if (to === from) { dropContainer(c, to); return null; } // gleiche Station: direkt umbuchen
    const kind = c.kind === 'raw' ? 'supply' : to === 'EXT' ? 'ext-out' : from === 'WE' ? 'ext-in' : 'container';
    const mode = c.weightKg > 250 ? 'Stapler' : 'AGV';
    const tr = { id: U.uid('TR'), containerId: c.id, kind, from: { station: from }, to: { station: to }, weightKg: c.weightKg,
      mode, status: 'open', assignee: null, createdT: S.t, pickupT: null, doneT: null, orderId: c.orderId,
      label: `${c.qty} Stk ${o.part.name} · ${stShort(from)} → ${stShort(to)}`, waitReason: null, waitCode: null, phase: 'wartend', taskId: null };
    S.transports[tr.id] = tr; ATR.add(tr.id);
    c.transportId = tr.id;
    return tr;
  }
  /** Leergut: geleerter Behälter am Eingang einer Maschine → zurück an den Ausgang der liefernden Station (bzw. ins
      Rohmaterial-Lager). Ein Leergut-Transport je Strecke sammelt die Behälter (Stapel, max. 4); AGVs fahren ihn nur, wenn
      kein Materialtransport wartet (kind 'empty', containerId null, empties = Anzahl). */
  function emptyReturn(fromSid, toSid) {
    if (!ST[toSid] || !ST[fromSid] || toSid === fromSid || !Object.keys(S.agvs).length) return;
    if (!S.machines[toSid] && toSid !== 'RAW') toSid = 'RAW';
    for (const id of ATR) {
      const t = S.transports[id];
      if (t && t.kind === 'empty' && t.status === 'open' && t.from.station === fromSid && t.to.station === toSid) {
        if (t.empties < 4) { t.empties++; t.label = `Leergut (${t.empties} Behälter) · ${stShort(fromSid)} → ${stShort(toSid)}`; }
        return;
      }
    }
    const tr = { id: U.uid('TR'), containerId: null, kind: 'empty', from: { station: fromSid, slot: 'in' }, to: { station: toSid, slot: 'out' }, weightKg: 3,
      mode: 'AGV', status: 'open', assignee: null, createdT: S.t, pickupT: null, doneT: null, orderId: null, empties: 1,
      label: `Leergut · ${stShort(fromSid)} → ${stShort(toSid)}`, waitReason: null, waitCode: null, phase: 'wartend', taskId: null };
    S.transports[tr.id] = tr; ATR.add(tr.id);
  }
  function createBarsTransport(m, matId) {
    const tr = { id: U.uid('TR'), containerId: null, kind: 'bars', from: { station: 'RAW' }, to: { station: m.id }, weightKg: 0,
      mode: 'Stapler', status: 'open', assignee: null, createdT: S.t, pickupT: null, doneT: null, orderId: m.op ? m.op.oid : null,
      label: `Stangen ${S.materials[matId].name} · Rohmaterial → ${m.id}`, waitReason: null, waitCode: null, phase: 'wartend', taskId: null, materialId: matId, meters: 0 };
    S.transports[tr.id] = tr; ATR.add(tr.id);
    return tr;
  }
  /** Behälter aufnehmen (AGV/Stapler). Zählt als „weitergegeben“ für den Quell-Arbeitsgang. */
  function pickupContainer(c, loc) {
    unplace(c);
    c.location = loc; c.state = 'transit';
    if (c.src >= 0 && !c.relocate) S.orders[c.orderId].ops[c.src].passed += c.qty;
  }
  /** Behälter an einer Station abstellen → Zugang des Ziel-Arbeitsgangs */
  function dropContainer(c, sid) {
    const o = S.orders[c.orderId];
    if (c.state !== 'transit' && c.src >= 0 && !c.relocate && (c.state === 'ready' || c.state === 'filling')) o.ops[c.src].passed += c.qty; // Direktumbuchung
    c.relocate = false;
    const i = c.idx;
    if (i >= o.ops.length) { removeContainer(c); return; }
    const op = o.ops[i];
    op.received += c.qty;
    if (!op.startT) op.startT = S.t;
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = o.startT || S.t; }
    if (sid === 'VERSAND') {
      c.state = 'shipped'; placeAt(c, sid, 'inp');
      op.good += c.qty; o.shippedQty += c.qty; S.today.shipped += c.qty;
      checkOpComplete(o, i);
      return;
    }
    c.state = 'input';
    placeAt(c, sid, 'inp');
    planChanged();
    if (sid === 'EXT') { c.leaveT = S.t + CFG.extHandoverSec; c.arrT = S.t; }
    const m = S.machines[sid];
    if (m && !m.op) m.nextPickT = 0; // Maschine sofort neu disponieren lassen
  }

  // ------------------------------------------------------------------ Fremdbearbeitung (EXT) & Wareneingang
  /** Los an der Bereitstellung Fremdbearbeitung: Behälter gleichen Auftrags/Arbeitsgangs gehen gemeinsam, sobald
      transferBatch (bzw. die Restmenge des Arbeitsgangs) beisammen ist – oder spätestens nach CFG.extMaxWaitSec (Teillos). */
  function extLot(o, i) {
    const st = S.stations.EXT, list = [];
    let qty = 0, leave = 0, arr = Infinity;
    if (st) for (const cid of st.inp) { const c = S.containers[cid]; if (c && c.state === 'input' && c.orderId === o.id && c.idx === i) { list.push(c); qty += c.qty; leave = Math.max(leave, c.leaveT || 0); arr = Math.min(arr, c.arrT != null ? c.arrT : c.createdT); } }
    const op = o.ops[i];
    const rest = Math.max(0, opTargetIn(o, i) - op.good - op.scrap - op.inProc); // inkl. der wartenden Teile
    const lot = Math.max(1, Math.min(opBatch(o.routing[i]), rest));
    const overdue = list.length > 0 && S.t - arr >= CFG.extMaxWaitSec;
    return { list, qty, lot, rest, leave, arr, complete: qty >= lot || overdue, overdue };
  }
  function extTick() {
    const ext = S.stations.EXT;
    if (ext && inDayWindow(S.t)) {
      const seen = {};
      for (const cid of ext.inp.slice()) {
        const c = S.containers[cid]; if (!c || c.state !== 'input') continue;
        const k = c.orderId + '|' + c.idx; if (seen[k]) continue; seen[k] = 1;
        const o = S.orders[c.orderId], i = c.idx, r = o.routing[i], op = o.ops[i];
        const lot = extLot(o, i);
        if (!lot.complete || S.t < lot.leave) continue;
        const lead = ((r.ext && r.ext.leadMin) || 480) * 60;
        const returnT = nextDayWindow(S.t + lead);
        const partner = (r.ext && r.ext.partner) || 'Fremdbearbeiter', process = (r.ext && r.ext.process) || r.op;
        for (const x of lot.list) {
          unplace(x);
          x.state = 'external'; CV++;
          x.location = { kind: 'external', partner, process, returnT, sentT: S.t, lotQty: lot.qty };
          op.inProc += x.qty;
        }
        planChanged();
        ev('extOut', 'info', { kind: 'container', id: lot.list[0].id }, `${lot.qty} Stk ${o.id} (${o.part.name}) als ${lot.overdue && lot.qty < lot.lot ? 'Teillos (Restmenge kommt später)' : 'Los'}${lot.list.length > 1 ? ' (' + lot.list.length + ' Behälter)' : ''} an ${partner} übergeben – ${process}, Rückkehr ca. ${U.fmtDayClock(returnT)}`, { orderId: o.id, seq: r.seq, qty: lot.qty, containers: lot.list.map(x => x.id), returnT });
      }
    }
    for (const id in S.containers) {
      const c = S.containers[id];
      if (c.state !== 'external' || S.t < c.location.returnT) continue;
      const o = S.orders[c.orderId], i = c.idx, op = o.ops[i];
      const partner = c.location.partner;
      op.inProc -= c.qty; op.good += c.qty;
      c.src = i; c.srcSeq = o.routing[i].seq; c.idx = i + 1; c.seq = i + 1 < o.routing.length ? o.routing[i + 1].seq : null;
      c.state = 'ready'; c.readyT = S.t; c.location = null;
      placeAt(c, 'WE', 'out'); planChanged();
      createTransport(c);
      ev('extIn', 'ok', { kind: 'container', id: c.id }, `${c.qty} Stk ${o.id} von ${partner} zurück im Wareneingang (${o.routing[i].op})`, { orderId: o.id });
      checkOpComplete(o, i);
    }
  }
  function purchasesTick() {
    for (const pu of S.purchases) {
      if (pu.status !== 'bestellt' || S.t < pu.etaT) continue;
      pu.status = 'geliefert'; pu.deliveredT = S.t;
      const mt = S.materials[pu.materialId];
      mt.onHand = r6(mt.onHand + pu.qty); mt.onOrder = r6(Math.max(0, mt.onOrder - pu.qty));
      ev('delivery', 'ok', { kind: 'material', id: mt.id }, `Lieferung eingetroffen: ${nm(pu.qty, mt.unit === 'm' ? 1 : 0)} ${mt.unit} ${mt.name} von ${mt.supplier}${pu.kanban ? ' (Kanban-Abruf ' + pu.id + ')' : ' (' + pu.id + ')'} – Bestand jetzt ${nm(mt.onHand, 1)} ${mt.unit}`, { qty: pu.qty, purchaseId: pu.id, kanban: !!pu.kanban });
      planChanged();
      checkStock(mt);
      for (const mid in S.machines) S.machines[mid].nextPickT = 0;
    }
  }
  /** Mindestbestand prüfen → Warnung mit Bestellvorschlag; löst sich, sobald Bestand + Bestellung ≥ Mindestbestand */
  function checkStock(mt) {
    if (MA.length) checkMissing(mt);
    const key = 'stock:' + mt.id;
    if (mt.onHand + mt.onOrder >= mt.min) { if (hasOpen(key)) resolveKey(key, mt.onOrder > 0 ? 'Bestellung ausgelöst' : 'Bestand wieder über Mindestbestand'); return; }
    const dec = mt.unit === 'm' ? 1 : 0;
    // Kanban-Material: Abruf folgt automatisch dem Bedarf (kanbanCheck) – Hinweis, keine Warnung
    notify({ key, sev: mt.kanban ? 'info' : 'warn', role: 'Einkauf', entity: { kind: 'material', id: mt.id },
      title: `Mindestbestand unterschritten: ${mt.name}`,
      body: `Bestand ${nm(mt.onHand, dec)} ${mt.unit} < Mindestbestand ${nm(mt.min, dec)} ${mt.unit}${mt.onOrder ? ' · bestellt ' + nm(mt.onOrder, dec) + ' ' + mt.unit : ''}${mt.kanban ? ' · Kanban ruft bei Bedarf ab' : ''}`,
      suggestion: brief('Verbrauch der freigegebenen Aufträge', `${mt.kanban ? 'Kanban ruft ab, sobald der Bedarf es erfordert; vorziehen: ' : ''}${nm(mt.reorderQty, dec)} ${mt.unit} bei ${shortName(mt.supplier)} bestellen (ca. ${U.fmtDur(mt.leadMin * 60)}, ${U.fmtEur(mt.reorderQty * mt.pricePerUnit)})`),
      actions: [{ label: 'Nachbestellen', action: { type: 'reorder', materialId: mt.id, qty: mt.reorderQty } }] });
  }
  function materialIssue(mt, amount, why) {
    mt.onHand = r6(Math.max(0, mt.onHand - amount));
    mt.usedToday = r6(mt.usedToday + amount);
    checkStock(mt);
  }
  /** Rohmaterial je Material: offener Bedarf freigegebener Aufträge (noch nicht ausgebucht: 1. Arbeitsgang, noch nicht
      gestartet und nicht schon als Rohteile-Behälter bereitgestellt) und Deckung (Lager + Bestellungen + Stangenmagazine) */
  function materialBalance() {
    const res = {};
    for (const id in S.materials) { const mt = S.materials[id]; res[id] = { need: 0, have: mt.onHand + mt.onOrder, free: 0, orders: [] }; }
    for (let j = 0; j < MA.length; j++) { const m = MA[j]; if (m.barMat && m.barStockM > 0 && res[m.barMat]) res[m.barMat].have += m.barStockM; }
    const raw = {};
    for (const cid in S.containers) { const c = S.containers[cid]; if (c.src === -1 && c.idx === 0 && c.kind === 'raw') raw[c.orderId] = (raw[c.orderId] || 0) + c.qty; }
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status === 'fertig') continue;
      const r = o.routing[0]; if (!r.material || !res[r.material.id]) continue;
      const left = Math.max(0, partsLeft(o, 0) - (raw[oid] || 0));
      if (left > 0) { res[r.material.id].need += left * r.material.perPart; res[r.material.id].orders.push(oid); }
    }
    for (const id in res) { const b = res[id]; b.need = r6(b.need); b.have = r6(b.have); b.free = r6(b.have - b.need); }
    return res;
  }
  /** Kanban-Regel (Rahmenvertrag mit Abruf, profile.materials[].kanban): reicht Lager + Bestellungen nicht mehr für den
      offenen Bedarf der freigegebenen Aufträge, wird automatisch abgerufen (reorderQty bzw. Vielfaches) – sonst stünde die
      Fertigung dauerhaft. Mindestbestand-Warnungen bleiben bestehen (der Einkauf kann früher bestellen). */
  function kanbanCheck() {
    const bal = materialBalance();
    for (const id in bal) {
      const mt = S.materials[id], b = bal[id];
      // Abruf, wenn der offene Bedarf nicht gedeckt ist ODER Bestand + Bestellungen unter den Meldebestand (min) fallen –
      // min deckt den Verbrauch während der Lieferzeit, so läuft die Maschine nicht leer, bevor die Lieferung kommt
      const avail = mt.onHand + mt.onOrder, shortMin = mt.min - avail;
      if (!mt.kanban || (b.free >= -1e-9 && shortMin <= 1e-9)) continue;
      const need = Math.max(-b.free, shortMin);
      const q = mt.reorderQty * Math.max(1, Math.ceil(need / mt.reorderQty - 1e-9));
      reorder(id, q, { kanban: true, need: b.need, have: b.have, min: shortMin > 1e-9 });
    }
    return bal;
  }

  // ------------------------------------------------------------------ Auftragseingang (deterministisch, eigener RNG)
  /** fortlaufende Auftragsnummer (nie wiederverwendet, auch nicht nach dem Archivieren); gemeinsam mit actions.addOrder */
  function nextOrderNo(floor) {
    let n = Math.max(floor || 0, (S.orderSeq || 0) + (floor ? 1 : 0));
    for (const id in S.orders) { const x = parseInt(String(id).replace(/\D/g, ''), 10); if (x >= n) n = floor ? x + 1 : x; }
    S.orderSeq = n;
    return n;
  }
  /** Termin = t + n Werktage Schichtzeit (Mo–Fr, DAY_START–DAY_END), auf volle Stunde, zwischen 07:00 und 21:00 */
  function dueAfterWorkDays(t, n) {
    let rem = n * (DAY_END - DAY_START), x = t;
    for (let g = 0; g < 60 && rem > 0; g++) {
      const d = Math.floor(x / DAY), dow = ((d % 7) + 7) % 7, s0 = x - d * DAY;
      if (dow >= 5 || s0 >= DAY_END) { x = (d + 1) * DAY + DAY_START; continue; }
      if (s0 < DAY_START) { x = d * DAY + DAY_START; continue; }
      const cap = d * DAY + DAY_END - x;
      if (rem <= cap) { x += rem; rem = 0; break; }
      rem -= cap; x = (d + 1) * DAY + DAY_START;
    }
    let due = Math.ceil(x / 3600) * 3600;
    const d = Math.floor(due / DAY), s0 = due - d * DAY;
    if (s0 > DAY_END - 3600) due = d * DAY + DAY_END - 3600;
    else if (s0 < DAY_START + 3600) due = d * DAY + DAY_START + 3600;
    return due;
  }
  function intakeCfg() {
    return Object.assign({ openMin: 9, openMax: 40, backlogMinDays: 1, backlogMaxDays: 2, stationMaxDays: 3.5, perShift: [1, 2], minGapMin: 20,
      eilProb: 0.05, notifyMin: 30, maxSameOpen: 2 }, P.sim.intake || {});
  }
  function openOrderCount() { let n = 0; for (const id in S.orders) if (S.orders[id].status !== 'fertig') n++; return n; }
  /** jede Sim-Minute in der Schichtzeit: zu wenige offene Aufträge bzw. zu wenig Arbeitsvorrat → nächster Auftrag frei */
  function intakeTick() {
    if (!cur || !(P.orderTemplates || []).length) return;
    const cfg = intakeCfg();
    if (S.intake.lastT != null && S.t - S.intake.lastT < cfg.minGapMin * 60) return;
    const open = openOrderCount();
    if (open >= cfg.openMax) return;
    let why = null;
    if (open < cfg.openMin) why = `nur ${open} offene Aufträge`;
    else if (S.t % 300 === 0) { const bd = occupancy().backlogDays; if (bd < cfg.backlogMinDays) why = `Arbeitsvorrat nur ${nm(bd, 1)} Tage`; }
    if (why) releaseIntake(why);
  }
  /** Schichtbeginn (Mo–Fr): 1–2 Aufträge aus dem Auftragsvorrat freigeben, solange der Arbeitsvorrat unter backlogMaxDays liegt */
  function intakeAtShiftStart(sid) {
    if (!(P.orderTemplates || []).length) return;
    const cfg = intakeCfg(), pr = cfg.perShift || [1, 1];
    const n = RI.int(pr[0], pr[1]);
    for (let k = 0; k < n; k++) {
      if (openOrderCount() >= cfg.openMax) break;
      const bd = occupancy().backlogDays;
      if (bd >= cfg.backlogMaxDays) break;
      if (!releaseIntake(`Schichtbeginn ${shiftName(sid)}, Arbeitsvorrat ${nm(bd, 1)} Tage`)) break;
    }
  }
  /** Freigabe aus dem Auftragsvorrat (belastungsorientiert): Vorlage gewichtet nach Häufigkeit und Belastung ihrer
      höchstbelasteten Station; überlastete Stationen (> stationMaxDays) und nicht gedecktes Nicht-Kanban-Material
      (Titan) schließen eine Vorlage aus. Menge, Termin und Eil-Kennzeichen über den Eingangs-RNG. */
  function releaseIntake(why) {
    const tpls = P.orderTemplates || []; if (!tpls.length) return null;
    const cfg = intakeCfg(), occ = occupancy(), bal = materialBalance();
    const openByPart = {};
    for (const id in S.orders) { const o = S.orders[id]; if (o.status !== 'fertig') openByPart[o.part.no] = (openByPart[o.part.no] || 0) + 1; }
    const cands = [];
    for (const tp of tpls) {
      if (tp.id === S.intake.lastTpl || (openByPart[tp.part.no] || 0) >= cfg.maxSameOpen) continue;
      let L = 0;
      for (const r of tp.routing) { const d = occ.byMachine[r.station]; if (d != null && d > L) L = d; }
      if (L > cfg.stationMaxDays) continue;
      const r0 = tp.routing[0], mt = r0.material && S.materials[r0.material.id], step = tp.qty[2] || 1;
      let qmax = tp.qty[1];
      if (mt && !mt.kanban) { const can = Math.floor((bal[mt.id].free + 1e-9) / r0.material.perPart); qmax = Math.min(qmax, can - can % step); if (qmax < tp.qty[0]) continue; }
      cands.push({ tp, w: (tp.weight || 1) / (0.25 + L), qmax, step });
    }
    if (!cands.length) return null;
    let tot = 0; for (const c of cands) tot += c.w;
    let x = RI.next() * tot, pick = cands[cands.length - 1];
    for (const c of cands) { x -= c.w; if (x <= 0) { pick = c; break; } }
    const tp = pick.tp;
    const qty = pick.step * RI.int(Math.ceil(tp.qty[0] / pick.step), Math.floor(pick.qmax / pick.step));
    const eil = RI.chance(cfg.eilProb);
    const due = dueAfterWorkDays(S.t, eil ? tp.dueDays[0] : RI.int(tp.dueDays[0], tp.dueDays[1]));
    const id = 'FA-' + nextOrderNo(24129);
    const o = buildOrder({ id, customer: tp.customer, sector: tp.sector, part: tp.part, qty, due, priority: eil ? 'eil' : 'normal',
      note: (tp.note || 'Auftragseingang') + (eil ? ' – Eilauftrag (Kunde)' : ''), source: 'ERP', routing: tp.routing });
    o.template = tp.id;
    S.intake.n++; S.intake.lastT = S.t; S.intake.lastTpl = tp.id;
    for (let j = 0; j < MA.length; j++) MA[j].nextPickT = 0;
    planChanged();
    const b2 = kanbanCheck();
    const r0 = o.routing[0], mt = r0.material && S.materials[r0.material.id];
    let matTxt = '';
    if (mt) {
      const dec = mt.unit === 'm' ? 1 : 0, need = qty * r0.material.perPart, b = b2[mt.id];
      matTxt = ` · ${mt.name} ${mt.onHand + 1e-9 >= b.need ? 'am Lager' : mt.onOrder > 0 ? (mt.kanban ? 'per Kanban abgerufen' : 'bestellt') : 'fehlt – nachbestellen'}`;
    }
    const plan = o.routing.filter(r => r.station !== 'VERSAND').map(r => r.station === 'EXT' ? ((r.ext && r.ext.process) || r.op) + ' (extern)' : stShort(r.station)).join(' → ');
    ev('orderIntake', 'ok', { kind: 'order', id }, `Auftragseingang: ${id} · ${qty} Stk ${o.part.name} für ${o.customer}, Termin ${U.fmtDayClock(due)}${eil ? ' (Eilauftrag)' : ''}`,
      { orderId: id, template: tp.id, qty, due, priority: o.priority, why, source: 'ERP' });
    notify({ key: 'intake:' + id, sev: 'info', role: 'Schichtleitung', entity: { kind: 'order', id }, autoResolveT: S.t + (cfg.notifyMin || 30) * 60,
      title: `Auftragseingang ${id}: ${qty} Stk ${o.part.name}`,
      body: `${shortName(o.customer)} · Termin ${U.fmtDayClock(due)}${eil ? ' (Eilauftrag)' : ''} · ${plan}${matTxt}`,
      suggestion: brief(`ERP-Auftragseingang (${trimStr(String(why), 70)})`, 'nichts zu tun – Einplanung nach Termin, Prognose in der Auftragsliste'),
      actions: [{ label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id } }] });
    return id;
  }

  // ------------------------------------------------------------------ Versand-Abholung & Archiv (begrenzter Zustand)
  /** fertige Aufträge: Spedition holt die Behälter im Lieferfenster ab; nach archiveAfterH wird der Auftrag samt
      Behältern, Messwerten und Merkern aus dem Zustand entfernt (Speicher bleibt bei Dauerbetrieb begrenzt) */
  function archiveTick() {
    const keep = (P.sim.archiveAfterH || 72) * 3600, pick = (P.sim.shipPickupH != null ? P.sim.shipPickupH : 2) * 3600;
    const win = inDayWindow(S.t);
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status !== 'fertig' || o.doneT == null) continue;
      if (win && !o.pickedUpT && S.t - o.doneT >= pick) shipOut(o);
      if (S.t - o.doneT >= keep) archiveOrder(o);
    }
    for (let k = S.purchases.length - 1; k >= 0; k--) { const pu = S.purchases[k]; if (pu.status === 'geliefert' && S.t - pu.deliveredT > keep) S.purchases.splice(k, 1); }
  }
  function shipOut(o) {
    let n = 0, q = 0;
    for (const cid in S.containers) { const c = S.containers[cid]; if (c.orderId === o.id && c.state === 'shipped') { q += c.qty; n++; removeContainer(c); } }
    o.pickedUpT = S.t;
    if (n) ev('shipOut', 'ok', { kind: 'order', id: o.id }, `Versand: ${o.id} von der Spedition abgeholt – ${q} Stk ${o.part.name} (${n} Behälter) an ${o.customer}`, { orderId: o.id, qty: q, containers: n });
  }
  function archiveOrder(o) {
    const pre = o.id + '/';
    for (const cid in S.containers) if (S.containers[cid].orderId === o.id) removeContainer(S.containers[cid]);
    for (const k in S.measurements) if (k.startsWith(pre)) delete S.measurements[k];
    for (const k in S.spcSince) if (k.startsWith(pre)) delete S.spcSince[k];
    for (const k in PROG) if (k.startsWith(pre)) delete PROG[k];
    delete S.etaPub[o.id];
    for (const key of ['late:', 'done:', 'intake:', 'qty:']) if (hasOpen(key + o.id)) resolveKey(key + o.id, 'Auftrag archiviert');
    delete S.orders[o.id];
    S.archived++; ORDV++;
    planChanged();
  }

  // ------------------------------------------------------------------ Maschinen: Grundlagen
  const OK = { ok: true };
  const WAIT_STATES = { starved: 1, waitOperator: 1, waitTool: 1, blocked: 1 };
  function curOf(m) { if (!m.op) return null; const o = S.orders[m.op.oid]; return { o, i: m.op.idx, r: o.routing[m.op.idx], op: o.ops[m.op.idx] }; }
  function isBarFed(m, r) { return !!(m && m.barMagazineM && r && r.material && S.materials[r.material.id] && S.materials[r.material.id].form === 'Stange'); }
  function isSawRaw(m, r, i) { return i === 0 && m.type === 'saw' && !!r.material; }
  function isSupplyOp(m, r, i) { return i === 0 && !isSawRaw(m, r, i) && !isBarFed(m, r); }
  function loadSecOf(m, r) { return Math.round(((r.loadMin != null ? r.loadMin : m.loadMin) || 1) * 60); }
  /** Plan-Taktzeit inkl. Einlegen (für Prognosen) */
  function cycleSec(m, r) { return (r.cycleMin || 1) * 60 + (m && m.loading === 'perPart' ? loadSecOf(m, r) : 0); }
  function charOf(m, r) { return r.char || DEFAULT_CHAR[m.type] || DEFAULT_CHAR.cmm; }
  /** Arbeitsgang ohne nennenswerten Rüstaufwand und ohne Erstteil: Arbeitsplatz gibt ihn bei leerem Eingang frei */
  function releasableOp(r, i) { return i > 0 && !(r.setupMin > 10) && !r.firstPiece; }
  function cmpKey(a, b) { for (let k = 0; k < a.length; k++) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; }

  /** teure Ursachentexte (Wartezustände) höchstens alle 5 s neu berechnen; bei Zustandswechsel sofort */
  function cz(m, key, fn) {
    if (m.czKey === key && S.t - m.czT < 5 && m.state === m.czState) return m.czVal;
    m.czKey = key; m.czT = S.t; m.czState = m.state; m.czVal = fn();
    return m.czVal;
  }
  /** Außerhalb der Schicht ist eine Maschine, die nicht autonom (loading 'auto') gerüstet und für den unbemannten Lauf
      freigegeben ist, nicht „wartend“, sondern geplant „Bereit“: keine Warnung, kein Verlust, keine Verfügbarkeitsminderung.
      Nur autonome Maschinen, die in der Geisterschicht stoppen, bekommen Wartezustände, Verluste und Meldungen. */
  const offShiftHold = (m) => !cur && !(m.loading === 'auto' && m.setupDone && m.released);
  function holdIdle(m, what) {
    releaseAttendant(m);
    if (m.holdK !== what || S.t - m.holdT >= 60) { m.holdK = what; m.holdT = S.t; m.holdV = `Keine Schicht – weiter ${tclock(nextWorkStart(S.t + 1))} mit ${what}`; }
    return setState(m, 'idle', m.holdV, 'noShift');
  }
  /** Zustandswechsel – immer mit Ursache; erzeugt Event 'state' und pflegt Zustandssegmente. */
  function setState(m, st, cause, code) {
    m.cause = cause;
    if (m.state === st) return;
    const from = m.state, since0 = m.since;
    const seg = m.segments[m.segments.length - 1];
    if (seg) seg.t1 = S.t;
    m.segments.push({ t0: S.t, t1: null, state: st });
    const lim = S.t - DAY;
    while (m.segments.length > 2 && m.segments[0].t1 != null && m.segments[0].t1 < lim) m.segments.shift();
    m.state = st; m.since = S.t;
    if (WAIT_STATES[from] && hasOpen('wait:' + m.id)) {
      // abgeschlossene Episode: Titel mit Beginn und Ende (eine neue Episode bekommt eine neue Meldung mit eigenem Beginn)
      NIDX['wait:' + m.id].title = `${m.id} ${m.short}: ${WF.STATE[from].label} ${tclock(since0)}–${U.fmtClock(S.t)} (${U.fmtDur(S.t - since0)})`;
      resolveKey('wait:' + m.id, 'jetzt: ' + WF.STATE[st].label);
    }
    ev('state', st === 'fault' ? 'crit' : 'info', { kind: 'machine', id: m.id },
      `${m.id} ${m.short}: ${WF.STATE[from].label} → ${WF.STATE[st].label} – ${cause}`,
      { from, to: st, cause, code: code || null, minor: code === 'walking' || code === 'assigning' });
  }

  // ------------------------------------------------------------------ Maschinen: Schritt
  const faultCause = (m) => `${m.fault.code} ${m.fault.text}${m.fault.repairBy ? ' – Reparatur durch ' + pname(m.fault.repairBy) : ' – wartet auf Instandhaltung'}`;
  /** Zustand nach einer Personen-Aktion im selben Sim-Schritt nachziehen (kein „Rüsten“ ohne Rüstvorgang für 1 s) */
  const DIRTY = [];
  function markDirty(m) { if (m && !m.dirty) { m.dirty = true; DIRTY.push(m); } }
  function refreshState(m) {
    if (m.fault) return setState(m, 'fault', faultCause(m));
    if (m.toolchange) return setState(m, 'toolchange', m.toolchange.cause);
    if (m.setupRun) return setState(m, 'setup', m.setupRun.cause);
    if (m.corrRun) return setState(m, 'setup', m.corrRun.cause);
    if (m.part) { if (m.part.sub === 'load') return setState(m, 'running', m.part.loadLabel); if (m.loading === 'attended' && !attendHere(m, m.part)) return; return setState(m, 'running', m.part.label); }
    if (m.dressRem > 0) return setState(m, 'running', 'Abrichten der Schleifscheibe (automatischer Zyklus)');
    if (m.fpi) return fpiHold(m) ? holdIdle(m, 'Erstteilprüfung') : setState(m, 'firstPiece', fpiCause(m));
    decide(m, 0);
  }
  function machineTick(m) {
    if (m.fault) return setState(m, 'fault', faultCause(m));
    if (m.toolchange) return setState(m, 'toolchange', m.toolchange.cause);
    if (m.setupRun) return setState(m, 'setup', m.setupRun.cause);
    if (m.corrRun) return setState(m, 'setup', m.corrRun.cause);
    const pt = m.part;
    if (pt) {
      if (pt.sub === 'load') return setState(m, 'running', pt.loadLabel);
      if (m.loading === 'attended' && !attendHere(m, pt)) return;
      if (m.mtbfP && R.next() < m.mtbfP) { startFault(m, null, false); return; }
      pt.rem -= 1;
      if (pt.rem > 0) {
        if (m.loading === 'perPart' && pt.rem <= CFG.precallSec) precallLoad(m);
        return setState(m, 'running', pt.label);
      }
      partEnd(m);
    }
    if (m.dressRem > 0) { m.dressRem--; if (m.dressRem > 0) return setState(m, 'running', 'Abrichten der Schleifscheibe (automatischer Zyklus)'); }
    if (m.fpi) { if (fpiHold(m)) return holdIdle(m, `Erstteilprüfung ${m.op ? S.orders[m.op.oid].id + ' AG ' + S.orders[m.op.oid].routing[m.op.idx].seq : ''}`); return setState(m, 'firstPiece', cz(m, 'fpi:' + m.fpi.stage, () => fpiCause(m))); }
    decide(m, 0);
  }
  /** Erstteil wartet außerhalb der Schicht (niemand holt/misst es) → geplant „Bereit“ */
  function fpiHold(m) { const tk = S.tasks[m.tasks.fpi]; return !cur && m.fpi && m.fpi.stage === 'wait' && !(tk && tk.assignee); }

  /** Bemannte Bearbeitung (Messraum, Montage): läuft nur, solange die Person da ist – sonst unterbrochen (Pause, Schichtende) */
  function attendHere(m, pt) {
    const tk = S.tasks[m.tasks.attend], here = tk && tk.assignee && tk.ready ? tk.assignee : null;
    const o = S.orders[pt.oid], r = o.routing[pt.idx];
    if (!here) {
      if (!pt.paused) {
        pt.paused = true; pt.pausedT = S.t; pt.pausedBy = pt.by; pt.by = null;
        ev('partPause', 'info', { kind: 'machine', id: m.id }, `${m.id}: ${m.kind === 'assembly' ? 'Montage' : 'Prüfung'} ${o.id} unterbrochen (${Math.round((1 - pt.rem / pt.dur) * 100)} % erledigt) – ${pname(pt.pausedBy)} ${cur && cur.inBreak ? 'in der Pause' : !cur || S.t >= cur.end - 60 ? 'hat Schichtende' : 'wurde abgezogen'}; wird danach fortgesetzt`, { orderId: o.id, seq: r.seq });
      }
      ensureMTask(m, 'attend');
      waitOp(m, 'attend', `${m.kind === 'assembly' ? 'Montage' : 'Prüfung'} ${o.id} AG ${r.seq} unterbrochen (${Math.round((1 - pt.rem / pt.dur) * 100)} % erledigt)`);
      return false;
    }
    if (pt.paused) {
      pt.paused = false; pt.by = here;
      ev('partResume', 'info', { kind: 'machine', id: m.id }, `${m.id}: ${pname(here)} setzt ${m.kind === 'assembly' ? 'die Montage' : 'die Prüfung'} ${o.id} fort (unterbrochen ${U.fmtDur(S.t - pt.pausedT)})`, { orderId: o.id, seq: r.seq });
      const p = S.people[here]; if (p) p.activity = m.kind === 'assembly' ? `Montiert ${o.id} (${r.op})` : `Prüft ${o.id} AG ${r.seq} (${r.op})`;
    }
    return true;
  }
  /** Entscheidung an einer Teilegrenze (kein Teil in Bearbeitung): Regeln §3.3 in fester Reihenfolge. */
  function decide(m, depth) {
    if (!m.op) {
      if (S.t >= m.nextPickT) { if (m.nextPickT === 0) m.pickSig = null; m.nextPickT = S.t + CFG.pickEverySec; pickOp(m); }
      if (!m.op) { releaseAttendant(m); return setState(m, 'idle', m.idleCause || 'Kein Arbeitsgang eingeplant'); }
    }
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i], op = o.ops[i];
    if (op.complete || checkOpComplete(o, i)) {
      finishOp(m, o, i);
      if (depth < 1) return decide(m, depth + 1);
      return setState(m, 'idle', 'Arbeitsgang abgeschlossen');
    }
    // Material vorbereiten – darf schon während des Rüstens laufen
    if (isSupplyOp(m, r, i)) ensureSupply(m, o, i);
    if (isBarFed(m, r)) ensureBars(m, o, i);
    // 1) Rüsten
    if (!m.setupDone) {
      if (!(r.setupMin > 0)) instantSetup(m, o, i);
      else { ensureMTask(m, 'setup'); return waitOp(m, 'setup', `Rüsten für ${o.id} AG ${r.seq}`); }
    }
    if (m.needCorr) { ensureMTask(m, 'corr'); return waitOp(m, 'corr', `Korrektur nach Erstteil n.i.O. (${o.id})`); }
    // 2) Werkzeugwechsel nur an der Teilegrenze und nur wenn Einrichter:in mit Werkzeug bereitsteht
    const tc = toolCheck(m, o, i);
    if (techReady(m)) {
      const tk = S.tasks[m.tasks.tc];
      if ((tc.change.length || manualDue(m)) && tk.data.index && changeList(m, tc, true).some(x => x.action !== 'index')) {
        cancelTask(tk, 'letzte Schneide – neue Platte aus der Werkzeugausgabe nötig'); ensureToolTask(m, tc.short.length > 0);
      } else if (tc.change.length || manualDue(m)) { startToolChange(m, o, i, tc); return setState(m, 'toolchange', m.toolchange.cause); }
      if (!tc.planned.length && !m.manualTC && tk) cancelTask(tk, 'kein Wechsel nötig');
      else if (tk) {
        const p = S.people[tk.assignee];
        let L = null; for (const x of tc.planned) if (!L || x.remA < L.remA) L = x;
        p.activity = L ? `Wartet an ${m.id}: ${TT[L.spec.type].name} wird bei ≤ ${teile(L.at)} Reststandzeit gewechselt (noch ${teile(L.remA)})`
          : `Wartet an ${m.id}: vorbeugender Wechsel ab ca. ${tclock(m.manualTC.notBefore - 600)}`;
      }
    }
    // 3) Ausgangspuffer – Behälter stauen sich, weil der Nachfolger voll ist: Los teilen und einen Auftrag mit freiem Ziel vorziehen
    if (S.t - (m.outSwitchT || 0) >= 30 && outputSwitch(m, o, i)) return depth < 1 ? decide(m, depth + 1) : setState(m, 'idle', 'Arbeitsgang gewechselt');
    if (!outputRoom(m, o, i)) {
      dropWaiters(m);
      if (offShiftHold(m)) return holdIdle(m, `${o.id} AG ${r.seq} (Ausgang voll – Abholung zu Schichtbeginn)`);
      // Säge: Ablage voll mit Zuschnitten, deren Folgemaschinen ausgelastet sind → kein Verlust, sondern Vorrat (geplant „Bereit“)
      if (m.type === 'saw') { const ah = outputAhead(m); if (ah) return setState(m, 'idle', cz(m, 'ahead' + ah, () => `Zuschnitt auf Vorrat – ${countOut(m.id)} Behälter warten auf ${ah} (Folgemaschinen ausgelastet); weiter mit ${o.id} AG ${r.seq}, sobald Platz ist`), 'ahead'); }
      return setState(m, 'blocked', cz(m, 'bl', () => `Ausgangspuffer voll (${countOut(m.id)}/${m.outCap} Behälter) – ${blockedWhy(m)}`), 'blocked'); }
    // 4) Eingang / Rohmaterial
    const inp = inputAvail(m, o, i);
    if (!inp.ok) {
      { const lt = S.tasks[m.tasks.load]; if (lt && !lt.workStarted) cancelTask(lt, 'nicht mehr nötig'); }
      if (inp.code === 'parts' && releasableOp(r, i) && inboundQty(o.id, i) === 0) {
        const eta = arrivalEta(o, i);
        pauseOp(m, o, i, `${m.id} gibt ${o.id} AG ${r.seq} frei – Behälter abgearbeitet, nächste Teile ${eta ? 'ca. ' + tclock(eta) : 'noch nicht absehbar'}`, true);
        m.nextPickT = 0;
        m.idleCause = `Frei – nächste Teile für ${o.id} AG ${r.seq} ${eta ? 'ca. ' + tclock(eta) : 'noch nicht absehbar'}`;
        if (depth < 1) return decide(m, depth + 1);
        return setState(m, 'idle', m.idleCause);
      }
      if (m.starvedSince == null) m.starvedSince = S.t;
      if (maybeSwitch(m, o, i)) return depth < 1 ? decide(m, depth + 1) : setState(m, 'idle', 'Arbeitsgang gewechselt');
      releaseAttendant(m);
      if (offShiftHold(m)) return holdIdle(m, `${o.id} AG ${r.seq} – ${inp.cause}`);
      return setState(m, 'starved', inp.cause, inp.code);
    }
    m.starvedSince = null;
    // 5) Werkzeug-Standzeit für das nächste Teil
    if (tc.short.length) { ensureToolTask(m, true); dropWaiters(m); if (offShiftHold(m)) return holdIdle(m, `${canIndex(tc.short[0].tl) ? 'Schneide wenden' : 'Werkzeugwechsel'} ${TT[tc.short[0].spec.type].name} (${o.id} AG ${r.seq})`); return setState(m, 'waitTool', cz(m, 'wt:' + (S.tasks[m.tasks.tc] ? S.tasks[m.tasks.tc].assignee + S.tasks[m.tasks.tc].si : ''), () => toolWaitCause(m, tc)), 'tool'); }
    // 5b) fälliges Abrichten (nach dem letzten Teil des vorigen Arbeitsgangs zurückgestellt) vor dem ersten Schliff
    for (const tid of m.tools) {
      const tl = S.tools[tid];
      if (tl.dressDue && cutFor(r, tl.typeId) > 0) { tl.dressDue = false; m.dressRem = CFG.dressSec; dropWaiters(m); return setState(m, 'running', `Abrichten der Schleifscheibe vor dem nächsten Schliff (${tl.name}, alle ${TT[tl.typeId].dressEvery} Teile)`); }
    }
    // 6) Beladen bzw. Anwesenheit
    if (m.loading === 'perPart') {
      const p = presentFor(m, 'load');
      if (p) { startLoad(m, o, i, p); return setState(m, 'running', `Teil wird eingelegt (${sn(p.name)})`); }
      ensureMTask(m, 'load');
      return waitOp(m, 'load', `Einlegen ${o.id} AG ${r.seq}`);
    }
    if (m.loading === 'attended') {
      const p = presentFor(m, 'attend');
      if (p && p.task && p.task.orderId !== o.id || (p && p.task && p.task.seq !== r.seq)) { // Anwesende Person übernimmt den neuen Arbeitsgang
        const tk = p.task; tk.orderId = o.id; tk.seq = r.seq;
        tk.label = `${TASK_LABEL[tk.type]} ${mLabel(m.id)} · ${o.id}`;
        tk.steps[tk.si].label = p.activity = m.kind === 'assembly' ? `Montiert ${o.id} (${r.op})` : `Prüft ${o.id} AG ${r.seq} (${r.op})`;
      }
      if (p && !mustLeave(p)) { startPart(m, o, i, p.id); return setState(m, 'running', `${sn(p.name)}: ${r.op} ${o.id}`); }
      if (p) { releaseAttendant(m); assignTasks(); } // dringendere Aufgabe sofort übernehmen
      ensureMTask(m, 'attend');
      return waitOp(m, 'attend', `${m.kind === 'assembly' ? 'Montage' : 'Prüfung'} ${o.id} AG ${r.seq}`);
    }
    startPart(m, o, i, null);
    setState(m, 'running', m.part.label);
  }

  // ------------------------------------------------------------------ Maschinen: Auftragswahl
  /** Kandidat für Maschine m: Eil zuerst, dann Material-Bereitschaft (2 = am Platz/unterwegs, 1 = kommt bald), früheste Fälligkeit, Auftragsnummer */
  /** Index: offene Aufträge je Station → [[order, idx]] (neu aufgebaut, wenn Aufträge dazukommen/wegfallen/verlagert werden) */
  let OPX = null, ORDV = 0;
  function opsAt(sid) {
    if (!OPX || OPX.v !== ORDV) {
      OPX = { v: ORDV, by: {} };
      for (const oid in S.orders) {
        const o = S.orders[oid]; if (o.status === 'fertig') continue;
        for (let i = 0; i < o.routing.length; i++) (OPX.by[o.routing[i].station] || (OPX.by[o.routing[i].station] = [])).push([o, i]);
      }
    }
    return OPX.by[sid] || [];
  }
  function bestCandidate(m, minLevel, exclude, info) {
    let best = null;
    const list = opsAt(m.id);
    for (let q = 0; q < list.length; q++) {
      const o = list[q][0], i = list[q][1], oid = o.id;
      if (o.status === 'fertig') continue;
      {
        const r = o.routing[i];
        if (r.station !== m.id) continue;
        const op = o.ops[i];
        if (op.complete || (op.machine && op.machine !== m.id)) continue;
        if (exclude && exclude.oid === oid && exclude.idx === i) continue;
        if (op.outHold) { if (!succRoom(o, i)) continue; op.outHold = null; }   // geteiltes Los: erst wieder, wenn das Ziel Platz hat
        const lv = opLevel(m, o, i);
        if (info) { info.n++; if (lv.eta != null && (info.eta == null || lv.eta < info.eta)) { info.eta = lv.eta; info.what = o.id + ' AG ' + r.seq; } }
        if (lv.level < minLevel) continue;
        const k = [o.priority === 'eil' ? 0 : 1, 2 - lv.level, o.due, o.id, r.seq];
        if (!best || cmpKey(k, best.k) < 0) best = { o, i, r, lv, k };
      }
    }
    return best;
  }
  function pickOp(m) {
    // nichts Relevantes geändert (Behälter, Plan) und vor < 60 s ohne Ergebnis geprüft → Begründung bleibt, keine neue Suche
    const sig = CV + '|' + PV;
    if (m.pickSig === sig && S.t - m.pickSigT < 60) return;
    const info = { n: 0, eta: null, what: null };
    const b = bestCandidate(m, 1, null, info);
    if (!b) {
      m.pickSig = sig; m.pickSigT = S.t;
      // Begründung für „Bereit“ – mit dem nächsten absehbaren Materialeingang
      m.idleCause = !info.n ? 'Kein Arbeitsgang eingeplant'
        : info.eta != null ? `Frei – nächste Teile: ${info.what} ca. ${tclock(info.eta)}${info.n > 1 ? ' (' + info.n + ' Arbeitsgänge eingeplant)' : ''}`
        : `Frei – ${info.n === 1 ? '1 Arbeitsgang' : info.n + ' Arbeitsgänge'} eingeplant, Vorgänger noch in Arbeit`;
      return;
    }
    m.pickSig = null;
    activateOp(m, b.o, b.i, b.lv);
  }
  /** Rüstzustand, der für den nächsten Behälter erhalten bleibt: Waschanlage je Waschprogramm (Werkstoff), sonst je Arbeitsgang */
  const setupKey = (m, o, i) => (m.type === 'washer' ? 'prog:' + ((o.part && o.part.material) || '-') : 'op:' + o.id + '/' + i);
  function activateOp(m, o, i, lv) {
    const r = o.routing[i];
    const kept = !!(m.keptSetup && releasableOp(r, i) && m.keptSetup.key === setupKey(m, o, i));
    m.keptSetup = null;
    m.op = { oid: o.id, idx: i };
    o.ops[i].machine = m.id;
    m.setupDone = false; m.released = false; m.needCorr = false; m.starvedSince = null; m.idleCause = null;
    m.rework = false; m.reworking = false;
    if (kept) { mountForOp(m, o, i); m.setupDone = true; m.released = true; lv = Object.assign({}, lv, { why: (lv.why ? lv.why + '; ' : '') + 'Programm noch eingestellt – kein Rüsten' }); }
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = S.t; }
    planChanged();
    ev('opSelect', 'info', { kind: 'machine', id: m.id },
      `${m.id} plant ${o.id} AG ${r.seq} „${r.op}“ ein (${o.priority === 'eil' ? 'Eilauftrag' : 'Termin ' + U.fmtDayClock(o.due)}; ${lv.why || ''})`,
      { orderId: o.id, seq: r.seq, level: lv.level });
  }
  /** Bereitschaft eines Arbeitsgangs für Maschine m. Ist das Wasch-/Messprogramm noch eingestellt (keptSetup), wird nicht
      „vorab gerüstet“: der Arbeitsgang wartet, bis die Teile da sind (Stufe 0 statt 1) */
  function opLevel(m, o, i) {
    const lv = opLevel0(m, o, i);
    if (lv.level === 1 && m.keptSetup && releasableOp(o.routing[i], i) && m.keptSetup.key === setupKey(m, o, i)) return { level: 0, eta: lv.eta, why: 'Programm eingestellt – wartet auf Teile' };
    return lv;
  }
  function opLevel0(m, o, i) {
    const r = o.routing[i];
    // Rüsten vorab nur, wenn das Material spätestens kurz nach Rüstende eintrifft (ohne Rüstaufwand: nur bei Material am Platz)
    const lead = r.setupMin > 0 ? r.setupMin * 60 + Math.min(1200, r.setupMin * 60) : -1;
    if (waitingQty(o.id, i) > 0) return { level: 2, why: 'Teile am Platz' };
    if (inboundQty(o.id, i) > 0) return { level: 2, why: 'Behälter unterwegs' };
    if (i === 0) {
      if (rawAvailable(m, r)) return { level: 2, why: r.material ? 'Rohmaterial verfügbar' : 'Teile bereitgestellt' };
      const eta = rawEta(r);
      if (eta != null && eta - S.t <= lead) return { level: 1, eta, why: 'Rohmaterial-Lieferung ca. ' + tclock(eta) };
      return { level: 0, why: 'Rohmaterial fehlt' };
    }
    const eta = arrivalEta(o, i);
    if (eta != null && eta - S.t <= lead) return { level: 1, eta, why: 'Teile ab ca. ' + tclock(eta) + ' – Rüsten vorab' };
    return { level: 0, eta };
  }
  function rawAvailable(m, r) {
    if (!r.material) return true;
    const mt = S.materials[r.material.id]; if (!mt) return true;
    const bar = isBarFed(m, r) && m.barMat === mt.id ? m.barStockM : 0;
    return mt.onHand + bar + 1e-9 >= r.material.perPart;
  }
  function rawEta(r) {
    if (!r.material) return null;
    let best = null;
    for (const pu of S.purchases) if (pu.status === 'bestellt' && pu.materialId === r.material.id && (best == null || pu.etaT < best)) best = pu.etaT;
    return best;
  }
  /** geschätzter Zeitpunkt, zu dem der nächste Behälter für Arbeitsgang i eintrifft (null = nicht absehbar) */
  function arrivalEta(o, i) {
    if (i === 0) { const r = o.routing[0]; return rawAvailable(S.machines[r.station] || {}, r) ? S.t : rawEta(r); }
    if (inboundQty(o.id, i) > 0) return S.t + 180;
    const pi = i - 1, pr = o.routing[pi], pop = o.ops[pi];
    if (pr.station === 'EXT') {
      let best = null;
      const lead = ((pr.ext && pr.ext.leadMin) || 480) * 60;
      for (const id in S.containers) {
        const c = S.containers[id];
        if (c.orderId !== o.id || c.idx !== pi || c.state !== 'external') continue;
        const t = c.location.returnT + 900;
        if (best == null || t < best) best = t;
      }
      const lot = extLot(o, pi);
      if (lot.list.length) {
        // Los vollständig → Abholung im Lieferfenster; sonst erst, wenn die Restmenge vom Vorgänger da ist
        const more = lot.complete ? null : arrivalEta(o, pi);
        const ship = lot.complete ? Math.max(S.t, lot.leave) : more != null ? Math.max(lot.leave, more + CFG.extHandoverSec) : lot.arr + CFG.extMaxWaitSec;
        const t = nextDayWindow(nextDayWindow(ship) + lead) + 900;
        if (best == null || t < best) best = t;
      }
      return best;
    }
    const pm = S.machines[pr.station];
    if (!pm || !pm.op || pm.op.oid !== o.id || pm.op.idx !== pi) return null;
    const f = fillingAt(pm.id, o.id, pi);
    const need = Math.max(1, Math.min(opBatch(pr) - (f ? f.qty : 0), partsLeft(o, pi) + pop.inProc));
    let t = S.t;
    if (!pm.setupDone) t += pm.setupRun ? Math.max(0, pm.setupRun.dur - (S.t - pm.setupRun.t0)) : (pr.setupMin || 0) * 60 + 300;
    if (!pm.released && pr.firstPiece) t += cycleSec(pm, pr) + (pm.fpiMin || 15) * 60 + 600;
    if (pm.fault) t += pm.fault.repairSec;
    t += need * cycleSec(pm, pr);
    return t + 300;
  }
  /** Alle an den Arbeitsgang gebundenen Aufgaben beenden (Rüsten, Korrektur, Einlegen, Erstteil, Werkzeugwechsel) –
      eine Aufgabe darf ihren Arbeitsgang nie überleben. Anwesende Prüfer:in/Monteur:in bleibt für den nächsten Arbeitsgang. */
  function cancelOpTasks(m, why) {
    for (const key of ['setup', 'corr', 'load', 'fpi', 'offset']) {
      const tk = S.tasks[m.tasks[key]]; if (!tk) continue;
      if ((key === 'setup' && m.setupRun) || (key === 'corr' && m.corrRun) || (key === 'fpi' && m.fpi) || (key === 'load' && m.part && tk.workStarted)) continue;
      cancelTask(tk, why);
    }
    const tc = S.tasks[m.tasks.tc];
    if (tc && !m.toolchange) {
      const st = tc.steps[tc.si];
      const carrying = tc.assignee && (tc.data.fetched || (st && st.act === 'fetch' && tc.workStarted));
      if (carrying) ev('toolReturn', 'info', { kind: 'machine', id: m.id }, `${m.id}: Werkzeugwechsel entfällt (${why}) – ${pname(tc.assignee)} bringt das vermessene Werkzeug zurück in die Werkzeugausgabe`, { personId: tc.assignee });
      cancelTask(tc, why);
    }
    if (m.toolStaged && m.toolStaged.length) ev('toolReturn', 'info', { kind: 'machine', id: m.id }, `${m.id}: bereitgelegtes Werkzeug (${m.toolStaged.map(t => TT[t] ? TT[t].name : t).join(', ')}) geht zurück in die Werkzeugausgabe – ${why}`, null);
    m.toolStaged = null;
  }
  /** Arbeitsgang verlässt die Maschine (fertig oder unterbrochen): Aufgaben, Meldungen und Merker aufräumen */
  function releaseOpState(m, o, i, why) {
    // Waschprogramm/Messprogramm bleibt eingestellt: kommt der nächste Behälter desselben Arbeitsgangs (Waschanlage: gleiches
    // Waschprogramm = gleicher Werkstoff), entfällt das Rüsten
    m.keptSetup = m.setupDone && m.released && releasableOp(o.routing[i], i) ? { key: setupKey(m, o, i), t: S.t } : null;
    cancelOpTasks(m, why);
    if (m.rework || m.reworking) {
      // Erstteil zur Nacharbeit liegt noch an der Maschine → als Eingangsteil zurückbuchen (Mengenbilanz bleibt erhalten)
      const op = o.ops[i];
      if (op.inProc > 0) { op.inProc--; const c = newContainer(o, i - 1, i, 1, 'input'); placeAt(c, m.id, 'inp'); }
    }
    m.rework = false; m.reworking = false; m.manualTC = null;
    if (hasOpen('tool:' + m.id)) resolveKey('tool:' + m.id, why + ' – Wechsel entfällt');
    GDIRTY = true;
    const sk = 'spc:' + o.id + '/' + o.routing[i].seq;
    if (hasOpen(sk)) resolveKey(sk, 'Arbeitsgang ' + (o.ops[i].complete ? 'beendet' : 'unterbrochen'));
    resolveMissing(m, o.ops[i].complete ? 'Arbeitsgang beendet' : null);
    cancelBars(m);
    o.ops[i].machine = null;
    m.op = null; m.setupDone = false; m.released = false; m.needCorr = false; m.starvedSince = null;
    planChanged();
  }
  function finishOp(m, o, i) {
    returnLeftovers(m, o, i);
    releaseOpState(m, o, i, 'Arbeitsgang beendet');
    m.nextPickT = 0;
  }
  /** Arbeitsgang unterbrechen (Material kommt erst viel später, anderer Arbeitsgang hat Material am Platz) */
  function pauseOp(m, o, i, why, minor) {
    const f = fillingAt(m.id, o.id, i);
    if (f && f.qty > 0) closeContainer(f);
    releaseOpState(m, o, i, 'Arbeitsgang unterbrochen');
    ev('opPause', 'info', { kind: 'machine', id: m.id }, why, { orderId: o.id, seq: o.routing[i].seq, minor: !!minor });
  }
  function maybeSwitch(m, o, i) {
    if (S.t - m.lastSwitchCheck < CFG.switchCheckSec) return false;
    m.lastSwitchCheck = S.t;
    if (m.part || m.fpi || m.rework || m.reworking || m.needCorr || S.t - m.starvedSince < 60) return false;
    if (inboundQty(o.id, i) > 0) return false;
    const r = o.routing[i];
    const eta = arrivalEta(o, i);
    const gap = eta == null ? Infinity : eta - S.t;
    if (gap <= Math.max(1800, 2 * (r.setupMin || 0) * 60)) return false;
    const alt = bestCandidate(m, 2, { oid: o.id, idx: i });
    if (!alt) return false;
    // nur sinnvolle Wechsel: der andere Arbeitsgang passt komplett in die Lücke (inkl. Wieder-Rüsten) oder ist dringender
    const w = workFor(m, alt.o, alt.i, false);
    const resume = (r.setupMin || 0) * 60 + (r.firstPiece ? (m.fpiMin || 15) * 60 + 900 : 0);
    const fits = w.setup + w.fpi + w.run + resume <= gap;
    const urgent = cmpKey([alt.o.priority === 'eil' ? 0 : 1, alt.o.due], [o.priority === 'eil' ? 0 : 1, o.due]) < 0;
    if (!fits && !urgent) return false;
    pauseOp(m, o, i, `${m.id} unterbricht ${o.id} AG ${r.seq} (nächste Teile ${eta ? 'erst ca. ' + tclock(eta) : 'nicht absehbar'}) und zieht ${alt.o.id} AG ${alt.r.seq} vor – Material liegt bereit, ${fits ? 'passt in die Lücke' : 'dringender (' + (alt.o.priority === 'eil' ? 'Eilauftrag' : 'Termin ' + U.fmtDayClock(alt.o.due)) + ')'}`);
    activateOp(m, alt.o, alt.i, alt.lv);
    return true;
  }
  /** Ausgang voll nur mit abholbereiten Behältern, deren Zielpuffer voll sind (nicht: Transportmittel fehlt) → Zielnamen, sonst null */
  function outputAhead(m) {
    const st = S.stations[m.id]; if (!st || !st.out.length) return null;
    const dest = new Set();
    for (const cid of st.out) {
      const c = S.containers[cid], tr = c && c.transportId && S.transports[c.transportId];
      if (!c || c.state !== 'ready' || !tr || tr.status !== 'open' || tr.waitCode !== 'destFull') return null;
      dest.add(stShort(tr.to.station));
    }
    return [...dest].join(', ');
  }
  /** Platz im Eingangspuffer der Folgestation von Arbeitsgang i (Fremdbearbeitung/Versand: immer) */
  function succRoom(o, i, inflight) {
    const next = o.routing[i + 1]; if (!next) return true;
    const m2 = S.machines[next.station]; if (!m2) return true;
    const e = (inflight || inflightMap())[m2.id];
    return countIn(m2.id) + (e ? e.n : 0) < Math.max(1, m2.inCap);
  }
  /** Ausgang staut sich (≥ 2 abholbereite Behälter warten auf einen vollen Zielpuffer): Los unterbrechen (gefertigte Teile
      bleiben im Behälter, Rest später) und einen freigegebenen Auftrag mit Material am Platz und freiem Ziel vorziehen –
      sofort bei kurzem Rüsten (≤ 15 min, z. B. Säge), sonst erst nach 60 min Stau. Das unterbrochene Los wird erst wieder
      eingeplant, wenn sein Ziel Platz hat (op.outHold). */
  function outputSwitch(m, o, i) {
    m.outSwitchT = S.t;
    if (m.part || m.fpi || m.rework || m.reworking || m.needCorr || m.setupRun || m.toolchange || m.fault || !m.setupDone) return false;
    const st = S.stations[m.id]; if (!st || countOut(m.id) >= Math.max(1, m.outCap)) return false;
    let stuck = 0, dest = null;
    for (const cid of st.out) {
      const c = S.containers[cid], tr = c && c.transportId && S.transports[c.transportId];
      if (c && c.orderId === o.id && c.src === i && c.state === 'ready' && tr && tr.status === 'open' && tr.waitCode === 'destFull') { stuck++; dest = tr.to.station; }
    }
    if (stuck < 2) return false;
    if (m.state === 'blocked') m.blockedSince = m.blockedSince || m.since; else m.blockedSince = null;
    const inflight = inflightMap();
    let best = null;
    for (const [o2, i2] of opsAt(m.id)) {
      if (o2.status === 'fertig' || (o2 === o && i2 === i)) continue;
      const op2 = o2.ops[i2];
      if (op2.complete || (op2.machine && op2.machine !== m.id) || partsLeft(o2, i2) <= 0) continue;
      if (opLevel(m, o2, i2).level < 2 || !succRoom(o2, i2, inflight)) continue;
      const r2 = o2.routing[i2], cheap = !((r2.setupMin || 0) > 15);
      if (!cheap && S.t - (m.blockedSince || S.t) < 3600) continue;
      const k = [o2.priority === 'eil' ? 0 : 1, o2.due, o2.id, r2.seq];
      if (!best || cmpKey(k, best.k) < 0) best = { o: o2, i: i2, r: r2, k };
    }
    if (!best) return false;
    const r = o.routing[i], done = o.ops[i].good + o.ops[i].scrap, tot = opTotal(o, i);
    o.ops[i].outHold = { dest, t: S.t };
    pauseOp(m, o, i, `${m.id} teilt das Los ${o.id} AG ${r.seq} (${done}/${tot} gefertigt, Rest später) – ${stuck} Behälter warten, Zielpuffer ${stShort(dest)} voll; zieht ${best.o.id} AG ${best.r.seq} vor (Ziel ${stShort(best.r ? (best.o.routing[best.i + 1] || {}).station || 'VERSAND' : '')} frei)`);
    activateOp(m, best.o, best.i, opLevel(m, best.o, best.i));
    return true;
  }
  /** nicht verbrauchte Rohteile nach Arbeitsgang-Ende zurück ins Lager buchen */
  function returnLeftovers(m, o, i) {
    const st = S.stations[m.id]; if (!st) return;
    for (const cid of st.inp.slice()) {
      const c = S.containers[cid];
      if (!c || c.orderId !== o.id || c.idx !== i || c.qty <= 0) continue;
      const r = o.routing[i];
      if (c.src === -1 && r.material) { const mt = S.materials[r.material.id]; mt.onHand = r6(mt.onHand + c.qty * r.material.perPart); checkStock(mt); }
      o.ops[i].received -= c.qty;
      ev('return', 'info', { kind: 'container', id: c.id }, `${c.qty} überzählige Rohteile ${o.id} zurück ins Lager gebucht`, null);
      removeContainer(c);
    }
  }

  // ------------------------------------------------------------------ Maschinen: Material
  function inputAvail(m, o, i) {
    const r = o.routing[i];
    if (m.rework) return OK; // Erstteil wird nachgearbeitet (liegt an der Maschine, kein neues Rohteil nötig)
    if (i === 0 && partsLeft(o, 0) <= 0) return { ok: false, code: 'done', cause: 'Alle Teile gestartet – Abschluss ausstehend' };
    if (isSawRaw(m, r, i)) {
      const mt = S.materials[r.material.id];
      if (mt.onHand + 1e-9 >= r.material.perPart) return OK;
      notifyMissing(m, mt, r);
      return { ok: false, code: 'raw', cause: cz(m, 'raw:' + mt.id + mt.onHand + '|' + mt.onOrder, () => `Rohmaterial ${mt.name} fehlt (Bestand ${nm(mt.onHand, 2)} ${mt.unit}, Bedarf ${nm(r.material.perPart, 2)} ${mt.unit} je Teil)${mt.onOrder ? ' – Lieferung unterwegs' : ' – nicht bestellt'}`) };
    }
    if (isBarFed(m, r)) {
      if (m.barMat === r.material.id && m.barStockM + 1e-9 >= r.material.perPart) return OK;
      const tr = barsTransportOf(m);
      const mt = S.materials[r.material.id];
      if (!tr && mt.onHand + 1e-9 < r.material.perPart) { notifyMissing(m, mt, r); return { ok: false, code: 'raw', cause: `Stangenmagazin leer und kein ${mt.name} mehr im Lager` }; }
      return { ok: false, code: 'bars', cause: cz(m, 'bars:' + (tr ? tr.id + tr.status + (tr.assignee || '') : '-') + m.barStockM, () => `Stangenmagazin leer (${nm(m.barStockM || 0, 2)} m) – ${tr ? trWhy(tr) : 'Nachschub wird beauftragt'}`) };
    }
    if (firstInput(m.id, o.id, i)) return OK;
    return { ok: false, code: 'parts', cause: cz(m, 'in:' + o.id + i, () => inputWhy(m, o, i)) };
  }
  function inputWhy(m, o, i) {
    for (const id in S.containers) {
      const c = S.containers[id];
      if (c.orderId !== o.id || c.idx !== i) continue;
      if (c.state === 'transit') return `Behälter (${c.qty} Stk) ist unterwegs`;
      if (c.state === 'ready' && c.transportId && S.transports[c.transportId]) return `Behälter (${c.qty} Stk) steht abholbereit an ${stShort(c.location ? c.location.id : '?')} – ${trWhy(S.transports[c.transportId])}`;
    }
    if (i === 0) {
      const r = o.routing[0];
      if (r.material) { const mt = S.materials[r.material.id]; if (mt.onHand + 1e-9 < r.material.perPart) return `Rohteile ${mt.name} fehlen im Lager`; }
      return 'Rohteile werden bereitgestellt';
    }
    const pr = o.routing[i - 1];
    const eta = arrivalEta(o, i);
    if (pr.station === 'EXT') return `Teile in Fremdbearbeitung (${shortName((pr.ext && pr.ext.partner) || 'extern')})${eta ? ', Rückkehr ca. ' + U.fmtDayClock(eta) : ''}`;
    return `Wartet auf Teile von ${mLabel(pr.station)} (${o.id} AG ${pr.seq})${eta ? ' – nächster Behälter ca. ' + tclock(eta) : ''}`;
  }
  /** Material-fehlt-Meldungen der Maschine auflösen (Arbeitsgang verlässt die Maschine) – mit ehrlicher Begründung */
  function resolveMissing(m, note) {
    if (!m.missing) return;
    for (const matId in m.missing) {
      const key = m.missing[matId], mt = S.materials[matId];
      if (hasOpen(key)) resolveMissingKey(key, note || (mt && mt.onHand + 1e-9 >= missingNeed(m, matId) ? `Material wieder verfügbar (Bestand ${nm(mt.onHand, mt.unit === 'm' ? 1 : 0)} ${mt.unit})` : `Arbeitsgang gewechselt – ${mt ? mt.name : matId} fehlt weiterhin${mt && mt.onOrder ? ' (Lieferung unterwegs)' : ''}`));
    }
    m.missing = null;
  }
  function missingNeed(m, matId) {
    const c = curOf(m);
    return c && c.r.material && c.r.material.id === matId ? c.r.material.perPart : 1e-9;
  }
  /** nach jeder Bestandsänderung: Maschinen, denen dieses Material fehlte, wieder freimelden */
  function checkMissing(mt) {
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j], key = m.missing && m.missing[mt.id];
      if (!key) continue;
      const c = curOf(m), uses = !!(c && c.r.material && c.r.material.id === mt.id);
      if (!uses) { if (hasOpen(key)) resolveMissingKey(key, 'Arbeitsgang gewechselt – Material hier nicht mehr benötigt'); delete m.missing[mt.id]; }
      else if (mt.onHand + 1e-9 >= c.r.material.perPart) { if (hasOpen(key)) resolveMissingKey(key, `Material wieder verfügbar (Bestand ${nm(mt.onHand, mt.unit === 'm' ? 1 : 0)} ${mt.unit})`); delete m.missing[mt.id]; }
      else if (!hasOpen(key)) delete m.missing[mt.id];
    }
  }
  /** nächste offene Lieferung eines Materials – Text immer aktuell: 'Lieferung ca. Mo 14:10' bzw. überfällig */
  function nextPurchase(matId) { let best = null; for (const x of S.purchases) if (x.status === 'bestellt' && x.materialId === matId && (!best || x.etaT < best.etaT)) best = x; return best; }
  const deliveryTxt = (pu) => !pu ? '' : pu.etaT > S.t ? `Lieferung ca. ${tclock(pu.etaT)}` : `Lieferung überfällig seit ${tclock(pu.etaT)} – beim Lieferanten nachfragen`;
  function notifyMissing(m, mt, r) {
    const key = 'missing:' + mt.id + ':' + m.id;
    (m.missing || (m.missing = {}))[mt.id] = key;
    // bei offener Meldung nur aktualisieren (Liefertermin live, nie eine vergangene Zeit als Prognose)
    const pu = nextPurchase(mt.id), due = pu && pu.etaT <= S.t;
    notify({ key, sev: 'crit', role: 'Einkauf', entity: { kind: 'machine', id: m.id }, title: `Material fehlt: ${mt.name} für ${m.id}`,
      body: `${m.id} steht · Bestand ${nm(mt.onHand, 2)} ${mt.unit} < ${nm(r.material.perPart, 3)} ${mt.unit} je Teil${pu ? ' · ' + deliveryTxt(pu) : ''}`,
      suggestion: brief(`${mt.name} aufgebraucht${pu && !due ? ', ' + deliveryTxt(pu) : ''}`, due ? `beim Lieferanten ${shortName(mt.supplier)} nachfragen; bis dahin anderen Auftrag vorziehen` : mt.onOrder ? 'Liefertermin bestätigen; bis dahin anderen Auftrag vorziehen' : `sofort nachbestellen (${nm(mt.reorderQty, 1)} ${mt.unit} bei ${shortName(mt.supplier)})`),
      actions: mt.onOrder ? [] : [{ label: 'Nachbestellen', action: { type: 'reorder', materialId: mt.id, qty: mt.reorderQty } }] });
  }
  /** Material-Meldung abschließen: Titel/Body auf die abgeschlossene Episode umstellen (keine veraltete Lieferzeit) */
  function resolveMissingKey(key, note) {
    const n = NIDX[key]; if (!n || n.status === 'resolved') { resolveKey(key, note); return; }
    const p = key.split(':'), mt = S.materials[p[1]], mid = p[2];
    n.title = `Material fehlte: ${mt ? mt.name : p[1]} für ${mid} (${tclock(n.t)}–${U.fmtClock(S.t)})`;
    n.body = `${mid} wartete ${U.fmtDur(S.t - n.t)} · ${note}`;
    resolveKey(key, note);
  }
  /** Rohteile-Behälter für den ersten Arbeitsgang (Form 'Stk' oder ohne Materialangabe) nachliefern */
  function ensureSupply(m, o, i) {
    const r = o.routing[0], op = o.ops[0];
    // nur neu prüfen, wenn sich Behälter, Bestand oder Zähler geändert haben (wird je Sekunde aus decide gerufen)
    const sig = CV + '|' + o.id + '|' + op.good + '|' + op.inProc + '|' + (r.material ? S.materials[r.material.id].onHand : '');
    if (m.supplySig === sig) return;
    m.supplySig = sig;
    let pending = waitingQty(o.id, 0);
    for (const id in S.containers) { const c = S.containers[id]; if (c.orderId === o.id && c.idx === 0 && (c.state === 'ready' || c.state === 'transit')) pending += c.qty; }
    const need = o.qty - op.good - op.inProc - pending;
    const batch = opBatch(r);
    if (need <= 0 || pending >= batch) return;
    let qty = Math.min(batch, need);
    if (r.material) {
      const mt = S.materials[r.material.id];
      const can = Math.floor((mt.onHand + 1e-9) / r.material.perPart);
      qty = Math.min(qty, can);
      if (qty <= 0) { if (pending === 0) notifyMissing(m, mt, r); return; }
      materialIssue(mt, qty * r.material.perPart);
    }
    const c = newContainer(o, -1, 0, qty, 'ready', 'raw');
    placeAt(c, 'RAW', 'out');
    createTransport(c);
    ev('issue', 'info', { kind: 'material', id: r.material ? r.material.id : 'RAW' }, `Rohteile bereitgestellt: ${qty} Stk für ${o.id} → ${m.id}${r.material ? ' (Entnahme ' + S.materials[r.material.id].name + ')' : ''}`, { orderId: o.id, qty });
  }
  function barsTransportOf(m) {
    for (const id of ATR) { const t = S.transports[id]; if (t && t.kind === 'bars' && t.to.station === m.id && t.status !== 'done') return t; }
    return null;
  }
  /** Stangenlader: Nachschub beauftragen, wenn Magazin < barReorderM und noch Bedarf besteht */
  function ensureBars(m, o, i) {
    if (!m.setupDone && !m.setupRun) return;
    const r = o.routing[i];
    if (m.barMat !== r.material.id) return; // Materialwechsel wird beim Rüsten behandelt
    const need = partsLeft(o, i) * r.material.perPart;
    if (m.barStockM >= m.barReorderM || m.barStockM >= need - 1e-9) return;
    if (barsTransportOf(m)) return;
    const mt = S.materials[r.material.id];
    if (mt.onHand + 1e-9 < r.material.perPart) return;
    const tr = createBarsTransport(m, mt.id);
    ev('barsOrder', 'info', { kind: 'machine', id: m.id }, `${m.id}: Stangenmagazin ${nm(m.barStockM, 2)} m < ${nm(m.barReorderM, 0)} m – Nachschub ${mt.name} per Stapler beauftragt`, { transportId: tr.id });
  }
  function cancelBars(m) {
    const t = barsTransportOf(m);
    if (!t || t.status === 'toDrop' || t.status === 'loaded') return;
    if (t.taskId && S.tasks[t.taskId]) { const tk = S.tasks[t.taskId]; if (tk.workStarted) return; finishTask(tk, 'cancelled'); }
    t.status = 'done'; t.doneT = S.t; t.cancelled = true;
  }
  function outputRoom(m, o, i) {
    const f = fillingAt(m.id, o.id, i);
    if (f && f.qty < opBatch(o.routing[i])) return true;
    return countOut(m.id) < Math.max(1, m.outCap);
  }
  function blockedTr(m) {
    const st = S.stations[m.id];
    for (const cid of st.out) { const c = S.containers[cid]; if (c && c.state === 'ready' && c.transportId && S.transports[c.transportId]) return S.transports[c.transportId]; }
    return null;
  }
  function blockedWhy(m) {
    const st = S.stations[m.id];
    for (const cid of st.out) { const c = S.containers[cid]; if (c.state === 'ready' && c.transportId && S.transports[c.transportId]) return trWhy(S.transports[c.transportId]); }
    return 'Behälter wird geschlossen';
  }
  function trWhy(tr) {
    if (tr.status === 'done') return 'Transport erledigt';
    if (tr.assignee) { const a = S.agvs[tr.assignee]; return (a ? a.name : pname(tr.assignee) + ' (Stapler)') + ' ist unterwegs'; }
    if (tr.waitReason) return tr.waitReason;
    return tr.mode === 'AGV' ? 'wartet auf freies AGV' : 'wartet auf Logistiker:in (Stapler)';
  }

  // ------------------------------------------------------------------ Maschinen: Teile
  /** Eingangsteil entnehmen (reservieren) – bucht Rohmaterial bzw. Stangenmagazin ab */
  function takeInput(m, o, i) {
    const r = o.routing[i], op = o.ops[i];
    if (isSawRaw(m, r, i)) { materialIssue(S.materials[r.material.id], r.material.perPart); op.received++; }
    else if (isBarFed(m, r)) { m.barStockM = r6(Math.max(0, m.barStockM - r.material.perPart)); S.materials[r.material.id].usedToday = r6(S.materials[r.material.id].usedToday + r.material.perPart); op.received++; }
    else {
      const c = firstInput(m.id, o.id, i);
      c.qty--; setWeight(c, o);
      if (c.qty <= 0) { removeContainer(c); emptyReturn(m.id, c.src >= 0 ? o.routing[c.src].station : 'RAW'); }
    }
    op.inProc++;
    if (!op.startT) op.startT = S.t;
  }
  function newPart(m, o, i, sub, by) {
    const r = o.routing[i], op = o.ops[i];
    const dur = Math.max(5, Math.round((r.cycleMin || 1) * 60 * R.range(0.97, 1.03)));
    m.part = { oid: o.id, idx: i, seq: r.seq, sub, rem: dur, dur, first: !m.released, by: by || null, t0: S.t,
      no: op.good + op.scrap + op.inProc, of: opTotal(o, i), rework: !!m.reworking };
    m.reworking = false;
    const pt = m.part;
    const repl = i === 0 && op.scrap > 0 ? ` (inkl. ${op.scrap} Ersatz für Ausschuss)` : '';
    pt.label = pt.first ? `${pt.rework ? 'Nacharbeit Erstteil' : 'Erstteil'} ${o.id} AG ${r.seq} wird gefertigt` : `Teil ${pt.no}/${pt.of} ${o.id} AG ${r.seq} in Bearbeitung${repl}`;
    pt.loadLabel = `Teil ${pt.no}/${pt.of} wird eingelegt (${by ? pname(by) : '–'})`;
    // Planung „nach diesem Teil“: was an der nächsten Teilegrenze gewechselt wird, ist ab jetzt angekündigt
    if ((r.tools || []).length) planTools(m);
  }
  /** Teil reservieren – bei Nacharbeit des Erstteils wird kein neues Rohteil entnommen */
  function reserve(m, o, i) { if (m.rework) { m.rework = false; m.reworking = true; return; } takeInput(m, o, i); }
  function startPart(m, o, i, by) { reserve(m, o, i); newPart(m, o, i, 'cut', by); }
  function startLoad(m, o, i, p) {
    reserve(m, o, i);
    newPart(m, o, i, 'load', p.id);
    const tk = p.task;
    tk.steps[tk.si + 1].sec = loadSecOf(m, o.routing[i]);
    advanceTask(p);
  }
  /** Bediener vor Zyklusende rufen, damit er an der Teilegrenze bereitsteht */
  function precallLoad(m) {
    if (m.tasks.load || !m.op || m.fault) return;
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i];
    if (!m.released && !m.part.first) return;
    if (m.part.first) return; // nach dem Erstteil folgt die Prüfung
    if (partsLeft(o, i) <= 0) return;
    if (!isSawRaw(m, r, i) && !isBarFed(m, r) && !firstInput(m.id, o.id, i)) return;
    ensureMTask(m, 'load');
  }
  /** Teilende: Standzeit buchen (nur hier!), messen, Gut/Ausschuss, Weitergabe, Werkzeugplanung */
  function partEnd(m) {
    const pt = m.part; m.part = null;
    const o = S.orders[pt.oid], i = pt.idx, r = o.routing[i], op = o.ops[i];
    // 1) Werkzeugverschleiß – steigt ausschließlich am Teilende, nie über 100 %
    let dress = false;
    for (const tid of m.tools) {
      const tl = S.tools[tid], need = cutFor(r, tl.typeId);
      if (!(need > 0)) continue;
      tl.used = Math.min(tl.life, r6(tl.used + need)); tl.parts++; m.tv++;
      if (tl.kind === 'wheel') { tl.sinceDress++; const de = TT[tl.typeId].dressEvery || 0; if (de && tl.sinceDress >= de) { tl.sinceDress = 0; dress = true; } }
    }
    m.counter++; m.lastPartT = S.t;
    const ideal = (r.cycleMin || 1) * 60;
    // ohne den Anteil, der schon im vorigen Zeitraum angezeigt wurde (Teil lief über Schicht-/Tageswechsel)
    m.kd.ideal += Math.max(0, ideal - m.kd.idealPre); m.ks.ideal += Math.max(0, ideal - m.ks.idealPre);
    m.kd.idealPre = 0; m.ks.idealPre = 0;
    // 2) Messwert des Hauptmerkmals
    const meas = measure(m, o, i, pt);
    if (pt.first) {
      const local = !!m.fpiLocalNext; m.fpiLocalNext = false;
      m.fpi = { stage: 'wait', t0: S.t, value: meas.v, measOk: meas.ok, no: pt.no, by: null, local, reason: local ? 'nach Werkzeugwechsel' : 'nach Rüsten' };
      ensureMTask(m, 'fpi');
      ev('fpiReady', 'info', { kind: 'machine', id: m.id }, local ? `${m.id}: erstes Teil ${o.id} AG ${r.seq} nach Formwerkzeug-Wechsel fertig – Kontrolle an der Maschine (Bediener/Einrichter)` : `${m.id}: Erstteil ${o.id} AG ${r.seq} fertig – wartet auf Erstteilprüfung (QS)`, { orderId: o.id, seq: r.seq, local });
    } else {
      op.inProc--;
      if (meas.ok) { op.good++; countGood(m, 1, o, i); addToOutput(m, o, i, 1); }
      else { op.scrap++; scrapParts(o, i, 1, 'Maß', m, `${meas.char.name} = ${fmtVal(meas.v, meas.char)} ${meas.char.unit} außerhalb ${fmtVal(meas.lsl, meas.char)} … ${fmtVal(meas.usl, meas.char)}`); }
      spcCheck(m, o, i);
    }
    if (dress) {
      // Abrichten nur, wenn noch geschliffen wird – nach dem letzten Teil wird es vor dem nächsten Schliff nachgeholt
      if (partsLeft(o, i) > 0 || m.rework) m.dressRem = CFG.dressSec;
      else for (const tid of m.tools) { const tl = S.tools[tid]; if (tl.kind === 'wheel' && cutFor(r, tl.typeId) > 0) tl.dressDue = true; }
    }
    if (!pt.first) checkOpComplete(o, i);
    if (m.op) planTools(m);
  }
  function countGood(m, n, o, i) {
    m.kd.good += n; m.ks.good += n; S.today.good += n; S.shiftStats.good += n; S.histAcc.good += n;
    if (o && i === lastProcIdx(o)) S.today.goodFinished = (S.today.goodFinished || 0) + n;
  }
  function lastProcIdx(o) { let k = o.routing.length - 1; while (k > 0 && o.routing[k].station === 'VERSAND') k--; return k; }
  function addToOutput(m, o, i, n) {
    let f = fillingAt(m.id, o.id, i);
    if (!f) { f = newContainer(o, i, i + 1, 0, 'filling'); placeAt(f, m.id, 'out'); }
    f.qty += n; setWeight(f, o);
    if (f.qty >= opBatch(o.routing[i])) closeContainer(f);
  }
  /** Ausschuss → Behälter im Sperrlager (je Auftrag), Kennzahlen nach Ursache */
  function scrapParts(o, i, n, reason, m, detail) {
    const st = S.stations.SPERR;
    let c = null;
    if (st) for (const cid of st.inp) { const x = S.containers[cid]; if (x.orderId === o.id && x.state === 'scrap') { c = x; break; } }
    if (!c) { c = newContainer(o, i, i, 0, 'scrap', 'scrap'); placeAt(c, 'SPERR', 'inp'); }
    c.qty += n; setWeight(c, o); c.lastReason = reason;
    if (m) { m.kd.scrap += n; m.ks.scrap += n; }
    S.today.scrap += n; S.shiftStats.scrap += n;
    S.today.scrapBy[reason] = (S.today.scrapBy[reason] || 0) + n;
    ev('scrap', 'warn', { kind: 'machine', id: m ? m.id : o.routing[i].station }, `Ausschuss ${o.id} AG ${o.routing[i].seq} (${reason})${detail ? ': ' + detail : ''} → Sperrlager`, { orderId: o.id, seq: o.routing[i].seq, reason, qty: n });
    if (i > 0) qtyRiskNotify(o, i, reason);
  }
  /** Ausschuss nach dem 1. Arbeitsgang wird nicht automatisch nachgefertigt → Liefermenge sinkt (ohne Nachfertigung) */
  function scrapAfterFirst(o) { let s0 = 0; for (let j = 1; j < o.ops.length; j++) s0 += o.ops[j].scrap; return s0; }
  function qtyRiskOf(o) {
    const down = scrapAfterFirst(o), rem = o.remakeQty || 0;
    if (!down && !rem) return null;
    const expected = o.qty - down, missing = Math.max(0, down - rem);
    return { qty: o.qty, expectedQty: expected, scrapAfterFirst: down, remakeQty: rem, remakes: (o.remakes || []).slice(), missing,
      text: missing > 0 ? `nur ${expected}/${o.qty} Stk – ${missing} Stk Ausschuss nach AG ${o.routing[0].seq}, keine Nachfertigung eingeplant`
        : `${expected}/${o.qty} Stk aus diesem Auftrag, ${rem} Stk in Nachfertigung ${(o.remakes || []).join(', ')}` };
  }
  /** sofortige Warnung „Menge gefährdet“ mit Nachfertigungs-Aktion (Rohmaterial wird geprüft) */
  function qtyRiskNotify(o, i, reason) {
    const q = qtyRiskOf(o); if (!q || q.missing <= 0) return;
    const r0 = o.routing[0], mt = r0.material && S.materials[r0.material.id];
    let matTxt = '';
    if (mt) { const need = q.missing * r0.material.perPart, dec = mt.unit === 'm' ? 1 : 0; matTxt = mt.onHand + 1e-9 >= need ? ` (${mt.name} vorhanden)` : ` (${mt.name} fehlt – ${mt.kanban ? 'Kanban ruft ab' : 'nachbestellen'})`; }
    notify({ key: 'qty:' + o.id, sev: 'warn', role: 'Schichtleitung', entity: { kind: 'order', id: o.id },
      title: `Menge gefährdet: ${o.id} nur ${q.expectedQty}/${o.qty} – Nachfertigung ab ${stShort(r0.station)} einplanen`,
      body: `${q.scrapAfterFirst} Stk Ausschuss nach AG ${r0.seq} (zuletzt AG ${o.routing[i].seq}, ${reason}) · liefert sonst ${q.expectedQty}/${o.qty} an ${shortName(o.customer)}`,
      suggestion: brief(`Ausschuss nach dem 1. Arbeitsgang wird nicht nachgefertigt`, `${q.missing} Stk Nachfertigung ab ${stShort(r0.station)} einplanen${matTxt}`),
      actions: [{ label: `Nachfertigung ${q.missing} Stk einplanen`, action: { type: 'planRemake', orderId: o.id } }, { label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id: o.id } }] });
  }
  function fmtVal(v, ch) { const span = ch.tolPlus - ch.tolMinus; const d = span < 0.05 ? 4 : span < 1 ? 3 : 2; return nm(v, d); }
  /** Messwert = Toleranzmitte + Drift(Verschleiß Hauptwerkzeug) + Korrekturwert + Rauschen */
  function measure(m, o, i, pt) {
    const r = o.routing[i], ch = charOf(m, r), op = o.ops[i];
    const lsl = ch.nominal + ch.tolMinus, usl = ch.nominal + ch.tolPlus, center = (lsl + usl) / 2;
    let main = null, mainCut = -1;
    for (const tid of m.tools) { const tl = S.tools[tid], c = cutFor(r, tl.typeId); if (c > mainCut) { mainCut = c; main = tl; } }
    const wear = main && mainCut > 0 ? main.used / main.life : 0;
    // Einlege-/bemannte Arbeitsplätze: Bediener misst jedes Teil beim Entnehmen und kompensiert den Verschleiß
    // in der Werkzeugkorrektur (Rest-Drift 40 %). Autonome Maschinen driften voll – bis SPC-Korrektur oder Wechsel.
    const comp = m.loading === 'auto' ? 0 : 0.6;
    const v = r6(center + (ch.driftAt100 || 0) * wear * (1 - comp) + (op.offset || 0) + R.normal(0, ch.sigma || (usl - lsl) / 10));
    const ok = v >= lsl - 1e-12 && v <= usl + 1e-12;
    const key = o.id + '/' + r.seq;
    const arr = S.measurements[key] || (S.measurements[key] = []);
    arr.push({ t: S.t, v, ok, partNo: pt.no, fpi: !!pt.first });
    if (arr.length > CFG.measMax) arr.splice(0, arr.length - CFG.measMax);
    return { v, ok, char: ch, lsl, usl, center, wear, mainTool: main };
  }
  /** SPC: Mittelwert der letzten 8 Teile wandert Richtung Toleranzgrenze bzw. gehäufter Ausschuss */
  function spcCheck(m, o, i) {
    const r = o.routing[i], ch = charOf(m, r), key = o.id + '/' + r.seq, nkey = 'spc:' + key;
    const since = S.spcSince[key] || 0;
    const arr = (S.measurements[key] || []).filter(x => !x.fpi && x.t > since);
    if (arr.length < 8) return;
    const last = arr.slice(-8);
    const mean = last.reduce((s, x) => s + x.v, 0) / last.length;
    const lsl = ch.nominal + ch.tolMinus, usl = ch.nominal + ch.tolPlus, center = (lsl + usl) / 2;
    const dev = mean - center, half = dev >= 0 ? usl - center : center - lsl;
    const ratio = half > 0 ? Math.abs(dev) / half : 0;
    const nok = arr.slice(-10).filter(x => !x.ok).length;
    if (ratio > 0.55 || nok >= 2) {
      const corr = -Math.round(dev * 10000) / 10000;
      const tl = mainToolOf(m, r);
      const n = notify({ key: nkey, sev: 'warn', role: 'QS', entity: { kind: 'machine', id: m.id },
        title: `SPC-Trend ${m.id}: ${ch.name} (${o.id})`,
        body: `Mittelwert 8 Teile ${fmtVal(mean, ch)} ${ch.unit} · ${Math.round(ratio * 100)} % zur ${dev > 0 ? 'oberen' : 'unteren'} Grenze ${fmtVal(dev > 0 ? usl : lsl, ch)}${nok ? ' · ' + nok + '/10 n.i.O.' : ''}`,
        suggestion: brief(`Verschleiß ${tl ? TT[tl.typeId].name + ' (' + Math.round(tl.used / tl.life * 100) + ' %)' : 'Werkzeug'} verschiebt ${ch.name}`, `Korrektur ${corr > 0 ? '+' : ''}${nm(corr, 4)} ${ch.unit} eingeben (Bediener) oder Wechsel vorziehen`),
        actions: [{ label: 'Korrektur übernehmen', action: { type: 'applyOffset', orderId: o.id, seq: r.seq, value: corr } }] });
      if (!n.spc) n.spc = { machineId: m.id, orderId: o.id, seq: r.seq, since: S.t };
      n.spc.value = corr;
    } else if (ratio < 0.3 && nok === 0 && hasOpen(nkey)) resolveKey(nkey, 'Prozess wieder mittig');
  }
  function mainToolOf(m, r) {
    let main = null, mc = -1;
    for (const tid of m.tools) { const tl = S.tools[tid], c = cutFor(r, tl.typeId); if (c > mc) { mc = c; main = tl; } }
    return mc > 0 ? main : null;
  }
  function applyOffset(orderId, seq, value, by) {
    const o = S.orders[orderId]; if (!o) return { ok: false, msg: 'Auftrag unbekannt' };
    const i = o.routing.findIndex(r => r.seq === seq); if (i < 0) return { ok: false, msg: 'Arbeitsgang unbekannt' };
    const v = Number(value); if (!isFinite(v)) return { ok: false, msg: 'Korrekturwert ungültig' };
    o.ops[i].offset = r6((o.ops[i].offset || 0) + v);
    const ch = charOf(S.machines[o.routing[i].station] || { type: 'cmm' }, o.routing[i]);
    ev('offset', 'info', { kind: 'machine', id: o.routing[i].station }, `${o.routing[i].station}: Werkzeugkorrektur ${v > 0 ? '+' : ''}${nm(v, 4)} ${ch.unit} für ${orderId} AG ${seq} eingegeben${by ? ' (' + by + ')' : ''} – Ursache SPC-Trend`, { orderId, seq, value: v });
    const key = 'spc:' + orderId + '/' + seq;
    S.spcSince[orderId + '/' + seq] = S.t;
    if (hasOpen(key)) resolveKey(key, 'Korrektur eingegeben');
    return { ok: true, msg: 'Korrektur übernommen' };
  }

  // ------------------------------------------------------------------ Maschinen: Rüsten, Erstteil, Korrektur
  function instantSetup(m, o, i) {
    mountForOp(m, o, i);
    m.setupDone = true; m.released = !o.routing[i].firstPiece;
  }
  function onSetupStart(m, p) {
    const c = curOf(m); if (!c) return;
    const { o, i, r } = c;
    const verb = !(r.tools || []).length && SETUP_NOTOOL[m.type] ? SETUP_NOTOOL[m.type][0] : 'rüstet';
    m.setupRun = { t0: S.t, by: p.id, dur: (r.setupMin || 0) * 60, cause: `${sn(p.name)} ${verb} für ${o.id} AG ${r.seq} „${r.op}“ (${r.setupMin} min)` };
    const mt = mountForOp(m, o, i);
    if (isBarFed(m, r) && m.barMat !== r.material.id) {
      if (m.barMat && m.barStockM > 0) {
        const old = S.materials[m.barMat];
        old.onHand = r6(old.onHand + m.barStockM); checkStock(old);
        ev('return', 'info', { kind: 'material', id: old.id }, `${m.id}: Reststangen ${old.name} (${nm(m.barStockM, 2)} m) ins Lager zurückgebucht – Materialwechsel`, null);
      }
      m.barStockM = 0; m.barMat = r.material.id;
      const t = barsTransportOf(m); if (t && t.materialId !== r.material.id) cancelBars(m);
      if (!barsTransportOf(m)) createBarsTransport(m, r.material.id);
    }
    S.today.setups++;
    if (o.status === 'freigegeben') { o.status = 'in Arbeit'; o.startT = S.t; }
    ev('setupStart', 'info', { kind: 'machine', id: m.id }, `${m.id}: Rüsten für ${o.id} AG ${r.seq} gestartet (${sn(p.name)}, geplant ${r.setupMin} min) – ${setupWhat(m, r, mt)}`, { orderId: o.id, seq: r.seq, by: p.id });
  }
  function onSetupDone(m) {
    const run = m.setupRun; m.setupRun = null;
    const c = curOf(m); if (!c || !run) return;
    planChanged();
    m.setupDone = true; m.released = !c.r.firstPiece;
    ev('setupDone', 'ok', { kind: 'machine', id: m.id }, `${m.id}: Rüsten ${c.o.id} AG ${c.r.seq} abgeschlossen (${U.fmtDur(S.t - run.t0)})${c.r.firstPiece ? ' – nächstes Teil ist Erstteil' : ''}`, { orderId: c.o.id, seq: c.r.seq });
    planTools(m);
  }
  function fpiCause(m) {
    const f = m.fpi, tk = S.tasks[m.tasks.fpi];
    if (f.local) {
      if (f.stage === 'measure') return `${pname(f.by)} prüft das erste Teil nach dem Werkzeugwechsel an der Maschine (${U.fmtDur(CFG.fpiLocalSec)})`;
      return tk && tk.assignee ? `Erstes Teil nach Werkzeugwechsel – ${pname(tk.assignee)} kommt zur Kontrolle` : `Erstes Teil nach Werkzeugwechsel wartet auf Kontrolle (${availability(tk).text})`;
    }
    if (f.stage === 'wait') return tk && tk.assignee ? `Erstteil wartet – ${pname(tk.assignee)} holt es ab` : `Erstteil wartet auf QS (${availability(tk).text})`;
    if (f.stage === 'carry') return `${pname(f.by)} bringt das Erstteil in den Messraum`;
    if (f.stage === 'hold') { const q = S.machines.QS; return `Erstteil wartet im Messraum – Messmaschine gestört${q && q.fault ? ' (' + q.fault.code + ' ' + q.fault.text + ')' : ''}`; }
    return `Erstteil wird im Messraum gemessen (${pname(f.by)}, ${m.fpiMin || 15} min)`;
  }
  function fpiResult(m, p) {
    const f = m.fpi; m.fpi = null;
    const c = curOf(m); if (!c || !f) return;
    const { o, i, r, op } = c;
    const ch = charOf(m, r);
    const ok = f.measOk && R.chance(P.sim.fpiPassProb != null ? P.sim.fpiPassProb : 0.94);
    op.fpiCount++; planChanged();
    resolveKey('fpi:' + m.id, 'Erstteil geprüft');
    if (!ok && f.measOk) {
      // Nebenmerkmal n.i.O., Material noch vorhanden → Korrektur, Erstteil wird nachgearbeitet und erneut geprüft
      m.needCorr = true; m.rework = true; S.today.fpiNok++;
      ev('fpiNok', 'warn', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} n.i.O. (Nebenmerkmal Rauheit/Lage) – Korrektur durch Einrichter:in (10 min), Teil wird nachgearbeitet und erneut geprüft`, { orderId: o.id, seq: r.seq, value: f.value, rework: true });
      return;
    }
    op.inProc--;
    if (ok) {
      op.good++; countGood(m, 1, o, i); addToOutput(m, o, i, 1);
      m.released = true; S.today.fpiOk++;
      GDIRTY = true; ev('fpiOk', 'ok', { kind: 'machine', id: m.id }, `${m.id}: ${f.local ? 'erstes Teil nach Werkzeugwechsel' : 'Erstteil'} ${o.id} AG ${r.seq} i.O. (${ch.name} ${fmtVal(f.value, ch)} ${ch.unit}) – Serie freigegeben durch ${sn(p.name)}`, { orderId: o.id, seq: r.seq, value: f.value, local: !!f.local });
    } else {
      op.scrap++; S.today.fpiNok++;
      scrapParts(o, i, 1, 'Erstteil n.i.O.', m, `${ch.name} ${fmtVal(f.value, ch)} ${ch.unit} außerhalb ${fmtVal(ch.nominal + ch.tolMinus, ch)} … ${fmtVal(ch.nominal + ch.tolPlus, ch)}`);
      if (i > 0 && partsLeft(o, i) === 0 && op.inProc === 0) {
        // kein Teil mehr da, an dem korrigiert und neu geprüft werden könnte → Fehlmenge offen ansprechen
        // Fehlmenge meldet qtyRiskNotify (Meldung „Menge gefährdet“ mit Nachfertigungs-Aktion) beim Buchen des Ausschusses
        ev('fpiNok', 'warn', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} n.i.O. (Maß außer Toleranz, Ausschuss) – letztes Teil dieses Arbeitsgangs, Nachfertigung erforderlich`, { orderId: o.id, seq: r.seq, value: f.value, last: true });
      } else {
        m.needCorr = true;
        ev('fpiNok', 'warn', { kind: 'machine', id: m.id }, `${m.id}: Erstteil ${o.id} AG ${r.seq} n.i.O. (Maß außer Toleranz, Ausschuss) – Korrektur durch Einrichter:in (10 min), danach neues Erstteil`, { orderId: o.id, seq: r.seq, value: f.value });
      }
    }
    checkOpComplete(o, i);
  }

  // ------------------------------------------------------------------ Maschinen: Störungen
  function faultCatalog(m) {
    const f = P.faults || {};
    let list;
    if (m.type === 'washer' || m.type === 'cmm' || m.type === 'assembly') list = (f[m.type] || EXTRA_FAULTS[m.type] || []).slice();
    else {
      const noBreak = m.type === 'cylgrinder' || m.type === 'surfgrinder' || m.type === 'saw';
      list = (f.generic || []).filter(x => !(x.toolBreak && noBreak)).concat(f[m.automation] || [], f[m.type] || []);
    }
    return list.length ? list : EXTRA_FAULTS.cmm;
  }
  /** Werkzeugbruch ist nur möglich, während tatsächlich geschnitten wird (Teil in Bearbeitung, Werkzeug im Eingriff) */
  const cuttingNow = (m) => !!(m.op && m.part && m.part.sub === 'cut' && m.part.oid === m.op.oid && m.part.idx === m.op.idx);
  function startFault(m, code, manual) {
    const list = faultCatalog(m), cutting = cuttingNow(m);
    let f = null;
    if (code) f = list.find(x => x.code === code) || null;
    if (!f) { const pool = cutting ? list : list.filter(x => !x.toolBreak); f = R.pick(pool.length ? pool : list); }
    const rm = f.repairMin || [10, 20];
    const brk = !!f.toolBreak && cutting;
    GDIRTY = true;
    m.fault = { code: f.code, text: f.text, cause: f.cause, t0: S.t, repairSec: Math.round(R.range(rm[0], rm[1]) * 60), repairMin: rm, toolBreak: brk, repairBy: null, manual: !!manual, partScrapped: false, toolId: null, toolName: null };
    S.today.faults++;
    if (brk) {
      const c = curOf(m);
      const cand = m.tools.map(id => S.tools[id]).filter(tl => cutFor(c.r, tl.typeId) > 0);
      // Bruch: Werkzeug ist unbrauchbar (remainingParts = 0); der gebuchte Verschleiß bleibt ehrlich stehen
      if (cand.length) { const tl = R.pick(cand); tl.broken = true; tl.brokenT = S.t; m.fault.toolId = tl.id; m.fault.toolName = tl.name; m.tv++; }
      c.op.inProc--; c.op.scrap++; scrapParts(c.o, c.i, 1, 'Werkzeugbruch', m, f.code + ' ' + f.text); m.part = null; m.fault.partScrapped = true;
      m.kd.idealPre = 0; m.ks.idealPre = 0;
    }
    const lt = S.tasks[m.tasks.load]; if (lt && !lt.workStarted) cancelTask(lt, 'Störung');
    ensureMTask(m, 'repair');
    setState(m, 'fault', `${f.code} ${f.text}`, 'fault');
    planChanged();
    ev('fault', 'crit', { kind: 'machine', id: m.id }, `${m.id} ${m.short}: Störung ${f.code} „${f.text}“${manual ? ' (Demo ausgelöst)' : ''}${m.fault.partScrapped ? ' – laufendes Teil Ausschuss' : ''}${m.fault.toolName ? ', Werkzeug ' + m.fault.toolName + ' gebrochen' : ''}`, { code: f.code, toolBreak: brk, toolId: m.fault.toolId, partScrapped: m.fault.partScrapped });
    const partTxt = m.fault.partScrapped ? `Teil Ausschuss, ${m.fault.toolName || 'Werkzeug'} wird getauscht` : m.part ? 'laufendes Teil angehalten' : 'Maschine steht';
    notify({ key: 'fault:' + m.id, sev: 'crit', role: 'Instandhaltung', entity: { kind: 'machine', id: m.id },
      title: `Störung ${m.id} ${m.short}: ${f.text}`,
      body: `Alarm ${f.code} seit ${U.fmtClock(S.t)} · ${partTxt} · Reparatur ca. ${rm[0]}–${rm[1]} min`,
      suggestion: brief(f.cause, repairerHint(true)),
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
  }
  function repairerHint(short) {
    const on = Object.values(S.people).filter(p => p.onDuty && !p.endShift && (p.skills.includes('repair') || (p.skills.includes('setup') && !p.skills.includes('lead'))));
    if (!on.length) return short ? (cur ? 'Rufbereitschaft verständigen' : `Rufbereitschaft verständigen oder bis ${tclock(nextWorkStart(S.t + 1))} warten`)
      : `Aktuell ist niemand aus Instandhaltung/Einrichtung verfügbar – ${cur ? 'Rufbereitschaft verständigen' : 'bis Schichtbeginn ' + tclock(nextWorkStart(S.t + 1)) + ' warten oder Rufbereitschaft verständigen'}.`;
    const r = on.find(p => p.skills.includes('repair')) || on[0];
    return short ? `${sn(r.name)} (${r.role}) übernimmt die Reparatur` : `${sn(r.name)} (${r.role}) wird automatisch zugeteilt, sobald verfügbar.`;
  }
  /** Zustand sofort neu bestimmen (z. B. nach Demo-Reparatur) – gleiche Reihenfolge wie machineTick, ohne Teilefortschritt */
  function resumeState(m) {
    if (m.fault || m.toolchange || m.setupRun || m.corrRun) return;
    if (m.part) return setState(m, 'running', (m.part.sub === 'load' ? m.part.loadLabel : m.part.label) + ' – fortgesetzt nach Störung');
    if (m.dressRem > 0) return setState(m, 'running', 'Abrichten der Schleifscheibe (automatischer Zyklus)');
    if (m.fpi) return fpiHold(m) ? holdIdle(m, 'Erstteilprüfung') : setState(m, 'firstPiece', fpiCause(m));
    decide(m, 0);
  }
  function endFault(m, by) {
    GDIRTY = true;
    const f = m.fault; if (!f) return;
    m.fault = null;
    const rt = S.tasks[m.tasks.repair]; if (rt && !by) finishTask(rt, 'cancelled');
    ev('repair', 'ok', { kind: 'machine', id: m.id }, `${m.id}: Störung ${f.code} behoben${by ? ' durch ' + pname(by) : ' (Demo-Aktion)'} – Stillstand ${U.fmtDur(S.t - f.t0)}${f.toolId ? '; gebrochenes Werkzeug (' + (f.toolName || '') + ') wird jetzt gewechselt' : ''}`, { code: f.code, by: by || null, downSec: S.t - f.t0 });
    resolveKey('fault:' + m.id, 'Störung behoben');
    planChanged();
    planTools(m);
  }

  // ------------------------------------------------------------------ Maschinen: Personalbedarf
  function waitOp(m, key, what) {
    const tk = S.tasks[m.tasks[key]];
    if (offShiftHold(m) && !(tk && tk.assignee)) return holdIdle(m, what);
    m.waitWhat = what;
    // Ursache höchstens alle 5 s neu formulieren (gleiche Aufgabe, gleiche Person, gleicher Schritt)
    const wk = key + '|' + what + '|' + (tk ? tk.id + (tk.assignee || '') + tk.si : '');
    if (m.state === 'waitOperator' && m.woK === wk && S.t - m.woT < 5) return setState(m, 'waitOperator', m.cause, m.waitCode);
    m.woK = wk; m.woT = S.t;
    let cause, code;
    if (tk && tk.assignee) {
      const p = S.people[tk.assignee];
      const eta = p.route ? Math.round(routeLeft(p) / WALK) : 0;
      cause = `${what}: ${sn(p.name)} ist unterwegs${eta > 5 ? ' (ca. ' + U.fmtDur(eta) + ')' : ''}`; code = 'walking';
    } else { const a = cz(m, 'av:' + key + (tk ? tk.id : ''), () => availability(tk)); cause = `${what} – ${a.text}`; code = a.code; }
    m.waitCode = code;
    return setState(m, 'waitOperator', cause, code);
  }
  /** Warum ist (noch) niemand da? – offShift | break | busy | assigning */
  function availability(tk) {
    if (!tk) return { code: 'none', text: 'keine Aufgabe' };
    if (tk.lateWhy && S.t - (tk.lateT || 0) <= 2) return { code: 'tooLate', text: tk.lateWhy };
    let onDuty = 0, inBreak = 0, breakTo = Infinity; const busy = [];
    for (let j = 0; j < PA.length; j++) {
      const p = PA[j];
      if (!p.onDuty || p.endShift || eligible(p, tk) < 0) continue;
      onDuty++;
      if (p.state === 'break' || (p.breakPending && !p.task)) { inBreak++; if (p.breakUntil) breakTo = Math.min(breakTo, p.breakUntil); continue; }
      if (p.task) busy.push(sn(p.name) + ': ' + p.task.label);
    }
    if (!onDuty) return { code: 'offShift', text: `keine qualifizierte Person verfügbar (nächste Schicht ${tclock(nextWorkStart(S.t + 1))})` };
    if (inBreak && !busy.length) { const be = cur && cur.breakEnd ? cur.breakEnd : isFinite(breakTo) ? breakTo : null; return { code: 'break', text: be ? `Pause bis ${U.fmtClock(be)}` : 'Pause' }; }
    if (busy.length) return { code: 'busy', text: 'qualifizierte Personen beschäftigt (' + busy.slice(0, 2).join('; ') + ')' };
    return { code: 'assigning', text: 'Person wird zugeteilt' };
  }
  function presentFor(m, key) {
    const tk = S.tasks[m.tasks[key]];
    return tk && tk.assignee && tk.ready ? S.people[tk.assignee] : null;
  }
  function techReady(m) { const tk = S.tasks[m.tasks.tc]; return !!(tk && tk.assignee && tk.ready); }
  /** Anwesende Person muss an der Teilegrenze gehen (Pause, Schichtende, dringendere Aufgabe) */
  function mustLeave(p) {
    if (p.breakPending || p.endShift) return true;
    const myPrio = p.task ? p.task.prio : 0;
    for (const id in S.tasks) { const tk = S.tasks[id]; if (tk.status === 'open' && tk.prio > myPrio && eligible(p, tk) >= 0) return true; }
    return false;
  }
  function releaseAttendant(m) {
    const tk = S.tasks[m.tasks.attend];
    if (tk && !(m.part && m.part.by === tk.assignee)) finishTask(tk, 'done');
  }
  function dropWaiters(m) {
    const tk = S.tasks[m.tasks.load];
    if (tk && !tk.workStarted) cancelTask(tk, 'nicht mehr nötig');
    releaseAttendant(m);
  }

  // ------------------------------------------------------------------ Werkzeuge (§3.4 – die eine, sichtbare Regel)
  //   Verschleiß = used / life, steigt nur am Teilende, nie > 100 %.
  //   remainingParts = floor((life − used) / cutMinPerPart). Läuft gerade ein Teil, gilt für Planung und Anzeige der
  //   Stand „nach diesem Teil“ (remA = remainingParts − 1): Ein Werkzeug, das an der nächsten Teilegrenze gewechselt
  //   wird, steht deshalb immer mindestens ein Teil vorher als „geplant“ in der Maschinenansicht.
  //   Wechselgrenze je Werkzeug: changeAt = min(planAtParts, ⌊10 % · Standzeit / cutMinPerPart⌋) Teile – es bleiben höchstens
  //   ca. 10 % der Standzeit ungenutzt (lange Schnitte wie BTA-Kopf/Wälzfräser: Wechsel erst, wenn kein Teil mehr geht).
  //   Geplant (Meldung, Einrichter:in holt Werkzeug) wird bei remA ≤ Vorlauf H = max(planAtParts, Holzeit / Taktzeit),
  //   gewechselt an einer Teilegrenze mit remA ≤ changeAt; angesteuert wird die letzte Teilegrenze vor dem Stopp.
  //   Kein Wechsel, wenn die Reststandzeit für den Rest des Arbeitsgangs reicht – das wäre sinnlos.
  //   Mitwechseln: Wird ohnehin gewechselt, kommen Werkzeuge mit, deren eigener Wechsel in ≤ 30 min käme und die nur noch
  //   ≤ 25 % Standzeit haben (zweiter Stopp vermieden). Sie stehen vorher als „geplant · wird mitgewechselt“ in der Ansicht.
  //   Gewechselt wird nur an einer Teilegrenze mit Einrichter:in vor Ort; remainingParts = 0 → waitTool.
  function cutFor(r, typeId) { for (const t of r.tools || []) if (t.type === typeId) return t.cutMinPerPart; return 0; }
  function remParts(tl, cut) { if (tl.broken) return 0; if (!(cut > 0)) return Infinity; return Math.max(0, Math.floor((tl.life - tl.used) / cut + 1e-9)); }
  function mountedOf(m, typeId) { for (const id of m.tools) { const tl = S.tools[id]; if (tl.typeId === typeId) return tl; } return null; }
  /** Wechselgrenze in Teilen (Reststandzeit, ab der an einer Teilegrenze gewechselt wird) */
  function changeLimit(tl, cut) { return tl && cut > 0 ? Math.max(0, Math.min(PLAN_AT, Math.floor(CFG.changeFrac * tl.life / cut + 1e-9))) : 0; }
  /** Wechselgrenze als Verschleiß-% (ab hier gilt remainingParts ≤ changeAt) – für die UI */
  function planWearPct(tl, cut, at) {
    if (!(cut > 0)) return null;
    const a = at != null ? at : changeLimit(tl, cut);
    return Math.max(0, Math.min(100, Math.round((tl.life - (a + 1) * cut) / tl.life * 1000) / 10));
  }
  const wearOf = (tl) => Math.round(tl.used / tl.life * 1000) / 10;
  /** Wendeschneidplatte mit unbenutzter Schneide: der nächste Wechsel ist ein Wenden an der Maschine */
  const canIndex = (tl) => !!(tl && tl.kind === 'insert' && !tl.broken && (tl.edges || 1) > (tl.edge || 1));
  const edgeTxt = (tl) => (tl && (tl.edges || 1) > 1 ? `Schneide ${tl.edge}/${tl.edges}` : null);
  function mountTool(m, typeId, used, fromStock, edge) {
    const tt = TT[typeId];
    if (!tt) return null;
    if (fromStock !== false) { const st = S.toolStock[typeId]; if (st && st.ready > 0) st.ready--; }
    const tl = { id: U.uid('WZ'), typeId, name: tt.name, kind: tt.kind, machineId: m.id, used: Math.min(tt.lifeMin, used || 0), life: tt.lifeMin,
      mountedT: S.t, parts: 0, sinceDress: 0, broken: false, state: 'mounted', plannedT: null, edge: edge || 1, edges: tt.kind === 'insert' ? (tt.edges || 1) : 1 };
    S.tools[tl.id] = tl; m.tools.push(tl.id); m.tv++;
    return tl;
  }
  /** Werkzeug ausbauen → Werkzeugausgabe (gebraucht) / Nachschliff / Schrott (Kosten) */
  function dismountTool(m, tl, reason, index) {
    const k = m.tools.indexOf(tl.id); if (k >= 0) m.tools.splice(k, 1);
    m.tv++;
    const tt = TT[tl.typeId], st = S.toolStock[tl.typeId], w = tl.used / tl.life;
    const E = tl.edges || 1, e = tl.edge || 1, perEdge = tt.cost / E;   // Wendeplatten: Kosten je verbrauchter Schneide
    let disp, cost = 0;
    if (index) { disp = `Schneide ${e}/${E} verbraucht – Platte gewendet, weiter mit Schneide ${e + 1}/${E}`; cost = Math.round(perEdge * 10) / 10; tl.state = 'indexed'; }
    else if (tl.broken) { disp = 'verschrottet (Bruch)'; cost = Math.round(perEdge * (E - e + 1) * 10) / 10; st.scrapToday++; tl.state = 'scrap'; }
    // beim Rüsten ausgebautes, wenig verschlissenes Werkzeug: gebraucht zurück (Verschleiß bleibt am Werkzeug vermerkt,
    // zum Rüsten werden laut Regel neue, vermessene Werkzeuge genommen)
    else if (reason === 'Rüsten' && w < 0.5) { disp = `zurück in die Werkzeugausgabe (gebraucht, ${nm(w * 100, 0)} % Verschleiß${E > 1 ? ', ' + edgeTxt(tl) : ''})`; st.usedStock = (st.usedStock || 0) + 1; tl.state = 'stock-used'; }
    else if (reason === 'Rüsten' && E > e) { disp = `zurück in die Werkzeugausgabe (noch ${E - e} ${E - e === 1 ? 'Schneide' : 'Schneiden'} frei)`; cost = Math.round(perEdge * 10) / 10; st.usedStock = (st.usedStock || 0) + 1; tl.state = 'stock-used'; }
    else if (tt.kind === 'insert' || tt.kind === 'saw' || tt.kind === 'wheel') { disp = E > 1 ? `verschrottet (alle ${E} Schneiden verbraucht)` : 'verschrottet'; cost = Math.round(perEdge * 10) / 10; st.scrapToday++; tl.state = 'scrap'; }
    else { disp = 'zum Nachschliff'; cost = Math.round(tt.cost * 0.25); st.regrind++; tl.state = 'regrind'; }
    S.toolCostToday += cost;
    tl.machineId = null; tl.dismountT = S.t; tl.reason = reason; tl.cost = cost; tl.disposal = disp; tl.lastMachine = m.id; tl.plannedT = null;
    (S.toolLog || (S.toolLog = [])).push(tl.id);
    while (S.toolLog.length > CFG.toolsKeep) delete S.tools[S.toolLog.shift()];
    return disp;
  }
  const keptAtSetup = (tl) => (tl.kind === 'saw' || tl.kind === 'wheel' || tl.kind === 'hob') && !tl.broken;
  /** Rüsten: alle Werkzeuge des Arbeitsgangs neu (vermessen); Sägeband/Schleifscheibe/Wälzfräser gleichen Typs bleiben montiert */
  function mountForOp(m, o, i) {
    const r = o.routing[i];
    const need = new Set((r.tools || []).map(t => t.type)), res = { fresh: [], kept: [] };
    for (const tid of m.tools.slice()) {
      const tl = S.tools[tid];
      const keep = need.has(tl.typeId) && (tl.kind === 'saw' || tl.kind === 'wheel' || tl.kind === 'hob') && !tl.broken;
      if (keep) { need.delete(tl.typeId); res.kept.push(tl.name); continue; }
      dismountTool(m, tl, 'Rüsten');
    }
    for (const typeId of need) { mountTool(m, typeId, 0, true); res.fresh.push(TT[typeId].name); }
    return res;
  }
  /** Was beim Rüsten passiert – nur Arbeitsgänge mit Werkzeugen bekommen „neue vermessene Werkzeuge“ */
  const SETUP_NOTOOL = { washer: ['stellt das Reinigungsprogramm ein', 'Reinigungsprogramm und Waschkorb eingestellt'], cmm: ['lädt den Prüfplan', 'Prüfplan und Spannvorrichtung geladen'],
    assembly: ['bereitet den Montageplatz vor', 'Montageplatz und Vorrichtung vorbereitet'] };
  function setupWhat(m, r, mt) {
    if ((r.tools || []).length) {
      if (mt && mt.fresh.length) return `neue vermessene Werkzeuge: ${mt.fresh.join(', ')}${mt.kept.length ? '; bleibt montiert: ' + mt.kept.join(', ') : ''}`;
      return `Werkzeuge bleiben montiert (${mt && mt.kept.length ? mt.kept.join(', ') : 'gleicher Typ'})`;
    }
    return (SETUP_NOTOOL[m.type] || ['richtet ein', 'Spannmittel und Programm eingerichtet'])[1];
  }
  /** Planungsvorlauf in Teilen: mind. planAtParts, bei kurzen Taktzeiten so viele Teile, wie das Holen des
      Werkzeugs dauert (sonst käme die Einrichter:in nie rechtzeitig). Gewechselt wird erst an der Wechselgrenze. */
  function leadSec() { const tp = P.sim.toolPolicy || {}; return (tp.fetchMin || 3) * 60 + 150; }
  /** Werkzeugtypen, die beim nächsten Wechsel getauscht werden (Wechselfenster, geplant, mitgewechselt, manuell) */
  function changeTypes(m, c, tc) {
    tc = tc || toolCheck(m, c.o, c.i);
    const tk = S.tasks[m.tasks.tc], set = new Set();
    for (const x of tc.planned) set.add(x.spec.type);
    for (const x of tc.bundle) set.add(x.spec.type);
    if (m.manualTC) for (const t of m.manualTC.types) set.add(t);
    return [...set];
  }
  /** nächster Wechsel ist reines Schneide-Wenden (alle geplanten/beauftragten Werkzeuge sind Wendeplatten mit freier Schneide) */
  function indexOnlyTypes(m, c, tc) {
    tc = tc || toolCheck(m, c.o, c.i);
    const set = new Set();
    for (const x of tc.planned) set.add(x.spec.type);
    if (m.manualTC) for (const t of m.manualTC.types) set.add(t);
    if (!set.size) return false;
    for (const t of set) if (!canIndex(mountedOf(m, t))) return false;
    return true;
  }
  /** vorbeugender (manueller) Wechsel jetzt fällig? („nicht vor“-Zeit berücksichtigt) */
  function manualDue(m) { const mt = m.manualTC; return !!(mt && mt.types.length && (!mt.notBefore || S.t >= mt.notBefore - 600)); }
  /** Vorlauf für einen konkreten Wechsel: Werkzeug liegt schon an der Maschine → nur der Weg; leere Werkzeugausgabe → + Voreinstellen */
  function leadSecFor(m, tk) {
    if (tk && tk.data && tk.data.fetched) return CFG.indexLeadSec;
    const c = curOf(m);
    if (!tk && c && indexOnlyTypes(m, c)) return CFG.indexLeadSec;
    let extra = 0;
    if (c) for (const t of changeTypes(m, c)) { const st = S.toolStock[t]; if (st && st.ready <= 0) extra = Math.max(extra, (TT[t].presetMin || 3) * 60); }
    return leadSec() + extra;
  }
  /** Restdauer einer Störung (läuft die Reparatur: Restarbeitszeit, sonst geschätzte Dauer + Anfahrt) */
  function faultRemSec(m) {
    if (!m.fault) return 0;
    const rt = S.tasks[m.tasks.repair], rp = rt && rt.assignee ? S.people[rt.assignee] : null;
    return rp && rt.workStarted && rp.workRem > 0 ? rp.workRem : m.fault.repairSec + 300;
  }
  /** nächste Teilegrenze (laufendes Teil, Abrichten, Störung) */
  function boundaryT(m) { return S.t + faultRemSec(m) + (m.part ? m.part.rem : 0) + m.dressRem; }
  function planHorizon(m, r) { return Math.max(PLAN_AT, Math.ceil(leadSec() / Math.max(1, cycleSec(m, r)))); }
  /** Werkzeugzustand des Arbeitsgangs. Je Werkzeug: rem (jetzt), remA (nach dem laufenden Teil), at (Wechselgrenze),
      need (reicht nicht für den Rest des Arbeitsgangs), bundleOk (würde bei einem Wechsel mitgewechselt).
      change = Wechselfenster an der nächsten Teilegrenze erreicht, planned = Wechsel geplant, short = Standzeit 0. */
  function toolCheck(m, o, i) {
    const run = m.part && m.part.oid === o.id && m.part.idx === i ? 1 : 0;
    const plA = partsLeft(o, i) + (m.rework ? 1 : 0);   // nach dem laufenden Teil noch zu startende Teile (inkl. Nacharbeit)
    // Ergebnis zwischenspeichern, solange sich Werkzeuge (Version m.tv), Teilezahl und laufendes Teil nicht ändern
    const mm = m.tcM;
    if (mm && mm.oid === o.id && mm.i === i && mm.pl === plA && mm.run === run && mm.tv === m.tv) return mm.res;
    const res = toolCheck0(m, o, i, run, plA);
    m.tcM = { oid: o.id, i, pl: plA, run, tv: m.tv, res };
    return res;
  }
  function toolCheck0(m, o, i, run, plA) {
    const r = o.routing[i];
    const H = planHorizon(m, r), cyc = cycleSec(m, r);
    const res = { change: [], short: [], planned: [], bundle: [], items: [], pl: plA + run, plAfter: plA, horizon: H, run, cyc };
    for (const spec of r.tools || []) {
      const tl = mountedOf(m, spec.type), cut = spec.cutMinPerPart;
      const rem = tl ? remParts(tl, cut) : 0;
      const remA = Math.max(0, rem - run);
      const at = tl && !tl.broken ? changeLimit(tl, cut) : 0;
      const need = plA > remA;
      const wasteEur = tl ? Math.round(TT[spec.type].cost / (tl.edges || 1) * Math.min(1, remA * cut / tl.life) * 10) / 10 : 0, stopEur = stopEurOf(m, spec.type, canIndex(tl));
      const bundleOk = need && !!tl && !tl.broken && Math.max(0, remA - at) * cyc <= CFG.bundleSec && remA * cut <= CFG.bundleFrac * tl.life && wasteEur <= stopEur;
      const x = { spec, tl, rem, remA, at, need, bundleOk, wasteEur, stopEur };
      res.items.push(x);
      if (res.pl > 0 && rem < 1) res.short.push(x);
      if (!need) continue;
      if (remA <= at) res.change.push(x);
      if (remA <= H) res.planned.push(x);
      if (bundleOk && remA > at) res.bundle.push(x);
    }
    return res;
  }
  /** Kosten eines zusätzlichen Wechselstopps (Maschinenstundensatz × mittlere Wechseldauer) – Maßstab fürs Mitwechseln */
  function stopEurOf(m, typeId, index) {
    const c = m.stopEurC || (m.stopEurC = {}), key = index ? typeId + '#i' : typeId;
    if (c[key] != null) return c[key];
    const kind = TT[typeId].kind, tp = P.sim.toolPolicy || {};
    const cm = index ? CFG.indexMin : kind === 'insert' && tp.changeMin ? tp.changeMin : (CFG.changeMinByKind[kind] || [4, 7]);
    return (c[key] = Math.round(m.rate * (cm[0] + cm[1]) / 2 / 60 * 10) / 10);
  }
  /** Zeitpunkt einer Teilegrenze k (0 = Ende des laufenden Teils bzw. jetzt) – Einlege-Maschinen nur in der Arbeitszeit */
  function boundaryBase(m, o, i) {
    if (m.part || m.fault || m.dressRem > 0) return { t: boundaryT(m), note: null };
    if (m.state === 'starved') {
      // Materialeingang: höchstens alle 30 s neu schätzen (arrivalEta durchsucht alle Behälter)
      if (!m.bbC || m.bbC.k !== o.id + i || S.t - m.bbC.t >= 30) m.bbC = { k: o.id + i, t: S.t, e: arrivalEta(o, i) };
      const e = m.bbC.e;
      return e != null ? { t: Math.max(S.t, e), get note() { return `abhängig vom nächsten Materialeingang (ca. ${tclock(e)})`; } } : { t: null, note: 'abhängig vom nächsten Materialeingang (noch nicht absehbar)' };
    }
    if (m.state === 'blocked') return { t: null, note: 'Maschine steht – Ausgangspuffer voll' };
    return { t: S.t, note: null };
  }
  /** Wechselfenster des nächsten Wechsels: L = Werkzeug, das zuerst stoppt; kOpen = erste erlaubte Teilegrenze,
      kStop = Teilegrenze ohne Reststandzeit (Maschine müsste stehen), kTarget = angesteuerte Teilegrenze */
  function changeWindow(m, o, i, tc) {
    const tk = S.tasks[m.tasks.tc];
    const manual = m.manualTC ? m.manualTC.types.filter(t => tc.items.some(x => x.spec.type === t && x.tl)) : [];
    if (!tc.planned.length && !manual.length) return null;
    let L = null;
    for (const x of tc.planned) if (!L || x.remA < L.remA || (x.remA === L.remA && x.at < L.at)) L = x;
    let kOpen = 0, kStop = 1e6, kTarget = 0;
    if (L) {
      kOpen = Infinity; for (const x of tc.planned) kOpen = Math.min(kOpen, Math.max(0, x.remA - x.at));
      kStop = L.remA; kTarget = Math.max(kOpen, kStop - Math.min(1, L.at));
    }
    const b0 = boundaryBase(m, o, i), cyc = tc.cyc;
    const bt = (k) => b0.t == null ? null : k <= 0 ? b0.t : m.loading === 'auto' ? b0.t + k * cyc : addWork(b0.t, k * cyc);
    if (manual.length) { // vorbeugender Wechsel: an der nächsten Teilegrenze bzw. erst ab „nicht vor“ (z. B. kurz vor Schichtende)
      let kNB = 0;
      const nb = m.manualTC.notBefore;
      if (nb && b0.t != null) { let g = 0; while (bt(kNB) < nb - 1 && g++ < 20000) kNB++; }
      if (L) { kOpen = Math.min(kOpen, kNB); kTarget = Math.min(kTarget, kNB); } else { kOpen = kNB; kTarget = kNB; }
    }
    return { L, kOpen, kStop, kTarget, manual, b0, bt, tk };
  }
  /** frühester Zeitpunkt ≥ t, an dem Personal der Schicht sid noch dur Sekunden arbeiten kann (ohne Pause/Schichtende) */
  function nextShiftWork(sid, t, dur) {
    const sh = SH.find(x => x.id === sid); if (!sh) return Infinity;
    let d = Math.floor(t / DAY);
    for (let g = 0; g < 10; g++, d++) {
      if (((d % 7) + 7) % 7 >= 5) continue;
      for (const [a, b] of sh.wins) { const A = Math.max(d * DAY + a, t); if (A + (dur || 0) <= d * DAY + b) return A; }
    }
    return Infinity;
  }
  const shiftName = (sid) => (SH.find(s => s.id === sid) || {}).name || sid;
  /** Wann kann frühestens jemand mit Werkzeugwechsel-Qualifikation an Maschine m arbeiten? */
  function staffT(m, t, dur) {
    const probe = { type: 'toolChange', machineId: m.id };
    let best = Infinity, sid = null;
    const seen = {};
    for (let j = 0; j < PA.length; j++) {
      const p = PA[j];
      if (seen[p.shift] || eligible(p, probe) < 0) continue;
      seen[p.shift] = 1;
      const w = nextShiftWork(p.shift, t, dur);
      if (w < best) { best = w; sid = p.shift; }
    }
    if (!isFinite(best) || best <= t + 120) return { t: isFinite(best) ? best : t, note: null, reason: null, win: null };
    // Grund der Lücke: Pause derselben Schicht, Schichtwechsel (Übergabe) oder Nacht/Wochenende (Geisterschicht)
    const ci = shiftInfo(t);
    let reason = 'night', win = null;
    if (ci && ci.sh.id === sid && best < ci.end) {
      reason = 'break';
      const d0 = Math.floor(best / DAY) * DAY, b = ci.sh.breaks.find(x => d0 + x[1] === best);
      win = b ? [d0 + b[0], d0 + b[1]] : null;
    } else if (ci && best - ci.end < 1800 && Math.floor(best / DAY) === ci.day) reason = 'handover';
    const note = reason === 'break' ? `frühestens ${tclock(best)} (${shiftName(sid)}, nach der Pause)` : `frühestens ${tclock(best)} (${shiftName(sid)})`;
    return { t: best, note, reason, win };
  }
  /** Prognose des nächsten Wechsels: Teilegrenze, Uhrzeit, Werkzeuge (Gruppe inkl. Mitwechseln) und spätere Wechsel */
  function nextChange(m, o, i, tc) {
    tc = tc || toolCheck(m, o, i);
    const w = changeWindow(m, o, i, tc);
    if (!w) return null;
    const op = o.ops[i], tk = w.tk;
    const processed = op.good + op.scrap + op.inProc;
    // Ankunft der Einrichter:in mit dem Werkzeug
    let A, by = null, stage, staffNote = null, staffReason = null, staffWin = null, staffAt = null;
    if (tk && tk.ready) { A = S.t; by = tk.assignee; stage = 'an der Maschine'; }
    else if (tk && tk.assignee) {
      const p = S.people[tk.assignee]; by = p.id;
      const walkBack = tk.data.fetched ? 0 : pathLen(ST.CRIB ? ST.CRIB.dockNode : p.node, m.id) / WALK + 20;
      A = S.t + (p.workRem || 0) + (p.route ? routeLeft(p) / WALK : 0) + walkBack;
      stage = tk.data.index ? 'unterwegs zur Maschine' : tk.data.fetched ? 'unterwegs mit Werkzeug' : 'holt Werkzeug';
    } else {
      const lead = leadSecFor(m, tk);
      const tT = w.bt(w.kTarget);
      const st = staffT(m, Math.max(S.t, tT != null ? tT - lead - 120 : S.t), lead);
      A = st.t + lead; staffNote = st.note; staffReason = st.reason; staffWin = st.win; staffAt = st.t;
      stage = (tk && tk.data.fetched) || m.toolStaged ? 'Werkzeug liegt bereit' : 'offen';
    }
    let k = w.kOpen, etaT = null, waitFromT = null, waiting = false;
    if (w.b0.t != null) {
      let guard = 0;
      while (k < w.kStop && w.bt(k) < A - 1 && guard++ < 20000) k++;
      if (k >= w.kStop) { k = w.kStop; const ts = w.bt(k); if (A > ts + 1) { waitFromT = ts; etaT = Math.round(A); } else etaT = Math.round(ts); }
      else etaT = Math.round(w.bt(k));
      // Maschine wartet bereits auf genau diesen Wechsel (Standzeit 0): Stopp liegt in der Vergangenheit – seit m.since,
      // nie auf „jetzt“ geklemmt
      if (k === 0 && m.state === 'waitTool' && tc.short.length) { waiting = true; waitFromT = m.since; etaT = Math.round(Math.max(A, S.t)); }
    } else k = w.kTarget;
    // Gruppe: alle geplanten Werkzeuge, deren Wechselfenster bei k offen ist, + Mitwechseln + (fällige) manuell beauftragte
    const group = [], later = [];
    const nb = m.manualTC && m.manualTC.notBefore;
    const manDue = w.manual.length > 0 && (!nb || (etaT != null && etaT >= nb - 600));
    for (const x of tc.items) {
      if (!x.tl) continue;
      const inWin = x.need && Math.max(0, x.remA - x.at) <= k;
      const man = manDue && w.manual.includes(x.spec.type);
      if (inWin || man || x.bundleOk) group.push(Object.assign({}, x, { manual: man, bundled: !inWin && !man && x.bundleOk }));
      else if (tc.planned.includes(x)) {
        const kk = Math.max(Math.max(0, x.remA - x.at), x.remA - Math.min(1, x.at));
        const tt = w.bt(kk);
        later.push(Object.assign({}, x, { afterPart: processed + kk, etaT: tt != null ? Math.round(tt) : null }));
      }
    }
    // reines Schneide-Wenden: Mitwechseln nur für Platten, die ebenfalls gewendet werden können (kein Gang zur Werkzeugausgabe)
    const core = group.filter(x => !x.bundled);
    const action = core.length && core.every(x => canIndex(x.tl)) ? 'index' : 'replace';
    if (action === 'index') for (let q = group.length - 1; q >= 0; q--) if (group[q].bundled && !canIndex(group[q].tl)) group.splice(q, 1);
    return { action, afterPart: processed + k, k, etaT, waitFromT, waiting, A: Math.round(A), by, stage, staffNote, staffReason, staffWin, staffAt, bt: w.bt, baseNote: w.b0.note, group, later,
      leader: w.L ? w.L.spec.type : null, kStop: w.kStop, manual: w.manual };
  }
  /** frühester Zeitpunkt, an dem gewechselt werden darf (erste Teilegrenze im Wechselfenster) */
  function earliestChangeT(m) {
    const c = curOf(m); if (!c) return S.t;
    const tc = toolCheck(m, c.o, c.i), w = changeWindow(m, c.o, c.i, tc);
    if (!w) return boundaryT(m);
    const t = w.bt(w.kOpen);
    return t == null ? S.t + 3600 : t;
  }
  /** Ziel-Teilegrenze für das Losschicken: die letzte vor dem Stopp (bzw. mit einem Teil Reserve), die mit dem Vorlauf
      noch erreichbar ist. Unbekannte Teilegrenze (Ausgang voll / Material fehlt): noch nicht losschicken. */
  function changeTargetT(m, lead) {
    const c = curOf(m); if (!c) return S.t;
    const tc = toolCheck(m, c.o, c.i), w = changeWindow(m, c.o, c.i, tc);
    if (!w) return boundaryT(m);
    if (w.b0.t == null) return S.t + lead + 720;
    let k = w.kTarget, guard = 0;
    while (k < w.kStop && w.bt(k) < S.t + lead && guard++ < 20000) k++;
    return w.bt(Math.min(k, w.kStop));
  }
  function changeWhen(nc) {
    if (!nc) return '';
    if (nc.etaT == null) return `nach Teil ${nc.afterPart} · Zeitpunkt ${nc.baseNote || 'offen'}`;
    if (nc.waiting) return `nach Teil ${nc.afterPart} · ${nc.staffNote || 'ca. ' + tclock(Math.max(nc.etaT, S.t))} – Maschine steht seit ${tclock(nc.waitFromT)} (Wartet auf Werkzeug)`;
    if (nc.waitFromT != null) return `nach Teil ${nc.afterPart} · ${nc.staffNote || 'ca. ' + tclock(Math.max(nc.etaT, S.t))} – Maschine steht ab ca. ${tclock(nc.waitFromT)} (Wartet auf Werkzeug)`;
    return `nach Teil ${nc.afterPart} · ca. ${tclock(Math.max(nc.etaT, S.t))}${nc.staffNote ? ' (' + nc.staffNote + ')' : ''}`;
  }
  /** Werkzeugwechsel planen (an Teilegrenzen und beim Teilestart aufgerufen) */
  function planTools(m) {
    if (!m.op || !m.setupDone || m.toolchange) return;
    const o = S.orders[m.op.oid], i = m.op.idx, r = o.routing[i];
    const tc = toolCheck(m, o, i);
    let tk = S.tasks[m.tasks.tc];
    if (tk && !tk.workStarted && staleTask(tk, m)) { cancelTask(tk, staleTask(tk, m)); tk = null; }
    const manual = !!m.manualTC;
    if (!tc.planned.length && !manual) {
      if (tk && !tk.workStarted) cancelTask(tk, 'kein Wechsel nötig');
      if (!S.tasks[m.tasks.tc] && hasOpen('tool:' + m.id)) resolveKey('tool:' + m.id, 'kein Wechsel mehr nötig');
      for (const x of tc.items) if (x.tl) x.tl.plannedT = null;
      return;
    }
    if (tc.planned.length || manual) { const t2 = ensureToolTask(m, tc.short.length > 0); if (manual) t2.prio = Math.max(t2.prio, PRIO.setup); }
    const nc = nextChange(m, o, i, tc);
    if (!nc) return;
    const inGroup = new Set(nc.group.map(x => x.tl.id)), inLater = new Set(nc.later.map(x => x.tl.id));
    for (const x of tc.items) {
      if (!x.tl) continue;
      if (!inGroup.has(x.tl.id) && !inLater.has(x.tl.id)) { x.tl.plannedT = null; continue; }
      if (x.tl.plannedT) continue;
      x.tl.plannedT = S.t;
      const g = nc.group.find(y => y.tl === x.tl), l = g ? null : nc.later.find(y => y.tl === x.tl);
      const when = g ? changeWhen(nc) : `nach Teil ${l.afterPart}${l.etaT != null ? ' · ca. ' + tclock(l.etaT) : ''}`;
      const why = x.tl.broken ? 'gebrochen, Wechsel erforderlich' : g && g.bundled ? `noch ${teile(x.rem)} – wird beim nächsten Wechsel mitgewechselt (eigener Wechsel käme in ca. ${U.fmtDur(Math.max(0, x.remA - x.at) * tc.cyc)}; Rest der Schneide ca. ${U.fmtEur(x.wasteEur, 0)} < zweiter Stopp ca. ${U.fmtEur(x.stopEur, 0)})` : g && g.manual ? `noch ${teile(x.rem)} – vorbeugender Wechsel beauftragt` : `noch ${teile(x.rem)} Reststandzeit (Wechselgrenze ${teile(x.at)}${tc.horizon > x.at ? ', Vorlauf ' + tc.horizon + ' Teile für das Holen des Werkzeugs' : ''})`;
      const idx = canIndex(x.tl);
      ev('toolPlanned', 'info', { kind: 'machine', id: m.id }, `${m.id}: ${idx ? 'Schneide wenden geplant' : 'Werkzeugwechsel geplant'} – ${TT[x.spec.type].name}${edgeTxt(x.tl) ? ' (' + edgeTxt(x.tl) + (idx ? '' : ', letzte Schneide – neue Platte') + ')' : ''}: ${why}; Wechsel ${when}; ${tc.pl} Teile offen`,
        { typeId: x.spec.type, toolId: x.tl.id, rem: x.rem, remAfterPart: x.remA, changeAt: x.at, wearPct: wearOf(x.tl), bundled: !!(g && g.bundled), manual: !!(g && g.manual), afterPart: g ? nc.afterPart : null, etaT: g ? nc.etaT : null,
          action: idx ? 'index' : 'replace', edge: x.tl.edge || 1, edges: x.tl.edges || 1 });
    }
    // Meldung nur neu formulieren, wenn sich Inhalt oder Zeitpunkt (Minute) geändert hat
    const sig = nc.action + nc.group.map(x => x.spec.type + x.rem + (x.bundled ? 'b' : '') + (x.manual ? 'm' : '')).join() + '|' + nc.afterPart + '|' + Math.round((nc.etaT || 0) / 60) + '|' + (nc.waitFromT || 0) + (nc.waiting ? 'w' : '') + '|' + (nc.staffNote || '') + '|' + nc.later.map(x => x.spec.type + x.afterPart).join() + (cur ? '' : '|n');
    if (m.toolSig === sig && hasOpen('tool:' + m.id)) return;
    m.toolSig = sig;
    const types = [...new Set(nc.group.map(x => x.spec.type).concat(nc.later.map(x => x.spec.type)))];
    // Bestand kompakt: nur nennen, was fehlt bzw. knapp ist
    const lowT = types.filter(t => !(S.toolStock[t] && S.toolStock[t].ready > 0));
    const stockTxt = lowT.length ? `${lowT.map(toolShort).join(', ')} nicht vorrätig` : types.length === 1 ? `${S.toolStock[types[0]].ready} Stk vorrätig` : 'vorrätig';
    const idxAll = nc.action === 'index';
    // kompakt: Body eine Zeile (Werkzeuge · wann · Auftrag), Empfehlung „Ursache: … Empfehlung: …“;
    // nachts nur 'info' – die Warnung trägt der Geisterschicht-Check bzw. die Warte-Meldung beim Stopp
    const verb = idxAll ? 'wenden' : 'wechseln', minRem = Math.min(...nc.group.map(x => x.rem));
    const gNames = nc.group.map(x => toolShort(x.spec.type) + (x.tl && x.tl.broken ? ' gebrochen' : edgeTxt(x.tl) ? ' (' + edgeTxt(x.tl) + ')' : '')).join(', ');
    const whenTxt = nc.etaT == null ? `nach Teil ${nc.afterPart}` : `nach Teil ${nc.afterPart} ca. ${tclock(Math.max(nc.etaT, S.t))}`;
    const stopTxt = nc.waitFromT != null ? ` · steht ${nc.waiting ? 'seit' : 'ab ca.'} ${tclock(nc.waitFromT)}` : '';
    const laterTxt = nc.later.length ? ` · danach ${toolShort(nc.later[0].spec.type)} nach Teil ${nc.later[0].afterPart}` : '';
    const cNames = nc.group.length > 1 ? nc.group.map(x => toolShort(x.spec.type)).join(', ') : gNames;
    const cause0 = nc.group.some(x => x.tl && x.tl.broken) ? `${gNames}` : minRem < 1 ? `${cNames} verschlissen` : `${cNames}: noch ${teile(minRem)} Reststandzeit`;
    const gE = S.ghostCheck && S.ghostCheck.machines[m.id], ghostCov = !!(gE && ghostStop(gE) && nc.staffReason === 'night' && hasOpen('ghost:check'));
    notify({ key: 'tool:' + m.id, sev: nc.waitFromT != null && cur && !ghostCov ? 'warn' : 'info', role: idxAll ? 'Schichtleitung' : 'Einrichter', entity: { kind: 'machine', id: m.id },
      title: `${idxAll ? 'Schneide wenden' : 'Werkzeugwechsel'} geplant – ${m.id} ${m.short}`,
      body: `${gNames} → ${verb} ${whenTxt}${stopTxt} · ${o.id} AG ${r.seq}${laterTxt}`,
      suggestion: nc.waitFromT != null && nc.staffNote ? staffAdvice(m, nc, stockTxt)
        : idxAll ? brief(cause0, `Bediener wendet an der Teilegrenze ${nc.etaT != null ? 'ca. ' + tclock(Math.max(nc.etaT, S.t)) : ''} (${CFG.indexMin[0]}–${CFG.indexMin[1]} min, kein Gang zur Werkzeugausgabe)`.replace('  ', ' '))
        : brief(cause0, `vermessenes Werkzeug holen (Bestand ${stockTxt}) und an der Teilegrenze ${nc.etaT != null ? 'ca. ' + tclock(Math.max(nc.etaT, S.t)) + ' ' : ''}wechseln`),
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
  }
  /** Empfehlung, wenn bis zum Stopp niemand wechseln kann – nach Grund: Pause, Schichtwechsel, Nacht/Geisterschicht.
      Kompakt „Ursache: … Empfehlung: …“ (≤ ca. 180 Zeichen). */
  function staffAdvice(m, nc, stockTxt) {
    const next = nc.staffAt != null ? nc.staffAt : nc.etaT, stopT = nc.waitFromT;
    const hh = (t) => U.fmtClock(t);
    const idx = nc.action === 'index', verb = idx ? 'wenden' : 'wechseln';
    const names = nc.group.map(x => toolShort(x.spec.type)).join(', ');
    const stock = idx ? '' : ` (Bestand ${stockTxt})`;
    if (nc.staffReason === 'break' && nc.staffWin) {
      // letzte Teilegrenze vor Pausenbeginn, die mit dem Holen des Werkzeugs noch erreichbar ist
      let pre = null;
      if (nc.bt && S.t < nc.staffWin[0]) for (let k = 0; k <= nc.kStop && k < 2000; k++) { const t = nc.bt(k); if (t == null || t > nc.staffWin[0] - 120) break; if (t >= S.t + leadSec()) pre = t; }
      return brief(`Pause ${hh(nc.staffWin[0])}–${hh(nc.staffWin[1])}, niemand mit Wechsel-Qualifikation frei – ${m.id} stünde ab ca. ${tclock(stopT)}`,
        `${pre != null ? 'vor der Pause ' + verb + ' (Teilegrenze ca. ' + hh(pre) + ')' : 'direkt nach der Pause ' + hh(nc.staffWin[1]) + ' als Erstes ' + verb} oder Pausenablösung einplanen${stock}`);
    }
    if (nc.staffReason === 'handover' && cur) return brief(`Schichtwechsel ${hh(cur.end)}, nächste Schicht ab ca. ${tclock(next)} – ${m.id} stünde ab ca. ${tclock(stopT)}`, `vor Schichtende vorbeugend ${verb} oder bei der Übergabe als Erstes ansagen${stock}`);
    const standSec = Math.max(0, next - stopT);   // gesamter Stillstand (stabil, solange sich der Plan nicht ändert)
    if (cur && S.t < cur.end) return brief(`nach ${hh(cur.end)} niemand bis ${tclock(next)} – ${m.id} stünde ab ca. ${tclock(stopT)} rund ${U.fmtDur(standSec)}`, `vor Schichtende vorbeugend ${verb} (siehe Geisterschicht-Check)`);
    return brief(`${names} verschlissen, niemand im Haus bis ${tclock(next)}`, `${tclock(next)} als Erstes ${verb}${idx ? ' (1–2 min)' : ''}; künftig vor Schichtende vorbeugend ${verb}`);
  }
  function ensureToolTask(m, urgent) {
    let tk = S.tasks[m.tasks.tc];
    if (tk && !tk.workStarted && staleTask(tk, m)) { cancelTask(tk, staleTask(tk, m)); tk = null; }
    const c = curOf(m);
    const idxOnly = !!(c && indexOnlyTypes(m, c));
    // Art des Wechsels hat sich geändert (letzte Schneide → neue Platte nötig bzw. nur noch Wenden): Aufgabe neu anlegen
    if (tk && !tk.workStarted && !tk.assignee && !!tk.data.index !== idxOnly) { cancelTask(tk, idxOnly ? 'nur Schneide wenden – kein Gang zur Werkzeugausgabe' : 'letzte Schneide – neue Platte aus der Werkzeugausgabe nötig'); tk = null; }
    if (!tk) {
      const tp = P.sim.toolPolicy || {};
      // liegt das vermessene Werkzeug schon an der Maschine bereit (zurückgestellter Wechsel), entfällt der Weg zur Werkzeugausgabe
      const need = c ? changeTypes(m, c) : [];
      const staged = !idxOnly && !!(m.toolStaged && need.length && need.every(t => m.toolStaged.includes(t)));
      tk = newTask('toolChange', m, c, idxOnly
        ? [W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Schneide wenden)`), K(90, 'tc', `Wendet Schneide an ${m.id}`)]
        : staged
        ? [W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Werkzeugwechsel)`), K(240, 'tc', `Wechselt Werkzeug an ${m.id}`)]
        : [W('CRIB'), K((tp.fetchMin || 3) * 60, 'fetch', `Holt vermessenes Werkzeug für ${m.id} in der Werkzeugausgabe`),
          W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Werkzeugwechsel)`), K(240, 'tc', `Wechselt Werkzeug an ${m.id}`)]);
      if (idxOnly) { tk.data.fetched = true; tk.data.index = true; tk.data.note = 'Schneide wenden an der Maschine (Wendeplatte)'; tk.label = `Schneide wenden ${mLabel(m.id)}${c ? ' · ' + c.o.id : ''}`; }
      else if (staged) { tk.data.fetched = true; tk.data.note = 'Vermessenes Werkzeug liegt an der Maschine bereit'; }
      m.tasks.tc = tk.id; tk.mkey = 'tc';
    }
    if (urgent && tk.prio < PRIO.toolChangeWait) { tk.prio = PRIO.toolChangeWait; tk.label = `${tk.data.index ? 'Schneide wenden' : 'Werkzeugwechsel'} ${mLabel(m.id)} (Maschine wartet)`; }
    return tk;
  }
  /** Wechseldauer je Werkzeugart (Wälzfräser inkl. Rundlaufprüfung, Schleifscheibe inkl. Auswuchten und Abrichten) */
  function changeSecOf(list) {
    const tp = P.sim.toolPolicy || {}, byKind = CFG.changeMinByKind;
    let max = 0, rest = 0;
    for (const x of list) {
      const kind = TT[x.spec.type].kind, cm = x.action === 'index' ? CFG.indexMin : kind === 'insert' && tp.changeMin ? tp.changeMin : (byKind[kind] || [4, 7]);
      const s = R.range(cm[0], cm[1]) * 60;
      if (s > max) { rest += max; max = s; } else rest += s;
    }
    return Math.round(max + 0.35 * rest);
  }
  function changeReason(x) {
    if (x.tl && x.tl.broken) return 'Werkzeugbruch';
    if (x.rem < 1) return x.at === 0 && x.why === 'rule' ? 'Standzeit ausgenutzt – Wechsel an der letzten möglichen Teilegrenze (Wechselgrenze 0 Teile)' : 'Standzeit erschöpft';
    if (x.why === 'manual') return `vorbeugender Wechsel, manuell beauftragt (noch ${teile(x.rem)})`;
    if (x.why === 'bundle') return `mitgewechselt (noch ${teile(x.rem)}, Rest der Schneide ca. ${U.fmtEur(x.wasteEur, 0)} < zweiter Stopp ca. ${U.fmtEur(x.stopEur, 0)})`;
    return `Reststandzeit ${teile(x.rem)} ≤ Wechselgrenze ${x.at}`;
  }
  /** Werkzeuge des Wechsels an dieser Teilegrenze: Regel, beauftragt, mitgewechselt – je mit Aktion (Schneide wenden / tauschen).
      Beim reinen Schneide-Wenden (Bediener ohne neues Werkzeug) werden nur wendbare Platten mitgewechselt. */
  function changeList(m, tc, indexTask) {
    const list = [];
    const add = (x, why) => { if (x.tl && !list.some(y => y.spec.type === x.spec.type)) list.push(Object.assign({}, x, { why, action: canIndex(x.tl) ? 'index' : 'replace' })); };
    for (const x of tc.change) add(x, 'rule');
    if (manualDue(m)) for (const typeId of m.manualTC.types) { const x = tc.items.find(y => y.spec.type === typeId); if (x) add(x, 'manual'); }
    for (const x of tc.items) if (x.bundleOk && (!indexTask || canIndex(x.tl))) add(x, 'bundle');
    return list;
  }
  function startToolChange(m, o, i, tc) {
    const tk = S.tasks[m.tasks.tc], p = S.people[tk.assignee];
    const list = changeList(m, tc, !!tk.data.index);
    // jedes Werkzeug ist vor dem Wechsel angekündigt (Ereignis toolPlanned) – auch wenn es erst an dieser Teilegrenze dazukommt
    for (const x of list) if (!x.tl.plannedT) {
      x.tl.plannedT = S.t;
      ev('toolPlanned', 'info', { kind: 'machine', id: m.id }, `${m.id}: ${TT[x.spec.type].name} wird beim ${x.action === 'index' ? 'Wenden' : 'Wechsel'} mitgenommen – ${changeReason(x)}`, { typeId: x.spec.type, toolId: x.tl.id, rem: x.rem, changeAt: x.at, wearPct: wearOf(x.tl), bundled: x.why === 'bundle', manual: x.why === 'manual', action: x.action });
    }
    const sec = changeSecOf(list);
    const brk = list.some(x => x.tl.broken), ex = list.some(x => x.rem < 1), allIdx = list.every(x => x.action === 'index');
    const verb = allIdx ? 'wendet die Schneide' : list.some(x => x.action === 'index') ? 'wechselt/wendet' : 'wechselt';
    m.toolchange = { taskId: tk.id, by: p.id, t0: S.t, dur: sec, manual: list.some(x => x.why === 'manual'), index: allIdx,
      list: list.map(x => ({ type: x.spec.type, toolId: x.tl.id, rem: x.rem, why: x.why, at: x.at, reason: changeReason(x), action: x.action, edge: x.tl.edge || 1, edges: x.tl.edges || 1 })),
      cause: `${sn(p.name)} ${verb} ${list.map(x => TT[x.spec.type].name + (x.action === 'index' ? ' (' + edgeTxt(x.tl) + ' → ' + ((x.tl.edge || 1) + 1) + '/' + x.tl.edges + ')' : '')).join(', ')} (${brk ? 'Werkzeugbruch' : ex ? changeReason(list.find(x => x.rem < 1)) : list.every(x => x.why === 'manual') ? 'vorbeugend, manuell beauftragt' : changeReason(list.find(x => x.why === 'rule') || list[0])}${list.some(x => x.why === 'bundle') ? '; mitgewechselt: ' + list.filter(x => x.why === 'bundle').map(x => TT[x.spec.type].name).join(', ') : ''}, ca. ${U.fmtDur(sec)})` };
    tk.steps[tk.si + 1].sec = sec;
    if (hasOpen('tool:' + m.id)) { const n = NIDX['tool:' + m.id]; n.body = `${allIdx ? 'Schneide wenden' : 'Werkzeugwechsel'} läuft seit ${U.fmtClock(S.t)}: ${list.map(x => toolShort(x.spec.type)).join(', ')} · ${o.id} AG ${o.routing[i].seq}`; n.sev = 'info'; n.suggestion = brief(`${allIdx ? 'Wenden' : 'Wechsel'} läuft (${sn(p.name)}, ca. ${U.fmtDur(sec)})`, 'nichts zu tun – die Serie läuft an der Teilegrenze weiter'); n.updatedT = S.t; WF.bus.emit('sim:notify', n); }
    advanceTask(p);
  }
  function onToolChanged(m) {
    const t = m.toolchange; m.toolchange = null; m.toolStaged = null;
    if (!t) return;
    const c = curOf(m);
    const main = c ? mainToolOf(m, c.r) : null;
    const changed = [];
    let form = false;
    for (const x of t.list) {
      const old = x.toolId ? S.tools[x.toolId] : null;
      const reason = x.reason || (old && old.broken ? 'Werkzeugbruch' : 'Wechsel');
      const wearPct = old ? wearOf(old) : null;
      // Wendeplatte mit freier Schneide: Bediener wendet an der Maschine (Platte bleibt, nächste Schneide neu) – sonst neues Werkzeug
      const index = x.action === 'index' && canIndex(old);
      const e0 = old ? old.edge || 1 : 1, E = old ? old.edges || 1 : 1;
      const disp = old ? dismountTool(m, old, reason, index) : 'neu bestückt';
      const nt = index ? mountTool(m, x.type, 0, false, e0 + 1) : mountTool(m, x.type, 0, true, 1);
      if (index) S.today.edgeIndexes = (S.today.edgeIndexes || 0) + 1;
      if (TT[x.type].kind === 'hob' || TT[x.type].kind === 'wheel') form = true;
      if (c && main && old && old.id === main.id) { // neues Hauptwerkzeug → Korrekturwert und SPC-Trend zurücksetzen
        c.op.offset = 0; const key = c.o.id + '/' + c.r.seq; S.spcSince[key] = S.t;
        if (hasOpen('spc:' + key)) resolveKey('spc:' + key, 'neues Werkzeug – Trend zurückgesetzt');
      }
      changed.push({ typeId: x.type, name: TT[x.type].name, oldToolId: old ? old.id : null, newToolId: nt.id, wearPct, rem: x.rem, reason, disposal: disp, bundled: x.why === 'bundle', manual: x.why === 'manual',
        action: index ? 'index' : 'replace', edgeFrom: index ? e0 : null, edgeTo: index ? e0 + 1 : null, edges: E });
    }
    // Formwerkzeug (Wälzfräser, Schleifscheibe) bestimmt die Geometrie → erstes Teil danach ist ein Erstteil
    // vorbeugender Auftrag ist erledigt, wenn er fällig war („nicht vor“ erreicht) – ein früherer Regelwechsel ersetzt ihn nicht
    if (m.manualTC && (!m.manualTC.notBefore || t.t0 >= m.manualTC.notBefore - 600)) { m.manualTC.types = m.manualTC.types.filter(ty => !t.list.some(x => x.type === ty)); if (!m.manualTC.types.length) m.manualTC = null; }
    const fpiAfter = form && c && c.r.firstPiece && partsLeft(c.o, c.i) > 0;
    if (fpiAfter) { m.released = false; m.fpiLocalNext = true; }
    S.today.toolChanges += changed.length;
    const cause = [...new Set(changed.map(x => x.reason))].join('; ');
    const allIdx = changed.every(x => x.action === 'index');
    ev('toolChanged', 'info', { kind: 'machine', id: m.id },
      `${m.id}: ${allIdx ? 'Schneide gewendet' : 'Werkzeug gewechselt'} durch ${pname(t.by)} – ` + changed.map(x => x.action === 'index'
        ? `${x.name} (Schneide ${x.edgeFrom}/${x.edges} → ${x.edgeTo}/${x.edges}; ${x.reason}; Verschleiß ${x.wearPct != null ? nm(x.wearPct, 0) + ' %' : '–'})`
        : `${x.name} (${x.reason}; Verschleiß ${x.wearPct != null ? nm(x.wearPct, 0) + ' %' : '–'} → ${x.disposal})`).join('; ') + (fpiAfter ? ' – neues Formwerkzeug: erstes Teil wird an der Maschine kontrolliert, bevor die Serie weiterläuft' : ''),
      { tools: changed, cause, toolBreak: changed.some(x => x.reason === 'Werkzeugbruch'), manual: !!t.manual, partProgress: 0, by: t.by, durSec: S.t - t.t0, firstPieceAfter: !!fpiAfter, index: allIdx });
    resolveKey('tool:' + m.id, allIdx ? 'Schneide gewendet' : 'Werkzeug gewechselt');
    planChanged();
    GDIRTY = true;
  }
  function toolWaitCause(m, tc) {
    const x = tc.short[0];
    const tk = S.tasks[m.tasks.tc];
    const name = TT[x.spec.type].name;
    const why = x.tl && x.tl.broken ? 'nach Werkzeugbruch' : `Reststandzeit ${x.tl ? nm(x.tl.life - x.tl.used, 1) : 0} min < ${nm(x.spec.cutMinPerPart, 1)} min je Teil`;
    let who;
    if (tk && tk.assignee) { const p = S.people[tk.assignee]; who = tk.data.index ? `${sn(p.name)} kommt zum Schneide-Wenden` : tk.data.fetched || (tk.steps[tk.si] && tk.steps[tk.si].to !== 'CRIB') ? `${sn(p.name)} kommt mit dem Werkzeug` : `${sn(p.name)} holt das Werkzeug`; }
    else if (tk && tk.held && tk.holdWhy) who = tk.holdWhy;
    else who = availability(tk).text;
    return `${name}${x.tl && edgeTxt(x.tl) ? ' (' + edgeTxt(x.tl) + ')' : ''}: ${why} – ${canIndex(x.tl) ? 'Schneide wenden: ' : ''}${who}`;
  }
  /** Wendeplatten: welcher Wechsel als Nächstes kommt – Schneide wenden (an der Maschine) oder Werkzeug tauschen (neue Platte) */
  function edgeAct(tl) {
    if (!tl || tl.kind !== 'insert' || (tl.edges || 1) <= 1 || tl.broken) return '';
    return canIndex(tl) ? ` Wendeplatte ${edgeTxt(tl)}: nächster Wechsel = Schneide wenden (→ ${tl.edge + 1}/${tl.edges}) durch den Bediener an der Maschine, ca. ${CFG.indexMin[0]}–${CFG.indexMin[1]} min.`
      : ` Wendeplatte ${edgeTxt(tl)} (letzte Schneide): nächster Wechsel = Werkzeug tauschen – neue Platte aus der Werkzeugausgabe.`;
  }
  /** Erklärtext der Werkzeugregel für die UI (x aus toolCheck, nc = nextChange) */
  function toolExplain(m, x, nc, o, i, tc) {
    const tl = x.tl, cut = x.spec.cutMinPerPart;
    const tk = S.tasks[m.tasks.tc];
    const after = (tc.run ? ` Nach dem laufenden Teil: ${nm(Math.min(100, (tl.used + cut) / tl.life * 100), 0)} % Verschleiß, noch ${teile(x.remA)}.` : '') + edgeAct(tl);
    const verb = canIndex(tl) ? 'Schneide wenden' : 'Wechsel';
    if (!m.setupDone) return m.setupRun ? `Beim Rüsten eingesetzt (${tl.mountedT >= m.setupRun.t0 ? 'neu vermessen' : 'bleibt montiert, ' + nm(wearOf(tl), 0) + ' % Verschleiß'}) – noch ${teile(x.rem)}.`
      : keptAtSetup(tl) ? `Bleibt beim Rüsten montiert (${LABELS.toolKind[tl.kind]} gleichen Typs, ${nm(wearOf(tl), 0)} % Verschleiß, noch ${teile(x.rem)}).`
      : 'Wird beim Rüsten durch ein neues, vermessenes Werkzeug ersetzt.';
    if (tl.broken) return 'Werkzeugbruch – Wechsel erforderlich, bevor das nächste Teil startet.';
    if (x.rem < 1) return `Standzeit${edgeTxt(tl) ? ' der ' + edgeTxt(tl) : ''} erschöpft (${nm(tl.life - tl.used, 1)} min Rest < ${nm(cut, 1)} min je Teil) – es wird nicht weitergeschnitten, ${canIndex(tl) ? 'Schneide wenden' : 'Werkzeug tauschen'} ${tk && tk.assignee ? 'läuft' : 'angefordert'}.${edgeAct(tl)}`;
    const g = nc && nc.group.find(y => y.tl === tl);
    if (g && g.manual) return `Vorbeugender Wechsel beauftragt (${m.manualTC && m.manualTC.reason ? m.manualTC.reason + ', ' : 'manuell, '}${tclock(m.manualTC ? m.manualTC.t : S.t)}) – erfolgt ${changeWhen(nc)}, obwohl noch ${teile(x.remA)} möglich wären.`;
    if (!x.need) return `Reststandzeit reicht für die restlichen ${tc.plAfter + tc.run} Teile dieses Arbeitsgangs (noch ${teile(x.rem)} möglich) – kein Wechsel nötig.${edgeTxt(tl) ? ' Wendeplatte ' + edgeTxt(tl) + '.' : ''}`;
    if (g && g.bundled) {
      const lead = nc.group.filter(y => !y.bundled).map(y => TT[y.spec.type].name).join(', ') || 'anderem Werkzeug';
      return `Wird beim ${nc.action === 'index' ? 'Schneide-Wenden' : 'Wechsel'} von ${lead} ${changeWhen(nc)} mit${canIndex(tl) ? 'gewendet' : 'gewechselt'}: noch ${teile(x.remA)}, der eigene Wechsel käme in ca. ${U.fmtDur(Math.max(0, x.remA - x.at) * tc.cyc)}; der Rest der Schneide (ca. ${U.fmtEur(x.wasteEur, 0)}) kostet weniger als ein zweiter Stopp (ca. ${U.fmtEur(x.stopEur, 0)}).${after}`;
    }
    const mo = m.manualTC && m.manualTC.types.includes(x.spec.type) && !(g && g.manual) && m.manualTC.notBefore ? ` Zusätzlich beauftragt: vorbeugender Wechsel ab ca. ${tclock(m.manualTC.notBefore)}${m.manualTC.reason ? ' (' + m.manualTC.reason + ')' : ''}.` : '';
    const lim = `Wechselgrenze ≤ ${teile(x.at)} Reststandzeit (ab ca. ${nm(planWearPct(tl, cut, x.at), 0)} % Verschleiß)${mo ? '.' + mo.replace(/\.$/, '') : ''}`;
    if (g) return `${verb} geplant ${changeWhen(nc)} – ${lim}.${after}`;
    const l = nc && nc.later.find(y => y.tl === tl);
    if (l) return `${verb} geplant nach Teil ${l.afterPart}${l.etaT != null ? ' · ca. ' + tclock(Math.max(l.etaT, S.t)) : ''} – ${lim}.${after}`;
    const H = tc.horizon, inN = Math.max(1, x.remA - H);
    return `${verb} wird in ca. ${inN} ${inN === 1 ? "Teil" : "Teilen"} geplant (Vorlauf ${H} Teile${canIndex(tl) ? '' : ' zum Holen des Werkzeugs'}) – ${lim}.${after}`;
  }

  // ------------------------------------------------------------------ Personen & Aufgaben (§3.5)
  // Aufgabe = Schrittfolge: walk (zu Fuß), drive (Stapler), toForklift, work (Dauer, Aktion), wait (an der
  // Maschine bereitstehen – Maschine setzt fort), attend (anwesend während Bearbeitung, Maschine beendet).
  const W = (to, at) => ({ k: 'walk', to, at: at || 'work' });
  const K = (sec, act, label) => ({ k: 'work', sec, act, label });
  const WAIT = (label) => ({ k: 'wait', label });
  const ATT = (label) => ({ k: 'attend', label });
  const DRV = (to, at) => ({ k: 'drive', to, at: at || 'work' });
  const FORKW = () => ({ k: 'toForklift' });

  function newTask(type, m, c, steps, extra) {
    const mid = typeof m === 'string' ? m : m.id;
    const isM = !!S.machines[mid];
    const tk = { id: U.uid('AU'), type, prio: PRIO[type] || 10, target: { kind: isM ? 'machine' : 'station', id: mid }, machineId: isM ? mid : null,
      orderId: c ? c.o.id : null, seq: c ? c.r.seq : null, label: `${TASK_LABEL[type] || type} ${mLabel(mid)}${c ? ' · ' + c.o.id : ''}`,
      status: 'open', assignee: null, createdT: S.t, steps, si: 0, ready: false, workStarted: false, data: {}, mkey: null, transportId: null };
    if (extra) Object.assign(tk, extra);
    S.tasks[tk.id] = tk;
    return tk;
  }
  /** Maschinenbezogene Aufgabe anlegen, falls noch nicht vorhanden */
  /** Aufgabe gehört nicht (mehr) zum aktuellen Arbeitsgang der Maschine? → Grund, sonst null */
  function staleTask(tk, m) {
    if (!tk || !m || tk.orderId == null) return null;
    if (!m.op) return 'kein Arbeitsgang mehr eingeplant';
    const o = S.orders[m.op.oid], r = o.routing[m.op.idx];
    return tk.orderId !== o.id || tk.seq !== r.seq ? `Arbeitsgang gewechselt (jetzt ${o.id} AG ${r.seq})` : null;
  }
  function ensureMTask(m, key) {
    let ex = m.tasks[key] && S.tasks[m.tasks[key]];
    if (ex && key !== 'attend' && key !== 'repair' && staleTask(ex, m) && !ex.workStarted) { cancelTask(ex, staleTask(ex, m)); ex = null; }
    if (ex) return ex;
    const c = curOf(m);
    if (!c && key !== 'repair') return null;
    let tk = null;
    switch (key) {
      case 'setup': tk = newTask('setup', m, c, [W(m.id), K((c.r.setupMin || 0) * 60, 'setup', `Rüstet ${m.id} für ${c.o.id} AG ${c.r.seq}`)]); break;
      case 'corr': tk = newTask('correction', m, c, [W(m.id), K(CFG.correctionSec, 'corr', `Korrigiert ${m.id} nach Erstteil n.i.O.`)]); break;
      case 'load': tk = newTask('load', m, c, [W(m.id), WAIT(`Steht an ${m.id} bereit (Zyklusende)`), K(loadSecOf(m, c.r), 'load', `Legt Teil in ${m.id} ein (${c.o.id})`)]); break;
      case 'attend': tk = newTask(m.kind === 'assembly' ? 'assembly' : 'inspect', m, c, [W(m.id), ATT(m.kind === 'assembly' ? `Montiert ${c.o.id} (${c.r.op})` : `Prüft ${c.o.id} AG ${c.r.seq} (${c.r.op})`)]); break;
      case 'fpi':
        if (m.fpi && m.fpi.local) { tk = newTask('fpi', m, c, [W(m.id), K(CFG.fpiLocalSec, 'fpiMeasure', `Prüft erstes Teil nach Werkzeugwechsel an ${m.id} (${c.o.id})`)]); tk.data.local = true; tk.label = `Kontrolle erstes Teil ${mLabel(m.id)} · ${c.o.id}`; }
        else tk = newTask('fpi', m, c, [W(m.id), K(CFG.fpiPickSec, 'fpiPick', `Entnimmt Erstteil an ${m.id}`), W('QS'), { k: 'hold', cond: 'cmm', label: `Wartet am KMG – Messmaschine gestört (Erstteil ${m.id})` }, K((m.fpiMin || 15) * 60, 'fpiMeasure', `Erstteilprüfung ${m.id} für ${c.o.id} am KMG`)]);
        break;
      case 'repair': tk = newTask('repair', m, c, [W(m.id), K(m.fault.repairSec, 'repair', `Repariert ${m.id}: ${m.fault.text}`)]); break;
    }
    if (!tk) return null;
    m.tasks[key] = tk.id; tk.mkey = key;
    return tk;
  }
  function cancelTask(tk, why) { tk.cancelReason = why; finishTask(tk, 'cancelled'); }

  /** Qualifikation: −1 = nicht geeignet, sonst Zuschlag (Meter) für die Auswahl */
  function eligible(p, tk) {
    const m = tk.machineId ? S.machines[tk.machineId] : null, sk = p.skills;
    switch (tk.type) {
      case 'setup': case 'correction': case 'offset': return m && sk.includes(m.skill) && (sk.includes('setup') || p.machines.includes(m.id)) ? 0 : -1;
      case 'load': if (!m || !sk.includes(m.skill)) return -1; return p.machines.includes(m.id) ? 0 : sk.includes('setup') ? 80 : 40;
      case 'toolChange':
        if (tk.data && tk.data.index) { if (m && p.machines.includes(m.id) && sk.includes(m.skill)) return 0; return sk.includes('toolchange') ? (sk.includes('lead') ? 50 : 20) : -1; } // Schneide wenden: Bediener der Maschine
        if (sk.includes('toolchange')) return sk.includes('lead') ? 40 : 0; return m && p.machines.includes(m.id) && sk.includes(m.skill) ? 25 : -1;
      case 'fpi': if (tk.data && tk.data.local) return sk.includes('qs') ? 30 : m && sk.includes(m.skill) && (p.machines.includes(m.id) || sk.includes('setup')) ? 0 : -1; return sk.includes('qs') ? 0 : -1;
      case 'inspect': return sk.includes('qs') ? 0 : -1;
      case 'assembly': return sk.includes('assembly') ? 0 : -1;
      case 'repair': return sk.includes('repair') ? 0 : sk.includes('setup') && !sk.includes('lead') ? 60 : -1; // Instandhaltung, sonst Einrichter:in – nicht die Schichtleitung
      case 'forklift': case 'bars': { const f = S.forklift; if (f.reservedBy && f.reservedBy !== p.id) return -1; return sk.includes('forklift') ? 0 : -1; }
    }
    return -1;
  }
  function isFree(p) {
    return p.onDuty && !p.task && !p.endShift && !p.breakPending && p.state !== 'break' && p.state !== 'offShift' && p.goal !== 'break' && p.goal !== 'exit';
  }
  function firstTarget(tk) { for (let k = tk.si; k < tk.steps.length; k++) if (tk.steps[k].to) return tk.steps[k].to; return tk.target.id; }
  function assignTasks() {
    let open = null;
    for (const id in S.tasks) { const tk = S.tasks[id]; if (tk.status === 'open') (open || (open = [])).push(tk); }
    if (!open) return;
    let free = null;
    for (let j = 0; j < PA.length; j++) { const p = PA[j]; if (isFree(p)) (free || (free = [])).push(p); }
    if (!free) return;
    open.sort((a, b) => b.prio - a.prio || a.createdT - b.createdT || (a.id < b.id ? -1 : 1));
    for (const tk of open) {
      if (taskHeld(tk)) continue;
      let best = null, bc = Infinity, late = null;
      const tgt = firstTarget(tk), work = taskWorkSec(tk);
      for (const p of free) {
        if (p.task) continue;
        const pen = eligible(p, tk); if (pen < 0) continue;
        const d = pathLen(p.node, tgt);
        // lange Arbeit kurz vor Pause/Schichtende nicht mehr beginnen (Übergabe an die nächste Schicht bzw. nach der Pause)
        if (tk.prio < PRIO.toolChangeWait && work > 0) {
          const dl = personDeadline(p);
          if (dl && S.t + d / WALK + work > dl.t + dl.tol) { if (!late || dl.t < late.t) late = dl; continue; }
        }
        const c = d + pen;
        if (c < bc) { bc = c; best = p; }
      }
      if (best) { tk.lateWhy = null; assign(best, tk); }
      else if (late) { tk.lateWhy = `${TASK_LABEL[tk.type] || tk.type} (ca. ${U.fmtDur(work)}) passt nicht mehr vor ${late.what} ${U.fmtClock(late.t)}${late.next ? ' – ' + late.next : ''}`; tk.lateT = S.t; }
    }
    // Dringende Aufgabe (Störung, Maschine steht ohne Werkzeug) und niemand frei: eine Person, die nur wartet bzw.
    // ihre Aufgabe noch nicht begonnen hat, unterbricht diese (die Aufgabe geht zurück in den Vorrat).
    for (const tk of open) {
      if (tk.status !== 'open' || tk.prio < PRIO.toolChangeWait || tk.held) continue;
      let best = null, bc = Infinity;
      const tgt = firstTarget(tk);
      for (let j = 0; j < PA.length; j++) {
        const p = PA[j], cur = p.task;
        if (!cur || !p.onDuty || p.endShift || p.breakPending || p.vehicle || cur.prio >= tk.prio || !canRelease(cur, false)) continue;
        const pen = eligible(p, tk); if (pen < 0) continue;
        const c = pathLen(p.node, tgt) + pen;
        if (c < bc) { bc = c; best = p; }
      }
      if (!best) continue;
      const old = best.task;
      ev('reassign', 'info', { kind: 'person', id: best.id }, `${pname(best.id)} unterbricht „${old.label}“ – dringender: ${tk.label}`, { from: old.id, fromType: old.type, to: tk.id, toType: tk.type });
      releaseTask(best);
      assign(best, tk);
    }
  }
  /** geschätzte Arbeitszeit einer Aufgabe ohne Wege (bemannte Bearbeitung ist unterbrechbar → 0) */
  function taskWorkSec(tk) {
    if (tk.wsK === tk.si) return tk.ws;
    let w = 0;
    for (let k = tk.si; k < tk.steps.length; k++) { const s = tk.steps[k]; if (s.k === 'work') w += s.sec || 0; else if (s.k === 'drive') w += 60; }
    if (tk.type === 'toolChange') w += 120; // Weg Werkzeugausgabe → Maschine
    if (tk.type === 'fpi' && !tk.data.local) w += 90; // Weg in den Messraum
    tk.wsK = tk.si; tk.ws = w;
    return w;
  }
  /** nächste Pause bzw. Schichtende der Person; tol = erlaubte Überschreitung; next = wer danach übernimmt */
  function personDeadline(p) {
    if (p.dlT === S.t) return p.dlV;
    p.dlT = S.t; p.dlV = personDeadline0(p);
    return p.dlV;
  }
  function personDeadline0(p) {
    const sh = SH.find(x => x.id === p.shift); if (!sh) return null;
    const d = Math.floor(S.t / DAY), s0 = S.t - d * DAY;
    for (const [a, b] of sh.wins) {
      if (s0 < a || s0 >= b) continue;
      const brk = b !== sh.end;
      const nextSh = !brk ? SH.find(x => x.start === sh.end) : null;
      return { t: d * DAY + b, what: brk ? 'der Pause' : 'Schichtende', tol: brk || nextSh ? CFG.overrunSec : CFG.overrunLastSec,
        next: brk ? `nach der Pause ab ${U.fmtClock(d * DAY + (sh.breaks.find(x => x[0] === b) || [0, b])[1])}` : nextSh ? `${nextSh.name} übernimmt ab ${U.fmtClock(d * DAY + nextSh.start)}` : `nächste Schicht ${tclock(nextWorkStart(d * DAY + b + 1))}` };
    }
    return null;
  }
  /** Werkzeugwechsel zurückhalten: bei Störung bis kurz vor Reparaturende; geplanter Wechsel erst, wenn die
      Wechsel-Teilegrenze mit dem Vorlauf erreichbar ist (kein Herumstehen bei langen Zyklen). */
  function taskHeld(tk) {
    if (tk.type !== 'toolChange' || !tk.machineId) { tk.held = false; return false; }
    if (tk.heldT != null && S.t - tk.heldT < 5) return tk.held; // Haltegrund ändert sich langsam (Vorlauf + 2 min Reserve)
    tk.held = false; tk.heldT = S.t;
    const mm = S.machines[tk.machineId], lead = leadSecFor(mm, tk);
    if (mm.fault && faultRemSec(mm) > lead + 120) { tk.holdUntil = null; tk.held = true; tk.holdWhy = `Störung ${mm.fault.code} – Wechsel nach der Reparatur`; return true; }
    if (tk.prio < PRIO.toolChangeWait) {
      tk.holdUntil = changeTargetT(mm, lead) - lead - 120;
      if (tk.holdUntil > S.t) { tk.held = true; tk.holdWhy = null; return true; }
    }
    return false;
  }
  function assign(p, tk) {
    tk.status = 'assigned'; tk.assignee = p.id; tk.assignedT = S.t;
    p.task = tk; p.goal = null; p.atHome = false; p.tasksToday++;
    if (tk.transportId && S.transports[tk.transportId]) { const tr = S.transports[tk.transportId]; tr.status = 'assigned'; tr.assignee = p.id; setWait(tr, null, null); }
    if (tk.type === 'forklift' || tk.type === 'bars') S.forklift.reservedBy = p.id;
    startStep(p);
  }
  function offsetPos(p, pos, at) {
    if (at !== 'work') return pos;
    const d = ((p.idx % 3) - 1) * 0.45;
    return { x: pos.x + d, z: pos.z };
  }
  function startStep(p) {
    const tk = p.task; if (!tk) return;
    const s = tk.steps[tk.si];
    if (!s) { finishTask(tk, 'done'); return; }
    tk.ready = false;
    switch (s.k) {
      case 'walk': case 'drive': {
        const st = ST[s.to];
        const pos = offsetPos(p, stPos(s.to, s.at), s.at);
        if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 0.25) { p.route = null; p.node = st.dockNode; tk.si++; return startStep(p); }
        routeTo(p, st.dockNode, pos);
        p.state = s.k === 'drive' ? 'driving' : 'walking';
        p.activity = s.k === 'drive' ? `Fährt Stapler zu ${stShort(s.to)} (${TASK_LABEL[tk.type]})` : `Geht zu ${mLabel(s.to)} (${TASK_LABEL[tk.type]})`;
        if (s.k === 'drive' && tk.transportId) { const tr = S.transports[tk.transportId]; if (tr) tr.status = tr.status === 'loaded' || tr.status === 'toDrop' ? 'toDrop' : 'toPickup'; }
        return;
      }
      case 'toForklift': {
        const f = S.forklift;
        if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) < 0.3) { mountForklift(p); tk.si++; return startStep(p); }
        routeTo(p, f.node, f.pos);
        p.state = 'walking'; p.activity = 'Geht zum Stapler';
        return;
      }
      case 'work':
        p.route = null; p.state = 'working'; tk.workStarted = true;
        try { actStart(p, tk, s); } catch (e) { engineError(e, 'actStart ' + tk.type + ' ' + tk.id); if (S.tasks[tk.id]) cancelTask(tk, 'interner Fehler'); return; }
        if (p.task !== tk) return;
        p.workRem = Math.max(1, Math.round(s.sec)); p.activity = s.label;
        return;
      case 'hold': // warten, bis eine Voraussetzung erfüllt ist (z. B. Messmaschine wieder in Ordnung)
        if (holdOk(s)) { tk.si++; return startStep(p); }
        p.route = null; p.state = 'working'; p.activity = s.label;
        { const m = tk.machineId ? S.machines[tk.machineId] : null; if (m && m.fpi && s.cond === 'cmm') m.fpi.stage = 'hold'; }
        return;
      case 'wait': case 'attend':
        p.route = null; p.state = 'working'; p.activity = s.label; tk.ready = true; tk.readyT = S.t;
        if (s.k === 'attend') tk.workStarted = true;
        return;
    }
  }
  function holdOk(s) { if (s.cond === 'cmm') { const q = S.machines.QS; return !(q && q.fault); } return true; }
  /** von der Maschine aus: wartende Person setzt mit dem nächsten Schritt fort */
  function advanceTask(p) { const tk = p.task; if (!tk) return; tk.si++; startStep(p); }
  /** interner Fehler: protokollieren, Aufgabe verwerfen – niemand bleibt mit einer toten Aufgabe stehen */
  function engineError(e, where) {
    const rec = { t: S.t, where, msg: String(e && e.message || e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : null };
    (S.engineErrors || (S.engineErrors = [])).push(rec);
    if (S.engineErrors.length > 50) S.engineErrors.shift();
    try { (G.console || console).error('[werkfluss sim]', where, e); } catch (x) { /* ignore */ }
  }
  function onWorkDone(p) {
    const tk = p.task, s = tk.steps[tk.si];
    try { actDone(p, tk, s); } catch (e) { engineError(e, 'actDone ' + tk.type + ' ' + tk.id); if (S.tasks[tk.id]) cancelTask(tk, 'interner Fehler'); return; }
    if (p.task !== tk || tk.status !== 'assigned') return;
    tk.si++;
    startStep(p);
  }
  function finishTask(tk, status) {
    if (!S.tasks[tk.id]) return;
    tk.status = status || 'done'; tk.doneT = S.t;
    const p = tk.assignee ? S.people[tk.assignee] : null;
    if (p && p.task === tk) {
      p.task = null; p.state = 'idle'; p.route = null; p.workRem = 0; p.idleSince = S.t; p.activity = 'Bereit';
      if (p.vehicle) parkForklift(p);
    }
    if (S.forklift.reservedBy && S.forklift.reservedBy === tk.assignee && (tk.type === 'forklift' || tk.type === 'bars')) S.forklift.reservedBy = null;
    if (tk.machineId && tk.mkey) { const m = S.machines[tk.machineId]; if (m && m.tasks[tk.mkey] === tk.id) m.tasks[tk.mkey] = null; }
    if (tk.transportId && status === 'cancelled') {
      const tr = S.transports[tk.transportId];
      if (tr && tr.status !== 'done' && tr.status !== 'toDrop' && tr.status !== 'loaded') { tr.status = 'open'; tr.assignee = null; tr.taskId = null; setWait(tr, 'noDriver', 'wartet auf Logistiker:in (Stapler)'); }
    }
    delete S.tasks[tk.id];
    if (tk.type === 'toolChange' && tk.machineId && status === 'done') planTools(S.machines[tk.machineId]);
  }
  /** Pause/Schichtende: noch nicht begonnene Aufgabe zurückgeben (laufende Arbeit wird beendet) */
  function canRelease(tk, forBreak) {
    const s = tk.steps[tk.si];
    if (!s) return false;
    if (!tk.workStarted) return true;
    if (s.k === 'attend') { // bemannte Bearbeitung (Messraum/Montage) wird für Pause/Schichtende unterbrochen, außer das Teil ist gleich fertig
      if (!forBreak) return false;
      const m = tk.machineId ? S.machines[tk.machineId] : null;
      return !(m && m.part && !m.part.paused && m.part.rem <= CFG.attendFinishSec);
    }
    if (s.k !== 'wait' || (tk.type !== 'toolChange' && tk.type !== 'load')) return false;
    if (forBreak) { // Teil ist gleich fertig → noch einlegen bzw. wechseln, dann Pause/Feierabend
      const m = tk.machineId ? S.machines[tk.machineId] : null;
      if (m && !m.fault && m.part && m.part.rem + m.dressRem <= 180) return false;
    }
    return true;
  }
  function releaseTask(p) {
    const tk = p.task; if (!tk) return;
    if (tk.machineId) markDirty(S.machines[tk.machineId]);
    if (tk.type === 'toolChange' && tk.data.fetched) {
      const m = S.machines[tk.machineId];
      tk.steps = [W(m.id), WAIT(`Wartet an ${m.id} auf Teilende (Werkzeugwechsel)`), K(240, 'tc', `Wechselt Werkzeug an ${m.id}`)];
      tk.data.note = 'Vermessenes Werkzeug liegt an der Maschine bereit';
    }
    tk.si = 0; tk.status = 'open'; tk.assignee = null; tk.ready = false; tk.workStarted = false;
    if (tk.transportId && S.transports[tk.transportId]) { const tr = S.transports[tk.transportId]; tr.status = 'open'; tr.assignee = null; setWait(tr, 'noDriver', 'wartet auf Logistiker:in (Stapler)'); }
    p.task = null; p.state = 'idle'; p.workRem = 0; p.idleSince = S.t; p.activity = 'Bereit';
    if (p.vehicle) parkForklift(p);
    if (S.forklift.reservedBy === p.id) S.forklift.reservedBy = null;
  }
  function mountForklift(p) { const f = S.forklift; p.vehicle = 'Stapler'; f.driver = p.id; f.state = 'driving'; p.pos.x = f.pos.x; p.pos.z = f.pos.z; p.node = f.node; p.heading = f.heading; }
  function parkForklift(p) { const f = S.forklift; f.pos = { x: p.pos.x, z: p.pos.z }; f.node = p.node; f.heading = p.heading; f.driver = null; f.state = 'parked'; p.vehicle = null; }
  function syncForklift(p) { const f = S.forklift; f.pos.x = p.pos.x; f.pos.z = p.pos.z; f.heading = p.heading; f.node = p.node; }

  /** Aufgabe beim Arbeitsbeginn verwerfen, weil ihr Anlass entfallen ist (sichtbar im Ereignisprotokoll) */
  function dropAtStart(p, tk, why) {
    ev('taskDropped', 'info', { kind: 'person', id: p.id }, `${pname(p.id)}: ${tk.label} entfällt – ${why}`, { taskId: tk.id, type: tk.type, machineId: tk.machineId });
    cancelTask(tk, why);
  }
  function actStart(p, tk, s) {
    const m = tk.machineId ? S.machines[tk.machineId] : null;
    const stale = m && tk.type !== 'repair' && tk.type !== 'inspect' && tk.type !== 'assembly' ? staleTask(tk, m) : null;
    switch (s.act) {
      case 'setup':
        if (!m) break;
        if (stale || m.setupDone || m.part || m.setupRun) { dropAtStart(p, tk, stale || (m.setupDone ? 'Maschine ist bereits gerüstet' : 'Maschine bearbeitet ein Teil')); return; }
        onSetupStart(m, p); break;
      case 'corr':
        if (!m) break;
        if (stale || !m.needCorr || m.part) { dropAtStart(p, tk, stale || 'keine Korrektur mehr nötig'); return; }
        m.corrRun = { t0: S.t, by: p.id, cause: `${sn(p.name)} korrigiert Programm/Werkzeugkorrektur nach Erstteil n.i.O. (10 min)` }; break;
      case 'fpiPick':
        if (m && (!m.fpi || stale)) { dropAtStart(p, tk, stale || 'kein Erstteil zur Prüfung'); return; }
        break;
      case 'offset':
        if (m && (stale || !hasOpen(tk.data.nkey) || m.toolchange)) { dropAtStart(p, tk, stale || (m.toolchange ? 'Werkzeugwechsel läuft – neues Werkzeug setzt die Korrektur zurück' : 'SPC-Trend bereits erledigt')); return; }
        break;
      case 'fetch': {
        if (!m) break;
        if (stale || !m.op) { dropAtStart(p, tk, stale || 'kein Arbeitsgang mehr eingeplant'); return; }
        const c = curOf(m), tc = toolCheck(m, c.o, c.i);
        let extra = 0;
        for (const t of changeTypes(m, c, tc)) { const st = S.toolStock[t]; if (st && st.ready <= 0) extra = Math.max(extra, (TT[t].presetMin || 3) * 60); }
        if (extra) { s.sec += extra; s.label = `Stellt neues Werkzeug für ${m.id} am Voreinstellgerät ein (kein vermessenes vorrätig)`; }
        break;
      }
      case 'repair': if (m && m.fault) m.fault.repairBy = p.id; break;
      case 'fpiMeasure':
        if (m && !m.fpi) { dropAtStart(p, tk, 'kein Erstteil zur Prüfung'); return; }
        if (m && m.fpi) { m.fpi.stage = 'measure'; m.fpi.by = p.id; if (m.fpi.local) resolveKey('fpi:' + m.id, 'Kontrolle läuft'); } break;
    }
  }
  function actDone(p, tk, s) {
    const m = tk.machineId ? S.machines[tk.machineId] : null;
    if (m) markDirty(m);
    switch (s.act) {
      case 'setup': if (m) onSetupDone(m); break;
      case 'corr': if (m) { m.corrRun = null; m.needCorr = false; ev('correction', 'info', { kind: 'machine', id: m.id }, `${m.id}: Korrektur durch ${sn(p.name)} abgeschlossen – neues Erstteil wird gefertigt`, null); } break;
      case 'fetch': tk.data.fetched = true; break;
      case 'load': if (m && m.part && m.part.sub === 'load') m.part.sub = 'cut'; break;
      case 'tc': if (m) onToolChanged(m); break;
      case 'repair': if (m) endFault(m, p.id); break;
      case 'fpiPick': if (m && m.fpi) { m.fpi.stage = 'carry'; m.fpi.by = p.id; resolveKey('fpi:' + m.id, 'Erstteil abgeholt'); } break;
      case 'fpiMeasure': if (m) fpiResult(m, p); break;
      case 'offset': if (m && m.op && hasOpen(tk.data.nkey)) { const c = curOf(m); applyOffset(c.o.id, c.r.seq, tk.data.value, sn(p.name)); } break;
      case 'flPick': forkPickup(p, tk); break;
      case 'flDrop': forkDrop(p, tk); break;
      case 'barsPick': barsPick(p, tk); break;
      case 'barsLoad': barsLoad(p, tk); break;
    }
  }

  function personTick(p) {
    if (p.state === 'offShift') return;
    if (p.onDuty) p.dutySec++;
    const tk = p.task;
    if (tk && (p.breakPending || p.endShift) && canRelease(tk, true)) { releaseTask(p); idleTick(p); }
    else if (!tk && p.goal === 'home' && (p.breakPending || p.endShift)) { p.goal = null; idleTick(p); }
    if (p.route) {
      const arrived = moveEnt(p, p.vehicle ? FORK : WALK);
      if (p.vehicle) { syncForklift(p); p.workSec++; }
      if (!arrived) return;
      p.route = null;
      if (p.task) {
        const s = p.task.steps[p.task.si];
        if (s && s.k === 'toForklift') mountForklift(p); // am Stapler angekommen → aufsteigen (sonst „fährt“ die Person ohne Stapler)
        p.task.si++; startStep(p);
      } else arriveGoal(p);
      return;
    }
    if (p.task) {
      if (p.workRem > 0) { p.workRem--; p.workSec++; if (p.workRem <= 0) onWorkDone(p); return; }
      const s = p.task.steps[p.task.si];
      if (s && s.k === 'hold') { if (holdOk(s)) { const m = S.machines[p.task.machineId]; if (m && m.fpi && m.fpi.stage === 'hold') m.fpi.stage = 'carry'; p.task.si++; startStep(p); } return; }
      if (s && s.k === 'attend') { const m = S.machines[p.task.machineId]; if (m && m.part) p.workSec++; }
      return;
    }
    if (p.state === 'break') {
      if (S.t >= (p.breakUntil || 0) || !p.breakPending) { p.state = 'idle'; p.breakPending = false; p.breakMakeup = false; p.breakFrom = null; p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Bereit'; p.goal = null; }
      return;
    }
    idleTick(p);
  }
  function idleTick(p) {
    if (!p.onDuty || p.task || (p.goal && p.route)) return;
    if (p.endShift) return goExit(p);
    if (p.breakPending) return goBreak(p);
    if (!p.atHome && S.t - p.idleSince >= CFG.idleHomeSec) goHome(p);
  }
  function entryStation() { return ST.OFFICE || P.stations[0]; }
  function goExit(p) { const e = entryStation(); p.atHome = false; p.goal = 'exit'; p.state = 'walking'; p.activity = 'Feierabend – verlässt die Halle'; routeTo(p, e.dockNode, e.dock); }
  function goBreak(p) {
    const e = entryStation(); p.atHome = false; p.goal = 'break'; p.state = 'walking'; p.activity = 'Geht in die Pause';
    if (p.breakFrom != null && S.t - p.breakFrom > CFG.makeupLateSec && !p.breakMakeup) { // Pause durchgearbeitet → volle Pause nachholen
      p.breakMakeup = true; p.breakUntil = Math.max(p.breakUntil || 0, S.t + (p.breakLen || 900));
      p.activity = `Holt die Pause nach (bis ${U.fmtClock(p.breakUntil)})`;
      ev('breakMakeup', 'info', { kind: 'person', id: p.id }, `${pname(p.id)} holt die Pause nach (${U.fmtDur(p.breakLen || 900)}, bis ${U.fmtClock(p.breakUntil)}) – laufende Arbeit ging über den Pausenbeginn ${U.fmtClock(p.breakFrom)} hinaus`, { until: p.breakUntil });
    }
    const k = p.idx % 6;
    routeTo(p, e.dockNode, { x: e.work.x - 1.5 + (k % 3) * 1.2, z: e.work.z - 1 + Math.floor(k / 3) * 1.6 });
  }
  function goHome(p) { p.goal = 'home'; p.state = 'walking'; p.activity = 'Geht zum Arbeitsplatz'; routeTo(p, p.homeNode, p.home); }
  function arriveGoal(p) {
    const g = p.goal; p.goal = null;
    if (g === 'exit') { p.state = 'offShift'; p.onDuty = false; p.endShift = false; p.breakPending = false; p.activity = 'Nicht im Dienst'; return; }
    if (g === 'break') { if (p.breakPending) { p.state = 'break'; p.activity = 'Pause'; return; } }
    p.state = 'idle'; p.activity = 'Bereit'; p.idleSince = S.t;
    if (g === 'home') p.atHome = true;
  }
  // ------------------------------------------------------------------ Schichten & Pausen
  function shiftTick() {
    cur = shiftInfo(S.t);
    const sid = cur ? cur.sh.id : null, inBreak = cur ? cur.inBreak : false;
    if (sid !== S.shiftId) { const old = S.shiftId; S.shiftId = sid; onShiftChange(old, sid); }
    if (inBreak !== S.inBreak) {
      S.inBreak = inBreak;
      for (const id in S.people) {
        const p = S.people[id];
        if (!p.onDuty || p.endShift || p.shift !== sid) continue;
        if (inBreak) { p.breakPending = true; p.breakUntil = cur.breakEnd; p.breakFrom = S.t; p.breakLen = cur.breakEnd - S.t; }
        else if (p.state === 'break' && S.t >= (p.breakUntil || 0)) { p.breakPending = false; p.state = 'idle'; p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Bereit'; }
        // wer die Pause noch nicht antreten konnte (laufende Arbeit), behält sie und holt sie danach nach (goBreak)
      }
      if (inBreak) ev('break', 'info', { kind: 'plant', id: 'werk' }, `Pause ${cur.sh.name} bis ${U.fmtClock(cur.breakEnd)} – laufende Arbeiten werden noch beendet`, null);
    }
  }
  /** Werkzeugausgabe: zu Schichtbeginn vermessene Werkzeuge auf Grundbestand auffüllen */
  function restockCrib() {
    let n = 0;
    for (const tt of P.toolTypes) {
      const st = S.toolStock[tt.id], target = STOCK_DEFAULT[tt.kind] != null ? STOCK_DEFAULT[tt.kind] : 4;
      if (st.ready < target) { n += target - st.ready; st.ready = target; }
    }
    if (n) ev('crib', 'info', { kind: 'station', id: 'CRIB' }, `Werkzeugausgabe: ${n} Werkzeuge vorvermessen und für die Schicht bereitgestellt`, { count: n });
  }
  function onShiftChange(old, nw) {
    const e = entryStation();
    for (const id in S.people) {
      const p = S.people[id];
      if (old && p.shift === old && p.onDuty) { p.endShift = true; p.breakPending = false; p.breakMakeup = false; p.breakFrom = null; }
      if (nw && p.shift === nw && !p.onDuty) {
        p.onDuty = true; p.endShift = false; p.breakPending = false; p.state = 'idle'; p.goal = null; p.route = null; p.task = null;
        p.pos = { x: e.dock.x + ((p.idx % 3) - 1) * 0.6, z: e.dock.z }; p.node = e.dockNode; p.atHome = false;
        p.idleSince = S.t - CFG.idleHomeSec; p.activity = 'Schichtbeginn';
      }
    }
    shiftReport(old, nw);
    if (nw) restockCrib();
    // Geisterschicht-Check: zu Schichtbeginn erledigt; bei Schichtende auf den Nachttext umstellen
    if (nw) { if (hasOpen('ghost:check')) resolveKey('ghost:check', 'Schichtbeginn'); S.ghostCheck = null; }
    else if (hasOpen('ghost:check')) ghostCompose();
    if (!nw) for (let j = 0; j < MA.length; j++) if (hasOpen('fpi:' + MA[j].id)) resolveKey('fpi:' + MA[j].id, 'Schichtende – Erstteilprüfung zu Schichtbeginn');
    if (nw && S.intake) intakeAtShiftStart(nw);
    for (const mid in S.machines) S.machines[mid].ks = freshStats(S.machines[mid]);
    S.shiftStats = { id: nw, startT: S.t, good: 0, scrap: 0 };
  }

  // ------------------------------------------------------------------ Logistik: Transporte, AGVs, Stapler (§3.6)
  /** Zielpuffer frei? (für den aktiven Arbeitsgang der Zielmaschine immer – verhindert Verklemmungen) */
  /** Behälter-Transporte unterwegs je Zielstation (zugeteilt/beladen, nicht offen/erledigt): {n, by: {orderId|idx: n}} */
  function inflightMap() {
    const res = {};
    for (const id of ATR) {
      const t = S.transports[id];
      if (!t || !t.containerId || t.status === 'open' || t.status === 'done') continue;
      inflightAdd(res, t);
    }
    return res;
  }
  function inflightAdd(res, t) {
    const sid = t.to.station, e = res[sid] || (res[sid] = { n: 0, by: {} });
    e.n++;
    const cc = S.containers[t.containerId];
    if (cc) { const k = cc.orderId + '|' + cc.idx; e.by[k] = (e.by[k] || 0) + 1; }
  }
  function destHasRoom(tr, inflight) {
    const sid = tr.to.station, m = S.machines[sid];
    if (!m || !tr.containerId) return true;
    const c = S.containers[tr.containerId];
    if (!c) return true;
    // Eingangspuffer nicht überfüllen; nur wenn der laufende Arbeitsgang sonst verhungert (kein Behälter da/unterwegs), darf einer mehr hin
    const isAct = !!(m.op && m.op.oid === c.orderId && m.op.idx === c.idx);
    const e = (inflight || inflightMap())[sid];
    const n = countIn(sid) + (e ? e.n : 0), act = e ? (e.by[c.orderId + '|' + c.idx] || 0) : 0;
    if (isAct && act === 0 && !firstInput(sid, c.orderId, c.idx)) return true;
    return n < Math.max(1, m.inCap);
  }
  /** Transport-Phase für Halle/Material: 'geplant' (Ziel voll – Behälter bleibt am Ausgang bzw. im Pufferlager),
      'wartend' (Ziel frei, Fahrzeug/Fahrer:in fehlt), 'unterwegs', 'erledigt' */
  function setWait(tr, code, text) { tr.waitCode = code; tr.waitReason = text; tr.phase = code === 'destFull' ? 'geplant' : code ? 'wartend' : 'unterwegs'; }
  /** Pufferlager (PUF): Plätze frei? */
  const pufCap = () => (ST.PUF ? Math.max(0, ST.PUF.cap != null ? ST.PUF.cap : 12) : 0);
  const pufFree = (inflight) => { const st = S.stations.PUF; if (!st || !pufCap()) return 0; const e = (inflight || {}).PUF; return pufCap() - st.out.length - st.inp.length - (e ? e.n : 0); };
  function transportsTick() {
    let inflight = null, agvWait = false, agvTxt = null;
    const empties = [];
    for (const tr of activeTransports()) {
      if (tr.status !== 'open') { if (tr.phase !== 'unterwegs') tr.phase = 'unterwegs'; continue; }
      if (tr.kind === 'empty') { empties.push(tr); continue; }
      if (tr.containerId && !S.containers[tr.containerId]) { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; tr.phase = 'erledigt'; continue; }
      if (!inflight) inflight = inflightMap();
      if (!destHasRoom(tr, inflight)) {
        // Ziel voll: Behälter bleibt geplant am Ausgang – droht der Ausgang der Quelle voll zu laufen, bringt ein freies AGV
        // ihn ins Pufferlager (Palettenregal) und später von dort zum Ziel
        // (nicht für die Säge: ihr Vorrat liegt geplant in der eigenen Zuschnitt-Ablage – „Zuschnitt auf Vorrat“)
        const srcM = S.machines[tr.from.station];
        if (tr.mode === 'AGV' && tr.kind === 'container' && srcM && srcM.type !== 'saw' && countOut(srcM.id) >= Math.max(1, srcM.outCap) && pufFree(inflight) > 0) {
          const a = bestAgv(tr);
          if (a) { tr.finalTo = tr.to.station; tr.to = { station: 'PUF' }; tr.label = tr.label.replace(/→ .*$/, '→ ' + stShort('PUF') + ' (Ziel ' + stShort(tr.finalTo) + ' voll)'); assignAgv(a, tr); inflightAdd(inflight, tr); continue; }
        }
        const dm = S.machines[tr.to.station], e = inflight[tr.to.station], nIn = countIn(tr.to.station) + (e ? e.n : 0);
        if (tr.waitCode !== 'destFull' || tr.waitN !== nIn) { tr.waitN = nIn; setWait(tr, 'destFull', `Ziel voll (Zielpuffer ${stShort(tr.to.station)} ${nIn}/${dm ? Math.max(1, dm.inCap) : '–'})`); }
        continue;
      }
      if (tr.mode === 'AGV') {
        const a = bestAgv(tr);
        if (a) { assignAgv(a, tr); if (tr.containerId) inflightAdd(inflight, tr); }
        else {
          agvWait = true;
          if (!agvTxt) {
            const all = Object.values(S.agvs), free = all.filter(x => !x.task), charging = free.filter(x => x.mustCharge || x.battery < CFG.batteryAssign);
            agvTxt = charging.length && charging.length === free.length
              ? ['charging', `Fahrzeug lädt (${charging.map(x => x.name + ' ' + Math.round(x.battery) + ' %').join(', ')})`]
              : ['noVehicle', `kein Fahrzeug frei (${all.map(x => x.name + (x.task ? ' unterwegs' : x.state === 'charging' ? ' lädt' : ' bereit')).join(', ')})`];
          }
          if (tr.waitReason !== agvTxt[1]) setWait(tr, agvTxt[0], agvTxt[1]);
        }
      } else if (!tr.taskId) {
        let tk;
        if (tr.kind === 'bars') {
          const mt = S.materials[tr.materialId];
          tk = newTask('bars', tr.to.station, null, [FORKW(), DRV('RAW', 'out'), K(CFG.barsPickSec, 'barsPick', `Entnimmt Stangen ${mt.name} im Kragarmregal`),
            DRV(tr.to.station, 'in'), K(CFG.barsLoadSec, 'barsLoad', `Lädt Stangen in den Stangenlader ${tr.to.station}`)], { transportId: tr.id });
          tk.label = `Stangen nachladen ${tr.to.station} (${mt.name})`;
        } else {
          tk = newTask('forklift', tr.from.station, null, [FORKW(), DRV(tr.from.station, 'out'), K(CFG.agvHandleSec, 'flPick', `Nimmt Behälter mit dem Stapler auf (${tr.label})`),
            DRV(tr.to.station, 'in'), K(CFG.agvHandleSec, 'flDrop', `Stellt Behälter an ${stShort(tr.to.station)} ab`)], { transportId: tr.id });
          tk.label = `Staplertransport ${tr.label} (${nm(tr.weightKg)} kg)`;
        }
        tr.taskId = tk.id; setWait(tr, 'noDriver', 'wartet auf Logistiker:in (Stapler)');
      } else if (tr.waitCode !== 'noDriver' || tr.phase !== 'wartend') setWait(tr, 'noDriver', 'wartet auf Logistiker:in (Stapler)');   // Aufgabe zurückgegeben (Pause/Schichtende)
    }
    // Leergut zuletzt: nur ein freies AGV mit Akku über der Lade-Reserve (Materialtransporte haben Vorrang)
    for (const tr of empties) {
      const a = agvWait ? null : bestAgv(tr);
      if (a && a.battery >= CFG.batteryAssign + 10) { assignAgv(a, tr); agvWait = true; }
      else if (tr.waitCode !== 'lowPrio') setWait(tr, 'lowPrio', 'Leergut – fährt, sobald ein AGV frei ist');
    }
  }
  function bestAgv(tr) {
    let best = null, bd = Infinity;
    const st = ST[tr.from.station];
    for (const id in S.agvs) {
      const a = S.agvs[id];
      if (a.task || a.mustCharge || a.battery < CFG.batteryAssign || tr.weightKg > a.maxKg) continue;
      if (a.state !== 'idle' && a.state !== 'charging' && a.state !== 'toCharge') continue;
      const d = U.path(GRAPH, a.node, st.dockNode).length + (100 - a.battery) * 0.5 - Math.min(30, (S.t - (a.freeSince || 0)) / 60);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function assignAgv(a, tr) {
    a.task = tr.id; a.taskLabel = tr.label; tr.assignee = a.id; tr.status = 'toPickup'; setWait(tr, null, null);
    a.state = 'toPickup';
    routeTo(a, ST[tr.from.station].dockNode, stPos(tr.from.station, tr.from.slot || 'out'));
  }
  function chargerPos(a) { const c = ST.CHG; return a.slot % 2 ? c.outPos : c.inPos; }
  function atCharger(a) { const p = chargerPos(a); return Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 0.3; }
  function goCharge(a) { a.state = 'toCharge'; routeTo(a, ST.CHG.dockNode, chargerPos(a)); }
  function agvTick(a) {
    if (a.route) {
      // mit Last langsamer (Lastfahrt, Personenschutz-Scanner): agvLoadedFactor × speed
      const v = a.load || a.loadKind === 'empty' ? a.speed * CFG.agvLoadedFactor : a.speed;
      const arrived = moveEnt(a, v);
      a.battery = Math.max(0, r6(a.battery - CFG.agvDrain)); a.distToday += v;
      if (!arrived) return;
      a.route = null;
      if (a.state === 'toPickup') { a.state = 'loading'; a.waitRem = CFG.agvHandleSec; }
      else if (a.state === 'toDrop') { a.state = 'unloading'; a.waitRem = CFG.agvHandleSec; }
      else if (a.state === 'toCharge') a.state = a.battery < 99.5 ? 'charging' : 'idle';
      return;
    }
    if (a.waitRem > 0) { a.waitRem--; if (a.waitRem <= 0) agvHandleDone(a); return; }
    if (a.state === 'charging') {
      a.battery = Math.min(100, r6(a.battery + CFG.agvCharge));
      if (a.mustCharge && a.battery >= CFG.batteryFull) { a.mustCharge = false; resolveKey('agvbat:' + a.id, `geladen (${Math.round(a.battery)} %)`); }
      if (a.battery >= 100) a.state = 'idle';
      return;
    }
    if (a.state === 'idle' && !a.task) { if (!atCharger(a)) goCharge(a); else if (a.battery < 99.5) a.state = 'charging'; }
  }
  function agvHandleDone(a) {
    const tr = S.transports[a.task];
    if (!tr) { a.task = null; a.state = 'idle'; return; }
    if (a.state === 'loading' && tr.kind === 'empty') {
      a.load = null; a.loadKind = 'empty'; a.loadN = tr.empties || 1; tr.status = 'toDrop'; tr.pickupT = S.t; a.state = 'toDrop';
      routeTo(a, ST[tr.to.station].dockNode, stPos(tr.to.station, tr.to.slot || 'in'));
      return;
    }
    if (a.state === 'loading') {
      const c = S.containers[tr.containerId];
      if (!c || !c.location || c.location.kind !== 'station') { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; a.task = null; a.state = 'idle'; return; }
      pickupContainer(c, { kind: 'agv', id: a.id });
      a.load = c.id; a.loadKind = 'container'; tr.status = 'toDrop'; tr.pickupT = S.t; a.state = 'toDrop';
      routeTo(a, ST[tr.to.station].dockNode, stPos(tr.to.station, 'in'));
      return;
    }
    if (a.state === 'unloading') {
      const c = S.containers[a.load];
      if (c && tr.to.station === 'PUF' && tr.finalTo) {
        // Pufferlager: Behälter zwischenlagern (kein Zugang beim Ziel-Arbeitsgang), Weitertransport zum Ziel sofort geplant
        c.state = 'ready'; c.relocate = true; placeAt(c, 'PUF', 'out'); c.transportId = null; c.bufferedT = S.t;
        const nt = createTransport(c); if (nt) { nt.fromBuffer = true; setWait(nt, 'destFull', `Ziel voll (Zielpuffer ${stShort(nt.to.station)})`); }
        ev('buffer', 'info', { kind: 'container', id: c.id }, `${c.qty} Stk ${c.partName} (${c.orderId}) ins Pufferlager – Ziel ${stShort(tr.finalTo)} voll; Weitertransport, sobald Platz ist`, { orderId: c.orderId, from: tr.from.station, to: tr.finalTo });
      } else if (c) dropContainer(c, tr.to.station);
      const wasEmpty = tr.kind === 'empty';
      a.load = null; a.loadKind = null; a.loadN = 0; tr.status = 'done'; tr.phase = 'erledigt'; tr.doneT = S.t; a.task = null; a.taskLabel = null; a.freeSince = S.t; a.transportsToday++;
      if (wasEmpty) S.today.emptyReturns = (S.today.emptyReturns || 0) + 1; else S.today.transports++;
      if (a.battery < CFG.batteryLow) {
        a.mustCharge = true;
        notify({ key: 'agvbat:' + a.id, sev: 'info', role: 'Logistik', entity: { kind: 'agv', id: a.id }, title: `${a.name}: Akku niedrig (${Math.round(a.battery)} %)`,
          body: `${a.name} lädt ca. ${U.fmtDur((CFG.batteryFull - a.battery) / CFG.agvCharge)} · in der Zeit keine Transporte`,
          suggestion: brief(`Akku ${Math.round(a.battery)} %`, 'Transporte übernimmt das andere AGV; schwere Behälter per Stapler') });
        goCharge(a);
      } else a.state = 'idle';
    }
  }
  function forkPickup(p, tk) {
    const tr = S.transports[tk.transportId]; const c = tr && S.containers[tr.containerId];
    if (!tr || !c || !c.location || c.location.kind !== 'station') { if (tr) { tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true; } finishTask(tk, 'done'); return; }
    pickupContainer(c, { kind: 'forklift', id: S.forklift.id, personId: p.id });
    S.forklift.load = c.id; tr.status = 'loaded'; tr.pickupT = S.t;
  }
  function forkDrop(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) return;
    const c = S.containers[tr.containerId];
    if (c) dropContainer(c, tr.to.station);
    S.forklift.load = null; tr.status = 'done'; tr.doneT = S.t; S.today.transports++;
  }
  function barsPick(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) { finishTask(tk, 'done'); return; }
    const m = S.machines[tr.to.station], mt = S.materials[tr.materialId];
    const want = m.barMagazineM - (m.barMat === mt.id ? m.barStockM : 0);
    let meters = Math.floor(want / CFG.barLenM + 1e-9) * CFG.barLenM;
    if (meters < CFG.barLenM) meters = want;
    meters = r6(Math.min(meters, mt.onHand));
    const c = curOf(m), per = c && c.r.material ? c.r.material.perPart : 0.01;
    if (meters + 1e-9 < per) {
      tr.status = 'done'; tr.doneT = S.t; tr.cancelled = true;
      ev('barsFail', 'warn', { kind: 'material', id: mt.id }, `Keine Stangen ${mt.name} mehr im Lager – Stangenlader ${m.id} kann nicht befüllt werden`, null);
      if (c) notifyMissing(m, mt, c.r);
      finishTask(tk, 'done');
      return;
    }
    materialIssue(mt, meters);
    tr.meters = meters; tr.status = 'loaded'; tr.pickupT = S.t; S.forklift.load = 'Stangen';
  }
  function barsLoad(p, tk) {
    const tr = S.transports[tk.transportId]; if (!tr) return;
    const m = S.machines[tr.to.station], mt = S.materials[tr.materialId];
    if (m.barMat === mt.id) m.barStockM = r6(m.barStockM + tr.meters);
    else { mt.onHand = r6(mt.onHand + tr.meters); checkStock(mt); }
    S.forklift.load = null; tr.status = 'done'; tr.doneT = S.t; S.today.transports++;
    ev('bars', 'ok', { kind: 'machine', id: m.id }, `${sn(p.name)} hat ${nm(tr.meters, 1)} m ${mt.name} in den Stangenlader ${m.id} geladen (Magazin jetzt ${nm(m.barStockM, 1)} m)`, { meters: tr.meters });
  }

  // ------------------------------------------------------------------ Kennzahlen, Energie, Historie
  function machinePower(m) {
    const p = m.power;
    switch (m.state) {
      case 'running': return m.part && m.part.sub === 'cut' ? p.run : p.idle + (p.run - p.idle) * 0.25;
      case 'fault': return p.idle * 0.8;
      case 'setup': case 'toolchange': return p.idle * 1.1;
      default: return p.idle;
    }
  }
  /** Geisterschicht-Status (nur ohne Schicht): autonome, für den unbemannten Lauf freigegebene Maschinen, die laufen bzw. stehen */
  function ghostStatus() {
    const auto = MA.filter(m => m.kind === 'machine' && m.loading === 'auto' && m.op && m.setupDone && m.released);
    // stehen = Verlust (Warten, Störung); 'Bereit' (z. B. Zuschnitt auf Vorrat) ist geplanter Stillstand
    const run = auto.filter(m => m.state === 'running' || m.state === 'toolchange'), idle = auto.filter(m => m.state === 'idle');
    const stopped = auto.filter(m => !run.includes(m) && !idle.includes(m));
    return { autonomous: auto.length, running: run.length, stoppedIds: stopped.map(m => m.id), idleIds: idle.map(m => m.id),
      machines: auto.map(m => ({ id: m.id, state: m.state, since: m.since, cause: m.cause })), until: nextWorkStart(S.t + 1), ghostWindow: ghostWindow(S.t) };
  }
  /** Geisterschicht-Fenster: unbemannte Nacht nach dem letzten Schichtende eines Werktags bis zum nächsten
      Schichtbeginn (Mo→Di … Fr→Sa). Das Wochenende ist keine geplante Geisterschicht. */
  function ghostWindow(t) {
    if (shiftInfo(t)) return false;
    const day = Math.floor(t / DAY), s = t - day * DAY, dow = ((day % 7) + 7) % 7;
    if (s < DAY_START) return ((dow + 6) % 7) < 5;
    return dow < 5;
  }
  /** autonome Maschine soll unbemannt laufen: Arbeitsgang gerüstet und freigegeben, Zustand ≠ Bereit */
  const ghostPlanned = (m) => m.loading === 'auto' && !!m.op && m.setupDone && m.released && m.state !== 'idle';
  function statsTick() {
    const work = !!(cur && !cur.inBreak); // Schichtzeit ohne Pausen = OEE-Bezugszeit
    // Geisterschicht: für autonome Maschinen mit freigegebenem Arbeitsgang ist die Nacht geplante Zeit –
    // Warten auf Werkzeug/Material, Ausgang voll oder Störung sind dann echte Verfügbarkeitsverluste (mit Kosten)
    const ghost = !cur && ghostWindow(S.t);
    let kw = CFG.basePowerKw;
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j], st = m.state, kd = m.kd, ks = m.ks;
      kd.stateSec[st]++; ks.stateSec[st]++;
      const plan = st === 'running' || (work && st !== 'idle') || (ghost && ghostPlanned(m));
      if (plan) { kd.planned++; ks.planned++; kd.plannedStateSec[st]++; ks.plannedStateSec[st]++; }
      if (st === 'running') { kd.run++; ks.run++; }
      else if (plan) { const e = m.rate / 3600; kd.lossSec++; kd.lossEur += e; ks.lossSec++; ks.lossEur += e; kd.lossEurBy[st] += e; ks.lossEurBy[st] += e; }
      const pw = machinePower(m);
      kd.energyKwh += pw / 3600; kw += pw;
    }
    for (let j = 0; j < AA.length; j++) { const a = AA[j]; kw += a.route ? 0.6 : a.state === 'charging' ? 1.5 : a.waitRem > 0 ? 0.3 : 0.05; }
    S.powerKw = kw; S.energyKwh += kw / 3600; S.today.energyKwh += kw / 3600;
    S.histAcc.powerSum += kw; S.histAcc.n++;
  }
  /* OEE-Definitionen (je Maschine; „heute“ = seit 00:00; Bezugszeit = Schichtzeit ohne Pausen):
       Planbelegungszeit = Sekunden mit eingeplantem Arbeitsgang (Zustand ≠ 'Bereit') in der Schichtzeit
                           + jede Sekunde 'Produktion' (auch Geisterschicht/Pause – zählt in Zähler und Nenner)
                           + Geisterschicht (Werktagsnacht, ghostWindow): jede Sekunde, in der eine autonome Maschine
                             (loading 'auto') mit gerüstetem, freigegebenem Arbeitsgang nicht 'Bereit' ist – sie soll
                             unbemannt laufen; Warten auf Werkzeug/Material, Ausgang voll, Störung = Verlust
       Verfügbarkeit     = Laufzeit ('running') / Planbelegungszeit
       Leistung          = Σ Plan-Taktzeit (cycleMin) der bearbeiteten Teile / Laufzeit
                           (Einlegen, Abrichten und Zyklusstreuung senken die Leistung), max. 1;
                           beim Lesen zählt das laufende Teil anteilig (Taktzeit × Fortschritt, idealOpen) –
                           die Kennzahl ändert sich stetig statt in Sprüngen am Teilende (gebucht wird erst am Teilende)
       Qualität          = Gutteile / (Gutteile + Ausschuss)
       OEE               = Verfügbarkeit × Leistung × Qualität
     Werk-OEE: Summen über alle Bearbeitungsmaschinen (kind 'machine', ohne Messraum und Montage).
     Verlust (lossEur)   = Maschinenstundensatz × Zeit in Schichtzeit, in der ein Auftrag eingeplant ist,
                           die Maschine aber nicht produziert (Rüsten, Warten, Störung …). */
  /** null = (noch) keine Bezugszeit – z. B. nachts ohne Produktion; Anzeige „–“ statt 0 % */
  function oeeOf(st, extraIdeal) {
    const ideal = st.ideal + (extraIdeal || 0);
    const a = st.planned > 0 ? Math.min(1, st.run / st.planned) : null;
    const p = st.run > 0 ? Math.min(1, ideal / st.run) : null;
    const q = st.good + st.scrap > 0 ? st.good / (st.good + st.scrap) : 1;
    return { oee: a != null && p != null ? a * p * q : null, availability: a, performance: p, quality: q, plannedSec: st.planned, runSec: st.run };
  }
  function computeWip() {
    let w = 0;
    for (const id in S.containers) { const c = S.containers[id]; if (c.state !== 'shipped' && c.state !== 'scrap') w += c.qty; }
    for (const id in S.machines) { const m = S.machines[id]; if (m.part) w++; if (m.fpi) w++; }
    return w;
  }
  /** Summe der Bearbeitungsmaschinen (kind 'machine') – inkl. anteiliger Ideal-Zeit der laufenden Teile */
  function aggStats(key, autoOnly) {
    const agg = { planned: 0, run: 0, ideal: 0, good: 0, scrap: 0 };
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j]; if (m.kind !== 'machine' || (autoOnly && m.loading !== 'auto')) continue;
      const st = m[key];
      agg.planned += st.planned; agg.run += st.run; agg.good += st.good; agg.scrap += st.scrap;
      agg.ideal += st.ideal + idealOpen(m, st);
    }
    return agg;
  }
  /** Kosten aus dem Profil (profile.costs) – eine Quelle für Engine, Analyse und Copilot */
  const energyPrice = () => { const c = P && P.costs; return c && c.energyEurPerKwh > 0 ? c.energyEurPerKwh : 0.19; };
  function costs() {
    const c = (P && P.costs) || {};
    return { currency: c.currency || 'EUR', energyEurPerKwh: energyPrice(), labourEurPerHour: c.labourEurPerHour || null, overtimeSurchargePct: c.overtimeSurchargePct != null ? c.overtimeSurchargePct : null,
      machineRates: Object.fromEntries(MA.map(m => [m.id, m.rate])), assumed: !(c.energyEurPerKwh > 0) };
  }
  function kpis() {
    let lossEur = 0;
    for (let j = 0; j < MA.length; j++) lossEur += MA[j].kd.lossEur;
    const o = oeeOf(aggStats('kd'));
    // Geisterschicht: Schicht-OEE nur über die autonomen Maschinen (die anderen haben dann keine geplante Zeit)
    const os = oeeOf(aggStats('ks', !cur));
    const good = S.today.good, scrap = S.today.scrap;
    // Liefertreue aus der veröffentlichten (geglätteten) Prognose; fertig = termingerecht nur bei vollständiger Menge
    let n = 0, ok = 0, fc = null;
    for (const id in S.orders) {
      const od = S.orders[id]; n++;
      if (od.status === 'fertig') { if (od.doneT <= od.due && od.shippedQty >= od.qty) ok++; continue; }
      let eta = S.etaPub[id] ? S.etaPub[id].eta : null;
      if (eta == null) { fc = fc || forecast(300); eta = fc.orders[id] ? fc.orders[id].eta : Infinity; }
      if (eta <= od.due) ok++;
    }
    return {
      t: S.t, oee: o.oee, availability: o.availability, performance: o.performance, quality: o.quality,
      oeeShift: os.oee, oeeLastShift: S.lastShiftOee ? S.lastShiftOee.oee : null, lastShift: S.lastShiftOee ? S.lastShiftOee.shift : null,
      // good/scrap/fpy zählen je Arbeitsgang (auch Waschen, Prüfen); goodFinished = Gutteile des letzten Bearbeitungsschritts je Auftrag
      good, scrap, goodOps: good, goodFinished: S.today.goodFinished || 0, fpy: good + scrap > 0 ? good / (good + scrap) : 1, onTimePct: n ? ok / n : 1,
      lossEur: Math.round(lossEur), energyKwh: Math.round(S.today.energyKwh * 10) / 10, energyEurToday: Math.round(S.today.energyKwh * energyPrice() * 100) / 100, powerKw: Math.round(S.powerKw * 10) / 10,
      wip: computeWip(), transportsToday: S.today.transports, toolCostToday: Math.round(S.toolCostToday),
      shippedToday: S.today.shipped, scrapBy: Object.assign({}, S.today.scrapBy), faultsToday: S.today.faults,
      toolChangesToday: S.today.toolChanges, setupsToday: S.today.setups, fpiOk: S.today.fpiOk, fpiNok: S.today.fpiNok,
      occupancy: occupancy(),
      ghost: cur ? null : ghostStatus(),
    };
  }
  function historyTick() {
    const stepSec = P.sim.historyStepSec || 300;
    if (S.t % stepSec !== 0) return;
    const h = S.history, k = kpis();
    S.kpi = k;
    // Zustandsband: Segmente älter als 24 h entfernen (auch bei Maschinen, die lange im selben Zustand bleiben)
    const lim = S.t - DAY;
    for (let j = 0; j < MA.length; j++) { const sg = MA[j].segments; let n = 0; while (n < sg.length - 1 && sg[n].t1 != null && sg[n].t1 < lim) n++; if (n) sg.splice(0, n); }
    h.t.push(S.t); h.good.push(S.histAcc.good); h.oee.push(k.oee == null ? null : Math.round(k.oee * 1000) / 1000);
    h.powerKw.push(Math.round((S.histAcc.n ? S.histAcc.powerSum / S.histAcc.n : S.powerKw) * 10) / 10); h.wip.push(k.wip);
    for (const id in S.machines) h.perMachine[id].push(S.machines[id].state);
    S.histAcc = { good: 0, powerSum: 0, n: 0 };
    const max = Math.ceil(2 * DAY / stepSec);
    if (h.t.length > max) {
      const cut = h.t.length - max;
      for (const key of ['t', 'good', 'oee', 'powerKw', 'wip']) h[key].splice(0, cut);
      for (const id in h.perMachine) h.perMachine[id].splice(0, cut);
    }
  }
  function dayRollover() {
    S.yesterday = Object.assign({ kpi: kpis() }, S.today);
    for (const id in S.machines) S.machines[id].kd = freshStats(S.machines[id]);
    S.today = { day: Math.floor(S.t / DAY), good: 0, goodFinished: 0, scrap: 0, scrapBy: { 'Maß': 0, 'Werkzeugbruch': 0, 'Erstteil n.i.O.': 0 }, fpiOk: 0, fpiNok: 0,
      transports: 0, emptyReturns: 0, shipped: 0, toolChanges: 0, faults: 0, setups: 0, energyKwh: 0, lossEur: 0 };
    for (const id in S.toolStock) S.toolStock[id].scrapToday = 0;
    S.toolCostToday = 0;
    for (const id in S.people) { const p = S.people[id]; p.workSec = 0; p.dutySec = 0; p.utilToday = 0; p.tasksToday = 0; }
    for (const id in S.agvs) { S.agvs[id].distToday = 0; S.agvs[id].transportsToday = 0; }
    for (const id in S.materials) S.materials[id].usedToday = 0;
  }
  const PROG = {};
  function progName(o, r) {
    const k = o.id + '/' + r.seq;
    if (PROG[k]) return PROG[k];
    const n = 4000 + (parseInt(U.hash(o.part.no || o.id), 16) % 5000);
    return (PROG[k] = 'O' + n + '_' + o.id.replace('-', '') + '_OP' + r.seq);
  }
  /** Maschinensignale je Anschluss-Level und Maschinentyp, konsistent zum Zustand:
       Level 0: Tablet-Rückmeldung (nur letzte Meldung), Level 1: Stromsensor + Signalsäule (Leistung, Strom, Ampel, Laufzeit),
       Level 2/3: Steuerungsdaten – Spindel nur bei Maschinen mit Spindel; Messraum: Messprogramm/Merkmal; Waschanlage: Bad/Zyklus;
       Montage: Terminal-Schritt. Level 3 zusätzlich Werkzeug in der Spindel. */
  function computeSignals(m, T) {
    {
      const lv = m.conn.level || 0;
      const c = curOf(m);
      const cutting = m.state === 'running' && !!m.part && m.part.sub === 'cut' && !m.part.paused;
      const dressing = m.state === 'running' && !m.part && m.dressRem > 0;
      const nz = hnoise(T, m.idx + 1);
      const light = m.state === 'fault' ? 'red' : m.state === 'running' ? 'green' : m.state === 'idle' ? 'off' : 'yellow';
      if (lv === 0) return { t: T, level: 0, source: 'Tablet', lastFeedbackT: m.lastPartT || m.since, lastFeedback: m.lastPartT ? 'Teil gemeldet' : WF.STATE[m.state].label };
      if (lv === 1) {
        const kw = Math.round(machinePower(m) * (1 + 0.03 * nz) * 10) / 10;
        return { t: T, level: 1, source: 'Stromsensor + Signalsäule', powerKw: kw, currentA: Math.round(kw * 1000 / (1.732 * 400 * 0.85) * 10) / 10,
          stackLight: light, stackLightLabel: LABELS.stackLight[light], runtimeTodaySec: m.kd.stateSec.running, partCounter: null };
      }
      const tl = c ? mainToolOf(m, c.r) : null, wear = tl ? tl.used / tl.life : 0;
      const base = RPM[m.type] || 0, spindle = base > 0;
      const sg = { t: T, level: lv, source: m.conn.protocol, mode: m.state === 'fault' ? 'ALARM' : cutting || dressing ? 'AUTO' : m.state === 'setup' || m.state === 'toolchange' ? 'JOG/MDI' : 'STOP',
        stackLight: light, stackLightLabel: LABELS.stackLight[light],
        spindleRpm: spindle ? (cutting ? Math.round(base * (1 + 0.015 * nz)) : dressing ? Math.round(base * 0.6) : 0) : null,
        spindleLoadPct: spindle ? (cutting ? Math.max(5, Math.round(36 + 32 * wear + 5 * nz)) : dressing ? 12 : 0) : null,
        feedOverridePct: spindle ? (c ? (wear > 0.9 ? 90 : 100) : 100) : null,
        program: c ? (m.type === 'cmm' ? 'CALYPSO_' + o4(c.o) + '_AG' + c.r.seq : m.type === 'assembly' ? 'Montageanweisung ' + (c.o.part.drawing || c.o.part.no) : m.type === 'washer' ? 'Waschprogramm ' + (c.o.part.material || 'Standard') : progName(c.o, c.r)) : '–',
        partCounter: c ? c.op.good + c.op.scrap : 0, totalCounter: m.counter,
        toolInSpindle: lv >= 3 && spindle && tl ? tl.typeId : null, toolInSpindleName: lv >= 3 && spindle && tl ? tl.name : null,
        alarm: m.fault ? m.fault.code + ' ' + m.fault.text : null, coolant: cutting && spindle };
      if (m.type === 'cmm') { const ch = c ? charOf(m, c.r) : null; sg.measuringProgram = sg.program; sg.feature = cutting && ch ? ch.name : null; sg.probe = m.fault ? 'Taster gestört' : cutting ? 'misst' : 'bereit'; }
      if (m.type === 'washer') { sg.bathTempC = Math.round((m.fault ? 48 : 60) + 1.5 * nz); sg.cycle = cutting ? (m.part.rem > m.part.dur * 0.3 ? 'Waschen' : 'Trocknen') : '–'; }
      if (m.type === 'assembly') { const n = 7, k = cutting ? Math.min(n, 1 + Math.floor((1 - m.part.rem / m.part.dur) * n)) : 0; sg.terminalStep = cutting ? `Schritt ${k}/${n}` : '–'; }
      return sg;
    }
  }
  const o4 = (o) => (o.part.no || o.id).replace(/[^A-Za-z0-9]/g, '');

  // ------------------------------------------------------------------ Regeln & Benachrichtigungen (§3.9)
  function rulesTick() {
    for (const id in S.machines) {
      // Wartezeit für die Warnung ab Beginn der Episode bzw. ab Schichtbeginn (eine über Nacht stehende Maschine,
      // die zu Schichtbeginn sofort versorgt wird, löst keine Warnung aus)
      const m = S.machines[id], dur = S.t - Math.max(m.since, S.shiftStats.startT);
      if (WAIT_STATES[m.state]) {
        const planned = m.state === 'waitOperator' && (m.waitCode === 'break' || m.waitCode === 'offShift' || m.waitCode === 'walking' || m.waitCode === 'assigning' || m.waitCode === 'tooLate');
        const thr = m.state === 'waitTool' ? CFG.toolWarnSec : CFG.waitWarnSec;
        if (!planned && dur >= thr) notifyWait(m);
        else if (planned && hasOpen('wait:' + m.id)) {
          // Episode abgeschlossen (jetzt geplante Abwesenheit bzw. Person unterwegs) – Titel mit Zeitraum statt „seit“
          const n0 = NIDX['wait:' + m.id], since0 = n0.since != null ? n0.since : m.since;
          n0.title = `${m.id} ${m.short}: ${WF.STATE[m.state].label} ${tclock(since0)}–${U.fmtClock(S.t)} (${U.fmtDur(S.t - since0)})`;
          resolveKey('wait:' + m.id, m.waitCode === 'walking' ? 'Person ist unterwegs' : 'geplante Abwesenheit (Pause/Schicht)');
        }
      }
      // Erstteil wartet: nur in der Schichtzeit eine Warnung (nachts ist niemand da – geplant „Bereit“)
      if (m.fpi && m.fpi.stage === 'wait' && cur && !cur.inBreak && S.t - Math.max(m.fpi.t0, S.shiftStats.startT) >= CFG.fpiWarnSec && !hasOpen('fpi:' + m.id)) {
        const tk = S.tasks[m.tasks.fpi], who = tk && tk.assignee ? pname(tk.assignee) + ' ist unterwegs' : availability(tk).text;
        if (m.fpi.local) notify({ key: 'fpi:' + m.id, sev: 'warn', role: 'Einrichter', entity: { kind: 'machine', id: m.id }, title: `Kontrolle erstes Teil ${m.id} wartet seit ${U.fmtClock(m.fpi.t0)}`,
          body: `Erstes Teil nach Formwerkzeug-Wechsel liegt an ${m.id} bereit · Serie wartet · Stillstand ca. ${U.fmtEur(m.rate)}/h`,
          suggestion: brief(`Kontrolle an der Maschine offen – ${who}`, `Kontrolle (ca. ${U.fmtDur(CFG.fpiLocalSec)}) vor anderen Aufgaben erledigen`),
          actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
        else notify({ key: 'fpi:' + m.id, sev: 'warn', role: 'QS', entity: { kind: 'machine', id: m.id }, title: `Erstteilprüfung ${m.id} wartet seit ${U.fmtClock(m.fpi.t0)}`,
          body: `Erstteil liegt bereit · ${m.id} wartet auf Freigabe · Stillstand ca. ${U.fmtEur(m.rate)}/h`,
          suggestion: brief(`QS: ${who}`, 'Erstteilprüfungen vor Losprüfungen ziehen'),
          actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
      }
    }
    // SPC-Meldung 5 min offen (Trend bestätigt) → Bediener/Einrichter geht zur Maschine und gibt die Korrektur ein (Aufgabe, 1,5 min)
    for (const n of S.notifications) {
      if (n.status === 'resolved' || !n.spc || S.t - n.spc.since < CFG.spcReactSec) continue;
      const m = S.machines[n.spc.machineId], c = curOf(m);
      if (!c || c.o.id !== n.spc.orderId || c.r.seq !== n.spc.seq || m.tasks.offset || m.toolchange) continue;
      const tk = newTask('offset', m, c, [W(m.id), K(90, 'offset', `Gibt Werkzeugkorrektur an ${m.id} ein (SPC-Trend ${c.o.id})`)]);
      tk.data.value = n.spc.value; tk.data.nkey = n.key;
      m.tasks.offset = tk.id; tk.mkey = 'offset';
    }
    for (const n of S.notifications) if (n.status !== 'resolved' && n.autoResolveT && S.t >= n.autoResolveT) resolveKey(n.key, 'zeitlich erledigt');
    // Einrichter:in wartet mit dem Werkzeug an der Maschine, obwohl die Wechsel-Teilegrenze noch weit weg ist
    // (Störung, langer Zyklus, Maschine fertigt gerade nicht) → Werkzeug bereitlegen, andere Aufgaben übernehmen;
    // die Aufgabe bleibt offen und wird kurz vor der Teilegrenze wieder vergeben.
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j]; const tk = S.tasks[m.tasks.tc];
      if (!tk) continue;
      if (!m.toolchange) { // Wechselauftrag gehört zu einem anderen (beendeten/verlagerten) Arbeitsgang → entfällt
        const stale = staleTask(tk, m);
        if (stale) { if (tk.assignee && tk.data.fetched) ev('toolReturn', 'info', { kind: 'machine', id: m.id }, `${m.id}: Werkzeugwechsel entfällt (${stale}) – ${pname(tk.assignee)} bringt das Werkzeug zurück in die Werkzeugausgabe`, null); cancelTask(tk, stale); continue; }
      }
      if (!tk.ready || !tk.assignee || !m.op) continue;
      const s = tk.steps[tk.si]; if (!s || s.k !== 'wait') continue;
      let why = null;
      if (m.fault) { if (faultRemSec(m) > 600) why = `Störung ${m.fault.code} – gewechselt wird nach der Reparatur`; }
      else if (m.part || m.dressRem > 0) { const tE = earliestChangeT(m); if (tE - S.t > 600) why = `Wechsel-Teilegrenze erst ca. ${U.fmtClock(tE)}`; }
      else if (m.state !== 'waitTool' && m.state !== 'toolchange' && S.t - (tk.readyT || S.t) >= 300) why = `Maschine fertigt gerade nicht (${WF.STATE[m.state].label})`;
      if (!why) continue;
      const p = S.people[tk.assignee];
      const pk = m.fault ? 'f' + m.fault.t0 : 'b' + S.t;
      if (tk.data.parkKey !== pk) ev('toolPlanned', 'info', { kind: 'machine', id: m.id }, `${m.id}: Werkzeugwechsel zurückgestellt – ${why}; ${pname(p.id)} legt ${tk.data.fetched ? 'das vermessene Werkzeug an der Maschine bereit' : 'die Aufgabe zurück'} und übernimmt bis dahin andere Aufgaben`, { parked: true });
      tk.data.parkKey = pk;
      if (!m.part && !m.fault) {
        // Maschine steht (Material/Ausgang): Zeitpunkt der Teilegrenze unbekannt → Aufgabe endet, beim nächsten Teilende neu geplant
        if (tk.data.fetched) { const c = curOf(m); m.toolStaged = toolCheck(m, c.o, c.i).planned.map(x => x.spec.type); }
        finishTask(tk, 'cancelled');
      } else releaseTask(p);
    }
    if (S.t % (WARM ? 600 : 300) === 0) lateCheck();   // beim Vorrechnen alle 10 min (gleiche Regel, weniger Prognoseläufe)
    if (S.t % 60 === 0) {
      if (!WARM) S.kpi = kpis();
      for (const id in S.people) { const p = S.people[id]; p.utilToday = p.dutySec > 0 ? Math.min(1, p.workSec / p.dutySec) : 0; }
      for (const id in S.transports) { const t = S.transports[id]; if (t.status === 'done' && S.t - t.doneT > 6 * 3600) delete S.transports[id]; }
      intakeTick();
      if (S.t % 600 === 0) { kanbanCheck(); archiveTick(); }
      // Werkzeug-Meldungen jede Sim-Minute aus der aktuellen Planung neu formulieren (Uhrzeit driftet sonst während langer Teile)
      if (!WARM) refreshToolNotes();
      // Material-Meldungen: Liefertermin live (überfällig statt vergangener Uhrzeit)
      for (let j = 0; j < MA.length; j++) {
        const m = MA[j]; if (!m.missing) continue;
        const c = curOf(m);
        for (const matId in m.missing) { const mt = S.materials[matId]; if (hasOpen(m.missing[matId]) && c && c.r.material && c.r.material.id === matId) notifyMissing(m, mt, c.r); }
      }
      // Geisterschicht-Check: ab 1 h vor Schichtende alle 10 min bzw. sofort nach einer Änderung; nachts Stillstand ergänzen
      if (cur) { if (S.t >= cur.end - 3600 && (S.t % 600 === 0 || GDIRTY || S.t === cur.end - 60)) { GDIRTY = false; ghostCheck(); } }
      else if (S.t % 600 === 0 && hasOpen('ghost:check')) ghostCompose();
    }
  }
  /** offene Werkzeug-Meldungen aus der aktuellen Planung neu formulieren (Uhrzeit nie veraltet) */
  function refreshToolNotes() { for (let j = 0; j < MA.length; j++) { const m = MA[j]; if (m.op && !m.toolchange && hasOpen('tool:' + m.id)) planTools(m); } }
  /** Warte-Meldung anlegen bzw. mit der aktuellen Ursache aktualisieren – kompakt: Titel „seit“, Body eine Zeile,
      Empfehlung „Ursache: … Empfehlung: …“ (nachts: was zu Schichtbeginn zuerst zu tun ist) */
  function notifyWait(m) {
    const key = 'wait:' + m.id;
    // nachts: im Geisterschicht-Check angekündigter Stopp → Sammelmeldung ergänzen (keine zweite Warnung)
    if (!cur && ghostCovers(m)) { const e = S.ghostCheck.machines[m.id]; if (e.waitingSince == null || e.liveState !== m.state) ghostCompose(); return; }
    if (hasOpen(key) && NIDX[key].causeT === m.cause) return;
    const label = WF.STATE[m.state].label, c = curOf(m), night = !cur;
    const next = tclock(nextWorkStart(S.t + 1));
    let role = 'Schichtleitung', cause = trimStr(m.cause, 100), rec = '';
    if (m.state === 'waitTool' && c) {
      const tc = toolCheck(m, c.o, c.i), x = tc.short[0], tl = x && x.tl, idx = canIndex(tl), name = x ? TT[x.spec.type].name : 'Werkzeug';
      const tk = S.tasks[m.tasks.tc], verb = idx ? 'wenden' : 'wechseln';
      role = 'Einrichter';
      cause = tl && tl.broken ? `${name} gebrochen` : `${idx || (tl && tl.edges > 1) ? 'Schneide ' + edgeTxt(tl).replace('Schneide ', '') + ' von ' : 'Standzeit '}${name} verschlissen${night ? ', niemand im Haus' : ''}`;
      rec = night ? `${next} als Erstes ${verb}${idx ? ' (1–2 min)' : ''}; künftig vor Schichtende vorbeugend ${verb}`
        : tk && tk.assignee ? `${pname(tk.assignee)} kommt ${idx ? 'zum Wenden (1–2 min)' : 'mit dem vermessenen Werkzeug'}`
        : idx ? 'Bediener wendet die Schneide an der Maschine (1–2 min)' : 'vermessenes Werkzeug holen und an der Maschine wechseln';
    } else if (m.state === 'waitOperator') {
      const what = m.waitWhat || 'Bedienung', code = m.waitCode;
      cause = `${what} – ${code === 'busy' ? 'qualifizierte Personen beschäftigt' : code === 'tooLate' ? 'passt nicht mehr vor Pause/Schichtende' : code === 'offShift' ? 'niemand im Haus' : code === 'break' ? 'Pause' : 'niemand frei'}`;
      rec = code === 'offShift' ? `zu Schichtbeginn ${next} zuerst erledigen` : code === 'tooLate' ? 'bei der Übergabe als erste Aufgabe ansagen' : 'Bediener einer ruhigen Maschine oder Einrichter:in einsetzen';
    } else if (m.state === 'blocked') {
      role = 'Logistik';
      const why = blockedWhy(m), bt = blockedTr(m), full = !!(bt && bt.waitCode === 'destFull');
      cause = `Ausgang voll – ${why}`;
      rec = night ? `zu Schichtbeginn ${next} zuerst abholen` : full ? `Eingang an ${stShort(bt.to.station)} freiräumen oder Auftrag mit freiem Ziel vorziehen` : 'Abholung priorisieren (AGV/Stapler)';
    } else if (m.state === 'starved') {
      const ext = /Fremdbearbeitung/.test(m.cause), raw = /Rohmaterial|Lager/.test(m.cause), bars = /Stangen/.test(m.cause);
      role = raw ? 'Einkauf' : 'Logistik';
      rec = ext ? 'Rückkehr bestätigen lassen; bis dahin anderen Auftrag vorziehen' : bars ? 'Stangen per Stapler nachladen' : raw ? (/unterwegs/.test(m.cause) ? 'Liefertermin bestätigen; anderen Auftrag vorziehen' : 'sofort nachbestellen') : 'Vorgänger prüfen oder Auftrag mit Material vorziehen';
    }
    const n = notify({ key, sev: 'warn', role, entity: { kind: 'machine', id: m.id }, title: `${m.id} ${m.short}: ${label} seit ${U.fmtClock(m.since)}`,
      body: `${label} seit ${U.fmtClock(m.since)}${c ? ' · ' + c.o.id + ' AG ' + c.r.seq : ''} · Stillstand ca. ${U.fmtEur(m.rate)}/h`, suggestion: brief(cause, rec),
      actions: [{ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: m.id } }] });
    n.causeT = m.cause;
  }
  function lateCheck() {
    // deterministisch: frisch rechnen (unabhängig davon, wann die Oberfläche zuletzt eine Prognose angefordert hat)
    const fc = computeForecast();
    publishEta(fc); applyPub(fc);
    let plantBn;   // Werks-Engpass (bottleneck()) – nur berechnet, wenn eine Terminwarnung formuliert wird
    for (const id in S.orders) {
      const o = S.orders[id], key = 'late:' + id, f = fc.orders[id];
      if (o.status === 'fertig' || !f) { o.lateStreak = 0; if (hasOpen(key)) resolveKey(key, 'Auftrag fertig'); continue; }
      const open = hasOpen(key);
      const late = f.eta > o.due + 900 || (open && f.eta > o.due - 900);
      // Prognose kann an Schichtgrenzen kippen (Rest passt knapp vor 22:00 oder erst morgen 06:00):
      // gemeldet wird erst, wenn sie in zwei Prüfungen hintereinander (10 min) zu spät liegt
      o.lateStreak = late ? (o.lateStreak || 0) + 1 : 0;
      if (late && (open || o.lateStreak >= 2)) {
        if (plantBn === undefined) { const b = bottleneck(); plantBn = b ? b.stationId : null; }
        const d = f.eta - o.due;
        // Empfehlung aus der Was-wäre-wenn-Rechnung (höchstens alle 30 min neu, bzw. nach Prioritätswechsel)
        const n0 = open ? NIDX[key] : null;
        let adv = n0 && n0.advice && S.t - n0.advice.t < 1800 && n0.advice.prio === o.priority ? n0.advice : null;
        if (!adv) { const a = orderAdvice(id); adv = { t: S.t, prio: o.priority, suggestion: a.text, actions: a.actions, wi: a.whatIf }; }
        const n = notify({ key, sev: 'warn', role: 'Schichtleitung', entity: { kind: 'order', id },
          title: `Termin gefährdet: ${id} (${shortName(o.customer)})`,
          body: `Prognose ${U.fmtDayClock(f.eta)} · Termin ${U.fmtDayClock(o.due)} · ${d > 0 ? U.fmtDur(d) + ' zu spät' : 'nur ' + U.fmtDur(-d) + ' Puffer'}${f.bottleneckStation ? ' · ' + limitTxt(f, plantBn) : ''}`,
          suggestion: adv.suggestion, actions: adv.actions });
        n.whatIf = adv.wi || null; n.advice = adv;
      } else if (open && !late) resolveKey(key, 'Prognose wieder im Termin');
    }
  }
  // ------------------------------------------------------------------ Geisterschicht-Check (eine Sammelmeldung)
  /** Kurzname eines Werkzeugtyps für Meldungen („WSP CNMG 120408 (Schruppen)“ → „CNMG 120408“) */
  const toolShort = (typeId) => String((TT[typeId] || {}).name || typeId).replace(/\s*\([^)]*\)/g, '').replace(/^(WSP|VHM-|Mikro-Drehwerkzeug)\s*/, '').trim();
  const GHOST_WHAT = { bars: 'Stangen leer', input: 'Eingang leer', output: 'Ausgang voll', material: 'Material fehlt', fpi: 'Erstteil nicht freigegeben', fault: 'Störung' };
  const ghostStop = (e) => e.stopT != null && e.reason !== 'done' && e.reason !== 'ahead' && e.reason !== 'through';
  /** Geisterschicht-Check: ab 1 h vor dem letzten Schichtende eines Tages (21:00) alle 10 min und nach jeder Änderung
      (Wechsel beauftragt/erledigt, Arbeitsgang beendet, Stangen beauftragt) neu bewertet – EINE Meldung 'ghost:check':
      welche autonomen Maschinen nachts stoppen, wann und warum, je mit einer Empfehlung. Nach Schichtende eingefroren;
      nachts wird nur der tatsächliche Stillstand ergänzt („steht seit …“). */
  function ghostCheck() {
    if (!cur || S.t >= cur.end) return;
    const nextStart = nextWorkStart(cur.end + 1);
    if (nextStart - cur.end < 1800 || S.t < cur.end - 3600) return;   // keine unbemannte Lücke / noch zu früh
    const key = 'ghost:check', open = hasOpen(key), day = Math.floor(S.t / DAY);
    // einmal je Abend: vom Benutzer erledigte Meldung nicht neu anlegen
    if (!open && S.ghostCheck && S.ghostCheck.day === day && S.ghostCheck.notified) return;
    const staffEnd = cur.end, until = Math.min(nextStart, (Math.floor((staffEnd - 1) / DAY) + 1) * DAY + DAY_START);
    const G = { t: S.t, day, staffEnd, until, nextStart, notified: !!(S.ghostCheck && S.ghostCheck.day === day && S.ghostCheck.notified), machines: {} };
    for (let j = 0; j < MA.length; j++) { const e = ghostEntry(MA[j], staffEnd, until, nextStart); if (e) G.machines[e.machineId] = e; }
    S.ghostCheck = G;
    if (!Object.keys(G.machines).length) { if (open) resolveKey(key, 'keine autonome Maschine mehr für die Nacht eingeplant'); return; }
    ghostCompose();
  }
  /** Bewertung einer autonomen Maschine für die Nacht: Lauf Teil für Teil (Werkzeug-Standzeit inkl. Regelwechseln bis
      Schichtende, Stangenmagazin, Eingangs- und Ausgangspuffer) → erster Stopp und Empfehlung */
  function ghostEntry(m, staffEnd, until, nextStart) {
    if (m.kind !== 'machine' || m.loading !== 'auto' || !m.op || !m.setupDone) return null;
    const c = curOf(m); if (!c) return null;
    const hh = (t) => tclock(t), nx = tclock(nextStart);
    const e = { machineId: m.id, orderId: c.o.id, seq: c.r.seq, reason: 'through', stopT: null, tool: null, types: [], gainSec: 0, tLast: null,
      rec: '', recShort: '', recNight: '', action: null, waitingSince: null };
    if (m.fault) { Object.assign(e, { reason: 'fault', stopT: S.t, rec: `Störung vor Schichtende beheben – sonst steht ${m.id} bis ${nx}`, recShort: `${m.id} Störung beheben`, recNight: `${m.id} Störung beheben` }); return e; }
    if (!m.released) { Object.assign(e, { reason: 'fpi', stopT: staffEnd, rec: `Erstteil vor Schichtende prüfen und freigeben – sonst läuft ${m.id} nachts nicht`, recShort: `${m.id} Erstteil freigeben`, recNight: `${m.id} Erstteil prüfen` }); return e; }
    const tc = toolCheck(m, c.o, c.i), cyc = tc.cyc;
    const caps = ghostCaps(m, c, tc, staffEnd);
    let pend = null;
    if (m.manualTC) { const w = changeWindow(m, c.o, c.i, tc); if (w) pend = { types: m.manualTC.types.slice(), k: w.kTarget }; }
    const base = ghostRun(m, tc, pend, staffEnd, until, caps);
    if (base.stopT == null) {
      if (base.done && base.endT < until) {
        const pal = m.automation === 'pallet';
        Object.assign(e, { reason: 'done', stopT: base.endT, rec: pal ? `${c.o.id} wird ca. ${hh(base.endT)} fertig – Folgeauftrag vor Schichtende auf der Wechselpalette rüsten, dann läuft ${m.id} weiter` : `${c.o.id} wird ca. ${hh(base.endT)} fertig – Folgeauftrag ${nx} als Erstes rüsten`,
          recShort: pal ? `${m.id} Folgeauftrag auf Palette rüsten` : '', recNight: `${m.id} Folgeauftrag rüsten` });
      }
      return e;
    }
    e.stopT = base.stopT; e.reason = base.reason;
    if (base.reason === 'tool') {
      e.tool = base.tool;
      // letzte Teilegrenze, die vor Schichtende sicher noch mit Einrichter:in erreichbar ist
      const b0 = boundaryT(m);
      let kL = -1;
      for (let k = 0; k < 5000; k++) { const t = b0 + k * cyc; if (t > staffEnd - 600) break; if (t >= S.t + leadSec()) kL = k; }
      let L = [base.tool], opt = null, gain = 0;
      if (kL >= 0) {
        for (let it = 0; it < 4; it++) {
          opt = ghostRun(m, tc, { types: L, k: kL }, staffEnd, until, caps);
          if (opt.stopT == null || opt.reason !== 'tool' || !opt.tool || L.includes(opt.tool)) break;
          L = L.concat(opt.tool);
        }
        gain = (opt.stopT == null ? until : opt.stopT) - base.stopT;
      }
      const worth = kL >= 0 && gain >= Math.max(1800, 3 * cyc) && !(pend && L.every(t => pend.types.includes(t)));
      const tlOf = (t) => (tc.items.find(x => x.spec.type === t) || {}).tl;
      const verbOf = (types) => types.every(t => canIndex(tlOf(t))) ? 'wenden' : 'wechseln';
      const names = (types) => types.map(toolShort).join(', ');
      e.recNight = `${m.id} ${verbOf([base.tool])} (${toolShort(base.tool)})`;
      if (worth) {
        const tLast = Math.round(b0 + kL * cyc), v = verbOf(L);
        e.types = L; e.gainSec = gain; e.tLast = tLast;
        e.action = { type: 'planToolChange', machineId: m.id, types: L, notBefore: tLast, reason: 'vor der Geisterschicht' };
        e.actionLabel = `${m.id}: vor Schichtende ${v}`;
        e.rec = `ca. ${hh(tLast)} vorbeugend ${v}: ${names(L)} – dann läuft ${m.id} ${opt.stopT == null ? (opt.done ? 'bis Auftragsende' : 'bis ' + nx) : 'bis ca. ' + hh(opt.stopT)} (+${U.fmtDur(gain)})`;
        e.recShort = `${m.id} ca. ${hh(tLast)} ${v}`; e.recShortN = `${e.recShort} (${names(L)})`;
      } else {
        const bott = opt && opt.reason === 'tool' && opt.tool ? opt.tool : base.tool, lim = tc.items.find(x => x.spec.type === bott);
        const full = lim && lim.tl ? Math.floor(lim.tl.life / lim.spec.cutMinPerPart + 1e-9) : 0;
        const v0 = verbOf([base.tool]);
        if (pend) { e.rec = `Vorbeugender Wechsel ist beauftragt – Standzeit reicht trotzdem nur bis ca. ${hh(base.stopT)}: Schwesterwerkzeug oder Nachtbemannung prüfen`; e.recShort = e.recShortN = `${m.id} Wechsel beauftragt`; }
        else if (kL < 0) { e.rec = `Vor Schichtende ist keine Teilegrenze mehr für einen Wechsel erreichbar – ${nx} als Erstes ${v0}; künftig vor Schichtende vorbeugend ${v0} (oder Schwesterwerkzeug/Nachtbemannung)`; e.atStart = true; e.recShort = `${m.id} ${v0}`; }
        else { e.rec = `${toolShort(bott)} reicht auch frisch nur ca. ${U.fmtDur(full * cyc)} – Schwesterwerkzeug, Nachtbemannung/Rufbereitschaft oder Arbeitsgang mit längerer Standzeit`; e.recShort = `${m.id} Schwesterwerkzeug prüfen`; e.recShortN = `${m.id} Schwesterwerkzeug oder Nachtbemannung`; }
      }
    } else if (base.reason === 'bars') {
      const tr = barsTransportOf(m);
      e.rec = `Stangen vor Schichtende nachladen (Magazin ${nm(m.barStockM || 0, 1)} von ${nm(m.barMagazineM, 0)} m)`;
      e.recShort = `${m.id} Stangen nachladen`; e.recNight = `${m.id} Stangen nachladen`;
      if (!tr) { e.action = { type: 'refillBars', machineId: m.id }; e.actionLabel = `${m.id}: Stangen nachladen`; }
    } else if (base.reason === 'material') {
      e.rec = `Rohmaterial reicht nur bis ca. ${hh(base.stopT)} – Material bereitstellen oder Folgeauftrag mit Material rüsten`;
      e.recShort = `${m.id} Material bereitstellen`; e.recNight = `${m.id} Material bereitstellen`;
    } else if (base.reason === 'input') {
      const pal = m.automation === 'pallet';
      e.rec = pal ? `Teile reichen nur bis ca. ${hh(base.stopT)} – Paletten vor Schichtende mit Teilen eines Folgeauftrags rüsten` : `Teile reichen nur bis ca. ${hh(base.stopT)} – Vorgänger liefert nachts nicht nach; Folgeauftrag mit Material rüsten`;
      e.recShort = pal ? `${m.id} Paletten rüsten` : `${m.id} Folgeauftrag rüsten`; e.recNight = `${m.id} ${pal ? 'Paletten rüsten' : 'Teile bereitstellen'}`;
    } else if (base.reason === 'output') {
      if (m.type === 'saw') { e.reason = 'ahead'; e.rec = `Zuschnitt-Vorrat ab ca. ${hh(base.stopT)} voll – kein Handlungsbedarf`; return e; }
      e.rec = `Ausgang ab ca. ${hh(base.stopT)} voll (Folgemaschine läuft nachts nicht) – Ausgang vor Schichtende leeren oder Auftrag mit freiem Ziel rüsten`;
      e.recShort = `${m.id} Ausgang leeren`; e.recNight = `${m.id} Ausgang leeren`;
    }
    return e;
  }
  /** Grenzen außer der Standzeit: Stangenmagazin (Nachladen bis 15 min vor Schichtende), Rohmaterial der Säge,
      Teile im Eingang (Vorgänger läuft nachts nicht) und Platz im Ausgang bzw. im Eingang der Folgemaschine */
  function ghostCaps(m, c, tc, staffEnd) {
    const o = c.o, i = c.i, r = c.r, caps = { n: [], bars: null };
    const autoRun = (mm, oid, idx) => !!(mm && mm.loading === 'auto' && mm.op && mm.op.oid === oid && mm.op.idx === idx && mm.setupDone && mm.released && !mm.fault);
    if (isBarFed(m, r)) {
      if (m.barMat === r.material.id) caps.bars = { stock: m.barStockM || 0, per: r.material.perPart, mag: m.barMagazineM, reorder: m.barReorderM, refill: !!barsTransportOf(m) && S.t < staffEnd - 900 };
    } else if (isSawRaw(m, r, i)) {
      const mt = S.materials[r.material.id];
      caps.n.push({ reason: 'material', n: Math.floor((mt.onHand + 1e-9) / r.material.perPart) });
    } else if (i > 0) {
      const prev = o.routing[i - 1], pm = S.machines[prev.station];
      if (!o.ops[i - 1].complete && autoRun(pm, o.id, i - 1)) { /* Vorgänger läuft nachts mit */ }
      else caps.n.push({ reason: 'input', n: waitingQty(o.id, i) + inboundQty(o.id, i) });
    }
    const nx = o.routing[i + 1], dest = nx ? S.machines[nx.station] : null;
    if (dest && !autoRun(dest, o.id, i + 1)) {
      const batch = opBatch(r), st = S.stations[m.id];
      let fillRem = 0, outN = 0;
      for (const cid of st.out) { const cc = S.containers[cid]; if (!cc) continue; outN++; if (cc.state === 'filling' && cc.orderId === o.id && cc.src === i) fillRem = Math.max(0, batch - cc.qty); }
      const fl = inflightMap()[dest.id];
      const destFree = Math.max(0, Math.max(1, dest.inCap) - countIn(dest.id) - (fl ? fl.n : 0));
      caps.n.push({ reason: 'output', n: Math.max(0, fillRem + Math.max(0, Math.max(1, m.outCap) - outN + destFree) * batch - (m.part ? 1 : 0)) });
    }
    return caps;
  }
  /** Lauf Teil für Teil bis zum Ende der Geisterschicht: bis Schichtende wechselt die Einrichter:in nach der normalen
      Regel (Wechselgrenze, Mitwechseln) und lädt Stangen nach, danach niemand mehr.
      fresh = {types, k}: vorbeugender Wechsel an Teilegrenze k. Ergebnis: erster Stopp {stopT, reason, tool} oder done. */
  function ghostRun(m, tc, fresh, staffEnd, until, caps) {
    const cyc = tc.cyc, chg = 300;
    const st = tc.items.filter(x => x.tl && x.spec.cutMinPerPart > 0).map(x => ({ type: x.spec.type, cut: x.spec.cutMinPerPart, life: x.tl.life,
      rem: x.remA, at: x.at, full: Math.floor(x.tl.life / x.spec.cutMinPerPart + 1e-9),
      ins: x.tl.kind === 'insert' && (x.tl.edges || 1) > 1, edge: x.tl.edge || 1, edges: x.tl.edges || 1 }));
    // Wechsel wie in der Werkstatt: Wendeplatte mit freier Schneide wird gewendet, sonst neues Werkzeug; beim reinen Wenden
    // (alle fälligen Werkzeuge wendbar) werden nur wendbare Platten mitgenommen (kein Gang zur Werkzeugausgabe)
    const canIdx = (x) => x.ins && x.edge < x.edges;
    const renew = (x) => { if (canIdx(x)) x.edge++; else x.edge = 1; x.rem = x.full; };
    const capN = (caps && caps.n) || [], cn = capN.map(x => x.n);
    const bars = caps && caps.bars ? Object.assign({}, caps.bars) : null;
    let t = boundaryT(m), pl = tc.plAfter, changes = [];
    for (let k = 0; k < 20000; k++) {
      if (pl <= 0) return { stopT: null, done: true, endT: t, changes };
      if (t >= until) return { stopT: null, endT: t, changes };
      let ch = [];
      if (fresh && k === fresh.k) for (const x of st) if (fresh.types.includes(x.type)) { renew(x); ch.push(x.type); }
      if (t < staffEnd && st.some(x => x.rem <= x.at && pl > x.rem)) {
        const due = st.filter(x => x.rem <= x.at && pl > x.rem), idxOnly = due.every(canIdx);
        for (const x of st) if (pl > x.rem && (x.rem <= x.at || ((!idxOnly || canIdx(x)) && Math.max(0, x.rem - x.at) * cyc <= CFG.bundleSec && x.rem * x.cut <= CFG.bundleFrac * x.life))) { renew(x); ch.push(x.type); }
      }
      if (ch.length) { changes.push({ t, types: ch }); t += chg; }
      const lim = st.find(x => x.rem < 1);
      if (lim) return { stopT: t, reason: 'tool', tool: lim.type, partsBefore: tc.plAfter - pl, changes };
      for (let j = 0; j < cn.length; j++) if (cn[j] <= 0) return { stopT: t, reason: capN[j].reason, partsBefore: tc.plAfter - pl, changes };
      if (bars) {
        if ((bars.refill || bars.stock < bars.reorder) && t < staffEnd - 900) { bars.stock = bars.mag; bars.refill = false; }
        if (bars.stock + 1e-9 < bars.per) return { stopT: t, reason: 'bars', partsBefore: tc.plAfter - pl, changes };
        bars.stock -= bars.per;
      }
      t += cyc; pl--; for (const x of st) x.rem--; for (let j = 0; j < cn.length; j++) cn[j]--;
    }
    return { stopT: null, endT: t, changes };
  }
  /** Sammelmeldung aus S.ghostCheck formulieren (Titel, eine Zeile Body, kompakte Empfehlung, Aktionen je Maschine) */
  function ghostCompose() {
    const G = S.ghostCheck; if (!G) return;
    const night = !cur || S.t >= G.staffEnd;
    const list = Object.values(G.machines).sort((a, b) => (a.stopT == null ? Infinity : a.stopT) - (b.stopT == null ? Infinity : b.stopT) || (a.machineId < b.machineId ? -1 : 1));
    const stops = list.filter(ghostStop), nx = tclock(G.nextStart);
    for (const e of stops) {
      const m = S.machines[e.machineId];
      e.liveState = m.state;
      if (night && m.state !== 'running' && m.state !== 'toolchange' && (WAIT_STATES[m.state] || m.state === 'fault' || S.t >= e.stopT - 600)) e.waitingSince = e.waitingSince != null ? e.waitingSince : m.since;
      else if (night && m.state === 'running') e.waitingSince = null;
    }
    const what = (e) => e.reason === 'tool' ? toolShort(e.tool) : GHOST_WHAT[e.reason] || e.reason;
    // tatsächlicher Grund, wenn eine Maschine nachts aus einem anderen Grund steht als angekündigt
    const liveWhat = (e) => {
      const st = S.machines[e.machineId].state;
      if (st === 'fault') return 'Störung';
      if (st === 'waitTool') return e.reason === 'tool' ? what(e) : 'Werkzeug';
      if (st === 'starved') return e.reason === 'bars' || e.reason === 'input' || e.reason === 'material' ? what(e) : 'Material';
      if (st === 'blocked') return 'Ausgang voll';
      return what(e);
    };
    const seg = stops.map(e => e.waitingSince != null ? `${e.machineId} steht seit ${tclock(e.waitingSince)} (${liveWhat(e)})` : `${e.machineId} ca. ${tclock(e.stopT)} (${what(e)})`)
      .concat(list.filter(e => e.reason === 'done').map(e => `${e.machineId} fertig ca. ${tclock(e.stopT)}`))
      .concat(list.filter(e => e.reason === 'ahead').map(e => `${e.machineId} Zuschnitt-Vorrat voll`));
    const thr = list.filter(e => e.reason === 'through').map(e => e.machineId);
    if (thr.length) seg.push(`läuft durch: ${thr.join(', ')}`);
    const n = list.length, k = stops.length;
    const title = k ? `Geisterschicht-Check: ${k} von ${n} autonomen Maschinen ${k === 1 ? 'stoppt' : 'stoppen'} in der Nacht` : `Geisterschicht-Check: kein vorzeitiger Stopp (${n} autonome Maschine${n === 1 ? '' : 'n'})`;
    let sugg, actions = [];
    if (!k) sugg = brief(`Standzeit, Stangen und Puffer reichen bis ${nx} bzw. Auftragsende`, 'nichts zu tun');
    else if (!night) {
      // jetzt noch erreichbare Handgriffe einzeln, „zu spät für heute“ gesammelt als erste Aufgabe der nächsten Schicht
      const recOf = (long) => {
        const pre = stops.concat(list.filter(e => e.reason === 'done')).filter(e => !e.atStart).map(e => (long && e.recShortN) || e.recShort).filter(Boolean);
        const late = stops.filter(e => e.atStart).map(e => e.recShort);
        if (late.length) pre.push(`${nx} als Erstes ${late.join(', ')}`);
        return pre.join('; ') || 'Schwesterwerkzeug oder Nachtbemannung prüfen';
      };
      const cause = `nach ${U.fmtClock(G.staffEnd)} niemand im Haus bis ${nx}`;
      const fits = (r) => `Ursache: ${cause}. Empfehlung: ${r}.`.length <= 190;
      sugg = brief(cause, fits(recOf(true)) ? recOf(true) : recOf(false));
      for (const e of stops) if (e.action && actions.length < 3) actions.push({ label: e.actionLabel || `${e.machineId} vorbereiten`, action: e.action });
    } else {
      // steht eine Maschine nachts aus einem anderen Grund als angekündigt, gilt der tatsächliche Grund
      const nightRec = (e) => {
        const st = S.machines[e.machineId].state, id = e.machineId;
        if (e.waitingSince == null) return e.recNight || id;
        if (st === 'fault' && e.reason !== 'fault') return `${id} Störung beheben`;
        if (st === 'waitTool' && e.reason !== 'tool') return `${id} Werkzeug wechseln`;
        if (st === 'starved' && !['bars', 'input', 'material'].includes(e.reason)) return `${id} Material bereitstellen`;
        if (st === 'blocked' && e.reason !== 'output') return `${id} Ausgang leeren`;
        return e.recNight || id;
      };
      const RW = { tool: 'Standzeit zu kurz', bars: 'Stangen leer', material: 'Material fehlt', input: 'Teile fehlen', output: 'Ausgang voll', fpi: 'Erstteil offen', fault: 'Störung' };
      const liveR = (e) => { if (e.waitingSince == null) return e.reason; const st = S.machines[e.machineId].state; return st === 'fault' ? 'fault' : st === 'waitTool' ? 'tool' : st === 'starved' ? (['bars', 'input', 'material'].includes(e.reason) ? e.reason : 'material') : st === 'blocked' ? 'output' : e.reason; };
      const rs = [...new Set(stops.map(e => RW[liveR(e)] || e.reason))];
      const anyTool = stops.some(e => liveR(e) === 'tool');
      const cause = `${rs.slice(0, 2).join(', ')} – niemand im Haus bis ${nx}`, first = `${nx} als Erstes ${stops.map(e => nightRec(e).replace(/\s*\([^)]*\)/g, '')).join(', ')}`;
      const full = `${first}${anyTool ? '; künftig vor Schichtende vorbeugend wenden/wechseln' : ''}`;
      sugg = brief(cause, `Ursache: ${cause}. Empfehlung: ${full}.`.length <= 190 ? full : first);
    }
    const first = stops[0] || list[0];
    actions.push({ label: 'Maschine öffnen', action: { type: 'select', kind: 'machine', id: first.machineId } });
    const nt = notify({ key: 'ghost:check', sev: k ? 'warn' : 'info', role: 'Schichtleitung', entity: { kind: 'plant', id: 'werk' }, autoResolveT: G.until,
      title, body: seg.join(' · '), suggestion: sugg, actions });
    G.notified = true;
    nt.ghost = { t: G.t, staffEnd: G.staffEnd, until: G.until, nextStart: G.nextStart, machines: list.map(e => Object.assign({}, e)) };
  }
  /** nachts: Stillstand einer im Check gemeldeten Maschine → Sammelmeldung ergänzen statt eigener Warte-Meldung */
  function ghostCovers(m) {
    const G = S.ghostCheck, e = G && G.machines[m.id];
    return !!(e && ghostStop(e) && S.t < G.until && S.t >= G.staffEnd && hasOpen('ghost:check'));
  }
  function shiftReport(old, nw) {
    const shName = (id) => (SH.find(s => s.id === id) || {}).name || 'keine Schicht';
    const st = S.shiftStats;
    const o = oeeOf(aggStats('ks'));
    const faults = Object.values(S.machines).filter(m => m.fault).map(m => m.id);
    const waiting = Object.values(S.machines).filter(m => WAIT_STATES[m.state]).map(m => m.id + ' ' + WF.STATE[m.state].label);
    const title = !old ? `Schichtbeginn ${shName(nw)}` : nw ? `Schichtwechsel: ${shName(old)} → ${shName(nw)}` : `Schichtende ${shName(old)} – Geisterschicht`;
    const ghosts = Object.values(S.machines).filter(m => m.loading === 'auto' && m.op && m.released && !m.fault).map(m => m.id);
    S.lastShiftReport = { t: S.t, from: old, to: nw, good: st.good, scrap: st.scrap, oee: o.oee, faults, waiting };
    if (old) S.lastShiftOee = { shift: old, oee: o.oee, t: S.t };
    ev('shift', 'info', { kind: 'plant', id: 'werk' }, old ? `${title} – ${shName(old)}: ${st.good} Gutteile, ${st.scrap} Ausschuss, OEE ${U.fmtPct(o.oee)}`
      : `${title} – unbemannte Geisterschicht: ${st.good} Gutteile, ${st.scrap} Ausschuss${o.oee != null ? ', OEE ' + U.fmtPct(o.oee) : ''}${waiting.length ? '; wartend: ' + waiting.slice(0, 4).join(', ') : ''}`, S.lastShiftReport);
    if (!old) return;
    notify({ key: 'shift:' + S.t, sev: 'info', role: 'Schichtleitung', entity: { kind: 'plant', id: 'werk' }, autoResolveT: S.t + 1800, title,
      body: `${shName(old)}: ${st.good} Gutteile · ${st.scrap} Ausschuss · OEE ${U.fmtPct(o.oee)}${faults.length ? ' · Störung: ' + faults.join(', ') : ''}${waiting.length ? ' · wartend: ' + waiting.slice(0, 3).join(', ') : ''}`,
      suggestion: nw ? brief('Schichtwechsel', 'offene Störungen, geplante Werkzeugwechsel und wartende Erstteile zuerst besprechen')
        : brief(`unbemannt weiter: ${ghosts.join(', ') || 'keine Maschine'}`, hasOpen('ghost:check') ? 'Stopps und erste Handgriffe siehe Geisterschicht-Check' : 'nichts zu tun') });
  }

  // ------------------------------------------------------------------ Prognose (Plantafel)
  const TYPE_GROUP = { lathe: 'turn', swiss: 'turn', biglathe: 'turn', mill5: 'mill', mill3: 'mill' };
  function workFor(m, o, i, active) {
    const r = o.routing[i], op = o.ops[i];
    const n = partsLeft(o, i);
    let setup = 0, fpi = 0;
    if (!active || !m.setupDone) setup = active && m.setupRun ? Math.max(0, m.setupRun.dur - (S.t - m.setupRun.t0)) : (r.setupMin || 0) * 60;
    if (r.firstPiece && !(active && m.released)) fpi = (m.fpiMin || 15) * 60 + 900;
    let toolAllow = 0;
    for (const t of r.tools || []) { const tt = TT[t.type]; if (tt) toolAllow += (t.cutMinPerPart / tt.lifeMin) * 300; }
    const run = n * (cycleSec(m, r) + toolAllow);
    // das eingelegte Teil läuft als Maschinenzeit weiter (auch in Pausen/nachts), Störung: Restdauer der Reparatur
    let partRem = active && m.part ? m.part.rem : 0;
    if (active && m.fault) partRem += faultRemSec(m);
    if (active && m.fpi) fpi = (m.fpiMin || 15) * 60;
    return { setup, fpi, run: run * 1.03, partRem, n: n + op.inProc };
  }
  function calEnd(m, start, w) {
    const tSetup = addWork(start + (w.partRem || 0), w.setup + w.fpi);
    if (m.loading === 'auto') return Math.max(tSetup + w.run * 1.1, addWork(tSetup, w.run * 0.75));
    return addWork(tSetup, w.run);
  }
  /** Prognose als einfache Listenplanung: aktive Arbeitsgänge belegen ihre Maschine ab jetzt; danach wird immer der
      Arbeitsgang eingeplant, der am frühesten beginnen kann (Maschine frei + erster Behälter des Vorgängers da).
      Bei Gleichstand: Eil → Termin → Auftragsnummer. Personalgebundene Arbeit nur in der Schichtzeit (addWork).
      Je Arbeitsgang wird auch der erste abgabefertige Behälter berechnet (first) – daraus ergibt sich der früheste
      Materialeingang des Nachfolgers (kein pauschaler „ganzer Behälter ab Start“). */
  function planOp(x, free, activeEnd) {
    const o = x.o, i = x.i, r = o.routing[i];
    if (r.station === 'VERSAND') { const end = Math.max(S.t, x.prevEnd) + 600; return { start: end, end, m: null, first: end }; }
    if (r.station === 'EXT') return planExt(x);
    const m = S.machines[r.station];
    if (!m) return { start: x.prevEnd, end: x.prevEnd, m: null, first: x.prevEnd };
    const op = o.ops[i];
    const active = !!(m.op && m.op.oid === o.id && m.op.idx === i);
    const w = workFor(m, o, i, active);
    const cyc = cycleSec(m, r), bq = opBatch(r);
    // Arbeitsplätze ohne Rüstaufwand (Waschen, Messraum, Montage) geben den Arbeitsgang frei, sobald der Behälter
    // abgearbeitet ist (siehe decide) → sie sind nur für die Bearbeitungszeit belegt, nicht bis der Vorgänger fertig ist.
    const releasable = releasableOp(r, i);
    // Nachlauf nach dem Vorgänger (letzter Behälter + Transport) nur, solange der Vorgänger noch Teile liefert
    const prevDone = i === 0 || o.ops[i - 1].complete;
    const tail = prevDone ? 0 : x.prevEnd + Math.min(bq, Math.max(1, w.n)) * cyc + 600;
    // Materialeingang: Teile am Platz → jetzt; Behälter abholbereit/unterwegs → ca. 10 min; sonst erster Behälter des Vorgängers
    const avail = i === 0 || waitingQty(o.id, i) > 0 ? S.t : inboundQty(o.id, i) > 0 ? S.t + 600 : x.prevFirst;
    let start, occ, end;
    if (active) { occ = activeEnd[o.id + '/' + i]; start = S.t; end = Math.max(occ, tail); }
    else {
      // wie die Disposition: gerüstet werden darf schon vor Materialeingang („Rüsten vorab“), bearbeitet erst danach
      start = Math.max(free[m.id], S.t, avail - w.setup);
      occ = Math.max(calEnd(m, start, w), calEnd(m, Math.max(start, avail), { setup: 0, fpi: w.fpi, run: w.run }));
      end = Math.max(occ, tail);
    }
    // erster abgabefertiger Behälter: offener Ausgangsbehälter + laufende Teile zählen schon mit
    const f = active ? fillingAt(m.id, o.id, i) : null;
    const toClose = Math.min(bq - (f ? f.qty : 0), Math.max(0, partsLeft(o, i)) + op.inProc);
    const need = Math.max(0, toClose - (active ? op.inProc : 0));
    const t0 = active ? addWork(S.t + (w.partRem || 0), w.setup + w.fpi) : Math.max(addWork(start, w.setup + w.fpi), avail);
    let first = (need > 0 ? (m.loading === 'auto' ? t0 + need * cyc : addWork(t0, need * cyc)) : t0) + 600;
    first = Math.min(first, end + 600);
    return { start, end, occEnd: releasable ? occ : null, m, w, active, first, batchQty: bq, cyc };
  }
  /** Fremdbearbeitung: Lose zu transferBatch Teilen (bzw. Rest), Abholung im Lieferfenster, Rückkehr nach leadMin */
  function planExt(x) {
    const o = x.o, i = x.i, r = o.routing[i], op = o.ops[i];
    const lead = ((r.ext && r.ext.leadMin) || 480) * 60, B = opBatch(r);
    let firstRet = null, lastRet = 0, waitQ = 0, waitLeave = 0, inb = 0;
    for (const cid in S.containers) {
      const c = S.containers[cid];
      if (c.orderId !== o.id || c.idx !== i) continue;
      if (c.state === 'external') { const rt = c.location.returnT; firstRet = firstRet == null ? rt : Math.min(firstRet, rt); lastRet = Math.max(lastRet, rt); }
      else if (c.state === 'input' && c.location && c.location.id === 'EXT') { waitQ += c.qty; waitLeave = Math.max(waitLeave, c.leaveT || S.t); }
      else if (c.state === 'ready' || c.state === 'transit') inb += c.qty;
    }
    const R = Math.max(0, opTargetIn(o, i) - op.good - op.scrap - op.inProc); // noch zu versenden (wartend, unterwegs, beim Vorgänger)
    const retOf = (ship) => nextDayWindow(nextDayWindow(Math.max(S.t, ship)) + lead);
    // Zeitpunkt, zu dem der Vorgänger q weitere Teile abgeliefert hat (Behälter für Behälter)
    const pb = Math.max(1, x.prevBatchQty || B), pc = x.prevCyc || 0;
    const delivT = (q) => q <= 0 ? S.t : Math.min(Math.max(x.prevFirst, x.prevEnd + 600), x.prevFirst + Math.max(0, Math.ceil(q / pb) - 1) * pb * pc);
    let shipNext = null, shipLast = null;
    if (R > 0) {
      const lot = Math.min(B, R), have = waitQ + inb;
      shipNext = Math.max(waitLeave, have >= lot ? S.t + (have > waitQ ? 600 + CFG.extHandoverSec : 0) : delivT(lot - have) + CFG.extHandoverSec);
      shipLast = R > lot ? Math.max(shipNext, x.prevEnd + 600 + CFG.extHandoverSec) : shipNext;
      const r1 = retOf(shipNext);
      firstRet = firstRet == null ? r1 : Math.min(firstRet, r1);
      lastRet = Math.max(lastRet, retOf(shipLast));
    }
    if (firstRet == null) firstRet = S.t;
    const end = Math.max(lastRet, S.t);
    // läuft die Fremdbearbeitung schon (Teile beim Partner/zurück), wird der Folge-Arbeitsgang sofort mit eingeplant –
    // dort wartende Teile dürfen nicht hinter später eintreffenden Aufträgen anderer Kunden landen
    const succStart = Math.min(firstRet, end);
    return { start: op.received > 0 ? S.t : succStart, succStart, end, m: null, first: succStart + 900, ext: true,
      shipNext, shipLast, firstRet: op.inProc > 0 || R > 0 ? firstRet : null, lastRet: end, lotQty: Math.min(B, R || B) };
  }
  /** Prognose (gecacht): neu berechnet, wenn sich der Plan geändert hat (Plan-Version) oder der Stand älter als maxAge s ist */
  function forecast(maxAge) {
    if (FC && FC.v === PV && S.t - FC.t < (maxAge || 60)) return FC.data;
    return computeForecast();
  }
  function computeForecast() {
    const res = computeForecastRaw();
    applyPub(res);
    FC = { t: S.t, v: PV, data: res };
    return res;
  }
  /** Prognose ohne Glättung und ohne Cache (reine Funktion des Zustands) – Basis für Prognose und Was-wäre-wenn */
  function computeForecastRaw() {
    const res = { t: S.t, machines: {}, orders: {} };
    const free = {}, activeEnd = {};
    for (const id in S.machines) { res.machines[id] = []; free[id] = S.t; }
    for (const id in S.machines) {
      const m = S.machines[id]; if (!m.op) continue;
      const o = S.orders[m.op.oid];
      const end = calEnd(m, S.t, workFor(m, o, m.op.idx, true));
      activeEnd[o.id + '/' + m.op.idx] = end; free[id] = end;
    }
    const st = [];
    for (const id in S.orders) {
      const o = S.orders[id]; if (o.status === 'fertig') continue;
      let i = 0; while (i < o.ops.length && o.ops[i].complete) i++;
      st.push({ o, i, i0: i, prevStart: S.t, prevEnd: S.t, prevFirst: S.t, prevBatchQty: 1, prevCyc: 0, bottleneck: null, bottleneckStation: null, worst: -1, ops: [], key: [o.priority === 'eil' ? 0 : 1, o.due, o.id] });
    }
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, bp = null;
      for (const x of st) {
        if (x.i >= x.o.ops.length) continue;
        // Plan zwischenspeichern, solange sich weder der Auftrag noch die Belegung seiner Maschine geändert hat
        const sid = x.o.routing[x.i].station;
        if (!x.plan || (free[sid] !== undefined && free[sid] !== x.planFree)) { x.plan = planOp(x, free, activeEnd); x.planFree = free[sid]; }
        const p = x.plan;
        if (!best || p.start < bp.start - 1 || (Math.abs(p.start - bp.start) <= 1 && cmpKey(x.key, best.key) < 0)) { best = x; bp = p; }
      }
      if (!best) break;
      const r = best.o.routing[best.i];
      const rec = { seq: r.seq, station: r.station, start: Math.round(bp.start), end: Math.round(bp.end), first: Math.round(bp.first) };
      if (bp.m) {
        const occ = bp.occEnd != null ? bp.occEnd : bp.end;
        free[bp.m.id] = Math.max(free[bp.m.id], occ);
        rec.busyStart = rec.start; rec.busyEnd = Math.round(occ); rec.setupEnd = Math.round(addWork(bp.start, bp.w.setup)); rec.active = bp.active;
        res.machines[bp.m.id].push({ orderId: best.o.id, seq: r.seq, op: r.op, start: rec.start, end: rec.busyEnd, opEnd: rec.end, setupEnd: rec.setupEnd, active: bp.active, kind: 'run' });
      } else if (bp.ext) {
        rec.start = Math.round(bp.shipNext != null && best.o.ops[best.i].received === 0 ? bp.shipNext : Math.min(S.t, bp.start));
        rec.shipNext = bp.shipNext != null ? Math.round(bp.shipNext) : null; rec.shipLast = bp.shipLast != null ? Math.round(bp.shipLast) : null;
        rec.firstReturn = bp.firstRet != null ? Math.round(bp.firstRet) : null; rec.lastReturn = Math.round(bp.lastRet); rec.lotQty = bp.lotQty;
      }
      best.ops[best.i] = rec;
      best.prevStart = bp.succStart != null ? bp.succStart : bp.start; best.prevEnd = bp.end; best.prevFirst = bp.first;
      best.prevBatchQty = bp.batchQty || 1; best.prevCyc = bp.cyc || 0;
      best.i++; best.plan = null;
      if (best.i >= best.o.ops.length) res.orders[best.o.id] = { eta: Math.round(bp.end), late: bp.end > best.o.due, slackSec: Math.round(best.o.due - bp.end), bottleneck: best.bottleneck, bottleneckStation: best.bottleneckStation || null, bottleneckSeq: best.bottleneckSeq != null ? best.bottleneckSeq : null, bottleneckSec: best.bottleneckSec || null, ops: best.ops };
    }
    for (const id in S.orders) { const o = S.orders[id]; if (o.status === 'fertig') res.orders[id] = { eta: o.doneT, late: o.doneT > o.due, slackSec: o.due - o.doneT, done: true, ops: [], bottleneck: null, bottleneckStation: null }; }
    for (const id in res.machines) res.machines[id].sort((a, b) => a.start - b.start);
    for (const id in res.orders) res.orders[id].etaRaw = res.orders[id].eta;
    // Verzugs-Zerlegung je Auftrag – daraus begrenzender Arbeitsgang (ohne Zeit außerhalb der Schicht) und Ursache
    for (const id in res.orders) { const f = res.orders[id]; if (!f.done && S.orders[id]) applyBreakdown(S.orders[id], f, res); }
    return res;
  }
  /** Zerlegung der Restdurchlaufzeit (jetzt → Prognose) entlang der Arbeitsgänge: das Intervall zwischen der Fertigstellung
      des Vorgängers und der eigenen Fertigstellung gehört dem Arbeitsgang und wird aufgeteilt in
      queue (Maschine durch andere Aufträge belegt – blockingOrders), process (Rüsten, Erstteil, Bearbeitung),
      noShift (außerhalb der Schicht, nur personalgebundene Maschinen), ext (Fremdbearbeitung), fault (laufende Störung),
      tool (wartet auf Werkzeug), material (Rohmaterial fehlt). Summe = Prognose − jetzt. */
  function delayBreakdown(o, f, fc) {
    const out = [];
    if (!f || f.done || !f.ops) return out;
    const add = (kind, sid, seq, sec, blk) => {
      if (!(sec >= 30)) return;
      let e = out.find(x => x.kind === kind && x.stationId === sid && x.seq === seq);
      if (!e) out.push(e = { kind, stationId: sid, seq, sec: 0, blockingOrders: [], text: '' });
      e.sec += sec; if (blk) for (const b of blk) if (!e.blockingOrders.includes(b)) e.blockingOrders.push(b);
    };
    let a = S.t;
    for (let i = 0; i < o.ops.length; i++) {
      const x = f.ops[i]; if (!x || x.end == null) continue;
      const r = o.routing[i], sid = r.station, b = Math.max(a, x.end);
      if (b <= a) continue;
      const m = S.machines[sid];
      if (sid === 'EXT') { add('ext', sid, r.seq, b - a); a = b; continue; }
      if (!m) { add('process', sid, r.seq, b - a); a = b; continue; }
      const off = (p, q) => (m.loading === 'auto' ? 0 : offShiftSec(p, q));
      const s0 = Math.min(b, Math.max(a, x.busyStart != null ? x.busyStart : x.start));
      if (s0 > a) {
        const blk = [];
        for (const e of fc.machines[sid] || []) if (e.orderId !== o.id && e.end > a && e.start < s0 && !blk.includes(e.orderId)) blk.push(e.orderId);
        const ns = off(a, s0);
        add('queue', sid, r.seq, s0 - a - ns, blk); add('noShift', sid, r.seq, ns);
      }
      let rest = b - s0;
      const ns2 = off(s0, b); add('noShift', sid, r.seq, ns2); rest -= ns2;
      if (x.active) {
        if (m.fault) { const fs = Math.min(rest, faultRemSec(m)); add('fault', sid, r.seq, fs); rest -= fs; }
        else if (m.state === 'waitTool') { const ts = Math.min(rest, cur ? 300 : 0); add('tool', sid, r.seq, ts); rest -= ts; }
        else if (m.state === 'starved' && /Rohmaterial|Stangenmagazin leer und kein/.test(m.cause) && r.material) {
          const pu = S.purchases.filter(q => q.status === 'bestellt' && q.materialId === r.material.id).sort((p, q) => p.etaT - q.etaT)[0];
          const ms = Math.min(rest, pu ? Math.max(0, pu.etaT - S.t) : rest * 0.5); add('material', sid, r.seq, ms); rest -= ms;
        }
      }
      add('process', sid, r.seq, rest);
      a = b;
    }
    const hm = (sec) => durShort(sec);
    for (const e of out) {
      const r = o.routing.find(y => y.seq === e.seq) || {}, nm0 = e.stationId === 'EXT' ? shortName((r.ext && r.ext.partner) || 'Fremdbearbeiter') : `${e.stationId} ${stShort(e.stationId)}`;
      e.sec = Math.round(e.sec);
      e.text = e.kind === 'queue' ? `Warten an ${nm0} (${hm(e.sec)}${e.blockingOrders.length ? ', hinter ' + e.blockingOrders.slice(0, 2).join('/') : ''})`
        : e.kind === 'ext' ? `${(r.ext && r.ext.process) || r.op || 'Fremdbearbeitung'} bei ${nm0} (${hm(e.sec)})`
        : e.kind === 'noShift' ? `außerhalb der Schicht an ${nm0} (${hm(e.sec)})`
        : e.kind === 'fault' ? `Störung ${nm0} (${hm(e.sec)})`
        : e.kind === 'tool' ? `Werkzeug ${nm0} (${hm(e.sec)})`
        : e.kind === 'material' ? `Material für ${nm0} (${hm(e.sec)})`
        : `Bearbeitung ${nm0} AG ${e.seq} (${hm(e.sec)})`;
    }
    return out.sort((p, q) => q.sec - p.sec || (p.seq - q.seq));
  }
  /** Dauer grob für Ursachen-Texte: 45 min · 19 h · 1 T 3 h */
  function durShort(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + ' min';
    const h = Math.round(sec / 3600);
    return h < 24 ? h + ' h' : Math.floor(h / 24) + ' T' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
  }
  const DELAY_KINDS = { queue: 1, ext: 1, fault: 1, tool: 1, material: 1 };
  /** Prognose-Eintrag ergänzen: delay (Zerlegung), limit (größter Verzugs-Beitrag → „begrenzt durch“), delayCause
      (≤ 2 Beiträge) und bottleneckStation (Maschine mit größter Warte- + Arbeitszeit, ohne Zeit außerhalb der Schicht) */
  function applyBreakdown(o, f, fc) {
    const d = delayBreakdown(o, f, fc);
    f.delay = d;
    // Beiträge je Station zusammenfassen (Warten an derselben Maschine in mehreren Abschnitten)
    const by = {};
    for (const e of d) if (DELAY_KINDS[e.kind]) { const k = e.kind + '|' + e.stationId; const g = by[k] || (by[k] = { kind: e.kind, stationId: e.stationId, seq: e.seq, sec: 0, blockingOrders: [], first: e }); g.sec += e.sec; for (const b of e.blockingOrders) if (!g.blockingOrders.includes(b)) g.blockingOrders.push(b); }
    const contrib = Object.values(by).filter(g => g.sec >= 900).sort((p, q) => q.sec - p.sec || (p.seq - q.seq));
    // Maschinen-Engpass des Auftrags: Arbeitszeit + Warten je Maschine (Zeit außerhalb der Schicht zählt nicht)
    const per = {};
    for (const e of d) if ((e.kind === 'queue' || e.kind === 'process' || e.kind === 'fault' || e.kind === 'tool' || e.kind === 'material') && S.machines[e.stationId]) { const k = e.stationId + '|' + e.seq; per[k] = per[k] || { stationId: e.stationId, seq: e.seq, sec: 0 }; per[k].sec += e.sec; }
    const top = Object.values(per).sort((p, q) => q.sec - p.sec || (p.seq - q.seq))[0] || null;
    if (top) {
      const r = o.routing.find(y => y.seq === top.seq) || {}, m = S.machines[top.stationId];
      f.bottleneck = `${m.id} ${m.short} (AG ${top.seq} „${r.op}“)`; f.bottleneckStation = m.id; f.bottleneckSeq = top.seq; f.bottleneckSec = Math.round(top.sec);
    }
    const lim = contrib[0] || (top ? { kind: 'process', stationId: top.stationId, seq: top.seq, sec: top.sec, blockingOrders: [] } : null);
    const limName = (g) => { const r = o.routing.find(y => y.seq === g.seq) || {}; return g.stationId === 'EXT' ? shortName((r.ext && r.ext.partner) || 'Fremdbearbeiter') : `${g.stationId} ${stShort(g.stationId)}`; };
    f.limit = lim ? { kind: lim.kind, stationId: lim.stationId, seq: lim.seq, name: limName(lim), sec: Math.round(lim.sec), blockingOrders: lim.blockingOrders.slice(0, 4) } : null;
    f.delayCause = contrib.length ? contribText(o, contrib.slice(0, 2)) : null;
    f.delayCause1 = contrib.length ? contribText(o, contrib.slice(0, 1)) : null;   // Kurzform (ein Beitrag) für knappe Karten
  }
  /** „Wartezeiten an M08 Liebherr LC 180 (19 h, hinter FA-24125/FA-24130) und Härterei Wolf (1 T)“ */
  function contribText(o, list) {
    const q = list.filter(g => g.kind === 'queue'), parts = [];
    const nmOf = (g) => { const r = o.routing.find(y => y.seq === g.seq) || {}; return g.stationId === 'EXT' ? shortName((r.ext && r.ext.partner) || 'Fremdbearbeiter') : `${g.stationId} ${stShort(g.stationId)}`; };
    const one = (g) => `${nmOf(g)} (${durShort(g.sec)}${g.kind === 'queue' && g.blockingOrders.length ? ', hinter ' + g.blockingOrders.slice(0, 2).join('/') : ''})`;
    for (const g of list) {
      if (g.kind === 'queue') { if (g === q[0]) parts.push(`Wartezeit${q.length > 1 ? 'en' : ''} an ${q.map(one).join(' und ')}`); }
      else if (g.kind === 'ext') { const r = o.routing.find(y => y.seq === g.seq) || {}; parts.push(`${(r.ext && r.ext.process) || r.op || 'Fremdbearbeitung'} bei ${one(g)}`); }
      else if (g.kind === 'fault') parts.push(`Störung an ${one(g)}`);
      else if (g.kind === 'tool') parts.push(`Werkzeug an ${one(g)}`);
      else if (g.kind === 'material') parts.push(`Material für ${one(g)}`);
    }
    return parts.join(' und ');
  }

  // ------------------------------------------------------------------ Was-wäre-wenn (eine Rechnung für Meldungen, UI und KI)
  /** Prognose auf einem vorübergehend geänderten Plan (Priorität bzw. Station eines Arbeitsgangs) – vorher/nachher je
      offenem Auftrag. Der Zustand wird danach exakt wiederhergestellt (keine Caches, keine Ereignisse). */
  let RAWC = null;
  /** ungeglättete Prognose „jetzt“: die eben berechnete Prognose (etaRaw) wiederverwenden, sonst neu rechnen */
  function rawNow() {
    if (FC && FC.v === PV && FC.t === S.t) return FC.data;
    if (!RAWC || RAWC.v !== PV || RAWC.t !== S.t) RAWC = { v: PV, t: S.t, data: computeForecastRaw() };
    return RAWC.data;
  }
  function whatIf(spec) {
    if (!spec || !spec.type) return fail('Was-wäre-wenn: Art fehlt (setPriority | moveOp)');
    const o = S.orders[spec.orderId]; if (!o) return fail('Auftrag unbekannt: ' + spec.orderId);
    if (o.status === 'fertig') return fail(`${o.id} ist bereits fertig`);
    const before = rawNow();
    const undo = [];
    let after = null;
    try {
      if (spec.type === 'setPriority') {
        const pr = spec.priority || 'eil';
        if (pr !== 'eil' && pr !== 'normal') return fail("Priorität muss 'eil' oder 'normal' sein");
        if (o.priority === pr) return fail(`${o.id} hat bereits Priorität ${pr}`);
        const old = o.priority; o.priority = pr; undo.push(() => { o.priority = old; });
      } else if (spec.type === 'moveOp') {
        const chk = moveOpCheck(o.id, spec.seq, spec.stationId);
        if (chk.msg) return fail(chk.msg);
        const { i, from } = chk, r = o.routing[i], op = o.ops[i], oldSt = r.station;
        r.station = spec.stationId; op.station = spec.stationId;
        undo.push(() => { r.station = oldSt; op.station = oldSt; });
        if (from.op && from.op.oid === o.id && from.op.idx === i) { const keep = from.op; from.op = null; undo.push(() => { from.op = keep; }); }
      } else return fail('Was-wäre-wenn: unbekannte Art ' + spec.type);
      after = computeForecastRaw();
    } finally { for (let k = undo.length - 1; k >= 0; k--) undo[k](); }
    const rows = [];
    for (const id in S.orders) {
      const x = S.orders[id]; if (x.status === 'fertig') continue;
      const b = before.orders[id], a = after.orders[id]; if (!b || !a) continue;
      const be = b.etaRaw != null ? b.etaRaw : b.eta;   // beide Seiten ungeglättet vergleichen
      rows.push({ orderId: id, due: x.due, before: be, after: a.eta, deltaSec: a.eta - be, lateBefore: be > x.due, lateAfter: a.eta > x.due,
        slackBefore: x.due - be, slackAfter: x.due - a.eta, riskAfter: riskOf(x, a.eta) });
    }
    const target = rows.find(r => r.orderId === o.id) || null;
    const others = rows.filter(r => r.orderId !== o.id);
    const affected = others.filter(r => Math.abs(r.deltaSec) >= 300).sort((p, q) => q.deltaSec - p.deltaSec);
    const newlyLate = others.filter(r => r.lateAfter && !r.lateBefore);
    const laterLate = others.filter(r => r.lateBefore && r.deltaSec > 300);   // schon späte Aufträge dürfen nicht noch später werden
    const gainSec = target ? target.before - target.after : 0;
    const recommend = !!target && gainSec >= 900 && !newlyLate.length && !laterLate.length;
    const hh = (t) => U.fmtDayClock(t);
    const sideTxt = newlyLate.concat(laterLate).slice(0, 3).map(r => `${r.orderId} dadurch ${hh(r.after)} – ${U.fmtDur(r.after - r.due)} zu spät`).join('; ');
    const what = spec.type === 'setPriority' ? (spec.priority || 'eil') === 'eil' ? 'Als Eilauftrag' : 'Normale Priorität' : `AG ${spec.seq} auf ${spec.stationId}`;
    const text = !target ? `${what}: keine Prognose für ${o.id}` :
      (Math.abs(gainSec) < 60 ? `${what}: keine spürbare Änderung für ${o.id} (fertig ca. ${hh(target.after)})`
        : `${what}: ${o.id} fertig ca. ${hh(target.after)} statt ${hh(target.before)} (${gainSec >= 0 ? '−' : '+'}${U.fmtDur(Math.abs(gainSec))})`) +
      (sideTxt ? `; ${sideTxt}` : affected.length ? `; ${affected.length} ${affected.length === 1 ? 'Auftrag verschiebt' : 'Aufträge verschieben'} sich, keiner wird spät` : '; andere Aufträge unverändert');
    return { ok: true, spec: Object.assign({}, spec), orderId: o.id, target, affected, newlyLate: newlyLate.map(r => r.orderId), laterLate: laterLate.map(r => r.orderId), gainSec, recommend, text };
  }
  const whatIfPriority = (orderId, priority) => whatIf({ type: 'setPriority', orderId, priority: priority || 'eil' });
  /** Empfehlung zu einem Auftrag – EINE Quelle für „Termin gefährdet“, Leitstand und KI (WF.sim.orderAdvice):
      Ursache aus der Prognose (begrenzender Arbeitsgang – „Werks-Engpass“ nur, wenn er der Engpass laut bottleneck() ist –,
      Fremdbearbeitung, Rohmaterial); „Als Eilauftrag“ nur, wenn die
      Was-wäre-wenn-Rechnung einen Gewinn zeigt und kein anderer Auftrag dadurch spät (bzw. noch später) wird; sonst
      Verlagern (nur wenn eine gleichwertige Maschine existiert, frei von Störung und nicht selbst der Engpass), Überstunden
      am Engpass, Expressdurchlauf beim Fremdbearbeiter, Teillieferung. Ohne erkennbare Ursache: neutraler Text. */
  function orderAdvice(orderId) {
    const o = S.orders[orderId]; if (!o) return null;
    const open = { label: 'Auftrag öffnen', action: { type: 'select', kind: 'order', id: o.id } };
    if (o.status === 'fertig') return { orderId: o.id, risk: riskOf(o, o.doneT), lateSec: o.doneT - o.due, eta: o.doneT, due: o.due, cause: 'Auftrag fertig', causeKind: 'done', bottleneckStation: null,
      text: `${o.id} ist fertig (${o.shippedQty}/${o.qty} Stk).`, detail: `${o.id} ist fertig (${o.shippedQty}/${o.qty} Stk, ${U.fmtDayClock(o.doneT)}).`, action: null, actionLabel: null, actions: [open], alternatives: [], sideEffects: [], whatIf: null };
    const fc = forecast(), f = fc.orders[o.id] || {}, eta = f.eta != null ? f.eta : null;
    const lateSec = eta != null ? eta - o.due : null, risk = riskOf(o, eta);
    // Ursache: Rohmaterial fehlt im 1. Arbeitsgang, längster Abschnitt in der Fremdbearbeitung, sonst Engpass-Arbeitsgang
    let cause = null, causeKind = null, ext = null;
    const r0 = o.routing[0], op0 = o.ops[0], m0 = S.machines[r0.station];
    if (!op0.complete && r0.material && m0 && m0.op && m0.op.oid === o.id && m0.state === 'starved' && /Rohmaterial|Lager|Stangen/.test(m0.cause)) {
      causeKind = 'material'; cause = `Rohmaterial ${S.materials[r0.material.id].name} fehlt an ${r0.station}`;
    }
    // sonst aus der Verzugs-Zerlegung (eine Wahrheit für Meldung, Leitstand, Aufträge, KI): ≤ 2 größte Beiträge
    const delay = f.delay || [], lim = f.limit || null;
    { const xe = delay.find(e => e.kind === 'ext' && e.sec >= 900); if (xe) ext = o.routing.find(y => y.seq === xe.seq) || null; }
    if (!cause && f.delayCause && lim) { causeKind = lim.kind; cause = f.delayCause; }
    const bnId = f.bottleneckStation || null, bnTxt = bnId ? `${bnId} ${stShort(bnId)}` : null;
    const plantB = bnId ? bottleneck() : null, isPlant = !!(plantB && plantB.stationId === bnId);
    if (!cause && bnId) { causeKind = 'bottleneck'; cause = (isPlant ? '' : 'Durchlauf ') + limitTxt(f, plantB ? plantB.stationId : null); }
    const lateTxt = lateSec == null ? 'keine Prognose' : lateSec > 0 ? `Prognose ${U.fmtDayClock(eta)}, ${U.fmtDur(lateSec)} nach Termin ${U.fmtDayClock(o.due)}` : `Prognose ${U.fmtDayClock(eta)}, Puffer ${U.fmtDur(-lateSec)} bis Termin ${U.fmtDayClock(o.due)}`;
    const alternatives = [];
    // 1) Eilauftrag (Was-wäre-wenn)
    let w = null, prioOk = false;
    if (o.priority !== 'eil') {
      w = whatIfPriority(o.id, 'eil');
      prioOk = !!(w.ok && w.recommend);
      alternatives.push({ kind: 'priority', label: 'Als Eilauftrag', ok: prioOk, gainSec: w.ok ? w.gainSec : 0, text: w.ok ? w.text : w.msg,
        action: prioOk ? { type: 'setPriority', orderId: o.id, priority: 'eil' } : null });
    }
    const sideEffects = w && w.ok ? w.affected.filter(r => r.deltaSec >= 300).map(r => ({ orderId: r.orderId, beforeT: r.before, afterT: r.after, lateBy: Math.max(0, r.after - r.due) })) : [];
    // 2) Verlagern – nur auf eine gleichwertige Maschine (gleiche Gruppe + Leistungsgrenzen), die nicht selbst gestört bzw. der Engpass ist
    let move = null;
    if (bnId && f.bottleneckSeq != null && S.machines[bnId] && S.machines[bnId].kind === 'machine') {
      const fromM = S.machines[bnId];
      for (const m2 of MA) {
        if (m2.id === bnId || m2.kind !== 'machine' || !compatible(fromM.type, m2.type) || m2.fault) continue;
        if (moveOpCheck(o.id, f.bottleneckSeq, m2.id).msg) continue;
        const wm = whatIf({ type: 'moveOp', orderId: o.id, seq: f.bottleneckSeq, stationId: m2.id });
        const okM = !!(wm.ok && wm.recommend);
        alternatives.push({ kind: 'moveOp', label: `AG ${f.bottleneckSeq} auf ${m2.id} verlagern`, ok: okM, gainSec: wm.ok ? wm.gainSec : 0, text: wm.ok ? wm.text : wm.msg,
          action: okM ? { type: 'moveOp', orderId: o.id, seq: f.bottleneckSeq, stationId: m2.id } : null });
        if (okM && (!move || wm.gainSec > move.gainSec)) move = { to: m2.id, gainSec: wm.gainSec, text: wm.text };
      }
    }
    // 3) Überstunden am Engpass, Expressdurchlauf (Fremdbearbeitung), Teillieferung – immer konkret benannt
    if (bnTxt && causeKind !== 'ext') alternatives.push({ kind: 'overtime', label: `Überstunden an ${bnId}`, ok: true, text: `Überstunden/Zusatzschicht ${isPlant ? 'am Werks-Engpass ' : 'an '}${bnTxt}${lateSec > 0 ? ' (ca. ' + U.fmtDur(lateSec) + ' fehlen)' : ''}`, action: null });
    if (ext) alternatives.push({ kind: 'express', label: 'Expressdurchlauf anfragen', ok: true, text: `Expressdurchlauf bei ${shortName((ext.ext && ext.ext.partner) || 'dem Fremdbearbeiter')} anfragen (${(ext.ext && ext.ext.process) || ext.op})`, action: null });
    if (causeKind === 'material') alternatives.push({ kind: 'material', label: 'Liefertermin klären', ok: true, text: `Liefertermin ${S.materials[r0.material.id].name} beim Lieferanten beschleunigen`, action: null });
    alternatives.push({ kind: 'partial', label: 'Teillieferung abstimmen', ok: true, text: `Teillieferung mit ${shortName(o.customer)} abstimmen`, action: null });
    // Hauptaktion und Text
    // text = kompakt (Meldung, Leitstand-Karte): „Ursache: … Empfehlung: <eine Hauptmaßnahme>.“ – Details in detail/alternatives
    let action = null, text, primary, pKind = null;
    const sideTxt = w && w.ok && (w.newlyLate.length || w.laterLate.length) ? w.text.split('; ').slice(1).join('; ') : '';
    const why = o.priority === 'eil' ? 'Auftrag ist bereits Eilauftrag.' : !w || !w.ok ? '' : prioOk ? '' : sideTxt ? `Ein Eilauftrag würde den Verzug nur verschieben (${sideTxt}).`
      : w.gainSec < 60 ? `Ein Eilauftrag bringt nichts – vor ${o.id} liegt nur bereits laufende bzw. ohnehin früher fertige Arbeit.` : w.gainSec < 900 ? `Ein Eilauftrag bringt kaum etwas (nur ${U.fmtDur(w.gainSec)} früher).` : '';
    const pa = alternatives.find(a => a.kind === 'priority'); if (pa) pa.note = why || null;
    const etaOf = (t) => t && t.target ? U.fmtDayClock(t.target.after) : null;
    if (prioOk) { action = { type: 'setPriority', orderId: o.id, priority: 'eil' }; pKind = 'priority'; primary = `Als Eilauftrag kennzeichnen (fertig ca. ${etaOf(w)}, kein anderer Auftrag wird spät)`; }
    else if (move) { action = { type: 'moveOp', orderId: o.id, seq: f.bottleneckSeq, stationId: move.to }; pKind = 'moveOp'; primary = `AG ${f.bottleneckSeq} auf ${move.to} ${stShort(move.to)} verlagern`; }
    else if (causeKind === 'ext' && ext) { pKind = 'express'; primary = `Expressdurchlauf bei ${shortName((ext.ext && ext.ext.partner) || 'dem Fremdbearbeiter')} anfragen`; }
    else if (causeKind === 'material') { pKind = 'material'; primary = `Liefertermin ${S.materials[r0.material.id].name} beschleunigen`; }
    else if (bnTxt && lateSec != null && lateSec <= 0) { pKind = 'overtime'; primary = `${isPlant ? 'Werks-Engpass ' : ''}${bnTxt} ohne Unterbrechung laufen lassen`; }
    else if (bnTxt && lateSec != null && lateSec <= 8 * 3600) { pKind = 'overtime'; primary = `Überstunden ${isPlant ? 'am Werks-Engpass ' : 'an '}${bnTxt} einplanen`; }
    else if (bnTxt) { pKind = 'partial'; primary = `Teillieferung mit ${shortName(o.customer)} abstimmen`; }
    if (!cause || !primary) text = `Ursache: ${cause || lateTxt} – Optionen im Copilot prüfen.`;
    else text = `Ursache: ${cause}. Empfehlung: ${primary}.`;
    // Karte kompakt (≤ ca. 180 Zeichen): erst auf den größten Beitrag kürzen, dann Klammerzusatz der Empfehlung weglassen
    if (text.length > 180 && f.delayCause1 && cause === f.delayCause) text = primary ? `Ursache: ${f.delayCause1}. Empfehlung: ${primary}.` : `Ursache: ${f.delayCause1} – Optionen im Copilot prüfen.`;
    if (text.length > 180 && primary) text = text.replace(/ \([^()]*\)\.$/, '.');
    const others = alternatives.filter(a => a.ok && a.kind !== 'priority' && a.kind !== pKind).map(a => a.text);
    const detail = `${lateTxt}. Ursache: ${cause || 'nicht eindeutig'}. ${why ? why + ' ' : ''}${w && w.ok ? 'Was-wäre-wenn Eilauftrag: ' + w.text + '. ' : ''}${primary ? 'Empfehlung: ' + primary + '. ' : ''}${others.length ? 'Weitere Optionen: ' + others.join('; ') + '.' : ''}`.trim();
    const label = action ? (action.type === 'setPriority' ? 'Als Eilauftrag' : `AG ${action.seq} auf ${action.stationId} verlagern`) : null;
    return { orderId: o.id, risk, lateSec, eta, due: o.due, cause: cause || lateTxt, causeKind, bottleneckStation: bnId, limit: lim, limitText: limitTxt(f, plantB ? plantB.stationId : null),
      delayBreakdown: delay.map(e => Object.assign({}, e, { blockingOrders: e.blockingOrders.slice() })), text, detail, primaryKind: pKind, action, actionLabel: label,
      actions: action ? [{ label, action }, open] : [open], alternatives, sideEffects,
      whatIf: w && w.ok ? { recommend: w.recommend, gainSec: w.gainSec, newlyLate: w.newlyLate, laterLate: w.laterLate, text: w.text } : null };
  }

  /** stabile (veröffentlichte) Prognose eintragen – eine Wahrheit für Auftragsliste, KPI, KI und Terminwarnung */
  function applyPub(res) {
    for (const id in res.orders) {
      const f = res.orders[id], pub = S.etaPub[id], o = S.orders[id];
      if (f.done || !pub || pub.eta < S.t + 60) { f.etaStable = !f.done && !!pub; continue; }
      f.eta = pub.eta; f.late = pub.eta > o.due; f.slackSec = Math.round(o.due - pub.eta); f.etaPending = pub.cand; f.etaStable = true;
    }
  }
  /** Veröffentlichte Liefertermin-Prognose glätten (alle 5 min, deterministisch): kleine Änderungen (≤ 15 min) sofort,
      große Sprünge erst, wenn die nächste Berechnung sie bestätigt (verhindert Hin- und Herspringen an Schichtgrenzen). */
  function publishEta(fc) {
    for (const id in S.orders) {
      const o = S.orders[id], f = fc.orders[id];
      if (o.status === 'fertig') { delete S.etaPub[id]; continue; }
      if (!f) continue;
      const raw = f.etaRaw != null ? f.etaRaw : f.eta;
      const pub = S.etaPub[id];
      if (!pub || pub.eta < S.t + 60 || Math.abs(raw - pub.eta) <= 900) S.etaPub[id] = { eta: raw, cand: null, t: S.t };
      else if (pub.cand != null && Math.abs(raw - pub.cand) <= 1800) S.etaPub[id] = { eta: raw, cand: null, t: S.t };
      else pub.cand = raw;
    }
  }

  /** Werks-Engpass (Station) – für „Werks-Engpass …“ statt „begrenzt durch …“ (je Prognosestand zwischengespeichert) */
  let PBC = null;
  function plantBnId() {
    const fc = forecast();
    if (PBC && PBC.fc === fc) return PBC.id;
    const b = bottleneck(); PBC = { fc, id: b ? b.stationId : null };
    return PBC.id;
  }
  /** begrenzender Arbeitsgang eines Auftrags – „Engpass“ heißt nur der Werks-Engpass (bottleneck()) */
  function limitTxt(f, plantId) {
    // größter Verzugs-Beitrag (delayBreakdown) – Fremdbearbeiter beim Namen; sonst begrenzende Maschine
    const L = f && f.limit;
    const sid = L ? L.stationId : f && f.bottleneckStation; if (!sid) return null;
    const seq = L ? L.seq : f.bottleneckSeq, ag = seq != null ? ' (AG ' + seq + ')' : '';
    if (sid === 'EXT') return `begrenzt durch ${(L && L.name) || 'Fremdbearbeitung'}${ag}`;
    if (!S.machines[sid]) return `begrenzt durch ${stShort(sid)}${ag}`;
    return sid === plantId ? `Werks-Engpass ${sid} ${stShort(sid)}${ag}` : `begrenzt durch ${sid} ${stShort(sid)}${ag}`;
  }
  /** Terminrisiko – eine Definition für Auftragsliste, KI und Engpass: spät (Prognose nach Termin bzw. fertig mit
      Fehlmenge), knapp (< 4 h Puffer), ok, unbekannt (keine Prognose) */
  function riskOf(o, eta) {
    if (eta == null) return 'unbekannt';
    const slack = o.due - eta;
    if (o.status === 'fertig') return slack < 0 || o.shippedQty < o.qty ? 'spät' : 'ok';
    return slack < 0 ? 'spät' : slack < 4 * 3600 ? 'knapp' : 'ok';
  }
  /** Arbeitsvorrat je Station in Sekunden: Rüsten + Bearbeitung (inkl. Einlegen, Werkzeugwechsel-Zuschlag) + Rest des
      laufenden Teils bzw. der Störung – für alle offenen Arbeitsgänge (auch solche, deren Teile noch beim Vorgänger sind) */
  let WCC = null;
  function workContent() {
    if (WCC && WCC.t === S.t && WCC.v === PV) return WCC;
    const w = {}, n = {};
    for (let j = 0; j < MA.length; j++) { w[MA[j].id] = 0; n[MA[j].id] = 0; }
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status === 'fertig') continue;
      for (let i = 0; i < o.routing.length; i++) {
        const m = S.machines[o.routing[i].station];
        if (!m || o.ops[i].complete) continue;
        const active = !!(m.op && m.op.oid === oid && m.op.idx === i);
        const x = workFor(m, o, i, active);
        if (!active && x.n <= 0) continue;
        w[m.id] += x.setup + x.run + x.partRem; n[m.id]++;
      }
    }
    WCC = { t: S.t, v: PV, w, n };
    return WCC;
  }
  /** Schichtzeit (ohne Pausen) eines Werktags in Sekunden – Maßstab für „Vorrat in Tagen“ */
  const dayCapSec = () => DAYCAP;
  /** Belegung: Maschinen mit eingeplantem Auftrag und Arbeitsvorrat in Schichttagen (Mittel der Bearbeitungsmaschinen) */
  function occupancy() {
    const wc = workContent(), cap = dayCapSec(), byMachine = {};
    let withWork = 0, withBacklog = 0, sum = 0, nM = 0, max = 0, maxId = null;
    for (let j = 0; j < MA.length; j++) {
      const m = MA[j], d = Math.round(wc.w[m.id] / cap * 100) / 100;
      byMachine[m.id] = d;
      if (m.op) withWork++;
      if (wc.w[m.id] > 0) withBacklog++;
      if (m.kind === 'machine') { sum += d; nM++; if (d > max) { max = d; maxId = m.id; } }
    }
    return { machinesWithWork: withWork, machinesWithBacklog: withBacklog, total: MA.length, backlogDays: nM ? Math.round(sum / nM * 100) / 100 : 0,
      backlogDaysMax: max, backlogMaxMachine: maxId, byMachine };
  }
  /** Engpass – eine Definition für alle Ansichten: unter den Stationen, die laut Prognose den Durchlauf gefährdeter
      (spät/knapp) Aufträge begrenzen, die mit dem größten Arbeitsvorrat; sonst die mit dem größten Arbeitsvorrat. */
  function bottleneck() {
    const fc = forecast(), wc = workContent().w;
    const limits = {}, risky = {};
    for (const id in fc.orders) {
      const f = fc.orders[id], o = S.orders[id];
      if (!o || f.done || o.status === 'fertig' || !f.bottleneckStation) continue;
      const sid = f.bottleneckStation;
      (limits[sid] || (limits[sid] = [])).push(o);
      const rk = riskOf(o, f.eta);
      if (rk === 'spät' || rk === 'knapp') (risky[sid] || (risky[sid] = [])).push({ o, rk });
    }
    let best = null;
    const pick = (ids) => { for (const sid of ids) if (S.machines[sid] && wc[sid] > 0 && (best == null || wc[sid] > wc[best])) best = sid; };
    pick(Object.keys(risky));
    const atRisk = best != null;
    if (!atRisk) pick(MA.map(m => m.id));
    if (best == null) return null;
    const lim = (limits[best] || []).slice().sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1));
    const late = (risky[best] || []).slice().sort((a, b) => (a.rk === 'spät' ? 0 : 1) - (b.rk === 'spät' ? 0 : 1) || a.o.due - b.o.due);
    const h = wc[best] / 3600, hTxt = U.fmtNum(h, h < 10 ? 1 : 0) + ' h';
    const tag = (x) => x.o.id + (x.rk === 'spät' ? ' (verspätet)' : ' (knapp)');
    let what;
    if (late.length) what = 'begrenzt ' + late.slice(0, 3).map(tag).join(', ') + (late.length > 3 ? ` u. ${late.length - 3} weitere` : '');
    else if (lim.length) what = 'begrenzt ' + lim.slice(0, 3).map(o => o.id).join(', ') + (lim.length > 3 ? ` u. ${lim.length - 3} weitere` : '') + ' (im Plan)';
    else what = 'größter Arbeitsvorrat im Werk';
    return { stationId: best, short: ST[best].short || best, name: ST[best].name, workSec: Math.round(wc[best]), workDays: Math.round(wc[best] / dayCapSec() * 100) / 100,
      atRisk, orders: lim.map(o => o.id), late: late.map(x => x.o.id), why: `Arbeitsvorrat ${hTxt} · ${what}` };
  }

  // ------------------------------------------------------------------ Abgeleitete Sichten
  function clock() { return U.fmtDayClock(S.t); }
  function shift() {
    const i = shiftInfo(S.t);
    if (i) return { id: i.sh.id, name: i.sh.name, inBreak: i.inBreak, endsAt: i.end, breakEndsAt: i.breakEnd };
    return { id: null, name: 'Keine Schicht (Geisterschicht)', inBreak: false, endsAt: nextWorkStart(S.t) };
  }
  function whereText(c) {
    const l = c.location;
    if (c.state === 'shipped') return 'Versand';
    if (c.state === 'scrap') return 'Sperrlager';
    if (!l) return '–';
    if (l.kind === 'station' && l.id === 'EXT' && c.state === 'input') {
      const o = S.orders[c.orderId], lot = o ? extLot(o, c.idx) : null;
      if (lot) return `${stShort(l.id)} · ${lot.complete ? 'Los ' + lot.qty + ' Stk komplett – Abholung ' + (S.t < lot.leave ? 'ab ca. ' + tclock(lot.leave) : 'im nächsten Lieferfenster') : 'Los ' + lot.qty + '/' + lot.lot + ' Stk – wartet auf Restmenge (Teillos spätestens ' + tclock(lot.arr + CFG.extMaxWaitSec) + ')'}`;
    }
    if (l.kind === 'station') return `${stShort(l.id)} · ${l.slot === 'out' ? 'Ausgang' : 'Eingang'}`;
    if (l.kind === 'agv') return 'auf ' + (S.agvs[l.id] ? S.agvs[l.id].name : l.id);
    if (l.kind === 'forklift') return 'auf Stapler (' + pname(l.personId) + ')';
    if (l.kind === 'external') return `bei ${l.partner} bis ca. ${U.fmtDayClock(l.returnT)}`;
    return '–';
  }
  /** Render-Position eines Behälters (Halle 3D): Stapel an Eingangs-/Ausgangsplatz, auf AGV/Stapler, sonst null */
  function contPos(c) {
    const l = c.location;
    if (!l) return null;
    if (l.kind === 'station') {
      const s = ST[l.id], st = S.stations[l.id]; if (!s) return null;
      const base = l.slot === 'out' ? s.outPos : s.inPos;
      const k = Math.max(0, (l.slot === 'out' ? st.out : st.inp).indexOf(c.id));
      if (l.id === 'PUF' && s.footprint) { const f = s.footprint, per = Math.max(1, Math.floor((f.w - 0.6) / 1.4)); return { x: r6(f.x + 1 + (k % per) * 1.4), z: r6(f.z + f.d + 0.7 + Math.floor(k / per) * 0.9), level: 0, slotIndex: k }; }
      return { x: r6(base.x + ((k % 3) - 1) * 0.9), z: r6(base.z + Math.floor(k / 3) * 0.9 * (base.z > 20 ? 1 : -1)), level: 0, slotIndex: k };
    }
    if (l.kind === 'agv') { const a = S.agvs[l.id]; return a ? { x: a.pos.x, z: a.pos.z, level: 1, slotIndex: 0 } : null; }
    if (l.kind === 'forklift') { const f = S.forklift; return { x: f.pos.x, z: f.pos.z, level: 1, slotIndex: 0 }; }
    return null;
  }
  function contView(c) {
    const pos = contPos(c);
    return { id: c.id, orderId: c.orderId, seq: c.seq, srcSeq: c.srcSeq, qty: c.qty, weightKg: c.weightKg, state: c.state, stateLabel: LABELS.container[c.state] || c.state,
      kind: c.kind, partName: c.partName, where: whereText(c), location: c.location ? Object.assign({}, c.location) : null, slotIndex: pos ? pos.slotIndex : null,
      pos: pos ? { x: pos.x, z: pos.z } : null, transportId: c.transportId, createdT: c.createdT };
  }
  /** Wo ist die Person gerade (für Kachel/Detail: „T. Bauer holt Werkzeug in der Werkzeugausgabe“)? */
  function personWhere(p) {
    const tk = p.task, s = tk && tk.steps[tk.si];
    if (p.state === 'offShift') return 'nicht im Dienst';
    if (p.state === 'break') return 'in der Pause';
    if (s && (s.k === 'walk' || s.k === 'drive') && p.route) return 'unterwegs zu ' + stShort(s.to);
    if (s && s.k === 'toForklift') return 'unterwegs zum Stapler';
    let at = null;
    if (tk) for (let k = tk.si; k >= 0; k--) if (tk.steps[k].to) { at = tk.steps[k].to; break; }
    if (at === 'CRIB') return 'in der Werkzeugausgabe';
    if (at === 'QS') return 'im Messraum';
    if (at && S.machines[at]) return 'an ' + at;
    if (at) return 'bei ' + stShort(at);
    return p.route ? 'unterwegs' : 'am Arbeitsplatz';
  }
  function personBrief(p, extra) {
    return Object.assign({ id: p.id, name: p.name, role: p.role, activity: p.activity, state: p.state, stateLabel: LABELS.person[p.state] || p.state,
      task: p.task ? p.task.type : null, taskLabel: p.task ? p.task.label : null, where: personWhere(p) }, extra || {});
  }
  function machineView(id) {
    const m = S.machines[id]; if (!m) return null;
    const st = ST[id], meta = WF.STATE[m.state] || {};
    const c = curOf(m);
    const fc = forecast();
    let order = null, partNo = null, partsDone = 0, partsTotal = 0, partProgress = 0, etaOpEnd = null, etaBusyEnd = null, phase = 'Bereit';
    let loadRem = 0;
    if (m.part && m.part.sub === 'load') { const lt = S.tasks[m.tasks.load], lp = lt && lt.assignee ? S.people[lt.assignee] : null; loadRem = lp && lp.workRem > 0 ? lp.workRem : (c ? loadSecOf(m, c.r) : 0); }
    const tools = [];
    if (c) {
      const { o, i, r, op } = c;
      partsDone = op.good + op.scrap; partsTotal = opTotal(o, i);
      partNo = m.part ? m.part.no : null;
      partProgress = m.part ? (m.part.sub === 'load' ? 0 : Math.max(0, Math.min(1, 1 - m.part.rem / m.part.dur))) : 0;
      phase = !m.setupDone ? (m.setupRun ? 'Rüsten' : 'Rüsten ausstehend') : m.needCorr || m.corrRun ? 'Korrektur' : m.fpi ? 'Erstteilprüfung' : !m.released ? 'Erstteil' : 'Serie';
      order = { id: o.id, customer: o.customer, partName: o.part.name, partNo: o.part.no, qty: o.qty, due: o.due, priority: o.priority, seq: r.seq, op: r.op,
        cycleMin: r.cycleMin, setupMin: r.setupMin, transferBatch: r.transferBatch, firstPiece: !!r.firstPiece, released: m.released };
      // Prognose-Eintrag genau dieses Arbeitsgangs; nie in der Vergangenheit (laufendes Teil, Störung)
      const fe = (fc.machines[id] || []).find(x => x.active && x.orderId === o.id && x.seq === r.seq);
      const minEnd = S.t + (m.part ? m.part.rem : 0) + faultRemSec(m) + m.dressRem;
      etaOpEnd = fe ? Math.max(fe.opEnd != null ? fe.opEnd : fe.end, minEnd) : null;
      etaBusyEnd = fe ? Math.max(fe.end, minEnd) : null;
      const tc = toolCheck(m, o, i);
      const tk = S.tasks[m.tasks.tc];
      const nc = m.toolchange ? null : nextChange(m, o, i, tc);
      for (const x of tc.items) {
        const spec = x.spec, tl = x.tl;
        if (!tl) { tools.push({ id: null, typeId: spec.type, name: TT[spec.type] ? TT[spec.type].name : spec.type, kind: TT[spec.type] ? TT[spec.type].kind : '', wearPct: null, remainingParts: 0, remainingPartsAfterPart: 0, cutMinPerPart: spec.cutMinPerPart, plannedChange: null, status: 'missing', explain: 'Wird beim Rüsten bestückt.' }); continue; }
        const changing = !!(m.toolchange && m.toolchange.list.some(y => y.toolId === tl.id));
        const g = nc && nc.group.find(y => y.tl === tl), l = !g && nc ? nc.later.find(y => y.tl === tl) : null;
        let pcv = null;
        if (g) pcv = { afterPart: nc.afterPart, etaT: nc.etaT, waitFromT: nc.waitFromT, waiting: !!nc.waiting, action: canIndex(tl) ? 'index' : 'replace', by: nc.by ? pname(nc.by) : null, byId: nc.by, stage: nc.stage, manual: !!g.manual, bundled: !!g.bundled,
          withTools: nc.group.filter(y => y.tl !== tl).map(y => TT[y.spec.type].name), note: nc.staffNote || nc.baseNote || null, text: changeWhen(nc) };
        else if (l) pcv = { afterPart: l.afterPart, etaT: l.etaT, waitFromT: null, waiting: false, action: canIndex(tl) ? 'index' : 'replace', by: null, byId: null, stage: 'später', manual: false, bundled: false, withTools: [], note: null, text: `nach Teil ${l.afterPart}${l.etaT != null ? ' · ca. ' + tclock(l.etaT) : ''}` };
        const cut = spec.cutMinPerPart;
        tools.push({ id: tl.id, typeId: tl.typeId, name: tl.name, kind: tl.kind, wearPct: wearOf(tl), used: r6(tl.used), life: tl.life,
          remainingParts: x.rem, remainingMin: r6(tl.life - tl.used), cutMinPerPart: cut,
          edge: tl.edge || 1, edges: tl.edges || 1, edgeText: edgeTxt(tl), nextAction: tl.broken || tl.kind !== 'insert' ? 'replace' : canIndex(tl) ? 'index' : 'replace',
          remainingPartsAfterPart: x.remA, wearAfterPartPct: tc.run ? Math.round(Math.min(1, (tl.used + cut) / tl.life) * 1000) / 10 : wearOf(tl),
          changeAtParts: x.at, planAtParts: PLAN_AT, planHorizonParts: tc.horizon, planWearPct: planWearPct(tl, cut, x.at), neededParts: tc.plAfter + tc.run,
          plannedChange: pcv, broken: !!tl.broken,
          manualOrder: m.manualTC && m.manualTC.types.includes(spec.type) ? { t: m.manualTC.t, notBefore: m.manualTC.notBefore, reason: m.manualTC.reason, due: !!(pcv && pcv.manual) } : null,
          status: !m.setupDone ? (m.setupRun ? 'setup' : keptAtSetup(tl) ? 'keep' : 'replace') : changing ? 'changing' : tl.broken ? 'broken' : x.rem < 1 ? 'due' : pcv ? 'planned' : 'ok',
          explain: changing ? `${((m.toolchange.list.find(y => y.toolId === tl.id) || {}).action === 'index') ? 'Schneide wird gerade gewendet' : 'Wird gerade gewechselt'} (${pname(m.toolchange.by)}, noch ca. ${U.fmtDur(Math.max(0, m.toolchange.dur - (S.t - m.toolchange.t0)))}) – ${(m.toolchange.list.find(y => y.toolId === tl.id) || {}).reason || ''}` : toolExplain(m, x, nc, o, i, tc),
          mountedT: tl.mountedT, parts: tl.parts, dressEvery: TT[tl.typeId].dressEvery || null, sinceDress: tl.kind === 'wheel' ? tl.sinceDress : null });
      }
    }
    const opTypes = c ? new Set((c.r.tools || []).map(t => t.type)) : new Set();
    for (const tid of m.tools) {
      const tl = S.tools[tid]; if (opTypes.has(tl.typeId)) continue;
      tools.push({ id: tl.id, typeId: tl.typeId, name: tl.name, kind: tl.kind, wearPct: wearOf(tl), used: r6(tl.used), life: tl.life, remainingParts: null, remainingPartsAfterPart: null, edge: tl.edge || 1, edges: tl.edges || 1, edgeText: edgeTxt(tl),
        cutMinPerPart: null, plannedChange: null, broken: !!tl.broken, status: 'idle', explain: 'Montiert, im aktuellen Arbeitsgang nicht im Einsatz (wird beim nächsten Rüsten getauscht oder behalten).' });
    }
    // Bediener = wer an der Maschine einlegt/prüft/montiert/rüstet; sonst die zuständige Person im Dienst. Alle anderen mit
    // Aufgabe an der Maschine (Einrichter:in mit Werkzeug, QS holt Erstteil, Reparatur) stehen in people[] mit Ort.
    const people = [];
    let operator = null;
    for (const pid in S.people) { const p = S.people[pid]; if (p.task && p.task.machineId === id) people.push(personBrief(p)); }
    for (const key of ['load', 'attend', 'setup', 'corr']) {
      const tk = S.tasks[m.tasks[key]];
      if (tk && tk.assignee) { operator = personBrief(S.people[tk.assignee], { responsible: false }); break; }
    }
    if (!operator) for (const pid in S.people) { const p = S.people[pid]; if (p.onDuty && !p.endShift && p.machines.includes(id)) { operator = personBrief(p, { responsible: true }); break; } }
    const stn = S.stations[id];
    const queue = [];
    for (const oid in S.orders) {
      const o = S.orders[oid]; if (o.status === 'fertig') continue;
      o.routing.forEach((r, i) => {
        if (r.station !== id || o.ops[i].complete || (m.op && m.op.oid === oid && m.op.idx === i)) return;
        const lv = opLevel(m, o, i);
        queue.push({ orderId: oid, seq: r.seq, op: r.op, due: o.due, priority: o.priority, level: lv.level, why: lv.why || (lv.eta ? 'Teile ab ca. ' + tclock(lv.eta) : 'Vorgänger noch nicht fertig'), parts: partsLeft(o, i), k: [o.priority === 'eil' ? 0 : 1, lv.level > 0 ? 2 - lv.level : 3, o.due, oid] });
      });
    }
    queue.sort((a, b) => cmpKey(a.k, b.k)); queue.forEach(q => delete q.k);
    return {
      id, name: m.name, short: m.short, type: m.type, kind: m.kind, area: m.area, vendor: st.vendor, model: st.model, control: st.control, year: st.year,
      automation: m.automation, loading: m.loading, rate: m.rate, conn: Object.assign({}, m.conn),
      state: m.state, stateLabel: meta.label, stateColor: meta.color, stateHex: WF.STATE_HEX[m.state], cause: m.cause, since: m.since, sinceSec: S.t - m.since,
      phase, order, partNo, partsDone, partsTotal, partProgress, partRemainSec: m.part ? m.part.rem + loadRem : null, loadRemainSec: m.part && m.part.sub === 'load' ? loadRem : null, partSub: m.part ? m.part.sub : null,
      partEndT: m.part ? S.t + m.part.rem + loadRem + faultRemSec(m) : null, partPaused: !!(m.part && m.part.paused),
      etaOpEnd, etaBusyEnd, tools, operator, people, manualToolChange: m.manualTC ? { types: m.manualTC.types.slice(), names: m.manualTC.types.map(t => TT[t].name), t: m.manualTC.t, notBefore: m.manualTC.notBefore, reason: m.manualTC.reason } : null,
      input: stn.inp.map(cid => contView(S.containers[cid])), output: stn.out.map(cid => contView(S.containers[cid])), inCap: m.inCap, outCap: m.outCap,
      oeeToday: oeeKd(m), oeeShift: oeeKs(m), stateTimes: Object.assign({}, m.kd.stateSec), plannedStateTimes: Object.assign({}, m.kd.plannedStateSec),
      lossByState: Object.fromEntries(Object.entries(m.kd.lossEurBy).filter(([, v]) => v > 0.005).map(([k, v]) => [k, Math.round(v * 10) / 10])), goodToday: m.kd.good, scrapToday: m.kd.scrap,
      lossEurToday: Math.round(m.kd.lossEur), energyKwhToday: Math.round(m.kd.energyKwh * 10) / 10, energyEurToday: Math.round(m.kd.energyKwh * energyPrice() * 100) / 100,
      powerKw: (m.conn.level || 0) >= 1 ? Math.round(machinePower(m) * 10) / 10 : null, powerKwEst: Math.round(machinePower(m) * 10) / 10,
      signals: m.signals, powerMeasured: (m.conn.level || 0) >= 1,
      barStockM: m.barMagazineM ? m.barStockM : null, barMagazineM: m.barMagazineM || null, barReorderM: m.barReorderM || null, barMaterial: m.barMat ? S.materials[m.barMat].name : null,
      fault: m.fault ? Object.assign({}, m.fault, { sinceSec: S.t - m.fault.t0 }) : null,
      fpi: m.fpi ? Object.assign({}, m.fpi, { waitingSec: S.t - m.fpi.t0 }) : null,
      dressing: m.dressRem > 0, queue, segments: m.segments, counter: m.counter,
    };
  }
  function orderView(id) {
    const o = S.orders[id]; if (!o) return null;
    const fc = forecast(), f = fc.orders[id] || {}, fops = f.ops || [];
    let wDone = 0, wAll = 0, prevS = -Infinity, prevE = -Infinity;
    const ops = o.routing.map((r, i) => {
      const op = o.ops[i], m = S.machines[r.station];
      const active = !!(m && m.op && m.op.oid === id && m.op.idx === i);
      const waiting = r.station === 'VERSAND' ? 0 : waitingQty(id, i);
      let inOutput = 0;
      for (const cid in S.containers) { const c = S.containers[cid]; if (c.orderId === id && c.src === i && (c.state === 'filling' || c.state === 'ready')) inOutput += c.qty; }
      // Soll: 1. AG inkl. Nachfertigung für Ausschuss (wie machineView „Teil x/y“), Folge-AG = erwarteter Zugang
      const target = opTotal(o, i), targetIn = opTargetIn(o, i);
      const wt = r.station === 'EXT' ? 60 : r.station === 'VERSAND' ? 1 : (r.cycleMin || 1);
      wAll += targetIn * wt; wDone += Math.min(targetIn, op.good + (i === 0 ? 0 : op.scrap)) * wt;
      const state = op.complete ? 'done' : active ? 'active' : r.station === 'EXT' && (op.inProc > 0 || waiting > 0) ? 'external' : (op.received > 0 || waiting > 0) ? 'waiting' : 'open';
      const fe = fops[i] || null;
      // Arbeitsgang-Kette chronologisch: Plan nie vor dem Vorgänger; abgeschlossene Arbeitsgänge mit Ist-Zeiten
      let pS = op.complete ? op.startT : fe ? fe.start : null, pE = op.complete ? op.endT : fe ? fe.end : null;
      if (!op.complete) {
        if (pS != null && op.startT != null && op.received > 0) pS = Math.min(pS, op.startT);
        if (pS != null && !(op.received > 0)) pS = Math.max(pS, prevS);
        if (pE != null) pE = Math.max(pE, prevE, pS != null ? pS : -Infinity, S.t);
      }
      if (pS != null) prevS = Math.max(prevS, pS);
      if (pE != null) prevE = Math.max(prevE, pE);
      let ext = null;
      if (r.ext) {
        let atPartner = 0, waitPick = 0, firstRet = null, lastRet = null, pickT = null;
        for (const cid in S.containers) {
          const c = S.containers[cid]; if (c.orderId !== id || c.idx !== i) continue;
          if (c.state === 'external') { atPartner += c.qty; firstRet = firstRet == null ? c.location.returnT : Math.min(firstRet, c.location.returnT); lastRet = Math.max(lastRet || 0, c.location.returnT); }
          else if (c.state === 'input' && c.location && c.location.id === 'EXT') waitPick += c.qty;
        }
        const lot = extLot(o, i);
        pickT = lot.list.length && lot.complete ? Math.max(S.t, lot.leave) : fe && fe.shipNext != null ? fe.shipNext : null;
        if (firstRet == null && fe) firstRet = fe.firstReturn;
        if (fe && fe.lastReturn != null && !op.complete) lastRet = Math.max(lastRet || 0, fe.lastReturn);
        const txt = [];
        if (atPartner) txt.push(`${atPartner} Stk bei ${r.ext.partner}${firstRet ? ' bis ca. ' + U.fmtDayClock(firstRet) : ''}`);
        if (waitPick) txt.push(`${waitPick} Stk an der Bereitstellung (${lot.complete ? 'Los komplett' : 'Los ' + lot.qty + '/' + lot.lot + ' Stk'}${pickT ? ', Abholung ca. ' + U.fmtDayClock(pickT) : ''})`);
        if (op.good) txt.push(`${op.good} Stk zurück`);
        ext = Object.assign({}, r.ext, { lotQty: opBatch(r), sentQty: op.good + op.scrap + op.inProc, atPartnerQty: atPartner, waitingPickupQty: waitPick, returnedQty: op.good,
          lotComplete: lot.list.length ? lot.complete : null, pickupT: pickT, returnT: firstRet, lastReturnT: lastRet, returnText: txt.join(' · ') || (op.complete ? 'abgeschlossen' : 'noch keine Teile') });
      }
      return { seq: r.seq, op: r.op, station: r.station, stationName: stShort(r.station), received: op.received, good: op.good, scrap: op.scrap, inProc: op.inProc,
        waiting, inOutput, passed: op.passed, target, targetIn, replacementQty: i === 0 ? op.scrap : 0, complete: op.complete, state, stateLabel: LABELS.opState[state],
        machineState: active ? m.state : null, cause: active ? m.cause : null,
        setupMin: r.setupMin || 0, cycleMin: r.cycleMin || 0, transferBatch: r.transferBatch || null, firstPiece: !!r.firstPiece, ext,
        plannedStart: pS != null ? Math.round(pS) : null, plannedEnd: pE != null ? Math.round(pE) : null, returnT: ext ? ext.returnT : null,
        plannedBusyStart: fe && fe.busyStart != null ? fe.busyStart : null, plannedBusyEnd: fe && fe.busyEnd != null ? fe.busyEnd : null, firstOutT: fe ? fe.first : null,
        startT: op.startT, endT: op.endT, measKey: id + '/' + r.seq };
    });
    const containers = [];
    for (const cid in S.containers) { const c = S.containers[cid]; if (c.orderId === id) containers.push(contView(c)); }
    const done = o.status === 'fertig';
    const eta = done ? o.doneT : f.eta;
    const slack = eta != null ? o.due - eta : null;
    const shortQty = Math.max(0, o.qty - o.shippedQty);
    const risk = riskOf(o, eta);
    return { id, customer: o.customer, sector: o.sector, part: Object.assign({}, o.part), qty: o.qty, due: o.due, priority: o.priority, status: o.status, note: o.note,
      shippedQty: o.shippedQty, shortQty: done ? shortQty : 0, progress: done ? 1 : wAll ? Math.min(1, wDone / wAll) : 0, ops, containers, eta, etaRaw: done ? o.doneT : (f.etaRaw != null ? f.etaRaw : f.eta),
      etaPending: f.etaPending != null ? f.etaPending : null, late: eta != null && (eta > o.due || (done && shortQty > 0)), slackSec: slack, risk, riskLabel: LABELS.risk[risk],
      onTime: done ? (o.doneT <= o.due && shortQty === 0) : null, bottleneck: f.bottleneck || null, bottleneckStation: f.bottleneckStation || null, startT: o.startT, doneT: o.doneT, source: o.source,
      delayBreakdown: (f.delay || []).map(e => Object.assign({}, e, { blockingOrders: e.blockingOrders.slice() })), delayCause: f.delayCause || null,
      limit: f.limit ? Object.assign({}, f.limit, { blockingOrders: f.limit.blockingOrders.slice() }) : null, limitText: done ? null : limitTxt(f, plantBnId()),
      expectedQty: o.qty - scrapAfterFirst(o), qtyRisk: qtyRiskOf(o), remakeOf: o.remakeOf || null, remakes: (o.remakes || []).slice(), template: o.template || null };
  }
  function trimStr(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  /** kompakte Sicht für die KI (< 12 kB): offene Aufträge nach Risiko/Termin (max. 15) + letzte 3 fertige, Engpass und
      Puffer je Auftrag, je Maschine ETA des Arbeitsgangs und nächster Werkzeugwechsel. Budget-Schleife hält < 11,5 kB. */
  function snapshot() {
    const k = kpis(), fc = forecast();
    const r3 = (x) => x == null ? null : Math.round(x * 1000) / 1000;
    const machines = Object.values(S.machines).map(m => {
      const c = curOf(m);
      let tool = null, eta = null, change = null;
      if (c) {
        const tc = toolCheck(m, c.o, c.i);
        for (const x of tc.items) { if (!x.tl) continue; if (!tool || x.rem < tool.rem) tool = { name: TT[x.spec.type].name, rem: x.rem, wear: Math.round(x.tl.used / x.tl.life * 100) }; }
        if (!m.toolchange) { const nc = nextChange(m, c.o, c.i, tc); if (nc) change = trimStr(nc.group.map(x => TT[x.spec.type].name).join(', ') + ' ' + changeWhen(nc), 110); }
        const fe = (fc.machines[m.id] || []).find(x => x.active && x.orderId === c.o.id && x.seq === c.r.seq);
        if (fe) eta = U.fmtDayClock(Math.max(fe.opEnd != null ? fe.opEnd : fe.end, S.t));
      }
      return { id: m.id, name: m.short, st: m.state, since: U.fmtDayClock(m.since), ord: c ? c.o.id + '/AG' + c.r.seq : null, part: c ? (c.op.good + c.op.scrap) + '/' + opTotal(c.o, c.i) : null,
        why: trimStr(m.cause, 110), eta, tool, change, oee: r3(oeeKd(m).oee), conn: m.conn.level };
    });
    const riskRank = { 'spät': 0, knapp: 1, ok: 2, unbekannt: 3 };
    const ov = (o) => {
      const f = fc.orders[o.id] || {}, done = o.status === 'fertig', eta = done ? o.doneT : f.eta;
      const slack = eta != null ? o.due - eta : null;
      const risk = riskOf(o, eta);
      const exp = o.qty - scrapAfterFirst(o);
      return { id: o.id, cust: trimStr(o.customer, 28), part: trimStr(o.part.name, 28), qty: o.qty, expQty: exp < o.qty ? exp : undefined, remakeOf: o.remakeOf || undefined, st: o.status, prio: o.priority, shipped: o.shippedQty,
        due: U.fmtDayClock(o.due), eta: eta != null ? U.fmtDayClock(eta) : null, slackMin: slack != null ? Math.round(slack / 60) : null, risk,
        bottleneck: !done && f.bottleneck ? trimStr(f.bottleneck, 60) : null, _r: riskRank[risk], _due: o.due, _done: done ? o.doneT : null };
    };
    const all = Object.values(S.orders).map(ov);
    const open = all.filter(x => x._done == null).sort((a, b) => a._r - b._r || a._due - b._due);
    const fin = all.filter(x => x._done != null).sort((a, b) => b._done - a._done);
    let orders = open.slice(0, 15).concat(fin.slice(0, 3));
    for (const x of orders) { delete x._r; delete x._due; delete x._done; }
    let alerts = S.notifications.filter(n => n.status !== 'resolved').slice(0, 12).map(n => ({ id: n.id, sev: n.sev, role: n.role, title: trimStr(n.title, 90), t: U.fmtDayClock(n.t) }));
    const low = Object.values(S.materials).filter(mt => mt.onHand < mt.min * 1.2).map(mt => ({ id: mt.id, name: mt.name, onHand: Math.round(mt.onHand * 10) / 10, min: mt.min, unit: mt.unit, onOrder: mt.onOrder }));
    const people = Object.values(S.people).filter(p => p.onDuty).map(p => ({ id: p.id, name: p.name, role: p.role, st: p.state, act: trimStr(p.activity, 60) }));
    const agvs = Object.values(S.agvs).map(a => ({ id: a.id, st: a.state, bat: Math.round(a.battery), load: a.load }));
    let recent = [];
    for (let j = S.events.length - 1; j >= 0 && recent.length < 10; j--) { const e = S.events[j]; if (e.type === 'state' && e.data && e.data.minor) continue; if (e.type === 'state' && e.data && e.data.to === 'running') continue; recent.push({ t: U.fmtClock(e.t), msg: trimStr(e.msg, 120) }); }
    const bn = bottleneck(), oc = k.occupancy;
    const bnS = bn ? { station: bn.stationId, name: bn.short, workH: Math.round(bn.workSec / 360) / 10, why: trimStr(bn.why, 110), late: bn.late.slice(0, 4) } : null;
    const build = () => ({ t: S.t, clock: clock(), shift: shift().name, company: P.company.name,
      bottleneck: bnS, occupancy: { withWork: oc.machinesWithWork, total: oc.total, backlogDays: oc.backlogDays },
      kpi: { oee: r3(k.oee), availability: r3(k.availability), performance: r3(k.performance), quality: r3(k.quality), good: k.good, goodFinished: k.goodFinished, scrap: k.scrap, fpy: r3(k.fpy), onTimePct: r3(k.onTimePct),
        lossEur: k.lossEur, energyKwh: k.energyKwh, powerKw: k.powerKw, wip: k.wip, transportsToday: k.transportsToday, toolCostToday: k.toolCostToday },
      ordersOpen: open.length, ordersDone: fin.length, ordersLate: open.filter(x => x.risk === 'spät').length,
      machines, orders, alerts, materialsLow: low, people, agvs, recent });
    let snap = build();
    // Budget: zuerst „Gerade passiert“, dann Meldungen, dann Aufträge kürzen
    for (let g = 0; g < 60 && JSON.stringify(snap).length > 11500; g++) {
      if (recent.length > 3) recent = recent.slice(0, recent.length - 1);
      else if (alerts.length > 5) alerts = alerts.slice(0, alerts.length - 1);
      else if (orders.length > 5) orders = orders.slice(0, orders.length - 1);
      else { for (const m of machines) m.why = trimStr(m.why, 50); for (const p of people) p.act = trimStr(p.act, 30); }
      snap = build();
    }
    return snap;
  }

  // ------------------------------------------------------------------ Aktionen (§3.10)
  const fail = (msg) => ({ ok: false, msg });
  function triggerFault(machineId, code) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (m.fault) return fail(`${m.id} hat bereits eine Störung (${m.fault.code})`);
    if (m.setupRun || m.toolchange || m.corrRun) return fail(`${m.id} wird gerade gerüstet bzw. Werkzeug gewechselt – Störung danach auslösen`);
    if (code) {
      const f = faultCatalog(m).find(x => x.code === code);
      if (!f) return fail(`Alarm ${code} gibt es an ${m.id} ${m.short} nicht – mögliche Alarme: ${faultCatalog(m).map(x => x.code).join(', ')}`);
      if (f.toolBreak && !cuttingNow(m)) return fail(`${f.code} „${f.text}“ ist nur während der Bearbeitung möglich – ${m.id} schneidet gerade nicht (${WF.STATE[m.state].label}${m.part && m.part.sub === 'load' ? ', Teil wird eingelegt' : ''})`);
    }
    startFault(m, code || null, true);
    return { ok: true, msg: `Störung ${m.fault.code} „${m.fault.text}“ an ${m.id} ausgelöst` };
  }
  function repair(machineId) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (!m.fault) return fail(`${m.id} hat keine Störung`);
    const tk = S.tasks[m.tasks.repair]; if (tk) finishTask(tk, 'cancelled');
    endFault(m, null);
    resumeState(m);
    return { ok: true, msg: `Störung an ${m.id} behoben (Demo)` };
  }
  function findN(id) { return S.notifications.find(n => n.id === id || n.key === id); }
  function ack(nid, by) {
    const n = findN(nid); if (!n) return fail('Benachrichtigung unbekannt');
    if (n.status === 'resolved') return fail('Bereits erledigt');
    n.status = 'ack'; n.ackBy = by || 'Leitstand'; n.ackT = S.t;
    WF.bus.emit('sim:notify', n);
    return { ok: true, msg: 'Quittiert' };
  }
  function resolveN(nid) {
    const n = findN(nid); if (!n) return fail('Benachrichtigung unbekannt');
    if (n.status === 'resolved') return { ok: true, msg: 'Bereits erledigt' };
    if (NIDX[n.key] === n) delete NIDX[n.key];
    n.status = 'resolved'; n.resolvedT = S.t; n.resolveNote = 'manuell erledigt';
    WF.bus.emit('sim:notify', n);
    return { ok: true, msg: 'Erledigt' };
  }
  function reorder(materialId, qty, opt) {
    const mt = S.materials[materialId]; if (!mt) return fail('Material unbekannt: ' + materialId);
    const q = qty != null ? Number(qty) : mt.reorderQty;
    if (!(q > 0) || q > mt.reorderQty * 20) return fail('Menge ungültig');
    const etaT = nextDayWindow(S.t + mt.leadMin * 60);
    const pu = { id: U.uid('BE'), materialId, qty: q, orderedT: S.t, etaT, status: 'bestellt', supplier: mt.supplier, costEur: Math.round(q * mt.pricePerUnit) };
    S.purchases.push(pu);
    mt.onOrder = r6(mt.onOrder + q);
    const dec = mt.unit === 'm' ? 1 : 0, kb = !!(opt && opt.kanban);
    if (kb) pu.kanban = true;
    ev('reorder', 'info', { kind: 'material', id: mt.id }, kb
      ? `Kanban-Abruf ${pu.id}: ${nm(q, dec)} ${mt.unit} ${mt.name} bei ${mt.supplier} – ${opt.min ? 'Bestand + Bestellungen ' + nm(mt.onHand + mt.onOrder - q, dec) + ' ' + mt.unit + ' unter Meldebestand ' + nm(mt.min, dec) + ' ' + mt.unit : 'offener Bedarf der freigegebenen Aufträge ' + nm(opt.need, dec) + ' ' + mt.unit + ' > Bestand + Bestellungen ' + nm(opt.have, dec) + ' ' + mt.unit}; Lieferung ca. ${U.fmtDayClock(etaT)} (${U.fmtEur(pu.costEur)})`
      : `Bestellung ${pu.id}: ${nm(q, dec)} ${mt.unit} ${mt.name} bei ${mt.supplier} – Lieferung ca. ${U.fmtDayClock(etaT)} (${U.fmtEur(pu.costEur)})`, { purchaseId: pu.id, qty: q, etaT, kanban: kb });
    checkStock(mt);
    planChanged();
    return { ok: true, id: pu.id, msg: `Bestellt: ${nm(q, 1)} ${mt.unit} ${mt.name}, Lieferung ca. ${U.fmtDayClock(etaT)}` };
  }
  function setPriority(orderId, prio) {
    const o = S.orders[orderId]; if (!o) return fail('Auftrag unbekannt: ' + orderId);
    if (prio !== 'eil' && prio !== 'normal') return fail("Priorität muss 'eil' oder 'normal' sein");
    if (o.status === 'fertig') return fail('Auftrag ist bereits fertig');
    const old = o.priority; o.priority = prio; planChanged();
    for (const id in S.machines) S.machines[id].nextPickT = 0;
    ev('priority', 'info', { kind: 'order', id: o.id }, `${o.id}: Priorität ${old} → ${prio}${prio === 'eil' ? ' – wird bei jedem Auftragswechsel vorgezogen (laufende Teile werden nicht unterbrochen)' : ''}`, { from: old, to: prio });
    return { ok: true, msg: prio === 'eil' ? `${o.id} ist jetzt Eilauftrag` : `${o.id} wieder normale Priorität` };
  }
  function compatible(a, b) { return a === b || (!!TYPE_GROUP[a] && TYPE_GROUP[a] === TYPE_GROUP[b]); }
  /** Leistungsgrenzen je Maschinentyp (Station kann sie über station.caps überschreiben) – für Arbeitsgang-Verlagerung */
  const CAPS = {
    swiss:    { barOnly: true, maxBarDia: 20, maxKg: 0.5, what: 'Langdrehautomat mit Stangenlader (Stangen bis Ø 20 mm)' },
    lathe:    { maxKg: 30, maxDia: 220, maxLen: 600, what: 'Drehfräszentrum mit Portallader (Teile bis ca. Ø 220 × 600 mm, 30 kg)' },
    biglathe: { minKg: 10, what: 'Großdrehmaschine für Wellen (ab ca. 10 kg, bis 5 t)' },
    mill5:    { maxKg: 300, what: '5-Achs-Bearbeitungszentrum (Werkstück bis ca. 300 kg)' },
    mill3:    { maxKg: 1000, no5axis: true, what: '3-Achs-Bearbeitungszentrum' },
  };
  const numDe = (x) => Number(String(x).replace(',', '.'));
  /** Abmessungen aus der Teilebezeichnung („Ø60×220“, Zahnrad „m2 z38“ → Kopfkreis m·(z+2)) */
  function partDims(o) {
    const n = String(o.part.name || '') + ' ' + String(o.part.no || '');
    let m = /Ø\s*(\d+(?:[.,]\d+)?)(?:\s*[×x]\s*(\d+(?:[.,]\d+)?))?/.exec(n);
    if (m) return { dia: numDe(m[1]), len: m[2] ? numDe(m[2]) : null };
    m = /\bm\s*(\d+(?:[.,]\d+)?)\s*z\s*(\d+)/i.exec(n);
    if (m) return { dia: Math.round(numDe(m[1]) * (Number(m[2]) + 2)), len: null };
    m = /(\d+)\s*[×x]\s*(\d+)(?:\s*[×x]\s*(\d+))?/.exec(n);
    if (m) return { dia: null, len: Math.max(numDe(m[1]), numDe(m[2]), m[3] ? numDe(m[3]) : 0) };
    return { dia: null, len: null };
  }
  function barDiaOf(matId) { const mt = S.materials[matId]; const m = mt && /Ø\s*(\d+(?:[.,]\d+)?)/.exec(mt.name); return m ? numDe(m[1]) : null; }
  /** null = Maschine kann den Arbeitsgang bearbeiten, sonst Begründung */
  function capCheck(o, i, to) {
    const cap = Object.assign({}, CAPS[to.type] || {}, (ST[to.id] && ST[to.id].caps) || {});
    const r = o.routing[i], kg = o.part.weightKg || 0, d = partDims(o);
    const nm1 = (v) => nm(v, v < 1 ? 2 : v < 10 ? 1 : 0);
    if (cap.barOnly) {
      const bar = i === 0 && r.material && S.materials[r.material.id] && S.materials[r.material.id].form === 'Stange' ? barDiaOf(r.material.id) : null;
      if (bar == null) return `${to.id} ${to.short} ist ein ${cap.what} – „${r.op}“ von ${o.id} geht nicht von Stangenmaterial aus (Rohteile/Vorbearbeitung)`;
      if (cap.maxBarDia && bar > cap.maxBarDia) return `${to.id} ${to.short}: Stangendurchmesser Ø ${nm1(bar)} mm > Ø ${cap.maxBarDia} mm (${cap.what})`;
    }
    if (cap.maxKg && kg > cap.maxKg) return `${to.id} ${to.short}: Teilegewicht ${nm1(kg)} kg > ${nm1(cap.maxKg)} kg (${cap.what})`;
    if (cap.minKg && kg < cap.minKg) return `${to.id} ${to.short} ist eine ${cap.what} – ${o.part.name} (${nm1(kg)} kg) lässt sich dort nicht sinnvoll spannen und fertigen`;
    if (cap.maxDia && d.dia && d.dia > cap.maxDia) return `${to.id} ${to.short}: Durchmesser Ø ${nm1(d.dia)} mm > Ø ${cap.maxDia} mm (${cap.what})`;
    if (cap.maxLen && d.len && d.len > cap.maxLen) return `${to.id} ${to.short}: Teilelänge ${nm1(d.len)} mm > ${cap.maxLen} mm (${cap.what})`;
    if (cap.no5axis && /5-?Achs/i.test(r.op)) return `${to.id} ${to.short} ist ein ${cap.what} – „${r.op}“ braucht eine 5-Achs-Maschine`;
    return null;
  }
  /** Prüfung einer Verlagerung (ohne sie auszuführen): {msg} = Ablehnungsgrund, sonst {i, from, to} */
  function moveOpCheck(orderId, seq, stationId) {
    const o = S.orders[orderId]; if (!o) return { msg: 'Auftrag unbekannt: ' + orderId };
    const i = o.routing.findIndex(r => r.seq === Number(seq)); if (i < 0) return { msg: 'Arbeitsgang unbekannt: ' + seq };
    const r = o.routing[i], op = o.ops[i];
    if (op.complete) return { msg: 'Arbeitsgang ist bereits abgeschlossen' };
    const from = S.machines[r.station], to = S.machines[stationId];
    if (!from || !to || to.kind !== 'machine') return { msg: 'Verlagerung nur zwischen Bearbeitungsmaschinen möglich' };
    if (stationId === r.station) return { msg: `Arbeitsgang liegt bereits auf ${stationId}` };
    if (!compatible(from.type, to.type)) return { msg: `${to.id} ${to.short} kann „${r.op}“ nicht bearbeiten (anderer Maschinentyp)` };
    { const why = capCheck(o, i, to); if (why) return { msg: why }; }
    if (from.op && from.op.oid === orderId && from.op.idx === i && (from.part || from.fpi || from.setupRun || from.toolchange || from.corrRun || from.fault || from.needCorr || from.rework))
      return { msg: `${from.id} bearbeitet den Arbeitsgang gerade – Verlagerung an der nächsten Teilegrenze erneut versuchen` };
    return { msg: null, o, i, from, to };
  }
  function moveOp(orderId, seq, stationId) {
    const chk = moveOpCheck(orderId, seq, stationId);
    if (chk.msg) return fail(chk.msg);
    const { o, i, from, to } = chk, r = o.routing[i], op = o.ops[i];
    if (from.op && from.op.oid === orderId && from.op.idx === i) pauseOp(from, o, i, `${orderId} AG ${r.seq} wird von ${from.id} auf ${stationId} verlagert`);
    r.station = stationId; op.station = stationId; ORDV++;
    // wartende Behälter umlagern, laufende Transporte umleiten
    const st = S.stations[from.id];
    for (const cid of st.inp.slice()) {
      const c = S.containers[cid];
      if (c.orderId !== orderId || c.idx !== i || c.state !== 'input') continue;
      op.received -= c.qty; c.state = 'ready'; c.relocate = true; CV++;
      createTransport(c);
    }
    for (const tid in S.transports) {
      const tr = S.transports[tid];
      if (tr.status === 'done' || tr.to.station !== from.id || !tr.containerId) continue;
      const c = S.containers[tr.containerId]; if (!c || c.orderId !== orderId || c.idx !== i) continue;
      tr.to.station = stationId; tr.label = tr.label.replace(stShort(from.id), stShort(stationId));
      const a = S.agvs[tr.assignee];
      if (a && a.state === 'toDrop') routeTo(a, ST[stationId].dockNode, stPos(stationId, 'in'));
      if (tr.taskId && S.tasks[tr.taskId]) {
        const tk = S.tasks[tr.taskId];
        tk.steps.forEach((s, k) => { if (k >= 3 && s.to === from.id) s.to = stationId; });
        const p = tk.assignee && S.people[tk.assignee];
        if (p && p.route && tk.si === 3) routeTo(p, ST[stationId].dockNode, stPos(stationId, 'in'));
      }
    }
    to.nextPickT = 0; planChanged();
    ev('moveOp', 'info', { kind: 'order', id: orderId }, `${orderId} AG ${r.seq} „${r.op}“ von ${from.id} auf ${to.id} ${to.short} verlagert – dort wird neu gerüstet (${r.setupMin || 0} min)`, { seq: r.seq, from: from.id, to: to.id });
    return { ok: true, msg: `${orderId} AG ${r.seq} auf ${to.id} verlagert` };
  }
  function connectMachine(machineId, level, protocol) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    const lv = Math.round(Number(level));
    if (!(lv >= 0 && lv <= 3)) return fail('Anschluss-Level muss 0–3 sein');
    const old = m.conn.level;
    m.conn = { level: lv, protocol: protocol || m.conn.protocol, gateway: lv === 0 ? '–' : (m.conn.gateway && m.conn.gateway !== '–' ? m.conn.gateway : 'werkfluss Edge 03'), connectedT: S.t };
    ev('connect', 'ok', { kind: 'machine', id: m.id }, `${m.id} ${m.short}: Anbindung Level ${old} → ${lv} (${m.conn.protocol})`, { from: old, to: lv, protocol: m.conn.protocol });
    return { ok: true, msg: `${m.id} ist jetzt mit Level ${lv} angebunden` };
  }
  /** Vorbeugender Werkzeugwechsel (z. B. vor der Geisterschicht) – bewusste, sichtbare Entscheidung.
      types: Werkzeugtypen (leer = Auswahl nach Reststandzeit gegenüber den offenen Teilen); notBefore: Wechsel frühestens ab
      dieser Sim-Zeit (Zahl oder {notBefore, reason}) – z. B. letzte Teilegrenze vor Schichtende. */
  function planToolChange(machineId, types, opt, reasonArg) {
    const m = S.machines[machineId]; if (!m) return fail('Maschine unbekannt: ' + machineId);
    if (!m.op || !m.setupDone) return fail(`${m.id} hat keinen eingerichteten Arbeitsgang`);
    if (m.toolchange) return fail(`${m.id}: Werkzeugwechsel läuft bereits`);
    const c = curOf(m);
    const o2 = opt && typeof opt === 'object' ? Object.assign({}, opt) : { notBefore: opt };
    if (!o2.reason && reasonArg) o2.reason = reasonArg; // App ruft Aktionen positionsweise auf (machineId, types, notBefore, reason)
    const nb = Number(o2.notBefore);
    const tc = toolCheck(m, c.o, c.i);
    if (tc.plAfter <= 0) return fail(`${m.id}: ${tc.run ? 'das letzte Teil von ' + c.o.id + ' AG ' + c.r.seq + ' läuft' : 'alle Teile von ' + c.o.id + ' AG ' + c.r.seq + ' sind gestartet'} – kein Werkzeugwechsel mehr nötig`);
    if (typeof types === 'string') types = [types];
    let list;
    if (types && types.length) {
      list = [];
      for (const t of types) {
        const x = tc.items.find(y => y.spec.type === t);
        if (!x || !x.tl) return fail(`${TT[t] ? TT[t].name : t} ist in ${c.o.id} AG ${c.r.seq} an ${m.id} nicht im Einsatz`);
        if (!list.includes(t)) list.push(t);
      }
    } else {
      // Auswahl nach Reststandzeit gegenüber den noch zu fertigenden Teilen (nicht nach pauschalem Verschleiß-%)
      const needs = tc.items.filter(x => x.tl && x.need);
      if (!needs.length) return fail(`Reststandzeit aller Werkzeuge reicht für die restlichen ${teile(tc.pl)} von ${c.o.id} AG ${c.r.seq} – kein Wechsel nötig`);
      const minRem = Math.min(...needs.map(x => x.remA));
      list = needs.filter(x => x.remA === minRem || x.bundleOk || x.remA <= tc.horizon).map(x => x.spec.type);
    }
    const mt = m.manualTC || (m.manualTC = { types: [], notBefore: null, t: S.t, reason: null });
    for (const t of list) if (!mt.types.includes(t)) mt.types.push(t);
    mt.t = S.t; mt.notBefore = isFinite(nb) && nb > S.t ? Math.round(nb) : null; mt.reason = o2.reason ? String(o2.reason) : null;
    const tk = ensureToolTask(m, false); tk.prio = Math.max(tk.prio, PRIO.setup);
    for (const t of list) { const tl = mountedOf(m, t); if (tl) tl.plannedT = null; } // neu ankündigen (jetzt als vorbeugender Wechsel)
    const nc = nextChange(m, c.o, c.i);
    ev('toolPlanned', 'info', { kind: 'machine', id: m.id }, `${m.id}: vorbeugender Werkzeugwechsel beauftragt (${list.map(t => TT[t].name).join(', ')}) – erfolgt ${changeWhen(nc)}${mt.reason ? ' – ' + mt.reason : ''}`, { manual: true, types: list, notBefore: mt.notBefore, afterPart: nc ? nc.afterPart : null, etaT: nc ? nc.etaT : null });
    planTools(m);
    GDIRTY = true;
    return { ok: true, types: list, msg: `Vorbeugender Wechsel an ${m.id} beauftragt (${list.map(t => TT[t].name).join(', ')}) – ${changeWhen(nc)}` };
  }
  function addOrder(spec) {
    if (!spec || typeof spec !== 'object') return fail('Ungültige Auftragsdaten');
    const qty = Math.round(Number(spec.qty));
    if (!(qty > 0) || qty > 100000) return fail('Menge muss zwischen 1 und 100.000 liegen');
    if (!spec.part || !spec.part.name) return fail('Teilbezeichnung fehlt');
    if (!Array.isArray(spec.routing) || !spec.routing.length) return fail('Arbeitsplan fehlt');
    const steps = [], warnings = [];
    for (let k = 0; k < spec.routing.length; k++) {
      const r = spec.routing[k] || {}, sid = r.station;
      if (sid === 'VERSAND') continue;
      if (!ST[sid]) return fail(`Arbeitsgang ${k + 1}: Station „${sid}“ unbekannt`);
      if (sid === 'EXT') {
        const ext = Object.assign({ partner: 'Härterei Wolf GmbH (Beispiel)', process: r.op || 'Härten', leadMin: 480 }, r.ext || {});
        steps.push({ op: r.op || ext.process, station: 'EXT', ext, transferBatch: Math.max(1, Math.round(r.transferBatch || qty)) });
        continue;
      }
      const m = S.machines[sid];
      if (!m) return fail(`Arbeitsgang ${k + 1}: ${sid} ist kein Arbeitsplatz`);
      const cyc = Number(r.cycleMin);
      if (!(cyc > 0)) return fail(`Arbeitsgang ${k + 1} (${sid}): Taktzeit fehlt`);
      const tools = [];
      for (const t of r.tools || []) {
        if (!TT[t.type]) { warnings.push(`Werkzeugtyp ${t.type} unbekannt – ignoriert`); continue; }
        const cut = Number(t.cutMinPerPart);
        if (!(cut > 0)) continue;
        if (cut > TT[t.type].lifeMin) { warnings.push(`${t.type}: Schnittzeit je Teil > Standzeit – begrenzt`); }
        tools.push({ type: t.type, cutMinPerPart: Math.min(cut, TT[t.type].lifeMin) });
      }
      let material = null;
      if (r.material && steps.length === 0) {
        if (S.materials[r.material.id] && Number(r.material.perPart) > 0) material = { id: r.material.id, perPart: Number(r.material.perPart) };
        else warnings.push(`Material ${r.material.id} unbekannt – Rohteile werden beigestellt`);
      }
      steps.push({ op: r.op || TASK_LABEL.setup, station: sid, setupMin: Math.max(0, Number(r.setupMin) || 0), cycleMin: cyc,
        transferBatch: Math.max(1, Math.round(r.transferBatch || Math.min(qty, 20))),
        firstPiece: r.firstPiece != null ? !!r.firstPiece : (m.kind === 'machine' && m.type !== 'saw' && m.type !== 'washer'),
        tools, material, char: r.char || null, loadMin: r.loadMin != null ? Number(r.loadMin) : undefined });
    }
    if (!steps.length) return fail('Arbeitsplan enthält keinen Bearbeitungsschritt');
    steps.push({ op: 'Versand', station: 'VERSAND' });
    steps.forEach((s, k) => { s.seq = (k + 1) * 10; });
    const n = nextOrderNo(24130);
    const id = 'FA-' + n;
    let due = Number(spec.due); if (!isFinite(due) || due <= S.t) due = addWork(S.t, 3 * 16 * 3600);
    buildOrder({ id, customer: spec.customer || 'Neukunde', sector: spec.sector || '', qty, due, priority: spec.priority === 'eil' ? 'eil' : 'normal', note: spec.note || '', source: spec.source || 'KI-Auftrag',
      part: { no: spec.part.no || ('KI-' + (n % 10000)), name: spec.part.name, material: spec.part.material || '–', drawing: spec.part.drawing || '–', weightKg: Number(spec.part.weightKg) > 0 ? Number(spec.part.weightKg) : 1 },
      routing: steps });
    for (const mid in S.machines) S.machines[mid].nextPickT = 0;
    planChanged();
    if (steps[0].station === 'EXT') {
      // Lohnbearbeitung mit Beistellteilen: Kundenteile liegen im Wareneingang und gehen zur Bereitstellung Fremdbearbeitung
      const o = S.orders[id];
      const c = newContainer(o, -1, 0, qty, 'ready', 'raw');
      placeAt(c, 'WE', 'out'); c.supplied = true;
      createTransport(c);
      warnings.push('erster Schritt Fremdbearbeitung: Beistellteile des Kunden im Wareneingang angenommen');
      ev('issue', 'info', { kind: 'container', id: c.id }, `Beistellteile ${qty} Stk „${spec.part.name}“ (${spec.customer || 'Neukunde'}) im Wareneingang – gehen zur Bereitstellung ${stShort('EXT')} (${steps[0].op})`, { orderId: id, qty });
    }
    ev('orderAdded', 'ok', { kind: 'order', id }, `Neuer Auftrag ${id} eingelastet: ${qty} Stk „${spec.part.name}“ für ${spec.customer || 'Neukunde'}, Termin ${U.fmtDayClock(due)} (${steps.length - 1} Arbeitsgänge)${warnings.length ? ' – Hinweise: ' + warnings.join('; ') : ''}`, { warnings });
    return id;
  }
  /** Nachfertigung für Ausschuss nach dem 1. Arbeitsgang: eigener Auftrag ab AG 10 (gleicher Arbeitsplan, Eilauftrag,
      Termin des Stammauftrags bzw. +2 Werktage), wird geliefert sobald fertig; Stammauftrag zeigt sie in qtyRisk */
  function planRemake(orderId, qty) {
    const o = S.orders[orderId]; if (!o) return fail('Auftrag unbekannt: ' + orderId);
    if (o.remakeOf) return fail(`${o.id} ist selbst eine Nachfertigung (für ${o.remakeOf})`);
    const q0 = qtyRiskOf(o), miss = q0 ? q0.missing : 0;
    const n = qty != null ? Math.round(Number(qty)) : miss;
    if (!(n > 0)) return fail(`${o.id}: keine Fehlmenge offen – keine Nachfertigung nötig`);
    if (n > Math.max(miss, 1) * 3) return fail('Menge ungültig');
    const id = 'FA-' + nextOrderNo(24129);
    const due = o.due > S.t + 4 * 3600 ? o.due : dueAfterWorkDays(S.t, 2);
    const no = buildOrder({ id, customer: o.customer, sector: o.sector, part: o.part, qty: n, due, priority: 'eil', source: 'Nachfertigung',
      note: `Nachfertigung für ${o.id} (${n} Stk Ausschuss nach AG ${o.routing[0].seq})`, routing: o.routing.map(r => Object.assign({}, r)) });
    no.remakeOf = o.id;
    (o.remakes || (o.remakes = [])).push(id); o.remakeQty = (o.remakeQty || 0) + n;
    for (let j = 0; j < MA.length; j++) MA[j].nextPickT = 0;
    planChanged();
    kanbanCheck();
    ev('remake', 'info', { kind: 'order', id }, `Nachfertigung ${id} eingeplant: ${n} Stk ${o.part.name} für ${o.id} (${o.customer}) ab ${stShort(o.routing[0].station)}, Eilauftrag, Termin ${U.fmtDayClock(due)}`, { orderId: id, remakeOf: o.id, qty: n });
    if (hasOpen('qty:' + o.id)) resolveKey('qty:' + o.id, `Nachfertigung ${id} eingeplant`);
    return { ok: true, id, msg: `Nachfertigung ${id} (${n} Stk) für ${o.id} eingeplant` };
  }
  /** Stangenlader vorbeugend auffüllen (z. B. vor der Geisterschicht): Staplerauftrag „Stangen nachladen“, auch wenn das
      Magazin noch über der Nachlademarke liegt */
  function refillBars(machineId) {
    const m = S.machines[machineId]; if (!m) return fail('Unbekannte Maschine ' + machineId);
    if (!m.barMagazineM) return fail(`${m.id} ${m.short} hat keinen Stangenlader`);
    const c = curOf(m);
    if (!c || !isBarFed(m, c.r) || m.barMat !== c.r.material.id) return fail(`${m.id}: der aktuelle Arbeitsgang läuft nicht von der Stange`);
    if (barsTransportOf(m)) return { ok: true, msg: `Stangen-Nachschub für ${m.id} ist bereits beauftragt` };
    const mt = S.materials[c.r.material.id];
    if (m.barMagazineM - m.barStockM < Math.min(CFG.barLenM, c.r.material.perPart * 10)) return fail(`Stangenmagazin ${m.id} ist voll (${nm(m.barStockM, 1)} von ${nm(m.barMagazineM, 0)} m)`);
    if (mt.onHand + 1e-9 < c.r.material.perPart) return fail(`Keine Stangen ${mt.name} mehr im Lager`);
    const tr = createBarsTransport(m, mt.id);
    ev('barsOrder', 'info', { kind: 'machine', id: m.id }, `${m.id}: Stangen nachladen beauftragt (vorbeugend) – Magazin ${nm(m.barStockM, 2)} von ${nm(m.barMagazineM, 0)} m`, { transportId: tr.id, manual: true });
    GDIRTY = true;
    return { ok: true, transportId: tr.id, msg: `Stangen nachladen für ${m.id} beauftragt (Stapler)` };
  }
  /** Notification-Aktion ausführen ({type, ...}) */
  function runAction(a) {
    if (!a || !a.type) return fail('Aktion fehlt');
    switch (a.type) {
      case 'reorder': return reorder(a.materialId, a.qty);
      case 'setPriority': return setPriority(a.orderId, a.priority || a.value || 'eil');
      case 'repair': return repair(a.machineId);
      case 'triggerFault': return triggerFault(a.machineId, a.code);
      case 'moveOp': return moveOp(a.orderId, a.seq, a.stationId);
      case 'planRemake': return planRemake(a.orderId, a.qty);
      case 'releaseIntake': { const id = releaseIntake('manuell freigegeben'); return id ? { ok: true, id, msg: `Auftrag ${id} aus dem Auftragsvorrat freigegeben` } : fail('Keine passende Vorlage frei (Stationen ausgelastet bzw. Material fehlt)'); }
      case 'applyOffset': return applyOffset(a.orderId, a.seq, a.value, 'Leitstand');
      case 'planToolChange': return planToolChange(a.machineId, a.types, { notBefore: a.notBefore, reason: a.reason });
      case 'refillBars': return refillBars(a.machineId);
      case 'ack': return ack(a.id, a.by);
      case 'resolve': return resolveN(a.id);
      case 'select': WF.bus.emit('select', { kind: a.kind, id: a.id }); return { ok: true, msg: 'geöffnet' };
    }
    return fail('Unbekannte Aktion ' + a.type);
  }

  // ------------------------------------------------------------------ Hauptschleife
  function step() {
    S.t += 1;
    if (S.t % DAY === 0) dayRollover();
    shiftTick();
    if (S.t % 10 === 0) { purchasesTick(); extTick(); }
    for (let k = 0; k < MA.length; k++) machineTick(MA[k]);
    if ((S.t & 1) === 0) transportsTick();
    assignTasks();
    for (let k = 0; k < PA.length; k++) personTick(PA[k]);
    if (DIRTY.length) { for (let k = 0; k < DIRTY.length; k++) { DIRTY[k].dirty = false; refreshState(DIRTY[k]); } DIRTY.length = 0; }
    for (let k = 0; k < AA.length; k++) agvTick(AA[k]);
    statsTick();
    if (S.t % 10 === 0) rulesTick();
    historyTick();
  }
  let acc = 0;
  /** rechnet simSeconds weiter (Unterschritte 1 s, max. 3600 je Aufruf); Bruchteile werden aufsummiert */
  function advance(simSeconds) {
    if (!S) init(WF.profile);
    acc += Math.max(0, Number(simSeconds) || 0);
    let n = Math.floor(acc);
    acc -= n;
    if (n > 3600) n = 3600;
    for (let k = 0; k < n; k++) step();
    return n;
  }

  // ------------------------------------------------------------------ Export
  const actions = {
    triggerFault, repair, ack, resolve: resolveN, reorder: (id, qty) => reorder(id, qty), setPriority, addOrder, moveOp, connectMachine, planRemake,
    releaseIntake: () => runAction({ type: 'releaseIntake' }),
    applyOffset: (orderId, seq, value) => applyOffset(orderId, Number(seq), value, 'Leitstand'), planToolChange, refillBars, run: runAction,
    reset: () => { acc = 0; init(P || WF.profile); return { ok: true, msg: 'Simulation neu gestartet' }; },
  };
  WF.sim = {
    init: (profile) => { acc = 0; return init(profile); },
    reset: () => actions.reset(),
    advance, step: () => step(),
    get state() { return S; },
    get history() { return S ? S.history : null; },
    get t() { return S ? S.t : 0; },
    get speedHint() { return (P || WF.profile || { sim: {} }).sim.defaultSpeed || 30; },
    clock, shift, machineView, orderView, forecast, kpis, snapshot, actions, runAction, bottleneck, occupancy, whatIf, whatIfPriority, orderAdvice, costs,
    ghostCheck: () => (S && S.ghostCheck ? JSON.parse(JSON.stringify(S.ghostCheck)) : null),
    workContent: () => Object.assign({}, workContent().w),
    // Hilfen für Ansichten / Tests
    stationName: stShort, partsLeft: (orderId, seq) => { const o = S.orders[orderId]; const i = o ? o.routing.findIndex(r => r.seq === seq) : -1; return i >= 0 ? partsLeft(o, i) : null; },
    charOf: (orderId, seq) => { const o = S.orders[orderId]; const i = o ? o.routing.findIndex(r => r.seq === seq) : -1; if (i < 0) return null; const ch = charOf(S.machines[o.routing[i].station] || { type: 'cmm' }, o.routing[i]); return Object.assign({ lsl: ch.nominal + ch.tolMinus, usl: ch.nominal + ch.tolPlus, center: ch.nominal + (ch.tolMinus + ch.tolPlus) / 2 }, ch); },
    containerWhere: (id) => (S.containers[id] ? whereText(S.containers[id]) : null),
    containerView: (id) => (S.containers[id] ? contView(S.containers[id]) : null),
    LABELS,
    /** deutsche Bezeichnung: label('person', 'walking') → 'Unterwegs'; Gruppen: Schlüssel von LABELS + 'machineState', 'sev' */
    label: (group, key) => {
      if (group === 'machineState') return WF.STATE[key] ? WF.STATE[key].label : key;
      if (group === 'sev') return WF.SEV[key] ? WF.SEV[key].label : key;
      const g = LABELS[group]; return g && g[key] != null ? g[key] : key;
    },
    config: CFG,
  };
})();
