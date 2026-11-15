import type { H3Event } from 'h3'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { issueFacturaServer, issueRectificativaServer } from '~/server/utils/facturas'
import { pushPatientAction } from '~/server/utils/staffPush'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { fireReferredVisitTrigger } from '~/server/utils/automationTriggers'
import { isVisitUpcoming } from '~/utils/visitCharging'
import { refundedAgainstPaymentCents, type RefundInvoice } from '~/utils/paymentRefund'
import { refundDescription } from '~/utils/billingDescriptions'
import { formatEur } from '~/utils/billing'
import { completeVisit } from '~/utils/completeVisit'

// A patient paying for a visit from the app, with nobody at the desk: ahead of
// a booked visit, or for the one they have just had. Off unless the clinic
// turned it on (accounts.stripe_app_payments_enabled).
//
// No invoice is raised until the money is in. The PaymentIntent carries the
// visit (metadata.app_visit_id) and the price, and recordAppVisitPayment()
// writes the invoice, the card payment and the factura together once Stripe
// says it succeeded -- from the pay route when the card goes straight
// through, from the payment_intent.succeeded webhook otherwise (3-D Secure,
// Checkout). Raising the invoice first, as online booking does, leaves an
// unpaid charge on a visit that has not happened whenever the patient walks
// away from the bank's check, and the app would then show them a debt for it.
//
// What is written is what the desk writes for a visit paid by card
// (useVisitCharging): an invoice on the appointment with the type's name as
// its line, a 'card' payment for 'visit', a factura at payment -- the moment
// VAT on an advance falls due -- so the ledger, the cash-up and the visit's
// own billing panel need nothing new. At the visit the panel finds it paid,
// and anything added there is owed on top, payable with the existing "Pagar".
//
// Recording is idempotent on the PaymentIntent: payments has a unique index
// on stripe_payment_intent_id, so the route and the webhook racing each other
// book it once, and the loser's invoice is taken back out.

type Service = SupabaseClient<Database>

/** How far back "the visit you have just had" reaches. */
export const APP_PAY_PAST_DAYS = 30

export interface AppVisit {
  id: string
  account_id: string
  patient_id: string
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  checked_in_at: string | null
  status: string
  class_session_id: string | null
}

export const APP_VISIT_COLUMNS = 'id, account_id, patient_id, practitioner_id, appointment_type_id, starts_at, checked_in_at, status, class_session_id'

export type AppVisitCharge =
  | { state: 'payable'; amountCents: number; invoiceId: string | null; typeName: string }
  | { state: 'paid'; amountCents: number }
  | { state: 'none'; reason: 'status' | 'bono' | 'class' | 'too_old' | 'no_price' }

