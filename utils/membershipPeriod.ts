// How often a membership plan charges, as memberships.billing_interval and
// billing_interval_count store it -- the same vocabulary payment_schedules and
// Stripe use, so a plan's period can seed a patient's autopay unchanged.

export type MembershipInterval = 'week' | 'month' | 'year'

export interface MembershipPeriod {
  billing_interval: string
  billing_interval_count: number
}

/** The periods Settings > Memberships offers; anything else stored still labels correctly. */
export const PERIOD_OPTIONS: { key: string; interval: MembershipInterval; count: number }[] = [
  { key: 'week-1', interval: 'week', count: 1 },
  { key: 'month-1', interval: 'month', count: 1 },
  { key: 'month-3', interval: 'month', count: 3 },
  { key: 'month-6', interval: 'month', count: 6 },
  { key: 'year-1', interval: 'year', count: 1 },
]

type T = (en: string, es: string) => string

/** "month", "3 months", "year" -- what follows "€ /" or "Every". */
export function periodLabel(p: MembershipPeriod, t: T): string {
  const n = p.billing_interval_count
  switch (p.billing_interval) {
    case 'week':
      return n === 1 ? t('week', 'semana') : t(`${n} weeks`, `${n} semanas`)
    case 'year':
      return n === 1 ? t('year', 'año') : t(`${n} years`, `${n} años`)
    default:
      return n === 1 ? t('month', 'mes') : t(`${n} months`, `${n} meses`)
  }
}

/** A plan's price spread over one month, for totals across plans with different periods. */
export function monthlyCents(priceCents: number, p: MembershipPeriod): number {
  const n = Math.max(1, p.billing_interval_count)
  if (p.billing_interval === 'week') return (priceCents * 52) / 12 / n
  if (p.billing_interval === 'year') return priceCents / 12 / n
  return priceCents / n
}
