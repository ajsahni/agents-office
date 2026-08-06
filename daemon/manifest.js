import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

// Short names in manifest.yaml; the CLI resolves aliases to concrete models.
export const MODELS = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' };

// SDK v0.1.x exposes thinking budget, not a literal effort knob — map one to the other.
export const EFFORT_THINKING_TOKENS = { low: 1024, medium: 8192, high: 32000 };

export function agentDir(cfg, agent) {
  return join(cfg.agentsDir, agent);
}

export function loadManifest(cfg, agent) {
  const file = join(agentDir(cfg, agent), 'manifest.yaml');
  if (!existsSync(file)) throw new Error(`No manifest.yaml for agent "${agent}" (looked in ${file})`);
  const m = YAML.parse(readFileSync(file, 'utf8'));
  const session = m.session ?? {};
  m.session = {
    model: MODELS[session.model] ?? session.model ?? 'sonnet',
    effort: session.effort ?? 'medium',
  };
  m.schedule = m.schedule ?? { triggers: [] };
  m.display_name = m.display_name ?? String(m.name ?? agent).toUpperCase();
  return m;
}

export function listAgents(cfg) {
  if (!existsSync(cfg.agentsDir)) return [];
  return readdirSync(cfg.agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(cfg.agentsDir, d.name, 'manifest.yaml')))
    .map((d) => d.name);
}
