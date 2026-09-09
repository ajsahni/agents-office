// Agents Office V3.5 — routines: tasks the office does on its own clock.
//
// A routine is a line in <brain>/Agents Office/routines.json (yours: written by the task bar,
// by a department lead in chat, or by Claude Code). Run state — when each one is next due, when
// it last ran — lives in data/routines.json so the brain file stays clean config.
//
// This release: routines are for Emails, Accounting and Sales only. The other departments get
// them later; a routine for one of them is refused with a sentence, not an error code.
//
//   { "id": "inbox-triage", "dept": "emails", "agent": "elead",
//     "title": "Triage the overnight inbox", "text": "Triage the overnight inbox: what needs me, …",
//     "when": { "kind": "weekdays", "at": "08:00" },      ← src/when.js
//     "needsOk": false, "paused": false, "model": "opus" }      ← optional: sonnet · opus · fable (default: the office's)
//
// needsOk (default true): the result waits in WAITING ON APPROVAL for the owner's tick before the
// agent does anything outbound. Switch it off for read-only routines.
import fs from 'node:fs';
import path from 'node:path';
import { describe, nextRun, valid } from './src/when.js';

export const ALLOWED = ['emails', 'fin', 'sales'];
export const NAMES = { emails: 'Emails', fin: 'Accounting', sales: 'Sales', marketing: 'Marketing', ops: 'Operations', delivery: 'Delivery' };
export const file = brainPath => path.join(brainPath, 'Agents Office', 'routines.json');
export const stateFile = dataDir => path.join(dataDir, 'routines.json');
export const LATE_AFTER = 90 * 1000; // a run more than 90 s past its minute was missed (asleep, or the office was off) → runs once, marked LATE

const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const readJSON = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

/** "Routines come to Marketing in a later release. This release: Emails, Accounting, Sales." */
export function refusal(dept) {
  return `Routines come to ${NAMES[dept] || dept} in a later release. This release: Emails, Accounting and Sales.`;
}

/** Normalise + check one routine against the roster. Returns { routine, problems }. Fixed fields are kept as given; bad ones are named. */
export function validate(r, agents, existing = []) {
  const problems = [];
  const out = {};
  const a = agents.find(x => x.id === r.agent);
  out.dept = r.dept || (a && a.department);
  if (!ALLOWED.includes(out.dept)) problems.push(`${r.id || r.title || 'routine'}: ${refusal(out.dept)}`);
  if (!a) problems.push(`${r.id || r.title || 'routine'}: no agent called "${r.agent}"`);
  else if (a.department !== out.dept) problems.push(`${r.id || r.title || 'routine'}: ${a.name} is in ${NAMES[a.department] || a.department}, not ${NAMES[out.dept] || out.dept}`);
  out.agent = r.agent;
  out.text = String(r.text || '').trim();
  if (!out.text) problems.push(`${r.id || 'routine'}: no task text`);
  out.title = String(r.title || out.text).trim().slice(0, 90);
  out.id = String(r.id || slug(out.title) || 'routine');
  if (existing.some(x => x.id === out.id)) problems.push(`${out.id}: two routines share this id`);
  out.when = r.when;
  if (!valid(out.when)) problems.push(`${out.id}: the schedule is not complete (${JSON.stringify(r.when || null)}) — see src/when.js`);
  out.needsOk = r.needsOk !== false;
  out.paused = r.paused === true;
  if (Array.isArray(r.plan)) out.plan = r.plan.slice(0, 4).map(String);
  if (r.model !== undefined && r.model !== '' && r.model !== null) { const m = String(r.model).toLowerCase().trim(); if (['sonnet', 'opus', 'fable'].includes(m)) out.model = m; else problems.push(`${out.id}: model must be sonnet, opus or fable (got "${r.model}")`); }
  return { routine: out, problems };
}

/** Read the brain file, validate every routine. { routines, problems, path } — bad routines are left out. */
export function load(brainPath, agents) {
  const p = file(brainPath);
  const doc = readJSON(p, null);
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.routines) ? doc.routines : [];
  const routines = [], problems = [];
  if (doc && !Array.isArray(doc) && !Array.isArray(doc.routines)) problems.push(`${p}: expected {"routines": [...]}`);
  for (const r of list) {
    const v = validate(r, agents, routines);
    if (v.problems.length) problems.push(...v.problems); else routines.push(v.routine);
  }
  return { routines, problems, path: p, exists: fs.existsSync(p) };
}

