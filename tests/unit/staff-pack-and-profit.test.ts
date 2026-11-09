import { describe, expect, it } from 'vitest'
import { EMPTY_PAY_PLAN, type PayPlan } from '../../utils/payPlan'
import { guessStaffMember } from '../../utils/staffDocuments'
import { buildStaffPack, packAbsenceText, staffPackRows } from '../../utils/staffGestoriaPack'
import { profitability } from '../../utils/staffProfitability'
import type { StaffContract } from '../../utils/staffContracts'
import type { TeamAbsence } from '../../utils/teamLeave'

const contract = (over: Partial<StaffContract>): StaffContract => ({ id: 'c', team_member_id: 'ana', employment_type: 'employee', modality: 'indefinido', starts_on: '2025-01-01', ends_on: null, weekly_hours: 40, job_title: null, convenio: null, created_at: '2025-01-01T00:00:00Z', ...over })
const absence = (over: Partial<TeamAbsence>): TeamAbsence => ({ id: 'a', team_member_id: 'ana', kind: 'vacation', starts_on: '2026-10-05', ends_on: '2026-10-09', half_day: false, status: 'approved', ...over })
const plan = (over: Partial<PayPlan>): PayPlan => ({ ...EMPTY_PAY_PLAN, ...over })

describe('who a payslip is for', () => {
  const team = [{ id: 'l', full_name: 'Lucía Fisio' }, { id: 'm', full_name: 'Marco Quiro' }, { id: 'm2', full_name: 'Marco Ruiz' }]
  it('matches every name part, accents and case aside', () => {
    expect(guessStaffMember('NOMINA_LUCIA_FISIO_10-2026.pdf', team)?.id).toBe('l')
    expect(guessStaffMember('nomina marco quiro.pdf', team)?.id).toBe('m')
  })
  it('picks nobody when the name does not tell', () => {
    expect(guessStaffMember('nomina_marco.pdf', team)).toBeNull()
    expect(guessStaffMember('scan_0001.pdf', team)).toBeNull()
  })
})

describe('the gestoría pack', () => {
  const base = {
    month: '2026-10',
    today: '2026-11-09',
    members: [{ id: 'ana', full_name: 'Ana Fisio' }, { id: 'leo', full_name: 'Leo Quiro' }],
    entries: [
      { id: '1', team_member_id: 'ana', kind: 'in', at: '2026-10-01T07:00:00Z', work_date: '2026-10-01' },
      { id: '2', team_member_id: 'ana', kind: 'out', at: '2026-10-01T15:00:00Z', work_date: '2026-10-01' },
    ],
    allowances: new Map<string, number>(),
    defaultAllowance: 22,
    closed: new Set(['2026-10-12']),
    facts: new Map([['ana', { paymentsCents: 400000, visits: 100, newPatients: 2, salesCents: 0 }], ['leo', { paymentsCents: 300000, visits: 60, newPatients: 0, salesCents: 0 }]]),
  }
  const pack = buildStaffPack({
    ...base,
    contracts: [contract({}), contract({ id: 'l', team_member_id: 'leo', employment_type: 'self_employed', modality: null, weekly_hours: null, starts_on: '2026-10-15' })],
    absences: [absence({}), absence({ id: 'b', kind: 'sick', starts_on: '2026-10-28', ends_on: '2999-12-31' })],
    plans: new Map([['ana', plan({ base_cents: 150000, visit_cents: 500 })], ['leo', plan({ payments_pct: 50 })]]),
  })

  it('puts autónomos apart from the payroll', () => {
    expect(pack.employees.map((p) => p.name)).toEqual(['Ana Fisio'])
    expect(pack.others.map((p) => p.name)).toEqual(['Leo Quiro'])
  })
  it('counts days, hours and the contract’s hours for the month, closures left out', () => {
    const ana = pack.employees[0]!
    expect(ana.daysWorked).toBe(1)
    expect(ana.minutesClocked).toBe(480)
    // October 2026: 22 weekdays, one closed -> 21 days x 8 h.
    expect(ana.contractedMinutes).toBe(21 * 8 * 60)
  })
  it('clips absences to the month and says when a baja has no end yet', () => {
    const ana = pack.employees[0]!
    expect(ana.holidayDaysThisMonth).toBe(5)
    expect(ana.holidayDaysLeft).toBe(17)
    const baja = ana.absences.find((a) => a.kind === 'sick')!
    expect(baja.to).toBe('2026-10-31')
    expect(packAbsenceText(baja)).toContain('sin fecha de alta')
  })
  it('gives an employee’s variable pay without the fixed part, and an autónomo’s whole plan', () => {
    expect(pack.employees[0]!.payCents).toBe(100 * 500)
    expect(pack.others[0]!.payCents).toBe(150000)
    expect(pack.others[0]!.contractChanges[0]).toContain('15/10/2026')
  })
  it('writes one CSV row per person with decimal commas', () => {
    const rows = staffPackRows(pack)
    expect(rows).toHaveLength(2)
    expect(rows[0]!['Horas fichadas']).toBe('8,00')
    expect(rows[1]!['Variable o a facturar (EUR)']).toBe('1500,00')
  })
})

describe('profitability', () => {
  const input = {
    members: [{ id: 'ana', full_name: 'Ana', is_practitioner: true }, { id: 'leo', full_name: 'Leo', is_practitioner: true }, { id: 'eva', full_name: 'Eva', is_practitioner: false }],
    employmentType: new Map([['leo', 'self_employed']]),
    plans: new Map([['ana', plan({ base_cents: 150000 })], ['leo', plan({ payments_pct: 50 })], ['eva', plan({ base_cents: 120000 })]]),
    facts: new Map([['ana', { paymentsCents: 400000, visits: 100, newPatients: 0, salesCents: 0 }], ['leo', { paymentsCents: 300000, visits: 60, newPatients: 0, salesCents: 0 }]]),
    costs: new Map([['ana', 250000]]),
    minutesClocked: new Map([['ana', 160 * 60]]),
  }
  const r = profitability(input)
  it('uses the entered cost, and the pay plan for an autónomo', () => {
    const [ana, leo] = r.practitioners
    expect(ana).toMatchObject({ costCents: 250000, costSource: 'entered', marginCents: 150000, incomePerVisitCents: 4000, incomePerHourCents: 2500 })
    expect(ana!.marginShare).toBeCloseTo(0.375)
    expect(leo).toMatchObject({ costCents: 150000, costSource: 'entered', marginCents: 150000 })
  })
  it('estimates an employee without an entered cost, and keeps front desk as one cost line', () => {
    expect(r.frontDesk).toMatchObject({ costCents: 120000, estimated: true })
    expect(r.frontDesk.people.map((p) => p.name)).toEqual(['Eva'])
  })
})
