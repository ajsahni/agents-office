import { existsSync } from 'node:fs';
import { listAgents, loadManifest } from './manifest.js';
import { readStatus, emit } from './events.js';
import { runAgent } from './runner.js';
import { pendingApprovals } from './approvals.js';

// An agent with this many undecided approvals gets no NEW scheduled runs —
// the queue must not pile up while the owner is away.
const PENDING_APPROVAL_CAP = 2;

// Minimal 5-field cron matcher: * , - / and plain numbers.
export function cronMatches(expr, date) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const vals = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  return fields.every((f, i) => matchField(f, vals[i]));
}

function matchField(field, val) {
  return field.split(',').some((part) => {
    let step = 1;
    if (part.includes('/')) { const [p, s] = part.split('/'); step = Number(s); part = p; }
    if (part === '*') return val % step === 0;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      return val >= a && val <= b && (val - a) % step === 0;
    }
    return Number(part) === val;
  });
}

function inWorkday(workday, date) {
  if (!workday) return true;
  const hm = date.toTimeString().slice(0, 5);
  const dayOk = !workday.days || workday.days.includes(date.getDay());
  return dayOk && (!workday.start || hm >= workday.start) && (!workday.end || hm <= workday.end);
}

// Most recent cron firing before `now`, scanned minute-by-minute (bounded lookback).
function lastScheduled(triggers, now, lookbackHours = 26) {
  const t = new Date(now);
  t.setSeconds(0, 0);
  for (let i = 0; i < lookbackHours * 60; i++) {
    t.setMinutes(t.getMinutes() - 1);
    if (triggers.some((tr) => tr.type === 'cron' && cronMatches(tr.when, t))) return new Date(t);
  }
  return null;
}

export function startScheduler(cfg, { echo = true } = {}) {
  const running = new Set();
  const firedThisMinute = new Set();
  let lastMinute = null;

  async function fire(agent, trigger) {
    if (running.has(agent) || running.size >= cfg.globalConcurrency) return;
    running.add(agent);
    try {
      await runAgent(cfg, agent, { trigger, echo });
    } catch (err) {
      emit(cfg, agent, { type: 'warn', icon: '🔴', text: `Run error: ${err.message}` }, { echo });
    } finally {
      running.delete(agent);
    }
  }

  async function tick() {
    if (existsSync(cfg.pauseFlag)) return;
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);
    if (minuteKey !== lastMinute) { firedThisMinute.clear(); lastMinute = minuteKey; }

    for (const agent of listAgents(cfg)) {
      let m;
      try { m = loadManifest(cfg, agent); } catch { continue; }
      const st = readStatus(cfg, agent);
      const runsToday = st.totals?.day === now.toISOString().slice(0, 10) ? (st.totals.runs_today ?? 0) : 0;
      if (m.schedule.max_runs_per_day && runsToday >= m.schedule.max_runs_per_day) continue;
      if (!inWorkday(m.schedule.workday, now)) continue;
      if (pendingApprovals(cfg, agent).length >= PENDING_APPROVAL_CAP) continue;

      const crons = (m.schedule.triggers ?? []).filter((t) => t.type === 'cron');
      const due = crons.some((t) => cronMatches(t.when, now));
      if (due && !firedThisMinute.has(agent)) {
        firedThisMinute.add(agent);
        fire(agent, 'cron');
        continue;
      }

      // Sleep/wake catch-up: one missed slot recovered if the manifest says `once`.
      if (m.schedule.missed_run === 'once' && !running.has(agent)) {
        const sched = lastScheduled(crons, now);
        const lastRun = st.last_run?.started ? new Date(st.last_run.started) : null;
        if (sched && (!lastRun || lastRun < sched) && !firedThisMinute.has(agent)) {
          firedThisMinute.add(agent);
          fire(agent, 'catch-up');
        }
      }
    }
  }

  console.log(`office scheduler up — watching ${cfg.agentsDir}`);
  tick();
  return setInterval(tick, 30_000);
}
