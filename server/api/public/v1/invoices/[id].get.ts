import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { loose } from '~/server/utils/publicApiHandlers'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { invoicesResource } from '~/server/utils/publicApiResources'

// An invoice without its lines and payments isn't much of an invoice, so the
// detail route joins both. The list route stays flat -- fetching lines for
// 100 invoices to render a table nobody expands is wasted work.
export default defineApiHandler({ scope: 'billing:read' }, async ({ event, supabase, accountId }) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id')

  const { data: invoice, error } = await loose(supabase)
    .from('invoices')
    .select(invoicesResource.select)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new ApiError('server_error', error.message)
  if (!invoice) throw notFound('invoice')

  const [{ data: lines }, { data: payments }] = await Promise.all([
    loose(supabase).from('invoice_line_items').select('id, description, quantity, price_cents, service_id').eq('account_id', accountId).eq('invoice_id', id),
    loose(supabase).from('payments').select('id, amount_cents, method, paid_at, stripe_payment_intent_id').eq('account_id', accountId).eq('invoice_id', id).order('paid_at', { ascending: true }),
  ])

  return {
    data: {
      ...invoicesResource.serialize(invoice),
      line_items: (lines ?? []).map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        price_cents: l.price_cents,
        service_id: l.service_id,
      })),
      payments: (payments ?? []).map((p) => ({
        id: p.id,
        amount_cents: p.amount_cents,
        method: p.method,
        paid_at: p.paid_at,
        stripe_payment_intent_id: p.stripe_payment_intent_id,
      })),
    },
  }
})
