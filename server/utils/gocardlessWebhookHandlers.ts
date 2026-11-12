import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { bookMembershipPeriod, countScheduleInstallment, fireMembershipPaymentProcessed } from '~/server/utils/membershipCharges'

// What a GoCardless event means here. Shared by the webhook (one endpoint
// for every connected clinic) and the reconcile cron, which replays the
// events a webhook may have missed through exactly the same code.
//
// GoCardless delivers at least once and NOT in order, so nothing below trusts
// the event's own story about a resource: the payment or mandate is fetched
// again and its current state is what gets acted on. What is booked is
// guarded by gocardless_payment_events' unique index on a payment's
// confirmation, so a repeat is harmless.

type Admin = SupabaseClient<Database>

export async function handleGoCardlessEvent(supabase: Admin, accountId: string, event: GcEvent, origin: string): Promise<void> {
  if (event.resource_type === 'organisations' && event.action === 'disconnected') {
    // The clinic removed QuiroFlow from its own GoCardless dashboard.
    await forgetGoCardlessConnection(supabase, accountId)
    return
  }

  const request = await gocardlessForAccount(supabase, accountId)
  if (!request) return

  try {
    if (event.resource_type === 'payments' && event.links.payment) {
      await handlePaymentEvent(supabase, request, accountId, event, origin)
    } else if (event.resource_type === 'mandates' && event.links.mandate) {
      await handleMandateEvent(supabase, request, accountId, event)
    } else if (event.resource_type === 'subscriptions' && event.links.subscription) {
      await handleSubscriptionEvent(supabase, request, accountId, event)
    }
  } catch (err) {
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(supabase, accountId)
      return
    }
    throw err
  }
}

// A task on Mi día for each owner. A staff task has to name someone or a
// role (staff_tasks_assigned), and money going back to a patient is an
// owner's matter, as satisfactionSurvey.ts's low-score alert is. A task that
// cannot be written is logged, never swallowed: it is the only signal.
async function tellTheDesk(supabase: Admin, accountId: string, patientId: string, title: string) {
  const { data: owners } = await supabase.from('team_members').select('id').eq('account_id', accountId).eq('is_owner', true).is('deleted_at', null)
  if (!owners?.length) return
  const { error } = await supabase.from('staff_tasks').insert(owners.map((o) => ({ account_id: accountId, team_member_id: o.id, patient_id: patientId, title })))
  if (error) console.error('[gocardless webhook] could not write the task', accountId, title, error.message)
}

async function scheduleForSubscription(supabase: Admin, accountId: string, subscriptionId: string | undefined) {
  if (!subscriptionId) return null
  const { data } = await supabase
    .from('payment_schedules')
    .select('id, patient_id, patient_membership_id, package_purchase_id, status')
    .eq('account_id', accountId)
    .eq('gocardless_subscription_id', subscriptionId)
    .maybeSingle()
  return data
}

