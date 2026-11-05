// Paying a bono in plazos, priced per option.
//
// A bono template has its one-payment price (packages.price_cents) and,
// beside it, any number of split options (packages.installment_options):
// "2 plazos de 250 €", "3 plazos de 180 €". Each is priced by the clinic --
// a split may cost more in all than paying at once -- and every plazo of an
// option is the same amount.
//
// A sale under an option records it on the purchase (installments,
// installment_cents) with price_cents = the option's total. So the price, the
// per-session rate and owed_cents mean exactly what they always have; the
// plan only answers one more question: how much of what is still owed is
// DUE yet.
//
// A plazo falls due once the patient has used the sessions the plazos before
// it paid for. A 10-session bono in 2 plazos: the first is due at the sale,
// the second once 5 sessions are used. Until then the second plazo is still
// to come, not owed -- the clinic agreed to it -- and Debtors would otherwise
// list every split bono from the day it was sold.
//
// Pure, and imported relatively by the shared code that uses it: the staff
// app auto-imports root utils too, and there `~` means mobile/.

export interface InstallmentOption {
  installments: number
  installmentCents: number
}

/** How a sold bono is paid, as far as what is due goes. */
export interface BonoInstallmentPlan {
  installments: number | null
  installmentCents: number | null
  sessionsTotal: number
  sessionsUsed: number
}

/** packages.installment_options as stored, defensively: anything malformed is dropped rather than sold. */
export function readInstallmentOptions(raw: unknown): InstallmentOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: InstallmentOption[] = []
  for (const o of raw) {
    const n = Number((o as { installments?: unknown })?.installments)
    const cents = Number((o as { installment_cents?: unknown })?.installment_cents)
    if (!Number.isInteger(n) || n < 2 || n > 24 || !Number.isInteger(cents) || cents < 0 || seen.has(n)) continue
    seen.add(n)
    out.push({ installments: n, installmentCents: cents })
  }
  return out.sort((a, b) => a.installments - b.installments)
}

/** The stored shape of a list of options. */
export function writeInstallmentOptions(options: InstallmentOption[]): { installments: number; installment_cents: number }[] {
  return [...options].sort((a, b) => a.installments - b.installments).map((o) => ({ installments: o.installments, installment_cents: o.installmentCents }))
}

function isSplit(plan: BonoInstallmentPlan): plan is BonoInstallmentPlan & { installments: number; installmentCents: number } {
  return !!plan.installments && plan.installments > 1 && plan.installmentCents !== null && plan.installmentCents !== undefined && plan.sessionsTotal > 0
}

/**
 * How many plazos are due: the first at the sale, plazo k once the sessions
 * the first k-1 paid for have been used -- floor((k-1) x sessions / plazos).
 */
export function installmentsDue(plan: BonoInstallmentPlan): number {
  if (!isSplit(plan)) return 1
  let due = 1
  for (let k = 2; k <= plan.installments; k++) {
    if (plan.sessionsUsed >= Math.floor(((k - 1) * plan.sessionsTotal) / plan.installments)) due = k
  }
  return due
}

/**
 * Of what is still owed on a bono (utils/bonoOwed), how much is due now: the
 * plazos not yet due come off it. A bono paid at once has everything due.
 * Money paid ahead of a plazo counts towards it like any other.
 */
export function bonoDueCents(outstandingCents: number, plan: BonoInstallmentPlan | null | undefined): number {
  if (!plan || !isSplit(plan)) return outstandingCents
  const notYetDue = plan.installments - installmentsDue(plan)
  return Math.max(0, outstandingCents - notYetDue * plan.installmentCents)
}

/**
 * Which plazo a payment is, for its factura: "plazo 2 de 3". Only when the
 * payment is exactly one plazo and what was paid before it is a whole number
 * of plazos -- any other amount is money towards the bono, described as such.
 */
export function installmentBeingPaid(
  plan: { installments: number | null; installmentCents: number | null },
  paidBeforeCents: number,
  amountCents: number,
): { number: number; of: number } | null {
  const n = plan.installments
  const each = plan.installmentCents
  if (!n || n < 2 || !each || amountCents !== each || paidBeforeCents < 0 || paidBeforeCents % each !== 0) return null
  const number = paidBeforeCents / each + 1
  return number <= n ? { number, of: n } : null
}

/** A purchase row's plan, for bonoDueCents. */
export function installmentPlanOf(row: { installments?: number | null; installment_cents?: number | null; sessions_total: number; sessions_used: number }): BonoInstallmentPlan {
  return { installments: row.installments ?? null, installmentCents: row.installment_cents ?? null, sessionsTotal: row.sessions_total, sessionsUsed: row.sessions_used }
}
