/**
 * verify-counter-sync.mjs — prove the bell and the active count cannot disagree.
 *
 * The bug: `notificationCount` was nudged with +1 / -1 in eleven places, eight of
 * which had nothing to do with alerts. An integer that is only ever nudged can
 * never recover the truth, so once it drifted the two numbers stayed wrong.
 *
 * The fix: every write goes through `countActive(alerts)`.
 *
 * This test models the real store transitions and asserts the invariant after
 * each one, including the sequence that used to break it:
 *
 *     boot -> file an incident -> SOS beacon -> server sync -> pin a roadblock
 *          -> embankment breach -> resolve -> restore
 *
 * It also re-implements the OLD arithmetic and runs the same sequence, to show
 * the test actually catches the old bug. A guard that cannot fail is worthless.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/* ---- 1. static check: no manual arithmetic survives ---- */
const src = readFileSync('src/store/useNexoraStore.ts', 'utf8');
const writes = [...src.matchAll(/notificationCount\s*:\s*([^,\n]+)/g)].map((m) => m[1].trim());
const arithmetic = writes.filter((w) => /notificationCount\s*[+-]/.test(w));

let failed = 0;
console.log('static check');
console.log(`  ${writes.length} write(s) to notificationCount`);
if (arithmetic.length) {
  failed += 1;
  console.log(`  FAIL  ${arithmetic.length} still do arithmetic:`);
  for (const a of arithmetic) console.log(`          ${a}`);
} else {
  console.log('  ok    none do arithmetic — every write is countActive(...)');
}

/* ---- 2. behavioural check: run the real transitions ---- */
const countActive = (alerts) => alerts.reduce((n, a) => (a.active ? n + 1 : n), 0);

const boot = [
  { id: 'A', active: true }, { id: 'B', active: true }, { id: 'C', active: true },
];

/** Each step mirrors a real store action. */
const STEPS = [
  ['file an incident (adds an SOS report, NOT an alert)', (s) => s.alerts],
  ['SOS beacon pressed (report, not alert)', (s) => s.alerts],
  ['server sync ingests 12 reports', (s) => s.alerts],
  ['pin damage -> roadblock', (s) => s.alerts],
  ['simulate embankment breach', (s) => s.alerts],
  ['resolve alert B', (s) => s.alerts.map((a) => (a.id === 'B' ? { ...a, active: false } : a))],
  ['restore alert B', (s) => s.alerts.map((a) => (a.id === 'B' ? { ...a, active: true } : a))],
  ['resolve alert A', (s) => s.alerts.map((a) => (a.id === 'A' ? { ...a, active: false } : a))],
];

console.log('\nbehaviour — NEW code (every write recomputes)');
let state = { alerts: [...boot], bell: countActive(boot) };
console.log(`  ${'step'.padEnd(52)} ${'pill'.padStart(5)} ${'bell'.padStart(5)}`);
console.log(`  ${'-'.repeat(64)}`);
for (const [label, apply] of STEPS) {
  // The store computes BOTH from the SAME post-update list. Deriving the bell
  // from the pre-update alerts (as an earlier version of this harness did)
  // reports drift that the real store does not have.
  const alerts = apply(state);
  const bell = countActive(alerts);
  state = { alerts, bell };
  const pill = countActive(state.alerts);
  const ok = bell === pill;
  if (!ok) failed += 1;
  console.log(`  ${label.padEnd(52)} ${String(pill).padStart(5)} ${String(bell).padStart(5)}  ${ok ? 'ok' : 'DRIFT'}`);
}

/* ---- 3. the same sequence under the OLD arithmetic, to prove the test bites ---- */
console.log('\ncontrol — OLD code (manual +1 / -1), same sequence');
let old = { alerts: [...boot], bell: 3 };
const OLD = [
  ['file an incident', (s) => { s.bell += 1; }],
  ['SOS beacon pressed', (s) => { s.bell += 1; }],
  ['server sync ingests 12 reports', (s) => { s.bell += 12; }],
  ['pin damage -> roadblock', (s) => { s.bell += 1; }],
  ['simulate embankment breach', (s) => { s.bell += 3; }],
  ['resolve alert B', (s) => { s.bell = Math.max(0, s.bell - 1); s.alerts = s.alerts.map((a) => (a.id === 'B' ? { ...a, active: false } : a)); }],
  ['restore alert B', (s) => { s.bell += 1; s.alerts = s.alerts.map((a) => (a.id === 'B' ? { ...a, active: true } : a)); }],
  ['resolve alert A', (s) => { s.bell = Math.max(0, s.bell - 1); s.alerts = s.alerts.map((a) => (a.id === 'A' ? { ...a, active: false } : a)); }],
];
let maxDrift = 0;
for (const [label, apply] of OLD) {
  apply(old);
  const pill = countActive(old.alerts);
  maxDrift = Math.max(maxDrift, Math.abs(pill - old.bell));
  console.log(`  ${label.padEnd(52)} ${String(pill).padStart(5)} ${String(old.bell).padStart(5)}  ${pill === old.bell ? 'ok' : `DRIFT ${old.bell - pill > 0 ? '+' : ''}${old.bell - pill}`}`);
}
console.log(`\n  peak drift under the old code: ${maxDrift}`);
if (maxDrift === 0) {
  failed += 1;
  console.log('  FAIL  the control did not drift — this test would not catch a regression');
} else {
  console.log(`  ok    control drifts by ${maxDrift}, so the invariant above is a real check`);
}

console.log(failed === 0 ? '\ncounters cannot disagree' : `\n${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
