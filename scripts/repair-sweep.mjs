/**
 * repair-sweep.mjs — restore the closing syntax around the swept utilities.
 *
 * What went wrong. dark-sweep.mjs appended utilities to the END of each
 * `className` span. For a quoted className (`className="…"`) that is correct.
 * For the brace form (`className={…}`) the span's last character is `}`, so the
 * utilities landed OUTSIDE the attribute and the JSX stopped parsing. Two
 * repair passes then lost a closing backtick and pasted a capture-group offset
 * in as trailing digits. The utilities themselves survived intact and correctly
 * ordered — only the syntax around them has to be rebuilt.
 *
 * The signature is unambiguous, and there are exactly three shapes:
 *
 *   T|B  the template literal's backtick ended up in FRONT of the run.
 *          … rounded-xl` RUN }>
 *          ->  … rounded-xl RUN `}>
 *
 *   T|Q  the run sits just after a closing quote inside `${…}`; the `}` that
 *        closed `${…}` and the attribute's own `}` came back as `}}NNNN`.
 *          … : 'b' RUN }}NNNN >
 *          ->  … : 'b'} RUN `} >
 *
 *   P    a bare expression, which cannot carry extra classes, so the whole
 *        attribute is folded into a template literal.
 *          className={ … }  RUN }
 *          ->  className={`${ … } RUN `}
 *
 * Two phases, because offsets shift: collect every site, then splice from the
 * end of the file backwards so earlier offsets stay valid.
 *
 * `tsc -b` is the oracle for this repair: a misplaced brace or backtick will
 * not parse, so a clean type-check is proof the syntax is right.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');

const RUN = String.raw`(?:dark:[A-Za-z0-9#[\]/_.-]+[ \t]*)+`;
/* Match the run alone; the trailing damage is inspected separately below.
   Folding the damage into the same pattern would let the optional groups match
   empty and the engine would never bother consuming it. */
const RE_SITE = new RegExp(RUN, 'g');
/** The damage trailing a run: stray braces and/or a pasted capture offset. */
const RE_DAMAGE = /^[ \t]*(?:\}[ \t]*\}?[ \t]*)?(?:\d{2,})?/;
/** What may follow the attribute. The attribute can close on a later line, or
 *  be followed by the next attribute, so both are accepted here; the digits in
 *  RE_DAMAGE are what actually gate a site, and no healthy className is ever
 *  followed by a four-digit number. */
const RE_PUNCT = /^\s*(?:>|\/[ \t]*>|[,);}]|[A-Za-z_$])/;

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(n)) acc.push(p);
  }
  return acc;
}

/** Offset just past the `className={` that encloses `at`, or -1. */
function openerEnd(src, at) {
  let found = -1;
  const re = /className=\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= at) break;
    found = m.index + 'className={'.length;
  }
  return found;
}

const tally = new Map();
let total = 0;

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  const rel = file.replace(/.*[\\/]src[\\/]/, 'src/');
  const sites = [];

  RE_SITE.lastIndex = 0;
  let m;
  while ((m = RE_SITE.exec(src)) !== null) {
    const run = m[0].trim();

    // The damage is whatever immediately follows the run.
    const after = src.slice(m.index + m[0].length);
    const dmg = RE_DAMAGE.exec(after)[0];
    // Real damage: the pasted capture offset (4+ digits) is the reliable
    // marker. A bare brace alone is ambiguous — a healthy attribute ends `}`
    // too — so it is only trusted when no offset is present AND the character
    // before the run cannot legally sit there.
    const hasOffset = /\d{2,}/.test(dmg);
    const prevCharIsStray = !hasOffset && /[}{]/.test(dmg);
    if (!hasOffset && !prevCharIsStray) continue;

    const end = m.index + m[0].length + dmg.length;
    if (!RE_PUNCT.test(src.slice(end))) continue;

    const before = src.slice(0, m.index);
    const head = before.replace(/[ \t]+$/, '');
    const prev = head.slice(-1);
    const op = openerEnd(src, m.index);
    const isTemplate = op >= 0 && /^[ \t]*`/.test(src.slice(op, op + 3));

    let shape;
    let start;      // where the replacement begins
    let replacement;

    if (prev === '`') {
      // T|B — drop the stray backtick, put the run inside, re-close.
      shape = 'T|B';
      start = m.index - 1;
      replacement = ` ${run} \`}`;
    } else if (isTemplate) {
      // T|Q — re-close `${…}`, then the run, then the backtick and brace.
      shape = 'T|Q';
      start = m.index;
      replacement = `} ${run} \`}`;
    } else {
      // P — fold the bare expression into a template literal.
      shape = 'P';
      const expr = src.slice(op, m.index).replace(/[ \t]+$/, '').replace(/\}$/, '');
      start = op;
      replacement = `className={\`\${${expr}} ${run} \`}`;
    }

    sites.push({ start, end, replacement, shape });
  }

  if (!sites.length) continue;

  // Splice from the back so earlier offsets remain valid.
  let out = src;
  for (const s of [...sites].reverse()) {
    out = out.slice(0, s.start) + s.replacement + out.slice(s.end);
  }
  if (APPLY) writeFileSync(file, out);

  total += sites.length;
  for (const s of sites) tally.set(s.shape, (tally.get(s.shape) || 0) + 1);
  console.log(`  ${rel}  (${sites.length})`);
}

console.log(`\n${total} attribute(s) ${APPLY ? 'repaired' : 'found — pass --apply'}`);
for (const [k, v] of [...tally].sort()) console.log(`  ${k}  ${v}`);
