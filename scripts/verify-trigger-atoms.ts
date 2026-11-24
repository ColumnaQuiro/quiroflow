// Checks that the two copies of the old-trigger → atom mapping agree, over
// real rules: utils/automationTrigger.ts (atomFromLegacy, what the code reads)
// and automation_trigger_from_legacy() in
// supabase/migrations/20261124120000_automation_trigger_atoms.sql (what the
// backfill wrote, and what the database derives when older code saves).
//
//   npx jiti scripts/verify-trigger-atoms.ts rows.json
//
// rows.json is a list of { id, trigger_event, filters, sql_trigger,
// sql_filters }: a rule's old columns, and what the SQL made of them -- read
// from a database the migration has run on (`trigger`, `filters`), or from
// calling the two functions on rules exported from one it has not. For each
// rule it also checks that the atom is one the engine can run, and that the
// old columns the new code would write for it say the same old trigger, so
// a rollback reads it as before. Exits 1 on any difference.

import { readFileSync } from 'node:fs'
import { atomFromLegacy, atomProblem, legacyFromAtom, onlyIfFilters } from '../utils/automationTrigger'

type Row = { id: string; trigger_event: string; filters: Record<string, unknown> | null; sql_trigger: unknown; sql_filters: Record<string, unknown> | null }

/** Deep equality on JSON values, key order aside. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]))
  const ka = Object.keys(a as object).sort()
  const kb = Object.keys(b as object).sort()
  return same(ka, kb) && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const path = process.argv[2]
if (!path) {
  console.error('usage: npx jiti scripts/verify-trigger-atoms.ts rows.json')
  process.exit(2)
}
const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[]
let bad = 0
const byEvent = new Map<string, number>()
for (const row of rows) {
  const { trigger, implied } = atomFromLegacy(row.trigger_event, row.filters)
  const problems: string[] = []
  if (!same(trigger, row.sql_trigger)) problems.push(`atom differs: ts ${JSON.stringify(trigger)} sql ${JSON.stringify(row.sql_trigger)}`)
  const tsFilters = { ...(row.filters ?? {}), ...implied }
  if (!same(tsFilters, row.sql_filters)) problems.push(`filters differ: ts ${JSON.stringify(tsFilters)} sql ${JSON.stringify(row.sql_filters)}`)
  const issue = atomProblem(trigger)
  if (issue) problems.push(`atom cannot run: ${issue[0]}`)
  const back = legacyFromAtom(trigger, { ...onlyIfFilters(row.filters), ...implied })
  if (back?.trigger_event !== row.trigger_event) problems.push(`saving it again would write trigger_event ${back?.trigger_event ?? 'atom'}`)
  byEvent.set(row.trigger_event, (byEvent.get(row.trigger_event) ?? 0) + 1)
  if (problems.length) {
    bad += 1
    console.log(`✗ ${row.id} ${row.trigger_event}\n  ${problems.join('\n  ')}`)
  }
}
for (const [event, n] of [...byEvent].sort()) console.log(`  ${event.padEnd(28)} ${n}`)
console.log(bad ? `${bad} of ${rows.length} rules differ` : `all ${rows.length} rules map the same in TypeScript and SQL, run, and round-trip`)
process.exit(bad ? 1 : 0)
