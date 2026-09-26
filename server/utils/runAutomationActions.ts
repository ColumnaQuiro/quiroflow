import { createHmac, randomUUID } from 'node:crypto'
import { automationFieldValue as recipientFieldValue, type MergeContext } from '~/utils/automationFields'
import { toE164 } from '~/utils/phone'
import { renderTemplateFields } from '~/utils/docFields'
import { automationEmailHtml, unsubscribeHeaders, type UnsubscribeLinks } from '~/utils/automationEmail'
import { serviceSupabase } from '~/server/utils/serviceSupabase'
import { unsubscribeLinks } from '~/server/utils/unsubscribe'

// The server runs in UTC, so formatting a UTC Date with toLocaleString and no
// timeZone renders the UTC wall-clock time, not the clinic's -- a booking at
// 16:00 Madrid time (CEST, UTC+2) would merge into a message as "14:00".
// There's no per-account timezone column yet, so this is hardcoded the same
// way same-day-cron.post.ts and appointmentNotifications.ts hardcode it.

// Shared by both the trigger-based fire endpoint and the one-off "Send Now"
// endpoint: both ultimately just need to run one rule's actions for one
// patient. Kept here (server/utils/*.ts auto-imports into server routes per
// Nitro convention, same as requirePermission.ts) so neither endpoint
// duplicates the WhatsApp/email/webhook sending logic.
export interface PatientForAction {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  is_minor?: boolean
  do_not_contact?: boolean
  marketing_channels?: string[]
  date_of_birth?: string | null
  address?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
  national_id?: string | null
  occupation?: string | null
  gender?: string | null
  emergency_contact?: string | null
}
/**
 * A lead, for the purposes of being messaged. Deliberately not shaped like a
 * patient: a lead has one name field, carries its own phone rather than a
 * patient_contact_numbers row, and has no clinical or billing history to
 * merge into anything.
 */
export interface LeadForAction {
  id: string
  full_name: string
  email: string | null
  /** Bare E.164 as the leads table stores it. */
  phone: string | null
  marketing_consent_at?: string | null
}

/**
 * Who a rule is being run for.
 *
 * The engine was written when the only answer was "a patient", and nine call
 * sites still pass one. Rather than rewrite those, both kinds are narrowed to
 * this shape at the door, and everything downstream reads the shape instead
 * of the row. `patient` is present only for patient-backed recipients, and is
 * what the patient-only features (doc-template links, contact numbers) check
 * before doing anything -- so a lead cannot silently acquire a health-history
 * form or a patient's phone number.
 */
interface Recipient {
  kind: 'patient' | 'lead'
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  /** Set when the recipient carries its own number, as a lead does. */
  phone?: string
  canContact: boolean
  /** Channels this recipient may receive *marketing* on. */
  marketingChannels: string[]
  patient?: PatientForAction
}

function patientRecipient(patient: PatientForAction): Recipient {
  return {
    kind: 'patient',
    id: patient.id,
    firstName: patient.first_name ?? '',
    lastName: patient.last_name ?? null,
    email: patient.email ?? null,
    // Minors and do-not-contact patients get no communications.
    canContact: !patient.is_minor && !patient.do_not_contact,
    marketingChannels: patient.marketing_channels ?? [],
    patient,
  }
}

function leadRecipient(lead: LeadForAction): Recipient {
  // A lead who enquired can be answered -- that is transactional, and it is
  // the entire reason they gave us a number. Marketing is a separate
  // question, and the answer is only yes where consent was recorded at
  // capture: LSSI-CE and GDPR want evidence, not an inference from the fact
  // that a row exists.
  const consented = Boolean(lead.marketing_consent_at)
  return {
    kind: 'lead',
    id: lead.id,
    firstName: (lead.full_name ?? '').trim().split(/\s+/)[0] ?? '',
    lastName: (lead.full_name ?? '').trim().split(/\s+/).slice(1).join(' ') || null,
    email: lead.email ?? null,
    phone: lead.phone ?? undefined,
    canContact: Boolean(lead.phone || lead.email),
    marketingChannels: consented ? ['whatsapp', 'email'] : [],
  }
}

export interface ActionRow {
  id: string
  // 'delay' is handled by the sequence runner before it ever reaches here --
  // it is a pause, not something to send -- but it shares the table and so
  // the type.
  action_type: 'whatsapp_template' | 'email' | 'webhook' | 'delay'
  config: Record<string, any>
}
/**
 * An action that was deliberately not delivered, as opposed to one that
 * failed: no consent, no number to send to, a channel the clinic never
 * connected. Retrying cannot change any of these, so the drip carries on past
 * them -- but the reason is kept, because "why did this lead get nothing" is
 * exactly the question the Executions tab exists to answer.
 */
export class ActionSkipped extends Error {}

/** What one action did, for the sequence runner's execution history. */
export interface ActionOutcome {
  actionId: string
  actionType: ActionRow['action_type']
  status: 'sent' | 'dry_run' | 'skipped' | 'failed'
  detail: string | null
}

export interface TriggerBody {
  triggerEvent: string
  patientId: string
  appointmentId?: string
  invoiceId?: string
  membershipId?: string
}

