import { randomInt } from 'node:crypto'
import { issueFacturaServer } from '~/server/utils/facturas'
import { sendResendEmail } from '~/server/utils/resend'

// Gift vouchers (gift_vouchers): the code, redeeming one onto a patient, and
// emailing it. See the migration (20261014082340_gift_vouchers.sql) for why
// redeeming is the desk's own "Add credit" / "sell a bono", nothing new.

export interface GiftVoucher {
  id: string
  account_id: string
  code: string
  kind: 'amount' | 'service' | 'package'
  value_cents: number
  package_id: string | null
  appointment_type_id: string | null
  item_name: string
  to_name: string
  from_name: string
  message: string | null
  deliver_to: 'recipient' | 'buyer'
  recipient_email: string | null
  buyer_email: string
  send_on: string | null
  status: 'pending' | 'paid' | 'redeemed' | 'cancelled'
  stripe_payment_intent_id: string | null
  paid_at: string | null
  expires_at: string | null
  sent_at: string | null
  redeemed_at: string | null
}

// No 0/O, 1/I/L: read aloud at a desk or typed from a phone screen.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newGiftCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return `REGALO-${s}`
}
/** As typed: any case, spaces or a missing prefix. */
export function normalizeGiftCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `REGALO-${s.startsWith('REGALO') ? s.slice(6) : s}`
}

export type GiftCheck = { ok: true; voucher: GiftVoucher } | { ok: false; reason: 'unknown' | 'unpaid' | 'redeemed' | 'expired' }

/** The voucher a code names in this clinic, and whether it can be redeemed now. */
export async function giftVoucherFor(supabase: any, accountId: string, rawCode: string): Promise<GiftCheck> {
  const { data } = await supabase.from('gift_vouchers').select('*').eq('account_id', accountId).eq('code', normalizeGiftCode(rawCode)).maybeSingle()
  const v = data as GiftVoucher | null
  if (!v || v.status === 'cancelled') return { ok: false, reason: 'unknown' }
  if (v.status === 'pending') return { ok: false, reason: 'unpaid' }
  if (v.status === 'redeemed') return { ok: false, reason: 'redeemed' }
  if (v.expires_at && Date.parse(v.expires_at) < Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, voucher: v }
}

export const GIFT_REFUSAL: Record<Exclude<GiftCheck, { ok: true }>['reason'], string> = {
  unknown: 'Ese código no existe.',
  unpaid: 'Ese bono regalo aún no está pagado.',
  redeemed: 'Ese bono regalo ya se ha canjeado.',
  expired: 'Ese bono regalo ha caducado.',
}

/**
 * Puts a paid voucher onto a patient, once. The voucher is claimed first
 * (status paid -> redeemed, conditional), so two redemptions racing for the
 * same code cannot both record money.
 *
 *   amount / service -> a payment on account, its credit row and its factura
 *                       (BillingTab's addCredit)
 *   package          -> the bono, a payment against it and its factura
 *                       (BillingTab's sellPackage + recordPackagePayment)
 *
 * The payment is a card payment: that is how the money came in, at the sale.
 * Its external_reference names the voucher.
 */
export async function redeemGiftVoucher(supabase: any, voucher: GiftVoucher, patientId: string, redeemedBy: string | null): Promise<{ paymentId: string }> {
  const { data: claimed } = await supabase
    .from('gift_vouchers')
    .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), redeemed_by: redeemedBy })
    .eq('id', voucher.id)
    .eq('status', 'paid')
    .select('id')
  if (!claimed?.length) throw createError({ statusCode: 409, statusMessage: GIFT_REFUSAL.redeemed })

  const reference = `regalo:${voucher.code}`
  const undo = async () => {
    await supabase.from('gift_vouchers').update({ status: 'paid', redeemed_at: null, redeemed_by: null }).eq('id', voucher.id)
  }

  if (voucher.kind === 'package') {
    const { data: pkg } = await supabase.from('packages').select('id, name, session_count, price_cents').eq('id', voucher.package_id).maybeSingle()
    if (!pkg) {
      await undo()
      throw createError({ statusCode: 409, statusMessage: 'El bono de este regalo ya no existe en la clínica. Canjéalo como saldo desde la ficha.' })
    }
    const { data: purchase, error: purchaseError } = await supabase
      .from('package_purchases')
      .insert({ account_id: voucher.account_id, patient_id: patientId, package_id: pkg.id, package_name: pkg.name, sessions_total: pkg.session_count, price_cents: pkg.price_cents, invoice_id: null, owed_cents: pkg.price_cents, created_by: redeemedBy, external_reference: reference })
      .select('id')
      .single()
    if (purchaseError || !purchase) {
      await undo()
      throw createError({ statusCode: 500, statusMessage: 'No se ha podido crear el bono.' })
    }
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({ account_id: voucher.account_id, patient_id: patientId, invoice_id: null, package_purchase_id: purchase.id, amount_cents: voucher.value_cents, method: 'card', purpose: 'bono', external_reference: reference, created_by: redeemedBy })
      .select('id')
      .single()
    if (paymentError || !payment) {
      await supabase.from('package_purchases').delete().eq('id', purchase.id)
      await undo()
      throw createError({ statusCode: 500, statusMessage: 'No se ha podido registrar el pago del bono.' })
    }
    await issueFacturaServer(supabase, { accountId: voucher.account_id, patientId, paymentId: payment.id, amountCents: voucher.value_cents, purpose: 'bono', bono: { packageName: pkg.name, priceCents: pkg.price_cents, sessionsTotal: pkg.session_count } })
    await supabase.from('gift_vouchers').update({ redeemed_payment_id: payment.id }).eq('id', voucher.id)
    return { paymentId: payment.id }
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({ account_id: voucher.account_id, patient_id: patientId, invoice_id: null, amount_cents: voucher.value_cents, method: 'card', purpose: 'on_account', external_reference: reference, created_by: redeemedBy })
    .select('id')
    .single()
  if (paymentError || !payment) {
    await undo()
    throw createError({ statusCode: 500, statusMessage: 'No se ha podido registrar el saldo.' })
  }
  // The credit row restates the payment (payment_id), as Add credit's does.
  await supabase.from('account_credits').insert({ account_id: voucher.account_id, patient_id: patientId, amount_cents: voucher.value_cents, reason: `Bono regalo ${voucher.code} · ${voucher.item_name}`, method: 'card', payment_id: payment.id, created_by: redeemedBy })
  await issueFacturaServer(supabase, {
    accountId: voucher.account_id,
    patientId,
    paymentId: payment.id,
    amountCents: voucher.value_cents,
    purpose: 'on_account',
    ...(voucher.kind === 'service' ? { serviceName: `Bono regalo: ${voucher.item_name}` } : {}),
  })
  await supabase.from('gift_vouchers').update({ redeemed_payment_id: payment.id }).eq('id', voucher.id)
  return { paymentId: payment.id }
}

