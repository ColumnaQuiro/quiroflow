import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '~/types/database.types'
import { suggestMandatePatient, type MatchablePatient } from '~/utils/gocardlessMatch'
import { leadPhoneAsContactNumber } from '~/utils/phone'
import {
  closestSameCharge,
  membershipIntervalOf,
  stripeAutoPairDecision,
  stripeCustomerAsMatchable,
  stripeSubscriptionState,
  SAME_CHARGE_WINDOW_DAYS,
  type StripePairDecision,
} from '~/utils/stripeMembershipSync'

// Stripe subscriptions made outside QuiroFlow, synced as patient memberships
// (20261121150000_stripe_membership_sync.sql). The pure decisions are in
// utils/stripeMembershipSync.ts.
//
// Every read and write is filtered by accountId, the account whose Stripe the
// subscription was read from (a webhook verified for it, or the clinic's own
// client on the import screen). Nothing here writes to Stripe.

type Supa = SupabaseClient<Database>

export type StripeSyncResult =
  | { outcome: 'updated'; scheduleId: string }
  | { outcome: 'linked'; scheduleId: string; patientId: string; created: boolean; by: string }
  | { outcome: 'pending'; reason: 'unmapped_price' | 'not_live' | 'no_customer' | Extract<StripePairDecision, { action: 'pending' }>['reason'] }
  | { outcome: 'ours' }

/**
 * How the patient is chosen when the subscription is not paired yet.
 * auto: a webhook -- only what stripeAutoPairDecision allows.
 * manual: a person on the import screen named the patient, or asked for a
 * new one (patientId null).
 */
export type StripePairing = { mode: 'auto' } | { mode: 'manual'; patientId: string | null; memberId: string | null }

function customerOf(sub: Stripe.Subscription): Stripe.Customer | null {
  const c = sub.customer as Stripe.Customer | Stripe.DeletedCustomer | string
  if (!c || typeof c === 'string' || (c as Stripe.DeletedCustomer).deleted) return null
  return c as Stripe.Customer
}

/** The subscription's first item whose price is mapped to a plan, with the plan. */
async function mappedItem(supabase: Supa, accountId: string, sub: Stripe.Subscription) {
  const priceIds = sub.items.data.map((i) => i.price.id)
  if (!priceIds.length) return null
  const { data: maps } = await supabase
    .from('stripe_membership_prices')
    .select('stripe_price_id, membership_id, memberships(id, name)')
    .eq('account_id', accountId)
    .in('stripe_price_id', priceIds)
  const byPrice = new Map((maps ?? []).map((m) => [m.stripe_price_id, m]))
  for (const item of sub.items.data) {
    const map = byPrice.get(item.price.id)
    const plan = map?.memberships as { id: string; name: string } | null | undefined
    if (map && plan) return { item, plan }
  }
  return null
}

/**
 * Brings one Stripe subscription into QuiroFlow, or brings what is here up to
 * date with it. Safe to call any number of times, from any event, in any
 * order: it reads the subscription as it is now and writes the state that
 * follows from it.
 *
 * `sub` must have its customer expanded (`expand: ['customer']`) for a
 * subscription not paired yet.
 */