export async function runRuleActions(
  supabase: any,
  accountId: string,
  ruleId: string,
  patient: PatientForAction,
  origin: string,
  appointmentId?: string,
  triggerBody?: TriggerBody,
  extraContext?: Partial<MergeContext>,
) {
  const [{ data: rule }, { data: actions }] = await Promise.all([
    supabase.from('automation_rules').select('is_marketing, dry_run').eq('id', ruleId).maybeSingle(),
    supabase.from('automation_actions').select('id, action_type, config').eq('rule_id', ruleId).order('position'),
  ])

  await runActionsList(supabase, accountId, (actions ?? []) as ActionRow[], patient, origin, rule?.is_marketing ?? false, appointmentId, triggerBody, undefined, extraContext, rule?.dry_run ?? false, ruleId)
}

// Split out from runRuleActions so a caller that already has an in-memory
// list of actions (the editor drawer's "Send test to me", which tests the
// unsaved draft on screen) can run them without needing a persisted
// automation_actions/automation_rules row to read back -- test sends
// shouldn't have the side effect of writing a real, enabled rule to the
// database just so it can be read back out again.
export async function runActionsList(
  supabase: any,
  accountId: string,
  actions: ActionRow[],
  patient: PatientForAction,
  origin: string,
  isMarketing = false,
  appointmentId?: string,
  triggerBody?: TriggerBody,
  whatsappOverrideNumber?: string,
  // Caller-supplied merge values that can't be derived from appointmentId/
  // accountId alone -- e.g. waitlistOffer.ts's claim link and slot time,
  // which describe an appointment that doesn't exist as a row yet (claiming
  // is what creates it). Auto-resolved fields below still win their own keys
  // unconditionally rather than merging under extraContext, since only
  // waitlistOffer.ts (which never sets appointmentId) has any reason to pass
  // those two keys.
  extraContext?: Partial<MergeContext>,
  dryRun = false,
  // Set by runRuleActions, which knows the campaign. Left undefined by the
  // editor's "send test to me" -- counting a staff member's own test open
  // against the campaign would flatter every metric on the page.
  ruleId?: string,
) {
  const { problems } = await runForRecipient(supabase, accountId, actions, patientRecipient(patient), origin, isMarketing, appointmentId, triggerBody, whatsappOverrideNumber, extraContext, dryRun, ruleId)
  return problems
}

/**
 * Runs a rule's actions for a lead rather than a patient.
 *
 * Its own entry point instead of a union on the existing one, so the nine
 * patient call sites keep their exact signature and a lead can never arrive
 * at one of them by accident.
 */
export async function runLeadRuleActions(
  supabase: any,
  accountId: string,
  ruleId: string,
  lead: LeadForAction,
  origin: string,
  extraContext?: Partial<MergeContext>,
  // A sequence runs one step at a time and has already read the rule's
  // actions to find where it got to, so it passes the step rather than
  // making this re-read them and run the lot.
  only?: ActionRow[],
): Promise<ActionOutcome[]> {
  const [{ data: rule }, { data: actions }] = await Promise.all([
    supabase.from('automation_rules').select('is_marketing, dry_run').eq('id', ruleId).maybeSingle(),
    only
      ? Promise.resolve({ data: only })
      : supabase.from('automation_actions').select('id, action_type, config').eq('rule_id', ruleId).order('position'),
  ])

  const { outcomes } = await runForRecipient(
    supabase,
    accountId,
    (actions ?? []) as ActionRow[],
    leadRecipient(lead),
    origin,
    rule?.is_marketing ?? false,
    undefined,
    undefined,
    undefined,
    extraContext,
    rule?.dry_run ?? false,
    ruleId,
  )
  return outcomes
}

/**
 * Runs chosen steps of a rule for a patient and says what each one did.
 *
 * The automation engine's way in (server/utils/automationEngine.ts): a rule
 * that waits runs one step at a time, the way a lead drip always has, and has
 * to tell "not delivered on purpose" from "failed" to know whether to retry.
 * Everything below -- consent, dry run, templates, doc links, header media,
 * email tracking -- is the same code runRuleActions reaches; runRuleActions
 * itself is untouched, and still what every rule that does not wait goes
 * through.
 */
export async function runPatientRuleActions(
  supabase: any,
  accountId: string,
  ruleId: string,
  patient: PatientForAction,
  origin: string,
  appointmentId: string | undefined,
  triggerBody: TriggerBody | undefined,
  extraContext: Partial<MergeContext> | undefined,
  only: ActionRow[],
): Promise<ActionOutcome[]> {
  const { data: rule } = await supabase.from('automation_rules').select('is_marketing, dry_run').eq('id', ruleId).maybeSingle()
  const { outcomes } = await runForRecipient(
    supabase,
    accountId,
    only,
    patientRecipient(patient),
    origin,
    rule?.is_marketing ?? false,
    appointmentId,
    triggerBody,
    undefined,
    extraContext,
    rule?.dry_run ?? false,
    ruleId,
  )
  return outcomes
}

