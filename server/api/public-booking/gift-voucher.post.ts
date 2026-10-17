import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { madridToday, newGiftCode } from '~/server/utils/giftVouchers'
import { throttlePublic } from '~/server/utils/publicRateLimit'

// Buying a gift voucher: the voucher is written as pending with a code, then
// the buyer goes to a Stripe-hosted Checkout on the clinic's own Stripe. The
// PaymentIntent carries metadata.gift_voucher_id, and the webhook's
// payment_intent.succeeded marks it paid and sends it (stripeWebhookHandlers)
// -- nothing is sent or redeemable before the money is in.
//
// What is sold and at what price comes from the clinic's settings and lists,
// never from the page: the page names an amount, a service or a bono.
const MIN_CUSTOM = 2000
const MAX_CUSTOM = 30000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  // Each call opens a Stripe Checkout session and writes a voucher row.
  await throttlePublic(event, { scope: 'gift-voucher', limit: 10, windowSeconds: 600 })
  const body = await readBody<{
    slug?: string
    kind?: 'amount' | 'service' | 'package'
    amountCents?: number
    itemId?: string
    toName?: string
    fromName?: string
    message?: string
    deliverTo?: 'recipient' | 'buyer'
    recipientEmail?: string
    buyerEmail?: string
    sendOn?: string | null
  }>(event)
  const bad = (m: string) => createError({ statusCode: 400, statusMessage: m })
  if (!body?.slug) throw bad('slug is required')
  const toName = (body.toName ?? '').trim().slice(0, 80)
  const fromName = (body.fromName ?? '').trim().slice(0, 80)
  const message = (body.message ?? '').trim().slice(0, 300) || null
  const buyerEmail = (body.buyerEmail ?? '').trim()
  const recipientEmail = (body.recipientEmail ?? '').trim() || null
  const deliverTo = body.deliverTo === 'buyer' ? 'buyer' : 'recipient'
  if (!toName || !fromName) throw bad('Indica para quién es y de parte de quién.')
  if (!EMAIL.test(buyerEmail)) throw bad('Revisa tu correo.')
  if (deliverTo === 'recipient' && !(recipientEmail && EMAIL.test(recipientEmail))) throw bad('Revisa el correo de quien lo recibe.')
  const today = madridToday()
  const sendOn = body.sendOn && /^\d{4}-\d{2}-\d{2}$/.test(body.sendOn) && body.sendOn > today ? body.sendOn : null

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await supabase.from('accounts').select('id, name, stripe_connect_account_id, stripe_publishable_key').eq('slug', body.slug).maybeSingle()
  if (!account?.stripe_publishable_key) throw bad('Esta clínica no vende bonos regalo online.')
  const { data: s } = await supabase.from('gift_voucher_settings').select('*').eq('account_id', account.id).maybeSingle()
  if (!s?.enabled) throw bad('Esta clínica no vende bonos regalo online.')

  let valueCents = 0
  let itemName = ''
  let packageId: string | null = null
  let typeId: string | null = null
  if (body.kind === 'amount') {
    valueCents = Math.round(Number(body.amountCents) || 0)
    const listed = s.amounts_cents.includes(valueCents)
    if (!listed && !(s.allow_custom_amount && valueCents >= MIN_CUSTOM && valueCents <= MAX_CUSTOM)) throw bad('Ese importe no está disponible.')
    itemName = `Saldo de ${(valueCents / 100).toLocaleString('es-ES')} €`
  } else if (body.kind === 'package' && body.itemId && s.package_ids.includes(body.itemId)) {
    const { data: pkg } = await supabase.from('packages').select('id, name, price_cents').eq('account_id', account.id).eq('id', body.itemId).maybeSingle()
    if (!pkg || pkg.price_cents < 100) throw bad('Ese bono ya no está disponible.')
    valueCents = pkg.price_cents
    itemName = pkg.name
    packageId = pkg.id
  } else if (body.kind === 'service' && body.itemId && s.appointment_type_ids.includes(body.itemId)) {
    const { data: type } = await supabase.from('appointment_types').select('id, name, default_price_cents').eq('account_id', account.id).eq('id', body.itemId).is('archived_at', null).maybeSingle()
    if (!type || type.default_price_cents < 100) throw bad('Ese servicio ya no está disponible.')
    valueCents = type.default_price_cents
    itemName = type.name
    typeId = type.id
  } else {
    throw bad('Elige qué regalar.')
  }

  // A code clash is astronomically rare; try again rather than fail.
  let voucherId: string | null = null
  for (let i = 0; i < 3 && !voucherId; i++) {
    const { data } = await supabase
      .from('gift_vouchers')
      .insert({ account_id: account.id, code: newGiftCode(), kind: body.kind, value_cents: valueCents, package_id: packageId, appointment_type_id: typeId, item_name: itemName, to_name: toName, from_name: fromName, message, deliver_to: deliverTo, recipient_email: deliverTo === 'recipient' ? recipientEmail : null, buyer_email: buyerEmail, send_on: sendOn })
      .select('id')
      .maybeSingle()
    voucherId = data?.id ?? null
  }
  if (!voucherId) throw createError({ statusCode: 500, statusMessage: 'No se ha podido preparar el bono.' })

  const { stripe, options } = await stripeClientFor(event, account.id, account)
  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      locale: 'es',
      customer_email: buyerEmail,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: valueCents, product_data: { name: `Bono regalo · ${itemName} · ${account.name}` } } }],
      payment_intent_data: { metadata: { gift_voucher_id: voucherId, account_id: account.id } },
      success_url: `${origin}/regalo/${encodeURIComponent(body.slug)}?pagado=${voucherId}`,
      cancel_url: `${origin}/regalo/${encodeURIComponent(body.slug)}`,
    },
    options,
  )
  if (!session.url) throw createError({ statusCode: 502, statusMessage: 'No se ha podido iniciar el pago.' })
  return { url: session.url }
})
