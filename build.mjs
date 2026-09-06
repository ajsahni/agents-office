// Bundle src/main.js (+three) into a single self-contained HTML that opens by double-click.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { buildBrainGraph } from './graph-build.mjs';
await buildBrainGraph(); // V3.6: bake the vault's wiki-link graph into src/braingraph.js

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
});
const js = res.outputFiles[0].text;
const shell = readFileSync('src/shell.html', 'utf8');
const html = shell.replace('<!--APP-->', () => `<script>${js}</script>`);
writeFileSync('command-centre-v2.html', html);
writeFileSync('command-centre-v2-dark.html', html.replace('<body>', '<body class="dark">')); // the dark twin

// dev variant with external script for faster iteration
mkdirSync('dist', { recursive: true });
writeFileSync('dist/app.js', js);
writeFileSync('dist/dev.html', shell.replace('<!--APP-->', '<script src="app.js"></script>'));
console.log(`built command-centre-v2.html + command-centre-v2-dark.html (${(html.length / 1024).toFixed(0)} KB)`);