async function runForRecipient(
  supabase: any,
  accountId: string,
  actions: ActionRow[],
  recipient: Recipient,
  origin: string,
  isMarketing = false,
  appointmentId?: string,
  triggerBody?: TriggerBody,
  whatsappOverrideNumber?: string,
  extraContext?: Partial<MergeContext>,
  dryRun = false,
  // Which campaign this firing belongs to, so a sent email can be counted
  // against it later. Undefined for a test send and for the one-off sends that
  // are not a campaign.
  ruleId?: string,
) {
  const canContact = recipient.canContact
  // Marketing rules (birthday campaigns, a lead welcome drip, or any rule
  // staff flagged as promotional rather than transactional) only reach a
  // recipient who opted that channel in -- LSSI-CE and GDPR require real
  // opt-in for unsolicited commercial communications, distinct from
  // transactional ones like an appointment confirmation.
  const channelAllowed = (channel: string) => !isMarketing || recipient.marketingChannels.includes(channel)

  // Resolved once per rule firing (not per-action) since the {{next_appointment}}
  // merge token always refers to the appointment that triggered this rule --
  // there's no other appointment in scope an email action could mean instead.
  let nextAppointmentAt: string | undefined
  // The clinic behind the message: the appointment's own, else the account's
  // first active one. Its time zone formats the appointment variables, and its
  // name, phone and address are variables of their own (clinic_*), so a
  // clinic's WhatsApp template can say how to reach that location.
  let clinic: { name: string | null; phone: string | null; address: string | null; timezone: string | null } | null = null
  if (appointmentId) {
    const { data: appt } = await supabase.from('appointments').select('starts_at, clinics(name, phone, address, timezone)').eq('id', appointmentId).maybeSingle()
    nextAppointmentAt = appt?.starts_at ?? undefined
    clinic = (appt?.clinics as typeof clinic) ?? null
  }
  if (!clinic) {
    const { data } = await supabase.from('clinics').select('name, phone, address, timezone').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle()
    clinic = data ?? null
  }
  // Also resolved once per firing, not per-action -- backs {{google_review_link}}
  // for the appointment.review_request campaign (and any other campaign that
  // wants it). A cheap extra query even when unused, same tradeoff as
  // nextAppointmentAt above, kept simple rather than conditioned on whether
  // any action actually references the token.
  const { data: account } = await supabase.from('accounts').select('google_review_url').eq('id', accountId).maybeSingle()
  const googleReviewUrl = await trackedReviewLink(supabase, accountId, recipient, origin, account?.google_review_url ?? null, {
    appointmentId,
    // Only when this rule actually sends the link. Minting on every firing
    // would put a review_requests row behind every appointment reminder the
    // clinic sends, and the Reputation funnel counts rows -- "412 review
    // requests sent" when four went out is worse than the blank it replaces.
    //
    // A test send and a dry run are excluded for the same reason: neither
    // reaches anybody, and both would still be counted.
    record: !dryRun && !whatsappOverrideNumber && actionsUseReviewLink(actions),
  })

  const context: MergeContext = {
    ...extraContext,
    nextAppointmentAt,
    googleReviewUrl,
    clinicName: clinic?.name ?? undefined,
    clinicPhone: clinic?.phone ?? undefined,
    clinicAddress: clinic?.address ?? undefined,
    clinicTimezone: clinic?.timezone ?? undefined,
  }

  // Why an action did nothing, in the sender's words. Actions stay
  // best-effort -- one failure must not stop the rest of a rule -- but the
  // reason is no longer thrown away. "Send test to me" shows this list; a
  // real automated send logs it and carries on.
  const problems: string[] = []
  // The same information, per action and machine-readable, for the sequence
  // runner: it has to tell "not delivered on purpose" (carry on) from "tried
  // and failed" (retry, then stop and say so) -- which a list of sentences
  // cannot.
  const outcomes: ActionOutcome[] = []
  const skipped = (channel: string) =>
    !canContact
      ? `${channel}: this recipient is marked do-not-contact (or is a minor).`
      : `${channel}: this is a marketing rule and the recipient has not opted in to ${channel}.`

  for (const action of actions) {
    const outcome = (status: ActionOutcome['status'], detail: string | null) =>
      outcomes.push({ actionId: action.id, actionType: action.action_type, status, detail })
    try {
      if (action.action_type === 'whatsapp_template') {
        if (canContact && channelAllowed('whatsapp')) {
          const result = await runWhatsAppAction(supabase, accountId, recipient, action.config, origin, appointmentId, whatsappOverrideNumber, context, dryRun)
          outcome(result, null)
        } else {
          problems.push(skipped('WhatsApp'))
          outcome('skipped', skipped('WhatsApp'))
        }
      } else if (action.action_type === 'email') {
        if (canContact && channelAllowed('email')) {
          // Recorded with the service role, whoever fired the rule. The row is
          // what the campaign's email metrics count, and email_messages has no
          // staff insert policy -- so a rule fired from the app (fire.post.ts,
          // send-now, with the caller's own client) used to send the email
          // and silently lose the row, while the same rule run by a cron
          // recorded it. A test send (no ruleId) records nothing, as before.
          const record = ruleId ? { supabase: serviceSupabase() ?? supabase, accountId, ruleId } : undefined
          // A marketing email carries a way out: the footer link and the
          // List-Unsubscribe headers, signed for this one recipient.
          const unsubscribe = isMarketing && ruleId ? unsubscribeLinks(origin, recipient.kind, recipient.id) : null
          const result = await runEmailAction(recipient, action.config, context, record, dryRun, unsubscribe)
          outcome(result, null)
        } else {
          problems.push(skipped('Email'))
          outcome('skipped', skipped('Email'))
        }
      } else if (action.action_type === 'webhook') {
        const result = await runWebhookAction(action.config, triggerBody ?? { triggerEvent: 'manual', patientId: recipient.id, appointmentId }, dryRun)
        outcome(result, result === 'dry_run' ? 'Test mode: the webhook was not called.' : null)
      }
    } catch (e: any) {
      // Best-effort: one failed action shouldn't stop the rest of the rule.
      const message = e?.message ?? String(e)
      problems.push(`${action.action_type}: ${message}`)
      if (e instanceof ActionSkipped) {
        outcome('skipped', message)
      } else {
        outcome('failed', message)
        console.error(`[automations] ${action.action_type} action failed for ${recipient.kind} ${recipient.id}: ${message}`)
      }
    }
  }

  return { problems, outcomes }
}

