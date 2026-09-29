/**
 * records.mjs — persistence + authorisation for operational records.
 *
 * The audit found the backend only had ONE write endpoint (POST /api/sos).
 * Everything else an operator did — filing a citizen incident, broadcasting a
 * CAP bulletin, resolving or marking an SOS as a false alarm — mutated
 * in-memory Zustand state only. It vanished on reload, was invisible to any
 * other session, and the UI still claimed it had been dispatched.
 *
 * This module gives those actions a real home:
 *   - PostgreSQL via db.mjs, with the original JSON files kept as a fallback so
 *     the app still works if the database is down
 *   - role-checked writes via the OTP session issued by otp.mjs
 *   - rate limiting so a single session cannot flood the queue
 *
 * Roles come from the verified OTP session, NEVER from the request body.
 *
 * NOTE ON ASYNC: the record functions are now async because a database call is.
 * They kept their names and return shapes, so the route handlers in
 * sos-server.mjs only needed `await` added.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSession } from './otp.mjs';
import * as store from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

/* Roles that may perform each class of write. */
export const PERMISSIONS = {
  SOS_WRITE: ['CITIZEN', 'DDMO_OFFICER', 'FIELD_RESPONDER', 'SHELTER_MANAGER'],
  SOS_TRIAGE: ['DDMO_OFFICER'],
  ALERT_BROADCAST: ['DDMO_OFFICER'],
  INCIDENT_CREATE: ['CITIZEN', 'DDMO_OFFICER', 'FIELD_RESPONDER'],
  RESOURCE_DISPATCH: ['DDMO_OFFICER', 'SHELTER_MANAGER'],
};

const LIMITS = {
  alerts: 500,
  incidents: 500,
};
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20; // writes per session/IP per minute

/* ------------------------------ persistence ------------------------------ */

function fileFor(kind) {
  return join(DATA_DIR, `${kind}.json`);
}

function load(kind) {
  try {
    const f = fileFor(kind);
    if (existsSync(f)) {
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn(`[records] could not load ${kind}.json:`, err.message);
  }
  return [];
}

function persist(kind, rows) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const capped = rows.slice(0, LIMITS[kind]);
    writeFileSync(fileFor(kind), JSON.stringify(capped, null, 2));
    return capped;
  } catch (err) {
    console.warn(`[records] could not persist ${kind}.json:`, err.message);
    return rows;
  }
}

const db = {
  alerts: load('alerts'),
  incidents: load('incidents'),
};

/**
 * Bulletins resolved before `resolvedAt` existed have no timestamp. Without a
 * backfill they would sit in the store forever — they would never reach the
 * history strip (which keys off resolvedAt) and never expire. Stamp them from
 * their own updatedAt, or from now if that is missing too.
 */
(function backfillResolvedTimestamps() {
  const nowIso = new Date().toISOString();
  let touched = 0;
  for (const a of db.alerts) {
    if (a.active === false && !a.resolvedAt) {
      a.resolvedAt = a.updatedAt || nowIso;
      touched += 1;
    }
  }
  if (touched > 0) {
    persist('alerts', db.alerts);
    console.log(`[records] backfilled resolvedAt on ${touched} legacy bulletin(s)`);
  }
})();

/* --------------------------------- auth ---------------------------------- */

/**
 * Resolve the caller's session from the Authorization header.
 * @returns {{ok:true, session:object} | {ok:false, status:number, error:string}}
 */
export function authenticate(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return { ok: false, status: 401, error: 'Sign in to perform this action.' };
  }
  const session = getSession(token);
  if (!session) {
    return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
  }
  return { ok: true, session };
}

