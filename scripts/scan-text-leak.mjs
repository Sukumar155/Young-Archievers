/**
 * scan-text-leak.mjs — find Tailwind utilities that leaked into VISIBLE TEXT.
 *
 * A repair pass appended `dark:` utilities to the end of a className span. For
 * the brace form `className={…}` the span's last character is `}`, so the
 * utilities landed outside the attribute; one of those appends ended up inside
 * the element's text content instead, so the user literally saw the string
 * "NEXORA dark:text-[#FFFFFF]" rendered in the top-left corner.
 *
 * These are valid TypeScript, so nothing but a text scan finds them. The
 * signature is a utility token appearing between `>` and `<` — i.e. in the
 * text of a JSX element rather than inside an attribute.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** `dark:text-[#FFF]`, `hover:bg-x`, `p-4`, `text-[#14151A]` … */
const UTIL = String.raw`(?:dark:)?(?:hover|focus|active|disabled|group-hover|peer-focus|sm|md|lg|xl|first|last|odd|even):?[a-z-]*(?:\[[^\]]*\])?`;

/** Text nodes: between > and <, outside braces and quotes. */
const TEXT_NODE = new RegExp(
  String.raw`>([^<>{}]{0,120}?)<`,
  'g'
);

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

let found = 0;
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');
  TEXT_NODE.lastIndex = 0;
  let m;
  while ((m = TEXT_NODE.exec(src)) !== null) {
    const text = m[1];
    // A utility inside the visible text: a `dark:`/`hover:` variant, or a
    // bracket form like [#14151A] / [#FFFFFF].
    if (!/\b(dark|hover|focus|active|disabled|group-hover|peer-focus):/.test(text)) continue;
    if (!/\[#/.test(text)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    found += 1;
    console.log(`  ${rel}:${line}`);
    console.log(`     rendered text: ${JSON.stringify(text.trim())}`);
  }
}

console.log(`\n${found} element(s) rendering a Tailwind utility as visible text`);
process.exit(found === 0 ? 0 : 1);