/** The visit's price: the practitioner's own price for the type, else the type's. As online booking and the desk. */
async function visitPrice(service: Service, visit: AppVisit): Promise<{ cents: number; typeName: string }> {
  if (!visit.appointment_type_id) return { cents: 0, typeName: 'Consulta' }
  const [{ data: type }, { data: override }] = await Promise.all([
    service.from('appointment_types').select('name, default_price_cents').eq('id', visit.appointment_type_id).maybeSingle(),
    visit.practitioner_id
      ? service
          .from('appointment_type_overrides')
          .select('price_cents')
          .eq('appointment_type_id', visit.appointment_type_id)
          .eq('team_member_id', visit.practitioner_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return { cents: override?.price_cents ?? type?.default_price_cents ?? 0, typeName: type?.name ?? 'Consulta' }
}

/**
 * Whether the patient holds a bono they can still draw on -- their own or one
 * shared with them -- in which case the visit comes out of it and is not
 * offered for payment. Paying as well would pay for it twice.
 */
export async function hasLiveBono(service: Service, patientId: string): Promise<boolean> {
  const [{ data: own }, { data: shares }] = await Promise.all([
    service.from('package_purchases').select('sessions_used, sessions_total, is_closed').eq('patient_id', patientId),
    service.from('package_purchase_shares').select('package_purchases(sessions_used, sessions_total, is_closed)').eq('patient_id', patientId),
  ])
  const shared = (shares ?? []).map((s) => (s as unknown as { package_purchases: { sessions_used: number; sessions_total: number; is_closed: boolean } | null }).package_purchases)
  return [...(own ?? []), ...shared].some((p) => p && !p.is_closed && p.sessions_used < p.sessions_total)
}

/** Live receipts on a visit: not void, not a refund. */
async function visitInvoices(service: Service, visitId: string) {
  const { data } = await service
    .from('invoices')
    .select('id, invoice_number, status, total_cents, is_refund, created_at')
    .eq('appointment_id', visitId)
    .order('created_at', { ascending: false })
  return (data ?? []).filter((i) => i.status !== 'void' && !i.is_refund)
}

/**
 * What the patient would pay for one visit from the app, or why there is
 * nothing to pay. `liveBono` lets a caller pricing several visits of one
 * patient ask hasLiveBono once rather than per visit.
 */
export async function appVisitCharge(service: Service, visit: AppVisit, opts: { now?: Date; liveBono?: boolean } = {}): Promise<AppVisitCharge> {
  const now = opts.now ?? new Date()
  if (visit.status === 'cancelled' || visit.status === 'no_show') return { state: 'none', reason: 'status' }

  // Billed already -- by the desk, by online booking's deposit, or by an
  // earlier payment from here. An open receipt is paid as it stands, with
  // whatever was added to it; a settled one is done.
  const invoices = await visitInvoices(service, visit.id)
  const open = invoices.find((i) => i.status === 'unpaid')
  if (open) {
    const { data: paid } = await service.from('payments').select('amount_cents').eq('invoice_id', open.id)
    const remainingCents = open.total_cents - (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
    const { typeName } = await visitPrice(service, visit)
    if (remainingCents >= 50) return { state: 'payable', amountCents: remainingCents, invoiceId: open.id, typeName }
  }
  if (invoices.length > 0) return { state: 'paid', amountCents: invoices.reduce((sum, i) => sum + i.total_cents, 0) }

  if (visit.class_session_id) return { state: 'none', reason: 'class' }
  if (!isVisitUpcoming(visit, now) && now.getTime() - new Date(visit.starts_at).getTime() > APP_PAY_PAST_DAYS * 86_400_000) {
    return { state: 'none', reason: 'too_old' }
  }
  const { data: session } = await service.from('package_sessions').select('id').eq('appointment_id', visit.id).maybeSingle()
  if (session || (opts.liveBono ?? (await hasLiveBono(service, visit.patient_id)))) return { state: 'none', reason: 'bono' }

  const { cents, typeName } = await visitPrice(service, visit)
  // Stripe's minimum charge in euros.
  if (cents < 50) return { state: 'none', reason: 'no_price' }
  return { state: 'payable', amountCents: cents, invoiceId: null, typeName }
}

/** The clinic's Stripe settings as the pay and refund paths need them. */
export async function appPaymentsAccount(service: Service, accountId: string) {
  const { data } = await service
    .from('accounts')
    .select('id, name, stripe_connect_account_id, stripe_publishable_key, stripe_app_payments_enabled')
    .eq('id', accountId)
    .maybeSingle()
  return data
}

export type AppVisitPayResult = { status: 'paid' | 'processing' } | { status: 'redirect'; url: string }

/**
 * Charges one visit: the saved card when there is one, otherwise a
 * Stripe-hosted Checkout page. The amount is always appVisitCharge's, never
 * the caller's.
 */
/**
 * The card that pays for a visit from the app. The visit's own patient's,
 * when they have one; otherwise -- family accounts, a parent paying for a
 * child they manage -- the card on the signed-in person's own record at the
 * same clinic. Whose card it is changes nothing about whose visit it is: the
 * payment, the receipt and the factura stay on the visit's patient
 * (bill_to_tutor already addresses a minor's facturas to the tutor).
 */
export async function payerCard(service: Service, visitPatientId: string, payerUserId: string | null, accountId: string) {
  const { data: own } = await service
    .from('patient_stripe_customers')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('patient_id', visitPatientId)
    .maybeSingle()
  if (own?.default_payment_method_id || !payerUserId) return { customer: own, payerPatientId: visitPatientId, owner: 'self' as const }
  const { data: payer } = await service
    .from('patients')
    .select('id')
    .eq('user_id', payerUserId)
    .eq('account_id', accountId)
    .neq('id', visitPatientId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!payer) return { customer: own, payerPatientId: visitPatientId, owner: 'self' as const }
  const { data: theirs } = await service
    .from('patient_stripe_customers')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('patient_id', payer.id)
    .maybeSingle()
  if (!theirs?.default_payment_method_id) return { customer: own, payerPatientId: visitPatientId, owner: 'self' as const }
  return { customer: theirs, payerPatientId: payer.id, owner: 'payer' as const }
}

export async function payAppVisit(event: H3Event, service: Service, visit: AppVisit, opts: { payerUserId?: string } = {}): Promise<AppVisitPayResult> {
  const account = await appPaymentsAccount(service, visit.account_id)
  if (!account?.stripe_publishable_key || !account.stripe_app_payments_enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Online payment is not configured for this clinic.' })
  }
  const charge = await appVisitCharge(service, visit)
  if (charge.state === 'paid') throw createError({ statusCode: 409, statusMessage: 'This visit is already paid.' })
  if (charge.state === 'none') throw createError({ statusCode: 409, statusMessage: `This visit is not payable from the app (${charge.reason}).` })

  // A receipt the desk already raised is paid exactly as "Pagar" pays it --
  // the existing invoice branch of the webhook records it. Otherwise the
  // visit itself, and recordAppVisitPayment raises the receipt.
  const { customer, payerPatientId } = await payerCard(service, visit.patient_id, opts.payerUserId ?? null, account.id)
  const metadata: Record<string, string> = charge.invoiceId
    ? { invoice_id: charge.invoiceId, account_id: account.id, source: 'patient_pay' }
    : { app_visit_id: visit.id, account_id: account.id, source: 'patient_pay' }
  if (payerPatientId !== visit.patient_id) metadata.payer_patient_id = payerPatientId
  const description = `${account.name} · ${charge.typeName}`

  const { stripe, options } = await stripeClientFor(event, account.id, account)
  const origin = getRequestURL(event).origin

  if (!customer?.default_payment_method_id) {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'es',
        customer: customer?.stripe_customer_id ?? undefined,
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: charge.amountCents, product_data: { name: description } } }],
        payment_intent_data: { metadata, description },
        success_url: `${origin}/payment-done?status=success`,
        cancel_url: `${origin}/payment-done?status=cancelled`,
      },
      options,
    )
    if (!session.url) throw createError({ statusCode: 502, statusMessage: 'Could not start the payment' })
    return { status: 'redirect', url: session.url }
  }

  let intent: Stripe.PaymentIntent
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: charge.amountCents,
        currency: 'eur',
        customer: customer.stripe_customer_id,
        payment_method: customer.default_payment_method_id,
        // No payment_method_types: the saved card decides the method, and
        // Stripe refuses the parameter outright (400) from API version
        // 2026-08-26 on -- this would break on the next version bump in
        // server/utils/stripe.ts with nothing else changed.
        confirm: true,
        // The patient is here and pressing Pay, so this is theirs to
        // authenticate: a bank that asks for 3-D Secure gets its page, opened
        // in the browser from this return_url's flow (next_action.redirect_to_url).
        // The patient comes back here having passed the check OR failed it,
        // and Stripe says which nowhere in the URL, so the page asks
        // (api/pay/intent-status) rather than announcing success.
        return_url: `${origin}/payment-done?status=check&account=${account.id}`,
        description,
        metadata,
      },
      // Two taps in the same minute are one payment. A new card, or a
      // different amount, is a new key.
      { ...options, idempotencyKey: `app-visit:${visit.id}:${charge.amountCents}:${customer.default_payment_method_id}:${Math.floor(Date.now() / 60_000)}` },
    )
  } catch (err) {
    const stripeError = err as { type?: string; message?: string }
    if (stripeError.type === 'StripeCardError') throw createError({ statusCode: 402, statusMessage: 'card_declined', message: stripeError.message })
    throw err
  }

  if (intent.status === 'succeeded') {
    if (!charge.invoiceId) await recordAppVisitPayment(service, account.id, intent, origin)
    return { status: 'paid' }
  }
  if (intent.status === 'processing') return { status: 'processing' }
  const redirect = intent.next_action?.redirect_to_url?.url
  if (intent.status === 'requires_action' && redirect) return { status: 'redirect', url: redirect }
  throw createError({ statusCode: 402, statusMessage: 'card_declined' })
}