const euros = (cents: number) => `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** What the voucher is, as the person receiving it reads it. */
export function giftLabel(v: Pick<GiftVoucher, 'kind' | 'value_cents' | 'item_name'>) {
  return v.kind === 'amount' ? euros(v.value_cents) : v.item_name
}

/**
 * The voucher by email: to the person receiving it, or (deliver_to 'buyer')
 * to the buyer to hand over. The buyer is always told it went, with the code.
 * Marks it sent; throws only if the email to its holder failed, so the
 * delivery is tried again on the next run.
 */
export async function deliverGiftVoucher(supabase: any, v: GiftVoucher, origin: string) {
  const { data: account } = await supabase.from('accounts').select('name, slug').eq('id', v.account_id).maybeSingle()
  const clinic = account?.name ?? 'la clínica'
  const bookUrl = account?.slug ? `${origin}/book/${account.slug}?regalo=${encodeURIComponent(v.code)}` : origin
  const until = v.expires_at ? new Date(v.expires_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }) : ''
  const card = `
    <div style="border-radius:14px;background:#4F46E5;color:#fff;padding:22px;font-family:system-ui,sans-serif">
      <div style="font-size:13px;opacity:.9">Bono regalo · ${esc(clinic)}</div>
      <div style="font-size:30px;font-weight:700;margin-top:14px">${esc(giftLabel(v))}</div>
      <div style="font-size:14px;margin-top:10px">Para ${esc(v.to_name)}, de parte de ${esc(v.from_name)}</div>
    </div>
    ${v.message ? `<p style="font-style:italic;color:#3A3F52">«${esc(v.message)}»</p>` : ''}
    <p>Código: <strong style="font-family:monospace;font-size:16px">${esc(v.code)}</strong>${until ? ` · válido hasta el ${until}` : ''}.</p>
    <p><a href="${bookUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Reservar con mi bono</a></p>
    <p style="color:#6B7180;font-size:13px">También puedes dar el código en recepción.</p>`

  const holder = v.deliver_to === 'recipient' && v.recipient_email ? v.recipient_email : v.buyer_email
  await sendResendEmail({
    to: holder,
    subject: v.deliver_to === 'recipient' ? `${v.from_name} te regala un bono en ${clinic}` : `Tu bono regalo para ${v.to_name} · ${clinic}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">${v.deliver_to === 'recipient' ? `<p>Hola ${esc(v.to_name)},</p><p>${esc(v.from_name)} te regala un bono en ${esc(clinic)}.</p>` : `<p>Aquí tienes el bono regalo para ${esc(v.to_name)}, listo para dárselo.</p>`}${card}</div>`,
  })
  await supabase.from('gift_vouchers').update({ sent_at: new Date().toISOString() }).eq('id', v.id)
  if (v.deliver_to === 'recipient') {
    try {
      await sendResendEmail({
        to: v.buyer_email,
        subject: `Hemos enviado tu bono regalo a ${v.to_name}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px"><p>Tu bono regalo para ${esc(v.to_name)} se ha enviado a ${esc(v.recipient_email ?? '')}.</p>${card}</div>`,
      })
    } catch (err) {
      console.error('[gift-voucher] buyer copy failed', v.id, err)
    }
  }
}

/** Today in Madrid, as the send_on dates are chosen. */
export function madridToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Paid vouchers whose day has come and that have not gone out, from 09:00 Madrid on that day. */
export async function deliverDueGiftVouchers(supabase: any, origin: string, now = new Date()): Promise<number> {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(now))
  if (hour < 9) return 0
  const { data } = await supabase.from('gift_vouchers').select('*').eq('status', 'paid').is('sent_at', null).lte('send_on', madridToday(now)).limit(50)
  let sent = 0
  for (const v of (data ?? []) as GiftVoucher[]) {
    try {
      await deliverGiftVoucher(supabase, v, origin)
      sent++
    } catch (err) {
      console.error('[gift-voucher] delivery failed', v.id, err)
    }
  }
  return sent
}
