import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { closestSameCharge, SAME_CHARGE_WINDOW_DAYS } from '~/utils/stripeMembershipSync'
import { goCardlessSubscriptionMembershipStatus, membershipIntervalOfGoCardless } from '~/utils/gocardlessSubscriptionImport'

// GoCardless subscriptions another app created, booked here as patient
// memberships while they keep collecting where they are. The decisions are
// in utils/gocardlessSubscriptionImport.ts.
//
// Layered on payment_schedules exactly as an imported Stripe subscription is
// (20261123182818_stripe_membership_sync.sql): a schedule with origin
// 'imported' and the other app's subscription id. The webhook books a
// payment for any subscription a schedule names, so from the moment one
// exists its collections arrive as paid periods, with their invoice and
// factura, like a subscription of ours. Nothing earlier is booked: those
// events were already handled with no schedule to book them on, which is
// what makes the sync the cutover.
//
// Nothing here writes to GoCardless: the subscription is read, never changed.

type Supa = SupabaseClient<Database>

/**
 * Books one GoCardless subscription another app created as `planId`'s
 * membership of the patient its mandate is paired with. Returns the schedule.
 *
 * The patient's own membership of that plan is taken over when the desk
 * already recorded one with nothing collecting it (the usual case on a
 * clinic moving across), so it is not doubled; otherwise a new one is
 * created at the subscription's own amount and cadence.
 */
export async function importGoCardlessSubscription(
  supabase: Supa,
  request: GoCardlessRequest,
  accountId: string,
  input: { subscriptionId: string; planId: string; memberId: string | null },
): Promise<{ scheduleId: string; patientMembershipId: string; adopted: boolean }> {
  const { data: already } = await supabase
    .from('payment_schedules')
    .select('id, origin')
    .eq('account_id', accountId)
    .eq('gocardless_subscription_id', input.subscriptionId)
    .maybeSingle()
  if (already) throw createError({ statusCode: 409, statusMessage: already.origin === 'imported' ? 'This subscription is already synced' : 'This subscription was created by QuiroFlow' })

  let subscription: GcSubscription
  try {
    ;({ subscriptions: subscription } = await request<{ subscriptions: GcSubscription }>('GET', `/subscriptions/${encodeURIComponent(input.subscriptionId)}`))
  } catch (err) {
    if (err instanceof GoCardlessError && err.status === 404) throw createError({ statusCode: 404, statusMessage: 'GoCardless does not know this subscription' })
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
  const status = goCardlessSubscriptionMembershipStatus(subscription.status)
  if (!status) throw createError({ statusCode: 409, statusMessage: `This subscription is not collecting (${subscription.status})` })

  const { data: mandate } = await supabase
    .from('patient_gocardless_mandates')
    .select('patient_id')
    .eq('account_id', accountId)
    .eq('gocardless_mandate_id', subscription.links.mandate)
    .maybeSingle()
  if (!mandate) throw createError({ statusCode: 409, statusMessage: 'Pair this mandate with its patient first' })

  const { data: plan } = await supabase.from('memberships').select('id, name').eq('id', input.planId).eq('account_id', accountId).maybeSingle()
  if (!plan) throw createError({ statusCode: 404, statusMessage: 'Membership plan not found' })

  const cadence = membershipIntervalOfGoCardless(subscription.interval_unit, subscription.interval)
  const { data: existing } = await supabase
    .from('patient_memberships')
    .select('id, payment_schedules(id, status)')
    .eq('account_id', accountId)
    .eq('patient_id', mandate.patient_id)
    .eq('membership_id', plan.id)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false })
  const free = (existing ?? []).find((m) => !((m.payment_schedules as { status: string }[] | null) ?? []).some((s) => s.status === 'active' || s.status === 'past_due'))

  let membershipId: string
  if (free) {
    membershipId = free.id
    await supabase.from('patient_memberships').update({ status }).eq('id', free.id).eq('account_id', accountId)
  } else {
    const { data: inserted, error } = await supabase
      .from('patient_memberships')
      .insert({
        account_id: accountId,
        patient_id: mandate.patient_id,
        membership_id: plan.id,
        membership_name: plan.name,
        price_cents: subscription.amount,
        status,
        started_at: subscription.start_date ? new Date(`${subscription.start_date}T00:00:00Z`).toISOString() : new Date().toISOString(),
        billing_interval: cadence.interval,
        billing_interval_count: cadence.count,
        created_by: input.memberId,
      })
      .select('id')
      .single()
    if (error || !inserted) throw createError({ statusCode: 500, statusMessage: `Could not record the membership: ${error?.message}` })
    membershipId = inserted.id
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('payment_schedules')
    .insert({
      account_id: accountId,
      patient_id: mandate.patient_id,
      patient_membership_id: membershipId,
      provider: 'gocardless',
      origin: 'imported',
      adopted_membership: Boolean(free),
      gocardless_subscription_id: subscription.id,
      gocardless_mandate_id: subscription.links.mandate,
      interval: cadence.interval,
      interval_count: cadence.count,
      installments_total: null,
      installments_paid: 0,
      status: 'active',
    })
    .select('id')
    .single()
  if (scheduleError || !schedule) {
    // Synced twice at once: the first one stands, and a membership this call
    // created for it goes back out so the patient is not shown two.
    if (!free) await supabase.from('patient_memberships').delete().eq('id', membershipId).eq('account_id', accountId)
    if (scheduleError?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'This subscription is already synced' })
    throw createError({ statusCode: 500, statusMessage: `Could not sync the subscription: ${scheduleError?.message}` })
  }
  return { scheduleId: schedule.id, patientMembershipId: membershipId, adopted: Boolean(free) }
}

