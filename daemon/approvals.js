import { createHash, randomBytes } from 'node:crypto';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { join } from 'node:path';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { emit, agentStateDir, patchStatus } from './events.js';
import { listAgents } from './manifest.js';

// Frozen-args discipline: what sends is exactly what the owner saw. Any change re-queues.
export const argsHash = (args) =>
  createHash('sha256').update(JSON.stringify(args, Object.keys(args).sort())).digest('hex');

const approvalsDir = (cfg, agent) => join(agentStateDir(cfg, agent), 'approvals');

function writeApproval(cfg, agent, rec) {
  writeFileSync(join(approvalsDir(cfg, agent), `${rec.id}.json`), JSON.stringify(rec, null, 2));
}

export function findApproval(cfg, id) {
  for (const agent of listAgents(cfg)) {
    const f = join(approvalsDir(cfg, agent), `${id}.json`);
    if (existsSync(f)) return { agent, rec: JSON.parse(readFileSync(f, 'utf8')) };
  }
  return null;
}

export function pendingApprovals(cfg, agent) {
  const dir = approvalsDir(cfg, agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((r) => r.status === 'pending');
}

// Layer-1 gate, called from the runner's canUseTool for every mcp__outbound__ call.
// Approved-and-unused token with a matching args-hash → allow ONCE. Anything else
// → queue + deny-with-reason. Unknown outbound tools stay denied (default-deny).
export function outboundGate(cfg, agent) {
  return (toolName, input) => {
    if (!toolName.startsWith('mcp__outbound__')) return null; // not ours — fall through
    if (toolName !== 'mcp__outbound__send_email') {
      return { behavior: 'deny', message: `Outbound tool ${toolName} is not approved for use.` };
    }
    const hash = argsHash(input);
    const dir = approvalsDir(cfg, agent);
    mkdirSync(dir, { recursive: true });

    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (rec.status === 'approved' && !rec.token_used && rec.args_hash === hash) {
        rec.token_used = true;
        rec.executed_ts = new Date().toISOString();
        writeApproval(cfg, agent, rec);
        return { behavior: 'allow', updatedInput: input };
      }
      if (rec.status === 'approved' && !rec.token_used && rec.args_hash !== hash && rec.tool === toolName) {
        return { behavior: 'deny', message: `Arguments differ from what was approved (approval ${rec.id}). Any change needs a fresh approval — call the tool again with the EXACT approved arguments, or queue a new request.` };
      }
    }

    const id = `apr-${randomBytes(3).toString('hex')}`;
    const rec = {
      id, agent, tool: toolName, args: input, args_hash: hash,
      files: input.attachments ?? [],
      summary: `Send email to ${input.to} — “${input.subject}”`,
      created: new Date().toISOString(), status: 'pending', token_used: false,
    };
    writeApproval(cfg, agent, rec);
    patchStatus(cfg, agent, { status: 'stuck' });
    emit(cfg, agent, {
      type: 'approval', icon: '⚠️', approval_id: id, tool: toolName,
      summary: rec.summary, files: rec.files,
      text: `Approval needed: ${rec.summary}`,
    });
    return { behavior: 'deny', message: `Queued for your owner as approval ${id}. This block is the system working, not an error — say what you've queued and end your turn cleanly. Do NOT retry.` };
  };
}

// The outbound MCP server. A "send" writes a fully-formed record to the agent's
// outbox/ — same gate, same flow; wire a real sender behind it if you want one.
export function outboundMcpServer(cfg, agent) {
  return createSdkMcpServer({
    name: 'outbound',
    version: '1.0.0',
    tools: [
      tool(
        'send_email',
        'Send an email on behalf of your owner. ALWAYS requires their approval: your first call queues the request and is blocked — that is expected. Only after they approve (you will be resumed and told) call again with EXACTLY the same arguments.',
        {
          to: z.string().describe('Recipient email address'),
          subject: z.string(),
          body: z.string().describe('Plain-text email body'),
          attachments: z.array(z.string()).optional().describe('Paths of files to attach'),
        },
        async (args) => {
          const dir = join(agentStateDir(cfg, agent), 'outbox');
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          writeFileSync(file, JSON.stringify({ ...args, sent_via: 'outbox (no live email connector configured)' }, null, 2));
          emit(cfg, agent, { type: 'say', icon: '✅', text: `Sent: “${args.subject}” to ${args.to} (written to outbox)` });
          return { content: [{ type: 'text', text: `Sent. Recorded at ${file}.` }] };
        }
      ),
    ],
  });
}

export async function decideApproval(cfg, id, { decision, notes } = {}) {
  const found = findApproval(cfg, id);
  if (!found) return { ok: false, error: `no approval ${id}` };
  const { agent, rec } = found;
  if (rec.status !== 'pending') return { ok: false, error: `approval ${id} already ${rec.status}` };
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, error: 'decision must be approve|reject' };

  rec.status = decision === 'approve' ? 'approved' : 'rejected';
  rec.decision_ts = new Date().toISOString();
  rec.notes = notes ?? null;
  writeApproval(cfg, agent, rec);
  patchStatus(cfg, agent, { status: 'idle' });
  emit(cfg, agent, { type: 'approval_decided', icon: decision === 'approve' ? '✅' : '✗', approval_id: id, decision, text: `Owner ${decision === 'approve' ? 'approved' : 'rejected'} ${id}${notes ? ` — “${notes}”` : ''}` });

  const { chatWith } = await import('./runner.js'); // deferred: avoids circular import at load
  const msg = decision === 'approve'
    ? `Approved — proceed with approval ${id}. Call send_email again with EXACTLY the same arguments you queued. Then confirm in one line.`
    : `Approval ${id} rejected${notes ? ` with notes: ${notes}` : ''}. Revise per the notes and queue a fresh approval, or drop it if the notes say so. Do not send the rejected version.`;
  await chatWith(cfg, agent, msg);
  return { ok: true, id, decision };
}
