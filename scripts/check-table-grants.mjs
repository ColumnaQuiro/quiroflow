#!/usr/bin/env node
// Fails when a NEW migration creates a table or view in public without
// granting it to the Data API.
//
// From 30 Oct 2026 Supabase no longer grants new tables in "public" to anon,
// authenticated and service_role by default. A table created after that has
// no grants unless its own migration adds them, and supabase-js, PostgREST,
// every server route and every cron get "permission denied" on it.
//
// Nothing else would catch that before production. supabase/seed.sql grants
// every table to all three roles after the migrations run, so locally and in
// CI the table works and every spec passes.
//
// The fix is one line in the same migration, after the table exists:
//
//     select public.grant_data_api('public.my_table');
//
// (with_anon => true as a second argument when it must be reachable signed
// out). Explicit grants are accepted instead, as long as both authenticated
// and service_role get one -- a view only ever read can stay select-only.
// A table that really must not be reachable through the API says so where it
// is created:
//
//     -- table-grants-ok: my_table: read only by a security-definer function
//
// Only NEW migrations are checked, the same way check-rls-two-factor does it:
// the tables that already exist keep the grants they were given.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase/migrations')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

// Same base resolution as check-rls-two-factor: origin/main where CI has it,
// main in a local checkout, plus anything still untracked.
function newMigrations() {
  const found = new Set()

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

// public.foo, "foo", foo -> foo. Anything in another schema -> null: only
// public is exposed through the Data API, and only public lost its defaults.
function publicName(name) {
  const clean = name.replace(/"/g, '').toLowerCase()
  if (!clean.includes('.')) return clean
  const [schema, rel] = clean.split('.')
  return schema === 'public' ? rel : null
}

const strip = (sql) => sql.replace(/--[^\n]*/g, ' ')

// A view re-created with CREATE OR REPLACE keeps the grants it already had,
// so a view an older migration made is only new again if this one drops it.
function viewsCreatedBefore(file) {
  const views = new Set()
  const name = basename(file)
  for (const f of readdirSync(migrationsDir)) {
    if (!f.endsWith('.sql') || f >= name) continue
    const sql = strip(readFileSync(join(migrationsDir, f), 'utf8'))
    const re = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi
    let m
    while ((m = re.exec(sql)) !== null) {
      const v = publicName(m[1])
      if (v) views.add(v)
    }
  }
  return views
}

// Files named on the command line are checked instead, which is how to try
// the check against an older migration.
const files = process.argv.length > 2 ? process.argv.slice(2) : newMigrations()

const problems = []
for (const file of files) {
  const path = resolve(root, file)
  if (!existsSync(path)) continue
  const raw = readFileSync(path, 'utf8')
  const sql = strip(raw)

  const created = new Map()
  let m
  const tableRe = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi
  while ((m = tableRe.exec(sql)) !== null) {
    const t = publicName(m[1])
    if (t) created.set(t, 'table')
  }
  const viewRe = /create\s+(or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi
  let older = null
  while ((m = viewRe.exec(sql)) !== null) {
    const v = publicName(m[2])
    if (!v) continue
    if (m[1]) {
      older ??= viewsCreatedBefore(file)
      const dropped = new RegExp(`drop\\s+(?:materialized\\s+)?view\\s+(?:if\\s+exists\\s+)?(?:public\\.)?"?${v}"?\\b`, 'i').test(sql)
      if (older.has(v) && !dropped) continue
    }
    created.set(v, 'view')
  }
  if (created.size === 0) continue

  const helper = new Set()
  const helperRe = /grant_data_api\s*\(\s*'([\w."]+)'/gi
  while ((m = helperRe.exec(sql)) !== null) {
    const t = publicName(m[1])
    if (t) helper.add(t)
  }

  // grant <privileges> on [table] a, b to role, role
  const grantedTo = new Map()
  const grantRe = /grant\s+[\w\s,()]+?\s+on\s+(?:table\s+)?([\w.",\s]+?)\s+to\s+([\w\s,]+?)(?:\s+with\s+grant\s+option)?\s*;/gi
  while ((m = grantRe.exec(sql)) !== null) {
    if (/^\s*(all\s+tables|function|sequence|schema|all\s+sequences|all\s+functions|all\s+routines)\b/i.test(m[1])) continue
    const roles = m[2].split(',').map((r) => r.trim().toLowerCase())
    for (const target of m[1].split(',')) {
      const t = publicName(target.trim())
      if (!t) continue
      const set = grantedTo.get(t) ?? new Set()
      for (const r of roles) set.add(r)
      grantedTo.set(t, set)
    }
  }

  const waived = new Set()
  const waiverRe = /--\s*table-grants-ok:\s*([\w."]+)\s*:\s*\S/gi
  while ((m = waiverRe.exec(raw)) !== null) {
    const t = publicName(m[1])
    if (t) waived.add(t)
  }

  for (const [name, kind] of created) {
    if (helper.has(name) || waived.has(name)) continue
    const roles = grantedTo.get(name) ?? new Set()
    const missing = ['authenticated', 'service_role'].filter((r) => !roles.has(r))
    if (missing.length > 0) problems.push({ file, name, kind, missing })
  }
}

if (problems.length > 0) {
  console.error('\nA new table or view in public is not granted to the Data API.\n')
  for (const p of problems) {
    console.error(`  ${p.file}`)
    console.error(`    ${p.kind} ${p.name} -- no grant to ${p.missing.join(' or ')}`)
  }
  console.error('\nAdd this to the same migration, after it is created:\n')
  for (const p of problems) console.error(`    select public.grant_data_api('public.${p.name}');`)
  console.error('\nSupabase stopped granting new tables by default on 30 Oct 2026. Without')
  console.error('it the table works locally and in CI (seed.sql grants everything) and')
  console.error('answers "permission denied" in production, to service_role as well.\n')
  process.exit(1)
}

console.log('Every new table and view in public is granted to the Data API.')
