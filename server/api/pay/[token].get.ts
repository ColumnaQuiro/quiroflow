import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { invoiceCheckoutUrl } from '~/server/utils/invoiceCheckout'

// The "pay here" link in a payment reminder (invoices.pay_token, set by the
// invoice.overdue automation). No session -- the patient clicks it from
// WhatsApp or an email -- so the token is the credential, as for the waitlist
// and review links.
//
// It makes a fresh Stripe Checkout page each time it is opened, for whatever
// is still owed then (server/utils/invoiceCheckout.ts), because a Checkout
// page lasts 24 hours and a reminder sits in a chat for much longer. Paid in
// the meantime, or anything else that stops it, lands on /payment-done with
// a status that says so rather than a bare error.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  const origin = getRequestURL(event).origin
  const done = (status: string) => sendRedirect(event, `${origin}/payment-done?status=${status}`, 302)
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return done('invalid')

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, account_id, invoice_number, status, total_cents, is_refund')
    .eq('pay_token', token)
    .maybeSingle()
  if (!invoice) return done('invalid')
  if (invoice.status === 'paid') return done('already_paid')
  try {
    const { url } = await invoiceCheckoutUrl(event, invoice)
    return sendRedirect(event, url, 303)
  } catch (e) {
    const message = (e as { statusMessage?: string })?.statusMessage ?? ''
    return done(/settled/i.test(message) ? 'already_paid' : 'unavailable')
  }
})
