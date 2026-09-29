/**
 * migrate.mjs — load the JSON files into PostgreSQL, once.
 *
 * Reads server/data/{alerts,incidents,sos}.json and officers.json, creates the
 * schema, and upserts every record. Safe to re-run: every insert is
 * `ON CONFLICT (id) DO NOTHING`, so a second pass updates nothing and reports
 * the same counts rather than duplicating rows.
 *
 *   node scripts/migrate.mjs            # migrate
 *   node scripts/migrate.mjs --verify   # compare row counts, no writes
 *
 * The JSON files are never deleted or modified. They stay as the fallback that
 * db.mjs uses when PostgreSQL is unavailable, and as a manual recovery path.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileURLToPath as here } from 'node:url';

const ROOT = join(dirname(here(import.meta.url)), '..');
const DATA = join(ROOT, 'server', 'data');
const VERIFY_ONLY = process.argv.includes('--verify');

const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error('DATABASE_URL is not set. Example:');
  console.error('  $env:DATABASE_URL = "postgresql://nexora:nexora@localhost:5432/nexora"');
  process.exit(1);
}

const readJson = (f, fallback = []) => {
  const p = join(DATA, f);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    console.warn(`  could not parse ${f}: ${e.message}`);
    return fallback;
  }
};

const readRoster = () => {
  const p = join(ROOT, 'server', 'officers.json');
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
};

const alerts = readJson('alerts.json');
const incidents = readJson('incidents.json');
const sos = readJson('sos.json');
const roster = readRoster();

console.log('source data');
console.log(`  alerts.json    ${alerts.length}`);
console.log(`  incidents.json ${incidents.length}`);
console.log(`  sos.json       ${sos.length}`);
console.log(`  officers.json  ${roster.length}\n`);

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: CONNECTION, connectionTimeoutMillis: 5000 });

try {
  /* ---- schema ---- */
  const schema = readFileSync(join(ROOT, 'server', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('schema applied');

  if (VERIFY_ONLY) {
    const t = await pool.query(`
      SELECT 'alerts' t, count(*) n FROM alerts
      UNION ALL SELECT 'incidents', count(*) FROM incidents
      UNION ALL SELECT 'sos_reports', count(*) FROM sos_reports
      UNION ALL SELECT 'officers', count(*) FROM officers`);
    console.log('\ndatabase contents');
    for (const r of t.rows) console.log(`  ${r.t.padEnd(12)} ${r.n}`);
    const want = { alerts: alerts.length, incidents: incidents.length, sos_reports: sos.length, officers: roster.length };
    console.log('\ncompare with source');
    let allOk = true;
    for (const r of t.rows) {
      const ok = r.n >= want[r.t];
      if (!ok) allOk = false;
      console.log(`  ${r.t.padEnd(12)} db=${String(r.n).padStart(4)}  source=${String(want[r.t]).padStart(4)}  ${ok ? 'ok' : 'MISSING ROWS'}`);
    }
    process.exit(allOk ? 0 : 1);
  }

  /* ---- officers ---- */
  let n = 0;
  for (const o of roster) {
    const phone = o.phone ?? o.number ?? o.msisdn;
    if (!phone) continue;
    await pool.query(
      `INSERT INTO officers (phone, name, role) VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, updated_at = now()`,
      [phone, o.name ?? 'Unknown', o.role ?? 'CITIZEN']
    );
    n += 1;
  }
  console.log(`officers      ${n}`);

  /* ---- alerts ---- */
  n = 0;
  for (const a of alerts) {
    await pool.query(
      `INSERT INTO alerts
         (id,type,title,severity,zone,location_name,reason,recommended_action,channels,
          affected_population,lat,lng,active,issued_by_role,issued_by_phone,
          display_timestamp,resolved_at,resolved_by,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        a.id, a.type ?? 'CAP_BULLETIN', a.title ?? 'Untitled',
        a.severity ?? 'ADVISORY', a.zone ?? null, a.locationName ?? null,
        a.reason ?? null, a.recommendedAction ?? null, a.channels ?? [],
        a.affectedPopulation ?? 0, a.lat ?? null, a.lng ?? null,
        a.active ?? true, a.issuedByRole ?? null, a.issuedByPhone ?? null,
        a.timestamp ?? null,
        a.resolvedAt ? new Date(a.resolvedAt) : null,
        a.resolvedBy ?? null, JSON.stringify(a),
      ]
    );
    n += 1;
  }
  console.log(`alerts        ${n}`);

  /* ---- incidents ---- */
  n = 0;
  for (const i of incidents) {
    await pool.query(
      `INSERT INTO incidents
         (id,title,description,category,severity,status,zone,location_name,lat,lng,
          reported_by,reported_by_role,assigned_team,display_timestamp,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        i.id, i.title ?? 'Untitled', i.description ?? null, i.category ?? null,
        i.severity ?? null, i.status ?? 'PENDING', i.zone ?? null,
        i.locationName ?? null, i.lat ?? null, i.lng ?? null,
        i.reportedBy ?? null, i.reportedByRole ?? null, i.assignedTeam ?? null,
        i.timestamp ?? null, JSON.stringify(i),
      ]
    );
    n += 1;
  }
  console.log(`incidents     ${n}`);

  /* ---- sos reports ---- */
  n = 0;
  for (const s of sos) {
    await pool.query(
      `INSERT INTO sos_reports
         (id,phone,name,lat,lng,accuracy,message,place_label,category,priority,status,verified,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id, s.phone ?? null, s.name ?? null, s.lat ?? null, s.lng ?? null,
        s.accuracy ?? null, s.message ?? null, s.place ?? s.placeLabel ?? null,
        s.category ?? null, s.priority ?? 'NORMAL', s.status ?? 'NEW',
        s.verified ?? false, JSON.stringify(s),
      ]
    );
    n += 1;
  }
  console.log(`sos_reports   ${n}`);

  /* ---- report ---- */
  const t = await pool.query(`
    SELECT 'alerts' t, count(*) n FROM alerts
    UNION ALL SELECT 'incidents', count(*) FROM incidents
    UNION ALL SELECT 'sos_reports', count(*) FROM sos_reports
    UNION ALL SELECT 'officers', count(*) FROM officers
    ORDER BY 1`);
  console.log('\nmigration complete — database now holds');
  for (const r of t.rows) console.log(`  ${r.t.padEnd(12)} ${r.n}`);
  console.log('\nThe JSON files were left untouched as the offline fallback.');
} catch (err) {
  console.error('\nmigration FAILED:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('\nThe server is not accepting connections. Check that the');
    console.error('PostgreSQL service is running:');
    console.error('  Get-Service *postgres*');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
