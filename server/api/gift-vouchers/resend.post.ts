import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { deliverGiftVoucher, type GiftVoucher } from '~/server/utils/giftVouchers'

// "Reenviar" in Settings > Bonos regalo: the voucher's email again, to the
// same person, now -- a recipient who lost it, or one scheduled for later
// that the buyer wants sent today. Paid and unredeemed vouchers only.
export default defineEventHandler(async (event) => {
  const { supabase } = await requirePermission(event, 'billing_access')
  const body = await readBody<{ id?: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  // Through the caller's client first: RLS says whether this is their clinic's.
  const { data: visible } = await supabase.from('gift_vouchers').select('id').eq('id', body.id).maybeSingle()
  if (!visible) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const service = serverSupabaseServiceRole<Database>(event)
  const { data } = await service.from('gift_vouchers').select('*').eq('id', body.id).maybeSingle()
  const v = data as GiftVoucher | null
  if (!v || v.status !== 'paid') throw createError({ statusCode: 409, statusMessage: 'Solo se reenvían los bonos pagados y sin canjear.' })
  await deliverGiftVoucher(service, v, getRequestURL(event).origin)
  return { ok: true }
})
