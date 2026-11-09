import { computePay, payPlanIsEmpty, type PayFacts, type PayPlan } from './payPlan'

// Rentabilidad por profesional (Informes, owners only): what each
// practitioner brings in beside what they cost, for one month.
//
// Ingresos and Visitas are the Commissions figures (receipts on non-void
// invoices, attributed to the visit's practitioner or else the patient's
// own; attended appointments). Coste is the month's coste empresa the owner
// typed in from the gestoría (staff_monthly_costs). Without it, an employee's
// cost is estimated from their pay plan -- fixed plus variable -- and labelled
// estimado: that leaves out Seguridad Social, so it always reads low. An
// autónomo or socio costs what their pay plan came to, which is what they
// invoice. Front desk brings in no income of their own, so they are one
// shared cost line rather than rows with a margin.

export type CostSource = 'entered' | 'estimated' | 'none'
export interface ProfitRow {
  id: string
  name: string
  employmentType: string
  incomeCents: number
  visits: number
  costCents: number | null
  costSource: CostSource
  marginCents: number | null
  /** Margin as a fraction of income (0.25 = 25 %), or null when there is no income. */
  marginShare: number | null
  incomePerVisitCents: number | null
  costPerVisitCents: number | null
  incomePerHourCents: number | null
  minutesClocked: number
}

export interface ProfitInput {
  members: { id: string; full_name: string; is_practitioner: boolean }[]
  employmentType: Map<string, string>
  plans: Map<string, PayPlan>
  facts: Map<string, PayFacts>
  /** Coste empresa typed in for the month, in cents. */
  costs: Map<string, number>
  minutesClocked: Map<string, number>
}

const EMPTY: PayFacts = { paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 0 }

export function costOf(id: string, input: Pick<ProfitInput, 'employmentType' | 'plans' | 'facts' | 'costs'>): { cents: number | null; source: CostSource } {
  const entered = input.costs.get(id)
  if (entered !== undefined) return { cents: entered, source: 'entered' }
  const plan = input.plans.get(id)
  if (!plan || payPlanIsEmpty(plan)) return { cents: null, source: 'none' }
  const total = computePay(plan, input.facts.get(id) ?? EMPTY).totalCents
  // An autónomo's plan is exactly what they invoice: that is their cost, not an estimate.
  return { cents: total, source: (input.employmentType.get(id) ?? 'employee') === 'employee' ? 'estimated' : 'entered' }
}

export function profitability(input: ProfitInput): { practitioners: ProfitRow[]; frontDesk: { people: { id: string; name: string; costCents: number | null; costSource: CostSource }[]; costCents: number; estimated: boolean } } {
  const practitioners = input.members
    .filter((m) => m.is_practitioner)
    .map((m): ProfitRow => {
      const f = input.facts.get(m.id) ?? EMPTY
      const cost = costOf(m.id, input)
      const minutes = input.minutesClocked.get(m.id) ?? 0
      const margin = cost.cents === null ? null : f.paymentsCents - cost.cents
      return {
        id: m.id,
        name: m.full_name,
        employmentType: input.employmentType.get(m.id) ?? 'employee',
        incomeCents: f.paymentsCents,
        visits: f.visits,
        costCents: cost.cents,
        costSource: cost.source,
        marginCents: margin,
        marginShare: margin !== null && f.paymentsCents > 0 ? margin / f.paymentsCents : null,
        incomePerVisitCents: f.visits ? Math.round(f.paymentsCents / f.visits) : null,
        costPerVisitCents: f.visits && cost.cents !== null ? Math.round(cost.cents / f.visits) : null,
        incomePerHourCents: minutes ? Math.round((f.paymentsCents * 60) / minutes) : null,
        minutesClocked: minutes,
      }
    })
  const people = input.members
    .filter((m) => !m.is_practitioner)
    .map((m) => {
      const c = costOf(m.id, input)
      return { id: m.id, name: m.full_name, costCents: c.cents, costSource: c.source }
    })
  return {
    practitioners,
    frontDesk: {
      people,
      costCents: people.reduce((s, p) => s + (p.costCents ?? 0), 0),
      estimated: people.some((p) => p.costSource === 'estimated'),
    },
  }
}
