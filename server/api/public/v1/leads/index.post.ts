import { toE164Loose } from '~/utils/phone'
import { ApiError, defineApiHandler, badRequest } from '~/server/utils/publicApi'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { bool, definedOnly, email as emailField, enumValue, integer, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { LEAD_CHANNELS, nextLeadReference } from '~/server/utils/leads'
import { startLeadSequence } from '~/server/utils/leadSequences'

// Where an enquiry gets in from outside.
//
// Built for the Meta lead-ads flow that currently lives in n8n: a form
// submission arrives with a name, a phone, an email, the ad and ad set it
// came from, and the answers to whatever the clinic asked on the form. All
// four of those things have a home in the schema already, and this endpoint
// is the one door they come through.
//
// Three shapes of the same enquiry land in three tables, deliberately:
//   leads            -- the person, and where they are in the pipeline
//   lead_attribution -- what it cost and which campaign it came from, kept
//                       separate because ad platforms backfill it later
//   lead_events      -- the form answers, as a 'qualification' event, so the
//                       drawer shows what they actually said rather than the
//                       clinic reading it off Facebook

const FIELDS = [
  'full_name', 'first_name', 'last_name', 'phone', 'phone_country_code', 'email',
  'channel', 'source', 'clinic_id', 'estimated_value_cents', 'stage',
  'external_id', 'external_source', 'occurred_at', 'attribution', 'answers',
  'marketing_consent', 'marketing_consent_source',
]

const ATTRIBUTION_FIELDS = ['campaign', 'ad', 'audience', 'first_touch', 'last_touch', 'cost_cents']

interface Answer {
  question: string
  answer: string
}

/**
 * Field names an ad platform sends as part of the lead itself, rather than as
 * a question the clinic asked. Excluded from the derived answers so the
 * drawer does not show "Email: pablo@example.com" as though it were a
 * qualifying question. Matched case-insensitively and underscore-insensitively,
 * because platforms disagree about `phone_number` vs `phoneNumber`.
 */
const NOT_A_QUESTION = new Set([
  'firstname', 'lastname', 'fullname', 'name', 'email', 'phone', 'phonenumber',
  'city', 'country', 'zip', 'postalcode', 'street', 'state', 'province',
])

function isQuestionKey(key: string) {
  return !NOT_A_QUESTION.has(key.toLowerCase().replace(/[_\s-]/g, ''))
}

/**
 * Meta names a custom question by its own text, lowercased with underscores:
 * `¿cuál_sería_el_motivo_de_tu_visita?_(alguna_molestia...)`. Underscores back
 * to spaces is the whole transformation -- punctuation and accents stay,
 * because "¿Cuál sería el motivo de tu visita?" is the question the clinic
 * wrote and the front desk recognises.
 */
function humanise(key: string) {
  return key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function toAnswer(question: string, value: unknown, i: number): Answer | null {
  if (!question) throw badRequest(`"answers[${i}].question" is required.`, 'answers')
  // Arrays happen: a multi-select question answers with a list.
  const text = Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).join(', ') : value
  if (text === null || text === undefined || text === '') return null
  if (typeof text === 'object') return null
  return { question: question.slice(0, 500), answer: String(text).trim().slice(0, 2000) }
}

/**
 * The form's own questions, as asked. Not mapped onto columns: every clinic
 * asks different ones and changes them between campaigns, so a column per
 * question would be a migration per campaign. They are displayed, not queried.
 *
 * Two accepted shapes, because the caller usually does not know the questions
 * either:
 *
 *   [{ question, answer }]  -- when the sender knows what it asked
 *   { "<question>": "<answer>" }  -- the platform's raw field bag, e.g. Meta's
 *                                   `data` object passed straight through
 *
 * The object form is what makes this survive a new campaign: whatever
 * questions the next form asks arrive as new keys and are captured without
 * anyone editing a mapping. Known lead fields in that bag (name, email,
 * phone) are dropped rather than shown as questions.
 */
function readAnswers(body: Record<string, unknown>): Answer[] | undefined {
  const raw = body.answers
  if (raw === undefined || raw === null) return undefined

  if (Array.isArray(raw)) {
    if (raw.length > 50) throw badRequest('"answers" cannot hold more than 50 entries.', 'answers')
    return raw
      .map((entry, i) => {
        if (typeof entry !== 'object' || entry === null) {
          throw badRequest(`"answers[${i}]" must be an object with "question" and "answer".`, 'answers')
        }
        const item = entry as Record<string, unknown>
        const question = typeof item.question === 'string' ? item.question.trim() : ''
        return toAnswer(question, item.answer, i)
      })
      .filter((a): a is Answer => a !== null)
  }

  if (typeof raw === 'object') {
    const entries = Object.entries(raw as Record<string, unknown>).filter(([key]) => isQuestionKey(key))
    if (entries.length > 50) throw badRequest('"answers" cannot hold more than 50 entries.', 'answers')
    return entries
      .map(([key, value], i) => toAnswer(humanise(key), value, i))
      .filter((a): a is Answer => a !== null)
  }

  throw badRequest('"answers" must be an array of { question, answer } objects, or an object of question/answer pairs.', 'answers')
}

export default defineApiHandler({ scope: 'leads:write' }, async ({ event, supabase, accountId }) => {
  const body = await readApiBody(event)
  rejectUnknownFields(body, FIELDS)

  // Meta sends first and last separately, and so does every form builder.
  // Composing here rather than making each caller concatenate -- the column
  // is one field because a lead is a stranger, not because the name never
  // arrives in parts.
  const firstName = str(body, 'first_name', { max: 120 })
  const lastName = str(body, 'last_name', { max: 120 })
  const fullName = str(body, 'full_name', { max: 240 }) ?? [firstName, lastName].filter(Boolean).join(' ').trim()
  if (!fullName) {
    throw badRequest('Provide "full_name", or "first_name" and/or "last_name".', 'full_name')
  }

  const phone = str(body, 'phone', { max: 32 })
  // The account's own default, not a hardcoded 'ES'. This is an ISO code
  // ("ES"), which is what toE164 and patient_contact_numbers.country_code
  // both expect -- a dial string like "+34" silently matches no country and
  // makes every local number unreadable.
  const { data: account } = await loose(supabase).from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle()
  const phoneCountryCode = str(body, 'phone_country_code', { max: 8 }) ?? (account as { default_phone_country?: string } | null)?.default_phone_country ?? 'ES'
  const email = emailField(body, 'email')
  // A lead nobody can reach is not a lead. Rejecting it here rather than
  // storing a row that will sit in the board forever with no way to act on
  // it -- and the caller finds out at the moment it can still be fixed.
  if (!phone && !email) {
    throw badRequest('Provide "phone" and/or "email" — a lead with neither cannot be contacted.', 'phone')
  }
  const normalisedPhone = phone ? toE164Loose(phone, phoneCountryCode) : undefined
  if (phone && !normalisedPhone) {
    throw badRequest('"phone" could not be read as a phone number. Send it in E.164 form (+34612345678), or pass phone_country_code as a two-letter country ("ES") alongside a local number.', 'phone')
  }

  // Checked against this account before the insert, so a caller cannot
  // attach their lead to another clinic's record by guessing an id. The FK
  // alone would not catch that: it proves the row exists somewhere, not that
  // it is theirs.
  const clinicId = uuid(body, 'clinic_id')
  if (clinicId) await assertBelongsToAccount(supabase, 'clinics', clinicId, accountId, 'clinic_id')

  // Consent is stated, never inferred. A lead-ad form carries its own
  // consent text and the caller knows whether the person agreed; the
  // existence of a row is not evidence, and defaulting to true here would
  // make every hand-typed walk-in a marketing target. Absent means no
  // marketing -- it does not stop anyone answering the enquiry itself.
  const occurredAtValue = str(body, 'occurred_at')
  const consented = bool(body, 'marketing_consent') === true
  const consentSource = str(body, 'marketing_consent_source', { max: 120 })

  const externalId = str(body, 'external_id', { max: 255 })
  const externalSource = str(body, 'external_source', { max: 60 }) ?? (externalId ? 'facebook' : undefined)

  // Idempotency, not a conflict. Meta redelivers a leadgen webhook whenever
  // it does not get a clean 200 -- on a timeout, on a deploy, on its own
  // retry schedule -- and the redelivery is identical. A 409 would make the
  // caller's retry look like a failure it has to handle; returning the lead
  // it already created makes the retry a no-op, which is what a webhook
  // sender needs.
  if (externalId) {
    const { data: existing } = await loose(supabase)
      .from('leads')
      .select('id, reference, stage, created_at')
      .eq('account_id', accountId)
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .maybeSingle()

    if (existing) {
      return {
        data: {
          id: existing.id,
          reference: existing.reference,
          stage: existing.stage,
          created_at: existing.created_at,
          deduplicated: true,
        },
      }
    }
  }

  const insert = definedOnly({
    account_id: accountId,
    reference: await nextLeadReference(supabase, accountId),
    full_name: fullName,
    phone: normalisedPhone,
    email,
    clinic_id: clinicId,
    channel: enumValue(body, 'channel', LEAD_CHANNELS) ?? 'facebook',
    source: str(body, 'source', { max: 255 }),
    // Cents, like every other money column. A lead that has not been
    // qualified has no meaningful estimate, and 0 would drag the stage
    // totals down as though it were worth nothing -- so it stays null.
    estimated_value_cents: integer(body, 'estimated_value_cents', { min: 0 }),
    // A caller may say the lead is already further along: a form that books
    // a slot arrives 'booked', not 'new'. The furthest_stage trigger fires
    // on INSERT, so the funnel counts it correctly either way.
    // Not the full ladder: an ingest caller may say the enquiry arrived
    // already booked, but 'converted' and 'lost' are outcomes the clinic
    // decides, not facts a form can assert about itself.
    stage: enumValue(body, 'stage', ['new', 'contacted', 'qualified', 'booked'] as const),
    external_id: externalId,
    external_source: externalId ? externalSource : undefined,
    // Dated to when they actually agreed, which is when they submitted --
    // not when the webhook reached us, which can be minutes or hours later.
    marketing_consent_at: consented ? (occurredAtValue ?? new Date().toISOString()) : undefined,
    marketing_consent_source: consented ? (consentSource ?? externalSource ?? 'form') : undefined,
  })

  const { data: created, error } = await loose(supabase)
    .from('leads')
    .insert(insert as never)
    .select('id, reference, stage, created_at')
    .single()

  if (error) throw new ApiError('server_error', error.message)
  const lead = created as { id: string; reference: string; stage: string; created_at: string }

  // Attribution second, and non-fatally: an ad platform that knows the
  // campaign but not the cost still gives us a lead worth keeping, and a
  // failure here must not lose the enquiry itself.
  const attribution = body.attribution
  if (attribution && typeof attribution === 'object' && !Array.isArray(attribution)) {
    const attr = attribution as Record<string, unknown>
    rejectUnknownFields(attr, ATTRIBUTION_FIELDS)
    await loose(supabase).from('lead_attribution').insert({
      lead_id: lead.id,
      account_id: accountId,
      ...definedOnly({
        campaign: str(attr, 'campaign', { max: 255 }),
        ad: str(attr, 'ad', { max: 255 }),
        audience: str(attr, 'audience', { max: 255 }),
        first_touch: str(attr, 'first_touch', { max: 255 }),
        last_touch: str(attr, 'last_touch', { max: 255 }),
        cost_cents: integer(attr, 'cost_cents', { min: 0 }),
      }),
    } as never)
  }

  const answers = readAnswers(body)

  await loose(supabase).from('lead_events').insert({
    account_id: accountId,
    lead_id: lead.id,
    kind: answers?.length ? 'qualification' : 'form',
    title: answers?.length ? 'Submitted the form' : 'Enquiry received',
    detail: str(body, 'source', { max: 255 }) ?? null,
    body: answers?.length ? { answers } : null,
    // When it happened, which is not when we heard about it: an ad platform
    // can deliver a submission minutes late, and the drawer's timeline has
    // to read in the order the patient experienced it.
    ...definedOnly({ occurred_at: occurredAtValue }),
  } as never)

  // Any enabled lead.created sequence starts now, in the same request. Not
  // left to the cron: the first message of a welcome drip is the one whose
  // timing matters -- "within a minute of enquiring" is the product promise,
  // and a 15-minute tick would make it "within a quarter of an hour".
  //
  // Deliberately after the lead, its attribution and its answers are all
  // committed, and deliberately non-fatal: a rule that throws must not lose
  // the enquiry itself, which is the thing that cannot be recovered.
  try {
    const { data: rules } = await loose(supabase)
      .from('automation_rules')
      .select('id')
      .eq('account_id', accountId)
      .eq('trigger_event', 'lead.created')
      .eq('enabled', true)

    for (const rule of (rules ?? []) as { id: string }[]) {
      await startLeadSequence(supabase, accountId, rule.id, lead.id, getRequestURL(event).origin)
    }
  } catch (err) {
    console.error('[public/v1/leads] lead.created sequence failed to start:', (err as Error)?.message ?? err)
  }

  setResponseStatus(event, 201)
  return {
    data: {
      id: lead.id,
      reference: lead.reference,
      stage: lead.stage,
      created_at: lead.created_at,
      deduplicated: false,
    },
  }
})