/**
 * One dynamic URL button's value, for a template that configures them.
 *
 * `phone` is digits only. Meta appends this to the stored URL verbatim, so a
 * `+34...` arrives as `?phone=+34...`, and a `+` in a query string decodes to
 * a space -- the page then reads a number starting with a space and matches
 * nobody. The n8n flow this mirrors strips it for the same reason. Leads
 * carry a number normalised at ingest; a patient's comes back from toE164
 * with the plus, so both are stripped here rather than trusting either.
 *
 * `text` is passed through untouched, so a fixed suffix can carry its own
 * `&`-separated pairs. Anything else is URL-encoded, since a name with a
 * space or an accent would otherwise end the value early.
 */
function buttonParamValue(param: { source: string; text?: string }, to: string, recipient: Recipient, context?: MergeContext): string {
  if (param.source === 'text') return param.text ?? ''
  if (param.source === 'phone') return to.replace(/\D/g, '')
  return encodeURIComponent(recipientFieldValue(recipient, param.source, context))
}

/**
 * The header of a template, when it has one that needs filling.
 *
 * Two kinds, because the welcome drip this was written for uses both: a video
 * on the first message and the clinic's location on the third. A template
 * whose header is plain text or fixed needs nothing here and gets an empty
 * list.
 *
 * Media is sent as a `link` rather than an uploaded media id, deliberately.
 * Meta's /media ids expire after about 30 days, so the id route means either
 * re-uploading the same video per send or keeping a cache with its own
 * expiry bookkeeping. A link is fetched by Meta at send time and the problem
 * disappears -- and a signed URL means the file can stay in the private
 * whatsapp-media bucket instead of a public one, which is the right default
 * for anything we send to patients.
 *
 * config.header:
 *   { type: 'video' | 'image' | 'document', storage_path: 'welcome/saludo.mp4' }
 *   { type: 'location', latitude, longitude, name, address }
 */
const SIGNED_URL_SECONDS = 60 * 60

async function buildHeaderComponent(supabase: any, header: Record<string, any> | undefined): Promise<Record<string, any>[]> {
  if (!header || typeof header !== 'object') return []
  const type = String(header.type ?? '')

  if (type === 'location') {
    const latitude = Number(header.latitude)
    const longitude = Number(header.longitude)
    // No graceful degradation is available here, and pretending otherwise
    // would be worse than the truth: a template whose header is required is
    // rejected by Meta with 132000 whether the header is malformed or
    // missing. So an unbuildable header means the send fails -- what this
    // returns decides only which error lands in
    // whatsapp_messages.error_message, and "parameters do not match" is a
    // better trail than a rejected location object.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    return [{
      type: 'header',
      parameters: [{
        type: 'location',
        location: {
          latitude: String(latitude),
          longitude: String(longitude),
          name: header.name ?? '',
          address: header.address ?? '',
        },
      }],
    }]
  }

  if (type !== 'video' && type !== 'image' && type !== 'document') return []

  const storagePath: string | undefined = header.storage_path
  if (!storagePath) return []

  const { data, error } = await supabase.storage.from('whatsapp-media').createSignedUrl(storagePath, SIGNED_URL_SECONDS)
  if (error || !data?.signedUrl) return []

  const media: Record<string, any> = { link: data.signedUrl }
  if (type === 'document' && header.filename) media.filename = header.filename

  return [{ type: 'header', parameters: [{ type, [type]: media }] }]
}

/**
 * Whether any action in this rule actually sends the review link -- as a
 * WhatsApp template variable, or as a {{google_review_link}} merge token in
 * an email body.
 */
function actionsUseReviewLink(actions: ActionRow[]) {
  return actions.some((action) => {
    const config = action.config ?? {}
    if (Array.isArray(config.variables) && config.variables.some((v: { source?: string }) => v?.source === 'google_review_link')) return true
    return typeof config.body === 'string' && config.body.includes('{{google_review_link}}')
  })
}

/**
 * The review link a patient is actually sent.
 *
 * {{google_review_link}} used to resolve straight to the clinic's Google
 * page, which works -- the patient lands where they should -- but means
 * nothing observes that it happened. review_requests was only ever read, by
 * the redirect; nothing wrote to it, so the Reputation funnel reported
 * 0 sent and 0 opened however many review requests went out. Two of its three
 * steps were permanently blank for a feature that was already running.
 *
 * Routing through /api/r/<token> fixes that without changing what the patient
 * experiences: they still arrive at the same Google page, and we learn the
 * request was sent and whether the link was opened. The third step -- whether
 * they then wrote a review -- still belongs to Google, and the screen still
 * says so.
 *
 * Falls back to the raw URL if a token cannot be stored. A patient who cannot
 * be counted should still be able to leave a review.
 */
async function trackedReviewLink(
  supabase: any,
  accountId: string,
  recipient: Recipient,
  origin: string,
  googleReviewUrl: string | null,
  opts: { appointmentId?: string; record: boolean },
): Promise<string | undefined> {
  if (!googleReviewUrl) return undefined
  if (!opts.record || recipient.kind !== 'patient') return googleReviewUrl

  const token = randomUUID().replace(/-/g, '')
  const { error } = await supabase.from('review_requests').insert({
    account_id: accountId,
    patient_id: recipient.id,
    appointment_id: opts.appointmentId ?? null,
    token,
    // Which channel carries it is not knowable here -- the link is resolved
    // once for the rule, before any individual action runs, and a rule can
    // have both a WhatsApp and an email action. Left at the column default;
    // nothing reads it yet, and a guess would be worse than a default.
  })
  if (error) return googleReviewUrl

  return `${origin}/api/r/${token}`
}

