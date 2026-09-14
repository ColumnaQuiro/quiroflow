import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

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

const TONE_WORDING: Record<string, string> = {
  warm_brief: 'Warm and brief. Two or three sentences at most.',
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

/**
 * Builds the system prompt from the config.
 *
 * Every constraint the clinic set is stated as a rule the model must follow,
 * and the guardrails come last so they are the most recent thing in the
 * prompt. Note what is NOT delegated to the model: it is told to offer times,
 * never to confirm a booking. Writing to the calendar is the booking code's
 * job, and a model that believes it booked something will say so to a patient.
 */
export function buildSystemPrompt(config: ReceptionistConfig, opts: { testMode: boolean }) {
  const knowledge = config.knowledge
    .map((card) => `## ${card.title}\n${card.lines.map((line) => `- ${line}`).join('\n')}`)
    .join('\n\n')

  const questions = config.qualificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  const escalations = config.escalationRules.map((rule) => `- ${rule.rule} -> ${rule.action}`).join('\n')

  return [
    `You are ${config.personaName}, the receptionist for a chiropractic clinic. You answer enquiries from prospective patients.`,
    `Tone: ${TONE_WORDING[config.tone] ?? TONE_WORDING.warm_brief}`,
    `Reply in the language the patient writes in. The clinic supports: ${config.languages.join(', ')}.`,
    knowledge ? `# What you know about this clinic\n\n${knowledge}` : '# What you know about this clinic\n\nNothing has been configured yet. Say you will check with a colleague rather than guessing.',
    questions ? `# Qualify the enquiry by working these in naturally, one at a time\n\n${questions}` : '',
    `# Booking\nYou may offer up to ${config.slotsPerReply} time${config.slotsPerReply === 1 ? '' : 's'} per reply, within the next ${config.bookingWindowDays} days, no sooner than ${config.minimumNoticeMinutes} minutes from now.`,
    // The single most important line in this prompt.
    `You must NEVER state that an appointment is booked, confirmed or reserved. You offer times; a member of staff or the booking system confirms them. If the patient accepts a time, say you are putting it through and that they will get a confirmation.`,
    escalations ? `# Stop and hand over to a person when\n\n${escalations}\n\nWhen one of these applies, say a colleague will pick this up shortly and stop.` : '',
    config.neverSays ? `# Never\n\n${config.neverSays}` : '',
    opts.testMode
      ? `# Test mode\nYou are being tried out by the clinic owner. Nothing you say reaches a patient and nothing is booked. Answer exactly as you would for real.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
