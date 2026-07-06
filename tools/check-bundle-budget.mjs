import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = 'dist';
const ENTRY_GZIP_LIMIT_BYTES = 200 * 1024;

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function assetPathFromHtmlRef(ref) {
  return ref.startsWith('/') ? ref.slice(1) : ref;
}

async function fileSize(filePath) {
  return (await stat(filePath)).size;
}

async function gzipSize(filePath) {
  return gzipSync(await readFile(filePath)).length;
}

const htmlPath = path.join(DIST_DIR, 'index.html');
const html = await readFile(htmlPath, 'utf8');

const scriptRefs = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map((match) =>
  assetPathFromHtmlRef(match[1]),
);
const stylesheetRefs = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((match) =>
  assetPathFromHtmlRef(match[1]),
);
const wasmRefs = [...html.matchAll(/\b(?:src|href)="([^"]+\.wasm)"/g)].map((match) => match[1]);

if (scriptRefs.length === 0) {
  throw new Error('Bundle budget check failed: no module entry script found in dist/index.html');
}

if (wasmRefs.length > 0) {
  throw new Error(`Bundle budget check failed: entry HTML references WASM directly: ${wasmRefs.join(', ')}`);
}

const entryRefs = [...scriptRefs, ...stylesheetRefs];
let totalGzip = 0;

for (const ref of entryRefs) {
  const assetPath = path.join(DIST_DIR, ref);
  totalGzip += await gzipSize(assetPath);
}

if (totalGzip > ENTRY_GZIP_LIMIT_BYTES) {
  throw new Error(
    `Bundle budget check failed: entry assets are ${formatKiB(totalGzip)} gzipped; limit is ${formatKiB(
      ENTRY_GZIP_LIMIT_BYTES,
    )}`,
  );
}

const assetNames = await readdir(path.join(DIST_DIR, 'assets'));
const entryScriptSet = new Set(scriptRefs.map((ref) => path.basename(ref)));
const entryScripts = await Promise.all(
  [...entryScriptSet].map(async (name) => ({
    name,
    raw: await fileSize(path.join(DIST_DIR, 'assets', name)),
    gzip: await gzipSize(path.join(DIST_DIR, 'assets', name)),
  })),
);
const lazyScripts = assetNames.filter((name) => name.endsWith('.js') && !entryScriptSet.has(name));

console.log(
  `Bundle budget OK: entry assets ${formatKiB(totalGzip)} gzipped <= ${formatKiB(ENTRY_GZIP_LIMIT_BYTES)}`,
);
for (const entry of entryScripts) {
  console.log(`  entry ${entry.name}: ${formatKiB(entry.raw)} raw, ${formatKiB(entry.gzip)} gzip`);
}
if (lazyScripts.length > 0) {
  console.log(`  lazy chunks: ${lazyScripts.join(', ')}`);
}
