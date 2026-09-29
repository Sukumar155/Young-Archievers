/**
 * api/[...path].ts — the NEXORA bridge, as a Vercel serverless function.
 *
 * Why this file exists
 * --------------------
 * The bridge used to be a long-running Node server (`server/sos-server.mjs`)
 * that Vercel cannot host, so a Vercel deployment had no backend at all and
 * every /api route 404'd. Rather than rewrite sixteen handlers as sixteen
 * separate functions, this delegates to the same dispatcher the standalone
 * server uses:
 *
 *   npm start                     -> createServer(handleRequest)
 *   Vercel (this file)            -> handleRequest(req, res)
 *
 * One routing table, two hosts. The local dev server and the deployed function
 * cannot drift apart, because there is only one copy of the rules.
 *
 * `[...path]` is a catch-all, so /api/health, /api/sos, /api/auth/otp/request
 * and /api/alerts/abc all land in this one function with their full path
 * intact. It is `[...]` rather than `[[...]]` because nothing is served at
 * exactly /api, and the optional form deployed as a single-segment matcher
 * anyway — every nested route 404'd.
 *
 * The type module lives in api/_lib/ rather than beside this file on purpose:
 * Vercel turns *every* file in api/ into a function, so a types-only module
 * with no default export deploys as a route that 500s.
 */
import { handleRequest, IS_SERVERLESS } from '../server/sos-server.mjs';
import type { VercelRequest, VercelResponse } from './_lib/types.js';

export const config = {
  // The chat route calls an external AI provider with retries, so the default
  // 10s function timeout is not enough on a cold start.
  maxDuration: 60,
};

/**
 * Rebuild the original path from the catch-all parameter.
 *
 * The dispatcher matches on the full pathname, and a catch-all request does not
 * reliably carry it in req.url, so it is reassembled from the matched segments.
 * The parameter name is read from the request rather than hardcoded, so
 * renaming the file segment (`[...slug]` -> `[...path]`) cannot silently break
 * routing again — which is exactly what happened when the name changed and the
 * lookup for `query.slug` stopped matching.
 */
function originalPath(req: VercelRequest): string | null {
  const query = req.query || {};
  for (const value of Object.values(query)) {
    const segments = Array.isArray(value)
      ? value
      : typeof value === 'string' && value
        ? value.split('/')
        : null;
    if (segments && segments.length) {
      return `/api/${segments.map(encodeURIComponent).join('/')}`;
    }
  }
  return null;
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const rebuilt = originalPath(req);
  if (rebuilt && (!req.url || !req.url.startsWith('/api'))) {
    req.url = rebuilt;
  }

  // The dispatcher sets CORS itself from CORS_ORIGINS; the security headers
  // below are ours and are unconditional.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    handleRequest(req, res);
  } catch (err) {
    // A throw out of the dispatcher would otherwise become an opaque 500 page.
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = (err as { status?: number })?.status || 500;
    if (!res.headersSent) {
      res.status(status).json({ ok: false, error: message });
    }
  }
}

// Surfaced in the build log so a misconfigured deployment is obvious in CI
// rather than only in the browser.
if (IS_SERVERLESS && !process.env.DATABASE_URL) {
  console.warn(
    '[nexora-api] DATABASE_URL is not set. The JSON store cannot be used here '
    + '(serverless filesystems are read-only), so every write will fail until a '
    + 'PostgreSQL connection string is configured in the Vercel project.'
  );
}
