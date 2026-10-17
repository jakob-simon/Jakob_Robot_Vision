# werkfluss – Leitfaden für die Ansichten (UI)

Zielbild: Ein Produktionsleiter eines 46-Personen-Lohnfertigers öffnet werkfluss und versteht in
10 Sekunden, was in seiner Halle los ist – und kann jede Zahl bis zur Ursache verfolgen. Die Demo soll
bei echten Interessenten gezeigt werden können: sie muss **glaubwürdig, konsistent und hochwertig** wirken.

## Grundregeln
1. **Nur lesen, über Aktionen handeln.** Daten kommen aus `WF.sim.state` und den abgeleiteten Sichten
   (`machineView`, `orderView`, `forecast`, `kpis`, `history` …). Änderungen nur über `WF.sim.actions.*`.
   Siehe `werkfluss/ENGINE_API.md` (verbindliche Feldnamen) und `src/10_sim.js`.
2. **Eine Wahrheit.** Dieselbe Zahl muss überall gleich sein (OEE, Teilezähler, Restteile Werkzeug, ETA).
   Keine eigenen Schätzungen, wenn die Engine einen Wert liefert. Fehlt etwas Wichtiges, im Abschlussbericht melden.
3. **Zusammenfassung vor Detail.** Oben: Kernaussage/Kennzahlen; darunter: Listen, Tabellen; Klick → Detail-Drawer
   (`WF.app.select(kind, id)`), Kinds: machine, order, person, agv, tool, material, container.
4. **Zustand in Form kodieren**: Pills (`WF.ui.pill(stateKey)`), Farbstreifen (`.sev-stripe` mit `--c`), Balken (`WF.ui.bar`).
   Semantische Farben nur über Tokens: `--st-run --st-setup --st-tool --st-wait --st-fault --st-idle`, Material `--mat`,
   Information `--info`, Akzent `--accent`. Keine Hex-Literale im CSS der Views (Ausnahme Canvas/WebGL: `WF.STATE_HEX`).
5. **Komponenten aus `src/styles.css` verwenden**: `.view-h .view-t .view-sub`, `.card .card-h .card-b`, `.kpis .kpi .l .v .s`,
   `.pill .chip .conn[data-l] .bar .btn(.sm .primary .ghost .danger .ok) .seg .tbl .tbl-wrap .dl .empty .link .avatar .eyebrow
   .muted .mono .num .grid-2/3/4 .stack .row`. Eigenes CSS über `WF.ui.css(text, key)` mit **eindeutigem Präfix** je Modul
   (z. B. `.ls-` Leitstand, `.or-` Aufträge, `.md-` Maschinendetail, `.mt-` Material, `.tl-` Werkzeuge, `.pe-` Personal,
   `.qa-` Qualität, `.cn-` Anbindung, `.ai-` KI, `.h3-` Halle).
6. **Sprache**: Deutsch, sachlich, aus Sicht des Nutzers („Wartet auf Material“, nicht „starved“). Keine Emojis als Gestaltungselement.
   Zahlen über `WF.util.fmtNum/fmtPct/fmtEur/fmtDur/fmtClock/fmtDue`. Uhrzeiten 24 h.
7. **Diagramme maßstabsgetreu** (eine Skala, Achsenbeschriftungen nur für erreichte Werte, Raster dezent, Endpunkt betont),
   Farben aus Tokens, als SVG (Inline) oder Canvas. Tooltips bei Hover wo sinnvoll.
8. **Responsiv**: muss bei 400 px Breite funktionieren (Grids auf 1 Spalte, Tabellen in `.tbl-wrap`), keine horizontale Seiten-Scrollbar.
9. **Performance**: `update()` läuft ~4×/s. Große Bereiche nicht jedes Mal komplett neu aufbauen: Signatur vergleichen
   (z. B. JSON der angezeigten Werte) und nur bei Änderung neu rendern, oder gezielt Text/Breiten aktualisieren.
   Fokus/Scrollposition von Eingaben und Listen nicht zerstören.
