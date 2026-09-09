// Agents Office V3.6 — the three models, by name. Shared by the page and the server.
// AJ (9 Sep 2026): "it is either Opus, Sonnet, or Fable. That's it." Sonnet is the default for
// everything, including the routing call. Effort lives inside the name (Opus runs at high); nobody
// sees an effort setting. Four places, one precedence: the task beats the routine beats the agent
// beats the office default.
export const MODELS = {
  sonnet: { key: 'sonnet', name: 'Sonnet', flag: 'sonnet', id: 'claude-sonnet-5' },
  opus:   { key: 'opus',   name: 'Opus',   flag: 'opus',   id: 'claude-opus-5', effort: 'high' },
  fable:  { key: 'fable',  name: 'Fable',  flag: 'fable',  id: 'claude-fable-5-1' },
};
export const MODEL_KEYS = ['sonnet', 'opus', 'fable'];
export const DEFAULT_MODEL = 'sonnet';
export const FROM_TEXT = { task: 'this task', routine: 'this routine', agent: 'this agent', office: 'office default' };

/** "opus" · "Opus" · "claude-opus-5" → "opus"; anything else → null. */
export function normModel(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return null;
  for (const k of MODEL_KEYS) if (t === k || t.includes(k)) return k;
  return null;
}
export const modelName = k => (MODELS[k] || MODELS[DEFAULT_MODEL]).name;
export const modelId = k => (MODELS[k] || MODELS[DEFAULT_MODEL]).id;

/** The one that wins, and where it was set. Each argument is a model key or empty. */
export function modelFor({ task, routine, agent, office } = {}) {
  if (normModel(task)) return { model: normModel(task), from: 'task' };
  if (normModel(routine)) return { model: normModel(routine), from: 'routine' };
  if (normModel(agent)) return { model: normModel(agent), from: 'agent' };
  return { model: normModel(office) || DEFAULT_MODEL, from: 'office' };
}

/** The CLI flags for a model key. */
export function modelArgs(key) {
  const m = MODELS[normModel(key)] || MODELS[DEFAULT_MODEL];
  const a = ['--model', m.flag];
  if (m.effort) a.push('--effort', m.effort);
  return a;
}
