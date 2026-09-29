/**
 * verify-vercel-routing.mjs — check the deployment wiring without deploying.
 *
 * Two deployments were measured live before this landed, and both failed in
 * ways no dispatcher unit test could see:
 *
 *   api/[[...slug]].ts    /api/health worked, /api/auth/otp/status 404'd
 *   api/[...path].ts      identical
 *   api/<dir>/<route>.ts  top-level files deployed, subdirectory files did not
 *
 * So the checks here are about the wiring, not the handlers: the rewrite must
 * cover every route, it must not shadow the SPA, the function must sit where
 * Vercel will actually pick it up, and the path it reconstructs has to match
 * what the dispatcher matches on.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const API = join(ROOT, 'api');

let failures = 0;
const ok = m => console.log(`  PASS  ${m}`);
const bad = m => { failures++; console.log(`  FAIL  ${m}`); };

/* ── 1. routes the dispatcher exposes ───────────────────────────────────── */
const server = readFileSync(join(ROOT, 'server', 'sos-server.mjs'), 'utf8');

const staticPaths = new Set();
for (const m of server.matchAll(/path === '(\/api\/[^']+)'/g)) staticPaths.add(m[1]);

const paramPaths = new Set();
for (const m of server.matchAll(/path\.match\(\/\^\\\/api\\\/([\w-]+)/g)) {
  const after = server.slice(m.index, m.index + 60);
  if (after.includes('([^/]+)$')) paramPaths.add(`/api/${m[1]}/:id`);
}

// `/` and `/api` are served by api/index.ts rather than the rewritten function.
const indexPaths = new Set();
for (const m of server.matchAll(/path === '(\/[^']*)'/g)) {
  if (m[1] === '/' ) indexPaths.add(m[1]);
}
if (/path === '\/' \|\| path === '\/api'/.test(server)) indexPaths.add('/api');

const routed = new Set([...staticPaths, ...paramPaths]);
console.log(`dispatcher: ${staticPaths.size} static, ${paramPaths.size} parameterised, `
          + `${indexPaths.size} index-served\n`);

/* ── 2. api/ layout ─────────────────────────────────────────────────────── */
console.log('api/ layout');

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const rel = base ? `${base}/${name}` : name;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { out.push(...walk(p, rel)); continue; }
    if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

const all = walk(API);
const routable = all.filter(f => !f.split('/').some(s => s.startsWith('_')));
const nested = routable.filter(f => f.includes('/'));

if (nested.length === 0) {
  ok('no function files in subdirectories — only the top level deployed reliably');
} else {
  bad(`function file(s) in subdirectories did not deploy: ${nested.join(', ')}`);
}

if (routable.includes('nexora.ts')) ok('api/nexora.ts is the rewritten function');
else bad('api/nexora.ts missing');

/* ── 3. the rewrite ─────────────────────────────────────────────────────── */
console.log('\nvercel.json');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const rewrites = vercel.rewrites || [];

const apiRewrite = rewrites.find(r => r.destination && r.destination.includes('/api/nexora'));
if (apiRewrite) {
  ok(`rewrite: ${apiRewrite.source}  ->  ${apiRewrite.destination}`);
  if (/\$[1-9]/.test(apiRewrite.destination)) ok('rewrite forwards the path via $1');
  else bad(`rewrite destination "${apiRewrite.destination}" does not forward the path`);
} else {
  bad('no rewrite mapping /api/* to the function — every API route would 404');
}

const spa = rewrites.find(r => r.destination === '/index.html');
if (!spa) bad('no SPA rewrite — client-side routes 404 on refresh');
else if (/\(\?!api\//.test(spa.source)) ok('SPA rewrite excludes /api/*');
else bad(`SPA rewrite "${spa.source}" would swallow /api/*`);

// Order matters: the API rewrite has to be tried before the SPA fallback.
if (apiRewrite && spa) {
  const iApi = rewrites.indexOf(apiRewrite);
  const iSpa = rewrites.indexOf(spa);
  if (iApi < iSpa) ok('API rewrite is listed before the SPA fallback');
  else bad('SPA fallback is listed before the API rewrite and will shadow it');
}

if (vercel.outputDirectory === 'dist') ok('outputDirectory is dist');
else bad(`outputDirectory is "${vercel.outputDirectory}"`);

/* ── 4. simulate the rewrite against the dispatcher ─────────────────────── */
console.log('\nrewrite simulation');
const src = readFileSync(join(API, 'nexora.ts'), 'utf8');
const rx = apiRewrite?.source
  ? new RegExp('^' + apiRewrite.source.replace(/^\\\//, '^\\/').replace(/\\\/\(\.\*\)$/, '/(.*)') + '$')
  : null;

if (!rx) {
  bad('could not compile the rewrite source for simulation');
} else {
  // `/` and `/api` deliberately do not match: the SPA owns `/`, and `/api` is
  // served by api/index.ts. Only the rewritten routes are asserted here.
  let matched = 0;
  for (const route of routed) {
    if (!rx.test(route)) { bad(`rewrite does not match ${route}`); continue; }
    matched++;
  }
  if (matched === routed.size) ok(`rewrite matches all ${matched} rewritten route(s)`);

  for (const route of indexPaths) {
    if (rx.test(route)) bad(`rewrite shadows ${route}, which api/index.ts should serve`);
  }
  if (indexPaths.size) ok(`api/index.ts serves ${[...indexPaths].join(', ')} (not rewritten)`);

  // The handler must rebuild "/api/<captured>" — the exact form the dispatcher
  // compares against with `path === '/api/...'`.
  if (/\/api\/\$\{value/.test(src) || /`\/api\/\$\{/.test(src)) {
    ok('handler rebuilds /api/<p> from the query parameter');
  } else {
    bad('handler does not appear to rebuild /api/<p> — the dispatcher would 404');
  }
}

/* ── 5. index.ts covers the root view ───────────────────────────────────── */
console.log('\nindex route');
if (existsSync(join(API, 'index.ts'))) ok('api/index.ts exists for /api');
else bad('api/index.ts missing — /api would 404');

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS - deployment wiring is sound' : `FAIL - ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
