/**
 * all-white-dark.mjs — every dark-mode text becomes white / off-white.
 *
 * The dark theme still had ten text colours, five of them semantic hues
 * (#F87171 danger, #FBBF24 warning, #34D399 success, #93C5FD accent and
 * friends). Anything that is not white is remapped onto the white ladder.
 *
 * The step is chosen by the ORIGINAL colour's luminance, so the subtle
 * hierarchy that already exists survives — a label that was muted stays a step
 * below a heading, it just stops being coloured.
 *
 *     #FFFFFF  255 -> #FFFFFF      strongest
 *     #FCD34D  210 -> #E0E0E0
 *     #6EE7B7  202 -> #E0E0E0
 *     #FBBF24  193 -> #D0D0D0
 *     #93C5FD  190 -> #D0D0D0
 *     #FCA5A5  183 -> #D0D0D0
 *     #34D399  173 -> #D0D0D0
 *     #F87171  142 -> #C0C0C0      weakest, but still 7.4:1 on a card
 *
 * Only `dark:text-` / `dark:placeholder-` utilities and the two dark accent-text
 * CSS overrides are touched. Borders, fills, badges and map geometry keep
 * their colour, so a CRITICAL badge is still obviously a CRITICAL badge — it
 * just has white text in it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const M = {
  '#FFFFFF': '#FFFFFF',
  '#E0E0E0': '#E0E0E0',
  '#D0D0D0': '#D0D0D0',
  '#C0C0C0': '#C0C0C0',
  '#FCD34D': '#E0E0E0',
  '#6EE7B7': '#E0E0E0',
  '#FBBF24': '#D0D0D0',
  '#93C5FD': '#D0D0D0',
  '#FCA5A5': '#D0D0D0',
  '#34D399': '#D0D0D0',
  '#F87171': '#C0C0C0',
};

const ENTRIES = Object.entries(M).sort((a, b) => b[0].length - a[0].length);
const DARK_TEXT = /dark:(text|placeholder)-\[#([0-9A-Fa-f]{6})\]/g;

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(n)) acc.push(p);
  }
  return acc;
}

let files = 0, utils = 0;
const touched = new Map();

for (const file of walk('src')) {
  const before = readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(DARK_TEXT, (whole, prop, hex) => {
    const key = `#${hex.toUpperCase()}`;
    const to = M[key];
    if (!to) return whole;
    count += 1;
    touched.set(key, (touched.get(key) || 0) + 1);
    return `dark:${prop}-[${to}]`;
  });
  if (after === before) continue;
  utils += count;
  files += 1;
  writeFileSync(file, after);
}

/* The two dark accent-text CSS overrides still emitted a blue. */
const CSS_FILE = 'src/design-system/globals.css';
let css = readFileSync(CSS_FILE, 'utf8');
const cssBefore = css;
css = css.replace('.dark .text-\\[\\#5B7BA8\\] { color: #93C5FD !important; }',
  '.dark .text-\\[\\#5B7BA8\\] { color: #E0E0E0 !important; }');
css = css.replace('.dark .text-\\[\\#7E9AC4\\] { color: #BFDBFE !important; }',
  '.dark .text-\\[\\#7E9AC4\\] { color: #E0E0E0 !important; }');
if (css !== cssBefore) {
  writeFileSync(CSS_FILE, css);
  console.log('  neutralised the two dark accent-text CSS overrides');
}

console.log(`\nrewrote ${utils} dark text utilities across ${files} files\n`);
for (const [from, n] of [...touched].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${from} -> ${M[from]}   (${n})`);
}
