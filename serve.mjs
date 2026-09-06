// Agents Office — the local server (Beta).
// Serves the office and makes it real on your own Claude login:
//   · the command bar routes a typed task through Claude to the right agent in the department
//   · the agent produces the deliverable, which is saved as a note in your brain folder
//   · the Brain is your vault's real wiki-link graph, rebuilt live as notes are written
//   · chat with any agent is a real conversation in that agent's persona, grounded in your notes
// Everything stays on this machine: data/tasks.json and <brain>/Agents Office/*.md.
//
//   npm start                 → http://localhost:4520
//   PORT=4600 npm start       → another port
//
// Claude backend: the Claude Code CLI (`claude -p`, your existing login) — or the official SDK
// if ANTHROPIC_API_KEY is set. AO_MODEL=<model> overrides the model.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, ROOT } from './config.mjs';
import { layoutGraph, readVault, readOfficeNotes } from './graph-build.mjs';
import { AGENTS, DEPTS, DEPT_KEYS } from './src/data.js';
import { V1 } from './src/v1data.js';

const cfg = loadConfig();
const HTML = path.join(ROOT, 'command-centre-v2.html');
const HTML_DARK = path.join(ROOT, 'command-centre-v2-dark.html');
const DATA = path.join(ROOT, 'data');
const FILE = path.join(DATA, 'tasks.json');
const BRAIN = cfg.brainPath;
const NOTES_DIR = path.join(BRAIN, 'Agents Office');
const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli'); // an empty cwd: no CLAUDE.md, no repo context
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();

let backend = 'claude-cli', sdk = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic(); backend = 'anthropic-sdk';
  } catch (e) { console.warn('SDK not installed (npm install @anthropic-ai/sdk) — using the Claude CLI:', e.message.split('\n')[0]); }
}

