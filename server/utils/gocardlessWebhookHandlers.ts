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
    // The clinic removed QuiroFlow from its own GoCardless dashboard. This
    // event carries no id, so it is never deduplicated; forgetting twice is
    // harmless.
    await forgetGoCardlessConnection(supabase, accountId)
    return
  }

  // Every other event is handled once (gocardless_processed_events): a
  // retried batch or the reconcile cron's nightly replay skips what was
  // already done, without asking GoCardless again. Recorded only after the
  // handler finished without throwing, so a failure is tried again.
  if (event.id) {
    const { data: done } = await supabase
      .from('gocardless_processed_events')
      .select('gocardless_event_id')
      .eq('account_id', accountId)
      .eq('gocardless_event_id', event.id)
      .maybeSingle()
    if (done) return
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
    } else if (event.resource_type === 'billing_requests' && event.links.billing_request) {
      await syncGoCardlessBillingRequest(supabase, request, accountId, event.links.billing_request)
    } else if (event.resource_type === 'refunds' && event.links.refund) {
      await handleRefundEvent(supabase, request, accountId, event)
    }
  } catch (err) {
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(supabase, accountId)
      return
    }
    throw err
  }

  if (event.id) {
    // ignoreDuplicates: two deliveries of the same event racing each other
    // both get here, and the second has nothing to add.
    const { error } = await supabase
      .from('gocardless_processed_events')
      .upsert({ account_id: accountId, gocardless_event_id: event.id, resource_type: event.resource_type, action: event.action }, { onConflict: 'account_id,gocardless_event_id', ignoreDuplicates: true })
    // The event was handled; failing to note it only means a replay does it
    // again, which every handler survives.
    if (error) console.error('[gocardless] event not recorded as processed', accountId, event.id, error.message)
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
  // Not the title, which names the patient: the patient id is enough to find it.
  if (error) console.error('[gocardless webhook] could not write the task', accountId, patientId, error.message)
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
    await countScheduleInstallment(supabase, accountId, schedule.id)
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

  // Success+ (or someone in GoCardless) is collecting a failed payment again.
  // The failure booked above stops being the last word: the period is not
  // "failed" while its money is on its way, and the schedule is collecting,
  // not past due. If the retry fails too, its own failed event books that.
  if (event.action === 'resubmission_requested') {
    const { error } = await record(event.action)
    if (error?.code === '23505') return
    if (error) throw error

    if (schedule.patient_membership_id) {
      const { data: failures } = await supabase
        .from('gocardless_payment_events')
        .select('charge_date')
        .eq('account_id', accountId)
        .eq('gocardless_payment_id', payment.id)
        .eq('action', 'failed')
      const periods = [...new Set((failures ?? []).map((f) => f.charge_date).filter(Boolean))] as string[]
      if (periods.length) {
        await supabase
          .from('membership_payments')
          .delete()
          .eq('account_id', accountId)
          .eq('patient_membership_id', schedule.patient_membership_id)
          .eq('status', 'failed')
          .in('period_start', periods)
      }
    }
    if (schedule.status === 'past_due') await supabase.from('payment_schedules').update({ status: 'active' }).eq('id', schedule.id)
    return
  }

  if (event.action === 'chargeback_cancelled') {
    await record(event.action)
  }
}

// ---------------------------------------------------------------------
// New mandates: the sign-up link sent from a patient's Money tab
// ---------------------------------------------------------------------

/**
 * Reads a Billing Request QuiroFlow created and brings its row up to date.
 * Fulfilled, the mandate it produced is paired with the patient the link was
 * sent to -- by the row, never by email -- so it shows on their Money tab as
 * their direct debit with nobody pairing anything.
 *
 * Shared by the webhook (billing_requests events), the reconcile cron, and
 * the Money tab, which asks when it opens on a patient with a link out: the
 * patient is often back on the clinic's screen before the webhook arrives.
 * Idempotent: a fulfilled row is left alone.
 */
