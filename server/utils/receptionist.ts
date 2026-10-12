import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { audienceSection, offeredAppointmentTypes, offeredTypesSection, rescheduleSection, type BookedVisit, type PromptType, type ReceptionistAudience } from '~/utils/receptionistTypes'
import { leadOriginSection, type LeadOrigin } from '~/utils/receptionistLeadOrigin'
import { CONFIDENTIALITY_SECTION, promptSafeName } from '~/utils/receptionistGuard'
import {
  receptionistBookingSection,
  receptionistClockSection,
  receptionistSlotGroups,
  type ReceptionistAvailability,
  type SlotBlock,
  type SlotType,
} from '~/utils/receptionistSlots'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import type { BusinessHours } from '~/utils/businessHours'
import { hasGrowth } from '~/server/utils/requireGrowth'

export type { LeadOrigin }

// Shared shape and defaults for the AI receptionist's configuration, plus the
// system prompt built from it.

export interface KnowledgeCard {
  id: string
  title: string
  lines: string[]
  footnote?: string
}

export interface EscalationRule {
  rule: string
  action: string
}

export interface ReceptionistConfig {
  enabled: boolean
  personaName: string
  languages: string[]
  tone: string
  neverSays: string
  knowledge: KnowledgeCard[]
  qualificationQuestions: string[]
  escalationRules: EscalationRule[]
  bookingWindowDays: number
  minimumNoticeMinutes: number
  slotsPerReply: number
  bookableAppointmentTypeIds: string[]
  afterHours: boolean
  missedCallTextBack: boolean
  answerDuringHours: boolean
}

/** The clinic's chosen tone, as an instruction. Shared with review replies
 * so the two voices are the same voice. */
export function toneWording(tone: string) {
  return TONE_WORDING[tone] ?? TONE_WORDING.warm_brief!
}

const TONE_WORDING: Record<string, string> = {
  warm_brief: 'Courteous and brief. Two or three sentences at most.',
  clinical: 'Precise and clinical. No small talk.',
  chatty: 'Friendly and conversational.',
  formal: 'Formal Spanish, addressing the patient as "usted".',
}

/**
 * Reads the account's config, creating the default row on first use.
 *
 * The default row has enabled=false. A receptionist that started answering
 * patients because somebody opened the settings screen would be the worst
 * failure this feature could have.
 */
export async function loadReceptionistConfig(supabase: SupabaseClient<Database>, accountId: string): Promise<ReceptionistConfig> {
  const { data } = await supabase.from('receptionist_config').select('*').eq('account_id', accountId).maybeSingle()

  if (!data) {
    await supabase.from('receptionist_config').insert({ account_id: accountId }).select('account_id').maybeSingle()
    const { data: created } = await supabase.from('receptionist_config').select('*').eq('account_id', accountId).maybeSingle()
    if (created) return toConfig(created)
    // The insert can be refused by RLS for a member without the Growth
    // permission. Reading defaults is still correct for them.
    return toConfig(null)
  }

  return toConfig(data)
}

type Row = Database['public']['Tables']['receptionist_config']['Row']

export function toConfig(row: Row | null): ReceptionistConfig {
  return {
    enabled: row?.enabled ?? false,
    personaName: row?.persona_name ?? 'Alba',
    languages: row?.languages ?? ['es', 'en'],
    tone: row?.tone ?? 'warm_brief',
    neverSays: row?.never_says ?? '',
    knowledge: (row?.knowledge as KnowledgeCard[] | null) ?? [],
    qualificationQuestions: (row?.qualification_questions as string[] | null) ?? [],
    escalationRules: (row?.escalation_rules as EscalationRule[] | null) ?? [],
    bookingWindowDays: row?.booking_window_days ?? 14,
    minimumNoticeMinutes: row?.minimum_notice_minutes ?? 120,
    slotsPerReply: row?.slots_per_reply ?? 2,
    bookableAppointmentTypeIds: row?.bookable_appointment_type_ids ?? [],
    afterHours: row?.after_hours ?? true,
    missedCallTextBack: row?.missed_call_text_back ?? true,
    answerDuringHours: row?.answer_during_hours ?? false,
  }
}

