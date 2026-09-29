/**
 * fix-chip-contrast.mjs — repair the 5 chips that fail WCAG AA in dark mode.
 *
 * The audit's first pass left these alone on the reasoning "dark ink on a light
 * chip is already correct". Compositing the actual dark-mode result proved that
 * wrong for the translucent chips: `bg-[#5BBF7A]/80` over the dark card lands at
 * #52A26B, and #14251F on that is only 4.37:1.
 *
 * Ratios measured (text over the composited dark background):
 *
 *   ShelterManagerView  #B42318 on #391F1F  2.30:1   -> needs light ink
 *   ShelterManagerView  #8A4D06 on #362C19  2.05:1   -> needs light ink
 *   ResponsePlanReview  #126B34 on #192E27  2.17:1   -> needs light ink
 *   USSDSimulator       #14251F on #4E9464  4.37:1   -> needs light ink
 *
 * The fix keeps the light-mode appearance EXACTLY as it is (the base `text-`
 * and `bg-` are untouched) and only lifts the ink for dark mode, using the
 * severity ramp the rest of the app already uses. The 7 chips that already pass
 * are left alone — no needless change.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const FIXES = [
  {
    file: 'src/components/shelter/ShelterManagerView.tsx',
    find: 'text-[10px] font-bold text-[#B42318] bg-[#F3CFC9] dark:bg-[#3F1414]/60',
    repl: 'text-[10px] font-bold text-[#B42318] bg-[#F3CFC9] dark:text-[#F0A0A0] dark:bg-[#3F1414]/60',
    n: 2,
    why: 'critical chip, 2.30:1 -> lifted ink',
  },
  {
    file: 'src/components/shelter/ShelterManagerView.tsx',
    find: 'text-[10px] font-bold text-[#8A4D06] bg-[#F7E9D6] dark:bg-[#3A2A0A]/60',
    repl: 'text-[10px] font-bold text-[#8A4D06] bg-[#F7E9D6] dark:text-[#F5C77E] dark:bg-[#3A2A0A]/60',
    n: 1,
    why: 'warning chip, 2.05:1 -> lifted ink',
  },
  {
    file: 'src/components/response/ResponsePlanReview.tsx',
    find: "font-data text-xs font-bold text-[#126B34] bg-[#F1F8F3] dark:bg-[#0A2E22]/60",
    repl: "font-data text-xs font-bold text-[#126B34] bg-[#F1F8F3] dark:text-[#6EE7B7] dark:bg-[#0A2E22]/60",
    n: 1,
    why: 'success chip, 2.17:1 -> lifted ink',
  },
  {
    file: 'src/components/auth/USSDSimulator.tsx',
    find: 'text-[11px] bg-[#5BBF7A]/80 text-[#14251F] mb-1',
    repl: 'text-[11px] bg-[#5BBF7A]/80 text-[#14251F] dark:text-[#0F0F0F] mb-1',
    n: 1,
    why: 'USSD key, 4.37:1 -> lifted ink',
  },
];

let ok = 0;
for (const f of FIXES) {
  const src = readFileSync(f.file, 'utf8');
  const n = src.split(f.find).length - 1;
  const expected = f.n ?? 1;
  if (n !== expected) {
    console.log(`  SKIP (${n} matches, expected ${expected}) ${f.file}  ${f.why}`);
    continue;
  }
  if (APPLY) writeFileSync(f.file, src.split(f.find).join(f.repl), 'utf8');
  ok += 1;
  console.log(`  ok  ${f.file.replace(/.*[\\/]src[\\/]/, 'src/')}  x${n}  ${f.why}`);
}
console.log(`\n${ok}/${FIXES.length} ${APPLY ? 'applied' : 'matched — pass --apply'}`);
