/**
 * api-smoke.mjs — end-to-end verification of the NEXORA backend.
 *
 *   npm run test:api              # everything except the slow YOLO model
 *   npm run test:api -- --yolo    # include real YOLO inference (~30-90s)
 *   npm run test:api -- --url http://localhost:5173   # test through Vite proxy
 *
 * Exits non-zero if any check fails, so it works in CI.
 * Zero dependencies — node built-ins only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const urlArg = argv.indexOf('--url');
const BASE = (urlArg !== -1 && argv[urlArg + 1]) || process.env.API_BASE || 'http://localhost:3001';

const INCLUDE_YOLO = flag('yolo');

let passed = 0;
let failed = 0;
const failures = [];

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${C.green}PASS${C.reset}  ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ${C.red}FAIL${C.reset}  ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}`);
}

async function call(method, path, { body, token, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */

console.log(`${C.bold}NEXORA backend verification${C.reset}  ${C.dim}${BASE}${C.reset}`);

// ── 1. Reachability ──────────────────────────────────────────────────────────
section('1. Service reachability');
let health = null;
try {
  const r = await call('GET', '/api/health');
  health = r.json;
  check('GET /api/health responds 200', r.status === 200, `status=${r.status}`);
  check('health reports ok:true', health?.ok === true);
  check('health exposes counts', typeof health?.reports === 'number',
    `reports=${health?.reports} alerts=${health?.alerts} incidents=${health?.incidents}`);
} catch (err) {
  check('backend is reachable', false, err.message);
  console.log(`\n${C.red}Backend is not running.${C.reset} Start it with:  ${C.bold}npm run dev:all${C.reset}`);
  process.exit(1);
}

// ── 2. OTP ───────────────────────────────────────────────────────────────────
section('2. SMS OTP flow');
const otpStatus = (await call('GET', '/api/auth/otp/status')).json;
check('GET /api/auth/otp/status', otpStatus?.ok === true,
  `provider=${otpStatus?.provider} devMode=${otpStatus?.devMode}`);

// Use a number that is definitely not on the roster.
const PHONE = '9812345678';

const badReq = await call('POST', '/api/auth/otp/request', { body: { phone: '12345' } });
check('rejects a malformed phone number', badReq.status === 400, `status=${badReq.status}`);

const req = await call('POST', '/api/auth/otp/request', {
  body: { phone: PHONE, role: 'DDMO_OFFICER' },
});
check('issues an OTP', req.status === 200 && req.json?.ok === true);

const code = req.json?.devCode;
if (!code) {
  console.log(`  ${C.yellow}SKIP${C.reset}  cannot complete OTP checks — no dev code.`);
  console.log(`  ${C.dim}A real SMS gateway is configured, so the code was texted.${C.reset}`);
} else {
  const wrong = await call('POST', '/api/auth/otp/verify', { body: { phone: PHONE, code: '000000' } });
  check('rejects a wrong code', wrong.status === 400, `status=${wrong.status}`);
  check('reports remaining attempts', typeof wrong.json?.attemptsLeft === 'number',
    `left=${wrong.json?.attemptsLeft}`);

  const verified = await call('POST', '/api/auth/otp/verify', { body: { phone: PHONE, code } });
  check('accepts the correct code', verified.status === 200 && verified.json?.ok === true);

  const token = verified.json?.token;
  check('returns a session token', typeof token === 'string' && token.length > 32);

  const replay = await call('POST', '/api/auth/otp/verify', { body: { phone: PHONE, code } });
  check('code cannot be replayed', replay.status === 400, `status=${replay.status}`);

  // ── 3. Privilege escalation ────────────────────────────────────────────────
  section('3. Authorisation (the important one)');
  const session = await call('GET', '/api/auth/session', { token });
  check('GET /api/auth/session works with a token', session.status === 200);

  check(
    'role came from the server roster, not the request body',
    session.json?.role === 'CITIZEN',
    `requested DDMO_OFFICER, granted ${session.json?.role}`
  );

  const noAuth = await call('POST', '/api/alerts', { body: { title: 'unauthorised' } });
  check('privileged write without a token is rejected', noAuth.status === 401, `status=${noAuth.status}`);

  const citizenAlert = await call('POST', '/api/alerts', {
    token,
    body: { title: 'citizen should not do this', severity: 'CRITICAL' },
  });
  check('CITIZEN cannot broadcast a CAP alert', citizenAlert.status === 403,
    `status=${citizenAlert.status}`);

  const citizenIncident = await call('POST', '/api/incidents', {
    token,
    body: {
      title: 'Smoke test incident', description: 'automated check',
      lat: 13.0827, lng: 80.2707, locationName: 'Chennai', peopleCount: 2,
      contactPhone: PHONE, needs: ['Water'],
    },
  });
  check('CITIZEN can file an incident', citizenIncident.status === 201,
    `id=${citizenIncident.json?.incident?.id}`);

  const triage = await call('PATCH', '/api/sos/SMOKE-NOT-REAL', {
    token, body: { status: 'FALSE_ALARM' },
  });
  check('CITIZEN cannot triage the SOS queue', triage.status === 403, `status=${triage.status}`);
}

