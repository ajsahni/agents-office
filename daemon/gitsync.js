import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './events.js';

// Journal-commit gitsync for the (optional) brain. Only active when the
// configured brain folder is itself a git repo; a plain folder is left alone.

function git(cfg, args, opts = {}) {
  return execFileSync('git', args, { cwd: cfg.brainDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

const isRepo = (cfg) => !!cfg.brainDir && existsSync(join(cfg.brainDir, '.git'));
const hasRemote = (cfg) => { try { return git(cfg, ['remote']).includes('origin'); } catch { return false; } };

// --autostash: humans edit the brain mid-run; their uncommitted work must survive a pull.
export function pullBrain(cfg, agent) {
  if (!isRepo(cfg) || !hasRemote(cfg)) return;
  try {
    git(cfg, ['pull', '--rebase', '--autostash', '--quiet']);
  } catch (err) {
    emit(cfg, agent, { type: 'warn', icon: '⚠️', text: `Brain pull failed (working offline this run): ${firstLine(err)}` });
  }
}

// One commit per agent-run, journal-style message. Push with rebase-retry ×3;
// still failing → park on a conflict branch, tell the owner, never force-push,
// never lose work.
export function commitRun(cfg, agent, summaryText) {
  if (!isRepo(cfg)) return;
  try {
    git(cfg, ['add', '-A']);
    try { git(cfg, ['diff', '--cached', '--quiet']); return; } catch { /* something staged — commit it */ }
    git(cfg, ['commit', '--quiet', '-m', `office(${agent}): ${summaryText}`]);
    if (!hasRemote(cfg)) return;
    for (let i = 0; i < 3; i++) {
      try { git(cfg, ['push', '--quiet']); return; }
      catch {
        try { git(cfg, ['pull', '--rebase', '--autostash', '--quiet']); }
        catch {
          try { git(cfg, ['rebase', '--abort']); } catch { /* not mid-rebase */ }
          break; // true conflict — park it
        }
      }
    }
    // Park this run's commit on a branch, then walk the main branch back to origin
    // so the office keeps working. Uncommitted human edits are stashed across the
    // reset and restored.
    const branch = `office/conflict-${agent}-${new Date().toISOString().slice(0, 10)}`;
    git(cfg, ['branch', '-f', branch]);
    try { git(cfg, ['push', '--quiet', '-u', 'origin', branch]); } catch { /* parked locally; still safe */ }
    try {
      const head = git(cfg, ['rev-parse', '--abbrev-ref', 'HEAD']);
      let stashed = false;
      try { stashed = /^(stash|Saved)/m.test(git(cfg, ['stash', 'push', '--include-untracked', '-m', 'office-conflict-guard'])); } catch {}
      git(cfg, ['reset', '--hard', `origin/${head}`]);
      if (stashed) { try { git(cfg, ['stash', 'pop']); } catch { emit(cfg, agent, { type: 'warn', icon: '⚠️', text: 'Human edits are held in git stash (pop conflicted) — recover with `git stash pop` in the brain folder.' }); } }
    } catch { /* leave the brain as-is; the warn below still fires */ }
    emit(cfg, agent, { type: 'warn', icon: '⚠️', text: `Brain push conflicted — this run's commit is parked on branch ${branch}. Nothing lost; needs a human look (compare with main, merge what you want).` });
  } catch (err) {
    emit(cfg, agent, { type: 'warn', icon: '⚠️', text: `Brain commit failed: ${firstLine(err)}` });
  }
}

const firstLine = (err) => (err.stderr?.toString() || err.message || String(err)).split('\n').find(Boolean) ?? 'unknown git error';
