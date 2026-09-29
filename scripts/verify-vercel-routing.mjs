/**
 * verify-vercel-routing.mjs — check the deployed route table against the code.
 *
 * A live deployment showed /api/health and /api/sos working while
 * /api/auth/otp/request and /api/auth/session 404'd. Dispatcher unit tests could
 * not catch that: they bypass Vercel's routing entirely, so every handler looked
 * reachable no matter how the files were laid out.
 *
 * These are the checks that do depend on layout, and they are the ones that fail
 * when a route exists in the code but has no function file behind it:
 *
 *   1. every path the dispatcher matches has a generated function file
 *   2. every generated file is a valid Vercel route (no stray file, no wildcard)
 *   3. the generated files are not stale versus the generator
 *   4. vercel.json's SPA rewrite cannot swallow /api/*
 *   5. nothing but underscore-prefixed helpers sits directly in api/
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const API = join(ROOT, 'api');

let failures = 0;
const ok = m => console.log(`  PASS  ${m}`);
const bad = m => { failures++; console.log(`  FAIL  ${m}`); };

/* ── 1. the dispatcher's routes ─────────────────────────────────────────── */
const server = readFileSync(join(ROOT, 'server', 'sos-server.mjs'), 'utf8');

// Static paths, e.g. `path === '/api/auth/otp/request'`  ->  /api/auth/otp/request
const staticPaths = new Set();
for (const m of server.matchAll(/path === '(\/api\/[^']+)'/g)) {
  staticPaths.add(m[1]);
}

// Parameterised paths, e.g. path.match(/^\/api\/alerts\/([^/]+)$/)
//   -> /api/alerts/:id
// Matched by taking the literal text between `^\/api\/` and `\/([^/]+)$` rather
// than by re-encoding the source regex, which is easy to get subtly wrong.
const paramPaths = new Set();
for (const m of server.matchAll(/path\.match\(\/\^\\\/api\\\/([\w-]+)/g)) {
  // Confirm the tail is the single-id form; a different capture would mean a
  // route shape this check does not understand.
  const after = server.slice(m.index, m.index + 60);
  if (after.includes('([^/]+)$')) paramPaths.add(`/api/${m[1]}/:id`);
}

const wanted = new Set([...staticPaths, ...paramPaths]);
// The root and /api share api/index.ts, so it is satisfied by one file.
const hasRoot = /path === '\/' \|\| path === '\/api'/.test(server);
if (hasRoot) wanted.add('/');

console.log(`dispatcher exposes ${staticPaths.size} static + ${paramPaths.size} parameterised route(s)\n`);

/* ── 2. files on disk ───────────────────────────────────────────────────── */
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

const files = walk(API);
const routable = files.filter(f => !f.split('/').some(seg => seg.startsWith('_')));

console.log('layout');
if (routable.length > 0) ok(`${routable.length} routable function file(s)`);
else bad('no routable function files in api/');

const wildcards = routable.filter(f => f.includes('...'));
if (wildcards.length === 0) {
  ok('no wildcard/catch-all files — nested routes use explicit files');
} else {
  bad(`wildcard file(s) present: ${wildcards.join(', ')} (they deployed as single-segment)`);
}

/* ── 3. every dispatcher route has a file ───────────────────────────────── */
console.log('\nroute coverage');
const fileFor = routePath => {
  // The /api prefix is the api/ directory itself, so it is dropped here.
  //   /api/alerts/:id  -> alerts/[id].ts
  //   /api/health      -> health.ts
  //   /  and  /api     -> index.ts   (the browser view of the bridge)
  if (routePath === '/' || routePath === '/api') return 'index.ts';
  const rest = routePath.replace(/^\/api\/?/, '');
  if (!rest) return 'index.ts';
  const segments = rest.split('/').map(s => (s === ':id' ? '[id]' : s));
  return `${segments.join('/')}.ts`;
};

for (const route of [...wanted].sort()) {
  const file = fileFor(route);
  if (existsSync(join(API, file))) ok(`${route.padEnd(26)} -> api/${file}`);
  else bad(`${route.padEnd(26)} -> api/${file}  MISSING`);
}

/* ── 4. no orphan files ─────────────────────────────────────────────────── */
console.log('\norphans');
const expectedFiles = new Set([...wanted].map(fileFor));
const orphans = routable.filter(f => !expectedFiles.has(f));
if (orphans.length === 0) ok('no orphaned function files');
else bad(`orphaned (no matching route): ${orphans.join(', ')}`);

/* ── 5. vercel.json ─────────────────────────────────────────────────────── */
console.log('\nvercel.json');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
if (vercel.outputDirectory === 'dist') ok('outputDirectory is dist');
else bad(`outputDirectory is "${vercel.outputDirectory}"`);

const spa = (vercel.rewrites || []).find(r => r.destination === '/index.html');
if (!spa) bad('no SPA rewrite — client-side routes 404 on refresh');
else if (/\(\?!api\//.test(spa.source)) ok('SPA rewrite excludes /api/*');
else bad(`SPA rewrite "${spa.source}" would swallow /api/*`);

if (vercel.functions && Object.keys(vercel.functions).length) {
  const keys = Object.keys(vercel.functions);
  const missing = keys.filter(k => !existsSync(join(ROOT, k)));
  if (missing.length === 0) ok(`functions keys all exist: ${keys.join(', ')}`);
  else bad(`functions key names a file that does not exist: ${missing.join(', ')}`);
} else {
  ok('no functions key — per-file config is used instead');
}

/* ── 6. generated files are current ─────────────────────────────────────── */
console.log('\ngenerator');
const { execFileSync } = await import('node:child_process');
try {
  execFileSync(process.execPath, ['scripts/gen-vercel-routes.mjs', '--check'], {
    cwd: ROOT, stdio: 'pipe'
  });
  ok('generated route files match the generator');
} catch (e) {
  bad('generated route files are stale — run: node scripts/gen-vercel-routes.mjs');
}

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS - every dispatcher route is deployed' : `FAIL - ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