// ── 4. Officer role from the roster ──────────────────────────────────────────
section('4. Roster grants officer roles');
const rosterFile = join(ROOT, 'server', 'officers.json');
if (!existsSync(rosterFile)) {
  check('officers.json exists', false, 'run the backend once to seed it');
} else {
  const roster = JSON.parse(readFileSync(rosterFile, 'utf8'));
  const officer = (roster.officers || []).find((o) => o.role === 'DDMO_OFFICER');
  check('roster contains a DDMO_OFFICER', Boolean(officer));

  if (officer) {
    const digits = String(officer.phone).replace(/\D/g, '').slice(-10);
    const oReq = await call('POST', '/api/auth/otp/request', { body: { phone: digits } });
    const oCode = oReq.json?.devCode;
    if (oCode) {
      const oVer = await call('POST', '/api/auth/otp/verify', { body: { phone: digits, code: oCode } });
      check('roster officer is granted DDMO_OFFICER', oVer.json?.role === 'DDMO_OFFICER',
        `granted ${oVer.json?.role}`);

      const oToken = oVer.json?.token;
      const oAlert = await call('POST', '/api/alerts', {
        token: oToken,
        body: {
          title: 'SMOKE TEST — CAP bulletin', severity: 'SEVERE', zone: 'Test Zone',
          reason: 'Automated verification', recommendedAction: 'None, this is a test',
          channels: ['SMS_GATEWAY'], affectedPopulation: 10, lat: 13.08, lng: 80.27,
        },
      });
      check('DDMO_OFFICER can broadcast a CAP alert', oAlert.status === 201,
        `id=${oAlert.json?.alert?.id}`);

      // Persistence: the alert must still be there on a fresh read.
      const listed = (await call('GET', '/api/alerts?limit=50')).json;
      const found = (listed?.alerts || []).some((a) => a.id === oAlert.json?.alert?.id);
      check('the alert is persisted and readable back', found);
      check('it records who issued it server-side',
        oAlert.json?.alert?.issuedByRole === 'DDMO_OFFICER',
        `issuedByRole=${oAlert.json?.alert?.issuedByRole}`);

      const resolved = await call('PATCH', `/api/alerts/${oAlert.json.alert.id}`, {
        token: oToken, body: { active: false },
      });
      check('DDMO_OFFICER can resolve a bulletin', resolved.status === 200);
    } else {
      console.log(`  ${C.yellow}SKIP${C.reset}  no dev code for the roster officer (SMS gateway active?)`);
    }
  }
}

// ── 5. SOS ───────────────────────────────────────────────────────────────────
section('5. SOS beacon (must work signed-out)');
const beacon = await call('POST', '/api/sos', {
  body: { lat: 13.0827, lng: 80.2707, locationName: 'Smoke Test Marina', peopleCount: 1 },
});
check('anonymous beacon is accepted', beacon.status === 201, `status=${beacon.status}`);
check('beacon records its provenance', beacon.json?.verified === false,
  `verified=${beacon.json?.verified} role=${beacon.json?.reportedByRole}`);

