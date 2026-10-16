// Build: fügt shell.html + styles.css + vendor (Three.js) + src/*.js zu einer HTML-Datei zusammen.
//   node werkfluss/build.mjs                         → werkfluss/dist/werkfluss.html (alle Module)
//   node werkfluss/build.mjs --out /tmp/x.html       → andere Ausgabedatei
//   node werkfluss/build.mjs --only 30_hall3d.js,41_orders.js
//        → nur Basismodule (00, 05, 10, 20, 99) + die genannten Module (für isolierte Tests einzelner Ansichten)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const out = resolve(arg('--out') || join(root, 'dist', 'werkfluss.html'));
const only = arg('--only') ? arg('--only').split(',').map(s => s.trim()).filter(Boolean) : null;
const BASE = ['00_core.js', '05_profile.js', '10_sim.js', '20_app.js', '99_boot.js'];

const read = (p) => readFileSync(p, 'utf8');
// '</script' darf in eingebettetem JS nicht vorkommen
const safeJs = (code) => code.replace(/<\/script/gi, '<\\/script');

const shell = read(join(src, 'shell.html'));
const style = read(join(src, 'styles.css'));
const vendor = ['three.min.js', 'OrbitControls.js']
  .map(f => `/* vendor/${f} – MIT License, siehe vendor/THREE_LICENSE */\n` + read(join(root, 'vendor', f)))
  .join('\n;\n');
let files = readdirSync(src).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
if (only) files = files.filter(f => BASE.includes(f) || only.includes(f));
// Jedes Modul in einem eigenen <script>: ein Fehler (auch Syntaxfehler) in einem Modul reißt die anderen nicht mit
const scripts = files.map(f => `<script data-module="${f}">\n/* ===== src/${f} ===== */\n${safeJs(read(join(src, f)))}\n</script>`).join('\n');

const html = shell
  .replace('%%STYLE%%', () => style)
  .replace('%%VENDOR%%', () => safeJs(vendor))
  .replace(/<script>\s*%%SCRIPT%%\s*<\/script>/, () => scripts);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB  (${files.length} Module: ${files.join(', ')})`);
