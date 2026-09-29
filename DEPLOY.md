# Deploying NEXORA

Single deployment, on Vercel. The frontend and the API both live there.

## Layout

| Path | What | Becomes |
| --- | --- | --- |
| `src/` → `dist/` | static React/Vite bundle | the site |
| `api/nexora.ts` | one serverless function | every `/api/*` route |
| `api/index.ts` | the browsable bridge view | `/api` |
| `server/sos-server.mjs` | the same dispatcher, as a plain Node server | `npm start`, for local dev |

`vercel.json` rewrites every API path to the single function, passing the real
path along:

```
/api/auth/otp/status  ->  /api/nexora?p=auth/otp/status
```

The handler rebuilds `/api/<p>` and calls `handleRequest` — the *same*
dispatcher `npm start` uses. One routing table, so the local server and the
deployed function cannot drift apart.

**Why one flat function.** Three layouts were deployed and measured against the
live site. In every case only routes at the **top level** of `api/` were
deployed:

| Layout | Result |
| --- | --- |
| `api/[[...slug]].ts` | `/api/health` worked, `/api/auth/otp/status` 404'd |
| `api/[...path].ts` | identical |
| `api/<dir>/<route>.ts` | top-level files deployed, subdirectory files did not |

So the catch-all was never the problem, and neither was the dispatcher. There is
now one function, at the top level, reached by an explicit rewrite — nothing
left for Vercel to interpret.

`/api` itself does not match the rewrite and is served by `api/index.ts`.
Everything else that is not `/api/*` goes to `index.html`, so client side routes
survive a hard refresh.

## What you must set: `DATABASE_URL`

**This is the one required step.**

A serverless function has a read-only filesystem, so the JSON fallback in
`server/data/` cannot be used — every write would fail. The API detects this and
refuses writes with a 503 rather than accepting a report and silently dropping
it, but the fix is a real database.

Both of these have a free tier and take about two minutes:

- **Neon** — neon.tech, sign in with GitHub, create a project, copy the
  connection string
- **Supabase** — supabase.com, new project, Settings → Database → URI

Then apply the schema once:

```bash
node scripts/migrate.mjs          # creates the tables
node scripts/migrate.mjs --verify # compares row counts, writes nothing
```

Without this, login and OTP still work (they are in-memory), but SOS reports,
alerts and incidents are rejected. `/api/health` reports `"writable": false`
and the write error when it happens.

## Environment variables on Vercel

```
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
CORS_ORIGINS=https://your-app.vercel.app
```

`CORS_ORIGINS` must be your exact frontend origin. If it is wrong the browser
blocks the response and the failure looks like a network error.

**Do not set `VITE_API_URL`.** The frontend and the API are on the same origin
now, so `apiUrl()` resolves to a relative path and everything just works. The
variable only exists for a split deployment.

## What does not work here, and why

Both are refused with a `501` and an explanation rather than failing quietly.

| Endpoint | Why |
| --- | --- |
| `/api/yolo/detect` | spawns Python and loads ~48 MB of weights. A serverless function has no child-process runtime, no GPU and no disk for the model files. It still works with `npm run dev:all` locally. |
| `/api/events` | Server-Sent Events hold a connection open; a function is frozen the moment its response ends. |

`/api/health` lists both under `unavailable` so a demo cannot promise what this
deployment cannot serve.

## SMS

`OTP_SMS_PROVIDER` defaults to `console`: nothing is texted, and the code comes
back as `devCode` with `devMode: true` so the UI shows it on screen. The login
flow completes end to end, which is usually enough for a demo.

To actually send SMS, set one of:

```
OTP_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...
```

or `msg91` (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`) or `fast2sms`
(`FAST2SMS_API_KEY`). See `server/.env.example`.

## Verify

```bash
curl https://your-app.vercel.app/api/health
```

Expect `"runtime": "vercel-function"` and `"db": { "backend": "postgresql",
"writable": true }`. If `writable` is false, `DATABASE_URL` is wrong or the
schema was never applied.

## Local development

```bash
npm run dev:all
```

Vite on 5173, the bridge on 3001, with `/api` proxied. This is the only place
YOLO works.

## Checks

```bash
npm run verify:routing     # the rewrite covers every dispatcher route
npm run test:serverless    # the dispatcher works in the Vercel request shape
npm run verify:api-base    # no component bypasses apiUrl()
npm run verify:sensors     # live sensor feed behaves
npm run verify:banner      # alert-banner cascade resolves to white
npm run verify:text        # no encoding damage in source
npm run verify:css         # no nested CSS comment terminators
```

`verify:routing` is the one that catches deployment-only breakage. It reads the
route table out of `sos-server.mjs` and checks the rewrite matches every path,
that the SPA fallback cannot shadow it, and that no function file has drifted
into a subdirectory. Two deployments shipped broken login before it existed.

`test:serverless` drives `handleRequest` with a mock request that has a
pre-parsed body and no readable stream, which is the shape Vercel delivers — the
original code subscribed to `req.on('data')` and would have hung until the
function timed out.
