/**
 * selftest-verify-light.mjs — prove verify-light.mjs actually fails when the
 * light theme IS broken.
 *
 * A guard that cannot fail is worse than no guard: it reports "intact" and
 * means nothing. This injects a dark colour into the `:root` light block,
 * confirms the checker catches it, then restores the file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/design-system/tokens.css';
const original = readFileSync(FILE, 'utf8');
const anchor = '--nx-canvas:';

if (!original.includes(anchor)) {
  console.log('SKIP  anchor not found, cannot run the self-test');
  process.exit(0);
}

const run = () => {
  try {
    return execFileSync('node', ['scripts/verify-light.mjs'], { encoding: 'utf8' });
  } catch (e) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
};

const before = run();
const beforeOk = before.includes('light theme intact');

/* Inject a dark-ladder colour as a genuine light paint value. */
writeFileSync(FILE, original.replace(anchor, '--nx-canvas: #171717;'));
const during = run();
const caughtLight = !during.includes('light theme intact') && /FAIL/.test(during);

/* Inject a colour that is neither dark nor part of the palette. */
writeFileSync(FILE, original.replace(anchor, '--nx-canvas: #ABCDEF;'));
const during2 = run();
const caughtUnknown = !during2.includes('light theme intact');

writeFileSync(FILE, original);
const after = run();
const restored = after.includes('light theme intact');

console.log(`  clean file reported intact      : ${beforeOk ? 'yes' : 'NO — checker is broken already'}`);
console.log(`  dark colour in :root  detected  : ${caughtLight ? 'yes' : 'NO'}`);
console.log(`  unknown colour in :root detected: ${caughtUnknown ? 'yes' : 'NO'}`);
console.log(`  file restored and clean         : ${restored ? 'yes' : 'NO'}`);

const pass = beforeOk && caughtLight && caughtUnknown && restored;
console.log(pass ? '\nself-test PASSED — the guard is live' : '\nself-test FAILED');
process.exit(pass ? 0 : 1);
