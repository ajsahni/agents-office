// Agents Office V3.6 — the usage gauge: what the subscription has used, shown the way Claude Code's
// own usage screen shows it (session and week, percent and reset time).
//
// A3 (AJ, 9 Sep 2026): read the same endpoint Claude Code reads, with the token Claude Code already
// keeps on this machine (the keychain on macOS, ~/.claude/.credentials.json elsewhere). The token
// is read into memory, sent only to Anthropic's usage endpoint, never logged, never written. The
// endpoint is not a documented one, so when it does not answer the office falls back to its own
// count: the tokens its runs have used in the current five-hour window. No dollars anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
export const WINDOW = 5 * 3600 * 1000;
export const stateFile = dataDir => path.join(dataDir, 'usage.json');

/** The login token Claude Code stores on this machine, or null. Never log the value. */
export function readToken() {
  if (process.platform === 'darwin') {
    const r = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) { try { const t = JSON.parse(r.stdout).claudeAiOauth?.accessToken; if (t) return t; } catch {} }
  }
  try { const t = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth?.accessToken; if (t) return t; } catch {}
  return null;
}

/** Claude's answer → { session, week } with percent and resetsAt (ms), or null when the shape is unknown. */
export function parseUsage(j) {
  const pick = x => x && typeof x.utilization === 'number'
    ? { percent: Math.max(0, Math.min(100, Math.round(x.utilization))), resetsAt: x.resets_at ? Date.parse(x.resets_at) || null : null } : null;
  const session = pick(j?.five_hour), week = pick(j?.seven_day);
  if (!session && !week) return null;
  return { session, week };
}

export async function fetchUsage() {
  const token = readToken();
  if (!token) return { ok: false, reason: 'no Claude Code login found on this machine' };
  try {
    const r = await fetch(ENDPOINT, { headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: `Claude's usage endpoint answered ${r.status}` };
    const u = parseUsage(await r.json());
    if (!u) return { ok: false, reason: "Claude's usage endpoint answered in a shape the office does not know" };
    return { ok: true, source: 'claude', ...u };
  } catch (e) { return { ok: false, reason: e.name === 'TimeoutError' ? "Claude's usage endpoint timed out" : e.message }; }
}

/* ---------- the office's own count (underneath): tokens this five-hour window ---------- */
export const loadState = dataDir => { try { return JSON.parse(fs.readFileSync(stateFile(dataDir), 'utf8')); } catch { return {}; } };
export function saveState(dataDir, st) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile(dataDir), JSON.stringify(st)); }
export function windowState(st, now = Date.now()) {
  if (!st.startedAt || now - st.startedAt >= WINDOW) return { startedAt: null, tokens: 0, runs: 0 };
  return { startedAt: st.startedAt, tokens: st.tokens || 0, runs: st.runs || 0 };
}
/** One run's `usage` (the CLI result's fields) added to the window. Returns the new state. */
export function record(st, usage, now = Date.now()) {
  const w = windowState(st, now);
  if (!w.startedAt) w.startedAt = now;
  const u = usage || {};
  w.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  w.runs += 1;
  return w;
}
export function fallback(st, now = Date.now()) {
  const w = windowState(st, now);
  return { ok: true, source: 'office', window: { tokens: w.tokens, runs: w.runs, startedAt: w.startedAt, resetsAt: w.startedAt ? w.startedAt + WINDOW : null } };
}
