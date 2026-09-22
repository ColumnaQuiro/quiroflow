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
// It covers two ways a migration breaks code that is already running.
//
// The first is a REMOVAL: dropping a column, table or function the live code
// still calls.
//
// The second removes nothing at all. Adding a SECOND foreign key between two
// tables makes every PostgREST embed between them ambiguous, and PostgREST
// refuses rather than guesses:
//
//   PGRST201: Could not embed because more than one relationship was found
//   for 'payments' and 'invoices'
//
// That shipped on 22 Sep 2026. `invoices.refunds_payment_id` was added so a
// refund could name the payment it gives back -- purely additive, so this
// check passed it -- and the eight existing `.select('..., invoices(status)')`
// calls started failing at runtime the moment the migration applied on merge.
// Production ran the previous release against the new schema for five minutes
// with patient balances, the dashboard income widgets and three reports all
// erroring. Nothing else could have caught it: a select list is a string, so
// typecheck and `npm run build` are both clean, and the deploy gate only asks
// whether the database is BEHIND the code.
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

/**
 * Foreign keys this migration adds, as [owning table, referenced table].
 *
 * Split into statements first and read the owner and the target out of the
 * same one. Scanning the file as a whole pairs an `alter table` with a
 * `references` from some later statement, which is how you get told about a
 * relationship between two tables that were never mentioned together.
 */
function foreignKeysAdded(sql) {
  const pairs = []

  for (const statement of sql.split(';')) {
    // Only an existing table can gain a relationship that breaks an existing
    // embed. `create table` brings its own foreign keys, but nothing can be
    // embedding a table that did not exist a moment ago.
    const owner = statement.match(/\balter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_."]+)/i)
    if (!owner) continue
    if (/\bdrop\s+constraint\b/i.test(statement)) continue

    for (const m of statement.matchAll(/\breferences\s+([a-z0-9_."]+)/gi)) {
      const from = bareName(owner[1])
      const to = bareName(m[1])
      if (from && to && from !== to) pairs.push([from, to])
    }
  }

  return pairs
}

/** `public."Invoices"` and `invoices` are the same table to this script. */
function bareName(raw) {
  return raw.replace(/"/g, '').split('.').pop().toLowerCase()
}

/** The app's own source, which is where a select list would live. */
function codeFiles() {
  try {
    return git('ls-files', '--', 'components/', 'pages/', 'server/', 'composables/', 'utils/', 'middleware/', 'plugins/', 'mobile/')
      .split('\n')
      .filter((f) => /\.(ts|js|vue|mjs)$/.test(f))
  } catch {
    return []
  }
}

/**
 * Embeds between two tables that do not say which relationship they mean.
 *
 * `invoices(status)` is ambiguous once there are two; `invoices!fk_name(status)`
 * is not, which is what the lookbehind on `!` is for. The same lookbehind keeps
 * `settle_imported_invoices(` from reading as an embed of `invoices`.
 *
 * A match only counts inside a select list, since these are ordinary words
 * otherwise -- a comment mentioning payments(…) is not a query. The preceding
 * lines are searched too, because a long select is usually wrapped.
 */
function unhintedEmbeds(tableA, tableB) {
  const hits = []

  for (const file of codeFiles()) {
    let lines
    try {
      lines = readFileSync(join(root, file), 'utf8').split('\n')
    } catch {
      continue
    }

    lines.forEach((line, i) => {
      for (const table of [tableA, tableB]) {
        if (!new RegExp(`(?<![a-z0-9_!])${table}\\(`, 'i').test(line)) continue
        const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
        if (!/\.select\s*\(/i.test(context)) continue
        hits.push(`${file}:${i + 1}`)
        return
      }
    })
  }

  return hits
}

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
const ambiguities = []

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

  // A new foreign key breaks any embed between the two tables that does not
  // name a relationship. There is no need to count the keys already there: an
  // un-hinted embed that works today proves one exists, so this one makes two.
  for (const [from, to] of foreignKeysAdded(sql)) {
    const embeds = unhintedEmbeds(from, to)
    if (embeds.length > 0) ambiguities.push({ file, from, to, embeds })
  }
}

if (ambiguities.length > 0) {
  console.error(`check-migration-compatibility: ${ambiguities.length} new foreign key(s) that make an existing embed ambiguous:`)
  console.error('')
  for (const { file, from, to, embeds } of ambiguities) {
    console.error(`  ${file}`)
    console.error(`    adds a foreign key ${from} -> ${to}, and these embeds do not say which relationship they mean:`)
    for (const embed of embeds.slice(0, 8)) console.error(`      ${embed}`)
    if (embeds.length > 8) console.error(`      ... and ${embeds.length - 8} more`)
    console.error('')
  }
  console.error('With two relationships between the same pair of tables, PostgREST refuses')
  console.error('the embed rather than choosing one:')
  console.error('')
  console.error("  PGRST201: Could not embed because more than one relationship was found")
  console.error('')
  console.error('Nothing else catches this. A select list is a string, so typecheck and the')
  console.error('build stay clean, and it fails at RUNTIME the moment this migration applies')
  console.error('on merge -- against the release that is already live, which cannot have the')
  console.error('fix in it yet.')
  console.error('')
  console.error('Name the relationship in each embed above, and ship that in the SAME pull')
  console.error('request as this migration:')
  console.error('')
  console.error("  .select('..., invoices!payments_invoice_id_fkey(status)')")
  console.error('')
  console.error('Or, if they really are unaffected, say why in the migration:')
  console.error('')
  console.error('  -- compat-ok: <the reason>')
  process.exit(1)
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