export async function syncStripeSubscription(supabase: Supa, accountId: string, sub: Stripe.Subscription, pairing: StripePairing): Promise<StripeSyncResult> {
  const state = stripeSubscriptionState({ status: sub.status, pauseCollection: sub.pause_collection })
  const recurring = membershipIntervalOf(sub.items.data[0]?.price?.recurring)

  // Already paired: one of ours (a Subscription Schedule the Billing tab made)
  // or one imported before. Ours keep the behaviour they always had -- the
  // subscription_schedule events manage them -- so only an imported one
  // follows Stripe's state here.
  let { data: schedule } = await supabase
    .from('payment_schedules')
    .select('id, origin, patient_membership_id')
    .eq('account_id', accountId)
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle()
  if (!schedule && sub.schedule) {
    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id
    const { data: ours } = await supabase
      .from('payment_schedules')
      .select('id, origin, patient_membership_id')
      .eq('account_id', accountId)
      .eq('stripe_subscription_schedule_id', scheduleId)
      .maybeSingle()
    if (ours) {
      await supabase.from('payment_schedules').update({ stripe_subscription_id: sub.id }).eq('id', ours.id).eq('account_id', accountId).is('stripe_subscription_id', null)
      schedule = ours
    }
  }
  if (schedule) {
    if (schedule.origin !== 'imported') return { outcome: 'ours' }
    if (state) {
      await supabase.from('payment_schedules').update({ status: state.schedule }).eq('id', schedule.id).eq('account_id', accountId)
      if (schedule.patient_membership_id) {
        await supabase.from('patient_memberships').update({ status: state.membership }).eq('id', schedule.patient_membership_id).eq('account_id', accountId)
      }
    }
    return { outcome: 'updated', scheduleId: schedule.id }
  }

  // Not paired. Only a live subscription becomes a membership: one already
  // cancelled in Stripe has nothing to bring in, and an incomplete one is not
  // paid for yet (its first invoice.paid brings it in then).
  if (!state || state.membership === 'cancelled') return { outcome: 'pending', reason: 'not_live' }

  const mapped = await mappedItem(supabase, accountId, sub)
  if (!mapped) return { outcome: 'pending', reason: 'unmapped_price' }

  const customer = customerOf(sub)
  if (!customer) return { outcome: 'pending', reason: 'no_customer' }

  // Who the patient is.
  let patientId: string | null = null
  let created = false
  let by: string
  if (pairing.mode === 'manual' && pairing.patientId) {
    const { data: patient } = await supabase.from('patients').select('id').eq('id', pairing.patientId).eq('account_id', accountId).maybeSingle()
    if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    patientId = patient.id
    by = 'manual'
  } else if (pairing.mode === 'manual') {
    patientId = await createPatientFromCustomer(supabase, accountId, customer)
    created = true
    by = 'created'
  } else {
    const decision = await autoDecision(supabase, accountId, customer)
    if (decision.action === 'pending') return { outcome: 'pending', reason: decision.reason }
    if (decision.action === 'create') {
      patientId = await createPatientFromCustomer(supabase, accountId, customer)
      created = true
      by = 'created'
    } else {
      patientId = decision.patientId
      by = decision.by
    }
  }

  // The membership: the patient's own one of this plan when the desk already
  // recorded it by hand (the usual case for a clinic moving across), so it is
  // not doubled; otherwise a new one from the Stripe price.
  const { data: existing } = await supabase
    .from('patient_memberships')
    .select('id, payment_schedules(id)')
    .eq('account_id', accountId)
    .eq('patient_id', patientId)
    .eq('membership_id', mapped.plan.id)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false })
  const free = (existing ?? []).find((m) => !(m.payment_schedules as unknown[] | null)?.length)
  const priceCents = (mapped.item.price.unit_amount ?? 0) * (mapped.item.quantity ?? 1)
  let membershipId: string
  if (free) {
    membershipId = free.id
    await supabase.from('patient_memberships').update({ status: state.membership }).eq('id', free.id).eq('account_id', accountId)
  } else {
    const { data: inserted, error } = await supabase
      .from('patient_memberships')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        membership_id: mapped.plan.id,
        membership_name: mapped.plan.name,
        price_cents: priceCents,
        status: state.membership,
        started_at: new Date(sub.start_date * 1000).toISOString(),
        billing_interval: recurring?.interval ?? null,
        billing_interval_count: recurring?.count ?? null,
        created_by: pairing.mode === 'manual' ? pairing.memberId : null,
      })
      .select('id')
      .single()
    if (error || !inserted) throw createError({ statusCode: 500, statusMessage: `Could not record the membership: ${error?.message}` })
    membershipId = inserted.id
  }

  const { data: inserted, error: scheduleError } = await supabase
    .from('payment_schedules')
    .insert({
      account_id: accountId,
      patient_id: patientId,
      patient_membership_id: membershipId,
      provider: 'stripe',
      origin: 'imported',
      adopted_membership: Boolean(free),
      stripe_subscription_id: sub.id,
      stripe_subscription_schedule_id: sub.schedule ? (typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id) : null,
      interval: recurring?.interval ?? 'month',
      interval_count: recurring?.count ?? 1,
      installments_total: null,
      installments_paid: 0,
      status: state.schedule,
    })
    .select('id')
    .single()
  if (scheduleError || !inserted) {
    // Another delivery paired it first: that one stands. A membership this
    // call created for it is taken back out so the patient is not shown two.
    if (scheduleError?.code === '23505') {
      if (!free) await supabase.from('patient_memberships').delete().eq('id', membershipId).eq('account_id', accountId)
      const { data: winner } = await supabase.from('payment_schedules').select('id').eq('account_id', accountId).eq('stripe_subscription_id', sub.id).maybeSingle()
      return { outcome: 'updated', scheduleId: winner?.id ?? '' }
    }
    throw createError({ statusCode: 500, statusMessage: `Could not pair the subscription: ${scheduleError?.message}` })
  }

  // The card on file, so the Billing tab shows the patient as paying by card
  // and the next match of this customer is immediate. A patient who already
  // has a customer of ours keeps theirs (one per patient).
  await supabase
    .from('patient_stripe_customers')
    .upsert(
      {
        account_id: accountId,
        patient_id: patientId,
        stripe_customer_id: customer.id,
        default_payment_method_id: typeof sub.default_payment_method === 'string' ? sub.default_payment_method : (sub.default_payment_method?.id ?? null),
      },
      { onConflict: 'account_id,patient_id', ignoreDuplicates: true },
    )

  return { outcome: 'linked', scheduleId: inserted.id, patientId, created, by }
}

/** The patients a customer is matched against: everyone not archived. */
export async function matchablePatients(supabase: Supa, accountId: string): Promise<MatchablePatient[]> {
  const out: MatchablePatient[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, first_name, last_name, email, phone_search')
      .eq('account_id', accountId)
      .neq('status', 'archived')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    out.push(...((data ?? []) as MatchablePatient[]))
    if ((data ?? []).length < PAGE) return out
  }
}

