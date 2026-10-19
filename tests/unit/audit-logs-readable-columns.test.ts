import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

// authenticated may read only the audit_logs columns granted to it, and
// PostgREST refuses the WHOLE select with 42501 if one column in it is not
// granted. The calendar panel's history selects from the browser, so every
// plain column it names has to be granted by some migration.

const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n')

function grantedColumns(): Set<string> {
  const granted = new Set<string>()
  for (const m of migrations.matchAll(/grant\s+select\s*\(([^)]*)\)\s*on\s+(?:public\.)?audit_logs\s+to\s+authenticated/gi)) {
    for (const c of m[1].split(',')) granted.add(c.trim())
  }
  return granted
}

describe('audit_logs columns the browser reads', () => {
  it('are all granted to authenticated', () => {
    const panel = readFileSync('components/calendar/AppointmentPanel.vue', 'utf8')
    const select = panel.match(/\.from\('audit_logs'\)\s*\.select\('([^']*)'\)/)
    expect(select, 'AppointmentPanel selects from audit_logs').to.not.equal(null)
    // Embedded resources (team_members(...)) are not audit_logs columns.
    const columns = select![1].replace(/\w+\([^)]*\)/g, '').split(',').map((c) => c.trim()).filter(Boolean)
    const granted = grantedColumns()
    expect(columns.filter((c) => !granted.has(c))).to.deep.equal([])
  })
})
