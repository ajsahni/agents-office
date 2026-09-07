// Agents Office — the roster (Beta). Who sits where is fixed (six pods, 33 seats); what each
// agent is called, does and uses is yours to change in office.agents.json.
//   built-in defaults  ← office.agents.json  ← office.agents.local.json (gitignored)
// Departments, leads and seats cannot be changed from these files; the office ignores such
// edits and says so. See CLAUDE.md for how to change agents with Claude Code.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { AGENTS, DEPTS } from './src/data.js';
import { V1 } from './src/v1data.js';

export const FILE = path.join(ROOT, 'office.agents.json');
export const LOCAL = path.join(ROOT, 'office.agents.local.json');
const EDITABLE = ['name', 'role', 'does', 'tools'];

export function defaults() {
  return AGENTS.map(a => { const p = V1.find(x => x.id === a.id) || {}; return { id: a.id, department: a.dept, lead: !!a.lead, name: a.name, role: p.role || '', does: p.tagline || '', tools: [] }; });
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
    if (!a) { problems.push(`"${e.id}" is not one of the 33 seats — skipped (new agents are not supported; rename a seat instead)`); continue; }
    if (seen.has(e.id)) problems.push(`"${e.id}" appears twice — the later entry wins`);
    seen.add(e.id);
    if (e.department !== undefined && e.department !== a.department) problems.push(`"${e.id}": department cannot change (${a.department} → ${e.department}) — ignored`);
    if (e.lead !== undefined && !!e.lead !== a.lead) problems.push(`"${e.id}": lead cannot change — ignored`);
    for (const k of Object.keys(e)) if (!['id', 'department', 'lead', ...EDITABLE].includes(k)) problems.push(`"${e.id}": unknown field "${k}" — ignored`);
    if (e.name !== undefined) { const n = String(e.name).trim(); if (!n) problems.push(`"${e.id}": empty name — kept "${a.name}"`); else a.name = n.slice(0, 32).toUpperCase(); }
    if (e.role !== undefined) a.role = String(e.role).trim().slice(0, 80);
    if (e.does !== undefined) a.does = String(e.does).trim().slice(0, 400);
    if (e.tools !== undefined) { if (!Array.isArray(e.tools)) problems.push(`"${e.id}": tools must be a list — ignored`); else a.tools = e.tools.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12); }
  }
  return { agents: out, problems };
}
function read(p) { if (!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { __error: e.message }; } }
export function loadRoster() {
  let agents = defaults(); const problems = [];
  for (const p of [FILE, LOCAL]) {
    const doc = read(p); if (!doc) continue;
    const rel = path.basename(p);
    if (doc.__error) { problems.push(`${rel}: not valid JSON (${doc.__error.split('\n')[0]}) — ignored`); continue; }
    const r = validate(doc, agents); agents = r.agents; problems.push(...r.problems.map(x => `${rel}: ${x}`));
  }
  const customised = agents.filter((a, i) => { const d = defaults()[i]; return a.name !== d.name || a.role !== d.role || a.does !== d.does; }).length;
  return { agents, problems, customised, files: [FILE, LOCAL].filter(p => fs.existsSync(p)).map(p => path.basename(p)) };
}
export const deptName = k => DEPTS[k]?.name || k;
