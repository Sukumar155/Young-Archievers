/**
 * diff-light-block.mjs — declaration-level diff of the light token block.
 *
 * The earlier cut spanned from `:root` to `[data-theme="dark"]`, which also
 * swallows the ramp *comment* blocks that sit between them — and those comments
 * are where many of the original hexes live. That made the palette look far
 * more changed than it is.
 *
 * This extracts only the balanced `:root, [data-theme="light"] { … }` body and
 * compares `--token: value` pairs, so a changed light value is unambiguous.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Return the body of the first rule whose selector mentions :root. */
function rootBody(css) {
  const i = css.search(/(^|\n):root/);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < css.length; k += 1) {
    if (css[k] === '{') depth += 1;
    else if (css[k] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, k);
    }
  }
  return null;
}

const decls = (body) => {
  const out = new Map();
  for (const line of body.split(/\r?\n/)) {
    const c = line.replace(/\/\*.*?\*\//g, '');
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(c);
    if (m) out.set(m[1], m[2].trim().toUpperCase());
  }
  return out;
};

const nowBody = rootBody(readFileSync('src/design-system/tokens.css', 'utf8'));
const headBody = rootBody(execFileSync('git', ['show', 'HEAD:src/design-system/tokens.css'], { encoding: 'utf8' }));

if (!nowBody || !headBody) {
  console.log('FAIL  could not extract a :root block from one side');
  process.exit(1);
}

const now = decls(nowBody);
const head = decls(headBody);

const changed = [];
for (const [k, v] of head) {
  if (!now.has(k)) changed.push(`REMOVED  ${k}: ${v}`);
  else if (now.get(k) !== v) changed.push(`CHANGED  ${k}: ${v}  ->  ${now.get(k)}`);
}
for (const [k, v] of now) if (!head.has(k)) changed.push(`ADDED    ${k}: ${v}`);

console.log(`:root declarations — ${head.size} at HEAD, ${now.size} now`);
if (changed.length === 0) {
  console.log('\nno light token value was added, removed or changed — light palette is untouched');
} else {
  console.log(`\n${changed.length} difference(s):`);
  for (const c of changed) console.log(`  ${c}`);
}
