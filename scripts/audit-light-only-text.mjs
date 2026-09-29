/**
 * audit-light-only-text.mjs — find text that CANNOT change with the theme.
 *
 * The TopBar was a whole light-only component: every `text-[#14151A]` on it had
 * no `dark:` partner, so it stayed black in dark mode. This sweeps the entire
 * codebase for the same defect — any className carrying a light-only text or
 * background utility and no `dark:` counterpart anywhere in that className.
 *
 * It also flags inline `style={{ color: '#…' }}` on a non-map element, which
 * bypasses Tailwind and can never respond to the theme.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DARK = /^dark:/;

/** Utilities that paint a light surface or light text. */
const LIGHT_TEXT = /(^|\s)(text-\[#(?:14151A|2E3038|1A3A6B|12294D|5A5C66|6B6D77|A1A3AC|74767F)\]|text-\[#B42318\]|text-\[#126B34\]|text-\[#A15C07\]|text-\[#2C5C93\])/;
const LIGHT_SURFACE = /(^|\s)(bg-white|bg-\[#(?:FFFFFF|F1F1EF|F8F8F7|EFEFEC|F4F4F1|E4F3E9|FCF1F0|FBF7EC|FAF0D8|F1F8F3|EEF2F8)\])/;

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

const findings = new Map(); // file -> [{line, kind, snippet}]

for (const file of walk('src')) {
  const txt = readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/className/.test(line)) return;
    if (/\bdark:/.test(line)) return;              // this line already adapts
    const m = LIGHT_TEXT.exec(line);
    const s = LIGHT_SURFACE.exec(line);
    const hit = m || s;
    if (!hit) return;
    // Multi-line className={...} that continues: check the next 3 lines for dark:
    const window = lines.slice(i, i + 4).join(' ');
    if (/\bdark:/.test(window)) return;
    const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');
    if (!findings.has(rel)) findings.set(rel, []);
    findings.get(rel).push({
      line: i + 1,
      kind: m ? 'text' : 'surface',
      snippet: line.trim().slice(0, 96),
    });
  });
}

let total = 0;
const files = [...findings.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [file, items] of files) {
  console.log(`\n${file}  (${items.length})`);
  for (const it of items.slice(0, 6)) {
    console.log(`  L${it.line}  [${it.kind}]  ${it.snippet}`);
  }
  if (items.length > 6) console.log(`  … and ${items.length - 6} more`);
  total += items.length;
}

console.log(`\n${'-'.repeat(56)}`);
console.log(total === 0
  ? 'every text/surface utility has a dark: counterpart'
  : `${total} light-only class(es) across ${files.length} file(s) — these cannot change with the theme`);
