import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds a throwaway office (config + agents + state) from RECORDED-shape real
// data so the suite exercises the real server, real event bus and real UI with
// zero Claude sessions and zero writes to the developer's own office/.
export default function globalSetup() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '.fixture');
  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { recursive: true });

  writeFileSync(join(root, 'office.config.json'), JSON.stringify({
    port: 4478,
    brain: null,
    departments: [
      { name: 'Operations', agents: ['demo', 'ghost'] }, // ghost = vacant desk
      { name: 'Research', agents: ['probe'] },
    ],
  }, null, 2));

  const mkAgent = (name, display) => {
    const aDir = join(root, 'office', 'agents', name);
    mkdirSync(join(aDir, 'out'), { recursive: true });
    mkdirSync(join(root, 'office', 'inbox', name), { recursive: true });
    writeFileSync(join(aDir, 'CLAUDE.md'), `# ${display} (test fixture)\n`);
    writeFileSync(join(aDir, 'manifest.yaml'), [
      `name: ${name}`, `display_name: ${display}`,
      'session: { model: sonnet, effort: high }',
      'schedule: { triggers: [] }', '',
    ].join('\n'));
  };
  mkAgent('demo', 'PROPOSALS');
  mkAgent('probe', 'PROBE');

  // demo's state: recorded-shape events + one pending approval + totals
  const state = join(root, 'office', 'state', 'demo');
  for (const d of ['sessions', 'approvals']) mkdirSync(join(state, d), { recursive: true });
  const t0 = Date.now() - 40 * 60_000;
  const ev = (i, e) => JSON.stringify({ ts: new Date(t0 + i * 60_000).toISOString(), agent: 'demo', ...e });
  const events = [
    ev(0, { type: 'run_start', icon: '🟢', text: 'Run started (cron) — sonnet/high', trigger: 'cron' }),
    ev(1, { type: 'work', icon: '📖', text: 'Reading office/inbox/demo/ridgeline.md', raw: 'tool_use:Read' }),
    ev(2, { type: 'work', icon: '📄', text: 'Writing office/agents/demo/out/proposal.md', raw: 'tool_use:Write' }),
    ev(3, { type: 'file', icon: '📎', text: 'Deliverable: proposal.md', name: 'proposal.md', path: 'office/agents/demo/out/proposal.md', size: 2048 }),
    ev(4, { type: 'say', icon: '💬', text: 'Proposal drafted — queuing the send for your approval.' }),
    ev(5, { type: 'usage', icon: '⛽', text: '182.4k tokens · est. API value $0.38', usage: { input_tokens: 180000, output_tokens: 2400 }, total_cost_usd: 0.38 }),
    ev(6, { type: 'run_end', icon: '🏁', text: 'Run complete (9 turns)' }),
  ];
  const approval = {
    id: 'apr-test01', agent: 'demo', tool: 'mcp__outbound__send_email',
    args: { to: 'ops@ridgeline.example', subject: 'Proposal — Ridgeline Property Group', body: 'fixture' },
    args_hash: 'fixture-hash', files: ['office/agents/demo/out/proposal.md'],
    summary: 'Send email to ops@ridgeline.example — “Proposal — Ridgeline Property Group”',
    created: new Date().toISOString(), status: 'pending', token_used: false,
  };
  events.push(ev(7, {
    type: 'approval', icon: '⚠️', approval_id: approval.id, tool: approval.tool,
    summary: approval.summary, files: approval.files, text: `Approval needed: ${approval.summary}`,
  }));
  writeFileSync(join(state, 'events.jsonl'), events.join('\n') + '\n');
  writeFileSync(join(state, 'approvals', 'apr-test01.json'), JSON.stringify(approval, null, 2));
  writeFileSync(join(state, 'status.json'), JSON.stringify({
    status: 'stuck',
    last_run: { started: new Date(t0).toISOString(), ended: new Date(t0 + 6 * 60_000).toISOString(), trigger: 'cron', session_id: 'fixture', ok: true },
    totals: { day: new Date().toISOString().slice(0, 10), tokens_today: 182400, cost_today: 0.38, runs_today: 1 },
  }, null, 2));
}
