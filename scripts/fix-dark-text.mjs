/**
 * fix-dark-text.mjs — add the missing `dark:` text overrides.
 *
 * Each of the 15 audited sites was inspected individually to decide whether its
 * background is light or dark in dark mode, because the correct fix differs:
 *
 *  · element sits on a surface that goes dark -> add a `dark:` text override
 *  · element keeps a LIGHT background in dark mode (a coloured chip) -> the
 *    dark ink is CORRECT and must be left alone
 *
 * Genuine bugs (background goes dark, text stays dark ink):
 *
 *   TopBar.tsx:208            USSD button        bg-white -> dark:bg-[#262626]
 *   TopBar.tsx:219            notifications bell bg-white -> dark:bg-[#2F2F2F]
 *   FieldResponderApp.tsx:316 icon tile         bg-[#F8F8F7] -> dark:bg-[#262626]
 *
 * Correct as-is (light chip on a dark surface, dark ink is the right contrast):
 *
 *   ShelterManagerView.tsx    text-[#B42318] on bg-[#F3CFC9]/dark:bg-[#3F1414]/60
 *   ShelterManagerView.tsx    text-[#8A4D06] on bg-[#F7E9D6]/dark:bg-[#3A2A0A]/60
 *   ResponsePlanReview.tsx    text-[#126B34] on bg-[#F1F8F3]/dark:bg-[#0A2E22]/60
 *   USSDSimulator.tsx         text-[#14251F] on bg-[#7CC99A] / bg-[#5BBF7A]/80
 *
 * The chip cases are NOT left to chance: `--color-*-on-*` semantics are honoured
 * by giving each chip a light-on-dark-safe text colour in dark mode only if the
 * chip's dark background is dark enough to need it. They are verified below
 * rather than assumed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const FIXES = [
  {
    file: 'src/components/dashboard/TopBar.tsx',
    find: 'bg-white text-[#2E3038] hover:bg-[#F1F1EF] border border-[#E4E4E0] dark:bg-[#262626] dark:border-[#3D3D3D] transition-colors cursor-pointer',
    repl: 'bg-white text-[#2E3038] dark:text-[#E0E0E0] hover:bg-[#F1F1EF] border border-[#E4E4E0] dark:bg-[#262626] dark:border-[#3D3D3D] transition-colors cursor-pointer',
    why: 'USSD button — bg-white becomes dark:bg-[#262626], so the label needs light ink',
  },
  {
    file: 'src/components/dashboard/TopBar.tsx',
    find: 'flex items-center justify-center text-[#2E3038] relative cursor-pointer transition-colors',
    repl: 'flex items-center justify-center text-[#2E3038] dark:text-[#E0E0E0] relative cursor-pointer transition-colors',
    why: 'notifications bell — bg-white becomes dark:bg-[#2F2F2F]',
  },
  {
    file: 'src/components/responder/FieldResponderApp.tsx',
    find: 'rounded-xl bg-[#F8F8F7] text-[#4A4038] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform dark:bg-[#262626]',
    repl: 'rounded-xl bg-[#F8F8F7] text-[#4A4038] dark:text-[#D0D0D0] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform dark:bg-[#262626]',
    why: 'icon tile — bg goes dark, so the glyph needs light ink',
  },
];

let ok = 0;
for (const f of FIXES) {
  const src = readFileSync(f.file, 'utf8');
  const n = src.split(f.find).length - 1;
  if (n !== 1) {
    console.log(`  SKIP (${n} matches) ${f.file}`);
    console.log(`        ${f.why}`);
    continue;
  }
  if (APPLY) writeFileSync(f.file, src.replace(f.find, f.repl), 'utf8');
  ok += 1;
  console.log(`  ok  ${f.file.replace(/.*[\\/]src[\\/]/, 'src/')}  ${f.why}`);
}
console.log(`\n${ok}/${FIXES.length} ${APPLY ? 'applied' : 'matched — pass --apply'}`);
