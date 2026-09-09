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
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'command-centre-v2.html'), 'utf8');
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

/* ---------- 1b. the roster + the connector parser ---------- */
await step('roster: office.agents.json validates', async () => {
  const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster();
  if (r.agents.length !== 35) throw new Error('agents: ' + r.agents.length);
  if (r.problems.length) throw new Error(r.problems.join(' | '));
  return `35 agents · ${r.customised} customised${r.files.length ? ' · ' + r.files.join(' + ') : ''}`;
});
await step('roster: bad edits are refused, not applied', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'newt', name: 'PODCAST NOTES', department: 'sales', lead: true, colour: 'red' }, { id: 'ghost', name: 'X' }] });
  const n = r.agents.find(a => a.id === 'newt');
  if (n.name !== 'PODCAST NOTES' || n.department !== 'marketing' || n.lead) throw new Error('validation let a fixed field through');
  if (r.problems.length < 4) throw new Error('expected four problems, got ' + r.problems.length);
});
await step('roster: brief is accepted and trimmed', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'piper', brief: ['Three tiers.', 'Never discount.'] }, { id: 'lexi', brief: 'x'.repeat(2500) }] });
  if (r.agents.find(a => a.id === 'piper').brief !== 'Three tiers.\nNever discount.') throw new Error('list brief not joined');
  if (r.agents.find(a => a.id === 'lexi').brief.length !== 2000 || !r.problems.some(p => /brief is over/.test(p))) throw new Error('long brief not trimmed with a warning');
});
await step('skills: shipped skills load and bind', async () => {
  const { loadSkills } = await import('./skills.mjs'); const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster(); const sk = loadSkills(cfg.brainPath, r.agents);
  if (sk.problems.length) throw new Error(sk.problems.join(' | '));
  const piper = r.agents.find(a => a.id === 'piper'), cmail = r.agents.find(a => a.id === 'cmail'), lexi = r.agents.find(a => a.id === 'lexi');
  if (!sk.names(piper).includes('proposal')) throw new Error('proposal not bound to piper: ' + sk.names(piper));
  if (!sk.names(cmail).includes('client-reply') || sk.names(lexi).includes('client-reply')) throw new Error('department binding wrong');
  if (!sk.names(lexi).includes('house-style')) throw new Error('unbound skill did not reach everyone');
  const txt = sk.promptText(piper); if (!/--- template\.md ---/.test(txt) || !/### proposal/.test(txt)) throw new Error('files beside SKILL.md not inlined');
  const sum = sk.summary();
  return `${sum.count} skills (${sum.shipped} shipped, ${sum.brain} in the brain) · ` + sum.skills.map(x => `${x.name}→${x.everyone ? 'everyone' : [...x.agents, ...x.departments].join('+')}`).join(' ');
});
await step('skills: a broken skill is refused, not applied', async () => {
  const { loadSkills } = await import('./skills.mjs'); const { loadRoster } = await import('./roster.mjs');
  const os = await import('node:os'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-skills-')); const dir = path.join(tmp, 'Agents Office', 'skills');
  fs.mkdirSync(path.join(dir, 'ghost'), { recursive: true }); fs.mkdirSync(path.join(dir, 'nofile')); fs.mkdirSync(path.join(dir, 'proposal'));
  fs.writeFileSync(path.join(dir, 'ghost', 'SKILL.md'), '---\nagents: [nobody]\ncolour: red\n---\n# Ghost\nDo things.');
  fs.writeFileSync(path.join(dir, 'proposal', 'SKILL.md'), '---\ndescription: Our own proposal skill\nagents: [piper]\n---\n# Ours\nThe brain version.');
  fs.writeFileSync(path.join(dir, 'oneliner.md'), '---\ndepartments: [fin]\n---\nMonth-end pack rules.');
  const sk = loadSkills(tmp, loadRoster().agents); fs.rmSync(tmp, { recursive: true, force: true });
  if (sk.skills.some(x => x.name === 'ghost')) throw new Error('a skill with no valid binding was loaded');
  if (!sk.problems.some(p => /nobody/.test(p)) || !sk.problems.some(p => /colour/.test(p)) || !sk.problems.some(p => /nofile/.test(p))) throw new Error('problems not reported: ' + sk.problems.join(' | '));
  const prop = sk.skills.find(x => x.name === 'proposal'); if (!prop || prop.source !== 'brain' || prop.description !== 'Our own proposal skill') throw new Error('the brain skill did not replace the shipped one');
  if (!sk.skills.find(x => x.name === 'oneliner' && x.departments.includes('fin'))) throw new Error('one-file skill not loaded');
  return `${sk.problems.length} problems reported · brain proposal wins`;
});
await step('lessons: a correction is recorded and standing rules come back', async () => {
  const learn = await import('./learn.mjs'); const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-learn-')); const a = { id: 'piper', name: 'PROPOSALS', role: 'x', does: 'y' };
  learn.record(tmp, a, { title: 'Harbourside proposal' }, 'add the booking integration for this one', { standing: false, rule: '' });
  learn.record(tmp, a, { title: 'Harbourside proposal' }, 'too long — proposals are always one page', { standing: true, rule: 'Keep every proposal to one page.' });
  learn.record(tmp, a, { title: 'Marina quote' }, 'never quote a discount', { standing: true, rule: 'Never offer a discount.' });
  const r = learn.read(tmp, 'piper'); const txt = learn.promptText(tmp, a); fs.rmSync(tmp, { recursive: true, force: true });
  if (r.rules.length !== 2 || r.oneOffs.length !== 1) throw new Error(`rules ${r.rules.length} one-offs ${r.oneOffs.length}`);
  if (!/^LESSONS/.test(txt) || !/one page/.test(txt) || /booking integration/.test(txt) || /←/.test(txt)) throw new Error('prompt text wrong: ' + txt);
  if (learn.promptText(tmp, { id: 'nobody' })) throw new Error('no file should mean no block');
  return `${r.rules.length} standing rules · ${r.oneOffs.length} one-off · agent with no file gets nothing`;
});
await step('interview: the lead asks five questions, then writes briefs + a skill into the brain', async () => {
  const onboard = await import('./onboard.mjs'); const { loadRoster } = await import('./roster.mjs'); const { loadSkills } = await import('./skills.mjs'); const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-onboard-')); const brain = path.join(tmp, 'brain'), data = path.join(tmp, 'data'); fs.mkdirSync(brain);
  const agents = loadRoster(brain).agents; const dept = agents.filter(a => a.department === 'sales'); const lead = dept.find(a => a.lead);
  const stub = async () => JSON.stringify({ briefs: [{ id: 'lexi', brief: 'Every deal gets a next step with a date.' }, { id: 'piper', brief: 'Three options, recommend the middle.' }, { id: 'ghost', brief: 'x' }],
    skill: { name: 'Wholesale Quote', description: 'How we quote a wholesale account', agents: ['piper'], body: '# Quoting a wholesale account\nUse this for any quote to a trade customer.\n## Steps\n1. Check the account in 30-Customers.\n## The shape\nFollow template.md.\n## Rules\n- Never discount.', template: '# Quote for {account}\n## Lines\n## Terms' }, try: 'quote Harbour Hardware for 40 units' });
  const ctx = { dept: 'sales', deptName: 'Sales', lead, agents: dept, connected: ['Gmail'], brainPath: brain, dataDir: data, ask: stub, business: 'Test Co' };
  if (await onboard.handle('what are you working on?', ctx) !== null) throw new Error('ordinary chat was captured');
  const r0 = await onboard.handle('set up', ctx); if (!/Question 1 of 5/.test(r0.reply) || !onboard.active(data, 'sales')) throw new Error('did not start: ' + r0.reply.slice(0, 80));
  const r1 = await onboard.handle('We sell to trade accounts.', ctx); if (!/Question 2 of 5/.test(r1.reply)) throw new Error('no second question');
  await onboard.handle('Quoting a wholesale account: check the account, price from the ladder, send.', ctx); await onboard.handle('skip', ctx); await onboard.handle('never discount', ctx);
  const r5 = await onboard.handle('Gmail and our bookkeeper', ctx);
  if (onboard.active(data, 'sales')) throw new Error('interview still active after the last answer');
  if (!r5.wrote || r5.wrote.briefs.length !== 2 || !r5.wrote.skill || r5.wrote.skill.name !== 'wholesale-quote') throw new Error('write-up wrong: ' + JSON.stringify(r5.wrote));
  if (!r5.wrote.problems.some(p => /ghost/.test(p))) throw new Error('an agent outside the department was accepted');
  const merged = loadRoster(brain); if (merged.agents.find(a => a.id === 'piper').brief !== 'Three options, recommend the middle.' || merged.problems.length) throw new Error('brief not merged into the brain roster: ' + merged.problems);
  const sk = loadSkills(brain, merged.agents); const w = sk.skills.find(x => x.name === 'wholesale-quote');
  if (!w || w.source !== 'brain' || !w.agents.includes('piper') || !w.files.some(f => f.name === 'template.md') || sk.problems.length) throw new Error('skill not loadable: ' + sk.problems);
  if (!onboard.isSetUp(merged.agents, sk, 'sales') || onboard.isSetUp(merged.agents, sk, 'fin')) throw new Error('setUp flag wrong');
  const c = await onboard.handle('set up', ctx); await onboard.handle('cancel', ctx); if (onboard.active(data, 'sales')) throw new Error('cancel did not clear');
  fs.rmSync(tmp, { recursive: true, force: true });
  return `5 questions · 2 briefs merged · skill wholesale-quote→piper with template · sales set up, fin not · cancel clears`;
});
await step('connectors: claude mcp list parses', async () => {
  const m = await import('./mcp.mjs');
  const l = m.parseList('Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nclaude.ai Meta Ads: https://mcp.facebook.com/ads - ! Needs authentication\nplaywright: npx -y @playwright/mcp@latest - ✔ Connected');
  if (l.length !== 3) throw new Error('parsed ' + l.length);
  if (l[0].id !== 'claude_ai_Gmail' || l[0].key !== 'gmail' || l[0].status !== 'connected') throw new Error('gmail: ' + JSON.stringify(l[0]));
  if (l[1].status !== 'needs-auth' || l[1].key !== 'meta') throw new Error('meta: ' + JSON.stringify(l[1]));
  if (l[2].depts.length !== 2) throw new Error('playwright depts: ' + l[2].depts);
});

/* ---------- 1c. routines (V3.5) ---------- */
await step('routines: plain words become a schedule', async () => {
  const w = await import('./src/when.js');
  const cases = [
    ['every weekday at 8am, triage the inbox and tell me what needs me', 'every weekday · 08:00', 'triage the inbox and tell me what needs me'],
    ['Every Monday 9am, list the overdue invoices and draft the reminders', 'Mondays · 09:00', 'list the overdue invoices and draft the reminders'],
    ["match today's bank lines to invoices, daily at 5:30pm", 'every day · 17:30', "match today's bank lines to invoices"],
    ['every hour between 9am and 5pm on weekdays, qualify new leads', 'every hour 09:00–17:00 · weekdays', 'qualify new leads'],
    ['chase quiet deals every tuesday and thursday at 10', 'Tue, Thu · 10:00', 'chase quiet deals'],
    ['on fridays at 4pm this week\'s cash position', 'Fridays · 16:00', "this week's cash position"],
    ['every 2 minutes say hello', 'every 2 min', 'say hello'],
    ['every weekend at noon, check the queue', 'weekends · 12:00', 'check the queue'],
  ];
  for (const [text, desc, task] of cases) {
    const r = w.parseWhen(text); if (!r) throw new Error('no schedule found in: ' + text);
    if (w.describe(r.when) !== desc) throw new Error(`"${text}" → ${w.describe(r.when)}, expected ${desc}`);
    if (r.text !== task) throw new Error(`"${text}" → task "${r.text}", expected "${task}"`);
    if (!w.valid(r.when) || !(w.nextRun(r.when) > Date.now())) throw new Error('no next run for ' + desc);
  }
  if (w.parseWhen('reply to a client asking when their September report will arrive within 24 hours')) throw new Error('a plain task was read as a routine');
  const t = w.parseWhen('every weekday, triage the inbox'); if (!t || !t.needsTime) throw new Error('missing time not asked back');
  const g = w.parseWhen('every morning triage the inbox'); if (!g || g.when.at !== '08:00' || !g.guessed) throw new Error('"morning" not taken as 08:00 with a flag');
  const d = w.parseWhen('weekly at 3pm list renewals'); if (!d || !d.needsDay) throw new Error('weekly with no day not asked back');
  const now = new Date('2026-09-09T17:05:00').getTime(); // a Wednesday
  const nx = w.nextRun({ kind: 'weekly', days: [1], at: '09:00' }, now); if (new Date(nx).getDay() !== 1 || new Date(nx).getHours() !== 9) throw new Error('Monday 09:00 not next');
  if (w.untilText(now + 120000, now) !== 'in 2 min' || w.untilText(w.fromPicker('fri', '16:00') && nx, now) !== 'Mon 09:00') throw new Error('countdown text');
  return `${cases.length} phrasings · asks back for a missing time or day · "morning" → 08:00 flagged`;
});
await step('routines: outside Emails, Accounting and Sales is refused, bad ones named', async () => {
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs'); const agents = loadRoster().agents;
  const bad = rt.validate({ id: 'x', dept: 'marketing', agent: 'iggy', text: 'post the reel', when: { kind: 'daily', at: '09:00' } }, agents);
  if (!bad.problems.some(p => /later release/.test(p))) throw new Error('marketing routine not refused: ' + bad.problems);
  if (!/Emails, Accounting and Sales/.test(rt.refusal('ops'))) throw new Error('refusal sentence');
  const wrong = rt.validate({ dept: 'fin', agent: 'ghost', text: 'x', when: { kind: 'weekly', days: [] } }, agents);
  if (!wrong.problems.some(p => /no agent/.test(p)) || !wrong.problems.some(p => /not complete/.test(p))) throw new Error('unknown agent / incomplete schedule not named: ' + wrong.problems);
  const cross = rt.validate({ dept: 'fin', agent: 'lexi', text: 'x', when: { kind: 'daily', at: '09:00' } }, agents);
  if (!cross.problems.some(p => /is in Sales, not Accounting/.test(p))) throw new Error('cross-department agent not named: ' + cross.problems);
  const good = rt.validate({ dept: 'emails', agent: 'elead', text: 'Triage the overnight inbox', when: { kind: 'weekdays', at: '08:00' } }, agents);
  if (good.problems.length || good.routine.id !== 'triage-the-overnight-inbox' || good.routine.needsOk !== true) throw new Error('a good routine did not validate: ' + JSON.stringify(good));
  const dup = rt.validate({ id: 'triage-the-overnight-inbox', dept: 'emails', agent: 'elead', text: 'x', when: { kind: 'daily', at: '09:00' } }, agents, [good.routine]);
  if (!dup.problems.some(p => /share this id/.test(p))) throw new Error('duplicate id not named');
  if (rt.guessNeedsOk('list the overdue invoices') || !rt.guessNeedsOk('send the reminders') || !rt.guessNeedsOk('draft replies to unanswered client emails')) throw new Error('needs-OK guess');
  return 'marketing refused · unknown agent, wrong department, incomplete schedule, duplicate id all named · needsOk defaults on';
});
await step('routines: due fires once, a missed run catches up marked LATE, then the clock moves on', async () => {
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs'); const os = await import('node:os');
  const agents = loadRoster().agents; const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-routines-')); const data = path.join(brain, 'data');
  rt.save(brain, [{ id: 'a', dept: 'emails', agent: 'elead', title: 'A', text: 'triage', when: { kind: 'weekdays', at: '08:00' } }, { id: 'p', dept: 'sales', agent: 'folo', title: 'P', text: 'chase', when: { kind: 'daily', at: '10:00' }, paused: true, needsOk: false }]);
  const l = rt.load(brain, agents); if (l.problems.length || l.routines.length !== 2) throw new Error('load: ' + l.problems);
  const st = rt.loadState(data); const now = Date.now();
  const { list } = rt.withState(l.routines, st, now); if (!(st.a.nextAt > now) || list.find(r => r.id === 'p').nextAt !== null) throw new Error('nextAt not set / paused not null');
  if (rt.due(l.routines, st, now).length) throw new Error('fired before its time');
  st.a.nextAt = now - 2 * 3600 * 1000; st.p.nextAt = now - 3600 * 1000; // the office was off for two hours
  const d = rt.due(l.routines, st, now); if (d.length !== 1 || d[0].routine.id !== 'a' || !d[0].late) throw new Error('catch-up wrong: ' + JSON.stringify(d.map(x => [x.routine.id, x.late])));
  rt.advance(st, l.routines[0], now, 't1', true); rt.saveState(data, st);
  if (!(st.a.nextAt > now) || st.a.runs !== 1 || !st.a.lastLate) throw new Error('advance did not move the clock on');
  if (rt.due(l.routines, st, now).length) throw new Error('fired twice');
  const s2 = rt.loadState(data); if (s2.a.lastTaskId !== 't1') throw new Error('state not saved');
  const soon = { kind: 'minutes', every: 2 }; st.a.nextAt = now - 30 * 1000; const d2 = rt.due(l.routines, st, now); if (d2.length !== 1 || d2[0].late) throw new Error('a run 30 s past its minute is not late');
  const m = rt.matchRoutine(list, 'emails', 'the triage one'); if (!m || m.id !== 'a') throw new Error('match by words');
  fs.rmSync(brain, { recursive: true, force: true });
  return 'due once · 2 h late → one catch-up marked LATE · paused never fires · state persists · words match a routine';
});

/* ---------- 1d. models + the usage gauge (V3.6) ---------- */
await step('models: three names + five effort levels, one precedence, the right CLI flags', async () => {
  const m = await import('./src/models.js');
  if (JSON.stringify(m.MODEL_KEYS) !== '["sonnet","opus","fable"]' || m.DEFAULT_MODEL !== 'sonnet') throw new Error('keys/default');
  if (m.normModel('Opus') !== 'opus' || m.normModel('claude-sonnet-5') !== 'sonnet' || m.normModel('haiku') !== null || m.normModel('') !== null) throw new Error('normModel');
  const p = (o) => m.modelFor(o); 
  if (p({}).model !== 'sonnet' || p({}).from !== 'office') throw new Error('empty → office sonnet');
  if (p({ office: 'opus' }).model !== 'opus' || p({ agent: 'fable', office: 'opus' }).from !== 'agent' || p({ routine: 'opus', agent: 'fable' }).model !== 'opus' || p({ task: 'sonnet', routine: 'opus', agent: 'fable', office: 'opus' }).from !== 'task') throw new Error('precedence');
  if (p({ task: 'haiku', office: 'opus' }).model !== 'opus') throw new Error('an unknown task model must fall through');
  if (m.modelArgs('sonnet').join(' ') !== '--model sonnet' || m.modelArgs('opus').join(' ') !== '--model opus --effort high' || m.modelArgs('fable').join(' ') !== '--model fable' || m.modelArgs('nonsense').join(' ') !== '--model sonnet') throw new Error('args: ' + m.modelArgs('opus').join(' '));
  // V3.6.1 effort: five CLI levels, AUTO = the model's own, same precedence then the model
  if (m.normEffort('Extra high') !== 'xhigh' || m.normEffort('auto') !== null || m.normEffort('turbo') !== null || m.normEffort('MAX') !== 'max') throw new Error('normEffort');
  const e = (o) => m.effortFor(o);
  if (e({ model: 'opus' }).effort !== 'high' || e({ model: 'opus' }).from !== 'model' || e({ model: 'sonnet' }).effort !== null) throw new Error('effort falls through to the model');
  if (e({ office: 'low', model: 'opus' }).effort !== 'low' || e({ agent: 'max', office: 'low' }).from !== 'agent' || e({ routine: 'medium', agent: 'max' }).effort !== 'medium' || e({ task: 'xhigh', routine: 'medium', agent: 'max', office: 'low' }).from !== 'task') throw new Error('effort precedence');
  if (m.modelArgs('sonnet', 'max').join(' ') !== '--model sonnet --effort max' || m.modelArgs('opus', 'low').join(' ') !== '--model opus --effort low' || m.modelArgs('opus', 'nonsense').join(' ') !== '--model opus --effort high') throw new Error('effort args');
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'invo', model: 'OPUS', effort: 'High' }, { id: 'lexi', model: 'haiku', effort: 'turbo' }] });
  if (r.agents.find(a => a.id === 'invo').model !== 'opus' || r.agents.find(a => a.id === 'lexi').model !== '' || !r.problems.some(x => /sonnet, opus or fable/.test(x))) throw new Error('roster model field');
  if (r.agents.find(a => a.id === 'invo').effort !== 'high' || r.agents.find(a => a.id === 'lexi').effort !== '' || !r.problems.some(x => /low, medium, high, xhigh or max/.test(x))) throw new Error('roster effort field');
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs');
  const v = rt.validate({ dept: 'fin', agent: 'invo', text: 'x', when: { kind: 'daily', at: '09:00' }, model: 'Fable', effort: 'xhigh' }, loadRoster().agents); if (v.problems.length || v.routine.model !== 'fable' || v.routine.effort !== 'xhigh') throw new Error('routine model/effort field');
  return 'sonnet · opus (effort high) · fable · task > routine > agent > office · roster and routines refuse anything else';
});
await step('usage: the gauge parses Claude\'s answer and the office\'s own count sits underneath', async () => {
  const u = await import('./usage.mjs');
  const sample = { five_hour: { utilization: 29, resets_at: '2026-09-09T08:20:00.322898+00:00' }, seven_day: { utilization: 39.6, resets_at: '2026-09-12T03:00:00.322921+00:00' } };
  const p = u.parseUsage(sample); if (!p || p.session.percent !== 29 || p.week.percent !== 40 || !p.session.resetsAt || new Date(p.week.resetsAt).getUTCDay() !== 6) throw new Error('parse: ' + JSON.stringify(p));
  if (u.parseUsage({ nothing: true }) !== null || u.parseUsage(null) !== null) throw new Error('unknown shape must be null');
  const now = Date.now(); let st = {};
  st = u.record(st, { input_tokens: 10, output_tokens: 40, cache_creation_input_tokens: 9000, cache_read_input_tokens: 5000 }, now);
  st = u.record(st, { input_tokens: 5, output_tokens: 5 }, now + 1000);
  const f = u.fallback(st, now + 2000); if (f.source !== 'office' || f.window.tokens !== 14060 || f.window.runs !== 2 || f.window.resetsAt !== st.startedAt + u.WINDOW) throw new Error('count: ' + JSON.stringify(f));
  const later = u.fallback(st, now + u.WINDOW + 1); if (later.window.tokens !== 0 || later.window.runs !== 0 || later.window.startedAt !== null) throw new Error('window did not reset');
  const tok = u.readToken(); // read into memory only — never printed
  return `parses percent + reset · unknown shape → null · 2 runs = 14,060 tokens · window resets after 5 h · login token on this machine: ${tok ? 'found' : 'none'}`;
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
    await page.goto('file://' + path.join(ROOT, 'dist', 'command-centre-v2.html') + '?s=check'); await page.waitForTimeout(3000);
    await step('smoke: loads without page errors', async () => { if (errors.length) throw new Error(errors[0]); });
    await step('smoke: 35 agents at their desks', async () => { const n = await page.evaluate(() => Object.keys(window.CC.R).length); if (n !== 35) throw new Error('agents: ' + n); return n + ' agents'; });
    await step('smoke: six department cards + the Brain tag', async () => {
      const t = await page.evaluate(() => [...document.querySelectorAll('.badge .b-name')].map(e => e.textContent.trim()));
      for (const k of ['EMAILS', 'SALES', 'MARKETING', 'OPERATIONS', 'FINANCE', 'DELIVERY', 'THE BRAIN']) if (!t.some(x => x.startsWith(k))) throw new Error('missing card ' + k);
    });
    await step('smoke: task panel has rows and counts', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('.tp-row').length); if (n < 10) throw new Error('rows: ' + n);
      const chips = await page.evaluate(() => document.querySelectorAll('.tp-chip').length); if (chips !== 6) throw new Error('chips: ' + chips);
      return n + ' rows';
    });
    await step('smoke: command bar adds a task in demo mode', async () => {
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
      await page.fill('.tp-in', 'cut a 15 second teaser from the demo reel'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added/.test(hint)) throw new Error('hint: ' + hint);
      const row = await page.evaluate(() => [...document.querySelectorAll('.tp-row .tp-t')].some(e => /teaser/i.test(e.textContent))); if (!row) throw new Error('row not in the feed');
      return hint.trim().slice(0, 60);
    });
    await step('smoke: a routine typed in the bar lands in SCHEDULED (demo)', async () => {
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="emails"]');
      await page.fill('.tp-in', 'every weekday at 8am, triage the inbox and tell me what needs me');
      await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true })));
      await page.waitForFunction(() => /Routine/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 5000 }).catch(() => {});
      const pre = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Routine/.test(pre) || !/every weekday · 08:00/.test(pre)) throw new Error('hint before Add: ' + pre);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Routine set|couldn/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 5000 }).catch(() => {});
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Routine set/.test(hint)) throw new Error('hint: ' + hint);
      await page.waitForTimeout(400);
      const n = await page.evaluate(() => window.CC.routines().length); if (n !== 1) throw new Error('routines: ' + n);
      const row = await page.evaluate(() => [...document.querySelectorAll('.tp-row.sched .tp-t')].some(e => /triage the inbox/i.test(e.textContent))); if (!row) throw new Error('no SCHEDULED row');
      const strip = await page.evaluate(() => { const e = document.querySelector('.tp-next'); return e.hidden ? '' : e.textContent; }); if (!/NEXT/.test(strip) || !/triage/i.test(strip)) throw new Error('next-up strip: ' + strip);
      await page.keyboard.press('b'); await page.waitForTimeout(600);
      const col = await page.evaluate(() => [...document.querySelectorAll('#board .lh')].map(e => e.textContent)); if (col[1] !== 'SCHEDULED') throw new Error('board columns: ' + col.join(','));
      const card = await page.evaluate(() => document.querySelectorAll('#board .tk.sched').length); if (!card) throw new Error('no SCHEDULED card on the board');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.evaluate(() => window.CC.tasks.rtAct(window.CC.routines()[0].id, 'run')); await page.waitForTimeout(500);
      const fired = await page.evaluate(() => window.CC.tasks.tasks.some(t => t.routine && /triage the inbox/i.test(t.title))); if (!fired) throw new Error('RUN NOW did not make a task');
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
      await page.fill('.tp-in', 'every day at 9am post the reel'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      const no = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/later release/.test(no)) throw new Error('marketing not refused: ' + no);
      const still = await page.evaluate(() => window.CC.routines().length); if (still !== 1) throw new Error('a refused routine was added');
      const opts = await page.evaluate(() => [...document.querySelectorAll('.tp-model option')].map(o => o.value).join(',') + '|' + document.querySelector('.tp-model').value); if (opts !== 'sonnet,opus,fable|sonnet') throw new Error('model menu: ' + opts);
      const eff = await page.evaluate(() => [...document.querySelectorAll('.tp-effort option')].map(o => o.value).join(',') + '|' + document.querySelector('.tp-effort').value); if (eff !== ',low,medium,high,xhigh,max|') throw new Error('effort menu: ' + eff);
      // V3.7: the box grows with the text, and the big editor mirrors it both ways
      await page.fill('.tp-in', 'line one\nline two\nline three'); await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true }))); await page.waitForTimeout(200);
      const grown = await page.evaluate(() => document.querySelector('.tp-in').offsetHeight); if (grown < 50) throw new Error('box did not grow: ' + grown + 'px');
      await page.click('.tp-big-btn'); await page.waitForTimeout(300);
      const bigOn = await page.evaluate(() => document.getElementById('tpBig').classList.contains('on') && document.querySelector('.tb-in').value === document.querySelector('.tp-in').value && document.querySelector('.tb-dept').textContent === 'MARKETING'); if (!bigOn) throw new Error('big editor did not open with the text');
      await page.type('.tb-in', ' and more'); await page.waitForTimeout(200);
      const back = await page.evaluate(() => document.querySelector('.tp-in').value.endsWith(' and more') && /MARKETING LEAD|Goes to|Probably/.test(document.querySelector('.tb-hint').textContent)); if (!back) throw new Error('big editor did not mirror back');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const bigOff = await page.evaluate(() => !document.getElementById('tpBig').classList.contains('on')); if (!bigOff) throw new Error('Esc did not close the big editor');
      await page.fill('.tp-in', ''); await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true }))); await page.evaluate(() => document.querySelector('.tp-in').blur()); await page.click('.tp-chip[data-f="all"]'); // hand the keys back, feed back to All
      const rest = await page.evaluate(() => document.querySelector('.tp-in').offsetHeight); if (rest > 34) throw new Error('box did not shrink back: ' + rest + 'px');
      return 'hint says the schedule · SCHEDULED row + next-up strip + board column · RUN NOW fires · marketing refused · box grows + big editor mirrors';
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
      await page.evaluate(() => window.CC.requestApproval('ada'));
      await page.waitForFunction(() => document.querySelectorAll('.tp-row.waiting').length > 0, null, { timeout: 4000 }).catch(() => {}); // the panel renders on the next frame; headless WebGL frames can be slow
      const w = await page.evaluate(() => document.querySelectorAll('.tp-row.waiting').length); if (!w) throw new Error('no waiting row (ada: ' + (await page.evaluate(() => window.CC.R.ada.state)) + ')');
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
    await step('server: /api/mcp lists this machine\'s connectors', async () => {
      const m = await (await fetch(base + '/api/mcp')).json();
      if (!Array.isArray(m.servers)) throw new Error('no servers array');
      const c = m.servers.filter(s => s.status === 'connected').length;
      return `${m.servers.length} servers · ${c} connected · agents get tools: ${m.tools ? 'yes' : 'no (API backend)'}${m.web ? ' + web' : ''}`;
    });
    await step('server: /api/health carries the roster', async () => { if (!Array.isArray(up.agents) || up.agents.length !== 35) throw new Error('agents: ' + (up.agents && up.agents.length)); if (!up.agents[0].does) throw new Error('no job description'); });
    await step('server: the office default is Sonnet and /api/usage always answers', async () => {
      if (up.model !== 'sonnet' || JSON.stringify(up.models) !== '["sonnet","opus","fable"]') throw new Error('health model: ' + up.model);
      if (up.effort !== '' || JSON.stringify(up.efforts) !== '["low","medium","high","xhigh","max"]') throw new Error('health effort: ' + up.effort);
      const r = await fetch(base + '/api/usage'); if (r.status !== 200) throw new Error('status ' + r.status); const u = await r.json();
      if (!u.ok || !['claude', 'office'].includes(u.source)) throw new Error(JSON.stringify(u).slice(0, 120));
      return u.source === 'claude' ? `Claude's gauge: session ${u.session?.percent}% · week ${u.week?.percent}%` : `office count (${u.reason})`;
    });
    await step('server: /api/skills lists the skills and who has them', async () => {
      const s = await (await fetch(base + '/api/skills')).json(); if (!s.count || !Array.isArray(s.skills)) throw new Error('no skills');
      const piper = up.agents.find(a => a.id === 'piper'); if (!piper.skills?.includes('proposal')) throw new Error('health roster has no skills on piper');
      return `${s.count} skills · piper: ${piper.skills.join(', ')}`;
    });
    await step('server: the lead offers the interview when a department is not set up', async () => {
      const lead = up.agents.find(a => a.id === 'lexi'); if (lead.interviewer !== true) throw new Error('lexi is not the interviewer');
      if (typeof up.setup?.sales !== 'boolean') throw new Error('no setup map');
      const r = await (await fetch(base + '/api/lessons')).json(); if (!Array.isArray(r.agents)) throw new Error('no lessons endpoint');
      return `sales set up: ${up.setup.sales} · lessons dir ${path.basename(r.dir)}`;
    });
    await step('server: /api/routines lists the timetable and names the departments', async () => {
      const r = await (await fetch(base + '/api/routines')).json(); if (!Array.isArray(r.routines) || JSON.stringify(r.depts) !== '["emails","fin","sales"]') throw new Error(JSON.stringify(r).slice(0, 120));
      if (typeof up.routines?.count !== 'number') throw new Error('health has no routines');
      return `${r.routines.length} routines${r.routines.length ? ' · next ' + (r.routines.filter(x => x.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0]?.title || '—') : ''} · ${path.basename(path.dirname(r.path))}/${path.basename(r.path)}`;
    });
    await step('server: a routine outside Emails, Accounting and Sales is refused with a sentence', async () => {
      const r = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'marketing', text: 'every day at 9am post the reel' }) });
      const j = await r.json(); if (r.status !== 400 || !j.refused || !/later release/.test(j.error)) throw new Error(r.status + ' ' + JSON.stringify(j));
      const t = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'every weekday, triage the inbox' }) });
      const k = await t.json(); if (t.status !== 400 || !k.needsTime) throw new Error('missing time not asked back: ' + JSON.stringify(k));
      const n = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'chase the quiet deals' }) });
      const m = await n.json(); if (n.status !== 400 || !m.noSchedule) throw new Error('no schedule not named: ' + JSON.stringify(m));
      return j.error;
    });
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
      await step('live: a two-minute routine fires on the server, runs and lands', async () => {
        const r = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'every 2 minutes, list what is in the inbox that needs me today' }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error); const id = j.routine.id;
        try {
          if (!j.routine.nextAt || j.routine.desc !== 'every 2 min') throw new Error('routine wrong: ' + JSON.stringify(j.routine));
          let task = null;
          for (let i = 0; i < 100 && !(task && task.state !== 'next' && task.state !== 'doing'); i++) { await new Promise(r => setTimeout(r, 3000)); task = (await (await fetch(base + '/api/tasks')).json()).find(t => t.routine === id); }
          if (!task) throw new Error('the routine never fired'); if (task.state === 'next' || task.state === 'doing') throw new Error('the routine fired but did not finish in time');
          if (task.by !== 'routine' || task.error) throw new Error('task: ' + task.state + ' ' + (task.result || '').slice(0, 120));
          return `${task.agent} · ${task.title} · ${task.state}${task.state === 'waiting' ? ' for the OK' : ''} · ${task.result.length} chars`;
        } finally { await fetch(`${base}/api/routines/${id}`, { method: 'DELETE' }); }
      });
      await step('live: a task set to Opus runs on Opus and says so', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'one line: what should the next follow-up to a quiet lead say', model: 'opus' }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json(); if (t.model !== 'opus') throw new Error('task.model ' + t.model);
        const d = await (await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' })).json(); if (d.error) throw new Error(d.result);
        if (d.modelUsed !== 'opus' || d.modelFrom !== 'task' || !/opus/.test(String(d.modelId))) throw new Error(`ran on ${d.modelId} (${d.modelUsed} from ${d.modelFrom})`);
        const u = await (await fetch(base + '/api/usage')).json(); if (!u.ok) throw new Error('usage after a run');
        return `${d.agent} · ${d.modelId} · from the task · gauge ${u.source}`;
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