async function handlePaymentEvent(supabase: Admin, request: GoCardlessRequest, accountId: string, event: GcEvent, origin: string) {
  const { payments: payment } = await request<{ payments: GcPayment }>('GET', `/payments/${event.links.payment}`)
  // Only payments of subscriptions QuiroFlow created are ours to book. A
  // payment of PracticeHub's subscription on the same mandate, or one the
  // clinic raised by hand in GoCardless, belongs to whoever raised it.
  const schedule = await scheduleForSubscription(supabase, accountId, payment.links.subscription)
  if (!schedule) return

  const record = (action: string) =>
    supabase.from('gocardless_payment_events').insert({
      account_id: accountId,
      payment_schedule_id: schedule.id,
      gocardless_event_id: event.id,
      gocardless_payment_id: payment.id,
      action,
      amount_cents: payment.amount,
      charge_date: payment.charge_date,
    })

  if (event.action === 'confirmed') {
    // Confirmed is "collected": the money is GoCardless's to pay out. A
    // payment that has since failed late or been charged back is still
    // booked here first, and its own event takes it back out of the books.
    const { error } = await record('confirmed')
    if (error) {
      // 23505 on the confirmed-once index: already booked by an earlier
      // delivery (or by the event-id uniqueness: the very same delivery).
      if (error.code === '23505') return
      throw error
    }
    if (schedule.patient_membership_id) {
      const paymentId = await bookMembershipPeriod(supabase, accountId, {
        patientId: schedule.patient_id,
        membershipId: schedule.patient_membership_id,
        amountCents: payment.amount,
        periodStart: payment.charge_date,
        method: 'direct_debit',
        gocardlessPaymentId: payment.id,
      })
      if (!paymentId) {
        // Nothing booked (no invoice number, or the payment row refused).
        // Take the confirmation back out and fail, so GoCardless delivers it
        // again rather than leaving collected money that no report shows.
        await supabase.from('gocardless_payment_events').delete().eq('account_id', accountId).eq('gocardless_event_id', event.id)
        throw new Error(`could not book GoCardless payment ${payment.id}`)
      }
      await fireMembershipPaymentProcessed(supabase, accountId, schedule.patient_membership_id, origin)
    }
    await countScheduleInstallment(supabase, schedule.id)
    if (schedule.status === 'past_due') await supabase.from('payment_schedules').update({ status: 'active' }).eq('id', schedule.id)
    return
  }

  if (event.action === 'failed' || event.action === 'charged_back' || event.action === 'late_failure_settled') {
    const { error } = await record(event.action)
    if (error?.code === '23505') return // this delivery was handled already
    if (error) throw error

    // A failure GoCardless is going to retry by itself is not news yet.
    if (event.action === 'failed' && event.details?.will_attempt_retry) return

    await supabase.from('payment_schedules').update({ status: 'past_due' }).eq('id', schedule.id)
    if (schedule.patient_membership_id) {
      await supabase.from('membership_payments').insert({
        account_id: accountId,
        patient_membership_id: schedule.patient_membership_id,
        period_start: payment.charge_date,
        amount_cents: payment.amount,
        status: 'failed',
      })
    }

    // Money that was booked and then went back to the patient. Its refund is
    // NOT written here: a refund raises a factura rectificativa, and that is
    // done from the patient's ledger by someone who can see the whole
    // account, as every other refund is. This puts it in front of them.
    const { data: booked } = await supabase.from('payments').select('id').eq('account_id', accountId).eq('gocardless_payment_id', payment.id).maybeSingle()
    const amount = (payment.amount / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
    const title = booked
      ? `Domiciliación devuelta (${amount}): registra el reembolso en la ficha y revisa la membresía`
      : `Domiciliación no cobrada (${amount}): habla con el paciente`
    await tellTheDesk(supabase, accountId, schedule.patient_id, title)
    return
  }

  if (event.action === 'chargeback_cancelled') {
    await record(event.action)
  }
}

async function handleMandateEvent(supabase: Admin, request: GoCardlessRequest, accountId: string, event: GcEvent) {
  const { mandates: mandate } = await request<{ mandates: GcMandate }>('GET', `/mandates/${event.links.mandate}`)
  const { data: row } = await supabase
    .from('patient_gocardless_mandates')
    .select('id, patient_id')
    .eq('account_id', accountId)
    .eq('gocardless_mandate_id', mandate.id)
    .maybeSingle()
  if (!row) return

  // A bank switch or a scheme change hands the patient a new mandate, and
  // GoCardless moves the subscriptions onto it. Follow it, so the schedules
  // and the billing tab keep naming the mandate that is actually collecting.
  if (event.action === 'replaced' && mandate.links.new_mandate) {
    const { mandates: replacement } = await request<{ mandates: GcMandate }>('GET', `/mandates/${mandate.links.new_mandate}`)
    await supabase
      .from('patient_gocardless_mandates')
      .update({ gocardless_mandate_id: replacement.id, status: replacement.status, scheme: replacement.scheme, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    await supabase.from('payment_schedules').update({ gocardless_mandate_id: replacement.id }).eq('account_id', accountId).eq('gocardless_mandate_id', mandate.id)
    return
  }

  await supabase.from('patient_gocardless_mandates').update({ status: mandate.status, updated_at: new Date().toISOString() }).eq('id', row.id)

  // A mandate that can no longer be collected on takes its subscriptions with
  // it (GoCardless cancels them). The patient has to sign again -- the one
  // case where they really do -- so reception hears about it.
  if (['cancelled', 'failed', 'expired', 'blocked', 'suspended_by_payer'].includes(mandate.status)) {
    const { data: schedules } = await supabase
      .from('payment_schedules')
      .update({ status: mandate.status === 'suspended_by_payer' ? 'past_due' : 'canceled' })
      .eq('account_id', accountId)
      .eq('gocardless_mandate_id', mandate.id)
      .in('status', ['active', 'past_due'])
      .select('id')
    if (schedules?.length) {
      await tellTheDesk(supabase, accountId, row.patient_id, 'La domiciliación del paciente ya no está activa: su membresía ha dejado de cobrarse')
    }
  }
}

async function handleSubscriptionEvent(supabase: Admin, request: GoCardlessRequest, accountId: string, event: GcEvent) {
  const { subscriptions: subscription } = await request<{ subscriptions: GcSubscription }>('GET', `/subscriptions/${event.links.subscription}`)
  const schedule = await scheduleForSubscription(supabase, accountId, subscription.id)
  if (!schedule) return
  const status = subscription.status === 'cancelled' ? 'canceled' : subscription.status === 'finished' ? 'completed' : null
  if (status) await supabase.from('payment_schedules').update({ status }).eq('id', schedule.id)
}
