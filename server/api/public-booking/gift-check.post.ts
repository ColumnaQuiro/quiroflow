import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { GIFT_REFUSAL, giftLabel, giftVoucherFor } from '~/server/utils/giftVouchers'

// "Tengo un bono regalo" on the booking page: whether a code can be used
// here, and what it is, before the booking is made. Redeeming happens in
// book.post.ts, once there is a patient to put it on.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ slug?: string; code?: string }>(event)
  if (!body?.slug || !body.code?.trim()) throw createError({ statusCode: 400, statusMessage: 'slug and code are required' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase.from('accounts').select('id').eq('slug', body.slug).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })
  const check = await giftVoucherFor(supabase, account.id, body.code)
  if (!check.ok) return { ok: false, message: GIFT_REFUSAL[check.reason] }
  const v = check.voucher
  return {
    ok: true,
    code: v.code,
    label: giftLabel(v),
    kind: v.kind,
    valueCents: v.value_cents,
    description: v.kind === 'package' ? `${v.item_name}, para usar en tus próximas visitas` : `${(v.value_cents / 100).toLocaleString('es-ES')} € de saldo para usar en la clínica`,
  }
})
