import { invoiceCheckoutUrl } from '~/server/utils/invoiceCheckout'

// A payment link for one unpaid invoice, for the front desk to send from an
// Inbox conversation: the same Stripe Checkout page the patient's own
// "Pagar" opens (server/utils/invoiceCheckout.ts), and recorded by the same
// webhook once paid. Read through the staff member's own client, so the
// invoices policy -- their patient scope -- decides whether they may.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invoice id is required' })

  const { supabase, teamMember } = await requirePermission(event, 'billing_access')
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, account_id, patient_id, invoice_number, status, total_cents, is_refund')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })

  return invoiceCheckoutUrl(event, invoice)
})
