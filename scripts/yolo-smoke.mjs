/**
 * yolo-smoke.mjs — end-to-end check of POST /api/yolo/detect.
 *
 * Builds a real multipart body (PowerShell can't do binary multipart cleanly)
 * and prints the verdict split so it is obvious which boxes drove the disaster
 * call and which are context only.
 *
 * Usage: node scripts/yolo-smoke.mjs [image] [model_type] [include_context]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const img = process.argv[2] || resolve(ROOT, 'public/drone_flood_survey.jpg');
const modelType = process.argv[3] || 'auto';
const includeContext = process.argv[4] ?? '1';
const port = process.env.NEXORA_PORT || 5173;

const B = '----nexoraYoloSmoke7f3a';
const CRLF = '\r\n';
const head = (name, value) =>
  `--${B}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;

// Byte-accurate assembly: the image must not be re-encoded through a string.
const body = Buffer.concat([
  Buffer.from(head('model_type', modelType), 'utf8'),
  Buffer.from(head('include_context', includeContext), 'utf8'),
  Buffer.from(
    `--${B}${CRLF}Content-Disposition: form-data; name="file"; filename="${img.split(/[\\/]/).pop()}"` +
    `${CRLF}Content-Type: image/jpeg${CRLF}${CRLF}`,
    'utf8'
  ),
  readFileSync(img),
  Buffer.from(`${CRLF}--${B}--${CRLF}`, 'utf8'),
]);

const res = await fetch(`http://localhost:${port}/api/yolo/detect`, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${B}` },
  body,
});
const j = await res.json();

console.log(`HTTP ${res.status}`);
if (!j.ok) {
  console.error('FAILED:', j.error);
  process.exit(1);
}

console.log(`verdict      : ${j.disaster_type}`);
console.log(`models_ran   : ${(j.models_ran || []).join(', ')}`);
console.log(`total boxes  : ${j.count}`);
console.log(`settings     : ${JSON.stringify(j.settings)}`);
if (j.warnings?.length) console.log(`warnings     : ${j.warnings.join(' | ')}`);

const dis = j.detections.filter((d) => !d.non_disaster);
const ctx = j.detections.filter((d) => d.is_context);
const civic = j.detections.filter((d) => d.non_disaster && !d.is_context);

console.log(`\n--- DISASTER EVIDENCE (${dis.length}) — these decide the verdict ---`);
for (const d of dis) {
  console.log(`  ${d.label.padEnd(18)} ${String(d.confidence).padStart(5)}%  [${d.model}]`);
}
if (!dis.length) console.log('  (none above threshold)');

const group = (rows) => {
  const m = new Map();
  for (const d of rows) {
    const e = m.get(d.label) || { n: 0, best: 0 };
    e.n++; e.best = Math.max(e.best, d.confidence);
    m.set(d.label, e);
  }
  return m;
};

console.log(`\n--- CONTEXT (${ctx.length}) — COCO pass, verdict unaffected ---`);
for (const [label, e] of group(ctx)) {
  console.log(`  ${label.padEnd(18)} x${e.n}  best ${e.best}%`);
}
if (!ctx.length) console.log('  (none)');

console.log(`\n--- CIVIC CLASSES BUNDLED IN flood.pt (${civic.length}) — real, not disasters ---`);
for (const [label, e] of group(civic)) {
  console.log(`  ${label.padEnd(18)} x${e.n}  best ${e.best}%`);
}
if (!civic.length) console.log('  (none)');

console.log('\n--- MANIFEST (read off the live weights) ---');
for (const [name, m] of Object.entries(j.models || {})) {
  console.log(`  ${name.padEnd(11)} [${m.role}] ${m.reported_classes.join(', ')}`);
}
