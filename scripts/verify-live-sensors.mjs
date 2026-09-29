/**
 * verify-live-sensors.mjs — behavioural test for the live sensor feed.
 *
 * Runs the REAL store (via the TypeScript resolver hook) rather than a
 * reimplementation, so it proves the things that actually matter here:
 *
 *   1. The air-pollution metric exists and is a real member of the feed.
 *   2. It actually MOVES on the 5s tick, and it stays inside min/max.
 *   3. Every metric has a volatility and an icon, so none of them silently
 *      falls back to a 1-step default or a placeholder glyph.
 *   4. The strip's column map covers the current metric count.
 *   5. The flood model's feature vector is unchanged by the addition — it
 *      picks metrics by id, so an extra id must not leak in.
 *
 * Usage:  node scripts/verify-live-sensors.mjs
 *
 * Loads the store through Vite's SSR transform rather than the repo's
 * scripts/register-ts.mjs hook: that hook does not elide type-only imports, so
 * `import { SOSReport, AssistanceNeed } from '../types/sos'` dies at runtime on
 * a type that only exists in the type system. Vite's esbuild pass handles it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

// ── 1. the real store ────────────────────────────────────────────────────────
const vite = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom'
});

let useNexoraStore;
try {
  ({ useNexoraStore } = await vite.ssrLoadModule('/src/store/useNexoraStore.ts'));
} finally {
  await vite.close();
}

const initial = useNexoraStore.getState().liveSensorMetrics;
const aqi = initial.find(m => m.id === 'aqi');

console.log('air pollution metric');
if (!aqi) {
  bad("no metric with id 'aqi' in liveSensorMetrics");
} else {
  ok(`id=aqi label="${aqi.label}" value=${aqi.value}${aqi.unit} ` +
     `range=[${aqi.min}, ${aqi.max}] dangerAt=${aqi.dangerAt}`);
}
ok(`${initial.length} metrics in the strip: ${initial.map(m => m.id).join(', ')}`);

// ── 2. it moves on the tick ──────────────────────────────────────────────────
console.log('\n5s tick behaviour');
const TICKS = 24; // two minutes of feed
const seen = { aqi: new Set(), water: new Set() };
let outOfRange = 0;

for (let i = 0; i < TICKS; i++) {
  useNexoraStore.getState().sensorTick();
  for (const m of useNexoraStore.getState().liveSensorMetrics) {
    if (m.value < m.min || m.value > m.max) outOfRange++;
    seen[m.id]?.add(m.value);
  }
}

const aqiMoves = seen.aqi.size;
if (aqiMoves > 1) ok(`aqi changed across ${TICKS} ticks (${aqiMoves} distinct values)`);
else bad(`aqi never changed across ${TICKS} ticks — it is not on the feed`);

for (const [id, vals] of Object.entries(seen)) {
  const spread = Math.max(...vals) - Math.min(...vals);
  console.log(`        ${id.padEnd(8)} ${vals.size} distinct, spread ${spread.toFixed(2)}`);
}
if (outOfRange === 0) ok('every reading stayed within its min/max bound');
else bad(`${outOfRange} reading(s) escaped min/max`);

// Deltas must be numeric so the trend arrow has something to render.
const post = useNexoraStore.getState().liveSensorMetrics;
const badDelta = post.filter(m => !Number.isFinite(m.delta) || !Number.isFinite(m.value));
if (badDelta.length === 0) ok('all values and deltas are finite numbers');
else bad(`${badDelta.length} metric(s) produced a non-finite value/delta`);

// ── 3. no metric is missing wiring ───────────────────────────────────────────
console.log('\nwiring');
const strip = readFileSync(join(ROOT, 'src/components/shared/LiveSensorStrip.tsx'), 'utf8');
const store = readFileSync(join(ROOT, 'src/store/useNexoraStore.ts'), 'utf8');

for (const m of initial) {
  const vol = new RegExp(`\\b${m.id}:\\s*[\\d.]+`).test(store);
  const icon = new RegExp(`\\b${m.id}:\\s*[A-Z]`).test(strip);
  if (vol && icon) ok(`${m.id.padEnd(8)} has volatility + icon`);
  else bad(`${m.id.padEnd(8)} missing volatility=${vol} icon=${icon}`);
}

// ── 4. the column map covers the count ───────────────────────────────────────
const has6 = /^\s*6:\s*\{/m.test(strip);
if (initial.length === 6 && has6) ok('GRID_BY_COUNT has an entry for 6 metrics');
else bad(`GRID_BY_COUNT 6-col entry present=${has6} (metric count=${initial.length})`);

// ── 5. the flood model is untouched ──────────────────────────────────────────
console.log('\nflood model feature vector');
const model = readFileSync(join(ROOT, 'src/services/floodRiskModel.ts'), 'utf8');
const picked = [...model.matchAll(/pick\('([^']+)'/g)].map(m => m[1]);
const consumed = initial.filter(m => picked.includes(m.id)).map(m => m.id);
ok(`model consumes: ${consumed.join(', ')}`);
if (consumed.includes('aqi')) bad('aqi leaked into the flood feature vector');
else ok('aqi correctly ignored by the flood model (looked up by id)');

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS — all checks green' : `FAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
