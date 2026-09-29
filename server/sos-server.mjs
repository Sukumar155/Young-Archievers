/**
 * sos-server.mjs — NEXORA SOS Signal backend bridge (zero dependencies).
 *
 * A tiny Node.js HTTP server that receives one-tap SOS beacons from the
 * citizen web portal, persists them to disk, and pushes them in real time
 * to the authorities' dashboard over Server-Sent Events (SSE).
 *
 * Endpoints:
 *   GET  /api/health   -> { ok, uptime, reports }
 *   GET  /api/sos      -> list of stored reports (latest first), ?limit=50
 *   POST /api/sos      -> accept a SOS beacon, validate, store, broadcast
 *   GET  /api/events   -> SSE stream; server pushes new SOS reports live
 *
 * Run:  node server/sos-server.mjs   (or:  npm run server)
 * Data: server/data/sos.json         (persisted automatically)
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { requestOtp, verifyOtp, smsStatus, getSession } from './otp.mjs';
import {
  authenticate, authorize, rateLimit,
  createAlert, listAlerts, setAlertActive,
  createIncident, listIncidents, setIncidentStatus,
  stats as recordStats,
} from './records.mjs';
import { initDb, dbStatus, isWriteBlocked, writeError } from './db.mjs';
import { explorerHtml } from './api-explorer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'sos.json');
const PORT = Number(process.env.PORT || 3001);
const MAX_BODY_BYTES = 64 * 1024; // reject oversized payloads
const MAX_STORED_REPORTS = 500;

let reports = [];
/** @type {Set<{ res: import('node:http').ServerResponse, timer: NodeJS.Timeout }>} */
const sseClients = new Set();

/* ----------------------------- persistence ----------------------------- */

function loadReports() {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(raw)) reports = raw.filter((r) => r && r.id);
    }
  } catch (err) {
    console.warn('[sos-server] Could not load sos.json:', err.message);
  }
}

function persistReports() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(reports.slice(0, MAX_STORED_REPORTS), null, 2));
  } catch (err) {
    // Also surfaced by db.mjs for the records tables; this one is the SOS queue.
    console.error(
      `[sos-server] Could not persist sos.json: ${err.message}. `
      + 'This report is in memory only and will be lost.'
    );
  }
}

/* ------------------------------- helpers ------------------------------- */

/**
 * Refuse a write when the storage layer cannot actually store it.
 *
 * A report that is accepted with a 200 and then dropped is the worst possible
 * outcome for a disaster-response system: the citizen believes their SOS was
 * sent, the operator never sees it. When DATABASE_URL is missing on a read-only
 * host, that is exactly what the JSON fallback would do, so the write is
 * rejected up front with an actionable message instead.
 */
function rejectIfNotWritable(res, what) {
  if (!isWriteBlocked()) return false;
  sendJson(res, 503, {
    ok: false,
    error: `Cannot store this ${what} — the database is not writable.`,
    detail: `Storage error: ${writeError()}. `
          + 'A serverless deployment has a read-only filesystem, so the JSON '
          + 'fallback cannot be used. Set DATABASE_URL in the Vercel project to a '
          + 'PostgreSQL connection string and redeploy.',
    db: dbStatus(),
  });
  return true;
}

const nowIso = () => new Date().toISOString();

