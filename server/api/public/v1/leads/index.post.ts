import { toE164Loose } from '~/utils/phone'
import { ApiError, defineApiHandler, badRequest } from '~/server/utils/publicApi'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { definedOnly, email as emailField, enumValue, integer, readApiBody, rejectUnknownFields, str, uuid } from '~/server/utils/publicApiBody'
import { LEAD_CHANNELS, nextLeadReference } from '~/server/utils/leads'

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
]

const ATTRIBUTION_FIELDS = ['campaign', 'ad', 'audience', 'first_touch', 'last_touch', 'cost_cents']

interface Answer {
  question: string
  answer: string
}

/**
 * The form's own questions, as asked. Not mapped onto columns: every clinic
 * asks different ones and changes them between campaigns, so a column per
 * question would be a migration per campaign. They are displayed, not
 * queried.
 */
function readAnswers(body: Record<string, unknown>): Answer[] | undefined {
  const raw = body.answers
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw badRequest('"answers" must be an array of { question, answer } objects.', 'answers')
  if (raw.length > 50) throw badRequest('"answers" cannot hold more than 50 entries.', 'answers')

  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw badRequest(`"answers[${i}]" must be an object with "question" and "answer".`, 'answers')
    }
    const item = entry as Record<string, unknown>
    const question = typeof item.question === 'string' ? item.question.trim() : ''
    const answer = typeof item.answer === 'string' ? item.answer.trim() : ''
    if (!question) throw badRequest(`"answers[${i}].question" is required.`, 'answers')
    return { question: question.slice(0, 500), answer: answer.slice(0, 2000) }
  })
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
  const occurredAt = str(body, 'occurred_at')

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
    ...definedOnly({ occurred_at: occurredAt }),
  } as never)

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
