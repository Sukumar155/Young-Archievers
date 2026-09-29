/**
 * apiErrors.ts — one honest explanation for a failed bridge call.
 *
 * The bug this replaces: PhoneLogin caught a failed OTP request and reported
 * "Could not send the verification code. Please try again." when the real cause
 * was that no backend was reachable at all. On a static-only deployment every
 * /api route 404s, the JSON parse throws, and the operator sees an SMS error
 * for what is a connectivity problem. That sends people hunting for SMS
 * provider credentials that were never the problem.
 *
 * Distinguishes three cases the user can act on differently:
 *   - the bridge is not there at all   (misconfigured URL / not deployed)
 *   - the bridge is there but refusing this origin (CORS)
 *   - the bridge answered with a real error (rate limit, bad OTP, ...)
 */
import { API_BASE } from './sosApi';

/** True when the request never reached a working bridge. */
export function isBridgeUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // fetch() rejects with a TypeError on DNS/connection/CORS failure.
  return err.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(err.message);
}

/**
 * True when a response was received but has no JSON body — which is what a
 * static host returns for an unknown /api path (the SPA index.html, or a 404
 * page). A real bridge always answers with JSON.
 */
export function looksLikeMissingApi(res: Response): boolean {
  if (res.ok) return false;
  if (res.status === 404) return true;
  const type = res.headers.get('content-type') || '';
  return !type.includes('application/json');
}

/**
 * A message that names the actual problem, with the concrete next step.
 * `what` is a short human label for the action, e.g. "send the verification code".
 */
export function describeApiFailure(err: unknown, what = 'complete that action'): string {
  if (isBridgeUnreachable(err)) {
    const target = API_BASE || 'the current origin (no VITE_API_URL set)';
    return (
      `Cannot reach the NEXORA backend at ${target}, so ${what} was never attempted. `
      + 'The API is not running there.'
    );
  }
  const message = (err as Error)?.message || 'Unknown error';
  return message;
}

/** Message for a response that arrived but was not JSON (missing API route). */
export function describeMissingApi(what = 'complete that action'): string {
  const target = API_BASE || 'the current origin (no VITE_API_URL set)';
  return (
    `The NEXORA backend has no route at ${target} — the request returned a page, `
    + `not API JSON, so ${what} was never attempted.`
  );
}