/**
 * The payment already here that is this GoCardless collection, marked as
 * such, or null when there is none and the period should be booked as usual.
 *
 * While a clinic still syncs its ledger from PracticeHub, PracticeHub records
 * the collections of its own subscription too, and they arrive as 'phpay-'
 * payments. So a PracticeHub payment for this patient, of this amount, not by
 * cash, within SAME_CHARGE_WINDOW_DAYS of the charge date and not yet any
 * GoCardless payment's, is taken to be it: it gets the GoCardless payment id,
 * and nothing new is written. The other direction -- PracticeHub arriving
 * after the webhook -- is in utils/practicehubImport/ledger.ts. The Stripe
 * twin is claimImportedStripePayment.
 */
export async function claimImportedGoCardlessPayment(
  supabase: Supa,
  accountId: string,
  charge: { patientId: string; amountCents: number; chargeDate: string; gocardlessPaymentId: string },
): Promise<string | null> {
  const at = new Date(`${charge.chargeDate.slice(0, 10)}T12:00:00Z`).getTime()
  const window = SAME_CHARGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const { data: candidates } = await supabase
    .from('payments')
    .select('id, patient_id, amount_cents, paid_at')
    .eq('account_id', accountId)
    .eq('patient_id', charge.patientId)
    .eq('amount_cents', charge.amountCents)
    .like('external_reference', 'phpay-%')
    .is('gocardless_payment_id', null)
    .is('stripe_invoice_id', null)
    .neq('method', 'cash')
    .gte('paid_at', new Date(at - window).toISOString())
    .lte('paid_at', new Date(at + window).toISOString())
  const hit = closestSameCharge(
    { patientId: charge.patientId, amountCents: charge.amountCents, paidAt: new Date(at).toISOString() },
    (candidates ?? []).map((c) => ({ id: c.id, patientId: c.patient_id, amountCents: c.amount_cents, paidAt: c.paid_at })),
  )
  if (!hit) return null

  const { data: claimed, error } = await supabase
    .from('payments')
    .update({ gocardless_payment_id: charge.gocardlessPaymentId })
    .eq('id', hit.id)
    .eq('account_id', accountId)
    .is('gocardless_payment_id', null)
    .select('id')
  if (error || !claimed?.length) return null
  return hit.id
}