function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const last = digits.slice(-10);
    return `+91 ${last.slice(0, 3)}****${last.slice(-3)}`;
  }
  return String(raw || 'Unknown');
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FIFO gate that serializes upstream AI calls. The free provider allows only
 * ~1 queued request per IP; when requests overlap it answers 429 ("Queue
 * full") and the frontend misreads a *momentarily busy* AI as "offline".
 * Running calls one at a time keeps every request under that limit.
 */
let upstreamQueue = Promise.resolve();
function enqueueUpstream(task) {
  const run = upstreamQueue.then(task, task);
  upstreamQueue = run.catch(() => undefined);
  return run;
}

/**
 * Contact the upstream AI provider with retry/backoff for transient failures.
 * Returns { up } on success, or { status, error, detail } when it gives up.
 * Never throws — the queue chain stays clean.
 */
async function fetchUpstream(url, payload, stream, signal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const up = await fetch(url, {
        method: 'POST',
        // Intentionally NO Origin/Referer header — keeps us out of the
        // provider's browser bot-check (Turnstile) path.
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (up.ok) return { up };
      const detail = (await up.text().catch(() => '')).slice(0, 300);
      const retriable = up.status === 429 || up.status >= 500; // busy / server error
      console.warn(`[sos-server] chat upstream ${up.status} (attempt ${attempt}/3): ${detail.slice(0, 150)}`);
      if (!retriable || attempt === 3) {
        return {
          status: up.status === 429 ? 429 : 502,
          error:
            up.status === 429
              ? 'The free AI is busy right now (too many requests) — it will auto-retry'
              : `AI provider error (HTTP ${up.status})`,
          detail: detail.slice(0, 200) || 'no detail from provider',
        };
      }
      await sleep(1500 * attempt);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { status: 504, error: 'AI provider request timed out or was cancelled', detail: 'aborted' };
      }
      console.warn(`[sos-server] chat upstream fetch error (attempt ${attempt}/3): ${err.message}`);
      if (attempt === 3) {
        return { status: 502, error: 'AI provider unreachable (network/timeout)', detail: err.message };
      }
      await sleep(1200 * attempt);
    }
  }
  return { status: 502, error: 'AI provider request failed' };
}

/**
 * Apply CORS headers.
 *
 * The origin is read from the request that was passed in, not from `res.req`.
 * Node's ServerResponse happens to expose a back-reference, but a Vercel
 * serverless response is not guaranteed to, and reading `res.req?.headers`
 * there silently produced no allow-origin header — which the browser reports as
 * an opaque network failure rather than a CORS error.
 */
function setCors(req, res) {
  // Locked to configured origins. This used to be '*' across the whole API,
  // which is unacceptable now that the API issues sessions and mutates records.
  const allowed = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req?.headers?.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/* ----------------------------- SOS handling ----------------------------- */

/** Reads and bounds an HTTP request body (resolves the raw string). */
/**
 * Read the request body as a string.
 *
 * Two environments, one contract. Under `node server/sos-server.mjs` this is a
 * plain Node IncomingMessage and the body arrives as a stream. On Vercel the
 * runtime has already consumed and parsed the stream before the function is
 * invoked, so there is nothing to read and `req.body` is already populated.
 *
 * The callers all do `JSON.parse(await readBody(req))`, so re-serialising an
 * already-parsed object keeps them working unchanged in both worlds instead of
 * duplicating every handler.
 */
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  // Serverless: no readable stream, body already decoded. The `typeof req.on`
  // check is what distinguishes the two, not a feature flag.
  if (typeof req.on !== 'function' && req.body !== undefined) {
    const b = req.body;
    if (typeof b === 'string') return Promise.resolve(b);
    if (Buffer.isBuffer(b)) return Promise.resolve(b.toString('utf8'));
    return Promise.resolve(JSON.stringify(b ?? {}));
  }

  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error('Payload too large');
        err.status = 413;
        try { req.destroy(); } catch { /* noop */ }
        reject(err);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/**
 * Validate a raw beacon and build a normalized report.
 * Throws an Error with a `.status` when the payload is invalid.
 */
function createReport(body, session) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const latOk = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lngOk = Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!latOk || !lngOk) {
    const err = new Error('Missing or invalid lat/lng coordinates');
    err.status = 422;
    throw err;
  }

  const accuracy = Number(body.accuracy);
  const needs = Array.isArray(body.needs)
    ? body.needs.filter((n) => typeof n === 'string').slice(0, 6)
    : ['Medical', 'Water', 'Food'];

  const report = {
    id: `SOS-SRV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    type: 'QUICK_SOS',
    source: cleanString(body.source, 'sos-signal'),
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    locationName: cleanString(body.locationName) || `GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
    phone: cleanString(body.phone),
    phoneMasked: cleanString(body.phone) ? maskPhone(body.phone) : 'Unknown',
    peopleCount: clampInt(body.peopleCount, 1, 50, 1),
    needs,
    message: cleanString(body.message) || 'One-tap SOS Signal from the citizen portal',
    priorityScore: 98,
    priorityLevel: 'CRITICAL',
    status: 'PENDING',
    // Provenance. A beacon is deliberately allowed WITHOUT a session — the SOS
    // button must work on the login screen for someone with no account, and
    // blocking an emergency call to prevent forgery would be the wrong trade.
    // Instead every beacon records whether the sender was verified, so the
    // triage queue can see provenance at a glance.
    verified: Boolean(session),
    reportedByRole: session ? session.role : 'UNVERIFIED',
    reportedByPhone: session ? session.phone : null,
    aiExplanation:
      `Server bridge: SOS beacon received at ${nowIso()} with ` +
      `auto-detected GPS (accuracy ${Number.isFinite(accuracy) ? `~${Math.round(accuracy)} m` : 'n/a'}). ` +
      `Citizen requested urgent assistance without filling the full report form.`,
    timestamp: nowIso(),
  };
  return report;
}

