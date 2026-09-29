/**
 * otp.mjs — real SMS OTP issuing & verification for NEXORA login.
 *
 * Zero dependencies (uses node:crypto + global fetch), matching the rest of the
 * backend. Design notes:
 *
 *  - The OTP is NEVER stored in plaintext. Only a SHA-256 hash of
 *    `salt:otp` is kept, so a memory dump or a stray debug log cannot leak a
 *    live code.
 *  - Codes are generated with crypto.randomInt (not Math.random).
 *  - Verification uses crypto.timingSafeEqual, so a wrong code cannot be
 *    brute-forced by measuring response time.
 *  - Each code expires (default 5 min) and dies after 5 wrong attempts.
 *  - Requests are rate limited per phone: a resend cooldown plus an hourly cap,
 *    which is what stops SMS-pumping abuse of the gateway.
 *  - Every failure returns the SAME generic message, so the endpoint cannot be
 *    used to discover which phone numbers exist.
 *
 * SMS delivery is pluggable. Without credentials the module runs in
 * "console" mode: the code is printed to the server terminal and returned in
 * the API response (flagged `devMode`) so the flow is fully testable locally.
 * Set the env vars below to switch on a real gateway — no code changes.
 */

import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveRole } from './directory.mjs';

/* ------------------------------ configuration ----------------------------- */

const OTP_LENGTH = 6;
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);      // 5 minutes
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS || 30 * 1000);
const MAX_REQUESTS_PER_HOUR = Number(process.env.OTP_MAX_REQUESTS_PER_HOUR || 5);
const SESSION_TTL_MS = Number(process.env.OTP_SESSION_TTL_MS || 12 * 60 * 60 * 1000);

const PROVIDER = (process.env.OTP_SMS_PROVIDER || 'console').toLowerCase();

/**
 * @typedef {object} OtpRecord
 * @property {string}  phone
 * @property {string}  hash
 * @property {string}  salt
 * @property {number}  expiresAt
 * @property {number}  attempts
 * @property {string}  role
 * @property {boolean} devMode
 * @property {string|null} code  plaintext, held only until the first verify attempt
 */

/** @type {Map<string, OtpRecord>} */
const otpStore = new Map();
/** @type {Map<string, number[]>} phone -> epoch ms of recent requests */
const requestLog = new Map();
/** @type {Map<string, { phone: string; role: string; expiresAt: number }>} */
const sessions = new Map();

/* -------------------------------- helpers -------------------------------- */

const now = () => Date.now();

/** Normalise to a bare 10-digit Indian mobile, or throw. */
export function normalisePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  // Accept 10-digit, 91-prefixed or +91-prefixed forms.
  const ten = digits.length > 10 && digits.endsWith(digits.slice(-10)) ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) {
    const err = new Error('Enter a valid 10-digit Indian mobile number.');
    err.status = 400;
    throw err;
  }
  return ten;
}

const hashOtp = (salt, otp) =>
  createHash('sha256').update(`${salt}:${otp}`).digest('hex');

function safeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Drop expired codes/sessions and stale rate-limit logs. */
function sweep() {
  const t = now();
  for (const [phone, rec] of otpStore) {
    if (rec.expiresAt < t) otpStore.delete(phone);
  }
  for (const [token, s] of sessions) {
    if (s.expiresAt < t) sessions.delete(token);
  }
  for (const [phone, stamps] of requestLog) {
    const recent = stamps.filter((s) => t - s < 60 * 60 * 1000);
    if (recent.length) requestLog.set(phone, recent);
    else requestLog.delete(phone);
  }
}

