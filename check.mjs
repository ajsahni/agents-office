// Agents Office — the build loop (Beta).
//   node check.mjs             build + offline smoke + server smoke (no Claude calls)
//   CHECK_LIVE=1 node check.mjs  … plus one real routed task and one chat turn through Claude
// Every step prints ✓ or ✗ with the reason; the process exits 1 if anything failed. This is the
// loop the Beta was built against: change something, run it, fix what is red, repeat.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';

const results = [];
const ok = (name, detail = '') => { results.push([true, name, detail]); console.log(`✓ ${name}${detail ? '  — ' + detail : ''}`); };
const bad = (name, detail = '') => { results.push([false, name, detail]); console.log(`✗ ${name}${detail ? '  — ' + detail : ''}`); };
const step = async (name, fn) => { try { const d = await fn(); ok(name, d || ''); return true; } catch (e) { bad(name, e.message); return false; } };
const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, ...opts }); let out = '', err = '';
  p.stdout?.on('data', d => { out += d; }); p.stderr?.on('data', d => { err += d; });
  p.on('close', c => c === 0 ? resolve(out) : reject(new Error((err || out).trim().split('\n').slice(-3).join(' | '))));
  p.on('error', reject);
});
const cfg = loadConfig();
const LIVE = process.env.CHECK_LIVE === '1';

/* ---------- 1. build ---------- */
await step('build: braingraph + bundle', async () => {
  const out = await sh('node', ['build.mjs']);
  const html = fs.readFileSync(path.join(ROOT, 'command-centre-v2.html'), 'utf8');
  if (html.length < 500000) throw new Error('bundle looks too small: ' + html.length);
  if (!/AGENTS OFFICE/.test(html)) throw new Error('shell missing');
  return out.trim().split('\n').pop();
});
await step('build: graph has linked notes', async () => {
  const { BRAIN } = await import('./src/braingraph.js?' + Date.now());
  if (!BRAIN.nodes.length || !BRAIN.links.length) throw new Error('empty graph');
  if (!BRAIN.floor || BRAIN.floor.length < Math.min(90, BRAIN.nodes.length)) throw new Error('floor layout missing');
  return `${BRAIN.notes} notes · ${BRAIN.nodes.length} linked · ${BRAIN.links.length} links`;
});

/* ---------- 2. offline smoke (Playwright) ---------- */
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { try { ({ chromium } = await import('playwright-core')); } catch {} }
if (!chromium) bad('smoke: playwright', 'not installed — npm i -D playwright-core (uses your Chrome)');
else {
  let browser = null;
  try {
    try { browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
    catch { browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
    const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    await page.goto('file://' + path.join(ROOT, 'command-centre-v2.html') + '?s=check'); await page.waitForTimeout(3000);
    await step('smoke: loads without page errors', async () => { if (errors.length) throw new Error(errors[0]); });
    await step('smoke: 33 agents at their desks', async () => { const n = await page.evaluate(() => Object.keys(window.CC.R).length); if (n !== 33) throw new Error('agents: ' + n); return n + ' agents'; });
    await step('smoke: six department cards + the Brain tag', async () => {
      const t = await page.evaluate(() => [...document.querySelectorAll('.badge .b-name')].map(e => e.textContent.trim()));
      for (const k of ['EMAILS', 'SALES', 'MARKETING', 'OPERATIONS', 'FINANCE', 'DELIVERY', 'THE BRAIN']) if (!t.some(x => x.startsWith(k))) throw new Error('missing card ' + k);
    });
    await step('smoke: task panel has rows and counts', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('.tp-row').length); if (n < 10) throw new Error('rows: ' + n);
      const chips = await page.evaluate(() => document.querySelectorAll('.tp-chip').length); if (chips !== 5) throw new Error('chips: ' + chips);
      return n + ' rows';
    });
    await step('smoke: command bar adds a task in demo mode', async () => {
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
      await page.fill('.tp-in', 'cut a 15 second teaser from the demo reel'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added/.test(hint)) throw new Error('hint: ' + hint);
      const row = await page.evaluate(() => [...document.querySelectorAll('.tp-row .tp-t')].some(e => /teaser/i.test(e.textContent))); if (!row) throw new Error('row not in the feed');
      return hint.trim().slice(0, 60);
    });
    await step('smoke: department focus opens the chat rail', async () => {
      await page.keyboard.press('1'); await page.waitForTimeout(1800);
      const cls = await page.evaluate(() => document.getElementById('rail').className); if (!/agentOpen/.test(cls) || !/open/.test(cls)) throw new Error('rail: ' + cls);
      const strip = await page.evaluate(() => document.querySelector('#topconn').className); if (!/focus/.test(strip)) throw new Error('top strip not centred');
      await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    });
    await step('smoke: B opens and closes the company board', async () => {
      await page.keyboard.press('b'); await page.waitForTimeout(700);
      if (!(await page.evaluate(() => window.CC.tasks.isOpen()))) throw new Error('board did not open');
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      if (await page.evaluate(() => window.CC.tasks.isOpen())) throw new Error('board did not close');
    });
    await step('smoke: G opens the Brain graph with notes', async () => {
      await page.keyboard.press('g'); await page.waitForTimeout(700);
      if (!(await page.evaluate(() => window.CC.brain.isOpen()))) throw new Error('graph did not open');
      const n = await page.evaluate(() => window.CC.brain.nodes.length); if (n < 10) throw new Error('nodes: ' + n);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      if (await page.evaluate(() => window.CC.brain.isOpen())) throw new Error('graph did not close');
      return n + ' notes';
    });
    await step('smoke: approval flow reaches the panel', async () => {
      await page.evaluate(() => window.CC.requestApproval('ada')); await page.waitForTimeout(600);
      const w = await page.evaluate(() => document.querySelectorAll('.tp-row.waiting').length); if (!w) throw new Error('no waiting row');
    });
    await step('smoke: no errors after the run', async () => { if (errors.length) throw new Error(errors[0]); });
  } catch (e) { bad('smoke: browser', e.message); }
  finally { if (browser) await browser.close(); }
}