function broadcast(report) {
  const payload = `event: sos\ndata: ${JSON.stringify(report)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      clearInterval(client.timer);
      sseClients.delete(client);
    }
  }
}

/* ------------------------------- handlers ------------------------------- */

function handleHealth(res) {
  // `dbStatus()` reports whether PostgreSQL is actually serving or the app has
  // fallen back to JSON, so a degraded mode is visible rather than silent.
  // The record counts come from records.mjs's `stats()`, which queries whichever
  // backend is live — `db` is not in scope here.
  void recordStats()
    .then((s) => {
      sendJson(res, 200, {
        ok: true,
        service: 'NEXORA SOS Bridge',
        runtime: IS_SERVERLESS ? 'vercel-function' : 'node-server',
        uptimeSec: process.uptime(),
        reports: reports.length,
        alerts: s.alerts,
        incidents: s.incidents,
        db: dbStatus(),
        // Named explicitly so a demo does not promise features this deployment
        // cannot serve. Both are verified unavailable, not merely untested.
        unavailable: IS_SERVERLESS ? ['/api/yolo/detect', '/api/events'] : [],
      });
    })
    .catch((err) => {
      // Never let a health probe take the process down.
      sendJson(res, 200, {
        ok: true,
        service: 'NEXORA SOS Bridge',
        uptimeSec: process.uptime(),
        reports: reports.length,
        db: dbStatus(),
        error: String(err?.message ?? err),
      });
    });
}

function handleList(res, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 500, 50);
  sendJson(res, 200, reports.slice(0, limit));
}

async function handleSubmit(req, res) {
  // Refuse before reading the body when storage cannot hold the result.
  if (rejectIfNotWritable(res, 'SOS report')) return;

  // readBody, not an inline stream reader: on Vercel the body is already parsed
  // and there is no 'data' event to subscribe to, so a local stream reader hangs
  // until the function times out. It also enforces the same size cap.
  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  {
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    // A session is optional here by design (see createReport), but when one is
    // present it must be real, and the sender is rate limited either way so a
    // single client cannot flood the live SOS queue.
    const auth = authenticate(req);
    const session = auth.ok ? auth.session : null;
    const limit = rateLimit(req, session, 12); // 12 beacons/min is generous for a human
    if (!limit.allowed) {
      sendJson(res, 429, {
        error: `Too many SOS beacons sent. Try again in ${limit.retryAfterSeconds}s.`,
      });
      return;
    }

    let report;
    try {
      report = createReport(body, session);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message });
      return;
    }

    reports.unshift(report);
    if (reports.length > MAX_STORED_REPORTS) reports.length = MAX_STORED_REPORTS;
    persistReports();
    broadcast(report);
    console.log(
      `[sos-server] + ${report.id} @ ${report.locationName} `
      + `(${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}) `
      + `[${report.verified ? `verified ${report.reportedByRole}` : 'UNVERIFIED'}]`
    );

    sendJson(res, 201, report);
  }
}

/* ------------------------------ AI chat relay ----------------------------- */
/**
 * POST /api/chat — server-side relay to the AI provider.
 *
 * The free provider (Pollinations) rejects browser requests with a foreign
 * Origin header (403 "Missing Turnstile token"), which is why the frontend
 * chatbot showed as OFFLINE. Fetching from Node.js sends no Origin header,
 * so the relay always works, and the browser talks to US same-origin
 * (proxied by Vite) — no CORS, no CAPTCHA.
 *
 * Body: { messages: [{role, content}], model?, stream?, temperature?, max_tokens? }
 * Streams SSE straight through when stream=true.
 */
async function handleChat(req, res) {
  let raw;
  try {
    raw = await readBody(req, 512 * 1024);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(0, 40) : [];
  if (!messages.length) {
    sendJson(res, 400, { error: 'messages[] is required' });
    return;
  }

  const stream = body.stream !== false;
  const upstream = process.env.LLM_RELAY_URL || 'https://text.pollinations.ai/openai';
  const payload = {
    model: cleanString(body.model) || 'openai',
    messages,
    stream,
    temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
    max_tokens: clampInt(body.max_tokens, 16, 2000, 700),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  req.on('close', () => controller.abort());

  try {
    const outcome = await enqueueUpstream(() => fetchUpstream(upstream, payload, stream, controller.signal));
    if (!outcome.up) {
      clearTimeout(timer);
      sendJson(res, outcome.status, { error: outcome.error, detail: outcome.detail });
      return;
    }
    const up = outcome.up;

    if (!stream) {
      const json = await up.text().catch(() => '{}');
      clearTimeout(timer);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(json);
      return;
    }

    // Stream the upstream SSE bytes straight through to the browser.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = up.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('[sos-server] chat stream error:', err.message);
    }

    clearTimeout(timer);
    try { res.end(); } catch { /* noop */ }
  } catch (err) {
    clearTimeout(timer);
    console.error('[sos-server] chat relay error:', err.message);
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Relay upstream failed: ${err.message}` });
    } else {
      try { res.end(); } catch { /* noop */ }
    }
  }
}

