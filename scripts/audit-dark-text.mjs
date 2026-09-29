/**
 * audit-dark-text.mjs — find text that CANNOT be read in dark mode.
 *
 * The token block is fixed, so inherited colour now resolves correctly. What
 * remains is text that hard-codes a dark colour and relies on a `dark:`
 * override to become readable. Two failure classes:
 *
 *   A  a dark ink colour with NO `dark:` partner on the same element — it stays
 *      dark ink on a dark canvas. This is the reported symptom.
 *   B  a dark ink colour whose `dark:` partner is in the same className but the
 *      element also sets an inline `style={{ color }}`, which beats both.
 *
 * The check works on className SPANS rather than lines, because a JSX
 * className routinely wraps across several lines through template literals and
 * ternaries. A line-based pass reports false positives on multi-line
 * classNames and misses real cases.
 *
 * "Dark ink" means low luminance on a dark surface: the near-black/navy/slate
 * family the light theme uses for body text. Semantic colours that are already
 * light are not flagged.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Near-black / navy / slate inks used for text in the light theme. */
const DARK_INK = new Set([
  '#14151a', '#0f2140', '#12294d', '#1a3a6b', '#2e3038', '#0d0e12',
  '#111827', '#0f172a', '#1f2937', '#2b2b2b', '#1a1a1a', '#111111',
  '#334155', '#3f3f46', '#404040', '#444444', '#4b5563', '#525252',
  '#0a0a0a', '#09090c', '#1b2434', '#2e4059', '#282931',
]);

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

/** Every className span, as [start,end) offsets, brace-matched. */
function spans(text) {
  const out = [];
  const re = /className=/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const after = text[m.index + m[0].length];
    if (after === '"' || after === "'") {
      const end = text.indexOf(after, m.index + m[0].length + 1);
      if (end > 0) out.push([m.index + m[0].length, end + 1]);
    } else if (after === '{') {
      let i = m.index + m[0].length;
      let depth = 0;
      let q = null;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (q) {
          if (c === '\\') { i += 1; continue; }
          if (c === q) q = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      out.push([m.index + m[0].length, i]);
    }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

const noPartner = [];
const inlineDark = [];
let spansChecked = 0;

for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8');
  const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');

  for (const [s, e] of spans(text)) {
    const span = text.slice(s, e);
    spansChecked += 1;
    const line = text.slice(0, s).split('\n').length;

    // Dark ink text utilities in this span.
    const inks = [...span.matchAll(/text-\[#([0-9A-Fa-f]{6})\]/g)]
      .map((m) => `#${m[1].toLowerCase()}`)
      .filter((h) => DARK_INK.has(h) || lum(h) < 90);

    if (!inks.length) continue;
    // Does the span carry any dark: text override at all?
    const hasDarkText = /dark:(?:[a-z-]+:)*text-/.test(span);
    if (!hasDarkText) {
      noPartner.push({ rel, line, inks: [...new Set(inks)], span: span.slice(0, 90) });
    }
  }

  // Inline style colour that is dark ink.
  for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    const cm = /color:\s*['"]?(#[0-9A-Fa-f]{3,6})/i.exec(m[1]);
    if (!cm) continue;
    let hex = cm[1];
    if (hex.length === 4) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    if (DARK_INK.has(hex.toLowerCase()) || lum(hex) < 90) {
      inlineDark.push({
        rel,
        line: text.slice(0, m.index).split('\n').length,
        hex: hex.toUpperCase(),
        snippet: m[0].slice(0, 80),
      });
    }
  }
}

console.log(`\n${spansChecked} className span(s) scanned across src\n`);

console.log(`A. dark ink with NO dark: partner  — ${noPartner.length}`);
const byFile = new Map();
for (const x of noPartner) {
  if (!byFile.has(x.rel)) byFile.set(x.rel, []);
  byFile.get(x.rel).push(x);
}
for (const [file, items] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n   ${file}  (${items.length})`);
  for (const it of items.slice(0, 8)) {
    console.log(`     L${it.line}  ${it.inks.join(', ')}`);
    console.log(`        ${it.span.replace(/\s+/g, ' ').slice(0, 84)}`);
  }
  if (items.length > 8) console.log(`     … and ${items.length - 8} more`);
}

console.log(`\nB. inline style={{ color: dark }}  — ${inlineDark.length}`);
for (const x of inlineDark) {
  console.log(`   ${x.rel}:${x.line}  ${x.hex}   ${x.snippet.replace(/\s+/g, ' ')}`);
}

console.log(`\n${'-'.repeat(56)}`);
console.log(`total elements at risk: ${noPartner.length + inlineDark.length}`);
