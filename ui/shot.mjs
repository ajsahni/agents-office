// Headless screenshot verification against a RUNNING daemon.
//   node ui/shot.mjs http://localhost:4519 evidence/prefix
// Hash-only navigation doesn't reload — every shot carries a ?v= cache-buster.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4477';
const prefix = process.argv[3] ?? 'ui/shots/shot';

const shots = [
  { name: 'far', hash: '#zoom=1' },
  { name: 'mid', hash: '#zoom=1.9' },
  { name: 'focus', hash: '', after: async (page) => {
    await page.evaluate(() => window.CC.enterFocus(Object.keys(window.CC.deptRT)[0]));
    await page.waitForTimeout(2200);
  } },
];

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1890, height: 1060 } });
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

for (const s of shots) {
  await page.goto(`${base}/?v=${Date.now()}${s.hash}`);
  await page.waitForTimeout(s.wait || 2600);
  if (s.after) await s.after(page);
  await page.screenshot({ path: `${prefix}-${s.name}.png` });
  console.log('shot:', `${prefix}-${s.name}.png`);
}
await browser.close();
