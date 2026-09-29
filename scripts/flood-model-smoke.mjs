/**
 * Smoke-test the integration path: assemble features the way useFloodRisk does
 * for each district, score them, and report the domain warnings.
 *   node scripts/flood-model-smoke.mjs
 *
 * NOTE: the district list must mirror DISTRICT_SITES in
 * src/store/useNexoraStore.ts. It previously still contained Guwahati and
 * Patna — both far outside the model's trained domain (lat 8.24-13.68), so the
 * smoke test confidently reported 100% on saturated, meaningless output while
 * claiming to be a health check. Out-of-domain cases are now kept in a clearly
 * separated section so the guard rail itself stays tested.
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

// Must match DISTRICT_SITES in the store — all inside the trained domain.
const SITES = {
  'Chennai Coastal Metropolitan Area': { latitude: 13.0827, longitude: 80.2707, elevationM: 8, riverDischargeM3s: 120, historicalFloods: 6, populationDensityPerKm2: 17000 },
  'Cuddalore Coastal Delta': { latitude: 11.435, longitude: 79.783, elevationM: 5, riverDischargeM3s: 210, historicalFloods: 6, populationDensityPerKm2: 4500 },
  'Kochi Backwaters Sector': { latitude: 9.931, longitude: 76.267, elevationM: 2, riverDischargeM3s: 165, historicalFloods: 7, populationDensityPerKm2: 6000 }
};

// Deliberately out-of-domain, to prove the warning path still works.
const OUT_OF_DOMAIN = {
  'Guwahati (out of domain)': { latitude: 26.178, longitude: 91.702, elevationM: 50, riverDischargeM3s: 9200, historicalFloods: 4, populationDensityPerKm2: 1800 }
};

function report(label, sites) {
  console.log(label);
  console.log('-'.repeat(70));
  for (const [name, site] of Object.entries(sites)) {
    const f = featuresFromTelemetry({
      metrics: liveMetrics,
      waterLevelCm: STATION_01.waterLevelCm,
      pressureHpa: STATION_01.pressureHpa,
      ...site
    });
    const p = predictFloodRisk(f, model);
    console.log(
      name.padEnd(38),
      p.risk.padEnd(9),
      `${(p.confidence * 100).toFixed(1)}%`.padStart(6),
      p.outOfDomain ? `OUT OF DOMAIN (${p.warnings.length} warn)` : 'in domain'
    );
    for (const w of p.warnings) console.log('      - ' + w);
  }
  console.log('');
}

report('IN-DOMAIN districts (these are the ones the app actually uses)', SITES);
report('OUT-OF-DOMAIN guard-rail check (must warn, must not be trusted)', OUT_OF_DOMAIN);

// Timing: this runs on every 5s telemetry tick, so measure it.
const f = featuresFromTelemetry({ metrics: liveMetrics, waterLevelCm: 82, pressureHpa: 997.2, ...SITES['Chennai Coastal Metropolitan Area'] });
const t0 = performance.now();
const N = 200;
for (let i = 0; i < N; i++) predictFloodRisk(f, model);
const ms = (performance.now() - t0) / N;
console.log(`scoring cost: ${ms.toFixed(3)} ms per prediction (${N} runs)`);
