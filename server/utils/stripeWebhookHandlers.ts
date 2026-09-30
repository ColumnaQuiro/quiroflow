import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import type Stripe from 'stripe'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// The subscription an invoice belongs to, in either shape Stripe sends it.
// Up to 2025-02-24.acacia it is `invoice.subscription`; from 2025-03-31.basil
// on it moved to `invoice.parent.subscription_details.subscription`, and the
// top-level field is gone. Which shape arrives is set by the webhook
// endpoint's API version in the Stripe dashboard, not by the SDK version
// pinned in server/utils/stripe.ts, so both are read. Reading only the old
// one resolved no schedule on a current endpoint and booked nothing at all.
export function stripeInvoiceSubscriptionId(invoice: any): string | null {
  const idOf = (v: unknown) => (typeof v === 'string' ? v : typeof (v as { id?: unknown })?.id === 'string' ? (v as { id: string }).id : null)
  return (
    idOf(invoice?.subscription) ??
    idOf(invoice?.parent?.subscription_details?.subscription) ??
    idOf(invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription) ??
    null
  )
}

// The PaymentIntent that paid an invoice, in either shape: `payment_intent`
// before basil, `payments.data[].payment.payment_intent` after -- and that
// list is only present when Stripe includes it, so null is a normal answer.
export function stripeInvoicePaymentIntentId(invoice: any): string | null {
  const idOf = (v: unknown) => (typeof v === 'string' ? v : typeof (v as { id?: unknown })?.id === 'string' ? (v as { id: string }).id : null)
  const legacy = idOf(invoice?.payment_intent)
  if (legacy) return legacy
  const payments: any[] = invoice?.payments?.data ?? []
  const paid = payments.find((p) => p?.status === 'paid' && p?.payment?.payment_intent) ?? payments.find((p) => p?.payment?.payment_intent)
  return idOf(paid?.payment?.payment_intent)
}

