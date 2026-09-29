/**
 * ts-hooks.mjs — lets plain `node` import the app's TypeScript.
 *
 * The app's source uses extensionless specifiers (`from '../types/sos'`), which
 * Vite resolves but Node's ESM resolver does not. Registering this hook makes
 * `node scripts/*.mjs` able to import real app modules, so the smoke tests
 * exercise the shipped code instead of a copy of it.
 */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js'];

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    // Bare/absolute specifiers and real packages must not be retried.
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err;
    for (const ext of CANDIDATES) {
      try {
        return await next(specifier + ext, context);
      } catch {
        /* try the next extension */
      }
    }
    throw err;
  }
}
