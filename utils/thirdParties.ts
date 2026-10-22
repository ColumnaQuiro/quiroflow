// Third-party payers: insurers (mutuas), medico-legal schemes and companies
// that pay for a patient's visits (20261022201348_third_party_payers.sql).
//
// What a third party owes is never on the patient's invoices -- the patient's
// receipt holds only their copago -- so none of this touches the patient's
// balance or debt. These are the sums over third_party_charges and the
// payments allocated to them.

export type ThirdPartyKind = 'insurer' | 'medico_legal' | 'company'

export const THIRD_PARTY_KINDS: ThirdPartyKind[] = ['insurer', 'medico_legal', 'company']

export function thirdPartyKindLabel(kind: string, t: (en: string, es: string) => string): string {
  if (kind === 'insurer') return t('Insurer', 'Aseguradora')
  if (kind === 'medico_legal') return t('Medico-legal', 'Médico-legal')
  if (kind === 'company') return t('Company', 'Empresa')
  return kind
}

export interface ChargeLike {
  id: string
  amount_cents: number
  status: string
  service_date: string
  allocations?: { amount_cents: number }[] | null
}

/** What has been allocated to a charge, or out of a payment. */
export function allocatedCents(row: { allocations?: { amount_cents: number }[] | null }): number {
  return (row.allocations ?? []).reduce((sum, a) => sum + a.amount_cents, 0)
}

/** What is still owed on one charge: nothing once voided. */
export function chargeOutstandingCents(charge: ChargeLike): number {
  if (charge.status === 'void') return 0
  return Math.max(0, charge.amount_cents - allocatedCents(charge))
}

export type AgeBucket = 'current' | 'd31_60' | 'd61_90' | 'over_90'
export const AGE_BUCKETS: AgeBucket[] = ['current', 'd31_60', 'd61_90', 'over_90']

export function ageBucketLabel(bucket: AgeBucket, t: (en: string, es: string) => string): string {
  if (bucket === 'current') return t('0–30 days', '0–30 días')
  if (bucket === 'd31_60') return t('31–60 days', '31–60 días')
  if (bucket === 'd61_90') return t('61–90 days', '61–90 días')
  return t('Over 90 days', 'Más de 90 días')
}

/** Whole days from the visit to `today`, both read as calendar dates. */
export function daysSince(serviceDate: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${serviceDate}T00:00:00Z`)
  return Math.floor(ms / 86_400_000)
}

/** Aged by the date of the visit, which is what a mutua's payment terms run from. */
export function ageBucket(serviceDate: string, today: string): AgeBucket {
  const days = daysSince(serviceDate, today)
  if (days <= 30) return 'current'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'over_90'
}

export type AgedTotals = Record<AgeBucket, number> & { total: number }

export function agedOutstanding(charges: ChargeLike[], today: string): AgedTotals {
  const out: AgedTotals = { current: 0, d31_60: 0, d61_90: 0, over_90: 0, total: 0 }
  for (const c of charges) {
    const owed = chargeOutstandingCents(c)
    if (owed <= 0) continue
    out[ageBucket(c.service_date, today)] += owed
    out.total += owed
  }
  return out
}

/**
 * Spreads a payment over the charges it pays, oldest visit first -- how a
 * remittance is normally read when it does not list visits one by one.
 * Returns one entry per charge it reaches; anything left over is unallocated.
 */
export function allocateOldestFirst(charges: ChargeLike[], amountCents: number): Map<string, number> {
  const out = new Map<string, number>()
  let left = Math.max(0, amountCents)
  const open = charges
    .filter((c) => chargeOutstandingCents(c) > 0)
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.id.localeCompare(b.id))
  for (const c of open) {
    if (left <= 0) break
    const take = Math.min(left, chargeOutstandingCents(c))
    out.set(c.id, take)
    left -= take
  }
  return out
}

export interface CoverLike {
  authorized_sessions: number | null
  valid_until: string | null
}

export type CoverWarning = { kind: 'used_up'; used: number; authorized: number } | { kind: 'expired'; validUntil: string }

/**
 * Why charging one more visit to this cover may not be paid: the sessions the
 * insurer authorised are all used, or the authorisation ran out before the
 * visit. `used` counts the visits already charged under it, not this one.
 * A warning, never a refusal -- a new authorisation is often on paper before
 * anyone types it in.
 */
export function coverWarnings(cover: CoverLike, used: number, visitDate: string): CoverWarning[] {
  const out: CoverWarning[] = []
  if (cover.authorized_sessions != null && used >= cover.authorized_sessions) {
    out.push({ kind: 'used_up', used, authorized: cover.authorized_sessions })
  }
  if (cover.valid_until && cover.valid_until < visitDate) out.push({ kind: 'expired', validUntil: cover.valid_until })
  return out
}

export function coverWarningText(w: CoverWarning, t: (en: string, es: string) => string): string {
  if (w.kind === 'used_up') {
    return t(
      `Authorised sessions used up: ${w.used} of ${w.authorized}.`,
      `Sesiones autorizadas agotadas: ${w.used} de ${w.authorized}.`,
    )
  }
  const d = new Date(`${w.validUntil}T00:00:00`).toLocaleDateString()
  return t(`Authorisation expired on ${d}.`, `La autorización caducó el ${d}.`)
}

/** Euros typed into a field, as cents. Blank or nonsense is null. */
export function eurosToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}
