/**
 * verify-served.mjs — check the CSS the DEV SERVER actually serves.
 *
 * Verifying `dist/` only proves the production build is right. The dev server
 * compiles CSS on the fly through a different code path (the Vite plugin in
 * serve mode), and that is what the browser loads at
 * http://localhost:5173. A defect that survives only in dev would be invisible
 * to every other check here.
 *
 * This fetches the served stylesheet and asserts the same invariants:
 *   · the dark token block is present
 *   · the dark canvas/ink rules exist
 *   · the light component ramps are not scoped to a dark selector
 */
const CSS_URLS = [
  'http://localhost:5173/src/index.css',
  'http://localhost:5173/src/design-system/tokens.css',
];

let bad = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { bad += 1; console.log(`  FAIL  ${m}`); };

let served = '';
for (const url of CSS_URLS) {
  try {
    const res = await fetch(url, { headers: { Accept: 'text/css' } });
    const body = await res.text();
    console.log(`  fetched ${url}  ${res.status}  ${body.length} bytes`);
    if (body.includes('--nx-canvas')) served += body;
  } catch (e) {
    console.log(`  could not fetch ${url}: ${e.message}`);
  }
}

if (!served) {
  console.log('\ncould not read any served CSS — is the dev server running?');
  process.exit(1);
}

const low = served.toLowerCase();
console.log('');

/* The dev server does NOT minify, so declarations are written `--name: value`
   with a space, while the production bundle is written `--name:value`. Matching
   a fixed string therefore only ever matches one of the two. Whitespace is
   normalised away first so both are covered. */
const flat = low.replace(/\s*:\s*/g, ':').replace(/\s+/g, '');

for (const [needle, label] of [
  ['--nx-canvas:#212121', 'dark canvas token'],
  ['--color-text-primary:#fff', 'dark text-primary token'],
  ['--color-text-secondary:#e0e0e0', 'dark text-secondary token'],
  ['--color-surface:#2f2f2f', 'dark surface token'],
  ['--color-border:#3d3d3d', 'dark border token'],
  ['--nx-canvas:#f8f8f7', 'light canvas token (must not regress)'],
]) {
  if (flat.includes(needle)) pass(`${label} served (${needle})`);
  else fail(`${label} NOT served (${needle})`);
}

/* Split into individual rules and inspect the SELECTOR of each one carrying a
   component ramp. Comments are removed FIRST — the explanatory comment above
   the COMPONENT RAMPS block names `[data-theme="dark"]` in prose, and matching
   it reads as a leak that does not exist.
   Rules are also split on `}` rather than matched with one big regex, because
   `[^{}]*` can otherwise span the whole sheet. */
const rules = served.replace(/\/\*[\s\S]*?\*\//g, ' ').split('}');
let leaked = null;
for (const rule of rules) {
  if (!/--color-line:\s*#e4e4e0/i.test(rule)) continue;
  const brace = rule.indexOf('{');
  if (brace < 0) continue;
  const sel = rule.slice(0, brace).trim();
  if (/\[data-theme=["']?dark["']?\]|(^|[\s,])\.dark([\s,{]|$)/i.test(sel)) {
    leaked = sel.slice(0, 100);
    break;
  }
}
if (leaked) fail(`light component ramp is scoped to a dark selector: ${leaked}`);
else pass('light component ramps are not scoped to dark selectors');

console.log(bad === 0 ? '\nserved CSS verified' : `\n${bad} problem(s)`);
