// Two branches, two migrations, one number.
//
// Migrations used to be numbered by hand -- 0173, 0174, 0175 -- and the next
// free number is whatever main happens to show when you start. Two branches
// open at once both read 0174 and both take it. Git sees no conflict, because
// the filenames differ; GitHub reports the PR as cleanly mergeable. The break
// only appears when someone builds a database:
//
//   Applying migration 0174_bono_outstanding_from_practicehub.sql...
//   Applying migration 0174_whatsapp_webhook_authentication.sql...
//   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
//   Key (version)=(0174) already exists.
//
// The reset never finishes, so every Cypress shard fails and no fresh
// environment can be built at all. That happened between #201 and #202, and
// the gaps at 0126 and 0169 are older numbers claimed and abandoned.
//
// CI builds each PR from a merge commit against CURRENT main, so running this
// there catches the collision on the next run -- no rebase needed, and no
// branch-protection plan to pay for. New migrations are timestamped
// (supabase migration new), which cannot collide; this guards the ones that
// are still hand-numbered, and any hand-numbered file added by mistake.
import { readdirSync } from 'node:fs'

const DIR = 'supabase/migrations'
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'))

const byVersion = new Map()
const malformed = []
for (const file of files) {
  // Both shapes: 0174_name.sql (legacy) and 20260913082934_name.sql (new).
  const match = /^(\d+)_/.exec(file)
  if (!match) {
    malformed.push(file)
    continue
  }
  const version = match[1]
  if (!byVersion.has(version)) byVersion.set(version, [])
  byVersion.get(version).push(file)
}

const collisions = [...byVersion.entries()].filter(([, f]) => f.length > 1)

if (malformed.length > 0) {
  console.error(`Migration files must start with a version and an underscore:\n${malformed.map((f) => `  ${DIR}/${f}`).join('\n')}`)
}
for (const [version, names] of collisions) {
  console.error(`Two migrations claim version ${version}:\n${names.map((f) => `  ${DIR}/${f}`).join('\n')}`)
}
if (malformed.length > 0 || collisions.length > 0) {
  console.error('\nRename the newer one. Prefer a timestamp -- `supabase migration new <name>` -- which no other branch can take.')
  process.exit(1)
}

console.log(`${files.length} migrations, no duplicate versions.`)
