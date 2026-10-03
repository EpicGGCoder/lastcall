/* ============================================================================
   Build the single-file edition: client/ -> single/lastcall.html
   ----------------------------------------------------------------------------
   The folder edition is the source of truth. This script inlines the
   stylesheet and concatenates the ES modules into one module script, in
   dependency order, stripping import/export syntax. It fails loudly on
   duplicate top-level names, because concatenated modules share one scope.

   Icons and manifest become data: URIs so the file is truly portable: it can
   be opened straight off the filesystem, attached to a message, or hosted
   anywhere with zero accompanying files.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const OUT = path.join(ROOT, 'single', 'lastcall.html');

const ORDER = ['math.js', 'meshes.js', 'glkit.js', 'scene.js', 'audio.js', 'net.js', 'ui.js', 'main.js'];

function stripModuleSyntax(src, file) {
  let out = src;
  // import { a, b } from './x.js';   /   import './x.js';
  out = out.replace(/^\s*import\s+[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
  // export { a, b };
  out = out.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  // export class / const / function / let
  out = out.replace(/^export\s+(class|const|let|var|function)\b/gm, '$1');
  return out;
}

function topLevelNames(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const names = [];
  const re = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(clean))) names.push(m[1]);
  return names;
}

function main() {
  const seen = new Map();
  const chunks = [];
  for (const f of ORDER) {
    const raw = fs.readFileSync(path.join(CLIENT, 'js', f), 'utf8');
    for (const n of topLevelNames(raw)) {
      if (seen.has(n)) {
        console.error(`BUILD FAILED: top-level name "${n}" declared in both ${seen.get(n)} and ${f}`);
        process.exit(1);
      }
      seen.set(n, f);
    }
    chunks.push(`/* ---- ${f} ---- */\n` + stripModuleSyntax(raw, f));
  }
  const bundle = chunks.join('\n');

  const css = fs.readFileSync(path.join(CLIENT, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  const favicon = fs.readFileSync(path.join(CLIENT, 'favicon.svg'), 'utf8');
  let manifest = fs.readFileSync(path.join(CLIENT, 'manifest.webmanifest'), 'utf8');
  // The manifest travels as a data: URI, so its icon URLs cannot be relative.
  manifest = manifest.replace(/"\.\/(icon-\d+\.png)"/g, (m, name) => {
    const b64 = fs.readFileSync(path.join(CLIENT, name)).toString('base64');
    return `"data:image/png;base64,${b64}"`;
  });

  const favData = 'data:image/svg+xml,' + encodeURIComponent(favicon.trim());
  const manData = 'data:application/manifest+json,' + encodeURIComponent(manifest.trim());

  let out = html;
  out = out.replace('<link rel="manifest" href="./manifest.webmanifest">', `<link rel="manifest" href="${manData}">`);
  out = out.replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">', `<link rel="icon" href="${favData}" type="image/svg+xml">`);
  out = out.replace('<link rel="apple-touch-icon" href="./favicon.svg">', `<link rel="apple-touch-icon" href="${favData}">`);
  out = out.replace('<link rel="stylesheet" href="./style.css">', `<style>\n${css}\n</style>`);
  out = out.replace('<script type="module" src="./js/main.js"></script>',
    `<script type="module">\n${bundle}\n</script>`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`single/lastcall.html  ${kb} KB  (${ORDER.length} modules inlined)`);

  // sanity: no leftover module syntax or external refs
  const bad = [];
  if (/^\s*import\s/m.test(out)) bad.push('stray import');
  if (/^\s*export\s/m.test(out)) bad.push('stray export');
  if (/src="\.\//.test(out) || /href="\.\//.test(out)) bad.push('relative ref');
  if (bad.length) { console.error('BUILD FAILED:', bad.join(', ')); process.exit(1); }
  console.log('build clean');
}

main();
