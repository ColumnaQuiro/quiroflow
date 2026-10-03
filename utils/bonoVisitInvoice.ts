import { bonoVisitChargeStatus } from './bonoVisitCharge'
import { bonoSessionDescription } from './billingDescriptions'
import { planInvoiceUnderBono } from './visitCharging'

// Charging a visit that a bono session has just paid for -- at the bono's
// per-session rate, which is what draws the prepayment down -- and doing it
// to the receipt the visit ALREADY has, when it has one.
//
// Shared by the calendar's billing tab / the app's visit screen
// (useVisitCharging.usePackageSession) and the Money tab's "Log session"
// (BillingTab.useSession), which used to disagree and were both wrong:
//
//   - the calendar repriced the existing receipt and then inserted the
//     session's charge as a SECOND receipt for the same appointment. Its own
//     findInvoice() reads one receipt per appointment with .maybeSingle(),
//     which errors on two, so the receipt still open for the extras vanished
//     from the tab;
//   - the Money tab voided the existing receipt -- extras and all, so a
//     product sold at the visit stopped being owed -- and raised a new one.
//
// What happens now:
//
//   - no receipt yet: the session's charge is raised, as before;
//   - a receipt with nothing on it but the visit itself (and perhaps money
//     taken at the walk-in price before anyone remembered the bono): THAT
//     receipt becomes the session's charge. One receipt for one visit, its
//     number kept, any payment on it left exactly where it was;
//   - a receipt that also carries extras: the visit's own line comes off it,
//     it stays open for the extras, and the session is charged on its own
//     receipt beside it. Two charges with two different answers to "is this
//     paid?" -- the extras are owed in money, the session is covered by the
//     prepayment -- and a receipt carries one status. Folding them together
//     would either mark the extras paid out of the bono's money or ask
//     reception to collect the session again; useVisitCharging.findInvoice()
//     shows the open one and says the other exists.
//
// Pure of Vue and of the store, and imported relatively: the staff app
// auto-imports this too, and there `~` means mobile/.
export interface BonoVisitCharge {
  accountId: string
  patientId: string
  appointmentId: string
  perSessionCents: number
  bonoName: string
  bonoPurchaseId: string
  /** The screen's own balance -- bonoVisitChargeStatus()'s fallback only. */
  ownBalanceCents: number
}

interface OpenReceipt {
  id: string
  status: string
  is_refund: boolean | null
  total_cents: number
  invoice_line_items: { id: string; price_cents: number; quantity: number; service_id: string | null }[]
  payments: { amount_cents: number }[]
}

export async function chargeBonoVisit(supabase: any, input: BonoVisitCharge): Promise<{ error: string | null; invoiceId: string | null }> {
  const { data: receipts, error: readError } = await supabase
    .from('invoices')
    .select('id, status, total_cents, is_refund, invoice_line_items(id, price_cents, quantity, service_id), payments!payments_invoice_id_fkey(amount_cents)')
    .eq('appointment_id', input.appointmentId)
    .neq('status', 'void')
    .order('created_at', { ascending: false })
  if (readError) return { error: readError.message, invoiceId: null }

  // The newest receipt still open. A paid one is settled and is not touched:
  // both callers refuse a visit that is already paid before reaching here.
  const open = ((receipts ?? []) as OpenReceipt[]).find((r) => r.status !== 'paid' && !r.is_refund) ?? null

  if (open) {
    const lines = open.invoice_line_items ?? []
    const plan = planInvoiceUnderBono(lines, (open.payments ?? []).length)
    const hasExtras = lines.some((l) => l.service_id)

    if (!hasExtras) {
      // Reuse it. Its visit line is the walk-in price, the wrong number now.
      if (lines.length > 0) {
        const { error } = await supabase.from('invoice_line_items').delete().in('id', lines.map((l) => l.id))
        if (error) return { error: error.message, invoiceId: null }
      }
      // Zeroed first, so the family balance read below is the balance WITHOUT
      // this visit's charge -- the same question a fresh charge asks.
      const { error: zeroError } = await supabase.from('invoices').update({ total_cents: 0 }).eq('id', open.id)
      if (zeroError) return { error: zeroError.message, invoiceId: null }

      const paidOnIt = (open.payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
      const status =
        paidOnIt >= input.perSessionCents
          ? 'paid'
          : await bonoVisitChargeStatus(supabase, input.patientId, input.perSessionCents, input.ownBalanceCents)

      const { error: lineError } = await supabase.from('invoice_line_items').insert({
        account_id: input.accountId,
        invoice_id: open.id,
        description: bonoSessionDescription(input.bonoName),
        package_purchase_id: input.bonoPurchaseId,
        quantity: 1,
        price_cents: input.perSessionCents,
      })
      if (lineError) return { error: lineError.message, invoiceId: null }
      const { error: totalError } = await supabase
        .from('invoices')
        .update({ total_cents: input.perSessionCents, status })
        .eq('id', open.id)
      if (totalError) return { error: totalError.message, invoiceId: null }
      return { error: null, invoiceId: open.id }
    }

    // Extras stay owed on this receipt; only the covered visit line goes.
    if (plan.action === 'reprice') {
      if (plan.removeLineId) {
        const { error } = await supabase.from('invoice_line_items').delete().eq('id', plan.removeLineId)
        if (error) return { error: error.message, invoiceId: null }
      }
      const { error } = await supabase.from('invoices').update({ total_cents: plan.totalCents }).eq('id', open.id)
      if (error) return { error: error.message, invoiceId: null }
    }
  }

  // The session's own charge.
  const { data: chargeNumber, error: numberError } = await supabase.rpc('next_invoice_number', { p_account_id: input.accountId })
  if (!chargeNumber) return { error: numberError?.message ?? 'Could not allocate a receipt number.', invoiceId: null }
  const { data: created, error: createError } = await supabase
    .from('invoices')
    .insert({
      account_id: input.accountId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId,
      invoice_number: chargeNumber,
      // The FAMILY's balance, not this patient's: on a shared bono the money
      // sits on the owner's record. See bonoVisitChargeStatus().
      status: await bonoVisitChargeStatus(supabase, input.patientId, input.perSessionCents, input.ownBalanceCents),
      total_cents: input.perSessionCents,
    })
    .select('id')
    .single()
  if (createError || !created) return { error: createError?.message ?? 'The charge was not created.', invoiceId: null }
  const { error: lineError } = await supabase.from('invoice_line_items').insert({
    account_id: input.accountId,
    invoice_id: created.id,
    // Spanish whatever the screen's language, and naming the bono -- see
    // bonoSessionDescription -- with its id, which the income report reads.
    description: bonoSessionDescription(input.bonoName),
    package_purchase_id: input.bonoPurchaseId,
    quantity: 1,
    price_cents: input.perSessionCents,
  })
  if (lineError) return { error: lineError.message, invoiceId: created.id }
  return { error: null, invoiceId: created.id }
}
