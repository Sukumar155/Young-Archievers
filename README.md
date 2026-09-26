# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## NEXORA AI Chatbot

The floating chatbot (bottom-right) is now a **mini-ChatGPT style assistant** backed by a real LLM instead of only fixed canned answers.

**How it works**
- Uses an OpenAI-compatible Chat Completions endpoint (`src/services/llmService.ts`).
- Defaults to the free, no-key Pollinations.ai model (**`model: openai`**). Requests are relayed through the bundled Node backend (`POST /api/chat` in `server/sos-server.mjs`): Pollinations now answers real browsers with `403 "Missing Turnstile token"` (a browser must send its foreign `Origin` header; the provider blocks those without a CAPTCHA token). The backend fetches Pollinations server-side — no `Origin` header, so it always works. The browser talks to our own backend same-origin (Vite proxy), so **no API key and no CAPTCHA needed**.
- At every message it injects a **live telemetry snapshot** from the Zustand store (`src/services/chatEngine.ts`) so answers about risk, water level, shelters, hospitals, incidents, routes, supplies, and helplines are correct and current.
- Replies **in the same language you type or speak** (English / தமிழ் / हिन्दी / తెలుగు / മലയാളം / বাংলা) — the model detects the language.
- When the answer references a place, the model appends a `[LOC:{...}]` block which the UI parses back into **Open in Maps / Get Directions / Google Maps** action buttons.
- Conversations have memory (last 16 messages) and stream tokens live with a typewriter effect + Stop button.
- If the LLM is unreachable (offline / endpoint down), it gracefully falls back to the built-in keyword engine.

**Bring your own model (optional)**
Any OpenAI-compatible endpoint works. See `.env.example` for `VITE_CHAT_API_URL`, `VITE_CHAT_API_KEY`, `VITE_CHAT_MODEL`, or set the same keys at runtime via `localStorage` in the browser console (no rebuild needed). When you configure your own endpoint, it is tried first and the free relay is the automatic fallback.

**Troubleshooting the AI dot:** 🔴 **AI Offline** means neither your endpoint nor the backend relay answered. Tap **Retry AI** in the amber notice bar (the backend must be running for the free AI — use `npm run dev:all`). If you previously set a bad `nexora_chat_url` in `localStorage`, the app now auto-falls back to the working default, but you can also clear it with `localStorage.removeItem('nexora_chat_url')` and refresh.

## SOS Signal — Citizen one-tap emergency beacon + backend bridge

The **SOS Signal** button (Citizen Portal → red warning banner, right of "Report Trapped Person") detects the citizen's live location with the browser Geolocation API and raises a **CRITICAL SOS** with the exact coordinates — no form filling needed. It's not limited to native apps; any modern browser on a phone (GPS) or laptop (WiFi/network) supports it.

- Detection: `navigator.geolocation` (`src/services/geolocationService.ts`) with a reverse-geocode to a place name (OpenStreetMap Nominatim) and a raw-coordinates fallback when offline.
- Local store (`src/store/useNexoraStore.ts` → `submitQuickSOS`): the beacon appears instantly in the authorities' Priority SOS Queue and is pinned on the disaster map.
- **Backend bridge (`server/sos-server.mjs`)** — a zero-dependency Node server that actually receives the SOS over HTTP, persists it to `server/data/sos.json`, and pushes it **live** to every open dashboard over SSE:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/sos` | Accept & validate a citizen SOS beacon (201 + stored report) |
| `GET /api/sos` | List stored reports (latest first, `?limit=`) |
| `GET /api/events` | SSE stream — pushes new SOS reports to dashboards instantly |
| `GET /api/health` | Health/uptime check |
| `POST /api/chat` | AI relay — streams LLM chat completions for the chatbot (bypasses the provider's browser CAPTCHA; override with `LLM_RELAY_URL`) |

**Run it:**
```bash
npm run dev:all     # backend (localhost:3001) + Vite app (localhost:5173) together
# or, in two terminals:
npm run server      # SOS backend only
npm run dev         # Vite app only
```
The Vite dev server proxies `/api/*` to `http://localhost:3001`, so the frontend just uses relative URLs. Hosted separately? Set `VITE_API_URL` (see `.env.example`). To demo the live bridge: click **SOS Signal** in one browser tab (citizen), then open the **Priority SOS Triage** queue in another tab — the report appears in real time, with the **Server: Live** pill in the queue header. If the backend isn't running, the app still works fully locally and shows **Server: Offline**.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
