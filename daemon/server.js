import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { listAgents, loadManifest, agentDir } from './manifest.js';
import { readStatus, agentStateDir, emit } from './events.js';
import { runAgent, chatWith } from './runner.js';
import { pendingApprovals } from './approvals.js';
import { deptOf, BRAIN_COLOURS, loadConfig } from './config.js';
import { newAgent } from './wizard.js';

const REPLAY_LINES = 200;

function uiFile(cfg) {
  for (const f of ['command-centre.html', 'command-centre-v2.html']) {
    const p = join(cfg.uiDir, f);
    if (existsSync(p)) return p;
  }
  return null;
}

function agentSummary(cfg, id) {
  const m = loadManifest(cfg, id);
  const s = readStatus(cfg, id);
  const dept = deptOf(cfg, id);
  return {
    id,
    name: m.name ?? id,
    display_name: m.display_name,
    department: dept?.key ?? null,
    colour: dept?.colours.chip ?? null,
    status: s.status ?? 'idle',
    last_run: s.last_run ?? null,
    totals: s.totals ?? {},
    session: m.session,
    schedule: m.schedule,
    pending_approvals: pendingApprovals(cfg, id).map(({ id: aid, summary, created, files }) => ({ id: aid, summary, created, files })),
  };
}

function tailLines(file, n) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean);
  return lines.slice(-n);
}

// SSE fan-out fed by polling each agent's events.jsonl. File-based (not an
// in-memory bus) so events from a separate `office run` process stream too.
function startEventFeed(cfg, clients) {
  const offsets = new Map();
  const poll = () => {
    for (const agent of listAgents(cfg)) {
      const file = join(agentStateDir(cfg, agent), 'events.jsonl');
      if (!existsSync(file)) continue;
      const size = statSync(file).size;
      const prev = offsets.get(file);
      if (prev === undefined) { offsets.set(file, size); continue; } // history goes out via replay, not live
      if (size < prev) { offsets.set(file, size); continue; } // truncated/rotated
      if (size === prev) continue;
      const fd = openSync(file, 'r');
      const buf = Buffer.alloc(size - prev);
      readSync(fd, buf, 0, buf.length, prev);
      closeSync(fd);
      offsets.set(file, size);
      for (const line of buf.toString('utf8').split('\n').filter(Boolean)) {
        for (const res of clients) res.write(`data: ${line}\n\n`);
      }
    }
  };
  return setInterval(poll, 500);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

export function startServer(cfg, { decideApproval } = {}) {
  const clients = new Set();
  const feed = startEventFeed(cfg, clients);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${cfg.port}`);
    const path = url.pathname;
    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        const file = uiFile(cfg);
        if (!file) return send(res, 500, { error: 'UI not built — run: npm run build:ui' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(file));
        return;
      }
      // The office shape the 3D scene is built from: departments in config
      // order (colours auto-assigned), each agent marked hired or vacant.
      // Config is re-read here so editing office.config.json only needs a
      // page reload, not a daemon restart.
      if (req.method === 'GET' && path === '/api/office') {
        try { Object.assign(cfg, loadConfig()); } catch { /* invalid mid-edit — serve the last good shape */ }
        const hired = new Set(listAgents(cfg));
        return send(res, 200, {
          port: cfg.port,
          brain: cfg.brainDir ? { colours: BRAIN_COLOURS } : null,
          departments: cfg.departments.map((d) => ({
            key: d.key, name: d.name, colours: d.colours,
            agents: d.agents.map((a) => ({ id: a, hired: hired.has(a) })),
          })),
          warnings: cfg.warnings,
        });
      }
      if (req.method === 'GET' && path === '/api/agents') {
        return send(res, 200, { agents: listAgents(cfg).map((id) => agentSummary(cfg, id)) });
      }
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const agent of listAgents(cfg)) {
          for (const line of tailLines(join(agentStateDir(cfg, agent), 'events.jsonl'), REPLAY_LINES)) {
            res.write(`data: ${line}\n\n`);
          }
        }
        res.write(`data: ${JSON.stringify({ type: 'replay_done', ts: new Date().toISOString() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      const agentMatch = path.match(/^\/api\/agents\/([\w-]+)\/(run|chat|settings)$/);
      if (req.method === 'POST' && agentMatch) {
        const [, id, action] = agentMatch;
        if (!listAgents(cfg).includes(id)) return send(res, 404, { error: `no agent ${id}` });
        if (action === 'run') {
          runAgent(cfg, id, { trigger: 'manual' }).catch((err) =>
            emit(cfg, id, { type: 'warn', icon: '🔴', text: `Run error: ${err.message}` }));
          return send(res, 200, { ok: true });
        }
        if (action === 'chat') {
          const { text } = await readBody(req);
          if (!text?.trim()) return send(res, 400, { error: 'empty message' });
          const r = await chatWith(cfg, id, text.trim());
          return send(res, 200, { ok: true, ...r });
        }
        if (action === 'settings') {
          const body = await readBody(req);
          const file = join(agentDir(cfg, id), 'manifest.yaml');
          const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
          if (body.model) doc.setIn(['session', 'model'], body.model);
          if (body.effort) doc.setIn(['session', 'effort'], body.effort);
          writeFileSync(file, doc.toString());
          emit(cfg, id, { type: 'work', icon: '⚙️', text: `Settings changed: ${Object.entries(body).map(([k, v]) => `${k}→${v}`).join(', ')} (applies from next session)` });
          return send(res, 200, { ok: true, applies: 'next session' });
        }
      }

      // Hire from the office UI — the same blank-custom wizard, scripted.
      if (req.method === 'POST' && path === '/api/hire') {
        const body = await readBody(req);
        const answers = {};
        for (const k of ['NAME', 'DEPARTMENT', 'SCHEDULE', 'MODEL', 'EFFORT', 'INSTRUCTIONS']) {
          if (body[k] != null && String(body[k]).trim()) answers[k] = String(body[k]).trim();
        }
        try {
          const hired = await newAgent(cfg, { answers });
          Object.assign(cfg, loadConfig()); // config changed on disk — refresh the live office shape
          emit(cfg, hired.name, { type: 'status', icon: '🎉', text: `Hired into ${hired.department}` });
          return send(res, 200, { ok: true, ...hired });
        } catch (err) {
          return send(res, 400, { ok: false, error: err.message });
        }
      }

      const approvalMatch = path.match(/^\/api\/approvals\/([\w-]+)\/decision$/);
      if (req.method === 'POST' && approvalMatch) {
        if (!decideApproval) return send(res, 501, { error: 'approvals not wired' });
        const body = await readBody(req);
        const out = await decideApproval(approvalMatch[1], body);
        return send(res, out.ok ? 200 : 404, out);
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`Command Centre: http://localhost:${cfg.port}`);
    for (const w of cfg.warnings) console.log(`  ⚠ ${w}`);
  });
  server.on('close', () => clearInterval(feed));
  return server;
}
