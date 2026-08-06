import { join, resolve, dirname, isAbsolute } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Everything lives inside the clone: office.config.json at the repo root,
// user data under office/ (gitignored so `git pull` never collides with it).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MAX_DEPARTMENTS = 6;
export const MAX_AGENTS_PER_DEPT = 4;

// Nominal palette — six department slots, auto-assigned by config order.
// Users don't pick colours.
export const PALETTE = [
  { chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' }, // mint
  { chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' }, // butter
  { chip: '#E69393', ink: '#C46060', floor: '#FAE9E7' }, // coral
  { chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' }, // periwinkle
  { chip: '#8FD8E8', ink: '#2E8CA3', floor: '#E7F4F8' }, // sky
  { chip: '#E0A9D4', ink: '#A85493', floor: '#F8EAF4' }, // orchid
];
export const BRAIN_COLOURS = { chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' };

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function configPath(rootDir = ROOT) {
  return join(rootDir, 'office.config.json');
}

const hired = (cfg, a) => existsSync(join(cfg.agentsDir, a, 'manifest.yaml'));

export function loadConfig() {
  const rootDir = process.env.OFFICE_ROOT ? resolve(process.env.OFFICE_ROOT) : ROOT;
  const warnings = [];
  let raw = {};
  const file = configPath(rootDir);
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch (err) { throw new Error(`office.config.json is not valid JSON: ${err.message}`); }
  } else {
    warnings.push(`No office.config.json at ${file} — booting with an empty office (copy office.config.example.json to get started).`);
  }

  const cfg = {
    rootDir,
    uiDir: join(ROOT, 'ui'),
    port: Number(process.env.OFFICE_PORT ?? raw.port ?? 4477),
    globalConcurrency: raw.globalConcurrency ?? 2,
    warnings,
  };

  // Brain is OPTIONAL: null → no Brain pod, no brain reads, no gitsync.
  cfg.brainDir = raw.brain
    ? (isAbsolute(raw.brain) ? raw.brain : resolve(rootDir, raw.brain))
    : null;
  if (cfg.brainDir && !existsSync(cfg.brainDir)) {
    warnings.push(`Configured brain folder does not exist: ${cfg.brainDir} — Brain disabled this boot.`);
    cfg.brainDir = null;
  }

  cfg.officeDir = join(rootDir, 'office');
  cfg.agentsDir = join(cfg.officeDir, 'agents');
  cfg.inboxDir = join(cfg.officeDir, 'inbox');
  cfg.stateDir = join(cfg.officeDir, 'state');
  cfg.logsDir = join(cfg.officeDir, 'logs');
  cfg.pauseFlag = join(cfg.stateDir, 'paused');

  const depts = Array.isArray(raw.departments) ? raw.departments : [];
  if (depts.length > MAX_DEPARTMENTS) {
    throw new Error(`office.config.json: max ${MAX_DEPARTMENTS} departments (you have ${depts.length}).`);
  }
  const seen = new Set();
  cfg.departments = depts.map((d, i) => {
    const name = String(d.name ?? `Department ${i + 1}`);
    let key = slug(name) || `dept-${i + 1}`;
    while (seen.has(key)) key += '2';
    seen.add(key);
    const agents = (Array.isArray(d.agents) ? d.agents : []).map(String);
    if (agents.length > MAX_AGENTS_PER_DEPT) {
      throw new Error(`office.config.json: department "${name}" lists ${agents.length} agents — max ${MAX_AGENTS_PER_DEPT}.`);
    }
    return { key, name, colours: PALETTE[i % PALETTE.length], agents };
  });

  // Unknown/missing agents are a vacant desk + a warning, never a crash.
  const assigned = new Set();
  for (const d of cfg.departments) {
    for (const a of d.agents) {
      assigned.add(a);
      if (!hired(cfg, a)) {
        warnings.push(`Agent "${a}" (department "${d.name}") has no folder at office/agents/${a}/ — rendering a vacant desk. Hire it with: office new-agent NAME=${a}`);
      }
    }
  }
  if (existsSync(cfg.agentsDir)) {
    const folders = readdirSync(cfg.agentsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && hired(cfg, e.name))
      .map((e) => e.name);
    for (const a of folders) {
      if (!assigned.has(a)) warnings.push(`Agent folder office/agents/${a}/ is not assigned to any department in office.config.json — it can run, but has no desk in the office.`);
    }
  }
  return cfg;
}

// Which department (if any) a hired agent sits in.
export function deptOf(cfg, agent) {
  return cfg.departments.find((d) => d.agents.includes(agent)) ?? null;
}
