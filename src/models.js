// Agents Office V3.6 — the three models, by name. Shared by the page and the server.
// AJ (9 Sep 2026): "it is either Opus, Sonnet, or Fable. That's it." Sonnet is the default for
// everything, including the routing call. Effort lives inside the name (Opus runs at high); nobody
// sees an effort setting. Four places, one precedence: the task beats the routine beats the agent
// beats the office default.
// V3.6.1 (10 Sep 2026): AJ asked for an EFFORT selection beside the model. Five levels as the CLI
// names them; AUTO (empty) = the model's own default (Opus runs at high). Same four places, same
// precedence as the model, then the model's own.
export const MODELS = {
  sonnet: { key: 'sonnet', name: 'Sonnet', flag: 'sonnet', id: 'claude-sonnet-5' },
  opus:   { key: 'opus',   name: 'Opus',   flag: 'opus',   id: 'claude-opus-5', effort: 'high' },
  fable:  { key: 'fable',  name: 'Fable',  flag: 'fable',  id: 'claude-fable-5-1' },
};
export const MODEL_KEYS = ['sonnet', 'opus', 'fable'];
export const DEFAULT_MODEL = 'sonnet';
export const FROM_TEXT = { task: 'this task', routine: 'this routine', agent: 'this agent', office: 'office default', model: 'the model\'s own' };
export const EFFORT_KEYS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORT_NAME = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high', max: 'Max' };

/** "High" · "xhigh" · "extra high" → the CLI level; empty/auto/unknown → null. */
export function normEffort(s) {
  const t = String(s || '').toLowerCase().replace(/[\s_-]+/g, '').trim();
  if (!t || t === 'auto' || t === 'default') return null;
  if (t === 'extrahigh' || t === 'veryhigh') return 'xhigh';
  if (t === 'maximum') return 'max';
  return EFFORT_KEYS.includes(t) ? t : null;
}
export const effortName = k => EFFORT_NAME[k] || 'Auto';

/** The effort that wins, and where it was set; falls through to the model's own default (may be null = the CLI decides). */
export function effortFor({ task, routine, agent, office, model } = {}) {
  if (normEffort(task)) return { effort: normEffort(task), from: 'task' };
  if (normEffort(routine)) return { effort: normEffort(routine), from: 'routine' };
  if (normEffort(agent)) return { effort: normEffort(agent), from: 'agent' };
  if (normEffort(office)) return { effort: normEffort(office), from: 'office' };
  const m = MODELS[normModel(model)] || MODELS[DEFAULT_MODEL];
  return { effort: m.effort || null, from: 'model' };
}

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

/** The CLI flags for a model key (+ an explicit effort level, else the model's own). */
export function modelArgs(key, effort) {
  const m = MODELS[normModel(key)] || MODELS[DEFAULT_MODEL];
  const a = ['--model', m.flag];
  const e = normEffort(effort) || m.effort;
  if (e) a.push('--effort', e);
  return a;
}