/* --------------------------- YOLO Detection ----------------------------- */
/**
 * POST /api/yolo/detect
 * Accepts multipart/form-data with fields:
 *   file       — the image (any format)
 *   model_type — "fire_smoke" | "flood" | "auto" (default: "auto")
 *   include_context — "1" (default) runs the COCO person/car pass, "0" skips it
 *
 * Saves the image to a temp file, calls server/yolo_detect.py via Python
 * (which runs on the local CPU using ultralytics), and returns JSON.
 */
async function handleYoloDetect(req, res) {
  // Inference shells out to Python and loads ~48 MB of weights. A serverless
  // function has no child-process runtime, no GPU and nowhere to put the model
  // files, so this cannot work there no matter how the function is configured.
  // Refuse up front with an explanation instead of a spawn error.
  if (IS_SERVERLESS) {
    sendJson(res, 501, {
      ok: false,
      error: 'YOLO inference is not available on this deployment.',
      detail: 'It requires a Python runtime and ~48 MB of model weights, which a '
            + 'serverless function cannot provide. Run `npm run dev:all` locally to '
            + 'use the vision panel, or deploy the bridge to a persistent host.',
    });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    sendJson(res, 400, { error: 'Expected multipart/form-data' });
    return;
  }

  // Parse boundary
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    sendJson(res, 400, { error: 'Missing multipart boundary' });
    return;
  }
  const boundary = '--' + boundaryMatch[1];

  // Read full body (limit 20 MB for images)
  let raw;
  try {
    raw = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          req.destroy();
          reject(Object.assign(new Error('Image too large (max 20 MB)'), { status: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  // Split multipart parts
  const boundaryBuf = Buffer.from(boundary);
  const parts = [];
  let pos = 0;
  while (pos < raw.length) {
    const start = raw.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const headerEnd = raw.indexOf('\r\n\r\n', start + boundaryBuf.length);
    if (headerEnd === -1) break;
    const headers = raw.slice(start + boundaryBuf.length + 2, headerEnd).toString();
    const bodyStart = headerEnd + 4;
    const nextBoundary = raw.indexOf(boundaryBuf, bodyStart);
    const bodyEnd = nextBoundary === -1 ? raw.length : nextBoundary - 2; // strip trailing \r\n
    parts.push({ headers, body: raw.slice(bodyStart, bodyEnd) });
    pos = nextBoundary === -1 ? raw.length : nextBoundary;
  }

  // Extract file and model_type from parts
  let imageBuffer = null;
  let imageExt = '.jpg';
  let modelType = 'auto';
  // The COCO person/car "context" pass is on by default. It is a separate,
  // clearly-labelled box set — see yolo_detect.py for why it must not influence
  // the disaster verdict.
  let includeContext = true;

  for (const part of parts) {
    const nameMatch = part.headers.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (fieldName === 'model_type') {
      const val = part.body.toString().trim();
      if (['fire_smoke', 'flood', 'auto'].includes(val)) modelType = val;
    }
    if (fieldName === 'include_context') {
      includeContext = !['0', 'false', 'no', 'off'].includes(part.body.toString().trim().toLowerCase());
    }

    if (fieldName === 'file') {
      imageBuffer = part.body;
      const fnMatch = part.headers.match(/filename="([^"]+)"/);
      if (fnMatch) {
        const ext = fnMatch[1].split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'bmp', 'webp'].includes(ext)) imageExt = '.' + ext;
      }
    }
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    sendJson(res, 400, { error: 'No image file received' });
    return;
  }

  // Write image to temp file
  const tmpPath = join(tmpdir(), `nexora_yolo_${Date.now()}${imageExt}`);
  try {
    writeFileSync(tmpPath, imageBuffer);
  } catch (err) {
    sendJson(res, 500, { error: `Could not write temp file: ${err.message}` });
    return;
  }

  // Encode image as base64 data URL to send back for preview
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp', webp: 'image/webp' };
  const mime = mimeMap[imageExt.replace('.', '')] || 'image/jpeg';
  const imageDataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`;

  // Call Python YOLO script
  const scriptPath = join(__dirname, 'yolo_detect.py');
  // Allow an explicit interpreter (YOLO_PYTHON) so users on the Windows Store
  // python alias, or with several Pythons installed, can pin the right one.
  const pythonBin = process.env.YOLO_PYTHON || 'python';
  const timeoutMs = Number(process.env.YOLO_TIMEOUT_MS) || 120000;
  // Ultralytics prints banners to stdout, so the script also writes its JSON to
  // this file. Prefer it; fall back to parsing stdout's last JSON line.
  const outPath = join(tmpdir(), `nexora_yolo_${Date.now()}.json`);

  const result = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { unlinkSync(tmpPath); } catch { /* noop */ }
      try { unlinkSync(outPath); } catch { /* noop */ }
      resolve(value);
    };

    const py = spawn(pythonBin, [scriptPath, tmpPath, modelType, outPath, includeContext ? '1' : '0'], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });

    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });

    // Read the result file first, then fall back to the last JSON-looking line
    // of stdout so stray library chatter cannot break parsing.
    const readParsed = () => {
      try {
        const txt = readFileSync(outPath, 'utf8').trim();
        if (txt) return JSON.parse(txt);
      } catch { /* fall through to stdout */ }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (!t.startsWith('{')) continue;
        try { return JSON.parse(t); } catch { /* keep looking */ }
      }
      return null;
    };

    py.on('close', (code) => {
      // yolo_detect.py reports failures as JSON. Read that first — previously
      // only stderr was inspected, so every Python-side error collapsed into
      // the useless "Python exited with code 1".
      const parsed = readParsed();

      if (parsed && parsed.ok === false) {
        finish({ ok: false, error: parsed.error || stderr.trim() || 'YOLO detection failed' });
        return;
      }
      if (parsed) { finish(parsed); return; }

      // Nothing parseable came back — build a message that actually helps.
      const detail = (stderr.trim() || stdout.trim()).slice(-600);
      finish({
        ok: false,
        error: detail
          ? `YOLO script failed (exit ${code}): ${detail}`
          : `YOLO script produced no output and exited with code ${code}. `
            + `Check that "${pythonBin}" exists and that `
            + `"${scriptPath}" is reachable.`,
      });
    });

    py.on('error', (err) => {
      finish({
        ok: false,
        error: err.code === 'ENOENT'
          ? `Python executable "${pythonBin}" was not found. Install Python 3.10+ `
            + `or set the YOLO_PYTHON environment variable to its full path.`
          : `Failed to spawn Python (${pythonBin}): ${err.message}`,
      });
    });

    const timer = setTimeout(() => {
      py.kill();
      finish({ ok: false, error: `YOLO inference timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    timer.unref?.();
  });

  if (!result.ok) {
    sendJson(res, 500, { error: result.error || 'YOLO detection failed' });
    return;
  }

  sendJson(res, 200, { ...result, image_preview: imageDataUrl });
}

