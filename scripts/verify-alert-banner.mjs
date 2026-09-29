/**
 * verify-alert-banner.mjs — prove the banner text is actually white in the
 * compiled CSS, by resolving the cascade the way a browser would.
 *
 * "The class is there, so it must win" is exactly the assumption that caused
 * this bug, so this reads the real built stylesheet, collects every `color`
 * declaration that could match the description <p> and the title <h1> inside
 * .nx-alert-banner, and applies the cascade rules in order:
 *
 *   1. !important declarations win over normal ones.
 *   2. Unlayered normal declarations beat ALL layered normal declarations
 *      (CSS Cascade Level 5) — layer order is compared BEFORE specificity.
 *   3. Within the same layer, specificity decides.
 *
 * It also asserts the new rule does not select any button, because the SOS
 * control is a white surface with red ink and must not be repainted.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const distDir = join(ROOT, 'dist');
const assets = join(distDir, 'assets');

// Vite does not prune old hashed assets, so `dist/assets` can hold several
// index-*.css files. The only correct one is the stylesheet dist/index.html
// actually references — picking "the newest by sort" verifies a stale build.
const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const ref = /assets\/(index-[^"']+\.css)/.exec(html);
if (!ref) {
  console.error('could not find the stylesheet referenced by dist/index.html');
  process.exit(2);
}
const cssFile = ref[1];
const css = readFileSync(join(assets, cssFile), 'utf8');
console.log(`stylesheet: ${cssFile}  (${css.length.toLocaleString()} bytes, from dist/index.html)\n`);

let failures = 0;
const ok = m => console.log(`  PASS  ${m}`);
const bad = m => { failures++; console.log(`  FAIL  ${m}`); };

/**
 * Flatten a minified stylesheet into { selector, prop, value, layers }.
 * `layers` holds only @layer names in source order, innermost last; @media and
 * friends are tracked for brace matching but excluded, since they are not layers.
 */
function parse(src) {
  const out = [];
  // Every '{' pushes exactly one entry and every '}' pops exactly one, so the
  // stack mirrors the brace nesting. Selectors are pushed too — otherwise a
  // '}' that closes a layer would be mistaken for one closing a rule, and the
  // layer would never be popped.
  const stack = [];          // { kind: 'layer' | 'block' | 'selector', name }
  let buf = '';
  let i = 0;
  const n = src.length;

  const layerNames = () => stack.filter(s => s.kind === 'layer').map(s => s.name);
  const topSel = () => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].kind === 'selector') return stack[k];
    }
    return null;
  };

  const record = (text) => {
    const s = topSel();
    if (!s) return;
    const idx = text.indexOf(':');
    if (idx <= 0) return;
    const prop = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    if (prop) out.push({ selector: s.name, prop, value, layers: layerNames() });
  };

  while (i < n) {
    const c = src[i];

    if (c === '"' || c === "'") {
      const q = c; buf += c; i++;
      while (i < n && src[i] !== q) { buf += src[i]; i++; }
      buf += src[i] ?? ''; i++;
      continue;
    }

    if (c === '{') {
      const pre = buf.trim();
      buf = '';
      const layer = /^@layer\s+([\w,\s-]+)$/.exec(pre);
      if (layer) stack.push({ kind: 'layer', name: layer[1] });
      else if (pre.startsWith('@')) stack.push({ kind: 'block', name: pre });
      else stack.push({ kind: 'selector', name: pre });
      i++;
      continue;
    }

    if (c === '}') {
      // Minified CSS omits the final `;` in every block, so the last
      // declaration is sitting in `buf` right now. Flush it before popping,
      // otherwise exactly one colour per rule is lost — which is why
      // `.text-white{color:var(--color-white)}` went missing.
      const closed = stack[stack.length - 1];
      if (closed && closed.kind === 'selector' && buf.trim()) record(buf.trim());
      stack.pop();
      buf = '';
      i++;
      continue;
    }

    if (c === ';') {
      record(buf.trim());
      buf = '';
      i++;
      continue;
    }

    buf += c; i++;
  }
  return out;
}

const rules = parse(css);
const colors = rules.filter(r => r.prop === 'color');
console.log(`parsed ${rules.length} declarations, ${colors.length} of them colour\n`);

/** (ids, classes+attrs+pseudo-classes incl. :is()/:not(), elements) */
function specificity(sel) {
  let s = sel.replace(/::[\w-]+(\([^)]*\))?/g, '');
  let inside = '';
  for (const m of s.matchAll(/:(?:is|not|where)\(([^()]*)\)/g)) {
    inside += ' ' + m[1];
  }
  s = s.replace(/:(?:is|not|where)\([^()]*\)/g, '');

  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+/g) || []).length
            + (s.match(/\[[^\]]*\]/g) || []).length
            + (s.match(/:[\w-]+/g) || []).length;
  // :where() contributes zero; :is()/:not() contribute their most specific arg.
  const isInner = inside.replace(/:where\([^()]*\)/g, '');
  const isCls = (isInner.match(/\.[\w-]+/g) || []).length
              + (isInner.match(/\[[^\]]*\]/g) || []).length
              + (isInner.match(/:[\w-]+/g) || []).length;
  const isEls = (isInner.match(/(^|[\s>~+,])([a-z][\w-]*)/g) || []).length;
  const els = (s.replace(/:[\w-]+(\([^()]*\))?/g, ' ')
                 .match(/(^|[\s>~+])[a-z][\w-]*/g) || []).length;

  return [ids, cls + Math.max(isCls, isCls), els + isEls];
}

