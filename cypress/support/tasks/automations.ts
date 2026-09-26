import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Tasks for the automation specs: seeding a patient exactly as a rule needs
// to see them (tags, consent, contact flags), and reading back every row an
// automation can write, so a spec can say what was sent, to whom, and what
// was left behind -- whatsapp_messages, email_messages, contact_log,
// automation_rule_sends, same_day_info_sent_at, runs and their history.
//
// Kept apart from db.ts, which is already over three thousand lines, and
// registered alongside it in cypress.config.ts.

const SUPABASE_URL = process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY =
  process.env.NUXT_SUPABASE_SECRET_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

/** A patient carrying whatever an automation filter or consent gate reads. */
async function patient(opts: {
  accountId: string
  clinicId: string
  firstName: string
  lastName?: string
  email?: string
  phone?: string
  tags?: string[]
  marketingChannels?: string[]
  isMinor?: boolean
  doNotContact?: boolean
  dateOfBirth?: string
}) {
  const row = check(
    await admin
      .from('patients')
      .insert({
        account_id: opts.accountId,
        clinic_id: opts.clinicId,
        first_name: opts.firstName,
        last_name: opts.lastName ?? null,
        email: opts.email ?? null,
        tags: opts.tags ?? [],
        marketing_channels: opts.marketingChannels ?? [],
        is_minor: opts.isMinor ?? false,
        do_not_contact: opts.doNotContact ?? false,
        date_of_birth: opts.dateOfBirth ?? null,
      })
      .select('id')
      .single(),
  ) as { id: string }
  if (opts.phone) {
    check(
      await admin
        .from('patient_contact_numbers')
        .insert({ account_id: opts.accountId, patient_id: row.id, number: opts.phone, country_code: 'ES', is_whatsapp: true })
        .select('id'),
    )
  }
  return row
}

/** Every WhatsApp row recorded against a patient, oldest first. */
async function whatsappFor(opts: { patientId: string }) {
  return check(
    await admin
      .from('whatsapp_messages')
      .select('status, template_name, phone_number, wamid, purpose, appointment_id, patient_id, lead_id, direction')
      .eq('patient_id', opts.patientId)
      .eq('direction', 'outbound')
      .order('created_at'),
  ) ?? []
}

async function emailsFor(opts: { patientId: string }) {
  return check(
    await admin
      .from('email_messages')
      .select('provider_message_id, dry_run, rule_id, patient_id, lead_id, recipient_email, subject')
      .eq('patient_id', opts.patientId)
      .order('sent_at'),
  ) ?? []
}

async function contactLogFor(opts: { patientId: string }) {
  return check(await admin.from('contact_log').select('action, note').eq('patient_id', opts.patientId)) ?? []
}

async function ruleSends(opts: { ruleId: string }) {
  return check(await admin.from('automation_rule_sends').select('appointment_id').eq('rule_id', opts.ruleId)) ?? []
}

async function appointmentRow(opts: { id: string }) {
  return check(
    await admin.from('appointments').select('id, status, same_day_info_sent_at, confirmation_status').eq('id', opts.id).single(),
  )
}

/** Runs of a rule. By rule, because it works on either side of the patient_id column. */
async function runsForRule(opts: { ruleId: string }) {
  return check(await admin.from('automation_sequence_runs').select('*').eq('rule_id', opts.ruleId).order('started_at')) ?? []
}

async function setClinicTimezone(opts: { clinicId: string; timezone: string }) {
  check(await admin.from('clinics').update({ timezone: opts.timezone }).eq('id', opts.clinicId).select('id'))
  return { ok: true }
}

/** Inserts a rule row as given and reports the database's answer, error included. */
async function tryInsertRule(opts: { accountId: string; triggerEvent: string }) {
  const { data, error } = await admin
    .from('automation_rules')
    .insert({ account_id: opts.accountId, name: 'cypress raw rule', trigger_event: opts.triggerEvent, enabled: false })
    .select('id')
    .maybeSingle()
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null }
}

async function setRuleEnabled(opts: { ruleId: string; enabled: boolean }) {
  check(await admin.from('automation_rules').update({ enabled: opts.enabled }).eq('id', opts.ruleId).select('id'))
  return { ok: true }
}

/** Disables every rule on an account, so a cron spec does not keep firing old rules on later runs. */
async function disableRules(opts: { accountId: string }) {
  check(await admin.from('automation_rules').update({ enabled: false }).eq('account_id', opts.accountId).select('id'))
  return { ok: true }
}

async function setReminderTemplate(opts: { accountId: string; name: string }) {
  check(await admin.from('accounts').update({ whatsapp_reminder_template_name: opts.name }).eq('id', opts.accountId).select('id'))
  return { ok: true }
}

async function reviewRequestsForPatient(opts: { patientId: string }) {
  return check(await admin.from('review_requests').select('token, appointment_id').eq('patient_id', opts.patientId)) ?? []
}

/**
 * A membership paid by a Stripe subscription, as payment_schedules records
 * one, plus the per-account Stripe secrets the legacy webhook route checks.
 */
async function membershipOnStripe(opts: { accountId: string; patientId: string; subscriptionId: string; webhookSecret: string }) {
  const membership = check(
    await admin
      .from('patient_memberships')
      .insert({ account_id: opts.accountId, patient_id: opts.patientId, membership_name: 'Plan mensual', price_cents: 4000 })
      .select('id')
      .single(),
  ) as { id: string }
  check(
    await admin
      .from('payment_schedules')
      .insert({
        account_id: opts.accountId,
        patient_id: opts.patientId,
        patient_membership_id: membership.id,
        stripe_subscription_schedule_id: `sub_sched_${opts.subscriptionId}`,
        stripe_subscription_id: opts.subscriptionId,
      })
      .select('id'),
  )
  for (const [name, value] of [
    ['stripe_secret_key', 'sk_test_cypress'],
    ['stripe_webhook_secret', opts.webhookSecret],
  ]) {
    check(await admin.from('account_secrets').upsert({ account_id: opts.accountId, name, value }, { onConflict: 'account_id,name' }).select('account_id'))
  }
  return { membershipId: membership.id }
}

/** A Stripe-Signature header for a body, the way Stripe computes it. */
async function signStripe(opts: { body: string; secret: string }) {
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', opts.secret).update(`${t}.${opts.body}`).digest('hex')
  return { header: `t=${t},v1=${v1}` }
}

export const automationTasks = {
  'auto:patient': patient,
  'auto:whatsappFor': whatsappFor,
  'auto:emailsFor': emailsFor,
  'auto:contactLogFor': contactLogFor,
  'auto:ruleSends': ruleSends,
  'auto:appointment': appointmentRow,
  'auto:runsForRule': runsForRule,
  'auto:setClinicTimezone': setClinicTimezone,
  'auto:tryInsertRule': tryInsertRule,
  'auto:setRuleEnabled': setRuleEnabled,
  'auto:disableRules': disableRules,
  'auto:setReminderTemplate': setReminderTemplate,
  'auto:reviewRequestsForPatient': reviewRequestsForPatient,
  'auto:membershipOnStripe': membershipOnStripe,
  'auto:signStripe': signStripe,
}