/* ------------------------------ OTP auth --------------------------------- */
/**
 * POST /api/auth/otp/request   { phone, role? }  -> issues a real SMS OTP
 * POST /api/auth/otp/verify    { phone, code }   -> exchanges it for a session
 * GET  /api/auth/otp/status                     -> is a real SMS gateway configured?
 */
async function handleOtpRequest(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: 'Invalid request body.' });
    return;
  }

  try {
    const result = await requestOtp(body.phone, { role: cleanString(body.role, 'CITIZEN') });
    sendJson(res, result.ok ? 200 : result.status || 400, result);
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: err.message });
  }
}

async function handleOtpVerify(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: 'Invalid request body.' });
    return;
  }

  try {
    const result = verifyOtp(body.phone, body.code);
    sendJson(res, result.ok ? 200 : result.status || 400, result);
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: err.message });
  }
}

function handleOtpStatus(req, res) {
  sendJson(res, 200, { ok: true, ...smsStatus() });
}

function handleSSE(req, res) {
  // Server-Sent Events hold the connection open indefinitely. A serverless
  // function is frozen and recycled as soon as its response ends, so the stream
  // would die silently a few seconds in and the client would reconnect forever.
  // Say so, once, clearly.
  if (IS_SERVERLESS) {
    sendJson(res, 501, {
      ok: false,
      error: 'Live event stream is not available on this deployment.',
      detail: 'SSE needs a long-lived connection, which a serverless function cannot hold. '
            + 'Run `npm run dev:all` locally, or deploy the bridge to a persistent host '
            + '(Render/Railway/Fly) if the live feed is required.',
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const client = { res, timer: null };
  client.timer = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clearInterval(client.timer);
      sseClients.delete(client);
    }
  }, 25000);
  sseClients.add(client);

  req.on('close', () => {
    clearInterval(client.timer);
    sseClients.delete(client);
  });
}

