// Agents Office — cut a clean public release from this working copy.
//
//   node scripts/release.mjs                 → assembles dist/release/ (inspect it)
//   node scripts/release.mjs --push          → … and pushes `main` + a new tag to the public repo,
//                                              then creates a GitHub pre-release with a zip
//
// The working copy is the private source of truth (NOTES.md, shots, the vault-backed local config).
// The release is a fresh assembly: whitelisted files only, the Brain graph rebuilt from the SAMPLE
// brain (never from a private vault), the release .gitignore, and the ajsahni author identity.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../config.mjs';

const PUBLIC = 'git@github.com:ajsahni/agents-office.git';
const AUTHOR = ['AJ Sahni', '32712407+ajsahni@users.noreply.github.com'];
const BRANCH = 'main'; // the repo page IS the product page
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TAG = 'v' + pkg.version;
const push = process.argv.includes('--push');
const OUT = path.join(ROOT, 'dist', 'release');

const FILES = ['src', 'assets/mcp/tiles', 'assets/mcp/bake.py', 'assets/mcp/rebake.py', 'brain', 'scripts/release.mjs',
  'build.mjs', 'graph-build.mjs', 'serve.mjs', 'config.mjs', 'check.mjs', 'setup', 'package.json', 'package-lock.json',
  'office.config.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'assets/readme-hero.jpg'];

const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`); return r.stdout; };

fs.copyFileSync(path.join(ROOT, 'site', 'assets', 'hero.jpg'), path.join(ROOT, 'assets', 'readme-hero.jpg'));
console.log('→ rebuilding the Brain graph from the SAMPLE brain');
run('node', ['build.mjs'], { cwd: ROOT, env: { ...process.env, AO_BRAIN: './brain' } });

console.log('→ assembling', path.relative(ROOT, OUT));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, f); if (!fs.existsSync(src)) { console.log('  (skip, missing)', f); continue; }
  fs.cpSync(src, path.join(OUT, f), { recursive: true, filter: p => !/(^|\/)(Agents Office|\.DS_Store|node_modules)(\/|$)/.test(p) });
}
fs.copyFileSync(path.join(ROOT, '.gitignore.release'), path.join(OUT, '.gitignore'));
fs.copyFileSync(path.join(ROOT, 'command-centre-v2.html'), path.join(OUT, 'command-centre-v2.html'));
// the shipped braingraph.js must come from the sample brain — guard against a private vault leaking
const bg = fs.readFileSync(path.join(OUT, 'src', 'braingraph.js'), 'utf8');
if (!/MOC-Sales/.test(bg) || /sahni|territool/i.test(bg)) throw new Error('braingraph.js does not look like the sample brain — refusing to release');
console.log('  files:', fs.readdirSync(OUT).join(' '));

if (!push) { console.log(`✓ Release assembled in ${path.relative(ROOT, OUT)}. Add --push to publish ${BRANCH} + ${TAG}.`); process.exit(0); }

console.log('→ cloning the public repo');
const TMP = fs.mkdtempSync('/tmp/agents-office-release-');
run('git', ['clone', '-q', PUBLIC, path.join(TMP, 'pub')]);
const pub = path.join(TMP, 'pub');
run('git', ['config', 'user.name', AUTHOR[0]], { cwd: pub }); run('git', ['config', 'user.email', AUTHOR[1]], { cwd: pub });
const hasBranch = spawnSync('git', ['ls-remote', '--heads', 'origin', BRANCH], { cwd: pub, encoding: 'utf8' }).stdout.trim() !== '';
run('git', hasBranch ? ['checkout', '-q', BRANCH] : ['checkout', '-q', '-b', BRANCH], { cwd: pub });
for (const ent of fs.readdirSync(pub)) if (ent !== '.git') fs.rmSync(path.join(pub, ent), { recursive: true, force: true });
fs.cpSync(OUT, pub, { recursive: true });
run('git', ['add', '-A'], { cwd: pub });
if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: pub }).status === 0) console.log('  public branch already matches — tagging the current commit');
else run('git', ['commit', '-q', '-m', `Agents Office ${TAG}`], { cwd: pub });
// tags are never force-moved (the repo's rules refuse it): bump package.json to cut a new one
const tagged = spawnSync('git', ['ls-remote', '--tags', 'origin', TAG], { cwd: pub, encoding: 'utf8' }).stdout.trim() !== '';
if (!tagged) run('git', ['tag', TAG, '-m', TAG], { cwd: pub });
console.log('→ pushing', BRANCH, tagged ? `(${TAG} already exists)` : TAG);
run('git', ['push', '-q', '-u', 'origin', BRANCH], { cwd: pub });
if (BRANCH === 'main') spawnSync('git', ['push', '-q', 'origin', '--delete', 'beta'], { cwd: pub }); // the beta branch folds into main
if (!tagged) run('git', ['push', '-q', 'origin', TAG], { cwd: pub });
console.log('→ zip + GitHub pre-release');
const zip = path.join(TMP, `agents-office-${TAG}.zip`);
run('zip', ['-qr', zip, '.', '-x', '.git/*'], { cwd: pub });
const notes = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n## ')[1] || TAG;
const rel = spawnSync('gh', ['release', 'view', TAG, '-R', 'ajsahni/agents-office'], { encoding: 'utf8' });
if (rel.status === 0) run('gh', ['release', 'upload', TAG, zip, '--clobber', '-R', 'ajsahni/agents-office']);
else run('gh', ['release', 'create', TAG, zip, '--prerelease', '--title', `Agents Office ${TAG}`, '--notes', '## ' + notes, '--target', BRANCH, '-R', 'ajsahni/agents-office']);
if (rel.status === 0) spawnSync('gh', ['release', 'edit', TAG, '--target', BRANCH, '-R', 'ajsahni/agents-office']);
console.log(`✓ Published ${BRANCH} @ ${TAG} → https://github.com/ajsahni/agents-office/tree/${BRANCH}  ·  https://github.com/ajsahni/agents-office/releases/tag/${TAG}`);
