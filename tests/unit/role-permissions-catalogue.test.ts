import { describe, it, expect } from 'vitest'
import {
  EMPTY_PERMISSIONS,
  displayRoleDescription,
  displayRoleName,
  permissionGroups,
  permissionsWithDefaults,
  roleNameTaken,
  rowValueLabel,
  setFinancialsMode,
  summaryChips,
} from '../../utils/rolePermissions'

// The roles editor, list and compare page all read utils/rolePermissions, so
// what it says a role holds is what an owner is told their clinic runs on.

const es = (_en: string, s: string) => s
const en = (e: string) => e

describe('Role permission catalogue', () => {
  it('shows every stored key exactly once, and no key that is not stored', () => {
    // financials is the one virtual row: two stored booleans shown as one choice.
    const shown = permissionGroups(es).flatMap((g) => g.rows.map((r) => r.key))
    const stored = Object.keys(EMPTY_PERMISSIONS).filter((k) => !k.startsWith('financials_'))
    expect(new Set(shown).size).to.eq(shown.length)
    expect([...shown].filter((k) => k !== 'financials').sort()).to.deep.equal([...stored].sort())
    expect(shown).to.include('financials')
  })

  it('refuses a name another role has, whatever the case or spacing, in either language', () => {
    const roles = [
      { id: '1', name: 'Owner' },
      { id: '2', name: 'Front Desk' },
      { id: '3', name: 'Gerencia' },
    ]
    expect(roleNameTaken('gerencia', roles)?.id).to.eq('3')
    expect(roleNameTaken('  GERENCIA ', roles)?.id).to.eq('3')
    // The default roles are stored in English and shown translated; both
    // spellings are that role.
    expect(roleNameTaken('Recepción', roles)?.id).to.eq('2')
    expect(roleNameTaken('front desk', roles)?.id).to.eq('2')
    expect(roleNameTaken('Propietario', roles)?.id).to.eq('1')
    expect(roleNameTaken('Recepción de tarde', roles)).to.eq(null)
    // Renaming a role to its own name is not a clash.
    expect(roleNameTaken('Gerencia', roles, '3')).to.eq(null)
    expect(roleNameTaken('   ', roles)).to.eq(null)
  })

  it('translates the three default names and leaves a clinic\'s own as typed', () => {
    expect(displayRoleName('Front Desk', es)).to.eq('Recepción')
    expect(displayRoleName('Practitioner', es)).to.eq('Profesional')
    expect(displayRoleName('Owner', es)).to.eq('Propietario')
    expect(displayRoleName('Front Desk', en)).to.eq('Front Desk')
    expect(displayRoleName('Gerencia', en)).to.eq('Gerencia')
  })

  it('shows a seeded description in the viewer\'s language until someone rewrites it', () => {
    const seeded = 'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.'
    expect(displayRoleDescription('Practitioner', seeded, en)).to.match(/^Sees their own patients/)
    expect(displayRoleDescription('Practitioner', null, es)).to.eq(seeded)
    expect(displayRoleDescription('Practitioner', 'Solo mañanas', en)).to.eq('Solo mañanas')
    expect(displayRoleDescription('Gerencia', null, es)).to.eq('')
  })

  it('reads the two financials booleans as one three-way choice', () => {
    const p = permissionsWithDefaults({})
    const row = permissionGroups(es).flatMap((g) => g.rows).find((r) => r.key === 'financials')!
    expect(rowValueLabel(p, row, es)).to.eq('No')
    setFinancialsMode(p, 'same_day')
    expect([p.financials_edit_all, p.financials_edit_same_day_only]).to.deep.equal([false, true])
    expect(rowValueLabel(p, row, es)).to.eq('Mismo día')
    setFinancialsMode(p, 'all')
    expect([p.financials_edit_all, p.financials_edit_same_day_only]).to.deep.equal([true, false])
  })

  it('treats a key a stored role lacks as not granted', () => {
    const p = permissionsWithDefaults({ billing_access: true })
    expect(p.billing_access).to.eq(true)
    expect(p.billing_history_view).to.eq(false)
    expect(p.calendar_scope).to.eq('none')
  })

  it('sums a role up by what tells it apart', () => {
    const p = permissionsWithDefaults({ calendar_scope: 'own', patients_scope: 'own', billing_access: true, visit_notes_access: true, reports_access: true, reports_own_only: true })
    expect(summaryChips(p, es)).to.deep.equal(['Calendario: solo sus citas', 'Pacientes: solo los suyos', 'Cobrar', 'Informes: solo los suyos'])
  })
})
