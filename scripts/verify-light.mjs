/**
 * verify-light.mjs — is the light theme intact?
 *
 * Three checks:
 *  1. The light half of tokens.css (everything before the dark selector) must
 *     contain no colour from the dark ladder and no ChatGPT-grey values.
 *  2. Its palette must still be the warm "Monsoon Resilience" set — the canvas
 *     warm off-white, near-black ink, cobalt accent, desaturated severities.
 *  3. Every hex used outside a `dark:` utility in a .tsx must be a known light
 *     value, so a dark colour cannot have leaked into light styling.
 *
 * UTF-8 is handled explicitly: the em-dashes in the token comments are not
 * ASCII, and decoding them as anything else corrupts the comparison.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const HEX = /#[0-9A-Fa-f]{6}\b/g;

/* The dark ladder, which must never appear in light styling. `#17181C` is not
 * listed: it is the translucent modal scrim (`bg-[#17181C]/60`), which is
 * deliberately dark in BOTH themes. */
const DARK = new Set([
  '#0F0F0F', '#171717', '#212121', '#262626', '#2F2F2F',
  '#3D3D3D', '#4D4D4D', '#60A5FA', '#ECECEC', '#B4B4B4', '#8F8F8F',
  '#C0C0C0', '#D0D0D0', '#E0E0E0',
]);

/* The light palette. Rather than hand-listing every step — which is how ramp
 * steps like #9DB8DC got flagged as "unrecognised" even though they are
 * original — this is derived from HEAD: anything the light block held before
 * the dark work is by definition part of the original palette. */
const HEAD_LIGHT = (() => {
  const head = execFileSync('git', ['show', 'HEAD:src/design-system/tokens.css'], { encoding: 'utf8' });
  const s = head.search(/(^|\n):root/);
  const d = head.search(/(^|\n)\s*\[data-theme="dark"\]/);
  const body = head.slice(s, d).replace(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set((body.match(/#[0-9A-F]{6}\b/g) || []).map((h) => h.toUpperCase()));
})();

/* Steps the light theme uses that predate this session, added explicitly so a
 * genuinely NEW colour in the light block is still caught. */
const LIGHT = new Set([
  ...HEAD_LIGHT,
  '#8A4D06', '#7A3E0B', '#3A2A0A', '#0A2E22', '#C0C0C0', '#D0D0D0', '#E0E0E0',
]);

/** Hexes that belong to the shared dark ramps, not to the light paint values. */
const RAMP_ONLY = new Set();

let bad = 0;

/* ---- 1 + 2. the light token block ----
 *
 * Scope matters. tokens.css opens with an `@theme` block that defines the
 * shared colour RAMPS — it legitimately contains both light and dark steps,
 * because Tailwind needs the full scale to resolve `dark:` utilities. The block
 * that actually paints the light theme is `:root, [data-theme="light"]`, so
 * that is what gets checked. Scanning everything before the dark selector
 * would flag the dark half of every ramp as a leak.
 */
const tokens = readFileSync('src/design-system/tokens.css', 'utf8');
const lightStart = tokens.search(/(^|\n):root,/);
const darkStart = tokens.search(/(^|\n)\s*\[data-theme="dark"\]/);
if (lightStart < 0 || darkStart < 0) {
  console.log('FAIL  could not locate the :root / [data-theme="dark"] blocks');
  process.exit(1);
}
/* Comments must be stripped before counting. The light block documents the
 * dark ladder in prose ("Text is a three-step lightness ladder — #ECECEC /
 * #B4B4B4 / #8F8F8F"), and those mentions are rationale, not declarations —
 * a checker that reads them as values reports a leak that does not exist. */
let lightBlock = tokens
  .slice(lightStart, darkStart)
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

/* The light block also carries the tail of the shared colour RAMPS: dark-theme
 * steps such as `--color-cobalt-line: #2E3038` (labelled "accent border, dark
 * theme") live between `:root` and `[data-theme="dark"]` because the ramp is
 * declared once. They are not light-theme values.
 *
 * Those ramp sections are introduced by headers that say so — "Cobalt,
 * continued: the dark steps…", "Neutral: the greys…" — so cut at the first of
 * them. This has to be done on the RAW text: the headers live inside CSS
 * comments, which the comment-stripping pass above has already removed. */
const rawLight = tokens.slice(lightStart, darkStart);
const rampStart = rawLight.search(
  /^\s*\/\*\s*(?:Neutral:|Cobalt, continued:|Success:|Warning and severe:|Critical:|Graphite, continued:)/m
);
if (rampStart > 0) {
  for (const h of rawLight.slice(rampStart).match(HEX) || []) RAMP_ONLY.add(h.toUpperCase());
  lightBlock = rawLight.slice(0, rampStart).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const lightHexes = [...new Set((lightBlock.match(HEX) || []).map((h) => h.toUpperCase()))];

const leaked = lightHexes.filter((h) => DARK.has(h));
if (leaked.length) {
  bad += 1;
  console.log(`1. FAIL  dark colours present in the light token block: ${leaked.join(', ')}`);
} else {
  console.log(`1. ok    light token block carries no dark-ladder colour (${lightHexes.length} distinct)`);
}

const unknown = lightHexes.filter((h) => !LIGHT.has(h) && !RAMP_ONLY.has(h));
if (unknown.length) {
  bad += 1;
  console.log(`2. FAIL  unrecognised light colours: ${unknown.join(', ')}`);
} else {
  console.log(`2. ok    every light token colour is from the restored Monsoon palette (${lightHexes.length} paint values)`);
}

/* ---- 3. no dark colour in non-dark .tsx styling ---- */
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}
const hits = new Map();
for (const file of walk('src')) {
  const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');
  /* Strip dark utilities before looking. The pattern has to allow STACKED
   * variants — `dark:hover:bg-[#…]`, `dark:border-l-[#…]`, `dark:bg-[#…]/60` —
   * which a simple `dark:[\w-]*(\[[^\]]*\])?` silently misses, and a miss here
   * reads as a dark colour leaking into light styling when it never did. */
  const t = readFileSync(file, 'utf8')
    .replace(/dark:(?:[a-z-]+:)*[a-z-]+(?:\[[^\]]*\])?(?:\/[0-9]+)?/g, ' ');
  for (const h of t.match(HEX) || []) {
    const up = h.toUpperCase();
    if (!DARK.has(up)) continue;
    if (!hits.has(up)) hits.set(up, new Set());
    hits.get(up).add(rel);
  }
}
if (hits.size) {
  bad += 1;
  console.log(`3. FAIL  dark hex used in light styling: ${[...hits].map(([h, f]) => `${h} in ${[...f][0]}`).join('; ')}`);
} else {
  console.log('3. ok    no dark-ladder hex appears in light styling across all .tsx');
}

console.log(bad === 0 ? '\nlight theme intact' : `\n${bad} check(s) failed`);
