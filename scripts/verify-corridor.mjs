/**
 * verify-corridor.mjs — tests the REAL dry-corridor planner.
 *
 *   node --import ./scripts/register-ts.mjs scripts/verify-corridor.mjs
 *
 * Exercises src/services/corridorPlanner.ts directly, so it verifies shipped
 * code rather than a copy. Run via `npm run verify:corridor`.
 */
import { planDryCorridor, pointToSegmentM } from '../src/services/corridorPlanner.ts';

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ${C.green}PASS${C.reset}  ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ''}`); }
  else { fail += 1; console.log(`  ${C.red}FAIL${C.reset}  ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ''}`); }
}

// Chennai district centre and the seed shelters.
const CENTRE = { lat: 13.0827, lng: 80.2707 };
const SHELTERS = [
  { id: 'SHELTER-01', lat: 13.0587, lng: 80.2421 },
  { id: 'SHELTER-02', lat: 13.0479, lng: 80.2567 },
  { id: 'SHELTER-03', lat: 13.0146, lng: 80.2207 },
];
const OTteri = { id: 'ROAD-01', name: 'Otteri Nullah at Nungambakkam', lat: 13.056, lng: 80.282, reason: '1.4m standing floodwater', active: true };
const MAHABALIPURAM = { id: 'ROAD-02', name: 'Old Mahabalipuram Road at Sholinganallur', lat: 12.901, lng: 80.227, reason: 'Debris & 1.8m tidal surge', active: true };

console.log(`${C.bold}Dry-corridor planner verification${C.reset}\n`);

// ── Geometry helper ──────────────────────────────────────────────────────────
console.log(`${C.bold}${C.cyan}pointToSegmentM${C.reset}`);
check('a point on the line measures ~0', pointToSegmentM(0, 0, 0, 1, 0, 0.5).metres < 1);
check('a point 111m north measures ~111m', Math.abs(pointToSegmentM(0, 0, 0, 1, 0.001, 0.5).metres - 111.3) < 3,
  `${pointToSegmentM(0, 0, 0, 1, 0.001, 0.5).metres.toFixed(1)}m`);
check('a point beyond the end clamps to t=1', pointToSegmentM(0, 0, 0, 1, 0, 2).t === 1);

// ── No blockers ──────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}Clear corridor${C.reset}`);
const clear = planDryCorridor(CENTRE, SHELTERS[0], []);
check('no blockers -> 2 waypoints (straight line)', clear.waypoints.length === 2, `wp=${clear.waypoints.length}`);
check('no blockers -> DRY_CORRIDOR_SAFE', clear.riskRating === 'DRY_CORRIDOR_SAFE', clear.riskRating);
check('no blockers -> nothing avoided', clear.avoided.length === 0);

const inactive = planDryCorridor(CENTRE, SHELTERS[0], [{ ...OTteri, active: false }]);
check('an INACTIVE roadblock is ignored', inactive.riskRating === 'DRY_CORRIDOR_SAFE' && inactive.waypoints.length === 2);

// ── Blocker on the line ──────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}Blocker on the corridor${C.reset}`);
const target = SHELTERS[0];
const mid = { lat: (CENTRE.lat + target.lat) / 2, lng: (CENTRE.lng + target.lng) / 2 };
const onLine = planDryCorridor(CENTRE, target, [{ ...OTteri, lat: mid.lat, lng: mid.lng }]);

check('a blocker on the line is detected', onLine.onRoute.length === 1);
check('the route is no longer a straight line', onLine.waypoints.length === 3, `wp=${onLine.waypoints.length}`);
check('the midpoint actually moved', onLine.waypoints[1][0] !== mid.lat || onLine.waypoints[1][1] !== mid.lng,
  `moved ${(((onLine.waypoints[1][0] - mid.lat) * 111320)).toFixed(0)}m N-S`);
check('risk is downgraded, never "SAFE"', onLine.riskRating !== 'DRY_CORRIDOR_SAFE', onLine.riskRating);
check('the blocker is listed as avoided', onLine.avoided.length === 1);

const clearance = Math.min(
  pointToSegmentM(onLine.waypoints[0][0], onLine.waypoints[0][1], onLine.waypoints[1][0], onLine.waypoints[1][1], mid.lat, mid.lng).metres,
  pointToSegmentM(onLine.waypoints[1][0], onLine.waypoints[1][1], onLine.waypoints[2][0], onLine.waypoints[2][1], mid.lat, mid.lng).metres
);
check(`the detour clears the blocker by >320m`, clearance >= 320, `clearance=${clearance.toFixed(0)}m`);

// ── Blocker far off the line ─────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}Blocker off the corridor${C.reset}`);
const offLine = planDryCorridor(CENTRE, target, [{ ...OTteri, lat: CENTRE.lat + 0.5, lng: CENTRE.lng + 0.5 }]);
check('a distant blocker does not force a detour', offLine.waypoints.length === 2, `wp=${offLine.waypoints.length}`);
check('a distant blocker keeps the route SAFE', offLine.riskRating === 'DRY_CORRIDOR_SAFE', offLine.riskRating);

// ── Unavoidable: the shelter itself is cut off ───────────────────────────────
console.log(`\n${C.bold}${C.cyan}Unavoidable blockage${C.reset}`);
// A dense collinear wall IS clearable — a big enough lateral push walks the
// whole path off the line. The genuinely unavoidable case is a blocker sitting
// on the destination itself, which no midpoint push can route around.
const atShelter = planDryCorridor(CENTRE, target, [
  { id: 'AT-DEST', name: 'shelter access cut', lat: target.lat, lng: target.lng, reason: 'test', active: true },
]);
check('a blocker on the shelter is reported BLOCKED', atShelter.riskRating === 'BLOCKED', atShelter.riskRating);
check('a BLOCKED route still returns a path (so the map can show it)', atShelter.waypoints.length >= 2);
check('a BLOCKED route claims nothing was avoided', atShelter.avoided.length === 0);

// A collinear wall, by contrast, must be detoured rather than declared BLOCKED.
const wall = [];
for (let i = -6; i <= 6; i += 1) {
  const t = 0.32 + i * 0.03;
  wall.push({
    id: `WALL-${i}`, name: `wall ${i}`, active: true, reason: 'test',
    lat: CENTRE.lat + (target.lat - CENTRE.lat) * t,
    lng: CENTRE.lng + (target.lng - CENTRE.lng) * t,
  });
}
const walled = planDryCorridor(CENTRE, target, wall);
check('a collinear wall is detoured, not declared BLOCKED', walled.riskRating === 'CAUTION_SHALLOW_SURGE', walled.riskRating);
check('the wall is listed as avoided', walled.avoided.length === wall.length, `avoided=${walled.avoided.length}/${wall.length}`);

// ── Real seed data ───────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}Real seed roadblocks${C.reset}`);
for (const s of SHELTERS) {
  const plan = planDryCorridor(CENTRE, s, [OTteri, MAHABALIPURAM]);
  check(`${s.id}: planning succeeds`, !!plan.riskRating, `risk=${plan.riskRating} wp=${plan.waypoints.length} avoided=${plan.avoided.length}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}${'─'.repeat(46)}${C.reset}`);
console.log(fail === 0
  ? `${C.green}${C.bold}  ALL ${pass} CHECKS PASSED${C.reset}\n`
  : `${C.red}${C.bold}  ${fail} of ${pass + fail} CHECKS FAILED${C.reset}\n`);
process.exit(fail === 0 ? 0 : 1);
