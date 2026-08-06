// M4 proof: settings edit (applies next session) + hire-from-the-office, both
// through the 3D UI against the live daemon on :4519.
import { chromium } from '@playwright/test';

const base = 'http://localhost:4519';
const ev = (n) => `evidence/${n}.png`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1890, height: 1060 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`${base}/?v=${Date.now()}`);
await page.waitForTimeout(2600);

// --- settings: scout, effort low -> medium ---
await page.evaluate(() => window.CC.openAgent('scout', 'chat'));
await page.waitForTimeout(2400);
await page.click('#rail .mtabs button[data-tab="settings"]');
await page.waitForTimeout(500);
await page.screenshot({ path: ev('m4-1-settings') });
await page.selectOption('#setEffort', 'medium');
await page.click('#setSave');
await page.waitForSelector('#setMsg:has-text("saved")', { timeout: 10_000 });
await page.screenshot({ path: ev('m4-2-settings-saved') });
console.log('settings saved');

// --- hire: digger from its vacant desk row ---
await page.keyboard.press('Escape'); // close agent sheet, stay focused on Research
await page.waitForTimeout(700);
await page.click('#railRows .vacantRow');
await page.waitForTimeout(700);
await page.fill('#hireInstr', 'You are DIGGER, a research agent. When given a task, dig one level deeper than SCOUT: verify claims against sources in the brain and produce a short verified-facts list.');
await page.selectOption('#hireModel', 'haiku');
await page.selectOption('#hireEffort', 'low');
await page.screenshot({ path: ev('m4-3-hire-form') });
await page.click('#hireGo');
await page.waitForSelector('#hireMsg:has-text("hired")', { timeout: 20_000 });
console.log('hired — waiting for reload…');
await page.waitForTimeout(1200); // reload fires
await page.waitForTimeout(4200); // scene rebuild + focus fly-in
await page.screenshot({ path: ev('m4-4-hired-at-desk') });
console.log('done');
await browser.close();