/* ---------- 3. server smoke ---------- */
{
  const port = 4600 + Math.floor(Math.random() * 300);
  const env = { ...process.env, PORT: String(port) };
  const srv = spawn('node', ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  const up = await (async () => { for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 250)); } return null; })();
  if (!up) bad('server: starts', log.trim().split('\n').slice(-2).join(' | ') || 'no health response');
  else {
    ok('server: starts', `${up.name} · ${up.backend} · brain ${up.notes} notes`);
    await step('server: serves the office', async () => { const r = await fetch(base + '/'); const t = await r.text(); if (!/AGENTS OFFICE/.test(t)) throw new Error('html missing'); });
    await step('server: /api/brain has the live graph', async () => { const g = await (await fetch(base + '/api/brain')).json(); if (!g.nodes.length) throw new Error('empty'); return `${g.nodes.length} linked notes`; });
    await step('server: rejects an empty task', async () => { const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"dept":"sales","text":""}' }); if (r.status !== 400) throw new Error('status ' + r.status); });
    if (LIVE) {
      await step('live: Claude routes a task', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'reply to a client asking when their September report will arrive' }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json(); globalThis.__t = t; return `${t.agent} · ${t.title}`;
      });
      await step('live: the agent delivers and the note is saved', async () => {
        const t = globalThis.__t; if (!t) throw new Error('no task'); const r = await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' });
        if (!r.ok) throw new Error((await r.json()).error); const d = await r.json(); if (d.error) throw new Error(d.result);
        const notePath = path.join(cfg.brainPath, 'Agents Office', d.note + '.md'); if (!fs.existsSync(notePath)) throw new Error('note not written: ' + notePath);
        return `${d.result.length} chars · read ${d.read.join(', ')} · ${d.note}.md`;
      });
      await step('live: chat answers in persona', async () => {
        const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'lexi', text: 'what is our proposal win rate?' }) });
        if (!r.ok) throw new Error((await r.json()).error); const j = await r.json(); if (!j.reply) throw new Error('empty reply'); return j.reply.slice(0, 80).replace(/\n/g, ' ');
      });
      if (chromium) await step('live: the whole flow in a browser', async () => {
        let browser; try { browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
        try {
          const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
          const errs = []; page.on('pageerror', e => errs.push(e.message));
          await page.goto(base + '/'); await page.waitForTimeout(3500);
          const mode = await page.evaluate(() => document.querySelector('.tp-mode').textContent); if (!/LIVE/.test(mode)) throw new Error('panel not live: ' + mode);
          const before = await page.evaluate(() => window.CC.brain.nodes.length);
          const known = await page.evaluate(() => window.CC.tasks.tasks.filter(t => t.live).map(t => t.id));
          await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
          await page.fill('.tp-in', 'write three hook lines for a reel about why most businesses ignore their inbox'); await page.keyboard.press('Enter');
          await page.waitForFunction(() => /Added|couldn/i.test(document.querySelector('.tp-hint').textContent), { timeout: 150000 });
          const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added/.test(hint)) throw new Error(hint);
          const mine = await page.evaluate(k => window.CC.tasks.tasks.find(t => t.live && !k.includes(t.id))?.id, known); if (!mine) throw new Error('the new task is not in the panel');
          await page.waitForFunction(id => { const t = window.CC.tasks.tasks.find(x => x.id === id); return t && t.state === 'done'; }, mine, { timeout: 240000 });
          const done = await page.evaluate(id => { const t = window.CC.tasks.tasks.find(x => x.id === id); return { error: t.error, note: t.note, read: t.read }; }, mine);
          if (done.error) throw new Error('task failed');
          await page.waitForTimeout(2500);
          await page.click(`.tp-row[data-id="${mine}"]`); await page.waitForTimeout(2500);
          const card = await page.evaluate(n => [...document.querySelectorAll('.m-file .f-name')].some(e => e.textContent === n + '.md'), done.note); if (!card) throw new Error('deliverable card not in the chat');
          const after = await page.evaluate(() => window.CC.brain.nodes.length);
          if (after <= before) throw new Error(`brain graph did not grow (${before} → ${after})`);
          if (errs.length) throw new Error(errs[0]);
          return `${hint.trim().slice(0, 50)} · ${done.note}.md in the chat · brain ${before} → ${after} notes`;
        } finally { await browser.close(); }
      });
    } else ok('live: skipped', 'set CHECK_LIVE=1 to route one task and one chat through Claude');
  }
  srv.kill();
}

/* ---------- summary ---------- */
const fails = results.filter(r => !r[0]);
console.log(`\n${fails.length ? '✗' : '✓'} ${results.length - fails.length}/${results.length} checks passed${fails.length ? ' — ' + fails.map(f => f[1]).join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
