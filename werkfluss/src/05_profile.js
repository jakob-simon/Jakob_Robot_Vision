/* werkfluss – Fabrikprofil „Donau Präzisionstechnik GmbH“ (fiktiver Wiener Lohnfertiger).
   Alle Koordinaten in Metern. Halle 64 × 40 m, x: links → rechts, z: hinten (Rückwand) → vorne.
   Materialfluss grob links → rechts. Reine Daten + Wegenetz-Aufbau, keine Logik. */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const WF = G.WF;
  const hm = WF.util.hm;
  const DAY = 86400;
  const at = (day, time) => day * DAY + hm(time); // day 0 = Montag

  // ---------------------------------------------------------------- Wegenetz (Gänge)
  // Gänge als Linien; Knoten entstehen an Endpunkten, Kreuzungen und Andockpunkten.
  const LINES = [
    { id: 'back',  axis: 'x', c: 9.5,  a: 2,   b: 62 },   // hinterer Quergang
    { id: 'main',  axis: 'x', c: 22,   a: 1.5, b: 55.5 }, // Hauptgang (zwischen den Maschinenreihen)
    { id: 'front', axis: 'x', c: 34.5, a: 2,   b: 55.5 }, // vorderer Quergang
    { id: 'vl',    axis: 'z', c: 9.5,  a: 9.5, b: 34.5 }, // Längsgang links
    { id: 'vr',    axis: 'z', c: 55.5, a: 9.5, b: 34.5 }, // Längsgang rechts
    { id: 'vm',    axis: 'z', c: 43.5, a: 22,  b: 34.5 }, // Längsgang Mitte (vordere Hälfte)
  ];

  // ---------------------------------------------------------------- Stationen
  // Hintere Maschinenreihe: Front zeigt nach +z (zum Hauptgang), Arbeitsplatz z = 19.6
  // Vordere Maschinenreihe: Front zeigt nach −z (zum Hauptgang), Arbeitsplatz z = 24.4
  const back = (dx) => ({ dock: { x: dx, z: 22 }, work: { x: dx, z: 19.6 }, inPos: { x: dx - 1.5, z: 19.5 }, outPos: { x: dx + 1.5, z: 19.5 } });
  const front = (dx) => ({ dock: { x: dx, z: 22 }, work: { x: dx, z: 24.4 }, inPos: { x: dx - 1.5, z: 24.5 }, outPos: { x: dx + 1.5, z: 24.5 } });

  const stations = [
    // ---------------- Maschinen
    { id: 'M01', kind: 'machine', type: 'saw', name: 'Bandsägeautomat', short: 'Säge', area: 'Zuschnitt',
      vendor: 'Behringer', model: 'HBE320A', control: 'Behringer SPS', year: 2009,
      footprint: { x: 2, z: 13.5, w: 6.5, d: 5 }, facing: 'S', ...back(5.5),
      automation: 'magazine', loading: 'auto', skill: 'saw', rate: 55, power: { idle: 1.2, run: 6.5 },
      inCap: 0, outCap: 6, mtbfH: 60, fpiMin: 0, // Zuschnitt-Ablage für 6 Behälter/Gitterboxen
      conn: { level: 1, protocol: 'Nachrüst-Sensorik (Strom + Signalsäule)', gateway: 'werkfluss Edge 01' } },
    { id: 'M02', kind: 'machine', type: 'lathe', name: 'CNC-Drehfräszentrum mit Portallader', short: 'INDEX G220', area: 'Dreherei',
      vendor: 'INDEX', model: 'G220', control: 'Siemens SINUMERIK 840D sl', year: 2020,
      footprint: { x: 11, z: 14, w: 8.5, d: 4.5 }, facing: 'S', ...back(13.2),
      automation: 'loader', loading: 'auto', skill: 'lathe', rate: 110, power: { idle: 4, run: 22 },
      inCap: 3, outCap: 3, mtbfH: 45, fpiMin: 15,
      conn: { level: 3, protocol: 'OPC UA (umati)', gateway: 'direkt (Steuerung)' } },
    { id: 'M03', kind: 'machine', type: 'swiss', name: 'CNC-Langdrehautomat mit Stangenlader', short: 'Citizen L20', area: 'Dreherei',
      vendor: 'Citizen', model: 'L20', control: 'Mitsubishi M800 (Citizen)', year: 2016,
      footprint: { x: 21, z: 15.5, w: 6.6, d: 3 }, facing: 'S', ...back(22.6),
      automation: 'barfeeder', loading: 'auto', skill: 'swiss', rate: 95, power: { idle: 2.5, run: 11 },
      inCap: 0, outCap: 3, mtbfH: 50, fpiMin: 12, barMagazineM: 9, barReorderM: 3,
      conn: { level: 2, protocol: 'MTConnect', gateway: 'werkfluss Edge 01' } },
    { id: 'M04', kind: 'machine', type: 'biglathe', name: 'Großdrehmaschine für Wellen bis 5 t', short: 'WFL M80', area: 'Dreherei',
      vendor: 'WFL Millturn', model: 'M80', control: 'Siemens SINUMERIK 840D sl', year: 2012,
      footprint: { x: 29, z: 13, w: 9, d: 5.5 }, facing: 'S', ...back(33.5),
      automation: 'none', loading: 'perPart', loadMin: 6, skill: 'biglathe', rate: 140, power: { idle: 8, run: 42 },
      inCap: 3, outCap: 2, mtbfH: 40, fpiMin: 25,
      conn: { level: 2, protocol: 'OPC UA', gateway: 'direkt (Steuerung)' } },
    { id: 'M07', kind: 'machine', type: 'deephole', name: 'Tieflochbohrmaschine BTA/ELB bis 3.200 mm', short: 'Tiefbohren', area: 'Sonderbearbeitung',
      vendor: 'Tiefbohrtechnik', model: 'BTA 3200', control: 'Siemens SINUMERIK 840D (Retrofit 2011)', year: 1998,
      footprint: { x: 39.5, z: 15, w: 11, d: 3.5 }, facing: 'S', ...back(41.5),
      automation: 'none', loading: 'perPart', loadMin: 4, skill: 'deephole', rate: 120, power: { idle: 6, run: 32 },
      inCap: 2, outCap: 2, mtbfH: 35, fpiMin: 15,
      conn: { level: 1, protocol: 'Nachrüst-Sensorik (Strom + Signalsäule)', gateway: 'werkfluss Edge 02' } },
    { id: 'M08', kind: 'machine', type: 'hobber', name: 'Wälzfräsmaschine (Verzahnung)', short: 'Liebherr LC 180', area: 'Verzahnung',
      vendor: 'Liebherr', model: 'LC 180', control: 'Siemens SINUMERIK 840D', year: 2008,
      footprint: { x: 51.5, z: 14, w: 3.5, d: 4.5 }, facing: 'S', ...back(53.2),
      automation: 'none', loading: 'perPart', loadMin: 0.8, skill: 'hobber', rate: 110, power: { idle: 4, run: 19 },
      inCap: 3, outCap: 3, mtbfH: 50, fpiMin: 20,
      conn: { level: 2, protocol: 'OPC UA (über Gateway)', gateway: 'werkfluss Edge 02' } },
    { id: 'M05', kind: 'machine', type: 'mill5', name: '5-Achs-Bearbeitungszentrum mit Palettenwechsler', short: 'DMU 65', area: 'Fräserei',
      vendor: 'DMG MORI', model: 'DMU 65 monoBLOCK', control: 'Heidenhain TNC 640', year: 2021,
      footprint: { x: 11, z: 25.5, w: 6.5, d: 5 }, facing: 'N', ...front(14.5),
      automation: 'pallet', loading: 'auto', skill: 'mill5', rate: 135, power: { idle: 5, run: 26 },
      inCap: 3, outCap: 3, mtbfH: 55, fpiMin: 20,
      conn: { level: 3, protocol: 'OPC UA (umati)', gateway: 'direkt (Steuerung)' } },
    { id: 'M06', kind: 'machine', type: 'mill3', name: 'Vertikal-Bearbeitungszentrum', short: 'Haas VF-4', area: 'Fräserei',
      vendor: 'Haas', model: 'VF-4', control: 'Haas NGC', year: 2014,
      footprint: { x: 19.5, z: 25.5, w: 3.8, d: 3 }, facing: 'N', ...front(21.4),
      automation: 'none', loading: 'perPart', loadMin: 1.5, skill: 'mill3', rate: 85, power: { idle: 3, run: 17 },
      inCap: 3, outCap: 3, mtbfH: 45, fpiMin: 15,
      conn: { level: 2, protocol: 'MTConnect', gateway: 'direkt (Steuerung)' } },
    { id: 'M09', kind: 'machine', type: 'cylgrinder', name: 'CNC-Universal-Rundschleifmaschine', short: 'Studer S33', area: 'Schleiferei',
      vendor: 'Studer', model: 'S33', control: 'Fanuc 31i-B', year: 2017,
      footprint: { x: 25.5, z: 25.5, w: 5, d: 3.2 }, facing: 'N', ...front(28),
      automation: 'none', loading: 'perPart', loadMin: 1.5, skill: 'cylgrinder', rate: 115, power: { idle: 4, run: 22 },
      inCap: 3, outCap: 3, mtbfH: 60, fpiMin: 20,
      conn: { level: 2, protocol: 'Fanuc FOCAS', gateway: 'werkfluss Edge 01' } },
    { id: 'M10', kind: 'machine', type: 'surfgrinder', name: 'Flachschleifmaschine', short: 'Okamoto ACC', area: 'Schleiferei',
      vendor: 'Okamoto', model: 'ACC-63', control: 'Okamoto NC (Bj. 1996)', year: 1996,
      footprint: { x: 32.5, z: 25.5, w: 3.2, d: 2.6 }, facing: 'N', ...front(34.1),
      automation: 'none', loading: 'perPart', loadMin: 1, skill: 'surfgrinder', rate: 80, power: { idle: 2, run: 10 },
      inCap: 3, outCap: 3, mtbfH: 50, fpiMin: 15,
      conn: { level: 0, protocol: 'nicht angebunden – Rückmeldung per Tablet', gateway: '–' } },
    { id: 'M11', kind: 'machine', type: 'washer', name: 'Kammerreinigungsanlage', short: 'Waschanlage', area: 'Reinigung',
      vendor: 'Reinigungstechnik', model: 'KWA 600', control: 'Siemens S7-1500', year: 2015,
      footprint: { x: 37.5, z: 25.5, w: 4.5, d: 2.6 }, facing: 'N', ...front(39.7),
      automation: 'loader', loading: 'auto', skill: 'washer', rate: 40, power: { idle: 3, run: 16 },
      inCap: 4, outCap: 4, mtbfH: 80, fpiMin: 0,
      conn: { level: 1, protocol: 'Nachrüst-Sensorik (Strom + Signalsäule)', gateway: 'werkfluss Edge 02' } },
    { id: 'QS', kind: 'qs', type: 'cmm', name: 'Messraum mit 3D-Koordinatenmessgerät', short: 'Messraum', area: 'Qualität',
      vendor: 'ZEISS', model: 'CONTURA', control: 'ZEISS CALYPSO', year: 2019,
      footprint: { x: 45, z: 25.5, w: 9, d: 7.5 }, room: true, facing: 'N',
      dock: { x: 49.5, z: 22 }, work: { x: 49.5, z: 28.2 }, inPos: { x: 46.6, z: 26.6 }, outPos: { x: 52.4, z: 26.6 },
      cmm: { x: 48, z: 28.6, w: 3, d: 2.4 },
      automation: 'none', loading: 'attended', skill: 'qs', rate: 90, power: { idle: 0.8, run: 1.5 },
      inCap: 8, outCap: 8, mtbfH: 400, fpiMin: 0,
      conn: { level: 2, protocol: 'Messprotokoll-Export (CALYPSO)', gateway: 'werkfluss Edge 02' } },
    { id: 'M13', kind: 'assembly', type: 'assembly', name: 'Montage – Baugruppen für Donau Verpackungstechnik', short: 'Montage', area: 'Montage',
      vendor: '–', model: 'Montageplätze 1–3', control: 'Montage-Terminal', year: 2022,
      footprint: { x: 57, z: 11, w: 6, d: 7.5 }, facing: 'W',
      dock: { x: 55.5, z: 15 }, work: { x: 58.2, z: 15 }, inPos: { x: 57.4, z: 12.2 }, outPos: { x: 57.4, z: 17.8 },
      automation: 'none', loading: 'attended', skill: 'assembly', rate: 65, power: { idle: 0.4, run: 1.8 },
      inCap: 4, outCap: 2, mtbfH: 1000, fpiMin: 0,
      conn: { level: 0, protocol: 'Montage-Terminal (Tablet)', gateway: '–' } },

    // ---------------- Lager / Bereiche (keine Bearbeitung)
    { id: 'RAW', kind: 'store', name: 'Rohmaterial-Lager (Kragarmregal)', short: 'Rohmaterial', area: 'Lager',
      footprint: { x: 1, z: 1, w: 7.5, d: 6 }, dock: { x: 5, z: 9.5 }, work: { x: 5, z: 8.2 }, inPos: { x: 3, z: 8 }, outPos: { x: 7, z: 8 } },
    { id: 'CRIB', kind: 'crib', name: 'Werkzeugausgabe mit Voreinstellgerät', short: 'Werkzeugausgabe', area: 'Werkzeuge',
      footprint: { x: 11, z: 1.5, w: 7.5, d: 6.5 }, room: true, dock: { x: 14.5, z: 9.5 }, work: { x: 14.5, z: 6.8 }, inPos: { x: 12.5, z: 7.4 }, outPos: { x: 16.5, z: 7.4 },
      presetter: { x: 16.2, z: 3.4 } },
    { id: 'MAINT', kind: 'maint', name: 'Instandhaltung', short: 'Instandhaltung', area: 'Instandhaltung',
      footprint: { x: 20, z: 1.5, w: 6.5, d: 6 }, room: true, dock: { x: 23, z: 9.5 }, work: { x: 23, z: 6.5 }, inPos: { x: 21.5, z: 7 }, outPos: { x: 24.5, z: 7 } },
    { id: 'PUF', kind: 'buffer', name: 'Pufferlager (Palettenregal)', short: 'Pufferlager', area: 'Lager',
      footprint: { x: 28, z: 1.5, w: 13, d: 3 }, dock: { x: 34.5, z: 9.5 }, work: { x: 34.5, z: 7.8 }, inPos: { x: 32.5, z: 6.4 }, outPos: { x: 36.5, z: 6.4 } },
    { id: 'CHG', kind: 'charge', name: 'AGV-Ladestation', short: 'Ladestation', area: 'Logistik',
      footprint: { x: 43, z: 5.5, w: 4, d: 2.5 }, dock: { x: 45, z: 9.5 }, work: { x: 45, z: 8.2 }, inPos: { x: 44, z: 7 }, outPos: { x: 46, z: 7 } },
    { id: 'OFFICE', kind: 'office', name: 'Leitstand / Büro (MES-Server)', short: 'Leitstand', area: 'Büro',
      footprint: { x: 57, z: 1, w: 6, d: 7 }, room: true, dock: { x: 58.5, z: 9.5 }, work: { x: 59.5, z: 5 }, inPos: { x: 58, z: 7 }, outPos: { x: 61, z: 7 },
      server: { x: 61.8, z: 2.2 } },
    { id: 'WE', kind: 'zone', name: 'Wareneingang', short: 'Wareneingang', area: 'Logistik',
      footprint: { x: 1, z: 36, w: 7.5, d: 3.5 }, dock: { x: 4.5, z: 34.5 }, work: { x: 4.5, z: 35.6 }, inPos: { x: 3, z: 37.6 }, outPos: { x: 6.5, z: 37.6 } },
    { id: 'SPERR', kind: 'zone', name: 'Sperrlager (Ausschuss / Nacharbeit)', short: 'Sperrlager', area: 'Qualität',
      footprint: { x: 37, z: 36, w: 5, d: 3.5 }, dock: { x: 39.5, z: 34.5 }, work: { x: 39.5, z: 35.6 }, inPos: { x: 38.5, z: 37.6 }, outPos: { x: 40.5, z: 37.6 } },
    { id: 'EXT', kind: 'zone', name: 'Fremdbearbeitung – Bereitstellung Härterei', short: 'Fremdbearbeitung', area: 'Logistik',
      footprint: { x: 45, z: 36, w: 8, d: 3.5 }, dock: { x: 49, z: 34.5 }, work: { x: 49, z: 35.6 }, inPos: { x: 47, z: 37.6 }, outPos: { x: 51, z: 37.6 } },
    { id: 'VERSAND', kind: 'zone', name: 'Fertigteillager & Versand', short: 'Versand', area: 'Logistik',
      footprint: { x: 57, z: 24.5, w: 6, d: 15 }, dock: { x: 55.5, z: 31 }, work: { x: 57.2, z: 31 }, inPos: { x: 58.5, z: 28 }, outPos: { x: 61, z: 34 } },
  ];

  // ---------------------------------------------------------------- Wegenetz aufbauen
  function buildGraph() {
    const nodes = {}, edges = [];
    const key = (x, z) => x.toFixed(2) + '|' + z.toFixed(2);
    const onLine = (L, p) => L.axis === 'x' ? Math.abs(p.z - L.c) < 1e-6 && p.x >= L.a - 1e-6 && p.x <= L.b + 1e-6
                                            : Math.abs(p.x - L.c) < 1e-6 && p.z >= L.a - 1e-6 && p.z <= L.b + 1e-6;
    const pts = LINES.map(() => []);
    LINES.forEach((L, i) => {
      pts[i].push(L.axis === 'x' ? { x: L.a, z: L.c } : { x: L.c, z: L.a });
      pts[i].push(L.axis === 'x' ? { x: L.b, z: L.c } : { x: L.c, z: L.b });
    });
    // Kreuzungen
    LINES.forEach((A, i) => LINES.forEach((B, j) => {
      if (i >= j || A.axis === B.axis) return;
      const p = A.axis === 'x' ? { x: B.c, z: A.c } : { x: A.c, z: B.c };
      if (onLine(A, p) && onLine(B, p)) { pts[i].push(p); pts[j].push(p); }
    }));
    // Andockpunkte
    for (const s of stations) {
      let found = false;
      LINES.forEach((L, i) => { if (onLine(L, s.dock)) { pts[i].push(s.dock); found = true; } });
      if (!found) throw new Error('Dock nicht auf einem Gang: ' + s.id);
      s.dockNode = key(s.dock.x, s.dock.z);
    }
    LINES.forEach((L, i) => {
      const list = pts[i].slice().sort((p, q) => L.axis === 'x' ? p.x - q.x : p.z - q.z);
      let prev = null;
      for (const p of list) {
        const k = key(p.x, p.z);
        nodes[k] = { x: p.x, z: p.z };
        if (prev && prev !== k) edges.push([prev, k]);
        prev = k;
      }
    });
    return { nodes, edges, lines: LINES };
  }
  const graph = buildGraph();

  // ---------------------------------------------------------------- Werkzeugtypen
  // lifeMin = Standzeit in Schnittminuten (Wendeschneidplatten: je Schneide); presetMin = Voreinstellzeit; cost in € (je Platte)
  // edges = Schneiden je Wendeschneidplatte – der Bediener wendet an der Maschine (1–2 min), erst nach der letzten
  // Schneide kommt eine neue Platte aus der Werkzeugausgabe
  const toolTypes = [
    { id: 'TT-SB',     name: 'Bimetall-Sägeband 34×1,1 M42',      kind: 'saw',    lifeMin: 900,  cost: 95,  presetMin: 0 },
    { id: 'TT-CNMG',   name: 'WSP CNMG 120408 (Schruppen)',        kind: 'insert', lifeMin: 50,   cost: 14,  presetMin: 3, edges: 4 },
    { id: 'TT-VNMG',   name: 'WSP VNMG 160404 (Schlichten)',       kind: 'insert', lifeMin: 34,   cost: 16,  presetMin: 3, edges: 4 },
    { id: 'TT-DR68',   name: 'VHM-Bohrer Ø6,8',                     kind: 'drill',  lifeMin: 70,   cost: 68,  presetMin: 4 },
    { id: 'TT-STECH',  name: 'Stechplatte 3 mm',                    kind: 'insert', lifeMin: 38,   cost: 18,  presetMin: 3, edges: 2 },
    { id: 'TT-MIKRO',  name: 'Mikro-Drehwerkzeug VCGT 1103',        kind: 'insert', lifeMin: 44,   cost: 22,  presetMin: 3, edges: 2 },
    { id: 'TT-ABST',   name: 'Abstechplatte 1,5 mm',                kind: 'insert', lifeMin: 36,   cost: 15,  presetMin: 3, edges: 2 },
    { id: 'TT-CNMGL',  name: 'WSP CNMG 190612 (Schwerzerspanung)',  kind: 'insert', lifeMin: 130,  cost: 26,  presetMin: 4, edges: 4 },
    { id: 'TT-DNMGL',  name: 'WSP DNMG 150608 (Schlichten)',        kind: 'insert', lifeMin: 60,   cost: 22,  presetMin: 4, edges: 4 },
    { id: 'TT-VHM10',  name: 'VHM-Schaftfräser Ø10 Z4',             kind: 'mill',   lifeMin: 46,   cost: 82,  presetMin: 5 },
    { id: 'TT-PF63',   name: 'Planfräser Ø63 (WSP)',                kind: 'mill',   lifeMin: 90,   cost: 64,  presetMin: 5 },
    { id: 'TT-DR85',   name: 'VHM-Bohrer Ø8,5',                     kind: 'drill',  lifeMin: 70,   cost: 74,  presetMin: 4 },
    { id: 'TT-GBM10',  name: 'Gewindebohrer M10',                   kind: 'drill',  lifeMin: 55,   cost: 39,  presetMin: 4 },
    { id: 'TT-VHM16',  name: 'VHM-Schaftfräser Ø16 Z4',             kind: 'mill',   lifeMin: 52,   cost: 118, presetMin: 5 },
    { id: 'TT-PF80',   name: 'Planfräser Ø80 (WSP)',                kind: 'mill',   lifeMin: 110,  cost: 72,  presetMin: 5 },
    { id: 'TT-DR10',   name: 'Bohrer Ø10 HSS-E',                    kind: 'drill',  lifeMin: 80,   cost: 21,  presetMin: 3 },
    { id: 'TT-BTA40',  name: 'BTA-Bohrkopf Ø40',                    kind: 'drill',  lifeMin: 260,  cost: 340, presetMin: 6 },
    { id: 'TT-ELB20',  name: 'Einlippenbohrer Ø20',                 kind: 'drill',  lifeMin: 190,  cost: 210, presetMin: 6 },
    { id: 'TT-WF2',    name: 'Wälzfräser m2 HSS-E',                 kind: 'hob',    lifeMin: 320,  cost: 640, presetMin: 6 },
    { id: 'TT-WF15',   name: 'Wälzfräser m1,5 HSS-E',               kind: 'hob',    lifeMin: 280,  cost: 520, presetMin: 6 },
    { id: 'TT-SSR',    name: 'Schleifscheibe Korund 500×63',        kind: 'wheel',  lifeMin: 1400, cost: 410, presetMin: 0, dressEvery: 12 },
    { id: 'TT-SSF',    name: 'Schleifscheibe Korund 350×40',        kind: 'wheel',  lifeMin: 1100, cost: 190, presetMin: 0, dressEvery: 10 },
  ];

  // ---------------------------------------------------------------- Rohmaterial
  // kanban: true = Rahmenvertrag mit Abruf – reicht der Bestand (+ Bestellungen) nicht mehr für den offenen Bedarf der
  // freigegebenen Aufträge, ruft die Kanban-Regel automatisch reorderQty (bzw. ein Vielfaches) ab. Mindestbestand-Warnungen
  // bleiben davon unberührt (Einkauf kann früher nachbestellen). Titan ELI wird auftragsbezogen mit Zeugnis bestellt.
  const materials = [
    { id: 'MAT-TI10',   name: 'Ti6Al4V ELI Ø10 h9', form: 'Stange', unit: 'm', onHand: 36, min: 24, reorderQty: 60, supplier: 'TitanTrade Europe (Beispiel)', leadMin: 360, pricePerUnit: 145, location: 'RAW', kanban: false },
    { id: 'MAT-14404',  name: '1.4404 Ø12 h9',      form: 'Stange', unit: 'm', onHand: 21, min: 12, reorderQty: 45, supplier: 'Edelstahl Service Ost (Beispiel)', leadMin: 240, pricePerUnit: 18, location: 'RAW', kanban: true },
    { id: 'MAT-42CR110',name: '42CrMo4+QT Ø110',    form: 'Stange', unit: 'm', onHand: 11.4, min: 6, reorderQty: 24, supplier: 'Stahlhandel Ost (Beispiel)', leadMin: 480, pricePerUnit: 62, location: 'RAW', kanban: true },
    { id: 'MAT-42CR65', name: '42CrMo4+QT Ø65',     form: 'Stange', unit: 'm', onHand: 24, min: 12, reorderQty: 36, supplier: 'Stahlhandel Ost (Beispiel)', leadMin: 360, pricePerUnit: 21, location: 'RAW', kanban: true },
    { id: 'MAT-16MNCR90',name: '16MnCr5 Ø90',       form: 'Stange', unit: 'm', onHand: 7.2, min: 3, reorderQty: 12, supplier: 'Stahlhandel Ost (Beispiel)', leadMin: 360, pricePerUnit: 38, location: 'RAW', kanban: true },
    { id: 'MAT-2842',   name: '1.2842 Flach 45×25', form: 'Stange', unit: 'm', onHand: 14, min: 6, reorderQty: 18, supplier: 'Werkzeugstahl Süd (Beispiel)', leadMin: 480, pricePerUnit: 44, location: 'RAW', kanban: true },
    { id: 'MAT-ALBL',   name: 'AlMgSi1 Zuschnitt 160×120×80', form: 'Stk', unit: 'Stk', onHand: 24, min: 20, reorderQty: 40, supplier: 'Alu Zuschnitt Wien (Beispiel)', leadMin: 300, pricePerUnit: 9.8, location: 'RAW', kanban: true },
    { id: 'MAT-GUSSLD', name: 'Rohguss Lagerdeckel EN-GJL-250', form: 'Stk', unit: 'Stk', onHand: 40, min: 10, reorderQty: 50, supplier: 'Gießerei Steiermark (Beispiel)', leadMin: 600, pricePerUnit: 18, location: 'RAW', kanban: true },
  ];

  // ---------------------------------------------------------------- Personal
  // Qualifikationen: Maschinen-Skill (saw, lathe, swiss, biglathe, mill5, mill3, deephole, hobber, cylgrinder,
  // surfgrinder, washer), 'setup' (Einrichten aller CNC), 'toolchange', 'qs', 'forklift', 'assembly', 'repair', 'lead'
  const people = [
    { id: 'P01', name: 'Stefan Huber',     role: 'Schichtleiter',          shift: 'F', skills: ['lead', 'setup', 'toolchange'], machines: [], home: { x: 59.5, z: 5 } },
    { id: 'P02', name: 'Ali Yilmaz',       role: 'Zerspanungstechniker',   shift: 'F', skills: ['lathe', 'swiss'], machines: ['M02', 'M03'], home: { x: 18, z: 20.6 } },
    { id: 'P03', name: 'Martina Gruber',   role: 'Zerspanungstechnikerin', shift: 'F', skills: ['mill5', 'mill3'], machines: ['M05', 'M06'], home: { x: 18, z: 23.4 } },
    { id: 'P04', name: 'Lukas Wagner',     role: 'Zerspanungstechniker',   shift: 'F', skills: ['biglathe', 'deephole'], machines: ['M04', 'M07'], home: { x: 38.5, z: 20.6 } },
    { id: 'P05', name: 'Jovana Petrović',  role: 'Schleiferin',            shift: 'F', skills: ['cylgrinder', 'surfgrinder', 'hobber'], machines: ['M09', 'M10', 'M08'], home: { x: 31, z: 23.4 } },
    { id: 'P06', name: 'Thomas Bauer',     role: 'Einrichter',             shift: 'F', skills: ['setup', 'toolchange', 'lathe', 'swiss', 'biglathe', 'mill5', 'mill3', 'deephole', 'hobber', 'cylgrinder', 'surfgrinder', 'saw'], machines: [], home: { x: 14.5, z: 5 } },
    { id: 'P07', name: 'Sabine Pichler',   role: 'Qualitätsprüferin',      shift: 'F', skills: ['qs'], machines: ['QS'], home: { x: 50.5, z: 29.5 } },
    { id: 'P08', name: 'Mehmet Kaya',      role: 'Logistiker',             shift: 'F', skills: ['forklift', 'saw', 'washer'], machines: ['M01', 'M11'], home: { x: 7.5, z: 20.6 } },
    { id: 'P09', name: 'Daniel Novak',     role: 'Monteur',                shift: 'F', skills: ['assembly'], machines: ['M13'], home: { x: 60, z: 15 } },
    { id: 'P10', name: 'Florian Moser',    role: 'Instandhalter',          shift: 'F', skills: ['repair'], machines: [], home: { x: 23, z: 4.5 } },
    { id: 'P11', name: 'Elif Demir',       role: 'Zerspanungstechnikerin', shift: 'S', skills: ['lathe', 'swiss', 'biglathe'], machines: ['M02', 'M03', 'M04'], home: { x: 18, z: 20.6 } },
    { id: 'P12', name: 'Markus Hofer',     role: 'Zerspanungstechniker',   shift: 'S', skills: ['mill5', 'mill3', 'deephole'], machines: ['M05', 'M06', 'M07'], home: { x: 18, z: 23.4 } },
    { id: 'P13', name: 'Katarina Horvat',  role: 'Schleiferin',            shift: 'S', skills: ['cylgrinder', 'surfgrinder', 'hobber'], machines: ['M08', 'M09', 'M10'], home: { x: 31, z: 23.4 } },
    { id: 'P14', name: 'Patrick Eder',     role: 'Einrichter',             shift: 'S', skills: ['setup', 'toolchange', 'repair', 'lathe', 'swiss', 'biglathe', 'mill5', 'mill3', 'deephole', 'hobber', 'cylgrinder', 'surfgrinder', 'saw'], machines: [], home: { x: 14.5, z: 5 } },
    { id: 'P15', name: 'Nina Leitner',     role: 'Qualitätsprüferin',      shift: 'S', skills: ['qs'], machines: ['QS'], home: { x: 50.5, z: 29.5 } },
    { id: 'P16', name: 'Ivan Kovač',       role: 'Logistiker',             shift: 'S', skills: ['forklift', 'saw', 'washer'], machines: ['M01', 'M11'], home: { x: 7.5, z: 20.6 } },
    { id: 'P17', name: 'Anna Steiner',     role: 'Monteurin',              shift: 'S', skills: ['assembly'], machines: ['M13'], home: { x: 60, z: 15 } },
  ];

  const agvs = [
    { id: 'AGV1', name: 'AGV 1', maxKg: 250, speed: 1.1, start: 'CHG', battery: 78 },
    { id: 'AGV2', name: 'AGV 2', maxKg: 250, speed: 1.1, start: 'CHG', battery: 64 },
  ];

  const shifts = [
    { id: 'F', name: 'Frühschicht', start: '06:00', end: '14:00', breaks: [['09:00', '09:15'], ['12:00', '12:30']] },
    { id: 'S', name: 'Spätschicht', start: '14:00', end: '22:00', breaks: [['17:00', '17:15'], ['19:30', '20:00']] },
  ];

  // ---------------------------------------------------------------- Störungskatalog
  const faults = {
    generic: [
      { code: 'ALM 1021', text: 'Kühlmitteldruck zu niedrig', cause: 'Filter verschmutzt oder Pumpe schwach', repairMin: [12, 25] },
      { code: 'ALM 2104', text: 'Späneförderer blockiert', cause: 'Spänenest im Förderer', repairMin: [8, 18] },
      { code: 'ALM 3340', text: 'Spindelüberlast', cause: 'Lastspitze – Schnittwerte prüfen', repairMin: [15, 30] },
      { code: 'ALM 4410', text: 'Werkzeugbruch erkannt (Bruchkontrolle)', cause: 'Werkzeugbruch – Teil Ausschuss, Werkzeug tauschen', repairMin: [10, 20], toolBreak: true },
      { code: 'ALM 5120', text: 'Hydraulikdruck niedrig', cause: 'Leckage oder Druckspeicher', repairMin: [20, 45] },
      { code: 'ALM 6001', text: 'Schutztür-Verriegelung gestört', cause: 'Türschalter verschmutzt', repairMin: [8, 15] },
    ],
    pallet:    [{ code: 'ALM 7310', text: 'Palettenwechsler: Endlage nicht erreicht', cause: 'Späne auf Palettenauflage', repairMin: [10, 22] }],
    barfeeder: [{ code: 'ALM 7120', text: 'Stangenlader: Stangenende nicht erkannt', cause: 'Sensor verschmutzt', repairMin: [8, 15] }],
    loader:    [{ code: 'ALM 7200', text: 'Portallader: Greifer-Endlage', cause: 'Greiferbacken verschlissen', repairMin: [12, 25] }],
    saw:       [{ code: 'E 31', text: 'Sägeband gerissen', cause: 'Bandbruch – Sägeband tauschen', repairMin: [15, 25], toolBreak: true }],
    deephole:  [{ code: 'ALM 8020', text: 'Bohrölstrom zu gering', cause: 'Bohrölfilter zugesetzt', repairMin: [15, 35] }],
    cylgrinder:[{ code: 'ALM 9140', text: 'Abrichtdiamant verschlissen', cause: 'Diamant drehen/tauschen', repairMin: [10, 18] }],
    surfgrinder:[{ code: 'NC 12', text: 'Magnetspannplatte: Spannkraft zu gering', cause: 'Kontakt / Steuergerät', repairMin: [12, 25] }],
    hobber:    [{ code: 'ALM 7650', text: 'Shiftachse Endlage', cause: 'Wälzfräser-Shiftweg ausgeschöpft', repairMin: [10, 20] }],
    washer:    [{ code: 'S7 0412', text: 'Waschmedium-Temperatur zu niedrig', cause: 'Heizregister', repairMin: [15, 30] }],
  };

  // ---------------------------------------------------------------- Aufträge
  // ext = Fremdbearbeitung (Station 'EXT'); 'QS' = Messraum; 'VERSAND' = Ablage am Ende (kein Bearbeitungsschritt)
  // char = Hauptmerkmal für Messwerte/SPC (driftAt100 = Maßabweichung bei 100 % Verschleiß)
  const HAERTEREI = 'Härterei Wolf GmbH (Beispiel)';
  const CHROM = 'Hartchrom Linz GmbH (Beispiel)';
  const CUST = {
    medivia: ['Medivia Implants GmbH', 'Medizintechnik'], alpen: ['AlpenRail Systems GmbH', 'Schienenfahrzeuge'],
    donau: ['Donau Verpackungstechnik (Schwesterfirma)', 'Maschinenbau intern'], hydrava: ['Hydrava Pumpen GmbH', 'Pumpenbau'],
    kaernten: ['Kärntner Antriebstechnik GmbH', 'Antriebstechnik'],
  };
  // Arbeitspläne der Varianten (auch vom Auftragseingang genutzt)
  const ROUTE = {
    GW7810: [ // Getriebewelle Ø110×780 – vergütet; Lagersitze und Passfedernut in einer Aufspannung auf der Millturn
      { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 5, transferBatch: 5, material: { id: 'MAT-42CR110', perPart: 0.8 }, tools: [{ type: 'TT-SB', cutMinPerPart: 4.2 }] },
      { seq: 20, op: 'Drehen und Nutfräsen komplett', station: 'M04', setupMin: 55, cycleMin: 40, transferBatch: 5, firstPiece: true,
        tools: [{ type: 'TT-CNMGL', cutMinPerPart: 20 }, { type: 'TT-DNMGL', cutMinPerPart: 8 }, { type: 'TT-VHM16', cutMinPerPart: 5 }],
        char: { name: 'Ø 95 m6 Lagersitz', nominal: 95.0205, tolMinus: -0.0075, tolPlus: 0.0075, unit: 'mm', sigma: 0.0022, driftAt100: 0.006 } },
      { seq: 30, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 6, transferBatch: 5 },
      { seq: 40, op: 'Versand', station: 'VERSAND' },
    ],
    KS1009: [ // Kolbenstange Ø100×900 – hartverchromt
      { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 4.5, transferBatch: 4, material: { id: 'MAT-42CR110', perPart: 0.92 }, tools: [{ type: 'TT-SB', cutMinPerPart: 3.8 }] },
      { seq: 20, op: 'Drehen', station: 'M04', setupMin: 45, cycleMin: 30, transferBatch: 4, firstPiece: true,
        tools: [{ type: 'TT-CNMGL', cutMinPerPart: 18 }, { type: 'TT-DNMGL', cutMinPerPart: 9 }],
        char: { name: 'Ø 100 f7', nominal: 99.947, tolMinus: -0.017, tolPlus: 0.017, unit: 'mm', sigma: 0.004, driftAt100: 0.008 } },
      { seq: 30, op: 'Hartverchromen', station: 'EXT', ext: { partner: CHROM, process: 'Hartverchromen 25 µm', leadMin: 600 }, transferBatch: 8 },
      { seq: 40, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 5, transferBatch: 4 },
      { seq: 50, op: 'Versand', station: 'VERSAND' },
    ],
    PD0416: [ // Pumpendeckel aus Alu-Zuschnitt
      { seq: 10, op: '5-Achs-Fräsen komplett', station: 'M05', setupMin: 50, cycleMin: 14, transferBatch: 10, firstPiece: true,
        material: { id: 'MAT-ALBL', perPart: 1 },
        tools: [{ type: 'TT-VHM10', cutMinPerPart: 4.5 }, { type: 'TT-PF63', cutMinPerPart: 2 }, { type: 'TT-DR85', cutMinPerPart: 1.5 }, { type: 'TT-GBM10', cutMinPerPart: 1 }],
        char: { name: 'Passung Ø 42 H7', nominal: 42.0125, tolMinus: -0.0125, tolPlus: 0.0125, unit: 'mm', sigma: 0.0035, driftAt100: -0.007 } },
      { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.4, transferBatch: 10 },
      { seq: 30, op: 'Prüfung KMG', station: 'QS', setupMin: 0, cycleMin: 3, transferBatch: 10 },
      { seq: 40, op: 'Versand', station: 'VERSAND' },
    ],
    DH0425: [ // Distanzhülse Ø12×25
      { seq: 10, op: 'Langdrehen komplett', station: 'M03', setupMin: 30, cycleMin: 1.1, transferBatch: 200, firstPiece: true,
        material: { id: 'MAT-14404', perPart: 0.029 }, tools: [{ type: 'TT-MIKRO', cutMinPerPart: 0.6 }, { type: 'TT-ABST', cutMinPerPart: 0.3 }],
        char: { name: 'Länge 25 ±0,02', nominal: 25.000, tolMinus: -0.020, tolPlus: 0.020, unit: 'mm', sigma: 0.004, driftAt100: 0.008 } },
      { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.05, transferBatch: 200 },
      { seq: 30, op: 'Losprüfung (Stichprobe)', station: 'QS', setupMin: 0, cycleMin: 0.03, transferBatch: 200 },
      { seq: 40, op: 'Versand', station: 'VERSAND' },
    ],
    FS0630: [ // Fixierstift Ø6×30 aus Titan
      { seq: 10, op: 'Langdrehen komplett', station: 'M03', setupMin: 40, cycleMin: 1.8, transferBatch: 100, firstPiece: true,
        material: { id: 'MAT-TI10', perPart: 0.036 }, tools: [{ type: 'TT-MIKRO', cutMinPerPart: 1.0 }, { type: 'TT-ABST', cutMinPerPart: 0.4 }],
        char: { name: 'Ø 6 h6', nominal: 6.000, tolMinus: -0.008, tolPlus: 0, unit: 'mm', sigma: 0.0011, driftAt100: -0.004 } },
      { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.1, transferBatch: 100 },
      { seq: 30, op: 'Losprüfung (Stichprobe)', station: 'QS', setupMin: 0, cycleMin: 0.06, transferBatch: 100 },
      { seq: 40, op: 'Versand', station: 'VERSAND' },
    ],
    AW4032: [ // Antriebswelle Ø40×320 – induktiv gehärtete Laufflächen (Toleranz h9, kein Schleifen)
      { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1.6, transferBatch: 15, material: { id: 'MAT-42CR65', perPart: 0.33 }, tools: [{ type: 'TT-SB', cutMinPerPart: 1.2 }] },
      { seq: 20, op: 'Drehfräsen komplett (inkl. Passfedernut)', station: 'M02', setupMin: 50, cycleMin: 10, transferBatch: 15, firstPiece: true,
        tools: [{ type: 'TT-CNMG', cutMinPerPart: 3.2 }, { type: 'TT-VNMG', cutMinPerPart: 2 }, { type: 'TT-STECH', cutMinPerPart: 0.6 }, { type: 'TT-VHM10', cutMinPerPart: 2.5 }],
        char: { name: 'Ø 40 k6', nominal: 40.010, tolMinus: -0.008, tolPlus: 0.008, unit: 'mm', sigma: 0.003, driftAt100: 0.007 } },
      { seq: 30, op: 'Induktionshärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Induktionshärten 52+4 HRC', leadMin: 360 }, transferBatch: 30 },
      { seq: 40, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 2, transferBatch: 15 },
      { seq: 50, op: 'Versand', station: 'VERSAND' },
    ],
    HK0050: [ // Hydraulikkolben Ø50×180
      { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1.6, transferBatch: 20, material: { id: 'MAT-42CR65', perPart: 0.19 }, tools: [{ type: 'TT-SB', cutMinPerPart: 1.2 }] },
      { seq: 20, op: 'Drehen', station: 'M02', setupMin: 40, cycleMin: 6.5, transferBatch: 20, firstPiece: true,
        tools: [{ type: 'TT-CNMG', cutMinPerPart: 2.6 }, { type: 'TT-VNMG', cutMinPerPart: 1.6 }, { type: 'TT-STECH', cutMinPerPart: 0.5 }],
        char: { name: 'Ø 50 f7', nominal: 49.9625, tolMinus: -0.0125, tolPlus: 0.0125, unit: 'mm', sigma: 0.0035, driftAt100: 0.007 } },
      { seq: 30, op: 'Tieflochbohren Ø20 × 160', station: 'M07', setupMin: 30, cycleMin: 7.5, transferBatch: 20, firstPiece: true,
        tools: [{ type: 'TT-ELB20', cutMinPerPart: 6 }] },
      { seq: 40, op: 'Rundschleifen', station: 'M09', setupMin: 30, cycleMin: 5, transferBatch: 20, firstPiece: true,
        tools: [{ type: 'TT-SSR', cutMinPerPart: 3.8 }],
        char: { name: 'Ø 50 f7 geschliffen', nominal: 49.9625, tolMinus: -0.008, tolPlus: 0.008, unit: 'mm', sigma: 0.0016, driftAt100: 0.003 } },
      { seq: 50, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.3, transferBatch: 20 },
      { seq: 60, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 1.2, transferBatch: 20 },
      { seq: 70, op: 'Versand', station: 'VERSAND' },
    ],
  };
  const PART = {
    GW7810: { no: 'GW-7810', name: 'Getriebewelle Ø110×780', material: '42CrMo4+QT', drawing: 'GW-7810 Rev. A', weightKg: 58 },
    KS1009: { no: 'KS-1009', name: 'Kolbenstange Ø100×900', material: '42CrMo4+QT', drawing: 'KS-1009 Rev. C', weightKg: 55 },
    PD0416: { no: 'PD-0416', name: 'Pumpendeckel', material: 'AlMgSi1', drawing: 'PD-0416 Rev. B', weightKg: 1.1 },
    DH0425: { no: 'DH-0425', name: 'Distanzhülse Ø12×25', material: '1.4404', drawing: 'DH-0425 Rev. A', weightKg: 0.014 },
    FS0630: { no: 'FS-0630', name: 'Fixierstift Ø6×30', material: 'Ti6Al4V ELI', drawing: 'FS-0630 Rev. B', weightKg: 0.004 },
    AW4032: { no: 'AW-4032', name: 'Antriebswelle Ø40×320', material: '42CrMo4+QT', drawing: 'AW-4032 Rev. A', weightKg: 3.2 },
    HK0050: { no: 'HK-0050', name: 'Hydraulikkolben Ø50×180', material: '42CrMo4+QT', drawing: 'HK-0050 Rev. A', weightKg: 2.8 },
  };
  const orders = [
    { id: 'FA-24117', customer: 'Medivia Implants GmbH', sector: 'Medizintechnik',
      part: { no: 'GB-1120', name: 'Gelenkbolzen Ø8×42', material: 'Ti6Al4V ELI', drawing: 'GB-1120 Rev. C', weightKg: 0.02 },
      qty: 400, due: at(1, '12:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Langdrehen komplett', station: 'M03', setupMin: 45, cycleMin: 2.4, transferBatch: 100, firstPiece: true,
          material: { id: 'MAT-TI10', perPart: 0.05 }, tools: [{ type: 'TT-MIKRO', cutMinPerPart: 1.4 }, { type: 'TT-ABST', cutMinPerPart: 0.5 }],
          char: { name: 'Ø 8 h6', nominal: 8.000, tolMinus: -0.009, tolPlus: 0, unit: 'mm', sigma: 0.0012, driftAt100: -0.004 } },
        { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.12, transferBatch: 100 },
        { seq: 30, op: 'Losprüfung (Stichprobe)', station: 'QS', setupMin: 0, cycleMin: 0.08, transferBatch: 100 },
        { seq: 40, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 10, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-MIKRO': 30, 'TT-ABST': 12 }, barStockM: 6,
        ops: { 10: { done: 160, atOutput: 60 }, 20: { done: 100 }, 30: { done: 100 }, 40: { atInput: [100] } } } },

    { id: 'FA-24118', customer: 'AlpenRail Systems GmbH', sector: 'Schienenfahrzeuge',
      part: { no: 'AW-7740', name: 'Achswelle Ø110×1850', material: '42CrMo4+QT', drawing: 'AW-7740 Rev. B', weightKg: 140 },
      qty: 12, due: at(1, '16:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 6, transferBatch: 3, material: { id: 'MAT-42CR110', perPart: 1.9 }, tools: [{ type: 'TT-SB', cutMinPerPart: 5 }] },
        { seq: 20, op: 'Drehen Außenkontur', station: 'M04', setupMin: 60, cycleMin: 48, transferBatch: 3, firstPiece: true,
          tools: [{ type: 'TT-CNMGL', cutMinPerPart: 30 }, { type: 'TT-DNMGL', cutMinPerPart: 12 }],
          char: { name: 'Ø 105 k6 Lagersitz', nominal: 105.015, tolMinus: -0.012, tolPlus: 0.010, unit: 'mm', sigma: 0.003, driftAt100: 0.008 } },
        { seq: 30, op: 'Tieflochbohren Ø40 × 1850', station: 'M07', setupMin: 40, cycleMin: 62, transferBatch: 3, firstPiece: true,
          tools: [{ type: 'TT-BTA40', cutMinPerPart: 55 }],
          char: { name: 'Mittenversatz Bohrung', nominal: 0.15, tolMinus: -0.15, tolPlus: 0.35, unit: 'mm', sigma: 0.05, driftAt100: 0.12 } },
        { seq: 40, op: 'Induktionshärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Induktionshärten 55+3 HRC', leadMin: 360 }, transferBatch: 3 },
        { seq: 50, op: 'Rundschleifen Lagersitze', station: 'M09', setupMin: 35, cycleMin: 38, transferBatch: 3, firstPiece: true,
          tools: [{ type: 'TT-SSR', cutMinPerPart: 30 }],
          char: { name: 'Ø 105 k6 geschliffen', nominal: 105.013, tolMinus: -0.010, tolPlus: 0.012, unit: 'mm', sigma: 0.0018, driftAt100: 0.004 } },
        { seq: 60, op: 'Endprüfung 100 %', station: 'QS', setupMin: 0, cycleMin: 12, transferBatch: 3 },
        { seq: 70, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 20, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-CNMGL': 90, 'TT-DNMGL': 24 },
        ops: { 10: { done: 12 }, 20: { done: 4, atInput: [2, 3, 3], atOutput: 1 }, 30: { atInput: [3] } } } },

    { id: 'FA-24119', customer: 'Donau Verpackungstechnik (Schwesterfirma)', sector: 'Maschinenbau intern',
      part: { no: 'ZR-3802', name: 'Zahnrad m2 z38', material: '16MnCr5', drawing: 'ZR-3802 Rev. A', weightKg: 0.9 },
      qty: 60, due: at(2, '10:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1.2, transferBatch: 30, material: { id: 'MAT-16MNCR90', perPart: 0.045 }, tools: [{ type: 'TT-SB', cutMinPerPart: 0.9 }] },
        { seq: 20, op: 'Drehen Rohling', station: 'M02', setupMin: 50, cycleMin: 5.5, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-CNMG', cutMinPerPart: 2.2 }, { type: 'TT-VNMG', cutMinPerPart: 1.4 }, { type: 'TT-DR68', cutMinPerPart: 0.6 }],
          char: { name: 'Bohrung Ø 30 H7', nominal: 30.010, tolMinus: -0.010, tolPlus: 0.011, unit: 'mm', sigma: 0.003, driftAt100: -0.006 } },
        { seq: 30, op: 'Wälzfräsen Verzahnung', station: 'M08', setupMin: 45, cycleMin: 8.5, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-WF2', cutMinPerPart: 7.5 }],
          char: { name: 'Zahnweite W4', nominal: 21.480, tolMinus: -0.040, tolPlus: 0, unit: 'mm', sigma: 0.006, driftAt100: 0.012 } },
        { seq: 40, op: 'Einsatzhärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Einsatzhärten 58–62 HRC', leadMin: 480 }, transferBatch: 20 },
        { seq: 50, op: 'Bohrung schleifen', station: 'M09', setupMin: 30, cycleMin: 4.5, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-SSR', cutMinPerPart: 3.5 }] },
        { seq: 60, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 0.5, transferBatch: 20 },
        { seq: 70, op: 'Montage Antriebsbaugruppe', station: 'M13', setupMin: 0, cycleMin: 6, transferBatch: 20 },
        { seq: 80, op: 'Versand (intern)', station: 'VERSAND' },
      ],
      initial: { ops: {} } },

    { id: 'FA-24120', customer: 'Hydrava Pumpen GmbH', sector: 'Pumpenbau',
      part: { no: 'PG-0415', name: 'Pumpengehäuse', material: 'AlMgSi1', drawing: 'PG-0415 Rev. D', weightKg: 2.4 },
      qty: 30, due: at(1, '09:00'), priority: 'normal',
      routing: [
        { seq: 10, op: '5-Achs-Fräsen komplett', station: 'M05', setupMin: 70, cycleMin: 28, transferBatch: 10, firstPiece: true,
          material: { id: 'MAT-ALBL', perPart: 1 },
          tools: [{ type: 'TT-VHM10', cutMinPerPart: 9 }, { type: 'TT-PF63', cutMinPerPart: 4 }, { type: 'TT-DR85', cutMinPerPart: 2 }, { type: 'TT-GBM10', cutMinPerPart: 1.5 }],
          char: { name: 'Passung Ø 52 H7', nominal: 52.015, tolMinus: -0.015, tolPlus: 0.015, unit: 'mm', sigma: 0.004, driftAt100: -0.008 } },
        { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.5, transferBatch: 10 },
        { seq: 30, op: 'Prüfung KMG', station: 'QS', setupMin: 0, cycleMin: 4, transferBatch: 10 },
        { seq: 40, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 10, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-VHM10': 27, 'TT-PF63': 30, 'TT-DR85': 20, 'TT-GBM10': 10 },
        ops: { 10: { done: 8, atInput: [10], atOutput: 8 } } } },

    { id: 'FA-24121', customer: 'Kärntner Antriebstechnik GmbH', sector: 'Antriebstechnik',
      part: { no: 'FL-2210', name: 'Führungsleiste 400×40×20', material: '1.2842', drawing: 'FL-2210 Rev. A', weightKg: 2.5 },
      qty: 40, due: at(2, '14:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 2, transferBatch: 20, material: { id: 'MAT-2842', perPart: 0.41 }, tools: [{ type: 'TT-SB', cutMinPerPart: 1.6 }] },
        { seq: 20, op: 'Fräsen 3-Achs', station: 'M06', setupMin: 40, cycleMin: 12, transferBatch: 10, firstPiece: true,
          tools: [{ type: 'TT-VHM16', cutMinPerPart: 6 }, { type: 'TT-PF80', cutMinPerPart: 3 }, { type: 'TT-DR10', cutMinPerPart: 1 }] },
        { seq: 30, op: 'Vakuumhärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Vakuumhärten 58 HRC', leadMin: 420 }, transferBatch: 20 },
        { seq: 40, op: 'Flachschleifen', station: 'M10', setupMin: 25, cycleMin: 9, transferBatch: 10, firstPiece: true,
          tools: [{ type: 'TT-SSF', cutMinPerPart: 7 }],
          char: { name: 'Dicke 20 ±0,01', nominal: 20.000, tolMinus: -0.010, tolPlus: 0.010, unit: 'mm', sigma: 0.0025, driftAt100: 0.004 } },
        { seq: 50, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 3, transferBatch: 10 },
        { seq: 60, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { ops: { 10: { done: 40 }, 20: { atInput: [20, 20] } } } },

    { id: 'FA-24122', customer: 'Hydrava Pumpen GmbH', sector: 'Pumpenbau',
      part: { no: 'HK-0060', name: 'Hydraulikkolben Ø60×220', material: '42CrMo4+QT', drawing: 'HK-0060 Rev. B', weightKg: 4.9 },
      qty: 80, due: at(2, '18:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1.8, transferBatch: 20, material: { id: 'MAT-42CR65', perPart: 0.226 }, tools: [{ type: 'TT-SB', cutMinPerPart: 1.4 }] },
        { seq: 20, op: 'Drehen', station: 'M02', setupMin: 45, cycleMin: 7.5, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-CNMG', cutMinPerPart: 3 }, { type: 'TT-VNMG', cutMinPerPart: 1.8 }, { type: 'TT-STECH', cutMinPerPart: 0.6 }],
          char: { name: 'Ø 60 f7', nominal: 59.955, tolMinus: -0.015, tolPlus: 0.015, unit: 'mm', sigma: 0.004, driftAt100: 0.008 } },
        { seq: 30, op: 'Tieflochbohren Ø20 × 200', station: 'M07', setupMin: 30, cycleMin: 9, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-ELB20', cutMinPerPart: 7 }] },
        { seq: 40, op: 'Rundschleifen', station: 'M09', setupMin: 30, cycleMin: 6, transferBatch: 20, firstPiece: true,
          tools: [{ type: 'TT-SSR', cutMinPerPart: 4.5 }],
          char: { name: 'Ø 60 f7 geschliffen', nominal: 59.955, tolMinus: -0.010, tolPlus: 0.010, unit: 'mm', sigma: 0.0018, driftAt100: 0.003 } },
        { seq: 50, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.3, transferBatch: 20 },
        { seq: 60, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 1.2, transferBatch: 20 },
        { seq: 70, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { ops: {} } },

    { id: 'FA-24123', customer: 'Medivia Implants GmbH', sector: 'Medizintechnik',
      part: { no: 'DH-0412', name: 'Distanzhülse Ø12×18', material: '1.4404', drawing: 'DH-0412 Rev. A', weightKg: 0.01 },
      qty: 600, due: at(3, '12:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Langdrehen komplett', station: 'M03', setupMin: 35, cycleMin: 0.9, transferBatch: 200, firstPiece: true,
          material: { id: 'MAT-14404', perPart: 0.022 }, tools: [{ type: 'TT-MIKRO', cutMinPerPart: 0.5 }, { type: 'TT-ABST', cutMinPerPart: 0.25 }],
          char: { name: 'Länge 18 ±0,02', nominal: 18.000, tolMinus: -0.020, tolPlus: 0.020, unit: 'mm', sigma: 0.004, driftAt100: 0.008 } },
        { seq: 20, op: 'Reinigen', station: 'M11', setupMin: 5, cycleMin: 0.05, transferBatch: 200 },
        { seq: 30, op: 'Losprüfung (Stichprobe)', station: 'QS', setupMin: 0, cycleMin: 0.03, transferBatch: 200 },
        { seq: 40, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { ops: {} } },

    { id: 'FA-24124', customer: 'AlpenRail Systems GmbH', sector: 'Schienenfahrzeuge',
      part: { no: 'LD-5530', name: 'Lagerdeckel', material: 'EN-GJL-250', drawing: 'LD-5530 Rev. C', weightKg: 6 },
      qty: 50, due: at(1, '14:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Fräsen und Bohren', station: 'M06', setupMin: 35, cycleMin: 10, transferBatch: 10, firstPiece: true,
          material: { id: 'MAT-GUSSLD', perPart: 1 },
          tools: [{ type: 'TT-PF80', cutMinPerPart: 3 }, { type: 'TT-DR10', cutMinPerPart: 1.5 }, { type: 'TT-VHM16', cutMinPerPart: 2 }],
          char: { name: 'Zentrierung Ø 140 h8', nominal: 139.968, tolMinus: -0.031, tolPlus: 0.031, unit: 'mm', sigma: 0.008, driftAt100: 0.015 } },
        { seq: 20, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 2.5, transferBatch: 10 },
        { seq: 30, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 10, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-PF80': 40, 'TT-DR10': 20, 'TT-VHM16': 30 },
        ops: { 10: { done: 12, atInput: [10], atOutput: 2 }, 20: { done: 10 }, 30: { atInput: [10] } } } },

    { id: 'FA-24125', customer: 'Donau Verpackungstechnik (Schwesterfirma)', sector: 'Maschinenbau intern',
      part: { no: 'RZ-1517', name: 'Ritzel m1,5 z17', material: '16MnCr5', drawing: 'RZ-1517 Rev. B', weightKg: 0.25 },
      qty: 120, due: at(2, '12:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Drehen Rohling', station: 'M02', setupMin: 30, cycleMin: 2.5, transferBatch: 40, tools: [{ type: 'TT-CNMG', cutMinPerPart: 1 }] },
        { seq: 20, op: 'Wälzfräsen Verzahnung', station: 'M08', setupMin: 40, cycleMin: 3.2, transferBatch: 40, firstPiece: true,
          tools: [{ type: 'TT-WF15', cutMinPerPart: 2.8 }],
          char: { name: 'Zahnweite W3', nominal: 11.620, tolMinus: -0.030, tolPlus: 0, unit: 'mm', sigma: 0.005, driftAt100: 0.010 } },
        { seq: 30, op: 'Einsatzhärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Einsatzhärten 58–62 HRC', leadMin: 480 }, transferBatch: 40 },
        { seq: 40, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 0.4, transferBatch: 40 },
        { seq: 50, op: 'Montage Antriebsbaugruppe', station: 'M13', setupMin: 0, cycleMin: 2, transferBatch: 40 },
        { seq: 60, op: 'Versand (intern)', station: 'VERSAND' },
      ],
      initial: { activeSeq: 20, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-WF15': 90 },
        ops: { 10: { done: 120 }, 20: { done: 30, atInput: [10, 40, 40], atOutput: 30 } } } },

    { id: 'FA-24126', customer: 'Kärntner Antriebstechnik GmbH', sector: 'Antriebstechnik',
      part: { no: 'SB-0812', name: 'Spannbacke gehärtet', material: '1.2842', drawing: 'SB-0812 Rev. A', weightKg: 1.1 },
      qty: 24, due: at(0, '14:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Sägen', station: 'M01', setupMin: 10, cycleMin: 1, transferBatch: 24, material: { id: 'MAT-2842', perPart: 0.12 }, tools: [{ type: 'TT-SB', cutMinPerPart: 0.8 }] },
        { seq: 20, op: 'Fräsen 3-Achs', station: 'M06', setupMin: 30, cycleMin: 8, transferBatch: 24, tools: [{ type: 'TT-VHM16', cutMinPerPart: 4 }] },
        { seq: 30, op: 'Vakuumhärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Vakuumhärten 58 HRC', leadMin: 420 }, transferBatch: 24 },
        { seq: 40, op: 'Flachschleifen', station: 'M10', setupMin: 20, cycleMin: 7, transferBatch: 12, firstPiece: true,
          tools: [{ type: 'TT-SSF', cutMinPerPart: 5.5 }],
          char: { name: 'Parallelität 0,01', nominal: 0.004, tolMinus: -0.004, tolPlus: 0.006, unit: 'mm', sigma: 0.0015, driftAt100: 0.003 } },
        { seq: 50, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 3, transferBatch: 12 },
        { seq: 60, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 40, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-SSF': 300 },
        ops: { 10: { done: 24 }, 20: { done: 24 }, 30: { done: 24 }, 40: { done: 4, atInput: [12, 8], atOutput: 4 } } } },

    { id: 'FA-24127', customer: 'Kärntner Antriebstechnik GmbH', sector: 'Antriebstechnik',
      part: { no: 'LZ-3060', name: 'Lagerzapfen gehärtet Ø30', material: '1.7225', drawing: 'LZ-3060 Rev. B', weightKg: 1.6 },
      qty: 36, due: at(0, '18:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Drehen', station: 'M02', setupMin: 40, cycleMin: 4, transferBatch: 12, tools: [{ type: 'TT-CNMG', cutMinPerPart: 2 }] },
        { seq: 20, op: 'Induktionshärten', station: 'EXT', ext: { partner: HAERTEREI, process: 'Induktionshärten 54+4 HRC', leadMin: 360 }, transferBatch: 36 },
        { seq: 30, op: 'Rundschleifen', station: 'M09', setupMin: 30, cycleMin: 5, transferBatch: 12, firstPiece: true,
          tools: [{ type: 'TT-SSR', cutMinPerPart: 4 }],
          char: { name: 'Ø 30 g6', nominal: 29.986, tolMinus: -0.006, tolPlus: 0.006, unit: 'mm', sigma: 0.0016, driftAt100: 0.003 } },
        { seq: 40, op: 'Prüfung', station: 'QS', setupMin: 0, cycleMin: 1.5, transferBatch: 12 },
        { seq: 50, op: 'Versand', station: 'VERSAND' },
      ],
      initial: { activeSeq: 30, setupDone: true, fpiReleased: true, toolsUsed: { 'TT-SSR': 200 },
        ops: { 10: { done: 36 }, 20: { done: 36 }, 30: { done: 6, atInput: [12, 12, 6], atOutput: 6 } } } },

    { id: 'FA-24128', customer: 'Donau Verpackungstechnik (Schwesterfirma)', sector: 'Maschinenbau intern',
      part: { no: 'ZM-12', name: 'Zuführmodul ZM-12 (Baugruppe)', material: 'Baugruppe', drawing: 'ZM-12 Stückliste Rev. F', weightKg: 18 },
      qty: 4, due: at(1, '10:00'), priority: 'normal',
      routing: [
        { seq: 10, op: 'Montage Zuführmodul', station: 'M13', setupMin: 0, cycleMin: 90, transferBatch: 4 },
        { seq: 20, op: 'Versand (intern)', station: 'VERSAND' },
      ],
      initial: { activeSeq: 10, setupDone: true, fpiReleased: true, ops: { 10: { atInput: [4] } } } },
  ];
  // freigegebener Auftragsvorrat (noch nicht begonnen, Termine Do … übernächster Fr) – jede Maschine hat ab Start
  // ca. 1–2 Tage Warteschlange; danach hält der Auftragseingang (profile.orderTemplates) den Vorrat
  const rt = (id) => orders.find(o => o.id === id).routing;
  const part = (id) => Object.assign({}, orders.find(o => o.id === id).part);
  const book = (id, c, p, qty, due, routing, note) => ({ id, customer: CUST[c][0], sector: CUST[c][1], part: p, qty, due, priority: 'normal', note: note || '', routing, initial: { ops: {} } });
  orders.push(
    book('FA-24129', 'alpen',    PART.GW7810, 10,  at(3, '14:00'), ROUTE.GW7810),
    book('FA-24130', 'donau',    part('FA-24128'), 4, at(3, '12:00'), rt('FA-24128')),
    book('FA-24131', 'hydrava',  part('FA-24120'), 30, at(3, '16:00'), rt('FA-24120'), 'Wiederholauftrag'),
    book('FA-24132', 'hydrava',  PART.PD0416, 30,  at(4, '12:00'), ROUTE.PD0416),
    book('FA-24133', 'kaernten', part('FA-24121'), 30, at(4, '14:00'), rt('FA-24121'), 'Wiederholauftrag'),
    book('FA-24134', 'medivia',  PART.DH0425, 500, at(4, '10:00'), ROUTE.DH0425),
    book('FA-24135', 'hydrava',  PART.KS1009, 8,   at(7, '12:00'), ROUTE.KS1009),
    book('FA-24136', 'kaernten', part('FA-24126'), 36, at(7, '10:00'), rt('FA-24126'), 'Wiederholauftrag'),
    book('FA-24137', 'medivia',  PART.FS0630, 300, at(7, '14:00'), ROUTE.FS0630),
    book('FA-24138', 'donau',    part('FA-24125'), 120, at(8, '12:00'), rt('FA-24125'), 'Wiederholauftrag'),
    book('FA-24139', 'kaernten', PART.AW4032, 30,  at(8, '14:00'), ROUTE.AW4032),
    book('FA-24140', 'alpen',    part('FA-24118'), 6, at(9, '12:00'), rt('FA-24118'), 'Wiederholauftrag'),
    book('FA-24141', 'hydrava',  PART.HK0050, 40,  at(11, '12:00'), ROUTE.HK0050),
  );

  // ---------------------------------------------------------------- Auftragseingang (Wiederhol-/Variantenaufträge)
  // Deterministisch über den geseedeten Eingangs-RNG: Menge aus [min, max, Schritt], Termin = jetzt + dueDays
  // Werktage (Mo–Fr 06–22), weight = relative Häufigkeit. Freigabe belastungsorientiert (Engine: intakeTick).
  const tpl = (id, c, p, qty, dueDays, weight, routing, note) => ({ id, customer: CUST[c][0], sector: CUST[c][1], part: p, qty, dueDays, weight, routing, note: note || '' });
  const orderTemplates = [
    tpl('T-HK0060', 'hydrava',  part('FA-24122'), [40, 80, 10],   [3, 4], 3, rt('FA-24122'), 'Abruf aus Rahmenvertrag'),
    tpl('T-HK0050', 'hydrava',  PART.HK0050,      [30, 60, 10],   [3, 4], 2, ROUTE.HK0050, 'Abruf aus Rahmenvertrag'),
    tpl('T-PG0415', 'hydrava',  part('FA-24120'), [20, 40, 10],   [2, 3], 2, rt('FA-24120'), 'Wiederholauftrag'),
    tpl('T-PD0416', 'hydrava',  PART.PD0416,      [30, 60, 10],   [2, 3], 2, ROUTE.PD0416, 'Wiederholauftrag'),
    tpl('T-KS1009', 'hydrava',  PART.KS1009,      [4, 10, 2],     [3, 4], 1, ROUTE.KS1009, 'Angebot angenommen'),
    tpl('T-GB1120', 'medivia',  part('FA-24117'), [200, 400, 50], [2, 3], 2, rt('FA-24117'), 'Abruf aus Rahmenvertrag (Zeugnis 3.1)'),
    tpl('T-FS0630', 'medivia',  PART.FS0630,      [200, 400, 100],[2, 4], 1, ROUTE.FS0630, 'Angebot angenommen (Zeugnis 3.1)'),
    tpl('T-DH0412', 'medivia',  part('FA-24123'), [400, 800, 100],[2, 3], 2, rt('FA-24123'), 'Abruf aus Rahmenvertrag'),
    tpl('T-DH0425', 'medivia',  PART.DH0425,      [300, 600, 100],[2, 3], 2, ROUTE.DH0425, 'Wiederholauftrag'),
    tpl('T-AW7740', 'alpen',    part('FA-24118'), [3, 9, 3],      [4, 4], 1, rt('FA-24118'), 'Abruf aus Rahmenvertrag'),
    tpl('T-GW7810', 'alpen',    PART.GW7810,      [5, 10, 5],     [3, 4], 1, ROUTE.GW7810, 'Angebot angenommen'),
    tpl('T-LD5530', 'alpen',    part('FA-24124'), [30, 60, 10],   [2, 3], 1, rt('FA-24124'), 'Wiederholauftrag'),
    tpl('T-ZR3802', 'donau',    part('FA-24119'), [40, 80, 20],   [3, 4], 1, rt('FA-24119'), 'interner Bedarf Montage'),
    tpl('T-RZ1517', 'donau',    part('FA-24125'), [80, 160, 40],  [3, 4], 1, rt('FA-24125'), 'interner Bedarf Montage'),
    tpl('T-ZM12',   'donau',    part('FA-24128'), [2, 6, 2],      [2, 3], 2, rt('FA-24128'), 'interner Bedarf'),
    tpl('T-FL2210', 'kaernten', part('FA-24121'), [20, 40, 10],   [3, 4], 2, rt('FA-24121'), 'Wiederholauftrag'),
    tpl('T-SB0812', 'kaernten', part('FA-24126'), [24, 48, 12],   [3, 4], 2, rt('FA-24126'), 'Wiederholauftrag'),
    tpl('T-LZ3060', 'kaernten', part('FA-24127'), [24, 48, 12],   [3, 4], 1, rt('FA-24127'), 'Wiederholauftrag'),
    tpl('T-AW4032', 'kaernten', PART.AW4032,      [20, 40, 10],   [3, 4], 2, ROUTE.AW4032, 'Angebot angenommen'),
  ];

  WF.profile = {
    company: {
      name: 'Donau Präzisionstechnik GmbH',
      site: 'Werk Donaustadt',
      address: '1220 Wien',
      employees: 46,
      revenueHint: 'ca. 6,8 Mio. € Umsatz',
      description: 'Lohnfertiger für Präzisions-Dreh-, Fräs- und Schleifteile (Medizintechnik, Schienenfahrzeuge, Maschinenbau) mit eigener Montage für die Schwesterfirma Donau Verpackungstechnik.',
      demoNote: 'Fiktiver Beispielbetrieb, Profil angelehnt an typische Wiener Zerspanungsbetriebe. Alle Daten simuliert.',
    },
    // Kosten – EINE Quelle für Engine, Analyse und Copilot (WF.sim.costs()):
    //  · Strompreis energyEurPerKwh (Industrietarif netto inkl. Netzentgelt) → Energiekosten (kpis().energyEurToday, machineView().energyEurToday)
    //  · Maschinenstundensätze stehen je Station in stations[].rate (€/h, Maschine inkl. Bediener) → Stillstandskosten lossEur
    //  · labourEurPerHour = Personal-Vollkostensatz (Einrichter/Facharbeiter), overtimeSurchargePct = Überstundenzuschlag
    costs: {
      currency: 'EUR',
      energyEurPerKwh: 0.19,
      labourEurPerHour: 48,
      overtimeSurchargePct: 50,
      machineRates: 'stations[].rate',
    },
    hall: {
      w: 64, d: 40, height: 9,
      doors: [
        { id: 'D-WE', name: 'Tor Wareneingang', wall: 'front', x: 2, w: 5.5 },
        { id: 'D-EXT', name: 'Tor Fremdbearbeitung', wall: 'front', x: 45.5, w: 7 },
        { id: 'D-VS', name: 'Tor Versand', wall: 'front', x: 57.5, w: 5 },
      ],
      columns: [16, 32, 48].flatMap(x => [{ x, z: 10.6 }, { x, z: 33.4 }]),
      areas: [ // Bodenbeschriftungen
        { name: 'Zuschnitt', x: 5, z: 12.2 }, { name: 'Dreherei', x: 24, z: 12.2 }, { name: 'Sonderbearbeitung', x: 45, z: 13.4 },
        { name: 'Verzahnung', x: 53.2, z: 12.4 }, { name: 'Fräserei', x: 17, z: 31.6 }, { name: 'Schleiferei', x: 31, z: 30 },
        { name: 'Reinigung', x: 39.7, z: 29.8 }, { name: 'Montage', x: 60, z: 10.2 },
      ],
    },
    graph,
    stations,
    stationById: Object.fromEntries(stations.map(s => [s.id, s])),
    machines: ['M01', 'M02', 'M03', 'M04', 'M07', 'M08', 'M05', 'M06', 'M09', 'M10', 'M11', 'QS', 'M13'],
    toolTypes,
    toolTypeById: Object.fromEntries(toolTypes.map(t => [t.id, t])),
    materials,
    people,
    agvs,
    shifts,
    faults,
    orders,
    orderTemplates,
    sim: {
      seed: 20241014,
      startT: at(0, '06:00'),
      warmupUntilT: at(0, '08:40'),
      defaultSpeed: 30,
      speeds: [10, 30, 120, 600],
      toolPolicy: { planAtParts: 2, fetchMin: 3, changeMin: [3, 6] },
      fpiPassProb: 0.94,
      walkSpeed: 1.3,
      forkliftSpeed: 2.0,
      agvLoadSec: 30,
      historyStepSec: 300,
      // Auftragseingang: Freigabe zu Schichtbeginn (perShift Aufträge, solange der Arbeitsvorrat < backlogMaxDays) und
      // jederzeit in der Schichtzeit, wenn < openMin offene Aufträge oder Vorrat < backlogMinDays (Abstand ≥ minGapMin);
      // Maschinen mit > stationMaxDays Vorrat bekommen keine neuen Aufträge (belastungsorientierte Freigabe)
      intake: { openMin: 9, openMax: 40, backlogMinDays: 1.0, backlogMaxDays: 2.0, stationMaxDays: 2.5, perShift: [1, 2], minGapMin: 20,
        eilProb: 0.05, notifyMin: 30, maxSameOpen: 2 },
      archiveAfterH: 72,     // fertige Aufträge (inkl. Behälter, Messwerte) werden nach 72 h aus dem Zustand entfernt
      shipPickupH: 2,        // Spedition holt Fertigteile ca. 2 h nach Auftragsende ab (Lieferfenster 06–20 Uhr)
    },
  };
})();
