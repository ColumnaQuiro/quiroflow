#!/usr/bin/env node
// Fails when a new migration removes something the code still uses.
//
// Migrations are applied ON MERGE now (.github/workflows/migrate.yml), while a
// release ships the code separately and later. So between the two, production
// runs the CODE THAT IS ALREADY LIVE against the NEW schema. A migration that
// drops a column, a table or a function the live code still references takes
// production down in that window, and the deploy gate cannot catch it: the
// database is ahead, not behind, which is exactly what it checks for.
//
// That window existed before this was automated -- it was just as long as it
// took someone to notice the failing deploy. Automating the apply makes it
// short and reliable, which is an improvement, but it also makes it certain.
// This is the other half of that trade.
//
// What it does NOT do is understand SQL. It looks for the removals that break
// live code, takes the identifier, and asks whether the identifier still
// appears anywhere in the app. That is a blunt question and deliberately so:
// a false positive costs one line of justification, a false negative costs an
// outage.
//
// An identifier the same migration re-creates is not a removal -- dropping a
// function to replace it with a different signature leaves the name resolving,
// so that is not flagged. `next_factura_number` was exactly that case: the
// one-argument version was dropped and a two-argument one with a default took
// its place, and every existing caller kept working.
//
// To proceed anyway, say why in the migration:
//
//   -- compat-ok: nothing has read this column since the importer was retired
//
// which is a sentence the next person can check, rather than a flag that
// silences the tool.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

/**
 * Migrations on this branch that aren't on main, committed or not.
 *
 * Uncommitted ones count: preflight is meant to run BEFORE the commit, and a
 * check that only sees committed files would pass on the working tree and then
 * fail in CI, which is the least useful moment to find out.
 */
function newMigrations() {
  const found = new Set()

  // origin/main where CI has it, main where a local checkout does, and
  // nothing rather than an error when neither resolves -- this check should
  // never be the reason a preflight cannot run.
  for (const base of ['origin/main', 'main']) {
    try {
      git('rev-parse', '--verify', '--quiet', base)
      const out = git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'supabase/migrations/')
      for (const f of out.split('\n')) if (f.endsWith('.sql')) found.add(f)
      break
    } catch {
      // try the next base
    }
  }

  // Anything new in the working tree: untracked, or staged but not committed.
  // --porcelain marks both '??' and 'A ', and renames carry ' -> '.
  try {
    const status = git('status', '--porcelain', '--', 'supabase/migrations/')
    for (const line of status.split('\n')) {
      if (!line) continue
      const path = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')
      if (path.endsWith('.sql')) found.add(path)
    }
  } catch {
    // not a git checkout, or no working tree to inspect
  }

  return [...found]
}

// Only the removals that can break code that is already running. Renames count
// as removals: the old name stops resolving either way.
const REMOVALS = [
  { kind: 'function', re: /\bdrop\s+function\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi },
  { kind: 'table', re: /\bdrop\s+table\s+(?:if\s+exists\s+)?([a-z0-9_.]+)/gi },
  { kind: 'column', re: /\bdrop\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi },
  { kind: 'renamed column', re: /\brename\s+column\s+([a-z0-9_]+)\s+to\b/gi },
  { kind: 'renamed table', re: /\balter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_.]+)\s+rename\s+to\b/gi },
]

// What the same migration puts back. A name that is re-created still resolves.
const RECREATES = [
  /\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z0-9_]+)/gi,
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi,
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi,
  /\brename\s+column\s+[a-z0-9_]+\s+to\s+([a-z0-9_]+)/gi,
]

function matchAll(sql, re) {
  return [...sql.matchAll(re)].map((m) => m[1].split('.').pop().toLowerCase())
}

/**
 * Does the identifier still appear in the application?
 *
 * Deliberately not in supabase/ -- a migration referring to what another
 * migration dropped is history, not a live caller -- and not in the generated
 * database types, which are regenerated from the schema and so always agree
 * with it by construction.
 */
function referencedInCode(identifier) {
  try {
    // Shapes that mean "this is a database identifier", rather than the bare
    // word: quoted (a .select() list, an .eq() filter, an .rpc() name), an
    // object key, or a property read. A column called `purpose` or `status`
    // otherwise matches English prose in every file that has a comment.
    const out = git(
      'grep', '--extended-regexp', '--files-with-matches',
      `['"\`]${identifier}['"\`]|\\.${identifier}\\b|\\b${identifier}\\s*:`,
      '--',
      'components/', 'pages/', 'server/', 'composables/', 'utils/', 'middleware/', 'plugins/', 'mobile/',
    )
    return out.split('\n').filter(Boolean)
  } catch {
    return [] // git grep exits 1 when nothing matches
  }
}

const files = newMigrations()
const problems = []

for (const file of files) {
  // git lists deleted and renamed paths too, and a migration that is being
  // removed has nothing to check.
  if (!existsSync(join(root, file))) continue
  const sql = readFileSync(join(root, file), 'utf8')
  if (/--\s*compat-ok/i.test(sql)) continue

  const recreated = new Set(RECREATES.flatMap((re) => matchAll(sql, re)))

  for (const { kind, re } of REMOVALS) {
    for (const name of matchAll(sql, re)) {
      if (recreated.has(name)) continue
      const callers = referencedInCode(name)
      if (callers.length > 0) problems.push({ file, kind, name, callers })
    }
  }
}

if (problems.length > 0) {
  console.error(`check-migration-compatibility: ${problems.length} removal(s) the code still references:`)
  console.error('')
  for (const { file, kind, name, callers } of problems) {
    console.error(`  ${file}`)
    console.error(`    drops ${kind} "${name}", still referenced in:`)
    for (const caller of callers.slice(0, 6)) console.error(`      ${caller}`)
    if (callers.length > 6) console.error(`      ... and ${callers.length - 6} more`)
    console.error('')
  }
  console.error('Migrations are applied when this merges, while the code ships later with a')
  console.error('release. Until that release, production runs the CODE ALREADY LIVE against')
  console.error('this schema -- so removing something it still calls breaks it in that window,')
  console.error('and the deploy gate cannot see it (the database is ahead, not behind).')
  console.error('')
  console.error('Either leave the old name in place until the release has shipped, or say why')
  console.error('it is safe, in the migration:')
  console.error('')
  console.error('  -- compat-ok: <the reason>')
  process.exit(1)
}

console.log(
  files.length === 0
    ? 'No new migrations to check for compatibility.'
    : `${files.length} new migration(s), none removing anything the code still references.`,
)
