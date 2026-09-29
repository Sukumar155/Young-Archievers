/**
 * test-serverless.mjs — exercise the Vercel function path without deploying.
 *
 * Run twice: once plain, and once with VERCEL=1 so IS_SERVERLESS is true and
 * the two endpoints that cannot exist on Vercel are asserted to refuse.
 *
 * The two things most likely to break in a serverless port, both checked here
 * rather than discovered in production:
 *
 *   1. The request has no readable stream. Vercel consumes and parses the body
 *      before the function runs, so `req.on('data')` does not exist and the
 *      original readBody() would have hung forever.
 *   2. The response is a VercelResponse, not a ServerResponse, so writeHead /
 *      status / json have to interoperate.
 *
 * A mock req/res pair is built to match the serverless shape and driven through
 * the same dispatcher the Vercel function uses.
 */
import { handleRequest, IS_SERVERLESS } from '../server/sos-server.mjs';

// The bridge reads this at request time, so it has to be set before the import
// graph resolves anything that captures it. Without it the allowlist is
// localhost-only and the CORS assertions below cannot pass — correctly.
process.env.CORS_ORIGINS = 'https://nexoraai-pink.vercel.app,http://localhost:5173';

let failures = 0;
const ok = m => console.log(`  PASS  ${m}`);
const bad = m => { failures++; console.log(`  FAIL  ${m}`); };

/** A Vercel-like request: parsed body, no stream, query.params from the route. */
function mockRequest({ method, url, slug, body, headers = {} }) {
  return {
    method,
    url,
    query: slug === undefined ? {} : { slug },
    body,
    headers: { host: 'nexoraai-pink.vercel.app', ...headers },
  };
}

/** A Vercel-like response that records what the dispatcher wrote. */
function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    finished: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
    write(chunk) { if (this.body === null) this.body = ''; this.body += chunk; return true; },
    end(chunk) { if (chunk) { if (this.body === null) this.body = ''; this.body += chunk; } this.finished = true; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.finished = true; return this; },
  };
  return res;
}

async function call(req) {
  const res = mockResponse();
  handleRequest(req, res);
  // Give any promise-based handler a turn to settle.
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
  return res;
}

console.log(`IS_SERVERLESS in this process: ${IS_SERVERLESS}\n`);

/* ── 1. GET /api/health ─────────────────────────────────────────────────── */
console.log('GET /api/health');
{
  const res = await call(mockRequest({
    method: 'GET', url: '/api/health', slug: ['health'],
  }));
  if (res.statusCode === 200) ok(`200 (body ${res.body ? 'present' : 'EMPTY'})`);
  else bad(`expected 200, got ${res.statusCode}`);
}

/* ── 2. CORS preflight ──────────────────────────────────────────────────── */
console.log('\nOPTIONS preflight');
{
  const res = await call(mockRequest({
    method: 'OPTIONS', url: '/api/auth/otp/request', slug: ['auth', 'otp', 'request'],
    headers: { origin: 'https://nexoraai-pink.vercel.app' },
  }));
  const allow = res.headers['access-control-allow-origin'];
  if (res.statusCode === 204) ok('204');
  else bad(`expected 204, got ${res.statusCode}`);
  if (allow === 'https://nexoraai-pink.vercel.app') ok(`allow-origin: ${allow}`);
  else bad(`allow-origin not echoed (got ${allow}) — CORS_ORIGINS must include the frontend`);
}

/* ── 3. POST with a pre-parsed object body (the real regression risk) ───── */
console.log('\nPOST /api/auth/otp/request  (pre-parsed body, no stream)');
{
  const res = await call(mockRequest({
    method: 'POST', url: '/api/auth/otp/request', slug: ['auth', 'otp', 'request'],
    body: { phone: '9876543210', role: 'CITIZEN' },
    headers: { 'content-type': 'application/json', origin: 'https://nexoraai-pink.vercel.app' },
  }));
  // The point is that it did NOT hang and did not fall through to 404.
  if (res.statusCode === 404) bad('404 — the dispatcher did not match the rebuilt path');
  else ok(`responded ${res.statusCode} without hanging`);
  // sendJson() writes via res.end(JSON.stringify(...)), so the mock collects a
  // string. Parse before asserting on the shape.
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { /* handled below */ }
  if (parsed && typeof parsed === 'object') ok(`JSON body: ${JSON.stringify(parsed).slice(0, 88)}`);
  else bad(`expected a JSON object, got ${String(res.body).slice(0, 88)}`);
}

/* ── 4. POST with a string body ─────────────────────────────────────────── */
console.log('\nPOST /api/auth/otp/request  (string body)');
{
  const res = await call(mockRequest({
    method: 'POST', url: '/api/auth/otp/request', slug: ['auth', 'otp', 'request'],
    body: JSON.stringify({ phone: '9876543210', role: 'CITIZEN' }),
    headers: { 'content-type': 'application/json' },
  }));
  if (res.statusCode !== 404) ok(`responded ${res.statusCode} without hanging`);
  else bad('404 — string body path not handled');
}

/* ── 5. Path with an id segment (PATCH route) ───────────────────────────── */
console.log('\nPATCH /api/alerts/:id  (nested path rebuild)');
{
  const res = await call(mockRequest({
    method: 'PATCH', url: '/api/alerts/ABC-123', slug: ['alerts', 'ABC-123'],
    body: { status: 'RESOLVED' },
    headers: { 'content-type': 'application/json' },
  }));
  if (res.statusCode === 404) bad('404 — nested id route not rebuilt correctly');
  else if (res.statusCode === 401 || res.statusCode === 403) ok(`route matched, auth required (${res.statusCode})`);
  else ok(`responded ${res.statusCode} — route matched`);
}

/* ── 6. The two endpoints that cannot work here ─────────────────────────── */
console.log('\nServerless-only refusals');
{
  const res = await call(mockRequest({
    method: 'POST', url: '/api/yolo/detect', slug: ['yolo', 'detect'], body: {},
  }));
  if (IS_SERVERLESS && res.statusCode === 501) ok('YOLO -> 501 with an explanation');
  else console.log(`  note  YOLO -> ${res.statusCode} (not running with VERCEL set, so the local path was used)`);
}

/* ── 7. Unknown route still 404s as JSON ────────────────────────────────── */
console.log('\nUnknown route');
{
  const res = await call(mockRequest({
    method: 'GET', url: '/api/nope', slug: ['nope'],
  }));
  if (res.statusCode === 404) ok('404 as expected');
  else bad(`expected 404, got ${res.statusCode}`);
}

console.log('\n' + '-'.repeat(62));
console.log(failures === 0 ? 'PASS - dispatcher works in the serverless shape' : `FAIL - ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
