// A release ships code. Nothing ships the schema.
//
// deploy.yml builds and uploads to Netlify; no step has ever applied a
// migration. So a migration can be written, reviewed, pass CI, merge, and ride
// a release into production while its columns do not exist -- and the deploy
// goes green, because from the deploy's point of view nothing is wrong.
//
// That shipped twice on 2026-09-15. The second time, v1.9.0 went out with a
// Billing tab that reads payments.created_by, the column was not there, and
// every patient's ledger failed with
//
//   ERROR: 42703: column "created_by" does not exist
//
// until someone noticed. Nothing in the pipeline could have caught it.
//
// So this runs before the upload and fails the deploy when the database is
// behind the code. Deliberately a CHECK, not an apply: applying DDL to
// production as a side effect of a release is a much bigger promise than
// "these agree", it is the step most likely to need a human watching, and a
// failed deploy leaves production exactly as it was. What this buys is that
// the gap is impossible to miss.
//
// Comparing versions only means anything because the bookkeeping was
// reconciled first. schema_migrations had drifted from the repo: nineteen
// migrations were applied by a tool that stamps its OWN timestamp, so the same
// migration sat in the repo as 20260914171332_lead_marketing_consent and in
// the database as 20260915035219. Each was verified present by its actual
// objects -- tables, columns, indexes -- and recorded at its repo version, so
// the two now line up for every timestamped migration.
//
// If this ever reports something you are sure is applied, suspect that drift
// has restarted rather than the migration being missing, and confirm against
// the objects before recording anything by hand.
//
// Reads the database through psql rather than a Node driver. The project has
// no postgres client dependency and this is the only thing that would want
// one; ubuntu-latest ships psql already, so a new package in the lockfile --
// installed on every CI job of every PR -- would cost more than it saves.
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DIR = 'supabase/migrations'
const { SUPABASE_DB_URL } = process.env

if (!SUPABASE_DB_URL) {
  // Not silently skipped: a check that quietly passes when it cannot run is
  // worse than no check, because the green tick still reads as "verified".
  console.error('check:migrations-applied needs SUPABASE_DB_URL (the project\'s pooler connection string).')
  console.error('Set it as a repository secret so the deploy can reach the database.')
  process.exit(1)
}

// Timestamped migrations only -- the ones written under the current
// convention, which is every migration added since 13 Sep.
//
// The hand-numbered files (0001..0174) cannot be checked this way and must not
// be. They predate the database recording anything reliable: all 172 are long
// applied, but they are stored with a GENERATED timestamp as the version and
// the hand-number folded into the name -- `0165_clinic_code_lookup` is version
// 20260911135143 -- and 29 of them, `0001_init_schema` among them, are not in
// schema_migrations under any spelling at all. Comparing versions reports every
// one of them as missing, which is what the first version of this check did on
// its first real run: 174 false alarms and a stopped deploy.
//
// This is not a gap, because that set cannot grow: check-migration-versions.mjs
// refuses any NEW hand-numbered file, so anything added from here on is
// timestamped and therefore checked. The two scripts are load-bearing for each
// other -- weaken that rule and migrations start escaping this one silently.
const TIMESTAMP_VERSION = /^\d{14}_/
const repoVersions = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && TIMESTAMP_VERSION.test(f))
  .map((f) => ({ version: f.split('_')[0], file: f }))

let rows
try {
  // -A -t: unaligned, tuples only, so the output is one bare version per line.
  //
  // The URL is split into the individual PG* variables rather than passed as
  // an argument, so the password is never in argv where anything else on the
  // runner could read it out of `ps`. Not PGDATABASE-as-a-URI: libpq only
  // treats a dbname as a conninfo string when it arrives as a connection
  // parameter, not from the environment, and psql then falls through to peer
  // auth as whatever user it is running as.
  const url = new URL(SUPABASE_DB_URL)
  rows = execFileSync(
    'psql',
    ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'select version from supabase_migrations.schema_migrations'],
    {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
        // Supabase refuses plaintext connections; honour an explicit
        // sslmode in the URL so a local run against a non-TLS database
        // still works.
        PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
        PGCONNECT_TIMEOUT: '15',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
} catch (err) {
  // Never treated as "no migrations applied": that would report every
  // migration as missing and stop the deploy for the wrong reason, sending
  // whoever reads it looking for a schema problem that does not exist.
  console.error('Could not read schema_migrations from the database.')
  console.error(String(err.stderr || err.message).trim())
  process.exit(1)
}

const applied = new Set(rows.split('\n').map((l) => l.trim()).filter(Boolean))

const missing = repoVersions.filter((m) => !applied.has(m.version))

if (missing.length > 0) {
  console.error(`${missing.length} migration(s) in this build are NOT applied to the database:\n`)
  for (const m of missing) console.error(`  ${m.file}`)
  console.error('\nThe deploy is stopped because the code would go live against a schema that')
  console.error('cannot serve it. Apply them, then re-run this deploy:\n')
  console.error('  supabase db push\n')
  process.exit(1)
}

console.log(`${repoVersions.length} timestamped migrations, all applied to the database.`)
