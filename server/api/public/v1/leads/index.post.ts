import { toE164Loose } from '~/utils/phone'
import { ApiError, defineApiHandler, badRequest } from '~/server/utils/publicApi'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { bool, definedOnly, email as emailField, enumValue, integer, isoDateTime, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { LEAD_CHANNELS } from '~/server/utils/leads'
import { accountHasGrowth, fileLead, humanise, isQuestionKey, type Answer } from '~/server/utils/leadIngest'

// Where an enquiry gets in from outside.
//
// Built for the Meta lead-ads flow that lived in n8n until October 2026: a
// form submission arrives with a name, a phone, an email, the ad and ad set it
// came from, and the answers to whatever the clinic asked on the form. Meta
// lead ads now arrive through the leadgen webhook instead (a Page connected in
// Settings > Leads); this stays the door for everything else, and both file
// through server/utils/leadIngest.ts so nothing after the reading differs.
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

/**
 * The campaign, ad and cost, read and checked before anything is written.
 *
 * Absent is fine -- a form nobody paid to promote has none. Present has to be
 * right, because a 400 is only an honest answer if it wrote nothing: this was
 * checked after the lead was inserted, so a typo'd field got the caller a 400
 * while the lead stayed in the board with no timeline and no welcome drip,
 * and the corrected retry matched it by external_id and was "deduplicated"
 * past both.
 */
function readAttribution(body: Record<string, unknown>) {
  const raw = body.attribution
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest(`"attribution" must be an object with any of: ${ATTRIBUTION_FIELDS.join(', ')}.`, 'attribution')
  }
  const attr = raw as Record<string, unknown>
  rejectUnknownFields(attr, ATTRIBUTION_FIELDS)
  return definedOnly({
    campaign: str(attr, 'campaign', { max: 255 }),
    ad: str(attr, 'ad', { max: 255 }),
    audience: str(attr, 'audience', { max: 255 }),
    first_touch: str(attr, 'first_touch', { max: 255 }),
    last_touch: str(attr, 'last_touch', { max: 255 }),
    cost_cents: integer(attr, 'cost_cents', { min: 0 }),
  })
}

export default defineApiHandler({ scope: 'leads:write' }, async ({ event, supabase, accountId }) => {
  // The token proves who is calling; this proves the clinic bought the thing
  // being called. Checked before anything is read or written, so a lapsed
  // account gets one clear answer rather than a half-created lead.
  //
  // Refusing does mean enquiries are not captured while it is lapsed, which
  // is the cost of the add-on meaning anything. The status code says so
  // plainly -- an ad platform's retry log showing 402 is diagnosable; a
  // silent success that stores nothing is not.
  if (!(await accountHasGrowth(supabase, accountId))) {
    throw new ApiError('forbidden', 'Growth is not on this subscription, so leads cannot be captured. Add it under Billing.')
  }

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
  //
  // An instant, checked here: it dates the consent on the lead itself, so a
  // value the database cannot read would fail the insert as a 500.
  const occurredAtValue = isoDateTime(body, 'occurred_at')
  const consented = bool(body, 'marketing_consent') === true
  const consentSource = str(body, 'marketing_consent_source', { max: 120 })

  const externalId = str(body, 'external_id', { max: 255 })
  const externalSource = str(body, 'external_source', { max: 60 }) ?? (externalId ? 'facebook' : undefined)

  // Everything else the request carries, read now: after the insert, a
  // refusal would be a 400 on top of a lead that was kept.
  const channel = enumValue(body, 'channel', LEAD_CHANNELS) ?? 'facebook'
  const source = str(body, 'source', { max: 255 })
  // Cents, like every other money column. A lead that has not been
  // qualified has no meaningful estimate, and 0 would drag the stage
  // totals down as though it were worth nothing -- so it stays null.
  const estimatedValueCents = integer(body, 'estimated_value_cents', { min: 0 })
  // A caller may say the lead is already further along: a form that books
  // a slot arrives 'booked', not 'new'. The furthest_stage trigger fires
  // on INSERT, so the funnel counts it correctly either way.
  // Not the full ladder: an ingest caller may say the enquiry arrived
  // already booked, but 'converted' and 'lost' are outcomes the clinic
  // decides, not facts a form can assert about itself.
  const stage = enumValue(body, 'stage', ['new', 'contacted', 'qualified', 'booked'] as const)
  const attribution = readAttribution(body)
  const answers = readAnswers(body)

  let lead
  try {
    lead = await fileLead(
      supabase,
      accountId,
      {
        fullName,
        phone: normalisedPhone ?? undefined,
        email,
        clinicId,
        channel,
        source,
        estimatedValueCents,
        stage,
        externalId,
        externalSource,
        occurredAt: occurredAtValue,
        consented,
        consentSource,
        attribution,
        answers,
      },
      getRequestURL(event).origin,
      'public/v1/leads',
    )
  } catch (err) {
    throw new ApiError('server_error', (err as Error).message)
  }

  // A redelivery is answered 200 with the lead it already made, not 201:
  // nothing was created by this request.
  if (!lead.deduplicated) setResponseStatus(event, 201)
  return { data: lead }
})