/** A type as the prompt and the settings screen name it. */
export interface OfferedType extends PromptType {
  id: string
}

/**
 * The appointment types this account's receptionist may offer, read at the
 * moment of use. See utils/receptionistTypes.ts for what an empty list means
 * and why archived types are filtered here rather than when archived.
 *
 * Fails closed: if the types cannot be read, the answer is "none", and the
 * prompt then tells the model to hand booking to a colleague. Offering a type
 * the clinic has since archived or withheld is the failure this exists to
 * prevent, so an unreadable list must not turn into an unrestricted one.
 */
export async function loadOfferedTypes(supabase: SupabaseClient<Database>, accountId: string, config: ReceptionistConfig): Promise<OfferedType[]> {
  const { data, error } = await readAccountTypes(supabase, accountId)
  if (error) {
    console.error('[receptionist] could not read appointment types:', error.message)
    return []
  }
  return offeredAppointmentTypes(data ?? [], config.bookableAppointmentTypeIds).map(toOfferedType)
}

/** Every type the account has, archived included, for callers that filter. */
export function readAccountTypes(supabase: SupabaseClient<Database>, accountId: string) {
  return supabase
    .from('appointment_types')
    .select('id, name, duration_minutes, archived_at, sort_order, stage, online_bookable_by')
    .eq('account_id', accountId)
}

/**
 * What the settings screen needs to edit the list: the clinic's active types
 * in its own order, and the ones the receptionist offers right now -- the
 * latter computed by the same function the prompt uses, so the screen cannot
 * describe a list the drafts are not given.
 *
 * Unlike loadOfferedTypes this throws: a settings screen that cannot read the
 * types should say so, not show an editor with nothing in it.
 */
