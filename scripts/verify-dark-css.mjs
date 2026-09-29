/**
 * verify-dark-css.mjs — does dark mode actually work in the built CSS?
 *
 * Background. Two separate defects made dark mode render as black-on-light:
 *
 *  1. CORRUPTED CLASSES. Four TopBar utilities had been mangled into
 *     `dark:text-[#E0E0E0]-[#EFEFEC]` and `hover:text dark:…`. The first form
 *     is an invalid class so it emits no rule at all; the second left `hover:`
 *     with no value. Both are valid *strings*, so no type-checker sees them.
 *
 *  2. THE DARK TOKEN BLOCK WAS DROPPED. tokens.css's `[data-theme="dark"]`
 *     block did not survive the Vite production build — only the light `:root`
 *     values shipped. Every `var(--color-bg)` therefore resolved to its LIGHT
 *     value, so `html.dark { background: var(--color-bg) }` painted
 *     #F8F8F7 and inherited #14151A ink. globals.css now sets the dark canvas
 *     and ink with LITERAL values for exactly this reason, so this check
 *     verifies those literals rather than the tokens.
 *
 * Method. Everything is asserted against the real build output, because the
 * dark variant is `@custom-variant dark (&:where(.dark, .dark *))` and
 * `:where()` has ZERO specificity — a dark rule only wins by being emitted
 * after its base rule. That is invisible in the source and untypecheckable.
 *
 * Note on reading the output: Tailwind escapes every character of an arbitrary
 * value, including the `:` of a variant, so a dark utility appears as
 * `.dark\:text-\[\#e0e0e0\]:where(.dark,.dark *){color:#e0e0e0}`. Hexes are
 * lower-cased and colours may be rewritten as `oklab()`. Earlier versions of
 * this check searched for `data-theme="dark"`, uppercase hexes and the literal
 * `--nx-canvas:#212121`, and reported hard failures on a good build — the
 * needles were wrong, not the CSS.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let cssPath = null;
let cssSize = -1;
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.css') && statSync(p).size > cssSize) { cssSize = statSync(p).size; cssPath = p; }
  }
};
walk('dist/assets');
if (!cssPath) {
  console.log('FAIL  no built CSS in dist/assets — run `npm run build` first');
  process.exit(1);
}
const low = readFileSync(cssPath, 'utf8').toLowerCase();
console.log(`stylesheet: ${cssPath.replace(/\\/g, '/')}  (${(cssSize / 1024).toFixed(0)} kB)\n`);

let bad = 0;
const pass = (label) => console.log(`  ok    ${label}`);
const fail = (label) => { bad += 1; console.log(`  FAIL  ${label}`); };

const baseCls = (hex) => `.text-\\[\\#${hex}\\]`;
const darkCls = (hex) => `.dark\\:text-\\[\\#${hex}\\]`;

/* 1. every dark text rule must be emitted after the base rule it overrides. */
for (const [base, dark, label] of [
  ['2e3038', 'e0e0e0', 'TopBar select text'],
  ['6b6d77', 'd0d0d0', 'TopBar icon / chevron'],
  ['14151a', 'ffffff', 'authority heading'],
  ['5a5c66', 'd0d0d0', 'muted label'],
]) {
  const b = low.indexOf(baseCls(base));
  const d = low.indexOf(darkCls(dark));
  if (b < 0) fail(`${label}: base ${baseCls(base)} not emitted`);
  else if (d < 0) fail(`${label}: dark ${darkCls(dark)} not emitted`);
  else if (d < b) fail(`${label}: dark rule BEFORE base — zero specificity, would lose`);
  else pass(`${label}: dark rule follows base (${d} > ${b})`);
}

/* 2. dark variants must carry the zero-specificity wrapper. */
if (low.includes(`${darkCls('e0e0e0')}:where(.dark,.dark *)`)) {
  pass('dark variants carry the :where() zero-specificity wrapper');
} else {
  fail('dark variant missing the :where() wrapper');
}

/* 3. the classes corrupted in the last round must emit nothing. */
for (const frag of ['e0e0e0]-[#efefec', 'd0d0d0]-[#b42318']) {
  const needle = `.dark\\:text-\\[\\#${frag}\\]`;
  if (low.includes(needle)) fail(`corrupted ${needle} still shipped`);
  else pass(`corrupted class gone: ${needle}`);
}

/* 4. THE DARK TOKEN BLOCK MUST SHIP. This is the defect that broke the whole
      theme: tokens.css had a run of bare `--name: value` pairs at the top
      level, which is invalid CSS. The parser folded them into the preceding
      rule and swallowed the `[data-theme="dark"]` block, so only the light
      `:root` values reached the bundle and every var() in dark mode resolved
      to its light value. */
for (const [needle, label] of [
  ['--nx-canvas:#212121', 'dark canvas'],
  ['--color-text-primary:#fff', 'dark text-primary'],
  ['--color-text-secondary:#e0e0e0', 'dark text-secondary'],
  ['--color-surface:#2f2f2f', 'dark surface'],
  ['--color-border:#3d3d3d', 'dark border'],
]) {
  if (low.includes(needle)) pass(`${label} token ships (${needle})`);
  else fail(`${label} token MISSING from the bundle — the dark block is being dropped again`);
}

/* The light component ramps must not be scoped to a dark selector, or dark
   mode inherits light greys. */
if (/\[data-theme=["']?dark["']?\]?[^{}]*\{[^}]*--color-line:\s*#e4e4e0/i.test(low)) {
  fail('light component ramp is scoped to a dark selector');
} else {
  pass('light component ramps are not scoped to dark selectors');
}

/* Belt and braces: the canvas rule uses literals, so it survives even if the
   token block is lost again. */
const darkRule = /html\.dark,body\.dark,\[data-theme=dark\]\{[^}]*\}/.exec(low);
if (!darkRule) {
  fail('no `html.dark, body.dark, [data-theme="dark"]` rule in the bundle');
} else {
  const r = darkRule[0];
  if (/background-color:#212121/.test(r)) pass('dark canvas rule is a literal #212121');
  else fail('dark canvas rule is not literal');
  if (/color:#fff/.test(r)) pass('dark default ink rule is a literal #fff');
  else fail('dark default ink rule is not literal');
}

/* 5. the dark surface overrides that rescue hard-coded light washes. */
for (const [hex, label] of [['#262626', 'subtle fill'], ['#2f2f2f', 'card surface'], ['#3d3d3d', 'hairline border']]) {
  if (low.includes(hex)) pass(`dark ${label} present (${hex})`);
  else fail(`dark ${label} missing (${hex})`);
}

/* 6. light mode must not have been polluted. */
if (low.includes('--nx-canvas:#f8f8f7')) pass('light canvas token still present');
else fail('light canvas token missing');

console.log(bad === 0 ? '\ndark CSS verified' : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
