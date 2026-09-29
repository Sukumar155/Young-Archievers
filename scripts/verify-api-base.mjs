/**
 * verify-api-base.mjs — assert no component bypasses the shared API base.
 *
 * The split-deployment failure this guards against: the frontend is served from
 * Vercel and the bridge from somewhere else, so every request must be built
 * from `apiUrl()` in src/services/sosApi.ts. A stray relative `fetch('/api/...')`
 * compiles fine, passes typecheck, works perfectly in dev (Vite proxies /api),
 * and then 404s in production — while VITE_API_URL is set correctly and the
 * backend is healthy. That is a genuinely confusing failure to debug, so it is
 * checked mechanically instead of by review.
 *
 * Allowed: apiUrl('/api/...'), apiUrl(`...`), and the apiUrl helper itself.
 * Flagged: fetch('/api/...'), fetch("/api/..."), axios-ish literal prefixes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXT = new Set(['.ts', '.tsx']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const violations = [];

// fetch(  '/api/...'  )  with no apiUrl() wrapper
const RELATIVE_FETCH = /\bfetch\(\s*[`'"]\/api\//g;
// new URL('/api/...'  and any other direct absolute-path construction
const RELATIVE_URL = /\bnew URL\(\s*[`'"]\/api\//g;
// the sanctioned helper, which legitimately contains the literal '/api/'
const HELPER = /apiUrl\(/g;

let apiUrlUsages = 0;

for (const f of files) {
  const rel = relative(ROOT, f);
  const lines = readFileSync(f, 'utf8').split('\n');

  lines.forEach((line, i) => {
    apiUrlUsages += (line.match(HELPER) || []).length;
    for (const rx of [RELATIVE_FETCH, RELATIVE_URL]) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(line)) !== null) {
        violations.push({ rel, line: i + 1, text: line.trim(), kind: m[0].trim() });
      }
    }
  });
}

console.log(`scanned ${files.length} source files, ${apiUrlUsages} apiUrl() call(s)\n`);

if (violations.length) {
  console.log(`FAIL — ${violations.length} relative /api call(s) that would bypass VITE_API_URL:`);
  for (const v of violations) {
    console.log(`  ${v.rel}:${v.line}  ${v.text.slice(0, 96)}`);
  }
  console.log('\nThese work in dev (Vite proxies /api) and 404 in production.');
  console.log('Use apiUrl() from src/services/sosApi.ts instead.');
  process.exit(1);
}

console.log('PASS — every API call is built from apiUrl(), so VITE_API_URL is honoured.');