10. **View-Registrierung**: `WF.registerView({ id, title, icon, group, order, mount(root), show(params), hide(), update(), frame(dt) })`
    – Gruppen: `betrieb` (leitstand 1, halle 2, auftraege 3), `ressourcen` (material 4, werkzeuge 5, personal 6, qualitaet 7),
    `einrichtung` (anbindung 8), `ki` (ki-auftrag 9). Details: `WF.registerDetail(kind, id => ({ title, subtitle, render(el), update(el), askPrompt }))`.
11. **Leere Zustände** sind gestaltet (erklären, was erscheinen wird). Die Demo startet aber immer in einem gefüllten
    Betriebszustand (Mo 08:40, vorgerechnet).
12. **Testen**: `node werkfluss/build.mjs --out <eigene Datei> --only <dein_modul.js>` und mit Playwright
    (global: `require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`,
    Chromium `executablePath: '/opt/pw-browsers/chromium'`, Args `['--use-angle=swiftshader','--enable-unsafe-swiftshader']`)
    öffnen, `WF.app.navigate('<id>')`, Screenshot (1440×900 und 400×860) mit dem Read-Tool ansehen, Konsole auf Fehler prüfen.
    Nie in `werkfluss/dist/` schreiben (gemeinsame Datei) – eigene Ausgabedatei im Scratch/tmp verwenden.
13. **Typografie nur aus der Skala** (`styles.css`): `--fs-2xs` 10,5 px (Eyebrow in Versalien, Achsen) · `--fs-xs` 11,5
    (Meta, Legenden) · `--fs-sm` 12,5 (Tabellen) · `--fs-md` 13,5 (Fließtext) · `--fs-lg` 15 (Kartentitel) · `--fs-xl` 19
    (Drawer-/Abschnittstitel, Condensed) · `--fs-2xl` 26 (Ansichtstitel) · `--fs-kpi` 28 (Kennzahl). **Nichts unter 10,5 px**,
    auch nicht in SVG. Kartentitel immer `.card-h h3` (15 px/600) – Eyebrows sind nie Kartentitel.
14. **Eine Kennzahl-Kachel**: `.kpi` mit `.l` (Eyebrow), `.v` (Wert, Einheit als `<small>`), `.s` (max. 2 Zeilen), optional
    `.viz`/`.spark` unten. Höchstens zwei Werte je Kachel. Hinweis nur über `.kpi.warn` / `.kpi.crit` (Streifen oben +
    Wertfarbe) – keine eigenen Rahmen, keine getönten Flächen, nie bei Wert 0. Keine eigenen KPI-Komponenten je Modul.
15. **Farbsemantik**: `--st-*` nur für Zustände von Maschinen/Personen, `--accent`/`--info` für Interaktion und Datenfluss,
    `--mat` für Material/Behälter (Lebenszyklus über Füllung/Kontur, nicht über Zustandsfarben), `--ext` für
    Fremdbearbeitung (Härterei usw.). Mengen-/Energiebalken neutral (`--text2` mit Deckkraft), Akzent nur für die Aussage.
16. **Zeitstempel von Meldungen** immer mit `WF.ui.notifTime(n)` (Entstehungszeit, ggf. „aktualisiert hh:mm“).
17. **Touch**: Bedienflächen ≥ 40 px unter `@media (pointer:coarse)` (eigene Modul-Regeln dürfen das nicht unterschreiten),
    Eingabefelder 16 px (sonst zoomt iOS). Hinweise für Maus („Rechtsklick“, „Mausrad“) auf Touch durch Gesten ersetzen.
18. **„Engpass“** bezeichnet nur den Werks-Engpass aus `WF.sim.bottleneck()`. Der begrenzende Schritt eines Auftrags heißt
    „begrenzt durch …“ bzw. „kritisch“.
19. **Maschinenzustand benennen** immer über `WF.ui.machineStateLabel(mv)` / `WF.ui.machinePill(mv)`: geplanter Stillstand
    ohne Schicht heißt überall „Keine Schicht“ (grau), nie „Bereit“ in der einen und „Keine Schicht“ in der anderen Ansicht.