/** The patient a Stripe customer is already paired with here, if any. */
export async function patientOfStripeCustomer(supabase: Supa, accountId: string, customerId: string): Promise<string | null> {
  const { data } = await supabase.from('patient_stripe_customers').select('patient_id').eq('account_id', accountId).eq('stripe_customer_id', customerId).limit(2)
  return data?.length === 1 ? data[0]!.patient_id : null
}

async function autoDecision(supabase: Supa, accountId: string, customer: Stripe.Customer): Promise<StripePairDecision> {
  const matchable = stripeCustomerAsMatchable(customer)
  const known = await patientOfStripeCustomer(supabase, accountId, customer.id)
  if (known) return stripeAutoPairDecision({ patientId: null, by: null, ambiguous: false }, matchable, known)
  const patients = await matchablePatients(supabase, accountId)
  return stripeAutoPairDecision(suggestMandatePatient(matchable, patients), matchable, null)
}

/**
 * A new patient from a Stripe customer: their name, email and phone as Stripe
 * has them, at the clinic when there is only one.
 */
async function createPatientFromCustomer(supabase: Supa, accountId: string, customer: Stripe.Customer): Promise<string> {
  const { given_name, family_name } = stripeCustomerAsMatchable(customer)
  const firstName = given_name || customer.email?.split('@')[0] || ''
  if (!firstName) throw createError({ statusCode: 400, statusMessage: 'This Stripe customer has no name or email to create a patient from' })

  const [{ data: clinics }, { data: account }] = await Promise.all([
    supabase.from('clinics').select('id').eq('account_id', accountId).is('archived_at', null).limit(2),
    supabase.from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle(),
  ])
  const id = randomUUID()
  const { error } = await supabase.from('patients').insert({
    id,
    account_id: accountId,
    clinic_id: clinics?.length === 1 ? clinics[0]!.id : null,
    first_name: firstName,
    last_name: family_name,
    email: customer.email?.trim() || null,
  } as never)
  if (error) throw createError({ statusCode: 500, statusMessage: `Could not create the patient: ${error.message}` })

  const contact = customer.phone ? leadPhoneAsContactNumber(customer.phone, account?.default_phone_country ?? 'ES') : null
  if (contact) {
    const { error: numberError } = await supabase
      .from('patient_contact_numbers')
      .insert({ account_id: accountId, patient_id: id, number: contact.number, country_code: contact.countryCode, is_whatsapp: true } as never)
    if (numberError) console.error('[stripe membership sync] could not save the phone of a new patient', numberError.message)
  }
  return id
}

/**
 * The payment already here that is this Stripe charge, marked as such, or
 * null when there is none and the period should be booked as usual.
 *
 * A clinic still importing its ledger from PracticeHub can hold the same
 * charge already, as a 'phpay-' payment: PracticeHub sees the Stripe
 * subscription too. Booking another would count the money twice. So a
 * payment imported from PracticeHub for this patient, of this amount, not by
 * cash, within SAME_CHARGE_WINDOW_DAYS of the charge and not yet any Stripe
 * invoice's, is taken to be it: it gets the Stripe invoice id (and the
 * PaymentIntent, when that one is free), and nothing new is written. The
 * other direction -- PracticeHub arriving after the webhook -- is in
 * utils/practicehubImport/ledger.ts.
 */
export async function claimImportedStripePayment(
  supabase: Supa,
  accountId: string,
  charge: { patientId: string; amountCents: number; paidAt: string; stripeInvoiceId: string; stripePaymentIntentId: string | null },
): Promise<string | null> {
  const at = new Date(charge.paidAt).getTime()
  const window = SAME_CHARGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const { data: candidates } = await supabase
    .from('payments')
    .select('id, patient_id, amount_cents, paid_at')
    .eq('account_id', accountId)
    .eq('patient_id', charge.patientId)
    .eq('amount_cents', charge.amountCents)
    .like('external_reference', 'phpay-%')
    .is('stripe_invoice_id', null)
    .is('stripe_payment_intent_id', null)
    .neq('method', 'cash')
    .gte('paid_at', new Date(at - window).toISOString())
    .lte('paid_at', new Date(at + window).toISOString())
  const hit = closestSameCharge(
    { patientId: charge.patientId, amountCents: charge.amountCents, paidAt: charge.paidAt },
    (candidates ?? []).map((c) => ({ id: c.id, patientId: c.patient_id, amountCents: c.amount_cents, paidAt: c.paid_at })),
  )
  if (!hit) return null

  const { data: claimed, error } = await supabase
    .from('payments')
    .update({ stripe_invoice_id: charge.stripeInvoiceId })
    .eq('id', hit.id)
    .eq('account_id', accountId)
    .is('stripe_invoice_id', null)
    .select('id')
  if (error || !claimed?.length) return null
  if (charge.stripePaymentIntentId) {
    // Best effort: the PaymentIntent is unique across payments, and the
    // invoice id above is what the de-duplication keys on.
    await supabase.from('payments').update({ stripe_payment_intent_id: charge.stripePaymentIntentId }).eq('id', hit.id).eq('account_id', accountId).is('stripe_payment_intent_id', null)
  }
  return hit.id
}
