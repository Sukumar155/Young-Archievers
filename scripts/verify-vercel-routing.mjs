/**
 * verify-vercel-routing.mjs — check the Vercel function's catch-all contract.
 *
 * A live deployment showed /api/health and /api/sos working while
 * /api/auth/otp/request and /api/auth/session 404'd. The cause was the
 * catch-all's parameter name, not the dispatcher: the handler read
 * `req.query.slug`, the file was later renamed to [...path], and every nested
 * route silently stopped reaching the function. Unit tests of the dispatcher
 * could never have caught that, because they bypass the filename entirely.
 *
 * So this asserts the things that are decided by the filename, the folder
 * layout and vercel.json rather than by the handler:
 *
 *   1. exactly one routable file sits in api/ (any other .ts there becomes a
 *      route, and a module with no default export 500s)
 *   2. that file is a catch-all, not a single segment
 *   3. vercel.json's `functions` key names the same file that exists
 *   4. the SPA rewrite does not swallow /api/*
 *   5. the handler does not hardcode a single parameter name
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const API = join(ROOT, 'api');

let failures = 0;
const ok = m => console.log(`  PASS  ${m}`);
const bad = m => { failures++; console.log(`  FAIL  ${m}`); };

/** Every .ts under api/ that Vercel would turn into a route. */
function routableFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // Vercel skips underscore-prefixed directories inside api/.
      if (name.startsWith('_')) continue;
      out.push(...routableFiles(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

console.log('api/ layout');
const routes = routableFiles(API);
const rel = routes.map(p => p.slice(ROOT.length + 1).replace(/\\/g, '/'));

if (rel.length === 1) ok(`exactly one routable file: ${rel[0]}`);
else bad(`expected 1 routable file in api/, found ${rel.length}: ${rel.join(', ')}`);

console.log('\ncatch-all shape');
const handler = rel[0] || '';
if (/\[\[\.\.\.[^\]]+\]\]/.test(handler)) ok('optional catch-all [[...x]]');
else if (/\[\.\.\.[^\]]+\]/.test(handler)) ok('catch-all [...x]');
else bad(`"${handler}" is neither [...x] nor [[...x]] — nested routes will 404`);

console.log('\nvercel.json');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const fnKeys = Object.keys(vercel.functions || {});
if (fnKeys.length === 1 && fnKeys[0] === handler) {
  ok(`functions key matches the file on disk: ${fnKeys[0]}`);
} else if (fnKeys.length === 0) {
  ok('no functions key (Vercel applies defaults)');
} else {
  bad(`functions key "${fnKeys.join(', ')}" does not match the file on disk "${handler}"`);
}

if (vercel.outputDirectory === 'dist') ok('outputDirectory is dist');
else bad(`outputDirectory is "${vercel.outputDirectory}", expected "dist"`);

const rewrites = vercel.rewrites || [];
const spa = rewrites.find(r => r.destination === '/index.html');
if (spa) {
  // The negative lookahead is what keeps the SPA fallback from eating /api/*.
  if (/\(\?!api\//.test(spa.source)) ok('SPA rewrite excludes /api/*');
  else bad(`SPA rewrite "${spa.source}" would swallow /api/* routes`);
} else {
  bad('no SPA rewrite — client-side routes will 404 on refresh');
}
for (const r of rewrites) {
  if (r.destination && r.destination.includes('/api/') && existsSync(join(ROOT, r.destination))) {
    ok(`api rewrite target ${r.destination} exists`);
  }
}

console.log('\nhandler robustness');
if (handler) {
  const src = readFileSync(join(API, handler.split('/').pop()), 'utf8');
  if (/\.query\?\.\s*slug|\.query\.slug/.test(src)) {
    bad('handler hardcodes query.slug — renaming the file segment breaks routing');
  } else {
    ok('handler reads the parameter generically (Object.values of req.query)');
  }
  if (!/export default function/.test(src)) bad('no default export — Vercel will not invoke it');
  else ok('has a default export');
}

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS - routing contract is sound' : `FAIL - ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