// ── 6. CORS ──────────────────────────────────────────────────────────────────
section('6. CORS is not wide open');
const corsRes = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
const allowOrigin = corsRes.headers.get('access-control-allow-origin');
check('a foreign origin is NOT reflected back', allowOrigin === null || allowOrigin === '',
  `access-control-allow-origin=${allowOrigin ?? '(absent)'}`);

// ── 7. Chat relay ────────────────────────────────────────────────────────────
section('7. AI chat relay');
try {
  const chat = await call('POST', '/api/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('POST /api/chat responds', chat.status === 200 || chat.status === 429 || chat.status === 502,
    `status=${chat.status}${chat.status === 429 ? ' (provider busy)' : ''}`);
} catch (err) {
  check('POST /api/chat responds', false, err.message);
}

// ── 8. YOLO ──────────────────────────────────────────────────────────────────
section('8. YOLO vision');
const weights = ['server/models/fire_smoke.pt', 'server/models/flood.pt'];
const haveWeights = weights.every((w) => existsSync(join(ROOT, w)));
if (!INCLUDE_YOLO) {
  console.log(`  ${C.yellow}SKIP${C.reset}  slow (~30-90s). Re-run with:  npm run test:api -- --yolo`);
} else if (!haveWeights) {
  check('model weights are present', false, `expected ${weights.join(' and ')}`);
} else {
  const img = join(tmpdir(), 'nexora_smoke.jpg');
  try {
    // A tiny valid JPEG is unnecessary; any real image works. Reuse a bundled
    // one if present, else generate via the flood test image path.
    const candidates = [
      'C:/Users/ADMIN/Videos/yolo/flood/test.jpg',
      join(ROOT, 'public', 'mock', 'sos-reports.json'),
    ];
    const src = candidates.find((c) => existsSync(c) && c.endsWith('.jpg'));
    if (!src) {
      console.log(`  ${C.yellow}SKIP${C.reset}  no sample .jpg found to upload`);
    } else {
      const bytes = readFileSync(src);
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'smoke.jpg');
      form.append('model_type', 'flood');
      const res = await fetch(`${BASE}/api/yolo/detect`, { method: 'POST', body: form });
      const out = await res.json().catch(() => null);
      check('POST /api/yolo/detect responds 200', res.status === 200, `status=${res.status}`);
      check('returns a parsed result', out?.ok === true,
        out?.error ? String(out.error).slice(0, 90) : `type=${out?.disaster_type} count=${out?.count}`);
      check('returns an image preview for the overlay', typeof out?.image_preview === 'string'
        && out.image_preview.startsWith('data:image/'));
      if (typeof out?.settings === 'object') {
        console.log(`  ${C.dim}settings: conf=${out.settings.conf} imgsz=${out.settings.imgsz} tta=${out.settings.tta}${C.reset}`);
      }
    }
  } catch (err) {
    check('YOLO inference runs', false, err.message);
  }
}

// ── 9. Rate limiting (LAST — it deliberately trips the limiter, and the
//       60s window would otherwise make the *next* run's beacon test fail) ───
section('9. Rate limiting');
let limited = false;
let firstLimitedAt = -1;
for (let i = 0; i < 16 && !limited; i += 1) {
  const r = await call('POST', '/api/sos', { body: { lat: 13.08, lng: 80.27, locationName: `flood ${i}` } });
  if (r.status === 429) { limited = true; firstLimitedAt = i + 1; }
}
check('SOS beacon flood is rate limited', limited,
  limited ? `429 after ${firstLimitedAt} requests` : 'no 429 within 16 requests');

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${C.bold}${'─'.repeat(52)}${C.reset}`);
if (failed === 0) {
  console.log(`${C.green}${C.bold}  ALL ${total} CHECKS PASSED${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ${failed} of ${total} CHECKS FAILED${C.reset}`);
  for (const f of failures) console.log(`${C.red}    - ${f}${C.reset}`);
}
if (limited) {
  console.log(`${C.yellow}  note: the rate limiter is now tripped for this IP.`);
  console.log(`        Re-run within 60s and the beacon check may 429.${C.reset}`);
}
console.log(`${C.dim}  base: ${BASE}${C.reset}\n`);
process.exit(failed === 0 ? 0 : 1);
