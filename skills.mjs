// Agents Office — skills (Beta). A skill is how the owner wants one kind of work done: a folder
// with a SKILL.md (what, when, the steps, the format) and any templates or examples beside it.
// The agent it is bound to reads the whole skill before every task and every chat turn.
//
//   skills/<name>/SKILL.md                      shipped with the repo (examples; yours can live here too)
//   <brain>/Agents Office/skills/<name>/SKILL.md yours, kept with your notes — wins on the same name
//   skills/<name>.md                             a one-file skill is also fine (either place)
//
// SKILL.md starts with a front-matter block:
//   ---
//   name: proposal                    (defaults to the folder name)
//   description: How we write a proposal
//   agents: [piper]                   (agent ids — see office.agents.json)
//   departments: [sales]              (or whole departments; neither = every agent)
//   ---
// Then the instructions in plain Markdown. See SKILLS.md for the guide and CLAUDE.md for how Claude
// Code writes them for you. Agents have no file tools, so every readable file in the folder is
// inlined into the prompt (capped — see LIMITS); binaries are listed by name only.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { DEPT_KEYS } from './src/data.js';

export const SHIPPED = path.join(ROOT, 'skills');
export const brainDir = brainPath => path.join(brainPath, 'Agents Office', 'skills');
const LIMITS = { body: 6000, files: 8000, perFile: 4000 };
const TEXT = /\.(md|txt|csv|json|ya?ml|html?|xml|tsv)$/i;

/** Parse the front-matter block of a SKILL.md → { meta, body }. Values: text, [a, b], or "- a" lines. */
export function parseSkill(text) {
  const meta = {}; let body = text;
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = text.slice(m[0].length);
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) {
        key = kv[1].toLowerCase(); const v = kv[2].trim();
        if (v.startsWith('[')) meta[key] = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        else if (v === '') meta[key] = [];
        else meta[key] = v.replace(/^["']|["']$/g, '');
      } else if (key && /^\s*-\s+/.test(line)) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, '')); }
    }
  }
  return { meta, body: body.trim() };
}

function readOne(where, entry, agents, problems) {
  const p = path.join(where, entry.name);
  let file, dir = null;
  if (entry.isDirectory()) { file = path.join(p, 'SKILL.md'); dir = p; if (!fs.existsSync(file)) { problems.push(`${entry.name}/: no SKILL.md — skipped`); return null; } }
  else if (/\.md$/i.test(entry.name) && entry.name.toUpperCase() !== 'README.MD') file = p;
  else return null;
  const { meta, body } = parseSkill(fs.readFileSync(file, 'utf8'));
  const name = String(meta.name || (dir ? entry.name : entry.name.replace(/\.md$/i, ''))).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const label = dir ? entry.name + '/SKILL.md' : entry.name;
  if (!body) { problems.push(`${label}: empty — skipped`); return null; }
  const list = v => v === undefined ? [] : Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean);
  const ids = new Set(agents.map(a => a.id));
  const bound = list(meta.agents).map(s => s.toLowerCase()).filter(id => { if (ids.has(id)) return true; problems.push(`${label}: "${id}" is not an agent id — ignored (ids are in office.agents.json)`); return false; });
  const depts = list(meta.departments).map(s => s.toLowerCase()).filter(k => { if (DEPT_KEYS.includes(k)) return true; problems.push(`${label}: "${k}" is not a department — ignored (${DEPT_KEYS.join(', ')})`); return false; });
  for (const k of Object.keys(meta)) if (!['name', 'description', 'agents', 'departments'].includes(k)) problems.push(`${label}: unknown field "${k}" — ignored`);
  if ((list(meta.agents).length || list(meta.departments).length) && !bound.length && !depts.length) { problems.push(`${label}: none of its agents or departments exist — skipped (a skill with no valid binding would go to all 33)`); return null; }
  let text = body.length > LIMITS.body ? body.slice(0, LIMITS.body) + '\n[… trimmed]' : body;
  if (body.length > LIMITS.body) problems.push(`${label}: over ${LIMITS.body} characters — trimmed; move detail into files beside it`);
  const files = [];
  if (dir) {
    let used = 0;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f === 'SKILL.md' || f.startsWith('.')) continue;
      const fp = path.join(dir, f); if (!fs.statSync(fp).isFile()) continue;
      if (!TEXT.test(f)) { files.push({ name: f, text: null }); continue; }
      let t = fs.readFileSync(fp, 'utf8').trim();
      if (used >= LIMITS.files) { files.push({ name: f, text: null }); problems.push(`${entry.name}/${f}: skill files over ${LIMITS.files} characters — listed by name only`); continue; }
      if (t.length > LIMITS.perFile) { t = t.slice(0, LIMITS.perFile) + '\n[… trimmed]'; problems.push(`${entry.name}/${f}: over ${LIMITS.perFile} characters — trimmed`); }
      used += t.length; files.push({ name: f, text: t });
    }
  }
  const everyone = !bound.length && !depts.length;
  return { name, description: String(meta.description || '').trim().slice(0, 160), agents: bound, departments: depts, everyone, text, files, path: path.relative(ROOT, file), source: where === SHIPPED ? 'shipped' : 'brain' };
}

/** Load every skill: shipped first, then the brain's (same name → the brain's wins). Never throws. */
export function loadSkills(brainPath, agents) {
  const problems = []; const byName = new Map();
  for (const where of [SHIPPED, brainDir(brainPath)]) {
    if (!fs.existsSync(where)) continue;
    let ents; try { ents = fs.readdirSync(where, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { if (e.name.startsWith('.')) continue; const s = readOne(where, e, agents, problems); if (s) { if (byName.has(s.name) && byName.get(s.name).source === s.source) problems.push(`"${s.name}" appears twice in ${s.source === 'shipped' ? 'skills/' : 'the brain'} — the later one wins`); byName.set(s.name, s); } }
  }
  const skills = [...byName.values()];
  const forAgent = a => skills.filter(s => s.everyone || s.agents.includes(a.id) || s.departments.includes(a.department));
  return {
    skills, problems,
    forAgent,
    names: a => forAgent(a).map(s => s.name),
    /** The block that goes into an agent's system prompt. */
    promptText(a) {
      const mine = forAgent(a); if (!mine.length) return '';
      return 'SKILLS — how the owner wants this kind of work done. When a task matches a skill, follow it exactly: its steps, its format, its wording rules. Say which skill you followed in one line at the end ("Skill: proposal").\n\n' +
        mine.map(s => `### ${s.name}${s.description ? ' — ' + s.description : ''}\n${s.text}` +
          s.files.map(f => f.text === null ? `\n\n(attached file: ${f.name} — not readable here)` : `\n\n--- ${f.name} ---\n${f.text}`).join('')).join('\n\n');
    },
    summary: () => ({ count: skills.length, shipped: skills.filter(s => s.source === 'shipped').length, brain: skills.filter(s => s.source === 'brain').length, problems,
      skills: skills.map(s => ({ name: s.name, description: s.description, agents: s.agents, departments: s.departments, everyone: s.everyone, files: s.files.map(f => f.name), source: s.source, path: s.path })) }),
  };
}
