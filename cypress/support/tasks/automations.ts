import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { deriveUnsubscribeKey, signUnsubscribeToken } from '../../../server/utils/unsubscribeToken'

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

const ANON_KEY =
  process.env.NUXT_PUBLIC_SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

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


/** A step of a flow rule, with the chains that hang off it. */
interface FlowStep {
  type: string
  config?: Record<string, unknown>
  yes?: FlowStep[]
  no?: FlowStep[]
  met?: FlowStep[]
  timeout?: FlowStep[]
}

/**
 * A rule whose steps are a tree, inserted parent first so each chain can point
 * at the step it hangs from -- what the new builder will save.
 */
async function createFlowRule(opts: {
  accountId: string
  triggerEvent: string
  name?: string
  dryRun?: boolean
  isMarketing?: boolean
  enabled?: boolean
  filters?: Record<string, unknown>
  entryMode?: string
  exitOn?: string[]
  quietHours?: Record<string, unknown>
  segment?: Record<string, unknown>
  steps: FlowStep[]
}) {
  const rule = check(
    await admin
      .from('automation_rules')
      .insert({
        account_id: opts.accountId,
        name: opts.name ?? 'cypress flow',
        trigger_event: opts.triggerEvent,
        enabled: opts.enabled ?? true,
        dry_run: opts.dryRun ?? true,
        is_marketing: opts.isMarketing ?? false,
        filters: opts.filters ?? {},
        entry_mode: opts.entryMode ?? 'every_time',
        exit_on: opts.exitOn ?? [],
        quiet_hours: opts.quietHours ?? null,
        segment: opts.segment ?? null,
      } as never)
      .select('id')
      .single(),
  ) as { id: string }

  async function insertChain(steps: FlowStep[], parentId: string | null, branch: string | null) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      const row = check(
        await admin
          .from('automation_actions')
          .insert({ account_id: opts.accountId, rule_id: rule.id, action_type: step.type, position: i, config: step.config ?? {}, parent_id: parentId, branch } as never)
          .select('id')
          .single(),
      ) as { id: string }
      for (const outlet of ['yes', 'no', 'met', 'timeout'] as const) {
        if (step[outlet]?.length) await insertChain(step[outlet]!, row.id, outlet)
      }
    }
  }
  await insertChain(opts.steps, null, null)
  return rule
}

/** Pulls a rule's running runs back so the next tick sees them as due -- and any wait as timed out. */
async function makeRunsDue(opts: { ruleId: string }) {
  const past = new Date(Date.now() - 60_000).toISOString()
  check(await admin.from('automation_sequence_runs').update({ resume_at: past }).eq('rule_id', opts.ruleId).eq('status', 'running').select('id'))
  check(
    await admin
      .from('automation_sequence_runs')
      .update({ wait_deadline: past } as never)
      .eq('rule_id', opts.ruleId)
      .eq('status', 'running')
      .not('wait_deadline' as never, 'is', null)
      .select('id'),
  )
  return { ok: true }
}

async function patientTags(opts: { patientId: string }) {
  const row = check(await admin.from('patients').select('tags').eq('id', opts.patientId).single()) as { tags: string[] }
  return row.tags ?? []
}

async function leadRow(opts: { id: string }) {
  return check(await admin.from('leads').select('id, stage, owner_team_member_id').eq('id', opts.id).single())
}

/** Merges two patients the way the Merge dialog does: the RPC, as a signed-in member. */
async function mergeAsStaff(opts: { email: string; password: string; survivorId: string; duplicateId: string }) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email: opts.email, password: opts.password })
  if (signInError) throw signInError
  const { data, error } = await client.rpc('merge_patients', { p_survivor_id: opts.survivorId, p_duplicate_id: opts.duplicateId })
  if (error) throw error
  return data
}

/** Tries to write a rule as a signed-in member, and reports what the database said. */
async function insertRuleAsStaff(opts: { email: string; password: string; accountId: string }) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email: opts.email, password: opts.password })
  if (signInError) throw signInError
  const { data, error } = await client
    .from('automation_rules')
    .insert({ account_id: opts.accountId, name: 'As staff', trigger_event: 'appointment.booked', enabled: false })
    .select('id')
  const read = await client.from('automation_rules').select('id').eq('account_id', opts.accountId)
  return { inserted: (data ?? []).length, error: error?.message ?? null, readable: (read.data ?? []).length }
}

/**
 * A run written straight into the table, as the previous code left them: a
 * cursor (next_position) and, since the migration's backfill, possibly a
 * current_action_id that code never kept up to date.
 */
