import { installmentBeingPaid, readInstallmentOptions } from './bonoInstallments'
import { ledgerDrawCents } from './owing'
import { formatEur } from './billing'

// Selling a bono, and recording money paid towards one.
//
// Three screens sell a bono: the patient's Billing tab on the web, the
// patient's record in the staff app ("Vender bono"), and the visit's checkout
// on both -- where a patient who has just decided to buy one wants today's
// visit to be its first session, without reception leaving the appointment to
// sell it on the record and coming back. The record's two copies had already
// drifted (the app sold at the "at once" price only, and never paid with
// credit); a third copy in the checkout would have been the next to drift. So
// the steps live here once, each with the reason it exists:
//
//   - the template is read again at the sale, not from the list on screen: a
//     price another member changed in Settings since would otherwise be sold
//     at the old one, and a split option just removed would still be offered;
//   - NO invoice for the sale. What the bono costs is owed_cents on the
//     purchase and each payment comes off that. Raising an invoice for the
//     price as well as charging each visit drawn from it billed the same
//     sessions twice (528 for the bono plus 44 per visit);
//   - a payment the database refuses means nothing else is written -- no
//     factura, no credit drawn down for a bono nothing was paid towards;
//   - money paid in gets a factura saying how much of the bono it bought;
//     credit spent does not (that money was documented when it was paid in),
//     but the part of it drawn from the credit ledger gets its negative row.
//
// Pure of Vue and of the store, and imported relatively: the staff app
// auto-imports this too, and there `~` means mobile/.

export interface BonoFacturaInput {
  accountId: string
  patientId: string
  paymentId: string
  amountCents: number
  purpose: 'bono'
  bono: { packageName: string; priceCents: number; sessionsTotal: number; installment?: { number: number; of: number } | null }
}

export interface BonoSaleDeps {
  /** useFacturas().issueFactura */
  issueFactura: (input: BonoFacturaInput) => Promise<unknown>
  /** useT() */
  t: (en: string, es: string) => string
}

export interface BonoPaymentInput {
  accountId: string
  patientId: string
  teamMemberId: string | null
  packagePurchaseId: string
  amountCents: number
  method: string
  /** The bono's name, for the factura and the credit row's reason. */
  description: string
  bono: { priceCents: number; sessionsTotal: number; installment?: { number: number; of: number } | null }
  /** What the patient holds on the credit LEDGER, for a 'credit' payment. */
  creditLedgerCents: number
  /** Set only for money taken on an earlier day; see utils/paymentDate. */
  paidAt?: string
}

function paymentRefused(t: BonoSaleDeps['t'], error: { message?: string } | null): string {
  return t('The payment could not be recorded', 'No se pudo registrar el pago') + (error?.message ? `: ${error.message}` : '.')
}

/**
 * Records money paid towards a bono: at its sale, or a later instalment.
 * Returns why it failed, or null.
 */
export async function recordBonoPayment(supabase: any, deps: BonoSaleDeps, input: BonoPaymentInput): Promise<string | null> {
  const { t } = deps
  // Attached to the bono, not to an invoice: see the header.
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      account_id: input.accountId,
      patient_id: input.patientId,
      invoice_id: null,
      package_purchase_id: input.packagePurchaseId,
      amount_cents: input.amountCents,
      method: input.method,
      purpose: 'bono',
      ...(input.paidAt ? { paid_at: input.paidAt } : {}),
    })
    .select('id')
    .single()
  // No payment, nothing else: the credit row below restates this payment, and
  // written alone it takes credit off the patient for a bono nothing was paid
  // towards.
  if (paymentError || !payment) return paymentRefused(t, paymentError)

  // A bono's factura says how much of it this money bought -- "264,00 € de
  // 528,00 € (6 de 12 sesiones)" -- because that is what the patient is
  // actually purchasing when they pay an instalment.
  if (input.method !== 'credit') {
    await deps.issueFactura({
      accountId: input.accountId,
      patientId: input.patientId,
      paymentId: (payment as { id: string }).id,
      amountCents: input.amountCents,
      purpose: 'bono',
      bono: { packageName: input.description, priceCents: input.bono.priceCents, sessionsTotal: input.bono.sessionsTotal, installment: input.bono.installment },
    })
  }
  // Only the part drawn from the ledger gets a row: the rest was paid ahead
  // and has no row to take it off -- see utils/owing ledgerDrawCents.
  const fromLedgerCents = input.method === 'credit' ? ledgerDrawCents(input.amountCents, input.creditLedgerCents) : 0
  if (fromLedgerCents > 0) {
    const { error: creditRowError } = await supabase.from('account_credits').insert({
      account_id: input.accountId,
      patient_id: input.patientId,
      amount_cents: -fromLedgerCents,
      reason: `Applied to ${input.description}`,
      invoice_id: null,
      created_by: input.teamMemberId,
    })
    if (creditRowError) {
      return t('The payment was recorded but the credit could not be drawn down', 'El pago se registró, pero no se pudo descontar el crédito') + `: ${creditRowError.message}`
    }
  }
  return null
}

