// Agents Office — configuration (Beta).
// office.config.json is the shipped default; office.config.local.json (gitignored) overrides it;
// environment variables override both: AO_NAME, AO_BRAIN, PORT, AO_MODEL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function loadConfig() {
  const base = readJSON(path.join(ROOT, 'office.config.json'));
  const local = readJSON(path.join(ROOT, 'office.config.local.json'));
  const c = { name: 'Agents Office', brain: './brain', port: 4520, model: '', ...base, ...local };
  if (process.env.AO_NAME) c.name = process.env.AO_NAME;
  if (process.env.AO_BRAIN) c.brain = process.env.AO_BRAIN;
  if (process.env.PORT) c.port = +process.env.PORT;
  if (process.env.AO_MODEL) c.model = process.env.AO_MODEL;
  c.port = +c.port || 4520;
  c.brainPath = path.resolve(ROOT, c.brain);
  return c;
}
