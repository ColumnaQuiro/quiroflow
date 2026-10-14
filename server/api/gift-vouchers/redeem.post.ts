import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { GIFT_REFUSAL, giftLabel, giftVoucherFor, redeemGiftVoucher } from '~/server/utils/giftVouchers'

// Redeeming a gift voucher at the desk, from the patient's Money tab: the
// code, onto this patient. Under billing_access, as taking money is; the
// patient is read through the caller's own client, so RLS decides whether
// they may act on them. The rest (the payment, the credit or bono, the
// factura) is written on the service role by redeemGiftVoucher.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'billing_access')
  const body = await readBody<{ code?: string; patientId?: string }>(event)
  if (!body?.code?.trim() || !body.patientId) throw createError({ statusCode: 400, statusMessage: 'code and patientId are required' })
  const { data: patient } = await supabase.from('patients').select('id, account_id').eq('id', body.patientId).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const check = await giftVoucherFor(service, patient.account_id, body.code)
  if (!check.ok) throw createError({ statusCode: 409, statusMessage: GIFT_REFUSAL[check.reason] })
  await redeemGiftVoucher(service, check.voucher, patient.id, teamMember.id)
  return { kind: check.voucher.kind, label: giftLabel(check.voucher), itemName: check.voucher.item_name }
})