export interface BonoSaleInput {
  accountId: string
  patientId: string
  teamMemberId: string | null
  packageId: string
  /** 1 is at once at the bono's price; N is one of its split options (Settings > Bonos). */
  installments: number
  /** Paid now. May be less than the price: the rest stays owed on the bono. */
  amountCents: number
  method: string
  /** Credit the patient can spend now, checked before anything is written. */
  spendableCreditCents: number
  creditLedgerCents: number
}

export interface SoldBono {
  id: string
  package_name: string
  sessions_used: number
  sessions_total: number
  price_cents: number
}

export interface BonoSaleResult {
  /** The bono, when it was sold. */
  purchase: SoldBono | null
  /** Why nothing was sold, or why the payment towards it failed (sold either way). */
  error: string | null
  /** The chosen split option is no longer offered: choose again. */
  optionGone?: boolean
}

/** Sells a bono and records what was paid towards it now. */
export async function recordBonoSale(supabase: any, deps: BonoSaleDeps, input: BonoSaleInput): Promise<BonoSaleResult> {
  const { t } = deps
  // Against what is actually spendable, and against the amount paid now rather
  // than the bono's price -- part-paying a 528 bono with 50 of credit is a
  // normal sale, with the rest taken later or put on autopay.
  if (input.method === 'credit' && input.amountCents > input.spendableCreditCents) {
    return {
      purchase: null,
      error: t(
        `That is more than the ${formatEur(input.spendableCreditCents)} of credit available.`,
        `Supera los ${formatEur(input.spendableCreditCents)} de crédito disponibles.`,
      ),
    }
  }

  const { data: tplRow } = await supabase.from('packages').select('id, name, session_count, price_cents, installment_options').eq('id', input.packageId).maybeSingle()
  const tpl = tplRow as { id: string; name: string; session_count: number; price_cents: number; installment_options: unknown } | null
  if (!tpl) return { purchase: null, error: t('That bono no longer exists.', 'Ese bono ya no existe.') }

  // The option is read off the same fresh row: sold at the price it has now,
  // or not at all if someone has just removed it.
  let option: { installments: number; installmentCents: number } | null = null
  if (input.installments > 1) {
    option = readInstallmentOptions(tpl.installment_options).find((o) => o.installments === input.installments) ?? null
    if (!option) {
      return {
        purchase: null,
        optionGone: true,
        error: t('That way of paying is no longer offered for this bono. Choose again.', 'Esa forma de pago ya no está disponible para este bono. Elige de nuevo.'),
      }
    }
  }
  const priceCents = option ? option.installments * option.installmentCents : tpl.price_cents

  const { data: purchase, error: purchaseError } = await supabase
    .from('package_purchases')
    .insert({
      account_id: input.accountId,
      patient_id: input.patientId,
      package_id: tpl.id,
      package_name: tpl.name,
      sessions_total: tpl.session_count,
      price_cents: priceCents,
      installments: option?.installments ?? null,
      installment_cents: option?.installmentCents ?? null,
      invoice_id: null,
      owed_cents: priceCents,
      created_by: input.teamMemberId,
    })
    .select('id, package_name, sessions_used, sessions_total, price_cents')
    .single()
  if (purchaseError || !purchase) {
    return { purchase: null, error: t('Could not sell the bono', 'No se ha podido vender el bono') + (purchaseError?.message ? `: ${purchaseError.message}` : '.') }
  }
  const sold = purchase as SoldBono

  if (input.amountCents <= 0) return { purchase: sold, error: null }
  // The bono is sold either way -- what it costs is owed on it -- but nothing
  // was paid towards it, and reception has to know before the patient leaves.
  const paymentProblem = await recordBonoPayment(supabase, deps, {
    accountId: input.accountId,
    patientId: input.patientId,
    teamMemberId: input.teamMemberId,
    packagePurchaseId: sold.id,
    amountCents: input.amountCents,
    method: input.method,
    description: tpl.name,
    bono: {
      priceCents,
      sessionsTotal: tpl.session_count,
      installment: option ? installmentBeingPaid({ installments: option.installments, installmentCents: option.installmentCents }, 0, input.amountCents) : null,
    },
    creditLedgerCents: input.creditLedgerCents,
  })
  return { purchase: sold, error: paymentProblem }
}

/** What the sale form opens on for a bono: its price, or the first plazo. */
export function bonoSaleDefaultCents(tpl: { price_cents: number; installment_options?: unknown } | null, installments: number): number {
  if (!tpl) return 0
  const option = installments > 1 ? readInstallmentOptions(tpl.installment_options).find((o) => o.installments === installments) : null
  return option ? option.installmentCents : tpl.price_cents
}
