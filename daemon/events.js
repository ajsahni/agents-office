import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function agentStateDir(cfg, agent) {
  const dir = join(cfg.stateDir, agent);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'approvals'), { recursive: true });
  return dir;
}

// One normalised line per happening. events.jsonl is the UI's only food,
// so anything worth showing must pass through here.
export function emit(cfg, agent, event, { echo = false } = {}) {
  const dir = agentStateDir(cfg, agent);
  const line = { ts: new Date().toISOString(), agent, ...event };
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(line) + '\n');
  if (echo) console.log(`  ${line.icon ?? '·'} ${line.type.padEnd(9)} ${line.text ?? ''}`);
  return line;
}

export function readStatus(cfg, agent) {
  const file = join(agentStateDir(cfg, agent), 'status.json');
  if (!existsSync(file)) return { status: 'idle', last_run: null, counters: {}, totals: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function patchStatus(cfg, agent, patch) {
  const cur = readStatus(cfg, agent);
  const next = { ...cur, ...patch, counters: { ...cur.counters, ...patch.counters }, totals: { ...cur.totals, ...patch.totals } };
  writeFileSync(join(agentStateDir(cfg, agent), 'status.json'), JSON.stringify(next, null, 2));
  return next;
}

// Cumulative token/cost tallies keyed by day so "today" survives daemon restarts.
export function addUsage(cfg, agent, usage, costUsd) {
  const day = new Date().toISOString().slice(0, 10);
  const cur = readStatus(cfg, agent);
  const t = cur.totals ?? {};
  if (t.day !== day) { t.day = day; t.tokens_today = 0; t.cost_today = 0; t.runs_today = 0; }
  const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  t.tokens_today += tokens;
  t.cost_today = +(t.cost_today + (costUsd ?? 0)).toFixed(4);
  t.runs_today += 1;
  return patchStatus(cfg, agent, { totals: t });
}
