import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The gift page after Stripe sends the buyer back: whether the payment has
// landed yet (the webhook may be a few seconds behind) and where the voucher
// is going. By the voucher's id, which only the buyer's redirect carries;
// never the code itself.
export default defineEventHandler(async (event) => {
  const id = String(getQuery(event).id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data } = await supabase.from('gift_vouchers').select('status, to_name, deliver_to, recipient_email, buyer_email, send_on').eq('id', id).maybeSingle()
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { paid: data.status !== 'pending', toName: data.to_name, deliverTo: data.deliver_to, to: data.deliver_to === 'recipient' ? data.recipient_email : data.buyer_email, sendOn: data.send_on }
})
