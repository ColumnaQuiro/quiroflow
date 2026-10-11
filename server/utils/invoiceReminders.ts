import type { AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { ruleFiltersMatch } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { formatEur } from '~/utils/billing'
import { overdueWindow } from '~/utils/invoiceReminders'

const SEND_CONCURRENCY = 5

// The invoice.overdue automation trigger: an invoice raised N days ago
// (filters.days_overdue) and still owed. Run once a day from the daily
// automations cron (birthday-cron.post.ts) -- a day is the right grain, and
// it spares a new cron job, which would have to be scheduled by hand against
// production before anything called it.
//
// Only invoices that crossed N days in the last few days, never every old
// debt at once: switching a reminder on must not message every patient who
// has owed something since the PracticeHub import. A day the cron missed is
// caught by the window's slack; automation_invoice_sends keeps each
// (automation, invoice) to one message whatever the cron does.
//
// Skipped: paid or void invoices, refunds, nothing left to pay (under 50
// cents, Stripe's minimum), and patients whose reminders are paused
// (patients.invoice_reminders_paused). A minor or a do-not-contact patient is
// skipped by the sending itself, as for every automation.
export async function runInvoiceReminders(service: any, origin: string, now = new Date()): Promise<number> {
  const { data: rules } = await service
    .from('automation_rules')
    .select('id, account_id, filters')
    .eq('trigger_event', 'invoice.overdue')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return 0

  const due: { rule: { id: string; account_id: string; filters: AutomationFilters }; invoice: { id: string; patient_id: string; invoice_number: string; total_cents: number; pay_token: string | null } }[] = []
  for (const rule of rules) {
    const { from, to } = overdueWindow(Number((rule.filters as AutomationFilters)?.days_overdue) || 7, now)
    const { data: invoices } = await service
      .from('invoices')
      .select('id, patient_id, invoice_number, total_cents, pay_token')
      .eq('account_id', rule.account_id)
      .eq('status', 'unpaid')
      .eq('is_refund', false)
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())
    if (!invoices?.length) continue
    const { data: sent } = await service.from('automation_invoice_sends').select('invoice_id').eq('rule_id', rule.id).in('invoice_id', invoices.map((i: { id: string }) => i.id))
    const already = new Set((sent ?? []).map((s: { invoice_id: string }) => s.invoice_id))
    for (const invoice of invoices) if (!already.has(invoice.id) && invoice.patient_id) due.push({ rule, invoice })
  }
  if (due.length === 0) return 0

  const patientIds = [...new Set(due.map((d) => d.invoice.patient_id))]
  const { data: patients } = await service
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, invoice_reminders_paused, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact, preferred_language')
    .in('id', patientIds)
  const patientsById = new Map((patients ?? []).map((p: { id: string }) => [p.id, p]))

  const flags = await mapWithConcurrency(due, SEND_CONCURRENCY, async ({ rule, invoice }) => {
    const patient = patientsById.get(invoice.patient_id) as ({ id: string; invoice_reminders_paused: boolean } & Record<string, any>) | undefined
    if (!patient || patient.invoice_reminders_paused) return false

    // What is still owed now: the invoice less what has been paid on it.
    const { data: payments } = await service.from('payments').select('amount_cents').eq('invoice_id', invoice.id)
    const owed = invoice.total_cents - (payments ?? []).reduce((s: number, p: { amount_cents: number }) => s + p.amount_cents, 0)
    if (owed < 50) return false
    if (!(await ruleFiltersMatch(service, patient.id, rule.filters))) return false

    // Claimed before sending, so two overlapping runs cannot both send.
    const { data: claimed } = await service
      .from('automation_invoice_sends')
      .upsert({ rule_id: rule.id, invoice_id: invoice.id, account_id: rule.account_id }, { onConflict: 'rule_id,invoice_id', ignoreDuplicates: true })
      .select('rule_id')
    if (!claimed || claimed.length === 0) return false

    let token = invoice.pay_token
    if (!token) {
      token = crypto.randomUUID()
      const { error } = await service.from('invoices').update({ pay_token: token }).eq('id', invoice.id).is('pay_token', null)
      if (error) token = null
      else {
        // Another run may have set one first; read back whichever won.
        const { data: fresh } = await service.from('invoices').select('pay_token').eq('id', invoice.id).maybeSingle()
        token = fresh?.pay_token ?? token
      }
    }

    await dispatchPatientRule(service, service, rule.account_id, rule.id, patient as any, origin, undefined, undefined, {
      invoiceNumber: invoice.invoice_number,
      invoiceAmountOwed: formatEur(owed),
      invoicePayLink: token ? `${origin}/api/pay/${token}` : '',
    })
    return true
  })
  return flags.filter(Boolean).length
}