// Creates the patient's copy of a doc template (health history, consent,
// etc.) and returns its public_token, or null if the template is gone.
// Returns just the token, not the full URL, since callers need it in two
// shapes: appended as `${origin}/doc/${token}` in a message body, or as the
// bare token substituted into a WhatsApp URL button's {{n}} placeholder
// (Meta stores the rest of the URL, e.g. ".../doc/{{1}}", on the button itself).
async function generateDocLink(supabase: any, accountId: string, patient: PatientForAction | undefined, docTemplateId: string): Promise<string | null> {
  // Patient-only by construction. A doc is the patient's own copy of a health
  // history or consent form and hangs off patient_id, so a lead has nothing
  // to attach one to -- the button falls back to Meta's example suffix
  // rather than the send being rejected.
  if (!patient) return null
  const { data: template } = await supabase.from('doc_templates').select('title, fields').eq('id', docTemplateId).maybeSingle()
  if (!template) return null
  const rendered = renderTemplateFields(template.fields, {
    first_name: patient.first_name ?? '',
    last_name: patient.last_name ?? '',
    email: patient.email ?? '',
    date_of_birth: patient.date_of_birth ?? '',
    address: patient.address ?? '',
    city: patient.city ?? '',
    postal_code: patient.postal_code ?? '',
    country: patient.country ?? '',
    national_id: patient.national_id ?? '',
    occupation: patient.occupation ?? '',
    gender: patient.gender ?? '',
    emergency_contact: patient.emergency_contact ?? '',
  })
  const { data: doc } = await supabase
    .from('patient_docs')
    .insert({ account_id: accountId, patient_id: patient.id, title: template.title, fields: rendered, template_id: docTemplateId })
    .select('public_token')
    .single()
  return doc?.public_token ?? null
}