/**
 * Books a succeeded app payment for a visit: from the pay route, and from the
 * webhook for anything that went through Stripe's own pages. Safe to call
 * twice for the same PaymentIntent.
 */
export async function recordAppVisitPayment(service: Service, accountId: string, intent: Stripe.PaymentIntent, origin: string): Promise<void> {
  const visitId = intent.metadata?.app_visit_id
  if (!visitId) return
  const { data: existing } = await service.from('payments').select('id').eq('stripe_payment_intent_id', intent.id).maybeSingle()
  if (existing) return

  const { data: visit } = await service.from('appointments').select(APP_VISIT_COLUMNS).eq('id', visitId).eq('account_id', accountId).maybeSingle()
  if (!visit) {
    console.error('[app-pay] paid for a visit that does not exist', visitId, intent.id)
    return
  }
  const amountCents = intent.amount_received || intent.amount
  const { typeName } = await visitPrice(service, visit)

  // The visit may have been billed while the patient was paying -- the
  // practitioner pressing Charge at the same moment. Pay that receipt rather
  // than raise a second; if it is settled already, the money is the
  // patient's, on account, rather than lost.
  const invoices = await visitInvoices(service, visit.id)
  const open = invoices.find((i) => i.status === 'unpaid')
  let paymentId: string | null = null
  let purpose: 'visit' | 'on_account' = 'visit'

  if (open) {
    const { data: payment } = await service
      .from('payments')
      .insert({ account_id: accountId, patient_id: visit.patient_id, invoice_id: open.id, amount_cents: amountCents, method: 'card', stripe_payment_intent_id: intent.id, purpose: 'visit' })
      .select('id')
      .single()
    if (!payment) return
    paymentId = payment.id
    const { data: paid } = await service.from('payments').select('amount_cents').eq('invoice_id', open.id)
    if ((paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0) >= open.total_cents) {
      await service.from('invoices').update({ status: 'paid' }).eq('id', open.id)
    }
  } else if (invoices.length === 0) {
    const { data: invoiceNumber } = await service.rpc('next_invoice_number', { p_account_id: accountId })
    if (!invoiceNumber) throw new Error(`could not number the invoice for app payment ${intent.id}`)
    // Raised paid, before the payment that pays it exists (the payment names
    // it) -- the shape recordMembershipCharge has. If the payment is refused,
    // the receipt goes back out with it.
    const { data: invoice, error: invoiceError } = await service
      .from('invoices')
      .insert({ account_id: accountId, patient_id: visit.patient_id, appointment_id: visit.id, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
      .select('id')
      .single()
    if (invoiceError || !invoice) throw new Error(`could not raise the invoice for app payment ${intent.id}: ${invoiceError?.message}`)
    await service.from('invoice_line_items').insert({ account_id: accountId, invoice_id: invoice.id, description: typeName, quantity: 1, price_cents: amountCents })
    const { data: payment, error: paymentError } = await service
      .from('payments')
      .insert({ account_id: accountId, patient_id: visit.patient_id, invoice_id: invoice.id, amount_cents: amountCents, method: 'card', stripe_payment_intent_id: intent.id, purpose: 'visit' })
      .select('id')
      .single()
    if (paymentError || !payment) {
      // Most often the other caller booking the same PaymentIntent first.
      await service.from('invoices').delete().eq('id', invoice.id)
      if (paymentError?.code === '23505') return
      throw new Error(`could not record app payment ${intent.id}: ${paymentError?.message}`)
    }
    paymentId = payment.id
  } else {
    purpose = 'on_account'
    const { data: payment } = await service
      .from('payments')
      .insert({ account_id: accountId, patient_id: visit.patient_id, invoice_id: null, amount_cents: amountCents, method: 'card', stripe_payment_intent_id: intent.id, purpose: 'on_account' })
      .select('id')
      .single()
    if (!payment) return
    paymentId = payment.id
    // As a top-up at the desk: the credit row restates the payment (payment_id
    // set) so the balance does not count the same euros twice.
    await service.from('account_credits').insert({
      account_id: accountId,
      patient_id: visit.patient_id,
      amount_cents: amountCents,
      reason: `Pago desde la app de una visita ya cobrada (${typeName})`,
      method: 'card',
      payment_id: payment.id,
    })
  }

  await issueFacturaServer(service, {
    accountId,
    patientId: visit.patient_id,
    paymentId,
    amountCents,
    purpose,
    serviceName: purpose === 'visit' ? typeName : undefined,
  })

  const { data: who } = await service.from('patients').select('first_name, last_name').eq('id', visit.patient_id).maybeSingle()
  const name = who ? `${who.first_name} ${who.last_name ?? ''}`.trim() : 'Un paciente'
  const upcoming = isVisitUpcoming(visit)
  await pushPatientAction(service, {
    patientId: visit.patient_id,
    practitionerId: visit.practitioner_id,
    title: upcoming ? 'Visita pagada por adelantado' : 'Pago online recibido',
    body: `${name} · ${formatEur(amountCents)}`,
  })

  // Paying for a visit that has happened finishes it, as paying it in full at
  // the desk does -- and fires appointment.completed exactly once.
  if (!upcoming && purpose === 'visit') {
    const { completedNow } = await completeVisit(service, visit.id)
    if (completedNow) {
      await fireVisitRules(service, accountId, visit.id, visit.patient_id, 'appointment.completed', origin)
      await fireReferredVisitTrigger(service, accountId, visit.id, origin)
    }
  }
}

async function fireVisitRules(service: Service, accountId: string, appointmentId: string, patientId: string, trigger: string, origin: string) {
  try {
    const { data: patient } = await service
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', patientId)
      .maybeSingle()
    if (!patient) return
    const { data: rules } = await service.from('automation_rules').select('id, filters').eq('account_id', accountId).eq('trigger_event', trigger).eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(service, patient.id, rule.filters as AutomationFilters, appointmentId))) continue
      await dispatchPatientRule(service, service, accountId, rule.id, patient, origin, appointmentId, { triggerEvent: trigger, patientId: patient.id, appointmentId })
    }
  } catch (err) {
    console.error(`[app-pay] ${trigger} automations failed for ${appointmentId}`, err)
  }
}

