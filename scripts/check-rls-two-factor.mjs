#!/usr/bin/env node
// Fails when a NEW migration turns on row-level security for a table without
// also giving it the two-factor policy.
//
// Two-factor login is enforced in the database, not only by the app's
// redirect: every table carries a RESTRICTIVE policy that refuses a
// password-only session when two-factor applies to that person
// (20260923174910_two_factor_login.sql). That migration covered every table
// that existed when it ran. A table created after it has no such policy
// unless its own migration adds one -- and nothing about the table would look
// wrong: the app works, every test passes, and a stolen password reads it
// straight through PostgREST.
//
// The fix is one line in the same migration:
//
//     select public.require_two_factor_on('public.my_new_table');
//
// Only NEW migrations are checked, the same way check-rls-initplan does it.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

// Same base resolution as check-rls-initplan: origin/main where CI has it,
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

function bareName(name) {
  return name.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
}

const problems = []
for (const file of newMigrations()) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  const sql = readFileSync(path, 'utf8').replace(/--[^\n]*/g, ' ')

  const enabled = new Set()
  const enableRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi
  let m
  while ((m = enableRe.exec(sql)) !== null) enabled.add(bareName(m[1]))
  if (enabled.size === 0) continue

  const covered = new Set()
  const helperRe = /require_two_factor_on\s*\(\s*'([\w."]+)'/gi
  while ((m = helperRe.exec(sql)) !== null) covered.add(bareName(m[1]))
  const policyRe = /create\s+policy\s+"two factor when required"\s+on\s+([\w."]+)\s+as\s+restrictive/gi
  while ((m = policyRe.exec(sql)) !== null) covered.add(bareName(m[1]))

  for (const table of enabled) {
    if (!covered.has(table)) problems.push({ file, table })
  }
}

if (problems.length > 0) {
  console.error('\nA new table has row-level security but no two-factor policy.\n')
  for (const p of problems) {
    console.error(`  ${p.file}`)
    console.error(`    ${p.table}`)
  }
  console.error('\nAdd this to the same migration, after the table exists:\n')
  for (const p of problems) console.error(`    select public.require_two_factor_on('public.${p.table}');`)
  console.error('\nWithout it, a password-only session reads the table even when the')
  console.error('person, or their clinic, requires two-factor authentication.\n')
  process.exit(1)
}

console.log('Every new RLS table carries the two-factor policy.')
