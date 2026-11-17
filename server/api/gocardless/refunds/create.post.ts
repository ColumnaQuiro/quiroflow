import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Sends money back to the patient's bank through GoCardless, as one step of
// the ordinary refund on the patient's ledger (BillingTab createRefund).
//
// Called after the refund's receipt and payment row are written and BEFORE
// its factura rectificativa is issued: a rectificativa is chain-signed under
// VeriFactu and cannot be taken back, so it must not exist for money
// GoCardless then refused to return. If GoCardless refuses, this takes the
// receipt and payment row back out itself and answers with GoCardless's
// reason; the ledger is as it was.
//
// The amount is the refund payment row's, read here, not a number from the
// page. GoCardless's own guard against refunding twice is
// total_amount_confirmation -- everything refunded on the payment so far plus
// this -- and the idempotency key is the refund row, so a retried request
// returns the first refund instead of sending a second.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'financials_edit_all')
  const body = await readBody<{ paymentId?: string; refundPaymentId?: string }>(event)
  if (!body?.paymentId || !body?.refundPaymentId) throw createError({ statusCode: 400, statusMessage: 'paymentId and refundPaymentId are required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const accountId = teamMember.account_id
  const [{ data: original }, { data: refundRow }] = await Promise.all([
    admin.from('payments').select('id, patient_id, gocardless_payment_id').eq('id', body.paymentId).eq('account_id', accountId).maybeSingle(),
    admin.from('payments').select('id, patient_id, amount_cents, invoice_id, gocardless_refund_id').eq('id', body.refundPaymentId).eq('account_id', accountId).maybeSingle(),
  ])
  if (!original?.gocardless_payment_id) throw createError({ statusCode: 400, statusMessage: 'This payment was not collected through GoCardless' })
  if (!refundRow || refundRow.amount_cents >= 0 || refundRow.patient_id !== original.patient_id) throw createError({ statusCode: 400, statusMessage: 'Refund payment not found' })
  if (refundRow.gocardless_refund_id) return { refundId: refundRow.gocardless_refund_id, alreadySent: true }

  const { data: refundInvoice } = refundRow.invoice_id
    ? await admin.from('invoices').select('id, is_refund, refunds_payment_id').eq('id', refundRow.invoice_id).maybeSingle()
    : { data: null }
  if (!refundInvoice?.is_refund || refundInvoice.refunds_payment_id !== original.id) throw createError({ statusCode: 400, statusMessage: 'That refund does not name this payment' })

  // What the books just wrote is undone before reporting a refusal, so the
  // ledger never shows money going back that did not.
  const takeBack = async () => {
    await admin.from('payments').delete().eq('id', refundRow.id).eq('account_id', accountId)
    await admin.from('invoices').delete().eq('id', refundInvoice.id).eq('account_id', accountId)
  }

  const request = await gocardlessForAccount(admin, accountId)
  if (!request) {
    await takeBack()
    throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })
  }

  const amount = -refundRow.amount_cents
  let refund: GcRefund
  try {
    // The GoCardless payment has to be one QuiroFlow booked for this patient.
    // payments.gocardless_payment_id is what the ledger says; the confirmed
    // event row, which only the server writes, on one of this patient's
    // schedules, is what proves it -- and survives the mandate being replaced.
    const { data: booked } = await admin
      .from('gocardless_payment_events')
      .select('id, payment_schedules!inner(patient_id)')
      .eq('account_id', accountId)
      .eq('gocardless_payment_id', original.gocardless_payment_id)
      .eq('action', 'confirmed')
      .eq('payment_schedules.patient_id', original.patient_id!)
      .maybeSingle()
    if (!booked) {
      await takeBack()
      throw createError({ statusCode: 409, statusMessage: 'That GoCardless payment was not collected for this patient' })
    }
    const { payments: payment } = await request<{ payments: GcPayment & { amount_refunded?: number } }>('GET', `/payments/${encodeURIComponent(original.gocardless_payment_id)}`)
    ;({ refunds: refund } = await request<{ refunds: GcRefund }>('POST', '/refunds', {
      idempotencyKey: `qf-refund-${refundRow.id}`,
      body: {
        refunds: {
          amount,
          total_amount_confirmation: (payment.amount_refunded ?? 0) + amount,
          metadata: { quiroflow_payment: refundRow.id },
          links: { payment: payment.id },
        },
      },
    }))
  } catch (err: any) {
    if (err?.statusCode === 409) throw err
    await takeBack()
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(admin, accountId)
      throw createError({ statusCode: 409, statusMessage: 'GoCardless was disconnected from its own dashboard. Connect it again.' })
    }
    // Refunds are a restricted endpoint that GoCardless switches on per
    // merchant; until it does, every refund answers a bare "Forbidden".
    if (err instanceof GoCardlessError && err.status === 403) {
      throw createError({ statusCode: 409, statusMessage: 'Refunds are not enabled on this clinic’s GoCardless account. Ask GoCardless to enable them, or refund it another way. Nothing was recorded.' })
    }
    throw createError({ statusCode: 502, statusMessage: `GoCardless did not refund it: ${(err as Error).message}` })
  }

  const { error } = await admin.from('payments').update({ gocardless_refund_id: refund.id }).eq('id', refundRow.id)
  // The money is on its way back either way; only the link to it is missing,
  // which a refunds/failed event would then not find. Logged, not refused.
  if (error) console.error('[gocardless refund] could not record', refund.id, error.message)
  return { refundId: refund.id, status: refund.status }
})