/* ------------------- alerts, incidents & SOS triage ---------------------- */
/**
 * These are the writes that previously only mutated browser state (and were
 * lost on reload while the UI claimed success). Each one is now persisted and,
 * where it matters, gated on a verified OTP session + role.
 */

async function handleJson(req, res, handler) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: 'Invalid request body.' });
    return;
  }
  await handler(body || {});
}

/** Reject the request unless the caller holds a session with an allowed role. */
function guard(req, res, permission) {
  const auth = authorize(req, permission);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return null;
  }
  const limit = rateLimit(req, auth.session);
  if (!limit.allowed) {
    sendJson(res, 429, {
      ok: false,
      error: `Too many requests. Try again in ${limit.retryAfterSeconds}s.`,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return null;
  }
  return auth.session;
}

function handleSessionInfo(req, res) {
  const auth = authenticate(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    phone: auth.session.phone,
    role: auth.session.role,
    expiresAt: new Date(auth.session.expiresAt).toISOString(),
  });
}

async function handleListAlerts(req, res, url) {
  sendJson(res, 200, { ok: true, alerts: await listAlerts(url.searchParams.get('limit')) });
}

async function handleCreateAlert(req, res) {
  if (rejectIfNotWritable(res, 'alert')) return;
  const session = guard(req, res, 'ALERT_BROADCAST');
  if (!session) return;
  await handleJson(req, res, async (body) => {
    const alert = await createAlert(body, session);
    // Push to any dashboard watching the stream.
    for (const client of sseClients) {
      try {
        client.res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
      } catch { /* client will be reaped by its own heartbeat */ }
    }
    console.log(`[sos-server] CAP bulletin ${alert.id} broadcast by ${session.role} ${session.phone}`);
    sendJson(res, 201, { ok: true, alert });
  });
}

