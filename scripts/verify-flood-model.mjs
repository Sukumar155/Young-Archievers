/**
 * Verify the pure-JS flood-risk predictor against real XGBoost output.
 *
 *   python scripts/flood_model_reference.py > ref.json
 *   node scripts/verify-flood-model.mjs ref.json
 *
 * Compares, per case: predicted class (must match exactly) and per-class
 * margins + softmax probabilities (must match within a tight tolerance).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFloodRiskModel, predictFloodRisk } from '../src/services/floodRiskModel.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Prefer the in-repo model so a clean clone works out of the box. Previously
// this pointed at a hardcoded C:/Users/ADMIN/... path that exists nowhere else.
const MODEL = process.env.FLOOD_MODEL || 'public/models/flood_risk_xgboost.json';
const REF = process.argv[2];

if (!REF) {
  console.error('usage: node scripts/verify-flood-model.mjs <reference.json>');
  process.exit(1);
}

// Class agreement must be exact; float drift is tolerance-checked.
const CLASS_TOL = 0;          // exact integer match
const MARGIN_TOL = 1e-4;      // logit units
const PROBA_TOL = 1e-5;

const model = loadFloodRiskModel(readFileSync(MODEL, 'utf8'));
const cases = JSON.parse(readFileSync(REF, 'utf8'));

const LABELS = ['LOW', 'MODERATE', 'HIGH'];
let classFail = 0, marginFail = 0, probaFail = 0;
let worstMargin = 0, worstProba = 0;

console.log(
  'case'.padEnd(26),
  'py class'.padStart(8),
  'js class'.padStart(8),
  'ok'.padStart(4),
  '  max|dMargin|'.padStart(14),
  'max|dProba|'.padStart(12)
);
console.log('-'.repeat(78));

for (const c of cases) {
  const js = predictFloodRisk(c.features, model);

  // Python's `proba` field holds the class index for a multi:softmax model.
  const pyClass = c.class;
  const classOk = js.classIndex === pyClass;
  if (!classOk) classFail++;

  let dm = 0, dp = 0;
  for (let i = 0; i < 3; i++) {
    dm = Math.max(dm, Math.abs(js.margins[LABELS[i]] - c.margin[i]));
    dp = Math.max(dp, Math.abs(js.probabilities[LABELS[i]] - softmax(c.margin)[i]));
  }
  if (dm > MARGIN_TOL) marginFail++;
  if (dp > PROBA_TOL) probaFail++;
  worstMargin = Math.max(worstMargin, dm);
  worstProba = Math.max(worstProba, dp);

  console.log(
    String(c.name).padEnd(26),
    `${pyClass}`.padStart(8),
    `${js.classIndex}`.padStart(8),
    (classOk ? ' ok' : 'FAIL').padStart(4),
    dm.toExponential(2).padStart(14),
    dp.toExponential(2).padStart(12)
  );
}

function softmax(m) {
  const max = Math.max(...m);
  const e = m.map((v) => Math.exp(v - max));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

console.log('-'.repeat(78));
console.log(`cases: ${cases.length}`);
console.log(`class mismatches : ${classFail}  (tolerance: exact)`);
console.log(`margin failures  : ${marginFail}  (tol ${MARGIN_TOL})   worst ${worstMargin.toExponential(2)}`);
console.log(`proba failures   : ${probaFail}  (tol ${PROBA_TOL})  worst ${worstProba.toExponential(2)}`);

const ok = classFail === 0 && marginFail === 0 && probaFail === 0;
console.log(ok ? '\nPARITY CONFIRMED — JS predictor matches XGBoost.' : '\nPARITY FAILED');
process.exit(ok ? 0 : 1);
