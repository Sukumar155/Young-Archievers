/**
 * Smoke-test the integration path: assemble features the way useFloodRisk does
 * for each district, score them, and report the domain warnings.
 *   node scripts/flood-model-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { loadFloodRiskModel, predictFloodRisk, featuresFromTelemetry } from '../src/services/floodRiskModel.ts';

const model = loadFloodRiskModel(readFileSync('public/models/flood_risk_xgboost.json', 'utf8'));

// Mirrors INITIAL_LIVE_METRICS / STATION-01 in the store.
const liveMetrics = [
  { id: 'water', value: 49.32 },
  { id: 'rain', value: 68 },
  { id: 'wind', value: 41 },
  { id: 'humidity', value: 88 },
  { id: 'temp', value: 29.2 }
];
const STATION_01 = { waterLevelCm: 82, pressureHpa: 997.2 };

const SITES = {
  'Kamrup Metro (Guwahati Basin)': { latitude: 26.178, longitude: 91.702, elevationM: 50, riverDischargeM3s: 9200, historicalFloods: 4, populationDensityPerKm2: 1800 },
  'Cuddalore Coastal Delta': { latitude: 11.435, longitude: 79.783, elevationM: 5, riverDischargeM3s: 210, historicalFloods: 6, populationDensityPerKm2: 4500 },
  'Kochi Backwaters Sector': { latitude: 9.931, longitude: 76.267, elevationM: 2, riverDischargeM3s: 165, historicalFloods: 7, populationDensityPerKm2: 6000 },
  'Patna Ganga Floodplain': { latitude: 25.594, longitude: 85.137, elevationM: 52, riverDischargeM3s: 2600, historicalFloods: 5, populationDensityPerKm2: 4000 }
};

console.log('district                        risk      conf    in-domain?');
console.log('-'.repeat(70));
for (const [name, site] of Object.entries(SITES)) {
  const f = featuresFromTelemetry({
    metrics: liveMetrics,
    waterLevelCm: STATION_01.waterLevelCm,
    pressureHpa: STATION_01.pressureHpa,
    ...site
  });
  const p = predictFloodRisk(f, model);
  console.log(
    name.padEnd(30),
    p.risk.padEnd(9),
    `${(p.confidence * 100).toFixed(1)}%`.padStart(6),
    p.outOfDomain ? 'NO  (' + p.warnings.length + ' warn)' : 'yes'
  );
  for (const w of p.warnings) console.log('      - ' + w);
}

// Timing: this runs on every 5s telemetry tick, so measure it.
const f = featuresFromTelemetry({ metrics: liveMetrics, waterLevelCm: 82, pressureHpa: 997.2, ...SITES['Kamrup Metro (Guwahati Basin)'] });
const t0 = performance.now();
const N = 200;
for (let i = 0; i < N; i++) predictFloodRisk(f, model);
const ms = (performance.now() - t0) / N;
console.log(`\nscoring cost: ${ms.toFixed(3)} ms per prediction (${N} runs)`);
