// M3 proof: full approval round-trip through the 3D office UI against the live
// daemon (real claude sessions). Screenshots at every beat into evidence/.
import { chromium } from '@playwright/test';

const base = 'http://localhost:4519';
const ev = (n) => `evidence/${n}.png`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1890, height: 1060 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`${base}/?v=${Date.now()}`);
await page.waitForTimeout(2600);

// open scout's chat at its desk
await page.evaluate(() => window.CC.openAgent('scout', 'chat'));
await page.waitForTimeout(2600);
await page.screenshot({ path: ev('m3-1-chat-open') });

// ask for an outbound email — this must QUEUE, not send
await page.fill('#mIn', 'Use your send_email tool to email test@example.com, subject "Command Centre test", body: one friendly line saying the office is live.');
await page.click('#mSend');
console.log('sent chat — waiting for the approval card…');
await page.waitForSelector('.m-appr .a-btns', { timeout: 240_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: ev('m3-2-approval-queued') });
console.log('approval queued');

// REJECT with notes
await page.click('.m-appr .a-no');
await page.fill('.m-appr .a-note input', 'Change the subject to exactly: Office up and running — then re-queue.');
await page.screenshot({ path: ev('m3-3-reject-notes') });
await page.click('.m-appr .a-send');
console.log('rejected with notes — waiting for the revised approval…');

// wait for a SECOND approval card (pending buttons) whose text carries the new subject
await page.waitForFunction(() => {
  const cards = [...document.querySelectorAll('.m-appr')];
  return cards.some(c => c.querySelector('.a-btns') && /Office up and running/i.test(c.textContent));
}, { timeout: 300_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: ev('m3-4-revised-queued') });
console.log('revised approval queued');

// APPROVE the revised one
const cards = page.locator('.m-appr').filter({ hasText: 'Office up and running' });
await cards.locator('.a-yes').first().click();
console.log('approved — waiting for the release…');
await page.waitForFunction(() =>
  [...document.querySelectorAll('.m-agent, .m-work')].some(el => /Sent|sent/.test(el.textContent) && /Office up and running|outbox|Recorded/i.test(el.textContent))
  || [...document.querySelectorAll('.m-work')].some(el => /Sent:/.test(el.textContent)),
{ timeout: 300_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: ev('m3-5-approved-released') });
console.log('released');

await browser.close();
