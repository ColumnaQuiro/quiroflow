#!/usr/bin/env node
// Fails when a NEW policy calls auth.uid() bare.
//
// Inside a policy expression, `auth.uid()` is re-evaluated for every row the
// policy is tested against; `(select auth.uid())` is hoisted into an InitPlan
// and evaluated once. On `patients` that is the difference between 1,577
// calls and one, and it compounds on every table a patient can read through.
//
// Twenty policies were written the first way before anyone noticed
// (20260923120000_auth_uid_once_per_query_not_per_row.sql). They all read
// perfectly naturally, which is the problem -- the bare form is what anyone
// would type, and nothing about it looks slow.
//
// Only NEW migrations are checked, the same way check-migration-compatibility
// does it. The history stays as it is: those files created the policies that
// the migration above then rewrote, and editing an applied migration changes
// nothing in any database that has already run it.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

// Same base resolution as check-migration-compatibility: origin/main where CI
// has it, main in a local checkout, and the working tree when neither exists.
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

  // UNION, not a fallback. The committed diff misses a migration that is
  // still untracked, which is exactly the state it is in while being
  // written -- so a check that only reads the diff passes locally right up
  // until the commit, and only CI ever disagrees.
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

// Function bodies legitimately call auth.uid() and are not policies, so the
// $$-quoted blocks come out before anything is split on a semicolon -- they
// contain semicolons of their own and would shred the statement list.
function policyStatements(sql) {
  const withoutBodies = sql.replace(/\$\$[\s\S]*?\$\$/g, ' /* body */ ')
  const withoutComments = withoutBodies.replace(/--[^\n]*/g, ' ')
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^(create|alter)\s+policy/i.test(s))
}

function bareAuthCalls(statement) {
  const found = []
  const re = /\bauth\.(uid|jwt|role)\s*\(\s*\)/gi
  let m
  while ((m = re.exec(statement)) !== null) {
    // Look back far enough to see a `select` that this call belongs to, and
    // no further -- `(select auth.uid())` wraps it, `select ... where x =
    // auth.uid()` in a subquery two lines up does not.
    const before = statement.slice(Math.max(0, m.index - 30), m.index)
    if (!/\(\s*select\s+$/i.test(before)) found.push(m[0])
  }
  return found
}

const problems = []
for (const file of newMigrations()) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  const sql = readFileSync(path, 'utf8')
  for (const statement of policyStatements(sql)) {
    const bare = bareAuthCalls(statement)
    if (bare.length === 0) continue
    const name = statement.match(/policy\s+("[^"]+"|\S+)/i)?.[1] ?? '(unnamed)'
    problems.push({ file, name, bare: [...new Set(bare)].join(', ') })
  }
}

if (problems.length > 0) {
  console.error('\nA new policy calls auth.uid() once per ROW.\n')
  for (const p of problems) {
    console.error(`  ${p.file}`)
    console.error(`    policy ${p.name} -- ${p.bare}`)
  }
  console.error('\nWrap it so the planner evaluates it once:\n')
  console.error('    using (user_id = auth.uid())            -- per row')
  console.error('    using (user_id = ( select auth.uid() )) -- once\n')
  console.error('Both mean the same thing: auth.uid() reads a per-session')
  console.error('setting, so it cannot vary from one row to the next.\n')
  process.exit(1)
}

console.log('No new policy calls auth.uid() per row.')
