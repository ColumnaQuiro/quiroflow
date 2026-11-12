import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'

// What one collected membership period becomes, whichever provider collected
// it. Lifted out of stripeWebhookHandlers.ts when GoCardless arrived, so a
// period paid by direct debit is booked exactly like one paid by card: a paid
// invoice with its line, the payment under it, the factura, the instalment
// counted and the membership.payment_processed automations fired. Two copies
// of this would drift, and the first difference would be a report that
// counts one provider's money and not the other's.

export interface MembershipPeriodCharge {
  patientId: string
  membershipId: string
  amountCents: number
  /** ISO date or timestamp of the period this pays for. */
  periodStart: string
  method: 'card' | 'direct_debit'
  stripePaymentIntentId?: string | null
  gocardlessPaymentId?: string | null
}

/**
 * Books one paid membership period. Returns the payment id, or null when
 * nothing was booked (no invoice number, or the payment was refused -- in
 * which case the invoice raised for it is taken back out).
 */
export async function bookMembershipPeriod(supabase: SupabaseClient<Database>, accountId: string, charge: MembershipPeriodCharge): Promise<string | null> {
  const { data: membership } = await supabase.from('patient_memberships').select('membership_name').eq('id', charge.membershipId).maybeSingle()
  const periodLabel = new Date(charge.periodStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: accountId })
  if (!invoiceNumber) return null

  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: accountId, patient_id: charge.patientId, invoice_number: invoiceNumber, status: 'paid', total_cents: charge.amountCents })
    .select('id')
    .single()
  if (!invoice) return null

  await supabase.from('invoice_line_items').insert({
    account_id: accountId,
    invoice_id: invoice.id,
    description: `Membership: ${membership?.membership_name ?? 'Membership'} — ${periodLabel}`,
    quantity: 1,
    price_cents: charge.amountCents,
  })
  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      account_id: accountId,
      patient_id: charge.patientId,
      invoice_id: invoice.id,
      amount_cents: charge.amountCents,
      method: charge.method,
      stripe_payment_intent_id: charge.stripePaymentIntentId ?? null,
      gocardless_payment_id: charge.gocardlessPaymentId ?? null,
      purpose: 'membership',
    })
    .select('id')
    .single()
  if (paymentError || !payment) {
    // The invoice is raised 'paid' before its payment exists (the payment
    // names it). If the payment is then refused, what is left is a paid
    // invoice with no money under it -- which reads as settled and is not.
    // Take it back out (its line items cascade) rather than leave that behind.
    console.error('[membership charge] payment insert failed, removing its invoice', invoice.id, paymentError?.message)
    await supabase.from('invoices').delete().eq('id', invoice.id)
    return null
  }

  // Money arriving with nobody at a screen still needs its document.
  await issueFacturaServer(supabase, {
    accountId,
    patientId: charge.patientId,
    paymentId: payment.id,
    amountCents: charge.amountCents,
    purpose: 'membership',
    serviceName: `${membership?.membership_name ?? 'Membership'} — ${periodLabel}`,
  })
  return payment.id
}

/**
 * Adds one to a schedule's instalment count without losing a concurrent
 * increment: the write only lands if the count is still what was read, and
 * otherwise re-reads and tries again. Two different collections of the same
 * schedule arriving together used to both write n+1.
 */
export async function countScheduleInstallment(supabase: SupabaseClient<Database>, scheduleId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: current } = await supabase.from('payment_schedules').select('installments_paid, installments_total').eq('id', scheduleId).maybeSingle()
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
  console.error('[membership charge] could not count instalment after retries', scheduleId)
}

/**
 * Runs the clinic's membership.payment_processed automations for a period
 * that was just collected. No staff session exists on a provider's webhook,
 * so this cannot go through fire.post.ts (requireTeamMember-gated) like every
 * client trigger -- same direct-call pattern as birthday-cron.post.ts.
 */
export async function fireMembershipPaymentProcessed(supabase: SupabaseClient<Database>, accountId: string, membershipId: string, origin: string) {
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