async function insertRun(opts: { accountId: string; ruleId: string; leadId: string; nextPosition: number; currentActionPosition?: number }) {
  let currentActionId: string | null = null
  if (opts.currentActionPosition !== undefined) {
    const action = check(
      await admin.from('automation_actions').select('id').eq('rule_id', opts.ruleId).eq('position', opts.currentActionPosition).single(),
    ) as { id: string }
    currentActionId = action.id
  }
  return check(
    await admin
      .from('automation_sequence_runs')
      .insert({
        account_id: opts.accountId,
        rule_id: opts.ruleId,
        lead_id: opts.leadId,
        next_position: opts.nextPosition,
        resume_at: new Date(Date.now() - 60_000).toISOString(),
        current_action_id: currentActionId,
      } as never)
      .select('id')
      .single(),
  ) as { id: string }
}

// ---------------------------------------------------------------- phase 3

async function signedIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

/** Mi día tasks, as the database has them (service role). */
async function tasksFor(opts: { ruleId?: string; patientId?: string }) {
  let query = admin
    .from('staff_tasks')
    .select('id, account_id, team_member_id, role_id, patient_id, lead_id, title, due_at, done_at, done_by, rule_id, run_id')
    .order('created_at')
  if (opts.ruleId) query = query.eq('rule_id', opts.ruleId)
  if (opts.patientId) query = query.eq('patient_id', opts.patientId)
  return check(await query) ?? []
}

/** The task ids a signed-in member can read, through RLS. */
async function tasksAsStaff(opts: { email: string; password: string }) {
  const client = await signedIn(opts.email, opts.password)
  const { data, error } = await client.from('staff_tasks').select('id')
  return { ids: (data ?? []).map((r: { id: string }) => r.id), error: error?.message ?? null }
}

/** Writes a task as a signed-in member, and reports what the database said. */
async function taskWriteAsStaff(opts: { email: string; password: string; taskId: string; patch: Record<string, unknown> }) {
  const client = await signedIn(opts.email, opts.password)
  const { data, error } = await client.from('staff_tasks').update(opts.patch as never).eq('id', opts.taskId).select('id')
  return { rows: (data ?? []).length, error: error?.message ?? null }
}

async function birthdaySends(opts: { patientId: string }) {
  return check(await admin.from('automation_birthday_sends').select('rule_id, local_date').eq('patient_id', opts.patientId).order('local_date')) ?? []
}

async function insertBirthdaySend(opts: { accountId: string; ruleId: string; patientId: string; localDate: string }) {
  check(
    await admin
      .from('automation_birthday_sends')
      .insert({ account_id: opts.accountId, rule_id: opts.ruleId, patient_id: opts.patientId, local_date: opts.localDate })
      .select('rule_id'),
  )
  return { ok: true }
}

/**
 * The unsubscribe token the server would put in a marketing email for this
 * recipient: the same function, keyed off the same secret the server reads
 * (NUXT_SUPABASE_SECRET_KEY).
 */
async function unsubscribeToken(opts: { kind: 'patient' | 'lead'; id: string }) {
  return signUnsubscribeToken(deriveUnsubscribeKey(SERVICE_ROLE_KEY), opts.kind, opts.id)
}

async function patientChannels(opts: { patientId: string }) {
  const row = check(await admin.from('patients').select('marketing_channels').eq('id', opts.patientId).single()) as { marketing_channels: string[] }
  return row.marketing_channels ?? []
}

async function setLeadConsent(opts: { leadId: string; consentedAt: string | null }) {
  check(await admin.from('leads').update({ marketing_consent_at: opts.consentedAt, marketing_consent_source: opts.consentedAt ? 'cypress' : null }).eq('id', opts.leadId).select('id'))
  return { ok: true }
}

async function leadConsent(opts: { leadId: string }) {
  return check(await admin.from('leads').select('marketing_consent_at, marketing_consent_source').eq('id', opts.leadId).single())
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
  'auto:createFlowRule': createFlowRule,
  'auto:makeRunsDue': makeRunsDue,
  'auto:patientTags': patientTags,
  'auto:leadRow': leadRow,
  'auto:mergeAsStaff': mergeAsStaff,
  'auto:insertRuleAsStaff': insertRuleAsStaff,
  'auto:insertRun': insertRun,
  'auto:tasksFor': tasksFor,
  'auto:tasksAsStaff': tasksAsStaff,
  'auto:taskWriteAsStaff': taskWriteAsStaff,
  'auto:birthdaySends': birthdaySends,
  'auto:insertBirthdaySend': insertBirthdaySend,
  'auto:unsubscribeToken': unsubscribeToken,
  'auto:patientChannels': patientChannels,
  'auto:setLeadConsent': setLeadConsent,
  'auto:leadConsent': leadConsent,
}