export async function syncGoCardlessBillingRequest(supabase: Admin, request: GoCardlessRequest, accountId: string, billingRequestId: string): Promise<{ status: string; mandateId: string | null } | null> {
  const { data: row } = await supabase
    .from('gocardless_billing_requests')
    .select('id, patient_id, status, expires_at, created_by_member, gocardless_mandate_id')
    .eq('account_id', accountId)
    .eq('gocardless_billing_request_id', billingRequestId)
    .maybeSingle()
  // Not one of ours: a billing request the clinic made in GoCardless itself,
  // or another app's. The Import page lists its mandate like any other.
  if (!row) return null
  if (row.status === 'fulfilled') return { status: row.status, mandateId: row.gocardless_mandate_id }

  const { billing_requests: br } = await request<{ billing_requests: GcBillingRequest }>('GET', `/billing_requests/${encodeURIComponent(billingRequestId)}`)
  const now = new Date().toISOString()

  if (br.status === 'fulfilled' && br.links.mandate_request_mandate) {
    const { mandates: mandate } = await request<{ mandates: GcMandate }>('GET', `/mandates/${br.links.mandate_request_mandate}`)
    let bank: GcCustomerBankAccount | null = null
    try {
      bank = (await request<{ customer_bank_accounts: GcCustomerBankAccount }>('GET', `/customer_bank_accounts/${mandate.links.customer_bank_account}`)).customer_bank_accounts
    } catch (err) {
      // The last digits are what the Money tab shows; the mandate collects
      // without them. Not worth refusing the match over.
      console.error('[gocardless] bank account not readable', mandate.id, (err as Error).message)
    }
    const { error } = await supabase.from('patient_gocardless_mandates').upsert(
      {
        account_id: accountId,
        patient_id: row.patient_id,
        gocardless_mandate_id: mandate.id,
        gocardless_customer_id: mandate.links.customer,
        status: mandate.status,
        scheme: mandate.scheme,
        reference: mandate.reference,
        bank_name: bank?.bank_name ?? null,
        account_number_ending: bank?.account_number_ending ?? null,
        origin: 'created_here',
        matched_by: 'link',
        matched_at: now,
        matched_by_member: row.created_by_member,
        updated_at: now,
      },
      { onConflict: 'account_id,gocardless_mandate_id' },
    )
    if (error) throw error
    // Our patient id onto the customer the patient just created, as a pair
    // made on the Import page is (best effort; never fails the sync).
    await tagGoCardlessCustomer(request, mandate.links.customer, row.patient_id)
    await supabase.from('gocardless_billing_requests').update({ status: 'fulfilled', gocardless_mandate_id: mandate.id, updated_at: now }).eq('id', row.id)
    return { status: 'fulfilled', mandateId: mandate.id }
  }

  const closed = br.status === 'cancelled' || br.status === 'failed' ? br.status : row.expires_at && row.expires_at < now ? 'expired' : null
  if (closed && closed !== row.status) {
    await supabase.from('gocardless_billing_requests').update({ status: closed, updated_at: now }).eq('id', row.id)
  }
  return { status: closed ?? row.status, mandateId: null }
}

// ---------------------------------------------------------------------
// Refunds sent back through GoCardless (/api/gocardless/refunds/create)
// ---------------------------------------------------------------------

async function handleRefundEvent(supabase: Admin, request: GoCardlessRequest, accountId: string, event: GcEvent) {
  // Only the outcomes that need someone. "paid" is the ordinary end and the
  // books already say the money went back.
  if (event.action !== 'failed' && event.action !== 'funds_returned' && event.action !== 'bounced') return
  const { refunds: refund } = await request<{ refunds: GcRefund }>('GET', `/refunds/${event.links.refund}`)
  const { data: booked } = await supabase.from('payments').select('id, patient_id').eq('account_id', accountId).eq('gocardless_refund_id', refund.id).maybeSingle()
  if (!booked?.patient_id) return
  const amount = (refund.amount / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
  // A task per delivery would repeat itself on every retry of the same
  // event, so record it once against the event id first.
  const { error } = await supabase.from('gocardless_payment_events').insert({
    account_id: accountId,
    gocardless_event_id: event.id,
    gocardless_payment_id: refund.links.payment,
    action: `refund_${event.action}`,
    amount_cents: -refund.amount,
  })
  if (error?.code === '23505') return
  if (error) throw error
  await tellTheDesk(supabase, accountId, booked.patient_id, `El reembolso por domiciliación (${amount}) no ha llegado al paciente: devuélveselo por otro medio`)
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
      .update({ gocardless_mandate_id: replacement.id, status: replacement.status, scheme: replacement.scheme, reference: replacement.reference, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    await supabase.from('payment_schedules').update({ gocardless_mandate_id: replacement.id }).eq('account_id', accountId).eq('gocardless_mandate_id', mandate.id)
    return
  }

  await supabase.from('patient_gocardless_mandates').update({ status: mandate.status, reference: mandate.reference, updated_at: new Date().toISOString() }).eq('id', row.id)

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