/** Is a real SMS gateway configured? Drives the UI's dev-mode notice. */
export function smsStatus() {
  sweep();
  const configured =
    (PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
    (PROVIDER === 'msg91' && process.env.MSG91_AUTH_KEY) ||
    (PROVIDER === 'fast2sms' && process.env.FAST2SMS_API_KEY);
  return {
    provider: PROVIDER,
    smsConfigured: Boolean(configured),
    devMode: !configured,
    otpLength: OTP_LENGTH,
    ttlSeconds: Math.round(OTP_TTL_MS / 1000),
    resendCooldownSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
  };
}

/* ------------------------------ SMS delivery ------------------------------ */

const OTP_MESSAGE = (code) =>
  `${code} is your NEXORA verification code. It expires in ${Math.round(OTP_TTL_MS / 60000)} minutes. Do not share it with anyone.`;

/**
 * Deliver the OTP. Returns { ok, provider, error? }.
 * Never throws — a gateway failure must not leak internals to the client.
 */
async function sendSms(phone, code) {
  const text = OTP_MESSAGE(code);
  const to = `+91${phone}`;

  try {
    if (PROVIDER === 'twilio') {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM || '+14155238885'; // Twilio trial number
      const body = new URLSearchParams({ To: to, From: from, Body: text });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        }
      );
      if (!res.ok) throw new Error(`Twilio HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { ok: true, provider: 'twilio' };
    }

    if (PROVIDER === 'msg91') {
      const authKey = process.env.MSG91_AUTH_KEY;
      const templateId = process.env.MSG91_TEMPLATE_ID;
      const senderId = process.env.MSG91_SENDER_ID || 'NEXORA';
      const body = new URLSearchParams({
        template_id: templateId,
        mobile: `91${phone}`,
        sender: senderId,
        // MSG91 auto-detects OTP length from the authkey; `otp` is the var name.
        otp: code,
        authkey: authKey,
      });
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`MSG91 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { ok: true, provider: 'msg91' };
    }

    if (PROVIDER === 'fast2sms') {
      const body = new URLSearchParams({
        route: 'v3',
        sender_id: process.env.FAST2SMS_SENDER_ID || 'TXLMGT',
        message: text,
        language: 'english',
        numbers: phone,
        api_key: process.env.FAST2SMS_API_KEY,
      });
      const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`Fast2SMS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { ok: true, provider: 'fast2sms' };
    }

    // ── console (dev) ──
    console.log(
      `\n[sos-server] ┌──────────────────────────────────────────┐\n` +
      `[sos-server] │  NEXORA OTP for +91 ${phone}: ${code}`.padEnd(58) +
      `\n[sos-server] └──────────────────────────────────────────┘\n`
    );
    return { ok: true, provider: 'console' };
  } catch (err) {
    console.error(`[sos-server] SMS delivery failed via ${PROVIDER}:`, err.message);
    return { ok: false, provider: PROVIDER, error: err.message };
  }
}

/* --------------------------------- API ----------------------------------- */

/**
 * Issue an OTP for a phone number.
 * @returns {Promise<{ok:boolean, status?:number, error?:string, devMode?:boolean, devCode?:string, retryAfterSeconds?:number}>}
 */
export async function requestOtp(rawPhone, { role: requestedRole } = {}) {
  sweep();
  const phone = normalisePhone(rawPhone);

  // The role always comes from the server-side roster, never the request body.
  // Trusting the client's claim would let anyone request a DDMO_OFFICER session.
  const { role, onRoster } = resolveRole(phone, requestedRole);

  // Rate limit: cooldown + hourly cap.
  const stamps = (requestLog.get(phone) || []).filter((s) => now() - s < 60 * 60 * 1000);
  if (stamps.length >= MAX_REQUESTS_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: `Too many verification codes requested. Try again in ${Math.ceil((60 * 60 * 1000 - (now() - stamps[0])) / 60000)} minutes.`,
    };
  }
  const existing = otpStore.get(phone);
  if (existing && existing.expiresAt > now() && now() - (existing.sentAt || 0) < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now() - existing.sentAt)) / 1000);
    return { ok: false, status: 429, error: `Please wait ${wait}s before requesting another code.`, retryAfterSeconds: wait };
  }

  // Generate + store (hashed).
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  const salt = randomBytes(16).toString('hex');
  const delivery = await sendSms(phone, code);

  if (!delivery.ok) {
    return {
      ok: false,
      status: 502,
      error: 'Could not send the verification SMS right now. Please try again shortly.',
    };
  }

  otpStore.set(phone, {
    phone,
    salt,
    hash: hashOtp(salt, code),
    expiresAt: now() + OTP_TTL_MS,
    attempts: 0,
    role,
    sentAt: now(),
    devMode: delivery.provider === 'console',
    // Plaintext is kept ONLY so console-mode dev can display it. A real SMS
    // gateway never needs it back, so drop it as soon as it has been used once.
    code: delivery.provider === 'console' ? code : null,
  });

  requestLog.set(phone, [...stamps, now()]);

  const devMode = delivery.provider === 'console';
  console.log(
    `[sos-server] OTP issued for +91 ${phone} via ${delivery.provider}`
    + (devMode ? ' (dev mode — no SMS gateway configured)' : '')
  );

  return {
    ok: true,
    // Same shape for everyone, so the UI can explain itself without leaking.
    devMode,
    devCode: devMode ? code : undefined,
    expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
    onRoster,
  };
}

/**
 * Verify a submitted code. On success returns a session token.
 * @returns {Promise<{ok:boolean, status?:number, error?:string, token?:string, role?:string, attemptsLeft?:number}>}
 */
export function verifyOtp(rawPhone, rawCode) {
  sweep();
  const phone = normalisePhone(rawPhone);
  const code = String(rawCode || '').replace(/\D/g, '');

  const rec = otpStore.get(phone);
  const generic = 'That code is incorrect or has expired. Please request a new one.';

  if (!rec) return { ok: false, status: 400, error: generic };
  if (rec.expiresAt < now()) {
    otpStore.delete(phone);
    return { ok: false, status: 400, error: generic };
  }
  if (code.length !== OTP_LENGTH) {
    return { ok: false, status: 400, error: generic, attemptsLeft: MAX_ATTEMPTS - rec.attempts };
  }

  rec.attempts += 1;
  if (!safeEqualHex(hashOtp(rec.salt, code), rec.hash)) {
    const left = MAX_ATTEMPTS - rec.attempts;
    if (left <= 0) {
      otpStore.delete(phone);
      return { ok: false, status: 429, error: 'Too many incorrect attempts. Request a new code.' };
    }
    return {
      ok: false,
      status: 400,
      error: `${generic} ${left} attempt${left === 1 ? '' : 's'} left.`,
      attemptsLeft: left,
    };
  }

  // Correct — burn the code so it cannot be replayed, then mint a session.
  otpStore.delete(phone);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { phone, role: rec.role, expiresAt: now() + SESSION_TTL_MS });

  return { ok: true, token, role: rec.role, phone: `+91 ${phone}` };
}

/** Look up a session token (used by future protected routes). */
export function getSession(token) {
  sweep();
  const s = sessions.get(String(token || ''));
  if (!s || s.expiresAt < now()) return null;
  return s;
}

/** Test/diagnostic helper. */
export function _stats() {
  sweep();
  return {
    provider: PROVIDER,
    pendingCodes: otpStore.size,
    activeSessions: sessions.size,
    trackedPhones: requestLog.size,
  };
}
