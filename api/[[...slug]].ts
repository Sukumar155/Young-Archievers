/**
 * api/[[...slug]].ts — the NEXORA bridge, as a Vercel serverless function.
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
 * `[[...slug]]` is an optional catch-all, so /api/health, /api/sos,
 * /api/auth/otp/request and /api/alerts/abc all land in this one function with
 * their full path intact in req.url.
 */
import { handleRequest, IS_SERVERLESS } from '../server/sos-server.mjs';
import type { VercelRequest, VercelResponse } from './types.js';

export const config = {
  // The chat route calls an external AI provider with retries, so the default
  // 10s function timeout is not enough on a cold start.
  maxDuration: 60,
};

export default function handler(req: VercelRequest, res: VercelResponse): void {
  // Reconstruct the original path. A catch-all receives the matched segments,
  // and the dispatcher matches on the full pathname, so it has to be rebuilt
  // rather than read from req.url (which some runtimes leave as just "/api").
  const slug = req.query?.slug;
  const rebuilt = Array.isArray(slug)
    ? `/api/${slug.map(encodeURIComponent).join('/')}`
    : typeof slug === 'string' && slug
      ? `/api/${slug.split('/').map(encodeURIComponent).join('/')}`
      : '/api';

  if (!req.url || !req.url.startsWith('/api')) {
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