// Shared by both webhook routes: the legacy per-account endpoint
// (webhook/[accountId].post.ts) and the platform-level Connect endpoint
// (webhook.post.ts). Mirrors Stripe's outcome into payment_schedules /
// stripe_payment_events so the app's reports stay in sync -- Stripe does
// the actual charging (Subscription Schedules) on its own.
export async function handleStripeEvent(supabase: SupabaseClient<Database>, accountId: string, stripeEvent: Stripe.Event, origin: string) {
  // No staff session exists on a Stripe webhook call, so this can't go
  // through fire.post.ts (requireTeamMember-gated) like every client
  // trigger -- same direct-call pattern as birthday-cron.post.ts.
  async function fireMembershipPaymentProcessed(membershipId: string) {
    const { data: membership } = await supabase.from('patient_memberships').select('patient_id').eq('id', membershipId).maybeSingle()
    if (!membership) return
    const { data: patient } = await supabase
      .from('patients')
      .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
      .eq('id', membership.patient_id)
      .maybeSingle()
    if (!patient) return

    const { data: rules } = await supabase
      .from('automation_rules')
      .select('id, filters')
      .eq('account_id', accountId)
      .eq('trigger_event', 'membership.payment_processed')
      .eq('enabled', true)
    for (const rule of rules ?? []) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters))) continue
      await dispatchPatientRule(supabase, supabase, accountId, rule.id, patient, origin, undefined, {
        triggerEvent: 'membership.payment_processed',
        patientId: patient.id,
        membershipId,
      })
    }
  }

  async function findSchedule(subscriptionId: string | null) {
    if (!subscriptionId) return null
    const { data } = await supabase
      .from('payment_schedules')
      .select('id, installments_paid, installments_total, package_purchase_id, patient_membership_id, patient_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle()
    return data
  }

  // The invoice is raised 'paid' before its payment exists (the payment names
  // it). If the payment is then refused, what is left is a paid invoice with
  // no money under it -- which reads as settled and is not. Take it back out
  // (its line items cascade) rather than leave that behind.
  async function dropUnpaidCharge(invoiceId: string, error: { message?: string } | null) {
    console.error('[stripe webhook] payment insert failed, removing its invoice', invoiceId, error?.message)
    await supabase.from('invoices').delete().eq('id', invoiceId)
  }

  // Adds one to a schedule's instalment count without losing a concurrent
  // increment: the write only lands if the count is still what was read, and
  // otherwise re-reads and tries again. Two different invoices of the same
  // schedule arriving together used to both write n+1.
  async function countInstallment(scheduleId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: current } = await supabase
        .from('payment_schedules')
        .select('installments_paid, installments_total')
        .eq('id', scheduleId)
        .maybeSingle()
      if (!current) return
      const installmentsPaid = current.installments_paid + 1
      const completed = current.installments_total != null && installmentsPaid >= current.installments_total
      const { data: updated } = await supabase
        .from('payment_schedules')
        .update({ installments_paid: installmentsPaid, status: completed ? 'completed' : 'active' })
        .eq('id', scheduleId)
        .eq('installments_paid', current.installments_paid)
        .select('id')
      if (updated?.length) return
    }
    console.error('[stripe webhook] could not count instalment after retries', scheduleId)
  }

  // A successful membership installment only ever touched
  // stripe_payment_events/payment_schedules -- invisible to balanceCents,
  // the Account Ledger, and the cash-up report. This makes it a normal
  // invoice+payment pair like any other charge, so no new UI is needed.
  async function recordMembershipCharge(patientId: string, membershipId: string, amountCents: number, periodStart: string, paymentIntentId: string | null) {
    const { data: membership } = await supabase.from('patient_memberships').select('membership_name').eq('id', membershipId).maybeSingle()
    const periodLabel = new Date(periodStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: accountId })
    if (!invoiceNumber) return

    const { data: invoice } = await supabase
      .from('invoices')
      .insert({ account_id: accountId, patient_id: patientId, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
      .select('id')
      .single()
    if (!invoice) return

    await supabase.from('invoice_line_items').insert({
      account_id: accountId,
      invoice_id: invoice.id,
      description: `Membership: ${membership?.membership_name ?? 'Membership'} — ${periodLabel}`,
      quantity: 1,
      price_cents: amountCents,
    })
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({ account_id: accountId, patient_id: patientId, invoice_id: invoice.id, amount_cents: amountCents, method: 'card', stripe_payment_intent_id: paymentIntentId, purpose: 'membership' })
      .select('id')
      .single()
    if (paymentError || !payment) {
      await dropUnpaidCharge(invoice.id, paymentError)
      return
    }

    // Money arriving with nobody at a screen still needs its document.
    if (payment) {
      await issueFacturaServer(supabase, {
        accountId,
        patientId,
        paymentId: payment.id,
        amountCents,
        purpose: 'membership',
        serviceName: `${membership?.membership_name ?? 'Membership'} — ${periodLabel}`,
      })
    }
  }

  // Mirrors recordMembershipCharge, plus one extra step: a package
  // installment's invoice+payment pair nets to zero on balanceCents (it's
  // just the sale record), but the money still needs to become spendable
  // credit against the bono's sessions -- same account_credits top-up
  // sellPackage() already does for a manual cash/card payment at sale time.
  async function recordPackageCharge(patientId: string, packagePurchaseId: string, amountCents: number, paymentIntentId: string | null) {
    const { data: purchase } = await supabase.from('package_purchases').select('package_name').eq('id', packagePurchaseId).maybeSingle()

    const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: accountId })
    if (!invoiceNumber) return

    const { data: invoice } = await supabase
      .from('invoices')
      .insert({ account_id: accountId, patient_id: patientId, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
      .select('id')
      .single()
    if (!invoice) return

    await supabase.from('invoice_line_items').insert({
      account_id: accountId,
      invoice_id: invoice.id,
      description: `Package installment: ${purchase?.package_name ?? 'Package'}`,
      quantity: 1,
      price_cents: amountCents,
    })
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({ account_id: accountId, patient_id: patientId, invoice_id: invoice.id, amount_cents: amountCents, method: 'card', stripe_payment_intent_id: paymentIntentId, purpose: 'bono' })
      .select('id')
      .single()
    if (paymentError || !payment) {
      await dropUnpaidCharge(invoice.id, paymentError)
      return
    }

    // An autopay instalment describes the share of the bono it buys, exactly
    // as one taken at the desk does.
    if (payment) {
      const { data: pkg } = await supabase
        .from('package_purchases')
        .select('package_name, price_cents, sessions_total')
        .eq('id', packagePurchaseId)
        .maybeSingle()
      await issueFacturaServer(supabase, {
        accountId,
        patientId,
        paymentId: payment.id,
        amountCents,
        purpose: 'bono',
        bono: pkg
          ? { packageName: pkg.package_name, priceCents: pkg.price_cents, sessionsTotal: pkg.sessions_total }
          : undefined,
        serviceName: purchase?.package_name ?? 'Package',
      })
    }
    await supabase.from('account_credits').insert({
      account_id: accountId,
      patient_id: patientId,
      amount_cents: amountCents,
      reason: `Package installment: ${purchase?.package_name ?? 'Package'}`,
      invoice_id: invoice.id,
    })
  }

  if (stripeEvent.type === 'invoice.paid' || stripeEvent.type === 'invoice.payment_failed') {
    const invoice = stripeEvent.data.object as Stripe.Invoice
    const subscriptionId = stripeInvoiceSubscriptionId(invoice)
    const paymentIntentId = stripeInvoicePaymentIntentId(invoice)
    const schedule = await findSchedule(subscriptionId)
    if (schedule) {
      const status = stripeEvent.type === 'invoice.paid' ? 'paid' : 'failed'

      // Stripe delivers at least once, not exactly once: a timeout, a retry or
      // a "Resend" from the dashboard sends the same invoice.paid again, under
      // a new event id. Each delivery used to raise another paid invoice,
      // payment and factura for the same money and count the instalment
      // again. The Stripe invoice id is what identifies the money, so a paid
      // event already recorded for it means this one has been booked.
      if (status === 'paid') {
        const { data: alreadyBooked } = await supabase
          .from('stripe_payment_events')
          .select('id')
          .eq('stripe_invoice_id', invoice.id)
          .eq('status', 'paid')
          .limit(1)
        if (alreadyBooked?.length) return
      }

      const { error: eventError } = await supabase.from('stripe_payment_events').insert({
        account_id: accountId,
        payment_schedule_id: schedule.id,
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents: invoice.amount_paid || invoice.amount_due,
        status,
        period_start: new Date((invoice.period_start ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10),
      })
      if (status === 'paid' && eventError) {
        // Two deliveries racing: the partial unique index on paid events
        // (20260930142942_stripe_invoice_paid_once) lets exactly one in.
        if (eventError.code === '23505') return
        // Anything else and nothing is booked yet: fail the request so Stripe
        // retries, rather than booking money with no record that it was.
        throw eventError
      }

      if (status === 'paid') {
        await countInstallment(schedule.id)

        if (schedule.patient_membership_id) {
          const periodStart = new Date((invoice.period_start ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
          await recordMembershipCharge(schedule.patient_id, schedule.patient_membership_id, invoice.amount_paid || invoice.amount_due, periodStart, paymentIntentId)
          await fireMembershipPaymentProcessed(schedule.patient_membership_id)
        } else if (schedule.package_purchase_id) {
          await recordPackageCharge(schedule.patient_id, schedule.package_purchase_id, invoice.amount_paid || invoice.amount_due, paymentIntentId)
        }
      } else {
        await supabase.from('payment_schedules').update({ status: 'past_due' }).eq('id', schedule.id)
      }
    }
  }

  // Subscription Schedule create response only sometimes carries the
  // subscription id up front (e.g. when start_date is deferred to skip an
  // already-paid installment); this backfills it once Stripe activates it.
  if (stripeEvent.type === 'subscription_schedule.updated' || stripeEvent.type === 'subscription_schedule.released') {
    const schedule = stripeEvent.data.object as Stripe.SubscriptionSchedule
    const subscriptionId = typeof schedule.subscription === 'string' ? schedule.subscription : null
    if (subscriptionId) {
      await supabase
        .from('payment_schedules')
        .update({ stripe_subscription_id: subscriptionId })
        .eq('stripe_subscription_schedule_id', schedule.id)
        .is('stripe_subscription_id', null)
    }
  }

  if (stripeEvent.type === 'subscription_schedule.canceled') {
    const schedule = stripeEvent.data.object as Stripe.SubscriptionSchedule
    await supabase.from('payment_schedules').update({ status: 'canceled' }).eq('stripe_subscription_schedule_id', schedule.id)
  }

  // Mirrors save-payment-method.post.ts's own update, for a card added via
  // the patient-facing Checkout link (create-card-link.post.ts) instead of
  // our embedded Stripe Elements form -- there's no browser-side call to
  // save-payment-method in that flow since the patient completes it on
  // Stripe's own hosted page, so this webhook is the only place it's ever
  // recorded as the patient's default card.
  if (stripeEvent.type === 'setup_intent.succeeded') {
    const setupIntent = stripeEvent.data.object as Stripe.SetupIntent
    const customerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id
    const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id
    if (customerId && paymentMethodId) {
      await supabase.from('patient_stripe_customers').update({ default_payment_method_id: paymentMethodId }).eq('stripe_customer_id', customerId)
    }
  }

  // Online booking deposit/full-payment (create-payment-intent.post.ts sets
  // metadata.invoice_id on creation). This is the source of truth for
  // reconciliation -- the booking itself already exists regardless of
  // payment outcome, so a delayed or missed webhook only leaves the invoice
  // temporarily unpaid, never an orphaned charge or a lost appointment.
  if (stripeEvent.type === 'payment_intent.succeeded') {
    const intent = stripeEvent.data.object as Stripe.PaymentIntent
    const invoiceId = intent.metadata?.invoice_id
    if (invoiceId) {
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('id')
        .eq('stripe_payment_intent_id', intent.id)
        .maybeSingle()
      if (!existingPayment) {
        // Read the invoice BEFORE inserting: a payment names its own patient
        // since 0170, and this branch starts from nothing but an invoice id.
        const { data: invoice } = await supabase.from('invoices').select('total_cents, patient_id').eq('id', invoiceId).maybeSingle()
        if (!invoice) return

        const { data: payment } = await supabase
          .from('payments')
          .insert({
            account_id: accountId,
            patient_id: invoice.patient_id,
            invoice_id: invoiceId,
            amount_cents: intent.amount_received,
            method: 'card',
            stripe_payment_intent_id: intent.id,
            purpose: 'visit',
          })
          .select('id')
          .single()
        if (payment) {
          await issueFacturaServer(supabase, {
            accountId,
            patientId: invoice.patient_id,
            paymentId: payment.id,
            amountCents: intent.amount_received,
            purpose: 'visit',
          })
        }
        const { data: payments } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
        const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
        if (paidCents >= invoice.total_cents) {
          await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
        }
      }
    }
  }
}