async function runWhatsAppAction(
  supabase: any,
  accountId: string,
  recipient: Recipient,
  config: Record<string, any>,
  origin: string,
  appointmentId?: string,
  toOverride?: string,
  context?: MergeContext,
  dryRun = false,
): Promise<'sent' | 'dry_run'> {
  const templateName: string | undefined = config.template_name
  const templateLanguage: string = config.template_language || 'es'
  if (!templateName) throw new Error('No WhatsApp template is chosen for this step.')

  const { data: account } = await supabase
    .from('accounts')
    .select(
      'whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id, whatsapp_confirmation_template_name, whatsapp_reminder_template_name, whatsapp_recall_template_name',
    )
    .eq('id', accountId)
    .maybeSingle()
  // A dry run is allowed to proceed without WhatsApp credentials: rehearsing
  // the rule before the channel is connected is a legitimate thing to want,
  // and is the order a clinic actually does things in. It does prove less --
  // the live template lookup below needs those credentials, so an
  // unconnected account cannot catch a wrong variable count. Worth having
  // anyway, and worth not pretending otherwise.
  if (!dryRun && (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token)) {
    throw new ActionSkipped('WhatsApp is not connected for this clinic.')
  }

  let to = toOverride
  // A lead carries its own number, already normalised at ingest. Only a
  // patient has contact-number rows to look through.
  if (!to) to = recipient.phone
  if (!to && recipient.patient) {
    const { data: numbers } = await supabase
      .from('patient_contact_numbers')
      .select('number, country_code, is_whatsapp')
      .eq('patient_id', recipient.patient.id)
    const target = numbers?.find((n: any) => n.is_whatsapp) ?? numbers?.[0]
    if (!target) throw new ActionSkipped('No phone number to send WhatsApp to.')
    to = toE164(target.number, target.country_code) ?? undefined
  }
  if (!to) throw new ActionSkipped('No phone number to send WhatsApp to.')

  // Each configured variable slot maps to a patient field (first_name,
  // last_name, email) or fixed text -- lets a template with more than one
  // {{n}} placeholder be filled correctly, matching however many variables
  // that specific template actually needs (Meta doesn't expose this to us
  // to validate against, so the config is where staff match it themselves).
  const configuredVariables: { source: string; text?: string }[] = Array.isArray(config.variables) && config.variables.length > 0
    ? config.variables
    : [{ source: 'first_name' }]
  const variables: string[] = configuredVariables.map((v) => (v.source === 'text' ? (v.text ?? '') : recipientFieldValue(recipient, v.source, context)))

  // One doc-template slot per configured link. A template with URL buttons
  // that carry a {{n}} placeholder maps each slot to a button by position
  // (new_patient_arrived_tasks has two separate "fill this form" buttons);
  // a template with no such buttons instead treats slot 0 (if set) as one
  // more body variable, appended last -- the original single-link design.
  const docTemplateIds: (string | null)[] = Array.isArray(config.doc_template_ids) ? config.doc_template_ids : []

  // What goes in a dynamic URL button's {{n}} blank, one entry per button.
  //
  // Meta stores the fixed half of the link and appends whatever we send, so
  // the right value depends entirely on the template: quiroads_welcome_message_3
  // ends in `?phone=` and the booking page reads that back to prefill the
  // field, while new_patient_arrived_tasks ends in `/doc/` and wants a
  // document token. Nothing in the API says which, and Meta validates only
  // that a parameter is present -- never that it suits the URL. So a wrong
  // value here sends cleanly and arrives as a link that quietly does nothing,
  // which is why this is configured rather than guessed.
  //
  // Unset keeps the older behaviour every rule written before this relies on:
  // the doc-template token when the slot has one, and otherwise Meta's own
  // example suffix for these buttons.
  const buttonParams: { source: string; text?: string }[] = Array.isArray(config.button_params) ? config.button_params : []

  // Fetch the live approved template so the send always matches what Meta
  // actually expects, rather than trusting the staff-entered config alone:
  // (a) a template can carry URL buttons whose link needs a per-recipient
  // suffix -- Meta requires a "button" component for every URL button that
  // has a {{n}} placeholder, or the whole send is rejected with error
  // 131008 "Required parameter is missing" (found via new_patient_arrived_tasks's
  // onboarding-form links, built this way); a button with no doc template
  // configured for its slot falls back to Meta's own example suffix for
  // these buttons, a `?name=<name>&id=<id>` query string. (b) the body's own
  // placeholder count can differ from what staff configured (e.g.
  // new_patient_arrived_tasks_2 has no {{n}} at all but was configured with
  // a first_name slot anyway), which Meta rejects with error 132000 "Number
  // of parameters does not match" -- so the configured variables are
  // trimmed/padded to match.
  const bodyComponents: Record<string, any>[] = []
  const buttonComponents: Record<string, any>[] = []
  const headerComponents = await buildHeaderComponent(supabase, config.header)
  if (account?.whatsapp_business_account_id) {
    const templates = await $fetch<{ data: { name: string; language: string; components: any[] }[] }>(
      `https://graph.facebook.com/v21.0/${account.whatsapp_business_account_id}/message_templates`,
      { params: { name: templateName, fields: 'name,language,components' }, headers: { Authorization: `Bearer ${account.whatsapp_access_token}` } },
    ).catch(() => null)
    // Meta's `name` query param is a fuzzy/substring match, not an exact
    // filter -- e.g. querying "new_patient_arrived_tasks" also returns
    // "new_patient_arrived_tasks_2" -- so the exact name has to be checked
    // again client-side or the wrong template's body/buttons get used.
    const candidates = (templates?.data ?? []).filter((t: { name: string }) => t.name === templateName)
    const match = candidates.find((t: { language: string }) => t.language === templateLanguage) ?? candidates[0]

    const buttons = match?.components?.find((c: any) => c.type === 'BUTTONS')?.buttons ?? []
    const dynamicUrlButtonIndexes = buttons
      .map((b: any, index: number) => ({ b, index }))
      .filter(({ b }: any) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url ?? ''))
      .map(({ index }: any) => index)

    // No dynamic URL button to attach a doc link to -- fall back to the
    // older behaviour of tacking it onto the message body instead.
    if (dynamicUrlButtonIndexes.length === 0 && docTemplateIds[0]) {
      const token = await generateDocLink(supabase, accountId, recipient.patient, docTemplateIds[0])
      if (token) variables.push(`${origin}/doc/${token}`)
    }

    const bodyText: string = match?.components?.find((c: any) => c.type === 'BODY')?.text ?? ''
    const bodySlots = new Set<string>()
    for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) bodySlots.add(m[1])
    if (bodySlots.size > 0) {
      const trimmed = Array.from({ length: bodySlots.size }, (_, i) => variables[i] ?? recipient.firstName ?? '')
      bodyComponents.push({ type: 'body', parameters: trimmed.map((v) => ({ type: 'text', text: v })) })
    }

    for (let i = 0; i < dynamicUrlButtonIndexes.length; i++) {
      const docTemplateId = docTemplateIds[i]
      const token = docTemplateId ? await generateDocLink(supabase, accountId, recipient.patient, docTemplateId) : null
      const configured = buttonParams[i]
      const paramText = token
        ? token
        : configured
          ? buttonParamValue(configured, to, recipient, context)
          : `name=${encodeURIComponent(recipient.firstName ?? '')}&id=${recipient.id}`
      buttonComponents.push({ type: 'button', sub_type: 'url', index: String(dynamicUrlButtonIndexes[i]), parameters: [{ type: 'text', text: paramText }] })
    }
  } else {
    // No business-account id on file to look the template up against --
    // fall back to sending exactly what was configured, same as before.
    if (docTemplateIds[0]) {
      const token = await generateDocLink(supabase, accountId, recipient.patient, docTemplateIds[0])
      if (token) variables.push(`${origin}/doc/${token}`)
    }
    if (variables.length > 0) bodyComponents.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) })
  }

  // Same template-name -> purpose mapping the manual staff send
  // (api/whatsapp/send.post.ts) uses, instead of flatly recording every
  // automation send as 'other' -- a rule that fires the account's own
  // reminder template is a reminder, and the inbox and reporting reads on
  // this column should be able to say so.
  const purpose =
    templateName === account?.whatsapp_confirmation_template_name
      ? 'confirmation'
      : templateName === account?.whatsapp_reminder_template_name
        ? 'reminder'
        : templateName === account?.whatsapp_recall_template_name
          ? 'recall'
          : 'other'

  let wamid: string | null = null
  let errorMessage: string | null = null

  // Everything above still ran: the recipient, the consent gate, the live
  // template lookup, the variable trimming, the header. Only the call to
  // Meta is skipped, so a dry run exercises every part that can be wrong
  // except the one that cannot be taken back.
  if (dryRun) {
    await supabase.from('whatsapp_messages').insert({
      account_id: accountId,
      patient_id: recipient.patient?.id ?? null,
      lead_id: recipient.kind === 'lead' ? recipient.id : null,
      appointment_id: appointmentId ?? null,
      wamid: null,
      purpose,
      template_name: templateName,
      status: 'would_send',
      phone_number: to,
    })
    return 'dry_run'
  }

  try {
    const response = await $fetch<{ messages?: { id: string }[] }>(
      `https://graph.facebook.com/v21.0/${account.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
        body: {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLanguage },
            // Header first: Meta rejects a template whose components are
            // out of order with 132000 rather than reordering them.
            components: [...headerComponents, ...bodyComponents, ...buttonComponents],
          },
        },
      },
    )
    wamid = response?.messages?.[0]?.id ?? null
  } catch (e: any) {
    errorMessage = e?.data?.error?.message ?? e?.message ?? 'Unknown error'
  }


  // Only the confirmation and reminder templates carry the Confirmar/
  // Cambiar/Cancelar reply buttons. Everything else an automation might send
  // (first-visit info, arrival tasks...) happens to be appointment-linked
  // too but asks for nothing, so it must not touch confirmation state.
  const asksForConfirmation = purpose === 'confirmation' || purpose === 'reminder'

  // Logged against whichever it was sent to. lead_id is what puts a drip
  // message into the lead's own Inbox thread rather than nowhere -- the
  // column exists for exactly this, from the merged-inbox work.
  await supabase.from('whatsapp_messages').insert({
    account_id: accountId,
    patient_id: recipient.patient?.id ?? null,
    lead_id: recipient.kind === 'lead' ? recipient.id : null,
    appointment_id: appointmentId ?? null,
    wamid,
    purpose,
    template_name: templateName,
    status: wamid ? 'sent' : 'failed',
    error_message: errorMessage,
    phone_number: to,
  })

  // A recall that went out is outreach, the same as one a person sends from
  // the Recalls page (api/whatsapp/send.post.ts logs those). Without this the
  // page's "Último contacto" said "Aún sin contacto" for a patient an
  // automation had just messaged -- and "Sin contactar" offered them again.
  if (wamid && purpose === 'recall' && recipient.patient?.id) {
    await supabase.from('contact_log').insert({
      account_id: accountId,
      patient_id: recipient.patient.id,
      action: 'sent_whatsapp',
      note: `Automation · template: ${templateName}`,
    })
  }

  // A confirmation/reminder template carries the Confirmar/Cambiar/Cancelar
  // reply buttons, so the appointment has to be marked 'pending' before it
  // goes out -- the webhook resolves "which appointment is this reply about"
  // partly off that flag, and until this was set an automation-sent reminder
  // (e.g. a "3 days before" rule, which fires well before the built-in 24h
  // reminder has set it) left the appointment at NULL, so a genuine
  // "Confirmar" reply silently no-opped. appointmentNotifications.ts already
  // does this for the built-in sends; this is the same guard for the
  // automation-rule path. Skip if the patient already confirmed, so a later
  // reminder doesn't reset them back to unconfirmed.
  if (wamid && appointmentId && asksForConfirmation) {
    const { data: current } = await supabase.from('appointments').select('confirmation_status').eq('id', appointmentId).maybeSingle()
    if (current?.confirmation_status !== 'confirmed') {
      await supabase.from('appointments').update({ confirmation_status: 'pending' }).eq('id', appointmentId)
    }
  }

  // Raised only now, after the failed send is logged against the recipient:
  // the whatsapp_messages row is what the Inbox shows, and it must exist
  // whether or not anyone upstream is listening. Before this, a refusal from
  // Meta ended here as a normal return and a drip counted it as delivered.
  if (!wamid) throw new Error(`Meta refused the WhatsApp message: ${errorMessage ?? 'no message id returned'}`)
  return 'sent'
}

// Email clients disagree about what an unstyled <a> looks like, and some
// render it in the surrounding body colour -- which is how a link staff
// inserted arrives looking like ordinary text. A <style> block is no help
// either: Gmail and Outlook strip them. So the colour goes inline, on every
// anchor that doesn't already carry a style of its own.
function styleLinks(html: string) {
  return html.replace(/<a\b(?![^>]*\sstyle=)/gi, '<a style="color:#4F46E5;text-decoration:underline;"')
}

/**
 * `record` is how the send becomes measurable: Resend returns an id, and that
 * id is the only thing its delivery webhook carries that can find its way back
 * to a campaign. Optional, because one caller has no business recording
 * anything -- a "send test to me" would otherwise put the staff member's own
 * open into the campaign's open rate.
 *
 * Under `dryRun` everything up to the Resend call still runs -- the subject,
 * body and address checks, the merge -- and the message is recorded as a
 * dry_run row instead of sent. It used to ignore dry run entirely, so a rule
 * in test mode with an email step emailed real people.
 */
async function runEmailAction(
  recipient: Recipient,
  config: Record<string, any>,
  context?: MergeContext,
  record?: { supabase: any; accountId: string; ruleId?: string },
  dryRun = false,
  unsubscribe?: UnsubscribeLinks | null,
): Promise<'sent' | 'dry_run'> {
  const subject: string | undefined = config.subject
  const rawBody: string | undefined = config.body
  // These used to be silent returns. Every one of them is a reason an email
  // never arrived, and the caller now turns a thrown reason into something
  // the sender can read -- see the problems list in runForRecipient.
  if (!subject) throw new Error('The email action has no subject.')
  if (!rawBody) throw new Error('The email action has no body.')
  // Skipped rather than failed: retrying cannot give a lead an address.
  if (!recipient.email) throw new ActionSkipped('No email address to send to.')

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const mergePlain = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => recipientFieldValue(recipient, key, context))
  // rawBody is HTML produced by the account's own rich-text editor (bold/
  // italic/underline/link/image, no freeform tag entry -- its paste handler
  // strips markup rather than carrying it in), so unlike the plain
  // subject it's trusted and must NOT be escaped wholesale -- that would
  // turn every tag into literal text. Only the substituted variable values
  // (patient-controlled data) get escaped.
  const mergeHtml = (html: string) => html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(recipientFieldValue(recipient, key, context)))

  const runtimeConfig = useRuntimeConfig()
  // No key means nothing has ever been sent from this deployment. Silence
  // here reads exactly like a delivery failure, which is the harder thing to
  // diagnose of the two. A dry run does not need one, for the same reason a
  // WhatsApp dry run does not need Meta credentials: rehearsing before the
  // channel is set up is the order a clinic actually does things in.
  if (!dryRun && !runtimeConfig.resendApiKey) throw new Error('Email sending is not configured (no Resend API key on this deployment).')

  const html = automationEmailHtml(styleLinks(mergeHtml(rawBody)), { unsubscribe, clinicName: context?.clinicName })

  // Deliberately NOT `.catch(() => null)` any more. Resend refuses sends for
  // reasons that are entirely fixable and entirely invisible from here -- an
  // unverified sending domain, a key scoped to the wrong domain, a recipient
  // on the suppression list -- and each one used to end as a no-op with a
  // green tick on it. The caller decides what to do with the failure; a real
  // automated send still swallows it so one bad address can't halt a rule.
  const mergedSubject = mergePlain(subject)

  // Recorded where real emails are, so the patient's thread shows what would
  // have gone out. No provider id, because nothing reached the provider, and
  // flagged so the campaign metrics do not count it as a send.
  if (dryRun) {
    if (record) {
      const { error } = await record.supabase.from('email_messages').insert({
        account_id: record.accountId,
        provider_message_id: null,
        dry_run: true,
        rule_id: record.ruleId ?? null,
        patient_id: recipient.kind === 'patient' ? recipient.id : null,
        lead_id: recipient.kind === 'lead' ? recipient.id : null,
        recipient_email: recipient.email,
        subject: mergedSubject,
      })
      if (error) console.error(`[automations] could not record dry-run email: ${error.message}`)
    }
    return 'dry_run'
  }

  try {
    const sent = await $fetch<{ id?: string }>('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtimeConfig.resendApiKey}`, 'Content-Type': 'application/json' },
      body: {
        from: 'QuiroFlow <notifications@quiroflow.com>',
        to: recipient.email,
        subject: mergedSubject,
        html,
        ...(unsubscribe ? { headers: unsubscribeHeaders(unsubscribe) } : {}),
      },
    })

    // Best-effort, and deliberately after the send rather than around it: the
    // email has already gone by this point, and failing the action over a
    // bookkeeping row would make the caller believe it never sent and, on a
    // retry, send it twice.
    if (record && sent?.id) {
      const { error } = await record.supabase.from('email_messages').insert({
        account_id: record.accountId,
        provider_message_id: sent.id,
        rule_id: record.ruleId ?? null,
        patient_id: recipient.kind === 'patient' ? recipient.id : null,
        lead_id: recipient.kind === 'lead' ? recipient.id : null,
        recipient_email: recipient.email,
        subject: mergedSubject,
      })
      if (error) console.error(`[automations] could not record email ${sent.id}: ${error.message}`)
    }
  } catch (e: any) {
    // Resend answers a refusal with {name, message} in the body; the HTTP
    // status alone ("422") says nothing a person can act on.
    const detail = e?.data?.message || e?.data?.error?.message || e?.message || 'unknown error'
    throw new Error(`Resend rejected the email: ${detail}`)
  }
  return 'sent'
}

