import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { listAgents } from './manifest.js';
import { configPath, MAX_DEPARTMENTS, MAX_AGENTS_PER_DEPT } from './config.js';
import { commitRun } from './gitsync.js';

// The hiring wizard — blank custom agents only, no shipped templates.
// Interactive by default; `answers` short-circuits questions (scripts, tests,
// and the settings UI all drive it that way).

const OPERATING_RULES = (name, displayName, cfg) => `# ${displayName}

You are ${displayName}, an agent employee in this office. The rules below are how
the office works; everything under "Your job" is what you were hired to do.

## How the office works

- **Inbox**: your work arrives as task files in \`office/inbox/${name}/*.md\`.
  When the daemon starts a run it tells you which files are open. Work the oldest
  first. When a task is finished, edit its file to start with \`Status: done\`
  (or \`Status: escalated\` with a note saying why you couldn't finish it).
- **Where you may write**: your own folder (\`office/agents/${name}/\`) and the
  inbox${cfg.brainDir ? ', and the shared brain folder' : ''}. Nothing else — writes outside are blocked, not just discouraged.
- **Deliverables** go in your \`out/\` folder — files there are surfaced to your owner.
- **Memory**: keep \`memory.md\` in your folder up to date — one dated line per
  durable learning. Read it at the start of every run.
- **Outbound actions** (like send_email) ALWAYS queue for your owner's approval
  first. A blocked first call is the system working, not an error: say what you
  queued and end your turn. After approval, you'll be resumed and told to retry
  with exactly the same arguments.
- **Chat**: your owner may message you mid-run or between runs. Answer directly,
  then get back to work.

## Your job

`;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function newAgent(cfg, { answers = {} } = {}) {
  let rl = null;
  const ask = async (q, def) => {
    if (rl === null) rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question(`${q}${def ? ` [${def}]` : ''} `)).trim();
    return a || def || '';
  };
  const get = async (key, q, def) => answers[key] ?? await ask(q, def);

  try {
    const name = (await get('NAME', 'Agent name (short, lowercase, e.g. scout):')).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Agent name "${name}" must be short lowercase (a-z, 0-9, -)`);
    if (listAgents(cfg).includes(name)) throw new Error(`Agent "${name}" already exists`);

    const deptNames = cfg.departments.map((d) => d.name);
    const deptPrompt = deptNames.length
      ? `Department (${deptNames.join(' / ')} — or a new name):`
      : 'Department (a new department will be created):';
    const deptName = await get('DEPARTMENT', deptPrompt, deptNames[0]);
    if (!deptName) throw new Error('DEPARTMENT is required');

    const schedule = await get('SCHEDULE', 'Cron schedule (5 fields, e.g. "0 9 * * 1-5") or "manual":', 'manual');
    const model = await get('MODEL', 'Model (haiku / sonnet / opus):', 'sonnet');
    const effort = await get('EFFORT', 'Effort (low / medium / high):', 'medium');
    const instructions = await get('INSTRUCTIONS', 'What is this agent\'s job? (one paragraph; refine CLAUDE.md later):', '');
    if (!instructions) throw new Error('INSTRUCTIONS is required — an agent needs a job');

    // Seat check + config update happen against the RAW config file so user
    // formatting/fields we don't know about survive.
    const cfgFile = configPath(cfg.rootDir);
    const raw = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : { port: cfg.port, brain: null, departments: [] };
    raw.departments = raw.departments ?? [];
    let dept = raw.departments.find((d) => String(d.name).toLowerCase() === deptName.toLowerCase());
    if (!dept) {
      if (raw.departments.length >= MAX_DEPARTMENTS) throw new Error(`Cannot create department "${deptName}" — the office is full (max ${MAX_DEPARTMENTS} departments).`);
      dept = { name: cap(deptName), agents: [] };
      raw.departments.push(dept);
    }
    dept.agents = dept.agents ?? [];
    if (!dept.agents.includes(name)) {
      if (dept.agents.length >= MAX_AGENTS_PER_DEPT) throw new Error(`Department "${dept.name}" is full (max ${MAX_AGENTS_PER_DEPT} agents). Pick another or grow a new department.`);
      dept.agents.push(name);
    }

    const displayName = (answers.DISPLAY_NAME ?? name).toUpperCase();
    const aDir = join(cfg.agentsDir, name);
    mkdirSync(join(aDir, 'out'), { recursive: true });
    mkdirSync(join(cfg.inboxDir, name), { recursive: true });

    writeFileSync(join(aDir, 'CLAUDE.md'), OPERATING_RULES(name, displayName, cfg) + instructions.trim() + '\n');
    writeFileSync(join(aDir, 'manifest.yaml'), [
      `name: ${name}`,
      `display_name: ${displayName}`,
      `session: { model: ${model}, effort: ${effort} }`,
      schedule === 'manual'
        ? 'schedule: { triggers: [] }'
        : `schedule: { triggers: [ { type: cron, when: "${schedule}" } ], missed_run: once }`,
      '',
    ].join('\n'));
    writeFileSync(join(aDir, 'memory.md'), `# ${displayName} — memory\n\nWhat this agent has learned. One dated line per learning; humans may prune.\n\n*(nothing yet — hired ${new Date().toISOString().slice(0, 10)})*\n`);
    writeFileSync(cfgFile, JSON.stringify(raw, null, 2) + '\n');

    commitRun(cfg, name, 'hired');

    console.log(`\n✅ ${displayName} hired — folder: ${aDir}`);
    console.log(`   Department: ${dept.name} · model ${model}/${effort} · schedule: ${schedule}`);
    console.log(`   Its CLAUDE.md carries the office rules + your instructions — edit it any time.`);
    console.log(`   Give it work: drop a task file in office/inbox/${name}/, or chat from its desk.`);
    return { name, dir: aDir, department: dept.name };
  } finally {
    rl?.close();
  }
}