/** Card money taken through Stripe for one visit, and how much of each payment is still refundable. */
export async function visitCardPayments(service: Service, visitId: string) {
  const invoices = await visitInvoices(service, visitId)
  if (invoices.length === 0) return []
  const ids = invoices.map((i) => i.id)
  const [{ data: payments }, { data: refunds }] = await Promise.all([
    service.from('payments').select('id, invoice_id, amount_cents, method, stripe_payment_intent_id').in('invoice_id', ids),
    service.from('invoices').select('id, status, total_cents, is_refund, refunds_invoice_id, refunds_payment_id').in('refunds_invoice_id', ids),
  ])
  const refundIds = (refunds ?? []).map((r) => r.id)
  const { data: refundPayments } = refundIds.length
    ? await service.from('payments').select('invoice_id, amount_cents, method').in('invoice_id', refundIds)
    : { data: [] as { invoice_id: string | null; amount_cents: number; method: string }[] }
  return (payments ?? [])
    .filter((p) => p.stripe_payment_intent_id && p.amount_cents > 0)
    .map((p) => ({
      ...p,
      invoice: invoices.find((i) => i.id === p.invoice_id)!,
      refundableCents: Math.max(0, p.amount_cents - refundedAgainstPaymentCents(p.id, (refunds ?? []) as RefundInvoice[], refundPayments ?? [])),
    }))
    .filter((p) => p.refundableCents > 0)
}