/** Authenticate AND check the caller's role is allowed. */
export function authorize(req, permission) {
  const auth = authenticate(req);
  if (!auth.ok) return auth;

  const allowed = PERMISSIONS[permission] || [];
  if (!allowed.includes(auth.session.role)) {
    return {
      ok: false,
      status: 403,
      error: `Your role (${auth.session.role}) is not permitted to ${String(permission)
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    };
  }
  return auth;
}

/** Client identity for rate limiting: session id if signed in, else IP. */
function rateKey(req, session) {
  if (session?.phone) return `p:${session.phone}`;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  return `ip:${ip}`;
}

const rateBuckets = new Map();

/** Simple fixed-window limiter. Returns retryAfterSeconds when exceeded. */
export function rateLimit(req, session, max = RATE_MAX) {
  const key = rateKey(req, session);
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return { allowed: true };
}

/* ------------------------------ sanitising ------------------------------- */

const str = (v, max = 400) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const strList = (v, max = 8) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max) : [];

/* --------------------------------- alerts -------------------------------- */

/**
 * CAP bulletin broadcast. The `role` is taken from the verified session and
 * overwrites anything the client sent.
 */
export async function createAlert(body, session) {
  const severity = ['CRITICAL', 'SEVERE', 'MODERATE', 'ADVISORY'].includes(body.severity)
    ? body.severity
    : 'ADVISORY';

  const alert = {
    id: `ALERT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    type: 'CAP_BULLETIN',
    title: str(body.title, 200) || 'Untitled bulletin',
    severity,
    zone: str(body.zone, 120),
    locationName: str(body.locationName, 160),
    reason: str(body.reason, 600),
    recommendedAction: str(body.recommendedAction, 600),
    channels: strList(body.channels),
    affectedPopulation: num(body.affectedPopulation, 0, 10_000_000, 0),
    lat: num(body.lat, -90, 90, 0),
    lng: num(body.lng, -180, 180, 0),
    active: true,
    // Provenance comes from the server, not the client.
    issuedByRole: session.role,
    issuedByPhone: session.phone,
    timestamp: new Date().toISOString(),
  };

  // The in-memory array is only the JSON fallback's copy; store.insertAlert
  // writes to PostgreSQL when it is available and mirrors to the file when not.
  const stored = await store.insertAlert(alert);
  db.alerts.unshift(alert);
  if (db.alerts.length > LIMITS.alerts) db.alerts.length = LIMITS.alerts;
  return stored ?? alert;
}

export async function listAlerts(limit = 100) {
  // Sweep on read so an entry expires even if nothing else touched the store.
  await purgeExpiredAlerts();
  return store.listAlerts(num(limit, 1, LIMITS.alerts, 100));
}

export async function setAlertActive(id, active) {
  const updated = await store.updateAlertActive(id, active, 'operator');
  if (updated) return updated;

  // JSON fallback path.
  const alert = db.alerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.active = Boolean(active);
  alert.updatedAt = new Date().toISOString();
  if (active) {
    alert.resolvedAt = null;
    alert.resolvedBy = null;
  } else {
    alert.resolvedAt = alert.resolvedAt || alert.updatedAt;
  }
  persist('alerts', db.alerts);
  return alert;
}

/** Resolved bulletins are retained for 24 hours, then deleted. */
export const ALERT_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete resolved bulletins past the 24-hour retention window. Active
 * bulletins are never removed, however old they are.
 */
export async function purgeExpiredAlerts() {
  const dropped = await store.purgeAlerts(ALERT_HISTORY_TTL_MS);
  if (dropped > 0) {
    console.log(`[records] purged ${dropped} resolved bulletin(s) older than 24h`);
  }
  return dropped;
}

/* ------------------------------- incidents ------------------------------- */

/** Full citizen incident report (the long form, not the one-tap beacon). */
export async function createIncident(body, session) {
  const incident = {
    id: `INC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    type: 'INCIDENT_REPORT',
    title: str(body.title, 200) || 'Citizen incident report',
    description: str(body.description, 1200),
    category: str(body.category, 60) || 'GENERAL',
    severity: ['CRITICAL', 'SEVERE', 'MODERATE', 'ADVISORY'].includes(body.severity)
      ? body.severity
      : 'MODERATE',
    lat: num(body.lat, -90, 90, 0),
    lng: num(body.lng, -180, 180, 0),
    locationName: str(body.locationName, 160),
    peopleCount: num(body.peopleCount, 1, 500, 1),
    needs: strList(body.needs, 10),
    contactPhone: str(body.contactPhone, 32),
    status: 'PENDING',
    reportedByRole: session.role,
    reportedByPhone: session.phone,
    timestamp: new Date().toISOString(),
  };

  const stored = await store.insertIncident(incident);
  db.incidents.unshift(incident);
  if (db.incidents.length > LIMITS.incidents) db.incidents.length = LIMITS.incidents;
  return stored ?? incident;
}

export async function listIncidents(limit = 100) {
  return store.listIncidents(num(limit, 1, LIMITS.incidents, 100));
}

export async function setIncidentStatus(id, status) {
  const allowed = ['PENDING', 'ACKNOWLEDGED', 'RESOLVED'];
  if (!allowed.includes(status)) return null;

  const updated = await store.updateIncidentStatus(id, status);
  if (updated) return updated;

  // JSON fallback path.
  const incident = db.incidents.find((i) => i.id === id);
  if (!incident) return null;
  incident.status = status;
  incident.updatedAt = new Date().toISOString();
  persist('incidents', db.incidents);
  return incident;
}

/* ----------------------------- diagnostics ------------------------------- */

export async function stats() {
  const [alerts, incidents] = await Promise.all([
    store.listAlerts(LIMITS.alerts),
    store.listIncidents(LIMITS.incidents),
  ]);
  return {
    alerts: alerts.length,
    incidents: incidents.length,
    db: store.dbStatus(),
  };
}