export async function loadTypeChoices(supabase: SupabaseClient<Database>, accountId: string, config: ReceptionistConfig) {
  const { data, error } = await readAccountTypes(supabase, accountId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  const rows = data ?? []
  return {
    appointmentTypes: offeredAppointmentTypes(rows, []).map(toOfferedType),
    offeredTypes: offeredAppointmentTypes(rows, config.bookableAppointmentTypeIds).map(toOfferedType),
  }
}

/**
 * The visits a patient has booked from now on, and their types -- what the
 * receptionist offers new times for when they want to move one. The types
 * are returned whatever the receptionist's own list says: moving a visit
 * keeps its type, and a clinic that offers only first visits to new people
 * still has patients moving their adjustment.
 */
export async function loadBookedVisits(supabase: SupabaseClient<Database>, accountId: string, patientId: string | null): Promise<{ visits: BookedVisit[]; types: OfferedType[] }> {
  if (!patientId) return { visits: [], types: [] }
  const { data, error } = await supabase
    .from('appointments')
    .select('starts_at, appointment_types(id, name, duration_minutes, stage, online_bookable_by)')
    .eq('account_id', accountId)
    .eq('patient_id', patientId)
    .eq('status', 'booked')
    .is('deleted_at', null)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(3)
  if (error) {
    console.error('[receptionist] could not read booked visits:', error.message)
    return { visits: [], types: [] }
  }
  const rows = (data ?? []) as unknown as { starts_at: string; appointment_types: { id: string; name: string; duration_minutes: number; stage: string | null; online_bookable_by: string | null } | null }[]
  const types = new Map<string, OfferedType>()
  for (const row of rows) if (row.appointment_types) types.set(row.appointment_types.id, toOfferedType(row.appointment_types))
  return { visits: rows.map((row) => ({ startsAt: row.starts_at, typeName: row.appointment_types?.name ?? null })), types: [...types.values()] }
}

/** Each type once, the first seen kept: the calendar and the tool list a type once. */
export function uniqueTypes(...lists: OfferedType[][]): OfferedType[] {
  const seen = new Map<string, OfferedType>()
  for (const type of lists.flat()) if (!seen.has(type.id)) seen.set(type.id, type)
  return [...seen.values()]
}

function toOfferedType(type: { id: string; name: string; duration_minutes: number; stage?: string | null; online_bookable_by?: string | null }): OfferedType {
  return { id: type.id, name: type.name, durationMinutes: type.duration_minutes, stage: type.stage ?? null, bookableBy: type.online_bookable_by ?? null }
}

/** What the prompt knows about the clinic's calendar at the moment of drafting. */
export interface ReceptionistCalendar {
  now: Date
  /** The clinic's zone, for "now". The first clinic's when there are several. */
  timeZone: string
  /** Null when the free times could not be computed: the prompt then offers none. */
  availability: ReceptionistAvailability | null
}

/**
 * Reads the calendar and computes the times the receptionist may offer.
 *
 * `supabase` must be the SERVICE-ROLE client. Appointments are row-scoped by
 * calendar_scope, so a member who sees only their own diary would read every
 * colleague's visits as free time -- and offer it. Only start and end times
 * leave this function, and only for `accountId`, which the caller has already
 * established is the caller's.
 *
 * Practitioners are those the clinic publishes to online booking
 * (online_booking_enabled, on by default): switching somebody off there is
 * how a clinic says patients do not pick them, and a prospective patient
 * offered their time would be offered something a colleague then takes back.
 *
 * Fails closed. Any read that fails, a list too long to read, or nothing to
 * compute from (see receptionistSlotGroups) gives availability null, and the
 * prompt falls back to asking when suits and handing the time to a colleague.
 * A partial calendar would be worse than none: a missing appointment reads as
 * a free slot.
 */
export async function loadReceptionistCalendar(
  supabase: SupabaseClient<Database>,
  accountId: string,
  config: ReceptionistConfig,
  offeredTypes: OfferedType[],
  now = new Date(),
  // A later stretch than the configured window, for the find_free_times
  // tool: `days` from `from`, the minimum notice still counted from now.
  window?: { from: Date; days: number; maxTimesPerList?: number },
): Promise<ReceptionistCalendar> {
  const fallback = (timeZone = DEFAULT_CLINIC_TIMEZONE): ReceptionistCalendar => ({ now, timeZone, availability: null })

  const { data: clinics, error: clinicError } = await supabase
    .from('clinics')
    .select('id, name, timezone, business_hours, created_at')
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('created_at')
  if (clinicError) {
    console.error('[receptionist] could not read clinics:', clinicError.message)
    return fallback()
  }
  const timeZone = clinics?.[0]?.timezone || DEFAULT_CLINIC_TIMEZONE
  if (!clinics?.length || offeredTypes.length === 0) return fallback(timeZone)

  try {
    const start = window && window.from > now ? window.from : now
    const windowDays = window?.days ?? config.bookingWindowDays
    const from = start.toISOString()
    // A day past the window: the last day's slots end after its last start.
    const to = new Date(start.getTime() + (windowDays + 1) * 86400000).toISOString()
    const [practitioners, overrides, appointments, blocks] = await Promise.all([
      supabase
        .from('team_members')
        .select('id, business_hours, team_member_clinics(clinic_id)')
        .eq('account_id', accountId)
        .eq('is_practitioner', true)
        .eq('online_booking_enabled', true)
        .is('deleted_at', null)
        .then(must),
      supabase
        .from('appointment_type_overrides')
        .select('appointment_type_id, team_member_id, duration_minutes')
        .eq('account_id', accountId)
        .in('appointment_type_id', offeredTypes.map((type) => type.id))
        .then(must),
      // Every clinic's: a practitioner who works at two is busy here while
      // seeing somebody at the other.
      readAll((range) =>
        supabase
          .from('appointments')
          .select('id, practitioner_id, starts_at, ends_at')
          .eq('account_id', accountId)
          .is('deleted_at', null)
          .neq('status', 'cancelled')
          .lt('starts_at', to)
          .gt('ends_at', from)
          .order('id')
          .range(range.from, range.to),
      ),
      readAll((range) =>
        supabase
          .from('availability_blocks')
          .select('id, clinic_id, practitioner_id, starts_at, ends_at')
          .eq('account_id', accountId)
          .lt('starts_at', to)
          .gt('ends_at', from)
          .order('id')
          .range(range.from, range.to),
      ),
    ])

    const types: SlotType[] = offeredTypes.map((type) => ({
      ...type,
      durationByPractitioner: Object.fromEntries(
        overrides.filter((o) => o.appointment_type_id === type.id && o.duration_minutes).map((o) => [o.team_member_id, o.duration_minutes!]),
      ),
    }))

    const availability = receptionistSlotGroups({
      now,
      clinics: clinics.map((c) => ({ id: c.id, name: c.name, timeZone: c.timezone, businessHours: c.business_hours as BusinessHours | null })),
      practitioners: practitioners.map((p) => ({
        id: p.id,
        businessHours: p.business_hours as BusinessHours | null,
        clinicIds: (p.team_member_clinics ?? []).map((tmc) => tmc.clinic_id),
      })),
      types,
      appointments: appointments.map((a) => ({ practitionerId: a.practitioner_id, starts_at: a.starts_at, ends_at: a.ends_at })),
      blocks: blocks.map((b): SlotBlock => ({ clinicId: b.clinic_id, practitionerId: b.practitioner_id, starts_at: b.starts_at, ends_at: b.ends_at })),
      bookingWindowDays: windowDays,
      minimumNoticeMinutes: config.minimumNoticeMinutes,
      from: window?.from,
      maxTimesPerList: window?.maxTimesPerList,
    })
    return { now, timeZone, availability }
  } catch (err) {
    console.error('[receptionist] could not compute free times:', (err as Error)?.message ?? err)
    return fallback(timeZone)
  }
}

function must<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message)
  return result.data ?? []
}