/**
 * Under dry run a webhook is not called at all. There is no "record instead"
 * for it: whatever is on the other end -- n8n, Zapier, the clinic's own
 * system -- does its own thing with the event, sending messages and writing
 * records we cannot see or take back, and that is exactly what test mode
 * promises will not happen. Nor can a flag in the payload stand in for it;
 * a receiver written before the flag existed would act on it anyway.
 */
async function runWebhookAction(config: Record<string, any>, body: TriggerBody, dryRun = false): Promise<'sent' | 'dry_run'> {
  const url: string | undefined = config.url
  if (!url) throw new Error('The webhook step has no URL.')

  if (dryRun) {
    console.info(`[automations] test mode: webhook not called for ${body.triggerEvent}`)
    return 'dry_run'
  }

  const payload = {
    event: body.triggerEvent,
    fired_at: new Date().toISOString(),
    data: { patient_id: body.patientId, appointment_id: body.appointmentId ?? null, invoice_id: body.invoiceId ?? null },
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-QuiroFlow-Event': body.triggerEvent }
  if (config.secret) {
    headers['X-QuiroFlow-Signature'] = createHmac('sha256', config.secret).update(JSON.stringify(payload)).digest('hex')
  }

  // Not swallowed any more: an endpoint that is down or refusing is exactly
  // what a sequence needs to know, to retry it and then say so. A rule that
  // runs straight through still carries on past it -- runForRecipient catches
  // per action.
  try {
    await $fetch(url, { method: 'POST', headers, body: payload, timeout: 10_000 })
  } catch (e: any) {
    const status = e?.response?.status ?? e?.statusCode
    throw new Error(`The webhook did not accept the call${status ? ` (HTTP ${status})` : ''}: ${e?.message ?? 'unknown error'}`)
  }
  return 'sent'
}
