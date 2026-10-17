# werkfluss – KI-natives MES für den Mittelstand (Demo)

werkfluss zeigt, wie ein produzierender Mittelständler (5–50 Mio. € Umsatz) seine Fertigung ohne
teures MES-Projekt digitalisiert: Maschinen jeden Alters anbinden, Material- und Informationsfluss
sichtbar machen, Werkzeuge, Lager und Personal im Griff haben – und mit einem KI-Copiloten arbeiten,
der die Live-Daten kennt.

Die Demo simuliert einen **fiktiven Wiener Lohnfertiger** (Donau Präzisionstechnik GmbH, 46 Mitarbeitende,
Drehen, Fräsen, Schleifen, Verzahnen, Tieflochbohren, Montage, externe Härterei, 2 AGVs, 2 Schichten).
Alle Daten sind simuliert; Firmenname und Standort lassen sich in den Einstellungen für Vorführungen
bei Interessenten anpassen.

## Öffnen
`dist/werkfluss.html` per Doppelklick im Browser öffnen (Chrome/Edge/Firefox/Safari). Die Datei ist
vollständig eigenständig (Three.js eingebettet) und läuft offline. Auf claude.ai veröffentlicht nutzt der
Copilot Claude live; lokal antwortet ein regelbasierter Offline-Copilot aus denselben Live-Daten.

## Auf claude.ai veröffentlichen
Als Artifact mit der Capability `{"sample": {"images": true}}` veröffentlichen. Dann beantwortet der Copilot Fragen
live mit Claude (mit Werkzeugen auf die Simulationsdaten) und der KI-Auftrag liest hochgeladene Zeichnungen als Bild.
Jede Person, die die Seite öffnet, bestätigt die Nutzung einmalig. Ohne Capability (oder lokal per Doppelklick)
laufen Copilot und KI-Auftrag im Offline-Modus: regelbasierte Antworten aus denselben Live-Daten und vorberechnete
Auswertungen der drei Beispielzeichnungen. Die Demo-Tour nutzt immer die vorberechnete Auswertung, damit sie ohne
Wartezeit durchläuft.

## Bedienung
- Links die Ansichten: **Leitstand**, **Halle 3D**, **Aufträge** (inkl. Plantafel), **Material & Logistik**,
  **Werkzeuge**, **Personal**, **Qualität**, **Anbindung** (Maschinen anschließen), **KI-Auftrag**
  (Zeichnung → Arbeitsplan, Preis, Liefertermin → einlasten).
- Oben: Uhr und Schicht, Tempo (10×–600×, `P` = Pause), Benachrichtigungen, Copilot, Einstellungen.
- Klick auf jede Maschine, jeden Auftrag, jede Person, jedes AGV öffnet die Details rechts.
- Tasten `1`–`9` wechseln die Ansicht (Reihenfolge der Navigation, `0` = Analyse), `P` pausiert, `Esc` schließt Details.
- Demo-Tour: Knopf „Tour“ oben oder Link mit `#tour` am Ende.

## Demo-Drehbuch (ca. 6 Minuten)
1. **Leitstand** – „So sieht der Produktionsleiter um 08:40 seine Halle“: Kennzahlen, Kachel je Maschine
   (was läuft, welches Teil, wann fertig, welches Werkzeug als Nächstes getauscht wird), KI-Schichtbriefing.
2. **Halle 3D** – Material- und Datenfluss einblenden, einem Auftrag durch die Halle folgen
   (Aufträge → FA-24118 → „In der Halle verfolgen“).
3. **Werkzeuge** – die eine, nachvollziehbare Regel: Verschleiß wächst nur am Teilende, Wechsel nur
   zwischen zwei Teilen, angekündigt mit Uhrzeit und Person.
4. **Störung** – an einer Maschine „Störung simulieren“: Benachrichtigung mit Ursache und Empfehlung,
   Instandhalter läuft los, Prognose und Termine reagieren. Copilot fragen: „Was bedeutet das für FA-24118?“
5. **Anbindung** – die Flachschleifmaschine von 1996 (ohne Netzwerk) in fünf Schritten per Nachrüst-Sensorik
   anbinden.
6. **KI-Auftrag** – Beispielzeichnung analysieren, Arbeitsplan + Preis + Liefertermin, einlasten – der neue
   Auftrag läuft sofort durch die simulierte Fabrik.

## Entwicklung
```
node werkfluss/build.mjs            # → dist/werkfluss.html
node werkfluss/test/sim.test.mjs    # Invarianten der Simulation (Werkzeug, Mengenbilanz, Schichten …)
node werkfluss/test/run_sim.mjs     # 36-h-Lauf mit Zusammenfassung
node werkfluss/test/smoke.mjs       # alle Ansichten im Headless-Chromium + Screenshots
```
Aufbau und Verträge: `SPEC.md` (Fachlogik), `ENGINE_API.md` (Datenformate der Engine), `UI_GUIDE.md`
(Regeln für Ansichten). Quellen in `src/` (je Datei ein Modul, Reihenfolge nach Dateiname).
Drittsoftware: Three.js r147 (MIT, siehe `vendor/THREE_LICENSE`).
