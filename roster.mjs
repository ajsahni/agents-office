// Agents Office — the roster (Beta). Who sits where is fixed (six pods, 35 seats); what each
// agent is called, does and uses is yours to change in office.agents.json.
//   built-in defaults  ← office.agents.json  ← <brain>/Agents Office/agents.json  ← office.agents.local.json (gitignored)
// Departments, leads and seats cannot be changed from these files; the office ignores such
// edits and says so. `brief` is the owner's standing instructions to that agent (multi-line),
// read before every task. Skills — how a kind of work is done — live beside the agents in
// skills.mjs. See CLAUDE.md for how to change agents with Claude Code.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig } from './config.mjs';
import { AGENTS, DEPTS } from './src/data.js';
import { V1 } from './src/v1data.js';

export const FILE = path.join(ROOT, 'office.agents.json');
export const LOCAL = path.join(ROOT, 'office.agents.local.json');
export const brainFile = brainPath => path.join(brainPath, 'Agents Office', 'agents.json');
const EDITABLE = ['name', 'role', 'does', 'tools', 'brief', 'model'];
const BRIEF_MAX = 2000;
const MODELS = ['sonnet', 'opus', 'fable']; // V3.6: an agent's model, by name; empty = the office default

export function defaults() {
  return AGENTS.map(a => { const p = V1.find(x => x.id === a.id) || {}; return { id: a.id, department: a.dept, lead: !!a.lead, name: a.name, role: p.role || '', does: p.tagline || '', tools: [], brief: '', model: '' }; });
}
// returns { agents, problems } — problems are human sentences, never thrown
export function validate(doc, base = defaults()) {
  const problems = [];
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.agents) ? doc.agents : null;
  if (!list) return { agents: base, problems: ['the file must be {"agents": [...]}'] };
  const out = base.map(a => ({ ...a, tools: [...a.tools] }));
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !e.id) { problems.push('an entry has no "id" — skipped'); continue; }
    const a = out.find(x => x.id === e.id);
    if (!a) { problems.push(`"${e.id}" is not one of the 35 seats — skipped (new agents are not supported; rename a seat instead)`); continue; }
    if (seen.has(e.id)) problems.push(`"${e.id}" appears twice — the later entry wins`);
    seen.add(e.id);
    if (e.department !== undefined && e.department !== a.department) problems.push(`"${e.id}": department cannot change (${a.department} → ${e.department}) — ignored`);
    if (e.lead !== undefined && !!e.lead !== a.lead) problems.push(`"${e.id}": lead cannot change — ignored`);
    for (const k of Object.keys(e)) if (!['id', 'department', 'lead', ...EDITABLE].includes(k)) problems.push(`"${e.id}": unknown field "${k}" — ignored`);
    if (e.name !== undefined) { const n = String(e.name).trim(); if (!n) problems.push(`"${e.id}": empty name — kept "${a.name}"`); else a.name = n.slice(0, 32).toUpperCase(); }
    if (e.role !== undefined) a.role = String(e.role).trim().slice(0, 80);
    if (e.does !== undefined) a.does = String(e.does).trim().slice(0, 400);
    if (e.tools !== undefined) { if (!Array.isArray(e.tools)) problems.push(`"${e.id}": tools must be a list — ignored`); else a.tools = e.tools.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12); }
    if (e.model !== undefined) { // V3.6: sonnet · opus · fable, or empty for the office default
      const m = String(e.model || '').toLowerCase().trim();
      if (!m) a.model = ''; else if (MODELS.includes(m)) a.model = m; else problems.push(`"${e.id}": model must be sonnet, opus or fable (got "${e.model}") — kept ${a.model || 'the office default'}`);
    }
    if (e.brief !== undefined) { // a string, or a list of lines
      const b = (Array.isArray(e.brief) ? e.brief.map(String).join('\n') : String(e.brief)).trim();
      if (b.length > BRIEF_MAX) problems.push(`"${e.id}": brief is over ${BRIEF_MAX} characters — trimmed (put the long version in a skill)`);
      a.brief = b.slice(0, BRIEF_MAX);
    }
  }
  return { agents: out, problems };
}
function read(p) { if (!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { __error: e.message }; } }
export function loadRoster(brainPath = loadConfig().brainPath) {
  let agents = defaults(); const problems = [];
  const sources = [FILE, brainFile(brainPath), LOCAL];
  const label = p => p === FILE || p === LOCAL ? path.basename(p) : 'brain/Agents Office/agents.json';
  for (const p of sources) {
    const doc = read(p); if (!doc) continue;
    const rel = label(p);
    if (doc.__error) { problems.push(`${rel}: not valid JSON (${doc.__error.split('\n')[0]}) — ignored`); continue; }
    const r = validate(doc, agents); agents = r.agents; problems.push(...r.problems.map(x => `${rel}: ${x}`));
  }
  const customised = agents.filter((a, i) => { const d = defaults()[i]; return a.name !== d.name || a.role !== d.role || a.does !== d.does || a.brief; }).length;
  return { agents, problems, customised, briefed: agents.filter(a => a.brief).length, files: sources.filter(p => fs.existsSync(p)).map(label) };
}
export const deptName = k => DEPTS[k]?.name || k;
