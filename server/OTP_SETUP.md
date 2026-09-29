# SMS OTP configuration

The login wizard (`PhoneLogin.tsx`) now runs a **real** OTP handshake:

```
browser → POST /api/auth/otp/request  →  server/otp.mjs  →  SMS gateway
browser → POST /api/auth/otp/verify   →  server/otp.mjs  →  session token
```

The frontend will not sign anyone in until the backend confirms the code.
Nothing is pre-filled and no code is accepted client-side.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/auth/otp/status` | — | `{ provider, smsConfigured, devMode, otpLength, ttlSeconds, resendCooldownSeconds }` |
| `POST /api/auth/otp/request` | `{ phone, role? }` | `{ ok, devMode, devCode?, expiresInSeconds, resendAfterSeconds }` |
| `POST /api/auth/otp/verify` | `{ phone, code }` | `{ ok, token, role, phone }` or `{ ok:false, error, attemptsLeft? }` |

## Dev mode (default — no account needed)

With no credentials set, the provider is `console`: the code is **printed to the
server terminal** and also returned to the browser, where the UI shows it in a
clearly-labelled "Dev mode" panel. This makes the whole flow testable offline.

```powershell
npm run dev:all
# [sos-server] NEXORA OTP for +91 9876543210: 316777
```

## Sending real SMS

Pick one provider and set its variables as real environment variables (or in
`server/.env` — the server reads `process.env`, so use your shell / process
manager). **No code changes are needed.**

### Twilio (works internationally, easiest trial)
```powershell
$env:OTP_SMS_PROVIDER   = "twilio"
$env:TWILIO_ACCOUNT_SID = "ACxxxxxxxx"
$env:TWILIO_AUTH_TOKEN  = "xxxxx"
$env:TWILIO_FROM        = "+14155238885"   # your Twilio number
```

### MSG91 (Indian gateway, needs DLT registration for production)
```powershell
$env:OTP_SMS_PROVIDER = "msg91"
$env:MSG91_AUTH_KEY   = "xxxxx"
$env:MSG91_TEMPLATE_ID= "your-approved-template-id"
$env:MSG91_SENDER_ID  = "NEXORA"
```

### Fast2SMS (Indian, simple bulk API)
```powershell
$env:OTP_SMS_PROVIDER  = "fast2sms"
$env:FAST2SMS_API_KEY  = "xxxxx"
$env:FAST2SMS_SENDER_ID= "TXLMGT"
```

Restart the backend and check it picked up the gateway:
```powershell
curl http://localhost:3001/api/auth/otp/status
# "smsConfigured": true, "devMode": false
```

## Which portal you land in

The role in the sign-in wizard is a **request**, not a decision. The server assigns
the real role from the officer roster (`server/officers.json`), so a number that is
not registered for the posting you picked is downgraded to `CITIZEN` — that is what
stops anyone self-selecting DDMO officer.

If your number is not on the roster, authority sign-in will not work. Add it:

```bash
npm run roster                                        # who is registered
npm run roster:add -- +919876543210 DDMO_OFFICER "K. Iyer"
npm run roster -- --remove +919876543210
```

No restart needed. The login screen also tells the user this, and offers to
continue with the role they do have.

Demo numbers seeded on first run: `+91 9000000002` (Command),
`+91 9000000003` (Responder), `+91 9000000004` (Shelter).

## Tuning
| Variable | Default | Meaning |
| --- | --- | --- |
| `OTP_TTL_MS` | `300000` | Code lifetime (5 min) |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses before the code is destroyed |
| `OTP_RESEND_COOLDOWN_MS` | `30000` | Minimum gap between codes for one number |
| `OTP_MAX_REQUESTS_PER_HOUR` | `5` | Hourly cap per number (stops SMS pumping) |
| `OTP_SESSION_TTL_MS` | `43200000` | Session token lifetime (12 h) |

## Security notes

- The code is **never stored in plaintext** — only `SHA-256(salt + otp)`. The
  salt is per-code and random.
- Codes come from `crypto.randomInt`, not `Math.random`.
- Comparison uses `crypto.timingSafeEqual`, so a wrong code can't be brute-forced
  by timing the response.
- A correct code is **burned on use** — replays fail.
- Every failure returns the **same generic message**, so the endpoint can't be
  used to enumerate which numbers exist.
- `server/otp.mjs` keeps state in memory, so restarting the backend invalidates
  outstanding codes. Move `otpStore` to Redis/TTR if you run multiple instances.

### Before going to production
This is a demo-grade implementation. For a live deployment you also want: a shared
rate limit across instances, CAPTCHA or per-IP throttling on `/request`, a
persistent audit log of auth attempts, and HSTS. Note the backend currently sets
`Access-Control-Allow-Origin: *` for the whole API — lock that down to your origin
before exposing OTP endpoints publicly.