/**
 * Every row, past PostgREST's max_rows (1000 here). A busy clinic over a
 * 90-day window passes it, and a list cut short at the cap would turn every
 * appointment after it into a free slot. Advances by what each page actually
 * returned, so a server cap lower than the page asked for still reads
 * everything; an empty page ends it.
 */
async function readAll<T>(page: (range: { from: number; to: number }) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000
  const MAX_ROWS = 20000
  const rows: T[] = []
  for (;;) {
    const batch = must(await page({ from: rows.length, to: rows.length + PAGE - 1 }))
    if (batch.length === 0) return rows
    rows.push(...batch)
    if (rows.length > MAX_ROWS) throw new Error(`more than ${MAX_ROWS} rows`)
  }
}

/**
 * Builds the system prompt from the config.
 *
 * Every constraint the clinic set is stated as a rule the model must follow,
 * and the guardrails come last so they are the most recent thing in the
 * prompt. Note what is NOT delegated to the model: it offers times from a
 * list computed here, never confirms a booking. Writing to the calendar is
 * the booking code's job, and a model that believes it booked something will
 * say so to a patient -- and a listed time can be taken between this draft
 * and a person sending it.
 */
export function buildSystemPrompt(
  config: ReceptionistConfig,
  opts: {
    testMode: boolean
    /** Already narrowed to this person (typesForAudience). */
    offeredTypes: PromptType[]
    /** The ad's first-visit offer, for someone not known to come from the ad. */
    adOnlyTypes?: PromptType[]
    audience?: ReceptionistAudience
    calendar: ReceptionistCalendar
    leadOrigin?: LeadOrigin | null
    /** Whether the find_free_times tool is on this request. */
    searchTool?: boolean
    /** Visits they already have, which they may want to move. */
    bookedVisits?: BookedVisit[]
    /** A real draft for staff to send, to this person (not Try Alba). */
    draft?: { personName: string | null }
  },
) {
  const personName = promptSafeName(opts.draft?.personName)
  const adOnly = opts.adOnlyTypes ?? []
  const knowledge = config.knowledge
    .map((card) => `## ${card.title}\n${card.lines.map((line) => `- ${line}`).join('\n')}`)
    .join('\n\n')

  const questions = config.qualificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  const escalations = config.escalationRules.map((rule) => `- ${rule.rule} -> ${rule.action}`).join('\n')
  // Only when there are types to offer: with none, the types section already
  // says booking goes to a colleague, and a list would contradict it.
  // Times are listed when there is something to book or a visit to move.
  const hasTimes = Boolean(opts.offeredTypes.length || adOnly.length || opts.bookedVisits?.length)
  const availability = hasTimes ? opts.calendar.availability : null

  return [
    `You are ${config.personaName}, the receptionist for a chiropractic clinic. You answer enquiries from prospective patients.`,
    `Tone: ${TONE_WORDING[config.tone] ?? TONE_WORDING.warm_brief}`,
    // Whatever the tone, an opener like "¡Perfecto!" is what makes a reply
    // read as a bot, and it is the first thing an owner trying Alba notices.
    `Sound like an experienced clinic receptionist: neutral, professional, to the point. Do not open with an exclamation or filler ("¡Perfecto!", "¡Genial!", "¡Estupendo!", "¡Claro que sí!", "Great!", "Perfect!"), do not use emojis, and do not praise the patient's question. Start with the substance.`,
    // "Un compañero" is how a call centre talks about whoever is next in the
    // queue; a receptionist hands you to someone she works with.
    `When something goes to a member of staff, speak of them as your own colleague: in Spanish "mi compañera" or "mi compañero" (for example "Se lo paso a mi compañera, la quiropráctica"), in English "my colleague". Never "un compañero", "un miembro del equipo" or "a colleague".`,
    // Dates come to the model as "Monday 2026-10-20", which it otherwise
    // copies out as "20/10" -- correct, and the least human way to say it.
    `Write dates in words, in the patient's language, with the weekday: "el lunes 20 de octubre", "Monday 20 October". Never "20/10" or "2026-10-20".`,
    `Reply in the language the patient writes in. The clinic supports: ${config.languages.join(', ')}.`,
    receptionistClockSection(opts.calendar.now, opts.calendar.timeZone),
    knowledge ? `# What you know about this clinic\n\n${knowledge}` : '# What you know about this clinic\n\nNothing has been configured yet. Say you will check with your colleague rather than guessing.',
    opts.leadOrigin ? leadOriginSection(opts.leadOrigin) : '',
    opts.audience ? audienceSection(opts.audience) : '',
    // The whole conversation is in the messages, and a receptionist who asks
    // for something the patient said three messages ago reads as a form.
    `Read the whole conversation before replying. Never ask for something the patient has already told you or that is already known about them, and never repeat a question that has been answered.`,
    // Booking outranks qualifying. A patient who writes "quiero una cita" and
    // gets "¿qué te ocurre?" back has been handed a form before they were
    // handed an appointment, and that is where enquiries go quiet.
    `# What comes first\nThe aim of every conversation is to get the patient booked. If they ask for an appointment, move towards booking in this same reply: ${availability ? 'offer times from the Booking list below, or ask which days suit them if you need to know first' : 'ask which days or times suit them'}. Do not ask about their symptoms, how long they have had them or how they heard about the clinic first -- none of that is a condition for booking. If they asked a question, answer it before anything else.`,
    // "¿Tengo artrosis, me podéis ayudar?" answered only with "lo valoramos
    // en la primera visita" gives the patient no reason to come to it. A line
    // on how chiropractic is used for that, honest about what it is not,
    // does -- and the assessment is still the chiropractor's.
    // "¿Cuánto cuesta la sesión?" from someone who has never been was answered
    // with the single-session and package prices, and "you need a first
    // visit" -- without its price, the one number they needed.
    opts.audience && opts.audience !== 'existing'
      ? `# Prices for someone new\nThey have not been to the clinic yet, so whatever they call it -- la cita, la sesión, la visita, la consulta -- a question about the price is about their first visit: give that price only, as "What you can offer" says for them. Only if they then ask about the visits after it, give the session and package prices from the clinic knowledge, and add that your colleague, the chiropractor, will explain their care plan and how many sessions they need at the first visit. After giving a price, offer to send them availability.`
      : '',
    `# When they mention a condition\nIf the patient names a condition or symptom (artrosis, ciática, hernia discal, dolor cervical...) and asks whether you can help, first say in one or two sentences how chiropractic care is generally used for it -- for example to improve mobility, ease stiffness and reduce the load on the affected joints -- taking what the clinic knowledge says about it first when it covers it. Speak in general terms ("se trabaja para", "puede ayudar a"), never diagnose them, never promise a result and never say it replaces their doctor's treatment. Then say the chiropractor will assess their particular case at the first visit, and move on to booking.`,
    questions
      ? `# Questions you may work in\nOnly once the patient's own request has been dealt with, at most one per reply, and never as a condition for booking. Skip any the conversation or "What you already know about this person" already answers. A question about how they heard about the clinic is for the clinic's records: never ask it when that is already known, never ask it to work out a price (answer the price as "What you can offer" says), and otherwise ask it at most once, at the very end, after a time has been agreed.\n\n${questions}`
      : '',
    // The types come from the database at the moment of drafting, not from
    // the model's reading of the knowledge cards: an owner who withholds a
    // type, or archives it, has it gone from the next reply.
    offeredTypesSection(opts.offeredTypes, adOnly),
    rescheduleSection(opts.bookedVisits ?? [], opts.calendar.timeZone, { listVisits: true }),
    // The real free times, computed by loadReceptionistCalendar, as a list to
    // offer from. Without one -- the calendar could not be read -- the model
    // asks when suits and a colleague picks the time (#691): a model told to
    // "offer times" with nothing to offer from invents them.
    hasTimes
      ? receptionistBookingSection({ availability, slotsPerReply: config.slotsPerReply, bookingWindowDays: config.bookingWindowDays, searchTool: opts.searchTool && Boolean(availability) })
      : '',
    // The single most important line in this prompt.
    `You must NEVER state that an appointment is booked, confirmed or reserved. A member of staff or the booking system confirms them${availability ? ', and a listed time can be taken before then' : ''}. ${availability ? 'If the patient accepts a time, say you are passing it on and that they will get a confirmation.' : 'Once the patient has said when suits them, say you are passing it on and that they will get a confirmation.'}`,
    escalations ? `# Stop and hand over to a person when\n\n${escalations}\n\nWhen one of these applies, say your colleague will pick this up shortly and stop.` : '',
    config.neverSays ? `# Never\n\n${config.neverSays}` : '',
    opts.testMode
      ? `# Test mode\nYou are being tried out by the clinic owner. Nothing you say reaches a patient and nothing is booked. Answer exactly as you would for real -- confidentiality included: the owner is trying what a patient would get.`
      : '',
    opts.draft
      ? `# This reply is a draft\nA member of staff will read what you write before it is sent, and may edit it. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to the reader.`
      : '',
    // Flattened by promptSafeName: the name is whatever the person typed into
    // a form, and must not be able to start a section of its own.
    personName ? `The person you are replying to is called ${personName}.` : '',
    // Last, so nothing above can be read as overriding it.
    CONFIDENTIALITY_SECTION,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Whether a lead arriving now should be handed to the receptionist.
 *
 * Leads are created with ai_state 'none', and the only thing that has ever
 * changed it is a button in the Inbox -- which sets 'paused' when a person
 * takes over and 'handling' when they hand back. So a lead could only reach
 * 'handling' by a person first taking over a conversation the receptionist
 * was never on.
 *
 * The consequence was quiet and total: the tick that drafts replies looks for
 * ai_state 'handling', so with nothing ever setting it, it had nothing to do
 * on any lead in any clinic. The switch said the receptionist reads real
 * enquiries; no enquiry was ever given to it.
 *
 * Which is what the switch means, then: on, new leads arrive with the
 * receptionist on them. Off, they arrive exactly as they always did.
 */
export async function receptionistHandlesNewLeads(supabase: any, accountId: string): Promise<boolean> {
  const { data } = await supabase
    .from('receptionist_config')
    .select('enabled')
    .eq('account_id', accountId)
    .maybeSingle()
  return Boolean(data?.enabled)
}

/**
 * Whether a lead the receptionist is handling will actually be drafted for:
 * switched on, and the account entitled to Growth -- the same two things the
 * drafting tick (receptionist-draft-cron) checks before it looks at a lead.
 *
 * What the WhatsApp webhook asks when a lead on 'handling' writes. If the
 * answer is yes, the message is exactly what the tick is waiting for and the
 * lead stays the AI's. If no, nothing is going to draft a reply, and leaving
 * the lead marked as the AI's would hide a question nobody is reading -- so it
 * goes to a person.
 */
export async function receptionistDraftsFor(supabase: any, accountId: string): Promise<boolean> {
  if (!(await receptionistHandlesNewLeads(supabase, accountId))) return false
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan_id, growth_addon, status, comped')
    .eq('account_id', accountId)
    .maybeSingle()
  return hasGrowth(subscription)
}
