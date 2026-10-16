// Smoke-Test der gebauten App: alle Ansichten öffnen, Konsole auf Fehler prüfen, Screenshots ablegen.
// Aufruf: node werkfluss/test/smoke.mjs [ausgabeordner]   (baut vorher dist/werkfluss.html)
// Benötigt das global installierte Playwright (Chromium unter /opt/pw-browsers).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] || join(root, 'test', 'shots');
mkdirSync(out, { recursive: true });
execSync(`node ${join(root, 'build.mjs')}`, { stdio: 'inherit' });

const globalRoot = execSync('npm root -g').toString().trim();
const require = createRequire(import.meta.url);
const { chromium } = require(join(globalRoot, 'playwright'));

const url = 'file://' + join(root, 'dist', 'werkfluss.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;

for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 400, height: 860 }]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1500);
  const views = await page.evaluate(() => WF.views.map(v => v.id));
  for (const id of views) {
    await page.evaluate((v) => WF.app.navigate(v), id);
    await page.waitForTimeout(id === 'halle' ? 2500 : 900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push(`horizontal overflow in view ${id}`);
    await page.screenshot({ path: join(out, `${vp.name}-${id}.png`) });
  }
  // Detail-Drawer, Benachrichtigungen, Copilot
  await page.evaluate(() => WF.app.navigate('leitstand'));
  await page.evaluate(() => WF.app.select('machine', 'M05'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${vp.name}-detail-machine.png`) });
  await page.evaluate(() => WF.app.closeDrawer());
  await page.evaluate(() => WF.bus.emit('ai:open', {}));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${vp.name}-copilot.png`) });
  const sim = await page.evaluate(() => ({ t: WF.sim.clock(), kpis: WF.sim.kpis() }));
  console.log(`[${vp.name}] views=${views.length} sim=${sim.t} oee=${(sim.kpis.oee * 100).toFixed(1)}%`);
  if (errors.length) { failures += errors.length; console.log(`[${vp.name}] ERRORS:\n  ` + [...new Set(errors)].join('\n  ')); }
  await page.close();
}
await browser.close();
console.log(failures ? `SMOKE FAIL (${failures} Fehler) – Screenshots in ${out}` : `SMOKE OK – Screenshots in ${out}`);
process.exit(failures ? 1 : 0);
