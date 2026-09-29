/**
 * register-ts.mjs — entry point that installs the TypeScript resolver hook.
 * Used via:  node --import ./scripts/register-ts.mjs <script>
 */
import { register } from 'node:module';
register('./ts-hooks.mjs', import.meta.url);
