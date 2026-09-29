/**
 * verify-chip-contrast.mjs — re-measure every chip in BOTH themes.
 *
 * Composites the way a browser will — the `dark:bg` colour at its stated alpha
 * over the surface behind it — then computes the WCAG 2.1 contrast ratio.
 * AA needs 4.5:1 for body text; these chips are 9-11px bold, so 4.5:1 applies.
 *
 * Both themes are checked, because the fix must not damage the light one: the
 * light chip keeps its original dark ink, and only `dark:` overrides were added.
 */
import { readFileSync } from 'node:fs';

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg, bg, alpha) => {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const mix = (s) => {
    const fc = (f >> s) & 255;
    const bc = (b >> s) & 255;
    return Math.round(fc * alpha + bc * (1 - alpha));
  };
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`;
};

/* file, line, light text, light bg, dark text, dark bg, dark alpha */
const CHIPS = [
  ['ShelterManagerView', 185, '#B42318', '#F3CFC9', '#F0A0A0', '#3F1414', 0.60],
  ['ShelterManagerView', 223, '#8A4D06', '#F7E9D6', '#F5C77E', '#3A2A0A', 0.60],
  ['ShelterManagerView', 260, '#B42318', '#F3CFC9', '#F0A0A0', '#3F1414', 0.60],
  ['ResponsePlanReview', 106, '#126B34', '#F1F8F3', '#6EE7B7', '#0A2E22', 0.60],
  ['USSDSimulator', 121, '#14251F', '#5BBF7A', '#14251F', '#5BBF7A', 0.80],
  ['USSDSimulator', 125, '#14251F', '#5BBF7A', '#0F0F0F', '#5BBF7A', 0.70],
  ['USSDSimulator', 146, '#241B0B', '#D9A03A', '#241B0B', '#D9A03A', 1.00],
  ['USSDSimulator', 150, '#14251F', '#7CC99A', '#14251F', '#7CC99A', 1.00],
  ['USSDSimulator', 169, '#14251F', '#7CC99A', '#14251F', '#7CC99A', 1.00],
  ['USSDSimulator', 198, '#241B0B', '#D9A03A', '#241B0B', '#D9A03A', 1.00],
  ['USSDSimulator', 204, '#14251F', '#7CC99A', '#14251F', '#7CC99A', 1.00],
  ['USSDSimulator', 105, '#14251F', '#5BBF7A', '#14251F', '#5BBF7A', 0.80],
];

const DARK_CARD = '#2F2F2F';
let fails = 0;

console.log('LIGHT theme  (chip on light canvas)          DARK theme  (chip over dark card)');
console.log(`  ${'site'.padEnd(22)} ${'ratio'.padStart(7)}        ${'ratio'.padStart(7)}`);
console.log(`  ${'-'.repeat(48)}`);

for (const [site, line, lt, lbg, dt, dbg, a] of CHIPS) {
  const lr = ratio(lt, lbg);
  const eff = over(dbg, DARK_CARD, a);
  const dr = ratio(dt, eff);
  const lok = lr >= 4.5;
  const dok = dr >= 4.5;
  if (!lok || !dok) fails += 1;
  console.log(
    `  ${`${site}:${line}`.padEnd(22)} ${`${lr.toFixed(2)}:1`.padStart(7)} ${lok ? 'ok  ' : 'FAIL'}   ${`${dr.toFixed(2)}:1`.padStart(7)} ${dok ? 'ok' : 'FAIL'}`
  );
}

console.log(`\n${CHIPS.length * 2 - fails * 2}/${CHIPS.length * 2} measurements meet AA (4.5:1)`);
process.exit(fails === 0 ? 0 : 1);
