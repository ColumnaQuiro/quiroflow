import { formatEur } from './billing'

// What a team member earns in a month, from their pay plan (pay_plans) and
// what happened that month. Every part is optional; a clinic combines the
// ones it uses:
//
//   base         a fixed amount every month
//   payments     a % of the money received that month for their visits and
//                their patients (attributed as the Income reports do:
//                utils/incomeAttribution)
//   visits       an amount per attended visit, with optional tiers by how
//                many visits they did that month -- see PayTierMode
//   new patients a bonus per first visit they did
//   sales        a % of the bonos and memberships they sold
//
// The visit belongs to the appointment's practitioner, as everywhere else.
export type PayTierMode = 'reached' | 'band' | 'bonus'

export interface PayTier {
  /** From this many visits in the month. */
  from: number
  /** Per visit ('reached', 'band'), or a one-off bonus for getting here ('bonus'). */
  cents: number
}

export interface PayPlan {
  base_cents: number
  payments_pct: number
  /** Per visit below the first tier (or for every visit, with no tiers). */
  visit_cents: number
  tier_mode: PayTierMode
  tiers: PayTier[]
  new_patient_cents: number
  sales_pct: number
}

export interface PayFacts {
  paymentsCents: number
  visits: number
  newPatients: number
  salesCents: number
}

export interface PayLine {
  key: 'base' | 'payments' | 'visits' | 'new_patients' | 'sales'
  cents: number
  /** How it was worked out: "35 % of 4.200,00 €", "25 × 12,00 € + 10 × 15,00 €". */
  detail: string
}

export const EMPTY_PAY_PLAN: PayPlan = { base_cents: 0, payments_pct: 0, visit_cents: 0, tier_mode: 'reached', tiers: [], new_patient_cents: 0, sales_pct: 0 }

const pct = (cents: number, p: number) => Math.round((cents * p) / 100)
const fmtPct = (p: number) => `${String(p).replace('.', ',')} %`

/** Tiers in order, the ones that mean something: a positive start, no duplicates. */
export function cleanTiers(tiers: PayTier[]): PayTier[] {
  const seen = new Set<number>()
  return tiers
    .filter((t) => Number.isFinite(t.from) && t.from > 0 && Number.isFinite(t.cents) && t.cents >= 0)
    .sort((a, b) => a.from - b.from)
    .filter((t) => (seen.has(t.from) ? false : (seen.add(t.from), true)))
}

/** The visits part on its own, with how it was worked out. */
export function visitPay(plan: Pick<PayPlan, 'visit_cents' | 'tier_mode' | 'tiers'>, visits: number): { cents: number; detail: string } {
  const tiers = cleanTiers(plan.tiers)
  if (visits <= 0) return { cents: 0, detail: '' }
  if (!tiers.length || plan.tier_mode === 'bonus') {
    const base = visits * plan.visit_cents
    const bonuses = plan.tier_mode === 'bonus' ? tiers.filter((t) => visits >= t.from) : []
    const parts = [plan.visit_cents ? `${visits} × ${formatEur(plan.visit_cents)}` : '', ...bonuses.map((t) => `${formatEur(t.cents)} (${t.from}+)`)].filter(Boolean)
    return { cents: base + bonuses.reduce((s, t) => s + t.cents, 0), detail: parts.join(' + ') }
  }
  if (plan.tier_mode === 'reached') {
    const reached = [...tiers].reverse().find((t) => visits >= t.from)
    const rate = reached ? reached.cents : plan.visit_cents
    return { cents: visits * rate, detail: `${visits} × ${formatEur(rate)}` }
  }
  // 'band': visit number k is paid at the rate of the highest tier with from <= k.
  const bands: { count: number; rate: number }[] = []
  const starts = [{ from: 1, cents: plan.visit_cents }, ...tiers]
  for (let i = 0; i < starts.length; i++) {
    const lo = Math.max(1, starts[i]!.from)
    const hi = i + 1 < starts.length ? starts[i + 1]!.from - 1 : visits
    const count = Math.max(0, Math.min(hi, visits) - lo + 1)
    if (count) bands.push({ count, rate: starts[i]!.cents })
  }
  return {
    cents: bands.reduce((s, b) => s + b.count * b.rate, 0),
    detail: bands.filter((b) => b.rate).map((b) => `${b.count} × ${formatEur(b.rate)}`).join(' + '),
  }
}

/** Every part of the month's pay that is not zero, and the total. */
export function computePay(plan: PayPlan, facts: PayFacts): { lines: PayLine[]; totalCents: number } {
  const v = visitPay(plan, facts.visits)
  const lines: PayLine[] = [
    { key: 'base' as const, cents: plan.base_cents, detail: '' },
    { key: 'payments' as const, cents: pct(facts.paymentsCents, plan.payments_pct), detail: plan.payments_pct ? `${fmtPct(plan.payments_pct)} × ${formatEur(facts.paymentsCents)}` : '' },
    { key: 'visits' as const, cents: v.cents, detail: v.detail },
    { key: 'new_patients' as const, cents: facts.newPatients * plan.new_patient_cents, detail: plan.new_patient_cents ? `${facts.newPatients} × ${formatEur(plan.new_patient_cents)}` : '' },
    { key: 'sales' as const, cents: pct(facts.salesCents, plan.sales_pct), detail: plan.sales_pct ? `${fmtPct(plan.sales_pct)} × ${formatEur(facts.salesCents)}` : '' },
  ].filter((l) => l.cents !== 0)
  return { lines, totalCents: lines.reduce((s, l) => s + l.cents, 0) }
}

/** True when nothing in the plan pays anything. */
export function payPlanIsEmpty(plan: PayPlan): boolean {
  return !plan.base_cents && !plan.payments_pct && !plan.visit_cents && !cleanTiers(plan.tiers).some((t) => t.cents) && !plan.new_patient_cents && !plan.sales_pct
}

/**
 * Each team member's figures for the month, from the month's rows:
 *
 *   payments   receipts already filtered (utils/paymentReceipts, not void),
 *              each with the practitioner it is attributed to
 *              (utils/incomeAttribution's practitionerForPayment)
 *   visits     attended visits, with their practitioner and patient
 *   seenBefore patients with an attended visit before the month -- a visit
 *              by anyone else is a first visit, and earns the new-patient bonus
 *   sales      bonos and memberships sold, with who sold them
 */
export function payFactsByMember(input: {
  payments: { cents: number; practitionerId: string | null }[]
  visits: { practitionerId: string | null; patientId: string | null }[]
  seenBefore: Set<string>
  sales: { cents: number; soldBy: string | null }[]
}): Map<string, PayFacts> {
  const out = new Map<string, PayFacts>()
  const of = (id: string) => {
    let f = out.get(id)
    if (!f) out.set(id, (f = { paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 0 }))
    return f
  }
  for (const p of input.payments) if (p.practitionerId) of(p.practitionerId).paymentsCents += p.cents
  const firstSeen = new Set<string>()
  for (const v of input.visits) {
    if (!v.practitionerId) continue
    const f = of(v.practitionerId)
    f.visits++
    // Their first attended visit ever, counted once, to whoever did it.
    if (v.patientId && !input.seenBefore.has(v.patientId) && !firstSeen.has(v.patientId)) {
      firstSeen.add(v.patientId)
      f.newPatients++
    }
  }
  for (const s of input.sales) if (s.soldBy) of(s.soldBy).salesCents += s.cents
  return out
}