export function save(brainPath, routines) {
  const p = file(brainPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const clean = routines.map(r => ({ id: r.id, dept: r.dept, agent: r.agent, title: r.title, text: r.text, when: r.when, needsOk: r.needsOk, paused: r.paused, ...(r.model ? { model: r.model } : {}), ...(r.plan ? { plan: r.plan } : {}) }));
  fs.writeFileSync(p, JSON.stringify({ routines: clean }, null, 2) + '\n');
  return p;
}

/* ---------- run state: data/routines.json → { [id]: { nextAt, lastAt, runs, lastTaskId } } ---------- */
export const loadState = dataDir => readJSON(stateFile(dataDir), {});
export function saveState(dataDir, st) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile(dataDir), JSON.stringify(st, null, 2)); }

/** Give every routine a nextAt (new ones: the next due time from now). Returns the merged view the API serves. */
export function withState(routines, st, now = Date.now()) {
  let changed = false;
  const out = routines.map(r => {
    const s = st[r.id] || (st[r.id] = {});
    if (!s.nextAt || s.when !== JSON.stringify(r.when)) { s.nextAt = nextRun(r.when, now); s.when = JSON.stringify(r.when); changed = true; }
    return { ...r, desc: describe(r.when), nextAt: r.paused ? null : s.nextAt, lastAt: s.lastAt || null, runs: s.runs || 0, lastTaskId: s.lastTaskId || null, lastLate: !!s.lastLate };
  });
  for (const id of Object.keys(st)) if (!routines.some(r => r.id === id)) { delete st[id]; changed = true; } // deleted routines drop their state
  return { list: out, changed };
}

/** What is due now: [{ routine, due, late }]. Paused routines never fire. A due time more than LATE_AFTER ago is a catch-up (E1): once, marked late. */
export function due(routines, st, now = Date.now()) {
  const hits = [];
  for (const r of routines) {
    if (r.paused) continue;
    const s = st[r.id]; if (!s || !s.nextAt) continue;
    if (s.nextAt <= now) hits.push({ routine: r, due: s.nextAt, late: now - s.nextAt > LATE_AFTER });
  }
  return hits;
}

/** After a firing: move the clock on. Never more than one catch-up: the next due time is computed from NOW, not from the missed minute. */
export function advance(st, r, now = Date.now(), taskId = null, late = false) {
  const s = st[r.id] || (st[r.id] = {});
  s.lastAt = now; s.runs = (s.runs || 0) + 1; s.lastTaskId = taskId; s.lastLate = late;
  s.nextAt = nextRun(r.when, now);
  return s;
}

/** Guess whether a task text is outbound (needs the owner's OK) when Claude has not said. */
export function guessNeedsOk(text) {
  const t = String(text).toLowerCase();
  const outbound = /\b(send|sends|email them|reply to|replies|respond|chase|nudge|remind|reminder|post|publish|pay|invoice them|book|schedule a|cancel|update the crm|delete|forward|message)\b/.test(t);
  const readOnly = /\b(list|summari[sz]e|triage|tell me|what|report|match|reconcile|qualify|review|check|read|find|flag|count|draft)\b/.test(t);
  if (/\bdraft\b/.test(t) && !/\bsend\b/.test(t)) return true; // a draft exists to be sent — the send waits for the tick
  return outbound || !readOnly;
}

/** The one-line question the agent asks when a routine's draft is waiting. */
export function askLine(task) {
  return `"${task.title}" is done and waiting for your OK — approve to send it, reject to tell me what to change.`;
}

/** The "routines" list a lead reads back in chat. */
export function listText(list, dept, agents) {
  const mine = list.filter(r => r.dept === dept);
  if (!mine.length) return `Nothing on the ${NAMES[dept]} timetable yet. Give me one with a time in it — "every weekday at 8am, …" — and I will put it on.`;
  const name = id => agents.find(a => a.id === id)?.name || id;
  return `${NAMES[dept]} routines:\n` + mine.map(r => `• ${r.title} — ${r.desc} · ${name(r.agent)}${r.paused ? ' · PAUSED' : ''}${r.needsOk ? ' · waits for your OK' : ' · read-only'}`).join('\n') +
    `\n\nSay "pause …", "resume …", "run … now" or "delete …" with a few words from the name.`;
}

/** Match "pause the monday one" / "run inbox triage now" to a routine in the department by word overlap. */
export function matchRoutine(list, dept, words) {
  const w = String(words).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2 && !['the', 'one', 'now', 'routine', 'and', 'please'].includes(x));
  let best = null, bestN = 0;
  for (const r of list.filter(r => r.dept === dept)) {
    const hay = (r.title + ' ' + r.text + ' ' + r.desc + ' ' + (r.when.at || '')).toLowerCase();
    const n = w.filter(x => hay.includes(x)).length;
    if (n > bestN) { bestN = n; best = r; }
  }
  return bestN ? best : null;
}
