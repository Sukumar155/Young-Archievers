/**
 * verify-css-valid.mjs — is tokens.css structurally valid CSS?
 *
 * The defect that broke dark mode was a run of bare `--name: value` pairs at the
 * top level, outside any rule. That is not valid CSS: the parser folds them
 * into the preceding rule and swallows whatever follows, which is how the
 * `[data-theme="dark"]` block was being dropped from the bundle.
 *
 * A type-check cannot see this and a minifier does not report it, so it needs
 * its own check. Three assertions:
 *
 *   1. brace balance, ignoring braces inside comments
 *   2. comment balance
 *   3. no top-level declaration — every `--name:` must sit inside a rule
 *
 * Plus the outcome that actually matters: build the file and confirm the dark
 * block is present in the emitted CSS.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'src/design-system/tokens.css';
const raw = readFileSync(FILE, 'utf8');

let bad = 0;
const fail = (m) => { bad += 1; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

/* ---- 1. brace balance, ignoring comments ---- */
const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
let depth = 0;
let minDepth = 0;
for (const c of noComments) {
  if (c === '{') depth += 1;
  else if (c === '}') { depth -= 1; if (depth < minDepth) minDepth = depth; }
}
if (depth !== 0) fail(`brace balance is ${depth} (expected 0)`);
else pass('braces balanced');
if (minDepth < 0) fail('a closing brace appears before its opening');
else pass('no premature closing brace');

/* ---- 2. comment balance ---- */
let cOpen = 0;
for (const m of raw.matchAll(/\/\*|\*\//g)) {
  if (m[0] === '/*') cOpen += 1; else cOpen -= 1;
  if (cOpen < 0) break;
}
if (cOpen !== 0) fail(`comment balance is ${cOpen} (unterminated comment?)`);
else pass('comments balanced');

/* ---- 3. no top-level declarations ---- */
let d = 0;
let topLevel = 0;
const offenders = [];
let i = 0;
const src = noComments;
while (i < src.length) {
  const c = src[i];
  if (c === '{') d += 1;
  else if (c === '}') d -= 1;
  else if (d === 0 && c === '-' && src.startsWith('--', i)) {
    const m = /^\s*--[a-z0-9-]+\s*:/.exec(src.slice(i));
    if (m) {
      topLevel += 1;
      if (offenders.length < 5) {
        offenders.push(src.slice(i, i + m[0].length).trim().replace(/\s+/g, ' '));
      }
    }
  }
  i += 1;
}
if (topLevel > 0) {
  fail(`${topLevel} top-level declaration(s) outside any rule — this is what killed the dark block`);
  offenders.forEach((o) => console.log(`           ${o}`));
} else {
  pass('every custom property is declared inside a rule');
}

/* ---- 4. the outcome: does the dark block survive a real build? ---- */
const root = process.cwd();
const dir = mkdtempSync(join(root, '.cssv-'));
try {
  mkdirSync(join(dir, 'src', 'design-system'), { recursive: true });
  writeFileSync(join(dir, 'src', 'design-system', 'tokens.css'), raw, 'utf8');
  writeFileSync(join(dir, 'src', 'style.css'), '@import "tailwindcss";\n@import "./design-system/tokens.css";\n', 'utf8');
  writeFileSync(join(dir, 'src', 'main.js'), 'import "./style.css"\nconsole.log("dark:text-[#FFFFFF]")\n', 'utf8');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/src/main.js"></script></body></html>', 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
  writeFileSync(join(dir, 'vite.config.js'), 'import { defineConfig } from "vite"\nimport tailwindcss from "@tailwindcss/vite"\nexport default defineConfig({ plugins: [tailwindcss()] })\n', 'utf8');
  execFileSync('npx.cmd', ['vite', 'build', '--logLevel', 'error'], { cwd: dir, stdio: 'pipe', timeout: 300000, shell: true });
  const assets = join(dir, 'dist', 'assets');
  let css = '';
  if (existsSync(assets)) {
    const f = readdirSync(assets).find((x) => x.endsWith('.css'));
    css = f ? readFileSync(join(assets, f), 'utf8') : '';
  } else {
    const m = readFileSync(join(dir, 'dist', 'index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/);
    css = m ? m[1] : '';
  }
  /* Values are matched loosely on purpose. Lightning CSS rewrites `#FFFFFF`
     to `#fff` and lowercases hexes, so an exact `#ffffff` needle reports a
     failure on a build that is actually correct. */
  if (/--nx-canvas:\s*#212121/i.test(css)) pass('dark canvas token survives the build');
  else fail('dark canvas token STILL dropped from the build');
  if (/--color-text-primary:\s*#(?:fff|ffffff)\b/i.test(css)) pass('dark text-primary token survives the build');
  else fail('dark text-primary token dropped from the build');
  if (/--color-text-secondary:\s*#e0e0e0/i.test(css)) pass('dark text-secondary token survives the build');
  else fail('dark text-secondary token dropped from the build');
  /* The light component ramps must NOT be scoped to the dark selectors —
     that made dark mode inherit light greys and merged the two rules. */
  const rampLeak = /\[data-theme=["']?dark["']?\]?[^{}]*\{[^}]*--color-line:\s*#e4e4e0/i.test(css);
  if (rampLeak) fail('light component ramp is scoped to the dark selector — dark mode inherits light greys');
  else pass('light component ramps are not scoped to dark selectors');
} catch (e) {
  fail(`build error: ${`${e.stdout || ''}${e.stderr || ''}`.slice(0, 200).trim()}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(bad === 0 ? '\ntokens.css is valid and the dark block ships' : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
