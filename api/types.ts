/**
 * Minimal Vercel function types.
 *
 * Declared locally rather than imported from `@vercel/node` so the function has
 * no extra dependency to install or to drift against. Only the surface actually
 * used is described, which is also what the dispatcher needs: the pieces of
 * Node's IncomingMessage/ServerResponse pair that it already relied on.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface VercelRequest extends IncomingMessage {
  /** Route parameters from the filename. `[[...slug]]` yields an array. */
  query: Record<string, string | string[] | undefined>;
  /**
   * The parsed body, populated by the runtime before the handler runs. On a
   * streaming Node server this is never set and the body arrives as a stream.
   */
  body?: unknown;
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): VercelResponse;
  send(body?: unknown): VercelResponse;
}

export type VercelHandler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;