/**
 * Sends a cancelled visit's card money back through Stripe and records it as
 * the desk records a refund (BillingTab.createRefund): a REF- receipt naming
 * the payment, a negative payment, a rectificativa against its factura.
 *
 * `onlyAppPayments` limits it to what the patient paid from the app -- the
 * patient's own cancellation. An online-booking deposit on the same visit is
 * the clinic's to decide about, as it always has been.
 */
export async function refundVisitCardPayments(
  event: H3Event,
  service: Service,
  visit: { id: string; account_id: string; patient_id: string },
  opts: { reason: string; onlyAppPayments: boolean },
): Promise<{ refundedCents: number }> {
  const payments = await visitCardPayments(service, visit.id)
  if (payments.length === 0) return { refundedCents: 0 }
  const account = await appPaymentsAccount(service, visit.account_id)
  if (!account) return { refundedCents: 0 }
  const { stripe, options } = await stripeClientFor(event, account.id, account)

  let refundedCents = 0
  for (const p of payments) {
    if (opts.onlyAppPayments) {
      const intent = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id!, undefined, options)
      if (intent.metadata?.app_visit_id !== visit.id) continue
    }
    await stripe.refunds.create(
      { payment_intent: p.stripe_payment_intent_id!, amount: p.refundableCents, metadata: { payment_id: p.id, appointment_id: visit.id } },
      { ...options, idempotencyKey: `app-visit-refund:${p.id}:${p.refundableCents}` },
    )

    const { data: refundNumber } = await service.rpc('next_invoice_number', { p_account_id: account.id, p_prefix: 'REF-' })
    if (!refundNumber) throw new Error(`refunded ${p.stripe_payment_intent_id} but could not number its receipt`)
    const { data: refund } = await service
      .from('invoices')
      .insert({
        account_id: account.id,
        patient_id: visit.patient_id,
        invoice_number: refundNumber,
        status: 'paid',
        total_cents: -p.refundableCents,
        is_refund: true,
        refunds_invoice_id: p.invoice_id,
        refunds_payment_id: p.id,
      })
      .select('id')
      .single()
    if (!refund) throw new Error(`refunded ${p.stripe_payment_intent_id} but could not record it`)
    await service.from('invoice_line_items').insert({
      account_id: account.id,
      invoice_id: refund.id,
      description: refundDescription(p.invoice.invoice_number, opts.reason),
      quantity: 1,
      price_cents: -p.refundableCents,
    })
    const { data: refundPayment } = await service
      .from('payments')
      .insert({ account_id: account.id, patient_id: visit.patient_id, invoice_id: refund.id, amount_cents: -p.refundableCents, method: 'card' })
      .select('id')
      .single()
    if (refundPayment) {
      const { data: original } = await service.from('facturas').select('id, number').eq('payment_id', p.id)
      const only = (original ?? []).length === 1 ? original![0]! : null
      await issueRectificativaServer(service, {
        accountId: account.id,
        patientId: visit.patient_id,
        paymentId: refundPayment.id,
        amountCents: p.refundableCents,
        rectifiesFacturaId: only?.id ?? null,
        rectifiesNumber: only?.number ?? null,
        reason: opts.reason,
      })
    }
    refundedCents += p.refundableCents
  }
  return { refundedCents }
}

