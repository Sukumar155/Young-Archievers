/**
 * close-ramp-rule.mjs — close the COMPONENT RAMPS rule before the dark block.
 *
 * The ramp declarations were bare `--name: value` pairs at the top level. The
 * previous edit opened a real selector for them (`:root, [data-theme="light"],
 * [data-theme="dark"], .dark {`), so the rule now needs its closing brace
 * placed immediately after the last ramp declaration and before the dark-theme
 * comment header. Doing it by line number avoids the mojibake em-dash that
 * makes exact-string matching on this file unreliable.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/design-system/tokens.css';
const APPLY = process.argv.includes('--apply');

const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

/* The last ramp declaration is --color-graphite-ink; the dark-theme comment
   header follows a couple of lines later. Insert the brace between them. */
const inkAt = lines.findIndex((l) => l.trim().startsWith('--color-graphite-ink:'));
if (inkAt < 0) {
  console.log('FAIL  could not find --color-graphite-ink');
  process.exit(1);
}
console.log(`last ramp decl at line ${inkAt + 1}: ${lines[inkAt].trim()}`);

/* Indent the ramp declarations that are still flush-left inside the new rule. */
let indented = 0;
for (let i = 0; i < lines.length; i += 1) {
  if (i > inkAt) break;
  if (/^--[a-z0-9-]+\s*:/.test(lines[i])) {
    lines[i] = `  ${lines[i]}`;
    indented += 1;
  }
}
console.log(`indented ${indented} ramp declaration(s) into the new rule`);

/* Insert the closing brace after the ink declaration (and its trailing blank). */
const insertAt = inkAt + 1;
const out = [...lines.slice(0, insertAt), '} /* end COMPONENT RAMPS */', '', ...lines.slice(insertAt)];
console.log(`inserted closing brace at line ${insertAt + 1}`);

if (APPLY) writeFileSync(FILE, out.join('\n'), 'utf8');
console.log(APPLY ? 'written' : 'dry run — pass --apply');
