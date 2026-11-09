import { computePay, payPlanIsEmpty, type PayFacts, type PayLine, type PayPlan } from './payPlan'
import { absenceKindLabel, isOpenEndedAbsence, leaveWorkingDays } from './staffShifts'
import { currentContract, employmentTypeLabel, modalityLabel, type StaffContract } from './staffContracts'
import { teamLeaveBalance, type TeamAbsence } from './teamLeave'
import { workdaysOf, type WorkEntry } from './workday'

// The month's pack for the gestoría (Personal and Informes › Gestoría): per
// person, what the gestoría needs to prepare the nóminas -- days and hours
// worked against the contract, absences with their dates, holidays taken
// and left, the variable pay with how it was reached, and any change of
// contract. It hands over figures; it never works out a nómina.
//
// Autónomos and socios are listed apart: what their pay plan comes to is
// what they invoice, not a payroll line.

export interface PackAbsence { kind: string; label: string; from: string; to: string; days: number; startedOn: string; endsOn: string | null }
export interface PackPerson {
  id: string
  name: string
  employmentType: string
  employmentLabel: string
  modality: string
  weeklyHours: number | null
  /** The contracted hours for the month: weekly hours over the month's working days (Mon–Fri, less closures). */
  contractedMinutes: number | null
  daysWorked: number
  minutesClocked: number
  absences: PackAbsence[]
  holidayDaysThisMonth: number
  holidayDaysLeft: number | null
  /** Employees: everything but the fixed part, which the gestoría already has. Others: the whole plan. */
  payCents: number | null
  payLines: PayLine[]
  contractChanges: string[]
}

export interface PackInput {
  month: string
  today: string
  members: { id: string; full_name: string }[]
  contracts: StaffContract[]
  entries: (WorkEntry & { team_member_id: string })[]
  /** Approved absences touching the month's year. */
  absences: TeamAbsence[]
  allowances: Map<string, number>
  defaultAllowance: number
  closed: Set<string>
  plans: Map<string, PayPlan>
  facts: Map<string, PayFacts>
}

type T = (en: string, es: string) => string
const es: T = (_en, spanish) => spanish

export function monthDays(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  return { first: `${month}-01`, last }
}

const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function buildStaffPack(input: PackInput, t: T = es): { employees: PackPerson[]; others: PackPerson[] } {
  const { first, last } = monthDays(input.month)
  const year = Number(input.month.slice(0, 4))
  const workingDays = leaveWorkingDays(first, last, false, input.closed)
  const people = input.members.map((m): PackPerson => {
    const mine = input.contracts.filter((c) => c.team_member_id === m.id)
    const contract = currentContract(mine, last)
    const type = contract?.employment_type ?? 'employee'
    const weekly = contract?.weekly_hours ? Number(contract.weekly_hours) : null

    const days = workdaysOf(input.entries.filter((e) => e.team_member_id === m.id && e.work_date >= first && e.work_date <= last))
    const absences = input.absences
      .filter((a) => a.team_member_id === m.id && a.status === 'approved' && a.starts_on <= last && a.ends_on >= first)
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((a) => {
        const from = a.starts_on < first ? first : a.starts_on
        const to = a.ends_on > last ? last : a.ends_on
        return { kind: a.kind, label: absenceKindLabel(a.kind, t), from, to, days: leaveWorkingDays(from, to, a.half_day, input.closed), startedOn: a.starts_on, endsOn: isOpenEndedAbsence(a.ends_on) ? null : a.ends_on }
      })
    const isEmployee = type === 'employee'
    const balance = isEmployee ? teamLeaveBalance(input.absences.filter((a) => a.team_member_id === m.id), input.allowances.get(m.id) ?? input.defaultAllowance, year, last < input.today ? last : input.today, input.closed) : null

    const plan = input.plans.get(m.id)
    const pay = plan && !payPlanIsEmpty(plan) ? computePay(plan, input.facts.get(m.id) ?? { paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 0 }) : null
    const payLines = pay ? pay.lines.filter((l) => l.cents && (!isEmployee || l.key !== 'base')) : []

    const changes: string[] = []
    for (const c of mine) {
      const what = [employmentTypeLabel(c.employment_type, t), c.modality ? modalityLabel(c.modality, t) : '', c.weekly_hours ? `${Number(c.weekly_hours)} h/sem` : ''].filter(Boolean).join(', ')
      if (c.starts_on && c.starts_on >= first && c.starts_on <= last) changes.push(t(`Starts ${fmtDay(c.starts_on)}: ${what}`, `Alta ${fmtDay(c.starts_on)}: ${what}`))
      if (c.ends_on && c.ends_on >= first && c.ends_on <= last) changes.push(t(`Ends ${fmtDay(c.ends_on)}: ${what}`, `Fin ${fmtDay(c.ends_on)}: ${what}`))
    }

    return {
      id: m.id,
      name: m.full_name,
      employmentType: type,
      employmentLabel: employmentTypeLabel(type, t),
      modality: contract?.modality ? modalityLabel(contract.modality, t) : '',
      weeklyHours: weekly,
      contractedMinutes: weekly ? Math.round((weekly * 60 * workingDays) / 5) : null,
      daysWorked: days.length,
      minutesClocked: days.reduce((s, d) => s + d.workedMinutes, 0),
      absences,
      holidayDaysThisMonth: absences.filter((a) => a.kind === 'vacation').reduce((s, a) => s + a.days, 0),
      holidayDaysLeft: balance ? balance.left : null,
      payCents: pay ? payLines.reduce((s, l) => s + l.cents, 0) : null,
      payLines,
      contractChanges: changes,
    }
  })
  return { employees: people.filter((p) => p.employmentType === 'employee'), others: people.filter((p) => p.employmentType !== 'employee') }
}

