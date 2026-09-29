/**
 * scan-corrupt-classes.mjs — find class names mangled by the sweep.
 *
 * The damage has a distinct shape: a utility was inserted INTO the middle of
 * another one, leaving fragments behind. Two reliable signatures:
 *
 *   S1  a `dark:` utility carrying a second arbitrary value
 *         dark:text-[#E0E0E0]-[#EFEFEC]
 *         dark:hover:bg-[#3D3D3D]-[#2F2F2F]
 *       The first `[#…]` makes the whole class invalid, so the dark variant
 *       never applies and the element keeps its light colour.
 *
 *   S2  a variant left with no value because the value was cut away
 *         hover:bg dark:…
 *         focus:ring dark:…
 *       Renders as a no-op, so the hover state silently does nothing.
 *
 * Both are invisible to a type-check — they are valid strings — which is why
 * this has to be scanned for rather than compiled for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* S1: a dark utility with a trailing `-[…]` fragment. */
const S1 = /dark:(?:[a-z-]+:)*[a-z-]+-\[[^\]]*\](-\[[^\]]*\])+/g;
/* S2: a variant keyword with no value, immediately before another utility. */
const S2 = /\b(?:hover|focus|active|disabled|group-hover|peer-focus|before|after):(?:bg|text|border|ring|fill|stroke|opacity)(?=[\s"'])/g;

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|css)$/.test(n)) acc.push(p);
  }
  return acc;
}

const tally = { S1: 0, S2: 0 };
const byFile = new Map();

for (const file of walk('src')) {
  const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const a = [...line.matchAll(S1)];
    const b = [...line.matchAll(S2)];
    if (!a.length && !b.length) return;
    tally.S1 += a.length;
    tally.S2 += b.length;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push({ n: i + 1, a, b, line: line.trim() });
  });
}

for (const [file, items] of [...byFile].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`\n${file}  (${items.length} line(s))`);
  for (const it of items) {
    console.log(`  L${it.n}`);
    for (const m of it.a) console.log(`     S1  ${m[0]}`);
    for (const m of it.b) console.log(`     S2  ${m[0]} <-- has no value`);
  }
}

console.log(`\n${'-'.repeat(52)}`);
console.log(`S1 mangled dark utilities : ${tally.S1}`);
console.log(`S2 valueless variants    : ${tally.S2}`);
console.log(`files affected           : ${byFile.size}`);
