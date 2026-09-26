/**
 * dev-all.mjs — run the NEXORA SOS backend bridge AND the Vite dev server
 * together from a single command (no extra npm dependencies required).
 *
 * Usage:  npm run dev:all
 *
 * - SOS backend  -> http://localhost:3001   (node server/sos-server.mjs)
 * - Vite app     -> http://localhost:5173   (proxies /api -> :3001)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SERVER_FILE = join(ROOT, 'server', 'sos-server.mjs');
const isWin = process.platform === 'win32';

const children = [];
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping NEXORA dev processes...');
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function start(name, cmd, args) {
  // On Windows `shell: true` means the args are concatenated into a single
  // command line and re-split by cmd.exe, so any path containing spaces
  // (e.g. "C:\Users\me\my project\...") must be quoted or node resolves a
  // truncated path and fails with MODULE_NOT_FOUND.
  const spawnArgs = isWin ? args.map((arg) => `"${arg}"`) : args;
  const child = spawn(cmd, spawnArgs, { stdio: 'inherit', cwd: ROOT, shell: isWin });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev-all] "${name}" exited with code ${code ?? 'null'}`);
      shutdown();
    }
  });
  child.on('error', (err) => {
    console.error(`[dev-all] Failed to start "${name}":`, err.message);
    shutdown();
  });
}

start('sos-server', 'node', [SERVER_FILE]);
start('vite', isWin ? 'npx.cmd' : 'npx', ['vite']);

console.log('[dev-all] NEXORA dev environment starting...');
console.log('[dev-all]   Backend : http://localhost:3001  (SOS bridge)');
console.log('[dev-all]   App     : http://localhost:5173  (Vite)');