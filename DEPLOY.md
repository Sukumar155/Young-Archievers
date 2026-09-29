# Deploying NEXORA

The app has two halves and they must be deployed to **two different places**:

| Part | What it is | Where it goes |
| --- | --- | --- |
| `src/` → `dist/` | static React/Vite bundle | **Vercel** (or any static host) |
| `server/sos-server.mjs` | long-running Node HTTP server, 16 routes | **Railway / Render / Fly.io / a VPS** |

## Why they cannot be merged

`npm run build` runs `tsc -b && vite build`, which produces only static files. The
backend is a real listening server, not a bundle. The `/api` → `localhost:3001`
proxy in `vite.config.ts` exists **only under `npm run dev`**.

If you deploy the frontend alone, every `/api/*` route 404s. That is not a subtle
bug — it breaks login, SOS reporting, alerts, the chatbot and the YOLO panel all
at once, while the read-only screens still render from local mock state, so the
site *looks* fine right up until you press the button.

## 1. Deploy the bridge first

Railway, Render and Fly all work the same way:

- **Build command:** `npm install`
- **Start command:** `npm start`  (runs `node server/sos-server.mjs`)
- **Health check path:** `/api/health`

`server/sos-server.mjs` reads `PORT` from the environment, so the platform's
injected port is picked up automatically. No port changes needed.

The bridge writes to `server/data/`. That directory is created on demand
(`server/db.mjs` calls `mkdirSync(..., { recursive: true })`), so a fresh deploy
with an empty filesystem is fine. Note that a free dyno may **wipe that data on
redeploy** — acceptable for a demo. For anything durable, set `DATABASE_URL` and
it switches to PostgreSQL (see `server/DATABASE_SETUP.md`).

### The YOLO endpoint needs Python

`/api/yolo/detect` shells out to Python and loads ~48 MB of weights. On Railway
and Render you must add the Python runtime and:

```bash
pip install ultralytics
```

and place the weights in `server/models/` (`fire_smoke.pt`, `flood.pt`). Without
them the endpoint still responds, but returns a specific "No YOLO weight files
available" error rather than failing silently. See `server/YOLO_SETUP.md`.

## 2. Configure the bridge's CORS

The bridge refuses unknown origins by default — correctly, since it issues
sessions and mutates records. Set the exact frontend origin:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Comma-separate for several. **A wrong or missing value here is the single most
common cause of "everything works locally, nothing works deployed"** — the
browser blocks the response and the request looks like a network error.

## 3. Point the frontend at the bridge

In the **Vercel** project settings → Environment Variables:

```
VITE_API_URL=https://your-bridge.up.railway.app
```

No trailing slash needed. This is a build-time variable, so **redeploy after
adding it** — Vite inlines it at build.

Every API call in the app is built from `apiUrl()` in `src/services/sosApi.ts`.
`npm run verify:api-base` enforces that no component hardcodes a relative
`/api/...` path, which would compile, work in dev, and 404 in production.

## 4. Real SMS (optional)

By default the bridge runs with `OTP_SMS_PROVIDER=console`: no SMS is sent, and
the code is returned as `devCode` with `devMode: true` so the UI displays it on
screen. The login flow works end to end, which is usually enough for a demo.

To actually text the code, set one of:

```
OTP_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...
```

or `msg91` (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`) or `fast2sms`
(`FAST2SMS_API_KEY`). See `server/.env.example`.

## 5. Verify

```bash
curl https://your-bridge.up.railway.app/api/health
```

Expect JSON with `"ok": true`. If that works but the browser still fails, it is
almost always `CORS_ORIGINS`.

The login screen now distinguishes these cases for you:

- *"Cannot reach the NEXORA backend at …"* → wrong or unset `VITE_API_URL`
- *"the request returned a page, not API JSON"* → frontend-only deployment
- a real API error (rate limited, wrong code) → the bridge is working

## Checks

```bash
npm run verify:api-base   # no hardcoded /api paths
npm run verify:sensors    # live sensor feed behaves
npm run verify:banner     # alert-banner cascade resolves to white
npm run verify:text       # no encoding damage in source
npm run verify:css        # no nested CSS comment terminators
npm run scan-push         # no secrets before pushing
```