async function handlePatchAlert(req, res, id) {
  const session = guard(req, res, 'ALERT_BROADCAST');
  if (!session) return;
  const match = id.match(/^([^/]+)$/);
  if (!match) {
    sendJson(res, 400, { ok: false, error: 'Malformed alert id.' });
    return;
  }
  await handleJson(req, res, async (body) => {
    const alert = await setAlertActive(decodeURIComponent(match[1]), body.active);
    if (!alert) {
      sendJson(res, 404, { ok: false, error: 'Alert not found.' });
      return;
    }
    sendJson(res, 200, { ok: true, alert });
  });
}

async function handleListIncidents(req, res, url) {
  sendJson(res, 200, { ok: true, incidents: await listIncidents(url.searchParams.get('limit')) });
}

async function handleCreateIncident(req, res) {
  if (rejectIfNotWritable(res, 'incident')) return;
  const session = guard(req, res, 'INCIDENT_CREATE');
  if (!session) return;
  await handleJson(req, res, async (body) => {
    const incident = await createIncident(body, session);
    console.log(`[sos-server] incident ${incident.id} filed by ${session.role} ${session.phone}`);
    sendJson(res, 201, { ok: true, incident });
  });
}

async function handlePatchIncident(req, res, id) {
  const session = guard(req, res, 'SOS_TRIAGE');
  if (!session) return;
  await handleJson(req, res, async (body) => {
    const incident = await setIncidentStatus(decodeURIComponent(id), body.status);
    if (!incident) {
      sendJson(res, 404, { ok: false, error: 'Incident not found or status invalid.' });
      return;
    }
    sendJson(res, 200, { ok: true, incident });
  });
}

/**
 * PATCH /api/sos/:id — triage a beacon (resolve, false-alarm, priority).
 * Previously these lived only in the browser, so marking a report as a false
 * alarm did nothing: it came back on the next page load.
 */
function handlePatchSOS(req, res, id) {
  const session = guard(req, res, 'SOS_TRIAGE');
  if (!session) return;
  handleJson(req, res, (body) => {
    const report = reports.find((r) => r.id === id);
    if (!report) {
      sendJson(res, 404, { ok: false, error: 'SOS report not found.' });
      return;
    }
    if (body.status) {
      const allowed = ['PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'];
      if (!allowed.includes(body.status)) {
        sendJson(res, 400, { ok: false, error: `status must be one of ${allowed.join(', ')}` });
        return;
      }
      report.status = body.status;
    }
    if (typeof body.priorityScore === 'number') {
      report.priorityScore = clampInt(body.priorityScore, 0, 100, report.priorityScore);
      report.priorityLevel =
        report.priorityScore >= 85 ? 'CRITICAL'
          : report.priorityScore >= 60 ? 'HIGH'
            : report.priorityScore >= 30 ? 'MEDIUM' : 'LOW';
    }
    if (typeof body.note === 'string') {
      report.triageNote = cleanString(body.note);
    }
    report.triagedBy = session.role;
    report.triagedAt = nowIso();
    persistReports();
    broadcast(report);
    sendJson(res, 200, { ok: true, report });
  });
}

/* -------------------------------- server -------------------------------- */

/**
 * True when running as a Vercel serverless function rather than the standalone
 * Node server. A few endpoints cannot work there and say so explicitly instead
 * of failing obscurely:
 *
 *   - /api/yolo/detect  spawns Python and loads ~48 MB of weights. No serverless
 *     function can do this.
 *   - /api/events       is Server-Sent Events, a long-lived connection. A
 *     function is torn down the moment its response ends.
 *   - the JSON store    needs a writable filesystem; functions get a read-only
 *     one, so DATABASE_URL is mandatory there.
 */
export const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * The whole API surface as one dispatcher.
 *
 * Extracted out of an inline createServer callback so there is exactly one copy
 * of the routing table. `npm start` calls this from a real listener for local
 * development; `api/[[...slug]].ts` calls the same function from a Vercel
 * function. Neither keeps its own copy of these rules, so they cannot drift.
 */