/* ---------- storage ---------- */
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = list => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); };
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ---------- ask Claude ---------- */
async function ask(system, user, { maxTokens = 4000 } = {}) {
  if (sdk) {
    const res = await sdk.messages.create({ model: cfg.model || 'claude-opus-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  fs.mkdirSync(CLI_CWD, { recursive: true });
  const args = ['-p', user, '--output-format', 'json', '--no-session-persistence', '--system-prompt', system,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Agent,NotebookEdit'];
  if (cfg.model) args.push('--model', cfg.model);
  const env = { ...process.env }; delete env.CLAUDECODE; // the CLI refuses to nest inside another Claude Code session
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: CLI_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Claude took longer than 150 s')); }, 150000);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'Claude Code is not installed (claude not found on PATH)' : e.message)); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}${err ? ': ' + err.trim().slice(0, 300) : ''}`));
      try { const j = JSON.parse(out); resolve(String(j.result || '').trim()); } catch { resolve(out.trim()); }
    });
  });
}
function parseJSON(text) {
  const s = text.replace(/```json|```/g, ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return JSON.parse(s.slice(a, b + 1));
}

/* ---------- the brain: graph + context ---------- */
let graph = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try { graph = await layoutGraph(BRAIN); } catch (e) { console.warn('brain graph failed:', e.message); }
  return graph;
}
function vaultIndex() { // name → text (vault notes + live office notes)
  const { notes } = readVault(BRAIN); const m = new Map();
  for (const [name, n] of notes) m.set(name, n.text);
  for (const n of readOfficeNotes(BRAIN)) m.set(n.name, n.text);
  return m;
}
function businessContext(index) {
  const bits = [];
  for (const k of ['CLAUDE', 'index', 'business-model', 'voice']) if (index.has(k)) bits.push(`--- ${k}.md ---\n${index.get(k).slice(0, 1200)}`);
  return bits.join('\n\n');
}
// the notes an agent would read for this task: name/word overlap, department MOC first
function relevantNotes(index, dept, text, n = 4) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const mocName = { emails: 'MOC-Emails', sales: 'MOC-Sales', marketing: 'MOC-Marketing', ops: 'MOC-Operations', fin: 'MOC-Finance', delivery: 'MOC-Delivery' }[dept];
  const scored = [];
  for (const [name, txt] of index) {
    if (['CLAUDE', 'index', 'log'].includes(name)) continue;
    const hay = (name + ' ' + txt.slice(0, 1500)).toLowerCase();
    let s = 0; for (const w of words) if (hay.includes(w)) s += name.toLowerCase().includes(w) ? 3 : 1;
    if (name === mocName) s += 2;
    if (s) scored.push([s, name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picks = scored.slice(0, n).map(x => x[1]);
  if (mocName && index.has(mocName) && !picks.includes(mocName)) picks.push(mocName);
  return picks;
}
function contextText(index, names) {
  return names.map(n => `--- ${n}.md ---\n${(index.get(n) || '').slice(0, 1800)}`).join('\n\n');
}

/* ---------- the roster, as Claude sees it ---------- */
const v1 = id => V1.find(x => x.id === id) || {};
const persona = a => { const p = v1(a.id); return `${a.name}${a.lead ? ' (lead)' : ''} · ${p.role || ''} · ${p.tagline || ''}`; };
function rosterText(dept) { return AGENTS.filter(a => a.dept === dept).map(a => `- ${a.id} · ${persona(a)}`).join('\n'); }
async function route(dept, text) {
  const d = DEPTS[dept];
  const system = `You are the router for ${cfg.name}, a business whose departments are run by AI agents. ` +
    'Pick the single best agent for the owner\'s request and return ONLY a JSON object — no prose, no code fences.';
  const user = `Department: ${d.name}\nAgents (id · name · role · what they do):\n${rosterText(dept)}\n\nOwner's request: "${text}"\n\n` +
    'Return: {"agent":"<id from the list>","title":"<clean imperative task title, max 70 characters>","plan":["<step>","<step>","<step>"],"eta_minutes":<integer>,"why":"<one short sentence>"}';
  const j = parseJSON(await ask(system, user, { maxTokens: 800 }));
  const valid = AGENTS.find(a => a.id === j.agent && a.dept === dept);
  const agent = valid ? valid.id : (AGENTS.find(a => a.dept === dept && a.lead) || AGENTS.find(a => a.dept === dept)).id;
  return { agent, title: String(j.title || text).slice(0, 90), plan: Array.isArray(j.plan) ? j.plan.slice(0, 4).map(String) : [],
    eta: Number.isFinite(j.eta_minutes) ? j.eta_minutes : 30, why: String(j.why || '') };
}
async function run(task, feedback) {
  const a = AGENTS.find(x => x.id === task.agent), p = v1(a.id), d = DEPTS[a.dept];
  const index = vaultIndex();
  const read = relevantNotes(index, a.dept, task.title + ' ' + task.text);
  const system = `You are ${a.name}, ${p.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${p.tagline || ''}\n` +
    'Write the finished deliverable itself, not a description of what you would do. Plain text: a short heading, then short sections or bullets. ' +
    'At most 260 words. No preamble, no sign-off. Ground it in the company notes below; where a fact is missing, make a reasonable assumption and mark it (assumed).\n\n' +
    `COMPANY NOTES\n${businessContext(index)}\n\nNOTES YOU READ FOR THIS TASK\n${contextText(index, read)}`;
  const user = `Task: ${task.title}\nOwner's request: ${task.text}` + (task.plan?.length ? `\nAgreed plan: ${task.plan.join(' → ')}` : '') +
    (feedback ? `\n\nThe owner reviewed your previous version and asked for changes: "${feedback}"\nPrevious version:\n${task.result}` : '');
  const result = await ask(system, user);
  return { result, read };
}
function writeNote(task) { // the deliverable becomes a note in the brain, linked to what was read
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const a = AGENTS.find(x => x.id === task.agent);
  const name = `${new Date(task.doneAt).toISOString().slice(0, 10)} ${slug(task.title)}`;
  const body = `---\nagent: ${a.name}\ndepartment: ${DEPTS[a.dept].name}\ntask: ${task.id}\ndone: ${new Date(task.doneAt).toISOString()}\n---\n` +
    `# ${task.title}\n\n${task.result}\n\n---\nRead: ${(task.read || []).map(n => `[[${n}]]`).join(' · ') || '—'}\n`;
  fs.writeFileSync(path.join(NOTES_DIR, name + '.md'), body);
  return name;
}
async function chat(agentId, text, history) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) throw new Error('unknown agent');
  const p = v1(a.id), d = DEPTS[a.dept];
  const index = vaultIndex();
  const read = relevantNotes(index, a.dept, text, 3);
  const mine = load().filter(t => t.agent === agentId).slice(-6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `You are ${a.name}, ${p.role || 'an agent'}, in the ${d.name} department of ${cfg.name}. ${p.tagline || ''}\n` +
    'You are talking to the owner. Answer as this agent, in first person, briefly (under 120 words unless asked for detail), plainly, no hype. ' +
    'Use the company notes; say when something is not in them. Nothing outbound is sent without the owner\'s approval.\n\n' +
    `COMPANY NOTES\n${businessContext(index)}\n\nRELEVANT NOTES\n${contextText(index, read)}\n\nYOUR RECENT TASKS\n${mine || '—'}`;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Owner' : a.name}: ${m.text}`).join('\n');
  const reply = await ask(system, (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`, { maxTokens: 1200 });
  return { reply, read };
}

/* ---------- http ---------- */
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); });

await rebuildGraph();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/command-centre-v2.html' || url.pathname === '/dark')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(url.pathname === '/dark' && fs.existsSync(HTML_DARK) ? HTML_DARK : HTML));
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version, backend, model: cfg.model || (sdk ? 'claude-opus-5' : 'your Claude Code default'), name: cfg.name, brain: BRAIN, notes: graph.notes, depts: DEPT_KEYS });
    if (url.pathname === '/api/brain') return json(res, 200, graph);
    if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, load());
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const { dept, text } = await body(req);
      if (!DEPTS[dept] || dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty task' });
      const r = await route(dept, String(text).trim());
      const task = { id: nid(), dept, agent: r.agent, title: r.title, text: String(text).trim(), plan: r.plan, eta: r.eta, why: r.why, state: 'next', addedAt: Date.now(), by: 'you' };
      const list = load(); list.push(task); save(list);
      console.log(`+ ${task.id} → ${task.agent}: ${task.title}`);
      return json(res, 200, task);
    }
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|revise))?$/);
    if (m && req.method === 'POST' && (m[2] === 'run' || m[2] === 'revise')) {
      const list = load(); const task = list.find(t => t.id === m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      const { feedback } = m[2] === 'revise' ? await body(req) : {};
      task.state = 'doing'; task.startedAt = Date.now(); save(list);
      try {
        const { result, read } = await run(task, feedback);
        Object.assign(task, { state: 'done', doneAt: Date.now(), result, read, error: false });
        task.note = writeNote(task);
        await rebuildGraph();
      } catch (e) {
        Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Could not complete this task: ' + e.message, error: true });
      }
      const l2 = load(); const i = l2.findIndex(t => t.id === task.id); if (i >= 0) l2[i] = task; save(l2);
      console.log(`${task.error ? '✗' : '✓'} ${task.id} ${task.error ? 'failed' : 'done'} (${task.result.length} chars${task.note ? ', note: ' + task.note : ''})`);
      return json(res, 200, task);
    }
    if (m && req.method === 'DELETE') { save(load().filter(t => t.id !== m[1])); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { agent, text, history } = await body(req);
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty message' });
      const r = await chat(agent, String(text).trim(), history);
      return json(res, 200, r);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});
server.listen(cfg.port, () => {
  console.log(`Agents Office ${version} → http://localhost:${cfg.port}`);
  console.log(`  business: ${cfg.name}   brain: ${BRAIN} (${graph.notes} notes, ${graph.links.length} links)   claude: ${backend}${cfg.model ? ' · ' + cfg.model : ''}`);
  console.log(`  tasks: ${FILE}   notes the agents write: ${NOTES_DIR}`);
});
