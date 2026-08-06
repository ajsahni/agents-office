import { query } from '@anthropic-ai/claude-agent-sdk';
import { join, resolve, relative, basename, isAbsolute } from 'node:path';
import { existsSync, writeFileSync, rmSync, statSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { emit, agentStateDir, patchStatus, addUsage, readStatus } from './events.js';
import { loadManifest, agentDir, EFFORT_THINKING_TOKENS } from './manifest.js';
import { outboundGate, outboundMcpServer } from './approvals.js';
import { pullBrain, commitRun } from './gitsync.js';

const inside = (child, parent) => {
  const r = relative(parent, resolve(child));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

// Live sessions in this process: agent -> handle. Chat pushes arrive through here.
const live = new Map();
export const liveSession = (agent) => live.get(agent);

class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(m) {
    if (this.closed) return false;
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false }); else this.items.push(m);
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

const userMessage = (text) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
  parent_tool_use_id: null,
  session_id: '',
});

function describeTool(cfg, name, input) {
  const rel = (p) => (p ? relative(cfg.rootDir, resolve(p)) : '');
  switch (name) {
    case 'Read': return ['📖', `Reading ${rel(input.file_path)}`];
    case 'Glob': return ['🔎', `Scanning ${input.pattern ?? ''}`];
    case 'Grep': return ['🔎', `Searching for "${input.pattern ?? ''}"`];
    case 'Write': return ['📄', `Writing ${rel(input.file_path)}`];
    case 'Edit': return ['✏️', `Editing ${rel(input.file_path)}`];
    case 'TodoWrite': return ['🗒️', 'Updating work plan'];
    default: return ['⚙️', name.startsWith('mcp__') ? name.replace(/^mcp__/, '').replace(/__/g, ': ') : name];
  }
}

// Write law (ported from v1): own folder + office/inbox/** + the brain (when
// configured). Reads: anywhere in office/ + the brain. Enforced here, not by
// politeness. User-configured MCP tools pass silently; outbound routes through
// the approval gate first.
function buildPermissionGate(cfg, agent, aDir, extraGate) {
  const writeRoots = [aDir, cfg.inboxDir, ...(cfg.brainDir ? [cfg.brainDir] : [])];
  const readRoots = [cfg.officeDir, ...(cfg.brainDir ? [cfg.brainDir] : [])];
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
  const outbound = outboundGate(cfg, agent);
  return async (toolName, input, opts) => {
    if (extraGate) {
      const verdict = await extraGate(toolName, input, opts);
      if (verdict) return verdict;
    }
    const outboundVerdict = outbound(toolName, input);
    if (outboundVerdict) return outboundVerdict;
    if (toolName.startsWith('mcp__')) {
      // Not the outbound server (handled above) — a tool the user configured
      // themselves. Their MCP servers, their call: allow silently.
      return { behavior: 'allow', updatedInput: input };
    }
    if (WRITE_TOOLS.has(toolName)) {
      const target = input.file_path ?? input.notebook_path;
      if (target && writeRoots.some((r) => inside(target, r))) {
        return { behavior: 'allow', updatedInput: input };
      }
      return { behavior: 'deny', message: `Write blocked: ${target} is outside your permitted paths (your agent folder, office/inbox/${cfg.brainDir ? ', and the brain' : ''}). Work only inside those.` };
    }
    if (READ_TOOLS.has(toolName)) {
      const target = input.file_path ?? input.path;
      if (!target || readRoots.some((r) => inside(target, r))) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: `Read blocked: ${target} is outside the office${cfg.brainDir ? ' and the brain' : ''}. Agents read only their own workspace.` };
    }
    return { behavior: 'deny', message: `Tool ${toolName} is not permitted for office agents.` };
  };
}

// The daemon, not the agent, discovers work: relative Glob can't see outside the
// agent's cwd, and skipping empty runs protects the usage window.
function openInboxTasks(cfg, agent) {
  const dir = join(cfg.inboxDir, agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f))
    .filter((p) => !/^[\s*_]*status[*_]*\s*:\s*[*_]*\s*(done|escalated)/im.test(readFileSync(p, 'utf8')))
    .sort();
}

export function appendChat(cfg, agent, entry) {
  const line = { ts: new Date().toISOString(), ...entry };
  appendFileSync(join(agentStateDir(cfg, agent), 'chat.jsonl'), JSON.stringify(line) + '\n');
  return line;
}

