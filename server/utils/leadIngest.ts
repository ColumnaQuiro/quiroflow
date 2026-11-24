import { loose } from '~/server/utils/publicApiHandlers'
import { definedOnly } from '~/server/utils/publicApiBody'
import { insertLead, type LEAD_CHANNELS } from '~/server/utils/leads'
import { sequenceRunForSamePerson, startLeadSequence } from '~/server/utils/automationEngine'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { FOLD_WINDOW_DAYS, whatsAppLeadToFoldInto, type FoldCandidate } from '~/utils/leadFold'
import { rulesForRaisedEvent } from '~/server/utils/automationAtomRules'

// Filing an enquiry, once it has been read and checked.
//
// Two doors lead here. POST /api/public/v1/leads is the API's, for anything
// that can call it -- a booking widget, a clinic's own form, and until
// October 2026 the n8n workflow that relayed Columnaquiro's Facebook lead
// ads. The leadgen webhook is the other: Meta tells us about a submission on
// a Page a clinic connected, and we fetch and file it ourselves. They read
// their input in completely different ways, and nothing after that point may
// differ between them -- the same dedupe, the same consent rule, the same
// drip and the same alert -- so this is the one place it happens.

export interface Answer {
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

export function isQuestionKey(key: string) {
  return !NOT_A_QUESTION.has(key.toLowerCase().replace(/[_\s-]/g, ''))
}

/**
 * Meta names a custom question by its own text, lowercased with underscores:
 * `¿cuál_sería_el_motivo_de_tu_visita?_(alguna_molestia...)`. Underscores back
 * to spaces is the whole transformation -- punctuation and accents stay,
 * because "¿Cuál sería el motivo de tu visita?" is the question the clinic
 * wrote and the front desk recognises.
 */
export function humanise(key: string) {
  return key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Whether the clinic has Growth, without which a lead is not captured at all. */
export async function accountHasGrowth(supabase: any, accountId: string): Promise<boolean> {
  const { data: subscription } = await loose(supabase)
    .from('subscriptions')
    .select('plan_id, growth_addon, status, comped')
    .eq('account_id', accountId)
    .maybeSingle()
  return hasGrowth(subscription as never)
}

export interface LeadToFile {
  fullName: string
  /** Already E.164. Normalising is the caller's job: it knows the country. */
  phone?: string
  email?: string
  clinicId?: string
  channel: (typeof LEAD_CHANNELS)[number]
  source?: string
  estimatedValueCents?: number
  stage?: 'new' | 'contacted' | 'qualified' | 'booked'
  externalId?: string
  externalSource?: string
  /** When the person submitted, which is not when we heard about it. */
  occurredAt?: string
  consented: boolean
  consentSource?: string
  attribution?: Record<string, string | number | undefined>
  answers?: Answer[]
}

export interface FiledLead {
  id: string
  reference: string
  stage: string
  created_at: string
  deduplicated: boolean
}

/**
 * Files the lead and everything that follows from it, and returns it.
 *
 * Throws only when the lead itself could not be saved. Everything after the
 * insert is logged rather than thrown -- see the comment there.
 *
 * `origin` is the app's own URL, which the drip needs for links it sends.
 */
export async function fileLead(supabase: any, accountId: string, lead: LeadToFile, origin: string, logTag = 'leads'): Promise<FiledLead> {
  const externalSource = lead.externalId ? lead.externalSource : undefined

  // Idempotency, not a conflict. Meta redelivers a leadgen webhook whenever
  // it does not get a clean 200 -- on a timeout, on a deploy, on its own
  // retry schedule -- and the redelivery is identical. Returning the lead it
  // already created makes the retry a no-op, which is what a webhook sender
  // needs. It is also what lets two senders of the SAME submission overlap
  // safely: the n8n relay and the leadgen webhook both use Meta's lead id, so
  // during a cutover whichever arrives second is told "deduplicated".
  async function alreadyFiled(): Promise<FiledLead | null> {
    if (!lead.externalId) return null
    const { data: existing } = await loose(supabase)
      .from('leads')
      .select('id, reference, stage, created_at')
      .eq('account_id', accountId)
      .eq('external_source', externalSource)
      .eq('external_id', lead.externalId)
      .maybeSingle()
    if (!existing) return null
    return { id: existing.id, reference: existing.reference, stage: existing.stage, created_at: existing.created_at, deduplicated: true }
  }

  const existing = await alreadyFiled()
  if (existing) return existing

  // The person may already be a lead: an ad form that ends in WhatsApp has
  // them write before the form reaches us (utils/leadFold.ts). Filed onto
  // that lead instead, everything below -- attribution, answers, alert --
  // lands where the conversation is, and the receptionist reads it as an ad
  // lead.
  const folded = await foldIntoWhatsAppLead()
  if (folded === 'raced') {
    const raced = await alreadyFiled()
    if (raced) return raced
  }
  const onto = folded && folded !== 'raced' ? folded : null
  const created = onto ? null : await insertNew()
  if (created?.deduplicated) return created
  const filed = (onto ?? created)!

  async function foldIntoWhatsAppLead(): Promise<(FiledLead & { aiHandling: boolean }) | 'raced' | null> {
    if (!lead.phone) return null
    const since = new Date(Date.now() - FOLD_WINDOW_DAYS * 86_400_000).toISOString()
    const { data: candidates, error: readError } = await loose(supabase)
      .from('leads')
      .select('id, reference, phone, stage, patient_id, external_source, ai_state, created_at, email, clinic_id')
      .eq('account_id', accountId)
      .eq('external_source', 'whatsapp')
      .is('deleted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
    if (readError) {
      console.error(`[${logTag}] could not look for a WhatsApp lead to file the form onto:`, readError.message)
      return null
    }
    type Candidate = FoldCandidate & { reference: string; ai_state: string | null; email: string | null; clinic_id: string | null }
    const match = whatsAppLeadToFoldInto((candidates ?? []) as Candidate[], lead.phone)
    if (!match) return null

    // Only what the WhatsApp message could not have told us. The name is the
    // one they typed into the form, not their WhatsApp profile's ("Vic" was
    // greeted instead of the "victoria" she wrote). Channel and stage stay:
    // the conversation is on WhatsApp, and they have already written. The
    // external id becomes the form's, so Meta redelivering it finds this
    // lead; their next message still finds it by its number.
    const update = definedOnly({
      full_name: lead.fullName,
      email: match.email ? undefined : lead.email,
      clinic_id: match.clinic_id ? undefined : lead.clinicId,
      source: lead.source,
      estimated_value_cents: lead.estimatedValueCents,
      external_id: lead.externalId,
      external_source: externalSource,
      marketing_consent_at: lead.consented ? (lead.occurredAt ?? new Date().toISOString()) : undefined,
      marketing_consent_source: lead.consented ? (lead.consentSource ?? externalSource ?? 'form') : undefined,
    })
    // Only while it is still a WhatsApp lead: a second delivery of this form
    // arriving at the same moment finds it already filed, and is the
    // redelivery.
    const { data: updated, error } = await loose(supabase)
      .from('leads')
      .update(update as never)
      .eq('id', match.id)
      .eq('external_source', 'whatsapp')
      .select('id')
    if (error) {
      console.error(`[${logTag}] could not file the form onto WhatsApp lead`, match.id, error.message)
      return null
    }
    if (!(updated ?? []).length) return 'raced'
    await loose(supabase).from('lead_events').insert({
      account_id: accountId,
      lead_id: match.id,
      kind: 'note',
      title: 'Form joined to this conversation',
      detail: 'They filled in the form and wrote on WhatsApp: one lead, not two.',
    } as never)
    return { id: match.id, reference: match.reference, stage: match.stage, created_at: match.created_at, deduplicated: false, aiHandling: match.ai_state === 'handling' }
  }

  async function insertNew(): Promise<FiledLead> {
    const insert = definedOnly({
      full_name: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      clinic_id: lead.clinicId,
      channel: lead.channel,
      source: lead.source,
      estimated_value_cents: lead.estimatedValueCents,
      stage: lead.stage,
      external_id: lead.externalId,
      external_source: externalSource,
      // Dated to when they actually agreed, which is when they submitted --
      // not when the webhook reached us, which can be minutes or hours later.
      marketing_consent_at: lead.consented ? (lead.occurredAt ?? new Date().toISOString()) : undefined,
      marketing_consent_source: lead.consented ? (lead.consentSource ?? externalSource ?? 'form') : undefined,
      // Handed to the receptionist when the clinic has switched it on.
      //
      // Leads have always been created 'none', and the only thing that ever
      // changed that is a button in the Inbox. So the tick that drafts replies
      // -- which looks for 'handling' -- had nothing to do on any lead in any
      // clinic, while the switch said the receptionist reads real enquiries.
      // This is what makes that switch true.
      ai_state: (await receptionistHandlesNewLeads(supabase, accountId)) ? 'handling' : undefined,
    })

    const { data: created, error } = await insertLead(supabase, accountId, insert as never, 'id, reference, stage, created_at')

    if (error) {
      // The same submission delivered twice at once: both passed the check
      // above, and the unique index let exactly one of them in. That one is
      // the lead, and this request is the redelivery.
      if (error.code === '23505') {
        const raced = await alreadyFiled()
        if (raced) return raced
      }
      throw new Error(error.message)
    }
    return { ...(created as { id: string; reference: string; stage: string; created_at: string }), deduplicated: false }
  }

  // From here on the lead exists, and nothing may turn that into an error:
  // the caller would retry, meet the lead by external_id and be told
  // "deduplicated", and whatever was skipped here would never happen -- or,
  // with no external_id, the retry would file the enquiry twice. So the
  // attribution and the timeline entry are logged when they fail rather than
  // thrown, and the drip and the notification below run regardless.
  //
  // Attribution second: an ad platform that knows the campaign but not the
  // cost still gives us a lead worth keeping.
  const attribution = lead.attribution ? definedOnly(lead.attribution) : undefined
  if (attribution && Object.keys(attribution).length > 0) {
    const { error: attributionError } = await loose(supabase).from('lead_attribution').insert({
      lead_id: filed.id,
      account_id: accountId,
      ...attribution,
    } as never)
    if (attributionError) {
      console.error(`[${logTag}] attribution was not saved for lead`, filed.id, attributionError.message)
    }
  }

  const answers = lead.answers
  const { error: eventError } = await loose(supabase).from('lead_events').insert({
    account_id: accountId,
    lead_id: filed.id,
    kind: answers?.length ? 'qualification' : 'form',
    title: answers?.length ? 'Submitted the form' : 'Enquiry received',
    detail: lead.source ?? null,
    body: answers?.length ? { answers } : null,
    // When it happened, which is not when we heard about it: an ad platform
    // can deliver a submission minutes late, and the drawer's timeline has
    // to read in the order the patient experienced it.
    ...definedOnly({ occurred_at: lead.occurredAt }),
  } as never)
  if (eventError) {
    console.error(`[${logTag}] the enquiry was not added to the timeline of lead`, filed.id, eventError.message)
  }

  // Any enabled lead.created sequence starts now, in the same request. Not
  // left to the cron: the first message of a welcome drip is the one whose
  // timing matters -- "within a minute of enquiring" is the product promise,
  // and a 15-minute tick would make it "within a quarter of an hour".
  //
  // Deliberately after the lead, its attribution and its answers are all
  // committed, and deliberately non-fatal: a rule that throws must not lose
  // the enquiry itself, which is the thing that cannot be recovered.
  try {
    const rules = await rulesForRaisedEvent(loose(supabase), accountId, 'lead.created')

    for (const rule of rules) {
      // One voice per person. Somebody the receptionist is already talking
      // to on WhatsApp does not also get the welcome drip: the two wrote over
      // each other, the drip welcoming at 9:00 somebody offered times at
      // midnight, neither seeing the other (22 Nov 2026). Where the
      // receptionist is off, the drip is the only one writing, and starts.
      if (onto?.aiHandling) {
        await loose(supabase).from('lead_events').insert({
          account_id: accountId,
          lead_id: filed.id,
          kind: 'note',
          title: 'Automation not started',
          detail: `"${rule.name ?? 'Automation'}" did not start: the AI receptionist is already answering them on WhatsApp.`,
        } as never)
        continue
      }
      // The same person filling in the form again is a second lead, kept --
      // but not a second copy of a drip they are already part-way through.
      // Said on the new lead's timeline, so nobody wonders why it got nothing.
      const already = await sequenceRunForSamePerson(supabase, accountId, rule.id, { id: filed.id, phone: lead.phone, email: lead.email })
      if (already) {
        await loose(supabase).from('lead_events').insert({
          account_id: accountId,
          lead_id: filed.id,
          kind: 'note',
          title: 'Automation not started again',
          detail: `"${rule.name ?? 'Automation'}" is already running for this person as ${already.reference ?? 'another lead'}.`,
        } as never)
        continue
      }
      await startLeadSequence(supabase, accountId, rule.id, filed.id, origin)
    }
  } catch (err) {
    console.error(`[${logTag}] lead.created sequence failed to start:`, (err as Error)?.message ?? err)
  }

  // After the sequence, and non-fatal for the same reason: the drip answers
  // the lead, this tells the clinic, and neither is worth losing the enquiry
  // over. Deliberately not inside the try above -- a rule that throws must
  // not also silence the notification.
  try {
    await notifyStaffOfNewLead(supabase, accountId, filed.id)
  } catch (err) {
    console.error(`[${logTag}] new lead notification failed:`, (err as Error)?.message ?? err)
  }

  return { id: filed.id, reference: filed.reference, stage: filed.stage, created_at: filed.created_at, deduplicated: false }
}
