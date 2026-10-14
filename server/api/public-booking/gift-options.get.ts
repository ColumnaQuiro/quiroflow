import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// What a clinic's gift voucher page offers (/regalo/<slug>): the amounts, the
// services and bonos it sells as gifts, and how long they last -- only what
// Settings > Bonos regalo switched on, with prices read here, never from the
// page. No session: anyone may look at a clinic's gift page.
export default defineEventHandler(async (event) => {
  const slug = String(getQuery(event).slug ?? '')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'slug is required' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase.from('accounts').select('id, name, stripe_publishable_key').eq('slug', slug).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Clinic not found' })
  const { data: s } = await supabase.from('gift_voucher_settings').select('*').eq('account_id', account.id).maybeSingle()
  if (!s?.enabled || !account.stripe_publishable_key) return { enabled: false, clinicName: account.name }
  const [{ data: packages }, { data: types }] = await Promise.all([
    s.package_ids.length ? supabase.from('packages').select('id, name, price_cents, session_count').eq('account_id', account.id).in('id', s.package_ids) : Promise.resolve({ data: [] }),
    s.appointment_type_ids.length
      ? supabase.from('appointment_types').select('id, name, default_price_cents').eq('account_id', account.id).is('archived_at', null).in('id', s.appointment_type_ids)
      : Promise.resolve({ data: [] }),
  ])
  return {
    enabled: true,
    clinicName: account.name,
    amountsCents: s.amounts_cents,
    allowCustomAmount: s.allow_custom_amount,
    validMonths: s.valid_months,
    packages: ((packages ?? []) as { id: string; name: string; price_cents: number; session_count: number }[]).filter((p) => p.price_cents >= 100).map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, sessions: p.session_count })),
    services: ((types ?? []) as { id: string; name: string; default_price_cents: number }[]).filter((x) => x.default_price_cents >= 100).map((x) => ({ id: x.id, name: x.name, priceCents: x.default_price_cents })),
  }
})