// Push a chat message to an agent. Live session → next user turn; idle → resume
// its last session with context intact. Returns false only if no session
// can be started.
export async function chatWith(cfg, agent, text, { echo = false } = {}) {
  appendChat(cfg, agent, { from: 'owner', text });
  emit(cfg, agent, { type: 'user_say', icon: '👤', text }, { echo });
  const handle = live.get(agent);
  if (handle) {
    handle.touch();
    handle.queue.push(userMessage(text));
    return { delivered: 'live' };
  }
  const lastSession = readStatus(cfg, agent).last_run?.session_id ?? undefined;
  // Fire-and-forget: events stream the reply; callers shouldn't block on the run.
  // If another process holds the agent's lock, wait for it to free up (up to 3 min)
  // rather than dropping the message.
  (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const resume = readStatus(cfg, agent).last_run?.session_id ?? undefined;
        await runAgent(cfg, agent, { trigger: 'chat', prompt: text, resume, keepAliveMs: 120_000, echo });
        return;
      } catch (err) {
        if (/already has a running session/.test(err.message) && attempt < 36) {
          if (live.has(agent)) { // session opened in THIS process while we waited — deliver live
            const h = live.get(agent);
            h.touch(); h.queue.push(userMessage(text));
            return;
          }
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        emit(cfg, agent, { type: 'warn', icon: '🔴', text: `Chat session error: ${err.message}` }, { echo });
        return;
      }
    }
  })();
  return { delivered: 'resumed', resumed: lastSession ?? null };
}

