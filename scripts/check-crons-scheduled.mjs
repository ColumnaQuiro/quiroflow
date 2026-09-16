// A cron endpoint that nothing ever calls.
//
// Scheduling is not in a migration and never has been: cron.schedule needs the
// deployment's real URL and NUXT_CRON_SECRET, which exist only for the
// production project, so 0081_enable_pg_cron.sql says outright that the
// schedule "is applied separately there". Separately means by hand, and by
// hand means it can be missed -- silently, because an endpoint nobody calls
// looks exactly like an endpoint with nothing to do.
//
// That is what happened to lead-sequence-cron. It was written, reviewed,
// tested, merged and deployed on 14 Sep, and on 16 Sep it had never run once:
// no job existed. Every lead drip would have started, sent its first message,
// parked at the first delay and stayed there forever. It went unnoticed for
// two days only because a separate bug was cancelling every run before it
// reached a delay -- one failure hiding another.
//
// So: every *-cron.post.ts under server/api must have a pg_cron job pointing
// at it. Matching on the endpoint path inside the job's command, not on the
// job name, because the names are descriptive rather than derived
// (same-day-cron is scheduled as appointment-same-day-15min) and a rule about
// names would be a rule about nothing.
//
// Runs in the deploy beside check:migrations-applied, for the same reason and
// with the same shape: a check, never a fix. Scheduling a job needs the secret
// and a decision about frequency, neither of which belongs in a release.
import { readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = 'server/api'
const { SUPABASE_DB_URL } = process.env

if (!SUPABASE_DB_URL) {
  // Not silently skipped: a check that quietly passes when it cannot run is
  // worse than no check, because the green tick still reads as "verified".
  console.error("check:crons-scheduled needs SUPABASE_DB_URL (the project's pooler connection string).")
  console.error('Set it as a repository secret so the deploy can reach the database.')
  process.exit(1)
}

/** Every `*-cron.post.ts` under server/api, as the path a job would call. */
function findCronEndpoints(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...findCronEndpoints(full))
      continue
    }
    if (!entry.endsWith('-cron.post.ts')) continue
    // server/api/automations/birthday-cron.post.ts -> api/automations/birthday-cron
    found.push({ route: full.replace(/^server\//, '').replace(/\.post\.ts$/, ''), file: full })
  }
  return found
}

const endpoints = findCronEndpoints(ROOT)

let commands
try {
  // The URL is split into PG* variables rather than passed as an argument, so
  // the password is never in argv where anything else on the runner could read
  // it out of `ps` -- same handling as check-migrations-applied.
  //
  // Only `active` jobs count. A job that exists but is switched off calls the
  // endpoint exactly as often as no job at all.
  const url = new URL(SUPABASE_DB_URL)
  commands = execFileSync(
    'psql',
    ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', "select command from cron.job where active"],
    {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
        PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
        PGCONNECT_TIMEOUT: '15',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
} catch (err) {
  // Never treated as "no jobs scheduled": that would report every endpoint as
  // unscheduled and stop the deploy for the wrong reason, sending whoever
  // reads it hunting for a cron problem that does not exist.
  console.error('Could not read cron.job from the database.')
  console.error(String(err?.stderr || err?.message || err).trim())
  process.exit(1)
}

// One command per line is not safe to assume -- a net.http_post call spans
// several lines -- so the whole result is searched as one blob. Which job
// matched does not matter; that one exists does.
const allCommands = commands

const unscheduled = endpoints.filter((e) => !allCommands.includes(e.route))

if (unscheduled.length > 0) {
  console.error(`\n${unscheduled.length} cron endpoint(s) have no active pg_cron job:\n`)
  for (const e of unscheduled) console.error(`  ${e.file}  ->  nothing calls /${e.route}`)
  console.error(`
Schedule it against the production database, cloning an existing job so the
URL and secret header stay identical:

  select cron.schedule(
    '<name>-15min',
    '*/15 * * * *',
    (select replace(command, 'same-day-cron', '<this-endpoint>')
     from cron.job where jobname = 'appointment-same-day-15min')
  );
`)
  process.exit(1)
}

console.log(`${endpoints.length} cron endpoints, all scheduled.`)