/**
 * Keeps a cancelled visit's card money as credit on the patient's account
 * instead: its receipt is voided -- there is no visit to charge -- and each
 * payment becomes a top-up, exactly as "Add credit" at the desk writes one
 * (a payment for 'on_account' and a credit row restating it). The factura
 * stands: the money was received and still is.
 */
export async function keepVisitPaymentsAsCredit(service: Service, visit: { id: string; account_id: string; patient_id: string }): Promise<{ creditedCents: number }> {
  const payments = await visitCardPayments(service, visit.id)
  let creditedCents = 0
  for (const p of payments) {
    // Only a receipt the card money alone pays, untouched by any refund: one
    // with other lines or other money on it is the desk's to untangle.
    const { data: all } = await service.from('payments').select('id').eq('invoice_id', p.invoice_id!)
    if ((all ?? []).length !== 1 || p.refundableCents !== p.amount_cents) continue
    await service.from('payments').update({ invoice_id: null, purpose: 'on_account' }).eq('id', p.id)
    await service.from('invoices').update({ status: 'void' }).eq('id', p.invoice_id!)
    await service.from('account_credits').insert({
      account_id: visit.account_id,
      patient_id: visit.patient_id,
      amount_cents: p.amount_cents,
      reason: `Visita cancelada (${p.invoice.invoice_number}): el pago queda como saldo`,
      method: 'card',
      payment_id: p.id,
    })
    creditedCents += p.amount_cents
  }
  return { creditedCents }
}