export function payLineLabel(key: string, t: T = es): string {
  if (key === 'base') return t('Fixed', 'Fijo')
  if (key === 'payments') return t('Share of payments', 'Parte de los cobros')
  if (key === 'visits') return t('Visits', 'Visitas')
  if (key === 'new_patients') return t('New patients', 'Pacientes nuevos')
  if (key === 'sales') return t('Bonos and memberships sold', 'Bonos y membresías vendidos')
  return key
}

/** "Baja médica 03/11/2026–07/11/2026 (5 días, desde el 28/10/2026)". */
export function packAbsenceText(a: PackAbsence, t: T = es): string {
  const span = a.from === a.to ? fmtDay(a.from) : `${fmtDay(a.from)}–${fmtDay(a.to)}`
  const extra: string[] = [t(`${a.days} days`, `${a.days} días`)]
  if (a.startedOn < a.from) extra.push(t(`since ${fmtDay(a.startedOn)}`, `desde el ${fmtDay(a.startedOn)}`))
  if (a.endsOn === null) extra.push(t('no return date yet', 'sin fecha de alta'))
  else if (a.endsOn > a.to) extra.push(t(`until ${fmtDay(a.endsOn)}`, `hasta el ${fmtDay(a.endsOn)}`))
  return `${a.label} ${span} (${extra.join(', ')})`
}

/**
 * The CSV's rows: one per person, employees first. Decimal commas, because
 * the file is semicolon-separated for a Spanish spreadsheet (server/utils/zipStore toCsv).
 */
export function staffPackRows(pack: { employees: PackPerson[]; others: PackPerson[] }, t: T = es): Record<string, unknown>[] {
  const dec = (n: number) => n.toFixed(2).replace('.', ',')
  const hours = (m: number | null) => (m === null ? '' : dec(m / 60))
  return [...pack.employees, ...pack.others].map((p) => ({
    [t('Person', 'Persona')]: p.name,
    [t('Type', 'Tipo')]: p.employmentLabel,
    [t('Contract', 'Modalidad')]: p.modality,
    [t('Hours a week', 'Horas semanales')]: p.weeklyHours === null ? '' : String(p.weeklyHours).replace('.', ','),
    [t('Contracted hours', 'Horas según contrato')]: hours(p.contractedMinutes),
    [t('Days worked', 'Días trabajados')]: p.daysWorked,
    [t('Hours clocked', 'Horas fichadas')]: hours(p.minutesClocked),
    [t('Holiday days this month', 'Vacaciones del mes (días)')]: String(p.holidayDaysThisMonth).replace('.', ','),
    [t('Holiday days left this year', 'Vacaciones que quedan este año')]: p.holidayDaysLeft === null ? '' : String(p.holidayDaysLeft).replace('.', ','),
    [t('Absences', 'Ausencias')]: p.absences.map((a) => packAbsenceText(a, t)).join('; '),
    // Employees: the variable part of the nómina. Autónomos and socios: what they invoice.
    [t('Variable pay or to invoice (EUR)', 'Variable o a facturar (EUR)')]: p.payCents === null ? '' : dec(p.payCents / 100),
    [t('How', 'Cálculo')]: p.payLines.map((l) => `${payLineLabel(l.key, t)}: ${dec(l.cents / 100)}${l.detail ? ` (${l.detail})` : ''}`).join('; '),
    [t('Contract changes', 'Cambios de contrato')]: p.contractChanges.join('; '),
  }))
}
