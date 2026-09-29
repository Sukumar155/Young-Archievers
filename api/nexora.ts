/**
 * api/nexora.ts — the NEXORA bridge, as a single Vercel serverless function.
 *
 * One function, one rewrite, no wildcard semantics. Two earlier approaches were
 * deployed and measured against the live site, and both failed in the same way:
 *
 *   api/[[...slug]].ts   ->  /api/health worked, /api/auth/otp/status 404'd
 *   api/[...path].ts     ->  identical
 *   api/<dir>/<route>.ts ->  every file directly in api/ deployed; every file
 *                           in a subdirectory of api/ silently did not
 *
 * The last one is the decisive observation: a catch-all is not the problem, and
 * neither is the dispatcher. Only routes at the top level of api/ are being
 * deployed in this project. So there is exactly one function, it sits at the top
 * level, and vercel.json rewrites every /api/* path to it with the real path
 * passed along in a query parameter.
 *
 *   /api/auth/otp/status  ->  /api/nexora?p=auth/otp/status
 *
 * The handler reconstructs /api/<p> and hands it to handleRequest, which is the
 * same dispatcher `npm start` uses — one routing table, so the local server and
 * the deployed function cannot drift apart.
 */
import { handleRequest } from '../server/sos-server.mjs';
import type { VercelRequest, VercelResponse } from './_lib/types.js';

/**
 * The chat route calls an external AI provider with retries, so the default 10s
 * function timeout is not enough on a cold start.
 */
export const config = { maxDuration: 60 };

/** Reassemble the original path from the rewrite's `p` parameter. */
function originalPath(req: VercelRequest): string | null {
  const q = req.query || {};
  for (const key of ['p', 'path', 'slug']) {
    const value = q[key];
    if (typeof value === 'string' && value) return `/api/${value.replace(/^\/+|\/+$/g, '')}`;
    if (Array.isArray(value) && value.length) return `/api/${value.map(encodeURIComponent).join('/')}`;
  }
  return null;
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const rebuilt = originalPath(req);

  // req.url on a rewritten request points at the destination, not the original,
  // so the path has to come from the query parameter. If neither is usable,
  // say so plainly — a wrong-path 404 is indistinguishable from a routing bug.
  if (rebuilt) {
    req.url = rebuilt;
  } else if (!req.url || !req.url.startsWith('/api')) {
    res.status(500).json({
      ok: false,
      error: 'Routing error: this function was reached without a usable API path.',
      detail: `req.url was ${JSON.stringify(req.url)} and no ?p= parameter was present. `
            + 'The vercel.json rewrite is probably missing. Run `npm run verify:routing`.',
    });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = (err as { status?: number })?.status || 500;
    if (!res.headersSent) res.status(status).json({ ok: false, error: message });
  }
}
