/**
 * dark-sweep.mjs — give every remaining light-only element a dark variant.
 *
 * The audit found ~350 className spans across the app that carry a light text
 * colour or a light surface with NO `dark:` counterpart, so they cannot respond
 * to the theme. (The TopBar was one such component; it is not the only one.)
 *
 * Handling spans rather than lines matters: JSX classNames routinely wrap over
 * several lines through template literals and ternaries, so a line-based pass
 * would add a duplicate `dark:` to strings that already have one, or miss the
 * ones that don't.
 *
 * Rules — additive only, so light mode is byte-for-byte unchanged:
 *   light ink / text   -> dark:text-[#FFFFFF]   (or #D0D0D0 for the muted hexes)
 *   light surface      -> dark:bg-[#2F2F2F]
 *   light border       -> dark:border-[#3D3D3D]
 *   light accent text  -> dark:text-[#E0E0E0]
 *
 * A span that already contains any `dark:` is left completely alone.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* light hex -> dark counterpart, per property */
const TEXT_MAP = {
  '#14151A': '#FFFFFF', '#12294D': '#FFFFFF', '#0F2140': '#FFFFFF',
  '#2E3038': '#E0E0E0', '#1A3A6B': '#E0E0E0', '#5A5C66': '#D0D0D0',
  '#6B6D77': '#D0D0D0', '#A1A3AC': '#C0C0C0', '#74767F': '#D0D0D0',
  '#2C5C93': '#E0E0E0', '#5B7BA8': '#E0E0E0', '#7E9AC4': '#E0E0E0',
  '#B42318': '#FFFFFF', '#9A1C13': '#F0A0A0', '#8A1A12': '#F0A0A0',
  '#126B34': '#D0D0D0', '#2A6B4A': '#D0D0D0', '#12703C': '#D0D0D0',
  '#A15C07': '#E0E0E0', '#8A4D06': '#E0E0E0', '#7A3E0B': '#E0E0E0',
  '#B54708': '#E0E0E0',
};
const BG_MAP = {
  '#FFFFFF': '#2F2F2F', '#F1F1EF': '#262626', '#F8F8F7': '#262626',
  '#EFEFEC': '#262626', '#F4F4F1': '#262626', '#FCFCFB': '#262626',
  '#E4F3E9': '#0A2E22', '#F1F8F3': '#0A2E22', '#FCF1F0': '#3F1414',
  '#FBE9E7': '#3F1414', '#FBF7EC': '#3A2A0A', '#FAF0D8': '#3A2A0A',
  '#EEF2F8': '#1F2937', '#E3EAF4': '#1F2937',
};
const BORDER_MAP = {
  '#E4E4E0': '#3D3D3D', '#DEDEDA': '#3D3D3D', '#DCDCD8': '#333333',
  '#EDEDEA': '#2F2F2F', '#D4D4CE': '#4D4D4D', '#C3D0E4': '#374151',
  '#CFE6D8': '#14532D', '#F3CFC9': '#7F1D1D', '#F7E9D6': '#78350F',
  '#EFE3C4': '#78350F',
};

/** Every `className` span in the source, as [start, end) offsets. */
function classNameSpans(text) {
  const spans = [];
  const re = /className=/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const after = text[m.index + m[0].length];
    if (after === '"' || after === "'") {
      const end = text.indexOf(after, m.index + m[0].length + 1);
      if (end < 0) continue;
      spans.push([m.index + m[0].length, end + 1]);
    } else if (after === '{') {
      // Walk to the matching brace, ignoring braces inside strings.
      let i = m.index + m[0].length;
      let depth = 0;
      let quote = null;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (quote) {
          if (c === '\\') { i += 1; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
      }
      spans.push([m.index + m[0].length, i]);
    }
  }
  return spans;
}

function addDark(span) {
  if (/\bdark:/.test(span)) return null; // already adapts

  const adds = [];
  const seen = new Set();

  // text-[#hex]
  for (const m of span.matchAll(/(^|[\s"'`])text-\[#([0-9A-Fa-f]{6})\]/g)) {
    const hex = `#${m[2].toUpperCase()}`;
    const to = TEXT_MAP[hex];
    if (to && !seen.has(`text${to}`)) { seen.add(`text${to}`); adds.push(`dark:text-[${to}]`); }
  }
  // bg-[#hex] and bg-white
  for (const m of span.matchAll(/(^|[\s"'`])bg-\[#([0-9A-Fa-f]{6})\]/g)) {
    const hex = `#${m[2].toUpperCase()}`;
    const to = BG_MAP[hex];
    if (to && !seen.has(`bg${to}`)) { seen.add(`bg${to}`); adds.push(`dark:bg-[${to}]`); }
  }
  if (/(^|[\s"'`])bg-white(?=[\s"'`])/.test(span) && !seen.has('bg#2F2F2F')) {
    seen.add('bg#2F2F2F'); adds.push('dark:bg-[#2F2F2F]');
  }
  // border-[#hex]
  for (const m of span.matchAll(/(^|[\s"'`])border-\[#([0-9A-Fa-f]{6})\]/g)) {
    const hex = `#${m[2].toUpperCase()}`;
    const to = BORDER_MAP[hex];
    if (to && !seen.has(`border${to}`)) { seen.add(`border${to}`); adds.push(`dark:border-[${to}]`); }
  }

  if (!adds.length) return null;
  // Append just before the closing quote/brace.
  if (span.endsWith('"') || span.endsWith("'")) {
    return `${span.slice(0, -1)} ${adds.join(' ')}"`;
  }
  return `${span} ${adds.join(' ')}`;
}

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

let files = 0, spans = 0;
for (const file of walk('src')) {
  const before = readFileSync(file, 'utf8');
  // Right-to-left so earlier offsets stay valid.
  const list = classNameSpans(before).reverse();
  let out = before;
  let n = 0;
  for (const [s, e] of list) {
    const patched = addDark(out.slice(s, e));
    if (!patched) continue;
    out = out.slice(0, s) + patched + out.slice(e);
    n += 1;
  }
  if (n === 0) continue;
  writeFileSync(file, out);
  files += 1;
  spans += n;
  console.log(`  ${file.replace(/.*[\\/]src[\\/]/, 'src/')}  (${n})`);
}

console.log(`\npatched ${spans} className span(s) across ${files} file(s)`);