const cmpSpec = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

const isImportant = d => /!\s*important\s*$/i.test(d.value);
const layerRank = d => (d.layers.length ? -d.layers.length : Infinity);

/** Cascade: !important first, then layer rank, then specificity. */
function resolve(cands) {
  const imp = cands.filter(isImportant);
  const pool = imp.length ? imp : cands;
  return pool
    .map((d, i) => ({ d, i }))
    .sort((x, y) => {
      if (imp.length) {
        const s = cmpSpec(specificity(y.d.selector), specificity(x.d.selector));
        if (s) return s;
      }
      const r = layerRank(y.d) - layerRank(x.d);
      if (r) return r;
      const s2 = cmpSpec(specificity(y.d.selector), specificity(x.d.selector));
      if (s2) return s2;
      return y.i - x.i; // later source order wins
    })[0].d;
}

/**
 * Split a selector list on top-level commas only.
 *
 * A naive split(',') destroys `:is(h1,p)` — the very selector under test — by
 * cutting it into `.nx-alert-banner :is(h1` and `p)`, neither of which matches
 * anything. Commas inside (), [] or "" are not separators.
 */
function splitSelectors(sel) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const c of sel) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Colour declarations that can actually reach the title / description inside
 * .nx-alert-banner. Three shapes matter:
 *   - the bare element rule from typography.css      (p, h1)
 *   - a Tailwind colour utility on the element       (.text-white)
 *   - the banner-scoped override                     (.nx-alert-banner :is(h1,p))
 */
// Colour utilities actually present on these two elements in the JSX. Stored
// with the leading dot, because that is how they appear in a selector.
const ON_ELEMENT = {
  p: new Set(['.text-white']),
  h1: new Set(['.text-white'])
};

/** Normalise a CSS colour so #fff, #FFFFFF and rgb(255,255,255) compare equal. */
function isWhite(value) {
  const v = value.trim().toLowerCase();
  if (v === 'white' || v === 'var(--color-white)' || v === 'var(--color-text-inverse)') return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
    return h === 'ffffff';
  }
  const rgb = /^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1\s*)?\)$/.exec(v);
  return Boolean(rgb);
}

function matchesSelector(sel, el, classes) {
  sel = sel.trim();
  if (sel === el) return true;
  if (classes.has(sel)) return true;

  // The override form is an ancestor class plus a subject, either as a plain
  // descendant (`.banner p`) or wrapped in :is() (`.banner :is(h1,p)`).
  const compound = /^(\.[\w-]+)[\s>+~]+(.+)$/.exec(sel);
  if (compound) {
    const subject = compound[2].trim();
    if (subject === el) return true;
    const isForm = /^:is\(([^()]*)\)$/.exec(subject);
    if (isForm && isForm[1].split(',').map(s => s.trim()).includes(el)) return true;
  }
  return false;
}

function candidatesFor(el) {
  const classes = ON_ELEMENT[el] || new Set();
  return colors.filter(c => splitSelectors(c.selector).some(s => matchesSelector(s, el, classes)));
}

for (const [label, el] of [['description <p>', 'p'], ['title <h1>', 'h1']]) {
  console.log(`${label}`);
  const cands = candidatesFor(el);
  if (!cands.length) {
    bad(`${label}: no colour declaration matched at all`);
    console.log('');
    continue;
  }
  for (const c of cands) {
    const sp = specificity(c.selector).join(',');
    console.log(`        ${c.selector.padEnd(30)} ${c.value.padEnd(30)} layer=${c.layers.join('>') || 'UNLAYERED'}  spec=${sp}`);
  }
  const w = resolve(cands);
  console.log(`        winner: ${w.selector}\n`);
  const val = w.value.replace(/\s*!\s*important\s*$/i, '').trim();
  if (isWhite(val) && w.layers.length === 0) {
    ok(`${label} -> ${val} (white), from unlayered "${w.selector}"`);
  } else {
    bad(`${label} -> ${val} (from "${w.selector}", layer=${w.layers.join('>') || 'unlayered'})`);
  }
  console.log('');
}

console.log('scope containment');
const mine = rules.filter(r => r.selector.includes('nx-alert-banner'));
if (!mine.length) {
  bad('no .nx-alert-banner rule present in the built CSS');
} else {
  const sels = [...new Set(mine.flatMap(r => splitSelectors(r.selector)))];
  console.log(`        selectors: ${sels.join('  ')}`);
  if (sels.every(s => !/(^|[\s>~+])(button|a)($|[\s>:.{[])/.test(s))) {
    ok('rule does not select buttons or links');
  } else {
    bad(`rule selects a button: ${sels.filter(s => /\bbutton\b|\ba\b/.test(s)).join(' ')}`);
  }
  const props = [...new Set(mine.map(r => r.prop))];
  if (props.length === 1 && props[0] === 'color') ok('rule only sets `color` — layout and typography untouched');
  else bad(`rule sets unexpected properties: ${props.join(', ')}`);
  if (mine.every(r => !/opacity|rgba?\(/i.test(r.value))) ok('solid colour, no opacity');
  else bad(`non-solid colour used: ${mine.map(r => r.value).join(' ')}`);
}

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS - banner text is white, buttons untouched' : `FAIL - ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
