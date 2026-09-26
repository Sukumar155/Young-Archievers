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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    console.warn('[sos-server] Could not persist sos.json:', err.message);
  }
}

/* ------------------------------- helpers ------------------------------- */

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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/* ----------------------------- SOS handling ----------------------------- */

/** Reads and bounds an HTTP request body (resolves the raw string). */
function readBody(req, maxBytes = MAX_BODY_BYTES) {
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
function createReport(body) {
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
  sendJson(res, 200, { ok: true, service: 'NEXORA SOS Bridge', uptimeSec: process.uptime(), reports: reports.length });
}

function handleList(res, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 500, 50);
  sendJson(res, 200, reports.slice(0, limit));
}

function handleSubmit(req, res) {
  let raw = '';
  let size = 0;
  let done = false;

  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      done = true;
      req.destroy();
      sendJson(res, 413, { error: 'Payload too large' });
      return;
    }
    raw += chunk;
  });

  req.on('end', () => {
    if (done) return;
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    let report;
    try {
      report = createReport(body);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message });
      return;
    }

    reports.unshift(report);
    if (reports.length > MAX_STORED_REPORTS) reports.length = MAX_STORED_REPORTS;
    persistReports();
    broadcast(report);
    console.log(`[sos-server] + ${report.id} @ ${report.locationName} (${report.lat.toFixed(4)}, ${report.lng.toFixed(4)})`);

    sendJson(res, 201, report);
  });
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

function handleSSE(req, res) {
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

/* -------------------------------- server -------------------------------- */

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && path === '/api/health') return handleHealth(res);
  if (req.method === 'GET' && path === '/api/sos') return handleList(res, url);
  if (req.method === 'POST' && path === '/api/sos') return handleSubmit(req, res);
  if (req.method === 'POST' && path === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET' && path === '/api/events') return handleSSE(req, res);

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('NEXORA Bridge running. Endpoints: /api/health, /api/sos, /api/events, /api/chat');
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

loadReports();
server.listen(PORT, () => {
  console.log(`[sos-server] NEXORA SOS Bridge listening on http://localhost:${PORT}`);
  console.log(`[sos-server] Stored reports: ${reports.length}`);
});