export async function runAgent(cfg, agent, { trigger = 'manual', prompt, echo = false, resume, keepAliveMs = 0, extraGate, onMessage } = {}) {
  const aDir = agentDir(cfg, agent);
  if (!existsSync(aDir)) throw new Error(`Agent folder missing: ${aDir}`);
  if (process.env.OFFICE_NO_SESSIONS === '1') { // test mode: full plumbing, zero Claude sessions
    emit(cfg, agent, { type: 'warn', icon: '🧪', text: `Session suppressed (test mode) — trigger: ${trigger}` }, { echo });
    return { skipped: true, is_error: false };
  }
  const manifest = loadManifest(cfg, agent);
  const stateDir = agentStateDir(cfg, agent);

  let task = prompt;
  if (!task) {
    const open = openInboxTasks(cfg, agent);
    if (!open.length) {
      emit(cfg, agent, { type: 'run_skip', icon: '📭', text: `No open inbox tasks — session not started (${trigger})` }, { echo });
      return { skipped: true, is_error: false };
    }
    task = `Your inbox has ${open.length} open task file(s). Process the OLDEST one first:\n${open.map((p) => `- ${p}`).join('\n')}\nRead the task file with its absolute path above, then follow your CLAUDE.md exactly. Your working directory is your agent folder; always use absolute paths with file tools when touching anything outside it.`;
  }

  const lock = join(stateDir, 'running.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    try { process.kill(pid, 0); throw new Error(`Agent ${agent} already has a running session (pid ${pid})`); }
    catch (e) { if (e.code !== 'ESRCH') throw e; rmSync(lock); } // stale lock from a dead process
  }
  writeFileSync(lock, String(process.pid));
  pullBrain(cfg, agent); // brain sync: pull-rebase before every run (no-op without a brain repo)

  const { model, effort } = manifest.session;
  const started = new Date().toISOString();
  emit(cfg, agent, { type: 'run_start', icon: '🟢', text: `Run started (${trigger}) — ${model}/${effort}`, trigger, model, effort }, { echo });
  patchStatus(cfg, agent, { status: 'running' });

  const record = { session_id: resume ?? null, trigger, started, ended: null, model, effort, resumed_from: resume ?? null, usage: null, total_cost_usd: 0, num_turns: 0, is_error: false, result: null };

  const queue = new InputQueue();
  queue.push(userMessage(task));
  let closeTimer = null;
  const handle = {
    queue,
    sessionId: null,
    touch() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    },
    scheduleClose() {
      if (keepAliveMs > 0) {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => queue.close(), keepAliveMs);
      } else {
        queue.close();
      }
    },
  };
  live.set(agent, handle);

  try {
    const q = query({
      prompt: queue,
      options: {
        cwd: aDir,
        model,
        resume,
        maxThinkingTokens: EFFORT_THINKING_TOKENS[effort] ?? EFFORT_THINKING_TOKENS.medium,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['project'], // loads the agent's CLAUDE.md + any .mcp.json in its folder — nothing of the host user's
        additionalDirectories: cfg.brainDir ? [cfg.brainDir] : [],
        disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'Task', 'KillShell'],
        canUseTool: buildPermissionGate(cfg, agent, aDir, extraGate),
        mcpServers: { outbound: outboundMcpServer(cfg, agent) },
        maxTurns: 150,
        hooks: {
          PostToolUse: [{
            hooks: [async (h) => {
              if ((h.tool_name === 'Write' || h.tool_name === 'Edit') && h.tool_input?.file_path) {
                const p = resolve(h.tool_input.file_path);
                if (inside(p, join(aDir, 'out'))) {
                  let size = 0; try { size = statSync(p).size; } catch {}
                  emit(cfg, agent, { type: 'file', icon: '📎', text: `Deliverable: ${basename(p)}`, name: basename(p), path: relative(cfg.rootDir, p), size }, { echo });
                }
              }
              return {};
            }],
          }],
        },
      },
    });

    for await (const msg of q) {
      if (onMessage) await onMessage(msg, handle);
      if (msg.type === 'system' && msg.subtype === 'init') {
        record.session_id = msg.session_id;
        handle.sessionId = msg.session_id;
        emit(cfg, agent, { type: 'status', icon: '⌨️', text: `Session ${msg.session_id.slice(0, 8)} up (${msg.model})`, session_id: msg.session_id }, { echo });
      } else if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
        emit(cfg, agent, { type: 'warn', icon: '⚠️', text: `Auto-compaction fired (${msg.compact_metadata.trigger}, ${msg.compact_metadata.pre_tokens} tokens) — context was compressed mid-run` }, { echo });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content ?? []) {
          if (block.type === 'text' && block.text.trim()) {
            emit(cfg, agent, { type: 'say', icon: '💬', text: block.text.trim() }, { echo });
            appendChat(cfg, agent, { from: 'agent', text: block.text.trim() });
          } else if (block.type === 'tool_use') {
            const [icon, text] = describeTool(cfg, block.name, block.input ?? {});
            emit(cfg, agent, { type: 'work', icon, text, raw: `tool_use:${block.name}` }, { echo });
          }
        }
      } else if (msg.type === 'result') {
        record.session_id = msg.session_id;
        record.usage = msg.usage;
        record.total_cost_usd = msg.total_cost_usd;
        record.num_turns = msg.num_turns;
        record.is_error = msg.is_error;
        record.result = msg.subtype === 'success' ? msg.result?.slice(0, 2000) : (msg.errors ?? []).join('; ');
        emit(cfg, agent, { type: 'usage', icon: '⛽', text: `${fmtTokens(msg.usage)} · est. API value $${msg.total_cost_usd.toFixed(4)}`, usage: msg.usage, total_cost_usd: msg.total_cost_usd }, { echo });
        // With streaming input a result ends each user turn, not the session —
        // close now (scheduled runs) or arm the idle timer (chat sessions).
        handle.scheduleClose();
      }
    }
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
    live.delete(agent);
    rmSync(lock, { force: true });
    record.ended = new Date().toISOString();
    if (record.session_id) {
      writeFileSync(join(stateDir, 'sessions', `${record.started.replace(/[:.]/g, '-')}.json`), JSON.stringify(record, null, 2));
    }
    if (record.usage) addUsage(cfg, agent, record.usage, record.total_cost_usd);
    patchStatus(cfg, agent, { status: record.is_error ? 'error' : 'idle', last_run: { started: record.started, ended: record.ended, trigger, session_id: record.session_id, ok: !record.is_error } });
    emit(cfg, agent, { type: 'run_end', icon: record.is_error ? '🔴' : '🏁', text: record.is_error ? `Run failed: ${record.result}` : `Run complete (${record.num_turns} turns)` }, { echo });
    commitRun(cfg, agent, `${trigger} run ${started.slice(0, 16)} — ${record.num_turns} turns${record.is_error ? ', FAILED' : ''}`);
  }
  return record;
}

function fmtTokens(u) {
  const total = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
  return `${(total / 1000).toFixed(1)}k tokens`;
}
