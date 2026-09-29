/**
 * roster.mjs — manage the server-side officer roster.
 *
 * The backend decides a phone number's role from server/officers.json, never
 * from the request body. That is what stops anyone from signing in as a DDMO
 * officer by just asking for it — but it also means a genuine responder has to
 * be on the list. This adds them in one command.
 *
 *   npm run roster:add -- +919876543210 DDMO_OFFICER "K. Iyer"
 *   npm run roster:add -- 9876543210 FIELD_RESPONDER
 *   npm run roster
 *   npm run roster -- --remove +919876543210
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSTER_FILE = join(__dirname, '..', 'server', 'officers.json');

const GRANTABLE = ['DDMO_OFFICER', 'FIELD_RESPONDER', 'SHELTER_MANAGER'];

const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
};

function read() {
  if (!existsSync(ROSTER_FILE)) return { officers: [] };
  return JSON.parse(readFileSync(ROSTER_FILE, 'utf8'));
}

function write(data) {
  writeFileSync(ROSTER_FILE, JSON.stringify(data, null, 2));
}

const args = process.argv.slice(2);

if (args.includes('--remove')) {
  const phone = digits(args[args.indexOf('--remove') + 1]);
  const data = read();
  const before = data.officers.length;
  data.officers = data.officers.filter((o) => digits(o.phone) !== phone);
  write(data);
  console.log(
    data.officers.length < before
      ? `${C.green}Removed${C.reset} +91 ${phone} from the roster.`
      : `${C.yellow ?? '\x1b[33m'}+91 ${phone} was not on the roster.${C.reset}`
  );
  process.exit(0);
}

if (args.length === 0) {
  const data = read();
  console.log(`\n${C.bold}${C.cyan}SEOC officer roster${C.reset}  ${C.dim}${ROSTER_FILE}${C.reset}\n`);
  if (!data.officers.length) {
    console.log('  (empty — every number signs in as CITIZEN)');
  } else {
    console.log('  phone          role               name');
    console.log(`  ${'-'.repeat(52)}`);
    for (const o of data.officers) {
      console.log(
        `  +91 ${digits(o.phone).padEnd(12)} ${String(o.role).padEnd(18)} ${o.name || ''}`
      );
    }
  }
  console.log(`\n  Add:    ${C.bold}npm run roster:add -- +919876543210 DDMO_OFFICER "Name"${C.reset}`);
  console.log(`  Remove: ${C.bold}npm run roster -- --remove +919876543210${C.reset}\n`);
  process.exit(0);
}

const phone = digits(args[0]);
const role = (args[1] || '').toUpperCase();
const name = args.slice(2).join(' ') || null;

if (!/^[6-9]\d{9}$/.test(phone)) {
  console.error(`${C.red}Invalid phone${C.reset} — expected a 10-digit Indian mobile (6-9 start).`);
  process.exit(1);
}
if (!GRANTABLE.includes(role)) {
  console.error(`${C.red}Invalid role${C.reset} "${role}". Must be one of: ${GRANTABLE.join(', ')}`);
  process.exit(1);
}

const data = read();
const existing = data.officers.find((o) => digits(o.phone) === phone);
if (existing) {
  existing.role = role;
  if (name) existing.name = name;
  console.log(`${C.green}Updated${C.reset} +91 ${phone} → ${role}${name ? ` (${name})` : ''}`);
} else {
  data.officers.push({ phone, name, role });
  console.log(`${C.green}Added${C.reset} +91 ${phone} → ${role}${name ? ` (${name})` : ''}`);
}
write(data);
console.log(
  `${C.dim}No restart needed — the roster is re-read on every sign-in.${C.reset}\n`
);
