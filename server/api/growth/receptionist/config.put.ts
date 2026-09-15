import { requireGrowth } from '~/server/utils/requireGrowth'
import { loadReceptionistConfig } from '~/server/utils/receptionist'
import type { TablesUpdate } from '~/types/database.types'

interface Body {
  enabled?: unknown
  personaName?: unknown
  tone?: unknown
  neverSays?: unknown
  qualificationQuestions?: unknown
  knowledge?: unknown
  escalationRules?: unknown
  bookingWindowDays?: unknown
  minimumNoticeMinutes?: unknown
  slotsPerReply?: unknown
  afterHours?: unknown
  missedCallTextBack?: unknown
  answerDuringHours?: unknown
}

const TONES = ['warm_brief', 'clinical', 'chatty', 'formal']

function intInRange(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be a whole number between ${min} and ${max}` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  // Ensures the row exists before the update, so a first save works.
  await loadReceptionistConfig(supabase, teamMember.account_id)

  const patch: TablesUpdate<'receptionist_config'> = {}

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'enabled must be a boolean' })
    patch.enabled = body.enabled
  }
  if (body.personaName !== undefined) {
    const name = typeof body.personaName === 'string' ? body.personaName.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'The receptionist needs a name' })
    patch.persona_name = name.slice(0, 60)
  }
  if (body.tone !== undefined) {
    if (typeof body.tone !== 'string' || !TONES.includes(body.tone)) throw createError({ statusCode: 400, statusMessage: 'Unknown tone' })
    patch.tone = body.tone
  }
  if (body.neverSays !== undefined) patch.never_says = typeof body.neverSays === 'string' ? body.neverSays.slice(0, 2000) : ''
  if (body.qualificationQuestions !== undefined) {
    if (!Array.isArray(body.qualificationQuestions)) throw createError({ statusCode: 400, statusMessage: 'qualificationQuestions must be a list' })
    patch.qualification_questions = body.qualificationQuestions.filter((q): q is string => typeof q === 'string').slice(0, 20) as never
  }
  if (body.knowledge !== undefined) {
    if (!Array.isArray(body.knowledge)) throw createError({ statusCode: 400, statusMessage: 'knowledge must be a list' })
    patch.knowledge = body.knowledge as never
  }
  if (body.escalationRules !== undefined) {
    if (!Array.isArray(body.escalationRules)) throw createError({ statusCode: 400, statusMessage: 'escalationRules must be a list' })
    patch.escalation_rules = body.escalationRules as never
  }
  if (body.bookingWindowDays !== undefined) patch.booking_window_days = intInRange(body.bookingWindowDays, 1, 90, 'Booking window')
  if (body.minimumNoticeMinutes !== undefined) patch.minimum_notice_minutes = intInRange(body.minimumNoticeMinutes, 0, 10080, 'Minimum notice')
  if (body.slotsPerReply !== undefined) patch.slots_per_reply = intInRange(body.slotsPerReply, 1, 5, 'Slots per reply')
  if (body.afterHours !== undefined) patch.after_hours = Boolean(body.afterHours)
  if (body.missedCallTextBack !== undefined) patch.missed_call_text_back = Boolean(body.missedCallTextBack)
  if (body.answerDuringHours !== undefined) patch.answer_during_hours = Boolean(body.answerDuringHours)

  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const { error } = await supabase.from('receptionist_config').update(patch).eq('account_id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { config: await loadReceptionistConfig(supabase, teamMember.account_id) }
})
