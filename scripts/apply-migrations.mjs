// Applying the migrations the database does not have yet.
//
// `supabase db push` cannot do this here, and the reason is not a
// misconfiguration that can be fixed with a flag. It refuses unless the local
// migrations directory is a SUPERSET of the remote history, and this
// repository can never satisfy that: the hand-numbered migrations exist as
// files named 0001_init_schema.sql .. 0174_*.sql, but the database records
// them under GENERATED timestamps with the number folded into the name --
// `0165_clinic_code_lookup` is version 20260911135143. So push sees ~170
// remote versions with no local file and stops:
//
//   Remote migration versions not found in local migrations directory.
//
// That fired on the first migration to merge after the workflow was added,
// which meant the migration silently did not apply. The failure is not
// specific to that migration; it will happen on every merge, forever, because
// nothing about the historical bookkeeping is going to change.
//
// The repair the CLI suggests is worse than the problem. `migration repair
// --status reverted` deletes those history rows -- after which push would see
// 0001..0174 as unapplied local files and try to RUN them against a populated
// production database. The safe move is not to reconcile that history at all.
//
// So: apply only the TIMESTAMPED migrations that are missing, in version
// order, and record each one at its repo version. That is the same set
// check-migrations-applied.mjs compares, for the same reason -- the
// hand-numbered files predate reliable recording, all 172 are long applied,
// and 29 are not in schema_migrations under any spelling. The two scripts
// agree on what "a migration" means, so the apply and the check that guards
// the deploy cannot disagree about whether the database is up to date.
//
// This set cannot grow: check-migration-versions.mjs refuses any new
// hand-numbered file, so everything added from here on is timestamped and
// therefore both applied and checked by these two.
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const { SUPABASE_DB_URL } = process.env

if (!SUPABASE_DB_URL) {
  console.error('apply:migrations needs SUPABASE_DB_URL (the project\'s pooler connection string).')
  process.exit(1)
}

const TIMESTAMP_VERSION = /^(\d{14})_(.+)\.sql$/

const repo = readdirSync(DIR)
  .map((f) => ({ f, m: TIMESTAMP_VERSION.exec(f) }))
  .filter((x) => x.m)
  .map(({ f, m }) => ({ version: m[1], name: m[2], file: f }))
  .sort((a, b) => a.version.localeCompare(b.version))

// Split out of the URL rather than passed as an argument, so the password is
// never in argv where anything else on the runner could read it out of `ps`.
const url = new URL(SUPABASE_DB_URL)
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
  PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
  PGCONNECT_TIMEOUT: '15',
}

function psql(args, input) {
  return execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], {
    env,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

let applied
try {
  applied = new Set(
    psql(['-c', 'select version from supabase_migrations.schema_migrations'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )
} catch (err) {
  // Never treated as "nothing applied": that would try to re-run every
  // migration in the repository against production.
  console.error('Could not read schema_migrations from the database. Nothing was applied.')
  console.error(err.stderr?.toString?.() ?? err.message)
  process.exit(1)
}

const pending = repo.filter((m) => !applied.has(m.version))

if (pending.length === 0) {
  console.log(`Database is up to date (${repo.length} timestamped migrations, none pending).`)
  process.exit(0)
}

console.log(`${pending.length} migration(s) to apply:`)
for (const m of pending) console.log(`  ${m.version}  ${m.name}`)

for (const m of pending) {
  const sql = readFileSync(join(DIR, m.file), 'utf8')

  // The DDL and the history row go in ONE transaction. Recorded separately,
  // a crash between them leaves a migration applied but unrecorded -- which
  // the next run would try to apply a second time, and which
  // check-migrations-applied would meanwhile report as missing.
  //
  // psql -1 is what makes it a single transaction, so a migration that fails
  // halfway leaves the database exactly as it was. A migration needing
  // something that cannot run inside a transaction (CREATE INDEX
  // CONCURRENTLY, say) would fail loudly here rather than half-apply; none
  // do today, and one that did should say so in review.
  const stamped = `${sql}\n\ninsert into supabase_migrations.schema_migrations (version, name)\nvalues ('${m.version}', '${m.name.replace(/'/g, "''")}')\non conflict (version) do nothing;\n`

  // Piped on stdin rather than written to a temp file: the migration text
  // never lands on the runner's disk, and there is no cleanup to get wrong
  // on the failure path.
  try {
    process.stdout.write(`Applying ${m.version}_${m.name} ... `)
    psql(['-1'], stamped)
    console.log('ok')
  } catch (err) {
    console.log('FAILED')
    console.error(err.stderr?.toString?.() ?? err.message)
    console.error(`\nStopped at ${m.version}_${m.name}. It was rolled back, and nothing after it was attempted.`)
    process.exit(1)
  }
}

console.log(`Applied ${pending.length} migration(s).`)