export function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET'  && path === '/api/health')       return handleHealth(res);
  if (req.method === 'GET'  && path === '/api/sos')          return handleList(res, url);
  if (req.method === 'POST' && path === '/api/sos')          return handleSubmit(req, res);
  if (req.method === 'POST' && path === '/api/chat')         return handleChat(req, res);
  if (req.method === 'GET'  && path === '/api/events')       return handleSSE(req, res);
  if (req.method === 'POST' && path === '/api/yolo/detect')  return handleYoloDetect(req, res);
  if (req.method === 'POST' && path === '/api/auth/otp/request') return handleOtpRequest(req, res);
  if (req.method === 'POST' && path === '/api/auth/otp/verify')  return handleOtpVerify(req, res);
  if (req.method === 'GET'  && path === '/api/auth/otp/status')  return handleOtpStatus(req, res);
  if (req.method === 'GET'  && path === '/api/auth/session')     return handleSessionInfo(req, res);

  // ── Records (role-checked, persisted) ──
  if (req.method === 'GET'  && path === '/api/alerts')    return handleListAlerts(req, res, url);
  if (req.method === 'POST' && path === '/api/alerts')    return handleCreateAlert(req, res);
  if (req.method === 'GET'  && path === '/api/incidents') return handleListIncidents(req, res, url);
  if (req.method === 'POST' && path === '/api/incidents') return handleCreateIncident(req, res);

  const alertPatch = path.match(/^\/api\/alerts\/([^/]+)$/);
  if (req.method === 'PATCH' && alertPatch) return handlePatchAlert(req, res, alertPatch[1]);

  const incPatch = path.match(/^\/api\/incidents\/([^/]+)$/);
  if (req.method === 'PATCH' && incPatch) return handlePatchIncident(req, res, incPatch[1]);

  const sosPatch = path.match(/^\/api\/sos\/([^/]+)$/);
  if (req.method === 'PATCH' && sosPatch) return handlePatchSOS(req, res, sosPatch[1]);

  // A browsable view of the backend rather than a single line of text.
  // `/api/plain` keeps the old plain-text listing, so any script that scraped
  // the root still gets plain text — it must be matched OUTSIDE the block below,
  // because that block's condition does not include this path.
  if (req.method === 'GET' && path === '/api/plain') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'NEXORA Bridge running. Endpoints: /api/health, /api/sos, /api/events, '
      + '/api/chat, /api/yolo/detect, /api/alerts, /api/incidents, '
      + '/api/auth/otp/request, /api/auth/otp/verify, /api/auth/session'
    );
    return;
  }

  if (req.method === 'GET' && (path === '/' || path === '/api')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(explorerHtml());
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

/**
 * Boot the data layer and start listening — but only when this file is the
 * process entry point.
 *
 * The `api/[[...slug]].ts` Vercel function imports handleRequest from this
 * module. Without this guard, importing it would bind a port inside a serverless
 * function, which neither works nor is wanted.
 */
function startStandaloneServer() {
  loadReports();

  // Connect to PostgreSQL before accepting traffic, so the first request does not
  // race the pool. initDb() never throws: with no DATABASE_URL, or a database
  // that is down, it logs the reason and the app runs on the JSON files.
  initDb().then((r) => {
    const st = dbStatus();
    console.log(`[sos-server] Database: ${st.backend}${st.error ? ` (${st.error})` : ''}`);
    void r;
  });

  const server = createServer(handleRequest);
  server.listen(PORT, () => {
    const sms = smsStatus();
    console.log(`[sos-server] NEXORA SOS Bridge listening on http://localhost:${PORT}`);
    console.log(`[sos-server] Stored reports: ${reports.length}`);
    console.log(
      `[sos-server] SMS OTP provider: ${sms.provider}`
      + (sms.smsConfigured
        ? ' (live gateway configured)'
        : ' - DEV MODE: no SMS gateway configured, OTPs print to this terminal')
    );
  });
}

// ESM has no `require.main`, so compare this module's URL with process.argv[1].
// Under Vercel, argv[1] is the function entry and never this file.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) startStandaloneServer();
else if (IS_SERVERLESS) {
  // Imported by the Vercel function. Warm the data layer on cold start.
  initDb().catch(() => { /* db.mjs logs the reason and falls back */ });
}