/**
 * api/index.ts — the browsable view of the bridge, served at /api.
 *
 * /api itself does not match the `/api/(.*)` rewrite in vercel.json, so it
 * reaches this file by plain filesystem routing. It is at the top level of api/
 * because subdirectories of api/ did not deploy in this project.
 */
import { handleRequest } from '../server/sos-server.mjs';
import type { VercelRequest, VercelResponse } from './_lib/types.js';

export const config = { maxDuration: 60 };

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (!req.url) req.url = '/api';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = (err as { status?: number })?.status || 500;
    if (!res.headersSent) res.status(status).json({ ok: false, error: message });
  }
}
